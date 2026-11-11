import { create } from 'zustand'

/* Viewport culling for frame iframes.

   Every frame renders real HTML in its own iframe, and a page of a few hundred
   frames is a few hundred documents laid out, rasterized and kept in memory at
   once: the editor slows down for every click. Only frames the camera can see
   need a live document. The others show their persisted preview image
   (/i/<id>.jpg?preview, the dashboard thumbnail) and get their iframe back
   when they come near the viewport again.

   The Stage computes the live set when the camera settles and publishes it
   here; each FrameView subscribes to its own membership only, so a pan or a
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
/** A frame comes alive when it is within this many viewports of the view… */
export const ENTER_MARGIN = 0.5
/** …and stays alive until it is farther than this (no flicker at the edge). */
export const KEEP_MARGIN = 1
/** At most this many live documents besides the pinned ones; the nearest win. */
export const MAX_LIVE = 24

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
  const near = frames
    .filter((f) => !live.has(f.id) && (readable || f.element))
    .filter((f) => intersects(f, previous.has(f.id) ? keep : enter))
    .map((f) => ({ id: f.id, d: Math.hypot(f.x + f.width / 2 - cx, f.y + f.height / 2 - cy) }))
    .sort((a, b) => a.d - b.d)
  for (const f of near.slice(0, MAX_LIVE)) live.add(f.id)
  return live
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
  set(ids: ReadonlySet<string>): void
}

export const useLiveFrames = create<LiveFramesState>((set, get) => ({
  ids: null,
  set(ids) {
    const prev = get().ids
    if (prev && sameSet(prev, ids)) return
    set({ ids })
  },
}))

/** True when the frame should render its live document. */
export function useFrameLive(frameId: string): boolean {
  return useLiveFrames((s) => s.ids === null || s.ids.has(frameId))
}

/** Where a culled frame's stand-in image comes from: the persisted preview,
 *  re-requested whenever the frame changes. */
export function previewSrc(frameId: string, updatedAt: number): string {
  return `/i/${frameId}.jpg?preview&v=${updatedAt}`
}
