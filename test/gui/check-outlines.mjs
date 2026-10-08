/**
 * Text as shapes in the app (core/type/sfnt.ts, core/type/outline.ts,
 * renderer/type-faces.ts): Expand Text to Shape, a Warp on text, and the PDF.
 *
 * The book is three texts on white paper, two in Arial - "Hello there" and
 * "Arc me" - and one in a font no computer has. Expand Text to Shape on
 * "Hello there" makes a group named after it, a mark a letter, each named
 * after its letter; the shapes cover the pixels the text covered, within a
 * pixel at the edges; and one undo gives the text back. With the text being
 * typed, Ctrl+Shift+O expands it too. The text in the missing font stays
 * text, and a report says which font and why. An Arc Warp on "Arc me" bends
 * it - its ends drop, its middle kept - while it stays a text. The PDF of
 * the page draws the texts as shapes, with no text operator for them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-outlines-'));

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const MISSING = 'Missing Acme Sans';
const result = evaluate(
  [
    'napkin 1',
    'page 720 440',
    'background #ffffff',
    'layer "Words"',
    'color #1f2328',
    'font "Arial" 64',
    'text "Hello there" at 60 60',
    'text "Arc me" at 60 250',
    `font "${MISSING}" 32`,
    'text "Lost" at 520 300',
  ].join('\n'),
  { name: 'outlines', timestamp: '2026-10-03T00:00:00.000Z' },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'outlines.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const MARKS = result.book.sketches[0].strokes;
const [HELLO, ARC, LOST] = MARKS.map((m) => m.id);

const CTRL = 2;
const SHIFT = 8;

/** The canvas's ink in a page box, as a mask - a pixel is ink when it is dark - with the device pixels to a page pixel. */
const MASK = (box) => `
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  const k = cv.width / r.width;
  const x0 = Math.floor((v.panX + ${box.minX} * v.zoom) * k);
  const y0 = Math.floor((v.panY + ${box.minY} * v.zoom) * k);
  const x1 = Math.ceil((v.panX + ${box.maxX} * v.zoom) * k);
  const y1 = Math.ceil((v.panY + ${box.maxY} * v.zoom) * k);
  const w = x1 - x0;
  const h = y1 - y0;
  const d = cv.getContext('2d').getImageData(x0, y0, w, h).data;
  let bits = '';
  for (let i = 0; i < d.length; i += 4) bits += 255 - (d[i] + d[i + 1] + d[i + 2]) / 3 > 128 ? '1' : '0';
  return { w, h, bits, scale: k * v.zoom };
`;

/** Pixels where two masks differ and the other mask has no matching pixel within `reach`: what lies beyond the edges. */
function farApart(a, b, reach) {
  let far = 0;
  let ink = 0;
  const at = (mask, x, y) => (x >= 0 && y >= 0 && x < mask.w && y < mask.h ? mask.bits[y * mask.w + x] : '0');
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const pa = at(a, x, y);
      if (pa === '1') ink++;
      if (pa === at(b, x, y)) continue;
      let near = false;
      for (let dy = -reach; dy <= reach && !near; dy++) {
        for (let dx = -reach; dx <= reach && !near; dx++) {
          if (at(pa === '1' ? b : a, x + dx, y + dy) === '1') near = true;
        }
      }
      if (!near) far++;
    }
  }
  return { far, ink };
}

