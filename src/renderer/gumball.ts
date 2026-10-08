/**
 * The gumball: the handles a selected 3D mark shows on the canvas, in place
 * of the Transform Box, to move it, turn it and scale it in depth. It stands
 * at the solid's middle as the page shows it, along the solid's own axes,
 * colored as Blender and Rhino color theirs - X red, Y green, Z blue:
 *
 * - an **arrow** along each axis moves it along that axis;
 * - a **square** between two axes moves it in their plane, and with `Alt`
 *   scales it in that plane;
 * - an **arc** round each axis turns it about that axis, `Shift` in steps of
 *   15 degrees;
 * - a **box** past each arrow's tip scales it along that axis;
 * - the **ball** in the middle moves it across the view, and with `Shift`
 *   scales it whole;
 * - the **ring** round it all turns it freely, as a trackball does.
 *
 * Every handle is the same size on the screen at any zoom. An axis pointing
 * almost at the eye hides its arrow and its box, and a plane seen almost edge
 * on its square. A drag works from the object as the press found it, so one
 * that wanders off and comes back lands where it began, and a modifier
 * pressed halfway re-reads the whole drag.
 *
 * Nothing here touches the DOM. The drawing window gives it the solid's view
 * (core/three-d/render.ts) and the pointer, draws what {@link gumballLayout}
 * places, and puts what a drag gives into the effect.
 */

import { projectPoint, rotationMatrix, type ThreeDView } from '../core/three-d/render.js';
import type { Vec3 } from '../core/three-d/mesh.js';

/** A point on the page or a direction on the screen. */
export interface Pt {
  x: number;
  y: number;
}

/** One of the solid's own axes: X, Y or Z. */
export type GumballAxis = 0 | 1 | 2;

/** A part of the gumball a press can take hold of. */
export type GumballHandle =
  | { kind: 'arrow'; axis: GumballAxis }
  | { kind: 'tip'; axis: GumballAxis }
  /** The square in the plane across `axis`: between the other two. */
  | { kind: 'plane'; axis: GumballAxis }
  | { kind: 'arc'; axis: GumballAxis }
  | { kind: 'center' }
  | { kind: 'ring' };

/** The fields of a 3D effect the gumball changes. */
export interface GumballFields {
  rotation: [number, number, number];
  position: [number, number, number];
  scale: [number, number, number];
}

/** A 3D mark as the gumball sees it: its effect's fields, and the view they give its solid. */
export interface GumballObject extends GumballFields {
  view: ThreeDView;
}

/** Each axis's color: X red, Y green, Z blue. */
export const GUMBALL_COLORS = ['#d8343e', '#2b9a3f', '#2f6feb'] as const;

/** The gumball's measures, in screen pixels. */
export const GUMBALL_PX = {
  /** The middle ball's radius. */
  ball: 7,
  /** Where an arrow's shaft starts, clear of the ball; where its head starts; and its point. */
  shaft: 11,
  head: 57,
  arrow: 70,
  headHalf: 4.5,
  /** The scale box's middle, past the arrow's point, and half its side. */
  tip: 84,
  tipHalf: 4.5,
  /** A plane square's middle, along each of its two axes, and half its side. */
  plane: 24,
  planeHalf: 6.5,
  /** The arcs' radius. */
  arc: 52,
  /** The free-turn ring's radius. */
  ring: 104,
  /** How near a line or an edge a press must land to take it. */
  reach: 6,
} as const;

/** How short an axis may look, as a share of its length, before its arrow and box hide: it points almost at the eye. */
const END_ON = 0.25;
/** How flat a plane may look before its square hides: seen almost edge on. */
const EDGE_ON = 0.2;
/**
 * Below this an arc's plane faces the eye too little - more than 60 degrees
 * off - for the point under the pointer to be read off it steadily: a short
 * move across a thin ellipse lands far off in depth. The drag is read along
 * the arc's tangent where the press took it instead.
 */
