/**
 * Automate > Generate Script: the scripts the app writes from a media file or
 * from the selected layers, and what the Generated script dialog shows.
 *
 * An imported SVG becomes a page through the same routine the store's import
 * uses, so the two are held to the same layer tree. A PDF's pages, written as
 * a book and run again, draw what they were read as. A picture is placed, not
 * traced: linked by its file name at its own size, or carried in the script.
 * The selected layers are written with the groups above them, on a page kept
 * or fitted to their ink. Around that: the header comment, the line of how big
 * a script is, the image data the dialog shortens, the ids a page opened from
 * a script is given, and the dialog's skeleton in `index.html`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildImportedLayers, importedToSketch, pdfPagesToSketches, withNewIds, type ImportedTreeNode } from '../src/core/imported-sketch.js';
import { importPdf } from '../src/core/pdf-import.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { displayScript, rasterScript, scriptFromPages, statsLine } from '../src/core/script/generate.js';
import { decodePng } from '../src/core/graphic-design/png.js';
import { evaluate, inkBox, renderSketch } from '../src/core/script/index.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { createGroupLayer, createLayer, createSketch, createSketchBook, type Layer, type Sketch, type SketchBook, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';
import { SCRIPT_DIALOG_PARTS } from '../src/renderer/script-dialog.js';
import { fixtureSketch } from './helpers/fixture-sketch.js';
import { repoRoot } from './helpers/repo-root.js';
import { LOGO } from './helpers/script-fixtures.js';
import { walkFigure } from './helpers/walk-figure.js';

const ROOT = repoRoot();
const TIMESTAMP = '2026-09-26T00:00:00.000Z';

function fixture(file: string): Sketch {
  return fixtureSketch(readFileSync(join(ROOT, 'test', 'imports', file), 'utf-8'), file.replace(/\.svg$/, ''));
}

/** A script run clean: the book it draws. */
function run(text: string, label: string): SketchBook {
  const result = evaluate(text, { timestamp: TIMESTAMP });
  assert.deepEqual(result.diagnostics, [], `${label}: the script runs clean`);
  return result.book;
}

function mark(color: string, y = 10): Stroke {
  return {
    id: `st_${color.slice(1)}`,
    tool: 'pen',
    color,
    width: 3,
    points: [
      { x: 10, y },
      { x: 60, y: y + 20 },
      { x: 110, y },
    ],
  };
}

/** The layer rows as the Layers panel names them: name, group or not, the group above, opacity. */
function rows(layers: readonly Layer[]): Array<[string, boolean, string | null, number]> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  return layers.map((layer) => [layer.name, layer.group === true, layer.parent ? (byId.get(layer.parent)?.name ?? '?') : null, layer.opacity]);
}

/** Each mark by its color, with the name of the layer it is on. */
function marksOn(layers: readonly Layer[], strokes: readonly Stroke[]): Array<[string, string]> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  return strokes.map((stroke) => [stroke.color, stroke.layer ? (byId.get(stroke.layer)?.name ?? '?') : '-']);
}

/** Two pages draw the same PNG, pixel for pixel. */
function assertSamePixels(a: Sketch, b: Sketch, label: string): void {
  const one = decodePng(renderSketch(a, { format: 'png' }));
  const two = decodePng(renderSketch(b, { format: 'png' }));
  assert.deepEqual([two.width, two.height], [one.width, one.height], `${label}: the same size`);
  let worst = 0;
  for (let i = 0; i < one.data.length; i++) worst = Math.max(worst, Math.abs(one.data[i] - two.data[i]));
  assert.equal(worst, 0, `${label}: pixels differ by up to ${worst}`);
}

/** Every layer inside `id`, and `id` itself. */
function subtreeOf(sketch: Sketch, id: string): Set<string> {
  const inside = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const layer of sketch.layers) {
      if (layer.parent && inside.has(layer.parent) && !inside.has(layer.id)) {
        inside.add(layer.id);
        grew = true;
      }
    }
  }
  return inside;
}

// ---- A file as a page -------------------------------------------------------------------------

const TREE: ImportedTreeNode[] = [
  {
    name: 'Figure',
    opacity: 0.8,
    strokes: [mark('#aa0000')],
    children: [
      { name: 'Head', opacity: 1, strokes: [mark('#00aa00', 40)] },
      { name: 'Arm', opacity: 0.5, strokes: [mark('#0000aa', 70)] },
    ],
  },
  { name: 'Note', opacity: 1, strokes: [mark('#555555', 100)] },
];

