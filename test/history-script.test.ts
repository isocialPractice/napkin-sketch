/**
 * Generate Script > From Session History (`src/core/script/history-script.ts`),
 * on sessions recorded through the store's own history hook.
 *
 * With every step ticked the script draws what the page holds now. Unticking
 * a step gives the drawing as it would be had that step not happened: a
 * removal left out brings its mark back, an addition left out drops its mark
 * and every change to it, and a change left out takes back only the
 * properties it changed, so a later step's own change stays. A mark drawn
 * before the history began is written only when a ticked step changed it.
 * Layers are made, renamed and kept the same way. The steps' comments come in
 * step order, each before the first mark its step drew, and the header says
 * where the script came from and which steps it left out. Every script reads
 * and runs clean, comments inside a group's block included.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatScript, historyScript, sketchToInstructions, type HistoryScriptStep } from '../src/core/script/index.js';
import { scriptFromHistory } from '../src/core/script/generate.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { createSketchBook, type Sketch, type Stroke } from '../src/core/types.js';
import { Store, type HistoryStep, type ImportedLayerNode } from '../src/renderer/store.js';

const TIMESTAMP = '2026-09-26T00:00:00.000Z';

function line(id: string, y: number, extra: Partial<Stroke> = {}): Stroke {
  return { id, tool: 'pen', color: '#1f2328', width: 3, points: [{ x: 20, y }, { x: 120, y }], ...extra };
}

/** A store whose history is recorded as the popup lists it, one row per step, 1-based. */
function session(): { store: Store; steps: () => HistoryScriptStep[] } {
  const store = new Store(createSketchBook('history'));
  const heard: HistoryStep[] = [];
  store.onHistory((event) => {
    if (event.type === 'step') heard.push(event.step);
  });
  const steps = (): HistoryScriptStep[] => {
    store.flushHistoryStep();
    return heard.map((step, i) => ({
      index: i + 1,
      at: `2026-09-26T12:${String(i).padStart(2, '0')}:00.000Z`,
      page: step.page,
      type: step.kind === 'edit' ? 'Draw:Add:mark' : 'Composition:edit',
      label: step.kind === 'edit' ? `step ${i + 1}` : step.kind,
      diff: step.diff,
    }));
  };
  return { store, steps };
}

/** A script run clean: its page. */
function run(text: string, label: string): Sketch {
  const result = evaluate(text, { timestamp: TIMESTAMP });
  assert.deepEqual(result.diagnostics, [], `${label}: the script runs clean`);
  return result.book.sketches[0];
}

/** The page as the writer draws it, so a replay and the page itself are drawn by the same hand. */
function drawn(page: Sketch): string {
  return sketchToSvg(run(formatScript(sketchToInstructions(page, { decimals: null }).script), 'the page'));
}

