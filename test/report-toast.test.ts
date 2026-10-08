/**
 * Report toasts (src/renderer/report-toast.ts): the bottom-right notices that
 * say what an action could not do. The stack's rules are pure and driven here
 * with a clock of the test's own: when a report fades, what holds it, how the
 * stack drops and replaces, and where the column sits. The GUI check
 * `check-report-toast.mjs` drives the same toasts in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REPORT_TOASTS,
  REPORT_EDGE_PX,
  REPORT_GAP_PX,
  ReportToastStack,
  reportStackBottom,
  type ReportSpec,
} from '../src/renderer/report-toast.js';

const spec = (id: string, extra: Partial<ReportSpec> = {}): ReportSpec => ({ id, title: `Report ${id}`, ...extra });
const ids = (stack: ReportToastStack): string[] => stack.entries.map((entry) => entry.spec.id);

test('a report fades after its seconds, and never when the seconds are 0', () => {
  const stack = new ReportToastStack();
  const { entry, replaced, dropped } = stack.show(spec('a'), 1000, 15);
  assert.equal(replaced, false);
  assert.equal(dropped, null);
  assert.equal(entry.deadline, 16_000);
  assert.equal(stack.nextDeadline(), 16_000);
  assert.deepEqual(stack.expire(15_999), [], 'not a moment early');
  assert.deepEqual(stack.expire(16_000).map((e) => e.spec.id), ['a']);
  assert.deepEqual(ids(stack), []);

  const forever = new ReportToastStack();
  assert.equal(forever.show(spec('b'), 0, 0).entry.deadline, null);
  assert.equal(forever.nextDeadline(), null);
  assert.deepEqual(forever.expire(1e12), [], 'kept until it is closed');
});

test('a hold stops the fade, and letting go gives the full time again, not what was left', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 15);
  stack.hold('a', 'hover', true, 10_000, 15);
  assert.equal(stack.entries[0].deadline, null, 'held, it never fades');
  assert.deepEqual(stack.expire(60_000), []);
  stack.hold('a', 'hover', false, 60_000, 15);
  assert.equal(stack.entries[0].deadline, 75_000, 'fifteen seconds from the pointer leaving');
});

test('every hold must go before the fade starts again', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 15);
  stack.hold('a', 'hover', true, 1000, 15);
  stack.hold('a', 'expanded', true, 2000, 15);
  stack.hold('a', 'focus', true, 3000, 15);
  stack.hold('a', 'hover', false, 4000, 15);
  stack.hold('a', 'focus', false, 5000, 15);
  assert.equal(stack.entries[0].deadline, null, 'the open details still hold it');
  assert.deepEqual([...stack.entries[0].holds], ['expanded']);
  stack.hold('a', 'expanded', false, 6000, 15);
  assert.equal(stack.entries[0].deadline, 21_000);
});

test('only a change of hold touches the timer', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 15);
  // A focus that leaves a report it never entered must not restart its time.
  stack.hold('a', 'focus', false, 9000, 15);
  assert.equal(stack.entries[0].deadline, 15_000);
  stack.hold('a', 'hover', true, 9000, 15);
  stack.hold('a', 'hover', true, 9500, 15);
  stack.hold('a', 'hover', false, 10_000, 15);
  assert.equal(stack.entries[0].deadline, 25_000);
  // An id that is not on the stack is ignored.
  stack.hold('nobody', 'hover', true, 10_000, 15);
  assert.deepEqual(ids(stack), ['a']);
});

test('the setting is read at each release, so a change reaches the next one', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 15);
  stack.hold('a', 'hover', true, 1000, 15);
  stack.hold('a', 'hover', false, 2000, 30);
  assert.equal(stack.entries[0].deadline, 32_000);
  stack.hold('a', 'hover', true, 3000, 30);
  stack.hold('a', 'hover', false, 4000, 0);
  assert.equal(stack.entries[0].deadline, null, 'set to until closed, it stays');
});

test(`up to ${MAX_REPORT_TOASTS} stack, newest last, and the next drops the oldest`, () => {
  const stack = new ReportToastStack();
  for (const [i, id] of ['a', 'b', 'c'].entries()) assert.equal(stack.show(spec(id), i, 15).dropped, null);
  assert.deepEqual(ids(stack), ['a', 'b', 'c']);
  const { dropped } = stack.show(spec('d'), 3, 15);
  assert.equal(dropped?.spec.id, 'a');
  assert.deepEqual(ids(stack), ['b', 'c', 'd']);
});

test('the report dropped is the oldest that nothing holds', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 15);
  stack.show(spec('b'), 1, 15);
  stack.show(spec('c'), 2, 15);
  stack.hold('a', 'hover', true, 3, 15);
  assert.equal(stack.show(spec('d'), 4, 15).dropped?.spec.id, 'b', 'the one being read stays');
  assert.deepEqual(ids(stack), ['a', 'c', 'd']);
});

test('with every older report held, the oldest goes, and never the one just shown', () => {
  const stack = new ReportToastStack();
  for (const id of ['a', 'b', 'c']) {
    stack.show(spec(id), 0, 15);
    stack.hold(id, 'expanded', true, 0, 15);
  }
  assert.equal(stack.show(spec('d'), 1, 15).dropped?.spec.id, 'a');
  assert.deepEqual(ids(stack), ['b', 'c', 'd']);
});

test('a report with the id of one on screen replaces it where it stands', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 15);
  stack.show(spec('b'), 1000, 15);
  stack.show(spec('c'), 2000, 15);
  stack.hold('b', 'expanded', true, 3000, 15);
  const { entry, replaced, dropped } = stack.show(spec('b', { title: 'Report b, again', level: 'info' }), 5000, 15);
  assert.equal(replaced, true);
  assert.equal(dropped, null, 'nothing is dropped for a replacement');
  assert.deepEqual(ids(stack), ['a', 'b', 'c'], 'in its own place, not at the bottom');
  assert.equal(entry.spec.title, 'Report b, again');
  assert.equal(entry.shownAt, 5000);
  assert.deepEqual([...entry.holds], ['expanded'], 'its details stay open');
  assert.equal(entry.deadline, null, 'and still held');
  stack.hold('b', 'expanded', false, 6000, 15);
  const fresh = stack.show(spec('b'), 7000, 15);
  assert.equal(fresh.entry.deadline, 22_000, 'unheld, a replacement gets the full time again');
});

test('close takes a report off, and expire takes every one that is due, oldest first', () => {
  const stack = new ReportToastStack();
  stack.show(spec('a'), 0, 5);
  stack.show(spec('b'), 1000, 5);
  stack.show(spec('c'), 2000, 60);
  assert.equal(stack.close('nobody'), null);
  assert.equal(stack.nextDeadline(), 5000);
  assert.deepEqual(stack.expire(6000).map((e) => e.spec.id), ['a', 'b']);
  assert.deepEqual(ids(stack), ['c']);
  assert.equal(stack.close('c')?.spec.id, 'c');
  assert.equal(stack.nextDeadline(), null);
});

test('the column sits clear of the status bar, and of the nib indicator while it shows', () => {
  assert.equal(REPORT_EDGE_PX, 16);
  assert.equal(REPORT_GAP_PX, 8);
  // Nothing in the way: 16 px from the bottom.
  assert.equal(reportStackBottom(837, []), 16);
  // A status bar whose top is 34 px up: 8 px above it.
  assert.equal(reportStackBottom(837, [803]), 42);
  // The nib indicator, higher still, wins while it shows.
  assert.equal(reportStackBottom(837, [803, 744]), 101);
  // Something off the screen, or with no box, is ignored.
  assert.equal(reportStackBottom(837, [900, Number.NaN, -5]), 16);
  // Never closer to the bottom than the edge.
  assert.equal(reportStackBottom(837, [836], 0, 16), 16);
});
