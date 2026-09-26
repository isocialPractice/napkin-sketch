/**
 * A sketch lowered into the composition model, which is how a sketch becomes
 * a PNG with no DOM: each kind of mark as the elements that draw it, the paint
 * the composition model gained for it (gradients, erase shapes, groups drawn
 * as one picture), and the PNG against the sketch's own SVG as `rsvg-convert`
 * draws it, on the fixtures in `test/imports/`, wherever `rsvg-convert` is
 * installed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sketchToComposition } from '../src/core/sketch-composition.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { pathD } from '../src/core/svg-path.js';
import {
  compositionToSvg,
  decodePng,
  rasterizeComposition,
  renderPng,
  type CompositionDocument,
  type Element,
  type GroupElement,
  type RasterResult,
} from '../src/core/graphic-design/index.js';
import {
  createGroupLayer,
  createLayer,
  createSketch,
  defaultOpacityFor,
  type Sketch,
  type Stroke,
  type VectorAnchor,
} from '../src/core/types.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';
import { fixtureSketch } from './helpers/fixture-sketch.js';
import { repoRoot } from './helpers/repo-root.js';
import { findRsvg } from './helpers/rsvg.js';
import { pngDataUrl } from './helpers/script-fixtures.js';

/** Sampled points for a polyline through the given coordinates. */
function line(coords: number[][]): Stroke['points'] {
  return coords.map(([x, y]) => ({ x, y, pressure: 0.5 }));
}

/** A closed square as Vector Path anchors, with its points sampled from them. */
function square(x: number, y: number, size: number): Pick<Stroke, 'points' | 'vector'> {
  const anchors: VectorAnchor[] = [
    { p: { x, y } },
    { p: { x: x + size, y } },
    { p: { x: x + size, y: y + size } },
    { p: { x, y: y + size } },
  ];
  return { vector: { anchors, closed: true }, points: sampleVectorPathPoints(anchors, true) };
}

/** A page with one layer, `Base`, holding the given marks. */
function page(...strokes: Array<Omit<Stroke, 'layer'>>): Sketch {
  const sketch = createSketch('page');
  sketch.width = 200;
  sketch.height = 120;
  sketch.layers[0].name = 'Base';
  sketch.strokes.push(...strokes.map((s) => ({ ...s, layer: sketch.layers[0].id })));
  return sketch;
}

/** The elements a one-layer page's marks lowered to. */
function marksOf(sketch: Sketch): Element[] {
  const [layer] = sketchToComposition(sketch).elements;
  assert.equal(layer?.type, 'group');
  return (layer as GroupElement).children;
}

/** The straight RGBA of one device pixel. */
function pixel(raster: RasterResult, x: number, y: number): number[] {
  const i = (y * raster.width + x) * 4;
  return [...raster.data.slice(i, i + 4)];
}

/** True when two colors are within `tolerance` on every channel. */
function near(actual: number[], expected: number[], tolerance = 3): boolean {
  return actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
}

/** A composition page of the given elements, on white. */
function doc(elements: Element[], width = 100, height = 100): CompositionDocument {
  return { width, height, units: 'px', background: '#ffffff', useGuiCanvas: false, clips: [], elements };
}