/** The step numbers of the step comments, in the order the text has them. */
function blockOrder(text: string): number[] {
  return [...text.matchAll(/^\s*# (\d+) {2}/gm)].map((m) => Number(m[1]));
}

test('every step ticked draws the page as it is now, the comments in step order', () => {
  const { store, steps } = session();
  store.addStroke(line('s1', 20)); // 1
  store.addStroke(line('s2', 60)); // 2: on a layer of its own
  store.moveStrokes(['s1'], 30, 0); // 3
  store.setStrokeProps(['s2'], { color: '#c0392b' }); // 4
  store.setSelection(['s2']);
  store.deleteSelected(); // 5
  store.undo(); // 6: s2 is back
  const recorded = steps();
  assert.equal(recorded.length, 6);
  const written = historyScript(recorded, store.sketch, { decimals: null });
  assert.equal(sketchToSvg(run(written.text, 'every step')), drawn(store.sketch));
  assert.deepEqual(blockOrder(written.text), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([written.included, written.excluded], [[1, 2, 3, 4, 5, 6], []]);
  assert.equal(written.stats.marks, 2);
  assert.match(written.text, /^# 3 {2}Draw:Add:mark {2}step 3 {2}\(2026-09-26 12:02\)\n# modified mark from step 1$/m, 'a change says whose mark it changed');
  // Deleting the only mark on a layer takes the layer too, and the undo brings both back.
  assert.match(written.text, /^# 5 .*\n# removed layer "Brush 1"\n# removed mark from step 2$/m);
  assert.match(written.text, /^# 6 {2}Composition:edit {2}undo .*\n# brought back layer "Brush 1"\n# brought back mark from step 2$/m);
  assert.match(written.text, /^# 2 .*\n# added layer "Brush 1"\nlayer "Brush 1"$/m, 'a layer is made after the comment of the step that made it');
  assert.doesNotMatch(written.text, /removed in step/, 'nothing stayed removed');
});

test('a removal left out brings its mark back, and the step that drew it says nothing of it', () => {
  const { store, steps } = session();
  store.addStroke(line('s1', 20));
  store.addStroke(line('s2', 60));
  store.setSelection(['s2']);
  store.deleteSelected(); // 3
  const all = historyScript(steps(), store.sketch, { decimals: null });
  assert.equal(run(all.text, 'all').strokes.length, 1);
  assert.match(all.text, /^# 2 .*\n# added layer "Brush 1"\n# removed in step 3$/m, 'the step that drew it says where it went');

  const kept = historyScript(steps(), store.sketch, { decimals: null, include: new Set([1, 2]) });
  assert.equal(run(kept.text, 'without 3').strokes.length, 2, 'the mark is back');
  assert.doesNotMatch(kept.text, /removed in step/);
  assert.match(kept.text, /^# 2 steps of 3; left out: 3\.$/m);
});

test('an addition left out drops its mark and the changes to it', () => {
  const { store, steps } = session();
  store.addStroke(line('s1', 20)); // 1
  store.moveStrokes(['s1'], 10, 0); // 2
  const written = historyScript(steps(), store.sketch, { include: new Set([2]) });
  assert.equal(run(written.text, 'without 1').strokes.length, 0);
  assert.equal(written.stats.marks, 0);
  assert.match(written.text, /^# 2 .*\n# changed a mark from a step that is left out$/m, 'the change still says what it was');
});

test('a change left out takes back only what it changed, and a later change keeps its own', () => {
  const { store, steps } = session();
  store.addStroke(line('s1', 20)); // 1
  store.setStrokeProps(['s1'], { color: '#c0392b' }); // 2
  store.moveStrokes(['s1'], 40, 0); // 3
  const page = run(historyScript(steps(), store.sketch, { decimals: null, include: new Set([1, 3]) }).text, 'without 2');
  assert.equal(page.strokes.length, 1);
  assert.equal(page.strokes[0].color, '#1f2328', 'the color change is left out');
  assert.equal(page.strokes[0].points[0].x, 60, 'the move is kept');
});

test('a mark drawn before the history began is written only when a ticked step changed it', () => {
  const { store, steps } = session();
  // A mark drawn before the history began: a new book starts the history, and the mark is already on it.
  const before = new Store(createSketchBook('history'));
  before.addStroke(line('old', 90));
  store.setBook(before.book, null);
  store.addStroke(line('s1', 20)); // 1
  store.moveStrokes(['old'], 0, 20); // 2
  const recorded = steps();
  const all = historyScript(recorded, store.sketch, { decimals: null });
  const page = run(all.text, 'all');
  assert.equal(page.strokes.length, 2, 'the changed mark is written, as the session left it');
  assert.ok(page.strokes.some((stroke) => stroke.points[0].y === 110));
  assert.match(all.text, /^# 1 mark drawn before the history began is written as the session left it, since a step changed it\.$/m);
  assert.match(all.text, /^# 2 .*\n# changed a mark drawn before the history began$/m);
  const only = run(historyScript(recorded, store.sketch, { include: new Set([1]) }).text, 'without 2');
  assert.equal(only.strokes.length, 1, 'without its change the old mark is not the session\'s');
});

test('layers are made and renamed by their steps, and a rename left out keeps the old name', () => {
  const { store, steps } = session();
  store.addLayer(); // 1: an empty layer the session made
  const made = store.activeLayer;
  store.setLayerProps(made.id, { name: 'Sky' }); // 2
  store.addStroke(line('s1', 20)); // 3: on the new layer, which it is empty
  const recorded = steps();
  const all = historyScript(recorded, store.sketch);
  assert.match(all.text, /^layer "Sky"$/m);
  assert.match(all.text, /^# 1 .*\n# added layer "Layer 2"$/m);
  assert.match(all.text, /^# 2 .*\n# renamed layer "Layer 2" to "Sky"$/m);
  assert.equal(run(all.text, 'all').layers.find((layer) => layer.name === 'Sky')?.name, 'Sky');
  const unnamed = historyScript(recorded, store.sketch, { include: new Set([1, 3]) });
  assert.match(unnamed.text, /^layer "Layer 2"$/m);
  assert.doesNotMatch(unnamed.text, /Sky/);
});

test('comments inside a group block run clean, and the header says where the script came from', () => {
  const { store, steps } = session();
  const tree: ImportedLayerNode[] = [
    {
      name: 'Figure',
      opacity: 1,
      strokes: [],
      children: [
        { name: 'Head', opacity: 1, strokes: [line('h', 20)] },
        { name: 'Arm', opacity: 1, strokes: [line('a', 60)] },
      ],
    },
  ];
  store.sketch.name = 'figure';
  store.addImportedLayers(tree); // 1
  const arm = store.sketch.strokes[1].id;
  store.moveStrokes([arm], 5, 5); // 2
  const written = scriptFromHistory(steps(), store.sketch, { version: '1.0.0-alpha.4.5.0', now: '2026-09-26T13:30:00.000Z', time: (iso) => iso.slice(11, 16) });
  const text = written.text;
  assert.ok(text.startsWith('# Written by napkin-sketch 1.0.0-alpha.4.5.0 from the session history of "figure", 13:30.\n# 2 steps, every one recorded on this page.\n'), text.slice(0, 160));
  assert.match(text, /^group "Figure" \{\n {2}# 1 {2}Draw:Add:mark {2}step 1 {2}\(12:00\)\n {2}# added layer "Head"/m, 'the first step\'s comment is inside the group, before its first mark');
  assert.equal(run(text, 'group').strokes.length, 2);
  assert.deepEqual([written.source, written.name], ['2 steps', 'figure-history']);
  assert.equal(written.stats.marks, 2);
});

test('a step that drew nothing says what it did before the next step that did', () => {
  const { store, steps } = session();
  store.addStroke(line('s1', 20)); // 1
  store.moveStrokes(['s1'], 10, 0); // 2: draws nothing of its own
  store.addStroke(line('s2', 60)); // 3
  const text = historyScript(steps(), store.sketch).text;
  assert.deepEqual(blockOrder(text), [1, 2, 3]);
  const two = text.indexOf('# 2  ');
  const three = text.indexOf('# 3  ');
  const firstPath = text.indexOf('path {');
  assert.ok(firstPath < two && two < three, 'step 2 waits for step 3, after the mark step 1 drew');
});
