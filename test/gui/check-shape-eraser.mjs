/**
 * The Shape Eraser cuts a dragged shape out of the selected marks.
 *
 * New in 1.0.0-alpha.4.6.0, beside the Eraser: a press of its button takes
 * the tool and opens a panel of four shapes - Rectangle, Ellipse, Square,
 * Circle - with Top Path across the bottom; a drag cuts the shape out of
 * the selection by the Eraser's rules; Top Path cuts the other selected
 * marks with the topmost closed path, and takes the path away; and a notice
 * says why when there is nothing to cut with or nothing to cut.
 *
 * Five sequences, each in an app of its own: the panel - below the button,
 * the five choices, the arrows and Enter choosing Ellipse and the hover
 * text naming it, Shift+E opening it again and Escape closing it; a
 * rectangle dragged over four lines with three selected - the three cut
 * where it passed, already with the press held, and the fourth not, no mark
 * or layer added, the outline gone once let go, the selection kept, and one
 * undo putting all three back; Top Path with a closed rectangle over two
 * lines - both cut by its interior, the rectangle taken away, one undo for
 * all of it; Top Path again with a closed Vector Path; and the notices -
 * nothing selected, Enter closing it without the Move dialog behind, ticked
 * away and then only a toast; one mark selected; and an open line on top.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

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
      rect: () => page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`),
      async at(fx, fy) {
        const r = await this.rect();
        return { x: r.x + r.w * fx, y: r.y + r.h * fy };
      },
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      /** Every mark's points, as the page holds them, one string a mark. */
      shapes: () => page.evalIn('return window.napkinCheck.strokeSummary().map((m) => JSON.stringify(window.napkinCheck.strokeGeometry(m.id).points));'),
      layers: () => page.evalIn('return window.napkinCheck.layerRows();'),
      boxes: () => page.evalIn('return window.napkinCheck.selectionBoxes();'),
      state: () => page.evalIn('return window.napkinCheck.shapeEraserState();'),
      tool: () => page.evalIn("return document.getElementById('canvas').dataset.tool;"),
      eval: (code) => page.evalIn(code),
      async click(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(250);
      },
      async menu(id) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(400);
        return ran;
      },
      async chord(code, key, modifiers = 0) {
        await page.chord(code, key, modifiers);
        await sleep(150);
      },
      async press(p, modifiers = 0) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
      },
      /** Moves with the button held along `path` (0 to 1), in `steps`. */
      async drag(path, steps) {
        for (let i = 1; i <= steps; i++) {
          const p = path(i / steps);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(10);
        }
      },
      async release(p, modifiers = 0) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
        await sleep(400);
      },
      async tap(p, modifiers = 0) {
        await this.press(p, modifiers);
        await this.release(p, modifiers);
      },
      /** A press, a walk along `path` (0 to 1) in `steps` moves, and the release. */
      async draw(path, steps = 24) {
        await this.press(path(0));
        await this.drag(path, steps);
        await this.release(path(1));
      },
      /** The canvas's colour under client points, as [r, g, b]. */
      pixels: (points) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          const ctx = cv.getContext('2d');
          return ${JSON.stringify(points)}.map((p) => Array.from(ctx.getImageData(Math.round((p.x - r.left) * k), Math.round((p.y - r.top) * k), 1, 1).data.slice(0, 3)));`),
      async tones(points) {
        return (await this.pixels(points)).map((rgb) => rgb[0]);
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

const line = (a, b) => (s) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });

/** Thick pen lines across the canvas from 20% to 60%, at each of `rows` down. */
async function lines(io, rows) {
  await io.click('tool-pen');
  // Quick Width 8.
  await io.chord(87, 'w');
  await io.chord(56, '8');
  await sleep(1300);
  for (const fy of rows) await io.draw(line(await io.at(0.2, fy), await io.at(0.6, fy)));
  return io.marks();
}

/** Whether any of a row of pixels is the Shape Eraser's blue outline. */
const outlineIn = (pixels) => pixels.some(([r, , b]) => b - r > 30);

await sequence('The panel', { mode: 'new', sketchName: 'shape-eraser-panel' }, async (io) => {
  const name = 'The panel';
  await io.click('tool-shape-eraser');
  const state = await io.state();
  c.eq(`${name}: the button takes the Shape Eraser`, await io.tool(), 'shape-eraser');
  c.ok(`${name}: and opens its panel`, state.panelOpen, JSON.stringify(state));
  c.eq(`${name}: with the four shapes and Top Path`, state.choices.join(' '), 'rect ellipse square circle top-path');
  const place = await io.eval(`
    const b = document.getElementById('tool-shape-eraser').getBoundingClientRect();
    const p = document.querySelector('.shape-eraser-panel').getBoundingClientRect();
    return { below: p.top >= b.bottom - 1, left: Math.abs(p.left - b.left) < 2, focused: document.activeElement?.dataset?.shape ?? null };`);
  c.ok(`${name}: below the button, at its left edge`, place.below && place.left, JSON.stringify(place));
  c.eq(`${name}: with the shape in use focused`, place.focused, 'rect');
  await io.chord(39, 'ArrowRight');
  await io.chord(13, 'Enter');
  const chosen = await io.state();
  c.ok(`${name}: the arrows and Enter choose Ellipse and close the panel`, chosen.shape === 'ellipse' && !chosen.panelOpen, JSON.stringify(chosen));
  const title = await io.eval("return document.getElementById('tool-shape-eraser').title;");
  c.ok(`${name}: and the button's hover text names it`, /drag an ellipse/.test(title), title);
  c.ok(`${name}: the Move dialog did not take the Enter`, await io.eval("return document.getElementById('move-dialog').classList.contains('is-hidden');"));
  await io.eval('document.activeElement?.blur(); return true;');
  await io.chord(69, 'E', 8);
  c.ok(`${name}: Shift+E opens the panel again`, (await io.state()).panelOpen);
  await io.chord(27, 'Escape');
  const closed = await io.state();
  c.ok(`${name}: and Escape closes it`, !closed.panelOpen, JSON.stringify(closed));
  c.eq(`${name}: handing the focus back to the button`, await io.eval('return document.activeElement?.id ?? null;'), 'tool-shape-eraser');
  c.eq(`${name}: with the Shape Eraser still in hand`, await io.tool(), 'shape-eraser');
});

