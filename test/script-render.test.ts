/**
 * The render entry point: one call writes a page or a book as SVG, PNG, PDF
 * or `.skbk`, cut to one box - the ink, a box given, or a registration box
 * every page shares - and says what a format left out. Also the output fixes
 * this phase made on the way: the PDF reads every CSS color, leaves a
 * switched-off outline off and dashes a dashed one, and a text box wraps in
 * the SVG and the PDF where the built-in face breaks it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluate,
  inkBox,
  renderBook,
  renderBox,
  renderSketch,
  type RenderFormat,
} from '../src/core/script/index.js';
import { measureTextBlock } from '../src/core/script/text.js';
import { decodePng, isPng, parseColor, wrapText } from '../src/core/graphic-design/index.js';
import { parseSketchBook } from '../src/core/serialize.js';
import { createLayer, createSketch, createSketchBook, type Sketch, type Stroke, type VectorAnchor } from '../src/core/types.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';
import { pngDataUrl } from './helpers/script-fixtures.js';

const STAMP = '2026-09-25T00:00:00.000Z';

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

/** A 400 by 300 page named `name` holding the given marks on its one layer. */
function page(name: string, ...strokes: Array<Omit<Stroke, 'layer'>>): Sketch {
  const sketch = createSketch(name);
  sketch.width = 400;
  sketch.height = 300;
  sketch.strokes.push(...strokes.map((s) => ({ ...s, layer: sketch.layers[0].id })));
  return sketch;
}

/** A value as JSON reads it back, so fields left undefined compare equal to fields left out. */
function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Every media box a PDF declares. */
function mediaBoxes(pdf: string): string[] {
  return [...pdf.matchAll(/\/MediaBox \[([^\]]*)\]/g)].map((m) => m[1]);
}

/** Every view box an SVG declares on its root. */
function viewBox(svg: string): string | undefined {
  return /<svg[^>]*\bviewBox="([^"]*)"/.exec(svg)?.[1];
}

test('one call writes every format: SVG, PDF and .skbk as text, PNG as bytes', () => {
  const result = evaluate('napkin 1\npage 200 100\nname "card"\ncolor #1f2328 width 4\nline 20 30 120 30\nfill #ffe08a\nrect 130 20 50 50\n', {
    timestamp: STAMP,
  });
  assert.deepEqual(result.diagnostics, []);
  const card = result.book.sketches[0];

  const svg = renderSketch(card);
  assert.ok(svg.startsWith('<?xml'), 'SVG is the default');
  assert.equal(viewBox(svg), '0 0 200 100');

  const png = renderSketch(card, { format: 'png' });
  assert.ok(isPng(png));
  assert.deepEqual([decodePng(png).width, decodePng(png).height], [200, 100]);
  const retina = decodePng(renderSketch(card, { format: 'png', scale: 2 }));
  assert.deepEqual([retina.width, retina.height], [400, 200], 'scale is PNG pixels a page pixel');
  const paper = parseColor(card.background);
  assert.deepEqual([...decodePng(png).data.slice(0, 4)], [paper.r, paper.g, paper.b, 255], 'the paper is under the PNG');
  assert.equal(decodePng(renderSketch(card, { format: 'png', transparent: true })).data[3], 0, 'and a transparent one has none');

  const pdf = renderSketch(card, { format: 'pdf' });
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.deepEqual(mediaBoxes(pdf), ['0 0 200 100']);

  const book = parseSketchBook(renderSketch(card, { format: 'skbk' }));
  assert.equal(book.name, 'card', 'a page alone is written as a book of one, named after it');
  assert.deepEqual(json(book.sketches), json([card]));

  assert.throws(() => renderSketch(card, { format: 'jpg' as unknown as RenderFormat }), /cannot render "jpg"; the formats are svg, png, pdf, skbk, jsx/);
});

