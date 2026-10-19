/**
 * `napkin-sketch vendor`: parts of the package copied into a project, pinned by
 * version and hash, and checked with nothing installed.
 *
 * The copying tests run the command against the built `dist/`, the files a
 * vendored copy is made of, so they are skipped, saying why, when the build is
 * missing or older than the source - as the command line's own tests are.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseCommand } from '../src/cli/args.js';
import { EXIT, runCommand } from '../src/cli/draw.js';
import { CHECK_NAME, RECORD_NAME, cutNotices, partName, type PartsRecord, type VendorRecord } from '../src/cli/vendor.js';
import { builtSkipReason } from './helpers/built-cli.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();
const DIST = join(ROOT, 'dist');
const skip = builtSkipReason('dist/parts.json');

interface Run {
  code: number;
  out: string;
  err: string;
}

/** Runs `vendor` in `cwd` against the built package, catching what it prints. */
async function run(cwd: string, argv: string[]): Promise<Run> {
  let out = '';
  let err = '';
  const code = await runCommand({
    argv: ['vendor', ...argv],
    stdin: '',
    stdout: { write: (text: string) => (out += text) },
    stderr: { write: (text: string) => (err += text) },
    cwd,
    version: '9.9.9',
    dist: DIST,
  });
  return { code, out, err };
}

/** Runs `body` in a fresh temporary folder, removed afterwards whatever happens. */
async function inFolder(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-vendor-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const parts = (): PartsRecord => JSON.parse(readFileSync(join(DIST, 'parts.json'), 'utf8'));
const record = (dir: string): VendorRecord => JSON.parse(readFileSync(join(dir, RECORD_NAME), 'utf8'));

test('vendor does one thing at a time: copy parts into a folder, check a folder, or list the parts', () => {
  const errors = (argv: string[]): string[] => parseCommand('vendor', argv).errors;
  assert.deepEqual(errors(['graphic-design', '--out', 'vendor']), []);
  assert.deepEqual(errors(['--check', 'vendor']), []);
  assert.deepEqual(errors(['--list']), []);
  assert.deepEqual(errors([]), ['vendor needs the parts to copy and --out, --check <dir>, or --list']);
  assert.deepEqual(errors(['graphic-design']), ['vendor needs --out, the folder to copy the parts into']);
  assert.deepEqual(errors(['--out', 'vendor']), ['vendor needs the parts to copy: run "napkin-sketch vendor --list" for them']);
  assert.deepEqual(errors(['--list', '--check', 'vendor']), ['vendor does one thing at a time; not --check a folder and --list']);
  assert.deepEqual(errors(['sharpen', '--out', 'v', '--list']), ['vendor does one thing at a time; not copy parts with --out and --list']);
  assert.deepEqual(errors(['--to', 'svg']), ['vendor does not take --to', 'vendor needs the parts to copy and --out, --check <dir>, or --list']);
  const args = parseCommand('vendor', ['sharpen', 'engines', '--out', 'v', '--types', '--offline']);
  assert.deepEqual([args.parts, args.out, args.types, args.offline], [['sharpen', 'engines'], 'v', true, true]);

  // A part by its name or by its subpath, the way an import names it.
  for (const typed of ['graphic-design', './graphic-design', '@isocialpractice/napkin-sketch/graphic-design']) assert.equal(partName(typed), 'graphic-design');
  for (const typed of ['.', '@isocialpractice/napkin-sketch', 'main']) assert.equal(partName(typed), 'main');
});

test('a vendored folder carries only the notices its files owe, a fenced license whole', () => {
  const text = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  const headings = {
    marked: '### marked 18.0.14',
    'highlight.js': '### highlight.js 11.12.0',
    hyphenation: '### The en-US hyphenation patterns',
  };
  const all = cutNotices(text, ['marked', 'highlight.js', 'hyphenation'], headings, '@isocialpractice/napkin-sketch', '9.9.9');
  assert.deepEqual(all.split('\n').filter((line) => line.startsWith('### ')), Object.values(headings));
  // marked's license, reproduced in a fence, keeps its own headings.
  assert.match(all, /^## Contribution License Agreement$/m);
  assert.doesNotMatch(all, /marked-highlight|In the repository only|test fonts/i);
  const none = cutNotices(text, [], headings, '@isocialpractice/napkin-sketch', '9.9.9');
  assert.match(none, /bundle no third-party code/);
  assert.doesNotMatch(none, /^### /m);
});

test('vendor --list names every part, where it runs, and what it costs a page', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    const listed = await run(dir, ['--list', '--json']);
    assert.equal(listed.code, EXIT.ok, listed.err);
    const report = JSON.parse(listed.out) as { list: Array<{ name: string; platform: string; gzipped: number; files: number }> };
    assert.deepEqual(report.list.map((part) => part.name).sort(), Object.keys(parts().parts).sort());
    const by = Object.fromEntries(report.list.map((part) => [part.name, part]));
    assert.ok(by.sharpen.gzipped < by['graphic-design'].gzipped && by['graphic-design'].gzipped < by.main.gzipped, 'sharpening weighs least, the main entry most');
    assert.equal(by['graphic-design/files'].platform, 'node');

    const table = await run(dir, ['--list']);
    assert.match(table.out, /^ {2}sharpen +browser/m);
  });
});

