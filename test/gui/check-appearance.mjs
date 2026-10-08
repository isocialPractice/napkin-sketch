/**
 * The Appearance panel, the Effect menu and the effect options popup, driven
 * as a person drives them.
 *
 * The book is two filled squares on white paper. The first is selected, and
 * `Shift+F6` opens the panel, docked: Path, its Stroke and its Fill. With the
 * Fill row selected, the panel's fx drops the Effect menu's rows down, and
 * Stylize > Outer Glow opens its options, aimed at the fill, with Preview on.
 * A red glow is set and widened, and the canvas shows it as each field
 * changes; Cancel puts back every pixel and leaves no undo step. The Effect
 * menu opens the glow again, and OK keeps it as one undo step. A Gaussian
 * Blur goes on the whole mark. A drag puts the blur on the fill, above the
 * glow; the eye switches the glow off and on; the right-click menu moves it to
 * the whole mark. Clear Appearance takes both off, and one undo puts them back.
 * Apply Last Effect adds the blur again. An Outer Shadow to the right turns
 * down with the mark when Rotate turns it a quarter. Move opens with the panel
 * up. The Properties panel counts the effects. Use Preview Bounds widens the
 * selection box by what the shadow paints, and a click on the shadow picks
 * the mark.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-appearance-check-'));
const TIME = '2026-10-01T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

function bookOf(name, lines) {
  const result = evaluate(lines.join('\n'), { name, timestamp: TIME });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  const path = join(dir, `${name}.skbk`);
  writeFileSync(path, renderBook(result.book, { format: 'skbk' }));
  return { path, book: result.book };
}

const squares = bookOf('appearance', [
  'napkin 1',
  'page 800 600',
  'background #ffffff',
  'layer "Card"',
  'color #1f2328 width 4 fill #ffe08a',
  'rect 200 150 200 160',
  'layer "Other"',
  'color #1f2328 width 2 fill #8ab4ff',
  'rect 520 200 120 120',
]);
const CARD = squares.book.sketches[0].strokes[0].id;

/**
 * How many canvas pixels are reddish: red well above green and blue. A red
 * glow fades into the white paper as pink, so a glow is counted by how red it
 * leans rather than by one color; the yellow card and the blue square lean
 * neither way far enough to count.
 */
const REDDISH = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] - d[i + 1] > 50 && d[i] - d[i + 2] > 50) n++;
  }
  return n;
`;

/** Keeps every canvas pixel, for CHANGED to compare with. */
const SNAPSHOT = `
  const cv = document.getElementById('canvas');
  window.__snapshot = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.slice();
  return true;
`;

/**
 * How many canvas channels differ from the snapshot by more than 8. Reading
 * a canvas back again and again can move it from the GPU to software drawing,
 * and the two smooth the paper's faint dots a little differently - by 3 at
 * most - which no eye sees; what an effect leaves behind is far more.
 */
const CHANGED = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const s = window.__snapshot;
  if (!s || s.length !== d.length) return { n: -1 };
  let n = 0;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i] - s[i]) > 8) n++;
  return { n };
`;

/** A page point as a client point, wherever the canvas is panned and zoomed now. */
const CLIENT = (x, y) => `
  const r = document.getElementById('canvas').getBoundingClientRect();
  const v = window.napkinCheck.viewState();
  return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };
`;

/** The middle of the first element a selector finds, or null. */
const CENTER = (selector) => `
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, height: r.height };
`;

/** An in-window menu's rows as text, or null while it is hidden. */
const ROWS = (id) => `
  const menu = document.getElementById('${id}');
  if (!menu || menu.classList.contains('is-hidden')) return null;
  return [...menu.children].map((node) => {
    if (node.classList.contains('context-menu-sep')) return '---';
    return (node.querySelector('.context-menu-label')?.textContent ?? '') + (node.disabled ? ' (disabled)' : '') + (node.classList.contains('has-submenu') ? ' >' : '');
  });
`;
const ROW_CENTER = (menuId, label) => `
  const row = [...document.getElementById('${menuId}').querySelectorAll('button')]
    .find((b) => (b.querySelector('.context-menu-label')?.textContent ?? '').startsWith(${JSON.stringify(label)}));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
`;

