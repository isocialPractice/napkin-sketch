/**
 * Drawing a 3D mesh as shaded vector faces: a vector editor's Classic 3D,
 * flat faces in every format. Pure.
 *
 * 1. **The mesh** (core/three-d/mesh.ts) is built from the mark's outline -
 *    flattened to a tolerance a pixel's fraction of its drawn size - and
 *    kept, with its drawing-order tree, until the outline or what shapes the
 *    mesh changes. Turning it never builds it again.
 * 2. **The transform**: scale, then rotation - about X, then Y, then Z - about
 *    the mesh's middle, then `position`.
 * 3. **The projection**: straight onto the page with no perspective, or
 *    through a pinhole whose field of view is the perspective angle, the eye
 *    in front of the mesh's middle as far as the field takes to see it all.
 * 4. **The order**: a BSP tree, built once per mesh over its faces' convex
 *    pieces and walked from the eye, so the far faces come first and the near
 *    ones over them - exact where sorting by depth is not. Its first planes
 *    are the caps', which cut nothing, so a cap is never cut up.
 * 5. **Culling**: a closed solid's faces turned away are left out; a surface
 *    is seen from both sides.
 * 6. **Shading**: Diffuse is `base * (ambient + intensity * max(0, n . l))`;
 *    Plastic adds a white highlight; No Shading is the flat base color; and
 *    Wireframe draws every face's edges and fills none.
 *
 * The faces come out far first. A face whose pieces all come in one run is
 * one polygon, holes and all - a cap is one shape; one the order splits is
 * its pieces. Each is hemmed in its own color, so no seam of paper shows
 * between two faces - but a cap takes the mark's stroke along its outline, as
 * a vector editor maps a stroke to the front of an extrusion.
 */

import type { EffectOf } from '../effects.js';
import { parseColor } from '../graphic-design/color.js';
import type { Point, Stroke } from '../types.js';
import { extrudeMesh, flattenOutline, revolveMesh, revolveStepCount, type Mesh, type Outline, type Vec2, type Vec3 } from './mesh.js';

export type ThreeDEffect = EffectOf<'3d'>;

/** One face as it is drawn: its rings on the page, its fill, and the stroke along it. */
export interface Face {
  /** The outer ring, then its holes. */
  points: Vec2[][];
  /** Its fill, `#rrggbb`; null for a face drawn as its edges alone. */
  color: string | null;
  stroke?: { color: string; width: number };
}

/** How a mesh is painted: its color, and the stroke a cap's outline takes. */
export interface Paint3d {
  base: [number, number, number];
  edge: { color: string; width: number } | null;
}

/** How far a flattened outline strays from the mark's, in pixels as drawn. */
export const FLATTEN_TOLERANCE = 0.5;

const EPS = 1e-7;

// ---- Vectors ----------------------------------------------------------------------

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** The rotation about X, then Y, then Z, in degrees, as a row-major 3 by 3. */
export function rotationMatrix([rx, ry, rz]: readonly [number, number, number]): number[] {
  const [a, b, c] = [rx, ry, rz].map((deg) => (deg * Math.PI) / 180);
  const X = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Y = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const Z = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  return multiply(Z, multiply(Y, X));
}

function multiply(m: readonly number[], n: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += m[i * 3 + k] * n[k * 3 + j];
  return out;
}

