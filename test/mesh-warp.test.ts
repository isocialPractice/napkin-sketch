/**
 * Mesh Warp tests: the mesh a mask makes, the as-rigid-as-possible solve, and
 * the map that carries art onto the deformed mesh.
 *
 * The claims are the ones the tool rests on. The mesh keeps to the art - two
 * contours for a ring, no triangle across a notch - and its triangulation is
 * Delaunay. Pins that have not moved leave the mesh exactly where it was, one
 * pin drags its piece rigidly, and a bend keeps the triangles' edges their
 * length. And a map nobody has pulled gives back the very anchors it was
 * handed, while a bent one carries every curve to within a quarter of a pixel
 * of where its points went.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArapSolver,
  MeshLocator,
  MeshMap,
  autoPins,
  buildMesh,
  delaunay,
  mapStrokeGeometry,
  pinRest,
  traceMask,
  type Mask,
  type Mesh,
  type Vec,
  type WarpPin,
} from '../src/core/mesh-warp.js';
import type { Stroke, VectorAnchor } from '../src/core/types.js';

/** A mask from a predicate over sketch coordinates, `scale` mask pixels to the sketch pixel. */
function maskOf(width: number, height: number, inside: (x: number, y: number) => boolean, scale = 1): Mask {
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const data = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) data[j * w + i] = inside((i + 0.5) / scale, (j + 0.5) / scale) ? 1 : 0;
  }
  return { width: w, height: h, data, originX: 0, originY: 0, scale };
}

function signedArea(loop: Vec[]): number {
  let sum = 0;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  });
  return sum / 2;
}

/** A seeded pseudo-random source, so a failure can be run again. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- W1: the mesh -------------------------------------------------------------------

test('a square with a square hole traces as two contours wound opposite ways', () => {
  const mask = maskOf(40, 40, (x, y) => {
    const outer = x > 5 && x < 35 && y > 5 && y < 35;
    const hole = x > 15 && x < 25 && y > 15 && y < 25;
    return outer && !hole;
  });
  const loops = traceMask(mask);
  assert.equal(loops.length, 2);
  const areas = loops.map(signedArea).sort((a, b) => b - a);
  assert.ok(areas[0] > 0 && areas[1] < 0, `outer clockwise, hole the other way: ${areas.join(', ')}`);
  // Traced along the pixels' edges, the corners cut by half a pixel's
  // diagonal: the 30 px square less its corners, the 10 px hole likewise.
  assert.ok(Math.abs(areas[0] - 900) < 1, `outer area ${areas[0]}`);
  assert.ok(Math.abs(-areas[1] - 100) < 1, `hole area ${areas[1]}`);
});

function hullSize(points: Vec[]): number {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.length + upper.length - 2;
}

test('200 random points triangulate with every circumcircle empty, 2n - 2 - h of them', () => {
  const next = random(7);
  const points: Vec[] = Array.from({ length: 200 }, () => ({ x: next() * 500, y: next() * 300 }));
  const tri = delaunay(points);
  const n = points.length;
  assert.equal(tri.length / 3, 2 * n - 2 - hullSize(points));
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [points[tri[t]], points[tri[t + 1]], points[tri[t + 2]]];
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const ux =
      ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
    const uy =
      ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
    const r = Math.hypot(a.x - ux, a.y - uy);
    points.forEach((p, i) => {
      if (i === tri[t] || i === tri[t + 1] || i === tri[t + 2]) return;
      assert.ok(Math.hypot(p.x - ux, p.y - uy) >= r - 1e-7, `point ${i} inside the circle of triangle ${t / 3}`);
    });
  }
});

/** Rest position of a mesh vertex. */
const at = (mesh: Mesh, v: number): Vec => ({ x: mesh.rest[2 * v], y: mesh.rest[2 * v + 1] });

