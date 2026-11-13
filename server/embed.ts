import { createHash } from 'node:crypto'
import { decodeJwt, jwtVerify } from 'jose'
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin } from 'better-auth'
import { env } from './env.ts'
import { store } from './store.ts'
import type { Canvas, Presence, ServerMessage } from '../shared/types.ts'
import type { CanvasRole } from '../shared/canvasRole.ts'

/**
 * The embedded review panel's way in. A host app
 * shows doop's review panel in an iframe and signs its user in with a token it
 * mints itself, HS256 with its own secret:
 *
 *   iss  the host's id (a key of DOOP_EMBED_HOSTS)   aud  "doop"
 *   sub  the host's user id                          name the reviewer's name
 *   canvas  the canvas to open                       role view | comment | review
 *   iat / exp  at most five minutes apart            jti  used once
 *
 * POST /api/auth/embed/session { token } verifies it, finds or creates a
 * shadow user for (iss, sub) and starts an ordinary better-auth session with
 * an ordinary session cookie, so every existing gate keeps working. The grant
 * lives on the SESSION (session.embed_canvas_id / embed_role), not the user:
 *  - the shadow user holds no access anywhere (no membership, no workspace);
 *  - the session opens its one canvas at its one role (checkRole, connRole),
 *    reaches only EMBED_ROUTES (the /api session gate), and sees the canvas
 *    through the reviewer filter: frames, pages, comments, approvals and
 *    presence, not the team's agent work or memory (forReviewer);
 *  - it ends with the session (EMBED_SESSION_TTL_S), and the host mints again.
 * Shadow users have no password or OAuth account, so this is their only way
 * in; their address is under `.embed.invalid`, which lists hide by default.
 *
 * The panel may be served from its own hostname (review.example.com, say) so its
 * cookie never replaces a person's own doop session: nothing here reads the
 * request host and the cookie is host-only; that origin must be in
 * TRUSTED_ORIGINS, since the exchange checks a browser's Origin even before
 * it holds a cookie (formCsrfMiddleware, as sign-in does).
 */

export const EMBED_SESSION_TTL_S = 2 * 60 * 60
const MAX_TOKEN_LIFE_S = 5 * 60
const EMBED_ROLES: readonly CanvasRole[] = ['view', 'comment', 'review']
export const EMBED_EMAIL_SUFFIX = '.embed.invalid'

export interface EmbedGrant {
  canvasId: string
  role: CanvasRole
}

interface EmbedHost {
  secret: Uint8Array
  /** the host page's origin: the panel's postMessage peer and frame-ancestor */
  origin: string
}

/** DOOP_EMBED_HOSTS = {"<id>": {"secret": "<32+ chars>", "origin": "https://…"}}.
 *  Read per call, so a test can stub it; an entry that does not fit is left
 *  out (and said once in the log), never echoed. */
function embedHosts(): Map<string, EmbedHost> {
  const hosts = new Map<string, EmbedHost>()
  const raw = env.DOOP_EMBED_HOSTS
  if (!raw) return hosts
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    warnOnce('DOOP_EMBED_HOSTS is not JSON; no embed sign-in')
    return hosts
  }
  if (!parsed || typeof parsed !== 'object') return hosts
  for (const [id, value] of Object.entries(parsed)) {
    const { secret, origin } = (value ?? {}) as { secret?: unknown; origin?: unknown }
    const originOk = typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)
    if (typeof secret !== 'string' || secret.length < 32 || !originOk) {
      warnOnce(`DOOP_EMBED_HOSTS.${id} needs a 32+ character secret and an origin like https://host`)
      continue
    }
    hosts.set(id, { secret: new TextEncoder().encode(secret), origin })
  }
  return hosts
}

const warned = new Set<string>()
function warnOnce(line: string) {
  if (warned.has(line)) return
  warned.add(line)
  console.warn(`[embed] ${line}`)
}

/** Every configured host page origin: the panel's frame-ancestors. Empty means
 *  embedding is off. */
export function embedHostOrigins(): string[] {
  return [...new Set([...embedHosts().values()].map((h) => h.origin))]
}

/* first use of a jti wins: a synchronous check-and-set is race-free inside
   this one process; a verification row covers the window after a restart */
