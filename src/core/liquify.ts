/**
 * Liquify: bending marks under a brush, as Illustrator's Warp tools do. Warp
 * pushes the outline along the drag, like clay; Twirl turns what is under the
 * brush about its centre; Pucker draws it in toward the centre, and Bloat
 * pushes it out.
 *
 * Each is a field ({@link liquifyField}): a map of the plane that moves a
 * point by an amount falling off smoothly from the brush's centre to nothing
 * at its rim ({@link liquifyFalloff}), so a mark is bent where the brush is
 * and left exactly as it was past it. The fields are Mesh Warp's
 * {@link PointMap}s, so the marks ride on its carrier
 * ({@link mapStrokeGeometry}): anchors and handles move, and a segment the
 * field bends further than its handles alone can follow is split until each
 * piece does. A drawn shape or an older freehand stroke, which has points and
 * no anchors, is bent as anchors at its points, so its straight sides bend
 * too. A drag is a run of small dabs ({@link liquifyMarks}); once it is over,
 * each mark it bent is fitted again ({@link refitLiquified}), so the splits do
 * not pile up as anchors.
 *
 * Pencil marks are the Smear's to blend, and text, pictures and eraser marks
 * have no outline to bend: Liquify leaves all four as they are
 * ({@link liquifiable}).
 *
 * Nothing here touches the DOM.
 */

import { fitCurve, fittedPressureAt } from './fit-curve.js';
import { mapStrokeGeometry, WARP_TOLERANCE, type PointMap } from './mesh-warp.js';
import { sampleVectorPathPoints } from '../sharpen/geometry.js';
import { isImageStroke, isTextStroke, type Point, type Stroke, type VectorAnchor } from './types.js';

type Vec = { x: number; y: number };

/** What a Liquify brush does to what is under it. */
export type LiquifyMode = 'warp' | 'twirl' | 'pucker' | 'bloat';

/** The four brushes, in the panel's order, each with what it does. */
export const LIQUIFY_MODES: ReadonlyArray<{ id: LiquifyMode; label: string; summary: string }> = [
  { id: 'warp', label: 'Warp', summary: 'pushes the outline along the drag, like clay' },
  { id: 'twirl', label: 'Twirl', summary: 'turns what is under the brush about its centre' },
  { id: 'pucker', label: 'Pucker', summary: 'draws what is under the brush in toward its centre' },
  { id: 'bloat', label: 'Bloat', summary: 'pushes what is under the brush out from its centre' },
];

/** One application of a Liquify brush, in page units. */
export interface LiquifyDab {
  mode: LiquifyMode;
  /** The brush's centre. */
  x: number;
  y: number;
  /** The brush's radius: nothing at or past it moves. */
  radius: number;
  /**
   * How much. For Twirl, the turn at the centre, in degrees, clockwise on
   * the screen. For Pucker and Bloat, the share of its distance from the
   * centre that a point there moves, 0 to 1. Warp uses `dx` and `dy` instead.
   */
  amount?: number;
  /** Warp's push: how far the brush carries what is at its centre. */
  dx?: number;
  dy?: number;
}

/**
 * The share of a brush's effect at a distance from its centre: 1 there,
 * falling to 0 at the rim as (1 - (d/r)²)², whose slope is 0 at both ends,
 * so a bend has no crease at the centre or at the rim; 0 past it.
 */
export function liquifyFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || !(distance < radius)) return 0;
  const s = distance / radius;
  const u = 1 - s * s;
  return u * u;
}

/**
 * A dab's field: where it takes each point of the plane, and how far it turns
 * the plane there - which a Copic nib turns with. A point at or past the rim
 * comes back exactly as it was.
 *
 * - Warp moves a point by the push times the falloff.
 * - Twirl turns a point about the centre by the angle times the falloff, so
 *   its distance from the centre is kept.
 * - Pucker and Bloat move a point toward or away from the centre by the
 *   amount times the falloff, as a share of its distance. Both amounts are
 *   held to 0 to 1, where neither field folds the plane over itself.
 */
