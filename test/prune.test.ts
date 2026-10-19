/**
 * `napkin-sketch prune`: a project's install of the package cut to the parts
 * it keeps, the marks recorded in its package.json, and nothing touched that
 * is not an install under node_modules.
 *
 * Each test lays an install out in a temporary project from the built package,
 * the files the package ships, so they are skipped, saying why, when the build
 * is missing or older than the source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseCommand } from '../src/cli/args.js';
import { EXIT, runCommand } from '../src/cli/draw.js';
import { builtSkipReason } from './helpers/built-cli.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();
const skip = builtSkipReason('dist/parts.json');

/** What the package ships, as package.json's files lays it out, less the source maps. */
const SHIPPED = ['dist', 'ai-helper', '.claude-plugin', 'scripts/install-ai-helper.mjs', 'README.md', 'API.md', 'API-QUICKSTART.md', 'API-CHEATSHEET.md', 'docs/api', 'THIRD-PARTY-NOTICES.md', 'LICENSE', 'package.json'];
const LEFT_OUT = /\.map$|^dist\/(?:main|embed)\/|^dist\/renderer\/(?:renderer\.js|settings\.js|[^/]+\.html|accents\/)|^ai-helper\/installed\.json$|^ai-helper\/.*\/assets\/[^/]+\.(?:svg|png|json)$|^docs\/api\/.*\.html$/;

/** A project with the package installed in its node_modules; answers the project and the install. */
function installInto(dir: string, manifest: object = { name: 'demo-app', version: '1.0.0', dependencies: { '@isocialpractice/napkin-sketch': '*' } }): { project: string; installed: string } {
  const project = join(dir, 'demo-app');
  const installed = join(project, 'node_modules', '@isocialpractice', 'napkin-sketch');
  mkdirSync(installed, { recursive: true });
  for (const entry of SHIPPED) {
    cpSync(join(ROOT, entry), join(installed, entry), {
      recursive: true,
      filter: (source) => !LEFT_OUT.test(relative(ROOT, source).split(sep).join('/')),
    });
  }
  writeFileSync(join(project, 'package.json'), `${JSON.stringify(manifest, null, 4)}\n`);
  return { project, installed };
}

/** Every file under `dir`, as POSIX paths from it. */
function filesIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(cwd: string, argv: string[]): Promise<Run> {
  let out = '';
  let err = '';
  const code = await runCommand({
    argv: ['prune', ...argv],
    stdin: '',
    stdout: { write: (text: string) => (out += text) },
    stderr: { write: (text: string) => (err += text) },
    cwd,
    version: '9.9.9',
  });
  return { code, out, err };
}

async function inFolder(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-prune-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('prune takes its marks with --keep, comma-separated, and nothing else', () => {
  const args = parseCommand('prune', ['--keep', 'graphic-design, types', '--keep', 'cli,types', '--apply']);
  assert.deepEqual([args.errors, args.keep, args.apply], [[], ['graphic-design', 'types', 'cli'], true]);
  assert.deepEqual(parseCommand('prune', ['graphic-design']).errors, ['prune takes its parts with --keep; not "graphic-design"']);
  assert.deepEqual(parseCommand('prune', ['--out', 'x']).errors, ['prune does not take --out']);
});

test('prune says what would go, records the marks, and asks for what it does not know', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    const { project, installed } = installInto(dir);
    const before = filesIn(installed);

    const unmarked = await run(project, []);
    assert.equal(unmarked.code, EXIT.usage);
    assert.match(unmarked.err, /nothing is marked to keep in package\.json: run napkin-sketch prune --keep <marks>/);
    const unknown = await run(project, ['--keep', 'nope']);
    assert.equal(unknown.code, EXIT.usage);
    assert.match(unknown.err, /there is no part "nope" to keep; the marks are main, .*types, docs, helpers, cli/);

    const planned = await run(project, ['--keep', './graphic-design,types', '--json']);
    assert.equal(planned.code, EXIT.ok, planned.err);
    const plan = JSON.parse(planned.out);
    assert.deepEqual(plan.keep, ['graphic-design', 'types']);
    assert.ok(plan.unimportable.includes('@isocialpractice/napkin-sketch'), 'the main entry would not import');
    assert.ok(!plan.unimportable.includes('@isocialpractice/napkin-sketch/graphic-design'));
    assert.deepEqual(filesIn(installed), before, 'without --apply, nothing is removed');

    // The marks are the project's, written in its own indentation.
    const manifest = readFileSync(join(project, 'package.json'), 'utf8');
    assert.deepEqual(JSON.parse(manifest).napkinSketch, { keep: ['graphic-design', 'types'] });
    assert.match(manifest, /^ {4}"napkinSketch": \{$/m);

    // --apply reads them back, and removes exactly what the plan said, byte for byte.
    const applied = await run(project, ['--apply', '--json']);
    assert.equal(applied.code, EXIT.ok, applied.err);
    const done = JSON.parse(applied.out);
    assert.deepEqual([done.remove, done.removedBytes], [plan.remove, plan.removedBytes]);
    const after = filesIn(installed);
    assert.deepEqual(after, before.filter((file) => !plan.remove.includes(file)));
    for (const kept of ['package.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md', 'dist/parts.json', 'scripts/install-ai-helper.mjs', 'dist/graphic-design/index.js', 'dist/core/graphic-design/index.d.ts']) {
      assert.ok(after.includes(kept), `${kept} is kept`);
    }
    for (const gone of ['dist/api/index.js', 'dist/cli/index.js', 'docs/api/INDEX.json', 'ai-helper/README.md']) assert.ok(!after.includes(gone), `${gone} goes`);

    // What is kept still works.
    const api = await import(pathToFileURL(join(installed, 'dist', 'graphic-design', 'index.js')).href);
    assert.equal(api.isPng(api.createComposition({ width: 4, height: 4 }).toPNG()), true);
  });
});

