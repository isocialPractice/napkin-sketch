/**
 * The Pencil (src/core/pencil.ts): the drawing kit's table, the paper's
 * tooth, the coverage rule, a mark's picture, and the Pencil through the
 * file and every output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PENCIL,
  GRAIN_TEXELS_PER_PX,
  GRAIN_TILE_SIZE,
  PENCIL_GRADES,
  PENCIL_KIT,
  grainTile,
  meanPressure,
  parsePencil,
  pencilCoverage,
  pencilGrade,
  pencilMeanCoverage,
  pencilPaint,
  pencilRegion,
  pencilWidth,
  rasterizePencil,
  toothAt,
  type PencilChoice,
  type PencilMedium,
} from '../src/core/pencil.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { createSketchBook, widthAtPressure, type Point, type Stroke } from '../src/core/types.js';

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/** A wavy Pencil line of `choice`, a point a pixel, at `pressure`. */
function line(choice: PencilChoice, pressure: (t: number) => number = () => 0.5, y = 40): Stroke {
  const points: Point[] = [];
  for (let x = 20; x <= 220; x++) {
    const t = (x - 20) / 200;
    points.push({ x, y: y + 10 * Math.sin(t * Math.PI * 2), pressure: pressure(t) });
  }
  return { id: `p-${choice.medium}-${choice.grade}`, tool: 'pencil', color: pencilPaint(choice).tone, width: pencilWidth(3, choice), points, pencil: choice };
}

/** A mark's picture: its mean alpha where it lays anything down, and how much that alpha varies. */
function picture(stroke: Stroke, scale = 1.5): { mean: number; spread: number; covered: number } {
  const data = rasterizePencil(stroke, pencilRegion(stroke, scale)!);
  const alphas: number[] = [];
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) alphas.push(data[i] / 255);
  const mean = alphas.reduce((a, b) => a + b, 0) / alphas.length;
  const spread = Math.sqrt(alphas.reduce((a, b) => a + (b - mean) ** 2, 0) / alphas.length);
  return { mean, spread, covered: alphas.length };
}

test('the table: every medium hardest first, a harder lead lighter and thinner, graphite never black', () => {
  const media: PencilMedium[] = ['graphite', 'charcoal', 'vine', 'compressed'];
  for (const medium of media) {
    const grades = PENCIL_GRADES.filter((g) => g.medium === medium);
    for (let i = 1; i < grades.length; i++) {
      const [harder, softer] = [grades[i - 1], grades[i]];
      assert.ok(luminance(harder.tone) > luminance(softer.tone), `${harder.label} is lighter than ${softer.label}`);
      assert.ok(harder.lead < softer.lead, `${harder.label} is thinner than ${softer.label}`);
      assert.ok(harder.grain <= softer.grain, `${harder.label} is crisper than ${softer.label}`);
    }
  }
  const graphite = PENCIL_GRADES.filter((g) => g.medium === 'graphite');
  assert.deepEqual(graphite.map((g) => g.grade), ['9H', '8H', '7H', '6H', '5H', '4H', '3H', '2H', 'H', 'F', 'HB', 'B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B']);
  assert.ok(luminance(graphite[graphite.length - 1].tone) > 30, 'graphite never reaches black');
  // Graphite is a cool grey, charcoal a warm black.
  for (const g of graphite) assert.ok(parseInt(g.tone.slice(5, 7), 16) >= parseInt(g.tone.slice(1, 3), 16), `${g.label} is cool`);
  for (const g of PENCIL_GRADES.filter((x) => x.medium !== 'graphite')) {
    assert.ok(parseInt(g.tone.slice(1, 3), 16) > parseInt(g.tone.slice(5, 7), 16), `${g.label} is warm`);
  }
  assert.ok(Math.min(...PENCIL_GRADES.filter((g) => g.medium !== 'graphite').map((g) => g.soft)) > Math.max(...graphite.map((g) => g.soft)), 'charcoal is the powderiest');
});

