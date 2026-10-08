/**
 * Composition Styles (core/composition-style.ts): reading a style and every
 * reason it is not one; matching by name, trimmed and in any case; a layer
 * rule reaching what is under it, text and stroke rules each taking their own
 * marks, the nearer rule winning; configurations by name; the report and its
 * suggestions; capturing a page, which applied again changes nothing; a
 * composition restyled by its elements' names; and the store's restyle as
 * one undo step. The GUI check `check-composition-styles.mjs` drives the panel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyCompositionStyle,
  captureCompositionStyle,
  captureLayerRule,
  compositionReportLines,
  compositionReportTitle,
  compositionRuleSummary,
  compositionStyleFileName,
  compositionStyleSchema,
  COMPOSITION_RULE_FIELDS,
  isDefaultLayerName,
  uniqueStyleName,
  nameDistance,
  nameSuggestions,
  renameLayers,
  serializeCompositionStyle,
  validateCompositionStyle,
  type CompositionStyle,
} from '../src/core/composition-style.js';
import { createComposition } from '../src/core/graphic-design/compose.js';
import type { GroupElement, RectElement, TextElement } from '../src/core/graphic-design/types.js';
import { createSketchBook, type Layer, type Sketch, type Stroke } from '../src/core/types.js';
import { styleSegments, type TextConfig } from '../src/core/type/model.js';
import { COMPOSITION_STYLE_FILE } from '../src/core/ipc.js';
import { COMPOSITION_RULE_FORM_PARTS } from '../src/renderer/composition-rule-form.js';
import { COMPOSITION_STYLES_PANEL_PARTS } from '../src/renderer/composition-styles-panel.js';
import { Store } from '../src/renderer/store.js';
import { repoRoot } from './helpers/repo-root.js';

// ---- A page to restyle ------------------------------------------------------------------------------------------

const layer = (id: string, name: string, extra: Partial<Layer> = {}): Layer => ({ id, name, opacity: 1, visible: true, locked: false, ...extra });

/** A closed rectangle: its ends meet. */
const box = (id: string, on: string, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  layer: on,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 0, y: 60 },
    { x: 0, y: 0 },
  ],
  ...extra,
});

/** An open line. */
const line = (id: string, on: string, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'pen',
  color: '#1f2328',
  width: 3,
  layer: on,
  points: [
    { x: 0, y: 0 },
    { x: 60, y: 40 },
    { x: 160, y: 10 },
  ],
  ...extra,
});

const words = (id: string, on: string, text: string, extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'text',
  color: '#1f2328',
  width: 1,
  layer: on,
  points: [{ x: 10, y: 30 }],
  text,
  fontSize: 24,
  fontFamily: 'Segoe UI',
  ...extra,
});

/**
 * Background (a filled box), Title (a text), Outline (a line), a group Badge
 * holding Icon (a box) and Label (a text), and a layer the app named.
 */
function page(): Sketch {
  return {
    id: 'sk_page',
    name: 'page',
    width: 400,
    height: 300,
    background: '#ffffff',
    layers: [
      layer('ly_bg', 'Background'),
      layer('ly_title', 'Title'),
      layer('ly_outline', 'Outline'),
      layer('ly_icon', 'Icon', { parent: 'gp_badge' }),
      layer('ly_label', 'Label', { parent: 'gp_badge' }),
      layer('gp_badge', 'Badge', { group: true }),
      layer('ly_made', 'Layer 7'),
    ],
    strokes: [
      box('st_bg', 'ly_bg', { fill: '#f0f0f0' }),
      words('st_title', 'ly_title', 'Quarterly report'),
      line('st_outline', 'ly_outline'),
      box('st_icon', 'ly_icon', { fill: '#cccccc' }),
      words('st_label', 'ly_label', 'Acme Corp'),
      line('st_made', 'ly_made'),
    ],
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  };
}

const style = (rules: Partial<CompositionStyle>): CompositionStyle => ({ napkinCompositionStyle: 1, name: 'Midnight', ...rules });
const markOf = (sketch: Sketch, id: string): Stroke => sketch.strokes.find((stroke) => stroke.id === id)!;
const layerOf = (sketch: Sketch, id: string): Layer => sketch.layers.find((each) => each.id === id)!;
const colorsOf = (stroke: Stroke): string[] => [...new Set(styleSegments(stroke).map((segment) => segment.attrs.color))];