const apply = (m: readonly number[], v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

// ---- The drawing order ------------------------------------------------------------------

interface Plane {
  n: Vec3;
  d: number;
}

/** A convex piece of a face, in object space. */
interface Piece {
  face: number;
  points: Vec3[];
}

interface BspNode {
  plane: Plane;
  coplanar: Piece[];
  front: BspNode | null;
  back: BspNode | null;
}

/** A polygon's plane, by Newell's method, which a nearly flat polygon gives a fair one too. */
function planeOf(points: readonly Vec3[]): Plane {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  const unit = normalize(n);
  return { n: unit, d: dot(unit, points[0]) };
}

type Split = { coplanar: Piece } | { front?: Piece; back?: Piece };

/** A piece against a plane: on it, wholly to one side, or cut in two along it. */
function split(piece: Piece, plane: Plane, tolerance: number): Split {
  const dist = piece.points.map((p) => dot(plane.n, p) - plane.d);
  if (dist.every((v) => Math.abs(v) <= tolerance)) return { coplanar: piece };
  if (dist.every((v) => v > -tolerance)) return { front: piece };
  if (dist.every((v) => v < tolerance)) return { back: piece };
  const front: Vec3[] = [];
  const back: Vec3[] = [];
  const n = piece.points.length;
  for (let i = 0; i < n; i++) {
    const p = piece.points[i];
    const q = piece.points[(i + 1) % n];
    const dp = dist[i];
    const dq = dist[(i + 1) % n];
    if (dp >= -tolerance) front.push(p);
    if (dp <= tolerance) back.push(p);
    if ((dp > tolerance && dq < -tolerance) || (dp < -tolerance && dq > tolerance)) {
      const t = dp / (dp - dq);
      const cut: Vec3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      front.push(cut);
      back.push(cut);
    }
  }
  return {
    ...(front.length >= 3 ? { front: { face: piece.face, points: front } } : {}),
    ...(back.length >= 3 ? { back: { face: piece.face, points: back } } : {}),
  };
}

/**
 * The tree over a mesh's pieces. Each node's plane is the one of a few
 * candidates that cuts fewest pieces, a cap's first: a cap's plane cuts
 * nothing, so its pieces stay together. Built without recursion, so a long
 * thin tree cannot run out of stack.
 */
function buildTree(pieces: Piece[], isCap: (face: number) => boolean, tolerance: number): BspNode | null {
  const make = (list: Piece[]): { node: BspNode; front: Piece[]; back: Piece[] } => {
    const tries = list.length > 1500 ? 2 : 5;
    const candidates = new Set<number>();
    const cap = list.findIndex((piece) => isCap(piece.face));
    if (cap >= 0) candidates.add(cap);
    for (let k = 0; k < Math.min(tries, list.length); k++) candidates.add(Math.floor((k * list.length) / Math.min(tries, list.length)));
    let best = list[0];
    let bestCuts = Infinity;
    for (const index of candidates) {
      const plane = planeOf(list[index].points);
      let cuts = 0;
      for (const piece of list) {
        const r = split(piece, plane, tolerance);
        if ('front' in r && 'back' in r && r.front && r.back) cuts++;
        if (cuts >= bestCuts) break;
      }
      if (cuts < bestCuts || (cuts === bestCuts && isCap(list[index].face) && !isCap(best.face))) {
        bestCuts = cuts;
        best = list[index];
      }
    }
    const node: BspNode = { plane: planeOf(best.points), coplanar: [], front: null, back: null };
    const front: Piece[] = [];
    const back: Piece[] = [];
    for (const piece of list) {
      const r = split(piece, node.plane, tolerance);
      if ('coplanar' in r) node.coplanar.push(r.coplanar);
      else {
        if (r.front) front.push(r.front);
        if (r.back) back.push(r.back);
      }
    }
    return { node, front, back };
  };
  if (pieces.length === 0) return null;
  const top = make(pieces);
  const stack: Array<{ node: BspNode; front: Piece[]; back: Piece[] }> = [top];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.front.length > 0) {
      const child = make(item.front);
      item.node.front = child.node;
      stack.push(child);
    }
    if (item.back.length > 0) {
      const child = make(item.back);
      item.node.back = child.node;
      stack.push(child);
    }
  }
  return top.node;
}

/** The tree's pieces from the eye's far side to its near side: `side` is above 0 where a plane faces the eye. */
function walkTree(root: BspNode | null, side: (plane: Plane) => number): Piece[] {
  const out: Piece[] = [];
  if (!root) return out;
  const stack: Array<{ node: BspNode; emit: boolean }> = [{ node: root, emit: false }];
  while (stack.length > 0) {
    const { node, emit } = stack.pop()!;
    if (emit) {
      out.push(...node.coplanar);
      continue;
    }
    const facing = side(node.plane) >= 0;
    const far = facing ? node.back : node.front;
    const near = facing ? node.front : node.back;
    if (near) stack.push({ node: near, emit: false });
    stack.push({ node, emit: true });
    if (far) stack.push({ node: far, emit: false });
  }
  return out;
}

