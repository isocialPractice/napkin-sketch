/**
 * The outlines the shape verbs draw, as Bezier anchors.
 *
 * Every shape is anchors and handles, never samples. A circle is four cubic
 * curves whose handles reach `4/3 (sqrt 2 - 1)` of the radius along the
 * tangents; an arc is pieces of at most a quarter turn with handles
 * `4/3 tan(a/4)` of the radius, `a` being the piece's angle; a rounded
 * rectangle's corners are quarter arcs, and a rounded polygon's are arcs of
 * whatever angle the corner turns through. The circle, the ellipse and the
 * rounded rectangle are built with the same helpers the SVG importer builds
 * the elements of those names with, so a generated circle and an imported one
 * are the same curve.
 *
 * Coordinates here are pixels in the script's local frame. The evaluator maps
 * the anchors through the transform afterwards, which an affine transform
 * allows without touching the curve.
 */

import { KAPPA, SubpathBuilder, arcToCubics, type ParsedSubpath } from '../path-data.js';
import type { VectorAnchor } from '../types.js';

type P = { x: number; y: number };

const DEGREES = Math.PI / 180;

/** One mark's geometry: its anchors, each subpath after the first starting with `move`, and whether it closes. */
export interface Outline {
  anchors: VectorAnchor[];
  closed: boolean;
}

const same = (a: P, b: P): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** A straight line between two points. */
export function lineOutline(a: P, b: P): Outline {
  return { anchors: [{ p: { ...a } }, { p: { ...b } }], closed: false };
}

/** Straight segments through points: a polyline, or a polygon when closed. */
export function polyOutline(points: readonly P[], closed: boolean): Outline {
  return { anchors: points.map((p) => ({ p: { ...p } })), closed };
}

/**
 * A polygon with every corner rounded to `radius` by {@link roundedCornerAnchors}.
 * A rounded square is the rounded rectangle of the same size, anchor for
 * anchor. Repeated points are dropped first, since an edge of no length has no
 * direction to round along.
 */
export function roundedPolygonOutline(points: readonly P[], radius: number): Outline {
  const corners: P[] = [];
  for (const p of points) if (corners.length === 0 || !same(corners[corners.length - 1], p)) corners.push({ x: p.x, y: p.y });
  while (corners.length > 1 && same(corners[0], corners[corners.length - 1])) corners.pop();
  if (corners.length < 3 || !(radius > 0)) return polyOutline(corners, true);
  const n = corners.length;
  const anchors: VectorAnchor[] = [];
  for (let i = 0; i < n; i++) {
    for (const anchor of roundedCornerAnchors(corners[(i + n - 1) % n], corners[i], corners[(i + 1) % n], radius)) {
      const last = anchors[anchors.length - 1];
      // Two fillets that take half an edge each meet in its middle, and share the anchor there.
      if (last && same(last.p, anchor.p)) {
        if (anchor.hOut) last.hOut = anchor.hOut;
        continue;
      }
      anchors.push(anchor);
    }
  }
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (anchors.length > 2 && same(first.p, last.p)) {
    anchors.pop();
    if (last.hIn) first.hIn = last.hIn;
  }
  return { anchors, closed: true };
}

/**
 * One corner of a polygon, rounded: the arc of a circle of `radius` that
 * touches both edges meeting at `corner` - a fillet - running from the edge
 * that comes in from `prev` to the edge that goes on to `next`. For a corner
 * of angle `a`, the arc touches each edge `radius / tan(a/2)` from the corner,
 * its centre lies on the corner's bisector `radius / sin(a/2)` from it, and it
 * turns through `180 - a` degrees, built by {@link arcAnchors}.
 *
 * The radius is held so that the arc takes no more than half of either edge,
 * which lets the fillets at the two ends of an edge meet in its middle but
 * never cross. A corner whose edges run straight on, or turn straight back,
 * has nothing to round and stays one plain anchor.
 */
