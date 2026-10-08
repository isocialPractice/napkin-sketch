/**
 * The type editor in the app (renderer/type-editor.ts): text edited where it
 * stands on the canvas, the keys, the IME and the clipboard going through a
 * hidden field.
 *
 * A click with the Text tool begins a new text, which is not on the page
 * until something is typed; three lines are typed with Enter, and Escape
 * puts the text down, kept and selected. A double-click with the Select tool
 * edits it again with the caret at the character clicked; Ctrl+A takes all
 * of it, a triple-click a paragraph and a drag what it crosses, painted as a
 * highlight. A double-click in it takes a word, All Caps restyles the word,
 * and the word copied and pasted at the start keeps its capitals, where a
 * plain paste takes the style at the caret. A size key steps a selected
 * word. Two bursts of typing a pause apart are two undo steps. A zoom moves
 * the caret, and the hidden field with it, and a click off the text with the
 * Select tool puts it down. Ctrl held with the Text tool shows the selection
 * tool, and a Ctrl-click elsewhere puts the text down. An IME composition is
 * shown as it is typed and kept when committed, and Ctrl+Enter puts the text
 * down. Last, a text emptied before it is put down leaves no mark, and the
 * spaces a text was typed with are kept.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

/** A key's `key`, `code` and virtual key code. */
const KEY = {
  Escape: ['Escape', 'Escape', 27],
  Enter: ['Enter', 'Enter', 13],
  Backspace: ['Backspace', 'Backspace', 8],
  Home: ['Home', 'Home', 36],
  End: ['End', 'End', 35],
  Control: ['Control', 'ControlLeft', 17],
  a: ['a', 'KeyA', 65],
  c: ['c', 'KeyC', 67],
  v: ['v', 'KeyV', 86],
  V: ['V', 'KeyV', 86],
  K: ['K', 'KeyK', 75],
  '>': ['>', 'Period', 190],
};
const CTRL = 2;
const SHIFT = 8;

