import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'
import { env } from '../server/env.ts'
import { stubEnv, unstubAllEnvs } from './envStub.ts'

/* The operator API (server/operator.ts) on a real server whose sign-up is
   closed the way a one-person instance closes it: an allowlist nobody's
   address matches. */

const TOKEN = 'operator-test-token-0123456789abcdef'
let server: Server

beforeAll(async () => {
  server = await startServer({
    DOOP_ADMIN_TOKEN: TOKEN,
    SIGNUP_EMAIL_DOMAINS: 'signup-closed.invalid',
    /* the webhook tests deliver to a receiver on this machine */
    WEBHOOK_ALLOW_PRIVATE_URLS: 'true',
  })
}, 70_000)

afterAll(() => server?.stop())

function op(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) {
  const token = init.token === undefined ? TOKEN : init.token
  return fetch(`${server.base}/api/operator${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

async function json<T = Record<string, unknown>>(res: Response, status: number): Promise<T> {
  const text = await res.text()
  expect(res.status, text).toBe(status)
  return JSON.parse(text) as T
}

async function signIn(email: string, password: string): Promise<{ client: Client; status: number }> {
  const client = new Client(server)
  const res = await client.post('/api/auth/sign-in/email', { email, password })
  return { client, status: res.status }
}

async function createUser(email: string, password = 'password12345') {
  return json<{ user: { id: string; email: string } }>(
    await op('/users', { body: { email, name: email.split('@')[0], password } }),
    201,
  )
}

describe('operator API: the token', () => {
  it('refuses a missing or wrong token', async () => {
    expect((await op('/users', { token: null })).status).toBe(401)
    expect((await op('/users', { token: 'x'.repeat(40) })).status).toBe(401)
  })

  it('answers an unknown route itself instead of falling through to the session gate', async () => {
    expect((await op('/nope')).status).toBe(404)
  })

  it('does not exist without DOOP_ADMIN_TOKEN', async () => {
    const plain = await startServer()
    try {
      const res = await fetch(`${plain.base}/api/operator/users`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      expect(res.status).toBe(404)
    } finally {
      plain.stop()
    }
  }, 70_000)

  it('serves proxied calls unless DOOP_OPERATOR_DIRECT_ONLY is set', async () => {
    const proxied = { 'X-Forwarded-For': '203.0.113.7' }
    const viaProxy = await fetch(`${server.base}/api/operator/users`, {
      headers: { Authorization: `Bearer ${TOKEN}`, ...proxied },
    })
    expect(viaProxy.status).toBe(200)

    const direct = await startServer({ DOOP_ADMIN_TOKEN: TOKEN, DOOP_OPERATOR_DIRECT_ONLY: 'true' })
    try {
      const call = (headers: Record<string, string>) =>
        fetch(`${direct.base}/api/operator/users`, { headers: { Authorization: `Bearer ${TOKEN}`, ...headers } })
      expect((await call({})).status).toBe(200)
      expect((await call(proxied)).status).toBe(404)
      expect((await call({ Forwarded: 'for=203.0.113.7;proto=https' })).status).toBe(404)
    } finally {
      direct.stop()
    }
  }, 70_000)

  it('moves to a listener of its own with DOOP_OPERATOR_LISTEN, and the public port has none', async () => {
    const port = await freePort()
    const split = await startServer({ DOOP_ADMIN_TOKEN: TOKEN, DOOP_OPERATOR_LISTEN: `127.0.0.1:${port}` })
    try {
      const auth = { Authorization: `Bearer ${TOKEN}` }
      /* the public port: no operator surface, token or not, proxy headers or not */
      expect((await fetch(`${split.base}/api/operator/users`, { headers: auth })).status).toBe(404)
      /* its own listener: the whole API, JSON bodies included */
      const own = `http://127.0.0.1:${port}/api/operator`
      expect((await fetch(`${own}/users`, { headers: auth })).status).toBe(200)
      expect((await fetch(`${own}/users`)).status).toBe(401)
      const created = await fetch(`${own}/users`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'listener@example.com', name: 'Listener', password: 'password12345' }),
      })
      expect(created.status).toBe(201)
      /* and nothing else lives there */
      expect((await fetch(`http://127.0.0.1:${port}/api/me`, { headers: auth })).status).toBe(404)
    } finally {
      split.stop()
    }
  }, 70_000)

  describe('env', () => {
    afterEach(() => unstubAllEnvs())
    it('rejects a token shorter than 32 characters at boot', () => {
      expect(() => stubEnv('DOOP_ADMIN_TOKEN', 'short')).toThrow(/DOOP_ADMIN_TOKEN/)
    })
    it('reads DOOP_OPERATOR_LISTEN as [host:]port, loopback by default', () => {
      stubEnv('DOOP_OPERATOR_LISTEN', '4401')
      expect(env.DOOP_OPERATOR_LISTEN).toEqual({ host: '127.0.0.1', port: 4401 })
      stubEnv('DOOP_OPERATOR_LISTEN', '0.0.0.0:4401')
      expect(env.DOOP_OPERATOR_LISTEN).toEqual({ host: '0.0.0.0', port: 4401 })
      stubEnv('DOOP_OPERATOR_LISTEN', '[::1]:4401')
      expect(env.DOOP_OPERATOR_LISTEN).toEqual({ host: '::1', port: 4401 })
      for (const bad of ['host', '::1:4401', '127.0.0.1:0', '127.0.0.1:70000'])
        expect(() => stubEnv('DOOP_OPERATOR_LISTEN', bad), bad).toThrow(/DOOP_OPERATOR_LISTEN/)
    })
  })
})

