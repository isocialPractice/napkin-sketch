/**
 * Erasing as geometry: what an eraser - a swath, or a closed shape - leaves
 * of the marks it passes over, as plain marks, with no mask for anything
 * downstream to learn.
 *
 * Every mark is one of three kinds ({@link eraseKind}):
 *
 * - `area`: its ink is a region - a filled or gradient-filled mark, a Copic
 *   stroke (the footprint of its nib), a profiled stroke (its outline). The
 *   region less the eraser's (`boolean.ts`) is refitted into a few Bézier
 *   anchors, pieces and holes the subpaths of one mark, with a corner
 *   wherever the cut met the edge. A filled mark keeps its fill, gradient
 *   and outline, the outline following the new edges; a Copic or profiled
 *   stroke becomes a filled pen mark in its colour, since its ink is now a
 *   shape.
 * - `line`: every other pen or marker line, open or closed with no fill. Its
 *   centreline is taken away wherever the ink around it - its painted half
 *   width, pressure and all - would reach into the eraser's region, so no
 *   round end pokes into erased ground; what is left is the same mark, its
 *   runs its subpaths, still a line with its width and colour. A mark with
 *   anchors is split at the crossings with de Casteljau, keeping them.
 * - `skip`: text, images, links and erasers.
 *
 * The eraser's region is one region: the outlines of several would share a
 * winding field and cancel each other's holes (see `boolean.ts`).
 *
 * Nothing here touches the DOM.
 */

import { booleanRegions, type Vec } from './boolean.js';
import { strokeBounds } from './bounds.js';
import { fitCurve, fittedPressureAt } from './fit-curve.js';
import { inkReach } from './hit-test.js';
import { copicNibPolygons } from './nib.js';
import { activeProfile, profileInputOf, profileOutline } from './stroke-profile.js';
import { dashPatternFor, isImageStroke, isTextStroke, type Point, type Sketch, type Stroke, type VectorAnchor, widthAtPressure } from './types.js';
import { sampleVectorPathPoints, splitCubicBezier } from '../sharpen/geometry.js';

/** Closed contours an eraser takes away, filled under the non-zero rule. */
export type EraseRegion = Vec[][];

export type EraseKind = 'area' | 'line' | 'skip';

/** What erasing did to one mark: nothing, all of it, a new mark in its place, or a cut the geometry could not make. */
export type EraseCut = { kind: 'kept' } | { kind: 'removed' } | { kind: 'changed'; stroke: Stroke } | { kind: 'raster' };

/**
 * What an eraser did to the marks it was given: each changed mark whole, by
 * id; the marks with nothing left; the marks within its reach it passes over
 * (text, images, links); and the marks whose cut the geometry could not make
 * (`booleanOp` gave null), for the drawing window to cut another way. Eraser
 * marks among the targets are not targets, and are left out.
 */
export interface EraseResult {
  changed: Map<string, Stroke>;
  removed: Set<string>;
  skipped: Set<string>;
  raster: Set<string>;
}

/** How closely an area cut's refit follows the cut outline, in page pixels. */
export const AREA_FIT_TOLERANCE = 0.25;

/** The kind of a mark, as erasing treats it. */
export function eraseKind(stroke: Stroke): EraseKind {
  if (stroke.tool === 'eraser' || isTextStroke(stroke) || isImageStroke(stroke) || stroke.link) return 'skip';
  if (stroke.points.length === 0) return 'skip';
  if ((stroke.fill || stroke.gradient) && stroke.points.length > 2) return 'area';
  if (stroke.tool === 'copic' || activeProfile(stroke)) return 'area';
  return 'line';
}

/**
 * The region an eraser mark takes away: its swath, the width it paints at
 * all along - a click's dot at the size the canvas paints it - with round
 * ends; or, for a closed shape used as an eraser, its interior.
 */
export function eraseRegionOf(eraser: Stroke): EraseRegion {
  const pts = eraser.points;
  if (pts.length === 0) return [];
  if (eraser.tool !== 'eraser') return ringsOf(pts).filter((ring) => ring.length >= 3);
  if (pts.length === 1) {
    const p = pts[0];
    const radius = Math.max(0.5, (eraser.width * (0.4 + 0.6 * (p.pressure ?? 0.5))) / 2);
    return [circle(p, radius)];
  }
  return profileOutline({ ...profileInputOf(eraser), pressure: false, profile: undefined, dash: [] });
}

