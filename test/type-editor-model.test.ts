/**
 * The type editor's model (src/core/type/caret.ts), with a measure whose
 * every character is half an em wide: the places a caret stands over runs,
 * lines, a path and vertical text; the index a point is nearest; the keys'
 * moves, by character, line, word and paragraph; a double-click's word and a
 * triple-click's paragraph; splicing, copied runs and attribute steps; and
 * which edits are one burst of typing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  burstContinues,
  caretAt,
  caretSegment,
  caretSlots,
  moveCaret,
  paragraphBounds,
  selectionQuads,
  wordBounds,
  wordStartAfter,
  wordStartBefore,
  type TextSelection,
} from '../src/core/type/caret.js';
import { layoutType } from '../src/core/type/layout.js';
import type { TypeMeasure } from '../src/core/type/measure.js';
import { applyChar, charAttrsAt, clipOf, spliceClip, spliceText, stepChar, withTypeset } from '../src/core/type/model.js';
import type { Stroke } from '../src/core/types.js';

const FIXED: TypeMeasure = {
  id: 'fixed',
  exact: true,
  smallCaps: false,
  width: (text, font) => [...text].length * font.size * 0.5,
  extent: (font) => ({ ascent: font.size * 0.8, descent: font.size * 0.2 }),
};

const mark = (text: string, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'tx',
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 10, y: 100, pressure: 0.5 }],
  text,
  fontSize: 20,
  fontFamily: 'Georgia',
  ...extra,
});

const at = (index: number): TextSelection => ({ anchor: index, focus: index });

/** Where a key takes a caret standing at `index`. */
function key(stroke: Stroke, from: TextSelection, move: Parameters<typeof moveCaret>[3], extend = false): TextSelection {
  return moveCaret(layoutType(stroke, FIXED), stroke.text ?? '', from, move, extend);
}

test('a caret stands before each character and after each line, as tall as what typing there copies; a point picks the nearest', () => {
  const two = mark('ab\ncd');
  const layout = layoutType(two, FIXED);
  assert.deepEqual(
    caretSlots(layout, 'ab\ncd').map((s) => [s.index, s.line, s.at.x, s.at.y]),
    [[0, 0, 10, 116], [1, 0, 20, 116], [2, 0, 30, 116], [3, 1, 10, 141], [4, 1, 20, 141], [5, 1, 30, 141]],
  );
  assert.deepEqual(caretSegment(layout, 'ab\ncd', at(2)), { at: { x: 30, y: 116 }, top: { x: 30, y: 100 }, bottom: { x: 30, y: 120 }, line: 0 });
  // In a line's band, the nearest place along it; between the lines, the nearer line.
  assert.deepEqual(caretAt(layout, 'ab\ncd', { x: 24, y: 110 }), { index: 1, line: 0 });
  assert.deepEqual(caretAt(layout, 'ab\ncd', { x: 28, y: 140 }), { index: 5, line: 1 });
  assert.deepEqual(caretAt(layout, 'ab\ncd', { x: -40, y: 400 }), { index: 3, line: 1 });
  // A run of a bigger size moves the places after it; the caret after it is as big, the caret after the next as small again.
  const big = applyChar(mark('abc'), { start: 1, end: 2 }, { fontSize: 40 });
  const bigLayout = layoutType(big, FIXED);
  assert.deepEqual(caretSlots(bigLayout, 'abc').map((s) => s.at.x), [10, 20, 40, 50]);
  const tall = (index: number): number => {
    const segment = caretSegment(bigLayout, 'abc', at(index))!;
    return segment.bottom.y - segment.top.y;
  };
  assert.deepEqual([tall(0), tall(1), tall(2), tall(3)], [20, 20, 40, 20], 'each as tall as the character it follows');
  // A superscript's caret is its size, and stands on its raised baseline.
  const raised = applyChar(mark('ab'), { start: 1, end: 2 }, { position: 'superscript' });
  const up = caretSegment(layoutType(raised, FIXED), 'ab', at(2))!;
  assert.ok(up.at.y < 116 - 1 && up.bottom.y - up.top.y < 20 - 1, JSON.stringify(up));
});

