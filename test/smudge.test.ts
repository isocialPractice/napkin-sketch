/**
 * The Smear (src/core/smudge.ts): a stump's pass over a Pencil mark's
 * picture - the darkness kept, tone carried along the drag, the grain filled
 * in, the same bytes every time and step by step - the pass a drag leaves on
 * each mark it reached, and the passes kept, carried and boxed with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { passOf, smudgeBuffer, smudgeFor, mapSmudges, smearReaches, DEFAULT_SMEAR_STRENGTH } from '../src/core/smudge.js';
import { pencilPicture, pencilRegion, pencilRgb, pencilWidth, pencilPaint, rasterizePencil, type PencilChoice } from '../src/core/pencil.js';
import { strokeBounds } from '../src/core/bounds.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { mapStrokeGeometry } from '../src/core/mesh-warp.js';
import { createSketchBook, type Point, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

const HB: PencilChoice = { medium: 'graphite', grade: 'HB' };

/** A Pencil line, upright, at `x`. */
function upright(x: number, choice: PencilChoice = HB, pressure = 0.6, width = pencilWidth(3, choice)): Stroke {
  const points: Point[] = [];
  for (let y = 20; y <= 220; y += 2) points.push({ x, y, pressure });
  return { id: `l${x}`, tool: 'pencil', color: pencilPaint(choice).tone, width, points, pencil: choice };
}

/** A drag across, left to right, at `y`. */
function across(y: number, x0 = 0, x1 = 300): Point[] {
  const out: Point[] = [];
  for (let x = x0; x <= x1; x += 3) out.push({ x, y, pressure: 0.5 });
  return out;
}

const density = (alpha: number): number => -Math.log(1 - Math.min(alpha / 255, 0.998));

/** A picture's darkness - its alpha as density, summed - and the density-weighted middle of it in x. */
function measure(data: Uint8ClampedArray, region: { x: number; width: number; scale: number }): { total: number; middle: number } {
  let total = 0;
  let moment = 0;
  for (let i = 3; i < data.length; i += 4) {
    const d = density(data[i]);
    total += d;
    moment += d * (region.x + ((i - 3) / 4) % region.width);
  }
  return { total, middle: moment / total / region.scale };
}

test('a pass keeps the darkness, carries tone along the drag, and reaches past the line\'s edge', () => {
  const line = upright(100);
  const pass = smudgeFor(line, across(120), 24, 0.7)!;
  assert.ok(pass, 'the drag reaches the line');
  const smeared: Stroke = { ...line, smudges: [pass] };
  const region = pencilRegion(smeared, 1.5)!;
  const before = measure(rasterizePencil(line, region), region);
  const after = measure(pencilPicture(smeared, region), region);
  assert.ok(Math.abs(after.total - before.total) / before.total < 0.06, `darkness kept: ${before.total.toFixed(0)} to ${after.total.toFixed(0)}`);
  assert.ok(after.middle > before.middle + 0.5, `tone carried right: ${before.middle.toFixed(2)} to ${after.middle.toFixed(2)}`);
  // Past the line's right edge, in the swath, there is graphite now.
  const data = pencilPicture(smeared, region);
  const at = (x: number, y: number): number => data[((Math.round(y * 1.5) - region.y) * region.width + Math.round(x * 1.5) - region.x) * 4 + 3];
  assert.equal(rasterizePencil(line, region)[((Math.round(120 * 1.5) - region.y) * region.width + Math.round(112 * 1.5) - region.x) * 4 + 3], 0, 'nothing there before');
  assert.ok(at(112, 120) >= 5, `something there after: ${at(112, 120)}`);
});

