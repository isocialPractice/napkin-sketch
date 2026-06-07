/**
 * Auto-sharpen engine.
 *
 * Transforms stiff, computer-drawn pointer strokes into cleaner, more
 * "hand-drawn" forms. The pipeline is:
 *
 *   1. Resample + denoise the raw input.
 *   2. Recognize intent (straight line, circle/ellipse, polygon, or freeform).
 *   3. Rebuild an idealized version of that shape.
 *   4. Re-introduce subtle, organic imperfection (wobble, end taper, slight
 *      corner overshoot) so the result reads as hand-drawn rather than vector.
 *
 * The engine is pure and deterministic given a stroke id, so re-sharpening a
 * stroke yields the same result and the same stroke can be sharpened in either
 * the Node (CLI `--sharpen`) or browser (live GUI) build.
 */

import type { Point, Stroke } from '../core/types.js';
import {
  angleAt,
  boundingBox,
  catmullRom,
  centroid,
  distance,
  fitCircle,
  makeNoise,
  normal,
  pathLength,
  resample,
  simplify,
  type Vec2,
} from './geometry.js';

/** Tunable parameters controlling the sharpen behaviour. */
export interface SharpenOptions {
  /** Even spacing (px) used when resampling raw input. */
  resampleSpacing: number;
  /** RDP tolerance (px) for denoising; larger = more aggressive smoothing. */
  simplifyEpsilon: number;
  /** Amplitude (px) of the hand-drawn wobble applied to idealized shapes. */
  wobble: number;
  /** Frequency of the hand-drawn wobble (cycles across the path). */
  wobbleFrequency: number;
  /** Max RMS error (as a fraction of radius) to accept a circle fit. */
  circleTolerance: number;
  /** Max corner count for polygon snapping. */
  maxPolygonCorners: number;
  /** Whether to taper stroke ends for a natural pen lift. */
  taperEnds: boolean;
}

/** Sensible defaults tuned for typical pen/mouse sketching. */
export const DEFAULT_SHARPEN_OPTIONS: SharpenOptions = {
  resampleSpacing: 4,
  simplifyEpsilon: 2.5,
  wobble: 1.1,
  wobbleFrequency: 1.6,
  circleTolerance: 0.12,
  maxPolygonCorners: 6,
  taperEnds: true,
};

/** The recognized intent of a stroke. */
export type ShapeKind = 'line' | 'circle' | 'polygon' | 'freeform';

/** A numeric seed derived from a stroke id, for deterministic wobble. */
function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/** Detects whether a stroke is effectively closed (start ≈ end). */
function isClosed(points: Vec2[]): boolean {
  if (points.length < 4) return false;
  const span = pathLength(points);
  return distance(points[0], points[points.length - 1]) < span * 0.18;
}

/** Finds dominant corners by locating local minima of interior angle. */
function findCorners(points: Point[], angleThreshold: number): number[] {
  const corners: number[] = [];
  const window = 2;
  for (let i = window; i < points.length - window; i++) {
    const ang = angleAt(points[i - window], points[i], points[i + window]);
    if (ang < angleThreshold) {
      // Keep only the sharpest corner within a small neighbourhood.
      const last = corners[corners.length - 1];
      if (last !== undefined && i - last < window * 2) {
        const prevAng = angleAt(points[last - window], points[last], points[last + window]);
        if (ang < prevAng) corners[corners.length - 1] = i;
      } else {
        corners.push(i);
      }
    }
  }
  return corners;
}

/** Classifies a denoised stroke into a shape kind. */
export function classify(points: Point[], opts: SharpenOptions): ShapeKind {
  if (points.length < 3) return 'line';

  const closed = isClosed(points);

  // Straight line: few points, low deviation from the start–end chord.
  if (!closed) {
    const start = points[0];
    const end = points[points.length - 1];
    const chord = distance(start, end);
    if (chord > 1) {
      let maxDev = 0;
      for (const p of points) {
        const dev = perpendicular(p, start, end);
        if (dev > maxDev) maxDev = dev;
      }
      if (maxDev < Math.max(6, chord * 0.04)) return 'line';
    }
  }

  // Circle / ellipse: closed and well-fit by a circle.
  if (closed) {
    const fit = fitCircle(points);
    if (fit && fit.radius > 4 && fit.error / fit.radius < opts.circleTolerance) {
      return 'circle';
    }
    const corners = findCorners([...points, points[0]], (Math.PI * 2) / 3);
    if (corners.length >= 3 && corners.length <= opts.maxPolygonCorners) {
      return 'polygon';
    }
  }

  return 'freeform';
}

function perpendicular(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Applies organic, hand-drawn wobble along a polyline by displacing each point
 * along its local normal using smooth value-noise. Endpoints are anchored.
 */
function applyWobble(points: Point[], seed: number, opts: SharpenOptions): Point[] {
  if (points.length < 2 || opts.wobble <= 0) return points;
  const noise = makeNoise(seed);
  const total = points.length - 1;
  const out: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // Anchor the very ends so shapes still connect cleanly.
    const edgeFade = Math.min(1, Math.min(i, total - i) / 3);
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const n = normal(a, b);
    const phase = (i / total) * opts.wobbleFrequency * Math.PI * 2;
    const offset = noise(phase) * opts.wobble * edgeFade;
    out.push({
      x: p.x + n.x * offset,
      y: p.y + n.y * offset,
      pressure: p.pressure,
      t: p.t,
    });
  }
  return out;
}

