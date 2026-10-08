/**
 * The Type menu's options forms as data (src/core/type/options.ts): what a
 * text of each typing mode reads as, a field written back alone and held to
 * its range, defaults left out of the file, and the fields greyed with a
 * reason; and a Text Configuration's Options, blank where it sets nothing.
 * The GUI check `check-typing-modes.mjs` opens both text forms in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rectangleAnchors, typeSpecOf, withTypeset } from '../src/core/type/model.js';
import {
  TYPE_OPTION_FIELDS,
  configOptionValues,
  configWithOptions,
  typeOptionDisabled,
  typeOptionValue,
  typeOptionValues,
  typeOptionsKindOf,
  withTypeOptions,
} from '../src/core/type/options.js';
import type { Stroke } from '../src/core/types.js';

const base: Stroke = { id: 'tx', tool: 'text', color: '#1f2328', width: 1, points: [{ x: 10, y: 20, pressure: 0.5 }], text: 'Hello', fontSize: 20, fontFamily: 'Georgia' };
const curve = [{ p: { x: 0, y: 0 }, hOut: { x: 40, y: -40 } }, { p: { x: 120, y: 0 }, hIn: { x: 80, y: -40 } }];
const along = withTypeset(base, { kind: 'path', path: { anchors: curve, start: 0, end: 200, align: 'baseline', effect: 'rainbow' } });
const sheet = withTypeset(base, { kind: 'area', frame: { anchors: rectangleAnchors(160, 80) } });
const circle = withTypeset(base, {
  kind: 'area',
  frame: {
    anchors: [
      { p: { x: 50, y: 0 }, hIn: { x: 22, y: 0 }, hOut: { x: 78, y: 0 } },
      { p: { x: 100, y: 50 }, hIn: { x: 100, y: 22 }, hOut: { x: 100, y: 78 } },
      { p: { x: 50, y: 100 }, hIn: { x: 78, y: 100 }, hOut: { x: 22, y: 100 } },
      { p: { x: 0, y: 50 }, hIn: { x: 0, y: 78 }, hOut: { x: 0, y: 22 } },
    ],
  },
});

test('each typing mode takes its own form, and Sideless Typing none', () => {
  assert.equal(typeOptionsKindOf(along), 'path');
  assert.equal(typeOptionsKindOf(sheet), 'area');
  assert.equal(typeOptionsKindOf(base), null);
  assert.equal(typeOptionValues('path', sheet), null, 'a sheet has no path');
  assert.equal(typeOptionValues('area', along), null, 'a path text has no frame');
});

test('a text reads as its defaults where the file leaves a field out', () => {
  assert.deepEqual(typeOptionValues('path', along), { effect: 'rainbow', align: 'baseline', spacing: 0, flip: false });
  assert.deepEqual(typeOptionValues('area', sheet), { inset: 0, autoHeight: false, fill: null, stroke: null, width: 1 });
});

test('only the fields named are written: texts set differently keep the rest', () => {
  const skewed = withTypeOptions(along, 'path', { effect: 'skew', align: 'center', spacing: 8, flip: true }, ['effect']);
  assert.deepEqual(typeOptionValues('path', skewed), { effect: 'skew', align: 'baseline', spacing: 0, flip: false });
  const all = withTypeOptions(along, 'path', { effect: 'stair', align: 'ascender', spacing: 8, flip: true }, ['effect', 'align', 'spacing', 'flip']);
  assert.deepEqual(typeOptionValues('path', all), { effect: 'stair', align: 'ascender', spacing: 8, flip: true });
  assert.deepEqual(typeSpecOf(all).path?.anchors, curve, 'the path itself is untouched');
  // Nothing new to take: the very text back.
  assert.equal(withTypeOptions(along, 'path', { effect: 'rainbow' }, ['effect']), along);
  assert.equal(withTypeOptions(base, 'path', { effect: 'skew' }, ['effect']), base, 'Sideless Typing has no path to set');
});

test("the frame's paint, inset and Auto Size; defaults are left out of the file", () => {
  const painted = withTypeOptions(sheet, 'area', { inset: 6, autoHeight: true, fill: '#ffd43b', stroke: '#1f2328', width: 2 }, ['inset', 'autoHeight', 'fill', 'stroke', 'width']);
  assert.deepEqual(typeSpecOf(painted).frame, { anchors: rectangleAnchors(160, 80), autoHeight: true, inset: 6, fill: '#ffd43b', stroke: '#1f2328', width: 2 });
  const plain = withTypeOptions(painted, 'area', { inset: 0, autoHeight: false, fill: null, stroke: null }, ['inset', 'autoHeight', 'fill', 'stroke']);
  assert.deepEqual(typeSpecOf(plain).frame, { anchors: rectangleAnchors(160, 80) }, 'no outline, no weight either');
  const hairline = withTypeOptions(sheet, 'area', { stroke: '#1f2328', width: 1 }, ['stroke', 'width']);
  assert.equal(typeSpecOf(hairline).frame?.width, undefined, 'the default weight is left out');
});

test('a value is held to its field, and one the field cannot take is ignored', () => {
  const [inset] = TYPE_OPTION_FIELDS.area;
  assert.equal(typeOptionValue(inset, -4), 0);
  assert.equal(typeOptionValue(inset, 1e9), 5000);
  assert.equal(typeOptionValue(inset, Number.NaN), undefined);
  const effect = TYPE_OPTION_FIELDS.path.find((field) => field.key === 'effect')!;
  assert.equal(typeOptionValue(effect, 'gravity'), 'gravity');
  assert.equal(typeOptionValue(effect, 'wobble'), undefined);
  assert.equal(withTypeOptions(along, 'path', { effect: 'wobble' }, ['effect']), along);
  const fill = TYPE_OPTION_FIELDS.area.find((field) => field.key === 'fill')!;
  assert.equal(typeOptionValue(fill, null), null, 'none');
  assert.equal(typeOptionValue(fill, ''), undefined);
});

test('Auto Size is greyed for frames that cannot grow, and the weight with no outline', () => {
  const values = typeOptionValues('area', sheet)!;
  assert.equal(typeOptionDisabled('area', [sheet], 'autoHeight', values), null, 'a rectangle grows');
  assert.match(typeOptionDisabled('area', [circle], 'autoHeight', values) ?? '', /rectangle/);
  assert.equal(typeOptionDisabled('area', [circle, sheet], 'autoHeight', values), null, 'one of them can');
  assert.match(typeOptionDisabled('area', [sheet], 'width', values) ?? '', /outline/);
  assert.equal(typeOptionDisabled('area', [sheet], 'width', { ...values, stroke: '#000000' }), null);
  assert.equal(typeOptionDisabled('path', [along], 'flip', typeOptionValues('path', along)!), null);
});

test("a Text Configuration's Options read blank where it sets nothing, and a blank field takes the attribute off", () => {
  const callout = { id: 'tc_1', name: 'Callout', attrs: { fontStyle: 'Bold', color: '#cc0000', underline: true, leading: 'auto' as const } };
  const values = configOptionValues(callout);
  assert.equal(values.name, 'Callout');
  assert.deepEqual([values.fontStyle, values.color, values.underline, values.leading, values.fontSize, values.strike], ['Bold', '#cc0000', 'on', 'auto', null, null]);
  // Only the fields named are written: a size set, the color taken off, the underline turned off, the name trimmed.
  const next = configWithOptions(callout, { ...values, name: '  Shout ', fontSize: 48, color: null, underline: 'off', fontStyle: 'Italic' }, ['name', 'fontSize', 'color', 'underline']);
  assert.deepEqual(next, { id: 'tc_1', name: 'Shout', attrs: { fontStyle: 'Bold', underline: false, leading: 'auto', fontSize: 48 } });
  // Held to their ranges; an empty name and a value a field cannot take leave it as it was.
  const field = (key: string) => TYPE_OPTION_FIELDS.config.find((each) => each.key === key)!;
  assert.equal(typeOptionValue(field('rotation'), 400), 180);
  assert.equal(typeOptionValue(field('fontSize'), null), null, 'an optional field takes a blank');
  assert.equal(typeOptionValue(field('name'), '   '), undefined, 'the name does not');
  assert.equal(typeOptionValue(field('leading'), 'auto'), 'auto');
  assert.deepEqual(configWithOptions(callout, { name: '' }, ['name']), callout);
});
