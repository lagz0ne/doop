import { SignJWT } from 'jose'
import WebSocket from 'ws'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client, freePort, startServer, type Server } from './harness.ts'
import { stubEnv, unstubAllEnvs } from './envStub.ts'

/* The embedded review panel's sign-in (server/embed.ts) on a real server
   whose sign-up is closed the way production's is. */

const SECRET = 'app-embed-secret-0123456789abcdef'
const ADMIN = 'operator-token-for-embed-tests-0123456789'
const HOSTS = JSON.stringify({ app: { secret: SECRET, origin: 'https://app.example.com' } })
let server: Server
let owner: Client
let canvasId: string
let otherCanvasId: string
let frameId: string

async function token(
  claims: Record<string, unknown> = {},
  opts: { secret?: string; iatAgo?: number; life?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000) - (opts.iatAgo ?? 0)
  return new SignJWT({ name: 'Rita Reviewer', canvas: canvasId, role: 'review', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('app')
    .setAudience('doop')
    .setSubject('user-42')
    .setJti(`jti-${Math.random()}`)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.life ?? 120))
    .sign(new TextEncoder().encode(opts.secret ?? SECRET))
}

async function exchange(jwt: string, on: Server = server, origin = on.base) {
  const client = new Client(on)
  const res = await client.req('/api/auth/embed/session', {
    method: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify({ token: jwt }),
  })
  return {
    client,
    res,
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

/** Join a room; resolves with the init (or the close code) and every later message. */
function join(client: Client, id: string) {
  const messages: { type: string }[] = []
  const ws = new WebSocket(`ws://localhost:${server.port}/ws`, { headers: { Cookie: client.header() } })
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
      resolve(code)
    })
    ws.on('error', () => {})
  })
  return { ready, messages, close: () => ws.close() }
}

function operator(path: string) {
  return fetch(`${server.base}/api/operator${path}`, { headers: { Authorization: `Bearer ${ADMIN}` } })
}

beforeAll(async () => {
  server = await startServer({ DOOP_EMBED_HOSTS: HOSTS, DOOP_ADMIN_TOKEN: ADMIN })
  owner = await new Client(server).signUp('owner@example.com', 'Olive Owner')
  canvasId = ((await (await owner.post('/api/canvases', { name: 'Review me' })).json()) as { id: string }).id
  otherCanvasId = ((await (await owner.post('/api/canvases', { name: 'Not yours' })).json()) as { id: string }).id
  const frame = await owner.post(`/api/canvases/${canvasId}/frames`, {
    name: 'Home',
    width: 400,
    height: 300,
    html: '<html><body><h1>Hi</h1></body></html>',
  })
  frameId = ((await frame.json()) as { id: string }).id
  await owner.put(`/api/canvases/${canvasId}/guidelines/brand`, { markdown: '# Brand\n\nTeam memory.' })
}, 90_000)

afterAll(() => server?.stop())

