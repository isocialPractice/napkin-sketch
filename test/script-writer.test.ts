/**
 * The script writer: a drawing written as napkin script, and the script drawn
 * back.
 *
 * Every fixture in `test/imports/` that `fixtureSketch` reads, and every page
 * of every golden script, is written, formatted, parsed and evaluated again,
 * and the page that comes back must export to the same SVG - byte for byte,
 * with every digit kept. The one difference allowed is the writer's own, and
 * it is checked to be only that: a filled shape the source left open is
 * closed, since a script fills only a closed path, so its path data gains a
 * closing segment and a `Z`. With coordinates rounded to two decimals, the
 * default, the page must draw to the same pixels.
 *
 * Around that: a part of a page written on its own, the paint written only
 * where it changes, opacity scoped with push and pop, the notes on what the
 * language cannot say, the eraser the language gained for the writer, and the
 * formatted text of the triangle fixture, held to a checked-in file so a
 * change in the writer's style is seen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodePng } from '../src/core/graphic-design/png.js';
import {
  bookToInstructions,
  evaluate,
  formatScript,
  inkBox,
  parseScript,
  renderSketch,
  scriptComments,
  sketchToInstructions,
  validateScript,
  type WriteOptions,
  type WrittenScript,
} from '../src/core/script/index.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { createSketch, isClosedStroke, type Layer, type Sketch, type SketchBook, type Stroke } from '../src/core/types.js';
import { fixtureSketch } from './helpers/fixture-sketch.js';
import { repoRoot } from './helpers/repo-root.js';
import { LOGO, SCRIPT_FIXTURES } from './helpers/script-fixtures.js';
import { walkFigure } from './helpers/walk-figure.js';

const ROOT = repoRoot();
const IMPORTS = join(ROOT, 'test', 'imports');
const SCRIPTS = join(ROOT, 'test', 'scripts');
const TIMESTAMP = '2026-09-25T00:00:00.000Z';
const UPDATE = process.env.NAPKIN_UPDATE_GOLDEN === '1';

/** The simple fixtures and the complex ones the plan names. */
const FIXTURES = [
  'mirror-triangle.svg',
  'width-line.svg',
  'warp-bar.svg',
  'walk.svg',
  'gradient-figure.svg',
  'profiled-strokes.svg',
  'color-picker-shapes.svg',
  'linked-logo.svg',
];

/** What every golden script is handed, as `test/script-golden.test.ts` hands it over. */
const GOLDEN_OPTIONS = {
  timestamp: TIMESTAMP,
  assets: SCRIPT_FIXTURES.assets,
  documents: {
    ...SCRIPT_FIXTURES.documents,
    figure: fixtureSketch(readFileSync(join(IMPORTS, 'gradient-figure.svg'), 'utf-8'), 'figure'),
  },
};

function fixture(file: string): Sketch {
  return fixtureSketch(readFileSync(join(IMPORTS, file), 'utf-8'), file.replace(/\.svg$/, ''));
}

/** A written script, formatted, parsed and run: the book it draws. The script must read and run clean. */
function drawBack(written: WrittenScript, name: string): SketchBook {
  const text = formatScript(written.script);
  const parsed = parseScript(text);
  assert.deepEqual(parsed.diagnostics, [], `${name}: the written script parses clean`);
  // Parsed text carries where each instruction was; the object form has no text to point into.
  const placeless = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (key === 'at' ? undefined : v)));
  assert.deepEqual(placeless(parsed.script), placeless(validateScript(JSON.parse(JSON.stringify(written.script))).script), `${name}: text and object form agree`);
  const result = evaluate(text, { timestamp: TIMESTAMP, name });
  assert.deepEqual(result.diagnostics, [], `${name}: the written script runs clean`);
  return result.book;
}

/** The marks a source leaves open but filled, by paint order: the ones the writer closes to keep their fill. */
function openFilled(sketch: Sketch): Set<number> {
  const out = new Set<number>();
  sketch.strokes.forEach((stroke, i) => {
    const filled = stroke.fill !== undefined || (stroke.gradient?.stops.length ?? 0) >= 2;
    if (filled && stroke.tool !== 'eraser' && stroke.vector?.closed !== true && isClosedStroke(stroke)) out.add(i);
  });
  return out;
}

