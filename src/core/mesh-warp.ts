/**
 * Mesh Warp: bending art by pins, as Illustrator's Puppet Warp does.
 *
 * The art's silhouette is filled with triangles, the triangles are deformed as
 * rigidly as they can be while pins pull them about, and the art is carried
 * onto the deformed mesh. Everything here is pure and runs in Node; the one
 * step that needs a DOM - painting the art into a coverage mask - is the
 * renderer's.
 *
 * - **The mesh** ({@link buildMesh}). The mask is grown by a small margin, so
 *   thin lines and handles that stray just outside a curve land inside it. It
 *   is traced into contours by marching squares and filled with a hexagonal
 *   lattice; the contour and lattice points are triangulated (Bowyer-Watson
 *   Delaunay), and every triangle that strays off the mask - across a notch or
 *   a hole - is dropped, so no constrained triangulation is needed.
 * - **The solve** ({@link ArapSolver}). As-Rigid-As-Possible shape
 *   manipulation (Igarashi, Moscovich and Hughes, 2005). A first step lets
 *   each triangle rotate and scale; a second fits each one's rest shape
 *   rigidly to that result and solves again, which takes the scaling back
 *   out. Pins are soft constraints anywhere inside a triangle.
 * - **The mapping** ({@link MeshMap}, {@link mapStrokeGeometry}). A point is
 *   carried by the triangle it sits in. A triangle's map is affine only
 *   inside it, so a Bézier segment is split wherever one piece would no
 *   longer be carried faithfully by moving its control points.
 */

import { sampleVectorPathPoints, splitCubicBezier } from '../sharpen/geometry.js';
import {
  DEFAULT_NIB_ANGLE,
  isImageStroke,
  isTextStroke,
  type Point,
  type Stroke,
  type VectorAnchor,
} from './types.js';

/** A point or a direction in sketch space. */
export interface Vec {
  x: number;
  y: number;
}

// ---- Masks -------------------------------------------------------------------------

/**
 * A coverage bitmap of the art: 1 where it paints, 0 elsewhere. Pixel (i, j)
 * covers the sketch square whose top-left corner is `origin + (i, j) / scale`.
 */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
  originX: number;
  originY: number;
  /** Mask pixels per sketch pixel. */
  scale: number;
}

/** Reads coverage out of RGBA pixels: set wherever alpha reaches `threshold`. */
export function maskFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  originX: number,
  originY: number,
  scale: number,
  threshold = 24,
): Mask {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) data[i] = rgba[i * 4 + 3] >= threshold ? 1 : 0;
  return { width, height, data, originX, originY, scale };
}

/** Stands in for infinity in the distance transform, where real infinities make NaNs. */
const FAR = 1e20;

/** Felzenszwalb and Huttenlocher's squared distance transform of one row or column. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Squared distance, in mask pixels, from every pixel to the nearest one whose value is `target`. */
function squaredDistanceTo(mask: Mask, target: 0 | 1): Float64Array {
  const { width: w, height: h, data } = mask;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i] === target ? 0 : FAR;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

/** The mask with `pad` empty pixels added on every side. */
function padMask(mask: Mask, pad: number): Mask {
  const width = mask.width + 2 * pad;
  const height = mask.height + 2 * pad;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < mask.height; y++) {
    data.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + pad) * width + pad);
  }
  return {
    width,
    height,
    data,
    originX: mask.originX - pad / mask.scale,
    originY: mask.originY - pad / mask.scale,
    scale: mask.scale,
  };
}

/**
 * The mask grown by `radius` mask pixels - set wherever a set pixel lies
 * within reach - with room around it for the growth and an empty border, so
 * every contour of the result closes inside it.
 */
export function dilateMask(mask: Mask, radius: number): Mask {
  const grown = padMask(mask, Math.ceil(Math.max(0, radius)) + 2);
  if (radius <= 0) return grown;
  const d2 = squaredDistanceTo(grown, 1);
  const r2 = radius * radius;
  const data = new Uint8Array(grown.width * grown.height);
  for (let i = 0; i < data.length; i++) data[i] = d2[i] <= r2 ? 1 : 0;
  return { ...grown, data };
}

/** True when the mask is set at a sketch point or at any pixel beside it. */
function nearMask(mask: Mask, x: number, y: number): boolean {
  const i = Math.floor((x - mask.originX) * mask.scale);
  const j = Math.floor((y - mask.originY) * mask.scale);
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const u = i + di;
      const v = j + dj;
      if (u >= 0 && v >= 0 && u < mask.width && v < mask.height && mask.data[v * mask.width + u] === 1) {
        return true;
      }
    }
  }
  return false;
}

// ---- Contours ----------------------------------------------------------------------

/**
 * The segments marching squares draws in a cell, by the cell's case: each is
 * a pair of cell edges (0 top, 1 right, 2 bottom, 3 left), run so the art is
 * on the right of travel. A case's bits are its top-left, top-right,
 * bottom-right and bottom-left pixels, highest first. The two saddles keep
 * their corners apart: pixels that only touch at a corner are two pieces.
 */
const CASES: Array<Array<[number, number]>> = [
  [],
  [[3, 2]],
  [[2, 1]],
  [[3, 1]],
  [[1, 0]],
  [
    [1, 0],
    [3, 2],
  ],
  [[2, 0]],
  [[3, 0]],
  [[0, 3]],
  [[0, 2]],
  [
    [0, 3],
    [2, 1],
  ],
  [[0, 1]],
  [[1, 3]],
  [[1, 2]],
  [[2, 3]],
  [],
];

/**
 * The mask's outline as closed contours in sketch coordinates, traced by
 * marching squares between pixel centres. The art is on the right of travel,
 * so an outer edge winds clockwise on screen - positive signed area - and a
 * hole winds the other way.
 */
export function traceMask(mask: Mask): Vec[][] {
  const { width: w, height: h, data } = mask;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x];
  // An edge's midpoint on a doubled grid, where pixel centres sit on even
  // coordinates: top (2x+1, 2y), right (2x+2, 2y+1), bottom (2x+1, 2y+2),
  // left (2x, 2y+1) for the cell whose top-left pixel is (x, y).
  const span = 2 * w + 6;
  const keyOf = (X: number, Y: number): number => (Y + 3) * span + (X + 3);
  const edgePoint = (x: number, y: number, edge: number): [number, number] => {
    switch (edge) {
      case 0:
        return [2 * x + 1, 2 * y];
      case 1:
        return [2 * x + 2, 2 * y + 1];
      case 2:
        return [2 * x + 1, 2 * y + 2];
      default:
        return [2 * x, 2 * y + 1];
    }
  };
  const next = new Map<number, number>();
  const where = new Map<number, [number, number]>();
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const index =
        (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      for (const [from, to] of CASES[index]) {
        const a = edgePoint(x, y, from);
        const b = edgePoint(x, y, to);
        const ka = keyOf(a[0], a[1]);
        next.set(ka, keyOf(b[0], b[1]));
        where.set(ka, a);
      }
    }
  }
  const out: Vec[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec[] = [];
    let key = start;
    while (!seen.has(key)) {
      seen.add(key);
      const [X, Y] = where.get(key)!;
      // Pixel centres are at (i + 0.5, j + 0.5) in mask units.
      loop.push({
        x: mask.originX + (X / 2 + 0.5) / mask.scale,
        y: mask.originY + (Y / 2 + 0.5) / mask.scale,
      });
      const following = next.get(key);
      if (following === undefined) break;
      key = following;
    }
    if (loop.length >= 3) out.push(loop);
  }
  return out;
}

