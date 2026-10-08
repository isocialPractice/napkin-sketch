/**
 * Report toasts, in the app: the bottom-right notices that list what an
 * action could not do (src/renderer/report-toast.ts).
 *
 * Nothing in the app raises one yet - Composition Styles, missing fonts and
 * the exports' warnings come later - so the check raises them itself through
 * `window.napkinCheck.showReportToast`, as the configuration popup was proved
 * through `openConfigDialog` before its editors existed, and reads them back
 * through `reportToasts()`.
 *
 * In order: where a report sits (16 px from the right, 8 px above the status
 * bar); the pointer on it holds it, and leaving gives it its full time again;
 * open details hold it, and closing them lets it fade, the click on Details
 * leaving no hold behind; a row's action runs and says what it did; the
 * keyboard's focus holds it; Enter on a
 * report's focused button presses that button and nothing behind it (an empty
 * page's Enter would say "Select something to move first."); Escape closes
 * the report that has the focus; three stack, newest at the bottom, and a
 * fourth drops the oldest; a report with an id on screen replaces it where it
 * is; the column climbs over the nib indicator while it shows; a report fades
 * at 15 seconds; and at 0 a report stays until it is closed.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const app = launch({ mode: 'new', sketchName: 'reports' });

/** A report of three rows, the second with a suggestion and an action, as a page-side expression. */
const STYLES_REPORT = `({
  id: 'styles',
  level: 'warning',
  title: 'Midnight: 3 rules did not match',
  details: [
    { text: 'Layer rule "Badge" matched no layer.' },
    { text: 'Text rule "Titel" matched no layer.', suggestion: 'Did you mean "Title"?', action: { label: 'Rename layer', run: () => 'Renamed "Titel" to "Title".' } },
    { text: 'Stroke rule "Outline" is on a layer with no paths.' },
  ],
})`;

const plain = (id, title, extra = '') => `({ id: ${JSON.stringify(id)}, level: 'info', title: ${JSON.stringify(title)}${extra} })`;

