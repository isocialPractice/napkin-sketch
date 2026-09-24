/**
 * Stroke Profile tests: the measured profiles, the two constructions of a
 * profiled outline, and the claim that holds them together - that what the
 * canvas draws (a union of pieces) and what the exporter writes (clean
 * contours) are the same shape.
 *
 * The shapes below are chosen to break a careless outline: a hairpin tighter
 * than the stroke is wide folds its inner side back over itself, a curl
 * crosses itself on purpose and must keep the loop, a zigzag turns sharply
 * both ways, a closed circle has to leave its middle open - and a ring, a
 * square or an ellipse smaller than its own stroke has to close it up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  profileInputOf,
  profileOutline,
  profilePieces,
  profilePreviewPath,
  profileReach,
  profileSides,
  type ProfileInput,
} from '../src/core/stroke-profile.js';
import { STROKE_PROFILES, type Point, type Stroke, type StrokeProfile } from '../src/core/types.js';
import { normalizeSketchBook } from '../src/core/serialize.js';
import { mirrorStroke } from '../src/core/transform.js';
import { rasterizeContours } from '../src/core/graphic-design/raster.js';
import { signedArea } from '../src/core/graphic-design/geometry.js';

type Vec = { x: number; y: number };

const near = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance;

// ---- The measured profiles ------------------------------------------------------

test('Rounded is sin(πt): pointed at both ends, full in the middle', () => {
  assert.deepEqual(profileSides('rounded', 0), { left: 0, right: 0 });
  assert.ok(near(profileSides('rounded', 0.5).left, 1, 1e-12));
  assert.ok(near(profileSides('rounded', 0.25).right, Math.SQRT1_2, 1e-12));
});

test('Tapered starts full and ends at 0.3 of the width', () => {
  assert.deepEqual(profileSides('tapered', 0), { left: 1, right: 1 });
  assert.ok(near(profileSides('tapered', 1).left, 0.3, 1e-12));
  assert.ok(near(profileSides('tapered', 0.5).left, 1 - 0.7 * 0.5 ** 1.6, 1e-12));
});

test('Wave passes through every measured stop, one side at a time', () => {
  const left = [0, 0.78, 1.03, 0.87, 0.45, 0.39, 0.79, 1.16, 1.06, 0.63, 0];
  const right = [0, 0.4, 0.7, 1.09, 1.46, 1.46, 1.16, 0.69, 0.4, 0.22, 0];
  for (let k = 0; k <= 10; k++) {
    const sides = profileSides('wave', k / 10);
    assert.ok(near(sides.left, left[k], 1e-9), `left at ${k / 10}: ${sides.left}`);
    assert.ok(near(sides.right, right[k], 1e-9), `right at ${k / 10}: ${sides.right}`);
  }
  assert.equal(profileReach('wave'), 1.46);
});

test('between stops Wave never overshoots its neighbours, and never goes below zero', () => {
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const k = Math.min(9, Math.floor(t * 10));
    const a = profileSides('wave', k / 10);
    const b = profileSides('wave', (k + 1) / 10);
    const here = profileSides('wave', t);
    for (const side of ['left', 'right'] as const) {
      const lo = Math.min(a[side], b[side]) - 1e-9;
      const hi = Math.max(a[side], b[side]) + 1e-9;
      assert.ok(here[side] >= lo && here[side] <= hi, `${side} at ${t}: ${here[side]}`);
      assert.ok(here[side] >= 0);
    }
  }
});

test('Default is one on both sides everywhere, and so is no profile at all', () => {
  assert.deepEqual(profileSides('uniform', 0.3), { left: 1, right: 1 });
  assert.deepEqual(profileSides(undefined, 0.7), { left: 1, right: 1 });
});

// ---- Paths to outline --------------------------------------------------------------

function line(from: Vec, to: Vec, samples = 40): Point[] {
  return Array.from({ length: samples + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / samples,
    y: from.y + ((to.y - from.y) * i) / samples,
  }));
}

function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, samples = 60): Point[] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  });
}

function arcPoints(cx: number, cy: number, r: number, from: number, to: number, samples = 32): Point[] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / samples;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

const SHAPES: Array<{ name: string; points: Point[]; width: number; closed?: boolean; dash?: number[] }> = [
  { name: 'a straight line', points: line({ x: 20, y: 60 }, { x: 180, y: 60 }), width: 30 },
  {
    name: 'an S curve',
    points: cubic({ x: 20, y: 100 }, { x: 150, y: -20 }, { x: 50, y: 140 }, { x: 180, y: 20 }),
    width: 24,
  },
  {
    name: 'a sharp hairpin tighter than the stroke',
    points: [
      ...line({ x: 20, y: 50 }, { x: 160, y: 50 }, 20),
      ...line({ x: 160, y: 50 }, { x: 160, y: 60 }, 2).slice(1),
      ...line({ x: 160, y: 60 }, { x: 20, y: 60 }, 20).slice(1),
    ],
    width: 24,
  },
  {
    name: 'a round hairpin tighter than the stroke',
    points: [
      ...line({ x: 20, y: 50 }, { x: 150, y: 50 }, 20),
      ...arcPoints(150, 56, 6, -Math.PI / 2, Math.PI / 2, 12).slice(1),
      ...line({ x: 150, y: 62 }, { x: 20, y: 62 }, 20).slice(1),
    ],
    width: 24,
  },
  {
    name: 'a curl the path makes on purpose',
    points: [
      ...line({ x: 20, y: 90 }, { x: 100, y: 90 }, 16),
      ...arcPoints(100, 60, 30, Math.PI / 2, Math.PI / 2 - 2 * Math.PI, 48).slice(1),
      ...line({ x: 100, y: 90 }, { x: 180, y: 90 }, 16).slice(1),
    ],
    width: 10,
  },
  {
    name: 'a zigzag turning sharply both ways',
    points: [
      { x: 20, y: 100 },
      { x: 50, y: 30 },
      { x: 80, y: 100 },
      { x: 110, y: 30 },
      { x: 140, y: 100 },
      { x: 170, y: 30 },
    ],
    width: 14,
  },
  {
    name: 'a closed circle',
    points: arcPoints(100, 60, 45, 0, Math.PI * 2, 64).slice(0, -1),
    width: 16,
    closed: true,
  },
  {
    name: 'a ring smaller than its own stroke',
    points: arcPoints(100, 60, 10, 0, Math.PI * 2, 48).slice(0, -1),
    width: 40,
    closed: true,
  },
  {
    name: 'a small square under a fat pen',
    points: [
      { x: 94, y: 54 },
      { x: 106, y: 54 },
      { x: 106, y: 66 },
      { x: 94, y: 66 },
    ],
    width: 30,
    closed: true,
  },
  {
    name: 'a closed ellipse thinner than its stroke',
    points: Array.from({ length: 96 }, (_, i) => ({
      x: 100 + Math.cos((i / 96) * Math.PI * 2) * 70,
      y: 60 + Math.sin((i / 96) * Math.PI * 2) * 8,
    })),
    width: 30,
    closed: true,
  },
  { name: 'a dashed line', points: line({ x: 20, y: 60 }, { x: 180, y: 60 }), width: 20, dash: [24, 16] },
  { name: 'a dotted line', points: line({ x: 20, y: 60 }, { x: 180, y: 60 }), width: 20, dash: [0, 20] },
];

function input(shape: (typeof SHAPES)[number], profile: StrokeProfile): ProfileInput {
  return {
    points: shape.points,
    width: shape.width,
    profile,
    closed: shape.closed === true,
    pressure: false,
    dash: shape.dash ?? [],
  };
}

/** Coverage of a set of contours on a 2x grid over the 200 x 140 test area. */
function coverage(contours: Vec[][]): Float32Array {
  const scaled = contours.map((c) => c.map((p) => ({ x: p.x * 2, y: p.y * 2 + 40 })));
  return rasterizeContours(scaled, 400, 360, 'nonzero');
}

