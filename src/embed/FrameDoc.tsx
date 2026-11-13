import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FRAME_BOOTSTRAP } from '../lib/frameRuntime'
import { FRAME_DOCUMENTS_TAKE_ZOOM_AS_DENSITY } from '../lib/layoutZoom'

/* One frame as a live document, drawn at `scale`, the way the editor draws it:
   the same sandboxed iframe and frame runtime (src/lib/frameRuntime.ts), so a
   reviewer sees exactly what the agents designed, scripts and fonts included,
   and comments can be pinned to the element under the pointer.

   Sharp at any scale: Chromium rasterizes an iframe at the CSS zoom of its
   ancestors, so the document is laid out at a whole-number zoom at or above
   the scale and a transform takes it the rest of the way down, as the
   editor's stage does (src/lib/layoutZoom.ts). Elsewhere it is a transform. */

export interface ProbeHit {
  selector: string
  elementId?: string
  snippet: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface FrameDocHandle {
  /** what lies under a design-px point, as the editor's comment tool reads it */
  probe(x: number, y: number): Promise<ProbeHit | null>
  /** an element's box in design px, or null when the document has none */
  locate(selector: string): Promise<{ x: number; y: number; width: number; height: number } | null>
}

type Pending = (data: Record<string, unknown>) => void

export const FrameDoc = forwardRef<
  FrameDocHandle,
  {
    html: string
    width: number
    height: number
    scale: number
    /** the document has painted this html (its first render, then each change) */
    onPainted?: () => void
  }
>(function FrameDoc({ html, width, height, scale, onPainted }, ref) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const pending = useRef(new Map<number, Pending>())
  const nextReq = useRef(1)
  const [ready, setReady] = useState(false)
  const painted = useRef(onPainted)
  useEffect(() => {
    painted.current = onPainted
  }, [onPainted])

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== iframe.current?.contentWindow) return
      const d = ev.data as Record<string, unknown> | null
      if (!d || typeof d.type !== 'string') return
      if (d.type === 'doop:frame-ready') setReady(true)
      else if (d.type === 'doop:shown') painted.current?.()
      else if (typeof d.reqId === 'number') {
        const resolve = pending.current.get(d.reqId)
        pending.current.delete(d.reqId)
        resolve?.(d)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function request(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const win = iframe.current?.contentWindow
    if (!win || !ready) return Promise.resolve(null)
    const reqId = nextReq.current++
    return new Promise((resolve) => {
      pending.current.set(reqId, resolve)
      win.postMessage({ ...msg, reqId }, '*')
      window.setTimeout(() => {
        if (pending.current.delete(reqId)) resolve(null)
      }, 3000)
    })
  }

  /* the runtime morphs the document in place, so a revision lands without a
     reload or a white flash */
  useEffect(() => {
    if (!ready) return
    void request({ type: 'doop:html', html }).then(() => painted.current?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request reads refs; html and ready are what matter
  }, [ready, html])

  useImperativeHandle(ref, () => ({
    async probe(x, y) {
      const reply = await request({ type: 'doop:probe', x, y })
      return (reply?.hit as ProbeHit | null | undefined) ?? null
    },
    async locate(selector) {
      const reply = await request({ type: 'doop:locate', selector })
      return (reply?.rect as { x: number; y: number; width: number; height: number } | null | undefined) ?? null
    },
  }))

  const layout = FRAME_DOCUMENTS_TAKE_ZOOM_AS_DENSITY ? Math.max(1, Math.ceil(scale - 1e-3)) : 1
  return (
    <div className="doc" style={{ width: width * scale, height: height * scale }}>
      <div style={{ transform: `scale(${scale / layout})`, transformOrigin: '0 0' }}>
        <div style={{ zoom: layout }}>
          <iframe
            ref={iframe}
            title="frame"
            sandbox="allow-scripts"
            srcDoc={FRAME_BOOTSTRAP}
            style={{ width, height, border: 0, display: 'block', background: '#fff' }}
          />
        </div>
      </div>
    </div>
  )
})