const seenJti = new Map<string, number>()
function claimJtiInMemory(key: string, expMs: number): boolean {
  const now = Date.now()
  for (const [k, until] of seenJti) if (until < now) seenJti.delete(k)
  if (seenJti.has(key)) return false
  seenJti.set(key, expMs)
  return true
}

/** The shadow user's address: stable per (host, host user), opaque, unroutable. */
export function shadowEmail(iss: string, sub: string): string {
  const id = createHash('sha256').update(`${iss}\0${sub}`).digest('hex').slice(0, 24)
  return `${id}@${iss.replace(/[^a-z0-9-]/gi, '')}${EMBED_EMAIL_SUFFIX}`
}

export function isShadowEmail(email: string): boolean {
  return email.toLowerCase().endsWith(EMBED_EMAIL_SUFFIX)
}

function refuse(why: string): never {
  console.warn(`[embed] refused a token: ${why}`)
  /* one answer for every failure: the reason is in the log, not the response */
  throw new APIError('UNAUTHORIZED', { message: 'invalid embed token' })
}

export const embedPlugin = () =>
  ({
    id: 'doop-embed',
    schema: {
      session: {
        fields: {
          embedCanvasId: { type: 'string', required: false, input: false },
          embedRole: { type: 'string', required: false, input: false },
        },
      },
    },
    endpoints: {
      /* formCsrfMiddleware, as sign-in uses: a browser's request must come from a
         trusted origin even with no cookie yet, so a page elsewhere cannot sign a
         visitor in as a reviewer of its choosing (login CSRF) */
      embedSession: createAuthEndpoint('/embed/session', { method: 'POST', use: [formCsrfMiddleware] }, async (ctx) => {
        const token = (ctx.body as { token?: unknown } | undefined)?.token
        if (typeof token !== 'string' || token.length > 4096) refuse('no token')
        let iss: string | undefined
        try {
          iss = decodeJwt(token).iss
        } catch {
          refuse('not a JWT')
        }
        const host = iss ? embedHosts().get(iss) : undefined
        if (!iss || !host) refuse(`unknown host ${iss ?? '(none)'}`)
        let claims: Record<string, unknown> = {}
        try {
          ;({ payload: claims } = await jwtVerify(token, host.secret, {
            algorithms: ['HS256'],
            issuer: iss,
            audience: 'doop',
            maxTokenAge: MAX_TOKEN_LIFE_S,
            requiredClaims: ['sub', 'jti', 'iat', 'exp'],
          }))
        } catch (err) {
          refuse(`${iss}: ${err instanceof Error ? err.message : 'verify failed'}`)
        }
        const { sub, jti, iat, exp, name, canvas: canvasId, role } = claims
        if (typeof exp !== 'number' || typeof iat !== 'number' || exp - iat > MAX_TOKEN_LIFE_S)
          refuse(`${iss}: lifetime over ${MAX_TOKEN_LIFE_S}s`)
        if (typeof sub !== 'string' || typeof jti !== 'string' || typeof canvasId !== 'string') refuse(`${iss}: claims`)
        if (typeof role !== 'string' || !(EMBED_ROLES as string[]).includes(role)) refuse(`${iss}: role ${role}`)
        const canvas = store.getCanvas(canvasId)
        if (!canvas) refuse(`${iss}: no canvas ${canvasId}`)

        const internal = ctx.context.internalAdapter
        const jtiKey = `embed-jti:${iss}:${jti}`
        if (!claimJtiInMemory(jtiKey, exp * 1000) || (await internal.findVerificationValue(jtiKey)))
          refuse(`${iss}: replayed jti`)
        await internal.createVerificationValue({ identifier: jtiKey, value: '1', expiresAt: new Date(exp * 1000) })

        const email = shadowEmail(iss, sub)
        const display = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : `${iss} reviewer`
        /* auth.ts lets this endpoint's accounts past sign-up (letIn): no
           allowlist, no first canvas */
        let user = (await internal.findUserByEmail(email))?.user
        if (!user) user = await internal.createUser({ email, name: display, emailVerified: false })
        else if (user.name !== display) user = (await internal.updateUser(user.id, { name: display })) ?? user
        if (!user) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'could not create the reviewer' })
        if ((user as { banned?: boolean | null }).banned) refuse(`${iss}: ${email} is banned`)

        const expiresAt = new Date(Date.now() + EMBED_SESSION_TTL_S * 1000)
        /* overrideAll: without it better-auth puts its own expiry back */
        const session = await internal.createSession(
          user.id,
          false,
          { embedCanvasId: canvas.id, embedRole: role, expiresAt },
          true,
        )
        await setSessionCookie(ctx, { session, user }, false, { maxAge: EMBED_SESSION_TTL_S })
        console.log(`[embed] ${iss}/${email} -> canvas ${canvas.id} as ${role} until ${expiresAt.toISOString()}`)
        return ctx.json({
          canvasId: canvas.id,
          role,
          hostOrigin: host.origin,
          expiresAt: expiresAt.getTime(),
          user: { name: user.name },
        })
      }),
    },
  }) satisfies BetterAuthPlugin

