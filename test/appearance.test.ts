/**
 * The appearance stack the Appearance panel edits (core/appearance.ts): its
 * sections and their order, the edits the panel makes, effects that follow
 * their mark through a transform, the options each effect shows, geometry
 * effects and Expand Appearance; the store's effect setters; and the markup
 * the panel and the options popup look for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  addEffect,
  aimedAt,
  appearanceSections,
  BLEND_FIELD_CHOICES,
  duplicateEffect,
  EFFECT_FIELDS,
  EFFECT_ORIGINS,
  effectFieldValue,
  effectsAfterTransform,
  expandAppearance,
  hasGeometryEffects,
  inDrawingOrder,
  isGeometryEffect,
  moveEffect,
  registerGeometryEffect,
  removeEffect,
  replaceEffect,
  retargetEffect,
  sameEffects,
  targetOf,
  toggleEffect,
  withEffectField,
} from '../src/core/appearance.js';
import { defaultEffect, EFFECT_LABELS, EFFECT_TYPES, effectPaintReach, type Effect } from '../src/core/effects.js';
import { MENU_PREDICATES } from '../src/core/menu/ids.js';
import { defaultRegistry, menuTree } from '../src/core/menu/registry.js';
import { createSketchBook, type Layer, type Point, type Stroke } from '../src/core/types.js';
import { APPEARANCE_PANEL_PARTS } from '../src/renderer/appearance-panel.js';
import { EFFECT_OPTIONS_PARTS } from '../src/renderer/effect-options.js';
import { Store } from '../src/renderer/store.js';
import { repoRoot } from './helpers/repo-root.js';

const glow = (target?: 'fill' | 'stroke'): Effect => aimedAt(defaultEffect('outer-glow'), target ?? 'object');
const shadow = (dx = 4, dy = 3): Effect => ({ ...defaultEffect('drop-shadow'), dx, dy });
const blur = (radius = 2): Effect => ({ type: 'blur', radius });
const names = (effects: readonly Effect[]): string[] => effects.map((effect) => `${effect.type}@${targetOf(effect)}`);

// ---- The stack ------------------------------------------------------------------------

test('the sections are the stroke, the fill and the whole mark, each in the order its effects are applied', () => {
  const effects = [blur(), glow('fill'), shadow(), glow('stroke'), { ...blur(5), target: 'fill' } as Effect];
  const sections = appearanceSections(effects);
  assert.deepEqual(sections.stroke.map((entry) => entry.index), [3]);
  assert.deepEqual(sections.fill.map((entry) => entry.index), [1, 4]);
  assert.deepEqual(sections.object.map((entry) => entry.index), [0, 2]);
  assert.equal(sections.fill[1].effect, effects[4], 'an entry is the effect itself, not a copy');
});

test('the panel edits give a new list and leave the one they were given alone', () => {
  const effects: readonly Effect[] = Object.freeze([blur(), glow('fill')]) as readonly Effect[];
  assert.deepEqual(names(addEffect(effects, shadow())), ['blur@object', 'outer-glow@fill', 'drop-shadow@object']);
  assert.deepEqual(names(addEffect(effects, shadow(), 'stroke')), ['blur@object', 'outer-glow@fill', 'drop-shadow@stroke']);
  assert.deepEqual(names(replaceEffect(effects, 0, shadow())), ['drop-shadow@object', 'outer-glow@fill']);
  assert.deepEqual(names(removeEffect(effects, 0)), ['outer-glow@fill']);
  const twice = duplicateEffect(effects, 1);
  assert.deepEqual(names(twice), ['blur@object', 'outer-glow@fill', 'outer-glow@fill']);
  assert.notEqual(twice[2], twice[1], 'the copy is a copy');
  assert.equal(effects.length, 2);
});

test('the eye switches an effect off with on: false, and back on by taking the field away', () => {
  const off = toggleEffect([blur(), shadow()], 1);
  assert.equal(off[1].on, false);
  assert.equal(off[0].on, undefined);
  const on = toggleEffect(off, 1);
  assert.equal('on' in on[1], false);
  assert.equal(toggleEffect(off, 1, false)[1].on, false, 'asked for off, it stays off');
});

test('an effect moves to another target in its place, and the object target takes the field away', () => {
  const effects = [blur(), glow('fill')];
  assert.deepEqual(names(retargetEffect(effects, 0, 'stroke')), ['blur@stroke', 'outer-glow@fill']);
  const whole = retargetEffect(effects, 1, 'object');
  assert.equal('target' in whole[1], false);
});

test('a drag puts the effect just before the one it lands on, taking that one\'s target, or at the end', () => {
  const a = blur(1);
  const b = glow('fill');
  const c = shadow();
  const d = { ...blur(4), target: 'fill' } as Effect;
  const list = [a, b, c, d];
  const order = (effects: readonly Effect[]) => effects.map((effect) => list.findIndex((each) => sameEffects([each], [aimedAt(effect, targetOf(each))])));
  // Before the one at 1 is where it is already: nothing moves.
  assert.deepEqual(order(moveEffect(list, 0, 1)), [0, 1, 2, 3]);
  assert.deepEqual(order(moveEffect(list, 0, 3)), [1, 2, 0, 3]);
  assert.deepEqual(order(moveEffect(list, 0, 4)), [1, 2, 3, 0], 'the length is the end');
  assert.deepEqual(order(moveEffect(list, 3, 0)), [3, 0, 1, 2]);
  // Landing before the fill's glow takes the fill as its target; an explicit target wins.
  assert.equal(targetOf(moveEffect(list, 2, 1)[1]), 'fill');
  assert.equal(targetOf(moveEffect(list, 1, 4, 'stroke')[3]), 'stroke');
  assert.equal(targetOf(moveEffect(list, 1, 4)[3]), 'fill', 'at the end it keeps its own');
  assert.deepEqual(moveEffect(list, 9, 0), list, 'a place that is not there moves nothing');
});

test('two lists are the same when every field is', () => {
  assert.ok(sameEffects([blur(2)], [blur(2)]));
  assert.ok(sameEffects(undefined, []));
  assert.ok(!sameEffects([blur(2)], [blur(3)]));
  assert.ok(!sameEffects([glow('fill')], [glow('stroke')]));
});

// ---- Effects through a transform ------------------------------------------------------

test('a scale scales every length, and a turn or a mirror leaves an effect without a direction as it was', () => {
  const effects = [blur(2), shadow(4, 3), defaultEffect('feather')];
  const scaled = effectsAfterTransform(effects, { scale: 2 });
  assert.equal((scaled[0] as { radius: number }).radius, 4);
  assert.deepEqual([(scaled[1] as { dx: number }).dx, (scaled[1] as { dy: number }).dy], [8, 6]);
  assert.notEqual(scaled[0], effects[0], 'new effects');
  assert.equal((effects[0] as { radius: number }).radius, 2, 'the given list is as it was');
  const turned = effectsAfterTransform([blur(2)], { rotate: 90, flipX: true });
  assert.deepEqual(turned, [blur(2)]);
});

test('a turn turns a shadow\'s offset with the mark, clockwise as the page turns it', () => {
  const [quarter] = effectsAfterTransform([shadow(4, 0)], { rotate: 90 }) as Array<{ dx: number; dy: number }>;
  assert.deepEqual([quarter.dx, quarter.dy], [0, 4], 'right becomes down');
  const [half] = effectsAfterTransform([shadow(4, 3)], { rotate: 180 }) as Array<{ dx: number; dy: number }>;
  assert.deepEqual([half.dx, half.dy], [-4, -3]);
  const [inner] = effectsAfterTransform([{ ...defaultEffect('inner-shadow'), dx: 0, dy: 5 }], { rotate: -90 }) as Array<{ dx: number; dy: number }>;
  assert.deepEqual([inner.dx, inner.dy], [5, 0], 'down becomes right');
});

test('a mirror mirrors a shadow\'s offset and a relief\'s light, so the light still falls on the same side', () => {
  const [left] = effectsAfterTransform([shadow(4, 3)], { flipX: true }) as Array<{ dx: number; dy: number }>;
  assert.deepEqual([left.dx, left.dy], [-4, 3]);
  const [up] = effectsAfterTransform([shadow(4, 3)], { flipY: true }) as Array<{ dx: number; dy: number }>;
  assert.deepEqual([up.dx, up.dy], [4, -3]);
  const bevel = { ...defaultEffect('bevel'), angle: 120 };
  assert.equal((effectsAfterTransform([bevel], { flipX: true })[0] as { angle: number }).angle, 60);
  assert.equal((effectsAfterTransform([bevel], { flipY: true })[0] as { angle: number }).angle, 240);
  // The light's angle runs counterclockwise; a clockwise turn of 30 takes 30 off it.
  assert.equal((effectsAfterTransform([bevel], { rotate: 30 })[0] as { angle: number }).angle, 90);
  assert.equal((effectsAfterTransform([{ ...bevel, angle: 10 }], { rotate: 30 })[0] as { angle: number }).angle, 340);
  const turned = effectsAfterTransform([bevel], { rotate: 30 })[0] as typeof bevel;
  assert.notEqual(turned.highlight, bevel.highlight, 'a shade is copied, not shared');
});

// ---- Options ----------------------------------------------------------------------------

test('every effect has its options, and every field reads a value from the effect\'s defaults', () => {
  for (const type of EFFECT_TYPES) {
    const fields = EFFECT_FIELDS[type];
    assert.ok(fields.length > 0, type);
    for (const field of fields) {
      const value = effectFieldValue(defaultEffect(type), field.key);
      assert.notEqual(value, undefined, `${type}.${field.key}`);
      if (typeof value === 'number' && field.min !== undefined) assert.ok(value >= field.min, `${type}.${field.key} >= min`);
      if (typeof value === 'number' && field.max !== undefined) assert.ok(value <= field.max, `${type}.${field.key} <= max`);
      if (field.kind === 'choice') assert.ok(field.choices?.some((choice) => choice.value === value), `${type}.${field.key} is a choice`);
      if (field.kind === 'blend') assert.ok(BLEND_FIELD_CHOICES.some((choice) => choice.value === value), `${type}.${field.key} is a blend`);
    }
    assert.ok(EFFECT_LABELS[type] && EFFECT_ORIGINS[type], `${type} is named, and where it comes from`);
  }
});

test('a drop shadow written before its blend, opacity and spread reads as what it paints', () => {
  const old = { type: 'drop-shadow', dx: 2, dy: 2, blur: 3, color: '#000000' } as Effect;
  assert.equal(effectFieldValue(old, 'blend'), 'normal');
  assert.equal(effectFieldValue(old, 'opacity'), 1);
  assert.equal(effectFieldValue(old, 'spread'), 0);
});

test('a field is set in a new effect, a shade copied rather than shared', () => {
  const bevel = defaultEffect('bevel');
  const brighter = withEffectField(bevel, 'highlight.opacity', 0.4) as typeof bevel;
  assert.equal(brighter.highlight.opacity, 0.4);
  assert.equal(bevel.highlight.opacity, 0.75, 'the old effect is as it was');
  assert.equal(brighter.shadow, bevel.shadow, 'a shade not changed may be shared');
  assert.equal((withEffectField(blur(1), 'radius', 6) as { radius: number }).radius, 6);
});

test('Use Preview Bounds counts what an effect paints past the ink, and nothing for one that paints inside it', () => {
  assert.equal(effectPaintReach([defaultEffect('inner-glow'), defaultEffect('inner-shadow'), defaultEffect('feather')]), 0);
  assert.equal(effectPaintReach([{ ...defaultEffect('bevel'), style: 'inner' }]), 0);
  assert.equal(effectPaintReach([blur(2)]), 6);
  assert.equal(effectPaintReach([{ ...shadow(4, -6), blur: 2 }]), 9);
  assert.equal(effectPaintReach([{ ...shadow(4, -6), on: false }]), 0, 'a switched-off effect paints nothing');
});

// ---- Geometry effects and Expand Appearance ----------------------------------------------

const pts = (list: Array<[number, number]>): Point[] => list.map(([x, y]) => ({ x, y, pressure: 0.5 }));
const square = (effects?: Effect[]): Stroke => ({
  id: 's',
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill: '#27486d',
  points: pts([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]),
  ...(effects ? { effects } : {}),
});

// A fixture geometry effect: it moves the mark's points right by its amount.
registerGeometryEffect('test-nudge', {
  expand: (stroke, effect) => [
    {
      ...stroke,
      points: stroke.points.map((p) => ({ ...p, x: p.x + (effect as unknown as { amount: number }).amount })),
    },
  ],
});
const nudge = (amount: number, on?: false): Effect => ({ type: 'test-nudge', amount, ...(on === false ? { on } : {}) }) as unknown as Effect;

test('a geometry effect works on the shape before any raster effect works on its picture, whatever its place', () => {
  const effects = [blur(2), nudge(5), shadow(), nudge(1)];
  assert.ok(isGeometryEffect(nudge(1)) && !isGeometryEffect(blur(1)));
  assert.deepEqual(
    inDrawingOrder(effects).map((effect) => effect.type),
    ['test-nudge', 'test-nudge', 'blur', 'drop-shadow'],
  );
  assert.equal((inDrawingOrder(effects)[0] as unknown as { amount: number }).amount, 5, 'each kind keeps its own order');
  assert.ok(hasGeometryEffects(effects));
  assert.ok(!hasGeometryEffects([nudge(3, false)]), 'a switched-off one bakes nothing');
  assert.ok(!hasGeometryEffects(undefined));
});

test('Expand Appearance bakes the geometry effects into the anchors and leaves the raster effects live', () => {
  const mark = square([blur(2), nudge(5), nudge(1, false), shadow()]);
  const expanded = expandAppearance(mark);
  assert.ok(expanded && expanded.marks.length === 1, 'an effect that bends the mark leaves one mark');
  const [baked] = expanded.marks;
  assert.deepEqual(baked.points.map((p) => p.x), [5, 15, 15, 5, 5]);
  assert.deepEqual(baked.effects?.map((effect) => effect.type), ['blur', 'test-nudge', 'drop-shadow'], 'the switched-off one stays, as it is');
  assert.deepEqual(mark.points.map((p) => p.x), [0, 10, 10, 0, 0], 'the mark given is as it was');
  const bare = expandAppearance(square([nudge(2)]));
  assert.ok(bare && !('effects' in bare.marks[0]), 'no effects left takes the field away');
  assert.equal(expandAppearance(square([blur(2)])), null, 'nothing to bake');
});

// ---- The store ----------------------------------------------------------------------------

function storeOf(...strokes: Stroke[]): Store {
  const book = createSketchBook('t');
  const sketch = book.sketches[0];
  sketch.layers = strokes.map((s, i): Layer => ({ id: `ly_${s.id}`, name: `Layer ${i + 1}`, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes.map((s) => ({ ...s, layer: `ly_${s.id}` }));
  return new Store(book);
}

test('setEffects gives each mark a new list, as one step, and an undo puts back the very list it had', () => {
  const store = storeOf(square([blur(2)]));
  const before = store.sketch.strokes[0].effects!;
  assert.ok(store.setEffects(['s'], (current) => addEffect(current, shadow())));
  const after = store.sketch.strokes[0].effects!;
  assert.notEqual(after, before, 'a new array');
  assert.deepEqual(before, [blur(2)], 'the old one untouched, which the undo snapshot shares');
  assert.equal(after.length, 2);
  assert.equal(store.setEffects(['s'], (current) => [...current]), false, 'no change, no step');
  store.undo();
  assert.equal(store.sketch.strokes[0].effects, before, 'the very list it had, not a copy of it');
  assert.deepEqual(before, [blur(2)]);
  assert.ok(store.setEffects(['s'], []));
  assert.equal('effects' in store.sketch.strokes[0], false, 'an empty list takes the field away');
});

test('setLayerEffects does the same for a layer or a group', () => {
  const store = storeOf(square());
  assert.ok(store.setLayerEffects(['ly_s'], [glow()]));
  assert.equal(store.sketch.layers[0].effects?.[0].type, 'outer-glow');
  store.undo();
  assert.equal(store.sketch.layers[0].effects, undefined);
});

test('a scale, a turn and a mirror take the effects with the mark, unless Scale Strokes and Effects is off', () => {
  const store = storeOf(square([blur(2), shadow(4, 0)]));
  store.scaleStrokes(['s'], 2, 2, 0, 0);
  assert.deepEqual(store.sketch.strokes[0].effects?.map((effect) => ('radius' in effect ? effect.radius : (effect as { dx: number }).dx)), [4, 8]);
  store.rotateStrokes(['s'], 90, 10, 10);
  const turned = store.sketch.strokes[0].effects![1] as { dx: number; dy: number };
  assert.deepEqual([turned.dx, turned.dy], [0, 8], 'the shadow turns with it');
  store.mirrorStrokes(['s'], { flipX: false, flipY: true, x: 0, y: 5 });
  const mirrored = store.sketch.strokes[0].effects![1] as { dx: number; dy: number };
  assert.deepEqual([mirrored.dx, mirrored.dy], [0, -8]);

  const still = storeOf(square([blur(2), shadow(4, 0)]));
  still.scaleStrokesAndEffects = false;
  still.scaleStrokes(['s'], 2, 2, 0, 0);
  still.rotateStrokes(['s'], 90, 10, 10);
  assert.deepEqual(still.sketch.strokes[0].effects, [blur(2), shadow(4, 0)]);
  assert.equal(still.sketch.strokes[0].width, 2, 'nor its width');
});

// ---- The menus and the markup --------------------------------------------------------------

test('the Effect menu greys its rows by the questions the plan names', () => {
  for (const question of ['noSelection', 'noEffects', 'noLastEffect', 'noGeometryEffects'] as const) {
    assert.ok((MENU_PREDICATES as readonly string[]).includes(question), question);
  }
  const effect = (state: Parameters<typeof menuTree>[1]) => menuTree(defaultRegistry(), state).find((menu) => menu.id === 'effect')!;
  const rows = (state: Parameters<typeof menuTree>[1]) =>
    effect(state).items.flatMap((row) => (row.kind === 'item' ? [row, ...(row.submenu ?? []).filter((kid) => kid.kind === 'item')] : []));
  const disabled = (state: Parameters<typeof menuTree>[1]) =>
    rows(state)
      .filter((row) => row.kind === 'item' && row.disabled)
      .map((row) => (row.kind === 'item' ? row.id : ''));
  assert.deepEqual(disabled({}), []);
  assert.deepEqual(disabled({ noLastEffect: true }), ['apply-last-effect', 'last-effect']);
  assert.deepEqual(disabled({ noEffects: true, noGeometryEffects: true }), ['expand-appearance', 'clear-appearance']);
  const greyed = disabled({ noSelection: true });
  assert.ok(greyed.includes('effect-outer-glow') && greyed.includes('effect-gaussian-blur'));
  assert.ok(!greyed.includes('effect-stylize'), 'a submenu still opens, to show what is in it');
});

test('index.html has every part the Appearance panel and the options popup look for', () => {
  const html = readFileSync(resolve(repoRoot(), 'src', 'renderer', 'index.html'), 'utf8');
  const block = (id: string): string => {
    const start = html.indexOf(`<div id="${id}"`);
    assert.ok(start >= 0, `there is a #${id}`);
    return html.slice(start, html.indexOf('<!--', start));
  };
  const panel = block('appearance-dialog');
  for (const part of APPEARANCE_PANEL_PARTS) assert.ok(panel.includes(`id="${part}"`), `#appearance-dialog has #${part}`);
  assert.ok(panel.includes('data-panel="persistent"'), 'the panel is no dialog in the way of Move and Rotate');
  assert.ok(panel.includes('class="export-dialog is-hidden"'), 'it starts hidden');
  const options = block('effect-options-dialog');
  for (const part of EFFECT_OPTIONS_PARTS) assert.ok(options.includes(`id="${part}"`), `#effect-options-dialog has #${part}`);
  assert.ok(/id="effect-options-preview" type="checkbox" checked/.test(options), 'Preview starts on');
  for (const id of ['prop-opacity', 'prop-blend', 'prop-fx', 'prop-effects']) assert.ok(html.includes(`id="${id}"`), `the Properties panel has #${id}`);
});
