#!/usr/bin/env node
/**
 * Writes the documentation site under docs/: every page as static HTML, the
 * generated blocks in the site's own Markdown sources (docs/site-src/), and
 * the files it publishes as copies.
 *
 *   npm run site              # rewrite whatever is out of date
 *   npm run site -- --check   # exit 1, naming each file, when anything is
 *
 * The generator is src/docs/site.ts, bundled here with esbuild, the way
 * scripts/api-docs.mjs bundles its own. The test suite fails until the files
 * in the tree match what it makes, so run this after changing any page's
 * Markdown - the README's old sections live in docs/site-src/ now - or the
 * API pages, which `npm run api-docs` rewrites.
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'dist-test', 'site.bundle.mjs');

await build({
  entryPoints: [join(root, 'src', 'docs', 'site.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'error',
});
const { buildSite, SITE_STATIC, SITE_DIR } = await import(pathToFileURL(bundlePath).href);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const reader = {
  read(path) {
    const full = join(root, ...path.split('/'));
    return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  },
  isFolder(path) {
    const full = join(root, ...path.split('/'));
    return existsSync(full) && statSync(full).isDirectory();
  },
};
const license = reader.read('LICENSE') ?? undefined;
const files = buildSite(reader, { version: pkg.version, description: pkg.description, scripts: pkg.scripts, license });

const check = process.argv.includes('--check');
const stale = [];
for (const file of files) {
  const full = join(root, ...file.path.split('/'));
  const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
  // A file keeps the line ends it has.
  const text = current !== null && current.includes('\r\n') ? file.text.replace(/\n/g, '\r\n') : file.text;
  if (current === text) continue;
  stale.push(file.path);
  if (!check) {
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
}
const missing = SITE_STATIC.filter((path) => !existsSync(join(root, SITE_DIR, ...path.split('/'))));

if (check) {
  const problems = [];
  if (stale.length > 0) problems.push(`Out of date: ${stale.join(', ')}. Run \`npm run site\`.`);
  if (missing.length > 0) problems.push(`Missing from ${SITE_DIR}/: ${missing.join(', ')}.`);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`The site is current: ${files.length} files.`);
} else {
  console.log(stale.length > 0 ? `Wrote ${stale.length} ${stale.length === 1 ? 'file' : 'files'}.` : 'The site was already current.');
  if (missing.length > 0) console.warn(`Missing from ${SITE_DIR}/: ${missing.join(', ')}.`);
}