/** The grant on a better-auth session object, if it is an embed session. */
export function embedGrantOf(session: unknown): EmbedGrant | undefined {
  const s = session as { embedCanvasId?: string | null; embedRole?: string | null } | undefined
  if (!s?.embedCanvasId || !s.embedRole || !(EMBED_ROLES as string[]).includes(s.embedRole)) return undefined
  return { canvasId: s.embedCanvasId, role: s.embedRole as CanvasRole }
}

/** An embed session's role on a canvas: its grant there, nothing anywhere else. */
export function embedRole(grant: EmbedGrant, canvas: Pick<Canvas, 'id'>): CanvasRole | null {
  return grant.canvasId === canvas.id ? grant.role : null
}

/** What an embed session may call: reading its canvas and the frames' history,
 *  the comment routes, and the verdict. Each still checks the canvas through
 *  checkRole, so the grant's canvas and role decide. */
const EMBED_ROUTES: readonly [method: string, path: RegExp][] = [
  ['GET', /^\/me$/],
  ['GET', /^\/canvases\/[^/]+$/],
  ['GET', /^\/canvases\/[^/]+\/fonts$/],
  ['GET', /^\/frames\/[^/]+\/versions(\/[^/]+)?$/],
  ['POST', /^\/frames\/[^/]+\/comments$/],
  ['POST', /^\/canvases\/[^/]+\/comments$/],
  ['POST', /^\/frames\/[^/]+\/element-id$/],
  ['POST', /^\/comments\/[^/]+\/(replies|resolve)$/],
  ['PATCH', /^\/comments\/[^/]+\/anchor$/],
  ['PUT', /^\/frames\/[^/]+\/approval$/],
]

/** `path` is relative to /api (Express strips the mount). */
export function embedRouteAllowed(method: string, path: string): boolean {
  return EMBED_ROUTES.some(([m, re]) => m === method && re.test(path))
}

/* What a reviewer is not sent: the team's agent work and memory. Comments
   (with replies and resolves), frames, pages and approvals stay. */
const REVIEWER_HIDDEN: ReadonlySet<ServerMessage['type']> = new Set([
  'task',
  'feedback',
  'activity',
  'decision',
  'proposal',
  'reference',
  'guidelines',
  /* an agent's status line is its task's summary */
  'status',
] satisfies ServerMessage['type'][])

/** A presence without its status line (an agent's task summary). */
export function presenceForReviewer<P extends Presence>({ status: _status, ...presence }: P): Omit<P, 'status'> {
  return presence
}

/** A room message as a reviewer may see it, or null when it is withheld. */
export function forReviewer(msg: ServerMessage): ServerMessage | null {
  if (REVIEWER_HIDDEN.has(msg.type)) return null
  return msg.type === 'presence:join' ? { ...msg, presence: presenceForReviewer(msg.presence) } : msg
}

/** The canvas as a reviewer reads it: no memory, no member list. */
export function canvasForReviewer<C extends Canvas>(canvas: C): Omit<C, 'guidelines' | 'references' | 'memberIds'> {
  const { guidelines: _guidelines, references: _references, memberIds: _memberIds, ...shown } = canvas
  return shown
}
