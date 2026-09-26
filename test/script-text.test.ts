/**
 * Text and media in napkin script: text items measured with the built-in
 * face, text drawn as marks, images from data URLs and named assets, and
 * documents copied in with `use` - none of it reading a file or touching a
 * DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import { imageSize } from '../src/core/script/media.js';
import { TEXT_LINE_HEIGHT, measureTextBlock } from '../src/core/script/text.js';
import { measureText } from '../src/core/graphic-design/font.js';
import { Surface } from '../src/renderer/surface.js';
import type { Sketch, Stroke } from '../src/core/types.js';
import { BADGE, LOGO, SCRIPT_FIXTURES, pngDataUrl } from './helpers/script-fixtures.js';

type P = { x: number; y: number };

const TIME = '2026-09-25T00:00:00.000Z';

function run(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES, ...options });
}

function clean(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  const result = run(text, options);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const page = (result: ScriptResult): Sketch => result.book.sketches[0];
const marks = (result: ScriptResult): Stroke[] => page(result).strokes;
const codes = (result: ScriptResult): string[] => result.diagnostics.map((d) => d.code);
const at = (stroke: Stroke): P => ({ x: stroke.points[0].x, y: stroke.points[0].y });

function near(actual: number, expected: number, tolerance = 1e-9, what = ''): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} is not within ${tolerance} of ${expected}`);
}

// ---- Text items -------------------------------------------------------------------

test('a text item carries the text, its size and font, and sits with its top-left at `at`', () => {
  const [item] = marks(clean('color navy\nfont "Georgia" 30\ntext "Acme Corp" at 40 50'));
  assert.deepEqual(
    [item.tool, item.text, item.fontSize, item.fontFamily, item.color, at(item), item.textBoxWidth],
    ['text', 'Acme Corp', 30, 'Georgia', 'navy', { x: 40, y: 50 }, undefined],
  );
  assert.equal(item.vector, undefined, 'a text item has no anchors');
  // `size` sets this text's size and leaves the font alone.
  const [sized, after] = marks(clean('font "Georgia" 30\ntext "One" at 0 0 size 12\ntext "Two" at 0 40'));
  assert.deepEqual([sized.fontSize, after.fontSize], [12, 30]);
});

test("a text item is aligned on the built-in face's measure, or on its box", () => {
  const width = measureText('Acme Corp', { fontSize: 28 });
  const [left, centre, right] = marks(
    clean('text "Acme Corp" at 200 70 size 28\ntext "Acme Corp" at 200 70 size 28 align center\ntext "Acme Corp" at 200 70 size 28 align right'),
  );
  near(at(left).x, 200);
  near(at(centre).x, 200 - width / 2);
  near(at(right).x, 200 - width);
  // With a box, the box is what is aligned, and it is the item's wrap width.
  const [boxed] = marks(clean('text "A longer caption that wraps" at 300 10 size 20 box 160 align center'));
  assert.deepEqual([boxed.textBoxWidth, at(boxed).x], [160, 220]);
  const block = measureTextBlock('A longer caption that wraps', 20, 160);
  assert.ok(block.lines.length > 1, 'the caption wraps inside its box');
  near(block.height, block.lines.length * 20 * TEXT_LINE_HEIGHT);
});

test('a text item moves and scales with the drawing and stays upright when it turns', () => {
  const [moved] = marks(clean('translate 100 50\nscale 2\ntext "Hi" at 10 10 size 12 box 40'));
  assert.deepEqual([at(moved), moved.fontSize, moved.textBoxWidth], [{ x: 120, y: 70 }, 24, 80]);
  // A quarter turn about the text's own centre leaves an upright item exactly where it was.
  const block = measureTextBlock('Upright', 20);
  const cx = 100 + block.width / 2;
  const cy = 100 + block.height / 2;
  const [turned] = marks(clean(`rotate 90 at ${cx} ${cy}\ntext "Upright" at 100 100 size 20`));
  near(at(turned).x, 100, 1e-9, 'x');
  near(at(turned).y, 100, 1e-9, 'y');
  assert.equal(turned.fontSize, 20);
});

test('a text with nothing in it is refused', () => {
  assert.deepEqual(codes(run('text "   " at 0 0')), ['invalid-value']);
  assert.deepEqual(codes(run('text "Hi" at 0 0 size 0')), ['invalid-value']);
});

// ---- Text as marks ----------------------------------------------------------------

test('text as marks is one pen mark: every stroke of every letter a subpath, in the current paint', () => {
  const [mark] = marks(clean('color #c0392b width 2\ntext "Hi." at 20 30 size 30 as marks'));
  assert.deepEqual([mark.tool, mark.color, mark.width, mark.text, mark.vector!.closed], ['pen', '#c0392b', 2, undefined, undefined]);
  const anchors = mark.vector!.anchors;
  // H is three strokes, i is two (its stem and its dot), and the full stop one: six subpaths.
  assert.equal(anchors.filter((a) => a.move).length + 1, 6);
  assert.ok(anchors.every((a) => !a.hIn && !a.hOut), 'letters are corners, with no handles');
  // The top of the capitals sits on `at`, and the first stroke starts at the left.
  const ys = anchors.map((a) => a.p.y);
  near(Math.min(...ys), 30, 1e-9, 'top');
  assert.ok(Math.min(...anchors.map((a) => a.p.x)) >= 20);
});

test('text as marks is aligned line by line, and turns with the drawing', () => {
  const right = marks(clean('text "One\\nTwo lines" at 300 0 size 20 align right as marks'))[0].vector!.anchors;
  const lines = [right.filter((a) => a.p.y < 20), right.filter((a) => a.p.y >= 20)];
  for (const line of lines) assert.ok(Math.max(...line.map((a) => a.p.x)) <= 300 + 1e-9, 'every line ends by 300');
  const plain = marks(clean('text "Turn" at 100 100 size 30 as marks'))[0].vector!.anchors;
  const turned = marks(clean('rotate 90 at 100 100\ntext "Turn" at 100 100 size 30 as marks'))[0].vector!.anchors;
  // A quarter turn clockwise about (100, 100) takes (x, y) to (200 - y, x).
  turned.forEach((a, k) => {
    near(a.p.x, 200 - plain[k].p.y, 1e-9);
    near(a.p.y, plain[k].p.x, 1e-9);
  });
});

test('text as marks goes through the hand-drawn pass, and warns of letters the face cannot draw', () => {
  const exact = marks(clean('text "Rough" at 0 0 size 30 as marks'))[0];
  const rough = marks(clean('seed 3\nrough 1\ntext "Rough" at 0 0 size 30 as marks'))[0];
  assert.notDeepEqual(rough.vector!.anchors, exact.vector!.anchors);
  const result = run('text "Café → ok" at 0 0 as marks');
  assert.deepEqual(codes(result), ['glyph-missing']);
  assert.match(result.diagnostics[0].message, /`é`, `→`/);
  assert.equal(marks(result).length, 1, 'the letters it can draw are still drawn');
  assert.deepEqual(codes(run('text "éé" at 0 0 as marks')), ['glyph-missing', 'invalid-value']);
});

// ---- Images -----------------------------------------------------------------------

test('an image is its own size, keeps its proportions with one size, and stretches with two', () => {
  const [own, one, two] = marks(clean('image "logo" at 10 20\nimage "logo" at 10 20 size 120\nimage "logo" at 10 20 size 60 60'));
  assert.deepEqual([own.tool, own.image, at(own), own.imageWidth, own.imageHeight], ['image', LOGO, { x: 10, y: 20 }, 40, 20]);
  assert.deepEqual([one.imageWidth, one.imageHeight], [120, 60]);
  assert.deepEqual([two.imageWidth, two.imageHeight], [60, 60]);
  // Written out as SVG, a stretched image fills its box as the canvas draws it, rather than letterboxing.
  assert.match(Surface.toSVG(page(clean('image "logo" at 0 0 size 60 60'))), /<image [^>]*width="60" height="60" preserveAspectRatio="none"/);
  // A data URL written into the script works the same way.
  const [inline] = marks(clean(`image "${pngDataUrl(8, 4)}" at 0 0 size 16`));
  assert.deepEqual([inline.imageWidth, inline.imageHeight], [16, 8]);
});

test('an image takes the opacity, moves and stretches with the drawing, and stays upright', () => {
  const [placed] = marks(clean('opacity 0.5\ntranslate 100 0\nscale 2 3\nimage "logo" at 10 10'));
  assert.deepEqual([placed.opacity, at(placed), placed.imageWidth, placed.imageHeight], [0.5, { x: 120, y: 30 }, 80, 60]);
  // A half turn about the image's centre leaves it where it was, upright.
  const [turned] = marks(clean('rotate 180 at 30 20\nimage "logo" at 10 10'));
  near(at(turned).x, 10);
  near(at(turned).y, 10);
  assert.deepEqual([turned.imageWidth, turned.imageHeight], [40, 20]);
});

test('an image whose size cannot be read is placed square, with a warning', () => {
  const unknown = 'data:image/x-icon;base64,AAABAAEAEBA=';
  const result = run(`image "${unknown}" at 0 0\nimage "${unknown}" at 0 0 size 30\nimage "${unknown}" at 0 0 size 30 20`);
  assert.deepEqual(codes(result), ['image-size-unknown', 'image-size-unknown']);
  assert.deepEqual(
    marks(result).map((m) => [m.imageWidth, m.imageHeight]),
    [
      [100, 100],
      [30, 30],
      [30, 20],
    ],
  );
});

test('an image names an asset or carries a data URL, and a script reads no files', () => {
  const missing = run('image "logp" at 0 0');
  assert.deepEqual(codes(missing), ['unknown-asset']);
  assert.match(missing.diagnostics[0].message, /Did you mean `logo`\?/);
  const path = run('image "assets/logo.png" at 0 0');
  assert.deepEqual(codes(path), ['unknown-asset']);
  assert.match(path.diagnostics[0].message, /reads no files/);
  assert.deepEqual(codes(run('image "https://example.com/logo.png" at 0 0')), ['unknown-asset']);
  assert.deepEqual(codes(run('image "data:text/plain,hello" at 0 0')), ['invalid-value']);
  assert.deepEqual(codes(run('image "logo" at 0 0', { assets: { logo: 'not a data url' } })), ['invalid-value']);
});

test("an image's size is read from its header: PNG, GIF, JPEG, WebP and SVG", () => {
  const url = (mime: string, bytes: number[]): string => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
  const le24 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
  const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
  const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
  assert.deepEqual(imageSize(pngDataUrl(33, 7)), { width: 33, height: 7 });
  assert.deepEqual(imageSize(url('image/gif', [...ascii('GIF89a'), ...le16(300), ...le16(150), 0, 0, 0])), { width: 300, height: 150 });
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...new Array(14).fill(0), 0xff, 0xc0, ...be16(17), 8, ...be16(480), ...be16(640), 3, ...new Array(9).fill(0)];
  assert.deepEqual(imageSize(url('image/jpeg', jpeg)), { width: 640, height: 480 });
  const riff = (chunk: string, body: number[]): number[] => [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...body, ...new Array(8).fill(0)];
  assert.deepEqual(imageSize(url('image/webp', riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(320), ...le16(200)]))), { width: 320, height: 200 });
  const w = 1000;
  const h = 700;
  const lossless = [0x2f, (w - 1) & 0xff, (((w - 1) >> 8) & 0x3f) | (((h - 1) & 0x3) << 6), ((h - 1) >> 2) & 0xff, ((h - 1) >> 10) & 0x0f];
  assert.deepEqual(imageSize(url('image/webp', riff('VP8L', lossless))), { width: w, height: h });
  assert.deepEqual(imageSize(url('image/webp', riff('VP8X', [0, 0, 0, 0, ...le24(4095), ...le24(2047)]))), { width: 4096, height: 2048 });
  const svg = (head: string): string => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${head}></svg>`)}`;
  assert.deepEqual(imageSize(svg('width="2in" height="96"')), { width: 192, height: 96 });
  assert.deepEqual(imageSize(svg('viewBox="0 0 400 300"')), { width: 400, height: 300 });
  assert.deepEqual(imageSize(svg('width="200" viewBox="0 0 400 300"')), { width: 200, height: 150 });
  assert.deepEqual(imageSize(svg('width="100%" height="100%" viewBox="0 0 64 32"')), { width: 64, height: 32 });
  assert.equal(imageSize(svg('width="100%"')), null);
  assert.equal(imageSize('data:image/png;base64,iVBOR'), null, 'a header cut short');
});

// ---- use ------------------------------------------------------------------------------

test('use copies a document in as a group: its layers, their properties, and its marks with new ids', () => {
  const hidden: Sketch = JSON.parse(JSON.stringify(BADGE));
  hidden.layers.find((l) => l.name === 'Words')!.visible = false;
  hidden.layers.find((l) => l.name === 'Card')!.opacity = 0.5;
  const before = JSON.stringify(hidden);
  const result = clean('use "badge" at 100 50 scale 0.5', { documents: { badge: hidden } });
  const layers = page(result).layers;
  const byName = new Map(layers.map((l) => [l.name, l]));
  const group = byName.get('badge')!;
  assert.equal(group.group, true);
  assert.deepEqual(
    ['Card', 'Words', 'Mark'].map((name) => byName.get(name)!.parent),
    [group.id, group.id, group.id],
  );
  assert.equal(byName.get('Dot')!.parent, byName.get('Mark')!.id, 'a group inside the document stays a group');
  assert.deepEqual([byName.get('Words')!.visible, byName.get('Card')!.opacity], [false, 0.5]);
  const copies = marks(result);
  assert.equal(copies.length, hidden.strokes.length);
  const sourceIds = new Set(hidden.strokes.map((s) => s.id));
  assert.ok(copies.every((s) => !sourceIds.has(s.id)), 'every copy has an id of its own');
  assert.equal(JSON.stringify(hidden), before, 'the document itself is left as it was');
  // Every anchor is placed at `at` and scaled: (x, y) goes to (100 + x / 2, 50 + y / 2).
  const card = copies[0];
  hidden.strokes[0].vector!.anchors.forEach((a, k) => {
    near(card.vector!.anchors[k].p.x, 100 + a.p.x / 2);
    near(card.vector!.anchors[k].p.y, 50 + a.p.y / 2);
  });
  assert.equal(card.width, hidden.strokes[0].width / 2);
  const word = copies.find((s) => s.tool === 'text')!;
  assert.equal(word.fontSize, 14);
});

test('use takes a layer name, a book, the transform, and neither the paint nor the hand-drawn pass', () => {
  const named = page(clean('use "badge" layer "Logo lockup"'));
  assert.ok(named.layers.some((l) => l.group && l.name === 'Logo lockup'));
  const book = evaluate(`${'napkin 1\n'}page 300 300\ncircle 50 50 20\nnewpage\nline 0 0 10 10`, { timestamp: TIME }).book;
  const fromBook = marks(clean('use "card"', { documents: { card: book } }));
  assert.deepEqual(fromBook.map((s) => s.vector!.anchors.length), [4], 'the first page of a book');
  const plain = marks(clean('use "badge" at 10 10'));
  const painted = marks(clean('seed 4\nrough 1\ncolor red width 9\nuse "badge" at 10 10'));
  assert.deepEqual(painted.map((s) => [s.vector?.anchors, s.color, s.width]), plain.map((s) => [s.vector?.anchors, s.color, s.width]));
  const turned = marks(clean('rotate 90\nuse "badge"'))[0].vector!.anchors[0].p;
  const original = BADGE.strokes[0].vector!.anchors[0].p;
  near(turned.x, -original.y);
  near(turned.y, original.x);
});

test('use names a document the host supplied, and is drawn whole or not at all', () => {
  const missing = run('use "badg"');
  assert.deepEqual(codes(missing), ['unknown-document']);
  assert.match(missing.diagnostics[0].message, /Did you mean `badge`\?/);
  assert.deepEqual(codes(run('use "badge" scale 0')), ['invalid-value']);
  const tight = run('use "badge"', { limits: { marks: BADGE.strokes.length - 1 } });
  assert.deepEqual([codes(tight), marks(tight).length], [['budget-exceeded'], 0]);
});
