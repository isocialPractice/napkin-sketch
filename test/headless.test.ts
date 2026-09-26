/**
 * The headless contract: every entry point documented as DOM-free runs here
 * with the DOM poisoned.
 *
 * `Surface.toSVG`, the PDF writer, the Illustrator script writer, the `.skbk`
 * serializer, the sharpen engine, the path-data parser, both composition
 * renderers, the render entry point that writes a sketch to every format, and
 * the public barrel itself promise to run without a browser, and the script
 * language and the CLI's drawing commands are built on that promise. A single
 * `document.` added inside any of them would pass every other suite, because
 * Node simply has no document. Here the DOM exists and throws on first touch,
 * so the same change fails and names the global it reached for.
 */
import './helpers/poison-dom.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createGroupLayer,
  createLayer,
  createSketch,
  createSketchBook,
  type Sketch,
  type Stroke,
  type VectorAnchor,
} from '../src/core/types.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { KAPPA, parsePathD } from '../src/core/path-data.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';
import { sharpenStrokes } from '../src/sharpen/sharpen.js';
import { Surface } from '../src/renderer/surface.js';
import { compositionToSvg, createComposition, renderPng } from '../src/core/graphic-design/index.js';
import { decodePng, encodePng, isPng } from '../src/core/graphic-design/png.js';
import { evaluate, formatScript, parseScript, renderBook, renderSketch, validateScript } from '../src/core/script/index.js';
import { repoRoot } from './helpers/repo-root.js';
import { BADGE, pngDataUrl as fixturePng } from './helpers/script-fixtures.js';
import * as napkin from '../src/api/index.js';

/** A 2 by 2 PNG as a data URL, made without a canvas. */
function pngDataUrl(): string {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  return `data:image/png;base64,${Buffer.from(encodePng(rgba, 2, 2)).toString('base64')}`;
}

/** A closed square as Vector Path anchors, with its points sampled from them. */
function vectorSquare(x: number, y: number, size: number): Pick<Stroke, 'points' | 'vector'> {
  const anchors: VectorAnchor[] = [
    { p: { x, y } },
    { p: { x: x + size, y } },
    { p: { x: x + size, y: y + size } },
    { p: { x, y: y + size } },
  ];
  return { vector: { anchors, closed: true }, points: sampleVectorPathPoints(anchors, true) };
}

/** Sampled points for a polyline through the given coordinates. */
function line(coords: number[][]): Stroke['points'] {
  return coords.map(([x, y]) => ({ x, y, pressure: 0.5 }));
}

/** A page holding one of every kind of mark, in a nested layer tree. */
function everyMark(): Sketch {
  const sketch = createSketch('every-mark');
  sketch.width = 400;
  sketch.height = 300;
  const base = sketch.layers[0];
  base.name = 'Base';
  const figure = createGroupLayer('Figure');
  figure.opacity = 0.8;
  const ink = { ...createLayer('Ink'), parent: figure.id };
  const hidden = { ...createLayer('Hidden'), visible: false };
  sketch.layers.push(figure, ink, hidden);

  const gradient = {
    type: 'linear' as const,
    angle: 90,
    stops: [
      { offset: 0, color: '#ffe08a' },
      { offset: 1, color: '#ff8a65' },
    ],
  };
  const strokes: Stroke[] = [
    { id: 'pen', tool: 'pen', color: '#1f2328', width: 3, layer: base.id, points: line([[10, 10], [60, 40], [110, 20]]) },
    { id: 'square', tool: 'pen', color: '#1f2328', width: 2, layer: base.id, fill: '#ffe08a', gradient, ...vectorSquare(140, 20, 60) },
    { id: 'marker', tool: 'marker', color: '#4cae50', width: 12, layer: ink.id, points: line([[20, 120], [180, 130]]) },
    { id: 'dashed', tool: 'pen', color: '#326478', width: 2, layer: ink.id, strokeStyle: 'dashed', points: line([[20, 160], [180, 160]]) },
    {
      id: 'profiled',
      tool: 'pen',
      color: '#1f2328',
      width: 8,
      layer: ink.id,
      profile: 'rounded',
      points: line([[20, 190], [70, 200], [120, 185], [180, 195]]),
    },
    { id: 'copic', tool: 'copic', color: '#8e44ad', width: 10, nibAngle: 30, layer: ink.id, points: line([[220, 120], [300, 150]]) },
    { id: 'fill-only', tool: 'pen', color: '#1f2328', width: 2, layer: ink.id, fill: '#c0e0ff', noStroke: true, ...vectorSquare(220, 170, 40) },
    { id: 'eraser', tool: 'eraser', color: '#000000', width: 10, layer: ink.id, points: line([[25, 118], [60, 122]]) },
    { id: 'text', tool: 'text', color: '#1f2328', width: 1, layer: base.id, text: 'Acme Corp', fontSize: 24, points: [{ x: 20, y: 240 }] },
    {
      id: 'image',
      tool: 'image',
      color: '#000000',
      width: 1,
      layer: base.id,
      image: pngDataUrl(),
      imageWidth: 40,
      imageHeight: 40,
      points: [{ x: 320, y: 20 }],
    },
    { id: 'secret', tool: 'pen', color: '#ff0000', width: 3, layer: hidden.id, points: line([[0, 0], [400, 300]]) },
  ];
  sketch.strokes.push(...strokes);
  return sketch;
}

