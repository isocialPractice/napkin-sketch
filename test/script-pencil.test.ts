/**
 * The Pencil in napkin script: `tool pencil`, and `pencil <grade> [<color>]`
 * - a graphite grade alone, a medium and its grade, or a colored pencil -
 * read, written back, checked in the object form, and written from a page
 * the app drew.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, formatScript, parseScript, sketchToInstructions, type ScriptResult } from '../src/core/script/index.js';
import { pencilPaint, pencilWidth } from '../src/core/pencil.js';
import { createSketch, type Stroke } from '../src/core/types.js';

const TIME = '2026-09-30T00:00:00.000Z';

function run(text: string): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME });
}

function clean(text: string): ScriptResult {
  const result = run(text);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const codes = (result: ScriptResult): string[] => result.diagnostics.map((d) => d.code);
const marks = (result: ScriptResult): Stroke[] => result.book.sketches[0].strokes;

test('pencil takes up the Pencil at a grade: a mark in its tone, at the width as written', () => {
  const [mark] = marks(clean('width 4\npencil 2B\nline 20 20 220 20'));
  assert.equal(mark.tool, 'pencil');
  assert.deepEqual(mark.pencil, { medium: 'graphite', grade: '2B' });
  assert.equal(mark.color, pencilPaint('2B').tone);
  assert.equal(mark.width, 4, 'a script\'s width is the line\'s own');
});

test('a medium and its grade, in two words or one, or as a string', () => {
  const written = ['pencil charcoal 4B', 'pencil compressed 6B', 'pencil vine soft', 'pencil vine-soft', 'pencil graphite 4H', 'pencil "charcoal HB"', 'pencil hb'];
  const want = [
    { medium: 'charcoal', grade: '4B' },
    { medium: 'compressed', grade: '6B' },
    { medium: 'vine', grade: 'Soft' },
    { medium: 'vine', grade: 'Soft' },
    { medium: 'graphite', grade: '4H' },
    { medium: 'charcoal', grade: 'HB' },
    { medium: 'graphite', grade: 'HB' },
  ];
  written.forEach((line, i) => {
    const [mark] = marks(clean(`${line}\nline 0 0 10 10`));
    assert.deepEqual(mark.pencil, want[i], line);
  });
});

test('a colored pencil draws in its color; tool pencil alone draws graphite HB; a pencil there is not is a mistake', () => {
  const [red] = marks(clean('pencil 2B #c03020\nline 0 0 10 10'));
  assert.equal(red.color, '#c03020');
  assert.deepEqual(red.pencil, { medium: 'graphite', grade: '2B' });
  const [plain] = marks(clean('color #ff0000\ntool pencil\nline 0 0 10 10'));
  assert.equal(plain.color, pencilPaint('HB').tone, 'the ink color does not change a pencil');
  assert.deepEqual(codes(run('pencil 10B')), ['expected-choice']);
  assert.deepEqual(codes(run('pencil charcoal 9H')), ['expected-choice']);
  assert.match(formatDiagnostic(run('pencil 10B').diagnostics[0]), /not a pencil there is/);
});

test('written back as written, and the object form names a pencil as the API does', () => {
  const text = 'napkin 1\npencil charcoal 4B #3b6e8f\npencil vine soft\npencil 2B\n';
  const parsed = parseScript(text);
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(
    parsed.script.filter((s) => s.verb === 'pencil'),
    [
      { verb: 'pencil', pencil: 'charcoal-4B', color: '#3b6e8f' },
      { verb: 'pencil', pencil: 'vine-soft' },
      { verb: 'pencil', pencil: '2B' },
    ].map((s) => ({ ...s, at: (parsed.script.find((x) => x.verb === 'pencil' && (x as { pencil: string }).pencil === s.pencil) as { at?: unknown }).at })),
  );
  assert.equal(formatScript(parsed.script), text);
  const json = evaluate([{ verb: 'napkin', version: 1 }, { verb: 'pencil', pencil: 'compressed-4B' }, { verb: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }], { timestamp: TIME });
  assert.deepEqual(json.diagnostics, []);
  assert.deepEqual(json.book.sketches[0].strokes[0].pencil, { medium: 'compressed', grade: '4B' });
  const bad = evaluate([{ verb: 'napkin', version: 1 }, { verb: 'pencil', pencil: 'crayon' }], { timestamp: TIME });
  assert.deepEqual(bad.diagnostics.map((d) => d.code), ['expected-choice']);
});

test('a page the app drew in pencil is written as pencil lines that draw it back', () => {
  const sketch = createSketch('pencils');
  const layer = sketch.layers[0].id;
  const line = (id: string, choice: Stroke['pencil'], y: number, color?: string): Stroke => ({
    id,
    tool: 'pencil',
    color: color ?? pencilPaint(choice).tone,
    width: pencilWidth(3, choice),
    layer,
    pencil: choice,
    points: [
      { x: 20, y },
      { x: 220, y },
    ],
  });
  sketch.strokes = [
    line('a', { medium: 'graphite', grade: '6B' }, 20),
    line('b', { medium: 'graphite', grade: '6B' }, 40),
    line('c', { medium: 'vine', grade: 'Medium' }, 60),
    line('d', { medium: 'charcoal', grade: '2B' }, 80, '#3b6e8f'),
  ];
  const written = sketchToInstructions(sketch);
  const pencils = written.script.filter((s) => s.verb === 'pencil');
  assert.deepEqual(
    pencils.map((s) => [(s as { pencil: string }).pencil, (s as { color?: string }).color ?? null]),
    [
      ['6B', null],
      ['vine-medium', null],
      ['charcoal-2B', '#3b6e8f'],
    ],
    'once a pencil, and the color only when it is not the tone',
  );
  const back = evaluate(written.script, { timestamp: TIME }).book.sketches[0].strokes;
  assert.deepEqual(
    back.map((s) => [s.tool, s.pencil?.medium, s.pencil?.grade, s.color, s.width]),
    sketch.strokes.map((s) => [s.tool, s.pencil?.medium, s.pencil?.grade, s.color, s.width]),
  );
});
