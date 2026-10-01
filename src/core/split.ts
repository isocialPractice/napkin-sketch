/**
 * Split: cutting a mark's path where a point lands on it, as a vector
 * editor's Scissors do - and nothing moves.
 *
 * {@link nearestOnMark} finds the place on a mark's centreline nearest a
 * point: its subpath, the segment it is on, how far along, and how far off.
 * {@link splitMark} cuts there. An open path becomes two; a closed one opens
 * there, one open path starting and ending at the cut, which a second cut
 * then splits in two; a compound shape gives up the ring that was cut, as an
 * open mark of its own, the rest staying closed. A cut on an anchor adds
 * none.
 *
 * A Bezier segment is cut by de Casteljau at the point's parameter, so both
 * halves trace the original exactly, and a fitted stroke's pressure is
 * carried to the new ends. A mark of bare points gets the exact point
 * inserted and keeps every other point where it was - except that a ring of
 * bare points, once opened, becomes a path of corner anchors at the same
 * points: a ring of bare points is closed by its ends meeting, and an opened
 * one has its ends meeting too, so only an open path can say it is open.
 *
 * Nothing here touches the DOM, and nothing is changed: a split returns its
 * pieces, and the drawing window's store makes them one undo step.
 */

import { strokeBounds } from './bounds.js';
import { fittedPressureAt } from './fit-curve.js';
import { createId, isImageStroke, isTextStroke, type Point, type Stroke, type VectorAnchor } from './types.js';
import { sampleVectorPathPoints } from '../sharpen/geometry.js';

type Vec = { x: number; y: number };

/** How close, in page pixels, a script's `split` point has to be to a path. */
export const SPLIT_REACH_PX = 4;

/**
 * Where on a mark a cut lands: the subpath, the segment - from anchor (or
 * point) `segment` of the subpath to the next, the closing segment of a
 * closed one ending back at its first - how far along it, 0 to 1, the place
 * itself, and how far that is from the point it was asked for.
 */
export interface SplitPoint {
  subpath: number;
  segment: number;
  t: number;
  point: Vec;
  distance: number;
}

/**
 * A split's pieces: the first keeps the mark's id, the second is a new mark,
 * or null when the cut opened a closed path rather than dividing it.
 */
export interface SplitPieces {
  first: Stroke;
  second: Stroke | null;
}

/** Whether a mark has a path a split can cut: not text, a picture, a placed file, an older file's eraser mark or a lone dot. */
export function isSplittable(stroke: Stroke): boolean {
  if (stroke.tool === 'eraser' || isTextStroke(stroke) || isImageStroke(stroke) || stroke.link) return false;
  return (stroke.vector?.anchors.length ?? stroke.points.length) >= 2;
}

/** One subpath as anchors, open or closed: the model a split works on, whether the mark is anchors or bare points. */
interface Sub {
  anchors: VectorAnchor[];
  closed: boolean;
}

const EPS = 1e-9;
const same = (a: Vec, b: Vec, eps = 1e-6): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= eps;
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const copy = (a: VectorAnchor): VectorAnchor => {
  const out: VectorAnchor = { p: { x: a.p.x, y: a.p.y } };
  if (a.hIn) out.hIn = { x: a.hIn.x, y: a.hIn.y };
  if (a.hOut) out.hOut = { x: a.hOut.x, y: a.hOut.y };
  if (a.pressure !== undefined) out.pressure = a.pressure;
  return out;
};

/**
 * A mark's subpaths. A path of anchors is closed as a whole when it says so;
 * a mark of bare points has a ring wherever a subpath's last point is its
 * first, which the model holds once.
 */
function subsOf(stroke: Stroke): Sub[] | null {
  if (!isSplittable(stroke)) return null;
  const subs: Sub[] = [];
  if (stroke.vector && stroke.vector.anchors.length >= 2) {
    const closed = stroke.vector.closed === true;
    for (const a of stroke.vector.anchors) {
      if (a.move || subs.length === 0) subs.push({ anchors: [], closed });
      subs[subs.length - 1].anchors.push(copy(a));
    }
    return subs;
  }
  const rings: Point[][] = [];
  for (const p of stroke.points) {
    if (p.move || rings.length === 0) rings.push([]);
    rings[rings.length - 1].push(p);
  }
  for (const ring of rings) {
    const closed = ring.length >= 4 && same(ring[0], ring[ring.length - 1]);
    const kept = closed ? ring.slice(0, -1) : ring;
    subs.push({ anchors: kept.map((p) => ({ p: { x: p.x, y: p.y }, pressure: p.pressure })), closed });
  }
  return subs;
}