await sequence('A rectangle over three selected lines of four', { mode: 'new', sketchName: 'shape-eraser-rect' }, async (io) => {
  const name = 'A rectangle over three selected lines of four';
  const rows = [0.3, 0.45, 0.6, 0.75];
  const marks = await lines(io, rows);
  await io.click('tool-select');
  await io.menu('select-all');
  // Shift-click takes the fourth line out of the selection.
  await io.tap(await io.at(0.3, rows[3]), 8);
  const selected = (await io.boxes()).map((b) => b.id);
  c.ok(`${name}: three lines are selected`, selected.length === 3 && !selected.includes(marks[3].id), JSON.stringify(selected));
  const layersBefore = (await io.layers()).map((l) => l.id);
  const shapesBefore = await io.shapes();
  await io.click('tool-shape-eraser');
  await io.eval(`document.querySelector('.shape-tile[data-shape="rect"]').click(); return true;`);
  await sleep(200);
  const inside = await Promise.all(rows.map((fy) => io.at(0.4, fy)));
  const outside = await Promise.all(rows.map((fy) => io.at(0.3, fy)));
  const edge = [];
  for (let dx = -5; dx <= 5; dx++) edge.push({ x: (await io.at(0.35, 0.25)).x + dx, y: (await io.at(0.35, 0.25)).y });
  c.ok(`${name}: before the cut, all four lines are ink where it will pass`, (await io.tones(inside)).every((t) => t < 100), JSON.stringify(await io.tones(inside)));

  // The drag, held before it is let go.
  const from = await io.at(0.35, 0.2);
  const to = await io.at(0.45, 0.85);
  await io.press(from);
  await io.drag(line(from, to), 24);
  await sleep(250);
  const during = await io.tones(inside);
  c.ok(`${name}: with the press held, the three selected lines already show the paper inside it`, during.slice(0, 3).every((t) => t > 200), JSON.stringify(during));
  c.ok(`${name}: and the fourth is ink`, during[3] < 100, JSON.stringify(during));
  c.ok(`${name}: the shape's outline is drawn`, outlineIn(await io.pixels(edge)), JSON.stringify(await io.pixels(edge)));
  await io.release(to);

  const after = await io.tones(inside);
  c.ok(`${name}: let go, the three are cut where it passed`, after.slice(0, 3).every((t) => t > 200), JSON.stringify(after));
  c.ok(`${name}: and the unselected line is not`, after[3] < 100, JSON.stringify(after));
  c.ok(`${name}: beside it, all four are ink`, (await io.tones(outside)).every((t) => t < 100), JSON.stringify(await io.tones(outside)));
  c.ok(`${name}: the outline is gone`, !outlineIn(await io.pixels(edge)), JSON.stringify(await io.pixels(edge)));
  const cut = await io.marks();
  c.ok(`${name}: no mark is added, and none is an eraser`, cut.length === 4 && cut.every((m) => m.tool !== 'eraser'), JSON.stringify(cut.map((m) => m.tool)));
  const shapesAfter = await io.shapes();
  const changed = cut.filter((m, i) => shapesAfter[i] !== shapesBefore[i]).map((m) => m.id);
  c.ok(`${name}: the three selected marks changed, and only they`, changed.length === 3 && !changed.includes(marks[3].id), JSON.stringify(changed));
  c.ok(`${name}: no layer is added`, JSON.stringify((await io.layers()).map((l) => l.id)) === JSON.stringify(layersBefore), `${layersBefore.length} rows before, ${(await io.layers()).length} after`);
  c.eq(`${name}: the selection stays, for the next cut`, (await io.boxes()).length, 3);
  c.eq(`${name}: and so does the tool`, await io.tool(), 'shape-eraser');
  await io.menu('undo');
  c.ok(`${name}: one undo puts all three back`, (await io.tones(inside)).every((t) => t < 100), JSON.stringify(await io.tones(inside)));
});

