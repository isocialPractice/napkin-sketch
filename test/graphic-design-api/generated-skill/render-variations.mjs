/**
 * Renders every variation `test/generated-skill.test.ts` measures.
 *
 * Test infrastructure, not part of the generated skill. It exists as a
 * separate script for two reasons:
 *
 * - The fixture beside it stays a faithful copy of what the helper generated.
 *   Adding a variations mode to the fixture would mean testing something the
 *   helper never wrote.
 * - The fixture is an ES module that reads `import.meta.url`. The test suite is
 *   bundled to CommonJS by esbuild, where that expression does not survive, so
 *   the fixture is loaded here - by Node, natively - and the test measures the
 *   files that come out.
 *
 * One process renders all eight, which keeps the suite's cost to a single Node
 * start rather than eight of them.
 *
 *   node render-variations.mjs <output directory>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The skill under test, loaded as the ES module it is. */
const skill = await import(
  pathToFileURL(join(here, 'scripts', 'make-created-svg_graphic-api.mjs')).href
);

/** The graphic-design API, found the way the skill itself finds it. */
async function loadApi() {
  let dir = here;
  for (let i = 0; i < 10; i++) {
    const built = join(dir, 'dist', 'api', 'index.js');
    try {
      return await import(pathToFileURL(built).href);
    } catch {
      // Not at this level; keep walking up.
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('graphic-design API not found. Run `npm run build` first.');
}

/**
 * The listing the baseline draws.
 *
 * A copy of the fixture's own default rather than an import of it: the fixture
 * keeps that constant private, and test data belongs to the test. If the two
 * drift, the baseline stops resembling the shipped default - which the
 * re-baselining note in the fixture's header is there to catch.
 */
const HTML_ROWS = [
  [['<!DOCTYPE html>', 'comment']],
  [['<html', 'tag'], [' lang', 'attr'], ['="en"', 'value'], ['>', 'tag']],
  [['  <head>', 'tag']],
  [['    <meta', 'tag'], [' charset', 'attr'], ['="utf-8"', 'value'], ['>', 'tag']],
  [['    <title>', 'tag'], ['Page title', 'text'], ['</title>', 'tag']],
  [['  </head>', 'tag']],
  [['  <body>', 'tag']],
  [['    <h1', 'tag'], [' id', 'attr'], ['="top"', 'value'], ['>', 'tag'], ['Heading', 'text'], ['</h1>', 'tag']],
  [['    <a', 'tag'], [' href', 'attr'], ['="/docs"', 'value'], ['>', 'tag'], ['Link', 'text'], ['</a>', 'tag']],
  [['  </body>', 'tag']],
  [['</html>', 'tag']],
];

/** One row of HTML, long enough to push the widest line the layout allows. */
const WIDE_ROW = [
  ['    <input', 'tag'],
  [' type', 'attr'],
  ['="email"', 'value'],
  [' placeholder', 'attr'],
  ['="jane.doe@example.com"', 'value'],
  [' required', 'attr'],
  ['>', 'tag'],
];

const SHORT_ROWS = [
  [['<!DOCTYPE html>', 'comment']],
  [['<html>', 'tag']],
  [['</html>', 'tag']],
];

/** A listing long enough to test that the line step tightens instead of overflowing. */
const LONG_ROWS = Array.from({ length: 28 }, (_, i) => [
  [`    <p id="row-${i}">`, 'tag'],
  [`Line ${i}`, 'text'],
  ['</p>', 'tag'],
]);

/**
 * Every variation, and what each one is pointed at.
 *
 * `raster-1x` is the odd one: it is expected to *fail* the legibility standard,
 * which is how the suite proves that standard has teeth rather than passing
 * everything put in front of it.
 */
const DEFAULT_CHEATSHEET = {
  title: 'HTML',
  heading: 'HTML Document Structure Starting Point',
  subheading: 'Head, Body, and the Tags Worth Memorizing',
  footer: 'jane.doe@example.com',
  rows: HTML_ROWS,
};

const VARIATIONS = [
  { name: 'baseline', scale: 3, args: {} },
  { name: 'long-rows', scale: 3, args: { rows: LONG_ROWS } },
  { name: 'short-rows', scale: 3, args: { rows: SHORT_ROWS } },
  { name: 'long-title', scale: 3, args: { title: 'Hypertext Markup Language Reference' } },
  {
    name: 'long-heading',
    scale: 3,
    args: { heading: 'Every Element Worth Memorizing, With The Attributes That Matter Most' },
  },
  { name: 'wide-tokens', scale: 3, args: { rows: [...HTML_ROWS, WIDE_ROW] } },
  { name: 'card', scale: 3, card: true },
  { name: 'raster-1x', scale: 1, args: {} },
];

async function run() {
  const out = resolve(process.argv[2] ?? './out');
  await mkdir(out, { recursive: true });
  const api = await loadApi();

  const written = [];
  for (const variation of VARIATIONS) {
    const design = variation.card
      ? skill.compose(api, {
          title: 'Acme Corp',
          heading: 'Quarterly Summary Starting Point',
          body: 'Prepared by Jane Doe. The card and the cheatsheet are the same design language wearing different content.',
          footer: 'jane.doe@example.com',
        })
      : skill.composeCheatsheet(api, { ...DEFAULT_CHEATSHEET, ...variation.args });

    await writeFile(join(out, `${variation.name}.svg`), design.toSVG(), 'utf-8');
    await writeFile(join(out, `${variation.name}.png`), design.toPNG({ scale: variation.scale }));
    written.push({ name: variation.name, scale: variation.scale });
  }

  // The determinism case: the same document rendered twice must be identical.
  const twice = skill.composeCheatsheet(api, DEFAULT_CHEATSHEET);
  await writeFile(join(out, 'determinism-a.png'), twice.toPNG({ scale: 3 }));
  await writeFile(join(out, 'determinism-b.png'), twice.toPNG({ scale: 3 }));

  console.log(JSON.stringify(written));
}

await run();