function cubicAt(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** The place on the segment from `a` to `b` nearest `p`: a line's by projection, a cubic's by sampling and a golden-section search. */
function nearestOnSegment(a: VectorAnchor, b: VectorAnchor, p: Vec): { t: number; point: Vec; distance: number } {
  if (!a.hOut && !b.hIn) {
    const dx = b.p.x - a.p.x;
    const dy = b.p.y - a.p.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.p.x) * dx + (p.y - a.p.y) * dy) / l2)) : 0;
    const point = lerp(a.p, b.p, t);
    return { t, point, distance: Math.hypot(point.x - p.x, point.y - p.y) };
  }
  const p0 = a.p;
  const p1 = a.hOut ?? a.p;
  const p2 = b.hIn ?? b.p;
  const p3 = b.p;
  const off = (t: number): number => {
    const q = cubicAt(p0, p1, p2, p3, t);
    return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  };
  const steps = 48;
  let best = 0;
  let bestOff = Infinity;
  for (let i = 0; i <= steps; i++) {
    const d = off(i / steps);
    if (d < bestOff) {
      bestOff = d;
      best = i / steps;
    }
  }
  // Narrowed to the sample either side of the best one.
  let lo = Math.max(0, best - 1 / steps);
  let hi = Math.min(1, best + 1 / steps);
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
  let t = (lo + hi) / 2;
  if (off(t) > bestOff) t = best;
  const point = cubicAt(p0, p1, p2, p3, t);
  return { t, point, distance: Math.hypot(point.x - p.x, point.y - p.y) };
}

/**
 * The place on a mark's path nearest `p`, or null for a mark with no path.
 * With `anchorReach`, an anchor that near `p` wins over any segment, so a cut
 * there lands on the anchor and adds none.
 */
export function nearestOnMark(stroke: Stroke, p: Vec, options: { anchorReach?: number } = {}): SplitPoint | null {
  const subs = subsOf(stroke);
  if (!subs) return null;
  const reach = options.anchorReach ?? 0;
  let snap: SplitPoint | null = null;
  if (reach > 0) {
    subs.forEach((sub, s) =>
      sub.anchors.forEach((a, i) => {
        const distance = Math.hypot(a.p.x - p.x, a.p.y - p.y);
        if (distance <= reach && (!snap || distance < snap.distance)) snap = { subpath: s, segment: i, t: 0, point: { x: a.p.x, y: a.p.y }, distance };
      }),
    );
  }
  if (snap) return snap;
  let best: SplitPoint | null = null;
  subs.forEach((sub, s) => {
    const n = sub.anchors.length;
    if (n < 2) return;
    const count = sub.closed ? n : n - 1;
    for (let k = 0; k < count; k++) {
      const near = nearestOnSegment(sub.anchors[k], sub.anchors[(k + 1) % n], p);
      if (!best || near.distance < best.distance) best = { subpath: s, segment: k, ...near };
    }
  });
  return best;
}

/**
 * The anchors of a subpath with the cut in them, and the cut's index: the
 * anchor it lands on, or a new one put in by de Casteljau at `t` - the
 * segment's handles shortened to trace its two halves exactly, the new
 * anchor's pressure the fitted stroke's there.
 */
function withCut(sub: Sub, segment: number, t: number): { anchors: VectorAnchor[]; cut: number } {
  const n = sub.anchors.length;
  const anchors = sub.anchors.map(copy);
  if (t <= EPS) return { anchors, cut: segment };
  if (t >= 1 - EPS) return { anchors, cut: (segment + 1) % n };
  const a = anchors[segment];
  const b = anchors[(segment + 1) % n];
  let mid: VectorAnchor;
  if (!a.hOut && !b.hIn) {
    mid = { p: lerp(a.p, b.p, t) };
  } else {
    const p0 = a.p;
    const p1 = a.hOut ?? a.p;
    const p2 = b.hIn ?? b.p;
    const p3 = b.p;
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, p3, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const m = lerp(p012, p123, t);
    // A handle that was on its anchor stays on it: there is nothing to shorten.
    if (a.hOut) a.hOut = p01;
    if (b.hIn) b.hIn = p23;
    mid = { p: m };
    if (!same(p012, m, EPS)) mid.hIn = p012;
    if (!same(p123, m, EPS)) mid.hOut = p123;
  }
  const pressure = fittedPressureAt(a, b, t);
  if (pressure !== undefined) mid.pressure = pressure;
  anchors.splice(segment + 1, 0, mid);
  return { anchors, cut: segment + 1 };
}

