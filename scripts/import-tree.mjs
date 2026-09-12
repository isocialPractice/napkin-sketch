#!/usr/bin/env node
/**
 * Prints the layer tree an SVG file would import as.
 *
 * Bundles src/renderer/svg-import.ts, then runs it inside a hidden Electron
 * window (see import-tree-main.cjs) because importSvg needs real browser SVG
 * geometry APIs. Handy for checking how a file's groups, names, and unnamed
 * geometry will land in the Layers panel without opening the GUI.
 *
 *   npm run import-tree -- test/imports/applied_layer_names.svg
 *   node scripts/import-tree.mjs test/imports/common_layer_names.svg
 */
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const bundlePath = resolve(root, 'dist-test', 'svg-import.bundle.js');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-tree.mjs <file.svg>');
  process.exit(1);
}

await build({
  entryPoints: [resolve(root, 'src', 'renderer', 'svg-import.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'SvgImport',
  outfile: bundlePath,
  logLevel: 'error',
});

// The `electron` package's default export is the path to the binary.
const electron = (await import('electron')).default;
const env = { ...process.env };
// Some host environments set this, which would strip Electron's APIs.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  electron,
  [resolve(__dirname, 'import-tree-main.cjs'), bundlePath, resolve(file)],
  {
    // Chromium spams stderr with harmless cache warnings; keep stdout only.
    stdio: ['ignore', 'inherit', 'ignore'],
    env,
  },
);
child.on('close', (code) => process.exit(code ?? 0));
