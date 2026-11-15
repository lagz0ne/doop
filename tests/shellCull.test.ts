import { describe, expect, it } from 'vitest'
import {
  cullShells,
  SHELL_DROP_MARGIN,
  SHELL_ENTER_MARGIN,
  SHELL_KEEP_MARGIN,
  shellBox,
  shellInView,
  shellRects,
  trackShell,
} from '../src/lib/shellCull'

const stage = { width: 1600, height: 1000 }
/** a 1440×900 frame whose left edge is `gap` screen px right of the view's right edge at `zoom` */
function rightOfView(gap: number, zoom: number) {
  return { id: 'f', x: (stage.width + gap) / zoom, y: 0, width: 1440, height: 900 }
}

describe('shellInView', () => {
  const camera = { x: 0, y: 0, zoom: 0.6 }
  const rects = shellRects(camera, stage)

  it('keeps a shell in view, or within the enter margin, in the tree', () => {
    expect(shellInView(rightOfView(-100, 0.6), rects, false)).toBe(true)
    expect(shellInView(rightOfView(stage.width * SHELL_ENTER_MARGIN - 10, 0.6), rects, false)).toBe(true)
  })

  it('takes a shell past the margin out', () => {
    expect(shellInView(rightOfView(stage.width * SHELL_ENTER_MARGIN + 10, 0.6), rects, false)).toBe(false)
  })

  it('lets a shell in the tree stay out to the keep margin, so a camera at an edge does not toggle it', () => {
    const between = rightOfView(stage.width * ((SHELL_ENTER_MARGIN + SHELL_KEEP_MARGIN) / 2), 0.6)
    expect(shellInView(between, rects, false)).toBe(false)
    expect(shellInView(between, rects, true)).toBe(true)
    expect(shellInView(rightOfView(stage.width * SHELL_KEEP_MARGIN + 10, 0.6), rects, true)).toBe(false)
  })

  it('lets a shell stay out to the drop margin while the camera moves', () => {
    const between = rightOfView(stage.width * ((SHELL_KEEP_MARGIN + SHELL_DROP_MARGIN) / 2), 0.6)
    expect(shellInView(between, rects, true)).toBe(false)
    expect(shellInView(between, rects, true, false)).toBe(true)
    expect(shellInView(rightOfView(stage.width * SHELL_DROP_MARGIN + 10, 0.6), rects, true, false)).toBe(false)
    /* a shell out of the tree comes back at the enter margin, moving or not */
    expect(shellInView(between, rects, false, false)).toBe(false)
  })

  it('measures the margins in screen px at every zoom', () => {
    for (const zoom of [0.08, 0.25, 0.6, 2]) {
      const r = shellRects({ x: 0, y: 0, zoom }, stage)
      expect(shellInView(rightOfView(stage.width * SHELL_ENTER_MARGIN - 10, zoom), r, false)).toBe(true)
      expect(shellInView(rightOfView(stage.width * SHELL_ENTER_MARGIN + 10, zoom), r, false)).toBe(false)
    }
  })

  it('looks above and left of the view as well', () => {
    const above = {
      id: 'a',
      x: 0,
      y: -(stage.height * SHELL_ENTER_MARGIN + 900 * 0.6 + 10) / 0.6,
      width: 1440,
      height: 900,
    }
    expect(shellInView(above, rects, false)).toBe(false)
    expect(shellInView({ ...above, y: above.y + 40 / 0.6 }, rects, false)).toBe(true)
  })

  it('culls nothing before the stage is measured', () => {
    expect(shellRects(camera, { width: 0, height: 0 })).toBeNull()
    expect(shellInView(rightOfView(1e6, 0.6), null, false)).toBe(true)
  })
})

