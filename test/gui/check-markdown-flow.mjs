/**
 * Markdown Flow in the app (core/type/markdown-flow.ts, the type editor's
 * reveal): a text typed as Markdown and shown as it renders.
 *
 * With New text starts in Markdown Flow on, a click with the Text tool and
 * `# Title` then Enter make a heading: the line renders big and bold, the `#`
 * gone, and Type > Markdown Flow is checked. `- one`, Enter and `two` make a
 * list - Enter carried the `- ` on - each item with its bullet once the caret
 * leaves it. Arrow keys back into the heading show its `#` again, muted, and
 * Escape renders everything. Each burst of typing is one undo step, and redo
 * brings it back. Type > Markdown Flow on the text asks, and Turn Off keeps
 * the rendered text - the heading's size, the list's bullets - its Markdown
 * gone; undo brings the Markdown back. Turned on again from the menu, a plain
 * text's characters become its Markdown.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
/** A check that two values are the same, compared as JSON. */
const deep = (label, actual, expected) => c.ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);

/** A key's `key`, `code` and virtual key code. */
const KEY = {
  Escape: ['Escape', 'Escape', 27],
  Enter: ['Enter', 'Enter', 13],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  End: ['End', 'End', 35],
  z: ['z', 'KeyZ', 90],
  y: ['y', 'KeyY', 89],
};
const CTRL = 2;

