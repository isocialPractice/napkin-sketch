/**
 * A mark's two paints (src/core/paint.ts): what a color picked with the fill
 * or the stroke in front does to one mark, and Swap Fill and Stroke; and the
 * store applying both to the selection in one undo step. The GUI checks
 * `check-fill-stroke.mjs` and `check-color-picker.mjs` drive the same rules
 * in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paintPatch, swapPaint, COLOR_TARGETS } from '../src/core/paint.js';
import { createSketchBook, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

const INK = '#1f2328';
const RED = '#d0342c';
const GOLD = '#e9c46a';

/** A 40 px square, closed: its last point is its first. */
function square(id: string, patch: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    color: INK,
    width: 3,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 0 },
    ],
    ...patch,
  };
}

/** An open line across the page. */
function line(id: string, patch: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    color: INK,
    width: 3,
    points: [
      { x: 0, y: 100 },
      { x: 60, y: 120 },
      { x: 120, y: 100 },
    ],
    ...patch,
  };
}

const text = (id: string): Stroke => ({ id, tool: 'text', color: INK, width: 1, text: 'Hi', fontSize: 24, points: [{ x: 0, y: 200 }] });
const image = (id: string): Stroke => ({ id, tool: 'image', color: INK, width: 1, image: 'data:image/png;base64,', imageWidth: 10, imageHeight: 10, points: [{ x: 0, y: 300 }] });

test('the stroke is the default target, then the fill', () => {
  assert.deepEqual([...COLOR_TARGETS], ['stroke', 'fill']);
});

test('with the stroke in front, a color recolors an outline and turns it on', () => {
  assert.deepEqual(paintPatch(square('a'), 'stroke', RED), { color: RED, noStroke: undefined });
  assert.deepEqual(paintPatch(line('b'), 'stroke', RED), { color: RED, noStroke: undefined });
  assert.deepEqual(paintPatch(square('c', { fill: GOLD, noStroke: true }), 'stroke', RED), { color: RED, noStroke: undefined }, 'a fill-only shape gains an outline');
});

test('with the fill in front, a color fills a closed shape in place of its gradient, and leaves an open line alone', () => {
  assert.deepEqual(paintPatch(square('a'), 'fill', GOLD), { fill: GOLD, gradient: undefined });
  const gradient = { type: 'linear' as const, stops: [{ offset: 0, color: RED }, { offset: 1, color: GOLD }] };
  assert.deepEqual(paintPatch(square('b', { gradient }), 'fill', GOLD), { fill: GOLD, gradient: undefined });
  assert.equal(paintPatch(line('c'), 'fill', GOLD), null);
});

test('text takes the color with either in front; a picture, a link and an old eraser mark take none', () => {
  assert.deepEqual(paintPatch(text('t'), 'stroke', RED), { color: RED });
  assert.deepEqual(paintPatch(text('t'), 'fill', RED), { color: RED });
  assert.equal(paintPatch(image('i'), 'stroke', RED), null);
  assert.equal(paintPatch(line('l', { link: { href: 'a.svg', kind: 'svg' } as Stroke['link'] }), 'stroke', RED), null);
  assert.equal(paintPatch(line('e', { tool: 'eraser' }), 'stroke', RED), null);
});

test('Swap Fill and Stroke trades a closed shape\'s two colors', () => {
  assert.deepEqual(swapPaint(square('a', { fill: GOLD })), { fill: INK, color: GOLD, noStroke: undefined });
});

test('a shape with no fill ends with no outline, and one with no outline with no fill', () => {
  assert.deepEqual(swapPaint(square('a')), { fill: INK, noStroke: true });
  assert.deepEqual(swapPaint(square('b', { fill: GOLD, noStroke: true })), { fill: undefined, color: GOLD, noStroke: undefined });
});

test('nothing to swap: an open line, text, a gradient, a shape with neither paint', () => {
  assert.equal(swapPaint(line('a')), null);
  assert.equal(swapPaint(text('t')), null);
  assert.equal(swapPaint(square('g', { gradient: { type: 'radial', stops: [{ offset: 0, color: RED }, { offset: 1, color: GOLD }] } })), null);
  assert.equal(swapPaint(square('n', { noStroke: true })), null);
});

// ---- The store ------------------------------------------------------------------

function storeWith(...strokes: Stroke[]): Store {
  const book = createSketchBook('t');
  const sketch = book.sketches[0];
  sketch.layers = strokes.map((s, i) => ({ id: `ly${i}`, name: `Layer ${i + 1}`, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes.map((s, i) => ({ ...s, layer: `ly${i}` }));
  return new Store(book);
}

test('the selection painted with the stroke in front: every outline and text, one undo step', () => {
  const store = storeWith(square('a'), line('b'), text('t'), image('i'));
  store.setSelection(['a', 'b', 't', 'i']);
  assert.deepEqual(store.paintSelected('stroke', RED), { filled: 0, recolored: 3 });
  assert.deepEqual(
    store.sketch.strokes.map((s) => s.color),
    [RED, RED, RED, INK],
  );
  store.undo();
  assert.ok(store.sketch.strokes.every((s) => s.color === INK));
  assert.equal(store.canUndo, false);
});

test('the selection painted with the fill in front: the closed shape filled, the text recolored, the line left', () => {
  const store = storeWith(square('a'), line('b'), text('t'));
  store.setSelection(['a', 'b', 't']);
  assert.deepEqual(store.paintSelected('fill', GOLD), { filled: 1, recolored: 1 });
  const [a, b, t] = store.sketch.strokes;
  assert.equal(a.fill, GOLD);
  assert.equal(a.color, INK, 'its outline kept');
  assert.equal(b.fill, undefined);
  assert.equal(t.color, GOLD);
});

test('a picker drag is one undo step, and a pick that reaches nothing makes none', () => {
  const store = storeWith(square('a'), line('b'));
  store.setSelection(['a']);
  store.paintSelected('fill', RED);
  store.paintSelected('fill', GOLD, false);
  assert.equal(store.sketch.strokes[0].fill, GOLD);
  store.undo();
  assert.equal(store.sketch.strokes[0].fill, undefined);
  store.setSelection(['b']);
  assert.deepEqual(store.paintSelected('fill', RED), { filled: 0, recolored: 0 });
  assert.equal(store.canUndo, false, 'an open line alone gives the fill nothing to paint');
});

test('Swap Fill and Stroke on the selection: the closed shapes swap, in one step', () => {
  const store = storeWith(square('a', { fill: GOLD }), square('b'), line('c'));
  store.setSelection(['a', 'b', 'c']);
  assert.equal(store.swapSelectedPaint(), 2);
  const [a, b, c] = store.sketch.strokes;
  assert.deepEqual([a.fill, a.color, a.noStroke], [INK, GOLD, undefined]);
  assert.deepEqual([b.fill, b.noStroke], [INK, true]);
  assert.equal(c.fill, undefined);
  store.undo();
  assert.deepEqual([store.sketch.strokes[0].fill, store.sketch.strokes[0].color], [GOLD, INK]);
  store.setSelection(['c']);
  assert.equal(store.swapSelectedPaint(), 0, 'an open line has nothing to swap');
});
