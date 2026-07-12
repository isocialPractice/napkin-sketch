/**
 * Copic broad-nib geometry, shared by the canvas renderer, the SVG export,
 * and the PDF export. Pure math - no DOM or Node dependencies.
 */

import { DEFAULT_NIB_ANGLE, type Stroke } from './types.js';

/**
 * Builds the chisel-nib footprint of a Copic stroke: one quadrilateral per
 * path segment (the nib swept between two samples) plus a thin rectangle per
 * sample point (the nib's resting contact patch, which also guarantees a
 * visible mark when the drag direction is parallel to the nib). Every polygon
 * winds the same way, so a single non-zero fill paints overlaps exactly once.
 */
export function copicNibPolygons(stroke: Stroke): { x: number; y: number }[][] {
  const pts = stroke.points;
  if (pts.length === 0) return [];
  const rad = ((stroke.nibAngle ?? DEFAULT_NIB_ANGLE) * Math.PI) / 180;
  const half = Math.max(1, stroke.width) / 2;
  // Nib direction (along the flat edge) and its perpendicular (edge thickness).
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  const edgeHalf = Math.max(0.75, stroke.width * 0.07);
  const ex = -Math.sin(rad) * edgeHalf;
  const ey = Math.cos(rad) * edgeHalf;

  const polys: { x: number; y: number }[][] = [];
  for (const p of pts) {
    polys.push([
      { x: p.x - dx - ex, y: p.y - dy - ey },
      { x: p.x + dx - ex, y: p.y + dy - ey },
      { x: p.x + dx + ex, y: p.y + dy + ey },
      { x: p.x - dx + ex, y: p.y - dy + ey },
    ]);
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // Keep a consistent winding regardless of travel direction so the
    // non-zero fill rule never cancels overlapping polygons out.
    const cross = (b.x - a.x) * dy - (b.y - a.y) * dx;
    const [from, to] = cross <= 0 ? [a, b] : [b, a];
    polys.push([
      { x: from.x - dx, y: from.y - dy },
      { x: from.x + dx, y: from.y + dy },
      { x: to.x + dx, y: to.y + dy },
      { x: to.x - dx, y: to.y - dy },
    ]);
  }
  return polys;
}
