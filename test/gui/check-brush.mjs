/**
 * The Brush: the tool the app called the Pen, renamed.
 *
 * Wherever a person reads it, the Pen is the Brush, on `B`, with a brush for
 * its icon, and Vector Path moves to `P`. Its id stays `pen` - in files,
 * scripts, settings and saved shortcuts - so nothing anyone saved changes.
 *
 * One app: the toolbar button's label, name, tooltip and icon; the menu
 * bar's Sketch and Transform rows with their keys, and Vector Path's
 * tooltip; `B` and `P` choosing the two tools; a stroke landing on a layer
 * named "Brush 1"; and the Stroke Profile's tooltip naming the brush.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const app = launch({ mode: 'new', sketchName: 'brush' });

/** A menu of the live menu bar, by its label. */
const menuOf = (bar, label) => bar.find((menu) => menu.label === label)?.submenu ?? [];
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

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
  const tool = () => page.evalIn("return document.getElementById('canvas').dataset.tool;");
  const key = async (code, name) => {
    await page.chord(code, name);
    await sleep(300);
  };

  // ---- The button --------------------------------------------------------------------------
  const button = await page.evalIn(`
    const b = document.getElementById('tool-pen');
    const icon = b.querySelector('.icon');
    return {
      label: b.querySelector('.label')?.textContent ?? null,
      aria: b.getAttribute('aria-label'),
      title: b.title,
      svg: icon?.querySelector('svg') ? icon.querySelector('svg').getAttribute('class') : null,
      text: icon?.textContent.trim() ?? '',
    };`);
  c.eq('the toolbar button reads Brush', button.label, 'Brush');
  c.eq('and is named Brush', button.aria, 'Brush');
  c.eq('its tooltip says Brush and B', button.title, 'Brush (B)');
  c.ok('its icon is a drawn brush, not the pen character', button.svg === 'brush-glyph' && button.text === '', JSON.stringify(button));

  // ---- The menu bar -----------------------------------------------------------------------
  const bar = await page.evalIn('return await window.napkin.getAppMenu();');
  const brushRow = rowOf(menuOf(bar, 'Sketch'), 'tool-pen');
  c.ok('the Sketch menu has Brush, on B', brushRow?.label === 'Brush' && brushRow?.accelerator === 'B', JSON.stringify(brushRow));
  const vectorRow = rowOf(menuOf(bar, 'Transform'), 'tool-vector');
  c.ok('and the Transform menu Vector Path, on P', vectorRow?.label === 'Vector Path' && vectorRow?.accelerator === 'P', JSON.stringify(vectorRow));
  const vectorTitle = await page.evalIn("return document.getElementById('tool-vector').title;");
  c.ok("Vector Path's tooltip says P", vectorTitle.startsWith('Vector Path (P)'), vectorTitle);

  // ---- The keys ----------------------------------------------------------------------------
  await key(66, 'b');
  c.eq('B takes the Brush', await tool(), 'pen');
  await key(80, 'p');
  c.eq('P takes Vector Path', await tool(), 'vector');
  await key(66, 'b');
  c.eq('and B the Brush again', await tool(), 'pen');

  // ---- A stroke's layer --------------------------------------------------------------------
  const r = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);
  const at = (fx, fy) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy });
  /** A wavy stroke across the canvas, `fy` of the way down. */
  const stroke = async (fy) => {
    const from = at(0.3, fy);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 16; i++) {
      const p = at(0.3 + 0.02 * i, fy + 0.1 * Math.sin(i / 3));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(10);
    }
    const to = at(0.62, fy + 0.1 * Math.sin(16 / 3));
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(500);
  };
  // A new page's first mark takes its empty Layer 1; the next is given a layer named for its tool.
  await stroke(0.35);
  await stroke(0.65);
  const marks = await page.evalIn('return window.napkinCheck.strokeSummary();');
  c.ok('the strokes are pen marks, as files have always called them', marks.length === 2 && marks.every((m) => m.tool === 'pen'), JSON.stringify(marks.map((m) => m.tool)));
  c.eq('the second on a layer named Brush 1', marks[1]?.layer, 'Brush 1');

  // ---- The Stroke Profile ------------------------------------------------------------------
  const profileTitle = await page.evalIn("return document.getElementById('stroke-profile').title;");
  c.ok("the Stroke Profile's tooltip names the brush", /new brush and marker strokes/.test(profileTitle), profileTitle);

  const errors = await page.evalIn('return window.__errors ?? [];');
  c.ok('the page threw nothing', errors.length === 0, errors.join(' | '));
  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}
