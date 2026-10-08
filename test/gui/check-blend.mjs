/**
 * Napkin Blends on the canvas: a layer's blend, set from the layers panel, the
 * menus and the keys, mixing with what is under it, the paper included.
 *
 * Three sequences, each in an app of its own:
 * - A book of a yellow square under a blue one on kraft paper. The panel's
 *   Blend select sets Stack Blend on the blue square's layer: the overlap
 *   turns the yellow and the blue multiplied, and the blue over the paper the
 *   blue multiplied into the kraft - the paper is under the ink - while the
 *   yellow and the bare paper stay as they were. A toast names the mode; the
 *   select shows it; Layers > Blend checks its row; the layer row carries the
 *   blend's mark. Shift+Plus steps to the next mode and Shift+- back, one undo
 *   each; three undos put it back to Normal; the menu row sets it again. The
 *   page's thumbnail mixes as the page does. Grouped with Isolate Blending,
 *   the blend stays inside the group: the overlap still multiplies, and the
 *   blue over the paper is its own blue again. The page as Export SVG writes it
 *   carries both.
 * - Another editor's blends: an SVG whose group screens and is isolated by
 *   inline CSS, whose mark inside burns by a class rule, and whose top mark
 *   multiplies by its own style, read onto the layers they make.
 * - Napkin's own SVG back in: the first sequence's export, its CSS blend
 *   taken out as a sanitizer that strips styles would, so the blend comes
 *   back from `data-blend` alone and the group's isolation from its CSS.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const FOREIGN = resolve(import.meta.dirname, '..', 'imports', 'blend-foreign.svg');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-blend-check-'));
const TIME = '2026-10-01T00:00:00.000Z';
/** The first sequence's export, written for the third to import. */
const ROUND_TRIP = join(dir, 'round-trip.svg');

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

/** The two squares on kraft paper, as a book the app opens. */
function squaresBook() {
  const text = [
    'napkin 1',
    'page 400 300',
    'background #d9c49a',
    'stroke off',
    'layer "Yellow"',
    'fill #ffcc00',
    'rect 40 40 160 120',
    'layer "Blue"',
    'fill #3399ff',
    'rect 120 100 160 120',
  ].join('\n');
  const result = evaluate(text, { name: 'blend', timestamp: TIME });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  const path = join(dir, 'blend.skbk');
  writeFileSync(path, renderBook(result.book, { format: 'skbk' }));
  return path;
}

const KRAFT = [217, 196, 154];
const YELLOW = [255, 204, 0];
const BLUE = [51, 153, 255];
const multiply = (a, b) => a.map((v, i) => Math.round((v * b[i]) / 255));
const close = (got, want, tol = 6) => Array.isArray(got) && got.every((v, i) => Math.abs(v - want[i]) <= tol);

const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

async function sequence(name, launchOptions, run) {
  const app = launch(launchOptions);
  try {
    const page = await connect();
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
      eval: (code) => page.evalIn(code),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      layers: () => page.evalIn('return window.napkinCheck.layerRows();'),
      blendOf: (id) => page.evalIn(`return window.napkinCheck.blendOf(${JSON.stringify(id)});`),
      bar: () => page.evalIn('return await window.napkin.getAppMenu();'),
      toast: () => page.evalIn("return document.getElementById('toast').textContent;"),
      async menu(id, wait = 450) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(wait);
        return ran;
      },
      /** A key with its physical key named, as a keyboard sends it. */
      async key(key, code, vk, modifiers = 0) {
        for (const type of ['rawKeyDown', 'keyUp']) {
          await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
        }
        await sleep(400);
      },
      async row(label) {
        const found = await page.evalIn(`
          const row = [...document.querySelectorAll('.layer-row')].find((r) => r.querySelector('.layer-name')?.textContent === ${JSON.stringify(label)});
          if (!row) return false;
          row.click();
          return true;`);
        await sleep(300);
        return found;
      },
      /** A page point, in client pixels. */
      async toClient(p) {
        const r = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top };`);
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: r.x + v.panX + p.x * v.zoom, y: r.y + v.panY + p.y * v.zoom };
      },
      /** The canvas's colour at a page point, as [r, g, b]. */
      async pixel(p) {
        const at = await this.toClient(p);
        await page.evalIn('await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); return true;');
        return page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          return Array.from(cv.getContext('2d').getImageData(Math.round((${at.x} - r.left) * k), Math.round((${at.y} - r.top) * k), 1, 1).data.slice(0, 3));`);
      },
    };
    await run(io);
    const errors = await page.evalIn('return window.__errors;');
    c.ok(`${name}: the page threw nothing`, errors.length === 0, errors.join(' | '));
  } catch (error) {
    c.ok(`${name}: the sequence ran`, false, String(error?.stack ?? error));
  } finally {
    await stop(app);
  }
}

