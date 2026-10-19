/**
 * The built command line, for the tests that run it as a process: where it
 * is, and whether it can be trusted. A build older than the source would test
 * code that is no longer the source, so such a test is skipped, saying why,
 * rather than failed or passed on the wrong code.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './repo-root.js';

/** The built CLI's entry. */
export const CLI = join(repoRoot(), 'dist', 'cli', 'index.js');

/** The newest modification time of any file under `dir`. */
function newest(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}

/** Why a file the build writes cannot be trusted - missing, or older than the source - or null when it can. */
export function builtSkipReason(relative: string): string | null {
  const file = join(repoRoot(), ...relative.split('/'));
  if (!existsSync(file)) return `${relative} is missing; run npm run build first`;
  if (statSync(file).mtimeMs < newest(join(repoRoot(), 'src'))) return `${relative} is older than src/; run npm run build first`;
  return null;
}

/** Why the built CLI cannot be run - missing, or older than the source - or null when it can. */
export function cliSkipReason(): string | null {
  return builtSkipReason('dist/cli/index.js');
}