await sequence('Top Path', { mode: 'new', sketchName: 'shape-eraser-top' }, async (io) => {
  const name = 'Top Path';
  const rows = [0.3, 0.5];
  await lines(io, rows);
  // A closed rectangle drawn over both, on top of them.
  await io.click('tool-rect');
  await io.draw(line(await io.at(0.35, 0.2), await io.at(0.45, 0.6)), 16);
  const before = await io.marks();
  c.eq(`${name}: two lines and a rectangle`, before.length, 3);
  const cutter = before[2];
  await io.click('tool-select');
  await io.menu('select-all');
  const inside = await Promise.all(rows.map((fy) => io.at(0.4, fy)));
  const outside = await Promise.all(rows.map((fy) => io.at(0.3, fy)));
  await io.click('tool-shape-eraser');
  await io.eval(`document.querySelector('.shape-eraser-panel .top-path').click(); return true;`);
  await sleep(400);
  const after = await io.marks();
  c.ok(`${name}: the rectangle is taken away`, after.length === 2 && !after.some((m) => m.id === cutter.id), JSON.stringify(after.map((m) => m.id)));
  c.ok(`${name}: and the panel is put away`, !(await io.state()).panelOpen);
  c.ok(`${name}: both lines are cut by its inside`, (await io.tones(inside)).every((t) => t > 200), JSON.stringify(await io.tones(inside)));
  c.ok(`${name}: and are ink outside it`, (await io.tones(outside)).every((t) => t < 100), JSON.stringify(await io.tones(outside)));
  await io.menu('undo');
  const undone = await io.marks();
  c.ok(`${name}: one undo puts the rectangle back`, undone.length === 3 && undone.some((m) => m.id === cutter.id), JSON.stringify(undone.map((m) => m.id)));
  c.ok(`${name}: and the lines whole`, (await io.tones(inside)).every((t) => t < 100), JSON.stringify(await io.tones(inside)));
});

await sequence('Top Path with a closed Vector Path', { mode: 'new', sketchName: 'shape-eraser-vector' }, async (io) => {
  const name = 'Top Path with a closed Vector Path';
  const rows = [0.3, 0.5];
  await lines(io, rows);
  // A square placed corner by corner, and closed on its first anchor, clear of the lines.
  await io.click('tool-vector');
  const corners = [await io.at(0.35, 0.2), await io.at(0.45, 0.2), await io.at(0.45, 0.6), await io.at(0.35, 0.6)];
  for (const p of [...corners, corners[0]]) {
    await io.tap(p);
    await sleep(150);
  }
  const before = await io.marks();
  const cutter = before[2];
  c.ok(`${name}: the square is a closed path on top of the lines`, before.length === 3 && cutter?.closed === true, JSON.stringify(before.map((m) => ({ tool: m.tool, closed: m.closed, anchors: m.anchors }))));
  await io.click('tool-select');
  await io.menu('select-all');
  await io.click('tool-shape-eraser');
  await io.eval(`document.querySelector('.shape-eraser-panel .top-path').click(); return true;`);
  await sleep(400);
  const after = await io.marks();
  c.ok(`${name}: the path is taken away`, after.length === 2 && !after.some((m) => m.id === cutter?.id), JSON.stringify(after.map((m) => m.id)));
  const inside = await io.tones(await Promise.all(rows.map((fy) => io.at(0.4, fy))));
  const outside = await io.tones(await Promise.all(rows.map((fy) => io.at(0.3, fy))));
  c.ok(`${name}: both lines are cut by its inside, and are ink outside it`, inside.every((t) => t > 200) && outside.every((t) => t < 100), JSON.stringify({ inside, outside }));
});

