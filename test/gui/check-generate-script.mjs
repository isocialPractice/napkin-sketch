/**
 * Automate > Generate Script, in the running app.
 *
 * The page starts with gradient-figure.svg imported. Two of its three parts
 * are picked in the Layers panel - a click and a Ctrl+click, as a person
 * picks them - and Generate Script > Selected Layers shows their script:
 * those two parts (each a group round the layer the importer named for its
 * path) and the group above them, and not the third. Keys typed in
 * the dialog stay there: a tool letter picks no tool and Ctrl+Z undoes
 * nothing behind it, while Ctrl+A in the script selects the script. Fit to
 * the selection writes a page the selection's size, and Open as New Page
 * runs the script into a page whose ink is the selection's, moved to the
 * corner.
 *
 * From Media File writes the same SVG whole, and the page it opens has the
 * import's ink where the import put it. A PNG is linked by its file name at
 * its own size; Embed the image data puts the picture in the script, which
 * the view shortens and says so; Copy says how many lines it copied; and the
 * page it opens is the picture's size. Escape and Cancel close the dialog and
 * open nothing, and with nothing selected the Selected Layers row is greyed.
 *
 * The app runs with a user-data folder of the check's own, made for the run
 * and removed after it.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SVG = join(ROOT, 'test', 'imports', 'gradient-figure.svg');
const PNG = join(ROOT, 'ai-helper', 'vectors', 'skills', 'vector-graphics', 'assets', 'isometric-objects.png');
const PNG_NAME = basename(PNG);
const pngBytes = readFileSync(PNG);
const PNG_SIZE = { width: pngBytes.readUInt32BE(16), height: pngBytes.readUInt32BE(20) };
const SKETCH = 'generate-script';

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-generate-script-'));
const app = launch({ mode: 'new', sketchName: SKETCH, importFiles: [SVG] }, { NAPKIN_USER_DATA: userData });

const VIEW = `
  const root = document.getElementById('script-dialog');
  const shown = (id) => !document.getElementById(id).classList.contains('is-hidden');
  return {
    open: !root.classList.contains('is-hidden'),
    title: document.getElementById('script-title').textContent,
    stats: document.getElementById('script-stats').textContent,
    embedRow: shown('script-embed-row'),
    fitRow: shown('script-fit-row'),
    notes: [...document.querySelectorAll('#script-notes li')].map((li) => li.textContent),
    shortened: shown('script-shortened'),
    text: document.getElementById('script-text').textContent,
    focus: document.activeElement ? document.activeElement.id : '',
  };
`;

const STATE = `return {
  tool: document.getElementById('canvas').dataset.tool,
  toast: document.getElementById('toast').textContent,
  rows: document.querySelectorAll('#layers-list .layer-row').length,
};`;

/** A row of the menu bar by id, wherever it sits. */
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

/** Two boxes are the same within `tolerance` on every side. */
const sameBox = (a, b, tolerance) =>
  !!a && !!b && ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= tolerance);