test('crop auto is the ink: the marks on visible layers, grown by half the widest line, then by the pad', () => {
  const sketch = page(
    'ink',
    { id: 'a', tool: 'pen', color: '#1f2328', width: 4, points: line([[50, 60], [150, 60]]) },
    { id: 'b', tool: 'pen', color: '#1f2328', width: 10, points: line([[100, 100], [100, 200]]) },
    { id: 'e', tool: 'eraser', color: '#000000', width: 40, points: line([[0, 0], [390, 290]]) },
  );
  const hidden = { ...createLayer('Hidden'), visible: false };
  sketch.layers.push(hidden);
  sketch.strokes.push({ id: 'h', tool: 'pen', color: '#1f2328', width: 2, layer: hidden.id, points: line([[300, 250], [350, 280]]) });

  // x 50 to 150 and y 60 to 200, grown by 5 for the 10-wide line; the eraser and the hidden mark add nothing.
  assert.deepEqual(inkBox(sketch), { x: 45, y: 55, width: 110, height: 150 });
  assert.deepEqual(renderBox(sketch, { crop: 'auto' }), { x: 45, y: 55, width: 110, height: 150 });
  const padded = { mode: 'auto' as const, pad: 8 };
  assert.deepEqual(renderBox(sketch, { crop: padded }), { x: 37, y: 47, width: 126, height: 166 });

  // The one box reaches every format.
  const svg = renderSketch(sketch, { crop: padded });
  assert.equal(viewBox(svg), '37 47 126 166');
  assert.match(svg, /<svg[^>]* width="126" height="166"/);
  const png = decodePng(renderSketch(sketch, { format: 'png', crop: padded }));
  assert.deepEqual([png.width, png.height], [126, 166]);
  assert.deepEqual(mediaBoxes(renderSketch(sketch, { format: 'pdf', crop: padded })), ['37 87 163 253'], 'flipped to PDF\'s upward y on a 300-high page');

  // A text item is measured with the built-in face.
  const caption = page('caption', { id: 't', tool: 'text', color: '#1f2328', width: 1, text: 'Acme Corp', fontSize: 20, points: [{ x: 10, y: 10 }] });
  const block = measureTextBlock('Acme Corp', 20);
  assert.deepEqual(inkBox(caption), { x: 9.5, y: 9.5, width: block.width + 1, height: block.height + 1 });

  assert.equal(renderBox(sketch, { crop: 'none' }), null, 'none is the whole page');
  assert.equal(renderBox(sketch), null, 'and so is no crop at all');
  assert.equal(renderBox(page('empty'), { crop: 'auto' }), null, 'a page with nothing drawn is written whole');
  assert.equal(viewBox(renderSketch(page('empty'), { crop: 'auto' })), '0 0 400 300');
  assert.deepEqual(
    renderBox(sketch, { crop: { x: 10.126, y: 0, width: 20.004, height: 10 } }),
    { x: 10.13, y: 0, width: 20, height: 10 },
    'a box is used as given, to two decimals, the precision every writer uses',
  );
});

test("a script's crop reaches every format as the script wrote it", () => {
  const result = evaluate('napkin 1\npage 400 300\nwidth 4\nline 50 60 150 60\nwidth 10\nline 100 100 100 200\ncrop auto pad 8\n', { timestamp: STAMP });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.output.crop, { mode: 'auto', pad: 8 });
  const png = decodePng(renderSketch(result.book.sketches[0], { format: 'png', ...result.output }));
  assert.deepEqual([png.width, png.height], [126, 166]);
});

test('registration cuts every page to one box, whatever the crop says', () => {
  const book = createSketchBook('frames');
  book.sketches = [
    page('one', { id: 'a', tool: 'pen', color: '#1f2328', width: 2, points: line([[20, 20], [60, 40]]) }),
    page('two', { id: 'b', tool: 'pen', color: '#1f2328', width: 2, points: line([[100, 100], [180, 150]]) }),
  ];
  const own = renderBook(book, { crop: 'auto' });
  assert.notEqual(viewBox(own[0]), viewBox(own[1]), 'cropped to their own ink, the frames do not line up');

  const registration = { x: 0, y: 0, width: 200, height: 160 };
  const svgs = renderBook(book, { crop: 'auto', registration });
  assert.deepEqual(svgs.map(viewBox), ['0 0 200 160', '0 0 200 160']);
  const pngs = renderBook(book, { format: 'png', registration }).map(decodePng);
  assert.deepEqual(
    pngs.map((png) => [png.width, png.height]),
    [
      [200, 160],
      [200, 160],
    ],
  );
  assert.deepEqual(mediaBoxes(renderBook(book, { format: 'pdf', registration })), ['0 140 200 300', '0 140 200 300'], 'one PDF, a page a sketch');

  const script = evaluate('napkin 1\npage 400 300\nregistration 0 0 200 160\nline 20 20 60 40\nnewpage\nline 100 100 180 150\n', { timestamp: STAMP });
  assert.deepEqual(script.diagnostics, []);
  assert.deepEqual(
    renderBook(script.book, { format: 'png', ...script.output }).map((png) => [decodePng(png).width, decodePng(png).height]),
    [
      [200, 160],
      [200, 160],
    ],
    'a script names the box once, with `registration`',
  );
});