/**
 * Every mark of `targetIds` on `sketch` with the region taken away: bounds
 * first, the exact cut second. Marks the region misses are left out of the
 * result.
 */
export function eraseMarks(sketch: Sketch, targetIds: Iterable<string>, region: EraseRegion): EraseResult {
  const result: EraseResult = { changed: new Map(), removed: new Set(), skipped: new Set(), raster: new Set() };
  const box = boundsOf(region);
  if (!box) return result;
  const byId = new Map(sketch.strokes.map((s) => [s.id, s]));
  for (const id of targetIds) {
    const stroke = byId.get(id);
    // An eraser mark is no target: it rides along with its layer, and cuts.
    if (!stroke || stroke.tool === 'eraser') continue;
    const kind = eraseKind(stroke);
    const bounds = strokeBounds(stroke);
    const reach = kind === 'skip' ? 0 : inkReach(stroke);
    if (
      !bounds ||
      bounds.minX - reach > box.maxX ||
      bounds.maxX + reach < box.minX ||
      bounds.minY - reach > box.maxY ||
      bounds.maxY + reach < box.minY
    ) {
      continue;
    }
    if (kind === 'skip') {
      result.skipped.add(id);
      continue;
    }
    const cut = kind === 'area' ? cutArea(stroke, region) : cutLine(stroke, region);
    if (cut.kind === 'removed') result.removed.add(id);
    else if (cut.kind === 'changed') result.changed.set(id, cut.stroke);
    else if (cut.kind === 'raster') result.raster.add(id);
  }
  return result;
}

// ---- Areas -------------------------------------------------------------------------

/**
 * An `area` mark less the region: the difference refitted into anchors, a
 * corner kept wherever the cut met the mark's edge, each piece and hole a
 * subpath of one closed compound path.
 */
export function cutArea(stroke: Stroke, region: EraseRegion): EraseCut {
  const filled = !!(stroke.fill || stroke.gradient) && stroke.points.length > 2;
  // A shape with anchors keeps them: what is left of its outline is cut from
  // its own curves, and only the eraser's edge is fitted. A polygon - a nib's
  // footprint, a profile's outline, a shape of bare points - is fitted whole
  // the first time, and has anchors from then on.
  const traced = filled && stroke.vector ? traceOutline(stroke.vector.anchors) : null;
  const area: Vec[][] = traced
    ? traced.rings
    : filled
      ? ringsOf(stroke.points)
      : stroke.tool === 'copic'
        ? copicNibPolygons(stroke)
        : profileOutline(profileInputOf(stroke));
  if (area.length === 0 || region.length === 0) return { kind: 'kept' };
  const a = boundsOf(area);
  const b = boundsOf(region);
  if (!a || !b || a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY) return { kind: 'kept' };

  const result = booleanRegions(area, region, 'difference');
  if (!result) return { kind: 'raster' };
  if (result.contours.length === 0) return { kind: 'removed' };
  // The region never reached the ink: nothing of its outline is in the result.
  if (!result.fromB) return { kind: 'kept' };

  const anchors = ringsToAnchors(result.contours, result.junctions, traced ? [traced] : []);
  if (anchors.length === 0) return { kind: 'removed' };
  const vector: NonNullable<Stroke['vector']> = { anchors, closed: true };
  const points = sampleVectorPathPoints(anchors, true);
  const cut: Stroke = { ...stroke, points, vector, sharpened: true };
  // A Copic's or a profile's ink is a shape now.
  return { kind: 'changed', stroke: filled ? cut : asInkShape(cut, stroke.color) };
}

/**
 * A mark whose ink became a shape - a Copic's nib footprint, a profile's
 * outline, a line's painted width - filled in its colour, with no outline of
 * its own. The wipes turn ink into shapes this way too (core/wipe.ts).
 */
export function asInkShape(mark: Stroke, color: string): Stroke {
  const shape: Stroke = { ...mark, tool: 'pen', fill: color, noStroke: true };
  delete shape.profile;
  delete shape.profileMirrored;
  delete shape.nibAngle;
  delete shape.strokeStyle;
  return shape;
}

