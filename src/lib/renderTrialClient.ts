import { frameBucket } from '../../shared/renderTrial'
import type { RenderEnvironment } from '../../shared/renderTrialSchema'
import { cullingEnabled } from './liveFrames'
import {
  GestureRecorder,
  REPORT_EVERY_MS,
  TRIAL_EPOCH,
  addJudged,
  assign,
  buildReport,
  gpuEligible,
  isSoftwareRenderer,
  parseState,
  removeLoad,
  roundTo100,
  sanitizeRenderer,
  trialChose,
  type Choice,
  type GestureSummary,
  type GpuProbe,
  type Scene,
  type TrialState,
} from './renderTrial'

/* The render trial in the browser (renderTrial.ts has the rules): the
   decision for this page load, read once, the WebGL probe, the gesture
   recorder's frame loop, and the report.

   Keys, all per browser:
   - `doop:gpu` = off | on | force and `doop:zoom-pictures` = on | off set
     their experiment and take it out of the trial; unset, the trial decides.
   - `doop:render-trial` = off switches the trial off: unset experiments are
     off, nothing is measured or sent. `force` is for measuring on a machine
     without a GPU: it lets the trial put the GPU layer on a software GL.
   - `doop:render-trial-data` is the trial's own state (one JSON value). */

const SWITCH_KEY = 'doop:render-trial'
const DATA_KEY = 'doop:render-trial-data'
const REPORT_URL = '/api/telemetry/render'

export type GpuMode = 'off' | 'on' | 'force'

export interface TrialDecision {
  /** measuring and reporting on this load */
  active: boolean
  gpu: Choice & { mode: GpuMode }
  zoomPictures: Choice
}

interface LoadState {
  decision: TrialDecision
  force: boolean
  /* what this load added to gpu on, taken back if the layer fails */
  gpuOnAdded: { frames: number; slow: number; gestures: number; loads: number; assigned: number }
  judged: { gpu: boolean; zoomPictures: boolean }
  gpuFailed: boolean
  recorder: GestureRecorder | null
  /* the mounted Stage's scene; none between Stages */
  sceneOf: (() => Scene) | null
  display: number
  probe: GpuProbe | null
  frames: number
  lastSent: number
}

let load: LoadState | null = null

