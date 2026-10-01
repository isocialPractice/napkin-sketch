/**
 * Freehand samples as the fewest cubic Béziers that stay within a tolerance
 * of every one of them.
 *
 * A pen stroke arrives as a sample every three quarters of a screen pixel:
 * 150 to 400 points for a stroke across the page, each one an anchor Direct
 * Select had to show. Schneider's algorithm ("An Algorithm for Automatically
 * Fitting Digitized Curves", Graphics Gems, 1990) turns those into a handful
 * of cubics: parameters by chord length, a least-squares cubic whose end
 * tangents are fixed, a few Newton-Raphson passes that move each sample's
 * parameter to its nearest point on the curve, and, when the fit is still
 * wide of a sample, a split at the worst one with a single tangent through
 * the split, so the two halves meet smoothly.
 *
 * Three things are added to it here. Corners are found first - a turn of more
 * than 45 degrees over a short run of arc length - and each run between them
 * is fitted on its own, so a drawn corner stays a corner rather than being
 * rounded into the curves either side. Pressure is part of the stroke: each
 * anchor carries the pressure at its place, the points sampled back from the
 * anchors interpolate it, and a cubic is split wherever the pressure strays
 * from that straight run by more than a tolerance, so a stylus's swell
 * survives. And a straight piece - a run its chord alone stays within the
 * tolerance of, or a cubic whose handles lie on its chord to within a
 * fraction of it - is written as a line, with no handles, as the
 * vector-graphics standard asks.
 *
 * Measured in Phase 0 of the 1.0.0-alpha.4.5.1 plan: a 222-sample pen stroke
 * fits in 13 anchors at 1.5 pixels.
 *
 * Nothing here touches the DOM.
 */

import type { Point, VectorAnchor } from './types.js';

type Vec = { x: number; y: number };
type Cubic = [Vec, Vec, Vec, Vec];

export interface FitOptions {
  /** How far the curves may stray from any sample, in the samples' units. */
  tolerance: number;
  /** How far pressure may stray from its straight run between two anchors, on its 0 to 1 scale. */
  pressureTolerance?: number;
  /** The samples go round a loop whose ends meet: the seam is smooth unless it is a corner. */
  closed?: boolean;
}

/** A pen's pressure changes a pen line's width by 0.6 of its range, so 0.1 of it is 6% of the width. */
export const DEFAULT_PRESSURE_TOLERANCE = 0.1;

/** A turn sharper than this over a short run of arc length is a corner. */
const CORNER_ANGLE = Math.PI / 4;

/** A piece whose handles stand off its chord by less than this share of the tolerance is a line. */
const STRAIGHT_SHARE = 0.25;

/** How many Newton-Raphson passes a nearly good fit gets before it is split. */
const REPARAMETERISE_PASSES = 20;

interface Sample extends Vec {
  pressure?: number;
}

/** One fitted cubic and the samples it runs between; a straight one is a line and loses its handles. */
interface Piece {
  c: Cubic;
  first: number;
  last: number;
  straight: boolean;
}

/**
 * The anchors of the fewest cubics within `tolerance` of every sample, each
 * with the pressure at its place. Null when there is nothing to fit: fewer
 * than two distinct samples, or a compound path (a `move` point), whose
 * contours a freehand stroke never has. For a closed loop the seam's anchor
 * is the first, holding both its handles, and the caller marks the path
 * closed.
 */
export function fitCurve(points: readonly Point[], options: FitOptions): VectorAnchor[] | null {
  if (points.some((p) => p.move)) return null;
  const tol = Math.max(1e-6, options.tolerance);
  const pressureTol = options.pressureTolerance ?? DEFAULT_PRESSURE_TOLERANCE;
  const d: Sample[] = [];
  for (const p of points) {
    const last = d[d.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= 1e-6) continue;
    d.push({ x: p.x, y: p.y, ...(p.pressure !== undefined ? { pressure: p.pressure } : {}) });
  }
  if (d.length < 2) return null;

  const closed = options.closed === true && d.length > 3 && dist(d[0], d[d.length - 1]) <= Math.max(tol, 1e-6);
  if (closed) d[d.length - 1] = { ...d[d.length - 1], x: d[0].x, y: d[0].y };
  const span = Math.max(2 * tol, 3);
  const cuts = [0, ...corners(d, Math.max(4 * tol, 6)), d.length - 1];

  // The seam of a loop leaves and arrives along one tangent, unless it is a corner.
  let seamOut: Vec | null = null;
  if (closed) {
    const out = tangent(d, 0, 1, span, d.length - 1);
    const back = tangent(d, d.length - 1, -1, span, 0);
    if (Math.acos(clamp(dot(out, mul(back, -1)), -1, 1)) <= CORNER_ANGLE) seamOut = unit(sub(out, back));
  }

  const pieces: Piece[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const first = cuts[k];
    const last = cuts[k + 1];
    if (last <= first) continue;
    const t1 = k === 0 && seamOut ? seamOut : tangent(d, first, 1, span, last);
    const t2 = k === cuts.length - 2 && seamOut ? mul(seamOut, -1) : tangent(d, last, -1, span, first);
    fitRun(d, first, last, t1, t2, tol, pressureTol, pieces);
  }
  return anchorsOf(d, pieces, closed);
}

