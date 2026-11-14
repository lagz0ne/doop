import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'

/* GET /api/frames/:id/html (server/frameHtml.ts) on a real server: an agent
   key reads what get_frame reads, a session reads it too, and nothing gets
   through that the account could not open. */

const TOKEN = 'frame-html-test-token-0123456789abcdef'
const HTML = '<main><h1 id="t">Hello</h1><script>parent.x=1</script></main>'
let server: Server

beforeAll(async () => {
  server = await startServer({ DOOP_ADMIN_TOKEN: TOKEN })
}, 70_000)

afterAll(() => server?.stop())

function get(path: string, bearer?: string) {
  return fetch(`${server.base}${path}`, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {})
}

describe('frame HTML over HTTP', () => {
  let owner: Client
  let stranger: Client
  let canvasId: string
  let frameId: string
  let ownerKey: string
  let strangerKey: string

  beforeAll(async () => {
    owner = new Client(server)
    stranger = new Client(server)
    await owner.signUp('html-owner@test.dev', 'Owner')
    await stranger.signUp('html-stranger@test.dev', 'Stranger')
    canvasId = (await (await owner.post('/api/canvases', { name: 'Html' })).json()).id
    frameId = (await (await owner.post(`/api/canvases/${canvasId}/frames`, { name: 'Hero' })).json()).id
    expect((await owner.patch(`/api/frames/${frameId}`, { html: HTML })).status).toBe(200)
    ownerKey = (await (await owner.post('/api/agent-keys', { name: 'script' })).json()).secret
    strangerKey = (await (await stranger.post('/api/agent-keys', { name: 'script' })).json()).secret
  })

  it('serves the saved HTML to an agent key, sandboxed and uncached', async () => {
    const res = await get(`/api/frames/${frameId}/html`, ownerKey)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(HTML)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('content-security-policy')).toMatch(/\bsandbox\b/)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Number(res.headers.get('x-doop-frame-updated-at'))).toBeGreaterThan(0)
  })

  it('serves it to a signed-in session too', async () => {
    const res = await owner.get(`/api/frames/${frameId}/html`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(HTML)
  })

  it('follows the canvas role: nothing without access, a view link is enough', async () => {
    expect((await get(`/api/frames/${frameId}/html`, strangerKey)).status).toBe(404)
    expect((await stranger.get(`/api/frames/${frameId}/html`)).status).toBe(403)
    expect((await owner.patch(`/api/canvases/${canvasId}`, { linkAccess: 'view' })).status).toBe(200)
    try {
      const res = await get(`/api/frames/${frameId}/html`, strangerKey)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(HTML)
    } finally {
      await owner.patch(`/api/canvases/${canvasId}`, { linkAccess: 'none' })
    }
    expect((await get(`/api/frames/${frameId}/html`, strangerKey)).status).toBe(404)
  })

  it('refuses unknown, revoked and banned keys, and anonymous requests', async () => {
    expect((await get(`/api/frames/${frameId}/html`)).status).toBe(401)
    expect((await get(`/api/frames/${frameId}/html`, 'dpk_' + 'x'.repeat(32))).status).toBe(401)
    expect((await get(`/api/frames/nope/html`, ownerKey)).status).toBe(404)

    const revoked = await (await owner.post('/api/agent-keys', { name: 'gone' })).json()
    expect((await owner.delete(`/api/agent-keys/${revoked.id}`)).status).toBe(200)
    expect((await get(`/api/frames/${frameId}/html`, revoked.secret)).status).toBe(401)

    const banned = new Client(server)
    await banned.signUp('html-banned@test.dev', 'Banned')
    const key = (await (await banned.post('/api/agent-keys', { name: 'k' })).json()).secret
    const ban = await fetch(`${server.base}/api/operator/users/html-banned@test.dev/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ reason: 'test' }),
    })
    expect(ban.status).toBe(200)
    expect((await get(`/api/frames/${frameId}/html`, key)).status).toBe(403)
  })

  it('is read-only: an agent key reaches no other /api route', async () => {
    const res = await fetch(`${server.base}/api/frames/${frameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify({ html: '<p>x</p>' }),
    })
    expect(res.status).toBe(401)
    expect((await get(`/api/canvases/${canvasId}`, ownerKey)).status).toBe(401)
  })
})
