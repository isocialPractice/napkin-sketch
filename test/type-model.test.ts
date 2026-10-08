/**
 * The type model (src/core/type/model.ts): restyling a stretch splits and
 * joins runs; a paragraph edit takes whole paragraphs; editing the text
 * shifts the runs and the paragraphs, what is typed taking the style before
 * it; the base keeps in step with the first character; a box from before
 * reads as area type; and what a file says is held to a vector editor's
 * ranges.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyChar,
  applyPara,
  charAttrsAt,
  mirrorTypeset,
  paraAttrsOf,
  readCharAttrs,
  readTypeset,
  rectangleAnchors,
  scaleTypeset,
  scaleTypeShape,
  spliceText,
  styleSegments,
  TYPE_LIMITS,
  textColorPatch,
  typesetIsShape,
  typeSpecOf,
  withTypeset,
} from '../src/core/type/model.js';
import type { Stroke } from '../src/core/types.js';

const mark = (text: string, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'tx',
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 10, y: 20, pressure: 0.5 }],
  text,
  fontSize: 24,
  fontFamily: 'Georgia',
  ...extra,
});

test('restyling a stretch splits the runs at its ends, and restyling it back joins them again', () => {
  const hello = mark('Hello world');
  const bold = applyChar(hello, { start: 6, end: 11 }, { fontStyle: 'Bold' });
  assert.deepEqual(bold.typeset?.runs, [{ start: 6, end: 11, attrs: { fontStyle: 'Bold' } }]);
  // Underline across the boundary: three runs, the middle one both.
  const under = applyChar(bold, { start: 3, end: 8 }, { underline: true });
  assert.deepEqual(under.typeset?.runs, [
    { start: 3, end: 6, attrs: { underline: true } },
    { start: 6, end: 8, attrs: { fontStyle: 'Bold', underline: true } },
    { start: 8, end: 11, attrs: { fontStyle: 'Bold' } },
  ]);
  // The same value again changes nothing.
  assert.deepEqual(applyChar(under, { start: 6, end: 8 }, { fontStyle: 'Bold' }).typeset?.runs, under.typeset?.runs);
  // Taken off again, the runs join back to one, and to none.
  const off = applyChar(under, { start: 0, end: 11 }, { underline: false });
  assert.deepEqual(off.typeset?.runs, [{ start: 6, end: 11, attrs: { fontStyle: 'Bold' } }]);
  const plain = applyChar(off, { start: 0, end: 11 }, { fontStyle: 'Regular' });
  assert.equal(plain.typeset, undefined, 'plain point text needs no typeset at all');
  // The input mark is never changed.
  assert.equal(hello.typeset, undefined);
});

test('the base keeps in step with the first character, and the rest keeps the style it had', () => {
  const big = applyChar(mark('Hello world'), { start: 0, end: 5 }, { fontSize: 40, color: '#e8590c' });
  assert.equal(big.fontSize, 40, 'the base takes the first character size');
  assert.equal(big.color, '#e8590c');
  assert.deepEqual(big.typeset?.runs, [{ start: 5, end: 11, attrs: { fontSize: 24, color: '#1f2328' } }], 'and the rest keeps the old base as a run');
  assert.equal(charAttrsAt(big, 7).fontSize, 24);
  assert.equal(charAttrsAt(big, 0).fontSize, 40);
  // A family on the whole text is just the base.
  const all = applyChar(mark('Hi'), { start: 0, end: 2 }, { fontFamily: 'Courier New' });
  assert.equal(all.fontFamily, 'Courier New');
  assert.equal(all.typeset, undefined);
});

test('a paragraph edit takes the whole paragraphs a range touches, and a default value takes itself away', () => {
  const three = mark('one\ntwo\nthree');
  const centred = applyPara(three, { start: 5, end: 9 }, { align: 'center' });
  assert.deepEqual(centred.typeset?.paras, [null, { align: 'center' }, { align: 'center' }]);
  assert.equal(paraAttrsOf(centred, 0).align, 'left');
  const listed = applyPara(centred, { start: 0, end: 0 }, { list: { kind: 'number', level: 1 } });
  assert.deepEqual(listed.typeset?.paras?.[0], { list: { kind: 'number', level: 1 } });
  const back = applyPara(listed, { start: 0, end: 13 }, { align: 'left', list: undefined });
  assert.equal(back.typeset, undefined, 'all back to the defaults: no paragraph entries, no typeset');
});

test("editing the text shifts the runs, what is typed taking the style of the character before it", () => {
  const styled = applyChar(mark('Hello world'), { start: 6, end: 11 }, { underline: true });
  // Typed at the end of the underlined word: underlined too.
  const more = spliceText(styled, 11, 11, '!!');
  assert.equal(more.text, 'Hello world!!');
  assert.deepEqual(more.typeset?.runs, [{ start: 6, end: 13, attrs: { underline: true } }]);
  // Typed before it, after the space: not underlined, and the run shifts along.
  const before = spliceText(styled, 6, 6, 'big ');
  assert.equal(before.text, 'Hello big world');
  assert.deepEqual(before.typeset?.runs, [{ start: 10, end: 15, attrs: { underline: true } }]);
  // A deletion across the run's start cuts it.
  const cut = spliceText(styled, 4, 8, '');
  assert.equal(cut.text, 'Hellrld');
  assert.deepEqual(cut.typeset?.runs, [{ start: 4, end: 7, attrs: { underline: true } }]);
  // At the very start, what is typed takes the first character's style.
  const big = applyChar(mark('ab'), { start: 0, end: 1 }, { fontSize: 40 });
  const front = spliceText(big, 0, 0, 'X');
  assert.equal(charAttrsAt(front, 0).fontSize, 40);
  assert.equal(front.fontSize, 40);
});

test('a newline typed splits a paragraph, both halves keeping its attributes; one taken out joins them as the first', () => {
  const two = applyPara(mark('first\nsecond'), { start: 0, end: 0 }, { align: 'right' });
  const split = spliceText(two, 2, 2, '\n');
  assert.equal(split.text, 'fi\nrst\nsecond');
  assert.deepEqual(split.typeset?.paras, [{ align: 'right' }, { align: 'right' }]);
  const joined = spliceText(two, 5, 6, ' ');
  assert.equal(joined.text, 'first second');
  assert.deepEqual(joined.typeset?.paras, [{ align: 'right' }]);
});

test('a box from before reads as Sheet Typing in a rectangle that grows to fit, and writes its width back', () => {
  const boxed = mark('wrapped text', { textBoxWidth: 120 });
  const spec = typeSpecOf(boxed);
  assert.equal(spec.kind, 'area');
  assert.equal(spec.frame?.autoHeight, true);
  assert.deepEqual(spec.frame?.anchors.map((a) => [a.p.x, a.p.y]), [[0, 0], [120, 0], [120, 30], [0, 30]]);
  // An edit to it keeps the frame, and the width for a build from before.
  const edited = applyChar(boxed, { start: 0, end: 7 }, { underline: true });
  assert.equal(edited.typeset?.kind, 'area');
  assert.equal(edited.textBoxWidth, 120);
  assert.equal(typeSpecOf(mark('point')).kind, 'point');
});

test("what a file says is held to a vector editor's ranges, and runs are cut to the text and kept apart", () => {
  const attrs = readCharAttrs({ fontSize: 99999, tracking: -5000, hScale: 0, vScale: 20000, baselineShift: 5000, rotation: 270, kerning: 'sometimes', caps: 'all', color: '' });
  assert.equal(attrs.fontSize, TYPE_LIMITS.fontSize.max, '1296 points');
  assert.equal(attrs.tracking, -1000);
  assert.equal(attrs.hScale, 1);
  assert.equal(attrs.vScale, 10000);
  assert.equal(attrs.baselineShift, 1296);
  assert.equal(attrs.rotation, -90, 'a turn held to -180 to 180');
  assert.equal(attrs.kerning, undefined, 'a word that is not a choice is dropped');
  assert.equal(attrs.caps, 'all');
  assert.equal(attrs.color, undefined);
  const spec = readTypeset(
    {
      kind: 'path',
      path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], start: -5, effect: 'wobble' },
      runs: [
        { start: 2, end: 99, attrs: { underline: true } },
        { start: 0, end: 4, attrs: { strike: true } },
        { start: 7, end: 7, attrs: { strike: true } },
        { start: 'x', end: 2, attrs: { strike: true } },
      ],
      paras: [{ align: 'center' }, { align: 'nowhere' }, { align: 'right' }],
    },
    'short\nline',
  );
  assert.equal(spec?.kind, 'path');
  assert.equal(spec?.path?.start, 0);
  assert.equal(spec?.path?.effect, 'rainbow');
  assert.equal(spec?.path?.align, 'baseline');
  assert.deepEqual(spec?.runs, [
    { start: 0, end: 4, attrs: { strike: true } },
    { start: 4, end: 10, attrs: { underline: true } },
  ]);
  assert.deepEqual(spec?.paras, [{ align: 'center' }], 'one entry a paragraph, the empty and the extra dropped');
  // A frame that does not read leaves point type.
  assert.equal(readTypeset({ kind: 'area', frame: { anchors: 'none' } }, 'x')?.kind, 'point');
  // Made sound and in step: a script's typeset, its runs against the base.
  const built = withTypeset(mark('Hi there'), { kind: 'point', runs: [{ start: 0, end: 8, attrs: { tracking: 50 } }] });
  assert.deepEqual(built.typeset?.runs, [{ start: 0, end: 8, attrs: { tracking: 50 } }]);
  assert.deepEqual(styleSegments(built).map((s) => [s.start, s.end, s.attrs.tracking]), [[0, 8, 50]]);
});

test('a typeset scales and mirrors with its mark: its path or frame about the anchor, its lengths by the mean scale', () => {
  const along = withTypeset(mark('abc'), {
    kind: 'path',
    path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], start: 10, end: 60, align: 'baseline', effect: 'rainbow' },
    runs: [{ start: 1, end: 2, attrs: { fontSize: 30, baselineShift: 4, leading: 40 } }],
    paras: [{ leftIndent: 10 }],
  });
  const scaled = scaleTypeset(along.typeset!, 2, 2);
  assert.deepEqual(scaled.path?.anchors.map((a) => [a.p.x, a.p.y]), [[0, 0], [200, 0]]);
  assert.deepEqual([scaled.path?.start, scaled.path?.end], [20, 120], 'start and end keep their share of the length');
  assert.deepEqual(scaled.runs?.[0].attrs, { fontSize: 60, leading: 80, baselineShift: 8 });
  assert.deepEqual(scaled.paras, [{ leftIndent: 20 }]);
  // Mirrored left to right, the path reflects and its text runs the other way, still readable.
  const mirrored = mirrorTypeset(along.typeset!, true, false);
  assert.deepEqual(mirrored.path?.anchors.map((a) => [a.p.x + 0, a.p.y + 0]), [[0, 0], [-100, 0]]);
  assert.equal(mirrored.path?.flip, true);
  assert.equal(mirrorTypeset(mirrored, true, false).path?.flip, undefined, 'and back');
  // A path, or a frame that is not a rectangle, is a shape that turns with its mark; a text box is not.
  assert.equal(typesetIsShape(along.typeset), true);
  assert.equal(typesetIsShape(typeSpecOf(mark('boxed', { textBoxWidth: 100 }))), false);
});

test("a typeset that says no more than a box from before is that box; one typeset is one string", () => {
  const boxed = withTypeset(mark('wrap me'), { kind: 'area', frame: { anchors: rectangleAnchors(120, 30), autoHeight: true } });
  assert.equal(boxed.typeset, undefined);
  assert.equal(boxed.textBoxWidth, 120);
  // Fields in one order, whatever order they were given in.
  const a = withTypeset(mark('One\nTwo'), { kind: 'point', paras: [{ hyphenate: true, align: 'center' }], runs: [{ start: 0, end: 3, attrs: { underline: true } }] });
  const b = withTypeset(mark('One\nTwo'), { runs: [{ start: 0, end: 3, attrs: { underline: true } }], kind: 'point', paras: [{ align: 'center', hyphenate: true }] } as never);
  assert.equal(JSON.stringify(a.typeset), JSON.stringify(b.typeset));
  assert.deepEqual(Object.keys(a.typeset!), ['kind', 'runs', 'paras']);
});

test('a text recolored whole takes the color in its runs too, its highlight kept', () => {
  const styled = applyChar(applyChar(mark('Hello world'), { start: 6, end: 11 }, { color: '#c0392b' }), { start: 0, end: 5 }, { highlight: '#ffd43b' });
  const patch = textColorPatch(styled, '#2f6feb');
  assert.equal(patch.color, '#2f6feb');
  assert.deepEqual(patch.typeset?.runs, [{ start: 0, end: 5, attrs: { highlight: '#ffd43b' } }]);
  assert.deepEqual(textColorPatch(mark('plain'), '#2f6feb'), { color: '#2f6feb' }, 'a text in one color takes it plainly');
});

test("a frame or a path scales alone, its type keeping its size; a path's spacing is read, held to its range and scaled", () => {
  const line = [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }];
  const along = withTypeset(mark('abc'), {
    kind: 'path',
    path: { anchors: line, start: 10, end: 60, align: 'baseline', effect: 'rainbow', spacing: 6 },
    runs: [{ start: 1, end: 2, attrs: { fontSize: 30 } }],
  });
  const scaled = scaleTypeShape(along.typeset!, 2, 2);
  assert.deepEqual(scaled.path?.anchors.map((a) => [a.p.x, a.p.y]), [[0, 0], [200, 0]]);
  assert.deepEqual([scaled.path?.start, scaled.path?.end, scaled.path?.spacing], [20, 120, 12], 'start, end and spacing keep their share of the length');
  assert.deepEqual(scaled.runs?.[0].attrs, { fontSize: 30 }, 'the type keeps its size');
  const sheet = withTypeset(mark('abc'), { kind: 'area', frame: { anchors: rectangleAnchors(100, 50), inset: 4 } });
  const wide = scaleTypeShape(sheet.typeset!, 2, 1);
  assert.deepEqual(wide.frame?.anchors.map((a) => [a.p.x, a.p.y]), [[0, 0], [200, 0], [200, 50], [0, 50]]);
  assert.equal(wide.frame?.inset, 4, "the inset is the type's, and keeps its size too");
  // No spacing is left out of the file, and a file's is held to a vector editor's range.
  assert.equal(readTypeset({ kind: 'path', path: { anchors: line, spacing: 0 } }, 'x')?.path?.spacing, undefined);
  assert.equal(readTypeset({ kind: 'path', path: { anchors: line, spacing: 1e9 } }, 'x')?.path?.spacing, TYPE_LIMITS.pathSpacing.max);
  assert.equal(readTypeset({ kind: 'path', path: { anchors: line, spacing: -1e9 } }, 'x')?.path?.spacing, TYPE_LIMITS.pathSpacing.min);
});
