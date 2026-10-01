/**
 * The drawing engines' pages (docs/api/engines/): every `js` block on them
 * runs against the barrel, as a reader would run it, and prints what the
 * `// →` line under each `console.log` says it prints - so a worked example
 * cannot drift from the engine it shows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as api from '../src/api/index.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();
const PAGES = ['docs/api/engines/README.md', 'docs/api/engines/QUICKSTART.md'];

/** A block with its imports turned into reads of what the test hands it: the barrel, and a file system that writes nothing. */
function runnable(code: string): string {
  return code.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';$/gm, (_whole, names: string, from: string) => {
    const module = from === 'napkin-sketch' ? 'api' : from === 'node:fs/promises' ? 'fs' : null;
    if (!module) throw new Error(`an example imports ${from}, which the test does not hand it`);
    return `const {${names}} = ${module};`;
  });
}

/** A value as `console.log` shows it on these pages: text as it is, anything else as JSON. */
function shown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;

for (const page of PAGES) {
  const text = readFileSync(join(ROOT, page), 'utf-8').replace(/\r\n/g, '\n');
  const blocks = [...text.matchAll(/^```js\n([\s\S]*?)^```$/gm)].map((m) => m[1]);

  test(`${page} has worked examples to run`, () => {
    assert.ok(blocks.length > 0);
  });

  blocks.forEach((code, i) => {
    const first = code.split('\n').find((line) => line.trim() && !line.startsWith('import')) ?? '';
    test(`${page}, example ${i + 1}, runs and prints what it says: ${first.slice(0, 60)}`, async () => {
      const printed: string[] = [];
      const written: string[] = [];
      const log = (...values: unknown[]): void => {
        printed.push(values.map(shown).join(' '));
      };
      const fs = {
        writeFile: async (path: string): Promise<void> => {
          written.push(path);
        },
      };
      await new AsyncFunction('api', 'fs', 'console', runnable(code))(api, fs, { log });
      const expected = [...code.matchAll(/^\/\/ → (.*)$/gm)].map((m) => m[1]);
      assert.ok(expected.length > 0, 'it says what it prints');
      assert.deepEqual(printed, expected);
    });
  });
}
