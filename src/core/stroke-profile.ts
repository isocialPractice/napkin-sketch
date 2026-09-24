/**
 * Stroke profiles: how a stroke's width runs along its length.
 *
 * A profile is a pair of functions of `t`, the distance along a stroke as a
 * fraction of its length: how far the outline sits from the path on the
 * traveller's left, and on the right, each as a fraction of half the stroke's
 * width. Default is 1 on both sides everywhere - the constant line every
 * stroke had before profiles. The other three were measured from the drawings
 * that specified them (`feature-strokeProfiles.svg`, each shape rendered at 4x
 * and its thickness read column by column) rather than described by eye:
 *
 * - **Rounded** is sin(πt): a lens, pointed at both ends. The drawing matches
 *   it to within 3% at every sample.
 * - **Tapered** is 1 − 0.7·t^1.6 with round ends: full width at the start,
 *   narrowing to 0.3 of it. Within 0.04 of the drawing.
 * - **Wave** is a table, and the only asymmetric one: its band snakes about
 *   the path as well as swelling, so each side has its own width.
 *
 * A variable-width outline cannot be a stroke - neither the canvas nor SVG
 * has one - so a profiled stroke is drawn and exported as the filled shape it
 * is. There are two constructions of that shape here, and a test rasterizes
 * both and holds them to the same pixels:
 *
 * - {@link profilePieces}, for the canvas: convex pieces all wound the same
 *   way, merged by one non-zero fill. Overlaps merge rather than darken, and
 *   nothing ever has to work out where the outline crosses itself.
 * - {@link profileOutline}, for export: the same shape as clean contours an
 *   SVG path or a PDF fill can carry.
 */

import {
  dashPatternFor,
  type Point,
  type Stroke,
  type StrokeProfile,
} from './types.js';
import { clockwise, disc, signedArea } from './graphic-design/geometry.js';

type Vec = { x: number; y: number };

/**
 * Where a profiled outline sits at one place along its stroke: each side's
 * distance from the path, as a fraction of half the stroke's width.
 */
export interface ProfileSides {
  left: number;
  right: number;
}

/** The names the Stroke Profile list and the Properties panel show. */
export const STROKE_PROFILE_LABELS: Record<StrokeProfile, string> = {
  uniform: 'Default',
  rounded: 'Rounded',
  tapered: 'Tapered',
  wave: 'Wave',
};

// ---- The profiles ---------------------------------------------------------------

/**
 * Wave, measured every tenth of the way along, left being the traveller's
 * left. Values above 1 are the band leaning to that side; its total width
 * stays within the stroke's.
 */
const WAVE_LEFT = [0, 0.78, 1.03, 0.87, 0.45, 0.39, 0.79, 1.16, 1.06, 0.63, 0];
const WAVE_RIGHT = [0, 0.4, 0.7, 1.09, 1.46, 1.46, 1.16, 0.69, 0.4, 0.22, 0];
const WAVE_STEP = 0.1;
const WAVE_LEFT_SLOPES = monotoneSlopes(WAVE_LEFT, WAVE_STEP);
const WAVE_RIGHT_SLOPES = monotoneSlopes(WAVE_RIGHT, WAVE_STEP);

/** A profile's two sides at `t`, the distance along the stroke as a fraction of its length. */
export function profileSides(profile: StrokeProfile | undefined, t: number): ProfileSides {
  const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  switch (profile) {
    case 'rounded': {
      const w = Math.sin(Math.PI * at);
      return { left: w, right: w };
    }
    case 'tapered': {
      const w = 1 - 0.7 * at ** 1.6;
      return { left: w, right: w };
    }
    case 'wave':
      return {
        left: monotoneAt(WAVE_LEFT, WAVE_LEFT_SLOPES, WAVE_STEP, at),
        right: monotoneAt(WAVE_RIGHT, WAVE_RIGHT_SLOPES, WAVE_STEP, at),
      };
    default:
      return { left: 1, right: 1 };
  }
}

/**
 * True for a profile whose two sides match, so a mirror image of a stroke
 * drawn with it needs nothing swapped. Wave is the one that leans.
 */
export function profileIsSymmetric(profile: StrokeProfile | undefined): boolean {
  return profile !== 'wave';
}

/** The furthest either side of a profile reaches, in halves of the stroke width. */
export function profileReach(profile: StrokeProfile | undefined): number {
  return profile === 'wave' ? Math.max(...WAVE_LEFT, ...WAVE_RIGHT) : 1;
}

