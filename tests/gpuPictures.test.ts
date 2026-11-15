import { describe, expect, it } from 'vitest'
import {
  LABEL_GAP,
  frameAt,
  frameBounds,
  gpuDrawnFrames,
  nameStrip,
  pictureSrc,
  type PictureFrame,
} from '../src/lib/gpuPictures'
import { ellipsisCut } from '../src/lib/gpuLabels'

function frame(id: string, x: number, y: number, extra: Partial<PictureFrame> = {}): PictureFrame {
  return { id, x, y, width: 100, height: 100, candidate: true, label: '', ...extra }
}
const ids = (set: Set<string>) => [...set].sort()
const ready = () => true
const draw = (frames: PictureFrame[], inDom: (id: string) => boolean = () => false, strip = 0) =>
  ids(gpuDrawnFrames(frames, inDom, ready, strip))

describe('frameBounds', () => {
  it('is the box itself for an unturned frame', () => {
    expect(frameBounds({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x0: 10, y0: 20, x1: 110, y1: 70 })
  })
  it('covers a turned frame', () => {
    const b = frameBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 })
    expect(b.x0).toBeCloseTo(25)
    expect(b.x1).toBeCloseTo(75)
    expect(b.y0).toBeCloseTo(-25)
    expect(b.y1).toBeCloseTo(75)
  })
  it('counts the name above the frame in, turned with it', () => {
    expect(frameBounds({ x: 0, y: 100, width: 100, height: 50 }, 20)).toEqual({ x0: 0, y0: 80, x1: 100, y1: 150 })
    /* turned 90° clockwise the frame's top faces right */
    const b = frameBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 }, 20)
    expect(b.x1).toBeCloseTo(95)
    expect(b.x0).toBeCloseTo(25)
  })
})

describe('gpuDrawnFrames', () => {
  it('draws every frame of a page laid out side by side', () => {
    expect(draw([frame('a', 0, 0), frame('b', 200, 0), frame('c', 400, 0)])).toEqual(['a', 'b', 'c'])
  })

  it('leaves live frames to the DOM', () => {
    expect(draw([frame('a', 0, 0), frame('b', 200, 0)], (id) => id === 'b')).toEqual(['a'])
  })

  it('keeps a frame in the DOM when something in the DOM lies under it', () => {
    /* b is above a live frame a: the canvas under the stack would draw it beneath a */
    const frames = [frame('a', 0, 0), frame('b', 50, 50), frame('c', 120, 120)]
    /* b stays a shell, and so c, above b, does too */
    expect(draw(frames, (id) => id === 'a')).toEqual([])
  })

  it('draws a frame lying under a live frame (the live one covers it)', () => {
    expect(draw([frame('a', 0, 0), frame('b', 50, 50)], (id) => id === 'b')).toEqual(['a'])
  })

  it('draws frames stacked on each other when none is in the DOM', () => {
    expect(draw([frame('a', 0, 0), frame('b', 50, 50), frame('c', 80, 80)])).toEqual(['a', 'b', 'c'])
  })

  it('draws only what is ready: the rest are shells, and count as DOM under what follows', () => {
    const frames = [frame('a', 0, 0), frame('b', 50, 50), frame('c', 400, 0)]
    expect(
      ids(
        gpuDrawnFrames(
          frames,
          () => false,
          (f) => f.id !== 'a',
          0,
        ),
      ),
    ).toEqual(['c'])
  })

  it('never draws what is not a candidate: an empty, locked or marked frame, a canvas element', () => {
    expect(draw([frame('x', 0, 0, { candidate: false }), frame('b', 200, 0)])).toEqual(['b'])
  })

  it('counts every shell under a frame, a canvas element included; a hidden frame not', () => {
    expect(draw([frame('s', 0, 0, { candidate: false }), frame('b', 50, 50)])).toEqual([])
    expect(draw([frame('h', 0, 0, { candidate: false, hidden: true }), frame('b', 50, 50)])).toEqual(['b'])
    /* selected, a hidden frame is painted (HiddenFrameView) */
    expect(
      draw([frame('h', 0, 0, { candidate: false, hidden: true }), frame('b', 50, 50)], (id) => id === 'h'),
    ).toEqual([])
  })

  it('counts names: a frame under the name of a DOM frame, or whose name lies on one, stays', () => {
    /* b's name strip (20 page px above it) reaches into a, which is live */
    const named = [frame('a', 0, 0), frame('b', 0, 115, { label: 'B' })]
    expect(draw(named, (id) => id === 'a', 20)).toEqual([])
    expect(draw(named, (id) => id === 'a', 10)).toEqual(['b'])
    /* unnamed, b has no strip */
    expect(draw([frame('a', 0, 0), frame('b', 0, 115)], (id) => id === 'a', 20)).toEqual(['b'])
  })

  it('counts a turned frame by its turned bounds', () => {
    /* a 200×20 bar turned 90° reaches down to y = 190 around x = 100 */
    const bar = frame('bar', 0, 90, { width: 200, height: 20, rotation: 90 })
    expect(draw([bar, frame('b', 95, 170, { width: 10, height: 10 })], (id) => id === 'bar')).toEqual([])
  })
})

