/**
 * Type in the app: the type layout (core/type/layout.ts) as the canvas sets
 * and paints it, and as an SVG carries it out and back.
 *
 * The book is a page of text marks a script made: a centred line in three
 * runs - bold, red, underlined - a word with a highlight behind it, Sheet
 * Typing inside a circle, Path Typing along an arc in the rainbow effect and
 * in the stair effect, a vertical word, and a text box from before. Each is
 * laid out with the canvas's own measure; the runs paint in their colors, the
 * underline and the highlight where the layout puts them; the circle's lines
 * stay inside it; a path's characters turn with it, or stand upright; and a
 * press on a character along the path picks its mark. The page's SVG is read
 * into a second app and every text comes back as it was. Then another
 * editor's SVG - styled tspans, a textPath, a vertical writing mode - comes in
 * as runs, as Path Typing and as vertical text. Last, a book from a newer
 * napkin-sketch opens, and a report says so.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-type-check-'));
const TIME = '2026-10-02T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const CIRCLE = 'M80 0 C124 0 160 36 160 80 C160 124 124 160 80 160 C36 160 0 124 0 80 C0 36 36 0 80 0 Z';
const ARC = 'M0 0 C60 -60 180 -60 240 0';
const result = evaluate(
  [
    'napkin 1',
    'page 720 480',
    'background #ffffff',
    'layer "Type"',
    'color #1f2328',
    'font "Arial" 24',
    'paragraph align center',
    'text "Bold red under" at 200 40 runs (0 4 face "Bold", 5 8 color #c0392b, 9 14 underline)',
    'paragraph reset',
    'text "A marked word" at 40 110 size 20 runs (2 8 highlight #ffd43b)',
    `text "Words fill the round frame from its top to its bottom, line by line" at 420 60 size 14 inside "${CIRCLE}"`,
    `text "Along the arc" at 60 360 size 18 along "${ARC}"`,
    `text "Stair steps" at 380 360 size 18 along "${ARC}" effect stair`,
    'text "Up" at 690 40 size 22 vertical',
    'text "An old style box that wraps its words" at 40 180 size 16 box 150',
  ].join('\n'),
  { name: 'type', timestamp: TIME },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'type.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const MARKS = result.book.sketches[0].strokes;
const idOf = (start) => MARKS.find((m) => m.text.startsWith(start)).id;

/**
 * The canvas inside a page box, after two frames: how many pixels are red,
 * dark, highlighter yellow and paper, and the share of the box's columns
 * with a dark pixel in them.
 */
const SCAN = (box) => `
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  const k = cv.width / r.width;
  const x0 = Math.round((v.panX + ${box.minX} * v.zoom) * k);
  const y0 = Math.round((v.panY + ${box.minY} * v.zoom) * k);
  const w = Math.max(1, Math.round(${box.maxX - box.minX} * v.zoom * k));
  const h = Math.max(1, Math.round(${box.maxY - box.minY} * v.zoom * k));
  const d = cv.getContext('2d').getImageData(x0, y0, w, h).data;
  let red = 0, dark = 0, yellow = 0, paper = 0;
  const columns = new Array(w).fill(false);
  for (let i = 0; i < d.length; i += 4) {
    const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
    if (R > 150 && R > G + 70 && R > B + 70) red++;
    if (R < 110 && G < 110 && B < 110) { dark++; columns[(i / 4) % w] = true; }
    if (R > 220 && G > 180 && G < 235 && B < 120) yellow++;
    if (R > 240 && G > 240 && B > 240) paper++;
  }
  return { red, dark, yellow, paper, darkColumns: columns.filter(Boolean).length / w };
`;
const CLIENT = (x, y) => `
  const r = document.getElementById('canvas').getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };
`;

