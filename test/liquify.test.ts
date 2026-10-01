/**
 * Liquify (src/core/liquify.ts): the four brushes' fields - Bloat out by the
 * falloff and nothing at the rim, Twirl keeping distances, Pucker and Bloat
 * undoing each other in small amounts, Warp carrying what is under its
 * centre the whole way - the marks a drag bends and those it leaves, a drawn
 * shape's straight side bent, and the refit that keeps the anchors few.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { liquifyFalloff, liquifyField, liquifyMarks, liquifiable, refitLiquified, type LiquifyDab } from '../src/core/liquify.js';
import { WARP_TOLERANCE } from '../src/core/mesh-warp.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';
import type { Point, Stroke, VectorAnchor } from '../src/core/types.js';

const C = { x: 200, y: 150 };
const R = 50;
const dab = (mode: LiquifyDab['mode'], more: Partial<LiquifyDab> = {}): LiquifyDab => ({ mode, x: C.x, y: C.y, radius: R, ...more });

/** Points on a grid over the brush and a little past its rim. */
function grid(): Array<{ x: number; y: number }> {
  const out = [];
  for (let y = C.y - R - 10; y <= C.y + R + 10; y += 7) for (let x = C.x - R - 10; x <= C.x + R + 10; x += 7) out.push({ x, y });
  return out;
}

const away = (p: { x: number; y: number }): number => Math.hypot(p.x - C.x, p.y - C.y);

/** A Vector Path line, its anchors given. */
function vectorLine(id: string, anchors: VectorAnchor[], closed = false): Stroke {
  return { id, tool: 'pen', color: '#000000', width: 2, points: sampleVectorPathPoints(anchors, closed), vector: closed ? { anchors, closed } : { anchors } };
}

/** The drawn rectangle the Rectangle tool leaves: a closed polyline of five points. */
function drawnRect(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  const P = (x: number, y: number): Point => ({ x, y, pressure: 0.5 });
  return { id, tool: 'pen', color: '#000000', width: 2, sharpened: true, points: [P(x1, y1), P(x2, y1), P(x2, y2), P(x1, y2), P(x1, y1)] };
}

/** The nearest distance from a point to a polyline. */
function toPolyline(p: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)));
  }
  return best;
}

