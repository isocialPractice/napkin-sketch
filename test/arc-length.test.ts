/**
 * Arc length (src/core/arc-length.ts): a quarter-circle cubic's length, the
 * point and the direction at a length, the nearest length to a point, a
 * closed compound path, and the curvature's sign. Split, Liquify and Mesh
 * Warp take its `cubicAt`; their own tests are unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cubicAt, curvatureAtLength, lengthTable, nearestLength, normalAtLength, pointAtLength, tangentAtLength } from '../src/core/arc-length.js';
import type { VectorAnchor } from '../src/core/types.js';

const near = (actual: number, expected: number, within: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual}, not ${expected} (within ${within})`);

/** A quarter circle of radius 100 about the origin, from (100, 0) to (0, 100), as one cubic. */
const K = (4 / 3) * Math.tan(Math.PI / 8) * 100;
const QUARTER: VectorAnchor[] = [
  { p: { x: 100, y: 0 }, hOut: { x: 100, y: K } },
  { p: { x: 0, y: 100 }, hIn: { x: K, y: 100 } },
];

/** The cubic's length as a polyline of a million pieces: the reference. */
function polylineLength(steps = 1_000_000): number {
  let length = 0;
  let prev = cubicAt(QUARTER[0].p, QUARTER[0].hOut!, QUARTER[1].hIn!, QUARTER[1].p, 0);
  for (let i = 1; i <= steps; i++) {
    const next = cubicAt(QUARTER[0].p, QUARTER[0].hOut!, QUARTER[1].hIn!, QUARTER[1].p, i / steps);
    length += Math.hypot(next.x - prev.x, next.y - prev.y);
    prev = next;
  }
  return length;
}

test("a quarter-circle cubic's length is within a ten-thousandth of its own, and of a quarter circle's to its bend's error", () => {
  const table = lengthTable(QUARTER);
  near(table.total, polylineLength(), 1e-4, 'the cubic');
  // The cubic stands at most 0.027% off the circle, so its length is that close to a quarter of the circumference.
  near(table.total, (Math.PI / 2) * 100, 0.05, 'the circle');
  assert.equal(lengthTable([QUARTER[0]]).total, 0, 'one anchor has no length');
  assert.equal(lengthTable([]).segments.length, 0);
});

test('a length lands on its point and runs its way: halfway round is the middle, square to the radius', () => {
  const table = lengthTable(QUARTER);
  const half = pointAtLength(table, table.total / 2);
  const middle = cubicAt(QUARTER[0].p, QUARTER[0].hOut!, QUARTER[1].hIn!, QUARTER[1].p, 0.5);
  near(half.x, middle.x, 1e-6, 'x');
  near(half.y, middle.y, 1e-6, 'y');
  const along = tangentAtLength(table, table.total / 2);
  near(along.x, -Math.SQRT1_2, 1e-9, 'the tangent runs left');
  near(along.y, Math.SQRT1_2, 1e-9, 'and down');
  // The normal is the tangent turned a quarter clockwise: away from the middle here.
  const normal = normalAtLength(table, table.total / 2);
  near(normal.x, -Math.SQRT1_2, 1e-9, 'normal x');
  near(normal.y, -Math.SQRT1_2, 1e-9, 'normal y');
  // Every length lands on the cubic, and a quarter of the way along is a quarter of the length.
  for (const share of [0, 0.1, 0.25, 0.6, 1]) {
    const p = pointAtLength(table, table.total * share);
    near(Math.hypot(p.x, p.y), 100, 0.03, `on the circle at ${share}`);
    near(nearestLength(table, p).length, table.total * share, 1e-6, `and back at ${share}`);
  }
  // The ends hold a length past them.
  assert.deepEqual(pointAtLength(table, -5), { x: 100, y: 0 });
  assert.deepEqual(pointAtLength(table, table.total + 5), { x: 0, y: 100 });
  // A straight segment is exact.
  const line = lengthTable([{ p: { x: 0, y: 0 } }, { p: { x: 30, y: 40 } }]);
  assert.equal(line.total, 50);
  assert.deepEqual(pointAtLength(line, 10), { x: 6, y: 8 });
  assert.deepEqual(tangentAtLength(line, 10), { x: 0.6, y: 0.8 });
});

test('the nearest length to a point off the path is where a line to it meets the path square', () => {
  const table = lengthTable(QUARTER);
  // From well outside the bend, straight out from its middle: the middle.
  const middle = pointAtLength(table, table.total / 2);
  const out = { x: middle.x * 1.5, y: middle.y * 1.5 };
  const found = nearestLength(table, out);
  near(found.length, table.total / 2, 1e-6, 'its length');
  near(found.distance, Math.hypot(middle.x, middle.y) * 0.5, 1e-6, 'its distance');
  // Past an end, the end.
  assert.equal(nearestLength(table, { x: 150, y: -40 }).length, 0);
});

test('a closed compound path runs round each ring, and no length is spent getting from one to the next', () => {
  const square = (x: number, y: number, side: number, move = false): VectorAnchor[] => [
    { p: { x, y }, ...(move ? { move: true as const } : {}) },
    { p: { x: x + side, y } },
    { p: { x: x + side, y: y + side } },
    { p: { x, y: y + side } },
  ];
  const table = lengthTable([...square(0, 0, 10), ...square(100, 100, 5, true)], true);
  assert.equal(table.total, 40 + 20);
  assert.deepEqual(pointAtLength(table, 40), { x: 100, y: 100 }, 'the second ring starts where the first one ended its length');
  assert.deepEqual(pointAtLength(table, 35), { x: 0, y: 5 }, 'the first ring closes back to its corner');
  assert.equal(lengthTable(square(0, 0, 10)).total, 30, 'open, it does not close');
});

test("a path's curvature is one over its radius, signed toward its normal", () => {
  // Clockwise on the page (y down), from the right round to the bottom: it bends toward its normal's other side.
  const table = lengthTable(QUARTER);
  near(curvatureAtLength(table, table.total / 2), 1 / 100, 2e-4, 'a hundredth');
  const reversed = lengthTable([
    { p: { x: 0, y: 100 }, hOut: { x: K, y: 100 } },
    { p: { x: 100, y: 0 }, hIn: { x: 100, y: K } },
  ]);
  near(curvatureAtLength(reversed, reversed.total / 2), -1 / 100, 2e-4, 'the other way, the other sign');
  assert.equal(curvatureAtLength(lengthTable([{ p: { x: 0, y: 0 } }, { p: { x: 9, y: 9 } }]), 3), 0, 'a line has none');
});