/**
 * The pressure at `t` along the piece from one anchor to the next, running
 * evenly from the one's to the other's, as the fit measured it. Undefined
 * when neither anchor has one, as a Vector Path's anchors do not: the points
 * sampled from those keep the mouse's 0.5.
 */
export function fittedPressureAt(from: VectorAnchor, to: VectorAnchor, t: number): number | undefined {
  if (from.pressure === undefined && to.pressure === undefined) return undefined;
  const a = from.pressure ?? to.pressure ?? 0.5;
  const b = to.pressure ?? a;
  // Weighted so each end comes out exactly its own anchor's.
  return a * (1 - t) + b * t;
}

// ---- Fitting one run between corners ----------------------------------------------

function fitRun(d: Sample[], first: number, last: number, t1: Vec, t2: Vec, tol: number, pressureTol: number, out: Piece[]): void {
  // Split at a sample, with one tangent through it, so the halves meet smoothly.
  const split = (at: number): void => {
    const centre = unit(sub(d[Math.max(first, at - 1)], d[Math.min(last, at + 1)]));
    fitRun(d, first, at, t1, centre, tol, pressureTol, out);
    fitRun(d, at, last, mul(centre, -1), t2, tol, pressureTol, out);
  };
  // A run that comes back to where it began - a loop with no corner - has no
  // chord for a cubic to span: one would start and end on the seam, two
  // anchors in one place. It is split at the sample furthest out.
  if (last - first >= 2 && dist(d[first], d[last]) <= 1e-9) {
    let far = first + 1;
    for (let i = far + 1; i < last; i++) if (dist(d[i], d[first]) > dist(d[far], d[first])) far = i;
    split(far);
    return;
  }
  // Two samples, or a run the chord alone stays within the tolerance of: a
  // line, the fewest numbers that draw it.
  let u = chordParams(d, first, last);
  if (last - first === 1 || chordFits(d, first, last, tol)) {
    const worst = last - first === 1 ? null : pressureWorst(d, first, last, u, pressureTol);
    if (worst === null) {
      out.push({ c: lineCubic(d[first], d[last]), first, last, straight: true });
      return;
    }
    const along = unit(sub(d[first], d[last]));
    fitRun(d, first, worst, t1, along, tol, pressureTol, out);
    fitRun(d, worst, last, mul(along, -1), t2, tol, pressureTol, out);
    return;
  }
  let c = generate(d, first, last, u, t1, t2);
  let { err, at } = maxError(d, first, last, c, u);
  if (err > tol && err < tol * 4) {
    for (let k = 0; k < REPARAMETERISE_PASSES && err > tol; k++) {
      u = reparameterise(d, first, c, u);
      c = generate(d, first, last, u, t1, t2);
      ({ err, at } = maxError(d, first, last, c, u));
    }
  }
  if (err <= tol) {
    // Close enough in shape; is it in pressure?
    const worst = pressureWorst(d, first, last, u, pressureTol);
    if (worst === null) {
      out.push({ c, first, last, straight: isStraight(c, tol) });
      return;
    }
    at = worst;
  }
  // Split where the fit is worst.
  if (at <= first || at >= last) at = Math.floor((first + last) / 2);
  split(at);
}

