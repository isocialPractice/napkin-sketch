/**
 * Clipping masks (src/core/clip.ts): a group whose content shows only inside
 * the closed mark on top - made and released on the store in one undo step
 * each, the clip's region, what a point outside it picks, the boxes of what
 * it shows, a clip in a clip, and a file's clip kept or dropped as it names a
 * closed mark in its group or not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canClip, clipIndex, clipMarkOf, clipRegionOf, clippedAt, makeClip, normalizeClips, releaseClip, shownBounds } from '../src/core/clip.js';
import { hitMark, marksInBox } from '../src/core/hit-test.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { createSketchBook, layerOf, type Layer, type Point, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

const pts = (list: Array<{ x: number; y: number }>): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 }));

/** A filled rectangle of bare points, closed on its first corner. */
const rect = (id: string, x0: number, y0: number, x1: number, y1: number, fill = '#27486d'): Stroke => ({
  id,
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill,
  points: pts([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]),
});

/** A circle of 64 points, closed, an outline with no fill. */
const circle = (id: string, cx: number, cy: number, r: number): Stroke => {
  const ring = Array.from({ length: 64 }, (_, i) => ({ x: cx + r * Math.cos((i / 64) * Math.PI * 2), y: cy + r * Math.sin((i / 64) * Math.PI * 2) }));
  return { id, tool: 'pen', color: '#d0342c', width: 3, points: pts([...ring, ring[0]]) };
};