test('layers become named groups, a group layer holds its children, and a hidden layer is left out', () => {
  const sketch = createSketch('layers');
  const base = sketch.layers[0];
  base.name = 'Base';
  const figure = createGroupLayer('Figure');
  figure.opacity = 0.8;
  const ink = { ...createLayer('Ink'), parent: figure.id };
  const hidden = { ...createLayer('Hidden'), visible: false };
  sketch.layers.push(figure, ink, hidden);
  sketch.strokes.push(
    { id: 'a', tool: 'pen', color: '#1f2328', width: 2, layer: base.id, points: line([[0, 0], [10, 10]]) },
    { id: 'b', tool: 'pen', color: '#1f2328', width: 2, layer: ink.id, points: line([[0, 10], [10, 0]]) },
    { id: 'c', tool: 'pen', color: '#ff0000', width: 2, layer: hidden.id, points: line([[0, 5], [10, 5]]) },
  );
  const lowered = sketchToComposition(sketch);
  assert.deepEqual([lowered.width, lowered.height, lowered.background], [sketch.width, sketch.height, sketch.background]);
  assert.deepEqual(
    lowered.elements.map((el) => el.name),
    ['Base', 'Figure'],
  );
  const group = lowered.elements[1] as GroupElement;
  assert.equal(group.opacity, 0.8);
  assert.deepEqual(
    group.children.map((el) => el.name),
    ['Ink'],
  );
  assert.doesNotMatch(JSON.stringify(lowered), /#ff0000/, 'nothing on a hidden layer is drawn');
});

test('a pen mark is a round path in its ink, with the dash and the opacity the export writes', () => {
  const pen: Stroke = { id: 'p', tool: 'pen', color: '#326478', width: 2, strokeStyle: 'dashed', layer: '', points: line([[10, 10], [90, 10], [90, 60]]) };
  const [path] = marksOf(page(pen));
  assert.deepEqual(path, {
    type: 'path',
    d: pathD(pen),
    fill: null,
    stroke: '#326478',
    strokeWidth: 2,
    lineCap: 'round',
    lineJoin: 'round',
    dash: [6, 4],
  });
  const marks = marksOf(
    page(
      { id: 'm', tool: 'marker', color: '#4cae50', width: 12, points: line([[0, 0], [50, 0]]) },
      { id: 'o', tool: 'pen', color: '#1f2328', width: 3, opacity: 0.5, points: line([[0, 0], [50, 0]]) },
      { id: 'd', tool: 'pen', color: '#dd2255', width: 14, points: line([[40, 40]]) },
    ),
  );
  assert.equal(marks[0].opacity, defaultOpacityFor('marker'), "a marker takes the tool's opacity");
  assert.equal(marks[1].opacity, 0.5, 'a mark of its own opacity keeps it');
  assert.deepEqual(marks[2], { type: 'circle', cx: 40, cy: 40, r: 7, fill: '#dd2255' }, 'a one-point mark is a dot its width across');
});

test('a filled shape keeps its fill, a switched-off outline paints none, and a gradient is gradient paint', () => {
  const stops = [
    { offset: 1, color: '#ff8a65' },
    { offset: 0, color: '#ffe08a' },
  ];
  const [flat, fillOnly, linear, radial] = marksOf(
    page(
      { id: 'f', tool: 'pen', color: '#1f2328', width: 2, fill: '#c0e0ff', ...square(0, 0, 40) },
      { id: 'n', tool: 'pen', color: '#1f2328', width: 2, fill: '#c0e0ff', noStroke: true, ...square(50, 0, 40) },
      { id: 'l', tool: 'pen', color: '#1f2328', width: 2, fill: '#ffe08a', gradient: { type: 'linear', angle: 90, stops }, ...square(100, 0, 40) },
      { id: 'r', tool: 'pen', color: '#1f2328', width: 2, fill: '#ffe08a', gradient: { type: 'radial', stops }, ...square(150, 0, 40) },
    ),
  );
  assert.equal(flat.fill, '#c0e0ff');
  assert.equal(flat.stroke, '#1f2328');
  assert.equal(fillOnly.fill, '#c0e0ff');
  assert.equal(fillOnly.stroke, null);
  const sorted = [
    { offset: 0, color: '#ffe08a' },
    { offset: 1, color: '#ff8a65' },
  ];
  assert.deepEqual(linear.fill, { type: 'linear', angle: 90, stops: sorted }, 'stops sorted, as the export writes them');
  assert.deepEqual(radial.fill, { type: 'radial', stops: sorted });
});

test('a profiled mark is its outline filled in the ink, and a filled one groups its fill under it', () => {
  const centreline = line([[20, 60], [70, 70], [120, 55], [180, 65]]);
  const [outline, group] = marksOf(
    page(
      { id: 'p', tool: 'pen', color: '#1f2328', width: 8, profile: 'rounded', points: centreline },
      { id: 'q', tool: 'pen', color: '#1f2328', width: 8, profile: 'rounded', fill: '#c0e0ff', opacity: 0.5, points: centreline },
    ),
  );
  assert.equal(outline.type, 'path');
  assert.equal(outline.fill, '#1f2328');
  assert.equal(outline.stroke, undefined, 'the outline is filled, never stroked');
  assert.match((outline as { d: string }).d, /Z/i, 'the outline closes');
  assert.equal(group.type, 'group');
  assert.equal(group.opacity, 0.5, 'the opacity covers the fill and the outline together');
  const [under, over] = (group as GroupElement).children;
  assert.equal(under.fill, '#c0e0ff');
  assert.equal(over.fill, '#1f2328');
});

test('a Copic mark is the footprint of its chisel nib', () => {
  const [nib] = marksOf(page({ id: 'c', tool: 'copic', color: '#8e44ad', width: 10, nibAngle: 30, points: line([[20, 20], [100, 50]]) }));
  assert.equal(nib.type, 'path');
  assert.equal(nib.fill, '#8e44ad');
  assert.equal(nib.fillRule, 'nonzero');
  assert.equal(nib.opacity, defaultOpacityFor('copic'));
});

test('text is set from its top and wraps in its box, an image fills its box, and a link is a linked image', () => {
  const [text, boxed, image, link] = marksOf(
    page(
      { id: 't', tool: 'text', color: '#1f2328', width: 1, text: 'Acme Corp', fontSize: 18, points: [{ x: 10, y: 10 }] },
      { id: 'b', tool: 'text', color: '#1f2328', width: 1, text: 'Acme Corp makes anvils', fontSize: 18, textBoxWidth: 80, opacity: 0.6, points: [{ x: 10, y: 40 }] },
      { id: 'i', tool: 'image', color: '#000000', width: 1, image: pngDataUrl(4, 2), imageWidth: 40, imageHeight: 30, points: [{ x: 120, y: 10 }] },
      {
        id: 'k',
        tool: 'image',
        color: '#000000',
        width: 1,
        image: pngDataUrl(2, 2),
        imageWidth: 60,
        imageHeight: 40,
        link: { href: 'art/logo.svg', kind: 'svg' },
        points: [{ x: 120, y: 60 }],
      },
    ),
  );
  assert.equal(text.type, 'text');
  assert.equal((text as { baseline?: string }).baseline, 'top');
  assert.equal((text as { lineHeight?: number }).lineHeight, 1.25);
  assert.equal((text as { maxWidth?: number }).maxWidth, undefined);
  assert.equal((boxed as { maxWidth?: number }).maxWidth, 80, 'a text box wraps at its width');
  assert.equal(boxed.opacity, 0.6);
  assert.deepEqual(
    { ...image, src: undefined },
    { type: 'image', src: undefined, x: 120, y: 10, width: 40, height: 30, fit: 'fill' },
    'an image is stretched to its box, as the canvas and the SVG draw it',
  );
  assert.equal((link as { src: string }).src, 'art/logo.svg');
  assert.equal((link as { link?: boolean }).link, true);
  const png = renderPng(sketchToComposition(page({ id: 'k', tool: 'image', color: '#000', width: 1, image: pngDataUrl(2, 2), imageWidth: 60, imageHeight: 40, link: { href: 'art/logo.svg', kind: 'svg' }, points: [{ x: 10, y: 10 }] })));
  assert.match(png.warnings.join('\n'), /link "art\/logo\.svg" drew as its placeholder/, 'with no resolver a link draws its placeholder and says so');
});

test('an eraser becomes its own layer\'s erase shapes, and clears that layer only', () => {
  const sketch = createSketch('eraser');
  sketch.width = 100;
  sketch.height = 60;
  const base = sketch.layers[0];
  const top = createLayer('Ink');
  sketch.layers.push(top);
  sketch.strokes.push(
    { id: 'paper', tool: 'pen', color: '#ff0000', width: 1, fill: '#ff0000', layer: base.id, ...square(0, 0, 60) },
    { id: 'ink', tool: 'pen', color: '#000000', width: 10, layer: top.id, points: line([[10, 30], [90, 30]]) },
    { id: 'rub', tool: 'eraser', color: '#000000', width: 16, layer: top.id, points: line([[30, 10], [30, 50]]) },
  );
  const lowered = sketchToComposition(sketch);
  const ink = lowered.elements[1] as GroupElement;
  assert.equal(ink.children.length, 1, 'an eraser draws nothing of its own');
  assert.deepEqual(ink.erase?.map((el) => [el.type, el.stroke, el.strokeWidth]), [['path', '#000', 16]]);
  const raster = rasterizeComposition(lowered);
  assert.ok(near(pixel(raster, 30, 30), [255, 0, 0, 255]), 'the ink is cleared down to the layer below, which keeps its red');
  assert.ok(near(pixel(raster, 50, 30), [0, 0, 0, 255]), 'the ink the eraser missed is kept');
  assert.match(compositionToSvg(lowered), /<mask id="erase-1"[^>]*>.*<\/mask>/, 'the SVG writes the erase shapes as a mask');
});

test('a crop moves the page under its window, and a transparent page has no paper', () => {
  const sketch = page({ id: 'p', tool: 'pen', color: '#1f2328', width: 4, points: line([[20, 30], [80, 30]]) });
  const cropped = sketchToComposition(sketch, { crop: { x: 10, y: 20, width: 100, height: 40 }, transparent: true });
  assert.deepEqual([cropped.width, cropped.height, cropped.background], [100, 40, null]);
  assert.deepEqual((cropped.elements[0] as GroupElement).translate, { x: -10, y: -20 });
  const raster = rasterizeComposition(cropped);
  assert.ok(near(pixel(raster, 40, 10), [31, 35, 40, 255]), 'the line at y 30 lands 20 pixels down the crop');
  assert.equal(pixel(raster, 40, 30)[3], 0, 'and nothing is under it but transparency');
});

test('a color the PNG cannot paint is left out, and said once', () => {
  const warnings: string[] = [];
  const sketch = page(
    { id: 'a', tool: 'pen', color: 'currentColor', width: 2, points: line([[0, 0], [10, 0]]) },
    { id: 'b', tool: 'pen', color: 'currentColor', width: 2, points: line([[0, 5], [10, 5]]) },
  );
  const [layer] = sketchToComposition(sketch, { onWarning: (message) => warnings.push(message) }).elements;
  assert.deepEqual(
    (layer as GroupElement).children.map((el) => el.stroke),
    [null, null],
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"currentColor"/);
});

test('a gradient fill is painted along its axis, and the SVG writes it where the PNG paints it', () => {
  const ramp = { type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] };
  const lowered = doc([{ type: 'rect', x: 0, y: 0, width: 100, height: 10, fill: ramp }], 100, 10);
  const raster = rasterizeComposition(lowered);
  const [left] = pixel(raster, 2, 5);
  const [middle] = pixel(raster, 50, 5);
  const [right] = pixel(raster, 97, 5);
  assert.ok(left < 20 && right > 235, `dark to light, left to right (${left}, ${right})`);
  assert.ok(Math.abs(middle - 128) < 8, `half way at the middle (${middle})`);
  const svg = compositionToSvg(lowered);
  assert.match(svg, /<linearGradient id="gradient-1" gradientUnits="userSpaceOnUse" x1="0" y1="5" x2="100" y2="5">/);
  assert.match(svg, /fill="url\(#gradient-1\)"/);

  const glow = { type: 'radial' as const, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] };
  const round = rasterizeComposition(doc([{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: glow }]));
  assert.ok(pixel(round, 50, 50)[0] > 245, 'white at the centre');
  assert.ok(pixel(round, 1, 1)[0] < 15, 'dark at a corner, which the radius reaches');
});

