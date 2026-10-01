/**
 * The Wipe Stacks: combining the selected marks as regions, as a vector
 * editor's Pathfinder does, and the faces of their arrangement, which the
 * Shape Stacker works on.
 *
 * Each mark is an operand ({@link wipeOperand}): a shape - filled, or a
 * closed outline - is its inside; a line, a Copic stroke or a profiled one is
 * its painted ink. The six operations fold the operands in paint order with
 * the boolean engine (`boolean.ts`), and their results are rebuilt into a few
 * Bézier anchors by the Eraser's rebuild (`erase.ts`'s `ringsToAnchors`): a
 * stretch along an operand's own curves keeps them exactly, and the rest is
 * fitted.
 *
 * | op | Pathfinder | what is left | painted as |
 * | --- | --- | --- | --- |
 * | `in` (Wipe In) | Unite | the union | the topmost operand |
 * | `out-front` (Subtract Top from Below) | Minus Front | the bottom less the rest | the bottom operand |
 * | `out-back` (Subtract Below from Top) | Minus Back | the top less the rest | the top operand |
 * | `mid` (Mid Wipe) | Intersect | where all of them overlap | the topmost operand |
 * | `outer` (Outer Wipes) | Exclude | where an odd number overlap | the topmost operand |
 * | `clean` (Clean Wipe) | Divide | every face of the arrangement, a mark each | the topmost operand covering it |
 *
 * A result painted as a shape keeps its fill, outline, width, opacity and
 * effects; one painted as ink is a filled shape in the ink's colour with no
 * outline, as the Eraser leaves a cut Copic stroke. Nothing here touches the
 * DOM, and nothing is changed: the result says what to change, and the
 * drawing window's store makes it one undo step.
 *
 * The Shape Stacker - a vector editor's Shape Builder - works on the faces of
 * the arrangement one piece at a time ({@link stackArrangement}): the faces a
 * drag crosses, a box touches or a click lands on are merged into one shape,
 * or taken away from every mark ({@link stackEdit}).
 */

import { booleanRegions, type BooleanOp, type Vec } from './boolean.js';
import { asInkShape, boundsOf, eraseKind, ringsOf, ringsToAnchors, traceOutline, type Traced } from './erase.js';
import { signedArea } from './graphic-design/geometry.js';
import { copicNibPolygons } from './nib.js';
import { paintOrder } from './paint-order.js';
import { profileInputOf, profileOutline } from './stroke-profile.js';
import { createId, isClosedStroke, layerOf, type Sketch, type Stroke, type VectorAnchor } from './types.js';
import { sampleVectorPathPoints } from '../sharpen/geometry.js';

/** The six wipes: Wipe In, Wipe Out's two, Mid Wipe, Outer Wipes, Clean Wipe. */
export type WipeOp = 'in' | 'out-front' | 'out-back' | 'mid' | 'outer' | 'clean';

/** Every wipe, in the order the menus list them. */
export const WIPE_OPS: readonly WipeOp[] = ['in', 'out-front', 'out-back', 'mid', 'outer', 'clean'];

/** Past this many operands a wipe is not tried: the arrangement grows too fast to be worth the wait. */
export const WIPE_OPERAND_LIMIT = 32;

/** Past this many faces an arrangement gives up. */
export const WIPE_FACE_LIMIT = 512;

/**
 * What an edit does to the marks of a page: each changed mark whole, by id -
 * it keeps its id and its layer - the marks taken away, and new marks, each
 * for a layer of its own right above the layer it names.
 */
export interface MarkEdit {
  changed: Map<string, Stroke>;
  removed: Set<string>;
  added: Array<{ stroke: Stroke; above: string }>;
}

/** Why a wipe did nothing: fewer than two operands, too many, or an operation the geometry could not make. */
export type WipeProblem = 'too-few' | 'too-many' | 'failed';

/** A wipe's edit, the marks it passed over, why it did nothing if it did nothing, and whether it left nothing at all. */
export interface WipeResult extends MarkEdit {
  /** Selected marks that are no operand: text, pictures, placed graphics. */
  skipped: Set<string>;
  problem: WipeProblem | null;
  /** The operands are gone and nothing took their place. */
  empty: boolean;
}

