/**
 * Regression tests for the 4.1.2-alpha source review fixes.
 *
 * Each test pins one defect the review found, so the behaviour cannot drift
 * back: the per-layer stroke and layer-state lookups that made rendering,
 * exporting, and hit testing cost the square of the page's size, a fully
 * transparent mark that came back opaque, the export-all file stem that
 * vanished when the chosen name carried no extension, and a helper log path
 * that could be pointed outside the working directory it is measured from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupLayer,
  createLayer,
  createSketch,
  effectiveLayer,
  effectiveLayers,
  strokesByLayer,
  strokesOnLayer,
  type Sketch,
  type Stroke,
} from '../src/core/types.js';
import { normalizeSketchBook } from '../src/core/serialize.js';
import { defaultSettings, normalizeRelativePath, normalizeSettings } from '../src/core/settings.js';

/** A minimal drawing stroke on a named layer. */
function mark(id: string, layer?: string): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#1f2328',
    width: 3,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    ...(layer ? { layer } : {}),
  };
}

/** A sketch with one layer per mark, which is how the editor commits them. */
function pageWithLayers(count: number): Sketch {
  const sketch = createSketch();
  sketch.layers = [];
  sketch.strokes = [];
  for (let i = 0; i < count; i++) {
    const layer = createLayer(`Layer ${i + 1}`);
    sketch.layers.push(layer);
    sketch.strokes.push(mark(`s${i}`, layer.id));
  }
  return sketch;
}

test('strokesByLayer groups every mark under the layer it paints on', () => {
  const sketch = pageWithLayers(3);
  const byLayer = strokesByLayer(sketch);
  assert.equal(byLayer.size, 3);
  for (const layer of sketch.layers) {
    assert.deepEqual(
      (byLayer.get(layer.id) ?? []).map((s) => s.id),
      sketch.strokes.filter((s) => s.layer === layer.id).map((s) => s.id),
    );
  }
});

test('strokesByLayer keeps paint order within a layer', () => {
  const sketch = createSketch();
  const layer = sketch.layers[0];
  sketch.strokes = [mark('a', layer.id), mark('b', layer.id), mark('c', layer.id)];
  assert.deepEqual(
    (strokesByLayer(sketch).get(layer.id) ?? []).map((s) => s.id),
    ['a', 'b', 'c'],
  );
});

test('strokesByLayer files an orphaned mark on the first drawable layer', () => {
  const sketch = createSketch();
  const bottom = sketch.layers[0];
  sketch.layers.push(createLayer('Layer 2'));
  // No layer id at all, and an id naming a layer this page does not have.
  sketch.strokes = [mark('none'), mark('stale', 'ly_missing')];
  const byLayer = strokesByLayer(sketch);
  assert.deepEqual((byLayer.get(bottom.id) ?? []).map((s) => s.id), ['none', 'stale']);
});

test('strokesByLayer never files a mark on a group row', () => {
  const sketch = createSketch();
  const drawable = sketch.layers[0];
  const group = createGroupLayer('Group 1');
  sketch.layers.push(group);
  sketch.strokes = [mark('inside', group.id)];
  const byLayer = strokesByLayer(sketch);
  assert.equal(byLayer.has(group.id), false);
  assert.deepEqual((byLayer.get(drawable.id) ?? []).map((s) => s.id), ['inside']);
});

test('strokesOnLayer still answers for one layer, and agrees with the grouping', () => {
  const sketch = pageWithLayers(4);
  const byLayer = strokesByLayer(sketch);
  for (const layer of sketch.layers) {
    assert.deepEqual(
      strokesOnLayer(sketch, layer.id).map((s) => s.id),
      (byLayer.get(layer.id) ?? []).map((s) => s.id),
    );
  }
  assert.deepEqual(strokesOnLayer(sketch, 'ly_missing'), []);
});

