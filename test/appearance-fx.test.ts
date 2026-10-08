/**
 * The appearance effects on pixels (core/appearance-fx.ts): each pass held to
 * what its SVG graph draws, on small pictures of known shape - a square of
 * solid ink - and the shadows a list lays under its picture on their own,
 * each by its blend. What `rsvg-convert` draws from the same graphs is held
 * in effects.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blankImage, layOnto, runEffects, type FxImage } from '../src/core/appearance-fx.js';
import { blendPixel } from '../src/core/blend.js';
import type { Effect } from '../src/core/effects.js';
import { createComposition, decodePng, renderPng } from '../src/core/graphic-design/index.js';
import type { CompositionDocument } from '../src/core/graphic-design/types.js';
import type { Matrix } from '../src/core/graphic-design/geometry.js';

const SAME: Matrix = [1, 0, 0, 1, 0, 0];

/** A `size` by `size` picture, clear but for a square of solid color from `from` to `to` (exclusive) each way. */
function squareImage(size: number, from: number, to: number, rgb: [number, number, number] = [0.2, 0.4, 0.6]): FxImage {
  const img = blankImage(size, size);
  for (let y = from; y < to; y++) {
    for (let x = from; x < to; x++) img.pixels.set([rgb[0], rgb[1], rgb[2], 1], (y * size + x) * 4);
  }
  return img;
}

/** One pixel, premultiplied, rounded to three places. */
function at(img: FxImage, x: number, y: number): number[] {
  const p = (y * img.width + x) * 4;
  return [...img.pixels.slice(p, p + 4)].map((v) => Math.round(v * 1000) / 1000);
}

const alpha = (img: FxImage, x: number, y: number): number => img.pixels[(y * img.width + x) * 4 + 3];
/** A pixel's straight color's mean - its lightness, near enough. */
const light = (img: FxImage, x: number, y: number): number => {
  const p = (y * img.width + x) * 4;
  const a = img.pixels[p + 3];
  return a > 0 ? (img.pixels[p] + img.pixels[p + 1] + img.pixels[p + 2]) / (3 * a) : 0;
};
const run = (img: FxImage, effects: Effect[], separate = false) => runEffects(img, effects, SAME, () => {}, separate);

test('Feather fades a shape from clear at its edge to solid its radius inside, and keeps its color', () => {
  const img = squareImage(100, 20, 80);
  run(img, [{ type: 'feather', radius: 10 }]);
  assert.ok(alpha(img, 20, 50) < 0.12, `the edge pixel is nearly clear, at ${alpha(img, 20, 50)}`);
  assert.ok(alpha(img, 30, 50) > 0.9, `ten pixels in is nearly solid, at ${alpha(img, 30, 50)}`);
  assert.equal(alpha(img, 50, 50), 1, 'the middle is solid');
  assert.equal(alpha(img, 15, 50), 0, 'and nothing reaches outside');
  assert.ok(Math.abs(light(img, 24, 50) - 0.4) < 1e-4, 'a faded pixel keeps the color');
});

test('a spread firms a shadow\'s edge, and a full spread makes it solid', () => {
  const edge = (spread: number): number => {
    const img = squareImage(100, 30, 70, [1, 1, 1]);
    run(img, [{ type: 'drop-shadow', dx: 0, dy: 0, blur: 12, color: '#000000', spread }]);
    return alpha(img, 25, 50);
  };
  const none = edge(0);
  const half = edge(50);
  assert.ok(none > 0 && none < 0.6, `five pixels out a soft shadow is faint, at ${none}`);
  assert.ok(half > none * 1.5, `a spread of 50 firms it, to ${half}`);
  assert.ok(edge(100) > 0.99, 'a full spread makes it solid');
});

test('an Outer Glow lies around the shape and under it, and an Inner Shadow inside it, away from the light', () => {
  const glow = squareImage(100, 30, 70);
  run(glow, [{ type: 'outer-glow', blur: 10, spread: 0, color: '#ffcc00', blend: 'normal', opacity: 1 }]);
  assert.deepEqual(at(glow, 50, 50), [0.2, 0.4, 0.6, 1], 'the shape covers its glow');
  assert.ok(alpha(glow, 26, 50) > 0.2, 'the glow shows round it');
  const outside = glow.pixels.slice((50 * 100 + 26) * 4, (50 * 100 + 26) * 4 + 4);
  assert.ok(outside[0] / outside[3] > 0.99 && Math.abs(outside[1] / outside[3] - 0.8) < 0.01, 'in its own color');

  const shade = squareImage(100, 20, 80, [1, 1, 1]);
  run(shade, [{ type: 'inner-shadow', dx: 6, dy: 6, blur: 6, choke: 0, color: '#000000', blend: 'normal', opacity: 1 }]);
  assert.ok(light(shade, 22, 50) < 0.5, 'shaded inside the edge toward the light');
  assert.ok(light(shade, 77, 50) > 0.99, 'and not on the far side');
  assert.equal(alpha(shade, 15, 50), 0, 'nothing outside');
  assert.equal(alpha(shade, 22, 50), 1, 'the shape keeps its alpha');
});

