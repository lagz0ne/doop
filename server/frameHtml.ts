import type { NextFunction, Request, Response } from 'express'
import { roleAllows } from '../shared/canvasRole.ts'
import type { Frame } from '../shared/types.ts'
import { canvasRole } from './access.ts'
import { isAgentKeySecret, verifyAgentKey } from './agentKeys.ts'
import { isBanned } from './auth.ts'
import { store } from './store.ts'

/**
 * GET /api/frames/:id/html: a frame's saved HTML as a plain document, for a
 * script that wants the markup without speaking MCP (a build step, a diff
 * against the repo, a review bot). It reads exactly what get_frame returns.
 *
 * Two ways in, as /mcp has: an agent key (`Authorization: Bearer dpk_…`)
 * resolves to its account on every request, so revoking the key or banning
 * the account stops it at once; anything else goes on to the session gate
 * and the session route. Either way the account needs `view` on the canvas.
 * A frame the account cannot see is a 404, as in MCP, so ids do not leak.
 *
 * The markup is somebody's design and may carry scripts. Served from doop's
 * own origin it would run with doop's cookies if a browser opened it, so the
 * response is sandboxed (an opaque origin, nothing loads or runs) and never
 * stored by a cache.
 */

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
  'referrer-policy': 'no-referrer',
}

export function sendFrameHtml(res: Response, frame: Frame): void {
  res.set({ ...HEADERS, 'x-doop-frame-updated-at': String(frame.updatedAt) })
  res.send(frame.html)
}

/** Ahead of the /api session gate: answers an agent-key request in full,
 *  passes every other request on. */
export async function frameHtmlByAgentKey(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]
  if (!bearer || !isAgentKeySecret(bearer)) return next()
  try {
    const key = await verifyAgentKey(bearer)
    if (!key) return void res.status(401).json({ error: 'unknown or revoked agent key' })
    if (await isBanned(key.userId))
      return void res.status(403).json({ error: 'this account has been disabled on this server' })
    const frame = store.getFrame(req.params.id)
    const canvas = frame ? store.getCanvas(frame.canvasId) : undefined
    if (!frame || !canvas || !roleAllows(canvasRole(key.userId, canvas), 'view'))
      return void res.status(404).json({ error: 'frame not found' })
    sendFrameHtml(res, frame)
  } catch (err) {
    next(err)
  }
}
