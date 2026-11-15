/* Pictures in place of documents while the zoom moves.

   A live frame is a document in another process, and every step of a zoom
   rasters it again at the new scale: a pinch over a page rastered the
   frames' process some 350 times, against a few dozen for the editor itself.
   Nobody reads a document while it grows or shrinks under a pinch, and each
   live frame has a picture of itself already (its preview, liveFrames.ts),
   the one it shows while its document boots. So, behind a switch, a zoom
   shows the pictures: from the camera's first change of zoom until it
   settles, each live frame nobody is working in hides its iframe
   (`visibility: hidden`, which stops its raster) under its picture. When the
   camera settles the iframe is shown again under the picture, and the
   picture goes once the document has painted, so there is no blank between
   them. A pan alone changes nothing.

   Off by default: the pictures are the last saved state of each frame, a
   little softer than the document and without what only runs live
   (animation, video, scroll position). On with
   `localStorage['doop:zoom-pictures'] = 'on'`.

   The swap is a few style writes on the live frames' own elements, never a
   class or a variable on the stage, which would restyle the whole canvas. */

/** The switch, read when it is needed: on only with
 *  `localStorage['doop:zoom-pictures'] === 'on'`. */
export function zoomPicturesEnabled(): boolean {
  try {
    return localStorage.getItem('doop:zoom-pictures') === 'on'
  } catch {
    return false
  }
}

/** What a frame is doing, for the decision below. */
export interface ZoomPictureState {
  /** it has a live document, and that document has painted */
  documentShown: boolean
  /** a standalone shape or text: transparent, with no picture of its own */
  canvasElement: boolean
  selected: boolean
  /** an element inside it is picked (the element panel talks to it) */
  elementPicked: boolean
  /** inline text editing */
  editing: boolean
  /** the path editor is open on one of its shapes */
  pathEditing: boolean
  /** dragged, resized or turned, or an element in it moved or resized */
  moving: boolean
  /** an agent is streaming into it */
  streaming: boolean
  /** another person has it open */
  peerEditing: boolean
  /** the canvas is in Prototype mode, whose links and overlays live in documents */
  prototypeMode: boolean
}

/** True when a frame keeps its document through a zoom: everything a person
 *  or an agent is working in, everything that has no document showing yet,
 *  and everything without a picture. Conservative on purpose: a swapped
 *  frame is a picture, and a picture cannot be clicked into or follow an
 *  edit. */
export function keepsDocument(s: ZoomPictureState): boolean {
  return (
    !s.documentShown ||
    s.canvasElement ||
    s.selected ||
    s.elementPicked ||
    s.editing ||
    s.pathEditing ||
    s.moving ||
    s.streaming ||
    s.peerEditing ||
    s.prototypeMode
  )
}

/** A live frame that may show its picture through a zoom (registered by its
 *  FrameView only while keepsDocument is false for it). */
export interface ZoomPictureFrame {
  iframe(): HTMLElement | null
  picture(): HTMLElement | null
  /** resolves once the document has painted after being shown again (or
   *  has not answered in time, when the picture goes anyway) */
  painted(): Promise<unknown>
}

const frames = new Map<string, ZoomPictureFrame>()
/* the frames showing their picture, each with the swap it belongs to: a
   paint that answers after a newer swap must not take the picture down */
const swapped = new Map<string, number>()
let active = false
let swaps = 0

/** True when the picture has loaded, so showing it never shows a blank. */
export function pictureReady(picture: HTMLElement | null): boolean {
  const img = picture?.querySelector('img')
  return !!img && img.complete && img.naturalWidth > 0
}

/** The registered frames to swap: those whose picture is ready. */
export function framesToSwap(candidates: ReadonlyMap<string, ZoomPictureFrame>): string[] {
  return [...candidates].filter(([, f]) => !!f.iframe() && pictureReady(f.picture())).map(([id]) => id)
}

/** Registers a live frame that may swap; the returned call takes it back,
 *  putting its document back first if it was showing its picture. */
export function registerZoomPicture(id: string, frame: ZoomPictureFrame): () => void {
  frames.set(id, frame)
  return () => {
    if (frames.get(id) !== frame) return
    release(id, frame)
    frames.delete(id)
  }
}

/** The camera's zoom has changed: the frames that may swap show their
 *  picture until zoomPicturesEnd. Once per gesture; the Stage calls it only
 *  with the switch on. */
export function zoomPicturesStart(): void {
  if (active) return
  active = true
  swaps += 1
  for (const id of framesToSwap(frames)) {
    const frame = frames.get(id)
    const iframe = frame?.iframe()
    const picture = frame?.picture()
    if (!iframe || !picture) continue
    picture.style.visibility = 'visible'
    iframe.style.visibility = 'hidden'
    swapped.set(id, swaps)
  }
}

/** True from zoomPicturesStart until zoomPicturesEnd. */
export function zoomPicturesActive(): boolean {
  return active
}

/** The camera has settled: every swapped frame shows its document again. */
export function zoomPicturesEnd(): void {
  if (!active) return
  active = false
  for (const [id, frame] of frames) release(id, frame)
}

function release(id: string, frame: ZoomPictureFrame) {
  const swap = swapped.get(id)
  if (swap === undefined) return
  const iframe = frame.iframe()
  if (iframe) iframe.style.visibility = ''
  void frame.painted().then(() => {
    /* a new gesture took the frame again meanwhile: its picture stays */
    if (swapped.get(id) !== swap) return
    swapped.delete(id)
    const picture = frame.picture()
    if (picture) picture.style.visibility = 'hidden'
  })
}

/** The frames showing their picture now, for tests. */
export function swappedFrames(): string[] {
  return [...swapped.keys()]
}