describe('operator API: users', () => {
  it('creates an account while sign-up is closed, with a generated password and no first canvas', async () => {
    const created = await json<{ user: { id: string }; password: string }>(
      await op('/users', { body: { email: 'Guest@Example.com', name: 'Guest' } }),
      201,
    )
    expect(created.password.length).toBeGreaterThanOrEqual(16)

    const { client, status } = await signIn('guest@example.com', created.password)
    expect(status).toBe(200)
    expect(await json<unknown[]>(await client.get('/api/canvases'), 200)).toEqual([])

    /* the browser's sign-up is still closed */
    const outsider = new Client(server)
    const signup = await outsider.post('/api/auth/sign-up/email', {
      email: 'outsider@example.com',
      password: 'password12345',
      name: 'Outsider',
    })
    expect(signup.status).toBe(400)

    expect((await op('/users', { body: { email: 'guest@example.com' } })).status).toBe(409)
  })

  it('sets a password, bans and unbans', async () => {
    await createUser('pw@example.com', 'first-password-1')
    await json(await op('/users/pw@example.com/password', { body: { password: 'second-password-2' } }), 200)
    expect((await signIn('pw@example.com', 'first-password-1')).status).toBe(401)
    expect((await signIn('pw@example.com', 'second-password-2')).status).toBe(200)

    await json(await op('/users/pw@example.com/ban', { body: { reason: 'test' } }), 200)
    expect((await signIn('pw@example.com', 'second-password-2')).status).not.toBe(200)
    await json(await op('/users/pw@example.com/unban', { body: {} }), 200)
    expect((await signIn('pw@example.com', 'second-password-2')).status).toBe(200)
  })

  it('mints, lists and revokes agent keys', async () => {
    await createUser('keys@example.com')
    const key = await json<{ id: string; secret: string }>(
      await op('/users/keys@example.com/keys', { body: { name: 'ci' } }),
      201,
    )
    expect(key.secret).toMatch(/^dpk_/)
    const listed = await json<{ id: string; name: string }[]>(await op('/users/keys@example.com/keys'), 200)
    expect(listed.map((k) => k.name)).toEqual(['ci'])
    await json(await op(`/users/keys@example.com/keys/${key.id}`, { method: 'DELETE' }), 200)
    expect(await json<unknown[]>(await op('/users/keys@example.com/keys'), 200)).toEqual([])
  })

  it('previews a deletion, then deletes the account and the canvases only it could reach', async () => {
    await createUser('leaver@example.com')
    const { client } = await signIn('leaver@example.com', 'password12345')
    const canvas = await json<{ id: string }>(await client.post('/api/canvases', { name: 'Solo work' }), 200)

    const plan = await json<{ deletes: { id: string }[] }>(
      await op('/users/leaver@example.com?dryRun=1', { method: 'DELETE' }),
      200,
    )
    expect(plan.deletes.map((c) => c.id)).toEqual([canvas.id])
    expect((await op(`/canvases/${canvas.id}`)).status).toBe(200) // a dry run changes nothing

    await json(await op('/users/leaver@example.com', { method: 'DELETE' }), 200)
    expect((await op('/users/leaver@example.com')).status).toBe(404)
    expect((await op(`/canvases/${canvas.id}`)).status).toBe(404)
  })
})

