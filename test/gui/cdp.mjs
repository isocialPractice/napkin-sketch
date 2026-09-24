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
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = 9222;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts the built app with the debugging port open. */
export function launch(launchOptions) {
  const env = { ...process.env, NAPKIN_LAUNCH: JSON.stringify(launchOptions) };
  // Inherited by the child, and the app dies on `setAppUserModelId` of
  // undefined when it is set. Deleting is the only thing that works: setting
  // it to '' does not, because the variable only has to be present.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    resolve(ROOT, 'node_modules/electron/dist/electron.exe'),
    [resolve(ROOT, 'dist/main/main.js'), `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (b) => process.stdout.write(`[app] ${b}`));
  child.stderr.on('data', (b) => process.stderr.write(`[app!] ${b}`));
  return child;
}

/** Waits for the drawing window's target, then connects to it. */
export async function connect({ tries = 60 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return await open(page.webSocketDebuggerUrl);
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error('no page target appeared');
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
