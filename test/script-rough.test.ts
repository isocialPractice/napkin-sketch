/**
 * The hand-drawn pass: `rough` turns exact anchors into anchors that read as
 * drawn by hand, and does it the same way every run.
 *
 * The pass is measured on what the evaluator hands back - each mark's anchors
 * next to the exact ones - since a mark's anchors are what the canvas, the
 * exporters and the app's editing tools all work from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import {
  ROUGH_ANCHOR_DRIFT_PX,
  ROUGH_BOW_PER_ROOT_PX,
  ROUGH_DRIFT_CAP,
  ROUGH_FILL_SHARE,
  ROUGH_HANDLE_STRETCH,
  ROUGH_HANDLE_TURN_DEGREES,
  ROUGH_JOIN_DRIFT,
  ROUGH_OVERSHOOT_CAP,
  ROUGH_OVERSHOOT_WIDTHS,
  ROUGH_SECOND_PASS_OPACITY,
  ROUGH_SECOND_PASS_WIDTH,
  ROUGH_WAVELENGTH_PX,
  hash32,
} from '../src/core/script/rough.js';
import { KAPPA } from '../src/core/path-data.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import type { Stroke, VectorAnchor } from '../src/core/types.js';

type P = { x: number; y: number };

const TIME = '2026-09-25T00:00:00.000Z';

function run(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME, ...options });
}

function clean(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  const result = run(text, options);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const marks = (result: ScriptResult): Stroke[] => result.book.sketches[0].strokes;
const anchorsOf = (stroke: Stroke): VectorAnchor[] => stroke.vector!.anchors;
const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);
const codes = (result: ScriptResult): string[] => result.diagnostics.map((d) => d.code);

test('the measured constants are the ones the contact sheet settled on', () => {
  assert.deepEqual(
    {
      ROUGH_ANCHOR_DRIFT_PX,
      ROUGH_BOW_PER_ROOT_PX,
      ROUGH_HANDLE_STRETCH,
      ROUGH_HANDLE_TURN_DEGREES,
      ROUGH_WAVELENGTH_PX,
      ROUGH_OVERSHOOT_WIDTHS,
      ROUGH_DRIFT_CAP,
      ROUGH_SECOND_PASS_WIDTH,
      ROUGH_SECOND_PASS_OPACITY,
      ROUGH_FILL_SHARE,
      ROUGH_JOIN_DRIFT,
      ROUGH_OVERSHOOT_CAP,
    },
    {
      ROUGH_ANCHOR_DRIFT_PX: 5,
      ROUGH_BOW_PER_ROOT_PX: 0.57,
      ROUGH_HANDLE_STRETCH: 0.2,
      ROUGH_HANDLE_TURN_DEGREES: 6,
      ROUGH_WAVELENGTH_PX: 80,
      ROUGH_OVERSHOOT_WIDTHS: 1.5,
      ROUGH_DRIFT_CAP: 0.15,
      ROUGH_SECOND_PASS_WIDTH: 0.6,
      ROUGH_SECOND_PASS_OPACITY: 0.55,
      ROUGH_FILL_SHARE: 0.5,
      ROUGH_JOIN_DRIFT: 0.6,
      ROUGH_OVERSHOOT_CAP: 0.25,
    },
    'a change here is a recalibration: redraw the contact sheet first',
  );
});

test('rough 0 is exact, and rough off turns the pass off again', () => {
  const exact = marks(clean('fill #ffe08a\nrect 10 10 100 60\ncircle 200 100 40'));
  assert.deepEqual(marks(clean('rough 0 passes 2\nfill #ffe08a\nrect 10 10 100 60\ncircle 200 100 40')), exact);
  assert.deepEqual(marks(clean('rough 0.8\nrough off\nfill #ffe08a\nrect 10 10 100 60\ncircle 200 100 40')), exact);
  // A group keeps its rough to itself, as it keeps the rest of the paint.
  const grouped = marks(clean('group "g" {\n  rough 1\n}\nfill #ffe08a\nrect 10 10 100 60\ncircle 200 100 40'));
  assert.deepEqual(grouped.map(anchorsOf), exact.map(anchorsOf));
});

test('one script and one seed draw the same bytes every run, and another seed draws differently', () => {
  const script = 'seed 7\nrough 0.8 passes 2\nfill #c0e0ff\ncircle 100 100 50\nrect 200 40 120 80 r 12\nline 20 200 300 220\nshape "star" at 340 40 size 90';
  // The book itself, since saving one stamps the time it was saved.
  const bytes = (result: ScriptResult): string => JSON.stringify(result.book);
  const once = bytes(clean(script));
  assert.equal(bytes(clean(script)), once);
  assert.notEqual(bytes(clean(script.replace('seed 7', 'seed 8'))), once);
  // The option seeds a run that names no seed, and an instruction overrides it.
  const bare = script.replace('seed 7\n', '');
  assert.equal(bytes(clean(bare, { seed: 7 })), once);
  assert.equal(bytes(clean(script, { seed: 99 })), once);
  assert.equal(clean(script).seed, 7);
  // What is saved loads back as the same drawing, field for field.
  const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  assert.deepEqual(json(parseSketchBook(serializeSketchBook(clean(script).book)).sketches), json(clean(script).book.sketches));
});

test("editing one mark leaves every other mark's wobble as it was", () => {
  const before = marks(clean('rough 1\nrect 10 10 100 100\ncircle 300 300 50'));
  const after = marks(clean('rough 1\nline 0 0 50 50\nrect 10 10 100 100\ncircle 300 300 50\nstar 500 100 60 25 5'));
  assert.deepEqual(after.slice(1, 3).map(anchorsOf), before.map(anchorsOf));
  // The same shape drawn again wobbles anew, so a repeat does not stack identical copies.
  const twice = marks(clean('rough 1\nrepeat 2 {\n  circle 100 100 40\n}'));
  assert.notDeepEqual(anchorsOf(twice[0]), anchorsOf(twice[1]));
});

test('the wobble is measured on the page: a scaled shape wobbles as far as one drawn at that size', () => {
  const scaled = marks(clean('rough 1 overshoot 0\nscale 4\ncircle 25 25 10'));
  const drawn = marks(clean('rough 1 overshoot 0\ncircle 100 100 40'));
  assert.deepEqual(anchorsOf(scaled[0]), anchorsOf(drawn[0]));
});

test("a rough circle's anchors stay within the drift of the exact ones, and its joins stay smooth", () => {
  const exact = anchorsOf(marks(clean('circle 100 100 60'))[0]);
  for (const amount of [0.3, 0.6, 1]) {
    for (let seed = 1; seed <= 20; seed++) {
      const [mark] = marks(clean(`seed ${seed}\nrough ${amount} overshoot 0\ncircle 100 100 60`));
      const anchors = anchorsOf(mark);
      assert.equal(mark.vector!.closed, true, 'with no overshoot a closed line stays closed');
      assert.equal(anchors.length, 4);
      anchors.forEach((a, k) => {
        assert.ok(dist(a.p, exact[k].p) <= amount * ROUGH_ANCHOR_DRIFT_PX + 1e-9, `anchor ${k} drifted too far`);
        // Both handles turned alike and stretched alike: still opposite each other, so the join stays smooth.
        const out = { x: a.hOut!.x - a.p.x, y: a.hOut!.y - a.p.y };
        const back = { x: a.p.x - a.hIn!.x, y: a.p.y - a.hIn!.y };
        assert.ok(Math.abs(out.x * back.y - out.y * back.x) < 1e-6 * Math.hypot(out.x, out.y) * Math.hypot(back.x, back.y));
        const length = Math.hypot(out.x, out.y);
        const exactLength = KAPPA * 60;
        assert.ok(Math.abs(length - exactLength) <= amount * ROUGH_HANDLE_STRETCH * exactLength + 1e-9, 'stretched too far');
        const exactOut = { x: exact[k].hOut!.x - exact[k].p.x, y: exact[k].hOut!.y - exact[k].p.y };
        const turn = Math.abs(Math.atan2(out.x * exactOut.y - out.y * exactOut.x, out.x * exactOut.x + out.y * exactOut.y)) * (180 / Math.PI);
        assert.ok(turn <= amount * ROUGH_HANDLE_TURN_DEGREES + 1e-6, `turned ${turn} degrees`);
      });
    }
  }
});

test('drift is held to a share of the distance to the neighbouring anchors, so a small shape keeps its outline', () => {
  const exact = anchorsOf(marks(clean('circle 50 50 4'))[0]);
  const spacing = dist(exact[0].p, exact[1].p);
  for (let seed = 1; seed <= 20; seed++) {
    const anchors = anchorsOf(marks(clean(`seed ${seed}\nrough 1 overshoot 0\ncircle 50 50 4`))[0]);
    anchors.forEach((a, k) => assert.ok(dist(a.p, exact[k].p) <= ROUGH_DRIFT_CAP * spacing + 1e-9, `seed ${seed} anchor ${k}`));
  }
});

test('a straight segment bows at its thirds, by the square root of its length', () => {
  // A horizontal line: its handles move with their anchors, so a handle's height above its own anchor is the bow.
  const bows = (length: number): number[] => {
    const out: number[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const [a, b] = anchorsOf(marks(clean(`seed ${seed}\nrough 1 overshoot 0\nline 0 0 ${length} 0`))[0]);
      const reach = ROUGH_BOW_PER_ROOT_PX * Math.sqrt(length);
      for (const bow of [a.hOut!.y - a.p.y, b.hIn!.y - b.p.y]) {
        assert.ok(Math.abs(bow) <= reach + 1e-9, `a bow of ${bow} past its reach of ${reach}`);
        out.push(Math.abs(bow));
      }
      assert.ok(Math.abs(a.hOut!.x - a.p.x - length / 3) < 1e-9, 'the first handle a third of the way along');
      assert.ok(Math.abs(b.p.x - b.hIn!.x - length / 3) < 1e-9, 'the second a third from the end');
    }
    return out;
  };
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
  const ratio = mean(bows(400)) / mean(bows(100));
  assert.ok(ratio > 1.6 && ratio < 2.5, `four times the length bowed ${ratio.toFixed(2)} times as far, not about twice`);
});

test('a closed line opens at its start and runs on past it, and overshoot 0 keeps it closed', () => {
  const [open] = marks(clean('seed 3\nrough 0.6\ncircle 100 100 50'));
  const anchors = anchorsOf(open);
  assert.equal(open.vector!.closed, undefined, 'the line is open');
  assert.equal(anchors.length, 5, 'one anchor more, past the start');
  assert.equal(anchors[0].hIn, undefined, 'the start has nothing coming into it');
  const [shut] = marks(clean('seed 3\nrough 0.6 overshoot 0\ncircle 100 100 50'));
  const start = anchorsOf(shut)[0];
  const end = anchors[4];
  // The same wobble, then carried on along the tangent the line leaves by.
  assert.deepEqual(anchors.slice(1, 4), anchorsOf(shut).slice(1, 4));
  const run = 0.6 * ROUGH_OVERSHOOT_WIDTHS * 3;
  const joinCap = ROUGH_DRIFT_CAP * dist(start.p, anchorsOf(shut)[1].p);
  assert.ok(dist(end.p, start.p) <= run + joinCap + 1e-9);
  assert.ok(dist(end.p, start.p) >= run - joinCap - 1e-9);
  const tangent = { x: start.hOut!.x - start.p.x, y: start.hOut!.y - start.p.y };
  const along = ((end.p.x - start.p.x) * tangent.x + (end.p.y - start.p.y) * tangent.y) / Math.hypot(tangent.x, tangent.y);
  assert.ok(along > 0, 'it runs on the way the line left');
});

test('an open line runs past both ends along its tangents, never more than a share of the end segment', () => {
  const [plain] = marks(clean('seed 5\nrough 1 overshoot 0\nline 0 0 200 0'));
  const [over] = marks(clean('seed 5\nrough 1 overshoot 6\nline 0 0 200 0'));
  const [p0, p1] = anchorsOf(plain);
  const [o0, o1] = anchorsOf(over);
  assert.ok(Math.abs(dist(o0.p, p0.p) - 6) < 1e-9 && Math.abs(dist(o1.p, p1.p) - 6) < 1e-9);
  // The ends move with their handles, so the line leaves and arrives the way it did.
  assert.deepEqual([o0.hOut!.x - o0.p.x, o0.hOut!.y - o0.p.y], [p0.hOut!.x - p0.p.x, p0.hOut!.y - p0.p.y]);
  // The default is one and a half widths at rough 1, and the width is the one on the page.
  const [wide] = marks(clean('seed 5\nrough 1\nwidth 4\nline 0 0 200 0'));
  assert.ok(Math.abs(dist(anchorsOf(wide)[0].p, p0.p) - 6) < 1e-9);
  // A short line runs on no further than a quarter of itself, as drawn.
  const [short] = marks(clean('seed 5\nrough 1 overshoot 0\nline 0 0 8 0'));
  const [shortOver] = marks(clean('seed 5\nrough 1 overshoot 6\nline 0 0 8 0'));
  const [s0, s1] = anchorsOf(short);
  const ran = dist(anchorsOf(shortOver)[0].p, s0.p);
  assert.ok(Math.abs(ran - ROUGH_OVERSHOOT_CAP * dist(s0.p, s1.p)) < 1e-9, `ran on ${ran}`);
});

test('a filled and outlined closed shape is drawn as its fill and then its line', () => {
  const [fill, line] = marks(clean('rough 0.6\nfill #ffe08a\nrect 0 0 100 100'));
  assert.deepEqual([fill.fill, fill.noStroke, fill.vector!.closed], ['#ffe08a', true, true]);
  assert.deepEqual([line.fill, line.noStroke, line.vector!.closed], [undefined, undefined, undefined]);
  // The fill is roughened half as much as the line, on a stream of its own.
  const corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  anchorsOf(fill).forEach((a, k) => assert.ok(dist(a.p, corners[k]) <= 0.6 * ROUGH_FILL_SHARE * ROUGH_ANCHOR_DRIFT_PX + 1e-9));
  // With no line the fill is all there is, roughened fully and still closed.
  const alone = marks(clean('rough 0.6\nstroke off\nfill #ffe08a\nrect 0 0 100 100'));
  assert.equal(alone.length, 1);
  assert.deepEqual([alone[0].fill, alone[0].noStroke, alone[0].vector!.closed], ['#ffe08a', true, true]);
  // A gradient is a fill like any other.
  const graded = marks(clean('rough 0.6\ngradient linear 90 (red 0, blue 1)\ncircle 50 50 40'));
  assert.deepEqual([Boolean(graded[0].gradient), graded[0].noStroke, Boolean(graded[1].gradient)], [true, true, false]);
});

test('a second pass restates the line, thinner and lighter, and never the fill', () => {
  const drawn = marks(clean('rough 1 passes 2\nopacity 0.8\nfill #ffe08a\nrect 0 0 100 100\nfill none\nline 0 150 200 150'));
  assert.equal(drawn.length, 5, 'fill, line and restatement, then a line and its restatement');
  const [, line, restate, open, again] = drawn;
  // 3 px at 0.6 of the width, and 0.8 at 0.55 of the opacity, as written to the file.
  assert.deepEqual([restate.width, restate.opacity, restate.fill], [1.8, 0.44, undefined]);
  assert.deepEqual([line.width, line.opacity], [3, 0.8]);
  assert.notDeepEqual(anchorsOf(again), anchorsOf(open), 'the second pass has a wobble of its own');
  // A mark with no line has nothing to restate.
  assert.equal(marks(clean('rough 1 passes 2\nstroke off\nfill red\nrect 0 0 10 10')).length, 1);
});

test('every kind of mark goes through the pass, and the budget counts what it draws', () => {
  const result = clean(
    'seed 2\nrough 0.7\nfill white\nshape "cube-isometric" at 0 0 size 120\nfill none\nthrough 0 200, 60 150, 120 200\npolygon 200 0, 300 0, 250 80 r 8\npath "M300 100 C340 60 380 140 420 100"',
  );
  const exact = clean(
    'fill white\nshape "cube-isometric" at 0 0 size 120\nfill none\nthrough 0 200, 60 150, 120 200\npolygon 200 0, 300 0, 250 80 r 8\npath "M300 100 C340 60 380 140 420 100"',
  );
  assert.ok(marks(result).length > marks(exact).length, 'the cube\'s filled faces each became a fill and a line');
  assert.equal(result.stats.marks, marks(result).length);
  assert.equal(
    result.stats.anchors,
    marks(result).reduce((sum, m) => sum + anchorsOf(m).length, 0),
  );
  assert.equal(
    result.stats.points,
    marks(result).reduce((sum, m) => sum + m.points.length, 0),
  );
  // A shape's marks are drawn all together or not at all: the budget never stops a run halfway through one.
  const tight = run('rough 1 passes 2\nfill red\nrect 0 0 10 10', { limits: { marks: 2 } });
  assert.deepEqual([codes(tight), marks(tight).length], [['budget-exceeded'], 0]);
});

test('the noise is integer arithmetic, so a seed means the same wobble everywhere', () => {
  // Pinned values: a change to the hash changes every rough drawing ever made.
  assert.equal(hash32(0), 3821501998);
  assert.equal(hash32(7, 1, 2), 1348228069);
  // Whatever is given is folded to a 32-bit whole number first.
  assert.equal(hash32(-1, 2 ** 40, 3.7), hash32(-1, 0, 3));
});
