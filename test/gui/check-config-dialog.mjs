/**
 * The configuration popup, in the running app, before any editor uses it.
 *
 * The check opens the popup through `window.napkinCheck`, which the page puts
 * up only for a check, with a spec of its own: three rows and one column of
 * each kind - the tool as words, its type as a greyed text box, a group as a
 * drop-down, a shortcut box, and a check box. Then it does what a person
 * would, with real keys and clicks: types in the search, ticks the radios,
 * captures chords (a free one, one another row holds, a reserved one), backs
 * out of a shortcut cell with Escape, clears a shortcut, changes the
 * drop-down and the check box, and accepts with Enter, reading back the rows
 * Accept was handed. A second opening is cancelled with Escape; a third has
 * Accept throw and stays open; a fourth, of eighty rows, scrolls the table
 * under headings that stay put while the panel keeps to the window.
 *
 * Around it: the popup keeps its keys. A letter typed in it picks no tool, the
 * drawing's Undo does not run from inside it, and Tab goes round its own
 * controls. Once it is gone, the keys work again.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'config',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'mirror-triangle.svg')],
});

/** Opens the popup with the three-row spec; `onAccept` is the body of Accept. */
const OPEN = (onAccept = 'window.__config.accepted = rows;') => `
  window.__config = { accepted: null, cancelled: 0 };
  const byType = (main) => (row) => row.type.startsWith(main + ':');
  return window.napkinCheck.openConfigDialog({
    title: 'Check the popup',
    hint: 'A spec the GUI check wrote.',
    header: 'Three rows : 3',
    search: { placeholder: 'Search tools', text: (row) => row.tool + ' ' + row.type + ' ' + (row.key || '') },
    filters: [
      { label: 'Draw', test: byType('Draw') },
      { label: 'Transform', test: byType('Transform') },
    ],
    columns: [
      { kind: 'text', heading: 'Tool', field: 'tool' },
      { kind: 'text', heading: 'Type', field: 'type', editable: () => false },
      {
        kind: 'select',
        heading: 'Group',
        field: 'group',
        optgroups: [
          { label: 'Main', options: [{ value: 'draw', label: 'Draw' }, { value: 'transform', label: 'Transform' }] },
          { label: 'More', options: [{ value: 'layers', label: 'Layers' }] },
        ],
      },
      {
        kind: 'key',
        heading: 'Keyboard Shortcut',
        field: 'key',
        validate: (row, chord, all) => {
          const holder = all.find((other) => other.tool !== row.tool && other.key === chord);
          return holder ? { level: 'warn', message: 'Used by ' + holder.tool + ' - Accept will take it from ' + holder.tool } : null;
        },
      },
      { kind: 'check', heading: 'On', field: 'on' },
    ],
    rows: [
      { tool: 'Pen', type: 'Draw:mark', group: 'draw', key: 'P', on: true },
      { tool: 'Rotate', type: 'Transform:vector', group: 'transform', key: 'Ctrl+R', on: true },
      { tool: 'Mirror', type: 'Transform:vector', group: 'transform', key: 'O', on: false },
    ],
    accept: { onAccept: (rows) => { ${onAccept} } },
    cancel: { onCancel: () => { window.__config.cancelled++; } },
  });
`;

/** Eighty rows, with no search, filters, hint or header. */
const OPEN_MANY = `
  const rows = Array.from({ length: 80 }, (_, i) => ({ tool: 'Tool ' + (i + 1), key: null }));
  return window.napkinCheck.openConfigDialog({
    title: 'Many rows',
    columns: [
      { kind: 'text', heading: 'Tool', field: 'tool' },
      { kind: 'key', heading: 'Keyboard Shortcut', field: 'key' },
    ],
    rows,
    accept: { onAccept: () => {} },
  });
`;