/**
 * The contours of a boolean result as the anchors of one closed compound
 * path, each contour a subpath: every stretch that runs along one of the
 * `sources`' own outlines taken from its curves, every other stretch fitted
 * at {@link AREA_FIT_TOLERANCE}, a corner wherever two meet - the junctions,
 * where the result passes from one operand's edge to another's. With no
 * sources - operands of bare points - every stretch is fitted.
 *
 * REUSE: this is the rebuild the Eraser's area cut made with its one mark
 * (`cutArea`), lifted out so the wipes (core/wipe.ts) can rebuild with the
 * outlines of several marks at once. Should the Eraser and the wipes ever
 * want different joins, give each its own rather than growing a flag here.
 */
export function ringsToAnchors(contours: readonly Vec[][], junctions: ReadonlySet<Vec>, sources: readonly Traced[]): VectorAnchor[] {
  const anchors: VectorAnchor[] = [];
  for (const contour of contours) {
    const own = rebuildContour(contour, junctions, sources);
    if (own.length === 0) continue;
    if (anchors.length > 0) own[0].move = true;
    anchors.push(...own);
  }
  return anchors;
}

/**
 * A closed outline traced from its anchors for a cut, with where on them each
 * traced vertex lies, so what the cut leaves of it can be taken from the
 * curves themselves rather than from the trace.
 */
export interface Traced {
  /** Each subpath as a closed polygon: every line's start, and a cubic's samples a pixel and a half apart. */
  rings: Vec[][];
  /** Each ring's segments, in order, the closing one included. */
  segs: Span[][];
  /** Each ring vertex's segment and parameter along it. */
  params: Array<Array<{ seg: number; t: number }>>;
  /** Each ring vertex, by identity. */
  at: Map<Vec, { ring: number; index: number }>;
  /** Each ring's own anchors. */
  anchors: VectorAnchor[][];
}

export function traceOutline(all: readonly VectorAnchor[]): Traced {
  const traced: Traced = { rings: [], segs: [], params: [], at: new Map(), anchors: [] };
  const subpaths: VectorAnchor[][] = [];
  for (const a of all) {
    if (a.move || subpaths.length === 0) subpaths.push([]);
    subpaths[subpaths.length - 1].push(a);
  }
  for (const own of subpaths) {
    // Every subpath of a fill is closed, whether the path says so or not.
    const segs: Span[] = [];
    for (let i = 0; i < own.length; i++) {
      const span = spanOf(own[i], own[(i + 1) % own.length], 0);
      if (span.c1 || spanLength(span) > 1e-9) segs.push(span);
    }
    if (segs.length < 2 && !segs.some((s) => s.c1)) continue;
    const r = traced.rings.length;
    const ring: Vec[] = [];
    const params: Array<{ seg: number; t: number }> = [];
    segs.forEach((span, k) => {
      const steps = span.c1 ? Math.min(200, Math.max(4, Math.ceil(spanLength(span) / 1.5))) : 1;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const p = spanAt(span, t);
        traced.at.set(p, { ring: r, index: ring.length });
        ring.push(p);
        params.push({ seg: k, t });
      }
    });
    traced.rings.push(ring);
    traced.segs.push(segs);
    traced.params.push(params);
    traced.anchors.push(
      own.map((a) => ({
        p: { x: a.p.x, y: a.p.y },
        ...(a.hIn ? { hIn: { x: a.hIn.x, y: a.hIn.y } } : {}),
        ...(a.hOut ? { hOut: { x: a.hOut.x, y: a.hOut.y } } : {}),
      })),
    );
  }
  return traced;
}

/**
 * One contour of a cut, as anchors: split at its junctions into runs; a run
 * along one of the traced outlines taken from its own curves, split with de
 * Casteljau where the cut meets it, and every other run - an eraser's edge,
 * an outline of bare points - fitted; a corner where two runs meet. A
 * subpath the cut never reached keeps its anchors as they were, or with no
 * outline of anchors to keep is fitted as a closed loop.
 */
