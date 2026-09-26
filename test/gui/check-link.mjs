/**
 * A linked graphic in the app: one layer row, drawn as its placeholder, moved
 * like any placed image, and still a link after a save.
 *
 * Two runs. The first opens a book whose one layer holds a linked file - the
 * shape a script's `link` writes - and checks that the Layers panel shows that
 * one row, that the placeholder is on the canvas, that dragging it with the
 * Select tool moves it, and that Save writes it back still linked, at its new
 * place. The second imports an SVG that places a file by reference. The
 * importer used to skip any image that was not a data URL, so ink on the
 * canvas is the proof that it now reads one as a link.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();
const dir = mkdtempSync(join(tmpdir(), 'napkin-link-check-'));
const bookPath = join(dir, 'linked.skbk');
const TIME = '2026-09-25T00:00:00.000Z';

/** A placeholder like the one the app draws for a link: a dashed box with the file's name. */
const placeholder = (name, w, h) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#f6f8fa" stroke="#6e7781" stroke-width="2" stroke-dasharray="6 4"/>` +
      `<text x="${w / 2}" y="${h / 2 + 6}" font-family="sans-serif" font-size="18" fill="#57606a" text-anchor="middle">${name}</text></svg>`,
  )}`;

writeFileSync(
  bookPath,
  JSON.stringify(
    {
      format: 'napkin-sketch',
      version: 3,
      name: 'linked',
      createdAt: TIME,
      updatedAt: TIME,
      sketches: [
        {
          id: 'sk_link',
          name: 'linked',
          width: 1280,
          height: 800,
          sizeMode: 'sized',
          background: '#fcfaf5',
          createdAt: TIME,
          updatedAt: TIME,
          layers: [{ id: 'ly_logo', name: 'Logo', opacity: 1, visible: true, locked: false }],
          strokes: [
            {
              id: 'st_logo',
              tool: 'image',
              color: '#1f2328',
              width: 1,
              points: [{ x: 420, y: 260, pressure: 0.5 }],
              image: placeholder('logo.svg', 240, 140),
              imageWidth: 240,
              imageHeight: 140,
              link: { href: 'assets/logo.svg', kind: 'svg' },
              layer: 'ly_logo',
              sharpened: true,
            },
          ],
        },
      ],
    },
    null,
    2,
  ),
);

/**
 * The placeholder on the canvas, in client pixels: how much of its dashed
 * border's grey there is, and where its middle is. The grey is the
 * placeholder's own, which the page's dashed edge, the paper and the blue
 * selection outline all miss.
 */
const INK = `
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const k = cv.width / r.width;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (Math.abs(d[i] - 110) > 12 || Math.abs(d[i + 1] - 119) > 12 || Math.abs(d[i + 2] - 129) > 12) continue;
      n++;
      sx += r.left + x / k;
      sy += r.top + y / k;
    }
  }
  return n ? { n, x: sx / n, y: sy / n } : { n };
`;

const ROWS = `return [...document.querySelectorAll('#layers-list .layer-row')].map((row) => row.querySelector('.layer-name')?.textContent?.trim() ?? '');`;

const mouse = (page, type, p, buttons = 0) =>
  page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1 });

async function drag(page, from, to, steps = 16) {
  await mouse(page, 'mouseMoved', from);
  await mouse(page, 'mousePressed', from, 1);
  for (let i = 1; i <= steps; i++) {
    await mouse(page, 'mouseMoved', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, 1);
  }
  await mouse(page, 'mouseReleased', to, 0);
}

let app = launch({ mode: 'book', filePath: bookPath });
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const names = await page.evalIn(ROWS);
  c.ok('a linked file is one layer row', names.length === 1 && names[0] === 'Logo', JSON.stringify(names));
  const before = await page.evalIn(INK);
  c.ok('drawn as its placeholder', before.n > 200, `${before.n} pixels of its dashed border`);

  await page.evalIn(`document.getElementById('tool-select').click(); document.activeElement?.blur(); return true;`);
  const from = { x: before.x, y: before.y };
  await drag(page, from, { x: from.x + 80, y: from.y + 50 });
  await sleep(500);
  const after = await page.evalIn(INK);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  c.ok('the Select tool moves it with the pointer', after.n > 200 && Math.abs(dx - 80) < 6 && Math.abs(dy - 50) < 6, `moved ${dx.toFixed(1)}, ${dy.toFixed(1)}`);

  await page.evalIn(`document.getElementById('save').click(); return true;`);
  await sleep(1500);
  const saved = JSON.parse(readFileSync(bookPath, 'utf8')).sketches[0].strokes[0];
  c.ok('Save writes it back still a link', saved?.link?.href === 'assets/logo.svg' && saved.link.kind === 'svg', JSON.stringify(saved?.link));
  c.ok('at the place it was moved to', saved.points[0].x > 420 && saved.points[0].y > 260, JSON.stringify(saved.points[0]));
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
}

app = launch({
  mode: 'new',
  sketchName: 'linked-import',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'linked-logo.svg')],
});
try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const names = await page.evalIn(ROWS);
  c.ok('an SVG that places a file by reference imports with its layer', names.includes('Logo'), JSON.stringify(names));
  const ink = await page.evalIn(INK);
  c.ok('and the file comes in as a link, drawn as its placeholder', ink.n > 200, `${ink.n} pixels of its dashed border`);
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  await stop(app);
  rmSync(dir, { recursive: true, force: true });
}

if (!c.summary()) process.exitCode = 1;
