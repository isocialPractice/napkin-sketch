/**
 * Effects: the CSS filter functions as data, drawn the same way by every
 * output that can draw them.
 *
 * Each rasterizer pass is held to known pixels - the matrices the Filter
 * Effects specification defines, worked in sRGB - and to the order SVG gives
 * a filter, a clip, an opacity and a mask. The SVG writers are held to the
 * filters they write, the PNG to what `rsvg-convert` draws from that SVG
 * where it is installed, and the sketch model to keeping its effects through
 * a save, an export and the lowering the PNG goes through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { colorMatrix, cssFilter, effectReach, readEffects, scaleEffects, svgFilterMarkup, type Effect } from '../src/core/effects.js';
import { compositionToSvg, createComposition, decodePng, renderPng } from '../src/core/graphic-design/index.js';
import type { CompositionDocument } from '../src/core/graphic-design/types.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { renderSketch } from '../src/core/script/render.js';
import { createLayer, createSketch, createSketchBook, type Sketch, type Stroke, type VectorAnchor } from '../src/core/types.js';
import { sampleVectorPathPoints } from '../src/sharpen/geometry.js';
import { findRsvg, RSVG_SKIP } from './helpers/rsvg.js';

/** One pixel of a rendered composition: straight RGBA bytes. */
function pixel(doc: CompositionDocument, x: number, y: number): number[] {
  const { data, width } = renderPng(doc);
  const image = decodePng(data);
  const p = (y * width + x) * 4;
  return [...image.data.slice(p, p + 4)];
}

/** A 100 by 100 page, transparent unless asked, with one 60 by 60 square in the middle. */
function square(fill: string, effects: Effect[], background: string | null = null): CompositionDocument {
  const design = createComposition({ width: 100, height: 100, background });
  design.rect({ x: 20, y: 20, width: 60, height: 60, fill, effects });
  return design.toDocument();
}

// ---- The model ---------------------------------------------------------------

test('an effect list reads what it can, holds a share to 0 to 1, and drops what is not an effect', () => {
  assert.deepEqual(
    readEffects([
      { type: 'blur', radius: 4 },
      { type: 'sepia', amount: 2 },
      { type: 'grayscale' },
      { type: 'brightness', amount: -1 },
      { type: 'glow', amount: 1 },
      { type: 'blur', radius: -3 },
      { type: 'hue-rotate', angle: 90, extra: true },
      { type: 'drop-shadow', dx: 2, dy: 3 },
      'blur',
    ]),
    [
      { type: 'blur', radius: 4 },
      { type: 'sepia', amount: 1 },
      { type: 'grayscale', amount: 1 },
      { type: 'hue-rotate', angle: 90 },
      { type: 'drop-shadow', dx: 2, dy: 3, blur: 0, color: '#000000' },
    ],
  );
  assert.equal(readEffects([{ type: 'glow' }]), undefined, 'nothing left is no list at all');
  assert.equal(readEffects('blur'), undefined);
});

test('an effect list reaches as far as its blurs and shadows together', () => {
  assert.equal(effectReach([{ type: 'sepia', amount: 1 }]), 0);
  assert.equal(effectReach([{ type: 'blur', radius: 4 }]), 12);
  assert.equal(effectReach([{ type: 'drop-shadow', dx: 6, dy: -10, blur: 4, color: '#000' }, { type: 'blur', radius: 1 }]), 10 + 6 + 3);
  assert.deepEqual(scaleEffects([{ type: 'blur', radius: 4 }, { type: 'drop-shadow', dx: 1, dy: 2, blur: 3, color: 'red' }, { type: 'invert', amount: 1 }], 2), [
    { type: 'blur', radius: 8 },
    { type: 'drop-shadow', dx: 2, dy: 4, blur: 6, color: 'red' },
    { type: 'invert', amount: 1 },
  ]);
});