/** undefined: storage unavailable */
function read(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key)
  } catch {
    return undefined
  }
}
function write(state: TrialState): boolean {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

function explicitGpu(raw: string | null | undefined): GpuMode | null {
  if (raw === null || raw === undefined) return null
  /* a value nobody documented is a key someone set: keep the layer off, as before */
  return raw === 'on' || raw === 'force' ? raw : 'off'
}
const explicitZoomPictures = (raw: string | null | undefined): boolean | null =>
  raw === null || raw === undefined ? null : raw === 'on'

/** The renderer behind WebGL2, and whether it is hardware without a major
 *  performance caveat (the check Mapbox GL makes before it draws). Run once
 *  per browser and epoch; the contexts are released at once. */
function probeGpu(): GpuProbe {
  let renderer = ''
  let caveatFree = false
  try {
    let gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    caveatFree = !!gl
    /* with a caveat, a context that accepts one still names the renderer */
    gl ??= document.createElement('canvas').getContext('webgl2')
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    /* no WebGL2 at all */
  }
  return { renderer: sanitizeRenderer(renderer), hardware: caveatFree && !isSoftwareRenderer(renderer) }
}

function decide(): LoadState {
  const off: Choice = { level: 'off', reason: 'off' }
  const base = (decision: TrialDecision, force = false): LoadState => ({
    decision,
    force,
    gpuOnAdded: { frames: 0, slow: 0, gestures: 0, loads: 0, assigned: 0 },
    judged: { gpu: false, zoomPictures: false },
    gpuFailed: false,
    recorder: null,
    sceneOf: null,
    display: 0,
    probe: null,
    frames: 0,
    lastSent: performance.now(),
  })
  const gpuKey = explicitGpu(read('doop:gpu'))
  const zoomKey = explicitZoomPictures(read('doop:zoom-pictures'))
  const sw = read(SWITCH_KEY)
  const gpuOverride = (mode: GpuMode): TrialDecision['gpu'] => ({
    level: mode === 'off' ? 'off' : 'on',
    reason: 'override',
    mode,
  })
  const zoomOverride = (on: boolean): Choice => ({ level: on ? 'on' : 'off', reason: 'override' })
  /* the trial off: the keys as they were, every unset experiment off */
  const untrialed = (): TrialDecision => ({
    active: false,
    gpu: gpuKey ? gpuOverride(gpuKey) : { ...off, mode: 'off' },
    zoomPictures: zoomKey === null ? off : zoomOverride(zoomKey),
  })
  if (sw === undefined || sw === 'off') return base(untrialed())
  const force = sw === 'force'
  const { state, garbage } = parseState(read(DATA_KEY) ?? null, TRIAL_EPOCH)
  if (garbage) {
    /* this load runs as before; the next one starts the trial afresh */
    write(state)
    return base(untrialed())
  }
  let gpu: TrialDecision['gpu']
  if (gpuKey) gpu = gpuOverride(gpuKey)
  else if (!cullingEnabled()) gpu = { level: 'off', reason: 'ineligible', mode: 'off' }
  else {
    state.probe ??= probeGpu()
    const choice = assign(state.gpu, gpuEligible(state, force), Math.random)
    gpu = { ...choice, mode: choice.level === 'off' ? 'off' : force ? 'force' : 'on' }
  }
  const zoomPictures = zoomKey === null ? assign(state.zoomPictures, true, Math.random) : zoomOverride(zoomKey)
  const loadState = base({ active: true, gpu, zoomPictures }, force)
  if (trialChose(gpu.reason)) {
    state.gpu[gpu.level].assigned++
    if (gpu.level === 'on') loadState.gpuOnAdded.assigned = 1
  }
  if (trialChose(zoomPictures.reason)) state.zoomPictures[zoomPictures.level].assigned++
  /* the write is the test that storage works: without it, no trial */
  if (!write(state)) return base(untrialed())
  loadState.display = state.display
  loadState.probe = state.probe
  return loadState
}

/** This page load's levels, decided on the first call and fixed after it,
 *  so every reader (the Stage, each frame, the GPU layer) agrees. */
export function renderTrial(): TrialDecision {
  load ??= decide()
  return load.decision
}

/** This page load's levels if a canvas has decided them already, else null.
 *  For the renderer setting and its label: asking must not start a load the
 *  trial would count. */
export function decidedRenderTrial(): TrialDecision | null {
  return load?.decision ?? null
}

/** The GPU layer did not start, or lost its context. A load the trial put
 *  it on stops counting for on, and repeated failures rule it out. */
export function renderTrialGpuFailed(): void {
  renderTrial()
  const l = load!
  if (l.gpuFailed || l.decision.gpu.level !== 'on' || !trialChose(l.decision.gpu.reason)) return
  l.gpuFailed = true
  l.decision.gpu = { level: 'off', reason: 'ineligible', mode: 'off' }
  const { state, garbage } = parseState(read(DATA_KEY) ?? null, TRIAL_EPOCH)
  if (garbage) return
  state.failures++
  removeLoad(state.gpu.on, l.gpuOnAdded)
  write(state)
}

function onGesture(g: GestureSummary): void {
  const l = load
  if (!l) return
  const d = l.decision
  const gpu = g.culled && trialChose(d.gpu.reason)
  const zoom = g.kind === 'zoom' && g.live && trialChose(d.zoomPictures.reason)
  const now = performance.now()
  if (gpu || zoom) {
    /* read afresh: another tab may have written since (last write wins) */
    const { state, garbage } = parseState(read(DATA_KEY) ?? null, TRIAL_EPOCH)
    if (!garbage) {
      if (gpu) {
        addJudged(state.gpu, d.gpu.level, g.frames, g.slow, !l.judged.gpu)
        if (d.gpu.level === 'on') {
          const a = l.gpuOnAdded
          a.frames += g.frames
          a.slow += g.slow
          a.gestures += 1
          if (!l.judged.gpu) a.loads += 1
        }
        l.judged.gpu = true
      }
      if (zoom) {
        addJudged(state.zoomPictures, d.zoomPictures.level, g.frames, g.slow, !l.judged.zoomPictures)
        l.judged.zoomPictures = true
      }
      if (l.recorder) state.display = l.recorder.display
      write(state)
    }
  }
  if (now - l.lastSent >= REPORT_EVERY_MS) sendReport()
}

function environment(l: LoadState, display: number): RenderEnvironment {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores =
    Number.isInteger(nav.hardwareConcurrency) && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null
  const memory = typeof nav.deviceMemory === 'number' && nav.deviceMemory >= 0 ? nav.deviceMemory : null
  return {
    renderer: l.probe?.renderer ?? '',
    hardware: l.probe ? l.probe.hardware : null,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    width: roundTo100(window.innerWidth),
    height: roundTo100(window.innerHeight),
    cores: cores === null ? null : Math.min(cores, 1024),
    memory,
    display: Math.round(Math.min(100, Math.max(1, display)) * 10) / 10,
    touch: (navigator.maxTouchPoints ?? 0) > 0 || matchMedia('(pointer: coarse)').matches,
    frames: frameBucket(l.frames),
  }
}

/** Sends what was measured since the last report, if anything. */
export function sendReport(): void {
  const l = load
  const recorder = l?.recorder
  if (!l || !recorder) return
  const rows = recorder.reportRows()
  const { state } = parseState(read(DATA_KEY) ?? null, TRIAL_EPOCH)
  const report = buildReport({
    gpu: l.decision.gpu,
    zoomPictures: l.decision.zoomPictures,
    env: environment(l, recorder.display),
    rows,
    state,
  })
  if (!report) return
  recorder.clearRows()
  l.lastSent = performance.now()
  const body = JSON.stringify(report)
  /* a string goes as text/plain, which a beacon may send without a preflight */
  let queued = false
  try {
    queued = navigator.sendBeacon?.(REPORT_URL, body) ?? false
  } catch {
    queued = false
  }
  if (!queued)
    fetch(REPORT_URL, { method: 'POST', body, keepalive: true, credentials: 'same-origin' }).catch(() => {
      /* a lost report is a lost sample, nothing more */
    })
}

export interface RenderRecorder {
  /** the camera changed; `zoomed` when its zoom did */
  change(zoomed: boolean): void
  stop(): void
}

/**
 * The gesture recorder for a mounted Stage, or null when the trial is not
 * measuring. One animation-frame loop, running only while a gesture is on;
 * `sceneOf` is asked once per gesture, at its start.
 */
export function startRenderRecorder(sceneOf: () => Scene): RenderRecorder | null {
  renderTrial()
  const l = load!
  if (!l.decision.active) return null
  l.sceneOf = sceneOf
  /* one recorder per load: a Stage mounted again keeps the rows not yet sent */
  const recorder = (l.recorder ??= new GestureRecorder(
    l.display,
    () => {
      const s = l.sceneOf?.() ?? { culled: 0, live: 0, total: l.frames }
      l.frames = s.total
      return s
    },
    onGesture,
  ))
  let raf = 0
  let hidden = document.visibilityState === 'hidden'
  /* one callback for every frame: nothing is allocated per frame */
  const tick = (ts: number) => {
    raf = 0
    if (recorder.frame(ts)) raf = requestAnimationFrame(tick)
  }
  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden'
    if (!hidden) return
    cancelAnimationFrame(raf)
    raf = 0
    recorder.hide()
    sendReport()
  }
  const onPageHide = () => {
    recorder.hide()
    sendReport()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  return {
    change(zoomed) {
      if (hidden) return
      recorder.change(performance.now(), zoomed)
      if (raf === 0 && recorder.running) raf = requestAnimationFrame(tick)
    },
    stop() {
      cancelAnimationFrame(raf)
      raf = 0
      recorder.hide()
      if (l.sceneOf === sceneOf) l.sceneOf = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    },
  }
}
