/**
 * The parsing behind the frame preview.
 *
 * `scripts/frame-preview.mjs` renders a posed frame so the helper that drew it
 * can look at its own work. The picture is only worth looking at if it matches
 * what a browser would draw: a transform read wrongly moves a limb somewhere it
 * is not, and a preview that lies is worse than no preview. These cover the two
 * places that can go wrong quietly - the transform maths and the paint lookup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTransform,
  paintOf,
  styleClasses,
  transformPathData,
} from '../scripts/frame-preview.mjs';

/** Points of a path, for comparing without caring about number formatting. */
function points(d: string): number[] {
  return (d.match(/-?(?:\d*\.\d+|\d+)/g) ?? []).map((n) => Math.round(Number(n) * 100) / 100);
}

test('parseTransform turns a rotation about a centre into a matrix', () => {
  // The app writes exactly this form: `rotate(angle cx cy)`.
  const m = parseTransform('rotate(90 10 10)');
  // A quarter turn about (10,10) carries (20,10) to (10,20).
  const x = m[0] * 20 + m[2] * 10 + m[4];
  const y = m[1] * 20 + m[3] * 10 + m[5];
  assert.ok(Math.abs(x - 10) < 1e-9, `x was ${x}`);
  assert.ok(Math.abs(y - 20) < 1e-9, `y was ${y}`);
});

test('parseTransform reads translate, scale and matrix too', () => {
  assert.deepEqual(parseTransform('translate(5 7)'), [1, 0, 0, 1, 5, 7]);
  assert.deepEqual(parseTransform('scale(2)'), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(parseTransform('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]);
});

test('parseTransform is the identity for nothing at all', () => {
  assert.deepEqual(parseTransform(null), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(parseTransform(''), [1, 0, 0, 1, 0, 0]);
});

test('transformPathData resolves relative commands before moving them', () => {
  // `m` then a bare pair is a relative lineto; the offset is from the point
  // reached, not from the origin.
  const d = transformPathData('m10,10 5,0 0,5', [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(points(d), [10, 10, 15, 10, 15, 15]);
});

test('transformPathData carries a curve by its control points', () => {
  // A cubic under a translation: all four points shift, so the curve does.
  const d = transformPathData('M0,0 C1,2 3,4 5,6', [1, 0, 0, 1, 10, 20]);
  assert.deepEqual(points(d), [10, 20, 11, 22, 13, 24, 15, 26]);
  assert.ok(d.includes('C'), 'the curve should stay a curve, not be flattened');
});

test('transformPathData rewrites H and V as lines, which a matrix can turn', () => {
  // A horizontal lineto is only horizontal before the rotation.
  const d = transformPathData('M0,0 H10', parseTransform('rotate(90 0 0)'));
  assert.deepEqual(points(d), [0, 0, 0, 10]);
});

test('transformPathData returns to the subpath start on Z', () => {
  const d = transformPathData('M10,10 L20,10 Z l5,0', [1, 0, 0, 1, 0, 0]);
  // After Z the pen is back at the moveto, so the relative lineto lands at 15.
  assert.deepEqual(points(d).slice(-2), [15, 10]);
});

test('transformPathData reports an arc rather than mangling it silently', () => {
  let told = 0;
  transformPathData('M0,0 A5,5 0 1 1 10,0', [1, 0, 0, 1, 0, 0], () => {
    told++;
  });
  assert.equal(told, 1, 'an arc under a matrix has to be announced');
});

test('styleClasses reads the stylesheet an illustration tool exports', () => {
  // Grouped selectors and a `px` suffix are both what Illustrator writes.
  const svg =
    '<svg><defs><style>.cls-1{fill:#f4ae7c;}.cls-6,.cls-7{fill:none;}' +
    '.cls-6{stroke:#000;stroke-width:.95px;}</style></defs></svg>';
  const classes = styleClasses(svg);
  assert.equal(classes.get('cls-1')?.fill, '#f4ae7c');
  assert.equal(classes.get('cls-7')?.fill, 'none');
  assert.equal(classes.get('cls-6')?.stroke, '#000');
  assert.equal(classes.get('cls-6')?.strokeWidth, 0.95);
});

test('paintOf prefers an attribute over the class it also carries', () => {
  const classes = styleClasses('<style>.a{fill:#ff0000;}</style>');
  const paint = paintOf('<path class="a" fill="#00ff00" d="M0,0"/>', classes);
  assert.equal(paint.fill, '#00ff00');
});

test('paintOf falls back to the class, then to what SVG paints by default', () => {
  const classes = styleClasses('<style>.a{fill:#ff0000;}</style>');
  assert.equal(paintOf('<path class="a" d="M0,0"/>', classes).fill, '#ff0000');
  // Nothing said at all: SVG fills black, and the preview must match.
  assert.equal(paintOf('<path d="M0,0"/>', classes).fill, '#000000');
});

test('paintOf reads "none" as no paint at all, not as a colour', () => {
  const classes = styleClasses('<style>.n{fill:none;}</style>');
  assert.equal(paintOf('<path class="n" d="M0,0"/>', classes).fill, null);
  assert.equal(paintOf('<path stroke="none" d="M0,0"/>', classes).stroke, null);
});
