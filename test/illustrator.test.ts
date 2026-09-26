/**
 * The Illustrator script: `sketchesToJsx`, the `jsx` format, and `--to jsx`.
 *
 * With no Illustrator here, each script the writer makes is run against a
 * stand-in for Illustrator's scripting objects (`helpers/illustrator.ts`)
 * that holds it to the rules the real one would - an item added goes on top,
 * nothing is drawn on a hidden or locked layer, a missing font or file
 * throws, an SVG will not place - and the document it builds is read back:
 * the layer tree, the anchors and handles, the paint, the text, the images
 * and the links. The script is also held to ES3, which is what ExtendScript
 * runs, and to ASCII.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommand } from '../src/cli/draw.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { drawFile, writeBook } from '../src/core/script-files.js';
import { evaluate, RENDER_FORMATS, renderBook, renderBox, renderSketch, type EvaluateOptions } from '../src/core/script/index.js';
import { createLayer, createSketch, type Sketch, type SketchBook, type Stroke } from '../src/core/types.js';
import {
  CompoundPathItem,
  GradientColor,
  GroupItem,
  PathItem,
  PlacedItem,
  RasterItem,
  TextFrame,
  itemsOf,
  layersOf,
  rgbOf,
  runJsx,
  treeOf,
  type Art,
  type Pt,
} from './helpers/illustrator.js';
import { repoRoot } from './helpers/repo-root.js';
import { LOGO } from './helpers/script-fixtures.js';

const STAMP = '2026-09-25T00:00:00.000Z';

/** A script drawn to a book. */
function bookOf(source: string, options: EvaluateOptions = {}): SketchBook {
  const result = evaluate(source, { timestamp: STAMP, ...options });
  assert.deepEqual(result.diagnostics.filter((d) => d.level === 'error'), []);
  return result.book;
}

/** A script as the Illustrator script it is written as. */
function jsxOf(source: string, options: EvaluateOptions = {}): string {
  return renderBook(bookOf(source, options), { format: 'jsx' });
}

