/**
 * Napkin Blends in the model and every output (src/core/blend.ts): a layer's
 * blend kept through a save and a load, the groups the canvas paints as one
 * picture, the SVG's `mix-blend-mode`, the PDF's `/BM` on a transparency
 * group, the Illustrator script's `blendingMode`, the composition and the
 * pixels the headless renderer mixes, and an imported tree's blends. The GUI
 * check `check-blend.mjs` drives the same blends on the canvas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blendPixel } from '../src/core/blend.js';
import { pageBlends, pictureGroupIds } from '../src/core/paint-order.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { compositionToSvg, rasterizeComposition } from '../src/core/graphic-design/index.js';
import { buildImportedLayers } from '../src/core/imported-sketch.js';
import { createSketchBook, type Layer, type Point, type Sketch, type Stroke } from '../src/core/types.js';
import { itemsOf, layersOf, runJsx, type GroupItem } from './helpers/illustrator.js';

const PAPER = '#d9c49a';
const pts = (list: Array<[number, number]>): Point[] => list.map(([x, y]) => ({ x, y, pressure: 0.5 }));
const square = (id: string, layer: string, x: number, y: number, size: number, fill: string): Stroke => ({
  id,
  tool: 'pen',
  color: fill,
  width: 1,
  fill,
  noStroke: true,
  layer,
  points: pts([[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]),
});
const layer = (id: string, name: string, extra: Partial<Layer> = {}): Layer => ({ id, name, opacity: 1, visible: true, locked: false, ...extra });

/** A yellow square under a blue one in Stack Blend, on kraft paper, 100 by 100. */
function stacked(extra: Partial<Layer> = { blend: 'stack' }): Sketch {
  const sketch = createSketchBook('blend').sketches[0];
  sketch.width = 100;
  sketch.height = 100;
  sketch.background = PAPER;
  sketch.layers = [layer('la', 'Yellow'), layer('lb', 'Blue', extra)];
  sketch.strokes = [square('a', 'la', 10, 10, 60, '#ffcc00'), square('b', 'lb', 40, 40, 50, '#3399ff')];
  return sketch;
}

/** The same two in a group, which may carry a blend, Isolate Blending or an opacity of its own. */
function grouped(group: Partial<Layer>, blue: Partial<Layer> = { blend: 'stack' }): Sketch {
  const sketch = stacked(blue);
  sketch.layers = [layer('la', 'Yellow', { parent: 'g' }), layer('lb', 'Blue', { ...blue, parent: 'g' }), layer('g', 'Pair', { group: true, ...group })];
  return sketch;
}

test('a layer keeps its blend through a save and a load, by any of its names', () => {
  const book = createSketchBook('kept');
  book.sketches[0] = grouped({ isolate: true, blend: 'sheer' });
  const back = parseSketchBook(serializeSketchBook(book)).sketches[0];
  assert.equal(back.layers.find((l) => l.id === 'lb')?.blend, 'stack');
  const group = back.layers.find((l) => l.id === 'g');
  assert.equal(group?.blend, 'sheer');
  assert.equal(group?.isolate, true);

  const raw = JSON.parse(serializeSketchBook(book));
  const layers = raw.sketches[0].layers;
  layers[0].blend = 'multiply'; // Illustrator's name, written by hand
  layers[0].isolate = true; // not a group: Isolate Blending is a group's
  layers[1].blend = 'normal'; // Normal is no blend
  layers[2].blend = 'plaid';
  const read = parseSketchBook(JSON.stringify(raw)).sketches[0].layers;
  assert.equal(read[0].blend, 'stack', 'multiply reads as Stack Blend');
  assert.equal(read[0].isolate, undefined);
  assert.equal('blend' in read[1], false, 'Normal is left off');
  assert.equal('blend' in read[2], false, 'an unknown name is dropped');
});

