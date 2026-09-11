/**
 * Test runner for napkin-sketch.
 *
 * The source is type-check-only TypeScript (bundled by esbuild, never emitted
 * by tsc). To run the `node:test` suites we bundle each `test/*.test.ts` into
 * CommonJS in `dist-test/`, then hand the folder to Node's built-in runner.
 */

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { readdir, rm, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'dist-test');

async function run() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const testDir = resolve(root, 'test');
  const entries = (await readdir(testDir))
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => resolve(testDir, f));

  if (entries.length === 0) {
    console.error('No test files found in test/.');
    process.exit(1);
  }

  await build({
    entryPoints: entries,
    outdir: outDir,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: 'inline',
    logLevel: 'warning',
    // electron is required lazily inside the CLI and never executed in tests.
    external: ['electron'],
  });

  const outFiles = entries.map((e) =>
    resolve(outDir, e.replace(/\.ts$/, '.js').split(/[\\/]/).pop()),
  );

  // `node --test` takes file paths and nothing else, so suite flags travel as
  // environment variables. `--keep-graphics` stops the graphic-design suite
  // deleting the SVGs and PNGs it draws, which is the only way to look at them.
  const env = { ...process.env };
  if (process.argv.slice(2).includes('--keep-graphics')) {
    env.NAPKIN_KEEP_TEST_GRAPHICS = '1';
  }

  const child = spawn(process.execPath, ['--test', ...outFiles], { stdio: 'inherit', env });
  child.on('close', (code) => process.exit(code ?? 0));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
