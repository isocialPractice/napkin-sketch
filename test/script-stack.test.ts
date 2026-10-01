/**
 * The `stack` verb: the marks its block draws, stacked as the Shape Stacker
 * stacks them (src/core/wipe.ts's stackFaces) - the pieces under its points
 * merged into one shape or taken away - with what is left drawn in their
 * place: the engine's result on the same marks, anchor for anchor; the points
 * under the line's transform; the points that miss; and what a block of
 * combined marks refuses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import { signedArea } from '../src/core/graphic-design/geometry.js';
import type { Point, Sketch, Stroke } from '../src/core/types.js';
import { stackFaces, STACK_MODES } from '../src/core/wipe.js';

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

/** The area a mark's points fill, each subpath a contour and a hole's taking away. */
function filledArea(points: readonly Point[]): number {
  const rings: Point[][] = [];
  for (const p of points) {
    if (p.move || rings.length === 0) rings.push([]);
    rings[rings.length - 1].push(p);
  }
  return Math.abs(rings.reduce((sum, ring) => sum + signedArea(ring), 0)) / 2;
}

const shapeOf = (stroke: Stroke): string =>
  JSON.stringify({ fill: stroke.fill ?? null, color: stroke.color, anchors: stroke.vector?.anchors ?? null });

/** A red square below a blue one, overlapping by 70 by 90: only the red at (40, 40), both at (125, 115), only the blue at (210, 190). */
const PAIR = 'fill #d0342c\nrect 20 20 140 140\nfill #27486d\nrect 90 70 140 140';

test('each stack draws what stackFaces leaves of the same marks, anchor for anchor', () => {
  const drawn = page(clean(PAIR));
  const cases: Array<[string, string, Array<{ x: number; y: number }>]> = [
    ['merge', '40 40, 125 115', [{ x: 40, y: 40 }, { x: 125, y: 115 }]],
    ['merge', '125 115', [{ x: 125, y: 115 }]],
    ['remove', '125 115', [{ x: 125, y: 115 }]],
  ];
  for (const [mode, written, at] of cases) {
    const stacked = clean(`stack ${mode} ${written} {\n${PAIR}\n}`);
    const edit = stackFaces(drawn, drawn.strokes.map((s) => s.id), at, mode as 'merge' | 'remove');
    const expected = [...drawn.strokes.flatMap((s) => (edit.changed.has(s.id) ? [edit.changed.get(s.id)!] : [])), ...edit.added.map((a) => a.stroke)];
    assert.deepEqual(marks(stacked).map(shapeOf).sort(), expected.map(shapeOf).sort(), `${mode} ${written}`);
  }
});

test('merge: a drag across the red square and the overlap is the red square again, and the blue one keeps the rest', () => {
  const [red, blue] = marks(clean(`stack merge 40 40, 125 115 {\n${PAIR}\n}`));
  assert.equal(red.fill, '#d0342c', 'painted as the square the first point is on');
  assert.equal(Math.round(filledArea(red.points)), 140 * 140);
  assert.equal(red.vector!.anchors.length, 4, 'its four corners');
  assert.equal(Math.round(filledArea(blue.points)), 140 * 140 - 70 * 90);
});

test('merge at one point makes that piece a shape of its own, right after the mark it is painted as', () => {
  const result = clean(`stack merge 125 115 {\n${PAIR}\n}`);
  assert.deepEqual(marks(result).map((s) => [s.fill, Math.round(filledArea(s.points))]), [
    ['#d0342c', 140 * 140 - 70 * 90],
    ['#27486d', 140 * 140 - 70 * 90],
    ['#27486d', 70 * 90],
  ]);
  assert.equal(page(result).layers.length, 1, 'on the layer the stack is on');
});

