/**
 * The command line's drawing commands - `draw`, `check`, `render`, `verbs` -
 * run as the CLI runs them, but in memory: `runCommand` with strings for
 * standard input and output, in a temporary folder each test makes and
 * removes. The last test runs the built CLI as a process, with `electron`
 * made impossible to load, which is the install the GUI cannot start on.
 * `draw --prompt` starts a real process too: a stand-in for an AI tool that
 * reads the form and saves a script, as a real helper does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMMAND_HELP, EXIT, runCommand } from '../src/cli/draw.js';
import { DEFAULT_SCRIPT_HELPER_COMMAND } from '../src/core/script/ai-bridge.js';
import { decodePng, isPng } from '../src/core/graphic-design/index.js';
import { DIAGNOSTICS, SHAPE_NAMES, VERBS, VERB_CATEGORIES, evaluate } from '../src/core/script/index.js';
import { serializeSketchBook } from '../src/core/serialize.js';
import { MEASURED_ANIMATION_TYPES } from '../src/core/script/animation.js';
import { CLI, cliSkipReason } from './helpers/built-cli.js';
import { walkFigure } from './helpers/walk-figure.js';
import { repoRoot } from './helpers/repo-root.js';

interface Run {
  code: number;
  out: string;
  err: string;
}

/** Runs a command in `cwd` with `stdin` as its standard input, catching what it prints. */
async function run(cwd: string, argv: string[], stdin = ''): Promise<Run> {
  let out = '';
  let err = '';
  const code = await runCommand({
    argv,
    stdin,
    stdout: { write: (text: string) => (out += text) },
    stderr: { write: (text: string) => (err += text) },
    cwd,
    version: '9.9.9',
  });
  return { code, out, err };
}

