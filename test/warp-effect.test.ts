/**
 * Warp as an effect: a vector editor's Effect > Warp on a mark, on a part of
 * it, and on a layer or a group, whose marks it bends as one - drawn, measured,
 * found, written to every output, baked by Expand Appearance and written by a
 * script (core/geometry-effects.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultEffect, readEffect, activeEffects, activeGeometryEffects, type Effect } from '../src/core/effects.js';
import { effectName, expandAppearance, markEffectPlan, splitsParts, withEffectField } from '../src/core/appearance.js';
import { bindGeometry, drawnMark, drawnPart, expandLayerWarps, geometryOf, geometryParts } from '../src/core/geometry-effects.js';
import { strokeBounds } from '../src/core/bounds.js';
import { hitMark } from '../src/core/hit-test.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { createComposition, rasterizeComposition, renderPng } from '../src/core/graphic-design/index.js';
import { evaluate, formatDiagnostic, formatScript } from '../src/core/script/index.js';
import { sketchToInstructions } from '../src/core/script/writer.js';
import { createSketchBook, type Layer, type Sketch, type Stroke } from '../src/core/types.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const TIME = '2026-10-02T00:00:00.000Z';

/** A rectangle, 200 by 100 at (100, 100), as a Vector Path: four corners and nothing between. */
const rect = (effects: Effect[] | undefined, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'rect',
  layer: 'ly_rect',
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill: '#ffe08a',
  points: [
    { x: 100, y: 100, pressure: 0.5 },
    { x: 300, y: 100, pressure: 0.5 },
    { x: 300, y: 200, pressure: 0.5 },
    { x: 100, y: 200, pressure: 0.5 },
    { x: 100, y: 100, pressure: 0.5 },
  ],
  vector: { anchors: [{ p: { x: 100, y: 100 } }, { p: { x: 300, y: 100 } }, { p: { x: 300, y: 200 } }, { p: { x: 100, y: 200 } }], closed: true },
  ...(effects ? { effects } : {}),
  ...extra,
});

const warp = (extra: Partial<Extract<Effect, { type: 'warp' }>> = {}): Effect => ({ ...defaultEffect('warp'), ...extra }) as Effect;

