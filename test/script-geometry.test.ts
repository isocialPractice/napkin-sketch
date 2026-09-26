/**
 * Napkin script geometry: the anchors the shape verbs emit, the curve
 * `through` draws, the shape library, and how a mark's points are sampled.
 *
 * The rules are the ones the drawing reference states. A circle is four
 * cubics with handles `4/3 (sqrt 2 - 1)` of the radius; an arc is pieces of
 * at most a quarter turn with handles `4/3 tan(a/4)`; a rounded corner is one
 * such arc, tangent to both edges; a curve through points has an anchor at
 * every point; and a curve is sampled to its size, the way the importer
 * samples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import {
  KAPPA,
  MAX_SEGMENT_SAMPLES,
  MIN_SEGMENT_SAMPLES,
  parsePathD,
  sampleAnchors,
  sampleOutline,
} from '../src/core/path-data.js';
import { rectOutline, roundedCornerAnchors, roundedPolygonOutline } from '../src/core/script/shapes.js';
import { throughAnchors } from '../src/core/script/through.js';
import { SHAPE_LIBRARY, SHAPE_NAMES, findShape, shapeBox } from '../src/core/script/library.js';
import { LIBRARY_ASSETS, LIBRARY_ASSET_DIR, buildShapeLibrary, formatShapeLibrary } from '../src/core/script/library-build.js';
import { Surface } from '../src/renderer/surface.js';
import type { Stroke, VectorAnchor } from '../src/core/types.js';

type P = { x: number; y: number };

const TIME = '2026-09-25T00:00:00.000Z';

function run(text: string): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME });
}

function clean(text: string): ScriptResult {
  const result = run(text);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const marks = (result: ScriptResult): Stroke[] => result.book.sketches[0].strokes;
const codes = (result: ScriptResult): string[] => result.diagnostics.map((d) => d.code);
const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);
const minus = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: P, b: P): number => a.x * b.y - a.y * b.x;
const dot = (a: P, b: P): number => a.x * b.x + a.y * b.y;

function near(actual: number, expected: number, tolerance = 1e-9, what = ''): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} is not within ${tolerance} of ${expected}`);
}

function samePoint(a: P | undefined, b: P | undefined, tolerance: number, what: string): void {
  assert.equal(a === undefined, b === undefined, `${what}: one has it and the other does not`);
  if (a && b) assert.ok(dist(a, b) <= tolerance, `${what}: (${a.x}, ${a.y}) against (${b.x}, ${b.y})`);
}

function sameAnchors(actual: readonly VectorAnchor[], expected: readonly VectorAnchor[], tolerance = 1e-9): void {
  assert.equal(actual.length, expected.length, 'anchor count');
  actual.forEach((a, k) => {
    samePoint(a.p, expected[k].p, tolerance, `anchor ${k}`);
    samePoint(a.hIn, expected[k].hIn, tolerance, `anchor ${k} hIn`);
    samePoint(a.hOut, expected[k].hOut, tolerance, `anchor ${k} hOut`);
  });
}

/** The anchors turned so that the one at `start` comes first: a closed outline has no one first anchor. */
function startingAt(anchors: readonly VectorAnchor[], start: P): VectorAnchor[] {
  const k = anchors.findIndex((a) => dist(a.p, start) < 1e-6);
  assert.ok(k >= 0, `no anchor at (${start.x}, ${start.y})`);
  return [...anchors.slice(k), ...anchors.slice(0, k)];
}