test('the DOM is poisoned before anything under test runs', () => {
  assert.throws(() => document.createElement('canvas'), /touched the DOM: document\.createElement/);
  assert.throws(() => new Image(), /touched the DOM: new Image\(\)/);
  assert.throws(() => new DOMParser(), /touched the DOM: new DOMParser\(\)/);
  assert.throws(() => window.devicePixelRatio, /touched the DOM: window\.devicePixelRatio/);
  // A `typeof` guard sees a defined global, so a guarded DOM branch is taken
  // and fails here rather than being skipped.
  assert.notEqual(typeof document, 'undefined');
});

test('a sketch with every kind of mark exports to SVG without a DOM', () => {
  const svg = Surface.toSVG(everyMark());
  assert.match(svg, /<svg[\s>]/);
  for (const name of ['Base', 'Figure', 'Ink']) assert.match(svg, new RegExp(`data-name="${name}"`));
  assert.doesNotMatch(svg, /data-name="Hidden"/, 'a hidden layer is not exported');
  assert.doesNotMatch(svg, /#ff0000/, 'nor is anything on it');
  assert.match(svg, /<linearGradient/);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /<mask/, 'the eraser is written as a mask');
  assert.match(svg, /<text[^>]*>[\s\S]*Acme Corp/);
  assert.match(svg, /<image[^>]*data:image\/png;base64,/);
});

test('a cropped, transparent SVG export needs no DOM either', () => {
  const sketch = everyMark();
  const svg = Surface.toSVG(sketch, { crop: { minX: 10, minY: 20, maxX: 110, maxY: 90 }, transparent: true });
  assert.match(svg, /viewBox="10 20 100 70"/);
  assert.doesNotMatch(svg, new RegExp(`fill="${sketch.background}"`), 'no paper behind a transparent export');
});

test('a sketch book writes to PDF without a DOM', () => {
  const second = everyMark();
  second.name = 'second';
  const pdf = sketchesToPdf([everyMark(), second]);
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.endsWith('%%EOF\n'));
  assert.equal(pdf.match(/\/Type \/Page /g)?.length, 2, 'one PDF page per sketch');
});

test('a sketch book round-trips through .skbk text without a DOM', () => {
  const sketch = everyMark();
  const book = createSketchBook('headless');
  book.sketches = [sketch];
  const restored = parseSketchBook(serializeSketchBook(book)).sketches[0];
  assert.equal(restored.strokes.length, sketch.strokes.length);
  const tree = (s: Sketch) =>
    s.layers.map((l) => [l.name, l.group === true, s.layers.find((p) => p.id === l.parent)?.name ?? null]);
  assert.deepEqual(tree(restored), tree(sketch));
  assert.deepEqual(
    restored.strokes.find((s) => s.id === 'square')?.vector,
    sketch.strokes.find((s) => s.id === 'square')?.vector,
    'Vector Path anchors survive the file',
  );
});

test('the sharpen engine runs without a DOM', () => {
  const strokes = everyMark().strokes;
  assert.equal(sharpenStrokes(strokes).length, strokes.length);
});

