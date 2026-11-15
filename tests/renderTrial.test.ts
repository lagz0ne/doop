import { describe, expect, it } from 'vitest'
import {
  BIN_COUNT,
  DEFAULT_DISPLAY_MS,
  DISPLAY_MAX_MS,
  EPSILON,
  EXPLORE_MAX_IMBALANCE,
  EXPLORE_MAX_LOADS,
  FRAME_CAP,
  GESTURE_END_MS,
  GestureRecorder,
  HEAVY_CULLED,
  MAX_GPU_FAILURES,
  MIN_FRAMES,
  MIN_LOADS,
  TRIAL_EPOCH,
  addJudged,
  assign,
  binOf,
  buildReport,
  freshState,
  gpuEligible,
  isSoftwareRenderer,
  leaningOf,
  parseState,
  quantile,
  removeLoad,
  sanitizeRenderer,
  sceneInView,
  type FactorStats,
  type GestureSummary,
  type LevelStats,
  type Scene,
} from '../src/lib/renderTrial'
import { renderReportSchema } from '../shared/renderTrialSchema'

/* The render trial's rules (src/lib/renderTrial.ts): who gets which level,
   when a level wins, how frames of a gesture are counted. */

const lvl = (frames: number, slow: number, loads = MIN_LOADS, assigned = loads): LevelStats => ({
  frames,
  slow,
  gestures: loads,
  loads,
  assigned,
})
const factor = (on: LevelStats, off: LevelStats): FactorStats => ({ on, off })
const always = (n: number) => () => n

