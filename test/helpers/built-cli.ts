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

/** Why the built CLI cannot be run - missing, or older than the source - or null when it can. */
export function cliSkipReason(): string | null {
  if (!existsSync(CLI)) return 'dist/cli/index.js is missing; run npm run build first';
  if (statSync(CLI).mtimeMs < newest(join(repoRoot(), 'src'))) return 'dist/cli/index.js is older than src/; run npm run build first';
  return null;
}