/** A mark as a wipe takes it: its region, what kind of paint a result from it has, and its outline traced from its anchors, when it has them. */
export interface WipeOperand {
  stroke: Stroke;
  /** `shape`: the result keeps the mark's paint. `ink`: the result is a filled shape in the ink's colour. */
  kind: 'shape' | 'ink';
  /** Closed contours, filled under the non-zero rule. */
  region: Vec[][];
  /** The outline the region was traced from, so what a wipe leaves of it keeps its anchors. */
  traced: Traced | null;
}

/**
 * A mark as a wipe's operand, or null for one a wipe passes over - text, a
 * picture, a placed graphic, an older file's eraser mark, a lone dot.
 *
 * - A shape is its inside: a mark with a fill or a gradient, or a closed
 *   outline with no fill (C's Top Path test: a closed `vector`, or ends that
 *   meet). With anchors, its outline is traced from them.
 * - Anything else is its painted ink: a line's width along it, a Copic's nib
 *   footprint, a profiled stroke's outline - what the eye sees of it, the
 *   region the Eraser's area kind cuts with.
 */
export function wipeOperand(stroke: Stroke): WipeOperand | null {
  const kind = eraseKind(stroke);
  if (kind === 'skip') return null;
  const filled = !!(stroke.fill || stroke.gradient) && stroke.points.length > 2;
  const closedOutline = kind === 'line' && (stroke.vector?.closed === true || isClosedStroke(stroke));
  if (filled || closedOutline) {
    const traced = stroke.vector && stroke.vector.anchors.length >= 2 ? traceOutline(stroke.vector.anchors) : null;
    const region = traced ? traced.rings : ringsOf(stroke.points).filter((ring) => ring.length >= 3);
    return region.length > 0 ? { stroke, kind: 'shape', region, traced } : null;
  }
  // A nib's footprint is a soup of overlapping quads: joined first, so a
  // result painted from it is one outline, not every quad.
  const ink = stroke.tool === 'copic' ? join(copicNibPolygons(stroke)) : profileOutline(profileInputOf(stroke));
  return ink && ink.length > 0 ? { stroke, kind: 'ink', region: ink, traced: null } : null;
}

/**
 * Whether a wipe can take a mark at all - cheap, for the menus to ask on
 * every change: every mark but text, a picture, a placed graphic and an older
 * file's eraser mark ({@link wipeOperand} says what it is taken as).
 */
export function isWipeable(stroke: Stroke): boolean {
  return eraseKind(stroke) !== 'skip';
}

/** A soup of contours joined into one outline (the boolean engine's union with nothing), or null when it cannot be. */
function join(contours: Vec[][]): Vec[][] | null {
  if (contours.length === 0) return contours;
  return booleanRegions(contours, [], 'union')?.contours ?? null;
}

/**
 * The selected marks of `ids`, wiped: an edit of the page, not made. The
 * operands are taken in paint order - the first at the bottom - and marks
 * that are no operand are passed over.
 */