/**
 * True for a stroke whose outline a profile can shape: pen and marker marks,
 * which covers every shape, curve and path the app draws. A Copic stroke's
 * nib is its width, and text, images and erasers have no outline to shape.
 */
export function profileApplies(stroke: Stroke): boolean {
  return stroke.tool === 'pen' || stroke.tool === 'marker';
}

/** The profile a stroke is drawn with, when it has one that shapes its outline. */
export function activeProfile(stroke: Stroke): Exclude<StrokeProfile, 'uniform'> | undefined {
  return stroke.profile && profileApplies(stroke) && stroke.points.length > 1
    ? stroke.profile
    : undefined;
}

/**
 * Fritsch-Carlson slopes for evenly spaced stops. The Hermite cubic through
 * the stops with these tangents never overshoots one, so a side measured at
 * zero never dips below it between measurements.
 */
function monotoneSlopes(ys: number[], step: number): number[] {
  const n = ys.length;
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / step);
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[k] = tau * a * d[k];
      m[k + 1] = tau * b * d[k];
    }
  }
  return m;
}

function monotoneAt(ys: number[], ms: number[], step: number, t: number): number {
  const k = Math.min(ys.length - 2, Math.floor(t / step));
  const s = (t - k * step) / step;
  const s2 = s * s;
  const s3 = s2 * s;
  const value =
    (2 * s3 - 3 * s2 + 1) * ys[k] +
    (s3 - 2 * s2 + s) * step * ms[k] +
    (-2 * s3 + 3 * s2) * ys[k + 1] +
    (s3 - s2) * step * ms[k + 1];
  return Math.max(0, value);
}

// ---- What an outline is built from ----------------------------------------------

/** A stroke's path, width and profile: everything its outline depends on. */
export interface ProfileInput {
  /** Samples along the path; `move` starts a subpath. */
  points: Point[];
  /** The stroke's width: a side at 1 sits half of this from the path. */
  width: number;
  profile: StrokeProfile | undefined;
  /** Every subpath closes on itself: no caps, and the profile runs once round. */
  closed: boolean;
  /** Width follows pen pressure the way the painter's line does: 0.4 + 0.6 × pressure. */
  pressure: boolean;
  /** Dash and gap lengths as `dashPatternFor` gives them; empty for a solid line. */
  dash: number[];
  /** The two sides swapped, for a stroke that is a mirror image (`Stroke.profileMirrored`). */
  mirrored?: boolean;
}

/**
 * The outline input for a stroke, read the way the painter reads it. A shape
 * whose last sample lands back on its first - a rectangle or an ellipse from
 * the shape tools - closes, so its seam is a join rather than two caps.
 */
export function profileInputOf(stroke: Stroke): ProfileInput {
  const pts = stroke.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const rejoins =
    pts.length > 2 &&
    !pts.some((p) => p.move) &&
    Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
  return {
    points: pts,
    width: stroke.width,
    profile: activeProfile(stroke),
    closed: stroke.vector?.closed === true || rejoins,
    pressure: stroke.tool !== 'marker',
    dash: dashPatternFor(stroke.strokeStyle, stroke.width),
    mirrored: stroke.profileMirrored === true,
  };
}

/**
 * One subpath, ready to outline: its vertices, each side's width at each in
 * pixels, and - for a closed subpath - the widths where it arrives back at
 * its start (t = 1), which differ from where it left (t = 0) for every
 * profile but Default. A lone vertex (a dot, or a zero-length dash) carries
 * the direction of the path it sat on, so a leaning band can still lean.
 */
interface Frame {
  pts: Vec[];
  left: number[];
  right: number[];
  closed: boolean;
  endLeft: number;
  endRight: number;
  dir?: Vec;
}

function frames(input: ProfileInput): Frame[] {
  const out: Frame[] = [];
  const half = Math.max(0, input.width) / 2;
  let run: Point[] = [];
  const flush = (): void => {
    const frame = frameOf(run, input, half);
    if (frame) out.push(frame);
    run = [];
  };
  for (const p of input.points) {
    if (p.move && run.length > 0) flush();
    run.push(p);
  }
  if (run.length > 0) flush();
  return out;
}

/**
 * How many steps a profile is sampled in along a subpath, at the least. A
 * profile is only read at the path's vertices, and a ruled line has two:
 * Rounded's two ends, both of zero width. So a run longer than this share of
 * the whole is cut into steps first. Freehand samples are already closer.
 */
