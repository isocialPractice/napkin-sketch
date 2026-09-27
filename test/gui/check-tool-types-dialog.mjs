/**
 * Edit Tool Types, in the running app.
 *
 * The editor is opened from the menu bar and used as a person would. The two
 * editors' own rows are listed but cannot move, and say why. Rotate is
 * retyped with the keyboard to the clipboard's type: the drop-down says where
 * that lists it before anything is kept, and after Accept the menu bar lists
 * Rotate under Edit and not Transform, the layers panel's right-click menu
 * lists it after the clipboard rows, and a click there still opens Rotate -
 * a type moves a tool, never changes what it does. Reset to defaults puts
 * Rotate back, and accepting it removes the user's file. A toolbar tool is
 * put in a menu and runs from there; Join taken out of every menu warns in
 * amber, and Cancel keeps nothing. The shipped tool types file is never
 * written.
 *
 * The app runs with a user-data folder of the check's own, made for the run
 * and removed after it, so no one's settings or menu files are touched.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SHIPPED = join(ROOT, 'src', 'core', 'menu', 'tool-types.json');
const shippedBefore = readFileSync(SHIPPED, 'utf8');
const TOOL_COUNT = JSON.parse(shippedBefore).tools.length;

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-tool-types-dialog-'));
const userFile = join(userData, 'tool-types.json');

const app = launch(
  {
    mode: 'new',
    sketchName: 'tool-types-dialog',
    importFiles: [resolve(import.meta.dirname, '..', 'imports', 'mirror-triangle.svg')],
  },
  { NAPKIN_USER_DATA: userData },
);

const STATE = `return {
  tool: document.getElementById('canvas').dataset.tool,
  toast: document.getElementById('toast').textContent,
  editor: !document.getElementById('config-dialog').classList.contains('is-hidden'),
  rotate: !document.getElementById('rotate-dialog').classList.contains('is-hidden'),
};`;

const VIEW = `
  const root = document.getElementById('config-dialog');
  const lines = [...root.querySelectorAll('tbody tr')];
  const status = root.querySelector('.config-status');
  return {
    open: !root.classList.contains('is-hidden'),
    title: root.querySelector('.config-title').textContent,
    hint: root.querySelector('.config-hint').textContent,
    count: lines.length,
    shown: lines.filter((tr) => !tr.hidden).map((tr) => tr.cells[0].textContent),
    status: status.textContent,
    statusLevel: ['ok', 'warn', 'refuse'].find((l) => status.classList.contains('is-' + l)) || '',
  };
`;

/** The editor's row for a tool, by the name in its Tool cell. */
const ROW = (name) => `[...document.querySelectorAll('#config-dialog tbody tr')].find((tr) => tr.cells[0].textContent === ${JSON.stringify(name)})`;

/** The in-window menu's rows as labels, or null while it is hidden. */
const MENU_ROWS = `
  const menu = document.getElementById('context-menu');
  if (menu.classList.contains('is-hidden')) return null;
  return [...menu.children].map((node) => node.classList.contains('context-menu-sep') ? '---' : node.querySelector('.context-menu-label')?.textContent ?? '');
`;

