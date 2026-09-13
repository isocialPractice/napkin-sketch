/**
 * Brand resources: does a design language that says *where* the logo goes get
 * the right logo, and does it still draw a page when there is no logo at all?
 *
 * Three mechanisms meet here and each can fail quietly, which is why they are
 * tested rather than eyeballed:
 *
 * 1. **Reading `resources.md`.** A key spelled `GLOBAL_ASSETS` in one project
 *    and `Global Assets` in the next has to reach the same slot, and a value
 *    that is a domain must not be mistaken for a path.
 * 2. **Inlining a vector.** The rasterizer decodes PNG and nothing else, so an
 *    SVG logo placed as an image is present in the SVG export and missing from
 *    the PNG - the exact kind of defect that passes every check made against
 *    one format. Inlining is what fixes it, and the test reads both.
 * 3. **Falling back.** With no asset configured a brand slot has to draw
 *    something in the design language rather than leaving a hole, and it must
 *    not invent a mark that looks like a real one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  brandMark,
  brandRegion,
  createComposition,
  decodePng,
  descriptorFromFilename,
  detectBrandSlots,
  fitInto,
  inlineSvg,
  normalizeResourceKey,
  parseResources,
  placeBrand,
  renderPng,
  scanBrandBands,
} from '../src/core/graphic-design/index.js';

/** The repository root, found by walking up until this package's manifest. */
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
const ASSETS = join(ROOT, 'test', 'graphic-design-api', 'test-assets');
const REFERENCE = join(ROOT, 'test', 'graphic-design-api', 'reference-graphics', 'created-svg_graphic-api.svg');

const LOGO = readFileSync(join(ASSETS, 'logo.svg'), 'utf-8');

test('a resources list is read into paths, folders and text', () => {
  const parsed = parseResources(`# Brand resources

Prose above the list is ignored, and so is this.

- logo: assets/logo.svg
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
- Tag Line: This or That
- icon: path/to/icon.png

> A note, which is not a declaration.
`);

  assert.equal(parsed.paths.logo, 'assets/logo.svg', 'a file value is a path');
  assert.equal(parsed.directories.globalAssets, 'assets/brand/', 'a folder key is a folder');

  // The distinction that carries the whole format: `example.com` is text to
  // print and `assets/logo.svg` is a file to draw, told apart by the separator.
  assert.equal(parsed.text.domain, 'example.com');
  assert.equal(parsed.text.brandName, 'Acme Corp.');
  assert.equal(parsed.text.tagline, 'This or That', 'Tag Line, tagLine and tagline are one key');
  assert.ok(!parsed.paths.domain, 'a bare domain is not a path');

  // A template value is not a configuration. This is what lets a generated
  // `resources.md` ship with placeholders and still count as unconfigured.
  assert.ok(!parsed.paths.icon, '`path/to/...` is a placeholder, not an asset');
  assert.ok(parsed.notes.some((n) => n.includes('icon')), 'and the report says which line was skipped');
});

test('a fenced example in a resources file is not read as configuration', () => {
  const parsed = parseResources(`Fill it in like this:

\`\`\`md
- logo: assets/example.svg
\`\`\`

- logo: real/logo.svg
`);
  assert.equal(parsed.paths.logo, 'real/logo.svg', 'the fenced example must not win');
  assert.equal(parsed.entries.filter((e) => e.key === 'logo').length, 1);
});

test('keys and file names normalize to the same descriptors', () => {
  for (const spelling of ['GLOBAL_ASSETS', 'Global Assets', 'global-assets', 'globalAssets']) {
    assert.equal(normalizeResourceKey(spelling), 'globalAssets', `${spelling} should be one key`);
  }
  assert.equal(descriptorFromFilename('logo.png'), 'logo');
  assert.equal(descriptorFromFilename('footer.png'), 'footer');
  assert.equal(descriptorFromFilename('logo-mark.svg'), 'logoMark');
});