describe('the decision rule', () => {
  it('explores until both levels have the frames and the loads', () => {
    expect(leaningOf(factor(lvl(MIN_FRAMES - 1, 0), lvl(5000, 900))).winner).toBeNull()
    expect(leaningOf(factor(lvl(5000, 0, MIN_LOADS - 1), lvl(5000, 900))).winner).toBeNull()
    expect(leaningOf(factor(lvl(MIN_FRAMES, 0), lvl(MIN_FRAMES, 100))).winner).toBe('on')
  })

  it('explores at random, and gives a level its turn once it is two loads behind', () => {
    const f = factor(lvl(0, 0, 0, 3), lvl(0, 0, 0, 3))
    expect(assign(f, true, always(0.49))).toEqual({ level: 'on', reason: 'explore' })
    expect(assign(f, true, always(0.5))).toEqual({ level: 'off', reason: 'explore' })
    /* one load apart is still a coin: strict alternation would tie the two factors together */
    f.on.assigned = 4
    expect(assign(f, true, always(0.49)).level).toBe('on')
    expect(assign(f, true, always(0.5)).level).toBe('off')
    f.on.assigned = 3 + EXPLORE_MAX_IMBALANCE
    expect(assign(f, true, always(0))).toEqual({ level: 'off', reason: 'explore' })
    f.on.assigned = 3 - EXPLORE_MAX_IMBALANCE
    expect(assign(f, true, always(0.99))).toEqual({ level: 'on', reason: 'explore' })
  })

  it('does not pair the two factors: every arm turns up while both explore', () => {
    /* a seeded generator, so the test is the same every run */
    let seed = 7
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const arms = new Map<string, number>()
    for (let browser = 0; browser < 200; browser++) {
      const gpu = factor(lvl(0, 0, 0, 0), lvl(0, 0, 0, 0))
      const zoom = factor(lvl(0, 0, 0, 0), lvl(0, 0, 0, 0))
      for (let load = 0; load < 6; load++) {
        const g = assign(gpu, true, random).level
        const z = assign(zoom, true, random).level
        gpu[g].assigned++
        zoom[z].assigned++
        arms.set(`${g}/${z}`, (arms.get(`${g}/${z}`) ?? 0) + 1)
        expect(Math.abs(gpu.on.assigned - gpu.off.assigned)).toBeLessThanOrEqual(EXPLORE_MAX_IMBALANCE)
      }
    }
    /* 1200 loads over four arms: each near 300 */
    expect(arms.size).toBe(4)
    for (const n of arms.values()) expect(Math.abs(n - 300)).toBeLessThan(60)
  })

  it('needs both margins: 2 points and 20% fewer slow frames', () => {
    /* exactly both margins: 10% against 12.5% is 2.5 points and 20% */
    expect(leaningOf(factor(lvl(1000, 100), lvl(1000, 125))).winner).toBe('on')
    /* exactly 2 points, and 20% relative (8% vs 10%) */
    expect(leaningOf(factor(lvl(1000, 80), lvl(1000, 100))).winner).toBe('on')
    /* 2 points, but only 4% relative (48% vs 50%) */
    expect(leaningOf(factor(lvl(1000, 480), lvl(1000, 500))).winner).toBe('off')
    /* 30% relative, but 1.5 points (3.5% vs 5%) */
    expect(leaningOf(factor(lvl(1000, 35), lvl(1000, 50))).winner).toBe('off')
    /* a tie, and on worse */
    expect(leaningOf(factor(lvl(1000, 100), lvl(1000, 100))).winner).toBe('off')
    expect(leaningOf(factor(lvl(1000, 200), lvl(1000, 100))).winner).toBe('off')
  })

  it('ends on off, for good, when nothing is slow at either level', () => {
    const f = factor(lvl(5000, 0), lvl(5000, 0))
    expect(leaningOf(f)).toEqual({ winner: 'off', open: false })
    /* no epsilon either: a browser where nothing is slow stays on the tree as it was */
    for (const r of [0, 0.01, 0.09, 0.5])
      expect(assign(f, true, always(r))).toEqual({ level: 'off', reason: 'exploit' })
  })

  it('ends on off when the loads never brought frames to judge', () => {
    const f = factor(lvl(100, 50, 2, EXPLORE_MAX_LOADS), lvl(100, 80, 2, EXPLORE_MAX_LOADS))
    expect(leaningOf(f)).toEqual({ winner: 'off', open: false })
    f.off.assigned--
    expect(leaningOf(f).winner).toBeNull()
  })

  it('takes the other level with probability epsilon once there is a winner', () => {
    const f = factor(lvl(1000, 10), lvl(1000, 300))
    expect(assign(f, true, always(EPSILON - 0.001))).toEqual({ level: 'off', reason: 'epsilon' })
    expect(assign(f, true, always(EPSILON))).toEqual({ level: 'on', reason: 'exploit' })
    const losing = factor(lvl(1000, 300), lvl(1000, 10))
    expect(assign(losing, true, always(0))).toEqual({ level: 'on', reason: 'epsilon' })
  })

  it('never puts an ineligible factor on', () => {
    const f = factor(lvl(5000, 0), lvl(5000, 4000))
    for (const r of [0, 0.5, 0.99]) expect(assign(f, false, always(r))).toEqual({ level: 'off', reason: 'ineligible' })
  })

  it('halves both levels when one passes the cap, keeping a verdict', () => {
    const f = factor(lvl(FRAME_CAP - 10, 1000, 40, 41), lvl(9000, 2000, 4, 4))
    addJudged(f, 'on', 50, 5, false)
    expect(f.on).toEqual({ frames: (FRAME_CAP + 40) / 2, slow: 502, gestures: 20, loads: 20, assigned: 20 })
    expect(f.off).toEqual({ frames: 4500, slow: 1000, gestures: 2, loads: MIN_LOADS, assigned: 4 })
    expect(leaningOf(f).winner).toBe('on')
  })

  it('counts a load once, on its first judged gesture', () => {
    const f = factor(lvl(0, 0, 0, 1), lvl(0, 0, 0, 0))
    addJudged(f, 'on', 30, 3, true)
    addJudged(f, 'on', 20, 0, false)
    expect(f.on).toEqual({ frames: 50, slow: 3, gestures: 2, loads: 1, assigned: 1 })
  })

  it('takes back what a failed load added, never below zero', () => {
    const s = lvl(100, 10, 2, 3)
    removeLoad(s, { frames: 60, slow: 20, gestures: 1, loads: 1, assigned: 1 })
    expect(s).toEqual({ frames: 40, slow: 0, gestures: 1, loads: 1, assigned: 2 })
    removeLoad(s, { frames: 500, slow: 0, gestures: 9, loads: 9, assigned: 9 })
    expect(s).toEqual({ frames: 0, slow: 0, gestures: 0, loads: 0, assigned: 0 })
  })
})