/**
 * The SVG a page exports to, and the one its written script draws, are the
 * same, line for line - but for a mark the source left open and filled,
 * whose path data may only gain a closing segment and a `Z`.
 */
function assertSameDrawing(source: Sketch, back: Sketch, label: string): void {
  const expected = sketchToSvg(source).split('\n');
  const actual = sketchToSvg(back).split('\n');
  assert.equal(actual.length, expected.length, `${label}: as many lines`);
  const closed = openFilled(source);
  expected.forEach((line, i) => {
    if (line === actual[i]) return;
    const order = Number(/data-i="(\d+)"/.exec(line)?.[1] ?? -1);
    assert.ok(closed.has(order), `${label}, line ${i + 1}:\n  ${line.slice(0, 200)}\n  ${actual[i].slice(0, 200)}`);
    const d = (text: string): string => /\sd="([^"]*)"/.exec(text)?.[1] ?? '';
    assert.equal(actual[i].replace(d(actual[i]), ''), line.replace(d(line), ''), `${label}, line ${i + 1}: only the path data differs`);
    const added = d(actual[i]).slice(d(line).length);
    assert.ok(d(actual[i]).startsWith(d(line)) && /^([Ll][^A-Za-z]*)?Z$/.test(added), `${label}, line ${i + 1}: closed, and only closed (${added})`);
  });
}

/** Two PNGs of a page are the same picture, pixel for pixel, within `tolerance` on each channel. */
function assertSamePixels(a: Sketch, b: Sketch, label: string, tolerance = 0): void {
  const one = decodePng(renderSketch(a, { format: 'png' }));
  const two = decodePng(renderSketch(b, { format: 'png' }));
  assert.equal(two.width, one.width, `${label}: width`);
  assert.equal(two.height, one.height, `${label}: height`);
  let worst = 0;
  for (let i = 0; i < one.data.length; i++) worst = Math.max(worst, Math.abs(one.data[i] - two.data[i]));
  assert.ok(worst <= tolerance, `${label}: pixels differ by up to ${worst}`);
}

/** A page with its group rows after their children, where the app and the evaluator keep them. */
function headersAbove(sketch: Sketch): Sketch {
  const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
  const children = new Map<string, Layer[]>();
  const top: Layer[] = [];
  for (const layer of sketch.layers) {
    const parent = layer.parent ? byId.get(layer.parent) : undefined;
    if (parent?.group) children.set(parent.id, [...(children.get(parent.id) ?? []), layer]);
    else top.push(layer);
  }
  const out: Layer[] = [];
  const place = (layer: Layer): void => {
    for (const child of children.get(layer.id) ?? []) place(child);
    out.push(layer);
  };
  top.forEach(place);
  return { ...sketch, layers: out };
}

const lines = (written: WrittenScript): string[] => formatScript(written.script).trimEnd().split('\n');
const verbs = (written: WrittenScript, verb: string): number => lines(written).filter((line) => line.trim().split(' ')[0] === verb).length;

// ---- The fixtures ---------------------------------------------------------------------

for (const file of FIXTURES) {
  test(`${file} is written, and its script draws it back to the same SVG, every digit kept`, () => {
    const source = fixture(file);
    const written = sketchToInstructions(source, { decimals: null });
    const back = drawBack(written, source.name).sketches[0];
    assert.equal(back.strokes.length, source.strokes.length, 'every mark');
    assertSameDrawing(source, back, file);
    assert.deepEqual(inkBox(back), inkBox(source), 'and the same ink box');
    assert.deepEqual(written.notes, [], 'with nothing it could not say');
  });
}

test('at two decimals, the default, every fixture draws back to the same pixels', () => {
  for (const file of FIXTURES) {
    const source = fixture(file);
    const back = drawBack(sketchToInstructions(source), source.name).sketches[0];
    assertSamePixels(source, back, file);
  }
});

// ---- The golden scripts -------------------------------------------------------------------

const GOLDEN = readdirSync(SCRIPTS)
  .filter((file) => file.endsWith('.napkin'))
  .sort();