/** The sample whose pressure strays furthest from the straight run between the run's ends, if it strays past the tolerance. */
function pressureWorst(d: Sample[], first: number, last: number, u: number[], pressureTol: number): number | null {
  const p0 = d[first].pressure;
  const p1 = d[last].pressure;
  if (p0 === undefined && p1 === undefined) return null;
  const a = p0 ?? 0.5;
  const b = p1 ?? a;
  let worst = pressureTol;
  let at: number | null = null;
  for (let i = first + 1; i < last; i++) {
    const p = d[i].pressure;
    if (p === undefined) continue;
    const off = Math.abs(p - (a + (b - a) * u[i - first]));
    if (off > worst) {
      worst = off;
      at = i;
    }
  }
  return at;
}

/** Whether every sample of the run lies within the tolerance of the chord between its ends. */
function chordFits(d: Sample[], first: number, last: number, tol: number): boolean {
  const a = d[first];
  const b = d[last];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  for (let i = first + 1; i < last; i++) {
    const p = d[i];
    const t = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) > tol) return false;
  }
  return true;
}

/** A line as a cubic, its handles a third of the way along. */
function lineCubic(a: Vec, b: Vec): Cubic {
  const third = mul(sub(b, a), 1 / 3);
  return [a, add(a, third), sub(b, third), b];
}