function overlap(a: Float32Array, b: Float32Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    both += Math.min(a[i], b[i]);
    either += Math.max(a[i], b[i]);
  }
  return either > 0 ? both / either : 1;
}

// ---- The two constructions agree -----------------------------------------------------

for (const shape of SHAPES) {
  test(`the exported outline covers what the canvas draws: ${shape.name}`, () => {
    for (const profile of STROKE_PROFILES) {
      const drawn = coverage(profilePieces(input(shape, profile)));
      const exported = coverage(profileOutline(input(shape, profile)));
      const iou = overlap(drawn, exported);
      assert.ok(iou >= 0.999, `${profile}: the two cover ${(iou * 100).toFixed(2)}% the same pixels`);
    }
  });
}

/** How many times two edges of some contours cross each other's interiors. */
function selfCrossings(contours: Vec[][]): number {
  const edges: Array<[Vec, Vec]> = [];
  for (const c of contours) c.forEach((p, i) => edges.push([p, c[(i + 1) % c.length]]));
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) count++;
    }
  }
  return count;
}

test('the exported outline is the boundary itself: no edge of it crosses another', () => {
  for (const shape of SHAPES) {
    for (const profile of STROKE_PROFILES) {
      const crossings = selfCrossings(profileOutline(input(shape, profile)));
      assert.equal(crossings, 0, `${shape.name}, ${profile}`);
    }
  }
});

