import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { roleAllows } from '../../shared/canvasRole'
import { elementCommentPosition, isFrameComment } from '../../shared/comments'
import type { ApprovalVerdictStatus, Canvas, ElementComment, Frame, ServerMessage } from '../../shared/types'
import { canCompare, lastVerdict, textChanges, textRuns, type TextChange } from './changes'
import { FrameDoc, type FrameDocHandle, type ProbeHit } from './FrameDoc'
import {
  ConflictError,
  ExpiredError,
  connectRoom,
  exchange,
  readHostMessage,
  rest,
  takeLaunchParams,
  tellHost,
  type CommentAnchor,
  type EmbedSession,
} from './session'
import './embed.css'

/* The review panel a host app embeds: one canvas, looked at by one person the
   host signed in, who may comment and give a verdict but never change a frame.
   Small on purpose: React, the frame runtime and this file. */

/* once, at load: a second read (React's development double effects) would
   find the address already wiped */
const LAUNCH = takeLaunchParams()

type Phase =
  | { kind: 'starting' }
  | { kind: 'failed'; message: string }
  | { kind: 'live'; session: EmbedSession }
  | { kind: 'expired'; session: EmbedSession }

interface Draft {
  /** where the comment is pinned, in design px; none for a general note */
  pin: { x: number; y: number; anchor: CommentAnchor; label: string } | null
  text: string
  /** sent together with a changes-requested verdict */
  requestChanges: boolean
}

const cn = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

/* the dock: its height and the gaps above and below it (as in the editor) */
const DOCK_CLEAR = 66
const PANEL_W = 340