const PROFILE_STEPS = 64;

function frameOf(run: Point[], input: ProfileInput, half: number): Frame | null {
  // A repeated sample makes a segment with no direction; drop it.
  const unique: Point[] = [];
  for (const p of run) {
    const prev = unique[unique.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) unique.push(p);
  }
  if (unique.length === 0) return null;
  let closed = input.closed && unique.length >= 3;
  if (closed && distance(unique[0], unique[unique.length - 1]) <= 1e-6) unique.pop();
  if (unique.length < 3) closed = false;
  const shaped = input.profile !== undefined && input.profile !== 'uniform';
  const pts = shaped ? subdivide(unique, closed, PROFILE_STEPS) : unique;

  const n = pts.length;
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + distance(pts[i - 1], pts[i]));
  const total = along[n - 1] + (closed ? distance(pts[n - 1], pts[0]) : 0);
  const scale = (p: Point): number => (input.pressure ? 0.4 + 0.6 * (p.pressure ?? 0.5) : 1);

  // A mirror image's left is the original's right.
  const sidesAt = (t: number): ProfileSides => {
    const sides = profileSides(input.profile, t);
    return input.mirrored ? { left: sides.right, right: sides.left } : sides;
  };
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const sides = sidesAt(total > 0 ? along[i] / total : 0);
    const k = half * scale(pts[i]);
    left.push(k * sides.left);
    right.push(k * sides.right);
  }
  const end = sidesAt(1);
  const k0 = half * scale(pts[0]);
  return {
    pts: pts.map((p) => ({ x: p.x, y: p.y })),
    left,
    right,
    closed,
    endLeft: k0 * end.left,
    endRight: k0 * end.right,
  };
}

/**
 * Cuts every segment longer than `1/steps` of the path's length into equal
 * steps, pressure running evenly along each. The path keeps its shape - every
 * new point lies on the segment it cuts - and only gains places for a
 * profile to be read at. A closed path's closing segment is cut too.
 */