function bounds(points: readonly P[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf-8')).name === 'napkin-sketch') return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`repository root not found from ${process.cwd()}`);
}

// ---- Circles, arcs and rounded corners ------------------------------------------

test('a circle is four cubics, handles 4/3 (sqrt 2 - 1) of the radius along the tangents', () => {
  const [mark] = marks(clean('circle 100 80 40'));
  const centre = { x: 100, y: 80 };
  assert.equal(mark.vector!.anchors.length, 4);
  assert.equal(mark.vector!.closed, true);
  for (const a of mark.vector!.anchors) {
    near(dist(a.p, centre), 40);
    near(dist(a.hIn!, a.p), KAPPA * 40);
    near(dist(a.hOut!, a.p), KAPPA * 40);
    near(dot(minus(a.hOut!, a.p), minus(a.p, centre)), 0, 1e-9, 'a handle square to the radius');
  }
});

test('an arc is pieces of at most a quarter turn, and the same curve an SVG arc imports as', () => {
  const result = clean('arc 100 100 50 0 135');
  const [mark] = marks(result);
  const anchors = mark.vector!.anchors;
  assert.equal(anchors.length, 3, 'two pieces of 67.5 degrees');
  const alpha = (4 / 3) * Math.tan((67.5 * Math.PI) / 180 / 4);
  near(dist(anchors[0].hOut!, anchors[0].p), alpha * 50);
  near(dist(anchors[1].hIn!, anchors[1].p), alpha * 50);
  near(dist(anchors[2].hIn!, anchors[2].p), alpha * 50);
  const end = { x: 100 + 50 * Math.cos((135 * Math.PI) / 180), y: 100 + 50 * Math.sin((135 * Math.PI) / 180) };
  const [imported] = parsePathD(`M150 100 A50 50 0 0 1 ${end.x} ${end.y}`) ?? [];
  sameAnchors(anchors, imported.anchors);
  // Written out as SVG and read back, it is the same three anchors.
  const d = /<path[^>]* d="([^"]+)"/.exec(Surface.toSVG(result.book.sketches[0]))?.[1] ?? '';
  const [read] = parsePathD(d) ?? [];
  sameAnchors(read.anchors, anchors, 0.01);
});

test('a circle written as SVG reads back as the four anchors it was made from, to two decimals', () => {
  const result = clean('circle 100.123 80.456 40.5');
  const [mark] = marks(result);
  const d = /<path[^>]* d="([^"]+)"/.exec(Surface.toSVG(result.book.sketches[0]))?.[1] ?? '';
  const [read] = parsePathD(d) ?? [];
  assert.equal(read.closed, true);
  const twoDecimals = (p: P | undefined): P | undefined => p && { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
  const written = mark.vector!.anchors.map((a) => ({ p: twoDecimals(a.p)!, hIn: twoDecimals(a.hIn), hOut: twoDecimals(a.hOut) }));
  sameAnchors(startingAt(read.anchors, written[0].p), written, 1e-9);
});

test('the corners of a rounded rectangle are quarter arcs', () => {
  const [mark] = marks(clean('rect 0 0 200 100 r 20'));
  const anchors = mark.vector!.anchors;
  assert.equal(anchors.length, 8);
  // Each corner is one cubic from an anchor with an outgoing handle to one with an incoming handle.
  const ends = anchors.filter((a) => a.hOut);
  assert.equal(ends.length, 4);
  for (const a of anchors) {
    if (a.hOut) near(dist(a.hOut, a.p), KAPPA * 20);
    if (a.hIn) near(dist(a.hIn, a.p), KAPPA * 20);
  }
});

test('a rounded polygon: its square is the rounded rectangle, anchor for anchor', () => {
  const [polygon] = marks(clean('polygon 0 0, 200 0, 200 100, 0 100 r 20'));
  const rect = rectOutline(0, 0, 200, 100, 20).anchors;
  sameAnchors(startingAt(polygon.vector!.anchors, rect[0].p), rect);
  // With the largest radius both are the same circle.
  const circle = roundedPolygonOutline(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    500,
  );
  const round = rectOutline(0, 0, 100, 100, 50).anchors;
  sameAnchors(startingAt(circle.anchors, round[0].p), round);
});