// ---- The solid --------------------------------------------------------------------

/** A mesh with what drawing it needs: its tree, how many pieces each face became, and its middle and reach. */
export interface Solid {
  mesh: Mesh;
  tree: BspNode | null;
  pieceCount: number[];
  center: Vec3;
  radius: number;
}

/** The solids built lately, by what built them: a turn, a light or a scale reuses one. */
const solids = new Map<string, Solid>();
const KEEP = 24;

/** The mesh an effect builds from an outline, and its tree, kept while they stay the same. */
export function solidOf(outline: Outline, filled: boolean, effect: ThreeDEffect, tolerance: number): Solid {
  const flat = flattenOutline(outline, tolerance);
  const key = JSON.stringify([
    flat.rings.map((ring) => ring.map((p) => [Math.round(p.x * 1000), Math.round(p.y * 1000)])),
    flat.closed,
    filled,
    effect.kind,
    effect.kind === 'extrude' ? effect.depth : [effect.angle, effect.offset, effect.axis, effect.segments],
    effect.caps,
    Math.round(tolerance * 1e6),
  ]);
  const kept = solids.get(key);
  if (kept) {
    solids.delete(key);
    solids.set(key, kept);
    return kept;
  }
  const mesh =
    effect.kind === 'revolve'
      ? revolveMesh(flat, { angle: effect.angle, offset: effect.offset, axis: effect.axis, segments: effect.segments, caps: effect.caps }, tolerance, filled)
      : extrudeMesh(flat, effect.depth, effect.caps, filled);
  const solid = buildSolid(mesh);
  solids.set(key, solid);
  if (solids.size > KEEP) solids.delete(solids.keys().next().value as string);
  return solid;
}

/** A mesh's tree and measure. */
export function buildSolid(mesh: Mesh): Solid {
  const pieces: Piece[] = [];
  mesh.faces.forEach((face, index) => {
    for (const piece of face.pieces) {
      const points = piece.map((i) => mesh.vertices[i]);
      if (points.length >= 3) pieces.push({ face: index, points });
    }
  });
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) {
    min = [Math.min(min[0], v[0]), Math.min(min[1], v[1]), Math.min(min[2], v[2])];
    max = [Math.max(max[0], v[0]), Math.max(max[1], v[1]), Math.max(max[2], v[2])];
  }
  const center: Vec3 = mesh.vertices.length > 0 ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0];
  const radius = mesh.vertices.reduce((r, v) => Math.max(r, Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2])), 0);
  const tolerance = Math.max(1e-6, radius * 1e-7);
  const tree = buildTree(pieces, (face) => mesh.faces[face].kind === 'cap', tolerance);
  const pieceCount = mesh.faces.map(() => 0);
  const count = (node: BspNode | null): void => {
    const stack = node ? [node] : [];
    while (stack.length > 0) {
      const at = stack.pop()!;
      for (const piece of at.coplanar) pieceCount[piece.face]++;
      if (at.front) stack.push(at.front);
      if (at.back) stack.push(at.back);
    }
  };
  count(tree);
  return { mesh, tree, pieceCount, center, radius };
}

// ---- The view -----------------------------------------------------------------------

/**
 * How an effect shows its solid: the middle it turns and scales about, where
 * the move puts that middle, the turn, the scale and the eye. A point of the
 * solid goes onto the page by {@link viewPoint}, then {@link projectPoint}.
 * The gumball reads the same view, so its handles sit on the solid it turns.
 */
