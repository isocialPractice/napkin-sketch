/**
 * The API documentation, held to the code.
 *
 * Every page under `docs/api/`, and the three hubs at the root, is checked
 * here: the tables generated from the verb table and the command line's own
 * tables must be what the generators write today, every ```napkin block
 * must read with no diagnostics, every ```napkin-error block must produce
 * exactly the codes its first line names, a ```text block right after one must
 * be what printing those diagnostics gives, every JSON script must validate,
 * and every relative link must reach a file. A page therefore cannot show a
 * script that does not run or a listing that has drifted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { evaluate, formatDiagnostic, parseScript, validateScript } from '../src/core/script/index.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';
import { betweenMarkers } from '../src/core/script/reference.js';
import { GENERATED_TABLES, HUB_PAGES } from '../src/docs/api-docs.js';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf-8')).name === 'napkin-sketch') return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`repository root not found from ${process.cwd()}`);
}

const ROOT = repoRoot();

function pages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const PAGES = [
  ...HUB_PAGES.map((page) => join(ROOT, page)).filter((page) => existsSync(page)),
  ...pages(join(ROOT, 'docs', 'api')),
];

interface Block {
  lang: string;
  body: string;
  line: number;
}

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\S*)\s*$/.exec(lines[i]);
    if (!open) continue;
    const start = i;
    const body: string[] = [];
    for (i++; i < lines.length && lines[i] !== '```'; i++) body.push(lines[i]);
    out.push({ lang: open[1], body: body.join('\n'), line: start + 1 });
  }
  return out;
}

const relative = (path: string): string => path.slice(ROOT.length + 1).replace(/\\/g, '/');

test('there are pages to check', () => {
  assert.ok(PAGES.some((p) => relative(p) === 'docs/api/language/README.md'));
});

test('generated tables are what the generators write today', () => {
  for (const page of PAGES) {
    const text = readFileSync(page, 'utf-8').replace(/\r\n/g, '\n');
    for (const [name, generate] of Object.entries(GENERATED_TABLES)) {
      const found = betweenMarkers(text, name);
      if (found === null) continue;
      assert.equal(found, generate(), `${relative(page)}: the ${name} table is out of date`);
    }
  }
});

test('every napkin block reads and runs with no diagnostics', () => {
  let seen = 0;
  for (const page of PAGES) {
    for (const block of blocks(readFileSync(page, 'utf-8')).filter((b) => b.lang === 'napkin')) {
      seen++;
      // Pages may place the asset `logo` and copy in the document `badge`, which every example is handed.
      const result = evaluate(block.body, { fragment: true, timestamp: '2026-09-25T00:00:00.000Z', ...SCRIPT_FIXTURES });
      assert.deepEqual(
        result.diagnostics.map((d) => formatDiagnostic(d)),
        [],
        `${relative(page)}:${block.line}`,
      );
      assert.ok(result.stats.instructions > 0, `${relative(page)}:${block.line}: the block runs something`);
    }
  }
  assert.ok(seen > 0);
});

test('every napkin-error block produces the codes it names, and its printout is real', () => {
  let seen = 0;
  for (const page of PAGES) {
    const all = blocks(readFileSync(page, 'utf-8'));
    all.forEach((block, k) => {
      if (block.lang !== 'napkin-error') return;
      seen++;
      const expect = /^#\s*expect:\s*(.+)$/.exec(block.body.split('\n')[0]);
      assert.ok(expect, `${relative(page)}:${block.line}: the first line names the expected codes`);
      const wanted = expect[1].split(',').map((c) => c.trim());
      const result = parseScript(block.body);
      assert.deepEqual(
        result.diagnostics.map((d) => d.code),
        wanted,
        `${relative(page)}:${block.line}`,
      );
      const next = all[k + 1];
      if (next && next.lang === 'text') {
        assert.equal(
          next.body,
          result.diagnostics.map((d) => formatDiagnostic(d, 'card.napkin')).join('\n'),
          `${relative(page)}:${next.line}: the printout shown is what printing gives`,
        );
      }
    });
  }
  assert.ok(seen > 0);
});

test('every JSON script on a page validates', () => {
  for (const page of PAGES) {
    for (const block of blocks(readFileSync(page, 'utf-8')).filter((b) => b.lang === 'json')) {
      const value = JSON.parse(block.body);
      if (!Array.isArray(value)) continue;
      const result = validateScript(value);
      assert.deepEqual(
        result.diagnostics.map((d) => formatDiagnostic(d)),
        [],
        `${relative(page)}:${block.line}`,
      );
    }
  }
});

test('every relative link reaches a file', () => {
  for (const page of PAGES) {
    const text = readFileSync(page, 'utf-8');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      const path = resolve(dirname(page), target.split('#')[0]);
      assert.ok(existsSync(path), `${relative(page)} links to ${target}, which does not exist`);
    }
  }
});

test('the pages are written with hyphens, never em or en dashes', () => {
  for (const page of PAGES) {
    assert.doesNotMatch(readFileSync(page, 'utf-8'), /[\u2013\u2014]/, relative(page));
  }
});
