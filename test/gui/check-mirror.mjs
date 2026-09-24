/**
 * Mirror Selection, driven through its palette.
 *
 * The fixture is one right-pointing triangle. Where its ink's centre falls in
 * its box says which way it points, so a horizontal mirror in place shows up
 * as that "lean" crossing the middle while the box stays put, and a mirrored
 * copy shows up as twice the ink reaching one box-width further right.
 *
 * The palette's preview and its commit are one store transaction, and the two
 * claims that rest on that are checked here rather than trusted: Mirror is a
 * single undo step, and a cancelled preview leaves no history behind at all -
 * Redo is still offered afterwards, which it would not be had anything been
 * committed in between.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'mirror',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'mirror-triangle.svg')],
});

/** The triangle's ink: how much, its box, and where its centre sits across the box. */
const INK = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, sx = 0, minX = Infinity, maxX = -Infinity;
  for (let y = 0; y < cv.height; y += 2) {
    for (let x = 0; x < cv.width; x += 2) {
      const i = (y * cv.width + x) * 4;
      if (d[i + 3] < 128) continue;
      if (d[i] > 90 || d[i + 1] > 90 || d[i + 2] > 100) continue; // ink only
      n++;
      sx += x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return n ? { n, minX, maxX, lean: Number(((sx / n - minX) / (maxX - minX)).toFixed(3)) } : { n };
`;

const state = `return {
  open: !document.getElementById('mirror-dialog').classList.contains('is-hidden'),
  toast: document.getElementById('toast').textContent,
  redo: !document.getElementById('redo').disabled,
};`;

/** Sets the palette's checkboxes the way a person would, by clicking them. */
const choose = (wanted) => `
  for (const [id, on] of Object.entries(${JSON.stringify(wanted)})) {
    const box = document.getElementById(id);
    if (box.checked !== on) box.click();
  }
  return true;
`;

const click = (id) => `document.getElementById('${id}').click(); return true;`;

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  await page.evalIn(`${click('tool-select')} `);
  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(65, 'a', 2);
  await sleep(300);

  const before = await page.evalIn(INK);
  c.ok('the triangle points right to start with', before.n > 200 && before.lean < 0.45, JSON.stringify(before));

  // In place, with the live preview: the flip shows before anything is kept.
  await page.evalIn(click('mirror-selection'));
  await page.evalIn(
    choose({
      'mirror-horizontal': true,
      'mirror-vertical': false,
      'mirror-copy': false,
      'mirror-preview': true,
    }),
  );
  await sleep(500);
  const preview = await page.evalIn(INK);
  c.ok('the palette opened', (await page.evalIn(state)).open);
  c.ok(
    'the live preview shows it flipped, where it stood',
    preview.lean > 0.55 &&
      Math.abs(preview.minX - before.minX) <= 6 &&
      Math.abs(preview.maxX - before.maxX) <= 6,
    JSON.stringify(preview),
  );

  await page.evalIn(click('mirror-apply'));
  await sleep(500);
  const applied = await page.evalIn(INK);
  const afterApply = await page.evalIn(state);
  c.ok('Mirror keeps it and the palette goes', !afterApply.open && applied.lean > 0.55, JSON.stringify(applied));
  c.ok('and says what it did', /Mirrored 1 element horizontally/.test(afterApply.toast), afterApply.toast);

  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(90, 'z', 2);
  await sleep(400);
  const undone = await page.evalIn(INK);
  c.ok('one Ctrl+Z points it right again', undone.lean < 0.45 && Math.abs(undone.n - before.n) < before.n * 0.05, JSON.stringify(undone));

  // As a copy: the original stays and its mirror image lands beside it.
  await page.chord(65, 'a', 2);
  await sleep(200);
  await page.evalIn(click('mirror-selection'));
  await page.evalIn(choose({ 'mirror-copy': true }));
  await sleep(500);
  await page.evalIn(click('mirror-apply'));
  await sleep(500);
  const copied = await page.evalIn(INK);
  const width = before.maxX - before.minX;
  c.ok(
    'a mirrored copy doubles the ink and reaches one box-width further right',
    Math.abs(copied.n / before.n - 2) < 0.15 &&
      Math.abs(copied.minX - before.minX) <= 6 &&
      Math.abs(copied.maxX - (before.maxX + width)) <= 8,
    `${JSON.stringify(copied)} against width ${width}`,
  );
  c.ok('and the toast says it was a copy', /Mirrored a copy of 1 element/.test((await page.evalIn(state)).toast));

  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(90, 'z', 2);
  await sleep(400);
  const copyUndone = await page.evalIn(INK);
  c.ok('one Ctrl+Z takes the copy away', Math.abs(copyUndone.n - before.n) < before.n * 0.05, JSON.stringify(copyUndone));
  c.ok('which leaves the copy to redo', (await page.evalIn(state)).redo);

  // A cancelled preview: shown, taken back, and nothing kept in between.
  await page.chord(65, 'a', 2);
  await sleep(200);
  await page.evalIn(click('mirror-selection'));
  await sleep(500);
  const showing = await page.evalIn(INK);
  c.ok('the preview of a copy shows two triangles', Math.abs(showing.n / before.n - 2) < 0.15, JSON.stringify(showing));
  await page.evalIn(click('mirror-cancel'));
  await sleep(400);
  const cancelled = await page.evalIn(INK);
  const afterCancel = await page.evalIn(state);
  c.ok(
    'Cancel takes the preview off the page',
    !afterCancel.open && Math.abs(cancelled.n - before.n) < before.n * 0.05 && cancelled.lean < 0.45,
    JSON.stringify(cancelled),
  );
  c.ok('and leaves history as it was - Redo is still there', afterCancel.redo);

  // The palette mirrors what was selected when it opened: dropping the
  // selection while it is up does not leave it with nothing to do.
  await page.chord(65, 'a', 2);
  await sleep(200);
  await page.evalIn(click('mirror-selection'));
  await page.evalIn(choose({ 'mirror-copy': false }));
  await sleep(300);
  await page.chord(65, 'a', 2 | 8); // Ctrl+Shift+A: select nothing
  await sleep(300);
  await page.evalIn(click('mirror-apply'));
  await sleep(500);
  const retained = await page.evalIn(INK);
  c.ok(
    'with the selection dropped while it was open, Mirror still flips what it opened on',
    retained.lean > 0.55 && Math.abs(retained.n - before.n) < before.n * 0.05,
    JSON.stringify(retained),
  );

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
