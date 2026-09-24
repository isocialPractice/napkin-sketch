/**
 * Gradient-painted artwork has to import as something you can see.
 *
 * The importer used to restore a gradient only from `data-gradient`, which is
 * napkin's own export attribute. A foreign `url(#…)` paint was dropped, so a
 * drawing whose every base shape was gradient-filled came back as an
 * invisible ghost: right geometry, right layer tree, nothing painted. Nothing
 * about the result said why, and no unit test could see it - the importer
 * needs a DOM, and the symptom is pixels.
 *
 * The fixture is three gradient-filled rectangles and nothing else, so ink on
 * the canvas is the whole assertion.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'gradient-import',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'gradient-figure.svg')],
});

/**
 * What is painted on the canvas other than paper: how many samples, how many
 * distinct shades, and how much of their bounding box they fill. The last is
 * the ghost test that does not depend on screen scaling or zoom: filled
 * shapes cover most of their box, while outlines alone - which is what the
 * ghost left behind - cover a thin border of it.
 *
 * The paper's dot texture is not ink. A dot is a pixel or two across, so
 * whether the two-pixel sampling lands on the dots depends on where the canvas
 * happens to sit - a toolbar a row taller moved it onto them, and one dot in
 * each corner stretched the box over the whole page. So a sample counts only
 * when the samples two pixels right and two down are painted as well, which a
 * shape passes and a speck does not.
 */
const INK = `
  const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const painted = (x, y) => {
    if (x >= cv.width || y >= cv.height) return false;
    const i = (y * cv.width + x) * 4;
    if (d[i + 3] < 128) return false;
    return !(d[i] > 235 && d[i + 1] > 230 && d[i + 2] > 215); // paper
  };
  const seen = new Map();
  let n = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < cv.height; y += 2) {
    for (let x = 0; x < cv.width; x += 2) {
      if (!painted(x, y) || !painted(x + 2, y) || !painted(x, y + 2)) continue;
      const i = (y * cv.width + x) * 4;
      n++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const key = [d[i] >> 4, (d[i + 1]) >> 4, d[i + 2] >> 4].join(',');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const box = n > 0 ? ((maxX - minX) / 2 + 1) * ((maxY - minY) / 2 + 1) : 1;
  return { n, shades: seen.size, coverage: Number((n / box).toFixed(3)) };
`;

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  const rows = await page.evalIn(
    `return [...document.querySelectorAll('#layers-list .layer-row')].length;`,
  );
  c.ok('the drawing imported', rows > 0, `${rows} layer rows`);

  const ink = await page.evalIn(INK);
  c.ok(
    'gradient-painted shapes arrive painted, not as an invisible ghost',
    ink.n > 100 && ink.coverage > 0.5,
    `${ink.n} painted samples covering ${Math.round(ink.coverage * 100)}% of their bounds`,
  );

  // Three rectangles filled with one flat colour each would give about three
  // shades. A gradient that survived the trip gives a ramp.
  c.ok(
    'and the gradients are gradients, not one flat colour apiece',
    ink.shades >= 6,
    `${ink.shades} distinct shades`,
  );

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