try {
  await sequence('Blend a layer', { mode: 'book', filePath: squaresBook() }, async (io) => {
    const name = 'Blend a layer';
    const marks = await io.marks();
    const yellow = marks.find((m) => m.fill === '#ffcc00');
    const blue = marks.find((m) => m.fill === '#3399ff');
    const y = yellow.bounds;
    const b = blue.bounds;
    const overlap = { x: (b.minX + y.maxX) / 2, y: (b.minY + y.maxY) / 2 };
    const blueOnly = { x: (y.maxX + b.maxX) / 2, y: (y.maxY + b.maxY) / 2 };
    const yellowOnly = { x: (y.minX + b.minX) / 2, y: (y.minY + b.minY) / 2 };
    const paperOnly = { x: b.maxX + 30, y: y.minY };

    c.ok(`${name}: before, the blue covers the yellow`, close(await io.pixel(overlap), BLUE), JSON.stringify(await io.pixel(overlap)));

    c.ok(`${name}: the Blue row selects`, await io.row('Blue'));
    await io.eval("const s = document.getElementById('layer-blend'); s.value = 'stack'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;");
    await sleep(500);
    c.eq(`${name}: the panel's select sets Stack Blend on the blue square's layer`, (await io.blendOf(blue.layerId))?.blend, 'stack');
    const mixed = await io.pixel(overlap);
    c.ok(`${name}: where they overlap, the yellow and the blue multiplied`, close(mixed, multiply(YELLOW, BLUE)), `${mixed} against ${multiply(YELLOW, BLUE)}`);
    const onPaper = await io.pixel(blueOnly);
    c.ok(`${name}: and the blue over the paper multiplied into the kraft`, close(onPaper, multiply(KRAFT, BLUE)), `${onPaper} against ${multiply(KRAFT, BLUE)}`);
    c.ok(`${name}: the yellow, Normal, is as it was`, close(await io.pixel(yellowOnly), YELLOW), JSON.stringify(await io.pixel(yellowOnly)));
    c.ok(`${name}: and so is the bare paper`, close(await io.pixel(paperOnly), KRAFT), JSON.stringify(await io.pixel(paperOnly)));
    c.eq(`${name}: a toast names the mode and the layer`, await io.toast(), 'Stack Blend (Multiply): Blue');
    c.eq(`${name}: the select shows it`, await io.eval("return document.getElementById('layer-blend').value;"), 'stack');
    const layers = menuOf(await io.bar(), 'Layers');
    c.ok(`${name}: Layers > Blend checks Stack Blend, and not Normal`, rowOf(layers, 'blend-stack')?.checked === true && rowOf(layers, 'blend-normal')?.checked === false, JSON.stringify([rowOf(layers, 'blend-stack')?.checked, rowOf(layers, 'blend-normal')?.checked]));
    const badge = await io.eval(`
      const row = [...document.querySelectorAll('.layer-row.is-blended')];
      return row.map((r) => [r.querySelector('.layer-name')?.textContent, r.querySelector('.layer-blend-badge')?.title]);`);
    c.ok(`${name}: the Blue row carries the blend's mark, named`, badge.length === 1 && badge[0][0] === 'Blue' && badge[0][1].startsWith('Stack Blend (Multiply)'), JSON.stringify(badge));

    await io.key('+', 'Equal', 187, 8);
    c.eq(`${name}: Shift+Plus steps to the next mode`, (await io.blendOf(blue.layerId))?.blend, 'scorch');
    await io.key('_', 'Minus', 189, 8);
    c.eq(`${name}: and Shift+- back`, (await io.blendOf(blue.layerId))?.blend, 'stack');
    await io.key('z', 'KeyZ', 90, 2);
    c.eq(`${name}: one undo takes back one step`, (await io.blendOf(blue.layerId))?.blend, 'scorch');
    await io.key('z', 'KeyZ', 90, 2);
    await io.key('z', 'KeyZ', 90, 2);
    c.eq(`${name}: three put it back to Normal`, (await io.blendOf(blue.layerId))?.blend, 'normal');
    c.ok(`${name}: and the blue covers the yellow again`, close(await io.pixel(overlap), BLUE), JSON.stringify(await io.pixel(overlap)));

    await io.row('Blue');
    await io.menu('blend-stack');
    c.eq(`${name}: the menu row sets it again`, (await io.blendOf(blue.layerId))?.blend, 'stack');

    // The pages panel's thumbnail of this page, at the overlap.
    await io.menu('toggle-pages', 700);
    const thumb = await io.eval(`
      const cv = document.querySelector('.thumb.is-active canvas');
      if (!cv) return null;
      const k = cv.width / ${400};
      return Array.from(cv.getContext('2d').getImageData(Math.round(${overlap.x} * k), Math.round(${overlap.y} * k), 1, 1).data.slice(0, 3));`);
    c.ok(`${name}: the page's thumbnail mixes as the page does`, close(thumb, multiply(YELLOW, BLUE), 10), JSON.stringify(thumb));
    await io.menu('toggle-pages', 400);

    // Grouped, and isolated: the blend stays inside the group.
    await io.eval("document.getElementById('tool-select').click(); return true;");
    await io.menu('select-all', 300);
    await io.menu('group-layer', 600);
    const group = (await io.layers()).find((row) => row.group);
    c.ok(`${name}: the two squares are grouped`, Boolean(group), JSON.stringify(await io.layers()));
    await io.row(group.name);
    await io.menu('blend-isolate', 600);
    c.eq(`${name}: Isolate Blending turns on for the group`, (await io.blendOf(group.id))?.isolate, true);
    c.ok(`${name}: inside the group the overlap still multiplies`, close(await io.pixel(overlap), multiply(YELLOW, BLUE)), JSON.stringify(await io.pixel(overlap)));
    c.ok(`${name}: but the blue over the paper is its own blue: the blend does not reach past the group`, close(await io.pixel(blueOnly), BLUE), JSON.stringify(await io.pixel(blueOnly)));

    const svg = await io.eval('return window.napkinCheck.pageSvg();');
    c.ok(`${name}: the page as Export SVG writes it multiplies the blue and isolates the group`, /data-blend="stack" style="mix-blend-mode:multiply"/.test(svg) && /style="isolation:isolate"/.test(svg));
    writeFileSync(ROUND_TRIP, svg.replace(/mix-blend-mode:[a-z-]+;?/g, ''));
  });

  await sequence("Another editor's blends", { mode: 'new', sketchName: 'foreign', importFiles: [FOREIGN] }, async (io) => {
    const name = "Another editor's blends";
    const rows = await io.layers();
    const named = (label) => rows.find((row) => row.name === label);
    c.ok(`${name}: the group that screens, by inline CSS, screens, isolated`, named('glow')?.group === true && named('glow')?.blend === 'sheer' && named('glow')?.isolate === true, JSON.stringify(named('glow')));
    c.eq(`${name}: the mark inside that burns by a class rule burns`, named('ember')?.blend, 'scorch');
    c.eq(`${name}: the mark beside it is Normal`, named('sun')?.blend, 'normal');
    c.eq(`${name}: the top mark that multiplies by its own style multiplies`, named('shade')?.blend, 'stack');
    c.eq(`${name}: and the plain group is Normal`, named('base')?.blend, 'normal');
  });

  if (!existsSync(ROUND_TRIP)) {
    c.ok("Napkin's own SVG, back in: the first sequence wrote its export", false);
  } else {
    await sequence("Napkin's own SVG, back in", { mode: 'new', sketchName: 'round-trip', importFiles: [ROUND_TRIP] }, async (io) => {
      const name = "Napkin's own SVG, back in";
      const rows = await io.layers();
      const named = (label) => rows.find((row) => row.name === label);
      c.eq(`${name}: the blue square's layer is Stack Blend again, read from data-blend alone`, named('Blue')?.blend, 'stack');
      c.eq(`${name}: the yellow square's is Normal`, named('Yellow')?.blend, 'normal');
      const group = rows.find((row) => row.group);
      c.ok(`${name}: and the group around them is isolated again`, group?.isolate === true, JSON.stringify(rows));
    });
  }

  process.exitCode = c.summary() ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
