/**
 * Composition Styles in the app (core/composition-style.ts and the
 * Composition Styles panel): a composition imported with layers named
 * Background, Title and Outline; `Shift+F5` opens the panel, docked; New
 * records the page as a style, which Edit names Day; Duplicate and Edit make
 * Night, its Background and Title set in the rule form; a click on Night
 * restyles the page, one undo step, and a click on Day gives it back. A style
 * with a misspelt rule raises the report with the near name; Rename layer
 * makes the layer match and applies the style again. The report fades after
 * its 15 seconds.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
/** A check that two values are the same, compared as JSON. */
const deep = (label, actual, expected) => c.ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);
const near = (got, want, tol = 8) => Array.isArray(got) && got.every((v, i) => Math.abs(v - want[i]) <= tol);

const FIXTURE = resolve(import.meta.dirname, '..', 'imports', 'composition-day.svg');
const PAPER = [0xf4, 0xf1, 0xea];
const NIGHT = [0x00, 0x01, 0x33];

const app = launch({ mode: 'new', sketchName: 'styles', importFiles: [FIXTURE] });
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
  await page.evalIn(`return window.napkin.updateSettings({ typePanelAutoShow: false }).then(() => true);`);
  await page.evalIn(`return await window.napkin.clickAppMenuItem('fit-view');`);
  await sleep(500);

  const io = {
    state: () => page.evalIn('return window.napkinCheck.compositionStylesState();'),
    layers: () => page.evalIn('return window.napkinCheck.layerRows();'),
    reports: () => page.evalIn('return window.napkinCheck.reportToasts();'),
    async key(key, code, vk, modifiers = 0) {
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(250);
    },
    click: (selector) => page.evalIn(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true;`),
    async styleRow(name) {
      return page.evalIn(`
        const row = [...document.querySelectorAll('.composition-style-row')].find((r) => r.querySelector('.composition-style-name')?.textContent === ${JSON.stringify(name)});
        if (!row) return false;
        row.click();
        return true;`);
    },
    /** The canvas's colour at a page point, as [r, g, b]. */
    async pixel(p) {
      await page.evalIn('await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); return true;');
      return page.evalIn(`
        const cv = document.getElementById('canvas');
        const r = cv.getBoundingClientRect();
        const v = window.napkinCheck.viewState();
        const k = cv.width / r.width;
        return Array.from(cv.getContext('2d').getImageData(Math.round((v.panX + ${p.x} * v.zoom) * k), Math.round((v.panY + ${p.y} * v.zoom) * k), 1, 1).data.slice(0, 3));`);
    },
    /** Sets the rule editor's name field, as typing would. */
    setName: (name) =>
      page.evalIn(`const input = document.querySelector('#config-dialog .config-field-input'); input.value = ${JSON.stringify(name)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true;`),
    /** Clicks the Styles button of the rule editor's row of a kind and a layer name. */
    editRule: (kind, name) =>
      page.evalIn(`
        const rows = [...document.querySelectorAll('#config-dialog tbody tr')];
        const row = rows.find((tr) => tr.querySelector('.config-select')?.value === ${JSON.stringify(kind)} && tr.querySelector('.config-input')?.value === ${JSON.stringify(name)});
        if (!row) return false;
        row.querySelector('.config-row-button').click();
        return true;`),
  };
  // ---- The composition and the panel -------------------------------------------------------------
  const names = (await io.layers()).map((row) => row.name);
  c.ok('the imported layers carry their names', ['Background', 'Title', 'Outline'].every((name) => names.includes(name)), JSON.stringify(names));
  const paper = await io.pixel({ x: 200, y: 20 });
  c.ok('the background is the paper color of the file', near(paper, PAPER), JSON.stringify(paper));

  await io.key('F5', 'F5', 116, 8);
  let state = await io.state();
  c.ok('Shift+F5 opens the Composition Styles panel', state.open === true);
  const panel = await page.evalIn(`return window.napkinCheck.panelState('composition-styles-dialog');`);
  c.ok('docked, the first time', panel?.docked === true, JSON.stringify(panel));
  c.ok('an empty library says what New and Import do', await page.evalIn(`return !document.getElementById('composition-styles-empty').classList.contains('is-hidden');`));

  // ---- New, then Edit: Day ----------------------------------------------------------------------
  await io.click('#composition-styles-new');
  await sleep(600);
  state = await io.state();
  deep('New records the page as a style', state.items.map((item) => item.name), ['Composition Style 1']);
  c.ok('with a rule for each named layer', /layer/.test(state.items[0]?.summary ?? ''), state.items[0]?.summary);
  await io.click('#composition-styles-edit');
  await sleep(400);
  c.ok('Edit opens the rules in the configuration popup', await page.evalIn(`return !document.getElementById('config-dialog').classList.contains('is-hidden');`));
  const ruleRows = await page.evalIn(`return [...document.querySelectorAll('#config-dialog tbody tr')].map((tr) => [tr.querySelector('.config-select').value, tr.querySelector('.config-input').value]);`);
  c.ok('a row a rule: Background, Title and Outline among them', ['Background', 'Title', 'Outline'].every((name) => ruleRows.some(([, n]) => n === name)), JSON.stringify(ruleRows));
  await io.setName('Day');
  await io.click('#config-dialog .config-accept');
  await sleep(600);
  state = await io.state();
  deep('Save names it Day', state.items.map((item) => item.name), ['Day']);

  // ---- Duplicate, then Edit: Night -----------------------------------------------------------------
  await io.styleRow('Day');
  await sleep(300);
  await io.click('#composition-styles-duplicate');
  await sleep(600);
  state = await io.state();
  deep('Duplicate makes a copy, chosen', [state.items.map((item) => item.name), state.items.find((item) => item.file === state.chosen)?.name], [['Day', 'Day copy'], 'Day copy']);
  await io.click('#composition-styles-edit');
  await sleep(400);
  await io.setName('Night');
  c.ok("the Background stroke rule's Styles button opens the rule form", (await io.editRule('stroke', 'Background')) && (await io.state()).ruleForm === true);
  c.ok('the form takes a fill', await page.evalIn(`return window.napkinCheck.setRuleField('fill', '#000133');`));
  await page.evalIn('window.napkinCheck.acceptRuleForm(); return true;');
  await sleep(200);
  const summary = await page.evalIn(`
    const row = [...document.querySelectorAll('#config-dialog tbody tr')].find((tr) => tr.querySelector('.config-select').value === 'stroke' && tr.querySelector('.config-input').value === 'Background');
    return row?.querySelector('.config-button-text')?.textContent ?? '';`);
  c.ok("OK puts the rule in the row, its summary saying so", /fill #000133/.test(summary), summary);
  c.ok('the Title text rule takes a color', (await io.editRule('text', 'Title')) && (await page.evalIn(`return window.napkinCheck.setRuleField('color', '#4cae50');`)));
  await page.evalIn('window.napkinCheck.acceptRuleForm(); return true;');
  await sleep(200);
  await io.click('#config-dialog .config-accept');
  await sleep(700);
  state = await io.state();
  deep('Save keeps Night', state.items.map((item) => item.name), ['Day', 'Night']);

  // ---- Apply Night, then Day ---------------------------------------------------------------------
  await sleep(900);
  state = await io.state();
  c.ok('every style has its thumbnail of the page as it would make it', state.items.every((item) => item.thumbnail), JSON.stringify(state.items));
  c.ok('Night clicked', await io.styleRow('Night'));
  await sleep(500);
  const dark = await io.pixel({ x: 200, y: 20 });
  c.ok('restyles the page: the background is Night', near(dark, NIGHT), JSON.stringify(dark));
  state = await io.state();
  c.eq('the panel marks Night applied', state.items.find((item) => item.file === state.applied)?.name, 'Night');
  deep('a clean apply raises no report', (await io.reports()).length, 0);
  await page.evalIn(`return await window.napkin.clickAppMenuItem('undo');`);
  await sleep(400);
  c.ok('one undo takes the whole of it back', near(await io.pixel({ x: 200, y: 20 }), PAPER));
  await page.evalIn(`return await window.napkin.clickAppMenuItem('redo');`);
  await sleep(400);
  c.ok('and redo brings it again', near(await io.pixel({ x: 200, y: 20 }), NIGHT));
  c.ok('Day clicked', await io.styleRow('Day'));
  await sleep(500);
  const back = await io.pixel({ x: 200, y: 20 });
  c.ok('gives the page back as it was', near(back, PAPER), JSON.stringify(back));

  // ---- A misspelt rule: the report, its suggestion, Rename layer ----------------------------------------
  const made = await page.evalIn(`return await window.napkinCheck.importCompositionStyleText(${JSON.stringify(JSON.stringify({ napkinCompositionStyle: 1, name: 'Typo', text: { Titel: { color: '#4cae50' } } }))}, 'typo.json');`);
  c.ok('a style file imported', typeof made === 'string', String(made));
  c.ok('Typo clicked', await io.styleRow('Typo'));
  await sleep(400);
  let reports = await io.reports();
  const report = reports.find((each) => each.id === 'composition-style');
  c.eq('the report says a rule did not match', report?.title, 'Typo: 1 rule did not match');
  deep('with the near name', report?.details.map((detail) => [detail.text, detail.suggestion ?? null]), [["Text rule 'Titel' matched no layer.", "Did you mean 'Title'?"]]);
  c.ok('fading after its 15 seconds', report && report.remaining > 13000 && report.remaining <= 15000, JSON.stringify(report?.remaining));
  const renamed = await page.evalIn(`
    const box = [...document.querySelectorAll('#report-toasts .report-toast')].find((t) => t.textContent.includes('Typo'));
    box?.querySelector('.report-toast-more')?.click();
    const button = [...(box?.querySelectorAll('.report-toast-action') ?? [])].find((b) => b.textContent === 'Rename layer');
    if (!button) return null;
    button.click();
    return true;`);
  c.ok('Rename layer is offered', renamed === true);
  await sleep(400);
  const after = (await io.layers()).map((row) => row.name);
  c.ok('the layer takes the rule\'s name', after.includes('Titel') && !after.includes('Title'), JSON.stringify(after));
  reports = await io.reports();
  c.ok('and the row says so', reports.some((each) => each.details?.some((detail) => detail.text === 'Renamed Title to Titel')), JSON.stringify(reports.map((each) => each.details)));
  await page.evalIn(`return await window.napkin.clickAppMenuItem('undo');`);
  await sleep(300);
  c.ok('the rename and its restyle are one undo step', (await io.layers()).some((row) => row.name === 'Title'));

  // ---- The report fades ------------------------------------------------------------------------
  // The report read above had its details opened, which holds it: it is closed first.
  await page.evalIn(`for (const close of document.querySelectorAll('#report-toasts .report-toast-close')) close.click(); return true;`);
  await sleep(400);
  c.ok('the report closes', (await io.reports()).length === 0);
  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
  c.ok('Typo again', await io.styleRow('Typo'));
  await sleep(300);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
  await page.evalIn(`document.activeElement?.blur(); return true;`);
  let gone = false;
  for (let waited = 0; waited < 18000 && !gone; waited += 500) {
    await sleep(500);
    gone = !(await io.reports()).some((each) => each.id === 'composition-style');
  }
  c.ok('the report is gone after its 15 seconds', gone);

  deep('no errors on the page', await page.evalIn('return window.__errors;'), []);
} finally {
  await stop(app);
}

process.exit(c.summary() ? 0 : 1);
