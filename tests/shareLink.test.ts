import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'

/* Share-link guests (server/shareLink.ts) on a real server: a name, the
   link's password when it has one, and the link's level on its one canvas. */

const ADMIN = 'operator-token-for-link-tests-0123456789'
let server: Server
let owner: Client
let canvasId: string
let otherCanvasId: string
let frameId: string

async function newCanvas(name: string): Promise<string> {
  return ((await (await owner.post('/api/canvases', { name })).json()) as { id: string }).id
}

async function setLink(id: string, patch: { linkAccess?: string; linkPassword?: string | null }) {
  const res = await owner.patch(`/api/canvases/${id}`, patch)
  expect(res.status, await res.clone().text()).toBe(200)
}

async function joinLink(id: string, name: string, password?: string) {
  const client = new Client(server)
  const res = await client.req('/api/auth/link/session', {
    method: 'POST',
    headers: { Origin: server.base },
    body: JSON.stringify({ canvasId: id, name, password }),
  })
  return { client, status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}

function info(id: string) {
  return fetch(`${server.base}/api/auth/link/info?canvas=${encodeURIComponent(id)}`)
}

/** Join a room; resolves with the init or the close code, and later messages. */
function join(client: Client | null, id: string) {
  const messages: { type: string; role?: string }[] = []
  const closed: number[] = []
  const ws = new WebSocket(`ws://localhost:${server.port}/ws`, {
    headers: client ? { Cookie: client.header() } : {},
  })
  const ready = new Promise<Record<string, unknown> | number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws timeout')), 8000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', canvasId: id, clientId: `t-${Math.random()}` })))
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d))
      if (msg.type === 'init') {
        clearTimeout(timer)
        resolve(msg)
      } else messages.push(msg)
    })
    ws.on('close', (code) => {
      clearTimeout(timer)
      closed.push(code)
      resolve(code)
    })
    ws.on('error', () => {})
  })
  return { ready, messages, closed, close: () => ws.close() }
}

beforeAll(async () => {
  server = await startServer({ DOOP_ADMIN_TOKEN: ADMIN })
  owner = await new Client(server).signUp('owner@example.com', 'Olive Owner')
  canvasId = await newCanvas('Review me')
  otherCanvasId = await newCanvas('Not shared')
  const frame = await owner.post(`/api/canvases/${canvasId}/frames`, {
    name: 'Home',
    width: 400,
    height: 300,
    html: '<html><body><h1>Hi</h1></body></html>',
  })
  frameId = ((await frame.json()) as { id: string }).id
}, 90_000)

afterAll(() => server?.stop())