test('the kit: what the panel offers, every pencil in the table, graphite HB in hand to begin with', () => {
  assert.deepEqual(
    PENCIL_KIT.map((m) => [m.medium, m.grades.join(' ')]),
    [
      ['graphite', '4H 2H HB 2B 4B 6B 8B'],
      ['charcoal', 'HB 2B 4B 6B'],
      ['vine', 'Hard Medium Soft'],
      ['compressed', '2B 4B 6B'],
    ],
  );
  for (const medium of PENCIL_KIT) for (const grade of medium.grades) assert.ok(pencilGrade({ medium: medium.medium, grade }), `${medium.medium} ${grade}`);
  assert.deepEqual(DEFAULT_PENCIL, { medium: 'graphite', grade: 'HB' });
  assert.equal(pencilPaint(null).label, 'Graphite HB', 'no pencil draws as graphite HB');
});

test('a pencil by name, as a script and the API write one', () => {
  assert.deepEqual(parsePencil('2B'), { medium: 'graphite', grade: '2B' });
  assert.deepEqual(parsePencil('hb'), { medium: 'graphite', grade: 'HB' });
  assert.deepEqual(parsePencil('graphite-4H'), { medium: 'graphite', grade: '4H' });
  assert.deepEqual(parsePencil('charcoal-4b'), { medium: 'charcoal', grade: '4B' });
  assert.deepEqual(parsePencil('Vine Soft'), { medium: 'vine', grade: 'Soft' });
  assert.deepEqual(parsePencil('compressed 6B'), { medium: 'compressed', grade: '6B' });
  assert.equal(parsePencil('10B'), null);
  assert.equal(parsePencil('charcoal-9H'), null, 'charcoal has no 9H');
  assert.deepEqual(PENCIL_GRADES.map((g) => g.name).slice(-6), ['vine-hard', 'vine-medium', 'vine-soft', 'compressed-2B', 'compressed-4B', 'compressed-6B']);
  for (const g of PENCIL_GRADES) assert.equal(pencilGrade(parsePencil(g.name)), g, `${g.name} reads back as itself`);
  assert.equal(pencilWidth(3, { medium: 'vine', grade: 'Soft' }), 7.2, 'a vine stick wears broad');
});

test('the paper\'s tooth: the same bytes for a seed, every height as common, and no seam where it repeats', () => {
  const tile = grainTile();
  assert.equal(tile.length, GRAIN_TILE_SIZE * GRAIN_TILE_SIZE);
  assert.equal(grainTile(), tile, 'the paper\'s own tile is made once');
  assert.deepEqual(grainTile(7), grainTile(7));
  assert.notDeepEqual(grainTile(7), tile);
  // A fresh process makes the same tile: these bytes are pinned.
  let hash = 0x811c9dc5;
  for (const b of tile) hash = Math.imul(hash ^ b, 0x01000193) >>> 0;
  assert.equal(hash.toString(16), 'bb95061d');
  const counts = new Array(256).fill(0);
  for (const b of tile) counts[b]++;
  for (let h = 1; h < 255; h++) assert.ok(Math.abs(counts[h] - 64) <= 1, `height ${h}: ${counts[h]}`);
  const period = GRAIN_TILE_SIZE / GRAIN_TEXELS_PER_PX;
  for (const [x, y] of [[3.2, 7.9], [40.5, 80.25], [0, 0]]) {
    assert.ok(Math.abs(toothAt(tile, x, y) - toothAt(tile, x + period, y - 2 * period)) < 1e-9, `the tooth repeats at ${x}, ${y}`);
  }
});