const ARC_FACING = 0.5;
/** The ranges the effect's fields keep to (core/appearance.ts's EFFECT_FIELDS). */
const POSITION_MAX = 5000;
const SCALE_MIN = 0.01;
const SCALE_MAX = 100;
/** How far a Shift turn steps, in degrees. */
export const GUMBALL_SNAP_DEGREES = 15;

// ---- Vectors and turns --------------------------------------------------------------

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 1];
};
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;

function multiply(m: readonly number[], n: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += m[i * 3 + k] * n[k * 3 + j];
  return out;
}

/** A turn's axis: the column of a row-major 3 by 3 - one of the solid's own axes as the page has it. */
function column(m: readonly number[], i: number): Vec3 {
  return [m[i], m[3 + i], m[6 + i]];
}

/** The turn by `radians` about a unit axis, row-major (Rodrigues' formula). */
export function axisTurn(axis: Vec3, radians: number): number[] {
  const [x, y, z] = unit(axis);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** An angle held to -180 to 180, as the effect keeps a turn: 180 rather than -180. */
function wrap(degrees: number): number {
  const turned = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return turned === -180 ? 180 : turned;
}

/** How far apart two angles are, the short way round. */
function apart(a: number, b: number): number {
  return Math.abs(wrap(a - b));
}

/**
 * The turns about X, then Y, then Z that make a turn - the effect's
 * `rotation` - the one of the two that do nearest `near`. Where Y stands at
 * 90 degrees only X and Z together are fixed, and Z keeps `near`'s.
 */
export function eulerOf(m: readonly number[], near: readonly [number, number, number] = [0, 0, 0]): [number, number, number] {
  const sy = Math.max(-1, Math.min(1, -m[6]));
  const y = Math.asin(sy);
  if (Math.cos(y) < 1e-6) {
    const z = rad(near[2]);
    const x = sy > 0 ? z + Math.atan2(m[1], m[4]) : Math.atan2(-m[1], m[4]) - z;
    return [wrap(deg(x)), sy > 0 ? 90 : -90, wrap(near[2])];
  }
  const one: [number, number, number] = [wrap(deg(Math.atan2(m[7], m[8]))), wrap(deg(y)), wrap(deg(Math.atan2(m[3], m[0])))];
  const other: [number, number, number] = [wrap(one[0] + 180), wrap(180 - one[1]), wrap(one[2] + 180)];
  const cost = (a: readonly number[]): number => apart(a[0], near[0]) + apart(a[1], near[1]) + apart(a[2], near[2]);
  return cost(other) < cost(one) ? other : one;
}

/**
 * A free turn, as a trackball gives it: the solid turned about the line across
 * the drag, as far as the drag is long against `radius` (a radian a radius),
 * so it rolls the way the pointer goes. `dx` and `dy` are screen pixels.
 */
export function trackballTurn(rotation: readonly [number, number, number], dx: number, dy: number, radius: number): [number, number, number] {
  const length = Math.hypot(dx, dy);
  if (length === 0 || !(radius > 0)) return [rotation[0], rotation[1], rotation[2]];
  const turned = multiply(axisTurn([-dy, dx, 0], length / radius), rotationMatrix(rotation));
  return eulerOf(turned, rotation);
}

// ---- Where the handles stand ------------------------------------------------------------

/** An arrow: its shaft from `from` to where its head starts, and its head. */
export interface GumballArrow {
  axis: GumballAxis;
  from: Pt;
  to: Pt;
  head: [Pt, Pt, Pt];
}

/** Every part of the gumball as it stands, in page units, and what it is worked out from. */
export interface GumballLayout {
  /** The solid's middle on the page: where the gumball stands. */
  center: Pt;
  /** Page units a screen pixel. */
  unit: number;
  /** Each axis on the page, a screen pixel's worth of it: shorter as it points at the eye. */
  axes: [Pt, Pt, Pt];
  /** How squarely each axis points at the eye, 0 to 1. */
  facing: [number, number, number];
  /** True for an axis pointing away from the eye, which is drawn fainter. */
  away: [boolean, boolean, boolean];
  /** The arrows that show, the farthest first. */
  arrows: GumballArrow[];
  /** The scale boxes that show: each square's middle and half its side. */
  tips: Array<{ axis: GumballAxis; at: Pt; half: number }>;
  /** The plane squares that show, each by its corners. */
  planes: Array<{ axis: GumballAxis; corners: [Pt, Pt, Pt, Pt] }>;
  /** The arcs, each a quarter turn from one of the other axes to the next. */
  arcs: Array<{ axis: GumballAxis; points: Pt[] }>;
  /** The ball's and the ring's radii. */
  ball: number;
  ring: number;
}

/** The two axes across `axis`, in turn: Y and Z across X, Z and X across Y, X and Y across Z. */
function across(axis: GumballAxis): [GumballAxis, GumballAxis] {
  return [((axis + 1) % 3) as GumballAxis, ((axis + 2) % 3) as GumballAxis];
}

/** The way to the eye from a point of view space. */
function towardEye(view: ThreeDView, at: Vec3): Vec3 {
  return view.eye ? unit(sub(view.eye, at)) : [0, 0, 1];
}

/**
 * Each of the solid's own axes on the page at its middle, a screen pixel's
 * worth: what the view's projection does to a short step along it there,
 * at the scale the projection gives that point.
 */
function screenAxes(view: ThreeDView): [Pt, Pt, Pt] {
  const o = view.origin;
  const eye = view.eye;
  const depth = eye ? Math.max(view.focal * 0.05, eye[2] - o[2]) : 1;
  return [0, 1, 2].map((i) => {
    const a = column(view.rotation, i);
    if (!eye) return { x: a[0], y: a[1] };
    return { x: a[0] + (a[2] * (o[0] - eye[0])) / depth, y: a[1] + (a[2] * (o[1] - eye[1])) / depth };
  }) as [Pt, Pt, Pt];
}

const at = (o: Pt, d: Pt, k: number): Pt => ({ x: o.x + d.x * k, y: o.y + d.y * k });
const length = (p: Pt): number => Math.hypot(p.x, p.y);
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;

/** Where every part of the gumball stands for a 3D mark, at a zoom (screen pixels a page unit). */
export function gumballLayout(object: GumballObject, zoom: number): GumballLayout {
  const view = object.view;
  const u = 1 / zoom;
  const center = projectPoint(view, view.origin);
  const axes = screenAxes(view);
  const eyeward = towardEye(view, view.origin);
  const facing = [0, 1, 2].map((i) => Math.abs(dot(column(view.rotation, i), eyeward))) as [number, number, number];
  const away = [0, 1, 2].map((i) => dot(column(view.rotation, i), eyeward) < 0) as [boolean, boolean, boolean];
  const P = GUMBALL_PX;
  // The farthest first, so a nearer arrow is drawn over a farther one.
  const order = ([0, 1, 2] as GumballAxis[]).sort((a, b) => dot(column(view.rotation, a), eyeward) - dot(column(view.rotation, b), eyeward));
  const arrows: GumballArrow[] = [];
  const tips: GumballLayout['tips'] = [];
  for (const axis of order) {
    const s = axes[axis];
    const len = length(s);
    if (len < END_ON) continue;
    const dir = { x: s.x / len, y: s.y / len };
    const side = { x: -dir.y, y: dir.x };
    const base = at(center, s, P.head * u);
    const point = at(center, s, P.arrow * u);
    arrows.push({
      axis,
      from: at(center, s, P.shaft * u),
      to: base,
      head: [point, at(base, side, P.headHalf * u), at(base, side, -P.headHalf * u)],
    });
    tips.push({ axis, at: at(center, s, P.tip * u), half: P.tipHalf * u });
  }
  const planes: GumballLayout['planes'] = [];
  const arcs: GumballLayout['arcs'] = [];
  for (const axis of [0, 1, 2] as GumballAxis[]) {
    const [j, k] = across(axis);
    const sj = axes[j];
    const sk = axes[k];
    if (Math.abs(cross(sj, sk)) >= EDGE_ON) {
      const near = P.plane - P.planeHalf;
      const far = P.plane + P.planeHalf;
      const corner = (a: number, b: number): Pt => ({ x: center.x + (sj.x * a + sk.x * b) * u, y: center.y + (sj.y * a + sk.y * b) * u });
      planes.push({ axis, corners: [corner(near, near), corner(far, near), corner(far, far), corner(near, far)] });
    }
    const points: Pt[] = [];
    for (let n = 0; n <= 12; n++) {
      const t = (n / 12) * (Math.PI / 2);
      points.push({ x: center.x + (sj.x * Math.cos(t) + sk.x * Math.sin(t)) * P.arc * u, y: center.y + (sj.y * Math.cos(t) + sk.y * Math.sin(t)) * P.arc * u });
    }
    arcs.push({ axis, points });
  }
  return { center, unit: u, axes, facing, away, arrows, tips, planes, arcs, ball: P.ball * u, ring: P.ring * u };
}

/** A point on each part that shows, where a press would take it: for a check to aim at. */
export function gumballGrips(layout: GumballLayout): Array<{ handle: GumballHandle; at: Pt }> {
  const P = GUMBALL_PX;
  const grips: Array<{ handle: GumballHandle; at: Pt }> = [{ handle: { kind: 'center' }, at: layout.center }];
  for (const arrow of layout.arrows) grips.push({ handle: { kind: 'arrow', axis: arrow.axis }, at: at(layout.center, layout.axes[arrow.axis], 40 * layout.unit) });
  for (const tip of layout.tips) grips.push({ handle: { kind: 'tip', axis: tip.axis }, at: tip.at });
  for (const plane of layout.planes) {
    const [a, , c] = plane.corners;
    grips.push({ handle: { kind: 'plane', axis: plane.axis }, at: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } });
  }
  for (const arc of layout.arcs) grips.push({ handle: { kind: 'arc', axis: arc.axis }, at: arc.points[6] });
  grips.push({ handle: { kind: 'ring' }, at: { x: layout.center.x + P.ring * layout.unit, y: layout.center.y } });
  return grips;
}

