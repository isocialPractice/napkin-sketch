/**
 * Minimal DevTools-protocol driver for the napkin-sketch GUI checks.
 *
 * Lives in `test/` rather than `dist-test/` because `npm test` wipes that
 * folder, and a harness that disappears every time the unit tests run is one
 * nobody keeps. `scripts/test.mjs` only bundles `test/*.test.ts`, so nothing
 * in here is picked up by the unit suite.
 *
 * Run with `node --experimental-websocket`, which Node 21 needs before
 * `globalThis.WebSocket` exists, or through `npm run gui-check`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = 9222;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The user-data folders `launch` made, by the app it made each for; `stop` removes them. */
const madeUserData = new WeakMap();

/**
 * Starts the built app with the debugging port open. `extraEnv` adds to its
 * environment - `NAPKIN_USER_DATA` gives it a user-data folder of the check's
 * own, for a check that puts files there or reads them back.
 *
 * With none given, the app gets a new empty folder, removed by `stop`. The
 * shared one, `%APPDATA%/Electron`, is where the app run from this checkout
 * by hand keeps its settings, so a check left to use it would start from
 * whatever a person or an earlier check saved there, leave its own clicks
 * behind for the next, and share the folder with a copy of the app a person
 * has open.
 */
export function launch(launchOptions, extraEnv = {}) {
  const own = extraEnv.NAPKIN_USER_DATA ? null : mkdtempSync(join(tmpdir(), 'napkin-check-'));
  // NAPKIN_GUI_CHECK lets a check read the menu bar back and click its rows
  // (window.napkin.getAppMenu / clickAppMenuItem); an ordinary launch has no
  // use for either.
  const env = {
    ...process.env,
    NAPKIN_LAUNCH: JSON.stringify(launchOptions),
    NAPKIN_GUI_CHECK: '1',
    ...(own ? { NAPKIN_USER_DATA: own } : {}),
    ...extraEnv,
  };
  // Inherited by the child, and the app dies on `setAppUserModelId` of
  // undefined when it is set. Deleting is the only thing that works: setting
  // it to '' does not, because the variable only has to be present.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    resolve(ROOT, 'node_modules/electron/dist/electron.exe'),
    [
      resolve(ROOT, 'dist/main/main.js'),
      `--remote-debugging-port=${PORT}`,
      // Windows can open a check's window behind the one in front, and
      // Chromium stops drawing a window it takes to be covered: no animation
      // frame runs, so a picked colour never reaches the canvas, and a wheel
      // event is never answered, so the check waits for ever. These keep the
      // window drawing wherever it is.
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (b) => process.stdout.write(`[app] ${b}`));
  child.stderr.on('data', (b) => process.stderr.write(`[app!] ${b}`));
  if (own) madeUserData.set(child, own);
  return child;
}

/**
 * Stops the app and every process it started, and waits for it to go, so the
 * next check can take the debugging port.
 *
 * `child.kill()` ends the main process alone, and on Windows the renderer it
 * started can outlive it - orphaned, spinning a core each. Twenty of them had
 * piled up over a day of runs and slowed the machine until checks failed on
 * timing alone. `taskkill /T` ends the whole tree.
 *
 * Then the user-data folder `launch` made for it goes too.
 */
export async function stop(app) {
  if (app.exitCode === null && app.signalCode === null) {
    const gone = new Promise((done) => app.once('exit', done));
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    else app.kill();
    await gone;
    await sleep(1000);
  }
  const folder = madeUserData.get(app);
  if (folder) {
    madeUserData.delete(app);
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/** The windows the app has open, as the debugging port lists them: each one's `url`, `title` and target. */
export async function pages() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return targets.filter((t) => t.type === 'page');
}

/**
 * Waits for a window's target, then connects to it: the drawing window
 * unless `url` names another page, such as 'settings.html'. The drawing
 * window is named by its folder, since the documentation has index pages too.
 */
export async function connect({ tries = 60, url = 'renderer/index.html' } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const page = (await pages()).find((t) => t.url.includes(url));
      if (page) return await open(page.webSocketDebuggerUrl);
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`no page target appeared for ${url}`);
}

function open(url) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.fail(new Error(JSON.stringify(msg.error)));
      else waiter.done(msg.result);
    });
    ws.addEventListener('error', fail);
    // A window that closes answers nothing more: every call still waiting
    // fails, rather than leaving the check waiting for ever.
    ws.addEventListener('close', () => {
      for (const waiter of pending.values()) waiter.fail(new Error('the window closed'));
      pending.clear();
    });
    ws.addEventListener('open', () =>
      done({
        send(method, params = {}) {
          const mine = ++id;
          ws.send(JSON.stringify({ id: mine, method, params }));
          return new Promise((res, rej) => pending.set(mine, { done: res, fail: rej }));
        },
        /** Evaluates an expression in the page and returns its value. */
        async evalIn(expression) {
          const out = await this.send('Runtime.evaluate', {
            expression: `(async () => { ${expression} })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          if (out.exceptionDetails) {
            throw new Error(out.exceptionDetails.exception?.description ?? 'page threw');
          }
          return out.result.value;
        },
        async click(x, y) {
          for (const type of ['mousePressed', 'mouseReleased']) {
            await this.send('Input.dispatchMouseEvent', {
              type,
              x,
              y,
              button: 'left',
              clickCount: 1,
              buttons: type === 'mousePressed' ? 1 : 0,
            });
          }
        },
        /** Sends one chord; `modifiers` is 2 for Ctrl and 8 for Shift. */
        async chord(code, key, modifiers = 0) {
          for (const type of ['rawKeyDown', 'keyUp']) {
            await this.send('Input.dispatchKeyEvent', {
              type,
              windowsVirtualKeyCode: code,
              nativeVirtualKeyCode: code,
              key,
              modifiers,
            });
          }
        },
        close: () => ws.close(),
      }),
    );
  });
}

/**
 * Records assertions rather than throwing, so one failure does not hide the
 * rest of a run and the app is still killed in the caller's `finally`.
 */
export function checker() {
  const results = [];
  return {
    ok(label, condition, detail = '') {
      results.push({ pass: !!condition });
      console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    },
    eq(label, actual, expected) {
      this.ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}`);
    },
    summary() {
      const failed = results.filter((r) => !r.pass).length;
      console.log(`\n${results.length - failed}/${results.length} checks passed`);
      return failed === 0;
    },
  };
}
