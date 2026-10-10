/**
 * Direct Select's picks (src/core/direct-select.ts): how a mark's segments
 * are named, what a box offers on one mark, the rule that picks anchors when
 * the box holds any and segments only when it holds none, adding with Shift,
 * and what a move of a pick carries - a segment's two ends, and a ring's seam
 * twin with them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addPicks,
  boxPickable,
  boxPicks,
  movedPoints,
  onPickedSegment,
  pickInBox,
  segmentsOf,
  withSeamTwins,
  type PickBox,
} from '../src/core/direct-select.js';
import type { Point, Stroke, VectorAnchor } from '../src/core/types.js';

type Vec = { x: number; y: number };

const pts = (list: Vec[]): Point[] => list.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 }));
const sorted = (set: Iterable<number>): number[] => [...set].sort((a, b) => a - b);
const box = (minX: number, minY: number, maxX: number, maxY: number): PickBox => ({ minX, minY, maxX, maxY });

/** A rectangle of bare points, clockwise from its top-left corner and closed on it: 0 TL, 1 TR, 2 BR, 3 BL, 4 TL again. */
function rectangle(id: string, x0: number, y0: number, x1: number, y1: number): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    points: pts([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]),
  };
}

/** A path of anchors: corner anchors at the given places, closed or open. */
function path(id: string, corners: Vec[], closed = false): Stroke {
  const anchors: VectorAnchor[] = corners.map((p) => ({ p: { ...p } }));
  return { id, tool: 'pen', color: '#1f2328', width: 2, points: [], vector: { anchors, ...(closed ? { closed: true } : {}) } };
}

test('segments are named by the anchor they start from, a closed path closing back to its first', () => {
  const open = path('o', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
  assert.deepEqual(segmentsOf(open), [
    { index: 0, from: 0, to: 1 },
    { index: 1, from: 1, to: 2 },
  ]);

  const closed = path('c', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true);
  assert.deepEqual(
    segmentsOf(closed).map((s) => [s.index, s.from, s.to]),
    [[0, 0, 1], [1, 1, 2], [2, 2, 3], [3, 3, 0]],
    'the last anchor names the closing segment',
  );
});

test('a compound path closes each subpath on its own first anchor', () => {
  const compound: Stroke = {
    id: 'k',
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    points: [],
    vector: {
      closed: true,
      anchors: [
        { p: { x: 0, y: 0 } },
        { p: { x: 30, y: 0 } },
        { p: { x: 30, y: 30 } },
        { p: { x: 10, y: 10 }, move: true },
        { p: { x: 20, y: 10 } },
        { p: { x: 20, y: 20 } },
      ],
    },
  };
  assert.deepEqual(
    segmentsOf(compound).map((s) => [s.index, s.from, s.to]),
    [[0, 0, 1], [1, 1, 2], [2, 2, 0], [3, 3, 4], [4, 4, 5], [5, 5, 3]],
  );
});

test('a ring of bare points closes through its seam twin, never by wrapping', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  assert.deepEqual(
    segmentsOf(rect).map((s) => [s.index, s.from, s.to]),
    [[0, 0, 1], [1, 1, 2], [2, 2, 3], [3, 3, 4]],
  );
});

test('a box offers the anchors inside it and every segment passing through it', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  // Across the bottom edge only, as the GIF draws it: no corner inside.
  const below = pickInBox(rect, box(30, 30, 50, 90));
  assert.deepEqual(sorted(below.anchors), []);
  assert.deepEqual(sorted(below.segments), [2], 'the bottom edge, from BR to BL');

  // Around the top-left corner: the corner and its seam twin, and the two edges it ends.
  const corner = pickInBox(rect, box(-5, -5, 5, 5));
  assert.deepEqual(sorted(corner.anchors), [0, 4]);
  assert.deepEqual(sorted(corner.segments), [0, 3]);
});

test('a curved segment is met by its curve, not by its chord', () => {
  // An arch from (0,0) to (100,0) bowing up to about y = -75: the chord lies
  // along y = 0, the curve far above it.
  const arch: Stroke = {
    id: 'a',
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    points: [],
    vector: { anchors: [{ p: { x: 0, y: 0 }, hOut: { x: 0, y: -100 } }, { p: { x: 100, y: 0 }, hIn: { x: 100, y: -100 } }] },
  };
  assert.deepEqual(sorted(pickInBox(arch, box(40, -80, 60, -70)).segments), [0], 'a box at the top of the bow meets it');
  assert.deepEqual(sorted(pickInBox(arch, box(40, -10, 60, -5)).segments), [], 'a box on the chord, under the bow, does not');
});

