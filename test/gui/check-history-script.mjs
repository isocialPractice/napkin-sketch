/**
 * Automate > Generate Script > From Session History, in the running app.
 *
 * With Track History on, two pen strokes are drawn with real pointer events
 * and the first is turned 90 degrees in the Rotate dialog: three steps. The
 * row opens the configuration popup as the mockup draws it - its title, the
 * hint, "History Limit" across the top of the table, a row per step with its
 * index, tool type and command, every one ticked - and its search keeps the
 * Rotate row alone. Unticking the rotation and accepting shows the script in
 * the Generated script dialog: a comment for each of the two strokes, the
 * rotation left out, and the page it opens holds both strokes as drawn, lying
 * flat. Every step ticked, the rotation is in, and the page it opens stands
 * the first stroke on end. Accept with nothing ticked says to tick a step and
 * keeps the popup; Escape closes it; and on a page with no steps of its own
 * the row says the steps are on other pages.
 *
 * The app runs with a user-data folder of the check's own, made for the run
 * and removed after it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-history-script-'));
const app = launch({ mode: 'new', sketchName: 'history-script' }, { NAPKIN_USER_DATA: userData });

/** A straight mouse drag, which the pen draws. */
async function drag(page, from, to, steps = 16) {
  const mouse = (type, p, buttons) =>
    page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1 });
  await mouse('mouseMoved', from, 0);
  await mouse('mousePressed', from, 1);
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, 1);
  }
  await mouse('mouseReleased', to, 0);
  await sleep(250);
}

/** The popup as a person sees it. */
const POPUP = `
  const root = document.getElementById('config-dialog');
  const lines = [...root.querySelectorAll('tbody tr')];
  return {
    open: !root.classList.contains('is-hidden'),
    title: root.querySelector('.config-title').textContent,
    hint: root.querySelector('.config-hint').textContent,
    header: root.querySelector('.config-header').textContent,
    filters: [...root.querySelectorAll('.config-filter')].map((label) => label.textContent),
    rows: lines.map((tr) => ({
      shown: !tr.hidden,
      ticked: tr.querySelector('.config-check')?.checked ?? null,
      cells: [...tr.cells].slice(1).map((cell) => cell.textContent),
    })),
    status: root.querySelector('.config-status').textContent,
  };
`;