for (const file of GOLDEN) {
  test(`every page ${file} draws is written back to the same SVG`, () => {
    const name = file.replace(/\.napkin$/, '');
    const book = evaluate(readFileSync(join(SCRIPTS, file), 'utf-8'), { ...GOLDEN_OPTIONS, name }).book;
    const written = bookToInstructions(book, { decimals: null });
    const back = drawBack(written, name);
    assert.equal(back.sketches.length, book.sketches.length, 'every page');
    book.sketches.forEach((page, i) => {
      assert.equal(back.sketches[i].name, page.name, `page ${i + 1}'s name`);
      assertSameDrawing(page, back.sketches[i], `${file} page ${i + 1}`);
    });
    assert.deepEqual(written.notes, []);
  });
}

test('the hand-drawn pass is written as the marks it drew, their own opacity scoped with push and pop', () => {
  const book = evaluate(readFileSync(join(SCRIPTS, 'rough.napkin'), 'utf-8'), { ...GOLDEN_OPTIONS, name: 'rough' }).book;
  const written = bookToInstructions(book, { decimals: null });
  assert.equal(verbs(written, 'rough'), 0, 'no `rough`: the marks are what they are');
  assert.ok(verbs(written, 'push') > 0 && verbs(written, 'push') === verbs(written, 'pop'), 'every push popped');
  const back = drawBack(written, 'rough').sketches[0];
  assert.deepEqual(
    back.strokes.map((stroke) => stroke.opacity),
    book.sketches[0].strokes.map((stroke) => stroke.opacity),
    'each mark with the opacity it had, and none where it had none',
  );
});

// ---- One of every mark ------------------------------------------------------------------------