const shownBox = (box) => (box ? ['x', 'y', 'width', 'height'].map((key) => Number(box[key].toFixed(3))).join(' ') : 'none');

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn('document.activeElement?.blur(); return true;');

  const view = () => page.evalIn(VIEW);
  const state = () => page.evalIn(STATE);
  const hook = (call) => page.evalIn(`return await window.napkinCheck.${call};`);
  const redoEnabled = async () => rowOf(await page.evalIn('return await window.napkin.getAppMenu();'), 'redo')?.enabled;
  const centerOf = (selector) =>
    page.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center' });
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
  /** A left click at an element's middle, with `modifiers` held (2 for Ctrl). */
  const clickOn = async (selector, modifiers = 0) => {
    const at = await centerOf(selector);
    if (!at) throw new Error(`nothing to click at ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0, modifiers });
    }
    await sleep(300);
  };
  /** The Layers panel row for a layer name, as a selector a click can use. */
  const rowFor = async (name) => {
    const index = await page.evalIn(`return [...document.querySelectorAll('#layers-list .layer-row')].findIndex((row) => row.querySelector('.layer-name')?.textContent === ${JSON.stringify(name)});`);
    return index >= 0 ? `#layers-list .layer-row:nth-child(${index + 1}) .layer-name` : null;
  };
  const menu = async (id) => {
    const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
    await sleep(600);
    return ran;
  };

  // ---- Picking two parts ---------------------------------------------------------------------------
  if (await centerOf('#layers-list .layer-caret[aria-label="Expand gradient-figure"]')) {
    await clickOn('#layers-list .layer-caret[aria-label="Expand gradient-figure"]');
  }
  const linear = await rowFor('linear-part');
  const inherited = await rowFor('inherited-part');
  c.ok('the import shows its parts in the Layers panel', linear && inherited && (await rowFor('radial-part')), `${linear} ${inherited}`);
  await clickOn(linear);
  await clickOn(await rowFor('inherited-part'), 2);
  const selection = await hook('selectionInkBox()');
  c.ok('a click and a Ctrl+click pick two parts', !!selection, shownBox(selection));

  // ---- Selected Layers -------------------------------------------------------------------------------
  const rowsBefore = (await state()).rows;
  c.eq('Automate > Generate Script > Selected Layers runs from the menu bar', await menu('script-from-layers'), true);
  let v = await view();
  c.ok(
    'and opens the Generated script dialog, the script in focus',
    v.open && v.title === 'Generated script: Selected Layers - 2 layers' && v.focus === 'script-text' && v.fitRow && !v.embedRow,
    JSON.stringify({ title: v.title, focus: v.focus, fitRow: v.fitRow, embedRow: v.embedRow }),
  );
  c.ok('the script says where it came from', v.text.startsWith('# Written by napkin-sketch from 2 layers.\n'), v.text.slice(0, 80));
  c.ok(
    'it draws the two parts in the group above them, and not the third',
    v.text.includes('group "gradient-figure" {') && v.text.includes('group "linear-part" {') && v.text.includes('group "inherited-part" {') && !v.text.includes('radial'),
    v.text.split('\n').filter((line) => /layer|group/.test(line)).join(' | '),
  );
  c.ok('the line under the title counts it', /^\d+ instructions, 2 marks, \d+ layers$/.test(v.stats), v.stats);
  c.eq('the view shows the whole script, with no image data to shorten', v.text === (await hook('scriptText()')) && !v.shortened, true);

  // ---- Keys stay in the dialog -----------------------------------------------------------------------
  const toolBefore = (await state()).tool;
  await page.chord(69, 'e'); // E, the eraser
  await sleep(250);
  c.eq('a tool letter typed in the dialog picks no tool', (await state()).tool, toolBefore);
  await page.chord(90, 'z', 2); // Ctrl+Z
  await sleep(500);
  c.ok("Ctrl+Z in the dialog does not undo the import behind it", (await redoEnabled()) === false && (await state()).rows === rowsBefore);
  await page.evalIn("document.getElementById('script-text').focus(); return true;");
  await page.chord(65, 'a', 2); // Ctrl+A
  await sleep(250);
  // A selection reads back as the text a person would copy, which can drop
  // the script's last line break, so the two are compared without it.
  const selected = await page.evalIn(`
    const pre = document.getElementById('script-text');
    const sel = window.getSelection();
    return { same: sel.toString().trim() === pre.textContent.trim(), selected: sel.toString().length, text: pre.textContent.length, inside: sel.rangeCount === 1 && pre.contains(sel.getRangeAt(0).commonAncestorContainer) };
  `);
  c.ok('Ctrl+A in the script selects the script', selected.same && selected.inside, JSON.stringify(selected));

  // ---- Fit to the selection, and Open as New Page ------------------------------------------------------
  await clickOn('#script-fit-row input[value="fit"]');
  const fitted = await hook('scriptText()');
  const pageLine = /^page (\d+) (\d+)$/m.exec(fitted);
  c.ok(
    'fit to the selection writes a page the selection\'s size',
    pageLine && Number(pageLine[1]) === Math.ceil(selection.width) && Number(pageLine[2]) === Math.ceil(selection.height),
    pageLine ? pageLine[0] : 'no page line',
  );
  c.eq('and the view shows the script written again', (await view()).text, fitted);
  const pagesBefore = await hook('pageCount()');
  const activeBefore = await hook('activePage()');
  await clickOn('#script-open');
  await sleep(600);
  let s = await state();
  const opened = await hook(`pageInfo(${activeBefore + 1})`);
  c.ok(
    'Open as New Page closes the dialog and adds the page after the one in view',
    !(await view()).open && (await hook('pageCount()')) === pagesBefore + 1 && (await hook('activePage()')) === activeBefore + 1,
    s.toast,
  );
  c.eq('and says so', s.toast, `Opened "${SKETCH}-selection" as a new page.`);
  c.ok(
    'the new page is the selection\'s size, its two parts in their group',
    opened.width === Math.ceil(selection.width) && opened.height === Math.ceil(selection.height) && opened.marks === 2 &&
      ['linear-part', 'inherited-part', 'gradient-figure'].every((name) => opened.layers.includes(name)) && !opened.layers.includes('radial-part'),
    JSON.stringify({ width: opened.width, height: opened.height, marks: opened.marks, layers: opened.layers }),
  );
  c.ok(
    'with their ink moved to the corner, the same size as it was',
    sameBox(opened.ink, { x: 0, y: 0, width: selection.width, height: selection.height }, 0.02),
    `${shownBox(opened.ink)} from ${shownBox(selection)}`,
  );

  // ---- Nothing selected ------------------------------------------------------------------------------
  // The new page starts with nothing selected, and the row says so by greying.
  const row = rowOf(await page.evalIn('return await window.napkin.getAppMenu();'), 'script-from-layers');
  c.ok('with nothing selected, Selected Layers is greyed', row && row.enabled === false, JSON.stringify(row && { enabled: row.enabled }));
  c.ok('and a click on it opens nothing', (await menu('script-from-layers')) === false && !(await view()).open);

  // ---- From Media File: an SVG -----------------------------------------------------------------------
  c.eq('From Media File reads an SVG', await hook(`generateScriptFromFile(${JSON.stringify(SVG)})`), true);
  await sleep(300);
  v = await view();
  c.ok(
    'and shows its script, with no choice to make',
    v.open && v.title === 'Generated script: From Media File - gradient-figure.svg' && !v.fitRow && !v.embedRow,
    JSON.stringify({ title: v.title, fitRow: v.fitRow, embedRow: v.embedRow }),
  );
  c.ok(
    'every part of the file is in it',
    v.text.startsWith('# Written by napkin-sketch from gradient-figure.svg.\n') && ['linear-part', 'radial-part', 'inherited-part'].every((name) => v.text.includes(`"${name}"`)),
    v.text.slice(0, 80),
  );
  const imported = await hook('pageInfo(0)');
  const count = await hook('pageCount()');
  await clickOn('#script-open');
  await sleep(600);
  const drawn = await hook(`pageInfo(${await hook('activePage()')})`);
  c.ok(
    "the page it opens is the file's size, with the import's ink where the import put it",
    (await hook('pageCount()')) === count + 1 && drawn.name === 'gradient-figure' && drawn.width === 120 && drawn.height === 80 && sameBox(drawn.ink, imported.ink, 0.02),
    `${drawn.name} ${drawn.width}x${drawn.height}, ${shownBox(drawn.ink)} against ${shownBox(imported.ink)}`,
  );

  // ---- From Media File: a picture ----------------------------------------------------------------------
  c.eq('From Media File reads a PNG', await hook(`generateScriptFromFile(${JSON.stringify(PNG)})`), true);
  await sleep(300);
  v = await view();
  const linkLine = `link "${PNG_NAME}" at 0 0 size ${PNG_SIZE.width} ${PNG_SIZE.height}`;
  c.ok(
    'a picture is linked by its file name, on a page its own size',
    v.open && v.embedRow && !v.fitRow && v.text.includes(`\npage ${PNG_SIZE.width} ${PNG_SIZE.height}\n`) && v.text.includes(linkLine) && !v.text.includes('data:') && !v.shortened,
    v.text.split('\n').filter((line) => /^(page|link)/.test(line)).join(' | '),
  );
  await clickOn('#script-embed');
  const embedded = await hook('scriptText()');
  v = await view();
  c.ok(
    'Embed the image data puts the picture in the script',
    embedded.includes(`image "data:image/png;base64,${pngBytes.toString('base64')}" at 0 0 size ${PNG_SIZE.width} ${PNG_SIZE.height}`),
    embedded.length + ' characters',
  );
  c.ok(
    'which the view shortens, and says so',
    v.shortened && /image "data:image\/png;base64,[A-Za-z0-9+/]{32}\.\.\. \(\d+(\.\d)? KB of image data\)"/.test(v.text) && v.text.length < 2000,
    v.text.split('\n').find((line) => line.startsWith('image')) ?? 'no image line',
  );
  c.eq('the line under the title counts it', v.stats, '6 instructions, 1 mark, 1 layer');
  await clickOn('#script-copy');
  await sleep(300);
  const lines = embedded.trimEnd().split('\n').length;
  c.eq('Copy says how many lines it copied', (await state()).toast, `Copied the script, ${lines} lines.`);
  c.eq('and the dialog stays up', (await view()).open, true);
  await clickOn('#script-open');
  await sleep(800);
  const picture = await hook(`pageInfo(${await hook('activePage()')})`);
  c.ok(
    'the page it opens is the picture\'s size, the picture on a layer named for the file',
    picture.width === PNG_SIZE.width && picture.height === PNG_SIZE.height && picture.marks === 1 && picture.layers.join() === PNG_NAME,
    JSON.stringify({ width: picture.width, height: picture.height, marks: picture.marks, layers: picture.layers }),
  );

  // ---- Escape and Cancel -----------------------------------------------------------------------------
  const pagesNow = await hook('pageCount()');
  await hook(`generateScriptFromFile(${JSON.stringify(SVG)})`);
  await sleep(300);
  await page.chord(27, 'Escape');
  await sleep(300);
  c.ok('Escape closes the dialog and opens nothing', !(await view()).open && (await hook('pageCount()')) === pagesNow);
  await hook(`generateScriptFromFile(${JSON.stringify(SVG)})`);
  await sleep(300);
  await clickOn('#script-cancel');
  c.ok('Cancel closes it too', !(await view()).open && (await hook('pageCount()')) === pagesNow);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
