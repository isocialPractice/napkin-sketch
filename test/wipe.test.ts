/**
 * The wipe engine (src/core/wipe.ts): the Wipe Stacks' six operations on
 * the selected marks - Wipe In (unite), Subtract Top from Below (minus
 * front), Subtract Below from Top (minus back), Mid Wipe (intersect), Outer
 * Wipes (exclude) and Clean Wipe (divide) - their paint rules, and the faces
 * of an arrangement the Shape Stacker will stand on. Areas are held exactly;
 * anchors a wipe never reached are held to the last digit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  arrangeFaces,
  faceAt,
  facesAlong,
  facesInBox,
  isWipeable,
  stackArrangement,
  stackEdit,
  stackFaces,
  wipeMarks,
  wipeOperand,
  WIPE_OPERAND_LIMIT,
  WIPE_OPS,
  type WipeResult,
} from '../src/core/wipe.js';
import { disc, signedArea } from '../src/core/graphic-design/geometry.js';
import { createSketch, type Point, type Sketch, type Stroke, type VectorAnchor } from '../src/core/types.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';

type Vec = { x: number; y: number };

const RED = '#d0342c';
const BLUE = '#27486d';
const GREEN = '#2e7d5b';

const corners = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const pts = (list: Vec[]): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 }));

/** A filled square of points, closed on its first corner. */
function square(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<Stroke> = {}): Stroke {
  const c = corners(x0, y0, x1, y1);
  return { id, tool: 'pen', color: '#1f2328', width: 2, fill: RED, points: pts([...c, c[0]]), ...extra };
}

/** A filled disc of a polygon's points. */
function round(id: string, cx: number, cy: number, r: number, fill: string): Stroke {
  const ring = disc({ x: cx, y: cy }, r, 96);
  return { id, tool: 'pen', color: '#1f2328', width: 2, fill, points: pts([...ring, ring[0]]) };
}