test('.skbk is the book as the app saves it: it reads back the same, and one script writes the same bytes', () => {
  const source =
    'napkin 1\npage 400 300\nlayer "Sky" opacity 0.8\nfill #ffe08a\ncircle 200 80 40\ngroup "Figure" {\n  layer "Ink"\n  path "M20 200 C60 160 100 240 140 200"\n  text "Acme Corp" at 20 260 size 18\n}\n';
  const result = evaluate(source, { timestamp: STAMP });
  assert.deepEqual(result.diagnostics, []);
  const written = renderBook(result.book, { format: 'skbk' });
  assert.equal(written, renderBook(evaluate(source, { timestamp: STAMP }).book, { format: 'skbk' }), 'the same bytes every run');
  assert.equal(JSON.parse(written).updatedAt, STAMP, "the book keeps its own time rather than the moment it was written");
  assert.deepEqual(json(parseSketchBook(written)), json(result.book));
});

test('the PDF paints every color the PNG does, and a transparent page prints no paper', () => {
  const warnings: string[] = [];
  const sketch = page(
    'colors',
    { id: 'named', tool: 'pen', color: 'steelblue', width: 2, points: line([[10, 10], [90, 10]]) },
    { id: 'alpha', tool: 'pen', color: '#1f2328', width: 2, fill: '#11223380', noStroke: true, ...square(10, 20, 30) },
    { id: 'hsl', tool: 'text', color: 'hsl(0, 100%, 50%)', width: 1, text: 'Acme', fontSize: 12, points: [{ x: 10, y: 60 }] },
    { id: 'bad', tool: 'pen', color: 'not-a-color', width: 2, points: line([[10, 90], [90, 90]]) },
  );
  sketch.background = 'transparent';
  const pdf = renderSketch(sketch, { format: 'pdf', onWarning: (message) => warnings.push(message) });
  assert.doesNotMatch(pdf, /re f/, 'no paper under a transparent page');
  assert.match(pdf, /0\.2745 0\.5098 0\.7059 RG/, 'steelblue, not black');
  assert.match(pdf, /\/CA 0\.502 \/ca 0\.502/, "an eight-digit hex color's alpha is its opacity");
  assert.match(pdf, /\/GS\d+ gs\n0\.0667 0\.1333 0\.2 rg/);
  assert.match(pdf, /1 0 0 rg\nBT/, 'hsl() text in red');
  assert.equal(pdf.match(/ RG\n/g)?.length, 1, 'the mark in a color that is not one paints nothing');
  assert.deepEqual(warnings, ['page "colors": "not-a-color" is not a color, so what it colors was left out']);
});

test('the PDF leaves a switched-off outline off, and dashes a dashed one as the SVG does', () => {
  const pdf = renderSketch(
    page(
      'outlines',
      { id: 'fill-only', tool: 'pen', color: '#ff0000', width: 2, fill: '#00ff00', noStroke: true, ...square(10, 10, 20) },
      { id: 'dashed', tool: 'pen', color: '#0000ff', width: 2, strokeStyle: 'dashed', points: line([[0, 50], [100, 50]]) },
      { id: 'dotted', tool: 'pen', color: '#0000ff', width: 3, strokeStyle: 'dotted', points: line([[0, 60], [100, 60]]) },
    ),
    { format: 'pdf' },
  );
  assert.match(pdf, /0 1 0 rg/, 'the fill is painted');
  assert.doesNotMatch(pdf, /1 0 0 RG/, 'its switched-off outline is not');
  assert.match(pdf, /\[6 4\] 0 d/, 'dashes three widths long and two apart');
  assert.match(pdf, /\[0 6\] 0 d/, 'dots, as zero-length dashes with round caps');
});

