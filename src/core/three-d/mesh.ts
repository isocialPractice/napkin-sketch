/**
 * 3D meshes: a vector editor's Classic 3D (Extrude & Bevel, Revolve), built
 * from a mark's outline. Pure.
 *
 * Object space is the page's own - x right, y down - with z toward the
 * viewer, so an outline sits where it is drawn and a mesh built from it sits
 * on it. A face is a planar polygon: its outline (an outer ring and its
 * holes, as vertex indices) for drawing, and convex pieces covering it -
 * triangles for a cap, the quad itself for a side - for working out the
 * order faces are drawn in (core/three-d/render.ts). Its normal points out of
 * the solid; a mesh that is not a closed solid is seen from both sides.
 *
 * - **Extrude** sets the outline `depth` deep, from `depth / 2` in front of
 *   the page to as far behind it: a front cap and a back cap - the outline
 *   triangulated by ear clipping, its holes bridged in, so the counter of an
 *   `A` stays open - and a side quad an edge. Hollow, it has sides alone; an
 *   open path makes a ribbon.
 * - **Revolve** sweeps the outline round an upright axis at its left or right
 *   edge, `offset` beyond it, through `angle` degrees in `segments` steps;
 *   a full turn closes on itself without a second seam.
 */

import { simplify } from '../../sharpen/geometry.js';
import type { Point } from '../types.js';

export type Vec3 = [number, number, number];

export interface Vec2 {
  x: number;
  y: number;
}

/** What a mesh is built from: closed rings (a region, or a closed path), or an open path. */
export interface Outline {
  rings: Vec2[][];
  closed: boolean;
}

/** A face of a mesh. */
export interface MeshFace {
  /** Its outline: the outer ring, then its holes, as vertex indices. */
  rings: number[][];
  /** Convex pieces covering it, as vertex indices: what the drawing order is worked out over. */
  pieces: number[][];
  /** The way out of the solid, in object space; a two-sided face's either way. */
  normal: Vec3;
  /** An extrusion's front or back, a revolve's end; or a side. */
  kind: 'cap' | 'side';
}

export interface Mesh {
  vertices: Vec3[];
  faces: MeshFace[];
  /** A closed solid: a face turned away is never seen. */
  closed: boolean;
}

const EPS = 1e-9;

// ---- Polygons ----------------------------------------------------------------------