test('an L-shaped mask keeps no triangle across its notch', () => {
  // A 100 px square missing its top-right 60 px: the notch is x > 40, y < 60.
  const mask = maskOf(120, 120, (x, y) => x > 10 && x < 110 && y > 10 && y < 110 && !(x > 50 && y < 70));
  const mesh = buildMesh(mask)!;
  assert.ok(mesh, 'a mesh');
  // Well inside the notch - clear of the 3 px margin and a pixel of slack -
  // no triangle has its middle or the middle of an edge.
  const inNotch = (p: Vec): boolean => p.x > 50 + 5 && p.y < 70 - 5 && p.y > 10 - 1;
  let area = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => at(mesh, mesh.triangles[t + k]));
    for (const p of [
      { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 },
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
      { x: (c.x + a.x) / 2, y: (c.y + a.y) / 2 },
    ]) {
      assert.ok(!inNotch(p), `triangle ${t / 3} reaches into the notch at ${p.x}, ${p.y}`);
    }
    area += ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  // Every triangle clockwise on screen, and between them they cover the L.
  assert.ok(area > 0);
  const lArea = 100 * 100 - 60 * 60;
  assert.ok(area > lArea * 0.97 && area < lArea * 1.35, `mesh area ${area} for an L of ${lArea}`);
  assert.equal(mesh.components, 1);
});

test('a mesh stays near a thousand vertices whatever the size of the art', () => {
  for (const size of [100, 400, 1600]) {
    const scale = 400 / size;
    const mask = maskOf(size + 20, size + 20, (x, y) => Math.hypot(x - size / 2 - 10, y - size / 2 - 10) < size / 2, scale);
    const mesh = buildMesh(mask)!;
    assert.ok(mesh.count > 400 && mesh.count < 2200, `${mesh.count} vertices for a ${size} px disc`);
  }
});

test('every separate piece of the art gets a pin, and the biggest gets two', () => {
  const mask = maskOf(200, 60, (x, y) => (x > 10 && x < 130 && y > 20 && y < 40) || Math.hypot(x - 170, y - 30) < 12);
  const mesh = buildMesh(mask)!;
  assert.equal(mesh.components, 2);
  const pins = autoPins(mesh);
  assert.equal(pins.length, 3);
  // The bar's two lie along it, a fifth of the way in from each end.
  const bar = pins.filter((p) => p.x < 140).sort((a, b) => a.x - b.x);
  assert.equal(bar.length, 2);
  assert.ok(Math.abs(bar[0].x - (7 + 126 * 0.2)) < 8 && Math.abs(bar[1].x - (7 + 126 * 0.8)) < 8, JSON.stringify(bar));
});

// ---- W2: the solve ------------------------------------------------------------------

/** A horizontal bar's mesh, with its two automatic pins placed. */
function bar(): { mesh: Mesh; locator: MeshLocator; pins: WarpPin[]; rest: Vec[] } {
  const mask = maskOf(260, 80, (x, y) => x > 30 && x < 230 && y > 25 && y < 55);
  const mesh = buildMesh(mask)!;
  const locator = new MeshLocator(mesh);
  const rest = autoPins(mesh).sort((a, b) => a.x - b.x);
  const pins = rest.map((p) => {
    const spot = locator.locate(p);
    return { triangle: spot.triangle, weights: spot.weights };
  });
  return { mesh, locator, pins, rest: pins.map((p) => pinRest(mesh, p)) };
}

test('pins where they started give back the rest mesh, to 1e-9', () => {
  const { mesh, pins, rest } = bar();
  const solver = new ArapSolver(mesh);
  solver.setPins(pins);
  const out = solver.solve(rest);
  let worst = 0;
  for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - mesh.rest[i]));
  assert.ok(worst <= 1e-9, `moved ${worst}`);
});

test('a single pin drags its piece rigidly', () => {
  const { mesh, pins, rest } = bar();
  const solver = new ArapSolver(mesh);
  solver.setPins([pins[1]]);
  const out = solver.solve([{ x: rest[1].x + 30, y: rest[1].y - 20 }]);
  for (let v = 0; v < mesh.count; v++) {
    assert.ok(Math.abs(out[2 * v] - mesh.rest[2 * v] - 30) < 1e-9);
    assert.ok(Math.abs(out[2 * v + 1] - mesh.rest[2 * v + 1] + 20) < 1e-9);
  }
});

/** The longest an edge grew or shrank, as a fraction of its rest length. */
function worstStretch(mesh: Mesh, out: Float64Array): number {
  let worst = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.triangles[t + k];
      const b = mesh.triangles[t + ((k + 1) % 3)];
      const before = Math.hypot(mesh.rest[2 * b] - mesh.rest[2 * a], mesh.rest[2 * b + 1] - mesh.rest[2 * a + 1]);
      const after = Math.hypot(out[2 * b] - out[2 * a], out[2 * b + 1] - out[2 * a + 1]);
      worst = Math.max(worst, Math.abs(after - before) / before);
    }
  }
  return worst;
}