/** The Generated script dialog. */
const SCRIPT = `
  const root = document.getElementById('script-dialog');
  return {
    open: !root.classList.contains('is-hidden'),
    title: document.getElementById('script-title').textContent,
    stats: document.getElementById('script-stats').textContent,
  };
`;

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn('document.activeElement?.blur(); return true;');

  const menu = async (id) => {
    const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
    await sleep(500);
    return ran;
  };
  const hook = (call) => page.evalIn(`return await window.napkinCheck.${call};`);
  const toast = () => page.evalIn("return document.getElementById('toast').textContent;");
  const popup = () => page.evalIn(POPUP);
  const scriptView = () => page.evalIn(SCRIPT);
  const clickOn = async (selector) => {
    const at = await page.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'nearest' });
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    if (!at) throw new Error(`nothing to click at ${selector}`);
    await page.click(at.x, at.y);
    await sleep(300);
  };
  const rowCheck = (n) => `#config-dialog tbody tr:nth-child(${n}) .config-check`;
  /** Opens the new page a script draws and says how its ink lies. */
  const openAndMeasure = async () => {
    const before = await hook('pageCount()');
    await clickOn('#script-open');
    await sleep(600);
    const index = await hook('activePage()');
    const info = await hook(`pageInfo(${index})`);
    return { added: (await hook('pageCount()')) === before + 1, index, marks: info.marks, ink: info.ink };
  };

  // ---- A session: two strokes, one turned ----------------------------------------------------------
  await menu('track-history');
  await menu('tool-pen');
  const box = await page.evalIn("const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };");
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  await drag(page, { x: cx - 220, y: cy - 40 }, { x: cx - 60, y: cy - 40 });
  await drag(page, { x: cx - 220, y: cy + 40 }, { x: cx - 60, y: cy + 40 });
  const firstLayer = await page.evalIn("const rows = [...document.querySelectorAll('#layers-list .layer-row')]; const i = rows.findIndex((r) => r.querySelector('.layer-name')?.textContent === 'Layer 1'); return i >= 0 ? i + 1 : null;");
  await clickOn(`#layers-list .layer-row:nth-child(${firstLayer}) .layer-name`);
  await menu('rotate');
  await page.evalIn("const input = document.getElementById('rotate-angle'); input.focus(); input.select(); return true;");
  await page.send('Input.insertText', { text: '90' });
  await sleep(200);
  await page.chord(13, 'Enter');
  await sleep(300);
  await page.chord(27, 'Escape');
  await sleep(300);
  c.eq('the session is three steps', (await hook('trackedSteps()')).length, 3);

  // ---- The popup ---------------------------------------------------------------------------------------
  c.eq('Generate Script > From Session History runs from the menu bar', await menu('script-from-history'), true);
  let v = await popup();
  c.ok(
    'it opens the popup as the mockup draws it',
    v.open && v.title === 'Generate Script: From Session History' && v.hint === 'Uncheck history items to exclude from script.' && v.header === 'History Limit : 500  (3 of 500 steps recorded)',
    JSON.stringify({ title: v.title, hint: v.hint, header: v.header }),
  );
  c.ok(
    'a row per step - index, tool type, command - every one ticked',
    JSON.stringify(v.rows.map((r) => r.cells)) === JSON.stringify([['1', 'Draw:Add:mark', 'Pen stroke'], ['2', 'Draw:Add:mark', 'Pen stroke'], ['3', 'Draw:Modify:element', 'Rotate']]) && v.rows.every((r) => r.ticked),
    JSON.stringify(v.rows),
  );
  c.eq('with a radio button for the one main type', v.filters.join(), 'All,Draw');
  await clickOn('#config-dialog .config-search');
  await page.send('Input.insertText', { text: 'rotate' });
  await sleep(250);
  v = await popup();
  c.eq('the search keeps the Rotate row alone', v.rows.filter((r) => r.shown).map((r) => r.cells[2]).join(), 'Rotate');
  await page.chord(65, 'a', 2); // Ctrl+A, kept by the search box
  await page.chord(8, 'Backspace');
  await sleep(250);
  c.eq('and emptied, keeps every row again', (await popup()).rows.filter((r) => r.shown).length, 3);

  // ---- The rotation left out ------------------------------------------------------------------------------
  await clickOn(rowCheck(3));
  c.eq('a click unticks the rotation', (await popup()).rows[2].ticked, false);
  await clickOn('#config-dialog .config-accept');
  await sleep(500);
  let s = await scriptView();
  c.ok('Accept closes the popup and shows the script', !(await popup()).open && s.open && s.title === 'Generated script: From Session History - 2 steps', JSON.stringify(s));
  let text = await hook('scriptText()');
  c.ok(
    'with the version and the page it came from, and the step left out',
    /^# Written by napkin-sketch \d+\.\d+\.\d+\S* from the session history of "history-script", \d{4}-\d\d-\d\d \d\d:\d\d\.\n# 2 steps of 3; left out: 3\.\n/.test(text),
    text.split('\n').slice(0, 2).join(' | '),
  );
  c.ok(
    'a comment for each stroke and none for the rotation',
    /^# 1 {2}Draw:Add:mark {2}Pen stroke {2}\(/m.test(text) && /^# 2 {2}Draw:Add:mark {2}Pen stroke {2}\(/m.test(text) && !/Rotate|modified mark/.test(text),
    text.split('\n').filter((line) => line.startsWith('#')).join(' | '),
  );
  c.eq('the line under the title counts two marks', /, 2 marks, /.test(s.stats), true);
  const flat = await openAndMeasure();
  let opened = flat;
  c.ok(
    'the page it opens holds both strokes as drawn, lying flat',
    opened.added && opened.marks === 2 && opened.ink && opened.ink.width > opened.ink.height,
    JSON.stringify(opened),
  );

  // ---- On a page with no steps of its own ----------------------------------------------------------------
  await menu('script-from-history');
  c.ok('on the new page, which has no steps, the row says where they are', !(await popup()).open && (await toast()) === 'Nothing is recorded on this page: the steps recorded so far are on other pages.', await toast());

  // ---- Every step ticked -----------------------------------------------------------------------------------
  c.eq('back on the first page', await hook('goToPage(0)'), 0);
  await sleep(300);
  await menu('script-from-history');
  c.ok('the popup opens with every step ticked again', (await popup()).rows.every((r) => r.ticked));
  await clickOn('#config-dialog .config-accept');
  await sleep(500);
  text = await hook('scriptText()');
  c.ok(
    'the rotation is in, a change to the first stroke',
    /^# 3 {2}Draw:Modify:element {2}Rotate {2}\(.*\)\n# modified mark from step 1$/m.test(text) && /^# 3 steps, every one recorded on this page\.$/m.test(text),
    text.split('\n').filter((line) => line.startsWith('#')).join(' | '),
  );
  s = await scriptView();
  c.eq('and the title counts three steps', s.title, 'Generated script: From Session History - 3 steps');
  opened = await openAndMeasure();
  // Turned on end, the first stroke reaches the stroke length above the second: the ink is twice as tall as when both lay flat.
  c.ok('the page it opens stands the first stroke on end', opened.added && opened.marks === 2 && opened.ink && flat.ink && opened.ink.height > flat.ink.height + 50, `${JSON.stringify(opened.ink)} against ${JSON.stringify(flat.ink)}`);

  // ---- Nothing ticked, and Escape --------------------------------------------------------------------------
  await hook('goToPage(0)');
  await sleep(300);
  await menu('script-from-history');
  for (const n of [1, 2, 3]) await clickOn(rowCheck(n));
  await clickOn('#config-dialog .config-accept');
  v = await popup();
  c.ok('Accept with nothing ticked says to tick a step, and keeps the popup', v.open && v.status === 'Tick at least one step to write.' && !(await scriptView()).open, JSON.stringify({ open: v.open, status: v.status }));
  await page.chord(27, 'Escape');
  await sleep(300);
  c.ok('Escape closes it and opens nothing', !(await popup()).open && !(await scriptView()).open);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