/** Twice the signed area of a closed polygon: positive when clockwise on screen. */
function doubleArea(loop: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Ramer-Douglas-Peucker on an open polyline, keeping both ends. */
function simplifyOpen(points: Vec[], epsilon: number): Vec[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farDist = epsilon;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const d =
        len > 0 ? Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len : Math.hypot(p.x - a.x, p.y - a.y);
      if (d > farDist) {
        farDist = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([first, far], [far, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Ramer-Douglas-Peucker on a closed loop, split at the point farthest from its first. */
function simplifyClosed(loop: Vec[], epsilon: number): Vec[] {
  if (loop.length <= 4) return loop;
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const one = simplifyOpen(loop.slice(0, far + 1), epsilon);
  const two = simplifyOpen([...loop.slice(far), loop[0]], epsilon);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

/** Points evenly spaced round a closed loop, about `spacing` apart. */
function resampleClosed(loop: Vec[], spacing: number): Vec[] {
  const n = loop.length;
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += Math.hypot(loop[(i + 1) % n].x - loop[i].x, loop[(i + 1) % n].y - loop[i].y);
  const count = Math.max(3, Math.round(perimeter / spacing));
  const step = perimeter / count;
  const out: Vec[] = [];
  let seg = 0;
  let segStart = 0;
  let segLen = Math.hypot(loop[1 % n].x - loop[0].x, loop[1 % n].y - loop[0].y);
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (segStart + segLen < s && seg < n - 1) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(loop[(seg + 1) % n].x - loop[seg].x, loop[(seg + 1) % n].y - loop[seg].y);
    }
    const u = segLen > 0 ? Math.min(1, (s - segStart) / segLen) : 0;
    const a = loop[seg];
    const b = loop[(seg + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

// ---- Delaunay ----------------------------------------------------------------------

/**
 * Delaunay triangulation by Bowyer-Watson: the points go in one at a time,
 * each clearing out every triangle whose circumcircle holds it and fanning
 * the hole that leaves from itself. Returns vertex index triples.
 */
export function delaunay(points: Vec[]): number[] {
  const n = points.length;
  if (n < 3) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  // Three far vertices whose triangle holds everything; their triangles are
  // dropped at the end.
  const xs = Float64Array.from([...points.map((p) => p.x), midX - 40 * size, midX, midX + 40 * size]);
  const ys = Float64Array.from([...points.map((p) => p.y), midY - 30 * size, midY + 40 * size, midY - 30 * size]);

  const ta: number[] = [];
  const tb: number[] = [];
  const tc: number[] = [];
  const cx: number[] = [];
  const cy: number[] = [];
  const r2: number[] = [];
  const alive: boolean[] = [];
  const add = (a: number, b: number, c: number): void => {
    const ax = xs[a];
    const ay = ys[a];
    const bx = xs[b];
    const by = ys[b];
    const qx = xs[c];
    const qy = ys[c];
    const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    let ux: number;
    let uy: number;
    if (Math.abs(d) < 1e-12) {
      ux = (ax + bx + qx) / 3;
      uy = (ay + by + qy) / 3;
    } else {
      const a2 = ax * ax + ay * ay;
      const b2 = bx * bx + by * by;
      const c2 = qx * qx + qy * qy;
      ux = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / d;
      uy = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / d;
    }
    ta.push(a);
    tb.push(b);
    tc.push(c);
    cx.push(ux);
    cy.push(uy);
    r2.push(Math.abs(d) < 1e-12 ? Infinity : (ax - ux) ** 2 + (ay - uy) ** 2);
    alive.push(true);
  };
  add(n, n + 1, n + 2);

  // Coherent insertion order keeps each cavity small and near the last one.
  const order = points.map((_, i) => i).sort((i, j) => points[i].x - points[j].x || points[i].y - points[j].y);
  const edges = new Map<number, number>();
  const span = n + 3;
  let live = 1;
  for (const p of order) {
    const px = xs[p];
    const py = ys[p];
    edges.clear();
    for (let t = 0; t < ta.length; t++) {
      if (!alive[t]) continue;
      const dx = px - cx[t];
      const dy = py - cy[t];
      if (dx * dx + dy * dy >= r2[t] * (1 - 1e-12)) continue;
      alive[t] = false;
      live--;
      // Each directed edge of a bad triangle; an edge two bad triangles share
      // runs both ways and cancels, leaving the cavity's rim.
      for (const [u, v] of [
        [ta[t], tb[t]],
        [tb[t], tc[t]],
        [tc[t], ta[t]],
      ]) {
        const back = v * span + u;
        if (edges.has(back)) edges.delete(back);
        else edges.set(u * span + v, 0);
      }
    }
    for (const key of edges.keys()) {
      add(Math.floor(key / span), key % span, p);
      live++;
    }
    // Keep the scan short: drop the dead once they outnumber the living.
    if (ta.length > 4 * live + 64) {
      let w = 0;
      for (let t = 0; t < ta.length; t++) {
        if (!alive[t]) continue;
        ta[w] = ta[t];
        tb[w] = tb[t];
        tc[w] = tc[t];
        cx[w] = cx[t];
        cy[w] = cy[t];
        r2[w] = r2[t];
        alive[w] = true;
        w++;
      }
      ta.length = tb.length = tc.length = cx.length = cy.length = r2.length = alive.length = w;
    }
  }
  const out: number[] = [];
  for (let t = 0; t < ta.length; t++) {
    if (!alive[t] || ta[t] >= n || tb[t] >= n || tc[t] >= n) continue;
    out.push(ta[t], tb[t], tc[t]);
  }
  return out;
}

// ---- The mesh ----------------------------------------------------------------------

/** A triangle mesh over the art, at rest. */
export interface Mesh {
  /** How many vertices it has. */
  count: number;
  /** Rest positions: x then y for each vertex, in sketch coordinates. */
  rest: Float64Array;
  /** Vertex index triples, one per triangle, each wound clockwise on screen. */
  triangles: Uint32Array;
  /** Edges only one triangle uses - the mesh's outline - as vertex pairs. */
  boundary: Uint32Array;
  /** Which connected piece each vertex belongs to, numbered from 0. */
  component: Int32Array;
  /** How many connected pieces there are. */
  components: number;
  /** The lattice spacing it was built at, in sketch pixels. */
  spacing: number;
}

export interface MeshOptions {
  /** How far the mesh reaches past the art, in sketch pixels. Default 3, Illustrator's Expand default. */
  margin?: number;
  /** Triangle spacing in sketch pixels. By default, about a thousand vertices' worth for the art's area. */
  spacing?: number;
}

/**
 * Meshes the art a mask covers: grown by the margin, outlined, filled with a
 * hexagonal lattice, triangulated, and trimmed back to the mask. Null when
 * the mask covers nothing.
 */
export function buildMesh(mask: Mask, options: MeshOptions = {}): Mesh | null {
  const margin = options.margin ?? 3;
  const grown = dilateMask(mask, margin * mask.scale);
  let covered = 0;
  for (let i = 0; i < grown.data.length; i++) covered += grown.data[i];
  if (covered === 0) return null;
  const area = covered / (grown.scale * grown.scale);
  const spacing = options.spacing ?? Math.max(4, Math.sqrt(area / 1000));

  // The outline, simplified to half a mask pixel and spaced like the lattice.
  const points: Vec[] = [];
  for (const loop of traceMask(grown)) {
    // A speck smaller than a triangle would only make slivers.
    if (Math.abs(doubleArea(loop)) / 2 < (spacing * spacing) / 8) continue;
    points.push(...resampleClosed(simplifyClosed(loop, 0.5 / grown.scale), spacing));
  }

  // The lattice, kept half a spacing clear of the outline, each point nudged a
  // hair by a fixed amount so that no four lie on one circle.
  const d2 = squaredDistanceTo(grown, 0);
  const rowStep = (spacing * Math.sqrt(3)) / 2;
  const x0 = grown.originX;
  const y0 = grown.originY;
  const x1 = grown.originX + grown.width / grown.scale;
  const y1 = grown.originY + grown.height / grown.scale;
  let row = 0;
  for (let y = y0 + rowStep / 2; y < y1; y += rowStep, row++) {
    for (let x = x0 + (row % 2 === 0 ? spacing / 2 : spacing); x < x1; x += spacing) {
      const i = Math.floor((x - grown.originX) * grown.scale);
      const j = Math.floor((y - grown.originY) * grown.scale);
      if (i < 0 || j < 0 || i >= grown.width || j >= grown.height) continue;
      const k = j * grown.width + i;
      if (grown.data[k] !== 1) continue;
      if (Math.sqrt(d2[k]) / grown.scale < spacing / 2) continue;
      const n = points.length;
      points.push({
        x: x + (hash(n * 2 + 1) - 0.5) * spacing * 1e-3,
        y: y + (hash(n * 2 + 2) - 0.5) * spacing * 1e-3,
      });
    }
  }
  if (points.length < 3) return null;

  // Triangulate, then drop whatever strays off the mask: a triangle across a
  // notch or a hole has its middle, or some stretch of an edge, out there.
  // Delaunay also lays long slivers along the hull between pieces of art,
  // hugging an edge so closely that every test point is within a pixel of it;
  // a triangle of the mesh proper is never longer than a few spacings, so a
  // long edge is out as well.
  const tri = delaunay(points);
  const kept: number[] = [];
  const longest = 3 * spacing;
  const off = (x: number, y: number): boolean => !nearMask(grown, x, y);
  const edgeOff = (p: Vec, q: Vec): boolean => {
    if (Math.hypot(q.x - p.x, q.y - p.y) > longest) return true;
    for (const t of [0.25, 0.5, 0.75]) if (off(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)) return true;
    return false;
  };
  for (let t = 0; t < tri.length; t += 3) {
    const a = points[tri[t]];
    const b = points[tri[t + 1]];
    const c = points[tri[t + 2]];
    const twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(twice) < 1e-9 * spacing * spacing) continue;
    if (off((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)) continue;
    if (edgeOff(a, b) || edgeOff(b, c) || edgeOff(c, a)) continue;
    // Clockwise on screen, whichever way Delaunay handed it over.
    if (twice > 0) kept.push(tri[t], tri[t + 1], tri[t + 2]);
    else kept.push(tri[t], tri[t + 2], tri[t + 1]);
  }
  if (kept.length === 0) return null;

  // Only the vertices some triangle uses.
  const index = new Int32Array(points.length).fill(-1);
  const rest: number[] = [];
  for (const v of kept) {
    if (index[v] >= 0) continue;
    index[v] = rest.length / 2;
    rest.push(points[v].x, points[v].y);
  }
  const triangles = Uint32Array.from(kept, (v) => index[v]);
  const count = rest.length / 2;

  // Connected pieces, by union-find over the triangles.
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const a = find(triangles[t]);
    parent[find(triangles[t + 1])] = a;
    parent[find(triangles[t + 2])] = a;
  }
  const component = new Int32Array(count);
  const numbering = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (!numbering.has(root)) numbering.set(root, numbering.size);
    component[i] = numbering.get(root)!;
  }

  // The outline: the edges only one triangle uses.
  const uses = new Map<number, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const u = triangles[t + e];
      const v = triangles[t + ((e + 1) % 3)];
      const key = Math.min(u, v) * count + Math.max(u, v);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const boundary: number[] = [];
  for (const [key, n] of uses) {
    if (n === 1) boundary.push(Math.floor(key / count), key % count);
  }

  return {
    count,
    rest: Float64Array.from(rest),
    triangles,
    boundary: Uint32Array.from(boundary),
    component,
    components: numbering.size,
    spacing,
  };
}

/** A fixed pseudo-random number in [0, 1) for an integer: the lattice's jitter. */
function hash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Where the first pins go: two along the long axis of the biggest piece, a
 * fifth of the way in from each end, and one at the middle of every other
 * piece - so every piece has a pin. Each lands on the mesh vertex nearest to
 * where it was aimed, which keeps it inside the art.
 */
export function autoPins(mesh: Mesh): Vec[] {
  const pins: Vec[] = [];
  const sizes = new Array<number>(mesh.components).fill(0);
  for (let i = 0; i < mesh.count; i++) sizes[mesh.component[i]]++;
  const biggest = sizes.indexOf(Math.max(...sizes));
  for (let c = 0; c < mesh.components; c++) {
    const members: number[] = [];
    for (let i = 0; i < mesh.count; i++) if (mesh.component[i] === c) members.push(i);
    let mx = 0;
    let my = 0;
    for (const i of members) {
      mx += mesh.rest[2 * i];
      my += mesh.rest[2 * i + 1];
    }
    mx /= members.length;
    my /= members.length;
    const nearest = (x: number, y: number): Vec => {
      let best = members[0];
      let bestD = Infinity;
      for (const i of members) {
        const d = (mesh.rest[2 * i] - x) ** 2 + (mesh.rest[2 * i + 1] - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return { x: mesh.rest[2 * best], y: mesh.rest[2 * best + 1] };
    };
    if (c !== biggest || members.length < 2) {
      pins.push(nearest(mx, my));
      continue;
    }
    // The long axis: the principal direction of the piece's vertices.
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const i of members) {
      const dx = mesh.rest[2 * i] - mx;
      const dy = mesh.rest[2 * i + 1] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of members) {
      const s = (mesh.rest[2 * i] - mx) * ax + (mesh.rest[2 * i + 1] - my) * ay;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    for (const f of [0.2, 0.8]) {
      const s = lo + (hi - lo) * f;
      pins.push(nearest(mx + ax * s, my + ay * s));
    }
  }
  return pins;
}

// ---- Finding points in the mesh ------------------------------------------------------

/** Where a point sits in the mesh: a triangle and the point's weights in it. */
export interface MeshSpot {
  triangle: number;
  weights: [number, number, number];
  /** False when the point is off the mesh and the triangle is only the nearest one. */
  inside: boolean;
}

/**
 * Finds points among the rest triangles, through a uniform grid of the
 * triangles' bounds: a point is tested only against the triangles its cell
 * lists.
 */
export class MeshLocator {
  private readonly cells: number[][];
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly size: number;

  constructor(private readonly mesh: Mesh) {
    const { rest, triangles } = mesh;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < mesh.count; i++) {
      minX = Math.min(minX, rest[2 * i]);
      minY = Math.min(minY, rest[2 * i + 1]);
      maxX = Math.max(maxX, rest[2 * i]);
      maxY = Math.max(maxY, rest[2 * i + 1]);
    }
    this.size = Math.max(mesh.spacing * 2, 1e-6);
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / this.size) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - minY) / this.size) + 1);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    for (let t = 0; t < triangles.length / 3; t++) {
      let tx0 = Infinity;
      let ty0 = Infinity;
      let tx1 = -Infinity;
      let ty1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = triangles[3 * t + k];
        tx0 = Math.min(tx0, rest[2 * v]);
        ty0 = Math.min(ty0, rest[2 * v + 1]);
        tx1 = Math.max(tx1, rest[2 * v]);
        ty1 = Math.max(ty1, rest[2 * v + 1]);
      }
      const c0 = this.col(tx0);
      const c1 = this.col(tx1);
      const r0 = this.row(ty0);
      const r1 = this.row(ty1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(t);
    }
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.size)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.size)));
  }

  /** A point's barycentric weights in a rest triangle; outside it they run past 0 and 1. */
  weights(t: number, p: Vec): [number, number, number] {
    const { rest, triangles } = this.mesh;
    const a = triangles[3 * t];
    const b = triangles[3 * t + 1];
    const c = triangles[3 * t + 2];
    const ax = rest[2 * a];
    const ay = rest[2 * a + 1];
    const v0x = rest[2 * b] - ax;
    const v0y = rest[2 * b + 1] - ay;
    const v1x = rest[2 * c] - ax;
    const v1y = rest[2 * c + 1] - ay;
    const v2x = p.x - ax;
    const v2y = p.y - ay;
    const den = v0x * v1y - v1x * v0y;
    if (Math.abs(den) < 1e-18) return [1, 0, 0];
    const wb = (v2x * v1y - v1x * v2y) / den;
    const wc = (v0x * v2y - v2x * v0y) / den;
    return [1 - wb - wc, wb, wc];
  }

  /** True when a point lies in some triangle: the quick test, which never searches outward. */
  contains(p: Vec): boolean {
    const outside =
      p.x < this.minX || p.y < this.minY || p.x > this.minX + this.cols * this.size || p.y > this.minY + this.rows * this.size;
    if (outside) return false;
    for (const t of this.cells[this.row(p.y) * this.cols + this.col(p.x)]) {
      const w = this.weights(t, p);
      if (w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9) return true;
    }
    return false;
  }

  /** The triangle a point is in; off the mesh, the nearest one, whose map it takes. */
  locate(p: Vec): MeshSpot {
    const cell = this.cells[this.row(p.y) * this.cols + this.col(p.x)];
    const inRange = p.x >= this.minX - this.size && p.y >= this.minY - this.size;
    if (inRange) {
      for (const t of cell) {
        const w = this.weights(t, p);
        if (w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9) return { triangle: t, weights: w, inside: true };
      }
    }
    // Off the mesh: search outward ring by ring for the nearest triangle.
    const c0 = this.col(p.x);
    const r0 = this.row(p.y);
    let best = -1;
    let bestD = Infinity;
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
          for (const t of this.cells[r * this.cols + c]) {
            const d = this.distanceTo(t, p);
            if (d < bestD) {
              bestD = d;
              best = t;
            }
          }
        }
      }
      // A triangle only a farther ring holds is at least this ring's reach away.
      if (best >= 0 && bestD <= ring * this.size) break;
    }
    if (best < 0) best = 0;
    const w = this.weights(best, p);
    return { triangle: best, weights: w, inside: w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9 };
  }

  /** Distance from a point to a rest triangle, zero inside it. */
  private distanceTo(t: number, p: Vec): number {
    const w = this.weights(t, p);
    if (w[0] >= 0 && w[1] >= 0 && w[2] >= 0) return 0;
    const { rest, triangles } = this.mesh;
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k];
      const b = triangles[3 * t + ((k + 1) % 3)];
      best = Math.min(
        best,
        segmentDistance(p, rest[2 * a], rest[2 * a + 1], rest[2 * b], rest[2 * b + 1]),
      );
    }
    return best;
  }
}

