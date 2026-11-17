import { canvasPages, framePageId } from '../shared/pages.ts'
import type { Canvas, Frame, Presence } from '../shared/types.ts'

/* Where the people on a canvas are looking, for agents. The room keeps every
   person's presence (their selected frame, camera and pointer) in the server
   process that holds the socket; the MCP server reads it through this reader,
   which the room registers at startup, so neither imports the other. */

type RoomReader = (canvasId?: string) => { canvasId: string; presence: Presence }[]

let readRoom: RoomReader = () => []

/** The room's presences: people with a live socket, never silent sessions
 *  (view-as, signed-out guests) and never agents. */
export function registerRoomReader(reader: RoomReader): void {
  readRoom = reader
}

/** How many frames in view are named per person; a zoomed-out camera can
 *  hold a whole page, and the largest are the ones being looked at. */
export const MAX_FRAMES_IN_VIEW = 12

export interface FrameRef {
  id: string
  name: string
}

export interface PersonFocus {
  name: string
  /** the frame they have selected (editors only: the room drops a viewer's
   *  selection), or null */
  selectedFrame: FrameRef | null
  /** the page their camera is on */
  page: FrameRef | null
  /** the world rect their screen shows, in design px */
  view: { x: number; y: number; width: number; height: number; zoom: number } | null
  /** frames on screen, the most visible first, with the share of each on screen */
  framesInView: (FrameRef & { visible: number })[]
  /** the frame under their pointer, as last moved */
  pointerFrame: FrameRef | null
  /** the frame to treat as theirs: the selection, else what fills the
   *  screen most, else the one under the pointer */
  focus: FrameRef | null
}

type Rect = { x: number; y: number; width: number; height: number }

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const ref = (f: Frame): FrameRef => ({ id: f.id, name: f.name })

/** One person's focus on a canvas, from their presence. */
export function personFocus(canvas: Canvas, presence: Presence): PersonFocus {
  const pages = canvasPages(canvas)
  const vp = presence.viewport
  const pageId = vp?.pageId && pages.some((p) => p.id === vp.pageId) ? vp.pageId : pages[0]?.id
  const page = pages.find((p) => p.id === pageId)
  const onPage = canvas.frames.filter((f) => !f.demo && !f.hidden && framePageId(canvas, f) === pageId)
  /* the camera maps world to screen as screen = world * zoom + offset */
  const view = vp
    ? { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, width: vp.width / vp.zoom, height: vp.height / vp.zoom }
    : null
  const inView = view
    ? onPage
        .map((f) => ({ f, shown: overlap(view, f), area: f.width * f.height }))
        .filter((v) => v.shown > 0)
        /* what fills the screen, not what is most fully inside it */
        .sort((a, b) => b.shown - a.shown)
        .map(({ f, shown, area }) => ({ ...ref(f), visible: Math.round((shown / Math.max(area, 1)) * 100) / 100 }))
    : []
  const cursor = presence.cursor
  /* frames stack back to front, so the topmost under the point is the last */
  const under = cursor
    ? [...onPage]
        .reverse()
        .find((f) => cursor.x >= f.x && cursor.x <= f.x + f.width && cursor.y >= f.y && cursor.y <= f.y + f.height)
    : undefined
  const selected = presence.activeFrameId ? canvas.frames.find((f) => f.id === presence.activeFrameId) : undefined
  const selectedFrame = selected ? ref(selected) : null
  const pointerFrame = under ? ref(under) : null
  const top = inView[0]
  return {
    name: presence.name,
    selectedFrame,
    page: page ? { id: page.id, name: page.name } : null,
    view: view && vp ? { ...roundRect(view), zoom: Math.round(vp.zoom * 1000) / 1000 } : null,
    framesInView: inView.slice(0, MAX_FRAMES_IN_VIEW),
    pointerFrame,
    focus: selectedFrame ?? (top ? { id: top.id, name: top.name } : pointerFrame),
  }
}

function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
}

/* a tab with a selection says more than one with only a camera */
const telling = (p: Presence) => (p.activeFrameId ? 2 : 0) + (p.viewport ? 1 : 0)

/** Everyone on a canvas now, one entry per person: of a person's open tabs,
 *  the one with a selection, else one with a camera. */
export function canvasFocus(canvas: Canvas): (PersonFocus & { userId?: string })[] {
  const byPerson = new Map<string, Presence>()
  for (const { presence } of readRoom(canvas.id)) {
    const key = presence.userId ?? presence.clientId
    const seen = byPerson.get(key)
    if (!seen || telling(presence) > telling(seen)) byPerson.set(key, presence)
  }
  return [...byPerson.values()].map((p) => ({ userId: p.userId, ...personFocus(canvas, p) }))
}

/** The canvases that have people on them right now. */
export function occupiedCanvasIds(): string[] {
  return [...new Set(readRoom().map((r) => r.canvasId))]
}