export function liquifyField(dab: LiquifyDab): PointMap {
  const { x: cx, y: cy, radius, mode } = dab;
  const amount = dab.amount ?? 0;
  const share = Math.min(1, Math.max(0, amount));
  const point = (p: Vec): Vec => {
    const ox = p.x - cx;
    const oy = p.y - cy;
    const f = liquifyFalloff(Math.hypot(ox, oy), radius);
    if (f === 0) return { x: p.x, y: p.y };
    if (mode === 'warp') return { x: p.x + f * (dab.dx ?? 0), y: p.y + f * (dab.dy ?? 0) };
    if (mode === 'twirl') {
      const a = (amount * f * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return { x: cx + ox * c - oy * s, y: cy + ox * s + oy * c };
    }
    const k = mode === 'pucker' ? 1 - share * f : 1 + share * f;
    return { x: cx + ox * k, y: cy + oy * k };
  };
  // How far the field turns a small cross at the point: the rotation in its
  // Jacobian, read off by central differences.
  const step = Math.max(1e-3, radius * 1e-4);
  const rotation = (p: Vec): number => {
    const left = point({ x: p.x - step, y: p.y });
    const right = point({ x: p.x + step, y: p.y });
    const up = point({ x: p.x, y: p.y - step });
    const down = point({ x: p.x, y: p.y + step });
    const j11 = right.x - left.x;
    const j21 = right.y - left.y;
    const j12 = down.x - up.x;
    const j22 = down.y - up.y;
    return (Math.atan2(j21 - j12, j11 + j22) * 180) / Math.PI;
  };
  return { point, rotation };
}

/** Whether Liquify bends a mark: not a Pencil mark, which the Smear blends, nor text, a picture or an eraser mark. */
export function liquifiable(stroke: Stroke): boolean {
  return (
    stroke.points.length >= 2 && stroke.tool !== 'pencil' && stroke.tool !== 'eraser' && !isTextStroke(stroke) && !isImageStroke(stroke)
  );
}

export interface LiquifyOptions {
  /** How far a bent curve may stray from the field's image of it, in page units: Mesh Warp's {@link WARP_TOLERANCE} unless given. */
  tolerance?: number;
  /** Fits each bent mark again once the dabs are done, within this many page units ({@link refitLiquified}); left out, the anchors are kept as the bending left them. */
  refit?: number;
}

/**
 * One drag of a Liquify brush: each dab in turn bends every mark its brush
 * reaches, and the next bends what the last left. A long push or a wide turn
 * is taken in steps - a push of a quarter of the radius at most, a turn of
 * 15 degrees - and a push carries the brush along with it, so what is under
 * its centre goes the whole way, as clay does under a thumb.
 *
 * Returns the marks bent, by id, as new marks: those the brush never reached,
 * and those Liquify leaves alone ({@link liquifiable}), are not in it.
 */
export function liquifyMarks(strokes: readonly Stroke[], dabs: readonly LiquifyDab[], options: LiquifyOptions = {}): Map<string, Stroke> {
  const tolerance = options.tolerance ?? WARP_TOLERANCE;
  const bent = new Map<string, Stroke>();
  const marks = strokes.filter(liquifiable);
  for (const dab of dabs) {
    if (!(dab.radius > 0)) continue;
    for (const piece of stepsOf(dab)) {
      const field = liquifyField(piece);
      for (const mark of marks) {
        const current = bent.get(mark.id) ?? mark;
        if (!liquifyReaches(current, piece)) continue;
        const next = bendStroke(current, field, tolerance);
        if (next) bent.set(mark.id, next);
      }
    }
  }
  if (options.refit !== undefined) {
    const before = new Map(marks.map((mark) => [mark.id, mark]));
    for (const [id, mark] of bent) bent.set(id, refitLiquified(mark, options.refit, before.get(id)));
  }
  return bent;
}

/** The longest push a single step takes, as a share of the radius. */
const PUSH_STEP = 0.25;
/** The widest turn a single step takes, in degrees. */
const TURN_STEP = 15;

/** A dab as steps small enough for the carrier to follow faithfully. */
function stepsOf(dab: LiquifyDab): LiquifyDab[] {
  if (dab.mode === 'warp') {
    const dx = dab.dx ?? 0;
    const dy = dab.dy ?? 0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (PUSH_STEP * dab.radius)));
    if (n === 1) return [dab];
    // The brush rides along the push, so each step pushes from where the last left it.
    return Array.from({ length: n }, (_, k) => ({ ...dab, x: dab.x + (dx * k) / n, y: dab.y + (dy * k) / n, dx: dx / n, dy: dy / n }));
  }
  if (dab.mode === 'twirl') {
    const amount = dab.amount ?? 0;
    const n = Math.max(1, Math.ceil(Math.abs(amount) / TURN_STEP));
    return n === 1 ? [dab] : Array.from({ length: n }, () => ({ ...dab, amount: amount / n }));
  }
  return [dab];
}

