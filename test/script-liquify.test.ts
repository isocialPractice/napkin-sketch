/**
 * The Liquify verbs - `warp`, `twirl`, `pucker` and `bloat`: one of the app's
 * brushes pressed once on the marks drawn so far (src/core/liquify.ts) - a
 * rectangle's side dented, a line's ends turned, a circle's side pushed out
 * and a rectangle drawn in, under the line's transform and a mirror, among a
 * wipe's marks, and what they say when they reach nothing they bend.
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
const xs = (stroke: Stroke): number[] => stroke.points.map((p) => p.x);
const ys = (stroke: Stroke): number[] => stroke.points.map((p) => p.y);

test("warp dents a rectangle's top side, and leaves its corners where they were", () => {
  const [rect] = marks(clean('rect 40 40 160 100\nwarp 120 40 30 0 24'));
  const middle = rect.points.filter((p) => p.x > 110 && p.x < 130);
  assert.ok(Math.max(...middle.map((p) => p.y)) > 60, `the top's middle went to ${Math.max(...middle.map((p) => p.y))}`);
  const corners = rect.vector!.anchors.map((a) => `${Math.round(a.p.x * 100) / 100},${Math.round(a.p.y * 100) / 100}`);
  for (const corner of ['40,40', '200,40', '200,140', '40,140']) assert.ok(corners.includes(corner), `${corner} in ${corners.join(' ')}`);
  assert.equal(rect.vector!.closed, true);
});

test("twirl turns a line's ends about the brush's centre, clockwise, keeping their distance", () => {
  const [line] = marks(clean('line 60 100 180 100\ntwirl 120 100 70 90'));
  const anchors = line.vector!.anchors;
  const first = anchors[0].p;
  const last = anchors[anchors.length - 1].p;
  // 60 from the centre, the falloff there is (1 - (60/70)²)²: a turn of about 6.3 degrees.
  const turn = (90 * (1 - (60 / 70) ** 2) ** 2 * Math.PI) / 180;
  assert.ok(Math.abs(last.x - (120 + 60 * Math.cos(turn))) < 0.01 && Math.abs(last.y - (100 + 60 * Math.sin(turn))) < 0.01, JSON.stringify(last));
  assert.ok(Math.abs(first.x - (120 - 60 * Math.cos(turn))) < 0.01 && Math.abs(first.y - (100 - 60 * Math.sin(turn))) < 0.01, JSON.stringify(first));
});

test('bloat pushes the side of a circle in its brush out, and pucker draws a rectangle in', () => {
  const plain = marks(clean('circle 120 100 50'))[0];
  const [bloated] = marks(clean('circle 120 100 50\nbloat 150 100 40 0.5'));
  assert.ok(Math.max(...xs(bloated)) > Math.max(...xs(plain)) + 3, `${Math.max(...xs(plain))} to ${Math.max(...xs(bloated))}`);
  assert.ok(Math.abs(Math.min(...xs(bloated)) - Math.min(...xs(plain))) < 0.6, 'the far side stays');
  assert.ok(bloated.vector!.anchors.length <= 12, `${bloated.vector!.anchors.length} anchors`);
  const [puckered] = marks(clean('rect 40 40 160 120\npucker 120 100 90 0.6'));
  const top = puckered.points.filter((p) => p.x > 110 && p.x < 130);
  assert.ok(Math.max(...top.filter((p) => p.y < 100).map((p) => p.y)) > 48, 'the top side is drawn in toward the centre');
});

test("the brush goes where the line's transform puts it, and a mirror turns a twirl the other way", () => {
  const [scaled] = marks(clean('scale 2\nline 10 50 90 50\nwarp 50 50 20 0 10'));
  assert.ok(Math.abs(Math.max(...ys(scaled)) - 120) < 1, `the middle went to ${Math.max(...ys(scaled))}: pushed 20 on the page, from 100`);
  const plain = marks(clean('line 60 100 180 100\ntwirl 120 100 70 90'))[0];
  const mirrored = marks(clean('scale -1 1 at 120 100\nline 60 100 180 100\ntwirl 120 100 70 90'))[0];
  // The mirror of a turned line, turned in the mirror: the same picture, flipped about x = 120.
  const flip = (s: Stroke): string[] =>
    s.vector!.anchors.map((a) => `${Math.round((240 - a.p.x) * 100) / 100},${Math.round(a.p.y * 100) / 100}`).sort();
  const same = (s: Stroke): string[] => s.vector!.anchors.map((a) => `${Math.round(a.p.x * 100) / 100},${Math.round(a.p.y * 100) / 100}`).sort();
  assert.deepEqual(flip(mirrored), same(plain));
});

test("pencil marks are left to the Smear, and a brush reaching nothing it bends says so", () => {
  const pencil = run('pencil HB\nline 60 100 180 100\nbloat 120 100 70 0.5');
  assert.deepEqual(codes(pencil), ['liquify-missed']);
  const line = marks(pencil)[0];
  assert.equal(line.tool, 'pencil');
  assert.ok(line.points.every((p) => p.y === 100) && (line.vector?.anchors.every((a) => a.p.y === 100) ?? true), 'the pencil line is not bent');
  const nothing = run('line 0 0 20 0\ntwirl 300 300 40 45');
  assert.deepEqual(codes(nothing), ['liquify-missed']);
  assert.match(formatDiagnostic(nothing.diagnostics[0]), /`twirl` at \(300, 300\) reached no mark drawn so far/);
});

test("in a wipe block the brush bends among the block's marks, before they are combined", () => {
  const plain = marks(clean('wipe in {\n  rect 20 20 100 100\n  rect 80 80 100 100\n}'));
  const bent = marks(clean('wipe in {\n  rect 20 20 100 100\n  rect 80 80 100 100\n  bloat 110 50 30 0.5\n}'));
  assert.equal(bent.length, 1, 'one shape of their union');
  const bulge = (s: Stroke[]): number => Math.max(...s.flatMap((m) => m.points.filter((p) => p.y > 30 && p.y < 70).map((p) => p.x)));
  assert.ok(bulge(bent) > bulge(plain) + 2, `the first square's right side, beside the brush, went from ${bulge(plain)} to ${bulge(bent)}`);
});