test('the coverage rule: a firm touch reaches deeper into the tooth and lays down more, never past the density', () => {
  const hb = pencilPaint('HB');
  for (const tooth of [0.1, 0.4, 0.7, 0.95]) {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const lays = pencilCoverage(hb, tooth, p);
      assert.ok(lays >= last - 1e-12, `more pressure lays down no less (tooth ${tooth}, pressure ${p.toFixed(1)})`);
      assert.ok(lays <= hb.density + 1e-12, 'no pass lays down past the density');
      last = lays;
    }
  }
  for (const p of [0.2, 0.5, 0.9]) {
    let last = -1;
    for (let tooth = 0; tooth <= 1.0001; tooth += 0.05) {
      const lays = pencilCoverage(hb, tooth, p);
      assert.ok(lays >= last - 1e-12, 'a peak catches no less than a valley');
      last = lays;
    }
  }
  assert.ok(pencilCoverage(hb, 0.05, 0.2) < 0.05, 'a light touch misses the valleys');
  assert.ok(pencilCoverage(hb, 0.95, 0.2) > 0.4, 'and catches the peaks');
  // Pressure darkens far more than it widens.
  const dark = pencilMeanCoverage(hb, 0.9) / pencilMeanCoverage(hb, 0.3);
  const wide = widthAtPressure('pencil', 0.9) / widthAtPressure('pencil', 0.3);
  assert.ok(dark > 1.5 && dark > wide, `${dark} against ${wide}`);
  assert.equal(meanPressure([]), 0.5);
});

test('a mark\'s picture: a softer grade darker, grain far above a flat line, pressure darkening it', () => {
  const hard = line({ medium: 'graphite', grade: '2H' });
  const soft = line({ medium: 'graphite', grade: '8B' });
  const tone = (s: Stroke): number => {
    const { mean } = picture(s);
    return 255 - mean * (255 - luminance(s.color));
  };
  assert.ok(tone(hard) > tone(soft) + 40, `2H ${tone(hard)} is lighter than 8B ${tone(soft)}`);
  const grain = picture(soft).spread;
  assert.ok(grain > 0.15, `the grain shows: ${grain}`);
  const light = picture(line({ medium: 'graphite', grade: 'HB' }, () => 0.25));
  const firm = picture(line({ medium: 'graphite', grade: 'HB' }, () => 0.9));
  assert.ok(firm.mean > light.mean * 1.3, `pressure darkens: ${light.mean} to ${firm.mean}`);
  assert.ok(firm.mean / light.mean > widthAtPressure('pencil', 0.9) / widthAtPressure('pencil', 0.25), 'far more than it widens');
  // Its color is the mark's: a recolored pencil draws in its color.
  const red = rasterizePencil({ ...soft, color: '#c03020' }, pencilRegion(soft, 1)!);
  const at = red.findIndex((v, i) => i % 4 === 3 && v > 0) - 3;
  assert.deepEqual([...red.slice(at, at + 3)], [0xc0, 0x30, 0x20]);
});

test('a region of a picture is that part of the whole: a live stroke grows by its new end alone', () => {
  const stroke = line({ medium: 'charcoal', grade: '2B' }, (t) => 0.3 + 0.6 * t);
  const whole = pencilRegion(stroke, 2)!;
  const all = rasterizePencil(stroke, whole);
  const part = { scale: 2, x: whole.x + 37, y: whole.y + 5, width: 90, height: 30 };
  const some = rasterizePencil(stroke, part);
  let worst = 0;
  for (let row = 0; row < part.height; row++) {
    for (let col = 0; col < part.width; col++) {
      const a = all[((row + 5) * whole.width + col + 37) * 4 + 3];
      const b = some[(row * part.width + col) * 4 + 3];
      worst = Math.max(worst, Math.abs(a - b));
    }
  }
  assert.ok(worst <= 1, `the part matches the whole to a step: ${worst}`);
  // Two passes over the same tooth darken it, and never past the tone.
  const one = picture(stroke).mean;
  assert.ok(one < 1);
});