test('a selection covers each line it crosses, to the line end where it runs on', () => {
  const two = mark('ab\ncd');
  const quads = selectionQuads(layoutType(two, FIXED), 'ab\ncd', 1, 4);
  assert.deepEqual(
    quads.map((q) => [q[0].x, q[0].y, q[2].x, q[2].y]),
    [[20, 100, 30, 120], [10, 125, 20, 145]],
  );
  assert.deepEqual(selectionQuads(layoutType(two, FIXED), 'ab\ncd', 2, 2), [], 'a caret covers nothing');
  // Over characters of two sizes, the line's whole band.
  const big = applyChar(mark('abc'), { start: 1, end: 2 }, { fontSize: 40 });
  const band = selectionQuads(layoutType(big, FIXED), 'abc', 0, 3)[0];
  assert.deepEqual([band[0].y, band[2].y], [100, 140]);
});

test('the keys move by character and line in visual order, keep their goal, and Shift extends', () => {
  const two = mark('ab\ncd');
  assert.equal(key(two, at(1), 'right').focus, 2);
  assert.equal(key(two, at(2), 'right').focus, 3, 'over the newline');
  assert.equal(key(two, at(3), 'left').focus, 2);
  const down = key(two, at(1), 'down');
  assert.deepEqual([down.focus, down.goal], [4, 20], 'down keeps the place along the line');
  assert.equal(key(two, down, 'up').focus, 1);
  assert.equal(key(two, at(4), 'down').focus, 5, 'down on the last line goes to the end');
  assert.equal(key(two, at(1), 'up').focus, 0, 'and up on the first to the start');
  assert.deepEqual([key(two, at(4), 'line-start').focus, key(two, at(3), 'line-end').focus], [3, 5]);
  assert.deepEqual([key(two, at(4), 'text-start').focus, key(two, at(1), 'text-end').focus], [0, 5]);
  // Shift keeps the anchor; without it a selection collapses to its near end.
  assert.deepEqual(key(two, at(1), 'right', true), { anchor: 1, focus: 2 });
  assert.deepEqual([key(two, { anchor: 0, focus: 2 }, 'left').focus, key(two, { anchor: 2, focus: 0 }, 'right').focus], [0, 2]);
  // A surrogate pair is one step.
  const face = mark('a\u{1F600}b');
  assert.deepEqual([key(face, at(1), 'right').focus, key(face, at(3), 'left').focus], [3, 1]);
});

test('a line wrapped at a space: its end and the next start share an index, End keeps the caret on the first', () => {
  const boxed = mark('aaaa bbbb', { fontSize: 10, points: [{ x: 0, y: 0, pressure: 0.5 }], textBoxWidth: 40 });
  const layout = layoutType(boxed, FIXED);
  const end = key(boxed, at(2), 'line-end');
  assert.deepEqual([end.focus, end.line], [5, 0]);
  assert.equal(caretSegment(layout, 'aaaa bbbb', end)!.top.x, 25, 'after the space, on the first line');
  assert.equal(caretSegment(layout, 'aaaa bbbb', at(5))!.top.x, 0, 'without the hint, at the start of the next');
});

test('along a path the caret follows the path; up and down go to its ends', () => {
  const along = withTypeset(mark('abc'), {
    kind: 'path',
    path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 200, y: 0 } }], start: 0, end: 200, align: 'baseline', effect: 'rainbow' },
  });
  const layout = layoutType(along, FIXED);
  assert.deepEqual(caretSlots(layout, 'abc').map((s) => [s.at.x, s.at.y]), [[10, 100], [20, 100], [30, 100], [40, 100]]);
  assert.deepEqual(caretAt(layout, 'abc', { x: 24, y: 90 }), { index: 1, line: 0 });
  assert.deepEqual([key(along, at(1), 'up').focus, key(along, at(1), 'down').focus], [0, 3]);
  // Flipped, it runs back from the far end: the first place is there.
  const flipped = withTypeset(mark('abc'), {
    kind: 'path',
    path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 200, y: 0 } }], start: 0, end: 200, flip: true, align: 'baseline', effect: 'rainbow' },
  });
  assert.equal(caretSlots(layoutType(flipped, FIXED), 'abc')[0].at.x, 210);
});

