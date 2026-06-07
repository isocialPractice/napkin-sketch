/** Auto-sharpen classification + transform tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  sharpenStroke,
  sharpenStrokes,
  DEFAULT_SHARPEN_OPTIONS,
} from '../src/sharpen/sharpen.js';
import { createSketch, type Stroke } from '../src/core/types.js';

function stroke(points: { x: number; y: number }[], tool: Stroke['tool'] = 'pen'): Stroke {
  return {
    id: 'test',
    tool,
    color: '#000',
    width: 3,
    points: points.map((p) => ({ ...p })),
    sharpened: false,
  };
}

function circlePoints(cx: number, cy: number, r: number, n = 40): { x: number; y: number }[] {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

test('classify detects a straight line', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 25, y: 1 },
    { x: 50, y: -1 },
    { x: 75, y: 0 },
    { x: 100, y: 1 },
  ];
  assert.equal(classify(pts, DEFAULT_SHARPEN_OPTIONS), 'line');
});

test('classify detects a circle', () => {
  assert.equal(classify(circlePoints(50, 50, 30), DEFAULT_SHARPEN_OPTIONS), 'circle');
});

test('sharpenStroke marks the stroke as sharpened', () => {
  const out = sharpenStroke(stroke(circlePoints(40, 40, 20)));
  assert.equal(out.sharpened, true);
  assert.ok(out.points.length > 2);
});

test('sharpenStroke does not reshape eraser strokes', () => {
  const eraser = stroke(
    [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 12, y: 3 },
      { x: 20, y: 9 },
    ],
    'eraser',
  );
  const out = sharpenStroke(eraser);
  // Erasers are masks, not marks: their geometry is preserved verbatim.
  assert.deepEqual(out.points, eraser.points);
});

test('sharpenStrokes only re-sharpens unsharpened strokes', () => {
  const s = createSketch();
  const already = sharpenStroke(stroke(circlePoints(10, 10, 5)));
  const fresh = stroke(circlePoints(30, 30, 8));
  s.strokes = [already, fresh];
  const out = sharpenStrokes(s.strokes);
  assert.equal(out.length, 2);
  assert.ok(out.every((x) => x.sharpened));
});
