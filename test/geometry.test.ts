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
  quarterArcPoints,
  quarterArcCubic,
  cubicBezierPoints,
  splitCubicBezier,
  roundedCornerAnchors,
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

const A = { x: 10, y: 100 };
const B = { x: 90, y: 60 };

test('quarterArcPoints spans the drag and stays a quarter ellipse', () => {
  const pts = quarterArcPoints(A, B, false, 0, 64);
  const first = pts[0];
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(first.x - A.x) < 1e-9 && Math.abs(first.y - A.y) < 1e-9);
  assert.ok(Math.abs(last.x - B.x) < 1e-9 && Math.abs(last.y - B.y) < 1e-9);

  // Every point lies on the ellipse centred on the (A.x, B.y) box corner.
  const rx = B.x - A.x;
  const ry = A.y - B.y;
  for (const p of pts) {
    const u = (p.x - A.x) / rx;
    const v = (p.y - B.y) / ry;
    assert.ok(Math.abs(u * u + v * v - 1) < 1e-9);
  }
});

test('quarterArcPoints leaves the start flat and reaches the end upright', () => {
  const pts = quarterArcPoints(A, B, false, 0, 64);
  const startStep = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  const endStep = {
    x: pts[pts.length - 1].x - pts[pts.length - 2].x,
    y: pts[pts.length - 1].y - pts[pts.length - 2].y,
  };
  assert.ok(Math.abs(startStep.y) < Math.abs(startStep.x) * 0.05);
  assert.ok(Math.abs(endStep.x) < Math.abs(endStep.y) * 0.05);
});

test('quarterArcPoints bows through the far corner of the drag box', () => {
  const pts = quarterArcPoints(A, B, false, 0, 64);
  const mid = pts[32];
  // The arc sits between the chord and the (B.x, A.y) corner it bows toward.
  const chordY = A.y + ((mid.x - A.x) / (B.x - A.x)) * (B.y - A.y);
  assert.ok(mid.y > chordY);
  assert.ok(mid.x > A.x && mid.x < B.x);
  assert.ok(mid.y < A.y && mid.y > B.y);
});

test('quarterArcPoints with uniform radii is a quarter circle', () => {
  const pts = quarterArcPoints(A, B, true, 0, 64);
  // The shorter drag axis (40) sets the radius, as with the Shift ellipse.
  const center = { x: A.x, y: A.y - 40 };
  for (const p of pts) {
    assert.ok(Math.abs(distance(p, center) - 40) < 1e-9);
  }
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.x - (A.x + 40)) < 1e-9);
  assert.ok(Math.abs(last.y - (A.y - 40)) < 1e-9);
});

test('quarterArcPoints collapses when a drag has no reach', () => {
  const pts = quarterArcPoints(A, { x: A.x, y: A.y }, false, 0, 8);
  for (const p of pts) {
    assert.ok(distance(p, A) < 1e-9);
  }
});

/** Midpoint of the chord the apex swings around. */
const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };

test('a turned apex leaves both ends of the quick curve where they were', () => {
  for (const degrees of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const pts = quarterArcPoints(A, B, false, degrees, 32);
    assert.ok(distance(pts[0], A) < 1e-9, `start moved at ${degrees}deg`);
    assert.ok(distance(pts[pts.length - 1], B) < 1e-9, `end moved at ${degrees}deg`);
  }
});

test('a turned apex still sweeps a true quarter ellipse', () => {
  // The centre's two spokes stay perpendicular, so the sweep is a quarter of
  // some ellipse at every angle: its mid-parameter point is the centre plus
  // both spokes scaled by cos 45, which is where the arc's belly sits.
  for (const degrees of [45, 135, 250]) {
    const pts = quarterArcPoints(A, B, false, degrees, 32);
    const apex = pts[16];
    // Recover the centre from the identity apex = centre + (u + v) / sqrt(2),
    // where u + v = (A + B) - 2 * centre.
    const center = {
      x: (A.x + B.x - Math.SQRT2 * apex.x) / (2 - Math.SQRT2),
      y: (A.y + B.y - Math.SQRT2 * apex.y) / (2 - Math.SQRT2),
    };
    const u = { x: A.x - center.x, y: A.y - center.y };
    const v = { x: B.x - center.x, y: B.y - center.y };
    assert.ok(Math.abs(u.x * v.x + u.y * v.y) < 1e-6, `spokes not square at ${degrees}deg`);
  }
});