/** Twice a ring's signed area: positive for one winding, negative for the other. */
export function signedArea(ring: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Whether a point is inside a ring, by the crossings of a ray. */
function insideRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Closed rings sorted into shapes: each outer ring with the holes directly
 * inside it, by how deep each ring is nested. Outer rings come out with a
 * positive area and holes with a negative one.
 */
export function shapesOf(rings: readonly Vec2[][]): Array<{ outer: Vec2[]; holes: Vec2[][] }> {
  const usable = rings.filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > EPS);
  const depth = usable.map((ring, i) => usable.reduce((n, other, j) => (j !== i && insideRing(ring[0], other) ? n + 1 : n), 0));
  const shapes: Array<{ outer: Vec2[]; holes: Vec2[][]; area: number }> = [];
  usable.forEach((ring, i) => {
    if (depth[i] % 2 !== 0) return;
    const outer = signedArea(ring) > 0 ? ring.slice() : ring.slice().reverse();
    shapes.push({ outer, holes: [], area: signedArea(outer) });
  });
  usable.forEach((ring, i) => {
    if (depth[i] % 2 !== 1) return;
    // The smallest outer ring that holds it is its owner.
    const owner = shapes.filter((shape) => insideRing(ring[0], shape.outer)).sort((a, b) => a.area - b.area)[0];
    if (owner) owner.holes.push(signedArea(ring) < 0 ? ring.slice() : ring.slice().reverse());
  });
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

/** Twice the signed area of a triangle: positive when it turns the outer rings' way. */
function turn(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * An outer ring and its holes made one simple ring, each hole joined to the
 * ring by a bridge there and back (Eberly's method): the hole's rightmost
 * point to the nearest vertex of the ring it can see to its right.
 */
function bridge(outer: readonly Vec2[], holes: readonly Vec2[][]): Vec2[] {
  let ring = outer.slice();
  const rightmost = (hole: readonly Vec2[]): number => hole.reduce((best, p, i) => (p.x > hole[best].x ? i : best), 0);
  const sorted = holes.slice().sort((a, b) => b[rightmost(b)].x - a[rightmost(a)].x);
  for (const hole of sorted) {
    const mi = rightmost(hole);
    const m = hole[mi];
    // The nearest edge a ray to the right from M crosses, and the vertex of it to bridge to.
    let best = -1;
    let bestX = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if ((a.y <= m.y && b.y >= m.y) || (b.y <= m.y && a.y >= m.y)) {
        if (a.y === b.y) continue;
        const x = a.x + ((m.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (x >= m.x && x < bestX) {
          bestX = x;
          best = a.x > b.x ? i : (i + 1) % ring.length;
        }
      }
    }
    if (best < 0) best = ring.reduce((near, p, i) => (Math.hypot(p.x - m.x, p.y - m.y) < Math.hypot(ring[near].x - m.x, ring[near].y - m.y) ? i : near), 0);
    // A vertex inside the triangle M, I, P could block the bridge: the one at
    // the smallest angle to the ray is visible instead.
    const hit = { x: bestX, y: m.y };
    const p = ring[best];
    let pick = best;
    let pickAngle = Infinity;
    if (Number.isFinite(bestX)) {
      for (let i = 0; i < ring.length; i++) {
        const v = ring[i];
        if (i === best || (v.x === p.x && v.y === p.y)) continue;
        if (insideRing(v, [m, hit, p])) {
          const angle = Math.abs(Math.atan2(v.y - m.y, v.x - m.x));
          if (angle < pickAngle) {
            pickAngle = angle;
            pick = i;
          }
        }
      }
    }
    const loop = hole.slice(mi).concat(hole.slice(0, mi));
    ring = ring.slice(0, pick + 1).concat(loop, [loop[0], ring[pick]], ring.slice(pick + 1));
  }
  return ring;
}

/**
 * Ear clipping of a simple ring that turns the outer rings' way: triangles,
 * as index triples into it. Each ear is tested against the vertices still in
 * the ring; one a bridge doubled is never inside an ear it shares a corner
 * with. A ring the clipping cannot finish - one that crosses itself - gives
 * the triangles it could.
 */
function earClip(ring: readonly Vec2[]): Array<[number, number, number]> {
  const n = ring.length;
  if (n < 3) return [];
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    prev[i] = (i + n - 1) % n;
    next[i] = (i + 1) % n;
  }
  const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
  const isEar = (i: number): boolean => {
    const a = ring[prev[i]];
    const b = ring[i];
    const c = ring[next[i]];
    if (turn(a, b, c) <= EPS) return false;
    for (let j = next[next[i]]; j !== prev[i]; j = next[j]) {
      const p = ring[j];
      if (same(p, a) || same(p, b) || same(p, c)) continue;
      if (turn(a, b, p) > 0 && turn(b, c, p) > 0 && turn(c, a, p) > 0) return false;
    }
    return true;
  };
  const tris: Array<[number, number, number]> = [];
  let count = n;
  let i = 0;
  let misses = 0;
  while (count > 3) {
    if (isEar(i)) {
      tris.push([prev[i], i, next[i]]);
      next[prev[i]] = next[i];
      prev[next[i]] = prev[i];
      count--;
      i = prev[i];
      misses = 0;
      continue;
    }
    i = next[i];
    if (++misses <= count) continue;
    // A full round with no ear: drop a vertex that turns no way, else clip
    // the next one anyway, so the clipping always ends.
    let flat = -1;
    for (let k = 0, j = i; k < count; k++, j = next[j]) {
      if (Math.abs(turn(ring[prev[j]], ring[j], ring[next[j]])) <= EPS) {
        flat = j;
        break;
      }
    }
    if (flat < 0) tris.push([prev[i], i, next[i]]);
    const gone = flat >= 0 ? flat : i;
    next[prev[gone]] = next[gone];
    prev[next[gone]] = prev[gone];
    count--;
    i = prev[gone];
    misses = 0;
  }
  if (count === 3) tris.push([prev[i], i, next[i]]);
  return tris.filter(([a, b, c]) => Math.abs(turn(ring[a], ring[b], ring[c])) > EPS);
}

/**
 * A region triangulated: an outer ring and its holes, as the points of one
 * bridged ring and triangles over them. The triangles cover the region
 * exactly, holes left open.
 */
export function triangulate(outer: readonly Vec2[], holes: readonly Vec2[][] = []): { points: Vec2[]; triangles: Array<[number, number, number]> } {
  // The outer ring turns one way and the holes the other, whichever way they came.
  const ring = signedArea(outer) >= 0 ? outer : outer.slice().reverse();
  const counters = holes.map((hole) => (signedArea(hole) <= 0 ? hole : hole.slice().reverse()));
  const points = bridge(ring, counters);
  return { points, triangles: earClip(points) };
}

// ---- Outlines ----------------------------------------------------------------------

/** A closed ring with no more points than it takes to stay within `tolerance` of itself. */
function simplifyRing(ring: readonly Vec2[], tolerance: number): Vec2[] {
  if (ring.length <= 4) return ring.slice();
  // Split at the point farthest from the first, and simplify the two halves.
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const asPoints = (list: readonly Vec2[]): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 }));
  const one = simplify(asPoints(ring.slice(0, far + 1)), tolerance);
  const two = simplify(asPoints([...ring.slice(far), ring[0]]), tolerance);
  return [...one, ...two.slice(1, -1)].map((p) => ({ x: p.x, y: p.y }));
}