/** Parameters by chord length: each sample's share of the run's length so far. */
function chordParams(d: Sample[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + dist(d[i], d[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

/**
 * The least-squares cubic through the run's ends with its handles along the
 * given tangents: only the two handle lengths are free. A length that comes
 * out negative or nearly nothing - a handle on its own anchor, which leaves
 * the tangent undefined - falls back to a third of the chord, and so does
 * one longer than the whole run: with few samples and tangents nearly in
 * line the system is all but singular, and its answer a loop thousands of
 * pixels out that still passes through the samples.
 */
function generate(d: Sample[], first: number, last: number, u: number[], t1: Vec, t2: Vec): Cubic {
  const p0 = d[first];
  const p3 = d[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(d[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const seg = dist(p0, p3);
  const eps = 1e-6 * seg;
  let run = 0;
  for (let i = first + 1; i <= last; i++) run += dist(d[i], d[i - 1]);
  if (al < eps || ar < eps || al > run || ar > run) al = ar = seg / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

/**
 * How far the cubic is from the run's samples at their parameters, and where
 * it is furthest - and from the straight line between each two samples, at
 * its quarters, so a cubic that strays between samples far apart (the
 * straight sides of a polygon) is not taken for a fit.
 */
function maxError(d: Sample[], first: number, last: number, c: Cubic, u: number[]): { err: number; at: number } {
  let err = 0;
  let at = Math.floor((last - first + 1) / 2) + first;
  for (let i = 1; i < u.length; i++) {
    if (i < u.length - 1) {
      const e = dist(bezier(c, u[i]), d[first + i]);
      if (e > err) {
        err = e;
        at = first + i;
      }
    }
    for (const q of BETWEEN) {
      const between = segmentDistance(bezier(c, u[i - 1] + (u[i] - u[i - 1]) * q), d[first + i - 1], d[first + i]);
      if (between > err) {
        err = between;
        // Split at whichever end of the gap is inside the run.
        at = i - 1 > 0 ? first + i - 1 : first + i;
      }
    }
  }
  return { err, at };
}

/** Where between two samples a fit is measured against the straight line joining them. */
const BETWEEN = [0.25, 0.5, 0.75];

/** The distance from `p` to the segment from `a` to `b`. */
function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return dist(p, add(a, mul(ab, t)));
}

/** One Newton-Raphson step for every sample: its parameter moved toward its nearest point on the curve. */
function reparameterise(d: Sample[], first: number, c: Cubic, u: number[]): number[] {
  return u.map((t, i) => {
    const q = bezier(c, t);
    const q1 = bezierD1(c, t);
    const q2 = bezierD2(c, t);
    const diff = sub(q, d[first + i]);
    const den = dot(q1, q1) + dot(diff, q2);
    if (den === 0) return t;
    return clamp(t - dot(diff, q1) / den, 0, 1);
  });
}

/**
 * The tangent leaving `d[i]` toward `step` (+1 or -1), measured to the first
 * sample `span` away rather than the next one, so the jitter between samples
 * does not steer it.
 */
function tangent(d: Sample[], i: number, step: 1 | -1, span: number, stop: number): Vec {
  let j = i + step;
  while (j !== stop && dist(d[i], d[j]) < span) j += step;
  return unit(sub(d[j], d[i]));
}

/**
 * The corners: samples where the chord arriving over `window` of arc length
 * turns from the chord leaving over the same length by more than 45 degrees,
 * keeping only the sharpest turn within a window either side, so one corner
 * is one sample however many of its neighbours turn too.
 */
function corners(d: Sample[], window: number): number[] {
  const s: number[] = [0];
  for (let i = 1; i < d.length; i++) s.push(s[i - 1] + dist(d[i], d[i - 1]));
  const total = s[s.length - 1];
  const turn = new Float64Array(d.length);
  let a = 0;
  let b = 0;
  for (let i = 1; i < d.length - 1; i++) {
    if (s[i] < window / 2 || total - s[i] < window / 2) continue;
    while (a < i && s[i] - s[a + 1] >= window) a++;
    if (b < i) b = i;
    while (b < d.length - 1 && s[b] - s[i] < window) b++;
    const din = unit(sub(d[i], d[a]));
    const dout = unit(sub(d[b], d[i]));
    turn[i] = Math.acos(clamp(dot(din, dout), -1, 1));
  }
  const out: number[] = [];
  for (let i = 1; i < d.length - 1; i++) {
    if (turn[i] <= CORNER_ANGLE) continue;
    let sharpest = true;
    for (let j = i - 1; j >= 0 && s[i] - s[j] < window; j--) if (turn[j] > turn[i]) sharpest = false;
    for (let j = i + 1; j < d.length && s[j] - s[i] < window; j++) if (turn[j] >= turn[i]) sharpest = false;
    if (sharpest) out.push(i);
  }
  return out;
}

// ---- Pieces to anchors ----------------------------------------------------------------------

/**
 * The pieces joined into a path's anchors: one for every place two pieces
 * meet, each with the handle arriving and the handle leaving, and the
 * pressure of its sample. A straight piece has no handles: it is a line.
 */
function anchorsOf(d: Sample[], pieces: Piece[], closed: boolean): VectorAnchor[] {
  const pressure = (i: number): Pick<VectorAnchor, 'pressure'> => (d[i].pressure !== undefined ? { pressure: d[i].pressure } : {});
  const anchors: VectorAnchor[] = [];
  pieces.forEach((piece, k) => {
    const [p0, c1, c2, p3] = piece.c;
    const straight = piece.straight;
    if (k === 0) anchors.push({ p: xy(p0), ...(straight ? {} : { hOut: xy(c1) }), ...pressure(piece.first) });
    else if (!straight) anchors[anchors.length - 1].hOut = xy(c1);
    anchors.push({ p: xy(p3), ...(straight ? {} : { hIn: xy(c2) }), ...pressure(piece.last) });
  });
  if (closed && anchors.length > 2) {
    // The last anchor is the seam again: its arriving handle belongs to the first.
    const seam = anchors.pop()!;
    if (seam.hIn) anchors[0].hIn = seam.hIn;
  }
  return anchors;
}

/** Whether a cubic's handles lie on its chord, between its ends, to within a share of the tolerance. */
function isStraight(c: Cubic, tol: number): boolean {
  const [p0, c1, c2, p3] = c;
  const chord = sub(p3, p0);
  const length = len(chord);
  if (length <= 1e-9) return false;
  const dir = mul(chord, 1 / length);
  const within = (h: Vec): boolean => {
    const rel = sub(h, p0);
    const along = dot(rel, dir);
    const off = Math.abs(rel.x * dir.y - rel.y * dir.x);
    return off <= tol * STRAIGHT_SHARE && along >= -1e-9 && along <= length + 1e-9;
  };
  return within(c1) && within(c2);
}

// ---- Vectors and Béziers ------------------------------------------------------------------

function bezier(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const e = 3 * mt * t * t;
  const f = t * t * t;
  return { x: a * c[0].x + b * c[1].x + e * c[2].x + f * c[3].x, y: a * c[0].y + b * c[1].y + e * c[2].y + f * c[3].y };
}

function bezierD1(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * mt * mt), mul(sub(c[2], c[1]), 6 * mt * t)), mul(sub(c[3], c[2]), 3 * t * t));
}

function bezierD2(c: Cubic, t: number): Vec {
  return add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));
}

const xy = (a: Vec): Vec => ({ x: a.x, y: a.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function unit(a: Vec): Vec {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
}
