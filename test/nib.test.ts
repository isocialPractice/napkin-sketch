/** Copic broad-nib geometry tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copicNibPolygons } from '../src/core/nib.js';
import { DEFAULT_NIB_ANGLE, type Stroke } from '../src/core/types.js';

function copicStroke(points: { x: number; y: number }[], nibAngle?: number): Stroke {
  return {
    id: 'c1',
    tool: 'copic',
    color: '#27486d',
    width: 12,
    nibAngle,
    points: points.map((p) => ({ ...p, pressure: 0.5 })),
  };
}

/** Signed shoelace area of a polygon (sign encodes the winding direction). */
function signedArea(poly: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

test('empty and single-point strokes produce a footprint', () => {
  assert.deepEqual(copicNibPolygons(copicStroke([])), []);
  const dot = copicNibPolygons(copicStroke([{ x: 5, y: 5 }], 0));
  assert.equal(dot.length, 1);
  // A horizontal nib (0 deg) spans the stroke width along x.
  const xs = dot[0].map((p) => p.x);
  assert.equal(Math.max(...xs) - Math.min(...xs), 12);
});

test('a stroke of n points yields n contact patches plus n-1 sweep quads', () => {
  const polys = copicNibPolygons(
    copicStroke([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 10, y: 30 },
    ]),
  );
  assert.equal(polys.length, 3 + 2);
});

test('all polygons wind the same way regardless of travel direction', () => {
  for (const angle of [0, 45, 90, 135, 200, 305]) {
    const down = copicNibPolygons(copicStroke([{ x: 0, y: 0 }, { x: 0, y: 20 }], angle));
    const up = copicNibPolygons(copicStroke([{ x: 0, y: 20 }, { x: 0, y: 0 }], angle));
    const across = copicNibPolygons(copicStroke([{ x: 0, y: 0 }, { x: 20, y: 5 }], angle));
    const signs = [...down, ...up, ...across]
      .map(signedArea)
      .filter((a) => Math.abs(a) > 1e-9)
      .map(Math.sign);
    assert.ok(signs.length > 0);
    assert.ok(signs.every((s) => s === signs[0]), `mixed windings at ${angle} deg`);
  }
});

test('moving perpendicular to the nib sweeps the full width', () => {
  // Nib at 0 deg (horizontal), moving straight down: the sweep quad must be
  // as wide as the stroke width and as tall as the travel.
  const polys = copicNibPolygons(copicStroke([{ x: 0, y: 0 }, { x: 0, y: 40 }], 0));
  const sweep = polys[polys.length - 1];
  const xs = sweep.map((p) => p.x);
  const ys = sweep.map((p) => p.y);
  assert.equal(Math.max(...xs) - Math.min(...xs), 12);
  assert.equal(Math.max(...ys) - Math.min(...ys), 40);
});

test('moving parallel to the nib still leaves a visible edge', () => {
  // Nib at 0 deg, moving straight right: the sweep quad degenerates, but the
  // per-point contact patches guarantee a thin mark.
  const polys = copicNibPolygons(copicStroke([{ x: 0, y: 0 }, { x: 40, y: 0 }], 0));
  const total = polys.reduce((sum, poly) => sum + Math.abs(signedArea(poly)), 0);
  assert.ok(total > 0);
});

test('nib angle defaults to DEFAULT_NIB_ANGLE when absent', () => {
  const explicit = copicNibPolygons(copicStroke([{ x: 0, y: 0 }], DEFAULT_NIB_ANGLE));
  const implicit = copicNibPolygons(copicStroke([{ x: 0, y: 0 }]));
  assert.deepEqual(implicit, explicit);
});