export function roundedCornerAnchors(prev: P, corner: P, next: P, radius: number): VectorAnchor[] {
  const lengthIn = Math.hypot(prev.x - corner.x, prev.y - corner.y);
  const lengthOut = Math.hypot(next.x - corner.x, next.y - corner.y);
  if (!(radius > 0) || lengthIn < 1e-9 || lengthOut < 1e-9) return [{ p: { ...corner } }];
  const u1 = { x: (prev.x - corner.x) / lengthIn, y: (prev.y - corner.y) / lengthIn };
  const u2 = { x: (next.x - corner.x) / lengthOut, y: (next.y - corner.y) / lengthOut };
  const angle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return [{ p: { ...corner } }];
  const half = angle / 2;
  const reach = Math.min(radius / Math.tan(half), lengthIn / 2, lengthOut / 2);
  const r = reach * Math.tan(half);
  const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
  const toCentre = r / Math.sin(half) / Math.hypot(bisector.x, bisector.y);
  const centre = { x: corner.x + bisector.x * toCentre, y: corner.y + bisector.y * toCentre };
  const start = Math.atan2(corner.y + u1.y * reach - centre.y, corner.x + u1.x * reach - centre.x);
  const end = Math.atan2(corner.y + u2.y * reach - centre.y, corner.x + u2.x * reach - centre.x);
  // The arc turns through less than half a circle, so the shorter way round is the right one.
  let sweep = end - start;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  return arcAnchors(centre.x, centre.y, r, start, sweep);
}

/**
 * A rectangle, with corners rounded to `radius` when it is given. The radius
 * is held to half the shorter side, as SVG holds it, which makes a square
 * with the largest radius a circle.
 */
export function rectOutline(x: number, y: number, width: number, height: number, radius = 0): Outline {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const builder = new SubpathBuilder();
  let at: P = { x, y };
  const lineTo = (to: P): void => {
    if (!same(at, to)) builder.lineTo(to);
    at = to;
  };
  if (r <= 0) {
    builder.moveTo(at);
    lineTo({ x: x + width, y });
    lineTo({ x: x + width, y: y + height });
    lineTo({ x, y: y + height });
    builder.close();
    return { anchors: builder.subpaths[0].anchors, closed: true };
  }
  const corner = (to: P): void => {
    for (const [c1, c2, end] of arcToCubics(at, r, r, 0, false, true, to)) builder.cubicTo(c1, c2, end);
    at = to;
  };
  at = { x: x + r, y };
  builder.moveTo(at);
  lineTo({ x: x + width - r, y });
  corner({ x: x + width, y: y + r });
  lineTo({ x: x + width, y: y + height - r });
  corner({ x: x + width - r, y: y + height });
  lineTo({ x: x + r, y: y + height });
  corner({ x, y: y + height - r });
  lineTo({ x, y: y + r });
  corner({ x: x + r, y });
  builder.close();
  return { anchors: builder.subpaths[0].anchors, closed: true };
}

/**
 * An ellipse, or a circle when the radii agree: four anchors on its axes,
 * starting at three o'clock and running clockwise, each with handles KAPPA of
 * its radius along the tangent.
 */