export function wipeMarks(sketch: Sketch, ids: Iterable<string>, op: WipeOp): WipeResult {
  const { operands, skipped, problem } = gather(sketch, ids);
  const result: WipeResult = { changed: new Map(), removed: new Set(), added: [], skipped, problem: null, empty: false };
  if (problem) return { ...result, problem };
  const sources = operands.flatMap((o) => (o.traced ? [o.traced] : []));

  if (op === 'clean') {
    const arrangement = arrangeFaces(operands.map((o) => o.region));
    if (arrangement.problem) return { ...result, problem: arrangement.problem };
    // Each face is the topmost operand's that covers it: that mark becomes
    // its first face, and every other face it owns is added above it.
    const owned = new Map<number, Face[]>();
    for (const face of arrangement.faces) {
      const top = Math.max(...face.covers);
      owned.set(top, [...(owned.get(top) ?? []), face]);
    }
    operands.forEach((operand, i) => {
      const marks = (owned.get(i) ?? [])
        .map((face) => ringsToAnchors(face.contours, arrangement.junctions, sources))
        .filter((anchors) => anchors.length > 0)
        .map((anchors) => markOf(operand, anchors));
      if (marks.length === 0) {
        result.removed.add(operand.stroke.id);
        return;
      }
      result.changed.set(operand.stroke.id, marks[0]);
      const above = layerOf(sketch, operand.stroke).id;
      for (const mark of marks.slice(1)) result.added.push({ stroke: { ...mark, id: createId('st') }, above });
    });
    return result;
  }

  const junctions = new Set<Vec>();
  const regions = operands.map((o) => o.region);
  const bottom = 0;
  const top = operands.length - 1;
  let contours: Vec[][] | null;
  let painter: number;
  switch (op) {
    case 'in':
      contours = fold(regions, (a, b) => step(a, b, 'union', junctions));
      painter = top;
      break;
    case 'mid':
      contours = fold(regions, (a, b) => step(a, b, 'intersection', junctions));
      painter = top;
      break;
    case 'outer':
      contours = fold(regions, (a, b) => exclude(a, b, junctions));
      painter = top;
      break;
    case 'out-front':
      contours = fold(regions, (a, b) => step(a, b, 'difference', junctions));
      painter = bottom;
      break;
    case 'out-back':
      contours = fold([regions[top], ...regions.slice(0, top)], (a, b) => step(a, b, 'difference', junctions));
      painter = top;
      break;
  }
  if (contours === null) return { ...result, problem: 'failed' };
  const anchors = ringsToAnchors(contours, junctions, sources);
  const kept = operands[painter];
  for (const operand of operands) if (operand !== kept || anchors.length === 0) result.removed.add(operand.stroke.id);
  if (anchors.length === 0) return { ...result, empty: true };
  result.changed.set(kept.stroke.id, markOf(kept, anchors));
  return result;
}

/**
 * The marks of `ids` as a wipe takes them, in paint order - the first at the
 * bottom - the ones it passes over (not an older file's eraser marks, which
 * are no content of their own), and whether there are too few or too many.
 */
function gather(sketch: Sketch, ids: Iterable<string>): { operands: WipeOperand[]; skipped: Set<string>; problem: WipeProblem | null } {
  const wanted = new Set(ids);
  const operands: WipeOperand[] = [];
  const skipped = new Set<string>();
  for (const stroke of paintOrder(sketch)) {
    if (!wanted.has(stroke.id)) continue;
    const operand = wipeOperand(stroke);
    if (operand) operands.push(operand);
    else if (stroke.tool !== 'eraser') skipped.add(stroke.id);
  }
  const problem = operands.length < 2 ? 'too-few' : operands.length > WIPE_OPERAND_LIMIT ? 'too-many' : null;
  return { operands, skipped, problem };
}

/** `regions` folded from the first: each next one combined with what came before; null as soon as a step fails. */
function fold(regions: readonly Vec[][][], combine: (a: Vec[][], b: Vec[][]) => Vec[][] | null): Vec[][] | null {
  let acc: Vec[][] | null = regions[0];
  for (let i = 1; i < regions.length && acc !== null; i++) acc = combine(acc, regions[i]);
  return acc;
}

/**
 * One boolean step, its junctions kept for the rebuild: where its outline
 * passes from one operand's edge to the other's is a corner the result keeps.
 * Two regions whose boxes are apart need no engine to be taken from each
 * other or intersected; a union always goes through it, which joins a soup.
 */
function step(a: Vec[][], b: Vec[][], op: BooleanOp, junctions: Set<Vec>): Vec[][] | null {
  if (op !== 'union') {
    const ba = boundsOf(a);
    const bb = boundsOf(b);
    const apart = !ba || !bb || ba.minX > bb.maxX || ba.maxX < bb.minX || ba.minY > bb.maxY || ba.maxY < bb.minY;
    if (apart) return op === 'difference' ? a : [];
  }
  if (a.length === 0) return op === 'union' ? b : [];
  const r = booleanRegions(a, b, op);
  if (!r) return null;
  for (const j of r.junctions) junctions.add(j);
  return r.contours;
}

