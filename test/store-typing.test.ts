/**
 * The store's side of the type editor (renderer/type-editor.ts): a text's
 * type written in place with no history of its own, a new text put on the
 * page inside the step its first keystroke opens, a text taken off the page
 * with or without a step, Undo offered while a burst of typing is open, the
 * page about to change heard while it is still in view, a path turned into
 * type in its place, and the Transform Box scaling a frame rather than its
 * type. The GUI check
 * `check-type-editor.mjs` types through all of it in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rectangleAnchors, typeSpecOf, withTypeset } from '../src/core/type/model.js';
import { createSketchBook, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

const text = (id: string, value: string): Stroke => ({
  id,
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 10, y: 10, pressure: 0.5 }],
  text: value,
  fontSize: 24,
  fontFamily: 'Georgia',
});

test('a burst of typing written in place is one undo step, and undo puts the text back', () => {
  const store = new Store(createSketchBook('typing'));
  store.addStroke(text('tx', 'Hello'));
  store.beginTransaction();
  store.setTypeset('tx', { ...text('tx', 'Hello,'), typeset: undefined, textBoxWidth: undefined });
  store.setTypeset('tx', { ...text('tx', 'Hello, there'), typeset: undefined, textBoxWidth: undefined });
  assert.equal(store.sketch.strokes[0].text, 'Hello, there', 'each keystroke is on the page at once');
  store.commitTransaction();
  store.undo();
  assert.equal(store.sketch.strokes[0].text, 'Hello', 'one undo takes the burst back whole');
  store.undo();
  assert.equal(store.sketch.strokes.length, 0, 'and the next the step that added the text');
});

test('the type fields a write leaves out are taken away; the rest of the mark is kept', () => {
  const store = new Store(createSketchBook('typing'));
  store.addStroke({ ...text('tx', 'Boxed'), textBoxWidth: 120, opacity: 0.5 });
  store.setTypeset('tx', { ...text('tx', 'Boxed'), typeset: undefined, textBoxWidth: undefined });
  const mark = store.sketch.strokes[0];
  assert.equal('textBoxWidth' in mark, false);
  assert.equal(mark.opacity, 0.5);
});

test('a new text goes on the page inside the open step, and a rollback leaves no trace of it or its layer', () => {
  const store = new Store(createSketchBook('typing'));
  store.addStroke({ id: 'ink', tool: 'pen', color: '#000000', width: 2, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 5, y: 5, pressure: 0.5 }] });
  const layers = store.sketch.layers.map((l) => l.id);
  const active = store.activeLayer.id;
  store.beginTransaction();
  store.addStrokeLive(text('tx', ''));
  store.setTypeset('tx', { ...text('tx', 'x'), typeset: undefined, textBoxWidth: undefined });
  assert.equal(store.sketch.layers.length, layers.length + 1, 'on a layer of its own');
  store.rollbackTransaction();
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['ink']);
  assert.deepEqual(store.sketch.layers.map((l) => l.id), layers);
  assert.equal(store.activeLayer.id, active);
});

test('removing a text prunes the layer it empties: as a step of its own, or inside the open one', () => {
  const store = new Store(createSketchBook('typing'));
  store.addStroke({ id: 'ink', tool: 'pen', color: '#000000', width: 2, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 5, y: 5, pressure: 0.5 }] });
  store.addStroke(text('tx', 'Gone'));
  const withText = store.sketch.layers.length;
  store.setSelection(['tx']);
  store.removeMark('tx');
  assert.deepEqual([store.sketch.strokes.map((s) => s.id), store.sketch.layers.length, store.selectedIds.has('tx')], [['ink'], withText - 1, false]);
  store.undo();
  assert.equal(store.sketch.strokes.some((s) => s.id === 'tx'), true, 'one undo brings it back');
  // Typed and emptied in one burst: the removal is part of the burst's step.
  store.beginTransaction();
  store.setTypeset('tx', { ...text('tx', ''), typeset: undefined, textBoxWidth: undefined });
  store.removeMark('tx', false);
  store.commitTransaction();
  store.undo();
  assert.equal(store.sketch.strokes.find((s) => s.id === 'tx')?.text, 'Gone', 'one undo takes back the emptying and the removal');
});

test('Undo is offered while an open transaction has changed the page, and not before', () => {
  const store = new Store(createSketchBook('typing'));
  assert.equal(store.canUndo, false);
  store.beginTransaction();
  assert.equal(store.canUndo, false, 'nothing changed yet');
  store.addStrokeLive(text('tx', 'a'));
  assert.equal(store.canUndo, true, 'the first keystroke of a new document is undoable at once');
  store.undo();
  assert.equal(store.sketch.strokes.length, 0, 'and undo takes it back');
});

test('the page about to change is heard while it is still in view, before what is open is settled', () => {
  const store = new Store(createSketchBook('typing'));
  store.addPage();
  store.goToPage(0);
  const first = store.sketch.id;
  const heard: string[] = [];
  store.onPageLeave(() => heard.push(store.sketch.id));
  store.beginTransaction(() => heard.push('settled'));
  store.addStrokeLive(text('tx', 'a'));
  store.goToPage(1);
  assert.deepEqual(heard, [first, 'settled']);
  store.goToPage(1);
  assert.equal(heard.length, 2, 'staying on the page is no change');
  const stop = store.onPageLeave(() => heard.push('second'));
  stop();
  store.addPage();
  assert.deepEqual(heard.slice(2), [store.book.sketches[1].id], 'adding a page leaves the one in view');
});

test('a path turned into type gives the text its place, its layer and its order, in the step that is open', () => {
  const store = new Store(createSketchBook('typing'));
  const curve: Stroke = { id: 'curve', tool: 'pen', color: '#1f2328', width: 2, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 100, y: 0, pressure: 0.5 }] };
  store.addStroke(text('below', 'A'));
  store.addStroke(curve);
  store.addStroke(text('above', 'B'));
  const layer = store.sketch.strokes[1].layer;
  store.setSelection(['curve']);
  store.beginTransaction();
  assert.equal(store.replaceMark('curve', text('along', 'C'), false), true);
  store.commitTransaction();
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['below', 'along', 'above'], 'where the path stood among the marks');
  assert.equal(store.sketch.strokes[1].layer, layer, 'on its layer');
  assert.equal(store.selectedIds.has('curve'), false, 'the path is no longer selected');
  assert.equal(store.replaceMark('gone', text('x', 'x')), false, 'a mark that is not on the page is not replaced');
  store.undo();
  assert.deepEqual(store.sketch.strokes.map((s) => s.id), ['below', 'curve', 'above'], 'one undo gives the path back');
});

test('the Transform Box scales a frame or a path, its type keeping its size; Sideless Typing scales its type', () => {
  const store = new Store(createSketchBook('typing'));
  store.addStroke(withTypeset(text('sheet', 'Wrap me'), { kind: 'area', frame: { anchors: rectangleAnchors(100, 50) } }));
  store.addStroke(text('point', 'Grow'));
  store.scaleStrokes(['sheet', 'point'], 2, 2, 10, 10);
  const sheet = store.sketch.strokes.find((s) => s.id === 'sheet')!;
  assert.equal(sheet.fontSize, 24, 'the sheet keeps its size');
  assert.deepEqual(typeSpecOf(sheet).frame?.anchors.map((a) => [a.p.x, a.p.y]), [[0, 0], [200, 0], [200, 100], [0, 100]], 'its frame takes the scale');
  assert.equal(store.sketch.strokes.find((s) => s.id === 'point')!.fontSize, 48, 'Sideless Typing scales its characters, as before');
});
