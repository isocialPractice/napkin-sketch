/**
 * Splatter in the app: Effect > Stylize > Splatter, its options' presets, and
 * what the canvas paints.
 *
 * The book is a blue disc and a red ring on white paper. The disc is selected
 * and Effect > Stylize > Splatter opens its options; the Sketch preset sets
 * every field, and OK keeps it as one undo step. The disc's middle, solid
 * blue before, is a hatch now: blue lines with paper between them. The ring
 * takes one too, and the paper shows through its hole, where the hatch never
 * goes, while its band is hatched red. Expand Appearance turns the disc into
 * a group of its hatch and its outline, still drawn the same, and an undo puts
 * the live effect back. Last, the page's own SVG is imported into a second
 * app, and the disc and the ring come back with their Splatters, painted;
 * so do a Copic line and a Pencil line whose strokes a Splatter hatches, each
 * as the tool it was drawn with.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-splatter-check-'));
const TIME = '2026-10-02T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const result = evaluate(
  [
    'napkin 1',
    'page 600 400',
    'background #ffffff',
    'layer "Disc"',
    'color #1f2328 width 2 fill #2f6feb',
    'circle 150 150 80',
    'layer "Ring"',
    'fill #d0342c',
    'path "M350 150 A100 100 0 0 1 550 150 A100 100 0 0 1 350 150 Z M405 150 A45 45 0 0 0 495 150 A45 45 0 0 0 405 150 Z"',
    'layer "Lines"',
    'fill none',
    'color #2a9d4b width 14',
    'tool copic',
    'nib 30',
    'effect splatter preset dense on stroke',
    'line 60 340 260 340',
    'pencil 2B',
    'effect splatter preset dense on stroke',
    'line 340 340 540 340',
  ].join('\n'),
  { name: 'splatter', timestamp: TIME },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'splatter.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const [DISC, RING] = result.book.sketches[0].strokes.map((s) => s.id);

/**
 * The canvas pixels in a box round a page point, sorted into the hatch's
 * color, paper, and the rest: a pixel is the color when its channels are
 * within 60 of it, paper when all three are above 235.
 */
const SAMPLE = (x, y, half, rgb) => `
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  const k = cv.width / r.width;
  const cx = Math.round((v.panX + ${x} * v.zoom) * k);
  const cy = Math.round((v.panY + ${y} * v.zoom) * k);
  const h = Math.round(${half} * v.zoom * k);
  const d = cv.getContext('2d').getImageData(cx - h, cy - h, 2 * h + 1, 2 * h + 1).data;
  let ink = 0, paper = 0, other = 0;
  for (let i = 0; i < d.length; i += 4) {
    const near = Math.abs(d[i] - ${rgb[0]}) < 60 && Math.abs(d[i + 1] - ${rgb[1]}) < 60 && Math.abs(d[i + 2] - ${rgb[2]}) < 60;
    if (near) ink++;
    else if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) paper++;
    else other++;
  }
  return { ink, paper, other };
`;
const BLUE = [47, 111, 235];
const RED = [208, 52, 44];

const CLIENT = (x, y) => `
  const r = document.getElementById('canvas').getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };
`;

async function session(launchOptions, run) {
  // The ink is counted off the canvas, and the Transform box that comes up by
  // itself round a selection draws its outline on the ink's edge: off here.
  const app = launch(launchOptions, {}, { settings: { transformOnSelect: false } });
  try {
    const page = await connect();
    await page.send('Runtime.enable');
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await sleep(3500);
    await page.evalIn(`
      window.__errors = [];
      window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
      window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
      document.activeElement?.blur();
      return true;`);
    const io = {
      page,
      evalIn: (code) => page.evalIn(code),
      async key(key, code, vk, modifiers = 0, wait = 400) {
        for (const type of ['rawKeyDown', 'keyUp']) {
          await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
        }
        await sleep(wait);
      },
      async menu(id, wait = 600) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(wait);
        return ran;
      },
      async clickPage(x, y) {
        const at = await page.evalIn(CLIENT(x, y));
        await page.click(at.x, at.y);
        await sleep(350);
      },
      effectsOf: async (id) => (await page.evalIn(`return window.napkinCheck.effectsOf(${JSON.stringify(id)});`))?.mark ?? null,
    };
    await run(io);
    c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
  } catch (err) {
    c.ok(`no exception (${err.message})`, false);
  } finally {
    await stop(app);
  }
}