test('an Inner Glow comes from the edge, or from the center, mixed by its blend', () => {
  const edge = squareImage(100, 20, 80);
  run(edge, [{ type: 'inner-glow', blur: 10, choke: 0, source: 'edge', color: '#ffffff', blend: 'sheer', opacity: 1 }]);
  assert.ok(light(edge, 21, 50) > light(edge, 50, 50) + 0.2, 'from the edge: lighter at the edge than in the middle');
  const center = squareImage(100, 20, 80);
  run(center, [{ type: 'inner-glow', blur: 10, choke: 0, source: 'center', color: '#ffffff', blend: 'sheer', opacity: 1 }]);
  assert.ok(light(center, 50, 50) > light(center, 21, 50) + 0.2, 'from the center: lighter in the middle');
  // Screen with white is white, so the middle of a center glow is white.
  assert.ok(light(center, 50, 50) > 0.99);
});

test('a Bevel lit from 120 degrees is light at the top left and shaded at the bottom right, and flat in the middle', () => {
  const plain = light(squareImage(100, 20, 80), 50, 50);
  const up = squareImage(100, 20, 80);
  run(up, [{ type: 'bevel', style: 'inner', depth: 100, direction: 'up', size: 10, soften: 0, angle: 120, altitude: 30, highlight: { color: '#ffffff', blend: 'sheer', opacity: 1 }, shadow: { color: '#000000', blend: 'stack', opacity: 1 } }]);
  assert.ok(light(up, 22, 22) > plain + 0.15, `the top-left corner is lit: ${light(up, 22, 22)} against ${plain}`);
  assert.ok(light(up, 77, 77) < plain - 0.15, `the bottom-right corner is shaded: ${light(up, 77, 77)}`);
  assert.ok(Math.abs(light(up, 50, 50) - plain) < 0.01, 'the middle is flat');
  assert.equal(alpha(up, 15, 50), 0, 'an inner bevel keeps inside');

  const down = squareImage(100, 20, 80);
  run(down, [{ type: 'bevel', style: 'inner', depth: 100, direction: 'down', size: 10, soften: 0, angle: 120, altitude: 30, highlight: { color: '#ffffff', blend: 'sheer', opacity: 1 }, shadow: { color: '#000000', blend: 'stack', opacity: 1 } }]);
  assert.ok(light(down, 22, 22) < plain - 0.15 && light(down, 77, 77) > plain + 0.15, 'pressed in, the light and the shade swap');
});

test('an outer bevel and an emboss reach outside the shape, and a pillow emboss shades a groove round it', () => {
  const outer = squareImage(100, 30, 70);
  run(outer, [{ type: 'bevel', style: 'outer', depth: 100, direction: 'up', size: 10, soften: 0, angle: 120, altitude: 30, highlight: { color: '#ffffff', blend: 'normal', opacity: 1 }, shadow: { color: '#000000', blend: 'normal', opacity: 1 } }]);
  assert.ok(alpha(outer, 66, 73) > 0.2, 'the outer bevel shades outside the bottom edge');
  assert.deepEqual(at(outer, 50, 50), [0.2, 0.4, 0.6, 1], 'and leaves the shape as it is');

  const pillow = squareImage(100, 30, 70);
  run(pillow, [{ type: 'emboss', style: 'pillow', depth: 100, direction: 'up', size: 8, soften: 0, angle: 120, altitude: 30, highlight: { color: '#ffffff', blend: 'normal', opacity: 1 }, shadow: { color: '#000000', blend: 'normal', opacity: 1 } }]);
  const groove = pillow.pixels.slice((28 * 100 + 50) * 4, (28 * 100 + 50) * 4 + 4);
  assert.ok(groove[3] > 0.2 && groove[0] / groove[3] < 0.1, 'outside the top edge, the groove is shaded');
});