describe('embed session exchange', () => {
  it('answers with the grant, the host origin and the reviewer, and sets a session cookie', async () => {
    const { status, body, res } = await exchange(await token())
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({
      canvasId,
      role: 'review',
      hostOrigin: 'https://app.example.com',
      user: { name: 'Rita Reviewer' },
    })
    expect(body!.expiresAt).toBeGreaterThan(Date.now() + 60 * 60 * 1000)
    /* host-only: no Domain attribute, so a panel on its own hostname keeps its own cookie */
    const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token'))!
    expect(cookie).toBeTruthy()
    expect(cookie.toLowerCase()).not.toContain('domain=')
  })

  it('confines the session to its canvas, its role and the panel routes', async () => {
    const { client } = await exchange(await token())
    expect((await client.get(`/api/canvases/${otherCanvasId}`)).status).toBe(403)
    expect((await client.get('/api/canvases')).status).toBe(403)
    expect((await client.post('/api/canvases', { name: 'x' })).status).toBe(403)
    expect((await client.post('/api/agent-keys', { name: 'x' })).status).toBe(403)
    expect((await client.patch(`/api/frames/${frameId}`, { html: '<p>no</p>' })).status).toBe(403)
    expect((await client.put(`/api/canvases/${canvasId}/guidelines/brand`, { markdown: 'no' })).status).toBe(403)
    expect((await client.get(`/api/frames/${frameId}/versions`)).status).toBe(200)
    const other = join(client, otherCanvasId)
    expect(await other.ready).toBe(4403)

    /* a comment and a verdict are what the panel is for */
    const comment = await client.post(`/api/frames/${frameId}/comments`, { text: 'Bigger headline', x: 10, y: 10 })
    expect(comment.status, await comment.clone().text()).toBe(200)
    const canvas = (await (await client.get(`/api/canvases/${canvasId}`)).json()) as {
      role: string
      frames: { id: string; updatedAt: number }[]
    }
    expect(canvas.role).toBe('review')
    const verdict = await client.req(`/api/frames/${frameId}/approval`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'changes_requested',
        expectedUpdatedAt: canvas.frames.find((f) => f.id === frameId)!.updatedAt,
      }),
    })
    expect(verdict.status, await verdict.clone().text()).toBe(200)
  })

  it("reads the canvas and the room without the team's agent work or memory", async () => {
    const { client } = await exchange(await token())
    const canvas = (await (await client.get(`/api/canvases/${canvasId}`)).json()) as Record<string, unknown>
    expect(canvas.frames).toBeTruthy()
    expect(canvas.guidelines).toBeUndefined()
    expect(canvas.memberIds).toBeUndefined()

    const room = join(client, canvasId)
    const init = (await room.ready) as Record<string, unknown> & { canvas: Record<string, unknown> }
    expect(init.canvas.role).toBe('review')
    expect(init.canvas.guidelines).toBeUndefined()
    expect(init.tasks).toEqual([])
    expect(init.activity).toEqual([])
    expect((init.comments as unknown[]).length).toBeGreaterThan(0)
    /* live: a comment reaches the reviewer, a memory edit does not */
    await owner.put(`/api/canvases/${canvasId}/guidelines/brand`, { markdown: '# Brand\n\nChanged.' })
    await owner.post(`/api/frames/${frameId}/comments`, { text: 'Agreed', x: 20, y: 20 })
    await expect.poll(() => room.messages.some((m) => m.type === 'comment'), { timeout: 8000 }).toBe(true)
    expect(room.messages.some((m) => m.type === 'guidelines' || m.type === 'activity')).toBe(false)
    room.close()
  })

  it('gives a reviewer the verdict history over REST, the room init and live updates', async () => {
    type Approval = { verdict?: string; history?: { status: string; versionId?: string }[] }
    type WithFrames = { frames: { id: string; updatedAt: number; approval?: Approval | null }[] }
    const { client } = await exchange(await token())
    const room = join(client, canvasId)
    const init = (await room.ready) as { canvas: WithFrames }
    expect(init.canvas.frames.find((f) => f.id === frameId)!.approval?.history?.length).toBeGreaterThan(0)

    const current = ((await (await owner.get(`/api/canvases/${canvasId}`)).json()) as WithFrames).frames.find(
      (f) => f.id === frameId,
    )!
    const res = await owner.req(`/api/frames/${frameId}/approval`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'ready_for_dev', expectedUpdatedAt: current.updatedAt }),
    })
    expect(res.status, await res.clone().text()).toBe(200)
    await expect
      .poll(() =>
        room.messages.some(
          (m) =>
            m.type === 'frame:updated' &&
            (m as { frame?: { approval?: Approval } }).frame?.approval?.history?.at(-1)?.status === 'ready_for_dev',
        ),
      )
      .toBe(true)
    room.close()

    const read = ((await (await client.get(`/api/canvases/${canvasId}`)).json()) as WithFrames).frames.find(
      (f) => f.id === frameId,
    )!
    expect(read.approval?.verdict).toBe('ready_for_dev')
    const statuses = read.approval!.history!.map((e) => e.status)
    expect(statuses.slice(-2)).toEqual(['changes_requested', 'ready_for_dev'])
    /* the reviewed state of each verdict is open to the panel for compare */
    const versionId = read.approval!.history!.at(-1)!.versionId!
    await expect
      .poll(async () => (await client.get(`/api/frames/${frameId}/versions/${versionId}`)).status, { timeout: 8000 })
      .toBe(200)
  })

  it('refuses a replayed, expired, forged, over-long or over-privileged token', async () => {
    const once = await token()
    expect((await exchange(once)).status).toBe(200)
    expect((await exchange(once)).status).toBe(401) // replay
    expect((await exchange(await token({}, { iatAgo: 600, life: 120 }))).status).toBe(401) // expired
    expect((await exchange(await token({}, { secret: 'x'.repeat(40) }))).status).toBe(401) // forged
    expect((await exchange(await token({}, { life: 3600 }))).status).toBe(401) // lives too long
    expect((await exchange(await token({ role: 'edit' }))).status).toBe(401) // never edit
    expect((await exchange(await token({ canvas: 'nope' }))).status).toBe(401)
    expect((await exchange('not.a.jwt')).status).toBe(401)
  })

  it('keeps the shadow reviewer out of every other way in, and out of the lists', async () => {
    const { client } = await exchange(await token())
    const me = (await (await client.get('/api/me')).json()) as { email: string }
    expect(me.email).toMatch(/@app\.embed\.invalid$/)
    const signIn = await new Client(server).post('/api/auth/sign-in/email', {
      email: me.email,
      password: 'password12345',
    })
    expect(signIn.status).toBe(401)
    const shown = (await (await operator(`/users/${encodeURIComponent(me.email)}`)).json()) as { canvases: unknown[] }
    expect(shown.canvases).toEqual([]) // no first canvas, no membership
    const listed = (await (await operator('/users')).json()) as { email: string }[]
    expect(listed.map((u) => u.email)).not.toContain(me.email)
    const all = (await (await operator('/users?all=1')).json()) as { email: string }[]
    expect(all.map((u) => u.email)).toContain(me.email)
  })
})

