/**
 * The `split` verb: the topmost mark drawn so far whose path passes within
 * 4 px of the point, cut there as the app's Split cuts it
 * (src/core/split.ts) - a line in two, a closed shape opened and then
 * divided, a corner cut on its anchor - under the line's transform, inside a
 * wipe's block, and what it says when there is nothing to cut.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import type { Sketch, Stroke } from '../src/core/types.js';

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
const page = (result: ScriptResult): Sketch => result.book.sketches[0];
const marks = (result: ScriptResult): Stroke[] => page(result).strokes;
const ends = (stroke: Stroke): number[][] => stroke.vector!.anchors.map((a) => [Math.round(a.p.x * 1000) / 1000, Math.round(a.p.y * 1000) / 1000]);

test('a line split in its middle is two lines, in its place and on its layer', () => {
  const result = clean('line 20 60 220 60\nsplit 120 60\nline 0 0 10 10');
  const [first, second, after] = marks(result);
  assert.deepEqual(ends(first), [[20, 60], [120, 60]]);
  assert.deepEqual(ends(second), [[120, 60], [220, 60]]);
  assert.deepEqual(ends(after), [[0, 0], [10, 10]], 'what was drawn after it stays after it');
  assert.equal(new Set(marks(result).map((s) => s.layer)).size, 1, 'one layer');
  assert.equal(new Set(marks(result).map((s) => s.id)).size, 3, 'each piece a mark of its own');
  assert.equal(result.stats.marks, 3, 'the budget counts the pieces');
});

test('a closed rectangle opens at the first split and divides at the second', () => {
  const opened = clean('rect 20 20 100 60\nsplit 70 20');
  assert.equal(marks(opened).length, 1);
  const [one] = marks(opened);
  assert.equal(one.vector!.closed, false);
  assert.deepEqual(ends(one)[0], [70, 20], 'it starts at the cut');
  assert.deepEqual(ends(one)[ends(one).length - 1], [70, 20], 'and ends there');
  const divided = clean('rect 20 20 100 60\nsplit 70 20\nsplit 70 80');
  assert.equal(marks(divided).length, 2);
  assert.deepEqual(ends(marks(divided)[0]).slice(-1)[0], [70, 80]);
  assert.deepEqual(ends(marks(divided)[1])[0], [70, 80]);
});

test('the topmost path in reach is the one cut, and a corner is cut on its anchor', () => {
  const crossing = clean('line 0 50 100 50\nline 50 0 50 100\nsplit 50 50');
  assert.deepEqual(marks(crossing).map((s) => ends(s)), [[[0, 50], [100, 50]], [[50, 0], [50, 50]], [[50, 50], [50, 100]]], 'the second line, on top');
  const corner = clean('polyline 20 20, 120 20, 120 120\nsplit 121 21');
  assert.deepEqual(marks(corner).map((s) => ends(s)), [[[20, 20], [120, 20]], [[120, 20], [120, 120]]], 'on the corner, no anchor added');
});

test('the point is where the split line is: its transform moves it', () => {
  const moved = clean('line 120 60 320 60\ntranslate 100 0\nsplit 120 60');
  assert.deepEqual(marks(moved).map((s) => ends(s)), [[[120, 60], [220, 60]], [[220, 60], [320, 60]]]);
});

test('nothing in reach, or the end of an open path, is nothing to cut, with a warning', () => {
  const missed = run('line 20 60 220 60\nsplit 120 80');
  assert.deepEqual(codes(missed), ['split-missed']);
  assert.match(missed.diagnostics[0].message, /^`split` found no path within 4 px of \(120, 80\)\.$/);
  assert.equal(marks(missed).length, 1);
  const end = run('line 20 60 220 60\nsplit 20 60');
  assert.deepEqual(codes(end), ['split-missed']);
  assert.match(end.diagnostics[0].message, /lands on the end of an open path/);
  const text = run('text "Hi" at 20 20\nsplit 22 24');
  assert.deepEqual(codes(text), ['split-missed'], 'text has no path to cut');
});

test('in a wipe block it cuts among the marks the block has drawn, which the wipe then takes', () => {
  const result = clean('wipe clean {\n  fill #e9c46a\n  rect 0 0 100 100\n  stroke off\n  rect 50 0 100 100\n  split 100 50\n}');
  // The top square opened on its right edge is still a closed outline to the wipe; three pieces.
  assert.equal(marks(result).length, 3);
});

test('the object form runs the same', () => {
  const json = evaluate(
    [
      { verb: 'napkin', version: 1 },
      { verb: 'line', x1: 20, y1: 60, x2: 220, y2: 60 },
      { verb: 'split', x: 120, y: 60 },
    ],
    { timestamp: TIME },
  );
  assert.deepEqual(json.diagnostics, []);
  assert.equal(marks(json).length, 2);
});
