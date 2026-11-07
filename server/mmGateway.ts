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
 *
 * Every page of the public side shows a small "Source" link (the AGPL's
 * section 13: the people who use this Doop over the network are offered its
 * source): DOOP_SOURCE_URL, the fork's source at the tag this image is built
 * from (DOOP_SOURCE_TAG); mm sets both. Without a URL, the link goes to a
 * page of this side that says what is known: the tag, upstream, mm's patches.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
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
  source: Source
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
  return { key, host, port, source: sourceOf(e) }
}

/* ------------------------------------------- the source (AGPL sec. 13) */

/** Where the source link of the public side goes: the fork at its tag, or this side's own page about it. */
export interface Source {
  tag: string
  url: string
}
const TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/
/** The public side's own page about the source, when no URL is configured (not one of Doop's own routes). */
export const SOURCE_PAGE = '/.mm-source'

/** DOOP_SOURCE_TAG (the fork's tag, as mm pins it) and DOOP_SOURCE_URL (its source at that tag: http or https, no
 *  credentials). No URL, or not such a one: the link goes to SOURCE_PAGE, which says what is known. */
export function sourceOf(e: NodeJS.ProcessEnv = process.env): Source {
  const t = (e.DOOP_SOURCE_TAG || '').trim(), tag = TAG.test(t) ? t : 'unknown'
  const raw = (e.DOOP_SOURCE_URL || '').trim()
  let url = ''
  if (raw) {
    try {
      const u = new URL(raw)
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) url = u.href
    } catch {}
    if (!url) console.warn("[mm-gateway] DOOP_SOURCE_URL is not an http(s) URL: the source link goes to this side's own page")
  }
  return { tag, url: url || `${SOURCE_PAGE}/${encodeURIComponent(tag)}` }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** The link's look: small and plain, in a corner, over the app (an attribute: a strict CSP gets its hash). */
export const LINK_STYLE =
  'position:fixed;left:8px;bottom:6px;z-index:2147483647;font:11px/1.5 system-ui,sans-serif;color:#555;' +
  'background:rgba(255,255,255,.85);padding:0 6px;border-radius:4px;text-decoration:none'
const LINK_STYLE_HASH = `'sha256-${createHash('sha256').update(LINK_STYLE).digest('base64')}'`

export function sourceLink(href: string): string {
  return `<a id="mm-source" href="${esc(href)}" target="_blank" rel="noopener" title="The source of this Doop (AGPL-3.0)" style="${LINK_STYLE}">Source</a>`
}

/** The page with the source link, just before its </body> (or at its end). */
export function withSourceLink(html: string, href: string): string {
  const i = html.toLowerCase().lastIndexOf('</body')
  return i < 0 ? html + sourceLink(href) : html.slice(0, i) + sourceLink(href) + html.slice(i)
}

/** A Content-Security-Policy that lets the link's style attribute through: its hash where style attributes are
 *  checked (style-src-attr, else style-src, else default-src), unless 'unsafe-inline' already counts there. */
