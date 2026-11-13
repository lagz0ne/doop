import { describe, expect, it } from 'vitest'
import { CHROME_ZOOM_DRIFT, chromeZoomStale } from '../src/lib/layoutZoom'

/* The --zoom the world's chrome is sized by follows a moving camera in
   steps (layoutZoom.ts): a write restyles the whole canvas. */
describe('chromeZoomStale', () => {
  it('leaves a zoom within the drift standing, in either direction', () => {
    expect(chromeZoomStale(1, 1)).toBe(false)
    expect(chromeZoomStale(1, 1.05)).toBe(false)
    expect(chromeZoomStale(1, 0.95)).toBe(false)
    expect(chromeZoomStale(0.5, 0.5 * CHROME_ZOOM_DRIFT * 0.999)).toBe(false)
    expect(chromeZoomStale(0.5, (0.5 / CHROME_ZOOM_DRIFT) * 1.001)).toBe(false)
  })

  it('asks for a write once the camera has drifted past it', () => {
    expect(chromeZoomStale(1, 1.2)).toBe(true)
    expect(chromeZoomStale(1, 0.8)).toBe(true)
    expect(chromeZoomStale(0.08, 0.6)).toBe(true)
    expect(chromeZoomStale(8, 8 * CHROME_ZOOM_DRIFT * 1.001)).toBe(true)
  })

  it('always writes when nothing usable was written yet', () => {
    expect(chromeZoomStale(null, 1)).toBe(true)
    expect(chromeZoomStale(0, 1)).toBe(true)
    expect(chromeZoomStale(Number.NaN, 1)).toBe(true)
  })

  it('takes the drift it is given', () => {
    expect(chromeZoomStale(1, 1.05, 1.02)).toBe(true)
    expect(chromeZoomStale(1, 1.05, 1.5)).toBe(false)
  })
})