test('a group with erase shapes is cleared where they paint, and the SVG masks it', () => {
  const lowered = doc([
    {
      type: 'group',
      erase: [
        { type: 'circle', cx: 50, cy: 50, r: 20, fill: '#123456', opacity: 0.2, fillOpacity: 0.3 },
        { type: 'text', x: 5, y: 80, text: 'Acme', fontSize: 16, fill: '#000000' },
        { type: 'image', src: pngDataUrl(2, 2), x: 70, y: 70, width: 20, height: 20 },
      ],
      children: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#ff0000' }],
    },
  ]);
  const raster = rasterizeComposition(lowered);
  assert.ok(near(pixel(raster, 50, 50), [255, 255, 255, 255]), 'cleared all the way to the paper, whatever the shape was painted with');
  assert.ok(near(pixel(raster, 5, 5), [255, 0, 0, 255]));
  assert.ok(near(pixel(raster, 80, 80), [255, 0, 0, 255]), 'an image does not erase');
  const svg = compositionToSvg(lowered);
  assert.match(svg, /<mask id="erase-1" maskUnits="userSpaceOnUse"[^>]*><rect[^>]*fill="#fff"\/><circle[^>]*fill="#000"\/><\/mask>/, 'nor does text, in either format, and opacity does not soften a cut');
  assert.match(svg, /<g mask="url\(#erase-1\)">/);
});

