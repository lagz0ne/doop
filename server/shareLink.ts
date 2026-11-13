import { randomBytes } from 'node:crypto'
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import type { BetterAuthPlugin } from 'better-auth'
import { and, eq, ne } from 'drizzle-orm'
import { db } from './db/index.ts'
import { session as sessionTable } from './db/auth-schema.ts'
import * as persist from './db/persist.ts'
import { store } from './store.ts'
import { linkKey, linkPasswordHash, rememberLinkPassword } from './linkPasswords.ts'
import { EMBED_EMAIL_SUFFIX } from './embed.ts'
import { storedLinkAccess, type CanvasRole } from '../shared/canvasRole.ts'
import type { Canvas } from '../shared/types.ts'

/**
 * Share-link guests: people with the link and no account, who give a name
 * (and the link's password, when it has one) and get the link's level on
 * that one canvas. Frame.io review links and InVision share links work this
 * way; doop's own link sharing wanted an account for anything past viewing.
 *
 * The owner picks the level (view, comment, review or edit) and whether there
 * is a password: PATCH /api/canvases/:id { linkAccess, linkPassword }, or the
 * operator API. A link with a password admits nobody by itself (access.ts):
 * everyone without durable access comes in here.
 *
 *   GET  /api/auth/link/info?canvas=<id>  what the join card shows: the link's
 *        level, whether it asks for a password, and the canvas name
 *   POST /api/auth/link/session { canvasId, name, password? }
 *
 * A right answer makes a shadow user under `.embed.invalid` (listed nowhere,
 * no password, no first canvas; letIn in auth.ts) named as typed, and starts
 * an ordinary session whose grant lives on the session row (link_canvas_id,
 * link_key) for LINK_SESSION_TTL_S. The role is read live from the canvas on
 * every request and room message (linkRole), so the owner changing the level
 * applies at once, turning the link off shuts the guest out, and a new
 * password (a new link_key) ends every guest session from before.
 *
 * A guest session reaches its one canvas through the canvas-scoped routes
 * (linkRouteAllowed): never the canvas list, new canvases, keys, workspaces,
 * settings or anything account-wide. Within its canvas each route still
 * checks the role, exactly as for an account holding the link.
 */

export const LINK_SESSION_TTL_S = 30 * 24 * 60 * 60
const MAX_NAME = 80
const MAX_PASSWORD = 200
export const LINK_EMAIL_SUFFIX = `link${EMBED_EMAIL_SUFFIX}`

export interface LinkGrant {
  canvasId: string
  key: string
}

/** The grant on a better-auth session object, if it is a link guest's. */
export function linkGrantOf(session: unknown): LinkGrant | undefined {
  const s = session as { linkCanvasId?: string | null; linkKey?: string | null } | undefined
  if (!s?.linkCanvasId || !s.linkKey) return undefined
  return { canvasId: s.linkCanvasId, key: s.linkKey }
}

/** A link guest's role on a canvas: the link's level now, on its own canvas,
 *  while the link is on and its password is the one the guest gave. */
export function linkRole(grant: LinkGrant, canvas: Pick<Canvas, 'id' | 'linkAccess' | 'ownerId'>): CanvasRole | null {
  if (grant.canvasId !== canvas.id || !canvas.ownerId) return null
  if (grant.key !== linkKey(canvas.id)) return null
  return storedLinkAccess(canvas.linkAccess) ?? null
}

/* Account-wide reads a guest's editor makes on load, answered for the guest's
   own (empty) account: none of them reaches another person's data. */
const GUEST_ACCOUNT_READS: readonly RegExp[] = [
  /^\/me$/,
  /^\/locale-config$/,
  /^\/oidc-config$/,
  /^\/agent-allowance$/,
  /^\/agent-runners$/,
  /^\/model-account(\/models)?$/,
  /^\/image-model$/,
  /^\/notifications$/,
]

/* Canvas routes that outlive the visit or reach past the canvas: keys that
   keep writing after the link is off, copies and claims that make the guest
   an owner, moving it between workspaces, its membership list, GitHub
   connections (an account's own tokens). */
const CANVAS_ROUTES_REFUSED =
  /^\/canvases\/[^/]+\/(claim|duplicate|workspace|members|sync-keys|sync-flow|github|publish)(\/|$)/

/** What a link guest may call (`path` is relative to /api). Routes on the
 *  guest's own canvas and on its frames, comments, tasks and feedback; each
 *  still checks the role through checkRole, so another canvas's frame is
 *  refused there. */
export function linkRouteAllowed(method: string, path: string, grant: LinkGrant): boolean {
  if (method === 'GET' && GUEST_ACCOUNT_READS.some((re) => re.test(path))) return true
  const canvas = path.match(/^\/canvases\/([^/]+)(\/|$)/)
  if (canvas) {
    if (canvas[1] !== grant.canvasId) return false
    if (CANVAS_ROUTES_REFUSED.test(path)) return false
    /* deleting the canvas, and its name and link settings, stay the owner's */
    if (path === `/canvases/${grant.canvasId}` && method !== 'GET') return false
    return true
  }
  return /^\/(frames|comments|tasks|feedback)\/[^/]+(\/|$)/.test(path)
}

/** Set or clear (null / '') a canvas link's password. Every guest session
 *  from before ends: its link_key no longer matches (linkRole), and its rows
 *  go. The caller refreshes the room. */
