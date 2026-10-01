/**
 * Freehand samples fitted as few cubic Béziers: within the tolerance of every
 * sample, corners kept, pressure carried, straight runs as lines, loops
 * closed smoothly. The GUI check `check-freehand.mjs` holds the app's pen to
 * the same.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitCurve } from '../src/core/fit-curve.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';
import { fitPoints, fitStroke, sharpenStroke } from '../src/sharpen/sharpen.js';
import type { Point, Stroke, VectorAnchor } from '../src/core/types.js';

/** Samples along `path` a hand's distance apart - three quarters of a pixel, as the app keeps them - with a small wobble. */
function hand(path: (s: number) => { x: number; y: number }, steps: number, wobble = 0.3, pressure?: (s: number) => number): Point[] {
  const out: Point[] = [];
  let seed = 7;
  const rand = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296) - 0.5;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const p = path(s);
    const point: Point = { x: p.x + rand() * wobble, y: p.y + rand() * wobble };
    point.pressure = pressure ? pressure(s) : 0.5;
    const last = out[out.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.75 || i === steps) out.push(point);
  }
  return out;
}

/** The largest distance from any sample to the path the anchors draw. */
function deviation(samples: Point[], anchors: VectorAnchor[], closed = false): number {
  const drawn = sampleVectorPathPoints(anchors, closed);
  let worst = 0;
  for (const p of samples) {
    let best = Infinity;
    for (let i = 1; i < drawn.length; i++) {
      const a = drawn[i - 1];
      const b = drawn[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

test('a drawn arc fits within the tolerance in a few anchors', () => {
  const arc = hand((s) => ({ x: 100 * Math.cos(Math.PI * s), y: 100 * Math.sin(Math.PI * s) }), 600);
  assert.ok(arc.length > 300, `${arc.length} samples`);
  const anchors = fitCurve(arc, { tolerance: 1.5 })!;
  assert.ok(anchors.length <= 5, `${anchors.length} anchors for a half circle`);
  assert.ok(deviation(arc, anchors) <= 1.5 + 1e-6, `strays ${deviation(arc, anchors)}`);
  // Every join between two pieces is smooth: its handles are collinear through the anchor.
  for (const a of anchors.slice(1, -1)) {
    const inDir = { x: a.p.x - a.hIn!.x, y: a.p.y - a.hIn!.y };
    const outDir = { x: a.hOut!.x - a.p.x, y: a.hOut!.y - a.p.y };
    const cross = (inDir.x * outDir.y - inDir.y * outDir.x) / (Math.hypot(inDir.x, inDir.y) * Math.hypot(outDir.x, outDir.y));
    assert.ok(Math.abs(cross) < 1e-6, `a smooth join turns by ${cross}`);
  }
  // A tighter tolerance buys a closer fit with more anchors, and still not many.
  const tight = fitCurve(arc, { tolerance: 0.5 })!;
  assert.ok(tight.length >= anchors.length && tight.length <= 16, `${tight.length} anchors at 0.5`);
  assert.ok(deviation(arc, tight) <= 0.5 + 1e-6);
});

test('a drawn corner stays a corner', () => {
  const ell = hand((s) => (s < 0.5 ? { x: 0, y: 200 * s } : { x: 200 * (s - 0.5), y: 100 }), 400, 0.2);
  const anchors = fitCurve(ell, { tolerance: 1.5 })!;
  const corner = anchors.find((a) => Math.hypot(a.p.x, a.p.y - 100) < 3);
  assert.ok(corner, `an anchor at the corner, among ${anchors.map((a) => `${a.p.x.toFixed(1)},${a.p.y.toFixed(1)}`).join(' ')}`);
  // Two straight legs: three anchors, no handles anywhere.
  assert.equal(anchors.length, 3);
  assert.ok(anchors.every((a) => !a.hIn && !a.hOut), 'straight legs are lines');
});

test('a straight run is one segment with no handles', () => {
  const line = hand((s) => ({ x: 300 * s, y: 40 * s }), 400, 0.1);
  const anchors = fitCurve(line, { tolerance: 1.5 })!;
  assert.equal(anchors.length, 2);
  assert.equal(anchors[0].hOut, undefined);
  assert.equal(anchors[1].hIn, undefined);
});

test("a stylus's pressure is carried, and a swell splits a piece of its own", () => {
  // A straight line pressed hard in the middle: pressure 0.2, up to 0.9, back to 0.2.
  const swell = hand((s) => ({ x: 300 * s, y: 0 }), 400, 0, (s) => 0.2 + 0.7 * Math.sin(Math.PI * s));
  const anchors = fitCurve(swell, { tolerance: 1.5 })!;
  assert.ok(anchors.length > 2, 'the swell needs more than the two ends');
  assert.ok(anchors.every((a) => a.pressure !== undefined), 'every anchor has its pressure');
  const drawn = sampleVectorPathPoints(anchors, false);
  // The pressure the drawn path carries, run evenly along it as the painter
  // runs a width, follows the stylus to within the tolerance.
  const pressureAt = (x: number): number => {
    for (let i = 1; i < drawn.length; i++) {
      const a = drawn[i - 1];
      const b = drawn[i];
      if (x < a.x || x > b.x) continue;
      const t = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
      return (a.pressure ?? 0.5) + ((b.pressure ?? 0.5) - (a.pressure ?? 0.5)) * t;
    }
    return drawn[drawn.length - 1].pressure ?? 0.5;
  };
  for (const p of swell) {
    const at = pressureAt(p.x);
    assert.ok(Math.abs(at - (p.pressure ?? 0.5)) <= 0.1 + 1e-9, `pressure at ${p.x.toFixed(1)}: ${at.toFixed(3)} for ${p.pressure?.toFixed(3)}`);
  }
  // The mouse's even 0.5 splits nothing: the same line is two anchors.
  const mouse = hand((s) => ({ x: 300 * s, y: 0 }), 400, 0);
  assert.equal(fitCurve(mouse, { tolerance: 1.5 })!.length, 2);
});

test('a closed loop keeps one seam, smooth, with no anchor doubled', () => {
  const loop = hand((s) => ({ x: 80 * Math.cos(2 * Math.PI * s), y: 80 * Math.sin(2 * Math.PI * s) }), 800, 0.2);
  loop[loop.length - 1] = { ...loop[0] };
  const anchors = fitCurve(loop, { tolerance: 1.5, closed: true })!;
  assert.ok(anchors.length >= 3 && anchors.length <= 8, `${anchors.length} anchors round a circle`);
  const seam = anchors[0];
  assert.ok(seam.hIn && seam.hOut, 'the seam has both its handles');
  const inDir = { x: seam.p.x - seam.hIn!.x, y: seam.p.y - seam.hIn!.y };
  const outDir = { x: seam.hOut!.x - seam.p.x, y: seam.hOut!.y - seam.p.y };
  const cross = (inDir.x * outDir.y - inDir.y * outDir.x) / (Math.hypot(inDir.x, inDir.y) * Math.hypot(outDir.x, outDir.y));
  assert.ok(Math.abs(cross) < 1e-6, 'and they are collinear: the seam is smooth');
  const last = anchors[anchors.length - 1];
  assert.ok(Math.hypot(last.p.x - seam.p.x, last.p.y - seam.p.y) > 1, 'the seam is not doubled at the end');
  assert.ok(deviation(loop, anchors, true) <= 1.5 + 1e-6);
});

test('a loop smaller than the tolerance is still two places, not one anchor doubled', () => {
  // A doodle 1.2 pixels across, closed: one cubic from the seam back to it
  // would leave two anchors on the same spot.
  const tiny: Point[] = [];
  for (let i = 0; i <= 12; i++) tiny.push({ x: 0.6 * Math.cos((2 * Math.PI * i) / 12), y: 0.6 * Math.sin((2 * Math.PI * i) / 12) });
  tiny[tiny.length - 1] = { ...tiny[0] };
  const anchors = fitCurve(tiny, { tolerance: 1.5, closed: true })!;
  assert.ok(anchors.length >= 2, `${anchors.length} anchors`);
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const apart = Math.hypot(anchors[i].p.x - anchors[j].p.x, anchors[i].p.y - anchors[j].p.y);
      assert.ok(apart > 1e-6, `anchors ${i} and ${j} are in one place`);
    }
  }
  assert.ok(deviation(tiny, anchors, true) <= 1.5 + 1e-6);
});

test('a polygon of few, far-apart vertices is fitted without looping out between them', () => {
  // An eraser's cut hands the fitter polygons: straight sides of two
  // vertices, arcs of a few. Every fitted curve stays by the polygon, between
  // its vertices as well as at them.
  let seed = 99;
  const rand = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const polylineDistance = (p: Point, poly: Point[]): number => {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1];
      const b = poly[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    return best;
  };
  let worst = 0;
  for (let n = 0; n < 300; n++) {
    const poly: Point[] = [];
    let x = 0;
    let y = 0;
    let heading = rand() * Math.PI * 2;
    const count = 3 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) {
      poly.push({ x, y });
      heading += (rand() - 0.5) * 1.2;
      const step = 2 + rand() * 40;
      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
    }
    const anchors = fitCurve(poly, { tolerance: 0.25 });
    if (!anchors) continue;
    for (const p of sampleVectorPathPoints(anchors, false)) worst = Math.max(worst, polylineDistance(p, poly));
  }
  assert.ok(worst < 0.3, `a fitted curve strays ${worst} from its polygon`);
});

test('nothing to fit is null: too few samples, or a compound path', () => {
  assert.equal(fitCurve([{ x: 1, y: 1 }, { x: 1, y: 1 }], { tolerance: 1 }), null);
  assert.equal(fitCurve([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5, move: true }, { x: 9, y: 9 }], { tolerance: 1 }), null);
  const two = fitCurve([{ x: 0, y: 0 }, { x: 10, y: 0 }], { tolerance: 1 })!;
  assert.equal(two.length, 2);
});

