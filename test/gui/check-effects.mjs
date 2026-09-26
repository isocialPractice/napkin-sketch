/**
 * Effects in the app: a script's effects painted on the canvas, napkin's own
 * SVG read back with them, and a composition painted into a canvas through
 * `ctx.filter`.
 *
 * Four runs. The first opens the book a script with effects writes and looks
 * for what each one paints: a mark's shadow in the shadow's color, down and
 * right of the mark; a layer's grayscale, with its green gone gray; and a
 * group's shadow, which is one picture, so where its two children's shadows
 * overlap it is no darker than where they do not. The second opens a blurred
 * square and counts the soft halo around it. The third imports the SVG
 * `renderSketch` writes for the shadow and the grayscale, which carries them
 * as `data-effects`, and finds both painted again. The fourth paints a
 * composition with effects into a canvas of its own, in the app's page, with
 * the composition canvas painter.
 *
 * The script module and the painter are TypeScript, so they are bundled with
 * esbuild first, into a temporary folder.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-effects-check-'));
const TIME = '2026-09-25T00:00:00.000Z';

const scriptBundle = join(dir, 'script.mjs');
await build({
  entryPoints: [resolve(ROOT, 'src/core/script/index.ts')],
  outfile: scriptBundle,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  logLevel: 'error',
});
const { evaluate, formatDiagnostic, renderBook, renderSketch } = await import(pathToFileURL(scriptBundle).href);

/** A script's book, written where the app can open it. */
function bookOf(name, text) {
  const result = evaluate(text, { name, timestamp: TIME });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'));
  const path = join(dir, `${name}.skbk`);
  writeFileSync(path, renderBook(result.book, { format: 'skbk' }));
  return { path, result };
}

/** How many canvas pixels are within `tolerance` of a color, and where their middle is, in client pixels. */
const pixelsOf = (r, g, b, tolerance = 3) => `
  const cv = document.getElementById('canvas');
  const rect = cv.getBoundingClientRect();
  const k = cv.width / rect.width;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (Math.abs(d[i] - ${r}) > ${tolerance} || Math.abs(d[i + 1] - ${g}) > ${tolerance} || Math.abs(d[i + 2] - ${b}) > ${tolerance}) continue;
      n++;
      sx += rect.left + x / k;
      sy += rect.top + y / k;
    }
  }
  return n ? { n, x: sx / n, y: sy / n } : { n };
`;

/** How many canvas pixels are a gray strictly between paper white and ink black. */
const SOFT = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i];
    if (Math.abs(d[i + 1] - v) < 4 && Math.abs(d[i + 2] - v) < 4 && v > 30 && v < 225) n++;
  }
  return n;
`;

const SHADOW_SCRIPT = `napkin 1
page 1280 800
background #ffffff
layer "Shadowed"
color #1f2328 width 2 fill #ffe08a
effect drop-shadow 40 40 0 #326478
rect 200 150 200 200
effect grayscale
layer "Gray"
color #00ff00 fill #00ff00
rect 600 150 150 150
effect drop-shadow 0 80 0 #00000080
group "Pair" {
  layer "Left"
  color #ff8a65 fill #ff8a65
  rect 200 480 160 60
  layer "Right"
  color #c0392b fill #c0392b
  rect 300 480 160 60
}
`;

// ---- One: a script's effects, painted -------------------------------------------------

const shadows = bookOf('effects', SHADOW_SCRIPT);
let app = launch({ mode: 'book', filePath: shadows.path });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const card = await page.evalIn(pixelsOf(255, 224, 138));
  const shadow = await page.evalIn(pixelsOf(0x32, 0x64, 0x78));
  c.ok("a mark's drop shadow is painted, in its color", shadow.n > 1000, `${shadow.n} pixels of the shadow's color`);
  c.ok('down and to the right of the mark', shadow.n > 0 && card.n > 0 && shadow.x > card.x && shadow.y > card.y, JSON.stringify({ card, shadow }));

  const green = await page.evalIn(pixelsOf(0, 255, 0));
  const gray = await page.evalIn(pixelsOf(182, 182, 182, 4));
  c.ok("a layer's grayscale turns its green to the gray of green", gray.n > 1000 && green.n < 50, `${gray.n} gray, ${green.n} green`);

  const one = await page.evalIn(pixelsOf(128, 128, 128, 4));
  const two = await page.evalIn(pixelsOf(64, 64, 64, 6));
  c.ok("a group's shadow is one picture: no darker where its children's shadows overlap", one.n > 1000 && two.n < 50, `${one.n} half-dark, ${two.n} doubled`);
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}

// ---- Two: a blur -------------------------------------------------------------------------