test('a translucent group is laid down as one picture, so its children do not show through each other', () => {
  const raster = rasterizeComposition(
    doc([
      {
        type: 'group',
        opacity: 0.5,
        children: [
          { type: 'rect', x: 0, y: 0, width: 60, height: 100, fill: '#ff0000' },
          { type: 'rect', x: 40, y: 0, width: 60, height: 100, fill: '#ff0000' },
        ],
      },
    ]),
  );
  assert.ok(near(pixel(raster, 20, 50), [255, 128, 128, 255]));
  assert.ok(near(pixel(raster, 50, 50), [255, 128, 128, 255]), 'the overlap is no darker than either rect');
});

test('a translucent shape does not show its fill through its outline', () => {
  const raster = rasterizeComposition(
    doc([{ type: 'rect', x: 20, y: 20, width: 60, height: 60, fill: '#0000ff', stroke: '#ff0000', strokeWidth: 10, opacity: 0.5 }]),
  );
  assert.ok(near(pixel(raster, 22, 50), [255, 128, 128, 255]), 'the inner half of the outline is the outline alone');
  assert.ok(near(pixel(raster, 50, 50), [128, 128, 255, 255]));
});

test('an open path fills as if closed, as SVG fills it', () => {
  const raster = rasterizeComposition(doc([{ type: 'path', d: 'M10 10 L90 10 L50 90', fill: '#ff0000' }]));
  assert.ok(near(pixel(raster, 50, 40), [255, 0, 0, 255]));
  assert.ok(near(pixel(raster, 10, 80), [255, 255, 255, 255]));
});

