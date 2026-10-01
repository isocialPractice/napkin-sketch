/**
 * Clipping masks: Make Clipping Mask groups the selection and shows it only
 * inside the closed path on top, which paints nothing while it clips; Release
 * takes the clip off and keeps the group.
 *
 * Four sequences, each in an app of its own:
 * - Make and Release, on a blue rectangle under a red circle outline: the
 *   Layers menu's Clipping Mask rows, greyed until there is something to do;
 *   Ctrl+7 making a Clip Group clipped by the circle, its top layer, with the
 *   group's and the clip path's marks in the layers panel; paper where only
 *   the rectangle lay, blue inside the circle and no red outline; a click
 *   outside the circle picking nothing and one inside it the rectangle; the
 *   selection boxed as it shows, by the circle; Ctrl+Alt+7 showing all of it
 *   again and keeping the group; one undo each.
 * - The round trip: the page as Export SVG writes it, imported again, is the
 *   same clip group, showing the same, and its clip mark keeps its outline.
 * - What stops it: one mark selected says to select more; an open path on
 *   top says it must be closed; Release with no clip says there is none.
 * - Another editor's clip: an SVG group with a clip-path comes in as a clip
 *   group, its <clipPath>'s circle the clip, a clip that paints nothing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const SHAPES = resolve(import.meta.dirname, '..', 'imports', 'clip-shapes.svg');
const OPEN_TOP = resolve(import.meta.dirname, '..', 'imports', 'clip-open-top.svg');
const ELSEWHERE = resolve(import.meta.dirname, '..', 'imports', 'clip-circle.svg');
const BLUE_FILL = '#27486d';
const RED_LINE = '#d0342c';
const SEVEN = 55;
const ALT = 1;
const CTRL = 2;

const red = (c) => c[0] > 150 && c[1] < 110 && c[2] < 100;
const blue = (c) => c[2] > c[0] + 20 && c[0] < 90 && c[1] < 120;
const paper = (c) => c[0] > 200 && c[1] > 200 && c[2] > 180;
const named = (c) => (red(c) ? 'red' : blue(c) ? 'blue' : paper(c) ? 'paper' : `rgb(${c.join(',')})`);

const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

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
      boxes: () => page.evalIn('return window.napkinCheck.selectionBoxes();'),
      bar: () => page.evalIn('return await window.napkin.getAppMenu();'),
      toast: () => page.evalIn("return document.getElementById('toast').textContent;"),
      /** The notice showing - its title - or null. */
      notice: () => page.evalIn("const d = document.getElementById('notice-dialog'); return d.classList.contains('is-hidden') ? null : document.getElementById('notice-title').textContent;"),
      /** The layers panel's rows marked as a clip group and as a clip path, by name, with every group opened first. */
      badges: () =>
        page.evalIn(`
          for (let k = 0; k < 12; k++) {
            const shut = document.querySelector('.layer-caret[aria-expanded="false"]');
            if (!shut) break;
            shut.click();
          }
          const names = (cls) => [...document.querySelectorAll('.layer-row.' + cls)].map((row) => row.querySelector('.layer-name')?.textContent ?? '');
          return { groups: names('is-clip-group'), paths: names('is-clip-path') };`),
      async menu(id, wait = 450) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(wait);
        return ran;
      },
      async click(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(250);
      },
      async chord(code, key, modifiers = 0) {
        await page.chord(code, key, modifiers);
        await sleep(400);
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
      /** The canvas's colour under a client point, as [r, g, b]. */
      pixel: (p) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          return Array.from(cv.getContext('2d').getImageData(Math.round((${p.x} - r.left) * k), Math.round((${p.y} - r.top) * k), 1, 1).data.slice(0, 3));`),
      /** The mark a Select click at a client point picks, or null. */
      hit: (p) => page.evalIn(`return window.napkinCheck.hitAt(${p.x}, ${p.y});`),
      async tap(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(300);
      },
      async closeNotice() {
        await page.evalIn("document.getElementById('notice-ok').click(); return true;");
        await sleep(250);
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

/**
 * The rectangle and the circle, and three client points: where only the
 * rectangle lies, the circle's middle, and a point on its outline - the seam,
 * where its path starts.
 */
async function probes(io) {
  const marks = await io.marks();
  const rect = marks.find((m) => m.fill === BLUE_FILL);
  const circle = marks.find((m) => m !== rect);
  const b = circle.bounds;
  const middle = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  return {
    rect,
    circle,
    corner: await io.toClient({ x: rect.bounds.minX + 12, y: rect.bounds.minY + 12 }),
    middle: await io.toClient(middle),
    edge: await io.toClient(circle.first),
  };
}

/** The clip group on the page: the group row whose clip is set, or null. */
const clipGroup = (rows) => rows.find((row) => row.group && row.clip) ?? null;

/** Whether every selection box lies within `b`, a mark's bounds, give or take the box's padding. */
const within = (boxes, b, slack = 12) =>
  boxes.length > 0 && boxes.every((box) => box.x >= b.minX - slack && box.y >= b.minY - slack && box.x + box.width <= b.maxX + slack && box.y + box.height <= b.maxY + slack);

const exported = mkdtempSync(join(tmpdir(), 'napkin-clip-'));
const ROUND_TRIP = join(exported, 'clip-round-trip.svg');

try {
  await sequence('Make and Release', { mode: 'new', sketchName: 'clip-make', importFiles: [SHAPES] }, async (io) => {
    const name = 'Make and Release';
    const p = await probes(io);
    const tree = (rows) => JSON.stringify(rows.map((row) => [row.name, row.group, row.parent]));
    const before = tree(await io.layers());
    c.eq(`${name}: before, the rectangle shows where the circle is not`, named(await io.pixel(p.corner)), 'blue');
    c.eq(`${name}: and the circle's outline is red`, named(await io.pixel(p.edge)), 'red');

    let layers = menuOf(await io.bar(), 'Layers');
    c.ok(`${name}: the Layers menu has Clipping Mask, with Make and Release`, rowOf(layers, 'clipping-mask')?.label === 'Clipping Mask' && rowOf(layers, 'clip-make')?.label === 'Make' && rowOf(layers, 'clip-release')?.label === 'Release', JSON.stringify(rowOf(layers, 'clipping-mask')?.submenu?.map((r) => r.label)));
    c.ok(`${name}: with nothing selected both are greyed`, rowOf(layers, 'clip-make')?.enabled === false && rowOf(layers, 'clip-release')?.enabled === false, JSON.stringify([rowOf(layers, 'clip-make')?.enabled, rowOf(layers, 'clip-release')?.enabled]));

    await io.selectAll();
    layers = menuOf(await io.bar(), 'Layers');
    c.eq(`${name}: with both selected, Make is not greyed`, rowOf(layers, 'clip-make')?.enabled, true);
    await io.chord(SEVEN, '7', CTRL);

    let rows = await io.layers();
    const group = clipGroup(rows);
    c.ok(`${name}: Ctrl+7 makes a Clip Group`, group?.name === 'Clip Group', JSON.stringify(rows));
    c.eq(`${name}: clipped by the circle`, group?.clip, p.circle.id);
    const children = rows.filter((row) => row.parent === group?.id);
    c.ok(`${name}: the rectangle's and the circle's layers in it, the circle's on top`, children.length === 2 && children[children.length - 1].id === p.circle.layerId, JSON.stringify(children.map((row) => row.name)));
    const badges = await io.badges();
    c.ok(`${name}: the layers panel marks the clip group and the clip path`, badges.groups.join() === 'Clip Group' && badges.paths.join() === p.circle.layer, JSON.stringify(badges));

    c.eq(`${name}: paper where only the rectangle lay`, named(await io.pixel(p.corner)), 'paper');
    c.eq(`${name}: blue inside the circle`, named(await io.pixel(p.middle)), 'blue');
    c.ok(`${name}: and no red outline: the clip paints nothing`, !red(await io.pixel(p.edge)), named(await io.pixel(p.edge)));

    c.eq(`${name}: a click outside the circle picks nothing`, await io.hit(p.corner), null);
    c.eq(`${name}: and one inside it the rectangle`, await io.hit(p.middle), p.rect.id);
    const boxes = await io.boxes();
    c.ok(`${name}: the selection is boxed as it shows, by the circle`, within(boxes, p.circle.bounds), JSON.stringify(boxes));
    layers = menuOf(await io.bar(), 'Layers');
    c.eq(`${name}: Release is not greyed in a clip group`, rowOf(layers, 'clip-release')?.enabled, true);

    await io.eval(`window.__svg = window.napkinCheck.pageSvg(); return true;`);
    writeFileSync(ROUND_TRIP, await io.eval('return window.__svg;'));

    await io.chord(SEVEN, '7', CTRL | ALT);
    rows = await io.layers();
    const kept = rows.find((row) => row.id === group?.id);
    c.ok(`${name}: Ctrl+Alt+7 takes the clip off and keeps the group`, kept?.group === true && kept.clip === null, JSON.stringify(kept));
    c.eq(`${name}: the rectangle shows everywhere again`, named(await io.pixel(p.corner)), 'blue');
    c.eq(`${name}: and the circle's outline with it`, named(await io.pixel(p.edge)), 'red');
    const none = await io.badges();
    c.ok(`${name}: and no clip marks in the layers panel`, none.groups.length === 0 && none.paths.length === 0, JSON.stringify(none));

    await io.menu('undo');
    c.eq(`${name}: one undo clips it again`, clipGroup(await io.layers())?.clip, p.circle.id);
    c.eq(`${name}: showing paper outside the circle`, named(await io.pixel(p.corner)), 'paper');
    await io.menu('undo');
    rows = await io.layers();
    c.eq(`${name}: and another takes the group away`, tree(rows), before);
    c.eq(`${name}: the rectangle showing all of itself`, named(await io.pixel(p.corner)), 'blue');
  });

  await sequence('The round trip', { mode: 'new', sketchName: 'clip-round-trip', importFiles: [ROUND_TRIP] }, async (io) => {
    const name = 'The round trip';
    const marks = await io.marks();
    c.eq(`${name}: the rectangle and the circle come back`, marks.length, 2);
    const p = await probes(io);
    const group = clipGroup(await io.layers());
    c.ok(`${name}: as a clip group clipped by the circle`, group?.name === 'Clip Group' && group.clip === p.circle.id, JSON.stringify(await io.layers()));
    c.eq(`${name}: the circle keeps its outline, for Release to show`, p.circle.color, RED_LINE);
    c.eq(`${name}: paper where only the rectangle lay`, named(await io.pixel(p.corner)), 'paper');
    c.eq(`${name}: blue inside the circle`, named(await io.pixel(p.middle)), 'blue');
    await io.selectAll();
    await io.chord(SEVEN, '7', CTRL | ALT);
    c.eq(`${name}: Release shows the outline again`, named(await io.pixel(p.edge)), 'red');
  });

  await sequence('What stops it', { mode: 'new', sketchName: 'clip-notices', importFiles: [OPEN_TOP] }, async (io) => {
    const name = 'What stops it';
    const marks = await io.marks();
    const rect = marks.find((m) => m.fill === BLUE_FILL);
    const tree = async () => JSON.stringify((await io.layers()).map((row) => [row.name, row.group, row.parent]));
    const before = await tree();
    await io.click('tool-select');
    await io.tap(await io.toClient({ x: rect.bounds.minX + 12, y: rect.bounds.maxY - 12 }));
    c.eq(`${name}: one mark selected`, (await io.boxes()).length, 1);
    await io.chord(SEVEN, '7', CTRL);
    c.eq(`${name}: Ctrl+7 says to select more`, await io.notice(), 'Only one path selected');
    await io.closeNotice();
    await io.selectAll();
    await io.chord(SEVEN, '7', CTRL);
    c.eq(`${name}: with an open line on top, it says the top must be closed`, await io.notice(), 'The top path is open');
    await io.closeNotice();
    c.eq(`${name}: and nothing was grouped`, await tree(), before);
    await io.eval("document.getElementById('toast').textContent = ''; return true;");
    await io.chord(SEVEN, '7', CTRL | ALT);
    c.eq(`${name}: Release with no clip says there is none`, await io.toast(), 'There is no clipping mask here to release.');
  });

  await sequence("Another editor's clip", { mode: 'new', sketchName: 'clip-elsewhere', importFiles: [ELSEWHERE] }, async (io) => {
    const name = "Another editor's clip";
    const p = await probes(io);
    const rows = await io.layers();
    const group = clipGroup(rows);
    c.ok(`${name}: the clipped SVG group comes in as a clip group`, group?.name === 'window' && group.clip === p.circle.id, JSON.stringify(rows));
    c.ok(`${name}: its circle a clip path that paints nothing`, p.circle.noStroke === true && p.circle.fill === null && p.circle.closed === true, JSON.stringify(p.circle));
    c.eq(`${name}: paper where only the rectangle lay`, named(await io.pixel(p.corner)), 'paper');
    c.eq(`${name}: blue inside the circle`, named(await io.pixel(p.middle)), 'blue');
    const badges = await io.badges();
    c.ok(`${name}: the layers panel marks the group, and the clip path, named as one`, badges.groups.join() === 'window' && badges.paths.join() === 'Clipping Path', JSON.stringify(badges));
  });
} finally {
  rmSync(exported, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