test('the paper\'s tooth fills in: the grain\'s spread goes down in the swath', () => {
  // A broad, soft line, its grain plain to see.
  const broad = upright(100, { medium: 'vine', grade: 'Soft' }, 0.5, 20);
  const smeared: Stroke = { ...broad, smudges: [smudgeFor(broad, across(120, 60, 160), 30, 0.8)!] };
  const region = pencilRegion(smeared, 1)!;
  const spread = (data: Uint8ClampedArray): number => {
    const values: number[] = [];
    for (let y = 112; y <= 128; y++) for (let x = 94; x <= 106; x++) values.push(data[((y - region.y) * region.width + x - region.x) * 4 + 3]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  };
  const before = spread(rasterizePencil(broad, region));
  const after = spread(pencilPicture(smeared, region));
  assert.ok(after < before * 0.7, `the grain's spread ${before.toFixed(1)} to ${after.toFixed(1)}`);
});

test('the same pass gives the same bytes, and run a step at a time, the bytes of the whole', () => {
  const line = upright(80, { medium: 'graphite', grade: '6B' });
  // A drag that bends, so its fitted path samples to many points.
  const drag = across(100, 40, 200).map((p) => ({ ...p, y: p.y + 12 * Math.sin(p.x / 15) }));
  const pass = smudgeFor(line, drag, 18, 0.6)!;
  const smeared: Stroke = { ...line, smudges: [pass] };
  const region = pencilRegion(smeared, 2)!;
  assert.deepEqual(pencilPicture(smeared, region), pencilPicture(smeared, region));
  // A live drag: the same points handed over as they grow.
  const points = passOf(pass).points;
  const whole = rasterizePencil(line, region);
  smudgeBuffer(whole, region, { points, width: 18, strength: 0.6 }, pencilRgb(line));
  const parts = rasterizePencil(line, region);
  let state = null;
  assert.ok(points.length > 8, `a bent pass samples to many points: ${points.length}`);
  for (const end of [1, 2, Math.floor(points.length / 3), Math.floor(points.length / 2), points.length]) {
    state = smudgeBuffer(parts, region, { points: points.slice(0, end), width: 18, strength: 0.6 }, pencilRgb(line), state);
  }
  let worst = 0;
  for (let i = 3; i < whole.length; i += 4) worst = Math.max(worst, Math.abs(whole[i] - parts[i]));
  assert.ok(worst <= 1, `step by step matches the whole to a step: ${worst}`);
});

test('a drag leaves a pass only on the marks it reached, from where it reached them to as far as it carries', () => {
  const line = upright(100);
  assert.equal(smudgeFor(line, across(300, 0, 300), 20, 0.5), null, 'a drag below the line misses it');
  assert.equal(smearReaches(line, across(300, 0, 300), 20), false);
  assert.equal(smearReaches(line, across(120), 20), true);
  const pass = smudgeFor(line, across(120, 0, 300), 20, 0.5)!;
  const xs = passOf(pass).points.map((p) => p.x);
  assert.ok(Math.min(...xs) >= 100 - 12 - 2 && Math.min(...xs) <= 100 - 10, `it starts where the stump first reached the line: ${Math.min(...xs)}`);
  assert.ok(Math.max(...xs) <= 100 + 12 + 40 + 2, `and goes on two stump widths past the last touch: ${Math.max(...xs)}`);
  assert.equal(DEFAULT_SMEAR_STRENGTH, 0.5);
});

test('a smeared mark\'s box takes in where its graphite went, and its passes go wherever it goes', () => {
  const line = upright(100);
  const pass = smudgeFor(line, across(120), 20, 0.5)!;
  const smeared: Stroke = { ...line, smudges: [pass] };
  const plain = strokeBounds(line)!;
  const box = strokeBounds(smeared)!;
  assert.ok(box.maxX > plain.maxX + 20, 'the box grows along the drag');
  // Mapped: a move.
  const moved = mapSmudges([pass], (p) => ({ x: p.x + 10, y: p.y - 5 }))!;
  assert.equal(moved[0].path[0].p.x, pass.path[0].p.x + 10);
  assert.equal(moved[0].width, pass.width);
  assert.equal(mapSmudges(undefined, (p) => p), undefined);
  // The store's transforms carry them.
  const book = createSketchBook('smear');
  const sketch = book.sketches[0];
  sketch.strokes = [{ ...smeared, id: 's', layer: sketch.layers[0].id }];
  const store = new Store(book);
  const start = (): { x: number; y: number } => ({ ...store.sketch.strokes[0].smudges![0].path[0].p });
  const at0 = start();
  store.moveStrokes(['s'], 30, 0);
  assert.equal(start().x, at0.x + 30, 'a move');
  store.rotateStrokes(['s'], 180, 0, 0);
  assert.ok(Math.abs(start().x + at0.x + 30) < 1e-9 && Math.abs(start().y + at0.y) < 1e-9, 'a turn');
  store.mirrorStrokes(['s'], { flipX: true, flipY: false, x: 0, y: 0 });
  assert.ok(Math.abs(start().x - (at0.x + 30)) < 1e-9, 'a mirror');
  store.scaleStrokes(['s'], 2, 2, 0, 0);
  assert.ok(Math.abs(store.sketch.strokes[0].smudges![0].width - 40) < 1e-9, 'a scale widens the stump');
  // A warp, through the mesh's own map.
  const shift = { point: (p: { x: number; y: number }) => ({ x: p.x + 7, y: p.y }), rotation: () => 0 };
  const warped = mapStrokeGeometry(smeared, shift as never);
  assert.equal(warped.smudges?.[0].path[0].p.x, pass.path[0].p.x + 7);
});

test('the file keeps a Pencil mark\'s passes, and drops one that is not a pass', () => {
  const book = createSketchBook('smear');
  const sketch = book.sketches[0];
  const line = upright(100);
  sketch.strokes = [{ ...line, layer: sketch.layers[0].id, smudges: [smudgeFor(line, across(120), 20, 0.5)!] }];
  const back = parseSketchBook(serializeSketchBook(book)).sketches[0].strokes[0];
  assert.deepEqual(back.smudges, sketch.strokes[0].smudges);
  const odd = JSON.parse(serializeSketchBook(book));
  odd.sketches[0].strokes[0].smudges.push({ path: [{ p: { x: 0, y: 0 } }], width: 10, strength: 0.5 }, { path: 'no', width: 10, strength: 1 });
  odd.sketches[0].strokes.push({ ...odd.sketches[0].strokes[0], id: 'pen', tool: 'pen' });
  const read = parseSketchBook(JSON.stringify(odd)).sketches[0].strokes;
  assert.equal(read[0].smudges?.length, 1, 'a pass with one anchor, or none, is dropped');
  assert.equal(read[1].smudges, undefined, 'only a Pencil mark keeps passes');
});
