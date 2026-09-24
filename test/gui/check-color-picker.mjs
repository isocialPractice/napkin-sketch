/**
 * The custom ink colour has to reach a selection, the way a swatch does.
 *
 * With the Select tool active and something selected, clicking a swatch
 * fills the selected closed shapes and recolours the selected open strokes.
 * The colour well beside the swatches only changed the ink for the next mark,
 * so a colour chosen there never touched the selection it was picked for.
 *
 * Chromium's colour popup cannot be driven from outside the page, so this
 * does what the popup does: a run of `input` events while the colour is
 * dragged, then one `change` when it closes. The whole drag has to land as a
 * single undo step, or undoing a pick would walk back through every colour
 * the pointer crossed on the way.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'color-picker',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'color-picker-shapes.svg')],
});

/** Canvas samples in the fixture's ink (#1f2328) and in the picked red (#d0342c). */
const COUNT = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  let red = 0;
  for (let i = 0; i < d.length; i += 8) {
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r < 70 && g < 70 && b < 80) ink++;
    else if (r > 170 && g < 110 && b < 100) red++;
  }
  return { ink, red };
`;

/** Plays one picker session: the colours the pointer crossed, then the close. */
const pick = (colors) => `
  const input = document.getElementById('color-custom');
  for (const color of ${JSON.stringify(colors)}) {
    input.value = color;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return document.getElementById('toast').textContent;
`;

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const before = await page.evalIn(COUNT);
  c.ok(
    'the fixture arrived in its ink',
    before.ink > 200 && before.red === 0,
    JSON.stringify(before),
  );

  // Select everything with the Select tool, as a person would.
  await page.evalIn(
    `document.getElementById('tool-select').click(); document.activeElement?.blur(); return true;`,
  );
  await page.chord(65, 'a', 2);
  await sleep(300);
  const selected = await page.evalIn(`return document.getElementById('toast').textContent;`);
  c.ok('Ctrl+A selected the closed shape and the open stroke', /Selected 2 elements/.test(selected), selected);

  const told = await page.evalIn(pick(['#2a9d8f', '#e9c46a', '#d0342c']));
  await sleep(300);
  const after = await page.evalIn(COUNT);
  c.ok('the picked colour reached the selection', after.red > before.ink * 0.6, JSON.stringify(after));
  c.ok('nothing is left in the old ink', after.ink < before.ink * 0.1, JSON.stringify(after));
  c.ok('and the app said what it did', /Filled|Recolored/.test(told), told);

  // One undo takes the whole drag back, not just the last colour it crossed.
  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(90, 'z', 2);
  await sleep(400);
  const undone = await page.evalIn(COUNT);
  c.ok(
    'one undo takes the whole picker drag back',
    undone.red === 0 && undone.ink > before.ink * 0.9,
    JSON.stringify(undone),
  );

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