function rebuildContour(contour: Vec[], junctions: ReadonlySet<Vec>, sources: readonly Traced[]): VectorAnchor[] {
  const corner = (p: Vec): VectorAnchor => ({ p: { x: p.x, y: p.y } });
  const n = contour.length;
  const at = contour.map((p, i) => (junctions.has(p) ? i : -1)).filter((i) => i >= 0);
  if (at.length === 0) {
    for (const traced of sources) {
      const first = traced.at.get(contour[0]);
      if (first && contour.every((p) => traced.at.get(p)?.ring === first.ring)) return orientedAnchors(contour, first.ring, traced);
    }
    // A hole the eraser left inside the shape, or an outline of points: its edge, fitted.
    return fitCurve([...contour, contour[0]], { tolerance: AREA_FIT_TOLERANCE, closed: true }) ?? contour.map(corner);
  }
  // Start at a junction, and walk round to it again.
  const start = at[0];
  const ring = [...contour.slice(start), ...contour.slice(0, start), contour[start]];
  const cuts = at.map((i) => (i - start + n) % n).concat(n);
  const chains: Array<{ anchors: VectorAnchor[]; exact: boolean }> = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const run = ring.slice(cuts[k], cuts[k + 1] + 1);
    let exact: VectorAnchor[] | null = null;
    for (const traced of sources) {
      exact = exactChain(run, traced);
      if (exact) break;
    }
    chains.push(exact ? { anchors: exact, exact: true } : { anchors: fitCurve(run, { tolerance: AREA_FIT_TOLERANCE }) ?? run.map(corner), exact: false });
  }
  // Join them at the junctions: a corner, with a handle of each side's own,
  // where the old outline's curve says - its end is on the curve, the
  // fitted edge's on the trace a hair from it.
  const anchors: VectorAnchor[] = [];
  let before = false;
  for (const chain of chains) {
    if (anchors.length === 0) {
      anchors.push(...chain.anchors);
      before = chain.exact;
      continue;
    }
    const joint = anchors[anchors.length - 1];
    if (chain.exact && !before) joint.p = { ...chain.anchors[0].p };
    if (chain.anchors[0].hOut) joint.hOut = chain.anchors[0].hOut;
    anchors.push(...chain.anchors.slice(1));
    before = chain.exact;
  }
  const last = anchors.pop();
  if (last && anchors[0]) {
    if (last.hIn) anchors[0].hIn = last.hIn;
    if (before && !chains[0].exact) anchors[0].p = { ...last.p };
  }
  return anchors;
}

/** A traced subpath's own anchors, turned the way the cut's contour runs round it. */
function orientedAnchors(contour: Vec[], r: number, traced: Traced): VectorAnchor[] {
  const own = traced.anchors[r].map((a) => ({ ...a }));
  const m = traced.rings[r].length;
  const i0 = traced.at.get(contour[0])!.index;
  const i1 = traced.at.get(contour[1])!.index;
  if ((i1 - i0 + m) % m < m / 2) return own;
  return own.reverse().map((a) => {
    const turned: VectorAnchor = { p: a.p };
    if (a.hOut) turned.hIn = a.hOut;
    if (a.hIn) turned.hOut = a.hIn;
    return turned;
  });
}

/**
 * A run of a cut's contour that lies along the traced outline, from one
 * junction to the next, as anchors taken from the outline's own curves: the
 * run's ends found on the ring's edges, turned into parameters on its
 * segments, and every segment between cut out with de Casteljau. Null when
 * the run is the eraser's, or the ends cannot be placed.
 */
function exactChain(run: Vec[], traced: Traced): VectorAnchor[] | null {
  const inner = run.slice(1, -1).map((p) => traced.at.get(p));
  if (inner.some((w) => !w)) return null;
  // Which ring: an inner vertex's, or the one with one edge holding both
  // ends. Ends on two edges with nothing between them are the eraser's
  // straight edge across the outline, not the outline.
  let r: number;
  if (inner.length > 0) {
    r = inner[0]!.ring;
    if (inner.some((w) => w!.ring !== r)) return null;
  } else {
    const found = traced.rings.findIndex((ring) => sharedEdge(run[0], run[1], ring));
    if (found < 0) return null;
    r = found;
  }
  const ringPts = traced.rings[r];
  const m = ringPts.length;
  const p0 = positionOn(run[0], ringPts);
  const p1 = positionOn(run[run.length - 1], ringPts);
  if (p0 === null || p1 === null) return null;
  // The way round: toward the first inner vertex, or from one end to the other along their edge.
  const ahead = inner.length > 0 ? (inner[0]!.index - p0 + m) % m : (p1 - p0 + m) % m;
  const forward = ahead < m / 2;
  const pieces = forward ? piecesBetween(traced, r, p0, p1) : piecesBetween(traced, r, p1, p0).reverse();
  if (pieces.length === 0) return null;
  const anchors: VectorAnchor[] = [];
  for (const piece of pieces) {
    const cut = subSpan(traced.segs[r][piece.seg], piece.t0, piece.t1);
    const s = forward ? cut : { p0: cut.p3, c1: cut.c2, c2: cut.c1, p3: cut.p0 };
    if (anchors.length === 0) anchors.push({ p: s.p0 });
    const prev = anchors[anchors.length - 1];
    if (s.c1 && apart(s.c1, prev.p)) prev.hOut = s.c1;
    anchors.push({ p: s.p3, ...(s.c2 && apart(s.c2, s.p3) ? { hIn: s.c2 } : {}) });
  }
  return anchors;
}

