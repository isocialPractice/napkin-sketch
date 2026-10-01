/**
 * Placing a Vector Path: Shift holds the next anchor, the rubber band and a
 * pulled handle to eight directions, and a press near the first anchor of a
 * path of two or more closes it. The GUI check `check-vector-path.mjs`
 * drives the same rules in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bandEnd, closesAt, nextAnchorAt, pulledHandles } from '../src/renderer/vector-place.js';
import type { VectorAnchor } from '../src/core/types.js';

const at = (x: number, y: number): VectorAnchor => ({ p: { x, y } });
/** 200 units out from (100, 300) at `degrees` up from level. */
const out = (degrees: number) => ({ x: 100 + 200 * Math.cos((degrees * Math.PI) / 180), y: 300 - 200 * Math.sin((degrees * Math.PI) / 180) });
const angle = (from: { x: number; y: number }, to: { x: number; y: number }) => (Math.atan2(from.y - to.y, to.x - from.x) * 180) / Math.PI;

test('a press closes the path within the grab of its first anchor, once it has two', () => {
  const path = [at(100, 300), at(300, 300)];
  assert.equal(closesAt(path, { x: 103, y: 300 }, 8), true);
  assert.equal(closesAt(path, { x: 120, y: 300 }, 8), false, '20 away is too far');
  assert.equal(closesAt([at(100, 300)], { x: 101, y: 300 }, 8), false, 'one anchor is nothing to close');
  assert.equal(closesAt([], { x: 101, y: 300 }, 8), false);
});

test('Shift holds the next anchor to eight directions from the last', () => {
  const path = [at(100, 300)];
  const free = nextAnchorAt(path, out(40), false);
  assert.ok(Math.abs(angle(path[0].p, free) - 40) < 1e-9, 'without Shift it is where the pointer is');
  const held = nextAnchorAt(path, out(40), true);
  assert.ok(Math.abs(angle(path[0].p, held) - 45) < 1e-9, `with Shift ${angle(path[0].p, held)}`);
  assert.ok(Math.abs(angle(path[0].p, nextAnchorAt(path, out(10), true))) < 1e-9, 'and near level it is level');
  // The first anchor has nothing to be held to.
  assert.deepEqual(nextAnchorAt([], { x: 5, y: 7 }, true), { x: 5, y: 7 });
});

test('the band ends on the first anchor where a press would close, Shift or not', () => {
  const path = [at(100, 300), at(300, 300), at(200, 150)];
  const near = { x: 104, y: 302 };
  assert.deepEqual(bandEnd(path, near, false, 8), { end: { x: 100, y: 300 }, closes: true });
  assert.deepEqual(bandEnd(path, near, true, 8), { end: { x: 100, y: 300 }, closes: true });
  const far = bandEnd(path, { x: 120, y: 300 }, false, 8);
  assert.equal(far.closes, false);
  assert.deepEqual(far.end, { x: 120, y: 300 });
  // Elsewhere, Shift holds it from the last anchor.
  const held = bandEnd(path, { x: 200 + 150, y: 150 - 130 }, true, 8);
  assert.ok(Math.abs(angle(path[2].p, held.end) - 45) < 1e-9, `${angle(path[2].p, held.end)}`);
});

test('a pulled handle is symmetric, and Shift holds it to eight directions about its anchor', () => {
  const anchor = at(100, 300);
  const free = pulledHandles(anchor, out(40), false, 3)!;
  assert.ok(Math.abs(angle(anchor.p, free.hOut) - 40) < 1e-9);
  assert.ok(Math.abs(free.hIn.x - (200 - free.hOut.x)) < 1e-9 && Math.abs(free.hIn.y - (600 - free.hOut.y)) < 1e-9, 'the other handle is its mirror');
  const held = pulledHandles(anchor, out(40), true, 3)!;
  assert.ok(Math.abs(angle(anchor.p, held.hOut) - 45) < 1e-9);
  assert.ok(Math.abs(angle(anchor.p, held.hIn) + 135) < 1e-9);
  assert.equal(pulledHandles(anchor, { x: 101, y: 301 }, false, 3), null, 'inside the click radius the anchor stays a corner');
});