test('the quick curve apex orbits the chord midpoint clockwise', () => {
  const flat = quarterArcPoints(A, B, false, 0, 32)[16];
  const radius = distance(flat, M);
  assert.ok(radius > 1);

  const quarterTurn = quarterArcPoints(A, B, false, 90, 32)[16];
  // Same orbit, and one 90-degree step lands where a clockwise turn should:
  // (x, y) -> (-y, x) about the midpoint, with y growing downward on canvas.
  assert.ok(Math.abs(distance(quarterTurn, M) - radius) < 1e-9);
  assert.ok(Math.abs(quarterTurn.x - (M.x - (flat.y - M.y))) < 1e-9);
  assert.ok(Math.abs(quarterTurn.y - (M.y + (flat.x - M.x))) < 1e-9);
});

test('a half-turned apex bows the quick curve the other way', () => {
  const flat = quarterArcPoints(A, B, false, 0, 32)[16];
  const flipped = quarterArcPoints(A, B, false, 180, 32)[16];
  // Straight across the chord from the unturned belly.
  assert.ok(Math.abs(flipped.x - (2 * M.x - flat.x)) < 1e-9);
  assert.ok(Math.abs(flipped.y - (2 * M.y - flat.y)) < 1e-9);
});

test('four 90-degree steps return the quick curve apex to the drag angle', () => {
  const arc = quarterArcPoints(A, B, false, 0, 16);
  const turned = quarterArcPoints(A, B, false, 4 * 90, 16);
  for (let i = 0; i < arc.length; i++) {
    assert.ok(distance(turned[i], arc[i]) < 1e-9);
  }
});

test('an odd 90-degree stop flattens a uniform arc onto its chord', () => {
  // With equal radii the centre sits on the chord's perpendicular bisector, so
  // a quarter turn drops it onto an endpoint and the sweep degenerates to the
  // straight chord segment (still pinned at both ends).
  const square = { x: A.x + 50, y: A.y + 50 };
  const pts = quarterArcPoints(A, square, true, 90, 16);
  assert.ok(distance(pts[0], A) < 1e-9);
  assert.ok(distance(pts[pts.length - 1], square) < 1e-9);
  for (const p of pts) {
    // Every point lies on the A-square chord line (x - A.x === y - A.y).
    assert.ok(Math.abs(p.x - A.x - (p.y - A.y)) < 1e-9);
  }
});

test('cubicBezierPoints spans its endpoints', () => {
  const pts = cubicBezierPoints(A, { x: 40, y: 20 }, { x: 70, y: 140 }, B, 24);
  assert.equal(pts.length, 25);
  assert.ok(distance(pts[0], A) < 1e-9);
  assert.ok(distance(pts[pts.length - 1], B) < 1e-9);
});

test('cubicBezierPoints with controls on the anchors is the straight chord', () => {
  // A Vector Path segment between two corner anchors: handles collapse onto
  // the anchors and the cubic degenerates to the line between them.
  const pts = cubicBezierPoints(A, A, B, B, 8);
  for (const p of pts) {
    const cross = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x);
    assert.ok(Math.abs(cross) < 1e-6);
  }
});

test('cubicBezierPoints bows toward its control points', () => {
  // Both controls above the chord: the whole curve stays above it too, and
  // the midpoint sits at the standard cubic blend of the four points.
  const c1 = { x: 30, y: 20 };
  const c2 = { x: 70, y: 20 };
  const pts = cubicBezierPoints({ x: 10, y: 100, pressure: 0.5 }, c1, c2, { x: 90, y: 100, pressure: 0.5 }, 16);
  const mid = pts[8];
  assert.ok(mid.y < 100);
  assert.ok(Math.abs(mid.y - (100 / 8 + (3 * 20) / 8 + (3 * 20) / 8 + 100 / 8)) < 1e-9);
});