test('a straight Default stroke exports as two straight sides and two round ends', () => {
  const contours = profileOutline(input(SHAPES[0], 'uniform'));
  assert.equal(contours.length, 1);
  // Two ends of each side, and the eleven points inside each half-circle cap.
  assert.equal(contours[0].length, 2 + 11 + 2 + 11);
});

test('a ring smaller than its own stroke is a solid disc', () => {
  const ring = SHAPES.find((s) => s.name.startsWith('a ring smaller'))!;
  for (const profile of ['uniform', 'tapered'] as const) {
    const contours = profileOutline(input(ring, profile));
    assert.equal(contours.length, 1, profile);
    assert.ok(coverage(contours)[(60 * 2 + 40) * 400 + 100 * 2] > 0.99, `${profile} paints the centre`);
  }
});

test('every canvas piece is wound the same way, so one non-zero fill unions them', () => {
  for (const shape of SHAPES) {
    for (const piece of profilePieces(input(shape, 'wave'))) {
      assert.ok(signedArea(piece) > 0, `${shape.name} has a piece wound the other way`);
    }
  }
});

test('a closed outline leaves its middle open: two contours wound opposite ways', () => {
  const circle = SHAPES.find((s) => s.closed)!;
  const contours = profileOutline(input(circle, 'rounded'));
  assert.equal(contours.length, 2);
  assert.ok(Math.sign(signedArea(contours[0])) === -Math.sign(signedArea(contours[1])));
  const middle = coverage(contours)[(60 * 2 + 40) * 400 + 100 * 2];
  assert.equal(middle, 0, 'nothing is painted at the centre of the ring');
});

test('a straight Rounded stroke has the area of its sine', () => {
  const [outline] = profileOutline({
    points: line({ x: 20, y: 60 }, { x: 180, y: 60 }, 160),
    width: 30,
    profile: 'rounded',
    closed: false,
    pressure: false,
    dash: [],
  });
  // ∫ W sin(πs/L) ds over the length L is 2WL/π.
  const expected = (2 * 30 * 160) / Math.PI;
  const area = Math.abs(signedArea(outline)) / 2;
  assert.ok(near(area, expected, expected * 0.01), `${area} against ${expected}`);
});