// ---- Which handle a press takes -------------------------------------------------------------

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Whether a point is inside a convex polygon, or within `margin` of its edges. */
function inside(p: Pt, corners: readonly Pt[], margin: number): boolean {
  let sign = 0;
  let within = true;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const side = cross({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y });
    if (side !== 0) {
      if (sign === 0) sign = Math.sign(side);
      else if (Math.sign(side) !== sign) within = false;
    }
  }
  if (within) return true;
  return corners.some((a, i) => segmentDistance(p, a, corners[(i + 1) % corners.length]) <= margin);
}

/**
 * The handle a press at a page point takes, or null for none. The ball comes
 * first, then the scale boxes, the arrows, the plane squares, the arcs and the
 * ring: where an arc ends on an arrow, the arrow has it.
 */
export function gumballHit(layout: GumballLayout, p: Pt): GumballHandle | null {
  const reach = GUMBALL_PX.reach * layout.unit;
  const { center } = layout;
  if (Math.hypot(p.x - center.x, p.y - center.y) <= layout.ball + 2 * layout.unit) return { kind: 'center' };
  for (const tip of layout.tips) {
    const half = tip.half + 2 * layout.unit;
    if (Math.abs(p.x - tip.at.x) <= half && Math.abs(p.y - tip.at.y) <= half) return { kind: 'tip', axis: tip.axis };
  }
  let best: { axis: GumballAxis; d: number } | null = null;
  for (const arrow of layout.arrows) {
    const d = inside(p, arrow.head, 0) ? 0 : segmentDistance(p, arrow.from, arrow.head[0]);
    if (d <= reach && (!best || d < best.d)) best = { axis: arrow.axis, d };
  }
  if (best) return { kind: 'arrow', axis: best.axis };
  for (const plane of layout.planes) {
    if (inside(p, plane.corners, 2 * layout.unit)) return { kind: 'plane', axis: plane.axis };
  }
  for (const arc of layout.arcs) {
    let d = Infinity;
    for (let i = 1; i < arc.points.length; i++) d = Math.min(d, segmentDistance(p, arc.points[i - 1], arc.points[i]));
    if (d <= reach && (!best || d < best.d)) best = { axis: arc.axis, d };
  }
  if (best) return { kind: 'arc', axis: best.axis };
  if (Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - layout.ring) <= reach) return { kind: 'ring' };
  return null;
}

