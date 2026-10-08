/**
 * Geometry effects on text (src/core/geometry-effects.ts, through
 * src/core/type/outline.ts), on the fixture font in test/fonts/: with an
 * outline source current a Warp bends a text's shapes, 3D builds them as one
 * solid, a Splatter hatches them, and a group's Warp bends a text it holds -
 * each where the text's bounds then are; with none, a text draws as text.
 * Expand Appearance bakes a warped text into a mark a glyph; the text being
 * typed draws as text; and a text so drawn takes its effects as one picture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultEffect, type Effect } from '../src/core/effects.js';
import { expandAppearance, markEffectPlan } from '../src/core/appearance.js';
import { bindGeometry, drawsGeometry, geometryOf, setTypingText } from '../src/core/geometry-effects.js';
import { strokeBounds } from '../src/core/bounds.js';
import { layoutType } from '../src/core/type/layout.js';
import { HEADLESS_MEASURE } from '../src/core/type/measure.js';
import { fileOutlineSource, withOutlineSource } from '../src/core/type/outline.js';
import { createGroupLayer, createLayer, createSketch, type Stroke } from '../src/core/types.js';
import { repoRoot } from './helpers/repo-root.js';

const SANS = new Uint8Array(readFileSync(join(repoRoot(), 'test', 'fonts', 'napkin-test-sans.ttf')));
const source = fileOutlineSource({ 'Napkin Test Sans': SANS }, HEADLESS_MEASURE);

const text = (effects: Effect[] = [], extra: Partial<Stroke> = {}): Stroke => ({
  id: `tx${Math.random().toString(36).slice(2)}`,
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 20, y: 40, pressure: 0.5 }],
  text: 'To To',
  fontSize: 40.96,
  fontFamily: 'Napkin Test Sans',
  effects,
  ...extra,
});

const warp = (): Effect => ({ ...defaultEffect('warp'), bend: 60 }) as Effect;

test('with no outline source, a text takes no geometry effect and draws as text', () => {
  const t = text([warp()]);
  assert.equal(drawsGeometry(t), false);
  assert.equal(geometryOf(t), null);
});

test("a Warp bends a text's shapes over their box, and the text is where they are drawn", () =>
  withOutlineSource(source, () => {
    const t = text([warp()]);
    assert.equal(drawsGeometry(t), true);
    const drawn = geometryOf(t);
    assert.ok(drawn?.faces && drawn.faces.length === 1, 'one color, one mark');
    const mark = drawn.faces[0];
    assert.deepEqual([mark.tool, mark.fill, mark.noStroke], ['pen', '#1f2328', true]);
    // Four glyphs - T, o, T, o - and the o's counters: six subpaths.
    assert.equal(mark.vector!.anchors.filter((a) => a.move).length + 1, 6);
    const laid = layoutType(t, source.measure).bounds;
    const bent = strokeBounds(t, source.measure)!;
    assert.notDeepEqual(bent, laid, 'the bounds are the bent shapes');
    assert.ok(bent.maxY - bent.minY > 10, JSON.stringify(bent));
  }));

test('3D builds a text as one solid, and a Splatter hatches it', () =>
  withOutlineSource(source, () => {
    const built = geometryOf(text([defaultEffect('3d')]));
    assert.ok(built?.faces && built.faces.length > 6, `${built?.faces?.length} faces`);
    const hatched = geometryOf(text([defaultEffect('splatter')]));
    assert.ok(hatched?.faces && hatched.faces.length > 0 && hatched.faces.every((mark) => mark.vector?.closed !== true), 'open runs of hatch');
  }));

test("a group's Warp bends a text it holds, counted in the group's box by its layout", () =>
  withOutlineSource(source, () => {
    const sketch = createSketch('group');
    const group = createGroupLayer('Logo');
    group.effects = [warp()];
    const leaf = createLayer('Words');
    leaf.parent = group.id;
    sketch.layers = [leaf, group];
    const t = { ...text(), layer: leaf.id };
    sketch.strokes = [t];
    bindGeometry(sketch);
    assert.ok(geometryOf(t)?.faces, 'bent by the group');
  }));

test('Expand Appearance bakes a warped text into a mark a glyph, each new', () =>
  withOutlineSource(source, () => {
    const t = text([warp()]);
    const expanded = expandAppearance(t);
    assert.ok(expanded, 'it has something to bake');
    assert.equal(expanded.marks.length, 4, 'T o T o');
    assert.ok(expanded.marks.every((mark) => mark.tool === 'pen' && mark.id !== t.id && mark.effects === undefined));
    assert.equal(new Set(expanded.marks.map((mark) => mark.id)).size, 4);
  }));

test('the text being typed draws as text, and as its shapes again once it is put down', () =>
  withOutlineSource(source, () => {
    const t = text([warp()]);
    setTypingText(t.id);
    try {
      assert.equal(geometryOf(t), null);
    } finally {
      setTypingText(null);
    }
    assert.ok(geometryOf(t)?.faces);
  }));

test('a text drawn as its shapes takes its effects as one picture, as a 3D build does', () =>
  withOutlineSource(source, () => {
    const plan = markEffectPlan(text([warp(), defaultEffect('drop-shadow')]));
    assert.ok(plan && plan.split === false && plan.object.length === 1, JSON.stringify(plan));
  }));
