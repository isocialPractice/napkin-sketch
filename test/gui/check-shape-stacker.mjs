/**
 * The Shape Stacker: a vector editor's Shape Builder on the selected shapes,
 * beside the Shape Eraser, with the Wipe Stacks in its panel.
 *
 * Four sequences, each in an app of its own, on a red square under an
 * overlapping blue one (test/imports/wipe-squares.svg):
 * - The button and the panel: the Sketch menu's row and key, the button
 *   taking the tool and opening the six tiles - greyed with nothing
 *   selected - Escape closing them, Shift+M opening them again, a tile
 *   running its wipe with one undo, and the canvas keeping its height.
 * - Stacking: the piece under the pointer shaded; a drag across the red
 *   square's own piece and the overlap merging them into the red square
 *   again; an Alt-click taking the overlap from both; a Shift box over
 *   everything merging it into one shape; Escape dropping a drag; one undo
 *   each.
 * - Nothing to stack: with one square selected a press gives the notice.
 * - The cursor: a plus, and with Alt a minus.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const SQUARES = resolve(import.meta.dirname, '..', 'imports', 'wipe-squares.svg');
const RED_FILL = '#d0342c';
const BLUE_FILL = '#27486d';

const red = (c) => c[0] > 150 && c[1] < 110 && c[2] < 100;
const blue = (c) => c[2] > c[0] + 20 && c[0] < 90 && c[1] < 120;
const paper = (c) => c[0] > 200 && c[1] > 200 && c[2] > 180;
const named = (c) => (red(c) ? 'red' : blue(c) ? 'blue' : paper(c) ? 'paper' : `rgb(${c.join(',')})`);

/** A menu of the live menu bar, by its label, and a row in it by id. */
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
      state: () => page.evalIn('return window.napkinCheck.shapeStackerState ? window.napkinCheck.shapeStackerState() : null;'),
      tool: () => page.evalIn("return document.getElementById('canvas').dataset.tool;"),
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
      /** A page point, in client pixels. */
      async toClient(p) {
        const r = await this.rect();
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: r.x + v.panX + p.x * v.zoom, y: r.y + v.panY + p.y * v.zoom };
      },
      /** The canvas's colour under a client point, as [r, g, b]. */
      pixel: (p) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          return Array.from(cv.getContext('2d').getImageData(Math.round((${p.x} - r.left) * k), Math.round((${p.y} - r.top) * k), 1, 1).data.slice(0, 3));`),
      async hover(p, modifiers = 0) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers });
        await sleep(250);
      },
      async press(p, modifiers = 0) {
        await this.hover(p, modifiers);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
      },
      /** Moves with the button held from `a` to `b`, in `steps`. */
      async drag(a, b, steps = 12, modifiers = 0) {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, button: 'left', buttons: 1, clickCount: 1, modifiers });
          await sleep(12);
        }
      },
      async release(p, modifiers = 0) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
        await sleep(400);
      },
      async selectAll() {
        await this.click('tool-select');
        await this.menu('select-all', 300);
      },
      /** The Shape Stacker in hand, its panel put away. */
      async stacker() {
        await this.click('tool-shape-stacker');
        await this.chord(27, 'Escape');
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

/** Client points where only the red square lies, where both do, where only the blue does, and off both. */
async function probes(io) {
  const marks = await io.marks();
  const a = marks.find((m) => m.fill === RED_FILL).bounds;
  const b = marks.find((m) => m.fill === BLUE_FILL).bounds;
  const both = { x: (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2, y: (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2 };
  return {
    boundsA: a,
    a: await io.toClient({ x: a.minX + 12, y: a.minY + 12 }),
    both: await io.toClient(both),
    b: await io.toClient({ x: b.maxX - 12, y: b.maxY - 12 }),
    before: await io.toClient({ x: a.minX - 15, y: a.minY - 15 }),
    after: await io.toClient({ x: b.maxX + 15, y: b.maxY + 15 }),
    off: await io.toClient({ x: b.maxX + 60, y: a.minY }),
  };
}

const TILES = 'wipe-in wipe-out-front wipe-out-back wipe-mid wipe-outer wipe-clean';

await sequence('The button and the panel', { mode: 'new', sketchName: 'stacker-panel', importFiles: [SQUARES] }, async (io) => {
  const name = 'The button and the panel';
  const sketch = labelsOf(menuOf(await io.bar(), 'Sketch'));
  c.ok(`${name}: the Sketch menu has the Shape Stacker after the Shape Eraser`, sketch.indexOf('Shape Stacker') === sketch.indexOf('Shape Eraser') + 1, sketch.join(' | '));
  c.ok(
    `${name}: with its button beside the Shape Eraser's`,
    await io.eval("return document.getElementById('tool-shape-eraser').nextElementSibling?.id === 'tool-shape-stacker';"),
  );
  c.ok(`${name}: and the canvas keeps its height`, Math.abs((await io.rect()).h - 617.67) < 1, String((await io.rect()).h));

  await io.eval('await window.napkin.clickAppMenuItem("deselect-all"); return true;');
  await io.click('tool-shape-stacker');
  let state = await io.state();
  c.eq(`${name}: the button takes the Shape Stacker`, await io.tool(), 'shape-stacker');
  c.ok(`${name}: and opens its panel`, state?.panelOpen === true, JSON.stringify(state));
  c.eq(`${name}: with the six Wipe Stacks`, state?.tiles.join(' '), TILES);
  c.eq(`${name}: greyed with nothing selected`, state?.greyed, 6);
  await io.chord(27, 'Escape');
  c.eq(`${name}: Escape closes it`, (await io.state())?.panelOpen, false);

  await io.selectAll();
  await io.chord(77, 'M', 8);
  state = await io.state();
  c.ok(`${name}: Shift+M takes the tool and opens the panel again`, (await io.tool()) === 'shape-stacker' && state?.panelOpen === true, JSON.stringify(state));
  c.eq(`${name}: its tiles ready with both squares selected`, state?.greyed, 0);
  await io.eval("document.querySelector('.shape-stacker-panel [data-command=\"wipe-mid\"]').click(); return true;");
  await sleep(500);
  const mid = await io.marks();
  c.ok(`${name}: the Mid Wipe tile wipes them into their overlap`, mid.length === 1 && mid[0].fill === BLUE_FILL, JSON.stringify(mid.map((m) => m.fill)));
  c.eq(`${name}: and the panel is put away`, (await io.state())?.panelOpen, false);
  await io.menu('undo');
  c.eq(`${name}: one undo puts both squares back`, (await io.marks()).length, 2);
});