/** Two handles the same, for a check of which is lit. */
export function sameHandle(a: GumballHandle | null, b: GumballHandle | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && ('axis' in a ? 'axis' in b && a.axis === b.axis : true);
}

/** What a handle is called, for a tooltip or a notice: "the X arrow", "the ring". */
export function handleName(handle: GumballHandle): string {
  const axis = 'axis' in handle ? ['X', 'Y', 'Z'][handle.axis] : '';
  switch (handle.kind) {
    case 'arrow':
      return `the ${axis} arrow`;
    case 'tip':
      return `the ${axis} scale box`;
    case 'plane': {
      const [j, k] = across(handle.axis);
      return `the ${['X', 'Y', 'Z'][j]}${['X', 'Y', 'Z'][k]} square`;
    }
    case 'arc':
      return `the ${axis} arc`;
    case 'center':
      return 'the ball';
    case 'ring':
      return 'the ring';
  }
}

// ---- The drag ------------------------------------------------------------------------------

/** A drag of a handle, from the press to now. */
export interface GumballDrag {
  readonly handle: GumballHandle;
  /** The object as the press found it: every move is worked from it. */
  readonly start: GumballObject;
  /** Where the press landed, on the page. */
  readonly from: Pt;
  /** Screen pixels a page unit, at the press. */
  readonly zoom: number;
  /** The gumball as the press found it. */
  readonly layout: GumballLayout;
  /** An arc's turn so far, in degrees, round as many times as it has gone; and the angle the pointer was last at. */
  readonly turned: number;
  readonly last: number;
  /** The fields as the drag has them now. */
  readonly fields: GumballFields;
}

