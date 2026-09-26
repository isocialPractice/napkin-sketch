#!/usr/bin/env node
/**
 * Writes src/core/script/shape-library.json, the shapes `shape "<name>"`
 * draws, from the vector-graphics skill's SVG assets.
 *
 *   npm run shape-library              # rewrite the library
 *   npm run shape-library -- --check   # exit 1 when the committed file is stale
 *
 * The reader is src/core/script/library-build.ts, bundled here with esbuild.
 * It needs no DOM, so it runs in Node rather than an Electron window, and it
 * builds each shape with the SVG importer's own element and path code. Run it
 * again whenever one of the assets changes: the test suite fails until the
 * committed file matches them.
 */

import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'dist-test', 'shape-library.bundle.mjs');
const outPath = join(root, 'src', 'core', 'script', 'shape-library.json');

await build({
  entryPoints: [join(root, 'src', 'core', 'script', 'library-build.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'error',
});

const { LIBRARY_ASSETS, LIBRARY_ASSET_DIR, buildShapeLibrary, formatShapeLibrary } = await import(
  pathToFileURL(bundlePath).href
);
const sources = await Promise.all(
  LIBRARY_ASSETS.map(async (file) => ({ file, text: await readFile(join(root, LIBRARY_ASSET_DIR, file), 'utf8') })),
);
const library = buildShapeLibrary(sources);
const text = formatShapeLibrary(library);

if (process.argv.includes('--check')) {
  const current = await readFile(outPath, 'utf8').catch(() => '');
  if (current.replace(/\r\n/g, '\n') !== text) {
    console.error('src/core/script/shape-library.json does not match the assets. Run `npm run shape-library`.');
    process.exit(1);
  }
  console.log(`shape-library.json matches the assets (${library.shapes.length} shapes).`);
} else {
  await writeFile(outPath, text);
  console.log(`Wrote ${library.shapes.length} shapes to src/core/script/shape-library.json:`);
  console.log(library.shapes.map((shape) => shape.name).join(', '));
}
