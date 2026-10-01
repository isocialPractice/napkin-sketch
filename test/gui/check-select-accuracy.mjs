/**
 * Select and Direct Select pick what is under the pointer.
 *
 * Before 1.0.0-alpha.4.6.0 a click picked the first mark in the page's list
 * within 8 page units of its centreline - a reach no setting changed and the
 * zoom did not scale, over an order that is not the paint order - and ink an
 * eraser had cut away still picked its mark, when the eraser itself was not
 * picked instead. A rubber band needed one of a mark's points inside it, so a
 * band across a rectangle's edge took nothing. Direct Select held its grab to
 * at least 8 pixels on a path with Bezier anchors, pushed an undo step on
 * every click, tore a rectangle open at the corner where its first and last
 * points meet, and let Shift constrain only a vector path's drags.
 *
 * Each sequence draws with real pointer events, in an app of its own, and
 * reads back what was picked: the selection through
 * `window.napkinCheck.selectionBoxes()`, and the marks through
 * `strokeSummary()`. Settings change through `window.napkin.updateSettings`,
 * as the settings window changes them; each app has a user-data folder of its
 * own, so nothing is left behind.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

const KEYS = {
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16, bit: 8 },
  Control: { key: 'Control', code: 'ControlLeft', vk: 17, bit: 2 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, bit: 0 },
  z: { key: 'z', code: 'KeyZ', vk: 90, bit: 0 },
};

const bits = (held) => held.reduce((sum, name) => sum | KEYS[name].bit, 0);

async function sequence(name, run) {
  const app = launch({ mode: 'new', sketchName: `select-accuracy-${name.replace(/\W+/g, '-')}` });
  try {
    const page = await connect();
    await page.send('Runtime.enable');
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await sleep(3000);
    await page.evalIn(`
      window.__errors = [];
      window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
      window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
      document.activeElement?.blur();
      return true;`);
    // Where the canvas is. A tool's options can push it down the window - the
    // Vector Path tool's corner radius does - so it is measured again with
    // each tool, and points on a mark are worked out from the mark.
    const measure = () =>
      page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);
    let rect = await measure();
    const held = [];
    const io = {
      /** A point on the canvas, as fractions of its width and height. */
      at: (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }),
      /** `p` moved by `dx`, `dy` screen pixels. */
      off: (p, dx, dy) => ({ x: p.x + dx, y: p.y + dy }),
      async down(key) {
        if (!held.includes(key)) held.push(key);
        const k = KEYS[key];
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: bits(held) });
      },
      async up(key) {
        const i = held.indexOf(key);
        if (i >= 0) held.splice(i, 1);
        const k = KEYS[key];
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: bits(held) });
      },
      async tap(key) {
        await this.down(key);
        await this.up(key);
        await sleep(200);
      },
      async hover(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers: bits(held) });
      },
      async press(p) {
        await this.hover(p);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: bits(held) });
      },
      async drag(from, to, steps = 10) {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, button: 'left', buttons: 1, clickCount: 1, modifiers: bits(held),
          });
          await sleep(8);
        }
      },
      async release(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: bits(held) });
        await sleep(250);
      },
      async click(p) {
        await this.press(p);
        await this.release(p);
      },
      /** A press at `from`, a drag to `to`, and the release there. */
      async stroke(from, to, steps = 12) {
        await this.press(from);
        await this.drag(from, to, steps);
        await this.release(to);
      },
      async tool(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(150);
        rect = await measure();
      },
      async settings(patch) {
        await page.evalIn(`return window.napkin.updateSettings(${JSON.stringify(patch)}).then(() => true);`);
        await sleep(400);
      },
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      eval: (code) => page.evalIn(code),
      async chord(code, key) {
        await page.chord(code, key);
        await sleep(120);
      },
      layers: () => page.evalIn('return window.napkinCheck.layerRows();'),
      view: () => page.evalIn('return window.napkinCheck.viewState();'),
      selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((box) => box.id);'),
      /** Where a page point is on the screen now. */
      async screen(pt) {
        rect = await measure();
        const v = await this.view();
        return { x: rect.x + v.panX + pt.x * v.zoom, y: rect.y + v.panY + pt.y * v.zoom };
      },
      /** Draws a mark with `tool` from `from` to `to`, and returns it. */
      async draw(tool, from, to) {
        await this.tool(tool);
        const before = (await this.marks()).length;
        await this.stroke(from, to);
        const marks = await this.marks();
        return marks.length === before + 1 ? marks[marks.length - 1] : null;
      },
      /** A Vector Path through two corner anchors, `a` then `b`, put down with Enter. */
      async vectorPath(a, b) {
        await this.tool('tool-vector');
        const before = (await this.marks()).length;
        await this.click(a);
        await this.click(b);
        await this.tap('Enter');
        const marks = await this.marks();
        return marks.length === before + 1 ? marks[marks.length - 1] : null;
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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Select ------------------------------------------------------------------------

/** The middle of a mark's box, in page units. */
const middleOf = (mark) => ({ x: (mark.bounds.minX + mark.bounds.maxX) / 2, y: (mark.bounds.minY + mark.bounds.maxY) / 2 });

await sequence('Select sensitivity', async (io) => {
  const name = 'Select sensitivity';
  const line = await io.draw('tool-marker', io.at(0.3, 0.5), io.at(0.6, 0.5));
  c.ok(`${name}: a marker line is drawn`, line !== null);
  if (!line) return;
  await io.tool('tool-select');
  const { zoom } = await io.view();
  const on = await io.screen(middleOf(line));
  // Five screen pixels past the edge of the ink, whatever the marker's width.
  const beside = io.off(on, 0, (Math.max(0.5, line.width) / 2) * zoom + 5);
  const empty = io.at(0.5, 0.85);

  await io.settings({ selectSensitivityPx: 2 });
  await io.click(beside);
  const at2 = await io.selected();
  await io.click(empty);
  await io.settings({ selectSensitivityPx: 12 });
  await io.click(beside);
  const at12 = await io.selected();
  c.ok(`${name}: 5 px off the ink, the sensitivity at 2 picks nothing`, at2.length === 0, JSON.stringify(at2));
  c.ok(`${name}: and at 12 the same click picks the line`, same(at12, [line.id]), JSON.stringify(at12));
  c.ok(`${name}: so the setting decides`, !same(at2, at12));

  await io.click(empty);
  await io.settings({ selectSensitivityPx: 1 });
  await io.click(on);
  c.ok(`${name}: a click on the ink picks the line at any sensitivity`, same(await io.selected(), [line.id]));
});

await sequence('Paint order', async (io) => {
  const name = 'Paint order';
  const low = await io.draw('tool-marker', io.at(0.2, 0.4), io.at(0.5, 0.4));
  const high = await io.draw('tool-marker', io.at(0.35, 0.4), io.at(0.65, 0.4));
  c.ok(`${name}: two overlapping lines are drawn`, low !== null && high !== null);
  if (!low || !high) return;
  c.ok(`${name}: each on a layer of its own`, low.layerId !== high.layerId, `${low.layerId} and ${high.layerId}`);
  // The later line's layer goes below the first's; the page's list keeps its order.
  await io.tool('layer-down');
  const rows = await io.layers();
  const lowAt = rows.findIndex((row) => row.id === low.layerId);
  const highAt = rows.findIndex((row) => row.id === high.layerId);
  c.ok(`${name}: the later line's layer is moved below the first's`, highAt >= 0 && lowAt >= 0 && highAt < lowAt, `rows ${rows.map((r) => r.name).join(', ')}`);
  const order = (await io.marks()).map((m) => m.id);
  c.ok(`${name}: the page's list is as it was`, same(order, [low.id, high.id]));
  await io.tool('tool-select');
  // Where both lie: past the start of the later line, short of the end of the first.
  await io.click(await io.screen({ x: (high.bounds.minX + low.bounds.maxX) / 2, y: low.bounds.minY }));
  c.ok(`${name}: a click where both lie picks the one painted on top`, same(await io.selected(), [low.id]), JSON.stringify(await io.selected()));
});

await sequence('Erased ink', async (io) => {
  const name = 'Erased ink';
  const line = await io.draw('tool-marker', io.at(0.2, 0.6), io.at(0.6, 0.6));
  c.ok(`${name}: a marker line is drawn`, line !== null);
  if (!line) return;
  // Since 1.0.0-alpha.4.6.0 the Eraser cuts the line itself and adds no
  // mark; an older file's eraser marks, which still cut by painting, are
  // clicked through in check-eraser.mjs. A swath of 20 (Quick Width), so the
  // middle of the cut is further from the ink either side than the Select
  // sensitivity reaches.
  await io.chord(87, 'w');
  await io.chord(50, '2');
  await io.chord(48, '0');
  await sleep(1300);
  await io.draw('tool-eraser', io.at(0.4, 0.45), io.at(0.4, 0.75));
  const marks = await io.marks();
  c.ok(`${name}: the eraser cuts the line in two, and adds no mark of its own`, marks.length === 1 && marks[0].id === line.id && marks[0].tool !== 'eraser', JSON.stringify(marks.map((m) => m.tool)));
  const geometry = await io.eval(`return window.napkinCheck.strokeGeometry(${JSON.stringify(line.id)});`);
  const k = geometry.points.findIndex((p) => p.move);
  c.ok(`${name}: as two runs of the same line`, k > 0, `${geometry.points.length} points`);
  if (k <= 0) return;
  const gap = { x: (geometry.points[k - 1].x + geometry.points[k].x) / 2, y: (geometry.points[k - 1].y + geometry.points[k].y) / 2 };
  await io.tool('tool-select');
  await io.click(await io.screen(gap));
  c.ok(`${name}: a click in the cut picks nothing`, (await io.selected()).length === 0, JSON.stringify(await io.selected()));
  await io.click(await io.screen({ x: line.bounds.minX + 20, y: gap.y }));
  c.ok(`${name}: a click on the ink it left picks the line`, same(await io.selected(), [line.id]), JSON.stringify(await io.selected()));
});

await sequence('A rubber band across an edge', async (io) => {
  const name = 'A rubber band across an edge';
  const box = await io.draw('tool-rect', io.at(0.3, 0.3), io.at(0.6, 0.7));
  c.ok(`${name}: a rectangle is drawn`, box !== null);
  if (!box) return;
  await io.tool('tool-select');
  const top = await io.screen({ x: middleOf(box).x, y: box.bounds.minY });
  // A band across the middle of the top edge, none of the corners in it.
  await io.stroke(io.off(top, -30, -20), io.off(top, 30, 20));
  c.ok(`${name}: the band takes the rectangle whose edge it crosses`, same(await io.selected(), [box.id]), JSON.stringify(await io.selected()));
});

// ---- Direct Select -----------------------------------------------------------------

await sequence('Direct Select sensitivity', async (io) => {
  const name = 'Direct Select sensitivity';
  const path = await io.vectorPath(io.at(0.3, 0.5), io.at(0.6, 0.5));
  c.ok(`${name}: a Vector Path is put down`, path !== null && path.anchors === 2, JSON.stringify(path));
  if (!path) return;
  await io.tool('tool-point');
  const middle = await io.screen(middleOf(path));
  // Five screen pixels off the far anchor, across the path.
  const near = io.off(await io.screen(path.last), 0, 5);

  await io.settings({ directSelectSensitivityPx: 2 });
  await io.click(middle);
  c.ok(`${name}: a click on the path picks it`, same(await io.selected(), [path.id]), JSON.stringify(await io.selected()));
  await io.stroke(near, io.off(near, 0, 40));
  const after2 = (await io.marks())[0];
  c.ok(`${name}: at 2, a drag from 5 px off an anchor leaves the path as it was`, same(after2.bounds, path.bounds), JSON.stringify(after2.bounds));

  await io.settings({ directSelectSensitivityPx: 12 });
  await io.click(middle);
  await io.stroke(near, io.off(near, 0, 40));
  const after12 = (await io.marks())[0];
  c.ok(`${name}: at 12, the same drag carries the anchor`, after12.bounds.maxY > path.bounds.maxY + 20, JSON.stringify(after12.bounds));
});

await sequence('A Direct Select click is not an edit', async (io) => {
  const name = 'A Direct Select click is not an edit';
  const path = await io.vectorPath(io.at(0.3, 0.5), io.at(0.6, 0.5));
  c.ok(`${name}: a Vector Path is put down`, path !== null);
  if (!path) return;
  await io.tool('tool-point');
  await io.click(await io.screen(middleOf(path)));
  c.ok(`${name}: a click on the path picks it`, same(await io.selected(), [path.id]), JSON.stringify(await io.selected()));
  const anchor = await io.screen(path.last);
  await io.click(anchor);
  // A one-pixel wobble on the way down is still a click.
  await io.press(anchor);
  await io.drag(anchor, io.off(anchor, 2, 1), 2);
  await io.release(io.off(anchor, 2, 1));
  c.ok(`${name}: the path is where it was`, same((await io.marks())[0]?.bounds, path.bounds), JSON.stringify((await io.marks())[0]?.bounds));
  await io.down('Control');
  await io.tap('z');
  await io.up('Control');
  await sleep(300);
  c.eq(`${name}: one Undo after the clicks takes back the path itself`, (await io.marks()).length, 0);
});

await sequence('A rectangle\'s seam', async (io) => {
  const name = 'A rectangle\'s seam';
  const box = await io.draw('tool-rect', io.at(0.3, 0.3), io.at(0.6, 0.7));
  c.ok(`${name}: a rectangle is drawn`, box !== null);
  if (!box) return;
  await io.tool('tool-point');
  await io.click(await io.screen({ x: middleOf(box).x, y: box.bounds.minY }));
  c.ok(`${name}: a click on an edge picks the rectangle`, same(await io.selected(), [box.id]), JSON.stringify(await io.selected()));
  // The corner the drag began at is the first point and the last.
  const seam = await io.screen({ x: box.bounds.minX, y: box.bounds.minY });
  await io.stroke(seam, io.off(seam, -30, -30));
  const moved = (await io.marks())[0];
  const shut = !!moved.first && !!moved.last && Math.hypot(moved.first.x - moved.last.x, moved.first.y - moved.last.y) < 1e-6;
  c.ok(`${name}: a drag on the seam keeps the rectangle shut`, shut, JSON.stringify({ first: moved.first, last: moved.last }));
  c.ok(`${name}: and moves the corner`, moved.bounds.minX < box.bounds.minX - 10, JSON.stringify(moved.bounds));
});

await sequence('Shift constrains a raw drag', async (io) => {
  const name = 'Shift constrains a raw drag';
  const box = await io.draw('tool-rect', io.at(0.3, 0.3), io.at(0.6, 0.7));
  c.ok(`${name}: a rectangle is drawn`, box !== null);
  if (!box) return;
  await io.tool('tool-point');
  await io.click(await io.screen({ x: middleOf(box).x, y: box.bounds.minY }));
  const { zoom } = await io.view();
  const corner = await io.screen({ x: box.bounds.maxX, y: box.bounds.maxY });
  await io.press(corner);
  await io.down('Shift');
  await io.drag(corner, io.off(corner, 40, 10));
  await io.release(io.off(corner, 40, 10));
  await io.up('Shift');
  const moved = (await io.marks())[0];
  c.ok(`${name}: the corner goes along`, moved.bounds.maxX > box.bounds.maxX + 30 / zoom, JSON.stringify(moved.bounds));
  c.ok(`${name}: and not down: Shift holds it to the axis`, Math.abs(moved.bounds.maxY - box.bounds.maxY) < 0.5, JSON.stringify(moved.bounds));
});

process.exit(c.summary() ? 0 : 1);
