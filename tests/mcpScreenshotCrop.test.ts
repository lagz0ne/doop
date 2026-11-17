import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Canvas, Frame } from '../shared/types'
import { buildMcpServer } from '../server/mcp.ts'
import { findBrowserPath } from '../server/screenshot.ts'
import { store } from '../server/store.ts'

/* get_frame_screenshot's scale, max_size and crops, rendered by the real
   Chromium: the image's own size says what was rendered. */

const ownerId = 'crop-owner-id'
const canvasId = 'crop-canvas'

beforeAll(() => {
  const frame = {
    id: 'crop-frame',
    canvasId,
    name: 'Tall',
    x: 0,
    y: 0,
    width: 1000,
    height: 3000,
    html: `<!doctype html><html><body style="margin:0">
      <div data-doop-id="card" style="position:absolute;left:100px;top:200px;width:300px;height:100px;background:red"></div>
    </body></html>`,
    updatedAt: 1,
    updatedBy: ownerId,
  } as Frame
  const canvas: Canvas = { id: canvasId, ownerId, name: 'Crops', frames: [frame], createdAt: 0, updatedAt: 0 }
  store.init([canvas])
})

async function shoot(args: Record<string, unknown>) {
  const server = buildMcpServer('Test Owner', ownerId)
  const client = new Client({ name: 'screenshot-crop-test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(b)
  await client.connect(a)
  try {
    const result = await client.callTool({
      name: 'get_frame_screenshot',
      arguments: { frame_id: 'crop-frame', ...args },
    })
    const content = result.content as { type: string; data?: string; mimeType?: string; text?: string }[]
    const image = content.find((c) => c.type === 'image')
    const text = content.find((c) => c.type === 'text')?.text ?? ''
    return { isError: !!result.isError, image, text, size: image?.data ? imageSize(image.data) : null }
  } finally {
    await client.close()
    await server.close()
  }
}

/** Width and height from a PNG's IHDR or a JPEG's first SOF marker. */
function imageSize(base64: string): { width: number; height: number } {
  const buf = Buffer.from(base64, 'base64')
  if (buf[0] === 0x89) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  let at = 2
  while (at < buf.length) {
    const marker = buf[at + 1]!
    if (marker >= 0xc0 && marker <= 0xc2) return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) }
    at += 2 + buf.readUInt16BE(at + 2)
  }
  throw new Error('no JPEG frame header')
}

describe.skipIf(!findBrowserPath())('get_frame_screenshot', () => {
  it('renders the whole frame at the asked scale, and says when it is too tall to read whole', async () => {
    const shot = await shoot({ scale: 0.5 })
    expect(shot.size).toEqual({ width: 500, height: 1500 })
    expect(shot.text).toMatch(/@0\.5x = 500×1500 px/)
    expect((await shoot({})).text).toMatch(/read it in parts with region/)
  }, 60_000)

  it('fits the longest edge to max_size', async () => {
    expect((await shoot({ max_size: 600 })).size).toEqual({ width: 200, height: 600 })
  }, 60_000)

  it('crops to an element with padding, and to a region', async () => {
    const card = await shoot({ element_id: 'card', padding: 10, scale: 2 })
    expect(card.size).toEqual({ width: 640, height: 240 })
    expect(card.text).toMatch(/region 90,190 320×120 of 1000×3000/)
    const slice = await shoot({ region: { x: 0, y: 1500, width: 1000, height: 1600 }, format: 'jpeg' })
    expect(slice.image?.mimeType).toBe('image/jpeg')
    /* kept inside the frame: 1500 + 1600 runs past its 3000 */
    expect(slice.size).toEqual({ width: 1000, height: 1500 })
    const small = await shoot({ element_id: 'card', padding: 0, max_size: 150 })
    expect(small.size).toEqual({ width: 150, height: 50 })
  }, 60_000)

  it('says so when the crop names nothing', async () => {
    const missing = await shoot({ element_id: 'nope' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/no element with data-doop-id="nope"/)
    expect((await shoot({ element_id: 'card', region: { x: 0, y: 0, width: 1, height: 1 } })).isError).toBe(true)
  }, 60_000)
})
