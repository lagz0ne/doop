import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Frame } from '../../shared/types'
import { useStore } from '../lib/store'
import { isCanvasElement } from '../lib/drawing'
import { isSyncedFrame } from '../lib/sync'
import { isGithubFrame } from '../lib/github'
import { cullingEnabled, useLiveFrames } from '../lib/liveFrames'
import { NameAtlas, nameFont, type NameStyle } from '../lib/gpuLabels'
import {
  PictureRenderer,
  frameAt,
  gpuDrawnFrames,
  gpuMode,
  nameStrip,
  pictureSrc,
  setGpuHitTest,
  useGpuPictures,
  type Picture,
  type PictureFrame,
} from '../lib/gpuPictures'
import { renderTrialGpuFailed } from '../lib/renderTrialClient'

const NONE: ReadonlySet<string> = new Set()

type Candidate = PictureFrame & { updatedAt: number }

/** The name as the title shows it: white space collapsed, none at the ends. */
const shownName = (name: string) => name.replace(/[\t\n\f\r ]+/g, ' ').trim()

function framesOf(frames: readonly Frame[]): Candidate[] {
  return frames.map((f) => {
    const element = isCanvasElement(f.html)
    return {
      id: f.id,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      rotation: f.rotation,
      updatedAt: f.updatedAt,
      hidden: f.hidden,
      /* the title of these holds more than the name (a lock, a mark, the
         review badge), or the shell shows something no picture does */
      candidate:
        !!f.html &&
        !element &&
        !f.hidden &&
        !f.locked &&
        !f.approval &&
        !isSyncedFrame(f.html) &&
        !isGithubFrame(f.html),
      label: element ? '' : shownName(f.name),
    }
  })
}

/** A CSS colour as rgba (0-255, alpha 0-1), through a canvas, which parses
 *  every colour syntax the page may use (color-mix, oklch). */
function rgba(color: string): [number, number, number, number] {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return [0, 0, 0, 0]
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b, a / 255]
}

/**
 * The Stage's GPU canvas (gpuPictures.ts), under the frame stack: draws the
 * culled frames it can stand in for, pictures, names and the hover ring, and
 * takes them out of the DOM through `useGpuPictures`; a press on one is
 * resolved here (`setGpuHitTest`) for the Stage to wake it. Renders nothing
 * unless `doop:gpu` or the render trial asks for it and culling is on (with
 * culling off every frame is live, and there is nothing to draw).
 */