/** The edge of a ring a point lies on - by index, and how far along it - or null. */
function edgeOf(p: Vec, ring: Vec[]): { index: number; f: number } | null {
  let best: { index: number; f: number; d: number } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const f = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + f * dx), p.y - (a.y + f * dy));
    if (d <= 1e-6 && (!best || d < best.d)) best = { index: i, f, d };
  }
  return best && { index: best.index, f: best.f };
}

/** Whether one edge of a ring holds both points. */
function sharedEdge(p: Vec, q: Vec, ring: Vec[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (segmentDistance(p, a, b) <= 1e-6 && segmentDistance(q, a, b) <= 1e-6) return true;
  }
  return false;
}

/** A point's place on a ring, as a vertex index and a fraction of the edge after it, or null. */
function positionOn(p: Vec, ring: Vec[]): number | null {
  const e = edgeOf(p, ring);
  return e ? e.index + e.f : null;
}

/** A place on a traced ring as a segment and a parameter on it. */
function paramAt(traced: Traced, r: number, pos: number): { seg: number; t: number } {
  const params = traced.params[r];
  const m = params.length;
  const i = ((Math.floor(pos) % m) + m) % m;
  const f = pos - Math.floor(pos);
  const a = params[i];
  const b = params[(i + 1) % m];
  const end = b.seg === a.seg ? b.t : 1;
  return { seg: a.seg, t: a.t + (end - a.t) * f };
}

/** The stretches of segments from one place on a ring to another, going forward round it. */
function piecesBetween(traced: Traced, r: number, from: number, to: number): Array<{ seg: number; t0: number; t1: number }> {
  const count = traced.segs[r].length;
  const a = paramAt(traced, r, from);
  const b = paramAt(traced, r, to);
  if (a.seg === b.seg && b.t >= a.t) return b.t - a.t > 1e-12 ? [{ seg: a.seg, t0: a.t, t1: b.t }] : [];
  const pieces: Array<{ seg: number; t0: number; t1: number }> = [];
  if (a.t < 1) pieces.push({ seg: a.seg, t0: a.t, t1: 1 });
  for (let s = (a.seg + 1) % count; s !== b.seg; s = (s + 1) % count) pieces.push({ seg: s, t0: 0, t1: 1 });
  if (b.t > 0) pieces.push({ seg: b.seg, t0: 0, t1: b.t });
  return pieces;
}

// ---- Lines ---------------------------------------------------------------------------

/** One stretch of a line's path: a line or a cubic, with the pressure at each end. */
interface Span {
  p0: Vec;
  c1: Vec | null;
  c2: Vec | null;
  p3: Vec;
  pr0: number | undefined;
  pr1: number | undefined;
  /** The anchors it runs between, for the pressure of a fitted stroke's cut. */
  from?: VectorAnchor;
  to?: VectorAnchor;
  /** Its subpath, by number: a run never carries on from one subpath to the next. */
  sub: number;
}

/**
 * A `line` mark less the region, grown by the ink's half width: its
 * centreline taken away wherever the painted line would reach into the
 * region, what is left the subpaths of the same mark.
 */