/** The ids of one menu of the live menu bar. */
const idsIn = (bar, label) => (bar.find((menu) => menu.label === label)?.submenu ?? []).map((item) => item.id);

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn('document.activeElement?.blur(); return true;');

  const state = () => page.evalIn(STATE);
  const view = () => page.evalIn(VIEW);
  const bar = () => page.evalIn('return await window.napkin.getAppMenu();');
  const openEditor = async () => {
    const ran = await page.evalIn("return await window.napkin.clickAppMenuItem('edit-tool-types');");
    await sleep(600);
    return ran;
  };
  /** A tool's Type drop-down as it stands, scrolled into view. */
  const typeOf = (name) =>
    page.evalIn(`
      const tr = ${ROW(name)};
      if (!tr) return null;
      const select = tr.querySelector('.config-select');
      select.scrollIntoView({ block: 'center' });
      return {
        value: select.value,
        label: select.selectedOptions[0]?.textContent ?? '',
        level: ['ok', 'warn', 'refuse'].find((l) => select.classList.contains('is-' + l)) || '',
        disabled: select.disabled,
        title: select.title,
        key: tr.cells[2].querySelector('input')?.value ?? null,
        keyDisabled: tr.cells[2].querySelector('input')?.disabled ?? null,
      };
    `);
  /** Steps a tool's drop-down with the arrow keys until it shows `value`. */
  const chooseType = async (name, value, key) => {
    await page.evalIn(`${ROW(name)}.querySelector('.config-select').focus(); return true;`);
    for (let step = 0; step < 16 && (await typeOf(name)).value !== value; step++) {
      await page.chord(key === 'up' ? 38 : 40, key === 'up' ? 'ArrowUp' : 'ArrowDown');
      await sleep(120);
    }
    await sleep(150);
    return typeOf(name);
  };
  const clickOn = async (selector) => {
    const at = await page.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    if (!at) throw new Error(`nothing to click at ${selector}`);
    await page.click(at.x, at.y);
    await sleep(200);
  };
  const rightClick = async ({ x, y }) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'right', clickCount: 1, buttons: type === 'mousePressed' ? 2 : 0 });
    }
    await sleep(300);
  };
  const center = (id) => page.evalIn(`const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);

  // ---- Opening, and the rows that cannot move -----------------------------------------------
  c.eq('Edit > Edit Tool Types runs from the menu bar', await openEditor(), true);
  let v = await view();
  c.ok('and opens the editor over every tool', v.open && v.title === 'Edit Tool Types' && v.count === TOOL_COUNT, `${v.title}, ${v.count} rows of ${TOOL_COUNT}`);
  c.ok('saying a type moves a tool and never changes it', v.hint.includes('never what the tool does'), v.hint);
  for (const name of ['Edit Tool Types', 'Edit Keyboard Shortcuts']) {
    const own = await typeOf(name);
    c.ok(
      `${name} cannot move, and says why`,
      own.disabled && own.title === 'This tool stays where it is: an editor stays in the Edit menu, where it can always be found.',
      JSON.stringify(own),
    );
  }
  let rotate = await typeOf('Rotate');
  c.ok(
    "Rotate's row: its type to choose, and its shortcut greyed",
    !rotate.disabled && rotate.value === 'Draw:Modify:element' && rotate.key === 'Ctrl+R' && rotate.keyDisabled === true,
    JSON.stringify(rotate),
  );

  // ---- Rotate to the clipboard's type --------------------------------------------------------
  await page.send('Input.insertText', { text: 'rotate' });
  await sleep(250);
  c.eq('the search keeps Rotate', (await view()).shown.join(), 'Rotate');
  rotate = await chooseType('Rotate', 'Composition:edit:mixed', 'up');
  v = await view();
  c.ok(
    'the arrow keys choose the clipboard type, and the cell says where that lists Rotate',
    rotate.value === 'Composition:edit:mixed' && rotate.level === 'ok' && v.status === 'Rotate will be listed in Edit, Layers panel, Canvas',
    JSON.stringify({ rotate, status: v.status }),
  );
  await clickOn('#config-dialog .config-accept');
  await sleep(900);
  let s = await state();
  c.ok('Accept saves and closes', !s.editor && s.toast === 'Saved 1 tool type change. The menus list them there now.', JSON.stringify(s));
  c.eq(
    'the file holds the one difference',
    existsSync(userFile) ? readFileSync(userFile, 'utf8') : null,
    `${JSON.stringify({ version: 1, tools: { rotate: 'Composition:edit:mixed' } }, null, 2)}\n`,
  );
  let menus = await bar();
  c.ok('the menu bar lists Rotate under Edit, and no longer under Transform', idsIn(menus, 'Edit').includes('rotate') && !idsIn(menus, 'Transform').includes('rotate'));

  await rightClick(await center('layers-list'));
  const layerRows = (await page.evalIn(MENU_ROWS)) ?? [];
  const duplicateAt = layerRows.indexOf('Duplicate');
  c.ok(
    "the layers panel's right-click menu lists Rotate after the clipboard rows",
    duplicateAt >= 0 && (layerRows[duplicateAt + 1] ?? '').startsWith('Rotate'),
    layerRows.join(' | '),
  );
  await page.chord(27, 'Escape');
  await sleep(250);

  // ---- It still does what it did ---------------------------------------------------------------
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(300);
  const wrap = await page.evalIn("const r = document.getElementById('canvas-wrap').getBoundingClientRect(); return { x: r.right - 40, y: r.top + r.height / 2 };");
  await rightClick(wrap);
  const rotateRow = await page.evalIn(`
    const row = [...document.querySelectorAll('#context-menu button')].find((b) => (b.querySelector('.context-menu-label')?.textContent ?? '').startsWith('Rotate'));
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `);
  c.ok("the canvas's right-click menu lists Rotate too", rotateRow !== null);
  if (rotateRow) {
    await page.click(rotateRow.x, rotateRow.y);
    await sleep(500);
  }
  c.eq('and a click there opens Rotate, as ever', (await state()).rotate, true);
  await page.chord(27, 'Escape');
  await sleep(300);
  await page.chord(82, 'r', 2); // Ctrl+R
  await sleep(400);
  c.eq('its key still opens it', (await state()).rotate, true);
  await page.chord(27, 'Escape');
  await sleep(300);

  // ---- Reset to defaults -------------------------------------------------------------------------
  await openEditor();
  c.eq('the editor opens on the saved type', (await typeOf('Rotate')).value, 'Composition:edit:mixed');
  await clickOn('#config-dialog .config-extra-button');
  await sleep(300);
  rotate = await typeOf('Rotate');
  v = await view();
  c.ok(
    "Reset to defaults puts Rotate's type back in the table, as an edit",
    rotate.value === 'Draw:Modify:element' && rotate.level === 'ok' && v.status.startsWith("The app's own types are in the table"),
    JSON.stringify({ rotate, status: v.status }),
  );
  await clickOn('#config-dialog .config-accept');
  await sleep(900);
  s = await state();
  c.ok("accepted, every tool is where the app puts it", !s.editor && s.toast === 'Every tool is listed where the app puts it again.', JSON.stringify(s));
  c.eq('and the file is gone', existsSync(userFile), false);
  menus = await bar();
  c.ok('Rotate is back under Transform, and gone from Edit', idsIn(menus, 'Transform').includes('rotate') && !idsIn(menus, 'Edit').includes('rotate'));

  // ---- A toolbar tool put in a menu --------------------------------------------------------------
  await openEditor();
  let rect = await typeOf('Rectangle');
  c.ok('the Rectangle tool is in no menu, and says so', rect.value === '' && rect.label === 'Not in a menu' && rect.title === 'In no menu: the toolbar or its key runs it', JSON.stringify(rect));
  rect = await chooseType('Rectangle', 'Draw:Add:vector', 'down');
  v = await view();
  c.ok('given a Transform type, it will be listed there', rect.value === 'Draw:Add:vector' && v.status === 'Rectangle will be listed in Transform', JSON.stringify({ rect, status: v.status }));
  await clickOn('#config-dialog .config-accept');
  await sleep(900);
  menus = await bar();
  c.ok('the Transform menu lists it', idsIn(menus, 'Transform').includes('tool-rect'), idsIn(menus, 'Transform').join(', '));
  c.eq('and runs it from there', await page.evalIn("return await window.napkin.clickAppMenuItem('tool-rect');"), true);
  await sleep(300);
  c.eq('the Rectangle tool is in hand', (await state()).tool, 'rect');

  // ---- Out of every menu, then Cancel ------------------------------------------------------------
  await openEditor();
  const join = await chooseType('Join', '', 'up');
  v = await view();
  c.ok(
    'Join taken out of every menu warns in amber, with the key that still runs it',
    join.value === '' && join.level === 'warn' && v.status === 'Join will be in no menu; Ctrl+J still runs it',
    JSON.stringify({ join, status: v.status }),
  );
  const before = readFileSync(userFile, 'utf8');
  await clickOn('#config-dialog .config-cancel');
  await sleep(400);
  c.ok('Cancel closes and saves nothing', !(await state()).editor && readFileSync(userFile, 'utf8') === before);
  c.ok('Join is still in Transform', idsIn(await bar(), 'Transform').includes('join-strokes'));

  c.ok('the shipped tool types file is never written', readFileSync(SHIPPED, 'utf8') === shippedBefore);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