/** Tapers pressure toward the stroke ends for a natural pen lift-off. */
function applyTaper(points: Point[]): Point[] {
  const n = points.length;
  if (n < 4) return points;
  const taper = Math.max(2, Math.floor(n * 0.12));
  return points.map((p, i) => {
    const fromStart = i / taper;
    const fromEnd = (n - 1 - i) / taper;
    const scale = Math.min(1, fromStart, fromEnd) * 0.6 + 0.4;
    return { ...p, pressure: (p.pressure ?? 0.5) * scale };
  });
}

/** Rebuilds a clean straight line between the stroke's endpoints. */
function buildLine(points: Point[]): Point[] {
  const start = points[0];
  const end = points[points.length - 1];
  const steps = Math.max(2, Math.round(distance(start, end) / 6));
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      pressure: (start.pressure ?? 0.5) + ((end.pressure ?? 0.5) - (start.pressure ?? 0.5)) * t,
    });
  }
  return out;
}

/** Rebuilds an idealized circle (or ellipse) from a closed stroke. */
function buildCircle(points: Point[]): Point[] {
  const fit = fitCircle(points);
  const box = boundingBox(points);
  const center = fit ? fit.center : centroid(points);

  // Blend the circle fit with the bounding box so gentle ellipticity in the
  // original sketch is preserved rather than forced into a perfect circle.
  const fitRadius = fit ? fit.radius : Math.max(box.width, box.height) / 2;
  const radiusX = (box.width / 2 + fitRadius) / 2;
  const radiusY = (box.height / 2 + fitRadius) / 2;

  // Preserve the original winding direction and starting angle.
  const startAngle = Math.atan2(points[0].y - center.y, points[0].x - center.x);
  const dir = polygonSignedArea(points) >= 0 ? 1 : -1;

  const steps = Math.max(24, Math.round((Math.PI * (radiusX + radiusY)) / 6));
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + dir * (i / steps) * Math.PI * 2;
    out.push({
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
      pressure: 0.5,
    });
  }
  return out;
}

/** Signed area of a polygon (positive = counter-clockwise in screen space). */
function polygonSignedArea(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Rebuilds a clean polygon by snapping to detected corners and straightening edges. */
function buildPolygon(points: Point[], opts: SharpenOptions): Point[] {
  const loop = [...points, points[0]];
  const cornerIdx = findCorners(loop, (Math.PI * 2) / 3);
  const corners: Point[] = cornerIdx.map((i) => points[i % points.length]);
  if (corners.length < 3) return buildClosedFreeform(points, opts);

  const out: Point[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const steps = Math.max(2, Math.round(distance(a, b) / 6));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: 0.5 });
    }
  }
  out.push({ ...out[0] });
  return out;
}

/** Smooths an open freeform stroke with a Catmull–Rom spline. */
function buildFreeform(points: Point[]): Point[] {
  return catmullRom(points, 10, 0.5);
}

/** Smooths a closed freeform stroke and re-closes it. */
function buildClosedFreeform(points: Point[], _opts: SharpenOptions): Point[] {
  const loop = [...points, points[0], points[1]];
  const smooth = catmullRom(loop, 10, 0.5);
  smooth.push({ ...smooth[0] });
  return smooth;
}

/**
 * Sharpens a single set of raw points and returns the beautified, hand-drawn
 * version along with the detected shape kind.
 */
export function sharpenPoints(
  rawPoints: Point[],
  seed: number,
  options: Partial<SharpenOptions> = {},
): { points: Point[]; kind: ShapeKind } {
  const opts = { ...DEFAULT_SHARPEN_OPTIONS, ...options };
  if (rawPoints.length < 3) {
    return { points: rawPoints.slice(), kind: 'line' };
  }

  const resampled = resample(rawPoints, opts.resampleSpacing);
  const denoised = simplify(resampled, opts.simplifyEpsilon);
  const kind = classify(denoised, opts);

  let rebuilt: Point[];
  switch (kind) {
    case 'line':
      rebuilt = buildLine(denoised);
      break;
    case 'circle':
      rebuilt = buildCircle(denoised);
      break;
    case 'polygon':
      rebuilt = buildPolygon(denoised, opts);
      break;
    default:
      rebuilt = isClosed(denoised) ? buildClosedFreeform(denoised, opts) : buildFreeform(denoised);
      break;
  }

  let result = applyWobble(rebuilt, seed, opts);
  if (opts.taperEnds && kind !== 'circle' && kind !== 'polygon') {
    result = applyTaper(result);
  }
  return { points: result, kind };
}

/** Returns a new, sharpened copy of a stroke (the original is not mutated). */
export function sharpenStroke(stroke: Stroke, options: Partial<SharpenOptions> = {}): Stroke {
  // Eraser strokes are masks, not marks: never reshape them.
  if (stroke.tool === 'eraser' || stroke.points.length < 3) {
    return { ...stroke, sharpened: true };
  }
  const seed = seedFromId(stroke.id);
  const { points } = sharpenPoints(stroke.points, seed, options);
  return { ...stroke, points, sharpened: true };
}

/** Sharpens every (not-yet-sharpened) stroke in a list, returning a new array. */
export function sharpenStrokes(strokes: Stroke[], options: Partial<SharpenOptions> = {}): Stroke[] {
  return strokes.map((s) => (s.sharpened ? s : sharpenStroke(s, options)));
}
