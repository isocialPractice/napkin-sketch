#!/usr/bin/env node
/**
 * Writes src/core/type/accent-languages.json, Clean Language Accents' catalog:
 * every language the installed highlight.js has, by its file's id, with its
 * name, its aliases and whether highlight.js's common set registers it.
 *
 *   npm run accent-languages              # rewrite the catalog when it is out of date
 *   npm run accent-languages -- --check   # exit 1 when it is
 *
 * The core reads the catalog rather than highlight.js, which it never
 * imports; the test suite fails until the catalog is what this writes, so run
 * it after upgrading highlight.js.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = join(root, 'src', 'core', 'type', 'accent-languages.json');

/** The catalog as highlight.js has it now. */
export function accentCatalog() {
  const common = new Set(require('highlight.js/lib/common').listLanguages());
  const hljs = require('highlight.js/lib/core').newInstance();
  const dir = join(root, 'node_modules', 'highlight.js', 'lib', 'languages');
  const ids = readdirSync(dir)
    .filter((file) => file.endsWith('.js') && !file.endsWith('.js.js'))
    .map((file) => file.replace(/\.js$/, ''))
    .sort();
  return ids.map((id) => {
    hljs.registerLanguage(id, require(join(dir, `${id}.js`)));
    const language = hljs.getLanguage(id);
    const aliases = [...new Set((language.aliases ?? []).map((alias) => alias.toLowerCase()))].filter((alias) => alias !== id).sort();
    return { id, name: language.name ?? id, aliases, common: common.has(id) };
  });
}

/** The catalog as the file holds it: a language a line, so a diff reads. */
export function catalogText(catalog) {
  return `[\n${catalog.map((language) => `  ${JSON.stringify(language)}`).join(',\n')}\n]\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = catalogText(accentCatalog());
  const current = await readFile(out, 'utf8').catch(() => '');
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('Out of date: src/core/type/accent-languages.json. Run `npm run accent-languages`.');
      process.exit(1);
    }
    console.log('The accent language catalog is current.');
  } else if (current === next) {
    console.log('The accent language catalog was already current.');
  } else {
    await writeFile(out, next);
    console.log('Wrote src/core/type/accent-languages.json.');
  }
}