const app = launch({ mode: 'new', sketchName: 'type-editor' });
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
  // The Type panel would come up with the Text tool and dock beside the canvas, moving where its
  // points are; check-type-panel.mjs has the panel. In the check's own settings folder, not anyone's.
  await page.evalIn('return window.napkin.updateSettings({ typePanelAutoShow: false }).then(() => true);');
  await sleep(300);
  const rect = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);

  const io = {
    /** A point on the canvas, as fractions of its width and height. */
    at: (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }),
    /** A page point, in client pixels. */
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
    editor: () => page.evalIn('return window.napkinCheck.typeEditorState();'),
    input: () => page.evalIn('return window.napkinCheck.inputState();'),
    marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
    tool: (id) => page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`),
    async menu(id, wait = 500) {
      const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
      await sleep(wait);
      return ran;
    },
    async mouse(type, p, clickCount = 1, modifiers = 0) {
      await page.send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: type === 'mouseMoved' ? 'none' : 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount,
        modifiers,
      });
    },
    /** A click; `count` 2 is the second click of a double-click. */
    async click(p, count = 1, modifiers = 0) {
      await this.mouse('mouseMoved', p, 0, modifiers);
      await this.mouse('mousePressed', p, count, modifiers);
      await this.mouse('mouseReleased', p, count, modifiers);
      await sleep(60);
    },
    async doubleClick(p) {
      await this.click(p, 1);
      await this.click(p, 2);
      await sleep(300);
    },
    async tripleClick(p) {
      await this.click(p, 1);
      await this.click(p, 2);
      await this.click(p, 3);
      await sleep(300);
    },
    /** A drag with the button held from `from` to `to`. */
    async drag(from, to, steps = 6) {
      await this.mouse('mouseMoved', from, 0);
      await this.mouse('mousePressed', from, 1);
      for (let i = 1; i <= steps; i++) {
        const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
        await sleep(10);
      }
      await this.mouse('mouseReleased', to, 1);
      await sleep(200);
    },
    /** How many pixels of the canvas between two client points are the selection's blue, after two frames. */
    blue: (a, b) => page.evalIn(`
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const cv = document.getElementById('canvas');
      const r = cv.getBoundingClientRect();
      const k = cv.width / r.width;
      const x0 = Math.round((${Math.min(a.x, b.x)} - r.left) * k);
      const y0 = Math.round((${Math.min(a.y, b.y)} - r.top) * k);
      const w = Math.max(1, Math.round(${Math.abs(b.x - a.x)} * k));
      const h = Math.max(1, Math.round(${Math.abs(b.y - a.y)} * k));
      const d = cv.getContext('2d').getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i + 2] > d[i] + 25 && d[i + 2] > d[i + 1] + 10) n++;
      return n;`),
    /** A key pressed and let go, with modifiers held. */
    async key(name, modifiers = 0, wait = 120) {
      const [key, code, vk] = KEY[name];
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      if (name === 'Enter') await page.send('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: vk, modifiers });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(wait);
    },
    /** Types `text` key by key, a newline as Enter. */
    async typeText(text) {
      for (const ch of text) {
        if (ch === '\n') {
          await this.key('Enter', 0, 20);
          continue;
        }
        const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sleep(20);
      }
      await sleep(150);
    },
    /** A point on character `index` of a text: a quarter of its way in, a third of its size up from its baseline. */
    async onChar(id, index) {
      const t = await this.type(id);
      const g = t.glyphs.find((glyph) => glyph.index === index);
      return this.client(g.x + g.width * 0.25, g.y - g.size * 0.3);
    },
  };

  // ---- A new text, three lines, Escape -----------------------------------------------------------
  await io.tool('tool-text');
  const before = (await io.marks()).length;
  await io.click(io.at(0.3, 0.3));
  await sleep(200);
  let ed = await io.editor();
  c.ok('a click with the Text tool begins a new text, the hidden field holding the keys', ed.id !== null && ed.fresh && ed.field.focused, JSON.stringify(ed));
  c.eq('which is not on the page until something is typed', (await io.marks()).length, before);

  await io.typeText('one\ntwo\nthree');
  ed = await io.editor();
  const id = ed.id;
  c.eq('three lines are typed, Enter making each new one', ed.text, 'one\ntwo\nthree');
  const mark = (await io.marks()).find((m) => m.id === id);
  c.ok('the text is a mark on the page from its first character', mark?.tool === 'text', JSON.stringify(mark));
  let t = await io.type(id);
  c.eq('laid out in three lines', t.lines.length, 3);
  c.ok('the hidden field mirrors the text and the caret, and is named for it', ed.field.value === ed.text && ed.field.start === 13 && ed.field.end === 13 && ed.field.label === 'Text: one two three', JSON.stringify(ed.field));
  const lastGlyph = t.glyphs[t.glyphs.length - 1];
  c.ok("the caret stands after the last character, on its line", ed.caret && Math.abs(ed.caret.top.x - (lastGlyph.x + lastGlyph.width)) < 2 && ed.caret.bottom.y > lastGlyph.y, JSON.stringify({ caret: ed.caret, lastGlyph }));

  await io.key('Escape');
  ed = await io.editor();
  c.eq('Escape puts the text down', ed.id, null);
  t = await io.type(id);
  c.eq('keeping what was typed', t?.text, 'one\ntwo\nthree');
  c.ok('and the text is left selected', (await io.selected()).includes(id), JSON.stringify(await io.selected()));

  // ---- A double-click with Select edits it again, at the character clicked --------------------------------
  await io.tool('tool-select');
  await io.doubleClick(await io.onChar(id, 4));
  ed = await io.editor();
  c.ok('a double-click with the Select tool edits the text', ed.id === id && ed.field.focused, JSON.stringify(ed));
  c.eq('with the caret before the character clicked', ed.focus, 4);
  c.eq('the Select tool still in hand', (await io.input()).tool, 'select');

  // ---- Ctrl+A, a triple-click, a drag ----------------------------------------------------------------------
  await io.key('a', CTRL);
  ed = await io.editor();
  c.ok('Ctrl+A takes all the text', ed.anchor === 0 && ed.focus === 13, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  await sleep(600);
  await io.tripleClick(await io.onChar(id, 5));
  ed = await io.editor();
  c.ok('a triple-click takes the paragraph', ed.anchor === 4 && ed.focus === 7, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  await sleep(600);
  const dragFrom = await io.onChar(id, 0);
  const dragTo = await io.onChar(id, 2);
  await io.drag(dragFrom, dragTo);
  ed = await io.editor();
  c.ok('a drag selects from where it began to where it ends', ed.anchor === 0 && ed.focus === 2, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  t = await io.type(id);
  const g0 = t.glyphs[0];
  const lit = await io.blue(await io.client(g0.x, g0.y - g0.size * 0.7), await io.client(g0.x + g0.width * 1.8, g0.y));
  c.ok('painted as a highlight over the characters', lit > 30, `${lit} blue pixels`);
  const unlit = await io.blue(await io.client(t.glyphs[4].x, t.glyphs[4].y - 15), await io.client(t.glyphs[6].x + 5, t.glyphs[6].y));
  c.eq('and nowhere else', unlit, 0);

  // ---- A word: All Caps, copied, pasted with its style and plain ------------------------------------------
  await sleep(600);
  await io.doubleClick(await io.onChar(id, 10));
  ed = await io.editor();
  c.ok('a double-click in the text takes the word', ed.anchor === 8 && ed.focus === 13, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  await io.key('K', CTRL | SHIFT);
  t = await io.type(id);
  const capsRun = (t.typeset?.runs ?? []).find((r) => r.attrs.caps === 'all');
  c.ok('Ctrl+Shift+K puts the word in All Caps', capsRun?.start === 8 && capsRun?.end === 13, JSON.stringify(t.typeset?.runs));
  c.ok('drawn in capitals', t.glyphs.filter((g) => g.index >= 8 && g.index < 13).map((g) => g.ch).join('') === 'THREE', JSON.stringify(t.glyphs.map((g) => g.ch)));

  await io.key('c', CTRL);
  await io.key('Home', CTRL);
  await io.key('v', CTRL, 300);
  t = await io.type(id);
  c.eq('the word copied and pasted at the start', t.text, 'threeone\ntwo\nthree');
  const pastedCaps = (t.typeset?.runs ?? []).find((r) => r.start === 0);
  c.ok('keeps its capitals: the runs come with it', pastedCaps?.end === 5 && pastedCaps.attrs.caps === 'all', JSON.stringify(t.typeset?.runs));
  c.eq('the caret after it', (await io.editor()).focus, 5);

  await io.key('End');
  c.eq('End goes to the end of the line', (await io.editor()).focus, 8);
  await io.key('V', CTRL | SHIFT, 300);
  t = await io.type(id);
  c.eq('Ctrl+Shift+V pastes the word there', t.text, 'threeonethree\ntwo\nthree');
  const plainCaps = (t.typeset?.runs ?? []).filter((r) => r.attrs.caps === 'all' && r.start < 13 && r.end > 8);
  c.ok('as plain text, in the style at the caret', plainCaps.length === 0, JSON.stringify(t.typeset?.runs));

  // ---- A size key on a selected word ------------------------------------------------------------------------
  await sleep(600);
  await io.doubleClick(await io.onChar(id, 15));
  ed = await io.editor();
  c.ok('the word "two" is taken', ed.anchor === 14 && ed.focus === 17, JSON.stringify({ anchor: ed.anchor, focus: ed.focus }));
  const base = t.fontSize;
  await io.key('>', CTRL | SHIFT);
  t = await io.type(id);
  const bigger = (t.typeset?.runs ?? []).find((r) => r.start === 14 && r.end === 17);
  c.ok('Ctrl+Shift+. sets it 2 pt bigger', bigger !== undefined && Math.abs(bigger.attrs.fontSize - base - 8 / 3) < 1e-6, JSON.stringify({ base, runs: t.typeset?.runs }));

  // ---- Undo: a burst of typing is one step --------------------------------------------------------------------
  await io.key('End', CTRL);
  await io.typeText('ab');
  await sleep(1400);
  await io.typeText('cd');
  c.ok('two bursts typed a pause apart', (await io.type(id)).text.endsWith('threeabcd'));
  await io.menu('undo');
  t = await io.type(id);
  c.ok('one undo takes back the second burst whole', t.text.endsWith('threeab'), JSON.stringify(t.text));
  ed = await io.editor();
  c.ok('the editing goes on, the caret inside the text', ed.id === id && ed.focus <= t.text.length, JSON.stringify(ed));
  await io.menu('undo');
  c.ok('and the next the first', (await io.type(id)).text.endsWith('\nthree'), JSON.stringify((await io.type(id)).text));
  await io.menu('redo');
  c.ok('redo brings it back', (await io.type(id)).text.endsWith('threeab'), JSON.stringify((await io.type(id)).text));

  // ---- Zoom while editing ---------------------------------------------------------------------------------------
  await io.key('End', CTRL);
  const caretBefore = (await io.editor()).caret;
  const zoomBefore = (await page.evalIn('return window.napkinCheck.viewState();')).zoom;
  await io.menu('zoom-in', 700);
  ed = await io.editor();
  const zoomAfter = (await page.evalIn('return window.napkinCheck.viewState();')).zoom;
  const caretClient = await io.client(ed.caret.top.x, ed.caret.top.y);
  c.ok('zoomed in while editing', zoomAfter > zoomBefore * 1.05, `${zoomBefore} -> ${zoomAfter}`);
  c.ok('the caret stays at its place in the text', Math.abs(ed.caret.top.x - caretBefore.top.x) < 1e-6 && Math.abs(ed.caret.top.y - caretBefore.top.y) < 1e-6, JSON.stringify({ caretBefore, after: ed.caret }));
  c.ok('and the hidden field follows it on the screen', Math.abs(ed.field.left - Math.round(caretClient.x)) <= 1 && Math.abs(ed.field.top - Math.round(caretClient.y)) <= 1, JSON.stringify({ field: ed.field, caretClient }));
  await io.menu('zoom-out', 700);
  await io.click(io.at(0.75, 0.75));
  c.eq('a click off the text with the Select tool puts it down', (await io.editor()).id, null);

  // ---- Ctrl with the Text tool --------------------------------------------------------------------------------------
  await io.tool('tool-text');
  await io.click(await io.onChar(id, 2));
  ed = await io.editor();
  c.ok('a click with the Text tool on a text edits it, at the character clicked', ed.id === id && ed.focus === 2, JSON.stringify(ed));
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: CTRL });
  await sleep(450);
  let input = await io.input();
  c.ok('Ctrl held shows the selection tool', input.tool === 'select' && input.springFrom === 'text', JSON.stringify(input));
  c.eq('the text still being edited', (await io.editor()).id, id);
  await io.click(io.at(0.75, 0.75), 1, CTRL);
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  await sleep(300);
  c.eq('a Ctrl-click elsewhere puts the text down', (await io.editor()).id, null);
  input = await io.input();
  c.eq('and letting Ctrl go gives the Text tool back', input.tool, 'text');

  // ---- An IME composition ---------------------------------------------------------------------------------------------
  await io.click(await io.onChar(id, 3));
  const textBefore = (await io.type(id)).text;
  await page.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
  await sleep(200);
  ed = await io.editor();
  c.ok('a composition is in the text as it is typed', ed.composing && ed.text === textBefore.slice(0, 3) + 'ni' + textBefore.slice(3), JSON.stringify({ composing: ed.composing, text: ed.text }));
  await page.send('Input.insertText', { text: '你' });
  await sleep(200);
  ed = await io.editor();
  c.ok('and committed, what it chose takes its place', !ed.composing && ed.text === textBefore.slice(0, 3) + '你' + textBefore.slice(3), JSON.stringify({ composing: ed.composing, text: ed.text }));
  c.eq('the caret after it', ed.focus, 4);
  c.eq('the hidden field holds the text again', ed.field.value, ed.text);
  await io.key('Enter', CTRL);
  c.eq('Ctrl+Enter puts the text down', (await io.editor()).id, null);
  c.ok('keeping what was composed', (await io.type(id)).text.includes('\u4f60'), (await io.type(id)).text);

  // ---- An emptied text goes; spaces stay ----------------------------------------------------------------------------------
  const count = (await io.marks()).length;
  await io.click(io.at(0.6, 0.6));
  await io.typeText('x');
  await io.key('Backspace');
  await io.key('Escape');
  c.eq('a text emptied before it is put down leaves no mark', (await io.marks()).length, count);
  await io.click(io.at(0.6, 0.6));
  await io.typeText('  a  ');
  const spaced = (await io.editor()).id;
  await io.key('Escape');
  c.eq('the spaces a text is typed with are kept', (await io.type(spaced))?.text, '  a  ');

  c.eq('no page errors', JSON.stringify(await page.evalIn('return window.__errors;')), '[]');
} finally {
  await stop(app);
}

process.exit(c.summary() ? 0 : 1);
