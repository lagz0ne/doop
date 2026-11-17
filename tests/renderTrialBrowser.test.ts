import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import { renderReportSchema } from '../shared/renderTrialSchema'
import type { Canvas, Frame } from '../shared/types'

/* The render trial (renderTrialClient.ts) in Chromium: a load with nothing
   set gets its levels from the trial and keeps them in storage, an explicit
   key wins, the Stage's camera gestures become report rows, and a hidden
   page sends them in a report that says nothing about the canvas. */

declare global {
  interface Window {
    seedPages: (canvas: Canvas) => void
    beacons: { url: string; body: string }[]
  }
}

/* ids and names a report must never carry */
const SECRET = 'secretive'
const COLUMNS = 10
const canvas: Canvas = {
  id: `${SECRET}-canvas`,
  name: `A ${SECRET} canvas`,
  pages: [{ id: `${SECRET}-page`, name: `${SECRET} page` }],
  frames: Array.from({ length: 60 }, (_, i): Frame => ({
    id: `${SECRET}-frame-${i}`,
    canvasId: `${SECRET}-canvas`,
    pageId: `${SECRET}-page`,
    name: `${SECRET} frame ${i}`,
    x: (i % COLUMNS) * 150,
    y: Math.floor(i / COLUMNS) * 150,
    width: 120,
    height: 100,
    html: `<body style="margin:0;background:#3a6"><h1>${SECRET} ${i}</h1></body>`,
    createdAt: 0,
    updatedAt: 1,
    updatedBy: 'User',
  })),
  createdAt: 0,
  updatedAt: 0,
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPj/n4GBgYGJAQoYGQA9GwIEmBt0WQAAAABJRU5ErkJggg==',
  'base64',
)

const store = (page: Page, call: string) =>
  page.evaluate(`window.testImport('/src/lib/store.ts').then(({ useStore }) => { useStore.getState().${call} })`)
const settle = () => new Promise((r) => setTimeout(r, 600))

async function open(browser: TestBrowser, keys: Record<string, string>): Promise<Page> {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  /* after browser.ts's script, which turns the trial off for every other test */
  await page.evaluateOnNewDocument((set) => {
    for (const key of ['doop:render-trial', 'doop:render-trial-data', 'doop:gpu', 'doop:zoom-pictures'])
      localStorage.removeItem(key)
    for (const [key, value] of Object.entries(set)) localStorage.setItem(key, value)
    /* the fixture server has no telemetry route: keep what would be sent */
    window.beacons = []
    navigator.sendBeacon = (url, body) => {
      window.beacons.push({ url: String(url), body: String(body) })
      return true
    }
  }, keys)
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/i/'))
      void request.respond({ status: 200, contentType: 'image/png', body: PNG })
    else void request.continue()
  })
  await page.goto(fixtureUrl('pages.html'))
  await page.waitForFunction(() => typeof window.seedPages === 'function')
  await page.evaluate((c) => window.seedPages(c), canvas)
  return page
}

const decision = (page: Page) =>
  page.evaluate(`window.testImport('/src/lib/renderTrialClient.ts').then((m) => m.renderTrial())`) as Promise<{
    active: boolean
    gpu: { level: string; reason: string; mode: string }
    zoomPictures: { level: string; reason: string }
  }>

/** A camera gesture of `steps` changes, one per animation frame, then a
 *  wait past its end. */
async function gesture(page: Page, steps: number, zoomFrom: number, zoomTo: number, dx: number) {
  /* a string, so the test runner does not rewrite the page's import() */
  await page.evaluate(`window.testImport('/src/lib/store.ts').then(async ({ useStore }) => {
    const start = useStore.getState().viewport
    for (let i = 1; i <= ${steps}; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      const zoom = ${zoomFrom} + (${zoomTo - zoomFrom} * i) / ${steps}
      useStore.getState().setViewport({ x: start.x + ${dx} * i, y: start.y, zoom })
    }
    await new Promise((r) => setTimeout(r, 400))
  })`)
}

const sent = (page: Page) => page.evaluate(() => window.beacons.length)

