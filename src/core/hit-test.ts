/**
 * What a press picks: the mark whose painted ink is under the pointer, top
 * first, or failing that the nearest within a tolerance measured in screen
 * pixels.
 *
 * The Select and Direct Select tools used to test the centreline of each
 * mark against a pad of 8 page units (or 1.5 times the width), and to take
 * the first mark in the page's list within reach. That list is not the paint
 * order, the pad did not follow the zoom, and the first in reach was not the
 * one under the pointer. Here a mark's ink is what the canvas paints - a
 * pen's pressure-scaled width, a Copic's broad nib, a profiled outline, a
 * fill's interior, a text or image box - the order is the canvas's own
 * (paint-order.ts), and the tolerance is screen pixels divided by the zoom.
 *
 * An eraser paints nothing a press could want, so it is never picked; what it
 * does is cut the marks before it in its own layer, so a press where one has
 * cut a mark away does not pick that mark either. A clip group's clip mark
 * paints nothing while it clips, and what the clip hides is not there to pick
 * (core/clip.ts) - unless the press asks to reach through clips, as Direct
 * Select's does.
 *
 * Nothing here touches the DOM; a host that can measure text passes a
 * measure.
 */

import { strokeBounds } from './bounds.js';
import { clipIndex, clippedAt, shownBounds } from './clip.js';
import { copicNibPolygons } from './nib.js';
import { paintLeaves } from './paint-order.js';
import { activeProfile, profileInputOf, profilePieces, profileReach } from './stroke-profile.js';
import { dashPatternFor, isImageStroke, isTextStroke, type Layer, type Point, type Sketch, type Stroke, widthAtPressure } from './types.js';

type Vec = { x: number; y: number };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Measures a text item's box, where the host can. */
export type MeasureText = (stroke: Stroke) => { width: number; height: number };

export interface HitOptions {
  /** Screen pixels to one sketch unit. */
  zoom: number;
  /** How far from a mark's ink a press may land and still pick it, in screen pixels. */
  tolerancePx: number;
  /** The marks that may be picked - visible and unlocked - or every mark when absent. */
  editable?: ReadonlySet<string>;
  /** Which layers paint, so the order is the canvas's; every layer when absent. */
  paints?: (layer: Layer) => boolean;
  measure?: MeasureText;
  /** Picks through clips: Direct Select reaches every anchor in a clip group, shown or not, the clip mark's too. */
  ignoreClips?: boolean;
}

/** How far a point is from a mark's ink, and the nearest point of the ink when the point is outside it. */
interface Nearest {
  distance: number;
  at: Vec | null;
}

const OUTSIDE: Nearest = { distance: Infinity, at: null };
const INSIDE: Nearest = { distance: 0, at: null };

/**
 * The distance from `pt` to the ink `stroke` paints, in sketch units: 0
 * inside it. Infinity for an eraser, and for a mark with nothing to paint.
 */
export function inkDistance(stroke: Stroke, pt: Vec, measure?: MeasureText): number {
  return inkNearest(stroke, pt, measure).distance;
}

/**
 * The distance from `pt` to a mark's outline, its fill left out, in sketch
 * units: 0 on the painted line. A mark whose outline is switched off measures
 * to its bare path, which is still what Direct Select and the Vector Path
 * tool edit.
 */
export function outlineDistance(stroke: Stroke, pt: Vec): number {
  if (isImageStroke(stroke) || isTextStroke(stroke)) return Infinity;
  const outline: Stroke = { ...stroke, fill: undefined, gradient: undefined, noStroke: undefined };
  if (stroke.noStroke) outline.width = 0;
  return inkNearest(outline, pt).distance;
}

/**
 * The mark a press at `pt` picks: the topmost, in paint order, whose ink
 * contains the point; failing that, the nearest whose ink lies within the
 * tolerance, the topmost of any that are equally near. Null when none is.
 *
 * Ink an eraser has cut away does not count: a press inside the cut does not
 * pick the mark, and nor does one near it whose nearest ink is gone.
 */
export function hitMark(sketch: Sketch, pt: Vec, options: HitOptions): Stroke | null {
  const tolerance = options.tolerancePx / options.zoom;
  let nearest: Stroke | null = null;
  let nearestDistance = Infinity;
  const clips = options.ignoreClips ? null : clipIndex(sketch);
  // Where a clip shows the mark at all; a clip mark shows nowhere while it clips.
  const shows = (stroke: Stroke, at: Vec): boolean => !clips?.any || !clippedAt(sketch, stroke, at, clips);
  const leaves = paintLeaves(sketch, options.paints);
  for (let l = leaves.length - 1; l >= 0; l--) {
    const strokes = leaves[l].strokes;
    // The erasers above the mark in hand, in its own layer: the only ones that cut it.
    const cutters: Stroke[] = [];
    const cut = (p: Vec): boolean => cutters.some((eraser) => erases(eraser, p));
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      if (stroke.tool === 'eraser') {
        cutters.push(stroke);
        continue;
      }
      if (options.editable && !options.editable.has(stroke.id)) continue;
      if (clips?.marks.has(stroke.id)) continue;
      if (!withinReach(stroke, pt, tolerance, options.measure)) continue;
      const { distance, at } = inkNearest(stroke, pt, options.measure);
      if (distance <= 0) {
        if (!cut(pt) && shows(stroke, pt)) return stroke;
        continue;
      }
      if (distance <= tolerance && distance < nearestDistance && !(at && cut(at)) && shows(stroke, at ?? pt)) {
        nearest = stroke;
        nearestDistance = distance;
      }
    }
  }
  return nearest;
}

