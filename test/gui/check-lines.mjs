/**
 * Lines by hand: the Shift-click line, and the straight line's and quick
 * curve's ends.
 *
 * Before 1.0.0-alpha.4.6.0 a press with `Shift` held only snapped its start
 * to a stroke's end in reach, so a Shift-click after a click drew a second
 * dot; a straight line's end never snapped, and neither did the quick
 * curve's far end, since `Shift` was their horizontal-or-vertical lock and
 * their apex key; and the lock gave no 45 degrees.
 *
 * Nine sequences, each in an app of its own: a click and two Shift-clicks
 * are one mark, a polyline of three points, that three undos take back one
 * line at a time; a Shift-click at another width starts a mark of its own at
 * the first click; a Shift-press that goes on as a drag carries on freehand
 * in the same mark, and with `Space` goes on as a straight line; a line
 * drawn on a translucent mark paints it once, while the press is down and
 * after; a straight line's end, and a quick curve's, land on a stroke's end
 * near them; `Shift` holds a straight line drawn at 40 degrees to 45; and a
 * tool change forgets where a Shift-click line would start.
 *
 * `Space` is sent once the app has the press as freehand, and the check
 * waits for the press to turn: sent sooner, it can reach the window before
 * the press has, and a hand is never that quick.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

/** Key facts for the keys the sequences press: the DOM key, its code and its Windows key code. */
const KEYS = {
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16, bit: 8 },
  Control: { key: 'Control', code: 'ControlLeft', vk: 17, bit: 2 },
  Space: { key: ' ', code: 'Space', vk: 32, bit: 0 },
};

/** The CDP modifier bits of the keys held down. */
const bits = (held) => held.reduce((sum, name) => sum | KEYS[name].bit, 0);

async function sequence(name, run) {
  const app = launch({ mode: 'new', sketchName: `lines-${name.replace(/\W+/g, '-')}` });
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
    const held = [];
    const io = {
      /** The canvas's place in the window, measured afresh: a tool's options can move it. */
      rect: () => page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`),
      /** A client point, as fractions of the canvas's width and height. */
      async at(fx, fy) {
        const r = await this.rect();
        return { x: r.x + r.w * fx, y: r.y + r.h * fy };
      },
      /** Where a client point falls on the page. */
      async toPage(p) {
        const r = await this.rect();
        const v = await page.evalIn('return window.napkinCheck.viewState();');
        return { x: (p.x - r.x - v.panX) / v.zoom, y: (p.y - r.y - v.panY) / v.zoom };
      },
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      geometry: (id) => page.evalIn(`return window.napkinCheck.strokeGeometry?.(${JSON.stringify(id)}) ?? null;`),
      lineStart: () => page.evalIn('return window.napkinCheck.lineStart?.() ?? null;'),
      eval: (code) => page.evalIn(code),
      /** Waits up to a second for the press under way to be of `kind`, and says what it is. */
      async pressIs(kind) {
        for (let i = 0; i < 20; i++) {
          const now = await page.evalIn('return window.napkinCheck.inputState().pressKind;');
          if (now === kind) return now;
          await sleep(50);
        }
        return page.evalIn('return window.napkinCheck.inputState().pressKind;');
      },
      async tool(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(200);
      },
      async menu(id) {
        const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
        await sleep(300);
        return ran;
      },
      async chord(code, key) {
        await page.chord(code, key);
        await sleep(120);
      },
      async down(name) {
        if (!held.includes(name)) held.push(name);
        const k = KEYS[name];
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: bits(held) });
        if (name === 'Space') {
          await page.send('Input.dispatchKeyEvent', { type: 'char', key: ' ', text: ' ', unmodifiedText: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: bits(held) });
        }
        await sleep(60);
      },
      async up(name) {
        const i = held.indexOf(name);
        if (i >= 0) held.splice(i, 1);
        const k = KEYS[name];
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: bits(held) });
        await sleep(60);
      },
      async press(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers: bits(held) });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: bits(held) });
        await sleep(40);
      },
      /** Moves with the button held along `path` (0 to 1), in `steps`. */
      async drag(path, steps = 12) {
        for (let i = 1; i <= steps; i++) {
          const p = path(i / steps);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: bits(held) });
          await sleep(10);
        }
      },
      async release(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: bits(held) });
        await sleep(300);
      },
      async click(p) {
        await this.press(p);
        await this.release(p);
      },
      /** A click with Shift held, the key down before the press and up after the release. */
      async shiftClick(p) {
        await this.down('Shift');
        await this.click(p);
        await this.up('Shift');
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

const near = (a, b, tol = 1e-6) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
const xy = (p) => (p ? `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})` : 'none');
const line = (a, b) => (s) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });

await sequence('A click and two Shift-clicks are one polyline', async (io) => {
  const name = 'A click and two Shift-clicks are one polyline';
  await io.tool('tool-pen');
  const a = await io.at(0.3, 0.3);
  const b = await io.at(0.5, 0.3);
  const cc = await io.at(0.5, 0.6);
  await io.click(a);
  const dot = (await io.marks())[0];
  c.ok(`${name}: the click leaves a dot`, !!dot && dot.points === 1, JSON.stringify(dot));
  await io.shiftClick(b);
  await io.shiftClick(cc);
  const marks = await io.marks();
  c.eq(`${name}: the Shift-clicks draw onto the dot's mark, adding none`, marks.length, 1);
  const mark = marks[0];
  const geometry = mark ? await io.geometry(mark.id) : null;
  const want = [await io.toPage(a), await io.toPage(b), await io.toPage(cc)];
  const got = geometry?.points ?? [];
  c.ok(
    `${name}: a polyline through the three clicks`,
    got.length === 3 && got.every((p, i) => near(p, want[i], 1e-3)),
    `${got.map(xy).join(' ')} for ${want.map(xy).join(' ')}`,
  );
  c.ok(`${name}: and the next line starts at its end`, near(await io.lineStart(), want[2], 1e-3), JSON.stringify(await io.lineStart()));
  // Three undos take it back a line at a time, and then the dot.
  const counts = [];
  for (let i = 0; i < 3; i++) {
    await io.menu('undo');
    const now = await io.marks();
    counts.push(now.length === 0 ? 0 : now[0].points);
  }
  c.eq(`${name}: three undos take back one line, the other, and the dot`, counts.join(' '), '2 1 0');
  c.ok(`${name}: and after an undo no line starts anywhere`, (await io.lineStart()) === null);
});

