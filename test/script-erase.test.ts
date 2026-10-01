/**
 * The script's `tool eraser`, which cuts as the app's Eraser cuts
 * (src/core/erase.ts): a line cut where the eraser crosses it, a filled shape
 * with the swath taken out, nothing of the eraser's own left behind, the marks
 * on other layers and those drawn after it left alone, text passed over with a
 * word, and a wipe's marks cut before they are combined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import type { Stroke } from '../src/core/types.js';

const TIME = '2026-10-01T00:00:00.000Z';

function run(text: string): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME });
}

function clean(text: string): ScriptResult {
  const result = run(text);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const marks = (result: ScriptResult): Stroke[] => result.book.sketches[0].strokes;
const within = (stroke: Stroke, box: { x0: number; x1: number; y0: number; y1: number }): boolean =>
  stroke.points.some((p) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1);

test('an eraser line cuts the line drawn before it where it crosses, and leaves no mark of its own', () => {
  const result = clean('layer "Ink"\nwidth 4\nline 0 50 200 50\ntool eraser\nwidth 20\nline 100 0 100 100');
  const all = marks(result);
  assert.deepEqual(all.map((s) => s.tool), ['pen'], 'the line, cut; no eraser mark');
  const [line] = all;
  assert.ok(!within(line, { x0: 92, x1: 108, y0: 40, y1: 60 }), 'nothing of the line is left under the eraser');
  assert.ok(within(line, { x0: -1, x1: 60, y0: 40, y1: 60 }) && within(line, { x0: 140, x1: 201, y0: 40, y1: 60 }), 'its two ends are');
  assert.equal(line.vector!.anchors.filter((a) => a.move).length, 1, 'one mark of two pieces');
  assert.equal(result.stats.marks, 1, 'the budget counts the marks the page holds');
});

test('a filled shape has the eraser\'s swath taken out of it', () => {
  const [square] = marks(clean('color #000000 fill #000000\nrect 0 0 100 100\ntool eraser\nwidth 20\nline 50 -10 50 110'));
  assert.equal(square.fill, '#000000');
  assert.ok(square.vector!.anchors.some((a) => a.move), 'one shape of two pieces, a subpath each');
  assert.ok(!within(square, { x0: 41, x1: 59, y0: 1, y1: 99 }), 'no outline inside the swath');
});

test('marks on another layer, and marks drawn after the eraser, are not cut', () => {
  const result = clean('layer "Below"\nline 0 50 200 50\nlayer "Above"\ntool eraser\nwidth 20\nline 100 0 100 100\ntool pen\nline 0 60 200 60');
  const [below, after] = marks(result);
  assert.deepEqual(below.points.map((p) => [p.x, p.y]), [[0, 50], [200, 50]], 'the line on the layer below is whole');
  assert.deepEqual(after.points.map((p) => [p.x, p.y]), [[0, 60], [200, 60]], 'and so is the line drawn after');
  assert.equal(marks(result).length, 2);
});

test('an eraser over nothing draws nothing, and its paint waits for the next mark that shows', () => {
  const result = clean('fill #ffe08a\neffect blur 2\ntool eraser\nwidth 8\nrect 10 10 50 50\ntool pen\ncircle 150 150 20');
  const all = marks(result);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].effects, [{ type: 'blur', radius: 2 }], 'the effect waited for the circle');
});

test('text the eraser reaches is passed over, and a warning says so', () => {
  const result = run('text "Hello" at 20 20 size 24\ntool eraser\nwidth 20\nline 0 32 200 32');
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['erase-skipped']);
  assert.match(formatDiagnostic(result.diagnostics[0]), /`line` with `tool eraser` reached text or a picture, which it passed over/);
  assert.equal(marks(result).length, 1);
  assert.equal(marks(result)[0].text, 'Hello');
});

test("in a wipe block the eraser cuts the block's marks before they are combined", () => {
  const [union] = marks(clean('wipe in {\n  color #000000 fill #000000\n  rect 0 0 100 100\n  rect 50 0 100 100\n  tool eraser\n  width 10\n  line -10 50 160 50\n}'));
  assert.ok(!within(union, { x0: 2, x1: 148, y0: 46, y1: 54 }), 'the band the eraser cut runs through the union');
  assert.ok(within(union, { x0: -1, x1: 151, y0: -1, y1: 44 }) && within(union, { x0: -1, x1: 151, y0: 56, y1: 101 }), 'with the union either side of it');
});
