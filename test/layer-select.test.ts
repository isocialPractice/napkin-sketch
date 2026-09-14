/**
 * Layer panel selection: the two modifiers, and the order a range is drawn on.
 *
 * The modifiers themselves are a click handler and belong to the renderer, but
 * what they call is here, and the part worth pinning down is which rows a range
 * covers. The layer array is the paint order with every group's children
 * inlined, so a range taken on it and a range taken on the panel are the same
 * thing only while nothing is folded shut - and it is exactly when something is
 * folded shut that the difference matters.
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

/** Six plain layers, bottom of the stack first - the user's own example. */
function sixLayers(): Store {
  const store = new Store(createSketchBook('t'));
  store.sketch.layers = ['1', '2', '3', '4', '5', '6'].map((n) => layer(`l${n}`, `Layer ${n}`));
  store.sketch.strokes = store.sketch.layers.map((l) => stroke(`s${l.id}`, l.id));
  return store;
}

/** The panel shows the stack top row first, so its order is the reverse. */
function panelOrder(store: Store): string[] {
  return store.sketch.layers.map((l) => l.id).reverse();
}

test('Ctrl-click picks rows out one at a time and leaves the rest alone', () => {
  const store = sixLayers();
  store.selectLayer('l1');
  store.selectLayer('l4', true);
  store.selectLayer('l6', true);
  assert.deepEqual([...store.selectedLayerIds].sort(), ['l1', 'l4', 'l6']);

  // Additive is a toggle, not an add: the same row again takes it back out.
  store.selectLayer('l4', true);
  assert.deepEqual([...store.selectedLayerIds].sort(), ['l1', 'l6']);
  // And the active row follows the last one still in the selection.
  assert.ok(store.selectedLayerIds.has(store.activeLayerId));
});

test('Shift-click takes everything between the last row and this one', () => {
  const store = sixLayers();
  store.selectLayer('l1');
  store.selectLayerRange('l6', panelOrder(store));
  assert.deepEqual(
    [...store.selectedLayerIds].sort(),
    ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
  );
  // Every stroke on those layers comes with them: a lit row is its elements.
  assert.equal(store.selectedIds.size, 6);

  // The range runs both ways - the anchor is wherever the last click left it.
  store.selectLayer('l5');
  store.selectLayerRange('l3', panelOrder(store));
  assert.deepEqual([...store.selectedLayerIds].sort(), ['l3', 'l4', 'l5']);
});

test('a range covers the rows the panel is showing, not the ones folded away', () => {
  // A group of three between two plain layers. Folded shut, the panel shows
  // three rows; the layer array still holds six.
  const store = new Store(createSketchBook('t'));
  store.sketch.layers = [
    layer('bottom', 'Bottom'),
    layer('a', 'Head', { parent: 'grp' }),
    layer('b', 'Body', { parent: 'grp' }),
    layer('c', 'Legs', { parent: 'grp' }),
    layer('grp', 'Frame 1', { group: true }),
    layer('top', 'Top'),
  ];
  const visible = ['top', 'grp', 'bottom'];

  store.selectLayer('top');
  store.selectLayerRange('bottom', visible);
  assert.deepEqual([...store.selectedLayerIds].sort(), ['bottom', 'grp', 'top']);

  // The group's children are not selected rows, but their strokes still come
  // along, because selecting a group means selecting what is inside it.
  store.sketch.strokes = [stroke('s1', 'a')];
  store.selectLayer('grp');
  assert.deepEqual([...store.selectedIds], ['s1']);

  // Without the panel order the same click sweeps up all three hidden rows -
  // the behaviour this parameter exists to replace.
  store.selectLayer('top');
  store.selectLayerRange('bottom');
  assert.equal(store.selectedLayerIds.size, 6);
});

test('a range with no anchor yet is just a click', () => {
  const store = sixLayers();
  store.activeLayerId = 'gone';
  store.selectLayerRange('l3', panelOrder(store));
  assert.deepEqual([...store.selectedLayerIds], ['l3']);
});

test('a range onto a row that is not on screen selects nothing', () => {
  // The row was folded away between the render and the click. Doing nothing
  // beats selecting a range whose far end nobody can see.
  const store = sixLayers();
  store.selectLayer('l1');
  store.selectLayerRange('l4', ['l6', 'l5', 'l1']);
  assert.deepEqual([...store.selectedLayerIds], ['l1']);
});