export function allowLinkStyle(csp: string): string {
  const dirs = csp.split(';').map((d) => d.trim()).filter(Boolean)
  const at = (n: string) => dirs.findIndex((d) => d.split(/\s+/)[0].toLowerCase() === n)
  let i = at('style-src-attr')
  if (i < 0) i = at('style-src')
  if (i < 0) {
    const d = at('default-src')
    if (d < 0) return csp
    dirs.push(`style-src-attr ${dirs[d].split(/\s+/).slice(1).join(' ')}`.trim())
    i = dirs.length - 1
  }
  const [name, ...vals] = dirs[i].split(/\s+/), low = vals.map((v) => v.toLowerCase())
  const inlineCounts = low.includes("'unsafe-inline'") && !low.some((v) => /^'(nonce-|sha(256|384|512)-|strict-dynamic)/.test(v))
  if (inlineCounts) return dirs.join('; ')
  const kept = vals.filter((v) => v.toLowerCase() !== "'none'")
  dirs[i] = [name, ...kept, ...(low.includes("'unsafe-hashes'") ? [] : ["'unsafe-hashes'"]), LINK_STYLE_HASH].join(' ')
  return dirs.join('; ')
}

/** This side's own page about the source (no URL configured): the tag, upstream, mm's patches. */
function sourcePage(res: http.ServerResponse, source: Source, method: string) {
  const up = /^v?(\d+\.\d+\.\d+)-mm\./.exec(source.tag)?.[1]
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Source of this Doop</title></head><body>
<h1>Source of this Doop</h1>
<p>This is Doop (AGPL-3.0) as mm runs it: the mm fork, tag <code>${esc(source.tag)}</code>. It is upstream Doop${up ? ` ${esc(up)}` : ''}
with mm's patches on it, in mm's repository: <code>box/doop/0001-gateway-assertion.patch</code> and
<code>box/doop/0002-source-link.patch</code> (they are the whole change, applied in that order).</p>
<p>No repository address for the fork is configured here, so this page is what this server knows. The operator of
this site gives you the complete source of this version on request.</p>
</body></html>
`
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(method === 'HEAD' ? undefined : body)
}

/** The largest page the link is put into (the app shell is a few kB); anything bigger passes as it is. */
const MAX_PAGE = 2 * 1024 * 1024

/** A browser's page request: asked in full and not compressed, so the link can go in (and a page cached without it,
 *  or with an older link, is not reused). */
function wantsPage(req: http.IncomingMessage) {
  if ((req.method || 'GET').toUpperCase() !== 'GET' || !/text\/html/i.test(String(req.headers.accept || ''))) return
  delete req.headers['accept-encoding']
  delete req.headers['if-none-match']
  delete req.headers['if-modified-since']
}

/** Every HTML page this response carries (GET, 200, text/html, not encoded) gets the source link: its head is held
 *  back until its end, then sent with the new length, no ETag/Last-Modified, and a CSP that lets the link's style in. */
function addSourceLink(req: http.IncomingMessage, res: http.ServerResponse, href: string) {
  if ((req.method || 'GET').toUpperCase() !== 'GET') return
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => http.ServerResponse
  const write = res.write.bind(res) as (...a: unknown[]) => boolean
  const end = res.end.bind(res) as (...a: unknown[]) => http.ServerResponse
  let state: 'undecided' | 'pass' | 'page' = 'undecided', head: unknown[] = [], size = 0
  const chunks: Buffer[] = []
  /* the headers writeHead was given, into the response's own (so they can still change) */
  const absorb = (a: unknown[]) => {
    const status = Number(a[0]) || res.statusCode
    let msg: string | undefined, h: unknown
    if (typeof a[1] === 'string') {
      msg = a[1]
      h = a[2]
    } else h = a[1]
    if (Array.isArray(h)) {
      if (h.length && Array.isArray(h[0])) for (const [k, v] of h as unknown[][]) res.setHeader(String(k), v as string)
      else for (let j = 0; j + 1 < h.length; j += 2) res.setHeader(String(h[j]), h[j + 1] as string)
    } else if (h && typeof h === 'object') {
      for (const [k, v] of Object.entries(h)) if (v !== undefined) res.setHeader(k, v as string)
    }
    return msg === undefined ? [status] : [status, msg]
  }
  const flushAsIs = () => {
    state = 'pass'
    writeHead(...head)
    for (const c of chunks) write(c)
    chunks.length = 0
  }
  res.writeHead = ((...a: unknown[]) => {
    if (state !== 'undecided') return state === 'page' ? res : writeHead(...a)
    head = absorb(a)
    const type = String(res.getHeader('content-type') || ''), enc = res.getHeader('content-encoding')
    state = head[0] === 200 && /^\s*text\/html\b/i.test(type) && (!enc || enc === 'identity') ? 'page' : 'pass'
    return state === 'pass' ? writeHead(...head) : res
  }) as typeof res.writeHead
  const take = (chunk: unknown, encoding: unknown) => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return
    const b = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
    chunks.push(b)
    size += b.length
    if (size > MAX_PAGE) flushAsIs()
  }
  res.write = ((...a: unknown[]) => {
    if (state === 'undecided') res.writeHead(res.statusCode)
    if (state !== 'page') return write(...a)
    take(a[0], a[1])
    const cb = a.find((x) => typeof x === 'function') as (() => void) | undefined
    if (cb) process.nextTick(cb)
    return true
  }) as typeof res.write
  res.end = ((...a: unknown[]) => {
    if (state === 'undecided') res.writeHead(res.statusCode)
    if (state !== 'page') return end(...a)
    take(a[0], a[1])
    const cb = a.find((x) => typeof x === 'function')
    if (state !== 'page') return cb ? end(cb) : end() // too big: passed as it is
    const body = Buffer.from(withSourceLink(Buffer.concat(chunks).toString('utf8'), href))
    res.removeHeader('etag')
    res.removeHeader('last-modified')
    res.setHeader('content-length', body.length)
    const csp = res.getHeader('content-security-policy')
    if (csp) res.setHeader('content-security-policy', Array.isArray(csp) ? csp.map((c) => allowLinkStyle(String(c))) : allowLinkStyle(String(csp)))
    state = 'pass'
    writeHead(...head)
    return cb ? end(body, cb) : end(body)
  }) as typeof res.end
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
        /* the source (AGPL sec. 13): this side's own page about it, and the link on every page */
        const p = pathOf(req.url), method = (req.method || 'GET').toUpperCase()
        if ((p === SOURCE_PAGE || p.startsWith(`${SOURCE_PAGE}/`)) && (method === 'GET' || method === 'HEAD')) return sourcePage(res, cfg.source, method)
        wantsPage(req)
        addSourceLink(req, res, cfg.source.url)
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
    console.log(`⟡ mm gateway side   source link: ${cfg.source.url} (tag ${cfg.source.tag})`)
  })
  return server
}
