/**
 * 3D in the app: Effect > 3D > Extrude and Revolve, 3D Options, and what the
 * canvas paints.
 *
 * The book is a blue card and a line of text on white paper. The card is
 * selected and Effect > 3D > Extrude builds it in depth at once, with 3D
 * Options up on it: its top face shows above where the card was, lit lighter
 * than its front, and its box takes in its depth. One undo takes it off, and
 * Apply Last Effect puts it back. The panel shows Revolve's fields for a
 * revolve and Extrude's for an extrusion, each change made at once, and Cap
 * off leaves it hollow. With nothing selected the 3D rows are greyed, and
 * with the text selected they are not: text is built from its outlines. The
 * page's SVG is read into a second app, and the card comes back as it was
 * drawn, with its live 3D. Last, Expand Appearance turns the card into a
 * group of its faces. The gumball, which check-gumball.mjs drives, is off.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-3d-check-'));
const TIME = '2026-10-02T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const result = evaluate(
  ['napkin 1', 'page 720 440', 'background #ffffff', 'layer "Card"', 'color #1f2328 width 2 fill #2f6feb', 'rect 150 150 200 120', 'layer "Note"', 'fill #1f2328', 'text "Note" at 520 80 size 28'].join('\n'),
  { name: 'three-d', timestamp: TIME },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'three-d.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const CARD = result.book.sketches[0].strokes[0].id;

/** The canvas's color at a page point, as [r, g, b], after two frames. */
const PIXEL = (x, y) => `
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  const k = cv.width / r.width;
  const d = cv.getContext('2d').getImageData(Math.round((v.panX + ${x} * v.zoom) * k), Math.round((v.panY + ${y} * v.zoom) * k), 1, 1).data;
  return [d[0], d[1], d[2]];
`;
const CLIENT = (x, y) => `
  const r = document.getElementById('canvas').getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };
`;
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
const paper = (rgb) => rgb.every((v) => v > 235);
const blueish = (rgb) => rgb[2] > rgb[0] + 40 && rgb[2] > 90;

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
      evalIn: (code) => page.evalIn(code),
      async key(key, code, vk, modifiers = 0, wait = 400) {
        for (const type of ['rawKeyDown', 'keyUp']) {
          await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
        }
        await sleep(wait);
      },
      async menu(id, wait = 700) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(wait);
        return ran;
      },
      async clickPage(x, y) {
        const at = await page.evalIn(CLIENT(x, y));
        await page.click(at.x, at.y);
        await sleep(350);
      },
      async enabled(id) {
        return page.evalIn(`${FIND} const menu = await window.napkin.getAppMenu(); return find(menu, ${JSON.stringify(id)})?.enabled !== false;`);
      },
      async select(field, value) {
        await page.evalIn(`const s = document.getElementById('three-d-field-${field}'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
        await sleep(500);
      },
      panel: () => page.evalIn('return window.napkinCheck.threeDPanelState();'),
      fields: async () => Object.keys((await page.evalIn('return window.napkinCheck.threeDPanelState();')).fields),
      effectsOf: async (id) => page.evalIn(`return window.napkinCheck.effectsOf(${JSON.stringify(id)});`),
      pixel: (x, y) => page.evalIn(PIXEL(x, y)),
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
    // The gumball, which check-gumball.mjs drives, would stand over the pixels this reads.
    await io.evalIn('return window.napkin.updateSettings({ show3dGumball: false }).then(() => true);');
    // The top face of the card built in depth will be a thin band above the card's own top, (180, 143) on it.
    c.ok('the paper shows just above the card to begin with', paper(await io.pixel(180, 143)));

    // ---- Effect > 3D > Extrude: built at once, 3D Options up ----------------------------------
    await io.key('s', 'KeyS', 83);
    await io.clickPage(250, 210);
    await io.menu('effect-3d-extrude');
    const opened = await io.panel();
    const built = (await io.effectsOf(CARD))?.mark ?? [];
    c.ok(
      'Effect > 3D > Extrude builds the card at once, Off-Axis Front, 50 deep, with 3D Options up on it',
      opened.open && opened.title === 'Path: Extrude' && built.length === 1 && built[0].kind === 'extrude' && built[0].depth === 50 && JSON.stringify(built[0].rotation) === '[-18,-26,8]',
      JSON.stringify([opened.open, opened.title, built]),
    );
    c.eq(
      "an extrusion's fields",
      Object.keys(opened.fields).join(' '),
      'kind depth caps rotation.0 rotation.1 rotation.2 perspective position.0 position.1 position.2 scale.0 scale.1 scale.2 shading light.azimuth light.elevation light.intensity light.ambient',
    );
    const top = await io.pixel(180, 143);
    c.ok('it is built in depth: its top face shows above where the card was', blueish(top), JSON.stringify(top));
    const front = await io.pixel(238, 216);
    c.ok('lit otherwise than its front', blueish(front) && Math.abs(top[2] - front[2]) + Math.abs(top[1] - front[1]) > 20, `${top} and ${front}`);
    const summary = (await io.evalIn('return window.napkinCheck.strokeSummary();')).find((s) => s.id === CARD);
    c.ok('its box takes in its depth', summary?.bounds?.minY < 150, JSON.stringify(summary?.bounds));

    await io.key('z', 'KeyZ', 90, 2, 700);
    c.eq('one undo takes it off', JSON.stringify((await io.effectsOf(CARD))?.mark ?? []), '[]');
    c.ok('and the paper shows above the card again', paper(await io.pixel(180, 143)));
    await io.clickPage(250, 210);
    await io.key('E', 'KeyE', 69, 2 | 8, 800);
    c.eq('Apply Last Effect puts it back', (await io.effectsOf(CARD))?.mark?.[0]?.type, '3d');

    // ---- 3D Options' fields, each change at once ---------------------------------------------
    await io.select('kind', 'revolve');
    c.ok("Revolve's fields: its angle, offset, axis and steps, and no depth", (await io.fields()).join(' ').startsWith('kind angle offset axis segments caps rotation.0'), (await io.fields()).join(' '));
    c.eq('and the card revolves at once', (await io.effectsOf(CARD))?.mark?.[0]?.kind, 'revolve');
    await io.select('kind', 'extrude');
    await io.evalIn("const box = document.getElementById('three-d-field-caps'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); return true;");
    await new Promise((done) => setTimeout(done, 500));
    c.eq('Cap off leaves it hollow', (await io.effectsOf(CARD))?.mark?.[0]?.caps, false);
    await io.evalIn("const box = document.getElementById('three-d-field-caps'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); return true;");
    await new Promise((done) => setTimeout(done, 500));
    const kept = (await io.effectsOf(CARD))?.mark ?? [];
    c.ok('Cap on and Extrude again: a solid extrusion', kept.length === 1 && kept[0].type === '3d' && kept[0].kind === 'extrude' && kept[0].caps === true, JSON.stringify(kept));

    // ---- Nothing selected, the 3D rows are greyed; the text takes them ---------------------------
    await io.key('Escape', 'Escape', 27);
    await io.clickPage(680, 400);
    c.eq('with nothing selected, Effect > 3D > Extrude is greyed', await io.enabled('effect-3d-extrude'), false);
    await io.clickPage(540, 95);
    c.eq('with the text selected, it is not: text is built from its outlines', await io.enabled('effect-3d-extrude'), true);
    await io.clickPage(250, 210);
    c.eq('with the card selected, it is live too', await io.enabled('effect-3d-extrude'), true);

    writeFileSync(svgPath, await io.evalIn('return window.napkinCheck.pageSvg();'));

    // ---- Expand Appearance: a group of faces ----------------------------------------------------
    const before = (await io.evalIn('return window.napkinCheck.strokeSummary();')).length;
    await io.menu('expand-appearance', 900);
    const after = await io.evalIn('return window.napkinCheck.strokeSummary();');
    const rows = await io.evalIn('return window.napkinCheck.layerRows();');
    c.ok('Expand Appearance turns the card into its faces', after.length === before + 2 && after.every((s) => s.id !== CARD) && after.filter((s) => s.fill).length >= 3, `${before} marks, then ${after.length}`);
    c.ok('in a group named for its layer', rows.some((r) => r.group && r.name === 'Card'), JSON.stringify(rows.map((r) => [r.name, r.group])));
    c.ok('drawn as it was', blueish(await io.pixel(180, 143)));
    await io.key('z', 'KeyZ', 90, 2, 700);
    c.eq('an undo puts the live 3D back', (await io.effectsOf(CARD))?.mark?.[0]?.type, '3d');
  });

  // ---- The page's own SVG, read back -------------------------------------------------------------
  await session({ mode: 'new', sketchName: 'round-trip', importFiles: [svgPath] }, async (io) => {
    await io.evalIn('return window.napkin.updateSettings({ show3dGumball: false }).then(() => true);');
    const marks = await io.evalIn('return window.napkinCheck.strokeSummary();');
    const card = marks.find((m) => m.fill === '#2f6feb');
    c.ok('the card comes back as it was drawn, a rectangle of four corners', card?.anchors === 4, JSON.stringify(marks.map((m) => [m.fill, m.anchors])));
    const effects = (await io.effectsOf(card?.id))?.mark ?? [];
    c.ok('with its live 3D', effects[0]?.type === '3d' && effects[0]?.depth === 50, JSON.stringify(effects));
    const box = card?.bounds;
    // The top face, as it was drawn: 30 in from the left of the faces' box, and 9 down.
    const top = box ? await io.pixel(box.minX + 30.5, box.minY + 9.35) : [255, 255, 255];
    c.ok('and is painted in depth again', blueish(top), JSON.stringify(top));
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