async function session(launchOptions, run) {
  const app = launch(launchOptions);
  try {
    const page = await connect();
    await page.send('Runtime.enable');
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await sleep(3500);
    await page.evalIn(`
      window.__errors = [];
      window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
      window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
      return true;`);
    const io = {
      evalIn: (code) => page.evalIn(code),
      type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      scan: (box) => page.evalIn(SCAN(box)),
      async hit(x, y) {
        const at = await page.evalIn(CLIENT(x, y));
        return page.evalIn(`return window.napkinCheck.hitAt(${at.x}, ${at.y}, 2);`);
      },
      async key(key, code, vk) {
        for (const type of ['rawKeyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sleep(400);
      },
      async clickPage(x, y) {
        const at = await page.evalIn(CLIENT(x, y));
        await page.click(at.x, at.y);
        await sleep(400);
      },
      swatches: () => page.evalIn("return Array.from(document.querySelectorAll('.swatch')).map((s) => s.dataset.color);"),
      async swatch(i) {
        await page.evalIn(`document.querySelectorAll('.swatch')[${i}].click(); return true;`);
        await sleep(400);
      },
    };
    await run(io);
    c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
  } finally {
    await stop(app);
  }
}

const svgPath = join(dir, 'type-round-trip.svg');

try {
  await session({ mode: 'book', filePath: bookPath }, async (io) => {
    const centred = await io.type(idOf('Bold'));
    c.ok('a text is laid out with the canvas measure, not the built-in face', /^canvas:/.test(centred?.measure ?? ''), centred?.measure);

    // ---- A centred line in three runs ------------------------------------------------------
    const line = centred.lines[0];
    c.ok('the centred line sits its middle on its anchor', Math.abs(line.x + line.width / 2 - 200) < 0.5, JSON.stringify(line));
    const glyph = (ch) => centred.glyphs.find((g) => g.ch === ch);
    const red = centred.glyphs.filter((g) => g.index >= 5 && g.index < 8);
    c.ok('the red run is red', red.length === 3 && red.every((g) => g.color === '#c0392b'), JSON.stringify(red));
    const redBox = { minX: red[0].x, minY: line.y - 20, maxX: red[2].x + 12, maxY: line.y + 4 };
    c.ok('and paints red', (await io.scan(redBox)).red > 20, JSON.stringify(await io.scan(redBox)));
    const under = centred.glyphs.filter((g) => g.index >= 9 && g.index < 14);
    const last = under[under.length - 1];
    const underline = { minX: under[0].x + 1, minY: line.y + 1, maxX: last.x + 8, maxY: line.y + 6 };
    const ruled = await io.scan(underline);
    c.ok('the underlined word has its line under it, all the way across', ruled.darkColumns > 0.9, JSON.stringify(ruled));
    const plain = { minX: glyph('B').x, minY: line.y + 1, maxX: glyph('d').x + 10, maxY: line.y + 6 };
    c.ok('and the words before it none', (await io.scan(plain)).darkColumns < 0.2, JSON.stringify(await io.scan(plain)));

    // ---- A highlight behind a word -----------------------------------------------------------
    const marked = await io.type(idOf('A marked'));
    const lit = marked.glyphs.filter((g) => g.index >= 2 && g.index < 8);
    const litBox = { minX: lit[0].x + 1, minY: marked.lines[0].y - 14, maxX: lit[lit.length - 1].x + 6, maxY: marked.lines[0].y + 2 };
    c.ok('a highlight paints behind its characters', (await io.scan(litBox)).yellow > 40, JSON.stringify(await io.scan(litBox)));
    const after = { minX: marked.glyphs[9].x, minY: marked.lines[0].y - 14, maxX: marked.glyphs[12].x + 8, maxY: marked.lines[0].y + 2 };
    c.eq('and nowhere else', (await io.scan(after)).yellow, 0);

    // ---- Sheet Typing inside a circle ---------------------------------------------------------
    const round = await io.type(idOf('Words fill'));
    c.ok('inside a shape is Sheet Typing, several lines of it', round.kind === 'area' && round.lines.length >= 4, `${round.kind}, ${round.lines.length} lines`);
    const inside = round.glyphs.filter((g) => g.ch !== ' ').every((g) => Math.hypot(g.x - 500, g.y - 140) < 80 && Math.hypot(g.x + g.size * 0.6 - 500, g.y - 140) < 82);
    c.ok('every character inside the circle', inside, JSON.stringify(round.glyphs.slice(0, 4)));
    const widths = round.lines.map((l) => l.width);
    c.ok('the lines short at the top and long through the middle', widths[0] < Math.max(...widths) * 0.8, JSON.stringify(widths));

    // ---- Path Typing ----------------------------------------------------------------------------
    const arc = await io.type(idOf('Along'));
    const turns = arc.glyphs.map((g) => g.rotation);
    c.ok('along a path the characters turn with it: up at its start, levelling as it does', arc.kind === 'path' && turns[0] < -30 && turns.every((t, i) => i === 0 || t > turns[i - 1]), JSON.stringify(turns));
    const stairs = await io.type(idOf('Stair'));
    c.ok('the stair effect turns none of them', stairs.glyphs.every((g) => g.rotation === 0), JSON.stringify(stairs.glyphs.map((g) => g.rotation)));
    const target = arc.glyphs[4];
    c.eq('a press on a character along the path picks its mark', await io.hit(target.x + 3, target.y - 5), idOf('Along'));

    // ---- Vertical, and a box from before ----------------------------------------------------------
    const up = await io.type(idOf('Up'));
    const middle = (g) => g.x + g.width / 2;
    c.ok('vertical text stands in one column, each character on its middle, top to bottom', up.orientation === 'vertical' && Math.abs(middle(up.glyphs[0]) - middle(up.glyphs[1])) < 0.01 && up.glyphs[1].y > up.glyphs[0].y, JSON.stringify(up.glyphs));
    const boxed = await io.type(idOf('An old'));
    c.ok('a box from before is Sheet Typing that wraps at its width', boxed.kind === 'area' && boxed.typeset === null && boxed.textBoxWidth === 150 && boxed.lines.length >= 2 && boxed.lines.every((l) => l.width <= 150 + 1e-6), JSON.stringify(boxed.lines));

    writeFileSync(svgPath, await io.evalIn('return window.napkinCheck.pageSvg();'));

    // ---- Recolored whole ------------------------------------------------------------------------
    await io.key('s', 'KeyS', 83);
    const bold = centred.glyphs.find((g) => g.ch === 'o');
    await io.clickPage(bold.x + 3, bold.y - 6);
    const swatch = (await io.swatches()).find((color) => color && !['#c0392b', '#1f2328'].includes(color.toLowerCase()));
    await io.swatch((await io.swatches()).indexOf(swatch));
    const recolored = await io.type(idOf('Bold'));
    c.ok('a swatch recolors a selected text whole, its red run too', recolored.glyphs.every((g) => g.color === swatch.toLowerCase()) && !(recolored.typeset?.runs ?? []).some((r) => r.attrs.color), JSON.stringify({ swatch, colors: [...new Set(recolored.glyphs.map((g) => g.color))], runs: recolored.typeset?.runs }));
  });

  // ---- The page's own SVG, read back ----------------------------------------------------------------
  const svg = readFileSync(svgPath, 'utf8');
  c.ok('the SVG carries a textPath for the rainbow, and each text its typeset', /<textPath /.test(svg) && (svg.match(/data-typeset=/g) ?? []).length === 6, `${(svg.match(/data-typeset=/g) ?? []).length} typesets`);
  await session({ mode: 'new', sketchName: 'type-round-trip', importFiles: [svgPath] }, async (io) => {
    const marks = (await io.marks()).filter((m) => m.tool === 'text');
    c.eq('every text comes back', marks.length, MARKS.length);
    for (const original of MARKS) {
      const back = (await Promise.all(marks.map((m) => io.type(m.id)))).find((t) => t.text === original.text);
      const same =
        back &&
        JSON.stringify(back.typeset) === JSON.stringify(original.typeset ?? null) &&
        Math.abs(back.anchor.x - original.points[0].x) < 0.01 &&
        Math.abs(back.anchor.y - original.points[0].y) < 0.01 &&
        back.fontSize === original.fontSize &&
        back.textBoxWidth === (original.textBoxWidth ?? null);
      c.ok(`"${original.text.slice(0, 18)}" comes back as it was: its anchor, its size and its typeset`, same, JSON.stringify(back?.typeset));
    }
  });

  // ---- Another editor's SVG ---------------------------------------------------------------------------
  await session({ mode: 'new', sketchName: 'type-foreign', importFiles: [resolve(import.meta.dirname, 'fixtures', 'type-foreign.svg')] }, async (io) => {
    const texts = await Promise.all((await io.marks()).filter((m) => m.tool === 'text').map((m) => io.type(m.id)));
    const styled = texts.find((t) => t.text.startsWith('Plain'));
    c.eq("a tspan placed on another line starts one, the text's whitespace folded", styled?.text, 'Plain bold red\nsecond line');
    const runs = styled?.typeset?.runs ?? [];
    const bold = runs.find((r) => r.attrs.fontStyle === 'Bold');
    c.ok('a styled tspan is a run: its face and its color', bold?.start === 6 && bold?.end === 14 && bold.attrs.color === '#c0392b', JSON.stringify(runs));
    const ruled = runs.find((r) => r.attrs.underline);
    c.ok("and an underlined one its decoration", ruled?.start === 15 && ruled?.end === 26, JSON.stringify(runs));
    const along = texts.find((t) => t.text === 'Along the arc');
    c.ok('a textPath is Path Typing along its path, from its start offset', along?.kind === 'path' && along.typeset?.path?.start === 10 && along.glyphs.length === 13, JSON.stringify(along?.typeset?.path));
    const up = texts.find((t) => t.text === 'Up');
    c.eq('a vertical writing mode sets it vertically', up?.orientation, 'vertical');
  });

  // ---- A book from a newer napkin-sketch -------------------------------------------------------------
  const newer = JSON.parse(readFileSync(bookPath, 'utf8'));
  newer.version = newer.version + 1;
  const newerPath = join(dir, 'newer.skbk');
  writeFileSync(newerPath, JSON.stringify(newer, null, 2));
  await session({ mode: 'book', filePath: newerPath }, async (io) => {
    const reports = await io.evalIn('return window.napkinCheck.reportToasts();');
    c.ok('a book a newer napkin-sketch saved opens, and a report says some of it may not show', reports.some((r) => /saved by a newer napkin-sketch; some parts may not show/.test(r.title ?? r.spec?.title ?? '')), JSON.stringify(reports));
    c.eq('with its marks', (await io.marks()).length, MARKS.length);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
