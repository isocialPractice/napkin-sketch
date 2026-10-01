/**
 * Held keys on the canvas, and a press that always lets go of the pointer.
 *
 * The first sequences once left the canvas believing a pointer was still
 * down, after which every press was ignored whatever the tool - the
 * tools-break: `Escape` or a lost window during a quick curve, the same with
 * Shift held too, `Ctrl` held long enough through a Select or a Text drag for
 * the Copic nib-rotate to switch the tool mid-press, a shortcut key choosing
 * another tool mid-press, and `Escape` closing the Rotate dialog mid-drag. Two
 * more left a key held that was not: a lost window while Space was down (every
 * pen drag became a two-point line), and `Ctrl` held a second on the Pen (the
 * Copic nib-rotate, which must give the Pen back when `Ctrl` goes up). Two end
 * a press without its release at all: the pointer capture taken away
 * mid-stroke, and the window hidden mid-stroke. After each, the check reads
 * the input state back through `window.napkinCheck.inputState()` - no pointer
 * owned, no per-press field left set - then draws a plain pen stroke with real
 * pointer events and asks for one more mark, drawn freehand.
 *
 * The rest hold the held keys to what they mean since 1.0.0-alpha.4.6.0: with
 * no press under way, Space pans on the Pen and Ctrl lends the last selection
 * tool - but a chord such as Ctrl+Z leaves the Pen in hand, and a still Ctrl
 * turns the Copic nib instead; after a press, Space makes the stroke a
 * straight line, and Ctrl with it the quick curve. The last three hold a bare
 * Alt to the menu-bar rule: soon after another key, or after Alt + scroll, it
 * leaves the menu bar alone; after five idle seconds, the menu bar takes the
 * keyboard, which the page sees as losing the focus.
 *
 * Each sequence runs in an app of its own, so one stuck state cannot hide the
 * next. A lost window is the window's `blur` event and a hidden one is
 * `visibilitychange` with the page reporting itself hidden: what the app
 * listens for, sent by the check. The page is told it has the focus whatever
 * the system does with its windows, except in the Alt sequences, which watch
 * the real focus go to the menu bar.
 */
import { BACKGROUND, launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

/** Key facts for the keys the sequences press: the DOM key, its code and its Windows key code. */
const KEYS = {
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16, bit: 8 },
  Control: { key: 'Control', code: 'ControlLeft', vk: 17, bit: 2 },
  Alt: { key: 'Alt', code: 'AltLeft', vk: 18, bit: 1 },
  Space: { key: ' ', code: 'Space', vk: 32, bit: 0 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27, bit: 0 },
  a: { key: 'a', code: 'KeyA', vk: 65, bit: 0 },
  b: { key: 'b', code: 'KeyB', vk: 66, bit: 0 },
  p: { key: 'p', code: 'KeyP', vk: 80, bit: 0 },
  r: { key: 'r', code: 'KeyR', vk: 82, bit: 0 },
  z: { key: 'z', code: 'KeyZ', vk: 90, bit: 0 },
};

/** The CDP modifier bits of the keys held down, a modifier's own bit included on its keydown. */
const bits = (held) => held.reduce((sum, name) => sum | KEYS[name].bit, 0);

