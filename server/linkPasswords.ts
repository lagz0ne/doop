import { createHash } from 'node:crypto'

/**
 * Share-link password hashes, by canvas id. The Canvas object only says
 * whether its link has one (canvas.linkPassword), since canvases travel to
 * browsers whole; the hash stays here, filled at boot from
 * canvases.link_password (persist.ts) and by the owner setting one
 * (shareLink.ts).
 */
const hashes = new Map<string, string>()

export function rememberLinkPassword(canvasId: string, hash: string | null): void {
  if (hash) hashes.set(canvasId, hash)
  else hashes.delete(canvasId)
}

export function linkPasswordHash(canvasId: string): string | undefined {
  return hashes.get(canvasId)
}

/** What a link guest's session records of the link it came through: a
 *  fingerprint of the password then ('open' without one). A new password,
 *  or taking it away, changes it, and every guest session from before ends. */
export function linkKey(canvasId: string): string {
  const hash = hashes.get(canvasId)
  return hash ? createHash('sha256').update(hash).digest('hex').slice(0, 24) : 'open'
}