test('a blended or isolated group paints as one picture, and so does a translucent group holding a blend', () => {
  assert.equal(pageBlends(stacked()), true);
  assert.equal(pageBlends(stacked({})), false);
  assert.deepEqual([...pictureGroupIds(grouped({ blend: 'messy' }, {}))], ['g'], 'its own blend');
  assert.deepEqual([...pictureGroupIds(grouped({ isolate: true }, {}))], ['g'], 'Isolate Blending');
  assert.deepEqual([...pictureGroupIds(grouped({ opacity: 0.5 }))], ['g'], 'translucent, with a blend inside');
  assert.deepEqual([...pictureGroupIds(grouped({ opacity: 0.5 }, {}))], [], 'translucent, with none: the canvas keeps passing it through');
  assert.deepEqual([...pictureGroupIds(grouped({}))], [], 'a plain group lets its blends reach past it');
});

test('the SVG writes the blend as mix-blend-mode, with its napkin name beside it', () => {
  const svg = sketchToSvg(stacked());
  assert.match(svg, /<g id="Blue"[^>]* data-blend="stack" style="mix-blend-mode:multiply">/);
  assert.doesNotMatch(svg, /<g id="Yellow"[^>]*style=/, 'a Normal layer has no style');
  assert.doesNotMatch(svg, /isolation/, 'the art is not isolated from the paper');
  const both = sketchToSvg(grouped({ blend: 'sheer', isolate: true }));
  assert.match(both, /<g id="Pair"[^>]* data-blend="sheer" style="mix-blend-mode:screen;isolation:isolate">/);
});

test('the PDF prints a blended layer as a transparency group mixed by /BM', () => {
  const pdf = sketchesToPdf([stacked()]);
  assert.match(pdf, /<< \/Type \/ExtGState \/BM \/Multiply >>/, 'a state for the blend alone');
  assert.match(pdf, /\/Subtype \/Form \/BBox \[0 0 100 100\] \/Group << \/S \/Transparency \/I true \/K false >> \/Resources << \/Font/);
  assert.ok(!pdf.includes('%%napkin-resources%%'), 'every form has the page\'s resources');
  assert.match(pdf, /^\/GS\d+ gs\n\/Fm1 Do$/m, 'the form laid down through the blend');
  assert.match(pdf, /\/Group << \/S \/Transparency \/CS \/DeviceRGB >> >>/, 'the page blends in RGB');
  assert.equal((pdf.match(/^q$/gm) ?? []).length, (pdf.match(/^Q$/gm) ?? []).length, 'saves and restores balance');

  const plain = sketchesToPdf([stacked({})]);
  for (const word of ['/BM', '/Form', '/Transparency']) assert.ok(!plain.includes(word), `no ${word} on a page with no blend`);

  // A translucent layer with a blend: the alpha and the blend in one state, the marks inside at their own.
  const translucent = sketchesToPdf([stacked({ blend: 'cover', opacity: 0.5 })]);
  assert.match(translucent, /<< \/Type \/ExtGState \/CA 0\.5 \/ca 0\.5 \/BM \/Luminosity >>/);
  // An isolated group with no blend of its own: a group, and no /BM for it.
  const isolated = sketchesToPdf([grouped({ isolate: true }, {})]);
  assert.match(isolated, /\/Subtype \/Form/);
  assert.ok(!isolated.includes('/BM'));
});

test('the Illustrator script sets each layer\'s blendingMode, and a group\'s isolation', () => {
  const [doc] = runJsx(sketchesToJsx([grouped({ isolate: true, blend: 'dye' })])).documents;
  // The paper is drawn on a "Background" layer first.
  const pair = layersOf(doc).find((l) => l.name === 'Pair');
  assert.ok(pair, layersOf(doc).map((l) => l.name).join(', '));
  assert.equal(pair.blendingMode, 'COLORBLEND');
  assert.equal(pair.isIsolated, true);
  const inner = itemsOf(pair) as GroupItem[];
  assert.deepEqual(inner.map((item) => [item.name, item.blendingMode]), [['Yellow', 'NORMAL'], ['Blue', 'MULTIPLY']]);
  // A layer with neither is opened as it always was.
  assert.match(sketchesToJsx([stacked({})]), /open\("Blue", 100\);/);
});

/** One pixel of an RGBA buffer. */
const at = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
const near = (actual: number[], expected: number[], label: string, tol = 1): void => {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tol, `${label}: got ${actual}, want ${expected}`));
};

