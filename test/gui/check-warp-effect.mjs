/**
 * Warp in the app: Effect > Warp, its options with their live thumbnail, and
 * what the canvas paints.
 *
 * The book is a blue card, a two-part "Logo" group of orange tiles, and a
 * line of text, on white paper. The card is selected and Effect > Warp > Arc
 * opens the Warp Options; the preview bends the card's top into an arc, so the
 * paper shows where its top-left corner was and its top's middle stays blue.
 * The form's style and Part change together, and OK keeps the Warp as one
 * undo step; an undo takes it off, and Apply Last Effect puts it back. The
 * group, lit in the Layers panel, takes a Chart Warp and its tiles rise as
 * one. With nothing selected the Warp rows are greyed, and with the text
 * selected they are not: text bends through its outlines (check-outlines.mjs
 * bends one). The page's SVG is
 * read into a second app, and the card and the group come back with their
 * live Warps. Last, Expand Appearance bakes the card's Warp into its anchors.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-warp-check-'));
const TIME = '2026-10-02T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const result = evaluate(
  [
    'napkin 1',
    'page 720 440',
    'background #ffffff',
    'layer "Card"',
    'color #1f2328 width 2 fill #2f6feb',
    'rect 150 150 300 120',
    'fill #f28c28',
    'group "Logo" {',
    '  rect 500 300 80 60',
    '  rect 600 300 80 60',
    '}',
    'layer "Note"',
    'fill #1f2328',
    'text "Note" at 520 80 size 28',
  ].join('\n'),
  { name: 'warp', timestamp: TIME },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'warp.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const strokes = result.book.sketches[0].strokes;
const CARD = strokes[0].id;
const [LEFT, RIGHT] = strokes.slice(1, 3).map((s) => s.id);

/** The canvas pixels in a box round a page point, sorted into a color's, paper, and the rest. */
const SAMPLE = (x, y, half, rgb) => `
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  const k = cv.width / r.width;
  const cx = Math.round((v.panX + ${x} * v.zoom) * k);
  const cy = Math.round((v.panY + ${y} * v.zoom) * k);
  const h = Math.max(1, Math.round(${half} * v.zoom * k));
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
const ORANGE = [242, 140, 40];

const CLIENT = (x, y) => `
  const r = document.getElementById('canvas').getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };
`;

/** A row of a menu tree by its id, at any depth. */
const FIND = `
  const find = (items, id) => {
    for (const item of items) {
      if (item.id === id) return item;
      const inner = item.submenu ? find(item.submenu, id) : null;
      if (inner) return inner;
    }
    return null;
  };
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
      async row(label) {
        const found = await page.evalIn(`
          const row = [...document.querySelectorAll('.layer-row')].find((r) => r.querySelector('.layer-name')?.textContent === ${JSON.stringify(label)});
          if (!row) return false;
          row.click();
          return true;`);
        await sleep(400);
        return found;
      },
      /** Whether a menu row is enabled, as the menu bar has it now. */
      async enabled(id) {
        return page.evalIn(`${FIND} const menu = await window.napkin.getAppMenu(); return find(menu, ${JSON.stringify(id)})?.enabled !== false;`);
      },
      async select(field, value) {
        await page.evalIn(`const s = document.getElementById('effect-field-${field}'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
        await sleep(400);
      },
      effectsOf: async (id) => page.evalIn(`return window.napkinCheck.effectsOf(${JSON.stringify(id)});`),
      sample: (x, y, half, rgb) => page.evalIn(SAMPLE(x, y, half, rgb)),
    };
    await run(io);
    c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
  } finally {
    await stop(app);
  }
}

const svgPath = join(dir, 'round-trip.svg');

try {
  await session({ mode: 'book', filePath: bookPath }, async (io) => {
    const before = await io.sample(160, 160, 3, BLUE);
    c.ok('the card is solid blue at its top-left corner to begin with', before.ink > 20 && before.paper === 0, JSON.stringify(before));

    // ---- The card, through Effect > Warp > Arc ------------------------------------------------
    await io.key('s', 'KeyS', 83);
    await io.clickPage(300, 210);
    await io.menu('effect-warp-arc');
    let opts = await io.evalIn('return window.napkinCheck.effectOptionsState();');
    c.ok('Effect > Warp > Arc opens the Warp Options', opts.open && opts.title === 'Warp', JSON.stringify(opts));
    c.eq('Style, Part, Orientation, Bend, then the Distortion', opts.fields.join(' '), 'style part orientation bend distortH distortV');
    c.ok('starting as a vector editor\'s do: Arc, bent 50%', opts.effect?.style === 'arc' && opts.effect?.bend === 50, JSON.stringify(opts.effect));
    const thumbnail = await io.evalIn("const svg = document.querySelector('.effect-warp-thumbnail'); return svg ? { lines: svg.querySelectorAll('polyline').length, box: svg.getAttribute('viewBox') } : null;");
    c.ok('a thumbnail shows the style bending a grid', thumbnail?.lines === 12, JSON.stringify(thumbnail));

    const previewed = await io.sample(160, 160, 3, BLUE);
    c.ok('the preview bends the card: paper where its top-left corner was', previewed.paper > 20 && previewed.ink === 0, JSON.stringify(previewed));
    const middle = await io.sample(300, 158, 3, BLUE);
    c.ok('and the middle of its top stays', middle.ink > 20, JSON.stringify(middle));

    await io.evalIn("window.napkinCheck.setEffectOption('bend', 90); return true;");
    await sleep(400);
    const bent = await io.evalIn("return document.querySelector('.effect-warp-thumbnail')?.getAttribute('viewBox');");
    c.ok('the thumbnail follows the form', bent !== thumbnail?.box, `${thumbnail?.box} then ${bent}`);
    await io.select('style', 'shell');
    const parts = await io.evalIn("return [...(document.getElementById('effect-field-part')?.options ?? [])].map((o) => o.value);");
    c.eq('Shell offers its lower and upper edge', JSON.stringify(parts), JSON.stringify(['lower', 'upper']));
    await io.select('style', 'twirl');
    c.eq('a style that bends the whole has no Part', await io.evalIn("return document.getElementById('effect-field-part') === null;"), true);
    await io.select('style', 'arc');
    await io.evalIn("window.napkinCheck.setEffectOption('bend', 50); return true;");
    await sleep(300);
    await io.evalIn("document.getElementById('effect-options-ok').click(); return true;");
    await sleep(800);
    const kept = (await io.effectsOf(CARD))?.mark ?? [];
    c.ok('OK keeps the Warp on the card', kept.length === 1 && kept[0].type === 'warp' && kept[0].style === 'arc' && kept[0].bend === 50, JSON.stringify(kept));
    const summary = (await io.evalIn('return window.napkinCheck.strokeSummary();')).find((s) => s.id === CARD);
    c.ok('its box is where it is bent: its corners swung out past where they were', summary?.bounds?.minX < 149 && summary?.bounds?.maxY > 271, JSON.stringify(summary?.bounds));

    await io.key('z', 'KeyZ', 90, 2, 600);
    c.eq('one undo takes it off', JSON.stringify((await io.effectsOf(CARD))?.mark ?? []), '[]');
    const back = await io.sample(160, 160, 3, BLUE);
    c.ok('and the card is as it was', back.ink > 20, JSON.stringify(back));
    await io.clickPage(300, 210);
    await io.key('E', 'KeyE', 69, 2 | 8, 700);
    c.eq('Apply Last Effect puts the Warp back', (await io.effectsOf(CARD))?.mark?.[0]?.style, 'arc');

    // ---- The group: lit in the Layers panel, it bends as one -----------------------------------
    if (!(await io.evalIn("return window.napkinCheck.panelState('layers')?.open === true;"))) await io.key('l', 'KeyL', 76, 2, 600);
    const lit = await io.row('Logo');
    c.ok('the group\'s row lights', lit);
    const rightBefore = await io.sample(670, 305, 3, ORANGE);
    c.ok('the right tile is orange at its top-right to begin with', rightBefore.ink > 20, JSON.stringify(rightBefore));
    await io.menu('effect-warp-chart');
    const note = await io.evalIn("return document.querySelector('.effect-options-note')?.textContent ?? '';");
    c.ok('the Warp Options say the group bends as one', /bends as one/.test(note), note);
    await io.evalIn("document.getElementById('effect-options-ok').click(); return true;");
    await sleep(800);
    // The script's group holds a plain layer of its name: the group is the one marked so.
    const logo = (await io.effectsOf(RIGHT))?.layers?.find((layer) => layer.group && layer.name === 'Logo');
    c.ok('the group takes the Warp, not its tiles', logo?.effects?.[0]?.style === 'chart' && ((await io.effectsOf(RIGHT))?.mark ?? []).length === 0, JSON.stringify(logo));
    const risen = (await io.evalIn('return window.napkinCheck.strokeSummary();')).filter((s) => s.id === LEFT || s.id === RIGHT);
    const [left, right] = [risen.find((s) => s.id === LEFT), risen.find((s) => s.id === RIGHT)];
    // Chart at 50% lifts the group's right edge a quarter of its height, 15, and leaves its left edge.
    c.ok('the tiles rise as one, across the group\'s box: the right one most', Math.abs(right.bounds.minY - 285) < 0.5 && left.bounds.minY > 290 && left.bounds.maxY > 359.5, JSON.stringify([left.bounds, right.bounds]));

    // ---- Nothing selected, the Warp rows are greyed; the text takes them --------------------------
    await io.key('Escape', 'Escape', 27);
    await io.clickPage(680, 200);
    c.eq('with nothing selected, Effect > Warp > Arc is greyed', await io.enabled('effect-warp-arc'), false);
    await io.clickPage(540, 95);
    c.eq('with the text selected, it is not: text bends through its outlines', await io.enabled('effect-warp-arc'), true);
    c.ok('nor is Splatter', await io.enabled('effect-splatter'));
    await io.clickPage(300, 210);
    c.eq('with the card selected, they are live too', await io.enabled('effect-warp-arc'), true);

    writeFileSync(svgPath, await io.evalIn('return window.napkinCheck.pageSvg();'));

    // ---- Expand Appearance: the card's Warp baked into its anchors --------------------------------
    await io.menu('expand-appearance', 800);
    const expanded = await io.effectsOf(CARD);
    c.eq('Expand Appearance takes the Warp off the card', JSON.stringify(expanded?.mark ?? []), '[]');
    const geometry = await io.evalIn(`return window.napkinCheck.strokeGeometry(${JSON.stringify(CARD)});`);
    const curves = (geometry?.anchors ?? []).filter((anchor) => anchor.hIn || anchor.hOut).length;
    c.ok('and bakes it into its own anchors, curved and few', geometry?.anchors?.length > 4 && geometry.anchors.length <= 8 && curves > 0, `${geometry?.anchors?.length} anchors, ${curves} with handles`);
    const baked = await io.sample(160, 160, 3, BLUE);
    c.ok('drawn as it was', baked.paper > 20, JSON.stringify(baked));
    await io.key('z', 'KeyZ', 90, 2, 600);
    c.eq('an undo puts the live Warp back', (await io.effectsOf(CARD))?.mark?.[0]?.type, 'warp');
  });

  // ---- The page's own SVG, read back --------------------------------------------------------------
  await session({ mode: 'new', sketchName: 'round-trip', importFiles: [svgPath] }, async (io) => {
    const marks = await io.evalIn('return window.napkinCheck.strokeSummary();');
    const card = marks.find((m) => m.fill === '#2f6feb');
    c.ok('the card comes back as it was drawn, a rectangle of four corners', card?.anchors === 4, JSON.stringify(marks.map((m) => [m.fill, m.anchors])));
    c.eq('with its live Warp', (await io.effectsOf(card?.id))?.mark?.[0]?.style, 'arc');
    const tile = marks.find((m) => m.fill === '#f28c28');
    const layers = (await io.effectsOf(tile?.id))?.layers ?? [];
    c.ok('and the tiles under a group with its live Warp', layers.some((layer) => layer.group && layer.effects?.[0]?.style === 'chart'), JSON.stringify(layers));
    const painted = await io.sample(card ? (card.bounds.minX + card.bounds.maxX) / 2 : 300, card ? card.bounds.minY + 6 : 158, 3, BLUE);
    c.ok('and the card is painted bent again', painted.ink > 10, JSON.stringify(painted));
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
