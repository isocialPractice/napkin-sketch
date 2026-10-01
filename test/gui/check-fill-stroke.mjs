/**
 * Fill and stroke: `X` puts the fill or the stroke in front, as the control in
 * Illustrator's toolbar does, and the Quick Access Colors paint the one in
 * front; `Shift+X` swaps the two.
 *
 * Two sequences, each in an app of its own. The control and the keys: the
 * control in the Ink color group shows the ink in front and no fill; the
 * Sketch menu's Fill in Front row is unticked on `X` and Swap Fill and Stroke
 * on `Shift+X`; `X` puts the fill in front and ticks the row; `C` steps the
 * fill through the Quick Access Colors, with None among its stops, and lights
 * its swatch; a Rectangle drawn then is filled; `Shift+X` swaps the tool's two
 * colors; a click on the box behind brings it forward; and the toolbar keeps
 * its height. A selection: with the stroke in front a swatch recolors the
 * selected rectangle's outline and the selected line, with the fill in front
 * it fills the rectangle and leaves the open line alone, `Shift+X` swaps the
 * rectangle's fill and outline, and one undo takes the swap back.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

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

async function sequence(name, run) {
  const app = launch({ mode: 'new', sketchName: `fill-stroke-${name.length}` });
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
      eval: (code) => page.evalIn(code),
      /** The control as the page shows it. */
      control: () =>
        page.evalIn(`
          const box = document.getElementById('fill-stroke');
          return {
            front: box.dataset.front,
            fill: box.dataset.fill,
            stroke: box.dataset.stroke,
            fillNone: document.getElementById('fill-stroke-fill').classList.contains('is-none'),
            active: Array.from(document.querySelectorAll('.swatch.is-active')).map((s) => s.dataset.color),
          };`),
      swatches: () => page.evalIn("return Array.from(document.querySelectorAll('.swatch')).map((s) => s.dataset.color);"),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      menu: () => page.evalIn('return await window.napkin.getAppMenu();'),
      toast: () => page.evalIn("return document.getElementById('toast').textContent;"),
      async key(code, name, modifiers = 0) {
        await page.chord(code, name, modifiers);
        await sleep(300);
      },
      async click(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(300);
      },
      async swatch(i) {
        await page.evalIn(`document.querySelectorAll('.swatch')[${i}].click(); return true;`);
        await sleep(300);
      },
      rect: () => page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`),
      async at(fx, fy) {
        const r = await this.rect();
        return { x: r.x + r.w * fx, y: r.y + r.h * fy };
      },
      /** A press, a walk to `to` in `steps` moves, and the release. */
      async drag(from, to, steps = 12) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const x = from.x + ((to.x - from.x) * i) / steps;
          const y = from.y + ((to.y - from.y) * i) / steps;
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(10);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
      },
      /** The canvas's colour under a client point, as #rrggbb. */
      pixel: (p) =>
        page.evalIn(`
          const cv = document.getElementById('canvas');
          const r = cv.getBoundingClientRect();
          const k = cv.width / r.width;
          const d = cv.getContext('2d').getImageData(Math.round((${p.x} - r.left) * k), Math.round((${p.y} - r.top) * k), 1, 1).data;
          return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');`),
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

/** Two colours alike to within a few levels a channel (the canvas antialiases). */
const near = (a, b) => {
  if (!a || !b) return false;
  const ch = (s, i) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
  return [0, 1, 2].every((i) => Math.abs(ch(a, i) - ch(b, i)) <= 6);
};