/** An app of its own for one sequence, with the drawing helpers bound to it. */
async function sequence(name, run, { focusEmulation = true } = {}) {
  // The real focus goes nowhere near a window kept off the screen.
  if (!focusEmulation && BACKGROUND) {
    c.skip(name, 'it watches the real focus go to the menu bar: run it without --background');
    return;
  }
  const app = launch({ mode: 'new', sketchName: `held-keys-${name.replace(/\W+/g, '-')}` });
  try {
    const page = await connect();
    await page.send('Runtime.enable');
    // The page is told it has the focus whatever the system does with its
    // windows. A lost window finishes a stroke where it stands, so a focus
    // change from another window opening mid-run would cut a stroke short;
    // the check's own lost window is the event it sends.
    if (focusEmulation) await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    else await page.send('Page.bringToFront');
    await sleep(3000);
    await page.evalIn(`
      window.__errors = [];
      window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
      window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
      // What ended each press, for the report when a stroke comes out short.
      window.__trail = [];
      window.__blurs = 0;
      const t0 = performance.now();
      const note = (what) => window.__trail.push(Math.round(performance.now() - t0) + 'ms ' + what);
      const cv = document.getElementById('canvas');
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
        cv.addEventListener(type, (ev) => note(type + (ev.isTrusted ? '' : ' (sent)')), true);
      }
      window.addEventListener('blur', (ev) => {
        if (ev.isTrusted) window.__blurs++;
        note('window blur' + (ev.isTrusted ? '' : ' (sent)'));
      }, true);
      document.addEventListener('dragstart', () => note('dragstart'), true);
      document.activeElement?.blur();
      return true;`);
    const rect = await page.evalIn(
      `const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`,
    );
    const held = [];
    const io = {
      page,
      /** A point on the canvas, as fractions of its width and height. */
      at: (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }),
      async down(name) {
        if (!held.includes(name)) held.push(name);
        const k = KEYS[name];
        await page.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: bits(held),
        });
        if (name === 'Space') {
          await page.send('Input.dispatchKeyEvent', { type: 'char', key: ' ', text: ' ', unmodifiedText: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: bits(held) });
        }
      },
      async up(name) {
        const i = held.indexOf(name);
        if (i >= 0) held.splice(i, 1);
        const k = KEYS[name];
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: bits(held),
        });
      },
      async tap(name) {
        await this.down(name);
        await this.up(name);
      },
      /** Moves onto `p` with no button, as a real mouse arrives before it presses. */
      async hover(p) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers: bits(held) });
      },
      async press(p) {
        await this.hover(p);
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: bits(held) });
      },
      /** Moves with the button held from `from` to `to`, in `steps`, bowed sideways by `bow` pixels. */
      async drag(from, to, steps = 8, bow = 0) {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const x = from.x + (to.x - from.x) * t;
          const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * bow;
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: bits(held) });
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
      async wheel(p, deltaY) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY, modifiers: bits(held) });
        await sleep(100);
      },
      tool: (id) => page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`),
      state: () => page.evalIn('return window.napkinCheck.inputState();'),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      view: () => page.evalIn('return window.napkinCheck.viewState();'),
      eval: (code) => page.evalIn(code),
      /** Draws a plain freehand pen stroke from `a` to `b` and returns the mark it added, or null. */
      async plainStroke(a = this.at(0.55, 0.3), b = this.at(0.8, 0.45)) {
        await this.tool('tool-pen');
        await sleep(150);
        const before = (await this.marks()).length;
        await this.press(a);
        await this.drag(a, b, 12, 30);
        await this.release(b);
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

/** The input a release must leave: no pointer owned and no per-press field set. */
async function letGo(io, name) {
  const s = await io.state();
  c.ok(`${name}: no pointer is owned after the release`, s.activePointerId === null, `activePointerId ${s.activePointerId}`);
  c.ok(`${name}: no per-press field is left set`, s.press.length === 0, s.press.join(', '));
  return s;
}

/** The drawing still works: one more mark, drawn freehand with the pen. */
async function stillDraws(io, name) {
  await io.eval('window.__trail.length = 0; return true;');
  const mark = await io.plainStroke();
  c.ok(`${name}: a plain pen stroke still adds a mark`, mark !== null);
  const freehand = mark !== null && mark.tool === 'pen' && mark.points > 2;
  const trail = freehand ? '' : ` - the stroke's events: ${(await io.eval('return window.__trail;')).join(', ')}`;
  c.ok(`${name}: drawn freehand with the pen`, freehand, `${mark ? `${mark.tool}, ${mark.points} points` : 'no mark'}${trail}`);
}