function subdivide(pts: Point[], closed: boolean, steps: number): Point[] {
  const n = pts.length;
  if (n < 2) return pts;
  let total = 0;
  for (let i = 1; i < n; i++) total += distance(pts[i - 1], pts[i]);
  if (closed) total += distance(pts[n - 1], pts[0]);
  const step = total / steps;
  if (!(step > 0)) return pts;
  const out: Point[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push(a);
    const cuts = Math.ceil(distance(a, b) / step) - 1;
    for (let k = 1; k <= cuts; k++) {
      const u = k / (cuts + 1);
      const pressure =
        a.pressure !== undefined && b.pressure !== undefined
          ? a.pressure + (b.pressure - a.pressure) * u
          : a.pressure ?? b.pressure;
      out.push({
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        ...(pressure !== undefined ? { pressure } : {}),
      });
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * Cuts a frame into its dashes. A dash keeps the widths the whole stroke had
 * at that place, so a dashed Rounded line has thin dashes at its ends and fat
 * ones in its middle; a zero-length dash - a dot - is a single vertex.
 */
function dashFrames(frame: Frame, pattern: number[]): Frame[] {
  if (pattern.length === 0 || frame.pts.length < 2) return [frame];
  const pts = frame.closed ? [...frame.pts, frame.pts[0]] : frame.pts;
  const left = frame.closed ? [...frame.left, frame.endLeft] : frame.left;
  const right = frame.closed ? [...frame.right, frame.endRight] : frame.right;
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + distance(pts[i - 1], pts[i]));
  const total = along[along.length - 1];
  const cycle = pattern.reduce((sum, v) => sum + v, 0);
  if (total <= 0 || cycle <= 0) return [frame];

  // The place `s` along the path: its point, both widths and the direction.
  const at = (s: number): { p: Vec; l: number; r: number; dir: Vec; seg: number } => {
    let seg = 0;
    while (seg < along.length - 2 && along[seg + 1] < s) seg++;
    const span = along[seg + 1] - along[seg];
    const u = span > 0 ? Math.min(1, Math.max(0, (s - along[seg]) / span)) : 0;
    const a = pts[seg];
    const b = pts[seg + 1];
    return {
      p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u },
      l: left[seg] + (left[seg + 1] - left[seg]) * u,
      r: right[seg] + (right[seg + 1] - right[seg]) * u,
      dir: unit({ x: b.x - a.x, y: b.y - a.y }),
      seg,
    };
  };

  const out: Frame[] = [];
  for (let s = 0, k = 0; s < total; k += 2) {
    const on = pattern[k % pattern.length];
    const off = pattern[(k + 1) % pattern.length];
    const s0 = s;
    const s1 = Math.min(total, s + on);
    const start = at(s0);
    if (s1 - s0 < 1e-9) {
      out.push({
        pts: [start.p],
        left: [start.l],
        right: [start.r],
        closed: false,
        endLeft: start.l,
        endRight: start.r,
        dir: start.dir,
      });
    } else {
      const end = at(s1);
      const dash: Frame = {
        pts: [start.p],
        left: [start.l],
        right: [start.r],
        closed: false,
        endLeft: 0,
        endRight: 0,
      };
      for (let i = start.seg + 1; i <= end.seg; i++) {
        if (along[i] <= s0 || along[i] >= s1) continue;
        dash.pts.push(pts[i]);
        dash.left.push(left[i]);
        dash.right.push(right[i]);
      }
      dash.pts.push(end.p);
      dash.left.push(end.l);
      dash.right.push(end.r);
      out.push(dash);
    }
    s += on + off;
  }
  return out;
}

// ---- Shared geometry ---------------------------------------------------------------

/** One segment of a frame: its ends, their widths, its direction and left normal. */
interface Segment {
  a: Vec;
  b: Vec;
  la: number;
  ra: number;
  lb: number;
  rb: number;
  dir: Vec;
  /** The traveller's left: (dy, −dx) on the downward y axis. */
  nrm: Vec;
}

function segmentsOf(f: Frame): Segment[] {
  const out: Segment[] = [];
  const n = f.pts.length;
  const count = f.closed ? n : n - 1;
  for (let j = 0; j < count; j++) {
    const k = (j + 1) % n;
    const closing = f.closed && k === 0;
    const dir = unit({ x: f.pts[k].x - f.pts[j].x, y: f.pts[k].y - f.pts[j].y });
    out.push({
      a: f.pts[j],
      b: f.pts[k],
      la: f.left[j],
      ra: f.right[j],
      lb: closing ? f.endLeft : f.left[k],
      rb: closing ? f.endRight : f.right[k],
      dir,
      nrm: { x: dir.y, y: -dir.x },
    });
  }
  return out;
}

/**
 * The turn from one segment to the next, in radians: positive when the path
 * bends clockwise on screen, which puts the traveller's left on the outside.
 */
function turnBetween(from: Vec, to: Vec): number {
  return Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
}

/**
 * Points on an arc about `centre`, from direction `from` swept by `sweep`
 * radians, the radius running from `r0` to `r1` as it goes - a join or a cap
 * between two widths. Every point is included, the two ends too.
 */
function arc(centre: Vec, from: Vec, sweep: number, r0: number, r1: number): Vec[] {
  const start = Math.atan2(from.y, from.x);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const angle = start + sweep * u;
    const r = r0 + (r1 - r0) * u;
    out.push({ x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r });
  }
  return out;
}

/** A lone vertex's dot: a disc spanning the band there, centred on the band. */
function dotOf(f: Frame): Vec[] | null {
  const radius = (f.left[0] + f.right[0]) / 2;
  if (radius <= 1e-6) return null;
  const nrm = f.dir ? { x: f.dir.y, y: -f.dir.x } : { x: 0, y: 0 };
  const lean = (f.left[0] - f.right[0]) / 2;
  const centre = { x: f.pts[0].x + nrm.x * lean, y: f.pts[0].y + nrm.y * lean };
  return disc(centre, radius, 24);
}

/** The side a join bulges on, and the arc that fills it, at vertex `p` between two segments. */
function joinArc(p: Vec, from: Segment, to: Segment): { left: boolean; points: Vec[] } | null {
  const turn = turnBetween(from.dir, to.dir);
  if (Math.abs(turn) < 1e-9) return null;
  if (turn > 0) {
    return { left: true, points: arc(p, from.nrm, turn, from.lb, to.la) };
  }
  const back = { x: -from.nrm.x, y: -from.nrm.y };
  return { left: false, points: arc(p, back, turn, from.rb, to.ra) };
}

// ---- The canvas construction --------------------------------------------------------