describe('GPU eligibility', () => {
  it('wants hardware WebGL2 unless forced, and gives up after failures', () => {
    const hw = { renderer: 'ANGLE (NVIDIA GeForce)', hardware: true }
    const sw = { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', hardware: false }
    expect(gpuEligible({ probe: hw, failures: 0 }, false)).toBe(true)
    expect(gpuEligible({ probe: sw, failures: 0 }, false)).toBe(false)
    expect(gpuEligible({ probe: null, failures: 0 }, false)).toBe(false)
    expect(gpuEligible({ probe: sw, failures: 0 }, true)).toBe(true)
    expect(gpuEligible({ probe: hw, failures: MAX_GPU_FAILURES - 1 }, false)).toBe(true)
    expect(gpuEligible({ probe: hw, failures: MAX_GPU_FAILURES }, false)).toBe(false)
    expect(gpuEligible({ probe: sw, failures: MAX_GPU_FAILURES }, true)).toBe(false)
  })

  it('names software renderers', () => {
    for (const r of [
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Microsoft Basic Render Driver (Software)',
      'softpipe',
    ])
      expect(isSoftwareRenderer(r), r).toBe(true)
    for (const r of [
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple M2',
      'Mali-G78',
    ])
      expect(isSoftwareRenderer(r), r).toBe(false)
  })

  it('keeps a renderer string printable and short', () => {
    expect(sanitizeRenderer('a\u0000béc')).toBe('a?b?c')
    expect(sanitizeRenderer('x'.repeat(200))).toHaveLength(80)
  })
})

describe('the stored state', () => {
  it('starts fresh from nothing, and from another epoch without calling it garbage', () => {
    expect(parseState(null)).toEqual({ state: freshState(), garbage: false })
    const old = JSON.stringify({ ...freshState(TRIAL_EPOCH + 1), failures: 5 })
    expect(parseState(old)).toEqual({ state: freshState(), garbage: false })
  })

  it('reads back what it wrote', () => {
    const s = freshState()
    s.probe = { renderer: 'Apple M2', hardware: true }
    s.gpu.on = lvl(700, 7, 3, 4)
    s.display = 8.4
    expect(parseState(JSON.stringify(s))).toEqual({ state: s, garbage: false })
  })

  it('calls anything else garbage', () => {
    const good = freshState()
    const bad = [
      '',
      '{',
      'null',
      '[]',
      '"x"',
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, epoch: 'one' }),
      JSON.stringify({ ...good, gpu: null }),
      JSON.stringify({ ...good, gpu: { on: lvl(10, 11), off: lvl(0, 0) } }),
      JSON.stringify({ ...good, zoomPictures: { on: { ...lvl(0, 0), frames: -1 }, off: lvl(0, 0) } }),
      JSON.stringify({ ...good, probe: { renderer: 3, hardware: true } }),
      JSON.stringify({ ...good, display: 0 }),
      JSON.stringify({ ...good, failures: 1.5 }),
    ]
    for (const raw of bad) expect(parseState(raw), raw).toEqual({ state: freshState(), garbage: true })
  })
})

describe('the interval histogram', () => {
  it('bins by 1 ms where frames are, coarser above', () => {
    expect(binOf(0)).toBe(0)
    expect(binOf(3.9)).toBe(0)
    expect(binOf(4)).toBe(1)
    expect(binOf(16.7)).toBe(13)
    expect(binOf(33.99)).toBe(30)
    expect(binOf(34)).toBe(31)
    expect(binOf(999)).toBe(BIN_COUNT - 1)
    expect(binOf(5000)).toBe(BIN_COUNT - 1)
  })

  it('interpolates quantiles inside a bin', () => {
    const h = new Uint32Array(BIN_COUNT)
    h[binOf(16.7)] = 90
    h[binOf(45)] = 10
    expect(quantile(h, 100, 0.5)).toBeCloseTo(16 + 50 / 90, 5)
    /* the 95th sits halfway through the 40-50 bin */
    expect(quantile(h, 100, 0.95)).toBeCloseTo(45, 5)
    expect(quantile(h, 0, 0.95)).toBe(0)
  })
})

