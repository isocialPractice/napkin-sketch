/**
 * The generated skill: does a graphic drawn from a captured design language
 * stay in that language?
 *
 * The graphic-designer helper reads an asset, writes down its design language,
 * and generates a skill with a script that draws new work in it. Everything
 * after that generation is ordinary deterministic code, so this suite needs no
 * model: it renders eight variations through the frozen fixture in
 * `graphic-design-api/generated-skill/` and measures them. Cost is one Node
 * subprocess and about two seconds.
 *
 * Four defects were found by eye while that skill was being built, and each one
 * has a standard here that fails without its fix:
 *
 * 1. A missing paper footer put 83% ground against the source's 56%.
 * 2. The last code row rendered underneath the footer band.
 * 3. Code tokens overlapped in the SVG - advanced by `measureText`, which
 *    reports the built-in alphabet, while the SVG named Courier New.
 * 4. The PNG was unreadable - a 6-unit glyph's stroke is under a device pixel
 *    at 1x, so the code panel anti-aliased into grey texture.
 *
 * Defects 3 and 4 are why this suite reads each format on its own terms. The
 * overlap is invisible in the raster, which is drawn in the very font that was
 * measured; the mush is invisible in the vector. A check against one output
 * would have passed both.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { decodePng, measureText, type RgbaImage } from '../src/core/graphic-design/index.js';

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
const FIXTURE = join(ROOT, 'test', 'graphic-design-api', 'generated-skill');
const OUTPUT = join(ROOT, '.tmp', 'generated-skill');

/** Kept only when asked, the same flag the graphic-design suite reads. */
const KEEP_GRAPHICS = /^(1|true|yes)$/i.test(process.env.NAPKIN_KEEP_TEST_GRAPHICS ?? '');

/** The page the design language declares, before any raster scale. */
const PAGE = { width: 360, height: 360 };

/** The design language, as `DESIGN_LANGUAGE.md` records it. */
const LANGUAGE = {
  ground: '#000133',
  paper: '#ffffff',
  accent: '#4cae50',
  ink: '#414042',
};

/** Reserved for code tokens inside the panel, and for nothing structural. */
const SYNTAX = ['#8ce632', '#fdc83a', '#f8f5ae', '#b4bec8', '#aef8b7'];

/** Every colour the language permits anywhere in the document. */
const DECLARED = new Set([...Object.values(LANGUAGE), ...SYNTAX, 'none']);

/** The 1.250 major third the language is set on. */
const TYPE_SCALE = new Set([20.5, 16.5, 7.5, 6]);

/** The two stroke weights, plus the hairline the panel outline uses. */
const STROKE_WEIGHTS = new Set([1, 2, 4.5]);

/**
 * Share bands for the three roles.
 *
 * Drawn around eight measured variations (ground 68.5 to 71.3, paper 22.4 to
 * 24.3, accent 2.8 to 4.2) and widened well past them, so a deliberate design
 * change does not fail while a broken one does. The missing-footer defect
 * measured 83 / 11 / 2.5, which is outside two of the three.
 */
const BANDS = {
  ground: [50, 80],
  paper: [12, 35],
  accent: [1, 10],
};

/** Advance of one monospace character, as a fraction of the font size. */
const MONO_ADVANCE = 0.6;

/** Every variation the driver renders, and the raster scale each used. */
const VARIATIONS = [
  'baseline',
  'long-rows',
  'short-rows',
  'long-title',
  'long-heading',
  'wide-tokens',
  'card',
] as const;

/** The negative control: expected to fail the legibility standard. */
const ILLEGIBLE = 'raster-1x';

const SCALE = 3;

// --- measuring ------------------------------------------------------------

/** Manhattan distance between two `#rrggbb` colours, 0 to 765. */
function colorDistance(a: string, b: string): number {
  const bytes = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = bytes(a);
  const [r2, g2, b2] = bytes(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

/** Relative luminance, for a contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Quantizes a decoded raster into a palette with shares.
 *
 * Five bits a channel before counting, so anti-aliased edges collapse into the
 * colour they are a shade of instead of filling the palette with near
 * duplicates. The same method the helper's analyzer uses, so the numbers here
 * and the numbers a user reads from the CLI mean the same thing.
 */
function palette(image: RgbaImage, limit = 8): Array<{ hex: string; share: number }> {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
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

  const counts = new Map<string, number>();
  for (const { r, g, b, n } of buckets.values()) {
    const hex = `#${[r / n, g / n, b / n]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')}`;
    counts.set(hex, (counts.get(hex) ?? 0) + n);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex, n]) => ({ hex, share: n / (counted || 1) }));
}

