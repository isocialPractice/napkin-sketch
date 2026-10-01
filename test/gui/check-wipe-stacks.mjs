/**
 * The Wipe Stacks: a vector editor's Pathfinder on the selected shapes, from
 * the Transform menu and the canvas's right-click menu, each followed by a
 * napkin wiping over the result.
 *
 * Five sequences, each in an app of its own:
 * - The rows, on a red square under an overlapping blue one: the Transform
 *   menu's Wipe Stacks and Wipe Out rows; each of the six once - the marks it
 *   leaves, a pixel where only the red lay, where both did and where only the
 *   blue did - and one undo back; greyed, in the menu bar and on the canvas,
 *   with one shape selected; on the canvas, the Wipe Out rows laid out in the
 *   Wipe Stacks panel, and one of them run from there.
 * - Clean Wipe on three circles: seven marks, each on a layer of its own.
 * - The wipe: while it runs, ahead of its band the page still shows what was
 *   there; a quarter of a second later, the result.
 * - What stops it: reduced motion, the Wipe animation setting, and a press.
 * - Text passed over: a note selected with the squares stays as it was, and
 *   the toast says so.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const SQUARES = resolve(import.meta.dirname, '..', 'imports', 'wipe-squares.svg');
const CIRCLES = resolve(import.meta.dirname, '..', 'imports', 'wipe-circles.svg');
const NOTE = resolve(import.meta.dirname, '..', 'imports', 'wipe-squares-note.svg');
const RED_FILL = '#d0342c';
const BLUE_FILL = '#27486d';

const red = (c) => c[0] > 150 && c[1] < 110 && c[2] < 100;
const blue = (c) => c[2] > c[0] + 20 && c[0] < 90 && c[1] < 120;
const paper = (c) => c[0] > 200 && c[1] > 200 && c[2] > 180;
const named = (c) => (red(c) ? 'red' : blue(c) ? 'blue' : paper(c) ? 'paper' : `rgb(${c.join(',')})`);

/** A menu of the live menu bar, by its label, and a row in it by id. */
const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}
const labelsOf = (items) => items.map((item) => (item.type === 'separator' ? '---' : item.label));

