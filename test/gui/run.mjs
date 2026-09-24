/**
 * Runs every `check-*.mjs` in this folder, one at a time.
 *
 * One at a time because each launches the app on a fixed debugging port, and
 * two at once collide on it. Pass a substring to narrow the run:
 *
 *     npm run gui-check
 *     npm run gui-check -- gradient
 *
 * The app has to be built first (`npm run build`); these drive `dist/`.
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const checks = (await readdir(HERE))
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort();

if (checks.length === 0) {
  console.error(only.length > 0 ? `no check matches ${only.join(', ')}` : 'no checks found');
  process.exit(1);
}

let failed = 0;
for (const check of checks) {
  console.log(`\n=== ${check} ===`);
  // The app dies on startup with this set, and it is inherited.
  const env = { ...process.env };
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
