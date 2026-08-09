/**
 * Geometry primitives and curve utilities used by the auto-sharpen engine and
 * the drawing tools. Pure, dependency-free, and shared by both the Node and
 * browser builds.
 */

import type { Point, VectorAnchor } from '../core/types.js';

/** A 2D vector / point with only spatial fields. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Total path length of a polyline. */
export function pathLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

/** Centroid (average position) of a set of points. */
export function centroid(points: Vec2[]): Vec2 {
  const sum = points.reduce(
    (acc, p) => {
      acc.x += p.x;
      acc.y += p.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Axis-aligned bounding box of a set of points. */
export function boundingBox(points: Vec2[]): { min: Vec2; max: Vec2; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY }, width: maxX - minX, height: maxY - minY };
}

/** Linear interpolation between two points. */
export function lerp(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: (a.pressure ?? 0.5) + ((b.pressure ?? 0.5) - (a.pressure ?? 0.5)) * t,
  };
}

/**
 * Resamples a polyline so points are evenly spaced by `spacing` pixels.
 * Preserves the first and last point and interpolates pressure.
 */
export function resample(points: Point[], spacing: number): Point[] {
  if (points.length < 2 || spacing <= 0) return points.slice();

  const out: Point[] = [{ ...points[0] }];
  let prev = points[0];
  let accumulated = 0;

  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    let segLen = distance(prev, curr);
    if (segLen === 0) continue;

    while (accumulated + segLen >= spacing) {
      const remain = spacing - accumulated;
      const t = remain / segLen;
      const next = lerp(prev, curr, t);
      out.push(next);
      prev = next;
      segLen = distance(prev, curr);
      accumulated = 0;
    }
    accumulated += segLen;
    prev = curr;
  }

  const last = points[points.length - 1];
  if (distance(out[out.length - 1], last) > spacing * 0.25) {
    out.push({ ...last });
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker polyline simplification. Removes points that lie
 * within `epsilon` pixels of the line connecting their neighbours.
 */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/** Perpendicular distance from point `p` to the line segment `a`–`b`. */
export function perpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const clamped = Math.max(0, Math.min(1, t));
  const projX = a.x + clamped * dx;
  const projY = a.y + clamped * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Samples a Catmull–Rom spline through the given control points, producing a
 * smooth curve. `segments` controls resolution per span.
 */
export function catmullRom(points: Point[], segments = 16, tension = 0.5): Point[] {
  if (points.length < 3) return points.slice();

  const out: Point[] = [];
  const pts = points;
  const alpha = tension;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;

    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      const t2 = t * t;
      const t3 = t2 * t;

      const m1x = alpha * (p2.x - p0.x);
      const m1y = alpha * (p2.y - p0.y);
      const m2x = alpha * (p3.x - p1.x);
      const m2y = alpha * (p3.y - p1.y);

      const h1 = 2 * t3 - 3 * t2 + 1;
      const h2 = -2 * t3 + 3 * t2;
      const h3 = t3 - 2 * t2 + t;
      const h4 = t3 - t2;

      out.push({
        x: h1 * p1.x + h2 * p2.x + h3 * m1x + h4 * m2x,
        y: h1 * p1.y + h2 * p2.y + h3 * m1y + h4 * m2y,
        pressure: (p1.pressure ?? 0.5) + ((p2.pressure ?? 0.5) - (p1.pressure ?? 0.5)) * t,
      });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/**
 * Quarter-ellipse arc from `a` to `b` — the quick-curve shape.
 *
 * Unturned, the arc leaves `a` with a horizontal tangent and reaches `b` with a
 * vertical one, so it bows through the `(b.x, a.y)` corner of the drag box: the
 * ellipse it belongs to is centred on the opposite corner, `(a.x, b.y)`. Both
 * radii follow the drag, so the arc reshapes live as the pointer moves.
 *
 * `apexDegrees` swings the **apex** — the bowed-out belly of the arc — clockwise
 * around the chord, without moving either end. It works because that centring
 * corner sits on the circle having the chord `a`-`b` as its diameter: turning
 * the centre around that circle keeps its two spokes to `a` and `b` at a right
 * angle (Thales' theorem), so the sweep stays a true quarter ellipse pinned at
 * both ends, and the apex orbits the chord's midpoint at a fixed distance.
 * Since the radii are the spokes, they stretch as the apex turns — a turned
 * quarter circle is an ellipse again, because a quarter circle through two
 * fixed points can only bow two ways.
 *
 * `uniform` equalises the radii to make the unturned arc a quarter circle. The
 * smaller drag axis sets the radius, matching the Shift-constrained ellipse
 * tool, so the far end sits on the drag's shorter reach rather than at the
 * pointer.
 *
 * Returns `samples + 1` points; a degenerate drag (either radius zero under
 * `uniform`) collapses to a run of identical points, which callers reject.
 */
export function quarterArcPoints(
  a: Point,
  b: Point,
  uniform: boolean,
  apexDegrees = 0,
  samples = 48,
): Point[] {
  const { cx, cy, ux, uy, vx, vy } = quarterArcBasis(a, b, uniform, apexDegrees);
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (Math.PI / 2) * (i / samples);
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    pts.push({
      x: cx + ux * cos + vx * sin,
      y: cy + uy * cos + vy * sin,
      pressure: 0.5,
    });
  }
  return pts;
}

/**
 * Centre and spoke vectors of the quarter arc: the sweep is
 * c + u·cos(t) + v·sin(t) for t in [0, π/2], from `c + u` (the drag start)
 * to `c + v` (the far end).
 */
function quarterArcBasis(
  a: Point,
  b: Point,
  uniform: boolean,
  apexDegrees: number,
): { cx: number; cy: number; ux: number; uy: number; vx: number; vy: number } {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (uniform) {
    const size = Math.min(Math.abs(dx), Math.abs(dy));
    dx = (Math.sign(dx) || 1) * size;
    dy = (Math.sign(dy) || 1) * size;
  }
  const end = { x: a.x + dx, y: a.y + dy };

  // Unturned, the centre sits level with the end point on the start point's
  // vertical: the start is then an up/down extreme of the ellipse and the end a
  // left/right one, which is exactly the flat-then-turning quarter the tool
  // draws. Turning swings that centre around the chord's midpoint.
  const mx = (a.x + end.x) / 2;
  const my = (a.y + end.y) / 2;
  const spokeX = a.x - mx;
  const spokeY = end.y - my;
  const rad = (apexDegrees * Math.PI) / 180;
  const turnCos = Math.cos(rad);
  const turnSin = Math.sin(rad);
  const cx = mx + spokeX * turnCos - spokeY * turnSin;
  const cy = my + spokeX * turnSin + spokeY * turnCos;
  return { cx, cy, ux: a.x - cx, uy: a.y - cy, vx: end.x - cx, vy: end.y - cy };
}

/**
 * Fraction of a quarter arc's spoke that places a cubic Bézier's control
 * points so the cubic hugs the arc: 4/3 · tan(π/8), the standard circle
 * constant (max deviation ≈ 0.03% of the radius).
 */
const KAPPA = 0.5522847498307936;

/**
 * The quarter arc as one cubic Bézier — two anchors and two control points.
 * `p0`/`p3` are the arc's ends and `c1`/`c2` sit `KAPPA` spokes along the
 * tangents, per B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3.
 */
export function quarterArcCubic(
  a: Point,
  b: Point,
  uniform: boolean,
  apexDegrees = 0,
): {
  p0: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  p3: { x: number; y: number };
} {
  const { cx, cy, ux, uy, vx, vy } = quarterArcBasis(a, b, uniform, apexDegrees);
  const p0 = { x: cx + ux, y: cy + uy };
  const p3 = { x: cx + vx, y: cy + vy };
  return {
    p0,
    // The tangent at the start runs along v, and at the end along u.
    c1: { x: p0.x + KAPPA * vx, y: p0.y + KAPPA * vy },
    c2: { x: p3.x + KAPPA * ux, y: p3.y + KAPPA * uy },
    p3,
  };
}

/**
 * Splits a cubic Bézier at parameter `t` (de Casteljau), returning the split
 * point and the control points of the two halves. Both halves together trace
 * exactly the original curve, which is what lets an anchor be inserted into
 * a segment without changing its shape.
 */
export function splitCubicBezier(
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p3: Vec2,
  t: number,
): {
  point: { x: number; y: number };
  left: { c1: Vec2; c2: Vec2 };
  right: { c1: Vec2; c2: Vec2 };
} {
  const mix = (a: Vec2, b: Vec2): Vec2 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const q0 = mix(p0, c1);
  const q1 = mix(c1, c2);
  const q2 = mix(c2, p3);
  const r0 = mix(q0, q1);
  const r1 = mix(q1, q2);
  const m = mix(r0, r1);
  return { point: m, left: { c1: q0, c2: r0 }, right: { c1: r1, c2: q2 } };
}

/**
 * Rounds the corner at `anchor` into a circular fillet: the anchor is
 * replaced by two anchors sitting `radius` back along each adjacent chord,
 * with handles reaching `KAPPA · radius` toward the old corner so the fillet
 * approximates a circle arc. The radius is clamped to half of the shorter
 * adjacent chord; returns null when the corner is degenerate (a zero-length
 * side).
 */
export function roundedCornerAnchors(
  prev: Vec2,
  corner: Vec2,
  next: Vec2,
  radius: number,
): [VectorAnchor, VectorAnchor] | null {
  const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
  const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
  if (inLen < 1e-6 || outLen < 1e-6) return null;
  const r = Math.max(0, Math.min(radius, Math.min(inLen, outLen) / 2));
  const inDir = { x: (corner.x - prev.x) / inLen, y: (corner.y - prev.y) / inLen };
  const outDir = { x: (next.x - corner.x) / outLen, y: (next.y - corner.y) / outLen };
  const a1 = { x: corner.x - inDir.x * r, y: corner.y - inDir.y * r };
  const a2 = { x: corner.x + outDir.x * r, y: corner.y + outDir.y * r };
  const k = KAPPA * r;
  return [
    { p: a1, hOut: { x: a1.x + inDir.x * k, y: a1.y + inDir.y * k } },
    { p: a2, hIn: { x: a2.x - outDir.x * k, y: a2.y - outDir.y * k } },
  ];
}

/**
 * Samples a cubic Bézier from `a` to `b` with control points `c1` and `c2`.
 * Returns `samples + 1` points including both endpoints — the segment shape
 * used by the Vector Path tool (each anchor's out-handle is `c1`, the next
 * anchor's in-handle is `c2`; a missing handle collapses onto its anchor,
 * which is what makes corner-to-corner segments straight).
 */
export function cubicBezierPoints(
  a: Point,
  c1: Vec2,
  c2: Vec2,
  b: Point,
  samples = 24,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const w0 = mt * mt * mt;
    const w1 = 3 * mt * mt * t;
    const w2 = 3 * mt * t * t;
    const w3 = t * t * t;
    pts.push({
      x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
      y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
      pressure: 0.5,
    });
  }
  return pts;
}

