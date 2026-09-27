/**
 * What one step of the history changed on a page (`src/core/history-diff.ts`),
 * on pages built by hand: marks added, removed and changed by id, the paint
 * order when it moved, and each thing that can happen to a layer row - made,
 * taken away, renamed, moved between groups, its properties changed, the
 * stack reordered. A diff holds copies, so a later edit cannot change a step
 * already recorded. The comparison is the store's own: a key holding
 * `undefined` counts as absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, isEmptyDiff, sameData, type PageState } from '../src/core/history-diff.js';
import type { Layer, Stroke } from '../src/core/types.js';

function mark(id: string, layer: string, x = 10, extra: Partial<Stroke> = {}): Stroke {
  return { id, tool: 'pen', color: '#1f2328', width: 3, layer, points: [{ x, y: 10 }, { x: x + 50, y: 40 }], ...extra };
}

function row(id: string, name = id, extra: Partial<Layer> = {}): Layer {
  return { id, name, opacity: 1, visible: true, locked: false, ...extra };
}

/** A page of two layers in a group and a third at the top, with a mark on each drawing layer. */
function page(): PageState {
  return {
    layers: [row('a', 'Arm', { parent: 'g' }), row('b', 'Body', { parent: 'g' }), row('g', 'Figure', { group: true }), row('n', 'Note')],
    strokes: [mark('s1', 'a', 10), mark('s2', 'b', 20), mark('s3', 'n', 30)],
  };
}

/** A deep copy to edit, as the store's snapshot is. */
function edited(change: (state: { layers: Layer[]; strokes: Stroke[] }) => void): PageState {
  const state = structuredClone(page()) as { layers: Layer[]; strokes: Stroke[] };
  change(state);
  return state;
}

test('the same page twice changed nothing', () => {
  const diff = diffSnapshots(page(), page());
  assert.ok(isEmptyDiff(diff));
  assert.deepEqual(diff, { added: [], removed: [], changed: [], was: {}, layers: [] });
});

test('a key holding undefined is no key at all, as the store has always compared', () => {
  assert.ok(sameData({ a: 1, b: undefined }, { a: 1 }));
  assert.ok(sameData([{ p: { x: 1 } }], [{ p: { x: 1 } }]));
  assert.ok(!sameData({ a: 1 }, { a: 2 }));
  assert.ok(!sameData([1, 2], [1, 2, 3]));
  assert.ok(!sameData({ a: [1] }, { a: { 0: 1 } }));
  const before = page();
  const after = edited((state) => {
    (state.strokes[0] as Stroke & { opacity?: number }).opacity = undefined;
  });
  assert.ok(isEmptyDiff(diffSnapshots(before, after)), 'an emptied key changes no mark');
});

test('marks added, removed and changed are found by id, each as a copy', () => {
  const before = page();
  const after = edited((state) => {
    state.strokes.splice(1, 1); // s2 goes
    state.strokes[0].color = '#c0392b'; // s1 changes
    state.strokes.push(mark('s4', 'n', 40)); // s4 arrives
  });
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.added.map((s) => s.id), ['s4']);
  assert.deepEqual(diff.removed.map((s) => s.id), ['s2']);
  assert.deepEqual(diff.changed.map((s) => s.id), ['s1']);
  assert.equal(diff.changed[0].color, '#c0392b', 'a changed mark as it is after the step');
  assert.deepEqual(diff.was, { s1: { color: '#1f2328' } }, 'and what the step changed, as it was');
  assert.equal(diff.removed[0].color, '#1f2328', 'a removed mark as it was before');
  assert.equal(diff.order, undefined, 'marks coming and going is not a change of order');
  assert.deepEqual(diff.layers, []);

  (after.strokes[0] as Stroke).color = '#000000';
  (after.strokes[1] as Stroke).points[0].x = 999;
  assert.equal(diff.changed[0].color, '#c0392b', 'a later edit does not reach a recorded step');
  assert.equal(diff.added[0].points[0].x, 40);
});

test('a mark moved to another layer is a changed mark', () => {
  const diff = diffSnapshots(page(), edited((state) => (state.strokes[2].layer = 'a')));
  assert.deepEqual(diff.changed.map((s) => [s.id, s.layer]), [['s3', 'a']]);
  assert.deepEqual(diff.was, { s3: { layer: 'n' } });
  assert.deepEqual(diff.layers, []);
});

test('a property a step gave a mark, or took from it, was null or its value before', () => {
  const before = edited((state) => (state.strokes[1].fill = '#ffe08a'));
  const after = edited((state) => {
    state.strokes[0].opacity = 0.5; // given
    state.strokes[1].points[1].x = 99; // moved, and its fill taken away (edited() starts from a page with none)
  });
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.was, {
    s1: { opacity: null },
    s2: { points: before.strokes[1].points, fill: '#ffe08a' },
  });
  assert.equal((diff.changed[1] as Stroke & { fill?: string }).fill, undefined, 'the change itself has no fill');
});

test('marks put in another order give the whole order after', () => {
  const diff = diffSnapshots(page(), edited((state) => state.strokes.reverse()));
  assert.deepEqual(diff.order, ['s3', 's2', 's1']);
  assert.deepEqual([diff.added, diff.removed, diff.changed], [[], [], []]);
  assert.ok(!isEmptyDiff(diff));
});

test('every change to a layer row is named, and a new row says where it sits', () => {
  const before = page();
  const after = edited((state) => {
    state.layers[0].name = 'Left arm'; // rename a
    state.layers[1].parent = undefined; // b leaves the group
    state.layers[3].opacity = 0.5; // n's props
    state.layers[3].locked = true;
    state.layers.splice(2, 0, row('x', 'Extra', { parent: 'g', effects: [{ type: 'blur', radius: 2 }] }));
  });
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.layers, [
    { op: 'rename', id: 'a', from: 'Arm', to: 'Left arm' },
    { op: 'reparent', id: 'b', from: 'g', to: null },
    { op: 'add', layer: after.layers[2], index: 2 },
    { op: 'props', id: 'n', props: { opacity: 0.5, locked: true }, was: { opacity: 1, locked: false } },
  ]);
  assert.notEqual((diff.layers[2] as { layer: Layer }).layer, after.layers[2], 'the new row is a copy');
});

test('a row taken away is kept as it was, and a property that went is null', () => {
  const before = edited((state) => (state.layers[3].effects = [{ type: 'blur', radius: 2 }]));
  const after = edited((state) => state.layers.splice(0, 1));
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.layers, [
    { op: 'props', id: 'n', props: { effects: null }, was: { effects: [{ type: 'blur', radius: 2 }] } },
    { op: 'remove', layer: before.layers[0] },
  ]);
});

test('rows put in another order give the whole stack after, bottom first', () => {
  const diff = diffSnapshots(page(), edited((state) => state.layers.push(state.layers.shift() as Layer)));
  assert.deepEqual(diff.layers, [{ op: 'restack', order: ['b', 'g', 'n', 'a'] }]);
  const grown = diffSnapshots(page(), edited((state) => state.layers.push(row('z'))));
  assert.deepEqual(grown.layers.map((change) => change.op), ['add'], 'a row added on top moves no other');
});
