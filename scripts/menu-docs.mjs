#!/usr/bin/env node
/**
 * Writes the menus table and the shortcut tables of the site's Menus and shortcuts page
 * (docs/site-src/guide/menus-and-shortcuts.md) and CHEATSHEET.md from the menu
 * registry: each menu and what it holds, every command with a shortcut, and the tools with their keys.
 *
 *   npm run menu-docs              # rewrite a table that is out of date
 *   npm run menu-docs -- --check   # exit 1, naming each file, when one is
 *
 * The generator is src/docs/menu-docs.ts, bundled here with esbuild the way
 * scripts/api-docs.mjs bundles its own. The test suite fails until the tables
 * match what it writes, so run this after changing a shortcut in
 * src/core/menu/shortcuts.json or a tool's summary in tool-types.json.
 */

import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'dist-test', 'menu-docs.bundle.mjs');

await build({
  entryPoints: [join(root, 'src', 'docs', 'menu-docs.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'error',
});
const { MENU_DOC_TABLES, fillMenuDocs } = await import(pathToFileURL(bundlePath).href);

const check = process.argv.includes('--check');
const stale = [];
for (const path of [...new Set(MENU_DOC_TABLES.map((table) => table.path))]) {
  const full = join(root, path);
  const current = await readFile(full, 'utf8');
  // The markers' helper writes in the file's own line endings: the cheatsheet is LF, a CRLF page stays CRLF.
  const next = fillMenuDocs(path, current);
  if (next === current) continue;
  stale.push(path);
  if (!check) await writeFile(full, next);
}

if (check) {
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.join(', ')}. Run \`npm run menu-docs\`.`);
    process.exit(1);
  }
  console.log('The menu and shortcut tables are current.');
} else {
  console.log(stale.length > 0 ? `Wrote ${stale.join(', ')}.` : 'The menu and shortcut tables were already current.');
}
