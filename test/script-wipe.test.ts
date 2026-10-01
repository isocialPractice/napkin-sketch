/**
 * The `wipe` verb: the marks its block draws, combined as the Wipe Stacks
 * combine them (src/core/wipe.ts), with what is left drawn in their place -
 * each op the engine's result on the same marks, anchor for anchor; the
 * block keeping its paint to itself; what it passes over, what it cannot
 * do, and the budget.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_INK, evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import { signedArea } from '../src/core/graphic-design/geometry.js';
import type { Point, Sketch, Stroke } from '../src/core/types.js';
import { wipeMarks, WIPE_OPS } from '../src/core/wipe.js';

const TIME = '2026-09-30T00:00:00.000Z';

function run(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME, ...options });
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

/** A mark as the comparison sees it: its paint and its anchors, exactly. */
const shapeOf = (stroke: Stroke): string =>
  JSON.stringify({ fill: stroke.fill ?? null, color: stroke.color, noStroke: stroke.noStroke ?? false, anchors: stroke.vector?.anchors ?? null });

/** A red square below a blue one, overlapping by 70 by 90. */
const PAIR = 'fill #d0342c\nrect 20 20 140 140\nfill #27486d\nrect 90 70 140 140';
const RED = '#d0342c';
const BLUE = '#27486d';

test('each wipe draws what the Wipe Stacks leave of the same marks, anchor for anchor', () => {
  const drawn = page(clean(PAIR));
  for (const op of WIPE_OPS) {
    const wiped = clean(`wipe ${op} {\n${PAIR}\n}`);
    const edit = wipeMarks(drawn, drawn.strokes.map((s) => s.id), op);
    const expected = [...drawn.strokes.flatMap((s) => (edit.changed.has(s.id) ? [edit.changed.get(s.id)!] : [])), ...edit.added.map((a) => a.stroke)];
    assert.deepEqual(marks(wiped).map(shapeOf).sort(), expected.map(shapeOf).sort(), op);
    assert.equal(page(wiped).layers.length, 1, `${op}: on the layer the wipe is on`);
    assert.ok(marks(wiped).every((s) => s.layer === page(wiped).layers[0].id && s.id !== ''), `${op}: the sink gives each its id and layer`);
  }
});

test('what each wipe leaves of the pair, by area, and the paint it takes', () => {
  const overlap = 70 * 90;
  const square = 140 * 140;
  const areas = (op: string): number[] => marks(clean(`wipe ${op} {\n${PAIR}\n}`)).map((s) => Math.round(filledArea(s.points)));
  assert.deepEqual(areas('in'), [2 * square - overlap]);
  assert.deepEqual(areas('out-front'), [square - overlap]);
  assert.deepEqual(areas('out-back'), [square - overlap]);
  assert.deepEqual(areas('mid'), [overlap]);
  assert.deepEqual(areas('outer'), [2 * square - 2 * overlap]);
  assert.deepEqual(areas('clean').sort((a, b) => a - b), [overlap, square - overlap, square - overlap]);
  const fills = (op: string): string[] => marks(clean(`wipe ${op} {\n${PAIR}\n}`)).map((s) => s.fill!);
  assert.deepEqual(fills('in'), [BLUE], 'the topmost');
  assert.deepEqual(fills('out-front'), [RED], 'the bottom one, which is what is left');
  assert.deepEqual(fills('out-back'), [BLUE], 'the top one');
  assert.deepEqual(fills('clean'), [RED, BLUE, BLUE], "the red one's piece, then the blue one's two: the overlap is the topmost's");
});

test('Clean Wipe on three circles cuts seven pieces, on the layer, and the stats count them', () => {
  const result = clean('wipe clean {\n  fill #d0342c\n  circle 100 100 70\n  fill #27486d\n  circle 180 100 70\n  fill #2e7d5b\n  circle 140 170 70\n}');
  assert.equal(marks(result).length, 7);
  assert.equal(page(result).layers.length, 1);
  assert.equal(result.stats.marks, 7, 'what the wipe left, not the circles it took');
  assert.equal(result.stats.anchors, marks(result).reduce((sum, s) => sum + s.vector!.anchors.length, 0));
  assert.equal(result.stats.points, marks(result).reduce((sum, s) => sum + s.points.length, 0));
});