/** A path's points closer together than `step`, for measuring it. */
function dense(stroke: Stroke, step = 0.25): Point[] {
  const out: Point[] = [];
  const pts = stroke.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

test('the falloff is 1 at the centre, 0 at the rim and past it, and falls all the way', () => {
  assert.equal(liquifyFalloff(0, R), 1);
  assert.equal(liquifyFalloff(R, R), 0);
  assert.equal(liquifyFalloff(R + 1, R), 0);
  assert.equal(liquifyFalloff(3, 0), 0);
  let last = 1;
  for (let d = 1; d < R; d++) {
    const f = liquifyFalloff(d, R);
    assert.ok(f < last && f > 0, `at ${d}: ${f}`);
    last = f;
  }
});

test('Bloat moves points out by the falloff, and not at the rim', () => {
  const field = liquifyField(dab('bloat', { amount: 0.3 }));
  for (const p of grid()) {
    const q = field.point(p);
    const d = away(p);
    if (d >= R) {
      assert.deepEqual(q, p, 'nothing at or past the rim moves, to the last bit');
      continue;
    }
    const want = d * (1 + 0.3 * liquifyFalloff(d, R));
    assert.ok(Math.abs(away(q) - want) < 1e-9, `${JSON.stringify(p)} went ${away(q)} out, not ${want}`);
    // Straight out from the centre.
    if (d > 0) assert.ok(Math.abs((q.x - C.x) * (p.y - C.y) - (q.y - C.y) * (p.x - C.x)) < 1e-6);
  }
  assert.deepEqual(field.point(C), C, 'the centre stays where it is');
});

test('Twirl keeps distances to the centre, and turns most at it', () => {
  const field = liquifyField(dab('twirl', { amount: 90 }));
  for (const p of grid()) {
    const q = field.point(p);
    assert.ok(Math.abs(away(q) - away(p)) < 1e-9, `${JSON.stringify(p)}: ${away(p)} became ${away(q)}`);
  }
  // Clockwise on the screen: a point right of the centre goes down.
  const near = field.point({ x: C.x + 5, y: C.y });
  assert.ok(near.y > C.y + 4.5, JSON.stringify(near));
  const turn = (p: { x: number; y: number }): number => {
    const q = field.point(p);
    return (Math.atan2(q.y - C.y, q.x - C.x) * 180) / Math.PI;
  };
  assert.ok(turn({ x: C.x + 10, y: C.y }) > turn({ x: C.x + 40, y: C.y }));
  assert.ok(Math.abs(field.rotation({ x: C.x + 1, y: C.y }) - 90) < 2, `the plane turns ${field.rotation({ x: C.x + 1, y: C.y })} degrees at the centre`);
  assert.equal(field.rotation({ x: C.x + R + 5, y: C.y }), 0);
});

test('Pucker then Bloat by the same small amount comes back within tolerance', () => {
  const pucker = liquifyField(dab('pucker', { amount: 0.05 }));
  const bloat = liquifyField(dab('bloat', { amount: 0.05 }));
  let worst = 0;
  for (const p of grid()) {
    const q = bloat.point(pucker.point(p));
    worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y));
  }
  assert.ok(worst < WARP_TOLERANCE, `${worst} off`);
  // And Pucker draws in: a point inside the brush comes nearer the centre.
  const p = { x: C.x + 20, y: C.y };
  assert.ok(away(pucker.point(p)) < 20);
});

test('Warp carries what is under its centre the whole way, and the rest by the falloff', () => {
  const line = vectorLine('w', [{ p: { x: C.x, y: C.y - 100 } }, { p: { x: C.x, y: C.y + 100 } }]);
  const bent = liquifyMarks([line], [dab('warp', { dx: 60, dy: 0 })]).get('w');
  assert.ok(bent, 'the line under the brush is bent');
  const xs = bent.points.map((p) => p.x);
  assert.ok(Math.abs(Math.max(...xs) - (C.x + 60)) < 1, `its middle went to ${Math.max(...xs)}, not ${C.x + 60}`);
  // Its ends, far past the brush, stay exactly where they were.
  const ends = bent.vector!.anchors;
  assert.deepEqual(ends[0].p, { x: C.x, y: C.y - 100 });
  assert.deepEqual(ends[ends.length - 1].p, { x: C.x, y: C.y + 100 });
});

test("Warp dents a drawn rectangle's straight side, which becomes anchors to bend", () => {
  const rect = drawnRect('r', 100, 100, 300, 250);
  // The brush sits on the top side and pushes down, into the rectangle.
  const bent = liquifyMarks([rect], [{ mode: 'warp', x: 200, y: 100, radius: 40, dx: 0, dy: 30 }]).get('r');
  assert.ok(bent?.vector, 'the rectangle is bent as a path');
  assert.equal(bent.vector.closed, true, 'and stays closed');
  const top = bent.points.filter((p) => p.x > 180 && p.x < 220);
  assert.ok(top.some((p) => p.y > 120), `the top side is dented: ${JSON.stringify(top.map((p) => Math.round(p.y)))}`);
  // Its corners, outside the brush, have not moved.
  const corners = bent.vector.anchors.map((a) => `${a.p.x},${a.p.y}`);
  for (const c of ['100,100', '300,100', '300,250', '100,250']) assert.ok(corners.includes(c), `${c} kept`);
});

