/**
 * The Text tool's decision table (src/core/type/tool.ts), one case per row:
 * the Ctrl spring, editing a text, Path Typing on a selected open path,
 * Sheet Typing in a selected closed shape, Alt between the two, a drag's new
 * rectangle, Sideless Typing on the canvas and on art that is not selected,
 * and a paste on a selected path. The GUI check `check-typing-modes.mjs`
 * makes each in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dragBracket, oversetPort, pathBrackets, pathHitAt, typeOnPath, typeablePath, typeToolAction, typeToolCursor, type TypeToolInput } from '../src/core/type/tool.js';
import type { Stroke } from '../src/core/types.js';

const none = new Set<string>();
const sel = (...ids: string[]) => new Set(ids);
const click = (input: Partial<TypeToolInput>): TypeToolInput => ({ gesture: 'click', hit: null, selected: none, modifiers: {}, ...input });

const openPath = { kind: 'path' as const, id: 'curve', closed: false, where: 'outline' as const };
const closedShape = (where: 'outline' | 'inside') => ({ kind: 'path' as const, id: 'circle', closed: true, where });

test('Ctrl held: the selection tool, whatever is under the pointer', () => {
  assert.deepEqual(typeToolAction(click({ modifiers: { ctrl: true }, hit: openPath, selected: sel('curve') })), { kind: 'spring' });
});

test('a click on a text mark edits it', () => {
  assert.deepEqual(typeToolAction(click({ hit: { kind: 'text', id: 'tx' } })), { kind: 'edit', id: 'tx' });
});

test('a click on a selected open path: Path Typing on it', () => {
  assert.deepEqual(typeToolAction(click({ hit: openPath, selected: sel('curve') })), { kind: 'path-type', pathId: 'curve', closed: false });
  // Near it but not on it is the canvas.
  assert.deepEqual(typeToolAction(click({ hit: { ...openPath, where: 'inside' }, selected: sel('curve') })), { kind: 'point-type' });
});

test('a click inside, or on, a selected closed shape: Sheet Typing in it', () => {
  for (const where of ['inside', 'outline'] as const) {
    assert.deepEqual(typeToolAction(click({ hit: closedShape(where), selected: sel('circle') })), { kind: 'sheet-type', pathId: 'circle' }, where);
  }
});

test('Alt + click on a selected closed shape: Path Typing on its outline', () => {
  assert.deepEqual(typeToolAction(click({ hit: closedShape('inside'), selected: sel('circle'), modifiers: { alt: true } })), { kind: 'path-type', pathId: 'circle', closed: true });
});

test('Alt + click on a selected open path: Sheet Typing in the region it closes', () => {
  assert.deepEqual(typeToolAction(click({ hit: openPath, selected: sel('curve'), modifiers: { alt: true } })), { kind: 'sheet-type', pathId: 'curve' });
});

test('a drag on the canvas: Sheet Typing in a new rectangle', () => {
  assert.deepEqual(typeToolAction({ gesture: 'drag', hit: null, selected: none, modifiers: {} }), { kind: 'sheet-box' });
  // A drag from art that is not selected draws a rectangle too.
  assert.deepEqual(typeToolAction({ gesture: 'drag', hit: { kind: 'art', id: 'blob' }, selected: none, modifiers: {} }), { kind: 'sheet-box' });
});

test('a click on the canvas, or on art not selected: Sideless Typing at the click, the art left alone', () => {
  assert.deepEqual(typeToolAction(click({})), { kind: 'point-type' });
  assert.deepEqual(typeToolAction(click({ hit: openPath })), { kind: 'point-type' }, 'a path that is not selected stays a path');
  assert.deepEqual(typeToolAction(click({ hit: closedShape('inside') })), { kind: 'point-type' });
  assert.deepEqual(typeToolAction(click({ hit: { kind: 'art', id: 'photo' } })), { kind: 'point-type' });
});

test('Ctrl+V with a path selected and text on the clipboard: Path Typing of it; otherwise the ordinary paste', () => {
  const paste = (clipboard: TypeToolInput['clipboard'], selected = sel('curve')): TypeToolInput => ({ gesture: 'paste', hit: null, selected, modifiers: {}, clipboard });
  const path = { id: 'curve', closed: false };
  assert.deepEqual(typeToolAction(paste({ text: 'Fresh bread', path, editing: false })), { kind: 'paste-on-path', pathId: 'curve', closed: false });
  assert.deepEqual(typeToolAction(paste({ text: '   ', path, editing: false })), { kind: 'none' }, 'no text');
  assert.deepEqual(typeToolAction(paste({ text: 'Fresh bread', path: null, editing: false })), { kind: 'none' }, 'no path');
  assert.deepEqual(typeToolAction(paste({ text: 'Fresh bread', path, editing: true })), { kind: 'none' }, 'a text being typed takes the paste');
  assert.deepEqual(typeToolAction(paste({ text: 'Fresh bread', path, editing: false }, none)), { kind: 'none' }, 'the path is not selected');
});

test('the pointer shows what a click would make', () => {
  assert.equal(typeToolCursor({ kind: 'point-type' }), 'point');
  assert.equal(typeToolCursor({ kind: 'sheet-type', pathId: 'c' }), 'area');
  assert.equal(typeToolCursor({ kind: 'path-type', pathId: 'c', closed: false }), 'path');
  assert.equal(typeToolCursor({ kind: 'edit', id: 't' }), 'edit');
});

// ---- Paths into type, and the brackets ---------------------------------------------------------------

const line: Stroke = {
  id: 'curve',
  tool: 'pen',
  color: '#27486d',
  width: 3,
  points: [{ x: 100, y: 100, pressure: 0.5 }, { x: 300, y: 100, pressure: 0.5 }],
  vector: { anchors: [{ p: { x: 100, y: 100 } }, { p: { x: 300, y: 100 } }] },
};

const square = (size: number): Stroke => {
  const pts = [[0, 0], [size, 0], [size, size], [0, size], [0, 0]].map(([x, y]) => ({ x: 50 + x, y: 50 + y, pressure: 0.5 }));
  // A rectangle drawn as points, as the Rectangle tool draws one: every few pixels along its sides.
  const points: Stroke['points'] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < 10; k++) points.push({ x: pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / 10, y: pts[i].y + ((pts[i + 1].y - pts[i].y) * k) / 10, pressure: 0.5 });
  }
  points.push({ ...pts[0] });
  return { id: 'box', tool: 'pen', color: '#1f2328', width: 2, fill: '#ffd43b', points };
};

const textMark = (text: string): Stroke => ({ id: 'tx', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 0, y: 0, pressure: 0.5 }], text, fontSize: 20, fontFamily: 'Georgia' });

test('the path a mark gives the Text tool: its anchors, or a shape drawn as points fitted to few', () => {
  assert.deepEqual(typeablePath(line), { anchors: [{ p: { x: 100, y: 100 } }, { p: { x: 300, y: 100 } }], closed: false });
  const box = typeablePath(square(100))!;
  assert.equal(box.closed, true);
  assert.ok(box.anchors.length >= 4 && box.anchors.length <= 6, `a rectangle in ${box.anchors.length} anchors, not 41`);
  assert.equal(typeablePath(textMark('x')), null);
  assert.equal(pathHitAt(typeablePath(line)!, { x: 200, y: 103 }, 4), 'outline');
  assert.equal(pathHitAt(typeablePath(line)!, { x: 200, y: 120 }, 4), null);
  assert.equal(pathHitAt(box, { x: 100, y: 100 }, 4), 'inside');
  assert.equal(pathHitAt(box, { x: 151, y: 100 }, 4), 'outline');
});

test('a text made on a path: Sheet Typing in its frame, the paint its own; Path Typing along it from the click', () => {
  const box = typeablePath(square(100))!;
  const sheet = typeOnPath(box, 'sheet', null, textMark(''), { fill: '#ffd43b', stroke: '#1f2328', width: 2 });
  assert.equal(sheet.typeset?.kind, 'area');
  assert.deepEqual(sheet.points[0], { x: box.anchors[0].p.x, y: box.anchors[0].p.y, pressure: 0.5 });
  assert.deepEqual(sheet.typeset?.frame?.anchors[0].p, { x: 0, y: 0 }, 'kept relative to the anchor');
  assert.deepEqual([sheet.typeset?.frame?.fill, sheet.typeset?.frame?.stroke, sheet.typeset?.frame?.width], ['#ffd43b', '#1f2328', 2]);
  const along = typeOnPath(typeablePath(line)!, 'path', { x: 150, y: 90 }, textMark(''));
  assert.equal(along.typeset?.kind, 'path');
  assert.equal(along.typeset?.path?.start, 50, 'from the place nearest the click');
  assert.equal(typeOnPath(typeablePath(line)!, 'path', null, textMark('')).typeset?.path?.start, 0, 'with none, from its start');
});

test('the brackets: the start where the text begins, the end, the centre on its side; flipped, the other way about', () => {
  const along = typeOnPath(typeablePath(line)!, 'path', { x: 150, y: 100 }, textMark('Hello'));
  const [start, center, end] = pathBrackets(along)!;
  assert.deepEqual([start.at, end.at, center.at], [{ x: 150, y: 100 }, { x: 300, y: 100 }, { x: 225, y: 100 }]);
  assert.deepEqual(center.side, { x: 0, y: -1 }, 'the text stands above a path running right');
  // The end bracket dragged back along the path; the start one never past it.
  assert.deepEqual(dragBracket(along, 'end', { x: 260, y: 110 }), { end: 160 });
  assert.deepEqual(dragBracket(along, 'start', { x: 400, y: 100 }), { start: 199 });
  // The centre dragged across: the text flips; dragged on its own side, nothing.
  assert.deepEqual(dragBracket(along, 'center', { x: 225, y: 130 }), { flip: true });
  assert.equal(dragBracket(along, 'center', { x: 225, y: 80 }), null);
  const flipped = { ...along, typeset: { ...along.typeset!, path: { ...along.typeset!.path!, flip: true } } };
  const [fStart, fCenter] = pathBrackets(flipped)!;
  assert.deepEqual([fStart.at, fCenter.side], [{ x: 300, y: 100 }, { x: 0, y: 1 }], 'flipped it begins at the far end, below');
  assert.deepEqual(dragBracket(flipped, 'start', { x: 280, y: 100 }), { end: 180 }, 'its start bracket is the path\'s end');
  assert.equal(pathBrackets(textMark('plain')), null);
});

test('the red plus stands where the text runs out: a frame\'s lower right, a path text\'s end', () => {
  assert.equal(oversetPort(textMark('x'), { overset: false }), null);
  assert.deepEqual(oversetPort(textMark('x'), { overset: true, frame: { box: { maxX: 80, maxY: 40 } } }), { x: 80, y: 40 });
  const along = typeOnPath(typeablePath(line)!, 'path', null, textMark('Hello'));
  assert.deepEqual(oversetPort(along, { overset: true }), { x: 300, y: 100 });
});