/** Whether any part of a mark's outline lies inside a dab's brush - a pencil mark's too, which Liquify leaves alone. */
export function liquifyReaches(stroke: Stroke, dab: LiquifyDab): boolean {
  const pts = stroke.points;
  const r = dab.radius;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX >= dab.x + r || maxX <= dab.x - r || minY >= dab.y + r || maxY <= dab.y - r) return false;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (Math.hypot(a.x - dab.x, a.y - dab.y) < r) return true;
    const b = pts[i + 1];
    if (b && !b.move && segmentDistance(dab, a, b) < r) return true;
  }
  // A closed path's last side runs back to its first point.
  if (stroke.vector?.closed === true && pts.length > 2 && segmentDistance(dab, pts[pts.length - 1], pts[0]) < r) return true;
  return false;
}

/** How far a point is from a segment. */
function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/**
 * A mark's outline as anchors to bend: its own, or, for a mark that has only
 * points - a drawn rectangle or ellipse, or an older freehand stroke - its
 * points as corners, each with its pressure, so a straight side the brush
 * bends becomes a curve. A polyline whose last point is its first is closed.
 */
function outlineOf(stroke: Stroke): NonNullable<Stroke['vector']> | null {
  if (stroke.vector && stroke.vector.anchors.length >= 2) return stroke.vector;
  const pts = stroke.points;
  if (pts.length < 2) return null;
  const compound = pts.some((p, i) => i > 0 && p.move);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = !compound && pts.length > 3 && first.x === last.x && first.y === last.y;
  const body = closed ? pts.slice(0, -1) : pts;
  const anchors: VectorAnchor[] = body.map((p, i) => ({
    p: { x: p.x, y: p.y },
    ...(i > 0 && p.move ? { move: true as const } : {}),
    ...(p.pressure !== undefined ? { pressure: p.pressure } : {}),
  }));
  return closed ? { anchors, closed: true } : { anchors };
}

/** A mark bent by one field, or null when the field moved none of it. */
function bendStroke(stroke: Stroke, field: PointMap, tolerance: number): Stroke | null {
  const outline = outlineOf(stroke);
  if (!outline) return null;
  const carried = mapStrokeGeometry(stroke.vector === outline ? stroke : { ...stroke, vector: outline }, field, tolerance);
  if (!carried.vector || !anchorsMoved(outline.anchors, carried.vector.anchors)) return null;
  const next: Stroke = { ...stroke, points: carried.points, vector: carried.vector };
  if (carried.nibAngle !== undefined) next.nibAngle = carried.nibAngle;
  if (carried.smudges) next.smudges = carried.smudges;
  return next;
}

/** Whether a carried path differs from the one it was carried from. */
function anchorsMoved(before: readonly VectorAnchor[], after: readonly VectorAnchor[]): boolean {
  if (before.length !== after.length) return true;
  const same = (a: Vec | undefined, b: Vec | undefined): boolean => (a === undefined ? b === undefined : b !== undefined && a.x === b.x && a.y === b.y);
  return before.some((a, i) => !same(a.p, after[i].p) || !same(a.hIn, after[i].hIn) || !same(a.hOut, after[i].hOut));
}

/** A straight piece at least this many tolerances long may be a line someone meant (see {@link refitLiquified}). */
const MEANT_LINE = 8;
/** Pieces that meet at a turn sharper than this, in radians, meet at a corner. */
const CORNER_TURN = (25 * Math.PI) / 180;