/**
 * A quick curve - a press, then Ctrl and Space - ended by something other
 * than letting go. `extraHeld` are keys held down with Ctrl before Space.
 */
async function quickCurveThen(io, name, extraHeld, interrupt) {
  await io.tool('tool-pen');
  const a = io.at(0.25, 0.55);
  const mid = io.at(0.3, 0.5);
  const b = io.at(0.4, 0.4);
  await io.press(a);
  await io.drag(a, mid, 3);
  await io.down('Control');
  for (const key of extraHeld) await io.down(key);
  await io.down('Space');
  c.eq(`${name}: Ctrl and Space after the press make the quick curve`, (await io.state()).pressKind, 'curve');
  await io.drag(mid, b, 4);
  await interrupt();
  await io.release(b);
  await io.up('Space');
  for (const key of [...extraHeld].reverse()) await io.up(key);
  await io.up('Control');
  await letGo(io, name);
  await stillDraws(io, name);
}

// ---- A press always lets go of the pointer -----------------------------------------

await sequence('Escape during a quick curve', async (io) => {
  await quickCurveThen(io, 'Escape during a quick curve', [], () => io.tap('Escape'));
});

await sequence('Escape during a quick curve with Shift held too', async (io) => {
  await quickCurveThen(io, 'Escape during a quick curve with Shift held too', ['Shift'], () => io.tap('Escape'));
});

await sequence('A lost window during a quick curve', async (io) => {
  await quickCurveThen(io, 'A lost window during a quick curve', [], async () => {
    await io.eval(`window.dispatchEvent(new Event('blur')); return true;`);
    const s = await io.state();
    c.ok('A lost window during a quick curve: Space is let go with the window', s.spaceDown === false, `spaceDown ${s.spaceDown}`);
  });
});

await sequence('Ctrl held through a Select drag', async (io) => {
  const name = 'Ctrl held through a Select drag';
  await io.tool('tool-select');
  const a = io.at(0.2, 0.2);
  const b = io.at(0.35, 0.35);
  await io.press(a);
  await io.drag(a, b, 6);
  await io.down('Control');
  await sleep(1400);
  await io.drag(b, io.at(0.37, 0.37), 2);
  await io.release(io.at(0.37, 0.37));
  await io.up('Control');
  const s = await letGo(io, name);
  c.eq(`${name}: the Select tool is still in hand after Ctrl goes up`, s.tool, 'select');
  await stillDraws(io, name);
});

await sequence('Ctrl held through a Text drag', async (io) => {
  const name = 'Ctrl held through a Text drag';
  await io.tool('tool-text');
  const a = io.at(0.2, 0.2);
  const b = io.at(0.4, 0.3);
  await io.press(a);
  await io.drag(a, b, 6);
  await io.down('Control');
  await sleep(1400);
  await io.release(b);
  await io.up('Control');
  await letGo(io, name);
  // The release opened a text box; an empty one closes with the focus.
  await io.eval('document.activeElement?.blur(); return true;');
  await sleep(150);
  await stillDraws(io, name);
});

await sequence('A lost window while Space is held', async (io) => {
  const name = 'A lost window while Space is held';
  await io.tool('tool-pen');
  await io.down('Space');
  await io.eval(`window.dispatchEvent(new Event('blur')); return true;`);
  // The Space keyup went to whatever had the focus: this window never hears it.
  const s = await io.state();
  c.ok(`${name}: Space is let go with the window`, s.spaceDown === false, `spaceDown ${s.spaceDown}`);
  await stillDraws(io, name);
});

await sequence('A key choosing another tool mid-press', async (io) => {
  const name = 'A key choosing another tool mid-press';
  await io.tool('tool-select');
  const a = io.at(0.2, 0.2);
  const b = io.at(0.35, 0.35);
  await io.press(a);
  await io.drag(a, b, 6);
  await io.tap('b');
  await io.release(b);
  const s = await letGo(io, name);
  c.eq(`${name}: the Brush the key chose is in hand once the press is over`, s.tool, 'pen');
  await stillDraws(io, name);
});

