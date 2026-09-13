/**
 * The graphic-designer helper: the fixtures it is tested with, and the claim
 * its analyzer makes.
 *
 * The two fixtures are symlinks to the same graphic in two formats. That is
 * what makes them worth testing against: an SVG and a PNG of one composition
 * should yield the same design language, so agreement between the two reports
 * is evidence the analyzer is measuring the design rather than the file format.
 *
 * The symlinks themselves are checked too. Both were broken when they arrived -
 * written relative to the repository root rather than to their own directory,
 * which is what `mklink` does when it is run from somewhere else - and a broken
 * fixture fails as "no colors found" rather than as "no file", which is the
 * kind of failure that gets believed.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The repository root, found by walking up from the working directory until a
 * `package.json` naming this package turns up. The suite runs from a bundle in
 * `dist-test/`, so neither `__dirname` nor a fixed relative path is reliable.
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
const HELPER = join(ROOT, 'ai-helper', 'graphic-designer');
const ANALYZER = join(HELPER, 'skills', 'design-language', 'scripts', 'analyze-media.mjs');
const FIXTURES = join(ROOT, 'test', 'graphic-design-api', 'skill');

/** The two fixtures, and what each should point at. */
const LINKS = [
  { name: 'cheatsheet_js-composition.svg', target: '../reference-graphics/created-svg_graphic-api.svg' },
  { name: 'cheatsheet_js-composition.png', target: '../reference-graphics/created-png_graphic-api.png' },
];

/** The brand assets `npm run test:graphic-design-api` draws with. */
const ASSETS = join(ROOT, 'test', 'graphic-design-api', 'test-assets');

const ASSET_LINKS = [
  { name: 'logo.svg', target: '../reference-graphics/links/logo.svg' },
  { name: 'footer.png', target: '../reference-graphics/links/footer.png' },
];

/** One analyzer report, as the JSON the script prints. */
interface Report {
  source: string;
  stem: string;
  kind: string;
  page: { width: number | null; height: number | null; units: string };
  palette: Array<{ hex: string; share: number }>;
  type: { families: string[]; sizes: number[]; measured: boolean };
  strokeWidths: number[];
  cornerRadii: number[];
  elements: Record<string, number>;
  roles: { paper?: string; ink?: string; accent?: string };
  roleBasis?: 'area' | 'usage';
  areaPalette?: Array<{ hex: string; share: number }>;
  brand: {
    found: 'named' | 'scan' | 'none';
    slots: Array<{ key: string; source: string; found: string; region: string; confidence: number }>;
    notes: string[];
  };
  notes: string[];
}

