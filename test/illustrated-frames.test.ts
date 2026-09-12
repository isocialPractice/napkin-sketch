/**
 * The measurement behind the movement budgets.
 *
 * `scripts/illustrated-frames.mjs` reads two large illustrated SVGs and boils
 * them down to "how far does each part of a figure move between drawn
 * frames". The skill quotes those numbers as a table, and a frame is checked
 * against them, so a quiet error in the path tracing would move the goalposts
 * for every generated frame without anything failing. These cover the parsing,
 * the part naming, and the agreement between the generated asset and the
 * table in the skill.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { boundsOf, childGroups, partOf, pathPoints } from '../scripts/illustrated-frames.mjs';

/**
 * The repository root, found by walking up from the working directory. The
 * suite runs from a bundle in `dist-test/`, so neither `__dirname` nor a fixed
 * relative path is reliable.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf-8')).name === 'napkin-sketch') {
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`repository root not found from ${process.cwd()}`);
}

const ROOT = repoRoot();
const ASSET = join(
  ROOT,
  'ai-helper',
  'vectors',
  'skills',
  'vector-animations',
  'assets',
  'illustrated-frames.json',
);
const SKILL = join(ROOT, 'ai-helper', 'vectors', 'skills', 'vector-animations', 'SKILL.md');

test('pathPoints walks a relative curve from the point it is standing on', () => {
  // The illustrated assets are almost entirely relative curves, so an offset
  // applied to the wrong origin would drift further with every command.
  const pts = pathPoints('M10,10 c0,5 5,5 10,0 c0,-5 5,-5 10,0');
  assert.deepEqual(pts[0], [10, 10]);
  // First curve ends 10 right of where it began.
  assert.deepEqual(pts[3], [20, 10]);
  // Second curve starts from there, not from the original moveto.
  assert.deepEqual(pts[6], [30, 10]);
});

test('pathPoints reads a second pair after a moveto as a lineto', () => {
  const pts = pathPoints('M0,0 5,5 10,0');
  assert.deepEqual(pts, [
    [0, 0],
    [5, 5],
    [10, 0],
  ]);
});

test('pathPoints keeps relative linetos relative after an implicit switch', () => {
  const pts = pathPoints('m0,0 5,0 5,0');
  assert.deepEqual(pts, [
    [0, 0],
    [5, 0],
    [10, 0],
  ]);
});

test('pathPoints treats an arc radius and its flags as numbers, not coordinates', () => {
  // `A rx ry rotation large-arc sweep x y` - only the last pair is a point.
  // Counting the flags as coordinates puts a phantom point at (1,1).
  const pts = pathPoints('M0,0 A5,5 0 1 1 10,0');
  assert.deepEqual(pts, [
    [0, 0],
    [10, 0],
  ]);
});

test('pathPoints closes back to the start of the subpath', () => {
  const pts = pathPoints('M10,10 L20,10 Z l5,0');
  // After Z the cursor is back at the moveto, so the relative lineto lands at 15.
  assert.deepEqual(pts[pts.length - 1], [15, 10]);
});

test('boundsOf boxes every path in a chunk of markup', () => {
  const markup = '<path d="M0,0 L10,10"/><path class="x" d="M-5,4 L2,30"/>';
  assert.deepEqual(boundsOf(markup), { minX: -5, minY: 0, maxX: 10, maxY: 30 });
});

test('boundsOf reports nothing for markup that draws nothing', () => {
  assert.equal(boundsOf('<g id="empty"></g>'), null);
});

test('childGroups returns the direct children and not their descendants', () => {
  const markup = '<g id="a"><g id="a1"><g id="a2"/></g></g><g id="b"><path d="M0,0"/></g>';
  const kids = childGroups(markup);
  assert.deepEqual(
    kids.map((k) => k.id),
    ['a', 'b'],
  );
  // The nested groups are inside the first child, reachable by recursing.
  assert.deepEqual(
    childGroups(kids[0].inner).map((k) => k.id),
    ['a1'],
  );
});

test('partOf names the parts the illustrated assets actually use', () => {
  // Every one of these is a real layer name out of the two assets. They are
  // the reason the matching is on meaning rather than on an expected spelling.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['back-leg-assembly', 'leg'],
    ['back-shoe', 'leg'],
    ['front-glove', 'arm'],
    ['upperarm', 'arm'],
    ['forearm', 'arm'],
    ['head-63', 'head'],
    ['hair-32', 'head'],
    ['dress', 'clothing'],
    ['left-vest', 'clothing'],
    ['skirt-assembly', 'clothing'],
    // The artist's typo for `jacket-left`, kept because the asset keeps it.
    ['jacket-keft-3', 'clothing'],
    ['upper-body', 'torso'],
    ['body-33', 'torso'],
    ['strokes', 'other'],
  ];
  for (const [name, part] of cases) {
    assert.equal(partOf(name), part, `${name} should read as ${part}`);
  }
});

test('the generated asset holds a measurable step for every sequence', () => {
  const asset = JSON.parse(readFileSync(ASSET, 'utf-8'));
  assert.ok(asset.sequences.length > 0, 'no sequences were measured');
  for (const seq of asset.sequences) {
    assert.ok(seq.steps.length >= 1, `${seq.sequence} has no steps`);
    assert.equal(seq.frames.length, seq.steps.length + 1, `${seq.sequence} lost a frame`);
    assert.ok(seq.layersAsDrawn.length > 0, `${seq.sequence} measured no layers`);
  }
});

test('every budget reading sits inside the range it reports', () => {
  const asset = JSON.parse(readFileSync(ASSET, 'utf-8'));
  for (const [type, budget] of Object.entries<Record<string, unknown>>(asset.budgets)) {
    for (const key of ['bob', 'leg', 'arm', 'head', 'clothing', 'torso']) {
      const span = budget[key] as { low: number; typical: number; high: number } | null;
      if (!span) continue;
      assert.ok(span.low <= span.typical, `${type}.${key}: typical below the low`);
      assert.ok(span.typical <= span.high, `${type}.${key}: typical above the high`);
    }
  }
});

test('the skill quotes the generated numbers, not numbers of its own', () => {
  // The table in "How Far a Part Moves" was copied out of the asset by hand.
  // If the assets are redrawn and the script re-run, this is what says the
  // table went stale.
  const asset = JSON.parse(readFileSync(ASSET, 'utf-8'));
  const whole = readFileSync(SKILL, 'utf-8');
  // Only the budget table. Several of these type names also head a row in the
  // skeleton table further up, and that row holds frame counts, not travel.
  const section = /\n## How Far a Part Moves\r?\n([\s\S]*?)\r?\n## /.exec(whole);
  assert.ok(section, 'the "How Far a Part Moves" section is gone from SKILL.md');
  const skill = section[1];
  type Span = { low: number; typical: number; high: number } | null;
  // The numbers, not their spelling: the table writes a round value as `9.0`
  // where JSON writes `9`, and that difference is not drift.
  const fromCell = (text: string): readonly number[] | null => {
    const m = /^([\d.-]+) \(([\d.-]+)-([\d.-]+)\)$/.exec(text.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const fromSpan = (span: Span): readonly number[] | null =>
    span ? [span.typical, span.low, span.high] : null;

  let checked = 0;
  for (const [type, budget] of Object.entries<Record<string, unknown>>(asset.budgets)) {
    const row = new RegExp(`^\\| ${type} \\|(.*)\\|\\s*$`, 'm').exec(skill);
    if (!row) continue; // Not every measured type earns a row in the table.
    const cells = row[1].split('|').map((c) => fromCell(c));
    const expected = ['bob', 'leg', 'arm', 'clothing'].map((k) => fromSpan(budget[k] as Span));
    assert.deepEqual(cells, expected, `the ${type} row in SKILL.md no longer matches the asset`);
    checked++;
  }
  assert.ok(checked >= 5, `only ${checked} budget rows were found in SKILL.md`);
});