/** Where an odd number of the two overlap: in either, and not in both. */
function exclude(a: Vec[][], b: Vec[][], junctions: Set<Vec>): Vec[][] | null {
  const both = step(a, b, 'intersection', junctions);
  const either = step(a, b, 'union', junctions);
  if (both === null || either === null) return null;
  return both.length === 0 ? either : step(either, both, 'difference', junctions);
}

/** A wipe's result as a mark painted like `operand`: the rebuilt anchors, sampled into its points. */
function markOf(operand: WipeOperand, anchors: VectorAnchor[]): Stroke {
  const vector: NonNullable<Stroke['vector']> = { anchors, closed: true };
  const shape: Stroke = { ...operand.stroke, points: sampleVectorPathPoints(anchors, true), vector, sharpened: true };
  return operand.kind === 'ink' ? asInkShape(shape, operand.stroke.color) : shape;
}

// ---- Faces --------------------------------------------------------------------------

/** One piece of an arrangement: its contours (an outline and its holes), and which regions - by index - it lies in. */
export interface Face {
  contours: Vec[][];
  covers: number[];
}

/** The faces of an arrangement, the corners their outlines keep, and why there are none if there are none. */
export interface Arrangement {
  faces: Face[];
  junctions: Set<Vec>;
  problem: 'too-many' | 'failed' | null;
}

/**
 * The faces of the regions' arrangement: every piece that some of them
 * cover and the rest do not, each connected piece a face of its own, with
 * the regions it lies in (their indices, ascending). Built region by
 * region: each splits every face so far into its inside and its outside, and
 * adds the ground it alone covers. More than `faceLimit` faces, or a step the
 * geometry cannot make, gives no faces and says why.
 */
export function arrangeFaces(regions: readonly Vec[][][], options: { faceLimit?: number } = {}): Arrangement {
  const limit = options.faceLimit ?? WIPE_FACE_LIMIT;
  const junctions = new Set<Vec>();
  const fail = (problem: 'too-many' | 'failed'): Arrangement => ({ faces: [], junctions, problem });
  let pieces: Face[] = [];
  let covered: Vec[][] = [];
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region.length === 0) continue;
    const next: Face[] = [];
    for (const piece of pieces) {
      const inside = step(piece.contours, region, 'intersection', junctions);
      const outside = step(piece.contours, region, 'difference', junctions);
      if (inside === null || outside === null) return fail('failed');
      if (inside.length > 0) next.push({ contours: inside, covers: [...piece.covers, i] });
      if (outside.length > 0) next.push({ contours: outside, covers: piece.covers });
    }
    const alone = step(region, covered, 'difference', junctions);
    const joined = step(covered, region, 'union', junctions);
    if (alone === null || joined === null) return fail('failed');
    if (alone.length > 0) next.push({ contours: alone, covers: [i] });
    covered = joined;
    pieces = next;
    if (pieces.length > limit) return fail('too-many');
  }
  const faces = pieces.flatMap((piece) => components(piece.contours).map((contours) => ({ contours, covers: piece.covers })));
  if (faces.length > limit) return fail('too-many');
  return { faces, junctions, problem: null };
}

/**
 * A boolean result's contours as connected pieces: each outer contour with
 * the holes inside it. The engine winds outer contours clockwise on the page
 * - a positive signed area, y running down - and holes the other way; a hole
 * goes with the smallest outer contour round it.
 */
function components(contours: Vec[][]): Vec[][][] {
  const outers = contours.filter((c) => signedArea(c) > 0);
  if (outers.length <= 1) return [contours];
  const groups = outers.map((outer) => [outer]);
  for (const hole of contours.filter((c) => signedArea(c) <= 0)) {
    let best = -1;
    let smallest = Infinity;
    outers.forEach((outer, k) => {
      const area = signedArea(outer);
      if (area < smallest && inside(hole[0], outer)) {
        best = k;
        smallest = area;
      }
    });
    groups[best >= 0 ? best : 0].push(hole);
  }
  return groups;
}

/** Whether a point is inside a contour, by the even-odd crossings of a ray. */
function inside(p: Vec, ring: Vec[]): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}

// ---- The Shape Stacker --------------------------------------------------------------