test('a fully transparent mark stays transparent through a reload', () => {
  const raw = {
    format: 'napkin-sketch',
    version: 3,
    name: 'demo',
    sketches: [{ strokes: [{ ...mark('ghost'), opacity: 0 }] }],
  };
  const book = normalizeSketchBook(raw);
  assert.equal(book.sketches[0].strokes[0].opacity, 0);
});

test('an out-of-range opacity still falls back to the tool default', () => {
  const raw = {
    format: 'napkin-sketch',
    version: 3,
    name: 'demo',
    sketches: [
      { strokes: [{ ...mark('over'), opacity: 1.5 }, { ...mark('under'), opacity: -1 }] },
    ],
  };
  const strokes = normalizeSketchBook(raw).sketches[0].strokes;
  assert.equal(strokes[0].opacity, undefined);
  assert.equal(strokes[1].opacity, undefined);
});

test('effectiveLayers matches effectiveLayer for every layer in a nested stack', () => {
  const sketch = createSketch();
  const outer = createGroupLayer('Outer');
  const inner = createGroupLayer('Inner');
  const leaf = createLayer('Leaf');
  inner.parent = outer.id;
  leaf.parent = inner.id;
  outer.opacity = 0.5;
  inner.opacity = 0.5;
  leaf.opacity = 0.8;
  inner.locked = true;
  sketch.layers.push(outer, inner, leaf);

  const resolved = effectiveLayers(sketch);
  for (const layer of sketch.layers) {
    assert.deepEqual(resolved.get(layer.id), effectiveLayer(sketch, layer));
  }
  // The nesting itself: opacity multiplies down, a locked group locks below it.
  assert.equal(resolved.get(leaf.id)?.opacity, 0.5 * 0.5 * 0.8);
  assert.equal(resolved.get(leaf.id)?.locked, true);
  assert.equal(resolved.get(outer.id)?.locked, false);
});

test('effectiveLayers hides everything under a hidden group', () => {
  const sketch = createSketch();
  const group = createGroupLayer('Group 1');
  const leaf = createLayer('Leaf');
  group.visible = false;
  leaf.parent = group.id;
  sketch.layers.push(group, leaf);
  assert.equal(effectiveLayers(sketch).get(leaf.id)?.visible, false);
});

test('effectiveLayers terminates on a parent cycle', () => {
  const sketch = createSketch();
  const a = createGroupLayer('A');
  const b = createGroupLayer('B');
  a.parent = b.id;
  b.parent = a.id;
  sketch.layers.push(a, b);
  const resolved = effectiveLayers(sketch);
  assert.equal(resolved.size, sketch.layers.length);
  for (const state of resolved.values()) assert.equal(Number.isFinite(state.opacity), true);
});

test('normalizeRelativePath keeps a relative path and the empty "off" value', () => {
  assert.equal(normalizeRelativePath('logs/animation-helper.log', 'fallback.log'), 'logs/animation-helper.log');
  assert.equal(normalizeRelativePath('  logs/a.log  ', 'fallback.log'), 'logs/a.log');
  assert.equal(normalizeRelativePath('', 'fallback.log'), '');
});

test('normalizeRelativePath refuses anything that escapes the working directory', () => {
  for (const escaping of [
    '/var/log/napkin.log',
    '\\\\server\\share\\napkin.log',
    'C:/Windows/Temp/napkin.log',
    'c:napkin.log',
    '../outside.log',
    'logs/../../outside.log',
    'logs\\..\\..\\outside.log',
  ]) {
    assert.equal(normalizeRelativePath(escaping, 'fallback.log'), 'fallback.log', escaping);
  }
  assert.equal(normalizeRelativePath(42, 'fallback.log'), 'fallback.log');
});

test('a settings file cannot point the helper log outside the work directory', () => {
  const settings = normalizeSettings({ animationLogFile: '../../elsewhere.log' });
  assert.equal(settings.animationLogFile, defaultSettings().animationLogFile);
  assert.equal(normalizeSettings({ animationLogFile: '' }).animationLogFile, '');
});