/**
 * The outline as convex pieces, every one wound the same way, whose union
 * under a non-zero fill is the profiled stroke: a quad per segment between its
 * two sides, a wedge on the outside of every turn, and a rounded cap wherever
 * an end has width.
 */
export function profilePieces(input: ProfileInput): Vec[][] {
  const out: Vec[][] = [];
  for (const whole of frames(input)) {
    for (const frame of dashFrames(whole, input.dash)) piecesOf(frame, out);
  }
  return out;
}

function piecesOf(f: Frame, out: Vec[][]): void {
  if (f.pts.length === 1) {
    const dot = dotOf(f);
    if (dot) out.push(clockwise(dot));
    return;
  }
  const segs = segmentsOf(f);
  const add = (piece: Vec[]): void => {
    if (Math.abs(signedArea(piece)) > 1e-9) out.push(clockwise(piece));
  };
  for (const s of segs) {
    add([
      { x: s.a.x + s.nrm.x * s.la, y: s.a.y + s.nrm.y * s.la },
      { x: s.b.x + s.nrm.x * s.lb, y: s.b.y + s.nrm.y * s.lb },
      { x: s.b.x - s.nrm.x * s.rb, y: s.b.y - s.nrm.y * s.rb },
      { x: s.a.x - s.nrm.x * s.ra, y: s.a.y - s.nrm.y * s.ra },
    ]);
  }
  const joins = f.closed ? segs.length : segs.length - 1;
  for (let j = 0; j < joins; j++) {
    const from = segs[j];
    const to = segs[(j + 1) % segs.length];
    const join = joinArc(from.b, from, to);
    if (join) add([from.b, ...join.points]);
  }
  if (!f.closed) {
    const first = segs[0];
    const last = segs[segs.length - 1];
    const start = capArc(first.a, first, true);
    const end = capArc(last.b, last, false);
    if (start) add([first.a, ...start]);
    if (end) add([last.b, ...end]);
  }
}

/**
 * The round cap at one end of an open frame, from one side round to the
 * other: behind the start, from the right side to the left; past the end,
 * from the left side to the right. Null where the end has no width.
 */
function capArc(p: Vec, s: Segment, atStart: boolean): Vec[] | null {
  const l = atStart ? s.la : s.lb;
  const r = atStart ? s.ra : s.rb;
  if (l <= 1e-6 && r <= 1e-6) return null;
  if (atStart) return arc(p, { x: -s.nrm.x, y: -s.nrm.y }, Math.PI, r, l);
  return arc(p, s.nrm, Math.PI, l, r);
}

// ---- The export construction --------------------------------------------------------

/**
 * The outline as clean closed contours for an SVG path or a PDF fill: exactly
 * the region the canvas fills, traced as its boundary. Outer edges wind
 * clockwise and holes the other way, so the result fills the same under
 * either fill rule.
 *
 * It is built in two steps. {@link chainOf} traces a chain whose winding
 * about every point is the number of pieces covering it, so its non-zero fill
 * is the canvas's union by construction; {@link boundaryOf} then keeps only the
 * parts of that chain with fill on one side and none on the other. Tight
 * bends, curls, strokes crossing themselves and rings smaller than their own
 * width all come out right without either step having to know about them.
 */
export function profileOutline(input: ProfileInput): Vec[][] {
  const chains: Vec[][] = [];
  for (const whole of frames(input)) {
    for (const frame of dashFrames(whole, input.dash)) chains.push(...chainOf(frame));
  }
  return boundaryOf(chains) ?? chains;
}

/**
 * One frame traced the way its pieces add up. Each side runs along its
 * quads' edges; on the outside of a turn it follows the join's arc, and on
 * the inside it detours through the path's own vertex, which is where the two
 * quads meeting there stop. That detour is what makes the chain exact: every
 * other edge the pieces have is shared by two of them, runs both ways, and
 * cancels. An open frame is one contour, capped at both ends; a closed frame
 * is its left side one way round and its right side the other.
 */