const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

const app = launch({ mode: 'book', filePath: squares.path });
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
  const state = () => evalIn('return window.napkinCheck.appearanceState();');
  const options = () => evalIn('return window.napkinCheck.effectOptionsState();');
  const effects = async () => (await evalIn(`return window.napkinCheck.effectsOf(${JSON.stringify(CARD)});`)).mark;
  const kinds = async () => (await effects()).map((e) => `${e.type}@${e.target ?? 'object'}${e.on === false ? ':off' : ''}`).join(', ');
  const bar = () => evalIn('return await window.napkin.getAppMenu();');
  const canUndo = async () => rowOf(menuOf(await bar(), 'Edit'), 'undo')?.enabled !== false;
  const menu = async (id, wait = 450) => {
    const ran = await evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
    await sleep(wait);
    return ran;
  };
  const key = async (key, code, vk, modifiers = 0, wait = 400) => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    }
    await sleep(wait);
  };
  const clickAt = async ({ x, y }, wait = 300) => {
    await page.click(x, y);
    await sleep(wait);
  };
  const hover = async ({ x, y }) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(250);
  };
  const domClick = async (selector, wait = 300) => {
    const found = await evalIn(`const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.click(); return true;`);
    await sleep(wait);
    return found;
  };
  const setOption = async (field, value) => {
    const ok = await evalIn(`return window.napkinCheck.setEffectOption(${JSON.stringify(field)}, ${JSON.stringify(value)});`);
    await sleep(350);
    return ok;
  };
  const RED = REDDISH;
  // The pointer's place shows on the canvas - a mark under it is outlined -
  // so it is parked on the panel before a fingerprint is taken.
  const park = async () => hover(await evalIn(CENTER('#appearance-title')));
  /** The pointer parked and the canvas let draw. */
  const settle = async () => {
    await park();
    await sleep(300);
  };
  /** Picks the card again: an undo or a redo leaves nothing selected. */
  const pickCard = async () => {
    await clickAt(await evalIn(CLIENT(300, 230)));
    await park();
  };

  // ---- The panel, opened -----------------------------------------------------------

  await key('s', 'KeyS', 83);
  await clickAt(await evalIn(CLIENT(300, 230)));
  c.eq('the card is selected', JSON.stringify(await evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);')), JSON.stringify([CARD]));

  const view = rowOf(menuOf(await bar(), 'View'), 'toggle-appearance');
  c.ok('View has Toggle Appearance Panel, on Shift+F6', view?.label === 'Toggle Appearance Panel' && /Shift\+F6/.test(view?.accelerator ?? ''), JSON.stringify(view));
  const effectMenu = menuOf(await bar(), 'Effect');
  c.ok('the menu bar has an Effect menu, after Transform', (await bar()).map((m) => m.label).join(' ').includes('Transform Effect Type Sketch'));
  c.ok('Apply Last Effect is greyed until an effect is kept', rowOf(effectMenu, 'apply-last-effect')?.enabled === false);

  await key('F6', 'F6', 117, 8, 600);
  let panel = await state();
  const docked = await evalIn("return window.napkinCheck.panelState('appearance-dialog');");
  c.ok('Shift+F6 opens the Appearance panel', panel.open === true);
  c.ok('docked beside the canvas the first time', docked?.docked === true && docked?.open === true, JSON.stringify(docked));
  await sleep(300);
  const fit = await evalIn("const cv = document.getElementById('canvas'); const stage = document.getElementById('stage').getBoundingClientRect(); return { buffer: cv.width, wanted: Math.round(stage.width * window.devicePixelRatio) };");
  c.ok('the canvas is drawn for the narrower stage once the dock has opened', Math.abs(fit.buffer - fit.wanted) <= 1, JSON.stringify(fit));
  c.eq('its first row names the selection', panel.title, 'Path');
  c.eq('then the Stroke and the Fill', panel.rows.map((r) => `${r.kind}:${r.target}`).join(' '), 'paint:stroke paint:fill');
  c.ok('the Stroke row says its color and width', /#1F2328, 4 px/.test(panel.rows[0].text), panel.rows[0].text);
  c.eq('the Opacity row reads the layer', `${panel.opacity} ${panel.blend}`, '100 normal');
  c.ok('Clear, Duplicate and Delete wait for an effect', !panel.buttons.clear && !panel.buttons.duplicate && !panel.buttons.delete && panel.buttons.add);

  // ---- Add New Effect, on the fill, with Preview: then Cancel ------------------------

  await domClick('#appearance-rows .appearance-row.is-paint[data-target="fill"]');
  panel = await state();
  c.ok('selecting the Fill row aims a new effect at the fill', panel.addTarget === 'fill' && panel.rows[1].selected);

  await settle();
  await evalIn(SNAPSHOT);
  await clickAt(await evalIn(CENTER('#appearance-add')));
  c.eq('the panel fx drops the Effect menu add rows down', (await evalIn(ROWS('context-menu')))?.join(' | '), 'Blur > | Adjust Colors > | Stylize > | Warp > | 3D >');
  await hover(await evalIn(ROW_CENTER('context-menu', 'Stylize')));
  const stylize = (await evalIn(ROWS('context-submenu'))) ?? [];
  c.ok('Stylize holds the seven', stylize.join('|').startsWith('Feather…|Outer Shadow…|Inner Shadow…|Outer Glow…|Inner Glow…|Bevel…|Emboss…'), stylize.join(' | '));
  await clickAt(await evalIn(ROW_CENTER('context-submenu', 'Outer Glow')), 500);
  let opts = await options();
  c.ok('Outer Glow opens its options', opts.open && opts.title === 'Outer Glow', JSON.stringify(opts));
  c.eq('its fields, as a vector editor orders them', opts.fields.join(' '), 'blend opacity blur spread color');
  c.ok('aimed at the fill, with Preview on', opts.effect?.target === 'fill' && opts.preview === true);
  c.eq('the preview is on the card already', await kinds(), 'outer-glow@fill');

  await setOption('blend', 'normal');
  await setOption('opacity', 1);
  await setOption('color', '#d0342c');
  await setOption('blur', 12);
  const narrow = await evalIn(RED);
  await setOption('blur', 30);
  const wide = await evalIn(RED);
  c.ok('the preview paints the red glow', narrow > 500, `${narrow} red pixels`);
  c.ok('and widens it as Blur goes up', wide > narrow * 1.3, `${narrow} then ${wide}`);
  await domClick('#effect-options-cancel', 600);
  c.eq('Cancel takes the effect off', await kinds(), '');
  await settle();
  const changed = await evalIn(CHANGED);
  c.eq('and puts back every pixel', changed.n, 0);
  c.ok('leaving no undo step', (await canUndo()) === false);
  c.ok('the popup closes', (await options()).open === false);

  // ---- The Effect menu, and OK as one undo step --------------------------------------

  await menu('effect-outer-glow', 600);
  opts = await options();
  c.ok('Effect > Stylize > Outer Glow opens the options too, still aimed at the fill', opts.open && opts.effect?.target === 'fill');
  await setOption('blend', 'normal');
  await setOption('opacity', 1);
  await setOption('color', '#d0342c');
  await setOption('blur', 10);
  await domClick('#effect-options-ok', 600);
  c.eq('OK keeps it', await kinds(), 'outer-glow@fill');
  c.ok('the canvas shows it', (await evalIn(RED)) > 500);
  await key('z', 'KeyZ', 90, 2, 500);
  c.eq('one undo takes it away', await kinds(), '');
  c.ok('and that was the only step', (await canUndo()) === false);
  await key('z', 'KeyZ', 90, 10, 500);
  c.eq('redo puts it back', await kinds(), 'outer-glow@fill');
  await pickCard();
  panel = await state();
  c.ok('the panel lists it under the Fill row', panel.rows.map((r) => `${r.kind}:${r.name}:${r.nested}`).join(' ') === 'paint:Stroke::false paint:Fill::false effect:Outer Glow:true', JSON.stringify(panel.rows));
  c.ok('Apply Last Effect works now', rowOf(menuOf(await bar(), 'Effect'), 'apply-last-effect')?.enabled !== false);

  // A Gaussian Blur on the whole mark: a click on the panel's empty space aims at the whole.
  await evalIn("const rows = document.getElementById('appearance-rows'); rows.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true;");
  c.eq('a click on the empty space aims at the whole again', (await state()).addTarget, 'object');
  await menu('effect-gaussian-blur', 600);
  await setOption('radius', 2);
  await domClick('#effect-options-ok', 600);
  c.eq('Gaussian Blur goes on the whole', await kinds(), 'outer-glow@fill, blur@object');

  // ---- Reorder, the eye, the right-click menu ------------------------------------------

  const blurRow = await evalIn(CENTER('#appearance-rows .appearance-row.is-effect[data-index="1"] .appearance-name'));
  const glowRow = await evalIn(CENTER('#appearance-rows .appearance-row.is-effect[data-index="0"]'));
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: blurRow.x, y: blurRow.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 6; k++) {
    const y = blurRow.y + ((glowRow.top + glowRow.height * 0.25 - blurRow.y) * k) / 6;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: blurRow.x, y, button: 'left', buttons: 1 });
    await sleep(40);
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: blurRow.x, y: glowRow.top + glowRow.height * 0.25, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  c.eq('a drag onto the top of the glow puts the blur before it, on the fill', await kinds(), 'blur@fill, outer-glow@fill');

  await domClick('#appearance-rows .appearance-row.is-effect[data-index="1"] .appearance-eye', 500);
  c.eq('the eye switches the glow off', await kinds(), 'blur@fill, outer-glow@fill:off');
  c.ok('and the canvas loses it', (await evalIn(RED)) < 50, `${await evalIn(RED)} red pixels`);
  c.ok('its row says so', (await state()).rows.find((r) => r.index === 1)?.off === true);
  await domClick('#appearance-rows .appearance-row.is-effect[data-index="1"] .appearance-eye', 500);
  c.eq('and on again', await kinds(), 'blur@fill, outer-glow@fill');

  const glowAt = await evalIn(CENTER('#appearance-rows .appearance-row.is-effect[data-index="1"] .appearance-name'));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: glowAt.x, y: glowAt.y, button: 'right', clickCount: 1, buttons: type === 'mousePressed' ? 2 : 0 });
  }
  await sleep(300);
  c.eq(
    'a right-click offers Duplicate, Delete and the moves, its own target greyed',
    (await evalIn(ROWS('context-menu')))?.join(' | '),
    'Duplicate | Delete | --- | Move to Fill (disabled) | Move to Stroke | Move to Object',
  );
  await clickAt(await evalIn(ROW_CENTER('context-menu', 'Move to Object')), 500);
  c.eq('Move to Object aims it at the whole mark', await kinds(), 'blur@fill, outer-glow@object');

  // ---- Clear Appearance, and Apply Last Effect ---------------------------------------------

  await domClick('#appearance-clear', 500);
  c.eq('Clear Appearance takes every effect off', await kinds(), '');
  await key('z', 'KeyZ', 90, 2, 500);
  c.eq('one undo puts them all back', await kinds(), 'blur@fill, outer-glow@object');
  await pickCard();
  await domClick('#appearance-clear', 500);
  await key('E', 'KeyE', 69, 2 | 8, 500);
  c.eq('Ctrl+Shift+E adds the last effect kept again, as it was set', await kinds(), 'blur@object');
  c.eq('with its radius', (await effects())[0]?.radius, 2);

  // ---- An Outer Shadow turns with the mark ---------------------------------------------------

  await menu('effect-drop-shadow', 600);
  await setOption('dx', 12);
  await setOption('dy', 0);
  await setOption('blur', 0);
  await setOption('blend', 'normal');
  await setOption('opacity', 1);
  await setOption('color', '#2f6feb');
  await domClick('#effect-options-ok', 600);
  c.eq('an Outer Shadow to the right', JSON.stringify((await effects()).map((e) => [e.type, e.dx ?? null, e.dy ?? null])), JSON.stringify([['blur', null, null], ['drop-shadow', 12, 0]]));
  await menu('rotate', 600);
  await evalIn("const a = document.getElementById('rotate-angle'); a.value = '90'; a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); return true;");
  await domClick('#rotate-apply', 600);
  await key('Escape', 'Escape', 27, 0, 400);
  const turned = (await effects()).find((e) => e.type === 'drop-shadow');
  c.ok('Rotate turns the shadow with the mark: right becomes down', turned && Math.abs(turned.dx) < 1e-6 && Math.abs(turned.dy - 12) < 1e-6, JSON.stringify(turned));

  // ---- Move opens with the panel up --------------------------------------------------------

  await key('Enter', 'Enter', 13, 0, 500);
  const move = await evalIn("return window.napkinCheck.panelState('move-dialog');");
  c.ok('Move opens while the Appearance panel is up', move?.open === true, JSON.stringify(move));
  await key('Escape', 'Escape', 27, 0, 400);

  // ---- The Properties panel ------------------------------------------------------------------

  await key('p', 'KeyP', 80, 2, 500);
  c.eq('the Properties panel counts the effects', await evalIn("return document.getElementById('prop-effects').textContent;"), '2 effects');
  c.eq('and shows the opacity', await evalIn("return document.getElementById('prop-opacity').value;"), '100');

  // ---- Use Preview Bounds ----------------------------------------------------------------------

  const boxOf = async () => (await evalIn('return window.napkinCheck.selectionBoxes();')).find((b) => b.id === CARD);
  const tight = await boxOf();
  // Turned a quarter about its middle, the card runs from y 130 to 330, its
  // outline 2 past that; the shadow lies 12 below, so y 338 is shadow alone.
  const onShadow = await evalIn(CLIENT(300, 338));
  c.eq('a click on the shadow misses the card while the bounds are the ink', await evalIn(`return window.napkinCheck.hitAt(${onShadow.x}, ${onShadow.y}, 1);`), null);
  await evalIn('return window.napkin.updateSettings({ usePreviewBounds: true }).then(() => true);');
  await sleep(600);
  const wide2 = await boxOf();
  c.ok('Use Preview Bounds widens the box by what the effects paint', wide2.width > tight.width + 20 && wide2.height > tight.height + 20, `${tight.width}x${tight.height} then ${wide2.width}x${wide2.height}`);
  c.eq('and a click on the shadow picks the card', await evalIn(`return window.napkinCheck.hitAt(${onShadow.x}, ${onShadow.y}, 1);`), CARD);
  await evalIn('return window.napkin.updateSettings({ usePreviewBounds: false }).then(() => true);');

  // ---- Floating: the dock button and the close button ------------------------------------------

  await clickAt(await evalIn(CENTER('.appearance-panel .popup-dock-btn')), 500);
  const floating = await evalIn("return window.napkinCheck.panelState('appearance-dialog');");
  c.ok('the dock button floats the panel over the canvas', floating?.docked === false && floating?.open === true, JSON.stringify(floating));
  await clickAt(await evalIn(CENTER('#appearance-close')), 400);
  c.ok('its close button closes it, floating as it is', (await state()).open === false);
  await key('F6', 'F6', 117, 8, 500);
  const again = await evalIn("return window.napkinCheck.panelState('appearance-dialog');");
  c.ok('Shift+F6 opens it again as it was left, floating', again?.open === true && again?.docked === false, JSON.stringify(again));

  // ---- Shift+F6 closes it, and nothing threw -----------------------------------------------------

  await key('F6', 'F6', 117, 8, 500);
  c.ok('Shift+F6 closes the panel', (await state()).open === false);
  c.eq('no page errors', JSON.stringify(await evalIn('return window.__errors;')), '[]');
} catch (err) {
  c.ok(`no exception (${err.message})`, false);
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
