/**
 * Split (src/core/split.ts): a mark's path cut where a point lands on it, as
 * a vector editor's Scissors cut it - nothing moving. A cubic cut in two
 * traces the original at every parameter; a line, a closed rectangle opened
 * and then divided, a compound shape's ring, pressure carried to the cut, a
 * cut on an anchor, the picking of the mark to cut, and what cannot be cut.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSplittable, nearestOnMark, splitMark, splitTarget, type SplitPoint } from '../src/core/split.js';
import type { Point, Stroke, VectorAnchor } from '../src/core/types.js';

type Vec = { x: number; y: number };

const pts = (list: Vec[]): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 }));

function cubicAt(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The segment from one anchor to the next as a cubic's four points. */
const segmentOf = (a: VectorAnchor, b: VectorAnchor): [Vec, Vec, Vec, Vec] => [a.p, a.hOut ?? a.p, b.hIn ?? b.p, b.p];
const near = (a: Vec, b: Vec, eps = 1e-9): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= eps;

/** An S-shaped open path of two cubics. */
function wave(): Stroke {
  const anchors: VectorAnchor[] = [
    { p: { x: 0, y: 100 }, hOut: { x: 40, y: 0 } },
    { p: { x: 100, y: 100 }, hIn: { x: 60, y: 200 }, hOut: { x: 140, y: 0 } },
    { p: { x: 200, y: 100 }, hIn: { x: 160, y: 200 } },
  ];
  return { id: 'w', tool: 'pen', color: '#1f2328', width: 3, points: [], vector: { anchors } };
}

/** A filled square of bare points, closed on its first corner. */
function square(id: string, x0: number, y0: number, x1: number, y1: number): Stroke {
  return { id, tool: 'pen', color: '#1f2328', width: 2, fill: '#e9c46a', points: pts([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]) };
}

test('a cubic cut at t: each half, at its own parameter, is the original at the matching one', () => {
  const stroke = wave();
  const [p0, p1, p2, p3] = segmentOf(stroke.vector!.anchors[0], stroke.vector!.anchors[1]);
  const t = 0.3;
  const at: SplitPoint = { subpath: 0, segment: 0, t, point: cubicAt(p0, p1, p2, p3, t), distance: 0 };
  const pieces = splitMark(stroke, at)!;
  const [a, m] = pieces.first.vector!.anchors;
  const [m2, b] = pieces.second!.vector!.anchors;
  assert.ok(near(m.p, m2.p) && near(m.p, cubicAt(p0, p1, p2, p3, t)), 'the cut is on the curve, the end of one and the start of the other');
  assert.equal(m.hOut, undefined, 'the first ends at the cut');
  assert.equal(m2.hIn, undefined, 'and the second starts there');
  for (let k = 0; k <= 10; k++) {
    const u = k / 10;
    assert.ok(near(cubicAt(...segmentOf(a, m), u), cubicAt(p0, p1, p2, p3, t * u)), `first half at ${u}`);
    assert.ok(near(cubicAt(...segmentOf(m2, pieces.second!.vector!.anchors[1]), u), cubicAt(p0, p1, p2, p3, t + (1 - t) * u)), `second half at ${u}`);
  }
  assert.equal(pieces.second!.vector!.anchors.length, 3, 'the second keeps the anchors after the cut');
  assert.ok(near(b.p, { x: 100, y: 100 }));
  assert.equal(pieces.first.id, 'w', 'the first keeps the id');
  assert.notEqual(pieces.second!.id, 'w');
  assert.equal(pieces.second!.width, 3, 'and both keep the paint');
});

test('the place on a path nearest a point: on the curve, closer than any sample', () => {
  const stroke = wave();
  const at = nearestOnMark(stroke, { x: 50, y: 60 })!;
  assert.equal(at.subpath, 0);
  assert.equal(at.segment, 0);
  const [p0, p1, p2, p3] = segmentOf(stroke.vector!.anchors[0], stroke.vector!.anchors[1]);
  assert.ok(near(at.point, cubicAt(p0, p1, p2, p3, at.t), 1e-9), 'the place is the curve at t');
  for (let k = 0; k <= 200; k++) {
    const q = cubicAt(p0, p1, p2, p3, k / 200);
    assert.ok(at.distance <= Math.hypot(q.x - 50, q.y - 60) + 1e-9, 'no sample is nearer');
  }
});