test('a text box wraps where the built-in face breaks it, in the SVG and in the PDF', () => {
  const words = 'Acme Corp makes the finest anvils';
  const lines = wrapText(words, 120, { fontSize: 20 });
  assert.ok(lines.length > 2, 'the words need several lines at that width');
  const sketch = page(
    'caption',
    { id: 'boxed', tool: 'text', color: '#1f2328', width: 1, text: words, fontSize: 20, textBoxWidth: 120, points: [{ x: 10, y: 10 }] },
    { id: 'two', tool: 'text', color: '#1f2328', width: 1, text: 'Acme Corp\nanvils', fontSize: 20, textBoxWidth: 300, points: [{ x: 10, y: 200 }] },
  );
  const svg = renderSketch(sketch);
  const boxed = /<text[^>]*data-i="0"[^>]*>([\s\S]*?)<\/text>/.exec(svg)?.[1] ?? '';
  assert.deepEqual([...boxed.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]), lines);
  assert.match(svg, /data-box="120" data-text="Acme Corp makes the finest anvils"/, 'the text as typed rides along, for the importer to restore the box');
  assert.match(svg, /data-text="Acme Corp&#10;anvils"/, 'a newline kept as a character reference, which a reader does not fold into a space');
  const pdf = renderSketch(sketch, { format: 'pdf' });
  assert.equal(pdf.match(/\) Tj/g)?.length, lines.length + 2, 'the PDF breaks it at the same words');
});

test('each format says what it left out or drew as a stand-in, once', () => {
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]).toString('base64')}`;
  const sketch = page(
    'media',
    { id: 'p1', tool: 'image', color: '#000000', width: 1, image: pngDataUrl(4, 2), imageWidth: 40, imageHeight: 20, points: [{ x: 10, y: 10 }] },
    { id: 'p2', tool: 'image', color: '#000000', width: 1, image: pngDataUrl(2, 2), imageWidth: 20, imageHeight: 20, points: [{ x: 60, y: 10 }] },
    { id: 'j', tool: 'image', color: '#000000', width: 1, image: jpeg, imageWidth: 30, imageHeight: 20, points: [{ x: 100, y: 10 }] },
    {
      id: 'g',
      tool: 'pen',
      color: '#1f2328',
      width: 2,
      fill: '#ffe08a',
      gradient: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ffe08a' }, { offset: 1, color: '#ff8a65' }] },
      ...square(10, 60, 40),
    },
    {
      id: 'k',
      tool: 'image',
      color: '#000000',
      width: 1,
      image: pngDataUrl(2, 2),
      imageWidth: 60,
      imageHeight: 40,
      link: { href: 'art/logo.svg', kind: 'svg' },
      points: [{ x: 200, y: 10 }],
    },
  );
  const pdfWarnings: string[] = [];
  const pdf = renderSketch(sketch, { format: 'pdf', onWarning: (message) => pdfWarnings.push(message) });
  assert.equal(pdf.match(/\/Subtype \/Image/g)?.length, 1, 'the JPEG is embedded');
  assert.deepEqual(pdfWarnings, [
    'page "media": an image that is not a JPEG was left out, since the PDF embeds JPEG images only',
    'page "media": a gradient fill prints as the shape\'s flat fill',
  ]);

  const pngWarnings: string[] = [];
  renderSketch(sketch, { format: 'png', onWarning: (message) => pngWarnings.push(message) });
  assert.ok(
    pngWarnings.some((message) => message.startsWith('page "media": link "art/logo.svg" drew as its placeholder')),
    pngWarnings.join('\n'),
  );
  assert.ok(pngWarnings.some((message) => /JPEG|decode/i.test(message)), 'the PNG needs a decoder for the JPEG, and says so');

  const svgWarnings: string[] = [];
  renderSketch(sketch, { onWarning: (message) => svgWarnings.push(message) });
  assert.deepEqual(svgWarnings, [], 'the SVG writes everything');
});
