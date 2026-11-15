import { create } from 'zustand'
import { PREVIEW_SCALES, previewLevelFor, type PreviewScale } from '../../shared/types'
import { previewSrc, type Camera, type Size } from './liveFrames'
import { ellipsisCut, PAD, type NameAtlas, type NameCell } from './gpuLabels'

/* Culled frames drawn on one GPU canvas, with nothing of them in the DOM.

   A frame without its live document is a FrameShell: its preview and its name
   (liveFrames.ts). Chrome gives every shell a compositor layer of its own,
   and every camera frame rebuilds the layer list (Layerize) at a cost that
   follows the number of layers, so on a page of a few hundred frames that
   rebuild, not drawing, was what a pan cost. Pictures drawn elsewhere while
   the shells stayed in the DOM for their names and hit testing saved nothing:
   the layers were still there. Only frames with no element at all leave it.

   So with this on, one WebGL2 canvas under the world draws a culled frame
   whole, wherever it can stand in for the shell: its picture (the preview the
   <img> would have asked for), the name above it (from a texture of names,
   gpuLabels.ts) and the hover ring, and FrameSlot renders nothing for it. A
   press on the empty stage is resolved to a drawn frame here by arithmetic
   (`frameAt`), and the Stage wakes it and hands it the press, as it does for
   a shell. A camera move is one draw: a uniform per picture and one call for
   every name, no style, layout, paint or layer work.

   A frame is drawn only once its picture is on the GPU and its name is in
   the texture, and only where it is the plain case: a canvas element, an
   empty, hidden or locked frame, one with a review badge or a sync or GitHub
   mark keeps its shell, as does every frame while WebGL2 is missing, the
   context is lost, or a FrameView lies under it (the canvas is under the
   whole stack, so it cannot draw a frame above something in the DOM). Live
   documents stay iframes: they are sandboxed (an opaque origin), so no canvas
   API may draw them.

   Off unless `localStorage['doop:gpu']` is 'on' (or 'force', which accepts a
   software GL as well, for measuring on a machine without a GPU). */

export type GpuMode = 'off' | 'on' | 'force'

export function gpuMode(): GpuMode {
  try {
    const v = localStorage.getItem('doop:gpu')
    return v === 'on' || v === 'force' ? v : 'off'
  } catch {
    return 'off'
  }
}

/** Screen px between a frame's name and its top edge (FrameView's LABEL_GAP). */
export const LABEL_GAP = 6

/** A frame as this layer sees it, in the page's paint order. */
export interface PictureFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  /** the canvas may stand in for its shell: a document with a picture whose
   *  title is its name alone (no lock, mark or review badge) */
  candidate: boolean
  /** hidden: painted only while selected, and never a target (HiddenFrameView) */
  hidden?: boolean
  /** the name over the frame as the title lays it out ('' for none) */
  label: string
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

type Geometry = Pick<PictureFrame, 'x' | 'y' | 'width' | 'height' | 'rotation'>

/** The page box of a frame, turned frames included, with `top` page px of
 *  its own space above it (its name) counted in. */
