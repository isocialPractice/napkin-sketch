/**
 * Keyboard shortcuts, from the menu registry, in the running app.
 *
 * The check puts a user shortcuts file in the app's user-data folder before
 * it starts - Mirror moved from O to Ctrl+M - and then reads what that one
 * file reaches: the Mirror button's tooltip, the menu bar's Mirror row, and
 * the keys themselves, the new one opening the palette and the old one doing
 * nothing. Around it: tooltips of shipped shortcuts and of a command with
 * none, the letter keys choosing tools, Shift and a letter still meaning the
 * letter, a text field keeping its keys, Enter standing aside with nothing to
 * move, Ctrl+R opening Rotate's quick form, and F5 refusing to reload.
 *
 * The app runs with a user-data folder of the check's own, made for the run and
 * removed after it, so no one's settings or menu files are touched.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

const userData = mkdtempSync(join(tmpdir(), 'napkin-shortcuts-'));
writeFileSync(join(userData, 'shortcuts.json'), `${JSON.stringify({ version: 1, shortcuts: { mirror: 'Ctrl+M' } }, null, 2)}\n`);

const app = launch(
  {
    mode: 'new',
    sketchName: 'shortcuts',
    importFiles: [resolve(import.meta.dirname, '..', 'imports', 'mirror-triangle.svg')],
  },
  { NAPKIN_USER_DATA: userData },
);

const STATE = `return {
  tool: document.getElementById('canvas').dataset.tool,
  toast: document.getElementById('toast').textContent,
  mirror: !document.getElementById('mirror-dialog').classList.contains('is-hidden'),
  move: !document.getElementById('move-dialog').classList.contains('is-hidden'),
  rotate: !document.getElementById('rotate-dialog').classList.contains('is-hidden'),
  rotateMsg: document.getElementById('rotate-msg').textContent,
  renaming: document.querySelector('.layer-name-input') !== null,
};`;
const title = (id) => `return document.getElementById(${JSON.stringify(id)}).title;`;
const clearToast = "document.getElementById('toast').textContent = ''; return true;";

function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn('document.activeElement?.blur(); return true;');
  const state = () => page.evalIn(STATE);

  // ---- Tooltips and the menu bar -----------------------------------------------------------
  c.eq('a shipped shortcut is in its tooltip', await page.evalIn(title('tool-pen')), 'Brush (B)');
  c.eq('Redo shows its main shortcut', await page.evalIn(title('redo')), 'Redo (Ctrl+Shift+Z)');
  c.eq(
    'a command with no shortcut loses the slot in its tooltip',
    await page.evalIn(title('tool-fill')),
    'Fill Color - fill the selected element with the selected color',
  );
  c.eq(
    "the user file's shortcut is in Mirror's tooltip",
    await page.evalIn(title('mirror-selection')),
    'Mirror the selection horizontally or vertically, in place or as a copy (Ctrl+M)',
  );
  const mirrorRow = rowOf(await page.evalIn('return await window.napkin.getAppMenu();'), 'mirror');
  c.ok(
    "and in the menu bar's Mirror row",
    mirrorRow?.accelerator === 'CmdOrCtrl+M' && mirrorRow?.registerAccelerator === false,
    JSON.stringify(mirrorRow),
  );

  // ---- A moved shortcut: the new key works, the old one is dead ---------------------------
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(300);
  await page.chord(79, 'o'); // O, Mirror's shipped key
  await sleep(400);
  c.eq('O no longer opens Mirror', (await state()).mirror, false);
  // Closed either way before Ctrl+M, so what Ctrl+M shows is its own doing.
  if ((await state()).mirror) {
    await page.chord(27, 'Escape');
    await sleep(300);
  }
  await page.chord(77, 'm', 2); // Ctrl+M
  await sleep(400);
  c.eq('Ctrl+M does', (await state()).mirror, true);
  await page.chord(27, 'Escape');
  await sleep(300);
  c.eq('and Escape closes it', (await state()).mirror, false);

  // ---- The Transform button, beside Mirror --------------------------------------------------------
  const transformButton = () =>
    page.evalIn(`
      const b = document.getElementById('transform-selection');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { title: b.title, pressed: b.classList.contains('is-open'), aria: b.getAttribute('aria-pressed'), x: r.left + r.width / 2, y: r.top + r.height / 2, afterMirror: b.previousElementSibling?.id === 'mirror-selection' };`);
  let transform = await transformButton();
  c.ok('the toolbar has a Transform button beside Mirror', transform?.afterMirror === true, JSON.stringify(transform));
  c.ok("and its tooltip shows Transform Box's shortcut", !!transform && transform.title.includes('(Ctrl+T)'), transform?.title);
  if (transform) {
    await page.evalIn(clearToast);
    await page.click(transform.x, transform.y);
    await sleep(400);
    transform = await transformButton();
    c.ok('a click puts the box up round the selection', (await state()).toast.startsWith('Transform: drag a handle'), (await state()).toast);
    c.ok('and presses the button', transform.pressed && transform.aria === 'true', JSON.stringify(transform));
    await page.click(transform.x, transform.y);
    await sleep(400);
    transform = await transformButton();
    c.ok('a second click takes the box away and lets the button up', !transform.pressed && transform.aria === 'false', JSON.stringify(transform));
  }

  // ---- Letters choose tools ---------------------------------------------------------------------
  await page.chord(69, 'e'); // E
  await sleep(300);
  c.eq('E takes the eraser', (await state()).tool, 'eraser');
  await page.chord(66, 'b'); // B
  await sleep(300);
  c.eq('B takes the brush', (await state()).tool, 'pen');
  await page.chord(80, 'p'); // P
  await sleep(300);
  c.eq('P takes Vector Path', (await state()).tool, 'vector');
  await page.chord(66, 'B', 8); // Shift+B
  await sleep(300);
  c.eq('Shift+B still takes the brush, as Shift+P took the pen', (await state()).tool, 'pen');
  await page.chord(77, 'm'); // M
  await sleep(300);
  c.eq('M takes the marker', (await state()).tool, 'marker');

  // ---- A text field keeps its keys --------------------------------------------------------------
  await page.chord(113, 'F2'); // F2
  await sleep(400);
  c.ok('F2 opens the layer rename box', (await state()).renaming);
  await page.chord(80, 'p'); // P, typed into the box
  await sleep(300);
  c.eq('and a letter typed there picks no tool', (await state()).tool, 'marker');
  await page.chord(27, 'Escape');
  await sleep(300);

  // ---- Keys that stand aside, and keys Chromium would take ---------------------------------
  await page.evalIn('document.activeElement?.blur(); return true;');
  await page.chord(65, 'a', 2 | 8); // Ctrl+Shift+A: select nothing
  await sleep(300);
  await page.evalIn(clearToast);
  await page.chord(13, 'Enter');
  await sleep(300);
  const idle = await state();
  c.ok('Enter with nothing to move opens nothing and says nothing', !idle.move && idle.toast === '', JSON.stringify(idle));
  await page.chord(65, 'a', 2);
  await sleep(300);
  await page.chord(13, 'Enter');
  await sleep(400);
  c.ok('with something selected, Enter opens Move', (await state()).move);
  await page.chord(27, 'Escape');
  await sleep(300);

  await page.chord(82, 'r', 2); // Ctrl+R
  await sleep(400);
  const rotate = await state();
  c.ok('Ctrl+R opens Rotate in its quick form', rotate.rotate && /Drag on the canvas/.test(rotate.rotateMsg), rotate.rotateMsg);
  await page.chord(27, 'Escape');
  await sleep(300);

  await page.chord(116, 'F5'); // F5
  await sleep(500);
  c.ok('F5 refuses to reload, and says why', /^Reload is off here/.test((await state()).toast), (await state()).toast);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