describe('embed hosts', () => {
  afterEach(() => unstubAllEnvs())

  it('lists the configured host origins and skips an entry that does not fit', async () => {
    const { embedHostOrigins } = await import('../server/embed.ts')
    stubEnv('DOOP_EMBED_HOSTS', undefined)
    expect(embedHostOrigins()).toEqual([])
    stubEnv(
      'DOOP_EMBED_HOSTS',
      JSON.stringify({
        app: { secret: SECRET, origin: 'https://app.example.com' },
        wiki: { secret: SECRET, origin: 'https://wiki.example.com' },
        short: { secret: 'too short', origin: 'https://x.example.com' },
        noOrigin: { secret: SECRET },
      }),
    )
    expect(embedHostOrigins()).toEqual(['https://app.example.com', 'https://wiki.example.com'])
  })
})

describe('a panel on its own hostname', () => {
  /* production trusts BETTER_AUTH_URL and TRUSTED_ORIGINS only: the panel's
     own origin (here 127.0.0.1 next to the server's localhost) must be listed */
  it('needs its origin in TRUSTED_ORIGINS, then works there with its own cookie', async () => {
    for (const trusted of [false, true]) {
      const port = await freePort()
      const panel = `http://127.0.0.1:${port}`
      const prod = await startServer({
        PORT: String(port),
        NODE_ENV: 'production',
        /* vitest sets TEST=true, which turns better-auth's origin check off
           (isTest); production never has it */
        TEST: '',
        BETTER_AUTH_SECRET: 'embed-hostname-test-secret-0123456789abcdef',
        DOOP_EMBED_HOSTS: HOSTS,
        ...(trusted && { TRUSTED_ORIGINS: panel }),
      })
      try {
        /* the origin check is live here, so the owner signs up from the server's own origin */
        const owner = new Client(prod)
        const signUp = await owner.req('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { Origin: prod.base },
          body: JSON.stringify({
            email: `owner-${trusted}@example.com`,
            password: 'password12345',
            name: 'Olive Owner',
          }),
        })
        expect(signUp.status, await signUp.clone().text()).toBe(200)
        canvasId = ((await (await owner.post('/api/canvases', { name: 'Prod' })).json()) as { id: string }).id
        const res = await fetch(`${panel}/api/auth/embed/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: panel },
          body: JSON.stringify({ token: await token() }),
        })
        expect(res.status, `${trusted}: ${await res.clone().text()}`).toBe(trusted ? 200 : 403)
        if (!trusted) continue
        const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token'))!
        expect(cookie.toLowerCase()).not.toContain('domain=')
        const read = await fetch(`${panel}/api/canvases/${canvasId}`, { headers: { Cookie: cookie.split(';')[0]! } })
        expect(read.status).toBe(200)
      } finally {
        prod.stop()
      }
    }
  }, 120_000)
})