test('the neutral amount of each color effect is the identity', () => {
  const identity = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  const neutral: Effect[] = [
    { type: 'brightness', amount: 1 },
    { type: 'contrast', amount: 1 },
    { type: 'saturate', amount: 1 },
    { type: 'grayscale', amount: 0 },
    { type: 'sepia', amount: 0 },
    { type: 'invert', amount: 0 },
    { type: 'hue-rotate', angle: 0 },
    { type: 'opacity', amount: 1 },
  ];
  for (const effect of neutral) {
    const m = colorMatrix(effect);
    assert.ok(m, effect.type);
    m.forEach((v, i) => assert.ok(Math.abs(v - identity[i]) < 1e-9, `${effect.type}: entry ${i} is ${v}`));
  }
  assert.equal(colorMatrix({ type: 'blur', radius: 2 }), null);
});

test('a canvas filter is the CSS list, its lengths and a shadow turned by the transform', () => {
  const effects: Effect[] = [
    { type: 'blur', radius: 2 },
    { type: 'hue-rotate', angle: 90 },
    { type: 'drop-shadow', dx: 4, dy: 0, blur: 6, color: '#00000066' },
    { type: 'opacity', amount: 0.5 },
  ];
  assert.equal(cssFilter(effects), 'blur(2px) hue-rotate(90deg) drop-shadow(4px 0px 6px #00000066) opacity(0.5)');
  assert.equal(cssFilter(effects.slice(0, 1), { a: 3, b: 0, c: 0, d: 3 }), 'blur(6px)', 'a canvas at three device pixels a unit');
  // A quarter turn clockwise carries a shadow across into a shadow down.
  assert.equal(cssFilter(effects.slice(2, 3), { a: 0, b: 2, c: -2, d: 0 }), 'drop-shadow(0px 8px 12px #00000066)');
});

// ---- The rasterizer, pass by pass ----------------------------------------------

test('each color effect gives the pixel its matrix does', () => {
  const at = (fill: string, effect: Effect): number[] => pixel(square(fill, [effect]), 50, 50);
  assert.deepEqual(at('#808080', { type: 'brightness', amount: 0.5 }), [64, 64, 64, 255]);
  assert.deepEqual(at('#ffffff', { type: 'contrast', amount: 0.5 }), [191, 191, 191, 255]);
  assert.deepEqual(at('#000000', { type: 'contrast', amount: 0.5 }), [64, 64, 64, 255]);
  assert.deepEqual(at('#ff0000', { type: 'saturate', amount: 0 }), [54, 54, 54, 255]);
  assert.deepEqual(at('#ff0000', { type: 'grayscale', amount: 1 }), [54, 54, 54, 255]);
  assert.deepEqual(at('#00ff00', { type: 'grayscale', amount: 1 }), [182, 182, 182, 255]);
  assert.deepEqual(at('#ffffff', { type: 'sepia', amount: 1 }), [255, 255, 239, 255]);
  assert.deepEqual(at('#ff0000', { type: 'invert', amount: 1 }), [0, 255, 255, 255]);
  assert.deepEqual(at('#ff0000', { type: 'hue-rotate', angle: 180 }), [0, 109, 109, 255]);
  assert.deepEqual(at('#ff0000', { type: 'opacity', amount: 0.5 }), [255, 0, 0, 128]);
});

test('a blur softens the edge, keeps the middle, conserves the ink, and reaches no further than three deviations', () => {
  const plain = square('#000000', []);
  const blurred = square('#000000', [{ type: 'blur', radius: 4 }]);
  assert.deepEqual(pixel(blurred, 50, 50), [0, 0, 0, 255], 'the middle is still solid');
  const edge = pixel(blurred, 20, 50)[3];
  assert.ok(edge > 100 && edge < 160, `the edge is half covered, and is ${edge}`);
  const tail = pixel(blurred, 12, 50)[3];
  assert.ok(tail > 0 && tail < 30, `two deviations out there is a little ink, and there is ${tail}`);
  assert.equal(pixel(blurred, 2, 50)[3], 0, 'four and a half deviations out there is none');
  const ink = (doc: CompositionDocument): number => decodePng(renderPng(doc).data).data.reduce((sum, v, i) => (i % 4 === 3 ? sum + v : sum), 0);
  const ratio = ink(blurred) / ink(plain);
  assert.ok(Math.abs(ratio - 1) < 0.01, `the ink is conserved, to ${ratio}`);
});