test('only the marks the brush reaches are bent, and Liquify leaves pencil, text, pictures and erasers alone', () => {
  const near = vectorLine('near', [{ p: { x: 180, y: 150 } }, { p: { x: 220, y: 150 } }]);
  const far = vectorLine('far', [{ p: { x: 500, y: 500 } }, { p: { x: 540, y: 500 } }]);
  const pencil: Stroke = { ...near, id: 'pencil', tool: 'pencil', pencil: { medium: 'graphite', grade: 'HB' } };
  const eraser: Stroke = { ...near, id: 'eraser', tool: 'eraser' };
  const text: Stroke = { id: 'text', tool: 'text', color: '#000000', width: 1, points: [{ x: 200, y: 150 }, { x: 210, y: 160 }], text: 'hi', fontSize: 16 };
  const bent = liquifyMarks([near, far, pencil, eraser, text], [dab('twirl', { amount: 40 })]);
  assert.deepEqual([...bent.keys()], ['near']);
  assert.equal(liquifiable(pencil), false);
  assert.equal(liquifiable(eraser), false);
  assert.equal(liquifiable(text), false);
  assert.equal(liquifiable(near), true);
  // A brush in empty space bends nothing.
  assert.equal(liquifyMarks([near, far], [{ mode: 'bloat', x: 900, y: 900, radius: 30, amount: 0.5 }]).size, 0);
});

test('a Copic nib turns with a Twirl, and the marks given are not changed', () => {
  const nib: Stroke = { ...vectorLine('c', [{ p: { x: 190, y: 150 } }, { p: { x: 210, y: 150 } }]), tool: 'copic', nibAngle: 30 };
  const before = JSON.stringify(nib);
  const bent = liquifyMarks([nib], [dab('twirl', { amount: 60 })]).get('c');
  assert.ok(bent && bent.nibAngle !== undefined && bent.nibAngle > 60, `the nib turned to ${bent?.nibAngle}`);
  assert.equal(JSON.stringify(nib), before);
});

test('the refit stays within tolerance, with fewer anchors than the carried curve', () => {
  // A long line through the brush, twirled hard in many small dabs, as a held press does.
  const line = vectorLine('t', [{ p: { x: 120, y: 150 } }, { p: { x: 280, y: 150 } }]);
  const dabs = Array.from({ length: 60 }, () => dab('twirl', { amount: 3 }));
  const carried = liquifyMarks([line], dabs).get('t')!;
  const refit = refitLiquified(carried, 0.5);
  assert.ok(refit.vector!.anchors.length < carried.vector!.anchors.length, `${refit.vector!.anchors.length} anchors, not fewer than ${carried.vector!.anchors.length}`);
  const along = dense(carried);
  let worst = 0;
  for (const p of dense(refit)) worst = Math.max(worst, toPolyline(p, along));
  for (const p of dense(carried)) worst = Math.max(worst, toPolyline(p, dense(refit)));
  assert.ok(worst < 0.5 + 0.05, `the refit strays ${worst}`);
  // The same through liquifyMarks's own refit.
  const once = liquifyMarks([line], dabs, { refit: 0.5 }).get('t')!;
  assert.deepEqual(once.vector!.anchors, refit.vector!.anchors);
});

test("the refit keeps a rectangle's corners and leaves a path it cannot shorten as it was", () => {
  const rect = drawnRect('r', 100, 100, 300, 250);
  const dabs = Array.from({ length: 20 }, (_, k) => ({ mode: 'warp' as const, x: 200, y: 100 + k * 1.5, radius: 40, dx: 0, dy: 1.5 }));
  const bent = liquifyMarks([rect], dabs, { refit: 0.75 }).get('r')!;
  const corners = bent.vector!.anchors.filter((a) => [100, 300].includes(Math.round(a.p.x)) && [100, 250].includes(Math.round(a.p.y)));
  assert.equal(corners.length, 4, JSON.stringify(bent.vector!.anchors.map((a) => [Math.round(a.p.x), Math.round(a.p.y)])));
  const two = vectorLine('two', [{ p: { x: 0, y: 0 } }, { p: { x: 10, y: 0 }, hIn: { x: 5, y: 5 } }]);
  assert.equal(refitLiquified(two, 0.5), two);
});