export function cutLine(stroke: Stroke, region: EraseRegion): EraseCut {
  const pts = stroke.points;
  if (pts.length === 0 || region.length === 0) return { kind: 'kept' };
  const edges = edgesOf(region);
  const half = halfWidthOf(stroke);
  const erased = (p: Vec, pressure: number | undefined): boolean =>
    windingOf(p, edges) !== 0 || nearestEdge(p, edges) < half(pressure);

  // A dot goes whole, or stays.
  if (pts.length === 1) {
    const p = pts[0];
    const radius = Math.max(0.5, (stroke.width * widthAtPressure(stroke.tool, p.pressure)) / 2);
    return windingOf(p, edges) !== 0 || nearestEdge(p, edges) < radius ? { kind: 'removed' } : { kind: 'kept' };
  }

  const spans = spansOf(stroke);
  const closed = closedSubpaths(stroke);
  // The kept stretches of every span, as fractions along it.
  let touched = false;
  const keptBy: Array<Array<[number, number]>> = spans.map((span) => {
    const length = spanLength(span);
    const least = Math.max(0.25, Math.min(half(span.pr0), half(span.pr1)) / 2);
    const steps = Math.min(4000, Math.max(2, Math.ceil(length / least)));
    const at = (t: number): boolean => erased(spanAt(span, t), lerpPressure(span.pr0, span.pr1, t));
    const flags: boolean[] = [];
    for (let i = 0; i <= steps; i++) flags.push(at(i / steps));
    if (flags.some(Boolean)) touched = true;
    const kept: Array<[number, number]> = [];
    let from: number | null = flags[0] ? null : 0;
    for (let i = 1; i <= steps; i++) {
      if (flags[i] === flags[i - 1]) continue;
      // Where between the two samples the ink meets the region.
      let lo = (i - 1) / steps;
      let hi = i / steps;
      for (let k = 0; k < 40 && hi - lo > 1e-9; k++) {
        const mid = (lo + hi) / 2;
        if (at(mid) === flags[i - 1]) lo = mid;
        else hi = mid;
      }
      const t = flags[i - 1] ? hi : lo;
      if (flags[i - 1]) from = t;
      else if (from !== null) {
        kept.push([from, t]);
        from = null;
      }
    }
    if (from !== null) kept.push([from, 1]);
    return kept;
  });
  if (!touched) return { kind: 'kept' };

  // The runs: kept stretches joined where one span's reaches its end and the
  // next's begins at its start, in the same subpath.
  type Piece = { span: Span; index: number; t0: number; t1: number };
  const runs: Piece[][] = [];
  let run: Piece[] = [];
  spans.forEach((span, i) => {
    for (const [t0, t1] of keptBy[i]) {
      const prev = run[run.length - 1];
      const continues = !!prev && prev.t1 >= 1 && t0 <= 0 && prev.span.sub === span.sub && prev.index === i - 1;
      if (!continues && run.length > 0) {
        runs.push(run);
        run = [];
      }
      if (t1 - t0 > 1e-9) run.push({ span, index: i, t0, t1 });
    }
  });
  if (run.length > 0) runs.push(run);
  // A closed subpath cut open goes round through its seam as one run: the
  // run that ends at its last span's end carries on into the one that
  // begins at its first span's start.
  for (const sub of closed) {
    const firstSpan = spans.findIndex((s) => s.sub === sub);
    const lastSpan = spans.length - 1 - [...spans].reverse().findIndex((s) => s.sub === sub);
    const head = runs.findIndex((r) => r[0].index === firstSpan && r[0].t0 <= 0);
    const tail = runs.findIndex((r) => r[r.length - 1].index === lastSpan && r[r.length - 1].t1 >= 1);
    if (head < 0 || tail < 0 || head === tail) continue;
    runs[head] = [...runs[tail], ...runs[head]];
    runs.splice(tail, 1);
  }
  const lengthy = runs.filter((r) => r.reduce((sum, piece) => sum + spanLength(piece.span) * (piece.t1 - piece.t0), 0) > 1e-6);
  if (lengthy.length === 0) return { kind: 'removed' };

  const cut: Stroke = { ...stroke };
  if (stroke.vector) {
    const anchors: VectorAnchor[] = [];
    lengthy.forEach((pieces, r) => {
      pieces.forEach((piece, k) => {
        const sub = subSpan(piece.span, piece.t0, piece.t1);
        const pressure0 = pressureAt(piece.span, piece.t0);
        const pressure1 = pressureAt(piece.span, piece.t1);
        if (k === 0) {
          anchors.push({ p: sub.p0, ...(r > 0 ? { move: true as const } : {}), ...(pressure0 !== undefined ? { pressure: pressure0 } : {}) });
        }
        // A handle that sits on its own anchor steers nothing, and is left off.
        const prev = anchors[anchors.length - 1];
        if (sub.c1 && apart(sub.c1, prev.p)) prev.hOut = sub.c1;
        anchors.push({ p: sub.p3, ...(sub.c2 && apart(sub.c2, sub.p3) ? { hIn: sub.c2 } : {}), ...(pressure1 !== undefined ? { pressure: pressure1 } : {}) });
      });
    });
    cut.vector = { anchors, ...(stroke.vector.fitted ? { fitted: true as const } : {}) };
    cut.points = sampleVectorPathPoints(anchors, false);
  } else {
    const points: Point[] = [];
    lengthy.forEach((pieces, r) => {
      pieces.forEach((piece, k) => {
        const a = spanAt(piece.span, piece.t0);
        const b = spanAt(piece.span, piece.t1);
        if (k === 0) points.push({ x: a.x, y: a.y, pressure: lerpPressure(piece.span.pr0, piece.span.pr1, piece.t0) ?? 0.5, ...(r > 0 ? { move: true as const } : {}) });
        points.push({ x: b.x, y: b.y, pressure: lerpPressure(piece.span.pr0, piece.span.pr1, piece.t1) ?? 0.5 });
      });
    });
    cut.points = points;
    delete cut.vector;
  }
  return { kind: 'changed', stroke: cut };
}

