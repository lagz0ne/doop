import type { CanvasRole } from '../../shared/canvasRole'
import type { ApprovalVerdictStatus, ElementComment, Frame, ServerMessage } from '../../shared/types'

/* The review panel's connection to doop and to the page that embeds it.

   A host app loads /embed#token=<jwt>&frame=<id>
   in an iframe. The token is the host's word for who is reviewing which
   canvas (server/embed.ts); the panel trades it once for a session cookie,
   wipes it from the address bar and from then on is an ordinary doop client
   with a narrow grant: REST for comments and verdicts, the canvas room for
   everything live.

   The host page hears what happened through postMessage, to its own origin
   only (the exchange names it), and can hand the panel a fresh token or tell
   it to open another frame. Nothing from any other window is read. */

export interface EmbedSession {
  canvasId: string
  role: CanvasRole
  hostOrigin: string
  expiresAt: number
  user: { name: string }
}

/** What the panel says to the host page. */
export type PanelMessage =
  | { type: 'doop:ready'; canvasId: string; frameId: string | null }
  | { type: 'doop:open'; frameId: string }
  | {
      type: 'doop:verdict'
      frameId: string
      status: ApprovalVerdictStatus
      by: string
      frameUpdatedAt: number
      versionId?: string
    }
  | { type: 'doop:comment'; frameId: string; commentId: string }
  | { type: 'doop:need-token'; reason: 'expired' | 'refused' }

/** What the host page may say to the panel. */
export type HostMessage = { type: 'doop:token'; token: string } | { type: 'doop:open'; frameId: string }

/** A message from the host page, or null for anything else: the wrong
 *  sender, the wrong shape, or a field that is not what it claims. */
export function readHostMessage(ev: { origin: string; data: unknown }, hostOrigin: string): HostMessage | null {
  if (ev.origin !== hostOrigin) return null
  const d = ev.data as { type?: unknown; token?: unknown; frameId?: unknown } | null
  if (!d || typeof d !== 'object') return null
  if (d.type === 'doop:token' && typeof d.token === 'string' && d.token.length < 8192)
    return { type: 'doop:token', token: d.token }
  if (d.type === 'doop:open' && typeof d.frameId === 'string' && /^[\w-]{1,64}$/.test(d.frameId))
    return { type: 'doop:open', frameId: d.frameId }
  return null
}

export function tellHost(session: EmbedSession, msg: PanelMessage): void {
  if (window.parent === window) return
  window.parent.postMessage(msg, session.hostOrigin)
}

/** The token and the frame to open, read from the address once and wiped from
 *  it at once: a fragment never reaches a server or a log, and replacing it
 *  keeps the token out of history and out of anything the page shares. */
export function takeLaunchParams(): { token: string | null; frameId: string | null } {
  const params = new URLSearchParams(location.hash.slice(1))
  const token = params.get('token')
  const frameId = params.get('frame')
  history.replaceState(null, '', location.pathname + (frameId ? `#frame=${encodeURIComponent(frameId)}` : ''))
  return { token, frameId }
}

export class SessionError extends Error {}

/** Trade a host token for a session. fetch() from this page: the exchange
 *  checks the request's Origin, which a form posted from another site fails. */
export async function exchange(token: string): Promise<EmbedSession> {
  const res = await fetch('/api/auth/embed/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new SessionError('This review link is no longer valid.')
  return (await res.json()) as EmbedSession
}

export class ExpiredError extends Error {}
export class ConflictError extends Error {}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) throw new ExpiredError('session ended')
  if (res.status === 409) throw new ConflictError('the frame changed')
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export interface CommentAnchor {
  selector?: string
  elementId?: string
  snippet?: string
  x?: number
  y?: number
  elementOrigin?: { x: number; y: number }
}

export const rest = {
  /** The verdict first and the comment after it: pinning a comment may stamp
   *  an element id into the frame, which moves its version on, and the
   *  verdict must be given on the version the reviewer looked at. */
  verdict: (frame: Frame, status: ApprovalVerdictStatus) =>
    api<Frame>('PUT', `/frames/${frame.id}/approval`, { status, expectedUpdatedAt: frame.updatedAt }),
  comment: (frameId: string, text: string, anchor: CommentAnchor) =>
    api<ElementComment>('POST', `/frames/${frameId}/comments`, { text, ...anchor }),
  reply: (commentId: string, text: string) => api<ElementComment>('POST', `/comments/${commentId}/replies`, { text }),
  resolve: (commentId: string) => api<unknown>('POST', `/comments/${commentId}/resolve`, {}),
  version: (frameId: string, versionId: string) =>
    api<{ html: string; savedAt: number }>('GET', `/frames/${frameId}/versions/${versionId}`),
}

/** The canvas room: the panel's live copy of frames and comments. It reports
 *  every message it is sent, and how it ended: a refused or expired session
 *  (4401 / 4403) needs a fresh token from the host, anything else reconnects. */
export function connectRoom(
  canvasId: string,
  name: string,
  onMessage: (msg: ServerMessage) => void,
  onRefused: () => void,
): () => void {
  let ws: WebSocket | null = null
  let stopped = false
  let retry = 0
  let timer = 0
  const clientId = `embed-${crypto.randomUUID()}`
  function open() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onopen = () => {
      retry = 0
      ws?.send(JSON.stringify({ type: 'join', canvasId, clientId, name, kind: 'human' }))
    }
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)) as ServerMessage)
      } catch {
        /* a message this panel cannot read is not one it needs */
      }
    }
    ws.onclose = (ev) => {
      if (stopped) return
      if (ev.code === 4401 || ev.code === 4403) return onRefused()
      timer = window.setTimeout(open, Math.min(15_000, 500 * 2 ** retry++))
    }
  }
  open()
  return () => {
    stopped = true
    window.clearTimeout(timer)
    ws?.close()
  }
}
