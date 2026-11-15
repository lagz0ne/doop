import { chromeZoomStale } from './layoutZoom'

/* The Stage's dot grid and pixel grid are each one layer the size of the
   view, a repeating background whose period follows the zoom. Writing a new
   period (background-size) repaints the whole layer: a pinch over a page
   rastered the dot grid's layer again on each of its 30 frames, 140 tiles.
   Map and canvas apps treat their tiles the same way: while the zoom moves
   they scale what is already rastered, and draw it afresh once it rests.
   So while the camera zooms a grid keeps the period it was last painted at
   and its transform carries the ratio since, and it is painted again only
   when that ratio leaves its band, and exactly once the camera rests (the
   same rest the chrome waits for, Stage.tsx). A pan is the translate alone.

   The band is one-sided, a grid is only ever magnified (ratio 1 to drift):
   scaled down, the layer would no longer reach across the stage, and making
   it larger than the stage to allow for that put it over the width of one
   raster tile, tripling the tiles of every repaint. Zooming out, a grid is
   painted for a zoom one band below the camera, so the camera has the whole
   band to travel down before the next repaint. */

/** Design px between two dots. */
export const DOT_PERIOD = 26

/** How far a grid may be magnified before it is painted again. Screenshots
 *  of a pinch, scaled grid against exact grid at each step: at 10% the dots
 *  keep the weight the exact grid has (within its own step-to-step
 *  resampling), at 20% they visibly swell, up to twice the ink, while zooming
 *  out. A 0.6 → 0.95 pinch rasters the grid on 5 of its 30 frames at 10%, the
 *  rest included, where it used to on every one. */
export const GRID_ZOOM_DRIFT = 1.1

/** True when a grid painted at `painted` must be painted again for `zoom`:
 *  never painted, scaled down, or magnified past the band. */
export function gridStale(painted: number | null, zoom: number, drift = GRID_ZOOM_DRIFT): boolean {
  return painted === null || zoom < painted || chromeZoomStale(painted, zoom, drift)
}

/** The zoom to paint a stale grid at while the camera moves: its own when
 *  zooming in, one band below it when zooming out (see above). */
export function gridPaintZoom(painted: number | null, zoom: number, drift = GRID_ZOOM_DRIFT): number {
  return painted !== null && zoom < painted ? zoom / drift : zoom
}

/** The grid layer's transform for a camera, given the zoom the layer was
 *  painted at: the translate that keeps the dots on the camera's lattice, and
 *  the scale since that paint. The translate is in screen px, applied after
 *  the scale, so it is the one a layer painted at the camera's zoom gets: the
 *  scaled period is `unit × zoom` either way. It slides the layer back by up
 *  to one period, never forward, so the layer's top-left edge never shows. */
export function gridTransform(camera: { x: number; y: number; zoom: number }, unit: number, painted: number): string {
  const period = unit * camera.zoom
  const x = (((camera.x % period) + period) % period) - period
  const y = (((camera.y % period) + period) % period) - period
  const scale = camera.zoom / painted
  return scale === 1 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) scale(${scale})`
}

/** Whether a grid layer the stage's `extent` plus one painted `period` across
 *  still covers the stage magnified by `scale` and slid back by `offset`
 *  screen px. For the tests, and the reasoning above. */
export function gridCovers(extent: number, period: number, scale: number, offset: number): boolean {
  return offset <= 0 && offset > -period * scale - 1e-9 && offset + scale * (extent + period) >= extent
}
