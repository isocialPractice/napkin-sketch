/**
 * Automate > Track History, in the running app.
 *
 * Tracking starts off, with its menu row unchecked and From Session History
 * greyed. The row turns it on and says so. Two brush strokes drawn with real
 * pointer events, one of them turned 90 degrees in the Rotate dialog, and an
 * undo are four steps, read back through the check hook: two "Brush stroke"
 * steps that each added a mark, a "Rotate" and an "Undo" that each changed
 * one. From Session History is no longer greyed once there is history.
 *
 * Automate > History Limit opens Verbose Settings at its Automate section,
 * which shows the switch on and the four steps. Its limit slider sets the
 * drawing window's limit, and its switch turns tracking off, which clears
 * the steps, unchecks the menu row and greys From Session History again.
 *
 * The app runs with a user-data folder of the check's own, made for the run
 * and removed after it, so the setting it turns on is no one else's.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-track-history-'));
const app = launch({ mode: 'new', sketchName: 'track-history' }, { NAPKIN_USER_DATA: userData });

/** A row of the menu bar by id, wherever it sits. */
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

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

let settings = null;
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn('document.activeElement?.blur(); return true;');

  const bar = () => page.evalIn('return await window.napkin.getAppMenu();');
  const row = async (id) => rowOf(await bar(), id);
  const menu = async (id) => {
    const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
    await sleep(500);
    return ran;
  };
  const hook = (call) => page.evalIn(`return await window.napkinCheck.${call};`);
  const toast = () => page.evalIn("return document.getElementById('toast').textContent;");
  const clickOn = async (selector) => {
    const at = await page.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    if (!at) throw new Error(`nothing to click at ${selector}`);
    await page.click(at.x, at.y);
    await sleep(300);
  };

  // ---- Off, then on ------------------------------------------------------------------------------
  let track = await row('track-history');
  let fromHistory = await row('script-from-history');
  c.ok('Track History starts off, and From Session History greyed', track?.checked === false && fromHistory?.enabled === false, JSON.stringify({ track, fromHistory: fromHistory && { enabled: fromHistory.enabled } }));
  c.eq('Automate > Track History runs from the menu bar', await menu('track-history'), true);
  track = await row('track-history');
  c.eq('and checks its row', track?.checked, true);
  c.eq('saying what it does', await toast(), 'Track History is on: every step of the drawing is recorded, and the last 500 are kept.');
  let stats = await hook('historyStats()');
  c.ok('with nothing recorded yet', stats.tracking && stats.steps === 0 && stats.limit === 500, JSON.stringify(stats));

  // ---- Two strokes, a rotation, an undo ----------------------------------------------------------------
  await menu('tool-pen');
  const box = await page.evalIn("const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };");
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  await drag(page, { x: cx - 200, y: cy - 60 }, { x: cx - 40, y: cy - 60 });
  await drag(page, { x: cx - 200, y: cy + 60 }, { x: cx - 40, y: cy + 60 });
  let steps = await hook('trackedSteps()');
  c.ok(
    'each brush stroke is a step, named for the brush',
    steps.length === 2 && steps.every((s) => s.command === 'tool:pen' && s.label === 'Brush stroke' && s.type === 'Draw:Add:mark' && s.added === 1),
    JSON.stringify(steps),
  );

  // The first stroke is on the first layer: its row selects it.
  const firstLayer = await page.evalIn("const rows = [...document.querySelectorAll('#layers-list .layer-row')]; const index = rows.findIndex((r) => r.querySelector('.layer-name')?.textContent === 'Layer 1'); return index >= 0 ? index + 1 : null;");
  await clickOn(`#layers-list .layer-row:nth-child(${firstLayer}) .layer-name`);
  await menu('rotate');
  await page.evalIn("const input = document.getElementById('rotate-angle'); input.focus(); input.select(); return true;");
  await page.send('Input.insertText', { text: '90' });
  await sleep(200);
  // Enter in the angle applies it, as the Rotate button does.
  await page.chord(13, 'Enter');
  await sleep(300);
  await page.chord(27, 'Escape');
  await sleep(300);
  await menu('undo');
  steps = await hook('trackedSteps()');
  c.eq('two strokes, a rotation and an undo are four steps', steps.length, 4);
  c.ok(
    'numbered from 1, in the order they happened',
    steps.map((s) => s.index).join() === '1,2,3,4' && steps.map((s) => s.command).join() === 'tool:pen,tool:pen,rotate,undo',
    steps.map((s) => `${s.index} ${s.command}`).join(' | '),
  );
  c.ok(
    'the rotation is named for the Rotate row and changed one mark',
    steps[2]?.label === 'Rotate' && steps[2]?.type === 'Draw:Modify:element' && steps[2]?.changed === 1 && steps[2]?.added === 0,
    JSON.stringify(steps[2]),
  );
  c.ok('the undo is an Undo step that changed it back', steps[3]?.kind === 'undo' && steps[3]?.label === 'Undo' && steps[3]?.changed === 1, JSON.stringify(steps[3]));
  fromHistory = await row('script-from-history');
  c.eq('From Session History is no longer greyed', fromHistory?.enabled, true);

  // ---- Verbose Settings, at its Automate section ----------------------------------------------------
  c.eq('Automate > History Limit runs from the menu bar', await menu('history-limit'), true);
  settings = await connect({ url: 'settings.html' });
  await settings.send('Runtime.enable');
  await sleep(1500);
  const SECTION = `
    const section = document.getElementById('automate');
    const r = section.getBoundingClientRect();
    return {
      hash: location.hash,
      top: Math.round(r.top),
      inView: r.top >= -2 && r.top < window.innerHeight / 2,
      on: document.getElementById('track-history').checked,
      limit: document.getElementById('history-limit').value,
      limitText: document.getElementById('history-limit-value').textContent,
      usage: document.getElementById('history-usage').textContent,
      focus: document.activeElement ? document.activeElement.id : '',
    };
  `;
  let view = await settings.evalIn(SECTION);
  c.ok('it opens Verbose Settings at the Automate section', view.hash === '#automate' && view.inView && view.focus === 'track-history', JSON.stringify(view));
  c.ok(
    'which shows tracking on and the four steps',
    view.on && view.limit === '500' && view.limitText === '500 steps' && /^4 of 500 steps recorded, about \d+(\.\d)? (bytes|KB)\.$/.test(view.usage),
    view.usage,
  );

  await settings.evalIn("const input = document.getElementById('history-limit'); input.value = '50'; input.dispatchEvent(new Event('input', { bubbles: true })); return true;");
  await sleep(800);
  stats = await hook('historyStats()');
  view = await settings.evalIn(SECTION);
  c.ok('its limit slider sets the drawing window\'s limit', stats.limit === 50 && view.limitText === '50 steps' && view.usage.startsWith('4 of 50 steps recorded'), `${JSON.stringify(stats)} / ${view.usage}`);

  const switchAt = await settings.evalIn("const r = document.getElementById('track-history').closest('label').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };");
  await settings.click(switchAt.x, switchAt.y);
  await sleep(900);
  view = await settings.evalIn(SECTION);
  stats = await hook('historyStats()');
  c.ok('its switch turns tracking off', !view.on && !stats.tracking && view.usage === 'Track History is off, so nothing is recorded.', `${view.usage} / ${JSON.stringify(stats)}`);
  c.ok('which clears the steps, and says so', stats.steps === 0 && (await toast()) === 'Track History is off, and the 4 recorded steps are cleared.', await toast());
  track = await row('track-history');
  fromHistory = await row('script-from-history');
  c.ok('the menu row is unchecked, and From Session History greyed again', track?.checked === false && fromHistory?.enabled === false);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  settings?.close();
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