/**
 * An outline as a mesh is built from it: each ring simplified to the
 * tolerance, a closing point that repeats the first dropped, and a ring too
 * small to have an inside left out.
 */
export function flattenOutline(outline: Outline, tolerance: number): Outline {
  const rings: Vec2[][] = [];
  for (const raw of outline.rings) {
    const ring = raw.filter((p, i) => i === 0 || p.x !== raw[i - 1].x || p.y !== raw[i - 1].y);
    if (outline.closed) {
      while (ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y) ring.pop();
      const flat = simplifyRing(ring, tolerance);
      if (flat.length >= 3 && Math.abs(signedArea(flat)) > EPS) rings.push(flat);
    } else {
      const flat = ring.length > 2 ? simplify(ring.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 })), tolerance).map((p) => ({ x: p.x, y: p.y })) : ring;
      if (flat.length >= 2) rings.push(flat);
    }
  }
  return { rings, closed: outline.closed };
}

// ---- Extrude ----------------------------------------------------------------------

/**
 * An outline set `depth` deep, centered on the page: a closed region with its
 * caps - unless `caps` is off, which leaves it hollow - and a side quad an
 * edge; an open path, a ribbon. `filled` says the closed rings are a region;
 * without it they are paths, and make tubes.
 */
export function extrudeMesh(outline: Outline, depth: number, caps: boolean, filled = true): Mesh {
  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];
  const add = (p: Vec2, z: number): number => vertices.push([p.x, p.y, z]) - 1;
  const front = depth / 2;
  const back = -depth / 2;

  /** The side quads along a run of points, each facing out of the edge's right. */
  const sides = (run: readonly Vec2[], closedRun: boolean): void => {
    const edges = closedRun ? run.length : run.length - 1;
    for (let i = 0; i < edges; i++) {
      const a = run[i];
      const b = run[(i + 1) % run.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len <= EPS) continue;
      const quad = [add(a, front), add(b, front), add(b, back), add(a, back)];
      faces.push({ rings: [quad], pieces: [quad], normal: [dy / len, -dx / len, 0], kind: 'side' });
    }
  };

  if (outline.closed && filled) {
    for (const shape of shapesOf(outline.rings)) {
      if (caps) {
        const { points, triangles } = triangulate(shape.outer, shape.holes);
        const near = points.map((p) => add(p, front));
        const far = points.map((p) => add(p, back));
        const rings = [shape.outer, ...shape.holes];
        faces.push({
          rings: rings.map((ring) => ring.map((p) => add(p, front))),
          pieces: triangles.map(([a, b, c]) => [near[a], near[b], near[c]]),
          normal: [0, 0, 1],
          kind: 'cap',
        });
        faces.push({
          rings: rings.map((ring) => ring.slice().reverse().map((p) => add(p, back))),
          pieces: triangles.map(([a, b, c]) => [far[a], far[c], far[b]]),
          normal: [0, 0, -1],
          kind: 'cap',
        });
      }
      sides(shape.outer, true);
      for (const hole of shape.holes) sides(hole, true);
    }
    return { vertices, faces, closed: caps };
  }
  // A path, closed or open: its sides alone, seen from both sides.
  for (const ring of outline.rings) sides(ring, outline.closed);
  return { vertices, faces, closed: false };
}