/** A sketch of these marks, each on a layer of its own, the first at the bottom. */
function sketchOf(...strokes: Stroke[]): Sketch {
  const sketch = createSketch('wipes');
  sketch.layers = strokes.map((s, i) => ({ id: `ly_${s.id}`, name: `Layer ${i + 1}`, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes.map((s) => ({ ...s, layer: `ly_${s.id}` }));
  return sketch;
}

/** The area a mark's points fill, each subpath a contour, a hole's taking away. */
function filledArea(points: Point[]): number {
  const rings: Vec[][] = [];
  for (const p of points) {
    if (p.move || rings.length === 0) rings.push([]);
    rings[rings.length - 1].push(p);
  }
  return Math.abs(rings.reduce((sum, r) => sum + signedArea(r), 0)) / 2;
}

/** Every mark a wipe leaves, in its place or added. */
const leftBy = (r: WipeResult): Stroke[] => [...r.changed.values(), ...r.added.map((a) => a.stroke)];
const subpaths = (s: Stroke): number => s.vector!.anchors.filter((a) => a.move).length + 1;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

test('the six operations, as the note names them', () => {
  assert.deepEqual([...WIPE_OPS], ['in', 'out-front', 'out-back', 'mid', 'outer', 'clean']);
});

test('what each kind of mark is to a wipe: a shape its inside, a line its ink, text nothing', () => {
  const filled = wipeOperand(square('a', 0, 0, 10, 10));
  assert.equal(filled?.kind, 'shape');
  const outline = wipeOperand(square('b', 0, 0, 10, 10, { fill: undefined }));
  assert.equal(outline?.kind, 'shape', 'a closed outline with no fill is its inside');
  const line = wipeOperand({ id: 'l', tool: 'pen', color: BLUE, width: 6, points: pts([{ x: 0, y: 0 }, { x: 50, y: 0 }]) });
  assert.equal(line?.kind, 'ink', 'an open line is its painted ink');
  assert.equal(wipeOperand({ id: 't', tool: 'text', color: BLUE, width: 1, text: 'Hi', points: [{ x: 0, y: 0 }] }), null);
});

test('what the menus count as a shape to wipe: every mark but text, pictures, placed files and eraser marks', () => {
  // The fewer-than-two-shapes predicate counts these on every menu refresh, so it asks the cheap question.
  const line: Stroke = { id: 'l', tool: 'pen', color: BLUE, width: 6, points: pts([{ x: 0, y: 0 }, { x: 50, y: 0 }]) };
  assert.equal(isWipeable(square('a', 0, 0, 10, 10)), true);
  assert.equal(isWipeable(line), true);
  assert.equal(isWipeable({ ...line, tool: 'copic' }), true);
  assert.equal(isWipeable({ ...line, tool: 'eraser' }), false);
  assert.equal(isWipeable({ id: 't', tool: 'text', color: BLUE, width: 1, text: 'Hi', points: [{ x: 0, y: 0 }] }), false);
  assert.equal(isWipeable({ ...line, points: [] }), false, 'a mark with no points');
  for (const stroke of [square('a', 0, 0, 10, 10), line, { ...line, tool: 'eraser' as const }]) {
    assert.equal(isWipeable(stroke), wipeOperand(stroke) !== null, `${stroke.tool}: the cheap answer is the operand's`);
  }
});

// Two squares: A (bottom, red) 0..100, B (top, blue) 50..150.
const pair = () => sketchOf(square('a', 0, 0, 100, 100, { fill: RED }), square('b', 50, 50, 150, 150, { fill: BLUE }));

test('Wipe In: one shape of the union, in the top one\'s paint, in its place', () => {
  const r = wipeMarks(pair(), ['a', 'b'], 'in');
  assert.equal(r.problem, null);
  assert.deepEqual([...r.removed], ['a']);
  assert.equal(r.added.length, 0);
  const b = r.changed.get('b')!;
  assert.equal(b.fill, BLUE);
  assert.ok(near(filledArea(b.points), 17500), `${filledArea(b.points)}`);
  assert.equal(b.vector!.anchors.length, 8, 'eight corners');
  assert.ok(b.vector!.anchors.every((a) => !a.hIn && !a.hOut), 'straight edges stay lines');
});

test('Subtract Top from Below: the bottom shape less the top, in the bottom one\'s paint', () => {
  const r = wipeMarks(pair(), ['a', 'b'], 'out-front');
  assert.deepEqual([...r.removed], ['b']);
  const a = r.changed.get('a')!;
  assert.equal(a.fill, RED);
  assert.ok(near(filledArea(a.points), 7500), `${filledArea(a.points)}`);
  assert.equal(a.vector!.anchors.length, 6, 'an L of six corners');
});

test('Subtract Below from Top: the top shape less the bottom, in the top one\'s paint', () => {
  const r = wipeMarks(pair(), ['a', 'b'], 'out-back');
  assert.deepEqual([...r.removed], ['a']);
  const b = r.changed.get('b')!;
  assert.equal(b.fill, BLUE);
  assert.ok(near(filledArea(b.points), 7500), `${filledArea(b.points)}`);
});

test('Mid Wipe: where they overlap, in the top one\'s paint', () => {
  const r = wipeMarks(pair(), ['a', 'b'], 'mid');
  const b = r.changed.get('b')!;
  assert.equal(b.fill, BLUE);
  assert.ok(near(filledArea(b.points), 2500), `${filledArea(b.points)}`);
  assert.equal(b.vector!.anchors.length, 4);
});

test('Outer Wipes: where they do not overlap', () => {
  const r = wipeMarks(pair(), ['a', 'b'], 'outer');
  const b = r.changed.get('b')!;
  assert.equal(b.fill, BLUE);
  assert.ok(near(filledArea(b.points), 15000), `${filledArea(b.points)}`);
});

test('Clean Wipe: three faces, each in the paint of the top one covering it', () => {
  const sketch = pair();
  const r = wipeMarks(sketch, ['a', 'b'], 'clean');
  assert.equal(r.removed.size, 0, 'each square is on top of a face, so both stay');
  const marks = leftBy(r);
  assert.equal(marks.length, 3);
  const areas = marks.map((m) => Math.round(filledArea(m.points))).sort((x, y) => x - y);
  assert.deepEqual(areas, [2500, 7500, 7500]);
  assert.equal(r.changed.get('a')!.fill, RED, 'the bottom square keeps the face only it covers');
  const blue = marks.filter((m) => m.fill === BLUE);
  assert.equal(blue.length, 2, 'the overlap and the top square\'s own face are the top one\'s');
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].above, 'ly_b', 'the added face goes above the top square\'s layer');
});

// Three circles, each overlapping both others and all three a middle.
const venn = () => sketchOf(round('p', 100, 100, 60, RED), round('q', 170, 100, 60, BLUE), round('s', 135, 160, 60, GREEN));

test('three circles have seven faces', () => {
  const r = wipeMarks(venn(), ['p', 'q', 's'], 'clean');
  assert.equal(r.problem, null);
  assert.equal(leftBy(r).length, 7);
});

test('Mid Wipe of three circles is their middle, Outer Wipes four pieces with the middle among them', () => {
  const faces = arrangeFaces(venn().strokes.map((s) => wipeOperand(s)!.region));
  assert.equal(faces.problem, null);
  const areaOf = (contours: Vec[][]) => Math.abs(contours.reduce((sum, c) => sum + signedArea(c), 0)) / 2;
  const middle = faces.faces.find((f) => f.covers.length === 3)!;
  const odd = faces.faces.filter((f) => f.covers.length % 2 === 1).reduce((sum, f) => sum + areaOf(f.contours), 0);

  const mid = wipeMarks(venn(), ['p', 'q', 's'], 'mid').changed.get('s')!;
  // The middle is small: the refit's quarter pixel along its edge bounds the difference.
  const edge = middle.contours.reduce((sum, c) => sum + c.reduce((l, p, i) => l + Math.hypot(c[(i + 1) % c.length].x - p.x, c[(i + 1) % c.length].y - p.y), 0), 0);
  assert.ok(Math.abs(filledArea(mid.points) - areaOf(middle.contours)) < 0.25 * edge, `${filledArea(mid.points)} for ${areaOf(middle.contours)}, edge ${edge}`);
  assert.equal(mid.vector!.anchors.length, 3, 'three arcs, a cubic each');
  const outer = wipeMarks(venn(), ['p', 'q', 's'], 'outer').changed.get('s')!;
  assert.equal(subpaths(outer), 4, 'three petals and the middle');
  assert.ok(Math.abs(filledArea(outer.points) - odd) / odd < 0.005, `${filledArea(outer.points)} for ${odd}`);
});

test('the faces of an arrangement, each piece of its own, with the regions it lies in', () => {
  const bar = corners(40, -10, 60, 110);
  const faces = arrangeFaces([[disc({ x: 50, y: 50 }, 40, 64)], [bar]]);
  // The circle less the bar is two pieces; the bar less the circle two more; the bar in the circle one.
  const byCovers = (key: string) => faces.faces.filter((f) => f.covers.join() === key).length;
  assert.equal(byCovers('0'), 2);
  assert.equal(byCovers('1'), 2);
  assert.equal(byCovers('0,1'), 1);
});

test('a result painted from an open line\'s ink is a filled shape in its color, with no outline', () => {
  const line: Stroke = { id: 'l', tool: 'pen', color: BLUE, width: 10, points: pts([{ x: -20, y: 50 }, { x: 120, y: 50 }]) };
  const r = wipeMarks(sketchOf(square('a', 0, 0, 100, 100), line), ['a', 'l'], 'in');
  const shape = r.changed.get('l')!;
  assert.equal(shape.tool, 'pen');
  assert.equal(shape.fill, BLUE);
  assert.equal(shape.noStroke, true);
  assert.equal(shape.vector!.closed, true);
});

test('a result from a closed outline keeps its outline, and gains no fill', () => {
  const r = wipeMarks(
    sketchOf(square('a', 0, 0, 100, 100, { fill: undefined, color: GREEN }), square('b', 50, 50, 150, 150, { fill: undefined, color: BLUE, width: 4 })),
    ['a', 'b'],
    'in',
  );
  const b = r.changed.get('b')!;
  assert.equal(b.fill, undefined);
  assert.equal(b.color, BLUE);
  assert.equal(b.width, 4);
  assert.ok(near(filledArea(b.points), 17500));
});

test('a hole is kept, and an operand wholly inside another becomes one', () => {
  const holed: Stroke = {
    id: 'h',
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    fill: RED,
    points: [...pts([...corners(0, 0, 100, 100), { x: 0, y: 0 }]), ...pts([{ x: 30, y: 30 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 30 }, { x: 30, y: 30 }]).map((p, i) => (i === 0 ? { ...p, move: true } : p))],
  };
  const kept = wipeMarks(sketchOf(holed, square('b', 200, 0, 220, 20)), ['h', 'b'], 'in').changed.get('b')!;
  assert.ok(near(filledArea(kept.points), 10000 - 1600 + 400), `${filledArea(kept.points)}`);
  assert.equal(subpaths(kept), 3, 'the square, its hole, and the other square');

  const inner = wipeMarks(sketchOf(square('a', 0, 0, 100, 100), square('b', 40, 40, 60, 60)), ['a', 'b'], 'out-front').changed.get('a')!;
  assert.ok(near(filledArea(inner.points), 10000 - 400));
  assert.equal(subpaths(inner), 2);
});

test('what a wipe never reaches keeps its anchors exactly', () => {
  // A circle of four cubics; a square overlapping its right side.
  const k = (4 / 3) * (Math.SQRT2 - 1) * 100;
  const c = { x: 200, y: 200 };
  const anchors: VectorAnchor[] = [
    { p: { x: c.x + 100, y: c.y }, hIn: { x: c.x + 100, y: c.y - k }, hOut: { x: c.x + 100, y: c.y + k } },
    { p: { x: c.x, y: c.y + 100 }, hIn: { x: c.x + k, y: c.y + 100 }, hOut: { x: c.x - k, y: c.y + 100 } },
    { p: { x: c.x - 100, y: c.y }, hIn: { x: c.x - 100, y: c.y + k }, hOut: { x: c.x - 100, y: c.y - k } },
    { p: { x: c.x, y: c.y - 100 }, hIn: { x: c.x - k, y: c.y - 100 }, hOut: { x: c.x + k, y: c.y - 100 } },
  ];
  const circle: Stroke = { id: 'c', tool: 'pen', color: '#1f2328', width: 2, fill: GREEN, points: sampleVectorPathPoints(anchors, true), vector: { anchors, closed: true } };
  const r = wipeMarks(sketchOf(circle, square('s', 270, 150, 350, 250)), ['c', 's'], 'in');
  const out = r.changed.get('s')!.vector!.anchors;
  const left = out.find((a) => near(a.p.x, 100, 1e-9) && near(a.p.y, 200, 1e-9));
  assert.ok(left, 'the left anchor is there');
  const same = (a: VectorAnchor | undefined, b: VectorAnchor): boolean =>
    !!a && a.p.x === b.p.x && a.p.y === b.p.y && ((!a.hIn && !b.hIn) || (!!a.hIn && !!b.hIn && a.hIn.x === b.hIn.x && a.hIn.y === b.hIn.y)) && ((!a.hOut && !b.hOut) || (!!a.hOut && !!b.hOut && a.hOut.x === b.hOut.x && a.hOut.y === b.hOut.y));
  const turned = (a: VectorAnchor): VectorAnchor => ({ p: a.p, ...(a.hOut ? { hIn: a.hOut } : {}), ...(a.hIn ? { hOut: a.hIn } : {}) });
  assert.ok(same(left, anchors[2]) || same(left, turned(anchors[2])), JSON.stringify(left));
  for (const p of r.changed.get('s')!.points.filter((q) => q.x < 200)) {
    assert.ok(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - 100) < 0.03, 'the left half is still on its circle');
  }
});