test('a drop shadow lies under the shape at its offset, in its color', () => {
  const design = createComposition({ width: 120, height: 120, background: null });
  design.rect({ x: 20, y: 20, width: 40, height: 40, fill: '#ffffff', effects: [{ type: 'drop-shadow', dx: 10, dy: 10, blur: 0, color: '#326478' }] });
  const doc = design.toDocument();
  assert.deepEqual(pixel(doc, 30, 30), [255, 255, 255, 255], 'the shape is on top');
  assert.deepEqual(pixel(doc, 65, 65), [0x32, 0x64, 0x78, 255], 'the shadow shows past it');
  assert.equal(pixel(doc, 15, 15)[3], 0, 'and nowhere it was not cast');
  assert.equal(pixel(doc, 65, 25)[3], 0);
});

test('the effects run in the order they are listed', () => {
  const graying = square('#ff0000', [{ type: 'drop-shadow', dx: 10, dy: 10, blur: 0, color: '#0000ff' }, { type: 'grayscale', amount: 1 }]);
  const first = square('#ff0000', [{ type: 'grayscale', amount: 1 }, { type: 'drop-shadow', dx: 10, dy: 10, blur: 0, color: '#0000ff' }]);
  assert.deepEqual(pixel(graying, 85, 85), [18, 18, 18, 255], 'a shadow then gray: the shadow is grayed too');
  assert.deepEqual(pixel(first, 85, 85), [0, 0, 255, 255], 'gray then a shadow: the shadow keeps its blue');
});

test('a group with effects is one picture: two children cast one shadow', () => {
  const design = createComposition({ width: 120, height: 100, background: null });
  design.group({ effects: [{ type: 'drop-shadow', dx: 0, dy: 30, blur: 0, color: '#00000080' }] }, (g) => {
    g.rect({ x: 20, y: 20, width: 40, height: 20, fill: '#326478' });
    g.rect({ x: 40, y: 20, width: 40, height: 20, fill: '#ffe08a' });
  });
  const alpha = pixel(design.toDocument(), 50, 60)[3];
  assert.equal(alpha, 128, 'under both children the shadow is as dark as under one');
});

test('a filter comes before the clip, the opacity and a group\'s erase shapes, as SVG orders them', () => {
  const clipped = createComposition({ width: 100, height: 100, background: null });
  clipped.rect({
    x: 20, y: 20, width: 60, height: 60, fill: '#000000',
    effects: [{ type: 'blur', radius: 4 }],
    clip: { type: 'rect', x: 30, y: 0, width: 40, height: 100 },
  });
  assert.equal(pixel(clipped.toDocument(), 25, 50)[3], 0, 'the clip cuts the blurred picture');

  const faded = createComposition({ width: 120, height: 120, background: null });
  faded.rect({ x: 20, y: 20, width: 40, height: 40, fill: '#000000', opacity: 0.5, effects: [{ type: 'drop-shadow', dx: 30, dy: 0, blur: 0, color: '#ff0000' }] });
  assert.deepEqual(pixel(faded.toDocument(), 80, 40), [255, 0, 0, 128], 'the opacity fades the shadow with the shape');

  const holed = createComposition({ width: 100, height: 100, background: null });
  holed.group({ effects: [{ type: 'blur', radius: 3 }], erase: [{ type: 'circle', cx: 50, cy: 50, r: 5, fill: '#000' }] }, (g) => {
    g.rect({ x: 20, y: 20, width: 60, height: 60, fill: '#000000' });
  });
  assert.equal(pixel(holed.toDocument(), 50, 50)[3], 0, 'the hole is cut after the blur, so it stays clear');
  assert.equal(pixel(holed.toDocument(), 50, 35)[3], 255, 'and the rest of the group is drawn');
});

