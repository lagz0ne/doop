/* Frame names for the GPU picture layer (gpuPictures.ts), as one texture.

   A frame drawn on the Stage's canvas has no element at all, so its name is
   drawn there too: each distinct name is rendered once, with the font and
   colour the FrameShell's title has (read off a probe element in the stage,
   so the theme and the web font are the page's own), into one 2D canvas at
   the screen's density, and that canvas is the atlas the GL pass samples.

   The name keeps its size on screen at every zoom, so only where it is cut
   changes with the zoom: the DOM title is the frame's width on screen and
   ends in an ellipsis when the name is longer. For that each cell carries
   the width of every prefix of its name, measured once, and a draw picks
   the longest prefix that leaves room for the ellipsis (`ellipsisCut`), the
   rule text-overflow follows. Nothing is measured or rendered while the
   camera moves. */

/** The title's look, read off the probe (StagePictures). */
export interface NameStyle {
  /** the canvas `font` shorthand: style, weight, size, family */
  font: string
  letterSpacing: string
  /** the computed CSS colour of the name */
  color: string
  /** the title row's height, CSS px */
  lineHeight: number
  /** the baseline below the row's top, CSS px */
  baseline: number
}

/** One name in the atlas. */
export interface NameCell {
  /** the cell in the atlas, device px; the text starts PAD px in */
  x: number
  y: number
  width: number
  height: number
  /** the name's advance, CSS px */
  advance: number
  /** prefix[k]: the advance of the first k graphemes, CSS px (k = 0…count) */
  prefix: Float32Array
  count: number
}

/** Device px around each cell's text, for ink outside the advance. */
export const PAD = 2

/** The atlas side, device px, unless the GPU allows less. */
const ATLAS_SIDE = 4096

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null

function graphemeEnds(text: string): number[] {
  if (!segmenter) return Array.from(text, (_, i) => i + 1)
  const ends: number[] = []
  for (const s of segmenter.segment(text)) ends.push(s.index + s.segment.length)
  return ends
}

/**
 * How many graphemes of a name to keep before the ellipsis for it to fit in
 * `width` (CSS px), or -1 when the whole name fits and no ellipsis is drawn.
 * As text-overflow does: the longest prefix that leaves room for the
 * ellipsis, down to none (the ellipsis alone, clipped if even it is wider).
 */
export function ellipsisCut(prefix: ArrayLike<number>, count: number, ellipsis: number, width: number): number {
  if ((prefix[count] ?? 0) <= width) return -1
  const room = width - ellipsis
  /* the prefixes grow with k: the last one that fits */
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((prefix[mid] ?? Infinity) <= room) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * The names of the frames drawn on the GPU canvas, rendered into one canvas.
 * `build` lays out the names it is given (a name shared by several frames is
 * one cell) and draws them; it measures a name only the first time it sees
 * it in a font, so a rebuild for a new theme or a renamed frame only redraws.
 */
export class NameAtlas {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** the cells by name; a name missing here did not fit (its frame stays in the DOM) */
  cells = new Map<string, NameCell>()
  ellipsis: NameCell | null = null
  style: NameStyle | null = null
  dpr = 1
  /** bumped on every build, so the renderer knows to upload */
  version = 0
  private measured = new Map<string, { advance: number; prefix: Float32Array; count: number }>()
  private measuredFont = ''

  constructor() {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
  }

  private applyFont(style: NameStyle) {
    const ctx = this.ctx
    ctx.font = style.font
    ctx.letterSpacing = style.letterSpacing
    ctx.fontKerning = 'normal'
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
  }

  private measure(name: string) {
    const known = this.measured.get(name)
    if (known) return known
    const ends = graphemeEnds(name)
    const prefix = new Float32Array(ends.length + 1)
    for (let k = 0; k < ends.length; k++) prefix[k + 1] = this.ctx.measureText(name.slice(0, ends[k])).width
    const m = { advance: prefix[ends.length] ?? 0, prefix, count: ends.length }
    this.measured.set(name, m)
    return m
  }

  /** Lays out and draws `names` (no empty ones) in `style` at `dpr`. */
  build(names: Iterable<string>, style: NameStyle, dpr: number, maxSide: number) {
    const ctx = this.ctx
    const font = `${style.font}|${style.letterSpacing}`
    if (font !== this.measuredFont) {
      this.measured.clear()
      this.measuredFont = font
    }
    this.applyFont(style)
    const side = Math.min(ATLAS_SIDE, maxSide)
    const cellH = Math.ceil(style.lineHeight * dpr) + 2 * PAD
    const cells = new Map<string, NameCell>()
    let x = 0
    let y = 0
    const place = (name: string): NameCell | null => {
      const m = this.measure(name)
      const width = Math.ceil(m.advance * dpr) + 2 * PAD
      if (width > side) return null
      if (x + width > side) {
        x = 0
        y += cellH
      }
      if (y + cellH > side) return null
      const cell = { x, y, width, height: cellH, ...m }
      x += width
      return cell
    }
    const ellipsis = place('…')
    for (const name of names) {
      if (cells.has(name)) continue
      const cell = place(name)
      if (cell) cells.set(name, cell)
    }
    const height = Math.max(1, y + cellH)
    /* a resize clears the canvas and resets its state */
    this.canvas.width = side
    this.canvas.height = height
    this.applyFont(style)
    ctx.fillStyle = style.color
    /* the baseline on a whole device pixel, as the DOM lays text out */
    const base = Math.round(style.baseline * dpr)
    const drawCell = (name: string, c: NameCell) => {
      ctx.setTransform(dpr, 0, 0, dpr, c.x + PAD, c.y + PAD + base)
      ctx.fillText(name, 0, 0)
    }
    if (ellipsis) drawCell('…', ellipsis)
    for (const [name, c] of cells) drawCell(name, c)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.cells = cells
    this.ellipsis = ellipsis
    this.style = style
    this.dpr = dpr
    this.version++
  }
}
