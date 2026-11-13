import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import type { Frame } from '../shared/types'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'

/* The reviewer layout (FULL_UI off, a desktop, floating panels): one dock
   along the bottom instead of the top bar, the tool rail and the side rail;
   the Hand first; Layers folded under the pages; the right-hand panel opened
   from the dock. The editor page itself, mounted by the clipboard fixture. */

/* the harness's own type is declared in canvasClipboardBrowser.test.ts */
type Harness = { canvasClipboardHarness: { seed: (frames: Frame[]) => void } }

const FRAME: Frame = {
  id: 'f',
  canvasId: 'c',
  name: 'Frame',
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  html: '<!doctype html><html><body><h1>Hello</h1></body></html>',
  createdAt: 0,
  updatedAt: 0,
  updatedBy: 'Tester',
}

const store = (page: Page, expr: string) =>
  page.evaluate(`import('/src/lib/store.ts').then(({ useStore }) => { const s = useStore.getState(); return ${expr} })`)
const dock = '[aria-label="Canvas dock"]'
const shown = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)
    return !!el && el.offsetParent !== null
  }, selector)

async function open(page: Page, fullUi: 'on' | 'off') {
  /* runs after the rig's default (on), so it decides */
  await page.evaluateOnNewDocument((value) => localStorage.setItem('doop:full-ui', value), fullUi)
  await page.goto(fixtureUrl('canvasClipboard.html'))
  await page.waitForFunction(
    () => !!(window as unknown as Harness).canvasClipboardHarness && !!document.querySelector('.stage'),
  )
  await page.evaluate((frame) => {
    localStorage.removeItem('doop:layers-section')
    ;(window as unknown as Harness).canvasClipboardHarness.seed([frame])
  }, FRAME)
  /* the harness hides the chrome and closes Layers; this test is about them */
  await store(page, `(useStore.setState({ uiHidden: false }), s.setLayersOpen(true), true)`)
}

describe.skipIf(!findBrowserPath())('the reviewer layout', () => {
  let browser: TestBrowser
  let page: Page
  beforeAll(async () => {
    browser = await openBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await open(page, 'off')
  }, 60_000)
  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('puts the chrome in one dock and starts on the Hand', async () => {
    await page.waitForSelector(dock)
    expect(await shown(page, '[aria-label="Canvas tools"]')).toBe(false)
    expect(await store(page, 's.tool')).toBe('hand')
    expect(await page.$eval(dock, (el) => !!el.querySelector('[aria-label="Zoom out"]'))).toBe(true)
  })

  it('folds Layers under the pages, and remembers when it is opened', async () => {
    await page.waitForSelector('button[aria-expanded="false"]')
    expect(await page.$('[data-slot="frame-section-heading"]')).toBe(null)
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')]
        .find((b) => b.textContent?.trim() === 'Layers')!
        .click(),
    )
    await page.waitForSelector('[data-slot="frame-section-heading"]')
    expect(await page.evaluate(() => localStorage.getItem('doop:layers-section'))).toBe('1')
  })

  it('lists every tool upwards and shows the one picked in the dock', async () => {
    await page.click('[aria-label="More tools"]')
    await page.waitForSelector('[role="menuitem"]')
    const select = (await page.$$('[role="menuitem"]')).at(0)!
    expect(await select.evaluate((el) => el.textContent)).toContain('Select')
    await select.click()
    expect(await store(page, 's.tool')).toBe('select')
    expect(await page.$eval(dock, (el) => !!el.querySelector('[aria-label^="Select"][aria-pressed="true"]'))).toBe(true)
  })

  it('opens the comments from the dock and closes them again', async () => {
    const comments = `${dock} [aria-label^="Comments"]`
    expect(await page.$eval(comments, (el) => el.getAttribute('aria-pressed'))).toBe('false')
    await page.click(comments)
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true',
      {},
      comments,
    )
    expect(await store(page, 's.panelTab')).toBe('comments')
    await page.click(comments)
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'false',
      {},
      comments,
    )
  })

  it('keeps the full layout when doop:full-ui is on', async () => {
    const full = await browser.newPage()
    await full.setViewport({ width: 1440, height: 900 })
    await open(full, 'on')
    await full.waitForSelector('[aria-label="Canvas tools"]')
    expect(await full.$(dock)).toBe(null)
    expect(await store(full, 's.tool')).toBe('select')
    await full.close()
  })
})
