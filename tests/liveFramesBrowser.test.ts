import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import { MAX_LIVE } from '../src/lib/liveFrames'
import type { Canvas, Frame } from '../shared/types'

/* Viewport culling on a big page: 200 desktop frames laid out 8 per row, the
   shape of a real product canvas. Only frames near the camera get a live
   iframe; the rest show their preview image. The last test logs a before /
   after measurement (culling off via localStorage['doop:cull']). */

declare global {
  interface Window {
    seedPages: (canvas: Canvas) => void
  }
}

/** a screen-like document: header, side nav, a grid of cards, a table */
function screenHtml(i: number): string {
  const cards = Array.from(
    { length: 12 },
    (_, c) =>
      `<div class="card"><b>Card ${c + 1}</b><p>Frame ${i}: a realistic paragraph of copy that wraps over a few lines so layout has work to do.</p><button>Open</button></div>`,
  ).join('')
  const rows = Array.from(
    { length: 10 },
    (_, r) => `<tr><td>Row ${r + 1}</td><td>${(r * 37) % 100}%</td><td>Status</td><td><button>Edit</button></td></tr>`,
  ).join('')
  return `<!doctype html><html><head><style>
    body{margin:0;font:14px/1.4 sans-serif;width:1440px;height:900px;display:grid;grid-template-columns:220px 1fr}
    nav{background:#f3f3f1;padding:16px}nav a{display:block;padding:8px;border-radius:4px}
    main{padding:24px;overflow:hidden}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .card{border:1px solid #ddd;border-radius:6px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    table{width:100%;border-collapse:collapse;margin-top:16px}td{border-bottom:1px solid #eee;padding:6px}
  </style></head><body><nav>${'<a>Item</a>'.repeat(8)}</nav><main><h1>Screen ${i}</h1><div class="grid">${cards}</div><table>${rows}</table></main></body></html>`
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
    html: screenHtml(i),
    createdAt: 0,
    updatedAt: 1,
    updatedBy: 'User',
  })),
  createdAt: 0,
  updatedAt: 0,
}

