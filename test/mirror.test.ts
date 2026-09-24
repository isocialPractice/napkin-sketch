/**
 * Mirror Selection tests: the reflection rules for every kind of element, the
 * store operation the palette commits through, the edit transaction that
 * carries its live preview, and the compound-shape history fix it depends on.
 *
 * The canvas y axis grows downward, so "left-right" (the palette's
 * Horizontal) negates x about a vertical line and "top-bottom" (Vertical)
 * negates y about a horizontal one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorAngle, mirrorStroke, type Mirror } from '../src/core/transform.js';
import {
  createLayer,
  createSketchBook,
  DEFAULT_NIB_ANGLE,
  type Stroke,
  type VectorAnchor,
} from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';
import { Surface } from '../src/renderer/surface.js';

const LEFT_RIGHT: Mirror = { flipX: true, flipY: false, x: 50, y: 0 };
const TOP_BOTTOM: Mirror = { flipX: false, flipY: true, x: 0, y: 50 };
const BOTH: Mirror = { flipX: true, flipY: true, x: 50, y: 50 };

function pen(id: string, patch: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#1f2328',
    width: 4,
    points: [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ],
    ...patch,
  };
}

/** A square with a square hole: one stroke, two contours, one `move`. */
function ring(id = 'ring'): Stroke {
  const corners: Array<[number, number]> = [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
  ];
  return {
    id,
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    fill: '#ff0000',
    points: corners.map(([x, y], i) => ({ x, y, ...(i === 4 ? { move: true as const } : {}) })),
    vector: {
      closed: true,
      anchors: corners.map(([x, y], i) => ({
        p: { x, y },
        ...(i === 4 ? { move: true as const } : {}),
      })),
    },
  };
}

/** A store holding one page whose strokes each sit on a layer of their own. */
function storeWith(...strokes: Stroke[]): Store {
  const book = createSketchBook('mirror');
  const sketch = book.sketches[0];
  sketch.layers = strokes.map((s, i) => ({ ...createLayer(`Layer ${i + 1}`), id: `ly${i}` }));
  sketch.strokes = strokes.map((s, i) => ({ ...s, layer: `ly${i}` }));
  return new Store(book);
}

function exportedD(store: Store): string {
  return /<path d="([^"]+)"/.exec(Surface.toSVG(store.sketch))?.[1] ?? '';
}

// ---- Phase 0: compound shapes survive history ---------------------------------

test('a compound shape keeps its subpath breaks through move, undo and redo', () => {
  const store = storeWith(ring());
  const flags = (): string =>
    store.sketch.strokes[0].vector!.anchors.map((a) => (a.move ? 'M' : '.')).join('');
  const before = exportedD(store);
  assert.equal(flags(), '....M...');
  assert.match(before, /Z\s*M/i, 'the hole is its own subpath');

  store.moveStrokes(['ring'], 5, 0);
  store.undo();
  assert.equal(flags(), '....M...');
  assert.equal(exportedD(store), before, 'undo brings back the same path, hole and all');

  store.redo();
  assert.equal(flags(), '....M...');
});

test('an undo snapshot holds its own copy of a gradient', () => {
  const store = storeWith(
    pen('g', {
      gradient: { type: 'linear', angle: 0, stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ] },
    }),
  );
  store.pushHistory();
  // An in-place write after the snapshot must not reach back into it.
  store.sketch.strokes[0].gradient!.angle = 90;
  store.sketch.strokes[0].gradient!.stops[0].color = '#123456';
  store.undo();
  assert.equal(store.sketch.strokes[0].gradient!.angle, 0);
  assert.equal(store.sketch.strokes[0].gradient!.stops[0].color, '#000000');
});

test('a polyline with a subpath break exports as two subpaths', () => {
  const store = storeWith(
    pen('two', {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 0, y: 30, move: true },
        { x: 10, y: 30 },
      ],
    }),
  );
  const d = exportedD(store);
  assert.equal((d.match(/[Mm]/g) ?? []).length, 2, `two moveTo commands in ${d}`);
});

// ---- The reflection rules -----------------------------------------------------

test('mirrorAngle reflects a direction measured clockwise from +x', () => {
  assert.equal(mirrorAngle(30, LEFT_RIGHT), 150);
  assert.equal(mirrorAngle(30, TOP_BOTTOM), 330);
  assert.equal(mirrorAngle(30, BOTH), 210);
  assert.equal(mirrorAngle(0, LEFT_RIGHT), 180);
  assert.equal(mirrorAngle(270, TOP_BOTTOM), 90);
});

