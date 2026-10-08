/**
 * The gumball and 3D Options in the app.
 *
 * The book is a blue card built in 3D - `effect extrude` - on white paper,
 * beside a plain square. Nothing selected, no gumball; the card selected, it
 * stands on the card, and the arrow under the pointer is lit, with a move
 * cursor. Dragging the X arrow moves the card along its X - the picture with
 * it - as one undo step, which Track History names for 3D Options; Escape
 * halfway puts it back and keeps no step. The Y arc turns it, the X box
 * scales it along X. A double-click on the ball opens 3D Options, whose
 * fields follow a drag; a depth typed in shows at once and is one undo step,
 * and a drag on its cube turns the card. Closed, the panel opens again from
 * the 3D's row in the Appearance panel. The Transform Box takes the gumball's
 * place while it is up, and Show the 3D gumball off hides it. Apply Last
 * Effect gives the square the card's 3D as the cube left it, and Effect > 3D
 * > Extrude builds the square at once, as one step, with the panel on it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-gumball-check-'));
const TIME = '2026-10-02T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const result = evaluate(
  [
    'napkin 1',
    'page 720 440',
    'background #ffffff',
    'layer "Card"',
    'color #1f2328 width 2 fill #2f6feb',
    'effect extrude',
    'rect 150 150 200 120',
    'layer "Square"',
    'color #1f2328 width 2 fill #e8590c',
    'rect 520 160 90 90',
  ].join('\n'),
  { name: 'gumball', timestamp: TIME },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'gumball.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const [CARD, SQUARE] = result.book.sketches[0].strokes.map((s) => s.id);

/** The canvas's color at a page point, as [r, g, b], after two frames. */
const PIXEL = (x, y) => `
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  const k = cv.width / r.width;
  const d = cv.getContext('2d').getImageData(Math.round((v.panX + ${x} * v.zoom) * k), Math.round((v.panY + ${y} * v.zoom) * k), 1, 1).data;
  return [d[0], d[1], d[2]];
`;
const CLIENT = (x, y) => `
  const r = document.getElementById('canvas').getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };
`;
const paper = (rgb) => rgb.every((v) => v > 235);
const blueish = (rgb) => rgb[2] > rgb[0] + 40 && rgb[2] > 90;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const app = launch({ mode: 'book', filePath: bookPath });
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

  const evalIn = (code) => page.evalIn(code);
  const client = (x, y) => evalIn(CLIENT(x, y));
  const pixel = (x, y) => evalIn(PIXEL(x, y));
  const gumball = () => evalIn('return window.napkinCheck.gumballState();');
  const panel = () => evalIn('return window.napkinCheck.threeDPanelState();');
  const effectOf = async (id) => (await evalIn(`return window.napkinCheck.effectsOf(${JSON.stringify(id)});`))?.mark?.find((e) => e.type === '3d') ?? null;
  const boundsOf = async (id) => (await evalIn('return window.napkinCheck.strokeSummary();')).find((s) => s.id === id)?.bounds ?? null;
  const key = async (key, code, vk, modifiers = 0, wait = 400) => {
    for (const type of ['rawKeyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    await sleep(wait);
  };
  const undo = () => key('z', 'KeyZ', 90, 2, 700);
  const clickPage = async (x, y) => {
    const at = await client(x, y);
    await page.click(at.x, at.y);
    await sleep(400);
  };
  const mouse = (type, p, buttons = 0, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1, ...extra });
  /** A grip of the gumball, in client pixels. */
  const grip = async (kind, axis) => {
    const found = (await gumball()).grips.find((g) => g.kind === kind && (axis === undefined || g.axis === axis));
    return found ? client(found.x, found.y) : null;
  };
  /** A press at `from`, moved to `to` in steps, then let go - or, with `before`, something done while it is held. */
  async function drag(from, to, { steps = 8, modifiers = 0, before = null } = {}) {
    await mouse('mouseMoved', from);
    await mouse('mousePressed', from, 1, { modifiers });
    for (let k = 1; k <= steps; k++) {
      await mouse('mouseMoved', { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps }, 1, { modifiers });
      await sleep(25);
    }
    if (before) await before();
    await mouse('mouseReleased', to, 0, { modifiers });
    await sleep(500);
  }

  // ---- Shown on a selected 3D mark ----------------------------------------------------------
  // Track History names each step, a gumball drag among them.
  await evalIn("return await window.napkin.clickAppMenuItem('track-history');");
  await sleep(300);
  c.eq('nothing selected, no gumball', (await gumball()).shown, false);
  await clickPage(250, 210);
  let state = await gumball();
  c.ok('the card selected, the gumball stands on it', state.shown && state.id === CARD && Math.hypot(state.center.x - 250, state.center.y - 210) < 2, JSON.stringify(state.center));
  c.ok('with an arrow, a box, a square and an arc for each axis, and the ball and the ring', ['arrow', 'tip', 'plane', 'arc'].every((kind) => state.grips.filter((g) => g.kind === kind).length === 3) && state.grips.some((g) => g.kind === 'center') && state.grips.some((g) => g.kind === 'ring'), state.grips.map((g) => `${g.kind}${g.axis ?? ''}`).join(' '));
  const xArrow = await grip('arrow', 0);
  await mouse('mouseMoved', xArrow);
  await sleep(300);
  state = await gumball();
  c.ok('the X arrow under the pointer is lit, with a move cursor', same(state.lit, { kind: 'arrow', axis: 0 }) && (await evalIn('return document.getElementById("canvas").style.cursor;')) === 'move', JSON.stringify(state.lit));

  // ---- The X arrow moves it along X, the picture with it, as one step ------------------------
  const before = await boundsOf(CARD);
  const probe = { x: before.maxX + 25, y: (before.minY + before.maxY) / 2 };
  c.ok('the paper shows just right of the card', paper(await pixel(probe.x, probe.y)));
  const toward = state.grips.find((g) => g.kind === 'arrow' && g.axis === 0);
  const unit = Math.hypot(toward.x - state.center.x, toward.y - state.center.y);
  const along = { x: ((toward.x - state.center.x) / unit) * 60, y: ((toward.y - state.center.y) / unit) * 60 };
  // Halfway through, Escape puts it back.
  await drag(xArrow, { x: xArrow.x + along.x, y: xArrow.y + along.y }, { before: () => key('Escape', 'Escape', 27, 0, 300) });
  c.eq('Escape halfway through a drag puts the card back', JSON.stringify((await effectOf(CARD))?.position), '[0,0,0]');
  c.eq('and lets go of the pointer', JSON.stringify((await evalIn('return window.napkinCheck.inputState();')).press), '[]');
  await drag(xArrow, { x: xArrow.x + along.x, y: xArrow.y + along.y });
  let effect = await effectOf(CARD);
  c.ok("dragging the X arrow moves the card along its own X", effect.position[0] > 40 && Math.abs(effect.position[0]) > Math.abs(effect.position[1]), JSON.stringify(effect.position));
  const after = await boundsOf(CARD);
  c.ok('its box goes with it', after.maxX - before.maxX > 40, `${before.maxX} to ${after.maxX}`);
  c.ok('and the picture: the card covers where the paper was', blueish(await pixel(probe.x, probe.y)));
  state = await gumball();
  c.ok('the gumball stands where the card went', state.center.x - 250 > 40, JSON.stringify(state.center));
  const steps = await evalIn('return window.napkinCheck.trackedSteps();');
  c.ok('the drag is one step, named for 3D Options, that changed the card', steps.length === 1 && steps[0].command === 'effect-3d-options' && steps[0].label === '3D Options' && steps[0].changed === 1, JSON.stringify(steps));
  await undo();
  c.eq('one undo takes the whole drag back', JSON.stringify((await effectOf(CARD))?.position), '[0,0,0]');
  c.ok('and the paper shows again', paper(await pixel(probe.x, probe.y)));

  // ---- The Y arc turns it; the X box scales it ----------------------------------------------
  await clickPage(250, 210);
  const turnedFrom = (await effectOf(CARD)).rotation;
  const yArc = await grip('arc', 1);
  await drag(yArc, { x: yArc.x + 30, y: yArc.y + 6 });
  effect = await effectOf(CARD);
  c.ok('dragging the Y arc turns the card', !same(effect.rotation, turnedFrom), `${JSON.stringify(turnedFrom)} to ${JSON.stringify(effect.rotation)}`);
  c.eq('and moves and scales it not at all', JSON.stringify([effect.position, effect.scale]), '[[0,0,0],[1,1,1]]');
  const xTip = await grip('tip', 0);
  const centerClient = await client((await gumball()).center.x, (await gumball()).center.y);
  await drag(xTip, { x: centerClient.x + (xTip.x - centerClient.x) * 1.5, y: centerClient.y + (xTip.y - centerClient.y) * 1.5 });
  effect = await effectOf(CARD);
  c.ok('dragging the X box out half as far again scales X by half again', Math.abs(effect.scale[0] - 1.5) < 0.05 && effect.scale[1] === 1 && effect.scale[2] === 1, JSON.stringify(effect.scale));

  // ---- 3D Options: opened from the ball, its fields follow ------------------------------------
  const ball = await client((await gumball()).center.x, (await gumball()).center.y);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ball.x, y: ball.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ball.x, y: ball.y, button: 'left', buttons: 0, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ball.x, y: ball.y, button: 'left', buttons: 1, clickCount: 2 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ball.x, y: ball.y, button: 'left', buttons: 0, clickCount: 2 });
  await sleep(900);
  let fields = await panel();
  c.ok('a double-click on the ball opens 3D Options on the card', fields.open && fields.title === 'Path: Extrude', JSON.stringify([fields.open, fields.title]));
  const percent = (share) => String(Math.round(share * 100 * 1000) / 1000);
  c.ok('which shows the scale and the turn the gumball gave it', fields.fields['scale.0'] === percent(effect.scale[0]) && fields.fields['rotation.1'] === String(effect.rotation[1]), JSON.stringify(fields.fields));
  c.eq('and the double-click moved nothing', JSON.stringify((await effectOf(CARD))?.position), '[0,0,0]');
  // The Y arrow, pointing down the page whatever the turn about Y, dragged as far again as it is long.
  state = await gumball();
  const yGrip = state.grips.find((g) => g.kind === 'arrow' && g.axis === 1);
  await drag(await client(yGrip.x, yGrip.y), await client(yGrip.x + (yGrip.x - state.center.x), yGrip.y + (yGrip.y - state.center.y)));
  effect = await effectOf(CARD);
  fields = await panel();
  c.ok('a drag of the Y arrow shows in the panel as it is', effect.position[1] > 20 && fields.fields['position.1'] === String(effect.position[1]), JSON.stringify([effect.position, fields.fields['position.1']]));

  // A depth typed in shows at once, and is one undo step.
  await evalIn(`const f = document.getElementById('three-d-field-depth'); f.focus(); f.value = '80'; f.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  await sleep(400);
  c.eq('a depth typed into the panel builds the card that deep at once', (await effectOf(CARD))?.depth, 80);
  await evalIn(`const f = document.getElementById('three-d-field-depth'); f.dispatchEvent(new Event('change', { bubbles: true })); f.blur(); return true;`);
  await sleep(400);
  await undo();
  c.eq('and one undo takes it back', (await effectOf(CARD))?.depth, 50);

  // The cube turns it.
  await clickPage(250, 210);
  const turnedBefore = (await effectOf(CARD)).rotation;
  const cube = await evalIn(`const r = document.getElementById('three-d-cube').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  await drag(cube, { x: cube.x + 30, y: cube.y }, { steps: 6 });
  const turnedAfter = (await effectOf(CARD)).rotation;
  c.ok('a drag on the cube turns the card', !same(turnedAfter, turnedBefore), `${JSON.stringify(turnedBefore)} to ${JSON.stringify(turnedAfter)}`);
  c.eq('and the cube shows the turn', JSON.stringify((await panel()).rotation), JSON.stringify(turnedAfter));

  // Closed, it opens again from the 3D's row in the Appearance panel.
  await evalIn("document.getElementById('three-d-close').click(); return true;");
  await sleep(400);
  c.eq('3D Options closes from its close button', (await panel()).open, false);
  await key('F6', 'F6', 117, 8, 600);
  await evalIn("const row = [...document.querySelectorAll('#appearance-rows .appearance-row.is-effect')].find((r) => r.textContent.includes('3D')); row?.querySelector('.appearance-fx')?.click(); return true;");
  await sleep(600);
  c.eq("the fx of the card's 3D row in the Appearance panel opens it", (await panel()).open, true);
  await key('F6', 'F6', 117, 8, 600);

  // ---- The Transform Box takes its place; the setting hides it ----------------------------------
  await clickPage(250, 210);
  await key('t', 'KeyT', 84, 2, 500);
  c.eq('with the Transform Box up, the gumball goes', (await gumball()).shown, false);
  await key('Escape', 'Escape', 27, 0, 500);
  c.eq('and comes back when it goes', (await gumball()).shown, true);
  await evalIn('return window.napkin.updateSettings({ show3dGumball: false }).then(() => true);');
  await sleep(600);
  c.eq('Show the 3D gumball off hides it', (await gumball()).shown, false);
  await evalIn('return window.napkin.updateSettings({ show3dGumball: true }).then(() => true);');
  await sleep(600);
  c.eq('and on shows it again', (await gumball()).shown, true);

  // ---- Apply Last Effect, then Effect > 3D > Extrude, on the square ----------------------------
  await clickPage(565, 205);
  c.eq('the square, not built, has no gumball', (await gumball()).shown, false);
  fields = await panel();
  c.ok('and the panel offers to build it', fields.adding && fields.title === 'Path', JSON.stringify([fields.adding, fields.title]));
  await key('E', 'KeyE', 69, 2 | 8, 800);
  c.eq("Apply Last Effect builds it with the card's 3D as the cube left it", JSON.stringify((await effectOf(SQUARE))?.rotation), JSON.stringify(turnedAfter));
  await undo();
  await clickPage(565, 205);
  await evalIn("return await window.napkin.clickAppMenuItem('effect-3d-extrude');");
  await sleep(800);
  c.eq('Effect > 3D > Extrude builds it at once', (await effectOf(SQUARE))?.kind, 'extrude');
  fields = await panel();
  c.ok('the panel shows its 3D, and the gumball stands on it', fields.title === 'Path: Extrude' && !fields.adding && (await gumball()).id === SQUARE, JSON.stringify([fields.title, fields.adding]));
  await undo();
  c.eq('one undo takes the 3D off', await effectOf(SQUARE), null);

  c.eq('no page errors', JSON.stringify(await evalIn('return window.__errors;')), '[]');
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
