/**
 * Graphic-design API tests: one composition, two media, and the variations.
 *
 * The suite proves the two claims the API makes. First, that an SVG and a PNG
 * rendered from one composition are the same graphic - the same page size, the
 * same elements in the same places, the same colours where the design says
 * they are - and that the only difference between the two files is the format
 * they are carried in. Second, that varying the composition varies both
 * outputs together: a new palette moves the colours in the pixels and in the
 * markup, and a moved element moves in both.
 *
 * Everything the suite renders is written to a temporary folder under `.tmp/`
 * and deleted when the suite finishes, so a test run leaves the working tree
 * exactly as it found it. Pass `--keep-graphics` to `npm test` (or set
 * `NAPKIN_KEEP_TEST_GRAPHICS=1`) to keep them and look at them; the path is
 * printed either way.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createComposition,
  decodePng,
  layoutText,
  measureText,
  rasterizeComposition,
  renderComposition,
  renderPng,
  type CompositionDocument,
  type RasterResult,
} from '../src/core/graphic-design/index.js';
import { buildCheatsheet, DEFAULT_LAYOUT, DEFAULT_PALETTE } from './graphic-design-api/cheatsheet.js';

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
const SAMPLES = join(ROOT, 'test', 'graphic-design-api');

/** Where the generated graphics go. Temporary, and removed unless kept. */
const OUTPUT = join(ROOT, '.tmp', 'graphic-design-api');

/**
 * Whether to keep what the suite drew.
 *
 * Off by default - a test that leaves files behind is a test that fails
 * differently the second time it runs. The flag exists because the one thing a
 * graphics test cannot assert is whether the picture looks right, and the
 * answer to that is to open it.
 */
const KEEP_GRAPHICS = /^(1|true|yes)$/i.test(process.env.NAPKIN_KEEP_TEST_GRAPHICS ?? '');

