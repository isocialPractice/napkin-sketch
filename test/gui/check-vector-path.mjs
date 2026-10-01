/**
 * The Vector Path tool: Shift while a path is placed, and the close
 * indicator.
 *
 * Before 1.0.0-alpha.4.6.0 Shift did nothing while a path was placed, and
 * nothing showed that a click would close it: a press within the grab radius
 * of the first anchor closed the path, and nothing marked that radius.
 *
 * Four sequences, each in an app of its own: a Shift-click at 40 degrees
 * places its anchor at 45, and the band follows Shift going down and up
 * without a move; a smooth point pulled at 40 degrees with Shift has its
 * handles at 45; the pointer 3 pixels from the first anchor shows the close
 * indicator, the band ends on the anchor, and a click there closes the
 * path; 20 pixels away there is no indicator and a click places another
 * anchor.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

const SHIFT = { key: 'Shift', code: 'ShiftLeft', vk: 16, bit: 8 };

async function sequence(name, run) {
  const app = launch({ mode: 'new', sketchName: `vector-path-${name.replace(/\W+/g, '-')}` });
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
    let shift = false;
    const mods = () => (shift ? SHIFT.bit : 0);
    const io = {
      /** The canvas's place in the window, measured afresh: the Vector Path tool's options move it. */
      rect: () => page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`),
      async at(fx, fy) {
        const r = await this.rect();
        return { x: r.x + r.w * fx, y: r.y + r.h * fy };
      },
      async toPage(p) {
        const r = await this.rect();
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: (p.x - r.x - v.panX) / v.zoom, y: (p.y - r.y - v.panY) / v.zoom };
      },
      state: () => page.evalIn('return window.napkinCheck.vectorPathState?.() ?? null;'),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      eval: (code) => page.evalIn(code),
      async tool(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(250);
      },
      async shiftDown() {
        shift = true;
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: SHIFT.key, code: SHIFT.code, windowsVirtualKeyCode: SHIFT.vk, nativeVirtualKeyCode: SHIFT.vk, modifiers: mods() });
        await sleep(80);
      },
      async shiftUp() {
        shift = false;
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: SHIFT.key, code: SHIFT.code, windowsVirtualKeyCode: SHIFT.vk, nativeVirtualKeyCode: SHIFT.vk, modifiers: mods() });
        await sleep(80);
      },
      async hover(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers: mods() });
        await sleep(80);
      },
      async click(p) {
        await this.hover(p);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods() });
        await sleep(30);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods() });
        await sleep(250);
      },
      /** A press at `p`, dragged to `q`, and the release: a smooth point. */
      async pull(p, q, steps = 10) {
        await this.hover(p);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods() });
        for (let i = 1; i <= steps; i++) {
          const x = p.x + (q.x - p.x) * (i / steps);
          const y = p.y + (q.y - p.y) * (i / steps);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods() });
          await sleep(12);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods() });
        await sleep(250);
      },
    };
    await io.tool('tool-vector');
    await run(io);
    const errors = await page.evalIn('return window.__errors;');
    c.ok(`${name}: the page threw nothing`, errors.length === 0, errors.join(' | '));
  } catch (error) {
    c.ok(`${name}: the sequence ran`, false, String(error?.stack ?? error));
  } finally {
    await stop(app);
  }
}

/** The angle from `a` to `b` on the page, in degrees, counter-clockwise from level (the page's y runs down). */
const angleOf = (a, b) => (a && b ? (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI : NaN);
const deg = (v) => `${Number.isFinite(v) ? v.toFixed(3) : v} degrees`;
/** `r` screen pixels out from `a` at `degrees` up from level. */
const out = (a, r, degrees) => ({ x: a.x + r * Math.cos((degrees * Math.PI) / 180), y: a.y - r * Math.sin((degrees * Math.PI) / 180) });

await sequence('Shift holds the next anchor to 45 degrees', async (io) => {
  const name = 'Shift holds the next anchor to 45 degrees';
  const a = await io.at(0.3, 0.6);
  await io.click(a);
  const b = out(a, 200, 40);
  await io.hover(b);
  const first = (await io.state())?.anchors?.[0]?.p;
  const free = (await io.state())?.hover;
  c.ok(`${name}: the band follows the pointer at 40 degrees`, Math.abs(angleOf(first, free) - 40) < 0.05, deg(angleOf(first, free)));
  await io.shiftDown();
  const held = (await io.state())?.hover;
  c.ok(`${name}: Shift going down puts it at 45 at once`, Math.abs(angleOf(first, held) - 45) < 0.01, deg(angleOf(first, held)));
  await io.shiftUp();
  const let_go = (await io.state())?.hover;
  c.ok(`${name}: and Shift going up frees it again`, Math.abs(angleOf(first, let_go) - 40) < 0.05, deg(angleOf(first, let_go)));
  await io.shiftDown();
  await io.click(b);
  await io.shiftUp();
  const anchors = (await io.state())?.anchors ?? [];
  c.ok(`${name}: a Shift-click there places the anchor at 45`, anchors.length === 2 && Math.abs(angleOf(anchors[0].p, anchors[1].p) - 45) < 0.01, `${anchors.length} anchors, ${deg(angleOf(anchors[0]?.p, anchors[1]?.p))}`);
});

await sequence('Shift holds a pulled handle to 45 degrees', async (io) => {
  const name = 'Shift holds a pulled handle to 45 degrees';
  const a = await io.at(0.25, 0.6);
  await io.click(a);
  const b = out(a, 200, 0);
  await io.shiftDown();
  await io.pull(b, out(b, 80, 40));
  await io.shiftUp();
  const anchors = (await io.state())?.anchors ?? [];
  const smooth = anchors[1];
  c.ok(`${name}: the drag made a smooth point`, !!smooth?.hOut && !!smooth?.hIn, JSON.stringify(smooth));
  c.ok(`${name}: its handle leaves at 45`, Math.abs(angleOf(smooth?.p, smooth?.hOut) - 45) < 0.01, deg(angleOf(smooth?.p, smooth?.hOut)));
  c.ok(`${name}: and the other arrives straight through it`, Math.abs(angleOf(smooth?.p, smooth?.hIn) - -135) < 0.01, deg(angleOf(smooth?.p, smooth?.hIn)));
});

/** Three anchors of a triangle, and the first of them in client pixels. */
async function triangle(io) {
  const a = await io.at(0.3, 0.35);
  await io.click(a);
  await io.click(await io.at(0.55, 0.35));
  await io.click(await io.at(0.45, 0.7));
  return a;
}

/** Whether the canvas around a client point shows the close indicator's blue, #20557b. */
function indicatorShown(io, p) {
  return io.eval(`
    const cv = document.getElementById('canvas');
    const r = cv.getBoundingClientRect();
    const k = cv.width / r.width;
    const cx = Math.round((${p.x} - r.left) * k);
    const cy = Math.round((${p.y} - r.top) * k);
    const half = Math.round(12 * k);
    const d = cv.getContext('2d').getImageData(cx - half, cy - half, 2 * half + 1, 2 * half + 1).data;
    let hits = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.hypot(d[i] - 0x20, d[i + 1] - 0x55, d[i + 2] - 0x7b) < 40) hits++;
    }
    return hits;`);
}

await sequence('The close indicator shows where a click closes the path', async (io) => {
  const name = 'The close indicator shows where a click closes the path';
  const a = await triangle(io);
  await io.hover({ x: a.x + 3, y: a.y });
  // The asset decodes the first time it is wanted; a move after that paints it.
  await sleep(500);
  await io.hover({ x: a.x + 3, y: a.y + 0.5 });
  const s = await io.state();
  c.ok(`${name}: 3 pixels from the first anchor, a press would close the path`, s?.closeHover === true, JSON.stringify(s && { closeHover: s.closeHover }));
  const pa = await io.toPage(a);
  c.ok(`${name}: and the band ends on the first anchor`, !!s?.hover && Math.hypot(s.hover.x - s.anchors[0].p.x, s.hover.y - s.anchors[0].p.y) < 1e-9, `${JSON.stringify(s?.hover)} for ${JSON.stringify(s?.anchors?.[0]?.p ?? pa)}`);
  const hits = await indicatorShown(io, a);
  c.ok(`${name}: the indicator is drawn on it`, s?.indicatorReady === true && hits > 20, `${hits} pixels of its blue, ready ${s?.indicatorReady}`);
  await io.hover({ x: a.x + 20, y: a.y });
  const away = await io.state();
  c.ok(`${name}: 20 pixels away it is gone`, away?.closeHover === false && (await indicatorShown(io, a)) === 0, JSON.stringify(away && { closeHover: away.closeHover }));
  await io.click({ x: a.x + 3, y: a.y });
  const marks = await io.marks();
  c.ok(`${name}: a click 3 pixels off closes the path`, marks.length === 1 && marks[0].closed === true && marks[0].anchors === 3, JSON.stringify(marks.map((m) => ({ closed: m.closed, anchors: m.anchors }))));
});

await sequence('20 pixels off, a click places another anchor', async (io) => {
  const name = '20 pixels off, a click places another anchor';
  const a = await triangle(io);
  const p = { x: a.x + 20, y: a.y };
  await io.hover(p);
  const s = await io.state();
  const pp = await io.toPage(p);
  c.ok(`${name}: no indicator, and the band follows the pointer`, s?.closeHover !== true && !!s?.hover && Math.hypot(s.hover.x - pp.x, s.hover.y - pp.y) < 1e-3, JSON.stringify(s && { closeHover: s.closeHover, hover: s.hover }));
  await io.click(p);
  const after = await io.state();
  c.ok(`${name}: the click places a fourth anchor`, (after?.anchors?.length ?? 0) === 4 && (await io.marks()).length === 0, `${after?.anchors?.length} anchors`);
});

process.exit(c.summary() ? 0 : 1);
