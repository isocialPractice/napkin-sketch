/**
 * Erasing as geometry (`src/core/erase.ts`): each kind of mark, the region an
 * eraser takes away, a line cut into subpaths of the same mark, an area cut
 * and refitted into a few anchors, a mark erased away, and a cut mark that
 * exports as plain paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cutArea, cutLine, eraseKind, eraseMarks, eraseRegionOf } from '../src/core/erase.js';
import { disc, signedArea } from '../src/core/graphic-design/geometry.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { createSketch, type Point, type Stroke, type VectorAnchor } from '../src/core/types.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';

type Vec = { x: number; y: number };

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const pts = (list: Vec[], pressure = 0.5): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure }));
const pen = (points: Point[], extra: Partial<Stroke> = {}): Stroke => ({ id: 'st_mark', tool: 'pen', color: '#224466', width: 4, points, ...extra });

/** The area of a convex polygon clipped to a rectangle (Sutherland-Hodgman). */
function clippedArea(poly: Vec[], x0: number, y0: number, x1: number, y1: number): number {
  let out = poly;
  const edges: Array<[(p: Vec) => boolean, (a: Vec, b: Vec) => Vec]> = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((x0 - a.x) / (b.x - a.x)) * (b.y - a.y) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((x1 - a.x) / (b.x - a.x)) * (b.y - a.y) })],
    [(p) => p.y >= y0, (a, b) => ({ x: a.x + ((y0 - a.y) / (b.y - a.y)) * (b.x - a.x), y: y0 })],
    [(p) => p.y <= y1, (a, b) => ({ x: a.x + ((y1 - a.y) / (b.y - a.y)) * (b.x - a.x), y: y1 })],
  ];
  for (const [inside, cut] of edges) {
    const next: Vec[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      if (inside(b)) {
        if (!inside(a)) next.push(cut(a, b));
        next.push(b);
      } else if (inside(a)) next.push(cut(a, b));
    }
    out = next;
  }
  return out.length >= 3 ? Math.abs(signedArea(out)) / 2 : 0;
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

test('each kind of mark is erased as what it is', () => {
  const square = pts([...rect(0, 0, 50, 50), { x: 0, y: 0 }]);
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }, { x: 9, y: 9 }]))), 'line', 'a pen line');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }, { x: 9, y: 9 }]), { tool: 'marker' })), 'line', 'a marker line');
  assert.equal(eraseKind(pen(square)), 'line', 'a closed outline with no fill');
  assert.equal(eraseKind(pen(square, { fill: '#ff0000' })), 'area', 'a filled shape');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }, { x: 9, y: 9 }]), { tool: 'copic', nibAngle: 30 })), 'area', 'a Copic stroke');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }, { x: 9, y: 9 }]), { profile: 'tapered' })), 'area', 'a profiled stroke');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }]), { tool: 'text', text: 'hi' })), 'skip', 'text');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }]), { tool: 'image', image: 'data:image/png;base64,' })), 'skip', 'an image');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }, { x: 9, y: 9 }]), { tool: 'eraser' })), 'skip', 'an eraser');
  assert.equal(eraseKind(pen(pts([{ x: 0, y: 0 }, { x: 9, y: 9 }]), { link: { href: 'a.skbk', kind: 'file' } as Stroke['link'] })), 'skip', 'a link');
});

test("an eraser's region is its swath at full width with round ends, or a click's dot", () => {
  const swath = eraseRegionOf(pen(pts([{ x: 0, y: 0 }, { x: 100, y: 0 }]), { tool: 'eraser', width: 10 }));
  const area = Math.abs(swath.reduce((sum, c) => sum + signedArea(c), 0)) / 2;
  const expected = 100 * 10 + Math.PI * 25;
  assert.ok(Math.abs(area - expected) / expected < 0.01, `${area} for ${expected}`);
  // A click paints a dot sized by its pressure, as a pen's does.
  const dot = eraseRegionOf(pen(pts([{ x: 5, y: 5 }]), { tool: 'eraser', width: 10 }));
  const dotArea = Math.abs(signedArea(dot[0])) / 2;
  const r = (10 * 0.7) / 2;
  assert.ok(Math.abs(dotArea - Math.PI * r * r) / (Math.PI * r * r) < 0.01, `${dotArea}`);
  // A closed shape used as an eraser takes away its inside.
  const shape = eraseRegionOf(pen(pts(rect(0, 0, 20, 20))));
  assert.equal(shape.length, 1);
  assert.ok(Math.abs(Math.abs(signedArea(shape[0])) / 2 - 400) < 1e-9);
});