await sequence('Stacking', { mode: 'new', sketchName: 'stacker-stacks', importFiles: [SQUARES] }, async (io) => {
  const name = 'Stacking';
  const at = await probes(io);
  await io.selectAll();
  await io.stacker();
  c.eq(`${name}: the Shape Stacker is in hand`, await io.tool(), 'shape-stacker');

  // The piece under the pointer is shaded.
  await io.hover(at.off);
  const plain = await io.pixel(at.both);
  await io.hover(at.both);
  const shaded = await io.pixel(at.both);
  const state = await io.state();
  c.eq(`${name}: two squares make three pieces`, state?.faces, 3);
  c.ok(`${name}: the overlap under the pointer is the piece shaded`, state?.hover >= 0, JSON.stringify(state));
  c.ok(`${name}: and it shows`, plain.some((v, k) => Math.abs(v - shaded[k]) >= 6), `${plain} -> ${shaded}`);
  await io.hover(at.off);
  c.eq(`${name}: off the squares nothing is`, (await io.state())?.hover, -1);

  // A drag across the red square's own piece and the overlap.
  await io.press(at.a);
  await io.drag(at.a, at.both);
  c.eq(`${name}: the drag marks the two pieces it crossed`, (await io.state())?.marked?.length, 2);
  await io.release(at.both);
  let marks = await io.marks();
  const square = marks.find((m) => m.fill === RED_FILL);
  c.eq(`${name}: the drag leaves two marks`, marks.length, 2);
  c.ok(
    `${name}: the merged one is the red square again, four corners`,
    square && square.anchors === 4 && ['minX', 'minY', 'maxX', 'maxY'].every((k) => Math.abs(square.bounds[k] - at.boundsA[k]) < 0.5),
    JSON.stringify(square),
  );
  c.eq(`${name}: and the overlap shows it now`, named(await io.pixel(at.both)), 'red');
  c.eq(`${name}: the tool stays in hand`, await io.tool(), 'shape-stacker');
  await io.menu('undo');
  c.eq(`${name}: one undo puts the blue square back over it`, named(await io.pixel(at.both)), 'blue');
  // An undo clears the selection: the squares are selected again for the next stack.
  await io.menu('select-all', 300);

  // Alt takes the piece away from both.
  await io.press(at.both, 1);
  await io.release(at.both, 1);
  marks = await io.marks();
  c.eq(`${name}: an Alt-click takes the overlap from both squares`, named(await io.pixel(at.both)), 'paper');
  c.ok(`${name}: and leaves both`, marks.length === 2 && named(await io.pixel(at.a)) === 'red' && named(await io.pixel(at.b)) === 'blue', `${marks.length}`);
  await io.menu('undo');
  c.eq(`${name}: one undo puts it back`, named(await io.pixel(at.both)), 'blue');
  await io.menu('select-all', 300);

  // A Shift box over everything.
  await io.press(at.before, 8);
  await io.drag(at.before, at.after, 12, 8);
  c.eq(`${name}: the box marks every piece`, (await io.state())?.marked?.length, 3);
  await io.release(at.after, 8);
  marks = await io.marks();
  c.ok(`${name}: a Shift box over everything merges it into one shape`, marks.length === 1 && marks[0].fill === BLUE_FILL, JSON.stringify(marks.map((m) => m.fill)));
  await io.menu('undo');
  c.eq(`${name}: one undo puts the squares back`, (await io.marks()).length, 2);
  await io.menu('select-all', 300);
  c.eq(`${name}: Select All leaves the Shape Stacker in hand`, await io.tool(), 'shape-stacker');

  // Escape drops a drag.
  await io.press(at.a);
  await io.drag(at.a, at.both);
  await io.chord(27, 'Escape');
  await io.release(at.both);
  c.ok(`${name}: Escape drops a drag, merging nothing`, (await io.marks()).length === 2 && named(await io.pixel(at.both)) === 'blue');
  c.eq(`${name}: and nothing is left marked`, (await io.state())?.marked, null);
});

