/**
 * Runs every `check-*.mjs` in this folder, one at a time.
 *
 * One at a time because each launches the app on a fixed debugging port, and
 * two at once collide on it. Pass a substring to narrow the run:
 *
 *     npm run gui-check
 *     npm run gui-check -- gradient
 *     npm run gui-check -- --background
 *
 * `--background` keeps every window the checks open off the screen and out
 * of the focus, so the computer can be used while they run (see `BACKGROUND`
 * in cdp.mjs); the menu bar's Alt sequences, which need the real focus, are
 * skipped then.
 *
 * The app has to be built first (`npm run build`); these drive `dist/`.
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const background = process.argv.includes('--background');

const checks = (await readdir(HERE))
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort();

if (checks.length === 0) {
  console.error(only.length > 0 ? `no check matches ${only.join(', ')}` : 'no checks found');
  process.exit(1);
}

if (background) console.log('In the background: the windows stay off the screen and out of the focus, and the checks that need the real focus are skipped.');

let failed = 0;
for (const check of checks) {
  console.log(`\n=== ${check} ===`);
  // The app dies on startup with this set, and it is inherited.
  const env = { ...process.env, ...(background ? { NAPKIN_GUI_BACKGROUND: '1' } : {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((done) => {
    spawn(process.execPath, ['--experimental-websocket', resolve(HERE, check)], {
      cwd: ROOT,
      stdio: 'inherit',
      env,
    }).on('close', done);
  });
  if (code !== 0) failed++;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
