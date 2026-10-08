/**
 * Where a mark is: the box each kind of mark covers, with no DOM. A text item
 * covers what the type layout sets (core/type/layout.ts), with the measure a
 * caller gives - the canvas's, in the app - or the built-in face's.
 */

import { geometryBounds } from './geometry-effects.js';
import { isImageStroke, isTextStroke, type Stroke } from './types.js';
import { smudgeBox } from './smudge.js';
import { layoutType } from './type/layout.js';
import type { TypeMeasure } from './type/measure.js';

/**
 * Axis-aligned bounds of a stroke (or text item) in CSS pixels: where its
 * points are - or, when geometry effects draw it anew, where what they draw
 * is: a Warp's bent shape, a Splatter's hatch carried past the edge
 * (core/geometry-effects.ts).
 */
export function strokeBounds(
  stroke: Stroke,
  measure?: TypeMeasure,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (isImageStroke(stroke)) {
    const a = stroke.points[0];
    if (!a) return null;
    // Fall back to a nominal footprint when the placed size is unknown.
    const w = stroke.imageWidth ?? 100;
    const h = stroke.imageHeight ?? 100;
    return { minX: a.x, minY: a.y, maxX: a.x + w, maxY: a.y + h };
  }
  if (isTextStroke(stroke)) {
    if (!stroke.points[0]) return null;
    // A text a Warp bends or 3D builds is where its shapes are drawn (core/geometry-effects.ts).
    const drawn = geometryBounds(stroke, (part) => strokeBounds(part, measure));
    if (drawn) return drawn;
    return { ...layoutType(stroke, measure).bounds };
  }
  if (stroke.points.length === 0) return null;
  // What the geometry effects draw is where the mark is: its own points may be nowhere near.
  const drawn = geometryBounds(stroke, (part) => strokeBounds(part, measure));
  if (drawn) return drawn;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // A smeared Pencil mark takes in where the stump carried its graphite.
  for (const smudge of stroke.smudges ?? []) {
    const box = smudgeBox(smudge);
    if (!box) continue;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return { minX, minY, maxX, maxY };
}
