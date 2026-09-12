/**
 * Element-property tests: the gradient / stroke-style model, their `.skbk`
 * normalization, and the store operations the properties panel drives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGradient,
  createSketchBook,
  dashPatternFor,
  hasOutline,
  normalizedStops,
  type Gradient,
  type Stroke,
} from '../src/core/types.js';
import { normalizeSketchBook, serializeSketchBook, parseSketchBook } from '../src/core/serialize.js';
import { Store } from '../src/renderer/store.js';

function stroke(id: string, patch: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#1f2328',
    width: 3,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    ...patch,
  };
}

// ---- Model ------------------------------------------------------------------

test('dashPatternFor scales the pattern with the stroke width', () => {
  assert.deepEqual(dashPatternFor(undefined, 4), []);
  assert.deepEqual(dashPatternFor('solid', 4), []);
  assert.deepEqual(dashPatternFor('dashed', 4), [12, 8]);
  // A dotted line is a zero-length dash, drawn as a circle by a round cap.
  assert.deepEqual(dashPatternFor('dotted', 4), [0, 8]);
  // A hairline still gets a visible pattern.
  assert.deepEqual(dashPatternFor('dashed', 0.5), [3, 2]);
});

test('hasOutline reports the fill-only state', () => {
  assert.ok(hasOutline(stroke('a')));
  assert.ok(!hasOutline(stroke('a', { noStroke: true })));
});

test('normalizedStops sorts and clamps, and rejects a one-stop gradient', () => {
  const gradient: Gradient = {
    type: 'linear',
    stops: [
      { offset: 2, color: '#fff' },
      { offset: -1, color: '#000' },
      { offset: 0.5, color: '#f00' },
    ],
  };
  assert.deepEqual(normalizedStops(gradient), [
    { offset: 0, color: '#000' },
    { offset: 0.5, color: '#f00' },
    { offset: 1, color: '#fff' },
  ]);
  assert.equal(normalizedStops({ type: 'linear', stops: [{ offset: 0, color: '#000' }] }), null);
});

test('createGradient makes a paintable two-stop ramp from a color', () => {
  const gradient = createGradient('#123456');
  assert.equal(gradient.type, 'linear');
  assert.equal(gradient.stops[0].color, '#123456');
  assert.ok(normalizedStops(gradient));
});

// ---- Serialization ----------------------------------------------------------

test('gradient, dash style, and fill-only state survive a .skbk round trip', () => {
  const book = createSketchBook('t');
  book.sketches[0].strokes = [
    stroke('s1', {
      fill: '#eeeeee',
      gradient: { type: 'radial', stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ] },
      strokeStyle: 'dashed',
      noStroke: true,
    }),
  ];
  const read = parseSketchBook(serializeSketchBook(book));
  const out = read.sketches[0].strokes[0];
  assert.equal(out.gradient?.type, 'radial');
  assert.equal(out.gradient?.stops.length, 2);
  assert.equal(out.strokeStyle, 'dashed');
  assert.equal(out.noStroke, true);
  // The flat fill is kept alongside the gradient so removing it restores it.
  assert.equal(out.fill, '#eeeeee');
});

test('a malformed gradient is dropped rather than trusted', () => {
  const book = normalizeSketchBook({
    format: 'napkin-sketch',
    version: 3,
    name: 't',
    sketches: [
      {
        id: 'sk', name: 'p', width: 100, height: 100, background: '#fff',
        layers: [{ id: 'ly', name: 'L', opacity: 1, visible: true, locked: false }],
        strokes: [
          { ...stroke('a'), gradient: { type: 'linear', stops: [{ offset: 0, color: '#000' }] } },
          { ...stroke('b'), gradient: { type: 'linear', stops: 'nope' } },
          { ...stroke('c'), strokeStyle: 'zigzag', noStroke: 'yes' },
        ],
      },
    ],
  });
  const [a, b, c] = book.sketches[0].strokes;
  assert.equal(a.gradient, undefined);
  assert.equal(b.gradient, undefined);
  assert.equal(c.strokeStyle, undefined);
  assert.equal(c.noStroke, undefined);
});

test('gradient stops are ordered and clamped on read', () => {
  const book = normalizeSketchBook({
    format: 'napkin-sketch',
    version: 3,
    name: 't',
    sketches: [
      {
        id: 'sk', name: 'p', width: 100, height: 100, background: '#fff',
        layers: [{ id: 'ly', name: 'L', opacity: 1, visible: true, locked: false }],
        strokes: [
          {
            ...stroke('a'),
            gradient: { type: 'linear', angle: 450, stops: [
              { offset: 9, color: '#fff' },
              { offset: 0.2, color: '#000' },
            ] },
          },
        ],
      },
    ],
  });
  const gradient = book.sketches[0].strokes[0].gradient;
  assert.equal(gradient?.angle, 90);
  assert.deepEqual(gradient?.stops, [
    { offset: 0.2, color: '#000' },
    { offset: 1, color: '#fff' },
  ]);
});

// ---- Store operations -------------------------------------------------------

/** A store holding one page with `count` strokes, each on its own layer. */
function storeWithLayers(count: number): Store {
  const book = createSketchBook('t');
  const sketch = book.sketches[0];
  sketch.layers = Array.from({ length: count }, (_, i) => ({
    id: `ly${i}`,
    name: `Layer ${i + 1}`,
    opacity: 1,
    visible: true,
    locked: false,
  }));
  sketch.strokes = Array.from({ length: count }, (_, i) =>
    stroke(`s${i}`, {
      layer: `ly${i}`,
      points: [
        { x: i * 20, y: 0 },
        { x: i * 20 + 10, y: 0 },
      ],
    }),
  );
  return new Store(book);
}

