/**
 * The API documentation's shape, and the files `npm run api-docs` writes.
 *
 * The generated tables, the object form's schema and `docs/api/INDEX.json`
 * must be what the generator makes today. Every category has its three pages,
 * each page has the shape its kind promises and links to its hub and its
 * siblings near the top, and every link to a heading reaches one. The schema
 * accepts every verb's own example and refuses what the object form refuses.
 * `test/script-docs.test.ts` runs the scripts on the same pages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  CATEGORY_PAGES,
  DOC_CATEGORIES,
  generateDocs,
  HUB_PAGES,
  INDEX_PATH,
  isNavLine,
  pageKind,
  SCHEMA_PATH,
  VERB_GROUPS,
  type DocPage,
} from '../src/docs/api-docs.js';
import { instructionsSchema } from '../src/core/script/schema.js';
import { parseScript } from '../src/core/script/index.js';
import { VERB_CATEGORIES, VERBS } from '../src/core/script/instructions.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();

/** Every Markdown page under a folder, as paths from the root with `/`. */
function pagesUnder(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return pagesUnder(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf-8').replace(/\r\n/g, '\n');

const PAGE_PATHS = [...HUB_PAGES.filter((page) => existsSync(join(ROOT, page))), ...pagesUnder('docs/api')];
const PAGES: DocPage[] = PAGE_PATHS.map((path) => ({ path, text: read(path) }));

/** A page's text with its fenced blocks taken out, so a `#` in a code sample is not a heading. */
function prose(text: string): string {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '');
}

/** The `## ` headings of a page, in order. */
function sections(text: string): string[] {
  return [...prose(text).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

/** The anchors GitHub gives a page's headings, repeats numbered as it numbers them. */
function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const m of prose(text).matchAll(/^#{1,6} (.+)$/gm)) {
    const base = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.add(count === 0 ? base : `${base}-${count}`);
  }
  return out;
}

test('every generated file is what npm run api-docs writes today', () => {
  for (const file of generateDocs(PAGES)) {
    const full = join(ROOT, ...file.path.split('/'));
    assert.ok(existsSync(full), `${file.path} is missing: run npm run api-docs`);
    assert.equal(read(file.path), file.text, `${file.path} is out of date: run npm run api-docs`);
  }
});

test('every category has its three pages, and nothing else is a page', () => {
  const expected = DOC_CATEGORIES.flatMap((category) => CATEGORY_PAGES.map((page) => `docs/api/${category.id}/${page}`));
  assert.deepEqual([...pagesUnder('docs/api')].sort(), [...expected].sort());
  for (const hub of HUB_PAGES) assert.ok(existsSync(join(ROOT, hub)), `${hub} is missing`);
});

test('every verb category is listed by exactly one documentation category', () => {
  const listed = Object.values(VERB_GROUPS).flat();
  assert.deepEqual([...listed].sort(), VERB_CATEGORIES.map((c) => c.id).sort());
});

test('a reference page has the fixed headings, in order', () => {
  const headings = ['What this is', 'The mental model', 'Reference', 'Worked examples', 'Limits', 'For agents', 'See also'];
  for (const page of PAGES.filter((p) => pageKind(p.path) === 'verbose')) {
    assert.deepEqual(sections(page.text), headings, page.path);
  }
});

test('a quickstart is short, runs in numbered steps, and ends with where to go next', () => {
  for (const page of PAGES.filter((p) => pageKind(p.path) === 'quickstart')) {
    const lines = page.text.split('\n').length - 1;
    const cap = page.path === 'API-QUICKSTART.md' ? 100 : 120;
    assert.ok(lines <= cap, `${page.path} is ${lines} lines, over ${cap}`);
    const heads = sections(page.text);
    assert.match(heads[0] ?? '', /^The whole thing in \w+ steps$/, page.path);
    assert.equal(heads[heads.length - 1], 'Where to go next', page.path);
    const steps = [...prose(page.text).matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    assert.ok(steps.length >= 3, `${page.path} has ${steps.length} steps`);
    assert.deepEqual(steps, steps.map((_, i) => i + 1), `${page.path}: the steps are numbered 1, 2, 3 and on`);
    const count = /^The whole thing in (\w+) steps$/.exec(heads[0])?.[1];
    const words = ['three', 'four', 'five', 'six', 'seven', 'eight'];
    assert.equal(words.indexOf(count ?? '') + 3, steps.length, `${page.path}: the heading counts the steps`);
  }
});

test('a cheatsheet is tables and one-line reminders, under 150 lines', () => {
  for (const page of PAGES.filter((p) => pageKind(p.path) === 'cheatsheet')) {
    const lines = page.text.split('\n').length - 1;
    assert.ok(lines <= 150, `${page.path} is ${lines} lines, over 150`);
    const paragraphs = prose(page.text)
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p && !/^(#|\||- |<!--)/.test(p) && !isNavLine(p));
    assert.ok(paragraphs.length <= 1, `${page.path} has paragraphs of prose: ${paragraphs.slice(1).join(' / ')}`);
    assert.ok(paragraphs.every((p) => !p.includes('\n')), `${page.path}: its one line of prose is one line`);
  }
});

test('every page links to its hub and its two siblings in its first ten lines', () => {
  for (const page of PAGES) {
    const head = page.text.split('\n').slice(0, 10);
    const nav = head.find((line) => line.includes('·') && isNavLine(line));
    assert.ok(nav, `${page.path} has no line linking its hub and siblings near the top`);
    const hub = (HUB_PAGES as readonly string[]).includes(page.path);
    const family = hub ? [...HUB_PAGES] : [...CATEGORY_PAGES];
    const self = page.path.slice(page.path.lastIndexOf('/') + 1);
    const wanted = family.filter((name) => name !== self);
    if (!hub) wanted.push('../../../API.md');
    for (const target of wanted) assert.ok(nav.includes(`](${target})`), `${page.path}: the top links ${target}`);
    assert.ok(!nav.includes(`](${self})`), `${page.path}: the top names the page itself in bold, not as a link`);
  }
});

test('every link to a heading on a page reaches one', () => {
  for (const page of PAGES) {
    const dir = dirname(join(ROOT, page.path));
    for (const m of prose(page.text).matchAll(/\]\(([^)\s]*#[^)\s]+)\)/g)) {
      const [file, anchor] = m[1].split('#');
      if (/^[a-z]+:/i.test(file)) continue;
      const target = file ? resolve(dir, file) : join(ROOT, page.path);
      if (!target.endsWith('.md') || !existsSync(target)) continue;
      const text = readFileSync(target, 'utf-8').replace(/\r\n/g, '\n');
      assert.ok(anchors(text).has(anchor), `${page.path} links to ${m[1]}, and ${relative(ROOT, target)} has no such heading`);
    }
  }
});

test('the index lists every page with a title and a summary', () => {
  const index = JSON.parse(read(INDEX_PATH)) as { pages: Array<{ path: string; title: string; summary: string; kind: string }> };
  assert.deepEqual(index.pages.map((p) => p.path).sort(), [...PAGE_PATHS, SCHEMA_PATH].sort());
  for (const entry of index.pages) {
    assert.ok(entry.title, `${entry.path} has a title`);
    assert.ok(entry.summary.length > 20, `${entry.path} has a summary`);
  }
});

type Schema = Record<string, unknown>;

/** Enough of JSON Schema draft-07 for the keywords the object form's schema uses. */
function check(value: unknown, schema: Schema, root: Schema, path = '$'): string[] {
  if (typeof schema.$ref === 'string') {
    const target = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<unknown>((node, key) => (node as Schema | undefined)?.[key], root) as Schema | undefined;
    return target ? check(value, target, root, path) : [`${path}: ${schema.$ref} does not resolve`];
  }
  const errors: string[] = [];
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((option) => check(value, option as Schema, root, path).length === 0)) {
    errors.push(`${path}: matches none of its ${schema.anyOf.length} forms`);
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: is not ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: is not one of ${schema.enum.join(', ')}`);
  if (typeof schema.type === 'string') {
    const is: Record<string, boolean> = {
      number: typeof value === 'number' && Number.isFinite(value),
      integer: Number.isInteger(value),
      string: typeof value === 'string',
      boolean: typeof value === 'boolean',
      null: value === null,
      array: Array.isArray(value),
      object: typeof value === 'object' && value !== null && !Array.isArray(value),
    };
    if (!is[schema.type]) return [...errors, `${path}: is not ${schema.type}`];
  }
  if (typeof schema.pattern === 'string' && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...check(item, schema.items as Schema, root, `${path}[${i}]`)));
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in object)) errors.push(`${path}: ${key} is missing`);
    for (const [key, item] of Object.entries(object)) {
      if (key in properties) errors.push(...check(item, properties[key], root, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: ${key} is not a field`);
    }
  }
  return errors;
}

const SCHEMA = JSON.parse(read(SCHEMA_PATH)) as Schema;
const validates = (script: unknown): string[] => check(script, SCHEMA, SCHEMA);

test('every reference in the schema resolves', () => {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && node !== null) {
      const ref = (node as Schema).$ref;
      if (typeof ref === 'string') assert.deepEqual(check(null, { $ref: ref }, SCHEMA).filter((e) => e.includes('resolve')), [], ref);
      Object.values(node).forEach(walk);
    }
  };
  walk(SCHEMA);
  assert.deepEqual(SCHEMA, JSON.parse(JSON.stringify(instructionsSchema())));
});

