/**
 * Transform tool tests: which point stays still, and which factors come out.
 *
 * Everything else about the tool is drawing and pointer plumbing. This is the
 * part that has four rules interacting - the handle decides which axes move,
 * `Shift` makes the factors agree, `Alt` moves the point they are measured
 * from - and it is the part where a wrong sign or a swapped anchor is a
 * selection that jumps across the page rather than a compile error.
 *
 * The box used throughout is 100 wide and 50 tall at (100, 100), so its
 * centre is (150, 125) and every expected number below can be read off it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  opposite,
  scaledBox,
  SCALE_FACTOR_MAX,
  SCALE_FACTOR_MIN,
  transformAnchor,
  transformCursor,
  transformHandlePoint,
  transformScale,
  transformScalesX,
  transformScalesY,
  TRANSFORM_HANDLES,
  type TransformBox,
} from '../src/core/transform.js';

const BOX: TransformBox = { minX: 100, minY: 100, maxX: 200, maxY: 150 };

/** Rounds away the float dust a ratio of two subtractions leaves behind. */
function near(value: number): number {
  return Number(value.toFixed(9));
}

test('every handle is its own opposite twice over', () => {
  for (const handle of TRANSFORM_HANDLES) {
    assert.equal(opposite(opposite(handle)), handle, handle);
    assert.notEqual(opposite(handle), handle, handle);
  }
  assert.equal(opposite('nw'), 'se');
  assert.equal(opposite('e'), 'w');
  assert.equal(opposite('n'), 's');
});

test('a handle sits on its corner, or halfway along its side', () => {
  assert.deepEqual(transformHandlePoint(BOX, 'nw'), { x: 100, y: 100 });
  assert.deepEqual(transformHandlePoint(BOX, 'se'), { x: 200, y: 150 });
  // A side handle is pinned on its own axis and centred on the other.
  assert.deepEqual(transformHandlePoint(BOX, 'e'), { x: 200, y: 125 });
  assert.deepEqual(transformHandlePoint(BOX, 'n'), { x: 150, y: 100 });
});

test('the handle decides which axes move, and no modifier changes that', () => {
  // Sides across, top and bottom down, corners both. This is the rule the two
  // modifiers are layered on top of, never the rule they replace.
  assert.deepEqual(
    TRANSFORM_HANDLES.filter(transformScalesX),
    ['nw', 'ne', 'e', 'se', 'sw', 'w'],
  );
  assert.deepEqual(
    TRANSFORM_HANDLES.filter(transformScalesY),
    ['nw', 'n', 'ne', 'se', 's', 'sw'],
  );
});

// ---- Nothing held: the opposite side stays, each axis on its own ------------

test('dragging a side scales one axis, and the far side stays put', () => {
  // East handle at x=200 pulled to x=300, anchored on the west edge at 100:
  // the width goes 100 -> 200.
  const scale = transformScale(BOX, 'e', { x: 300, y: 999 });
  assert.equal(near(scale.sx), 2);
  assert.equal(near(scale.sy), 1, 'a side handle must not touch the height');
  assert.deepEqual({ x: scale.ox, y: scale.oy }, { x: 100, y: 125 });

  // And the box that leaves keeps its left edge exactly where it was.
  const after = scaledBox(BOX, scale);
  assert.deepEqual(after, { minX: 100, minY: 100, maxX: 300, maxY: 150 });
});

test('dragging a corner scales both axes, each by its own amount', () => {
  // se from (200,150) to (300,250), anchored on nw: x doubles, y triples.
  const scale = transformScale(BOX, 'se', { x: 300, y: 250 });
  assert.equal(near(scale.sx), 2);
  assert.equal(near(scale.sy), 3);
  assert.deepEqual({ x: scale.ox, y: scale.oy }, { x: 100, y: 100 });
});

test('dragging a top or bottom handle scales only the height', () => {
  // n from y=100 to y=50, anchored on the bottom edge at 150: 50 tall -> 100.
  const scale = transformScale(BOX, 'n', { x: 999, y: 50 });
  assert.equal(near(scale.sx), 1);
  assert.equal(near(scale.sy), 2);
  assert.equal(scale.oy, 150);
});

// ---- Shift: one factor on both axes ----------------------------------------

test('Shift on a corner scales uniformly, following whichever axis led', () => {
  // The same drag as the corner test above: x asked for 2 and y for 3, and
  // uniform means the selection keeps its shape, so both take the larger.
  const scale = transformScale(BOX, 'se', { x: 300, y: 250 }, { uniform: true });
  assert.equal(near(scale.sx), 3);
  assert.equal(near(scale.sy), 3);
  assert.deepEqual({ x: scale.ox, y: scale.oy }, { x: 100, y: 100 });

  // Aspect ratio survives: a 2:1 box is still 2:1 afterwards.
  const after = scaledBox(BOX, scale);
  assert.equal(near((after.maxX - after.minX) / (after.maxY - after.minY)), 2);
});