test('joining strokes leaves one element on one layer', () => {
  const store = storeWithLayers(3);
  store.setSelection(['s0', 's1', 's2']);
  const merged = store.joinSelectedStrokes();
  assert.ok(merged);
  assert.equal(store.sketch.strokes.length, 1);
  // The merge keeps the first stroke's layer, and the layers the other two
  // vacated are gone rather than left behind empty.
  assert.equal(store.sketch.layers.length, 1);
  assert.equal(store.sketch.layers[0].id, 'ly0');
  assert.equal(merged?.layer, 'ly0');
  assert.equal(store.activeLayer.id, 'ly0');
});

test('joining leaves layers that still hold other elements alone', () => {
  const store = storeWithLayers(2);
  // A second element shares the layer the join is about to drain.
  store.sketch.strokes.push(stroke('bystander', { layer: 'ly1' }));
  store.setSelection(['s0', 's1']);
  store.joinSelectedStrokes();
  assert.deepEqual(
    store.sketch.layers.map((l) => l.id),
    ['ly0', 'ly1'],
  );
});

test('a join is one undo step, layers included', () => {
  const store = storeWithLayers(2);
  store.setSelection(['s0', 's1']);
  store.joinSelectedStrokes();
  store.undo();
  assert.equal(store.sketch.strokes.length, 2);
  assert.equal(store.sketch.layers.length, 2);
});

test('setStrokeProps writes values and deletes the keys set to undefined', () => {
  const store = storeWithLayers(2);
  assert.equal(store.setStrokeProps(['s0', 's1'], { fill: '#ff0000', strokeStyle: 'dotted' }), 2);
  assert.equal(store.sketch.strokes[0].fill, '#ff0000');
  assert.equal(store.sketch.strokes[1].strokeStyle, 'dotted');
  store.setStrokeProps(['s0'], { fill: undefined });
  assert.ok(!('fill' in store.sketch.strokes[0]));
  // An id that is not on the page is a no-op, not a crash.
  assert.equal(store.setStrokeProps(['nope'], { width: 9 }), 0);
});

test('moveStrokes shifts only the named strokes', () => {
  const store = storeWithLayers(2);
  store.moveStrokes(['s1'], 5, -3);
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 0, y: 0 });
  assert.deepEqual(store.sketch.strokes[1].points[0], { x: 25, y: -3 });
});

test('scaleStrokes scales geometry and line weight about the origin', () => {
  const store = storeWithLayers(1);
  store.scaleStrokes(['s0'], 2, 2, 0, 0);
  assert.deepEqual(store.sketch.strokes[0].points[1], { x: 20, y: 0 });
  assert.equal(store.sketch.strokes[0].width, 6);
});

test('scaleStrokes moves a Bezier structure with its points', () => {
  const store = storeWithLayers(1);
  store.sketch.strokes[0].vector = {
    anchors: [
      { p: { x: 0, y: 0 }, hOut: { x: 2, y: 2 } },
      { p: { x: 10, y: 0 }, hIn: { x: 8, y: 2 } },
    ],
  };
  store.scaleStrokes(['s0'], 3, 1, 0, 0);
  const anchors = store.sketch.strokes[0].vector!.anchors;
  assert.deepEqual(anchors[1].p, { x: 30, y: 0 });
  assert.deepEqual(anchors[0].hOut, { x: 6, y: 2 });
});

test('a non-uniform scale keeps the unscaled axis exactly where it was', () => {
  const store = storeWithLayers(1);
  store.sketch.strokes[0].points = [
    { x: 4, y: 4 },
    { x: 8, y: 12 },
  ];
  store.scaleStrokes(['s0'], 2, 1, 4, 4);
  assert.deepEqual(store.sketch.strokes[0].points, [
    { x: 4, y: 4 },
    { x: 12, y: 12 },
  ]);
});

test('scaleStrokes ignores a degenerate or no-op factor', () => {
  const store = storeWithLayers(1);
  const before = JSON.stringify(store.sketch.strokes[0].points);
  store.scaleStrokes(['s0'], 0, 1, 0, 0);
  store.scaleStrokes(['s0'], Number.NaN, 1, 0, 0);
  store.scaleStrokes(['s0'], 1, 1, 0, 0);
  assert.equal(JSON.stringify(store.sketch.strokes[0].points), before);
  assert.ok(!store.canUndo, 'a rejected scale must not push a history step');
});

test('moveLayer reports whether the layer actually moved', () => {
  const store = storeWithLayers(2);
  // ly1 is already on top; ly0 has room to rise.
  assert.equal(store.moveLayer('ly1', 1), false);
  assert.equal(store.moveLayer('ly0', -1), false);
  assert.equal(store.moveLayer('ly0', 1), true);
  assert.deepEqual(
    store.sketch.layers.map((l) => l.id),
    ['ly1', 'ly0'],
  );
});