await sequence('The notices', { mode: 'new', sketchName: 'shape-eraser-notices' }, async (io) => {
  const name = 'The notices';
  const [first] = await lines(io, [0.3]);
  const blank = await io.at(0.8, 0.8);
  const dialog = () =>
    io.eval(`
      const d = document.getElementById('notice-dialog');
      return { open: !d.classList.contains('is-hidden'), title: document.getElementById('notice-title').textContent, text: document.getElementById('notice-text').textContent, focus: document.activeElement?.id ?? null };`);
  await io.click('tool-shape-eraser');
  await io.eval(`document.querySelector('.shape-tile[data-shape="rect"]').click(); return true;`);
  await sleep(200);

  // Nothing selected: the press says so.
  await io.tap(blank);
  let shown = await dialog();
  c.eq(`${name}: a press with nothing selected shows the notice`, (await io.state()).notice, 'shape-eraser-no-selection');
  c.ok(`${name}: titled, with its sentence, and OK focused`, shown.open && shown.title === 'Nothing to erase' && shown.text === 'Select the layers to erase first.' && shown.focus === 'notice-ok', JSON.stringify(shown));
  await io.chord(13, 'Enter');
  shown = await dialog();
  c.ok(`${name}: Enter closes it`, !shown.open && (await io.state()).notice === null, JSON.stringify(shown));
  c.ok(`${name}: and its hidden OK gives the focus up`, shown.focus !== 'notice-ok', JSON.stringify(shown));
  c.ok(`${name}: and does not open the Move dialog behind it`, await io.eval("return document.getElementById('move-dialog').classList.contains('is-hidden');"));

  // Shown again, ticked away, and then only a toast.
  await io.tap(blank);
  c.ok(`${name}: unticked, the next press shows it again`, (await dialog()).open);
  await io.click('notice-again');
  await io.click('notice-ok');
  c.ok(`${name}: ticked, OK closes it`, !(await dialog()).open);
  await io.eval("document.getElementById('toast').textContent = ''; return true;");
  await io.tap(blank);
  c.ok(`${name}: ticked away, the next press shows no notice`, !(await dialog()).open && (await io.state()).notice === null);
  c.eq(`${name}: but says it in a toast`, await io.eval("return document.getElementById('toast').textContent;"), 'Select the layers to erase first.');

  // One mark selected: Top Path has nothing to cut.
  await io.click('tool-select');
  await io.menu('select-all');
  await io.click('tool-shape-eraser');
  await io.eval(`document.querySelector('.shape-eraser-panel .top-path').click(); return true;`);
  await sleep(300);
  shown = await dialog();
  c.ok(`${name}: Top Path with one mark selected says so`, (await io.state()).notice === 'shape-eraser-one-path' && shown.title === 'Only one path selected', JSON.stringify(shown));
  await io.click('notice-ok');

  // An open line on top: nothing to cut with.
  await lines(io, [0.5]);
  await io.click('tool-select');
  await io.menu('select-all');
  const before = await io.shapes();
  await io.click('tool-shape-eraser');
  await io.eval(`document.querySelector('.shape-eraser-panel .top-path').click(); return true;`);
  await sleep(300);
  shown = await dialog();
  c.ok(`${name}: Top Path with an open line on top says it must be closed`, (await io.state()).notice === 'shape-eraser-open-path' && shown.text === 'The top path must be closed to erase with it.', JSON.stringify(shown));
  await io.click('notice-ok');
  const after = await io.shapes();
  c.ok(`${name}: and cuts nothing`, after.length === 2 && after.every((m, i) => m === before[i]) && (await io.marks())[0].id === first.id, `${after.length} marks`);
});

process.exit(c.summary() ? 0 : 1);