function hide(page: Page) {
  return page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe.skipIf(!findBrowserPath())('the render trial', () => {
  let browser: TestBrowser
  beforeAll(async () => {
    browser = await openBrowser()
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })

  it('assigns a load with nothing set, records its gestures and reports them on hide', async () => {
    const page = await open(browser, {})
    /* zoomed out past live documents: every frame in view is culled, a heavy scene */
    await store(page, 'setViewport({ x: 100, y: 100, zoom: 0.2 })')
    await settle()

    const d = await decision(page)
    expect(d.active).toBe(true)
    expect(d.zoomPictures.reason).toBe('explore')
    /* the headless shell's WebGL is software: the GPU layer is not for it */
    expect(d.gpu).toEqual({ level: 'off', reason: 'ineligible', mode: 'off' })
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('doop:render-trial-data'))) ?? 'null')
    expect(stored).toMatchObject({ v: 1, epoch: 1, failures: 0, probe: { hardware: false } })
    expect(stored.zoomPictures.on.assigned + stored.zoomPictures.off.assigned).toBe(1)
    expect(stored.gpu.on.assigned + stored.gpu.off.assigned).toBe(0)

    /* a pan over the culled grid, then a zoom in over it to live documents */
    await gesture(page, 20, 0.2, 0.2, -15)
    await store(page, 'setViewport({ x: 40, y: 40, zoom: 1 })')
    await settle()
    await gesture(page, 20, 1, 0.8, 0)
    /* nothing goes out while the page is in view (the next report is minutes away) */
    expect(await sent(page)).toBe(0)

    await hide(page)
    const beacons = await page.evaluate(() => window.beacons)
    expect(beacons).toHaveLength(1)
    expect(beacons[0]!.url).toBe('/api/telemetry/render')
    const report = JSON.parse(beacons[0]!.body)
    expect(renderReportSchema.safeParse(report).success).toBe(true)
    expect(report.gpu).toEqual({ level: 'off', reason: 'ineligible' })
    expect(report.zoomPictures).toEqual({ level: d.zoomPictures.level, reason: 'explore' })
    expect(report.env.frames).toBe('50-99')
    expect(report.env.width % 100).toBe(0)
    const kinds = report.rows.map(
      (r: { kind: string; stratum: string; live: boolean }) => `${r.kind}/${r.stratum}/${r.live}`,
    )
    expect(kinds).toContain('pan/heavy/false')
    expect(kinds.some((k: string) => k.startsWith('zoom/') && k.endsWith('/true'))).toBe(true)
    for (const row of report.rows) expect(row.frames).toBeGreaterThan(0)
    /* nothing of the canvas: no ids, no names, no HTML */
    expect(beacons[0]!.body.toLowerCase()).not.toContain(SECRET)
    expect(Object.keys(report).sort()).toEqual(['env', 'epoch', 'gpu', 'rows', 'v', 'verdicts', 'zoomPictures'])

    /* the zoom over live frames was judged at the level the load got */
    const after = JSON.parse((await page.evaluate(() => localStorage.getItem('doop:render-trial-data'))) ?? 'null')
    expect(after.zoomPictures[d.zoomPictures.level].gestures).toBeGreaterThanOrEqual(1)

    /* sent once: a second hide has nothing new */
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    expect(await sent(page)).toBe(1)
    await page.close()
  }, 60_000)

  it('lets an explicit key decide, and still measures', async () => {
    const page = await open(browser, { 'doop:zoom-pictures': 'on', 'doop:gpu': 'off' })
    await store(page, 'setViewport({ x: 40, y: 40, zoom: 1 })')
    await settle()
    expect(await decision(page)).toEqual({
      active: true,
      gpu: { level: 'off', reason: 'override', mode: 'off' },
      zoomPictures: { level: 'on', reason: 'override' },
    })
    await gesture(page, 12, 1, 0.9, 0)
    await hide(page)
    const beacons = await page.evaluate(() => window.beacons)
    expect(beacons).toHaveLength(1)
    const report = JSON.parse(beacons[0]!.body)
    expect(report.zoomPictures).toEqual({ level: 'on', reason: 'override' })
    /* an override teaches the trial nothing */
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('doop:render-trial-data'))) ?? 'null')
    expect(stored.zoomPictures.on.gestures + stored.zoomPictures.off.gestures).toBe(0)
    expect(stored.zoomPictures.on.assigned + stored.zoomPictures.off.assigned).toBe(0)
    await page.close()
  }, 60_000)

  it('switched off: the experiments are off and nothing is measured or sent', async () => {
    const page = await open(browser, { 'doop:render-trial': 'off' })
    await store(page, 'setViewport({ x: 40, y: 40, zoom: 1 })')
    await settle()
    expect(await decision(page)).toEqual({
      active: false,
      gpu: { level: 'off', reason: 'off', mode: 'off' },
      zoomPictures: { level: 'off', reason: 'off' },
    })
    await gesture(page, 12, 1, 0.9, 0)
    await hide(page)
    expect(await sent(page)).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('doop:render-trial-data'))).toBeNull()
    await page.close()
  }, 60_000)
})
