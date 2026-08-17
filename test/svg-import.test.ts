/**
 * SVG import tests.
 *
 * `importSvg` itself needs a DOM (getTotalLength/getScreenCTM), so these cover
 * the DOM-free half: turning an editor's XML id back into the layer name the
 * source document showed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeIdName, isAutoId, parseVectorD } from '../src/renderer/svg-import.js';

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
  // Relative commands, arcs, and subpaths fall back to sampling.
  assert.equal(parseVectorD('M0,0 c5,5 10,10 20,0'), null);
  assert.equal(parseVectorD('M0,0 A5,5 0 0 1 10,10'), null);
  assert.equal(parseVectorD('M0,0 C1,1 2,2 3,3 M5,5 C6,6 7,7 8,8'), null);
  assert.equal(parseVectorD(''), null);
});
