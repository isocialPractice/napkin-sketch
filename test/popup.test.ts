/**
 * Popup tests: the placement arithmetic the shared editing-popup manager uses.
 *
 * The manager itself is DOM work and is exercised by driving the running app.
 * The clamp is not - it is the one rule that decides whether a panel dragged
 * at the edge of the screen can ever be grabbed again, and it is pure, so it
 * is checked here where a wrong sign is a failing test rather than a palette
 * nobody can reach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToViewport } from '../src/renderer/popup.js';

/** A window big enough that the middle of it is nowhere near a limit. */
const VIEWPORT = { width: 1280, height: 800 };

test('a panel well inside the viewport is left where it was put', () => {
  assert.deepEqual(clampToViewport(400, 300, 340, VIEWPORT), { left: 400, top: 300 });
});

test('a panel dragged off the right keeps a grabbable strip on screen', () => {
  // 64px of reach is kept, so the title bar is still hittable.
  assert.deepEqual(clampToViewport(5000, 100, 340, VIEWPORT), { left: 1216, top: 100 });
});

test('a panel dragged off the left keeps the same strip', () => {
  // Its right edge lands 64px inside, which for a 340-wide panel is -276.
  assert.deepEqual(clampToViewport(-5000, 100, 340, VIEWPORT), { left: -276, top: 100 });
  assert.equal(-276 + 340, 64);
});

test('the title bar never goes above the top edge', () => {
  assert.deepEqual(clampToViewport(400, -900, 340, VIEWPORT), { left: 400, top: 0 });
});

test('a panel dragged off the bottom keeps its title in view', () => {
  assert.deepEqual(clampToViewport(400, 5000, 340, VIEWPORT), { left: 400, top: 736 });
});

test('positions come back as whole pixels', () => {
  const at = clampToViewport(400.4, 300.6, 340, VIEWPORT);
  assert.equal(at.left, 400);
  assert.equal(at.top, 301);
});

test('a panel wider than the window can still be reached from either side', () => {
  const wide = 2000;
  const narrow = { width: 900, height: 600 };
  const right = clampToViewport(5000, 0, wide, narrow);
  const left = clampToViewport(-5000, 0, wide, narrow);
  assert.equal(right.left, 836);
  assert.equal(left.left, 64 - wide);
  // Whichever way it was thrown, 64px of it is inside the window.
  assert.ok(right.left < narrow.width);
  assert.ok(left.left + wide === 64);
});

test('a window shorter than the reach still clamps to a usable top', () => {
  // A very short window makes maxTop negative; the top clamp wins, so the
  // panel sits at 0 rather than at a negative offset it could not be
  // dragged back from.
  assert.deepEqual(clampToViewport(10, 10, 340, { width: 1280, height: 40 }), {
    left: 10,
    top: 0,
  });
});
