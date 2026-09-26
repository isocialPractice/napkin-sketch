/**
 * Measured animation frames in the app: Animation Mode's Draw measured
 * frames button, the script it shows before it runs, and the frames it draws.
 *
 * One run. It opens a book holding the walking character from
 * `test/imports/walk.svg`, its root renamed `napkin-check-walk_0` so the
 * frames it saves to `animations/` cannot overwrite anybody's own, enters
 * Animation Mode and starts the wizard. The button shows for walk, and hides
 * for a type with no measured cycle and for Disable API. Pressed, it shows the
 * script, which uses each assembly and ends with the registration box, and
 * draws nothing yet; run, it draws eight frames as eight rows, says so, and
 * saves each one; and one undo takes all eight back off the page. The saved
 * files are removed afterwards.
 *
 * Animation Mode is behind its install record. Without one the check says so
 * and passes, since there is none of the mode to see.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
if (!existsSync(join(ROOT, 'ai-helper', 'installed.json'))) {
  console.log('SKIP  Animation Mode is not installed here (npm run animation-mode -- --install), so it has no wizard to check');
  process.exit(0);
}

const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-measured-check-'));

// The figure reader is TypeScript: bundled with esbuild first, into the temporary folder.
const forward = (path) => path.split('\\').join('/');
const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `export { walkFigure } from ${JSON.stringify(forward(resolve(ROOT, 'test/helpers/walk-figure.ts')))};\n` +
    `export { serializeSketchBook } from ${JSON.stringify(forward(resolve(ROOT, 'src/core/serialize.ts')))};\n`,
);
const bundle = join(dir, 'figure.mjs');
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const { walkFigure, serializeSketchBook } = await import(pathToFileURL(bundle).href);

const figure = walkFigure();
figure.layers.find((layer) => layer.name === 'walk_0').name = 'napkin-check-walk_0';
const book = {
  format: 'napkin-sketch',
  version: 3,
  name: 'napkin-check',
  sketches: [figure],
  createdAt: figure.createdAt,
  updatedAt: figure.updatedAt,
};
const bookPath = join(dir, 'napkin-check.skbk');
writeFileSync(bookPath, serializeSketchBook(book));

const FRAMES = Array.from({ length: 8 }, (_, i) => `napkin-check-walk_${i + 1}`);
const saved = FRAMES.map((name) => join(ROOT, 'animations', `${name}.svg`));
const there = saved.map((path) => existsSync(path));

const hidden = (id) => `return document.getElementById('${id}').classList.contains('is-hidden');`;
const rows = `return [...document.querySelectorAll('#layers-list .layer-row .layer-name')].map((e) => e.textContent.trim());`;
const choose = (page, type) =>
  page.evalIn(`const t = document.getElementById('anim-type'); t.value = ${JSON.stringify(type)}; t.dispatchEvent(new Event('change')); return t.value;`);
const pose = (page, id) =>
  page.evalIn(`const r = document.getElementById('${id}'); r.checked = true; r.dispatchEvent(new Event('change'));`);

const app = launch({ mode: 'book', filePath: bookPath });
try {
  const page = await connect();
  await sleep(2500);

  await page.chord(78, 'N', 2 | 8);
  await sleep(300);
  c.ok('Ctrl+Shift+N enters Animation Mode', await page.evalIn(`return document.body.classList.contains('animation-mode');`));
  await page.evalIn(`document.getElementById('animation-generate').click();`);
  await sleep(600);
  c.ok('the setup dialog opens', !(await page.evalIn(hidden('anim-step2-dialog'))));

  await choose(page, 'walk');
  c.ok('Draw measured frames shows for walk, which has a measured cycle', !(await page.evalIn(hidden('anim-step2-measured'))));
  const other = await page.evalIn(
    `return [...document.getElementById('anim-type').options].map((o) => o.value).find((v) => !['walk', 'run', 'ideal', 'knocked-down'].includes(v)) ?? null;`,
  );
  if (other) {
    await choose(page, other);
    c.ok(`and hides for ${other}, which has no measured cycle`, await page.evalIn(hidden('anim-step2-measured')));
    await choose(page, 'walk');
  }
  await pose(page, 'anim-pose-disabled');
  c.ok('and hides with Disable API, which says the rig does not fit', await page.evalIn(hidden('anim-step2-measured')));
  await pose(page, 'anim-pose-measured');

  await page.evalIn(`document.getElementById('anim-step2-measured').click();`);
  await sleep(2000);
  c.ok('pressed, it shows the script before it runs', !(await page.evalIn(hidden('anim-script-dialog'))));
  const script = await page.evalIn(`return document.getElementById('anim-script-text').textContent;`);
  c.ok(
    'the script uses each assembly and ends with the registration box',
    script.includes('use "back-arm-assembly"') && script.includes('use "front-leg-assembly"') && /\nregistration [-\d. ]+\n$/.test(script),
    script.slice(0, 60),
  );
  const message = await page.evalIn(`return document.getElementById('anim-script-msg').textContent;`);
  c.ok(
    'it says what it will draw',
    message.startsWith('8 frames, napkin-check-walk_1 to napkin-check-walk_8, from the measured walk cycle and no AI'),
    message.slice(0, 100),
  );
  c.ok('and nothing is drawn until it runs', !(await page.evalIn(rows)).some((name) => FRAMES.includes(name)));

  await page.evalIn(`document.getElementById('anim-script-run').click();`);
  await sleep(4000);
  c.eq('run, it announces the eight frames', await page.evalIn(`return document.getElementById('anim-done-msg').textContent;`), 'All 8 frames have been generated.');
  const drawn = await page.evalIn(rows);
  c.ok('the frames are eight rows beside the source', FRAMES.every((name) => drawn.includes(name)), drawn.join(', '));
  c.ok('each frame is saved to the animations folder', saved.every((path) => existsSync(path)));

  await page.evalIn(`document.getElementById('anim-done-close').click();`);
  await sleep(400);
  await page.chord(90, 'z', 2);
  await sleep(800);
  const undone = await page.evalIn(rows);
  c.ok(
    'one undo takes all eight back off the page',
    !undone.some((name) => FRAMES.includes(name)) && undone.includes('napkin-check-walk_0'),
    undone.join(', '),
  );
  page.close();
} finally {
  await stop(app);
  saved.forEach((path, i) => {
    if (!there[i]) rmSync(path, { force: true });
  });
  rmSync(dir, { recursive: true, force: true });
}
process.exit(c.summary() ? 0 : 1);
