/**
 * The Type panel in the app (renderer/type-panel.ts): Character and
 * Paragraph, as a vector editor's.
 *
 * The book is a page of texts a script made: a line to restyle a word of, a
 * line to track, three paragraphs, a narrow box of long words, and a text in
 * a font no computer has. It opens with a report that the font is not
 * installed, whose Find text selects the text. A text selected and the Text
 * tool taken up bring the panel up by itself, Select puts it away, and with
 * the setting off it stays down; Ctrl+Shift+T and Ctrl+Alt+T toggle it on
 * its two tabs. A font and a size chosen for a word change that word alone;
 * tracking set on a whole text tracks all of it; a drag on a field's name
 * changes the size as it goes and is one undo step; the caret's paragraph is
 * centred, the text made a numbered list and indented; a narrow box
 * hyphenated shows a hyphen; and two texts of different sizes leave the size
 * blank.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-type-panel-'));

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const MISSING = 'Missing Acme Sans';
const result = evaluate(
  [
    'napkin 1',
    'page 720 480',
    'background #ffffff',
    'layer "Type"',
    'color #1f2328',
    'font "Arial" 24',
    'text "Hello wide world" at 40 40',
    'text "Track me" at 40 120',
    'text "one\\ntwo\\nthree" at 400 40',
    'text "Extraordinarily internationalized" at 40 220 size 18 box 72',
    `font "${MISSING}" 20`,
    'text "Lost face" at 420 360',
  ].join('\n'),
  { name: 'type-panel', timestamp: '2026-10-03T00:00:00.000Z' },
);
if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
const bookPath = join(dir, 'type-panel.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));
const MARKS = result.book.sketches[0].strokes;
const idOf = (start) => MARKS.find((m) => m.text.startsWith(start)).id;
const HELLO = idOf('Hello');
const TRACK = idOf('Track');
const THREE = idOf('one');
const NARROW = idOf('Extra');
const LOST = idOf('Lost');

const CTRL = 2;
const SHIFT = 8;
const ALT = 1;

const app = launch({ mode: 'book', filePath: bookPath });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(3500);
  await page.evalIn(`
    window.__errors = [];
    window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
    window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
    return true;`);

  const io = {
    eval: (code) => page.evalIn(code),
    panel: () => page.evalIn('return window.napkinCheck.typePanelState();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    editor: () => page.evalIn('return window.napkinCheck.typeEditorState();'),
    selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
    tool: (id) => page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`),
    settings: (patch) => page.evalIn(`return window.napkin.updateSettings(${JSON.stringify(patch)}).then(() => true);`),
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
    async mouse(type, p, clickCount = 1, modifiers = 0) {
      await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount, modifiers });
    },
    async click(p, count = 1) {
      await this.mouse('mouseMoved', p, 0);
      await this.mouse('mousePressed', p, count);
      await this.mouse('mouseReleased', p, count);
      await sleep(80);
    },
    async doubleClick(p) {
      await this.click(p, 1);
      await this.click(p, 2);
      await sleep(250);
    },
    /** A point on character `index` of a text. */
    async onChar(id, index) {
      const t = await this.type(id);
      const g = t.glyphs.find((glyph) => glyph.index === index);
      return this.client(g.x + g.width * 0.25, g.y - g.size * 0.3);
    },
    async key(key, code, vk, modifiers = 0, wait = 200) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      }
      await sleep(wait);
    },
    /** Types into a field of the panel: focused, emptied, the text, Enter. */
    async field(id, text) {
      await page.evalIn(`const f = document.getElementById(${JSON.stringify(id)}); f.focus(); f.select(); return true;`);
      await page.send('Input.insertText', { text });
      await this.key('Enter', 'Enter', 13);
    },
    async press(id) {
      await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
      await sleep(200);
    },
    /** A click on a panel control with the pointer, as a person makes it: the press takes the focus. */
    async pressWithPointer(id) {
      const p = await page.evalIn(`const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
      await this.click(p);
      await sleep(200);
    },
    /** The panel up on a tab, by its key: Ctrl+Shift+T for Character, Ctrl+Alt+T for Paragraph. */
    async showTab(tab) {
      for (let i = 0; i < 3; i++) {
        const now = await this.panel();
        if (now.open && now.tab === tab) return;
        if (tab === 'character') await this.key('T', 'KeyT', 84, CTRL | SHIFT, 300);
        else await this.key('t', 'KeyT', 84, CTRL | ALT, 300);
      }
    },
    blur: () => page.evalIn('document.activeElement?.blur(); return true;'),
    menu: (id) => page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`),
  };

  // ---- A missing font, reported as the book opens ----------------------------------------
  const reports = await io.eval('return window.napkinCheck.reportToasts();');
  const missing = reports.find((r) => r.id === 'missing-fonts');
  c.ok('a book whose text uses a font this computer lacks opens with a report', missing?.title === '1 font is not installed', JSON.stringify(reports.map((r) => r.title)));
  c.ok('a row naming the font, with Find text', missing?.details.length === 1 && missing.details[0].text.startsWith(MISSING) && missing.details[0].action === 'Find text', JSON.stringify(missing?.details));
  await io.eval(`document.querySelector('[data-report-id="missing-fonts"] .report-toast-action, .report-toast-action')?.click(); return true;`);
  await sleep(300);
  c.ok('Find text selects the text', JSON.stringify(await io.selected()) === JSON.stringify([LOST]), JSON.stringify(await io.selected()));

  // ---- Auto show -----------------------------------------------------------------------------
  await io.tool('tool-select');
  await io.click(await io.onChar(HELLO, 1));
  c.eq('with the Select tool the panel stays down', (await io.panel()).open, false);
  await io.tool('tool-text');
  await sleep(200);
  let state = await io.panel();
  c.ok('the Text tool with a text selected brings the panel up by itself', state.open && state.auto, JSON.stringify({ open: state.open, auto: state.auto }));
  c.ok('on Character, acting on the text', state.tab === 'character' && state.scope === 'marks' && state.title === 'Text', JSON.stringify({ tab: state.tab, scope: state.scope, title: state.title }));
  c.ok('showing its font and size', state.family === 'Arial' && state.fields['type-size'] === '18 pt', JSON.stringify({ family: state.family, size: state.fields['type-size'] }));
  await io.tool('tool-select');
  c.eq('choosing Select puts it away', (await io.panel()).open, false);
  await io.settings({ typePanelAutoShow: false });
  await sleep(300);
  await io.tool('tool-text');
  await sleep(200);
  c.eq('with the setting off it stays down', (await io.panel()).open, false);
  await io.tool('tool-select');
  await io.settings({ typePanelAutoShow: true });
  await sleep(300);

  // ---- The keys ------------------------------------------------------------------------------------
  await io.blur();
  await io.key('T', 'KeyT', 84, CTRL | SHIFT, 300);
  state = await io.panel();
  c.ok('Ctrl+Shift+T brings it up on Character', state.open && !state.auto && state.tab === 'character', JSON.stringify({ open: state.open, auto: state.auto, tab: state.tab }));
  await io.key('t', 'KeyT', 84, CTRL | ALT, 300);
  state = await io.panel();
  c.ok('Ctrl+Alt+T turns it to Paragraph', state.open && state.tab === 'paragraph', JSON.stringify({ open: state.open, tab: state.tab }));
  await io.key('t', 'KeyT', 84, CTRL | ALT, 300);
  c.eq('and again puts it away', (await io.panel()).open, false);
  await io.key('T', 'KeyT', 84, CTRL | SHIFT, 300);
  await io.tool('tool-select');
  c.eq('opened by hand, it stays when the tool changes', (await io.panel()).open, true);

  // ---- A font and a size for one word ------------------------------------------------------------
  const fonts = await io.eval('return window.napkinCheck.fontList();');
  c.ok('the fonts are the system\'s', fonts.available && fonts.families.length > 3, JSON.stringify({ available: fonts.available, count: fonts.families.length }));
  const family = ['Georgia', 'Times New Roman', 'Courier New', 'Verdana'].find((name) => fonts.families.includes(name)) ?? fonts.families.find((name) => name !== 'Arial');
  await io.tool('tool-text');
  await io.click(await io.onChar(HELLO, 7));
  await sleep(500);
  await io.doubleClick(await io.onChar(HELLO, 7));
  let ed = await io.editor();
  c.ok('a double-click in the text takes the word', ed.anchor === 6 && ed.focus === 10, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  state = await io.panel();
  c.eq('the panel acts on the selected characters', state.scope, 'range');
  await io.eval(`const f = document.getElementById('type-family'); f.focus(); f.select(); return true;`);
  await page.send('Input.insertText', { text: family });
  await sleep(200);
  await io.key('Enter', 'Enter', 13);
  await io.field('type-size', '36');
  let t = await io.type(HELLO);
  const run = (t.typeset?.runs ?? []).find((r) => r.start === 6);
  c.ok(`the word is in ${family}, 36 pt`, run?.end === 10 && run.attrs.fontFamily === family && run.attrs.fontSize === 48, JSON.stringify(t.typeset?.runs));
  c.ok('and the rest as it was', t.fontFamily === 'Arial' && t.fontSize === 24 && t.glyphs.filter((g) => g.index < 6 || g.index >= 10).every((g) => g.size === 24), JSON.stringify({ family: t.fontFamily, size: t.fontSize }));
  state = await io.panel();
  c.ok('the panel shows what the word has', state.family === family && state.fields['type-size'] === '36 pt', JSON.stringify({ family: state.family, size: state.fields['type-size'] }));
  c.eq('and the editing goes on', (await io.editor()).id, HELLO);
  await io.blur();
  await io.key('Escape', 'Escape', 27);
  c.eq('Escape puts the text down', (await io.editor()).id, null);
  c.ok('the font chosen is the next text\'s', (await io.eval('return window.napkin.getSettings();')).textFont === family);

  // ---- Tracking on a whole text, and a drag on a field's name -------------------------------------------
  await io.tool('tool-select');
  await io.click(await io.onChar(TRACK, 1));
  state = await io.panel();
  c.eq('a text selected with Select: the panel acts on all of it', state.scope, 'marks');
  await io.field('type-tracking', '100');
  t = await io.type(TRACK);
  c.ok('tracking set on a whole text tracks every character', JSON.stringify(t.typeset?.runs) === JSON.stringify([{ start: 0, end: 8, attrs: { tracking: 100 } }]), JSON.stringify(t.typeset?.runs));
  const label = await io.eval(`const r = document.querySelector('[data-scrub="type-size"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  await io.mouse('mouseMoved', label, 0);
  await io.mouse('mousePressed', label, 1);
  for (let dx = 4; dx <= 40; dx += 4) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: label.x + dx, y: label.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(15);
  }
  const midDrag = (await io.type(TRACK)).fontSize;
  await io.mouse('mouseReleased', { x: label.x + 40, y: label.y }, 1);
  await sleep(200);
  t = await io.type(TRACK);
  c.ok('a drag on the Size name sizes the text as it goes', Math.abs(midDrag - (18 + 10) * (4 / 3)) < 0.01, `${midDrag}`);
  c.ok('and keeps it when let go', Math.abs(t.fontSize - (28 * 4) / 3) < 0.01, `${t.fontSize}`);
  await io.menu('undo');
  await sleep(300);
  t = await io.type(TRACK);
  c.ok('one undo takes the whole drag back', t.fontSize === 24 && JSON.stringify(t.typeset?.runs) === JSON.stringify([{ start: 0, end: 8, attrs: { tracking: 100 } }]), JSON.stringify({ size: t.fontSize, runs: t.typeset?.runs }));

  // ---- Paragraphs: centre one, a numbered list, an indent ----------------------------------------------
  await io.tool('tool-text');
  await io.click(await io.onChar(THREE, 5));
  await sleep(200);
  await io.key('t', 'KeyT', 84, CTRL | ALT, 300);
  state = await io.panel();
  c.ok('Ctrl+Alt+T while typing turns the panel to Paragraph', state.open && state.tab === 'paragraph', JSON.stringify({ open: state.open, tab: state.tab }));
  c.eq('and the text goes on being edited', (await io.editor()).id, THREE);
  await io.pressWithPointer('type-align-center');
  t = await io.type(THREE);
  c.ok("Center centres the caret's paragraph alone", JSON.stringify(t.typeset?.paras) === JSON.stringify([null, { align: 'center' }]), JSON.stringify(t.typeset?.paras));
  c.ok('and the line moves to stand about its anchor', Math.abs(t.lines[1].x + t.lines[1].width / 2 - t.lines[0].x) < 1, JSON.stringify(t.lines));
  c.ok('a button pressed while typing gives the keyboard back to the text', (await io.editor()).field.focused);
  await io.key('a', 'KeyA', 65, CTRL);
  await io.press('type-numbers');
  t = await io.type(THREE);
  const lists = (t.typeset?.paras ?? []).map((p) => p?.list?.kind ?? null);
  c.ok('Numbered makes the selected paragraphs a numbered list', JSON.stringify(lists) === JSON.stringify(['number', 'number', 'number']), JSON.stringify(t.typeset?.paras));
  await io.field('type-left-indent', '18');
  t = await io.type(THREE);
  c.ok('an 18 pt left indent', (t.typeset?.paras ?? []).every((p) => p?.leftIndent === 24), JSON.stringify(t.typeset?.paras));
  state = await io.panel();
  c.ok('the panel shows the list and the indent', state.list.startsWith('number:1') && state.fields['type-left-indent'] === '18 pt', JSON.stringify({ list: state.list, indent: state.fields['type-left-indent'] }));
  await io.blur();
  await io.key('Escape', 'Escape', 27);

  // ---- Hyphenation in a narrow box ------------------------------------------------------------------
  await io.tool('tool-select');
  await io.click(await io.onChar(NARROW, 2));
  const before = await io.type(NARROW);
  c.ok('a narrow box of long words, with no hyphen yet', before.kind === 'area' && !before.glyphs.some((g) => g.index === -1), JSON.stringify(before.glyphs.filter((g) => g.index === -1)));
  await io.showTab('paragraph');
  await io.press('type-hyphenate');
  const after = await io.type(NARROW);
  c.ok('Hyphenate breaks a word with a hyphen', after.glyphs.some((g) => g.index === -1 && g.ch === '-'), JSON.stringify(after.lines));
  c.eq('and the panel shows it ticked', (await io.panel()).hyphenate, true);

  // ---- Mixed, and the font this computer lacks ----------------------------------------------------------
  await io.showTab('character');
  await io.click(await io.onChar(HELLO, 1));
  await io.mouse('mouseMoved', await io.onChar(NARROW, 2), 0);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...(await io.onChar(NARROW, 2)), button: 'left', buttons: 1, clickCount: 1, modifiers: SHIFT });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(await io.onChar(NARROW, 2)), button: 'left', buttons: 0, clickCount: 1, modifiers: SHIFT });
  await sleep(250);
  state = await io.panel();
  c.ok('two texts of different sizes leave the size blank', state.title === '2 Texts' && state.fields['type-size'] === '', JSON.stringify({ title: state.title, size: state.fields['type-size'] }));
  await io.click(await io.onChar(LOST, 1));
  state = await io.panel();
  c.ok('a text in a font this computer lacks shows its family, marked', state.family === MISSING && state.missing, JSON.stringify({ family: state.family, missing: state.missing }));

  // ---- Typing by the right edge: the panel docks, and the caret stays in view ------------------------------
  // An empty spot on the page, with Select: nothing selected.
  await io.click(await io.client(650, 200));
  await io.press('type-close');
  await sleep(300);
  const wide = await io.eval(`const r = document.getElementById('canvas').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };`);
  await io.tool('tool-text');
  c.eq('the Text tool with no text selected leaves the panel down', (await io.panel()).open, false);
  await io.click({ x: wide.right - 60, y: wide.top + 160 });
  await page.send('Input.insertText', { text: 'Edge' });
  await sleep(500);
  const narrow = await io.eval(`const r = document.getElementById('canvas').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };`);
  state = await io.panel();
  c.ok('typing by the right edge brings the panel up, docked, the canvas narrower', state.open && state.auto && narrow.right < wide.right - 100, JSON.stringify({ open: state.open, wide, narrow }));
  ed = await io.editor();
  const caretAt = await io.client(ed.caret.top.x, ed.caret.top.y);
  c.ok('and the caret is panned back into the canvas', caretAt.x > narrow.left && caretAt.x < narrow.right, JSON.stringify({ caretAt, narrow }));
  await io.blur();
  await io.key('Escape', 'Escape', 27);

  c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