test('an effect near the page edge still has the ink past the edge to work with', () => {
  const design = createComposition({ width: 100, height: 100, background: null });
  design.rect({ x: -40, y: 20, width: 80, height: 60, fill: '#000000', effects: [{ type: 'blur', radius: 4 }] });
  assert.deepEqual(pixel(design.toDocument(), 0, 50), [0, 0, 0, 255], 'the page edge is inside the shape, and stays solid');
});

test('a shadow color that is not one is left out, and said so', () => {
  const design = createComposition({ width: 100, height: 100, background: null });
  design.rect({ x: 20, y: 20, width: 40, height: 40, fill: '#000000', effects: [{ type: 'drop-shadow', dx: 10, dy: 10, blur: 0, color: 'not-a-color' }, { type: 'glow' } as never] });
  const { warnings } = renderPng(design.toDocument());
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.match(warnings.join('\n'), /not one it can paint/);
  assert.match(warnings.join('\n'), /an effect it does not know/);
});

// ---- SVG ---------------------------------------------------------------------------

test('the SVG writes each effect list as a filter in sRGB, over a region that fits', () => {
  const design = createComposition({ width: 200, height: 100, background: null });
  design.rect({ x: 20, y: 20, width: 60, height: 60, fill: '#000000', effects: [{ type: 'blur', radius: 4 }] });
  design.rect({ x: 20, y: 20, width: 60, height: 60, fill: '#326478', effects: [{ type: 'blur', radius: 4 }] });
  design.rect({ x: 120, y: 20, width: 60, height: 60, fill: '#000000', effects: [{ type: 'brightness', amount: 0.5 }] });
  const svg = compositionToSvg(design.toDocument());
  assert.equal(svg.match(/<filter /g)?.length, 2, 'the same effects over the same box share one filter');
  assert.match(
    svg,
    /<filter id="effect-1" filterUnits="userSpaceOnUse" x="7" y="7" width="86" height="86" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="effect-1-0"\/><\/filter>/,
    'the box grown by three deviations and a pixel',
  );
  assert.match(svg, /values="0\.5 0 0 0 0 0 0\.5 0 0 0 0 0 0\.5 0 0 0 0 0 1 0"/);
  assert.equal(svg.match(/filter="url\(#effect-1\)"/g)?.length, 2);
  assert.equal(svg.match(/filter="url\(#effect-2\)"/g)?.length, 1);
});

test('a shadow is written as the primitives SVG 1.1 spells it with', () => {
  const markup = svgFilterMarkup([{ type: 'drop-shadow', dx: 3, dy: 4, blur: 6, color: 'rgba(50, 100, 120, 0.5)' }], 'fx', { x: 0, y: 0, width: 10, height: 10 }, String);
  assert.equal(
    markup,
    '<filter id="fx" filterUnits="userSpaceOnUse" x="0" y="0" width="10" height="10" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="fx-0-blur"/>' +
      '<feOffset in="fx-0-blur" dx="3" dy="4" result="fx-0-offset"/>' +
      '<feFlood flood-color="#326478" flood-opacity="0.5" result="fx-0-color"/>' +
      '<feComposite in="fx-0-color" in2="fx-0-offset" operator="in" result="fx-0-shadow"/>' +
      '<feMerge result="fx-0"><feMergeNode in="fx-0-shadow"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>',
  );
  assert.doesNotMatch(
    svgFilterMarkup([{ type: 'drop-shadow', dx: 3, dy: 4, blur: 0, color: '#000' }], 'fx', { x: 0, y: 0, width: 1, height: 1 }, String),
    /feGaussianBlur/,
    'a shadow with no blur is its offset alone',
  );
});