await sequence('A Shift-click at another width is a mark of its own', async (io) => {
  const name = 'A Shift-click at another width is a mark of its own';
  await io.tool('tool-pen');
  const a = await io.at(0.3, 0.4);
  const b = await io.at(0.6, 0.4);
  await io.click(a);
  // Quick Width 6.
  await io.chord(87, 'w');
  await io.chord(54, '6');
  await sleep(1300);
  await io.shiftClick(b);
  const marks = await io.marks();
  c.eq(`${name}: two marks`, marks.length, 2);
  const [first, second] = marks;
  c.ok(`${name}: the dot is as it was`, !!first && first.points === 1, JSON.stringify(first));
  const pa = await io.toPage(a);
  const pb = await io.toPage(b);
  c.ok(
    `${name}: the line is its own mark, from the dot to the click, at the new width`,
    !!second && second.width === 6 && near(second.first, pa, 1e-3) && near(second.last, pb, 1e-3),
    JSON.stringify(second && { width: second.width, first: second.first, last: second.last }),
  );
});

await sequence('A Shift-press that drags carries on in the same mark', async (io) => {
  const name = 'A Shift-press that drags carries on in the same mark';
  await io.tool('tool-pen');
  const a = await io.at(0.25, 0.5);
  const b = await io.at(0.45, 0.5);
  await io.click(a);
  // From the Shift-press at b, a half circle 120 pixels across, bowed down.
  const arc = (s) => ({ x: b.x + 120 * s, y: b.y + 60 * Math.sin(Math.PI * s) });
  await io.down('Shift');
  await io.press(b);
  await io.drag(arc, 40);
  await io.release(arc(1));
  await io.up('Shift');
  const marks = await io.marks();
  c.eq(`${name}: one mark`, marks.length, 1);
  const geometry = marks[0] ? await io.geometry(marks[0].id) : null;
  const anchors = geometry?.anchors ?? [];
  const pa = await io.toPage(a);
  const pb = await io.toPage(b);
  const pc = await io.toPage(arc(1));
  // The curve's first stretch may be straight enough to be a line itself: a
  // sine's hump leaves its foot with no bend at all.
  c.ok(
    `${name}: a line from the click to the press, a corner there, then the curve`,
    anchors.length >= 3 &&
      near(anchors[0].p, pa, 1e-3) &&
      near(anchors[1].p, pb, 1e-3) &&
      !anchors[0].hOut &&
      !anchors[1].hIn &&
      anchors.slice(1).some((a) => a.hIn || a.hOut),
    JSON.stringify(anchors),
  );
  c.ok(`${name}: ending where the drag let go`, anchors.length > 0 && near(anchors[anchors.length - 1].p, pc, 0.5), `${xy(anchors[anchors.length - 1]?.p)} for ${xy(pc)}`);
});

