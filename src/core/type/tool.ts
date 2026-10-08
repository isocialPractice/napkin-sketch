/**
 * What the Text tool makes of a gesture, with no DOM: one tool reads what is
 * under the pointer, what is selected and the keys held, as a vector editor's
 * Type, Area Type and Type on a Path tools would between them. Only a
 * selected path turns into type - a path the pointer merely crosses stays as
 * it is - so a click on art that is not selected types beside it.
 *
 * | Gesture | Result |
 * | --- | --- |
 * | Ctrl held | the selection tool (the Ctrl spring) |
 * | click on a text mark | edit it |
 * | click on a selected open path | Path Typing on it, from the click |
 * | click inside, or on, a selected closed shape | Sheet Typing inside it |
 * | Alt + click on a selected closed shape | Path Typing on its outline |
 * | Alt + click on a selected open path | Sheet Typing in the region it closes |
 * | drag on the canvas | Sheet Typing in a new rectangle |
 * | click on the canvas, or on art not selected | Sideless Typing at the click |
 * | Ctrl+V with a path selected, text on the clipboard, none being typed | Path Typing of the text, from the path's start |
 *
 * Below the table: the path a mark gives the tool to type on, a text made
 * from it, and the brackets of a text along a path - where its start, its
 * middle and its end stand - and what dragging one does.
 */

import { lengthTable, nearestLength, pointAtLength, tangentAtLength, type Vec } from '../arc-length.js';
import { fitCurve } from '../fit-curve.js';
import { sampleOutline } from '../path-data.js';
import { isClosedStroke, isImageStroke, isTextStroke, type Stroke, type VectorAnchor } from '../types.js';
import { typeSpecOf, withTypeset, type TypeFrame, type TypePath } from './model.js';

/** What is under the pointer. */
export type TypeToolHit =
  | { kind: 'text'; id: string }
  /** A path the tool can type on: open or closed, and whether the pointer is on its outline or inside it. */
  | { kind: 'path'; id: string; closed: boolean; where: 'outline' | 'inside' }
  /** Anything else drawn: a mark with no path to type on, a picture. */
  | { kind: 'art'; id: string };

/** A gesture, and what surrounds it. */
export interface TypeToolInput {
  /** A press let go where it was, a press dragged, or a paste (Ctrl+V). */
  gesture: 'click' | 'drag' | 'paste';
  /** What is under the pointer, or null for the bare canvas. */
  hit: TypeToolHit | null;
  /** The marks selected now. */
  selected: ReadonlySet<string>;
  modifiers: { ctrl?: boolean; alt?: boolean };
  /** For a paste: the clipboard's text, the one path selected, and whether a text is being typed. */
  clipboard?: { text: string | null; path: { id: string; closed: boolean } | null; editing: boolean };
}

/** What the gesture does. */
export type TypeToolAction =
  | { kind: 'spring' }
  | { kind: 'edit'; id: string }
  /** Path Typing on a path, from the click; on a closed shape, on its outline. */
  | { kind: 'path-type'; pathId: string; closed: boolean }
  /** Sheet Typing in a closed shape - or an open path, which its frame closes. */
  | { kind: 'sheet-type'; pathId: string }
  /** Sheet Typing in a new rectangle, the drag's. */
  | { kind: 'sheet-box' }
  /** Sideless Typing at the click. */
  | { kind: 'point-type' }
  /** The clipboard's text as Path Typing on the selected path, from its start. */
  | { kind: 'paste-on-path'; pathId: string; closed: boolean }
  /** Nothing of the Text tool's: the ordinary paste. */
  | { kind: 'none' };

/** What the Text tool does with a gesture: see the module's table. */
export function typeToolAction(input: TypeToolInput): TypeToolAction {
  const { gesture, hit, selected, modifiers } = input;
  if (gesture === 'paste') {
    const clip = input.clipboard;
    const text = clip?.text?.trim() ?? '';
    if (!clip || clip.editing || !clip.path || text === '' || !selected.has(clip.path.id)) return { kind: 'none' };
    return { kind: 'paste-on-path', pathId: clip.path.id, closed: clip.path.closed };
  }
  if (modifiers.ctrl) return { kind: 'spring' };
  if (hit?.kind === 'text') return { kind: 'edit', id: hit.id };
  if (hit?.kind === 'path' && selected.has(hit.id)) {
    if (hit.closed) {
      // Alt turns a closed shape's area into its outline, as a vector editor's Alt does between area and path type.
      return modifiers.alt ? { kind: 'path-type', pathId: hit.id, closed: true } : { kind: 'sheet-type', pathId: hit.id };
    }
    // An open path is typed on where it is pressed; a press near it but off it is the canvas's.
    if (hit.where === 'outline') return modifiers.alt ? { kind: 'sheet-type', pathId: hit.id } : { kind: 'path-type', pathId: hit.id, closed: false };
  }
  return gesture === 'drag' ? { kind: 'sheet-box' } : { kind: 'point-type' };
}

