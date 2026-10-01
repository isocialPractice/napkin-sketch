/**
 * The Smear: a blending stump for the Pencil's graphite (src/core/smudge.ts).
 *
 * Four sequences, each in an app of its own:
 * - Hatching smeared: the Sketch menu's Smear row after the Pencil's, on
 *   Shift+N, and its button after the Pencil's, the canvas keeping its
 *   height; Quick Width and Quick Opacity sizing the stump and setting its
 *   strength; a drag across 4B hatching smearing it as it goes; after it,
 *   the spread of tones inside down, tone past the hatching's old edge, the
 *   marks' boxes grown and a pass on each, no mark and no layer added; one
 *   undo back.
 * - The selection: with one line selected, only that line is smeared.
 * - A Brush line: a smear over it changes nothing, and says so once.
 * - The round trip: the page as Export SVG writes it, imported again, brings
 *   the marks back with their passes.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-smear-check-'));
const TIME = '2026-09-30T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

/** A script's book, written where the app can open it. */
function bookOf(name, text) {
  const result = evaluate(text, { name, timestamp: TIME });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  const path = join(dir, `${name}.skbk`);
  writeFileSync(path, renderBook(result.book, { format: 'skbk' }));
  return path;
}

const HATCHING = (tool) => `napkin 1
page 1280 800
name "hatching"
layer "Hatching"
${tool}
width 3
repeat 16 as i {
  line (400 + i * 8) 250 (440 + i * 8) 450
}
`;

/** What the round-trip sequence imports: the smeared page as Export SVG wrote it. */
let smearedSvg = null;

const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
const labelsOf = (items) => items.map((item) => (item.type === 'separator' ? '---' : item.label));