await sequence('Escape during a Rotate drag', async (io) => {
  const name = 'Escape during a Rotate drag';
  c.ok(`${name}: a mark to turn`, (await io.plainStroke()) !== null);
  await io.down('Control');
  await io.tap('a');
  await io.tap('r');
  await io.up('Control');
  await sleep(300);
  const open = await io.eval(`return !document.getElementById('rotate-dialog').classList.contains('is-hidden');`);
  c.ok(`${name}: Ctrl+R opens the Rotate dialog on the selection`, open);
  // With the dialog up, a press on the canvas away from the pivot turns the selection.
  const a = io.at(0.25, 0.75);
  const b = io.at(0.35, 0.8);
  await io.press(a);
  await io.drag(a, b, 6);
  await io.tap('Escape');
  await io.release(b);
  await letGo(io, name);
  await stillDraws(io, name);
});

await sequence('The pointer capture taken away mid-stroke', async (io) => {
  const name = 'The pointer capture taken away mid-stroke';
  await io.tool('tool-pen');
  const before = (await io.marks()).length;
  const a = io.at(0.2, 0.6);
  const b = io.at(0.35, 0.5);
  await io.press(a);
  await io.drag(a, b, 8, 20);
  await io.eval(`const cv = document.getElementById('canvas'); if (cv.hasPointerCapture(1)) cv.releasePointerCapture(1); return true;`);
  // The capture is only given up at the next pointer event, as the Pointer
  // Events spec has it: that is when the window hears it has gone.
  await io.drag(b, io.at(0.36, 0.5), 1);
  await sleep(150);
  const mid = await io.state();
  c.ok(`${name}: the press ends when the capture goes`, mid.activePointerId === null && mid.press.length === 0, JSON.stringify(mid.press));
  c.eq(`${name}: and keeps the stroke drawn so far`, (await io.marks()).length, before + 1);
  await io.drag(b, io.at(0.4, 0.5), 3);
  await io.release(io.at(0.4, 0.5));
  await letGo(io, name);
  await stillDraws(io, name);
});

await sequence('The window hidden mid-stroke', async (io) => {
  const name = 'The window hidden mid-stroke';
  await io.tool('tool-pen');
  const before = (await io.marks()).length;
  const a = io.at(0.2, 0.6);
  const b = io.at(0.35, 0.5);
  await io.press(a);
  await io.drag(a, b, 8, 20);
  await io.eval(`
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
    return true;`);
  await sleep(150);
  const mid = await io.state();
  c.ok(`${name}: the press ends when the window is hidden`, mid.activePointerId === null && mid.press.length === 0, JSON.stringify(mid.press));
  c.eq(`${name}: and keeps the stroke drawn so far`, (await io.marks()).length, before + 1);
  await io.release(b);
  await letGo(io, name);
  await stillDraws(io, name);
});

// ---- Space and Ctrl, with no press under way and after one --------------------------

await sequence('Space held pans on the Pen', async (io) => {
  const name = 'Space held pans on the Pen';
  await io.tool('tool-pen');
  const view = await io.view();
  const a = io.at(0.3, 0.5);
  const b = io.at(0.45, 0.6);
  await io.hover(a);
  await io.down('Space');
  c.eq(`${name}: the pointer is the hand`, (await io.state()).cursor, 'grab');
  await io.press(a);
  c.eq(`${name}: the press is a pan`, (await io.state()).pressKind, 'pan');
  await io.drag(a, b, 6);
  await io.release(b);
  await io.up('Space');
  const after = await io.view();
  c.ok(
    `${name}: the page moved with the pointer`,
    Math.abs(after.panX - view.panX - (b.x - a.x)) < 1.5 && Math.abs(after.panY - view.panY - (b.y - a.y)) < 1.5,
    `pan moved ${(after.panX - view.panX).toFixed(1)}, ${(after.panY - view.panY).toFixed(1)} for a drag of ${(b.x - a.x).toFixed(1)}, ${(b.y - a.y).toFixed(1)}`,
  );
  c.eq(`${name}: and drew nothing`, (await io.marks()).length, 0);
  await letGo(io, name);
  await stillDraws(io, name);
});