test('a bar held by one pin, its other pin swung a quarter turn about it, keeps its edges within 5%', () => {
  const { mesh, pins, rest } = bar();
  const solver = new ArapSolver(mesh);
  solver.setPins(pins);
  const [hold, swing] = rest;
  const swung = { x: hold.x - (swing.y - hold.y), y: hold.y + (swing.x - hold.x) };
  const out = solver.solve([hold, swung]);
  const stretch = worstStretch(mesh, out);
  assert.ok(stretch < 0.05, `an edge changed by ${(stretch * 100).toFixed(1)}%`);
  // It really turned: the far end of the bar now hangs below the held pin.
  let far = 0;
  for (let v = 1; v < mesh.count; v++) if (mesh.rest[2 * v] > mesh.rest[2 * far]) far = v;
  assert.ok(out[2 * far + 1] > hold.y + 100, `far end at ${out[2 * far]}, ${out[2 * far + 1]}`);
});

// ---- W3: carrying the art -------------------------------------------------------------

const ANCHORS: VectorAnchor[] = [
  { p: { x: 40, y: 40 }, hOut: { x: 70, y: 30 } },
  { p: { x: 120, y: 45 }, hIn: { x: 95, y: 52 }, hOut: { x: 145, y: 38 } },
  { p: { x: 220, y: 40 } },
  { p: { x: 60, y: 48 }, move: true },
  { p: { x: 200, y: 50 }, hIn: { x: 150, y: 60 } },
];

function vectorStroke(anchors: VectorAnchor[], closed = false): Stroke {
  return {
    id: 'v',
    tool: 'pen',
    color: '#000',
    width: 2,
    points: anchors.map((a) => ({ x: a.p.x, y: a.p.y, pressure: 0.5 })),
    vector: { anchors: structuredClone(anchors), ...(closed ? { closed: true } : {}) },
  };
}

test('a map nobody has pulled gives back the very anchors it was handed', () => {
  const { mesh, locator } = bar();
  const map = new MeshMap(mesh, locator, Float64Array.from(mesh.rest));
  for (const closed of [false, true]) {
    const stroke = vectorStroke(ANCHORS, closed);
    const warped = mapStrokeGeometry(stroke, map);
    assert.deepStrictEqual(warped.vector?.anchors, stroke.vector!.anchors);
  }
  const freehand: Stroke = {
    id: 'f',
    tool: 'pen',
    color: '#000',
    width: 2,
    points: [
      { x: 50, y: 40, pressure: 0.3 },
      { x: 90, y: 42, pressure: 0.6, move: true },
      { x: 400, y: 400, pressure: 0.5 },
    ],
  };
  assert.deepStrictEqual(mapStrokeGeometry(freehand, map).points, freehand.points);
});

/** Points along a path of anchors, `per` to each segment. */
function sampleAnchors(anchors: VectorAnchor[], closed: boolean, per: number): Vec[] {
  const out: Vec[] = [];
  let start = 0;
  const cubic = (a: Vec, b: Vec, c: Vec, d: Vec, t: number): Vec => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  };
  const segment = (from: VectorAnchor, to: VectorAnchor): void => {
    for (let k = 0; k <= per; k++) out.push(cubic(from.p, from.hOut ?? from.p, to.hIn ?? to.p, to.p, k / per));
  };
  for (let i = 1; i <= anchors.length; i++) {
    if (i === anchors.length || anchors[i].move) {
      for (let k = start + 1; k < i; k++) segment(anchors[k - 1], anchors[k]);
      if (closed && i - start > 1) segment(anchors[i - 1], anchors[start]);
      start = i;
    }
  }
  return out;
}