/** Least-squares circle fit (Kåsa method). Returns center, radius, and RMS error. */
export function fitCircle(points: Vec2[]): { center: Vec2; radius: number; error: number } | null {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;

  for (const p of points) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX2Y += x2 * y;
    sumXY2 += x * y2;
  }

  const c11 = 2 * (sumX2 - (sumX * sumX) / n);
  const c12 = 2 * (sumXY - (sumX * sumY) / n);
  const c22 = 2 * (sumY2 - (sumY * sumY) / n);
  const r1 = sumX3 + sumXY2 - (sumX2 + sumY2) * (sumX / n);
  const r2 = sumY3 + sumX2Y - (sumX2 + sumY2) * (sumY / n);

  const det = c11 * c22 - c12 * c12;
  if (Math.abs(det) < 1e-8) return null;

  const cx = (r1 * c22 - r2 * c12) / det;
  const cy = (c11 * r2 - c12 * r1) / det;
  const center = { x: cx, y: cy };

  let radiusSum = 0;
  for (const p of points) radiusSum += distance(p, center);
  const radius = radiusSum / n;

  let errSum = 0;
  for (const p of points) {
    const d = distance(p, center) - radius;
    errSum += d * d;
  }
  const error = Math.sqrt(errSum / n);
  return { center, radius, error };
}

/** Angle (radians) at vertex `b` formed by points a–b–c. Result in [0, π]. */
export function angleAt(a: Vec2, b: Vec2, c: Vec2): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (mag === 0) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag)));
}

/**
 * Deterministic 1D value-noise sampler in [-1, 1]. Smooth (cosine-interpolated)
 * so it produces organic, hand-drawn wobble instead of harsh randomness.
 */
export function makeNoise(seed: number): (x: number) => number {
  const hash = (n: number): number => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return (x: number): number => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = hash(i);
    const b = hash(i + 1);
    return (a + (b - a) * u) * 2 - 1;
  };
}

/** Unit normal vector (rotated 90°) of the direction from `a` to `b`. */
export function normal(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}