function segmentDistance(p: Vec, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / len2)) : 0;
  return Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t));
}

// ---- The solve ---------------------------------------------------------------------

/** A pin: where it sits in the rest mesh. Where it has been dragged to is a separate target. */
export interface WarpPin {
  triangle: number;
  weights: [number, number, number];
}

/** A pin's rest position: its weights applied to its triangle's rest vertices. */
export function pinRest(mesh: Mesh, pin: WarpPin): Vec {
  const [a, b, c] = triangleOf(mesh, pin.triangle);
  const [wa, wb, wc] = pin.weights;
  return {
    x: wa * mesh.rest[2 * a] + wb * mesh.rest[2 * b] + wc * mesh.rest[2 * c],
    y: wa * mesh.rest[2 * a + 1] + wb * mesh.rest[2 * b + 1] + wc * mesh.rest[2 * c + 1],
  };
}

function triangleOf(mesh: Mesh, t: number): [number, number, number] {
  return [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
}

/** Accumulates a symmetric matrix entry by entry, one map of columns per row. */
function addTo(rows: Array<Map<number, number>>, i: number, j: number, v: number): void {
  if (v === 0) return;
  rows[i].set(j, (rows[i].get(j) ?? 0) + v);
}

/**
 * The mesh's vertices in reverse Cuthill-McKee order, as each vertex's place
 * in it. Numbering a mesh outward from one end, a front at a time, keeps every
 * row of a matrix over it close to the diagonal, which is what keeps a
 * Cholesky factor of it small.
 */
function reverseCuthillMcKee(count: number, triangles: Uint32Array): Int32Array {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k];
      const b = triangles[t + ((k + 1) % 3)];
      sets[a].add(b);
      sets[b].add(a);
    }
  }
  const neighbours = sets.map((s) => [...s].sort((a, b) => sets[a].size - sets[b].size));
  const visited = new Uint8Array(count);
  // The last vertex a breadth-first walk from `from` reaches, fewest neighbours first.
  const farthest = (from: number): number => {
    const seen = new Uint8Array(count);
    let level = [from];
    seen[from] = 1;
    let last = level;
    while (level.length > 0) {
      last = level;
      const next: number[] = [];
      for (const v of level) {
        for (const w of neighbours[v]) {
          if (!seen[w]) {
            seen[w] = 1;
            next.push(w);
          }
        }
      }
      level = next;
    }
    return last.reduce((a, b) => (neighbours[b].length < neighbours[a].length ? b : a));
  };
  const order: number[] = [];
  for (let s = 0; s < count; s++) {
    if (visited[s]) continue;
    // A start near one end of the piece: twice to the farthest vertex.
    const start = farthest(farthest(s));
    visited[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      order.push(v);
      for (const w of neighbours[v]) {
        if (!visited[w]) {
          visited[w] = 1;
          queue.push(w);
        }
      }
    }
  }
  const position = new Int32Array(count);
  order.forEach((v, k) => {
    position[v] = count - 1 - k;
  });
  return position;
}