test('Shift on a side scales both axes from the one it can measure', () => {
  // This is the whole point of Shift on a side: grow the selection without
  // reshaping it, from a handle that on its own only knows about width.
  const scale = transformScale(BOX, 'e', { x: 300, y: 999 }, { uniform: true });
  assert.equal(near(scale.sx), 2);
  assert.equal(near(scale.sy), 2);
  assert.equal(scale.ox, 100);
});

// ---- Alt: the centre stays still -------------------------------------------

test('Alt anchors on the centre, so both sides move outward together', () => {
  assert.deepEqual(transformAnchor(BOX, 'e', true), { x: 150, y: 125 });
  assert.deepEqual(transformAnchor(BOX, 'nw', true), { x: 150, y: 125 });

  // East handle from x=200 to x=250. Measured from the centre at 150 that is
  // 100/50 = 2, so the box grows both ways and stays centred.
  const scale = transformScale(BOX, 'e', { x: 250, y: 999 }, { fromCenter: true });
  assert.equal(near(scale.sx), 2);
  assert.equal(near(scale.sy), 1);
  const after = scaledBox(BOX, scale);
  assert.deepEqual(after, { minX: 50, minY: 100, maxX: 250, maxY: 150 });
  assert.equal((after.minX + after.maxX) / 2, 150);
});

test('Alt on a corner still scales each axis on its own', () => {
  // Not uniform: Alt moves the anchor and says nothing about the factors.
  const scale = transformScale(BOX, 'se', { x: 250, y: 175 }, { fromCenter: true });
  assert.equal(near(scale.sx), 2);
  assert.equal(near(scale.sy), 2);

  const stretched = transformScale(BOX, 'se', { x: 250, y: 150 }, { fromCenter: true });
  assert.equal(near(stretched.sx), 2);
  assert.equal(near(stretched.sy), 1);
});

// ---- Shift + Alt: uniform, from the centre ---------------------------------

test('Shift and Alt together scale uniformly about the centre', () => {
  const scale = transformScale(
    BOX,
    'se',
    { x: 250, y: 150 },
    { uniform: true, fromCenter: true },
  );
  assert.equal(near(scale.sx), 2);
  assert.equal(near(scale.sy), 2);
  assert.deepEqual({ x: scale.ox, y: scale.oy }, { x: 150, y: 125 });

  const after = scaledBox(BOX, scale);
  // Centred, and the same shape it started as.
  assert.equal((after.minX + after.maxX) / 2, 150);
  assert.equal((after.minY + after.maxY) / 2, 125);
  assert.equal(near((after.maxX - after.minX) / (after.maxY - after.minY)), 2);
});

// ---- The edges of the gesture ----------------------------------------------

test('dragging through the anchor stops at a sliver rather than flipping', () => {
  // Flipping is a real thing to want and this tool does not do it yet: a text
  // item's font size and an image's width are magnitudes, so a negative
  // factor would mirror the geometry and destroy those. Stopping is the
  // honest failure.
  const scale = transformScale(BOX, 'e', { x: 0, y: 999 });
  assert.equal(scale.sx, SCALE_FACTOR_MIN);
  assert.ok(scale.sx > 0);
  assert.equal(scaledBox(BOX, scale).minX, 100, 'the anchor still holds');
});

test('a wild drag is held to what one gesture may do', () => {
  const scale = transformScale(BOX, 'e', { x: 1e9, y: 0 });
  assert.equal(scale.sx, SCALE_FACTOR_MAX);
});

test('a selection with no width in an axis is left alone on that axis', () => {
  // A single vertical line has no width, so there is no distance to take a
  // ratio of - and a ratio of zero over zero would be every stroke collapsing
  // onto one point.
  const line: TransformBox = { minX: 100, minY: 100, maxX: 100, maxY: 200 };
  const scale = transformScale(line, 'se', { x: 400, y: 300 });
  assert.equal(scale.sx, 1);
  assert.equal(near(scale.sy), 2);
});

test('each handle asks for the cursor that says which way it goes', () => {
  assert.equal(transformCursor('n'), 'ns-resize');
  assert.equal(transformCursor('w'), 'ew-resize');
  assert.equal(transformCursor('nw'), 'nwse-resize');
  assert.equal(transformCursor('ne'), 'nesw-resize');
  // Opposite handles pull along the same line, so they share a cursor.
  for (const handle of TRANSFORM_HANDLES) {
    assert.equal(transformCursor(handle), transformCursor(opposite(handle)), handle);
  }
});
