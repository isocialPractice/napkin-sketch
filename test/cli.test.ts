/** Launch option + CLI argument parsing tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLaunchOptions, decodeLaunchOptions } from '../src/core/launch.js';
import { parseArgs, parseCommand, splitImportList } from '../src/cli/args.js';

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

test('a first word that names a command selects it, and the GUI flags are not read', () => {
  for (const word of ['draw', 'check', 'render', 'verbs']) {
    const r = parseArgs([word, ...(word === 'verbs' ? [] : ['x.napkin'])]);
    assert.equal(r.command?.command, word);
    assert.equal(r.mode, null);
  }
  assert.equal(parseArgs(['drawing.skbk']).command, null, 'a book that only starts with a command word is still a book');
  assert.equal(parseArgs(['drawing.skbk']).mode, 'book');
  assert.equal(parseArgs(['--new', 'draw']).command, null, 'nor is a command word after a flag');
});

test('draw reads its script, its formats and its options', () => {
  const r = parseCommand('draw', [
    'card.napkin', '--to', 'SVG,png, pdf', '--out', 'out', '--name=poster', '--base', 'art',
    '--asset', 'logo=art/logo.png', '--asset=badge=D:/art/badge.png', '--use', 'frame=frame.skbk',
    '--seed', '-3', '--scale', '2', '--crop', '10,20,100,50', '--limit', '5000', '--json', '--strict', '--quiet',
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.input, 'card.napkin');
  assert.deepEqual(r.formats, ['svg', 'png', 'pdf']);
  assert.deepEqual([r.out, r.name, r.base], ['out', 'poster', 'art']);
  assert.deepEqual(r.assets, { logo: 'art/logo.png', badge: 'D:/art/badge.png' }, 'the name ends at the first =');
  assert.deepEqual(r.documents, { frame: 'frame.skbk' });
  assert.deepEqual([r.seed, r.scale, r.limit], [-3, 2, 5000], 'a value may start with one -');
  assert.deepEqual(r.crop, { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual([r.json, r.strict, r.quiet, r.help], [true, true, true, false]);
  assert.equal(parseCommand('draw', ['-']).input, '-', '- is standard input');
  assert.deepEqual(parseCommand('draw', ['x.napkin']).formats, ['svg'], 'svg unless --to says otherwise');
  assert.equal(parseCommand('draw', ['x.napkin', '--crop', 'auto']).crop, 'auto');
  assert.equal(parseCommand('draw', ['x.napkin', '--crop=none']).crop, 'none');
});

test('what is wrong with a command\'s arguments comes back as sentences, not a throw', () => {
  const errors = (command: 'draw' | 'check' | 'render' | 'verbs', argv: string[]): string[] => parseCommand(command, argv).errors;
  assert.deepEqual(errors('draw', []), ['draw needs a script: a file, - for standard input, or --prompt with a request']);
  assert.deepEqual(errors('draw', ['a.napkin', '--prompt', 'a card']), ['draw reads a script or a --prompt, not both; not a.napkin with --prompt']);
  assert.deepEqual(errors('draw', ['--prompt', '  ']), ['--prompt needs a request: what the script should draw']);
  assert.deepEqual(errors('draw', ['--prompt', 'a card', '--helper', ' ']), ['--helper needs a command to run']);
  assert.deepEqual(errors('check', ['a.napkin', '--prompt', 'a card']), ['check does not take --prompt']);
  assert.deepEqual(errors('render', ['a.skbk', '--animate', 'moonwalk']), ['--animate takes an animation with a measured cycle: walk, run, ideal, knocked-down; not "moonwalk"']);
  assert.deepEqual(errors('render', ['a.skbk', '--animate', 'walk', '--frames', '1']), ['--frames takes a whole number from 2 to 60; not "1"']);
  assert.deepEqual(errors('render', ['a.skbk', '--animate', 'walk', '--facing', 'up']), ['--facing takes left or right; not "up"']);
  assert.deepEqual(errors('render', ['a.skbk', '--frames', '4']), ['--frames and --facing go with --animate']);
  assert.deepEqual(errors('render', ['a.skbk', '--animate', 'walk', '--crop', 'auto']), ['--animate cuts every frame to one box of its own, so it takes no --crop']);
  assert.deepEqual(errors('draw', ['a.napkin', '--animate', 'walk']), ['draw does not take --animate']);
  const animated = parseCommand('render', ['a.skbk', '--animate', 'Walk', '--frames', '12', '--facing', 'left']);
  assert.deepEqual([animated.animate, animated.frames, animated.facing, animated.errors], ['walk', 12, 'left', []]);
  assert.equal(parseCommand('render', ['a.skbk', '--animate', 'idle']).animate, 'ideal', 'the label the app shows');
  assert.equal(parseCommand('render', ['a.skbk', '--animate', 'knocked down']).animate, 'knocked-down');
  const asked = parseCommand('draw', ['--prompt', ' a three-box flowchart ', '--helper', 'codex exec']);
  assert.deepEqual([asked.input, asked.prompt, asked.helper, asked.errors], [undefined, 'a three-box flowchart', 'codex exec', []]);
  assert.deepEqual(errors('draw', ['a.napkin', 'b.napkin']), ['draw reads one script at a time; not a.napkin, b.napkin']);
  assert.deepEqual(errors('draw', ['a.napkin', '--to', 'jpg']), ['--to takes svg, png, pdf, skbk, jsx, comma-separated; not "jpg"']);
  assert.deepEqual(errors('draw', ['a.napkin', '--to']), ['--to needs a value']);
  assert.deepEqual(errors('draw', ['a.napkin', '--to', '--json']), ['--to needs a value'], 'a flag is never a value');
  assert.deepEqual(errors('draw', ['a.napkin', '--asset', 'logo']), ['--asset takes <name>=<file>; not "logo"']);
  assert.deepEqual(errors('draw', ['a.napkin', '--scale', '0']), ['--scale takes a number above 0; not "0"']);
  assert.deepEqual(errors('draw', ['a.napkin', '--limit', '2.5']), ['--limit takes a whole number above 0; not "2.5"']);
  assert.deepEqual(errors('draw', ['a.napkin', '--crop', '1,2,3']), ['--crop takes auto, none, or a box x,y,width,height; not "1,2,3"']);
  assert.deepEqual(errors('draw', ['a.napkin', '--crop', '0,0,0,10']), ['--crop needs a box with a width and a height above 0; not "0,0,0,10"']);
  assert.deepEqual(errors('draw', ['a.napkin', '--json=yes']), ['--json takes no value']);
  assert.deepEqual(errors('draw', ['a.napkin', '--frobnicate']), ['unknown option --frobnicate']);
  assert.deepEqual(errors('check', ['a.napkin', '--to', 'png']), ['check does not take --to'], "another command's flag, and its value, are passed over");
  assert.deepEqual(errors('render', []), ['render needs a .skbk book to read']);
  assert.deepEqual(errors('render', ['-']), ['render reads a .skbk file, not standard input']);
  assert.deepEqual(errors('render', ['book.skbk', '--page', '0']), ['--page takes a page number, counting from 1; not "0"']);
  assert.deepEqual(errors('verbs', ['rect']), ['verbs takes no script; not "rect"']);
  assert.deepEqual(errors('draw', ['--help']), [], 'help needs no script');
  assert.equal(parseCommand('verbs', ['-h']).help, true);
});

test('full-screen survives the launch-options round-trip', () => {
  const restored = decodeLaunchOptions(
    encodeLaunchOptions({ mode: 'new', sketchName: 'x', fullScreen: true }),
  );
  assert.equal(restored.fullScreen, true);
  assert.equal(decodeLaunchOptions(encodeLaunchOptions({ mode: 'new' })).fullScreen, false);
});
