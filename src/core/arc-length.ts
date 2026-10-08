/**
 * Arc length along a path of Bezier anchors: how long it is, where a length
 * along it lands, which way it runs there, and how far along it the nearest
 * point to another lies. Path type sets its glyphs by it (core/type/layout.ts),
 * and `cubicAt` is the one Bezier evaluator Split, Liquify and Mesh Warp use.
 *
 * A segment's length is the integral of its speed, |B'(t)|, worked out by
 * five-point Gauss-Legendre quadrature over pieces of the segment: a piece
 * whose halves add up to more than a hair over the whole is halved again
 * (bisection), so a tight bend gets small pieces and a gentle one few. The
 * pieces' ends are kept as a table of (t, length) pairs; a length is turned
 * back into t by a search of the table and a few Newton steps, which land
 * within a millionth of a pixel.
 *
 * Anchors are `VectorAnchor`s as the marks keep them: a missing handle is the
 * anchor itself, so a segment with neither is a straight line. A `move` starts
 * a new subpath; the jump to it has no length. A closed path closes each
 * subpath back to its own first anchor.
 */

import type { VectorAnchor } from './types.js';

/** A point, or a direction. */
export interface Vec {
  x: number;
  y: number;
}

/** The point at `t` (0 to 1) on the cubic from `p0` to `p3` with handles `c1` and `c2`. */
export function cubicAt(p0: Vec, c1: Vec, c2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x, y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y };
}

/** The cubic's velocity at `t`: which way it runs there, and how fast. */
export function cubicDerivative(p0: Vec, c1: Vec, c2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (c1.x - p0.x) + b * (c2.x - c1.x) + c * (p3.x - c2.x),
    y: a * (c1.y - p0.y) + b * (c2.y - c1.y) + c * (p3.y - c2.y),
  };
}

/** The cubic's acceleration at `t`, for its curvature. */
function cubicSecond(p0: Vec, c1: Vec, c2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  return {
    x: 6 * u * (c2.x - 2 * c1.x + p0.x) + 6 * t * (p3.x - 2 * c2.x + c1.x),
    y: 6 * u * (c2.y - 2 * c1.y + p0.y) + 6 * t * (p3.y - 2 * c2.y + c1.y),
  };
}

// Five-point Gauss-Legendre nodes and weights on [-1, 1].
const NODES = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const WEIGHTS = [0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908, 0.23692688505618908];

/** One segment of a path, with its table of lengths. */
interface Segment {
  p0: Vec;
  c1: Vec;
  c2: Vec;
  p3: Vec;
  /** A straight line: neither end has a handle off its anchor. */
  line: boolean;
  /** How far along the whole path it starts, and how long it is. */
  start: number;
  length: number;
  /** Its pieces' ends: `ts[i]` with `ss[i]` the length from the segment's start to it. */
  ts: number[];
  ss: number[];
}

/** A path's lengths: built once, then read by length as often as needed. */
export interface LengthTable {
  segments: Segment[];
  /** The whole path's length. */
  total: number;
  closed: boolean;
}

/** How closely a piece's length is held before it is halved again, as a share of its length. */
const RELATIVE_TOLERANCE = 1e-9;
/** How many times a piece may be halved. */
const MAX_DEPTH = 18;

function speed(seg: Pick<Segment, 'p0' | 'c1' | 'c2' | 'p3'>, t: number): number {
  const d = cubicDerivative(seg.p0, seg.c1, seg.c2, seg.p3, t);
  return Math.hypot(d.x, d.y);
}

/** The length of a segment from `a` to `b`, by five-point Gauss-Legendre. */
function gauss(seg: Pick<Segment, 'p0' | 'c1' | 'c2' | 'p3'>, a: number, b: number): number {
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += WEIGHTS[i] * speed(seg, mid + half * NODES[i]);
  return sum * half;
}