/** A page of every kind of mark the writer handles, in a nested tree, marks out of layer order. */
function everyKind(): Sketch {
  const sketch = createSketch('every-kind');
  sketch.width = 320;
  sketch.height = 240;
  sketch.background = '#ffffff';
  const base = { ...sketch.layers[0], name: 'Base' };
  const figure: Layer = { id: 'gp_figure', name: 'Figure', opacity: 0.8, visible: true, locked: false, group: true, effects: [{ type: 'drop-shadow', dx: 2, dy: 3, blur: 4, color: '#00000066' }] };
  const ink: Layer = { id: 'ly_ink', name: 'Ink', opacity: 1, visible: true, locked: true, parent: figure.id };
  const logo: Layer = { id: 'ly_logo', name: 'Brand', opacity: 0.5, visible: true, locked: false };
  const hidden: Layer = { id: 'ly_hidden', name: 'Hidden', opacity: 1, visible: false, locked: false };
  sketch.layers = [base, ink, figure, logo, hidden];
  const line = (coords: number[][]): Stroke['points'] => coords.map(([x, y]) => ({ x, y, pressure: 0.5 }));
  const square = (x: number, y: number, s: number) => {
    const anchors = [
      { p: { x, y } },
      { p: { x: x + s, y } },
      { p: { x: x + s, y: y + s } },
      { p: { x, y: y + s } },
    ];
    return { vector: { anchors, closed: true }, points: line([[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]) };
  };
  const strokes: Stroke[] = [
    { id: 'a', tool: 'pen', color: '#1f2328', width: 3, layer: base.id, points: line([[10, 10], [60, 40], [110, 20]]) },
    { id: 'c', tool: 'pen', color: '#1f2328', width: 2, layer: base.id, fill: '#ffe08a', gradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffe08a' }, { offset: 1, color: '#ff8a65' }] }, ...square(140, 20, 60) },
    { id: 'b', tool: 'marker', color: '#4cae50', width: 12, layer: ink.id, points: line([[20, 120], [180, 130]]) },
    { id: 'd', tool: 'pen', color: '#326478', width: 2, layer: ink.id, strokeStyle: 'dashed', opacity: 0.6, points: line([[20, 160], [180, 160]]) },
    { id: 'e', tool: 'pen', color: '#1f2328', width: 8, layer: ink.id, profile: 'tapered', points: line([[20, 190], [70, 200], [120, 185], [180, 195]]) },
    { id: 'f', tool: 'copic', color: '#8e44ad', width: 10, nibAngle: 30, layer: ink.id, points: line([[220, 120], [260, 140], [300, 150]]) },
    { id: 'g', tool: 'pen', color: '#1f2328', width: 2, layer: ink.id, fill: '#c0e0ff', noStroke: true, effects: [{ type: 'blur', radius: 1.5 }], ...square(220, 170, 40) },
    { id: 'h', tool: 'eraser', color: '#000000', width: 10, layer: ink.id, points: line([[25, 118], [40, 126], [60, 122]]) },
    { id: 'i', tool: 'text', color: '#c0392b', width: 1, layer: base.id, text: 'Acme\nCorp', fontSize: 18, fontFamily: 'Georgia', textBoxWidth: 120, opacity: 0.9, points: [{ x: 20, y: 200 }] },
    { id: 'j', tool: 'image', color: '#000000', width: 1, layer: base.id, image: LOGO, imageWidth: 40, imageHeight: 20, points: [{ x: 260, y: 20 }] },
    { id: 'k', tool: 'image', color: '#000000', width: 1, layer: logo.id, image: LOGO, imageWidth: 80, imageHeight: 40, link: { href: 'assets/logo.svg', kind: 'svg' }, points: [{ x: 200, y: 60 }] },
    { id: 'l', tool: 'pen', color: '#1f2328', width: 3, layer: logo.id, points: line([[200, 110], [280, 110]]) },
    { id: 'm', tool: 'pen', color: '#ff0000', width: 3, layer: hidden.id, points: line([[0, 0], [320, 240]]) },
  ];
  sketch.strokes = strokes;
  return sketch;
}

test('a page of every kind of mark, drawn back and forth between layers, is written back to the same SVG', () => {
  const source = everyKind();
  const written = sketchToInstructions(source, { decimals: null });
  const back = drawBack(written, 'every-kind').sketches[0];
  assert.deepEqual(
    back.layers.map((layer) => `${layer.name}${layer.group ? '/' : ''}${layer.parent ? '<' : ''}`),
    ['Base', 'Ink<', 'Figure/', 'Brand', 'Hidden'],
    'the same tree, in the same order',
  );
  assert.deepEqual(
    back.strokes.map((stroke) => stroke.tool),
    source.strokes.map((stroke) => stroke.tool),
    "and the marks in the page's paint order, across the group",
  );
  // The profiled line keeps every point, which the SVG's own copy of its
  // centreline prunes, so that one attribute is compared as geometry below.
  const plain = (svg: string): string => svg.replace(/ data-d="[^"]*"/g, '');
  assert.equal(plain(sketchToSvg(back)), plain(sketchToSvg(source)));
  assertSamePixels(source, back, 'every-kind');
  const profiled = back.strokes.findIndex((stroke) => stroke.profile === 'tapered');
  assert.deepEqual(
    back.strokes[profiled].points.map((p) => [p.x, p.y]),
    source.strokes[profiled].points.map((p) => [p.x, p.y]),
    'the profiled line keeps its every point',
  );
  const lines = formatScript(written.script);
  assert.match(lines, /^ {2}tool eraser$/m, 'the eraser is written as one, in the group');
  assert.match(lines, /^link "assets\/logo\.svg" at 200 60 size 80 40 name "Brand"$/m, 'the linked file makes its layer');
  assert.match(lines, /^layer "Brand" opacity 0\.5$/m, 'which then takes its properties');
  assert.match(lines, /^effect drop-shadow 2 3 4 #00000066\ngroup "Figure" opacity 0\.8 \{$/m, "and a group's effect stands before it");
  assert.deepEqual(written.notes, []);
});

test("a group is one block, so marks drawn into it between two outside it are written together, each layer's order kept", () => {
  const source = everyKind();
  const [a, c, b, ...rest] = source.strokes;
  // The Base marks either side of the group's first mark: a, then the group's b, then c.
  source.strokes = [a, b, c, ...rest];
  const back = drawBack(sketchToInstructions(source, { decimals: null }), 'interleaved').sketches[0];
  const byLayer = (sketch: Sketch, name: string): string[] => {
    const id = sketch.layers.find((layer) => layer.name === name)?.id;
    return sketch.strokes.filter((stroke) => stroke.layer === id).map((stroke) => `${stroke.tool}:${stroke.points[0]?.x}`);
  };
  for (const name of ['Base', 'Ink', 'Brand', 'Hidden']) {
    assert.deepEqual(byLayer(back, name), byLayer(source, name), `${name} keeps its marks in their order`);
  }
  assertSamePixels(source, back, 'interleaved');
});

test('a script in one color says `color` once, and a width it shares, once', () => {
  const sketch = createSketch('one-color');
  const layer = sketch.layers[0].id;
  sketch.strokes = [0, 1, 2, 3].map((k) => ({
    id: `s${k}`,
    tool: 'pen' as const,
    color: '#326478',
    width: 2,
    layer,
    points: [
      { x: 10, y: 10 + k * 20, pressure: 0.5 },
      { x: 200, y: 10 + k * 20, pressure: 0.5 },
    ],
  }));
  const written = sketchToInstructions(sketch);
  assert.equal(verbs(written, 'color'), 1);
  assert.equal(verbs(written, 'width'), 1);
  assert.equal(verbs(written, 'path'), 4);
  assert.equal(verbs(written, 'layer'), 0, "the page's own first layer needs no line");
  assert.deepEqual(written.stats, { instructions: 10, marks: 4, layers: 1, pages: 1 });
});

// ---- A part of the page ----------------------------------------------------------------------

test("a part of the page is written with the groups above it and nothing else: walk.svg's front arm", () => {
  const source = walkFigure();
  const arm = source.layers.find((layer) => layer.name === 'front-arm-assembly');
  assert.ok(arm, 'the fixture has a front-arm-assembly');
  const written = sketchToInstructions(source, { decimals: null, layers: [arm.id] });
  const back = drawBack(written, 'arm').sketches[0];
  // What the part is: the arm, what it holds, and the group above it.
  const within = new Set<string>([arm.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const layer of source.layers) {
      if (layer.parent && within.has(layer.parent) && !within.has(layer.id)) {
        within.add(layer.id);
        grew = true;
      }
    }
  }
  const expected: Sketch = {
    ...source,
    layers: source.layers.filter((layer) => within.has(layer.id) || layer.id === arm.parent),
    strokes: source.strokes.filter((stroke) => within.has(stroke.layer ?? '')),
  };
  assert.deepEqual(
    back.layers.map((layer) => layer.name),
    expected.layers.map((layer) => layer.name),
    'the arm, its parts, and the figure group above it',
  );
  assert.equal(back.strokes.length, expected.strokes.length);
  assert.ok(back.strokes.length > 0 && back.strokes.length < source.strokes.length);
  assertSameDrawing(expected, back, 'front arm');
});

// ---- Opacity, pages, paper, crop ----------------------------------------------------------------

test('an opacity of its own is scoped with push and pop, so the marks after it take the tool\'s own again', () => {
  const sketch = createSketch('opacity');
  const layer = sketch.layers[0].id;
  const mark = (id: string, opacity?: number): Stroke => ({
    id,
    tool: 'marker',
    color: '#4cae50',
    width: 10,
    layer,
    points: [
      { x: 10, y: 10, pressure: 0.5 },
      { x: 100, y: 10, pressure: 0.5 },
    ],
    ...(opacity === undefined ? {} : { opacity }),
  });
  sketch.strokes = [mark('a'), mark('b', 0.5), mark('c', 0.25), mark('d')];
  const written = sketchToInstructions(sketch);
  assert.deepEqual(
    lines(written).filter((line) => /^(push|pop|opacity)/.test(line)),
    ['push', 'opacity 0.5', 'opacity 0.25', 'pop'],
  );
  const back = drawBack(written, 'opacity').sketches[0];
  assert.deepEqual(
    back.strokes.map((stroke) => stroke.opacity),
    [undefined, 0.5, 0.25, undefined],
  );
});

test('a book is written page after page; a page says its size and paper only when they change', () => {
  const book = evaluate('napkin 1\npage napkin\nbackground #ffffff\nname "one"\ncircle 100 100 40\nnewpage "two"\ncircle 200 100 40\nnewpage "three"\npage a4 landscape\nbackground none\nrect 10 10 100 100\n', {
    timestamp: TIMESTAMP,
    name: 'pages',
  }).book;
  const written = bookToInstructions(book);
  const text = formatScript(written.script);
  assert.match(text, /^page napkin$/m, 'a named size is written by its name');
  assert.match(text, /^newpage "two"\npath \{$/m, 'the second page is the same size on the same paper');
  assert.match(text, /^newpage "three"\npage a4 landscape\nbackground none$/m, 'the third says what changed');
  assert.equal(written.stats.pages, 3);
  const back = drawBack(written, 'pages');
  assert.deepEqual(
    back.sketches.map((page) => [page.name, page.width, page.height, page.background]),
    book.sketches.map((page) => [page.name, page.width, page.height, page.background]),
  );
});

test('`fit` writes a page the size of its ink, with the ink moved to the corner', () => {
  for (const file of ['mirror-triangle.svg', 'gradient-figure.svg', 'profiled-strokes.svg']) {
    const sketch = fixture(file);
    const box = inkBox(sketch);
    assert.ok(box, `${file}: has ink`);
    const written = sketchToInstructions(sketch, { page: 'fit', decimals: null });
    assert.doesNotMatch(formatScript(written.script), /^crop /m, `${file}: the page is fitted, not cut when it is exported`);
    const page = drawBack(written, file).sketches[0];
    assert.deepEqual([page.width, page.height], [Math.ceil(box.width), Math.ceil(box.height)], `${file}: the page is the ink's size, rounded up`);
    const moved = inkBox(page);
    assert.ok(moved, `${file}: the ink comes back`);
    for (const [key, want] of [['x', 0], ['y', 0], ['width', box.width], ['height', box.height]] as const) {
      assert.ok(Math.abs(moved[key] - want) < 1e-9, `${file}: ink ${key} is ${moved[key]}, not ${want}`);
    }
  }
});

test('`fit` with chosen layers fits the page to their ink alone', () => {
  const sketch = walkFigure();
  const part = sketch.layers.find((layer) => !layer.group && sketch.strokes.some((stroke) => stroke.layer === layer.id));
  assert.ok(part, 'the figure has a layer with marks');
  const box = inkBox({ ...sketch, strokes: sketch.strokes.filter((stroke) => stroke.layer === part.id) });
  assert.ok(box);
  const page = drawBack(sketchToInstructions(sketch, { layers: [part.id], page: 'fit', decimals: null }), 'part').sketches[0];
  assert.deepEqual([page.width, page.height], [Math.ceil(box.width), Math.ceil(box.height)]);
  const moved = inkBox(page);
  assert.ok(moved && Math.abs(moved.x) < 1e-9 && Math.abs(moved.y) < 1e-9, 'the part starts at the corner');
});

// ---- What the language cannot say ------------------------------------------------------------------

test('what the language cannot say is written as near as it goes, and said', () => {
  const sketch = createSketch('notes');
  const first = sketch.layers[0];
  const again: Layer = { id: 'ly_again', name: 'Layer 1', opacity: 1, visible: true, locked: false };
  const ink: Layer = { id: 'ly_ink', name: 'Ink', opacity: 1, visible: true, locked: false };
  const ink2: Layer = { id: 'ly_ink2', name: 'Ink', opacity: 1, visible: true, locked: false };
  sketch.layers = [{ ...first, name: 'Base' }, again, ink, ink2];
  const pts = (y: number, pressures = [0.5, 0.5, 0.5]) => [
    { x: 10, y, pressure: pressures[0] },
    { x: 60, y: y + 5, pressure: pressures[1] },
    { x: 110, y, pressure: pressures[2] },
  ];
  sketch.strokes = [
    { id: 'pressure', tool: 'pen', color: '#1f2328', width: 4, layer: first.id, points: pts(10, [0.8, 0.4, 0.8]) },
    { id: 'wave', tool: 'pen', color: '#1f2328', width: 6, layer: ink.id, profile: 'wave', profileMirrored: true, points: pts(40) },
    { id: 'link', tool: 'pen', color: '#1f2328', width: 2, layer: ink2.id, points: pts(70) },
    { id: 'linked', tool: 'image', color: '#000000', width: 1, layer: ink2.id, image: LOGO, imageWidth: 10, imageHeight: 10, link: { href: 'a.png', kind: 'png' }, points: [{ x: 5, y: 5 }] },
    { id: 'no-data', tool: 'image', color: '#000000', width: 1, layer: ink2.id, image: 'logo.png', points: [{ x: 5, y: 5 }] },
    { id: 'empty', tool: 'text', color: '#000000', width: 1, layer: ink2.id, text: '  ', points: [{ x: 5, y: 5 }] },
    { id: 'nan', tool: 'pen', color: '#000000', width: 1, layer: again.id, points: [{ x: Number.NaN, y: 1 }, { x: 2, y: 2 }] },
    { id: 'color', tool: 'pen', color: 'not-a-color', width: 1, layer: again.id, points: pts(100) },
    { id: 'gap', tool: 'pen', color: '#1f2328', width: 2, fill: '#ffe08a', layer: again.id, points: [{ x: 10, y: 150 }, { x: 110, y: 150 }, { x: 110, y: 200 }, { x: 10, y: 200 }, { x: 10, y: 160 }] },
  ];
  const written = sketchToInstructions(sketch);
  assert.deepEqual(written.notes, [
    'The layer "Layer 1" is written as "Layer 1-2", since a script draws on a layer by naming it and another layer in its group already has that name.',
    'The layer "Ink" is written as "Ink-2", since a script draws on a layer by naming it and another layer in its group already has that name.',
    '1 freehand line drawn with pen pressure is written with even pressure: the language has no pressure, so the width no longer swells and thins.',
    '1 mark with a mirrored Wave profile is written unmirrored: the language cannot mirror a profile.',
    '1 filled shape is closed with a straight line across a gap in its outline, since a script fills only a closed path.',
    '1 linked file shared a layer with other marks and is written on a layer of its own, as a link always is.',
    '1 image holds no image data and is left out.',
    '1 empty text item is left out.',
    '1 mark with a position that is not a number is left out.',
    '1 color is not one a script can name and is written as black.',
  ]);
  const back = drawBack(written, 'notes').sketches[0];
  assert.deepEqual(
    back.layers.map((layer) => layer.name),
    ['Base', 'Layer 1-2', 'Ink', 'Ink-2', 'a.png'],
    'every layer kept, the linked file on one of its own',
  );
  assert.equal(back.strokes.length, sketch.strokes.length - 3, 'all but the three left out');
});

test('the notes go at the top of the text as comments, which the parser skips', () => {
  const written: WrittenScript = { script: [{ verb: 'napkin', version: 1 }], notes: ['One thing.', 'Another\nthing.'], stats: { instructions: 1, marks: 0, layers: 0, pages: 1 } };
  const text = scriptComments(written, ['Written from "logo.svg".']) + formatScript(written.script);
  assert.equal(text, '# Written from "logo.svg".\n# One thing.\n# Another thing.\nnapkin 1\n');
  assert.deepEqual(parseScript(text).diagnostics, []);
  assert.equal(scriptComments({ ...written, notes: [] }), '');
});

// ---- The eraser the writer needed -----------------------------------------------------------------

test('`tool eraser` draws an eraser mark: its line and nothing else, with effects left for the next mark', () => {
  const result = evaluate('napkin 1\npage 200 200\nfill #ffe08a\nstyle dashed\nstroke off\neffect blur 2\ntool eraser\nwidth 8\nrect 10 10 50 50\ntool pen\ncircle 150 150 20\n', {
    timestamp: TIMESTAMP,
  });
  assert.deepEqual(result.diagnostics, []);
  const [eraser, pen] = result.book.sketches[0].strokes;
  assert.equal(eraser.tool, 'eraser');
  assert.equal(eraser.width, 8);
  for (const field of ['fill', 'gradient', 'noStroke', 'strokeStyle', 'effects'] as const) {
    assert.equal(eraser[field], undefined, `an eraser takes no ${field}`);
  }
  assert.deepEqual(pen.effects, [{ type: 'blur', radius: 2 }], 'the effect waited for the next mark that shows');
});

// ---- The writer's style, held to a file ------------------------------------------------------------

test('the triangle fixture is written as test/scripts/written/mirror-triangle.napkin says', () => {
  const text = formatScript(sketchToInstructions(fixture('mirror-triangle.svg')).script);
  const file = join(SCRIPTS, 'written', 'mirror-triangle.napkin');
  if (UPDATE) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, 'utf-8'));
});

test('the options are held to what they say', () => {
  const options: WriteOptions = { decimals: 0 };
  const sketch = createSketch('round');
  sketch.strokes = [
    {
      id: 's',
      tool: 'pen',
      color: '#1f2328',
      width: 2.345,
      layer: sketch.layers[0].id,
      points: [
        { x: 10.4, y: 10.6, pressure: 0.5 },
        { x: -0.4, y: 99.5, pressure: 0.5 },
      ],
    },
  ];
  const text = formatScript(sketchToInstructions(sketch, options).script);
  assert.match(text, /^ {2}move 10 11\n {2}to 0 100$/m, 'coordinates rounded, and never -0');
  assert.match(text, /^width 2\.345$/m, 'a width written whole');
});
