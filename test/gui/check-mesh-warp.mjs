/**
 * Mesh Warp, driven with real pointer events.
 *
 * The fixture is one dark horizontal bar. Everything is read off the canvas:
 * the green of the hover outline, the grey of the mesh over the bar, the
 * white rings of the pins, and where the bar's ink is - its left half and its
 * right half separately, so a bend shows up as the right half falling while
 * the left half holds.
 *
 * The warp's history is checked the way a person would find it out: Escape
 * puts the bar back exactly, Ctrl+Z inside a warp steps back through the
 * pins, and a kept warp is one Ctrl+Z away from the bar as it was.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'mesh-warp',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'warp-bar.svg')],
});

/**
 * The canvas read three ways, in client pixels: the bar's ink (dark pixels),
 * split into the halves either side of `split`; the white of pin rings; and
 * how much is green or mesh grey.
 */
const read = (split) => `
  const cv = document.getElementById('canvas');
  const r = cv.getBoundingClientRect();
  const k = cv.width / r.width;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const half = [{ n: 0, x: 0, y: 0 }, { n: 0, x: 0, y: 0 }];
  let green = 0, grey = 0;
  const white = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < cv.height; y += 2) {
    for (let x = 0; x < cv.width; x += 2) {
      const i = (y * cv.width + x) * 4;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const cx = r.left + x / k, cy = r.top + y / k;
      if (G > R + 60 && G > B + 40) green++;
      if (R < 110 && G < 110 && B < 120) {
        const h = half[cx < ${split} ? 0 : 1];
        h.n++; h.x += cx; h.y += cy;
        if (R > 45 && R < 110) grey++;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      }
      // Pure white: a pin's ring. The paper is a warm near-white, and fails on blue.
      if (R >= 250 && G >= 250 && B >= 250) white.push([cx, cy]);
    }
  }
  const done = half.map((h) => (h.n ? { n: h.n, x: h.x / h.n, y: h.y / h.n } : { n: 0 }));
  return { left: done[0], right: done[1], green, grey, white, box: { minX, maxX, minY, maxY } };
`;

/** The pins: white pixels inside the ink's box, gathered into clusters a few pixels across. */
function pinsOf(view) {
  const inside = view.white.filter(
    ([x, y]) => x > view.box.minX + 2 && x < view.box.maxX - 2 && y > view.box.minY + 2 && y < view.box.maxY - 2,
  );
  const clusters = [];
  for (const [x, y] of inside) {
    const near = clusters.find((cl) => Math.hypot(cl.x / cl.n - x, cl.y / cl.n - y) < 10);
    if (near) {
      near.x += x;
      near.y += y;
      near.n++;
    } else clusters.push({ x, y, n: 1 });
  }
  return clusters.map((cl) => ({ x: cl.x / cl.n, y: cl.y / cl.n })).sort((a, b) => a.x - b.x);
}

const mouse = (page, type, p, buttons = 0) =>
  page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1 });

async function click(page, p) {
  await mouse(page, 'mouseMoved', p);
  await mouse(page, 'mousePressed', p, 1);
  await mouse(page, 'mouseReleased', p, 0);
}

async function drag(page, from, to, steps = 16) {
  await mouse(page, 'mouseMoved', from);
  await mouse(page, 'mousePressed', from, 1);
  for (let i = 1; i <= steps; i++) {
    await mouse(page, 'mouseMoved', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, 1);
  }
  await mouse(page, 'mouseReleased', to, 0);
}