/** A store of these marks, each on a layer of its own, the first at the bottom. */
function storeOf(...strokes: Stroke[]): Store {
  const book = createSketchBook('t');
  const sketch = book.sketches[0];
  sketch.layers = strokes.map((s, i): Layer => ({ id: `ly_${s.id}`, name: `Layer ${i + 1}`, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes.map((s) => ({ ...s, layer: `ly_${s.id}` }));
  return new Store(book);
}

/** A rectangle under a circle in its middle, clipped. */
function clipped(): Store {
  const store = storeOf(rect('r', 0, 0, 200, 200), circle('c', 100, 100, 50));
  assert.equal(store.makeClipping(['r', 'c']), null);
  return store;
}

test('what Make Clipping Mask does with a selection: the topmost clips when it is closed', () => {
  const store = storeOf(rect('r', 0, 0, 200, 200), circle('c', 100, 100, 50), { id: 'l', tool: 'pen', color: '#000', width: 2, points: pts([{ x: 0, y: 0 }, { x: 50, y: 50 }]) });
  const plan = makeClip(store.sketch, ['r', 'c']);
  assert.ok('clip' in plan);
  assert.equal(plan.clip.id, 'c');
  assert.deepEqual(plan.layers, ['ly_r', 'ly_c']);
  assert.deepEqual(makeClip(store.sketch, ['c']), { problem: 'too-few' });
  assert.deepEqual(makeClip(store.sketch, ['r', 'l']), { problem: 'open' }, 'an open line on top');
  assert.equal(canClip(circle('x', 0, 0, 5)), true);
  assert.equal(canClip({ id: 't', tool: 'text', color: '#000', width: 1, text: 'Hi', points: pts([{ x: 0, y: 0 }]) }), false);
});

test('Make groups the layers into a Clip Group, the clip on top inside it, in one undo step', () => {
  const store = clipped();
  const layers = store.sketch.layers;
  const group = layers.find((l) => l.group)!;
  assert.equal(group.name, 'Clip Group');
  assert.equal(group.clip, 'c');
  const children = layers.filter((l) => l.parent === group.id);
  assert.deepEqual(children.map((l) => l.id), ['ly_r', 'ly_c'], 'the clip\'s layer on top inside it');
  assert.equal(layers.indexOf(group), layers.length - 1, 'the group row above its children');
  assert.equal(clipMarkOf(store.sketch, group)?.id, 'c');
  store.undo();
  assert.equal(store.sketch.layers.some((l) => l.group), false, 'one undo takes it back');
});

test('a clip on the bottom of the selection is moved up: the topmost mark is the clip, wherever its layer was', () => {
  const store = storeOf(circle('c', 100, 100, 50), rect('r', 0, 0, 200, 200));
  // Painted last, the rectangle is the one on top here: it clips.
  assert.equal(store.makeClipping(['c', 'r']), null);
  const group = store.sketch.layers.find((l) => l.group)!;
  assert.equal(group.clip, 'r');
  assert.deepEqual(store.sketch.layers.filter((l) => l.parent === group.id).map((l) => l.id), ['ly_c', 'ly_r']);
});

test('Release takes the clip off, from the group or anything in it; the group stays a group', () => {
  const store = clipped();
  const group = store.sketch.layers.find((l) => l.group)!;
  assert.equal(releaseClip(store.sketch, 'ly_r')?.id, group.id, 'from a layer inside');
  assert.equal(releaseClip(store.sketch, group.id)?.id, group.id, 'from the group');
  assert.equal(store.releaseClipping('ly_r'), true);
  assert.equal(store.sketch.layers.find((l) => l.id === group.id)?.clip, undefined);
  assert.equal(store.sketch.layers.find((l) => l.id === group.id)?.group, true, 'still a group');
  assert.equal(store.releaseClipping('ly_r'), false, 'nothing left to release');
  store.undo();
  assert.equal(store.sketch.layers.find((l) => l.id === group.id)?.clip, 'c', 'one undo puts the clip back');
});

test('the clip\'s region, and what it shows: inside the circle the rectangle, outside nothing, the circle itself nowhere', () => {
  const store = clipped();
  const sketch = store.sketch;
  const group = sketch.layers.find((l) => l.group)!;
  const region = clipRegionOf(sketch, group)!;
  assert.equal(region.length, 1);
  assert.equal(region[0].length, 65);
  const r = sketch.strokes.find((s) => s.id === 'r')!;
  const c = sketch.strokes.find((s) => s.id === 'c')!;
  assert.equal(clippedAt(sketch, r, { x: 100, y: 100 }), false);
  assert.equal(clippedAt(sketch, r, { x: 10, y: 10 }), true);
  assert.equal(clippedAt(sketch, c, { x: 100, y: 100 }), true, 'the clip mark paints nothing while it clips');
  const box = shownBounds(sketch, r, { minX: 0, minY: 0, maxX: 200, maxY: 200 })!;
  assert.ok(Math.abs(box.minX - 50) < 0.5 && Math.abs(box.maxX - 150) < 0.5, JSON.stringify(box));
  assert.equal(shownBounds(sketch, r, { minX: 0, minY: 0, maxX: 20, maxY: 20 }), null, 'a part the clip hides shows nowhere');
});

test('a press picks what shows: the rectangle inside the circle, nothing outside it, through the clip with Direct Select', () => {
  const sketch = clipped().sketch;
  const pick = (x: number, y: number, ignoreClips = false) => hitMark(sketch, { x, y }, { zoom: 1, tolerancePx: 4, ignoreClips })?.id ?? null;
  assert.equal(pick(100, 100), 'r');
  assert.equal(pick(10, 10), null, 'outside the clip there is nothing to pick');
  assert.equal(pick(10, 10, true), 'r', 'Direct Select reaches it');
  assert.equal(pick(150, 100, true) !== null, true);
  const band = (minX: number, minY: number, maxX: number, maxY: number) => marksInBox(sketch, { minX, minY, maxX, maxY }).map((s) => s.id);
  assert.deepEqual(band(0, 0, 30, 30), [], 'a band over what the clip hides takes nothing');
  assert.deepEqual(band(90, 90, 110, 110), ['r'], 'over what shows, the rectangle - and never the clip mark');
});

test('a clip in a clip: what shows is inside both', () => {
  const store = storeOf(rect('r', 0, 0, 200, 200), circle('a', 80, 100, 50), circle('b', 130, 100, 50));
  assert.equal(store.makeClipping(['r', 'a']), null);
  const first = store.sketch.layers.find((l) => l.group)!;
  // The first clip group's marks and the second circle, clipped again by it:
  // the new group goes where the first of them was, inside the first group.
  assert.equal(store.makeClipping(['r', 'a', 'b']), null);
  const sketch = store.sketch;
  const second = sketch.layers.find((l) => l.group && l.id !== first.id)!;
  assert.equal(second.clip, 'b');
  assert.equal(second.parent, first.id);
  assert.equal(first.clip, 'a', 'its clip mark still inside it');
  const r = sketch.strokes.find((s) => s.id === 'r')!;
  assert.equal(clipIndex(sketch).of(layerOf(sketch, r)).length, 2, 'two clips above the rectangle');
  assert.equal(clippedAt(sketch, r, { x: 105, y: 100 }), false, 'in both circles');
  assert.equal(clippedAt(sketch, r, { x: 60, y: 100 }), true, 'in the first only');
  assert.equal(clippedAt(sketch, r, { x: 170, y: 100 }), true, 'in the second only');
});

test('a file keeps a clip that names a closed mark in its group, and drops one that does not', () => {
  const store = clipped();
  const book = parseSketchBook(serializeSketchBook(store.book));
  assert.equal(book.sketches[0].layers.find((l) => l.group)?.clip, 'c', 'kept');
  const sketch = book.sketches[0];
  const group = sketch.layers.find((l) => l.group)!;
  group.clip = 'nothing';
  assert.equal(normalizeClips(sketch), true);
  assert.equal(group.clip, undefined, 'naming no mark');
  group.clip = 'r';
  sketch.strokes.find((s) => s.id === 'r')!.layer = 'ly_elsewhere';
  assert.equal(normalizeClips(sketch), true);
  assert.equal(group.clip, undefined, 'a mark outside the group');
  const reread = parseSketchBook(JSON.stringify({ ...JSON.parse(serializeSketchBook(store.book)), sketches: [{ ...store.book.sketches[0], layers: store.book.sketches[0].layers.map((l) => (l.group ? { ...l, clip: 'r' } : { ...l, clip: 'c' })) }] }));
  assert.equal(reread.sketches[0].layers.find((l) => !l.group && l.clip !== undefined), undefined, 'only a group clips');
  assert.equal(reread.sketches[0].layers.find((l) => l.group)?.clip, 'r', 'any closed mark inside will do');
});