test('path data parses to anchors without a DOM', () => {
  const [quarter] = parsePathD('M10,0 A10,10 0 0 1 0,10') ?? [];
  assert.equal(quarter.anchors.length, 2);
  // A quarter circle's handles sit KAPPA of the radius along the tangents.
  assert.ok(Math.abs((quarter.anchors[0].hOut?.y ?? 0) - 10 * KAPPA) < 1e-9);
  assert.equal(parsePathD('not path data'), null);
});

test('a composition renders to SVG and PNG without a DOM', () => {
  const design = createComposition({ width: 120, height: 80, background: '#ffffff', title: 'headless' });
  design.defineClip('badge', { type: 'circle', cx: 40, cy: 40, r: 30 });
  design.rect({ x: 4, y: 4, width: 112, height: 72, rx: 8, fill: '#326478' });
  design.circle({ cx: 40, cy: 40, r: 20, fill: '#4cae50' });
  design.path({ d: 'M70 20 C90 20 100 40 90 60 Z', fill: '#ffe08a', stroke: '#1f2328', strokeWidth: 2 });
  design.text({ x: 60, y: 70, text: 'Acme', fontSize: 12, align: 'center', fill: '#ffffff' });
  design.image({ src: pngDataUrl(), x: 10, y: 10, width: 60, height: 60, clip: 'badge' });
  design.group({ opacity: 0.5, translate: { x: 5, y: 5 } }, (g) => {
    g.line({ x1: 0, y1: 0, x2: 20, y2: 20, stroke: '#000000', strokeWidth: 1 });
  });

  const doc = design.toDocument();
  assert.match(compositionToSvg(doc), /<clipPath/);
  const png = renderPng(doc);
  assert.ok(isPng(png.data));
  assert.deepEqual(png.warnings, []);
  const decoded = decodePng(png.data);
  assert.deepEqual([decoded.width, decoded.height], [120, 80]);
});

test('the script language reads, checks and writes without a DOM', () => {
  const text = 'napkin 1\npage 400 300\ncolor steelblue width 3\nrepeat 3 as i { rect (i * 40) 10 30 30 r 4 }\ntext "Acme Corp" at 50% 90% align center\n';
  const parsed = parseScript(text);
  assert.deepEqual(parsed.diagnostics, []);
  const validated = validateScript(JSON.parse(JSON.stringify(parsed.script)));
  assert.deepEqual(validated.diagnostics, []);
  assert.equal(
    formatScript(validated.script),
    'napkin 1\npage 400 300\ncolor steelblue\nwidth 3\nrepeat 3 as i {\n  rect (i * 40) 10 30 30 r 4\n}\ntext "Acme Corp" at 50% 90% align center\n',
  );
});

test('a script runs end to end to an SVG without a DOM', () => {
  const result = evaluate(
    'napkin 1\npage 400 300\nlayer "Ink"\ncolor steelblue width 3 fill #ffe08a\nrect 20 20 120 80 r 12\nrepeat 3 as i {\n  circle (220 + i * 50) 60 20\n}\narc 200 200 60 0 270\n' +
      'shape "star" at 300 150 size 60\nthrough 20 280, 80 240, 140 280\npolygon 160 250, 220 250, 190 290 r 6\n' +
      'text "Acme Corp" at 200 20 size 18 align center\ntext "hand" at 250 250 as marks\nimage "logo" at 330 250 size 40\nuse "badge" at 300 200 scale 0.2\n',
    { timestamp: '2026-09-25T00:00:00.000Z', assets: { logo: fixturePng(4, 2) }, documents: { badge: BADGE } },
  );
  assert.deepEqual(result.diagnostics, []);
  const svg = Surface.toSVG(result.book.sketches[0]);
  assert.match(svg, /data-name="Ink"/);
  assert.equal(svg.match(/<path /g)?.length, 11, 'eleven marks drawn as paths: the shape library, lettering and a copied document need no DOM either');
  assert.equal(svg.match(/<text /g)?.length, 2, 'a text item, and the one the copied badge carries');
  assert.equal(svg.match(/<image /g)?.length, 1);
});

/** The plan's goal: a script in, a drawing out, with no pointer and no window. */
const GOAL = `napkin 1
page 400 300
background #fcfaf5
layer "Card"
color #1f2328  width 3  fill #ffe08a
rect 20 20 360 80 r 12
text "Acme Corp" at 200 70 size 28 align center
link "assets/logo.svg" at 20 120 size 120 120 name "Logo"
rough 0.5
circle 300 200 48
`;

