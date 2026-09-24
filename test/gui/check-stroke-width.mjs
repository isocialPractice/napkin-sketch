/**
 * The toolbar's width has to reach a selection, the way its colour does.
 *
 * With the Select tool active and something selected, moving the Width slider
 * only changed the width of the next mark; the selected one kept its own until
 * another was drawn. Now the selection takes the width as the slider moves -
 * the whole drag one undo step - and a width typed with the Quick Width key
 * (`W`, then digits) reaches it the same way. With a drawing tool in hand the
 * slider is for the next mark again, whatever is selected.
 *
 * The fixture is one 4 px line; its thickness is read off the canvas a column
 * at a time, so a width shows up as a ratio of thicknesses rather than as any
 * particular pixel count.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'stroke-width',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'width-line.svg')],
});

/** The line's ink: how thick it is in the middle, in device pixels. */
const THICKNESS = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const ink = (x, y) => {
    const i = (y * cv.width + x) * 4;
    return d[i + 3] >= 128 && d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 90;
  };
  let minX = Infinity, maxX = -Infinity;
  for (let y = 0; y < cv.height; y += 2) {
    for (let x = 0; x < cv.width; x += 2) {
      if (!ink(x, y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (!Number.isFinite(minX)) return 0;
  const mid = Math.round((minX + maxX) / 2);
  let best = 0;
  for (let x = mid - 2; x <= mid + 2; x++) {
    let n = 0;
    for (let y = 0; y < cv.height; y++) if (ink(x, y)) n++;
    best = Math.max(best, n);
  }
  return best;
`;

/** Moves the Width slider the way a drag does: an input for each value, one change at the end. */
const slide = (values) => `
  const slider = document.getElementById('width');
  for (const v of ${JSON.stringify(values)}) {
    slider.value = String(v);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
`;

const toast = `return document.getElementById('toast').textContent;`;
const click = (id) => `document.getElementById('${id}').click(); return true;`;

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const before = await page.evalIn(THICKNESS);
  c.ok('the 4 px line is on the page', before > 0, `${before} px thick`);

  await page.evalIn(click('tool-select'));
  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(65, 'a', 2);
  await sleep(300);

  // A drag of the slider through 8 and 14 to 20.
  await page.evalIn(slide([8, 14, 20]));
  await sleep(400);
  const wide = await page.evalIn(THICKNESS);
  c.ok('the selected line takes the width as the slider moves: 20 px is five times 4', Math.abs(wide / before - 5) < 1.25, `${wide} px against ${before}`);
  c.ok('and the toast says so', /Width 20px on 1 outline/.test(await page.evalIn(toast)), await page.evalIn(toast));

  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(90, 'z', 2);
  await sleep(400);
  const undone = await page.evalIn(THICKNESS);
  c.ok('one Ctrl+Z takes the whole drag back', Math.abs(undone - before) <= 1, `${undone} px against ${before}`);

  // A typed width: W, then 12.
  await page.chord(65, 'a', 2);
  await sleep(200);
  await page.chord(87, 'w');
  await page.chord(49, '1');
  await page.chord(50, '2');
  await sleep(1600);
  const typed = await page.evalIn(THICKNESS);
  c.ok('Quick Width reaches the selection too: 12 px is three times 4', Math.abs(typed / before - 3) < 0.8, `${typed} px against ${before}`);
  c.ok('and says so', /Width 12px on 1 outline/.test(await page.evalIn(toast)), await page.evalIn(toast));

  // With the Pen in hand, the slider is for the next mark, selection or not.
  await page.evalIn(click('tool-pen'));
  await sleep(200);
  await page.evalIn(slide([30]));
  await sleep(400);
  const kept = await page.evalIn(THICKNESS);
  c.ok('with the Pen in hand the slider leaves the selected line alone', Math.abs(kept - typed) <= 1, `${kept} px against ${typed}`);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
