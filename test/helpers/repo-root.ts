/**
 * The repository root, for a test that reads files from it. Tests run bundled
 * from another folder, so `__dirname` is the bundle's; the root is found by
 * walking up from the working directory to this package's `package.json`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf-8')).name === 'napkin-sketch') return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`repository root not found from ${process.cwd()}`);
}