/** What a click there would make, for the pointer to show: Sideless, Sheet or Path Typing, or the text's I-beam. */
export function typeToolCursor(action: TypeToolAction): 'point' | 'area' | 'path' | 'edit' | 'spring' {
  switch (action.kind) {
    case 'path-type':
    case 'paste-on-path':
      return 'path';
    case 'sheet-type':
    case 'sheet-box':
      return 'area';
    case 'edit':
      return 'edit';
    case 'spring':
      return 'spring';
    default:
      return 'point';
  }
}


// ---- Paths into type ------------------------------------------------------------------------------------

/** How far a fitted outline may stray from a shape's drawn points, page pixels. */
const FIT_TOLERANCE = 0.75;

/** The least room a path's start and end leave between them, page pixels. */
const BRACKET_GAP = 1;

/** A path the Text tool can type on, on the page: its Bezier anchors, and whether it closes. */
export interface TypeablePath {
  anchors: VectorAnchor[];
  closed: boolean;
}

/**
 * The path a mark gives the Text tool: its own anchors, or for a mark drawn
 * as points - a rectangle, an ellipse - the fewest cubics within a fraction
 * of a pixel of them. Null for a mark with no single path: text, a picture,
 * an eraser's mark, a compound shape.
 */
export function typeablePath(stroke: Stroke): TypeablePath | null {
  if (stroke.tool === 'eraser' || isTextStroke(stroke) || isImageStroke(stroke)) return null;
  const vector = stroke.vector;
  if (vector) {
    if (vector.anchors.length < 2 || vector.anchors.some((a, i) => i > 0 && a.move)) return null;
    return { anchors: vector.anchors.map((a) => ({ p: { x: a.p.x, y: a.p.y }, ...(a.hIn ? { hIn: { ...a.hIn } } : {}), ...(a.hOut ? { hOut: { ...a.hOut } } : {}) })), closed: vector.closed === true };
  }
  if (stroke.points.length < 2 || stroke.points.some((p) => p.move)) return null;
  const closed = isClosedStroke(stroke);
  const anchors = fitCurve(stroke.points, { tolerance: FIT_TOLERANCE, closed });
  if (!anchors || anchors.length < 2) return null;
  return { anchors: anchors.map((a) => ({ p: { x: a.p.x, y: a.p.y }, ...(a.hIn ? { hIn: { ...a.hIn } } : {}), ...(a.hOut ? { hOut: { ...a.hOut } } : {}) })), closed };
}

