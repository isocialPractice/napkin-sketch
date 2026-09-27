/**
 * The menus, generated from the menu registry, in the running app.
 *
 * The unit suites hold the registry's rows to the menus the app used to
 * build by hand. What only the running app can show is that those rows are
 * the ones on screen and that they do something: the menu bar Electron
 * actually holds (read back through `window.napkin.getAppMenu`, which answers
 * only when the app was started for a check), its rows greying as the
 * selection and the clipboard change, the right-click menus of the canvas and
 * both panels with their shortcuts at the right edge and their nested panels,
 * the three toolbar dropdowns, and a row run from each place: a click on a
 * right-click row, a click on a menu bar row, a toolbar button.
 *
 * The app runs with a user-data folder of the check's own, made for the run
 * and removed after it: Track History, which a menu bar row turns on here,
 * is a setting, and it must not be left on for the next check or the next
 * run.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, connect, pages, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-context-menus-'));
const app = launch(
  {
    mode: 'new',
    sketchName: 'menus',
    importFiles: [resolve(import.meta.dirname, '..', 'imports', 'mirror-triangle.svg')],
  },
  { NAPKIN_USER_DATA: userData },
);

/** An in-window menu's rows as text - label, [shortcut], (disabled), and > for a nested panel - or null while it is hidden. */
const ROWS = (id) => `
  const menu = document.getElementById('${id}');
  if (!menu || menu.classList.contains('is-hidden')) return null;
  return [...menu.children].map((node) => {
    if (node.classList.contains('context-menu-sep')) return '---';
    const chord = node.querySelector('.context-menu-chord');
    return (node.querySelector('.context-menu-label')?.textContent ?? '') +
      (chord ? ' [' + chord.textContent + ']' : '') +
      (node.disabled ? ' (disabled)' : '') +
      (node.classList.contains('has-submenu') ? ' >' : '');
  });
`;

/** The middle of an element, or of a menu row by its label. */
const CENTER = (id) => `const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`;
const ROW_CENTER = (menuId, label) => `
  const row = [...document.getElementById('${menuId}').querySelectorAll('button')]
    .find((b) => b.querySelector('.context-menu-label')?.textContent === ${JSON.stringify(label)});
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
`;

const STATE = `return {
  toast: document.getElementById('toast').textContent,
  tool: document.getElementById('canvas').dataset.tool,
  layers: document.querySelectorAll('#layers-list .layer-row').length,
  page: document.getElementById('page-indicator').textContent,
  pagesOpen: document.getElementById('app').classList.contains('pages-open'),
  layersOpen: document.getElementById('app').classList.contains('layers-open'),
};`;

async function rightClick(page, { x, y }) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'right', clickCount: 1, buttons: type === 'mousePressed' ? 2 : 0 });
  }
  await sleep(250);
}

async function hover(page, { x, y }) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(250);
}

async function escape(page) {
  await page.chord(27, 'Escape');
  await sleep(200);
}