test('a rounded corner is a fillet that touches both edges, at any angle', () => {
  const r = 10;
  // A 60 degree corner: the fillet touches each edge r / tan(30) from it and turns through 120 degrees.
  const corner = { x: 0, y: 0 };
  const prev = { x: 100, y: 0 };
  const next = { x: 50, y: 50 * Math.sqrt(3) };
  const fillet = roundedCornerAnchors(prev, corner, next, r);
  assert.equal(fillet.length, 3, '120 degrees is two pieces');
  const reach = r / Math.tan(Math.PI / 6);
  near(dist(fillet[0].p, corner), reach);
  near(dist(fillet[fillet.length - 1].p, corner), reach);
  near(cross(minus(fillet[0].p, corner), minus(prev, corner)), 0, 1e-9, 'on the edge from prev');
  near(cross(minus(fillet[2].p, corner), minus(next, corner)), 0, 1e-9, 'on the edge to next');
  // Its centre lies on the bisector, 2r from a 60 degree corner, and every anchor is r from it.
  const bisector = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
  const centre = { x: 2 * r * bisector.x, y: 2 * r * bisector.y };
  for (const a of fillet) near(dist(a.p, centre), r);
  // The fillet leaves each edge along it, so the joins are smooth.
  near(cross(minus(fillet[0].hOut!, fillet[0].p), minus(corner, prev)), 0, 1e-9, 'tangent to the first edge');
  near(cross(minus(fillet[2].p, fillet[2].hIn!), minus(next, corner)), 0, 1e-9, 'tangent to the second edge');
  // A corner the edges run straight through has nothing to round.
  assert.deepEqual(roundedCornerAnchors({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, r), [{ p: { x: 50, y: 0 } }]);
});

test('a rounded corner takes no more than half of either edge', () => {
  // A long thin triangle: the sharp corners' fillets are held to half the short edge.
  const outline = roundedPolygonOutline(
    [
      { x: 0, y: 0 },
      { x: 300, y: 10 },
      { x: 0, y: 20 },
    ],
    40,
  );
  const straight = outline.anchors.filter((a, k, all) => {
    const next = all[(k + 1) % all.length];
    return !a.hOut && !next.hIn;
  });
  // The short edge from (0, 20) to (0, 0) is used up by its two fillets, which meet in its middle.
  assert.ok(outline.anchors.some((a) => dist(a.p, { x: 0, y: 10 }) < 1e-9 && a.hIn && a.hOut));
  assert.ok(straight.length <= 2);
  for (const a of outline.anchors) {
    assert.ok(a.p.x >= -1e-9 && a.p.x <= 300 && a.p.y >= -1e-9 && a.p.y <= 20 + 1e-9, 'inside the triangle');
  }
});

test('polygon r: 0 is sharp, repeated points are dropped, and the radius must not be negative', () => {
  assert.equal(marks(clean('polygon 0 0, 10 0, 10 10 r 0'))[0].vector!.anchors.length, 3);
  const [triangle] = marks(clean('polygon 0 0, 100 0, 100 0, 100 100, 0 0 r 10'));
  assert.equal(triangle.vector!.anchors.filter((a) => a.hOut && !a.hIn).length, 3, 'three corners, three fillets');
  assert.deepEqual(codes(run('polygon 0 0, 10 0, 10 10 r -2')), ['invalid-value']);
});

// ---- A curve through points -----------------------------------------------------

const WAVE: P[] = [
  { x: 0, y: 0 },
  { x: 50, y: -40 },
  { x: 120, y: 10 },
  { x: 200, y: -30 },
  { x: 260, y: 0 },
];

test('through has an anchor at every point, and runs along the line from the point before to the point after', () => {
  const anchors = throughAnchors(WAVE);
  assert.deepEqual(
    anchors.map((a) => a.p),
    WAVE,
  );
  for (let i = 1; i < WAVE.length - 1; i++) {
    const a = anchors[i];
    const across = minus(WAVE[i + 1], WAVE[i - 1]);
    near(cross(minus(a.hOut!, a.p), across), 0, 1e-9, `anchor ${i} out`);
    near(cross(minus(a.p, a.hIn!), across), 0, 1e-9, `anchor ${i} in`);
    assert.ok(dot(minus(a.hOut!, a.p), across) > 0, 'forwards');
    near(dist(a.hOut!, a.p), dist(WAVE[i], WAVE[i + 1]) / 3, 1e-9, 'a third of the segment ahead');
    near(dist(a.hIn!, a.p), dist(WAVE[i - 1], WAVE[i]) / 3, 1e-9, 'a third of the segment behind');
  }
  // The script verb draws the same anchors.
  const [mark] = marks(clean('through 0 0, 50 -40, 120 10, 200 -30, 260 0'));
  sameAnchors(mark.vector!.anchors, anchors);
  assert.equal(mark.vector!.closed, undefined);
});

test('through ends each end with the parabola that meets its neighbour', () => {
  const anchors = throughAnchors(WAVE);
  const parabola = (end: P, near: P, handle: P): P => {
    const q = { x: near.x + 1.5 * (handle.x - near.x), y: near.y + 1.5 * (handle.y - near.y) };
    return { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) };
  };
  samePoint(anchors[0].hOut, parabola(WAVE[0], WAVE[1], anchors[1].hIn!), 1e-9, 'first');
  const n = WAVE.length;
  samePoint(anchors[n - 1].hIn, parabola(WAVE[n - 1], WAVE[n - 2], anchors[n - 2].hOut!), 1e-9, 'last');
  assert.equal(anchors[0].hIn, undefined);
  assert.equal(anchors[n - 1].hOut, undefined);
});