test('a ruled line of two points still takes its profile all along it', () => {
  // Its only vertices are its ends, where Rounded has no width at all: the
  // run is cut into steps before the profile is read.
  const two = { points: [{ x: 20, y: 60 }, { x: 180, y: 60 }], width: 30, closed: false, pressure: false, dash: [] };
  const [outline] = profileOutline({ ...two, profile: 'rounded' });
  const expected = (2 * 30 * 160) / Math.PI;
  const area = Math.abs(signedArea(outline)) / 2;
  assert.ok(near(area, expected, expected * 0.01), `${area} against ${expected}`);
  const iou = overlap(coverage(profilePieces({ ...two, profile: 'rounded' })), coverage([outline]));
  assert.ok(iou >= 0.999, `the canvas agrees: ${iou}`);
});

test('a straight Tapered stroke has the area of its taper and two round ends', () => {
  const [outline] = profileOutline({
    points: line({ x: 20, y: 60 }, { x: 180, y: 60 }, 160),
    width: 30,
    profile: 'tapered',
    closed: false,
    pressure: false,
    dash: [],
  });
  const body = 30 * 160 * (1 - 0.7 / 2.6);
  const caps = (Math.PI * 15 ** 2) / 2 + (Math.PI * 4.5 ** 2) / 2;
  const area = Math.abs(signedArea(outline)) / 2;
  assert.ok(near(area, body + caps, (body + caps) * 0.01), `${area} against ${body + caps}`);
});

test('pen pressure scales the outline the way it scales the painted line', () => {
  const points = line({ x: 20, y: 60 }, { x: 180, y: 60 }).map((p) => ({ ...p, pressure: 0.5 }));
  const shape = { points, width: 30, profile: 'uniform' as const, closed: false, dash: [] };
  const height = (c: Vec[]): number => Math.max(...c.map((p) => p.y)) - Math.min(...c.map((p) => p.y));
  const pen = height(profileOutline({ ...shape, pressure: true })[0]);
  const marker = height(profileOutline({ ...shape, pressure: false })[0]);
  // 0.4 + 0.6 x 0.5: the pen's line is 0.7 of its width, as the painter draws it.
  assert.ok(near(pen / marker, 0.7, 0.01), `${pen / marker}`);
});

test('a dashed profile keeps the widths the whole stroke had at each dash', () => {
  const dashed = profileOutline({
    points: line({ x: 20, y: 60 }, { x: 180, y: 60 }),
    width: 20,
    profile: 'rounded',
    closed: false,
    pressure: false,
    dash: [24, 28],
  });
  // Gaps wider than the round ends, so no two dashes run into one.
  assert.equal(dashed.length, 4, 'four dashes along 160px of 24-on, 28-off');
  const heights = dashed.map((c) => Math.max(...c.map((p) => p.y)) - Math.min(...c.map((p) => p.y)));
  // Rounded: the middle dashes are the fat ones.
  assert.ok(heights[1] > heights[0] && heights[2] > heights[3], heights.join(', '));
});

// ---- Reading a stroke ------------------------------------------------------------------

function stroke(patch: Partial<Stroke>): Stroke {
  return {
    id: 's',
    tool: 'pen',
    color: '#1f2328',
    width: 4,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    ...patch,
  };
}

test('a stroke is read the way the painter reads it', () => {
  const pen = profileInputOf(stroke({ profile: 'wave' }));
  assert.equal(pen.profile, 'wave');
  assert.equal(pen.pressure, true);
  assert.equal(pen.closed, false);
  assert.equal(profileInputOf(stroke({ tool: 'marker', profile: 'wave' })).pressure, false);
  assert.equal(profileInputOf(stroke({ tool: 'copic', profile: 'wave' })).profile, undefined);
  assert.equal(profileInputOf(stroke({ strokeStyle: 'dashed' })).dash.length, 2);
  // A shape tool's outline lands back where it began, and closes.
  const loop = stroke({
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ],
  });
  assert.equal(profileInputOf(loop).closed, true);
});

