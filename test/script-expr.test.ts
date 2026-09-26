/**
 * Napkin script expressions: reading them, and running them against a scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPRESSION_FUNCTIONS,
  ExpressionError,
  evaluateExpression,
  parseExpression,
  type ExprScope,
} from '../src/core/script/expr.js';
import { toPx, type LengthUnit } from '../src/core/units.js';

/** A scope in pixels on a 400 by 300 page; `axis` is what a percentage is a share of, when it is one. */
function scope(names: Record<string, number> = {}, axis?: number): ExprScope {
  const all: Record<string, number> = { width: 400, height: 300, ...names };
  return {
    lookup: (name) => all[name],
    convert: (value: number, unit: LengthUnit) => toPx(value, unit),
    percent: (value) => (axis === undefined ? undefined : (value / 100) * axis),
  };
}

function run(source: string, names?: Record<string, number>, axis?: number): number {
  const parsed = parseExpression(source);
  assert.ok(parsed.ok, `${source}: ${parsed.ok ? '' : parsed.message}`);
  return evaluateExpression(parsed.node, scope(names, axis));
}

function parseError(source: string): { code: string; message: string; index: number } {
  const parsed = parseExpression(source);
  assert.equal(parsed.ok, false, `${source} should not read`);
  return parsed as { ok: false; code: string; message: string; index: number };
}

function runError(source: string, names?: Record<string, number>, axis?: number): ExpressionError {
  const parsed = parseExpression(source);
  assert.ok(parsed.ok, `${source} should read`);
  try {
    evaluateExpression(parsed.node, scope(names, axis));
  } catch (err) {
    assert.ok(err instanceof ExpressionError, `${source}: ${String(err)}`);
    return err;
  }
  assert.fail(`${source} should not run`);
}

test('operators bind the usual way, each group from left to right', () => {
  assert.equal(run('1 + 2 * 3'), 7);
  assert.equal(run('(1 + 2) * 3'), 9);
  assert.equal(run('-2 * 3'), -6);
  assert.equal(run('2 - -3'), 5);
  assert.equal(run('10 - 4 - 3'), 3);
  assert.equal(run('8 / 4 / 2'), 1);
  assert.equal(run('7 % 3'), 1);
  assert.equal(run('+5'), 5);
  assert.equal(run('1e2 + 1'), 101);
  assert.ok(Object.is(run('-0'), 0), 'no negative zero comes out');
});

test('names are let values, repeat counters, and the page', () => {
  assert.equal(run('i * 40 + 20', { i: 2 }), 100);
  assert.equal(run('width / 2 - height / 3'), 100);
  assert.equal(run('gap_2 * 2', { gap_2: 3 }), 6);
});

test('a number with a unit is converted into the current units', () => {
  assert.equal(run('1in'), 96);
  assert.equal(run('1in - 6px'), 90);
  assert.equal(run('72pt'), 96);
  assert.ok(Math.abs(run('25.4mm') - 96) < 1e-9);
});

test('a % right after a number is a share of the page, unless a value follows it', () => {
  assert.equal(run('50%', {}, 400), 200);
  assert.equal(run('50% - 20', {}, 400), 180);
  assert.equal(run('(25%) * 2', {}, 400), 200);
  assert.equal(run('10%3'), 1, 'a value right after the % makes it the remainder');
  assert.equal(run('10 % 3'), 1);
  const refused = runError('50%');
  assert.equal(refused.code, 'invalid-value', 'a share of the page needs an axis');
});

test('functions: trigonometry in degrees, exact at the exact angles', () => {
  assert.equal(run('sin(30)'), 0.5);
  assert.equal(run('cos(90)'), 0);
  assert.equal(run('cos(60)'), 0.5);
  assert.equal(run('tan(45)'), 1);
  assert.equal(run('sqrt(16)'), 4);
  assert.equal(run('abs(-3)'), 3);
  assert.equal(run('round(2.5)'), 3);
  assert.equal(run('floor(-1.5)'), -2);
  assert.equal(run('ceil(1.2)'), 2);
  assert.equal(run('min(3, 1, 2)'), 1);
  assert.equal(run('max(1, 5)'), 5);
  assert.equal(run('max(1, min(4, 3 * 2))'), 4);
  assert.equal(run('80 * cos(i * 30)', { i: 2 }), 40);
  assert.deepEqual(Object.keys(EXPRESSION_FUNCTIONS), ['sin', 'cos', 'tan', 'sqrt', 'abs', 'round', 'floor', 'ceil', 'min', 'max']);
});

test('what cannot be read is reported with where it stopped', () => {
  assert.match(parseError('').message, /empty/);
  assert.deepEqual([parseError('1 +').index, parseError('1 +').code], [3, 'invalid-expression']);
  assert.match(parseError('2 3').message, /operator is missing/);
  assert.equal(parseError('2 3').index, 2);
  assert.match(parseError('foo(1)').message, /`foo` is not a function/);
  assert.match(parseError('sin').message, /is a function: write `sin\(\.\.\.\)`/);
  assert.match(parseError('sin(1, 2)').message, /takes 1 argument, and got 2/);
  assert.match(parseError('min(1)').message, /takes at least 2 arguments, and got 1/);
  assert.match(parseError('(1 + 2').message, /not closed/);
  assert.match(parseError('1 @ 2').message, /`@` cannot appear/);
  assert.equal(parseError('1 @ 2').index, 2);
  const unit = parseError('10cm + 1');
  assert.equal(unit.code, 'unit-unknown');
  assert.equal(unit.index, 0);
});

test('what cannot be run is reported with its code', () => {
  assert.equal(runError('x + 1').code, 'unknown-variable');
  assert.match(runError('x + 1').message, /`x` has not been set/);
  assert.equal(runError('1 / 0').code, 'division-by-zero');
  assert.equal(runError('5 % (2 - 2)').code, 'division-by-zero');
  assert.equal(runError('sqrt(-1)').code, 'invalid-value');
});