/** The distance from `p` to a polyline. */
function polylineDistance(points: readonly Vec[], p: Vec, closed: boolean): number {
  let best = Infinity;
  const n = points.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

/** Whether `p` is inside a closed outline, by the even-odd rule. */
function inside(points: readonly Vec[], p: Vec): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Where a point is on a path: on its outline, within `reach` of it, or inside it when it closes; null elsewhere. */
export function pathHitAt(path: TypeablePath, p: Vec, reach: number): 'outline' | 'inside' | null {
  const outline = sampleOutline(path.anchors, path.closed);
  if (outline.length < 2) return null;
  if (polylineDistance(outline, p, path.closed) <= reach) return 'outline';
  return path.closed && inside(outline, p) ? 'inside' : null;
}

/**
 * A new text set on a path: Sheet Typing inside it - its frame the path,
 * closed, with the path's paint for its own - or Path Typing along it, from
 * `at` when given, else from its start. The mark's anchor is the path's
 * first anchor; the frame or the path is kept relative to it. `mark` gives
 * the text and its base: its id, size, family and color.
 */
export function typeOnPath(path: TypeablePath, mode: 'sheet' | 'path', at: Vec | null, mark: Stroke, paint: Pick<TypeFrame, 'fill' | 'stroke' | 'width'> = {}): Stroke {
  const origin = path.anchors[0].p;
  const move = (q: Vec): Vec => ({ x: q.x - origin.x, y: q.y - origin.y });
  const anchors: VectorAnchor[] = path.anchors.map((a) => ({ p: move(a.p), ...(a.hIn ? { hIn: move(a.hIn) } : {}), ...(a.hOut ? { hOut: move(a.hOut) } : {}) }));
  const placed: Stroke = { ...mark, points: [{ x: origin.x, y: origin.y, pressure: 0.5 }] };
  if (mode === 'sheet') {
    return withTypeset(placed, { kind: 'area', frame: { anchors, ...paint } });
  }
  const start = at ? nearestLength(lengthTable(path.anchors, path.closed), at).length : 0;
  return withTypeset(placed, {
    kind: 'path',
    path: { anchors, ...(path.closed ? { closed: true } : {}), start, end: Number.MAX_SAFE_INTEGER, align: 'baseline', effect: 'rainbow' },
  });
}

// ---- Brackets ----------------------------------------------------------------------------------------------

/** One of a text along a path's three brackets: where it stands, and which way the text's side is from there. */
export interface PathBracket {
  which: 'start' | 'center' | 'end';
  at: Vec;
  /** A unit vector toward the side of the path the text stands on. */
  side: Vec;
}

/** A text along a path's path on the page, the length of it the text may use, and its start, end and flip. */
function pathOf(stroke: Stroke): { path: TypePath; table: ReturnType<typeof lengthTable>; from: number; to: number } | null {
  const spec = typeSpecOf(stroke);
  const path = spec.kind === 'path' ? spec.path : undefined;
  const anchor = stroke.points[0];
  if (!path || !anchor) return null;
  const place = (q: Vec): Vec => ({ x: q.x + anchor.x, y: q.y + anchor.y });
  const page = path.anchors.map((a) => ({ p: place(a.p), ...(a.hIn ? { hIn: place(a.hIn) } : {}), ...(a.hOut ? { hOut: place(a.hOut) } : {}) }));
  const table = lengthTable(page, path.closed === true);
  const from = Math.min(table.total, path.start);
  const to = Math.max(from, Math.min(table.total, path.end));
  return { path, table, from, to };
}

/**
 * A text along a path's brackets, a vector editor's: the start bracket where
 * the text begins, the end bracket where it must stop, and the centre one
 * between them on the side the text stands. Flipped, the text runs from the
 * far end and stands on the other side. Null for a text not on a path.
 */
export function pathBrackets(stroke: Stroke): PathBracket[] | null {
  const found = pathOf(stroke);
  if (!found) return null;
  const { path, table, from, to } = found;
  const flip = path.flip === true;
  // Unflipped the text stands against the path's normal, which points to its right; flipped, along it.
  const sign = flip ? 1 : -1;
  const bracket = (which: PathBracket['which'], length: number): PathBracket => {
    const t = tangentAtLength(table, length);
    // Plus 0 turns a -0 into 0.
    return { which, at: pointAtLength(table, length), side: { x: -t.y * sign + 0, y: t.x * sign + 0 } };
  };
  return [bracket('start', flip ? to : from), bracket('center', (from + to) / 2), bracket('end', flip ? from : to)];
}

/**
 * A bracket dragged to `p`: the start or the end bracket moves along the
 * path to the place nearest `p`, never past the other; the centre bracket,
 * dragged across the path, flips the text to that side. Null when the drag
 * changes nothing.
 */
export function dragBracket(stroke: Stroke, which: PathBracket['which'], p: Vec): Partial<TypePath> | null {
  const found = pathOf(stroke);
  if (!found) return null;
  const { path, table, from, to } = found;
  const flip = path.flip === true;
  const near = nearestLength(table, p);
  if (which === 'center') {
    const t = tangentAtLength(table, near.length);
    const across = (p.x - near.point.x) * -t.y + (p.y - near.point.y) * t.x;
    if (Math.abs(across) < 1e-6) return null;
    // On the normal's side the text is flipped; against it, not.
    const wants = across > 0;
    return wants === flip ? null : { flip: wants };
  }
  // The start bracket is where the text begins: the path's start, or flipped its end.
  const field = (which === 'start') !== flip ? 'start' : 'end';
  if (field === 'start') {
    const start = Math.max(0, Math.min(to - BRACKET_GAP, near.length));
    return Math.abs(start - path.start) < 1e-9 ? null : { start };
  }
  const end = Math.max(from + BRACKET_GAP, Math.min(table.total, near.length));
  return Math.abs(end - Math.min(table.total, path.end)) < 1e-9 ? null : { end };
}

/** Where a text that does not fit shows its red plus: a frame's lower right corner, or a path text's end bracket. Null when it fits. */
export function oversetPort(stroke: Stroke, layout: { overset: boolean; frame?: { box: { maxX: number; maxY: number } } }): Vec | null {
  if (!layout.overset) return null;
  if (layout.frame) return { x: layout.frame.box.maxX, y: layout.frame.box.maxY };
  const brackets = pathBrackets(stroke);
  return brackets ? brackets[2].at : null;
}
