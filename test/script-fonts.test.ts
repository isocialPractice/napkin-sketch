/**
 * Font files handed to a headless render (src/core/script/render.ts's
 * `fonts`, and napkin-sketch/node's `loadFonts`), on the fixture font in
 * test/fonts/: text laid out by the font's own advances and kerning in the
 * SVG; a PNG drawing each glyph as its outline; a PDF drawing it as shapes,
 * with no `Tj` left; a Warp on text bending its outlines, the text carried
 * for napkin to read back; and a family the render was not given drawn in the
 * built-in face, said.
 *
 * At 40.96 px a 2048-unit em is 0.02 px a unit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodePng } from '../src/core/graphic-design/index.js';
import { renderSketch } from '../src/core/script/render.js';
import { loadFonts } from '../src/core/script-files.js';
import { createSketch, type Sketch, type Stroke } from '../src/core/types.js';
import type { Effect } from '../src/core/effects.js';
import { repoRoot } from './helpers/repo-root.js';

const FONTS = join(repoRoot(), 'test', 'fonts');
const SANS = new Uint8Array(readFileSync(join(FONTS, 'napkin-test-sans.ttf')));
const fonts = { 'Napkin Test Sans': SANS };

const text = (value: string, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'tx',
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 20, y: 50, pressure: 0.5 }],
  text: value,
  fontSize: 40.96,
  fontFamily: 'Napkin Test Sans',
  ...extra,
});

function page(...strokes: Stroke[]): Sketch {
  const sketch = createSketch('fonts');
  sketch.width = 200;
  sketch.height = 120;
  sketch.strokes.push(...strokes.map((s) => ({ ...s, layer: sketch.layers[0].id })));
  return sketch;
}

/** The darkness of a PNG's pixel, 0 for white paper to 255 for black ink. */
function inkAt(png: Uint8Array, x: number, y: number): number {
  const image = decodePng(png);
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  return 255 - (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
}

test("the SVG sets the text by the font's own advances and kerning", () => {
  const svg = renderSketch(page(text('To')), { fonts });
  // The o starts the T's advance on, less the pair's kerning: 20 + (1251 - 227) x 0.02.
  assert.match(svg, /x="20 40\.48"/, svg);
  // Without the font, the built-in face's advances set it elsewhere.
  assert.doesNotMatch(renderSketch(page(text('To'))), /x="20 40\.48"/);
});

test("the PNG draws each glyph as its font's outline", () => {
  const png = renderSketch(page(text('T')), { format: 'png', fonts });
  // The baseline is the font's ascent below the anchor: 50 + 40.96 x 1854 / 2288.
  const baseline = 50 + (40.96 * 1854) / (1854 + 434);
  // The T's stem runs from 530 to 720 units across, its bar from 1253 to 1409 up.
  assert.ok(inkAt(png, 20 + 625 * 0.02, baseline - 600 * 0.02) > 200, 'the stem is solid ink');
  assert.ok(inkAt(png, 20 + 300 * 0.02, baseline - 1330 * 0.02) > 200, 'and the bar');
  assert.ok(inkAt(png, 20 + 300 * 0.02, baseline - 600 * 0.02) < 40, 'and beside the stem, under the bar, is paper');
});

test('the PDF draws the text as shapes, with no text operator left; without the font, it sets Helvetica', () => {
  const shapes = renderSketch(page(text('To')), { format: 'pdf', fonts });
  assert.doesNotMatch(shapes, /\) Tj/);
  assert.match(shapes, / c /, 'curves: the o');
  const helvetica = renderSketch(page(text('To')), { format: 'pdf' });
  assert.match(helvetica, /\(To\) Tj/);
});

test('a Warp on text bends its outlines, and the text it stands for rides along for napkin to read back', () => {
  const warp: Effect = { type: 'warp', style: 'arc', orientation: 'horizontal', bend: 50, distortH: 0, distortV: 0, part: 'whole' } as Effect;
  const bent = renderSketch(page(text('To', { effects: [warp] })), { fonts });
  assert.match(bent, /data-napkin-faces="1"/);
  assert.match(bent, /data-text="To"/);
  assert.match(bent, /font-family="Napkin Test Sans"/);
  // Without fonts to draw it from, the text is set as text, as before.
  assert.doesNotMatch(renderSketch(page(text('To', { effects: [warp] }))), /data-napkin-faces/);
});

test('a family the render was not given is drawn in the built-in face, and said once', () => {
  const warnings: string[] = [];
  renderSketch(page(text('Hi', { fontFamily: 'Georgia' }), text('Hi', { id: 'tx2', fontFamily: 'Georgia' })), { format: 'png', fonts, onWarning: (m) => warnings.push(m) });
  assert.deepEqual(warnings, ['page "fonts": Georgia: no font file was given for it, so a text is drawn in the built-in face.']);
});

test('loadFonts reads font files by family - a path, or bytes as they are - and says which file it could not read', async () => {
  const loaded = await loadFonts({ 'Napkin Test Sans': join(FONTS, 'napkin-test-sans.ttf'), 'Napkin Test CFF': [SANS, join(FONTS, 'napkin-test-cff.otf')] });
  assert.equal(loaded['Napkin Test Sans'][0].length, SANS.length);
  assert.equal(loaded['Napkin Test CFF'].length, 2);
  assert.equal(loaded['Napkin Test CFF'][0], SANS, 'bytes are kept as they are');
  await assert.rejects(loadFonts({ Missing: join(FONTS, 'missing.ttf') }), /font "Missing" could not be read from/);
});
