/**
 * One sign-in with mm's boards: this Doop behind mm's sign-in gateway (the
 * mm fork's change; MM-GATEWAY.md says what and why).
 *
 * mm's gateway answers the web proxy's forward-auth for every request to
 * this Doop's public host. When it lets a request through, it adds
 * `X-Mm-Assertion`: base64url(JSON {u, r, h, exp, n}) "." an Ed25519
 * signature over that first part, made with the gateway's private key. u is
 * the person's name, r their role on the project (owner, designer, member or
 * viewer), h the host it is for, exp a time 60 s ahead (ms), n a nonce.
 *
 * With the gateway's public key configured (MM_GATEWAY_PUBLIC_KEY_FILE or
 * MM_GATEWAY_PUBLIC_KEY, plus MM_GATEWAY_HOST), Doop opens a second
 * listener (MM_GATEWAY_PORT, 4401) for the public side:
 *   - every request (and every WebSocket upgrade) needs a valid assertion
 *     for MM_GATEWAY_HOST; anything else is 401;
 *   - the person is the assertion's: their Doop account is made on their
 *     first visit (linked by an `mm-gateway` account row, never by email),
 *     and the request runs as a server-side session of that account. The
 *     client's own Cookie and Authorization headers are dropped, and no
 *     Set-Cookie leaves: the browser never holds a Doop session here, so no
 *     second login, and nothing outlives the gateway's say-so;
 *   - Doop's own sign-in, sign-up and account routes are refused (only
 *     GET /api/auth/get-session passes);
 *   - owner and designer edit; member and viewer only look (GET and HEAD,
 *     and every canvas at 'view' at most).
 * Doop's own listener (PORT) is unchanged: its own login, agent keys, MCP.
 * Without a gateway key there is no second listener and Doop is as before.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocketServer } from 'ws'
import { z } from 'zod'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { CanvasRole } from '../shared/canvasRole.ts'

export type GatewayRole = 'owner' | 'designer' | 'member' | 'viewer'
const ROLES: readonly string[] = ['owner', 'designer', 'member', 'viewer']
/** The gateway's names (the boards check the same pattern). */
const NAME = /^[a-z][a-z0-9._-]{1,31}$/
/** The account row that ties a Doop user to a gateway name. */
export const GATEWAY_PROVIDER = 'mm-gateway'
/** The email Doop's user row needs. No mail is ever sent there, and Doop's own sign-up refuses the domain. */
export const GATEWAY_EMAIL_DOMAIN = 'gateway.mm.invalid'

/* ------------------------------------------------------------ config */

export interface GatewayConfig {
  key: KeyObject
  host: string
  port: number
}

/** The gateway side's config, or null when no gateway is configured. A key without a host (or the other way round)
 *  refuses to boot: half a gateway is a misconfiguration, never a mode. */
export function loadGatewayConfig(e: NodeJS.ProcessEnv = process.env): GatewayConfig | null {
  const file = e.MM_GATEWAY_PUBLIC_KEY_FILE?.trim(), inline = e.MM_GATEWAY_PUBLIC_KEY?.trim()
  const host = (e.MM_GATEWAY_HOST || '').trim().toLowerCase()
  if (!file && !inline) {
    if (host || e.MM_GATEWAY_PORT) throw new Error('MM_GATEWAY_HOST/MM_GATEWAY_PORT are set but no gateway key (MM_GATEWAY_PUBLIC_KEY_FILE)')
    return null
  }
  const key = createPublicKey(inline ? inline.replace(/\\n/g, '\n') : readFileSync(file!, 'utf8'))
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`the gateway key is ${key.asymmetricKeyType}, not ed25519`)
  if (!host) throw new Error('a gateway key needs MM_GATEWAY_HOST: the public host its assertions must name')
  const port = Number(e.MM_GATEWAY_PORT || 4401)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`MM_GATEWAY_PORT is not a port: "${e.MM_GATEWAY_PORT}"`)
  return { key, host, port }
}

/* --------------------------------------------------------- assertion */

/** The person and role of a valid assertion for `host`, or null: the signature, the host, a future exp, a known role
 *  and a gateway name must all hold. */
export function verifyAssertion(header: unknown, key: KeyObject, host: string, now = Date.now()): { u: string; r: GatewayRole } | null {
  const parts = (typeof header === 'string' ? header : '').split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, sig] = parts
  try {
    if (!verify(null, Buffer.from(body), key, Buffer.from(sig, 'base64url'))) return null
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!c || typeof c !== 'object') return null
    if (c.h !== host || typeof c.exp !== 'number' || !(c.exp > now)) return null
    if (!ROLES.includes(c.r) || typeof c.u !== 'string' || !NAME.test(c.u)) return null
    return { u: c.u, r: c.r as GatewayRole }
  } catch {
    return null
  }
}