test('text and pictures are passed over, and fewer than two shapes is nothing to do', () => {
  const text: Stroke = { id: 't', tool: 'text', color: BLUE, width: 1, text: 'Hi', points: [{ x: 0, y: 0 }] };
  const r = wipeMarks(sketchOf(square('a', 0, 0, 10, 10), text), ['a', 't'], 'in');
  assert.equal(r.problem, 'too-few');
  assert.deepEqual([...r.skipped], ['t']);
  assert.equal(r.changed.size + r.removed.size + r.added.length, 0);
});

test('past the operand limit, nothing is done', () => {
  const many = Array.from({ length: WIPE_OPERAND_LIMIT + 1 }, (_, i) => square(`m${i}`, i * 3, 0, i * 3 + 2, 2));
  const r = wipeMarks(sketchOf(...many), many.map((s) => s.id), 'in');
  assert.equal(r.problem, 'too-many');
  assert.equal(r.changed.size + r.removed.size, 0);
});

test('past the face limit, an arrangement says so', () => {
  const regions = venn().strokes.map((s) => wipeOperand(s)!.region);
  assert.equal(arrangeFaces(regions, { faceLimit: 4 }).problem, 'too-many');
});

test('a wipe that leaves nothing takes the shapes away, and says it was empty', () => {
  const r = wipeMarks(sketchOf(square('a', 0, 0, 10, 10), square('b', 50, 50, 60, 60)), ['a', 'b'], 'mid');
  assert.equal(r.empty, true);
  assert.deepEqual([...r.removed].sort(), ['a', 'b']);
  assert.equal(r.changed.size, 0);
});