/**
 * The Cholesky factor of a sparse symmetric positive definite matrix, kept
 * row by row from each row's first nonzero column to its diagonal - the
 * envelope, which the factor never fills outside. Built once, it solves for
 * any right-hand side with two triangular sweeps.
 */
class EnvelopeCholesky {
  private readonly first: Int32Array;
  private readonly offset: Int32Array;
  private readonly values: Float64Array;
  private readonly work: Float64Array;

  /**
   * @param rows The matrix, a map of columns per row, in the caller's numbering.
   * @param position Each unknown's place in the order the factor is built in.
   */
  constructor(
    private readonly size: number,
    rows: Array<Map<number, number>>,
    private readonly position: Int32Array,
  ) {
    const first = Int32Array.from({ length: size }, (_, p) => p);
    rows.forEach((row, i) => {
      const p = position[i];
      for (const j of row.keys()) first[p] = Math.min(first[p], position[j]);
    });
    // values[offset[p] + k] holds column k of row p.
    const offset = new Int32Array(size);
    let total = 0;
    for (let p = 0; p < size; p++) {
      offset[p] = total - first[p];
      total += p - first[p] + 1;
    }
    const values = new Float64Array(total);
    rows.forEach((row, i) => {
      const p = position[i];
      for (const [j, v] of row) {
        const q = position[j];
        if (q <= p) values[offset[p] + q] += v;
      }
    });
    let largest = 0;
    for (let p = 0; p < size; p++) largest = Math.max(largest, values[offset[p] + p]);
    for (let p = 0; p < size; p++) {
      const fp = first[p];
      const op = offset[p];
      for (let q = fp; q <= p; q++) {
        const oq = offset[q];
        let sum = values[op + q];
        for (let k = Math.max(fp, first[q]); k < q; k++) sum -= values[op + k] * values[oq + k];
        if (q < p) {
          values[op + q] = sum / values[oq + q];
        } else {
          // Round-off can leave a pivot of a barely-constrained unknown at or
          // under zero; a tiny positive one keeps the factor usable.
          values[op + p] = Math.sqrt(sum > largest * 1e-14 ? sum : largest * 1e-14 || 1e-300);
        }
      }
    }
    this.first = first;
    this.offset = offset;
    this.values = values;
    this.work = new Float64Array(size);
  }