/** An in-window menu's rows as text - label, (disabled), and > for a nested panel - or null while it is hidden. */
const ROWS = (id) => `
  const menu = document.getElementById('${id}');
  if (!menu || menu.classList.contains('is-hidden')) return null;
  return [...menu.children].map((node) => {
    if (node.classList.contains('context-menu-sep')) return '---';
    return (node.querySelector('.context-menu-label')?.textContent ?? '') +
      (node.disabled ? ' (disabled)' : '') +
      (node.classList.contains('has-submenu') ? ' >' : '');
  });`;

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
      wipe: () => page.evalIn('return window.napkinCheck.wipeState();'),
      bar: () => page.evalIn('return await window.napkin.getAppMenu();'),
      async menu(id, wait = 450) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(wait);
        return ran;
      },
      async click(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(250);
      },
      async selectAll() {
        await this.click('tool-select');
        await this.menu('select-all', 300);
      },
      /** A page point, in client pixels. */
      async toClient(p) {
        const r = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top };`);
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: r.x + v.panX + p.x * v.zoom, y: r.y + v.panY + p.y * v.zoom };
      },
      async at(fx, fy) {
        const r = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);
        return { x: r.x + r.w * fx, y: r.y + r.h * fy };
      },
      /** The canvas's colour under a client point, as [r, g, b]. */
      pixel: (p) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          return Array.from(cv.getContext('2d').getImageData(Math.round((${p.x} - r.left) * k), Math.round((${p.y} - r.top) * k), 1, 1).data.slice(0, 3));`),
      async tap(p, button = 'left') {
        const buttons = button === 'left' ? 1 : 2;
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1 });
        await sleep(300);
      },
      async hover(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
        await sleep(300);
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

/** The page points where only the red square lay, where both did and where only the blue did. */
async function probes(io) {
  const marks = await io.marks();
  const a = marks.find((m) => m.fill === RED_FILL).bounds;
  const b = marks.find((m) => m.fill === BLUE_FILL).bounds;
  const both = { x: (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2, y: (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2 };
  return {
    a: await io.toClient({ x: a.minX + 12, y: a.minY + 12 }),
    both: await io.toClient(both),
    b: await io.toClient({ x: b.maxX - 12, y: b.maxY - 12 }),
  };
}

// What each wipe of the red square (below) and the blue one (above) leaves.
const EXPECT = {
  'wipe-in': { marks: 1, a: 'blue', both: 'blue', b: 'blue' },
  'wipe-out-front': { marks: 1, a: 'red', both: 'paper', b: 'paper' },
  'wipe-out-back': { marks: 1, a: 'paper', both: 'paper', b: 'blue' },
  'wipe-mid': { marks: 1, a: 'paper', both: 'blue', b: 'paper' },
  'wipe-outer': { marks: 1, a: 'blue', both: 'paper', b: 'blue' },
  'wipe-clean': { marks: 3, a: 'red', both: 'blue', b: 'blue' },
};

await sequence('The rows', { mode: 'new', sketchName: 'wipe-rows', importFiles: [SQUARES] }, async (io) => {
  const name = 'The rows';
  const bar = await io.bar();
  const stacks = rowOf(menuOf(bar, 'Transform'), 'wipe-stacks');
  c.eq(`${name}: the Transform menu has Wipe Stacks`, labelsOf(stacks?.submenu ?? []).join(' | '), 'Wipe In | Wipe Out | Mid Wipe | Outer Wipes | Clean Wipe');
  c.eq(`${name}: and Wipe Out its two`, labelsOf(rowOf(menuOf(bar, 'Transform'), 'wipe-out')?.submenu ?? []).join(' | '), 'Subtract Top from Below | Subtract Below from Top');
  const where = await probes(io);
  const start = { a: named(await io.pixel(where.a)), both: named(await io.pixel(where.both)), b: named(await io.pixel(where.b)) };
  c.ok(`${name}: the squares arrived, the blue over the red`, start.a === 'red' && start.both === 'blue' && start.b === 'blue', JSON.stringify(start));

  for (const [op, want] of Object.entries(EXPECT)) {
    await io.selectAll();
    await io.menu(op);
    const marks = await io.marks();
    const layers = new Set(marks.map((m) => m.layerId));
    const seen = { a: named(await io.pixel(where.a)), both: named(await io.pixel(where.both)), b: named(await io.pixel(where.b)) };
    c.ok(
      `${name}: ${op} leaves ${want.marks} ${want.marks === 1 ? 'mark' : 'marks'}, each on a layer of its own`,
      marks.length === want.marks && layers.size === want.marks,
      JSON.stringify(marks.map((m) => [m.fill, m.layer])),
    );
    c.ok(`${name}: ${op} shows ${want.a}, ${want.both}, ${want.b}`, seen.a === want.a && seen.both === want.both && seen.b === want.b, JSON.stringify(seen));
    await io.menu('undo', 300);
    const back = await io.marks();
    c.ok(`${name}: one undo of ${op} puts both squares back`, back.length === 2 && back.some((m) => m.fill === RED_FILL) && back.some((m) => m.fill === BLUE_FILL), JSON.stringify(back.map((m) => m.fill)));
  }

  // One shape selected: greyed in the menu bar and on the canvas.
  await io.click('tool-select');
  await io.menu('deselect-all', 250);
  await io.tap(where.a);
  const one = rowOf(menuOf(await io.bar(), 'Transform'), 'wipe-stacks');
  c.eq(`${name}: with one shape selected, the row is greyed`, one?.enabled, false);
  const empty = await io.at(0.95, 0.9);
  await io.tap(empty, 'right');
  const greyed = await io.eval(ROWS('context-menu'));
  c.ok(`${name}: and so is the canvas menu's`, (greyed ?? []).includes('Wipe Stacks (disabled) >'), JSON.stringify(greyed));
  await io.page.chord(27, 'Escape');
  await sleep(200);

  // Both selected: on the canvas, Wipe Out's rows are in the Wipe Stacks panel.
  await io.selectAll();
  await io.tap(empty, 'right');
  const rows = await io.eval(ROWS('context-menu'));
  c.ok(`${name}: with both selected, the canvas menu has Wipe Stacks`, (rows ?? []).includes('Wipe Stacks >'), JSON.stringify(rows));
  const row = await io.eval(`
    const r = [...document.querySelectorAll('#context-menu button')].find((b) => b.querySelector('.context-menu-label')?.textContent === 'Wipe Stacks').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  await io.hover(row);
  const panel = await io.eval(ROWS('context-submenu'));
  c.eq(
    `${name}: and its panel lays Wipe Out's rows out in it`,
    (panel ?? []).join(' | '),
    'Wipe In | --- | Wipe Out: Subtract Top from Below | Wipe Out: Subtract Below from Top | --- | Mid Wipe | Outer Wipes | Clean Wipe',
  );
  await io.eval(`[...document.querySelectorAll('#context-submenu button')].find((b) => b.querySelector('.context-menu-label')?.textContent === 'Wipe Out: Subtract Top from Below').click(); return true;`);
  await sleep(450);
  const after = await io.marks();
  c.ok(`${name}: run from there, it subtracts the top from below`, after.length === 1 && after[0].fill === RED_FILL, JSON.stringify(after.map((m) => m.fill)));
});

await sequence('Clean Wipe on three circles', { mode: 'new', sketchName: 'wipe-circles', importFiles: [CIRCLES] }, async (io) => {
  const name = 'Clean Wipe on three circles';
  c.eq(`${name}: three circles arrived`, (await io.marks()).length, 3);
  await io.selectAll();
  await io.menu('wipe-clean');
  const marks = await io.marks();
  c.eq(`${name}: seven faces`, marks.length, 7);
  c.eq(`${name}: each on a layer of its own`, new Set(marks.map((m) => m.layerId)).size, 7);
  c.eq(`${name}: and all of them selected`, await io.eval('return window.napkinCheck.selectionBoxes().length;'), 7);
  await io.menu('undo', 300);
  c.eq(`${name}: one undo puts the three back`, (await io.marks()).length, 3);
});

await sequence('The wipe', { mode: 'new', sketchName: 'wipe-motion', importFiles: [SQUARES] }, async (io) => {
  const name = 'The wipe';
  const where = await probes(io);
  await io.selectAll();
  // Where only the blue lay, Subtract Top from Below leaves paper; while the
  // napkin is still on its way across, the page there shows the blue from before.
  const began = Date.now();
  await io.menu('wipe-out-front', 0);
  const samples = [];
  while (Date.now() - began < 700) {
    const s = await io.eval(`
      const w = window.napkinCheck.wipeState();
      const cv = document.getElementById('canvas');
      const r = cv.getBoundingClientRect();
      const k = cv.width / r.width;
      const d = cv.getContext('2d').getImageData(Math.round((${where.b.x} - r.left) * k), Math.round((${where.b.y} - r.top) * k), 1, 1).data;
      return { active: w.active, t: w.t, pixel: [d[0], d[1], d[2]] };`);
    samples.push({ ...s, ms: Date.now() - began });
  }
  const running = samples.filter((s) => s.active);
  c.ok(`${name}: it runs`, running.length > 0, JSON.stringify(samples.slice(0, 4)));
  c.ok(`${name}: ahead of the napkin the page still shows the blue from before`, running.some((s) => s.t < 0.5 && blue(s.pixel)), JSON.stringify(running.map((s) => [s.t?.toFixed(2), named(s.pixel)])));
  c.ok(`${name}: for a quarter of a second or so`, !samples.some((s) => s.active && s.ms > 450), JSON.stringify(samples.map((s) => [s.ms, s.active])));
  c.eq(`${name}: and then the result`, named(await io.pixel(where.b)), 'paper');
  c.eq(`${name}: the page already held the result while it ran`, (await io.marks()).length, 1);
});

await sequence('What stops it', { mode: 'new', sketchName: 'wipe-stops', importFiles: [SQUARES] }, async (io) => {
  const name = 'What stops it';
  const where = await probes(io);

  await io.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await io.selectAll();
  await io.menu('wipe-out-front', 0);
  const reduced = await io.wipe();
  c.eq(`${name}: with reduced motion, no wipe`, reduced.active, false);
  c.eq(`${name}: and the result at once`, named(await io.pixel(where.b)), 'paper');
  await io.menu('undo', 300);
  await io.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  await io.eval('await window.napkin.updateSettings({ wipeAnimation: false }); return true;');
  await sleep(400);
  await io.selectAll();
  await io.menu('wipe-out-front', 0);
  c.eq(`${name}: with Wipe animation off, no wipe`, (await io.wipe()).active, false);
  await io.menu('undo', 300);
  await io.eval('await window.napkin.updateSettings({ wipeAnimation: true }); return true;');
  await sleep(400);

  // A press while the napkin crosses ends the wipe, and draws.
  await io.selectAll();
  await io.click('tool-pen');
  await io.menu('wipe-out-front', 0);
  c.eq(`${name}: the wipe is under way`, (await io.wipe()).active, true);
  const from = await io.at(0.85, 0.2);
  await io.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await io.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  c.eq(`${name}: a press ends it at once`, (await io.wipe()).active, false);
  for (let i = 1; i <= 10; i++) {
    await io.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + i * 8, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(10);
  }
  await io.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: from.y + 80, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  c.eq(`${name}: and the press draws`, (await io.marks()).length, 2);
});

// Every selected mark goes to the wipe, which takes the shapes and passes over the rest.
await sequence('Text passed over', { mode: 'new', sketchName: 'wipe-note', importFiles: [NOTE] }, async (io) => {
  const name = 'Text passed over';
  const before = await io.marks();
  const note = before.find((m) => m.tool === 'text');
  c.ok(`${name}: two squares and a note arrived`, before.length === 3 && note !== undefined, JSON.stringify(before.map((m) => m.tool)));
  await io.selectAll();
  await io.eval("document.getElementById('toast').textContent = ''; return true;");
  await io.menu('wipe-in');
  const after = await io.marks();
  c.eq(`${name}: the squares are one`, after.length, 2);
  c.ok(`${name}: and the note is as it was`, after.some((m) => m.id === note?.id && JSON.stringify(m.bounds) === JSON.stringify(note?.bounds)), JSON.stringify(after));
  c.eq(`${name}: and the toast says it was passed over`, await io.eval("return document.getElementById('toast').textContent;"), '1 shape left; text and pictures passed over.');
});

process.exit(c.summary() ? 0 : 1);