describe('a link with a password', () => {
  it('is set by the owner, shown as a flag and never as its hash', async () => {
    await setLink(canvasId, { linkAccess: 'comment', linkPassword: 'tulip' })
    const text = await (await owner.get(`/api/canvases/${canvasId}`)).text()
    expect(JSON.parse(text)).toMatchObject({ linkAccess: 'comment', linkPassword: true })
    expect(text).not.toContain('tulip')
    expect(text).not.toMatch(/scrypt|[0-9a-f]{32}:[0-9a-f]{64}/)
    expect(await (await info(canvasId)).json()).toEqual({
      canvasId,
      access: 'comment',
      password: true,
      name: null,
    })
  })

  it('is the owner’s alone', async () => {
    const other = await new Client(server).signUp('other@example.com', 'Otto Other')
    expect((await other.patch(`/api/canvases/${canvasId}`, { linkPassword: 'mine' })).status).toBe(403)
  })

  it('lets nobody in by the link alone: not signed out, not another account', async () => {
    expect(await join(null, canvasId).ready).toBe(4401)
    const other = await new Client(server).signUp('another@example.com', 'Ann Another')
    expect((await other.get(`/api/canvases/${canvasId}`)).status).toBe(403)
  })

  it('wants a name and the right password', async () => {
    expect((await joinLink(canvasId, '  ', 'tulip')).status).toBe(400)
    expect((await joinLink(canvasId, 'Gus Guest', 'rose')).status).toBe(401)
    expect((await joinLink(canvasId, 'Gus Guest')).status).toBe(401)
    expect((await joinLink(otherCanvasId, 'Gus Guest', 'tulip')).status).toBe(404)
    const { status, body } = await joinLink(canvasId, 'Gus Guest', 'tulip')
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ canvasId, role: 'comment', user: { name: 'Gus Guest' } })
  })

  it('gives the guest the link’s level on that canvas and nothing else', async () => {
    const { client } = await joinLink(canvasId, 'Gus Guest', 'tulip')
    expect(await (await client.get('/api/me')).json()).toMatchObject({ name: 'Gus Guest', linkGuest: { canvasId } })
    expect(await (await client.get(`/api/canvases/${canvasId}`)).json()).toMatchObject({ role: 'comment' })
    const comment = await client.post(`/api/frames/${frameId}/comments`, { text: 'Bigger headline', x: 10, y: 10 })
    expect(comment.status, await comment.clone().text()).toBe(200)
    expect((await client.patch(`/api/frames/${frameId}`, { html: '<p>no</p>' })).status).toBe(403)
    expect((await client.get(`/api/canvases/${otherCanvasId}`)).status).toBe(403)
    expect((await client.get('/api/canvases')).status).toBe(403)
    expect((await client.post('/api/canvases', { name: 'mine now' })).status).toBe(403)
    expect((await client.post('/api/agent-keys', { name: 'k' })).status).toBe(403)
    expect((await client.post(`/api/canvases/${canvasId}/duplicate`, {})).status).toBe(403)
    expect((await client.patch(`/api/canvases/${canvasId}`, { linkPassword: null })).status).toBe(403)
    const room = join(client, canvasId)
    expect(await room.ready).toMatchObject({ type: 'init', canvas: { id: canvasId, role: 'comment' } })
    room.close()
  })

  it('follows the owner’s level live, edit included', async () => {
    const { client } = await joinLink(canvasId, 'Eda Editor', 'tulip')
    const room = join(client, canvasId)
    await room.ready
    await setLink(canvasId, { linkAccess: 'edit' })
    await expect.poll(() => room.messages.some((m) => m.type === 'role' && m.role === 'edit')).toBe(true)
    const edit = await client.patch(`/api/frames/${frameId}`, { name: 'Home, edited by a guest' })
    expect(edit.status, await edit.clone().text()).toBe(200)
    await setLink(canvasId, { linkAccess: 'review' })
    expect(await (await client.get(`/api/canvases/${canvasId}`)).json()).toMatchObject({ role: 'review' })
    expect((await client.patch(`/api/frames/${frameId}`, { name: 'no' })).status).toBe(403)
    room.close()
  })

  it('shuts every earlier guest out when the password changes', async () => {
    const { client } = await joinLink(canvasId, 'Gus Guest', 'tulip')
    const room = join(client, canvasId)
    await room.ready
    await setLink(canvasId, { linkPassword: 'daisy' })
    await expect.poll(() => room.closed[0]).toBe(4403)
    expect((await client.get(`/api/canvases/${canvasId}`)).status).not.toBe(200)
    expect((await joinLink(canvasId, 'Gus Guest', 'tulip')).status).toBe(401)
    expect((await joinLink(canvasId, 'Gus Guest', 'daisy')).status).toBe(200)
  })

  it('shuts guests out while the link is off', async () => {
    const { client } = await joinLink(canvasId, 'Gus Guest', 'daisy')
    await setLink(canvasId, { linkAccess: 'none' })
    expect((await client.get(`/api/canvases/${canvasId}`)).status).toBe(403)
    expect((await info(canvasId)).status).toBe(404)
    await setLink(canvasId, { linkAccess: 'comment' })
    expect((await client.get(`/api/canvases/${canvasId}`)).status).toBe(200)
  })
})

describe('a link without a password', () => {
  it('takes a name alone, and still lets a signed-out visitor look', async () => {
    const id = await newCanvas('Open review')
    await setLink(id, { linkAccess: 'comment' })
    expect(await (await info(id)).json()).toMatchObject({ access: 'comment', password: false, name: 'Open review' })
    const { client, status } = await joinLink(id, 'Nell Nameonly')
    expect(status).toBe(200)
    expect(await (await client.get(`/api/canvases/${id}`)).json()).toMatchObject({ role: 'comment' })
    expect(await join(null, id).ready).toMatchObject({ type: 'init', canvas: { role: 'view' } })
  })

  it('ends name-only guests once a password is set', async () => {
    const id = await newCanvas('Closing up')
    await setLink(id, { linkAccess: 'comment' })
    const { client } = await joinLink(id, 'Nell Nameonly')
    await setLink(id, { linkPassword: 'lock' })
    expect((await client.get(`/api/canvases/${id}`)).status).not.toBe(200)
  })
})

describe('the operator API', () => {
  it('sets and removes the password', async () => {
    const id = await newCanvas('Operated')
    const put = (body: unknown) =>
      fetch(`${server.base}/api/operator/canvases/${id}/link`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const set = await put({ access: 'view', password: 'lily' })
    expect(set.status, await set.clone().text()).toBe(200)
    expect(await set.json()).toMatchObject({ linkAccess: 'view', linkPassword: true })
    expect((await joinLink(id, 'Vic Viewer', 'lily')).status).toBe(200)
    expect(await (await put({ password: null })).json()).toMatchObject({ linkPassword: false })
    expect(await join(null, id).ready).toMatchObject({ type: 'init' })
  })
})

describe('wrong passwords', () => {
  it('pause a visitor after ten tries', async () => {
    const id = await newCanvas('Guarded')
    await setLink(id, { linkAccess: 'view', linkPassword: 'right' })
    for (let i = 0; i < 10; i++) expect((await joinLink(id, 'Walt', `wrong-${i}`)).status).toBe(401)
    expect((await joinLink(id, 'Walt', 'right')).status).toBe(429)
    /* eleven scrypt checks: slow by design, slower on a loaded machine */
  }, 60_000)
})