  /** Solves the matrix against `b`, writing the answer into `out`; both in the caller's numbering. */
  solve(b: Float64Array, out: Float64Array): void {
    const { size, first, offset, values, position } = this;
    const y = this.work;
    for (let i = 0; i < size; i++) y[position[i]] = b[i];
    for (let p = 0; p < size; p++) {
      const op = offset[p];
      let sum = y[p];
      for (let k = first[p]; k < p; k++) sum -= values[op + k] * y[k];
      y[p] = sum / values[op + p];
    }
    for (let p = size - 1; p >= 0; p--) {
      const op = offset[p];
      const x = y[p] / values[op + p];
      y[p] = x;
      for (let k = first[p]; k < p; k++) y[k] -= values[op + k] * x;
    }
    for (let i = 0; i < size; i++) out[i] = y[position[i]];
  }
}

/** How much a pin outweighs one term of the shape energy. */
const PIN_WEIGHT = 1000;
/**
 * A pull back to rest, only as a numerical guard. A piece with two pins in
 * different places is fixed without it, and any real weight here would make a
 * long piece bend back toward where it was rather than swing with its pins.
 */
const REST_WEIGHT = 1e-9;

/**
 * As-rigid-as-possible deformation of a mesh by pins (Igarashi, Moscovich and
 * Hughes, 2005).
 *
 * How a piece of the mesh moves depends on how many pins it has. With none it
 * stays put; with one - or several on one spot - it follows that pin rigidly,
 * as a Puppet Warp pin drags the whole art: the shape energy alone would leave
 * a single pin free to swing the piece round it. With pins in two places or
 * more it is solved in the paper's two steps:
 *
 * 1. Each vertex of each triangle is written in the frame of the opposite
 *    edge at rest, and the deformed vertices are asked to keep those frame
 *    coordinates. That lets each triangle rotate and scale uniformly.
 * 2. Each triangle's rest shape is fitted rigidly to step 1's result, and the
 *    vertices are solved to match those rigid triangles edge by edge, which
 *    takes step 1's scaling back out.
 *
 * Both matrices depend on the rest mesh and on which pins there are, not on
 * where the pins have been dragged, so {@link setPins} factors them once and
 * every frame of a drag is only a few triangular sweeps.
 */