const app = launch({ mode: 'new', sketchName: 'markdown-flow' });
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
  // In the check's own settings folder: the Type panel stays down, and new text starts in Markdown Flow.
  await page.evalIn('return window.napkin.updateSettings({ typePanelAutoShow: false, markdownNewText: true }).then(() => true);');
  await sleep(300);
  const rect = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);

  const io = {
    at: (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }),
    editor: () => page.evalIn('return window.napkinCheck.typeEditorState();'),
    type: (id) => page.evalIn(`return window.napkinCheck.typesetOf(${JSON.stringify(id)});`),
    configs: () => page.evalIn('return window.napkinCheck.textConfigs();'),
    selected: () => page.evalIn('return window.napkinCheck.selectionBoxes().map((b) => b.id);'),
    tool: (id) => page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`),
    dialogShown: () => page.evalIn(`return !document.getElementById('markdown-off-dialog').classList.contains('is-hidden');`),
    async menu(id, wait = 500) {
      const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
      await sleep(wait);
      return ran;
    },
    async row(id) {
      const bar = await page.evalIn('return await window.napkin.getAppMenu();');
      const find = (items) => {
        for (const item of items ?? []) {
          if (item.id === id) return item;
          const inner = find(item.submenu);
          if (inner) return inner;
        }
        return null;
      };
      return find(bar);
    },
    async mouse(type, p, clickCount = 1) {
      await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount });
    },
    async click(p) {
      await this.mouse('mouseMoved', p, 0);
      await this.mouse('mousePressed', p, 1);
      await this.mouse('mouseReleased', p, 1);
      await sleep(80);
    },
    async key(name, modifiers = 0, wait = 150) {
      const [key, code, vk] = KEY[name];
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      if (name === 'Enter') await page.send('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: vk, modifiers });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(wait);
    },
    /**
     * Types `text` key by key, a newline as Enter, quickly enough to be one
     * burst. A letter, a digit or a space is a key; any other character -
     * `#`, `-`, whose key codes are other keys' - comes as the text it types.
     */
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
    /** A page point, in client pixels. */
    client: (x, y) => page.evalIn(`
      const r = document.getElementById('canvas').getBoundingClientRect();
      const v = window.napkinCheck.viewState();
      return { x: r.left + v.panX + ${x} * v.zoom, y: r.top + v.panY + ${y} * v.zoom };`),
  };

  /** The size the glyphs of `ch` are set in, the first of them. */
  const sizeOf = (t, ch) => t.glyphs.find((g) => g.ch === ch)?.size ?? null;

  // ---- A heading: `# Title`, then Enter ----------------------------------------------------------------
  await io.tool('tool-text');
  await io.click(io.at(0.3, 0.25));
  await sleep(200);
  let ed = await io.editor();
  c.ok('a click with the Text tool begins a new text', ed.id !== null && ed.fresh, JSON.stringify(ed));
  await io.typeText('# Title');
  ed = await io.editor();
  const id = ed.id;
  let t = await io.type(id);
  c.eq('the text is Markdown Flow, from the setting', t.typeset?.flow, 'markdown');
  c.eq('while the caret is on the line, it shows its source', t.shown, '# Title');
  await io.typeText('\n');
  t = await io.type(id);
  c.eq('Enter ends the line, and the line renders: the # is gone', t.shown, 'Title\n');
  c.eq('the source keeps it', t.text, '# Title\n');
  const body = t.glyphs.find((g) => g.ch === 'T');
  c.ok('the heading is set twice the size of the text', body && Math.abs(body.size - 2 * (t.fontSize ?? 0)) < 0.01, JSON.stringify({ size: body?.size, fontSize: t.fontSize }));
  c.ok('in the Markdown configurations the book now keeps', (await io.configs()).filter((config) => config.name.startsWith('Markdown')).length === 10, JSON.stringify((await io.configs()).map((config) => config.name)));
  c.eq('Type > Markdown Flow is checked for it', (await io.row('type-markdown'))?.checked, true);
  await sleep(1300);

  // ---- A list: `- one`, Enter, `two` - a burst of its own --------------------------------------------
  await io.typeText('- one\ntwo');
  t = await io.type(id);
  c.eq('Enter in a list item carried the marker on', t.text, '# Title\n- one\n- two');
  c.eq('the item the caret left renders, the one it is in shows its source', t.shown, 'Title\none\n- two');
  deep('the rendered item has its bullet', t.markers, ['•']);

  // ---- Back into the heading, with the arrow keys ------------------------------------------------------
  await io.key('ArrowUp');
  await io.key('ArrowUp');
  ed = await io.editor();
  t = await io.type(id);
  c.ok('two lines up the caret is in the heading', ed.focus <= 7, JSON.stringify({ focus: ed.focus }));
  c.eq('which shows its # again, and the list renders', t.shown, '# Title\none\ntwo');
  deep('both items with their bullets', t.markers, ['•', '•']);
  const hash = t.glyphs.find((g) => g.ch === '#');
  const title = t.glyphs.find((g) => g.ch === 'T');
  c.ok('the # muted, in the heading\'s size', hash && title && hash.color !== title.color && Math.abs(hash.size - title.size) < 0.01, JSON.stringify({ hash, title }));

  // ---- Undo and redo, a burst a step -------------------------------------------------------------------
  await io.key('z', CTRL, 400);
  t = await io.type(id);
  c.eq('one undo takes the list burst away whole', t?.text, '# Title\n');
  await io.key('y', CTRL, 400);
  t = await io.type(id);
  c.eq('and redo brings it back', t?.text, '# Title\n- one\n- two');

  // ---- Escape renders everything -----------------------------------------------------------------------
  await io.key('Escape');
  t = await io.type(id);
  c.eq('Escape puts the text down, every block rendered', t.shown, 'Title\none\ntwo');
  c.ok('and the text is left selected', (await io.selected()).includes(id));

  // ---- Turned off: the rendered text stays --------------------------------------------------------------
  const before = await io.type(id);
  await io.menu('type-markdown', 300);
  c.ok('Type > Markdown Flow on a Markdown text asks first', await io.dialogShown());
  await page.evalIn(`document.getElementById('markdown-off-confirm').click(); return true;`);
  await sleep(400);
  t = await io.type(id);
  c.eq('Turn Off keeps the rendered text as the text', t.text, 'Title\none\ntwo');
  c.eq('it is no longer Markdown Flow', t.typeset?.flow ?? null, null);
  c.ok('the heading keeps its size', Math.abs(sizeOf(t, 'T') - sizeOf(before, 'T')) < 0.01, JSON.stringify({ now: sizeOf(t, 'T'), was: sizeOf(before, 'T') }));
  deep('and the list its bullets', t.markers, ['•', '•']);
  c.eq('Type > Markdown Flow is no longer checked', (await io.row('type-markdown'))?.checked, false);
  await io.key('z', CTRL, 400);
  t = await io.type(id);
  c.eq('one undo brings the Markdown back', t.text, '# Title\n- one\n- two');
  c.eq('as Markdown Flow', t.typeset?.flow, 'markdown');

  // ---- Turned on: a plain text's characters become its Markdown --------------------------------------------
  await io.key('y', CTRL, 400);
  c.eq('redo takes it off again', (await io.type(id)).typeset?.flow ?? null, null);
  await io.tool('tool-select');
  const glyph = (await io.type(id)).glyphs.find((g) => g.ch === 'o');
  await io.click(await io.client(glyph.x + glyph.width / 2, glyph.y - glyph.size * 0.3));
  c.ok('the text selected with the Select tool', (await io.selected()).includes(id), JSON.stringify(await io.selected()));
  await io.menu('type-markdown', 400);
  c.ok('turning it on asks nothing', !(await io.dialogShown()));
  t = await io.type(id);
  deep('the plain text is Markdown Flow again, its characters its Markdown', [t.typeset?.flow, t.text], ['markdown', 'Title\none\ntwo']);

  const errors = await page.evalIn('return window.__errors;');
  deep('no errors on the page', errors, []);
} finally {
  await stop(app);
}

process.exit(c.summary() ? 0 : 1);