// ---- Revolve ----------------------------------------------------------------------

export interface RevolveShape {
  /** How far round, in degrees: 360 is a full turn. */
  angle: number;
  /** How far the axis stands off the outline's edge. */
  offset: number;
  /** The edge of the outline's box the axis stands at. */
  axis: 'left' | 'right';
  /** How many steps round the turn takes; 0 works them out from the tolerance. */
  segments: number;
  /** Whether a part turn is closed with the outline at both ends. */
  caps: boolean;
}

/** The most steps a revolve takes round, and the fewest a full turn does. */
const MAX_SEGMENTS = 256;
const MIN_FULL_SEGMENTS = 12;

/** How many steps round keeps every circle a revolve draws within `tolerance` of itself. */
export function revolveSegments(radius: number, angle: number, tolerance: number): number {
  const turnShare = Math.min(1, Math.max(0, angle / 360));
  const least = Math.max(3, Math.ceil(MIN_FULL_SEGMENTS * turnShare));
  if (!(radius > tolerance)) return least;
  const step = 2 * Math.acos(1 - tolerance / radius);
  const steps = Math.ceil(((angle * Math.PI) / 180) / step);
  return Math.min(MAX_SEGMENTS, Math.max(least, steps));
}

/** Where a revolve's axis stands, and how far a point is from it. */
function revolveAxis(all: readonly Vec2[], shape: RevolveShape): { left: boolean; axisX: number; radiusOf: (p: Vec2) => number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of all) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const left = shape.axis !== 'right';
  const axisX = left ? minX - shape.offset : maxX + shape.offset;
  return { left, axisX, radiusOf: (p) => Math.max(0, left ? p.x - axisX : axisX - p.x) };
}

/** How many steps round a revolve takes: its own count, or as many as its widest point needs to look round. */
export function revolveStepCount(outline: Outline, shape: RevolveShape, tolerance: number): number {
  if (shape.segments > 0) return Math.min(MAX_SEGMENTS, Math.max(3, Math.round(shape.segments)));
  const all = outline.rings.flat();
  if (all.length === 0) return 3;
  const { radiusOf } = revolveAxis(all, shape);
  const maxRadius = all.reduce((r, p) => Math.max(r, radiusOf(p)), 0);
  return revolveSegments(maxRadius, Math.min(360, Math.max(0, shape.angle)), tolerance);
}

/**
 * An outline swept round an upright axis. Its closed rings make a closed
 * solid on a full turn, or with caps on a part one; anything else is a
 * surface seen from both sides. A point on the axis stays put, and the quads
 * that meet there come out as triangles.
 */
