/**
 * Track History's recorder: the store's history hook, the names a step is
 * given, and the bounded list that keeps them.
 *
 * The store closes a step at the next history boundary, so an edit that
 * saved the page and then changed it without history - a drag - is one step
 * holding where it ended, as it is one undo. A transaction is one step on
 * commit and none on rollback; an undo and a redo are steps of their own; a
 * step that changed nothing is not heard; a page change closes the step on
 * the page it belongs to; and a new book says the history starts again.
 * Commands name the steps begun inside them, innermost first. With no
 * listener the store keeps nothing.
 *
 * Steps are named from the real menu files: a press on the canvas by its
 * tool ("Brush stroke"), a command by its row, and a step nothing named by what
 * it changed. The list keeps the newest steps to its limit and never reuses
 * an index until a new document clears it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, type SnapshotDiff } from '../src/core/history-diff.js';
import { defaultRegistry } from '../src/core/menu/registry.js';
import { createSketchBook, type Layer, type Stroke } from '../src/core/types.js';
import { describeStep, formatBytes, historyUsage, HistoryTracker, type CommandInfo } from '../src/renderer/history-tracker.js';
import { Store, type HistoryEvent, type HistoryStep } from '../src/renderer/store.js';

const REGISTRY = defaultRegistry();
const lookup = (id: string): CommandInfo | null => {
  const tool = REGISTRY.tool(id);
  return tool ? { type: tool.type, name: tool.name } : null;
};

function mark(id: string, layer?: string, tool: Stroke['tool'] = 'pen'): Stroke {
  return { id, tool, color: '#1f2328', width: 3, ...(layer ? { layer } : {}), points: [{ x: 10, y: 10 }, { x: 60, y: 40 }] };
}

/** A store with one listener, and the events it heard. */
function listening(): { store: Store; events: HistoryEvent[]; steps: () => HistoryStep[] } {
  const store = new Store(createSketchBook('t'));
  const events: HistoryEvent[] = [];
  store.onHistory((event) => events.push(event));
  const steps = (): HistoryStep[] => {
    store.flushHistoryStep();
    return events.flatMap((event) => (event.type === 'step' ? [event.step] : []));
  };
  return { store, events, steps };
}

function step(diff: SnapshotDiff, command: string | null, kind: HistoryStep['kind'] = 'edit'): HistoryStep {
  return { kind, page: 0, at: '2026-09-26T12:00:00.000Z', command, diff };
}

const EMPTY: SnapshotDiff = { added: [], removed: [], changed: [], was: {}, layers: [] };

// ---- The store's hook ----------------------------------------------------------------------------

test('a move with history is one step with one changed mark, named by the command running', () => {
  const { store, steps } = listening();
  store.addStroke(mark('s1'));
  const end = store.beginCommand('move-selection');
  store.moveStrokes(['s1'], 5, 7);
  end();
  const [add, move] = steps();
  assert.equal(add.command, null, 'nothing named the first');
  assert.deepEqual(add.diff.added.map((s) => s.id), ['s1']);
  assert.equal(move.kind, 'edit');
  assert.equal(move.command, 'move-selection');
  assert.deepEqual(move.diff.changed.map((s) => [s.id, s.points[0].x, s.points[0].y]), [['s1', 15, 17]]);
  assert.deepEqual([move.diff.added, move.diff.removed, move.diff.layers], [[], [], []]);
  assert.equal(steps().length, 2, 'reading again adds nothing');
});

test('a drag that saves the page once and moves on without history is one step, holding where it ended', () => {
  const { store, steps } = listening();
  store.addStroke(mark('s1'));
  store.flushHistoryStep();
  const before = steps().length;
  store.pushHistory();
  for (let i = 0; i < 5; i++) store.moveStrokes(['s1'], 2, 0, false);
  const recorded = steps().slice(before);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].diff.changed[0].points[0].x, 20);
});

test('a transaction is one step when it is kept and none when it is thrown away', () => {
  const { store, steps } = listening();
  store.addStroke(mark('s1'));
  const kept = steps().length;
  const end = store.beginCommand('mirror');
  store.beginTransaction();
  end();
  // The name is the one running when the transaction began, not when it ends.
  store.moveStrokes(['s1'], 10, 0, false);
  store.commitTransaction();
  const afterCommit = steps();
  assert.equal(afterCommit.length, kept + 1);
  assert.equal(afterCommit[afterCommit.length - 1].command, 'mirror');

  store.beginTransaction();
  store.moveStrokes(['s1'], 10, 0, false);
  store.rollbackTransaction();
  assert.equal(steps().length, kept + 1, 'a rollback leaves no step');
});

