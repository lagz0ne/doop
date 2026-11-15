import { inflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import type { Canvas, Frame } from '../shared/types'

/* Frame shells far from the view leave the render tree (src/lib/shellCull.ts):
   200 desktop frames, 8 per row, previews served as a solid blue picture, so
   a shell that is painted with its picture is blue on screen and one that is
   not is white. */

declare global {
  interface Window {
    seedPages: (canvas: Canvas) => void
  }
}

const FRAMES = 200
const canvas: Canvas = {
  id: 'c',
  name: 'Big page',
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
    html: `<!doctype html><html><body><h1>Screen ${i}</h1></body></html>`,
    createdAt: 0,
    updatedAt: 1,
    updatedBy: 'User',
  })),
  createdAt: 0,
  updatedAt: 0,
}
/** frame 199, the last one, sits at (11200, 26400) */
const LAST = { x: 11200, y: 26400 }
const BLUE = [51, 102, 204]
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="225"><rect width="100%" height="100%" fill="rgb(${BLUE.join(',')})"/></svg>`

/** call a store action in the page (a string, so the test transform leaves the import alone) */
const store = (page: Page, call: string) =>
  page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => { useStore.getState().${call} })`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function camera(page: Page, viewport: { x: number; y: number; zoom: number }) {
  await store(page, `setViewport(${JSON.stringify(viewport)})`)
  await sleep(400)
}
const shell = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-frame-shell="${id}"]`)
    return el ? { hidden: el.hidden, rendered: el.checkVisibility() } : null
  }, id)

/** the colour painted at one screen point, from a 1×1 PNG screenshot: a
 *  single pixel's row is unchanged by every PNG filter, so the inflated
 *  image data is its filter byte and then the pixel */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = Buffer.from(await page.screenshot({ clip: { x, y, width: 1, height: 1 }, type: 'png' }))
  const data: Buffer[] = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') data.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  return [...inflateSync(Buffer.concat(data)).subarray(1, 4)]
}

describe.skipIf(!findBrowserPath())('frame shells far from the view', () => {
  let browser: TestBrowser
  let page: Page
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000 })
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      if (/^\/i\/f\d+\.webp$/.test(new URL(request.url()).pathname))
        void request.respond({ status: 200, contentType: 'image/svg+xml', body: PICTURE })
      else void request.continue()
    })
    await page.goto(fixtureUrl('pages.html'))
    await page.waitForFunction(() => typeof window.seedPages === 'function')
    await page.evaluate((c) => window.seedPages(c), canvas)
    await sleep(600)
  }, 120_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('takes a far shell out of the render tree and leaves its element in place', async () => {
    await camera(page, { x: 0, y: 0, zoom: 0.25 })
    expect(await shell(page, 'f1')).toEqual({ hidden: false, rendered: true })
    expect(await shell(page, 'f199')).toEqual({ hidden: true, rendered: false })
    const counts = await page.evaluate(() => ({
      shells: document.querySelectorAll('[data-frame-shell]').length,
      hidden: document.querySelectorAll('[data-frame-shell][hidden]').length,
    }))
    expect(counts.shells).toBe(FRAMES)
    expect(counts.hidden).toBeGreaterThan(FRAMES / 2)
  }, 30_000)

  it('puts a shell back in the same task as the camera reaches it, and takes out the ones it leaves far behind', async () => {
    await camera(page, { x: 0, y: 0, zoom: 0.25 })
    const atLast = { x: -LAST.x * 0.25 + 100, y: -LAST.y * 0.25 + 100, zoom: 0.25 }
    const jump = await page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => {
      useStore.getState().setViewport(${JSON.stringify(atLast)})
      const at = (id) => document.querySelector('[data-frame-shell="' + id + '"]').hidden
      return { last: at('f199'), first: at('f0') }
    })`)
    expect(jump).toEqual({ last: false, first: true })
    await sleep(400)
    /* 2200 px on, frame 199 is past the keep margin but not the drop one: it
       stays while the camera moves and goes once it rests */
    const moved = await page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => {
      useStore.getState().setViewport(${JSON.stringify({ ...atLast, x: atLast.x - 2200 })})
      return document.querySelector('[data-frame-shell="f199"]').hidden
    })`)
    expect(moved).toBe(false)
    await sleep(400)
    expect((await shell(page, 'f199'))?.hidden).toBe(true)
  }, 30_000)

  it('has the picture loaded on every shell the camera shows during a fast pan into frames never seen', async () => {
    /* the camera starts 2.5 view widths left of the last row, waits for the
       frames it shows, then pans right at 40 screen px an animation frame
       (2400 px/s) until frame 199 is in the middle. In every animation frame
       each shell on screen must be in the tree with its picture loaded. */
    const zoom = 0.25
    const startX = 1600 * 2.5 - LAST.x * zoom
    const y = 300 - LAST.y * zoom
    await camera(page, { x: startX, y, zoom })
    await sleep(600)
    const misses = (await page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => new Promise((resolve) => {
      const misses = []
      let x = ${startX}
      let steps = 0
      const end = ${800 - (LAST.x + 720) * zoom}
      ;(function step() {
        for (const el of document.querySelectorAll('[data-frame-shell]')) {
          const r = el.getBoundingClientRect()
          if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue
          const img = el.querySelector('img')
          if (el.hidden || !img || !img.complete || !img.naturalWidth) misses.push({ step: steps, id: el.dataset.frameShell, hidden: el.hidden })
        }
        if (x <= end) return resolve({ misses, steps })
        x = Math.max(end, x - 40)
        steps++
        useStore.getState().setViewport({ x, y: ${y}, zoom: ${zoom} })
        requestAnimationFrame(step)
      })()
    }))`)) as { misses: unknown[]; steps: number }
    expect(misses.steps).toBeGreaterThan(50)
    expect(misses.misses).toEqual([])
    /* and it is painted: blue in the middle of frame 199, not the white of its surface */
    await sleep(300)
    expect(await pixel(page, 800, 300 + 450 * zoom)).toEqual(BLUE)
  }, 30_000)

  it('draws a far frame selected from afar, and gives it back as a hidden shell', async () => {
    await camera(page, { x: 0, y: 0, zoom: 0.25 })
    expect((await shell(page, 'f199'))?.hidden).toBe(true)
    /* the Layers panel selects it: it becomes a FrameView, which culling never touches */
    await store(page, "select('f199')")
    await sleep(300)
    expect(await shell(page, 'f199')).toBeNull()
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 199"]'))).toBe(true)
    /* let go of, it is a shell again, still out of the tree, and back in it when the camera goes there */
    await store(page, 'select(null)')
    await sleep(300)
    expect(await shell(page, 'f199')).toEqual({ hidden: true, rendered: false })
    await camera(page, { x: -LAST.x * 0.25 + 100, y: -LAST.y * 0.25 + 100, zoom: 0.25 })
    expect(await shell(page, 'f199')).toEqual({ hidden: false, rendered: true })
  }, 30_000)

  it('culls nothing with the switch off', async () => {
    await page.evaluate(() => localStorage.setItem('doop:cull-shells', 'off'))
    await page.reload()
    await page.waitForFunction(() => typeof window.seedPages === 'function')
    await page.evaluate((c) => window.seedPages(c), canvas)
    await camera(page, { x: 0, y: 0, zoom: 0.25 })
    expect(await page.evaluate(() => document.querySelectorAll('[data-frame-shell][hidden]').length)).toBe(0)
    await page.evaluate(() => localStorage.removeItem('doop:cull-shells'))
  }, 30_000)
})