test('vertical text swaps the axes: up and down step through a column, left goes to the next column', () => {
  const up = withTypeset(mark('ab\ncd', { points: [{ x: 100, y: 0, pressure: 0.5 }] }), { kind: 'point', orientation: 'vertical' });
  const layout = layoutType(up, FIXED);
  assert.deepEqual(
    caretSlots(layout, 'ab\ncd').map((s) => [s.index, s.at.x, s.at.y]),
    [[0, 90, 0], [1, 90, 20], [2, 90, 40], [3, 65, 0], [4, 65, 20], [5, 65, 40]],
  );
  assert.equal(key(up, at(0), 'down').focus, 1);
  assert.equal(key(up, at(1), 'up').focus, 0);
  assert.equal(key(up, at(1), 'left').focus, 4, 'left to the next column, at the same height');
  assert.equal(key(up, at(4), 'right').focus, 1);
  assert.deepEqual(caretAt(layout, 'ab\ncd', { x: 66, y: 22 }), { index: 4, line: 1 });
  const segment = caretSegment(layout, 'ab\ncd', at(1))!;
  assert.deepEqual([segment.top.x, segment.bottom.x, segment.top.y], [100, 80, 20], 'the caret lies across the column');
});

test('word and paragraph moves and bounds: Ctrl+arrows, a double-click and a triple-click', () => {
  const text = 'Hello, big world';
  assert.deepEqual(wordBounds(text, 2), { start: 0, end: 5 });
  assert.deepEqual(wordBounds(text, 5), { start: 0, end: 5 }, 'at the end of a word, the word before');
  assert.deepEqual(wordBounds(text, 6), { start: 6, end: 7 }, 'in a space, the run of spaces');
  assert.deepEqual([wordStartBefore(text, 11), wordStartAfter(text, 7), wordStartAfter(text, 0)], [7, 11, 7]);
  assert.deepEqual(paragraphBounds('one\ntwo\nthree', 5), { start: 4, end: 7 });
  const three = mark('one\ntwo\nthree');
  assert.equal(key(three, at(5), 'paragraph-up').focus, 4, 'to the start of its paragraph');
  assert.equal(key(three, at(4), 'paragraph-up').focus, 0, 'from its start, to the one before');
  assert.equal(key(three, at(1), 'paragraph-down').focus, 4);
  assert.equal(key(three, at(9), 'paragraph-down').focus, 13);
  assert.equal(key(mark(text), at(11), 'word-left').focus, 7);
});

test('typing takes the style before the caret; copied runs keep their own; steps go from what each character has', () => {
  const bold = applyChar(mark('ab'), { start: 1, end: 2 }, { fontStyle: 'Bold' });
  assert.equal(charAttrsAt(spliceText(bold, 2, 2, 'X'), 2).fontStyle, 'Bold', 'typed after the bold b, bold');
  assert.equal(charAttrsAt(spliceText(bold, 1, 1, 'X'), 1).fontStyle, 'Regular', 'typed after the plain a, plain');
  // Copied from one text, pasted into another, the runs come too.
  const clip = clipOf(bold, 1, 2);
  assert.deepEqual([clip.text, clip.runs.map((r) => [r.start, r.end, r.attrs.fontStyle])], ['b', [[0, 1, 'Bold']]]);
  const pasted = spliceClip(mark('xy'), 1, 1, clip);
  assert.deepEqual([pasted.text, charAttrsAt(pasted, 1).fontStyle, charAttrsAt(pasted, 2).fontStyle], ['xby', 'Bold', 'Regular']);
  // A size step adds to each character's own size; auto leading steps from the leading it stands for.
  const sized = stepChar(applyChar(mark('abc'), { start: 1, end: 2 }, { fontSize: 40 }), { start: 0, end: 3 }, 'fontSize', 2);
  assert.deepEqual([0, 1, 2].map((i) => charAttrsAt(sized, i).fontSize), [22, 42, 22]);
  const led = stepChar(mark('abc'), { start: 0, end: 3 }, 'leading', -2);
  assert.equal(charAttrsAt(led, 0).leading, 23);
});

test('a burst of typing is the edits that follow on from each other within a second', () => {
  const first = { at: 0, from: 3, to: 4 };
  assert.equal(burstContinues(null, first), false, 'the first edit starts one');
  assert.equal(burstContinues(first, { at: 400, from: 4, to: 5 }), true);
  assert.equal(burstContinues(first, { at: 1400, from: 4, to: 5 }), false, 'after a pause, a new burst');
  assert.equal(burstContinues(first, { at: 400, from: 9, to: 10 }), false, 'after a caret jump, a new burst');
  assert.equal(burstContinues(first, { at: 500, from: 4, to: 3 }), true, 'a backspace carries it on');
});
