/**
 * The Help menu, in the running app.
 *
 * The menu bar's Help menu holds Verbose, Tool Types and Source Code, with no
 * Source Docs row while the site's deployment is unchecked, and Tool Types
 * lists five rows: Transform, Draw, Pages, Layers and Automate.
 *
 * Help > Verbose opens the documentation window at the guide, read from
 * `docs/` on disk: a window of its own, with the site's own menu and no
 * bridge to the app. A page link stays in the window, Alt and an arrow go
 * back and forward, and a web link goes to the system browser - which a
 * check run records rather than opens - leaving the page where it was. Each
 * Tool Types row shows its quickstart in that same window, and the Automate
 * one leads to the Animation Mode page, which names the assemblies and the
 * frames. Help > Source Code sends the repository to the browser. Ctrl+W
 * closes the window, and Help > Verbose opens a new one.
 *
 * The app runs with a user-data folder of the check's own, removed after it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, connect, pages, sleep, checker, stop } from './cdp.mjs';

const REPO_URL = 'https://github.com/isocialPractice/napkin-sketch';
const TOPICS = [
  ['help-topic:transform', 'Transform', 'quickstart/transform'],
  ['help-topic:sketch', 'Draw', 'quickstart/draw'],
  ['help-topic:pages', 'Pages', 'quickstart/pages'],
  ['help-topic:layers', 'Layers', 'quickstart/layers'],
  ['help-topic:automate', 'Automate', 'quickstart/automate'],
];
const ALT = 1;
const CTRL = 2;

const c = checker();
const userData = mkdtempSync(join(tmpdir(), 'napkin-help-menu-'));
const app = launch({ mode: 'new', sketchName: 'help-menu' }, { NAPKIN_USER_DATA: userData });

/** A row of the menu bar by id, wherever it sits. */
function rowOf(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.submenu ? rowOf(item.submenu, id) : null;
    if (inner) return inner;
  }
  return null;
}

/** The labels of a menu's rows, separators left out. */
const labels = (items) => (items ?? []).filter((item) => item.type !== 'separator').map((item) => item.label);

/** The documentation windows open now. */
const docsWindows = async () => (await pages()).filter((t) => t.url.includes('/docs/'));

