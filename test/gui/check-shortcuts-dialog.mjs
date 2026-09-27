/**
 * Edit Keyboard Shortcuts, in the running app.
 *
 * The app starts with a shortcuts file in its user-data folder that is not
 * JSON: it says so, and the app's own shortcuts are in force. Then the editor
 * is opened from the menu bar and used as a person would. The search finds
 * Mirror, Ctrl+M is captured for it, and Accept saves a file of that one
 * difference in place of the broken one; at once Ctrl+M opens Mirror, O does
 * nothing, and Mirror's tooltip and menu bar row say Ctrl+M. Opened again, the
 * editor warns in amber on both rows when Move is given Ctrl+M, puts Move
 * back on Escape, refuses Enter for Pen, and with Reset to defaults puts O
 * back in the table; accepted, the file is gone and O opens Mirror again.
 * Cancel saves nothing, and the shipped shortcuts file is never written.
 *
 * The app runs with a user-data folder of the check's own, made for the run
 * and removed after it, so no one's settings or menu files are touched.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SHIPPED = join(ROOT, 'src', 'core', 'menu', 'shortcuts.json');
const shippedBefore = readFileSync(SHIPPED, 'utf8');
const TOOL_COUNT = JSON.parse(readFileSync(join(ROOT, 'src', 'core', 'menu', 'tool-types.json'), 'utf8')).tools.length;

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-shortcuts-dialog-'));
const userFile = join(userData, 'shortcuts.json');
writeFileSync(userFile, '{ "version": 1, "shortcuts": { "mirror": ');

const app = launch(
  {
    mode: 'new',
    sketchName: 'shortcuts-dialog',
    importFiles: [resolve(import.meta.dirname, '..', 'imports', 'mirror-triangle.svg')],
  },
  { NAPKIN_USER_DATA: userData },
);

const STATE = `return {
  tool: document.getElementById('canvas').dataset.tool,
  toast: document.getElementById('toast').textContent,
  mirror: !document.getElementById('mirror-dialog').classList.contains('is-hidden'),
  editor: !document.getElementById('config-dialog').classList.contains('is-hidden'),
  mirrorTitle: document.getElementById('mirror-selection').title,
};`;

const VIEW = `
  const root = document.getElementById('config-dialog');
  const lines = [...root.querySelectorAll('tbody tr')];
  const status = root.querySelector('.config-status');
  return {
    open: !root.classList.contains('is-hidden'),
    title: root.querySelector('.config-title').textContent,
    count: lines.length,
    shown: lines.filter((tr) => !tr.hidden).map((tr) => tr.cells[0].textContent),
    status: status.textContent,
    statusLevel: ['ok', 'warn', 'refuse'].find((l) => status.classList.contains('is-' + l)) || '',
    filters: [...root.querySelectorAll('.config-filter')].map((l) => l.textContent),
  };
`;

/** The editor's row for a tool, by the name in its Tool cell. */
const ROW = (name) => `[...document.querySelectorAll('#config-dialog tbody tr')].find((tr) => tr.cells[0].textContent === ${JSON.stringify(name)})`;

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
  const view = () => page.evalIn(VIEW);
  const menuRow = async (id) => rowOf(await page.evalIn('return await window.napkin.getAppMenu();'), id);
  const openEditor = async () => {
    const ran = await page.evalIn("return await window.napkin.clickAppMenuItem('edit-shortcuts');");
    await sleep(600);
    return ran;
  };
  /** A tool's shortcut cell as it stands, scrolled into view. */
  const cellOf = (name) =>
    page.evalIn(`
      const tr = ${ROW(name)};
      if (!tr) return null;
      const input = tr.querySelector('.config-key-input');
      input.scrollIntoView({ block: 'center' });
      const r = input.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        value: input.value,
        level: ['ok', 'warn', 'refuse'].find((l) => input.classList.contains('is-' + l)) || '',
        disabled: input.disabled,
        title: input.title,
        type: tr.cells[1].querySelector('input')?.value ?? null,
      };
    `);
  const clickKey = async (name) => {
    const cell = await cellOf(name);
    if (!cell) throw new Error(`no row for ${name}`);
    await page.click(cell.x, cell.y);
    await sleep(200);
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

  // ---- A broken file at startup -------------------------------------------------------------
  // The launch's import says "Imported 1 layer" first; the warning follows it
  // rather than being replaced by it, so it is waited for.
  const seen = [];
  let toast = '';
  for (const end = Date.now() + 6000; Date.now() < end; await sleep(150)) {
    toast = await page.evalIn("return document.getElementById('toast').textContent;");
    if (seen[seen.length - 1] !== toast) seen.push(toast);
    if (toast.startsWith('The shortcuts file is not JSON')) break;
  }
  c.ok(
    'a shortcuts file that is not JSON is said to be ignored, after what the import said',
    toast.startsWith('The shortcuts file is not JSON') && toast.endsWith('so it was ignored.'),
    JSON.stringify(seen),
  );
  let s = await state();
  c.ok("and the app's own shortcuts are in force", s.mirrorTitle.endsWith('(O)'), s.mirrorTitle);

  // ---- Opening from the menu bar -------------------------------------------------------------
  c.eq('Edit > Edit Keyboard Shortcuts runs from the menu bar', await openEditor(), true);
  let v = await view();
  c.ok('and opens the editor over every tool', v.open && v.title === 'Edit Keyboard Shortcuts' && v.count === TOOL_COUNT, `${v.title}, ${v.count} rows of ${TOOL_COUNT}`);
  c.eq('with a radio for each main type', v.filters.join(' '), 'All App Composition GUI Draw API docs');
  const zoom = await cellOf('Zoom In');
  c.ok("Electron's own rows show their key, greyed", zoom?.disabled === true && zoom?.value === 'Ctrl++', JSON.stringify(zoom));
  let cell = await cellOf('Mirror');
  c.ok("Mirror's row: its type greyed beside its key", cell?.type === 'Draw:Modify:element' && cell?.value === 'O', JSON.stringify(cell));

  // ---- Search, capture, Accept ----------------------------------------------------------------
  await page.send('Input.insertText', { text: 'mirror' });
  await sleep(250);
  c.eq('the search keeps Mirror', (await view()).shown.join(), 'Mirror');
  await clickKey('Mirror');
  await page.chord(77, 'm', 2); // Ctrl+M
  await sleep(250);
  cell = await cellOf('Mirror');
  v = await view();
  c.ok('Ctrl+M, which no tool holds, goes green', cell.value === 'Ctrl+M' && cell.level === 'ok' && v.status === 'Mirror: Ctrl+M', JSON.stringify({ cell, status: v.status }));
  await clickOn('#config-dialog .config-accept');
  await sleep(900);
  s = await state();
  c.ok('Accept saves and closes', !s.editor && s.toast === 'Saved 1 shortcut change.', JSON.stringify(s));
  c.eq(
    'the file holds the one difference, in place of the broken one',
    existsSync(userFile) ? readFileSync(userFile, 'utf8') : null,
    `${JSON.stringify({ version: 1, shortcuts: { mirror: 'Ctrl+M' } }, null, 2)}\n`,
  );
  c.ok("Mirror's tooltip says Ctrl+M at once", s.mirrorTitle.endsWith('(Ctrl+M)'), s.mirrorTitle);
  let row = await menuRow('mirror');
  c.ok("and so does the menu bar's Mirror row", row?.accelerator === 'CmdOrCtrl+M', JSON.stringify(row));

  // ---- The keys follow at once -----------------------------------------------------------------
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(300);
  await page.chord(79, 'o'); // O
  await sleep(400);
  c.eq('O no longer opens Mirror', (await state()).mirror, false);
  await page.chord(77, 'm', 2); // Ctrl+M
  await sleep(400);
  c.eq('Ctrl+M does', (await state()).mirror, true);
  await page.chord(27, 'Escape');
  await sleep(300);

  // ---- A warning on both rows, a refusal, and Reset -----------------------------------------------
  await openEditor();
  c.eq('the editor opens on the saved shortcut', (await cellOf('Mirror')).value, 'Ctrl+M');
  await clickKey('Move');
  await page.chord(77, 'm', 2); // Ctrl+M
  await sleep(250);
  cell = await cellOf('Move');
  v = await view();
  c.ok(
    'Ctrl+M for Move warns in amber that Accept takes it from Mirror',
    cell.value === 'Ctrl+M' && cell.level === 'warn' && v.status === 'Used by Mirror - Accept will take it from Mirror' && v.statusLevel === 'warn',
    JSON.stringify({ cell, status: v.status }),
  );
  const losing = await cellOf('Mirror');
  c.ok(
    "and Mirror's row says it would be left with none",
    losing.level === 'warn' && losing.title === 'Move takes Ctrl+M on Accept, so Mirror will have no shortcut',
    JSON.stringify(losing),
  );
  await page.chord(27, 'Escape');
  await sleep(250);
  c.ok('Escape puts Move back on Enter, and both warnings go', (await cellOf('Move')).value === 'Enter' && (await cellOf('Mirror')).level === '');
  await clickKey('Pen');
  await page.chord(13, 'Enter');
  await sleep(250);
  cell = await cellOf('Pen');
  v = await view();
  c.ok(
    'Enter for Pen is refused in place, with the reason',
    cell.value === 'P' && cell.level === 'refuse' && v.status === 'Enter finishes a path and applies an open palette, so only Move can have it',
    JSON.stringify({ cell, status: v.status }),
  );
  await page.chord(27, 'Escape');
  await sleep(250);
  await clickOn('#config-dialog .config-extra-button'); // Reset to defaults
  await sleep(300);
  cell = await cellOf('Mirror');
  v = await view();
  c.ok(
    'Reset to defaults puts O back in the table, as an edit',
    cell.value === 'O' && cell.level === 'ok' && v.statusLevel === 'ok' && v.status.startsWith("The app's own shortcuts are in the table"),
    JSON.stringify({ cell, status: v.status }),
  );
  c.eq('and saves nothing yet', existsSync(userFile) && readFileSync(userFile, 'utf8').includes('Ctrl+M'), true);
  await clickOn('#config-dialog .config-accept');
  await sleep(900);
  s = await state();
  c.ok("accepted, the shortcuts are the app's own again", !s.editor && s.toast === "The keyboard shortcuts are the app's own again.", JSON.stringify(s));
  c.eq('and the file is gone', existsSync(userFile), false);
  c.ok("Mirror's tooltip says O again", s.mirrorTitle.endsWith('(O)'), s.mirrorTitle);
  row = await menuRow('mirror');
  c.eq("and so does the menu bar's row", row?.accelerator, 'O');
  await page.chord(79, 'o'); // O
  await sleep(400);
  c.eq('O opens Mirror', (await state()).mirror, true);
  await page.chord(27, 'Escape');
  await sleep(300);
  await page.chord(77, 'm', 2); // Ctrl+M
  await sleep(400);
  c.eq('and Ctrl+M does nothing', (await state()).mirror, false);

  // ---- Cancel ----------------------------------------------------------------------------------------
  await openEditor();
  await clickKey('Pen');
  await page.chord(80, 'p', 2 | 8); // Ctrl+Shift+P
  await sleep(250);
  c.eq('Ctrl+Shift+P goes into the table', (await cellOf('Pen')).value, 'Ctrl+Shift+P');
  await clickOn('#config-dialog .config-cancel');
  await sleep(400);
  c.ok('Cancel closes and saves nothing', !(await state()).editor && !existsSync(userFile));
  await page.chord(80, 'p'); // P
  await sleep(300);
  c.eq('P still takes the pen', (await state()).tool, 'pen');

  c.ok('the shipped shortcuts file is never written', readFileSync(SHIPPED, 'utf8') === shippedBefore);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
