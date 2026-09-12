/**
 * SVG import tests.
 *
 * `importSvg` itself needs a DOM (getTotalLength/getScreenCTM), so these cover
 * the DOM-free half: turning an editor's XML id back into the layer name the
 * source document showed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeIdName, isAutoId, normalizeColor, parsePathD, parseVectorD } from '../src/renderer/svg-import.js';

test('decodeIdName strips the uniquifier editors append to repeated names', () => {
  assert.equal(decodeIdName('outline-2'), 'outline');
  assert.equal(decodeIdName('strokes-10'), 'strokes');
  assert.equal(decodeIdName('light-mid-2'), 'light-mid');
});

test('decodeIdName keeps names that merely end in a number', () => {
  assert.equal(decodeIdName('outline'), 'outline');
  assert.equal(decodeIdName('run_8'), 'run_8');
  assert.equal(decodeIdName('layer-1'), 'layer-1');
  assert.equal(decodeIdName('layer-0'), 'layer-0');
  assert.equal(decodeIdName('-2'), '-2');
});

test('decodeIdName undoes _xHH_ escaping of characters illegal in an id', () => {
  assert.equal(decodeIdName('front_x20_arm'), 'front arm');
  assert.equal(decodeIdName('back_x20_arm-3'), 'back arm');
  // A malformed escape is left alone rather than mangled.
  assert.equal(decodeIdName('a_x0_b'), 'a_x0_b');
});

test('isAutoId rejects the ids Inkscape assigns to unnamed elements', () => {
  assert.equal(isAutoId('path4521'), true);
  assert.equal(isAutoId('g830'), true);
  assert.equal(isAutoId('rect12'), true);
  assert.equal(isAutoId('tspan-7'), true);
});

test('isAutoId keeps author names, including ones ending in a number', () => {
  assert.equal(isAutoId('outline'), false);
  assert.equal(isAutoId('run_8'), false);
  assert.equal(isAutoId('layer-0'), false);
  // A tag name is only auto-generated with digits behind it.
  assert.equal(isAutoId('text'), false);
  assert.equal(isAutoId('line'), false);
});

test('parseVectorD rebuilds anchors and handles from an exported cubic path', () => {
  const parsed = parseVectorD('M10,10 C40,10 60,60 90,60 L120,90');
  assert.ok(parsed);
  assert.equal(parsed.closed, false);
  assert.deepEqual(parsed.anchors, [
    { p: { x: 10, y: 10 }, hOut: { x: 40, y: 10 } },
    { p: { x: 90, y: 60 }, hIn: { x: 60, y: 60 } },
    { p: { x: 120, y: 90 } },
  ]);
});

test('parseVectorD folds a closed path\'s duplicate final anchor onto the first', () => {
  const parsed = parseVectorD('M0,0 L50,0 L25,40 L0,0 Z');
  assert.ok(parsed);
  assert.equal(parsed.closed, true);
  assert.deepEqual(parsed.anchors.map((a) => a.p), [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 25, y: 40 },
  ]);
});

test('parseVectorD reads a control point on its anchor as a collapsed handle', () => {
  const parsed = parseVectorD('M0,0 C0,0 5,5 10,0');
  assert.ok(parsed);
  assert.equal(parsed.anchors[0].hOut, undefined);
  assert.deepEqual(parsed.anchors[1].hIn, { x: 5, y: 5 });
});

test('parseVectorD rejects paths that are not the napkin export format', () => {
  // Open pure polylines parse through the polyline path instead.
  assert.equal(parseVectorD('M0,0 L10,10'), null);
  // Arcs and quadratics are spellings the exporter never writes, and several
  // subpaths in one path fall back to sampling.
  assert.equal(parseVectorD('M0,0 A5,5 0 0 1 10,10'), null);
  assert.equal(parseVectorD('M0,0 Q5,5 10,0'), null);
  assert.equal(parseVectorD('M0,0 C1,1 2,2 3,3 M5,5 C6,6 7,7 8,8'), null);
  assert.equal(parseVectorD(''), null);
});

test('parseVectorD reads the compacted spellings the exporter writes', () => {
  // Relative commands, a reflected `s` handle, and an elided command letter
  // are all shorter ways of writing what an absolute `C` chain would say.
  const relative = parseVectorD('M10,10c5,0 10,5 10,10s-5,10-10,10');
  const absolute = parseVectorD('M10,10 C15,10 20,15 20,20 C20,25 15,30 10,30');
  assert.ok(relative && absolute);
  assert.deepEqual(relative.anchors, absolute.anchors);
  // A closed path in its relative spelling closes just the same.
  const closed = parseVectorD('M0 0H50L25 40 0 0Z');
  assert.ok(closed);
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.anchors.map((a) => a.p), [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 25, y: 40 },
  ]);
});

// ---- parsePathD: generic path data → cubic anchors ---------------------------

const near = (a: { x: number; y: number } | undefined, x: number, y: number, tol = 1e-6): void => {
  assert.ok(a, 'point expected');
  assert.ok(Math.abs(a.x - x) < tol && Math.abs(a.y - y) < tol, `(${a.x}, ${a.y}) != (${x}, ${y})`);
};

test('parsePathD reads relative cubics and reflects the handle for a smooth S chain', () => {
  const subs = parsePathD('M10,10c5,0 10,5 10,10s-5,10-10,10');
  assert.ok(subs && subs.length === 1);
  const [a0, a1, a2] = subs[0].anchors;
  assert.equal(subs[0].closed, false);
  near(a0.p, 10, 10);
  near(a0.hOut, 15, 10);
  near(a1.p, 20, 20);
  near(a1.hIn, 20, 15);
  // S: the leading handle mirrors the previous trailing one through the anchor.
  near(a1.hOut, 20, 25);
  near(a2.p, 10, 30);
  near(a2.hIn, 15, 30);
});

test('parsePathD turns H and V into lines and closes with Z', () => {
  const subs = parsePathD('M0,0 h10 v5 H0 Z');
  assert.ok(subs && subs.length === 1);
  assert.equal(subs[0].closed, true);
  assert.deepEqual(
    subs[0].anchors.map((a) => a.p),
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
  );
  assert.ok(subs[0].anchors.every((a) => !a.hIn && !a.hOut), 'lines carry no handles');
});

test('parsePathD elevates quadratics to the identical cubic', () => {
  // Q handles sit two thirds of the way from each endpoint to the control point.
  const subs = parsePathD('M0,0 Q3,6 6,0 T12,0');
  assert.ok(subs && subs.length === 1);
  const [a0, a1, a2] = subs[0].anchors;
  near(a0.hOut, 2, 4);
  near(a1.hIn, 4, 4);
  // T reflects the quadratic control (3,6) through (6,0) to (9,-6).
  near(a1.hOut, 8, -4);
  near(a2.hIn, 10, -4);
  near(a2.p, 12, 0);
});

test('parsePathD approximates an arc with KAPPA-length cubic handles', () => {
  const subs = parsePathD('M10,0 A10,10 0 0 1 0,10');
  assert.ok(subs && subs.length === 1);
  const [a0, a1] = subs[0].anchors;
  assert.equal(subs[0].anchors.length, 2, 'a quarter turn is one cubic');
  const k = (4 / 3) * (Math.SQRT2 - 1) * 10;
  near(a0.hOut, 10, k, 1e-9);
  near(a1.hIn, k, 10, 1e-9);
  near(a1.p, 0, 10);
});

test('parsePathD splits a semicircle arc into quarter-turn pieces', () => {
  const subs = parsePathD('M-10,0 A10,10 0 0 1 10,0');
  assert.ok(subs && subs.length === 1);
  assert.equal(subs[0].anchors.length, 3);
  near(subs[0].anchors[1].p, 0, -10, 1e-9);
  near(subs[0].anchors[2].p, 10, 0);
});

test('parsePathD keeps every subpath and folds a closing duplicate anchor', () => {
  const subs = parsePathD('M0,0 L1,0 L1,1 L0,0 Z M5,5 L6,5');
  assert.ok(subs && subs.length === 2);
  assert.equal(subs[0].closed, true);
  assert.equal(subs[0].anchors.length, 3);
  assert.equal(subs[1].closed, false);
  assert.deepEqual(subs[1].anchors.map((a) => a.p), [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
  ]);
});

test('parsePathD continues from the subpath start after Z without a moveto', () => {
  const subs = parsePathD('M0,0 L4,0 L4,4 Z l0,8');
  assert.ok(subs && subs.length === 2);
  assert.deepEqual(subs[1].anchors.map((a) => a.p), [
    { x: 0, y: 0 },
    { x: 0, y: 8 },
  ]);
});

test('parsePathD repeats an implicit command and reads Illustrator number packing', () => {
  // Pairs after M are linetos; "-.5-.3" and "1.5.3" are two numbers each.
  const subs = parsePathD('M0,0 1,1 2,0');
  assert.ok(subs && subs.length === 1);
  assert.equal(subs[0].anchors.length, 3);
  const packed = parsePathD('M1.5.3l-.5-.3');
  assert.ok(packed && packed.length === 1);
  near(packed[0].anchors[0].p, 1.5, 0.3);
  near(packed[0].anchors[1].p, 1, 0);
});

test('parsePathD returns null for data it cannot read', () => {
  assert.equal(parsePathD(''), null);
  assert.equal(parsePathD('L0,0 1,1'), null); // no leading moveto
  assert.equal(parsePathD('M0,0 L1'), null); // dangling coordinate
  assert.equal(parsePathD('M0,0 A5,5 0 2 1 10,10'), null); // arc flag must be 0 or 1
  assert.equal(parsePathD('M0,0 X1,1'), null); // unknown command
});

test('parseVectorD still accepts only the napkin export format, via parsePathD', () => {
  const parsed = parseVectorD('M0,0 C0,0 5,5 10,0 Z');
  assert.ok(parsed);
  assert.equal(parsed.closed, true);
  // A Z followed by more drawing is two subpaths, not napkin's one.
  assert.equal(parseVectorD('M0,0 L1,1 Z L2,2'), null);
});

test('normalizeColor writes computed rgb() colors back as hex', () => {
  assert.equal(normalizeColor('rgb(233, 175, 128)'), '#e9af80');
  assert.equal(normalizeColor('rgb(0,0,0)'), '#000000');
  // Alpha, hex, and keywords are left as they came.
  assert.equal(normalizeColor('rgba(0, 0, 0, 0.5)'), 'rgba(0, 0, 0, 0.5)');
  assert.equal(normalizeColor('#fff'), '#fff');
  assert.equal(normalizeColor('currentColor'), 'currentColor');
});