export interface ThreeDView {
  /** The solid's middle before the move: what it turns and scales about. */
  center: Vec3;
  /** The middle once moved, `center + position`: where the gumball stands. */
  origin: Vec3;
  /** The turn, row-major, X then Y then Z: its columns are the solid's own axes as the page has them. */
  rotation: number[];
  /** The scale along the solid's own axes, each kept off 0. */
  scale: Vec3;
  /** The pinhole's focal length; 0 for a straight projection. */
  focal: number;
  /** The eye, in front of the middle as far as the field of view takes to see the whole solid; null for a straight projection. */
  eye: Vec3 | null;
}

/** The view an effect gives a solid. */
export function viewOf(solid: Solid, effect: ThreeDEffect): ThreeDView {
  const { center } = solid;
  const scale: Vec3 = [nonZero(effect.scale[0]), nonZero(effect.scale[1]), nonZero(effect.scale[2])];
  const perspective = Math.min(160, Math.max(0, effect.perspective));
  const reach = solid.radius * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
  const focal = perspective > 0 && reach > 0 ? reach / Math.sin(rad(perspective) / 2) : 0;
  return {
    center,
    origin: [center[0] + effect.position[0], center[1] + effect.position[1], center[2] + effect.position[2]],
    rotation: rotationMatrix(effect.rotation),
    scale,
    focal,
    eye: focal > 0 ? [center[0], center[1], center[2] + focal] : null,
  };
}

/** A point of the solid where the view puts it: scaled and turned about the middle, then moved. */
export function viewPoint(view: ThreeDView, v: Vec3): Vec3 {
  const { center, origin, rotation: m, scale: s } = view;
  const d: Vec3 = [(v[0] - center[0]) * s[0], (v[1] - center[1]) * s[1], (v[2] - center[2]) * s[2]];
  const r = apply(m, d);
  return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
}

/** A point of view space as the page shows it: straight down onto it, or through the pinhole. */
export function projectPoint(view: ThreeDView, v: Vec3): Vec2 {
  const eye = view.eye;
  if (!eye) return { x: v[0], y: v[1] };
  const depth = Math.max(view.focal * 0.05, eye[2] - v[2]);
  const k = view.focal / depth;
  return { x: eye[0] + (v[0] - eye[0]) * k, y: eye[1] + (v[1] - eye[1]) * k };
}

/**
 * The view of a mark's 3D, as {@link render3d} builds it - `stroke` the mark
 * as the effects before the 3D left it. Null when it builds nothing.
 */
export function threeDView(stroke: Stroke, effect: ThreeDEffect): ThreeDView | null {
  const source = outlineOf(stroke);
  if (!source) return null;
  const solid = solidOf(source.outline, source.filled, effect, toleranceFor(effect));
  return solid.mesh.faces.length > 0 ? viewOf(solid, effect) : null;
}

// ---- Drawing ----------------------------------------------------------------------

/** The hem a face takes in its own color, so two faces meet without a seam of paper between them. */
const HEM = 0.5;

/** How bright a Plastic highlight is, and how tight. */
const HIGHLIGHT = 0.6;
const SHININESS = 24;

/**
 * A solid drawn by an effect's view, light and shading: its faces, far first,
 * on the page. Wireframe draws every face's edges, turned away or not.
 */
