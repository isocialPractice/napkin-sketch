/**
 * Gradient paint: where a gradient runs across an element, and its colour at
 * any point along the way.
 *
 * The SVG writer, the rasterizer and the canvas painter all read it from
 * here, so a gradient lands in the same place in every format. The placement
 * is the one the sketch export has always used for a filled shape: a linear
 * gradient runs through the centre of the element's box at its angle and
 * reaches the box's edges along it, and a radial one runs from the centre out
 * to the corners.
 */

import { parsePaint, type Rgba } from './color.js';
import type { GradientPaint, GradientStop, Paint } from './types.js';

/** A box in an element's own coordinates. */
export interface PaintBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a gradient runs: the ends of a linear one's axis, or a radial one's centre and reach. */
export type GradientAxis =
  | { type: 'linear'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'radial'; cx: number; cy: number; r: number };

/** True when a paint is a gradient rather than a colour. */
export function isGradientPaint(paint: Paint | null | undefined): paint is GradientPaint {
  return typeof paint === 'object' && paint !== null && (paint.type === 'linear' || paint.type === 'radial');
}

/** A gradient's stops in order along it, each offset held between 0 and 1. */
export function sortedStops(paint: GradientPaint): GradientStop[] {
  return paint.stops
    .map((stop) => ({ offset: Math.min(1, Math.max(0, Number.isFinite(stop.offset) ? stop.offset : 0)), color: stop.color }))
    .sort((a, b) => a.offset - b.offset);
}

/**
 * The flat colour that stands in for a paint where a gradient cannot be
 * drawn - text, whose glyphs are strokes - which is its first stop's.
 */
export function flatPaint(paint: Paint | null | undefined): string | null | undefined {
  if (!isGradientPaint(paint)) return paint;
  return sortedStops(paint)[0]?.color ?? null;
}

/** Where a gradient runs over a box. */
export function gradientAxis(paint: GradientPaint, box: PaintBox): GradientAxis {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  if (paint.type === 'radial') return { type: 'radial', cx, cy, r: Math.hypot(w, h) / 2 };
  const rad = ((paint.angle ?? 0) * Math.PI) / 180;
  const reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const dx = Math.cos(rad) * reach;
  const dy = Math.sin(rad) * reach;
  return { type: 'linear', x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
}

/** How far along a gradient a point lies, from 0 at its start to 1 at its end. */
export function gradientOffset(axis: GradientAxis, x: number, y: number): number {
  if (axis.type === 'radial') return Math.min(1, Math.hypot(x - axis.cx, y - axis.cy) / Math.max(1e-9, axis.r));
  const dx = axis.x2 - axis.x1;
  const dy = axis.y2 - axis.y1;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? ((x - axis.x1) * dx + (y - axis.y1) * dy) / length : 0;
  return Math.min(1, Math.max(0, t));
}

/** A gradient's stops as colours; null when none of them is a colour that paints. */
export function paintStops(paint: GradientPaint): Array<{ offset: number; color: Rgba }> | null {
  const stops: Array<{ offset: number; color: Rgba }> = [];
  for (const stop of sortedStops(paint)) {
    let color: Rgba | null;
    try {
      color = parsePaint(stop.color) ?? { r: 0, g: 0, b: 0, a: 0 };
    } catch {
      color = null;
    }
    if (color) stops.push({ offset: stop.offset, color });
  }
  return stops.length > 0 ? stops : null;
}

/**
 * The colour at `t` along a gradient: the stops either side of it mixed
 * with their alpha premultiplied, as browsers mix a gradient, so a stop that
 * fades to transparent does not darken the colour on its way out.
 */
export function colorAt(stops: ReadonlyArray<{ offset: number; color: Rgba }>, t: number): Rgba {
  if (t <= stops[0].offset) return stops[0].color;
  const last = stops[stops.length - 1];
  if (t >= last.offset) return last.color;
  let k = 1;
  while (k < stops.length - 1 && stops[k].offset < t) k++;
  const a = stops[k - 1];
  const b = stops[k];
  const span = b.offset - a.offset;
  const f = span > 0 ? (t - a.offset) / span : 1;
  const alpha = a.color.a + (b.color.a - a.color.a) * f;
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (x: number, y: number): number => (x * a.color.a + (y * b.color.a - x * a.color.a) * f) / alpha;
  return { r: mix(a.color.r, b.color.r), g: mix(a.color.g, b.color.g), b: mix(a.color.b, b.color.b), a: alpha };
}
