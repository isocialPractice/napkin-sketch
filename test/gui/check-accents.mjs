/**
 * Clean Language Accents in the app (core/type/accents.ts): code colored as
 * its language reads it, in Markdown Flow and in any text.
 *
 * In Markdown Flow, a fenced `ts` block typed into a new text colors its
 * keywords. A `fortran` block shows plain, and while the text is edited a
 * line under it says fortran is not installed. Outside Markdown Flow, Type >
 * Clean Language Accents > Apply... colors a selected text as Python, in one
 * undo step, and the colors follow an edit: a keyword typed into it is
 * colored at once. Languages... installs fortran - its file loads and the
 * fortran block is colored, the hint gone - and Remove Accents takes the
 * Python text's colors off, in one undo step.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
/** A check that two values are the same, compared as JSON. */
const deep = (label, actual, expected) => c.ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);

/** Napkin Light's colors, the white page's theme. */
const LIGHT = { base: '#1f2328', keyword: '#cf222e', number: '#0550ae', comment: '#57606a' };

const KEY = {
  Escape: ['Escape', 'Escape', 27],
  Enter: ['Enter', 'Enter', 13],
  End: ['End', 'End', 35],
  z: ['z', 'KeyZ', 90],
};
const CTRL = 2;

const app = launch({ mode: 'new', sketchName: 'accents' });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(3000);
  await page.evalIn(`
    window.__errors = [];
    window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
    window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
    document.activeElement?.blur();
    return true;`);
  // In the check's own settings folder: the Type panel stays down, the common languages installed, new text in Markdown Flow.
  await page.evalIn(`return window.napkin.updateSettings({ typePanelAutoShow: false, markdownNewText: true, accentLanguages: ${JSON.stringify(['bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'graphql', 'ini', 'java', 'javascript', 'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown', 'objectivec', 'perl', 'php', 'php-template', 'plaintext', 'python', 'python-repl', 'r', 'ruby', 'rust', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vbnet', 'wasm', 'xml', 'yaml'])} }).then(() => true);`);
  await sleep(300);
  const rect = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);

  const io = {
    at: (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }),
    editor: () => page.evalIn('return window.napkinCheck.typeEditorState();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
    tool: (id) => page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`),
    settings: () => page.evalIn('return window.napkin.getSettings();'),
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
    async menu(id, wait = 500) {
      const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
      await sleep(wait);
      return ran;
    },
    async mouse(type, p, clickCount = 1) {
      await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount });
    },
    async click(p, count = 1) {
      await this.mouse('mouseMoved', p, 0);
      await this.mouse('mousePressed', p, count);
      await this.mouse('mouseReleased', p, count);
      await sleep(80);
    },
    async key(name, modifiers = 0, wait = 150) {
      const [key, code, vk] = KEY[name];
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      if (name === 'Enter') await page.send('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: vk, modifiers });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(wait);
    },
    /** Types `text`, a newline as Enter: a letter, a digit or a space as its key, any other character as the text it types. */
    async typeText(text) {
      for (const ch of text) {
        if (ch === '\n') {
          await this.key('Enter', 0, 30);
          continue;
        }
        if (!/[A-Za-z0-9 ]/.test(ch)) {
          await page.send('Input.insertText', { text: ch });
          await sleep(25);
          continue;
        }
        const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sleep(25);
      }
      await sleep(150);
    },
    /** A point on the first glyph `ch`. */
    async onGlyph(id, ch) {
      const g = (await this.type(id)).glyphs.find((glyph) => glyph.ch === ch);
      return this.client(g.x + g.width / 2, g.y - g.size * 0.3);
    },
  };

  /** The color a word is drawn in: its first glyph's, where the glyphs first spell it. */
  const colorOf = (t, word) => {
    const at = t.glyphs.map((g) => g.ch).join('').indexOf(word);
    return at < 0 ? null : t.glyphs[at].color;
  };

  // ---- Markdown Flow: a fenced ts block, and a fortran one not installed ---------------------------------
  await io.tool('tool-text');
  await io.click(io.at(0.25, 0.2));
  await sleep(200);
  await io.typeText('```ts\nconst total = 1;\n```\n\n```fortran\nx = 2\n```');
  const md = (await io.editor()).id;
  let ed = await io.editor();
  deep('while the text is edited, the fortran block says its language is not installed', ed.hints, ['fortran is not installed - Type > Clean Language Accents > Languages']);
  await io.key('Escape');
  let t = await io.type(md);
  c.eq('Escape renders the blocks', t.shown, 'const total = 1;\nx = 2');
  c.eq('the ts block\'s keyword is colored', colorOf(t, 'const'), LIGHT.keyword);
  c.eq('and its number', colorOf(t, '1'), LIGHT.number);
  c.eq('the fortran block is plain', colorOf(t, '2'), LIGHT.base);

  // ---- Any text: Apply... colors it as Python, live --------------------------------------------------
  await page.evalIn('return window.napkin.updateSettings({ markdownNewText: false }).then(() => true);');
  await sleep(200);
  await io.tool('tool-text');
  await io.click(io.at(0.25, 0.6));
  await sleep(200);
  await io.typeText('x = 1  # one');
  const py = (await io.editor()).id;
  await io.key('Escape');
  c.ok('the plain text is selected', (await io.selected()).includes(py));
  c.eq('Type > Clean Language Accents > Remove Accents is greyed for a text with none', (await page.evalIn(`
    const bar = await window.napkin.getAppMenu();
    const find = (items) => { for (const item of items ?? []) { if (item.id === 'type-accents-remove') return item; const inner = find(item.submenu); if (inner) return inner; } return null; };
    return find(bar)?.enabled;`)), false);
  await io.menu('type-accents-apply', 400);
  c.ok('Apply... asks for a language', await page.evalIn(`return !document.getElementById('accent-apply-dialog').classList.contains('is-hidden');`));
  const offered = await page.evalIn(`return [...document.getElementById('accent-apply-language').options].map((o) => o.value);`);
  c.ok('offering Auto and the installed languages', offered[0] === 'auto' && offered.includes('python') && offered.length === 37, JSON.stringify(offered.length));
  await page.evalIn(`document.getElementById('accent-apply-language').value = 'python'; document.getElementById('accent-apply-mono').checked = false; document.getElementById('accent-apply-ok').click(); return true;`);
  await sleep(300);
  t = await io.type(py);
  c.eq('the text\'s paragraph is accented as Python', t.typeset?.paras?.[0]?.accent, 'python');
  c.eq('its number colored', colorOf(t, '1'), LIGHT.number);
  c.eq('and its comment', colorOf(t, '#'), LIGHT.comment);
  c.eq('no color is stored: the runs are as they were', t.typeset?.runs ?? null, null);
  await io.key('z', CTRL, 400);
  t = await io.type(py);
  c.ok('one undo takes the accent away', !t.typeset?.paras?.[0]?.accent && colorOf(t, '1') === LIGHT.base, JSON.stringify(t.typeset));
  await page.evalIn(`return window.napkin.clickAppMenuItem('redo').then(() => true);`);
  await sleep(300);
  c.eq('and redo brings it back', (await io.type(py)).typeset?.paras?.[0]?.accent, 'python');

  // Typed into: a new line with `def`, a keyword at once.
  await io.tool('tool-select');
  const into = await io.onGlyph(py, '1');
  await io.click(into, 1);
  await io.click(into, 2);
  await sleep(300);
  await io.key('End', CTRL);
  await io.typeText('\ndef f(): pass');
  t = await io.type(py);
  c.eq('an edit is colored as it is typed: the new keyword', colorOf(t, 'def'), LIGHT.keyword);
  c.eq('the new paragraph takes the accent', t.typeset?.paras?.[1]?.accent, 'python');
  await io.key('Escape');

  // ---- Languages...: fortran installed, its block colored ----------------------------------------------------
  await io.menu('type-accents-languages', 500);
  c.ok('Languages... opens the list', await page.evalIn(`return !document.getElementById('config-dialog').classList.contains('is-hidden') && document.querySelectorAll('#config-dialog tbody tr').length === 193;`));
  await page.send('Input.insertText', { text: 'fortran' });
  await sleep(250);
  const row = await page.evalIn(`
    const rows = [...document.querySelectorAll('#config-dialog tbody tr')].filter((tr) => tr.offsetParent !== null);
    return rows.map((tr) => ({ name: tr.cells[1].textContent, checked: tr.querySelector('.config-check').checked }));`);
  deep('the search keeps Fortran, not installed', row, [{ name: 'Fortran', checked: false }]);
  await page.evalIn(`[...document.querySelectorAll('#config-dialog tbody tr')].find((tr) => tr.cells[1].textContent === 'Fortran').querySelector('.config-check').click(); return true;`);
  await sleep(150);
  await page.evalIn(`document.querySelector('#config-dialog .config-accept').click(); return true;`);
  await sleep(1500);
  c.ok('Accept installs it', (await io.settings()).accentLanguages.includes('fortran'));
  t = await io.type(md);
  c.eq('its file loaded, the fortran block is colored', colorOf(t, '2'), LIGHT.number);
  await io.click(await io.onGlyph(md, 'x'), 1);
  await io.click(await io.onGlyph(md, 'x'), 2);
  await sleep(300);
  deep('and editing the text no longer says it is missing', (await io.editor()).hints, []);
  await io.key('Escape');

  // ---- Remove Accents ---------------------------------------------------------------------------------
  await io.click(await io.onGlyph(py, '1'));
  c.ok('the Python text selected again', (await io.selected()).includes(py));
  await io.menu('type-accents-remove', 400);
  t = await io.type(py);
  c.ok('Remove Accents takes them off', (t.typeset?.paras ?? []).every((para) => !para?.accent) && colorOf(t, 'def') === LIGHT.base, JSON.stringify(t.typeset));
  await io.key('z', CTRL, 400);
  c.eq('in one undo step', (await io.type(py)).typeset?.paras?.[0]?.accent, 'python');

  deep('no errors on the page', await page.evalIn('return window.__errors;'), []);
} finally {
  await stop(app);
}

process.exit(c.summary() ? 0 : 1);
