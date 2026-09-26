/**
 * Where `rsvg-convert` lives, if anywhere: `$RSVG_CONVERT`, then the PATH,
 * then MSYS2's usual place. The tests that hold a PNG to the SVG it came from
 * render the SVG with it, and skip, saying why, where it is not installed.
 */

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function findRsvg(): string | null {
  const names = process.platform === 'win32' ? ['rsvg-convert.exe', 'rsvg-convert'] : ['rsvg-convert'];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const candidates = [
    process.env.RSVG_CONVERT,
    ...dirs.flatMap((dir) => names.map((name) => join(dir, name))),
    'C:/msys64/mingw64/bin/rsvg-convert.exe',
  ];
  return candidates.find((path): path is string => typeof path === 'string' && path !== '' && existsSync(path)) ?? null;
}

/** Why a test that needs `rsvg-convert` is skipped, or false when it runs. */
export const RSVG_SKIP = 'rsvg-convert is not installed; set RSVG_CONVERT to its path to run this';
