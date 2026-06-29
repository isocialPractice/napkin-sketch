/** Launch option + CLI argument parsing tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLaunchOptions, decodeLaunchOptions } from '../src/core/launch.js';
import { parseArgs } from '../src/cli/args.js';

test('launch options round-trip through the env string', () => {
  const opts = { mode: 'book', filePath: '/tmp/a.skbk' } as const;
  const restored = decodeLaunchOptions(encodeLaunchOptions(opts));
  assert.equal(restored.mode, 'book');
  assert.equal(restored.filePath, '/tmp/a.skbk');
});

test('decodeLaunchOptions falls back to a new sketch', () => {
  assert.deepEqual(decodeLaunchOptions(undefined), { mode: 'new', sketchName: 'unnamed' });
  assert.equal(decodeLaunchOptions('not json').mode, 'new');
});

test('parseArgs handles help and version flags', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
});

test('parseArgs reads --book with a target', () => {
  const r = parseArgs(['--book', 'notes.skbk']);
  assert.equal(r.mode, 'book');
  assert.equal(r.target, 'notes.skbk');
});

test('parseArgs treats a bare positional as a book to open', () => {
  const r = parseArgs(['ideas.skbk']);
  assert.equal(r.mode, 'book');
  assert.equal(r.target, 'ideas.skbk');
});

test('parseArgs reads --new with an optional name', () => {
  assert.equal(parseArgs(['--new', 'doodle']).target, 'doodle');
  assert.equal(parseArgs(['--new']).mode, 'new');
});

test('parseArgs collects unknown flags', () => {
  assert.deepEqual(parseArgs(['--bogus']).unknown, ['--bogus']);
});

test('parseArgs flags --sharpen as sharpen-only', () => {
  const r = parseArgs(['--sharpen', 'notes']);
  assert.equal(r.mode, 'sharpen');
  assert.equal(r.sharpenOnly, true);
  assert.equal(r.target, 'notes');
});

test('parseArgs reads -f / --full-screen', () => {
  assert.equal(parseArgs(['-f']).fullScreen, true);
  assert.equal(parseArgs(['--full-screen']).fullScreen, true);
  assert.equal(parseArgs([]).fullScreen, false);
});

test('parseArgs combines --new with --full-screen', () => {
  const r = parseArgs(['--new', 'ideas', '-f']);
  assert.equal(r.mode, 'new');
  assert.equal(r.target, 'ideas');
  assert.equal(r.fullScreen, true);
});

test('full-screen survives the launch-options round-trip', () => {
  const restored = decodeLaunchOptions(
    encodeLaunchOptions({ mode: 'new', sketchName: 'x', fullScreen: true }),
  );
  assert.equal(restored.fullScreen, true);
  assert.equal(decodeLaunchOptions(encodeLaunchOptions({ mode: 'new' })).fullScreen, false);
});
