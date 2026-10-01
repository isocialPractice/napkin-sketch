/**
 * The canvas zooms in until one page pixel spans its shorter side.
 *
 * Before 1.0.0-alpha.4.6.0 the canvas stopped at 8 times, View > Zoom In and
 * Zoom Out were Electron's own rows, which zoom the whole window - panels,
 * toolbar and all - and not the drawing, and much that was meant as a
 * distance on the screen was measured on the page: a pen dropped every
 * sample closer than 0.75 page units to the last, so a stroke drawn deep in
 * came out a line of two points, and a selection's dashed box stood 6 page
 * units off its mark. Placed images were smoothed however far they were
 * magnified.
 *
 * Five sequences, each in an app of its own: a 1 x 1 page-pixel mark zoomed
 * into with `Alt` + wheel until it fills the canvas's shorter side, with its
 * selection box 6 screen pixels off it; View > Zoom In and its keys, which
 * zoom the canvas and leave the window's own zoom alone; a pen arc drawn at
 * 400 times, which keeps its bow; a blurred layer at the deepest zoom, which
 * still paints; and a 4 x 4 checker image, magnified, whose pixels stay crisp.
 *
 * The books are napkin scripts, bundled with esbuild and written to a
 * temporary folder, as the effects check writes its own.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-zoom-check-'));
const TIME = '2026-09-29T00:00:00.000Z';

const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `export { evaluate, formatDiagnostic, renderBook } from ${JSON.stringify(resolve(ROOT, 'src/core/script/index.ts'))};\n` +
    `export { encodePng } from ${JSON.stringify(resolve(ROOT, 'src/core/graphic-design/png.ts'))};\n`,
);
const bundle = join(dir, 'entry.mjs');
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook, encodePng } = await import(pathToFileURL(bundle).href);

/** A script's book, written where the app can open it. */
function bookOf(name, text) {
  const result = evaluate(text, { name, timestamp: TIME });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  const path = join(dir, `${name}.skbk`);
  writeFileSync(path, renderBook(result.book, { format: 'skbk' }));
  return path;
}

/** A 4 x 4 black and white checker, as a PNG data URL. */
function checkerPng() {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      rgba.set([v, v, v, 255], (y * 4 + x) * 4);
    }
  }
  return `data:image/png;base64,${Buffer.from(encodePng(rgba, 4, 4)).toString('base64')}`;
}

const DOT = bookOf('dot', 'napkin 1\npage 1280 800\nbackground #ffffff\nlayer "Dot"\ncolor #000000 fill #000000\nstroke off\nrect 400 300 1 1\n');
// The layer is blurred, and so is the mark on it: both of the painter's ways of laying down an effect.
const BLUR = bookOf('blur', 'napkin 1\npage 1280 800\nbackground #ffffff\neffect blur 8\nlayer "Soft"\ncolor #000000 fill #000000\neffect blur 4\nrect 400 300 300 200\n');
const PIXELS = bookOf('pixels', `napkin 1\npage 1280 800\nbackground #ffffff\nlayer "Checker"\nimage "${checkerPng()}" at 400 300 size 40 40\n`);

/**
 * Canvas pixels read back: `line(horizontal, at)` gives one row or column
 * through the canvas's middle (or `at`, in client pixels), as grey levels.
 */
const LINE = (horizontal, at = null) => `
  const cv = document.getElementById('canvas');
  const rect = cv.getBoundingClientRect();
  const k = cv.width / rect.width;
  const ctx = cv.getContext('2d');
  const at = ${JSON.stringify(at)};
  const out = [];
  if (${horizontal}) {
    const y = Math.round(at === null ? cv.height / 2 : (at - rect.top) * k);
    const d = ctx.getImageData(0, y, cv.width, 1).data;
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
  } else {
    const x = Math.round(at === null ? cv.width / 2 : (at - rect.left) * k);
    const d = ctx.getImageData(x, 0, 1, cv.height).data;
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
  }
  return out;
`;

