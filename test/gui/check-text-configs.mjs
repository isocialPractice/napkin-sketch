/**
 * Text Configurations in the app (core/type/configs.ts, the Type panel's
 * third tab): a vector editor's Character Styles.
 *
 * The book is a line of type a script made. A word made bold and red shows
 * the Default Configuration with a plus; New Text Configuration makes one
 * from it, which the word then follows, and its Options name it Callout.
 * Callout applied to another word turns it bold and red. The first word sized
 * up shows Callout with a plus, and Redefine gives Callout that size, so
 * both words grow. The second word turned blue shows the plus, and Alt with a
 * click on Callout takes the blue off. Deleting Callout asks, and Break Link
 * keeps both words' look; Load Text Configurations brings in another book's,
 * a clashing name numbered. Each of these is one undo step, and Type > Text
 * Configurations... opens the tab.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-text-configs-'));

const scriptBundle = join(dir, 'script.mjs');
await build({ entryPoints: [resolve(ROOT, 'src/core/script/index.ts')], outfile: scriptBundle, bundle: true, platform: 'neutral', format: 'esm', logLevel: 'error' });
const { evaluate, formatDiagnostic, renderBook } = await import(pathToFileURL(scriptBundle).href);

const made = (lines, name) => {
  const result = evaluate(lines.join('\n'), { name, timestamp: '2026-10-03T00:00:00.000Z' });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  return result.book;
};
const book = made(['napkin 1', 'page 720 360', 'background #ffffff', 'layer "Type"', 'color #1f2328', 'font "Arial" 24', 'text "Hello brave world" at 40 60'], 'configs');
const bookPath = join(dir, 'configs.skbk');
writeFileSync(bookPath, renderBook(book, { format: 'skbk' }));
const HELLO = book.sketches[0].strokes[0].id;
// Another book's configurations: a Callout set otherwise, and one this book has not.
const other = { ...book, name: 'house-styles', textConfigs: [
  { id: 'tc_other_callout', name: 'Callout', attrs: { color: '#00aa00' } },
  { id: 'tc_other_quiet', name: 'Quiet', attrs: { color: '#888888', fontStyle: 'Italic' } },
] };
const otherPath = join(dir, 'house-styles.skbk');
writeFileSync(otherPath, JSON.stringify(other));

const ALT = 1;
const RED = '#cc0000';
const BLUE = '#0000ff';

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
    configs: () => page.evalIn('return window.napkinCheck.textConfigs();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    editor: () => page.evalIn('return window.napkinCheck.typeEditorState();'),
    tool: (id) => page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`),
    menu: (id) => page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`),
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
    async mouse(type, p, clickCount = 1, modifiers = 0) {
      await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount, modifiers });
    },
    async click(p, count = 1, modifiers = 0) {
      await this.mouse('mouseMoved', p, 0, modifiers);
      await this.mouse('mousePressed', p, count, modifiers);
      await this.mouse('mouseReleased', p, count, modifiers);
      await sleep(80);
    },
    async doubleClick(p) {
      await this.click(p, 1);
      await this.click(p, 2);
      await sleep(250);
    },
    async onChar(id, index) {
      const t = await this.type(id);
      const g = t.glyphs.find((glyph) => glyph.index === index);
      return this.client(g.x + g.width * 0.4, g.y - g.size * 0.3);
    },
    async key(key, code, vk, modifiers = 0, wait = 200) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      }
      await sleep(wait);
    },
    async field(id, text) {
      await page.evalIn(`const f = document.getElementById(${JSON.stringify(id)}); f.focus(); f.select(); return true;`);
      await page.send('Input.insertText', { text });
      await this.key('Enter', 'Enter', 13);
    },
    async press(id) {
      await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
      await sleep(250);
    },
    /** A configuration's row in the tab, clicked with the pointer: Alt with it, to clear. */
    async row(configId, modifiers = 0) {
      const p = await page.evalIn(`const r = document.querySelector('.type-config-row[data-config="${configId}"]').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };`);
      await this.click(p, 1, modifiers);
      await sleep(250);
    },
    /** The word from `start` to `end`, selected in the text: a double-click on it. */
    async word(index) {
      await this.doubleClick(await this.onChar(HELLO, index));
    },
    /** The glyphs of a stretch: their colors and sizes, each once. */
    async look(start, end) {
      const t = await this.type(HELLO);
      const glyphs = t.glyphs.filter((g) => g.index >= start && g.index < end);
      return { colors: [...new Set(glyphs.map((g) => g.color))], sizes: [...new Set(glyphs.map((g) => Math.round(g.size * 100) / 100))] };
    },
    async undo() {
      await this.menu('undo');
      await sleep(300);
    },
    async redo() {
      await this.menu('redo');
      await sleep(300);
    },
    rows: async () => (await page.evalIn('return window.napkinCheck.typePanelState();')).configs.rows,
  };

  // ---- A bold red word: the Default Configuration with a plus ----------------------------------
  await io.tool('tool-text');
  await io.click(await io.onChar(HELLO, 8));
  await sleep(400);
  await io.word(8);
  let ed = await io.editor();
  c.ok('a double-click takes "brave"', ed.anchor === 6 && ed.focus === 11, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  const bold = await io.eval(`
    const s = document.getElementById('type-style');
    const face = [...s.options].map((o) => o.value).find((v) => /^bold$/i.test(v)) ?? [...s.options].map((o) => o.value).find((v) => /bold/i.test(v));
    if (!face) return null;
    s.value = face;
    s.dispatchEvent(new Event('change'));
    return face;`);
  await sleep(200);
  await io.eval(`const w = document.getElementById('type-color'); w.value = '${RED}'; w.dispatchEvent(new Event('change')); return true;`);
  await sleep(200);
  let look = await io.look(6, 11);
  c.ok(`the word made ${bold} and red`, bold !== null && look.colors.join() === RED, JSON.stringify({ bold, look }));
  await io.press('type-tab-configs');
  let state = await io.panel();
  c.ok('the third tab lists the Default Configuration, chosen', state.tab === 'configs' && state.configs.rows.length === 1 && state.configs.rows[0].id === null && state.configs.rows[0].chosen, JSON.stringify(state.configs));
  c.ok('with a plus: the word has attributes of its own', state.configs.rows[0].plus);

  // ---- New Text Configuration, named Callout in its Options ----------------------------------
  await io.press('type-config-new');
  let configs = await io.configs();
  c.ok('New makes one from the word', configs.length === 1 && configs[0].name === 'Text Configuration 1' && configs[0].attrs.color === RED && configs[0].attrs.fontStyle === bold, JSON.stringify(configs));
  const CALLOUT = configs[0].id;
  let t = await io.type(HELLO);
  c.ok('which the word now follows, with nothing of its own', JSON.stringify(t.typeset?.runs) === JSON.stringify([{ start: 6, end: 11, attrs: { config: CALLOUT } }]), JSON.stringify(t.typeset?.runs));
  let rows = await io.rows();
  c.ok('chosen in the list, with no plus', rows.length === 2 && rows[1].chosen && !rows[1].plus && !rows[0].plus, JSON.stringify(rows));
  await io.undo();
  c.eq('one undo takes it away again', (await io.configs()).length, 0);
  await io.redo();
  c.eq('and redo brings it back', (await io.configs()).length, 1);
  await io.press('type-configs-menu-btn');
  c.ok('the tab\'s menu opens', (await io.panel()).configs.menuOpen);
  await io.press('type-config-cmd-options');
  let form = await io.eval('return window.napkinCheck.typeOptionsState();');
  c.ok('Text Configuration Options opens on it', form.open && form.kind === 'config' && form.values.name === 'Text Configuration 1' && form.values.color === RED && form.values.fontSize === null, JSON.stringify(form));
  await io.eval(`return window.napkinCheck.setTypeOption('name', 'Callout');`);
  await io.press('type-options-ok');
  rows = await io.rows();
  c.ok('named Callout', (await io.configs())[0].name === 'Callout' && rows[1].name === 'Callout', JSON.stringify(rows));
  t = await io.type(HELLO);
  c.eq('the text carries the new name', t.typeset?.configs?.[0]?.name, 'Callout');

  // ---- Callout applied to another word ------------------------------------------------------------
  await io.word(14);
  ed = await io.editor();
  c.ok('"world" selected', ed.anchor === 12 && ed.focus === 17, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  rows = await io.rows();
  c.ok('it follows the Default Configuration, with nothing of its own', rows[0].chosen && !rows[0].plus, JSON.stringify(rows));
  await io.row(CALLOUT);
  look = await io.look(12, 17);
  t = await io.type(HELLO);
  c.ok('a click on Callout makes it red and bold too', look.colors.join() === RED && (t.typeset?.runs ?? []).some((r) => r.start === 12 && r.end === 17 && r.attrs.config === CALLOUT), JSON.stringify({ look, runs: t.typeset?.runs }));
  c.ok('and the editing goes on', (await io.editor()).id === HELLO);
  await io.undo();
  c.ok('one undo takes it back', (await io.look(12, 17)).colors.join() === '#1f2328');
  await io.redo();
  c.ok('and redo applies it again', (await io.look(12, 17)).colors.join() === RED);

  // ---- Redefine from the first word, sized up: both change ----------------------------------------
  await io.word(8);
  await io.press('type-tab-character');
  await io.field('type-size', '36');
  await io.press('type-tab-configs');
  rows = await io.rows();
  c.ok('"brave" sized up shows Callout with a plus', rows[1].chosen && rows[1].plus, JSON.stringify(rows));
  await io.press('type-configs-menu-btn');
  await io.press('type-config-cmd-redefine');
  const big = 48;
  c.ok('Redefine gives Callout the size', (await io.configs())[0].attrs.fontSize === big, JSON.stringify(await io.configs()));
  const braveLook = await io.look(6, 11);
  const worldLook = await io.look(12, 17);
  c.ok('both words are 36 pt now', braveLook.sizes.join() === String(big) && worldLook.sizes.join() === String(big), JSON.stringify({ braveLook, worldLook }));
  c.ok('and "Hello" as it was', (await io.look(0, 5)).sizes.join() === '24');
  rows = await io.rows();
  c.ok('the plus is gone: the word has nothing of its own beyond Callout now', !rows[1].plus, JSON.stringify(rows));
  await io.undo();
  c.ok('one undo takes the redefinition back: "world" at 24 pt again', (await io.look(12, 17)).sizes.join() === '24' && !(await io.configs())[0].attrs.fontSize, JSON.stringify(await io.look(12, 17)));
  await io.redo();
  c.ok('and redo redefines it again', (await io.look(12, 17)).sizes.join() === String(big));

  // ---- Alt and a click clears an override ---------------------------------------------------------
  await io.word(14);
  await io.press('type-tab-character');
  await io.eval(`const w = document.getElementById('type-color'); w.value = '${BLUE}'; w.dispatchEvent(new Event('change')); return true;`);
  await sleep(200);
  await io.press('type-tab-configs');
  rows = await io.rows();
  c.ok('"world" turned blue shows the plus', (await io.look(12, 17)).colors.join() === BLUE && rows[1].plus, JSON.stringify(rows));
  await io.row(CALLOUT);
  c.ok('a plain click on Callout keeps the blue', (await io.look(12, 17)).colors.join() === BLUE);
  await io.row(CALLOUT, ALT);
  rows = await io.rows();
  c.ok('Alt and a click takes it off: red again, no plus', (await io.look(12, 17)).colors.join() === RED && !rows[1].plus, JSON.stringify(rows));
  await io.undo();
  c.ok('one undo puts the blue back', (await io.look(12, 17)).colors.join() === BLUE);
  await io.redo();

  // ---- Deleting Callout: Break Link keeps the look ------------------------------------------------
  await io.eval('document.activeElement?.blur(); return true;');
  await io.key('Escape', 'Escape', 27);
  await io.tool('tool-select');
  // Nothing selected: a click on a row chooses it, and applies nothing.
  await io.click(await io.client(600, 300));
  await io.press('type-tab-character');
  await io.menu('type-configs');
  state = await io.panel();
  c.ok('Type > Text Configurations... shows the tab', state.open && state.tab === 'configs', JSON.stringify({ open: state.open, tab: state.tab }));
  const before = JSON.stringify((await io.type(HELLO)).typeset);
  await io.row(CALLOUT);
  rows = await io.rows();
  c.ok('with no text selected, a click chooses a row and changes no text', rows[1].chosen && JSON.stringify((await io.type(HELLO)).typeset) === before, JSON.stringify(rows));
  await io.press('type-config-delete');
  const asked = await io.eval(`return !document.getElementById('text-config-delete-dialog').classList.contains('is-hidden');`);
  c.ok('deleting one text follows asks what becomes of the text', asked);
  await io.press('text-config-delete-break');
  t = await io.type(HELLO);
  const kept = [await io.look(6, 11), await io.look(12, 17)];
  c.ok(
    'Break Link: Callout goes, and both words keep their look',
    (await io.configs()).length === 0 && kept.every((each) => each.colors.join() === RED && each.sizes.join() === String(big)) && !(t.typeset?.runs ?? []).some((r) => r.attrs.config),
    JSON.stringify({ kept, runs: t.typeset?.runs }),
  );
  await io.undo();
  t = await io.type(HELLO);
  c.ok('one undo brings Callout back, and the words follow it again', (await io.configs()).length === 1 && (t.typeset?.runs ?? []).filter((r) => r.attrs.config === CALLOUT).length === 2, JSON.stringify(t.typeset?.runs));

  // ---- Load Text Configurations from another book ---------------------------------------------------
  await io.eval(`return window.napkinCheck.loadTextConfigs(${JSON.stringify(otherPath)}).then(() => true);`);
  await sleep(300);
  configs = await io.configs();
  c.ok('Load brings in another book\'s, a clashing name numbered', JSON.stringify(configs.map((cfg) => cfg.name)) === JSON.stringify(['Callout', 'Callout 2', 'Quiet']), JSON.stringify(configs.map((cfg) => cfg.name)));
  c.ok('and Callout here is as it was', configs[0].attrs.color === RED);
  await io.undo();
  c.eq('one undo takes them back off', (await io.configs()).length, 1);

  c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

process.exit(c.summary() ? 0 : 1);