async function sequence(name, launchOptions, run) {
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
      eval: (code) => page.evalIn(code),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      layers: () => page.evalIn('return window.napkinCheck.layerRows();'),
      smearState: () => page.evalIn('return window.napkinCheck.smearState();'),
      tool: () => page.evalIn("return document.getElementById('canvas').dataset.tool;"),
      toast: () => page.evalIn("return document.getElementById('toast').textContent;"),
      bar: () => page.evalIn('return await window.napkin.getAppMenu();'),
      rect: () => page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`),
      async menu(id, wait = 450) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(wait);
        return ran;
      },
      async click(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(300);
      },
      async chord(code, key, modifiers = 0) {
        await page.chord(code, key, modifiers);
        await sleep(200);
      },
      /** Types a quick feature's value: its key, then the digits, then waits out its timer. */
      async quick(code, key, digits) {
        await this.chord(code, key);
        for (const d of digits) await this.chord(48 + Number(d), d);
        await sleep(1800);
      },
      /** A page point, in client pixels. */
      async toClient(p) {
        const r = await this.rect();
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: r.x + v.panX + p.x * v.zoom, y: r.y + v.panY + p.y * v.zoom };
      },
      async hover(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
        await sleep(200);
      },
      /** A press, a walk through `points` in client pixels, and the release; `during` runs before the release. */
      async drag(points, during) {
        const [a] = points;
        await this.hover(a);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
        for (const p of points.slice(1)) {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(10);
        }
        if (during) await during();
        const b = points[points.length - 1];
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(500);
        for (let k = 0; k < 20 && (await page.evalIn('return window.napkinCheck.inputState().pressKind;')) !== null; k++) await sleep(100);
      },
      /** A straight drag in page points, a step every 4 page pixels. */
      async across(from, to) {
        const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4));
        const points = [];
        for (let i = 0; i <= steps; i++) points.push(await this.toClient({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }));
        return points;
      },
      /** The canvas's tone along a row of page points: mean luminance and how much it varies. */
      async tone(y, x0, x1) {
        const a = await this.toClient({ x: x0, y });
        const b = await this.toClient({ x: x1, y });
        return page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          const row = Math.round((${a.y} - r.top) * k);
          const x0 = Math.round((${a.x} - r.left) * k);
          const x1 = Math.round((${b.x} - r.left) * k);
          const d = cv.getContext('2d').getImageData(x0, row, x1 - x0, 1).data;
          const lum = [];
          for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
          const mean = lum.reduce((s, v) => s + v, 0) / lum.length;
          const sd = Math.sqrt(lum.reduce((s, v) => s + (v - mean) * (v - mean), 0) / lum.length);
          return { mean, sd };`);
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
  await sequence('Hatching smeared', { mode: 'book', filePath: bookOf('hatching', HATCHING('pencil 4B')) }, async (io) => {
    const name = 'Hatching smeared';
    const sketch = menuOf(await io.bar(), 'Sketch');
    const labels = labelsOf(sketch);
    c.ok(`${name}: the Sketch menu has Smear after the Pencil`, labels.indexOf('Smear') === labels.indexOf('Pencil') + 1, labels.join(' | '));
    c.ok(`${name}: on Shift+N`, /^Shift\+N$/.test(sketch.find((row) => row.label === 'Smear')?.accelerator ?? ''), JSON.stringify(sketch.find((row) => row.label === 'Smear')));
    c.ok(`${name}: its button after the Pencil's`, await io.eval("return document.getElementById('tool-pencil').nextElementSibling?.id === 'tool-smear';"));
    c.ok(`${name}: and the canvas keeps its height`, Math.abs((await io.rect()).h - 617.67) < 1, String((await io.rect()).h));

    await io.chord(78, 'N', 8);
    c.eq(`${name}: Shift+N takes the Smear`, await io.tool(), 'smear');
    c.ok(`${name}: with a ring for a cursor`, (await io.eval("return document.getElementById('canvas').style.cursor;")).startsWith('url('));
    await io.quick(87, 'w', '24');
    c.eq(`${name}: Quick Width sizes the stump`, await io.eval('return window.napkinCheck.inputState().width;'), 24);
    await io.quick(81, 'q', '80');
    c.eq(`${name}: and Quick Opacity sets its strength, and says so`, await io.toast(), 'Smear: strength 80%.');

    const before = await io.marks();
    const layers = (await io.layers()).length;
    const inside = await io.tone(350, 420, 520);
    const past = await io.tone(350, 534, 548);
    let live = null;
    await io.drag(await io.across({ x: 380, y: 350 }, { x: 600, y: 350 }), async () => {
      live = await io.smearState();
    });
    c.ok(`${name}: the drag smears the marks it reaches as it goes`, live && live.reached.length >= 12, JSON.stringify(live));
    const after = await io.marks();
    c.eq(`${name}: no mark added`, after.length, before.length);
    c.eq(`${name}: and no layer`, (await io.layers()).length, layers);
    const smeared = after.filter((m) => m.smudges.length === 1);
    c.ok(`${name}: each line it reached keeps a pass, the stump's size and strength`, smeared.length === before.length && smeared.every((m) => m.smudges[0].width === 24 && m.smudges[0].strength === 0.8), JSON.stringify(after.map((m) => m.smudges)));
    const grown = after.filter((m, i) => m.bounds.maxX > before[i].bounds.maxX + 10);
    c.ok(`${name}: the marks' boxes grow to take in where their graphite went`, grown.length === before.length, `${grown.length} of ${before.length}`);
    const insideAfter = await io.tone(350, 420, 520);
    const pastAfter = await io.tone(350, 534, 548);
    c.ok(`${name}: the spread of tones inside goes down`, insideAfter.sd < inside.sd * 0.75, `${inside.sd.toFixed(1)} to ${insideAfter.sd.toFixed(1)}, the mean ${inside.mean.toFixed(1)} to ${insideAfter.mean.toFixed(1)}`);
    c.ok(`${name}: and tone reaches past the hatching's old edge`, pastAfter.mean < past.mean - 8, `${past.mean.toFixed(1)} to ${pastAfter.mean.toFixed(1)}`);
    smearedSvg = await io.eval('return window.napkinCheck.pageSvg();');

    await io.menu('undo');
    const undone = await io.marks();
    c.ok(`${name}: one undo takes every pass back`, undone.every((m) => m.smudges.length === 0), JSON.stringify(undone.map((m) => m.smudges.length)));
    c.ok(`${name}: and the boxes with them`, undone.every((m, i) => m.bounds.maxX === before[i].bounds.maxX));
  });

  await sequence('The selection', { mode: 'book', filePath: bookOf('hatching-one', HATCHING('pencil 4B')) }, async (io) => {
    const name = 'The selection';
    const [first] = await io.marks();
    await io.click('tool-select');
    await io.eval(`window.napkinCheck && true; return true;`);
    // Select the first line alone, by its middle.
    const at = await io.toClient({ x: (first.first.x + first.last.x) / 2, y: (first.first.y + first.last.y) / 2 });
    await io.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
    await io.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    await io.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
    c.eq(`${name}: one line selected`, (await io.eval('return window.napkinCheck.selectionBoxes().length;')), 1);
    await io.chord(78, 'N', 8);
    await io.quick(87, 'w', '24');
    await io.drag(await io.across({ x: 380, y: 350 }, { x: 600, y: 350 }));
    const after = await io.marks();
    c.ok(`${name}: only the selected line is smeared`, after[0].smudges.length === 1 && after.slice(1).every((m) => m.smudges.length === 0), JSON.stringify(after.map((m) => m.smudges.length)));
  });

  await sequence('A Brush line', { mode: 'book', filePath: bookOf('brush-lines', HATCHING('tool pen')) }, async (io) => {
    const name = 'A Brush line';
    const before = await io.marks();
    await io.chord(78, 'N', 8);
    await io.quick(87, 'w', '24');
    await io.eval("document.getElementById('toast').textContent = ''; return true;");
    await io.drag(await io.across({ x: 380, y: 350 }, { x: 600, y: 350 }));
    const after = await io.marks();
    c.ok(`${name}: a smear over Brush lines changes nothing`, JSON.stringify(after) === JSON.stringify(before));
    c.eq(`${name}: and says so`, await io.toast(), "Smear blends pencil marks; Liquify's Warp pushes the others.");
    await io.eval("document.getElementById('toast').textContent = ''; return true;");
    await io.drag(await io.across({ x: 380, y: 300 }, { x: 600, y: 300 }));
    c.eq(`${name}: once`, await io.toast(), '');
  });

  const exported = join(dir, 'smeared.svg');
  writeFileSync(exported, smearedSvg ?? '');
  await sequence('The round trip', { mode: 'new', sketchName: 'smear-svg', importFiles: [exported] }, async (io) => {
    const name = 'The round trip';
    const back = await io.marks();
    c.ok(`${name}: the page as Export SVG wrote it comes back as Pencil marks with their passes`, back.length === 16 && back.every((m) => m.tool === 'pencil' && m.smudges.length === 1 && m.smudges[0].width === 24), JSON.stringify(back.map((m) => [m.tool, m.smudges])));
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