/** What is held down with a drag's move. */
export interface GumballKeys {
  shift: boolean;
  alt: boolean;
}

function fieldsOf(object: GumballFields): GumballFields {
  return {
    rotation: [object.rotation[0], object.rotation[1], object.rotation[2]],
    position: [object.position[0], object.position[1], object.position[2]],
    scale: [object.scale[0], object.scale[1], object.scale[2]],
  };
}

/** A ray from the eye - or, with no perspective, straight down - through a page point. */
function rayAt(view: ThreeDView, p: Pt): { from: Vec3; dir: Vec3 } {
  const eye = view.eye;
  if (!eye) return { from: [p.x, p.y, 0], dir: [0, 0, -1] };
  return { from: eye, dir: [(p.x - eye[0]) / view.focal, (p.y - eye[1]) / view.focal, -1] };
}

/** Where a ray meets a plane, or null when it runs along it or meets it behind the eye. */
function onPlane(view: ThreeDView, ray: { from: Vec3; dir: Vec3 }, point: Vec3, normal: Vec3): Vec3 | null {
  const denominator = dot(normal, ray.dir);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = dot(normal, sub(point, ray.from)) / denominator;
  if (view.eye && t <= 0) return null;
  return add(ray.from, times(ray.dir, t));
}

/** How far along a line through `point` (a unit `axis`) it comes nearest a ray; null when they run side by side. */
function alongLine(ray: { from: Vec3; dir: Vec3 }, point: Vec3, axis: Vec3): number | null {
  const w = sub(point, ray.from);
  const b = dot(axis, ray.dir);
  const c = dot(ray.dir, ray.dir);
  const denominator = c - b * b;
  if (Math.abs(denominator) < 1e-9 * c) return null;
  return (b * dot(ray.dir, w) - c * dot(axis, w)) / denominator;
}