export async function setLinkPassword(canvasId: string, password: string | null): Promise<void> {
  const c = store.getCanvas(canvasId)
  if (!c) return
  const hash = password ? await hashPassword(password) : null
  rememberLinkPassword(canvasId, hash)
  if (hash) c.linkPassword = true
  else delete c.linkPassword
  persist.saveLinkPassword(canvasId, hash)
  await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.linkCanvasId, canvasId), ne(sessionTable.linkKey, linkKey(canvasId))))
    .catch((err: unknown) => console.error('[link] could not end old guest sessions', err))
}

export function validLinkPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PASSWORD
}

/* Wrong passwords: a few per visitor, then a pause; and a ceiling per canvas,
   so a short password cannot be walked from many addresses. */
const WINDOW_MS = 15 * 60 * 1000
const PER_VISITOR = 10
const PER_CANVAS = 100
const failures = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter((at) => now - at < WINDOW_MS)
  if (kept.length) failures.set(key, kept)
  else failures.delete(key)
  return kept
}

function throttled(canvasId: string, visitor: string, now: number): boolean {
  return recent(`${canvasId}\0${visitor}`, now).length >= PER_VISITOR || recent(canvasId, now).length >= PER_CANVAS
}

function noteFailure(canvasId: string, visitor: string, now: number): void {
  for (const key of [`${canvasId}\0${visitor}`, canvasId]) failures.set(key, [...recent(key, now), now])
}

/** Test hook: forget every counted failure. */
export function resetLinkThrottle(): void {
  failures.clear()
}

function visitorOf(headers: Headers | undefined): string {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers?.get('x-real-ip') || 'unknown'
}

/** The canvas a link opens, if its link is on. */
function linkedCanvas(canvasId: unknown): Canvas | undefined {
  if (typeof canvasId !== 'string') return undefined
  const c = store.getCanvas(canvasId)
  return c?.ownerId && storedLinkAccess(c.linkAccess) ? c : undefined
}

export const linkPlugin = () =>
  ({
    id: 'doop-share-link',
    schema: {
      session: {
        fields: {
          linkCanvasId: { type: 'string', required: false, input: false },
          linkKey: { type: 'string', required: false, input: false },
        },
      },
    },
    endpoints: {
      linkInfo: createAuthEndpoint('/link/info', { method: 'GET' }, async (ctx) => {
        const c = linkedCanvas((ctx.query as { canvas?: unknown } | undefined)?.canvas)
        if (!c) throw new APIError('NOT_FOUND', { message: 'no link' })
        return ctx.json({
          canvasId: c.id,
          access: storedLinkAccess(c.linkAccess),
          password: !!c.linkPassword,
          /* the name is behind the password too */
          name: c.linkPassword ? null : c.name,
        })
      }),
      /* formCsrfMiddleware, as sign-in uses: a page elsewhere cannot sign a
         visitor in as a guest of its choosing (login CSRF) */
      linkSession: createAuthEndpoint('/link/session', { method: 'POST', use: [formCsrfMiddleware] }, async (ctx) => {
        const body = (ctx.body ?? {}) as { canvasId?: unknown; name?: unknown; password?: unknown }
        const c = linkedCanvas(body.canvasId)
        if (!c) throw new APIError('NOT_FOUND', { message: 'no link' })
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
        if (!name) throw new APIError('BAD_REQUEST', { message: 'say your name' })

        const hash = linkPasswordHash(c.id)
        if (hash) {
          const visitor = visitorOf(ctx.request?.headers ?? ctx.headers)
          const now = Date.now()
          if (throttled(c.id, visitor, now))
            throw new APIError('TOO_MANY_REQUESTS', { message: 'too many tries; wait a few minutes' })
          const password = typeof body.password === 'string' ? body.password.slice(0, MAX_PASSWORD) : ''
          if (!password || !(await verifyPassword({ hash, password }))) {
            noteFailure(c.id, visitor, now)
            console.warn(`[link] wrong password for canvas ${c.id} from ${visitor}`)
            throw new APIError('UNAUTHORIZED', { message: 'wrong password' })
          }
        }

        const internal = ctx.context.internalAdapter
        /* one shadow user per visit: a guest is the name they typed, nothing
           more, and owns nothing */
        const email = `${randomBytes(12).toString('hex')}@${LINK_EMAIL_SUFFIX}`
        const user = await internal.createUser({ email, name, emailVerified: false })
        if (!user) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'could not create the guest' })
        const expiresAt = new Date(Date.now() + LINK_SESSION_TTL_S * 1000)
        /* overrideAll: without it better-auth puts its own expiry back */
        const session = await internal.createSession(
          user.id,
          false,
          { linkCanvasId: c.id, linkKey: linkKey(c.id), expiresAt },
          true,
        )
        await setSessionCookie(ctx, { session, user }, false, { maxAge: LINK_SESSION_TTL_S })
        const role = storedLinkAccess(c.linkAccess)
        console.log(`[link] guest "${name}" (${email}) -> canvas ${c.id} as ${role} until ${expiresAt.toISOString()}`)
        return ctx.json({ canvasId: c.id, role, user: { name: user.name } })
      }),
    },
  }) satisfies BetterAuthPlugin
