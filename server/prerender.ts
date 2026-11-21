import { PREVIEW_SCALES, type Frame, type PreviewScale } from '../shared/types.ts'
import { htmlLoaded } from './frameHtml.ts'
import type { RendererStatus } from './renderBrowser.ts'
import { store } from './store.ts'
import * as thumbs from './thumbs.ts'

/* Pictures drawn ahead of the first look.

   The editor shows a frame that is not a live document as its picture
   (/i/<id>.webp?preview&s=<level>&v=<version>, thumbs.ts), and a picture is
   drawn by Chromium when it is first asked for. So whoever first opens a
   page after an edit, often an agent's fresh work, looked at white boxes
   while the server drew: 0.3-0.7 s a screen-sized frame and 2-6 s a tall
   page, three at a time (measured on a local production build; a cold page
   of 47 screens took 4.3 s to fill).

   Here a frame whose design changed is drawn in the background once it has
   settled: SETTLE_MS without another change, and not while an agent is still
   streaming into it (every chunk is a change). Only the smallest level: it
   is the one a page asks for when it opens (frames away from the view and
   every frame at fit), and the larger ones stay drawn on demand. One frame
   at a time, at background priority, and only once no interactive render
   (an agent's screenshot, a picture someone is waiting for) has run for
   QUIET_MS: a background page shares the machine's cores with them, and an
   agent's burst of edits is often followed by its own screenshots (measured:
   five screenshots during the drawing of 30 frames took 0.31-1.33 s, against
   0.26-0.59 s with nothing drawn ahead). A frame whose picture is already
   current is skipped. */

export const SETTLE_MS = 4000
export const QUIET_MS = 2000
const LEVEL: PreviewScale = PREVIEW_SCALES[0]

export interface PrerenderDeps {
  getFrame(frameId: string): Frame | undefined
  /** an agent is writing into the frame right now */
  busy(frameId: string): boolean
  /** the frame's stored picture at this level shows it as it is */
  isCurrent(frame: Frame, level: PreviewScale): Promise<boolean>
  draw(frame: Frame, level: PreviewScale): Promise<unknown>
  /** the frame has nothing to draw: no html, or a canvas element (always live) */
  skip(frame: Frame): boolean
  settleMs?: number
}

export function createPrerender(deps: PrerenderDeps) {
  const settleMs = deps.settleMs ?? SETTLE_MS
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /* frames due, oldest first; a frame due again moves to the back */
  const due = new Set<string>()
  let drawing: Promise<void> | null = null

  function schedule(frameId: string) {
    clearTimeout(timers.get(frameId))
    const timer = setTimeout(() => settled(frameId), settleMs)
    timer.unref?.()
    timers.set(frameId, timer)
  }

  function settled(frameId: string) {
    timers.delete(frameId)
    /* still streaming: its last chunk will be along, or the stream ends */
    if (deps.busy(frameId)) return schedule(frameId)
    due.delete(frameId)
    due.add(frameId)
    drawing ??= drain().finally(() => (drawing = null))
  }

  async function drain() {
    /* a Set visits what is added while it is walked */
    for (const frameId of due) {
      due.delete(frameId)
      const frame = deps.getFrame(frameId)
      if (!frame || frame.hidden || deps.skip(frame)) continue
      try {
        if (await deps.isCurrent(frame, LEVEL)) continue
        await deps.draw(frame, LEVEL)
      } catch (e) {
        console.error(`prerender failed for ${frameId}:`, e)
      }
    }
  }

  return {
    schedule,
    /** what is waiting: settling, and due (tests, shutdown) */
    pending: () => ({ settling: timers.size, due: due.size, drawing: drawing !== null }),
    /** resolves when nothing is being drawn (tests) */
    idle: () => drawing ?? Promise.resolve(),
  }
}

/** Resolves once no interactive render has held or waited for a slot for `ms`. */
export async function quietFor(
  ms: number,
  status: () => Pick<RendererStatus, 'interactive' | 'interactiveQueued' | 'lastInteractiveAt'>,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (wait) => new Promise((r) => setTimeout(r, wait).unref?.()),
): Promise<void> {
  for (;;) {
    const s = status()
    const since = now() - s.lastInteractiveAt
    if (!s.interactive && !s.interactiveQueued && since >= ms) return
    await sleep(Math.max(100, ms - since))
  }
}

/* the marker a canvas element carries (src/lib/drawing.ts isCanvasElement):
   an element is always a live document, never shown as its picture */
const CANVAS_ELEMENT = /<body\b[^>]*\bdata-doop-canvas-element=/i

/** Draws the pictures of frames whose design changed, with the server's own
 *  store and renderer. `busy`: a frame an agent is streaming into. */
export function startPrerender(busy: (frameId: string) => boolean) {
  let renderer: Promise<boolean> | undefined
  const prerender = createPrerender({
    getFrame: (frameId) => store.getFrame(frameId),
    busy,
    isCurrent: (frame, level) => thumbs.isCurrent(frame, level),
    draw: async (frame, level) => {
      /* lazy, as every screenshot.ts consumer: no browser, nothing to draw with */
      renderer ??= import('./screenshot.ts').then((m) => m.rendererAvailable())
      if (!(await renderer)) return
      const { rendererStatus } = await import('./screenshot.ts')
      await quietFor(QUIET_MS, rendererStatus)
      await thumbs.create(frame, level, 'background')
    },
    skip: (frame) => htmlLoaded(frame) && (frame.html === '' || CANVAS_ELEMENT.test(frame.html)),
  })
  store.onDrawnChange(prerender.schedule)
  return prerender
}
