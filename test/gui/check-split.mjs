/**
 * Split: a vector editor's Scissors - a click on a path cuts it there, and
 * nothing moves.
 *
 * Three sequences, each in an app of its own:
 * - A line: the Sketch menu's row and key, the button beside the Shape
 *   Stacker's, the canvas keeping its height and the scissors cursor; the
 *   ring where a click would cut; a click on the line's end cutting nothing;
 *   a click on its middle giving two marks on two layers, no point moved -
 *   the pieces' points are the line's and the cut - and one undo back.
 * - A closed rectangle: opened by one click, one open path; divided by a
 *   second, two; one undo each.
 * - Text: a click on it says Split cuts paths and lines.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const NOTE = resolve(import.meta.dirname, '..', 'imports', 'wipe-squares-note.svg');

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
      geometry: (id) => page.evalIn(`return window.napkinCheck.strokeGeometry(${JSON.stringify(id)});`),
      state: () => page.evalIn('return window.napkinCheck.splitState ? window.napkinCheck.splitState() : undefined;'),
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
        await sleep(250);
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
        await sleep(250);
      },
      async tap(p) {
        await this.hover(p);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
      },
      /** A press, a straight walk to `b` in `steps` moves, and the release. */
      async drag(a, b, steps = 16) {
        await this.hover(a);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(12);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
        // A fresh app now and then keeps the first press on record past its
        // release (the harness's short-first-stroke quirk): wait it out, so
        // the next move is the tool's and not the press's.
        for (let k = 0; k < 20 && (await page.evalIn('return window.napkinCheck.inputState().pressKind;')) !== null; k++) await sleep(100);
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

const key = (p) => `${p.x},${p.y}`;

await sequence('A line', { mode: 'new', sketchName: 'split-line' }, async (io) => {
  const name = 'A line';
  const sketch = labelsOf(menuOf(await io.bar(), 'Sketch'));
  c.ok(`${name}: the Sketch menu has Split after the Shape Stacker`, sketch.indexOf('Split') === sketch.indexOf('Shape Stacker') + 1, sketch.join(' | '));
  c.ok(`${name}: with its button beside the Shape Stacker's`, await io.eval("return document.getElementById('tool-shape-stacker').nextElementSibling?.id === 'tool-split';"));
  c.ok(`${name}: and the canvas keeps its height`, Math.abs((await io.rect()).h - 617.67) < 1, String((await io.rect()).h));

  // A straight Brush line is two anchors and two points.
  await io.click('tool-pen');
  await io.drag(await io.at(0.3, 0.5), await io.at(0.6, 0.5));
  const [line] = await io.marks();
  const before = (await io.geometry(line.id)).points;
  c.eq(`${name}: a straight line of two points`, before.length, 2);

  await io.chord(74, 'j');
  c.eq(`${name}: J takes Split`, await io.tool(), 'split');
  c.ok(`${name}: with the scissors for a cursor`, (await io.eval("return document.getElementById('canvas').style.cursor;")).includes('split-cursor.svg'));
  const middle = await io.toClient({ x: (line.first.x + line.last.x) / 2, y: (line.first.y + line.last.y) / 2 });
  await io.hover(middle);
  const ring = await io.state();
  c.ok(`${name}: over the line, the ring shows where it would cut`, ring?.id === line.id && Math.abs(ring.point.y - line.first.y) < 0.01, JSON.stringify(ring));
  await io.hover(await io.at(0.45, 0.8));
  c.eq(`${name}: and off it, no ring`, await io.state(), null);

  await io.eval("document.getElementById('toast').textContent = ''; return true;");
  await io.tap(await io.toClient(line.first));
  c.eq(`${name}: a click on the line's end cuts nothing`, (await io.marks()).length, 1);
  c.eq(`${name}: and says so`, await io.toast(), 'That is the end of the path: there is nothing there to cut.');

  await io.tap(middle);
  const pieces = await io.marks();
  c.eq(`${name}: a click on its middle gives two marks`, pieces.length, 2);
  c.eq(`${name}: on two layers`, new Set(pieces.map((m) => m.layerId)).size, 2);
  const after = [];
  for (const m of pieces) after.push(...(await io.geometry(m.id)).points);
  const kept = before.every((p) => after.some((q) => q.x === p.x && q.y === p.y));
  const added = [...new Set(after.map(key))].filter((k) => !before.some((p) => key(p) === k));
  c.ok(`${name}: no point moved - the line's points are all there`, kept, JSON.stringify(after));
  c.eq(`${name}: and one more, the cut`, added.length, 1);
  c.eq(`${name}: the pieces are selected`, await io.eval('return window.napkinCheck.selectionBoxes().length;'), 2);
  c.eq(`${name}: and Split stays in hand`, await io.tool(), 'split');
  await io.menu('undo');
  const back = await io.marks();
  c.ok(`${name}: one undo puts the line back`, back.length === 1 && (await io.geometry(back[0].id)).points.length === 2, JSON.stringify(back));
});

await sequence('A closed rectangle', { mode: 'new', sketchName: 'split-rect' }, async (io) => {
  const name = 'A closed rectangle';
  await io.click('tool-rect');
  await io.drag(await io.at(0.3, 0.3), await io.at(0.6, 0.6));
  const [rect] = await io.marks();
  const b = rect.bounds;
  await io.click('tool-split');
  await io.tap(await io.toClient({ x: (b.minX + b.maxX) / 2, y: b.minY }));
  let marks = await io.marks();
  c.ok(`${name}: one click opens it, one open path`, marks.length === 1 && marks[0].closed === false && marks[0].id === rect.id, JSON.stringify(marks));
  c.ok(`${name}: starting and ending at the cut`, Math.abs(marks[0].first.y - b.minY) < 0.01 && Math.abs(marks[0].last.y - b.minY) < 0.01, JSON.stringify(marks[0]));
  await io.tap(await io.toClient({ x: (b.minX + b.maxX) / 2, y: b.maxY }));
  marks = await io.marks();
  c.eq(`${name}: a second click divides it in two`, marks.length, 2);
  await io.menu('undo');
  c.eq(`${name}: one undo joins it again`, (await io.marks()).length, 1);
  await io.menu('undo');
  marks = await io.marks();
  c.ok(`${name}: and another closes it`, marks.length === 1 && marks[0].closed !== false, JSON.stringify(marks));
});

await sequence('Text', { mode: 'new', sketchName: 'split-text', importFiles: [NOTE] }, async (io) => {
  const name = 'Text';
  const note = (await io.marks()).find((m) => m.tool === 'text');
  await io.click('tool-split');
  await io.eval("document.getElementById('toast').textContent = ''; return true;");
  await io.tap(await io.toClient({ x: (note.bounds.minX + note.bounds.maxX) / 2, y: (note.bounds.minY + note.bounds.maxY) / 2 }));
  c.eq(`${name}: a click on text says what Split cuts`, await io.toast(), 'Split cuts paths and lines.');
  c.eq(`${name}: and cuts nothing`, (await io.marks()).length, 3);
});

process.exit(c.summary() ? 0 : 1);