export function frameBounds(f: Geometry, top = 0): Box {
  const r = f.rotation ? (f.rotation * Math.PI) / 180 : 0
  const c = Math.cos(r)
  const s = Math.sin(r)
  const hw = f.width / 2
  const hh = f.height / 2
  const cx = f.x + hw
  const cy = f.y + hh
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [lx, ly] of [
    [-hw, -hh - top],
    [hw, -hh - top],
    [-hw, hh],
    [hw, hh],
  ] as const) {
    const x = cx + lx * c - ly * s
    const y = cy + lx * s + ly * c
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return { x0, y0, x1, y1 }
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

/** Page px a frame's name takes above it at `zoom`, gap included: constant on
 *  screen, so it grows on the page as the camera zooms out. */
export function nameStrip(lineHeight: number, zoom: number): number {
  return zoom > 0 && lineHeight > 0 ? (LABEL_GAP + lineHeight) / zoom : 0
}

/**
 * The frames the canvas draws. The canvas lies under the whole frame stack,
 * so it can only stand in for a frame that nothing in the DOM lies under: a
 * frame overlapping something lower in the paint order that stays in the DOM
 * (a FrameView, a shell, a canvas element, a selected hidden frame), names
 * counted (`strip`, page px above each named frame), stays a shell, or the
 * canvas would draw it beneath what it should cover. Pages lay frames side
 * by side, so that is the rare case. `ready`: its picture and name are on
 * the GPU, so the shell has nothing left to show.
 */
export function gpuDrawnFrames(
  frames: readonly PictureFrame[],
  inDom: (id: string) => boolean,
  ready: (f: PictureFrame) => boolean,
  strip: number,
): Set<string> {
  const drawn = new Set<string>()
  const below: Box[] = []
  for (const f of frames) {
    const dom = inDom(f.id)
    if (!dom && f.hidden) continue
    const box = frameBounds(f, f.label ? strip : 0)
    if (!dom && f.candidate && ready(f) && !below.some((b) => overlaps(b, box))) {
      drawn.add(f.id)
      continue
    }
    below.push(box)
  }
  return drawn
}

/**
 * The topmost of `frames` (paint order, back to front) at page point x, y:
 * on its box, turned as it is, or on its name, the strip the DOM title
 * covers (the frame's width, a line high, LABEL_GAP screen px above it; the
 * gap itself is not part of it).
 */
export function frameAt(
  frames: readonly Pick<PictureFrame, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'label'>[],
  x: number,
  y: number,
  zoom: number,
  lineHeight: number,
): { id: string; name: boolean } | null {
  const top = nameStrip(lineHeight, zoom)
  const gap = zoom > 0 ? LABEL_GAP / zoom : 0
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!
    const hw = f.width / 2
    const hh = f.height / 2
    let dx = x - f.x - hw
    let dy = y - f.y - hh
    if (f.rotation) {
      const r = (-f.rotation * Math.PI) / 180
      const c = Math.cos(r)
      const s = Math.sin(r)
      const ux = dx * c - dy * s
      dy = dx * s + dy * c
      dx = ux
    }
    const lx = dx + hw
    const ly = dy + hh
    if (lx < 0 || lx > f.width) continue
    if (ly >= 0 && ly <= f.height) return { id: f.id, name: false }
    if (f.label && ly >= -top && ly < -gap) return { id: f.id, name: true }
  }
  return null
}

/** The preview a drawn frame shows: the level `usePreviewLevel` would pick. */
export function pictureSrc(
  frame: { id: string; width: number; height: number; updatedAt: number },
  density: number | null,
  sharp: ReadonlySet<string>,
): string | null {
  if (density === null) return null
  const level: PreviewScale | null = sharp.has(frame.id) ? previewLevelFor(frame, density) : (PREVIEW_SCALES[0] ?? null)
  return level === null ? null : previewSrc(frame.id, frame.updatedAt, level)
}