function chainOf(f: Frame): Vec[][] {
  if (f.pts.length === 1) {
    const dot = dotOf(f);
    return dot ? [clockwise(dot)] : [];
  }
  const segs = segmentsOf(f);
  const left: Vec[] = [];
  const right: Vec[] = [];
  const add = (chain: Vec[], p: Vec): void => {
    const last = chain[chain.length - 1];
    if (!last || distance(last, p) > 1e-9) chain.push(p);
  };
  segs.forEach((s, j) => {
    if (j > 0 || f.closed) {
      const from = segs[(j - 1 + segs.length) % segs.length];
      const join = joinArc(s.a, from, s);
      if (join) {
        for (const p of join.points.slice(1, -1)) add(join.left ? left : right, p);
        add(join.left ? right : left, s.a);
      }
    }
    add(left, { x: s.a.x + s.nrm.x * s.la, y: s.a.y + s.nrm.y * s.la });
    add(right, { x: s.a.x - s.nrm.x * s.ra, y: s.a.y - s.nrm.y * s.ra });
    add(left, { x: s.b.x + s.nrm.x * s.lb, y: s.b.y + s.nrm.y * s.lb });
    add(right, { x: s.b.x - s.nrm.x * s.rb, y: s.b.y - s.nrm.y * s.rb });
  });
  if (f.closed) return [left, right.reverse()];
  const first = segs[0];
  const last = segs[segs.length - 1];
  const end = capArc(last.b, last, false);
  const start = capArc(first.a, first, true);
  return [
    [
      ...left,
      ...(end ? end.slice(1, -1) : []),
      ...right.reverse(),
      ...(start ? start.slice(1, -1) : []),
    ],
  ];
}

/** An edge of the chain, and where other edges cross it (as fractions along it). */
interface Edge {
  a: Vec;
  b: Vec;
  cuts: Array<{ t: number; p: Vec }>;
}

/** Beyond this many edges the boundary is not worth its time; the chain fills the same. */
const BOUNDARY_EDGE_LIMIT = 40000;

/**
 * The boundary of the region some contours fill under the non-zero rule, as
 * contours of its own, wound with the fill on their right: every edge is cut
 * where another crosses it, and a cut piece is kept only where it has fill on
 * one side and none on the other. Null when floating point leaves the kept
 * pieces unable to close into contours, or the input is too big to be worth
 * it - the caller then keeps its contours, which fill the same.
 */
function boundaryOf(contours: Vec[][]): Vec[][] | null {
  const edges: Edge[] = [];
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (distance(a, b) > 1e-9) edges.push({ a, b, cuts: [] });
    }
  }
  if (edges.length === 0) return [];
  if (edges.length > BOUNDARY_EDGE_LIMIT) return null;

  findCrossings(edges);
  const winding = windingField(edges);

  // Vertices by number. The same point object is met again and again - an
  // edge's end is the next edge's start, a crossing lies on two edges - so
  // each is looked up by identity first and keyed by position only once.
  const byKey = new Map<string, number>();
  const byPoint = new Map<Vec, number>();
  const vertexOf = (p: Vec): number => {
    let id = byPoint.get(p);
    if (id === undefined) {
      const key = pointKey(p);
      id = byKey.get(key);
      if (id === undefined) {
        id = byKey.size;
        byKey.set(key, id);
      }
      byPoint.set(p, id);
    }
    return id;
  };

  // The cut pieces with fill on exactly one side, turned to keep it on their
  // right. Two pieces laid over each other the same way would count that
  // side twice, so only one is kept.
  const kept: Array<{ a: Vec; b: Vec; from: number; to: number }> = [];
  const seen = new Set<number>();
  const nudge = 1e-7;
  for (const e of edges) {
    e.cuts.sort((m, n) => m.t - n.t);
    let from = e.a;
    let fromId = vertexOf(from);
    for (let c = 0; c <= e.cuts.length; c++) {
      const to = c < e.cuts.length ? e.cuts[c].p : e.b;
      const toId = vertexOf(to);
      if (toId === fromId) continue;
      const len = distance(from, to);
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const nx = ((to.y - from.y) / len) * nudge;
      const ny = (-(to.x - from.x) / len) * nudge;
      const onLeft = winding(mx + nx, my + ny) !== 0;
      const onRight = winding(mx - nx, my - ny) !== 0;
      if (onLeft !== onRight) {
        const piece = onRight
          ? { a: from, b: to, from: fromId, to: toId }
          : { a: to, b: from, from: toId, to: fromId };
        const pair = piece.from * 2 ** 26 + piece.to;
        if (!seen.has(pair)) {
          seen.add(pair);
          kept.push(piece);
        }
      }
      from = to;
      fromId = toId;
    }
  }

  // Every vertex a boundary passes through is left as often as it is reached.
  const outgoing: number[][] = Array.from({ length: byKey.size }, () => []);
  const balance = new Int32Array(byKey.size);
  kept.forEach((e, i) => {
    outgoing[e.from].push(i);
    balance[e.from] += 1;
    balance[e.to] -= 1;
  });
  if (balance.some((count) => count !== 0)) return null;

  // Walk them into contours. Where boundaries touch at a point, the sharpest
  // turn towards the fill keeps each contour round its own patch.
  const used = new Uint8Array(kept.length);
  const out: Vec[][] = [];
  for (let s = 0; s < kept.length; s++) {
    if (used[s]) continue;
    const home = kept[s].from;
    const loop: Vec[] = [];
    let e = s;
    for (;;) {
      used[e] = 1;
      loop.push(kept[e].a);
      const here = kept[e].to;
      if (here === home) break;
      let next = -1;
      const options = outgoing[here];
      if (options.length === 1) {
        if (!used[options[0]]) next = options[0];
      } else {
        const heading = { x: kept[e].b.x - kept[e].a.x, y: kept[e].b.y - kept[e].a.y };
        let sharpest = -Infinity;
        for (const i of options) {
          if (used[i]) continue;
          const turn = turnBetween(heading, { x: kept[i].b.x - kept[i].a.x, y: kept[i].b.y - kept[i].a.y });
          if (turn > sharpest) {
            sharpest = turn;
            next = i;
          }
        }
      }
      if (next < 0) return null;
      e = next;
    }
    const contour = tidy(loop);
    if (contour.length >= 3 && Math.abs(signedArea(contour)) > 1e-9) out.push(contour);
  }
  return out;
}