test('a line cut in two stays one mark, of two subpaths, clear of the cut by its painted half width', () => {
  const line = pen(pts([{ x: 0, y: 100 }, { x: 200, y: 100 }]));
  const cut = cutLine(line, [rect(90, 50, 110, 150)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const p = cut.stroke.points;
  assert.equal(p.length, 4);
  assert.equal(p.filter((q) => q.move).length, 1, 'the second run is a subpath of its own');
  assert.equal(p[2].move, true);
  // A mouse pen's line paints at 0.7 of its width: 1.4 either side of a 4-pixel line.
  assert.ok(Math.abs(p[1].x - 88.6) < 1e-6 && Math.abs(p[2].x - 111.4) < 1e-6, `${p[1].x} ${p[2].x}`);
  assert.equal(cut.stroke.id, line.id);
  assert.equal(cut.stroke.width, 4);
  // A pressed-hard line reaches further.
  const hard = cutLine(pen(pts([{ x: 0, y: 100 }, { x: 200, y: 100 }], 1)), [rect(90, 50, 110, 150)]);
  assert.ok(hard.kind === 'changed' && Math.abs(hard.stroke.points[1].x - 88) < 1e-6 && Math.abs(hard.stroke.points[2].x - 112) < 1e-6);
});

test('a curve with anchors is split at the cut, and what is left lies on the curve as it was', () => {
  const anchors: VectorAnchor[] = [
    { p: { x: 0, y: 100 }, hOut: { x: 60, y: 0 } },
    { p: { x: 200, y: 100 }, hIn: { x: 140, y: 0 } },
  ];
  const curve = pen(sampleVectorPathPoints(anchors, false), { vector: { anchors } });
  const cut = cutLine(curve, [rect(90, 0, 110, 200)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const out = cut.stroke.vector!.anchors;
  assert.equal(out.length, 4, 'two pieces, two anchors each');
  assert.equal(out[2].move, true);
  assert.ok(out[0].hOut && out[1].hIn && out[2].hOut && out[3].hIn, 'each piece keeps its curve');
  // Every point of what is left is on the original curve.
  const dense: Vec[] = [];
  for (let i = 0; i <= 20000; i++) {
    const t = i / 20000;
    const mt = 1 - t;
    dense.push({ x: 3 * mt * mt * t * 60 + 3 * mt * t * t * 140 + t * t * t * 200, y: mt * mt * mt * 100 + t * t * t * 100 });
  }
  for (const q of cut.stroke.points) {
    const nearest = Math.min(...dense.map((d) => Math.hypot(d.x - q.x, d.y - q.y)));
    assert.ok(nearest < 0.05, `${q.x}, ${q.y} is ${nearest} off the curve`);
  }
});

test('a closed outline cut once is one open run, round through its seam', () => {
  const square = pen(pts([...rect(0, 0, 100, 100), { x: 0, y: 0 }]));
  const cut = cutLine(square, [rect(40, -20, 60, 20)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const p = cut.stroke.points;
  assert.equal(p.filter((q) => q.move).length, 0, 'one run');
  assert.ok(Math.abs(p[0].x - 61.4) < 1e-6 && p[0].y === 0, `it starts past the cut: ${p[0].x}, ${p[0].y}`);
  assert.ok(Math.abs(p[p.length - 1].x - 38.6) < 1e-6 && p[p.length - 1].y === 0, `and ends before it: ${p[p.length - 1].x}`);
});

test('each closed subpath of an outline cut open goes round through its own seam', () => {
  // Two squares, one inside the other, as one unfilled mark.
  const outer = [...rect(0, 0, 100, 100), { x: 0, y: 0 }];
  const inner = [...rect(30, 30, 70, 70), { x: 30, y: 30 }].map((p, i) => ({ ...p, pressure: 0.5, ...(i === 0 ? { move: true as const } : {}) }));
  const mark = pen([...pts(outer), ...inner]);
  const cut = cutLine(mark, [rect(40, -20, 60, 20)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const p = cut.stroke.points;
  assert.equal(p.filter((q) => q.move).length, 1, 'the outer square one run, the inner one untouched: two subpaths');
  assert.ok(Math.abs(p[0].x - 61.4) < 1e-6 && p[0].y === 0, `the outer run starts past the cut: ${p[0].x}, ${p[0].y}`);
});

test('a line the region covers is removed, one it misses is kept', () => {
  const line = pen(pts([{ x: 0, y: 0 }, { x: 50, y: 0 }]));
  assert.equal(cutLine(line, [rect(-10, -10, 60, 10)]).kind, 'removed');
  assert.equal(cutLine(line, [rect(100, 100, 200, 200)]).kind, 'kept');
  assert.equal(cutLine(pen(pts([{ x: 5, y: 5 }])), [rect(0, 0, 10, 10)]).kind, 'removed', 'a dot under the eraser');
});

test('a filled circle less a band is two pieces in under a dozen anchors, the area exact to the refit', () => {
  const circle = disc({ x: 50, y: 50 }, 50, 64);
  const mark = pen(pts([...circle, circle[0]]), { fill: '#ff8800' });
  const cut = cutArea(mark, [rect(30, -10, 70, 110)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const anchors = cut.stroke.vector!.anchors;
  assert.ok(anchors.length < 12, `${anchors.length} anchors`);
  assert.equal(anchors.filter((a) => a.move).length, 1, 'two pieces');
  assert.equal(cut.stroke.vector!.closed, true);
  assert.equal(cut.stroke.fill, '#ff8800', 'it keeps its fill');
  // The circle's area less the band's share of it - worked out by clipping
  // the polygon to the band - within what a quarter-pixel refit can move.
  const expected = Math.abs(signedArea(circle)) / 2 - clippedArea(circle, 30, -10, 70, 110);
  const area = filledArea(cut.stroke.points);
  assert.ok(Math.abs(area - expected) / expected < 0.005, `${area} for ${expected}`);
});

test('a filled square less a square inside it keeps a hole, and its corners', () => {
  const mark = pen(pts([...rect(0, 0, 100, 100), { x: 0, y: 0 }]), { fill: '#000000' });
  const cut = cutArea(mark, [rect(25, 25, 75, 75)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const anchors = cut.stroke.vector!.anchors;
  assert.equal(anchors.length, 8, 'four corners outside, four round the hole');
  assert.ok(anchors.every((a) => !a.hIn && !a.hOut), 'straight edges stay lines');
  assert.ok(Math.abs(filledArea(cut.stroke.points) - 7500) < 1e-6, `${filledArea(cut.stroke.points)}`);
});

test('a shape with anchors, cut again and again, keeps what the cuts never reach exactly', () => {
  // A circle of four cubics, bitten three times on its right.
  const k = (4 / 3) * (Math.SQRT2 - 1) * 100;
  const c = { x: 200, y: 200 };
  const anchors: VectorAnchor[] = [
    { p: { x: c.x + 100, y: c.y }, hIn: { x: c.x + 100, y: c.y - k }, hOut: { x: c.x + 100, y: c.y + k } },
    { p: { x: c.x, y: c.y + 100 }, hIn: { x: c.x + k, y: c.y + 100 }, hOut: { x: c.x - k, y: c.y + 100 } },
    { p: { x: c.x - 100, y: c.y }, hIn: { x: c.x - 100, y: c.y + k }, hOut: { x: c.x - 100, y: c.y - k } },
    { p: { x: c.x, y: c.y - 100 }, hIn: { x: c.x - k, y: c.y - 100 }, hOut: { x: c.x + k, y: c.y - 100 } },
  ];
  let mark = pen(sampleVectorPathPoints(anchors, true), { fill: '#000000', vector: { anchors, closed: true } });
  for (const y of [170, 200, 230]) {
    const cut = cutArea(mark, [rect(290, y - 8, 320, y + 8)]);
    assert.equal(cut.kind, 'changed');
    if (cut.kind !== 'changed') return;
    mark = cut.stroke;
  }
  const out = mark.vector!.anchors;
  // The left anchor, untouched, is exactly as it was, handles and all.
  const left = out.find((a) => Math.abs(a.p.x - 100) < 1e-9 && Math.abs(a.p.y - 200) < 1e-9);
  assert.deepEqual(left, anchors[2]);
  // And every point of the left half is still on the circle it was.
  const leftHalf = mark.points.filter((p) => p.x < 200);
  assert.ok(leftHalf.length > 10);
  for (const p of leftHalf) {
    const r = Math.hypot(p.x - c.x, p.y - c.y);
    assert.ok(Math.abs(r - 100) < 0.03, `${r}`);
  }
  // Three bites add their own edges and no more: two corners and a side for each, and a curve's split or two.
  assert.ok(out.length <= 4 + 3 * 4, `${out.length} anchors`);
});

test("a Copic or a profiled stroke, cut, is a filled shape in its colour", () => {
  const copic = pen(pts([{ x: 0, y: 50 }, { x: 200, y: 50 }]), { tool: 'copic', nibAngle: 30, width: 12, opacity: 0.6 });
  const cut = cutArea(copic, [rect(90, 0, 110, 100)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  assert.equal(cut.stroke.tool, 'pen');
  assert.equal(cut.stroke.fill, '#224466');
  assert.equal(cut.stroke.noStroke, true);
  assert.equal(cut.stroke.opacity, 0.6);
  assert.equal(cut.stroke.nibAngle, undefined);
  assert.equal(cut.stroke.vector!.anchors.filter((a) => a.move).length, 1, 'cut in two');
  const profiled = cutArea(pen(pts([{ x: 0, y: 50 }, { x: 200, y: 50 }]), { profile: 'tapered', width: 12 }), [rect(90, 0, 110, 100)]);
  assert.ok(profiled.kind === 'changed' && profiled.stroke.profile === undefined && profiled.stroke.fill === '#224466');
});

test('an area the region covers is removed, one it misses is kept', () => {
  const mark = pen(pts([...rect(0, 0, 50, 50), { x: 0, y: 0 }]), { fill: '#000000' });
  assert.equal(cutArea(mark, [rect(-10, -10, 60, 60)]).kind, 'removed');
  assert.equal(cutArea(mark, [rect(100, 100, 200, 200)]).kind, 'kept');
  // Inside its bounds but clear of its ink.
  const ring = pen(pts([...rect(0, 0, 100, 100), { x: 0, y: 0 }, ...rect(20, 20, 80, 80).reverse().map((p, i) => ({ ...p, ...(i === 0 ? { move: true } : {}) }))]), { fill: '#000000' });
  assert.equal(cutArea(ring, [rect(40, 40, 60, 60)]).kind, 'kept', 'a cutter in the hole');
});

test('eraseMarks cuts what the region reaches, passes over text, and leaves the rest out', () => {
  const sketch = createSketch('erase');
  const line: Stroke = { ...pen(pts([{ x: 0, y: 100 }, { x: 200, y: 100 }])), id: 'st_line' };
  const far: Stroke = { ...pen(pts([{ x: 500, y: 500 }, { x: 600, y: 500 }])), id: 'st_far' };
  const text: Stroke = { ...pen(pts([{ x: 100, y: 100 }]), { tool: 'text', text: 'hello' }), id: 'st_text' };
  const covered: Stroke = { ...pen(pts([...rect(95, 90, 105, 110), { x: 95, y: 90 }]), { fill: '#000000' }), id: 'st_covered' };
  sketch.strokes.push(line, far, text, covered);
  const result = eraseMarks(sketch, ['st_line', 'st_far', 'st_text', 'st_covered', 'st_missing'], [rect(90, 50, 110, 150)]);
  assert.deepEqual([...result.changed.keys()], ['st_line']);
  assert.deepEqual([...result.removed], ['st_covered']);
  assert.deepEqual([...result.skipped], ['st_text']);
  assert.equal(result.raster.size, 0);
  // The page itself is not touched: the result says what to change.
  assert.equal(sketch.strokes[0].points.length, 2);
});

test('a cut mark exports as plain paths, with no mask', () => {
  const sketch = createSketch('svg');
  const circle = disc({ x: 50, y: 50 }, 50, 64);
  const mark = pen(pts([...circle, circle[0]]), { fill: '#ff8800' });
  const cut = cutArea(mark, [rect(30, -10, 70, 110)]);
  assert.equal(cut.kind, 'changed');
  if (cut.kind !== 'changed') return;
  const line = cutLine(pen(pts([{ x: 0, y: 200 }, { x: 200, y: 200 }]), { id: 'st_line' }), [rect(90, 150, 110, 250)]);
  assert.equal(line.kind, 'changed');
  if (line.kind !== 'changed') return;
  sketch.strokes.push(cut.stroke, line.stroke);
  const svg = sketchToSvg(sketch);
  assert.ok(!svg.includes('<mask'), 'no mask');
  assert.ok((svg.match(/<path/g) ?? []).length >= 2, 'a path for each mark');
});