test('a line cut in its middle is two lines, and the points are the ends and the cut', () => {
  const line: Stroke = { id: 'l', tool: 'pen', color: '#1f2328', width: 2, points: pts([{ x: 0, y: 0 }, { x: 100, y: 0 }]), vector: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }] } };
  const at = nearestOnMark(line, { x: 40, y: 3 })!;
  assert.ok(near(at.point, { x: 40, y: 0 }));
  assert.equal(at.distance, 3);
  const { first, second } = splitMark(line, at)!;
  assert.deepEqual(first.points.map((p) => [p.x, p.y]), [[0, 0], [40, 0]]);
  assert.deepEqual(second!.points.map((p) => [p.x, p.y]), [[40, 0], [100, 0]]);
  assert.equal(splitMark(line, { ...at, t: 0 }), null, 'the end of an open path has nothing to cut');
});

test('a mark of bare points gets the exact point put in, and keeps every other point', () => {
  const poly: Stroke = { id: 'p', tool: 'marker', color: '#1f2328', width: 6, points: pts([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]) };
  const at = nearestOnMark(poly, { x: 52, y: 20 })!;
  const { first, second } = splitMark(poly, at)!;
  assert.deepEqual(first.points.map((p) => [p.x, p.y]), [[0, 0], [50, 0], [50, 20]]);
  assert.deepEqual(second!.points.map((p) => [p.x, p.y]), [[50, 20], [50, 50]]);
  assert.equal(first.vector, undefined, 'still bare points');
  assert.equal(second!.tool, 'marker');
});

test('a closed rectangle opens at a corner, adding no anchor, and then splits in two mid-side', () => {
  const rect = square('r', 0, 0, 100, 60);
  // A cut on the corner at 100, 0: the anchor within reach wins.
  const corner = nearestOnMark(rect, { x: 101, y: 1 }, { anchorReach: 4 })!;
  assert.equal(corner.t, 0);
  assert.ok(near(corner.point, { x: 100, y: 0 }));
  const opened = splitMark(rect, corner)!;
  assert.equal(opened.second, null, 'opened, not divided');
  const anchors = opened.first.vector!.anchors;
  assert.deepEqual(anchors.map((a) => [a.p.x, a.p.y]), [[100, 0], [100, 60], [0, 60], [0, 0], [100, 0]], 'round from the cut and back, and no anchor added');
  assert.equal(opened.first.vector!.closed, false, 'open, though its ends meet');
  assert.equal(opened.first.fill, '#e9c46a', 'and it keeps its fill');
  assert.equal(opened.first.id, 'r');
  // Again, mid-side: two pieces now.
  const again = nearestOnMark(opened.first, { x: 50, y: 62 })!;
  const halves = splitMark(opened.first, again)!;
  assert.ok(halves.second, 'the second cut divides it');
  assert.deepEqual(halves.first.vector!.anchors.map((a) => [a.p.x, a.p.y]), [[100, 0], [100, 60], [50, 60]]);
  assert.deepEqual(halves.second!.vector!.anchors.map((a) => [a.p.x, a.p.y]), [[50, 60], [0, 60], [0, 0], [100, 0]]);
});

test('a closed curve opened mid-segment traces the same curve, one anchor more', () => {
  const k = (4 / 3) * (Math.SQRT2 - 1) * 50;
  const anchors: VectorAnchor[] = [
    { p: { x: 100, y: 50 }, hIn: { x: 100, y: 50 - k }, hOut: { x: 100, y: 50 + k } },
    { p: { x: 50, y: 100 }, hIn: { x: 50 + k, y: 100 }, hOut: { x: 50 - k, y: 100 } },
    { p: { x: 0, y: 50 }, hIn: { x: 0, y: 50 + k }, hOut: { x: 0, y: 50 - k } },
    { p: { x: 50, y: 0 }, hIn: { x: 50 - k, y: 0 }, hOut: { x: 50 + k, y: 0 } },
  ];
  const circle: Stroke = { id: 'c', tool: 'pen', color: '#1f2328', width: 2, fill: '#e9c46a', points: [], vector: { anchors, closed: true } };
  // The closing segment, from the top back to the right.
  const at = nearestOnMark(circle, { x: 90, y: 10 })!;
  assert.equal(at.segment, 3, 'on the closing segment');
  const { first, second } = splitMark(circle, at)!;
  assert.equal(second, null);
  const out = first.vector!.anchors;
  assert.equal(out.length, 6, 'the cut, the four anchors, and the cut again');
  assert.ok(near(out[0].p, out[5].p) && near(out[0].p, at.point));
  // The two pieces of the closing segment trace it.
  const [p0, p1, p2, p3] = segmentOf(anchors[3], anchors[0]);
  for (let s = 0; s <= 8; s++) {
    const u = s / 8;
    assert.ok(near(cubicAt(...segmentOf(out[4], out[5]), u), cubicAt(p0, p1, p2, p3, at.t * u), 1e-9));
    assert.ok(near(cubicAt(...segmentOf(out[0], out[1]), u), cubicAt(p0, p1, p2, p3, at.t + (1 - at.t) * u), 1e-9));
  }
});