// ---- The Shape Stacker -------------------------------------------------------------

/** The pair's faces by what covers them: A only, both, B only. */
function pairFaces() {
  const sketch = pair();
  const arrangement = stackArrangement(sketch, ['a', 'b']);
  const by = (key: string): number => arrangement.faces.findIndex((f) => f.covers.join() === key);
  return { sketch, arrangement, onlyA: by('0'), both: by('0,1'), onlyB: by('1') };
}

test('the faces under a point, along a path and in a box', () => {
  const { arrangement, onlyA, both, onlyB } = pairFaces();
  assert.equal(arrangement.problem, null);
  assert.equal(arrangement.faces.length, 3);
  assert.equal(faceAt(arrangement, { x: 25, y: 25 }), onlyA);
  assert.equal(faceAt(arrangement, { x: 75, y: 75 }), both);
  assert.equal(faceAt(arrangement, { x: 200, y: 200 }), -1, 'off every face');
  assert.deepEqual(facesAlong(arrangement, [{ x: 25, y: 25 }, { x: 75, y: 75 }]), [onlyA, both], 'in the order the drag reaches them');
  assert.deepEqual(facesAlong(arrangement, [{ x: 140, y: 140 }, { x: 110, y: 110 }, { x: 20, y: 20 }]), [onlyB, both, onlyA]);
  assert.deepEqual(facesAlong(arrangement, [{ x: -50, y: 120 }, { x: 20, y: 200 }]), [], 'a drag that meets nothing');
  assert.deepEqual(facesAlong(arrangement, [{ x: 75, y: 75 }]), [both], 'a click');
  assert.deepEqual(facesAlong(arrangement, [{ x: 25, y: -10 }, { x: 25, y: 10 }]), [onlyA], 'from outside into a face');
  assert.deepEqual(facesInBox(arrangement, { minX: 60, minY: 60, maxX: 70, maxY: 70 }), [both], 'a box inside one face');
  assert.deepEqual(facesInBox(arrangement, { minX: 20, minY: 60, maxX: 70, maxY: 70 }).sort(), [onlyA, both].sort(), 'a box across two');
  assert.equal(facesInBox(arrangement, { minX: -10, minY: -10, maxX: 200, maxY: 200 }).length, 3, 'a box round everything');
  assert.deepEqual(facesInBox(arrangement, { minX: 160, minY: 0, maxX: 200, maxY: 40 }), [], 'a box beside them');
});

