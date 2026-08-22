/** Close Shape and Alt-drag copy store operations. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSketchBook, type Layer, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

function stroke(id: string, layer: string, points: Stroke['points']): Stroke {
  return { id, tool: 'pen', color: '#000', width: 3, layer, points };
}

function layer(id: string, name: string, extra: Partial<Layer> = {}): Layer {
  return { id, name, opacity: 1, visible: true, locked: false, ...extra };
}

/** An open L of three points with a 10px gap between its two ends. */
const OPEN_POINTS = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

// ---- Close Shape ------------------------------------------------------------

test('sharp close bridges the ends with one straight segment', () => {
  const store = new Store(createSketchBook('t'));
  const ly = store.sketch.layers[0].id;
  store.sketch.strokes = [stroke('s1', ly, OPEN_POINTS.map((p) => ({ ...p })))];
  store.setSelection(['s1']);
  assert.equal(store.closeSelectedStrokes('sharp'), 1);
  const pts = store.sketch.strokes[0].points;
  assert.equal(pts.length, 4);
  assert.deepEqual({ x: pts[3].x, y: pts[3].y }, { x: 0, y: 0 });
});

test('smooth close ends exactly on the first point via a curved bridge', () => {
  const store = new Store(createSketchBook('t'));
  const ly = store.sketch.layers[0].id;
  store.sketch.strokes = [stroke('s1', ly, OPEN_POINTS.map((p) => ({ ...p })))];
  store.setSelection(['s1']);
  assert.equal(store.closeSelectedStrokes('smooth'), 1);
  const pts = store.sketch.strokes[0].points;
  // More than a single bridge point: the seam is a sampled curve.
  assert.ok(pts.length > 5, `expected a curved bridge, got ${pts.length} points`);
  assert.deepEqual({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }, { x: 0, y: 0 });
});

test('closing skips already-closed, too-short, and non-drawing strokes', () => {
  const store = new Store(createSketchBook('t'));
  const ly = store.sketch.layers[0].id;
  store.sketch.strokes = [
    // Ends already touch.
    stroke('closed', ly, [...OPEN_POINTS.map((p) => ({ ...p })), { x: 0, y: 0 }]),
    // Two points cannot enclose space.
    stroke('short', ly, [{ x: 0, y: 0 }, { x: 5, y: 5 }]),
    { ...stroke('text', ly, OPEN_POINTS.map((p) => ({ ...p }))), tool: 'text', text: 'hi' },
  ];
  store.setSelection(['closed', 'short', 'text']);
  assert.equal(store.closeSelectedStrokes('sharp'), 0);
  assert.ok(!store.canUndo, 'a no-op close must not push history');
});

test('closing a vector stroke marks its anchor model closed', () => {
  const store = new Store(createSketchBook('t'));
  const ly = store.sketch.layers[0].id;
  const s = stroke('v1', ly, OPEN_POINTS.map((p) => ({ ...p })));
  s.vector = {
    anchors: [
      { p: { x: 0, y: 0 } },
      { p: { x: 10, y: 0 } },
      { p: { x: 10, y: 10 } },
    ],
  };
  store.sketch.strokes = [s];
  store.setSelection(['v1']);
  store.closeSelectedStrokes('smooth');
  const closed = store.sketch.strokes[0];
  assert.equal(closed.vector?.closed, true);
  // The smooth close gave the seam tangent handles at both ends.
  assert.ok(closed.vector?.anchors[2].hOut);
  assert.ok(closed.vector?.anchors[0].hIn);
  const lastPt = closed.points[closed.points.length - 1];
  assert.deepEqual({ x: lastPt.x, y: lastPt.y }, { x: 0, y: 0 });
});

// ---- Drag copy --------------------------------------------------------------

test('duplicateSelectedElements copies strokes onto " - copy" layers', () => {
  const store = new Store(createSketchBook('t'));
  store.sketch.layers = [layer('a', 'ink'), layer('b', 'notes')];
  store.sketch.strokes = [
    stroke('s1', 'a', OPEN_POINTS.map((p) => ({ ...p }))),
    stroke('s2', 'b', OPEN_POINTS.map((p) => ({ ...p }))),
  ];
  store.setSelection(['s1', 's2']);
  assert.equal(store.duplicateSelectedElements(), 2);

  // Two copy layers, each suffixed (both were roots of the copy).
  const names = store.sketch.layers.map((l) => l.name);
  assert.deepEqual(names, ['ink', 'notes', 'ink - copy', 'notes - copy']);
  assert.equal(store.sketch.strokes.length, 4);

  // The copies are now the selection, on the copy layers.
  const selected = store.sketch.strokes.filter((s) => store.selectedIds.has(s.id));
  assert.equal(selected.length, 2);
  const copyLayerIds = new Set(store.sketch.layers.slice(2).map((l) => l.id));
  assert.ok(selected.every((s) => copyLayerIds.has(s.layer!)));
  // Deep copies: moving a copy leaves the original alone.
  selected[0].points[0].x = 99;
  assert.equal(store.sketch.strokes[0].points[0].x, 0);
});

