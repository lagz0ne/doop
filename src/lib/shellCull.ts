import { rotatedBounds } from '../../shared/frameRotation'
import { cullingEnabled, viewRect, type Camera, type FrameBox, type Size } from './liveFrames'

/* Frame shells far from the view leave the render tree.

   A culled frame is a FrameShell (liveFrames.ts), and Chrome gives every
   shell it paints a compositor layer of its own: sparse content does not
   merge. Under the world's composited transform it paints a few thousand
   pixels around the view, so at 60% on a page of desktop screens about six
   frames are in view and nearly a hundred shells have layers, and every
   camera frame rebuilds that whole layer list (Blink's full
   PaintArtifactCompositor update) and the compositor walks it. A pan costs
   in proportion to the shells painted, wherever they are.

   So a shell farther from the view than a margin is taken out of the render
   tree, as tldraw culls the shapes outside its viewport. Its element stays
   (the DOM, React and every reader of `data-frame-shell` see what they saw);
   only the `hidden` attribute goes on and off, written straight to the
   element in the same task as the camera, so a frame coming into view has
   been back in the tree for a while before it gets there. The in/out test is
   arithmetic over the frames' boxes; a camera frame in which no shell crosses
   a margin writes nothing. Shells come back inside SHELL_ENTER_MARGIN and go
   only past SHELL_KEEP_MARGIN, so a camera that jitters at an edge does not
   toggle them; while the camera moves, only past SHELL_DROP_MARGIN. FrameViews are not touched: a frame that wakes, is selected
   or is streamed into is drawn whatever this says. */

/** A shell comes back into the render tree within this many viewports of the
 *  view… It is the sharp margin of the previews (liveFrames.ts), so every
 *  picture fetched at the sharp level is in the tree and loads, and a pan of
 *  half a screen between two animation frames still finds it painted. */
export const SHELL_ENTER_MARGIN = 0.5
/** …and leaves it beyond this many (hysteresis for a camera at an edge). */
export const SHELL_KEEP_MARGIN = 0.75
/** While the camera moves, a shell in the tree leaves it only beyond this
 *  many; at rest the keep margin applies again. See cullShells. */
export const SHELL_DROP_MARGIN = 1.5
/** The camera is at rest once it has not moved for this long (as the live
 *  frames' culling waits, Stage.tsx). */
export const SHELL_SETTLE_MS = 120

/** On with live-frame culling, unless `localStorage['doop:cull-shells'] ===
 *  'off'`: the A side of a before/after measurement in one build. */
export function shellCullingEnabled(): boolean {
  if (!cullingEnabled()) return false
  try {
    return localStorage.getItem('doop:cull-shells') !== 'off'
  } catch {
    return true
  }
}

/** The box a frame covers on the canvas: a rotated frame turns about its
 *  centre (CSS rotate), so its axis-aligned bounds. */
export function shellBox(frame: FrameBox & { rotation?: number }): FrameBox {
  if (!frame.rotation) return { id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height }
  return { id: frame.id, ...rotatedBounds(frame, frame.rotation) }
}

type Rect = ReturnType<typeof viewRect>

export interface ShellRects {
  enter: Rect
  keep: Rect
  drop: Rect
}

/** The world rectangles a shell must reach to come back (`enter`), to stay
 *  at rest (`keep`) and to stay while the camera moves (`drop`); null for a stage not measured yet, where nothing is culled. */
export function shellRects(camera: Camera, stage: Size): ShellRects | null {
  if (stage.width <= 0 || stage.height <= 0 || camera.zoom <= 0) return null
  return {
    enter: viewRect(camera, stage, SHELL_ENTER_MARGIN),
    keep: viewRect(camera, stage, SHELL_KEEP_MARGIN),
    drop: viewRect(camera, stage, SHELL_DROP_MARGIN),
  }
}

/** Whether a shell belongs in the render tree: it overlaps the enter
 *  rectangle, or it is in the tree already and overlaps the keep one (the
 *  drop one while the camera moves, `settled` false). */
export function shellInView(box: FrameBox, rects: ShellRects | null, wasIn: boolean, settled = true): boolean {
  if (!rects) return true
  const r = !wasIn ? rects.enter : settled ? rects.keep : rects.drop
  return box.x < r.x + r.width && box.x + box.width > r.x && box.y < r.y + r.height && box.y + box.height > r.y
}

/* The mounted shells' elements, and the frames currently out of the tree.
   The state is kept per frame, whether it is a shell at the moment or not,
   so a shell that mounts (a FrameView going back to sleep, a page shown
   again) starts in the state the camera last gave it. */
const shells = new Map<string, HTMLElement>()
const culled = new Set<string>()

/** A FrameShell's ref: registers its element and puts it in its state. */
export function trackShell(frameId: string, el: HTMLElement | null): void {
  if (!el) {
    shells.delete(frameId)
    return
  }
  shells.set(frameId, el)
  el.hidden = culled.has(frameId)
}

/** Brings the shells' state up to the camera: only the ones that cross a
 *  margin are written to. Taking a shell out costs a style and layout pass
 *  over it (about 0.25 ms, as much as several camera frames of it being
 *  painted), so a camera that pans back and forth over a dense page (the
 *  whole page at fit) would pay that for dozens of shells a frame and win
 *  nothing. While it moves (`settled` false) a shell stays out to the drop
 *  margin, so such a pan writes nothing and a long one still sheds what it
 *  leaves far behind; once it rests the keep margin applies again. */
export function cullShells(boxes: readonly FrameBox[], camera: Camera, stage: Size, settled = true): void {
  const rects = shellRects(camera, stage)
  for (const box of boxes) {
    const wasIn = !culled.has(box.id)
    const inView = shellInView(box, rects, wasIn, settled)
    if (inView === wasIn) continue
    if (inView) culled.delete(box.id)
    else culled.add(box.id)
    const el = shells.get(box.id)
    if (el) el.hidden = !inView
  }
}
