/**
 * The Eraser cuts the drawing as geometry.
 *
 * Before 1.0.0-alpha.4.6.0 the Eraser added a mark of its own - invisible,
 * painted `destination-out` - to the active layer, and every mark sits on a
 * layer of its own, so an erase cut one mark at most, and not always the one
 * under it; with a group row picked it made an empty "Layer N" to land on;
 * and the eraser marks could be selected, drew boxes of their own and
 * stretched every selection's box over the ground they had erased.
 *
 * Five sequences, each in an app of its own: two lines selected and one
 * swath over both their right ends - no layer is added, no mark is an
 * eraser, both lines are cut where it passed, both boxes shrink, and one
 * undo puts both back; a group selected - no layer row is added; nothing
 * selected - only the line the swath touched changes; the swath held down
 * over two lines on layers of their own, both cut on the canvas before it
 * is let go; and a file with an eraser mark of the old kind, whose mark
 * draws no box when selected and which Apply Erasers turns into a cut that
 * leaves the same pixels.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-eraser-check-'));

const entry = join(dir, 'entry.ts');
writeFileSync(entry, `export { evaluate, formatDiagnostic, renderBook } from ${JSON.stringify(resolve(ROOT, 'src/core/script/index.ts'))};\n`);
const bundle = join(dir, 'entry.mjs');
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(bundle).href);

// A black rectangle with an eraser mark of the old kind through it, on its
// layer. A script's `tool eraser` cuts now, as the Eraser does, so the old
// kind of mark is put into the book by hand, as an older file holds it.
function legacyBook() {
  const result = evaluate('napkin 1\npage 1280 800\nbackground #ffffff\nlayer "Shape"\ncolor #000000 fill #000000\nstroke off\nrect 200 200 300 200\n', {
    name: 'legacy-eraser',
    timestamp: '2026-09-30T00:00:00.000Z',
  });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  const page = result.book.sketches[0];
  const layer = page.layers.find((l) => l.name === 'Shape');
  page.strokes.push({
    id: 'st_legacy',
    tool: 'eraser',
    color: '#000000',
    width: 40,
    layer: layer.id,
    sharpened: true,
    points: [
      { x: 350, y: 150, pressure: 0.5 },
      { x: 350, y: 450, pressure: 0.5 },
    ],
    vector: { anchors: [{ p: { x: 350, y: 150 } }, { p: { x: 350, y: 450 } }] },
  });
  const path = join(dir, 'legacy-eraser.skbk');
  writeFileSync(path, renderBook(result.book, { format: 'skbk' }));
  return path;
}
const LEGACY = legacyBook();

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
      /** A page point, in client pixels. */
      async toClient(p) {
        const r = await this.rect();
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: r.x + v.panX + p.x * v.zoom, y: r.y + v.panY + p.y * v.zoom };
      },
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      layers: () => page.evalIn('return window.napkinCheck.layerRows();'),
      boxes: () => page.evalIn('return window.napkinCheck.selectionBoxes();'),
      eval: (code) => page.evalIn(code),
      async tool(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(250);
      },
      async menu(id) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(400);
        return ran;
      },
      async chord(code, key) {
        await page.chord(code, key);
        await sleep(120);
      },
      async press(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      },
      /** Moves with the button held along `path` (0 to 1), in `steps`. */
      async drag(path, steps) {
        for (let i = 1; i <= steps; i++) {
          const p = path(i / steps);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(10);
        }
      },
      async release(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
      },
      /** A press, a walk along `path` (0 to 1) in `steps` moves, and the release. */
      async draw(path, steps = 24) {
        const p0 = path(0);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const p = path(i / steps);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(10);
        }
        const p1 = path(1);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p1.x, y: p1.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
      },
      /** The canvas's red channel under client points. */
      tones: (points) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          const ctx = cv.getContext('2d');
          return ${JSON.stringify(points)}.map((p) => ctx.getImageData(Math.round((p.x - r.left) * k), Math.round((p.y - r.top) * k), 1, 1).data[0]);`),
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

/** Two thick pen lines across the canvas at 30% and 50% down; their marks. */
async function twoLines(io) {
  await io.tool('tool-pen');
  // Quick Width 8.
  await io.chord(87, 'w');
  await io.chord(56, '8');
  await sleep(1300);
  await io.draw(line(await io.at(0.2, 0.3), await io.at(0.6, 0.3)));
  await io.draw(line(await io.at(0.2, 0.5), await io.at(0.6, 0.5)));
  return io.marks();
}

await sequence('One swath over two selected lines', { mode: 'new', sketchName: 'eraser-two' }, async (io) => {
  const name = 'One swath over two selected lines';
  const [a, b] = await twoLines(io);
  await io.tool('tool-select');
  await io.menu('select-all');
  const layersBefore = (await io.layers()).map((l) => l.id);
  const boxesBefore = await io.boxes();
  // A swath down over both lines' right ends.
  const endA = await io.toClient(a.last);
  const endB = await io.toClient(b.last);
  await io.tool('tool-eraser');
  await io.draw(line({ x: endA.x - 6, y: endA.y - 40 }, { x: endB.x - 6, y: endB.y + 40 }), 30);
  const marks = await io.marks();
  c.ok(`${name}: no layer is added`, JSON.stringify((await io.layers()).map((l) => l.id)) === JSON.stringify(layersBefore), `${layersBefore.length} rows before, ${(await io.layers()).length} after`);
  c.ok(`${name}: and no mark is an eraser`, marks.every((m) => m.tool !== 'eraser'), JSON.stringify(marks.map((m) => m.tool)));
  const after = marks.filter((m) => m.id === a.id || m.id === b.id);
  c.ok(
    `${name}: both lines are cut short at their right ends`,
    after.length === 2 && after.every((m, i) => m.last.x < [a, b][i].last.x - 3),
    JSON.stringify(after.map((m, i) => [[a, b][i].last.x.toFixed(1), m.last.x.toFixed(1)])),
  );
  const tones = await io.tones([
    { x: endA.x - 4, y: endA.y },
    { x: endB.x - 4, y: endB.y },
  ]);
  c.ok(`${name}: where the swath passed, the paper shows`, tones.every((t) => t > 200), JSON.stringify(tones));
  const boxesAfter = await io.boxes();
  const width = (boxes, id) => boxes.find((box) => box.id === id)?.width ?? NaN;
  c.ok(
    `${name}: both boxes shrink to the ink that is left`,
    boxesAfter.length === 2 && [a, b].every((m) => width(boxesAfter, m.id) < width(boxesBefore, m.id) - 3),
    JSON.stringify({ before: boxesBefore.map((x) => x.width.toFixed(1)), after: boxesAfter.map((x) => x.width.toFixed(1)) }),
  );
  await io.menu('undo');
  const undone = (await io.marks()).filter((m) => m.id === a.id || m.id === b.id);
  c.ok(
    `${name}: one undo puts both back`,
    undone.length === 2 && undone.every((m, i) => Math.abs(m.last.x - [a, b][i].last.x) < 1e-6),
    JSON.stringify(undone.map((m) => m.last.x.toFixed(1))),
  );
});

await sequence('Erasing with a group selected', { mode: 'new', sketchName: 'eraser-group' }, async (io) => {
  const name = 'Erasing with a group selected';
  const [a] = await twoLines(io);
  await io.tool('tool-select');
  await io.menu('select-all');
  await io.menu('group-layer');
  const rows = await io.layers();
  const group = rows.find((l) => l.group);
  c.ok(`${name}: the two lines are grouped`, !!group, JSON.stringify(rows.map((l) => l.name)));
  const end = await io.toClient(a.last);
  await io.tool('tool-eraser');
  await io.draw(line({ x: end.x - 6, y: end.y - 30 }, { x: end.x - 6, y: end.y + 30 }), 20);
  const after = await io.layers();
  c.ok(`${name}: no layer row is added`, after.length === rows.length, `${rows.length} rows before, ${after.length} after: ${after.map((l) => l.name).join(', ')}`);
  const cut = (await io.marks()).find((m) => m.id === a.id);
  c.ok(`${name}: and the line in the group is cut`, !!cut && cut.last.x < a.last.x - 3, JSON.stringify(cut?.last));
});

await sequence('Erasing with nothing selected', { mode: 'new', sketchName: 'eraser-none' }, async (io) => {
  const name = 'Erasing with nothing selected';
  await io.tool('tool-pen');
  for (const fy of [0.3, 0.45, 0.6]) await io.draw(line(await io.at(0.2, fy), await io.at(0.6, fy)));
  const before = await io.marks();
  // Drawing selects nothing: a short swath over the middle line alone.
  const selected = await io.eval('return window.napkinCheck.selectionBoxes().length;');
  c.ok(`${name}: nothing is selected`, selected === 0, `${selected} boxes`);
  const middle = await io.at(0.4, 0.45);
  await io.tool('tool-eraser');
  await io.draw(line({ x: middle.x, y: middle.y - 20 }, { x: middle.x, y: middle.y + 20 }), 12);
  const after = await io.marks();
  const changed = before.filter((m) => {
    const now = after.find((n) => n.id === m.id);
    return !now || now.points !== m.points || JSON.stringify(now.bounds) !== JSON.stringify(m.bounds);
  });
  c.ok(`${name}: the swath cuts the line it touches, and only that one`, changed.length === 1 && changed[0].id === before[1].id, JSON.stringify(changed.map((m) => m.id)));
  c.ok(`${name}: and adds no mark`, after.length === before.length && after.every((m) => m.tool !== 'eraser'), `${after.length} marks`);
});

await sequence('The swath cuts as it goes', { mode: 'new', sketchName: 'eraser-live' }, async (io) => {
  const name = 'The swath cuts as it goes';
  const [a, b] = await twoLines(io);
  const endA = await io.toClient(a.last);
  const endB = await io.toClient(b.last);
  await io.tool('tool-eraser');
  // Down over both lines' right ends, and held there: each line on a layer
  // of its own, with nothing selected.
  const from = { x: endA.x - 6, y: endA.y - 40 };
  const to = { x: endB.x - 6, y: endB.y + 40 };
  await io.press(from);
  await io.drag(line(from, to), 30);
  await sleep(200);
  const during = await io.tones([
    { x: endA.x - 4, y: endA.y },
    { x: endB.x - 4, y: endB.y },
  ]);
  const beside = await io.tones([
    { x: endA.x - 60, y: endA.y },
    { x: endB.x - 60, y: endB.y },
  ]);
  c.ok(`${name}: with the press still down, both lines show the paper where it has passed`, during.every((t) => t > 200), JSON.stringify(during));
  c.ok(`${name}: and are ink beside it`, beside.every((t) => t < 100), JSON.stringify(beside));
  await io.release(to);
  const after = await io.tones([
    { x: endA.x - 4, y: endA.y },
    { x: endB.x - 4, y: endB.y },
  ]);
  c.ok(`${name}: as they do once it is let go`, after.every((t) => t > 200), JSON.stringify(after));
});

await sequence('An older file\'s eraser marks', { mode: 'book', filePath: LEGACY }, async (io) => {
  const name = "An older file's eraser marks";
  await io.menu('fit-view');
  await io.tool('tool-select');
  await io.menu('select-all');
  const boxes = await io.boxes();
  const marks = await io.marks();
  const shape = marks.find((m) => m.tool !== 'eraser');
  c.ok(`${name}: selected, the shape draws one box, and the eraser mark none`, boxes.length === 1 && boxes[0].id === shape?.id, JSON.stringify(boxes.map((b) => b.id)));
  // The mark's painted cut is no ink: a click there picks nothing, a click on the ink picks the shape.
  const click = async (p) => {
    const q = await io.toClient(p);
    await io.press(q);
    await io.release(q);
  };
  await click({ x: 350, y: 300 });
  c.ok(`${name}: a click in the eraser mark's cut picks nothing`, (await io.boxes()).length === 0, JSON.stringify((await io.boxes()).map((b) => b.id)));
  await click({ x: 250, y: 300 });
  c.ok(`${name}: a click on the ink it left picks the shape`, (await io.boxes()).map((b) => b.id).join() === shape?.id, JSON.stringify((await io.boxes()).map((b) => b.id)));
  await click({ x: 1000, y: 700 });
  // A row across the rectangle and the cut through it, before and after.
  const row = [];
  for (let x = 190; x <= 510; x += 4) row.push(await io.toClient({ x, y: 300 }));
  const before = await io.tones(row);
  const ran = await io.menu('apply-erasers');
  const after = await io.tones(row);
  const left = await io.marks();
  c.ok(`${name}: Apply Erasers runs`, ran === true, String(ran));
  c.ok(`${name}: and leaves no eraser mark`, left.length === 1 && left[0].tool !== 'eraser', JSON.stringify(left.map((m) => m.tool)));
  c.ok(`${name}: the shape is cut in two, as the eraser showed it`, left.length === 1 && left[0].anchors === 8, JSON.stringify(left[0] && { anchors: left[0].anchors, closed: left[0].closed }));
  const differ = before.filter((t, i) => Math.abs(t - after[i]) > 24).length;
  c.ok(`${name}: with the same pixels`, differ === 0 && before.some((t) => t < 50) && before.some((t) => t > 200), `${differ} of ${before.length} samples differ`);
});

process.exit(c.summary() ? 0 : 1);