test('through with two points is a straight line, and spaced unevenly it does not loop', () => {
  assert.deepEqual(throughAnchors([{ x: 0, y: 0 }, { x: 10, y: 5 }]), [{ p: { x: 0, y: 0 } }, { p: { x: 10, y: 5 } }]);
  // Points on a line, one gap a hundred times another: the curve stays on the line and never turns back.
  const anchors = throughAnchors([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 100, y: 0 },
    { x: 101, y: 0 },
  ]);
  const points = sampleAnchors(anchors, false);
  for (let k = 1; k < points.length; k++) {
    near(points[k].y, 0, 1e-9, 'on the line');
    assert.ok(points[k].x >= points[k - 1].x - 1e-9, `turns back at sample ${k}`);
  }
  assert.deepEqual(codes(run('through 5 5, 5 5')), ['invalid-value'], 'one point twice draws nothing');
});

test('inside a path, through carries on from a curve, and smooth carries on from through', () => {
  const [mark] = marks(clean('path {\n  move 0 100\n  curve 20 40 80 40 100 100\n  through 150 140, 200 100\n  smooth 280 40 300 100\n}'));
  const anchors = mark.vector!.anchors;
  assert.deepEqual(
    anchors.map((a) => [a.p.x, a.p.y]),
    [
      [0, 100],
      [100, 100],
      [150, 140],
      [200, 100],
      [300, 100],
    ],
  );
  const join = anchors[1];
  near(cross(minus(join.hOut!, join.p), minus(join.p, join.hIn!)), 0, 1e-9, 'the curve goes on smoothly');
  assert.ok(dot(minus(join.hOut!, join.p), minus(join.p, join.hIn!)) > 0);
  const end = anchors[3];
  samePoint(end.hOut, { x: 2 * end.p.x - end.hIn!.x, y: 2 * end.p.y - end.hIn!.y }, 1e-9, 'smooth mirrors the handle through left');
  // Without a curve before it, through starts from the current point.
  const [plain] = marks(clean('path {\n  move 0 0\n  through 50 40, 100 0\n}'));
  sameAnchors(plain.vector!.anchors, throughAnchors([{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }]));
  assert.deepEqual(codes(run('path {\n  through 50 40, 100 0\n}')), ['invalid-value'], 'a path starts with move');
});

// ---- The shape library ------------------------------------------------------------

