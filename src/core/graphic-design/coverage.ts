/**
 * Coverage for the graphic-design rasterizer: which share of each pixel a set
 * of closed contours covers, by scanline, with four sub-rows a pixel and exact
 * horizontal spans.
 *
 * A module of its own so a caller that only fills outlines - the Pencil fills
 * its grain this way - reaches the scanline filler and not the renderer, its
 * media decoding, its brand inlining and its SVG writer besides.
 */

import { contourBounds, type Contour } from './geometry.js';
import type { FillRule } from './types.js';

/** Sub-rows sampled per pixel row. Four is the usual quality/cost knee. */
const SUBSAMPLES = 4;

/** One edge crossing found on a scanline. */
interface Crossing {
  x: number;
  winding: number;
}

/** Adds `weight` of coverage to the pixels a horizontal span covers. */
function addSpan(
  coverage: Float32Array,
  width: number,
  row: number,
  from: number,
  to: number,
  weight: number,
): void {
  const start = Math.max(0, from);
  const end = Math.min(width, to);
  if (end <= start) return;
  const first = Math.floor(start);
  const last = Math.min(width - 1, Math.floor(end - 1e-9));
  const offset = row * width;
  if (first === last) {
    coverage[offset + first] += (end - start) * weight;
    return;
  }
  coverage[offset + first] += (first + 1 - start) * weight;
  for (let x = first + 1; x < last; x++) coverage[offset + x] += weight;
  coverage[offset + last] += (end - last) * weight;
}

/**
 * Computes per-pixel coverage for a set of closed contours in device space.
 *
 * @param rule `nonzero` unions overlapping pieces, which is what a stroke
 *   outline wants; `evenodd` punches them, which is what a donut wants.
 */
export function rasterizeContours(
  contours: Contour[],
  width: number,
  height: number,
  rule: FillRule = 'nonzero',
): Float32Array {
  const coverage = new Float32Array(width * height);
  const bounds = contourBounds(contours);
  if (!bounds) return coverage;

  const firstRow = Math.max(0, Math.floor(bounds.y));
  const lastRow = Math.min(height - 1, Math.ceil(bounds.y + bounds.height));
  const weight = 1 / SUBSAMPLES;
  const crossings: Crossing[] = [];

  for (let row = firstRow; row <= lastRow; row++) {
    for (let sub = 0; sub < SUBSAMPLES; sub++) {
      const y = row + (sub + 0.5) / SUBSAMPLES;
      crossings.length = 0;
      for (const contour of contours) {
        const n = contour.length;
        if (n < 2) continue;
        for (let i = 0; i < n; i++) {
          const a = contour[i];
          const b = contour[(i + 1) % n];
          if (a.y === b.y) continue;
          const top = a.y < b.y ? a : b;
          const bottom = a.y < b.y ? b : a;
          if (y < top.y || y >= bottom.y) continue;
          const t = (y - top.y) / (bottom.y - top.y);
          crossings.push({ x: top.x + (bottom.x - top.x) * t, winding: a.y < b.y ? 1 : -1 });
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((p, q) => p.x - q.x);

      if (rule === 'evenodd') {
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          addSpan(coverage, width, row, crossings[i].x, crossings[i + 1].x, weight);
        }
      } else {
        let winding = 0;
        for (let i = 0; i + 1 < crossings.length; i++) {
          winding += crossings[i].winding;
          if (winding !== 0) addSpan(coverage, width, row, crossings[i].x, crossings[i + 1].x, weight);
        }
      }
    }
  }
  return coverage;
}
