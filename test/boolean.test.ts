/**
 * Boolean operations on regions (`src/core/boolean.ts`): union, difference
 * and intersection of contour sets under either fill rule, with the corners a
 * cut makes reported. Areas are the shoelace sum of the result (holes wound
 * the other way), held to the exact figure where there is one and to a
 * seeded Monte Carlo count over the first operand's bounds where there is
 * not - a grid would gain or lose whole columns along a thin shape's edge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BOOLEAN_EDGE_LIMIT, booleanOp, booleanRegions, type Vec } from '../src/core/boolean.js';
import { disc, signedArea } from '../src/core/graphic-design/geometry.js';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The area a result fills: its contours' signed areas summed, a hole's taking away. `signedArea` is the doubled sum. */
const areaOf = (contours: Vec[][]): number => Math.abs(contours.reduce((sum, c) => sum + signedArea(c), 0)) / 2;

/** The area of a convex polygon clipped to a rectangle (Sutherland-Hodgman): an answer worked out another way. */
function clippedArea(poly: Vec[], x0: number, y0: number, x1: number, y1: number): number {
  let out = poly;
  const edges: Array<[(p: Vec) => boolean, (a: Vec, b: Vec) => Vec]> = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((x0 - a.x) / (b.x - a.x)) * (b.y - a.y) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((x1 - a.x) / (b.x - a.x)) * (b.y - a.y) })],
    [(p) => p.y >= y0, (a, b) => ({ x: a.x + ((y0 - a.y) / (b.y - a.y)) * (b.x - a.x), y: y0 })],
    [(p) => p.y <= y1, (a, b) => ({ x: a.x + ((y1 - a.y) / (b.y - a.y)) * (b.x - a.x), y: y1 })],
  ];
  for (const [inside, cut] of edges) {
    const next: Vec[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      if (inside(b)) {
        if (!inside(a)) next.push(cut(a, b));
        next.push(b);
      } else if (inside(a)) next.push(cut(a, b));
    }
    out = next;
  }
  return out.length >= 3 ? Math.abs(signedArea(out)) / 2 : 0;
}

const SQ = [rect(0, 0, 100, 100)];

test('a square less a square inside it keeps a hole', () => {
  const out = booleanOp(SQ, [rect(25, 25, 75, 75)], 'difference')!;
  assert.equal(out.length, 2);
  assert.ok(Math.abs(areaOf(out) - 7500) < 1e-6, `${areaOf(out)}`);
  // The outer contour and the hole wind opposite ways, so either rule fills them alike.
  assert.ok(Math.sign(signedArea(out[0])) !== Math.sign(signedArea(out[1])));
});

test('a square less one across its edge, and less a band through it', () => {
  const bitten = booleanOp(SQ, [rect(50, 25, 150, 75)], 'difference')!;
  assert.equal(bitten.length, 1);
  assert.ok(Math.abs(areaOf(bitten) - 7500) < 1e-6, `${areaOf(bitten)}`);
  const split = booleanOp(SQ, [rect(-10, 40, 110, 60)], 'difference')!;
  assert.equal(split.length, 2, 'the band cuts it in two');
  assert.ok(Math.abs(areaOf(split) - 8000) < 1e-6, `${areaOf(split)}`);
});

test('a circle less a rectangle through its middle matches the area worked out by clipping', () => {
  const circle = disc({ x: 50, y: 50 }, 50, 64);
  const out = booleanOp([circle], [rect(30, -10, 70, 110)], 'difference')!;
  const expected = Math.abs(signedArea(circle)) / 2 - clippedArea(circle, 30, -10, 70, 110);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(areaOf(out) - expected) < 1e-6, `${areaOf(out)} for ${expected}`);
});

test('edges laid along each other, and corners that only touch, cut cleanly', () => {
  const half = booleanOp(SQ, [rect(50, 0, 100, 100)], 'difference')!;
  assert.ok(Math.abs(areaOf(half) - 5000) < 1e-6, `shared edges: ${areaOf(half)}`);
  const touching = booleanOp(SQ, [rect(100, 100, 200, 200)], 'difference')!;
  assert.equal(touching.length, 1);
  assert.ok(Math.abs(areaOf(touching) - 10000) < 1e-6, `a corner touching outside: ${areaOf(touching)}`);
  const corner = booleanOp(SQ, [rect(50, 50, 100, 100)], 'difference')!;
  assert.ok(Math.abs(areaOf(corner) - 7500) < 1e-6, `a corner square sharing two half edges: ${areaOf(corner)}`);
});

test('a compound shape with a hole, less a band, under either fill rule', () => {
  const band = [rect(-10, 45, 110, 55)];
  // Non-zero: the hole is wound the other way.
  const nonzero = booleanOp([rect(0, 0, 100, 100), rect(30, 30, 70, 70).reverse()], band, 'difference')!;
  assert.ok(Math.abs(areaOf(nonzero) - 7800) < 1e-6, `${areaOf(nonzero)}`);
  // Even-odd: the hole is wound the same way, and still a hole.
  const evenodd = booleanOp([rect(0, 0, 100, 100), rect(30, 30, 70, 70)], band, 'difference', { ruleA: 'evenodd' })!;
  assert.ok(Math.abs(areaOf(evenodd) - 7800) < 1e-6, `${areaOf(evenodd)}`);
  // Under non-zero the same-wound inner square is no hole at all.
  const filled = booleanOp([rect(0, 0, 100, 100), rect(30, 30, 70, 70)], band, 'difference')!;
  assert.ok(Math.abs(areaOf(filled) - 9000) < 1e-6, `${areaOf(filled)}`);
});