/**
 * The marks a rubber band over `box` takes, in the page's order: every one
 * whose painted ink meets the box - a line the band only crosses, with no
 * point of its own inside, included - or whose fill holds the box's middle.
 * Text and images count by their boxes; erasers never. In a clip group the
 * band reaches only as far as the clip's bounds, and the clip mark, which
 * paints nothing, is not taken: a group is taken whole from the layers panel.
 */
export function marksInBox(
  sketch: Sketch,
  whole: Box,
  options: { editable?: ReadonlySet<string>; measure?: MeasureText } = {},
): Stroke[] {
  const clips = clipIndex(sketch);
  return sketch.strokes.filter((stroke) => {
    if (stroke.tool === 'eraser' || clips.marks.has(stroke.id)) return false;
    if (options.editable && !options.editable.has(stroke.id)) return false;
    const box = shownBounds(sketch, stroke, whole, clips);
    if (!box) return false;
    const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    if (isImageStroke(stroke) || isTextStroke(stroke)) {
      const b = strokeBounds(stroke, options.measure);
      return !!b && b.maxX >= box.minX && b.minX <= box.maxX && b.maxY >= box.minY && b.minY <= box.maxY;
    }
    const pts = stroke.points;
    if (pts.length === 0) return false;
    const filled = !!(stroke.fill || stroke.gradient) && pts.length > 2;
    if (filled && windingAt(middle, ringsOf(pts)) !== 0) return true;
    // The ink reaches as far as the widest a stroke paints; a band that comes
    // within that of the path has met it.
    const reach = stroke.noStroke ? 0 : inkReach(stroke);
    const grown = { minX: box.minX - reach, minY: box.minY - reach, maxX: box.maxX + reach, maxY: box.maxY + reach };
    if (pts.length === 1) return inBox(pts[0], grown);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].move) {
        if (inBox(pts[i], grown)) return true;
        continue;
      }
      if (segmentMeetsBox(pts[i - 1], pts[i], grown)) return true;
    }
    // A fill closes each contour back to its start.
    if (filled) {
      for (const ring of ringsOf(pts)) {
        if (ring.length > 2 && segmentMeetsBox(ring[ring.length - 1], ring[0], grown)) return true;
      }
    }
    return false;
  });
}

// ---- The ink ---------------------------------------------------------------------

/** How far `pt` is from the ink `stroke` paints, by the same rules the canvas paints it with. */
function inkNearest(stroke: Stroke, pt: Vec, measure?: MeasureText): Nearest {
  if (stroke.tool === 'eraser') return OUTSIDE;
  if (isImageStroke(stroke) || isTextStroke(stroke)) {
    const box = strokeBounds(stroke, measure);
    return box ? boxNearest(pt, box) : OUTSIDE;
  }
  const pts = stroke.points;
  if (pts.length === 0) return OUTSIDE;

  let best = OUTSIDE;
  // A fill or a gradient paints the closed interior, each contour of a
  // compound shape a subpath of its own, under the non-zero rule.
  if ((stroke.fill || stroke.gradient) && pts.length > 2) {
    const rings = ringsOf(pts);
    if (windingAt(pt, rings) !== 0) return INSIDE;
    best = ringsNearest(pt, rings);
  }
  // A switched-off outline leaves the fill alone.
  if (stroke.noStroke) return best;

  // The Copic's chisel nib, and a profiled outline, paint as shapes.
  if (stroke.tool === 'copic') return nearer(best, piecesNearest(pt, copicNibPolygons(stroke)));
  if (activeProfile(stroke)) return nearer(best, piecesNearest(pt, profilePieces(profileInputOf(stroke))));

  // A dot, sized by its pressure.
  if (pts.length === 1) {
    const p = pts[0];
    const radius = Math.max(0.5, (stroke.width * widthAtPressure(stroke.tool, p.pressure)) / 2);
    return nearer(best, discNearest(pt, p, radius));
  }

  // A line: every segment a capsule as wide as the painter strokes it. A
  // dashed or dotted line is uniform and counts as solid, so its gaps pick it
  // too; a pen lift between a compound shape's contours paints nothing.
  const dashed = dashPatternFor(stroke.strokeStyle, stroke.width).length > 0;
  const uniform = dashed || stroke.tool === 'marker';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.move) continue;
    const scale = uniform ? 1 : widthAtPressure(stroke.tool, ((a.pressure ?? 0.5) + (b.pressure ?? 0.5)) / 2);
    const found = discNearest(pt, segmentNearest(pt, a, b), Math.max(0.5, stroke.width * scale) / 2);
    if (found.distance <= 0) return INSIDE;
    best = nearer(best, found);
  }
  return best;
}

