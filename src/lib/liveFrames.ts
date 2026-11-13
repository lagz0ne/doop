import { create } from 'zustand'
import { PREVIEW_SCALES, previewLevelFor, type PreviewScale } from '../../shared/types'

/* Viewport culling for frame iframes.

   Every frame renders real HTML in its own iframe, and a page of a few hundred
   frames is a few hundred documents laid out, rasterized and kept in memory at
   once: the editor slows down for every click. Only frames the camera can see
   need a live document. The others show their persisted preview image
   (/i/<id>.jpg?preview, the dashboard thumbnail) and get their iframe back
   when they come near the viewport again.

   A frame that is not live is not a FrameView at all but a FrameShell: its
   preview and its name, three elements and one subscription, where a
   FrameView is some forty hooks, a context menu and forty-odd elements. On a
   page of a few hundred frames that is the difference between the editor
   paying for every frame on every store update and paying for the handful in
   view. A press on a shell wakes it (it becomes a FrameView, synchronously,
   before the press is delivered), so every gesture works as it always did.

   The Stage computes the live set when the camera settles and publishes it
   here; each frame subscribes to its own membership only, so a pan or a
   zoom re-renders nothing but the frames that flip. */

export interface FrameBox {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** canvas elements (shapes, text) have no opaque preview: never imaged */
  element?: boolean
}

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface Size {
  width: number
  height: number
}

/** Culling is on unless `localStorage['doop:cull'] === 'off'`: the escape
 *  hatch for debugging, and the A side of a before/after measurement. */
export function cullingEnabled(): boolean {
  try {
    return localStorage.getItem('doop:cull') !== 'off'
  } catch {
    return true
  }
}

/** Below this zoom a frame is too small on screen for its live document to
 *  matter: it shows its preview image even in view. */
export const LIVE_MIN_ZOOM = 0.3
/** A frame comes alive when it is within this many viewports of the view…
 *
 *  The margin was half a viewport, so that a short pan showed documents, not
 *  blanks. A frame without its document shows a sharp picture of itself now,
 *  and keeps it until the document has painted, so the margin only decides
 *  how many documents boot that nobody is looking at: at 60% on a page of
 *  desktop screens, 12 went live at every rest of the camera where 4 to 6
 *  were on screen. Each boot is a FrameView mounted on the editor's main
 *  thread and a document started in the frames' process. */
export const ENTER_MARGIN = 0.1
/** …and stays alive until it is farther than this (no flicker at the edge). */
export const KEEP_MARGIN = 0.5
/** The frames within this many viewports of the resting view get their
 *  picture at the sharp level: wider than the live margin, so what a pan
 *  brings in is already crisp. */
export const SHARP_MARGIN = 0.5
/** At most this many live documents besides the pinned ones; the nearest win. */
export const MAX_LIVE = 24
/** A selection this large pins nothing: selecting a whole page must not boot
 *  a document per frame. Each frame still follows the distance rules. */
export const MAX_PINNED_SELECTION = 6
/** Frames woken by a press stay FrameViews until this many newer ones exist. */
const MAX_WOKEN = 8

/** The world rectangle the camera shows, grown by `margin` viewports each side. */
export function viewRect(camera: Camera, stage: Size, margin: number) {
  const width = stage.width / camera.zoom
  const height = stage.height / camera.zoom
  const x = -camera.x / camera.zoom
  const y = -camera.y / camera.zoom
  return {
    x: x - width * margin,
    y: y - height * margin,
    width: width * (1 + 2 * margin),
    height: height * (1 + 2 * margin),
  }
}

function intersects(a: FrameBox, r: ReturnType<typeof viewRect>): boolean {
  return a.x < r.x + r.width && a.x + a.width > r.x && a.y < r.y + r.height && a.y + a.height > r.y
}

/**
 * The frames that get a live iframe: every pinned frame (selected, being
 * edited, streamed into), plus the frames near the view (nearest first, up to
 * MAX_LIVE) when the zoom is high enough to read them. Canvas elements are
 * culled by distance only, since they have no preview image to stand in.
 */
export function computeLiveFrames(
  frames: readonly FrameBox[],
  camera: Camera,
  stage: Size,
  pinned: ReadonlySet<string>,
  previous: ReadonlySet<string>,
): Set<string> {
  const live = new Set<string>()
  for (const f of frames) if (pinned.has(f.id)) live.add(f.id)
  if (stage.width <= 0 || stage.height <= 0 || camera.zoom <= 0) return live
  const enter = viewRect(camera, stage, ENTER_MARGIN)
  const keep = viewRect(camera, stage, KEEP_MARGIN)
  const cx = enter.x + enter.width / 2
  const cy = enter.y + enter.height / 2
  const readable = camera.zoom >= LIVE_MIN_ZOOM
  const near = frames.filter((f) => !live.has(f.id) && intersects(f, previous.has(f.id) ? keep : enter))
  /* an element has no preview to stand in for it, so every one near the view
     is live whatever the zoom, and none of them counts against the cap */
  for (const f of near) if (f.element) live.add(f.id)
  if (!readable) return live
  const documents = near
    .filter((f) => !f.element)
    .map((f) => ({ id: f.id, d: Math.hypot(f.x + f.width / 2 - cx, f.y + f.height / 2 - cy) }))
    .sort((a, b) => a.d - b.d)
  for (const f of documents.slice(0, MAX_LIVE)) live.add(f.id)
  return live
}

