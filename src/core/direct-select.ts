/**
 * Direct Select's picks: which anchor points, and which segments between
 * them, a box picks across the marks it reaches, and what a move of those
 * picks carries.
 *
 * A segment is named by the anchor it starts from: segment `i` runs from
 * anchor `i` to the next anchor of the same subpath. A closed path of
 * anchors closes each subpath back to its first anchor, so a subpath's last
 * anchor names that closing segment. A mark of bare points has no closing
 * segment to imply - a ring of bare points closes by its last point sitting
 * on its first - so its segment `i` always ends at point `i + 1`.
 *
 * The box picks anchors or segments, never both: anchors whenever it holds
 * any, across every mark it reaches; failing that, every segment that passes
 * through it; failing that, nothing, and the selection stays as it was.
 *
 * Nothing here touches the DOM, and nothing is changed: the drawing window
 * keeps the picks and makes the edits.
 */

// REUSE: core/hit-test.ts's slab test, which the Select tool's rubber band
// meets ink with, and its distance to a segment, which a press is picked by.
import { segmentDistance, segmentMeetsBox } from './hit-test.js';
import { isImageStroke, isTextStroke, type Stroke, type VectorAnchor } from './types.js';
import { cubicBezierPoints } from '../sharpen/geometry.js';

type Vec = { x: number; y: number };

/** A box in page units, its sides in order. */
export interface PickBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What Direct Select holds on one mark: anchor indices, and segments by the anchor each starts from. */
export interface PointPick {
  anchors: Set<number>;
  segments: Set<number>;
}

/** Direct Select's picks across marks, by mark id. */
export type PointPicks = Map<string, PointPick>;

/** One segment of a mark: its name (the anchor it starts from) and the anchors at its ends. */
export interface Segment {
  index: number;
  from: number;
  to: number;
}

/** An empty pick, for a mark that holds nothing yet. */
export function emptyPick(): PointPick {
  return { anchors: new Set(), segments: new Set() };
}

/**
 * Whether Direct Select's box reaches a mark's anchors: a path of anchors or
 * a mark of bare points. Text keeps its frame to its own tools, and a
 * picture, a placed file and an older file's eraser mark have none.
 */
export function boxPickable(stroke: Stroke): boolean {
  if (isTextStroke(stroke) || isImageStroke(stroke) || stroke.tool === 'eraser') return false;
  return stroke.vector ? stroke.vector.anchors.length > 0 : stroke.points.length > 0;
}

/** Where a mark's anchors sit: a path's anchor points, or a mark's bare points. */
export function anchorPositions(stroke: Stroke): Vec[] {
  return stroke.vector ? stroke.vector.anchors.map((a) => a.p) : stroke.points;
}

/** Every segment of a mark, in order. */
export function segmentsOf(stroke: Stroke): Segment[] {
  const out: Segment[] = [];
  if (stroke.vector) {
    const anchors = stroke.vector.anchors;
    const closed = stroke.vector.closed === true;
    let start = 0;
    for (let i = 0; i < anchors.length; i++) {
      const last = i + 1 === anchors.length || anchors[i + 1].move === true;
      if (!last) out.push({ index: i, from: i, to: i + 1 });
      else {
        // A closed subpath of two or more anchors closes back to its first.
        if (closed && i > start) out.push({ index: i, from: i, to: start });
        start = i + 1;
      }
    }
    return out;
  }
  const points = stroke.points;
  for (let i = 0; i + 1 < points.length; i++) {
    if (!points[i + 1].move) out.push({ index: i, from: i, to: i + 1 });
  }
  return out;
}

/** A segment as a polyline: a straight segment's two ends, or a curved one sampled along its cubic. */
export function segmentPolyline(stroke: Stroke, segment: Segment): Vec[] {
  if (!stroke.vector) {
    const a = stroke.points[segment.from];
    const b = stroke.points[segment.to];
    return a && b ? [a, b] : [];
  }
  const a: VectorAnchor | undefined = stroke.vector.anchors[segment.from];
  const b: VectorAnchor | undefined = stroke.vector.anchors[segment.to];
  if (!a || !b) return [];
  if (!a.hOut && !b.hIn) return [a.p, b.p];
  return cubicBezierPoints({ ...a.p, pressure: 0.5 }, a.hOut ?? a.p, b.hIn ?? b.p, { ...b.p, pressure: 0.5 });
}