test('a line is its ink: a thick one taken from a square cuts it in two, painted as the square', () => {
  const [cut, ...rest] = marks(clean('wipe out-front {\n  fill #ffe08a\n  rect 20 20 110 110\n  fill none\n  width 14\n  line 10 140 140 10\n}'));
  assert.deepEqual(rest, []);
  assert.equal(cut.fill, '#ffe08a');
  assert.equal(cut.points.filter((p) => p.move).length, 1, 'two pieces, one mark');
  // The ink is the width the line paints at, which a pen's pressure narrows.
  const area = filledArea(cut.points);
  assert.ok(area < 110 * 110 - 1000 && area > 110 * 110 - 110 * 14 * Math.SQRT2, 'the ink is taken out, and no more than its band');
});

test('the block keeps its paint and transforms to itself, as a group does', () => {
  const result = clean('wipe in {\n  color #ff0000\n  translate 100 0\n  rect 0 0 40 40\n  rect 20 0 40 40\n}\nrect 0 100 10 10');
  const [wiped, after] = marks(result);
  assert.equal(wiped.color, '#ff0000');
  assert.equal(Math.min(...wiped.points.map((p) => p.x)), 100, 'the translate applies inside');
  assert.equal(after.color, DEFAULT_INK, 'and not after');
  assert.equal(Math.min(...after.points.map((p) => p.x)), 0);
});

test('a definition placed in a wipe is wiped, and a wipe in a wipe is an operand of the outer one', () => {
  const placed = clean('define "pair" {\n  rect 0 0 100 100\n  rect 50 0 100 100\n}\nwipe mid {\n  place "pair" at 10 10\n}');
  assert.deepEqual(marks(placed).map((s) => Math.round(filledArea(s.points))), [50 * 100]);
  const nested = clean('wipe in {\n  wipe mid {\n    rect 0 0 100 100\n    rect 50 0 100 100\n  }\n  rect 0 150 20 20\n}');
  const [both] = marks(nested);
  assert.equal(marks(nested).length, 1);
  assert.equal(Math.round(filledArea(both.points)), 50 * 100 + 20 * 20, 'the middle and the far square, one mark');
});

test('text and pictures are passed over, drawn where they were, with a warning', () => {
  const result = run('wipe in {\n  rect 20 20 60 60\n  text "note" at 40 100\n  rect 50 50 60 60\n}');
  assert.deepEqual(codes(result), ['wipe-skipped']);
  assert.match(result.diagnostics[0].message, /^`wipe in` passed over a mark it cannot combine/);
  const [note, wiped] = marks(result);
  assert.equal(note.text, 'note', 'below the result, as it was below the top square');
  assert.equal(Math.round(filledArea(wiped.points)), 2 * 3600 - 900);
});

test('a wipe that leaves nothing says so, and draws nothing', () => {
  const apart = run('wipe mid {\n  rect 0 0 10 10\n  rect 50 50 10 10\n}');
  assert.deepEqual(codes(apart), ['wipe-empty']);
  assert.match(apart.diagnostics[0].message, /no ground all of its marks cover/);
  assert.deepEqual(marks(apart), []);
  const covered = run('wipe out-front {\n  rect 40 40 20 20\n  rect 0 0 100 100\n}');
  assert.deepEqual(codes(covered), ['wipe-empty']);
  assert.deepEqual(marks(covered), []);
});

test('a wipe that cannot combine its marks draws them as they are, with a warning', () => {
  const one = run('wipe in {\n  rect 20 20 40 40\n}');
  assert.deepEqual(codes(one), ['wipe-failed']);
  assert.match(one.diagnostics[0].message, /fewer than two marks it can combine/);
  assert.deepEqual(marks(one).map(shapeOf), marks(clean('rect 20 20 40 40')).map(shapeOf));
  const none = run('wipe clean {\n}');
  assert.deepEqual(codes(none), ['wipe-failed']);
  assert.deepEqual(marks(none), []);
  const many = run(`wipe in {\n${Array.from({ length: 33 }, (_, i) => `  rect ${i * 5} 0 10 10`).join('\n')}\n}`);
  assert.deepEqual(codes(many), ['wipe-failed']);
  assert.match(many.diagnostics[0].message, /up to 32 marks, and its block drew 33/);
  assert.equal(marks(many).length, 33);
});

