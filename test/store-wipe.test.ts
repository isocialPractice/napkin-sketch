/**
 * A wipe applied to the page (`Store.applyMarkEdit`): one undo step, each
 * changed mark replaced where it was, each added mark on a new layer of its
 * own right above the layer it names - in the same group, looking as that
 * layer does - the layers left empty pruned, and the selection the result.
 * `Store.eraseMarks` is built on it, and store-erase.test.ts holds it still.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSketchBook, type Layer, type Stroke } from '../src/core/types.js';
import { stackArrangement, stackEdit, wipeMarks } from '../src/core/wipe.js';
import { Store } from '../src/renderer/store.js';

const square = (id: string, x0: number, y0: number, x1: number, y1: number, fill: string): Stroke => ({
  id,
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ],
});

/** A store of these marks, each on a layer of its own - the last two in a group - the first at the bottom. */
function storeOf(...strokes: Stroke[]): Store {
  const book = createSketchBook('t');
  const sketch = book.sketches[0];
  const layers: Layer[] = strokes.map((s, i) => ({ id: `ly_${s.id}`, name: `Layer ${i + 1}`, opacity: 1, visible: true, locked: false }));
  sketch.layers = layers;
  sketch.strokes = strokes.map((s) => ({ ...s, layer: `ly_${s.id}` }));
  return new Store(book);
}

test('Clean Wipe on the page: one undo step, the faces on layers of their own above their square\'s', () => {
  const store = storeOf(square('a', 0, 0, 100, 100, '#d0342c'), square('b', 50, 50, 150, 150, '#27486d'), square('z', 300, 300, 310, 310, '#000000'));
  store.sketch.layers[1].opacity = 0.5;
  store.setSelection(['a', 'b']);
  const edit = wipeMarks(store.sketch, ['a', 'b'], 'clean');
  store.applyMarkEdit(edit);

  assert.equal(store.sketch.strokes.length, 4, 'three faces and the square left out');
  assert.deepEqual(
    store.sketch.strokes.slice(0, 2).map((s) => [s.id, s.layer]),
    [
      ['a', 'ly_a'],
      ['b', 'ly_b'],
    ],
    'each square keeps its id and layer, in its place',
  );
  const added = store.sketch.strokes.find((s) => s.id !== 'a' && s.id !== 'b' && s.id !== 'z')!;
  const names = store.sketch.layers.map((l) => l.name);
  const at = store.sketch.layers.findIndex((l) => l.id === added.layer);
  assert.equal(store.sketch.layers[at - 1].id, 'ly_b', 'right above the layer it names');
  assert.equal(names[at], 'Brush 1', 'named for its tool');
  assert.equal(store.sketch.layers[at].opacity, 0.5, 'looking as the layer it came from');
  assert.deepEqual([...store.selectedIds].sort(), [added.id, 'a', 'b'].sort(), 'the selection is the result');

  store.undo();
  assert.equal(store.sketch.strokes.length, 3);
  assert.equal(store.sketch.layers.length, 3);
  assert.equal(store.canUndo, false, 'one step');
});

test('Wipe In on the page: the bottom square and its layer go, and nothing else', () => {
  const store = storeOf(square('a', 0, 0, 100, 100, '#d0342c'), square('b', 50, 50, 150, 150, '#27486d'));
  store.applyMarkEdit(wipeMarks(store.sketch, ['a', 'b'], 'in'));
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['b']);
  assert.deepEqual(store.sketch.layers.map((l) => l.id), ['ly_b'], 'the layer left empty is pruned');
  assert.deepEqual([...store.selectedIds], ['b']);
});

test('added marks go in above their layer inside its group, in the order given', () => {
  const store = storeOf(square('a', 0, 0, 100, 100, '#d0342c'), square('b', 50, 50, 150, 150, '#27486d'));
  store.sketch.layers.push({ id: 'gp', name: 'Group', opacity: 1, visible: true, locked: false, group: true });
  for (const layer of store.sketch.layers.slice(0, 2)) layer.parent = 'gp';
  const one = square('n1', 0, 0, 5, 5, '#000000');
  const two = square('n2', 0, 0, 5, 5, '#000000');
  store.applyMarkEdit({ changed: new Map(), removed: new Set(), added: [
    { stroke: one, above: 'ly_a' },
    { stroke: two, above: 'ly_a' },
  ] });
  const order = store.sketch.layers.map((l) => l.id);
  const of = (id: string) => store.sketch.strokes.find((s) => s.id === id)!.layer!;
  assert.deepEqual(order.slice(0, 3), ['ly_a', of('n1'), of('n2')], 'the first given lowest, both above their layer');
  assert.ok(store.sketch.layers.filter((l) => l.id === of('n1') || l.id === of('n2')).every((l) => l.parent === 'gp'), 'in the same group');
});

test('an edit that changes nothing makes no step', () => {
  const store = storeOf(square('a', 0, 0, 10, 10, '#d0342c'));
  store.applyMarkEdit({ changed: new Map(), removed: new Set(), added: [] });
  assert.equal(store.canUndo, false);
});

test('a stack kept in the selection: what it changed stays selected with the rest, and what it added joins them', () => {
  const store = storeOf(square('a', 0, 0, 100, 100, '#d0342c'), square('b', 50, 50, 150, 150, '#27486d'), square('z', 300, 300, 310, 310, '#000000'));
  store.setSelection(['a', 'b', 'z']);
  const arrangement = stackArrangement(store.sketch, ['a', 'b', 'z']);
  // A click on the overlap of a and b: a shape of its own, painted as b.
  const overlap = arrangement.faces.findIndex((f) => f.covers.join() === '0,1');
  store.applyMarkEdit(stackEdit(store.sketch, arrangement, [overlap], 'merge'), { select: 'keep' });
  assert.equal(store.sketch.strokes.length, 4);
  const added = store.sketch.strokes.find((s) => !['a', 'b', 'z'].includes(s.id))!;
  assert.equal(added.fill, '#27486d');
  assert.deepEqual([...store.selectedIds].sort(), ['a', 'b', 'z', added.id].sort(), 'the square z, which the stack never touched, stays selected too');
  store.undo();
  assert.equal(store.sketch.strokes.length, 3, 'one undo step');
});