test('the headless renderer mixes Stack Blend with what is under it, the paper included', () => {
  const doc = sketchToComposition(stacked());
  const blue = doc.elements[1];
  assert.equal(blue.blend, 'stack', 'the composition carries the blend');
  const { width, data } = rasterizeComposition(doc);
  const mix = (under: [number, number, number], over: [number, number, number]): number[] =>
    [...blendPixel('stack', [...under.map((v) => v / 255), 1] as never, [...over.map((v) => v / 255), 1] as never).slice(0, 3).map((v) => Math.round(v * 255)), 255];
  near(at(data, width, 55, 55), mix([255, 204, 0], [51, 153, 255]), 'blue over yellow: (51, 122, 0)');
  near(at(data, width, 80, 80), mix([217, 196, 154], [51, 153, 255]), 'blue over the paper: multiplied into it');
  near(at(data, width, 20, 20), [255, 204, 0, 255], 'yellow, Normal, covers the paper');
  near(at(data, width, 4, 4), [217, 196, 154, 255], 'the paper');

  // Isolated, the pair mixes only inside the group: blue over yellow is
  // still multiplied, but blue alone keeps its own color off the paper.
  const iso = rasterizeComposition(sketchToComposition(grouped({ isolate: true })));
  near(at(iso.data, iso.width, 55, 55), mix([255, 204, 0], [51, 153, 255]), 'isolated: inside the group, mixed');
  near(at(iso.data, iso.width, 80, 80), [51, 153, 255, 255], 'isolated: over nothing in the group, its own color');
});

test('a composition element with a blend is written and drawn as one', () => {
  const doc = {
    width: 40,
    height: 20,
    units: 'px' as const,
    background: '#808080',
    useGuiCanvas: false,
    clips: [],
    elements: [
      { type: 'rect' as const, x: 0, y: 0, width: 40, height: 20, fill: '#ff0000', blend: 'messy' as const },
      { type: 'group' as const, isolate: true, children: [{ type: 'rect' as const, x: 20, y: 0, width: 20, height: 20, fill: '#00ff00', blend: 'stack' as const }] },
    ],
  };
  const svg = compositionToSvg(doc);
  assert.match(svg, /data-blend="messy" style="mix-blend-mode:difference"/);
  assert.match(svg, /style="isolation:isolate"/);
  const { width, data } = rasterizeComposition(doc);
  near(at(data, width, 10, 10), [127, 128, 128, 255], 'red differenced with grey: |128 - 255|, 128, 128');
  near(at(data, width, 30, 10), [0, 255, 0, 255], 'green in an isolated group: nothing inside to multiply with');
});

test('an imported tree keeps its layers\' blends and a group\'s isolation', () => {
  const built = buildImportedLayers([
    {
      name: 'Pair',
      opacity: 1,
      strokes: [square('x', '', 0, 0, 10, '#000')],
      blend: 'sheer',
      isolate: true,
      children: [{ name: 'Shade', opacity: 1, strokes: [square('y', '', 0, 0, 10, '#111')], blend: 'stack' }],
    },
  ]);
  const byName = new Map(built.layers.map((l) => [l.name, l]));
  assert.equal(byName.get('Pair')?.blend, 'sheer');
  assert.equal(byName.get('Pair')?.isolate, true);
  assert.equal(byName.get('Shade')?.blend, 'stack');
  assert.equal(byName.get('Pair contents')?.blend, undefined, 'the marks kept on the group are inside its picture, and take no second blend');
});

test('the marks a file kept on a group take none of the group\'s effects a second time', () => {
  const shadow = { type: 'drop-shadow' as const, dx: 2, dy: 2, blur: 4, color: '#000000' };
  const built = buildImportedLayers([
    { name: 'Card', opacity: 0.5, strokes: [square('x', '', 0, 0, 10, '#000')], effects: [shadow], children: [{ name: 'Art', opacity: 1, strokes: [square('y', '', 0, 0, 10, '#111')] }] },
  ]);
  const byName = new Map(built.layers.map((l) => [l.name, l]));
  assert.deepEqual(byName.get('Card')?.effects, [shadow], 'the group has its shadow');
  assert.equal(byName.get('Card contents')?.effects, undefined, 'its own marks are inside its picture, not shadowed again');
  assert.equal(byName.get('Card contents')?.opacity, 1, 'nor faded again');
});