/** Fills a segment's table: pieces halved until each one's halves agree with it. */
function tabulate(seg: Segment): void {
  seg.ts = [0];
  seg.ss = [0];
  if (seg.line) {
    seg.length = Math.hypot(seg.p3.x - seg.p0.x, seg.p3.y - seg.p0.y);
    seg.ts.push(1);
    seg.ss.push(seg.length);
    return;
  }
  // Without recursion: a stack of pieces, each with the length it was worked out to.
  let total = 0;
  const stack: Array<{ a: number; b: number; whole: number; depth: number }> = [];
  // Start from eight pieces, so a segment that loops is never taken whole.
  for (let k = 7; k >= 0; k--) {
    const a = k / 8;
    const b = (k + 1) / 8;
    stack.push({ a, b, whole: gauss(seg, a, b), depth: 0 });
  }
  while (stack.length > 0) {
    const piece = stack.pop()!;
    const mid = (piece.a + piece.b) / 2;
    const left = gauss(seg, piece.a, mid);
    const right = gauss(seg, mid, piece.b);
    if (piece.depth < MAX_DEPTH && Math.abs(left + right - piece.whole) > RELATIVE_TOLERANCE * Math.max(1e-9, piece.whole)) {
      // The right half goes on first, so the left one comes off next.
      stack.push({ a: mid, b: piece.b, whole: right, depth: piece.depth + 1 });
      stack.push({ a: piece.a, b: mid, whole: left, depth: piece.depth + 1 });
      continue;
    }
    total += left;
    seg.ts.push(mid);
    seg.ss.push(total);
    total += right;
    seg.ts.push(piece.b);
    seg.ss.push(total);
  }
  seg.length = total;
}

/**
 * The lengths along a path of anchors, closed back to the first anchor of each
 * subpath when `closed` is set.
 */
export function lengthTable(anchors: readonly VectorAnchor[], closed = false): LengthTable {
  const segments: Segment[] = [];
  let total = 0;
  const add = (a: VectorAnchor, b: VectorAnchor): void => {
    const c1 = a.hOut ?? a.p;
    const c2 = b.hIn ?? b.p;
    const line = same(c1, a.p) && same(c2, b.p);
    const seg: Segment = { p0: { ...a.p }, c1: { ...c1 }, c2: { ...c2 }, p3: { ...b.p }, line, start: total, length: 0, ts: [], ss: [] };
    tabulate(seg);
    total += seg.length;
    segments.push(seg);
  };
  let first = 0;
  for (let i = 0; i < anchors.length; i++) {
    const starts = i === anchors.length - 1 || anchors[i + 1].move === true;
    if (!starts) {
      add(anchors[i], anchors[i + 1]);
      continue;
    }
    // The subpath ends here: closed, it comes back to its own first anchor.
    if (closed && i > first) add(anchors[i], anchors[first]);
    first = i + 1;
  }
  return { segments, total, closed };
}

/** A segment's point at `t`: a line's by plain interpolation, since a cubic whose handles sit on its ends does not run evenly. */
function segmentPoint(seg: Segment, t: number): Vec {
  if (seg.line) return { x: seg.p0.x + (seg.p3.x - seg.p0.x) * t, y: seg.p0.y + (seg.p3.y - seg.p0.y) * t };
  return cubicAt(seg.p0, seg.c1, seg.c2, seg.p3, t);
}

function same(a: Vec, b: Vec): boolean {
  return Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;
}

/** The segment a length falls in, and how far along that segment it is: the path's ends hold it. */
function locate(table: LengthTable, s: number): { seg: Segment; within: number } | null {
  const { segments } = table;
  if (segments.length === 0) return null;
  const at = Math.max(0, Math.min(table.total, s));
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= at) lo = mid;
    else hi = mid - 1;
  }
  // Past a segment of no length, onto the next one that has some.
  let seg = segments[lo];
  while (seg.length === 0 && lo < segments.length - 1 && at >= seg.start) seg = segments[++lo];
  return { seg, within: Math.max(0, Math.min(seg.length, at - seg.start)) };
}

/** The `t` at which a segment has run `within` of its length. */
function tAt(seg: Segment, within: number): number {
  if (seg.length === 0) return 0;
  if (seg.line) return within / seg.length;
  const { ts, ss } = seg;
  let lo = 0;
  let hi = ss.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ss[mid] <= within) lo = mid;
    else hi = mid;
  }
  const span = ss[hi] - ss[lo];
  let t = span > 0 ? ts[lo] + ((ts[hi] - ts[lo]) * (within - ss[lo])) / span : ts[lo];
  // Newton on the length from the table's own point, never out of its piece.
  for (let k = 0; k < 4; k++) {
    const s = ss[lo] + gauss(seg, ts[lo], t);
    const v = speed(seg, t);
    if (v < 1e-12) break;
    const next = t - (s - within) / v;
    t = Math.max(ts[lo], Math.min(ts[hi], next));
    if (Math.abs(s - within) < 1e-9) break;
  }
  return t;
}

/**
 * A length along the path as the segment it falls in and how far through
 * that segment's `t` it is: `index + t`, the place a vector editor's type on a
 * path starts and stops at (Illustrator's `startTValue`).
 */
export function segmentTAtLength(table: LengthTable, s: number): number {
  const found = locate(table, s);
  if (!found) return 0;
  return table.segments.indexOf(found.seg) + tAt(found.seg, found.within);
}