interface GpuPicturesState {
  /** the frames the canvas draws: FrameSlot renders nothing for them */
  drawn: ReadonlySet<string>
  setDrawn(drawn: ReadonlySet<string>): void
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

export const useGpuPictures = create<GpuPicturesState>((set, get) => ({
  drawn: new Set(),
  setDrawn(drawn) {
    if (!sameSet(get().drawn, drawn)) set({ drawn })
  },
}))

/** True when the canvas draws this frame: it has no element of its own. */
export function useGpuPicture(frameId: string): boolean {
  return useGpuPictures((s) => s.drawn.has(frameId))
}

let hitTest: ((e: PointerEvent) => string | null) | null = null

/** Set by the Stage's canvas while it draws frames (StagePictures). */
export function setGpuHitTest(test: ((e: PointerEvent) => string | null) | null) {
  hitTest = test
}

/** The drawn frame a press on the empty stage landed on, if any: the Stage
 *  wakes it and hands it the press, as it does for a shell. */
export function gpuFrameAt(e: PointerEvent): string | null {
  return hitTest ? hitTest(e) : null
}

/* ---- the renderer ---- */

/** A picture to keep on the GPU: every frame the canvas could draw, so it is
 *  ready when the frame is culled. */
export interface Picture {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** null while there is none to ask for */
  src: string | null
  /** in the DOM now (live): fetched after the others */
  later: boolean
}

const PICTURE_VERTEX = `#version 300 es
precision highp float;
in vec2 a_unit;
uniform vec2 u_view;   // canvas size, device px
uniform vec3 u_cam;    // camera x, y (css px), zoom
uniform float u_dpr;
uniform vec4 u_q[2];   // frame x, y, width, height | cos, sin of its turn, depth
uniform float u_mode;  // 0 its picture, 1 its hover ring
out vec2 v_local;
void main() {
  vec4 r = u_q[0];
  vec4 t = u_q[1];
  float s = u_cam.z * u_dpr;
  /* a device pixel past the edge for its coverage; the ring is a screen
     pixel wider */
  float pad = (u_mode > 0.5 ? u_dpr + 1.0 : 1.0) / s;
  vec2 local = mix(vec2(-pad), r.zw + pad, a_unit);
  v_local = local;
  vec2 rel = local - 0.5 * r.zw;
  vec2 page = r.xy + 0.5 * r.zw + vec2(rel.x * t.x - rel.y * t.y, rel.x * t.y + rel.y * t.x);
  vec2 dev = (page * u_cam.z + u_cam.xy) * u_dpr;
  vec2 clip = dev / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, t.z, 1.0);
}`

const PICTURE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_local;
uniform vec3 u_cam;
uniform float u_dpr;
uniform vec4 u_q[2];
uniform float u_mode;
uniform sampler2D u_tex;
uniform vec4 u_ring;   // premultiplied
out vec4 o;
void main() {
  vec2 wh = u_q[0].zw;
  float s = u_cam.z * u_dpr;
  /* coverage of this pixel by the frame's box: an antialiased edge that
     moves by fractions of a pixel, as the DOM's does */
  vec2 din = min(v_local, wh - v_local) * s;
  float inside = clamp(min(din.x, din.y) + 0.5, 0.0, 1.0);
  if (u_mode > 0.5) {
    /* the shell's hover shadow: a one screen px spread around the box */
    float r = 1.0 / u_cam.z;
    vec2 dout = min(v_local + r, wh + r - v_local) * s;
    float a = clamp(min(dout.x, dout.y) + 0.5, 0.0, 1.0) - inside;
    if (a <= 0.0) discard;
    o = u_ring * a;
    return;
  }
  if (inside <= 0.0) discard;
  vec4 c = texture(u_tex, clamp(v_local / wh, 0.0, 1.0));
  /* premultiplied picture over the frame's white ground */
  o = vec4(c.rgb + (1.0 - c.a), 1.0) * inside;
}`

const LABEL_VERTEX = `#version 300 es
precision highp float;
in vec2 a_unit;
in vec4 a_frame;       // frame x, y, width, height (page px)
in vec4 a_turn;        // cos, sin, depth, snap to device px
in vec4 a_box;         // x, y, width, height from the title's top left (screen px)
in vec4 a_uv;          // the atlas rect shown
uniform vec2 u_view;
uniform vec3 u_cam;
uniform float u_dpr;
uniform float u_top;   // the title's top above the frame (screen px)
out vec2 v_uv;
void main() {
  float z = u_cam.z;
  vec2 c = a_turn.xy;
  vec2 hw = 0.5 * a_frame.zw;
  vec2 rel = vec2(0.0, -u_top / z) - hw;
  vec2 origin = a_frame.xy + hw + vec2(rel.x * c.x - rel.y * c.y, rel.x * c.y + rel.y * c.x);
  vec2 dev = (origin * z + u_cam.xy) * u_dpr;
  vec2 off = a_box.xy * u_dpr;
  if (a_turn.w > 0.5) {
    /* an upright name starts on a whole device pixel, as text does */
    dev = floor(dev + off + 0.5);
    off = vec2(0.0);
  }
  vec2 d = off + a_unit * a_box.zw * u_dpr;
  dev += vec2(d.x * c.x - d.y * c.y, d.x * c.y + d.y * c.x);
  v_uv = mix(a_uv.xy, a_uv.zw, a_unit);
  vec2 clip = dev / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, a_turn.z, 1.0);
}`

const LABEL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_atlas;
out vec4 o;
void main() {
  o = texture(u_atlas, v_uv);
}`

/** Floats per name quad: frame, turn, box, uv. */
const LABEL_FLOATS = 16

interface Texture {
  src: string
  tex: WebGLTexture
  bytes: number
  /** the last draw that showed it or found it near the view */
  seen: number
}