await sequence('Nothing to stack', { mode: 'new', sketchName: 'stacker-notice', importFiles: [SQUARES] }, async (io) => {
  const name = 'Nothing to stack';
  const at = await probes(io);
  await io.click('tool-select');
  await io.press(at.a);
  await io.release(at.a);
  await io.stacker();
  await io.press(at.a);
  await io.release(at.a);
  const state = await io.state();
  c.eq(`${name}: with one square selected a press gives the notice`, state?.notice, 'shape-stacker-too-few');
  c.eq(
    `${name}: which says what to do`,
    await io.eval("return document.getElementById('notice-text').textContent;"),
    'Select two or more shapes to stack.',
  );
  await io.chord(13, 'Enter');
  c.eq(`${name}: Enter closes it`, (await io.state())?.notice, null);
  c.eq(`${name}: and nothing changed`, (await io.marks()).length, 2);
});

await sequence('The cursor', { mode: 'new', sketchName: 'stacker-cursor', importFiles: [SQUARES] }, async (io) => {
  const name = 'The cursor';
  const at = await probes(io);
  await io.stacker();
  await io.hover(at.off);
  const plus = await io.eval("return document.getElementById('canvas').style.cursor;");
  c.ok(`${name}: a drawn cursor`, plus.includes('url('), plus.slice(0, 40));
  await io.hover(at.off, 1);
  const minus = await io.eval("return document.getElementById('canvas').style.cursor;");
  c.ok(`${name}: and another with Alt held`, minus.includes('url(') && minus !== plus);
  await io.hover(at.off);
  c.eq(`${name}: and the first again once it is let go`, await io.eval("return document.getElementById('canvas').style.cursor;"), plus);
});

process.exit(c.summary() ? 0 : 1);