/** The painted half width of a line at a pressure, as the canvas paints it: a marker's and a dashed line's are even. */
function halfWidthOf(stroke: Stroke): (pressure: number | undefined) => number {
  const even = stroke.tool === 'marker' || dashPatternFor(stroke.strokeStyle, stroke.width).length > 0;
  return (pressure) => Math.max(0.5, stroke.width * (even ? 1 : widthAtPressure(stroke.tool, pressure))) / 2;
}

/** A line's path as spans: its anchors' segments, or its points' - each subpath's own, a closed one's closing segment too. */
function spansOf(stroke: Stroke): Span[] {
  const spans: Span[] = [];
  if (stroke.vector) {
    const anchors = stroke.vector.anchors;
    const closed = stroke.vector.closed === true;
    let start = 0;
    let sub = 0;
    const close = (end: number): void => {
      if (closed && end > start) spans.push(spanOf(anchors[end], anchors[start], sub));
    };
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i].move) {
        close(i - 1);
        start = i;
        sub++;
        continue;
      }
      spans.push(spanOf(anchors[i - 1], anchors[i], sub));
    }
    close(anchors.length - 1);
    return spans;
  }
  const pts = stroke.points;
  let sub = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].move) {
      sub++;
      continue;
    }
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-12) continue;
    spans.push({ p0: { x: a.x, y: a.y }, c1: null, c2: null, p3: { x: b.x, y: b.y }, pr0: a.pressure, pr1: b.pressure, sub });
  }
  return spans;
}

function spanOf(from: VectorAnchor, to: VectorAnchor, sub: number): Span {
  const curved = !!from.hOut || !!to.hIn;
  return {
    p0: from.p,
    c1: curved ? (from.hOut ?? from.p) : null,
    c2: curved ? (to.hIn ?? to.p) : null,
    p3: to.p,
    pr0: from.pressure,
    pr1: to.pressure,
    from,
    to,
    sub,
  };
}

/**
 * The subpaths of a line's path that close on themselves, by number: every
 * one of a closed vector path, and each subpath of points that ends where it
 * began.
 */
function closedSubpaths(stroke: Stroke): Set<number> {
  const closed = new Set<number>();
  if (stroke.vector) {
    if (stroke.vector.closed !== true) return closed;
    const count = 1 + stroke.vector.anchors.filter((a, i) => i > 0 && a.move).length;
    for (let s = 0; s < count; s++) closed.add(s);
    return closed;
  }
  let sub = 0;
  let start = 0;
  const pts = stroke.points;
  const end = (last: number): void => {
    const a = pts[start];
    const b = pts[last];
    if (last - start >= 2 && Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9) closed.add(sub);
  };
  for (let i = 1; i < pts.length; i++) {
    if (!pts[i].move) continue;
    end(i - 1);
    sub++;
    start = i;
  }
  end(pts.length - 1);
  return closed;
}

