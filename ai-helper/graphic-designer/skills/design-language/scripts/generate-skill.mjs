/**
 * Turns one finished graphic into a skill that can draw more like it.
 *
 * This is the mechanical half of the `design-language` procedure, and it is
 * deliberately a plain CLI: measuring an asset, writing down what was measured,
 * and scaffolding a script that composes against those numbers needs judgment
 * only at the end, where a reader corrects the readings. Everything before that
 * is arithmetic, and arithmetic should not need a model.
 *
 *   node generate-skill.mjs <asset> --to .claude/skills
 *   node generate-skill.mjs <asset> --to .claude/skills --language docs/design
 *   node generate-skill.mjs <asset> --to .claude/skills --force
 *   node generate-skill.mjs <asset> --to .claude/skills --no-register
 *
 * What it writes:
 *
 *   <to>/<stem>/
 *   ├── SKILL.md                  when to reach for it, and the language in brief
 *   ├── DESIGN_LANGUAGE.md        every measurement, and where each came from
 *   ├── references/resources.md   the brand this skill draws with
 *   └── scripts/
 *       ├── make-<stem>.mjs       composes new work in the language
 *       └── brand-resources.mjs   resolves resources.md into placeable assets
 *
 * Two rules about overwriting, and they differ on purpose:
 *
 * - **A design language file is never overwritten.** A second asset in the same
 *   folder writes `DESIGN_LANGUAGE-<stem>.md`, because the corrections a reader
 *   made to the first one are the most valuable thing in it.
 * - **A skill is overwritten only after asking.** It is generated output, so
 *   regenerating it is normal; it may also have been edited since, so doing it
 *   silently is not. `--force` answers the question in advance, which is what a
 *   test or a CI run passes.
 */

import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeMedia, toMarkdown } from './analyze-media.mjs';
import { brandInstructions, initResources, loadBrandResources, writeRegistration } from './brand-resources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * What the generated script can draw, and the words that ask for each.
 *
 * Keyword matching is deliberately dumb. The point of a registration is that a
 * request can be honoured without a model in the loop - "make a html
 * cheatsheet" has to reach `--cheatsheet` by string, not by inference - and
 * anything cleverer belongs to whatever is reading the request, not to the
 * file that records what the tool can do.
 */
const MODES = {
  cheatsheet: {
    keywords: ['cheatsheet', 'cheat sheet', 'reference card', 'syntax', 'html', 'code'],
    args: ['--cheatsheet'],
    describes: 'a cheatsheet: a code panel in the captured design language',
  },
  card: {
    keywords: ['card', 'poster', 'summary', 'announcement', 'post', 'banner'],
    args: [],
    describes: 'a card: a heading and a paragraph in the captured design language',
  },
};

/** Rounds to a sensible number of places, and drops a trailing `.0`. */
function round(value, places = 2) {
  return Number(Number(value ?? 0).toFixed(places));
}

/**
 * Picks the type scale out of a sorted list of measured sizes.
 *
 * An asset exported from a design tool carries sizes like 16.49 - an artifact
 * of somebody's scale factor rather than a decision. Rounding to two places and
 * taking the extremes gives a scale a script can hold as constants, and the
 * design language file says these were rounded so a reader can disagree.
 */
function typeScale(sizes) {
  const measured = sizes.filter((n) => Number.isFinite(n) && n > 0);
  if (measured.length === 0) return { display: 24, head: 16, body: 11, caption: 8 };
  const high = measured[measured.length - 1];
  const low = measured[0];
  const middle = measured[Math.floor(measured.length / 2)];
  return {
    display: round(high),
    head: round(measured.length > 2 ? middle : high / 1.25),
    body: round(measured.length > 3 ? measured[Math.max(0, Math.floor(measured.length / 3))] : low * 1.25),
    caption: round(low),
  };
}

