/**
 * An erase applied to the page (`Store.eraseMarks`): one undo step, each cut
 * mark changed where it was, a mark with nothing left gone, the layers that
 * leaves empty pruned - eraser marks of older files no content of their own -
 * and the selection kept on what is left. The GUI check `check-eraser.mjs`
 * drives the Eraser that calls it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { eraseMarks } from '../src/core/erase.js';
import { createSketchBook, type Layer, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

type Vec = { x: number; y: number };

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function line(id: string, layer: string, y: number): Stroke {
  return { id, tool: 'pen', color: '#000', width: 4, layer, points: [{ x: 0, y, pressure: 0.5 }, { x: 200, y, pressure: 0.5 }] };
}

function layer(id: string, name: string): Layer {
  return { id, name, opacity: 1, visible: true, locked: false };
}

/** Three lines, each on a layer of its own, the way the app lays marks down. */
function threeLines(): Store {
  const store = new Store(createSketchBook('erase'));
  store.sketch.layers = [layer('la', 'Pen 1'), layer('lb', 'Pen 2'), layer('lc', 'Pen 3')];
  store.sketch.strokes = [line('sa', 'la', 50), line('sb', 'lb', 100), line('sc', 'lc', 150)];
  return store;
}

test('an erase is one undo step, and changes the marks in place', () => {
  const store = threeLines();
  store.setSelection(['sa', 'sb']);
  // A band down through the first two lines' right ends.
  const result = eraseMarks(store.sketch, ['sa', 'sb'], [rect(150, 0, 250, 120)]);
  assert.deepEqual([...result.changed.keys()], ['sa', 'sb']);
  const layersBefore = store.sketch.layers.map((l) => l.id);
  store.eraseMarks(result);
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['sa', 'sb', 'sc'], 'the same marks, in the same order');
  assert.deepEqual(store.sketch.layers.map((l) => l.id), layersBefore, 'no layer added or lost');
  assert.ok(store.sketch.strokes.every((s) => s.tool !== 'eraser'), 'no eraser mark');
  const a = store.sketch.strokes[0];
  assert.equal(a.layer, 'la');
  assert.ok(Math.abs(a.points[a.points.length - 1].x - (150 - 1.4)) < 1e-6, `cut short: ${a.points[a.points.length - 1].x}`);
  assert.deepEqual([...store.selectedIds].sort(), ['sa', 'sb'], 'the selection stays on the cut marks');
  store.undo();
  assert.equal(store.sketch.strokes[0].points[1].x, 200, 'one undo puts the first back');
  assert.equal(store.sketch.strokes[1].points[1].x, 200, 'and the second');
});

test('a mark erased away goes, and so does the layer it leaves empty', () => {
  const store = threeLines();
  store.setSelection(['sb']);
  const result = eraseMarks(store.sketch, ['sb'], [rect(-10, 90, 210, 110)]);
  assert.deepEqual([...result.removed], ['sb']);
  store.eraseMarks(result);
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['sa', 'sc']);
  assert.deepEqual(store.sketch.layers.map((l) => l.id), ['la', 'lc'], 'its layer is pruned');
  assert.equal(store.selectedIds.size, 0);
  store.undo();
  assert.deepEqual(store.sketch.layers.map((l) => l.id), ['la', 'lb', 'lc']);
});

test("an older file's eraser marks are no content: a layer left with only them goes, and they go with it", () => {
  const store = threeLines();
  const legacy: Stroke = { id: 'er', tool: 'eraser', color: '#000', width: 20, layer: 'lb', points: [{ x: 10, y: 100 }, { x: 20, y: 100 }] };
  store.sketch.strokes.splice(2, 0, legacy);
  const result = eraseMarks(store.sketch, ['sb', 'er'], [rect(-10, 90, 210, 110)]);
  assert.deepEqual([...result.removed], ['sb'], 'the eraser mark is no target');
  store.eraseMarks(result);
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['sa', 'sc']);
  assert.deepEqual(store.sketch.layers.map((l) => l.id), ['la', 'lc']);
});

test("an older file's eraser marks ride along with their layer's selection, but are not counted", () => {
  const store = threeLines();
  store.sketch.strokes.splice(2, 0, { id: 'er', tool: 'eraser', color: '#000', width: 20, layer: 'lb', points: [{ x: 10, y: 100 }, { x: 20, y: 100 }] });
  store.selectLayer('lb');
  assert.deepEqual([...store.selectedIds].sort(), ['er', 'sb'], 'a move takes the cut with the mark');
  assert.equal(store.selectedMarkCount, 1, 'one mark is selected');
});

test('a mark the geometry could not cut keeps an eraser mark just above it on its layer', () => {
  const store = threeLines();
  const eraser: Stroke = { id: 'st_new', tool: 'eraser', color: '#000', width: 10, points: [{ x: 100, y: 0 }, { x: 100, y: 200 }] };
  store.eraseMarks({ changed: new Map(), removed: new Set() }, [{ above: 'sb', eraser }]);
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['sa', 'sb', 'st_new', 'sc']);
  assert.equal(store.sketch.strokes[2].layer, 'lb');
});

test('an erase that changes nothing adds no undo step', () => {
  const store = threeLines();
  store.eraseMarks({ changed: new Map(), removed: new Set() });
  assert.equal(store.canUndo, false);
});
