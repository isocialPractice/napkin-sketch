/** Launch option + CLI argument parsing tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLaunchOptions, decodeLaunchOptions } from '../src/core/launch.js';
import { parseArgs, splitImportList } from '../src/cli/args.js';

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

test('parseArgs reads -i / --import with a file', () => {
  const r = parseArgs(['--import', 'logo.svg']);
  assert.equal(r.importRequested, true);
  assert.equal(r.importFile, 'logo.svg');
  assert.equal(parseArgs(['-i', 'a.png']).importFile, 'a.png');
});

test('parseArgs flags --import given without a value', () => {
  const r = parseArgs(['--import']);
  assert.equal(r.importRequested, true);
  assert.equal(r.importFile, undefined);
});

test('parseArgs reads -m / --multiple-imports as a comma list', () => {
  const r = parseArgs(['-m', 'a.svg,b.png,c.jpg']);
  assert.equal(r.multipleImportsRequested, true);
  assert.deepEqual(r.multipleImports, ['a.svg', 'b.png', 'c.jpg']);
});

test('parseArgs joins multiple-imports tokens split by spaces after commas', () => {
  // Shell tokens for: -m file.svg,"file name with space.eps", another.svg
  const r = parseArgs(['-m', 'file.svg,file name with space.eps,', 'another.svg']);
  assert.deepEqual(r.multipleImports, ['file.svg', 'file name with space.eps', 'another.svg']);
});

test('parseArgs combines --multiple-imports with other flags', () => {
  const r = parseArgs(['--new', 'ideas', '-m', 'a.svg,b.svg', '-f']);
  assert.equal(r.mode, 'new');
  assert.equal(r.target, 'ideas');
  assert.deepEqual(r.multipleImports, ['a.svg', 'b.svg']);
  assert.equal(r.fullScreen, true);
});

test('splitImportList trims entries and drops empties', () => {
  assert.deepEqual(splitImportList(['a.svg, b.svg ,', ' c.svg']), ['a.svg', 'b.svg', 'c.svg']);
  assert.deepEqual(splitImportList([]), []);
});

test('import files survive the launch-options round-trip', () => {
  const restored = decodeLaunchOptions(
    encodeLaunchOptions({
      mode: 'new',
      sketchName: 'x',
      importFiles: ['/tmp/a.svg', '/tmp/b.png'],
      importGrid: true,
    }),
  );
  assert.deepEqual(restored.importFiles, ['/tmp/a.svg', '/tmp/b.png']);
  assert.equal(restored.importGrid, true);
  const plain = decodeLaunchOptions(encodeLaunchOptions({ mode: 'new' }));
  assert.equal(plain.importFiles, undefined);
  assert.equal(plain.importGrid, false);
});

test('full-screen survives the launch-options round-trip', () => {
  const restored = decodeLaunchOptions(
    encodeLaunchOptions({ mode: 'new', sketchName: 'x', fullScreen: true }),
  );
  assert.equal(restored.fullScreen, true);
  assert.equal(decodeLaunchOptions(encodeLaunchOptions({ mode: 'new' })).fullScreen, false);
});