/** Relative luminance, 0 to 1. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Saturation in HSL terms, 0 to 1. */
function saturation(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/**
 * Decides which measured colour plays which role.
 *
 * Area beats reference count for this question and nothing else: the colour
 * that covers the most page is the ground, whatever the file's own declarations
 * outnumber. The accent is the most saturated colour that still carries a
 * percent of the page, which keeps a single anti-aliased pixel of pure cyan
 * from being promoted over the green the design actually uses.
 *
 * This is the correction the shipped worked example had to make by hand. It is
 * mechanical, so it belongs here rather than in a note telling the next reader
 * to make it again.
 */
function rolePalette(report) {
  const byArea = report.areaPalette ?? report.palette ?? [];
  const roles = report.roles ?? {};
  const palette = {
    ground: roles.paper ?? '#ffffff',
    paper: roles.paper ?? '#ffffff',
    accent: roles.accent ?? '#4c8faf',
    ink: roles.ink ?? '#1f2328',
  };

  const top = byArea.slice(0, 2).map((entry) => entry.hex);
  if (top.length === 2 && top[0] !== top[1]) {
    const [dark, light] = [...top].sort((a, b) => luminance(a) - luminance(b));
    palette.ground = top[0];
    palette.paper = top[0] === dark ? light : dark;
    // Ink has to read on paper, not on the ground, and the two swap with it.
    palette.ink = luminance(palette.paper) > 0.5 ? dark : light;
  }

  const accent = byArea
    .filter((entry) => entry.share >= 0.01 && entry.hex !== palette.ground && entry.hex !== palette.paper)
    .sort((a, b) => saturation(b.hex) - saturation(a.hex))[0];
  if (accent) palette.accent = accent.hex;

  return palette;
}

/**
 * The colours a code panel is allowed to use.
 *
 * Taken from what the source declared rather than invented, and kept away from
 * the four structural roles - a design language that lets a syntax colour also
 * be the accent has two jobs for one colour, and the page stops saying which
 * thing is the important one. When the source has nothing spare, the panel is
 * set in paper and accent alone, which is duller and still in the language.
 */
function syntaxPalette(report, palette) {
  const roles = new Set([palette.ground, palette.paper, palette.ink]);
  const spare = (report.palette ?? [])
    .map((entry) => entry.hex)
    .filter((hex) => !roles.has(hex));
  const pick = (i, fallback) => spare[i] ?? fallback;
  return {
    tag: pick(0, palette.accent),
    attr: pick(1, palette.accent),
    value: pick(2, palette.paper),
    text: pick(3, palette.paper),
    comment: pick(4, palette.accent),
  };
}

/** Scales a measured box onto the page the generated script will draw. */
function slotBox(slot, from, to) {
  const sx = from.width ? to.width / from.width : 1;
  const sy = from.height ? to.height / from.height : 1;
  return {
    x: round(slot.box.x * sx),
    y: round(slot.box.y * sy),
    width: round(slot.box.width * sx),
    height: round(slot.box.height * sy),
  };
}

/**
 * The brand slots a generated script draws into.
 *
 * Measured slots first, in the positions the source put them. When the asset
 * named none - a raster with no compact mark, or a vector whose layers are all
 * called `Layer 1` - fall back to the two positions that are right often
 * enough to be worth defaulting to: a mark in the top band, a bar along the
 * bottom.
 */
function brandSlots(report, page) {
  const measured = report.brand?.slots ?? [];
  const from = {
    width: report.page?.width || page.width,
    height: report.page?.height || page.height,
  };
  const slots = {};
  for (const slot of measured) {
    if (slot.key === 'brand' || slot.key === 'domain') continue;
    if (slots[slot.key]) continue;
    slots[slot.key] = { ...slotBox(slot, from, page), region: slot.region, from: slot.found };
  }
  if (!slots.logo) {
    slots.logo = {
      x: round(page.width - page.margin - 48),
      y: round(page.margin - 4),
      width: 48,
      height: 24,
      region: 'top-right',
      from: 'default',
    };
  }
  if (!slots.footer && !slots.linkedMedia) {
    slots.footer = {
      x: page.margin,
      y: round(page.height - 44),
      width: round(page.width - page.margin * 2),
      height: 24,
      region: 'bottom-center',
      from: 'default',
    };
  }
  return slots;
}

/** The JSON a generated constant is written as. */
function constant(value) {
  return JSON.stringify(value, null, 2).replace(/\n/g, '\n');
}

/**
 * Writes the composing script.
 *
 * The shape matters more than the content: every measured number is a constant
 * at the top and the composition below reads them. A caller who wants a
 * different colour edits one line, and a caller who finds themselves editing a
 * colour inside the composition has found a drift worth fixing.
 */
function composeScript({ stem, source, palette, page, type, strokes, slots, families, syntax }) {
  return `/**
 * Draws in the design language of \`${source}\`.
 *
 * Generated by the graphic-designer helper's \`design-language\` skill from
 * measurements of that file. The language is the constants at the top - change
 * it there, in one place, rather than in the composition below.
 * \`DESIGN_LANGUAGE.md\` beside this script says where every number came from,
 * and which are readings rather than measurements.
 *
 *   node make-${stem}.mjs --title "Acme Corp" --out ./out
 *   node make-${stem}.mjs --resources path/to/resources.md --out ./out
 *
 * Brand assets come from \`references/resources.md\`. When it names files that
 * exist they are drawn into the brand slots below; when it does not, those
 * slots are filled with marks in this language. Either way the composition is
 * complete - there is no configuration this script refuses to run without.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { brandInstructions, loadGraphicApi, resolveBrand } from './brand-resources.mjs';

/** The palette, in roles. Measured shares are in \`DESIGN_LANGUAGE.md\`. */
const PALETTE = ${constant(palette)};

/** The page, and the margin everything is held off it by. */
const PAGE = ${constant(page)};

/** The type scale, rounded to the intent behind the measured sizes. */
const TYPE = ${constant({ ...type, ...families })};

/** Stroke weights the source declared. */
const STROKE = ${constant(strokes)};

/**
 * Where brand elements go, in page coordinates.
 *
 * These are measured from the source asset's own layer names where it had
 * them, so a logo lands where that designer put one. \`resources.md\` decides
 * what fills them.
 */
const SLOTS = ${constant(slots)};

/** The skill folder, so \`references/resources.md\` is found beside it. */
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Composes one page.
 *
 * Horizontal bands, which is the structure the source reads as: a brand band at
 * the top, a rule, a plate carrying the message, and a footer band.
 */
export function compose(api, brand, { title, heading, body, footer }) {
  const design = api.createComposition({
    width: PAGE.width,
    height: PAGE.height,
    background: PALETTE.ground,
    id: '${stem}',
    title: heading,
  });

  // The brand band. The logo slot is drawn first so the title can be measured
  // against what is left of the band rather than over the top of it.
  const logo = SLOTS.logo;
  brand.place(design, 'logo', logo, {
    fit: 'contain',
    accent: PALETTE.accent,
    paper: PALETTE.paper,
    fontFamily: TYPE.displayFamily,
  });

  design.text({
    x: PAGE.margin,
    y: logo.y + logo.height - 4,
    text: brand.textFor('brandName') ?? title,
    fontFamily: TYPE.displayFamily,
    fontSize: TYPE.display,
    letterSpacing: 0.8,
    transform: 'uppercase',
    maxWidth: logo.x - PAGE.margin - 8,
    fill: PALETTE.paper,
  });

  const ruleY = logo.y + logo.height + 8;
  design.line({
    x1: PAGE.margin,
    y1: ruleY,
    x2: PAGE.width - PAGE.margin,
    y2: ruleY,
    stroke: PALETTE.accent,
    strokeWidth: STROKE.rule,
  });

  // A plate interrupts the ground, which is what makes the message read as the
  // thing on the page rather than as more of the field it sits on.
  //
  // Both renderers lay text out from the same table, so the plate can be sized
  // from what it will hold rather than guessed at and then filled. Short copy
  // gets a short plate, long copy a taller one, and the plate is centred in the
  // space between the rule and the footer band - a plate stretched to fill that
  // space instead is mostly empty paper, which reads as unfinished however
  // right its colours are.
  const PAD = 16;
  const inner = PAGE.width - PAGE.margin * 2 - PAD * 2;
  const bandTop = (SLOTS.linkedMedia ?? SLOTS.footer)?.y ?? PAGE.height - 44;
  const measure = (text, fontSize, lineHeight) =>
    api.layoutText(text, { x: 0, y: 0, fontSize, lineHeight, maxWidth: inner });

  const headingBlock = measure(heading, TYPE.head, 1.2);
  const bodyBlock = measure(body, TYPE.body, 1.45);
  const tagline = brand.textFor('tagline');

  const headingHeight = TYPE.head + headingBlock.height;
  const bodyHeight = TYPE.body * 1.45 + bodyBlock.height;
  const taglineHeight = tagline ? TYPE.caption * 2.5 : 0;
  const available = bandTop - ruleY - 24;
  const plateHeight = Math.max(72, Math.min(PAD * 2 + headingHeight + PAD + bodyHeight + taglineHeight, available));
  const plateTop = ruleY + 12 + Math.max(0, (available - plateHeight) / 2);

  design.rect({
    x: PAGE.margin,
    y: plateTop,
    width: PAGE.width - PAGE.margin * 2,
    height: plateHeight,
    fill: PALETTE.paper,
  });
  design.text({
    x: PAGE.width / 2,
    y: plateTop + PAD + TYPE.head,
    text: heading,
    fontFamily: TYPE.textFamily,
    fontSize: TYPE.head,
    fontWeight: 'bold',
    align: 'center',
    lineHeight: 1.2,
    maxWidth: inner,
    fill: PALETTE.ink,
  });
  design.text({
    x: PAGE.margin + PAD,
    y: plateTop + PAD + headingHeight + PAD,
    text: body,
    fontFamily: TYPE.textFamily,
    fontSize: TYPE.body,
    lineHeight: 1.45,
    maxWidth: inner,
    baseline: 'top',
    fill: PALETTE.ink,
  });

  if (tagline) {
    design.text({
      x: PAGE.width / 2,
      y: plateTop + plateHeight - PAD * 0.75,
      text: tagline,
      fontFamily: TYPE.textFamily,
      fontSize: TYPE.caption,
      align: 'center',
      transform: 'uppercase',
      letterSpacing: 0.5,
      fill: PALETTE.accent,
    });
  }

  footerBand(design, brand, footer);
  return design;
}

/**
 * Sets the footer band: a linked asset if one is configured, otherwise type.
 *
 * \`fallback: false\` matters here. The alternative to a placed strip is a line
 * of type, not a monogram - a slot that drew a monogram along the bottom of the
 * page would be filling space rather than reading the design language.
 */
function footerBand(design, brand, footer) {
  const band = SLOTS.linkedMedia ?? SLOTS.footer;
  if (!band) return { placed: false };

  design.rect({
    x: 0,
    y: band.y - 12,
    width: PAGE.width,
    height: PAGE.height - band.y + 12,
    fill: PALETTE.paper,
  });
  design.rect({
    x: 0,
    y: band.y - 12 - STROKE.bar,
    width: PAGE.width,
    height: STROKE.bar,
    fill: PALETTE.accent,
  });

  const placed = brand.place(design, SLOTS.linkedMedia ? 'linkedMedia' : 'footer', band, {
    fit: 'contain',
    fallback: false,
  });
  if (!placed.placed) {
    design.text({
      x: PAGE.margin,
      y: band.y + band.height / 2,
      text: brand.textFor('domain') ?? footer,
      fontFamily: TYPE.textFamily,
      fontSize: TYPE.body,
      baseline: 'middle',
      transform: 'uppercase',
      letterSpacing: 0.6,
      fill: PALETTE.ink,
    });
  }
  return placed;
}

/**
 * Monospace advance, in ems.
 *
 * Courier and Courier New are exactly 0.6 em per character, and a code panel is
 * laid out token by token. \`measureText\` would be the wrong ruler here - it
 * measures the rasterizer's built-in alphabet, which is narrower than the
 * family the SVG names, so a pen advanced by it falls short and the next token
 * prints over the last in the vector while looking fine in the raster.
 */
const MONO = "'Courier New', Courier, monospace";
const MONO_ADVANCE = 0.6;

/** Colours reserved for tokens inside a code panel, and for nothing else. */
const SYNTAX = ${constant(syntax)};

/** Draws one line of code as coloured tokens, advanced by the mono metric. */
function codeLine(design, x, baseline, tokens, size) {
  let pen = x;
  for (const [text, tone] of tokens) {
    if (text) {
      design.text({
        x: pen,
        y: baseline,
        text,
        fontFamily: MONO,
        fontSize: size,
        fill: SYNTAX[tone] ?? SYNTAX.text,
      });
    }
    pen += text.length * size * MONO_ADVANCE;
  }
  return pen;
}

/**
 * Composes a cheatsheet: the same bands as the card, with a code panel where
 * the card has a paragraph.
 *
 * This is the proof that a design language is not a template. The source asset
 * carried no code at all; the language it was drawn in carries this quite
 * happily, because a language is a palette, a scale, a rhythm and a set of
 * brand positions rather than a layout.
 */
export function composeCheatsheet(api, brand, { title, heading, subheading, rows, footer }) {
  const design = api.createComposition({
    width: PAGE.width,
    height: PAGE.height,
    background: PALETTE.ground,
    id: '${stem}-cheatsheet',
    title: heading,
  });

  const logo = SLOTS.logo;
  brand.place(design, 'logo', logo, {
    fit: 'contain',
    accent: PALETTE.accent,
    paper: PALETTE.paper,
    fontFamily: TYPE.displayFamily,
  });

  design.text({
    x: PAGE.margin,
    y: logo.y + logo.height - 4,
    text: title,
    fontFamily: TYPE.displayFamily,
    fontSize: TYPE.display,
    letterSpacing: 0.8,
    transform: 'uppercase',
    maxWidth: logo.x - PAGE.margin - 8,
    fill: PALETTE.paper,
  });

  const ruleY = logo.y + logo.height + 8;
  design.line({
    x1: PAGE.margin,
    y1: ruleY,
    x2: PAGE.width - PAGE.margin,
    y2: ruleY,
    stroke: PALETTE.accent,
    strokeWidth: STROKE.rule,
  });

  // The plate carries the heading only, so the panel below it gets the depth.
  //
  // Its height is measured rather than fixed. A heading long enough to wrap
  // pushes the subheading down, and a plate sized for one line would print the
  // second over it - a defect that looks like a font problem and is arithmetic.
  const plateTop = ruleY + 10;
  const inner = PAGE.width - PAGE.margin * 2 - 16;
  const headingBlock = api.layoutText(heading, {
    x: 0,
    y: 0,
    fontSize: TYPE.head,
    lineHeight: 1.2,
    maxWidth: inner,
  });
  const headingBase = plateTop + TYPE.head * 1.2;
  const subBase = headingBase + headingBlock.height + TYPE.caption * 1.9;
  const plateHeight = subBase - plateTop + TYPE.caption;

  design.rect({
    x: PAGE.margin,
    y: plateTop,
    width: PAGE.width - PAGE.margin * 2,
    height: plateHeight,
    fill: PALETTE.paper,
  });
  design.text({
    x: PAGE.width / 2,
    y: headingBase,
    text: heading,
    fontFamily: TYPE.textFamily,
    fontSize: TYPE.head,
    fontWeight: 'bold',
    align: 'center',
    lineHeight: 1.2,
    maxWidth: inner,
    fill: PALETTE.ink,
  });
  design.text({
    x: PAGE.width / 2,
    y: subBase,
    text: subheading,
    fontFamily: TYPE.textFamily,
    fontSize: TYPE.caption,
    align: 'center',
    maxWidth: inner,
    fill: PALETTE.ink,
  });

  // The panel: an accent margin, then the code held off it.
  const band = SLOTS.linkedMedia ?? SLOTS.footer;
  const bandTop = band ? band.y - 12 : PAGE.height - 44;
  const panelTop = plateTop + plateHeight + 10;
  const panelHeight = Math.max(60, bandTop - panelTop - 10);
  design.rect({ x: PAGE.margin, y: panelTop, width: 8, height: panelHeight, fill: PALETTE.accent });
  design.rect({
    x: PAGE.margin + 18,
    y: panelTop,
    width: PAGE.width - PAGE.margin * 2 - 18,
    height: panelHeight,
    fill: PALETTE.ground,
    stroke: PALETTE.accent,
    strokeWidth: STROKE.rule,
  });

  // The line step comes from the row count rather than being fixed, so a longer
  // listing tightens instead of running out under the footer. A cheatsheet that
  // silently loses its last line is worse than one that is a little dense.
  const step = Math.min(TYPE.caption * 2.2, (panelHeight - TYPE.caption * 2) / Math.max(rows.length, 1));
  rows.forEach((tokens, i) => {
    codeLine(design, PAGE.margin + 28, panelTop + TYPE.caption * 2 + i * step, tokens, TYPE.caption);
  });

  footerBand(design, brand, footer);
  return design;
}

/** The HTML reference the cheatsheet draws when nothing else is given. */
const HTML_ROWS = [
  [['<!DOCTYPE html>', 'comment']],
  [['<html', 'tag'], [' lang', 'attr'], ['="en"', 'value'], ['>', 'tag']],
  [['  <head>', 'tag']],
  [['    <meta', 'tag'], [' charset', 'attr'], ['="utf-8"', 'value'], ['>', 'tag']],
  [['    <title>', 'tag'], ['Page title', 'text'], ['</title>', 'tag']],
  [['    <link', 'tag'], [' rel', 'attr'], ['="stylesheet"', 'value'], [' href', 'attr'], ['="a.css"', 'value'], ['>', 'tag']],
  [['  </head>', 'tag']],
  [['  <body>', 'tag']],
  [['    <h1', 'tag'], [' id', 'attr'], ['="top"', 'value'], ['>', 'tag'], ['Heading', 'text'], ['</h1>', 'tag']],
  [['    <p', 'tag'], [' class', 'attr'], ['="lead"', 'value'], ['>', 'tag'], ['Paragraph.', 'text'], ['</p>', 'tag']],
  [['    <a', 'tag'], [' href', 'attr'], ['="/docs"', 'value'], ['>', 'tag'], ['Link', 'text'], ['</a>', 'tag']],
  [['    <img', 'tag'], [' src', 'attr'], ['="logo.png"', 'value'], [' alt', 'attr'], ['="Logo"', 'value'], ['>', 'tag']],
  [['    <ul>', 'tag'], ['<li>', 'tag'], ['Item', 'text'], ['</li>', 'tag'], ['</ul>', 'tag']],
  [['  </body>', 'tag']],
  [['</html>', 'tag']],
];

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'make-${stem} [--cheatsheet] --title <t> --heading <h> --body <b> --footer <f> --out <dir> --name <basename> --resources <file> --scale <n>'
    );
    return;
  }
  const flag = (name, fallback) => {
    const i = args.indexOf(\`--\${name}\`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const api = await loadGraphicApi();
  const brand = await resolveBrand({ api, path: flag('resources'), skillDir: SKILL_DIR });
  const cheatsheet = args.includes('--cheatsheet');

  const design = cheatsheet
    ? composeCheatsheet(api, brand, {
        title: flag('title', 'HTML'),
        heading: flag('heading', 'HTML Document Structure Starting Point'),
        subheading: flag('subheading', 'Head, Body, and the Tags Worth Memorizing'),
        rows: HTML_ROWS,
        footer: flag('footer', 'example.com'),
      })
    : compose(api, brand, {
        title: flag('title', 'Acme Corp'),
        heading: flag('heading', 'Quarterly Summary'),
        body: flag(
          'body',
          'Every number in this page comes from the design language beside this script, so a change to the language is one edit rather than a search.'
        ),
        footer: flag('footer', 'example.com'),
      });

  // Both formats come off the one composition, so the SVG and the PNG are the
  // same graphic rather than two renders that can drift. The raster defaults to
  // 3x because this language sets captions small enough that a single-stroke
  // glyph falls under a device pixel at 1x and reads as grey.
  const out = resolve(flag('out', './out'));
  const name = flag('name', cheatsheet ? 'cheatsheet' : '${stem}');
  const scale = Number(flag('scale', '3')) || 3;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, \`\${name}.svg\`), design.toSVG(), 'utf-8');
  const render = api.renderPng(design.toDocument(), { scale });
  await writeFile(join(out, \`\${name}.png\`), render.data);
  console.log(\`wrote \${join(out, \`\${name}.svg\`)} and \${join(out, \`\${name}.png\`)} (raster at \${scale}x)\`);
  for (const warning of render.warnings) console.warn(\`  warning: \${warning}\`);
  console.log('');
  console.log(brandInstructions(brand));
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
const self = resolve(fileURLToPath(import.meta.url));
if (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
`;
}

/** The `SKILL.md` a generated skill is found by. */
function skillDoc({ stem, source, palette, page, type, slots, brandFound }) {
  const slotRows = Object.entries(slots)
    .map(([key, box]) => `| \`${key}\` | ${box.region} | ${box.x}, ${box.y}, ${box.width}, ${box.height} | ${box.from} |`)
    .join('\n');

  return `---
name: ${stem}
description: 'Draws graphics in the design language measured from ${source}: a ${page.width} by ${page.height} page on ${palette.ground} with ${palette.accent} as the accent, set in ${type.display}/${type.body} type. Use when a new card, poster, social post, banner or cheatsheet has to match ${source}, when work has to carry this brand, or when a graphic in this language needs composing in both SVG and PNG. Brand assets come from references/resources.md; without one the brand areas are drawn in the language itself.'
---

# ${stem}

The design language of \`${source}\`, as a tool. \`DESIGN_LANGUAGE.md\` beside
this file holds every measurement and says which values were measured and which
were read; this page is the short version and how to run it.

## Draw something

\`\`\`bash
node scripts/make-${stem}.mjs --out ./out
node scripts/make-${stem}.mjs --title "Acme Corp" --heading "Quarterly Summary" --out ./out
\`\`\`

Both an SVG and a PNG come off the one composition, so they are the same
graphic in two formats.

## The language in brief

- **Ground** \`${palette.ground}\`, **paper** \`${palette.paper}\`, **accent**
  \`${palette.accent}\`, **ink** \`${palette.ink}\`.
- **Page** ${page.width} by ${page.height}, margin ${page.margin}.
- **Type** display ${type.display}, head ${type.head}, body ${type.body},
  caption ${type.caption}.

The constants at the top of \`scripts/make-${stem}.mjs\` *are* the language.
Editing a colour anywhere below them is a drift, not a change.

## Brand slots

${brandFound === 'named'
      ? 'Read from the source asset\'s own layer names, so these are the positions its designer marked.'
      : brandFound === 'scan'
        ? 'Found by scanning the source, not by name. Confirm them by eye before relying on them.'
        : 'The source named no brand elements, so these are defaults: a mark in the top band, a bar along the bottom.'}

| Slot | Region | Box (x, y, w, h) | How |
| --- | --- | --- | --- |
${slotRows}

Fill them by editing \`references/resources.md\`:

\`\`\`md
- logo: path/to/logo.svg
- GLOBAL_ASSETS: path/to/assets/
- brand name: Acme Corp.
- domain: example.com
\`\`\`

In a \`GLOBAL_ASSETS\` folder the file name is the slot it fills, so
\`logo.svg\` fills the logo and \`footer.png\` fills the footer. An SVG asset is
inlined as shapes rather than placed as an image, which is what puts it in the
PNG as well as the SVG.

Check what resolved before wondering why a graphic looks wrong:

\`\`\`bash
node scripts/brand-resources.mjs --print
\`\`\`

With nothing configured the slots are filled with marks in this language - a
monogram on the accent, a set wordmark. That is a placeholder, and an obvious
one; it is not a brand.

## When to reach for this

- A graphic has to match \`${source}\`
- A repeated graphics job in this language should be a script rather than a
  brief
- Work has to carry the brand \`references/resources.md\` names

## When not to

- The new work is meant to look different. A design language is a constraint,
  and the way to leave one is to measure the asset you actually want.
`;
}

/**
 * Copies a `resources.md` into the skill, keeping its paths pointing at the
 * same files.
 *
 * A relative path in that file means "relative to this file", so moving the
 * file without rewriting them breaks every asset it names - silently, because
 * a missing asset falls back to a drawn mark rather than failing. Rewriting on
 * copy is the difference between a skill that carries a brand and one that
 * quietly carries placeholders.
 */
async function copyResources(from, to) {
  const source = resolve(from);
  const text = await readFile(source, 'utf-8');
  const fromDir = dirname(source);
  const toDir = dirname(resolve(to));

  const rewritten = text
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(\s*[-*+]\s+.+?\s*:\s*)(.*)$/.exec(line);
      if (!match) return line;
      const value = match[2].trim();
      if (!value || /^([a-z]+:|\/|[A-Za-z]:[\\/])/.test(value)) return line;
      if (!/[\\/]/.test(value) && !/\.[a-z0-9]{2,5}$/i.test(value)) return line;
      const target = resolve(fromDir, value);
      const trailing = /[\\/]$/.test(value) ? '/' : '';
      const next = relative(toDir, target).replace(/\\/g, '/') || '.';
      return `${match[1]}${next.startsWith('.') ? next : `./${next}`}${trailing}`;
    })
    .join('\n');

  await writeFile(to, rewritten, 'utf-8');
}