const RSVG = findRsvg();
const ZOOM = 4;

/**
 * How far two renders agree: the pixels that are ink (alpha of a half or
 * more) in either one, the share of those that are ink in both, and how far
 * apart the colors are where both are ink, on 0 to 255.
 */
function agreement(a: { width: number; height: number; data: ArrayLike<number> }, b: { width: number; height: number; data: ArrayLike<number> }) {
  assert.deepEqual([a.width, a.height], [b.width, b.height], 'the same size');
  let union = 0;
  let differ = 0;
  let colorSum = 0;
  let both = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const p = i * 4;
    const inA = a.data[p + 3] >= 128;
    const inB = b.data[p + 3] >= 128;
    if (inA || inB) union++;
    if (inA !== inB) differ++;
    if (inA && inB) {
      both++;
      colorSum += (Math.abs(a.data[p] - b.data[p]) + Math.abs(a.data[p + 1] - b.data[p + 1]) + Math.abs(a.data[p + 2] - b.data[p + 2])) / 3;
    }
  }
  return { union, share: 1 - differ / Math.max(1, union), color: colorSum / Math.max(1, both) };
}

/** A page of every kind of mark rsvg-convert and the rasterizer both draw the same way: text and images are left to the tests above. */
function everyMark(): Sketch {
  const sketch = createSketch('every-mark');
  sketch.width = 400;
  sketch.height = 300;
  const base = sketch.layers[0];
  const figure = createGroupLayer('Figure');
  figure.opacity = 0.8;
  const ink = { ...createLayer('Ink'), parent: figure.id };
  sketch.layers.push(figure, ink);
  const stops = [
    { offset: 0, color: '#ffe08a' },
    { offset: 1, color: '#ff8a65' },
  ];
  sketch.strokes.push(
    { id: 'pen', tool: 'pen', color: '#1f2328', width: 3, layer: base.id, points: line([[10, 10], [60, 40], [110, 20]]) },
    { id: 'linear', tool: 'pen', color: '#1f2328', width: 2, layer: base.id, fill: '#ffe08a', gradient: { type: 'linear', angle: 90, stops }, ...square(140, 20, 60) },
    { id: 'radial', tool: 'pen', color: '#1f2328', width: 2, layer: base.id, fill: '#ffe08a', gradient: { type: 'radial', stops }, ...square(230, 20, 60) },
    { id: 'marker', tool: 'marker', color: '#4cae50', width: 12, layer: ink.id, points: line([[20, 120], [180, 130]]) },
    { id: 'crossing', tool: 'marker', color: '#4cae50', width: 12, layer: ink.id, points: line([[100, 100], [110, 150]]) },
    { id: 'dashed', tool: 'pen', color: '#326478', width: 2, layer: ink.id, strokeStyle: 'dashed', points: line([[20, 160], [180, 160]]) },
    { id: 'dotted', tool: 'pen', color: '#326478', width: 3, layer: ink.id, strokeStyle: 'dotted', points: line([[20, 175], [180, 175]]) },
    { id: 'profiled', tool: 'pen', color: '#1f2328', width: 8, layer: ink.id, profile: 'tapered', points: line([[20, 200], [70, 210], [120, 195], [180, 205]]) },
    { id: 'copic', tool: 'copic', color: '#8e44ad', width: 10, nibAngle: 30, layer: ink.id, points: line([[220, 120], [300, 150]]) },
    { id: 'fill-only', tool: 'pen', color: '#1f2328', width: 2, layer: ink.id, fill: '#c0e0ff', noStroke: true, ...square(220, 170, 40) },
    { id: 'open-fill', tool: 'pen', color: '#aa3322', width: 3, layer: base.id, fill: '#ffccaa', points: line([[300, 200], [380, 200], [340, 260]]) },
    { id: 'translucent', tool: 'pen', color: '#113355', width: 6, opacity: 0.5, layer: base.id, fill: '#aaddcc', ...square(320, 110, 50) },
    { id: 'dot', tool: 'pen', color: '#dd2255', width: 14, layer: base.id, points: line([[40, 270]]) },
    { id: 'eraser', tool: 'eraser', color: '#000000', width: 10, layer: ink.id, points: line([[25, 118], [60, 122]]) },
  );
  return sketch;
}