describe('operator API: sharing', () => {
  it('adds and removes members, sets link access and hands a canvas over', async () => {
    await createUser('owner@example.com')
    await createUser('friend@example.com')
    const owner = (await signIn('owner@example.com', 'password12345')).client
    const friend = (await signIn('friend@example.com', 'password12345')).client
    const { id } = await json<{ id: string }>(await owner.post('/api/canvases', { name: 'Shared work' }), 200)

    expect((await friend.get(`/api/canvases/${id}`)).status).toBe(403)
    const added = await json<{ members: { email: string }[] }>(
      await op(`/canvases/${id}/members`, { body: { user: 'friend@example.com' } }),
      200,
    )
    expect(added.members.map((m) => m.email)).toEqual(['friend@example.com'])
    expect((await friend.get(`/api/canvases/${id}`)).status).toBe(200)

    await json(await op(`/canvases/${id}/members/friend@example.com`, { method: 'DELETE' }), 200)
    expect((await friend.get(`/api/canvases/${id}`)).status).toBe(403)

    expect((await op(`/canvases/${id}/link`, { method: 'PUT', body: { access: 'owner' } })).status).toBe(400)
    const linked = await json<{ linkAccess: string }>(
      await op(`/canvases/${id}/link`, { method: 'PUT', body: { access: 'view' } }),
      200,
    )
    expect(linked.linkAccess).toBe('view')
    expect((await friend.get(`/api/canvases/${id}`)).status).toBe(200)
    await json(await op(`/canvases/${id}/link`, { method: 'PUT', body: { access: 'none' } }), 200)

    const moved = await json<{ owner: { email: string }; members: { email: string }[] }>(
      await op(`/canvases/${id}/owner`, { body: { user: 'friend@example.com' } }),
      200,
    )
    expect(moved.owner.email).toBe('friend@example.com')
    expect(moved.members.map((m) => m.email)).toEqual(['owner@example.com'])
    expect((await owner.get(`/api/canvases/${id}`)).status).toBe(200)

    const listed = await json<{ id: string; owner: string }[]>(await op('/canvases'), 200)
    expect(listed.find((c) => c.id === id)?.owner).toBe('friend@example.com')
  })

  it('will not add someone who has no account', async () => {
    await createUser('lonely@example.com')
    const { client } = await signIn('lonely@example.com', 'password12345')
    const { id } = await json<{ id: string }>(await client.post('/api/canvases', { name: 'Mine' }), 200)
    expect((await op(`/canvases/${id}/members`, { body: { user: 'ghost@example.com' } })).status).toBe(404)
  })
})