/**
 * A bent mark fitted again (`fitCurve`) within `tolerance`, when that takes
 * fewer anchors than the bending left - each split a dab made is an anchor,
 * and a drag makes many. Corners stay corners and a stylus's pressure is
 * kept; a compound path, which the fitter does not take, and a mark that
 * fits no smaller, come back as they are.
 *
 * A straight piece someone meant - long against the tolerance, and meeting a
 * corner, an end or a curve - is kept exactly, and only the runs between such
 * pieces are fitted, so a rectangle dented on one side keeps its other sides,
 * and the straight parts of the dented one, dead straight. The short chords
 * of a drawn ellipse, which meet each other at gentle turns, are a curve's,
 * and are fitted with the rest.
 *
 * Given the mark as it was before the drag, a path that had anchors of its
 * own and gained none - bent, but never split - is left as the bending left
 * it, so a Vector Path nudged by the brush keeps the anchors it was drawn
 * with. A mark that had only points is always fitted.
 */
export function refitLiquified(stroke: Stroke, tolerance: number, before?: Stroke): Stroke {
  const vector = stroke.vector;
  if (!vector || vector.anchors.length < 3 || vector.anchors.some((a) => a.move) || !(tolerance > 0)) return stroke;
  if (before?.vector && before.vector.anchors.length >= 2 && vector.anchors.length <= before.vector.anchors.length) return stroke;
  const closed = vector.closed === true;
  const pressured = vector.anchors.some((a) => a.pressure !== undefined);
  const kept = meantLines(vector.anchors, closed, tolerance);
  const anchors = kept.includes(true)
    ? fitBetweenLines(vector.anchors, closed, kept, tolerance, pressured)
    : fitCurve(denseSamples(vector.anchors, closed, tolerance, pressured), { tolerance, closed });
  if (!anchors || anchors.length >= vector.anchors.length) return stroke;
  return { ...stroke, vector: { ...vector, anchors }, points: sampleVectorPathPoints(anchors, closed) };
}

/** Each segment of a path - from anchor i to the next - and whether it is a straight piece someone meant. */
function meantLines(anchors: readonly VectorAnchor[], closed: boolean, tolerance: number): boolean[] {
  const count = closed ? anchors.length : anchors.length - 1;
  const segment = (i: number): Segment => [anchors[i], anchors[(i + 1) % anchors.length]];
  const straight = Array.from({ length: count }, (_, i) => isStraight(segment(i)));
  const beside = (i: number): number | null => (closed ? (i + count) % count : i >= 0 && i < count ? i : null);
  return straight.map((line, i) => {
    if (!line) return false;
    const [from, to] = segment(i);
    if (dist(from.p, to.p) < MEANT_LINE * tolerance) return false;
    const prev = beside(i - 1);
    const next = beside(i + 1);
    // An end, a curve or a corner beside it: no chord of a sampled curve.
    if (prev === null || next === null || !straight[prev] || !straight[next]) return true;
    return turnBetween(segment(prev), segment(i)) >= CORNER_TURN || turnBetween(segment(i), segment(next)) >= CORNER_TURN;
  });
}

type Segment = [VectorAnchor, VectorAnchor];

/** Whether a segment is drawn straight: no handles, or both on its chord. */
function isStraight([from, to]: Segment): boolean {
  const dx = to.p.x - from.p.x;
  const dy = to.p.y - from.p.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return false;
  const onChord = (h: Vec | undefined): boolean => {
    if (!h) return true;
    const across = Math.abs(dx * (h.y - from.p.y) - dy * (h.x - from.p.x)) / Math.sqrt(length2);
    const along = ((h.x - from.p.x) * dx + (h.y - from.p.y) * dy) / length2;
    return across <= 1e-9 * (1 + Math.sqrt(length2)) && along >= -1e-9 && along <= 1 + 1e-9;
  };
  return onChord(from.hOut) && onChord(to.hIn);
}

/** How sharply a path turns where one segment meets the next, in radians. */
function turnBetween([a0, a1]: Segment, [b0, b1]: Segment): number {
  const arriving = direction(a1.hIn ?? a1.p, a1.p, a0.hOut ?? a0.p) ?? direction(a0.p, a1.p);
  const leaving = direction(b0.p, b0.hOut ?? b0.p, b1.hIn ?? b1.p) ?? direction(b0.p, b1.p);
  if (!arriving || !leaving) return Math.PI;
  return Math.acos(Math.min(1, Math.max(-1, arriving.x * leaving.x + arriving.y * leaving.y)));
}