/** The footer mark the placement cases embed, as a data URL. */
function logoDataUrl(): string {
  const bytes = readFileSync(join(SAMPLES, 'links', 'footer.png'));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Reads one pixel out of a raster as `[r, g, b, a]`. */
function pixel(raster: RasterResult, x: number, y: number): [number, number, number, number] {
  const i = (Math.round(y) * raster.width + Math.round(x)) * 4;
  return [raster.data[i], raster.data[i + 1], raster.data[i + 2], raster.data[i + 3]];
}

/** Parses `#rrggbb` into the bytes a raster holds. */
function hex(color: string): [number, number, number] {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

/** Asserts a pixel is the expected colour, allowing for rounding. */
function assertPixel(
  raster: RasterResult,
  x: number,
  y: number,
  color: string,
  message: string,
): void {
  const [r, g, b, a] = pixel(raster, x, y);
  const [er, eg, eb] = hex(color);
  assert.ok(a > 250, `${message}: expected an opaque pixel at ${x},${y}, alpha was ${a}`);
  const distance = Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb);
  assert.ok(
    distance <= 3,
    `${message}: expected ${color} at ${x},${y}, got rgb(${r}, ${g}, ${b})`,
  );
}

/** Saves a rendered pair into the temporary folder. */
async function writePair(name: string, doc: CompositionDocument): Promise<{ svg: string; png: string }> {
  const svgPath = join(OUTPUT, `${name}.svg`);
  const pngPath = join(OUTPUT, `${name}.png`);
  await writeFile(svgPath, renderComposition(doc) as string, 'utf8');
  await writeFile(pngPath, renderPng(doc).data);
  return { svg: svgPath, png: pngPath };
}

before(async () => {
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
});

after(async () => {
  if (KEEP_GRAPHICS) {
    console.log(`graphic-design-api: generated graphics kept in ${OUTPUT}`);
    return;
  }
  await rm(OUTPUT, { recursive: true, force: true });
});

test('a composition defaults to a 360 by 360 pixel page', () => {
  const design = createComposition();
  const doc = design.toDocument();
  assert.equal(doc.width, 360);
  assert.equal(doc.height, 360);
  assert.equal(doc.units, 'px');
  assert.equal(doc.useGuiCanvas, false, 'the API is headless unless it is told otherwise');

  const svg = design.toSVG();
  assert.match(svg, /viewBox="0 0 360 360"/);
  assert.match(svg, /width="360"/);

  const raster = design.rasterize();
  assert.equal(raster.width, 360);
  assert.equal(raster.height, 360);
});

test('a named size and unit carry through to both formats', () => {
  const design = createComposition({ width: 100, height: 50, units: 'mm', background: '#ffffff' });
  assert.match(design.toSVG(), /width="100mm" height="50mm" viewBox="0 0 100 50"/);

  // Millimetres convert through the CSS reference of 96 pixels to the inch,
  // the same ratio the SVG and PDF exports assume.
  const raster = design.rasterize();
  assert.equal(raster.width, Math.round((100 * 96) / 25.4));
  assert.equal(raster.height, Math.round((50 * 96) / 25.4));
});

test('every simple element reaches both renderers', () => {
  const design = createComposition({ width: 200, height: 200, background: '#ffffff' });
  design.rect({ x: 10, y: 10, width: 40, height: 30, rx: 6, fill: '#326478' });
  design.circle({ cx: 100, cy: 30, r: 15, fill: '#4cae50' });
  design.ellipse({ cx: 160, cy: 30, rx: 24, ry: 12, fill: '#fdc83a' });
  design.triangle({ x: 10, y: 60, width: 40, height: 34, fill: '#8ce632' });
  design.polygon({
    points: [
      { x: 80, y: 60 },
      { x: 120, y: 70 },
      { x: 110, y: 96 },
      { x: 76, y: 90 },
    ],
    fill: '#b4bec8',
  });
  design.polyline({
    points: [
      { x: 140, y: 60 },
      { x: 160, y: 92 },
      { x: 184, y: 64 },
    ],
    fill: null,
    stroke: '#000133',
    strokeWidth: 3,
  });
  design.line({ x1: 10, y1: 110, x2: 190, y2: 110, stroke: '#414042', strokeWidth: 2 });
  design.path({ d: 'M 20 130 C 60 110, 100 170, 140 130', fill: null, stroke: '#dc143c', strokeWidth: 3 });
  design.text({ x: 20, y: 180, text: 'Acme Corp', fontSize: 18, fill: '#000133' });

  const svg = design.toSVG();
  for (const tag of ['rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'path', 'text']) {
    assert.match(svg, new RegExp(`<${tag}[ >]`), `the SVG should carry a <${tag}>`);
  }

  const raster = design.rasterize();
  assertPixel(raster, 30, 25, '#326478', 'rect');
  assertPixel(raster, 100, 30, '#4cae50', 'circle');
  assertPixel(raster, 160, 30, '#fdc83a', 'ellipse');
  assertPixel(raster, 30, 90, '#8ce632', 'triangle');
  assertPixel(raster, 100, 78, '#b4bec8', 'polygon');
  assertPixel(raster, 10, 110, '#414042', 'line');
  assertPixel(raster, 5, 5, '#ffffff', 'the page background');
});

test('rotation turns an element about its own centre', () => {
  const design = createComposition({ width: 120, height: 120, background: '#ffffff' });
  design.rect({ x: 40, y: 55, width: 40, height: 10, fill: '#326478', rotate: 90 });

  // A bar turned a quarter turn about its middle is vertical through the same
  // centre, so the pixels swap axes and the centre itself does not move.
  const raster = design.rasterize();
  assertPixel(raster, 60, 60, '#326478', 'the centre stays put');
  assertPixel(raster, 60, 45, '#326478', 'and the bar now runs vertically');
  assertPixel(raster, 45, 60, '#ffffff', 'where it used to run');
  assert.match(design.toSVG(), /transform="matrix\(/);
});

test('a group transform composes with its children', () => {
  const design = createComposition({ width: 120, height: 120, background: '#ffffff' });
  design.group({ translate: { x: 40, y: 0 } }, (g) => {
    g.rect({ x: 10, y: 50, width: 20, height: 20, fill: '#4cae50' });
  });

  const raster = design.rasterize();
  assertPixel(raster, 60, 60, '#4cae50', 'the child moved with its group');
  assertPixel(raster, 20, 60, '#ffffff', 'and left where it was declared');
});

test('a dashed stroke leaves the gaps it asks for', () => {
  const design = createComposition({ width: 120, height: 40, background: '#ffffff' });
  design.line({
    x1: 0,
    y1: 20,
    x2: 120,
    y2: 20,
    stroke: '#000133',
    strokeWidth: 6,
    dash: [10, 10],
  });

  assert.match(design.toSVG(), /stroke-dasharray="10 10"/);
  const raster = design.rasterize();
  assertPixel(raster, 4, 20, '#000133', 'the first dash');
  assertPixel(raster, 15, 20, '#ffffff', 'the first gap');
  assertPixel(raster, 24, 20, '#000133', 'the second dash');
});

test('the even-odd rule punches what nonzero would union', () => {
  const ring = [
    // An outer square and an inner square, wound the same way.
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ];
  const inner = [
    { x: 30, y: 30 },
    { x: 70, y: 30 },
    { x: 70, y: 70 },
    { x: 30, y: 70 },
  ];
  const path = `M ${ring.map((p) => `${p.x} ${p.y}`).join(' L ')} Z M ${inner
    .map((p) => `${p.x} ${p.y}`)
    .join(' L ')} Z`;

  const design = createComposition({ width: 100, height: 100, background: '#ffffff' });
  design.path({ d: path, fill: '#326478', fillRule: 'evenodd' });

  const raster = design.rasterize();
  assertPixel(raster, 20, 50, '#326478', 'the ring is painted');
  assertPixel(raster, 50, 50, '#ffffff', 'and the hole is not');
  assert.match(design.toSVG(), /fill-rule="evenodd"/);
});

test('opacity multiplies down through a group', () => {
  const design = createComposition({ width: 40, height: 40, background: '#ffffff' });
  design.group({ opacity: 0.5 }, (g) => {
    g.rect({ x: 0, y: 0, width: 40, height: 40, fill: '#000000', opacity: 0.5 });
  });

  // Half of a half over white leaves three quarters of the white showing.
  const [r, g, b] = pixel(design.rasterize(), 20, 20);
  assert.ok(Math.abs(r - 191) <= 2 && Math.abs(g - 191) <= 2 && Math.abs(b - 191) <= 2, `got rgb(${r}, ${g}, ${b})`);
});

test('a clipping mask keeps what is inside it and drops the rest', () => {
  const design = createComposition({ width: 120, height: 120, background: '#ffffff' });
  design.defineClip('badge', { type: 'circle', cx: 60, cy: 60, r: 30 });
  design.rect({ x: 0, y: 0, width: 120, height: 120, fill: '#326478', clip: 'badge' });

  assert.match(design.toSVG(), /<clipPath id="badge"/);
  assert.match(design.toSVG(), /clip-path="url\(#badge\)"/);

  const raster = design.rasterize();
  assertPixel(raster, 60, 60, '#326478', 'inside the mask');
  assertPixel(raster, 8, 8, '#ffffff', 'outside the mask');
});

test('an inline clip shape is promoted to a clipPath of its own', () => {
  const design = createComposition({ width: 120, height: 120, background: '#ffffff' });
  design.rect({
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    fill: '#4cae50',
    clip: { type: 'rect', x: 30, y: 30, width: 60, height: 60 },
  });

  const svg = design.toSVG();
  assert.match(svg, /<clipPath id="clip-inline-1"/);
  assert.match(svg, /clip-path="url\(#clip-inline-1\)"/);

  const raster = design.rasterize();
  assertPixel(raster, 60, 60, '#4cae50', 'inside the inline mask');
  assertPixel(raster, 10, 60, '#ffffff', 'outside the inline mask');
});

test('text layout is one decision both formats read', () => {
  const design = createComposition({ width: 240, height: 120, background: '#ffffff' });
  const copy = 'Jane Doe sorts the array, then prints what the sort decided.';
  design.text({
    x: 120,
    y: 20,
    text: copy,
    fontSize: 12,
    maxWidth: 200,
    align: 'center',
    fill: '#000133',
  });

  const layout = layoutText(copy, {
    x: 120,
    y: 20,
    fontSize: 12,
    lineHeight: 1.2,
    align: 'center',
    baseline: 'alphabetic',
    maxWidth: 200,
  });
  assert.ok(layout.lines.length > 1, 'the copy should wrap at 200 units');

  const svg = design.toSVG();
  const spans = svg.match(/<tspan /g) ?? [];
  assert.equal(spans.length, layout.lines.length, 'one tspan per laid-out line');
  for (const line of layout.lines) {
    assert.ok(
      svg.includes(`y="${Number(line.y.toFixed(3))}"`),
      `the SVG should place a line on the shared baseline ${line.y}`,
    );
    assert.ok(measureText(line.text, { fontSize: 12 }) <= 200, 'no line exceeds the wrap width');
  }

  // The same layout drew the pixels, so ink lands on the measured baselines.
  const raster = design.rasterize();
  const inked = (y: number): boolean => {
    for (let x = 0; x < raster.width; x++) {
      const [r, g, b] = pixel(raster, x, y);
      if (r + g + b < 600) return true;
    }
    return false;
  };
  assert.ok(inked(layout.lines[0].y - 3), 'the first line should have ink above its baseline');
  assert.ok(!inked(layout.lines[0].y + 4), 'and nothing below its descender');
});

test('a placed PNG is decoded, fitted and clipped', () => {
  // The asset is a 752 by 51 footer strip whose left end carries a dark mark,
  // so a mask over that end is a placement whose result can be asserted.
  const design = createComposition({ width: 240, height: 120, background: '#ffffff' });
  design.defineClip('mark', { type: 'rect', x: 0, y: 52, width: 40, height: 16 });
  design.image({
    src: logoDataUrl(),
    x: 0,
    y: 52,
    width: 240,
    height: 16,
    fit: 'fill',
    clip: 'mark',
    alt: 'Site mark',
  });

  const svg = design.toSVG();
  assert.match(svg, /<image /);
  assert.match(svg, /xlink:href="data:image\/png;base64,/);
  assert.match(svg, /<title>Site mark<\/title>/);

  const raster = design.rasterize({});
  assert.deepEqual(raster.warnings, [], 'a PNG data URL needs no external decoder');
  assertPixel(raster, 200, 60, '#ffffff', 'outside the mask the page shows through');

  // Inside the mask the image itself is drawn, so pixels there differ from the
  // page it was placed on.
  let painted = 0;
  for (let y = 52; y < 68; y++) {
    for (let x = 0; x < 40; x++) {
      const [r, g, b] = pixel(raster, x, y);
      if (r + g + b < 600) painted++;
    }
  }
  assert.ok(painted > 0, 'the placed image should mark the page inside its mask');
});

test('an image in a format the rasterizer cannot open is reported, not fatal', () => {
  const design = createComposition({ width: 60, height: 60, background: '#ffffff' });
  design.image({ src: 'data:image/jpeg;base64,/9j/4AAQ', x: 0, y: 0, width: 60, height: 60 });
  design.rect({ x: 10, y: 10, width: 20, height: 20, fill: '#4cae50' });

  const raster = design.rasterize();
  assert.equal(raster.warnings.length, 1);
  assert.match(raster.warnings[0], /image skipped/);
  assertPixel(raster, 20, 20, '#4cae50', 'the rest of the composition still draws');
});

test('the reference composition renders to matching graphics', async () => {
  const design = buildCheatsheet({ logo: logoDataUrl() });
  const doc = design.toDocument();
  const files = await writePair('reference', doc);

  const svg = readFileSync(files.svg, 'utf-8');
  const png = readFileSync(files.png);
  assert.ok(statSync(files.svg).size > 0 && png.length > 0, 'both files should carry bytes');

  // Same page, said two ways.
  assert.match(svg, /viewBox="0 0 360 360"/);
  const decoded = decodePng(png);
  assert.equal(decoded.width, 360);
  assert.equal(decoded.height, 360);

  // Same colours, in the same places. The SVG names them in attributes and the
  // PNG carries them as pixels; both come off the one document.
  const raster = rasterizeComposition(doc);
  assert.deepEqual(raster.warnings, []);
  assertPixel(raster, 8, 100, DEFAULT_PALETTE.page, 'the page');
  assertPixel(raster, 24, 55, DEFAULT_PALETTE.paper, 'the heading plate');
  assertPixel(raster, 19, DEFAULT_LAYOUT.panelY + 40, DEFAULT_PALETTE.accent, 'the panel margin');
  assertPixel(raster, 330, DEFAULT_LAYOUT.panelY + 90, DEFAULT_PALETTE.panel, 'the code panel');
  assertPixel(raster, 300, DEFAULT_LAYOUT.footerY + 8, DEFAULT_PALETTE.paper, 'the footer bar');

  for (const color of [DEFAULT_PALETTE.page, DEFAULT_PALETTE.accent, DEFAULT_PALETTE.paper]) {
    assert.ok(svg.includes(color), `the SVG should paint with ${color} too`);
  }

  // The pixels a decoded PNG gives back are the pixels the rasterizer drew, so
  // the file round-trips rather than merely being written.
  const index = (60 * 360 + 8) * 4;
  assert.deepEqual(
    [decoded.data[index], decoded.data[index + 1], decoded.data[index + 2]],
    [...hex(DEFAULT_PALETTE.page)],
  );
});

test('rendering the same composition twice produces identical files', async () => {
  const doc = buildCheatsheet({ logo: logoDataUrl() }).toDocument();
  const first = renderPng(doc).data;
  const second = renderPng(doc).data;
  assert.deepEqual(Buffer.from(first), Buffer.from(second), 'the PNG should be deterministic');
  assert.equal(renderComposition(doc), renderComposition(doc), 'and so should the SVG');

  await writePair('determinism', doc);
});

test('the two formats differ only in the media they are carried in', async () => {
  const doc = buildCheatsheet({ logo: logoDataUrl() }).toDocument();
  const svg = renderComposition(doc, { format: 'svg' }) as string;
  const png = renderComposition(doc, { format: 'png' }) as Uint8Array;

  assert.equal(typeof svg, 'string');
  assert.ok(png instanceof Uint8Array);
  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const decoded = decodePng(png);
  assert.equal(`${decoded.width} ${decoded.height}`, '360 360');
  assert.match(svg, new RegExp(`viewBox="0 0 ${doc.width} ${doc.height}"`));

  await writePair('formats', doc);
});

test('a variation in palette moves the colour in both formats', async () => {
  const palette = { page: '#2b0b3f', accent: '#ff7f50', paper: '#fffff0' };
  const design = buildCheatsheet({ logo: logoDataUrl(), palette });
  const doc = design.toDocument();
  await writePair('variation-palette', doc);

  const raster = rasterizeComposition(doc);
  assertPixel(raster, 8, 100, palette.page, 'the varied page');
  assertPixel(raster, 19, DEFAULT_LAYOUT.panelY + 40, palette.accent, 'the varied accent');
  assertPixel(raster, 24, 55, palette.paper, 'the varied paper');

  const svg = design.toSVG();
  for (const color of Object.values(palette)) {
    assert.ok(svg.includes(color), `the SVG should carry the varied ${color}`);
  }
  assert.ok(!svg.includes(DEFAULT_PALETTE.page), 'and should not carry the colour it replaced');

  // The page is the same size and holds the same elements; only paint changed.
  const original = rasterizeComposition(buildCheatsheet({ logo: logoDataUrl() }).toDocument());
  assert.equal(raster.width, original.width);
  assert.equal(raster.height, original.height);
});

test('a variation in position moves the element in both formats', async () => {
  const moved = { panelY: DEFAULT_LAYOUT.panelY + 34, footerY: DEFAULT_LAYOUT.footerY };
  const design = buildCheatsheet({ logo: logoDataUrl(), layout: moved });
  const doc = design.toDocument();
  await writePair('variation-layout', doc);

  const raster = rasterizeComposition(doc);
  assertPixel(raster, 19, DEFAULT_LAYOUT.panelY + 4, DEFAULT_PALETTE.page, 'where the panel was');
  assertPixel(raster, 19, moved.panelY + 40, DEFAULT_PALETTE.accent, 'where the panel now is');

  const svg = design.toSVG();
  assert.ok(svg.includes(`y="${moved.panelY}"`), 'the SVG should place the panel at its new y');
  assert.ok(
    !svg.includes(`<rect id="panel-plate" x="32" y="${DEFAULT_LAYOUT.panelY}"`),
    'and not at the old one',
  );
});

test('a variation in both palette and position still renders one graphic', async () => {
  const design = buildCheatsheet({
    logo: logoDataUrl(),
    palette: { page: '#123456', accent: '#ffd700', panel: '#1b2a4a' },
    layout: { panelY: 128, badge: { x: 260, y: 24 }, footerY: 310 },
  });
  const doc = design.toDocument();
  const files = await writePair('variation-both', doc);

  const decoded = decodePng(readFileSync(files.png));
  assert.equal(decoded.width, 360);
  assert.equal(decoded.height, 360);

  const raster = rasterizeComposition(doc);
  assertPixel(raster, 8, 100, '#123456', 'the varied page');
  assertPixel(raster, 19, 168, '#ffd700', 'the varied, moved accent');
  assertPixel(raster, 300, 308, '#ffd700', 'the footer rule at its new height');
});

test('rendering at a higher scale keeps the same graphic on more pixels', () => {
  const doc = buildCheatsheet().toDocument();
  const raster = rasterizeComposition(doc, { scale: 2 });
  assert.equal(raster.width, 720);
  assert.equal(raster.height, 720);
  assertPixel(raster, 16, 200, DEFAULT_PALETTE.page, 'the page, at twice the size');
  assertPixel(raster, 38, (DEFAULT_LAYOUT.panelY + 40) * 2, DEFAULT_PALETTE.accent, 'the margin, doubled');
});

test('the generated graphics are temporary files', () => {
  // Everything written above lands in one folder that the suite removes on the
  // way out, unless it was asked to keep it.
  assert.ok(existsSync(OUTPUT), 'the output folder exists while the suite runs');
  for (const name of ['reference', 'formats', 'variation-palette', 'variation-layout']) {
    assert.ok(existsSync(join(OUTPUT, `${name}.svg`)), `${name}.svg was written`);
    assert.ok(existsSync(join(OUTPUT, `${name}.png`)), `${name}.png was written`);
  }
  assert.ok(OUTPUT.includes('.tmp'), 'and it sits under the ignored .tmp folder');
});