/** A box on the page. */
export interface StackBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The Shape Stacker's view of a selection: its operands in paint order, the
 * faces they make with each face's box, the corners the faces' outlines
 * keep, and the operands' traced outlines a rebuild takes curves from.
 * Computed once for a selection and picked from as often as the pointer
 * moves; `problem` says why there are no faces.
 */
export interface StackArrangement {
  operands: WipeOperand[];
  faces: Face[];
  boxes: StackBox[];
  junctions: Set<Vec>;
  sources: Traced[];
  /** Selected marks that are no operand: text, pictures, placed graphics. */
  skipped: Set<string>;
  problem: WipeProblem | null;
}

/** The faces the marks of `ids` make, for the Shape Stacker to pick from. */
export function stackArrangement(sketch: Sketch, ids: Iterable<string>): StackArrangement {
  const { operands, skipped, problem } = gather(sketch, ids);
  const none: StackArrangement = { operands, faces: [], boxes: [], junctions: new Set(), sources: [], skipped, problem };
  if (problem) return none;
  const arrangement = arrangeFaces(operands.map((o) => o.region));
  if (arrangement.problem) return { ...none, problem: arrangement.problem };
  return {
    operands,
    faces: arrangement.faces,
    boxes: arrangement.faces.map((face) => boundsOf(face.contours) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }),
    junctions: arrangement.junctions,
    sources: operands.flatMap((o) => (o.traced ? [o.traced] : [])),
    skipped,
    problem: null,
  };
}

/** The face under a point, by index, or -1 when it is on none. */
export function faceAt(arrangement: StackArrangement, p: Vec): number {
  return arrangement.faces.findIndex((face, i) => inBox(p, arrangement.boxes[i]) && inFace(p, face));
}

/**
 * The faces a path crosses, by index, in the order it first reaches them. A
 * path of one point is a click: the face under it, if any.
 */
export function facesAlong(arrangement: StackArrangement, path: readonly Vec[]): number[] {
  if (path.length === 1) {
    const face = faceAt(arrangement, path[0]);
    return face >= 0 ? [face] : [];
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const span: StackBox = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const hits: Array<{ face: number; t: number }> = [];
    arrangement.faces.forEach((face, i) => {
      if (seen.has(i) || !overlaps(span, arrangement.boxes[i])) return;
      const t = entry(a, b, face);
      if (t !== null) hits.push({ face: i, t });
    });
    // Along one segment, in the order it reaches them.
    hits.sort((m, n) => m.t - n.t);
    for (const hit of hits) {
      seen.add(hit.face);
      out.push(hit.face);
    }
  }
  return out;
}