function inBox(p: Vec, box: PickBox): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

/**
 * What one mark offers a box, before the rule that chooses between them: the
 * anchors (or bare points) inside it, and the segments that pass through it,
 * a curved segment by its curve rather than its chord.
 */
export function pickInBox(stroke: Stroke, box: PickBox): PointPick {
  const pick = emptyPick();
  if (!boxPickable(stroke)) return pick;
  anchorPositions(stroke).forEach((p, i) => {
    if (inBox(p, box)) pick.anchors.add(i);
  });
  for (const segment of segmentsOf(stroke)) {
    const line = segmentPolyline(stroke, segment);
    for (let k = 1; k < line.length; k++) {
      if (segmentMeetsBox(line[k - 1], line[k], box)) {
        pick.segments.add(segment.index);
        break;
      }
    }
  }
  return pick;
}

/**
 * The picks a Direct Select box makes across `strokes`: the anchors it holds
 * when it holds any, on whichever marks they are; otherwise the segments
 * passing through it; otherwise none, an empty map, which leaves the
 * selection as it was.
 */
export function boxPicks(strokes: readonly Stroke[], box: PickBox): PointPicks {
  const offered = strokes.map((stroke) => ({ id: stroke.id, pick: pickInBox(stroke, box) }));
  const anchored = offered.filter((o) => o.pick.anchors.size > 0);
  const picks: PointPicks = new Map();
  if (anchored.length > 0) {
    for (const { id, pick } of anchored) picks.set(id, { anchors: pick.anchors, segments: new Set() });
    return picks;
  }
  for (const { id, pick } of offered) {
    if (pick.segments.size > 0) picks.set(id, { anchors: new Set(), segments: pick.segments });
  }
  return picks;
}

/**
 * Whether `p` lies within `reach` of one of a mark's picked segments, along
 * the line each draws: a press there takes hold of the picks to move them.
 */
export function onPickedSegment(stroke: Stroke, segments: ReadonlySet<number>, p: Vec, reach: number): boolean {
  if (segments.size === 0) return false;
  for (const segment of segmentsOf(stroke)) {
    if (!segments.has(segment.index)) continue;
    const line = segmentPolyline(stroke, segment);
    for (let k = 1; k < line.length; k++) {
      if (segmentDistance(p, line[k - 1], line[k]) <= reach) return true;
    }
  }
  return false;
}

/**
 * Adds `more` to `picks` (Shift with the box), a mark at a time: what a mark
 * held stays, and what the box picked joins it.
 */
export function addPicks(picks: PointPicks, more: PointPicks): PointPicks {
  const out: PointPicks = new Map();
  for (const [id, pick] of picks) out.set(id, { anchors: new Set(pick.anchors), segments: new Set(pick.segments) });
  for (const [id, pick] of more) {
    const into = out.get(id) ?? emptyPick();
    for (const a of pick.anchors) into.anchors.add(a);
    for (const s of pick.segments) into.segments.add(s);
    out.set(id, into);
  }
  return out;
}

/**
 * The indices a move of a mark's pick carries: its anchors, both ends of
 * each of its segments, and the seam twin of any of them on a ring whose
 * ends meet.
 */
export function movedPoints(stroke: Stroke, pick: PointPick): number[] {
  const moved = new Set(pick.anchors);
  if (pick.segments.size > 0) {
    for (const segment of segmentsOf(stroke)) {
      if (!pick.segments.has(segment.index)) continue;
      moved.add(segment.from);
      moved.add(segment.to);
    }
  }
  return withSeamTwins(anchorPositions(stroke), moved);
}

/**
 * A ring of bare points closes by its last point sitting on its first, so
 * the two are one corner: picking either picks both, and they move as one.
 */
export function withSeamTwins(points: readonly Vec[], picked: Iterable<number>): number[] {
  const out = new Set(picked);
  const last = points.length - 1;
  const first = points[0];
  const end = points[last];
  if (last >= 2 && first && end && Math.hypot(first.x - end.x, first.y - end.y) < 1e-6) {
    if (out.has(0)) out.add(last);
    if (out.has(last)) out.add(0);
  }
  return [...out];
}