const svgPath = join(dir, 'round-trip.svg');

try {
  await session({ mode: 'book', filePath: bookPath }, async (io) => {
    const solid = await io.evalIn(SAMPLE(150, 150, 10, BLUE));
    c.ok('the disc\'s middle is solid blue to begin with', solid.paper === 0 && solid.ink > 100, JSON.stringify(solid));

    // ---- The disc, through Effect > Stylize > Splatter and its Sketch preset ------------
    await io.key('s', 'KeyS', 83);
    await io.clickPage(150, 150);
    await io.menu('effect-splatter');
    let opts = await io.evalIn('return window.napkinCheck.effectOptionsState();');
    c.ok('Effect > Stylize > Splatter opens its options', opts.open && opts.title === 'Splatter', JSON.stringify(opts));
    c.eq('Settings, then the Scribble Options in their order', opts.fields.join(' '), 'preset angle overlap overlapVariation width curviness curvinessVariation spacing spacingVariation seed');
    c.eq('which start at Default', await io.evalIn("return document.getElementById('effect-field-preset').value;"), 'default');
    await io.evalIn("const s = document.getElementById('effect-field-preset'); s.value = 'sketch'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;");
    await sleep(500);
    opts = await io.evalIn('return window.napkinCheck.effectOptionsState();');
    c.ok('the Sketch preset sets the fields', opts.effect?.spacing === 3 && opts.effect?.width === 1, JSON.stringify(opts.effect));
    c.eq('and the form shows them', await io.evalIn("return document.getElementById('effect-field-spacing').value;"), '3');
    await io.evalIn("const w = document.getElementById('effect-field-width'); w.value = '1.5'; w.dispatchEvent(new Event('input', { bubbles: true })); return true;");
    await sleep(400);
    c.eq('a field changed by hand makes it Custom', await io.evalIn("return document.getElementById('effect-field-preset').value;"), '');
    await io.evalIn("const s = document.getElementById('effect-field-preset'); s.value = 'sketch'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;");
    await sleep(400);
    await io.evalIn("document.getElementById('effect-options-ok').click(); return true;");
    await sleep(800);
    const effects = await io.effectsOf(DISC);
    c.ok('OK keeps a Splatter with the Sketch values', effects?.[0]?.type === 'splatter' && effects[0].spacing === 3, JSON.stringify(effects));

    const hatched = await io.evalIn(SAMPLE(150, 150, 10, BLUE));
    c.ok('the disc\'s middle is a hatch now: blue lines, and paper between them', hatched.ink > 40 && hatched.paper > 40, JSON.stringify(hatched));
    const edge = await io.evalIn(SAMPLE(150, 71, 1, [31, 35, 40]));
    c.ok('its outline still paints', edge.ink > 0, JSON.stringify(edge));

    // ---- The ring: its hole stays paper ----------------------------------------------------
    await io.clickPage(450, 60);
    await io.menu('effect-splatter');
    await io.evalIn("const s = document.getElementById('effect-field-preset'); s.value = 'sketch'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;");
    await sleep(400);
    await io.evalIn("document.getElementById('effect-options-ok').click(); return true;");
    await sleep(800);
    c.eq('the ring takes one too', (await io.effectsOf(RING))?.[0]?.type, 'splatter');
    const hole = await io.evalIn(SAMPLE(450, 150, 25, RED));
    c.ok('the paper shows through the ring\'s hole, where the hatch never goes', hole.ink === 0 && hole.paper > 500, JSON.stringify(hole));
    const band = await io.evalIn(SAMPLE(450, 77, 12, RED));
    c.ok('and its band is hatched red', band.ink > 5 && band.paper > 5, JSON.stringify(band));

    // ---- One undo step each; Expand Appearance ----------------------------------------------
    await io.key('z', 'KeyZ', 90, 2, 600);
    c.eq('one undo takes the ring\'s off', JSON.stringify((await io.effectsOf(RING)) ?? []), '[]');
    c.eq('and leaves the disc\'s', (await io.effectsOf(DISC))?.[0]?.type, 'splatter');

    await io.clickPage(150, 150 - 80);
    const before = await io.evalIn('return window.napkinCheck.strokeSummary().length;');
    const menu = await io.evalIn('return await window.napkin.getAppMenu();');
    const find = (items, id) => {
      for (const item of items) {
        if (item.id === id) return item;
        const inner = item.submenu ? find(item.submenu, id) : null;
        if (inner) return inner;
      }
      return null;
    };
    c.ok('Expand Appearance can bake it', find(menu.find((m) => m.label === 'Effect')?.submenu ?? [], 'expand-appearance')?.enabled !== false);
    await io.menu('expand-appearance', 800);
    const after = await io.evalIn('return window.napkinCheck.strokeSummary();');
    const rows = await io.evalIn('return window.napkinCheck.layerRows();');
    c.ok('the disc is marks of its own now: its hatch and its outline', after.length >= before + 1 && after.every((s) => s.id !== DISC), `${before} marks, then ${after.length}`);
    c.ok('in a group named for its layer', rows.some((r) => r.group && r.name === 'Disc'), JSON.stringify(rows.map((r) => [r.name, r.group])));
    const baked = await io.evalIn(SAMPLE(150, 150, 10, BLUE));
    c.ok('drawn as it was', baked.ink > 40 && baked.paper > 40, JSON.stringify(baked));
    await io.key('z', 'KeyZ', 90, 2, 600);
    c.eq('an undo puts the live effect back', (await io.effectsOf(DISC))?.[0]?.type, 'splatter');

    writeFileSync(svgPath, await io.evalIn('return window.napkinCheck.pageSvg();'));
  });

  // ---- The page's own SVG, read back ----------------------------------------------------------
  await session({ mode: 'new', sketchName: 'round-trip', importFiles: [svgPath] }, async (io) => {
    const marks = await io.evalIn('return window.napkinCheck.strokeSummary();');
    c.eq('the SVG comes back as the disc, the ring and the two lines, one mark each', marks.length, 4);
    const effects = await Promise.all(marks.map((m) => io.effectsOf(m.id)));
    c.ok('the disc keeps its live Splatter', effects.some((list) => list?.[0]?.type === 'splatter' && list[0].spacing === 3), JSON.stringify(effects));
    c.ok('both with their fills, and their outlines', marks.filter((m) => m.fill && !m.noStroke).length === 2, JSON.stringify(marks.map((m) => [m.fill, m.noStroke])));
    const copic = marks.findIndex((m) => m.tool === 'copic');
    const pencil = marks.findIndex((m) => m.tool === 'pencil');
    c.ok('the hatched Copic line comes back a Copic, as wide as it was', copic >= 0 && marks[copic].width === 14, JSON.stringify(marks.map((m) => [m.tool, m.width])));
    c.ok('with its Splatter on its stroke', effects[copic]?.[0]?.type === 'splatter' && effects[copic][0].target === 'stroke', JSON.stringify(effects[copic]));
    c.ok('and the hatched Pencil line a Pencil, with its lead', pencil >= 0 && marks[pencil].pencil?.grade === '2B', JSON.stringify(marks[pencil]?.pencil));
    c.ok('and its Splatter on its stroke', effects[pencil]?.[0]?.type === 'splatter' && effects[pencil][0].target === 'stroke', JSON.stringify(effects[pencil]));
    // Wherever the import put it, the disc's middle is hatched again.
    const disc = marks.find((m) => m.fill === '#2f6feb');
    const middle = disc?.bounds ? { x: (disc.bounds.minX + disc.bounds.maxX) / 2, y: (disc.bounds.minY + disc.bounds.maxY) / 2 } : { x: 150, y: 150 };
    const hatched = await io.evalIn(SAMPLE(middle.x, middle.y, 10, BLUE));
    c.ok('and the disc is painted hatched again', hatched.ink > 40 && hatched.paper > 40, JSON.stringify(hatched));
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
