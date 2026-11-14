import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import type { Frame } from '../shared/types'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'
import { TOUCH_HOLD_MS } from '../src/lib/touchHold'

/* A phone in the reviewer layout (FULL_UI off, <= 900px) reviews: the role
   counts as review at most, the dock holds the Hand and Comment and no tool
   list, a finger pans over frames in either tool, the page does not zoom,
   and a context menu waits for a long hold that a pan or a short pause does
   not reach. The editor page itself, mounted by the clipboard fixture. */

type Harness = { canvasClipboardHarness: { seed: (frames: Frame[]) => void } }

const FRAME: Frame = {
  id: 'f',
  canvasId: 'c',
  name: 'Frame',
  x: 0,
  y: 0,
  width: 600,
  height: 900,
  html: '<!doctype html><html><body><h1>Hello</h1></body></html>',
  createdAt: 0,
  updatedAt: 0,
  updatedBy: 'Tester',
}

const store = (page: Page, expr: string) =>
  page.evaluate(`import('/src/lib/store.ts').then((m) => { const s = m.useStore.getState(); return ${expr} })`)
const dock = '[aria-label="Canvas dock"]'
const menuOpen = (page: Page) => page.evaluate(() => !!document.querySelector('[role="menu"]'))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** a point on the frame, clear of the dock and the zoom pill */
async function onFrame(page: Page) {
  return page.evaluate(() => {
    const r = document.querySelector('[data-frame-surface]')!.getBoundingClientRect()
    const x = Math.min(r.right, innerWidth) / 2 + Math.max(r.left, 0) / 2
    const y = Math.max(r.top, 0) + 120
    return { x, y }
  })
}

describe.skipIf(!findBrowserPath())('a phone in the reviewer layout', () => {
  let browser: TestBrowser
  let page: Page
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('doop:full-ui', 'off')
      /* the fixture has no viewport tag, which a phone lays out at 980px:
         add index.html's before the page's modules run */
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return
        const meta = document.createElement('meta')
        meta.name = 'viewport'
        meta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
        document.head.append(meta)
      })
    })
    await page.goto(fixtureUrl('canvasClipboard.html'))
    await page.waitForFunction(
      () => !!(window as unknown as Harness).canvasClipboardHarness && !!document.querySelector('.stage'),
    )
    await page.evaluate((frame) => (window as unknown as Harness).canvasClipboardHarness.seed([frame]), FRAME)
    await store(page, `(m.useStore.setState({ uiHidden: false, viewport: { x: 0, y: 0, zoom: 1 } }), true)`)
    await page.waitForSelector(dock)
    await page.waitForSelector('[data-frame-surface]')
  }, 60_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('is review-only: the role counts as review and only the Hand and Comment are offered', async () => {
    expect(await store(page, 's.reviewOnly')).toBe(true)
    expect(await store(page, 'm.roleOf(s)')).toBe('review')
    expect(await store(page, 'm.grantedRole(s)')).toBe('edit')
    expect(await store(page, 'm.canEditOpenCanvas(s)')).toBe(false)
    expect(await store(page, 'm.canReviewOpenCanvas(s)')).toBe(true)
    expect(await store(page, 's.tool')).toBe('hand')
    expect(await page.$(`${dock} [aria-label="More tools"]`)).toBe(null)
    const labels = await page.$$eval(`${dock} [aria-label]`, (els) => els.map((el) => el.getAttribute('aria-label')))
    expect(labels).toEqual(expect.arrayContaining(['Hand (H)', 'Comment (C)']))
    expect(labels.some((label) => label?.startsWith('Prototype'))).toBe(false)
    await store(page, `(s.setTool('select'), s.setTool('rect'), s.setTool('zoom'), true)`)
    expect(await store(page, 's.tool')).toBe('hand')
    /* no "view only" banner: the cap is the layout's, not a lesser role */
    expect(await page.$('[role="status"]')).toBe(null)
  })

  it('holds the page still: no browser zoom, no double-tap zoom', async () => {
    const meta = await page.$eval('meta[name="viewport"]', (el) => (el as HTMLMetaElement).content)
    expect(meta).toContain('user-scalable=no')
    expect(meta).toContain('maximum-scale=1')
  })

  it('pans with a finger dragged slowly across a frame, and opens no menu on the way', async () => {
    const at = await onFrame(page)
    const before = (await store(page, 's.viewport')) as { x: number; y: number }
    await page.touchscreen.touchStart(at.x, at.y)
    /* longer than Radix's 700 ms long press, moving all the while */
    for (let i = 1; i <= 12; i++) {
      await wait(100)
      await page.touchscreen.touchMove(at.x - i * 6, at.y - i * 8)
    }
    expect(await menuOpen(page)).toBe(false)
    await page.touchscreen.touchEnd()
    const after = (await store(page, 's.viewport')) as { x: number; y: number }
    expect(after.y).toBeLessThan(before.y - 60)
    expect(await store(page, 's.selectedIds.length')).toBe(0)
    expect(await menuOpen(page)).toBe(false)
  }, 20_000)

  it('opens the frame menu only after a long hold, with its review half alone', async () => {
    const at = await onFrame(page)
    await page.touchscreen.touchStart(at.x, at.y)
    await wait(1000)
    /* past Radix's 700 ms and the platforms' long press: still nothing */
    expect(await menuOpen(page)).toBe(false)
    await page.waitForSelector('[role="menu"]', { timeout: TOUCH_HOLD_MS + 2000 })
    await page.touchscreen.touchEnd()
    const items = await page.$$eval('[role="menuitem"]', (els) => els.map((el) => el.textContent?.trim() ?? ''))
    expect(items.some((text) => text.startsWith('Copy link'))).toBe(true)
    expect(items.some((text) => text.startsWith('Request changes'))).toBe(true)
    expect(items.some((text) => text.startsWith('Duplicate') || text.startsWith('Delete'))).toBe(false)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'))
  }, 20_000)

  it('pans in the Comment tool too, and a tap on a frame is what comments', async () => {
    await store(page, `(s.setTool('comment'), s.select(null), true)`)
    const at = await onFrame(page)
    const before = (await store(page, 's.viewport')) as { x: number; y: number }
    await page.touchscreen.touchStart(at.x, at.y)
    for (let i = 1; i <= 6; i++) await page.touchscreen.touchMove(at.x, at.y - i * 15)
    await page.touchscreen.touchEnd()
    const after = (await store(page, 's.viewport')) as { x: number; y: number }
    expect(after.y).toBeLessThan(before.y - 60)
    /* the pan neither selected the frame nor opened a comment */
    expect(await store(page, 's.selectedIds.length')).toBe(0)
    const tap = await onFrame(page)
    await page.touchscreen.tap(tap.x, tap.y)
    /* a string: the test file's own transform would rewrite a function's import() */
    await page.waitForFunction(
      `import('/src/lib/store.ts').then(({ useStore }) => useStore.getState().selectedIds.includes('f'))`,
      { polling: 100 },
    )
  }, 20_000)
})