export function StagePictures({
  frames,
  stage,
}: {
  frames: readonly Frame[]
  stage: RefObject<HTMLDivElement | null>
}) {
  const [mode] = useState(gpuMode)
  const [on] = useState(() => mode !== 'off' && cullingEnabled())
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const markRef = useRef<HTMLSpanElement>(null)
  const ringRef = useRef<HTMLSpanElement>(null)
  const control = useRef<{ setFrames(frames: readonly Frame[]): void } | null>(null)
  const framesRef = useRef(frames)

  useEffect(() => {
    const canvas = canvasRef.current
    const el = stage.current
    const probe = probeRef.current
    const text = textRef.current
    const mark = markRef.current
    const ringProbe = ringRef.current
    if (!on || !canvas || !el || !probe || !text || !mark || !ringProbe) return
    let all = framesOf(framesRef.current)
    let lost = false
    let drawnList: Candidate[] = []
    const renderer = PictureRenderer.create(canvas, mode, {
      lost(isLost) {
        lost = isLost
        /* a load the render trial put the layer on stops counting for it */
        if (isLost) renderTrialGpuFailed()
        update()
      },
      textures: () => update(),
    })
    if (!renderer) {
      renderTrialGpuFailed()
      return
    }
    const atlas = new NameAtlas()
    let style: NameStyle | null = null
    let styleKey = ''
    let atlasKey = ''
    /* the names the atlas was last built from */
    let tried = new Set<string>()
    let fontAsked = ''
    let lastZoom = NaN

    /* The title's look, read off a hidden element styled as it is: the
       theme's colour, the web font, the line the title sits on. */
    function restyle() {
      if (!probe || !text || !mark || !ringProbe) return
      const cs = getComputedStyle(text)
      const box = probe.getBoundingClientRect()
      const next: NameStyle = {
        fontStyle: cs.fontStyle,
        fontWeight: cs.fontWeight,
        fontSize: parseFloat(cs.fontSize) || 12,
        fontFamily: cs.fontFamily,
        /* computed as 'normal' or a length in px */
        letterSpacing: parseFloat(cs.letterSpacing) || 0,
        color: cs.color,
        lineHeight: box.height,
        baseline: mark.getBoundingClientRect().top - box.top,
      }
      const font = nameFont(next)
      const dpr = window.devicePixelRatio || 1
      const key = `${font}|${next.letterSpacing}|${next.color}|${next.lineHeight}|${next.baseline}|${dpr}`
      /* drawn in a fallback font, the names would stay so: wait for the
         page's own (once; a font that never comes is not waited for) */
      if (fontAsked !== font && !document.fonts.check(font)) {
        fontAsked = font
        document.fonts.load(font).then(restyle, restyle)
      }
      const ring = getComputedStyle(ringProbe).color
      renderer!.setLabels(atlas.style ? atlas : null, rgba(ring))
      if (key === styleKey) return
      styleKey = key
      style = next
      atlasKey = ''
      update()
    }

    /* Draws the names into the atlas when one is missing from it, or the
       look changed. A name that did not fit keeps its frame in the DOM. */
    function ensureAtlas() {
      if (!style) return
      let missing = atlasKey !== styleKey
      if (!missing) for (const f of all) if (f.candidate && f.label && !tried.has(f.label)) missing = true
      if (!missing) return
      const names = new Set<string>()
      for (const f of all) if (f.candidate && f.label) names.add(f.label)
      atlas.build(names, style, window.devicePixelRatio || 1, renderer!.maxTextureSide)
      tried = names
      atlasKey = styleKey
      renderer!.setLabels(atlas, rgba(getComputedStyle(ringProbe!).color))
    }

    function update() {
      if (!renderer) return
      const live = useLiveFrames.getState()
      const s = useStore.getState()
      const ids = live.ids
      densityMoved()
      if (lost || !renderer.fitsStage || ids === null || !style) {
        drawnList = []
        renderer.setScene([])
        useGpuPictures.getState().setDrawn(NONE)
        return
      }
      const selected = new Set(s.selectedIds)
      /* what FrameSlot draws as a FrameView (or HiddenFrameView, selected) */
      const inDom = (id: string) => selected.has(id) || ids.has(id) || live.woken.includes(id) || !!s.streams[id]
      ensureAtlas()
      const pictures: Picture[] = []
      for (const f of all)
        if (f.candidate)
          pictures.push({
            id: f.id,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            src: pictureSrc(f, live.previewDensity, live.sharp),
            later: inDom(f.id),
          })
      renderer.setPictures(pictures)
      lastZoom = s.viewport.zoom
      const strip = nameStrip(style.lineHeight, lastZoom)
      const drawn = gpuDrawnFrames(
        all,
        inDom,
        (f) => renderer.hasPicture(f.id) && (!f.label || atlas.cells.has(f.label)),
        strip,
      )
      drawnList = all.filter((f) => drawn.has(f.id))
      /* the canvas first, in this same task, then the DOM: a frame that
         leaves it finds itself already drawn in its place */
      renderer.setScene(drawnList)
      renderer.drawNow()
      useGpuPictures.getState().setDrawn(drawn)
    }

    /* where the stage's content starts on screen: read on a press, and kept
       for the hover, which must not force a layout on every move */
    let origin = { left: 0, top: 0 }
    function readOrigin() {
      if (!el) return origin
      const r = el.getBoundingClientRect()
      origin = { left: r.left + el.clientLeft, top: r.top + el.clientTop }
      return origin
    }

    /* the drawn frame under a pointer event, or null off the empty stage */
    function pageAt(e: { clientX: number; clientY: number; target: EventTarget | null }, at = origin) {
      if (!el || !style || !drawnList.length) return null
      const t = e.target
      if (t !== el && !(t instanceof Element && t.classList.contains('world'))) return null
      const vp = useStore.getState().viewport
      const x = (e.clientX - at.left - vp.x) / vp.zoom
      const y = (e.clientY - at.top - vp.y) / vp.zoom
      return frameAt(drawnList, x, y, vp.zoom, style.lineHeight)
    }

    setGpuHitTest((e) => pageAt(e, readOrigin())?.id ?? null)

    /* the shell's hover ring, for a mouse resting over a drawn frame's box */
    let pointer: PointerEvent | null = null
    function hover(e: PointerEvent | null) {
      pointer = e
      const hit = e && e.pointerType !== 'touch' && e.buttons === 0 ? pageAt(e) : null
      renderer!.setHover(hit && !hit.name ? hit.id : null)
    }
    const onMove = (e: PointerEvent) => hover(e)
    const onLeave = () => hover(null)
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onLeave, true)

    let density = window.devicePixelRatio || 1
    function measure() {
      if (!renderer || !el) return
      const fitted = renderer.fitsStage
      density = window.devicePixelRatio || 1
      renderer.setStage({ width: el.clientWidth, height: el.clientHeight }, density)
      readOrigin()
      /* a backing store the GPU would not give hands every frame to the DOM */
      if (renderer.fitsStage !== fitted) update()
    }

    /* A window moved to a screen of another density: the media query below
       says so, but not always in time (Chromium's emulation fired it a step
       late), so the density is also compared on every camera move and
       update, a read that costs no layout. */
    let densityQuery: MediaQueryList | null = null
    function watchDensity() {
      densityQuery?.removeEventListener('change', onDensity)
      densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      densityQuery.addEventListener('change', onDensity)
    }
    function onDensity() {
      watchDensity()
      measure()
      restyle()
    }
    function densityMoved() {
      if ((window.devicePixelRatio || 1) !== density) onDensity()
    }

    /* Names are cut at the frame's width and kept a set size on screen, so
       what the canvas may draw beside DOM frames changes with the zoom: it
       is worked out again once the camera rests, not per frame. */
    let rest = 0
    function camera(vp: { x: number; y: number; zoom: number }) {
      densityMoved()
      renderer!.setCamera(vp)
      window.clearTimeout(rest)
      rest = window.setTimeout(() => {
        if (useStore.getState().viewport.zoom !== lastZoom) update()
        if (pointer) hover(pointer)
      }, 150)
    }

    renderer.setCamera(useStore.getState().viewport)
    measure()
    restyle()
    update()
    control.current = {
      setFrames(next) {
        all = framesOf(next)
        update()
      },
    }
    const unLive = useLiveFrames.subscribe(update)
    const unStore = useStore.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport) camera(s.viewport)
      if (s.selectedIds !== prev.selectedIds || s.streams !== prev.streams) update()
    })
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    /* the theme flips classes and custom properties on the root */
    const theme = new MutationObserver(restyle)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    document.fonts.addEventListener('loadingdone', restyle)
    watchDensity()
    return () => {
      control.current = null
      setGpuHitTest(null)
      window.clearTimeout(rest)
      unLive()
      unStore()
      resize.disconnect()
      theme.disconnect()
      document.fonts.removeEventListener('loadingdone', restyle)
      densityQuery?.removeEventListener('change', onDensity)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onLeave, true)
      renderer.dispose()
      useGpuPictures.getState().setDrawn(NONE)
    }
  }, [on, mode, stage])

  useEffect(() => {
    framesRef.current = frames
    control.current?.setFrames(frames)
  }, [frames])

  if (!on) return null
  return (
    <>
      <canvas ref={canvasRef} data-stage-pictures="" className="pointer-events-none absolute inset-0 h-full w-full" />
      {/* styled as a frame's title (FrameShell), for the names drawn above */}
      <div
        ref={probeRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-soft)',
        }}
      >
        <span ref={textRef}>
          Hg
          <span ref={markRef} style={{ display: 'inline-block', width: 0, height: 0 }} />
        </span>
        <span ref={ringRef} style={{ color: 'color-mix(in srgb, var(--brand) 55%, transparent)' }} />
      </div>
    </>
  )
}