/** The share of a role colour, matched within tolerance. */
function shareOf(entries: Array<{ hex: string; share: number }>, role: string): number {
  return entries
    .filter((c) => colorDistance(c.hex, role) <= 24)
    .reduce((sum, c) => sum + c.share, 0);
}

/** One positioned run of text, as the SVG declares it. */
interface Run {
  x: number;
  y: number;
  text: string;
  family: string;
  size: number;
  letterSpacing: number;
}

/** What the suite reads back out of a rendered SVG. */
interface Parsed {
  viewBox: string;
  paints: string[];
  fontSizes: number[];
  strokeWidths: number[];
  runs: Run[];
  boxes: Array<{ x: number; y: number; width: number; height: number }>;
}

/** Unescapes the five entities the writer escapes. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Reads the geometry and paint a rendered SVG declares. */
function parseSvg(text: string): Parsed {
  const attr = (source: string, name: string): string | null =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(source)?.[1] ?? null;

  const paints: string[] = [];
  for (const match of text.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) paints.push(match[1]);

  const fontSizes = [...text.matchAll(/\bfont-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  const strokeWidths = [...text.matchAll(/\bstroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));

  const boxes = [...text.matchAll(/<rect\b([^>]*)\/>/g)].map((m) => ({
    x: Number(attr(m[1], 'x') ?? 0),
    y: Number(attr(m[1], 'y') ?? 0),
    width: Number(attr(m[1], 'width') ?? 0),
    height: Number(attr(m[1], 'height') ?? 0),
  }));

  const runs: Run[] = [];
  for (const element of text.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const head = element[1];
    const family = attr(head, 'font-family') ?? '';
    const size = Number(attr(head, 'font-size') ?? 0);
    const letterSpacing = Number(attr(head, 'letter-spacing') ?? 0);
    for (const span of element[2].matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)) {
      runs.push({
        x: Number(attr(span[1], 'x') ?? 0),
        y: Number(attr(span[1], 'y') ?? 0),
        text: unescapeXml(span[2]),
        family,
        size,
        letterSpacing,
      });
    }
  }

  return { viewBox: attr(text, 'viewBox') ?? '', paints, fontSizes, strokeWidths, runs, boxes };
}

/**
 * How wide a run will actually be when a viewer renders it.
 *
 * This is the whole of defect 3 in one function. `measureText` reports the
 * API's built-in alphabet, which is what the rasterizer draws and therefore the
 * right answer for a run with no declared family. A run that names a monospace
 * family is drawn in *that* font, which advances a flat 0.6 em per character -
 * wider than the built-in alphabet by up to 10 units on a 6-unit line. Asking
 * `measureText` about it would reproduce the bug rather than catch it.
 */
function renderedWidth(run: Run): number {
  if (/mono|courier/i.test(run.family)) {
    return run.text.length * (run.size * MONO_ADVANCE + run.letterSpacing);
  }
  return measureText(run.text, { fontSize: run.size, letterSpacing: run.letterSpacing });
}

// --- fixtures -------------------------------------------------------------

function svgOf(name: string): Parsed {
  return parseSvg(readFileSync(join(OUTPUT, `${name}.svg`), 'utf-8'));
}

function pngOf(name: string): RgbaImage {
  return decodePng(new Uint8Array(readFileSync(join(OUTPUT, `${name}.png`))));
}

before(() => {
  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });
  execFileSync(process.execPath, [join(FIXTURE, 'render-variations.mjs'), OUTPUT], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
});

after(() => {
  if (KEEP_GRAPHICS) {
    console.log(`generated-skill: variations kept in ${OUTPUT}`);
    return;
  }
  rmSync(OUTPUT, { recursive: true, force: true });
});

// --- tier 1: structural ---------------------------------------------------