test('docs, helpers and cli are kept when marked, and a kept command prunes again', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    const { project, installed } = installInto(dir);
    const applied = await run(project, ['--keep', 'sharpen,docs,helpers,cli', '--apply']);
    assert.equal(applied.code, EXIT.ok, applied.err);
    const after = filesIn(installed);
    assert.ok(after.includes('docs/api/INDEX.json') && after.includes('API.md'));
    assert.ok(after.includes('ai-helper/graphic-designer/.claude-plugin/plugin.json') && after.includes('.claude-plugin/marketplace.json'));
    assert.ok(after.includes('dist/cli/index.js') && after.includes('dist/sharpen/index.js'));
    assert.ok(!after.includes('dist/graphic-design/index.js'));
    assert.ok(!after.some((file) => file.endsWith('.d.ts')), 'no declarations without types');

    // The kept command line runs from the pruned install, and finds nothing more to remove.
    const again = spawnSync(process.execPath, [join(installed, 'dist', 'cli', 'index.js'), 'prune', '--json'], { cwd: project, encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout).remove, []);
  });
});

test('a command that is not kept goes last, and says so', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    const { project } = installInto(dir);
    const planned = await run(project, ['--keep', 'graphic-design', '--json']);
    const plan = JSON.parse(planned.out);
    assert.match(plan.warnings[0], /the napkin-sketch command is not kept, so it goes too/);
    const first = plan.remove.findIndex((file: string) => file.startsWith('dist/cli/'));
    assert.ok(first > 0 && plan.remove.slice(first).every((file: string) => file.startsWith('dist/cli/')), 'the command line is removed after everything else');
  });
});

test('prune touches nothing that is not an install under node_modules', { skip: skip ?? false }, async () => {
  await inFolder(async (dir) => {
    // No install at all.
    mkdirSync(join(dir, 'empty'));
    writeFileSync(join(dir, 'empty', 'package.json'), '{"napkinSketch":{"keep":["sharpen"]}}');
    const none = await run(join(dir, 'empty'), ['--apply']);
    assert.equal(none.code, EXIT.io);
    assert.match(none.err, /has no install of @isocialpractice\/napkin-sketch in node_modules/);

    // An install that is a link to a folder elsewhere: a clone, linked with npm link.
    const { installed } = installInto(join(dir, 'source'));
    const linked = join(dir, 'linked');
    mkdirSync(join(linked, 'node_modules', '@isocialpractice'), { recursive: true });
    symlinkSync(installed.replace(/node_modules[\\/]@isocialpractice[\\/]napkin-sketch$/, 'clone'), join(linked, 'node_modules', '@isocialpractice', 'napkin-sketch'), 'junction');
    cpSync(installed, installed.replace(/node_modules[\\/]@isocialpractice[\\/]napkin-sketch$/, 'clone'), { recursive: true });
    writeFileSync(join(linked, 'package.json'), '{"napkinSketch":{"keep":["sharpen"]}}');
    const clone = installed.replace(/node_modules[\\/]@isocialpractice[\\/]napkin-sketch$/, 'clone');
    const before = filesIn(clone);
    const refused = await run(linked, ['--apply']);
    assert.equal(refused.code, EXIT.io);
    assert.match(refused.err, /which is not an install under node_modules - a clone or a linked folder - and prune never removes from one/);
    assert.deepEqual(filesIn(clone), before, 'and nothing in it is touched');

    // An install with a .git in it is a working tree, wherever it sits.
    const { project: gitted, installed: tree } = installInto(join(dir, 'gitted'));
    mkdirSync(join(tree, '.git'));
    writeFileSync(join(gitted, 'package.json'), '{"napkinSketch":{"keep":["sharpen"]}}');
    assert.equal((await run(gitted, ['--apply'])).code, EXIT.io);
    assert.ok(statSync(join(tree, 'dist', 'api', 'index.js')).isFile());

    // A folder of that name holding another package.
    const { project: other, installed: stranger } = installInto(join(dir, 'other'));
    writeFileSync(join(stranger, 'package.json'), '{"name":"not-napkin"}');
    writeFileSync(join(other, 'package.json'), '{"napkinSketch":{"keep":["sharpen"]}}');
    const wrong = await run(other, ['--apply']);
    assert.equal(wrong.code, EXIT.io);
    assert.match(wrong.err, /holds not-napkin, not @isocialpractice\/napkin-sketch/);
    assert.ok(existsSync(join(stranger, 'dist', 'api', 'index.js')));
  });
});