/** A webhook receiver on a free local port: every delivery's parsed body. */
async function receiver() {
  const bodies: Record<string, unknown>[] = []
  const http = createServer((req, res) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      bodies.push(JSON.parse(data) as Record<string, unknown>)
      res.end('ok')
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/hook`, bodies, close: () => http.close() }
}

async function until<T>(read: () => T | undefined, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('operator API: webhooks', () => {
  it('creates a hook limited to one canvas, whose comment payloads name the element', async () => {
    await createUser('hooks@example.com')
    const { client } = await signIn('hooks@example.com', 'password12345')
    const watched = await json<{ id: string }>(await client.post('/api/canvases', { name: 'Watched' }), 200)
    const other = await json<{ id: string }>(await client.post('/api/canvases', { name: 'Other' }), 200)
    const frameIn = async (canvasId: string) => {
      const f = await json<{ id: string }>(await client.post(`/api/canvases/${canvasId}/frames`, { name: 'F' }), 200)
      await json(await client.patch(`/api/frames/${f.id}`, { html: '<main><h1 id="t">Hello</h1></main>' }), 200)
      return f.id
    }
    const watchedFrame = await frameIn(watched.id)
    const otherFrame = await frameIn(other.id)
    const rx = await receiver()
    try {
      /* a canvas the account cannot open is refused with the reason */
      const stranger = await createUser('hooks-stranger@example.com')
      expect(stranger.user.id).toBeTruthy()
      const refused = await op('/users/hooks-stranger@example.com/webhooks', {
        body: { url: rx.url, events: ['comment.created'], canvasIds: [watched.id] },
      })
      expect(refused.status).toBe(400)
      expect(((await refused.json()) as { error: string }).error).toMatch(/no canvas/)

      const hook = await json<{ id: string; secret: string; canvasIds: string[] }>(
        await op('/users/hooks@example.com/webhooks', {
          body: { url: rx.url, events: ['comment.created'], canvasIds: [watched.id] },
        }),
        201,
      )
      expect(hook.secret).toMatch(/^whsec_/)
      expect(hook.canvasIds).toEqual([watched.id])
      const listed = await json<{ id: string }[]>(await op('/users/hooks@example.com/webhooks'), 200)
      expect(listed.map((h) => h.id)).toEqual([hook.id])
      expect(listed[0]).not.toHaveProperty('secret')

      /* an agent comment on the other canvas is not delivered; one on the watched canvas is */
      const key = await json<{ secret: string }>(
        await op('/users/hooks@example.com/keys', { body: { name: 'a' } }),
        201,
      )
      const addComment = async (canvasId: string, frameId: string) => {
        const res = await fetch(`${server.base}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${key.secret}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'add_comment',
              arguments: { canvas_id: canvasId, frame_id: frameId, selector: '#t', text: 'Bigger', agent_name: 'Bot' },
            },
          }),
        })
        const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
        expect(body.result.isError, body.result.content[0]?.text).toBeFalsy()
        return JSON.parse(body.result.content[0]!.text) as { id: string; elementId: string }
      }
      await addComment(other.id, otherFrame)
      const made = await addComment(watched.id, watchedFrame)
      const delivered = await until(() => rx.bodies.find((b) => b.type === 'comment.created'))
      expect(rx.bodies).toHaveLength(1)
      expect(delivered).toMatchObject({
        canvas: { id: watched.id },
        actor: { kind: 'agent' },
        comment: { id: made.id, frameId: watchedFrame, elementId: made.elementId },
      })
      expect((delivered.comment as { snippet: string }).snippet).toMatch(/^<h1 id="t" data-doop-id=.*Hello<\/h1>$/)

      /* disable, test, widen to every canvas, delete */
      const off = await json<{ enabled: boolean }>(
        await op(`/users/hooks@example.com/webhooks/${hook.id}`, { method: 'PATCH', body: { enabled: false } }),
        200,
      )
      expect(off.enabled).toBe(false)
      const ping = await json<{ ok: boolean }>(
        await op(`/users/hooks@example.com/webhooks/${hook.id}/test`, { body: {} }),
        200,
      )
      expect(ping.ok).toBe(true)
      const all = await json<{ canvasIds: string[]; enabled: boolean }>(
        await op(`/users/hooks@example.com/webhooks/${hook.id}`, {
          method: 'PATCH',
          body: { canvasIds: [], enabled: true },
        }),
        200,
      )
      expect(all).toMatchObject({ canvasIds: [], enabled: true })
      expect((await op(`/users/hooks-stranger@example.com/webhooks/${hook.id}`, { method: 'DELETE' })).status).toBe(404)
      await json(await op(`/users/hooks@example.com/webhooks/${hook.id}`, { method: 'DELETE' }), 200)
      expect(await json(await op('/users/hooks@example.com/webhooks'), 200)).toEqual([])
    } finally {
      rx.close()
    }
  })
})
