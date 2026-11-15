import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import type { Canvas, Frame } from '../shared/types'

/* With localStorage['doop:zoom-pictures'] = 'on', a zoom shows each live
   frame's picture in place of its document until the camera settles, except
   on a frame someone works in (zoomPictures.ts). Off, nothing changes. */

declare global {
  interface Window {
    seedPages: (canvas: Canvas) => void
  }
}

const FRAMES = 3
const canvas: Canvas = {
  id: 'c',
  name: 'Zoom pictures',
  pages: [{ id: 'p', name: 'Main' }],
  frames: Array.from({ length: FRAMES }, (_, i): Frame => ({
    id: `f${i}`,
    canvasId: 'c',
    pageId: 'p',
    name: `Frame ${i}`,
    x: i * 500,
    y: 0,
    width: 400,
    height: 300,
    html: `<body style="margin:0;background:#3a6"><h1>Frame ${i}</h1></body>`,
    createdAt: 0,
    updatedAt: 1,
    updatedBy: 'User',
  })),
  createdAt: 0,
  updatedAt: 0,
}

/* a 2×2 PNG for every preview the frames ask for (the fixture has no renderer) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPj/n4GBgYGJAQoYGQA9GwIEmBt0WQAAAABJRU5ErkJggg==',
  'base64',
)

const store = (page: Page, call: string) =>
  page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => { useStore.getState().${call} })`)
const settle = () => new Promise((r) => setTimeout(r, 600))

/** each frame's iframe visibility and its picture's, '-' when it has none */
const looks = (page: Page) =>
  page.evaluate((n) => {
    const out: Record<string, { iframe: string; picture: string }> = {}
    for (let i = 0; i < n; i++) {
      const iframe = document.querySelector<HTMLElement>(`iframe[title="Frame ${i}"]`)
      const wrapper = iframe?.parentElement?.querySelector('[data-doop-frame-preview]')?.parentElement
      out[`f${i}`] = {
        iframe: iframe ? iframe.style.visibility || 'shown' : '-',
        picture: wrapper ? wrapper.style.visibility || 'shown' : '-',
      }
    }
    return out
  }, FRAMES)

async function open(browser: TestBrowser, switchOn: boolean): Promise<Page> {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  /* the pages share one origin's storage: each says what it wants */
  await page.evaluateOnNewDocument((on) => {
    if (on) localStorage.setItem('doop:zoom-pictures', 'on')
    else localStorage.removeItem('doop:zoom-pictures')
  }, switchOn)
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/i/'))
      void request.respond({ status: 200, contentType: 'image/png', body: PNG })
    else void request.continue()
  })
  await page.goto(fixtureUrl('pages.html'))
  await page.waitForFunction(() => typeof window.seedPages === 'function')
  await page.evaluate((c) => window.seedPages(c), canvas)
  await store(page, 'setViewport({ x: 40, y: 40, zoom: 1 })')
  await settle()
  return page
}

describe.skipIf(!findBrowserPath())('pictures in place of documents while zooming', () => {
  let browser: TestBrowser
  beforeAll(async () => {
    browser = await openBrowser()
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })

  it('switched on: shows the pictures during a zoom, the documents after it, and leaves a selected frame alone', async () => {
    const page = await open(browser, true)
    /* at rest every frame shows its document, its loaded picture hidden under it */
    await page.waitForFunction(
      (n) =>
        Array.from({ length: n }, (_, i) => {
          const iframe = document.querySelector(`iframe[title="Frame ${i}"]`)
          const img = iframe?.parentElement?.querySelector<HTMLImageElement>('[data-doop-frame-preview] img')
          return !!img && img.complete && img.naturalWidth > 0
        }).every(Boolean),
      { timeout: 15_000 },
      FRAMES,
    )
    const resting = { iframe: 'shown', picture: 'hidden' }
    expect(await looks(page)).toEqual({ f0: resting, f1: resting, f2: resting })

    /* a selected frame is someone's work: it keeps its document */
    await store(page, "select('f1')")
    await settle()
    await store(page, 'setViewport({ x: 40, y: 40, zoom: 0.9 })')
    const swapped = { iframe: 'hidden', picture: 'visible' }
    expect(await looks(page)).toEqual({ f0: swapped, f1: resting, f2: swapped })
    /* the gesture goes on: still pictures */
    await store(page, 'setViewport({ x: 40, y: 40, zoom: 0.8 })')
    expect(await looks(page)).toEqual({ f0: swapped, f1: resting, f2: swapped })

    await settle()
    expect(await looks(page)).toEqual({ f0: resting, f1: resting, f2: resting })

    /* a pan alone swaps nothing */
    await store(page, 'setViewport({ x: 140, y: 60, zoom: 0.8 })')
    expect(await looks(page)).toEqual({ f0: resting, f1: resting, f2: resting })
    await settle()
    await page.close()
  }, 60_000)

  it('switched off: a zoom changes nothing on the frames', async () => {
    const page = await open(browser, false)
    await page.waitForFunction(
      (n) => document.querySelectorAll('iframe[data-doop-frame]').length === n,
      { timeout: 15_000 },
      FRAMES,
    )
    /* once shown, a document has no picture mounted with it at all */
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('iframe[data-doop-frame]')].every(
          (iframe) => !iframe.parentElement?.querySelector('[data-doop-frame-preview]'),
        ),
      { timeout: 15_000 },
    )
    const plain = { iframe: 'shown', picture: '-' }
    expect(await looks(page)).toEqual({ f0: plain, f1: plain, f2: plain })
    await store(page, 'setViewport({ x: 40, y: 40, zoom: 0.9 })')
    expect(await looks(page)).toEqual({ f0: plain, f1: plain, f2: plain })
    await settle()
    expect(await looks(page)).toEqual({ f0: plain, f1: plain, f2: plain })
    await page.close()
  }, 60_000)
})