test('vendor copies a part as files that load, with a record, its notices and a check', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    const copied = await run(dir, ['graphic-design', '--out', 'vendor/napkin-sketch']);
    assert.equal(copied.code, EXIT.ok, copied.err);
    assert.match(copied.out, /check it with: node vendor\/napkin-sketch\/VENDOR-CHECK\.mjs/);
    const out = join(dir, 'vendor', 'napkin-sketch');

    const vendored = record(out);
    const part = parts().parts['graphic-design'];
    assert.deepEqual(Object.keys(vendored.files).sort(), [...part.files, 'LICENSE', 'THIRD-PARTY-NOTICES.md', CHECK_NAME].sort());
    assert.deepEqual(vendored.entries, { 'graphic-design': 'graphic-design/index.js' });
    assert.equal(vendored.source, 'clone', "a clone's build is not the registry's tarball");
    assert.equal(vendored.tarball, undefined);
    assert.equal(vendored.version, parts().version);
    assert.deepEqual(vendored.notices, []);
    for (const file of part.files) {
      assert.deepEqual(readFileSync(join(out, file)), readFileSync(join(DIST, file)), `${file} is copied byte for byte`);
    }

    // It loads from where it was put, with nothing installed.
    const api = await import(pathToFileURL(join(out, 'graphic-design', 'index.js')).href);
    const card = api.createComposition({ width: 20, height: 10, background: '#ffffff' });
    card.rect({ x: 2, y: 2, width: 8, height: 6, fill: '#4cae50' });
    assert.equal(api.isPng(card.toPNG()), true);

    // Both checks pass on the copy as written.
    assert.equal((await run(dir, ['--check', 'vendor/napkin-sketch'])).code, EXIT.ok);
    assert.match(execFileSync(process.execPath, [join(out, CHECK_NAME)], { encoding: 'utf8' }), /files match VENDOR\.json/);
  });
});

test('vendor --check and VENDOR-CHECK.mjs fail on a file that differs, is missing, or was added', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    assert.equal((await run(dir, ['sharpen', '--out', 'v'])).code, EXIT.ok);
    const out = join(dir, 'v');
    appendFileSync(join(out, 'sharpen', 'index.js'), '\n// edited by hand\n');
    rmSync(join(out, 'LICENSE'));
    writeFileSync(join(out, 'notes.txt'), 'mine');

    const checked = await run(dir, ['--check', 'v', '--json']);
    assert.equal(checked.code, EXIT.drift);
    assert.deepEqual(JSON.parse(checked.out).drift, { differs: ['sharpen/index.js'], missing: ['LICENSE'], added: ['notes.txt'] });

    const script = spawnSync(process.execPath, [join(out, CHECK_NAME)], { encoding: 'utf8' });
    assert.equal(script.status, 1);
    for (const line of ['differs: sharpen/index.js', 'missing: LICENSE', 'added: notes.txt']) assert.ok(script.stderr.includes(line), `the script names "${line}"`);
  });
});

test('vendoring again refreshes the folder; a folder vendor did not write is refused', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    assert.equal((await run(dir, ['graphic-design', '--out', 'v'])).code, EXIT.ok);
    const refreshed = await run(dir, ['sharpen', '--out', 'v', '--json']);
    assert.equal(refreshed.code, EXIT.ok, refreshed.err);
    const report = JSON.parse(refreshed.out) as { removed: string[] };
    assert.ok(report.removed.includes('graphic-design/index.js'), 'what the new copy does not hold is removed');
    assert.ok(!existsSync(join(dir, 'v', 'graphic-design')), 'and its emptied folder with it');
    assert.equal((await run(dir, ['--check', 'v'])).code, EXIT.ok);

    mkdirSync(join(dir, 'theirs'));
    writeFileSync(join(dir, 'theirs', 'index.html'), '<!doctype html>');
    const refused = await run(dir, ['sharpen', '--out', 'theirs']);
    assert.equal(refused.code, EXIT.io);
    assert.match(refused.err, /holds files and no VENDOR\.json/);
    assert.equal(readFileSync(join(dir, 'theirs', 'index.html'), 'utf8'), '<!doctype html>', 'and nothing in it is touched');

    const into = await run(dir, ['sharpen', '--out', join(DIST, 'vendored')]);
    assert.equal(into.code, EXIT.io, 'never into the package it copies from');
    assert.equal(existsSync(join(DIST, 'vendored')), false);

    const unknown = await run(dir, ['nope', '--out', 'w']);
    assert.equal(unknown.code, EXIT.usage);
    assert.match(unknown.err, /there is no part "nope"; the parts are main/);
  });
});

test('a Node-only part copied beside a browser part is named as one', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    const mixed = await run(dir, ['graphic-design', 'graphic-design/files', '--out', 'v', '--json']);
    assert.equal(mixed.code, EXIT.ok, mixed.err);
    assert.deepEqual(JSON.parse(mixed.out).warnings, ['graphic-design/files runs in Node only, as it reads files; a page must not load it']);
  });
});

test('vendor --types copies the declarations, and one beside an entry whose types live elsewhere', { skip: skip ?? builtSkipReason('dist/core/engines.d.ts') ?? false }, async () => {
  await inFolder(async (dir) => {
    const copied = await run(dir, ['engines', 'sharpen', '--out', 'v', '--types']);
    assert.equal(copied.code, EXIT.ok, copied.err);
    const out = join(dir, 'v');
    assert.equal(readFileSync(join(out, 'engines', 'index.d.ts'), 'utf8'), "export * from '../core/engines.js';\n");
    assert.ok(existsSync(join(out, 'core', 'engines.d.ts')));
    assert.ok(existsSync(join(out, 'sharpen', 'index.d.ts')), "sharpening's declarations already sit beside its entry");
    assert.equal(record(out).types, true);
    assert.equal((await run(dir, ['--check', 'v'])).code, EXIT.ok);
  });
});