/**
 * Whether an eraser has cut the ink at `p`. It paints as the pen paints, at
 * its full width: a dot, or a capsule along each segment.
 */
function erases(eraser: Stroke, p: Vec): boolean {
  const pts = eraser.points;
  if (pts.length === 0 || eraser.noStroke) return false;
  if (pts.length === 1) {
    const radius = Math.max(0.5, (eraser.width * (0.4 + 0.6 * (pts[0].pressure ?? 0.5))) / 2);
    return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < radius;
  }
  const half = Math.max(0.5, eraser.width) / 2;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].move) continue;
    if (segmentDistance(p, pts[i - 1], pts[i]) < half) return true;
  }
  return false;
}

/** How far a mark's ink can reach from its path: half its widest painted width, or a Copic's nib. */
export function inkReach(stroke: Stroke): number {
  if (stroke.tool === 'copic') return Math.max(1, stroke.width) / 2 + Math.max(0.75, stroke.width * 0.07);
  const profile = activeProfile(stroke);
  if (profile) return (Math.max(0, stroke.width) / 2) * profileReach(profile);
  return Math.max(0.5, stroke.width) / 2;
}

/** A cheap first look: whether `pt` is inside the mark's bounds grown by its reach and the tolerance. */
function withinReach(stroke: Stroke, pt: Vec, tolerance: number, measure?: MeasureText): boolean {
  const box = strokeBounds(stroke, measure);
  if (!box) return false;
  const grow = tolerance + (isImageStroke(stroke) || isTextStroke(stroke) ? 0 : inkReach(stroke));
  return pt.x >= box.minX - grow && pt.x <= box.maxX + grow && pt.y >= box.minY - grow && pt.y <= box.maxY + grow;
}

// ---- Geometry ----------------------------------------------------------------------

function nearer(a: Nearest, b: Nearest): Nearest {
  return b.distance < a.distance ? b : a;
}

/** The contours of a mark's points: a `move` starts a new one. */
function ringsOf(pts: Point[]): Vec[][] {
  const rings: Vec[][] = [];
  let ring: Vec[] = [];
  for (const p of pts) {
    if (p.move && ring.length > 0) {
      rings.push(ring);
      ring = [];
    }
    ring.push(p);
  }
  if (ring.length > 0) rings.push(ring);
  return rings;
}

/** The winding number of closed contours about `pt`: non-zero is inside, under the non-zero rule. */
function windingAt(pt: Vec, rings: Vec[][]): number {
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a.y <= pt.y) {
        if (b.y > pt.y && cross(a, b, pt) > 0) winding++;
      } else if (b.y <= pt.y && cross(a, b, pt) < 0) {
        winding--;
      }
    }
  }
  return winding;
}

/** Which side of the line a-b `pt` is on: positive to the left. */
function cross(a: Vec, b: Vec, pt: Vec): number {
  return (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
}

/** The nearest point on the edges of closed contours. */
function ringsNearest(pt: Vec, rings: Vec[][]): Nearest {
  let best = OUTSIDE;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const at = segmentNearest(pt, ring[i], ring[(i + 1) % ring.length]);
      best = nearer(best, { distance: Math.hypot(pt.x - at.x, pt.y - at.y), at });
    }
  }
  return best;
}

/** The nearest ink of shapes filled together under the non-zero rule: inside any is inside. */
function piecesNearest(pt: Vec, pieces: Vec[][]): Nearest {
  let best = OUTSIDE;
  for (const piece of pieces) {
    if (piece.length < 3) continue;
    if (windingAt(pt, [piece]) !== 0) return INSIDE;
    best = nearer(best, ringsNearest(pt, [piece]));
  }
  return best;
}

/** The nearest point of a disc of `radius` about `centre`. */
function discNearest(pt: Vec, centre: Vec, radius: number): Nearest {
  const d = Math.hypot(pt.x - centre.x, pt.y - centre.y);
  if (d <= radius) return INSIDE;
  const k = radius / d;
  return { distance: d - radius, at: { x: centre.x + (pt.x - centre.x) * k, y: centre.y + (pt.y - centre.y) * k } };
}

function boxNearest(pt: Vec, box: Box): Nearest {
  const at = {
    x: Math.min(box.maxX, Math.max(box.minX, pt.x)),
    y: Math.min(box.maxY, Math.max(box.minY, pt.y)),
  };
  const distance = Math.hypot(pt.x - at.x, pt.y - at.y);
  return distance === 0 ? INSIDE : { distance, at };
}

/** The point of the segment a-b nearest `p`. */
function segmentNearest(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const at = segmentNearest(p, a, b);
  return Math.hypot(p.x - at.x, p.y - at.y);
}

function inBox(p: Vec, box: Box): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

/** Whether the segment a-b touches the box: an end inside it, or a crossing of one of its sides. */
function segmentMeetsBox(a: Vec, b: Vec, box: Box): boolean {
  if (inBox(a, box) || inBox(b, box)) return true;
  // Clip the segment's parameter range against each slab (Liang-Barsky).
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clips: Array<[number, number]> = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}
