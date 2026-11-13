import { describe, expect, it } from 'vitest'
import {
  computeLiveFrames,
  LIVE_MIN_ZOOM,
  MAX_LIVE,
  MAX_PINNED_SELECTION,
  pinnedBySelection,
  sharpPreviews,
  useLiveFrames,
  viewRect,
  type FrameBox,
} from '../src/lib/liveFrames'

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

  it('boots the frames on screen, not their neighbours beyond the edge', () => {
    const frames = grid(64)
    // the view shows world x 0..1400, y 0..900: f0 fills it. Its neighbours start 200 px past the
    // right edge (f1) and the bottom edge (f8), beyond the 0.1-viewport entry margin (140 and 90 px)
    const live = computeLiveFrames(frames, { x: 0, y: 0, zoom: 1 }, stage, none, none)
    expect([...live]).toEqual(['f0'])
    // one of them a sliver into view is wanted
    expect(computeLiveFrames(frames, { x: -300, y: 0, zoom: 1 }, stage, none, none).has('f1')).toBe(true)
  })

  it('keeps a live frame alive a little past the edge it entered at (no flicker)', () => {
    const frames = grid(16)
    // the view shows world x 1300..2700; f2 starts at x=3200: outside the 0.1-viewport entry
    // margin (1160..2840), inside the 0.5-viewport keep margin (600..3400)
    const camera = { x: -1300, y: 0, zoom: 1 }
    const entered = computeLiveFrames(frames, camera, stage, none, none)
    expect(entered.has('f2')).toBe(false)
    const kept = computeLiveFrames(frames, camera, stage, none, new Set(['f2']))
    expect(kept.has('f2')).toBe(true)
  })

  it('never counts canvas elements against the cap: they have no preview to stand in', () => {
    const shapes: FrameBox[] = Array.from({ length: 60 }, (_, i) => ({
      id: `s${i}`,
      x: (i % 10) * 100,
      y: Math.floor(i / 10) * 100,
      width: 80,
      height: 80,
      element: true,
    }))
    const live = computeLiveFrames([...grid(40), ...shapes], { x: 0, y: 0, zoom: 1 }, stage, none, none)
    expect(shapes.every((s) => live.has(s.id))).toBe(true)
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

describe('pinnedBySelection', () => {
  it('pins a small selection and nothing of a large one', () => {
    expect(pinnedBySelection(['a', 'b'])).toEqual(['a', 'b'])
    const many = Array.from({ length: MAX_PINNED_SELECTION + 1 }, (_, i) => `f${i}`)
    expect(pinnedBySelection(many)).toEqual([])
  })
})

describe('wake', () => {
  it('keeps the most recently woken frames, newest last, without duplicates', () => {
    const { wake } = useLiveFrames.getState()
    for (const id of ['a', 'b', 'a', 'c']) wake(id)
    expect(useLiveFrames.getState().woken).toEqual(['b', 'a', 'c'])
    for (let i = 0; i < 20; i++) wake(`f${i}`)
    expect(useLiveFrames.getState().woken).toHaveLength(8)
    expect(useLiveFrames.getState().woken.at(-1)).toBe('f19')
  })
})

describe('sharpPreviews', () => {
  it('names the frames in or near the view: only those get a picture above the smallest level', () => {
    // the view shows world 0..1400 × 0..900; with half a viewport of margin, -700..2100 × -450..1350
    const sharp = sharpPreviews(grid(200), { x: 0, y: 0, zoom: 1 }, stage)
    expect([...sharp].sort()).toEqual(['f0', 'f1', 'f8', 'f9'])
  })

  it('is every frame when the whole page is in view', () => {
    expect(sharpPreviews(grid(40), { x: 0, y: 0, zoom: 0.08 }, stage).size).toBe(40)
  })

  it('never names a canvas element (no picture), nor anything before the stage is measured', () => {
    const shape: FrameBox = { id: 'shape', x: 100, y: 100, width: 200, height: 200, element: true }
    expect(sharpPreviews([shape], { x: 0, y: 0, zoom: 1 }, stage).size).toBe(0)
    expect(sharpPreviews(grid(4), { x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }).size).toBe(0)
  })
})
