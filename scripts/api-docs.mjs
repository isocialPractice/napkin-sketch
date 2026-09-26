#!/usr/bin/env node
/**
 * Writes the generated parts of the API documentation: the tables made from
 * the verb table and the command line's own tables, the object form's JSON
 * Schema, and docs/api/INDEX.json.
 *
 *   npm run api-docs              # rewrite whatever is out of date
 *   npm run api-docs -- --check   # exit 1, naming each file, when anything is
 *
 * The generator is src/docs/api-docs.ts, bundled here with esbuild, the way
 * scripts/shape-library.mjs bundles the library reader. The test suite fails
 * until the files in the tree match what it makes, so run this after changing
 * the verb table, the command line's flags, or any page.
 */

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'dist-test', 'api-docs.bundle.mjs');

await build({
  entryPoints: [join(root, 'src', 'docs', 'api-docs.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'error',
});
const { HUB_PAGES, generateDocs } = await import(pathToFileURL(bundlePath).href);

/** Every Markdown page under a folder, as paths from the repository root. */
async function pagesUnder(dir) {
  const found = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await pagesUnder(path)));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

const paths = [...HUB_PAGES.filter((page) => existsSync(join(root, page))), ...(await pagesUnder('docs/api'))];
const pages = await Promise.all(
  paths.map(async (path) => ({ path, text: (await readFile(join(root, path), 'utf8')).replace(/\r\n/g, '\n') })),
);

const check = process.argv.includes('--check');
const stale = [];
for (const file of generateDocs(pages)) {
  const full = join(root, ...file.path.split('/'));
  const current = existsSync(full) ? await readFile(full, 'utf8') : null;
  // A file keeps the line ends it has: README-style pages at the root are CRLF.
  const text = current !== null && current.includes('\r\n') ? file.text.replace(/\n/g, '\r\n') : file.text;
  if (current === text) continue;
  stale.push(relative(root, full).split(sep).join('/'));
  if (!check) {
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
}

if (check) {
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.join(', ')}. Run \`npm run api-docs\`.`);
    process.exit(1);
  }
  console.log('The generated documentation is current.');
} else {
  console.log(stale.length > 0 ? `Wrote ${stale.join(', ')}.` : 'The generated documentation was already current.');
}
