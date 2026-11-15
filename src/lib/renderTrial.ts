import {
  RENDERER_MAX_CHARS,
  RENDER_REPORT_VERSION,
  type GestureKind,
  type Stratum,
  type TrialLevel,
  type TrialReason,
} from '../../shared/renderTrial'
import type { RenderEnvironment, RenderReport, RenderReportRow, RenderVerdict } from '../../shared/renderTrialSchema'
import { viewRect, type Camera, type Size } from './liveFrames'

/* The render trial, its pure part: which level of each render experiment a
   page load gets, how a camera gesture is timed, and what is reported. The
   browser glue (renderTrialClient.ts) holds the storage, the WebGL probe, the
   frame loop and the beacon.

   Two experiments, each a factor with the levels off and on, assigned per
   page load and independently of each other (a 2x2 factorial):
   - gpu: the GPU picture layer (gpuPictures.ts), only where WebGL2 runs on
     hardware;
   - zoomPictures: pictures in place of live documents while the zoom moves
     (zoomPictures.ts).
   Each browser leans to what is smoother for it, epsilon-greedy: it explores
   both levels until each has enough judged frames and loads, then uses the
   winner, and once in EPSILON loads the other level, so a verdict can follow
   a driver update. A level wins only on a clear margin of fewer slow frames;
   otherwise off wins, which is the tree as it was before the experiments.

   What judges a factor is every gesture it can change: gpu, each gesture
   that starts with a culled frame in view (the layer draws those, and its
   canvas is redrawn on every camera frame, so it must not win on crowded
   pans while it costs on a pinch); zoomPictures, each zoom with a live
   document in view. */

/** Changing this forgets every browser's state: new probes, new exploration. */
export const TRIAL_EPOCH = 1

/** Explore until both levels have this many judged frames… */
export const MIN_FRAMES = 600
/** …and this many loads with a judged gesture. */
export const MIN_LOADS = 3
/** While exploring, a level is drawn at random until one has been given
 *  this many more loads than the other; then the other is due (the big stick
 *  design of Soares and Wu). Strict alternation would pair the two factors'
 *  levels load after load, and one factor's effect would be read as the
 *  other's. */
export const EXPLORE_MAX_IMBALANCE = 2
/** A browser that has had each level this many times without the frames to
 *  judge (no heavy gestures, no zooms over live frames) stops exploring: off. */
export const EXPLORE_MAX_LOADS = 12
/** on beats off only when its slow-frame share is lower by both margins. */
export const MARGIN_ABS = 0.02
export const MARGIN_REL = 0.2
/** The share of loads that take the losing level, once there is a verdict. */
export const EPSILON = 0.1
/** Past this many frames in a level, both levels' counts are halved: the
 *  older evidence fades, and a verdict can turn. */
export const FRAME_CAP = 20_000
/** The GPU layer failing to start or losing its context this many times
 *  makes the factor ineligible until the next epoch. */
export const MAX_GPU_FAILURES = 2

/** A gesture ends this long after the camera's last change. */
export const GESTURE_END_MS = 150
/** Fewer camera changes are a jump (the fit on opening, a zoom-to-frame),
 *  not motion: such a gesture is not counted. */
export const MIN_CHANGES = 3
/** A frame is slow when its interval is over this many display intervals. */
export const SLOW_FACTOR = 1.5
/** Longer intervals are not frames of a gesture (a hidden tab, a debugger). */
export const MAX_INTERVAL_MS = 1000
/** At least this many culled frames (shells or pictures) in view at a
 *  gesture's start make it heavy: the case the GPU layer is for, and a
 *  stratum of the report. */
export const HEAVY_CULLED = 30
export const DEFAULT_DISPLAY_MS = 1000 / 60
export const DISPLAY_MIN_MS = 1000 / 240
export const DISPLAY_MAX_MS = 1000 / 24
/** The display estimate drops at once to a faster sample and rises by this
 *  share of the gap toward a slower one: a gesture full of slow frames does
 *  not teach it that the display is slow. */
export const DISPLAY_RISE = 0.05
/** Without a hide, a page reports at most this often. */
export const REPORT_EVERY_MS = 5 * 60_000

/* ------------------------------------------------------------------ */
/* the stored state                                                    */
/* ------------------------------------------------------------------ */