export function revolveMesh(outline: Outline, shape: RevolveShape, tolerance: number, filled = true): Mesh {
  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];
  const all = outline.rings.flat();
  if (all.length === 0) return { vertices, faces, closed: false };
  const { left, axisX, radiusOf } = revolveAxis(all, shape);
  const angle = Math.min(360, Math.max(0, shape.angle));
  if (angle <= EPS) return { vertices, faces, closed: false };
  const full = angle >= 360 - EPS;
  const segments = revolveStepCount(outline, shape, tolerance);
  const steps = full ? segments : segments + 1;
  const theta = (s: number): number => ((angle * Math.PI) / 180) * (s / segments);
  // The way a step round turns a point at radius r: to the right of a left
  // axis and toward the viewer, or to the left of a right one.
  const place = (p: Vec2, t: number): Vec3 => {
    const r = radiusOf(p);
    return left ? [axisX + r * Math.cos(t), p.y, r * Math.sin(t)] : [axisX - r * Math.cos(t), p.y, r * Math.sin(t)];
  };
  /** A direction in the outline's plane, carried round to angle t as the plane is. */
  const turned = (nx: number, ny: number, t: number): Vec3 => (left ? [nx * Math.cos(t), ny, nx * Math.sin(t)] : [nx * Math.cos(t), ny, -nx * Math.sin(t)]);

  const closedRings = outline.closed;
  const solid = closedRings && filled && (full || shape.caps);
  for (const ring of outline.rings) {
    const n = ring.length;
    const base = vertices.length;
    for (let s = 0; s < steps; s++) for (const p of ring) vertices.push(place(p, theta(s)));
    const index = (s: number, i: number): number => base + (s % steps) * n + i;
    const edges = closedRings ? n : n - 1;
    for (let s = 0; s < segments; s++) {
      const s2 = full ? (s + 1) % segments : s + 1;
      const mid = (theta(s) + theta(s + 1)) / 2;
      for (let i = 0; i < edges; i++) {
        const i2 = (i + 1) % n;
        const a = ring[i];
        const b = ring[i2];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= EPS) continue;
        // The edge's outward normal in the outline's plane, carried round with
        // the plane: the sweep is a rigid turn of it, so out stays out.
        const nx = dy / len;
        const ny = -dx / len;
        const quad = [index(s, i), index(s, i2), index(s2, i2), index(s2, i)];
        // Where the edge meets the axis, two corners are one point: a triangle.
        const corners = quad.filter((v, k) => {
          const w = quad[(k + 1) % 4];
          const pv = vertices[v];
          const pw = vertices[w];
          return Math.hypot(pv[0] - pw[0], pv[1] - pw[1], pv[2] - pw[2]) > EPS;
        });
        if (corners.length < 3) continue;
        faces.push({ rings: [corners], pieces: [corners], normal: turned(nx, ny, mid), kind: 'side' });
      }
    }
  }
  // A part turn's two ends, capped with the outline itself.
  if (!full && shape.caps && closedRings && filled) {
    for (const shape2 of shapesOf(outline.rings)) {
      const { points, triangles } = triangulate(shape2.outer, shape2.holes);
      const rings = [shape2.outer, ...shape2.holes];
      for (const [t, sign] of [
        [0, -1],
        [theta(segments), 1],
      ] as const) {
        const ids = points.map((p) => vertices.push(place(p, t)) - 1);
        const ringIds = rings.map((ring) => ring.map((p) => vertices.push(place(p, t)) - 1));
        // Facing on round the turn at its end, and back the way at its start.
        const tangent: Vec3 = left ? [-Math.sin(t), 0, Math.cos(t)] : [Math.sin(t), 0, Math.cos(t)];
        faces.push({
          rings: sign > 0 ? ringIds : ringIds.map((ring) => ring.slice().reverse()),
          pieces: triangles.map(([a, b, c]) => (sign > 0 ? [ids[a], ids[b], ids[c]] : [ids[a], ids[c], ids[b]])),
          normal: [tangent[0] * sign, tangent[1] * sign, tangent[2] * sign],
          kind: 'cap',
        });
      }
    }
  }
  return { vertices, faces, closed: solid };
}