/** Runs the analyzer over one file. */
function analyze(file: string, colors = 12): Report {
  const out = execFileSync(process.execPath, [ANALYZER, file, '--colors', String(colors)], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  return JSON.parse(out) as Report;
}

/** Manhattan distance between two `#rrggbb` colors, 0 to 765. */
function colorDistance(a: string, b: string): number {
  const bytes = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = bytes(a);
  const [r2, g2, b2] = bytes(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

test('the fixture symlinks resolve to the graphics they name', () => {
  for (const { name, target } of LINKS) {
    const path = join(FIXTURES, name);
    assert.ok(existsSync(path), `${name} does not resolve - check its target`);
    assert.ok(statSync(path).size > 0, `${name} resolves to an empty file`);

    // A symlink resolves against its own directory, so the target has to start
    // with `../`. A repository-root-relative target is the failure this guards.
    const link = lstatSync(path);
    if (link.isSymbolicLink()) {
      const stored = readlinkSync(path).replace(/\\/g, '/');
      assert.equal(stored, target, `${name} points somewhere else`);
    }
  }
});

test('the symlinks are committed as symlinks, with portable targets', () => {
  // Git stores a symlink's target verbatim, so a backslash target resolves on
  // Windows and nowhere else. Mode 120000 plus a forward-slash target is what
  // makes these work on a Linux clone and render as links on GitHub.
  const listed = execFileSync('git', ['ls-files', '-s', 'test/graphic-design-api/skill/'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }).trim();

  for (const { name, target } of LINKS) {
    const row = listed.split('\n').find((line) => line.endsWith(name));
    assert.ok(row, `${name} is not in the index`);
    assert.match(row, /^120000 /, `${name} is committed as a file, not a symlink`);

    const sha = row.split(/\s+/)[1];
    const stored = execFileSync('git', ['cat-file', '-p', sha], { cwd: ROOT, encoding: 'utf-8' });
    assert.equal(stored, target, `${name} stores a target that will not resolve everywhere`);
    assert.ok(!stored.includes('\\'), `${name} stores a backslash path`);
  }
});

test('the brand assets are symlinks that resolve on any clone', () => {
  // The defect this exists for: a symlink whose target is written from the
  // repository root rather than from the link's own directory. It resolves
  // nowhere, and because a missing brand asset falls back to a drawn mark
  // rather than failing, the graphics come out looking plausible and wrong.
  const listed = execFileSync('git', ['ls-files', '-s', 'test/graphic-design-api/test-assets/'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }).trim();

  for (const { name, target } of ASSET_LINKS) {
    const path = join(ASSETS, name);
    assert.ok(existsSync(path), `${name} does not resolve - check its target`);
    assert.ok(statSync(path).size > 0, `${name} resolves to an empty file`);

    const link = lstatSync(path);
    if (link.isSymbolicLink()) {
      assert.equal(readlinkSync(path).replace(/\\/g, '/'), target, `${name} points somewhere else`);
    }

    const row = listed.split('\n').find((line) => line.endsWith(name));
    assert.ok(row, `${name} is not in the index`);
    assert.match(row, /^120000 /, `${name} is committed as a file, not a symlink`);

    const stored = execFileSync('git', ['cat-file', '-p', row.split(/\s+/)[1]], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    assert.equal(stored, target, `${name} stores a target that will not resolve everywhere`);
    assert.ok(stored.startsWith('../'), `${name} stores a repository-relative target`);
    assert.ok(!stored.includes('\\'), `${name} stores a backslash path`);
  }
});

test('the analyzer reports where the brand sits, and how it knows', () => {
  const report = analyze(join(ROOT, 'test', 'graphic-design-api', 'reference-graphics', 'created-svg_graphic-api.svg'));

  assert.ok(report.brand, 'a report should carry a brand section');
  assert.equal(report.brand.found, 'named', 'this asset names its own layers');

  const logo = report.brand.slots.find((s) => s.key === 'logo');
  assert.ok(logo, `no logo slot in ${report.brand.slots.map((s) => s.key).join(', ')}`);
  assert.equal(logo?.region, 'top-right');
  assert.equal(logo?.found, 'named');

  // A design language that cannot say where the logo goes is half written, so
  // the markdown body has to carry the slots, not just the JSON.
  const markdown = execFileSync(
    process.execPath,
    [ANALYZER, join(ROOT, 'test', 'graphic-design-api', 'reference-graphics', 'created-svg_graphic-api.svg'), '--markdown'],
    { cwd: ROOT, encoding: 'utf-8' }
  );
  assert.match(markdown, /^## Brand positioning$/m);
  assert.match(markdown, /\| `logo` \| top-right \|/);
});

test('an SVG palette is cross-checked by area, which is what decides the roles', () => {
  const report = analyze(join(FIXTURES, 'cheatsheet_js-composition.svg'));

  // The two weightings answer different questions. References say what the file
  // declares; area says what covers the page, and "which colour is the ground"
  // is an area question. The shipped worked example had to correct this by
  // hand, which is the reason it is measured now.
  assert.equal(report.roleBasis, 'area', 'an SVG that renders should have its roles decided by area');
  assert.ok((report.areaPalette?.length ?? 0) > 0, 'the area measurement should be reported');

  const byArea = report.areaPalette ?? [];
  assert.ok(byArea[0].share > report.palette[0].share * 0.5, 'the ground should cover a real share of the page');
  assert.notEqual(byArea[0].hex, report.palette[0].hex, 'and it is not the most-referenced colour here');
});

test('the analyzer measures an SVG down to its type and structure', () => {
  const report = analyze(join(FIXTURES, 'cheatsheet_js-composition.svg'));

  assert.equal(report.kind, 'svg');
  assert.equal(report.page.width, 360);
  assert.ok(report.palette.length > 0, 'an SVG should yield a palette');
  assert.ok(report.type.measured, 'an SVG declares its type');
  assert.ok(report.type.families.length > 0, 'the families should be read off the file');
  assert.ok(report.type.sizes.length > 0, 'the sizes should be read off the file');
  assert.ok(report.elements.text > 0, 'the element census should count the text');
  assert.deepEqual(report.notes, [], 'nothing about an SVG should be unmeasurable');
});

test('the analyzer measures a PNG for colour, and says what it cannot measure', () => {
  const report = analyze(join(FIXTURES, 'cheatsheet_js-composition.png'));

  assert.equal(report.kind, 'png');
  assert.equal(report.page.width, 360);
  assert.ok(
    report.palette.length > 0,
    `a PNG should yield a palette; notes were: ${report.notes.join(' ')}`
  );
  assert.equal(report.type.measured, false, 'type is not recoverable from a raster');
  assert.equal(report.type.families.length, 0);
  // And it says so rather than returning an empty list as though the graphic
  // simply had no type in it.
  assert.ok(
    report.notes.some((n) => /not recoverable from a raster/.test(n)),
    'the report should name what it could not measure'
  );
});

test('both formats of one graphic yield the same design language', () => {
  const svg = analyze(join(FIXTURES, 'cheatsheet_js-composition.svg'));
  const png = analyze(join(FIXTURES, 'cheatsheet_js-composition.png'));

  // The same page. The SVG carries a fractional height its PNG export rounded,
  // so the comparison allows a unit rather than demanding equality.
  assert.equal(svg.page.width, png.page.width);
  assert.ok(
    Math.abs((svg.page.height ?? 0) - (png.page.height ?? 0)) <= 1.5,
    `heights disagree: ${svg.page.height} vs ${png.page.height}`
  );

  // The same ground and the same ink. These two roles are what a design
  // language is anchored on, and they are decided by different evidence in
  // each format - declared colours weighted by use, against decoded pixels
  // weighted by area - so agreement here is not a tautology.
  assert.equal(png.roles.paper, svg.roles.paper, 'the two formats disagree about the paper');
  assert.equal(png.roles.ink, svg.roles.ink, 'the two formats disagree about the ink');

  // And the palettes overlap: most of what the raster found by area was
  // declared in the vector.
  const shared = png.palette.filter((c) =>
    svg.palette.some((d) => colorDistance(c.hex, d.hex) <= 24)
  );
  assert.ok(
    shared.length >= 4,
    `only ${shared.length} of the PNG palette matched the SVG: ${png.palette.map((c) => c.hex).join(' ')}`
  );
});

test('a format with no decoder reports that, rather than an empty design', () => {
  const report = analyze(join(ROOT, 'test', 'graphic-design-api', 'reference-graphics', 'links', 'data.pdf'));

  assert.equal(report.palette.length, 0);
  assert.ok(report.notes.length > 0, 'an unreadable file must say why it read as nothing');
  assert.match(report.notes[0], /No decoder here/);
});

test('the analyzer renders a design language file body', () => {
  const out = execFileSync(
    process.execPath,
    [ANALYZER, join(FIXTURES, 'cheatsheet_js-composition.svg'), '--markdown'],
    { cwd: ROOT, encoding: 'utf-8' }
  );

  assert.match(out, /^# Design language: cheatsheet_js-composition\.svg$/m);
  assert.match(out, /^## Palette$/m);
  assert.match(out, /^## Type$/m);
  assert.match(out, /\| `#[0-9a-f]{6}` \|/);
});

test('the helper carries the parts its command and contract name', () => {
  // The command reaches for the analyzer by path and both skills by name, so a
  // move that is not reflected in the command is a command that cannot run.
  const command = readFileSync(join(HELPER, 'commands', 'design-language.md'), 'utf-8');
  assert.match(command, /skills\/design-language\/scripts\/analyze-media\.mjs/);
  assert.match(command, /graphic-designer:design-language/);
  assert.match(command, /graphic-designer:graphic-design-api/);

  assert.ok(existsSync(ANALYZER), 'the analyzer is not where the command looks for it');
  assert.ok(existsSync(join(HELPER, 'skills', 'design-language', 'scripts', 'template.md')));
  assert.ok(existsSync(join(HELPER, 'instructions', 'design-language.instructions.md')));
});

/** A scratch dot-folder the install test writes into, removed on the way out. */
const SCRATCH = '.graphic-design-install-check';

after(() => {
  rmSync(join(ROOT, SCRATCH), { recursive: true, force: true });
});

test('installing to a dot-folder carries the command, not only the skills', () => {
  // The dot-folder delivery used to copy skills and instructions and drop
  // commands on the floor, so `/graphic-designer:design-language` existed only
  // for someone who had loaded the plugin - and the documentation said
  // otherwise. A command reachable under one delivery and missing under the
  // other is a command whose docs are wrong half the time.
  execFileSync(
    process.execPath,
    [join(ROOT, 'scripts', 'install-ai-helper.mjs'), '--helper', 'graphic-designer', '--to', SCRATCH.slice(1)],
    { cwd: ROOT, encoding: 'utf-8' }
  );

  const base = join(ROOT, SCRATCH);
  assert.ok(existsSync(join(base, 'skills', 'design-language', 'SKILL.md')), 'the skill is missing');
  assert.ok(
    existsSync(join(base, 'skills', 'graphic-design-api', 'SKILL.md')),
    'the second skill is missing'
  );
  assert.ok(
    existsSync(join(base, 'instructions', 'design-language.instructions.md')),
    'the contract is missing'
  );

  // Under the helper's own folder, so the copy answers to the same
  // `/<helper>:<command>` spelling the plugin gives it.
  const command = join(base, 'commands', 'graphic-designer', 'design-language.md');
  assert.ok(existsSync(command), 'the command did not come along');

  const text = readFileSync(command, 'utf-8');
  assert.ok(
    !text.includes('CLAUDE_PLUGIN_ROOT'),
    'the copied command still names a variable only a loaded plugin defines'
  );

  // And the path it was rewritten to is one that actually exists, so the
  // command's own instructions can be followed as written.
  const analyzer = /node (\S*analyze-media\.mjs)/.exec(text)?.[1];
  assert.ok(analyzer, 'the command no longer names the analyzer');
  assert.ok(existsSync(join(ROOT, analyzer)), `the command points at ${analyzer}, which is not there`);
});