export interface LevelStats {
  frames: number
  slow: number
  gestures: number
  /** loads that judged at least one gesture at this level */
  loads: number
  /** loads the trial gave this level, judged or not */
  assigned: number
}
export interface FactorStats {
  on: LevelStats
  off: LevelStats
}
export interface GpuProbe {
  renderer: string
  /** WebGL2 without a major performance caveat, on a renderer that is not software */
  hardware: boolean
}
export interface TrialState {
  v: 1
  epoch: number
  /** the display interval estimate, ms */
  display: number
  probe: GpuProbe | null
  failures: number
  gpu: FactorStats
  zoomPictures: FactorStats
}

const level = (): LevelStats => ({ frames: 0, slow: 0, gestures: 0, loads: 0, assigned: 0 })

export function freshState(epoch = TRIAL_EPOCH): TrialState {
  return {
    v: 1,
    epoch,
    display: DEFAULT_DISPLAY_MS,
    probe: null,
    failures: 0,
    gpu: { on: level(), off: level() },
    zoomPictures: { on: level(), off: level() },
  }
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1e9
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function levelOf(v: unknown): LevelStats | null {
  if (!isRecord(v)) return null
  const { frames, slow, gestures, loads, assigned } = v
  if (![frames, slow, gestures, loads, assigned].every(isCount)) return null
  if ((slow as number) > (frames as number)) return null
  return { frames, slow, gestures, loads, assigned } as LevelStats
}
function factorOf(v: unknown): FactorStats | null {
  if (!isRecord(v)) return null
  const on = levelOf(v.on)
  const off = levelOf(v.off)
  return on && off ? { on, off } : null
}
function probeOf(v: unknown): GpuProbe | null | undefined {
  if (v === null) return null
  if (!isRecord(v) || typeof v.renderer !== 'string' || typeof v.hardware !== 'boolean') return undefined
  return { renderer: sanitizeRenderer(v.renderer), hardware: v.hardware }
}

/** The stored value, checked field by field. `garbage` when something was
 *  there and could not be read; another epoch is not garbage, it is a reset. */
export function parseState(raw: string | null, epoch = TRIAL_EPOCH): { state: TrialState; garbage: boolean } {
  if (raw === null) return { state: freshState(epoch), garbage: false }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { state: freshState(epoch), garbage: true }
  }
  if (isRecord(v) && v.v === 1 && isCount(v.epoch) && v.epoch !== epoch)
    return { state: freshState(epoch), garbage: false }
  if (!isRecord(v) || v.v !== 1 || v.epoch !== epoch) return { state: freshState(epoch), garbage: true }
  const gpu = factorOf(v.gpu)
  const zoomPictures = factorOf(v.zoomPictures)
  const probe = probeOf(v.probe)
  const display = v.display
  const okDisplay = typeof display === 'number' && display >= DISPLAY_MIN_MS && display <= DISPLAY_MAX_MS
  if (!gpu || !zoomPictures || probe === undefined || !isCount(v.failures) || !okDisplay)
    return { state: freshState(epoch), garbage: true }
  return { state: { v: 1, epoch, display, probe, failures: v.failures, gpu, zoomPictures }, garbage: false }
}

/* ------------------------------------------------------------------ */
/* deciding                                                            */
/* ------------------------------------------------------------------ */

/** The level each factor leans to. `open` while new frames could change
 *  it: then EPSILON applies. Closed when neither level has a slow frame
 *  (nothing to learn) or when the browser never produced frames to judge. */
export interface Leaning {
  winner: TrialLevel | null
  open: boolean
}

/* the shares are ratios of integers; a margin met exactly must count */
const TOLERANCE = 1e-9

export function leaningOf(f: FactorStats): Leaning {
  const { on, off } = f
  const judged = on.frames >= MIN_FRAMES && off.frames >= MIN_FRAMES && on.loads >= MIN_LOADS && off.loads >= MIN_LOADS
  if (judged) {
    if (on.slow === 0 && off.slow === 0) return { winner: 'off', open: false }
    const onShare = on.slow / on.frames
    const offShare = off.slow / off.frames
    const better = offShare - onShare >= MARGIN_ABS - TOLERANCE && onShare <= offShare * (1 - MARGIN_REL) + TOLERANCE
    return { winner: better ? 'on' : 'off', open: true }
  }
  if (on.assigned >= EXPLORE_MAX_LOADS && off.assigned >= EXPLORE_MAX_LOADS) return { winner: 'off', open: false }
  return { winner: null, open: true }
}