const iframes = (page: Page) => page.evaluate(() => document.querySelectorAll('iframe[data-doop-frame]').length)
/** call a store action in the page (a string, so the test transform leaves the import alone) */
const store = (page: Page, call: string) =>
  page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => { useStore.getState().${call} })`)
/** pan/zoom the camera the way the zoom controls do, then let culling settle */
async function camera(page: Page, viewport: { x: number; y: number; zoom: number }) {
  await store(page, `setViewport(${JSON.stringify(viewport)})`)
  await new Promise((r) => setTimeout(r, 400))
}

describe.skipIf(!findBrowserPath())('viewport culling on a 200-frame page', () => {
  let browser: TestBrowser
  let page: Page
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(fixtureUrl('pages.html'))
    await page.waitForFunction(() => typeof window.seedPages === 'function')
    await page.evaluate((c) => window.seedPages(c), canvas)
    await new Promise((r) => setTimeout(r, 600))
  }, 120_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('keeps only the frames near a 100% camera live', async () => {
    await camera(page, { x: 0, y: 0, zoom: 1 })
    const n = await iframes(page)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(MAX_LIVE)
  }, 30_000)

  it('shows previews, not documents, when zoomed out past reading', async () => {
    await camera(page, { x: 0, y: 0, zoom: 0.08 })
    expect(await iframes(page)).toBe(0)
    expect(await page.evaluate(() => document.querySelectorAll('[data-doop-frame-preview]').length)).toBe(FRAMES)
  }, 30_000)

  it('gives a selected frame its document at any zoom', async () => {
    await store(page, "select('f42')")
    await new Promise((r) => setTimeout(r, 200))
    expect(await iframes(page)).toBe(1)
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 42"]'))).toBe(true)
  }, 30_000)

  it('brings frames back to life where the camera goes', async () => {
    await store(page, 'select(null)')
    // frame 199 sits at (11200, 26400)
    await camera(page, { x: -11200 + 50, y: -26400 + 50, zoom: 1 })
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 199"]'))).toBe(true)
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 0"]'))).toBe(false)
  }, 30_000)

  /* Culled frames are FrameShells: no handlers of their own. A press wakes
     the shell into a FrameView before it is delivered. */
  const frameAt = (page: Page, id: string) =>
    page.evaluate(
      `import('/src/lib/store.ts').then(({ useStore }) => { const s = useStore.getState(); const f = s.canvas.frames.find((f) => f.id === '${id}'); return { x: f.x, y: f.y, selected: s.selectedIds.includes('${id}') } })`,
    ) as Promise<{ x: number; y: number; selected: boolean }>
  /** screen point at the middle of a frame, for the current camera */
  async function middleOf(page: Page, id: string) {
    const f = await frameAt(page, id)
    const vp = (await page.evaluate(
      `import('/src/lib/store.ts').then(({ useStore }) => useStore.getState().viewport)`,
    )) as { x: number; y: number; zoom: number }
    const stage = await page.evaluate(() => {
      const r = document.querySelector('.stage')!.getBoundingClientRect()
      return { left: r.left, top: r.top }
    })
    return { x: stage.left + vp.x + (f.x + 720) * vp.zoom, y: stage.top + vp.y + (f.y + 450) * vp.zoom }
  }

  it('draws culled frames as shells and selects one on a click', async () => {
    await store(page, 'select(null)')
    await camera(page, { x: 20, y: 60, zoom: 0.08 })
    expect(await page.evaluate(() => document.querySelectorAll('[data-frame-shell]').length)).toBe(FRAMES)
    const at = await middleOf(page, 'f9')
    await page.mouse.click(at.x, at.y)
    await new Promise((r) => setTimeout(r, 200))
    expect((await frameAt(page, 'f9')).selected).toBe(true)
    /* it is a FrameView now: no shell, and (selected) its document is live */
    expect(await page.evaluate(() => !!document.querySelector('[data-frame-shell="f9"]'))).toBe(false)
    expect(await page.evaluate(() => !!document.querySelector('iframe[title="Frame 9"]'))).toBe(true)
  }, 30_000)

  it('moves a culled frame with one drag: the press that wakes it also starts the drag', async () => {
    await store(page, 'select(null)')
    await camera(page, { x: 20, y: 60, zoom: 0.08 })
    const before = await frameAt(page, 'f17')
    const at = await middleOf(page, 'f17')
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 20, at.y + 12, { steps: 4 })
    await page.mouse.move(at.x + 40, at.y + 24, { steps: 4 })
    await page.mouse.up()
    await new Promise((r) => setTimeout(r, 200))
    const after = await frameAt(page, 'f17')
    expect(after.x).toBeGreaterThan(before.x + 300)
    expect(after.y).toBeGreaterThan(before.y + 150)
  }, 30_000)

  it('keeps a large selection as previews: no document per selected frame', async () => {
    await page.evaluate(
      `import('/src/lib/store.ts').then(({ useStore }) => useStore.setState({ selectedIds: Array.from({ length: 60 }, (_, i) => 'f' + i), selectedId: 'f0' }))`,
    )
    await new Promise((r) => setTimeout(r, 400))
    expect(await iframes(page)).toBe(0)
    await store(page, 'select(null)')
  }, 30_000)

  /* Previews are fetched at the scale they are on screen (shared/types.ts,
     PREVIEW_SCALES); this browser's devicePixelRatio is 1. */
  const previewLevels = (page: Page) =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll<HTMLImageElement>('[data-doop-frame-preview] img')].map(
          (img) => new URL(img.src).searchParams.get('s') ?? 'none',
        ),
      ),
    ])

  it('asks for the previews at the level that covers them on screen, and again when the zoom changes it', async () => {
    await store(page, 'select(null)')
    /* the whole page in view */
    await camera(page, { x: 20, y: 60, zoom: 0.08 })
    expect(await previewLevels(page)).toEqual(['0.25'])
    /* closer: the frames near the view sharpen, the rest of the page keeps the small picture */
    await camera(page, { x: 20, y: 60, zoom: 0.29 })
    const levels = (await page.evaluate(() =>
      Object.fromEntries(
        ['Frame 0', 'Frame 199'].map((name) => [
          name,
          new URL(
            [...document.querySelectorAll('[data-frame-shell]')]
              .find((shell) => shell.querySelector('[data-frame-title]')?.textContent === name)!
              .querySelector('img')!.src,
          ).searchParams.get('s'),
        ]),
      ),
    )) as Record<string, string>
    expect(levels).toEqual({ 'Frame 0': '0.5', 'Frame 199': '0.25' })
    /* every one is the whole frame as webp, named by version */
    const src = await page.evaluate(
      () => document.querySelector<HTMLImageElement>('[data-doop-frame-preview] img')!.src,
    )
    expect(new URL(src).pathname).toMatch(/^\/i\/f\d+\.webp$/)
    expect(new URL(src).searchParams.get('v')).toBe('1')
  }, 30_000)

  it('keeps the preview over a document that has just booted until the document has painted', async () => {
    await store(page, 'select(null)')
    await camera(page, { x: 20, y: 60, zoom: 0.08 })
    /* selecting pins the frame live: its iframe mounts blank and boots. The
       picture must be there with it, and gone once the runtime reports the
       document shown. */
    const seen = (await page.evaluate(`new Promise((resolve) => {
      import('/src/lib/store.ts').then(({ useStore }) => {
        useStore.getState().select('f60')
        const started = performance.now()
        let covered = false
        ;(function poll() {
          const iframe = document.querySelector('iframe[title="Frame 60"]')
          const preview = iframe?.parentElement?.querySelector('[data-doop-frame-preview]')
          if (iframe && preview) covered = true
          const ms = performance.now() - started
          if (iframe && !preview) resolve({ covered, shown: true, ms })
          else if (ms > 8000) resolve({ covered, shown: false, ms })
          else setTimeout(poll, 2)
        })()
      })
    })`)) as { covered: boolean; shown: boolean; ms: number }
    expect(seen.covered).toBe(true)
    expect(seen.shown).toBe(true)
    await store(page, 'select(null)')
  }, 30_000)

  it('measures a click with culling on and off (written to $LIVEFRAMES_BENCH, not asserted)', async () => {
    async function measure(cull: boolean) {
      const p = await browser.newPage()
      await p.setViewport({ width: 1600, height: 1000 })
      await p.goto(fixtureUrl('pages.html'))
      await p.evaluate((on) => localStorage.setItem('doop:cull', on ? 'on' : 'off'), cull)
      await p.reload()
      await p.waitForFunction(() => typeof window.seedPages === 'function')
      const t0 = Date.now()
      await p.evaluate((c) => window.seedPages(c), canvas)
      await camera(p, { x: 0, y: 0, zoom: 0.35 })
      const settled = Date.now() - t0
      const clicks: number[] = []
      await p.evaluate(() => {
        const w = window as unknown as { clickTimes: number[] }
        w.clickTimes = []
        window.addEventListener(
          'pointerdown',
          (e) => {
            const at = e.timeStamp
            requestAnimationFrame(() => requestAnimationFrame(() => w.clickTimes.push(performance.now() - at)))
          },
          true,
        )
      })
      for (let i = 0; i < 7; i++) {
        await p.mouse.click(30 + i * 40, 980)
        await new Promise((r) => setTimeout(r, 250))
      }
      clicks.push(...(await p.evaluate(() => (window as unknown as { clickTimes: number[] }).clickTimes)))
      const live = await iframes(p)
      const heap = await p.evaluate(
        () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
      )
      await p.close()
      return {
        live,
        settledMs: settled,
        clickMs: Math.round(clicks.sort((a, b) => a - b)[Math.floor(clicks.length / 2)] ?? -1),
        heapMB: Math.round(heap / 1e6),
      }
    }
    const off = await measure(false)
    const on = await measure(true)
    if (process.env.LIVEFRAMES_BENCH)
      writeFileSync(process.env.LIVEFRAMES_BENCH, JSON.stringify({ frames: FRAMES, zoom: 0.35, off, on }, null, 1))
    expect(on.live).toBeLessThan(off.live)
  }, 180_000)
})