test('an imported SVG as a page has the tree the import adds to a page, built by the same routine', () => {
  const store = new Store(createSketchBook('t'));
  const before = store.sketch.layers.length;
  store.addImportedLayers(TREE);
  const imported = store.sketch.layers.slice(before);
  const page = importedToSketch({ width: 240.4, height: 160, background: '#fdfbf6', layers: TREE }, 'figure');

  assert.deepEqual(rows(page.layers), rows(imported), 'the same rows, in the same order');
  assert.deepEqual(marksOn(page.layers, page.strokes), marksOn(store.sketch.layers, store.sketch.strokes.slice(-4)), 'the same marks on the same layers');
  assert.deepEqual(rows(page.layers), [
    ['Head', false, 'Figure', 1],
    ['Arm', false, 'Figure', 0.5],
    ['Figure contents', false, 'Figure', 1],
    ['Figure', true, null, 0.8],
    ['Note', false, null, 1],
  ]);
  assert.equal(store.activeLayerId, imported[imported.length - 1].id, 'the import leaves the last layer it made active');

  assert.deepEqual([page.width, page.height, page.sizeMode, page.background, page.name], [241, 160, 'sized', '#fdfbf6', 'figure'], 'the size is rounded up, and the paper kept');
  const built = buildImportedLayers(TREE);
  assert.equal(built.layers.find((layer) => layer.id === built.active)?.name, 'Note', 'the routine names the layer an import leaves active');
  assert.ok(new Set(page.strokes.map((stroke) => stroke.id)).size === page.strokes.length, 'every mark has an id of its own');
  assert.ok(page.strokes.every((stroke) => !TREE.some((node) => node.strokes.some((s) => s.id === stroke.id))), 'and a new one');

  const empty = importedToSketch({ width: 10, height: 10, layers: [] }, 'empty');
  assert.deepEqual(empty.layers.map((layer) => layer.name), ['Layer 1'], 'a file with no layers leaves the page its first layer');
});

test('an imported SVG page written as a script draws back as it was', () => {
  // Fixtures with no filled shape left open, which the writer closes and
  // script-writer.test.ts allows for; here the drawing must match outright.
  for (const file of ['gradient-figure.svg', 'width-line.svg', 'color-picker-shapes.svg']) {
    const page = fixture(file);
    const script = scriptFromPages([page], file, { decimals: null });
    assert.ok(script.text.startsWith(`# Written by napkin-sketch from ${file}.\n`), `${file}: the script says where it came from`);
    assert.equal(script.name, page.name);
    assert.equal(script.source, file);
    const back = run(script.text, file).sketches;
    assert.equal(back.length, 1);
    assert.equal(sketchToSvg(back[0]), sketchToSvg(page), `${file}: the same drawing`);
  }
});