test('the box rule: anchors whenever it holds any, across every mark', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  const line = path('l', [{ x: 60, y: 60 }, { x: 160, y: 60 }]);
  // Holds the rectangle's two right corners and the line's first anchor, and
  // crosses the rectangle's top and bottom edges too.
  const picks = boxPicks([rect, line], box(50, -10, 110, 70));
  assert.deepEqual([...picks.keys()].sort(), ['l', 'r']);
  assert.deepEqual(sorted(picks.get('r')!.anchors), [1, 2]);
  assert.deepEqual(sorted(picks.get('r')!.segments), [], 'no segment, though the box crosses two');
  assert.deepEqual(sorted(picks.get('l')!.anchors), [0]);
});

test('the box rule: segments only when it holds no anchor at all', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  const line = path('l', [{ x: 0, y: 100 }, { x: 100, y: 100 }]);
  const picks = boxPicks([rect, line], box(40, 30, 60, 110));
  assert.deepEqual(sorted(picks.get('r')!.segments), [2]);
  assert.deepEqual(sorted(picks.get('l')!.segments), [0]);
  assert.deepEqual(sorted(picks.get('r')!.anchors), []);

  // An anchor of one mark anywhere in the box wins over every segment of the other.
  const shifted = path('m', [{ x: -50, y: 100 }, { x: 50, y: 100 }]);
  const withAnchor = boxPicks([rect, shifted], box(40, 30, 60, 110));
  assert.equal(withAnchor.has('r'), false, 'the rectangle offered only a segment');
  assert.deepEqual(sorted(withAnchor.get('m')!.anchors), [1]);
  assert.deepEqual(sorted(withAnchor.get('m')!.segments), []);
});

test('the box rule: nothing caught is an empty map, which changes nothing', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  assert.equal(boxPicks([rect], box(200, 200, 300, 300)).size, 0);
});

test('the box leaves text and pictures out', () => {
  const text: Stroke = { id: 't', tool: 'text', color: '#1f2328', width: 1, points: pts([{ x: 0, y: 0 }]), text: 'hi' } as Stroke;
  assert.equal(boxPickable(text), false);
  assert.equal(boxPicks([text], box(-5, -5, 5, 5)).size, 0);
  assert.equal(boxPickable(rectangle('r', 0, 0, 1, 1)), true);
});

test('Shift adds a box to what was held, mark by mark', () => {
  const held = new Map([['r', { anchors: new Set([0]), segments: new Set<number>() }]]);
  const more = new Map([
    ['r', { anchors: new Set([2]), segments: new Set<number>() }],
    ['l', { anchors: new Set([1]), segments: new Set<number>() }],
  ]);
  const both = addPicks(held, more);
  assert.deepEqual(sorted(both.get('r')!.anchors), [0, 2]);
  assert.deepEqual(sorted(both.get('l')!.anchors), [1]);
  assert.deepEqual(sorted(held.get('r')!.anchors), [0], 'what was held is not changed in place');
});

test('a move of a segment carries both its ends, and a ring seam carries its twin', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  assert.deepEqual(sorted(movedPoints(rect, { anchors: new Set(), segments: new Set([2]) })), [2, 3], 'the bottom edge: BR and BL');
  assert.deepEqual(sorted(movedPoints(rect, { anchors: new Set(), segments: new Set([3]) })), [0, 3, 4], 'the left edge ends on the seam');
  assert.deepEqual(sorted(movedPoints(rect, { anchors: new Set([1]), segments: new Set([2]) })), [1, 2, 3]);

  const closed = path('c', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true);
  assert.deepEqual(sorted(movedPoints(closed, { anchors: new Set(), segments: new Set([3]) })), [0, 3], 'the closing segment');
});

test('a press near a picked segment takes hold of it, and only a picked one', () => {
  const rect = rectangle('r', 0, 0, 100, 40);
  const bottom = new Set([2]);
  assert.equal(onPickedSegment(rect, bottom, { x: 50, y: 43 }, 4), true, 'three units under the bottom edge');
  assert.equal(onPickedSegment(rect, bottom, { x: 50, y: 50 }, 4), false, 'ten units under it');
  assert.equal(onPickedSegment(rect, bottom, { x: 50, y: 1 }, 4), false, 'on the top edge, which is not picked');
  assert.equal(onPickedSegment(rect, new Set(), { x: 50, y: 40 }, 4), false, 'nothing picked');
});

test('seam twins: a ring whose ends meet picks both ends together, an open path does not', () => {
  const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }];
  assert.deepEqual(sorted(withSeamTwins(ring, [0])), [0, 3]);
  assert.deepEqual(sorted(withSeamTwins(ring, [3])), [0, 3]);
  assert.deepEqual(sorted(withSeamTwins([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], [0])), [0]);
});