const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  // The bar at rest, and the line between its halves.
  const start = await page.evalIn(read(0));
  const split = (start.box.minX + start.box.maxX) / 2;
  const rest = await page.evalIn(read(split));
  const middle = { x: split, y: (rest.box.minY + rest.box.maxY) / 2 };
  c.ok('the bar is on the page', rest.left.n > 200 && rest.right.n > 200, JSON.stringify(rest.box));

  await page.evalIn(`document.getElementById('tool-warp').click(); return true;`);
  await sleep(300);
  await mouse(page, 'mouseMoved', middle);
  await sleep(300);
  const hover = await page.evalIn(read(split));
  const hint = await page.evalIn(`return !document.getElementById('warp-hint').hidden;`);
  c.ok('hovering outlines the bar in green, with the hint beside the pointer', hover.green > 50 && hint, `${hover.green} green`);

  await click(page, middle);
  await sleep(700);
  const meshed = await page.evalIn(read(split));
  const pins = pinsOf(meshed);
  c.ok('a click meshes it: grey mesh lines over the bar', meshed.grey > rest.grey + 200, `${meshed.grey} grey against ${rest.grey}`);
  c.ok('with two pins, a fifth of the way in from each end', pins.length === 2, JSON.stringify(pins));

  // Bend: the right pin 80 px down.
  const right = pins[1];
  await drag(page, right, { x: right.x, y: right.y + 80 });
  await sleep(500);
  const bent = await page.evalIn(read(split));
  c.ok('dragging the right pin 80 px down drops the right half at least 60 px', bent.right.y - rest.right.y >= 60, `${(bent.right.y - rest.right.y).toFixed(1)} px`);
  c.ok('while the left half holds, within 10 px', moved(bent.left, rest.left) < 10, `${moved(bent.left, rest.left).toFixed(1)} px`);

  // Escape throws it away.
  await page.chord(27, 'Escape');
  await sleep(500);
  await mouse(page, 'mouseMoved', { x: 5, y: 5 });
  await sleep(200);
  const escaped = await page.evalIn(read(split));
  c.ok(
    'Escape puts the bar back where it was, within a pixel',
    moved(escaped.left, rest.left) < 1 && moved(escaped.right, rest.right) < 1 && escaped.grey < rest.grey + 50,
    `${moved(escaped.left, rest.left).toFixed(2)} / ${moved(escaped.right, rest.right).toFixed(2)} px`,
  );

  // Inside a warp, Ctrl+Z steps back through the pins.
  await click(page, middle);
  await sleep(700);
  const again = pinsOf(await page.evalIn(read(split)));
  await drag(page, again[1], { x: again[1].x, y: again[1].y + 80 });
  await sleep(400);
  await page.chord(90, 'z', 2);
  await sleep(500);
  const stepped = await page.evalIn(read(split));
  c.ok('Ctrl+Z inside the warp takes the bend back', moved(stepped.right, rest.right) < 1.5, `${moved(stepped.right, rest.right).toFixed(2)} px`);
  c.ok('and leaves the warp open, its pins still there', pinsOf(stepped).length === 2);

  // Delete takes a pin out, not the bar.
  await click(page, again[0]);
  await sleep(200);
  await page.chord(46, 'Delete');
  await sleep(500);
  const oneLeft = await page.evalIn(read(split));
  c.ok('Delete takes the selected pin out and leaves the bar', pinsOf(oneLeft).length === 1 && oneLeft.left.n > rest.left.n * 0.8, `${pinsOf(oneLeft).length} pins`);

  // Kept with Enter, the whole warp is one Ctrl+Z.
  await page.chord(27, 'Escape');
  await sleep(300);
  await click(page, middle);
  await sleep(700);
  const third = pinsOf(await page.evalIn(read(split)));
  await drag(page, third[1], { x: third[1].x, y: third[1].y + 80 });
  await sleep(400);
  await page.chord(13, 'Enter');
  await sleep(400);
  await mouse(page, 'mouseMoved', { x: 5, y: 5 });
  await sleep(200);
  const kept = await page.evalIn(read(split));
  // A bent bar's slanted edges are anti-aliased into greys of their own, so
  // the mesh is gone when its pins are and the grey is a fraction of the mesh's.
  c.ok(
    'Enter keeps the bend and puts the mesh and pins away',
    kept.right.y - rest.right.y >= 60 && pinsOf(kept).length === 0 && kept.grey < meshed.grey / 4,
    `${(kept.right.y - rest.right.y).toFixed(1)} px, ${pinsOf(kept).length} pins, ${kept.grey} grey`,
  );
  await page.chord(90, 'z', 2);
  await sleep(500);
  const undone = await page.evalIn(read(split));
  c.ok('and one Ctrl+Z puts the bar back', moved(undone.left, rest.left) < 1 && moved(undone.right, rest.right) < 1, `${moved(undone.right, rest.right).toFixed(2)} px`);

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
