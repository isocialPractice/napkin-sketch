/**
 * SVG import tests.
 *
 * `importSvg` itself needs a DOM (getTotalLength/getScreenCTM), so these cover
 * the DOM-free half: turning an editor's XML id back into the layer name the
 * source document showed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeIdName, isAutoId } from '../src/renderer/svg-import.js';

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
