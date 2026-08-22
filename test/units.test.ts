/** Properties-panel unit conversion tests (browser-safe module). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CSS_PX_PER_INCH,
  LENGTH_UNITS,
  SCALE_UNITS,
  formatLength,
  fromPx,
  isLengthUnit,
  isScaleUnit,
  toPx,
  unitPrecision,
  unitStep,
} from '../src/core/units.js';

test('toPx converts each unit through the CSS reference resolution', () => {
  assert.equal(toPx(10, 'px'), 10);
  assert.equal(toPx(1, 'in'), CSS_PX_PER_INCH);
  assert.equal(toPx(72, 'pt'), CSS_PX_PER_INCH);
  assert.equal(toPx(25.4, 'mm'), CSS_PX_PER_INCH);
});

test('fromPx is the exact inverse of toPx', () => {
  for (const unit of LENGTH_UNITS) {
    for (const value of [0, 1, 3.5, 137.25]) {
      assert.ok(Math.abs(fromPx(toPx(value, unit), unit) - value) < 1e-9, `${value}${unit}`);
    }
  }
});

test('a value typed in a unit survives a round trip through the field', () => {
  // What the panel actually does: format a pixel measurement for display,
  // then read the displayed value back as pixels.
  for (const unit of LENGTH_UNITS) {
    const typed = 12.5;
    const px = toPx(typed, unit);
    assert.equal(Number(formatLength(px, unit)), typed, unit);
  }
});

test('formatLength rounds to the unit precision and drops trailing zeros', () => {
  assert.equal(formatLength(10, 'px'), '10');
  assert.equal(formatLength(96, 'in'), '1');
  assert.equal(formatLength(0, 'mm'), '0');
  // 1px is well under a tenth of a millimetre of display precision.
  assert.equal(formatLength(1, 'mm'), '0.26');
  assert.equal(formatLength(1, 'pt'), '0.75');
});

test('formatLength never emits negative zero', () => {
  assert.equal(formatLength(-0.001, 'px'), '0');
});

test('unit precision and step agree', () => {
  for (const unit of LENGTH_UNITS) {
    assert.equal(unitStep(unit), 1 / 10 ** unitPrecision(unit));
  }
});

test('unit guards accept the offered units and reject anything else', () => {
  for (const unit of LENGTH_UNITS) assert.ok(isLengthUnit(unit));
  for (const unit of SCALE_UNITS) assert.ok(isScaleUnit(unit));
  assert.ok(isScaleUnit('%'));
  assert.ok(!isLengthUnit('%'));
  assert.ok(!isLengthUnit('em'));
  assert.ok(!isScaleUnit('em'));
  assert.ok(!isLengthUnit(undefined));
});