const dark = (px) => px[0] < 80 && px[1] < 80 && px[2] < 80;

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
    const measure = () =>
      page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);
    const io = {
      page,
      measure,
      view: () => page.evalIn('return window.napkinCheck.viewState();'),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      eval: (code) => page.evalIn(code),
      /** The canvas's middle, in client pixels. */
      async middle() {
        const r = await measure();
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      },
      async menu(id) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(400);
        return ran;
      },
      async tool(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(150);
      },
      /** `Alt` + wheel at `p`, `deltaY` pixels at a time, `times` times. */
      async altWheel(p, deltaY, times = 1) {
        for (let i = 0; i < times; i++) {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY, modifiers: 1 });
          await sleep(60);
        }
        await sleep(300);
      },
      /** A key with the modifier bits held (2 Ctrl, 8 Shift). */
      async key(key, code, vk, modifiers) {
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
        await sleep(400);
      },
      async drag(from, to, steps = 20) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, button: 'left', buttons: 1, clickCount: 1,
          });
          await sleep(10);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(300);
      },
      async click(p) {
        await this.drag(p, p, 0);
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

/** Zooms in with `Alt` + wheel at the canvas's middle until the zoom stops growing. */
async function zoomAllTheWay(io) {
  const middle = await io.middle();
  let before = (await io.view()).zoom;
  for (let round = 0; round < 12; round++) {
    await io.altWheel(middle, -1000);
    const now = (await io.view()).zoom;
    if (now === before) break;
    before = now;
  }
  return io.view();
}

try {
  await sequence('The deepest zoom', { mode: 'book', filePath: DOT }, async (io) => {
    const name = 'The deepest zoom';
    await io.menu('fit-view');
    const view = await zoomAllTheWay(io);
    const side = Math.min(view.width, view.height);
    c.ok(`${name}: the limit is the canvas's shorter side`, Math.abs(view.maxZoom - side) < 1e-6, `maxZoom ${view.maxZoom}, shorter side ${side}`);
    c.ok(`${name}: Alt + wheel reaches it`, view.zoom === view.maxZoom, `zoom ${view.zoom}`);
    // The dot is 1 x 1 page pixels, centred by Fit All in View and zoomed
    // about the canvas's middle, so it is as tall as the canvas. Where it
    // lands is worked out from the view rather than assumed: the wheel's
    // pointer is a whole pixel, the canvas's middle need not be, and 65
    // times in, half a pixel off the middle is 30 pixels off it.
    const tall = view.height <= view.width;
    const onScreen = (from, span) => Math.max(0, Math.min(span, from + view.zoom) - Math.max(0, from)) / span;
    const shortShare = tall ? onScreen(view.panY + 300 * view.zoom, view.height) : onScreen(view.panX + 400 * view.zoom, view.width);
    const longShare = tall ? onScreen(view.panX + 400 * view.zoom, view.width) : onScreen(view.panY + 300 * view.zoom, view.height);
    const pct = (x) => `${Math.round(x * 1000) / 10}%`;
    const shortAcross = tall ? await io.eval(LINE(false)) : await io.eval(LINE(true));
    const covered = shortAcross.filter(dark).length / shortAcross.length;
    c.ok(
      `${name}: one page pixel spans the shorter side, all of it in view but the part the pointer's rounding moved out`,
      shortShare > 0.9 && Math.abs(covered - shortShare) < 0.01,
      `${pct(covered)} dark, ${pct(shortShare)} of the side is the page pixel`,
    );
    const longAcross = tall ? await io.eval(LINE(true)) : await io.eval(LINE(false));
    const share = longAcross.filter(dark).length / longAcross.length;
    c.ok(`${name}: and as much of the longer side as it is wide`, Math.abs(share - longShare) < 0.01, `${pct(share)} dark, ${pct(longShare)} expected`);
    await io.tool('tool-select');
    await io.click(await io.middle());
    const [box] = await io.eval('return window.napkinCheck.selectionBoxes();');
    const [dot] = await io.marks();
    const pad = box ? dot.bounds.minX - box.x : NaN;
    c.ok(`${name}: the selection's box stands 6 screen pixels off the mark`, Math.abs(pad * view.zoom - 6) < 0.05, `${pad * view.zoom} screen pixels`);
  });

  await sequence('View > Zoom In zooms the canvas', { mode: 'new', sketchName: 'zoom-menu' }, async (io) => {
    const name = 'View > Zoom In zooms the canvas';
    const window0 = await io.eval('return { dpr: window.devicePixelRatio, width: window.innerWidth };');
    const z0 = (await io.view()).zoom;
    const ran = await io.menu('zoom-in');
    const z1 = (await io.view()).zoom;
    c.ok(`${name}: the row runs`, ran === true, String(ran));
    c.ok(`${name}: and zooms the canvas by 1.25`, Math.abs(z1 / z0 - 1.25) < 1e-6, `${z0} to ${z1}`);
    await io.key('+', 'Equal', 187, 2 | 8);
    const z2 = (await io.view()).zoom;
    c.ok(`${name}: Ctrl++ zooms the canvas too`, Math.abs(z2 / z1 - 1.25) < 1e-6, `${z1} to ${z2}`);
    await io.key('-', 'Minus', 189, 2);
    const z3 = (await io.view()).zoom;
    c.ok(`${name}: Ctrl+- zooms it back out`, Math.abs(z3 - z1) < 1e-6, `${z2} to ${z3}`);
    c.ok(`${name}: View > Zoom Out runs`, (await io.menu('zoom-out')) === true);
    c.ok(`${name}: and the canvas is back where it began`, Math.abs((await io.view()).zoom - z0) < 1e-6);
    const window1 = await io.eval('return { dpr: window.devicePixelRatio, width: window.innerWidth };');
    c.ok(`${name}: the window's own zoom never moved`, window1.dpr === window0.dpr && window1.width === window0.width, `${JSON.stringify(window0)} to ${JSON.stringify(window1)}`);
  });

  await sequence('A stroke drawn at 400 times', { mode: 'new', sketchName: 'zoom-stroke' }, async (io) => {
    const name = 'A stroke drawn at 400 times';
    const middle = await io.middle();
    // One wheel event of 62.9 notches: 1.1 to that power is 400.
    await io.altWheel(middle, (-100 * Math.log(400)) / Math.log(1.1));
    const { zoom } = await io.view();
    c.ok(`${name}: Alt + wheel gets there in one event`, Math.abs(zoom - 400) < 0.5, `zoom ${zoom}`);
    await io.tool('tool-pen');
    // An arc 200 screen pixels across, bowed 40 up. Were the samples still
    // kept three quarters of a page pixel apart - 300 screen pixels here -
    // the arc would keep only its ends and come out as its flat chord; its
    // samples fitted, it keeps its bow, a tenth of a page pixel tall.
    const arc = (s) => ({ x: middle.x - 100 + 200 * s, y: middle.y - 40 * Math.sin(Math.PI * s) });
    const p0 = arc(0);
    await io.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y, button: 'none', buttons: 0 });
    await io.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 40; i++) {
      const p = arc(i / 40);
      await io.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(10);
    }
    const p1 = arc(1);
    await io.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p1.x, y: p1.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
    const marks = await io.marks();
    const stroke = marks[marks.length - 1];
    const bow = stroke ? (stroke.bounds.maxY - stroke.bounds.minY) * zoom : 0;
    c.ok(`${name}: a 200-pixel pen arc keeps its bow`, !!stroke && Math.abs(bow - 40) < 3 && (stroke.anchors ?? 0) >= 2, stroke ? `${bow.toFixed(1)} screen pixels tall, ${stroke.anchors} anchors` : 'no mark');
    // A rubber band a few screen pixels across, over the top of the arc, is still a band.
    await io.tool('tool-select');
    await io.drag({ x: middle.x - 20, y: middle.y - 60 }, { x: middle.x + 20, y: middle.y - 20 }, 6);
    const selected = await io.eval('return window.napkinCheck.selectionBoxes().map((box) => box.id);');
    c.ok(`${name}: a 40-pixel rubber band there takes it`, !!stroke && selected.length === 1 && selected[0] === stroke.id, JSON.stringify(selected));
  });

  await sequence('A blur at the deepest zoom', { mode: 'book', filePath: BLUR }, async (io) => {
    const name = 'A blur at the deepest zoom';
    await io.menu('fit-view');
    const view = await zoomAllTheWay(io);
    c.ok(`${name}: the canvas is at its deepest`, view.zoom === view.maxZoom && Math.abs(view.maxZoom - Math.min(view.width, view.height)) < 1e-6, `zoom ${view.zoom}`);
    // Deep inside a blurred black rectangle 300 page pixels wide the ink is black.
    const across = await io.eval(LINE(true));
    const share = across.filter(dark).length / across.length;
    c.ok(`${name}: the blurred layer still paints`, share > 0.97, `${Math.round(share * 1000) / 10}% dark`);
  });

  await sequence('Pixels at depth', { mode: 'book', filePath: PIXELS }, async (io) => {
    const name = 'Pixels at depth';
    await io.menu('fit-view');
    await sleep(500);
    const [image] = await io.marks();
    const view = await io.view();
    const r = await io.measure();
    // A row through the image's middle, inside its edge: two of its pixels
    // meet in it three times, so smoothing shows as greys between them.
    const b = image.bounds;
    const y = r.y + view.panY + ((b.minY + b.maxY) / 2 + 2.5) * view.zoom;
    const row = await io.eval(LINE(true, y));
    const k = row.length / r.w;
    const x0 = Math.ceil((view.panX + (b.minX + 1) * view.zoom) * k);
    const x1 = Math.floor((view.panX + (b.maxX - 1) * view.zoom) * k);
    const inside = row.slice(x0, x1);
    const colors = new Set(inside.map((px) => px.join(',')));
    c.ok(`${name}: one image pixel spans many screen pixels`, (view.zoom * 10) >= 4, `zoom ${view.zoom}`);
    c.ok(`${name}: the magnified image shows its pixels, with no greys between them`, colors.size <= 2, `${colors.size} colours in ${inside.length} pixels`);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
