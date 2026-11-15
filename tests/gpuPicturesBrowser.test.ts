import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import { TOUCH_HOLD_MS } from '../src/lib/touchHold'
import type { Canvas, Frame } from '../shared/types'

/* The GPU picture layer (src/lib/gpuPictures.ts, localStorage['doop:gpu']):
   culled frames drawn whole on one WebGL2 canvas under the frame stack,
   picture, name and hover ring, with nothing of them in the DOM; a press on
   one is resolved by arithmetic and wakes it into a FrameView. Previews are
   answered here with one flat colour, so where the canvas draws a picture is
   that colour. Skipped where this Chromium has no WebGL2 at all. */

declare global {
  interface Window {
    seedPages: (canvas: Canvas) => void
  }
}

const FRAMES = 40
const canvas: Canvas = {
  id: 'c',
  name: 'GPU page',
  pages: [{ id: 'p', name: 'Main' }],
  frames: Array.from({ length: FRAMES }, (_, i): Frame => ({
    id: `f${i}`,
    canvasId: 'c',
    pageId: 'p',
    name: `Frame ${i}`,
    x: (i % 8) * 1600,
    y: Math.floor(i / 8) * 1100,
    width: 1440,
    height: 900,
    html: `<!doctype html><html><body style="margin:0;background:#fff"><h1>Screen ${i}</h1></body></html>`,
    createdAt: 0,
    updatedAt: 1,
    updatedBy: 'User',
  })),
  createdAt: 0,
  updatedAt: 0,
}

/** the colour every preview is served in */
const PICTURE = [200, 220, 255]

const store = (page: Page, call: string) =>
  page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => { useStore.getState().${call} })`)
const drawn = (page: Page) =>
  page.evaluate(
    `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => [...useGpuPictures.getState().drawn].sort())`,
  ) as Promise<string[]>
const selected = (page: Page) =>
  page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => useStore.getState().selectedIds)`) as Promise<
    string[]
  >
const previews = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-doop-frame-preview]').length)
const shells = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-frame-shell]').length)
const shellIds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-frame-shell]')].map((el) => el.getAttribute('data-frame-shell')!).sort(),
  )
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** the colours on screen in a box, from a screenshot (the canvas keeps no drawing buffer). Within the
    viewport: a capture beyond it renders the page again and showed white where the screen has paper. */
