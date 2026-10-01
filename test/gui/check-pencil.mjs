/**
 * The Pencil: a drawing class's kit of graphite and charcoal, each lead
 * drawn through the paper's grain (src/core/pencil.ts).
 *
 * Five sequences, each in an app of its own:
 * - The kit: the Sketch menu's Pencil row after the Copic's, on N; the
 *   button after the Copic's, the canvas keeping its height; N taking the
 *   Pencil with no panel in the way, and N again opening the kit; its
 *   seventeen chips, each drawing its own lead, graphite HB lit; Escape
 *   closing it, the button opening it, a chip choosing a pencil.
 * - Tone and grain: a 2H line lighter than an 8B line, and the 8B line's
 *   tone spread far above a Brush line's.
 * - Layering: a second HB pass over the first darkens it, and stays lighter
 *   than the grade's tone.
 * - The redraw: a page of 500 pencil circles redrawn within twice the time
 *   of 500 Brush circles; a zoom drawing the pictures it has, stretched,
 *   until it holds still, and then working them out at the new scale.
 * - The SVG: the page as Export SVG writes it, drawn by Chromium, shows the
 *   same grain.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-pencil-check-'));
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

const KIT = ['4H', '2H', 'HB', '2B', '4B', '6B', '8B', 'charcoal-HB', 'charcoal-2B', 'charcoal-4B', 'charcoal-6B', 'vine-hard', 'vine-medium', 'vine-soft', 'compressed-2B', 'compressed-4B', 'compressed-6B'];
const HB_TONE = 0.2126 * 0x6a + 0.7152 * 0x6d + 0.0722 * 0x72;

/** The tone sequence's page as Export SVG writes it, and the marks it drew, for the SVG sequence. */
let svgOfTone = null;
let toneMarks = null;

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
      state: () => page.evalIn('return window.napkinCheck.pencilState();'),
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
        await sleep(300);
      },
      async at(fx, fy) {
        const r = await this.rect();
        return { x: r.x + r.w * fx, y: r.y + r.h * fy };
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
      /** A press, a straight walk to `b`, and the release. */
      async drag(a, b, steps = 24) {
        await this.hover(a);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(12);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(450);
        for (let k = 0; k < 20 && (await page.evalIn('return window.napkinCheck.inputState().pressKind;')) !== null; k++) await sleep(100);
      },
      /** Takes up a pencil from the kit by its name. */
      async choose(pencil) {
        if (!(await this.state()).kitOpen) await this.click('tool-pencil');
        await page.evalIn(`document.querySelector('.pencil-chip[data-pencil=${JSON.stringify(pencil)}]').click(); return true;`);
        await sleep(300);
      },
      /** The canvas's tone along a row of client pixels: its mean luminance, and how much that varies. */
      tone: (y, x0, x1) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          const row = Math.round((${y} - r.top) * k);
          const a = Math.round((${x0} - r.left) * k);
          const b = Math.round((${x1} - r.left) * k);
          const d = cv.getContext('2d').getImageData(a, row, b - a, 1).data;
          const lum = [];
          for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
          const mean = lum.reduce((s, v) => s + v, 0) / lum.length;
          const sd = Math.sqrt(lum.reduce((s, v) => s + (v - mean) * (v - mean), 0) / lum.length);
          return { mean, sd, n: lum.length };`),
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

/** A mark's middle stretch, in client pixels: its row and the span between a fifth and four fifths along. */
async function stretch(io, mark) {
  const a = await io.toClient(mark.first);
  const b = await io.toClient(mark.last);
  return { y: (a.y + b.y) / 2, x0: a.x + (b.x - a.x) * 0.2, x1: a.x + (b.x - a.x) * 0.8 };
}

try {
  await sequence('The kit', { mode: 'new', sketchName: 'pencil-kit' }, async (io) => {
    const name = 'The kit';
    const sketch = menuOf(await io.bar(), 'Sketch');
    const labels = labelsOf(sketch);
    c.ok(`${name}: the Sketch menu has Pencil after the Copic`, labels.indexOf('Pencil') === labels.indexOf('Copic') + 1, labels.join(' | '));
    c.ok(`${name}: on N`, /^N$/.test(sketch.find((row) => row.label === 'Pencil')?.accelerator ?? ''), JSON.stringify(sketch.find((row) => row.label === 'Pencil')));
    c.ok(`${name}: its button after the Copic's`, await io.eval("return document.getElementById('tool-copic').nextElementSibling?.id === 'tool-pencil';"));
    c.ok(`${name}: and the canvas keeps its height`, Math.abs((await io.rect()).h - 617.67) < 1, String((await io.rect()).h));

    await io.chord(78, 'n');
    c.eq(`${name}: N takes the Pencil`, await io.tool(), 'pencil');
    c.eq(`${name}: with no panel in the way`, (await io.state()).kitOpen, false);
    c.ok(`${name}: and its round cursor`, (await io.eval("return document.getElementById('canvas').style.cursor;")).startsWith('url('));
    await io.chord(78, 'n');
    let state = await io.state();
    c.eq(`${name}: N again opens the kit`, state.kitOpen, true);
    c.eq(`${name}: seventeen pencils, a medium a row`, state.chips.join(' '), KIT.join(' '));
    c.eq(`${name}: graphite HB lit`, state.active, 'HB');
    const drawn = await io.eval(`
      return [...document.querySelectorAll('.pencil-chip canvas')].map((cv) => {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
        return n;
      });`);
    c.ok(`${name}: each chip draws its lead`, drawn.length === 17 && drawn.every((n) => n > 20), drawn.join(','));
    await io.eval("document.querySelector('.pencil-kit').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;");
    await new Promise((done) => setTimeout(done, 200));
    c.eq(`${name}: Escape closes it`, (await io.state()).kitOpen, false);
    await io.click('tool-pencil');
    c.eq(`${name}: the button opens it`, (await io.state()).kitOpen, true);
    await io.eval("document.getElementById('toast').textContent = ''; return true;");
    await io.eval("document.querySelector('.pencil-chip[data-pencil=\"8B\"]').click(); return true;");
    await new Promise((done) => setTimeout(done, 300));
    state = await io.state();
    c.ok(`${name}: a chip takes up its pencil`, state.pencil.medium === 'graphite' && state.pencil.grade === '8B' && !state.kitOpen, JSON.stringify(state));
    c.eq(`${name}: and says so`, await io.toast(), 'Pencil: Graphite 8B.');
    c.ok(`${name}: the button names it`, (await io.eval("return document.getElementById('tool-pencil').title;")).includes('Graphite 8B'));
  });

  await sequence('Tone and grain', { mode: 'new', sketchName: 'pencil-tone' }, async (io) => {
    const name = 'Tone and grain';
    await io.choose('2H');
    await io.drag(await io.at(0.2, 0.3), await io.at(0.8, 0.3));
    await io.choose('8B');
    await io.drag(await io.at(0.2, 0.45), await io.at(0.8, 0.45));
    await io.click('tool-pen');
    await io.drag(await io.at(0.2, 0.6), await io.at(0.8, 0.6));
    const [hard, soft, brush] = await io.marks();
    c.ok(`${name}: two Pencil marks, each with its pencil`, hard.tool === 'pencil' && hard.pencil?.grade === '2H' && soft.pencil?.grade === '8B' && brush.tool === 'pen', JSON.stringify([hard.pencil, soft.pencil, brush.tool]));
    c.ok(`${name}: the 8B wears broader than the 2H`, soft.width > hard.width, `${hard.width} and ${soft.width}`);
    const h = await io.tone(...Object.values(await stretch(io, hard)));
    const s = await io.tone(...Object.values(await stretch(io, soft)));
    const b = await io.tone(...Object.values(await stretch(io, brush)));
    c.ok(`${name}: a 2H line is lighter than an 8B line`, h.mean > s.mean + 25, `${h.mean.toFixed(1)} and ${s.mean.toFixed(1)}`);
    c.ok(`${name}: the grain: the 8B's tone varies far more than a Brush line's`, s.sd > 3 * b.sd + 6, `${s.sd.toFixed(1)} against ${b.sd.toFixed(1)}`);
    await io.eval('window.__svg = window.napkinCheck.pageSvg(); return true;');
    // Kept for the last sequence, drawn there by Chromium as a picture.
    svgOfTone = await io.eval('return window.__svg;');
    toneMarks = { soft, brush };
  });

  await sequence('Layering', { mode: 'new', sketchName: 'pencil-layers' }, async (io) => {
    const name = 'Layering';
    await io.choose('HB');
    const from = await io.at(0.2, 0.4);
    const to = await io.at(0.8, 0.4);
    await io.drag(from, to);
    const [first] = await io.marks();
    const where = await stretch(io, first);
    const once = await io.tone(where.y, where.x0, where.x1);
    await io.drag(from, to);
    const twice = await io.tone(where.y, where.x0, where.x1);
    c.eq(`${name}: two passes`, (await io.marks()).length, 2);
    c.ok(`${name}: the second darkens the first`, twice.mean < once.mean - 8, `${once.mean.toFixed(1)} to ${twice.mean.toFixed(1)}`);
    c.ok(`${name}: and stays lighter than the grade's tone`, twice.mean > HB_TONE + 5, `${twice.mean.toFixed(1)} against ${HB_TONE.toFixed(1)}`);
  });

  const circles = (paint) => `napkin 1
page 1280 800
name "circles"
layer "Circles"
${paint}
repeat 20 as r {
  repeat 25 as c {
    circle (40 + c * 48) (40 + r * 36) 14
  }
}
`;
  const timings = {};
  for (const [kind, paint] of [['brush', 'tool pen'], ['pencil', 'pencil HB']]) {
    await sequence(`The redraw: ${kind}`, { mode: 'book', filePath: bookOf(`circles-${kind}`, circles(paint)) }, async (io) => {
      const name = `The redraw: ${kind}`;
      c.eq(`${name}: 500 circles`, (await io.marks()).length, 500);
      // The pictures are worked out on the window's own first paint; the
      // redraw is every paint after it.
      const worked = kind === 'pencil' ? (await io.state()).rasters : 0;
      // The best of three batches of ten: a collection or a busy machine
      // slows one batch, and not what a redraw costs.
      const warm = Math.min(
        await io.eval('return window.napkinCheck.renderTime(10);'),
        await io.eval('return window.napkinCheck.renderTime(10);'),
        await io.eval('return window.napkinCheck.renderTime(10);'),
      );
      timings[kind] = warm;
      console.log(`      ${kind}: ${warm.toFixed(2)} ms a redraw${kind === 'pencil' ? `, ${worked} pictures worked out by the first paint` : ''}`);
      if (kind === 'pencil') {
        c.ok(`${name}: 500 pencil circles redraw within twice the time of 500 Brush circles`, warm <= 2 * timings.brush + 2, `${warm.toFixed(2)} ms against ${timings.brush.toFixed(2)} ms`);
        const before = (await io.state()).rasters;
        await io.menu('zoom-in', 0);
        await io.eval('window.napkinCheck.renderTime(1); return true;');
        const during = (await io.state()).rasters;
        c.ok(`${name}: a zoom draws the pictures it has, stretched`, during - before < 50, `${during - before} worked out`);
        await sleep(600);
        await io.eval('window.napkinCheck.renderTime(1); return true;');
        const after = (await io.state()).rasters;
        // Only the circles still in view are painted, so only they are worked out again.
        const shown = await io.eval(`
          const v = window.napkinCheck.viewState();
          const view = { x0: -v.panX / v.zoom, y0: -v.panY / v.zoom, x1: (v.width - v.panX) / v.zoom, y1: (v.height - v.panY) / v.zoom };
          return window.napkinCheck.strokeSummary().filter((m) => m.bounds.maxX > view.x0 && m.bounds.minX < view.x1 && m.bounds.maxY > view.y0 && m.bounds.minY < view.y1).length;`);
        c.ok(`${name}: and works out the ones in view at the new scale once it holds still`, shown > 0 && after - during >= shown * 0.95 && after - during <= shown + 50, `${after - during} worked out, ${shown} in view`);
      }
    });
  }

  // The page the tone sequence drew, as Export SVG wrote it, imported again.
  const exported = join(dir, 'pencil-tone.svg');
  writeFileSync(exported, svgOfTone ?? '');
  await sequence('The SVG', { mode: 'new', sketchName: 'pencil-svg', importFiles: [exported] }, async (io) => {
    const name = 'The SVG';
    const back = await io.marks();
    c.ok(
      `${name}: imported again, its Pencil marks come back with their pencils`,
      back.length === 3 && back[0].tool === 'pencil' && back[0].pencil?.grade === '2H' && back[1].pencil?.grade === '8B' && back[2].tool === 'pen',
      JSON.stringify(back.map((m) => [m.tool, m.pencil])),
    );
    c.ok(`${name}: in their tones`, back[1]?.color === toneMarks?.soft.color && back[1]?.width === toneMarks?.soft.width, JSON.stringify([back[1]?.color, back[1]?.width]));
    const tone = await io.eval(`
      const svg = ${JSON.stringify(svgOfTone ?? '')};
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth * 2;
      cv.height = img.naturalHeight * 2;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const row = (mark) => {
        const y = Math.round((mark.first.y + mark.last.y) * 2 / 2);
        const x0 = Math.round((mark.first.x + (mark.last.x - mark.first.x) * 0.2) * 2);
        const x1 = Math.round((mark.first.x + (mark.last.x - mark.first.x) * 0.8) * 2);
        const d = ctx.getImageData(x0, y, x1 - x0, 1).data;
        const lum = [];
        for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        const mean = lum.reduce((s, v) => s + v, 0) / lum.length;
        return { mean, sd: Math.sqrt(lum.reduce((s, v) => s + (v - mean) * (v - mean), 0) / lum.length) };
      };
      const marks = ${JSON.stringify(toneMarks ?? null)};
      return marks ? { soft: row(marks.soft), brush: row(marks.brush) } : null;`);
    c.ok(`${name}: Chromium draws the exported page`, tone !== null, tone ? `${(svgOfTone ?? '').length} characters of SVG` : 'the tone sequence left no SVG');
    if (tone) {
      c.ok(`${name}: the 8B line's grain shows in it too`, tone.soft.sd > 3 * tone.brush.sd + 6, `${tone.soft.sd.toFixed(1)} against ${tone.brush.sd.toFixed(1)}`);
      c.ok(`${name}: at a pencil's tone, not the paper's`, tone.soft.mean < 230, tone.soft.mean.toFixed(1));
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