test('points and anchors reflect exactly, with every handle on its own anchor', () => {
  const anchors: VectorAnchor[] = [
    { p: { x: 10, y: 10 }, hOut: { x: 20, y: 0 } },
    { p: { x: 40, y: 10 }, hIn: { x: 30, y: 0 } },
    { p: { x: 10, y: 60 }, move: true },
    { p: { x: 20, y: 70 } },
  ];
  const stroke = pen('v', {
    points: [
      { x: 10, y: 10, pressure: 0.3 },
      { x: 40, y: 10 },
    ],
    vector: { anchors: structuredClone(anchors) },
  });
  mirrorStroke(stroke, LEFT_RIGHT);
  assert.deepEqual(stroke.points, [
    { x: 90, y: 10, pressure: 0.3 },
    { x: 60, y: 10 },
  ]);
  const [a, b, c, d] = stroke.vector!.anchors;
  assert.deepEqual(a, { p: { x: 90, y: 10 }, hOut: { x: 80, y: 0 } });
  assert.deepEqual(b, { p: { x: 60, y: 10 }, hIn: { x: 70, y: 0 } });
  assert.deepEqual(c, { p: { x: 90, y: 60 }, move: true });
  assert.deepEqual(d, { p: { x: 80, y: 70 } });
});

test('a reflection changes no length, so width and paint are untouched', () => {
  const stroke = pen('w', { width: 7, fill: '#00ff00', strokeStyle: 'dashed', opacity: 0.5 });
  mirrorStroke(stroke, BOTH);
  assert.equal(stroke.width, 7);
  assert.equal(stroke.fill, '#00ff00');
  assert.equal(stroke.strokeStyle, 'dashed');
  assert.equal(stroke.opacity, 0.5);
});

test('a Copic nib turns with the mark', () => {
  const nib = pen('c', { tool: 'copic', nibAngle: 30 });
  mirrorStroke(nib, LEFT_RIGHT);
  assert.equal(nib.nibAngle, 150);
  const unset = pen('d', { tool: 'copic' });
  mirrorStroke(unset, TOP_BOTTOM);
  assert.equal(unset.nibAngle, 360 - DEFAULT_NIB_ANGLE);
});

test('a linear gradient turns and is replaced rather than edited; a radial one stays', () => {
  const original = { type: 'linear' as const, angle: 0, stops: [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ] };
  const stroke = pen('lg', { gradient: original });
  mirrorStroke(stroke, LEFT_RIGHT);
  assert.equal(stroke.gradient!.angle, 180);
  assert.equal(original.angle, 0, 'the object an undo snapshot may hold is left alone');
  assert.notEqual(stroke.gradient, original);

  const radial = { type: 'radial' as const, stops: original.stops };
  const round = pen('rg', { gradient: radial });
  mirrorStroke(round, BOTH);
  assert.equal(round.gradient, radial);
});

test('text lands where its box would be mirrored, and stays readable', () => {
  const text = pen('t', {
    tool: 'text',
    text: 'Hello',
    fontSize: 20,
    points: [{ x: 10, y: 30 }],
  });
  // The box the canvas measures: 30 wide, 20 tall, anchored top-left.
  mirrorStroke(text, BOTH, { minX: 10, minY: 30, maxX: 40, maxY: 50 });
  // The far edge becomes the near one: x 2*50 - 40 = 60, y 2*50 - 50 = 50.
  assert.deepEqual(text.points, [{ x: 60, y: 50 }]);
  assert.equal(text.fontSize, 20);
  assert.equal(text.text, 'Hello');
});

test('an image box moves by its placed size, with the pixels left to the caller', () => {
  const image = pen('i', {
    tool: 'image',
    image: 'data:image/png;base64,AAAA',
    imageWidth: 30,
    imageHeight: 10,
    points: [{ x: 5, y: 5 }],
  });
  mirrorStroke(image, LEFT_RIGHT);
  assert.deepEqual(image.points, [{ x: 65, y: 5 }]);
  assert.equal(image.imageWidth, 30);
  assert.equal(image.image, 'data:image/png;base64,AAAA');
});

test('an eraser mark is reflected like any other points', () => {
  const eraser = pen('e', { tool: 'eraser' });
  mirrorStroke(eraser, TOP_BOTTOM);
  assert.deepEqual(eraser.points.map((p) => [p.x, p.y]), [
    [10, 80],
    [30, 60],
  ]);
});

test('no axis means no change at all', () => {
  const stroke = pen('n');
  mirrorStroke(stroke, { flipX: false, flipY: false, x: 50, y: 50 });
  assert.deepEqual(stroke.points, pen('n').points);
});

// ---- The store operation ------------------------------------------------------

test('mirrorStrokes is one undo step, or none when asked for none', () => {
  const store = storeWith(pen('a'), pen('b'));
  store.mirrorStrokes(['a'], LEFT_RIGHT);
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 90, y: 20 });
  assert.deepEqual(store.sketch.strokes[1].points[0], { x: 10, y: 20 }, 'only the named strokes');
  store.undo();
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 10, y: 20 });
  assert.equal(store.canUndo, false);

  store.mirrorStrokes(['a'], LEFT_RIGHT, { history: false });
  assert.equal(store.canUndo, false);
});