describe('shellBox', () => {
  it('is the frame itself when unturned', () => {
    expect(shellBox({ id: 'f', x: 10, y: 20, width: 300, height: 100 })).toEqual({
      id: 'f',
      x: 10,
      y: 20,
      width: 300,
      height: 100,
    })
  })

  it('covers a turned frame about its centre', () => {
    const b = shellBox({ id: 'f', x: 0, y: 0, width: 300, height: 100, rotation: 90 })
    expect(b.x).toBeCloseTo(100)
    expect(b.y).toBeCloseTo(-100)
    expect(b.width).toBeCloseTo(100)
    expect(b.height).toBeCloseTo(300)
  })

  it('keeps a turned frame whose corner reaches into the margin in the tree', () => {
    /* a tall thin frame just below the margin: unturned it is out; turned
       90° it reaches up into it */
    const zoom = 1
    const rects = shellRects({ x: 0, y: 0, zoom }, stage)
    const top = stage.height * (1 + SHELL_ENTER_MARGIN) + 200
    const frame = { id: 'f', x: 0, y: top, width: 1000, height: 100 }
    expect(shellInView(shellBox(frame), rects, false)).toBe(false)
    expect(shellInView(shellBox({ ...frame, rotation: 90 }), rects, false)).toBe(true)
  })
})

describe('cullShells', () => {
  function element() {
    return { hidden: false } as unknown as HTMLElement
  }
  const frames = [
    { id: 'near', x: 100, y: 100, width: 1440, height: 900 },
    { id: 'far', x: 20000, y: 0, width: 1440, height: 900 },
  ]

  it('hides the far shells and shows them again when the camera reaches them', () => {
    const near = element()
    const far = element()
    trackShell('near', near)
    trackShell('far', far)
    cullShells(frames, { x: 0, y: 0, zoom: 1 }, stage)
    expect(near.hidden).toBe(false)
    expect(far.hidden).toBe(true)
    cullShells(frames, { x: -19000, y: 0, zoom: 1 }, stage)
    expect(near.hidden).toBe(true)
    expect(far.hidden).toBe(false)
    trackShell('near', null)
    trackShell('far', null)
  })

  it('keeps the shells a moving camera leaves out to the drop margin, and takes them out once it rests', () => {
    /* 3000 px right: near is past the keep margin but within the drop one */
    const near = element()
    trackShell('near', near)
    cullShells(frames, { x: 0, y: 0, zoom: 1 }, stage)
    cullShells(frames, { x: -3000, y: 0, zoom: 1 }, stage, false)
    expect(near.hidden).toBe(false)
    cullShells(frames, { x: -3000, y: 0, zoom: 1 }, stage)
    expect(near.hidden).toBe(true)
    trackShell('near', null)
  })

  it('takes a shell out while the camera moves once it is past the drop margin', () => {
    const near = element()
    const far = element()
    trackShell('near', near)
    trackShell('far', far)
    cullShells(frames, { x: 0, y: 0, zoom: 1 }, stage)
    cullShells(frames, { x: -19000, y: 0, zoom: 1 }, stage, false)
    expect(far.hidden).toBe(false)
    expect(near.hidden).toBe(true)
    trackShell('near', null)
    trackShell('far', null)
  })

  it('writes nothing when no shell crosses a margin', () => {
    const writes: boolean[] = []
    const el = {
      set hidden(v: boolean) {
        writes.push(v)
      },
      get hidden() {
        return writes.at(-1) ?? false
      },
    } as unknown as HTMLElement
    cullShells(frames, { x: 0, y: 0, zoom: 1 }, stage)
    trackShell('far', el)
    expect(writes).toEqual([true])
    for (let i = 0; i < 20; i++) cullShells(frames, { x: -i * 30, y: i * 10, zoom: 1 }, stage)
    expect(writes).toEqual([true])
    trackShell('far', null)
  })

  it('gives a shell that mounts later the state the camera last gave its frame', () => {
    cullShells(frames, { x: 0, y: 0, zoom: 1 }, stage)
    const far = element()
    trackShell('far', far)
    expect(far.hidden).toBe(true)
    trackShell('far', null)
    /* the camera moves while the frame is not a shell (a FrameView, say) */
    cullShells(frames, { x: -19000, y: 0, zoom: 1 }, stage)
    const again = element()
    trackShell('far', again)
    expect(again.hidden).toBe(false)
    trackShell('far', null)
  })
})