function spanAt(s: Span, t: number): Vec {
  if (!s.c1 || !s.c2) return { x: s.p0.x + (s.p3.x - s.p0.x) * t, y: s.p0.y + (s.p3.y - s.p0.y) * t };
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

/** A span's length, near enough for sampling: its control polygon's. */
function spanLength(s: Span): number {
  if (!s.c1 || !s.c2) return Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y);
  return Math.hypot(s.c1.x - s.p0.x, s.c1.y - s.p0.y) + Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) + Math.hypot(s.p3.x - s.c2.x, s.p3.y - s.c2.y);
}

/** The part of a span from `t0` to `t1`: a line's ends, or a cubic cut twice by de Casteljau. */
function subSpan(s: Span, t0: number, t1: number): { p0: Vec; c1: Vec | null; c2: Vec | null; p3: Vec } {
  if (!s.c1 || !s.c2) return { p0: spanAt(s, t0), c1: null, c2: null, p3: spanAt(s, t1) };
  let p0 = s.p0;
  let c1 = s.c1;
  let c2 = s.c2;
  let p3 = s.p3;
  if (t1 < 1) {
    const left = splitCubicBezier(p0, c1, c2, p3, t1);
    c1 = left.left.c1;
    c2 = left.left.c2;
    p3 = left.point;
  }
  if (t0 > 0) {
    const right = splitCubicBezier(p0, c1, c2, p3, t1 > 0 ? t0 / t1 : 0);
    p0 = right.point;
    c1 = right.right.c1;
    c2 = right.right.c2;
  }
  const xy = (v: Vec): Vec => ({ x: v.x, y: v.y });
  return { p0: xy(p0), c1: xy(c1), c2: xy(c2), p3: xy(p3) };
}

const apart = (a: Vec, b: Vec): boolean => Math.hypot(a.x - b.x, a.y - b.y) > 1e-9;

function pressureAt(s: Span, t: number): number | undefined {
  if (s.from && s.to) return fittedPressureAt(s.from, s.to, t);
  return lerpPressure(s.pr0, s.pr1, t);
}

function lerpPressure(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  const from = a ?? b ?? 0.5;
  const to = b ?? from;
  return from * (1 - t) + to * t;
}

// ---- Regions -------------------------------------------------------------------------

type Segment = [Vec, Vec];

function edgesOf(region: EraseRegion): Segment[] {
  const edges: Segment[] = [];
  for (const ring of region) {
    for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  }
  return edges;
}

/** The non-zero winding of the region's edges about `p`. */
function windingOf(p: Vec, edges: Segment[]): number {
  let w = 0;
  for (const [a, b] of edges) {
    if (a.y <= p.y) {
      if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) w++;
    } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) {
      w--;
    }
  }
  return w;
}

function nearestEdge(p: Vec, edges: Segment[]): number {
  let best = Infinity;
  for (const [a, b] of edges) best = Math.min(best, segmentDistance(p, a, b));
  return best;
}

function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A mark's points as contours: a `move` starts the next. */
export function ringsOf(pts: readonly Point[]): Vec[][] {
  const rings: Vec[][] = [];
  let ring: Vec[] = [];
  for (const p of pts) {
    if (p.move && ring.length > 0) {
      rings.push(ring);
      ring = [];
    }
    ring.push({ x: p.x, y: p.y });
  }
  if (ring.length > 0) rings.push(ring);
  return rings;
}

/** The box round a set of contours, or null when they hold no point. */
export function boundsOf(contours: readonly Vec[][]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/**
 * A circle as a polygon to cut with: a vertex every pixel of its round, at
 * least 32, drawn round the circle rather than inside it, so no ring of the
 * painted dot is left at its edge.
 */
function circle(c: Vec, r: number): Vec[] {
  const steps = Math.max(32, Math.ceil(2 * Math.PI * r));
  const reach = r / Math.cos(Math.PI / steps);
  const out: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push({ x: c.x + Math.cos(a) * reach, y: c.y + Math.sin(a) * reach });
  }
  return out;
}
