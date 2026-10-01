/**
 * A clip group in every output (src/core/clip.ts): the SVG's <clipPath> with
 * the group clipped by it - on a group of its own inside when the group has
 * effects - the PDF's `W n`, the composition's clip, the Illustrator script's
 * clipped group, and an imported clip group's mark found by its new id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { buildImportedLayers } from '../src/core/imported-sketch.js';
import { createSketchBook, type Layer, type Point, type Sketch, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';
import type { Element } from '../src/core/graphic-design/types.js';

const pts = (list: Array<{ x: number; y: number }>): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 }));

const rect: Stroke = {
  id: 'r',
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill: '#27486d',
  points: pts([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }]),
};
const ring = Array.from({ length: 32 }, (_, i) => ({ x: 100 + 50 * Math.cos((i / 32) * Math.PI * 2), y: 100 + 50 * Math.sin((i / 32) * Math.PI * 2) }));
const circle: Stroke = { id: 'c', tool: 'pen', color: '#d0342c', width: 3, points: pts([...ring, ring[0]]) };

/** A rectangle clipped by a circle in its middle, made by the store as the app makes it. */
function clipped(effects = false): Sketch {
  const book = createSketchBook('t');
  const sketch = book.sketches[0];
  sketch.layers = [rect, circle].map((s, i): Layer => ({ id: `ly_${s.id}`, name: `Layer ${i + 1}`, opacity: 1, visible: true, locked: false }));
  sketch.strokes = [rect, circle].map((s) => ({ ...s, layer: `ly_${s.id}` }));
  const store = new Store(book);
  assert.equal(store.makeClipping(['r', 'c']), null);
  if (effects) store.sketch.layers.find((l) => l.group)!.effects = [{ type: 'drop-shadow', dx: 4, dy: 4, blur: 2, color: '#000000' }];
  return store.sketch;
}

test('the SVG clips the group with a <clipPath> holding the clip mark, which paints nothing else', () => {
  const svg = sketchToSvg(clipped());
  const clipPath = /<clipPath id="(clip-\d+)" data-name="Layer 2">(<path [^>]*\/>)<\/clipPath>/.exec(svg);
  assert.ok(clipPath, svg);
  assert.match(clipPath[2], /data-tool="pen"/, 'the mark as napkin writes it, for the importer');
  assert.match(svg, new RegExp(`<g id="Clip_x20_Group"[^>]* clip-path="url\\(#${clipPath[1]}\\)">`), 'the group clipped, its name kept');
  const outside = svg.replace(clipPath[0], '');
  assert.equal((outside.match(/stroke="#d0342c"/g) ?? []).length, 0, 'the circle is not painted');
  assert.equal((outside.match(/ fill="#27486d"/g) ?? []).length, 1, 'the rectangle is');
});

test('with effects, the SVG clips on a group of its own inside, so the shadow falls under what shows', () => {
  const svg = sketchToSvg(clipped(true));
  assert.match(svg, /<g id="Clip_x20_Group"[^>]*filter="url\(#effect-1\)"[^>]*>\n<g clip-path="url\(#clip-\d+\)" data-clip-inner="1">/);
});

test('the PDF draws a clipped layer inside its clip, and not the clip mark', () => {
  const pdf = sketchesToPdf([clipped()]);
  assert.equal((pdf.match(/^W n$/gm) ?? []).length, 1, 'the rectangle\'s layer, clipped');
  assert.equal((pdf.match(/^q$/gm) ?? []).length, (pdf.match(/^Q$/gm) ?? []).length, 'saves and restores balance');
  assert.equal((pdf.match(/0\.8157 0\.2039 0\.1725 RG/g) ?? []).length, 0, 'the circle\'s red outline is not drawn');
});

test('the composition clips the group with the clip\'s outline, and leaves the clip mark out', () => {
  const doc = sketchToComposition(clipped());
  const group = doc.elements[0] as Extract<Element, { type: 'group' }>;
  assert.equal(group.type, 'group');
  assert.equal(typeof group.clip === 'object' && group.clip.type, 'path');
  const paths = JSON.stringify(group.children);
  assert.ok(!paths.includes('#d0342c'), 'no circle among the children');
  const shadowed = sketchToComposition(clipped(true)).elements[0] as Extract<Element, { type: 'group' }>;
  assert.equal(shadowed.clip, undefined, 'with effects, not on the group that carries them');
  assert.equal(((shadowed.children[0] as Extract<Element, { type: 'group' }>).clip as { type: string }).type, 'path', 'but on a group inside');
});

test('the Illustrator script draws the content in a group clipped by the clip mark\'s path', () => {
  const jsx = sketchesToJsx([clipped()]);
  assert.match(jsx, /function clipOpen\(\)/);
  const body = jsx.slice(jsx.indexOf('function build()'));
  assert.equal((body.match(/clipOpen\(\);/g) ?? []).length, 1);
  assert.match(body, /clipClose\(\[\[/);
  assert.ok(body.indexOf('clipOpen();') < body.indexOf('clipClose('));
});

test('an imported clip group names its clip mark by the id it is given', () => {
  const mark: Stroke = { ...circle };
  const built = buildImportedLayers([{ name: 'Window', opacity: 1, strokes: [], clip: mark, children: [{ name: 'Art', opacity: 1, strokes: [rect] }, { name: 'Clipping Path', opacity: 1, strokes: [mark] }] }]);
  const group = built.layers.find((l) => l.group)!;
  const clipMark = built.strokes.find((s) => s.color === '#d0342c')!;
  assert.equal(group.clip, clipMark.id);
  assert.notEqual(clipMark.id, 'c', 'a new id');
});
