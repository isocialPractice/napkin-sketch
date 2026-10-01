/**
 * What a press picks: the mark whose painted ink is under the pointer, in the
 * canvas's paint order, or the nearest within a tolerance in screen pixels;
 * and what a rubber band takes. The GUI check `check-select-accuracy.mjs`
 * drives the same rules through the Select and Direct Select tools.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hitMark, inkDistance, marksInBox, outlineDistance } from '../src/core/hit-test.js';
import { paintOrder } from '../src/core/paint-order.js';
import type { Layer, Sketch, Stroke } from '../src/core/types.js';

const layer = (id: string, extra: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  opacity: 1,
  visible: true,
  locked: false,
  ...extra,
});

/** A pen mark at full pressure, so its ink is exactly `width` across. */
const pen = (id: string, on: string, points: Array<[number, number]>, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'pen',
  color: '#000000',
  width: 2,
  layer: on,
  points: points.map(([x, y]) => ({ x, y, pressure: 1 })),
  ...extra,
});

const page = (layers: Layer[], strokes: Stroke[]): Sketch => ({
  id: 'sk',
  name: 'test',
  width: 800,
  height: 600,
  background: '#ffffff',
  layers,
  strokes,
  createdAt: '',
  updatedAt: '',
});

const at1 = { zoom: 1, tolerancePx: 4 };
const pick = (sketch: Sketch, x: number, y: number, options = at1): string | null =>
  hitMark(sketch, { x, y }, options)?.id ?? null;

test('inside two overlapping marks the top one wins; outside both, the nearer one', () => {
  // A wide bar on the bottom, a thin line on top that runs along its middle.
  const sketch = page(
    [layer('L')],
    [pen('bar', 'L', [[0, 0], [100, 0]], { width: 20 }), pen('line', 'L', [[0, 0], [100, 0]], { width: 2 })],
  );
  assert.equal(pick(sketch, 50, 0), 'line', 'on both inks: the one painted last');
  assert.equal(pick(sketch, 50, 5), 'bar', 'on the bar alone');
  // Just outside the bar (half-width 10): the bar is 1 away, the line 11.
  assert.equal(pick(sketch, 50, 11), 'bar');
  assert.equal(pick(sketch, 50, 40), null, 'out of reach of both');
});

test('the tolerance is screen pixels, so it shrinks in page units as the zoom grows', () => {
  const sketch = page([layer('L')], [pen('thin', 'L', [[0, 0], [100, 0]], { width: 1 })]);
  // Ink is 0.5 either side. Three screen pixels off at zoom 1 is 2.5 from the ink.
  assert.equal(pick(sketch, 50, 3, { zoom: 1, tolerancePx: 4 }), 'thin');
  // Ten screen pixels off at zoom 4 is 2.5 page units, 2 from the ink: past 4 / 4.
  assert.equal(pick(sketch, 50, 10 / 4, { zoom: 4, tolerancePx: 4 }), null);
  // And the setting is what reaches: 12 pixels at zoom 4 is 3 units.
  assert.equal(pick(sketch, 50, 10 / 4, { zoom: 4, tolerancePx: 12 }), 'thin');
});

test('the ink is as wide as the painter strokes it, pressure included', () => {
  const light = pen('light', 'L', [[0, 0], [100, 0]], { width: 10 });
  light.points = light.points.map((p) => ({ ...p, pressure: 0 }));
  // At no pressure the pen paints 0.4 of its width: 2 either side.
  assert.equal(inkDistance(light, { x: 50, y: 2 }), 0);
  assert.ok(Math.abs(inkDistance(light, { x: 50, y: 5 }) - 3) < 1e-9);
  // A marker is uniform whatever the pressure.
  assert.equal(inkDistance({ ...light, tool: 'marker' }, { x: 50, y: 5 }), 0);
});

