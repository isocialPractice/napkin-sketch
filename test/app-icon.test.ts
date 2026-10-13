/**
 * The app icon is the one kept in `assets/`, used as it is: the build copies
 * it and never draws or resizes one. electron-builder makes the Windows `.ico`
 * and the macOS `.icns` from that one PNG, and it refuses an icon that is not
 * square or is smaller than 512 x 512 for macOS - so this holds the kept file
 * to both, and says how to put it right when it is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The repository root, found by walking up until this package's manifest. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && /^(@isocialpractice\/)?napkin-sketch$/.test(JSON.parse(readFileSync(pkg, 'utf-8')).name)) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`repository root not found from ${process.cwd()}`);
}

const ICON = join(repoRoot(), 'assets', 'icon.png');
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MIN_SIZE = 512;
const FIX =
  'Export assets/icon.png from assets/icon.svg as a square PNG, 1024 x 1024 recommended; ' +
  'electron-builder needs at least 512 x 512 for macOS.';

test('the kept app icon is a square PNG of at least 512 x 512', () => {
  assert.ok(existsSync(ICON), `assets/icon.png is missing. ${FIX}`);
  const png = readFileSync(ICON);
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, `assets/icon.png is not a PNG. ${FIX}`);

  // The IHDR chunk comes first: width and height are big-endian at 16 and 20.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, height, `assets/icon.png is ${width} x ${height}, not square. ${FIX}`);
  assert.ok(width >= MIN_SIZE, `assets/icon.png is ${width} x ${height}, under ${MIN_SIZE} x ${MIN_SIZE}. ${FIX}`);
});