export class ArapSolver {
  private pins: WarpPin[] = [];
  /** Per piece: 0 no pin, 1 pinned at one spot, 2 pinned at two or more. */
  private mode = new Int8Array(0);
  /** Per piece pinned at one spot: the pin it follows. */
  private lonePin = new Int32Array(0);
  private step1: EnvelopeCholesky | null = null;
  private step2: EnvelopeCholesky | null = null;
  /** Each triangle's vertices in the frames of their opposite edges, at rest: x then y, three times. */
  private readonly frames: Float64Array;
  /** Each vertex's place in the factors' order. */
  private readonly order: Int32Array;
  private readonly order1: Int32Array;
  private readonly after1: Float64Array;

  constructor(private readonly mesh: Mesh) {
    const { rest, triangles, count } = mesh;
    const nt = triangles.length / 3;
    this.frames = new Float64Array(nt * 6);
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * t + k];
        const b = triangles[3 * t + ((k + 1) % 3)];
        const c = triangles[3 * t + ((k + 2) % 3)];
        const ex = rest[2 * b] - rest[2 * a];
        const ey = rest[2 * b + 1] - rest[2 * a + 1];
        const dx = rest[2 * c] - rest[2 * a];
        const dy = rest[2 * c + 1] - rest[2 * a + 1];
        const len2 = ex * ex + ey * ey || 1;
        // c = a + x·e + y·R(e), with R turning a vector a quarter turn: (-ey, ex).
        this.frames[6 * t + 2 * k] = (dx * ex + dy * ey) / len2;
        this.frames[6 * t + 2 * k + 1] = (dx * -ey + dy * ex) / len2;
      }
    }
    this.order = reverseCuthillMcKee(count, triangles);
    // Step 1 has two unknowns a vertex, x and y side by side.
    this.order1 = new Int32Array(2 * count);
    for (let v = 0; v < count; v++) {
      this.order1[2 * v] = 2 * this.order[v];
      this.order1[2 * v + 1] = 2 * this.order[v] + 1;
    }
    this.after1 = new Float64Array(2 * count);
    this.setPins([]);
  }

  /** The pins, which fixes the factors until they change. */
  setPins(pins: WarpPin[]): void {
    const { mesh } = this;
    this.pins = pins.map((p) => ({ triangle: p.triangle, weights: [...p.weights] as [number, number, number] }));
    this.mode = new Int8Array(mesh.components);
    this.lonePin = new Int32Array(mesh.components).fill(-1);
    const spots = pins.map((pin) => pinRest(mesh, pin));
    const apart = mesh.spacing * 1e-3;
    pins.forEach((pin, k) => {
      const c = mesh.component[mesh.triangles[3 * pin.triangle]];
      if (this.lonePin[c] < 0) {
        this.lonePin[c] = k;
        this.mode[c] = 1;
      } else {
        const lone = spots[this.lonePin[c]];
        if (Math.hypot(spots[k].x - lone.x, spots[k].y - lone.y) > apart) this.mode[c] = 2;
      }
    });
    this.factor();
  }

  private solved(vertex: number): boolean {
    return this.mode[this.mesh.component[vertex]] === 2;
  }

  private factor(): void {
    const { mesh } = this;
    const n = mesh.count;
    this.step1 = null;
    this.step2 = null;
    if (!this.mode.includes(2)) return;
    const rows1 = Array.from({ length: 2 * n }, () => new Map<number, number>());
    const rows2 = Array.from({ length: n }, () => new Map<number, number>());
    const nt = mesh.triangles.length / 3;
    for (let t = 0; t < nt; t++) {
      if (!this.solved(mesh.triangles[3 * t])) continue;
      for (let k = 0; k < 3; k++) {
        const a = mesh.triangles[3 * t + k];
        const b = mesh.triangles[3 * t + ((k + 1) % 3)];
        const c = mesh.triangles[3 * t + ((k + 2) % 3)];
        const x = this.frames[6 * t + 2 * k];
        const y = this.frames[6 * t + 2 * k + 1];
        // The residual c' - a' - x(b' - a') - y·R(b' - a'), one row for each
        // of its components, over [a'x, a'y, b'x, b'y, c'x, c'y].
        const vars = [2 * a, 2 * a + 1, 2 * b, 2 * b + 1, 2 * c, 2 * c + 1];
        const rowX = [x - 1, -y, -x, y, 1, 0];
        const rowY = [y, x - 1, -y, -x, 0, 1];
        for (const r of [rowX, rowY]) {
          for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) addTo(rows1, vars[i], vars[j], r[i] * r[j]);
        }
        // Step 2: the edge from a to b, matched to the fitted triangle's.
        addTo(rows2, a, a, 1);
        addTo(rows2, b, b, 1);
        addTo(rows2, a, b, -1);
        addTo(rows2, b, a, -1);
      }
    }
    for (const pin of this.pins) {
      const vs = triangleOf(mesh, pin.triangle);
      if (!this.solved(vs[0])) continue;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const w = PIN_WEIGHT * pin.weights[i] * pin.weights[j];
          addTo(rows1, 2 * vs[i], 2 * vs[j], w);
          addTo(rows1, 2 * vs[i] + 1, 2 * vs[j] + 1, w);
          addTo(rows2, vs[i], vs[j], w);
        }
      }
    }
    for (let v = 0; v < n; v++) {
      // A vertex that is not solved for is simply told where it goes.
      const w = this.solved(v) ? REST_WEIGHT : 1;
      addTo(rows1, 2 * v, 2 * v, w);
      addTo(rows1, 2 * v + 1, 2 * v + 1, w);
      addTo(rows2, v, v, w);
    }
    this.step1 = new EnvelopeCholesky(2 * n, rows1, this.order1);
    this.step2 = new EnvelopeCholesky(n, rows2, this.order);
  }

  /**
   * The deformed mesh with each pin dragged to its target, one per pin in the
   * order {@link setPins} was given them: x then y for every vertex.
   */
  solve(targets: Vec[]): Float64Array {
    const { mesh } = this;
    const n = mesh.count;
    const rest = mesh.rest;
    // Where the vertices of a piece that is not solved for go: at rest, or
    // moved with its pin.
    const fixed = new Float64Array(2 * n);
    for (let v = 0; v < n; v++) {
      const c = mesh.component[v];
      let dx = 0;
      let dy = 0;
      if (this.mode[c] === 1) {
        const k = this.lonePin[c];
        const from = pinRest(mesh, this.pins[k]);
        dx = targets[k].x - from.x;
        dy = targets[k].y - from.y;
      }
      fixed[2 * v] = rest[2 * v] + dx;
      fixed[2 * v + 1] = rest[2 * v + 1] + dy;
    }
    if (!this.step1 || !this.step2) return fixed;

    // Step 1: similarity-invariant.
    const b1 = new Float64Array(2 * n);
    for (let v = 0; v < n; v++) {
      const w = this.solved(v) ? REST_WEIGHT : 1;
      b1[2 * v] = w * fixed[2 * v];
      b1[2 * v + 1] = w * fixed[2 * v + 1];
    }
    this.pins.forEach((pin, k) => {
      const vs = triangleOf(mesh, pin.triangle);
      if (!this.solved(vs[0])) return;
      for (let i = 0; i < 3; i++) {
        b1[2 * vs[i]] += PIN_WEIGHT * pin.weights[i] * targets[k].x;
        b1[2 * vs[i] + 1] += PIN_WEIGHT * pin.weights[i] * targets[k].y;
      }
    });
    this.step1.solve(b1, this.after1);

    // Step 2: each triangle's rest shape, fitted rigidly to step 1.
    const bx = new Float64Array(n);
    const by = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      const w = this.solved(v) ? REST_WEIGHT : 1;
      bx[v] = w * fixed[2 * v];
      by[v] = w * fixed[2 * v + 1];
    }
    const nt = mesh.triangles.length / 3;
    const fx = [0, 0, 0];
    const fy = [0, 0, 0];
    for (let t = 0; t < nt; t++) {
      const vs = triangleOf(mesh, t);
      if (!this.solved(vs[0])) continue;
      this.fitRigid(vs, fx, fy);
      for (let k = 0; k < 3; k++) {
        const a = vs[k];
        const b = vs[(k + 1) % 3];
        const gx = fx[(k + 1) % 3] - fx[k];
        const gy = fy[(k + 1) % 3] - fy[k];
        bx[a] -= gx;
        bx[b] += gx;
        by[a] -= gy;
        by[b] += gy;
      }
    }
    this.pins.forEach((pin, k) => {
      const vs = triangleOf(mesh, pin.triangle);
      if (!this.solved(vs[0])) return;
      for (let i = 0; i < 3; i++) {
        bx[vs[i]] += PIN_WEIGHT * pin.weights[i] * targets[k].x;
        by[vs[i]] += PIN_WEIGHT * pin.weights[i] * targets[k].y;
      }
    });
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    this.step2.solve(bx, sx);
    this.step2.solve(by, sy);

    const out = new Float64Array(2 * n);
    for (let v = 0; v < n; v++) {
      const mine = this.solved(v);
      out[2 * v] = mine ? sx[v] : fixed[2 * v];
      out[2 * v + 1] = mine ? sy[v] : fixed[2 * v + 1];
    }
    return out;
  }

  /**
   * A triangle's rest shape moved rigidly onto its step-1 vertices: the
   * closed-form 2D Procrustes fit, rotation and translation only.
   */
  private fitRigid(vs: [number, number, number], fx: number[], fy: number[]): void {
    const rest = this.mesh.rest;
    const got = this.after1;
    let rx = 0;
    let ry = 0;
    let qx = 0;
    let qy = 0;
    for (const v of vs) {
      rx += rest[2 * v];
      ry += rest[2 * v + 1];
      qx += got[2 * v];
      qy += got[2 * v + 1];
    }
    rx /= 3;
    ry /= 3;
    qx /= 3;
    qy /= 3;
    let dot = 0;
    let cross = 0;
    for (const v of vs) {
      const ax = rest[2 * v] - rx;
      const ay = rest[2 * v + 1] - ry;
      const bx = got[2 * v] - qx;
      const by = got[2 * v + 1] - qy;
      dot += ax * bx + ay * by;
      cross += ax * by - ay * bx;
    }
    const len = Math.hypot(dot, cross) || 1;
    const cos = dot / len;
    const sin = cross / len;
    vs.forEach((v, k) => {
      const ax = rest[2 * v] - rx;
      const ay = rest[2 * v + 1] - ry;
      fx[k] = qx + cos * ax - sin * ay;
      fy[k] = qy + sin * ax + cos * ay;
    });
  }
}

