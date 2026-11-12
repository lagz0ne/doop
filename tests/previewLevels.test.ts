import { describe, expect, it } from 'vitest'
import { isPreviewScale, PREVIEW_SCALES, previewLevelFor, previewRenderScale } from '../shared/types'

/* The editor's preview pyramid: which picture of a frame the canvas asks for
   at a given density (camera zoom × devicePixelRatio), and what scale the
   server renders it at. */

const screen = { width: 1440, height: 900 }

describe('previewLevelFor', () => {
  it('picks the smallest level that covers the frame on screen, so a picture is never stretched', () => {
    expect(previewLevelFor(screen, 0.08)).toBe(0.25) // fit zoom, 1× display
    expect(previewLevelFor(screen, 0.18)).toBe(0.25) // 9% on a 2× display
    expect(previewLevelFor(screen, 0.25)).toBe(0.25)
    expect(previewLevelFor(screen, 0.26)).toBe(0.5)
    expect(previewLevelFor(screen, 0.5)).toBe(0.5)
    expect(previewLevelFor(screen, 0.58)).toBe(1) // 29% on a 2× display
    expect(previewLevelFor(screen, 1)).toBe(1)
  })

  it('stops at the largest level however dense the screen', () => {
    expect(previewLevelFor(screen, 6)).toBe(1)
  })

  it('never asks above the level where a huge frame is already at its size limit', () => {
    const strip = { width: 40_000, height: 400 } // limited to 0.4
    expect(previewLevelFor(strip, 2)).toBe(0.5)
    expect(previewLevelFor(strip, 0.2)).toBe(0.25)
  })
})

describe('previewRenderScale', () => {
  it('is the level itself for ordinary frames, wide banners included', () => {
    for (const level of PREVIEW_SCALES) expect(previewRenderScale(screen, level)).toBe(level)
    expect(previewRenderScale({ width: 12_640, height: 400 }, 1)).toBe(1)
  })

  it('shrinks a picture that would pass 8 megapixels or 16000 px on a side', () => {
    const tall = { width: 1440, height: 9000 }
    const scale = previewRenderScale(tall, 1)
    expect(scale).toBeLessThan(1)
    expect(tall.width * tall.height * scale * scale).toBeCloseTo(8_000_000, -2)
    expect(previewRenderScale({ width: 40_000, height: 400 }, 1)).toBeCloseTo(0.4)
    expect(previewRenderScale(tall, 0.25)).toBe(0.25)
  })
})

describe('isPreviewScale', () => {
  it('accepts the levels and nothing else (the route takes ?s= from the URL)', () => {
    expect(PREVIEW_SCALES.every(isPreviewScale)).toBe(true)
    for (const other of [0, 0.3, 2, Number.NaN, '0.5', undefined]) expect(isPreviewScale(other)).toBe(false)
  })
})