test('a shadow at the end of the list that blends is laid under the picture on its own; a Normal one, or one an effect works on after, stays in it', () => {
  const blended: Effect = { type: 'drop-shadow', dx: 8, dy: 8, blur: 0, color: '#ff0000', blend: 'stack' };
  const alone = squareImage(100, 20, 60);
  const unders = run(alone, [blended], true);
  assert.equal(unders.length, 1, 'one layer laid under it');
  assert.equal(unders[0].blend, 'stack');
  assert.equal(alpha(alone, 65, 65), 0, 'and the picture itself has no shadow');
  const layer = unders[0].image;
  assert.equal(layer.pixels[((65 - unders[0].y) * layer.width + 65 - unders[0].x) * 4 + 3], 1, 'the layer is the shadow');

  const normal = squareImage(100, 20, 60);
  assert.equal(run(normal, [{ ...blended, blend: undefined }], true).length, 0, 'a Normal shadow stays in the picture');
  assert.equal(alpha(normal, 65, 65), 1);

  const after = squareImage(100, 20, 60);
  assert.equal(run(after, [blended, { type: 'grayscale', amount: 1 }], true).length, 0, 'an effect after it works on it, so it stays');
  assert.equal(run(squareImage(100, 20, 60), [blended], false).length, 0, 'and nothing goes under where nothing may');

  const two = run(squareImage(100, 20, 60), [blended, { type: 'outer-glow', blur: 6, spread: 0, color: '#00ff00', blend: 'sheer', opacity: 1 }], true);
  assert.deepEqual(two.map((under) => under.blend), ['stack', 'sheer'], 'two at the end go under in their order');
});

test('a picture laid over another by a blend mixes as blendPixel does', () => {
  const base = blankImage(2, 1);
  base.pixels.set([0.25, 0.5, 0.75, 1, 0.3, 0.3, 0.3, 0.5]);
  const top = blankImage(2, 1);
  top.pixels.set([0.8, 0.4, 0.2, 1, 0.4, 0.2, 0.1, 0.5]);
  layOnto(base, top, 0, 0, 'stack');
  const want = blendPixel('stack', [0.25, 0.5, 0.75, 1], [0.8, 0.4, 0.2, 1]);
  assert.deepEqual(at(base, 0, 0), want.map((v) => Math.round(v * 1000) / 1000));
  const half = blendPixel('stack', [0.6, 0.6, 0.6, 0.5], [0.8, 0.4, 0.2, 0.5]);
  const premultiplied = [half[0] * half[3], half[1] * half[3], half[2] * half[3], half[3]].map((v) => Math.round(v * 1000) / 1000);
  assert.deepEqual(at(base, 1, 0), premultiplied, 'translucent on translucent too');
});

// ---- Drawn by the rasterizer -------------------------------------------------------------

/** One pixel of a rendered composition: straight RGBA bytes. */
function pixel(doc: CompositionDocument, x: number, y: number): number[] {
  const { data, width } = renderPng(doc);
  const image = decodePng(data);
  const p = (y * width + x) * 4;
  return [...image.data.slice(p, p + 4)];
}

test('a shadow that multiplies mixes with what is under its element, unless the element is translucent', () => {
  const shadowed = (opacity?: number): CompositionDocument => {
    const design = createComposition({ width: 100, height: 100, background: '#808080' });
    design.rect({ x: 20, y: 20, width: 40, height: 40, fill: '#ffffff', ...(opacity ? { opacity } : {}), effects: [{ type: 'drop-shadow', dx: 20, dy: 20, blur: 0, color: '#ff0000', blend: 'stack' }] });
    return design.toDocument();
  };
  assert.deepEqual(pixel(shadowed(), 70, 70), [128, 0, 0, 255], 'red multiplied into gray');
  assert.deepEqual(pixel(shadowed(), 40, 40), [255, 255, 255, 255], 'under the element, the element');
  // A translucent element keeps its shadow in its picture, at its opacity, where there is nothing to mix with.
  const faded = pixel(shadowed(0.5), 70, 70);
  assert.ok(Math.abs(faded[0] - 191.5) <= 1 && faded[1] === 64 && faded[2] === 64, `red at half over gray: ${faded}`);
});

test('an effect aimed at the fill leaves the stroke as it is, and one aimed at the stroke the fill', () => {
  const doc = (target: 'fill' | 'stroke'): CompositionDocument => {
    const design = createComposition({ width: 100, height: 100, background: '#ffffff' });
    design.rect({ x: 20, y: 20, width: 60, height: 60, fill: '#326478', stroke: '#000000', strokeWidth: 8, effects: [{ type: 'inner-glow', blur: 12, choke: 0, source: 'edge', color: '#ffff00', blend: 'normal', opacity: 1, target }] });
    return design.toDocument();
  };
  const onFill = doc('fill');
  assert.deepEqual(pixel(onFill, 50, 20), [0, 0, 0, 255], 'the stroke is clean');
  const inside = pixel(onFill, 50, 26);
  assert.ok(inside[0] > 0x32 + 15 && inside[1] > 0x64 + 10, `the fill glows yellow inside the stroke: ${inside}`);
  const onStroke = doc('stroke');
  assert.deepEqual(pixel(onStroke, 50, 50), [0x32, 0x64, 0x78, 255], 'the fill is clean');
  assert.deepEqual(pixel(onFill, 50, 50).slice(3), [255]);
});
