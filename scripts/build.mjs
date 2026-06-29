// Build script for napkin-sketch using esbuild.
// Bundles the CLI, Electron main + preload (Node/CommonJS), and the
// renderer (browser/IIFE), then copies static renderer assets to dist/.

import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const nodeCommon = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  // electron is provided by the runtime, never bundle it.
  external: ['electron'],
};

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  {
    ...nodeCommon,
    entryPoints: [resolve(root, 'src/cli/index.ts')],
    outfile: resolve(root, 'dist/cli/index.js'),
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...nodeCommon,
    entryPoints: [resolve(root, 'src/main/main.ts')],
    outfile: resolve(root, 'dist/main/main.js'),
  },
  {
    ...nodeCommon,
    entryPoints: [resolve(root, 'src/main/preload.ts')],
    outfile: resolve(root, 'dist/main/preload.js'),
  },
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/renderer/renderer.ts')],
    outfile: resolve(root, 'dist/renderer/renderer.js'),
  },
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/renderer/settings.ts')],
    outfile: resolve(root, 'dist/renderer/settings.js'),
  },
  // Embeddable API as an ESM module for bundlers (website / VS Code webview).
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/api/index.ts')],
    outfile: resolve(root, 'dist/api/index.js'),
  },
  // Embeddable API as a global IIFE for <script> tags (WordPress / plain HTML).
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    globalName: 'napkin',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/api/index.ts')],
    outfile: resolve(root, 'dist/embed/napkin-sketch.js'),
  },
];

async function copyStatic() {
  await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
  await cp(resolve(root, 'src/renderer/index.html'), resolve(root, 'dist/renderer/index.html'));
  await cp(resolve(root, 'src/renderer/settings.html'), resolve(root, 'dist/renderer/settings.html'));
  await cp(resolve(root, 'src/renderer/styles.css'), resolve(root, 'dist/renderer/styles.css'));

  // Generate the app icon (pure Node, no native deps) then copy assets.
  await import(pathToFileURL(resolve(root, 'scripts/make-icon.mjs')).href);
  await mkdir(resolve(root, 'dist/assets'), { recursive: true });
  if (existsSync(resolve(root, 'assets/icon.png'))) {
    await cp(resolve(root, 'assets/icon.png'), resolve(root, 'dist/assets/icon.png'));
  }
  if (existsSync(resolve(root, 'assets/icon.svg'))) {
    await cp(resolve(root, 'assets/icon.svg'), resolve(root, 'dist/assets/icon.svg'));
  }
}

async function run() {
  if (existsSync(resolve(root, 'dist'))) {
    await rm(resolve(root, 'dist'), { recursive: true, force: true });
  }

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStatic();
    console.log('napkin-sketch: watching for changes...');
  } else {
    await Promise.all(configs.map((c) => build(c)));
    await copyStatic();
    console.log('napkin-sketch: build complete.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