test('quarterArcCubic matches the sampled arc at both ends and the belly', () => {
  const arc = quarterArcPoints(A, B, false, 0, 32);
  const cubic = quarterArcCubic(A, B, false, 0);
  assert.ok(distance(cubic.p0, arc[0]) < 1e-9);
  assert.ok(distance(cubic.p3, arc[32]) < 1e-9);
  // The cubic-vs-arc error peaks near 0.03% of the radius; the drag here has
  // radii of 80 and 40, so a quarter-pixel tolerance is generous.
  const sampled = cubicBezierPoints(
    { ...cubic.p0, pressure: 0.5 },
    cubic.c1,
    cubic.c2,
    { ...cubic.p3, pressure: 0.5 },
    32,
  );
  assert.ok(distance(sampled[16], arc[16]) < 0.25);
});

test('splitCubicBezier halves retrace the original curve', () => {
  const p0 = { x: 0, y: 0 };
  const c1 = { x: 20, y: -40 };
  const c2 = { x: 60, y: 40 };
  const p3 = { x: 80, y: 0 };
  const t = 0.35;
  const split = splitCubicBezier(p0, c1, c2, p3, t);
  const whole = (u: number) => {
    const pts = cubicBezierPoints(
      { ...p0, pressure: 0.5 },
      c1,
      c2,
      { ...p3, pressure: 0.5 },
      1000,
    );
    return pts[Math.round(u * 1000)];
  };
  // The split point lies on the curve, and each half's midpoint re-samples
  // onto the original at the remapped parameter.
  assert.ok(distance(split.point, whole(t)) < 1e-6);
  const left = cubicBezierPoints(
    { ...p0, pressure: 0.5 },
    split.left.c1,
    split.left.c2,
    { ...split.point, pressure: 0.5 },
    2,
  );
  assert.ok(distance(left[1], whole(t / 2)) < 1e-3);
  const right = cubicBezierPoints(
    { ...split.point, pressure: 0.5 },
    split.right.c1,
    split.right.c2,
    { ...p3, pressure: 0.5 },
    2,
  );
  assert.ok(distance(right[1], whole(t + (1 - t) / 2)) < 1e-3);
});

test('roundedCornerAnchors places the fillet along both chords', () => {
  const prev = { x: 0, y: 0 };
  const corner = { x: 100, y: 0 };
  const next = { x: 100, y: 100 };
  const rounded = roundedCornerAnchors(prev, corner, next, 20);
  assert.ok(rounded);
  const [a1, a2] = rounded;
  // Each fillet anchor sits the radius back along its chord, and its handle
  // reaches toward the old corner by the circle constant.
  assert.ok(distance(a1.p, { x: 80, y: 0 }) < 1e-9);
  assert.ok(distance(a2.p, { x: 100, y: 20 }) < 1e-9);
  const k = 20 * 0.5522847498307936;
  assert.ok(a1.hOut && Math.abs(a1.hOut.x - (80 + k)) < 1e-9 && Math.abs(a1.hOut.y) < 1e-9);
  assert.ok(a2.hIn && Math.abs(a2.hIn.x - 100) < 1e-9 && Math.abs(a2.hIn.y - (20 - k)) < 1e-9);
});

test('roundedCornerAnchors clamps to half the shorter chord', () => {
  const rounded = roundedCornerAnchors(
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 200 },
    500,
  );
  assert.ok(rounded);
  // The shorter chord (30) caps the radius at 15.
  assert.ok(distance(rounded[0].p, { x: 15, y: 0 }) < 1e-9);
  assert.ok(distance(rounded[1].p, { x: 30, y: 15 }) < 1e-9);
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