/** Runs `body` with a fresh temporary folder, removed afterwards whatever happens. */
async function inFolder(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-cli-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CARD = 'napkin 1\npage 200 100\nname "card"\nfill #ffe08a\nrect 10 10 180 80 r 8\n';
const BROKEN = 'napkin 1\npage 100 100\ncircl 10 10 5\ncircle 50 50 20\n';

test('draw writes a script to the formats asked for, and lists the files on standard output', async () => {
  await inFolder(async (dir) => {
    writeFileSync(join(dir, 'poster.napkin'), CARD);
    writeFileSync(join(dir, 'badge.napkin'), 'napkin 1\npage 100 100\ncircle 50 50 40\n');
    const drawn = await run(dir, ['draw', 'poster.napkin', '--to', 'svg,png']);
    assert.equal(drawn.code, EXIT.ok);
    assert.equal(drawn.out, 'card.svg\ncard.png\n', "named by the script's own name");
    assert.equal(drawn.err, '');
    assert.ok(readFileSync(join(dir, 'card.svg'), 'utf8').startsWith('<?xml'));
    assert.ok(isPng(new Uint8Array(readFileSync(join(dir, 'card.png')))));
    assert.equal((await run(dir, ['draw', 'badge.napkin'])).out, 'badge.svg\n', "a script with no name is named after its file, and svg is the default");
    assert.equal((await run(dir, ['draw', 'poster.napkin', '--name', 'front'])).out, 'front.svg\n', '--name wins over both');
    const nested = await run(dir, ['draw', 'poster.napkin', '--out', 'out/web', '--to', 'pdf,skbk']);
    assert.equal(nested.out, `${join('out', 'web', 'card.pdf')}\n${join('out', 'web', 'card.skbk')}\n`, 'the output folder is made');
  });
});

test('draw reads a script from standard input, as text or as the object form', async () => {
  await inFolder(async (dir) => {
    assert.equal((await run(dir, ['draw', '-'], CARD)).out, 'card.svg\n');
    assert.equal((await run(dir, ['draw', '-'], 'napkin 1\ncircle 50 50 20\n')).out, 'drawing.svg\n', 'standard input with no name is a drawing');
    const script = JSON.stringify([
      { verb: 'napkin', version: 1 },
      { verb: 'name', name: 'dot' },
      { verb: 'circle', cx: 50, cy: 50, r: 20 },
    ]);
    const json = await run(dir, ['draw', '-'], `  ${script}`);
    assert.equal(json.code, EXIT.ok);
    assert.equal(json.out, 'dot.svg\n');
    const bom = await run(dir, ['draw', '-'], `${String.fromCharCode(0xfeff)}${CARD}`);
    assert.equal(bom.code, EXIT.ok, 'a byte-order mark in front is not part of the script');
  });
});

test('--json prints one line of JSON on standard output, and nothing else anywhere', async () => {
  await inFolder(async (dir) => {
    const drawn = await run(dir, ['draw', '-', '--json', '--to', 'png', '--scale', '2'], CARD);
    assert.equal(drawn.err, '');
    assert.equal(drawn.out.split('\n').length, 2, 'one line, ended');
    const report = JSON.parse(drawn.out);
    assert.deepEqual(report, {
      ok: true,
      exitCode: 0,
      files: [{ path: 'card.png', format: 'png', page: 1 }],
      diagnostics: [],
      warnings: [],
      stats: { instructions: 5, marks: 1, anchors: 8, points: report.stats.points, pages: 1 },
      version: '9.9.9',
      language: 1,
    });
    const png = decodePng(new Uint8Array(readFileSync(join(dir, 'card.png'))));
    assert.deepEqual([png.width, png.height], [400, 200], '--scale reaches the PNG');
  });
});

test('exit 2: a script with errors still writes what it could draw, unless --strict', async () => {
  await inFolder(async (dir) => {
    const broken = await run(dir, ['draw', '-'], BROKEN);
    assert.equal(broken.code, EXIT.script);
    assert.equal(broken.out, 'drawing.svg\n', 'the circle it could draw is written');
    assert.equal(broken.err, '<stdin>:3:1: error unknown-verb: `circl` is not a verb. Did you mean `circle`?\n');
    const report = JSON.parse((await run(dir, ['draw', '-', '--json'], BROKEN)).out);
    assert.deepEqual([report.ok, report.exitCode, report.diagnostics.map((d: { code: string }) => d.code)], [false, 2, ['unknown-verb']]);

    const strict = await run(dir, ['draw', '-', '--strict', '--out', 'strict'], 'circle 50 50 20\n');
    assert.equal(strict.code, EXIT.script, 'with --strict a warning fails the run');
    assert.match(strict.err, /warning version-missing/);
    assert.equal(strict.out, '');
    assert.equal(existsSync(join(dir, 'strict')), false, 'and nothing is written');

    const quiet = await run(dir, ['draw', '-', '--quiet', '--out', 'quiet'], 'circle 50 50 20\n');
    assert.deepEqual([quiet.code, quiet.out, quiet.err], [EXIT.ok, '', ''], '--quiet prints errors and nothing else');
    assert.equal(existsSync(join(dir, 'quiet', 'drawing.svg')), true);

    const notJson = await run(dir, ['draw', '-'], '[{ "verb": "circle",');
    assert.equal(notJson.code, EXIT.script);
    assert.match(notJson.err, /^<stdin>(:\d+:\d+)?: error unexpected-token: The script is not JSON/);
    const notArray = await run(dir, ['draw', '-', '--json'], '{ "verb": "circle" }');
    assert.deepEqual(JSON.parse(notArray.out).diagnostics.map((d: { code: string }) => d.code), ['invalid-value']);
  });
});

test('exit 1: arguments that are wrong stop the command before anything runs', async () => {
  await inFolder(async (dir) => {
    const missing = await run(dir, ['draw']);
    assert.equal(missing.code, EXIT.usage);
    assert.equal(missing.err, 'napkin-sketch: draw needs a script: a file, - for standard input, or --prompt with a request\nRun "napkin-sketch draw --help" for its options.\n');
    const json = JSON.parse((await run(dir, ['draw', 'x.napkin', '--to', 'gif', '--json'])).out);
    assert.deepEqual([json.ok, json.exitCode, json.error], [false, 1, { kind: 'usage', message: '--to takes svg, png, pdf, skbk, jsx, comma-separated; not "gif"' }]);
    assert.deepEqual(readdirSync(dir), [], 'nothing was written');
  });
});

/**
 * A stand-in for an AI tool, written into the test's folder: it reads the form
 * napkin-sketch wrote and saves a script, as a real helper does. Its mode says
 * how: `good` saves a clean script, `fix` a broken one first and the clean one
 * when the form asks for a second try, `print` prints the script instead,
 * `unversioned` saves one with no `napkin 1`, `silent` saves nothing, and
 * `signed-out` fails the way a tool with no sign-in does. Gives back the
 * command that runs it, less the mode.
 */
function fakeHelper(dir: string): string {
  writeFileSync(
    join(dir, 'fake-helper.mjs'),
    [
      "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      'const mode = process.argv[2];',
      'const NL = String.fromCharCode(10);',
      "const form = readFileSync('_temp/script-form.txt', 'utf8');",
      `const good = ${JSON.stringify(CARD)};`,
      `const broken = ${JSON.stringify(BROKEN)};`,
      "if (mode === 'silent') process.exit(0);",
      "if (mode === 'signed-out') { console.error('Error: not logged in. Please log in.'); process.exit(1); }",
      "if (mode === 'print') { console.log(['Here it is:', '', '```napkin', good.trimEnd(), '```'].join(NL)); process.exit(0); }",
      "mkdirSync('_temp', { recursive: true });",
      "const second = form.includes('## Try 2 of 2');",
      "const script = mode === 'fix' && !second ? broken : mode === 'unversioned' ? good.slice(good.indexOf(NL) + 1) : good;",
      "writeFileSync('_temp/script-out.napkin', script);",
      "console.log('saved _temp/script-out.napkin');",
      '',
    ].join('\n'),
  );
  return `"${process.execPath}" fake-helper.mjs`;
}

test('draw --prompt: a script with errors goes back to the helper once, and the fix is kept and drawn', async () => {
  await inFolder(async (dir) => {
    const helper = fakeHelper(dir);
    const drawn = await run(dir, ['draw', '--prompt', 'a card', '--helper', `${helper} fix`, '--to', 'svg']);
    assert.equal(drawn.code, EXIT.ok, drawn.err);
    assert.equal(drawn.out, 'card.napkin\ncard.svg\n', 'the script is kept under the page name, before the files');
    assert.match(drawn.err, /^napkin-sketch: asking node for a script\n/);
    assert.match(drawn.err, /napkin-sketch: the script had errors; asking node to fix them, try 2 of 2\n/);
    assert.equal(readFileSync(join(dir, 'card.napkin'), 'utf8'), CARD);
    assert.match(readFileSync(join(dir, 'card.svg'), 'utf8'), /<svg /);
    assert.equal(existsSync(join(dir, '_temp')), false, 'the form, and the script that answered it, are gone');
  });
});

test('draw --prompt --json: the report carries the script, the tries it took, and where it was kept', async () => {
  await inFolder(async (dir) => {
    const helper = fakeHelper(dir);
    const printed = await run(dir, ['draw', '--prompt', 'a card', '--helper', `${helper} print`, '--json']);
    assert.equal(printed.err, '', 'nothing but the report');
    const json = JSON.parse(printed.out);
    assert.deepEqual([json.ok, json.exitCode, json.files], [true, 0, [{ path: 'card.svg', format: 'svg', page: 1 }]]);
    assert.deepEqual(json.script, { attempts: 1, text: CARD, path: 'card.napkin' }, 'a script printed rather than saved is read from the reply');
    // NAPKIN_SCRIPT_HELPER names the helper when --helper does not.
    let out = '';
    const code = await runCommand({
      argv: ['draw', '--prompt', 'a card', '--name', 'from-env', '--json'],
      stdin: '',
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: () => undefined },
      cwd: dir,
      version: '9.9.9',
      env: { NAPKIN_SCRIPT_HELPER: `${helper} good` },
    });
    assert.deepEqual([code, JSON.parse(out).script.path], [EXIT.ok, 'from-env.napkin']);
  });
});