/** The faces a box touches, by index, in the arrangement's order. */
export function facesInBox(arrangement: StackArrangement, box: StackBox): number[] {
  const corners: Vec[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  const out: number[] = [];
  arrangement.faces.forEach((face, i) => {
    if (!overlaps(box, arrangement.boxes[i])) return;
    const touches =
      // An outline in the box, the box in the face, or the two crossing.
      face.contours.some((ring) => ring.some((p) => inBox(p, box))) ||
      corners.some((p) => inFace(p, face)) ||
      face.contours.some((ring) =>
        ring.some((p, k) => corners.some((c, m) => segmentHit(p, ring[(k + 1) % ring.length], c, corners[(m + 1) % 4]) !== null)),
      );
    if (touches) out.push(i);
  });
  return out;
}

/** What a stack does with the faces picked: makes them one shape, or takes them away. */
export type StackMode = 'merge' | 'remove';

/** Every stack, in the order the script's `stack` verb lists them. */
export const STACK_MODES: readonly StackMode[] = ['merge', 'remove'];

/**
 * The Shape Stacker's edit of an arrangement's faces, not made.
 *
 * `merge` makes the picked faces one shape, painted as the topmost mark over
 * the first of them - where a drag starts, as Shape Builder paints from the
 * artwork there - and each mark they were part of keeps what was not merged.
 * The painter's own leftover keeps its place; when nothing of it is left the
 * merged shape takes its place instead, and otherwise the merged shape is
 * added right above it. `remove` takes the picked faces away from every
 * mark. A mark left with nothing is removed; marks the faces were no part of
 * are not touched, and nor are their anchors.
 */
export function stackEdit(sketch: Sketch, arrangement: StackArrangement, picked: readonly number[], mode: StackMode): WipeResult {
  const result: WipeResult = { changed: new Map(), removed: new Set(), added: [], skipped: new Set(arrangement.skipped), problem: arrangement.problem, empty: false };
  if (arrangement.problem) return result;
  const faces = [...new Set(picked)].filter((i) => i >= 0 && i < arrangement.faces.length);
  if (faces.length === 0) return result;
  const junctions = new Set(arrangement.junctions);
  const failed = (): WipeResult => ({ ...result, changed: new Map(), removed: new Set(), added: [], problem: 'failed' });
  // The picked ground as one region: the faces share their edges, which the union dissolves.
  const ground = fold(
    faces.map((i) => arrangement.faces[i].contours),
    (a, b) => step(a, b, 'union', junctions),
  );
  if (ground === null) return failed();
  const touched = [...new Set(faces.flatMap((i) => arrangement.faces[i].covers))].sort((a, b) => a - b);
  const painter = mode === 'merge' ? Math.max(...arrangement.faces[faces[0]].covers) : -1;
  const rebuilt = (contours: Vec[][]): VectorAnchor[] => (contours.length > 0 ? ringsToAnchors(contours, junctions, arrangement.sources) : []);
  for (const i of touched) {
    const operand = arrangement.operands[i];
    const rest = step(operand.region, ground, 'difference', junctions);
    if (rest === null) return failed();
    const left = rebuilt(rest);
    if (i === painter) {
      const merged = markOf(operand, rebuilt(ground));
      if (left.length === 0) {
        result.changed.set(operand.stroke.id, merged);
      } else {
        result.changed.set(operand.stroke.id, markOf(operand, left));
        result.added.push({ stroke: { ...merged, id: createId('st') }, above: layerOf(sketch, operand.stroke).id });
      }
    } else if (left.length === 0) {
      result.removed.add(operand.stroke.id);
    } else {
      result.changed.set(operand.stroke.id, markOf(operand, left));
    }
  }
  result.empty = result.changed.size === 0 && result.added.length === 0 && result.removed.size === arrangement.operands.length;
  return result;
}

/** A stack's edit, and the points it was given that are on none of the faces. */
export interface StackResult extends WipeResult {
  missed: Vec[];
}

/**
 * The marks of `ids` stacked at points: the faces under `at` merged into one
 * shape - painted as the topmost mark over the first point's face - or taken
 * away, as the Shape Stacker's drag would. Points on no face are `missed`.
 */
export function stackFaces(sketch: Sketch, ids: Iterable<string>, at: readonly Vec[], mode: StackMode): StackResult {
  const arrangement = stackArrangement(sketch, ids);
  if (arrangement.problem) return { ...stackEdit(sketch, arrangement, [], mode), missed: [] };
  const picked = at.map((p) => faceAt(arrangement, p));
  return { ...stackEdit(sketch, arrangement, picked, mode), missed: at.filter((_, k) => picked[k] < 0) };
}

/** Whether a point is inside a face: inside its outline and none of its holes. */
function inFace(p: Vec, face: Face): boolean {
  let odd = false;
  for (const ring of face.contours) if (inside(p, ring)) odd = !odd;
  return odd;
}

function inBox(p: Vec, box: StackBox): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

function overlaps(a: StackBox, b: StackBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** How far along a segment it first meets a face, 0 to 1, or null when it never does. */
function entry(a: Vec, b: Vec, face: Face): number | null {
  if (inFace(a, face)) return 0;
  let first: number | null = null;
  for (const ring of face.contours) {
    for (let i = 0; i < ring.length; i++) {
      const t = segmentHit(a, b, ring[i], ring[(i + 1) % ring.length]);
      if (t !== null && (first === null || t < first)) first = t;
    }
  }
  return first;
}

/** Where segment ab meets segment cd, as a fraction along ab, or null; parallel segments never meet here. */
function segmentHit(a: Vec, b: Vec, c: Vec, d: Vec): number | null {
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
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