export function renderSolid(solid: Solid, effect: ThreeDEffect, paint: Paint3d): Face[] {
  const { mesh, center } = solid;
  if (mesh.faces.length === 0) return [];
  const view = viewOf(solid, effect);
  const { scale, rotation, focal } = view;
  const position: Vec3 = [effect.position[0], effect.position[1], effect.position[2]];
  // How the view carries a point back into object space, and how it carries a normal.
  const inverse = multiply([1 / scale[0], 0, 0, 0, 1 / scale[1], 0, 0, 0, 1 / scale[2]], transpose(rotation));
  const normalMap = multiply(rotation, [1 / scale[0], 0, 0, 0, 1 / scale[1], 0, 0, 0, 1 / scale[2]]);
  const toView = (v: Vec3): Vec3 => viewPoint(view, v);
  const project = (v: Vec3): Vec2 => projectPoint(view, v);
  const eye: Vec3 = view.eye ?? [center[0], center[1], center[2]];
  // Which side of a plane the eye is on, worked in object space.
  const eyeInObject: Vec3 | null = focal > 0 ? addV(apply(inverse, [eye[0] - center[0] - position[0], eye[1] - center[1] - position[1], eye[2] - center[2] - position[2]]), center) : null;
  const dirInObject = apply(inverse, [0, 0, 1]);
  const side = eyeInObject ? (plane: Plane): number => dot(plane.n, eyeInObject) - plane.d : (plane: Plane): number => dot(plane.n, dirInObject);

  const light = normalize([
    Math.cos(rad(effect.light.elevation)) * Math.cos(rad(effect.light.azimuth)),
    -Math.cos(rad(effect.light.elevation)) * Math.sin(rad(effect.light.azimuth)),
    Math.sin(rad(effect.light.elevation)),
  ]);

  const viewVertices = mesh.vertices.map(toView);
  const ring = (indices: readonly number[]): Vec2[] => indices.map((i) => project(viewVertices[i]));

  if (effect.shading === 'wireframe') {
    const color = hex(paint.base);
    return mesh.faces.map((face) => ({ points: face.rings.map(ring), color: null, stroke: { color, width: 1 } }));
  }

  // Each face's look from here: whether it shows, and its color.
  const looks = mesh.faces.map((face) => {
    const first = face.rings[0] ?? face.pieces[0] ?? [];
    const middle = first.reduce<Vec3>((s, i) => addV(s, viewVertices[i]), [0, 0, 0]).map((v) => v / Math.max(1, first.length)) as Vec3;
    let n = normalize(apply(normalMap, face.normal));
    const toEye: Vec3 = focal > 0 ? normalize([eye[0] - middle[0], eye[1] - middle[1], eye[2] - middle[2]]) : [0, 0, 1];
    const facing = dot(n, toEye);
    if (mesh.closed && facing <= EPS) return null;
    if (facing < 0) n = [-n[0], -n[1], -n[2]];
    return hex(shade(paint.base, n, light, toEye, effect));
  });

  const ordered = walkTree(solid.tree, side);
  const faces: Face[] = [];
  for (let i = 0; i < ordered.length; ) {
    const at = ordered[i].face;
    let j = i + 1;
    while (j < ordered.length && ordered[j].face === at) j++;
    const color = looks[at];
    if (color !== null) {
      const face = mesh.faces[at];
      // A cap takes the mark's stroke along its outline; any other face is
      // hemmed in its own color, so no seam shows the paper between two faces.
      const stroke = face.kind === 'cap' && paint.edge ? { ...paint.edge } : { color, width: HEM };
      if (j - i === solid.pieceCount[at]) {
        faces.push({ points: face.rings.map(ring), color, stroke });
      } else {
        // Split by the order: each piece drawn on its own, hemmed the same way.
        for (let k = i; k < j; k++) faces.push({ points: [ordered[k].points.map((v) => project(toView(v)))], color, stroke: { color, width: HEM } });
      }
    }
    i = j;
  }
  return faces;
}

/** A face's color: the base, lit as the shading says. */
function shade(base: readonly [number, number, number], n: Vec3, light: Vec3, toEye: Vec3, effect: ThreeDEffect): [number, number, number] {
  if (effect.shading === 'none') return [base[0], base[1], base[2]];
  const lit = effect.light.ambient + effect.light.intensity * Math.max(0, dot(n, light));
  let shine = 0;
  if (effect.shading === 'plastic') {
    const half = normalize([light[0] + toEye[0], light[1] + toEye[1], light[2] + toEye[2]]);
    shine = HIGHLIGHT * Math.max(0, dot(n, half)) ** SHININESS * Math.min(1, effect.light.intensity * 2);
  }
  return [0, 1, 2].map((c) => Math.round(Math.min(255, Math.max(0, base[c] * lit + 255 * shine)))) as [number, number, number];
}