/** Asks a yes/no question, defaulting to no anywhere there is no terminal. */
async function confirm(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * The name a design language file takes in a directory.
 *
 * Plain when the directory holds none, suffixed with the asset's stem when it
 * does, so a second asset documented beside the first never overwrites it.
 */
export function designLanguageName(dir, stem) {
  return existsSync(join(dir, 'DESIGN_LANGUAGE.md')) ? `DESIGN_LANGUAGE-${stem}.md` : 'DESIGN_LANGUAGE.md';
}

/**
 * Generates the skill.
 *
 * @param {string} asset the media file to measure
 * @param {object} options `to`, `language`, `force`, `resources`, `colors`
 */
export async function generateSkill(asset, options = {}) {
  const source = resolve(asset);
  if (!existsSync(source)) throw new Error(`no such file: ${source}`);

  const stem = basename(source, extname(source));
  const report = await analyzeMedia(source, { colors: options.colors ?? 12 });

  const palette = rolePalette(report);

  const measured = report.page ?? {};
  const page = {
    width: Math.round(measured.width || 360),
    height: Math.round(measured.height || 360),
    margin: Math.max(12, Math.round((measured.width || 360) * 0.067)),
  };
  const type = typeScale(report.type?.sizes ?? []);
  const families = {
    displayFamily: report.type?.families?.[0]
      ? `'${report.type.families[0]}', sans-serif`
      : "Helvetica, Arial, sans-serif",
    textFamily: report.type?.families?.[1]
      ? `'${report.type.families[1]}', sans-serif`
      : report.type?.families?.[0]
        ? `'${report.type.families[0]}', sans-serif`
        : "Helvetica, Arial, sans-serif",
  };
  const widths = report.strokeWidths ?? [];
  const strokes = {
    rule: round(widths[0] ?? 1),
    bar: round(widths[widths.length - 1] ?? 3),
  };
  const slots = brandSlots(report, page);
  const syntax = syntaxPalette(report, palette);

  const skillDir = join(resolve(options.to ?? '.claude/skills'), stem);
  if (existsSync(skillDir) && !options.force) {
    const ok = await confirm(`${relative(process.cwd(), skillDir) || skillDir} already exists. Overwrite it?`);
    if (!ok) {
      return { skipped: true, skillDir, reason: 'a skill of that name is already there' };
    }
  }

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await mkdir(join(skillDir, 'references'), { recursive: true });

  // The design language goes where the caller asked, and never over one that is
  // already there - the readings in an existing file are the part worth keeping.
  const languageDir = resolve(options.language ?? skillDir);
  await mkdir(languageDir, { recursive: true });
  const languageName = options.force && options.language ? 'DESIGN_LANGUAGE.md' : designLanguageName(languageDir, stem);
  const languagePath = join(languageDir, languageName);
  await writeFile(languagePath, toMarkdown(report), 'utf-8');

  // The skill carries its own copy of the language, so it travels alone.
  if (resolve(languageDir) !== resolve(skillDir)) {
    await copyFile(languagePath, join(skillDir, 'DESIGN_LANGUAGE.md'));
  }

  await writeFile(
    join(skillDir, 'scripts', `make-${stem}.mjs`),
    composeScript({ stem, source: basename(source), palette, page, type, strokes, slots, families, syntax }),
    'utf-8'
  );
  await copyFile(join(HERE, 'brand-resources.mjs'), join(skillDir, 'scripts', 'brand-resources.mjs'));
  await writeFile(
    join(skillDir, 'SKILL.md'),
    skillDoc({ stem, source: basename(source), palette, page, type, slots, brandFound: report.brand?.found ?? 'none' }),
    'utf-8'
  );

  const resourcesPath = join(skillDir, 'references', 'resources.md');
  if (options.resources) {
    await copyResources(options.resources, resourcesPath);
  } else if (!existsSync(resourcesPath)) {
    await initResources(join(skillDir, 'references'));
  }

  // Register the skill so the next request needs no paths.
  //
  // This is the step that makes a generated skill plug-and-play rather than
  // merely present: `references/graphic-design-api.json` names the script, the
  // project's own `resources.md`, where output goes, and what to draw when the
  // request does not say. Without it, using what was just generated means
  // remembering a path nobody has seen yet.
  let registration = null;
  if (options.register !== false) {
    const dir = resolve(options.register || join(process.cwd(), 'references'));
    const root = dirname(dir);
    const relative_ = (path) => relative(root, path).replace(/\\/g, '/');

    // The project's brand file, not the skill's snapshot of one. A caller edits
    // this one, so it is the one a registered command has to read.
    const projectResources = join(dir, 'resources.md');
    if (!existsSync(projectResources)) await initResources(dir);

    registration = await writeRegistration(dir, {
      skill: stem,
      skillDir: relative_(skillDir),
      script: relative_(join(skillDir, 'scripts', `make-${stem}.mjs`)),
      resources: relative_(projectResources),
      designLanguage: relative_(languagePath),
      source: relative_(source),
      out: relative_(resolve(options.out || join(root, 'out'))),
      defaultRequest: options.defaultRequest ?? 'make a card',
      defaultMode: options.defaultMode ?? 'card',
      modes: MODES,
      generatedAt: new Date().toISOString(),
    });
  }

  return { skillDir, languagePath, stem, slots, report, registration };
}

/** Flags that consume the token after them, so it is not the asset path. */
const VALUE_FLAGS = new Set([
  '--to',
  '--language',
  '--resources',
  '--colors',
  '--register',
  '--out',
  '--default-request',
  '--default-mode',
]);

async function run() {
  const args = process.argv.slice(2);
  const asset = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
  if (!asset || args.includes('--help')) {
    console.log('generate-skill <asset> --to <skills-dir> [--language <dir>] [--resources <file>] [--force]');
    process.exit(asset ? 0 : 1);
  }
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
  };

  const result = await generateSkill(asset, {
    to: flag('to', '.claude/skills'),
    language: flag('language'),
    resources: flag('resources'),
    colors: Number(flag('colors', '12')) || 12,
    force: args.includes('--force') || args.includes('--yes'),
    register: args.includes('--no-register') ? false : flag('register'),
    out: flag('out'),
    defaultRequest: flag('default-request'),
    defaultMode: flag('default-mode'),
  });

  if (result.skipped) {
    console.log(`left ${result.skillDir} alone: ${result.reason}`);
    return;
  }

  const show = (p) => relative(process.cwd(), p).replace(/\\/g, '/') || p;
  console.log(`skill:           ${show(result.skillDir)}`);
  console.log(`design language: ${show(result.languagePath)}`);
  console.log(`brand slots:     ${Object.keys(result.slots).join(', ')}`);
  if (result.registration) console.log(`registered:      ${show(result.registration)}`);
  console.log('');
  console.log(brandInstructions(await loadBrandResources({ skillDir: result.skillDir })));
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
const self = resolve(fileURLToPath(import.meta.url));
if (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