test('tier 1: every variation renders a page of the declared size', () => {
  for (const name of VARIATIONS) {
    const image = pngOf(name);
    assert.equal(image.width, PAGE.width * SCALE, `${name}: raster width`);
    assert.equal(image.height, PAGE.height * SCALE, `${name}: raster height`);
    assert.equal(svgOf(name).viewBox, `0 0 ${PAGE.width} ${PAGE.height}`, `${name}: viewBox`);
  }
});

test('tier 1: the same document renders identically twice', () => {
  const a = readFileSync(join(OUTPUT, 'determinism-a.png'));
  const b = readFileSync(join(OUTPUT, 'determinism-b.png'));
  assert.deepEqual(a, b, 'two renders of one composition differ');
});

test('tier 1: no variation is blank, and none is a solid field', () => {
  for (const name of VARIATIONS) {
    const entries = palette(pngOf(name), 12).filter((c) => c.share >= 0.005);
    assert.ok(entries.length >= 4, `${name}: only ${entries.length} colours carry the page`);
    assert.ok(
      entries[0].share <= 0.9,
      `${name}: ${entries[0].hex} covers ${(entries[0].share * 100).toFixed(1)}% of the page`
    );
  }
});

// --- tier 2: language conformance ----------------------------------------

test('tier 2: the three roles are present, in their share bands', () => {
  for (const name of VARIATIONS) {
    const entries = palette(pngOf(name), 12);
    for (const [role, hex] of [
      ['ground', LANGUAGE.ground],
      ['paper', LANGUAGE.paper],
      ['accent', LANGUAGE.accent],
    ] as const) {
      const share = shareOf(entries, hex) * 100;
      const [low, high] = BANDS[role];
      assert.ok(
        share >= low && share <= high,
        `${name}: ${role} ${hex} is ${share.toFixed(1)}%, outside ${low}-${high}%`
      );
    }
  }
});

test('tier 2: no colour is painted that the language does not declare', () => {
  // The guard against a script inventing a plate colour, and the reason the
  // planned palette-swap variation was not needed: a hard-coded fill shows up
  // here directly rather than by inference from a swap.
  for (const name of VARIATIONS) {
    for (const paint of svgOf(name).paints) {
      assert.ok(
        DECLARED.has(paint.toLowerCase()),
        `${name}: ${paint} is painted but the design language does not declare it`
      );
    }
  }
});

test('tier 2: every type size is on the scale, every stroke on the weights', () => {
  for (const name of VARIATIONS) {
    const { fontSizes, strokeWidths } = svgOf(name);
    for (const size of fontSizes) {
      assert.ok(TYPE_SCALE.has(size), `${name}: ${size} is not on the 1.250 scale`);
    }
    for (const width of strokeWidths) {
      assert.ok(STROKE_WEIGHTS.has(width), `${name}: stroke-width ${width} is not a declared weight`);
    }
  }
});

// --- tier 3: legibility and containment ----------------------------------

test('tier 3: the palette clears WCAG where the language puts text', () => {
  assert.ok(
    contrast(LANGUAGE.paper, LANGUAGE.ground) >= 4.5,
    'paper on ground fails body-text contrast'
  );
  assert.ok(contrast(LANGUAGE.ink, LANGUAGE.paper) >= 4.5, 'ink on paper fails body-text contrast');
  for (const token of SYNTAX) {
    const ratio = contrast(token, LANGUAGE.ground);
    assert.ok(ratio >= 3, `syntax ${token} on ground is ${ratio.toFixed(1)}:1, under 3:1`);
  }
});

test('tier 3: nothing is drawn outside the page', () => {
  for (const name of VARIATIONS) {
    const { runs, boxes } = svgOf(name);
    for (const box of boxes) {
      assert.ok(box.x >= 0 && box.y >= 0, `${name}: a rect starts off-page at ${box.x},${box.y}`);
      assert.ok(
        box.x + box.width <= PAGE.width + 0.01 && box.y + box.height <= PAGE.height + 0.01,
        `${name}: a rect runs off-page to ${box.x + box.width},${box.y + box.height}`
      );
    }
    for (const run of runs) {
      const right = run.x + renderedWidth(run);
      assert.ok(
        run.x >= 0 && right <= PAGE.width + 0.5,
        `${name}: "${run.text.trim()}" runs to ${right.toFixed(1)}, past the ${PAGE.width} edge`
      );
      assert.ok(run.y > 0 && run.y <= PAGE.height, `${name}: a baseline sits at ${run.y}`);
    }
  }
});

