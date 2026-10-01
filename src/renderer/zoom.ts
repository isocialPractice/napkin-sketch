/**
 * How far the canvas zooms, and what the screen's lengths are on the page.
 *
 * The canvas zooms from a fifth of the page's size in to where one page
 * pixel spans the canvas's shorter side: about 900 times on a 2240 x 1400
 * screen, and never less than the 8 times it used to stop at. Rendering is
 * `devicePixelRatio * zoom` on a backing store the size of the canvas, so the
 * depth costs nothing by itself; what has to follow it is everything that
 * was measured in page units but meant as a distance on the screen - a drag
 * threshold, a sample spacing, the dashes of a selection box - which comes
 * back through {@link screenPx}, and the effects, whose blurs grow with the
 * zoom, which {@link boxReachesView} lets the painter skip when their marks
 * are nowhere near the view.
 *
 * Nothing here touches the DOM.
 */

/** The farthest out the canvas zooms: a fifth of the page's size. */
export const MIN_ZOOM = 0.2;

/** The deepest zoom a canvas too small to reach one page pixel across still gets: the old limit. */
export const MAX_ZOOM_FLOOR = 8;

/** One step of View > Zoom In, and back for Zoom Out. */
export const ZOOM_MENU_STEP = 1.25;

/** One notch of `Alt` + wheel. */
export const WHEEL_ZOOM_STEP = 1.1;

/** A wheel's delta for one notch of a mouse wheel, in pixels. */
const WHEEL_NOTCH = 100;

/** The pixels a wheel event's delta counts in a line and in a page (`WheelEvent.deltaMode` 1 and 2). */
const WHEEL_LINE_PX = WHEEL_NOTCH / 3;
const WHEEL_PAGE_PX = WHEEL_NOTCH * 3;

/** How far the canvas zooms, in screen (CSS) pixels to the page pixel. */
export interface ZoomLimits {
  min: number;
  max: number;
}

/** The pan and zoom a canvas shows the page with: screen = page * zoom + pan. */
export interface ViewTransform {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * The zoom limits of a canvas `viewW` x `viewH` screen pixels: at the
 * deepest, one page pixel spans the shorter side.
 */
export function zoomLimits(viewW: number, viewH: number): ZoomLimits {
  const side = Math.min(viewW, viewH);
  return { min: MIN_ZOOM, max: Math.max(MAX_ZOOM_FLOOR, Number.isFinite(side) ? side : 0) };
}

/** `zoom` held to the limits; a zoom that is not a positive number becomes 1, then is held. */
export function clampZoom(zoom: number, limits: ZoomLimits): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(limits.max, Math.max(limits.min, z));
}

/**
 * The view with its zoom held to `limits`, the canvas point (`cx`, `cy`)
 * staying over the same page point: what a canvas that shrank below its
 * zoom shows.
 */
export function clampView(view: ViewTransform, limits: ZoomLimits, cx: number, cy: number): ViewTransform {
  const zoom = clampZoom(view.zoom, limits);
  if (zoom === view.zoom) return view;
  const pageX = (cx - view.panX) / view.zoom;
  const pageY = (cy - view.panY) / view.zoom;
  return { zoom, panX: cx - pageX * zoom, panY: cy - pageY * zoom };
}

/** `px` screen pixels in page units at `zoom`: how a distance meant on the screen is measured on the page. */
export function screenPx(px: number, zoom: number): number {
  return px / zoom;
}

/**
 * The zoom factor a wheel event asks for: {@link WHEEL_ZOOM_STEP} for each
 * notch of a mouse wheel (a delta of 100 pixels), and as much of one as a
 * trackpad's smaller deltas make. Up zooms in, unless `invert`.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, invert = false): number {
  const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
  if (!Number.isFinite(px) || px === 0) return 1;
  const notches = -px / WHEEL_NOTCH;
  return Math.pow(WHEEL_ZOOM_STEP, invert ? -notches : notches);
}

/**
 * Whether a page box grown by `reach` page units lands anywhere on a canvas
 * `width` x `height` device pixels, under the page-to-device transform
 * (`a`, `b`, `c`, `d`, `e`, `f`), as a 2D context's `getTransform()` gives
 * it. A mark or a layer that does not can be left unpainted: nothing it
 * paints, its effects' blur and shadow included, reaches the view.
 */
export function boxReachesView(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  reach: number,
  transform: { a: number; b: number; c: number; d: number; e: number; f: number },
  width: number,
  height: number,
): boolean {
  const { a, b, c, d, e, f } = transform;
  const x0 = box.minX - reach;
  const y0 = box.minY - reach;
  const x1 = box.maxX + reach;
  const y1 = box.maxY + reach;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]) {
    const dx = a * x + c * y + e;
    const dy = b * x + d * y + f;
    minX = Math.min(minX, dx);
    minY = Math.min(minY, dy);
    maxX = Math.max(maxX, dx);
    maxY = Math.max(maxY, dy);
  }
  return maxX >= 0 && maxY >= 0 && minX <= width && minY <= height;
}
