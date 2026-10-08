/**
 * Napkin Blends on the store (`Store.setLayersBlend`, `Store.setLayersIsolate`):
 * one undo step for every layer changed, Normal taking the field away so the
 * layer is what it was, and nothing at all when nothing changes. The GUI check
 * `check-blend.mjs` drives the panel and the menus that call them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSketchBook, type Layer } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

const layer = (id: string, extra: Partial<Layer> = {}): Layer => ({ id, name: id, opacity: 1, visible: true, locked: false, ...extra });

function three(): Store {
  const store = new Store(createSketchBook('blend'));
  store.sketch.layers = [layer('a'), layer('b'), layer('g', { group: true })];
  return store;
}

test('setting the blend of several layers is one undo step', () => {
  const store = three();
  assert.equal(store.setLayersBlend(['a', 'b'], 'stack'), true);
  assert.deepEqual(store.sketch.layers.map((l) => l.blend), ['stack', 'stack', undefined]);
  store.undo();
  assert.deepEqual(store.sketch.layers.map((l) => 'blend' in l), [false, false, false], 'one undo takes both back');
});

test('Normal takes the field away, and a blend already set is no step', () => {
  const store = three();
  store.setLayersBlend(['a'], 'messy');
  assert.equal(store.setLayersBlend(['a'], 'messy'), false, 'nothing changes, so nothing is recorded');
  assert.equal(store.setLayersBlend(['a'], 'normal'), true);
  assert.equal('blend' in store.sketch.layers[0], false);
  assert.equal(store.setLayersBlend(['nobody'], 'stack'), false);
});

test('Isolate Blending is a group\'s, on and off, one step each', () => {
  const store = three();
  assert.equal(store.setLayersIsolate(['a', 'g'], true), true);
  assert.equal(store.sketch.layers[0].isolate, undefined, 'a drawing layer is passed by');
  assert.equal(store.sketch.layers[2].isolate, true);
  assert.equal(store.setLayersIsolate(['g'], true), false);
  assert.equal(store.setLayersIsolate(['g'], false), true);
  assert.equal('isolate' in store.sketch.layers[2], false);
  store.undo();
  assert.equal(store.sketch.layers[2].isolate, true);
});
