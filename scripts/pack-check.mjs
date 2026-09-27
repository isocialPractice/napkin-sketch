#!/usr/bin/env node
/**
 * Packs the package, installs the tarball into an empty folder the way a user
 * installs it, and draws with it: the check that an install without Electron
 * can still draw, which is what the drawing commands promise.
 *
 *   npm run pack-check            # pack, install, draw, then remove the folder
 *   npm run pack-check -- --keep  # leave the folder, and print where it is
 *
 * It fails when the tarball holds a file it must not - the local Animation
 * Mode install record - or lacks one the entries need, when the install brings
 * Electron with it, or when `napkin-sketch draw -`, `napkin-sketch` or
 * `napkin-sketch/node` does not draw. Run `npm run build` and
 * `npm run build:types` first: it packs what `dist/` holds. It needs no
 * network, since the package has no dependencies to fetch.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

const SCRIPT = 'napkin 1\npage 200 120\nlayer "Card"\ncolor #1f2328 width 3 fill #ffe08a\nrect 10 10 180 100 r 12\n';

/** Files the entries need, which a tarball without them would install broken. */
const REQUIRED = [
  'dist/cli/index.js',
  'dist/api/index.js',
  'dist/api/index.d.ts',
  'dist/node/index.js',
  'dist/api/node.d.ts',
  'docs/api/INDEX.json',
  'API.md',
  'API-CHEATSHEET.md',
];

/** Files that are one machine's state, never the package's. */
const FORBIDDEN = ['ai-helper/installed.json'];

/**
 * Files the package must never hold, by pattern: the documentation site
 * writes its API pages as HTML beside the Markdown in docs/api, which ships,
 * and `package.json` `files` leaves the HTML out.
 */
const FORBIDDEN_PATTERNS = [{ pattern: /^docs\/api\/.*\.html$/, why: 'the documentation site, which the package does not ship' }];

/** Stops the check; the folder is still removed. */
function fail(message) {
  throw new Error(message);
}

/**
 * Runs npm. Under `npm run`, npm names its own script in `npm_execpath`, and
 * running that with Node needs no shell; otherwise npm is found on the PATH,
 * which on Windows is a `.cmd` that only a shell runs.
 */
function npm(args, cwd, env = process.env) {
  const cli = process.env.npm_execpath;
  const result =
    cli && /\.[cm]?js$/.test(cli)
      ? spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf-8' })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
          cwd,
          env,
          encoding: 'utf-8',
          shell: process.platform === 'win32',
        });
  if (result.status !== 0) fail(`npm ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

/** Packs, installs into `dir`, and draws; throws, saying why, at the first thing wrong. */
function check(dir) {
  // 1. Pack, and read what went in.
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', dir], root));
  const paths = new Set(packed.files.map((file) => file.path));
  const missing = REQUIRED.filter((path) => !paths.has(path));
  if (missing.length > 0) fail(`the tarball lacks ${missing.join(', ')}: run npm run build and npm run build:types`);
  const leaked = FORBIDDEN.filter((path) => paths.has(path));
  if (leaked.length > 0) fail(`the tarball holds ${leaked.join(', ')}, which is this machine's state`);
  for (const { pattern, why } of FORBIDDEN_PATTERNS) {
    const found = [...paths].filter((path) => pattern.test(path));
    if (found.length > 0) fail(`the tarball holds ${found.slice(0, 3).join(', ')}${found.length > 3 ? ` and ${found.length - 3} more` : ''}: ${why}`);
  }

  // 2. Install it into an empty project, as a user would, asking the helper
  //    installer for nothing.
  const project = join(dir, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'pack-check', version: '1.0.0', private: true }, null, 2)}\n`);
  const env = { ...process.env };
  delete env.NAPKIN_AI_HELPER;
  npm(['install', join(dir, packed.filename), '--no-audit', '--no-fund', '--no-package-lock'], project, env);
  const installed = join(project, 'node_modules', 'napkin-sketch');
  if (existsSync(join(project, 'node_modules', 'electron'))) fail('the install brought electron with it');
  const bin = join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'napkin-sketch.cmd' : 'napkin-sketch');
  if (!existsSync(bin)) fail(`the install made no ${bin}`);

  // 3. Draw from standard input with the installed command, which must not
  //    need Electron to do it.
  const cli = spawnSync(process.execPath, [join(installed, 'dist', 'cli', 'index.js'), 'draw', '-', '--json', '--out', 'out'], {
    cwd: project,
    input: SCRIPT,
    encoding: 'utf-8',
  });
  let report;
  try {
    report = JSON.parse(cli.stdout);
  } catch {
    fail(`napkin-sketch draw printed no report:\n${cli.stdout}${cli.stderr}`);
  }
  if (cli.status !== 0 || !report.ok) fail(`napkin-sketch draw exited ${cli.status}:\n${cli.stdout}${cli.stderr}`);
  const drawn = join(project, report.files[0].path);
  if (!/<svg[\s>]/.test(readFileSync(drawn, 'utf-8'))) fail(`${drawn} is not an SVG`);

  // 4. Draw with both entries, imported by name.
  writeFileSync(
    join(project, 'check.mjs'),
    [
      "import { drawSvg } from 'napkin-sketch';",
      "import { drawToFiles } from 'napkin-sketch/node';",
      `const script = ${JSON.stringify(SCRIPT)};`,
      'const { ok, svg } = drawSvg(script);',
      "const result = await drawToFiles(script, { out: 'lib-out', formats: ['svg', 'png'] });",
      'console.log(JSON.stringify({ ok: ok && result.ok, svg: svg.length, files: result.files.map((file) => file.path) }));',
      '',
    ].join('\n'),
  );
  const lib = spawnSync(process.execPath, ['check.mjs'], { cwd: project, encoding: 'utf-8' });
  if (lib.status !== 0) fail(`importing the package failed:\n${lib.stderr}`);
  const library = JSON.parse(lib.stdout);
  if (!library.ok || library.svg === 0 || library.files.length !== 2) fail(`the entries did not draw: ${lib.stdout}`);

  console.log(
    `pack-check: ${packed.filename} (${packed.entryCount} files) installs with no electron, and draws: ` +
      `${report.files[0].path} from the command line, ${library.files.join(' and ')} from the entries.`,
  );
}

const dir = mkdtempSync(join(tmpdir(), 'napkin-pack-check-'));
try {
  check(dir);
} catch (err) {
  console.error(`pack-check: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (keep) console.log(`pack-check: kept ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
