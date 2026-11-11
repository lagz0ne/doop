import { describe, expect, it } from 'vitest'
import { computeLiveFrames, LIVE_MIN_ZOOM, MAX_LIVE, viewRect, type FrameBox } from '../src/lib/liveFrames'

const stage = { width: 1400, height: 900 }
/** a grid of 1440×900 frames, 8 per row, 160/200 px apart (the layout of a large real canvas) */
function grid(n: number): FrameBox[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    x: (i % 8) * 1600,
    y: Math.floor(i / 8) * 1100,
    width: 1440,
    height: 900,
  }))
}
const none = new Set<string>()

describe('viewRect', () => {
  it('maps the camera to the world rectangle it shows', () => {
    expect(viewRect({ x: -200, y: -100, zoom: 0.5 }, stage, 0)).toEqual({ x: 400, y: 200, width: 2800, height: 1800 })
  })
})

describe('computeLiveFrames', () => {
  it('keeps only the frames near the view alive', () => {
    const live = computeLiveFrames(grid(200), { x: 0, y: 0, zoom: 1 }, stage, none, none)
    expect(live.has('f0')).toBe(true)
    expect(live.has('f199')).toBe(false)
    expect(live.size).toBeLessThan(10)
  })

  it('images every frame when zoomed out below the readable zoom', () => {
    const live = computeLiveFrames(grid(200), { x: 0, y: 0, zoom: LIVE_MIN_ZOOM - 0.05 }, stage, none, none)
    expect(live.size).toBe(0)
  })

  it('always keeps pinned frames (selected, being edited) alive', () => {
    const live = computeLiveFrames(grid(200), { x: 0, y: 0, zoom: 0.1 }, stage, new Set(['f150']), none)
    expect([...live]).toEqual(['f150'])
  })

  it('caps the live documents at MAX_LIVE, nearest to the view first', () => {
    const live = computeLiveFrames(
      grid(400),
      { x: 0, y: 0, zoom: LIVE_MIN_ZOOM },
      { width: 4000, height: 3000 },
      none,
      none,
    )
    expect(live.size).toBe(MAX_LIVE)
    // the view centre is world (6667, 5000): frame f36 (column 4, row 4) holds it
    expect(live.has('f36')).toBe(true)
    expect(live.has('f399')).toBe(false)
  })

  it('keeps a live frame alive a little past the edge it entered at (no flicker)', () => {
    const frames = grid(16)
    // the view shows world x 900..2300; f2 starts at x=3200: outside the 0.5-viewport entry
    // margin (200..3000), inside the 1-viewport keep margin (-500..3700)
    const camera = { x: -900, y: 0, zoom: 1 }
    const entered = computeLiveFrames(frames, camera, stage, none, none)
    expect(entered.has('f2')).toBe(false)
    const kept = computeLiveFrames(frames, camera, stage, none, new Set(['f2']))
    expect(kept.has('f2')).toBe(true)
  })

  it('culls canvas elements by distance only, never by zoom', () => {
    const shape: FrameBox = { id: 'shape', x: 100, y: 100, width: 200, height: 200, element: true }
    const live = computeLiveFrames([shape], { x: 0, y: 0, zoom: 0.1 }, stage, none, none)
    expect(live.has('shape')).toBe(true)
  })

  it('keeps everything pinned and nothing else before the stage is measured', () => {
    const live = computeLiveFrames(grid(5), { x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }, new Set(['f3']), none)
    expect([...live]).toEqual(['f3'])
  })
})