test('tier 3: code rows stay inside the panel they belong to', () => {
  // Defect 2: the last row rendered underneath the footer band. The footer is
  // the bottom 48 units, so any monospace baseline below its top edge is a row
  // that has escaped the panel.
  const footerTop = PAGE.height - 48;
  for (const name of VARIATIONS) {
    for (const run of svgOf(name).runs) {
      if (!/mono|courier/i.test(run.family)) continue;
      assert.ok(
        run.y < footerTop,
        `${name}: code row "${run.text.trim()}" sits at ${run.y}, under the footer at ${footerTop}`
      );
    }
  }
});

test('tier 3: no two runs on a baseline overlap in the font the SVG names', () => {
  // Defect 3, and the reason this measures with the declared family's metric
  // rather than with measureText - see renderedWidth.
  for (const name of VARIATIONS) {
    const byBaseline = new Map<number, Run[]>();
    for (const run of svgOf(name).runs) {
      const key = Math.round(run.y * 100) / 100;
      byBaseline.set(key, [...(byBaseline.get(key) ?? []), run]);
    }

    for (const [baseline, runs] of byBaseline) {
      const ordered = [...runs].sort((a, b) => a.x - b.x);
      for (let i = 0; i < ordered.length - 1; i++) {
        const right = ordered[i].x + renderedWidth(ordered[i]);
        assert.ok(
          right <= ordered[i + 1].x + 0.01,
          `${name}: at y=${baseline}, "${ordered[i].text}" ends at ${right.toFixed(2)} but ` +
            `"${ordered[i + 1].text}" starts at ${ordered[i + 1].x} - they overlap`
        );
      }
    }
  }
});

test('tier 3: raster strokes are at least one device pixel', () => {
  // Defect 4. The built-in alphabet draws a glyph with a stroke of
  // `max(fontSize * 0.075, 0.35)` composition units; below one device pixel it
  // anti-aliases into grey texture and no colour assertion notices.
  for (const name of VARIATIONS) {
    const smallest = Math.min(...svgOf(name).fontSizes);
    const stroke = Math.max(smallest * 0.075, 0.35) * SCALE;
    assert.ok(
      stroke >= 1,
      `${name}: ${smallest}-unit text renders a ${stroke.toFixed(2)}px stroke at ${SCALE}x`
    );
  }
});

test('tier 3: the legibility standard actually fails an illegible render', () => {
  // The negative control. Without it the check above proves only that nothing
  // has been measured, not that anything has been caught.
  const image = pngOf(ILLEGIBLE);
  assert.equal(image.width, PAGE.width, 'the control should be rendered at 1x');

  const smallest = Math.min(...svgOf(ILLEGIBLE).fontSizes);
  const stroke = Math.max(smallest * 0.075, 0.35) * 1;
  assert.ok(
    stroke < 1,
    `the 1x control renders a ${stroke.toFixed(2)}px stroke, which the standard would pass`
  );
});

// --- tier 4: drift, reported and never failed ----------------------------

test('tier 4: report how far each variation sits from the source asset', () => {
  // The source is a denser card than the cheatsheets drawn from it, so its
  // shares legitimately differ. Failing on that would teach people to ignore
  // this suite, so it only reports.
  const source = { ground: 56.5, paper: 26.1, accent: 5.8 };
  const lines: string[] = [];
  for (const name of VARIATIONS) {
    const entries = palette(pngOf(name), 12);
    const drift = (['ground', 'paper', 'accent'] as const)
      .map((role) => {
        const share = shareOf(entries, LANGUAGE[role]) * 100;
        const delta = share - source[role];
        return `${role} ${share.toFixed(1)}% (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`;
      })
      .join('  ');
    lines.push(`  ${name.padEnd(14)} ${drift}`);
  }
  console.log(`generated-skill: drift from the source asset\n${lines.join('\n')}`);
  assert.ok(true);
});