test('a vector asset is taken apart into shapes a composition can draw', () => {
  const inlined = inlineSvg(LOGO);
  assert.ok(inlined, 'the logo should parse');
  assert.deepEqual(
    { width: Number(inlined.viewBox.width.toFixed(2)), height: Number(inlined.viewBox.height.toFixed(2)) },
    { width: 44.69, height: 23.94 },
    'the viewBox is the asset\'s own coordinate box'
  );
  assert.ok(inlined.elements.length >= 6, `expected the logo's shapes, got ${inlined.elements.length}`);
  assert.deepEqual(inlined.notes, [], 'a logo of solid shapes should translate whole');

  // Colours come from the `<style>` block by class, which is how a design tool
  // writes them - counting only presentation attributes would find none.
  const fills = new Set(inlined.elements.map((el) => (el as { fill?: string | null }).fill));
  assert.ok(fills.has('#fff') || fills.has('#ffffff'), `no white in ${[...fills].join(' ')}`);
  assert.ok(fills.has('#000133'), `no navy in ${[...fills].join(' ')}`);
  assert.ok(fills.has('#4cae50'), `no green in ${[...fills].join(' ')}`);
});

test('an inlined logo is drawn by both renderers, not just the vector one', () => {
  const box = { x: 20, y: 20, width: 160, height: 80 };

  const inlinedPage = createComposition({ width: 200, height: 120, background: '#ffffff' });
  const placed = placeBrand(inlinedPage, box, { kind: 'vector', svg: LOGO }, { name: 'logo' });
  assert.equal(placed.mode, 'vector');

  const render = renderPng(inlinedPage.toDocument(), { scale: 2 });
  assert.deepEqual(render.warnings, [], 'an inlined logo needs no decoder');

  // The failure this guards: the same asset placed as an image data URL is
  // present in the SVG and skipped by the raster, silently, with the reason in
  // `warnings` where nobody looking at the PNG would find it.
  const linkedPage = createComposition({ width: 200, height: 120, background: '#ffffff' });
  linkedPage.image({
    src: `data:image/svg+xml;utf8,${encodeURIComponent(LOGO)}`,
    ...box,
    fit: 'contain',
  });
  const linked = renderPng(linkedPage.toDocument(), { scale: 2 });
  assert.equal(linked.warnings.length, 1, 'a placed SVG should report that it was skipped');
  assert.match(linked.warnings[0], /image skipped/);

  // And the pixels prove it: the inlined page has the logo's green in it, the
  // linked one is blank paper.
  const green = (png: Uint8Array): number => {
    const image = decodePng(png);
    let hits = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i] < 120 && image.data[i + 1] > 140 && image.data[i + 2] < 120) hits++;
    }
    return hits;
  };
  assert.ok(green(render.data) > 500, 'the inlined logo should paint its green');
  assert.equal(green(linked.data), 0, 'the linked one paints nothing');
});

test('a box is fitted without distorting what goes in it', () => {
  const source = { x: 0, y: 0, width: 100, height: 50 };
  const target = { x: 10, y: 10, width: 100, height: 100 };

  const contain = fitInto(source, target, 'contain');
  assert.equal(contain.scale.x, contain.scale.y, 'contain never distorts');
  assert.equal(contain.scale.x, 1);
  assert.deepEqual(contain.translate, { x: 10, y: 35 }, 'and centres what is left over');

  const cover = fitInto(source, target, 'cover');
  assert.equal(cover.scale.x, 2, 'cover fills the box');
  assert.equal(cover.scale.x, cover.scale.y);

  const fill = fitInto(source, target, 'fill');
  assert.notEqual(fill.scale.x, fill.scale.y, 'fill is the one that stretches');
});

test('brand slots are read from the layer names an asset already carries', () => {
  const detection = detectBrandSlots(readFileSync(REFERENCE, 'utf-8'));
  const slot = (key: string) => detection.slots.find((s) => s.key === key);

  assert.ok(slot('logo'), `no logo slot in ${detection.slots.map((s) => s.key).join(', ')}`);
  assert.equal(slot('logo')?.found, 'named', 'a named layer is not a guess');
  assert.equal(slot('logo')?.region, 'top-right');
  assert.ok(slot('logo')!.confidence >= 0.9, 'a name should be trusted more than a scan');

  assert.ok(slot('linkedMedia'), 'the placed-media band should be found');
  assert.equal(slot('linkedMedia')?.region, 'bottom-center');

  // The box is the layer's extent, so it is usable as a slot without further
  // measurement. The logo layer is the same shape as the logo asset itself.
  const box = slot('logo')!.box;
  const aspect = box.width / box.height;
  assert.ok(Math.abs(aspect - 44.69 / 23.94) < 0.05, `slot aspect ${aspect.toFixed(2)} is not the logo's`);
});