test('undo and redo are steps of their own, each the change it made', () => {
  const { store, steps } = listening();
  store.addStroke(mark('s1'));
  store.undo();
  store.redo();
  const [draw, undo, redo] = steps();
  assert.deepEqual([draw.kind, undo.kind, redo.kind], ['edit', 'undo', 'redo']);
  assert.deepEqual(undo.diff.removed.map((s) => s.id), ['s1']);
  assert.deepEqual(redo.diff.added.map((s) => s.id), ['s1']);
});

test('a step that changed nothing is not heard', () => {
  const { store, steps } = listening();
  store.pushHistory();
  assert.equal(steps().length, 0);
  // A layer move with nowhere to go takes its step back.
  store.moveLayers([store.sketch.layers[0].id], -1);
  assert.equal(steps().length, 0);
});

test('a page change closes the step on the page it happened on', () => {
  const { store, steps } = listening();
  store.addStroke(mark('s1'));
  store.addPage();
  store.addStroke(mark('s2'));
  store.goToPage(0);
  const recorded = steps();
  assert.deepEqual(recorded.map((s) => [s.page, s.diff.added[0]?.id]), [[0, 's1'], [1, 's2']]);
});

test('a new book says the history starts again', () => {
  const { store, events } = listening();
  store.addStroke(mark('s1'));
  store.setBook(createSketchBook('other'), null);
  assert.deepEqual(events.map((event) => event.type), ['step', 'reset'], 'the last step closes first');
});

test('commands name the steps begun inside them, the innermost first, and end in any order', () => {
  const store = new Store(createSketchBook('t'));
  assert.equal(store.currentCommand, null);
  const outer = store.beginCommand('import');
  const inner = store.beginCommand('tool:pen');
  assert.equal(store.currentCommand, 'tool:pen');
  outer(); // an async command finishing while a press is still down
  assert.equal(store.currentCommand, 'tool:pen');
  inner();
  inner();
  assert.equal(store.currentCommand, null, 'ending twice is harmless');
});

test('with no listener the store keeps no step, and one added later hears only what follows', () => {
  const store = new Store(createSketchBook('t'));
  store.addStroke(mark('s1'));
  const events: HistoryEvent[] = [];
  const stop = store.onHistory((event) => events.push(event));
  store.flushHistoryStep();
  assert.equal(events.length, 0, 'the step before listening was never kept');
  store.addStroke(mark('s2'));
  stop();
  store.flushHistoryStep();
  assert.equal(events.length, 0, 'stopping drops the step in progress');
});

test('a stroke that needs a layer of its own brings the layer in the same step', () => {
  const { store, steps } = listening();
  store.addStroke(mark('s1'));
  store.addStroke(mark('s2'));
  const second = steps()[1];
  assert.deepEqual(second.diff.added.map((s) => s.id), ['s2']);
  assert.deepEqual(second.diff.layers.map((change) => change.op), ['add']);
});

// ---- Names -------------------------------------------------------------------------------------------

test('a press on the canvas is named by its tool, as the menu files type it', () => {
  const pen = describeStep(step({ ...EMPTY, added: [mark('s1')] }, 'tool:pen'), lookup);
  assert.deepEqual(pen, { command: 'tool:pen', type: 'Draw:Add:mark', label: 'Brush stroke' });
  assert.deepEqual(describeStep(step(EMPTY, 'tool:eraser'), lookup), { command: 'tool:eraser', type: 'Draw:Subtract:mark', label: 'Eraser stroke' });
  assert.deepEqual(describeStep(step(EMPTY, 'tool:select'), lookup), { command: 'tool:select', type: 'Draw:Modify:element', label: 'Select' });
  assert.deepEqual(describeStep(step(EMPTY, 'tool:point'), lookup), { command: 'tool:point', type: 'Draw:Modify:vector', label: 'Direct Select' });
  assert.deepEqual(describeStep(step({ ...EMPTY, added: [mark('i', undefined, 'image')] }, 'tool:image'), lookup), {
    command: 'tool:image',
    type: 'Draw:Add:mark',
    label: 'Image',
  });
});

test('a command is named by its menu row, a submenu row by its own name and its menu type', () => {
  assert.deepEqual(describeStep(step(EMPTY, 'rotate'), lookup), { command: 'rotate', type: 'Draw:Modify:element', label: 'Rotate' });
  assert.deepEqual(describeStep(step(EMPTY, 'sharpen-selection'), lookup), {
    command: 'sharpen-selection',
    type: 'Draw:Modify:element',
    label: 'Sharpen Selection',
  });
  assert.deepEqual(describeStep(step(EMPTY, null, 'undo'), lookup), { command: 'undo', type: 'Composition:edit', label: 'Undo' });
  assert.deepEqual(describeStep(step(EMPTY, 'tool:pen', 'redo'), lookup), { command: 'redo', type: 'Composition:edit', label: 'Redo' });
});

