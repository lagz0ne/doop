import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'
import { stubEnv, unstubAllEnvs } from './envStub.ts'

/* The operator API (server/operator.ts) on a real server whose sign-up is
   closed the way a one-person instance closes it: an allowlist nobody's
   address matches. */

const TOKEN = 'operator-test-token-0123456789abcdef'
let server: Server

beforeAll(async () => {
  server = await startServer({ DOOP_ADMIN_TOKEN: TOKEN, SIGNUP_EMAIL_DOMAINS: 'signup-closed.invalid' })
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

  describe('env', () => {
    afterEach(() => unstubAllEnvs())
    it('rejects a token shorter than 32 characters at boot', () => {
      expect(() => stubEnv('DOOP_ADMIN_TOKEN', 'short')).toThrow(/DOOP_ADMIN_TOKEN/)
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
