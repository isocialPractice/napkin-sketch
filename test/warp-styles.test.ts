/**
 * The warp styles (core/warp-styles.ts): each a closed-form map over a box.
 *
 * The box in most of these is 200 wide and 100 tall, its top left at the
 * origin, so its middle is (100, 50), a half-width is 100 and a half-height
 * 50: a style that moves a point by `dU` half-widths across and `dV`
 * half-heights up moves it by `100 dU` and `-50 dV` on the page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapStrokeGeometry } from '../src/core/mesh-warp.js';
import { WARP_STYLES, WARP_STYLE_ORIGINS, warpPartFor, warpPartsOf, warpStyleMap, warpStyleOf, type WarpOptions, type WarpStyle } from '../src/core/warp-styles.js';
import type { Stroke } from '../src/core/types.js';

const BOX = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

const options = (extra: Partial<WarpOptions> = {}): WarpOptions => ({ orientation: 'horizontal', bend: 50, distortH: 0, distortV: 0, part: 'whole', ...extra });

const at = (style: WarpStyle, x: number, y: number, extra: Partial<WarpOptions> = {}): [number, number] => {
  const p = warpStyleMap(style, BOX, options({ part: warpPartFor(style, extra.part), ...extra })).point({ x, y });
  return [p.x, p.y];
};

const near = (got: [number, number], want: [number, number], what: string, tolerance = 1e-6): void => {
  assert.ok(Math.abs(got[0] - want[0]) <= tolerance && Math.abs(got[1] - want[1]) <= tolerance, `${what}: (${got.join(', ')}) is not (${want.join(', ')})`);
};

test('at no bend and no distortion every style leaves every point exactly where it was', () => {
  for (const style of WARP_STYLES) {
    for (const part of warpPartsOf(style)) {
      const map = warpStyleMap(style, BOX, options({ bend: 0, part }));
      for (const [x, y] of [[0, 0], [37.5, 81.25], [200, 100], [-40, 300], [100, 50]]) {
        const p = map.point({ x, y });
        assert.ok(p.x === x && p.y === y, `${style} ${part} moved (${x}, ${y}) to (${p.x}, ${p.y})`);
      }
      assert.deepEqual(map.jacobian({ x: 10, y: 10 }), [1, 0, 0, 1]);
      assert.equal(map.rotation({ x: 10, y: 10 }), 0);
    }
  }
});

test('each style takes the box\'s corners and middles where its formula puts them', () => {
  // Arc: the line through the middle bends round a quarter turn at 50%, its length kept.
  const R = 4 / Math.PI;
  near(at('arc', 100, 0), [100, 0], 'arc keeps the top of its middle');
  near(at('arc', 200, 50), [100 + 100 * R * Math.sin(Math.PI / 4), 50 + (50 * R * (1 - Math.cos(Math.PI / 4))) / 0.5], 'arc bends the middle line\'s end down and in');
  near(at('arc', 0, 50), [100 - 100 * R * Math.sin(Math.PI / 4), 50 + (50 * R * (1 - Math.cos(Math.PI / 4))) / 0.5], 'and its other end alike');
  // Arch lifts the whole box at its middle, its sides upright.
  near(at('arch', 100, 0), [100, -25], 'arch lifts the top middle half its half-height');
  near(at('arch', 100, 100), [100, 75], 'and the bottom middle as far');
  near(at('arch', 0, 0), [0, 0], 'and leaves the corners');
  // Unroll (Bulge): the height swells at the middle.
  near(at('unroll', 100, 0), [100, -25], 'unroll swells the top');
  near(at('unroll', 100, 100), [100, 125], 'and the bottom');
  near(at('unroll', 200, 0), [200, 0], 'and leaves the corners');
  // Shell: one edge bows, the other stays.
  near(at('shell', 100, 100, { part: 'lower' }), [100, 125], 'shell lower bows the bottom out');
  near(at('shell', 100, 0, { part: 'lower' }), [100, 0], 'and leaves the top');
  near(at('shell', 100, 0, { part: 'upper' }), [100, -25], 'shell upper bows the top out');
  near(at('shell', 100, 100, { part: 'upper' }), [100, 100], 'and leaves the bottom');
  // Windy (Flag): one wave across, top and bottom together.
  near(at('windy', 150, 0), [150, -12.5], 'windy lifts a quarter of the way in from the right');
  near(at('windy', 50, 100), [50, 112.5], 'and drops a quarter in from the left');
  near(at('windy', 0, 0), [0, 0], 'and leaves the corners', 1e-9);
  // Breezy (Wave): its phase drifts with the height.
  near(at('breezy', 100, 0), [100, -12.5], 'breezy lifts the top middle');
  near(at('breezy', 100, 50), [100, 50], 'and leaves the very middle');
  // Curvy (Fish): a body that swells, then a tail.
  near(at('curvy', 200 / 3, 0), [200 / 3, -15], 'curvy swells a third of the way in');
  near(at('curvy', 200, 0), [200, 15], 'and narrows to its tail at the right');
  near(at('curvy', 0, 0), [0, 0], 'and leaves the left end');
  // Chart (Rise): climbing to the right.
  near(at('chart', 200, 0), [200, -25], 'chart lifts the right edge');
  near(at('chart', 200, 100), [200, 75], 'all of it');
  near(at('chart', 0, 0), [0, 0], 'and leaves the left');
  // Puffy (Fisheye): out from the middle, most near it.
  near(at('puffy', 100, 50), [100, 50], 'puffy leaves its middle');
  near(at('puffy', 150, 50), [150 + 100 * 0.5 * 0.45 * Math.exp(-0.5), 50], 'and moves a point out along its ray');
  // Expand (Inflate): every edge bows out at its middle.
  near(at('expand', 200, 50), [225, 50], 'expand bows the right edge out');
  near(at('expand', 100, 0), [100, -12.5], 'and the top');
  near(at('expand', 200, 0), [200, 0], 'and leaves the corners');
  // Cram (Squeeze): the sides pulled in at the middle of the height.
  near(at('cram', 200, 50), [175, 50], 'cram pulls the right side in');
  near(at('cram', 200, 0), [200, 0], 'and leaves the corners');
  // Twirl (Twist): the middle turns most.
  const alpha = 0.5 * Math.PI * Math.exp(-1.5 * 0.25);
  near(at('twirl', 150, 50), [100 + 50 * Math.cos(alpha), 50 - 25 * Math.sin(alpha)], 'twirl turns a point round the middle');
  near(at('twirl', 100, 50), [100, 50], 'and leaves the middle itself');
});

test('a negative bend bends the other way, and distortion tapers the box first', () => {
  near(at('arch', 100, 0, { bend: -50 }), [100, 25], 'arch at -50% presses the middle down');
  near(at('arc', 100, 100, { bend: -50 }), [100, 100], 'arc at -50% keeps the bottom of its middle');
  // Horizontal distortion scales the height across: half again at the right, half at the left.
  near(at('arch', 200, 0, { bend: 0, distortH: 50 }), [200, -25], 'the right side taller');
  near(at('arch', 0, 0, { bend: 0, distortH: 50 }), [0, 25], 'the left side shorter');
  // Vertical distortion scales the width up it.
  near(at('arch', 200, 0, { bend: 0, distortV: 50 }), [250, 0], 'the top wider');
  near(at('arch', 200, 100, { bend: 0, distortV: 50 }), [150, 100], 'the bottom narrower');
});

test('every style is continuous: a small step never makes a large jump', () => {
  for (const style of WARP_STYLES) {
    for (const part of warpPartsOf(style)) {
      for (const bend of [100, -100, 37]) {
        const map = warpStyleMap(style, BOX, options({ bend, part, distortH: 20, distortV: -15 }));
        for (let k = 0; k < 400; k++) {
          // A deterministic scatter over the box and past its edges.
          const x = -50 + ((k * 73) % 300);
          const y = -40 + ((k * 37) % 180);
          const a = map.point({ x, y });
          const b = map.point({ x: x + 1e-3, y: y + 1e-3 });
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.1, `${style} ${part} ${bend}% jumps at (${x}, ${y})`);
        }
      }
    }
  }
});

test('a vertical warp is the horizontal one with the box\'s x and y swapped', () => {
  const swap = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.y, y: p.x });
  const tall = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
  for (const style of WARP_STYLES) {
    for (const part of warpPartsOf(style)) {
      const vertical = warpStyleMap(style, BOX, options({ orientation: 'vertical', part, bend: 60 }));
      const horizontal = warpStyleMap(style, tall, options({ part, bend: 60 }));
      for (const [x, y] of [[0, 0], [200, 100], [130, 20], [55, 75], [100, 50]]) {
        const got = vertical.point({ x, y });
        const want = swap(horizontal.point(swap({ x, y })));
        near([got.x, got.y], [want.x, want.y], `${style} ${part} at (${x}, ${y})`, 1e-9);
      }
    }
  }
});

test('Part Lower leaves the top edge where it was, and Part Upper the bottom', () => {
  for (const style of ['arc', 'shell'] as const) {
    const lower = warpStyleMap(style, BOX, options({ part: 'lower' }));
    const upper = warpStyleMap(style, BOX, options({ part: 'upper' }));
    for (let x = 0; x <= 200; x += 25) {
      assert.deepEqual(lower.point({ x, y: 0 }), { x, y: 0 }, `${style} lower keeps the top at ${x}`);
      assert.deepEqual(upper.point({ x, y: 100 }), { x, y: 100 }, `${style} upper keeps the bottom at ${x}`);
    }
    // Arc's middle stands over the arc's centre, so its bottom moves only off it.
    assert.notDeepEqual(lower.point({ x: 160, y: 100 }), { x: 160, y: 100 }, `${style} lower moves the bottom`);
  }
});

test('a style reads by this app\'s name or a vector editor\'s, and Arc and Shell take their parts', () => {
  assert.deepEqual(warpStyleOf('Arc'), { style: 'arc' });
  assert.deepEqual(warpStyleOf('bulge'), { style: 'unroll' });
  assert.deepEqual(warpStyleOf('FISHEYE'), { style: 'puffy' });
  assert.deepEqual(warpStyleOf('Arc Lower'), { style: 'arc', part: 'lower' });
  assert.deepEqual(warpStyleOf('shell-upper'), { style: 'shell', part: 'upper' });
  assert.equal(warpStyleOf('spiral'), undefined);
  for (const style of WARP_STYLES) assert.deepEqual(warpStyleOf(WARP_STYLE_ORIGINS[style]), { style });
  assert.deepEqual(warpPartsOf('arc'), ['whole', 'lower', 'upper']);
  assert.deepEqual(warpPartsOf('shell'), ['lower', 'upper'], 'a whole Shell is Unroll, so it has none');
  assert.deepEqual(warpPartsOf('twirl'), ['whole']);
  assert.equal(warpPartFor('shell', 'whole'), 'lower');
  assert.equal(warpPartFor('windy', 'upper'), 'whole');
});

test('carried along its tangents, a warped rectangle keeps few anchors, and a parabolic style none past its corners', () => {
  const rect: Stroke = {
    id: 'rect',
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    points: [{ x: 0, y: 0, pressure: 0.5 }],
    vector: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 200, y: 0 } }, { p: { x: 200, y: 100 } }, { p: { x: 0, y: 100 } }], closed: true },
  };
  const count = (style: WarpStyle, bend: number, part = warpPartFor(style, undefined)): number =>
    mapStrokeGeometry(rect, warpStyleMap(style, BOX, options({ bend, part }))).vector!.anchors.length;
  for (const style of ['arch', 'unroll', 'shell', 'chart', 'expand', 'cram'] as const) {
    assert.equal(count(style, 100), 4, `${style} bends each edge into one curve: a parabola is a cubic`);
  }
  assert.ok(count('arc', 50) <= 8, `arc at 50%: ${count('arc', 50)} anchors`);
  assert.ok(count('arc', 100) <= 12, `arc at 100%: ${count('arc', 100)} anchors`);
  for (const style of WARP_STYLES) assert.ok(count(style, 100) <= 32, `${style} at 100%: ${count(style, 100)} anchors`);
  // A bent edge leaves as a curve whose handles are in line at each new anchor.
  const arc = mapStrokeGeometry(rect, warpStyleMap('arc', BOX, options())).vector!.anchors;
  const added = arc.filter((anchor) => anchor.hIn && anchor.hOut);
  assert.ok(added.length > 0, 'the arc added anchors with handles both ways');
  for (const anchor of added) {
    const a = { x: anchor.hIn!.x - anchor.p.x, y: anchor.hIn!.y - anchor.p.y };
    const b = { x: anchor.hOut!.x - anchor.p.x, y: anchor.hOut!.y - anchor.p.y };
    assert.ok(Math.abs(a.x * b.y - a.y * b.x) <= 1e-6 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) + 1e-9, 'its handles are in line: the curve is smooth there');
  }
});

test('a map\'s derivative and its turn agree with a step along it', () => {
  const map = warpStyleMap('twirl', BOX, options({ bend: 80 }));
  const p = { x: 130, y: 40 };
  const [a, b, c, d] = map.jacobian(p);
  const h = 1e-3;
  const q = map.point(p);
  const qx = map.point({ x: p.x + h, y: p.y });
  const qy = map.point({ x: p.x, y: p.y + h });
  near([(qx.x - q.x) / h, (qx.y - q.y) / h], [a, c], 'd/dx', 1e-3);
  near([(qy.x - q.x) / h, (qy.y - q.y) / h], [b, d], 'd/dy', 1e-3);
  const turn = map.rotation(p);
  // A positive bend turns counterclockwise on the page, as an angle up from the right does.
  assert.ok(turn < 0 && turn > -180, `a positive twirl turns counterclockwise on the page (${turn})`);
});
