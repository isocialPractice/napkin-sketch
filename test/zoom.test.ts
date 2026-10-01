/**
 * How far the canvas zooms, what the screen's lengths are on the page, how
 * a wheel zooms, and when a mark or a layer reaches the view. The GUI check
 * `check-zoom.mjs` drives the same rules in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  boxReachesView,
  clampView,
  clampZoom,
  MAX_ZOOM_FLOOR,
  MIN_ZOOM,
  screenPx,
  wheelZoomFactor,
  zoomLimits,
} from '../src/renderer/zoom.js';

test('at the deepest zoom one page pixel spans the canvas\'s shorter side', () => {
  assert.deepEqual(zoomLimits(1269, 618), { min: MIN_ZOOM, max: 618 });
  assert.deepEqual(zoomLimits(1400, 2240), { min: 0.2, max: 1400 });
  // A canvas too small for that still zooms as far as it always did.
  assert.equal(zoomLimits(5, 5).max, MAX_ZOOM_FLOOR);
  assert.equal(zoomLimits(0, 0).max, 8, 'before the canvas has a size');
  assert.equal(zoomLimits(Number.NaN, 400).max, 8);
});

test('a zoom is held to the limits', () => {
  const limits = zoomLimits(1269, 618);
  assert.equal(clampZoom(900, limits), 618);
  assert.equal(clampZoom(0.01, limits), 0.2);
  assert.equal(clampZoom(3, limits), 3);
  assert.equal(clampZoom(Number.NaN, limits), 1, 'a zoom that is not a number starts again at 1');
  assert.equal(clampZoom(-2, limits), 1);
});

test('a canvas that shrinks below its zoom zooms out about its middle', () => {
  const view = { panX: -1000, panY: -500, zoom: 600 };
  // The page point under the middle of a 1200 x 600 canvas...
  const pageX = (600 - view.panX) / view.zoom;
  const pageY = (300 - view.panY) / view.zoom;
  // ...is still there once the canvas is 800 x 400, and the zoom is 400.
  const held = clampView(view, zoomLimits(800, 400), 600, 300);
  assert.equal(held.zoom, 400);
  assert.ok(Math.abs((600 - held.panX) / held.zoom - pageX) < 1e-9);
  assert.ok(Math.abs((300 - held.panY) / held.zoom - pageY) < 1e-9);
  // A zoom inside the limits is left as it was, the same object.
  const inside = { panX: 3, panY: 4, zoom: 2 };
  assert.equal(clampView(inside, zoomLimits(800, 400), 400, 200), inside);
});

test('a length meant on the screen is that many screen pixels on the page at the zoom', () => {
  assert.equal(screenPx(0.75, 1), 0.75);
  assert.equal(screenPx(3, 400), 0.0075);
  assert.equal(screenPx(2, 0.2), 10);
});

test('a notch of the wheel zooms by 1.1, and a trackpad by as much of a notch as it scrolls', () => {
  assert.ok(Math.abs(wheelZoomFactor(-100) - 1.1) < 1e-12, 'up is in');
  assert.ok(Math.abs(wheelZoomFactor(100) - 1 / 1.1) < 1e-12, 'down is out');
  assert.ok(Math.abs(wheelZoomFactor(-50) - Math.sqrt(1.1)) < 1e-12, 'half a notch');
  assert.ok(Math.abs(wheelZoomFactor(-1000) - 1.1 ** 10) < 1e-9, 'a fast wheel, ten notches in one event');
  assert.ok(Math.abs(wheelZoomFactor(-100, 0, true) - 1 / 1.1) < 1e-12, 'Invert scroll zoom turns it round');
  // Lines and pages: three lines are a notch, a page three notches.
  assert.ok(Math.abs(wheelZoomFactor(-3, 1) - 1.1) < 1e-12);
  assert.ok(Math.abs(wheelZoomFactor(-1, 2) - 1.1 ** 3) < 1e-12);
  assert.equal(wheelZoomFactor(0), 1);
  assert.equal(wheelZoomFactor(Number.NaN), 1);
});

test('a box reaches the view when it or its effects\' reach lands on the canvas', () => {
  // Page to device: 2 device pixels a page unit, the page's origin 100 pixels in.
  const t = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 100 };
  const inView = { minX: 10, minY: 10, maxX: 20, maxY: 20 };
  assert.equal(boxReachesView(inView, 0, t, 800, 600), true);
  // Left of the canvas: its right edge at device x = 100 + 2 * -60 = -20.
  const left = { minX: -100, minY: 10, maxX: -60, maxY: 20 };
  assert.equal(boxReachesView(left, 0, t, 800, 600), false);
  // A blur's reach of 10 page units brings it 20 device pixels on: to x = 0.
  assert.equal(boxReachesView(left, 10, t, 800, 600), true);
  // Deep in: at 900 device pixels a unit, a mark a page pixel off the view is
  // 900 device pixels off, and a blur of 3 units reaches 2700 of them.
  const deep = { a: 900, b: 0, c: 0, d: 900, e: -900 * 500, f: -900 * 300 };
  const near = { minX: 498, minY: 300, maxX: 499, maxY: 301 };
  assert.equal(boxReachesView(near, 0, deep, 1900, 900), false);
  assert.equal(boxReachesView(near, 3, deep, 1900, 900), true);
  // A turned transform maps all four corners.
  const turned = { a: 0, b: 1, c: -1, d: 0, e: 300, f: 0 };
  assert.equal(boxReachesView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, turned, 400, 400), true);
  assert.equal(boxReachesView({ minX: 0, minY: 400, maxX: 10, maxY: 500 }, 0, turned, 400, 400), false);
});