/** What a gateway role may do on this Doop's canvases: owner and designer edit, member and viewer look. */
export function capFor(role: GatewayRole): CanvasRole {
  return role === 'owner' || role === 'designer' ? 'edit' : 'view'
}

/* ------------------------------------------------- who came through */

/** How long the role of a person's last assertion holds for their open rooms (WebSockets get no new assertion; a
 *  room past this closes, and its reconnect goes through the gateway again). */
const ACCESS_MS = 10 * 60_000
const seen = new Map<string, { cap: CanvasRole; at: number }>()

/** For canvasRole: a gateway person's cap on every canvas here, null once their last assertion is too old, and
 *  undefined for anyone else (Doop's own rules apply). */
export function gatewayCap(userId: string | undefined, now = Date.now()): CanvasRole | null | undefined {
  const s = userId ? seen.get(userId) : undefined
  if (!s) return undefined
  return now - s.at < ACCESS_MS ? s.cap : null
}

/* ---------------------------------------------- accounts and sessions */

/** Set while the gateway makes an account: the user hooks (server/auth.ts) let the gateway's domain through only then,
 *  and skip the sign-up extras (first canvas, demo). */
export const gatewayCreating = new AsyncLocalStorage<true>()
export const isGatewayCreating = () => gatewayCreating.getStore() === true
export const isGatewayEmail = (email: string) => email.toLowerCase().endsWith(`@${GATEWAY_EMAIL_DOMAIN}`)

/** better-auth plugin: one server-only endpoint (no path, so no HTTP route) that finds or makes the account for a
 *  gateway name and opens a session for it. */
export const mmGateway = () => ({
  id: 'mm-gateway',
  endpoints: {
    mmGatewaySession: createAuthEndpoint({ method: 'POST', body: z.object({ name: z.string().regex(NAME) }) }, async (ctx) => {
      const { name } = ctx.body
      const ia = ctx.context.internalAdapter
      const account = await ia.findAccountByProviderId(name, GATEWAY_PROVIDER)
      let user = account ? await ia.findUserById(account.userId) : null
      if (!account) {
        const email = `${name}@${GATEWAY_EMAIL_DOMAIN}`
        /* someone holds the address without the link: never take that account over */
        if (await ia.findUserByEmail(email)) throw new APIError('CONFLICT', { message: `${email} exists without a gateway link` })
        user = (await gatewayCreating.run(true, () =>
          ia.createOAuthUser({ email, name, emailVerified: true }, { providerId: GATEWAY_PROVIDER, accountId: name }),
        )).user
        console.log(`⟡ mm gateway        new account for ${name}`)
      }
      if (!user || (user as { banned?: boolean | null }).banned) throw new APIError('FORBIDDEN', { message: 'no such account, or banned' })
      const session = await ia.createSession(user.id)
      await setSessionCookie(ctx, { session, user })
      return ctx.json({ userId: user.id })
    }),
  },
})

interface GatewayAuth {
  api: {
    getSession(o: { headers: Headers }): Promise<{ user: { id: string; banned?: boolean | null } } | null>
    mmGatewaySession(o: { body: { name: string }; returnHeaders: true }): Promise<{ headers: Headers; response: { userId: string } }>
  }
}

/** A person's session is checked again after this long (a ban, a deleted session or user ends it then). */
const RECHECK_MS = 10 * 60_000
const sessions = new Map<string, { userId: string; cookie: string; until: number }>()
/* a first visit is many requests at once (the page, its assets, its API calls): one account and one session for them */
const inflight = new Map<string, Promise<{ userId: string; cookie: string; until: number }>>()

function sessionFor(auth: GatewayAuth, name: string) {
  const hit = sessions.get(name)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit)
  let p = inflight.get(name)
  if (!p) {
    p = freshSession(auth, name).finally(() => inflight.delete(name))
    inflight.set(name, p)
  }
  return p
}

async function freshSession(auth: GatewayAuth, name: string) {
  const now = Date.now(), hit = sessions.get(name)
  if (hit && hit.until > now) return hit
  if (hit) {
    const s = await auth.api.getSession({ headers: new Headers({ cookie: hit.cookie }) }).catch(() => null)
    if (s && s.user.id === hit.userId && !s.user.banned) {
      hit.until = now + RECHECK_MS
      return hit
    }
    sessions.delete(name)
  }
  const { headers, response } = await auth.api.mmGatewaySession({ body: { name }, returnHeaders: true })
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const fresh = { userId: response.userId, cookie, until: now + RECHECK_MS }
  sessions.set(name, fresh)
  return fresh
}