const pen = (points: Point[], extra: Partial<Stroke> = {}): Stroke => ({ id: 'st_fit', tool: 'pen', color: '#000', width: 3, points, ...extra });

test('a fitted stroke holds its anchors, marked fitted, and points sampled from them', () => {
  const arc = hand((s) => ({ x: 100 * Math.cos(Math.PI * s), y: 100 * Math.sin(Math.PI * s) }), 600);
  const fitted = fitStroke(pen(arc), 1.5);
  assert.equal(fitted.vector?.fitted, true);
  assert.ok((fitted.vector?.anchors.length ?? 0) <= 5);
  assert.deepEqual(fitted.points, sampleVectorPathPoints(fitted.vector!.anchors, false));
  // Text, erasers and two-point lines are left as they were.
  const line = pen([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  assert.equal(fitStroke(line, 1.5), line);
  const eraser = pen(arc, { tool: 'eraser' });
  assert.equal(fitStroke(eraser, 1.5), eraser);
  assert.equal(fitPoints([{ x: 0, y: 0 }], 1), null);
});

test('Sharpen fits what it rebuilds instead of multiplying the points', () => {
  const scribble = hand((s) => ({ x: 400 * s, y: 60 * Math.sin(s * 9) }), 900, 0.6);
  const sharpened = sharpenStroke(pen(scribble));
  assert.equal(sharpened.sharpened, true);
  assert.equal(sharpened.vector?.fitted, true, 'the rebuilt curve is fitted');
  const anchors = sharpened.vector!.anchors.length;
  assert.ok(anchors < scribble.length / 8, `${anchors} anchors for ${scribble.length} samples`);
  // The old Catmull-Rom rebuild drew ten points for every one it kept.
  assert.ok(sharpened.points.length <= anchors * 25, `${sharpened.points.length} points`);
  // A stroke that came fitted comes back with anchors for its new shape.
  const again = sharpenStroke({ ...fitStroke(pen(scribble), 1.5), sharpened: false });
  assert.deepEqual(again.points, sampleVectorPathPoints(again.vector!.anchors, again.vector!.closed === true));
});
