/**
 * Where a mark is: the box each kind of mark covers, with no DOM. A text item
 * is measured by a caller that can measure text, or roughly without one.
 */

import { isImageStroke, isTextStroke, type Stroke } from './types.js';

/** Axis-aligned bounds of a stroke (or text item) in CSS pixels. */
export function strokeBounds(
  stroke: Stroke,
  measure?: (s: Stroke) => { width: number; height: number },
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
    const a = stroke.points[0];
    if (!a) return null;
    const m = measure
      ? measure(stroke)
      : {
          width: (stroke.text ?? '').length * (stroke.fontSize ?? 24) * 0.55,
          height: stroke.fontSize ?? 24,
        };
    return { minX: a.x, minY: a.y, maxX: a.x + m.width, maxY: a.y + m.height };
  }
  if (stroke.points.length === 0) return null;
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
  return { minX, minY, maxX, maxY };
}
