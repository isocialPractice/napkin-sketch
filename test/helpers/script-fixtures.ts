/**
 * The assets and documents napkin script examples run with.
 *
 * `image "logo"` and `use "badge"` in the verb table and on the pages under
 * `docs/api/` name these, as a host would name its own. A script reads no
 * files, so every run that draws an image by name or copies a document in is
 * handed them, and the tests hand them over the way a host does.
 */
import { encodePng } from '../../src/core/graphic-design/png.js';
import { evaluate } from '../../src/core/script/index.js';
import type { Sketch } from '../../src/core/types.js';

/** A PNG data URL of two flat halves, left and right. */
export function pngDataUrl(
  width: number,
  height: number,
  left: readonly number[] = [44, 123, 229],
  right: readonly number[] = [243, 156, 18],
): string {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([...(x < width / 2 ? left : right), 255], (y * width + x) * 4);
    }
  }
  return `data:image/png;base64,${Buffer.from(encodePng(rgba, width, height)).toString('base64')}`;
}

/** The `logo` the examples place: a 40 by 20 PNG. */
export const LOGO = pngDataUrl(40, 20);

/** The script the `badge` document is drawn from: a card with a word on it and a dot in a group. */
export const BADGE_SCRIPT = `napkin 1
page 200 120
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 10 10 180 100 r 14
layer "Words"
text "Acme" at 100 40 size 28 align center
group "Mark" {
  layer "Dot"
  fill #c0392b
  circle 160 85 10
}`;

/** The `badge` the examples copy in: one page, with a group inside it. */
export const BADGE: Sketch = evaluate(BADGE_SCRIPT, { timestamp: '2026-09-25T00:00:00.000Z', name: 'badge' }).book.sketches[0];

/** What a run is handed so the examples can draw `logo` and copy `badge` in. */
export const SCRIPT_FIXTURES = { assets: { logo: LOGO }, documents: { badge: BADGE } };
