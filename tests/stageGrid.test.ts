import { describe, expect, it } from 'vitest'
import { DOT_PERIOD, GRID_ZOOM_DRIFT, gridCovers, gridPaintZoom, gridStale, gridTransform } from '../src/lib/stageGrid'

/* The stage's grids are scaled while the zoom moves and painted afresh when
   they leave their band or the camera rests (stageGrid.ts). */
describe('gridStale', () => {
  it('keeps a grid magnified within the band', () => {
    expect(gridStale(1, 1)).toBe(false)
    expect(gridStale(1, 1.05)).toBe(false)
    expect(gridStale(0.5, 0.5 * GRID_ZOOM_DRIFT * 0.999)).toBe(false)
  })

  it('paints again past the band, or as soon as the grid would shrink', () => {
    expect(gridStale(0.5, 0.5 * GRID_ZOOM_DRIFT * 1.001)).toBe(true)
    expect(gridStale(1, 0.999)).toBe(true)
    expect(gridStale(1, 0.5)).toBe(true)
  })

  it('paints a grid never painted', () => {
    expect(gridStale(null, 1)).toBe(true)
  })

  it('takes the drift it is given', () => {
    expect(gridStale(1, 1.15, 1.2)).toBe(false)
    expect(gridStale(1, 1.15, 1.1)).toBe(true)
  })
})

describe('gridPaintZoom', () => {
  it('paints at the camera zoom when zooming in, or first', () => {
    expect(gridPaintZoom(null, 0.7)).toBe(0.7)
    expect(gridPaintZoom(0.5, 0.7)).toBe(0.7)
  })

  it('paints one band below the camera when zooming out', () => {
    const painted = gridPaintZoom(0.7, 0.6)
    expect(painted).toBeCloseTo(0.6 / GRID_ZOOM_DRIFT, 12)
    /* so the camera can travel the whole band down before the next paint */
    expect(gridStale(painted, 0.6)).toBe(false)
    expect(gridStale(painted, painted * 1.0001)).toBe(false)
    expect(gridStale(painted, painted * 0.9999)).toBe(true)
  })
})

describe('gridTransform', () => {
  const dotsAt = (transform: string, painted: number, count = 4) => {
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)(?: scale\(([\d.e-]+)\))?/.exec(transform)
    if (!m) throw new Error(transform)
    const [x, s] = [Number(m[1]), Number(m[3] ?? 1)]
    /* screen x of the layer's first dot columns: translate + scale × layer px */
    return Array.from({ length: count }, (_, i) => x + s * i * DOT_PERIOD * painted)
  }

  it('is the translate alone when the grid was painted at the camera zoom', () => {
    expect(gridTransform({ x: 30, y: -5, zoom: 1 }, DOT_PERIOD, 1)).toBe('translate(-22px, -5px)')
  })

  it('keeps a scaled grid on the camera lattice', () => {
    const camera = { x: 1234.5, y: -987.25, zoom: 0.83 }
    const exact = dotsAt(gridTransform(camera, DOT_PERIOD, camera.zoom), camera.zoom)
    const scaled = dotsAt(gridTransform(camera, DOT_PERIOD, 0.8), 0.8)
    scaled.forEach((x, i) => expect(x).toBeCloseTo(exact[i]!, 9))
    /* and the lattice is the camera's: a world point on the dots lands on one */
    const period = DOT_PERIOD * camera.zoom
    const k = (scaled[0]! - camera.x) / period
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9)
  })

  it('slides the layer back by up to one period, never forward', () => {
    for (const x of [-1000, -26, -0.5, 0, 13, 25.99, 26, 777]) {
      const m = /translate\((-?[\d.e-]+)px/.exec(gridTransform({ x, y: 0, zoom: 1 }, DOT_PERIOD, 1))
      const tx = Number(m?.[1])
      expect(tx).toBeLessThanOrEqual(0)
      expect(tx).toBeGreaterThanOrEqual(-DOT_PERIOD)
    }
  })
})

describe('gridCovers', () => {
  it('a layer one painted period larger than the stage covers it anywhere in the band', () => {
    const extent = 1600
    for (const painted of [0.08, 0.5, 1, 4]) {
      const period = DOT_PERIOD * painted
      for (const scale of [1, 1.03, GRID_ZOOM_DRIFT]) {
        for (const slide of [0, 0.5, 0.999]) {
          expect(gridCovers(extent, period, scale, -slide * period * scale)).toBe(true)
        }
      }
    }
  })

  it('would not cover the stage shrunk, which is why the band is one-sided', () => {
    const period = DOT_PERIOD
    expect(gridCovers(1600, period, 0.95, 0)).toBe(false)
  })
})