test('draw --prompt --strict writes nothing when the script it got back reports anything, and hands the script over', async () => {
  await inFolder(async (dir) => {
    const helper = fakeHelper(dir);
    const json = JSON.parse((await run(dir, ['draw', '--prompt', 'a card', '--helper', `${helper} unversioned`, '--strict', '--json'])).out);
    assert.deepEqual(
      [json.exitCode, json.files, json.script.path, json.diagnostics.map((d: { code: string }) => d.code)],
      [EXIT.script, [], undefined, ['version-missing']],
    );
    assert.ok(json.script.text.startsWith('page 200 100'), 'the script comes back in the report, to fix');
    assert.deepEqual(readdirSync(dir), ['fake-helper.mjs'], 'nothing was written');
  });
});

test('exit 4: draw --prompt with no script back says why - missing, signed out, or silent - and writes nothing', async () => {
  await inFolder(async (dir) => {
    const helper = fakeHelper(dir);
    const silent = JSON.parse((await run(dir, ['draw', '--prompt', 'a card', '--helper', `${helper} silent`, '--json'])).out);
    assert.deepEqual([silent.ok, silent.exitCode, silent.error.kind, silent.error.reason], [false, EXIT.helper, 'helper', 'no-script']);
    assert.equal(silent.error.message, 'node finished without saving a script to _temp/script-out.napkin or printing one');
    const signedOut = JSON.parse((await run(dir, ['draw', '--prompt', 'a card', '--helper', `${helper} signed-out`, '--json'])).out);
    assert.deepEqual([signedOut.exitCode, signedOut.error.reason], [EXIT.helper, 'auth']);
    const missing = await run(dir, ['draw', '--prompt', 'a card', '--helper', 'no-such-napkin-helper --go']);
    assert.equal(missing.code, EXIT.helper);
    assert.match(missing.err, /^napkin-sketch: no-such-napkin-helper was not found on the PATH: install it, or name another helper with --helper or NAPKIN_SCRIPT_HELPER\n/);
    assert.deepEqual(readdirSync(dir), ['fake-helper.mjs'], 'nothing was written');
  });
});