await sequence('Space during a Shift-press draws the straight line on from point 2', async (io) => {
  const name = 'Space during a Shift-press draws the straight line on from point 2';
  await io.tool('tool-pen');
  const a = await io.at(0.25, 0.3);
  const b = await io.at(0.45, 0.3);
  const cc = await io.at(0.45, 0.65);
  await io.click(a);
  await io.down('Shift');
  await io.press(b);
  await io.up('Shift');
  await io.drag(line(b, { x: b.x + 6, y: b.y + 8 }), 3);
  await io.pressIs('freehand');
  await io.down('Space');
  c.eq(`${name}: Space makes the press a straight line`, await io.pressIs('straight'), 'straight');
  await io.drag(line({ x: b.x + 6, y: b.y + 8 }, cc), 10);
  await io.release(cc);
  await io.up('Space');
  const marks = await io.marks();
  const geometry = marks[0] ? await io.geometry(marks[0].id) : null;
  const want = [await io.toPage(a), await io.toPage(b), await io.toPage(cc)];
  const got = geometry?.points ?? [];
  c.ok(
    `${name}: one mark, a polyline from the click through the press to the release`,
    marks.length === 1 && got.length === 3 && got.every((p, i) => near(p, want[i], 1e-3)),
    `${marks.length} marks: ${got.map(xy).join(' ')} for ${want.map(xy).join(' ')}`,
  );
});

await sequence('A line drawn on a translucent mark paints it once', async (io) => {
  const name = 'A line drawn on a translucent mark paints it once';
  await io.tool('tool-pen');
  // Quick Width 8, Quick Opacity 40.
  await io.chord(87, 'w');
  await io.chord(56, '8');
  await sleep(1300);
  await io.chord(81, 'q');
  await io.chord(52, '4');
  await io.chord(48, '0');
  await sleep(1300);
  const a = await io.at(0.3, 0.5);
  const b = await io.at(0.6, 0.5);
  const mid = { x: (a.x + b.x) / 2, y: a.y };
  /** The canvas's red channel under a client point. */
  const tone = (p) =>
    io.eval(`
      const cv = document.getElementById('canvas');
      const r = cv.getBoundingClientRect();
      const k = cv.width / r.width;
      return cv.getContext('2d').getImageData(Math.round((${p.x} - r.left) * k), Math.round((${p.y} - r.top) * k), 1, 1).data[0];`);
  await io.click(a);
  await io.down('Shift');
  await io.press(b);
  await sleep(150);
  // The press is still down: the dot and the line to it are one mark on the canvas.
  const during = { atDot: await tone(a), along: await tone(mid) };
  c.ok(`${name}: while the press is down, the dot is no darker than the line`, Math.abs(during.atDot - during.along) <= 2, JSON.stringify(during));
  await io.release(b);
  await io.up('Shift');
  const after = { atDot: await tone(a), along: await tone(mid) };
  c.ok(`${name}: nor once it is let go`, Math.abs(after.atDot - after.along) <= 2 && after.along < 250, JSON.stringify(after));
});