test('the schema accepts every verb example, as the parser reads it', () => {
  for (const verb of VERBS) {
    const { script, diagnostics } = parseScript(verb.example, { fragment: true });
    assert.deepEqual(diagnostics, [], `${verb.name}: its example reads`);
    assert.deepEqual(validates(JSON.parse(JSON.stringify(script))), [], `${verb.name}: ${verb.example}`);
  }
});

test('the schema accepts every JSON script on a page', () => {
  for (const page of PAGES) {
    for (const m of page.text.matchAll(/^```json\n([\s\S]*?)^```$/gm)) {
      const value = JSON.parse(m[1]);
      if (Array.isArray(value)) assert.deepEqual(validates(value), [], page.path);
    }
  }
});

test('the schema refuses what the object form refuses', () => {
  const refused: Array<[string, unknown]> = [
    ['an unknown verb', [{ verb: 'circl', cx: 10, cy: 10, r: 5 }]],
    ['a required field left out', [{ verb: 'circle', cx: 10, cy: 10 }]],
    ['a word where a length goes', [{ verb: 'circle', cx: 'ten', cy: 10, r: 5 }]],
    ['a unit the language does not read', [{ verb: 'circle', cx: '10cm', cy: 10, r: 5 }]],
    ['a field the verb does not have', [{ verb: 'circle', cx: 10, cy: 10, r: 5, colour: 'red' }]],
    ['a choice not on the list', [{ verb: 'style', style: 'wavy' }]],
    ['a path step outside a path', [{ verb: 'to', x: 10, y: 10 }]],
    ['an expression with no source', [{ verb: 'circle', cx: { expression: 'i * 2' }, cy: 10, r: 5 }]],
    ['a polygon with no points', [{ verb: 'polygon', points: [] }]],
    ['not a list of instructions', { verb: 'circle', cx: 10, cy: 10, r: 5 }],
  ];
  for (const [what, script] of refused) assert.notDeepEqual(validates(script), [], what);
  assert.deepEqual(validates([{ verb: 'circle', cx: '50%', cy: { expr: 'height / 2' }, r: '10mm' }]), []);
});
