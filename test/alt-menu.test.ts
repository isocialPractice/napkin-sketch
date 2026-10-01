/**
 * When a bare Alt may open the menu bar: only after the keyboard has been
 * idle for five seconds, and never after Alt was used for something - a
 * scroll, a drag, another key. The GUI check `check-held-keys.mjs` watches
 * the menu bar take the focus, or not, in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALT_MENU_IDLE_MS, AltMenuRule } from '../src/renderer/alt-menu.js';

test('a bare Alt with no key before it may open the menu bar', () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 10_000);
  assert.equal(rule.altUp(), true);
});

test('a bare Alt within five seconds of another key may not', () => {
  const rule = new AltMenuRule();
  rule.keyDown('s', 1000);
  rule.keyDown('Alt', 1000 + ALT_MENU_IDLE_MS - 1);
  assert.equal(rule.altUp(), false);
});

test('five idle seconds are enough', () => {
  const rule = new AltMenuRule();
  rule.keyDown('s', 1000);
  rule.keyDown('Alt', 1000 + ALT_MENU_IDLE_MS);
  assert.equal(rule.altUp(), true);
});

test('Alt used for a scroll, a drag or a press never opens the menu bar, however idle the keys were', () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 60_000);
  rule.gesture();
  assert.equal(rule.altUp(), false);
});

test('a key pressed with Alt held makes it a chord, not a bare Alt', () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 60_000);
  rule.keyDown('p', 60_010);
  assert.equal(rule.altUp(), false);
});

test("the keyboard's own auto-repeat of Alt is no new Alt", () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 60_000);
  rule.gesture();
  rule.keyDown('Alt', 60_500, true);
  assert.equal(rule.altUp(), false);
});

test('a bare Alt is not counted as a key, so tapping Alt again still works', () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 60_000);
  assert.equal(rule.altUp(), true);
  rule.keyDown('Alt', 60_300);
  assert.equal(rule.altUp(), true);
});

test('each Alt is judged on its own: a used one does not spoil the next', () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 60_000);
  rule.gesture();
  assert.equal(rule.altUp(), false);
  rule.keyDown('Alt', 61_000);
  assert.equal(rule.altUp(), true);
});

test('a gesture with no Alt held changes nothing', () => {
  const rule = new AltMenuRule();
  rule.gesture();
  rule.keyDown('Alt', 60_000);
  assert.equal(rule.held, true);
  assert.equal(rule.altUp(), true);
  assert.equal(rule.held, false);
});

test('an Alt keyup whose keydown was never seen may not open the menu bar', () => {
  assert.equal(new AltMenuRule().altUp(), false);
});

test('a lost window forgets the Alt that was held', () => {
  const rule = new AltMenuRule();
  rule.keyDown('Alt', 60_000);
  rule.reset();
  assert.equal(rule.held, false);
  assert.equal(rule.altUp(), false);
});