describe('frameAt', () => {
  const L = 18
  it('finds the topmost frame under the point, in paint order', () => {
    const frames = [frame('a', 0, 0), frame('b', 50, 50)]
    expect(frameAt(frames, 60, 60, 1, L)).toEqual({ id: 'b', name: false })
    expect(frameAt(frames, 20, 20, 1, L)).toEqual({ id: 'a', name: false })
    expect(frameAt(frames, 200, 200, 1, L)).toBeNull()
  })

  it('turns the point into the frame', () => {
    /* a 200×20 bar turned 90°: it stands at x 90-110, y -90-110 */
    const bar = [frame('bar', 0, 0, { width: 200, height: 20, rotation: 90 })]
    expect(frameAt(bar, 100, -80, 1, L)?.id).toBe('bar')
    expect(frameAt(bar, 100, 100, 1, L)?.id).toBe('bar')
    expect(frameAt(bar, 20, 10, 1, L)).toBeNull()
  })

  it('counts the name strip, a line high and LABEL_GAP screen px above the frame', () => {
    const frames = [frame('a', 0, 100, { label: 'A' })]
    const z = 0.5
    /* the strip spans page y 100 - (6 + 18) / 0.5 = 52 to 100 - 6 / 0.5 = 88 */
    expect(frameAt(frames, 10, 53, z, L)).toEqual({ id: 'a', name: true })
    expect(frameAt(frames, 10, 87, z, L)).toEqual({ id: 'a', name: true })
    expect(frameAt(frames, 10, 51, z, L)).toBeNull()
    /* the gap itself is not the frame's */
    expect(frameAt(frames, 10, 95, z, L)).toBeNull()
    /* past the frame's width is not its name either */
    expect(frameAt(frames, 101, 60, z, L)).toBeNull()
    /* no name, no strip */
    expect(frameAt([frame('a', 0, 100)], 10, 60, z, L)).toBeNull()
  })

  it('gives a frame above the name of the one under it the press', () => {
    const frames = [frame('a', 0, 100, { label: 'A' }), frame('b', 0, 0)]
    expect(frameAt(frames, 10, 90, 1, L)?.id).toBe('b')
  })

  it('turns the name strip with its frame', () => {
    /* 100×100 turned 90° clockwise: the strip lies right of the frame */
    const frames = [frame('a', 0, 0, { label: 'A', rotation: 90 })]
    expect(frameAt(frames, 100 + LABEL_GAP + 5, 50, 1, L)).toEqual({ id: 'a', name: true })
    expect(frameAt(frames, 50, -10, 1, L)).toBeNull()
  })
})

describe('nameStrip', () => {
  it('is constant on screen: page px grow as the camera zooms out', () => {
    expect(nameStrip(18, 1)).toBe(24)
    expect(nameStrip(18, 0.1)).toBeCloseTo(240)
    expect(nameStrip(18, 0)).toBe(0)
  })
})

describe('ellipsisCut', () => {
  /* five graphemes, 10 px each; the ellipsis is 8 px */
  const prefix = [0, 10, 20, 30, 40, 50]
  it('keeps a name that fits whole', () => {
    expect(ellipsisCut(prefix, 5, 8, 50)).toBe(-1)
    expect(ellipsisCut(prefix, 5, 8, 80)).toBe(-1)
  })
  it('keeps the longest prefix that leaves room for the ellipsis', () => {
    expect(ellipsisCut(prefix, 5, 8, 49)).toBe(4)
    expect(ellipsisCut(prefix, 5, 8, 47)).toBe(3)
    expect(ellipsisCut(prefix, 5, 8, 38)).toBe(3)
    expect(ellipsisCut(prefix, 5, 8, 37)).toBe(2)
  })
  it('keeps only the ellipsis where nothing else fits', () => {
    expect(ellipsisCut(prefix, 5, 8, 12)).toBe(0)
    expect(ellipsisCut(prefix, 5, 8, 3)).toBe(0)
  })
})

describe('pictureSrc', () => {
  const f = { id: 'f', width: 1440, height: 900, updatedAt: 7 }
  it('asks for nothing before the camera has rested', () => {
    expect(pictureSrc(f, null, new Set())).toBeNull()
  })
  it('uses the smallest level away from the view', () => {
    expect(pictureSrc(f, 2, new Set())).toBe('/i/f.webp?preview&s=0.25&v=7')
  })
  it('uses the level covering the density near the view', () => {
    expect(pictureSrc(f, 0.4, new Set(['f']))).toBe('/i/f.webp?preview&s=0.5&v=7')
  })
})