export interface Choice {
  level: TrialLevel
  reason: TrialReason
}

/** The trial's pick for one factor on this load. `random` returns [0, 1). */
export function assign(f: FactorStats, eligible: boolean, random: () => number): Choice {
  if (!eligible) return { level: 'off', reason: 'ineligible' }
  const lean = leaningOf(f)
  if (lean.winner === null) {
    const ahead = f.on.assigned - f.off.assigned
    if (Math.abs(ahead) >= EXPLORE_MAX_IMBALANCE) return { level: ahead < 0 ? 'on' : 'off', reason: 'explore' }
    return { level: random() < 0.5 ? 'on' : 'off', reason: 'explore' }
  }
  if (lean.open && random() < EPSILON) return { level: lean.winner === 'on' ? 'off' : 'on', reason: 'epsilon' }
  return { level: lean.winner, reason: 'exploit' }
}

/** True for a level the trial chose (and so learns from), not one a key forced. */
export const trialChose = (reason: TrialReason) => reason === 'explore' || reason === 'exploit' || reason === 'epsilon'

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software/i
export const isSoftwareRenderer = (renderer: string) => SOFTWARE_RENDERER.test(renderer)

/** Printable ASCII, cut to the report's limit. */
export function sanitizeRenderer(renderer: string): string {
  return renderer
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, RENDERER_MAX_CHARS)
    .trim()
}

/** The GPU layer is for hardware WebGL2 only; `force` (a testing switch)
 *  accepts software GL. Repeated failures rule it out either way. */
export function gpuEligible(state: Pick<TrialState, 'probe' | 'failures'>, force: boolean): boolean {
  if (state.failures >= MAX_GPU_FAILURES) return false
  return force || state.probe?.hardware === true
}

/** Adds one judged gesture to a level; `firstOfLoad` counts the load. Halves
 *  both levels when one passes FRAME_CAP. */
export function addJudged(f: FactorStats, lvl: TrialLevel, frames: number, slow: number, firstOfLoad: boolean): void {
  const s = f[lvl]
  s.frames += frames
  s.slow += slow
  s.gestures += 1
  if (firstOfLoad) s.loads += 1
  if (f.on.frames > FRAME_CAP || f.off.frames > FRAME_CAP) {
    for (const x of [f.on, f.off]) {
      x.frames = Math.floor(x.frames / 2)
      x.slow = Math.min(x.frames, Math.floor(x.slow / 2))
      x.gestures = Math.floor(x.gestures / 2)
      /* halving must not send a decided factor back to exploring for want of loads */
      x.loads = Math.max(Math.min(x.loads, MIN_LOADS), Math.floor(x.loads / 2))
      x.assigned = Math.max(Math.min(x.assigned, EXPLORE_MAX_LOADS), Math.floor(x.assigned / 2))
    }
  }
}

/** Takes back what a load added to a level (a GPU layer that failed). */
export function removeLoad(
  s: LevelStats,
  added: { frames: number; slow: number; gestures: number; loads: number; assigned: number },
): void {
  s.frames = Math.max(0, s.frames - added.frames)
  s.slow = Math.min(s.frames, Math.max(0, s.slow - added.slow))
  s.gestures = Math.max(0, s.gestures - added.gestures)
  s.loads = Math.max(0, s.loads - added.loads)
  s.assigned = Math.max(0, s.assigned - added.assigned)
}

export function verdictOf(f: FactorStats): RenderVerdict {
  const share = (s: LevelStats) => (s.frames ? round(s.slow / s.frames, 4) : null)
  return {
    winner: leaningOf(f).winner,
    onShare: share(f.on),
    offShare: share(f.off),
    onFrames: f.on.frames,
    offFrames: f.off.frames,
    onLoads: f.on.loads,
    offLoads: f.off.loads,
  }
}

/* ------------------------------------------------------------------ */
/* timing a gesture                                                    */
/* ------------------------------------------------------------------ */

