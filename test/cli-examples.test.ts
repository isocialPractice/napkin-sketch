/**
 * The command-line callers in `docs/api/cli/examples/`, run as a reader would
 * run them: each in a copy of the folder, with a `napkin-sketch` on the PATH
 * that runs the built CLI, as `npm install -g` would put one there. Each runs
 * where its shell, interpreter or compiler is installed, and is skipped,
 * saying so, where it is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { CLI, cliSkipReason } from './helpers/built-cli.js';
import { repoRoot } from './helpers/repo-root.js';

const EXAMPLES = join(repoRoot(), 'docs', 'api', 'cli', 'examples');
const WINDOWS = process.platform === 'win32';
const STALE = cliSkipReason();

/** The first of `names` on the PATH that runs, or null. */
function tool(names: string[], probe: string[] = ['--version']): string | null {
  const extensions = WINDOWS ? ['.exe', '.cmd', ''] : [''];
  for (const name of names) {
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const extension of extensions) {
        const path = join(dir, `${name}${extension}`);
        if (existsSync(path) && spawnSync(path, probe, { encoding: 'utf8' }).status === 0) return path;
      }
    }
  }
  return null;
}

/** Why a caller cannot run here, or false when it can. */
function skip(missing: string | null, what: string): string | false {
  if (STALE) return STALE;
  return missing ? false : `${what} is not installed here`;
}

/** A copy of the examples folder, and a PATH whose `napkin-sketch` is the built CLI. */
function workspace(): { dir: string; env: NodeJS.ProcessEnv; done(): void } {
  const root = mkdtempSync(join(tmpdir(), 'napkin-examples-'));
  const dir = join(root, 'examples');
  cpSync(EXAMPLES, dir, { recursive: true });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const node = process.execPath;
  writeFileSync(join(bin, 'napkin-sketch'), `#!/bin/sh\nexec "${node.replace(/\\/g, '/')}" "${CLI.replace(/\\/g, '/')}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'napkin-sketch.cmd'), `@"${node}" "${CLI}" %*\r\n`);
  const env = { ...process.env };
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  env[key] = `${bin}${delimiter}${env[key] ?? ''}`;
  // Windows can hold a program the C example compiled for a moment after it
  // exits, so taking the folder away is retried rather than failing the test.
  return { dir, env, done: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

/** Asserts a caller ran cleanly and wrote the files named. */
function wrote(result: ReturnType<typeof spawnSync>, dir: string, files: string[]): void {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const file of files) assert.ok(existsSync(join(dir, 'out', file)), `out/${file} was written`);
}

const SH = tool(['sh', 'bash'], ['-c', 'exit 0']);
test('draw.sh, through sh', { skip: skip(SH, 'sh') }, () => {
  const w = workspace();
  try {
    const result = spawnSync(SH!, ['draw.sh'], { cwd: w.dir, env: w.env, encoding: 'utf8' });
    wrote(result, w.dir, ['card.svg', 'card.png', 'piped.svg']);
    assert.match(result.stdout, /(^|\n)drew out\/card\.svg and out\/card\.png\n/, 'after the files draw lists');
    assert.equal(JSON.parse(result.stdout.trim().split('\n').pop()!).ok, true, 'the JSON report is the last line');
  } finally {
    w.done();
  }
});

test('draw.bat, through cmd', { skip: skip(WINDOWS ? 'cmd' : null, 'cmd') }, () => {
  const w = workspace();
  try {
    // By its full path: cmd may be set not to look in the current folder (NoDefaultCurrentDirectoryInExePath).
    const result = spawnSync('cmd.exe', ['/d', '/c', join(w.dir, 'draw.bat')], { cwd: w.dir, env: w.env, encoding: 'utf8' });
    wrote(result, w.dir, ['card.svg', 'card.pdf']);
    assert.match(result.stdout, /Drew out\\card\.svg and out\\card\.pdf\./);
  } finally {
    w.done();
  }
});

test('draw.mjs, through Node', { skip: skip('node', 'node') }, () => {
  const w = workspace();
  try {
    const result = spawnSync(process.execPath, ['draw.mjs'], { cwd: w.dir, env: w.env, encoding: 'utf8' });
    wrote(result, w.dir, ['card.svg', 'card.png']);
    assert.match(result.stdout, /^drew .*card\.svg, .*card\.png\n$/);
  } finally {
    w.done();
  }
});

const PYTHON = tool(['python3', 'python']);
test('draw.py, through Python', { skip: skip(PYTHON, 'Python') }, () => {
  const w = workspace();
  try {
    const result = spawnSync(PYTHON!, ['draw.py'], { cwd: w.dir, env: w.env, encoding: 'utf8' });
    wrote(result, w.dir, ['card.svg', 'card.png']);
    assert.match(result.stdout, /^drew .*card\.svg, .*card\.png/);
  } finally {
    w.done();
  }
});

const CC = tool(['gcc', 'cc', 'clang']);
test('draw.c, compiled and run', { skip: skip(CC, 'a C compiler') }, () => {
  const w = workspace();
  try {
    const program = join(w.dir, WINDOWS ? 'draw.exe' : 'draw');
    const compiled = spawnSync(CC!, ['-Wall', '-o', program, 'draw.c'], { cwd: w.dir, env: w.env, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(compiled.stderr, '', 'it compiles without a warning');
    const result = spawnSync(program, [], { cwd: w.dir, env: w.env, encoding: 'utf8' });
    wrote(result, w.dir, ['card.svg']);
    assert.equal(JSON.parse(result.stdout).ok, true, 'the line it read is the JSON report');
  } finally {
    w.done();
  }
});