/** A menu of the live menu bar, by its label. */
const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
const labelsOf = (items) => items.map((item) => (item.type === 'separator' ? '---' : item.label));
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}
const readBar = (page) => page.evalIn('return await window.napkin.getAppMenu();');

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn('document.activeElement?.blur(); return true;');

  // ---- The menu bar Electron holds ----------------------------------------------------
  let bar = await readBar(page);
  c.eq(
    'the menu bar holds the nine menus',
    labelsOf(bar).join(', '),
    'File, Edit, View, Transform, Sketch, Layers, Pages, Automate, Help',
  );
  const edit = labelsOf(menuOf(bar, 'Edit'));
  c.ok('Rotate and Mirror have left Edit', !edit.includes('Rotate…') && !edit.includes('Mirror…'), edit.join(' | '));
  c.ok('Edit holds the two editors', edit.includes('Edit Keyboard Shortcuts…') && edit.includes('Edit Tool Types…'));
  c.eq(
    'Transform holds its rows',
    labelsOf(menuOf(bar, 'Transform')).join(' | '),
    'Vector Path | --- | Transform Box | Move… | Rotate… | Join | Close Shape | Mirror… | --- | Sharpen | Mesh Warp',
  );
  c.eq('Sketch holds its tools', labelsOf(menuOf(bar, 'Sketch')).join(' | '), 'Pen | Marker | Eraser | Text | Copic | Direct | --- | Stroke Profile…');
  const rotate = rowOf(bar, 'rotate');
  c.ok('Rotate shows Ctrl+R and leaves the key to the page', rotate?.accelerator === 'CmdOrCtrl+R' && rotate?.registerAccelerator === false, JSON.stringify(rotate));
  const save = rowOf(bar, 'save');
  c.ok('Save keeps the key it always claimed', save?.accelerator === 'CmdOrCtrl+S' && save?.registerAccelerator === true, JSON.stringify(save));
  const view = labelsOf(menuOf(bar, 'View'));
  c.ok(
    "Electron's own labels for the role rows are the registry's",
    ['Toggle Developer Tools', 'Zoom In', 'Zoom Out', 'Toggle Full Screen'].every((label) => view.includes(label)) &&
      labelsOf(menuOf(bar, 'File')).at(-1) === 'Exit',
    view.join(' | '),
  );
  const help = labelsOf(menuOf(bar, 'Help'));
  c.ok('Help has Source Code and, with no docs site yet, no Source Docs', help.includes('Source Code') && !help.includes('Source Docs'), help.join(' | '));
  const track = rowOf(bar, 'track-history');
  c.ok('Track History is a check mark, off', track?.type === 'checkbox' && track?.checked === false, JSON.stringify(track));

  // ---- The menu bar greys what there is nothing to act on --------------------------------
  await page.chord(65, 'a', 2 | 8); // Ctrl+Shift+A: select nothing
  await sleep(400);
  bar = await readBar(page);
  c.ok('with nothing selected, Cut is greyed in the menu bar', rowOf(bar, 'cut')?.enabled === false);
  c.ok('and Paste in Place, with nothing copied', rowOf(bar, 'paste-in-place')?.enabled === false);
  c.ok('while Paste stays on, for what another editor copied', rowOf(bar, 'paste')?.enabled === true);
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(400);
  bar = await readBar(page);
  c.ok('selecting all turns Cut and Duplicate on', rowOf(bar, 'cut')?.enabled === true && rowOf(bar, 'duplicate')?.enabled === true);
  await page.chord(67, 'c', 2); // Ctrl+C
  await sleep(400);
  bar = await readBar(page);
  c.ok('copying turns Paste in Place on', rowOf(bar, 'paste-in-place')?.enabled === true);

  // ---- The canvas ------------------------------------------------------------------------------
  // Away from the imported triangle, which lands at the top left - a
  // right-click on art picks it, and this one is meant to land on nothing -
  // and above the status bar, which covers the bottom of the canvas.
  const wrap = await page.evalIn(`const r = document.getElementById('canvas-wrap').getBoundingClientRect(); return { x: r.right - 40, y: (r.top + r.bottom) / 2 };`);
  await page.chord(65, 'a', 2 | 8);
  await sleep(300);
  await rightClick(page, wrap);
  c.eq(
    'the canvas menu, with nothing selected',
    (await page.evalIn(ROWS('context-menu')))?.join(' | '),
    'Cut [Ctrl+X] (disabled) | Copy [Ctrl+C] (disabled) | Paste [Ctrl+V] | Paste in Place [Ctrl+Shift+V] | Duplicate [Ctrl+D] (disabled) | --- | Delete [Delete] (disabled) | --- | Select All [Ctrl+A] | Deselect All [Ctrl+Shift+A] (disabled)',
  );
  await escape(page);
  c.eq('Escape closes it', await page.evalIn(ROWS('context-menu')), null);
  await page.chord(65, 'a', 2);
  await sleep(300);
  await rightClick(page, wrap);
  c.eq(
    'the canvas menu, with everything selected',
    (await page.evalIn(ROWS('context-menu')))?.join(' | '),
    'Cut [Ctrl+X] | Copy [Ctrl+C] | Paste [Ctrl+V] | Paste in Place [Ctrl+Shift+V] | Duplicate [Ctrl+D] | --- | Delete [Delete] | --- | Select All [Ctrl+A] | Deselect All [Ctrl+Shift+A]',
  );
  await escape(page);

  // ---- The layers panel ----------------------------------------------------------------------
  const layersList = await page.evalIn(CENTER('layers-list'));
  await rightClick(page, layersList);
  const layerRows = (await page.evalIn(ROWS('context-menu'))) ?? [];
  c.eq(
    'the layers panel menu, labels in order',
    layerRows.map((row) => row.replace(/ \(disabled\)$/, '')).join(' | '),
    'Add Layer | Group Layer [Ctrl+G] | Ungroup [Ctrl+Shift+G] | Rename [F2] | Delete Layer | --- | Cut [Ctrl+X] | Copy [Ctrl+C] | Paste [Ctrl+V] | Paste in Place [Ctrl+Shift+V] | Duplicate [Ctrl+D] | --- | Move > | --- | Hide Layers Panel',
  );
  await hover(page, await page.evalIn(ROW_CENTER('context-menu', 'Move')));
  c.eq(
    'Move opens Layer Up and Layer Down beside it',
    (await page.evalIn(ROWS('context-submenu')))?.join(' | '),
    'Layer Up [Ctrl+]] | Layer Down [Ctrl+[]',
  );
  // The new layer goes beside the active one, which the import left inside a
  // folded group, so the rows the panel shows need not change: the toast,
  // written after the layer is added, is what says the row ran.
  await page.evalIn("document.getElementById('toast').textContent = ''; return true;");
  await page.click(...Object.values(await page.evalIn(ROW_CENTER('context-menu', 'Add Layer'))));
  await sleep(400);
  const added = await page.evalIn(STATE);
  c.ok('a click on Add Layer adds a layer, and names it', /^Added layer "Layer [0-9]+"[.]$/.test(added.toast), added.toast);
  c.eq('and the menu has gone', await page.evalIn(ROWS('context-menu')), null);

  // ---- The pages panel, through its toolbar button --------------------------------------------
  // With everything selected, so From Selection has something to start a page from.
  await page.chord(65, 'a', 2);
  await sleep(300);
  await page.click(...Object.values(await page.evalIn(CENTER('pages-toggle'))));
  await sleep(500);
  c.ok('the Pages button opens the panel', (await page.evalIn(STATE)).pagesOpen);
  await rightClick(page, await page.evalIn(CENTER('thumbs')));
  c.eq(
    'the pages panel menu',
    (await page.evalIn(ROWS('context-menu')))?.join(' | '),
    'Add Page > | Delete Page (disabled) | --- | Page Settings… | --- | Hide Pages Panel',
  );
  await hover(page, await page.evalIn(ROW_CENTER('context-menu', 'Add Page')));
  c.eq(
    'Add Page opens the three ways to start a page',
    (await page.evalIn(ROWS('context-submenu')))?.join(' | '),
    'Default New Page | Custom New Page… | From Selection',
  );
  await escape(page);

  await page.click(...Object.values(await page.evalIn(CENTER('pages-menu'))));
  await sleep(300);
  c.eq(
    "the page menu drops down Add Page's rows",
    (await page.evalIn(ROWS('context-menu')))?.join(' | '),
    'Default New Page | Custom New Page… | From Selection',
  );
  await page.click(...Object.values(await page.evalIn(ROW_CENTER('context-menu', 'Default New Page'))));
  await sleep(500);
  const paged = await page.evalIn(STATE);
  c.ok('Default New Page adds a page', paged.page === 'Page 2 / 2' && /Added a new page/.test(paged.toast), JSON.stringify(paged));
  bar = await readBar(page);
  c.ok('and with two pages, Delete Page is on in the menu bar', rowOf(bar, 'delete-page')?.enabled === true);

  // ---- The toolbar dropdowns -------------------------------------------------------------------
  await page.click(...Object.values(await page.evalIn(CENTER('export'))));
  await sleep(300);
  const exportRows = (await page.evalIn(ROWS('context-menu'))) ?? [];
  c.eq(
    'the Export button lists four formats and the Selection row',
    exportRows.map((row) => row.replace(/ \(disabled\)/, '')).join(' | '),
    'PNG Image… | SVG Vector… | JPEG Image… | PDF Document… | --- | Selection >',
  );
  await escape(page);

  const closeShape = await page.evalIn(CENTER('close-shape'));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, ...closeShape, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  }
  await sleep(300);
  c.eq(
    'Close Shape offers its two joins',
    (await page.evalIn(ROWS('context-menu')))?.join(' | '),
    'Sharp - straight line between the end points | Smooth - curve on through the end points',
  );
  await escape(page);

  // ---- Rows of the menu bar run their commands --------------------------------------------------
  const clickRow = (id) => page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
  c.ok('Sketch > Pen is a row the menu bar runs', await clickRow('tool-pen'));
  await sleep(300);
  c.eq('and the pen is in hand', (await page.evalIn(STATE)).tool, 'pen');
  await clickRow('tool-point');
  await sleep(300);
  c.eq('Sketch > Direct takes the Direct Select tool', (await page.evalIn(STATE)).tool, 'point');

  await clickRow('track-history');
  await sleep(400);
  c.ok('Automate > Track History turns tracking on', (await page.evalIn(STATE)).toast.startsWith('Track History is on:'), (await page.evalIn(STATE)).toast);
  c.eq('and checks its row', rowOf(await readBar(page), 'track-history')?.checked, true);
  await clickRow('track-history');
  await sleep(400);
  c.eq('a second click turns it off again', (await page.evalIn(STATE)).toast, 'Track History is off.');
  c.eq('and the check mark goes', rowOf(await readBar(page), 'track-history')?.checked, false);

  // Transform > Transform Box puts the box up round the selection and checks
  // its row while it is up; with nothing selected it says what it needs.
  // The triangle is on the first page, and the page added above is in view.
  await page.click(...Object.values(await page.evalIn(CENTER('prev-page'))));
  await sleep(500);
  await page.evalIn('document.activeElement?.blur(); return true;');
  await page.chord(65, 'a', 2 | 8); // Ctrl+Shift+A: nothing selected
  await sleep(300);
  await clickRow('toggle-transform');
  await sleep(300);
  c.eq('Transform > Transform Box with nothing selected says what it needs', (await page.evalIn(STATE)).toast, 'Select something to transform first.');
  c.eq('and leaves its row unchecked', rowOf(await readBar(page), 'toggle-transform')?.checked, false);
  await clickRow('select-all');
  await sleep(300);
  await clickRow('toggle-transform');
  await sleep(400);
  const boxUp = (await page.evalIn(STATE)).toast;
  c.ok('with a selection it puts the box up', boxUp.startsWith('Transform: drag a handle'), boxUp);
  c.eq('and checks its row', rowOf(await readBar(page), 'toggle-transform')?.checked, true);
  await clickRow('toggle-transform');
  await sleep(400);
  c.eq('a second click takes the box away, and the check mark with it', rowOf(await readBar(page), 'toggle-transform')?.checked, false);

  // Sketch > Stroke Profile… opens the picker the toolbar's control opens.
  c.ok('Sketch > Stroke Profile… is a row the menu bar runs', await clickRow('stroke-profile'));
  await sleep(300);
  c.ok('and opens the Stroke Profile picker', await page.evalIn("return !document.getElementById('profile-dialog').classList.contains('is-hidden');"));
  await page.chord(27, 'Escape');
  await sleep(300);
  c.ok('which Escape closes', await page.evalIn("return document.getElementById('profile-dialog').classList.contains('is-hidden');"));

  c.ok('Help > Verbose is a row the menu bar runs', await clickRow('help-verbose'));
  await sleep(800);
  c.ok('and opens the documentation window', (await pages()).some((t) => t.url.includes('/docs/guide/index.html')));

  await clickRow('toggle-layers');
  await sleep(400);
  bar = await readBar(page);
  c.ok('View > Toggle Layers Panel hides the panel', !(await page.evalIn(STATE)).layersOpen);
  c.ok('which greys Layers > Hide Layers Panel', rowOf(bar, 'hide-layers')?.enabled === false);
  c.eq('and a greyed row cannot be clicked', await clickRow('hide-layers'), false);
  await clickRow('toggle-layers');
  await sleep(400);
  c.ok('and it comes back', (await page.evalIn(STATE)).layersOpen);

  // ---- A toolbar button runs its command -------------------------------------------------------
  await page.click(...Object.values(await page.evalIn(CENTER('tool-marker'))));
  await sleep(300);
  c.eq('the Marker button takes the marker', (await page.evalIn(STATE)).tool, 'marker');

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
