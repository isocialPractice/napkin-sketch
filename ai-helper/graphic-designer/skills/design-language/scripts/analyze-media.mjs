/**
 * Reads a media file and reports the design language it was drawn in.
 *
 * Dependency-free and importable, in the shape of the `vectors` plugin's
 * `matlib-script.js`: run it for a report, or import `analyzeMedia` and use the
 * object. It measures what can be measured and says plainly what it cannot,
 * because half of this job belongs to a pair of eyes and the wrong half to
 * guess at.
 *
 *   node analyze-media.mjs <file>              JSON report
 *   node analyze-media.mjs <file> --markdown   the body of a DESIGN_LANGUAGE.md
 *   node analyze-media.mjs <file> --colors 8   how many palette entries to keep
 *   node analyze-media.mjs <file> --brand      only the brand positions
 *
 * What each format gives up:
 *
 * - **SVG** is read as text, so it yields the real answers: the declared
 *   colors, the font families and sizes, the stroke weights, the corner radii,
 *   the page box, and how many of each element there are. This is the richer
 *   input, and when both exist it is the one to trust.
 * - **PNG** is decoded through the napkin-sketch graphic-design API and
 *   quantized into a palette. Colors come back accurately; type, spacing and
 *   structure do not exist in a raster and are not invented here.
 * - **JPEG and GIF** have no decoder in this project, exactly as the
 *   rasterizer has none. The report says so and leaves reading the image to
 *   the model looking at it.
 *
 * It also reports **where the brand sits**. A design language that says which
 * colors a brand uses but not where its logo goes is only half written, and
 * the half it is missing is the one a generated script needs. Two ways in, in
 * this order:
 *
 * 1. **Layer names.** A vector whose layers are called `logo`, `linkedMedia`,
 *    `tagline` or `brandName` has already marked its own slots, and reading
 *    them is exact.
 * 2. **A quarter-by-quarter scan.** Failing a name, the raster is read a
 *    quarter of the page at a time, top first, stopping at the first band that
 *    holds a compact mark. That is a guess, it says so, and its `confidence`
 *    never reaches a name's.
 *
 * Both live in the graphic-design API (`detectBrandSlots`, `scanBrandBands`),
 * not here, so the script that draws the next graphic resolves brand slots
 * with exactly the code that measured them.
 */

import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Media types this script recognises by extension. */
const KINDS = {
  '.svg': 'svg',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
};

/** The kind of media a path names, or `unknown`. */
export function mediaKind(path) {
  return KINDS[extname(path).toLowerCase()] ?? 'unknown';
}

/**
 * Finds the napkin-sketch graphic-design API.
 *
 * Tries the package first, so this works when napkin-sketch is a dependency,
 * then the built output of a clone. Returns null when neither is there, which
 * is a build away from being fixed and worth saying rather than throwing.
 */