test('effects written before a wipe go on what it leaves; inside, a hand-drawn mark takes no layer of its own', () => {
  const blurred = clean('effect blur 2\nwipe in {\n  rect 0 0 40 40\n  rect 20 0 40 40\n}');
  assert.deepEqual(marks(blurred).map((s) => s.effects?.map((e) => e.type)), [['blur']]);
  // Outside a wipe, a hand-drawn mark that takes effects is a layer of its own, which carries them.
  const outside = page(clean('seed 4\nrough 0.4 passes 2\neffect blur 1\nrect 20 0 40 40'));
  assert.ok(outside.layers.some((l) => l.effects?.some((e) => e.type === 'blur')));
  assert.ok(outside.strokes.every((s) => !s.effects));
  // Inside, its pieces are operands, each carrying them, and the topmost's paint is what Wipe In leaves.
  const rough = page(clean('seed 4\nwipe in {\n  rough 0.4 passes 2\n  rect 0 0 40 40\n  effect blur 1\n  rect 20 0 40 40\n}'));
  assert.ok(rough.layers.every((l) => !l.effects), 'no layer of its own');
  assert.equal(rough.strokes.length, 1);
  assert.deepEqual(rough.strokes[0].effects?.map((e) => e.type), ['blur']);
});

test('a layer, a group, a use or a new page cannot be inside a wipe', () => {
  const layered = run('wipe in {\n  layer "A"\n  rect 0 0 40 40\n  rect 20 0 40 40\n}');
  assert.deepEqual(codes(layered), ['misplaced-verb']);
  assert.match(layered.diagnostics[0].message, /^`layer` cannot be inside a `wipe`/);
  assert.equal(marks(layered).length, 1, 'the rest of the block is wiped');
  // The wipe's own warning is at its line, before the line inside it.
  assert.deepEqual(codes(run('wipe in {\n  group "G" {\n  }\n}')), ['wipe-failed', 'misplaced-verb']);
  assert.deepEqual(codes(run('wipe in {\n  use "x"\n}')), ['wipe-failed', 'misplaced-verb']);
  assert.deepEqual(codes(run('wipe in {\n  newpage\n}')), ['wipe-failed', 'misplaced-verb']);
  assert.match(run('wipe in {\n  newpage\n}').diagnostics[1].message, /inside a group, a wipe, a stack or a placed definition/);
});

test('the budget counts what a wipe leaves, and a wipe past it keeps its marks as drawn', () => {
  const venn = 'wipe clean {\n  circle 100 100 70\n  circle 180 100 70\n  circle 140 170 70\n}';
  const stopped = run(venn, { limits: { marks: 5 } });
  assert.deepEqual(codes(stopped), ['budget-exceeded']);
  assert.equal(marks(stopped).length, 3, 'the three circles, as the block drew them');
  assert.equal(run(venn, { limits: { marks: 7 } }).diagnostics.length, 0, 'seven pieces fit a budget of seven');
});

test('the op is one of six words, the block is required, and the object form runs the same', () => {
  assert.deepEqual(codes(run('wipe sideways {\n  rect 0 0 10 10\n}')), ['expected-choice']);
  assert.deepEqual(codes(run('wipe in')), ['expected-block']);
  const json = evaluate(
    [
      { verb: 'napkin', version: 1 },
      {
        verb: 'wipe',
        op: 'mid',
        body: [
          { verb: 'rect', x: 20, y: 20, width: 140, height: 140 },
          { verb: 'rect', x: 90, y: 70, width: 140, height: 140 },
        ],
      },
    ],
    { timestamp: TIME },
  );
  assert.deepEqual(json.diagnostics, []);
  assert.deepEqual(marks(json).map(shapeOf), marks(clean('wipe mid {\n  rect 20 20 140 140\n  rect 90 70 140 140\n}')).map(shapeOf));
});

test("a Pathfinder word is not a verb, but it names the wipe", () => {
  for (const word of ['pathfinder', 'unite', 'intersect', 'divide']) {
    const result = run(`${word} in {\n}`);
    assert.equal(result.diagnostics[0].code, 'unknown-verb', word);
    assert.match(result.diagnostics[0].message, /`wipe`/, word);
  }
});