/* Interval histogram edges, ms: 1 ms bins where frames are (4 to 34, every
   display from 240 Hz to 30 Hz), coarse ones above, enough for a p95. */
const EDGES = [
  0,
  ...Array.from({ length: 31 }, (_, i) => 4 + i),
  40,
  50,
  67,
  83,
  100,
  133,
  167,
  200,
  250,
  333,
  500,
  1000,
]
export const BIN_COUNT = EDGES.length - 1

export function binOf(ms: number): number {
  if (ms < 4) return 0
  if (ms < 34) return Math.floor(ms) - 3
  for (let i = 31; i < BIN_COUNT; i++) if (ms < EDGES[i + 1]!) return i
  return BIN_COUNT - 1
}

/** The q-quantile of a histogram, interpolated inside its bin. */
export function quantile(hist: ArrayLike<number>, total: number, q: number): number {
  if (total <= 0) return 0
  const target = q * total
  let seen = 0
  for (let i = 0; i < BIN_COUNT; i++) {
    const n = hist[i]!
    if (n > 0 && seen + n >= target) return EDGES[i]! + ((EDGES[i + 1]! - EDGES[i]!) * (target - seen)) / n
    seen += n
  }
  return EDGES[BIN_COUNT]!
}

export class Stats {
  frames = 0
  slow = 0
  sum = 0
  gestures = 0
  readonly hist = new Uint32Array(BIN_COUNT)
  reset(): void {
    this.frames = this.slow = this.sum = this.gestures = 0
    this.hist.fill(0)
  }
}

/** What is in view when a gesture starts. */
export interface Scene {
  /** in view without a live document: shells or GPU pictures */
  culled: number
  /** in view with a live document */
  live: number
  /** every frame on the page */
  total: number
}

export interface SceneFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
  hidden?: boolean
}

export function sceneInView(
  frames: readonly SceneFrame[],
  camera: Camera,
  stage: Size,
  live: { ids: ReadonlySet<string> | null; woken: readonly string[] },
): Scene {
  const r = viewRect(camera, stage, 0)
  let culled = 0
  let inLive = 0
  for (const f of frames) {
    if (f.hidden) continue
    if (!(f.x < r.x + r.width && f.x + f.width > r.x && f.y < r.y + r.height && f.y + f.height > r.y)) continue
    /* ids null: culling is off, every frame is a live document */
    if (live.ids === null || live.ids.has(f.id) || live.woken.includes(f.id)) inLive++
    else culled++
  }
  return { culled, live: inLive, total: frames.length }
}

export interface GestureSummary {
  kind: GestureKind
  stratum: Stratum
  live: boolean
  /** a culled frame was in view when it started: the GPU layer had something to draw */
  culled: boolean
  frames: number
  slow: number
}

const ROWS = 8
const rowIndex = (zoom: boolean, heavy: boolean, live: boolean) => (zoom ? 4 : 0) + (heavy ? 2 : 0) + (live ? 1 : 0)

/**
 * Times the animation frames of camera gestures. The caller tells it of each
 * camera change and feeds it the timestamps of an animation-frame loop that
 * runs only while `change` / `frame` say a gesture is on. An interval counts
 * when the camera changed within the two frames before it ends: the frame
 * that drew a change and the one after it, where its raster lands. The idle
 * tail and the work of the camera's rest timers are left out. Nothing here
 * allocates per frame.
 */
export class GestureRecorder {
  display: number
  /** per (kind, stratum, live), since the last report */
  readonly rows: Stats[] = Array.from({ length: ROWS }, () => new Stats())
  private readonly gesture = new Stats()
  private active = false
  private zoomed = false
  private heavy = false
  private live = false
  private culled = false
  private threshold = 0
  private lastChange = 0
  private changes = 0
  private prev = 0
  private prevPrev = 0

  constructor(
    display: number,
    private readonly sceneOf: () => Scene,
    private readonly onGesture: (g: GestureSummary) => void,
  ) {
    this.display = display
  }

  get running(): boolean {
    return this.active
  }

