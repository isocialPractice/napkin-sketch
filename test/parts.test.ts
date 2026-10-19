/**
 * `dist/parts.json`: the record of every entry in the package's exports map as
 * a part a program can take alone, which `napkin-sketch vendor` copies by.
 *
 * The build writes it from esbuild's metafile. These tests read the built
 * record against the built files, so they are skipped, saying why, when the
 * build is missing or older than the source - as the command line's are.
 * `pack-check` holds the same record to the packed tarball.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { builtSkipReason } from './helpers/built-cli.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();
const skip = builtSkipReason('dist/parts.json');

interface Part {
  subpath: string;
  entry: string;
  types: string | null;
  platform: 'browser' | 'node';
  files: string[];
  bytes: number;
  notices: string[];
}

interface Record {
  name: string;
  version: string;
  notices: { [id: string]: string };
  parts: { [name: string]: Part };
}

const read = (): Record => JSON.parse(readFileSync(join(ROOT, 'dist', 'parts.json'), 'utf8'));
const dist = (file: string): string => join(ROOT, 'dist', ...file.split('/'));

/** The files an entry reaches by its relative imports, static and dynamic, from `dist/`. */
function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(dist(file), 'utf8');
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      stack.push(posix.normalize(posix.join(posix.dirname(file), match[1])));
    }
  }
  return seen;
}

test('every export is a part, named by its subpath, at the package version', { skip: skip ?? false }, () => {
  const record = read();
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(record.name, pkg.name);
  assert.equal(record.version, pkg.version);
  assert.deepEqual(
    Object.values(record.parts).map((part) => part.subpath).sort(),
    Object.keys(pkg.exports).sort(),
    'one part per export, and no other'
  );
  for (const [name, part] of Object.entries(record.parts)) {
    assert.equal(name, part.subpath === '.' ? 'main' : part.subpath.slice(2), `${part.subpath} is named for its subpath`);
    const target = pkg.exports[part.subpath];
    assert.equal(`./dist/${part.entry}`, typeof target === 'string' ? target : target.import, `${name}'s entry is the one the map names`);
    if (part.types) assert.equal(`./dist/${part.types}`, target.types, `${name}'s declarations are the ones the map names`);
  }
});

test('a part names exactly the files its entry reaches, with their scope markers', { skip: skip ?? false }, () => {
  for (const [name, part] of Object.entries(read().parts)) {
    for (const file of part.files) assert.ok(existsSync(dist(file)), `${name} names dist/${file}, which is missing`);
    const bytes = part.files.reduce((sum, file) => sum + statSync(dist(file)).size, 0);
    assert.equal(part.bytes, bytes, `${name}'s weight is its files'`);
    if (!part.entry.endsWith('.js')) continue;

    const expected = new Set<string>();
    for (const file of reach(part.entry)) {
      expected.add(file);
      expected.add(posix.join(posix.dirname(file), 'package.json'));
    }
    assert.deepEqual([...part.files].sort(), [...expected].sort(), `${name}'s files`);
    for (const marker of part.files.filter((file) => file.endsWith('/package.json'))) {
      assert.deepEqual(JSON.parse(readFileSync(dist(marker), 'utf8')), { type: 'module' }, `${marker} scopes its folder to ESM`);
    }
  }
});

test('a part says where it runs, and owes the notices its files hold', { skip: skip ?? false }, () => {
  const record = read();
  const platform = Object.fromEntries(Object.entries(record.parts).map(([name, part]) => [name, part.platform]));
  assert.deepEqual(platform, {
    main: 'browser',
    node: 'node',
    'graphic-design': 'browser',
    sharpen: 'browser',
    engines: 'browser',
    'graphic-design/files': 'node',
    markdown: 'browser',
    'styles.css': 'browser',
  });

  // Every notice a part owes has its section in THIRD-PARTY-NOTICES.md, so a
  // vendored copy can carry that section and no other.
  const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8').split(/\r?\n/);
  for (const [id, heading] of Object.entries(record.notices)) {
    assert.ok(notices.includes(heading), `${id}'s heading, "${heading}", is a line of THIRD-PARTY-NOTICES.md`);
  }
  for (const part of Object.values(record.parts)) {
    for (const id of part.notices) assert.ok(id in record.notices, `${part.subpath} owes ${id}, which the record names`);
  }

  // Markdown's readers are marked and highlight.js; type sets hyphenated text
  // from the en-US patterns; a composition, or a stroke sharpened, owes none.
  assert.deepEqual(record.parts.markdown.notices, ['highlight.js', 'hyphenation', 'marked', 'marked-highlight']);
  assert.deepEqual(record.parts.main.notices, ['hyphenation']);
  assert.deepEqual(record.parts['graphic-design'].notices, []);
  assert.deepEqual(record.parts.sharpen.notices, []);

  // The stylesheet carries what its url()s name.
  assert.ok(record.parts['styles.css'].files.includes('renderer/styles.css'));
  assert.ok(record.parts['styles.css'].files.some((file) => file.startsWith('assets/')), 'the stylesheet names an asset');
});