test('a copied group keeps its children names; only the group row is suffixed', () => {
  const store = new Store(createSketchBook('t'));
  store.sketch.layers = [
    layer('part', 'Head', { parent: 'grp' }),
    layer('grp', 'subject', { group: true }),
  ];
  store.sketch.strokes = [stroke('s1', 'part', OPEN_POINTS.map((p) => ({ ...p })))];
  // Selecting the group row selects its strokes and records the group.
  store.selectLayer('grp');
  assert.equal(store.duplicateSelectedElements(), 1);

  const names = store.sketch.layers.map((l) => l.name);
  assert.deepEqual(names, ['Head', 'subject', 'Head', 'subject - copy']);
  // The copied child nests under the copied group, not the original.
  const copiedChild = store.sketch.layers[2];
  const copiedGroup = store.sketch.layers[3];
  assert.equal(copiedChild.parent, copiedGroup.id);
  assert.notEqual(copiedGroup.id, 'grp');
});

test('duplicating nothing is a no-op', () => {
  const store = new Store(createSketchBook('t'));
  assert.equal(store.duplicateSelectedElements(), 0);
  assert.equal(store.sketch.layers.length, 1);
});

test('a sharp close of a vector path is a straight segment, handles dropped', () => {
  const store = new Store(createSketchBook('t'));
  const ly = store.sketch.layers[0].id;
  const s = stroke('v2', ly, OPEN_POINTS.map((p) => ({ ...p })));
  // Drawn with the Vector Path tool: the end anchors carry handles that the
  // open path never used. A sharp close must not bend the seam with them.
  s.vector = {
    anchors: [
      { p: { x: 0, y: 0 }, hIn: { x: -8, y: -8 }, hOut: { x: 4, y: 0 } },
      { p: { x: 10, y: 0 } },
      { p: { x: 10, y: 10 }, hIn: { x: 10, y: 6 }, hOut: { x: 18, y: 18 } },
    ],
  };
  store.sketch.strokes = [s];
  store.setSelection(['v2']);
  const before = s.points.length;
  store.closeSelectedStrokes('sharp');

  const closed = store.sketch.strokes[0];
  assert.equal(closed.vector?.closed, true);
  assert.equal(closed.vector?.anchors[2].hOut, undefined, 'closing handle must be cleared');
  assert.equal(closed.vector?.anchors[0].hIn, undefined, 'closing handle must be cleared');
  // Exactly one new point: the straight run back to the first anchor.
  assert.equal(closed.points.length, before + 1);
  const lastPt = closed.points[closed.points.length - 1];
  assert.deepEqual({ x: lastPt.x, y: lastPt.y }, { x: 0, y: 0 });
  // Handles the open path was already using are untouched.
  assert.deepEqual(closed.vector?.anchors[0].hOut, { x: 4, y: 0 });
  assert.deepEqual(closed.vector?.anchors[2].hIn, { x: 10, y: 6 });
});

test('a smooth close keeps handles the drawing already had', () => {
  const store = new Store(createSketchBook('t'));
  const ly = store.sketch.layers[0].id;
  const s = stroke('v3', ly, OPEN_POINTS.map((p) => ({ ...p })));
  s.vector = {
    anchors: [
      { p: { x: 0, y: 0 }, hIn: { x: -5, y: -5 } },
      { p: { x: 10, y: 0 } },
      { p: { x: 10, y: 10 }, hOut: { x: 20, y: 20 } },
    ],
  };
  store.sketch.strokes = [s];
  store.setSelection(['v3']);
  store.closeSelectedStrokes('smooth');
  const closed = store.sketch.strokes[0];
  assert.deepEqual(closed.vector?.anchors[2].hOut, { x: 20, y: 20 });
  assert.deepEqual(closed.vector?.anchors[0].hIn, { x: -5, y: -5 });
});