// ---- Reading a style --------------------------------------------------------------------------------------------

test('a style that reads comes back with its blends as napkin ids and its names trimmed; one past its range is held to it and said', () => {
  const read = validateCompositionStyle({
    napkinCompositionStyle: 1,
    name: ' Midnight ',
    layers: { ' Background ': { fill: '#000133', opacity: 1.5 }, Badge: { blend: 'multiply', effects: [{ type: 'outer-glow', blur: 6, color: '#4cae50' }] } },
    text: { Title: { config: 'Heading', color: '#ffffff', align: 'center', leading: 'auto', rotation: 270 } },
    strokes: { Outline: { color: '#4cae50', width: 2, strokeStyle: 'dashed' } },
  });
  assert.equal(read.ok, true, read.errors.join(' '));
  assert.equal(read.style?.name, 'Midnight');
  assert.deepEqual(Object.keys(read.style?.layers ?? {}), ['Background', 'Badge']);
  assert.equal(read.style?.layers?.Badge.blend, 'stack', 'a CSS name read as the napkin id');
  assert.equal(read.style?.layers?.Background.opacity, 1);
  assert.equal(read.style?.text?.Title.rotation, -90, 'an angle turned into -180 to 180');
  assert.equal(read.style?.layers?.Badge.effects?.[0].type, 'outer-glow');
  assert.deepEqual(
    read.notes.map((note) => note.message),
    ["Layer rule 'Background': opacity 1.5 is past its range (0 to 1), so 1 is used."],
  );
});

test('every reason a style is not one is said, a sentence each, with the nearest word where there is one', () => {
  const errors = (raw: unknown): string[] => validateCompositionStyle(raw).errors;
  assert.deepEqual(errors(null), ['A composition style is a JSON object.']);
  assert.deepEqual(errors([]), ['A composition style is a JSON object.']);
  assert.deepEqual(errors({ name: 'x' }), ['napkinCompositionStyle is missing: a composition style says its format, 1.']);
  assert.deepEqual(errors({ napkinCompositionStyle: 2, name: 'x' }), ['napkinCompositionStyle 2 is not a format napkin reads: it reads 1.']);
  assert.deepEqual(errors({ napkinCompositionStyle: 1 }), ["name must be the style's name: a string that is not empty."]);
  assert.deepEqual(errors({ napkinCompositionStyle: 1, name: 'x'.repeat(121) }), ['name is longer than 120 characters.']);
  assert.deepEqual(errors({ napkinCompositionStyle: 1, name: 'x', layer: {} }), [
    "There is no field 'layer': a composition style has napkinCompositionStyle, name, layers, text or strokes. Did you mean 'layers'?",
  ]);
  assert.deepEqual(errors({ napkinCompositionStyle: 1, name: 'x', layers: [] }), ['layers must be an object of rules by layer name.']);
  const rule = (kind: 'layers' | 'text' | 'strokes', body: unknown, name = 'Title'): string[] => errors({ napkinCompositionStyle: 1, name: 'x', [kind]: { [name]: body } });
  assert.deepEqual(rule('text', {}, '  '), ['A text rule has no layer name.']);
  assert.deepEqual(errors({ napkinCompositionStyle: 1, name: 'x', text: { Title: {}, ' title': {} } }), ["Text rules 'Title' and 'title' name the same layer."]);
  assert.deepEqual(rule('layers', 'red'), ["Layer rule 'Title' must be an object of styles."]);
  assert.deepEqual(rule('layers', { fil: 'red' }), ["Layer rule 'Title': there is no field 'fil'. Did you mean 'fill'?"]);
  assert.deepEqual(rule('text', { width: 2 }), ["Text rule 'Title': width is a stroke rule's field, not a text rule's."]);
  assert.deepEqual(rule('layers', { opacity: '50%' }), ["Layer rule 'Title': opacity must be a number."]);
  assert.deepEqual(rule('text', { leading: 'tall' }), ["Text rule 'Title': leading must be a number or auto."]);
  assert.deepEqual(rule('text', { color: 'none' }), ["Text rule 'Title': color must be a color, not 'none'."]);
  assert.deepEqual(rule('strokes', { fill: 'plaid' }), ["Stroke rule 'Title': fill must be a color or none, not 'plaid'."]);
  assert.deepEqual(rule('text', { align: 'centre' }), ["Text rule 'Title': align must be left, center, right or justify. Did you mean 'center'?"]);
  assert.deepEqual(rule('layers', { visible: 'yes' }), ["Layer rule 'Title': visible must be true or false."]);
  assert.deepEqual(rule('text', { fontFamily: ' ' }), ["Text rule 'Title': fontFamily must be a string that is not empty."]);
  assert.deepEqual(rule('text', { config: '' }), ["Text rule 'Title': config must be a configuration's name."]);
  assert.deepEqual(rule('layers', { blend: 'stak' }), ["Layer rule 'Title': blend 'stak' is not a blend mode. Did you mean 'stack'?"]);
  assert.deepEqual(rule('layers', { effects: { type: 'blur' } }), ["Layer rule 'Title': effects must be a list of effects."]);
  assert.deepEqual(rule('layers', { effects: [{ radius: 2 }] }), ["Layer rule 'Title': effect 1 has no type."]);
  assert.deepEqual(rule('layers', { effects: [{ type: 'outer-glo' }] }), ["Layer rule 'Title': effect 1's type 'outer-glo' is not an effect. Did you mean 'outer-glow'?"]);
  assert.deepEqual(rule('layers', { effects: [{ type: 'blur' }] }), ["Layer rule 'Title': effect 1 (blur) is missing a field it needs, or has one napkin cannot read."]);
  assert.deepEqual(rule('strokes', { gradient: { type: 'linear', stops: [] } }), ["Stroke rule 'Title': gradient must be a gradient (a type and two or more stops) or none."]);
  assert.deepEqual(rule('text', { list: 'stars' }), ["Text rule 'Title': list must be none or a list with a kind, bullet or number."]);
  assert.deepEqual(rule('text', { accent: 'pyton' }), ["Text rule 'Title': accent 'pyton' is not a language napkin knows. Did you mean 'python'?"]);
  // Every problem at once, in the order the style is written.
  assert.equal(errors({ napkinCompositionStyle: 1, name: 'x', layers: { A: { opacity: 'a', fil: 1 } }, strokes: { B: { width: 'w' } } }).length, 3);
});