const fmtAgo = (at: number) => {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

type Tone = 'draft' | 'approved' | 'requested' | 'pending'

function statusOf(frame: Frame): { label: string; tone: Tone; note: string } {
  const a = frame.approval
  if (!a) return { label: 'Draft', tone: 'draft', note: 'Not reviewed yet' }
  const when = fmtAgo(a.approvedAt)
  if (a.status === 'ready_for_dev')
    return { label: `Ready for dev · approved by ${a.approvedBy}`, tone: 'approved', note: `Approved ${when}` }
  if (a.status === 'changes_requested')
    return {
      label: `Changes requested by ${a.approvedBy}`,
      tone: 'requested',
      note: `Waiting for a revision since ${when}`,
    }
  return a.verdict === 'changes_requested'
    ? {
        label: 'Revised since changes were requested',
        tone: 'pending',
        note: 'Revised: compare it with what you asked for',
      }
    : { label: 'Changed since it was approved', tone: 'pending', note: 'Changed after approval: review it again' }
}

function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [comments, setComments] = useState<ElementComment[]>([])
  const [epoch, setEpoch] = useState(0)

  /* launch: trade the token for a session (read from the address at load) */
  const [frameId, setFrameId] = useState<string | null>(LAUNCH.frameId)
  const [hostPinned, setHostPinned] = useState(!!LAUNCH.frameId)
  useEffect(() => {
    const { token } = LAUNCH
    if (!token) {
      setPhase({ kind: 'failed', message: 'Open this review from the app it belongs to.' })
      return
    }
    exchange(token).then(
      (session) => setPhase({ kind: 'live', session }),
      (e: Error) => setPhase({ kind: 'failed', message: e.message }),
    )
  }, [])

  const session = phase.kind === 'live' || phase.kind === 'expired' ? phase.session : null

  const sessionEnded = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== 'live') return p
      tellHost(p.session, { type: 'doop:need-token', reason: 'expired' })
      return { kind: 'expired', session: p.session }
    })
  }, [])

  /* the host page: a fresh token after the session ended, or another frame */
  useEffect(() => {
    if (!session) return
    function onMessage(ev: MessageEvent) {
      const msg = readHostMessage(ev, session!.hostOrigin)
      if (!msg) return
      if (msg.type === 'doop:open') {
        setFrameId(msg.frameId)
        setHostPinned(true)
      } else
        exchange(msg.token).then(
          (next) => {
            setPhase({ kind: 'live', session: next })
            setEpoch((n) => n + 1)
          },
          () => setPhase({ kind: 'failed', message: 'This review link is no longer valid.' }),
        )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [session])

  /* the canvas room: frames and comments as they change */
  const live = phase.kind === 'live' ? phase.session : null
  useEffect(() => {
    if (!live) return
    return connectRoom(
      live.canvasId,
      live.user.name,
      (msg: ServerMessage) => {
        switch (msg.type) {
          case 'init':
            setCanvas(msg.canvas)
            setComments(msg.comments)
            break
          case 'frame:created':
          case 'frame:updated':
            setCanvas((c) =>
              c
                ? {
                    ...c,
                    frames: c.frames.some((f) => f.id === msg.frame.id)
                      ? c.frames.map((f) => (f.id === msg.frame.id ? msg.frame : f))
                      : [...c.frames, msg.frame],
                  }
                : c,
            )
            break
          case 'frame:deleted':
            setCanvas((c) => (c ? { ...c, frames: c.frames.filter((f) => f.id !== msg.frameId) } : c))
            break
          case 'canvas:pages':
            setCanvas((c) => (c ? { ...c, pages: msg.pages } : c))
            break
          case 'comment':
            setComments((list) =>
              list.some((x) => x.id === msg.comment.id)
                ? list.map((x) => (x.id === msg.comment.id ? msg.comment : x))
                : [...list, msg.comment],
            )
            break
          case 'canvas:deleted':
            setPhase({ kind: 'failed', message: 'This canvas was deleted.' })
            break
        }
      },
      sessionEnded,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one room per session; epoch reconnects after a new token
  }, [live?.canvasId, epoch, sessionEnded])

  const frames = useMemo(() => (canvas?.frames ?? []).filter((f) => !f.hidden && f.html), [canvas])
  const frame = frames.find((f) => f.id === frameId) ?? (hostPinned ? null : (frames[0] ?? null))

  const announced = useRef(false)
  useEffect(() => {
    if (!live || !canvas || announced.current) return
    announced.current = true
    tellHost(live, { type: 'doop:ready', canvasId: canvas.id, frameId: frame?.id ?? null })
  }, [live, canvas, frame])

  if (phase.kind === 'starting' || (phase.kind === 'live' && !canvas))
    return <div className="center muted">Opening the review…</div>
  if (phase.kind === 'failed') return <div className="center muted">{phase.message}</div>
  if (!canvas || !session) return null

  return (
    <div className="panel">
      {!hostPinned && (
        <FrameList
          frames={frames}
          current={frame?.id ?? null}
          onPick={(id) => {
            setFrameId(id)
            tellHost(session, { type: 'doop:open', frameId: id })
          }}
        />
      )}
      {frame ? (
        <Review
          key={frame.id}
          session={session}
          canvas={canvas}
          frame={frame}
          comments={comments.filter((c) => c.frameId === frame.id)}
          onExpired={sessionEnded}
        />
      ) : (
        <div className="center muted">This frame is no longer on the canvas.</div>
      )}
      {phase.kind === 'expired' && (
        <div className="veil">
          <div className="card">
            <b>Your review session ended</b>
            <p className="muted">The panel asks {new URL(session.hostOrigin).host} for a fresh one; nothing is lost.</p>
            <button
              className="btn pri"
              onClick={() => tellHost(session, { type: 'doop:need-token', reason: 'expired' })}
            >
              Continue reviewing
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FrameList({
  frames,
  current,
  onPick,
}: {
  frames: Frame[]
  current: string | null
  onPick: (id: string) => void
}) {
  return (
    <nav className="list">
      {frames.map((f) => (
        <button key={f.id} className={f.id === current ? 'row on' : 'row'} onClick={() => onPick(f.id)}>
          <span className="nm">{f.name}</span>
          <span className={`dot tone-${statusOf(f).tone}`} />
        </button>
      ))}
    </nav>
  )
}

function useStageScale(
  el: HTMLElement | null,
  width: number,
  height: number,
  columns: number,
  /** what the floating comments panel covers at the right */
  right: number,
): number {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  if (!size.width) return 0
  const pad = 48
  /* the dock covers the bottom 66px of the stage */
  const w = (size.width - right) / columns - pad
  const h = size.height - DOCK_CLEAR - pad
  return Math.max(0.05, Math.min(1, w / width, h / height))
}

function Review({
  session,
  canvas,
  frame,
  comments,
  onExpired,
}: {
  session: EmbedSession
  canvas: Canvas
  frame: Frame
  comments: ElementComment[]
  onExpired: () => void
}) {
  const doc = useRef<FrameDocHandle>(null)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<'frame' | 'compare'>('frame')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pins, setPins] = useState<Map<string, { x: number; y: number }>>(new Map())
  const mayComment = roleAllows(session.role, 'comment')
  const mayDecide = roleAllows(session.role, 'review')
  const roots = comments.filter((c) => !c.parentId).sort((a, b) => a.at - b.at)
  const open = roots.filter((c) => !c.resolvedAt)
  /* the editor's layout (CanvasDock.tsx there): the Hand first, Comment to pin;
     the comments panel starts open when there is something to read */
  const [tool, setTool] = useState<'hand' | 'comment'>('hand')
  const [panel, setPanel] = useState<'comments' | 'history' | null>(() => (open.length ? 'comments' : null))
  const [zoom, setZoom] = useState<number | null>(null)
  const comparing = mode === 'compare' && canCompare(frame)
  const fit = useStageScale(stage, frame.width, frame.height, comparing ? 2 : 1, panel ? PANEL_W + 28 : 0)
  const scale = zoom ?? fit
  const page = canvas.pages?.find((p) => p.id === frame.pageId)
  const status = statusOf(frame)

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ExpiredError) return onExpired()
      if (e instanceof ConflictError)
        return setNotice('This frame just changed. Look at the new version before deciding.')
      setNotice(e instanceof Error ? e.message : 'Something went wrong.')
    },
    [onExpired],
  )

  /* pins: a frame comment sits at its point; an element comment follows its
     element, wherever this revision put it */
  const placePins = useCallback(async () => {
    const next = new Map<string, { x: number; y: number }>()
    for (const c of open) {
      if (isFrameComment(c)) next.set(c.id, { x: c.x, y: c.y })
      else if (c.elementId) {
        const rect = await doc.current?.locate(`[data-doop-id="${CSS.escape(c.elementId)}"]`)
        const at = elementCommentPosition(c, rect ? { x: rect.x, y: rect.y } : null)
        if (at) next.set(c.id, at)
      }
    }
    setPins(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is derived from comments
  }, [comments])
  useEffect(() => {
    void placePins()
  }, [placePins])

  async function pinAt(e: React.MouseEvent<HTMLDivElement>) {
    if (!mayComment || comparing || scale === 0 || tool !== 'comment') return
    const box = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - box.left) / scale
    const y = (e.clientY - box.top) / scale
    const hit: ProbeHit | null = (await doc.current?.probe(x, y)) ?? null
    const anchor: CommentAnchor = hit
      ? {
          selector: hit.selector,
          ...(hit.elementId ? { elementId: hit.elementId } : {}),
          snippet: hit.snippet,
          x,
          y,
          elementOrigin: { x: hit.rect.x, y: hit.rect.y },
        }
      : { x, y }
    const label = hit ? describe(hit) : 'this spot'
    setDraft((d) => ({ text: d?.text ?? '', requestChanges: d?.requestChanges ?? false, pin: { x, y, anchor, label } }))
  }

  async function send() {
    if (!draft || !draft.text.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      if (draft.requestChanges) await decide('changes_requested')
      const comment = await rest.comment(frame.id, draft.text.trim(), draft.pin?.anchor ?? {})
      tellHost(session, { type: 'doop:comment', frameId: frame.id, commentId: comment.id })
      setDraft(null)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function decide(status: ApprovalVerdictStatus) {
    const updated = await rest.verdict(frame, status)
    const entry = updated.approval?.history?.at(-1)
    tellHost(session, {
      type: 'doop:verdict',
      frameId: frame.id,
      status,
      by: session.user.name,
      frameUpdatedAt: updated.approval?.approvedFrameUpdatedAt ?? frame.updatedAt,
      ...(entry?.versionId ? { versionId: entry.versionId } : {}),
    })
  }

  async function approve() {
    setBusy(true)
    setNotice(null)
    try {
      await decide('ready_for_dev')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const numbers = new Map(roots.map((c, i) => [c.id, i + 1]))

  /* the Hand drags the stage around; a press with Comment pins */
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  function onStageDown(e: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'hand' || !stage) return
    drag.current = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onStageMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || !stage) return
    stage.scrollLeft = d.left - (e.clientX - d.x)
    stage.scrollTop = d.top - (e.clientY - d.y)
  }
  const step = (factor: number) => setZoom(Math.min(4, Math.max(0.1, (zoom ?? fit) * factor)))
  function startDraft(requestChanges: boolean) {
    setDraft({ text: '', pin: null, requestChanges })
    setPanel('comments')
    if (mayComment) setTool('comment')
  }

  return (
    <section className="review">
      <div
        className={cn('stage', tool === 'hand' && !comparing && 'grab')}
        ref={setStage}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={() => (drag.current = null)}
        style={{ paddingRight: panel ? PANEL_W + 28 : undefined }}
      >
        {scale > 0 &&
          (comparing ? (
            <Compare frame={frame} scale={scale} onError={fail} />
          ) : (
            <div className="sheet" style={{ width: frame.width * scale, height: frame.height * scale }}>
              <FrameDoc
                ref={doc}
                html={frame.html}
                width={frame.width}
                height={frame.height}
                scale={scale}
                onPainted={() => void placePins()}
              />
              <div className={tool === 'comment' ? 'shield pinnable' : 'shield'} onClick={(e) => void pinAt(e)}>
                {open.map((c) => {
                  const at = pins.get(c.id)
                  return at ? (
                    <span key={c.id} className="pin" style={{ left: at.x * scale, top: at.y * scale }}>
                      {numbers.get(c.id)}
                    </span>
                  ) : null
                })}
                {draft?.pin && (
                  <span className="pin draft" style={{ left: draft.pin.x * scale, top: draft.pin.y * scale }}>
                    +
                  </span>
                )}
              </div>
            </div>
          ))}
      </div>

      {panel && (
        <aside className="island side">
          <div className="tabs">
            <button className={panel === 'comments' ? 'tab on' : 'tab'} onClick={() => setPanel('comments')}>
              <Icon name="comment" />
              Comments {open.length > 0 && <span className="num">{open.length}</span>}
            </button>
            <button className={panel === 'history' ? 'tab on' : 'tab'} onClick={() => setPanel('history')}>
              History
            </button>
            <button className="icon close" aria-label="Close" title="Close" onClick={() => setPanel(null)}>
              <Icon name="close" />
            </button>
          </div>
          {panel === 'history' ? (
            <History frame={frame} />
          ) : draft ? (
            <div className="compose">
              <b>{draft.requestChanges ? 'Request changes' : 'New comment'}</b>
              <p className="muted">
                {draft.pin ? `On ${draft.pin.label}.` : 'Click the frame where the change is, or write a general note.'}
              </p>
              <textarea
                autoFocus
                value={draft.text}
                placeholder={draft.requestChanges ? 'What should change, and why?' : 'Write a comment'}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
              <div className="row-end">
                <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn pri" onClick={() => void send()} disabled={busy || !draft.text.trim()}>
                  {draft.requestChanges ? 'Request changes' : 'Comment'}
                </button>
              </div>
            </div>
          ) : (
            <div className="threads">
              {mayComment && (
                <button className="link add" onClick={() => startDraft(false)}>
                  + Add a comment
                </button>
              )}
              {roots.length === 0 && <p className="muted pad">No comments on this frame.</p>}
              {roots.map((c) => (
                <Thread
                  key={c.id}
                  root={c}
                  number={numbers.get(c.id)!}
                  replies={comments.filter((r) => r.parentId === c.id).sort((a, b) => a.at - b.at)}
                  mayComment={mayComment}
                  onError={fail}
                />
              ))}
            </div>
          )}
        </aside>
      )}

      {notice && <div className="notice">{notice}</div>}

      <nav className="island dock" aria-label="Review dock">
        <span className="title" title={`${canvas.name}${page ? ` › ${page.name}` : ''} › ${frame.name}`}>
          {frame.name}
        </span>
        <span className={`badge tone-${status.tone}`} title={status.note}>
          {status.label}
        </span>
        <span className="sep" />
        <DockButton label="Hand (drag to move around)" on={tool === 'hand'} onClick={() => setTool('hand')}>
          <Icon name="hand" />
        </DockButton>
        {mayComment && (
          <DockButton
            label="Comment (click the frame to pin one)"
            on={tool === 'comment'}
            onClick={() => setTool('comment')}
          >
            <Icon name="comment" />
          </DockButton>
        )}
        <span className="sep" />
        <DockButton label="Zoom out" onClick={() => step(1 / 1.25)}>
          <Icon name="minus" />
        </DockButton>
        <button className="zoom" title="Fit the frame" onClick={() => setZoom(null)}>
          {Math.round(scale * 100)}%
        </button>
        <DockButton label="Zoom in" onClick={() => step(1.25)}>
          <Icon name="plus" />
        </DockButton>
        <span className="sep" />
        <DockButton
          label={canCompare(frame) ? 'Compare with the version you decided on' : 'Nothing to compare yet'}
          on={comparing}
          disabled={!canCompare(frame)}
          onClick={() => setMode(comparing ? 'frame' : 'compare')}
        >
          <Icon name="compare" />
        </DockButton>
        <DockButton
          label={open.length ? `Comments (${open.length} open)` : 'Comments'}
          on={!!panel}
          onClick={() => setPanel(panel ? null : 'comments')}
        >
          <Icon name="comment" />
          {open.length > 0 && <span className="badge-dot">{open.length}</span>}
        </DockButton>
        {mayDecide && (
          <>
            <span className="sep" />
            <button
              className="btn"
              disabled={busy || !!draft || frame.approval?.status === 'changes_requested'}
              onClick={() => startDraft(true)}
            >
              <Icon name="undo" />
              Request changes
            </button>
            <button
              className="btn pri"
              disabled={busy || !!draft || frame.approval?.status === 'ready_for_dev'}
              onClick={() => void approve()}
            >
              <Icon name="check" />
              {frame.approval?.status === 'ready_for_dev' ? 'Approved' : 'Approve'}
            </button>
          </>
        )}
      </nav>
    </section>
  )
}

function DockButton({
  label,
  on = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={on ? 'icon on' : 'icon'}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/* the few glyphs the panel draws, as Lucide draws them (the editor's set) */
const ICONS = {
  hand: 'M18 11V6a2 2 0 0 0-4 0 M14 10V4a2 2 0 0 0-4 0v2 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  comment: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  minus: 'M5 12h14',
  plus: 'M5 12h14 M12 5v14',
  compare: 'M3 4h7v16H3z M14 4h7v16h-7z',
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18 M6 6l12 12',
} as const

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

function describe(hit: ProbeHit): string {
  const text = hit.snippet
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? `“${text.length > 48 ? `${text.slice(0, 47)}…` : text}”` : 'this element'
}

function Thread({
  root,
  number,
  replies,
  mayComment,
  onError,
}: {
  root: ElementComment
  number: number
  replies: ElementComment[]
  mayComment: boolean
  onError: (e: unknown) => void
}) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={root.resolvedAt ? 'cm done' : 'cm'}>
      {[root, ...replies].map((c, i) => (
        <div key={c.id} className={i ? 're' : ''}>
          <div className="who">
            {i === 0 && <span className="num">{number}</span>}
            <b>{c.from}</b>
            <span className="muted t">{fmtAgo(c.at)}</span>
          </div>
          <p>{c.text}</p>
        </div>
      ))}
      {root.resolvedAt ? (
        <span className="ok">Resolved{root.resolvedBy ? ` by ${root.resolvedBy}` : ''}</span>
      ) : (
        mayComment && (
          <div className="reply">
            <input
              value={reply}
              placeholder="Reply"
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && reply.trim())
                  void run(() => rest.reply(root.id, reply.trim())).then(() => setReply(''))
              }}
            />
            <button className="link" disabled={busy} onClick={() => void run(() => rest.resolve(root.id))}>
              Resolve
            </button>
          </div>
        )
      )}
    </div>
  )
}

function History({ frame }: { frame: Frame }) {
  const history = frame.approval?.history ?? []
  if (!history.length) return <p className="muted pad">No verdict on this frame yet.</p>
  return (
    <div className="history">
      {[...history].reverse().map((h) => (
        <div key={`${h.at}-${h.status}`} className="muted">
          {h.status === 'ready_for_dev' ? 'Approved' : 'Changes requested'} by {h.by} · {fmtAgo(h.at)}
        </div>
      ))}
    </div>
  )
}

/** The frame now beside the state the last verdict was given on, at the same
 *  scale, scrolling together, with the text that changed between them. */
function Compare({ frame, scale, onError }: { frame: Frame; scale: number; onError: (e: unknown) => void }) {
  const last = lastVerdict(frame)
  const [before, setBefore] = useState<{ html: string } | 'gone' | null>(null)
  useEffect(() => {
    if (!last?.versionId) return
    let stale = false
    rest.version(frame.id, last.versionId).then(
      (v) => !stale && setBefore({ html: v.html }),
      (e: unknown) => {
        if (stale) return
        if (e instanceof Error && /not found/.test(e.message)) setBefore('gone')
        else onError(e)
      },
    )
    return () => {
      stale = true
    }
  }, [frame.id, last?.versionId, onError])
  const changes: TextChange[] = useMemo(
    () => (before && before !== 'gone' ? textChanges(textRuns(before.html), textRuns(frame.html)) : []),
    [before, frame.html],
  )
  if (!last) return null
  if (before === 'gone') return <p className="muted pad">That version is no longer kept.</p>
  if (!before) return <p className="muted pad">Loading the version you decided on…</p>
  const label = last.status === 'ready_for_dev' ? 'approved' : 'changes requested'
  return (
    <div className="compare">
      <div className="pair">
        <figure>
          <figcaption>
            <b>Then</b> · {label} by {last.by}, {fmtAgo(last.at)}
          </figcaption>
          <FrameDoc html={before.html} width={frame.width} height={frame.height} scale={scale} />
        </figure>
        <figure>
          <figcaption>
            <b>Now</b> · {fmtAgo(frame.updatedAt)}
          </figcaption>
          <FrameDoc html={frame.html} width={frame.width} height={frame.height} scale={scale} />
        </figure>
      </div>
      <div className="changes">
        <b>Text that changed</b>
        {changes.length === 0 ? (
          <span className="muted"> · none; the change is in layout or style.</span>
        ) : (
          <ul>
            {changes.slice(0, 12).map((c, i) => (
              <li key={i}>
                {c.removed.length > 0 && <del>{c.removed.join(' ')}</del>}
                {c.removed.length > 0 && c.added.length > 0 && ' → '}
                {c.added.length > 0 && <ins>{c.added.join(' ')}</ins>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
