import { afterEach, describe, expect, it } from 'vitest'
import {
  framesToSwap,
  keepsDocument,
  registerZoomPicture,
  swappedFrames,
  zoomPicturesActive,
  zoomPicturesEnd,
  zoomPicturesStart,
  type ZoomPictureFrame,
  type ZoomPictureState,
} from '../src/lib/zoomPictures'

/* While the zoom moves, a live frame nobody works in shows its picture in
   place of its document (zoomPictures.ts). */

const idle: ZoomPictureState = {
  documentShown: true,
  canvasElement: false,
  selected: false,
  elementPicked: false,
  editing: false,
  pathEditing: false,
  moving: false,
  streaming: false,
  peerEditing: false,
  prototypeMode: false,
}

describe('keepsDocument', () => {
  it('lets a shown frame nobody works in swap', () => {
    expect(keepsDocument(idle)).toBe(false)
  })

  it.each([
    'canvasElement',
    'selected',
    'elementPicked',
    'editing',
    'pathEditing',
    'moving',
    'streaming',
    'peerEditing',
    'prototypeMode',
  ] as const)('keeps the document while %s', (flag) => {
    expect(keepsDocument({ ...idle, [flag]: true })).toBe(true)
  })

  it('keeps a document that has not shown yet', () => {
    expect(keepsDocument({ ...idle, documentShown: false })).toBe(true)
  })
})

/* elements just real enough for the registry: a style to write and, for a
   picture, an <img> that has or has not loaded */
interface FakeEl {
  style: { visibility: string }
  querySelector: (s: string) => { complete: boolean; naturalWidth: number } | null
}
const el = (img?: { complete: boolean; naturalWidth: number }): FakeEl => ({
  style: { visibility: '' },
  querySelector: () => img ?? null,
})
const asEl = (e: FakeEl) => e as unknown as HTMLElement

function fakeFrame(ready = true) {
  const iframe = el()
  const picture = el(ready ? { complete: true, naturalWidth: 100 } : { complete: false, naturalWidth: 0 })
  picture.style.visibility = 'hidden'
  let paint: () => void = () => {}
  const frame: ZoomPictureFrame = {
    iframe: () => asEl(iframe),
    picture: () => asEl(picture),
    painted: () => new Promise<void>((r) => (paint = r)),
  }
  return { iframe, picture, frame, paint: () => paint() }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('the zoom picture registry', () => {
  const unregister: (() => void)[] = []
  afterEach(() => {
    zoomPicturesEnd()
    unregister.splice(0).forEach((u) => u())
  })
  const register = (id: string, f: ReturnType<typeof fakeFrame>) => unregister.push(registerZoomPicture(id, f.frame))

  it('swaps only frames whose picture has loaded', () => {
    const a = fakeFrame()
    const b = fakeFrame(false)
    register('a', a)
    register('b', b)
    expect(
      framesToSwap(
        new Map([
          ['a', a.frame],
          ['b', b.frame],
        ]),
      ),
    ).toEqual(['a'])
    zoomPicturesStart()
    expect(zoomPicturesActive()).toBe(true)
    expect([a.iframe.style.visibility, a.picture.style.visibility]).toEqual(['hidden', 'visible'])
    expect([b.iframe.style.visibility, b.picture.style.visibility]).toEqual(['', 'hidden'])
    expect(swappedFrames()).toEqual(['a'])
  })

  it('shows the document again first and takes the picture down once it painted', async () => {
    const a = fakeFrame()
    register('a', a)
    zoomPicturesStart()
    zoomPicturesEnd()
    expect(zoomPicturesActive()).toBe(false)
    expect([a.iframe.style.visibility, a.picture.style.visibility]).toEqual(['', 'visible'])
    a.paint()
    await tick()
    expect(a.picture.style.visibility).toBe('hidden')
    expect(swappedFrames()).toEqual([])
  })

  it('starts once per gesture', () => {
    const a = fakeFrame()
    register('a', a)
    zoomPicturesStart()
    const late = fakeFrame()
    register('late', late)
    zoomPicturesStart()
    /* a frame registered mid-gesture keeps its document until the next one */
    expect(late.iframe.style.visibility).toBe('')
    expect(swappedFrames()).toEqual(['a'])
  })

  it('keeps the picture when a new gesture took the frame before the old paint answered', async () => {
    const a = fakeFrame()
    register('a', a)
    zoomPicturesStart()
    zoomPicturesEnd()
    const firstPaint = a.paint
    zoomPicturesStart()
    firstPaint()
    await tick()
    expect([a.iframe.style.visibility, a.picture.style.visibility]).toEqual(['hidden', 'visible'])
  })

  it('gives the document back when a frame leaves mid-gesture (selected, edited…)', async () => {
    const a = fakeFrame()
    const off = registerZoomPicture('a', a.frame)
    zoomPicturesStart()
    off()
    expect(a.iframe.style.visibility).toBe('')
    a.paint()
    await tick()
    expect(a.picture.style.visibility).toBe('hidden')
    expect(swappedFrames()).toEqual([])
  })
})