/** The angle a page point stands at round an arc's axis, in the arc's own plane; null where its plane is seen edge on. */
function arcAngle(view: ThreeDView, axis: GumballAxis, p: Pt): number | null {
  const [j, k] = across(axis);
  const hit = onPlane(view, rayAt(view, p), view.origin, column(view.rotation, axis));
  if (!hit) return null;
  const w = sub(hit, view.origin);
  return deg(Math.atan2(dot(w, column(view.rotation, k)), dot(w, column(view.rotation, j))));
}

/** The point of an arc nearest a page point, as its angle from the first of the two axes across it, 0 to 90. */
function nearestOnArc(layout: GumballLayout, axis: GumballAxis, p: Pt): number {
  const points = layout.arcs.find((arc) => arc.axis === axis)?.points ?? [];
  let best = 0;
  let bestD = Infinity;
  points.forEach((q, n) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = (n / (points.length - 1)) * 90;
    }
  });
  return best;
}

/** Takes hold of a handle: the drag, from the object as it is now. */
export function startGumballDrag(object: GumballObject, handle: GumballHandle, from: Pt, zoom: number): GumballDrag {
  const layout = gumballLayout(object, zoom);
  let last = 0;
  if (handle.kind === 'arc') {
    const faced = layout.facing[handle.axis] >= ARC_FACING ? arcAngle(object.view, handle.axis, from) : null;
    last = faced ?? nearestOnArc(layout, handle.axis, from);
  }
  return { handle, start: object, from: { x: from.x, y: from.y }, zoom, layout, turned: 0, last, fields: fieldsOf(object) };
}

/** The drag carried to a page point: the fields it gives now, worked from the press. */
export function dragGumball(drag: GumballDrag, to: Pt, keys: GumballKeys): GumballDrag {
  const { handle, start, layout } = drag;
  const view = start.view;
  const fields = fieldsOf(start);
  // Where the solid's middle goes, on the page: the press's grip carried with it.
  const shifted: Pt = { x: layout.center.x + (to.x - drag.from.x), y: layout.center.y + (to.y - drag.from.y) };
  let turned = drag.turned;
  let last = drag.last;
  const move = (by: Vec3): void => {
    fields.position = fields.position.map((v, i) => Math.max(-POSITION_MAX, Math.min(POSITION_MAX, v + by[i]))) as GumballFields['position'];
  };
  const scaleBy = (axes: readonly GumballAxis[], factor: number): void => {
    // The factor is held so that every axis it scales stays in range, so a whole scale stays whole.
    let lo = 0;
    let hi = Infinity;
    for (const i of axes) {
      lo = Math.max(lo, SCALE_MIN / start.scale[i]);
      hi = Math.min(hi, SCALE_MAX / start.scale[i]);
    }
    const f = Math.max(lo, Math.min(hi, Number.isFinite(factor) ? factor : 1));
    for (const i of axes) fields.scale[i] = start.scale[i] * f;
  };
  const turnBy = (m: readonly number[]): void => {
    fields.rotation = eulerOf(multiply(m, view.rotation), start.rotation);
  };

  switch (handle.kind) {
    case 'arrow': {
      const axis = column(view.rotation, handle.axis);
      const s = alongLine(rayAt(view, shifted), view.origin, axis);
      if (s !== null) move(times(axis, s));
      break;
    }
    case 'plane': {
      const [j, k] = across(handle.axis);
      if (keys.alt) {
        // Alt: a scale in the plane, by how far the pointer is from the middle against where the press was.
        const was = { x: drag.from.x - layout.center.x, y: drag.from.y - layout.center.y };
        const now = { x: to.x - layout.center.x, y: to.y - layout.center.y };
        const far = was.x * was.x + was.y * was.y;
        if (far > 0) scaleBy([j, k], (now.x * was.x + now.y * was.y) / far);
      } else {
        const hit = onPlane(view, rayAt(view, shifted), view.origin, column(view.rotation, handle.axis));
        if (hit) move(sub(hit, view.origin));
      }
      break;
    }
    case 'center': {
      if (keys.shift) {
        // Shift: the whole solid scaled, twice the size for every 100 screen pixels right or up.
        const px = (to.x - drag.from.x - (to.y - drag.from.y)) * drag.zoom;
        scaleBy([0, 1, 2], 2 ** (px / 100));
      } else {
        const hit = onPlane(view, rayAt(view, shifted), view.origin, towardEye(view, view.origin));
        if (hit) move(sub(hit, view.origin));
      }
      break;
    }
    case 'tip': {
      const s = layout.axes[handle.axis];
      const len = length(s) || 1;
      const dir = { x: s.x / len, y: s.y / len };
      const was = (drag.from.x - layout.center.x) * dir.x + (drag.from.y - layout.center.y) * dir.y;
      const now = (to.x - layout.center.x) * dir.x + (to.y - layout.center.y) * dir.y;
      if (was > 0) scaleBy([handle.axis], now / was);
      break;
    }
    case 'arc': {
      const axis = column(view.rotation, handle.axis);
      if (layout.facing[handle.axis] >= ARC_FACING) {
        const angle = arcAngle(view, handle.axis, to);
        if (angle !== null) {
          turned += wrap(angle - last);
          last = angle;
        }
      } else {
        // Seen nearly edge on, the arc is read along its tangent where the press took it.
        const [j, k] = across(handle.axis);
        const t = rad(drag.last);
        const sj = layout.axes[j];
        const sk = layout.axes[k];
        const r = GUMBALL_PX.arc * layout.unit;
        const tangent = { x: (-Math.sin(t) * sj.x + Math.cos(t) * sk.x) * r, y: (-Math.sin(t) * sj.y + Math.cos(t) * sk.y) * r };
        const least = (0.35 * r) ** 2;
        const along = (to.x - drag.from.x) * tangent.x + (to.y - drag.from.y) * tangent.y;
        turned = deg(along / Math.max(least, tangent.x * tangent.x + tangent.y * tangent.y));
      }
      const by = keys.shift ? Math.round(turned / GUMBALL_SNAP_DEGREES) * GUMBALL_SNAP_DEGREES : turned;
      turnBy(axisTurn(axis, rad(by)));
      break;
    }
    case 'ring': {
      const dx = (to.x - drag.from.x) * drag.zoom;
      const dy = (to.y - drag.from.y) * drag.zoom;
      fields.rotation = trackballTurn(start.rotation, dx, dy, GUMBALL_PX.ring);
      break;
    }
  }
  return { ...drag, turned, last, fields: tidy(fields, start) };
}