async function loadApi() {
  try {
    return await import('napkin-sketch');
  } catch {
    // Not installed as a package; look for a clone's build output instead.
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const built = join(dir, 'dist', 'api', 'index.js');
    if (existsSync(built)) {
      try {
        return await import(`file://${built.replace(/\\/g, '/')}`);
      } catch {
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Normalizes a CSS color to lowercase six-digit hex, or null if it is not one. */
export function normalizeHex(value) {
  const raw = String(value).trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(raw);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(raw);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(raw);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return `#${parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return null;
}

/** The RGB bytes behind a six-digit hex. */
export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Manhattan distance between two hex colors, 0 to 765. */
export function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

/** Relative luminance, 0 to 1, for sorting a palette into ink and paper. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Saturation in HSL terms, 0 to 1, for picking the accent out of a palette. */
export function saturation(hex) {
  const [r, g, b] = hexToRgb(hex).map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** Sorts a counted palette by share and keeps the top `limit`. */
function topColors(counts, total, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex, count]) => ({ hex, share: Number((count / total).toFixed(4)) }));
}

/**
 * Names the roles a palette plays.
 *
 * Paper is the lightest of the two biggest shares, ink the darkest entry with
 * a real share, accent the most saturated of the rest. Rough, and deliberately
 * so: it is a starting point a designer corrects, not a verdict.
 */
export function paletteRoles(palette) {
  if (palette.length === 0) return {};
  const byShare = [...palette].sort((a, b) => b.share - a.share);
  const ground = byShare.slice(0, 2).sort((a, b) => luminance(b.hex) - luminance(a.hex));
  const paper = ground[0]?.hex;
  const ink = [...palette].sort((a, b) => luminance(a.hex) - luminance(b.hex))[0]?.hex;
  const accent = [...palette]
    .filter((c) => c.hex !== paper && c.hex !== ink)
    .sort((a, b) => saturation(b.hex) - saturation(a.hex))[0]?.hex;
  return { paper, ink, accent };
}

/** Unique numbers, ascending, rounded to two decimals. */
function uniqueNumbers(values) {
  return [...new Set(values.map((n) => Number(n.toFixed(2))))].sort((a, b) => a - b);
}

/**
 * Reads an SVG as text.
 *
 * Regex rather than a parser, and that is the right trade here: the job is to
 * count what appears, not to build a tree, and an SVG that a design tool wrote
 * declares most of its style in a `<style>` block the DOM would have to be
 * running to resolve anyway.
 */
export function analyzeSvg(text, limit) {
  const counts = new Map();
  const count = (hex, weight = 1) => counts.set(hex, (counts.get(hex) ?? 0) + weight);

  // A design tool writes its colors once, in a `<style>` block, and then
  // references the class from every element that uses it. Counting the
  // declarations alone would score a color used on one rule the same as one
  // used on two hundred, so map class to color first and weigh by how often
  // each class is actually referenced.
  const classColors = new Map();
  for (const block of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1].matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const fill = /(?:^|[;{\s])fill\s*:\s*([^;}\s]+)/i.exec(rule[2]);
      const stroke = /(?:^|[;{\s])stroke\s*:\s*([^;}\s]+)/i.exec(rule[2]);
      const hex = normalizeHex(fill?.[1] ?? '') ?? normalizeHex(stroke?.[1] ?? '');
      if (hex) classColors.set(rule[1], hex);
    }
  }
  for (const used of text.matchAll(/class\s*=\s*"([^"]*)"/gi)) {
    for (const name of used[1].trim().split(/\s+/)) {
      const hex = classColors.get(name);
      if (hex) count(hex);
    }
  }

  // Colors written straight onto an element, plus - when no class referenced
  // them - the declarations themselves, so a stylesheet-only color still lands
  // in the palette rather than vanishing.
  for (const match of text.matchAll(/(?:^|[\s;"{])(?:fill|stroke|stop-color|flood-color)\s*=\s*"?\s*([^";}\s]+)/gi)) {
    const hex = normalizeHex(match[1]);
    if (hex) count(hex);
  }
  for (const hex of classColors.values()) {
    if (!counts.has(hex)) count(hex);
  }

  const families = new Set();
  for (const match of text.matchAll(/font-family\s*[:=]\s*"?([^";}]+)/gi)) {
    const family = match[1].replace(/["']/g, '').split(',')[0].trim();
    if (family) families.add(family);
  }

  const sizes = [];
  for (const match of text.matchAll(/font-size\s*[:=]\s*"?\s*([\d.]+)/gi)) {
    const size = parseFloat(match[1]);
    if (Number.isFinite(size) && size > 0) sizes.push(size);
  }

  const weights = [];
  for (const match of text.matchAll(/stroke-width\s*[:=]\s*"?\s*([\d.]+)/gi)) {
    const width = parseFloat(match[1]);
    if (Number.isFinite(width) && width > 0) weights.push(width);
  }

  const radii = [];
  for (const match of text.matchAll(/\br[xy]\s*=\s*"\s*([\d.]+)/gi)) {
    const r = parseFloat(match[1]);
    if (Number.isFinite(r) && r > 0) radii.push(r);
  }

  const elements = {};
  for (const match of text.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b/g)) {
    const tag = match[1];
    if (tag === 'svg' || tag === 'defs' || tag === 'style') continue;
    elements[tag] = (elements[tag] ?? 0) + 1;
  }

  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(text);
  const box = viewBox ? viewBox[1].trim().split(/[\s,]+/).map(Number) : null;
  const widthAttr = /\bwidth\s*=\s*"([\d.]+)/i.exec(text);
  const heightAttr = /\bheight\s*=\s*"([\d.]+)/i.exec(text);

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0) || 1;
  return {
    page: {
      width: box && box.length === 4 ? box[2] : widthAttr ? parseFloat(widthAttr[1]) : null,
      height: box && box.length === 4 ? box[3] : heightAttr ? parseFloat(heightAttr[1]) : null,
      units: 'px',
    },
    palette: topColors(counts, total, limit),
    type: {
      families: [...families],
      sizes: uniqueNumbers(sizes),
      measured: true,
    },
    strokeWidths: uniqueNumbers(weights),
    cornerRadii: uniqueNumbers(radii),
    elements,
    notes: [],
  };
}

/**
 * Decodes a PNG and quantizes it into a palette.
 *
 * Colors are bucketed five bits a channel before counting, so a gradient or a
 * run of anti-aliased edge pixels collapses into the color it is a shade of
 * rather than filling the palette with near-duplicates. Pixels under half
 * alpha are skipped: a transparent page is not a color the design chose.
 */
export function analyzePngPixels(image, limit) {
  const buckets = new Map();
  let counted = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 128) continue;
    const key =
      ((image.data[i] >> 3) << 10) | ((image.data[i + 1] >> 3) << 5) | (image.data[i + 2] >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += image.data[i];
      bucket.g += image.data[i + 1];
      bucket.b += image.data[i + 2];
      bucket.n++;
    } else {
      buckets.set(key, { r: image.data[i], g: image.data[i + 1], b: image.data[i + 2], n: 1 });
    }
    counted++;
  }

  // Average each bucket back to a real color rather than to its bucket centre,
  // so the palette reports what was painted and not a rounded stand-in.
  const counts = new Map();
  for (const { r, g, b, n } of buckets.values()) {
    const hex = `#${[r / n, g / n, b / n]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')}`;
    counts.set(hex, (counts.get(hex) ?? 0) + n);
  }

  return {
    page: { width: image.width, height: image.height, units: 'px' },
    palette: topColors(counts, counted || 1, limit),
    type: { families: [], sizes: [], measured: false },
    strokeWidths: [],
    cornerRadii: [],
    elements: {},
    notes: [
      'Type, spacing and structure are not recoverable from a raster; read them off the image, or analyze the vector original.',
    ],
  };
}

/** An empty brand report, for a format that gave nothing to look at. */
const NO_BRAND = { slots: [], notes: [], found: 'none' };

/**
 * Measures an SVG's palette by area rather than by how often it is referenced.
 *
 * The two weightings disagree, and the disagreement matters. A vector palette
 * counts references, so hundreds of small white glyphs outrank one navy field
 * that covers the page - and then the mechanical role guess names white the
 * ground, which is exactly backwards. Area is the evidence a designer means by
 * "the ground", so the asset is inlined, rendered small, and counted by pixel.
 *
 * Deliberately cheap: capped at 480 pixels on the long edge, because the answer
 * wanted is which colour covers the most page, and that survives downsampling.
 * Returns null when the API is missing or the file holds nothing drawable, and
 * the caller falls back to the usage-weighted reading.
 */
async function areaPalette(api, text, limit) {
  if (!api?.inlineSvg || !api?.rasterizeComposition || !api?.createComposition) return null;
  const inlined = api.inlineSvg(text);
  if (!inlined || inlined.elements.length === 0) return null;

  const { width, height } = inlined.viewBox;
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(1, 480 / Math.max(width, height));

  const design = api.createComposition({ width, height, background: null });
  design.group({ origin: { x: 0, y: 0 }, translate: { x: -inlined.viewBox.x, y: -inlined.viewBox.y } }, (g) => {
    g.addAll(inlined.elements);
  });

  const raster = api.rasterizeComposition(design.toDocument(), { scale });
  const report = analyzePngPixels(raster, limit);
  return report.palette.length > 0 ? report.palette : null;
}

/**
 * Finds where the brand sits, by layer name first and by scan second.
 *
 * The mechanism is the graphic-design API's, not this script's. That matters
 * more than it looks: the generated skill resolves its brand slots through the
 * same two functions, so "where the analyzer said the logo goes" and "where
 * the script puts the logo" cannot drift into two different answers.
 */
async function analyzeBrand(api, { svg, pixels }) {
  if (!api?.findBrandSlots) {
    return {
      ...NO_BRAND,
      notes: ['The graphic-design API was not found, so brand positions were not looked for.'],
    };
  }
  const detection = api.findBrandSlots({ svg, pixels });
  const slots = detection.slots.map((slot) => ({
    key: slot.key,
    source: slot.source,
    found: slot.found,
    box: {
      x: Number(slot.box.x.toFixed(2)),
      y: Number(slot.box.y.toFixed(2)),
      width: Number(slot.box.width.toFixed(2)),
      height: Number(slot.box.height.toFixed(2)),
    },
    region: slot.region,
    share: Number(slot.share.toFixed(4)),
    confidence: slot.confidence,
  }));
  return {
    slots,
    notes: detection.notes,
    found: slots.length === 0 ? 'none' : slots.every((s) => s.found === 'named') ? 'named' : 'scan',
  };
}

/**
 * Analyzes one media file.
 *
 * @param {string} path file to read
 * @param {{ colors?: number }} [options]
 * @returns the design language, plus what could not be measured and why
 */
export async function analyzeMedia(path, options = {}) {
  const limit = Math.max(1, options.colors ?? 8);
  const kind = mediaKind(path);
  const stem = basename(path, extname(path));

  if (kind === 'svg') {
    const text = await readFile(path, 'utf-8');
    const report = analyzeSvg(text, limit);
    const api = await loadApi();
    const brand = await analyzeBrand(api, { svg: text });

    // Roles come from area where area can be had. The palette itself stays
    // usage-weighted, because that is what the file declares and what a reader
    // comparing two vectors wants; only the roles change, and the note says so.
    const byArea = await areaPalette(api, text, limit);
    if (byArea) report.areaPalette = byArea;
    return {
      source: basename(path),
      stem,
      kind,
      ...report,
      roles: paletteRoles(byArea ?? report.palette),
      // Which evidence decided the roles. `notes` is reserved for what a file
      // could not say, and this is the opposite - a second measurement, taken
      // because the first one answers a different question.
      roleBasis: byArea ? 'area' : 'usage',
      brand,
    };
  }

  if (kind === 'png') {
    const api = await loadApi();
    if (!api?.decodePng) {
      return {
        source: basename(path),
        stem,
        kind,
        page: { width: null, height: null, units: 'px' },
        palette: [],
        type: { families: [], sizes: [], measured: false },
        strokeWidths: [],
        cornerRadii: [],
        elements: {},
        roles: {},
        brand: {
          ...NO_BRAND,
          notes: ['The graphic-design API was not found, so brand positions were not looked for.'],
        },
        notes: [
          'The graphic-design API was not found, so the PNG was not decoded. Run `npm run build` in a napkin-sketch clone, or install napkin-sketch as a dependency.',
        ],
      };
    }
    const image = api.decodePng(new Uint8Array(await readFile(path)));
    const report = analyzePngPixels(image, limit);
    const brand = await analyzeBrand(api, { pixels: image });
    return { source: basename(path), stem, kind, ...report, roles: paletteRoles(report.palette), brand };
  }

  return {
    source: basename(path),
    stem,
    kind,
    page: { width: null, height: null, units: 'px' },
    palette: [],
    type: { families: [], sizes: [], measured: false },
    strokeWidths: [],
    cornerRadii: [],
    elements: {},
    roles: {},
    brand: {
      ...NO_BRAND,
      notes: ['No decoder for this format, so there was nothing to look for a brand in.'],
    },
    notes: [
      `No decoder here for ${kind === 'unknown' ? extname(path) || 'this file' : kind.toUpperCase()}. Read the image directly, or re-save it as PNG or SVG for measured numbers.`,
    ],
  };
}

/** Renders a report as the body of a `DESIGN_LANGUAGE.md`. */
export function toMarkdown(report) {
  const lines = [];
  const { page, palette, roles, type, strokeWidths, cornerRadii, elements, notes } = report;

  lines.push(`# Design language: ${report.source}`, '');
  lines.push(
    `Measured from \`${report.source}\` (${report.kind.toUpperCase()}). Numbers below are what the file says; anything it could not say is called out at the end.`,
    ''
  );

  lines.push('## Page', '');
  if (page.width && page.height) {
    lines.push(`- ${Number(page.width.toFixed(2))} x ${Number(page.height.toFixed(2))} ${page.units}`, '');
  } else {
    lines.push('- Not recoverable from this file.', '');
  }

  lines.push('## Palette', '');
  if (report.roleBasis === 'area') {
    lines.push(
      'Shares below are how often each colour is **referenced**, which is what the file declares. The **roles** were decided from a different measurement - how much page each colour **covers**, taken by rendering the file - because that is the question "which colour is the ground" actually asks.',
      ''
    );
  }
  if (palette.length > 0) {
    lines.push('| Color | Share | Role |', '| --- | --- | --- |');
    for (const { hex, share } of palette) {
      const role =
        hex === roles.paper ? 'paper' : hex === roles.ink ? 'ink' : hex === roles.accent ? 'accent' : '';
      lines.push(`| \`${hex}\` | ${(share * 100).toFixed(1)}% | ${role} |`);
    }
    lines.push('');
  } else {
    lines.push('- Not measured.', '');
  }

  lines.push('## Type', '');
  if (type.measured && (type.families.length > 0 || type.sizes.length > 0)) {
    if (type.families.length > 0) lines.push(`- Families: ${type.families.map((f) => `\`${f}\``).join(', ')}`);
    if (type.sizes.length > 0) lines.push(`- Sizes: ${type.sizes.join(', ')}`);
    lines.push('');
  } else {
    lines.push('- Not measurable from this format.', '');
  }

  if (strokeWidths.length > 0) lines.push('## Strokes', '', `- Widths: ${strokeWidths.join(', ')}`, '');
  if (cornerRadii.length > 0) lines.push('## Corners', '', `- Radii: ${cornerRadii.join(', ')}`, '');

  const brand = report.brand ?? NO_BRAND;
  lines.push('## Brand positioning', '');
  if (brand.slots.length > 0) {
    lines.push(
      brand.found === 'named'
        ? 'Read from the layer names in the file, so these are the positions the designer marked.'
        : 'Found by scanning the media, not by name. Treat every box below as a candidate and confirm it by eye.',
      ''
    );
    lines.push('| Slot | Region | Box (x, y, w, h) | Page share | How | Confidence |', '| --- | --- | --- | --- | --- | --- |');
    for (const slot of brand.slots) {
      lines.push(
        `| \`${slot.key}\` | ${slot.region} | ${slot.box.x}, ${slot.box.y}, ${slot.box.width}, ${slot.box.height} | ${(slot.share * 100).toFixed(1)}% | ${slot.found} (\`${slot.source}\`) | ${slot.confidence.toFixed(2)} |`
      );
    }
    lines.push(
      '',
      'Each slot is a box a `references/resources.md` can fill. A slot with no asset behind it is drawn as a mark in this language rather than left as a hole.',
      ''
    );
  } else {
    lines.push('- No brand element was found. Say where the logo, the wordmark and the tagline belong; nothing in the file did.', '');
  }
  if (brand.notes.length > 0) lines.push(...brand.notes.map((n) => `- ${n}`), '');

  const tags = Object.entries(elements).sort((a, b) => b[1] - a[1]);
  if (tags.length > 0) {
    lines.push('## Composition', '');
    lines.push(tags.map(([tag, n]) => `- ${n} \`<${tag}>\``).join('\n'), '');
  }

  if (report.areaPalette?.length > 0) {
    lines.push('## Palette by area', '', '| Colour | Page covered |', '| --- | --- |');
    for (const { hex, share } of report.areaPalette) {
      lines.push(`| \`${hex}\` | ${(share * 100).toFixed(1)}% |`);
    }
    lines.push('', 'This is the 60-30-10 to hold the work against. A generated graphic with the right palette and the wrong ratio is the most common way a design language is lost, and only this table catches it.', '');
  }

  if (notes.length > 0) lines.push('## What this file could not say', '', ...notes.map((n) => `- ${n}`), '');

  return lines.join('\n');
}

async function run() {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('analyze-media: give it a file. e.g. node analyze-media.mjs poster.svg --markdown');
    process.exit(1);
  }
  const colorsFlag = args.indexOf('--colors');
  const colors = colorsFlag >= 0 ? Number(args[colorsFlag + 1]) : undefined;
  const report = await analyzeMedia(resolve(path), { colors });
  if (args.includes('--brand')) {
    console.log(JSON.stringify(report.brand, null, 2));
    return;
  }
  console.log(args.includes('--markdown') ? toMarkdown(report) : JSON.stringify(report, null, 2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = resolve(fileURLToPath(import.meta.url));
const sameFile =
  process.platform === 'win32'
    ? invokedPath.toLowerCase() === selfPath.toLowerCase()
    : invokedPath === selfPath;
if (sameFile) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
