/** Geometry primitive tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distance,
  pathLength,
  centroid,
  boundingBox,
  resample,
  simplify,
  fitCircle,
} from '../src/sharpen/geometry.js';

test('distance is Euclidean', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('pathLength sums segment lengths', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 3, y: 2 },
  ];
  assert.equal(pathLength(pts), 5);
});

test('centroid averages points', () => {
  const c = centroid([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 2, y: 6 },
  ]);
  assert.equal(c.x, 2);
  assert.equal(c.y, 2);
});

test('boundingBox spans extremes', () => {
  const bb = boundingBox([
    { x: -1, y: 5 },
    { x: 4, y: -2 },
  ]);
  assert.equal(bb.width, 5);
  assert.equal(bb.height, 7);
});

test('resample keeps endpoints and even spacing', () => {
  const out = resample(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    2,
  );
  assert.equal(out[0].x, 0);
  assert.equal(out[out.length - 1].x, 10);
  assert.ok(out.length >= 5);
});

test('simplify drops near-collinear points', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 1, y: 0.01 },
    { x: 2, y: 0 },
    { x: 3, y: -0.01 },
    { x: 4, y: 0 },
  ];
  const out = simplify(line, 0.5);
  assert.equal(out.length, 2);
});

test('fitCircle recovers a known circle', () => {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push({ x: 10 + 5 * Math.cos(a), y: 10 + 5 * Math.sin(a) });
  }
  const fit = fitCircle(pts);
  assert.ok(fit);
  assert.ok(Math.abs(fit.center.x - 10) < 0.001);
  assert.ok(Math.abs(fit.radius - 5) < 0.001);
});