const IMPORTS = join(repoRoot(), 'test', 'imports');
const FIXTURES = readdirSync(IMPORTS).filter((f) => f.endsWith('.svg') && f !== 'linked-logo.svg');

test(
  'the PNG is the picture the SVG draws: coverage agrees with rsvg-convert to 99% on every fixture',
  { skip: RSVG ? false : 'rsvg-convert is not installed; set RSVG_CONVERT to its path to run this' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'napkin-png-'));
    try {
      const sketches = [
        everyMark(),
        ...FIXTURES.map((file) => fixtureSketch(readFileSync(join(IMPORTS, file), 'utf8'), file)),
      ];
      assert.ok(sketches.length >= 8, 'the fixtures were found');
      for (const sketch of sketches) {
        assert.ok(sketch.strokes.length > 0, `${sketch.name} has marks to compare`);
        const svgPath = join(dir, 'page.svg');
        const pngPath = join(dir, 'page.png');
        writeFileSync(svgPath, sketchToSvg(sketch, { transparent: true }));
        const run = spawnSync(RSVG!, ['-z', String(ZOOM), '-o', pngPath, svgPath], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        const theirs = decodePng(new Uint8Array(readFileSync(pngPath)));
        const warnings: string[] = [];
        const ours = rasterizeComposition(sketchToComposition(sketch, { transparent: true, onWarning: (m) => warnings.push(m) }), { scale: ZOOM });
        assert.deepEqual(warnings, [], sketch.name);
        const { union, share, color } = agreement(ours, theirs);
        assert.ok(union > 0, `${sketch.name} drew something`);
        assert.ok(share >= 0.99, `${sketch.name}: ${(share * 100).toFixed(2)}% of ${union} ink pixels agree`);
        assert.ok(color < 8, `${sketch.name}: colors differ by ${color.toFixed(2)} on average where both drew`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
