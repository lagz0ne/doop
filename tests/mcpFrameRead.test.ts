import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, expect, it } from 'vitest'
import type { Canvas, Frame } from '../shared/types'
import { buildMcpServer } from '../server/mcp.ts'
import { readFrameHtml } from '../server/frameHtmlRead.ts'
import { findBrowserPath } from '../server/screenshot.ts'
import { store } from '../server/store.ts'

/* Reading part of a frame over MCP: get_frame by element, query or offset,
   and inspect_frame's rendered outline. */

const ownerId = 'read-owner-id'
const STYLE = `<style>${'.x{color:red}'.repeat(2000)}</style>`
const HTML = `<!doctype html><html><head><title>Pricing</title>${STYLE}</head><body style="margin:0">
<header data-doop-id="top"><h1>Plans</h1></header>
<section data-doop-id="pro" style="position:absolute;left:40px;top:120px;width:300px;height:200px">
  <h2>Pro</h2><p>Everything in Starter, plus seats</p><button data-doop-id="buy">Buy Pro</button>
</section>
</body></html>`

beforeAll(() => {
  const frame = {
    id: 'read-frame',
    canvasId: 'read-canvas',
    name: 'Pricing',
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    html: HTML,
    updatedAt: 1,
    updatedBy: ownerId,
  } as Frame
  const canvas: Canvas = { id: 'read-canvas', ownerId, name: 'Read', frames: [frame], createdAt: 0, updatedAt: 0 }
  store.init([canvas])
})

async function call(name: string, args: Record<string, unknown>) {
  const server = buildMcpServer('Test Owner', ownerId)
  const client = new Client({ name: 'frame-read-test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(b)
  await client.connect(a)
  try {
    const result = await client.callTool({ name, arguments: { frame_id: 'read-frame', ...args } })
    const body = (result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')!.text!
    return { isError: !!result.isError, body }
  } finally {
    await client.close()
    await server.close()
  }
}

it('reads the whole HTML by default, as before', async () => {
  const { body } = await call('get_frame', {})
  expect(JSON.parse(body).html).toBe(HTML)
})

it('reads one element, with its children, by data-doop-id', async () => {
  const read = JSON.parse((await call('get_frame', { element_id: 'pro' })).body)
  expect(read.html).toBeUndefined()
  expect(read.elementHtml).toMatch(/^<section data-doop-id="pro"[\s\S]*Buy Pro<\/button>\n<\/section>$/)
  expect(read.htmlBytes).toBe(HTML.length)
  const missing = await call('get_frame', { element_id: 'gone' })
  expect(missing.isError).toBe(true)
  expect((await call('get_frame', { element_id: 'pro', query: 'Pro' })).isError).toBe(true)
})

it('reads snippets around a query, or a page of the source', async () => {
  const found = JSON.parse((await call('get_frame', { query: 'buy pro', limit: 1000 })).body)
  expect(found.htmlRead).toMatch(/1 match\(es\) for "buy pro"/)
  expect(found.htmlRead.length).toBeLessThan(1200)
  const page = JSON.parse((await call('get_frame', { offset: 0, limit: 1000 })).body)
  expect(page.htmlRead).toMatch(/Returning chars 0-1000\. Continue with offset=1000/)
  expect((await call('get_frame', { query: 'nowhere' })).isError).toBe(true)
})

it('keeps the resident read and the MCP read the same', () => {
  const read = readFrameHtml(HTML, { query: 'Plans' })
  expect(read.ok && read.text).toMatch(/^Frame HTML: \d+ characters; 1 match\(es\) for "Plans"\.\n--- match 1/)
})

it.skipIf(!findBrowserPath())(
  'outlines the rendered frame with element ids and boxes, far smaller than its HTML',
  async () => {
    const { isError, body } = await call('inspect_frame', {})
    expect(isError, body).toBe(false)
    const outline = JSON.parse(body)
    expect(outline.document).toMatchObject({ title: 'Pricing', width: 800, height: 600 })
    const pro = outline.elements.find((e: { selector: string }) => e.selector === '[data-doop-id="pro"]')
    expect(pro).toMatchObject({ tag: 'section', rect: { x: 40, y: 120, width: 300, height: 200 } })
    expect(outline.elements.some((e: { text?: string }) => e.text === 'Buy Pro')).toBe(true)
    expect(body.length).toBeLessThan(HTML.length / 3)
  },
  60_000,
)