test('a step nothing named is named by the tool of the marks it only added, or else by what it changed', () => {
  const layer: Layer = { id: 'ly', name: 'Text 1', opacity: 1, visible: true, locked: false };
  const text = describeStep(step({ ...EMPTY, added: [mark('t', 'ly', 'text')], layers: [{ op: 'add', layer, index: 1 }] }, null), lookup);
  assert.deepEqual(text, { command: 'tool:text', type: 'Draw:Add:mark', label: 'Text' });
  assert.deepEqual(describeStep(step({ ...EMPTY, changed: [mark('a'), mark('b')] }, null), lookup), {
    command: 'unknown',
    type: 'Draw:Modify:element',
    label: 'Changed 2 marks',
  });
  assert.deepEqual(describeStep(step({ ...EMPTY, removed: [mark('a')] }, null), lookup), {
    command: 'unknown',
    type: 'Composition:Subtract:element',
    label: 'Removed 1 mark',
  });
  assert.deepEqual(describeStep(step({ ...EMPTY, layers: [{ op: 'rename', id: 'x', from: 'A', to: 'B' }] }, null), lookup), {
    command: 'unknown',
    type: 'App:Modify:layer',
    label: 'Renamed 1 layer',
  });
  const mixed = describeStep(step({ ...EMPTY, added: [mark('a'), mark('b', undefined, 'marker')] }, 'no-such-command'), lookup);
  assert.deepEqual(mixed, { command: 'unknown', type: 'Draw:Add:mark', label: 'Added 2 marks' }, 'an id the menu files do not know');
});

// ---- The list ------------------------------------------------------------------------------------------

test('the list keeps the newest steps to its limit, and an index is never reused', () => {
  const tracker = new HistoryTracker(3);
  const recorded = [1, 2, 3, 4, 5].map((n) => tracker.pushStep(step({ ...EMPTY, added: [mark(`s${n}`)] }, 'tool:pen'), { command: 'tool:pen', type: 'Draw:Add:mark', label: 'Brush stroke' }));
  assert.deepEqual(recorded.map((s) => s.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(tracker.steps.map((s) => s.index), [3, 4, 5], 'the oldest go first');
  assert.equal(tracker.count, 3);
  tracker.setLimit(2);
  assert.deepEqual(tracker.steps.map((s) => s.index), [4, 5]);
  tracker.setLimit(10);
  assert.equal(tracker.count, 2, 'a larger limit brings nothing back');
  assert.equal(tracker.estimateBytes(), tracker.steps.reduce((sum, s) => sum + JSON.stringify(s.diff).length, 0));
  tracker.clear();
  assert.deepEqual([tracker.count, tracker.estimateBytes()], [0, 0]);
  const next = tracker.pushStep(step(EMPTY, null), { command: 'unknown', type: 'Draw:Modify:element', label: 'Changed the page' });
  assert.equal(next.index, 1, 'a new session counts from 1');
});

test('a recorded step carries the store step and its name', () => {
  const tracker = new HistoryTracker(500);
  const diff = diffSnapshots({ strokes: [], layers: [] }, { strokes: [mark('s1')], layers: [] });
  const recorded = tracker.pushStep({ ...step(diff, 'tool:pen'), page: 2 }, describeStep(step(diff, 'tool:pen'), lookup));
  assert.deepEqual(
    [recorded.page, recorded.kind, recorded.command, recorded.type, recorded.label, recorded.at],
    [2, 'edit', 'tool:pen', 'Draw:Add:mark', 'Brush stroke', '2026-09-26T12:00:00.000Z'],
  );
  assert.equal(recorded.bytes, JSON.stringify(diff).length);
});

test('the usage line says what the history holds', () => {
  assert.equal(historyUsage(null), 'The drawing window has not said how much history it holds yet.');
  assert.equal(historyUsage({ tracking: false, steps: 0, limit: 500, bytes: 0 }), 'Track History is off, so nothing is recorded.');
  assert.equal(historyUsage({ tracking: true, steps: 0, limit: 500, bytes: 0 }), 'Nothing recorded yet. The last 500 steps are kept.');
  assert.equal(historyUsage({ tracking: true, steps: 12, limit: 500, bytes: 35_000 }), '12 of 500 steps recorded, about 34.2 KB.');
  assert.deepEqual([formatBytes(1), formatBytes(900), formatBytes(2048), formatBytes(3 * 1024 * 1024)], ['1 byte', '900 bytes', '2.0 KB', '3.0 MB']);
});
