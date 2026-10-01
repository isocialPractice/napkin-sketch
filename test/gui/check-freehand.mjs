/**
 * Freehand strokes as a few Bézier anchors, painted as one flat mark.
 *
 * Before 1.0.0-alpha.4.6.0 a pen stroke kept a sample every three quarters of
 * a pixel - 150 to 400 points across the page, each of them an anchor Direct
 * Select showed - and Sharpen rebuilt a stroke with ten points for every one
 * it kept. And a plain stroke was painted segment by segment, each with its
 * own round ends at the stroke's opacity, so where two segments met their
 * ends overlapped and darkened: a translucent line read as a string of beads.
 *
 * Three sequences, each in an app of its own: a smooth curve drawn with 200
 * pointer moves commits a dozen anchors or fewer; the same at 40% opacity is
 * one flat tone along its middle; and Sharpen All leaves a stroke a few
 * anchors too.
 */
import { launch, connect, sleep, checker, stop } from './cdp.mjs';

const c = checker();

async function sequence(name, run) {
  const app = launch({ mode: 'new', sketchName: `freehand-${name.replace(/\W+/g, '-')}` });
  try {
    const page = await connect();
    await page.send('Runtime.enable');
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await sleep(3500);
    await page.evalIn(`
      window.__errors = [];
      window.addEventListener('error', (ev) => window.__errors.push(String(ev.message)));
      window.addEventListener('unhandledrejection', (ev) => window.__errors.push(String(ev.reason?.message ?? ev.reason)));
      document.activeElement?.blur();
      return true;`);
    const rect = await page.evalIn(`const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);
    const io = {
      rect,
      at: (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }),
      marks: () => page.evalIn('return window.napkinCheck.strokeSummary();'),
      eval: (code) => page.evalIn(code),
      async tool(id) {
        await page.evalIn(`document.getElementById(${JSON.stringify(id)}).click(); return true;`);
        await sleep(150);
      },
      async key(code, key) {
        await page.chord(code, key);
        await sleep(120);
      },
      /** A press, `path` walked in `steps` moves, and the release: a stroke a hand drew. */
      async draw(path, steps) {
        const p0 = path(0);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const p = path(i / steps);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(6);
        }
        const p1 = path(1);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p1.x, y: p1.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(400);
        const marks = await this.marks();
        return marks[marks.length - 1] ?? null;
      },
    };
    await run(io, page);
    const errors = await page.evalIn('return window.__errors;');
    c.ok(`${name}: the page threw nothing`, errors.length === 0, errors.join(' | '));
  } catch (error) {
    c.ok(`${name}: the sequence ran`, false, String(error?.stack ?? error));
  } finally {
    await stop(app);
  }
}

/** An S curve across the middle of the canvas, 600 pixels wide. */
const sCurve = (io) => (s) => ({ x: io.rect.x + io.rect.w * 0.2 + 600 * s, y: io.rect.y + io.rect.h * 0.5 + 80 * Math.sin(s * Math.PI * 2) });

await sequence('A drawn curve is a few anchors', async (io) => {
  const name = 'A drawn curve is a few anchors';
  await io.tool('tool-pen');
  const mark = await io.draw(sCurve(io), 200);
  c.ok(`${name}: the pen stroke is drawn`, mark !== null && mark.tool === 'pen', JSON.stringify(mark));
  if (!mark) return;
  c.ok(`${name}: 200 moves commit a dozen anchors or fewer`, mark.anchors !== null && mark.anchors <= 12, `${mark.anchors} anchors, ${mark.points} points`);
  // The curve is where it was drawn: 600 across and 160 high, give or take the fit's pixel and a half.
  const b = mark.bounds;
  c.ok(`${name}: and the curve is where it was drawn`, Math.abs(b.maxX - b.minX - 600) < 3 && Math.abs(b.maxY - b.minY - 160) < 3, JSON.stringify(b));
});

await sequence('Translucent ink is flat', async (io) => {
  const name = 'Translucent ink is flat';
  await io.tool('tool-pen');
  // Quick Width 6, Quick Opacity 40.
  await io.key(87, 'w');
  await io.key(54, '6');
  await sleep(1300);
  await io.key(81, 'q');
  await io.key(52, '4');
  await io.key(48, '0');
  await sleep(1300);
  // A gentle arc a hand drew fast: a sample every six pixels, where a slow
  // hand leaves one every pixel, so the old painter's beads were far apart.
  const y = io.rect.y + io.rect.h * 0.5;
  const x0 = io.rect.x + io.rect.w * 0.2;
  const arcY = (s) => y + 40 * Math.sin(Math.PI * s);
  const mark = await io.draw((s) => ({ x: x0 + 600 * s, y: arcY(s) }), 100);
  c.ok(`${name}: the arc is drawn at 40%, as a curve`, mark !== null && Math.abs((mark.opacity ?? 0) - 0.4) < 1e-6 && (mark.anchors ?? 0) >= 2, JSON.stringify(mark));
  // Across the arc, clear of its ends: in each column the darkest pixel near
  // the arc, which is the ink's own tone wherever the band covers a pixel
  // whole; and the paper beside it.
  const tones = await io.eval(`
    const cv = document.getElementById('canvas');
    const r = cv.getBoundingClientRect();
    const k = cv.width / r.width;
    const ctx = cv.getContext('2d');
    const from = Math.round((${x0 + 30} - r.left) * k);
    const to = Math.round((${x0 + 570} - r.left) * k);
    const out = [];
    for (let x = from; x < to; x++) {
      const s = ((x / k + r.left) - ${x0}) / 600;
      const cy = Math.round((${y} + 40 * Math.sin(Math.PI * s) - r.top) * k);
      const d = ctx.getImageData(x, cy - 6, 1, 13).data;
      let darkest = 255;
      for (let i = 0; i < d.length; i += 4) darkest = Math.min(darkest, d[i]);
      out.push(darkest);
    }
    const paper = ctx.getImageData(from, Math.round((${y - 60} - r.top) * k), 1, 1).data[0];
    return { paper, tones: out };`);
  const sorted = [...tones.tones].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.floor(q * (sorted.length - 1))];
  const median = pick(0.5);
  const contrast = tones.paper - median;
  // The ink's own opacity along the line, from the paper and the ink's tone at 40%: 2% of it either way.
  const spread = contrast > 0 ? ((pick(0.9) - pick(0.1)) / contrast) * 0.4 : Infinity;
  c.ok(`${name}: along its middle the ink is one tone, within 2% opacity`, spread < 0.02, `${(spread * 100).toFixed(1)}% across ${sorted.length} pixels, ${pick(0.1)} to ${pick(0.9)} on paper ${tones.paper}`);
});

await sequence('Sharpen All leaves a few anchors', async (io) => {
  const name = 'Sharpen All leaves a few anchors';
  await io.tool('tool-pen');
  await io.draw(sCurve(io), 200);
  await io.key(72, 'h');
  await sleep(600);
  const marks = await io.marks();
  const mark = marks[marks.length - 1];
  c.ok(`${name}: the stroke is sharpened into a dozen anchors or so`, !!mark && mark.anchors !== null && mark.anchors <= 16, JSON.stringify(mark && { anchors: mark.anchors, points: mark.points }));
  c.ok(`${name}: and not ten points for every one it kept`, !!mark && mark.points <= 25 * (mark.anchors ?? 1), JSON.stringify(mark && { anchors: mark.anchors, points: mark.points }));
});

process.exit(c.summary() ? 0 : 1);
