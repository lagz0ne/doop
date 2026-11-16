import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'puppeteer-core'
import type { Frame } from '../shared/types'
import { findBrowserPath } from '../server/screenshot'
import { fixtureUrl, openBrowser, type TestBrowser } from './browser'

/* The reviewer layout (FULL_UI off, a desktop, floating panels): one dock
   along the bottom instead of the top bar, the tool rail and the side rail,
   with Hand and Comment as its tools and nothing of the agents'; the Hand
   first; no left panel, the pages a picker in the dock; the rest (comments,
   import, export, settings, your name) in one menu behind the faces of who is
   here; the right-hand panel the comments alone. The editor page itself,
   mounted by the clipboard fixture. */

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
  /* the harness hides the chrome and closes Layers; this test is about them
     (and a Layers panel left open must not show in the reviewer layout) */
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

  it('keeps the dock to moving around and reviewing', async () => {
    const labels = await page.$$eval(`${dock} [aria-label]`, (els) => els.map((el) => el.getAttribute('aria-label')))
    for (const gone of ['Import', 'Export', 'Share', 'Settings', 'Comments', 'Hide renderer', 'Show renderer'])
      expect(labels).not.toContain(gone)
    /* the renderer label stays out even when its view option is on */
    await store(page, `(s.viewOptions.renderer || s.toggleViewOption('renderer'), true)`)
    expect(await page.$(`${dock} [data-renderer]`)).toBe(null)
  })

  it('has no left panel: no pages, layer tree or tokens beside the canvas', async () => {
    expect(await page.$('[data-slot="page-section-heading"]')).toBe(null)
    expect(await page.$('[role="tree"]')).toBe(null)
    expect(await page.$('[aria-label="Layers panel"]')).toBe(null)
  })

  it('picks the page from the dock', async () => {
    await store(
      page,
      `(useStore.setState({ canvas: { ...s.canvas, pages: [{ id: 'p1', name: 'Page 1' }, { id: 'p2', name: 'Flows' }] } }), true)`,
    )
    const picker = `${dock} [aria-label^="Page: "]`
    await page.waitForSelector(`${dock} [aria-label="Page: Page 1"]`)
    await page.click(picker)
    const flows = '[role="menuitemradio"]:last-of-type'
    await page.waitForSelector(flows)
    expect(await page.$$eval('[role="menuitemradio"]', (items) => items.map((el) => el.textContent))).toEqual([
      'Page 1',
      'Flows',
    ])
    await page.click(flows)
    await page.waitForSelector(`${dock} [aria-label="Page: Flows"]`)
    expect(await store(page, 's.activePageId')).toBe('p2')
  })

  it('holds the comments, import, export, settings and your name in one menu', async () => {
    const menu = `${dock} [aria-label="Comments, people, share and settings"]`
    const items = async () => {
      await page.click(menu)
      await page.waitForSelector('[role="menu"]')
      return page.$$eval('[role="menu"] [role="menuitem"]', (els) => els.map((el) => el.textContent?.trim() ?? ''))
    }
    const listed = await items()
    for (const item of ['Comments', 'Import', 'Export', 'Settings']) expect(listed).toContain(item)
    expect(listed.some((text) => text.endsWith('Change your name'))).toBe(true)
    /* the comments open from it, and close from it again */
    await page.click('[role="menu"] [role="menuitem"]')
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'))
    expect(await store(page, 's.panelTab')).toBe('comments')
    /* the comments alone: no Agents, activity or memory tabs */
    await page.waitForSelector('[aria-label="Agents panel"]')
    expect(await page.$$eval('[aria-label="Agents panel"] [role="tab"]', (tabs) => tabs.length)).toBe(1)
    expect(await items()).toContain('Close comments')
    await page.click('[role="menu"] [role="menuitem"]')
    await page.waitForFunction(() => !document.querySelector('[aria-label="Agents panel"]'))
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