const blurred = bookOf('blurred', 'napkin 1\npage 1280 800\nbackground #ffffff\nlayer "Soft"\ncolor #000000 fill #000000\neffect blur 8\nrect 500 250 200 200\n');
const plain = bookOf('plain', 'napkin 1\npage 1280 800\nbackground #ffffff\nlayer "Sharp"\ncolor #000000 fill #000000\nrect 500 250 200 200\n');
let soft = 0;
let sharp = 0;
for (const [book, keep] of [
  [blurred, (n) => (soft = n)],
  [plain, (n) => (sharp = n)],
]) {
  app = launch({ mode: 'book', filePath: book.path });
  try {
    const page = await connect();
    await page.send('Runtime.enable');
    await sleep(3500);
    keep(await page.evalIn(SOFT));
  } catch (err) {
    console.error('check failed:', err);
    process.exitCode = 1;
  } finally {
    await stop(app);
  }
}
// Both pages have the same outline and the same edges; the halo is what the blur adds to them.
c.ok('a blurred square has a soft halo that a plain one has not', soft - sharp > 10000, `${soft} soft pixels against ${sharp}`);

// ---- Three: napkin's own SVG, read back with its effects ---------------------------------------

const svgPath = join(dir, 'effects.svg');
writeFileSync(svgPath, renderSketch(shadows.result.book.sketches[0], { format: 'svg' }));
const blank = bookOf('blank', 'napkin 1\npage 1280 800\nbackground #ffffff\nname "blank"\n');
app = launch({ mode: 'book', filePath: blank.path, importFiles: [svgPath] });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  const shadow = await page.evalIn(pixelsOf(0x32, 0x64, 0x78));
  c.ok("an imported napkin SVG keeps a mark's effects: the shadow is painted again", shadow.n > 1000, `${shadow.n} pixels of the shadow's color`);
  const green = await page.evalIn(pixelsOf(0, 255, 0));
  const gray = await page.evalIn(pixelsOf(182, 182, 182, 4));
  c.ok("and a layer's: the green is gray again", gray.n > 1000 && green.n < 50, `${gray.n} gray, ${green.n} green`);
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}

// ---- Four: a composition painted into a canvas through ctx.filter ------------------------------

const painterEntry = join(dir, 'painter.ts');
writeFileSync(
  painterEntry,
  `import { createComposition } from ${JSON.stringify(resolve(ROOT, 'src/core/graphic-design/compose.ts').replace(/\\/g, '/'))};
import { paintComposition } from ${JSON.stringify(resolve(ROOT, 'src/core/graphic-design/canvas.ts').replace(/\\/g, '/'))};

export function run() {
  const design = createComposition({ width: 240, height: 160, background: '#ffffff' });
  design.group({ effects: [{ type: 'drop-shadow', dx: 0, dy: 40, blur: 0, color: '#00000080' }] }, (g) => {
    g.rect({ x: 20, y: 20, width: 60, height: 30, fill: '#ff8a65' });
    g.rect({ x: 50, y: 20, width: 60, height: 30, fill: '#c0392b' });
  });
  design.rect({ x: 140, y: 20, width: 60, height: 60, fill: '#00ff00', effects: [{ type: 'grayscale', amount: 1 }] });
  design.rect({ x: 150, y: 100, width: 40, height: 40, fill: '#000000', effects: [{ type: 'blur', radius: 4 }] });
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  paintComposition(ctx, design.toDocument());
  const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  return { overlap: at(65, 75), single: at(30, 75), gray: at(170, 50), edge: at(150, 120), middle: at(170, 120) };
}
`,
);
const painterBundle = join(dir, 'painter.js');
await build({ entryPoints: [painterEntry], outfile: painterBundle, bundle: true, platform: 'browser', format: 'iife', globalName: 'napkinPainter', logLevel: 'error' });
app = launch({ mode: 'new', sketchName: 'painter' });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3000);
  const seen = await page.evalIn(`${readFileSync(painterBundle, 'utf8')}\nreturn napkinPainter.run();`);
  c.ok('the canvas painter draws a group with effects as one picture', Math.abs(seen.overlap[0] - seen.single[0]) <= 2 && Math.abs(seen.single[0] - 128) <= 3, JSON.stringify(seen));
  c.ok("and an element's grayscale", Math.abs(seen.gray[0] - 182) <= 2 && Math.abs(seen.gray[1] - 182) <= 2, JSON.stringify(seen.gray));
  c.ok('and its blur, soft at the edge and solid in the middle', seen.edge[0] > 40 && seen.edge[0] < 215 && seen.middle[0] < 10, JSON.stringify({ edge: seen.edge, middle: seen.middle }));
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

if (!c.summary()) process.exitCode = 1;
