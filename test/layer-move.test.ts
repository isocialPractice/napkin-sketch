/**
 * Restacking to the end: Ctrl+Shift+] and Ctrl+Shift+[ carry a block to the
 * top or the bottom of its siblings in one step, where Ctrl+] and Ctrl+[ step
 * once. The rules of a step still hold - a block stays in its group and keeps
 * its place among the other blocks moving with it - and the whole trip is one
 * undo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSketchBook, type Layer, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

function stroke(id: string, layer: string): Stroke {
  return { id, tool: 'pen', color: '#000', width: 3, layer, points: [{ x: 0, y: 0 }] };
}

function layer(id: string, name: string, extra: Partial<Layer> = {}): Layer {
  return { id, name, opacity: 1, visible: true, locked: false, ...extra };
}

/** Six plain layers, bottom of the stack first. */
function sixLayers(): Store {
  const store = new Store(createSketchBook('t'));
  store.sketch.layers = ['1', '2', '3', '4', '5', '6'].map((n) => layer(`l${n}`, `Layer ${n}`));
  store.sketch.strokes = store.sketch.layers.map((l) => stroke(`s${l.id}`, l.id));
  return store;
}

/** The stack, bottom first, as ids. */
function stack(store: Store): string[] {
  return store.sketch.layers.map((l) => l.id);
}

test('to the top and to the bottom go all the way in one step', () => {
  const store = sixLayers();
  assert.equal(store.moveLayers(['l2'], 1, true), true);
  assert.deepEqual(stack(store), ['l1', 'l3', 'l4', 'l5', 'l6', 'l2']);
  assert.equal(store.moveLayers(['l5'], -1, true), true);
  assert.deepEqual(stack(store), ['l5', 'l1', 'l3', 'l4', 'l6', 'l2']);
});

test('a block already at the end has nowhere to go, and says so', () => {
  const store = sixLayers();
  assert.equal(store.moveLayers(['l6'], 1, true), false);
  assert.equal(store.moveLayers(['l1'], -1, true), false);
  assert.deepEqual(stack(store), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
});

test('two rows travel to the end together and keep their own order', () => {
  const store = sixLayers();
  assert.equal(store.moveLayers(['l2', 'l4'], 1, true), true);
  assert.deepEqual(stack(store), ['l1', 'l3', 'l5', 'l6', 'l2', 'l4']);
  assert.equal(store.moveLayers(['l2', 'l4'], -1, true), true);
  assert.deepEqual(stack(store), ['l2', 'l4', 'l1', 'l3', 'l5', 'l6']);
});

test('a layer in a group goes to the end of its group, not of the stack', () => {
  const store = new Store(createSketchBook('t'));
  store.sketch.layers = [
    layer('l1', 'Layer 1'),
    layer('g', 'Group', { group: true }),
    layer('a', 'A', { parent: 'g' }),
    layer('b', 'B', { parent: 'g' }),
    layer('c', 'C', { parent: 'g' }),
    layer('l2', 'Layer 2'),
  ];
  store.sketch.strokes = ['l1', 'a', 'b', 'c', 'l2'].map((id) => stroke(`s${id}`, id));
  assert.equal(store.moveLayers(['a'], 1, true), true);
  assert.deepEqual(stack(store), ['l1', 'g', 'b', 'c', 'a', 'l2']);
  assert.equal(store.moveLayers(['c'], -1, true), true);
  assert.deepEqual(stack(store), ['l1', 'g', 'c', 'b', 'a', 'l2']);
});

test('the trip to the end is one undo step', () => {
  const store = sixLayers();
  assert.equal(store.moveLayers(['l1'], 1, true), true);
  assert.deepEqual(stack(store), ['l2', 'l3', 'l4', 'l5', 'l6', 'l1']);
  store.undo();
  assert.deepEqual(stack(store), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
});

test('one step is still one step', () => {
  const store = sixLayers();
  assert.equal(store.moveLayers(['l2'], 1), true);
  assert.deepEqual(stack(store), ['l1', 'l3', 'l2', 'l4', 'l5', 'l6']);
});