test('the public barrel loads, and draws the goal script straight to SVG, without a DOM', () => {
  const { ok, svg, diagnostics } = napkin.drawSvg(GOAL, { seed: 7 });
  assert.deepEqual(diagnostics, []);
  assert.equal(ok, true);
  for (const name of ['Card', 'Logo']) assert.match(svg, new RegExp(`data-name="${name}"`));
  assert.match(svg, /<text[^>]*>[\s\S]*Acme Corp/);
  assert.match(svg, /<image[^>]*href="assets\/logo\.svg" data-link="true"/, 'the logo is a link, not an import');
  assert.equal(napkin.drawSvg(GOAL, { seed: 7 }).svg, svg, 'and the same seed draws the same hand');
});

test('a sketch renders to every format without a DOM', () => {
  const warnings: string[] = [];
  const onWarning = (message: string): void => {
    warnings.push(message);
  };
  const sketch = everyMark();
  assert.match(renderSketch(sketch, { format: 'svg', crop: 'auto', onWarning }), /<svg[\s>]/);
  const png = renderSketch(sketch, { format: 'png', crop: { x: 0, y: 0, width: 200, height: 150 }, onWarning });
  assert.ok(isPng(png));
  const decoded = decodePng(png);
  assert.deepEqual([decoded.width, decoded.height], [200, 150]);
  assert.ok(renderSketch(sketch, { format: 'pdf', onWarning }).startsWith('%PDF-1.4'));
  assert.equal(JSON.parse(renderSketch(sketch, { format: 'skbk' })).sketches[0].strokes.length, sketch.strokes.length);
  assert.match(renderSketch(sketch, { format: 'jsx' }), /^\/\/@target illustrator\n/);
  const book = createSketchBook('headless');
  book.sketches = [everyMark(), everyMark()];
  const frames = renderBook(book, { format: 'png', registration: { x: 0, y: 0, width: 100, height: 80 }, onWarning });
  assert.equal(frames.length, 2, 'one PNG a page');
  // The PNG draws the placed PNG itself; the PDF embeds JPEG only and has no gradients, and says so.
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.match(warnings.join('\n'), /not a JPEG/);
  assert.match(warnings.join('\n'), /gradient fill prints as the shape's flat fill/);
});

test('a sketch lowers into a composition that code adds to and renders, without a DOM', () => {
  const doc = napkin.sketchToComposition(everyMark());
  assert.ok(doc.elements.length > 0, 'the marks arrive as elements');
  doc.elements.push({ type: 'rect', x: 0, y: 250, width: 400, height: 50, fill: '#326478' });
  assert.match(compositionToSvg(doc), /<rect[^>]*fill="#326478"/, 'what code added is written');
  const { data, width, height } = renderPng(doc);
  assert.ok(isPng(data));
  const decoded = decodePng(data);
  assert.deepEqual([decoded.width, decoded.height], [width, height]);
  const at = (x: number, y: number): number[] => [...decoded.data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
  assert.deepEqual(at(200, 290), [0x32, 0x64, 0x78], 'and drawn');
});

test('the DOM-free core imports nothing from the renderer, the main process or Node', () => {
  const root = repoRoot();
  const scriptDir = join(root, 'src', 'core', 'script');
  const designDir = join(root, 'src', 'core', 'graphic-design');
  const listed = (dir: string, skip: string[] = []): string[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.ts') && !skip.includes(f))
          .map((f) => join(dir, f))
      : [];
  const files = [
    // The writers every output format goes through, and what they read.
    ...['path-data', 'svg-path', 'bounds', 'link', 'sketch-svg', 'sketch-composition', 'pdf', 'illustrator'].map((name) =>
      join(root, 'src', 'core', `${name}.ts`),
    ),
    ...listed(scriptDir),
    // `files.ts` is the composition's Node-only half, kept apart for exactly this reason.
    ...listed(designDir, ['files.ts']),
  ];
  for (const file of files) {
    const specifiers = [...readFileSync(file, 'utf-8').matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      assert.doesNotMatch(
        specifier,
        /^node:|^electron$|\/renderer\/|\/main\//,
        `${file.slice(root.length + 1)} imports ${specifier}`,
      );
    }
  }
});