test('merging the faces a drag crosses: the mark it started on takes them all, and the other keeps the rest', () => {
  const { sketch, arrangement, onlyA, both } = pairFaces();
  const r = stackEdit(sketch, arrangement, [onlyA, both], 'merge');
  assert.equal(r.problem, null);
  assert.equal(r.added.length, 0, 'A keeps nothing besides, so the merged shape takes its place');
  assert.equal(r.removed.size, 0);
  const a = r.changed.get('a')!;
  assert.equal(a.fill, RED, 'painted as the mark the drag started on');
  assert.ok(near(filledArea(a.points), 10000), `${filledArea(a.points)}`);
  assert.equal(a.vector!.anchors.length, 4, 'the square again, four corners');
  assert.ok(near(filledArea(r.changed.get('b')!.points), 7500), 'B less what was merged');
});

test('a click on the overlap makes it a shape of its own, in the paint of the top mark there', () => {
  const { sketch, arrangement, both } = pairFaces();
  const r = stackEdit(sketch, arrangement, [both], 'merge');
  assert.ok(near(filledArea(r.changed.get('a')!.points), 7500));
  assert.ok(near(filledArea(r.changed.get('b')!.points), 7500));
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].stroke.fill, BLUE, 'the top mark over the overlap is B');
  assert.equal(r.added[0].above, 'ly_b', 'right above it');
  assert.ok(near(filledArea(r.added[0].stroke.points), 2500));
});

test('removing faces takes them from every mark, and removing all of them leaves nothing', () => {
  const { sketch, arrangement, onlyA, both, onlyB } = pairFaces();
  const r = stackEdit(sketch, arrangement, [both], 'remove');
  assert.equal(r.added.length, 0);
  assert.ok(near(filledArea(r.changed.get('a')!.points), 7500));
  assert.ok(near(filledArea(r.changed.get('b')!.points), 7500));
  const one = stackEdit(sketch, arrangement, [onlyA], 'remove');
  assert.deepEqual([...one.changed.keys()], ['a'], 'B is no part of what A alone covers, and is not touched');
  const all = stackEdit(sketch, arrangement, [onlyA, both, onlyB], 'remove');
  assert.deepEqual([...all.removed].sort(), ['a', 'b']);
  assert.equal(all.empty, true);
  assert.equal(stackEdit(sketch, arrangement, [], 'merge').changed.size, 0, 'nothing picked is nothing done');
});