function distanceToPolyline(p: Vec, line: Vec[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}

test('under a bent map, every carried curve stays within a quarter pixel of where its points went', () => {
  const { mesh, locator, pins, rest } = bar();
  const solver = new ArapSolver(mesh);
  solver.setPins(pins);
  const [hold, swing] = rest;
  const deformed = solver.solve([hold, { x: swing.x - 20, y: swing.y + 70 }]);
  const map = new MeshMap(mesh, locator, deformed);
  for (const closed of [false, true]) {
    const stroke = vectorStroke(ANCHORS, closed);
    const warped = mapStrokeGeometry(stroke, map);
    // The image of each curve, point by point, finely; and the carried curve.
    const image = sampleAnchors(stroke.vector!.anchors, closed, 512).map((p) => map.point(p));
    const carried = sampleAnchors(warped.vector!.anchors, closed, 64);
    let worst = 0;
    for (const p of carried) worst = Math.max(worst, distanceToPolyline(p, image));
    assert.ok(worst <= 0.25, `${closed ? 'closed' : 'open'}: strays ${worst.toFixed(3)} px`);
    // It had to split some segment to manage it: the bend is real.
    assert.ok(warped.vector!.anchors.length > ANCHORS.length, `${warped.vector!.anchors.length} anchors`);
    // And the points are sampled afresh from the carried anchors.
    assert.ok(warped.points.length > warped.vector!.anchors.length);
  }
});

test('text moves with its anchor, and a Copic nib turns with the mesh', () => {
  const { mesh, locator, pins, rest } = bar();
  const solver = new ArapSolver(mesh);
  solver.setPins(pins);
  // Both pins turned a quarter turn about the bar's middle: a rigid rotation.
  const mid = { x: (rest[0].x + rest[1].x) / 2, y: (rest[0].y + rest[1].y) / 2 };
  const turn = (p: Vec): Vec => ({ x: mid.x - (p.y - mid.y), y: mid.y + (p.x - mid.x) });
  const deformed = solver.solve(rest.map(turn));
  const map = new MeshMap(mesh, locator, deformed);

  const text: Stroke = {
    id: 't',
    tool: 'text',
    color: '#000',
    width: 1,
    text: 'hi',
    points: [
      { x: 100, y: 40 },
      { x: 140, y: 52 },
    ],
  };
  const moved = mapStrokeGeometry(text, map).points;
  const anchor = turn({ x: 100, y: 40 });
  assert.ok(Math.hypot(moved[0].x - anchor.x, moved[0].y - anchor.y) < 1, JSON.stringify(moved[0]));
  // Not bent: the box keeps its shape, only moved.
  assert.ok(Math.abs(moved[1].x - moved[0].x - 40) < 1e-9 && Math.abs(moved[1].y - moved[0].y - 12) < 1e-9);

  const copic: Stroke = {
    id: 'c',
    tool: 'copic',
    color: '#000',
    width: 8,
    nibAngle: 30,
    points: [
      { x: 100, y: 40 },
      { x: 160, y: 42 },
    ],
  };
  const nib = mapStrokeGeometry(copic, map).nibAngle!;
  assert.ok(Math.abs(nib - 120) < 1, `nib at ${nib}`);
});

// ---- The store side of a warp ------------------------------------------------------------

test('a warp writes each frame in one go, and a kept warp is one undo step', async () => {
  const { Store } = await import('../src/renderer/store.js');
  const { createLayer, createSketchBook } = await import('../src/core/types.js');
  const book = createSketchBook('warp');
  const sketch = book.sketches[0];
  sketch.layers = [
    { ...createLayer('a'), id: 'la' },
    { ...createLayer('b'), id: 'lb' },
  ];
  const curve = vectorStroke(ANCHORS.slice(0, 3));
  sketch.strokes = [
    { ...curve, id: 'v', layer: 'la' },
    {
      id: 'c',
      tool: 'copic',
      color: '#000',
      width: 6,
      nibAngle: 30,
      layer: 'lb',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
  ];
  const store = new Store(book);
  const before = structuredClone(store.sketch.strokes);
  let changes = 0;
  store.subscribe(() => changes++);

  store.beginTransaction();
  const frame = (dy: number): void =>
    store.setStrokesGeometry([
      { id: 'v', points: [{ x: 0, y: dy }, { x: 5, y: dy }] },
      { id: 'c', points: [{ x: 0, y: dy }, { x: 10, y: dy }], nibAngle: 30 + dy },
    ]);
  frame(3);
  assert.equal(changes, 1, 'one change for the whole frame');
  frame(6);
  // A stroke given no anchors loses the ones it had; a nib turns.
  assert.equal(store.sketch.strokes[0].vector, undefined);
  assert.equal(store.sketch.strokes[1].nibAngle, 36);
  store.commitTransaction();
  // Two frames, one step.
  store.undo();
  assert.deepStrictEqual(store.sketch.strokes, before);
});