describe('the gesture recorder', () => {
  const heavy: Scene = { culled: HEAVY_CULLED, live: 0, total: 188 }
  const light: Scene = { culled: HEAVY_CULLED - 1, live: 2, total: 40 }

  /* drives a recorder like the page does: a camera change per frame for
     `frames` frames (each interval given), then frames until it ends */
  function gesture(rec: GestureRecorder, intervals: number[], zoomAt = -1, start = 1000) {
    let t = start
    rec.change(t - 1, zoomAt === 0)
    expect(rec.frame(t)).toBe(true)
    intervals.forEach((dt, i) => {
      t += dt
      expect(rec.frame(t)).toBe(true)
      rec.change(t + 1, zoomAt === i + 1)
    })
    let frames = 0
    while (rec.frame((t += 16.7))) frames++
    return { end: t, tail: frames }
  }

  it('counts the frames of a pan, its slow ones, and two frames of tail', () => {
    const seen: GestureSummary[] = []
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => heavy,
      (g) => seen.push(g),
    )
    const { tail } = gesture(rec, [16.7, 16.7, 40, 16.7, 16.7, 60, 16.7])
    /* the loop ran on past the last change for GESTURE_END_MS: 9 frames of 16.7 ms */
    expect(tail).toBe(Math.ceil(GESTURE_END_MS / 16.7))
    /* 7 intervals during the gesture, then the two after the last change */
    expect(seen).toEqual([{ kind: 'pan', stratum: 'heavy', live: false, culled: true, frames: 9, slow: 2 }])
    const [row] = rec.reportRows()
    expect(row).toMatchObject({ kind: 'pan', stratum: 'heavy', live: false, gestures: 1, frames: 9, slow: 2 })
    expect(row!.mean).toBeCloseTo((16.7 * 7 + 40 + 60) / 9, 1)
  })

  it('calls a gesture a zoom when the zoom changed at any point, and keeps the stratum it started with', () => {
    const seen: GestureSummary[] = []
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => light,
      (g) => seen.push(g),
    )
    gesture(rec, [16.7, 16.7, 16.7, 16.7], 3)
    expect(seen[0]).toMatchObject({ kind: 'zoom', stratum: 'light', live: true })
  })

  it('keeps one gesture through a frame longer than its end delay', () => {
    const seen: GestureSummary[] = []
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => heavy,
      (g) => seen.push(g),
    )
    gesture(rec, [16.7, 300, 16.7, 250, 16.7])
    expect(seen).toEqual([{ kind: 'pan', stratum: 'heavy', live: false, culled: true, frames: 7, slow: 2 }])
  })

  it('leaves out a jump: fewer than three camera changes', () => {
    const seen: GestureSummary[] = []
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => heavy,
      (g) => seen.push(g),
    )
    rec.change(0, false)
    rec.frame(16)
    rec.change(17, true)
    let t = 16
    while (rec.frame((t += 16.7)));
    expect(seen).toEqual([])
    expect(rec.reportRows()).toEqual([])
  })

  it('ignores intervals over a second and ends on hide', () => {
    const seen: GestureSummary[] = []
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => heavy,
      (g) => seen.push(g),
    )
    rec.change(0, false)
    rec.frame(10)
    rec.change(11, false)
    rec.frame(27)
    rec.change(28, false)
    rec.frame(1500)
    rec.change(1501, false)
    rec.hide()
    expect(rec.running).toBe(false)
    expect(rec.frame(1520)).toBe(false)
    expect(seen).toEqual([{ kind: 'pan', stratum: 'heavy', live: false, culled: true, frames: 1, slow: 0 }])
  })

  it('learns the display interval: down at once, up slowly', () => {
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => heavy,
      () => {},
    )
    gesture(
      rec,
      Array.from({ length: 30 }, () => 8.33),
    )
    expect(rec.display).toBeGreaterThan(8)
    expect(rec.display).toBeLessThan(8.4)
    const fast = rec.display
    /* a gesture of nothing but slow frames moves it 5% of the way */
    gesture(
      rec,
      Array.from({ length: 30 }, () => 33.3),
      -1,
      10_000,
    )
    expect(rec.display).toBeCloseTo(fast + (33 + 0.1 * 1 - fast) * 0.05, 1)
    expect(rec.display).toBeLessThan(DISPLAY_MAX_MS)
  })

  it('judges slow against the display interval of the gesture start', () => {
    const seen: GestureSummary[] = []
    const rec = new GestureRecorder(
      8.33,
      () => heavy,
      (g) => seen.push(g),
    )
    /* 16.7 ms frames on a 120 Hz display are each a missed refresh */
    gesture(rec, [16.7, 16.7, 16.7, 8.33])
    expect(seen[0]!.slow).toBe(3 + 2)
  })

  it('clears its rows after a report', () => {
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => heavy,
      () => {},
    )
    gesture(rec, [16.7, 16.7, 16.7])
    expect(rec.reportRows()).toHaveLength(1)
    rec.clearRows()
    expect(rec.reportRows()).toEqual([])
  })
})