await sequence('Space after the press draws a straight line', async (io) => {
  const name = 'Space after the press draws a straight line';
  await io.tool('tool-pen');
  const a = io.at(0.2, 0.5);
  const mid = io.at(0.3, 0.4);
  const b = io.at(0.5, 0.45);
  await io.press(a);
  await io.drag(a, mid, 6, 25);
  await io.down('Space');
  c.eq(`${name}: the press turns into a straight line`, (await io.state()).pressKind, 'straight');
  await io.drag(mid, b, 6, 25);
  await io.release(b);
  await io.up('Space');
  const marks = await io.marks();
  c.ok(`${name}: one mark, a two-point pen line`, marks.length === 1 && marks[0].tool === 'pen' && marks[0].points === 2, JSON.stringify(marks));
  await letGo(io, name);
});

await sequence('Ctrl and Space after the press draw the quick curve', async (io) => {
  const name = 'Ctrl and Space after the press draw the quick curve';
  await io.tool('tool-pen');
  const a = io.at(0.2, 0.6);
  const mid = io.at(0.25, 0.55);
  const b = io.at(0.45, 0.35);
  await io.press(a);
  await io.drag(a, mid, 3);
  await io.down('Space');
  c.eq(`${name}: Space first makes it straight`, (await io.state()).pressKind, 'straight');
  await io.down('Control');
  c.eq(`${name}: and Ctrl joining it makes it the quick curve`, (await io.state()).pressKind, 'curve');
  await io.drag(mid, b, 6);
  await io.release(b);
  await io.up('Control');
  await io.up('Space');
  const marks = await io.marks();
  c.ok(`${name}: one mark, a curve of two anchors`, marks.length === 1 && marks[0].tool === 'pen' && marks[0].anchors === 2, JSON.stringify(marks));
  await letGo(io, name);
});

await sequence('Ctrl lends the last selection tool', async (io) => {
  const name = 'Ctrl lends the last selection tool';
  const start = io.at(0.55, 0.3);
  c.ok(`${name}: a mark to select`, (await io.plainStroke(start)) !== null);
  // Direct Select was the last selection tool chosen.
  await io.tool('tool-point');
  await io.tool('tool-pen');
  await io.down('Control');
  await io.hover(io.at(0.3, 0.7));
  const lent = await io.state();
  c.eq(`${name}: Ctrl and a move on the Pen give Direct Select`, lent.tool, 'point');
  await io.up('Control');
  await sleep(100);
  c.eq(`${name}: and Ctrl up gives the Pen back`, (await io.state()).tool, 'pen');
  // Then Select.
  await io.tool('tool-select');
  await io.tool('tool-pen');
  await io.down('Control');
  await io.click(start);
  c.eq(`${name}: a click with Ctrl held is the Select tool's`, (await io.state()).tool, 'select');
  c.eq(`${name}: and selects the mark under it`, (await io.eval('return window.napkinCheck.selectionBoxes().length;')), 1);
  await io.up('Control');
  await sleep(100);
  c.eq(`${name}: Ctrl up gives the Pen back again`, (await io.state()).tool, 'pen');
  await letGo(io, name);
});

await sequence('A Ctrl chord leaves the drawing tool in hand', async (io) => {
  const name = 'A Ctrl chord leaves the drawing tool in hand';
  c.ok(`${name}: a mark to undo`, (await io.plainStroke()) !== null);
  await io.down('Control');
  await io.tap('z');
  const during = await io.state();
  await io.up('Control');
  c.eq(`${name}: the Pen stays in hand through Ctrl+Z`, during.tool, 'pen');
  c.eq(`${name}: and the selection tool never came up`, during.spring, 'off');
  c.eq(`${name}: while the undo ran`, (await io.marks()).length, 0);
  await stillDraws(io, name);
});