const pageOf = (strokes: Stroke[], layers?: Layer[]): Sketch => {
  const book = createSketchBook('warp');
  const sketch = book.sketches[0];
  sketch.background = '#ffffff';
  sketch.sizeMode = 'sized';
  sketch.width = 400;
  sketch.height = 300;
  sketch.layers = layers ?? strokes.map((s): Layer => ({ id: s.layer ?? `ly_${s.id}`, name: s.id, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes;
  return sketch;
};

// ---- The effect -----------------------------------------------------------------------

test('a Warp reads with its defaults - Arc, horizontal, bent 50% - by either name, its part held to what the style takes', () => {
  assert.deepEqual(readEffect({ type: 'warp' }), { type: 'warp', style: 'arc', orientation: 'horizontal', bend: 50, distortH: 0, distortV: 0, part: 'whole' });
  assert.deepEqual(readEffect({ type: 'warp', style: 'Bulge', bend: -30 }), { type: 'warp', style: 'unroll', orientation: 'horizontal', bend: -30, distortH: 0, distortV: 0, part: 'whole' });
  assert.equal((readEffect({ type: 'warp', style: 'arc-upper' }) as { part: string }).part, 'upper');
  assert.equal((readEffect({ type: 'warp', style: 'shell' }) as { part: string }).part, 'lower', 'Shell has no whole part');
  assert.equal((readEffect({ type: 'warp', style: 'twirl', part: 'upper' }) as { part: string }).part, 'whole');
  assert.equal((readEffect({ type: 'warp', bend: 250 }) as { bend: number }).bend, 100, 'held to its range');
  assert.equal(readEffect({ type: 'warp', style: 'spiral' }), null);
  assert.equal(activeEffects([warp()]), undefined, 'no raster pass sees it');
  assert.equal(activeGeometryEffects([warp()])?.length, 1);
  assert.equal(effectName(warp({ style: 'shell', part: 'upper' })), 'Warp: Shell Upper');
  const changed = withEffectField(withEffectField(warp(), 'style', 'shell'), 'part', 'whole');
  assert.equal((changed as { part: string }).part, 'lower', 'the form cannot give Shell a whole part');
});

test('a Warp on the whole mark bends it whole; aimed at a part, it parts the mark', () => {
  const whole = rect([warp({ style: 'arch', bend: 100 })]);
  assert.equal(splitsParts(whole.effects), false);
  assert.equal(markEffectPlan(whole), null, 'no raster effects, no split: it draws as a mark');
  const bent = drawnMark(whole);
  assert.notEqual(bent, whole);
  assert.equal(bent.fill, '#ffe08a', 'its paint as it was');
  assert.equal(bent.effects, undefined, 'and no geometry effect to bend it again');
  assert.equal(bent.vector?.anchors.length, 4, 'a parabolic bend keeps the four corners and curves the edges between');
  assert.ok(bent.vector!.anchors.some((anchor) => anchor.hOut), 'which are curves now');
  // The top edge's middle rose by the box's half-height.
  const top = Math.min(...bent.points.map((p) => p.y));
  assert.ok(Math.abs(top - 50) < 0.5, `the top's middle at ${top}`);

  const aimed = rect([warp({ style: 'arch', bend: 100, target: 'fill' })]);
  assert.equal(markEffectPlan(aimed)?.split, true, 'aimed at the fill, the parts are drawn apart');
  const parts = geometryParts(aimed)!;
  assert.deepEqual(parts.changed, { fill: true, stroke: false });
  assert.ok(Math.min(...parts.fill.points.map((p) => p.y)) < 60, 'the fill bends');
  assert.equal(Math.min(...parts.stroke.points.map((p) => p.y)), 100, 'the outline stays');
  assert.equal(drawnPart(aimed, 'stroke').points, aimed.points);

  const text: Stroke = { id: 't', tool: 'text', text: 'Hi', color: '#000', width: 1, points: [{ x: 10, y: 10, pressure: 0.5 }], effects: [warp()] };
  assert.equal(geometryOf(text), null, 'text takes no Warp until it can be drawn from its outlines');
});

test('a warped mark\'s box is where it is bent, and a click finds it there, not where it was', () => {
  const mark = rect([warp({ style: 'arch', bend: 100 })]);
  const box = strokeBounds(mark)!;
  // Arch lifts the middle of both edges a half-height; the corners stay.
  assert.ok(Math.abs(box.minY - 50) < 0.5 && Math.abs(box.maxY - 200) < 0.5, `the box rose with it: ${JSON.stringify(box)}`);
  const sketch = pageOf([mark]);
  const options = { tolerancePx: 4, zoom: 1 };
  assert.equal(hitMark(sketch, { x: 200, y: 70 }, options)?.id, 'rect', 'inside the bent shape, above where it was');
  assert.equal(hitMark(sketch, { x: 200, y: 185 }, options), null, 'and not below its bent bottom edge');
});

test('Warp and Splatter work in their list\'s order: a hatch bent, or a bent shape hatched', () => {
  const splat = { ...defaultEffect('splatter'), spacing: 10, width: 2, overlapVariation: 0, spacingVariation: 0, curvinessVariation: 0, curviness: 0 } as Effect;
  const bentHatch = geometryParts(rect([splat, warp({ style: 'arch', bend: 100 })]))!;
  const hatchedBent = geometryParts(rect([warp({ style: 'arch', bend: 100 }), splat]))!;
  assert.ok(bentHatch.fill.points.length > 0 && hatchedBent.fill.points.length > 0);
  // A hatch bent after it was drawn has curved passes; a hatch drawn on the bent shape has straight ones.
  const curved = (part: Stroke): boolean => part.vector!.anchors.some((anchor) => anchor.hIn || anchor.hOut);
  assert.ok(curved(bentHatch.fill), 'the Warp after the Splatter bends its passes');
  assert.ok(!curved(hatchedBent.fill), 'the Splatter after the Warp draws straight passes');
  assert.ok(Math.min(...hatchedBent.fill.points.map((p) => p.y)) < 60, 'over the bent shape');
  assert.deepEqual(bentHatch.changed, { fill: true, stroke: true }, 'and the outline bends with the hatch');
});

// ---- Layers and groups -------------------------------------------------------------------

test('a group\'s Warp bends all it holds as one, over the box of all of it, and lets go when it goes', () => {
  const left = rect(undefined, { id: 'left', layer: 'ly_left' });
  const right = rect(undefined, {
    id: 'right',
    layer: 'ly_right',
    points: left.points.map((p) => ({ ...p, x: p.x + 300 })),
    vector: { anchors: left.vector!.anchors.map((a) => ({ p: { x: a.p.x + 300, y: a.p.y } })), closed: true },
  });
  const layers: Layer[] = [
    { id: 'grp', name: 'Logo', opacity: 1, visible: true, locked: false, group: true, effects: [warp({ style: 'chart', bend: 100 })] },
    { id: 'ly_left', name: 'Left', opacity: 1, visible: true, locked: false, parent: 'grp' },
    { id: 'ly_right', name: 'Right', opacity: 1, visible: true, locked: false, parent: 'grp' },
  ];
  const sketch = pageOf([left, right], layers);
  bindGeometry(sketch);
  // Chart rises to the right across the group's box, 100 to 600: the left mark's left edge stays, the right mark's right edge rises a whole half-height.
  const l = strokeBounds(left)!;
  const r = strokeBounds(right)!;
  assert.ok(Math.abs(l.maxY - 200) < 0.5, `the left mark's bottom-left corner stays: ${JSON.stringify(l)}`);
  assert.ok(r.minY < 60, `the right mark rose with the group's box: ${JSON.stringify(r)}`);
  assert.equal(geometryOf(left)?.whole?.vector?.anchors.length, 4);

  // The hit test binds the sketch it is given: a click above the right mark's old top finds it.
  assert.equal(hitMark(sketch, { x: 550, y: 70 }, { tolerancePx: 2, zoom: 1 })?.id, 'right');

  // Expand Appearance on the group bakes its Warp into the marks.
  const baked = expandLayerWarps(sketch, new Set(['grp']));
  assert.deepEqual(baked.map((item) => [item.id, item.marks.length]), [['left', 1], ['right', 1]]);
  assert.ok(Math.min(...baked[1].marks[0].points.map((p) => p.y)) < 60);

  // Without the Warp, a bind lets the marks go back.
  layers[0].effects = undefined;
  bindGeometry(sketch);
  assert.equal(geometryOf(right), null);
  assert.equal(strokeBounds(right)!.minY, 100);
});

test('nested warps work from the inside out: the outer group bends what the inner one drew', () => {
  const mark = rect(undefined, { id: 'm', layer: 'ly_m' });
  const layers: Layer[] = [
    { id: 'outer', name: 'Outer', opacity: 1, visible: true, locked: false, group: true, effects: [warp({ style: 'chart', bend: 100 })] },
    { id: 'inner', name: 'Inner', opacity: 1, visible: true, locked: false, group: true, parent: 'outer', effects: [warp({ style: 'arch', bend: 100 })] },
    { id: 'ly_m', name: 'Mark', opacity: 1, visible: true, locked: false, parent: 'inner' },
  ];
  bindGeometry(pageOf([mark], layers));
  // The Arch lifts the top's middle to 50; the Chart, over the arched box, 50 to 200,
  // lifts the right side 75: the top's lowest point is then 20, three fifths of the way right.
  // The other way round, the top would reach 12.5.
  const box = strokeBounds(mark)!;
  assert.ok(Math.abs(box.minY - 20) < 1 && Math.abs(box.maxY - 200) < 0.5, JSON.stringify(box));
});

// ---- Expand Appearance ------------------------------------------------------------------------

test('Expand Appearance bakes a Warp into the mark\'s own anchors, as one mark, raster effects left live', () => {
  const mark = rect([warp({ style: 'arc', bend: 50 }), { type: 'blur', radius: 2 }]);
  const expanded = expandAppearance(mark)!;
  assert.equal(expanded.marks.length, 1, 'a bend leaves one mark');
  const [baked] = expanded.marks;
  assert.deepEqual(baked.effects?.map((effect) => effect.type), ['blur']);
  assert.ok(baked.vector!.anchors.length >= 4 && baked.vector!.anchors.length <= 8, `few anchors: ${baked.vector!.anchors.length}`);
  assert.ok(baked.vector!.anchors.some((anchor) => anchor.hIn && anchor.hOut), 'its edges curved');
  // Aimed at the fill, the fill bends alone and the mark becomes its two parts.
  const parted = expandAppearance(rect([warp({ style: 'arch', bend: 100, target: 'fill' })]))!;
  assert.equal(parted.marks.length, 2);
  assert.ok(parted.marks[0].fill && Math.min(...parted.marks[0].points.map((p) => p.y)) < 60);
  assert.equal(Math.min(...parted.marks[1].points.map((p) => p.y)), 100);
});

// ---- The outputs -----------------------------------------------------------------------------

test('every output draws the bent mark: the SVG with what it stands for, PDF, the Illustrator script and the PNG', () => {
  const sketch = pageOf([rect([warp({ style: 'arch', bend: 100 })])]);
  const svg = sketchToSvg(sketch);
  const path = svg.split('\n').find((row) => row.includes('data-tool="pen"'))!;
  assert.match(path, /data-d="M100 100H300V200H100V100Z"/, 'the mark it stands for, for napkin to read back');
  assert.match(path, /data-fill="#ffe08a"/);
  assert.match(path, /&quot;type&quot;:&quot;warp&quot;/, 'and its live Warp');
  assert.match(path, / d="M100 100[cC]/, 'drawn as it is bent: its top a curve');
  assert.equal((path.match(/data-d=/g) ?? []).length, 1, 'each source attribute said once');

  const warnings: string[] = [];
  const pdf = sketchesToPdf([sketch], { onWarning: (message: string) => warnings.push(message) });
  // The PDF draws a mark through its sampled points: the bent top's middle, 50 down the page, is 250 up it.
  assert.match(pdf, /200\.00 250\.00 l/, 'the PDF draws the bent top');
  assert.deepEqual(warnings, [], 'and leaves nothing out');

  const jsx = sketchesToJsx([sketch]);
  // Four anchors, the top's two handles a third of the way along and risen: the arch is one curve.
  assert.match(jsx, /path\(\[\[\[100, 100, 100, 100, 166\.67, 33\.33, 0\], \[300, 100, 233\.33, 33\.33, 300, 100, 0\],/, 'the Illustrator script builds the bent path on its anchors');
  assert.doesNotMatch(jsx, /Warp/, 'and says nothing was left out');

  const { width, data } = rasterizeComposition(sketchToComposition(sketch));
  const pixel = (x: number, y: number): number[] => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.ok(pixel(200, 70)[2] < 200, `the PNG fills above where the top was: ${pixel(200, 70)}`);
  assert.deepEqual(pixel(200, 190), [255, 255, 255, 255], 'and leaves the paper below the bent bottom');
});

test('a group\'s Warp is written on the group, and its marks carry what they stand for', () => {
  const layers: Layer[] = [
    { id: 'grp', name: 'Logo', opacity: 1, visible: true, locked: false, group: true, effects: [warp({ style: 'arch', bend: 60 })] },
    { id: 'ly_rect', name: 'Card', opacity: 1, visible: true, locked: false, parent: 'grp' },
  ];
  const svg = sketchToSvg(pageOf([rect(undefined)], layers));
  assert.match(svg, /<g[^>]*data-name="Logo"[^>]*data-effects="[^"]*warp/, 'the Warp on the group');
  const path = svg.split('\n').find((row) => row.includes('data-tool="pen"'))!;
  assert.match(path, /data-d="M100 100H300V200H100V100Z"/, 'the mark as it was, for the group to bend again');
  assert.doesNotMatch(path, /data-effects/, 'with no Warp of its own');
});

test('an element of the compose API takes no Warp: it is left out and said so', () => {
  const design = createComposition({ width: 100, height: 100, background: null });
  design.rect({ x: 20, y: 20, width: 40, height: 40, fill: '#000000', effects: [warp()] });
  assert.deepEqual(renderPng(design.toDocument()).warnings, ["rect: Warp draws on a sketch's marks, not on an element, and was left out"]);
});

// ---- The script ------------------------------------------------------------------------------------

test('`effect warp` reads a style by either name, a bend with or without a percent sign, and writes back as little as says it', () => {
  const run = (text: string): Sketch => {
    const result = evaluate(text, { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
    assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
    return result.book.sketches[0];
  };
  const effectOf = (text: string): Effect | undefined => run(`${text}\nrect 10 10 100 60`).strokes[0].effects?.[0];
  assert.deepEqual(effectOf('effect warp arc'), defaultEffect('warp'));
  assert.deepEqual(effectOf('effect warp bulge bend 30%'), { ...defaultEffect('warp'), style: 'unroll', bend: 30 });
  assert.deepEqual(effectOf('effect warp arc-lower bend -40 vertical'), { ...defaultEffect('warp'), bend: -40, orientation: 'vertical', part: 'lower' });
  assert.deepEqual(effectOf('effect warp shell distort 20% -10 part upper on fill'), {
    ...defaultEffect('warp'),
    style: 'shell',
    distortH: 20,
    distortV: -10,
    part: 'upper',
    target: 'fill',
  });
  const bad = evaluate('effect warp arc bend 150\nrect 0 0 1 1', { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
  assert.deepEqual(bad.diagnostics.map((d) => d.code), ['invalid-value']);
  const sign = evaluate('effect hue-rotate 30%\nrect 0 0 1 1', { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
  assert.deepEqual(sign.diagnostics.map((d) => d.code), ['expected-number'], 'a number that is no percent still takes no percent sign');

  // On a group, the group takes it: its marks bend as one.
  const grouped = run('effect warp chart bend 80\ngroup "Logo" {\n  rect 10 10 100 60\n  rect 150 10 100 60\n}');
  assert.equal(grouped.layers.find((layer) => layer.name === 'Logo' && layer.group)?.effects?.[0]?.type, 'warp');

  // Written back: the style, and only what differs from the Warp Options' own.
  const written = formatScript(sketchToInstructions(run('effect warp shell bend 50 part upper\nrect 10 10 100 60\neffect warp twirl bend -20 vertical distort 10\nrect 150 10 100 60')).script);
  assert.match(written, /^effect warp shell part upper$/m);
  assert.match(written, /^effect warp twirl bend -20 vertical distort 10$/m);
});
