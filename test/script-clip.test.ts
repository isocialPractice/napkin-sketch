/**
 * The `clip` verb: a group whose content shows only inside the block's last
 * closed shape in paint order - the app's Make Clipping Mask - which paints
 * nothing while it clips; a plain group, with a warning, without one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, formatScript, renderBook, sketchToInstructions, type ScriptResult } from '../src/core/script/index.js';
import type { Sketch } from '../src/core/types.js';

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

const WINDOW = 'clip "Window" {\n  fill #27486d\n  rect 20 20 200 140\n  stroke off\n  circle 120 90 60\n}';

test('a clip block is a clip group, clipped by its last closed shape', () => {
  const result = clean(WINDOW);
  const group = page(result).layers.find((l) => l.group)!;
  assert.equal(group.name, 'Window');
  const circle = page(result).strokes[1];
  assert.equal(group.clip, circle.id, 'the circle, drawn last');
  assert.equal(page(result).strokes.length, 2, 'the clip mark is still a mark, for Release to show');
});

test('its name is Clip Group unless given, and the clip is the last closed shape in paint order', () => {
  const result = clean('clip {\n  circle 100 100 50\n  rect 0 0 200 200\n  line 0 0 10 10\n}');
  const group = page(result).layers.find((l) => l.group)!;
  assert.equal(group.name, 'Clip Group');
  assert.equal(group.clip, page(result).strokes[1].id, 'the rectangle: the line after it is open');
});

test('with no closed shape it is a plain group, and says so', () => {
  const result = run('clip {\n  line 0 0 100 100\n}');
  assert.deepEqual(codes(result), ['clip-open']);
  assert.equal(page(result).layers.find((l) => l.group)?.clip, undefined);
});

test('the SVG it draws clips the group, and a clip cannot go inside a wipe', () => {
  const [svg] = renderBook(clean(WINDOW).book, { format: 'svg' });
  assert.match(svg, /<clipPath id="clip-\d+"/);
  assert.match(svg, /<g id="Window"[^>]* clip-path="url\(#clip-\d+\)">/);
  assert.deepEqual(codes(run(`wipe in {\n${WINDOW}\n}`)), ['wipe-failed', 'misplaced-verb']);
});

test('the object form runs the same', () => {
  const json = evaluate(
    [
      { verb: 'napkin', version: 1 },
      {
        verb: 'clip',
        body: [
          { verb: 'rect', x: 20, y: 20, width: 200, height: 140 },
          { verb: 'circle', cx: 120, cy: 90, r: 60 },
        ],
      },
    ],
    { timestamp: TIME },
  );
  assert.deepEqual(json.diagnostics, []);
  assert.equal(page(json).layers.find((l) => l.group)?.clip, page(json).strokes[1].id);
});

test('the writer writes a clip group back as a clip block, which draws it back clipped', () => {
  const source = page(clean(WINDOW));
  const written = sketchToInstructions(source, { decimals: null });
  assert.deepEqual(written.notes, []);
  const text = formatScript(written.script);
  assert.match(text, /^clip "Window" \{$/m);
  const back = page(clean(text));
  const group = back.layers.find((l) => l.group)!;
  assert.equal(group.clip, back.strokes[1].id, 'clipped by the circle again');
});

test('a clip group a clip block cannot say is written as a plain group, with a note', () => {
  // Faded, the group has an opacity a `clip` takes none of.
  const source = page(clean(WINDOW));
  source.layers.find((l) => l.group)!.opacity = 0.5;
  const faded = sketchToInstructions(source, { decimals: null });
  assert.match(formatScript(faded.script), /^group "Window" opacity 0\.5 \{$/m);
  assert.deepEqual(faded.notes, ['1 clipping mask is written as a plain group: a `clip` block clips with the last closed shape it draws, and takes no opacity, hiding or lock.']);
  // Its clip mark below another closed shape: a `clip` would clip with that one.
  const under = page(clean(WINDOW));
  const group = under.layers.find((l) => l.group)!;
  group.clip = under.strokes[0].id;
  assert.equal(sketchToInstructions(under, { decimals: null }).notes.length, 1);
});
