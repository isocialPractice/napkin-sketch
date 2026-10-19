/**
 * Finds the napkin-sketch graphic-design API for the helper's scripts: the
 * analyzer, the brand resolver, and the script every generated skill runs,
 * which carries a copy of this file beside it. One order, so all of them run
 * in the same places:
 *
 * 1. `NAPKIN_SKETCH_API`, a path to an entry file, when it is set. A path that
 *    does not load is an error, since it was named on purpose.
 * 2. The package, resolved from this file as a dependency is:
 *    `@isocialpractice/napkin-sketch/graphic-design`, then the main entry,
 *    then the same under `napkin-sketch`, the name a clone linked before 1.0.0
 *    still answers to.
 * 3. A vendored copy: the nearest `VENDOR.json` above this file, or above the
 *    working folder, that holds the graphic-design part or the main one. That
 *    is where `napkin-sketch vendor --helper` puts a helper beside a part, so
 *    the pair needs nothing configured.
 * 4. A clone's build output, `dist/graphic-design/index.js` or
 *    `dist/api/index.js`, above this file.
 *
 * The package comes before a vendored copy, so a project holding both runs
 * the one it installed. Every route gives the graphic-design API, the same
 * calls wherever it was found.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The package names tried, in order: the published one, then the one a linked clone may still go by. */
export const API_SPECIFIERS = [
  '@isocialpractice/napkin-sketch/graphic-design',
  '@isocialpractice/napkin-sketch',
  'napkin-sketch/graphic-design',
  'napkin-sketch',
];

/** The parts of a vendored copy that carry the API, the lighter first. */
const VENDORED_PARTS = ['graphic-design', 'main'];

/** What a person is told when there is no API anywhere. */
export const API_NOT_FOUND =
  'graphic-design API not found. Install @isocialpractice/napkin-sketch, vendor its graphic-design part with `napkin-sketch vendor`, set NAPKIN_SKETCH_API to an entry file, or run `npm run build` in a napkin-sketch clone.';

/** `dir` and the folders above it, nearest first. */
function ancestors(dir, limit = 12) {
  const found = [];
  let current = resolve(dir);
  for (let i = 0; i < limit; i++) {
    found.push(current);
    const up = dirname(current);
    if (up === current) break;
    current = up;
  }
  return found;
}

/** The entry of the nearest vendored copy above `dir` that holds the API, or null. */
export function findVendoredApi(dir) {
  for (const folder of ancestors(dir)) {
    const record = join(folder, 'VENDOR.json');
    if (!existsSync(record)) continue;
    let entries;
    try {
      entries = JSON.parse(readFileSync(record, 'utf8')).entries ?? {};
    } catch {
      continue;
    }
    for (const part of VENDORED_PARTS) {
      const entry = entries[part] ? join(folder, ...entries[part].split('/')) : null;
      if (entry && existsSync(entry)) return entry;
    }
  }
  return null;
}

/** The API entry of the nearest clone's build above `dir`, or null. */
export function findBuiltApi(dir) {
  for (const folder of ancestors(dir)) {
    for (const entry of [join(folder, 'dist', 'graphic-design', 'index.js'), join(folder, 'dist', 'api', 'index.js')]) {
      if (existsSync(entry)) return entry;
    }
  }
  return null;
}

/**
 * The graphic-design API, found in the order above, or null when it is
 * nowhere. `from` is the file the search starts above: this one, unless a
 * caller says otherwise.
 */
export async function findGraphicApi({ from = fileURLToPath(import.meta.url), cwd = process.cwd(), env = process.env } = {}) {
  if (env.NAPKIN_SKETCH_API) {
    const entry = resolve(cwd, env.NAPKIN_SKETCH_API);
    if (!existsSync(entry)) throw new Error(`NAPKIN_SKETCH_API names ${entry}, which does not exist`);
    return import(pathToFileURL(entry).href);
  }
  for (const specifier of API_SPECIFIERS) {
    try {
      return await import(specifier);
    } catch {
      // Not installed under this name.
    }
  }
  const located = findVendoredApi(dirname(from)) ?? findVendoredApi(cwd) ?? findBuiltApi(dirname(from));
  return located ? import(pathToFileURL(located).href) : null;
}
