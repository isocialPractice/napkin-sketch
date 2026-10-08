/**
 * The Text tool's typing modes in the app (core/type/tool.ts), and the Type
 * menu.
 *
 * The book is a page of art a script made: a filled circle, an open curve,
 * an empty rectangle and a wave. Ctrl held with the Text tool shows the
 * selection tool. A click on the canvas types Sideless Typing, two lines; a
 * click inside the rectangle, which is not selected, types beside it and
 * leaves it alone. The circle selected, a click inside it types Sheet
 * Typing whose lines keep inside the circle, the circle gone into the frame
 * with its paint, one undo step with the typing; Direct Select drags one of
 * the frame's anchors and the text reflows at the same size; Area Type
 * Options sets an inset and takes the fill off, greying Auto Size for a
 * frame that is no rectangle. The curve selected, a click on it types Path
 * Typing whose characters follow it; its end bracket dragged short leaves
 * the text out of room, its center bracket dragged across flips it, each one
 * undo step; Type on a Path Options sets the effect and the flip as one
 * step, and Cancel keeps nothing. Ctrl+V with the wave selected pastes the
 * clipboard's words along it. Alt + click on the selected rectangle types
 * along its outline. Type > Type Orientation sets a text vertical, checked
 * in the menu; Type > Size sets 24 pt, checked; the rows with nothing to act
 * on are greyed; and Type > Font brings up the panel's font field.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-typing-modes-'));

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const CURVE_D = [430, 360, 500, 200, 700, 200, 800, 360];
const WAVE_D = [80, 560, 200, 480, 360, 620, 480, 540];
const result = evaluate(
  [
    'napkin 1',
    'page 900 640',
    'background #ffffff',
    'layer "Art"',
    'color #1f2328',
    'width 2',
    'fill #ffd43b',
    'circle 200 220 110',
    'fill none',
    `path "M${CURVE_D[0]} ${CURVE_D[1]} C${CURVE_D.slice(2).join(' ')}"`,
    'rect 560 470 140 90',
    `path "M${WAVE_D[0]} ${WAVE_D[1]} C${WAVE_D.slice(2).join(' ')}"`,
  ].join('\n'),
  { name: 'typing-modes', timestamp: '2026-10-03T00:00:00.000Z' },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'typing-modes.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));

/** A point on a cubic given as its eight numbers, at `t`. */
function cubicAt(d, t) {
  const u = 1 - t;
  const [a, b, c2, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * d[0] + b * d[2] + c2 * d[4] + e * d[6], y: a * d[1] + b * d[3] + c2 * d[5] + e * d[7] };
}
/** How far a point is from a cubic, by 400 samples along it. */
function offCubic(d, p) {
  let best = Infinity;
  for (let i = 0; i <= 400; i++) {
    const q = cubicAt(d, i / 400);
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return best;
}

const CTRL = 2;
const SHIFT = 8;
const ALT = 1;
const KEY = {
  Escape: ['Escape', 'Escape', 27],
  Enter: ['Enter', 'Enter', 13],
  Control: ['Control', 'ControlLeft', 17],
  z: ['z', 'KeyZ', 90],
  Z: ['Z', 'KeyZ', 90],
  v: ['v', 'KeyV', 86],
};

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
  // The Type panel would come up with the Text tool and dock beside the canvas, moving where its
  // points are; check-type-panel.mjs has the panel. In the check's own settings folder, not anyone's.
  await page.evalIn('return window.napkin.updateSettings({ typePanelAutoShow: false }).then(() => true);');
  await sleep(300);

  const io = {
    eval: (code) => page.evalIn(code),
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
    zoom: () => page.evalIn('return window.napkinCheck.viewState().zoom;'),
    editor: () => page.evalIn('return window.napkinCheck.typeEditorState();'),
    input: () => page.evalIn('return window.napkinCheck.inputState();'),
    marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    shapes: () => page.evalIn('return window.napkinCheck.typeShapes();'),
    options: () => page.evalIn('return window.napkinCheck.typeOptionsState();'),
    setOption: (key, value) => page.evalIn(`return window.napkinCheck.setTypeOption(${JSON.stringify(key)}, ${JSON.stringify(value)});`),
    panel: () => page.evalIn('return window.napkinCheck.typePanelState();'),
    selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
    tool: async (id) => {
      await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
      await sleep(150);
    },
    async menu(id, wait = 500) {
      const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
      await sleep(wait);
      return ran;
    },
    /** A row of the menu bar, by id, as Electron holds it now. */
    async row(id) {
      const bar = await page.evalIn('return await window.napkin.getAppMenu();');
      const find = (items) => {
        for (const item of items ?? []) {
          if (item.id === id) return item;
          const inner = find(item.submenu);
          if (inner) return inner;
        }
        return null;
      };
      return find(bar);
    },
    async mouse(type, p, clickCount = 1, modifiers = 0) {
      await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount, modifiers });
    },
    async click(p, modifiers = 0) {
      await this.mouse('mouseMoved', p, 0, modifiers);
      await this.mouse('mousePressed', p, 1, modifiers);
      await this.mouse('mouseReleased', p, 1, modifiers);
      await sleep(150);
    },
    /** A drag with the button held, in steps. */
    async drag(from, to, steps = 10) {
      await this.mouse('mouseMoved', from, 0);
      await this.mouse('mousePressed', from, 1);
      for (let i = 1; i <= steps; i++) {
        const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
        await sleep(15);
      }
      await this.mouse('mouseReleased', to, 1);
      await sleep(250);
    },
    async key(name, modifiers = 0, wait = 200) {
      const [key, code, vk] = KEY[name];
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      if (name === 'Enter') await page.send('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: vk, modifiers });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(wait);
    },
    /** Types `text` key by key, a newline as Enter: one burst. */
    async typeText(text) {
      for (const ch of text) {
        if (ch === '\n') {
          await this.key('Enter', 0, 20);
          continue;
        }
        const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sleep(20);
      }
      await sleep(150);
    },
    undo: () => io.key('z', CTRL, 300),
    redo: () => io.key('Z', CTRL | SHIFT, 300),
    /** A point on character `index` of a text. */
    async onChar(id, index) {
      const t = await this.type(id);
      const g = t.glyphs.find((glyph) => glyph.index === index);
      return this.client(g.x + g.width * 0.4, g.y - g.size * 0.3);
    },
    /** Selects a mark with the Select tool, by a click at a page point. */
    async pick(x, y) {
      await this.tool('tool-select');
      await this.click(await this.client(x, y));
    },
    /** Selects a text again with the Select tool, by a click on one of its characters: an undo leaves nothing selected. */
    async reselect(id, index = 3) {
      await this.tool('tool-select');
      await this.click(await this.onChar(id, index));
    },
    /** Starts typing with the Text tool at a page point, `modifiers` held, and types; returns the text's id, the text put down. */
    async typeAt(x, y, text, modifiers = 0) {
      await this.tool('tool-text');
      await this.click(await this.client(x, y), modifiers);
      await sleep(150);
      await this.typeText(text);
      const id = (await this.editor()).id;
      await this.key('Escape');
      return id;
    },
  };

  await io.menu('fit-view');
  const ids = (await io.marks()).map((m) => ({ id: m.id, box: m.bounds }));
  const near = (cx, cy) => ids.find((m) => Math.abs((m.box.minX + m.box.maxX) / 2 - cx) < 12 && Math.abs((m.box.minY + m.box.maxY) / 2 - cy) < 40)?.id;
  const CIRCLE = near(200, 220);
  const CURVE = ids.find((m) => Math.abs(m.box.minX - 430) < 6 && Math.abs(m.box.maxX - 800) < 6)?.id;
  const RECT = near(630, 515);
  const WAVE = ids.find((m) => Math.abs(m.box.minX - 80) < 6 && Math.abs(m.box.maxX - 480) < 6)?.id;
  c.ok('the page holds the circle, the curve, the rectangle and the wave', [CIRCLE, CURVE, RECT, WAVE].every(Boolean) && new Set([CIRCLE, CURVE, RECT, WAVE]).size === 4, JSON.stringify(ids));
  const has = async (id) => (await io.marks()).some((m) => m.id === id);

  // ---- Ctrl gives the selection tool ----------------------------------------------------
  await io.tool('tool-text');
  await io.mouse('mouseMoved', await io.client(520, 100), 0);
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: CTRL });
  await sleep(450);
  const spring = await io.input();
  c.ok('Ctrl held with the Text tool shows the selection tool', spring.tool === 'select' && spring.springFrom === 'text', JSON.stringify({ tool: spring.tool, springFrom: spring.springFrom }));
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  await sleep(300);
  c.eq('and the Text tool is back when it comes up', (await io.input()).tool, 'text');

  // ---- Sideless Typing ---------------------------------------------------------------------
  const HELLO = await io.typeAt(520, 80, 'Hello\nWorld');
  let t = await io.type(HELLO);
  c.ok('a click on the canvas types Sideless Typing, two lines with Enter', t?.kind === 'point' && t.text === 'Hello\nWorld' && t.lines.length === 2, JSON.stringify({ kind: t?.kind, text: t?.text, lines: t?.lines.length }));

  // ---- A click on art that is not selected types beside it -------------------------------
  const rectBefore = (await io.marks()).find((m) => m.id === RECT);
  const NOTE = await io.typeAt(630, 515, 'Note');
  t = await io.type(NOTE);
  const rectAfter = (await io.marks()).find((m) => m.id === RECT);
  c.ok('a click inside a rectangle that is not selected types Sideless Typing there', t?.kind === 'point' && t.text === 'Note', JSON.stringify({ kind: t?.kind, text: t?.text }));
  c.ok('and leaves the rectangle as it was', rectAfter && JSON.stringify(rectAfter.bounds) === JSON.stringify(rectBefore.bounds), JSON.stringify(rectAfter));

  // ---- Sheet Typing in the selected circle ------------------------------------------------
  await io.pick(200, 220);
  c.eq('the circle is selected', (await io.selected()).join(), CIRCLE);
  c.eq('over the selected circle the Text tool shows the area cursor', await (async () => {
    await io.tool('tool-text');
    await io.mouse('mouseMoved', await io.client(200, 220), 0);
    await sleep(150);
    return /type-area-cursor/.test((await io.input()).cursor) ? 'area' : (await io.input()).cursor;
  })(), 'area');
  const PARA = 'Text set in a circle runs its lines inside it, each as wide as the circle is where the line falls';
  const SHEET = await io.typeAt(200, 220, PARA);
  t = await io.type(SHEET);
  c.ok('a click inside the selected circle types Sheet Typing', t?.kind === 'area' && t.text === PARA && t.lines.length >= 4, JSON.stringify({ kind: t?.kind, lines: t?.lines.length }));
  c.ok('the circle has gone into the text', !(await has(CIRCLE)));
  const frame = t.typeset.frame;
  c.ok("the circle's fill and stroke are the frame's own", frame?.fill === '#ffd43b' && frame?.stroke === '#1f2328' && frame?.width === 2, JSON.stringify({ fill: frame?.fill, stroke: frame?.stroke, width: frame?.width }));
  const inCircle = t.lines.every((line) => {
    const half = Math.sqrt(Math.max(0, 110 * 110 - (line.y - 220) ** 2));
    return line.x >= 200 - half - 2 && line.x + line.width <= 200 + half + 2;
  });
  const widths = t.lines.map((line) => Math.round(line.width));
  c.ok('each line keeps inside the circle where it falls, the middle ones wider', inCircle && Math.max(...widths) > widths[0] + 20, JSON.stringify(t.lines.map((l) => [Math.round(l.x), Math.round(l.y), Math.round(l.width)])));
  await io.undo();
  c.ok('one undo takes the text and gives the circle back', (await has(CIRCLE)) && !(await has(SHEET)));
  await io.redo();
  c.ok('and a redo turns it into the text again', !(await has(CIRCLE)) && (await has(SHEET)));

  // ---- Direct Select on the frame -------------------------------------------------------------
  t = await io.type(SHEET);
  const sizes = t.glyphs.map((g) => g.size).join();
  const linesBefore = JSON.stringify(t.lines.map((l) => [Math.round(l.x), Math.round(l.width)]));
  const anchors = t.typeset.frame.anchors.map((a) => ({ x: a.p.x + t.anchor.x, y: a.p.y + t.anchor.y }));
  const right = anchors.reduce((best, a, k) => (a.x > anchors[best].x ? k : best), 0);
  // Direct Select's first click picks the mark, as it does a path; then its anchor drags.
  await io.tool('tool-point');
  await io.click(await io.client(anchors[right].x, anchors[right].y));
  c.eq('a click on the frame with Direct Select picks the text', (await io.eval('return window.napkinCheck.directSelectState().stroke;')), SHEET);
  await io.drag(await io.client(anchors[right].x, anchors[right].y), await io.client(anchors[right].x + 60, anchors[right].y));
  t = await io.type(SHEET);
  const moved = t.typeset.frame.anchors[right].p.x + t.anchor.x;
  c.ok("Direct Select drags the frame's anchor", Math.abs(moved - (anchors[right].x + 60)) < 3, `${anchors[right].x} -> ${moved}`);
  c.ok('the text reflows in the new frame', JSON.stringify(t.lines.map((l) => [Math.round(l.x), Math.round(l.width)])) !== linesBefore);
  c.eq('its characters keep their size', t.glyphs.map((g) => g.size).join(), sizes);

  // ---- Area Type Options ---------------------------------------------------------------------
  await io.tool('tool-select');
  await io.click(await io.onChar(SHEET, 0));
  c.eq('the sheet text is selected', (await io.selected()).join(), SHEET);
  c.ok('Type on a Path Options is greyed for it', (await io.row('type-path-options'))?.enabled === false);
  await io.menu('type-area-options');
  let opt = await io.options();
  c.ok('Type > Area Type Options opens on its frame', opt.open && opt.kind === 'area' && opt.values.fill === '#ffd43b' && opt.values.inset === 0, JSON.stringify(opt));
  c.ok('Auto Size is greyed, the frame being no rectangle', opt.disabled.includes('autoHeight') && !opt.disabled.includes('inset'), opt.disabled.join());
  const wideBefore = Math.max(...(await io.type(SHEET)).lines.map((l) => l.width));
  await io.setOption('inset', 12);
  await io.setOption('fill', null);
  await sleep(200);
  t = await io.type(SHEET);
  c.ok('Preview shows the inset on the canvas as it is set', t.typeset.frame.inset === 12 && Math.max(...t.lines.map((l) => l.width)) < wideBefore, JSON.stringify(t.typeset.frame.inset));
  await page.evalIn("document.getElementById('type-options-ok').click(); return true;");
  await sleep(300);
  t = await io.type(SHEET);
  c.ok('OK keeps the inset, and the frame has no fill and keeps its stroke', !(await io.options()).open && t.typeset.frame.inset === 12 && t.typeset.frame.fill === undefined && t.typeset.frame.stroke === '#1f2328', JSON.stringify(t.typeset.frame));
  await io.undo();
  t = await io.type(SHEET);
  c.ok('one undo takes both back', t.typeset.frame.inset === undefined && t.typeset.frame.fill === '#ffd43b', JSON.stringify(t.typeset.frame));

  // ---- Path Typing on the selected curve ---------------------------------------------------
  const mid = cubicAt(CURVE_D, 0.5);
  await io.pick(mid.x, mid.y);
  c.eq('the curve is selected', (await io.selected()).join(), CURVE);
  const at = cubicAt(CURVE_D, 0.1);
  await io.tool('tool-text');
  await io.mouse('mouseMoved', await io.client(at.x, at.y), 0);
  await sleep(150);
  c.ok('over the selected curve the Text tool shows the path cursor', /type-path-cursor/.test((await io.input()).cursor));
  const ALONG = await io.typeAt(at.x, at.y, 'Along the curve');
  t = await io.type(ALONG);
  c.ok('a click on the selected curve types Path Typing from the click', t?.kind === 'path' && t.text === 'Along the curve' && t.typeset.path.start > 10, JSON.stringify({ kind: t?.kind, start: t?.typeset?.path?.start }));
  c.ok('the curve has gone into the text', !(await has(CURVE)));
  const off = Math.max(...t.glyphs.map((g) => offCubic(CURVE_D, { x: g.x, y: g.y })));
  const turns = t.glyphs.map((g) => g.rotation);
  c.ok('each character stands on the curve, turned with it', off < 3 && Math.max(...turns) - Math.min(...turns) > 0.3, `off ${off.toFixed(2)}, turns ${turns.map((r) => r.toFixed(2)).join(' ')}`);

  // ---- The brackets --------------------------------------------------------------------------
  await io.tool('tool-select');
  let shapes = await io.shapes();
  const brackets = shapes[0]?.brackets ?? [];
  c.eq('the selected path text shows its three brackets', brackets.map((b) => b.which).join(), 'start,center,end');
  const z = await io.zoom();
  const grip = (b, px) => io.client(b.at.x + (b.side.x * px) / z, b.at.y + (b.side.y * px) / z);
  const end = brackets.find((b) => b.which === 'end');
  const short = cubicAt(CURVE_D, 0.2);
  await io.drag(await grip(end, 9), await io.client(short.x, short.y));
  t = await io.type(ALONG);
  shapes = await io.shapes();
  c.ok('the end bracket dragged short sets where the text stops', t.typeset.path.end < 1e6 && t.overset === true, JSON.stringify({ end: t.typeset.path.end, overset: t.overset }));
  c.ok('and the text out of room shows the red plus', shapes[0]?.overset != null, JSON.stringify(shapes[0]?.overset));
  await io.undo();
  t = await io.type(ALONG);
  c.ok('one undo gives the text its room back', t.typeset.path.end > 1e6 && t.overset === false, JSON.stringify({ end: t.typeset.path.end, overset: t.overset }));
  await io.reselect(ALONG);
  const center = (await io.shapes())[0].brackets.find((b) => b.which === 'center');
  await io.drag(await grip(center, 8), await grip(center, -40));
  t = await io.type(ALONG);
  c.ok('the center bracket dragged across the path flips the text', t.typeset.path.flip === true);
  await io.undo();
  c.ok('one undo puts it back', (await io.type(ALONG)).typeset.path.flip !== true);
  await io.reselect(ALONG);

  // ---- Type on a Path Options and Flip --------------------------------------------------------
  c.ok('Area Type Options is greyed for a path text', (await io.row('type-area-options'))?.enabled === false);
  await io.menu('type-path-options');
  opt = await io.options();
  c.ok('Type > Type on a Path > Type on a Path Options opens on the path text', opt.open && opt.kind === 'path' && opt.values.effect === 'rainbow' && opt.values.flip === false, JSON.stringify(opt));
  await io.setOption('effect', 'stair');
  await io.setOption('flip', true);
  await sleep(200);
  t = await io.type(ALONG);
  c.ok('Preview shows the effect and the flip as they are set', t.typeset.path.effect === 'stair' && t.typeset.path.flip === true);
  await page.evalIn("document.getElementById('type-options-ok').click(); return true;");
  await sleep(300);
  await io.undo();
  t = await io.type(ALONG);
  c.ok('OK kept both as one undo step', t.typeset.path.effect === 'rainbow' && t.typeset.path.flip !== true, JSON.stringify(t.typeset.path));
  await io.reselect(ALONG);
  await io.menu('type-path-options');
  await io.setOption('align', 'center');
  await sleep(150);
  await page.evalIn("document.getElementById('type-options-cancel').click(); return true;");
  await sleep(300);
  c.eq('Cancel keeps nothing', (await io.type(ALONG)).typeset.path.align, 'baseline');
  await io.menu('type-path-flip');
  c.ok('Type > Type on a Path > Flip flips it', (await io.type(ALONG)).typeset.path.flip === true);
  await io.undo();

  // ---- Paste on path ---------------------------------------------------------------------------
  const waveMid = cubicAt(WAVE_D, 0.5);
  await io.pick(waveMid.x, waveMid.y);
  c.eq('the wave is selected', (await io.selected()).join(), WAVE);
  await page.evalIn("return window.napkin.writeClipboardText('Pasted along').then(() => true);");
  await io.tool('tool-text');
  await io.key('v', CTRL, 600);
  const pasted = (await io.marks()).find((m) => m.tool === 'text' && (m.bounds?.minX ?? 0) < 200 && (m.bounds?.minY ?? 0) > 450);
  t = pasted ? await io.type(pasted.id) : null;
  c.ok("Ctrl+V with the wave selected sets the clipboard's words along it, from its start", t?.kind === 'path' && t.text === 'Pasted along' && t.typeset.path.start === 0, JSON.stringify({ kind: t?.kind, text: t?.text }));
  c.ok('the wave has gone into the text', !(await has(WAVE)));

  // ---- Alt + click on a selected closed shape types along its outline ----------------------------
  await io.pick(560, 540);
  c.eq('the rectangle is selected', (await io.selected()).join(), RECT);
  const ROUND = await io.typeAt(630, 470, 'Round the box', ALT);
  t = await io.type(ROUND);
  c.ok('Alt + click on the selected rectangle types along its outline', t?.kind === 'path' && t.typeset.path.closed === true && t.text === 'Round the box', JSON.stringify({ kind: t?.kind, closed: t?.typeset?.path?.closed }));
  c.ok('the rectangle has gone into the text', !(await has(RECT)));

  // ---- Type Orientation, Size, and greyed rows --------------------------------------------------
  await io.tool('tool-select');
  await io.click(await io.onChar(HELLO, 1));
  c.eq('the first text is selected', (await io.selected()).join(), HELLO);
  c.ok('Type on a Path Options and Area Type Options are greyed for Sideless Typing', (await io.row('type-path-options'))?.enabled === false && (await io.row('type-area-options'))?.enabled === false);
  c.ok('Horizontal is checked', (await io.row('type-horizontal'))?.checked === true && (await io.row('type-vertical'))?.checked === false);
  await io.menu('type-vertical');
  t = await io.type(HELLO);
  c.ok('Type > Type Orientation > Vertical sets the text in columns', t.orientation === 'vertical' && t.typeset.orientation === 'vertical', JSON.stringify({ orientation: t.orientation }));
  c.ok('and the menu checks Vertical', (await io.row('type-vertical'))?.checked === true && (await io.row('type-horizontal'))?.checked === false);
  await io.menu('type-horizontal');
  c.eq('Horizontal sets it back', (await io.type(HELLO)).orientation, 'horizontal');
  await io.menu('type-size-24');
  t = await io.type(HELLO);
  c.ok('Type > Size > 24 pt sets every character to 24 pt', t.glyphs.every((g) => Math.abs(g.size - 32) < 0.01), t.glyphs.map((g) => g.size).join());
  c.ok('and the menu checks 24 pt', (await io.row('type-size-24'))?.checked === true && (await io.row('type-size-12'))?.checked === false);
  await io.undo();
  await io.click(await io.client(860, 40));
  await sleep(200);
  c.eq('nothing is selected', (await io.selected()).length, 0);
  c.ok('with no text, Type Orientation is greyed', (await io.row('type-vertical'))?.enabled === false && (await io.row('type-horizontal'))?.enabled === false);

  // ---- Font --------------------------------------------------------------------------------------
  await io.menu('type-font');
  const panel = await io.panel();
  const focused = await io.eval('return document.activeElement?.id ?? null;');
  c.ok('Type > Font brings up the Type panel on Character, its font field ready to type in', panel.open && panel.tab === 'character' && focused === 'type-family', JSON.stringify({ open: panel.open, tab: panel.tab, focused }));

  const errors = await page.evalIn('return window.__errors;');
  c.ok('the page threw nothing', errors.length === 0, errors.join(' | '));
} catch (error) {
  c.ok('the sequence ran', false, String(error?.stack ?? error));
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