/** A point rounded to hundredths, so sums of page and artboard coordinates compare exactly. */
function r2(p: Pt | null): Pt | null {
  return p && [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}

/** A page with one layer and the given marks on it. */
function pageOf(strokes: Array<Partial<Stroke> & Pick<Stroke, 'points'>>, background = '#ffffff'): Sketch {
  const sketch = createSketch('marks');
  sketch.width = 200;
  sketch.height = 200;
  sketch.background = background;
  const layer = createLayer('Marks');
  sketch.layers = [layer];
  sketch.strokes = strokes.map((s, i) => ({ id: `s${i}`, tool: 'pen', color: '#1f2328', width: 2, layer: layer.id, ...s }));
  return sketch;
}

const SIGN = `napkin 1
page 320 200
name "sign"
group "Front" {
  layer "Board"
  color #1f2328 width 3 fill #ffe08a
  rect 20 20 280 120 r 12
  layer "Sun & Moon"
  fill #ff8a65
  circle 80 80 30
}
group "Back" {
  layer "Board"
  fill #326478
  rect 20 150 280 40 r 8
}
`;

test('each layer is a layer and the layers in a group are named groups, bottom first, on an artboard the page', () => {
  const run = runJsx(jsxOf(SIGN));
  assert.equal(run.documents.length, 1);
  const [doc] = run.documents;
  assert.deepEqual([doc.width, doc.height, doc.colorSpace, doc.artboards[0].name], [320, 200, 'RGB', 'sign']);
  assert.deepEqual(treeOf(doc), [
    { Layer: 'Background', items: ['PathItem'] },
    { Layer: 'Front', items: [{ GroupItem: 'Board', items: ['PathItem'] }, { GroupItem: 'Sun & Moon', items: ['PathItem'] }] },
    { Layer: 'Back', items: [{ GroupItem: 'Board', items: ['PathItem'] }] },
  ]);
  // The paper is the artboard, in the page's color, on a locked layer of its own.
  const [background] = layersOf(doc);
  const paper = background.items[0] as PathItem;
  assert.equal(background.locked, true);
  assert.deepEqual(paper.shape, { kind: 'rectangle', top: 700, left: 100, width: 320, height: 200 });
  assert.deepEqual([rgbOf(paper.fillColor), paper.filled, paper.stroked], [[252, 250, 245], true, false]);
  // Quiet when all went as asked, and Illustrator's settings put back.
  assert.equal(run.result, 'napkin-sketch rebuilt 1 page in Illustrator.');
  assert.deepEqual(run.alerts, []);
  assert.deepEqual(run.log, ['napkin-sketch rebuilt 1 page in Illustrator.']);
  assert.deepEqual(run.app, { coordinateSystem: 'ARTBOARDCOORDINATESYSTEM', userInteractionLevel: 'DISPLAYALERTS' });
});

test("a curve's anchors and handles map one to one, y turned up from the artboard's top, smooth where the handles are in line", () => {
  const [doc] = runJsx(jsxOf(SIGN)).documents;
  const [board, sun] = itemsOf(layersOf(doc)[1]) as GroupItem[];
  const rect = board.items[0] as PathItem;
  assert.deepEqual([rect.points.length, rect.closed], [8, true]);
  // (32, 20) on the page, with its incoming handle at (25.37, 20); the artboard's left is 100 and its top 700.
  assert.deepEqual(
    [r2(rect.points[0].anchor), r2(rect.points[0].leftDirection), r2(rect.points[0].rightDirection), rect.points[0].pointType],
    [[132, 680], [125.37, 680], [132, 680], 'CORNER'],
  );
  const circle = sun.items[0] as PathItem;
  assert.deepEqual(circle.points.map((p) => p.pointType), ['SMOOTH', 'SMOOTH', 'SMOOTH', 'SMOOTH']);
  // (110, 80), its handles at (110, 63.43) in and (110, 96.57) out.
  assert.deepEqual(
    [r2(circle.points[0].anchor), r2(circle.points[0].leftDirection), r2(circle.points[0].rightDirection)],
    [[210, 620], [210, 636.57], [210, 603.43]],
  );
  // Paint: the outline and the fill, round at the ends and the joins.
  assert.deepEqual(
    [rgbOf(rect.strokeColor), rect.strokeWidth, rect.strokeCap, rect.strokeJoin, rgbOf(rect.fillColor), rect.opacity],
    [[31, 35, 40], 3, 'ROUNDENDCAP', 'ROUNDENDJOIN', [255, 224, 138], 100],
  );
});

test('several contours are one compound path, a freehand line is its pruned samples, and one point is a dot', () => {
  const holed = bookOf('napkin 1\npage 200 200\nfill #336699\npath "M20 20 H180 V180 H20 Z M60 60 V140 H140 V60 Z"\n').sketches[0];
  const line = Array.from({ length: 101 }, (_, i) => ({ x: 20 + i, y: 100 }));
  const sketch = pageOf([
    ...holed.strokes.map((s) => ({ ...s, layer: undefined })),
    { points: [...line, { x: 120, y: 150 }] },
    { points: [{ x: 50, y: 50 }], width: 10, color: '#ff0000' },
  ]);
  const [doc] = runJsx(renderSketch(sketch, { format: 'jsx' })).documents;
  const [compound, freehand, dot] = itemsOf(layersOf(doc)[1]) as [CompoundPathItem, PathItem, PathItem];
  assert.ok(compound instanceof CompoundPathItem);
  const contours = [...compound.paths].reverse();
  assert.deepEqual(contours.map((p) => [p.points.length, p.closed, p.evenodd, rgbOf(p.fillColor), p.stroked]), [
    [4, true, false, [51, 102, 153], true],
    [4, true, false, [51, 102, 153], true],
  ]);
  assert.deepEqual(r2(contours[1].points[0].anchor), [160, 640]);
  // A hundred samples on one straight line are its two ends; the turn after them is kept.
  assert.deepEqual(freehand.points.map((p) => r2(p.anchor)), [[120, 600], [220, 600], [220, 550]]);
  assert.equal(freehand.closed, false);
  assert.deepEqual([dot.shape, rgbOf(dot.fillColor), dot.stroked], [{ kind: 'ellipse', top: 655, left: 145, width: 10, height: 10 }, [255, 0, 0], false]);
});

test("paint: dashes, a marker's and a color's alpha as opacity, two alphas as a group of two, no outline, and gradients", () => {
  const source = `napkin 1
page 300 200
tool marker
color #e91e63 width 8
line 20 20 280 20
tool pen
color #1f2328 width 2 style dashed
line 20 40 280 40
style dotted
line 20 60 280 60
style solid
color rgba(0, 0, 255, 0.5) fill rgba(255, 0, 0, 0.25)
rect 20 80 60 60
color #000000 fill #ffff00 stroke off
rect 100 80 60 60
stroke on color #000000
gradient linear 90 (#ff0000 0, #0000ff 1)
rect 200 80 80 60
gradient radial (#ffffff 0, rgba(0, 0, 0, 0.5) 1)
circle 60 170 20
`;
  const [doc] = runJsx(jsxOf(source)).documents;
  const [marker, dashed, dotted, split, fillOnly, linear, radial] = itemsOf(layersOf(doc)[1]) as PathItem[];
  assert.deepEqual([rgbOf(marker.strokeColor), marker.strokeWidth, marker.opacity, marker.filled], [[233, 30, 99], 8, 38, false]);
  assert.deepEqual([dashed.strokeDashes, dotted.strokeDashes], [[6, 4], [0, 4]]);
  // A fill and an outline of different alphas: one group, its paths one paint each.
  assert.ok(split instanceof GroupItem);
  const [fillPath, outlinePath] = itemsOf(split as unknown as GroupItem) as PathItem[];
  assert.deepEqual([rgbOf(fillPath.fillColor), fillPath.stroked, fillPath.opacity], [[255, 0, 0], false, 25]);
  assert.deepEqual([rgbOf(outlinePath.strokeColor), outlinePath.filled, outlinePath.opacity], [[0, 0, 255], false, 50]);
  assert.deepEqual([fillOnly.stroked, rgbOf(fillOnly.fillColor)], [false, [255, 255, 0]]);
  // A linear gradient at 90 degrees runs down the page: it starts at the box's top, and is its height long.
  const down = linear.fillColor as GradientColor;
  assert.ok(down instanceof GradientColor);
  assert.deepEqual([down.gradient?.type, r2(down.origin), down.angle, down.length], ['LINEAR', [340, 620], -90, 60]);
  assert.deepEqual(down.gradient?.stops.map((s) => [s.rampPoint, rgbOf(s.color), s.opacity]), [
    [0, [255, 0, 0], 100],
    [100, [0, 0, 255], 100],
  ]);
  // A radial one from the box's centre to its corner, a stop's alpha as its opacity.
  const out = radial.fillColor as GradientColor;
  assert.deepEqual([out.gradient?.type, r2(out.origin), Math.round(out.length * 100) / 100], ['RADIAL', [160, 530], 28.28]);
  assert.deepEqual(out.gradient?.stops.map((s) => [s.rampPoint, rgbOf(s.color), s.opacity]), [
    [0, [255, 255, 255], 100],
    [100, [0, 0, 0], 50],
  ]);
});

test('a profiled mark and a Copic mark are the outlines they fill, and a profiled shape with a fill is a group', () => {
  const source = `napkin 1
page 300 200
color #333333 width 12 profile tapered
line 20 20 280 20
fill #ffe08a
polygon 20 60, 120 60, 70 140
profile uniform fill none
tool copic nib 30 width 10
line 160 100 280 100
`;
  const [doc] = runJsx(jsxOf(source)).documents;
  const [tapered, shape, copic] = itemsOf(layersOf(doc)[1]);
  for (const outline of [tapered, copic]) {
    const path = outline instanceof CompoundPathItem ? [...outline.paths][0] : (outline as PathItem);
    assert.deepEqual([path.filled, path.stroked, rgbOf(path.fillColor), path.closed], [true, false, [51, 51, 51], true]);
  }
  assert.equal(copic.opacity, 50);
  assert.ok(shape instanceof GroupItem);
  const [under, over] = itemsOf(shape as GroupItem) as PathItem[];
  assert.deepEqual([rgbOf(under.fillColor), under.stroked], [[255, 224, 138], false]);
  assert.deepEqual([rgbOf((over instanceof CompoundPathItem ? [...over.paths][0] : over).fillColor)], [[51, 51, 51]]);
});

test('text is point text from its top-left or area text for a box, in the first family of its list Illustrator has', () => {
  const source = `napkin 1
page 300 200
color #1f2328
font "Acme Sans" 18
text "Hello\\nWorld" at 20 30
font "Arial" 12
text "A box of words that wraps where it has to" at 20 100 box 120
font "Nowhere Grotesk, serif" 12
text "Serif" at 200 30
font "Nowhere Grotesk" 12
text "Default" at 200 60
`;
  const run = runJsx(jsxOf(source));
  const [point, area, serif, fallback] = itemsOf(layersOf(run.documents[0])[1]) as TextFrame[];
  const attributes = point.textRange.characterAttributes;
  assert.deepEqual(
    [point.kind, point.contents, r2(point.position), attributes.size, attributes.leading, attributes.autoLeading, rgbOf(attributes.fillColor)],
    ['point', 'Hello\rWorld', [120, 670], 18, 22.5, false, [31, 35, 40]],
  );
  // Found by its family, since no likely PostScript name matched, and in its regular weight.
  assert.equal(attributes.textFont?.name, 'AcmeSans-Book');
  assert.equal(area.kind, 'area');
  assert.equal(area.contents, 'A box of words that wraps where it has to');
  assert.deepEqual([area.textPath?.shape?.top, area.textPath?.shape?.left, area.textPath?.shape?.width], [600, 120, 120]);
  assert.ok((area.textPath?.shape?.height ?? 0) > 30, 'room for the lines, and more');
  assert.equal(area.textRange.characterAttributes.textFont?.name, 'ArialMT');
  assert.equal(serif.textRange.characterAttributes.textFont?.name, 'TimesNewRomanPSMT');
  assert.equal(fallback.textRange.characterAttributes.textFont, null);
  // A font found nowhere is named when the script ends.
  assert.equal(run.alerts.length, 1);
  assert.match(run.alerts[0], /No font found for Nowhere Grotesk, so Illustrator's default was used\.$/);
});

test('an image is written, placed and embedded; a link is placed by link, or drawn as its placeholder and named', () => {
  const source = `napkin 1
page 300 200
image "logo" at 20 20 size 80 40
link "assets/logo.png" at 120 20 size 80 40 name "Logo"
link "assets/missing.png" at 20 100 size 120 60
link "assets/badge.svg" at 160 100 size 120 60
`;
  const script = jsxOf(source, { assets: { logo: LOGO } });
  const png = Buffer.from(LOGO.slice(LOGO.indexOf(',') + 1), 'base64');
  const run = runJsx(script, {
    scriptPath: '/work/drawing.jsx',
    files: { '/work/assets/logo.png': new Uint8Array([1, 2, 3]), '/work/assets/badge.svg': '<svg/>' },
  });
  const doc = run.documents[0];
  const all = layersOf(doc).flatMap((layer) => itemsOf(layer));
  const raster = all.find((item): item is RasterItem => item instanceof RasterItem);
  assert.ok(raster, 'the image is embedded');
  assert.equal(raster.bytes, png.toString('latin1'));
  assert.deepEqual([raster.width, raster.height, r2(raster.position)], [80, 40, [120, 680]]);
  // Written to a scratch file to be placed, which is gone once it is embedded.
  assert.deepEqual([...run.files.keys()].filter((path) => path.startsWith('/tmp/')), []);
  const placed = all.find((item): item is PlacedItem => item instanceof PlacedItem);
  assert.ok(placed, 'the link is placed');
  assert.deepEqual([placed.file?.fsName, placed.width, placed.height, r2(placed.position), placed.name], ['/work/assets/logo.png', 80, 40, [220, 680], 'logo.png']);
  // What is not there, and what Illustrator will not place, are placeholders named after their files.
  const placeholders = all.filter((item): item is GroupItem => item instanceof GroupItem);
  assert.deepEqual(placeholders.map((group) => group.name), ['missing.png', 'badge.svg']);
  const [box, , , label] = itemsOf(placeholders[0]) as [PathItem, PathItem, PathItem, TextFrame];
  assert.deepEqual([box.strokeDashes, rgbOf(box.fillColor), label.contents, label.kind, label.textRange.paragraphAttributes.justification], [
    [6, 4],
    [246, 248, 250],
    'missing.png',
    'anchored',
    'CENTER',
  ]);
  assert.deepEqual(run.alerts, [
    'napkin-sketch rebuilt 1 page in Illustrator.\n\nNot found, so drawn as placeholders: /work/assets/missing.png.\nNot placed by Illustrator, so drawn as placeholders: /work/assets/badge.svg.',
  ]);
  assert.equal(run.result, run.alerts[0]);
});

test("written into another folder than the drawing's, a script finds its links through the folder they are read in", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'napkin-jsx-'));
  try {
    await mkdir(join(dir, 'art', 'assets'), { recursive: true });
    await writeFile(join(dir, 'art', 'assets', 'logo.png'), new Uint8Array([9, 9, 9]));
    await writeFile(join(dir, 'art', 'letterhead.napkin'), 'napkin 1\npage 400 240\nlink "assets/logo.png" at 20 20 size 160 80\n');
    const { files } = await drawFile(join(dir, 'art', 'letterhead.napkin'), { out: join(dir, 'build'), formats: ['jsx'] });
    assert.deepEqual(files.map((file) => [file.format, file.page]), [['jsx', undefined]]);
    const script = await readFile(join(dir, 'build', 'letterhead.jsx'), 'utf8');
    assert.match(script, /link\("\.\.\/art\/assets\/logo\.png", 20, 20, 160, 80, /);
    const run = runJsx(script, { scriptPath: '/x/build/letterhead.jsx', files: { '/x/art/assets/logo.png': new Uint8Array([9, 9, 9]) } });
    const placed = layersOf(run.documents[0]).flatMap(itemsOf).find((item): item is PlacedItem => item instanceof PlacedItem);
    assert.equal(placed?.file?.fsName, '/x/art/assets/logo.png');
    // writeBook says where the links are read in with `base`; next to them, the path is the link's own.
    const book = bookOf('napkin 1\npage 400 240\nlink "assets/logo.png" at 20 20 size 160 80\n');
    await writeBook(book, { out: join(dir, 'art'), base: join(dir, 'art'), name: 'beside', formats: ['jsx'] });
    assert.match(await readFile(join(dir, 'art', 'beside.jsx'), 'utf8'), /link\("assets\/logo\.png", /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a hidden or locked layer is made so once what is on it is drawn, since Illustrator draws on neither', () => {
  const source = `napkin 1
page 200 200
layer "Sketch" hidden
line 0 0 10 10
layer "Ink" locked
line 0 0 10 10
group "Parts" hidden locked {
  layer "Wheel" opacity 0.5 locked
  circle 50 50 10
}
`;
  const run = runJsx(jsxOf(source));
  assert.equal(run.result, 'napkin-sketch rebuilt 1 page in Illustrator.');
  const named = (name: string) => layersOf(run.documents[0]).find((layer) => layer.name === name)!;
  const [sketch, ink, parts] = [named('Sketch'), named('Ink'), named('Parts')];
  assert.deepEqual([sketch.name, sketch.visible, sketch.locked, sketch.items.length], ['Sketch', false, false, 1]);
  assert.deepEqual([ink.name, ink.visible, ink.locked, ink.items.length], ['Ink', true, true, 1]);
  assert.deepEqual([parts.name, parts.visible, parts.locked], ['Parts', false, true]);
  const wheel = parts.items[0] as GroupItem;
  assert.deepEqual([wheel.name, wheel.hidden, wheel.locked, wheel.opacity, wheel.items.length], ['Wheel', false, true, 50, 1]);
});

test('a book is a document a page, each artboard its box, and a transparent page has no paper', () => {
  const book = bookOf('napkin 1\npage 200 100\nname "deck"\nrect 10 10 50 50\nnewpage "two"\ncircle 100 50 20\n');
  const run = runJsx(renderBook(book, { format: 'jsx', crop: 'auto' }));
  assert.equal(run.result, 'napkin-sketch rebuilt 2 pages in Illustrator.');
  assert.deepEqual(run.documents.map((doc) => doc.artboards[0].name), ['deck', 'two']);
  book.sketches.forEach((sketch, i) => {
    const box = renderBox(sketch, { crop: 'auto' })!;
    const doc = run.documents[i];
    assert.deepEqual([doc.width, doc.height], [box.width, box.height]);
    assert.equal((layersOf(doc)[0].items[0] as PathItem).shape?.width, box.width);
  });
  // The rect's corner at (10, 10) sits as far into the artboard as it sits into the box.
  const box = renderBox(book.sketches[0], { crop: 'auto' })!;
  const rect = layersOf(run.documents[0])[1].items[0] as PathItem;
  assert.deepEqual(r2(rect.points[0].anchor), r2([100 + 10 - box.x, 700 - (10 - box.y)]));
  const bare = runJsx(renderBook(book, { format: 'jsx', transparent: true }));
  assert.deepEqual(layersOf(bare.documents[0]).map((layer) => layer.name), ['Layer 1']);
});

test('what a script cannot make is said: an effect left off, an eraser in the paper, a color that is not one', () => {
  const warnings: string[] = [];
  const sketch = pageOf(
    [
      { points: [{ x: 10, y: 10 }, { x: 90, y: 90 }], effects: [{ type: 'blur', radius: 2 }] },
      { tool: 'eraser', points: [{ x: 10, y: 90 }, { x: 90, y: 10 }], width: 12 },
      { points: [{ x: 10, y: 50 }, { x: 90, y: 50 }], color: 'nope' },
    ],
    '#fcfaf5',
  );
  const run = runJsx(sketchesToJsx([sketch], { onWarning: (message) => warnings.push(message) }));
  assert.deepEqual(warnings, [
    'page "marks": an effect is not written to an Illustrator script, so what carries it is drawn plain',
    `page "marks": an eraser is drawn in the paper's color, since a script cannot cut a mask in Illustrator, so it covers what is under it on other layers too`,
    'page "marks": "nope" is not a color, so what it colors was left out',
  ]);
  const [plain, eraser] = itemsOf(layersOf(run.documents[0])[1]) as PathItem[];
  assert.equal(itemsOf(layersOf(run.documents[0])[1]).length, 2);
  assert.deepEqual(rgbOf(plain.strokeColor), [31, 35, 40]);
  assert.deepEqual([eraser.name, rgbOf(eraser.strokeColor), eraser.strokeWidth], ['Eraser', [252, 250, 245], 12]);
  const bare: string[] = [];
  sketchesToJsx([sketch], { transparent: true, onWarning: (message) => bare.push(message) });
  assert.ok(bare.includes('page "marks": an eraser was left out, since the page has no paper to draw it in'));
});

test('a run that fails says the page, the layer and the mark it stopped at, and puts the settings back', () => {
  let paths = 0;
  const run = runJsx(jsxOf(SIGN), {
    onAdd: (item: Art) => {
      if (item.typename === 'PathItem' && ++paths === 3) throw new Error('out of ink');
    },
  });
  assert.equal(run.result, 'napkin-sketch stopped at page "sign", layer "Front / Sun & Moon", mark 1: out of ink.');
  assert.deepEqual(run.alerts, [run.result]);
  assert.deepEqual(run.app, { coordinateSystem: 'ARTBOARDCOORDINATESYSTEM', userInteractionLevel: 'DISPLAYALERTS' });
});

/** TypeScript, for its scanner: from beside the test bundle, or from the working folder. */
function typescript(): typeof import('typescript') {
  for (const from of [__filename, join(process.cwd(), 'package.json')]) {
    try {
      return createRequire(from)('typescript') as typeof import('typescript');
    } catch {
      // Not installed where this looked; try the next place.
    }
  }
  throw new Error('typescript is not installed, and the ES3 check needs its scanner');
}

/** The ES5-and-later tokens a script holds, found with TypeScript's scanner: none, for ExtendScript. */
function newerThanEs3(source: string): string[] {
  const ts = typescript();
  const scanner = ts.createScanner(ts.ScriptTarget.ES3, true, ts.LanguageVariant.Standard, source);
  const found: string[] = [];
  let previous: import('typescript').SyntaxKind = ts.SyntaxKind.Unknown;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const text = scanner.getTokenText();
    if (token === ts.SyntaxKind.EqualsGreaterThanToken) found.push('=>');
    if (token === ts.SyntaxKind.NoSubstitutionTemplateLiteral || token === ts.SyntaxKind.TemplateHead) found.push('template');
    if (['let', 'const', 'class', 'of', 'yield', 'async', 'await'].includes(text)) found.push(text);
    if (previous === ts.SyntaxKind.CommaToken && (token === ts.SyntaxKind.CloseBracketToken || token === ts.SyntaxKind.CloseBraceToken)) found.push('trailing comma');
    if (previous === ts.SyntaxKind.DotToken && ['forEach', 'map', 'filter', 'reduce', 'some', 'every', 'indexOf', 'trim', 'bind', 'keys', 'isArray'].includes(text)) {
      found.push(`.${text}`);
    }
    if (text === 'JSON') found.push('JSON');
    previous = token;
  }
  return found;
}

test('the script is ES3 and ASCII, every name escaped and read back as it was', () => {
  const sketch = pageOf([
    { tool: 'text', text: 'Café "au lait" \\ ☕', points: [{ x: 10, y: 10 }], fontSize: 16, fontFamily: 'Acme Sans' },
    { points: [{ x: 10, y: 50 }, { x: 90, y: 90 }], gradient: { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] }, fill: '#fff' },
  ]);
  sketch.layers[0].name = 'Réunion ☕ "quoted"';
  sketch.name = 'page\none';
  const script = sketchesToJsx([sketch]);
  assert.deepEqual(newerThanEs3(script), []);
  assert.deepEqual([...script].filter((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n')), []);
  const run = runJsx(script);
  const layer = layersOf(run.documents[0])[1];
  assert.equal(layer.name, 'Réunion ☕ "quoted"');
  assert.equal((layer.items[layer.items.length - 1] as TextFrame).contents, 'Café "au lait" \\ ☕');
  assert.equal(run.documents[0].artboards[0].name, 'page\none');
  assert.equal(sketchesToJsx([sketch]), script, 'the same page writes the same script');
});

test("the interop page's excerpt of sign.jsx is what the writer writes, line for line", async () => {
  const page = (await readFile(join(repoRoot(), 'docs', 'api', 'interop', 'README.md'), 'utf8')).replace(/\r\n/g, '\n');
  const start = page.indexOf('```text\n    page("sign"');
  assert.ok(start >= 0, 'the page shows the excerpt');
  const excerpt = page.slice(start + '```text\n'.length, page.indexOf('\n```', start + 1)).split('\n');
  const script = jsxOf(SIGN).split('\n');
  // Every line but an elided one is in the script, and in the order shown.
  let from = 0;
  for (const line of excerpt.filter((l) => !l.includes('...'))) {
    const at = script.indexOf(line, from);
    assert.ok(at >= 0, `the script has, after line ${from}: ${line}`);
    from = at + 1;
  }
  // An elided line starts as the script's line does.
  for (const line of excerpt.filter((l) => l.includes('...'))) {
    assert.ok(script.some((s) => s.startsWith(line.slice(0, line.indexOf('...')))), `the script has a line starting ${line}`);
  }
});

test('jsx is a format: renderSketch and renderBook write one script, and --to jsx writes <name>.jsx', async () => {
  assert.ok(RENDER_FORMATS.includes('jsx'));
  const book = bookOf(SIGN);
  assert.equal(renderSketch(book.sketches[0], { format: 'jsx' }), sketchesToJsx(book.sketches));
  assert.equal(typeof renderBook(book, { format: 'jsx' }), 'string');
  const dir = await mkdtemp(join(tmpdir(), 'napkin-jsx-cli-'));
  try {
    await writeFile(join(dir, 'sign.napkin'), SIGN);
    const out: string[] = [];
    const code = await runCommand({
      argv: ['draw', 'sign.napkin', '--to', 'svg,jsx', '--json'],
      stdin: '',
      stdout: { write: (text: string) => out.push(text) },
      stderr: { write: () => undefined },
      cwd: dir,
      version: 'test',
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.join('')).files, [
      { path: 'sign.svg', format: 'svg', page: 1 },
      { path: 'sign.jsx', format: 'jsx' },
    ]);
    const run = runJsx(await readFile(join(dir, 'sign.jsx'), 'utf8'));
    assert.deepEqual(treeOf(run.documents[0]), treeOf(runJsx(renderSketch(book.sketches[0], { format: 'jsx' })).documents[0]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
