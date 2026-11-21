/* Backdrops: frames used as a panel behind other frames.

   doop has no lightweight section: a coloured panel with a title, laid
   behind a group of screens, is a frame like any other, a full document.
   Such panels are large (they span the group) and nearly empty, and the
   live-frame pick (liveFrames.ts) liked them best, since it takes the frames
   whose centre is nearest the view's and a panel around the view has its
   centre there. On a page of 47 screens on 22 nested panels (three deep,
   up to 10280x5790) the panels covered 260 Mpx of canvas against the
   screens' 50, and zooming to 60% booted their documents first.

   A backdrop is told by its place and its content together:
   - it fully contains another document frame (not a canvas element), and
     neither is turned;
   - it is large (BACKDROP_MIN_AREA) and sparse: at most BACKDROP_MAX_DENSITY
     elements per million px of its area. The panels above had 6 to 19
     elements (at most 3.7 per Mpx); the screens on them at least 63 (61.5
     per Mpx), and so did every frame of a real instance (555 frames) that
     contains another;
   - it is static: no script, video, canvas, nested document or keyframes,
     so nothing in it moves or answers by itself.
   A backdrop never goes live by distance (liveFrames.ts); it shows its
   picture, at the level the view would give it, and a press, a selection or
   an edit still makes it a live document as before. */

/** a frame smaller than this is cheap whatever it is */
export const BACKDROP_MIN_AREA = 1_000_000
/** elements per million px of a backdrop's area, at most */
export const BACKDROP_MAX_DENSITY = 8

export interface BackdropCandidate {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  element?: boolean
  html: string
}

/** Backdrops are on unless `localStorage['doop:backdrops'] === 'live'`
 *  (the A side of a before/after measurement; read at load). */
export function backdropsEnabled(): boolean {
  try {
    return localStorage.getItem('doop:backdrops') !== 'live'
  } catch {
    return true
  }
}

const MOVING = /<(?:script|video|canvas|iframe|object|embed)\b|@keyframes\b/i
const SKIPPED = /<(style|script|head|template)\b[\s\S]*?<\/\1\s*>/gi
const TAG = /<[a-zA-Z]/g

/* Frame HTML is immutable, so the answer is kept per string (as isCanvasElement does). */
const elementCounts = new Map<string, number>()
const ELEMENT_COUNTS_MAX = 2000

/** The elements of a static document, or null when something in it moves
 *  (script, media, a nested document, keyframes). */
export function staticElementCount(html: string): number | null {
  let known = elementCounts.get(html)
  if (known === undefined) {
    known = MOVING.test(html) ? -1 : (html.replace(SKIPPED, '').match(TAG)?.length ?? 0)
    if (elementCounts.size >= ELEMENT_COUNTS_MAX) elementCounts.clear()
    elementCounts.set(html, known)
  }
  return known < 0 ? null : known
}

function contains(outer: BackdropCandidate, inner: BackdropCandidate): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height &&
    inner.width * inner.height < outer.width * outer.height
  )
}

/** The backdrops among one page's frames. */
export function backdropIds(frames: readonly BackdropCandidate[]): Set<string> {
  const out = new Set<string>()
  const documents = frames.filter((f) => !f.element && !f.rotation)
  for (const f of documents) {
    const area = f.width * f.height
    if (area < BACKDROP_MIN_AREA) continue
    if (!documents.some((g) => g !== f && contains(f, g))) continue
    const count = staticElementCount(f.html)
    if (count === null || count > (BACKDROP_MAX_DENSITY * area) / 1_000_000) continue
    out.add(f.id)
  }
  return out
}
