/**
 * Fill and stroke in the drawing window (src/renderer/fill-stroke.ts): which
 * one is in front, where `C` and `Shift+C` take it through the Quick Access
 * Colors - the fill's stops beginning with None - and what `Shift+X` does to
 * the tool's own two paints. `check-fill-stroke.mjs` drives them in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { frontColor, nextQuickColor, otherTarget, swapToolPaint } from '../src/renderer/fill-stroke.js';

const COLORS = ['#1d2328', '#27486d', '#2e7d5b'];

test('X puts the other one in front', () => {
  assert.equal(otherTarget('stroke'), 'fill');
  assert.equal(otherTarget('fill'), 'stroke');
});

test('the color in front is the ink or the fill, none being null', () => {
  assert.equal(frontColor({ color: '#1f2328', fill: null, colorTarget: 'stroke' }), '#1f2328');
  assert.equal(frontColor({ color: '#1f2328', fill: null, colorTarget: 'fill' }), null);
  assert.equal(frontColor({ color: '#1f2328', fill: '#27486d', colorTarget: 'fill' }), '#27486d');
});

test('the ink steps through the colors alone, from an ink not among them to the first or the last', () => {
  assert.equal(nextQuickColor(COLORS, '#1f2328', 1, 'stroke'), '#1d2328');
  assert.equal(nextQuickColor(COLORS, '#1f2328', -1, 'stroke'), '#2e7d5b');
  assert.equal(nextQuickColor(COLORS, '#2E7D5B', 1, 'stroke'), '#1d2328', 'round again, whatever the case');
  assert.equal(nextQuickColor(COLORS, '#1d2328', -1, 'stroke'), '#2e7d5b');
});

test("the fill's stops begin with None", () => {
  assert.equal(nextQuickColor(COLORS, null, 1, 'fill'), '#1d2328');
  assert.equal(nextQuickColor(COLORS, '#1d2328', -1, 'fill'), null, 'back from the first is None');
  assert.equal(nextQuickColor(COLORS, '#2e7d5b', 1, 'fill'), null, 'on from the last is None');
  assert.equal(nextQuickColor(COLORS, null, -1, 'fill'), '#2e7d5b');
  assert.equal(nextQuickColor(COLORS, '#abcdef', 1, 'fill'), null, 'a fill not among them starts from None');
});

test('with no Quick Access Colors the color stays', () => {
  assert.equal(nextQuickColor([], '#1f2328', 1, 'stroke'), '#1f2328');
  assert.equal(nextQuickColor([], null, 1, 'fill'), null);
});

test("Shift+X trades the tool's ink and fill, and a fill of none has nothing to trade", () => {
  assert.deepEqual(swapToolPaint({ color: '#1f2328', fill: '#27486d', colorTarget: 'stroke' }), { color: '#27486d', fill: '#1f2328' });
  assert.equal(swapToolPaint({ color: '#1f2328', fill: null, colorTarget: 'fill' }), null);
});
