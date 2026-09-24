/**
 * Stroke Profiles, driven through the toolbar control, its picker and the
 * Properties select.
 *
 * A fat straight pen line is drawn with the mouse, and its ink is measured a
 * column at a time: how thick it is a tenth of the way along against how
 * thick it is in the middle. Default is the same all the way; Rounded, being
 * sin(πt), is under a third as thick at a tenth; Tapered is thinner at its end
 * than its start; and Wave starts fine and is fullest just before half way.
 * Those ratios are what each profile is, so they are what is checked, rather
 * than any particular pixel.
 */
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({ mode: 'new', sketchName: 'profiles' });

/**
 * The ink in a band of the canvas, `band` being fractions of its height: its
 * horizontal extent, and how thick it is at fractions of the way across that
 * extent - the thickest of five neighbouring columns, so one column that
 * lands on an anti-aliased edge does not decide it.
 */
const measure = (band) => `
  const cv = document.getElementById('canvas');
  const y0 = Math.floor(${band[0]} * cv.height);
  const rows = Math.ceil(${band[1]} * cv.height) - y0;
  const d = cv.getContext('2d').getImageData(0, y0, cv.width, rows).data;
  const ink = (x, y) => {
    const i = (y * cv.width + x) * 4;
    return d[i + 3] >= 128 && d[i] <= 90 && d[i + 1] <= 90 && d[i + 2] <= 100;
  };
  let minX = Infinity, maxX = -Infinity;
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < cv.width; x++) {
      if (!ink(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (!Number.isFinite(minX)) return { n: 0 };
  const thick = (f) => {
    const at = Math.round(minX + f * (maxX - minX));
    let best = 0;
    for (let x = at - 2; x <= at + 2; x++) {
      let count = 0;
      for (let y = 0; y < rows; y++) if (ink(x, y)) count++;
      best = Math.max(best, count);
    }
    return best;
  };
  return { n: 1, minX, maxX, t05: thick(0.05), t10: thick(0.1), t45: thick(0.45), t50: thick(0.5), t90: thick(0.9) };
`;

const state = `return {
  open: !document.getElementById('profile-dialog').classList.contains('is-hidden'),
  highlighted: document.querySelector('#profile-list [aria-selected="true"]')?.dataset.profile,
  toast: document.getElementById('toast').textContent,
  label: document.getElementById('stroke-profile').getAttribute('aria-label'),
};`;

const click = (id) => `document.getElementById('${id}').click(); return true;`;

/** A straight mouse drag, which the pen draws at the mouse's pressure of 0.5. */
async function drag(page, from, to, steps = 24) {
  const mouse = (type, p, buttons) =>
    page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1 });
  await mouse('mouseMoved', from, 0);
  await mouse('mousePressed', from, 1);
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, 1);
  }
  await mouse('mouseReleased', to, 0);
}

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);

  // A fat pen, on its Default profile.
  await page.evalIn(`
    document.getElementById('tool-pen').click();
    const width = document.getElementById('width');
    width.value = '24';
    width.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  const rect = await page.evalIn(
    `const r = document.getElementById('canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };`,
  );
  const at = (fx, fy) => ({ x: rect.left + fx * rect.width, y: rect.top + fy * rect.height });
  const upper = [0.2, 0.5];
  await drag(page, at(0.25, 0.35), at(0.75, 0.35));
  await sleep(400);
  const drawn = await page.evalIn(measure(upper));
  c.ok('a Default pen line is as thick a tenth of the way along as in its middle', drawn.n && drawn.t10 > 0.85 * drawn.t50, JSON.stringify(drawn));

  // Rounded on the selection, chosen in the picker.
  await page.evalIn(click('tool-select'));
  await page.evalIn(`document.activeElement?.blur(); return true;`);
  await page.chord(65, 'a', 2);
  await sleep(200);
  await page.evalIn(click('stroke-profile'));
  await sleep(300);
  const opened = await page.evalIn(state);
  c.ok('the picker opens with the current profile highlighted', opened.open && opened.highlighted === 'uniform', JSON.stringify(opened));
  await page.evalIn(click('profile-option-rounded'));
  await page.evalIn(click('profile-apply'));
  await sleep(400);
  const chosen = await page.evalIn(state);
  c.ok('Select closes the picker and says what it did', !chosen.open && /Rounded on 1 stroke/.test(chosen.toast), chosen.toast);
  c.ok('the toolbar control names the new profile', chosen.label === 'Stroke profile: Rounded', chosen.label);
  await page.chord(65, 'a', 2 | 8); // Ctrl+Shift+A: select nothing, so no border is measured
  await sleep(300);
  const rounded = await page.evalIn(measure(upper));
  c.ok('Rounded: a tenth of the way along it is under half as thick as in its middle', rounded.t10 < 0.5 * rounded.t50, JSON.stringify(rounded));

  await page.chord(90, 'z', 2);
  await sleep(400);
  const undone = await page.evalIn(measure(upper));
  c.ok('one Ctrl+Z puts the Default line back', undone.t10 > 0.85 * undone.t50, JSON.stringify(undone));

  // The Properties select: one element's profile, not the tool's.
  await page.chord(65, 'a', 2);
  await page.evalIn(click('properties-toggle'));
  await sleep(600);
  const read = await page.evalIn(`return document.getElementById('prop-stroke-profile').value;`);
  c.eq('Properties reads the selected stroke\'s profile', read, 'uniform');
  await page.evalIn(`
    const select = document.getElementById('prop-stroke-profile');
    select.value = 'tapered';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);
  await sleep(300);
  await page.evalIn(click('properties-toggle'));
  await sleep(600);
  await page.chord(65, 'a', 2 | 8);
  await sleep(300);
  const tapered = await page.evalIn(measure(upper));
  c.ok('Tapered from Properties: thinner near its end than near its start', tapered.t90 < 0.7 * tapered.t10, JSON.stringify(tapered));
  c.eq('and the tool keeps the profile it had', (await page.evalIn(state)).label, 'Stroke profile: Rounded');

  // The keyboard, and a new stroke: End highlights Wave, Enter selects it,
  // and the pen draws with it.
  await page.evalIn(click('tool-pen'));
  await page.evalIn(click('stroke-profile'));
  await sleep(300);
  await page.chord(35, 'End');
  await page.chord(13, 'Enter');
  await sleep(300);
  const keyed = await page.evalIn(state);
  c.ok('End then Enter chooses Wave from the keyboard', !keyed.open && keyed.label === 'Stroke profile: Wave', JSON.stringify(keyed));
  c.ok('and, with nothing to apply it to, says new strokes take it', /New pen and marker strokes: Wave/.test(keyed.toast), keyed.toast);
  await drag(page, at(0.25, 0.7), at(0.75, 0.7));
  await sleep(400);
  const wave = await page.evalIn(measure([0.55, 0.9]));
  c.ok('the next pen stroke is Wave: fine at its start, fullest before half way', wave.n && wave.t05 < 0.5 * wave.t45, JSON.stringify(wave));

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