let docs = null;
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const bar = () => page.evalIn('return await window.napkin.getAppMenu();');
  const menu = async (id) => {
    const ran = await page.evalIn(`return await window.napkin.clickAppMenuItem(${JSON.stringify(id)});`);
    await sleep(600);
    return ran;
  };
  const opened = () => page.evalIn('return await window.napkin.openedLinks();');
  const toast = () => page.evalIn("return document.getElementById('toast').textContent;");

  /** Where the docs window is, once it has settled there: its path under docs/, and its hash. */
  const docsAt = async () => {
    for (let i = 0; i < 40; i++) {
      const at = await docs.evalIn('return document.readyState === "complete" ? location.href : null;').catch(() => null);
      if (at) {
        const url = new URL(at);
        return { protocol: url.protocol, page: url.pathname.replace(/^.*\/docs\//, ''), hash: url.hash };
      }
      await sleep(150);
    }
    return null;
  };
  /** Waits for the docs window to reach a page, and says whether it did. */
  const reaches = async (want) => {
    for (let i = 0; i < 30; i++) {
      const at = await docsAt();
      if (at?.page === want) return true;
      await sleep(200);
    }
    return false;
  };
  /** A real click in the middle of the first element the selector finds in the docs window. */
  const clickIn = async (selector) => {
    const at = await docs.evalIn(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center' });
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    if (!at) throw new Error(`nothing to click at ${selector}`);
    await docs.click(at.x, at.y);
    await sleep(500);
  };

  // ---- The rows ------------------------------------------------------------------------------------
  const items = await bar();
  const help = items.find((item) => item.label === 'Help');
  c.eq('Help holds Verbose, Tool Types and Source Code', labels(help?.submenu).join(' | '), 'Verbose | Tool Types | Source Code');
  c.eq('with no Source Docs row while the deployment is unchecked', rowOf(items, 'help-source-docs'), null);
  c.eq('Tool Types lists five', labels(rowOf(items, 'help-tool-types')?.submenu).join(' | '), TOPICS.map(([, label]) => label).join(' | '));
  c.eq('no documentation window is open at the start', (await docsWindows()).length, 0);

  // ---- Help > Verbose ------------------------------------------------------------------------------
  c.ok('Help > Verbose runs from the menu bar', await menu('help-verbose'));
  docs = await connect({ url: '/docs/guide/index.html', tries: 30 });
  await docs.send('Runtime.enable');
  let at = await docsAt();
  c.ok('it opens the documentation window at the guide, read from disk', at?.protocol === 'file:' && at.page === 'guide/index.html', JSON.stringify(at));
  const view = await docs.evalIn(`return {
    title: document.title,
    h1: document.querySelector('main h1')?.textContent.trim() ?? null,
    menu: document.querySelectorAll('nav.sidebar a').length,
    bridge: typeof window.napkin,
    node: typeof require + ' ' + typeof process,
  };`);
  c.ok('a page of the site, with its menu', view.h1 !== null && view.menu > 50 && /napkin-sketch/.test(view.title), JSON.stringify(view));
  c.eq('and no way into the app', `${view.bridge} ${view.node}`, 'undefined undefined undefined');
  c.ok('the drawing window says nothing is missing', !/not built|not in this copy/.test(await toast()), await toast());

  // ---- Links ---------------------------------------------------------------------------------------
  await clickIn('nav.sidebar a[href="tools.html"]');
  c.ok('a page link stays in the window', await reaches('guide/tools.html'), JSON.stringify(await docsAt()));
  await docs.chord(37, 'ArrowLeft', ALT);
  c.ok('Alt+Left goes back', await reaches('guide/index.html'), JSON.stringify(await docsAt()));
  await docs.chord(39, 'ArrowRight', ALT);
  c.ok('and Alt+Right forward again', await reaches('guide/tools.html'), JSON.stringify(await docsAt()));

  const before = (await opened()).length;
  await clickIn('header.topbar a[href^="https://github.com/"]');
  await sleep(400);
  at = await docsAt();
  c.eq('a web link leaves the page where it was', at?.page, 'guide/tools.html');
  const sent = await opened();
  c.ok('and goes to the system browser', sent.length === before + 1 && sent.at(-1) === REPO_URL, JSON.stringify(sent));

  // ---- Help > Tool Types -----------------------------------------------------------------------------
  const shown = [];
  for (const [id, , file] of TOPICS) {
    await menu(id);
    shown.push((await reaches(`${file}.html`)) ? file : `${id} -> ${JSON.stringify(await docsAt())}`);
  }
  c.eq('each Tool Types row shows its quickstart', shown.join(' | '), TOPICS.map(([, , file]) => file).join(' | '));
  c.eq('in the one window', (await docsWindows()).length, 1);

  await clickIn('main a[href="../guide/animation-mode.html#frame-names"]');
  c.ok('the Automate quickstart leads to the Animation Mode page', await reaches('guide/animation-mode.html'), JSON.stringify(await docsAt()));
  const animation = await docs.evalIn(`return {
    hash: location.hash,
    assemblies: ['front-arm-assembly', 'body', 'front-leg-assembly', 'back-leg-assembly', 'back-arm-assembly', 'Head'].every((name) => document.body.textContent.includes(name)),
    frames: document.getElementById('frame-names')?.firstChild?.textContent.trim() ?? null,
    table: document.querySelector('#frame-names ~ .table-wrap table')?.textContent.includes('animationLayer-walk_1') ?? false,
  };`);
  c.ok('at its frame names, with the six assemblies above them', animation.hash === '#frame-names' && animation.assemblies && animation.frames === 'Frame names' && animation.table, JSON.stringify(animation));

  // ---- Source Code, and closing --------------------------------------------------------------------
  const sentBefore = (await opened()).length;
  c.ok('Help > Source Code runs from the menu bar', await menu('help-source-code'));
  const sentAfter = await opened();
  c.ok('and sends the repository to the browser', sentAfter.length === sentBefore + 1 && sentAfter.at(-1) === REPO_URL, JSON.stringify(sentAfter));

  // The window closes on the key going down, so the key coming up has no window to reach.
  await docs.chord(87, 'w', CTRL).catch(() => undefined);
  let closed = false;
  for (let i = 0; i < 20 && !closed; i++) {
    await sleep(250);
    closed = (await docsWindows()).length === 0;
  }
  c.ok('Ctrl+W closes the documentation window', closed);
  docs.close();
  docs = null;

  c.ok('Help > Verbose opens a new one', await menu('help-verbose'));
  docs = await connect({ url: '/docs/guide/index.html', tries: 30 });
  c.eq('at the guide again', (await docsAt())?.page, 'guide/index.html');

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  docs?.close();
  await stop(app);
  rmSync(userData, { recursive: true, force: true });
}