/** The unit direction from `a` to `b`, or, when they meet, from `a` to `fallback`; null when all meet. */
function direction(a: Vec, b: Vec, fallback?: Vec): Vec | null {
  for (const to of fallback ? [b, fallback] : [b]) {
    const length = dist(a, to);
    if (length > 1e-9) return { x: (to.x - a.x) / length, y: (to.y - a.y) / length };
  }
  return null;
}

/**
 * A path with its meant lines kept as lines and each run of other segments
 * between them fitted on its own, where that takes fewer anchors than the
 * run had. A closed path is walked from the start of a kept line, so no run
 * goes round its seam.
 */
function fitBetweenLines(anchors: readonly VectorAnchor[], closed: boolean, kept: readonly boolean[], tolerance: number, pressured: boolean): VectorAnchor[] {
  const n = anchors.length;
  const count = kept.length;
  const first = closed ? kept.indexOf(true) : 0;
  const at = (k: number): VectorAnchor => anchors[(first + k) % n];
  const keeps = (k: number): boolean => kept[(first + k) % count];
  const out: VectorAnchor[] = [{ ...at(0) }];
  let k = 0;
  while (k < count) {
    const last = out[out.length - 1];
    if (keeps(k)) {
      delete last.hOut;
      const end: VectorAnchor = { ...at(k + 1) };
      delete end.hIn;
      out.push(end);
      k++;
      continue;
    }
    let e = k;
    while (e < count && !keeps(e)) e++;
    const run = Array.from({ length: e - k + 1 }, (_, j) => at(k + j));
    const fitted = run.length > 2 ? fitCurve(denseSamples(run, false, tolerance, pressured), { tolerance }) : null;
    const pieces = fitted && fitted.length >= 2 && fitted.length < run.length ? fitted : run;
    if (pieces[0].hOut) last.hOut = { ...pieces[0].hOut };
    else delete last.hOut;
    for (const inner of pieces.slice(1, -1)) out.push({ ...inner, ...(inner.hIn ? { hIn: { ...inner.hIn } } : {}), ...(inner.hOut ? { hOut: { ...inner.hOut } } : {}) });
    const end: VectorAnchor = { ...at(e) };
    const arriving = pieces[pieces.length - 1].hIn;
    if (arriving) end.hIn = { ...arriving };
    else delete end.hIn;
    out.push(end);
    k = e;
  }
  // Round a closed path, the walk ends where it began: its last anchor is its first.
  if (closed) {
    const seam = out.pop()!;
    if (seam.hIn) out[0].hIn = seam.hIn;
    else delete out[0].hIn;
  }
  return out;
}

/** The most samples one segment gets for a refit. */
const MAX_SEGMENT_SAMPLES = 2048;

/**
 * A path's points no further apart than `spacing` along it, straight sides
 * included, so the fit is held to the whole of the path and not only to its
 * ends; with pressure where the anchors have it.
 */
function denseSamples(anchors: readonly VectorAnchor[], closed: boolean, spacing: number, pressured: boolean): Point[] {
  const start = anchors[0];
  const out: Point[] = [{ x: start.p.x, y: start.p.y, ...(pressured ? { pressure: start.pressure ?? 0.5 } : {}) }];
  const segment = (from: VectorAnchor, to: VectorAnchor): void => {
    const c1 = from.hOut ?? from.p;
    const c2 = to.hIn ?? to.p;
    const length = (dist(from.p, c1) + dist(c1, c2) + dist(c2, to.p) + dist(from.p, to.p)) / 2;
    const n = Math.min(MAX_SEGMENT_SAMPLES, Math.max(1, Math.ceil(length / spacing)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const at = cubicAt(from.p, c1, c2, to.p, t);
      out.push({ x: at.x, y: at.y, ...(pressured ? { pressure: fittedPressureAt(from, to, t) ?? 0.5 } : {}) });
    }
  };
  for (let i = 1; i < anchors.length; i++) segment(anchors[i - 1], anchors[i]);
  if (closed) segment(anchors[anchors.length - 1], start);
  return out;
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function cubicAt(p0: Vec, c1: Vec, c2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x, y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y };
}