// ---- The edit transaction -----------------------------------------------------

test('a committed transaction is one undo step, whatever happened inside it', () => {
  const store = storeWith(pen('a'));
  store.beginTransaction();
  store.mirrorStrokes(['a'], LEFT_RIGHT, { history: false });
  store.moveStrokes(['a'], 3, 4, false);
  store.mirrorStrokes(['a'], TOP_BOTTOM, { history: false });
  store.commitTransaction();
  assert.equal(store.inTransaction, false);
  store.undo();
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 10, y: 20 });
  assert.equal(store.canUndo, false);
});

test('a rolled-back transaction leaves page, selection, history and saved state as found', () => {
  const store = storeWith(pen('a'));
  store.setSelection(['a']);
  store.dirty = false;
  store.beginTransaction();
  store.duplicateSelectedElements();
  store.mirrorStrokes([...store.selectedIds], LEFT_RIGHT, { history: false });
  assert.equal(store.sketch.strokes.length, 2);
  store.rollbackTransaction();
  assert.equal(store.sketch.strokes.length, 1);
  assert.equal(store.sketch.layers.length, 1);
  assert.deepEqual([...store.selectedIds], ['a']);
  assert.equal(store.dirty, false);
  assert.equal(store.canUndo, false);
  assert.equal(store.canRedo, false);
});

test('a transaction that changed nothing leaves no undo step', () => {
  const store = storeWith(pen('a'));
  store.dirty = false;
  store.beginTransaction();
  store.moveStrokes(['a'], 5, 5, false);
  store.moveStrokes(['a'], -5, -5, false);
  store.commitTransaction();
  assert.equal(store.canUndo, false);
  assert.equal(store.dirty, false);
});

test('an edit that keeps history settles an open transaction and tells its owner', () => {
  const store = storeWith(pen('a'));
  let settled = 0;
  store.beginTransaction(() => settled++);
  store.mirrorStrokes(['a'], LEFT_RIGHT, { history: false });
  // A drag, say, starting on the previewed result: it builds on what is shown.
  store.moveStrokes(['a'], 1, 0);
  assert.equal(settled, 1);
  assert.equal(store.inTransaction, false);
  store.undo();
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 90, y: 20 }, 'the move comes off first');
  store.undo();
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 10, y: 20 }, 'then the mirror');
});

test('undo while a transaction is open takes the preview back', () => {
  const store = storeWith(pen('a'));
  let settled = 0;
  store.beginTransaction(() => settled++);
  store.mirrorStrokes(['a'], LEFT_RIGHT, { history: false });
  store.undo();
  assert.equal(settled, 1);
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 10, y: 20 });
  assert.equal(store.canRedo, true);
});

test("the owner's own commit and rollback do not call it back", () => {
  const store = storeWith(pen('a'));
  let settled = 0;
  store.beginTransaction(() => settled++);
  store.commitTransaction();
  store.beginTransaction(() => settled++);
  store.rollbackTransaction();
  assert.equal(settled, 0);
});

test('changing page settles a transaction on the page it began on', () => {
  const store = storeWith(pen('a'));
  let settled = 0;
  store.beginTransaction(() => settled++);
  store.mirrorStrokes(['a'], LEFT_RIGHT, { history: false });
  store.addPage();
  assert.equal(settled, 1);
  assert.equal(store.inTransaction, false);
  store.goToPage(0);
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 90, y: 20 }, 'the preview was kept');
});

// ---- Mirror with a copy, end to end -------------------------------------------

test('mirroring a copy is one undo step that takes the copy and its layers away', () => {
  const store = storeWith(pen('a'));
  store.setSelection(['a']);
  store.beginTransaction();
  store.duplicateSelectedElements();
  const copies = [...store.selectedIds];
  // Reflected about the selection's right edge, so the copy lands beside it.
  store.mirrorStrokes(copies, { flipX: true, flipY: false, x: 30, y: 0 }, { history: false });
  store.commitTransaction();

  assert.equal(store.sketch.strokes.length, 2);
  assert.equal(store.sketch.layers.length, 2);
  assert.deepEqual(store.sketch.strokes[0].points[0], { x: 10, y: 20 }, 'the original stays put');
  assert.deepEqual(
    store.sketch.strokes[1].points.map((p) => [p.x, p.y]),
    [
      [50, 20],
      [30, 40],
    ],
    'the copy starts where the original ends',
  );
  assert.deepEqual([...store.selectedIds], copies, 'the copy is what is selected afterwards');

  store.undo();
  assert.equal(store.sketch.strokes.length, 1);
  assert.equal(store.sketch.layers.length, 1);
});