/** The fields as the effect keeps them: turns to a hundredth of a degree, moves to a hundredth, scales to a ten-thousandth; untouched ones exactly as they were. */
function tidy(fields: GumballFields, start: GumballFields): GumballFields {
  const round = (value: number, places: number): number => {
    const k = 10 ** places;
    return Math.round(value * k) / k;
  };
  // A turn is held to its range before it is rounded: rounding after would leave a binary fraction's tail on it.
  const angled = (v: number, places: number): number => {
    const r = round(wrap(v), places);
    return r === -180 ? 180 : r;
  };
  const keep = (now: readonly number[], was: readonly number[], places: number, angle = false): [number, number, number] =>
    now.map((v, i) => (Math.abs(v - was[i]) < 1e-9 ? was[i] : angle ? angled(v, places) : round(v, places))) as [number, number, number];
  return {
    rotation: keep(fields.rotation, start.rotation, 2, true),
    position: keep(fields.position, start.position, 2),
    scale: keep(fields.scale, start.scale, 4),
  };
}

/** Escape: the fields as the press found them. */
export function cancelGumballDrag(drag: GumballDrag): GumballFields {
  return fieldsOf(drag.start);
}

/** Whether a drag has changed anything yet. */
export function gumballMoved(drag: GumballDrag): boolean {
  const a = drag.fields;
  const b = drag.start;
  return [0, 1, 2].some((i) => a.rotation[i] !== b.rotation[i] || a.position[i] !== b.position[i] || a.scale[i] !== b.scale[i]);
}