function transpose(m: readonly number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function addV(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function nonZero(value: number): number {
  return Number.isFinite(value) && Math.abs(value) > 1e-6 ? value : 1e-6;
}

function hex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

// ---- From a mark -------------------------------------------------------------------

/** A mark's outline as 3D builds from it: its region when it has a fill, else its path. Null when it has neither. */
export function outlineOf(stroke: Stroke): { outline: Outline; filled: boolean } | null {
  const pts = stroke.points;
  if (pts.length < 2) return null;
  const filled = (stroke.fill !== undefined || stroke.gradient !== undefined) && pts.length > 2;
  const rings: Vec2[][] = [];
  let ring: Vec2[] = [];
  for (const p of pts) {
    if (p.move && ring.length > 0) {
      rings.push(ring);
      ring = [];
    }
    ring.push({ x: p.x, y: p.y });
  }
  if (ring.length > 0) rings.push(ring);
  if (filled) return { outline: { rings, closed: true }, filled: true };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = stroke.vector?.closed === true || (pts.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6);
  return { outline: { rings, closed }, filled: false };
}

/** A mark's paint as 3D draws it: its fill, or a gradient's middle color, or its stroke's color; and the stroke a cap takes. */
export function paintOf(stroke: Stroke, filled: boolean): Paint3d {
  const css = filled ? (stroke.fill ?? gradientMiddle(stroke)) : stroke.color;
  const base = rgbOf(css ?? stroke.color);
  const edge = filled && stroke.noStroke !== true ? { color: stroke.color, width: stroke.width } : null;
  return { base, edge };
}

/** A gradient's colors mixed evenly: the one color a face stands for it with. */
function gradientMiddle(stroke: Stroke): string | undefined {
  const stops = stroke.gradient?.stops ?? [];
  if (stops.length === 0) return undefined;
  const sum = stops.reduce<[number, number, number]>((s, stop) => {
    const c = rgbOf(stop.color);
    return [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }, [0, 0, 0]);
  return hex([sum[0] / stops.length, sum[1] / stops.length, sum[2] / stops.length]);
}

function rgbOf(css: string): [number, number, number] {
  try {
    const c = parseColor(css);
    return [c.r, c.g, c.b];
  } catch {
    return [0, 0, 0];
  }
}

/** The flattening tolerance for an effect: a pixel's fraction of the outline as it is drawn, scale and all. */
function toleranceFor(effect: ThreeDEffect): number {
  const largest = Math.max(Math.abs(effect.scale[0]), Math.abs(effect.scale[1]), Math.abs(effect.scale[2]), 1e-3);
  return FLATTEN_TOLERANCE / largest;
}

/** The most steps a revolve takes round a full turn while it is a draft. */
export const DRAFT_REVOLVE_STEPS = 24;

/**
 * A mark drawn by a 3D effect: its faces, far first. Empty for a mark with
 * nothing to build from. `stroke` is the mark as the effects before this one
 * left it. A `draft` - a mark a gumball drag is turning - revolves in no more
 * than {@link DRAFT_REVOLVE_STEPS} steps a full turn, so each frame of the
 * drag stays quick; the drag's release draws it in full again.
 */
export function render3d(stroke: Stroke, effect: ThreeDEffect, draft = false): Face[] {
  const source = outlineOf(stroke);
  if (!source) return [];
  const tolerance = toleranceFor(effect);
  let built = effect;
  if (draft && effect.kind === 'revolve') {
    const shape = { angle: effect.angle, offset: effect.offset, axis: effect.axis, segments: effect.segments, caps: effect.caps };
    const full = revolveStepCount(source.outline, shape, tolerance);
    const most = Math.max(3, Math.ceil((DRAFT_REVOLVE_STEPS * Math.min(360, Math.max(0, effect.angle))) / 360));
    if (full > most) built = { ...effect, segments: most };
  }
  const solid = solidOf(source.outline, source.filled, built, tolerance);
  return renderSolid(solid, built, paintOf(stroke, source.filled));
}

/** The points a face's rings draw as, the pen lifted between them. */
export function facePoints(face: Face): Point[] {
  return face.points.flatMap((ring, k) => ring.map((p, i) => (k > 0 && i === 0 ? { x: p.x, y: p.y, pressure: 1, move: true as const } : { x: p.x, y: p.y, pressure: 1 })));
}