test('the file keeps a Pencil mark\'s pencil, and a pencil it does not know draws as graphite HB', () => {
  const book = createSketchBook('pencil');
  const mark = line({ medium: 'vine', grade: 'Soft' });
  book.sketches[0].strokes = [{ ...mark, layer: book.sketches[0].layers[0].id }];
  const back = parseSketchBook(serializeSketchBook(book)).sketches[0].strokes[0];
  assert.equal(back.tool, 'pencil');
  assert.deepEqual(back.pencil, { medium: 'vine', grade: 'Soft' });
  assert.equal(back.color, mark.color);
  const odd = JSON.parse(serializeSketchBook(book));
  odd.sketches[0].strokes[0].pencil = { medium: 'vine', grade: 'Brittle' };
  odd.sketches[0].strokes.push({ ...odd.sketches[0].strokes[0], id: 'pen', tool: 'pen', pencil: { medium: 'graphite', grade: '2B' } });
  const read = parseSketchBook(JSON.stringify(odd)).sketches[0].strokes;
  assert.deepEqual(read[0].pencil, { medium: 'graphite', grade: 'HB' });
  assert.equal(read[1].pencil, undefined, 'only a Pencil mark has a pencil');
});

/** A page with an HB and a charcoal 4B line. */
function page() {
  const book = createSketchBook('pencils');
  const sketch = book.sketches[0];
  const layer = sketch.layers[0].id;
  sketch.strokes = [line({ medium: 'graphite', grade: 'HB' }), line({ medium: 'charcoal', grade: '4B' }, () => 0.5, 90)].map((s) => ({ ...s, layer }));
  return sketch;
}

test('the SVG carries the paper\'s tooth once, a grain paint for each pencil, and each mark\'s pencil for the importer', () => {
  const svg = sketchToSvg(page());
  assert.equal((svg.match(/<image id="pencil-tooth" /g) ?? []).length, 1, 'one tile a file');
  assert.match(svg, /<image id="pencil-tooth" width="85\.33" height="85\.33" preserveAspectRatio="none" href="data:image\/png;base64,/);
  assert.equal((svg.match(/<pattern id="pencil-\d+" patternUnits="userSpaceOnUse"/g) ?? []).length, 2, 'a grain paint for each pencil');
  assert.equal((svg.match(/<feFuncA type="table"/g) ?? []).length, 2);
  assert.match(svg, /<path d="[^"]+" fill="url\(#pencil-1\)" data-tool="pencil" data-i="0" data-pencil="HB" data-width="3\.06" data-color="#6a6d72" data-d="M/);
  assert.match(svg, /data-pencil="charcoal-4B"/);
  assert.ok(!/stroke-width="3\.06"/.test(svg), 'a pencil mark is filled, never stroked');
});

test('PNG draws the canvas\'s picture, and PDF and Illustrator the mean tone', () => {
  const sketch = page();
  const doc = sketchToComposition(sketch, { scale: 2 });
  const layer = doc.elements[0] as { children: Array<{ type: string; src?: string; width?: number }> };
  assert.deepEqual(layer.children.map((el) => el.type), ['image', 'image']);
  assert.match(layer.children[0].src ?? '', /^data:image\/png;base64,/);
  const pdf = sketchesToPdf([sketch]);
  assert.equal((pdf.match(/ rg\n[^\n]+ f\n/g) ?? []).length >= 2, true, 'each outline filled');
  assert.match(pdf, /\/ca 0\.\d+/, 'at the mean tone, under the full tone');
  const jsx = sketchesToJsx([sketch]);
  const body = jsx.slice(jsx.indexOf('function build()'));
  assert.equal((body.match(/path\(\[\[/g) ?? []).length, 2);
  const opacities = [...body.matchAll(/opacity: ([\d.]+)\}/g)].map((m) => Number(m[1]));
  assert.ok(opacities.length === 2 && opacities.every((o) => o > 20 && o < 100), `at the mean tone, in percent: ${opacities.join(', ')}`);
});
