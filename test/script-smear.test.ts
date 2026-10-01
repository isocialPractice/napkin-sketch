/**
 * The Smear in napkin script and in the outputs: `smear <width> <strength>
 * <points>` over the pencil marks drawn so far, written back, noted by the
 * writer; and a smeared Pencil mark in the SVG, the PDF and the PNG, as the
 * picture the canvas paints of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, formatScript, parseScript, sketchToInstructions, type ScriptResult } from '../src/core/script/index.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import type { Stroke } from '../src/core/types.js';

const TIME = '2026-09-30T00:00:00.000Z';
const HATCHING = 'pencil 4B\nrepeat 12 as i {\n  line (20 + i * 6) 20 (40 + i * 6) 140\n}\n';

function run(text: string): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME });
}

function clean(text: string): ScriptResult {
  const result = run(text);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const marks = (result: ScriptResult): Stroke[] => result.book.sketches[0].strokes;

test('a smear leaves a pass on each pencil mark it reaches, and none on the rest', () => {
  const result = clean(`${HATCHING}line 300 20 300 140\nsmear 24 0.6 10 80, 150 80`);
  const all = marks(result);
  assert.equal(all.slice(0, 12).filter((m) => m.smudges?.length === 1).length, 12, 'every line of the hatching');
  assert.equal(all[12].smudges, undefined, 'a line it never reached keeps none');
  const pass = all[0].smudges![0];
  assert.equal(pass.width, 24);
  assert.equal(pass.strength, 0.6);
  assert.ok(pass.path.length >= 2);
});

test('the stump\'s width scales with the transform, its strength stays from 0 to 1, and a Brush line is left alone', () => {
  const scaled = clean(`${HATCHING}scale 2\nsmear 12 1.4 5 40, 75 40`);
  const pass = marks(scaled)[0].smudges![0];
  assert.equal(pass.width, 24, 'twice the width at twice the size');
  assert.equal(pass.strength, 1, 'a strength over 1 is 1');
  const brush = run('line 20 20 20 140\nsmear 24 0.6 10 80, 150 80');
  assert.deepEqual(brush.diagnostics.map((d) => d.code), ['smear-missed']);
  assert.equal(marks(brush)[0].smudges, undefined);
});

test('written back as written, and the writer says a smeared mark is written unsmeared', () => {
  const text = 'napkin 1\nsmear 24 0.6 10 80, 150 80\n';
  const parsed = parseScript(text);
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(formatScript(parsed.script), text);
  const smeared = clean(`${HATCHING}smear 24 0.6 10 80, 150 80`);
  const written = sketchToInstructions(smeared.book.sketches[0]);
  assert.ok(written.notes.some((n) => /12 smeared pencil marks are written unsmeared/.test(n)), written.notes.join(' | '));
});

test('a smeared Pencil mark is written as its picture - SVG with its data, PDF with a soft mask, PNG from the same raster', () => {
  const sketch = clean(`${HATCHING}smear 24 0.6 10 80, 150 80`).book.sketches[0];
  const svg = sketchToSvg(sketch);
  assert.equal((svg.match(/<image x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" preserveAspectRatio="none" href="data:image\/png;base64,/g) ?? []).length, 12);
  assert.match(svg, /data-tool="pencil" data-i="0" data-pencil="4B" data-width="[^"]+" data-color="#434548" data-d="M[^"]+" data-smudges="\[\{&quot;path&quot;/);
  const pdf = sketchesToPdf([sketch]);
  assert.equal((pdf.match(/\/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/FlateDecode/g) ?? []).length, 12, 'a soft mask for each');
  assert.equal((pdf.match(/\/SMask \d+ 0 R/g) ?? []).length, 12);
  const doc = sketchToComposition(sketch, { scale: 2 });
  const layer = doc.elements[0] as { children: Array<{ type: string }> };
  assert.ok(layer.children.every((el) => el.type === 'image'));
});