test('the committed shape library is what its assets read as', () => {
  const root = repoRoot();
  const sources = LIBRARY_ASSETS.map((file) => ({ file, text: readFileSync(join(root, LIBRARY_ASSET_DIR, file), 'utf-8') }));
  const committed = readFileSync(join(root, 'src', 'core', 'script', 'shape-library.json'), 'utf-8').replace(/\r\n/g, '\n');
  assert.equal(formatShapeLibrary(buildShapeLibrary(sources)), committed, 'run `npm run shape-library` and commit the result');
  assert.equal(SHAPE_NAMES.length, 22);
  for (const name of ['square', 'hexagon', 'vertical', '45-degree', 'arc', 'spiral', 'cube-isometric', 'cylinder-perspective']) {
    assert.ok(SHAPE_NAMES.includes(name), name);
  }
});

test('every library shape fits its box, its longer side the size given', () => {
  for (const shape of SHAPE_LIBRARY.shapes) {
    const result = clean(`fill white\nshape "${shape.name}" at 10 20 size 100`);
    const box = shapeBox(shape, 100);
    const b = bounds(marks(result).flatMap((m) => m.points));
    near(b.minX, 10, 0.5, `${shape.name} left`);
    near(b.minY, 20, 0.5, `${shape.name} top`);
    near(b.maxX, 10 + box.width, 0.5, `${shape.name} right`);
    near(b.maxY, 20 + box.height, 0.5, `${shape.name} bottom`);
    near(Math.max(box.width, box.height), 100, 1e-9, shape.name);
  }
  // A height stretches it: the circle becomes an ellipse.
  const b = bounds(marks(clean('shape "circle" at 0 0 size 200 100'))[0].points);
  assert.deepEqual([Math.round(b.maxX), Math.round(b.maxY)], [200, 100]);
  // A line has no height, and sits in the middle of the box it is given.
  const [line] = marks(clean('shape "horizontal" at 0 0 size 100 40'));
  assert.deepEqual(line.vector!.anchors.map((a) => [a.p.x, a.p.y]), [
    [0, 20],
    [100, 20],
  ]);
});

test('a library part shows only what the asset showed, in the current paint', () => {
  // The wheel's backdrop is filled and not outlined, its rim outlined and not filled.
  const bare = marks(clean('shape "wheel-isometric" at 0 0 size 100'));
  assert.equal(bare.length, 2, 'with nothing filled the backdrop shows nothing, and is left out');
  const filled = marks(clean('color navy\nfill white\nshape "wheel-isometric" at 0 0 size 100'));
  assert.equal(filled.length, 3);
  const [backdrop, face, rim] = filled;
  assert.deepEqual([backdrop.fill, backdrop.noStroke], ['white', true]);
  assert.deepEqual([face.fill, face.noStroke, face.color], ['white', undefined, 'navy']);
  assert.deepEqual([rim.fill, rim.noStroke], [undefined, undefined]);
  // Lines are open, so they are never filled.
  const lines = marks(clean('fill white\nshape "cube-isometric" at 0 0 size 100')).filter((m) => !m.vector!.closed);
  assert.equal(lines.length, 5);
  assert.ok(lines.every((m) => m.fill === undefined));
});

test('shape names are read in any case, and a name the library lacks is reported with a guess', () => {
  assert.equal(findShape(' Cube-Isometric ')?.name, 'cube-isometric');
  assert.equal(marks(clean('shape "STAR" at 0 0 size 50')).length, 1);
  const message = (text: string): string => run(text).diagnostics[0].message;
  assert.deepEqual(codes(run('shape "cube" at 0 0 size 50')), ['unknown-shape']);
  assert.match(message('shape "cube" at 0 0 size 50'), /Did you mean `cube-isometric` or `cube-perspective`\?/);
  assert.match(message('shape "sqare" at 0 0 size 50'), /Did you mean `square`\?/);
  assert.doesNotMatch(message('shape "teapot" at 0 0 size 50'), /Did you mean/);
  assert.deepEqual(codes(run('shape "star" at 0 0 size 0')), ['invalid-value']);
});