/** The popup as a person sees it. */
const VIEW = `
  const root = document.getElementById('config-dialog');
  const lines = [...root.querySelectorAll('tbody tr')];
  const levelOf = (node) => ['ok', 'warn', 'refuse'].find((l) => node.classList.contains('is-' + l)) || '';
  const active = document.activeElement;
  const status = root.querySelector('.config-status');
  return {
    open: !root.classList.contains('is-hidden'),
    shown: lines.filter((tr) => !tr.hidden).map((tr) => tr.cells[0].textContent),
    keys: lines.map((tr) => tr.querySelector('.config-key-input')?.value ?? null),
    levels: lines.map((tr) => { const i = tr.querySelector('.config-key-input'); return i ? levelOf(i) : null; }),
    titles: lines.map((tr) => tr.querySelector('.config-key-input')?.title ?? null),
    search: root.querySelector('.config-search').value,
    status: status.textContent,
    statusLevel: levelOf(status),
    empty: !root.querySelector('.config-empty').classList.contains('is-hidden'),
    focusInside: root.contains(active),
    focusClass: active ? active.className : '',
    focusRow: active?.closest('tr')?.dataset.row ?? null,
  };
`;

const STATE = `return {
  tool: document.getElementById('canvas').dataset.tool,
  toast: document.getElementById('toast').textContent,
};`;

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

  const view = () => page.evalIn(VIEW);
  const state = () => page.evalIn(STATE);
  const redoEnabled = async () => rowOf(await page.evalIn('return await window.napkin.getAppMenu();'), 'redo')?.enabled;
  const centerOf = (selector) =>
    page.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
  const clickOn = async (selector) => {
    const at = await centerOf(selector);
    if (!at) throw new Error(`nothing to click at ${selector}`);
    await page.click(at.x, at.y);
    await sleep(200);
  };
  const clickFilter = async (label) => {
    const at = await page.evalIn(`
      const holder = [...document.querySelectorAll('#config-dialog .config-filter')].find((l) => l.textContent === ${JSON.stringify(label)});
      if (!holder) return null;
      const r = holder.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    if (!at) throw new Error(`no ${label} radio`);
    await page.click(at.x, at.y);
    await sleep(200);
  };
  const type = async (text) => {
    await page.send('Input.insertText', { text });
    await sleep(200);
  };
  const clearSearch = async () => {
    await page.chord(65, 'a', 2); // Ctrl+A, kept by the search box for itself
    await page.chord(8, 'Backspace');
    await sleep(200);
  };
  const keyCell = (row) => `#config-dialog tbody tr[data-row="${row}"] .config-key-input`;

  // ---- Something to undo, so a stray Undo would show -------------------------------------------
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(300);
  await page.chord(46, 'Delete');
  await sleep(600);
  c.eq('with the triangle deleted, there is nothing to redo', await redoEnabled(), false);

  // ---- Opening -------------------------------------------------------------------------------------
  c.eq('the page puts up the check hook', await page.evalIn('return typeof window.napkinCheck?.openConfigDialog;'), 'function');
  c.eq('the popup opens', await page.evalIn(OPEN()), true);
  await sleep(400);
  const first = await page.evalIn(`
    const root = document.getElementById('config-dialog');
    return {
      title: root.querySelector('.config-title').textContent,
      hint: root.querySelector('.config-hint').textContent,
      hintShown: !root.querySelector('.config-hint').classList.contains('is-hidden'),
      header: root.querySelector('.config-header').textContent,
      headings: [...root.querySelectorAll('thead th')].map((th) => th.textContent),
      filters: [...root.querySelectorAll('.config-filter')].map((l) => l.textContent + (l.querySelector('input').checked ? '*' : '')),
      placeholder: root.querySelector('.config-search').placeholder,
      typeBox: (() => { const i = root.querySelector('tbody tr[data-row="0"] .config-input'); return i ? { value: i.value, disabled: i.disabled } : null; })(),
      group: root.querySelector('tbody tr[data-row="1"] select').value,
      on: [...root.querySelectorAll('.config-check')].map((b) => b.checked),
      floating: root.classList.contains('dialog-floating'),
      resizable: root.querySelector('.export-dialog-inner').classList.contains('popup-resizable'),
      dockButton: root.querySelector('.popup-dock-btn') !== null,
      visible: getComputedStyle(root).visibility,
    };
  `);
  c.eq('with its title', first.title, 'Check the popup');
  c.ok('the hint and the header bar', first.hintShown && first.hint === 'A spec the GUI check wrote.' && first.header === 'Three rows : 3', JSON.stringify(first));
  c.eq('the headings', first.headings.join(' | '), 'Tool | Type | Group | Keyboard Shortcut | On');
  c.eq('All comes first and is ticked', first.filters.join(' '), 'All* Draw Transform');
  c.ok('the Type cell is a greyed text box', first.typeBox?.value === 'Draw:mark' && first.typeBox?.disabled === true, JSON.stringify(first.typeBox));
  c.ok('the drop-down and the check boxes show the rows', first.group === 'transform' && first.on.join() === 'true,true,false', JSON.stringify(first));
  c.ok('it moves and resizes, and has no dock button', first.floating && first.resizable && !first.dockButton, JSON.stringify(first));
  let v = await view();
  c.ok('all three rows show, with their shortcuts', v.open && v.shown.join() === 'Pen,Rotate,Mirror' && v.keys.join() === 'P,Ctrl+R,O', JSON.stringify(v));
  c.eq('and the focus is in the search box', v.focusClass, 'config-search');
  c.eq('a second opening while it is up is refused', await page.evalIn(OPEN()), false);
  c.eq('and changes nothing', (await view()).shown.join(), 'Pen,Rotate,Mirror');

  // ---- The search: indexOf, any case ---------------------------------------------------------------
  await type('ROT');
  c.eq('ROT keeps Rotate', (await view()).shown.join(), 'Rotate');
  await clearSearch();
  await type('ro');
  v = await view();
  c.eq('ro is inside Mirror too', v.shown.join(), 'Rotate,Mirror');
  await clearSearch();
  await type('zzz');
  v = await view();
  c.ok('a search nothing matches says so', v.shown.length === 0 && v.empty, JSON.stringify(v));
  await clearSearch();
  v = await view();
  c.ok('an empty search shows every row again', v.search === '' && v.shown.length === 3 && !v.empty, JSON.stringify(v));

  // ---- The radios ------------------------------------------------------------------------------------
  await clickFilter('Transform');
  c.eq('Transform keeps the two Transform rows', (await view()).shown.join(), 'Rotate,Mirror');
  await clickFilter('Draw');
  c.eq('Draw keeps Pen', (await view()).shown.join(), 'Pen');

  // ---- A shortcut cell ------------------------------------------------------------------------------
  await clickOn(keyCell(0));
  await page.chord(77, 'm', 2); // Ctrl+M
  await sleep(250);
  v = await view();
  c.ok('Ctrl+M, held by no one, goes green', v.keys[0] === 'Ctrl+M' && v.levels[0] === 'ok' && v.status === 'Pen: Ctrl+M' && v.statusLevel === 'ok', JSON.stringify(v));
  const colours = await page.evalIn(`
    const probe = document.createElement('span');
    probe.style.color = 'var(--ok)';
    document.body.append(probe);
    const ok = getComputedStyle(probe).color;
    probe.remove();
    return { ok, border: getComputedStyle(document.querySelector(${JSON.stringify(keyCell(0))})).borderTopColor };
  `);
  c.eq("in the theme's own green", colours.border, colours.ok);
  await page.chord(82, 'r', 2); // Ctrl+R, which also reloads a browser
  await sleep(250);
  v = await view();
  c.ok(
    'Ctrl+R, which Rotate holds, goes amber and says so',
    v.keys[0] === 'Ctrl+R' &&
      v.levels[0] === 'warn' &&
      v.status === 'Used by Rotate - Accept will take it from Rotate' &&
      v.statusLevel === 'warn' &&
      v.titles[0] === v.status,
    JSON.stringify(v),
  );
  c.ok('and nothing reloaded or turned', v.open && !(await page.evalIn("return !document.getElementById('rotate-dialog').classList.contains('is-hidden');")));
  await page.chord(32, ' '); // Space
  await sleep(250);
  v = await view();
  c.ok(
    'Space is refused in place, and the cell keeps Ctrl+R',
    v.keys[0] === 'Ctrl+R' && v.levels[0] === 'refuse' && v.status.startsWith('Space is held to pan') && v.statusLevel === 'refuse',
    JSON.stringify(v),
  );
  await page.chord(27, 'Escape');
  await sleep(300);
  v = await view();
  c.ok('Escape puts back what the cell held and leaves it, the popup still up', v.open && v.keys[0] === 'P' && v.levels[0] === '' && v.focusRow === null && v.focusInside, JSON.stringify(v));
  await clickOn(keyCell(0));
  await page.chord(77, 'm', 2); // Ctrl+M again
  await sleep(200);
  await page.chord(9, 'Tab');
  await sleep(200);
  v = await view();
  c.ok('Tab moves on from a shortcut cell rather than being taken', v.keys[0] === 'Ctrl+M' && v.focusClass === 'config-key-clear' && v.focusRow === '0', JSON.stringify(v));

  // ---- A hidden row keeps its edit ------------------------------------------------------------------
  await clickFilter('Transform');
  c.eq('with Transform ticked, Pen is out of view', (await view()).shown.join(), 'Rotate,Mirror');
  await clickFilter('All');
  v = await view();
  c.ok('and back in view it still has Ctrl+M', v.shown.join() === 'Pen,Rotate,Mirror' && v.keys[0] === 'Ctrl+M' && v.levels[0] === 'ok', JSON.stringify(v));

  // ---- Clearing, the check box, the drop-down ------------------------------------------------------
  await clickOn('#config-dialog tbody tr[data-row="2"] .config-key-clear');
  v = await view();
  c.ok("the clear button takes Mirror's shortcut away", v.keys[2] === '' && v.status === 'Mirror: no shortcut' && v.focusClass.startsWith('config-key-input') && v.focusRow === '2', JSON.stringify(v));
  c.eq(
    'and greys, with nothing left to clear',
    await page.evalIn("return document.querySelector('#config-dialog tbody tr[data-row=\"2\"] .config-key-clear').disabled;"),
    true,
  );
  await clickOn('#config-dialog tbody tr[data-row="2"] .config-check');
  c.eq('a click ticks Mirror', await page.evalIn("return document.querySelector('#config-dialog tbody tr[data-row=\"2\"] .config-check').checked;"), true);
  await page.evalIn("document.querySelector('#config-dialog tbody tr[data-row=\"1\"] select').focus(); return true;");
  await page.chord(40, 'ArrowDown');
  await sleep(250);
  c.eq('the Down arrow moves Rotate to the next group', await page.evalIn("return document.querySelector('#config-dialog tbody tr[data-row=\"1\"] select').value;"), 'layers');

  // ---- The popup keeps its keys ----------------------------------------------------------------------
  await clickOn('#config-dialog tbody tr[data-row="2"] .config-check');
  await clickOn('#config-dialog tbody tr[data-row="2"] .config-check'); // back to ticked, and the focus on it
  const toolBefore = (await state()).tool;
  await page.chord(69, 'e'); // E, the eraser, on a check box that takes no letters
  await sleep(250);
  c.eq('a letter typed in the popup picks no tool', (await state()).tool, toolBefore);
  await clickOn('#config-dialog .config-search');
  await page.chord(90, 'z', 2); // Ctrl+Z
  await sleep(500);
  c.eq("and Ctrl+Z in it does not undo the drawing's delete", await redoEnabled(), false);
  await page.evalIn("document.querySelector('#config-dialog .config-cancel').focus(); return true;");
  await page.chord(9, 'Tab');
  await sleep(200);
  c.eq('Tab from the last control goes round to the search box', (await view()).focusClass, 'config-search');
  await page.chord(9, 'Tab', 8); // Shift+Tab
  await sleep(200);
  c.eq('and Shift+Tab from there back to Cancel', (await view()).focusClass, 'btn config-cancel');

  // ---- Accept, from Enter in a field ------------------------------------------------------------------
  await clickOn('#config-dialog .config-search');
  await page.chord(13, 'Enter');
  await sleep(400);
  v = await view();
  c.ok('Enter in the search box accepts and closes', !v.open && !v.focusInside, JSON.stringify(v));
  c.eq(
    'Accept gets every row, with its edits',
    JSON.stringify(await page.evalIn('return window.__config.accepted;')),
    JSON.stringify([
      { tool: 'Pen', type: 'Draw:mark', group: 'draw', key: 'Ctrl+M', on: true },
      { tool: 'Rotate', type: 'Transform:vector', group: 'layers', key: 'Ctrl+R', on: true },
      { tool: 'Mirror', type: 'Transform:vector', group: 'transform', key: null, on: true },
    ]),
  );

  // ---- Cancel, from Escape --------------------------------------------------------------------------
  await page.evalIn(OPEN());
  await sleep(400);
  v = await view();
  c.ok('a new opening starts from the rows it is given', v.open && v.keys.join() === 'P,Ctrl+R,O' && v.status === '', JSON.stringify(v));
  await clickOn('#config-dialog tbody tr[data-row="0"] .config-check');
  await page.chord(27, 'Escape');
  await sleep(400);
  const cancelled = await page.evalIn('return window.__config;');
  c.ok('Escape outside a shortcut cell cancels, and Accept is never called', !(await view()).open && cancelled.cancelled === 1 && cancelled.accepted === null, JSON.stringify(cancelled));

  // ---- An Accept that throws ------------------------------------------------------------------------
  await page.evalIn(OPEN("throw new Error('Could not write the file.');"));
  await sleep(400);
  await clickOn('#config-dialog .config-accept');
  await sleep(300);
  v = await view();
  const acceptEnabled = await page.evalIn("return !document.querySelector('#config-dialog .config-accept').disabled;");
  c.ok('an Accept that throws leaves the popup up, saying why', v.open && v.status === 'Could not write the file.' && v.statusLevel === 'refuse' && acceptEnabled, JSON.stringify(v));
  await clickOn('#config-dialog .config-cancel');
  await sleep(300);
  c.eq('and Cancel closes it', (await view()).open, false);

  // ---- Eighty rows ------------------------------------------------------------------------------------
  await page.evalIn(OPEN_MANY);
  await sleep(400);
  const many = await page.evalIn(`
    const root = document.getElementById('config-dialog');
    const panel = root.querySelector('.export-dialog-inner');
    const box = root.querySelector('.config-table');
    return {
      find: root.querySelector('.config-find').classList.contains('is-hidden'),
      hint: root.querySelector('.config-hint').classList.contains('is-hidden'),
      header: root.querySelector('.config-header').classList.contains('is-hidden'),
      bottom: panel.getBoundingClientRect().bottom,
      height: innerHeight,
      scrolls: box.scrollHeight > box.clientHeight,
      focusRow: document.activeElement?.closest('tr')?.dataset.row ?? null,
      box: (() => { const r = box.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })(),
    };
  `);
  c.ok('with no search, filters, hint or header, none of them shows', many.find && many.hint && many.header, JSON.stringify(many));
  c.ok('the panel keeps to the window and the table scrolls', many.bottom <= many.height && many.scrolls, JSON.stringify(many));
  c.eq('with no search box, the focus starts in the first shortcut cell', many.focusRow, '0');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: many.box.x, y: many.box.y, deltaX: 0, deltaY: 600 });
  await sleep(400);
  const scrolled = await page.evalIn(`
    const root = document.getElementById('config-dialog');
    const box = root.querySelector('.config-table');
    return {
      scrollTop: box.scrollTop,
      panelScroll: root.querySelector('.export-dialog-inner').scrollTop,
      gap: root.querySelector('thead th').getBoundingClientRect().top - box.getBoundingClientRect().top,
    };
  `);
  c.ok('the wheel scrolls the table alone, under headings that stay put', scrolled.scrollTop > 0 && scrolled.panelScroll === 0 && scrolled.gap >= 0 && scrolled.gap <= 2, JSON.stringify(scrolled));
  await page.chord(27, 'Escape');
  await sleep(300);
  c.eq('Escape in a shortcut cell only leaves the cell', (await view()).open, true);
  await page.chord(27, 'Escape');
  await sleep(400);
  c.eq('a second Escape cancels', (await view()).open, false);

  // ---- The keys are the page's again ----------------------------------------------------------------
  await page.chord(69, 'e'); // E
  await sleep(300);
  c.eq('with the popup gone, E takes the eraser', (await state()).tool, 'eraser');
  await page.chord(90, 'z', 2); // Ctrl+Z
  await sleep(500);
  c.eq("and Ctrl+Z undoes the drawing's delete, which it could have all along", await redoEnabled(), true);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}