async function pixels(page: Page, x: number, y: number, width = 1, height = 1): Promise<number[][]> {
  const png = await page.screenshot({ clip: { x, y, width, height }, encoding: 'base64', captureBeyondViewport: false })
  return page.evaluate(
    async (src, w, h) => {
      const img = new Image()
      img.src = `data:image/png;base64,${src}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, w, h).data
      const out: number[][] = []
      for (let i = 0; i < d.length; i += 4) out.push([d[i]!, d[i + 1]!, d[i + 2]!])
      return out
    },
    png,
    width,
    height,
  )
}
const pixel = async (page: Page, x: number, y: number) => (await pixels(page, x, y))[0]!

/** answers every preview request with one flat PICTURE image */
async function servePreviews(page: Page) {
  const png = await page.evaluate((rgb) => {
    const c = document.createElement('canvas')
    c.width = 144
    c.height = 90
    const g = c.getContext('2d')!
    g.fillStyle = `rgb(${rgb.join(',')})`
    g.fillRect(0, 0, 144, 90)
    return c.toDataURL('image/png').split(',')[1]!
  }, PICTURE)
  const body = Buffer.from(png, 'base64')
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (/\/i\/[^/]+\.webp\?preview/.test(req.url())) void req.respond({ status: 200, contentType: 'image/png', body })
    else void req.continue()
  })
}

/** the screen box of a frame at the test's camera (20, 60) at 8% */
function box(stage: { left: number; top: number }, i: number) {
  const left = stage.left + 20 + (i % 8) * 1600 * 0.08
  const top = stage.top + 60 + Math.floor(i / 8) * 1100 * 0.08
  return { left, top, right: left + 1440 * 0.08, bottom: top + 900 * 0.08 }
}

describe.skipIf(!findBrowserPath())('GPU pictures', () => {
  let browser: TestBrowser
  let page: Page
  let webgl = false
  let stage = { left: 0, top: 0 }
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(fixtureUrl('pages.html'))
    webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
    await servePreviews(page)
    await page.evaluate(() => localStorage.setItem('doop:gpu', 'force'))
    await page.reload()
    await page.waitForFunction(() => typeof window.seedPages === 'function')
    await page.evaluate((c) => window.seedPages(c), canvas)
    await store(page, 'setViewport({ x: 20, y: 60, zoom: 0.08 })')
    stage = await page.evaluate(() => {
      const r = document.querySelector('.stage')!.getBoundingClientRect()
      return { left: r.left, top: r.top }
    })
    if (webgl)
      await page.waitForFunction(
        `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => useGpuPictures.getState().drawn.size === ${FRAMES})`,
        { timeout: 30_000 },
      )
    await sleep(200)
  }, 120_000)
  afterAll(async () => {
    await page?.evaluate(() => localStorage.removeItem('doop:gpu')).catch(() => {})
    await page?.close()
    await browser?.close()
  })

  it('draws every culled frame on the canvas, with nothing of it in the DOM', async (ctx) => {
    if (!webgl) ctx.skip()
    expect(await page.evaluate(() => !!document.querySelector('canvas[data-stage-pictures]'))).toBe(true)
    expect(await drawn(page)).toHaveLength(FRAMES)
    expect(await shells(page)).toBe(0)
    expect(await previews(page)).toBe(0)
    expect(await page.evaluate(() => document.querySelectorAll('[data-frame-title]').length)).toBe(0)
  }, 30_000)

  it('paints a frame where the DOM would, its name above it, and nothing between frames', async (ctx) => {
    if (!webgl) ctx.skip()
    const f = box(stage, 9)
    const mid = await pixel(page, Math.round((f.left + f.right) / 2), Math.round((f.top + f.bottom) / 2))
    for (const [i, c] of mid.entries()) expect(Math.abs(c - PICTURE[i]!)).toBeLessThanOrEqual(2)
    /* the gap between frames 8 and 9 is the stage's paper */
    const paper = await pixel(page, Math.round(f.left - 6), Math.round(f.top + 30))
    expect(paper).not.toEqual(mid)
    /* the name: ink in the line LABEL_GAP above the frame, none in the gap */
    const ink = (px: number[][]) => Math.min(...px.map(([r = 0, g = 0, b = 0]) => (r + g + b) / 3))
    expect(ink(await pixels(page, Math.round(f.left), Math.round(f.top - 24), 60, 18))).toBeLessThan(150)
    expect(ink(await pixels(page, Math.round(f.left), Math.round(f.top - 4), 60, 3))).toBeGreaterThan(200)
    /* and nothing past the name, inside the strip */
    expect(ink(await pixels(page, Math.round(f.left + 70), Math.round(f.top - 24), 30, 18))).toBeGreaterThan(200)
  }, 30_000)

  it('draws the hover ring on a frame under the mouse', async (ctx) => {
    if (!webgl) ctx.skip()
    const f = box(stage, 12)
    const edge = { x: Math.floor(f.left) - 1, y: Math.round((f.top + f.bottom) / 2) }
    const before = await pixel(page, edge.x, edge.y)
    await page.mouse.move(f.left + 40, edge.y)
    await sleep(100)
    const [r = 0, , b = 0] = await pixel(page, edge.x, edge.y)
    expect(b - r).toBeGreaterThan(60)
    expect(before[2]! - before[0]!).toBeLessThan(10)
    await page.mouse.move(5, 995)
    await sleep(100)
    expect(await pixel(page, edge.x, edge.y)).toEqual(before)
  }, 30_000)

  it('selects a drawn frame on a press, and it is a FrameView then', async (ctx) => {
    if (!webgl) ctx.skip()
    const f = box(stage, 9)
    await page.mouse.click((f.left + f.right) / 2, (f.top + f.bottom) / 2)
    await sleep(200)
    expect(await selected(page)).toEqual(['f9'])
    expect(await drawn(page)).not.toContain('f9')
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 9"]'))).toBe(true)
    /* the others stay drawn, but for the ones whose name lies on it: at 8% a
       name (24 screen px over its frame) reaches into the row above, and
       the canvas is under the DOM. Each of those is a shell, so the one
       below it is too: the column under f9. */
    expect(await shellIds(page)).toEqual(['f17', 'f25', 'f33'])
  }, 30_000)

  it('selects a drawn frame on a press on its name', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, 'select(null)')
    const f = box(stage, 10)
    await page.mouse.click(f.left + 10, f.top - 15)
    await sleep(200)
    expect(await selected(page)).toEqual(['f10'])
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 10"]'))).toBe(true)
  }, 30_000)

  it('moves a drawn frame with one drag: the press that wakes it also starts the drag', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, 'select(null)')
    const f = box(stage, 13)
    const at = { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 }
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 20, at.y + 12, { steps: 4 })
    await page.mouse.move(at.x + 40, at.y + 24, { steps: 4 })
    await page.mouse.up()
    await sleep(200)
    const moved = (await page.evaluate(
      `import('/src/lib/store.ts').then(({ useStore }) => useStore.getState().canvas.frames.find((f) => f.id === 'f13'))`,
    )) as { x: number; y: number }
    expect(moved.x).toBeGreaterThan(5 * 1600 + 300)
    expect(moved.y).toBeGreaterThan(1100 + 150)
  }, 30_000)

  it('opens the frame menu on a right press', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, 'select(null)')
    const f = box(stage, 11)
    await page.mouse.click((f.left + f.right) / 2, (f.top + f.bottom) / 2, { button: 'right' })
    await page.waitForSelector('[role="menu"]', { timeout: 5000 })
    expect(await selected(page)).toEqual(['f11'])
    await page.keyboard.press('Escape')
    await page.waitForSelector('[role="menu"]', { hidden: true })
  }, 30_000)

  it('hands a frame back to the canvas once it is no longer in the DOM', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, "select('f20')")
    await sleep(300)
    expect(await drawn(page)).not.toContain('f20')
    await store(page, 'select(null)')
    await sleep(300)
    /* selected by the store, not woken by a press: drawn again */
    expect(await drawn(page)).toContain('f20')
  }, 30_000)

  it('gives every frame back to the DOM when the context is lost, and takes them again on restore', async (ctx) => {
    if (!webgl) ctx.skip()
    const before = { drawn: await drawn(page), shells: await shells(page) }
    const woken = (await page.evaluate(
      `import('/src/lib/liveFrames.ts').then(({ useLiveFrames }) => useLiveFrames.getState().woken.length)`,
    )) as number
    await page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>('canvas[data-stage-pictures]')!.getContext('webgl2')!
      const lose = gl.getExtension('WEBGL_lose_context')!
      ;(window as unknown as { lose: WEBGL_lose_context }).lose = lose
      lose.loseContext()
    })
    await sleep(300)
    expect(await drawn(page)).toEqual([])
    expect(await shells(page)).toBe(FRAMES - woken)
    /* every shell shows its <img> again (a woken FrameView without its document does too) */
    expect(await previews(page)).toBeGreaterThanOrEqual(FRAMES - woken)
    await page.evaluate(() => (window as unknown as { lose: WEBGL_lose_context }).lose.restoreContext())
    await page.waitForFunction(
      `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => useGpuPictures.getState().drawn.size === ${before.drawn.length})`,
      { timeout: 15_000 },
    )
    expect(await drawn(page)).toEqual(before.drawn)
    expect(await shells(page)).toBe(before.shells)
  }, 30_000)

  it('selects drawn frames with a marquee and a shift press, as it selects shells', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, 'select(null)')
    await sleep(200)
    /* from the empty stage right of the last column, row 1, to the middle of f22 */
    const row1 = box(stage, 15)
    const end = box(stage, 22)
    await page.mouse.move(stage.left + 1100, (row1.top + row1.bottom) / 2)
    await page.mouse.down()
    await page.mouse.move((end.left + end.right) / 2, (end.top + end.bottom) / 2, { steps: 8 })
    await page.mouse.up()
    await sleep(200)
    expect([...(await selected(page))].sort()).toEqual(['f14', 'f15', 'f22', 'f23'])
    expect(await drawn(page)).toContain('f28')
    const f = box(stage, 28)
    await page.keyboard.down('Shift')
    await page.mouse.click((f.left + f.right) / 2, (f.top + f.bottom) / 2)
    await page.keyboard.up('Shift')
    await sleep(200)
    expect([...(await selected(page))].sort()).toEqual(['f14', 'f15', 'f22', 'f23', 'f28'])
    await store(page, 'select(null)')
  }, 30_000)

  it("follows a peer's moves, hides, deletes, creations and an agent's stream", async (ctx) => {
    if (!webgl) ctx.skip()
    const frame = (id: string) => canvas.frames.find((f) => f.id === id)!
    const paper = await pixel(page, Math.round(stage.left + 1100), Math.round(box(stage, 0).top + 30))
    const centre = (i: number) => {
      const f = box(stage, i)
      return pixel(page, Math.round((f.left + f.right) / 2), Math.round((f.top + f.bottom) / 2))
    }
    expect(await drawn(page)).toEqual(expect.arrayContaining(['f2', 'f5', 'f6', 'f7']))
    /* frame:drag, as the room applies it: drawn at once at the new place */
    const f5 = box(stage, 5)
    await store(page, `patchFrameLocal('f5', { x: ${frame('f5').x + 400} })`)
    await sleep(50)
    expect(await pixel(page, Math.round(f5.right + 400 * 0.08 - 4), Math.round((f5.top + f5.bottom) / 2))).toEqual(
      PICTURE,
    )
    expect(await pixel(page, Math.round(f5.left + 4), Math.round((f5.top + f5.bottom) / 2))).toEqual(paper)
    await store(page, `patchFrameLocal('f5', { x: ${frame('f5').x} })`)
    /* hidden, deleted: neither drawn nor a shell, the paper where they were */
    await store(page, `upsertFrame({ ...useStore.getState().canvas.frames.find((f) => f.id === 'f6'), hidden: true })`)
    await store(page, "removeFrame('f7')")
    await sleep(200)
    expect(await drawn(page)).not.toContain('f6')
    expect(await drawn(page)).not.toContain('f7')
    expect(await shellIds(page)).not.toContain('f6')
    expect(await centre(6)).toEqual(paper)
    expect(await centre(7)).toEqual(paper)
    /* created by a peer, in a row of its own (column 0, under frames never woken) */
    await store(
      page,
      `upsertFrame({ ...useStore.getState().canvas.frames.find((f) => f.id === 'f3'), id: 'f40', x: 0, y: 5500 })`,
    )
    await page.waitForFunction(
      `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => useGpuPictures.getState().drawn.has('f40'))`,
      { timeout: 10_000 },
    )
    expect(await centre(40)).toEqual(PICTURE)
    /* streamed into by an agent: a live FrameView while it lasts */
    await store(page, "setStream('f2', { name: 'Agent', color: '#f0f' })")
    await sleep(200)
    expect(await drawn(page)).not.toContain('f2')
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 2"]'))).toBe(true)
    await store(page, "setStream('f2', null)")
    await sleep(300)
    expect(await drawn(page)).toContain('f2')
    await store(page, "removeFrame('f40')")
    await store(page, `upsertFrame(${JSON.stringify(frame('f6'))})`)
    await store(page, `upsertFrame(${JSON.stringify(frame('f7'))})`)
    await page.waitForFunction(
      `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => ['f6', 'f7'].every((id) => useGpuPictures.getState().drawn.has(id)))`,
      { timeout: 10_000 },
    )
  }, 30_000)

  /* A density change is emulated (setViewport's deviceScaleFactor), which
     moves devicePixelRatio at once but fires the resolution query late, so
     the camera is nudged as a person's next move would. What emulation
     cannot show: a real screen change, and a GPU's own drawing-buffer limits
     (SwiftShader takes 8192 px a side; real GPUs often 16384 or more, where
     the check is skipped). */
  it('draws at a new screen density, and gives every frame to the DOM past what the GPU allows', async (ctx) => {
    if (!webgl) ctx.skip()
    const nudge = async () => {
      await store(page, 'setViewport({ x: 21, y: 60, zoom: 0.08 })')
      await store(page, 'setViewport({ x: 20, y: 60, zoom: 0.08 })')
    }
    const backing = () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas[data-stage-pictures]')!
        const gl = c.getContext('webgl2')!
        return {
          width: c.width,
          height: c.height,
          css: c.clientWidth,
          maxView: (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[0]!,
        }
      })
    expect(await drawn(page)).toContain('f24')
    const f = box(stage, 24)
    const mid = { x: Math.round((f.left + f.right) / 2), y: Math.round((f.top + f.bottom) / 2) }
    try {
      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 })
      await nudge()
      await sleep(300)
      const two = await backing()
      expect(two.width).toBe(two.css * 2)
      expect(await drawn(page)).toContain('f24')
      for (const [i, c] of (await pixel(page, mid.x, mid.y)).entries())
        expect(Math.abs(c - PICTURE[i]!)).toBeLessThanOrEqual(2)
      const past = Math.ceil((two.maxView + 1) / two.css)
      if (past <= 8) {
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: past })
        await nudge()
        await sleep(300)
        expect(await drawn(page)).toEqual([])
        expect((await backing()).width).toBe(1)
        expect(await shells(page)).toBeGreaterThan(FRAMES / 2)
      }
    } finally {
      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })
      await nudge()
    }
    await page.waitForFunction(
      `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => useGpuPictures.getState().drawn.has('f24'))`,
      { timeout: 15_000 },
    )
    expect((await backing()).width).toBe(1600)
  }, 60_000)
})

/* Names are measured where the DOM lays its title out: at the screen's
   density (zoom for device scale), not at the CSS size, whose advances
   differ from it by pixels at a fractional density. A guard only: the
   density setViewport emulates does not shape text at the device size, so
   here the CSS-size measure matches too; a browser started with
   --force-device-scale-factor shows the difference. */
describe.skipIf(!findBrowserPath())('GPU picture names', () => {
  let browser: TestBrowser
  beforeAll(async () => {
    browser = await openBrowser()
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })

  for (const dpr of [1.25, 1.5, 2])
    it(`measures a name as wide as the title at ${dpr}x`, async () => {
      const page = await browser.newPage()
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: dpr })
      await page.goto(fixtureUrl('pages.html'))
      const r = (await page.evaluate(`import('/src/lib/gpuLabels.ts').then(({ NameAtlas }) => {
        const names = ['Frame 1', 'Checkout, step 2 of 3', 'Linh joined (Linh)', 'Onboarding / Welcome back, Ana', 'WWW iii lll 0123456789']
        const span = document.createElement('span')
        span.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font:600 12px sans-serif'
        document.body.append(span)
        const atlas = new NameAtlas()
        atlas.build(names, { fontStyle: 'normal', fontWeight: '600', fontSize: 12, fontFamily: 'sans-serif', letterSpacing: 0, color: '#000', lineHeight: 16, baseline: 12 }, devicePixelRatio, 4096)
        let atlasOff = 0
        for (const n of names) {
          span.textContent = n
          atlasOff = Math.max(atlasOff, Math.abs(span.getBoundingClientRect().width - atlas.cells.get(n).advance))
        }
        span.remove()
        return { dpr: devicePixelRatio, atlasOff }
      })`)) as { dpr: number; atlasOff: number }
      await page.close()
      expect(r.dpr).toBe(dpr)
      expect(r.atlasOff).toBeLessThan(0.1)
    }, 30_000)
})

/* A phone in the reviewer layout (tests/phoneReviewBrowser.test.ts) over
   drawn frames: a finger pans from one in the Hand and the Comment tool, a
   tap selects it, a long hold opens its menu, as on a shell. */
describe.skipIf(!findBrowserPath())('GPU pictures on a phone', () => {
  let browser: TestBrowser
  let page: Page
  let webgl = false
  let stage = { left: 0, top: 0 }
  const menuOpen = () => page.evaluate(() => !!document.querySelector('[role="menu"]'))
  const viewport = () =>
    page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => useStore.getState().viewport)`) as Promise<{
      x: number
      y: number
    }>
  const centre = (i: number) => {
    const f = box(stage, i)
    return { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 }
  }
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('doop:full-ui', 'off')
      localStorage.setItem('doop:gpu', 'force')
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return
        const meta = document.createElement('meta')
        meta.name = 'viewport'
        meta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
        document.head.append(meta)
      })
    })
    await page.goto(fixtureUrl('canvasClipboard.html'))
    webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
    await servePreviews(page)
    type Harness = { canvasClipboardHarness: { seed: (frames: Frame[]) => void } }
    await page.waitForFunction(
      () => !!(window as unknown as Harness).canvasClipboardHarness && !!document.querySelector('.stage'),
    )
    /* the harness's canvas has no pages, so the frames go on its default one */
    const frames = canvas.frames.map(({ pageId: _page, ...frame }) => frame)
    await page.evaluate((list) => (window as unknown as Harness).canvasClipboardHarness.seed(list), frames)
    await page.evaluate(
      `import('/src/lib/store.ts').then(({ useStore }) => useStore.setState({ uiHidden: false, viewport: { x: 20, y: 60, zoom: 0.08 } }))`,
    )
    stage = await page.evaluate(() => {
      const r = document.querySelector('.stage')!.getBoundingClientRect()
      return { left: r.left, top: r.top }
    })
    if (webgl)
      await page.waitForFunction(
        `import('/src/lib/gpuPictures.ts').then(({ useGpuPictures }) => ['f2', 'f8', 'f16', 'f17'].every((id) => useGpuPictures.getState().drawn.has(id)))`,
        { timeout: 30_000 },
      )
  }, 60_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  /* columns 0-2 are on this screen; a press wakes its frame, and the column
     under a woken frame goes to shells, so each test takes a frame no earlier
     one has put under a woken one */
  for (const [tool, i] of [
    ['hand', 16],
    ['comment', 17],
  ] as const)
    it(`pans with a finger dragged from a drawn frame in the ${tool} tool`, async (ctx) => {
      if (!webgl) ctx.skip()
      await store(page, `setTool('${tool}')`)
      expect(await drawn(page)).toContain(`f${i}`)
      const at = centre(i)
      const before = await viewport()
      await page.touchscreen.touchStart(at.x, at.y)
      for (let k = 1; k <= 8; k++) {
        await sleep(30)
        await page.touchscreen.touchMove(at.x + k * 6, at.y + k * 5)
      }
      await page.touchscreen.touchEnd()
      await sleep(300)
      const after = await viewport()
      expect(after.x).toBeGreaterThan(before.x + 30)
      expect(await selected(page)).toEqual([])
      expect(await menuOpen()).toBe(false)
      await store(page, 'setViewport({ x: 20, y: 60, zoom: 0.08 })')
      await sleep(200)
    }, 20_000)

  it('selects a drawn frame on a tap in the comment tool', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, "setTool('comment')")
    expect(await drawn(page)).toContain('f2')
    const at = centre(2)
    await page.touchscreen.tap(at.x, at.y)
    await sleep(400)
    expect(await selected(page)).toEqual(['f2'])
    await store(page, 'select(null)')
  }, 20_000)

  it('opens the frame menu on a drawn frame only after the long hold', async (ctx) => {
    if (!webgl) ctx.skip()
    await store(page, "setTool('hand')")
    expect(await drawn(page)).toContain('f8')
    const at = centre(8)
    await page.touchscreen.touchStart(at.x, at.y)
    await sleep(1000)
    expect(await menuOpen()).toBe(false)
    await page.waitForSelector('[role="menu"]', { timeout: TOUCH_HOLD_MS + 2000 })
    await page.touchscreen.touchEnd()
    expect(await selected(page)).toEqual(['f8'])
  }, 20_000)
})