test('the library reader works out paint as a browser would, and refuses what it cannot read', () => {
  const svg = (body: string, style = ''): { file: string; text: string } => ({
    file: 'test.svg',
    text: `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><defs><style>${style}</style></defs>${body}</svg>`,
  });
  const [group, circle] = buildShapeLibrary([
    svg(
      '<g id="Pair" stroke="#000"><rect class="a" width="10" height="10"/><rect x="20" width="10" height="10" style="stroke:none"/></g><circle id="_2-dot" r="5" fill="red"/>',
      '.a{fill:none}',
    ),
  ]).shapes;
  assert.deepEqual(
    group.parts.map((p) => [p.fill, p.stroke]),
    [
      [false, true],
      [true, false],
    ],
    'a class rule beats an inherited stroke, and a style attribute beats both',
  );
  assert.deepEqual([group.name, group.width, group.height], ['pair', 30, 10]);
  assert.deepEqual([circle.name, circle.parts[0].fill, circle.parts[0].stroke], ['2-dot', true, false]);
  const refuses = (body: string, pattern: RegExp, style = ''): void =>
    assert.throws(() => buildShapeLibrary([svg(body, style)]), pattern, body);
  refuses('<rect id="a" width="10" height="10" transform="rotate(10)"/>', /transform/);
  refuses('<g id="a"><text>Acme</text></g>', /<text> is not something the shape library reads/);
  refuses('<rect width="10" height="10"/>', /needs an id/);
  refuses('<rect id="a" width="10" height="10"/><rect id="A" width="10" height="10"/>', /already has a shape named "a"/);
  refuses('<rect id="a" width="10" height="10"/>', /not a class/, 'rect{fill:red}');
});

// ---- Sampling ------------------------------------------------------------------------

test('a curve is sampled to its size, and a straight segment to its end', () => {
  const curve = (size: number): VectorAnchor[] => [
    { p: { x: 0, y: 0 }, hOut: { x: 0, y: -size } },
    { p: { x: size, y: 0 }, hIn: { x: size, y: -size } },
  ];
  assert.equal(sampleAnchors(curve(1), false).length, 1 + MIN_SEGMENT_SAMPLES, 'a small curve still rounds');
  assert.equal(sampleAnchors(curve(500), false).length, 1 + MAX_SEGMENT_SAMPLES, "no finer than the Vector Path tool's own");
  assert.equal(sampleAnchors(curve(6), false).length, 1 + 18, 'in between, one sample a pixel of its hull');
  assert.equal(sampleAnchors([{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], false).length, 2);
  // A circle of radius 10 comes to 73 points, which the budget is counted in.
  assert.equal(marks(clean('circle 0 0 10'))[0].points.length, 73);
});

test('a compound mark is sampled subpath by subpath, each closing on itself', () => {
  const [ring] = marks(clean('path "M0 0 H100 V100 H0 Z M25 25 V75 H75 V25 Z"'));
  const points = ring.points;
  const second = points.findIndex((p) => p.move);
  assert.ok(second > 0, 'the second subpath starts with the pen lifted');
  assert.deepEqual(points.slice(0, second).map((p) => [p.x, p.y]), [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
  ]);
  assert.deepEqual(points.slice(second).map((p) => [p.x, p.y]), [
    [25, 25],
    [25, 75],
    [75, 75],
    [75, 25],
    [25, 25],
  ]);
  assert.ok(points.every((p) => p.pressure === 0.5));
  assert.deepEqual(sampleOutline(ring.vector!.anchors, true), points);
});

test('the importer samples its marks with the same sampler', () => {
  const importer = readFileSync(join(repoRoot(), 'src', 'renderer', 'svg-import.ts'), 'utf-8');
  assert.match(importer, /import \{[^}]*\bsampleAnchors\b[^}]*\} from '\.\.\/core\/path-data\.js'/);
  assert.match(importer, /import \{[^}]*\belementSubpaths\b[^}]*\} from '\.\.\/core\/path-data\.js'/);
  assert.doesNotMatch(importer, /function sampleAnchors|function shapeSubpaths/);
});
