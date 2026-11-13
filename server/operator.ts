import express from 'express'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { env } from './env.ts'
import { db } from './db/index.ts'
import * as authSchema from './db/auth-schema.ts'
import { agentKeys } from './db/schema.ts'
import { store } from './store.ts'
import { auth, createdByOperator } from './auth.ts'
import { purgeUserData } from './accountDeletion.ts'
import { createAgentKey, deleteAgentKey, listAgentKeys } from './agentKeys.ts'
import { isLinkAccess } from '../shared/canvasRole.ts'
import { isShadowEmail } from './embed.ts'
import type { Canvas } from '../shared/types.ts'

/**
 * The operator API: users, sharing, canvases and agent keys for whoever runs
 * this instance, driven by a CLI (doopctl) rather than a browser.
 *
 * It answers only a bearer DOOP_ADMIN_TOKEN, and is not there at all (404)
 * while the token is unset, which is the default. It is mounted ahead of the
 * /api session gate: no cookie, no account, no admin role is involved, so it
 * works on an instance where sign-up is closed and nobody is an admin.
 *
 * Everything goes through the running server, never around it: canvas
 * membership, owners and link access live in the in-memory store with
 * write-through to Postgres, so a tool writing the database directly would be
 * invisible until a restart, or overwritten by the next write. Each write is
 * logged as `[operator] …` for the audit trail.
 *
 * A user is addressed by id or by email (anything with an @).
 */

type Refresh = (canvasId: string) => void

interface UserRow {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean | null
  createdAt: Date
}

const userColumns = {
  id: authSchema.user.id,
  name: authSchema.user.name,
  email: authSchema.user.email,
  role: authSchema.user.role,
  banned: authSchema.user.banned,
  createdAt: authSchema.user.createdAt,
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Constant-time: both sides are hashed to the same length first. */
function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected))
}

function audit(line: string) {
  console.log(`[operator] ${line}`)
}

async function findUser(ref: string): Promise<UserRow | undefined> {
  const key = ref.trim()
  const where = key.includes('@')
    ? eq(sql`lower(${authSchema.user.email})`, key.toLowerCase())
    : eq(authSchema.user.id, key)
  const [row] = await db.select(userColumns).from(authSchema.user).where(where)
  return row
}

function publicUser(u: UserRow) {
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? 'user', banned: !!u.banned }
}

/** What deleting this user takes with it: the canvases only they can reach
 *  (the same rule as purgeUserData), and the ones they merely leave. */
function deletionPlan(userId: string) {
  const deletes: { id: string; name: string; frames: number }[] = []
  const leaves: { id: string; name: string }[] = []
  for (const c of store.allCanvases()) {
    const others = (c.memberIds ?? []).filter((id) => id !== userId)
    if (c.ownerId === userId && others.length === 0 && !c.workspaceId)
      deletes.push({ id: c.id, name: c.name, frames: c.frames.length })
    else if (c.ownerId === userId) leaves.push({ id: c.id, name: c.name })
    else if (c.memberIds?.includes(userId)) leaves.push({ id: c.id, name: c.name })
  }
  return { deletes, leaves }
}

/** A route parameter; Express always sets the ones its path names. */
function param(req: express.Request, name: string): string {
  return req.params[name] ?? ''
}

function randomPassword(): string {
  return randomBytes(18).toString('base64url')
}

const PASSWORD_MIN = 8