await sequence('Ctrl held still on the Pen turns the Copic nib', async (io) => {
  const name = 'Ctrl held still on the Pen turns the Copic nib';
  await io.tool('tool-pen');
  await io.hover(io.at(0.4, 0.4));
  const width = (await io.state()).width;
  await io.down('Control');
  await sleep(1300);
  const on = await io.state();
  c.ok(`${name}: after the hold time the nib-rotate is on, with the Copic in hand`, on.nibRotateActive && on.tool === 'copic', JSON.stringify({ tool: on.tool, nib: on.nib }));
  await io.up('Control');
  await sleep(100);
  const back = await io.state();
  c.eq(`${name}: Ctrl up gives the Pen back`, back.tool, 'pen');
  c.eq(`${name}: at its own width`, back.width, width);
  await stillDraws(io, name);
});

await sequence('Ctrl held on the Pen while the pointer moves lends Select', async (io) => {
  const name = 'Ctrl held on the Pen while the pointer moves lends Select';
  await io.tool('tool-pen');
  await io.hover(io.at(0.4, 0.4));
  await io.down('Control');
  await sleep(100);
  await io.hover(io.at(0.42, 0.43));
  await sleep(1300);
  const s = await io.state();
  c.ok(`${name}: the move cancels the nib-rotate's hold`, !s.nibRotateActive && s.nib === 'off', JSON.stringify({ nib: s.nib }));
  c.eq(`${name}: and Select is in hand instead`, s.tool, 'select');
  await io.up('Control');
  await sleep(100);
  c.eq(`${name}: until Ctrl comes up`, (await io.state()).tool, 'pen');
  await stillDraws(io, name);
});

// ---- A bare Alt and the menu bar ---------------------------------------------------------

/** Whether the page kept the focus: the menu bar taking the keyboard is a blur the page sees. */
const keptFocus = (io) => io.eval('return { focus: document.hasFocus(), blurs: window.__blurs };');

await sequence(
  'Alt soon after another key leaves the menu bar alone',
  async (io) => {
    const name = 'Alt soon after another key leaves the menu bar alone';
    c.ok(`${name}: the window has the focus to begin with`, (await keptFocus(io)).focus);
    await io.tap('Shift');
    await sleep(300);
    await io.tap('Alt');
    await sleep(500);
    const after = await keptFocus(io);
    c.ok(`${name}: the page keeps the focus`, after.focus && after.blurs === 0, JSON.stringify(after));
  },
  { focusEmulation: false },
);

await sequence(
  'Alt with a scroll leaves the menu bar alone',
  async (io) => {
    const name = 'Alt with a scroll leaves the menu bar alone';
    // Idle keys first, so only the scroll can be what keeps the menu bar out.
    await sleep(5200);
    const p = io.at(0.5, 0.5);
    await io.hover(p);
    await io.down('Alt');
    await io.wheel(p, -120);
    await io.up('Alt');
    await sleep(500);
    const after = await keptFocus(io);
    c.ok(`${name}: the page keeps the focus`, after.focus && after.blurs === 0, JSON.stringify(after));
    c.ok(`${name}: and the scroll zoomed`, (await io.view()).zoom > 1);
  },
  { focusEmulation: false },
);

await sequence(
  'Alt after five idle seconds opens the menu bar',
  async (io) => {
    const name = 'Alt after five idle seconds opens the menu bar';
    await io.tap('Shift');
    await sleep(5200);
    await io.tap('Alt');
    await sleep(500);
    const after = await keptFocus(io);
    c.ok(`${name}: the menu bar takes the keyboard from the page`, !after.focus || after.blurs > 0, JSON.stringify(after));
  },
  { focusEmulation: false },
);

process.exit(c.summary() ? 0 : 1);