test('a group\'s filter region covers its children where their own transforms put them', () => {
  const design = createComposition({ width: 300, height: 200, background: null });
  design.group({ effects: [{ type: 'sepia', amount: 1 }] }, (g) => {
    g.rect({ x: 0, y: 0, width: 10, height: 10, fill: '#000', translate: { x: 200, y: 100 } });
  });
  const region = /<filter id="effect-1" filterUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/.exec(compositionToSvg(design.toDocument()));
  assert.ok(region);
  const [x, y, width, height] = region.slice(1).map(Number);
  assert.ok(x <= 200 && y <= 100 && x + width >= 210 && y + height >= 110, `${x} ${y} ${width} ${height}`);
});

const RSVG = findRsvg();

test('the PNG draws what rsvg-convert draws from the SVG, blur, shadow and color alike', { skip: RSVG ? false : RSVG_SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-effects-'));
  try {
    const cases: Array<[string, (design: ReturnType<typeof createComposition>) => void]> = [
      ['blur', (d) => d.rect({ x: 40, y: 30, width: 80, height: 60, fill: '#326478', effects: [{ type: 'blur', radius: 6 }] })],
      ['shadow', (d) => d.rect({ x: 40, y: 30, width: 70, height: 50, fill: '#ffe08a', effects: [{ type: 'drop-shadow', dx: 8, dy: 8, blur: 8, color: 'rgba(0,0,0,0.5)' }] })],
      ['color', (d) => d.rect({ x: 20, y: 20, width: 120, height: 80, fill: '#8090a0', effects: [{ type: 'contrast', amount: 1.8 }, { type: 'saturate', amount: 2 }, { type: 'sepia', amount: 0.5 }] })],
      [
        'group',
        (d) =>
          d.group({ effects: [{ type: 'drop-shadow', dx: 6, dy: 6, blur: 4, color: '#00000080' }, { type: 'grayscale', amount: 0.5 }] }, (g) => {
            g.rect({ x: 30, y: 30, width: 50, height: 50, fill: '#326478' });
            g.rect({ x: 70, y: 40, width: 50, height: 50, fill: '#ff8a65' });
          }),
      ],
    ];
    for (const [name, build] of cases) {
      const design = createComposition({ width: 160, height: 120, background: '#ffffff' });
      build(design);
      const doc = design.toDocument();
      const ours = decodePng(renderPng(doc).data);
      writeFileSync(join(dir, `${name}.svg`), compositionToSvg(doc));
      const run = spawnSync(RSVG!, [join(dir, `${name}.svg`), '-o', join(dir, `${name}.png`)]);
      assert.equal(run.status, 0, String(run.stderr));
      const theirs = decodePng(new Uint8Array(readFileSync(join(dir, `${name}.png`))));
      let total = 0;
      for (let i = 0; i < ours.data.length; i++) total += Math.abs(ours.data[i] - theirs.data[i]);
      const mean = total / ours.data.length;
      assert.ok(mean < 1.5, `${name}: the two renders differ by ${mean.toFixed(3)} a channel on average`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- The sketch model ----------------------------------------------------------------

/** A closed square mark, filled, as Vector Path anchors. */
function squareMark(x: number, y: number, size: number, extra: Partial<Stroke> = {}): Stroke {
  const anchors: VectorAnchor[] = [
    { p: { x, y } },
    { p: { x: x + size, y } },
    { p: { x: x + size, y: y + size } },
    { p: { x, y: y + size } },
  ];
  return {
    id: `st-${x}-${y}`,
    tool: 'pen',
    color: '#1f2328',
    width: 2,
    fill: '#ffe08a',
    points: sampleVectorPathPoints(anchors, true),
    vector: { anchors, closed: true },
    sharpened: true,
    ...extra,
  };
}

function sketchWith(layerEffects: Effect[] | undefined, strokes: Stroke[]): Sketch {
  const sketch = createSketch('effects');
  sketch.width = 200;
  sketch.height = 160;
  sketch.background = '#ffffff';
  const layer = createLayer('Card');
  if (layerEffects) layer.effects = layerEffects;
  sketch.layers = [layer];
  sketch.strokes = strokes.map((stroke) => ({ ...stroke, layer: layer.id }));
  return sketch;
}

test('a saved book keeps the effects on its marks and its layers, and an eraser has none', () => {
  const book = createSketchBook('effects');
  book.sketches = [
    sketchWith([{ type: 'sepia', amount: 0.6 }], [
      squareMark(20, 20, 60, { effects: [{ type: 'drop-shadow', dx: 4, dy: 4, blur: 6, color: '#00000066' }] }),
      { ...squareMark(100, 20, 20), tool: 'eraser', effects: [{ type: 'blur', radius: 2 }] },
    ]),
  ];
  const back = parseSketchBook(serializeSketchBook(book)).sketches[0];
  assert.deepEqual(back.layers[0].effects, [{ type: 'sepia', amount: 0.6 }]);
  assert.deepEqual(back.strokes[0].effects, [{ type: 'drop-shadow', dx: 4, dy: 4, blur: 6, color: '#00000066' }]);
  assert.equal('effects' in back.strokes[1], false);
});

test('the sketch SVG puts a filter and the list itself on a mark and on a layer', () => {
  const sketch = sketchWith([{ type: 'grayscale', amount: 1 }], [squareMark(20, 20, 60, { effects: [{ type: 'blur', radius: 3 }] })]);
  const svg = sketchToSvg(sketch);
  assert.match(svg, /<g id="Card"[^>]* filter="url\(#effect-\d\)" data-effects="\[\{&quot;type&quot;:&quot;grayscale&quot;,&quot;amount&quot;:1\}\]"/);
  assert.match(svg, /<path filter="url\(#effect-\d\)" data-effects="\[\{&quot;type&quot;:&quot;blur&quot;,&quot;radius&quot;:3\}\]" d="/);
  assert.equal(svg.match(/<filter /g)?.length, 2);
  assert.doesNotMatch(sketchToSvg(sketchWith(undefined, [squareMark(20, 20, 60)])), /filter|data-effects/, 'and nothing on a sketch without effects');
});

test('the lowering carries a mark\'s effects to its element, and a layer\'s to its group', () => {
  const sketch = sketchWith([{ type: 'sepia', amount: 1 }], [
    squareMark(20, 20, 60, { effects: [{ type: 'blur', radius: 3 }] }),
    squareMark(100, 20, 40, { profile: 'tapered', effects: [{ type: 'invert', amount: 1 }] }),
  ]);
  const [group] = sketchToComposition(sketch).elements;
  assert.equal(group.type, 'group');
  assert.deepEqual(group.effects, [{ type: 'sepia', amount: 1 }]);
  const children = group.type === 'group' ? group.children : [];
  assert.deepEqual(children[0].effects, [{ type: 'blur', radius: 3 }]);
  assert.equal(children[1].type, 'group', 'a mark drawn as two elements takes its effects as a group of them');
  assert.deepEqual(children[1].effects, [{ type: 'invert', amount: 1 }]);
});

test('a sketch\'s PNG draws its effects, and its PDF prints them plain and says so', () => {
  const sketch = sketchWith(undefined, [squareMark(20, 20, 60, { effects: [{ type: 'drop-shadow', dx: 20, dy: 20, blur: 0, color: '#326478' }] })]);
  const png = decodePng(renderSketch(sketch, { format: 'png' }));
  const p = (95 * png.width + 95) * 4;
  assert.deepEqual([...png.data.slice(p, p + 4)], [0x32, 0x64, 0x78, 255], 'the shadow, past the square');
  const warnings: string[] = [];
  renderSketch(sketch, { format: 'pdf', onWarning: (message) => warnings.push(message) });
  assert.deepEqual(warnings, ['page "effects": an effect is not drawn in a PDF, so what carries it prints plain']);
});
