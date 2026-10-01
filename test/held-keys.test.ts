/**
 * Held keys: Space, Ctrl and Shift on the canvas. With no press under way
 * Space is the hand and Ctrl lends the last selection tool; mid-press Space
 * makes the freehand stroke straight, and Ctrl with it the quick curve. The
 * Copic nib-rotate keeps its hold as a still hold. A Shift press draws a line
 * on from point 1, the end of the last freehand mark. The GUI checks
 * `check-held-keys.mjs` and `check-lines.mjs` drive the same rules in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ctrlJoinsPress,
  drawsLines,
  isModifierKey,
  lineStartOf,
  NIB_HOLD_SLOP_PX,
  nibStep,
  samePaint,
  shiftLineAction,
  spaceAction,
  springsFrom,
  springStep,
  type InkPaint,
  type NibEvent,
  type NibState,
  type ShiftPress,
  type SpringEvent,
  type SpringState,
} from '../src/renderer/held-keys.js';
import { PRESS_KINDS } from '../src/renderer/press-state.js';
import type { Stroke, Tool } from '../src/core/types.js';

/** Runs spring events from `off`, returning each step's effect and the state at the end. */
function springRun(events: Array<SpringEvent | [SpringEvent, boolean]>): { state: SpringState; effects: Array<string | null> } {
  let state: SpringState = 'off';
  const effects: Array<string | null> = [];
  for (const item of events) {
    const [event, springs] = Array.isArray(item) ? item : [item, true];
    const step = springStep(state, event, springs);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

function nibRun(events: NibEvent[]): { state: NibState; effects: Array<string | null> } {
  let state: NibState = 'off';
  const effects: Array<string | null> = [];
  for (const event of events) {
    const step = nibStep(state, event);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

test('Ctrl lends the selection tool on every drawing tool, and not on the tools with a Ctrl of their own', () => {
  const springs: Tool[] = ['pen', 'marker', 'copic', 'eraser', 'text', 'rect', 'ellipse', 'curve', 'bucket', 'fill', 'eyedrop'];
  for (const tool of springs) assert.equal(springsFrom(tool), true, tool);
  for (const tool of ['select', 'point', 'vector', 'warp'] as Tool[]) assert.equal(springsFrom(tool), false, tool);
});

test('the modifiers never end a hold; every other key does', () => {
  for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']) assert.equal(isModifierKey(key), true, key);
  for (const key of [' ', 'z', 'Z', 'Escape', 'Enter', 'Delete', 'F5', '1']) assert.equal(isModifierKey(key), false, key);
});

test('Ctrl held alone brings the selection tool up after the delay, and Ctrl up gives the drawing tool back', () => {
  const run = springRun(['ctrl-down', 'timer', 'ctrl-up']);
  assert.deepEqual(run.effects, [null, 'show', 'hide']);
  assert.equal(run.state, 'off');
});

test('a move or a press brings the selection tool up at once', () => {
  assert.deepEqual(springRun(['ctrl-down', 'move']).effects, [null, 'show']);
  assert.deepEqual(springRun(['ctrl-down', 'press']).effects, [null, 'show']);
  // Once up, more moves and the timer change nothing.
  assert.deepEqual(springRun(['ctrl-down', 'move', 'move', 'timer']).effects, [null, 'show', null, null]);
});

test('a chord such as Ctrl+Z never shows the selection tool', () => {
  const run = springRun(['ctrl-down', 'other-key', 'timer', 'move', 'ctrl-up']);
  assert.deepEqual(run.effects, [null, null, null, null, null]);
  assert.equal(run.state, 'off');
});

test('a key after the selection tool came up gives the drawing tool back before the key runs', () => {
  assert.deepEqual(springRun(['ctrl-down', 'move', 'other-key']).effects, [null, 'show', 'hide']);
});

test('Ctrl on a tool that does not spring arms nothing', () => {
  const run = springRun([['ctrl-down', false], 'move', 'press', 'timer', 'ctrl-up']);
  assert.deepEqual(run.effects, [null, null, null, null, null]);
});

test('the nib-rotate taking the hold over, and a lost window, give the drawing tool back', () => {
  assert.deepEqual(springRun(['ctrl-down', 'timer', 'nib-on']).effects, [null, 'show', 'hide']);
  assert.deepEqual(springRun(['ctrl-down', 'move', 'blur']).effects, [null, 'show', 'hide']);
  assert.deepEqual(springRun(['ctrl-down', 'blur']).effects, [null, null]);
});

test('an auto-repeated Ctrl is no new hold', () => {
  const run = springRun(['ctrl-down', 'move', 'ctrl-down', 'ctrl-down']);
  assert.equal(run.state, 'on');
  assert.deepEqual(run.effects, [null, 'show', null, null]);
});

test('the nib-rotate comes on after a still hold, and its key coming up turns it off', () => {
  const run = nibRun([{ type: 'hold-down', arms: true }, { type: 'move', drift: NIB_HOLD_SLOP_PX }, { type: 'timer' }, { type: 'hold-up' }]);
  assert.deepEqual(run.effects, [null, null, 'start', 'end']);
  assert.equal(run.state, 'off');
});

test('drifting past the slop, a press or another key cancels a pending hold', () => {
  for (const cancel of [{ type: 'move', drift: NIB_HOLD_SLOP_PX + 0.5 }, { type: 'press' }, { type: 'other-key' }] as NibEvent[]) {
    const run = nibRun([{ type: 'hold-down', arms: true }, cancel, { type: 'timer' }]);
    assert.deepEqual(run.effects, [null, null, null], JSON.stringify(cancel));
    assert.equal(run.state, 'off');
  }
});

test('once on, the nib-rotate stays on through moves, presses and keys until its key comes up or the window goes', () => {
  const on: NibEvent[] = [{ type: 'hold-down', arms: true }, { type: 'timer' }];
  const run = nibRun([...on, { type: 'move', drift: 50 }, { type: 'press' }, { type: 'other-key' }]);
  assert.equal(run.state, 'on');
  assert.deepEqual(nibRun([...on, { type: 'blur' }]).effects, [null, 'start', 'end']);
});

test('a hold the settings or the tool do not allow never arms', () => {
  const run = nibRun([{ type: 'hold-down', arms: false }, { type: 'timer' }]);
  assert.deepEqual(run.effects, [null, null]);
  assert.equal(run.state, 'off');
});

test('Space with no press under way arms the hand, whatever else is held', () => {
  assert.equal(spaceAction(null, false), 'pan');
  assert.equal(spaceAction(null, true), 'pan');
});

test('Space mid-press makes a freehand stroke straight, or with Ctrl the quick curve', () => {
  assert.equal(spaceAction('freehand', false), 'straight');
  assert.equal(spaceAction('freehand', true), 'curve');
});

test('Space mid-press leaves every other kind of press as it was', () => {
  for (const kind of PRESS_KINDS) {
    if (kind === 'freehand') continue;
    assert.equal(spaceAction(kind, false), null, kind);
    assert.equal(spaceAction(kind, true), null, kind);
  }
});

test('Ctrl joining a straight line with Space held makes it the quick curve, and nothing else', () => {
  assert.equal(ctrlJoinsPress('straight', true), 'curve');
  assert.equal(ctrlJoinsPress('straight', false), null);
  assert.equal(ctrlJoinsPress('freehand', true), null);
  assert.equal(ctrlJoinsPress(null, true), null);
});

// ---- The Shift-click line ------------------------------------------------------

const INK: InkPaint = { tool: 'pen', color: '#1f1f1f', width: 3, opacity: 0.5 };
const mark = (extra: Partial<Stroke> = {}): Stroke => ({
  id: 'st_a',
  tool: 'pen',
  color: '#1f1f1f',
  width: 3,
  opacity: 0.5,
  points: [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 40, y: 20, pressure: 0.5 },
  ],
  ...extra,
});
const PRESS: ShiftPress = { tool: 'pen', pageId: 'pg_1', activeLayerId: 'ly_1', symmetry: false, ink: INK };
const on = (stroke: Stroke, layerId = 'ly_1') => ({ stroke, layerId });

test('Shift-click lines are drawn with the Pen, the Marker and the Copic, and nothing else', () => {
  const tools: Tool[] = ['pen', 'marker', 'copic', 'eraser', 'vector', 'curve', 'rect', 'select', 'point', 'text'];
  assert.deepEqual(
    tools.filter((tool) => drawsLines(tool)),
    ['pen', 'marker', 'copic'],
  );
});

test('a mark leaves point 1 at its last point, with its id, tool and page', () => {
  assert.deepEqual(lineStartOf(mark(), 'pg_1'), { strokeId: 'st_a', x: 40, y: 20, tool: 'pen', pageId: 'pg_1' });
  // A click's dot is a mark of one point, and leaves that point.
  assert.deepEqual(lineStartOf(mark({ points: [{ x: 5, y: 6 }] }), 'pg_1'), { strokeId: 'st_a', x: 5, y: 6, tool: 'pen', pageId: 'pg_1' });
  assert.equal(lineStartOf(mark({ tool: 'eraser' }), 'pg_1'), null, 'an eraser mark leaves none');
  assert.equal(lineStartOf(mark({ points: [] }), 'pg_1'), null);
  assert.equal(lineStartOf(undefined, 'pg_1'), null);
});

test('a Shift press with point 1 draws the line onto its mark', () => {
  const start = lineStartOf(mark(), 'pg_1');
  assert.equal(shiftLineAction(start, PRESS, on(mark())), 'append');
});

test('a mark painted otherwise than the tool paints now gets its line as a mark of its own', () => {
  const start = lineStartOf(mark(), 'pg_1');
  assert.equal(shiftLineAction(start, { ...PRESS, ink: { ...INK, width: 6 } }, on(mark())), 'new', 'width');
  assert.equal(shiftLineAction(start, { ...PRESS, ink: { ...INK, color: '#ff0000' } }, on(mark())), 'new', 'colour');
  assert.equal(shiftLineAction(start, { ...PRESS, ink: { ...INK, opacity: undefined } }, on(mark())), 'new', 'opacity');
  assert.equal(shiftLineAction(start, { ...PRESS, ink: { ...INK, profile: 'tapered' } }, on(mark())), 'new', 'profile');
  assert.equal(shiftLineAction(start, PRESS, on(mark({ fill: '#00ff00' }))), 'new', 'a fill the panel gave');
  assert.equal(shiftLineAction(start, PRESS, on(mark({ strokeStyle: 'dashed' }))), 'new', 'a dash');
  // And so does a mark on another layer than the one in use, a closed mark, and a line with symmetry copies to make.
  assert.equal(shiftLineAction(start, PRESS, on(mark(), 'ly_2')), 'new', 'another layer');
  assert.equal(shiftLineAction(start, PRESS, on(mark({ vector: { anchors: [{ p: { x: 10, y: 10 } }, { p: { x: 40, y: 20 } }], closed: true } }))), 'new', 'closed');
  assert.equal(shiftLineAction(start, { ...PRESS, symmetry: true }, on(mark())), 'new', 'symmetry');
});

test('point 1 is forgotten once its mark is gone, its end has moved, or the page is another', () => {
  const start = lineStartOf(mark(), 'pg_1');
  assert.equal(shiftLineAction(start, PRESS, null), 'forget', 'the mark is gone');
  const moved = mark({ points: [{ x: 12, y: 10 }, { x: 42, y: 20 }] });
  assert.equal(shiftLineAction(start, PRESS, on(moved)), 'forget', 'the mark was moved');
  assert.equal(shiftLineAction(start, { ...PRESS, pageId: 'pg_2' }, on(mark())), 'forget', 'another page');
});

test('another tool leaves point 1 alone, for when its own tool is back in hand', () => {
  const start = lineStartOf(mark(), 'pg_1');
  assert.equal(shiftLineAction(start, { ...PRESS, tool: 'marker', ink: { ...INK, tool: 'marker' } }, on(mark())), null);
  assert.equal(shiftLineAction(null, PRESS, on(mark())), null, 'and with no point 1 there is no line');
});

test("a Copic mark's nib is part of its paint", () => {
  const copic = mark({ tool: 'copic', nibAngle: 30 });
  assert.equal(samePaint(copic, { ...INK, tool: 'copic', nibAngle: 30 }), true);
  assert.equal(samePaint(copic, { ...INK, tool: 'copic', nibAngle: 45 }), false);
  // A pen has no nib to compare.
  assert.equal(samePaint(mark({ nibAngle: 30 }), INK), true);
});