test('union and intersection of two overlapping squares', () => {
  const other = [rect(50, 50, 150, 150)];
  const union = booleanOp(SQ, other, 'union')!;
  assert.equal(union.length, 1);
  assert.ok(Math.abs(areaOf(union) - 17500) < 1e-6);
  const both = booleanOp(SQ, other, 'intersection')!;
  assert.equal(both.length, 1);
  assert.ok(Math.abs(areaOf(both) - 2500) < 1e-6);
});

test('an operand may be a soup of overlapping pieces, wound alike', () => {
  const soup = [rect(0, 0, 60, 100), rect(40, 0, 100, 100)];
  // The union of the soup with nothing is its boundary: one square.
  const whole = booleanOp(soup, [], 'union')!;
  assert.equal(whole.length, 1);
  assert.ok(Math.abs(areaOf(whole) - 10000) < 1e-6);
  const cut = booleanOp(soup, [rect(-10, 40, 110, 60)], 'difference')!;
  assert.ok(Math.abs(areaOf(cut) - 8000) < 1e-6, `${areaOf(cut)}`);
});

test('the corners a cut makes are reported, by the points the contours hold', () => {
  const result = booleanRegions(SQ, [rect(-10, 40, 110, 60)], 'difference')!;
  assert.equal(result.junctions.size, 4);
  const onContours = result.contours.flat().filter((p) => result.junctions.has(p));
  assert.equal(onContours.length, 4, 'every junction is a vertex of a contour');
  for (const p of onContours) assert.ok(p.x === 0 || p.x === 100, `a junction on the square's side: ${p.x}, ${p.y}`);
  assert.equal(result.fromB, true);
  // A cutter that misses changes nothing, and says so.
  const missed = booleanRegions(SQ, [rect(200, 200, 300, 300)], 'difference')!;
  assert.equal(missed.fromB, false);
  assert.equal(missed.junctions.size, 0);
  assert.ok(Math.abs(areaOf(missed.contours) - 10000) < 1e-6);
});

test('nothing to cut, or nothing left', () => {
  assert.deepEqual(booleanOp([], [], 'difference'), []);
  assert.deepEqual(booleanOp([], SQ, 'difference'), []);
  assert.deepEqual(booleanOp(SQ, [rect(-10, -10, 110, 110)], 'difference'), [], 'a cutter over all of it leaves nothing');
  assert.ok(Math.abs(areaOf(booleanOp(SQ, [], 'difference')!) - 10000) < 1e-6, 'and none leaves it whole');
});

test('past the edge limit the answer is null', () => {
  const many: Vec[] = [];
  const n = BOOLEAN_EDGE_LIMIT + 1;
  for (let i = 0; i < n; i++) many.push({ x: 50 + 40 * Math.cos((i / n) * Math.PI * 2), y: 50 + 40 * Math.sin((i / n) * Math.PI * 2) });
  assert.equal(booleanOp([many], [], 'union'), null);
});

test('an irregular shape less a swath is the true region at every sample', () => {
  // A star, less a looping band that crosses it many times.
  const star: Vec[] = [];
  for (let i = 0; i < 18; i++) {
    const r = i % 2 === 0 ? 90 : 35;
    const a = (i / 18) * Math.PI * 2;
    star.push({ x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) });
  }
  const band: Vec[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    band.push({ x: 100 + 60 * Math.cos(a) + 25 * Math.cos(3 * a), y: 100 + 60 * Math.sin(a) });
  }
  const out = booleanOp([star], [band], 'difference')!;
  assert.ok(out.length > 1);
  // Sample by sample over the star's bounds, the result's own fill against
  // the operation's meaning - in the star and not in the band - rather than
  // an area against an area, which sampling noise would blur.
  const winding = (contours: Vec[][], x: number, y: number): number => {
    let w = 0;
    for (const poly of contours) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (a.y <= y === b.y <= y) continue;
        const cx = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (cx > x) w += b.y > a.y ? 1 : -1;
      }
    }
    return w;
  };
  let seed = 0x9e3779b9;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let disagree = 0;
  let inTruth = 0;
  for (let i = 0; i < 200000; i++) {
    const x = 10 + rand() * 180;
    const y = 10 + rand() * 180;
    const truth = winding([star], x, y) !== 0 && winding([band], x, y) === 0;
    if (truth) inTruth++;
    if (truth !== (winding(out, x, y) !== 0)) disagree++;
  }
  assert.ok(inTruth > 5000, `the cut leaves a good part of the star (${inTruth} samples)`);
  assert.equal(disagree, 0);
});