test('a file that names nothing says so rather than inventing a slot', () => {
  const detection = detectBrandSlots(
    '<svg viewBox="0 0 100 100"><rect id="Layer_1" width="100" height="100" fill="#eee"/></svg>'
  );
  assert.deepEqual(detection.slots, []);
  assert.ok(detection.notes.some((n) => /named a brand element/.test(n)));
});

test('a raster is scanned a quarter at a time, top first', () => {
  // A mark in the top quarter of an otherwise empty page.
  const page = createComposition({ width: 200, height: 200, background: '#ffffff' });
  page.rect({ x: 20, y: 10, width: 40, height: 24, fill: '#123456' });
  const scan = scanBrandBands(decodePng(renderPng(page.toDocument(), { scale: 1 }).data));

  assert.equal(scan.ground, '#ffffff', 'the ground is what covers the page');
  assert.equal(scan.bands.length, 1, 'the scan stops at the first band that holds a mark');
  assert.equal(scan.slots[0]?.key, 'logo', 'a mark in the top quarter reads as a logo');
  assert.equal(scan.slots[0]?.found, 'scan');
  assert.ok(scan.slots[0]!.confidence < 0.7, 'a scan is never as sure as a name');
  assert.ok(scan.notes.some((n) => /confirm the box/.test(n)), 'a guess has to say it is one');

  // The box is the mark, give or take the sampling.
  const box = scan.slots[0]!.box;
  assert.ok(Math.abs(box.x - 20) <= 2 && Math.abs(box.width - 40) <= 2, `box ${JSON.stringify(box)}`);
});

test('a full-width band is not mistaken for a mark', () => {
  // A header rule spans the page. It is not a logo, and spread is what says so.
  const page = createComposition({ width: 200, height: 200, background: '#ffffff' });
  page.rect({ x: 0, y: 10, width: 200, height: 6, fill: '#123456' });
  const scan = scanBrandBands(decodePng(renderPng(page.toDocument(), { scale: 1 }).data));

  assert.ok(
    !scan.slots.some((s) => s.box.width >= 200),
    'a full-width rule should not be reported as a brand mark'
  );
});

test('a slot with no asset is filled in the design language, not left empty', () => {
  const page = createComposition({ width: 200, height: 100, background: '#ffffff' });
  const box = { x: 20, y: 20, width: 60, height: 60 };

  const nothing = placeBrand(page, box, null);
  assert.equal(nothing.placed, false, 'there is nothing to place');
  assert.equal(page.elements.length, 0, 'and nothing was drawn');

  const mark = brandMark(page, box, { label: 'Acme Corp', accent: '#4cae50', paper: '#ffffff' });
  assert.equal(mark.mode, 'fallback');
  assert.equal(page.elements.length, 2, 'a tile and its letters');

  const letters = page.elements.find((el) => el.type === 'text');
  assert.equal(letters && letters.type === 'text' ? letters.text : '', 'AC', 'initials, not the whole name');

  // Only the language's own colours, so a fallback cannot introduce a colour
  // the design language does not declare.
  for (const element of page.elements) {
    const fill = (element as { fill?: string | null }).fill;
    assert.ok(fill === '#4cae50' || fill === '#ffffff', `unexpected fill ${fill}`);
  }
});

test('a page is divided into the ninths a slot is reported in', () => {
  const page = { width: 360, height: 360 };
  assert.equal(brandRegion({ x: 0, y: 0, width: 40, height: 20 }, page), 'top-left');
  assert.equal(brandRegion({ x: 300, y: 10, width: 40, height: 20 }, page), 'top-right');
  assert.equal(brandRegion({ x: 160, y: 170, width: 40, height: 20 }, page), 'middle-center');
  assert.equal(brandRegion({ x: 20, y: 330, width: 320, height: 20 }, page), 'bottom-center');
});