test('a profile survives a save, and only where it can shape an outline', () => {
  const book = normalizeSketchBook({
    format: 'napkin-sketch',
    version: 3,
    name: 'p',
    sketches: [
      {
        id: 'k',
        name: 'k',
        width: 100,
        height: 100,
        background: '#fff',
        layers: [{ id: 'l', name: 'l', opacity: 1, visible: true, locked: false }],
        strokes: [
          stroke({ id: 'a', profile: 'tapered' }),
          stroke({ id: 'b', tool: 'marker', profile: 'wave' }),
          stroke({ id: 'c', tool: 'copic', profile: 'wave' }),
          stroke({ id: 'd', profile: 'sideways' as never }),
          stroke({ id: 'e', profile: 'uniform' as never }),
        ],
      },
    ],
  });
  const profiles = book.sketches[0].strokes.map((s) => s.profile);
  assert.deepEqual(profiles, ['tapered', 'wave', undefined, undefined, undefined]);
});

// ---- Pictures --------------------------------------------------------------------------

test('every picture is a closed path that stays inside its box', () => {
  for (const profile of STROKE_PROFILES) {
    const d = profilePreviewPath(profile, 120, 26);
    assert.match(d, /^M[\d. L]+Z/);
    for (const [x, y] of [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]])) {
      assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 26, `${profile} strays to ${x}, ${y}`);
    }
  }
});

// ---- Mirrored ---------------------------------------------------------------------

test('a mirrored Wave is the mirror image of the Wave it was, not the same-handed wave', () => {
  const wave = stroke({ profile: 'wave', width: 24, points: SHAPES[1].points.map((p) => ({ ...p })) });
  // The canvas pieces of the original, reflected about x = 100.
  const reflected = profilePieces(profileInputOf(wave)).map((c) => c.map((p) => ({ x: 200 - p.x, y: p.y })));
  mirrorStroke(wave, { flipX: true, flipY: false, x: 100, y: 0 });
  assert.equal(wave.profileMirrored, true);
  const mirrored = profilePieces(profileInputOf(wave));
  const iou = overlap(coverage(reflected), coverage(mirrored));
  assert.ok(iou >= 0.999, `the mirror image: ${iou}`);
  // Without the sides swapped the band would lean the way it did.
  const unswapped = profilePieces({ ...profileInputOf(wave), mirrored: false });
  const off = overlap(coverage(reflected), coverage(unswapped));
  assert.ok(off < 0.95, `the same-handed wave is visibly different: ${off}`);
  // A second mirror puts it back, and both ways at once - a half turn - keeps
  // the handedness it has.
  mirrorStroke(wave, { flipX: true, flipY: false, x: 100, y: 0 });
  assert.equal(wave.profileMirrored, undefined);
  mirrorStroke(wave, { flipX: true, flipY: true, x: 100, y: 60 });
  assert.equal(wave.profileMirrored, undefined);
});

test('a symmetric profile mirrors exactly with nothing to swap', () => {
  const rounded = stroke({ profile: 'rounded', width: 24, points: SHAPES[1].points.map((p) => ({ ...p })) });
  const reflected = profilePieces(profileInputOf(rounded)).map((c) => c.map((p) => ({ x: 200 - p.x, y: p.y })));
  mirrorStroke(rounded, { flipX: true, flipY: false, x: 100, y: 0 });
  assert.equal(rounded.profileMirrored, undefined);
  assert.ok(overlap(coverage(reflected), coverage(profilePieces(profileInputOf(rounded)))) >= 0.999);
});

test('a mirrored profile survives a save, and only beside a profile', () => {
  const book = normalizeSketchBook({
    format: 'napkin-sketch',
    version: 3,
    name: 'm',
    sketches: [
      {
        id: 'k',
        name: 'k',
        width: 100,
        height: 100,
        background: '#fff',
        layers: [{ id: 'l', name: 'l', opacity: 1, visible: true, locked: false }],
        strokes: [
          stroke({ id: 'a', profile: 'wave', profileMirrored: true }),
          stroke({ id: 'b', profileMirrored: true }),
          stroke({ id: 'c', tool: 'copic', profile: 'wave', profileMirrored: true }),
        ],
      },
    ],
  });
  assert.deepEqual(
    book.sketches[0].strokes.map((s) => s.profileMirrored),
    [true, undefined, undefined],
  );
});