await sequence("A straight line's end and a quick curve's land on a stroke's end", async (io) => {
  const name = "A straight line's end and a quick curve's land on a stroke's end";
  await io.tool('tool-pen');
  // A stroke to snap to, ending at e.
  const s0 = await io.at(0.2, 0.25);
  const e = await io.at(0.4, 0.25);
  await io.press(s0);
  await io.drag((s) => ({ x: s0.x + (e.x - s0.x) * s, y: s0.y + 30 * Math.sin(Math.PI * s) }), 16);
  await io.release(e);
  const target = (await io.marks())[0]?.last;
  // A straight line from below, let go five pixels off the stroke's end.
  const from = await io.at(0.3, 0.7);
  const off = { x: e.x + 5, y: e.y + 3 };
  await io.press(from);
  await io.drag(line(from, { x: from.x + 10, y: from.y - 10 }), 3);
  await io.pressIs('freehand');
  await io.down('Space');
  c.eq(`${name}: Space makes the press a straight line`, await io.pressIs('straight'), 'straight');
  await io.drag(line({ x: from.x + 10, y: from.y - 10 }, off), 10);
  await io.release(off);
  await io.up('Space');
  let marks = await io.marks();
  const straight = marks[marks.length - 1];
  c.ok(`${name}: the straight line is drawn`, marks.length === 2 && straight.points === 2, JSON.stringify(straight));
  c.ok(`${name}: and its end lands on the stroke's end`, near(straight?.last, target, 1e-6), `${xy(straight?.last)} for ${xy(target)}`);
  // A quick curve from further down, let go as near the stroke's end.
  const from2 = await io.at(0.25, 0.8);
  await io.press(from2);
  await io.drag(line(from2, { x: from2.x + 10, y: from2.y - 10 }), 3);
  await io.pressIs('freehand');
  await io.down('Control');
  await io.down('Space');
  c.eq(`${name}: Ctrl and Space make the press a quick curve`, await io.pressIs('curve'), 'curve');
  await io.drag(line({ x: from2.x + 10, y: from2.y - 10 }, off), 10);
  await io.release(off);
  await io.up('Space');
  await io.up('Control');
  marks = await io.marks();
  const curve = marks[marks.length - 1];
  c.ok(`${name}: the quick curve is drawn`, marks.length === 3 && curve.anchors === 2, JSON.stringify(curve));
  c.ok(`${name}: and its far end lands on the stroke's end`, near(curve?.last, target, 1e-6), `${xy(curve?.last)} for ${xy(target)}`);
});

await sequence('Shift holds a straight line to 45 degrees', async (io) => {
  const name = 'Shift holds a straight line to 45 degrees';
  await io.tool('tool-pen');
  const a = await io.at(0.3, 0.7);
  // 200 pixels out at 40 degrees up and to the right.
  const angle = (40 * Math.PI) / 180;
  const b = { x: a.x + 200 * Math.cos(angle), y: a.y - 200 * Math.sin(angle) };
  await io.press(a);
  await io.drag(line(a, { x: a.x + 8, y: a.y - 6 }), 3);
  await io.pressIs('freehand');
  await io.down('Space');
  c.eq(`${name}: Space makes the press a straight line`, await io.pressIs('straight'), 'straight');
  await io.down('Shift');
  await io.drag(line({ x: a.x + 8, y: a.y - 6 }, b), 12);
  await io.release(b);
  await io.up('Shift');
  await io.up('Space');
  const marks = await io.marks();
  const mark = marks[marks.length - 1];
  const dx = mark ? mark.last.x - mark.first.x : 0;
  const dy = mark ? mark.first.y - mark.last.y : 0;
  const drawn = (Math.atan2(dy, dx) * 180) / Math.PI;
  c.ok(`${name}: the line runs at 45 degrees`, !!mark && Math.abs(drawn - 45) < 0.01, `${drawn.toFixed(3)} degrees`);
});

await sequence('A tool change forgets where the line would start', async (io) => {
  const name = 'A tool change forgets where the line would start';
  await io.tool('tool-pen');
  const a = await io.at(0.3, 0.4);
  const b = await io.at(0.6, 0.4);
  await io.click(a);
  await io.tool('tool-select');
  c.ok(`${name}: with the Select tool in hand no line starts anywhere`, (await io.lineStart()) === null);
  await io.tool('tool-pen');
  await io.shiftClick(b);
  const marks = await io.marks();
  c.ok(`${name}: back on the Pen, a Shift-click is a dot of its own`, marks.length === 2 && marks.every((m) => m.points === 1), JSON.stringify(marks.map((m) => m.points)));
});

process.exit(c.summary() ? 0 : 1);
