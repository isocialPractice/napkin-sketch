/**
 * Geometry primitives and curve utilities used by the auto-sharpen engine.
 * Pure, dependency-free, and shared by both the Node and browser builds.
 */

import type { Point } from '../core/types.js';

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