test("a PDF's pages are written as a book, and draw back as they were read", () => {
  const first = createSketch('doc');
  first.strokes.push({ ...mark('#123456'), layer: first.layers[0].id });
  first.strokes.push({ id: 't1', tool: 'text', color: '#1f2328', width: 1, layer: first.layers[0].id, points: [{ x: 50, y: 60 }], text: 'hello', fontSize: 24 });
  const second = createSketch('doc');
  second.width = 300;
  second.height = 200;
  second.strokes.push({ ...mark('#654321', 30), layer: second.layers[0].id });

  const read = importPdf(Buffer.from(sketchesToPdf([first, second]), 'latin1'));
  const pages = pdfPagesToSketches(read, 'doc');
  assert.deepEqual(
    pages.map((page) => [page.name, page.width, page.height, page.strokes.length]),
    [
      ['doc-1', first.width, first.height, 2],
      ['doc-2', 300, 200, 1],
    ],
    'a page each, named for the file, the size rounded',
  );
  assert.ok(pages.every((page) => page.strokes.every((stroke) => stroke.layer === page.layers[0].id)), "every mark is on the page's layer");
  assert.equal(pdfPagesToSketches([read[0]], 'one')[0].name, 'one', 'a single page takes the name as it is');

  const script = scriptFromPages(pages, 'doc.pdf', { decimals: null });
  assert.match(script.text, /^# Written by napkin-sketch from doc\.pdf\.$/m);
  assert.match(script.text, /^newpage "doc-2"$/m);
  assert.equal(script.stats.pages, 2);
  const back = run(script.text, 'doc.pdf').sketches;
  assert.equal(back.length, 2);
  back.forEach((page, i) => assert.equal(sketchToSvg(page), sketchToSvg(pages[i]), `page ${i + 1}: the same drawing`));
});

test('a PDF of a whole figure is written and drawn back to the same pixels', () => {
  const read = importPdf(Buffer.from(sketchesToPdf([fixture('walk.svg')]), 'latin1'));
  const pages = pdfPagesToSketches(read, 'walk');
  assert.ok(pages[0].strokes.length > 50, `the figure's marks come through the PDF (${pages[0].strokes.length})`);
  const script = scriptFromPages(pages, 'walk.pdf');
  const back = run(script.text, 'walk.pdf').sketches;
  assert.equal(back.length, 1);
  assert.equal(back[0].strokes.length, pages[0].strokes.length, 'every mark');
  assertSamePixels(pages[0], back[0], 'walk.pdf');
});

test('scriptFromPages needs a page', () => {
  assert.throws(() => scriptFromPages([], 'nothing'), /no page to write/);
});

// ---- A picture ---------------------------------------------------------------------------------

test('a picture is placed at its own size: linked by its file name, or carried in the script', () => {
  const picture = { name: 'logo', fileName: 'logo.png', dataUrl: LOGO };
  const linked = rasterScript(picture, { embed: false });
  assert.match(linked.text, /^# Written by napkin-sketch from logo\.png\.$/m);
  assert.match(linked.text, /^page 40 20$/m, "a page the picture's size");
  assert.match(linked.text, /^link "logo\.png" at 0 0 size 40 20$/m);
  assert.doesNotMatch(linked.text, /data:/, 'a linked picture keeps its data out of the script');
  assert.deepEqual(linked.notes, []);
  assert.deepEqual([linked.name, linked.source], ['logo', 'logo.png']);
  const placed = run(linked.text, 'linked').sketches[0];
  assert.deepEqual([placed.width, placed.height, placed.name], [40, 20, 'logo']);
  assert.equal(placed.strokes.length, 1);
  assert.equal(placed.strokes[0].tool, 'image');
  assert.equal(placed.strokes[0].link?.href, 'logo.png', 'a link to the file');

  const embedded = rasterScript(picture, { embed: true });
  assert.match(embedded.text, /^layer "logo\.png"$/m, 'on a layer named for the file');
  assert.ok(embedded.text.includes(`image "${LOGO}" at 0 0 size 40 20`), 'with its data');
  const carried = run(embedded.text, 'embedded').sketches[0];
  assert.equal(carried.strokes.length, 1);
  assert.equal(carried.strokes[0].image, LOGO);
  assert.equal(carried.strokes[0].link, undefined, 'the picture itself, not a link');
  assert.deepEqual([carried.strokes[0].imageWidth, carried.strokes[0].imageHeight], [40, 20]);
  assert.deepEqual(embedded.stats, { instructions: 6, marks: 1, layers: 1, pages: 1 });
});

test('a picture the app shows only as a placeholder when linked, or whose size is unreadable, says so', () => {
  const webp = rasterScript({ name: 'photo', fileName: 'photo.webp', dataUrl: LOGO }, { embed: false });
  assert.equal(webp.notes.length, 1);
  assert.match(webp.notes[0], /linked WEBP file as a placeholder/);
  assert.match(webp.text, /^# napkin-sketch shows a linked WEBP file as a placeholder/m, 'the note is in the script too');
  assert.deepEqual(rasterScript({ name: 'photo', fileName: 'photo.webp', dataUrl: LOGO }, { embed: true }).notes, [], 'embedded, it draws');

  const unread = rasterScript({ name: 'odd', fileName: 'odd.png', dataUrl: 'data:image/png;base64,AAAA' }, { embed: false });
  assert.match(unread.text, /^link "odd\.png" at 0 0 size 100 100$/m);
  assert.match(unread.notes[0], /placed 100 by 100/);
});

// ---- The selected layers -------------------------------------------------------------------------

test('the selected layers are written with the groups above them, on the page kept or fitted to them', () => {
  const sketch = walkFigure();
  const top = sketch.layers.find((layer) => layer.group && !layer.parent);
  assert.ok(top, 'the figure has a group at the top');
  const assembly = sketch.layers.find((layer) => layer.group && layer.parent === top.id);
  assert.ok(assembly, 'with an assembly in it');
  const inside = subtreeOf(sketch, assembly.id);
  const theirs = sketch.strokes.filter((stroke) => stroke.layer !== undefined && inside.has(stroke.layer));
  assert.ok(theirs.length > 0);
  const page = { ...sketch, name: `${sketch.name}-selection` };

  const kept = scriptFromPages([page], '1 layer', { layers: [assembly.id], page: 'keep', decimals: null });
  assert.match(kept.text, /^# Written by napkin-sketch from 1 layer\.$/m);
  const keptBack = run(kept.text, 'kept').sketches[0];
  assert.deepEqual([keptBack.width, keptBack.height, keptBack.name], [sketch.width, sketch.height, page.name]);
  assert.equal(keptBack.strokes.length, theirs.length, "the assembly's marks, and no others");
  const names = new Set(keptBack.layers.map((layer) => layer.name));
  assert.ok(names.has(top.name) && names.has(assembly.name), 'the group above is kept, so the tree still stands');
  assert.deepEqual(inkBox(keptBack), inkBox({ ...sketch, strokes: theirs }), 'where they were');

  const box = inkBox({ ...sketch, strokes: theirs });
  assert.ok(box);
  const fitted = run(scriptFromPages([page], '1 layer', { layers: [assembly.id], page: 'fit', decimals: null }).text, 'fitted').sketches[0];
  assert.deepEqual([fitted.width, fitted.height], [Math.ceil(box.width), Math.ceil(box.height)], "the page is the selection's size");
  const moved = inkBox(fitted);
  assert.ok(moved);
  assert.ok(Math.abs(moved.x) < 1e-9 && Math.abs(moved.y) < 1e-9, 'and the selection starts at its corner');
  assert.ok(Math.abs(moved.width - box.width) < 1e-9 && Math.abs(moved.height - box.height) < 1e-9, 'the same size as it was');

  // The group at the top chosen: the whole figure, drawn as the page draws it.
  const whole = run(scriptFromPages([page], '1 layer', { layers: [top.id], decimals: null }).text, 'whole').sketches[0];
  assert.equal(whole.strokes.length, sketch.strokes.length, 'every mark of the figure');
  assertSamePixels(sketch, whole, 'the whole figure');
});

// ---- What the dialog shows -------------------------------------------------------------------------

test('the line of how big a script is counts in words', () => {
  assert.equal(statsLine({ instructions: 12, marks: 9, layers: 3, pages: 1 }), '12 instructions, 9 marks, 3 layers');
  assert.equal(statsLine({ instructions: 1, marks: 1, layers: 1, pages: 1 }), '1 instruction, 1 mark, 1 layer');
  assert.equal(statsLine({ instructions: 30, marks: 0, layers: 2, pages: 2 }), '30 instructions, 0 marks, 2 layers, 2 pages');
});

test('long image data is shortened where the script is read, and nothing else changes', () => {
  const head = 'data:image/png;base64,';
  const long = `${head}${'A'.repeat(4000)}`;
  const text = `napkin 1\npage 10 10\nimage "${long}" at 0 0 size 10 10\nimage "${head}${'B'.repeat(100)}" at 0 0\n`;
  const shown = displayScript(text);
  assert.ok(shown.includes(`image "${head}${'A'.repeat(32)}... (2.9 KB of image data)" at 0 0 size 10 10`), shown.slice(0, 200));
  assert.ok(shown.includes(`"${head}${'B'.repeat(100)}"`), 'short data is left whole');
  assert.equal(shown.split('\n').length, text.split('\n').length, 'every line is still there');
  assert.ok(displayScript(`image "${head}${'C'.repeat(1_500_000)}"`).includes('(1.1 MB of image data)'));
  const plain = 'napkin 1\npage 10 10\ncircle 5 5 3\n';
  assert.equal(displayScript(plain), plain);
});

test('a page opened from a script gets ids of its own, with every reference kept', () => {
  const page = createSketch('drawn');
  const group = createGroupLayer('Group');
  const child = createLayer('Child');
  child.parent = group.id;
  page.layers = [child, group];
  page.strokes = [{ ...mark('#123456'), layer: child.id }];
  const renewed = withNewIds(page);
  const oldIds = new Set([page.id, ...page.layers.map((layer) => layer.id), ...page.strokes.map((stroke) => stroke.id)]);
  const newIds = [renewed.id, ...renewed.layers.map((layer) => layer.id), ...renewed.strokes.map((stroke) => stroke.id)];
  assert.ok(newIds.every((id) => !oldIds.has(id)), 'no id is kept');
  assert.equal(new Set(newIds).size, newIds.length, 'none is shared');
  assert.equal(renewed.layers[0].parent, renewed.layers[1].id, 'the child is still in its group');
  assert.equal(renewed.strokes[0].layer, renewed.layers[0].id, 'the mark is still on its layer');
  assert.ok(renewed.layers[1].id.startsWith('gp'), 'a group is still named as a group');
  assert.deepEqual(rows(renewed.layers), rows(page.layers));
  assert.equal(sketchToSvg(renewed), sketchToSvg(page), 'and it draws the same');
});

test("index.html has every part the Generated script dialog looks for, inside #script-dialog", () => {
  const html = readFileSync(resolve(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="script-dialog"');
  assert.ok(start >= 0, 'there is a #script-dialog');
  const block = html.slice(start, html.indexOf('<!--', start));
  for (const part of SCRIPT_DIALOG_PARTS) assert.ok(block.includes(`id="${part}"`), `#script-dialog has #${part}`);
  assert.ok(block.includes('class="export-dialog is-hidden"'), 'the dialog starts hidden, as every dialog does');
  assert.equal((block.match(/name="script-page"/g) ?? []).length, 2, 'the page choice has two answers');
});