test("the refit keeps a dented rectangle's straight parts exactly straight, and fits the dent alone", () => {
  const rect = drawnRect('r', 100, 100, 300, 250);
  const dabs = Array.from({ length: 20 }, (_, k) => ({ mode: 'warp' as const, x: 200, y: 100 + k * 1.5, radius: 40, dx: 0, dy: 1.5 }));
  const carried = liquifyMarks([rect], dabs).get('r')!;
  const refit = refitLiquified(carried, 1.5);
  assert.ok(refit.vector!.anchors.length < carried.vector!.anchors.length, `${refit.vector!.anchors.length} anchors, from ${carried.vector!.anchors.length}`);
  // The carrier split the top side at its quarters, round the brush (160 to 240): outside those
  // pieces it is still the line it was, to the last bit, and so are the other three sides.
  assert.deepEqual(
    refit.vector!.anchors.filter((a) => !a.hIn && !a.hOut).map((a) => [a.p.x, a.p.y]),
    [[100, 100], [300, 100], [300, 250], [100, 250]],
    'the corners, between lines',
  );
  for (const p of dense(refit, 1)) {
    if (p.y < 99.999 || (p.x > 150 && p.x < 250)) continue;
    const onSide = p.y === 100 || p.y === 250 || p.x === 100 || p.x === 300;
    assert.ok(onSide, `${JSON.stringify(p)} is off the rectangle's sides`);
  }
  // And the dent is still there, smooth.
  assert.ok(Math.max(...refit.points.filter((p) => p.y < 175).map((p) => p.y)) > 120, 'dented');
});

test('a Vector Path the brush bends without splitting keeps the anchors it was drawn with', () => {
  // Five anchors on a gentle arc, nudged by a small, wide Bloat: no segment needs splitting.
  const arc: VectorAnchor[] = [0, 1, 2, 3, 4].map((k) => ({ p: { x: 150 + k * 25, y: 150 + Math.abs(k - 2) * 4 } }));
  const path = vectorLine('v', arc);
  const bent = liquifyMarks([path], [{ mode: 'bloat', x: 200, y: 170, radius: 120, amount: 0.02 }], { refit: 1.5 }).get('v')!;
  assert.equal(bent.vector!.anchors.length, arc.length);
  assert.notDeepEqual(bent.vector!.anchors.map((a) => a.p), arc.map((a) => a.p), 'it was bent');
  // A drawn ellipse, all points, is fitted: 64 corners become a few curves.
  const ring: Point[] = [];
  for (let k = 0; k <= 64; k++) ring.push({ x: 200 + 80 * Math.cos((k / 64) * 2 * Math.PI), y: 150 + 50 * Math.sin((k / 64) * 2 * Math.PI), pressure: 0.5 });
  ring[64] = { ...ring[0] };
  const ellipse: Stroke = { id: 'e', tool: 'pen', color: '#000000', width: 2, sharpened: true, points: ring };
  const bloated = liquifyMarks([ellipse], [{ mode: 'bloat', x: 250, y: 150, radius: 40, amount: 0.3 }], { refit: 1.5 }).get('e')!;
  assert.ok(bloated.vector!.closed === true && bloated.vector!.anchors.length < 16, `${bloated.vector!.anchors.length} anchors`);
  // The edge at 280 is 30 from the brush's centre: out by 0.3 of the falloff there, (1 - (30/40)²)², of its 30.
  const edge = 250 + 30 * (1 + 0.3 * (1 - (30 / 40) ** 2) ** 2);
  assert.ok(Math.abs(Math.max(...bloated.points.map((p) => p.x)) - edge) < 0.05, `Bloat inside the edge pushes it out to ${edge}`);
});