test('remove takes the pieces from every mark, and taking every piece leaves nothing', () => {
  const [red, blue] = marks(clean(`stack remove 125 115 {\n${PAIR}\n}`));
  assert.equal(Math.round(filledArea(red.points)), 140 * 140 - 70 * 90);
  assert.equal(Math.round(filledArea(blue.points)), 140 * 140 - 70 * 90);
  const all = run(`stack remove 40 40, 125 115, 210 190 {\n${PAIR}\n}`);
  assert.deepEqual(codes(all), ['wipe-empty']);
  assert.match(all.diagnostics[0].message, /^`stack remove` left nothing: its points took every piece away\.$/);
  assert.deepEqual(marks(all), []);
});

test('the points are where the stack line is: its transform moves them with the marks', () => {
  const moved = clean(`translate 100 50\nstack merge 125 115 {\n${PAIR}\n}`);
  assert.equal(marks(moved).length, 3, 'the overlap, found under the translate');
  const inside = run(`stack merge 40 40 {\ntranslate 100 50\n${PAIR}\n}`);
  assert.deepEqual(codes(inside), ['stack-missed'], 'a translate inside the block moves the marks and not the point');
});

test('a point on no piece says which it was, and with none left the marks are drawn as they are', () => {
  const some = run(`stack remove 125 115, 400 400 {\n${PAIR}\n}`);
  assert.deepEqual(codes(some), ['stack-missed']);
  assert.match(some.diagnostics[0].message, /^`stack remove` found no piece under point 2 of its 2:/);
  assert.equal(marks(some).length, 2);
  const none = run(`stack merge 400 400, 0 0, 500 5 {\n${PAIR}\n}`);
  assert.match(none.diagnostics[0].message, /under points 1, 2 and 3 of its 3/);
  assert.deepEqual(marks(none).map(shapeOf), marks(clean(PAIR)).map(shapeOf), 'drawn as they are');
});

test('a stack of fewer than two marks, or one holding a layer, is refused the way a wipe is', () => {
  const one = run('stack merge 30 30 {\n  rect 20 20 40 40\n}');
  assert.deepEqual(codes(one), ['wipe-failed']);
  assert.match(one.diagnostics[0].message, /^`stack merge` did nothing: its block drew fewer than two marks it can combine/);
  const layered = run(`stack merge 125 115 {\n  layer "A"\n${PAIR}\n}`);
  assert.deepEqual(codes(layered), ['misplaced-verb']);
  assert.match(layered.diagnostics[0].message, /^`layer` cannot be inside a `stack`/);
  const text = run(`stack merge 125 115 {\n${PAIR}\n  text "note" at 20 200\n}`);
  assert.deepEqual(codes(text), ['wipe-skipped']);
  assert.match(text.diagnostics[0].message, /^`stack merge` passed over a mark/);
});

test('a stack in a wipe is an operand of it, and the object form runs the same', () => {
  const nested = clean(`wipe in {\n  stack remove 125 115 {\n${PAIR}\n  }\n}`);
  const [union] = marks(nested);
  assert.equal(marks(nested).length, 1);
  assert.equal(Math.round(filledArea(union.points)), 2 * (140 * 140 - 70 * 90), 'the two squares, less their overlap, united');
  const json = evaluate(
    [
      { verb: 'napkin', version: 1 },
      {
        verb: 'stack',
        mode: 'remove',
        points: [{ x: 125, y: 115 }],
        body: [
          { verb: 'rect', x: 20, y: 20, width: 140, height: 140 },
          { verb: 'rect', x: 90, y: 70, width: 140, height: 140 },
        ],
      },
    ],
    { timestamp: TIME },
  );
  assert.deepEqual(json.diagnostics, []);
  assert.deepEqual(marks(json).map(shapeOf), marks(clean('stack remove 125 115 {\n  rect 20 20 140 140\n  rect 90 70 140 140\n}')).map(shapeOf));
});

test('the mode is one of two words, the points and the block are required', () => {
  assert.deepEqual([...STACK_MODES], ['merge', 'remove']);
  assert.deepEqual(codes(run('stack sideways 1 1 {\n}')), ['expected-choice']);
  assert.deepEqual(codes(run('stack merge {\n  rect 0 0 10 10\n}')), ['missing-argument']);
  assert.deepEqual(codes(run('stack merge 1 1')), ['expected-block']);
});
