/**
 * The curve `through` draws: a smooth curve through every point in turn.
 *
 * Each point becomes an anchor, so the curve can be reshaped point by point
 * in the app. At a point inside the list the curve runs parallel to the line
 * from the point before it to the point after it (the Catmull-Rom tangent),
 * and each handle reaches a third of the way along its own segment, so points
 * spaced unevenly do not throw the curve into loops. At the two ends, the
 * first and last segments are the parabolas that meet their neighbours'
 * handles, which ends the curve without a hook. Two points make a straight
 * line.
 *
 * A single cubic fitted through up to four points at fixed parameters, as
 * `throughPoints` in the vector-graphics skill fits one, also passes through
 * the points, but it loops when they are spaced unevenly and leaves the inner
 * points without anchors to edit - which is why this builds one anchor a point.
 */

import type { VectorAnchor } from '../types.js';

type P = { x: number; y: number };

/**
 * The anchors of a smooth curve through `points`. Repeated points are dropped.
 *
 * `lead`, when given, is the direction the curve leaves the first point in -
 * inside a path, the mirror of the handle the path arrived with - so that the
 * curve carries on smoothly from a curve before it.
 */
export function throughAnchors(points: readonly P[], lead?: P): VectorAnchor[] {
  const pts: P[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) pts.push({ x: p.x, y: p.y });
  }
  const anchors: VectorAnchor[] = pts.map((p) => ({ p: { ...p } }));
  const n = anchors.length;
  if (n < 2) return anchors;
  const chord = (i: number): number => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  for (let i = 1; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i - 1].x;
    const dy = pts[i + 1].y - pts[i - 1].y;
    const length = Math.hypot(dx, dy);
    // The curve turns straight back on itself here, and a corner is all it can be.
    if (length < 1e-9) continue;
    const back = chord(i - 1) / 3 / length;
    const ahead = chord(i) / 3 / length;
    anchors[i].hIn = { x: pts[i].x - dx * back, y: pts[i].y - dy * back };
    anchors[i].hOut = { x: pts[i].x + dx * ahead, y: pts[i].y + dy * ahead };
  }
  const leadLength = lead ? Math.hypot(lead.x, lead.y) : 0;
  if (lead && leadLength > 1e-9) {
    const reach = chord(0) / 3 / leadLength;
    anchors[0].hOut = { x: pts[0].x + lead.x * reach, y: pts[0].y + lead.y * reach };
  } else if (anchors[1].hIn) {
    anchors[0].hOut = parabolaHandle(pts[0], pts[1], anchors[1].hIn);
  }
  const before = anchors[n - 2].hOut;
  if (before) anchors[n - 1].hIn = parabolaHandle(pts[n - 1], pts[n - 2], before);
  return anchors;
}

/**
 * The handle at the end point `end` that makes the segment between it and
 * `near` a parabola - a quadratic, written as the cubic that draws it - whose
 * other handle is `handle`. A quadratic's cubic handles sit two thirds of the
 * way from each end toward its one control point, so that point lies on the
 * line of `handle`, half as far again from `near`.
 */
function parabolaHandle(end: P, near: P, handle: P): P {
  const control = { x: near.x + ((handle.x - near.x) * 3) / 2, y: near.y + ((handle.y - near.y) * 3) / 2 };
  return { x: end.x + ((control.x - end.x) * 2) / 3, y: end.y + ((control.y - end.y) * 2) / 3 };
}