describe('the scene at a gesture start', () => {
  const frames = [
    { id: 'a', x: 0, y: 0, width: 100, height: 100 },
    { id: 'b', x: 200, y: 0, width: 100, height: 100 },
    { id: 'c', x: 5000, y: 0, width: 100, height: 100 },
    { id: 'd', x: 0, y: 200, width: 100, height: 100, hidden: true },
  ]
  const camera = { x: 0, y: 0, zoom: 1 }
  const stage = { width: 1000, height: 800 }

  it('counts the culled and the live frames in view', () => {
    expect(sceneInView(frames, camera, stage, { ids: new Set(['a']), woken: [] })).toEqual({
      culled: 1,
      live: 1,
      total: 4,
    })
    expect(sceneInView(frames, camera, stage, { ids: new Set(), woken: ['b'] })).toEqual({
      culled: 1,
      live: 1,
      total: 4,
    })
    /* culling off: everything is live */
    expect(sceneInView(frames, camera, stage, { ids: null, woken: [] })).toEqual({ culled: 0, live: 2, total: 4 })
    expect(sceneInView(frames, { x: 0, y: 0, zoom: 0.1 }, stage, { ids: new Set(), woken: [] }).culled).toBe(3)
  })
})

describe('the report', () => {
  it('is nothing without rows, and valid for the server with them', () => {
    const state = freshState()
    const env = {
      renderer: 'Apple M2',
      hardware: true,
      dpr: 2,
      width: 1500,
      height: 900,
      cores: 8,
      memory: null,
      display: 16.7,
      touch: false,
      frames: '100-199' as const,
    }
    const choice = { level: 'off' as const, reason: 'explore' as const }
    expect(buildReport({ gpu: choice, zoomPictures: choice, env, rows: [], state })).toBeNull()
    const rec = new GestureRecorder(
      DEFAULT_DISPLAY_MS,
      () => ({ culled: 40, live: 1, total: 120 }),
      () => {},
    )
    let t = 0
    for (let i = 0; i < 20; i++) {
      rec.change(t, i === 5)
      rec.frame((t += i % 4 ? 16.7 : 35))
    }
    while (rec.frame((t += 16.7)));
    state.gpu.on = lvl(700, 70, 3)
    const report = buildReport({ gpu: choice, zoomPictures: choice, env, rows: rec.reportRows(), state })
    expect(renderReportSchema.safeParse(report).success).toBe(true)
    expect(report!.verdicts.gpu).toMatchObject({ winner: null, onShare: 0.1, offShare: null, onFrames: 700 })
  })
})
