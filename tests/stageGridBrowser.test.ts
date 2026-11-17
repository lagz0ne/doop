import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import { DOT_PERIOD, GRID_ZOOM_DRIFT } from '../src/lib/stageGrid'
import type { Canvas } from '../shared/types'

/* The stage's dot grid and pixel grid keep the period they were painted at
   while the zoom moves (the transform carries the ratio), and get the exact
   period once the camera rests (stageGrid.ts). */

declare global {
  interface Window {
    seedPages: (canvas: Canvas) => void
  }
}

const canvas: Canvas = {
  id: 'c',
  name: 'Grid',
  pages: [{ id: 'p', name: 'Main' }],
  frames: [
    {
      id: 'f0',
      canvasId: 'c',
      pageId: 'p',
      name: 'Frame',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      html: '<body>grid</body>',
      createdAt: 0,
      updatedAt: 1,
      updatedBy: 'User',
    },
  ],
  createdAt: 0,
  updatedAt: 0,
}

const setViewport = (page: Page, vp: { x: number; y: number; zoom: number }) =>
  page.evaluate(
    `window.testImport('/src/lib/store.ts').then(({ useStore }) => { useStore.getState().setViewport(${JSON.stringify(vp)}) })`,
  )
const grids = (page: Page) =>
  page.evaluate(() => {
    const divs = [...document.querySelectorAll<HTMLElement>('.stage div')]
    const dots = divs.find((d) => d.className.includes('radial-gradient'))
    const pixels = document.querySelector<HTMLElement>('[data-pixel-grid="paper"]')
    return {
      dots: { size: dots?.style.backgroundSize, width: dots?.style.width, transform: dots?.style.transform },
      pixels: { hidden: pixels?.hidden, size: pixels?.style.backgroundSize, transform: pixels?.style.transform },
    }
  })
const rest = () => new Promise((r) => setTimeout(r, 400))
/** the numbers in a style value (the browser keeps six significant digits) */
const nums = (value: string | undefined) => (value?.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number)
const close = (value: string | undefined, expected: number[]) => {
  const got = nums(value)
  expect(got).toHaveLength(expected.length)
  got.forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 3))
}

describe.skipIf(!findBrowserPath())('the stage grids while zooming', () => {
  let browser: TestBrowser
  let page: Page
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })
    await page.goto(fixtureUrl('pages.html'))
    await page.waitForFunction(() => typeof window.seedPages === 'function')
    await page.evaluate((c) => window.seedPages(c), canvas)
    await setViewport(page, { x: 0, y: 0, zoom: 0.5 })
    await rest()
  }, 60_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('paints the dot grid at the exact zoom at rest', async () => {
    const { dots } = await grids(page)
    close(dots.size, [13, 13])
    close(dots.width, [100, 13])
    expect(dots.transform).toBe('translate(-13px, -13px)')
  }, 30_000)

  it('scales the dot grid for a zoom step inside the band, and paints it exactly at rest', async () => {
    const zoom = 0.5 * (1 + (GRID_ZOOM_DRIFT - 1) / 2)
    await setViewport(page, { x: 0, y: 0, zoom })
    const moving = (await grids(page)).dots
    close(moving.size, [13, 13])
    close(moving.width, [100, 13])
    expect(moving.transform).toContain('scale(')
    close(moving.transform?.replace(/^.*scale/, ''), [zoom / 0.5])
    await rest()
    const exact = DOT_PERIOD * zoom
    const still = (await grids(page)).dots
    close(still.size, [exact, exact])
    close(still.width, [100, exact])
    expect(still.transform).not.toContain('scale')
  }, 30_000)

  it('paints again when a zoom leaves the band', async () => {
    await setViewport(page, { x: 0, y: 0, zoom: 1 })
    await rest()
    /* zooming out a grid is never shrunk: it is painted one band below */
    await setViewport(page, { x: 0, y: 0, zoom: 0.95 })
    const below = DOT_PERIOD * (0.95 / GRID_ZOOM_DRIFT)
    close((await grids(page)).dots.size, [below, below])
    /* zooming in past the band it is painted at the camera's zoom */
    await setViewport(page, { x: 0, y: 0, zoom: 1.5 })
    close((await grids(page)).dots.size, [DOT_PERIOD * 1.5, DOT_PERIOD * 1.5])
    await rest()
  }, 30_000)

  it('leaves the period alone on a pan', async () => {
    await setViewport(page, { x: 0, y: 0, zoom: 1 })
    await rest()
    await setViewport(page, { x: 10, y: 20, zoom: 1 })
    const { dots } = await grids(page)
    close(dots.size, [DOT_PERIOD, DOT_PERIOD])
    expect(dots.transform).toBe('translate(-16px, -6px)')
  }, 30_000)

  it('treats the pixel grid the same way', async () => {
    await setViewport(page, { x: 0, y: 0, zoom: 4 })
    await rest()
    expect(await grids(page)).toMatchObject({
      pixels: { hidden: false, size: '4px 4px', transform: 'translate(-4px, -4px)' },
    })
    await setViewport(page, { x: 0, y: 0, zoom: 4.1 })
    const moving = (await grids(page)).pixels
    expect(moving.size).toBe('4px 4px')
    expect(moving.transform).toContain('scale(')
    await rest()
    const still = (await grids(page)).pixels
    close(still.size, [4.1, 4.1])
    close(still.transform, [-4.1, -4.1])
  }, 30_000)
})