export function ellipseOutline(cx: number, cy: number, rx: number, ry: number): Outline {
  const anchors: VectorAnchor[] = [];
  for (let k = 0; k < 4; k++) {
    const theta = (k * Math.PI) / 2;
    const p = { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
    const tangent = { x: -rx * Math.sin(theta), y: ry * Math.cos(theta) };
    anchors.push({
      p,
      hIn: { x: p.x - KAPPA * tangent.x, y: p.y - KAPPA * tangent.y },
      hOut: { x: p.x + KAPPA * tangent.x, y: p.y + KAPPA * tangent.y },
    });
  }
  return { anchors, closed: true };
}

/**
 * An open arc of a circle from one angle to another, in degrees clockwise from
 * three o'clock. It turns clockwise when `to` is greater than `from` and the
 * other way when it is smaller, and no further than one full turn.
 */
export function arcOutline(cx: number, cy: number, r: number, from: number, to: number): Outline {
  const sweep = Math.max(-360, Math.min(360, to - from));
  return { anchors: arcAnchors(cx, cy, r, from * DEGREES, sweep * DEGREES), closed: false };
}

/**
 * The anchors of an arc of a circle: from the angle `start` (radians,
 * clockwise from three o'clock on a page whose y runs down) turning through
 * `sweep`, clockwise when it is positive. The arc is cut into pieces of at
 * most a quarter turn, and each piece is the cubic whose handles lie along
 * the circle's tangents at its ends, `4/3 tan(a/4)` of the radius long for a
 * piece of angle `a` - the cubic that meets the circle at both ends and in
 * the middle, and strays from it by less than 0.03 percent of the radius.
 * The first anchor has only an outgoing handle and the last only an incoming
 * one, so an arc joins straight edges on either side. The arc verb and the
 * rounded corners of a polygon are both built with it.
 */
export function arcAnchors(cx: number, cy: number, r: number, start: number, sweep: number): VectorAnchor[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): P => ({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  const tangent = (t: number): P => ({ x: -r * Math.sin(t), y: r * Math.cos(t) });
  const anchors: VectorAnchor[] = [{ p: point(start) }];
  for (let k = 0; k < pieces; k++) {
    const t0 = start + k * step;
    const t1 = t0 + step;
    const d0 = tangent(t0);
    const d1 = tangent(t1);
    const last = anchors[anchors.length - 1];
    last.hOut = { x: last.p.x + alpha * d0.x, y: last.p.y + alpha * d0.y };
    const p1 = point(t1);
    anchors.push({ p: p1, hIn: { x: p1.x - alpha * d1.x, y: p1.y - alpha * d1.y } });
  }
  return anchors;
}

/**
 * A star: `count` points on the outer radius and as many on the inner one
 * between them, the first point straight up.
 */
export function starOutline(cx: number, cy: number, outer: number, inner: number, count: number): Outline {
  const anchors: VectorAnchor[] = [];
  for (let k = 0; k < count * 2; k++) {
    const theta = ((-90 + (k * 180) / count) * Math.PI) / 180;
    const r = k % 2 === 0 ? outer : inner;
    anchors.push({ p: { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) } });
  }
  return { anchors, closed: true };
}

/**
 * An Archimedean spiral from its centre out to `r`, winding clockwise over
 * `turns` full turns, as cubic pieces of a quarter turn each. Each piece takes
 * its handles from the spiral's own tangent at its ends, a third of the piece
 * along it, which is the cubic that matches the curve's position and direction
 * at both ends.
 */
export function spiralOutline(cx: number, cy: number, r: number, turns: number): Outline {
  const total = turns * 2 * Math.PI;
  const growth = r / total;
  const pieces = Math.max(1, Math.ceil(turns * 4 - 1e-9));
  const step = total / pieces;
  const point = (t: number): P => ({ x: cx + growth * t * Math.cos(t), y: cy + growth * t * Math.sin(t) });
  const velocity = (t: number): P => ({
    x: growth * Math.cos(t) - growth * t * Math.sin(t),
    y: growth * Math.sin(t) + growth * t * Math.cos(t),
  });
  const anchors: VectorAnchor[] = [{ p: point(0) }];
  for (let k = 0; k < pieces; k++) {
    const t0 = k * step;
    const t1 = t0 + step;
    const v0 = velocity(t0);
    const v1 = velocity(t1);
    const last = anchors[anchors.length - 1];
    last.hOut = { x: last.p.x + (v0.x * step) / 3, y: last.p.y + (v0.y * step) / 3 };
    const p1 = point(t1);
    anchors.push({ p: p1, hIn: { x: p1.x - (v1.x * step) / 3, y: p1.y - (v1.y * step) / 3 } });
  }
  return { anchors, closed: false };
}

/**
 * Joins subpaths into one mark. A mark closes all of its subpaths or none, so
 * when some are closed and some open, the closed ones are written with an
 * explicit segment back to their start and the mark stays open. Subpaths
 * after the first begin with a `move`. Returns null when there is nothing to
 * draw.
 */
export function joinSubpaths(subpaths: readonly ParsedSubpath[]): Outline | null {
  const drawable = subpaths.filter((sub) => sub.anchors.length >= 2);
  if (drawable.length === 0) return null;
  const closed = drawable.every((sub) => sub.closed);
  const anchors: VectorAnchor[] = [];
  drawable.forEach((sub, index) => {
    const list: VectorAnchor[] = sub.anchors.map((a) => {
      const copy: VectorAnchor = { p: { ...a.p } };
      if (a.hIn) copy.hIn = { ...a.hIn };
      if (a.hOut) copy.hOut = { ...a.hOut };
      return copy;
    });
    if (!closed && sub.closed) {
      // The closing segment arrives at the start along the start's incoming handle.
      const first = list[0];
      const end: VectorAnchor = { p: { ...first.p } };
      if (first.hIn) end.hIn = first.hIn;
      delete first.hIn;
      list.push(end);
    }
    if (index > 0) list[0].move = true;
    anchors.push(...list);
  });
  return { anchors, closed };
}