/** The point a length along the path lands on; the ends hold a length past them. */
export function pointAtLength(table: LengthTable, s: number): Vec {
  const found = locate(table, s);
  if (!found) return { x: 0, y: 0 };
  const { seg, within } = found;
  return segmentPoint(seg, tAt(seg, within));
}

/**
 * Which way the path runs at a length along it, as a unit vector. Where a
 * handle sits on its anchor the speed there is nothing, and the direction is
 * read just inside the segment instead.
 */
export function tangentAtLength(table: LengthTable, s: number): Vec {
  const found = locate(table, s);
  if (!found) return { x: 1, y: 0 };
  const { seg, within } = found;
  if (seg.line) return unit({ x: seg.p3.x - seg.p0.x, y: seg.p3.y - seg.p0.y });
  const t = tAt(seg, within);
  let d = cubicDerivative(seg.p0, seg.c1, seg.c2, seg.p3, t);
  if (Math.hypot(d.x, d.y) < 1e-9) d = cubicDerivative(seg.p0, seg.c1, seg.c2, seg.p3, t < 0.5 ? t + 1e-4 : t - 1e-4);
  return unit(d);
}

/**
 * The path's normal at a length along it, as a unit vector: the tangent
 * turned a quarter clockwise on the page (y down), so it points to the right
 * of the way the path runs - below a path running left to right.
 */
export function normalAtLength(table: LengthTable, s: number): Vec {
  const t = tangentAtLength(table, s);
  return { x: -t.y, y: t.x };
}

/**
 * The path's curvature at a length along it: one over the radius of the
 * circle it bends along there, signed - above 0 where it bends toward its
 * normal, to the right of the way it runs - and 0 on a straight run.
 */
export function curvatureAtLength(table: LengthTable, s: number): number {
  const found = locate(table, s);
  if (!found || found.seg.line) return 0;
  const { seg, within } = found;
  const t = tAt(seg, within);
  const d = cubicDerivative(seg.p0, seg.c1, seg.c2, seg.p3, t);
  const dd = cubicSecond(seg.p0, seg.c1, seg.c2, seg.p3, t);
  const v = Math.hypot(d.x, d.y);
  if (v < 1e-9) return 0;
  return (d.x * dd.y - d.y * dd.x) / (v * v * v);
}

function unit(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
}

/**
 * The length along the path at which it comes nearest a point, with that
 * point and how far off it is. Each segment is sampled, and the best sample
 * narrowed by a golden-section search between its neighbours.
 */
export function nearestLength(table: LengthTable, p: Vec): { length: number; point: Vec; distance: number } {
  let best = { length: 0, point: { x: 0, y: 0 }, distance: Infinity };
  for (const seg of table.segments) {
    const at = (t: number): Vec => segmentPoint(seg, t);
    const off = (t: number): number => {
      const q = at(t);
      return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    };
    let t: number;
    if (seg.line) {
      const dx = seg.p3.x - seg.p0.x;
      const dy = seg.p3.y - seg.p0.y;
      const l2 = dx * dx + dy * dy;
      t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - seg.p0.x) * dx + (p.y - seg.p0.y) * dy) / l2)) : 0;
    } else {
      const steps = 32;
      let bestT = 0;
      let bestOff = Infinity;
      for (let i = 0; i <= steps; i++) {
        const d = off(i / steps);
        if (d < bestOff) {
          bestOff = d;
          bestT = i / steps;
        }
      }
      let lo = Math.max(0, bestT - 1 / steps);
      let hi = Math.min(1, bestT + 1 / steps);
      const g = (Math.sqrt(5) - 1) / 2;
      let x1 = hi - g * (hi - lo);
      let x2 = lo + g * (hi - lo);
      let f1 = off(x1);
      let f2 = off(x2);
      for (let k = 0; k < 60 && hi - lo > 1e-12; k++) {
        if (f1 < f2) {
          hi = x2;
          x2 = x1;
          f2 = f1;
          x1 = hi - g * (hi - lo);
          f1 = off(x1);
        } else {
          lo = x1;
          x1 = x2;
          f1 = f2;
          x2 = lo + g * (hi - lo);
          f2 = off(x2);
        }
      }
      t = (lo + hi) / 2;
      if (off(t) > bestOff) t = bestT;
    }
    const point = at(t);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance < best.distance) best = { length: seg.start + lengthTo(seg, t), point, distance };
  }
  return best;
}

/** How far along a segment its point at `t` is. */
function lengthTo(seg: Segment, t: number): number {
  if (seg.line) return seg.length * t;
  const { ts, ss } = seg;
  let lo = 0;
  while (lo < ts.length - 2 && ts[lo + 1] <= t) lo++;
  return ss[lo] + gauss(seg, ts[lo], t);
}