const app = launch({ mode: 'book', filePath: bookPath });
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
  // The Type panel would come up with the Text tool and dock, moving the canvas; check-type-panel.mjs has it.
  await page.evalIn('return window.napkin.updateSettings({ typePanelAutoShow: false }).then(() => true);');

  const io = {
    eval: (code) => page.evalIn(code),
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
    marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
    tool: async (id) => {
      await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
      await sleep(150);
    },
    async menu(id, wait = 700) {
      const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
      await sleep(wait);
      return ran;
    },
    async click(p, count = 1) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: count });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: count });
      await sleep(150);
    },
    async key(key, code, vk, modifiers = 0, wait = 300) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      }
      await sleep(wait);
    },
    /** A click with the Select tool at a page point. */
    async pick(x, y) {
      await this.tool('tool-select');
      await this.click(await this.client(x, y));
    },
    /** Waits until `test` holds, a little at a time; true when it did. */
    async until(test, tries = 40) {
      for (let i = 0; i < tries; i++) {
        if (await test()) return true;
        await sleep(150);
      }
      return false;
    },
    mask: (box) => page.evalIn(MASK(box)),
  };

  await io.until(() => page.evalIn('return window.napkinCheck.fontList().available;'));
  await io.menu('fit-view');
  await io.pick(700, 420);
  c.eq('nothing is selected to begin', (await io.selected()).length, 0);

  // ---- Expand Text to Shape -------------------------------------------------------------------
  const hello = await io.type(HELLO);
  const box = { minX: hello.bounds.minX - 4, minY: hello.bounds.minY - 4, maxX: hello.bounds.maxX + 4, maxY: hello.bounds.maxY + 4 };
  const live = await io.mask(box);
  await io.pick(120, 100);
  c.eq('the text is selected', (await io.selected()).join(), HELLO);
  c.ok('Type > Expand Text to Shape is live for it', await page.evalIn(`
    const find = (items) => { for (const item of items) { if (item.id === 'expand-text') return item; const inner = item.submenu ? find(item.submenu) : null; if (inner) return inner; } return null; };
    return find(await window.napkin.getAppMenu())?.enabled !== false;`));
  const before = (await io.marks()).length;
  await io.menu('expand-text', 300);
  const expanded = await io.until(async () => !(await io.marks()).some((m) => m.id === HELLO));
  c.ok('Expand Text to Shape takes the text away', expanded);
  const marks = await io.marks();
  const made = marks.filter((m) => m.id !== ARC && m.id !== LOST);
  c.eq('and puts a shape a letter in its place: ten, the space none', made.length, 10);
  c.ok('each a filled shape in the text\'s ink, with no outline', made.every((m) => m.tool === 'pen' && m.fill === '#1f2328' && m.noStroke && m.anchors > 3), JSON.stringify(made[0]));
  c.eq('the page holds what it did, less the text, and the ten', marks.length, before - 1 + 10);
  const rows = await page.evalIn('return window.napkinCheck.layerRows();');
  const group = rows.find((row) => row.group && row.name === 'Hello there');
  c.ok('in a group named after the text', group !== undefined, JSON.stringify(rows.map((r) => r.name)));
  c.eq('each shape on a layer named after its letter', rows.filter((row) => row.parent === group?.id).map((row) => row.name).join(''), 'Hellothere');
  c.eq('the shapes are selected', (await io.selected()).length, 10);
  await io.pick(700, 420);
  const shapes = await io.mask(box);
  const reach = Math.max(1, Math.round(live.scale));
  const apart = farApart(live, shapes, reach);
  c.ok("the shapes cover the text's own pixels, within a pixel at the edges", apart.ink > 500 && apart.far <= Math.max(3, apart.ink * 0.002), `${apart.far} pixels apart of ${apart.ink} inked, reach ${reach}`);
  await io.key('z', 'KeyZ', 90, CTRL, 500);
  const undone = await io.marks();
  c.ok('one undo gives the text back, and the shapes go', undone.some((m) => m.id === HELLO) && undone.length === before, `${undone.length} marks`);

  // ---- Ctrl+Shift+O while the text is typed ---------------------------------------------------------
  await io.tool('tool-text');
  await io.click(await io.client(120, 100));
  c.eq('a click with the Text tool edits the text', (await page.evalIn('return window.napkinCheck.typeEditorState();')).id, HELLO);
  await io.key('O', 'KeyO', 79, CTRL | SHIFT, 300);
  c.ok('Ctrl+Shift+O while it is typed expands it', await io.until(async () => !(await io.marks()).some((m) => m.id === HELLO)));
  c.eq('and puts the text down', (await page.evalIn('return window.napkinCheck.typeEditorState();')).id, null);
  await io.key('z', 'KeyZ', 90, CTRL, 500);
  c.ok('one undo gives it back', (await io.marks()).some((m) => m.id === HELLO));

  // ---- A font that cannot be read: the text stays text ------------------------------------------------
  await io.pick(560, 320);
  c.eq('the text in the missing font is selected', (await io.selected()).join(), LOST);
  await io.menu('expand-text', 300);
  const said = await io.until(async () => (await page.evalIn('return window.napkinCheck.reportToasts();')).some((r) => r.id === 'expand-text'));
  const report = (await page.evalIn('return window.napkinCheck.reportToasts();')).find((r) => r.id === 'expand-text');
  c.ok('it stays text, and a report says which font and why', said && (await io.marks()).some((m) => m.id === LOST) && /Missing Acme Sans: it is not installed on this computer/.test(report?.details?.[0]?.text ?? ''), JSON.stringify(report));

  // ---- A Warp on text: it bends, and stays text ---------------------------------------------------------
  const arc = await io.type(ARC);
  const arcBox = { minX: arc.bounds.minX - 30, minY: arc.bounds.minY - 40, maxX: arc.bounds.maxX + 30, maxY: arc.bounds.maxY + 10 };
  const flat = await io.mask(arcBox);
  await io.pick(100, 285);
  c.eq('"Arc me" is selected', (await io.selected()).join(), ARC);
  await io.menu('effect-warp-arc', 900);
  await io.key('Enter', 'Enter', 13, 0, 900);
  const effects = await page.evalIn(`return window.napkinCheck.effectsOf(${JSON.stringify(ARC)});`);
  c.ok('Effect > Warp > Arc is on the text', (effects?.mark ?? []).some((e) => e.type === 'warp' && e.style === 'arc'), JSON.stringify(effects));
  const still = (await io.marks()).find((m) => m.id === ARC);
  c.ok('which is still a text', still?.tool === 'text' && (await io.type(ARC)).text === 'Arc me');
  await io.pick(700, 420);
  const bent = await io.mask(arcBox);
  /** The highest inked row among a mask's columns from `from` to `to`, as shares of its width. */
  const topOf = (mask, from, to) => {
    for (let y = 0; y < mask.h; y++) {
      for (let x = Math.floor(mask.w * from); x < Math.ceil(mask.w * to); x++) if (mask.bits[y * mask.w + x] === '1') return y;
    }
    return mask.h;
  };
  // An Arc keeps its top's middle and bends its ends down, as the warp check's card shows.
  const drop = (topOf(bent, 0, 0.15) - topOf(flat, 0, 0.15)) / bent.scale;
  c.ok('the Arc bends it: its left end drops', drop > 4, `${drop.toFixed(1)} page px; drawn ${JSON.stringify(still?.bounds)}, laid out ${JSON.stringify(arc.bounds)}`);

  // ---- The PDF draws text as shapes ----------------------------------------------------------------------
  const { pdf, leftOut } = await page.evalIn('return await window.napkinCheck.pagePdf();');
  c.ok('the PDF draws "Hello there" and the bent "Arc me" as shapes, with no text operator for them', !/\((Hello there|Arc me)\) Tj/.test(pdf) && / c /.test(pdf), leftOut.join(' | '));
  c.ok('and sets the text in the missing font in Helvetica, and says so', /\(Lost\) Tj/.test(pdf) && leftOut.some((m) => /Missing Acme Sans/.test(m)), leftOut.join(' | '));

  c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
