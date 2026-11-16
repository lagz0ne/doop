import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import type { Frame } from '../shared/types'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'

/* The reviewer layout (FULL_UI off, a desktop, floating panels): one dock
   along the bottom instead of the top bar, the tool rail and the side rail,
   with Hand and Comment as its tools and nothing of the agents'; the Hand
   first; the left panel the pages alone; the right-hand panel the comments
   alone, opened from the dock. The editor page itself, mounted by the
   clipboard fixture. */

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
  await page.evaluate((frame) => (window as unknown as Harness).canvasClipboardHarness.seed([frame]), FRAME)
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

  it('offers Hand and Comment alone, and nothing of the agents', async () => {
    const labels = await page.$$eval(`${dock} [aria-label]`, (els) => els.map((el) => el.getAttribute('aria-label')))
    expect(labels).toEqual(expect.arrayContaining(['Hand (H)', 'Comment (C)']))
    for (const gone of ['More tools', 'Prototype', 'AI activity', 'Connect AI'])
      expect(labels.some((label) => label?.startsWith(gone))).toBe(false)
    /* nor the getting-started checklist, which is about connecting one */
    const texts = await page.$$eval('header span', (els) => els.map((el) => el.textContent?.trim()))
    expect(texts).not.toContain('Getting started')
  })

  it('shows a tool picked by its key while it is the current one, and goes back to the Hand', async () => {
    await store(page, `(s.setTool('select'), true)`)
    const picked = `${dock} [aria-label^="Select"][aria-pressed="true"]`
    await page.waitForSelector(picked)
    await page.click(picked)
    expect(await store(page, 's.tool')).toBe('hand')
    expect(await page.$(picked)).toBe(null)
  })

  it('shows Prototype mode only while it is on, as the way out', async () => {
    await store(page, `(s.setPrototypeMode(true), true)`)
    const mode = `${dock} [aria-label^="Prototype mode"]`
    await page.waitForSelector(mode)
    await page.click(mode)
    expect(await store(page, 's.prototypeMode')).toBe(false)
    expect(await page.$(mode)).toBe(null)
  })

  it('gives the left panel to the pages alone: no layer tree, no tokens', async () => {
    await page.waitForSelector('[data-slot="page-section-heading"]')
    expect(await page.$('[data-slot="frame-section-heading"]')).toBe(null)
    expect(await page.$('[role="tree"]')).toBe(null)
    expect(await page.$('[role="tab"][id$="-trigger-tokens"]')).toBe(null)
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
    /* the comments alone: no Agents, activity or memory tabs */
    expect(await page.$$eval('[aria-label="Agents panel"] [role="tab"]', (tabs) => tabs.length)).toBe(1)
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