/* ---------------------------------------------------- the public side */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Doop's own sign-in, sign-up and account routes: off on the public side (the gateway is the sign-in). */
function ownLogin(method: string, path: string): boolean {
  if (path === '/api/account-exists') return true
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return !(method === 'GET' && path === '/api/auth/get-session')
  return false
}
/** The path as any router may read it: decoded, backslashes as slashes, repeated slashes collapsed, dot segments
 *  resolved, lower case (express matches case-insensitively). Never parsed as a URL first: `//api/...` would be a host. */
export function pathOf(url: string | undefined): string {
  let p = String(url || '/').split(/[?#]/)[0]
  try {
    p = decodeURIComponent(p)
  } catch {}
  p = `/${p}`.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  try {
    p = new URL(`http://x${p}`).pathname
  } catch {}
  return p.toLowerCase()
}

type Admitted = { ok: true; userId: string } | { ok: false; status: number; message: string }

/** Who this request is, from its assertion only; the request then carries that person's server-side session. */
async function admit(cfg: GatewayConfig, auth: GatewayAuth, req: http.IncomingMessage): Promise<Admitted> {
  const assertion = req.headers['x-mm-assertion']
  delete req.headers.cookie
  delete req.headers.authorization
  delete req.headers['x-mm-assertion']
  const c = verifyAssertion(assertion, cfg.key, cfg.host)
  if (!c) return { ok: false, status: 401, message: 'Sign in through the gateway: open this address again.' }
  const cap = capFor(c.r), method = (req.method || 'GET').toUpperCase(), path = pathOf(req.url)
  if (cap !== 'edit' && !READ_METHODS.has(method)) return { ok: false, status: 403, message: `A ${c.r} can look, not change: ask the owner for designer access.` }
  if (ownLogin(method, path)) return { ok: false, status: 403, message: "Doop's own sign-in is off here: the gateway signs you in." }
  const s = await sessionFor(auth, c.u)
  seen.set(s.userId, { cap, at: Date.now() })
  req.headers.cookie = s.cookie
  return { ok: true, userId: s.userId }
}

/** No Set-Cookie leaves the public side: the session is the server's, per request, from the assertion. */
function dropSetCookie(res: http.ServerResponse) {
  const setHeader = res.setHeader.bind(res)
  res.setHeader = (name, value) => (String(name).toLowerCase() === 'set-cookie' ? res : setHeader(name, value))
  const appendHeader = res.appendHeader?.bind(res)
  if (appendHeader) res.appendHeader = (name, value) => (String(name).toLowerCase() === 'set-cookie' ? res : appendHeader(name, value))
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => http.ServerResponse
  res.writeHead = ((...a: unknown[]) => {
    res.removeHeader('set-cookie')
    for (let i = 1; i < a.length; i++) {
      const h = a[i]
      if (Array.isArray(h)) {
        /* the raw form: [name, value, name, value, ...] or [[name, value], ...] */
        if (h.length && Array.isArray(h[0])) a[i] = h.filter((kv: unknown[]) => String(kv[0]).toLowerCase() !== 'set-cookie')
        else {
          const kept: unknown[] = []
          for (let j = 0; j + 1 < h.length; j += 2) if (String(h[j]).toLowerCase() !== 'set-cookie') kept.push(h[j], h[j + 1])
          a[i] = kept
        }
      } else if (h && typeof h === 'object') {
        a[i] = Object.fromEntries(Object.entries(h).filter(([k]) => k.toLowerCase() !== 'set-cookie'))
      }
    }
    return writeHead(...a)
  }) as typeof res.writeHead
}

function refuse(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: message }))
}

/** The public side's listener: the gateway's assertion on every request and upgrade, then Doop's own app and rooms. */
export function startGatewaySide(
  cfg: GatewayConfig,
  auth: GatewayAuth,
  app: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  wss: WebSocketServer,
): http.Server {
  const server = http.createServer((req, res) => {
    admit(cfg, auth, req)
      .then((a) => {
        if (!a.ok) return refuse(res, a.status, a.message)
        dropSetCookie(res)
        app(req, res)
      })
      .catch((err) => {
        console.error('[mm-gateway] request failed', err instanceof Error ? err.message : err)
        if (!res.headersSent) refuse(res, 500, 'sign-in failed')
        else res.end()
      })
  })
  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const close = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    }
    if (pathOf(req.url) !== '/ws') return close(404, 'Not Found')
    admit(cfg, auth, req)
      .then((a) => {
        if (!a.ok) return close(a.status, a.status === 401 ? 'Unauthorized' : 'Forbidden')
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      })
      .catch(() => close(500, 'Internal Server Error'))
  })
  server.listen(cfg.port, () => {
    console.log(`⟡ mm gateway side   http://localhost:${cfg.port} for ${cfg.host}: the gateway's assertion on every request; Doop's own sign-in off here`)
  })
  return server
}