  /** A camera change at `now`. True when it starts a gesture: the caller
   *  starts its frame loop. */
  change(now: number, zoomed: boolean): boolean {
    this.lastChange = now
    if (this.active) {
      this.changes++
      if (zoomed) this.zoomed = true
      return false
    }
    const scene = this.sceneOf()
    this.active = true
    this.changes = 1
    this.zoomed = zoomed
    this.heavy = scene.culled >= HEAVY_CULLED
    this.live = scene.live > 0
    this.culled = scene.culled > 0
    this.threshold = this.display * SLOW_FACTOR
    this.prev = this.prevPrev = 0
    this.gesture.reset()
    return true
  }

  /** An animation frame's timestamp. False when the gesture has ended: the
   *  caller stops its loop. */
  frame(ts: number): boolean {
    if (!this.active) return false
    if (this.prev > 0) {
      const dt = ts - this.prev
      if (dt > 0 && dt <= MAX_INTERVAL_MS && this.lastChange >= this.prevPrev) {
        const g = this.gesture
        g.frames++
        g.sum += dt
        if (dt > this.threshold) g.slow++
        g.hist[binOf(dt)]!++
      }
    }
    this.prevPrev = this.prev
    this.prev = ts
    /* a change since the previous frame keeps the gesture on however long
       this frame took: a slow frame must not split a gesture in two */
    if (this.lastChange < this.prevPrev && ts - this.lastChange > GESTURE_END_MS) {
      this.end()
      return false
    }
    return true
  }

  /** The page went hidden: what was timed so far is a gesture, the
   *  interval in flight is not. */
  hide(): void {
    if (this.active) this.end()
  }

  private end(): void {
    this.active = false
    const g = this.gesture
    if (g.frames === 0 || this.changes < MIN_CHANGES) return
    if (g.frames >= 10) {
      const p10 = Math.min(DISPLAY_MAX_MS, Math.max(DISPLAY_MIN_MS, quantile(g.hist, g.frames, 0.1)))
      this.display = p10 < this.display ? p10 : this.display + (p10 - this.display) * DISPLAY_RISE
    }
    const row = this.rows[rowIndex(this.zoomed, this.heavy, this.live)]!
    row.frames += g.frames
    row.slow += g.slow
    row.sum += g.sum
    row.gestures += 1
    for (let i = 0; i < BIN_COUNT; i++) row.hist[i]! += g.hist[i]!
    this.onGesture({
      kind: this.zoomed ? 'zoom' : 'pan',
      stratum: this.heavy ? 'heavy' : 'light',
      live: this.live,
      culled: this.culled,
      frames: g.frames,
      slow: g.slow,
    })
  }

  /** The rows with frames, for a report. */
  reportRows(): RenderReportRow[] {
    const out: RenderReportRow[] = []
    for (let i = 0; i < ROWS; i++) {
      const r = this.rows[i]!
      if (r.frames === 0) continue
      out.push({
        kind: i & 4 ? 'zoom' : 'pan',
        stratum: i & 2 ? 'heavy' : 'light',
        live: (i & 1) === 1,
        gestures: r.gestures,
        frames: r.frames,
        slow: r.slow,
        mean: round(r.sum / r.frames, 1),
        p95: round(quantile(r.hist, r.frames, 0.95), 1),
      })
    }
    return out
  }

  clearRows(): void {
    for (const r of this.rows) r.reset()
  }
}

function round(n: number, digits: number): number {
  const k = 10 ** digits
  return Math.round(n * k) / k
}

/* ------------------------------------------------------------------ */
/* reporting                                                           */
/* ------------------------------------------------------------------ */

export function buildReport(input: {
  gpu: Choice
  zoomPictures: Choice
  env: RenderEnvironment
  rows: RenderReportRow[]
  state: TrialState
}): RenderReport | null {
  if (input.rows.length === 0) return null
  return {
    v: RENDER_REPORT_VERSION,
    epoch: input.state.epoch,
    gpu: { level: input.gpu.level, reason: input.gpu.reason },
    zoomPictures: { level: input.zoomPictures.level, reason: input.zoomPictures.reason },
    env: input.env,
    rows: input.rows,
    verdicts: { gpu: verdictOf(input.state.gpu), zoomPictures: verdictOf(input.state.zoomPictures) },
  }
}

/** The window's size, rounded to 100 px: a device class, not a fingerprint. */
export const roundTo100 = (n: number) => Math.max(0, Math.min(20_000, Math.round(n / 100) * 100))