test('a style written out reads back the same, and its schema names every field the reader takes', () => {
  const read = validateCompositionStyle({ napkinCompositionStyle: 1, name: 'Day', strokes: { Outline: { color: '#4cae50', gradient: 'none' } } });
  assert.equal(read.ok, true);
  const text = serializeCompositionStyle(read.style!);
  assert.match(text, /^\{\n {2}"napkinCompositionStyle": 1,\n {2}"name": "Day",\n {2}"strokes": \{/);
  assert.deepEqual(validateCompositionStyle(JSON.parse(text)).style, read.style);
  const schema = compositionStyleSchema() as { required: string[]; definitions: Record<string, { properties: Record<string, unknown> }> };
  assert.deepEqual(schema.required, ['napkinCompositionStyle', 'name']);
  for (const [kind, key] of [
    ['layer', 'layerRule'],
    ['text', 'textRule'],
    ['stroke', 'strokeRule'],
  ] as const) {
    assert.deepEqual(Object.keys(schema.definitions[key].properties), COMPOSITION_RULE_FIELDS[kind].map((field) => field.key));
  }
});

// ---- Names ------------------------------------------------------------------------------------------------------

test('a near name is suggested, a swap of two letters counting once; an abbreviation is not', () => {
  assert.equal(nameDistance('titel', 'title'), 1, 'two letters swapped are one edit');
  assert.equal(nameDistance('background', 'backgrund'), 1);
  const names = ['Background', 'Title', 'Outline'];
  assert.deepEqual(nameSuggestions('Titel', names), ['Title']);
  assert.deepEqual(nameSuggestions('  OUTLNE ', names), ['Outline'], 'trimmed, in any case, and given as it is spelled');
  assert.deepEqual(nameSuggestions('Bg', names), []);
  assert.deepEqual(nameSuggestions('Title', names), [], 'the name itself is no suggestion');
  assert.deepEqual(nameSuggestions('ab', ['xy', 'ax']), ['ax'], 'never one that changes every letter');
});

test('the names the app gives a layer are told from a person\'s', () => {
  for (const name of ['Layer 1', 'layer', 'Group 12', '<Group>', 'Brush 3', 'Text 2', 'Image 1', 'Clip Group', 'path', 'rect-4', 'Brush 3 - copy', '  ']) {
    assert.equal(isDefaultLayerName(name), true, name);
  }
  for (const name of ['Background', 'Title', 'Layer Cake', 'Badge', 'Texture']) assert.equal(isDefaultLayerName(name), false, name);
});

// ---- Applying ---------------------------------------------------------------------------------------------------

test('a rule matches a layer by its name, trimmed and in any case, and leaves what it does not set as it was', () => {
  const sketch = page();
  const result = applyCompositionStyle(sketch, style({ layers: { ' background ': { opacity: 0.5 } }, strokes: { OUTLINE: { color: '#ff0000' } } }));
  assert.equal(layerOf(result.sketch, 'ly_bg').opacity, 0.5);
  assert.equal(markOf(result.sketch, 'st_outline').color, '#ff0000');
  assert.equal(markOf(result.sketch, 'st_outline').width, 3, 'the width it did not set');
  assert.deepEqual(result.report.items, []);
  assert.equal(result.report.matched, 2);
  assert.equal(result.report.changed, 2);
  assert.equal(compositionReportTitle(result.report), 'Applied Midnight');
  assert.equal(sketch.layers[0].opacity, 1, 'the page given is not changed');
  assert.equal(markOf(sketch, 'st_outline').color, '#1f2328');
});

test('a layer rule reaches every layer under it, its fill the shapes and the text, unless a rule of their own kind names it; the nearer rule wins', () => {
  const sketch = page();
  let result = applyCompositionStyle(sketch, style({ layers: { Badge: { opacity: 0.5, fill: '#ff0000', stroke: '#00ff00' } } }));
  assert.equal(layerOf(result.sketch, 'gp_badge').opacity, 0.5);
  assert.equal(markOf(result.sketch, 'st_icon').fill, '#ff0000', 'a closed shape under the group is filled');
  assert.equal(markOf(result.sketch, 'st_icon').color, '#00ff00', 'and outlined');
  assert.deepEqual(colorsOf(markOf(result.sketch, 'st_label')), ['#ff0000'], 'a text takes the fill as its color');
  assert.equal(markOf(result.sketch, 'st_title').color, '#1f2328', 'a layer outside the group is not reached');
  // A text rule naming the same layer: the text is its own, the shape still the layer rule's.
  result = applyCompositionStyle(sketch, style({ layers: { Badge: { fill: '#ff0000' } }, text: { Badge: { fontSize: 30 } } }));
  assert.deepEqual(colorsOf(markOf(result.sketch, 'st_label')), ['#1f2328']);
  assert.equal(styleSegments(markOf(result.sketch, 'st_label'))[0].attrs.fontSize, 30);
  assert.equal(markOf(result.sketch, 'st_icon').fill, '#ff0000');
  // Nearer wins: the icon's own rule over the group's.
  result = applyCompositionStyle(sketch, style({ layers: { Badge: { fill: '#ff0000' }, Icon: { fill: '#0000ff' } } }));
  assert.equal(markOf(result.sketch, 'st_icon').fill, '#0000ff');
  assert.deepEqual(colorsOf(markOf(result.sketch, 'st_label')), ['#ff0000']);
  // A fill only fills a closed shape; an open line under the layer keeps none.
  result = applyCompositionStyle(sketch, style({ layers: { Outline: { fill: '#ff0000' } } }));
  assert.equal(markOf(result.sketch, 'st_outline').fill, undefined);
});

test('a text rule takes the texts and a stroke rule the paths, on one layer as on its own', () => {
  const sketch = page();
  sketch.strokes.push(box('st_title_box', 'ly_title'));
  const result = applyCompositionStyle(
    sketch,
    style({
      text: { Title: { color: '#ffffff', fontSize: 40, align: 'center', underline: true } },
      strokes: { Title: { color: '#4cae50', width: 5, strokeStyle: 'dashed', fill: '#000133', noStroke: true }, Outline: { profile: 'tapered', opacity: 0.5 } },
    }),
  );
  const title = markOf(result.sketch, 'st_title');
  const attrs = styleSegments(title)[0].attrs;
  assert.deepEqual([attrs.color, attrs.fontSize, attrs.underline], ['#ffffff', 40, true]);
  assert.equal(title.typeset?.paras?.[0]?.align, 'center');
  const framed = markOf(result.sketch, 'st_title_box');
  assert.deepEqual([framed.color, framed.width, framed.strokeStyle, framed.fill, framed.noStroke], ['#4cae50', 5, 'dashed', '#000133', true]);
  const outline = markOf(result.sketch, 'st_outline');
  assert.deepEqual([outline.profile, outline.opacity], ['tapered', 0.5]);
  assert.equal(outline.noStroke, undefined, 'an open line keeps its outline');
});

test('a text or stroke rule\'s blend goes on the layer its marks sit on; a layer rule\'s on the layer itself', () => {
  const result = applyCompositionStyle(page(), style({ layers: { Badge: { blend: 'screen', isolate: true } }, text: { Badge: { blend: 'multiply' } }, strokes: { Outline: { blend: 'normal' } } }));
  assert.equal(layerOf(result.sketch, 'gp_badge').blend, 'sheer');
  assert.equal(layerOf(result.sketch, 'gp_badge').isolate, true);
  assert.equal(layerOf(result.sketch, 'ly_label').blend, 'stack', 'the text under the group: its own layer');
  assert.equal(layerOf(result.sketch, 'ly_icon').blend, undefined, 'the shape beside it, untouched');
  assert.equal('blend' in layerOf(result.sketch, 'ly_outline'), false, 'Normal is no field');
  assert.deepEqual(
    applyCompositionStyle(page(), style({ layers: { Title: { isolate: true } } })).report.items.map((item) => item.message),
    ["Layer rule 'Title' sets isolate, which only a group takes."],
  );
});

test('a configuration named by a rule, the book\'s or a Markdown one, is followed; one the book has not is said', () => {
  const heading: TextConfig = { id: 'tc_heading', name: 'Heading', attrs: { fontSize: 40, fontStyle: 'Bold' } };
  let result = applyCompositionStyle(page(), style({ text: { Title: { config: ' heading ' } } }), { configs: [heading] });
  const title = markOf(result.sketch, 'st_title');
  assert.equal(styleSegments(title)[0].attrs.config, 'tc_heading');
  assert.equal(styleSegments(title)[0].attrs.fontSize, 40);
  assert.deepEqual(result.configs, [], 'the book had it');
  result = applyCompositionStyle(page(), style({ text: { Title: { config: 'Markdown Code' } } }), { configs: [heading] });
  assert.equal(styleSegments(markOf(result.sketch, 'st_title'))[0].attrs.config, 'tc_markdown_code');
  assert.deepEqual(result.configs.map((config) => config.name), ['Markdown Code'], 'one the book had not, for it to join');
  result = applyCompositionStyle(page(), style({ text: { Title: { config: 'Callout', color: '#ff0000' } } }), { configs: [heading] });
  assert.deepEqual(result.report.items.map((item) => [item.kind, item.message]), [
    ['missing-config', "Text rule 'Title' names the configuration 'Callout', which this book does not have."],
  ]);
  assert.deepEqual(colorsOf(markOf(result.sketch, 'st_title')), ['#ff0000'], 'the rule\'s other styles still go on');
  // The Default Configuration is none.
  const followed = applyCompositionStyle(page(), style({ text: { Title: { config: 'Heading' } } }), { configs: [heading] }).sketch;
  const plain = applyCompositionStyle(followed, style({ text: { Title: { config: 'Default Configuration' } } }), { configs: [heading] });
  assert.equal(styleSegments(markOf(plain.sketch, 'st_title'))[0].attrs.config, undefined);
});

test('Markdown Flow, an accent and effects by rule; a text already so is left the same object', () => {
  const result = applyCompositionStyle(
    page(),
    style({ text: { Title: { flow: 'markdown', accent: 'py', effects: [{ type: 'drop-shadow', dx: 2, dy: 2, blur: 4, color: '#000000' }] } } }),
  );
  const title = markOf(result.sketch, 'st_title');
  assert.equal(title.typeset?.flow, 'markdown');
  assert.equal(title.typeset?.paras?.[0]?.accent, 'python', 'an alias read as the language');
  assert.equal(title.effects?.[0].type, 'drop-shadow');
  const again = applyCompositionStyle(result.sketch, style({ text: { Title: { flow: 'markdown', accent: 'python' } } }));
  assert.equal(again.report.changed, 0);
  assert.equal(again.sketch, result.sketch, 'nothing changed, the same page');
  const off = applyCompositionStyle(result.sketch, style({ text: { Title: { flow: 'plain', accent: 'none', effects: [] } } }));
  const plain = markOf(off.sketch, 'st_title');
  assert.equal(plain.typeset?.flow, undefined);
  assert.equal(plain.typeset?.paras?.[0]?.accent, undefined);
  assert.equal(plain.effects, undefined);
});

test('a rule that matched nothing is reported with the nearest names; one with nothing of its kind is said too', () => {
  const result = applyCompositionStyle(
    page(),
    style({ text: { Titel: { color: '#ffffff' }, Outline: { color: '#ffffff' } }, layers: { Bg: { opacity: 0.5 } }, strokes: { Title: { width: 4 } } }),
  );
  assert.deepEqual(
    result.report.items.map((item) => [item.kind, item.message, item.suggestions ?? null]),
    [
      ['unmatched', "Layer rule 'Bg' matched no layer.", []],
      ['unmatched', "Text rule 'Titel' matched no layer.", ['Title']],
      ['empty', "Text rule 'Outline' matched a layer with no text.", null],
      ['empty', "Stroke rule 'Title' matched a layer with no paths.", null],
    ],
  );
  assert.equal(compositionReportTitle(result.report), 'Midnight: 2 rules did not match');
  assert.deepEqual(compositionReportLines(result.report).slice(0, 2), ["Layer rule 'Bg' matched no layer.", "Text rule 'Titel' matched no layer. Did you mean 'Title'?"]);
  // Rename layer: the near layer takes the rule's name, and the style applied again matches.
  const renamed = renameLayers(page(), 'Title', 'Titel');
  assert.deepEqual(renamed.layers, [{ id: 'ly_title', patch: { name: 'Titel' } }]);
  const fixed = applyCompositionStyle(renamed.sketch, style({ text: { Titel: { color: '#ffffff' } } }));
  assert.deepEqual(fixed.report.items, []);
  assert.deepEqual(colorsOf(markOf(fixed.sketch, 'st_title')), ['#ffffff']);
});

// ---- Capturing --------------------------------------------------------------------------------------------------

test('a capture records the named layers, leaving out the names the app gave', () => {
  const sketch = page();
  sketch.layers.push(layer('ly_contents', 'Badge contents', { parent: 'gp_badge' }), layer('gp_made', 'Group 2', { group: true }), layer('ly_made2', '<Group>'));
  const captured = captureCompositionStyle(sketch, ' Day ');
  assert.equal(captured.name, 'Day');
  assert.deepEqual(Object.keys(captured.layers ?? {}), ['Badge', 'Label', 'Icon', 'Outline', 'Title', 'Background'], 'top of the Layers panel first');
  assert.deepEqual(Object.keys(captured.text ?? {}), ['Badge', 'Label', 'Title']);
  assert.deepEqual(Object.keys(captured.strokes ?? {}), ['Badge', 'Icon', 'Outline', 'Background']);
  assert.deepEqual(captured.layers?.Background, { opacity: 1, blend: 'normal', visible: true, effects: [] });
  assert.equal(captured.layers?.Badge.isolate, false, "a group's Isolate Blending");
  assert.equal(captured.strokes?.Background.fill, '#f0f0f0');
  assert.equal(captured.strokes?.Outline.fill, undefined, 'an open line has no fill to keep');
  assert.equal(captured.text?.Title.config, 'Default Configuration');
  assert.equal(validateCompositionStyle(captured).ok, true, 'a capture is a style');
});

test('a capture applied to the page it came from changes nothing; Night applied, then Day, gives the page back', () => {
  const heading: TextConfig = { id: 'tc_heading', name: 'Heading', attrs: { fontSize: 40 } };
  const sketch = applyCompositionStyle(page(), style({ text: { Title: { config: 'Heading', tracking: 50 } }, strokes: { Outline: { strokeStyle: 'dotted' } } }), {
    configs: [heading],
  }).sketch;
  const day = captureCompositionStyle(sketch, 'Day', { configs: [heading] });
  const same = applyCompositionStyle(sketch, day, { configs: [heading] });
  assert.deepEqual([same.strokes, same.layers, same.report.items], [[], [], []]);
  assert.equal(same.sketch, sketch);
  const night = JSON.parse(JSON.stringify(day)) as CompositionStyle;
  night.name = 'Night';
  night.layers!.Background = { ...night.layers!.Background, opacity: 0.4, effects: [{ type: 'blur', radius: 2 }] };
  night.text!.Title = { ...night.text!.Title, color: '#ffffff', fontSize: 30, align: 'right' };
  night.strokes!.Outline = { ...night.strokes!.Outline, color: '#4cae50', width: 6, strokeStyle: 'solid' };
  night.strokes!.Background = { ...night.strokes!.Background, fill: '#000133' };
  const dark = applyCompositionStyle(sketch, night, { configs: [heading] });
  assert.ok(dark.report.changed >= 4);
  const back = applyCompositionStyle(dark.sketch, day, { configs: [heading] });
  for (const id of ['st_bg', 'st_title', 'st_outline']) {
    const before = markOf(sketch, id);
    const after = markOf(back.sketch, id);
    assert.deepEqual([after.color, after.width, after.fill, after.strokeStyle, after.effects], [before.color, before.width, before.fill, before.strokeStyle, before.effects], id);
    if (id === 'st_title') assert.deepEqual(styleSegments(after), styleSegments(before));
  }
  assert.deepEqual(layerOf(back.sketch, 'ly_bg'), layerOf(sketch, 'ly_bg'));
});

test("one layer's rule, as a capture would write it, for the editor's From Selection; a rule in a few words", () => {
  const sketch = page();
  assert.deepEqual(captureLayerRule(sketch, 'gp_badge', 'layer'), { opacity: 1, blend: 'normal', visible: true, effects: [], isolate: false });
  assert.equal((captureLayerRule(sketch, 'ly_title', 'text') as { fontSize?: number }).fontSize, 24);
  assert.equal(captureLayerRule(sketch, 'ly_title', 'stroke'), null, 'a text layer has no paths');
  assert.equal(compositionRuleSummary('layer', { opacity: 0.5, blend: 'stack', effects: [{ type: 'blur', radius: 2 }] }), 'opacity 0.5, blend stack, 1 effect');
  assert.equal(compositionRuleSummary('stroke', { width: 2, noStroke: true, gradient: 'none' }), 'width 2 px, no stroke, no gradient');
  assert.equal(compositionRuleSummary('text', {}), '');
});

// ---- A composition ----------------------------------------------------------------------------------------------

test('a composition is restyled by its elements\' and groups\' names, as a new one; the one given is untouched', () => {
  const composition = createComposition({ width: 200, height: 120, background: '#ffffff' });
  composition.rect({ name: 'Background', x: 0, y: 0, width: 200, height: 120, fill: '#f0f0f0' });
  composition.group({ name: 'Badge' }, (group) => {
    group.rect({ name: 'Icon', x: 10, y: 10, width: 20, height: 20, fill: '#cccccc', stroke: '#1f2328', strokeWidth: 1 });
    group.text({ name: 'Label', x: 40, y: 24, text: 'Acme Corp', fontSize: 12, fill: '#1f2328' });
  });
  const midnight = style({
    layers: { Background: { fill: '#000133' }, Badge: { opacity: 0.8, blend: 'screen' } },
    text: { Label: { color: '#ffffff', fontStyle: 'Bold Italic', tracking: 100, caps: 'all', leading: 18 } },
    strokes: { Icon: { color: '#4cae50', width: 2, strokeStyle: 'dashed' }, Missing: { width: 1 } },
  });
  const { composition: styled, report } = applyCompositionStyle(composition, midnight);
  assert.notEqual(styled, composition);
  assert.equal(typeof styled.toSVG, 'function', 'a composition still, to render');
  const [bg, badge] = styled.elements as [RectElement, GroupElement];
  const [icon, label] = badge.children as [RectElement, TextElement];
  assert.equal(bg.fill, '#000133');
  assert.deepEqual([badge.opacity, badge.blend], [0.8, 'sheer']);
  assert.deepEqual([icon.stroke, icon.strokeWidth, icon.dash], ['#4cae50', 2, [6, 4]]);
  assert.deepEqual([label.fill, label.fontWeight, label.fontStyle, label.letterSpacing, label.transform, label.lineHeight], ['#ffffff', 'bold', 'italic', 1.2, 'uppercase', 1.5]);
  assert.deepEqual(report.items.map((item) => item.message), ["Stroke rule 'Missing' matched no layer."]);
  assert.equal((composition.elements[0] as RectElement).fill, '#f0f0f0', 'the composition given is not changed');
  assert.match(styled.toSVG(), /data-name="Badge"/);
  // A plain document comes back as a document.
  const doc = composition.toDocument();
  const restyled = applyCompositionStyle(doc, midnight).composition;
  assert.equal((restyled.elements[0] as RectElement).fill, '#000133');
  assert.equal(restyled.width, 200);
  assert.throws(() => applyCompositionStyle(doc, { name: 'x' }), /^Error: Not a composition style: napkinCompositionStyle is missing/);
});

// ---- The library and the panel ----------------------------------------------------------------------------------

test('a style is kept in a file named for it, a plain name the library takes, numbered apart; a name is numbered apart too', () => {
  assert.equal(compositionStyleFileName('Midnight'), 'midnight.json');
  assert.equal(compositionStyleFileName('  Acme Corp: Night / Day!  '), 'acme-corp-night-day.json');
  assert.equal(compositionStyleFileName('Midnight', ['midnight.json', 'MIDNIGHT-2.json']), 'midnight-3.json');
  assert.equal(compositionStyleFileName('***'), 'style.json');
  assert.equal(compositionStyleFileName('CON'), 'con-style.json', 'never a name the system keeps for a device');
  for (const name of ['Midnight', 'x'.repeat(200), '...', 'Ünïcode', 'nul', ' ']) assert.match(compositionStyleFileName(name), COMPOSITION_STYLE_FILE, name);
  assert.equal(uniqueStyleName('Midnight', ['Day']), 'Midnight');
  assert.equal(uniqueStyleName('Midnight', ['midnight ', 'Midnight 2']), 'Midnight 3');
});

test('index.html has every part the Composition Styles panel and the rule form look for', () => {
  const html = readFileSync(join(repoRoot(), 'src', 'renderer', 'index.html'), 'utf8');
  const block = (id: string): string => {
    const start = html.indexOf(`<div id="${id}"`);
    assert.ok(start >= 0, `there is a #${id}`);
    return html.slice(start, html.indexOf('<!--', start));
  };
  const panel = block('composition-styles-dialog');
  for (const part of COMPOSITION_STYLES_PANEL_PARTS) assert.ok(panel.includes(`id="${part}"`), `#composition-styles-dialog has #${part}`);
  assert.ok(panel.includes('data-panel="persistent"'), 'the panel is no dialog in the way of Move and Rotate');
  assert.ok(panel.includes('class="export-dialog is-hidden"'), 'it starts hidden');
  const form = block('composition-rule-dialog');
  for (const part of COMPOSITION_RULE_FORM_PARTS) assert.ok(form.includes(`id="${part}"`), `#composition-rule-dialog has #${part}`);
  assert.ok(html.indexOf('<div id="composition-rule-dialog"') > html.indexOf('<div id="config-dialog"'), 'the form comes after the rule editor, so it is drawn over it');
});

// ---- The store --------------------------------------------------------------------------------------------------

test('the store restyles marks and layers as one undo step, and the configurations the texts follow join the book', () => {
  const book = createSketchBook('styles');
  book.sketches[0] = page();
  const store = new Store(book);
  const result = applyCompositionStyle(
    store.sketch,
    style({ layers: { Background: { opacity: 0.5, visible: false } }, text: { Title: { config: 'Markdown Quote' } }, strokes: { Outline: { color: '#ff0000' } } }),
    { configs: store.textConfigs },
  );
  assert.equal(store.restyle(result), true);
  assert.equal(layerOf(store.sketch, 'ly_bg').opacity, 0.5);
  assert.equal(layerOf(store.sketch, 'ly_bg').visible, false);
  assert.equal(markOf(store.sketch, 'st_outline').color, '#ff0000');
  assert.deepEqual(store.textConfigs.map((config) => config.name), ['Markdown Quote']);
  store.undo();
  assert.equal(layerOf(store.sketch, 'ly_bg').opacity, 1, 'one undo takes it all back');
  assert.equal(layerOf(store.sketch, 'ly_bg').visible, true);
  assert.equal(markOf(store.sketch, 'st_outline').color, '#1f2328');
  assert.deepEqual(store.textConfigs, []);
  assert.equal(store.restyle({ strokes: [], layers: [] }), false, 'nothing to do is no step');
  assert.equal(store.canUndo, false);
});