await sequence('The control and the keys', async (io) => {
  const name = 'The control and the keys';
  const colors = await io.swatches();
  const height = (await io.rect()).h;
  let s = await io.control();
  c.ok(`${name}: the control shows the ink in front and no fill`, s.front === 'stroke' && s.fill === 'none' && s.fillNone && s.stroke === '#1f2328', JSON.stringify(s));
  let bar = await io.menu();
  const front = rowOf(menuOf(bar, 'Sketch'), 'fill-in-front');
  const swap = rowOf(menuOf(bar, 'Sketch'), 'swap-fill-stroke');
  c.ok(`${name}: the Sketch menu has Fill in Front, unticked, on X`, front?.label === 'Fill in Front' && front?.checked === false && front?.accelerator === 'X', JSON.stringify(front));
  c.ok(`${name}: and Swap Fill and Stroke on Shift+X`, swap?.label === 'Swap Fill and Stroke' && swap?.accelerator === 'Shift+X', JSON.stringify(swap));

  await io.key(88, 'x');
  s = await io.control();
  c.eq(`${name}: X puts the fill in front`, s.front, 'fill');
  bar = await io.menu();
  c.eq(`${name}: and ticks the menu row`, rowOf(menuOf(bar, 'Sketch'), 'fill-in-front')?.checked, true);

  await io.key(67, 'c');
  s = await io.control();
  c.ok(`${name}: C gives the fill the first Quick Access Color, and lights its swatch`, s.fill === colors[0] && !s.fillNone && s.active.join() === colors[0], JSON.stringify(s));
  await io.key(67, 'c');
  c.eq(`${name}: C again the second`, (await io.control()).fill, colors[1]);
  await io.key(67, 'C', 8);
  await io.key(67, 'C', 8);
  s = await io.control();
  c.ok(`${name}: and Shift+C back past the first to None`, s.fill === 'none' && s.fillNone, JSON.stringify(s));
  await io.key(67, 'c');
  c.eq(`${name}: from None, C gives the first again`, (await io.control()).fill, colors[0]);
  c.eq(`${name}: the stroke kept its ink all along`, (await io.control()).stroke, '#1f2328');

  // A Rectangle drawn now takes the fill.
  await io.click('tool-rect');
  await io.drag(await io.at(0.3, 0.3), await io.at(0.5, 0.6));
  const [rect] = await io.marks();
  c.ok(`${name}: a Rectangle drawn now is filled with it`, rect?.fill === colors[0] && rect?.color === '#1f2328', JSON.stringify(rect && { fill: rect.fill, color: rect.color }));
  const inside = await io.pixel(await io.at(0.4, 0.45));
  c.ok(`${name}: and the canvas shows the fill inside it`, near(inside, colors[0]), `${inside} for ${colors[0]}`);

  await io.key(88, 'X', 8);
  s = await io.control();
  c.ok(`${name}: Shift+X swaps the tool's two colors`, s.fill === '#1f2328' && s.stroke === colors[0], JSON.stringify(s));
  await io.key(88, 'X', 8);
  s = await io.control();
  c.ok(`${name}: and again swaps them back`, s.fill === colors[0] && s.stroke === '#1f2328', JSON.stringify(s));

  await io.click('fill-stroke-stroke');
  c.eq(`${name}: a click on the stroke box behind brings it forward`, (await io.control()).front, 'stroke');
  await io.click('fill-stroke-fill');
  c.eq(`${name}: and one on the fill box brings the fill back`, (await io.control()).front, 'fill');
  c.ok(`${name}: the toolbar keeps its height`, Math.abs((await io.rect()).h - height) < 0.5 && Math.abs(height - 617.67) < 1, `${height} -> ${(await io.rect()).h}`);
});

await sequence('A selection follows the one in front', async (io) => {
  const name = 'A selection follows the one in front';
  const colors = await io.swatches();
  await io.click('tool-rect');
  await io.drag(await io.at(0.25, 0.3), await io.at(0.45, 0.6));
  await io.click('tool-pen');
  await io.drag(await io.at(0.6, 0.35), await io.at(0.8, 0.55));
  const [rect, line] = await io.marks();
  c.ok(`${name}: a rectangle with no fill and an open line, both in the ink`, rect && line && !rect.fill && rect.color === '#1f2328' && line.color === '#1f2328', JSON.stringify([rect, line].map((m) => m && { fill: m.fill, color: m.color })));
  await io.click('tool-select');
  await io.key(65, 'a', 2);

  await io.swatch(1);
  let [r, l] = await io.marks();
  c.ok(`${name}: with the stroke in front, a swatch recolors both outlines`, r.color === colors[1] && l.color === colors[1] && !r.fill, JSON.stringify({ rect: [r.color, r.fill], line: l.color }));
  c.ok(`${name}: and says so`, /Recolored 2/.test(await io.toast()), await io.toast());

  await io.key(88, 'x');
  await io.swatch(2);
  [r, l] = await io.marks();
  c.ok(`${name}: with the fill in front, a swatch fills the rectangle`, r.fill === colors[2] && r.color === colors[1], JSON.stringify({ fill: r.fill, color: r.color }));
  c.eq(`${name}: and leaves the open line alone`, l.color, colors[1]);
  c.ok(`${name}: and says so`, /Filled 1 shape/.test(await io.toast()), await io.toast());
  const inside = await io.pixel(await io.at(0.35, 0.45));
  c.ok(`${name}: the canvas shows the new fill`, near(inside, colors[2]), `${inside} for ${colors[2]}`);

  await io.key(88, 'X', 8);
  [r, l] = await io.marks();
  c.ok(`${name}: Shift+X swaps the rectangle's fill and outline`, r.fill === colors[1] && r.color === colors[2], JSON.stringify({ fill: r.fill, color: r.color }));
  c.eq(`${name}: and not the open line's`, l.color, colors[1]);
  await io.key(90, 'z', 2);
  [r] = await io.marks();
  c.ok(`${name}: one undo takes the swap back`, r.fill === colors[2] && r.color === colors[1], JSON.stringify({ fill: r.fill, color: r.color }));
});

process.exit(c.summary() ? 0 : 1);
