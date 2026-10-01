/**
 * The press record: how a press ends when its release is not what ends it,
 * when a press left on record is stale, and the work kept for a press's end.
 * The GUI check `check-held-keys.mjs` drives the same rules in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AfterPress, isStalePress, PRESS_KINDS, pressEndPolicy, type PressEndReason } from '../src/renderer/press-state.js';

test('Escape and a second finger drop every kind of press', () => {
  for (const kind of PRESS_KINDS) {
    for (const reason of ['escape', 'gesture'] as const) {
      assert.equal(pressEndPolicy(kind, reason), 'drop', `${kind} by ${reason}`);
    }
  }
});

test('a curve is a preview until its release, so anything that ends it early drops it', () => {
  const reasons: PressEndReason[] = ['blur', 'hidden', 'capture', 'escape', 'stale', 'gesture'];
  for (const kind of ['curve', 'chord'] as const) {
    for (const reason of reasons) assert.equal(pressEndPolicy(kind, reason), 'drop', `${kind} by ${reason}`);
  }
});

test('a lost window, a hidden page, a lost capture or a stale press finishes the rest where it stands', () => {
  for (const kind of PRESS_KINDS) {
    if (kind === 'curve' || kind === 'chord') continue;
    for (const reason of ['blur', 'hidden', 'capture', 'stale'] as const) {
      assert.equal(pressEndPolicy(kind, reason), 'finish', `${kind} by ${reason}`);
    }
  }
});

test('the kinds are listed once each', () => {
  assert.equal(new Set(PRESS_KINDS).size, PRESS_KINDS.length);
  assert.equal(PRESS_KINDS.length, 18);
});

test('the same pointer going down again means its press lost its release', () => {
  assert.equal(isStalePress(1, 1, new Set([1])), true);
});

test('a press whose pointer has been seen to come up is stale', () => {
  assert.equal(isStalePress(1, 1, new Set<number>()), true);
  assert.equal(isStalePress(4, 7, new Set([7])), true);
});

test("a second finger down beside the press's own is not stale: that is a gesture", () => {
  assert.equal(isStalePress(4, 7, new Set([4])), false);
  assert.equal(isStalePress(4, 7, new Map([[4, { x: 0, y: 0 }]])), false);
});

test('work kept for the end of a press runs in the order it was asked, once', () => {
  const after = new AfterPress();
  const ran: string[] = [];
  after.add(() => ran.push('pen'));
  after.add(() => ran.push('select'));
  assert.equal(after.size, 2);
  after.flush();
  assert.deepEqual(ran, ['pen', 'select']);
  assert.equal(after.size, 0);
  after.flush();
  assert.deepEqual(ran, ['pen', 'select']);
});

test('one piece of work that throws does not stop the rest, and its error is thrown after them', () => {
  const after = new AfterPress();
  const ran: string[] = [];
  after.add(() => ran.push('first'));
  after.add(() => {
    throw new Error('broken');
  });
  after.add(() => {
    throw new Error('also broken');
  });
  after.add(() => ran.push('last'));
  assert.throws(() => after.flush(), /^Error: broken$/);
  assert.deepEqual(ran, ['first', 'last']);
  assert.equal(after.size, 0);
});

test('work added while the queue runs waits for the next flush', () => {
  const after = new AfterPress();
  const ran: string[] = [];
  after.add(() => {
    ran.push('outer');
    after.add(() => ran.push('inner'));
  });
  after.flush();
  assert.deepEqual(ran, ['outer']);
  assert.equal(after.size, 1);
  after.flush();
  assert.deepEqual(ran, ['outer', 'inner']);
});
