// Build script for napkin-sketch using esbuild.
// Bundles the CLI, Electron main + preload (Node/CommonJS), and the
// renderer (browser/IIFE), then copies static renderer assets to dist/.

import { build, context } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  // The Node-only file helpers, as their own ESM module.
  //
  // `writeComposition` and `imageDataUrl` import `node:fs`, so they cannot join
  // the browser bundle above - and a documented import has to be a real one, so
  // they are built here rather than left as source only a clone could reach.
  {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/core/graphic-design/files.ts')],
    outfile: resolve(root, 'dist/graphic-design/files.js'),
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
  // Renderer artwork lives beside the source it belongs to. The stylesheet
  // reaches it as ../assets from dist/renderer, so the whole folder is copied
  // rather than named file by file - a new cursor or glyph then needs no
  // build change to ship.
  if (existsSync(resolve(root, 'src/assets'))) {
    await cp(resolve(root, 'src/assets'), resolve(root, 'dist/assets'), { recursive: true });
  }

  // `dist/api/index.js` is ESM, but the package is `"type": "commonjs"`, so
  // Node reads a bare `.js` there as CommonJS and refuses to import it. A
  // one-key package.json beside the bundle scopes that folder to ESM, which is
  // what makes `import('napkin-sketch')` work from a plain Node script - the
  // graphic-designer helper's media analysis is one such script.
  await mkdir(resolve(root, 'dist/api'), { recursive: true });
  await writeFile(resolve(root, 'dist/api/package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf-8');

  // Same reason, for the Node-only file helpers beside it.
  await mkdir(resolve(root, 'dist/graphic-design'), { recursive: true });
  await writeFile(
    resolve(root, 'dist/graphic-design/package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
    'utf-8',
  );
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