export function operatorRouter(refreshRoomRoles: Refresh): express.Router {
  const router = express.Router()
  /* Express 4 does not catch a rejected handler; hand the error on instead */
  type Handler = (req: express.Request, res: express.Response) => Promise<unknown>
  const wrap =
    (fn: Handler): express.RequestHandler =>
    (req, res, next) =>
      void fn(req, res).catch(next)
  const get = (path: string, fn: Handler) => router.get(path, wrap(fn))
  const post = (path: string, fn: Handler) => router.post(path, wrap(fn))
  const put = (path: string, fn: Handler) => router.put(path, wrap(fn))
  const del = (path: string, fn: Handler) => router.delete(path, wrap(fn))

  /* the token gate: absent token = no surface at all */
  router.use((req, res, next) => {
    const expected = env.DOOP_ADMIN_TOKEN
    if (!expected) return res.status(404).end()
    const presented = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim()
    if (!presented || !tokenMatches(presented, expected)) {
      audit(`refused ${req.method} ${req.path} from ${req.ip}`)
      return res.status(401).json({ error: 'operator token required' })
    }
    res.set('Cache-Control', 'no-store')
    next()
  })

  /* ---------------------------------------------------------------- users */

  /* ?all=1 includes the embedded review panel's shadow reviewers */
  get('/users', async (req, res) => {
    const all = req.query.all === '1'
    const rows = (await db.select(userColumns).from(authSchema.user)).filter((u) => all || !isShadowEmail(u.email))
    const owned = new Map<string, number>()
    const member = new Map<string, number>()
    for (const c of store.allCanvases()) {
      if (c.ownerId) owned.set(c.ownerId, (owned.get(c.ownerId) ?? 0) + 1)
      for (const id of c.memberIds ?? []) member.set(id, (member.get(id) ?? 0) + 1)
    }
    res.json(
      rows
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((u) => ({
          ...publicUser(u),
          createdAt: u.createdAt.getTime(),
          owns: owned.get(u.id) ?? 0,
          memberOf: member.get(u.id) ?? 0,
        })),
    )
  })

  /** Create an account, sign-up allowlist or not. No first canvas and no demo:
   *  this is a person being let in, not a new signup to onboard. Without a
   *  password one is generated and returned, once. */
  post('/users', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : email.split('@')[0]
    const given = typeof req.body?.password === 'string' ? req.body.password : undefined
    if (!email.includes('@')) return res.status(400).json({ error: 'email required' })
    if (given !== undefined && given.length < PASSWORD_MIN)
      return res.status(400).json({ error: `password must be at least ${PASSWORD_MIN} characters` })
    if (await findUser(email)) return res.status(409).json({ error: `${email} already has an account` })
    const password = given ?? randomPassword()
    let created
    try {
      created = await createdByOperator(() =>
        auth.api.createUser({ body: { email, name: name ?? email, password, role: 'user' } }),
      )
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'could not create the user' })
    }
    audit(`created user ${email} (${created.user.id})`)
    res.status(201).json({
      user: { id: created.user.id, name: created.user.name, email: created.user.email },
      ...(given === undefined && { password }),
    })
  })

  get('/users/:user', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    const canvases = store
      .allCanvases()
      .filter((c) => c.ownerId === u.id || c.memberIds?.includes(u.id))
      .map((c) => ({ id: c.id, name: c.name, role: c.ownerId === u.id ? 'owner' : 'member' }))
    res.json({ ...publicUser(u), createdAt: u.createdAt.getTime(), canvases, keys: await listAgentKeys(u.id) })
  })

  /** Set (or generate) a password. `signOut` also ends the user's browser
   *  sessions; agent keys are separate credentials and keep working. */
  post('/users/:user/password', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    const given = typeof req.body?.password === 'string' ? req.body.password : undefined
    if (given !== undefined && given.length < PASSWORD_MIN)
      return res.status(400).json({ error: `password must be at least ${PASSWORD_MIN} characters` })
    const password = given ?? randomPassword()
    const ctx = await auth.$context
    const hash = await ctx.password.hash(password)
    const accounts = await ctx.internalAdapter.findAccounts(u.id)
    if (accounts.some((a) => a.providerId === 'credential')) await ctx.internalAdapter.updatePassword(u.id, hash)
    else
      await ctx.internalAdapter.linkAccount({ accountId: u.id, providerId: 'credential', password: hash, userId: u.id })
    if (req.body?.signOut === true) await ctx.internalAdapter.deleteUserSessions(u.id)
    audit(`set password for ${u.email}${req.body?.signOut === true ? ', signed out' : ''}`)
    res.json({ ok: true, ...(given === undefined && { password }) })
  })

  /** Ban: sessions end now; MCP (OAuth and agent keys) stops within a minute
   *  (auth.isBanned caches for 60s). */
  post('/users/:user/ban', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null
    const ctx = await auth.$context
    await ctx.internalAdapter.updateUser(u.id, { banned: true, banReason: reason, banExpires: null })
    await ctx.internalAdapter.deleteUserSessions(u.id)
    audit(`banned ${u.email}${reason ? ` (${reason})` : ''}`)
    res.json({ ok: true })
  })

  post('/users/:user/unban', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    const ctx = await auth.$context
    await ctx.internalAdapter.updateUser(u.id, { banned: false, banReason: null, banExpires: null })
    audit(`unbanned ${u.email}`)
    res.json({ ok: true })
  })

  /** Delete an account. `?dryRun=1` answers with the plan and changes
   *  nothing; the CLI shows it before asking. */
  del('/users/:user', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    const plan = deletionPlan(u.id)
    if (req.query.dryRun === '1') return res.json({ user: publicUser(u), ...plan })
    await purgeUserData(u.id)
    await db.delete(agentKeys).where(eq(agentKeys.userId, u.id))
    const ctx = await auth.$context
    await ctx.internalAdapter.deleteUser(u.id)
    audit(`deleted user ${u.email}: ${plan.deletes.length} canvas(es) deleted, left ${plan.leaves.length}`)
    res.json({ ok: true, user: publicUser(u), ...plan })
  })

  /* ----------------------------------------------------------- agent keys */

  get('/users/:user/keys', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    res.json(await listAgentKeys(u.id))
  })

  /** The secret is in this response and nowhere else, ever. */
  post('/users/:user/keys', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : ''
    if (!name) return res.status(400).json({ error: 'name required' })
    const created = await createAgentKey(u.id, name)
    if (!created) return res.status(409).json({ error: 'this account is at its agent key limit' })
    audit(`minted agent key "${name}" for ${u.email}`)
    res.status(201).json(created)
  })

  del('/users/:user/keys/:keyId', async (req, res) => {
    const u = await findUser(param(req, 'user'))
    if (!u) return res.status(404).json({ error: 'no such user' })
    if (!(await deleteAgentKey(u.id, param(req, 'keyId')))) return res.status(404).json({ error: 'no such key' })
    audit(`revoked agent key ${param(req, 'keyId')} of ${u.email}`)
    res.json({ ok: true })
  })

  /* ------------------------------------------------------------- canvases */

  async function emails(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
    const rows = await db.select(userColumns).from(authSchema.user)
    const wanted = new Set(ids)
    return new Map(rows.filter((r) => wanted.has(r.id)).map((r) => [r.id, { name: r.name, email: r.email }]))
  }

  get('/canvases', async (_req, res) => {
    const all = store.allCanvases().sort((a, b) => b.updatedAt - a.updatedAt)
    const people = await emails(all.flatMap((c) => (c.ownerId ? [c.ownerId] : [])))
    res.json(
      all.map((c) => ({
        id: c.id,
        name: c.name,
        owner: c.ownerId ? (people.get(c.ownerId)?.email ?? c.ownerId) : null,
        frames: c.frames.length,
        members: c.memberIds?.length ?? 0,
        linkAccess: c.linkAccess ?? 'none',
        workspaceId: c.workspaceId ?? null,
        updatedAt: c.updatedAt,
      })),
    )
  })

  function canvasOr404(id: string, res: express.Response): Canvas | null {
    const c = store.getCanvas(id)
    if (!c) res.status(404).json({ error: 'no such canvas' })
    return c ?? null
  }

  async function accessOf(c: Canvas) {
    const ids = [...(c.ownerId ? [c.ownerId] : []), ...(c.memberIds ?? [])]
    const people = await emails(ids)
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? 'Unknown', email: people.get(id)?.email ?? '' })
    return {
      id: c.id,
      name: c.name,
      owner: c.ownerId ? person(c.ownerId) : null,
      members: (c.memberIds ?? []).map(person),
      linkAccess: c.linkAccess ?? 'none',
      workspaceId: c.workspaceId ?? null,
    }
  }

  get('/canvases/:id', async (req, res) => {
    const c = canvasOr404(param(req, 'id'), res)
    if (c) res.json(await accessOf(c))
  })

  post('/canvases/:id/members', async (req, res) => {
    const c = canvasOr404(param(req, 'id'), res)
    if (!c) return
    const u = typeof req.body?.user === 'string' ? await findUser(req.body.user) : undefined
    if (!u) return res.status(404).json({ error: 'no such user (create the account first)' })
    if (u.id === c.ownerId) return res.status(400).json({ error: `${u.email} owns this canvas` })
    if (!c.memberIds?.includes(u.id)) {
      store.addMember(c.id, u.id, c.ownerId ?? u.id)
      refreshRoomRoles(c.id)
      audit(`added ${u.email} to canvas ${c.id}`)
    }
    res.json(await accessOf(c))
  })

  del('/canvases/:id/members/:user', async (req, res) => {
    const c = canvasOr404(param(req, 'id'), res)
    if (!c) return
    const u = await findUser(param(req, 'user'))
    if (!u || !store.removeMember(c.id, u.id)) return res.status(404).json({ error: 'not a member of this canvas' })
    refreshRoomRoles(c.id)
    audit(`removed ${u.email} from canvas ${c.id}`)
    res.json(await accessOf(c))
  })

  put('/canvases/:id/link', async (req, res) => {
    const c = canvasOr404(param(req, 'id'), res)
    if (!c) return
    const access: unknown = req.body?.access
    if (!isLinkAccess(access)) return res.status(400).json({ error: 'access must be none, view, comment or edit' })
    store.setLinkAccess(c.id, access)
    refreshRoomRoles(c.id)
    audit(`link access of canvas ${c.id} = ${access}`)
    res.json(await accessOf(c))
  })

  /** Hand a canvas to another account. The previous owner stays on as a
   *  member unless `keepPrevious` is false, so nobody loses access by
   *  accident. */
  post('/canvases/:id/owner', async (req, res) => {
    const c = canvasOr404(param(req, 'id'), res)
    if (!c) return
    const u = typeof req.body?.user === 'string' ? await findUser(req.body.user) : undefined
    if (!u) return res.status(404).json({ error: 'no such user' })
    if (u.id === c.ownerId) return res.json(await accessOf(c))
    const previous = c.ownerId
    store.setOwner(c.id, u.id)
    if (previous && req.body?.keepPrevious !== false) store.addMember(c.id, previous, u.id)
    refreshRoomRoles(c.id)
    audit(`owner of canvas ${c.id}: ${previous ?? 'none'} -> ${u.email}`)
    res.json(await accessOf(c))
  })

  /* nothing below this prefix falls through to the session gate */
  router.use((_req, res) => res.status(404).json({ error: 'no such operator route' }))

  return router
}