// ---- Carrying the art ---------------------------------------------------------------

/**
 * The map from the rest mesh onto a deformed one: a point goes where its
 * triangle takes it. A triangle that did not move maps its points exactly,
 * to the last bit, so art under a mesh nobody has pulled comes back as it was.
 */
export class MeshMap {
  constructor(
    private readonly mesh: Mesh,
    private readonly locator: MeshLocator,
    private readonly deformed: Float64Array,
  ) {}

  /** Where a rest point goes. */
  point(p: Vec): Vec {
    const spot = this.locator.locate(p);
    const [a, b, c] = triangleOf(this.mesh, spot.triangle);
    const { rest } = this.mesh;
    const d = this.deformed;
    if (
      d[2 * a] === rest[2 * a] &&
      d[2 * a + 1] === rest[2 * a + 1] &&
      d[2 * b] === rest[2 * b] &&
      d[2 * b + 1] === rest[2 * b + 1] &&
      d[2 * c] === rest[2 * c] &&
      d[2 * c + 1] === rest[2 * c + 1]
    ) {
      return { x: p.x, y: p.y };
    }
    const [wa, wb, wc] = spot.weights;
    return {
      x: wa * d[2 * a] + wb * d[2 * b] + wc * d[2 * c],
      y: wa * d[2 * a + 1] + wb * d[2 * b + 1] + wc * d[2 * c + 1],
    };
  }

  /** How far the mesh turns at a rest point, in degrees, clockwise on screen. */
  rotation(p: Vec): number {
    const spot = this.locator.locate(p);
    const vs = triangleOf(this.mesh, spot.triangle);
    const { rest } = this.mesh;
    const d = this.deformed;
    let rx = 0;
    let ry = 0;
    let qx = 0;
    let qy = 0;
    for (const v of vs) {
      rx += rest[2 * v] / 3;
      ry += rest[2 * v + 1] / 3;
      qx += d[2 * v] / 3;
      qy += d[2 * v + 1] / 3;
    }
    let dot = 0;
    let cross = 0;
    for (const v of vs) {
      const ax = rest[2 * v] - rx;
      const ay = rest[2 * v + 1] - ry;
      const bx = d[2 * v] - qx;
      const by = d[2 * v + 1] - qy;
      dot += ax * bx + ay * by;
      cross += ax * by - ay * bx;
    }
    return (Math.atan2(cross, dot) * 180) / Math.PI;
  }
}