/** The frames whose previews are worth a sharper picture than the smallest:
 *  the ones within SHARP_MARGIN of the resting view (those the camera
 *  shows, or will with a short pan). Everything farther keeps the smallest
 *  level. Without that limit a zoom-in changed every preview on the page to
 *  the large picture; the far ones only queued it (they load lazily), and a
 *  jump back out to the whole page then fetched and decoded hundreds of
 *  full-size pictures at once, each about to be replaced by the small one. */
export function sharpPreviews(frames: readonly FrameBox[], camera: Camera, stage: Size): Set<string> {
  const sharp = new Set<string>()
  if (stage.width <= 0 || stage.height <= 0 || camera.zoom <= 0) return sharp
  const near = viewRect(camera, stage, SHARP_MARGIN)
  for (const f of frames) if (!f.element && intersects(f, near)) sharp.add(f.id)
  return sharp
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

interface LiveFramesState {
  /** null until the Stage has measured itself: every frame stays live, the
   *  behaviour before culling, so nothing depends on the first measurement */
  ids: ReadonlySet<string> | null
  /** frames a press woke: FrameViews (not necessarily live), newest last */
  woken: readonly string[]
  /** device pixels per frame pixel where the camera last came to rest
   *  (zoom × devicePixelRatio); null until it has rested on this page. The
   *  previews of the frames near that view (`sharp`) are fetched at the
   *  pyramid level that covers it, the others at the smallest. */
  previewDensity: number | null
  sharp: ReadonlySet<string>
  set(ids: ReadonlySet<string>): void
  setPreviews(density: number | null, sharp?: ReadonlySet<string>): void
  wake(frameId: string): void
}

export const useLiveFrames = create<LiveFramesState>((set, get) => ({
  ids: null,
  woken: [],
  previewDensity: null,
  sharp: new Set(),
  set(ids) {
    const prev = get().ids
    if (prev && sameSet(prev, ids)) return
    set({ ids })
  },
  setPreviews(density, sharp = new Set()) {
    const prev = get()
    if (prev.previewDensity === density && sameSet(prev.sharp, sharp)) return
    set({ previewDensity: density, sharp: sameSet(prev.sharp, sharp) ? prev.sharp : sharp })
  },
  wake(frameId) {
    const woken = get().woken
    if (woken[woken.length - 1] === frameId) return
    set({ woken: [...woken.filter((id) => id !== frameId), frameId].slice(-MAX_WOKEN) })
  },
}))

/** True when the frame is drawn by a full FrameView rather than a FrameShell:
 *  it is live, or a press woke it. (Selection and streaming are the caller's
 *  to add: they live in the canvas store.) */
export function useFrameAwake(frameId: string): boolean {
  return useLiveFrames((s) => s.ids === null || s.ids.has(frameId) || s.woken.includes(frameId))
}

/** The frames a selection pins live: all of a small one, none of a large one. */
export function pinnedBySelection(selectedIds: readonly string[]): readonly string[] {
  return selectedIds.length <= MAX_PINNED_SELECTION ? selectedIds : []
}

/** True once frames are being culled at all (false with culling switched
 *  off): only then is there a preview to show for a frame. */
export function usePreviews(): boolean {
  return useLiveFrames((s) => s.ids !== null)
}

/** True when the frame should render its live document. */
export function useFrameLive(frameId: string): boolean {
  return useLiveFrames((s) => s.ids === null || s.ids.has(frameId))
}

/** The level of the preview pyramid (shared/types.ts) a frame's picture is
 *  shown at. Near the resting view it is the one that covers the frame as
 *  the camera draws it, so the picture is as sharp as the screen and no
 *  larger; farther away it is the smallest. null while the camera has not
 *  rested on the page yet. Changes only when the level does, so a zoom
 *  re-renders a preview a couple of times across its whole range. */
export function usePreviewLevel(frame: { id: string; width: number; height: number }): PreviewScale | null {
  return useLiveFrames((s) => {
    if (s.previewDensity === null) return null
    return s.sharp.has(frame.id) ? previewLevelFor(frame, s.previewDensity) : (PREVIEW_SCALES[0] ?? null)
  })
}

/** Where a culled frame's stand-in image comes from: the persisted preview
 *  at one level of the pyramid, re-requested whenever the frame changes. */
export function previewSrc(frameId: string, updatedAt: number, level: PreviewScale): string {
  return `/i/${frameId}.webp?preview&s=${level}&v=${updatedAt}`
}
