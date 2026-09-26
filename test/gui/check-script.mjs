/**
 * A drawing a script generated, in the app.
 *
 * Two runs. The first opens the book `renderBook` writes for a script with a
 * layer tree, a Bezier path and a boxed caption, and checks that the Layers
 * panel shows the tree, that the ink is on the canvas, and that Save writes
 * the path's anchors and the caption's box back as the script made them. The
 * second imports the SVG `renderSketch` writes for that caption: the SVG
 * breaks a boxed caption into lines, and the importer has to read it back as
 * one text item in its box, with its words whole.
 *
 * The script module is TypeScript, so it is bundled with esbuild first, as the
 * unit tests are, into a temporary folder.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-script-check-'));
const TIME = '2026-09-25T00:00:00.000Z';

const bundle = join(dir, 'script.mjs');
await build({
  entryPoints: [resolve(ROOT, 'src/core/script/index.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'warning',
});
const { evaluate, renderBook, renderSketch } = await import(pathToFileURL(bundle).href);

const WORDS = 'Acme Corp makes the finest anvils in the west';
const SCRIPT = `napkin 1
page 800 500
name "acme-card"
background #fcfaf5
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 40 40 360 220 r 16
group "Figure" {
  layer "Head"
  fill none
  circle 560 140 60
  layer "Wave"
  width 6
  path "M480 300 C540 240 600 360 660 300 S780 300 760 360"
}
layer "Caption"
text "${WORDS}" at 60 320 size 28 box 300
`;

const result = evaluate(SCRIPT, { timestamp: TIME });
if (!result.ok) {
  console.error(result.diagnostics);
  throw new Error('the check script has errors');
}
const generated = result.book.sketches[0];
const layerNamed = (sketch, name) => sketch.layers.find((layer) => layer.name === name);
const strokesOn = (sketch, name) => sketch.strokes.filter((stroke) => stroke.layer === layerNamed(sketch, name)?.id);

const bookPath = join(dir, 'acme-card.skbk');
writeFileSync(bookPath, renderBook(result.book, { format: 'skbk' }));

const ROWS = `return [...document.querySelectorAll('#layers-list .layer-row')].map((row) => row.querySelector('.layer-name')?.textContent?.trim() ?? '');`;

/** How many canvas pixels are within 12 of a color on every channel. */
const pixelsOf = (r, g, b) => `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - ${r}) <= 12 && Math.abs(d[i + 1] - ${g}) <= 12 && Math.abs(d[i + 2] - ${b}) <= 12) n++;
  }
  return n;
`;

let app = launch({ mode: 'book', filePath: bookPath });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const rows = await page.evalIn(ROWS);
  const want = ['Caption', 'Figure', 'Wave', 'Head', 'Card'];
  c.ok('the Layers panel shows the tree the script built, each group above what it holds', JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
  const card = await page.evalIn(pixelsOf(255, 224, 138));
  c.ok("the card's fill is on the canvas", card > 5000, `${card} pixels of #ffe08a`);
  const ink = await page.evalIn(pixelsOf(31, 35, 40));
  c.ok('and so is its ink', ink > 1000, `${ink} pixels of #1f2328`);

  await page.evalIn(`document.getElementById('save').click(); return true;`);
  await sleep(1500);
  const saved = JSON.parse(readFileSync(bookPath, 'utf8')).sketches[0];
  const [wave] = strokesOn(saved, 'Wave');
  const [made] = strokesOn(generated, 'Wave');
  c.ok(
    'Save writes the Bezier anchors back as the script made them',
    Boolean(wave?.vector) && JSON.stringify(wave.vector) === JSON.stringify(made.vector),
    `${wave?.vector?.anchors?.length ?? 0} anchors`,
  );
  const [caption] = strokesOn(saved, 'Caption');
  c.ok('and the caption in its box', caption?.text === WORDS && caption.textBoxWidth === 300, JSON.stringify({ text: caption?.text, box: caption?.textBoxWidth }));
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}

// The caption alone, written as SVG: the box is broken into one tspan a line.
const captionPage = evaluate(`napkin 1\npage 800 500\nlayer "Caption"\ntext "${WORDS}" at 60 320 size 28 box 300\n`, { timestamp: TIME }).book.sketches[0];
const svg = renderSketch(captionPage, { format: 'svg' });
const svgPath = join(dir, 'caption.svg');
writeFileSync(svgPath, svg);
const lines = (svg.match(/<tspan/g) ?? []).length;
const blankPath = join(dir, 'blank.skbk');
writeFileSync(blankPath, renderBook(evaluate('napkin 1\npage 800 500\nname "blank"\n', { timestamp: TIME }).book, { format: 'skbk' }));

app = launch({ mode: 'book', filePath: blankPath, importFiles: [svgPath] });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  await page.evalIn(`document.getElementById('save').click(); return true;`);
  await sleep(1500);
  const texts = JSON.parse(readFileSync(blankPath, 'utf8')).sketches.flatMap((sketch) => sketch.strokes.filter((stroke) => stroke.tool === 'text'));
  c.ok(`the SVG broke the caption into ${lines} lines, and it imports as one text item`, lines > 2 && texts.length === 1, `${texts.length} text items`);
  const [text] = texts;
  c.ok('with its words whole', text?.text === WORDS, JSON.stringify(text?.text));
  // Measured against its size, so a scale the import applies does not matter.
  const ratio = (text?.textBoxWidth ?? 0) / (text?.fontSize ?? 1);
  c.ok('in a box as wide as the one it was written in', Math.abs(ratio - 300 / 28) < 0.01, `box ${text?.textBoxWidth} at size ${text?.fontSize}`);
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

if (!c.summary()) process.exitCode = 1;