test('stacking three circles: the middle merged is a shape of its own, and removed a hole in each', () => {
  const sketch = venn();
  const arrangement = stackArrangement(sketch, ['p', 'q', 's']);
  assert.equal(arrangement.faces.length, 7);
  const middle = arrangement.faces.findIndex((f) => f.covers.length === 3);
  const total = (strokes: Stroke[]): number => strokes.reduce((sum, st) => sum + filledArea(st.points), 0);
  const before = total(sketch.strokes);
  const merged = stackEdit(sketch, arrangement, [middle], 'merge');
  assert.equal(merged.added.length, 1);
  assert.equal(merged.added[0].stroke.fill, GREEN, 'the topmost circle over the middle');
  assert.equal(merged.changed.size, 3, 'each circle gives up the middle');
  const after = [...merged.changed.values(), ...merged.added.map((a) => a.stroke)];
  const middleArea = Math.abs(arrangement.faces[middle].contours.reduce((sum, c) => sum + signedArea(c), 0)) / 2;
  // Each circle loses the middle, and the middle comes back once.
  assert.ok(Math.abs(total(after) - (before - 2 * middleArea)) / before < 0.005, `${total(after)} for ${before - 2 * middleArea}`);
  const removed = stackEdit(sketch, arrangement, [middle], 'remove');
  assert.equal(removed.added.length, 0);
  assert.ok(Math.abs(total([...removed.changed.values()]) - (before - 3 * middleArea)) / before < 0.005);
});

test('the pieces of a circle merged back are the circle, its four cubics exactly', () => {
  const k = (4 / 3) * (Math.SQRT2 - 1) * 100;
  const c = { x: 200, y: 200 };
  const anchors: VectorAnchor[] = [
    { p: { x: c.x + 100, y: c.y }, hIn: { x: c.x + 100, y: c.y - k }, hOut: { x: c.x + 100, y: c.y + k } },
    { p: { x: c.x, y: c.y + 100 }, hIn: { x: c.x + k, y: c.y + 100 }, hOut: { x: c.x - k, y: c.y + 100 } },
    { p: { x: c.x - 100, y: c.y }, hIn: { x: c.x - 100, y: c.y + k }, hOut: { x: c.x - 100, y: c.y - k } },
    { p: { x: c.x, y: c.y - 100 }, hIn: { x: c.x - k, y: c.y - 100 }, hOut: { x: c.x + k, y: c.y - 100 } },
  ];
  const circle: Stroke = { id: 'c', tool: 'pen', color: '#1f2328', width: 2, fill: GREEN, points: sampleVectorPathPoints(anchors, true), vector: { anchors, closed: true } };
  const sketch = sketchOf(circle, square('s', 270, 150, 350, 250));
  const arrangement = stackArrangement(sketch, ['c', 's']);
  const onlyC = arrangement.faces.findIndex((f) => f.covers.join() === '0');
  const both = arrangement.faces.findIndex((f) => f.covers.join() === '0,1');
  const r = stackEdit(sketch, arrangement, [onlyC, both], 'merge');
  const back = r.changed.get('c')!.vector!.anchors;
  assert.equal(back.length, 4, JSON.stringify(back.map((a) => a.p)));
  const key = (a: VectorAnchor): string => [a.p, a.hIn, a.hOut].map((v) => (v ? `${v.x},${v.y}` : '-')).join(' ');
  const turned = (a: VectorAnchor): VectorAnchor => ({ p: a.p, ...(a.hOut ? { hIn: a.hOut } : {}), ...(a.hIn ? { hOut: a.hIn } : {}) });
  const want = new Set(anchors.map(key));
  const wantTurned = new Set(anchors.map((a) => key(turned(a))));
  assert.ok(back.every((a) => want.has(key(a))) || back.every((a) => wantTurned.has(key(a))), JSON.stringify(back));
});

test('stacking at points: the faces under them, and the points on none', () => {
  const sketch = pair();
  const r = stackFaces(sketch, ['a', 'b'], [{ x: 25, y: 25 }, { x: 75, y: 75 }, { x: 300, y: 300 }], 'merge');
  assert.deepEqual(r.missed, [{ x: 300, y: 300 }]);
  assert.ok(near(filledArea(r.changed.get('a')!.points), 10000));
  const few = stackFaces(sketchOf(square('a', 0, 0, 10, 10)), ['a'], [{ x: 5, y: 5 }], 'merge');
  assert.equal(few.problem, 'too-few');
  assert.deepEqual(few.missed, []);
});