try {
  const page = await connect();
  await sleep(1500);

  const show = async (spec) => {
    await page.evalIn(`window.napkinCheck.showReportToast(${spec}); return true;`);
    await sleep(400);
  };
  const reports = () => page.evalIn('return window.napkinCheck.reportToasts();');
  const boxOf = (selector) =>
    page.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
  const move = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  const canvas = await boxOf('#canvas');
  const away = { x: canvas.x - 120, y: canvas.y };
  await move(away.x, away.y);

  // ---- Where it sits, and what it says ------------------------------------
  await show(STYLES_REPORT);
  let [report] = await reports();
  c.ok('a report shows', report?.id === 'styles', JSON.stringify(report));
  c.eq('with its title', report.title, 'Midnight: 3 rules did not match');
  c.ok(
    'and its three rows, the second with its suggestion and its action',
    report.details.length === 3 &&
      report.details[1].suggestion === 'Did you mean "Title"?' &&
      report.details[1].action === 'Rename layer' &&
      report.details[0].action === null,
    JSON.stringify(report.details),
  );
  const rowsHidden = await page.evalIn('return document.querySelector(".report-toast-details").hidden;');
  c.ok('closed to its title until asked', report.expanded === false && rowsHidden === true, JSON.stringify({ expanded: report.expanded, rowsHidden }));
  c.ok('fading at 15 seconds', report.remaining > 14_000 && report.remaining <= 15_000, `${Math.round(report.remaining)} ms left`);
  const geometry = await page.evalIn(`
    const toast = document.querySelector('.report-toast').getBoundingClientRect();
    const bar = document.querySelector('.statusbar').getBoundingClientRect();
    return { right: window.innerWidth - toast.right, aboveBar: bar.top - toast.bottom };
  `);
  c.ok('16 px from the right edge', Math.abs(geometry.right - 16) <= 1, JSON.stringify(geometry));
  c.ok('and 8 px above the status bar', Math.abs(geometry.aboveBar - 8) <= 1, JSON.stringify(geometry));

  // ---- Holds ------------------------------------------------------------
  const toast = await boxOf('.report-toast');
  await move(toast.x, toast.y);
  await sleep(300);
  [report] = await reports();
  c.ok('the pointer on it holds it', report.holds.includes('hover') && report.remaining === null, JSON.stringify(report.holds));
  await sleep(1500);
  await move(away.x, away.y);
  await sleep(150);
  [report] = await reports();
  c.ok(
    'and leaving gives it the full 15 seconds again, not what was left',
    report.remaining > 14_000 && report.remaining <= 15_000,
    `${Math.round(report.remaining)} ms left`,
  );

  const more = await boxOf('.report-toast-more');
  await page.click(more.x, more.y);
  await sleep(300);
  await move(away.x, away.y);
  await sleep(150);
  [report] = await reports();
  const listShown = await page.evalIn(`
    const list = document.querySelector('.report-toast-details');
    return !list.hidden && list.getBoundingClientRect().height > 0;
  `);
  c.ok('Details opens the rows', report.expanded && listShown, JSON.stringify({ expanded: report.expanded, listShown }));
  c.ok('and open details hold it with the pointer gone', report.holds.includes('expanded') && report.remaining === null, JSON.stringify(report.holds));

  const action = await boxOf('.report-toast-action');
  await page.click(action.x, action.y);
  await sleep(200);
  [report] = await reports();
  c.ok(
    "a row's action runs, says what it did, and goes",
    report.details[1].text === 'Renamed "Titel" to "Title".' && report.details[1].action === null && report.details[1].suggestion === null,
    JSON.stringify(report.details[1]),
  );
  c.ok('and the row is marked done', await page.evalIn('return document.querySelectorAll(".report-toast-row")[1].classList.contains("is-done");'));

  // The column is anchored at the bottom, so open details pushed the button
  // up: it is found again rather than clicked where it was.
  const moreAgain = await boxOf('.report-toast-more');
  await page.click(moreAgain.x, moreAgain.y);
  await sleep(200);
  await move(away.x, away.y);
  await sleep(150);
  [report] = await reports();
  c.ok(
    'closing the details lets it fade again, the click leaving no hold behind',
    !report.expanded && report.holds.length === 0 && report.remaining > 14_000,
    JSON.stringify({ holds: report.holds, remaining: Math.round(report.remaining ?? -1) }),
  );

  // ---- Keys -------------------------------------------------------------
  await page.evalIn('document.getElementById("toast").textContent = ""; document.querySelector(".report-toast-close").focus(); return true;');
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  }
  await sleep(400);
  const afterEnter = await page.evalIn(`return {
    reports: window.napkinCheck.reportToasts().length,
    toast: document.getElementById('toast').textContent,
    move: !document.getElementById('move-dialog').classList.contains('is-hidden'),
  };`);
  c.eq('Enter on its focused Close button closes it', afterEnter.reports, 0);
  c.ok('and reaches nothing behind it: no Move, no "Select something to move first."', !afterEnter.move && afterEnter.toast === '', JSON.stringify(afterEnter));

  // The keyboard's focus holds a report as the pointer does. A key first, so
  // the focus that follows counts as the keyboard's (:focus-visible).
  await show(STYLES_REPORT);
  await page.chord(16, 'Shift');
  await page.evalIn('document.querySelector(".report-toast-more").focus(); return true;');
  await sleep(150);
  [report] = await reports();
  c.ok('the keyboard focus on it holds it', report.holds.includes('focus') && report.remaining === null, JSON.stringify(report.holds));
  await page.chord(27, 'Escape');
  await sleep(400);
  c.eq('Escape closes the report that has the focus', (await reports()).length, 0);

  // ---- The stack --------------------------------------------------------
  for (const n of [1, 2, 3, 4]) await show(plain(`s${n}`, `Report ${n}`));
  await sleep(300);
  let stack = await reports();
  c.eq('three at most: the fourth drops the oldest', stack.map((r) => r.id).join(','), 's2,s3,s4');
  c.eq('and its node leaves the page', await page.evalIn('return document.querySelectorAll(".report-toast").length;'), 3);
  const stacked = stack.every((r, i) => i === 0 || r.box.top >= stack[i - 1].box.top + stack[i - 1].box.height);
  c.ok('stacked upward, the newest at the bottom', stacked, JSON.stringify(stack.map((r) => [r.id, Math.round(r.box.top)])));

  await show(plain('s3', 'Report 3, again'));
  stack = await reports();
  c.ok(
    'a report with the id of one on screen replaces it where it stands',
    stack.map((r) => r.id).join(',') === 's2,s3,s4' && stack[1].title === 'Report 3, again',
    JSON.stringify(stack.map((r) => [r.id, r.title])),
  );

  // The nib indicator shows while the Copic nib turns; the column climbs over it.
  await page.evalIn('document.getElementById("nib-indicator").classList.remove("is-hidden"); return true;');
  await show(plain('s4', 'Report 4, over the nib'));
  const overNib = await page.evalIn(`
    const toasts = document.querySelectorAll('.report-toast');
    const last = toasts[toasts.length - 1].getBoundingClientRect();
    const nib = document.getElementById('nib-indicator').getBoundingClientRect();
    return { gap: nib.top - last.bottom };
  `);
  c.ok('with the nib indicator up, the stack sits 8 px above it', Math.abs(overNib.gap - 8) <= 1, JSON.stringify(overNib));
  await page.evalIn('document.getElementById("nib-indicator").classList.add("is-hidden"); return true;');
  await show(plain('s4', 'Report 4'));
  const backDown = await page.evalIn(`
    const toasts = document.querySelectorAll('.report-toast');
    const last = toasts[toasts.length - 1].getBoundingClientRect();
    return { aboveBar: document.querySelector('.statusbar').getBoundingClientRect().top - last.bottom };
  `);
  c.ok('and back above the status bar once it goes', Math.abs(backDown.aboveBar - 8) <= 1, JSON.stringify(backDown));

  for (const r of await reports()) {
    await page.evalIn(`document.querySelector('.report-toast[data-report-id="${r.id}"] .report-toast-close').click(); return true;`);
  }
  await sleep(400);
  c.eq('Close closes each', (await reports()).length, 0);

  // ---- Time -------------------------------------------------------------
  await move(away.x, away.y);
  await show(plain('fade', 'A report left alone'));
  await sleep(14_000);
  c.eq('left alone, it is still up at 14 seconds', (await reports()).length, 1);
  await sleep(1700);
  c.eq('and gone at 15', (await reports()).length, 0);
  await sleep(300);
  c.eq('its node faded and left the page', await page.evalIn('return document.querySelectorAll(".report-toast").length;'), 0);

  await page.evalIn('return window.napkin.updateSettings({ reportToastSeconds: 0 }).then(() => true);');
  await sleep(400);
  await show(plain('sticky', 'A report kept until closed'));
  [report] = await reports();
  c.ok('at 0 seconds a report has no time limit', report?.remaining === null, JSON.stringify(report));
  await sleep(2000);
  c.eq('and is still up later', (await reports()).length, 1);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}