/**
 * A vertex's identity, to a millionth of a pixel: two pieces meet where
 * their ends share one.
 */
function pointKey(p: Vec): string {
  return `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
}

/**
 * Records every place two edges meet on both of them: where they cross, and
 * where an end of one lands on the other - a vertex of zero width sitting
 * exactly on another edge, as the seam of a closed Wave does. The edges are
 * swept along the longer side of their bounds, so only neighbours along the
 * stroke are ever compared.
 */
function findCrossings(edges: Edge[]): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.a.x, e.b.x);
    maxX = Math.max(maxX, e.a.x, e.b.x);
    minY = Math.min(minY, e.a.y, e.b.y);
    maxY = Math.max(maxY, e.a.y, e.b.y);
  }
  const along = maxX - minX >= maxY - minY ? 'x' : 'y';
  const across = along === 'x' ? 'y' : 'x';
  const lo = edges.map((e) => Math.min(e.a[along], e.b[along]));
  const hi = edges.map((e) => Math.max(e.a[along], e.b[along]));
  const side0 = edges.map((e) => Math.min(e.a[across], e.b[across]));
  const side1 = edges.map((e) => Math.max(e.a[across], e.b[across]));
  const order = edges.map((_, i) => i).sort((i, j) => lo[i] - lo[j]);
  for (let s = 0; s < order.length; s++) {
    const i = order[s];
    for (let u = s + 1; u < order.length; u++) {
      const j = order[u];
      if (lo[j] > hi[i]) break;
      if (side0[j] > side1[i] || side1[j] < side0[i]) continue;
      const e = edges[i];
      const f = edges[j];
      // Touching edges meet only where they touch, unless they lie along each other.
      const touched = [touch(e, f.a), touch(e, f.b), touch(f, e.a), touch(f, e.b)].some(Boolean);
      if (touched) continue;
      const hit = crossing(e.a, e.b, f.a, f.b);
      if (!hit) continue;
      e.cuts.push({ t: hit.t, p: hit.p });
      f.cuts.push({ t: hit.u, p: hit.p });
    }
  }
}

/** Cuts `e` at `p` when `p` lies on its interior, and says whether it did. */
function touch(e: Edge, p: Vec): boolean {
  const dx = e.b.x - e.a.x;
  const dy = e.b.y - e.a.y;
  const t = ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / (dx * dx + dy * dy);
  if (!(t > 0 && t < 1)) return false;
  if (Math.hypot(e.a.x + t * dx - p.x, e.a.y + t * dy - p.y) > 1e-7) return false;
  const k = pointKey(p);
  if (k === pointKey(e.a) || k === pointKey(e.b)) return false;
  e.cuts.push({ t, p });
  return true;
}

/**
 * How many times the edges wind about a point: a ray cast from it, across
 * whichever of its row or its column of the bounds holds fewer edges. Only
 * whether the count is zero is ever asked, so the two rays need not agree on
 * its sign.
 */
function windingField(edges: Edge[]): (x: number, y: number) => number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.a.x, e.b.x);
    maxX = Math.max(maxX, e.a.x, e.b.x);
    minY = Math.min(minY, e.a.y, e.b.y);
    maxY = Math.max(maxY, e.a.y, e.b.y);
  }
  const count = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(edges.length) * 4)));
  const rowSize = (maxY - minY) / count || 1;
  const colSize = (maxX - minX) / count || 1;
  const rowOf = (y: number): number => Math.min(count - 1, Math.max(0, Math.floor((y - minY) / rowSize)));
  const colOf = (x: number): number => Math.min(count - 1, Math.max(0, Math.floor((x - minX) / colSize)));
  const rows: Edge[][] = Array.from({ length: count }, () => []);
  const cols: Edge[][] = Array.from({ length: count }, () => []);
  for (const e of edges) {
    if (e.a.y !== e.b.y) {
      const last = rowOf(Math.max(e.a.y, e.b.y));
      for (let r = rowOf(Math.min(e.a.y, e.b.y)); r <= last; r++) rows[r].push(e);
    }
    if (e.a.x !== e.b.x) {
      const last = colOf(Math.max(e.a.x, e.b.x));
      for (let c = colOf(Math.min(e.a.x, e.b.x)); c <= last; c++) cols[c].push(e);
    }
  }
  return (x, y) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return 0;
    const row = rows[rowOf(y)];
    const col = cols[colOf(x)];
    let w = 0;
    if (row.length <= col.length) {
      for (const e of row) {
        if (e.a.y <= y === e.b.y <= y) continue;
        const cx = e.a.x + ((y - e.a.y) / (e.b.y - e.a.y)) * (e.b.x - e.a.x);
        if (cx > x) w += e.b.y > e.a.y ? 1 : -1;
      }
    } else {
      for (const e of col) {
        if (e.a.x <= x === e.b.x <= x) continue;
        const cy = e.a.y + ((x - e.a.x) / (e.b.x - e.a.x)) * (e.b.y - e.a.y);
        if (cy > y) w += e.b.x > e.a.x ? 1 : -1;
      }
    }
    return w;
  };
}

/** Where two segments cross each other's interiors, as fractions along both, or null. */
function crossing(a: Vec, b: Vec, c: Vec, d: Vec): { t: number; u: number; p: Vec } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { t, u, p: { x: a.x + t * rx, y: a.y + t * ry } };
}

/**
 * Drops the vertices a contour does not need: every one that sits on the
 * straight line between its neighbours, which a straight stretch of the
 * stroke leaves one of per sample.
 */
function tidy(loop: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of loop) {
    while (out.length >= 2 && straight(out[out.length - 2], out[out.length - 1], p)) out.pop();
    out.push(p);
  }
  while (out.length >= 3 && straight(out[out.length - 2], out[out.length - 1], out[0])) out.pop();
  while (out.length >= 3 && straight(out[out.length - 1], out[0], out[1])) out.shift();
  return out;
}

/** True when `b` lies on the way from `a` to `c`, within a millionth of a pixel. */
function straight(a: Vec, b: Vec, c: Vec): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  if (abx * bcx + aby * bcy <= 0) return false;
  return Math.abs(abx * bcy - aby * bcx) <= 1e-6 * Math.hypot(c.x - a.x, c.y - a.y);
}

// ---- Pictures ----------------------------------------------------------------------

/**
 * A profile's picture as SVG path data for a `w` × `h` box: a straight stroke
 * across it, as wide as the box allows. The toolbar and the Stroke Profile
 * list draw these, so what they show is what the canvas draws.
 */
export function profilePreviewPath(profile: StrokeProfile, w: number, h: number): string {
  const width = (h - 2) / profileReach(profile);
  const caps = profileSides(profile, 0).left > 0 || profileSides(profile, 1).left > 0;
  const pad = 1 + (caps ? width / 2 : 0);
  const y = h / 2;
  const points: Point[] = [];
  const samples = 48;
  for (let i = 0; i <= samples; i++) {
    points.push({ x: pad + ((w - 2 * pad) * i) / samples, y });
  }
  const contours = profileOutline({
    points,
    width,
    profile,
    closed: false,
    pressure: false,
    dash: [],
  });
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  return contours
    .map((c) => `M${c.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`)
    .join('');
}

// ---- Small vector helpers --------------------------------------------------------

function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function unit(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
}
