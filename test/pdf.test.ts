/** PDF export/import tests (dependency-free writer + best-effort reader). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCssColor, sketchesToPdf } from '../src/core/pdf.js';
import { importPdf } from '../src/core/pdf-import.js';
import { createSketch, isTextStroke } from '../src/core/types.js';

test('parseCssColor handles hex and rgb() forms', () => {
  assert.deepEqual(parseCssColor('#000000'), [0, 0, 0]);
  assert.deepEqual(parseCssColor('#fff'), [1, 1, 1]);
  assert.deepEqual(parseCssColor('rgb(255, 0, 0)'), [1, 0, 0]);
  assert.deepEqual(parseCssColor('not-a-color'), [0, 0, 0]);
});

test('sketchesToPdf writes a well-formed multi-page document', () => {
  const a = createSketch('a');
  const b = createSketch('b');
  const pdf = sketchesToPdf([a, b]);
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/Type \/Pages/);
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /%%EOF\s*$/);
  // Only latin1-safe code points, so a binary write cannot corrupt it.
  for (let i = 0; i < pdf.length; i++) {
    assert.ok(pdf.charCodeAt(i) <= 255, `non-latin1 byte at ${i}`);
  }
});

test('layer opacity is emitted as an ExtGState', () => {
  const sketch = createSketch('faded');
  sketch.layers[0].opacity = 0.5;
  sketch.strokes.push({
    id: 's1',
    tool: 'pen',
    color: '#000000',
    width: 2,
    layer: sketch.layers[0].id,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  });
  const pdf = sketchesToPdf([sketch]);
  assert.match(pdf, /\/ExtGState/);
  assert.match(pdf, /\/CA 0\.5 \/ca 0\.5/);
});

test('hidden layers are excluded from the PDF', () => {
  const sketch = createSketch('hidden');
  sketch.layers[0].visible = false;
  sketch.strokes.push({
    id: 's1',
    tool: 'pen',
    color: '#ff0000',
    width: 2,
    layer: sketch.layers[0].id,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  });
  const pdf = sketchesToPdf([sketch]);
  assert.ok(!pdf.includes('1 0 0 RG'));
});

test('a pen stroke round-trips through PDF export and import', () => {
  const sketch = createSketch('roundtrip');
  sketch.strokes.push({
    id: 's1',
    tool: 'pen',
    color: '#123456',
    width: 4,
    layer: sketch.layers[0].id,
    points: [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
    ],
  });

  const pages = importPdf(Buffer.from(sketchesToPdf([sketch]), 'latin1'));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, sketch.width);
  assert.equal(pages[0].height, sketch.height);
  assert.equal(pages[0].background, sketch.background);

  const strokes = pages[0].strokes.filter((s) => !isTextStroke(s));
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].color, '#123456');
  assert.equal(strokes[0].width, 4);
  assert.equal(strokes[0].points.length, 3);
  assert.ok(Math.abs(strokes[0].points[0].x - 10) < 0.1);
  assert.ok(Math.abs(strokes[0].points[0].y - 20) < 0.1);
  assert.ok(Math.abs(strokes[0].points[2].x - 110) < 0.1);
  assert.ok(Math.abs(strokes[0].points[2].y - 120) < 0.1);
});

test('multi-line text round-trips through PDF export and import', () => {
  const sketch = createSketch('text');
  sketch.strokes.push({
    id: 't1',
    tool: 'text',
    color: '#1f2328',
    width: 1,
    layer: sketch.layers[0].id,
    points: [{ x: 50, y: 60 }],
    text: 'hello\nworld',
    fontSize: 24,
  });

  const pages = importPdf(Buffer.from(sketchesToPdf([sketch]), 'latin1'));
  const texts = pages[0].strokes.filter(isTextStroke);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, 'hello\nworld');
  assert.ok(Math.abs((texts[0].fontSize ?? 0) - 24) < 0.1);
  assert.ok(Math.abs(texts[0].points[0].x - 50) < 0.1);
  assert.ok(Math.abs(texts[0].points[0].y - 60) < 0.1);
});

test('importPdf rejects non-PDF data', () => {
  assert.throws(() => importPdf(Buffer.from('not a pdf', 'latin1')));
});