/** An anchor as the start of a path: no way in. */
function starting(a: VectorAnchor): VectorAnchor {
  const out = copy(a);
  delete out.hIn;
  return out;
}

/** An anchor as the end of a path: no way out. */
function ending(a: VectorAnchor): VectorAnchor {
  const out = copy(a);
  delete out.hOut;
  return out;
}

/**
 * A mark cut at `at`, as {@link SplitPieces}; null where there is nothing to
 * cut - the end of an open path, or a mark with no path. Both pieces keep
 * every paint property, and an opened filled shape keeps its fill.
 */
export function splitMark(stroke: Stroke, at: SplitPoint): SplitPieces | null {
  const subs = subsOf(stroke);
  const sub = subs?.[at.subpath];
  if (!subs || !sub || sub.anchors.length < 2) return null;
  const { anchors, cut } = withCut(sub, at.segment, at.t);
  const vectorMark = stroke.vector !== undefined && stroke.vector.anchors.length >= 2;
  const others = subs.filter((_, i) => i !== at.subpath);

  if (sub.closed) {
    // Opened at the cut: round from it and back to it.
    const opened: Sub = {
      anchors: [starting(anchors[cut]), ...anchors.slice(cut + 1), ...anchors.slice(0, cut), ending(anchors[cut])],
      closed: false,
    };
    // A ring of a compound shape comes out as an open mark of its own, the rest as it was.
    if (others.length > 0) {
      return { first: markOf(stroke, others, vectorMark), second: { ...markOf(stroke, [opened], true), id: createId('st') } };
    }
    return { first: markOf(stroke, [opened], true), second: null };
  }

  if (cut <= 0 || cut >= anchors.length - 1) return null;
  const before: Sub = { anchors: [...anchors.slice(0, cut), ending(anchors[cut])], closed: false };
  const after: Sub = { anchors: [starting(anchors[cut]), ...anchors.slice(cut + 1)], closed: false };
  const head = [...subs.slice(0, at.subpath), before];
  const tail = [after, ...subs.slice(at.subpath + 1)];
  return { first: markOf(stroke, head, vectorMark), second: { ...markOf(stroke, tail, vectorMark), id: createId('st') } };
}

/**
 * A mark with these subpaths in place of its own, painted as it was: a path
 * of anchors when `vector` - its points sampled from them - and otherwise bare
 * points, each ring ending where it began.
 */
function markOf(stroke: Stroke, subs: readonly Sub[], vector: boolean): Stroke {
  if (vector) {
    const closed = subs.length > 0 && subs.every((sub) => sub.closed);
    const anchors: VectorAnchor[] = [];
    subs.forEach((sub, s) =>
      sub.anchors.forEach((a, i) => {
        const out = copy(a);
        if (s > 0 && i === 0) out.move = true;
        anchors.push(out);
      }),
    );
    const piece: Stroke = { ...stroke, points: sampleVectorPathPoints(anchors, closed), vector: { ...(stroke.vector ?? {}), anchors, closed } };
    // Corners put at bare points are no fit.
    if (!stroke.vector) delete piece.vector!.fitted;
    return piece;
  }
  const points: Point[] = [];
  subs.forEach((sub, s) => {
    const ring = sub.closed ? [...sub.anchors, sub.anchors[0]] : sub.anchors;
    ring.forEach((a, i) => points.push({ x: a.p.x, y: a.p.y, pressure: a.pressure ?? 0.5, ...(s > 0 && i === 0 ? { move: true as const } : {}) }));
  });
  const piece: Stroke = { ...stroke, points };
  delete piece.vector;
  return piece;
}

/**
 * The topmost of `marks` - given in paint order, the first at the bottom -
 * whose path passes within `reach` of `p`, and where on it a cut would land;
 * null when none does. `editable` narrows the marks that may be cut.
 */
export function splitTarget(
  marks: readonly Stroke[],
  p: Vec,
  reach: number,
  options: { editable?: ReadonlySet<string>; anchorReach?: number } = {},
): { stroke: Stroke; at: SplitPoint } | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const stroke = marks[i];
    if (!isSplittable(stroke) || (options.editable && !options.editable.has(stroke.id))) continue;
    const box = strokeBounds(stroke);
    if (!box || p.x < box.minX - reach || p.x > box.maxX + reach || p.y < box.minY - reach || p.y > box.maxY + reach) continue;
    const at = nearestOnMark(stroke, p, { anchorReach: options.anchorReach });
    if (at && at.distance <= reach) return { stroke, at };
  }
  return null;
}