test('draw --help says how --prompt runs, and names the default helper command', () => {
  const help = COMMAND_HELP.draw.replace(/\s+/g, ' ');
  assert.ok(help.includes('napkin-sketch draw --prompt "<request>" [options]'));
  assert.ok(help.includes(DEFAULT_SCRIPT_HELPER_COMMAND), 'the wrapped default is the constant');
  assert.ok(help.includes('4 --prompt got no script back from the AI helper'));
});

test('exit 3: a file that cannot be read or written', async () => {
  await inFolder(async (dir) => {
    const noScript = await run(dir, ['draw', 'missing.napkin']);
    assert.equal(noScript.code, EXIT.io);
    assert.match(noScript.err, /^napkin-sketch: cannot read missing\.napkin: ENOENT/);

    writeFileSync(join(dir, 'logo.napkin'), 'napkin 1\nimage "logo" at 10 10 size 20\n');
    const noAsset = await run(dir, ['draw', 'logo.napkin', '--asset', 'logo=nope.png', '--json']);
    const report = JSON.parse(noAsset.out);
    assert.deepEqual([noAsset.code, report.error.kind], [EXIT.io, 'io']);
    assert.match(report.error.message, /^asset "logo" could not be read from .*nope\.png/);

    writeFileSync(join(dir, 'blocked'), 'a file where a folder should be');
    const noOut = await run(dir, ['draw', '-', '--out', 'blocked/out'], CARD);
    assert.equal(noOut.code, EXIT.io, 'an output folder that cannot be made');

    writeFileSync(join(dir, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>');
    const script = 'napkin 1\npage 100 100\nlink "../secret.svg" at 10 10 size 40 40\n';
    writeFileSync(join(dir, 'art.napkin'), script);
    const escaping = await run(join(dir), ['draw', 'art.napkin', '--base', 'nowhere', '--to', 'png']);
    assert.equal(escaping.code, EXIT.io, 'a link that cannot be read inside --base');
    assert.equal(escaping.out, 'art.png\n', 'and the drawing is written, with the placeholder');
    assert.match(escaping.err, /napkin-sketch: a linked file could not be read inside nowhere: \.\.\/secret\.svg; it was drawn as its placeholder\n$/);
  });
});

test('check reads and runs a script, writes nothing, and says what it found', async () => {
  await inFolder(async (dir) => {
    writeFileSync(join(dir, 'card.napkin'), CARD);
    const clean = await run(dir, ['check', 'card.napkin']);
    assert.deepEqual([clean.code, clean.out, clean.err], [EXIT.ok, '', 'card.napkin: no problems\n']);
    const broken = await run(dir, ['check', '-'], BROKEN);
    assert.equal(broken.code, EXIT.script);
    assert.match(broken.err, /<stdin>: 1 error, 0 warnings\n$/);
    const warned = await run(dir, ['check', '-'], 'circle 50 50 20\n');
    assert.equal(warned.code, EXIT.ok, 'a warning alone is not a failure');
    assert.equal((await run(dir, ['check', '-', '--strict'], 'circle 50 50 20\n')).code, EXIT.script, 'unless --strict');
    const json = JSON.parse((await run(dir, ['check', '-', '--json'], CARD)).out);
    assert.deepEqual([json.ok, json.files, json.stats.marks], [true, [], 1]);

    writeFileSync(join(dir, 'logo.png'), readFileSync(join(repoRoot(), 'assets', 'icon.png')));
    const image = 'napkin 1\nimage "logo" at 10 10 size 20\n';
    assert.equal((await run(dir, ['check', '-'], image)).code, EXIT.script, 'an image the host did not hand over');
    assert.equal((await run(dir, ['check', '-', '--asset', 'logo=logo.png'], image)).code, EXIT.ok, 'and one it did');
    assert.deepEqual(readdirSync(dir).sort(), ['card.napkin', 'logo.png'], 'nothing was written');
  });
});

test('render --animate writes the figure through a measured cycle: a file a frame, one box, the script in the report', async () => {
  await inFolder(async (dir) => {
    const figure = walkFigure();
    const book = { format: 'napkin-sketch' as const, version: 3, name: 'walk', sketches: [figure], createdAt: figure.createdAt, updatedAt: figure.updatedAt };
    writeFileSync(join(dir, 'walk.skbk'), serializeSketchBook(book));
    const json = JSON.parse((await run(dir, ['render', 'walk.skbk', '--animate', 'walk', '--to', 'svg', '--json'])).out);
    assert.deepEqual([json.ok, json.exitCode, json.diagnostics], [true, EXIT.ok, []]);
    assert.deepEqual(
      json.files.map((file: { path: string }) => file.path),
      Array.from({ length: 8 }, (_, i) => `walk-walk-${i + 1}.svg`),
      'named after the book and the animation, a file a frame',
    );
    assert.match(json.script.text, /^napkin 1\npage 44 141\nname "walk_1"\n/);
    assert.equal(json.script.path, undefined, 'the script copies the page in, so it is not kept on its own');
    const views = json.files.map((file: { path: string }) => /viewBox="([^"]+)"/.exec(readFileSync(join(dir, file.path), 'utf8'))?.[1]);
    assert.equal(new Set(views).size, 1, 'every frame is cut to one box');
    const four = await run(dir, ['render', 'walk.skbk', '--animate', 'walk', '--frames', '4', '--facing', 'left', '--name', 'hero', '--to', 'svg,pdf']);
    assert.deepEqual([four.code, four.out], [EXIT.ok, 'hero-1.svg\nhero-2.svg\nhero-3.svg\nhero-4.svg\nhero.pdf\n']);
    // A page with no figure on it is the book's problem, not the arguments'.
    writeFileSync(join(dir, 'card.skbk'), serializeSketchBook(evaluate('napkin 1\npage 100 100\ncircle 50 50 20\n', { name: 'card' }).book));
    const card = JSON.parse((await run(dir, ['render', 'card.skbk', '--animate', 'walk', '--json'])).out);
    assert.deepEqual([card.exitCode, card.error.kind], [EXIT.script, 'input']);
    assert.match(card.error.message, /^card\.skbk: page "card" has none of the assemblies a character animation turns/);
  });
});

test('render --help names every animation with a measured cycle', () => {
  for (const type of MEASURED_ANIMATION_TYPES) assert.ok(COMMAND_HELP.render.includes(type), type);
});

test('render writes a book, one page of it, or says what is wrong with it', async () => {
  await inFolder(async (dir) => {
    const book = evaluate('napkin 1\npage 100 100\ncircle 50 50 20\nnewpage\nrect 20 20 60 60\n', { name: 'deck' }).book;
    writeFileSync(join(dir, 'deck.skbk'), serializeSketchBook(book));
    const all = await run(dir, ['render', 'deck.skbk', '--to', 'png,pdf']);
    assert.deepEqual([all.code, all.out], [EXIT.ok, 'deck-1.png\ndeck-2.png\ndeck.pdf\n']);
    const second = await run(dir, ['render', 'deck', '--page', '2', '--to', 'png', '--out', 'one']);
    assert.deepEqual([second.code, second.out], [EXIT.ok, `${join('one', 'deck-2.png')}\n`], 'the .skbk may be left off, and a page keeps its number');
    const past = await run(dir, ['render', 'deck.skbk', '--page', '3']);
    assert.deepEqual([past.code, past.err.split('\n')[0]], [EXIT.usage, 'napkin-sketch: deck.skbk has 2 pages; there is no page 3']);
    assert.equal((await run(dir, ['render', 'nope.skbk'])).code, EXIT.io);
    writeFileSync(join(dir, 'bad.skbk'), 'not a book');
    const bad = JSON.parse((await run(dir, ['render', 'bad.skbk', '--json'])).out);
    assert.deepEqual([bad.exitCode, bad.error.kind], [EXIT.script, 'input']);
  });
});

test('verbs lists the language by category, with the shape library, and as JSON', async () => {
  await inFolder(async (dir) => {
    const listed = await run(dir, ['verbs']);
    assert.equal(listed.code, EXIT.ok);
    assert.ok(listed.out.startsWith(`napkin script 1: ${VERBS.length} verbs\n`));
    assert.match(listed.out, /\n  rect <x> <y> <width> <height> \[r <radius>\]\n      /);
    assert.match(listed.out, /The shape library, for shape "<name>": \d+ shapes/);
    for (const category of VERB_CATEGORIES) assert.match(listed.out, new RegExp(`\n${category.title}: `));
    const json = JSON.parse((await run(dir, ['verbs', '--json'])).out);
    assert.deepEqual(
      [json.verbs.length, json.categories.length, json.shapes, json.diagnostics.length],
      [VERBS.length, VERB_CATEGORIES.length, [...SHAPE_NAMES], DIAGNOSTICS.length],
    );
    const shapes = JSON.parse((await run(dir, ['verbs', '--category', 'shapes', '--json'])).out);
    assert.ok(shapes.verbs.every((verb: { category: string }) => verb.category === 'shapes'));
    assert.equal(shapes.shapes.length, SHAPE_NAMES.length);
    const nope = await run(dir, ['verbs', '--category', 'nope']);
    assert.equal(nope.code, EXIT.usage);
    assert.match(nope.err, /there is no category "nope"; the categories are document, layers/);
    const help = await run(dir, ['draw', '--help']);
    assert.deepEqual([help.code, help.out.split('\n')[0]], [EXIT.ok, 'napkin-sketch draw <script | -> [options]']);
  });
});

test(
  'the built CLI draws from standard input as a process, with no Electron to load',
  { skip: cliSkipReason() ?? false },
  async () => {
    await inFolder(async (dir) => {
      // The install the GUI cannot start on: any reach for electron throws.
      writeFileSync(
        join(dir, 'no-electron.cjs'),
        [
          "const Module = require('module');",
          'const load = Module._load;',
          'Module._load = function (request, ...rest) {',
          "  if (request === 'electron') throw new Error('electron is not installed');",
          '  return load.call(this, request, ...rest);',
          '};',
        ].join('\n'),
      );
      const child = spawnSync(process.execPath, ['-r', join(dir, 'no-electron.cjs'), CLI, 'draw', '-', '--json', '--to', 'svg,png', '--out', join(dir, 'out')], {
        input: CARD,
        encoding: 'utf8',
        cwd: dir,
      });
      assert.equal(child.status, EXIT.ok, child.stderr);
      assert.equal(child.stderr, '');
      const report = JSON.parse(child.stdout);
      assert.deepEqual(
        report.files.map((file: { path: string }) => file.path),
        [join(dir, 'out', 'card.svg'), join(dir, 'out', 'card.png')],
        'an absolute --out gives absolute paths',
      );
      assert.equal(report.version, JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8')).version);
      const version = spawnSync(process.execPath, [CLI, 'draw', 'missing.napkin'], { encoding: 'utf8', cwd: dir });
      assert.equal(version.status, EXIT.io, 'the exit code reaches the shell');
    });
  },
);