test('a fill on top wins over an outline beneath it; an outline on top wins on its own ink', () => {
  const square = pen('square', 'L', [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], { fill: '#ff0000' });
  const line = pen('line', 'L', [[-50, 50], [150, 50]]);
  assert.equal(pick(page([layer('L')], [line, square]), 50, 50), 'square', 'the fill is painted over the line');
  assert.equal(pick(page([layer('L')], [square, line]), 50, 50), 'line', 'the line is painted over the fill');
  assert.equal(pick(page([layer('L')], [square, line]), 50, 20), 'square', 'off the line, inside the fill');
});

test('an unfilled outline is click-through in its middle', () => {
  const ring = pen('ring', 'L', [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
  assert.equal(pick(page([layer('L')], [ring]), 50, 50), null);
  assert.equal(pick(page([layer('L')], [ring]), 50, 2), 'ring');
});

test('order is the layer stack, not the page list: a layer moved up paints, and picks, on top', () => {
  // The page's list has "low" last, but its layer sits below "high"'s.
  const sketch = page(
    [layer('bottom'), layer('top')],
    [pen('high', 'top', [[0, 0], [100, 0]], { width: 10 }), pen('low', 'bottom', [[0, 0], [100, 0]], { width: 10 })],
  );
  assert.deepEqual(paintOrder(sketch).map((s) => s.id), ['low', 'high']);
  assert.equal(pick(sketch, 50, 0), 'high');
});

test('a group with effects paints as one picture where its first layer is', () => {
  // The stack, bottom first: inner-a (in the group), loose, inner-b (in the group).
  const sketch = page(
    [
      layer('fx', { group: true, effects: [{ type: 'drop-shadow', dx: 2, dy: 2, blur: 0, color: '#000000' }] }),
      layer('inner-a', { parent: 'fx' }),
      layer('loose'),
      layer('inner-b', { parent: 'fx' }),
    ],
    [
      pen('a', 'inner-a', [[0, 0], [100, 0]], { width: 10 }),
      pen('b', 'inner-b', [[0, 0], [100, 0]], { width: 10 }),
      pen('c', 'loose', [[0, 0], [100, 0]], { width: 10 }),
    ],
  );
  assert.deepEqual(paintOrder(sketch).map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(pick(sketch, 50, 0), 'c', 'the loose layer paints over the whole group');
});

test('hidden layers paint nothing, and a caller can say which marks may be picked', () => {
  const sketch = page(
    [layer('under'), layer('over')],
    [pen('u', 'under', [[0, 0], [100, 0]]), pen('o', 'over', [[0, 0], [100, 0]])],
  );
  assert.equal(pick(sketch, 50, 0), 'o');
  const paints = (l: Layer): boolean => l.id !== 'over';
  assert.equal(hitMark(sketch, { x: 50, y: 0 }, { ...at1, paints })?.id, 'u');
  assert.equal(hitMark(sketch, { x: 50, y: 0 }, { ...at1, editable: new Set(['u']) })?.id, 'u');
});

test('an eraser is never picked, and ink it has cut away picks nothing', () => {
  const eraser: Stroke = { ...pen('rub', 'L', [[40, -20], [40, 20]], { width: 20 }), tool: 'eraser' };
  assert.equal(pick(page([layer('L')], [eraser]), 40, 0), null);
  const cut = page([layer('L')], [pen('line', 'L', [[0, 0], [100, 0]]), eraser]);
  assert.equal(pick(cut, 40, 0), null, 'inside the cut');
  assert.equal(pick(cut, 10, 0), 'line', 'on the ink the eraser left');
  assert.equal(pick(cut, 40, 3), null, 'near the cut, whose nearest ink is gone');
  // An eraser cuts only the marks before it in its own layer.
  const later = page([layer('L')], [eraser, pen('line', 'L', [[0, 0], [100, 0]])]);
  assert.equal(pick(later, 40, 0), 'line', 'drawn after the eraser');
  const other = page([layer('L'), layer('M')], [pen('line', 'M', [[0, 0], [100, 0]]), eraser]);
  assert.equal(pick(other, 40, 0), 'line', 'on a layer the eraser is not on');
});

test('the pen lift between a compound shape\'s contours is never ink', () => {
  const twin = pen('twin', 'L', [[0, 0], [10, 0]]);
  twin.points.push({ x: 100, y: 0, pressure: 1, move: true }, { x: 110, y: 0, pressure: 1 });
  const sketch = page([layer('L')], [twin]);
  assert.equal(pick(sketch, 55, 0), null);
  assert.equal(pick(sketch, 105, 0), 'twin');
});

test('a dashed line counts as solid, gaps and all', () => {
  const dashed = pen('dash', 'L', [[0, 0], [100, 0]], { strokeStyle: 'dashed', width: 2 });
  // The pattern is 6 on, 4 off: 7 is in the first gap.
  assert.equal(inkDistance(dashed, { x: 7, y: 0 }), 0);
});

test('an outline switched off leaves only the fill to pick', () => {
  const box = pen('box', 'L', [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], { fill: '#00ff00', noStroke: true, width: 10 });
  assert.equal(inkDistance(box, { x: 50, y: 50 }), 0);
  assert.ok(inkDistance(box, { x: 50, y: -3 }) > 2.9, 'the outline would have covered this');
  // Direct Select still finds the bare path.
  assert.ok(outlineDistance(box, { x: 50, y: 0 }) <= 0);
});

test('the outline distance leaves a fill out', () => {
  const square = pen('square', 'L', [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], { fill: '#ff0000' });
  assert.equal(inkDistance(square, { x: 50, y: 50 }), 0);
  assert.ok(Math.abs(outlineDistance(square, { x: 50, y: 50 }) - 49) < 1e-9);
});

test('the Copic picks on its broad nib', () => {
  const copic: Stroke = { ...pen('nib', 'L', [[0, 0], [100, 0]], { width: 20 }), tool: 'copic', nibAngle: 90 };
  // A vertical chisel 20 across: its ink reaches 10 up and down from the path.
  assert.equal(inkDistance(copic, { x: 50, y: 9 }), 0);
  assert.ok(inkDistance(copic, { x: 50, y: 14 }) > 3);
});

test('text and images pick by their boxes', () => {
  const text: Stroke = { ...pen('t', 'L', [[10, 10]]), tool: 'text', text: 'hello', fontSize: 20 };
  const measure = (): { width: number; height: number } => ({ width: 50, height: 20 });
  assert.equal(inkDistance(text, { x: 30, y: 20 }, measure), 0);
  assert.equal(inkDistance(text, { x: 30, y: 33 }, measure), 3);
});

test('a rubber band takes a line it only crosses, a fill it sits in, and never an eraser', () => {
  const rect = pen('rect', 'L', [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
  const filled = pen('filled', 'L', [[200, 0], [300, 0], [300, 100], [200, 100], [200, 0]], { fill: '#0000ff' });
  const eraser: Stroke = { ...pen('rub', 'L', [[40, -20], [60, 20]]), tool: 'eraser' };
  const sketch = page([layer('L')], [rect, filled, eraser]);
  const ids = (box: { minX: number; minY: number; maxX: number; maxY: number }): string[] =>
    marksInBox(sketch, box).map((s) => s.id);
  // Across the top edge of the rectangle, with none of its corners inside.
  assert.deepEqual(ids({ minX: 40, minY: -10, maxX: 60, maxY: 10 }), ['rect']);
  // Inside the rectangle, touching none of its edges: an outline has no middle.
  assert.deepEqual(ids({ minX: 40, minY: 40, maxX: 60, maxY: 60 }), []);
  // Inside the filled square.
  assert.deepEqual(ids({ minX: 240, minY: 40, maxX: 260, maxY: 60 }), ['filled']);
  // The ink's width counts: a 2-wide line reaches 1 either side of its path.
  assert.deepEqual(ids({ minX: 40, minY: 0.8, maxX: 60, maxY: 20 }), ['rect']);
  assert.deepEqual(ids({ minX: 40, minY: 1.5, maxX: 60, maxY: 20 }), []);
});
