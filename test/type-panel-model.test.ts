/**
 * The Type panel's model (src/core/type/panel.ts): what the panel reads from
 * the text it acts on - a stretch, a caret, whole marks - and blanks where
 * they differ; values typed into its fields, with their units; the changes
 * its controls make, over a stretch and at a caret; the percent leading; and
 * a numbered list counting the way its style says. The GUI check
 * `check-type-panel.mjs` drives the panel itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutType } from '../src/core/type/layout.js';
import { applyChar, applyPara, charAttrsAt, paraAttrsOf, spliceText, withTypeset } from '../src/core/type/model.js';
import {
  applyTypeChange,
  kernIndex,
  listChange,
  nextTextReading,
  parseAmount,
  parseKerning,
  parseLeading,
  parseLength,
  primaryFamily,
  readTargets,
  showAmount,
  showKerning,
  showLeading,
  showLength,
  toggleChange,
  toggleState,
  typingPatch,
  type TypeTarget,
} from '../src/core/type/panel.js';
import type { Stroke } from '../src/core/types.js';

const mark = (id: string, text: string, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 0, y: 0, pressure: 0.5 }],
  text,
  fontSize: 24,
  fontFamily: 'Georgia',
  ...extra,
});

const whole = (stroke: Stroke): TypeTarget => ({ stroke, start: 0, end: (stroke.text ?? '').length });

test('a field shows what every target has, and is blank where they differ', () => {
  const big = mark('a', 'Big', { fontSize: 36 });
  const small = mark('b', 'Small', { fontSize: 12 });
  const both = readTargets([whole(big), whole(small)])!;
  assert.equal(both.char.fontSize, null, 'two sizes: blank');
  assert.equal(both.char.fontFamily, 'Georgia', 'one family: shown');
  assert.equal(both.para.align, 'left');
  assert.equal(both.para.list, 'none');
  // A stretch of one text: the characters in it, a bold run half inside.
  const runs = applyChar(mark('c', 'plain bold'), { start: 6, end: 10 }, { fontStyle: 'Bold' });
  assert.equal(readTargets([{ stroke: runs, start: 4, end: 8 }])!.char.fontStyle, null);
  assert.equal(readTargets([{ stroke: runs, start: 6, end: 8 }])!.char.fontStyle, 'Bold');
  // A caret: what typing there would set, the typing attributes over it.
  const caret = readTargets([{ stroke: runs, start: 10, end: 10, typing: { fontSize: 40 } }])!;
  assert.deepEqual([caret.char.fontStyle, caret.char.fontSize], ['Bold', 40]);
  // Paragraphs the stretch touches; orientation; a path.
  const centred = applyPara(mark('d', 'one\ntwo'), { start: 4, end: 4 }, { align: 'center' });
  assert.equal(readTargets([{ stroke: centred, start: 1, end: 5 }])!.para.align, null);
  assert.equal(readTargets([{ stroke: centred, start: 5, end: 5 }])!.para.align, 'center');
  const along = withTypeset(mark('e', 'arc'), { kind: 'path', path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], start: 0, end: 100, align: 'baseline', effect: 'rainbow' } });
  const read = readTargets([whole(along), whole(big)])!;
  assert.deepEqual([read.path, read.orientation], [true, 'horizontal']);
  assert.equal(readTargets([]), null, 'nothing to act on');
  // With nothing, the next text's.
  assert.deepEqual([nextTextReading({ fontSize: 18 }).char.fontSize, nextTextReading({}).para.list], [18, 'none']);
});

test('typed values: lengths in any unit, points when bare; shares, angles, kerning, and what is not a value', () => {
  assert.equal(parseLength('12'), 16);
  assert.equal(parseLength('12 pt'), 16);
  assert.equal(parseLength('16px'), 16);
  assert.ok(Math.abs(parseLength('3mm')! - 11.3386) < 1e-3);
  assert.ok(Math.abs(parseLength('1cm')! - 37.7953) < 1e-3);
  assert.equal(parseLength('0.5in'), 48);
  assert.equal(parseLength('1pc'), 16);
  assert.equal(parseLength('-2'), -8 / 3);
  assert.equal(parseLength('.5 PT'), 2 / 3);
  for (const bad of ['', 'big', '12 em', '1..2', '12pt3']) assert.equal(parseLength(bad), null, bad);
  assert.equal(parseAmount('75%', '%'), 75);
  assert.equal(parseAmount('75', '%'), 75);
  assert.equal(parseAmount('-15°', '°'), -15);
  assert.equal(parseAmount('15deg', '°'), null);
  assert.deepEqual(parseKerning('Auto'), { kerning: 'auto' });
  assert.deepEqual(parseKerning(' none '), { kerning: 'none' });
  assert.deepEqual(parseKerning('-40'), { kern: -40 });
  assert.equal(parseKerning('loose'), null);
  // As the fields show them.
  assert.deepEqual([showLength(16), showLength(null), showLength(-8 / 3)], ['12 pt', '', '-2 pt']);
  assert.deepEqual([showAmount(100, '%'), showAmount(null, '%')], ['100%', '']);
  assert.deepEqual([showLeading('auto'), showLeading(32), showLeading(null)], ['Auto', '24 pt', '']);
  assert.deepEqual([showKerning('auto', 0), showKerning('none', 0), showKerning('auto', -40), showKerning(null, 0), showKerning('auto', null)], ['Auto', 'None', '-40', '', '']);
  assert.equal(primaryFamily('"Segoe UI", system-ui, sans-serif'), 'Segoe UI');
});

test('leading as a share of the size: each character its own size times the share, and Auto', () => {
  assert.deepEqual(parseLeading('140%'), { share: 1.4 });
  assert.deepEqual(parseLeading('auto'), { auto: true });
  assert.deepEqual(parseLeading('18'), { px: 24 });
  assert.equal(parseLeading('-5%'), null);
  const mixed = applyChar(mark('a', 'abcd'), { start: 2, end: 4 }, { fontSize: 40 });
  const tall = applyTypeChange(whole(mixed), { kind: 'leading-share', share: 1.4 });
  assert.deepEqual([0, 3].map((i) => charAttrsAt(tall, i).leading), [24 * 1.4, 40 * 1.4]);
  // At a caret it is the typing attributes', from the size typing would set.
  assert.deepEqual(typingPatch({ kind: 'leading-share', share: 1.5 }, charAttrsAt(mixed, 3)), { leading: 60 });
  assert.equal(applyTypeChange({ stroke: mixed, start: 2, end: 2 }, { kind: 'leading-share', share: 2 }), mixed, 'the text itself is left as it is');
});

test('a change over a stretch, at a caret, and over whole marks', () => {
  const text = mark('a', 'ab\ncd');
  // Characters over a stretch; at a caret they are the typing attributes', not the text's.
  const sized = applyTypeChange({ stroke: text, start: 0, end: 2 }, { kind: 'char', patch: { fontSize: 30 } });
  assert.deepEqual([charAttrsAt(sized, 1).fontSize, charAttrsAt(sized, 3).fontSize], [30, 24]);
  assert.equal(applyTypeChange({ stroke: text, start: 1, end: 1 }, { kind: 'char', patch: { fontSize: 30 } }), text);
  assert.deepEqual(typingPatch({ kind: 'char', patch: { fontSize: 30 } }, charAttrsAt(text, 0)), { fontSize: 30 });
  // Kerning by hand: at the caret, the character before it; none at a line's start; over a stretch, every character.
  assert.equal(charAttrsAt(applyTypeChange({ stroke: text, start: 1, end: 1 }, { kind: 'kern', value: -50 }), 0).kern, -50);
  assert.equal(applyTypeChange({ stroke: text, start: 3, end: 3 }, { kind: 'kern', value: -50 }), text, 'after a newline: nothing to kern');
  assert.deepEqual([kernIndex('ab\ncd', 3), kernIndex('ab\ncd', 2), kernIndex('a\u{1F600}', 3)], [null, 1, 1]);
  // A paragraph change: the caret's paragraph, or every one a stretch touches.
  const centred = applyTypeChange({ stroke: text, start: 4, end: 4 }, { kind: 'para', patch: { align: 'center' } });
  assert.deepEqual([paraAttrsOf(centred, 0).align, paraAttrsOf(centred, 1).align], ['left', 'center']);
  // Orientation: vertical and back; a text along a path keeps its way.
  const up = applyTypeChange(whole(text), { kind: 'orientation', value: 'vertical' });
  assert.equal(up.typeset?.orientation, 'vertical');
  assert.equal(applyTypeChange(whole(up), { kind: 'orientation', value: 'horizontal' }).typeset, undefined, 'plain point text again');
  const along = withTypeset(mark('p', 'arc'), { kind: 'path', path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], start: 0, end: 100, align: 'baseline', effect: 'rainbow' } });
  assert.equal(applyTypeChange(whole(along), { kind: 'orientation', value: 'vertical' }), along);
  // A typed character never takes its neighbour's kerning by hand.
  const kerned = applyChar(mark('k', 'AV'), { start: 0, end: 1 }, { kern: -80 });
  const typed = spliceText(kerned, 1, 1, 'X');
  assert.deepEqual([charAttrsAt(typed, 0).kern, charAttrsAt(typed, 1).kern], [-80, 0]);
});

test('the toggles turn on, and off when every target has them; a stretch half on shows mixed', () => {
  const half = applyChar(mark('a', 'abcd'), { start: 0, end: 2 }, { caps: 'all' });
  const some = readTargets([whole(half)])!;
  assert.equal(toggleState('all-caps', some), 'mixed');
  assert.deepEqual(toggleChange('all-caps', some), { kind: 'char', patch: { caps: 'all' } }, 'mixed turns it on');
  const all = readTargets([{ stroke: half, start: 0, end: 2 }])!;
  assert.equal(toggleState('all-caps', all), true);
  assert.deepEqual(toggleChange('all-caps', all), { kind: 'char', patch: { caps: 'normal' } });
  assert.equal(toggleState('small-caps', all), false);
  assert.deepEqual(toggleChange('superscript', all), { kind: 'char', patch: { position: 'superscript' } });
  assert.deepEqual(toggleChange('underline', all), { kind: 'char', patch: { underline: true } });
  assert.deepEqual(toggleChange('strike', readTargets([whole(applyChar(mark('s', 'x'), { start: 0, end: 1 }, { strike: true }))])!), { kind: 'char', patch: { strike: false } });
});

test('lists: on with a style, off again, a level up and down; a numbered list counts the way its style says', () => {
  const three = mark('a', 'one\ntwo\nthree');
  const plain = readTargets([whole(three)])!;
  const numbered = applyTypeChange(whole(three), listChange('number', plain, 'a.'));
  assert.deepEqual(paraAttrsOf(numbered, 1).list, { kind: 'number', level: 1, marker: 'a.' });
  assert.deepEqual(layoutType(numbered).markers.map((m) => m.text), ['a.', 'b.', 'c.']);
  const on = readTargets([whole(numbered)])!;
  assert.deepEqual(listChange('number', on), { kind: 'para', patch: { list: undefined } }, 'Numbered again takes it off');
  assert.deepEqual(listChange('bullet', on), { kind: 'para', patch: { list: { kind: 'bullet', level: 1 } } }, 'Bulleted turns it into bullets');
  const deeper = applyTypeChange({ stroke: numbered, start: 4, end: 9 }, { kind: 'list-level', by: 1 });
  assert.deepEqual([1, 2].map((p) => paraAttrsOf(deeper, p).list?.level), [2, 2]);
  assert.equal(paraAttrsOf(deeper, 0).list?.level, 1, 'the paragraph outside the stretch stays');
  const top = applyTypeChange(whole(numbered), { kind: 'list-level', by: -1 });
  assert.equal(top, numbered, 'level 1 is as shallow as a list goes');
  // Without a style, a number list counts by its level as before.
  const byLevel = applyTypeChange(whole(three), listChange('number', plain));
  assert.deepEqual(layoutType(byLevel).markers.map((m) => m.text), ['1.', '2.', '3.']);
});