/** A stroke's geometry after a warp, ready for the store. */
export interface WarpedGeometry {
  points: Point[];
  vector?: Stroke['vector'];
  nibAngle?: number;
}

/** How far a carried curve may stray from the image of the curve it was, in sketch pixels. */
export const WARP_TOLERANCE = 0.2;
/** How many times a segment may be halved to carry it faithfully. */
const MAX_SPLITS = 6;

/**
 * A stroke carried onto the deformed mesh. Widths are left alone - the point
 * of as-rigid-as-possible is that nothing stretches.
 *
 * - Text and images move with the point that anchors them, unbent.
 * - A freehand stroke moves point by point.
 * - A vector stroke moves its anchors and handles, and a segment one
 *   triangle's map cannot carry is split until each piece can; its points are
 *   then sampled afresh from the new anchors.
 * - A Copic nib turns with the mesh under the stroke's first point.
 */
export function mapStrokeGeometry(stroke: Stroke, map: MeshMap, tolerance = WARP_TOLERANCE): WarpedGeometry {
  const first = stroke.points[0];
  if (!first) return { points: [] };
  if (isTextStroke(stroke) || isImageStroke(stroke)) {
    const to = map.point(first);
    const dx = to.x - first.x;
    const dy = to.y - first.y;
    return { points: stroke.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
  }
  const out: WarpedGeometry = { points: [] };
  if (stroke.vector && stroke.vector.anchors.length >= 2) {
    const closed = stroke.vector.closed === true;
    const anchors = carryAnchors(stroke.vector.anchors, closed, map, tolerance);
    out.vector = { ...stroke.vector, anchors };
    out.points = sampleVectorPathPoints(anchors, closed);
  } else {
    out.points = stroke.points.map((p) => {
      const to = map.point(p);
      return { ...p, x: to.x, y: to.y };
    });
  }
  if (stroke.tool === 'copic') {
    const turned = (stroke.nibAngle ?? DEFAULT_NIB_ANGLE) + map.rotation(first);
    out.nibAngle = ((turned % 360) + 360) % 360;
  }
  return out;
}

/** A piece of a carried segment: the handles at its two ends and where it ends, all carried. */
interface CarriedPiece {
  /** Out-handle at the piece's start; null where the segment had none. */
  hOut: Vec | null;
  /** In-handle at the piece's end; null where the segment had none. */
  hIn: Vec | null;
  to: Vec;
}

function carryAnchors(anchors: VectorAnchor[], closed: boolean, map: MeshMap, tolerance: number): VectorAnchor[] {
  const out: VectorAnchor[] = [];
  let start = 0;
  for (let i = 1; i <= anchors.length; i++) {
    if (i === anchors.length || anchors[i].move) {
      out.push(...carrySubpath(anchors.slice(start, i), closed, map, tolerance));
      start = i;
    }
  }
  return out;
}

function carrySubpath(sub: VectorAnchor[], closed: boolean, map: MeshMap, tolerance: number): VectorAnchor[] {
  const head: VectorAnchor = { p: map.point(sub[0].p) };
  if (sub[0].move) head.move = true;
  const result: VectorAnchor[] = [head];
  const segments = closed ? sub.length : sub.length - 1;
  for (let s = 0; s < segments; s++) {
    const from = sub[s];
    const to = sub[(s + 1) % sub.length];
    const pieces: CarriedPiece[] = [];
    carrySegment(map, from.p, from.hOut ?? null, to.hIn ?? null, to.p, tolerance, 0, pieces);
    let current = result[result.length - 1];
    pieces.forEach((piece, k) => {
      if (piece.hOut) current.hOut = piece.hOut;
      const closing = closed && s === segments - 1 && k === pieces.length - 1;
      if (closing) {
        if (piece.hIn) result[0].hIn = piece.hIn;
        return;
      }
      const next: VectorAnchor = { p: piece.to };
      if (piece.hIn) next.hIn = piece.hIn;
      result.push(next);
      current = next;
    });
  }
  // An open path's outer handles belong to no segment; they are carried as points.
  if (!closed) {
    if (sub[0].hIn) result[0].hIn = map.point(sub[0].hIn);
    const last = sub[sub.length - 1];
    if (last.hOut) result[result.length - 1].hOut = map.point(last.hOut);
  }
  if (sub.length === 1) {
    if (sub[0].hIn) head.hIn = map.point(sub[0].hIn);
    if (sub[0].hOut) head.hOut = map.point(sub[0].hOut);
  }
  return result;
}

/**
 * Carries one segment - a line when both handles are null - and halves it
 * until each piece's carried control points draw the image of the piece.
 * A handle that was absent stays absent at the segment's own ends.
 */
function carrySegment(
  map: MeshMap,
  p0: Vec,
  c1: Vec | null,
  c2: Vec | null,
  p3: Vec,
  tolerance: number,
  depth: number,
  out: CarriedPiece[],
): void {
  const q0 = map.point(p0);
  const q3 = map.point(p3);
  if (!c1 && !c2) {
    if (depth >= MAX_SPLITS || faithful(map, (t) => lerp(p0, p3, t), (t) => lerp(q0, q3, t), tolerance)) {
      out.push({ hOut: null, hIn: null, to: q3 });
      return;
    }
    // A line the map bends becomes a curve: the same line as a cubic, which
    // has handles to bend with.
    carrySegment(map, p0, lerp(p0, p3, 1 / 3), lerp(p0, p3, 2 / 3), p3, tolerance, depth, out);
    return;
  }
  const k1 = c1 ?? p0;
  const k2 = c2 ?? p3;
  const d1 = map.point(k1);
  const d2 = map.point(k2);
  if (
    depth >= MAX_SPLITS ||
    faithful(map, (t) => cubicAt(p0, k1, k2, p3, t), (t) => cubicAt(q0, d1, d2, q3, t), tolerance)
  ) {
    out.push({ hOut: c1 ? d1 : null, hIn: c2 ? d2 : null, to: q3 });
    return;
  }
  const half = splitCubicBezier(p0, k1, k2, p3, 0.5);
  carrySegment(map, p0, c1 ? half.left.c1 : null, half.left.c2, half.point, tolerance, depth + 1, out);
  carrySegment(map, half.point, half.right.c1, c2 ? half.right.c2 : null, p3, tolerance, depth + 1, out);
}

/** True when a carried curve stays within `tolerance` of the image of the curve it carries, at seven places along it. */
function faithful(map: MeshMap, source: (t: number) => Vec, carried: (t: number) => Vec, tolerance: number): boolean {
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const want = map.point(source(t));
    const got = carried(t);
    if (Math.hypot(want.x - got.x, want.y - got.y) > tolerance) return false;
  }
  return true;
}

function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicAt(p0: Vec, c1: Vec, c2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y,
  };
}
