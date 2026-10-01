/**
 * Liquify: a vector editor's Warp tools - Warp, Twirl, Pucker and Bloat -
 * bending the marks under a brush.
 *
 * Four sequences, each in an app of its own:
 * - The tool: the Transform menu's row after Mesh Warp, on Shift+R; the
 *   button after Mesh Warp's, the canvas keeping its height; the panel of
 *   four tiles, Warp chosen, and a tile choosing; the brush drawn round the
 *   pointer, on the canvas's own pixels, and following it; `[` and `]`
 *   sizing it, and an Alt-drag.
 * - Bloat held over a circle's edge grows its box on that side only, and one
 *   undo puts it back; Escape mid-press undoes the press, with no step left.
 * - Twirl held over a short line turns its ends, keeping their distance
 *   from the brush's centre.
 * - Warp dragged into a rectangle's side dents it, and a line far off is
 *   left alone; with the rectangle selected, a line under the brush is left
 *   alone too; a pencil mark under it is left to the Smear, which a toast
 *   says; one undo per drag.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
const labelsOf = (items) => items.map((item) => (item.type === 'separator' ? '---' : item.label));
const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;

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
      geometry: (id) => page.evalIn(`return window.napkinCheck.strokeGeometry(${JSON.stringify(id)});`),
      state: () => page.evalIn('return window.napkinCheck.liquifyState ? window.napkinCheck.liquifyState() : undefined;'),
      tool: () => page.evalIn("return document.getElementById('canvas').dataset.tool;"),
      toast: () => page.evalIn("return document.getElementById('toast').textContent;"),
      bar: () => page.evalIn('return await window.napkin.getAppMenu();'),
      rect: () => page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`),
      view: () => page.evalIn('return window.napkinCheck.viewState();'),
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
        const v = await this.view();
        return { x: r.x + v.panX + p.x * v.zoom, y: r.y + v.panY + p.y * v.zoom };
      },
      async hover(p, modifiers = 0) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers });
        await sleep(250);
      },
      async settle() {
        // A fresh app now and then keeps the first press on record past its
        // release (the harness's short-first-stroke quirk): wait it out.
        for (let k = 0; k < 20 && (await page.evalIn('return window.napkinCheck.inputState().pressKind;')) !== null; k++) await sleep(100);
      },
      /** A press, a straight walk to `b` in `steps` moves, and the release. */
      async drag(a, b, steps = 16, modifiers = 0) {
        await this.hover(a, modifiers);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, button: 'left', buttons: 1, clickCount: 1, modifiers });
          await sleep(12);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
        await sleep(400);
        await this.settle();
      },
      async tap(p, modifiers = 0) {
        await this.hover(p, modifiers);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
        await sleep(400);
        await this.settle();
      },
      selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
      /** A press held still for `ms`, then let go - unless `during` says otherwise. */
      async hold(p, ms, during = null) {
        await this.hover(p);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
        await sleep(ms);
        if (during) await during();
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
        await this.settle();
      },
      /** The canvas's own pixels round a client point: the darkest and the bluest in a small square. */
      async pixelsAround(p, half = 2) {
        return page.evalIn(`
          const canvas = document.getElementById('canvas');
          const r = canvas.getBoundingClientRect();
          const k = canvas.width / r.width;
          const x = Math.round((${p.x} - r.left) * k) - ${half};
          const y = Math.round((${p.y} - r.top) * k) - ${half};
          const d = canvas.getContext('2d').getImageData(x, y, ${2 * half + 1}, ${2 * half + 1}).data;
          let darkest = 255;
          let bluest = -255;
          for (let i = 0; i < d.length; i += 4) {
            darkest = Math.min(darkest, d[i]);
            bluest = Math.max(bluest, d[i + 2] - d[i]);
          }
          return { darkest, bluest };`);
      },
      /** The marks drawn with a tool, by a drag from one page point to another. */
      async draw(tool, a, b) {
        await this.click(tool);
        await this.drag(await this.toClient(a), await this.toClient(b));
        const marks = await this.marks();
        return marks[marks.length - 1];
      },
      /** Chooses a Liquify brush from its panel, and closes the panel. */
      async brush(mode) {
        await this.click('tool-liquify');
        await page.evalIn(`document.querySelector('.liquify-panel .shape-tile[data-liquify="${mode}"]').click(); return true;`);
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

await sequence('The tool', { mode: 'new', sketchName: 'liquify-tool' }, async (io) => {
  const name = 'The tool';
  const transform = labelsOf(menuOf(await io.bar(), 'Transform'));
  c.ok(`${name}: the Transform menu has Liquify after Mesh Warp`, transform.indexOf('Liquify') === transform.indexOf('Mesh Warp') + 1, transform.join(' | '));
  c.ok(`${name}: its button comes after Mesh Warp's`, await io.eval("return document.getElementById('tool-warp').nextElementSibling?.id === 'tool-liquify';"));
  c.ok(`${name}: and the canvas keeps its height`, near((await io.rect()).h, 617.67, 1), String((await io.rect()).h));
  c.ok(`${name}: its tooltip shows Shift+R`, (await io.eval("return document.getElementById('tool-liquify').title;")).includes('Shift+R'), await io.eval("return document.getElementById('tool-liquify').title;"));

  await io.chord(82, 'R', 8);
  let state = await io.state();
  c.eq(`${name}: Shift+R takes Liquify`, await io.tool(), 'liquify');
  c.ok(`${name}: and opens its panel of four, Warp chosen`, state?.panelOpen && state.tiles.join(',') === 'warp,twirl,pucker,bloat' && state.active === 'warp', JSON.stringify(state));
  await io.eval(`document.querySelector('.liquify-panel .shape-tile[data-liquify="twirl"]').click(); return true;`);
  await sleep(300);
  state = await io.state();
  c.ok(`${name}: a tile chooses its brush and closes the panel`, state.mode === 'twirl' && !state.panelOpen, JSON.stringify(state));
  c.eq(`${name}: and says what it does`, await io.toast(), 'Liquify: Twirl turns what is under the brush about its centre.');

  // The brush, round the pointer, on the canvas's own pixels.
  const v = await io.view();
  const centre = await io.toClient({ x: 640, y: 400 });
  await io.hover(centre);
  await sleep(200);
  state = await io.state();
  c.ok(`${name}: the brush is drawn round the pointer, 50 across the page`, state.brush && near(state.brush.x, 640, 1) && near(state.brush.y, 400, 1) && state.brush.radius === 50, JSON.stringify(state.brush));
  const rim = await io.pixelsAround({ x: centre.x + 50 * v.zoom, y: centre.y });
  const inside = await io.pixelsAround({ x: centre.x + 25 * v.zoom, y: centre.y });
  c.ok(`${name}: its ring is on the canvas, in blue`, rim.darkest < 150 && rim.bluest > 40, JSON.stringify(rim));
  c.ok(`${name}: and the page inside it is untouched`, inside.darkest > 240, JSON.stringify(inside));
  await io.hover(await io.toClient({ x: 500, y: 300 }));
  state = await io.state();
  c.ok(`${name}: the brush follows the pointer`, near(state.brush.x, 500, 1) && near(state.brush.y, 300, 1), JSON.stringify(state.brush));

  // [ and ] size it; so does an Alt-drag, from where it goes down.
  await io.chord(221, ']');
  c.eq(`${name}: ] grows the brush`, (await io.state()).radius, 62.5);
  c.eq(`${name}: and says how big`, await io.toast(), 'Liquify: a brush 125px across.');
  await io.chord(219, '[');
  c.eq(`${name}: [ shrinks it back`, (await io.state()).radius, 50);
  const from = await io.toClient({ x: 600, y: 400 });
  await io.drag(from, { x: from.x + 80 * v.zoom, y: from.y }, 10, 1);
  state = await io.state();
  c.ok(`${name}: an Alt-drag sizes the brush to where its rim is let go`, near(state.radius, 80, 1), JSON.stringify(state));
  c.ok(`${name}: and bends nothing`, (await io.marks()).length === 0);
  c.eq(`${name}: the Alt-drag leaves the menu bar alone`, await io.tool(), 'liquify');
});

await sequence('Bloat', { mode: 'new', sketchName: 'liquify-bloat' }, async (io) => {
  const name = 'Bloat';
  const circle = await io.draw('tool-ellipse', { x: 300, y: 200 }, { x: 420, y: 320 });
  const before = circle.bounds;
  await io.brush('bloat');
  // Inside the circle by 25 at its right: its right edge is in the brush, its left far outside it.
  await io.hold(await io.toClient({ x: 395, y: 260 }), 700);
  let after = (await io.marks())[0];
  c.ok(`${name}: held over a circle's edge, it grows the circle's box on that side`, after.bounds.maxX > before.maxX + 2, `${before.maxX} to ${after.bounds.maxX}`);
  c.ok(`${name}: and not on the far side`, near(after.bounds.minX, before.minX, 0.75), `${before.minX} to ${after.bounds.minX}`);
  c.ok(`${name}: the circle is a path now, with few anchors`, after.anchors !== null && after.anchors <= 24 && after.closed === true, JSON.stringify(after));
  await io.chord(90, 'z', 2);
  after = (await io.marks())[0];
  c.ok(`${name}: one undo puts it back`, near(after.bounds.maxX, before.maxX, 0.01) && after.anchors === null, JSON.stringify(after.bounds));
  c.eq(`${name}: and leaves the circle there`, (await io.marks()).length, 1);

  // Escape mid-press: what the press bent goes back, and no step is left for an undo.
  await io.hold(await io.toClient({ x: 395, y: 260 }), 500, async () => {
    const mid = (await io.marks())[0];
    c.ok(`${name}: mid-press the circle is bending`, mid.bounds.maxX > before.maxX + 1, String(mid.bounds.maxX));
    await io.chord(27, 'Escape');
  });
  after = (await io.marks())[0];
  c.ok(`${name}: Escape mid-press undoes the press`, near(after.bounds.maxX, before.maxX, 0.01), String(after.bounds.maxX));
  c.eq(`${name}: and lets go of the pointer`, await io.eval('return window.napkinCheck.inputState().pressKind;'), null);
  await io.chord(90, 'z', 2);
  c.eq(`${name}: the undo after it takes the circle, not a bend`, (await io.marks()).length, 0);
});

await sequence('Twirl', { mode: 'new', sketchName: 'liquify-twirl' }, async (io) => {
  const name = 'Twirl';
  const line = await io.draw('tool-pen', { x: 560, y: 400 }, { x: 640, y: 400 });
  const centre = { x: (line.first.x + line.last.x) / 2, y: (line.first.y + line.last.y) / 2 };
  await io.brush('twirl');
  await io.hold(await io.toClient(centre), 700);
  const after = (await io.marks())[0];
  const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const away = (p) => Math.hypot(p.x - centre.x, p.y - centre.y);
  c.ok(`${name}: held over a short line, it turns the line's ends`, moved(after.first, line.first) > 2 && moved(after.last, line.last) > 2, JSON.stringify({ was: [line.first, line.last], now: [after.first, after.last] }));
  c.ok(`${name}: keeping their distance from its centre`, near(away(after.first), away(line.first), 1) && near(away(after.last), away(line.last), 1), `${away(line.first)} to ${away(after.first)}`);
  // Clockwise on the screen: the right end goes down, the left end up.
  c.ok(`${name}: clockwise on the screen`, after.last.y > line.last.y && after.first.y < line.first.y, JSON.stringify({ first: after.first, last: after.last }));
});

await sequence('Warp', { mode: 'new', sketchName: 'liquify-warp' }, async (io) => {
  const name = 'Warp';
  const rect = await io.draw('tool-rect', { x: 300, y: 200 }, { x: 500, y: 340 });
  const far = await io.draw('tool-pen', { x: 700, y: 500 }, { x: 800, y: 500 });
  const farGeometry = await io.geometry(far.id);
  await io.brush('warp');
  // From just above the top side's middle, down into the rectangle.
  await io.drag(await io.toClient({ x: 400, y: 190 }), await io.toClient({ x: 400, y: 240 }), 20);
  let geometry = await io.geometry(rect.id);
  const top = geometry.points.filter((p) => p.x > 380 && p.x < 420);
  c.ok(`${name}: dragged into a rectangle's side, it dents it`, top.some((p) => p.y > 215), JSON.stringify(top.map((p) => Math.round(p.y))));
  const corners = (await io.marks()).find((m) => m.id === rect.id).bounds;
  c.ok(`${name}: and its corners stay put`, near(corners.minX, rect.bounds.minX, 0.75) && near(corners.maxX, rect.bounds.maxX, 0.75) && near(corners.maxY, rect.bounds.maxY, 0.75), JSON.stringify(corners));
  c.eq(`${name}: with nothing selected, a line far off is left alone`, JSON.stringify(await io.geometry(far.id)), JSON.stringify(farGeometry));
  await io.chord(90, 'z', 2);
  geometry = await io.geometry(rect.id);
  c.ok(`${name}: one undo per drag: the side is straight again`, geometry.points.filter((p) => p.x > 380 && p.x < 420).every((p) => near(p.y, 200, 0.01) || near(p.y, 340, 0.01)), JSON.stringify(geometry.points));
  c.eq(`${name}: and the line is still there`, (await io.marks()).length, 2);

  // With the rectangle selected, a line under the brush is left alone.
  const under = await io.draw('tool-pen', { x: 360, y: 180 }, { x: 440, y: 180 });
  const underGeometry = await io.geometry(under.id);
  await io.click('tool-select');
  await io.tap(await io.toClient({ x: 300, y: 270 }));
  const selected = await io.selected();
  c.ok(`${name}: the rectangle alone is selected`, selected.length === 1 && selected[0] === rect.id, JSON.stringify(selected));
  await io.brush('warp');
  await io.drag(await io.toClient({ x: 400, y: 170 }), await io.toClient({ x: 400, y: 230 }), 20);
  geometry = await io.geometry(rect.id);
  c.ok(`${name}: with the rectangle selected, it is bent`, geometry.points.some((p) => p.x > 380 && p.x < 420 && p.y > 215), JSON.stringify(selected));
  c.eq(`${name}: and the line over it, not selected, is left alone`, JSON.stringify(await io.geometry(under.id)), JSON.stringify(underGeometry));
  await io.chord(90, 'z', 2);

  // A pencil mark under the brush is the Smear's: left alone, and said once.
  await io.click('tool-select');
  await io.tap(await io.toClient({ x: 1000, y: 120 }));
  c.eq(`${name}: a click on the empty page selects nothing`, (await io.selected()).length, 0);
  const pencil = await io.draw('tool-pencil', { x: 600, y: 250 }, { x: 680, y: 250 });
  await io.eval("document.getElementById('tool-flyout')?.remove(); return true;");
  const pencilGeometry = await io.geometry(pencil.id);
  await io.brush('warp');
  await io.drag(await io.toClient({ x: 640, y: 230 }), await io.toClient({ x: 640, y: 280 }), 16);
  c.eq(`${name}: a pencil mark under it is left alone`, JSON.stringify(await io.geometry(pencil.id)), JSON.stringify(pencilGeometry));
  c.eq(`${name}: and a toast says the Smear blends those`, await io.toast(), "Liquify bends every mark but a pencil's: the Smear blends those.");
});

process.exit(c.summary() ? 0 : 1);
