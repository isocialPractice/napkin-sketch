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
  findings,
  grade,
  parseTransform,
  paintOf,
  poseCheck,
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

/** A frame posed the way the job asks for it: transforms on, path data untouched. */
const SOURCE = `<g id="figure">
  <g id="back-leg-assembly"><path d="M10 20 L30 40"/></g>
  <g id="front-leg-assembly"><path d="M12 22 C14 24 16 26 18 28"/></g>
  <g id="head-assembly"><path d="M5 5 L7 7"/></g>
</g>`;

const POSED = SOURCE.replace('id="back-leg-assembly"', 'id="back-leg-assembly" transform="rotate(7 20 30)"');

/** The same frame with its geometry re-emitted: new numbers, no transform. */
const REDRAWN = `<g id="figure">
  <g id="back-leg-assembly"><path d="M10.42 19.61 L29.88 40.37"/></g>
  <g id="front-leg-assembly"><path d="M12.31 21.74 C14.2 24.11 16.07 26.4 18.33 27.92"/></g>
  <g id="head-assembly"><path d="M5.11 4.92 L7.04 7.13"/></g>
</g>`;

/** A step with every part inside its band, and the bands to judge it by. */
const BAND = {
  bob: { low: 0, high: 1.9, typical: 0.6 },
  leg: { low: 3.2, high: 26.2, typical: 8.9 },
  arm: { low: 1.2, high: 9.4, typical: 4.8 },
  clothing: { low: 0.4, high: 5.1, typical: 3.5 },
};
const GOOD_STEP = { bob: 0.5, parts: { leg: 8, arm: 4, clothing: 3 }, layersFrozen: [] };

test('poseCheck tells a posed frame from a redrawn one', () => {
  // The whole point: these two are indistinguishable by measuring the drawing,
  // and trivially distinguishable by reading it. A posed frame keeps its path
  // data byte for byte and puts the movement in a transform.
  const posed = poseCheck(POSED, SOURCE);
  assert.equal(posed.redrawn, false);
  assert.equal(posed.transforms, 1);
  assert.equal(posed.kept, 1, 'posing must not touch a single `d`');

  const redrawn = poseCheck(REDRAWN, SOURCE);
  assert.equal(redrawn.redrawn, true, 'rewritten geometry with no transform is a redraw');
  assert.equal(redrawn.transforms, 0);
  assert.equal(redrawn.shared, 0);
});

test('a frame that simply did not move is not accused of being redrawn', () => {
  // No transform and no change either. That is a frozen frame, which the
  // frozen-layer finding reports in its own words - calling it a redraw would
  // send the next pass after the wrong defect.
  const still = poseCheck(SOURCE, SOURCE);
  assert.equal(still.redrawn, false);
  assert.equal(still.kept, 1);
});

test('a redrawn frame is the only finding, because the rest are its symptoms', () => {
  // Travel measured against geometry that was never posed is noise. Reporting
  // it beside the real defect would split the one pass left across a cause and
  // its own smoke.
  const wild = { bob: 0, parts: { leg: 30, arm: 12, clothing: 0 }, layersFrozen: ['shirt', 'body'] };
  const list = findings(wild, BAND, poseCheck(REDRAWN, SOURCE));

  assert.equal(list.length, 1, `expected the redraw alone, got ${list.map((f) => f.severity).join(', ')}`);
  assert.equal(list[0].severity, 'redrawn');
  assert.match(list[0].text, /0 of 3 paths match/);
});

test('travel outside a drawn frame’s band is reported with the number to aim at', () => {
  const over = { bob: 0, parts: { leg: 8, arm: 12, clothing: 3 }, layersFrozen: [] };
  const [finding] = findings(over, BAND, poseCheck(POSED, SOURCE));
  assert.equal(finding.severity, 'over');
  assert.match(finding.text, /arm travelled 12\.0%/);
  assert.match(finding.text, /4\.8%/, 'a finding has to say what to aim for, not only what is wrong');

  const under = { bob: 0, parts: { leg: 8, arm: 0.2, clothing: 3 }, layersFrozen: [] };
  assert.equal(findings(under, BAND, poseCheck(POSED, SOURCE))[0].severity, 'under');
});

test('a figure whose torso never moved is a finding, not a footnote', () => {
  // This is the pose that reads as a stretch rather than a stride: legs swinging
  // through their whole band while everything above the waist is held still.
  const frozen = { bob: 0, parts: { leg: 8, arm: 4, clothing: 3 }, layersFrozen: ['body', 'shirt'] };
  const list = findings(frozen, BAND, poseCheck(POSED, SOURCE));
  assert.equal(list.length, 1);
  assert.equal(list[0].severity, 'frozen');
  assert.match(list[0].text, /body, shirt/);
});

test('the stop flag turns revise into save once the passes are spent', () => {
  const bad = { bob: 0, parts: { leg: 8, arm: 12, clothing: 3 }, layersFrozen: [] };
  const pose = poseCheck(POSED, SOURCE);

  // A run that keeps revising is a run the app kills with nothing saved.
  assert.equal(grade(bad, BAND, pose, { pass: 1, passes: 2 }).verdict, 'revise');
  assert.equal(grade(bad, BAND, pose, { pass: 2, passes: 2 }).verdict, 'save');

  // And a clean frame passes on any pass, with nothing left to say about it.
  const good = grade(GOOD_STEP, BAND, pose, { pass: 2, passes: 2 });
  assert.equal(good.verdict, 'pass');
  assert.deepEqual(good.findings, []);
});