test('a compound shape gives up the ring that was cut, open, and the rest stays closed', () => {
  const holed: Stroke = {
    id: 'h',
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    fill: '#e9c46a',
    points: [],
    vector: {
      closed: true,
      anchors: [
        { p: { x: 0, y: 0 } },
        { p: { x: 100, y: 0 } },
        { p: { x: 100, y: 100 } },
        { p: { x: 0, y: 100 } },
        { p: { x: 30, y: 30 }, move: true },
        { p: { x: 30, y: 70 } },
        { p: { x: 70, y: 70 } },
        { p: { x: 70, y: 30 } },
      ],
    },
  };
  const at = nearestOnMark(holed, { x: 50, y: 72 })!;
  assert.equal(at.subpath, 1, 'the hole');
  const { first, second } = splitMark(holed, at)!;
  assert.equal(first.id, 'h');
  assert.equal(first.vector!.closed, true, 'the rest stays closed');
  assert.deepEqual(first.vector!.anchors.map((a) => [a.p.x, a.p.y]), [[0, 0], [100, 0], [100, 100], [0, 100]]);
  assert.equal(second!.vector!.closed, false, 'the ring comes out open');
  assert.deepEqual(second!.vector!.anchors.map((a) => [a.p.x, a.p.y]), [[50, 70], [70, 70], [70, 30], [30, 30], [30, 70], [50, 70]]);
  assert.equal(second!.vector!.anchors.some((a) => a.move), false, 'a mark of its own, one subpath');
});

test('a fitted stroke carries its pressure to the cut', () => {
  const fitted: Stroke = {
    id: 'f',
    tool: 'pen',
    color: '#1f2328',
    width: 6,
    points: [],
    vector: { fitted: true, anchors: [{ p: { x: 0, y: 0 }, pressure: 0.2 }, { p: { x: 100, y: 0 }, pressure: 0.8 }] },
  };
  const { first, second } = splitMark(fitted, { subpath: 0, segment: 0, t: 0.25, point: { x: 25, y: 0 }, distance: 0 })!;
  const cut = first.vector!.anchors[1];
  assert.ok(Math.abs(cut.pressure! - 0.35) < 1e-12, `${cut.pressure}`);
  assert.equal(second!.vector!.anchors[0].pressure, cut.pressure);
  assert.equal(first.vector!.fitted, true, 'still a fit');
  assert.ok(Math.abs(first.points[first.points.length - 1].pressure - 0.35) < 1e-12, 'and its points say so');
});

test('the mark to cut: the topmost whose path is in reach, not text or pictures', () => {
  const low: Stroke = { id: 'low', tool: 'pen', color: '#000', width: 2, points: pts([{ x: 0, y: 50 }, { x: 100, y: 50 }]) };
  const high: Stroke = { id: 'high', tool: 'pen', color: '#000', width: 2, points: pts([{ x: 50, y: 0 }, { x: 50, y: 100 }]) };
  const text: Stroke = { id: 't', tool: 'text', color: '#000', width: 1, text: 'Hi', points: [{ x: 48, y: 48, pressure: 0.5 }] };
  assert.equal(splitTarget([low, high, text], { x: 51, y: 51 }, 4)?.stroke.id, 'high', 'the one on top, text passed over');
  assert.equal(splitTarget([low, high], { x: 51, y: 51 }, 4, { editable: new Set(['low']) })?.stroke.id, 'low', 'only a mark that can be edited');
  assert.equal(splitTarget([low, high], { x: 80, y: 80 }, 4), null, 'nothing in reach');
  assert.equal(isSplittable(text), false);
  assert.equal(isSplittable({ ...low, tool: 'eraser' }), false, 'an older file\'s eraser mark');
  assert.equal(isSplittable({ ...low, points: pts([{ x: 1, y: 1 }]) }), false, 'a lone dot');
});
