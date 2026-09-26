/**
 * The golden scripts: each `.napkin` file in `test/scripts/` drawn to SVG and
 * compared byte for byte with the files beside it - `<name>.svg` for a book of
 * one page, `<name>-1.svg`, `<name>-2.svg` and on for more.
 *
 * A difference fails. The goldens are rewritten by `npm test -- --update-golden`
 * and by nothing else, so a change to what a script draws is always a change a
 * person looked at. Each script is also drawn twice in this process and once
 * in a fresh one, and the three must be the same bytes: drawing is
 * deterministic, not merely stable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluate, formatDiagnostic, renderBook } from '../src/core/script/index.js';
import { fixtureSketch } from './helpers/fixture-sketch.js';
import { repoRoot } from './helpers/repo-root.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const ROOT = repoRoot();
const DIR = join(ROOT, 'test', 'scripts');
const UPDATE = process.env.NAPKIN_UPDATE_GOLDEN === '1';

/**
 * What every golden script is handed, as a host would hand it over: the
 * `logo` and `badge` every documentation example gets, and `figure`, an SVG
 * from `test/imports/` read into a sketch with no DOM.
 */
const OPTIONS = {
  timestamp: '2026-09-25T00:00:00.000Z',
  assets: SCRIPT_FIXTURES.assets,
  documents: {
    ...SCRIPT_FIXTURES.documents,
    figure: fixtureSketch(readFileSync(join(ROOT, 'test', 'imports', 'gradient-figure.svg'), 'utf-8'), 'figure'),
  },
};

const SCRIPTS = readdirSync(DIR)
  .filter((file) => file.endsWith('.napkin'))
  .sort();

interface Drawn {
  diagnostics: string[];
  /** Each page's SVG, by the name of the golden file it is compared with. */
  files: Record<string, string>;
}

/** A golden script drawn to SVG, a page at a time, cut as the script asks. */
function draw(file: string): Drawn {
  const name = file.replace(/\.napkin$/, '');
  const result = evaluate(readFileSync(join(DIR, file), 'utf-8'), { ...OPTIONS, name });
  const pages = renderBook(result.book, { format: 'svg', ...result.output });
  return {
    diagnostics: result.diagnostics.map((d) => formatDiagnostic(d, file)),
    files: Object.fromEntries(pages.map((svg, i) => [pages.length === 1 ? `${name}.svg` : `${name}-${i + 1}.svg`, svg])),
  };
}

/** The golden files that belong to a script, whatever it draws today. */
function goldensOf(file: string): string[] {
  const name = file.replace(/\.napkin$/, '');
  return readdirSync(DIR).filter((golden) => golden === `${name}.svg` || new RegExp(`^${name}-\\d+\\.svg$`).test(golden));
}

if (process.env.NAPKIN_GOLDEN_CHILD === '1') {
  // Run as a fresh process by the determinism test below: draw every script
  // and hand the SVG back on standard output.
  process.stdout.write(JSON.stringify(Object.fromEntries(SCRIPTS.map((file) => [file, draw(file).files]))));
} else {
  test('there are six golden scripts, the plan\'s goal among them', () => {
    assert.deepEqual(SCRIPTS, ['deck.napkin', 'goal.napkin', 'holes.napkin', 'rough.napkin', 'shapes.napkin', 'use.napkin']);
  });

  for (const file of SCRIPTS) {
    test(`${file} draws its golden SVG, with nothing reported`, () => {
      const { diagnostics, files } = draw(file);
      assert.deepEqual(diagnostics, [], `${file} runs clean`);
      if (UPDATE) {
        for (const [golden, svg] of Object.entries(files)) writeFileSync(join(DIR, golden), svg);
      }
      assert.deepEqual(goldensOf(file).sort(), Object.keys(files).sort(), `${file}: a golden file for each page and no more`);
      for (const [golden, svg] of Object.entries(files)) {
        assert.ok(existsSync(join(DIR, golden)), `${golden} is missing: npm test -- --update-golden writes it`);
        assert.equal(svg, readFileSync(join(DIR, golden), 'utf-8'), `${golden} differs: look at the change, then npm test -- --update-golden`);
      }
    });
  }

  test('every golden draws the same bytes twice in one process', () => {
    for (const file of SCRIPTS) assert.deepEqual(draw(file).files, draw(file).files, file);
  });

  test('and the same bytes in a fresh process', () => {
    const child = spawnSync(process.execPath, [__filename], {
      cwd: ROOT,
      env: { ...process.env, NAPKIN_GOLDEN_CHILD: '1', NAPKIN_UPDATE_GOLDEN: '' },
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr);
    const fresh = JSON.parse(child.stdout) as Record<string, Record<string, string>>;
    assert.deepEqual(Object.keys(fresh), SCRIPTS);
    for (const file of SCRIPTS) assert.deepEqual(fresh[file], draw(file).files, file);
  });
}