interface Pending {
  src: string
  attempt: number
  /** no new request before this time (a failed one backs off) */
  notBefore: number
}

/** A drawn frame, with what its draw needs worked out ahead. */
interface Item {
  id: string
  /** u_q: x, y, width, height, cos, sin, depth, 0 */
  q: Float32Array
  /** its page box, for culling */
  x0: number
  y0: number
  x1: number
  y1: number
  width: number
  cell: NameCell | null
  upright: boolean
}

/** Requests in flight at once, nearest the view first. */
const MAX_LOADS = 6
/** Main-thread time a frame may spend uploading pictures. */
const UPLOAD_BUDGET_MS = 4
/** Sharp pictures are asked for this many viewports around the view, the
 *  smallest level (a few hundred KB each) this many… */
const LOAD_MARGIN = 1
const SMALL_LOAD_MARGIN = 4
/** …and a texture not drawn for a while is dropped past this many bytes. */
const TEXTURE_BUDGET = 256 * 1024 * 1024
const PREVIEW_RETRIES = 4
/** How often a moving camera looks for pictures to fetch. */
const LOAD_EVERY_MS = 150

export interface RendererEvents {
  /** the context was lost (true) or restored (false) */
  lost(lost: boolean): void
  /** a picture arrived on the GPU or left it: which frames are ready changed */
  textures(): void
}

/**
 * Draws the frames with WebGL2. Owns one texture per picture (the one last
 * uploaded for a frame, kept until its replacement has arrived, as an <img>
 * keeps painting while its new src loads), fetches and decodes pictures off
 * the main thread (`createImageBitmap`), and uploads a few per animation
 * frame. Paint order is kept with depth: each drawn frame has its own, so a
 * name or ring drawn after every picture still goes under the frames above
 * it, and all the names are one instanced draw.
 */
export class PictureRenderer {
  private gl: WebGL2RenderingContext
  private pictureProgram!: WebGLProgram
  private labelProgram!: WebGLProgram
  private pictureVao!: WebGLVertexArrayObject
  private labelVao!: WebGLVertexArrayObject
  private labelBuffer!: WebGLBuffer
  private atlasTex!: WebGLTexture
  private pu!: Record<string, WebGLUniformLocation | null>
  private lu!: Record<string, WebGLUniformLocation | null>
  private textures = new Map<string, Texture>()
  private next = new Map<string, Pending>()
  private loading = new Map<string, AbortController>()
  private uploads: { id: string; src: string; bitmap: ImageBitmap }[] = []
  private pictures = new Map<string, Picture>()
  private items: Item[] = []
  private atlas: NameAtlas | null = null
  private atlasUploaded = -1
  private labels = new Float32Array(0)
  private labelCount = 0
  private labelsZoom = NaN
  private labelsDirty = true
  private labelCapacity = 0
  private ring = new Float32Array(4)
  private hoverId: string | null = null
  private hover = -1
  private hoverQ = new Float32Array(8)
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private stage: Size = { width: 0, height: 0 }
  private dpr = 1
  private raf = 0
  private retry = 0
  private loadTimer = 0
  private frameNo = 0
  private maxSide = 4096
  private lost = false
  private disposed = false
  private texturesChanged = false

  constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private events: RendererEvents,
  ) {
    this.gl = gl
    this.init()
    canvas.addEventListener('webglcontextlost', this.handleLost)
    canvas.addEventListener('webglcontextrestored', this.handleRestored)
  }

  /** A renderer on the canvas, or null where WebGL2 is missing (or software, unless forced). */
  static create(canvas: HTMLCanvasElement, mode: GpuMode, events: RendererEvents): PictureRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: mode !== 'force',
    })
    if (!gl) return null
    try {
      return new PictureRenderer(canvas, gl, events)
    } catch (err) {
      console.warn('[doop] GPU pictures off:', err)
      return null
    }
  }

  get isLost() {
    return this.lost
  }

  private init() {
    const gl = this.gl
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, source)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const program = (vertex: string, fragment: string, uniforms: string[]) => {
      const p = gl.createProgram()
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex))
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
        throw new Error(gl.getProgramInfoLog(p) ?? 'program')
      return { p, u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(p, n)])) }
    }
    const picture = program(PICTURE_VERTEX, PICTURE_FRAGMENT, [
      'u_view',
      'u_cam',
      'u_dpr',
      'u_q',
      'u_mode',
      'u_tex',
      'u_ring',
    ])
    const label = program(LABEL_VERTEX, LABEL_FRAGMENT, ['u_view', 'u_cam', 'u_dpr', 'u_top', 'u_atlas'])
    this.pictureProgram = picture.p
    this.pu = picture.u
    this.labelProgram = label.p
    this.lu = label.u

    const unit = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, unit)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const unitAttribute = (p: WebGLProgram) => {
      const at = gl.getAttribLocation(p, 'a_unit')
      gl.bindBuffer(gl.ARRAY_BUFFER, unit)
      gl.enableVertexAttribArray(at)
      gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
    }
    this.pictureVao = gl.createVertexArray()
    gl.bindVertexArray(this.pictureVao)
    unitAttribute(picture.p)
    this.labelVao = gl.createVertexArray()
    gl.bindVertexArray(this.labelVao)
    unitAttribute(label.p)
    this.labelBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.labelBuffer)
    for (const [i, name] of ['a_frame', 'a_turn', 'a_box', 'a_uv'].entries()) {
      const at = gl.getAttribLocation(label.p, name)
      gl.enableVertexAttribArray(at)
      gl.vertexAttribPointer(at, 4, gl.FLOAT, false, LABEL_FLOATS * 4, i * 16)
      gl.vertexAttribDivisor(at, 1)
    }
    gl.bindVertexArray(null)
    this.labelCapacity = 0
    this.labelsDirty = true

    this.atlasTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.atlasUploaded = -1

    this.maxSide = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthFunc(gl.LEQUAL)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
  }

  /** The largest texture side the GPU takes (for the names' atlas). */
  get maxTextureSide() {
    return this.maxSide
  }

  private handleLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
    for (const c of this.loading.values()) c.abort()
    this.loading.clear()
    for (const u of this.uploads) u.bitmap.close()
    this.uploads = []
    this.textures.clear()
    this.events.lost(true)
  }

  private handleRestored = () => {
    if (this.disposed) return
    try {
      this.init()
    } catch {
      return
    }
    this.lost = false
    this.events.lost(false)
    this.invalidate()
  }

  /** True once a picture of this frame (any version) is on the GPU. */
  hasPicture(id: string): boolean {
    return this.textures.has(id)
  }

  /** The pictures to keep on the GPU; any other is dropped. */
  setPictures(pictures: readonly Picture[]) {
    this.pictures = new Map(pictures.map((p) => [p.id, p]))
    let dropped = false
    for (const [id, t] of this.textures)
      if (!this.pictures.has(id)) {
        if (!this.lost) this.gl.deleteTexture(t.tex)
        this.textures.delete(id)
        dropped = true
      }
    for (const [id, c] of this.loading)
      if (!this.pictures.has(id)) {
        c.abort()
        this.loading.delete(id)
      }
    for (const id of this.next.keys()) if (!this.pictures.has(id)) this.next.delete(id)
    if (dropped) this.changed()
    this.scheduleLoad(0)
  }

  /** The frames to draw, in paint order (back to front). */
  setScene(frames: readonly Pick<PictureFrame, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'label'>[]) {
    const n = frames.length
    this.items = frames.map((f, i) => {
      const r = f.rotation ? (f.rotation * Math.PI) / 180 : 0
      const b = frameBounds(f)
      /* each frame its own depth, the later the nearer */
      const depth = 1 - (2 * (i + 1)) / (n + 1)
      return {
        id: f.id,
        q: new Float32Array([f.x, f.y, f.width, f.height, Math.cos(r), Math.sin(r), depth, 0]),
        x0: b.x0,
        y0: b.y0,
        x1: b.x1,
        y1: b.y1,
        width: f.width,
        cell: f.label ? (this.atlas?.cells.get(f.label) ?? null) : null,
        upright: !r,
      }
    })
    /* a name is at most two quads: its text, and an ellipsis */
    if (this.labelCapacity < n * 2) {
      this.labelCapacity = Math.max(n * 2, 64)
      this.labels = new Float32Array(this.labelCapacity * LABEL_FLOATS)
      if (!this.lost) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.labelBuffer)
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.labels.byteLength, this.gl.DYNAMIC_DRAW)
      }
    }
    this.labelsDirty = true
    this.setHover(this.hoverId)
    this.invalidate()
  }

  /** The names' texture, and the colour of the hover ring (CSS rgba, 0-255 and 0-1). */
  setLabels(atlas: NameAtlas | null, ring: readonly [number, number, number, number]) {
    this.atlas = atlas
    const a = ring[3]
    this.ring.set([(ring[0] / 255) * a, (ring[1] / 255) * a, (ring[2] / 255) * a, a])
    this.labelsDirty = true
    this.invalidate()
  }

  /** The frame under the pointer wears the hover ring (null: none). */
  setHover(id: string | null) {
    this.hoverId = id
    const i = id === null ? -1 : this.items.findIndex((it) => it.id === id)
    if (i === this.hover) return
    this.hover = i
    const item = this.items[i]
    if (item) this.hoverQ.set(item.q)
    this.invalidate()
  }

  /** The camera moved: drawn at once, in the task that moved the world's
   *  transform, so the canvas and the DOM never part for a frame (a camera
   *  moved from an animation frame callback would otherwise wait for the
   *  next one). */
  setCamera(camera: Camera) {
    this.camera = camera
    this.drawNow()
    this.scheduleLoad(LOAD_EVERY_MS)
  }

  setStage(stage: Size, dpr: number) {
    this.stage = stage
    this.dpr = dpr
    this.invalidate()
    this.scheduleLoad(0)
  }

  /** Draw now: for a change the DOM shows in this same frame (a frame that
   *  leaves the DOM must not leave a hole until the next one). */
  drawNow() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.draw()
  }

  /** Draw at the next animation frame (once, however often it is asked). */
  invalidate() {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.draw()
    })
  }

  private changed() {
    if (this.texturesChanged) return
    this.texturesChanged = true
    /* told after the draw that changed them, never from inside it */
    queueMicrotask(() => {
      this.texturesChanged = false
      if (!this.disposed) this.events.textures()
    })
  }

  private draw() {
    if (this.lost || this.disposed) return
    const gl = this.gl
    const { canvas, dpr, stage, camera } = this
    const w = Math.max(1, Math.round(stage.width * dpr))
    const h = Math.max(1, Math.round(stage.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    if (this.uploads.length) this.upload()
    this.frameNo++
    const atlas = this.atlas
    if (atlas && atlas.version !== this.atlasUploaded) {
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas)
      this.atlasUploaded = atlas.version
    }
    if (this.labelsDirty || camera.zoom !== this.labelsZoom) this.buildLabels()

    gl.viewport(0, 0, w, h)
    gl.depthMask(true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)

    gl.useProgram(this.pictureProgram)
    gl.bindVertexArray(this.pictureVao)
    gl.activeTexture(gl.TEXTURE0)
    const pu = this.pu
    gl.uniform1i(pu.u_tex!, 0)
    gl.uniform2f(pu.u_view!, w, h)
    gl.uniform3f(pu.u_cam!, camera.x, camera.y, camera.zoom)
    gl.uniform1f(pu.u_dpr!, dpr)
    gl.uniform1f(pu.u_mode!, 0)
    const vx0 = -camera.x / camera.zoom
    const vy0 = -camera.y / camera.zoom
    const vx1 = vx0 + stage.width / camera.zoom
    const vy1 = vy0 + stage.height / camera.zoom
    const items = this.items
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!
      if (it.x0 >= vx1 || it.x1 <= vx0 || it.y0 >= vy1 || it.y1 <= vy0) continue
      const t = this.textures.get(it.id)
      if (!t) continue
      t.seen = this.frameNo
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.uniform4fv(pu.u_q!, it.q)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    if (this.hover >= 0) {
      gl.uniform1f(pu.u_mode!, 1)
      gl.uniform4fv(pu.u_ring!, this.ring)
      gl.uniform4fv(pu.u_q!, this.hoverQ)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    if (this.labelCount && atlas?.style) {
      gl.depthMask(false)
      gl.useProgram(this.labelProgram)
      gl.bindVertexArray(this.labelVao)
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
      const lu = this.lu
      gl.uniform1i(lu.u_atlas!, 0)
      gl.uniform2f(lu.u_view!, w, h)
      gl.uniform3f(lu.u_cam!, camera.x, camera.y, camera.zoom)
      gl.uniform1f(lu.u_dpr!, dpr)
      gl.uniform1f(lu.u_top!, LABEL_GAP + atlas.style.lineHeight)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.labelCount)
    }
    gl.bindVertexArray(null)
    gl.disable(gl.DEPTH_TEST)
    if (this.uploads.length) this.invalidate()
  }

  /** The name quads for this zoom: where a name is cut depends on its
   *  frame's width on screen, so they are worked out again when the zoom
   *  changes (a pan reuses them). No allocation: this runs on zoom frames. */
  private buildLabels() {
    this.labelsZoom = this.camera.zoom
    this.labelsDirty = false
    this.labelCount = 0
    const atlas = this.atlas
    const style = atlas?.style
    if (!atlas || !style) return
    const zoom = this.camera.zoom
    const aw = atlas.canvas.width
    const ah = atlas.canvas.height
    const k = atlas.dpr
    const ellipsis = atlas.ellipsis
    const data = this.labels
    const items = this.items
    const v0 = PAD / ah
    let n = 0
    const put = (it: Item, cell: NameCell, x: number, width: number) => {
      const o = n++ * LABEL_FLOATS
      const q = it.q
      data[o] = q[0]!
      data[o + 1] = q[1]!
      data[o + 2] = q[2]!
      data[o + 3] = q[3]!
      data[o + 4] = q[4]!
      data[o + 5] = q[5]!
      data[o + 6] = q[6]!
      data[o + 7] = it.upright ? 1 : 0
      data[o + 8] = x
      data[o + 9] = 0
      data[o + 10] = width
      data[o + 11] = style.lineHeight
      data[o + 12] = (cell.x + PAD) / aw
      data[o + 13] = cell.y / ah + v0
      data[o + 14] = (cell.x + PAD + width * k) / aw
      data[o + 15] = (cell.y + PAD + style.lineHeight * k) / ah
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!
      const cell = it.cell
      const room = it.width * zoom
      if (!cell || !(room > 0)) continue
      const cut = ellipsisCut(cell.prefix, cell.count, ellipsis?.advance ?? 0, room)
      const end = cut < 0 ? Math.min(cell.advance, room) : (cell.prefix[cut] ?? 0)
      if (end > 0) put(it, cell, 0, end)
      if (cut >= 0 && ellipsis) {
        const shown = Math.min(ellipsis.advance, room - end)
        if (shown > 0) put(it, ellipsis, end, shown)
      }
    }
    this.labelCount = n
    if (n) {
      const gl = this.gl
      gl.bindBuffer(gl.ARRAY_BUFFER, this.labelBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * LABEL_FLOATS)
    }
  }

  /** Uploads what has been decoded, within the frame's budget (one at least). */
  private upload() {
    const gl = this.gl
    const started = performance.now()
    let uploaded = 0
    while (this.uploads.length && (uploaded++ === 0 || performance.now() - started < UPLOAD_BUDGET_MS)) {
      const { id, src, bitmap } = this.uploads.shift()!
      if (this.pictures.get(id)?.src !== src) {
        bitmap.close()
        continue
      }
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const old = this.textures.get(id)
      if (old) gl.deleteTexture(old.tex)
      else this.changed()
      this.textures.set(id, {
        src,
        tex,
        bytes: Math.round(bitmap.width * bitmap.height * 4 * 1.34),
        seen: this.frameNo,
      })
      bitmap.close()
    }
    this.evict()
  }

  private evict() {
    let total = 0
    for (const t of this.textures.values()) total += t.bytes
    if (total <= TEXTURE_BUDGET) return
    const old = [...this.textures.entries()]
      .filter(([, t]) => t.seen < this.frameNo)
      .sort((a, b) => a[1].seen - b[1].seen)
    for (const [id, t] of old) {
      if (total <= TEXTURE_BUDGET) break
      this.gl.deleteTexture(t.tex)
      this.textures.delete(id)
      total -= t.bytes
      this.changed()
    }
  }

  private scheduleLoad(ms: number) {
    if (this.disposed) return
    if (this.loadTimer) {
      if (ms) return
      window.clearTimeout(this.loadTimer)
    }
    this.loadTimer = window.setTimeout(() => {
      this.loadTimer = 0
      this.load()
    }, ms)
  }

  /** Starts the requests the view needs next: pictures missing or out of
   *  date near the view (sharp ones within LOAD_MARGIN, the smallest level
   *  within SMALL_LOAD_MARGIN), nearest its centre first. */
  private load() {
    if (this.lost || this.disposed) return
    const { camera, stage } = this
    if (camera.zoom <= 0 || stage.width <= 0) return
    const vw = stage.width / camera.zoom
    const vh = stage.height / camera.zoom
    const cx = -camera.x / camera.zoom + vw / 2
    const cy = -camera.y / camera.zoom + vh / 2
    const small = `s=${PREVIEW_SCALES[0]}&`
    const now = performance.now()
    const wanted: { p: Picture; d: number }[] = []
    let waiting = Infinity
    for (const p of this.pictures.values()) {
      const margin = p.src?.includes(small) ? SMALL_LOAD_MARGIN : LOAD_MARGIN
      const near =
        Math.abs(p.x + p.width / 2 - cx) < vw * (0.5 + margin) + p.width / 2 &&
        Math.abs(p.y + p.height / 2 - cy) < vh * (0.5 + margin) + p.height / 2
      if (!near) continue
      const have = this.textures.get(p.id)
      /* near the view: kept over the budget too (evict), or a picture
         fetched for a frame shown live would be dropped and fetched again */
      if (have) have.seen = this.frameNo
      if (!p.src || this.loading.has(p.id) || have?.src === p.src) continue
      if (this.uploads.some((u) => u.id === p.id && u.src === p.src)) continue
      const pending = this.next.get(p.id)
      if (pending?.src === p.src) {
        if (pending.attempt > PREVIEW_RETRIES) continue
        if (pending.notBefore > now) {
          waiting = Math.min(waiting, pending.notBefore - now)
          continue
        }
      }
      /* the frames waiting for a picture before the ones only kept ready */
      const d = (p.later ? 1e12 : 0) + (have ? 1e11 : 0) + Math.hypot(p.x + p.width / 2 - cx, p.y + p.height / 2 - cy)
      wanted.push({ p, d })
    }
    wanted.sort((a, b) => a.d - b.d)
    for (const { p } of wanted) {
      if (this.loading.size >= MAX_LOADS) break
      this.fetch(p.id, p.src!)
    }
    window.clearTimeout(this.retry)
    if (waiting !== Infinity) this.retry = window.setTimeout(() => this.scheduleLoad(0), waiting + 10)
  }

  private fetch(id: string, src: string) {
    const control = new AbortController()
    this.loading.set(id, control)
    const prev = this.next.get(id)
    const attempt = prev?.src === src ? prev.attempt : 0
    const url = attempt ? `${src}&retry=${attempt}` : src
    void (async () => {
      try {
        const res = await fetch(url, { signal: control.signal, credentials: 'same-origin' })
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        let bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' })
        const side = Math.max(bitmap.width, bitmap.height)
        if (side > this.maxSide) {
          const k = this.maxSide / side
          const big = bitmap
          bitmap = await createImageBitmap(big, {
            resizeWidth: Math.max(1, Math.floor(big.width * k)),
            resizeHeight: Math.max(1, Math.floor(big.height * k)),
            resizeQuality: 'high',
          })
          big.close()
        }
        if (control.signal.aborted || this.disposed) return bitmap.close()
        this.next.delete(id)
        this.uploads.push({ id, src, bitmap })
        this.invalidate()
      } catch {
        if (control.signal.aborted) return
        /* as the <img> did: again a few times, less often each time */
        this.next.set(id, { src, attempt: attempt + 1, notBefore: performance.now() + 2000 * 2 ** attempt })
      } finally {
        if (this.loading.get(id) === control) this.loading.delete(id)
        this.scheduleLoad(0)
      }
    })()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.clearTimeout(this.retry)
    window.clearTimeout(this.loadTimer)
    for (const c of this.loading.values()) c.abort()
    for (const u of this.uploads) u.bitmap.close()
    if (!this.lost) for (const t of this.textures.values()) this.gl.deleteTexture(t.tex)
    this.textures.clear()
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
