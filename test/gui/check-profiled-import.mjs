/**
 * Stroke Profiles through a round trip: a document napkin's own exporter
 * wrote - a profiled stroke of every kind, each on a layer of its own - comes
 * back in with every profile intact, read through the Properties panel the way
 * a person would read it.
 *
 * The fixture, `profiled-strokes.svg`, holds what the exporter writes for a
 * profile: an outline filled in the ink, with the stroke carried as data. A
 * filled shape is a group of two paths, which has to come back as one mark
 * rather than as a layer of two; the summary line, which names a single
 * selected element's tool and layer, is what says so.
 */
import { resolve } from 'node:path';
import { launch, connect, sleep, checker } from './cdp.mjs';

const c = checker();
const app = launch({
  mode: 'new',
  sketchName: 'profiled-import',
  importFiles: [resolve(import.meta.dirname, '..', 'imports', 'profiled-strokes.svg')],
});

/** Clicks the layer row with this name, which selects its marks, and reads Properties. */
const pick = (name) => `
  const row = [...document.querySelectorAll('#layers-list .layer-row')].find(
    (r) => r.textContent.trim().includes(${JSON.stringify(name)}),
  );
  if (!row) return null;
  row.click();
  await new Promise((done) => setTimeout(done, 200));
  const profile = document.getElementById('prop-stroke-profile');
  return {
    summary: document.getElementById('prop-summary').textContent,
    profile: profile.value,
    disabled: profile.disabled,
    style: document.getElementById('prop-stroke-style').value,
    fill: document.getElementById('prop-fill').value,
  };
`;

try {
  const page = await connect();
  await page.send('Runtime.enable');
  await sleep(3500);
  await page.evalIn(`document.getElementById('properties-toggle').click(); return true;`);
  await sleep(600);

  const rows = await page.evalIn(
    `return [...document.querySelectorAll('#layers-list .layer-row')].map((r) => r.textContent.trim());`,
  );
  c.ok(
    'every mark lands on its own layer, and no group mark is read as a layer',
    !rows.some((name) => /<Group>|^path$|^g$/.test(name)),
    rows.join(' | '),
  );

  const expected = [
    ['Rounded pen', 'pen', 'rounded'],
    ['Tapered marker', 'marker', 'tapered'],
    ['Wave vector path', 'pen', 'wave'],
    ['Filled tapered rectangle', 'pen', 'tapered'],
    ['Dashed rounded line', 'pen', 'rounded'],
    ['Default pen', 'pen', 'uniform'],
  ];
  const reads = {};
  for (const [name, tool, profile] of expected) {
    const read = await page.evalIn(pick(name));
    reads[name] = read;
    c.ok(
      `"${name}" comes back as one ${tool} mark, ${profile}`,
      read !== null && read.summary === `${tool} on "${name}"` && read.profile === profile && !read.disabled,
      JSON.stringify(read),
    );
  }
  c.eq('the filled rectangle keeps its fill under the outline', reads['Filled tapered rectangle']?.fill, '#ffd166');
  c.eq('the dashed line keeps its dash', reads['Dashed rounded line']?.style, 'dashed');

  process.exitCode = c.summary() ? 0 : 1;
} catch (err) {
  console.error('check failed:', err);
  process.exitCode = 1;
} finally {
  app.kill();
}
