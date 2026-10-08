/**
 * Splatter, a vector editor's Scribble: the hatch engine (core/splatter.ts),
 * the effect in the model, the parts a splattered mark draws
 * (core/geometry-effects.ts) - its bounds, its hits and Expand Appearance -
 * every output, and the script's `effect splatter`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Vec } from '../src/core/boolean.js';
import {
  matchingPreset,
  SPLATTER_PRESET_NAMES,
  SPLATTER_PRESETS,
  splatterAnchors,
  splatterPaths,
  splatterPresetOf,
  type SplatterOptions,
} from '../src/core/splatter.js';
import { activeEffects, activeGeometryEffects, defaultEffect, readEffect, scaleEffects, type Effect } from '../src/core/effects.js';
import { effectFieldValue, effectsAfterTransform, expandAppearance, markEffectPlan, withEffectField } from '../src/core/appearance.js';
import { drawnPart, geometryParts } from '../src/core/geometry-effects.js';
import { strokeBounds } from '../src/core/bounds.js';
import { hitMark } from '../src/core/hit-test.js';
import { sampleAnchors } from '../src/core/path-data.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { compositionToSvg, createComposition, decodePng, rasterizeComposition, renderPng } from '../src/core/graphic-design/index.js';
import { evaluate, formatDiagnostic, formatScript } from '../src/core/script/index.js';
import { sketchToInstructions } from '../src/core/script/writer.js';
import { createSketchBook, type Layer, type Point, type Sketch, type Stroke, type VectorAnchor } from '../src/core/types.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const TIME = '2026-10-02T00:00:00.000Z';

/** A square region, counterclockwise on the page. */
const square = (x: number, y: number, size: number): Vec[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

/** Options with no variation at all, so every fold sits exactly where the rules put it. */
const exact = (extra: Partial<SplatterOptions> = {}): SplatterOptions => ({
  angle: 0,
  overlap: 0,
  overlapVariation: 0,
  width: 2,
  curviness: 0,
  curvinessVariation: 0,
  spacing: 10,
  spacingVariation: 0,
  seed: 1,
  ...extra,
});

const all = (paths: VectorAnchor[][]): VectorAnchor[] => paths.flat();

// ---- The engine ----------------------------------------------------------------------------

test('at 0 degrees, the hatch folds at the square\'s left and right edges, a spacing apart, in one run', () => {
  const paths = splatterPaths([square(0, 0, 100)], exact());
  assert.equal(paths.length, 1, 'a square is one run');
  const anchors = paths[0];
  assert.equal(anchors.length, 10, 'ten scanlines, 5 to 95');
  anchors.forEach((a, k) => {
    assert.ok(Math.abs(a.p.x - (k % 2 === 0 ? 0 : 100)) < 1e-9, `fold ${k} on its edge (${a.p.x})`);
    assert.ok(Math.abs(a.p.y - (5 + 10 * k)) < 1e-9, `fold ${k} on its scanline (${a.p.y})`);
    assert.ok(!a.hIn && !a.hOut, 'no curviness, no handles');
  });
});

test('at 45 degrees, every fold is on the square\'s edge, and the passes run at the angle', () => {
  const anchors = all(splatterPaths([square(0, 0, 100)], exact({ angle: 45 })));
  assert.ok(anchors.length > 10);
  const onEdge = (p: { x: number; y: number }): boolean =>
    [p.x, p.y, 100 - p.x, 100 - p.y].some((d) => Math.abs(d) < 1e-6) && p.x > -1e-6 && p.x < 100 + 1e-6 && p.y > -1e-6 && p.y < 100 + 1e-6;
  for (const a of anchors) assert.ok(onEdge(a.p), `(${a.p.x.toFixed(2)}, ${a.p.y.toFixed(2)}) is on the edge`);
  // Folds on the same side, two scanlines apart, step along the hatch's normal:
  // at 45 degrees counterclockwise, the hatch runs up and to the right, so the
  // folds of one side march down and to the right.
  const a = anchors[2].p;
  const b = anchors[4].p;
  const along = (b.x - a.x) * Math.cos(Math.PI / 4) - (b.y - a.y) * Math.sin(Math.PI / 4);
  assert.ok(Math.abs(along) > 0, 'they are not on one scanline');
});

test('a positive overlap carries each fold past the edge, and a negative one holds it short', () => {
  const out = splatterPaths([square(0, 0, 100)], exact({ overlap: 6 }))[0];
  out.forEach((a, k) => assert.ok(Math.abs(a.p.x - (k % 2 === 0 ? -6 : 106)) < 1e-9, `fold ${k} 6 past (${a.p.x})`));
  const short = splatterPaths([square(0, 0, 100)], exact({ overlap: -6 }))[0];
  short.forEach((a, k) => assert.ok(Math.abs(a.p.x - (k % 2 === 0 ? 6 : 94)) < 1e-9, `fold ${k} 6 short (${a.p.x})`));
  // Held short of the edge by more than half the span, a fold stops at the middle.
  const tiny = splatterPaths([square(0, 0, 10)], exact({ overlap: -20, spacing: 3 }))[0];
  for (const a of tiny) assert.ok(Math.abs(a.p.x - 5) < 1e-9, 'never past its span\'s middle');
});

test('curviness rounds every turn with handles along it, and none at the ends', () => {
  const anchors = splatterPaths([square(0, 0, 100)], exact({ curviness: 50 }))[0];
  assert.ok(!anchors[0].hIn && !anchors[0].hOut, 'the first anchor ends the path');
  assert.ok(!anchors.at(-1)!.hIn && !anchors.at(-1)!.hOut, 'and the last');
  for (const a of anchors.slice(1, -1)) {
    assert.ok(a.hIn && a.hOut, 'a turn has both handles');
    // Collinear, either side of the fold, the turn's tangent along the scanlines' normal.
    assert.ok(Math.abs(a.hIn.x - a.p.x) < 1e-9 && Math.abs(a.hOut.x - a.p.x) < 1e-9);
    assert.ok(Math.abs(a.p.y - a.hIn.y - (a.hOut.y - a.p.y)) < 1e-9, 'equal lengths: a smooth turn');
    assert.ok(Math.abs(a.hOut.y - a.p.y - 10) < 1e-9, 'at 50%, one spacing long');
  }
});

test('the variations come from the seed: the same seed draws the same hatch, another one another', () => {
  const varied = (seed: number): SplatterOptions => ({ ...SPLATTER_PRESETS.default, seed });
  const once = splatterPaths([square(0, 0, 120)], varied(7));
  assert.deepEqual(splatterPaths([square(0, 0, 120)], varied(7)), once);
  assert.notDeepEqual(splatterPaths([square(0, 0, 120)], varied(8)), once);
});

test('a donut\'s hole stays empty: the hatch splits round it into runs, and no pass crosses it', () => {
  // The outer square counterclockwise, the hole clockwise: non-zero leaves it out.
  const hole: Vec[] = [
    { x: 30, y: 30 },
    { x: 30, y: 70 },
    { x: 70, y: 70 },
    { x: 70, y: 30 },
  ];
  const paths = splatterPaths([square(0, 0, 100), hole], exact({ spacing: 4 }));
  assert.ok(paths.length >= 3, `a run above, one each side, one below (${paths.length})`);
  for (const run of paths) {
    for (const p of sampleAnchors(run, false)) {
      assert.ok(!(p.x > 31 && p.x < 69 && p.y > 31 && p.y < 69), `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is in the hole`);
    }
  }
  const compound = splatterAnchors([square(0, 0, 100), hole], exact({ spacing: 4 }));
  assert.equal(compound.filter((a) => a.move).length, paths.length - 1, 'one compound path, a pen lift between runs');
});

test('nothing to hatch draws nothing', () => {
  assert.deepEqual(splatterPaths([], exact()), []);
  assert.deepEqual(splatterPaths([[{ x: 0, y: 0 }, { x: 10, y: 0 }]], exact()), []);
});

test('every preset reads by its name, any case, and its values say which it is', () => {
  for (const name of SPLATTER_PRESET_NAMES) {
    assert.equal(splatterPresetOf(name.toUpperCase()), name);
    assert.equal(matchingPreset(SPLATTER_PRESETS[name]), name);
  }
  assert.equal(splatterPresetOf('Zig-zag'), 'zig-zag');
  assert.equal(splatterPresetOf('nope'), undefined);
  assert.equal(matchingPreset({ ...SPLATTER_PRESETS.dense, width: 9 }), undefined);
  assert.deepEqual(
    { ...SPLATTER_PRESETS.default },
    { angle: 30, overlap: 0, overlapVariation: 5, width: 3, curviness: 5, curvinessVariation: 1, spacing: 5, spacingVariation: 0.5 },
    "a vector editor's own Default",
  );
});

// ---- The effect -------------------------------------------------------------------------------

test('a Splatter reads with its defaults filled in, its angle shown from -180 to 180, and is no raster effect', () => {
  const read = readEffect({ type: 'splatter', angle: 270, width: 4 });
  assert.ok(read && read.type === 'splatter');
  assert.equal(read.angle, -90);
  assert.equal(read.width, 4);
  assert.equal(read.spacing, SPLATTER_PRESETS.default.spacing);
  assert.equal(readEffect({ type: 'splatter', width: 0 }), null, 'a hatch with no line is no effect');
  const list: Effect[] = [{ type: 'blur', radius: 2 }, defaultEffect('splatter')];
  assert.deepEqual(activeEffects(list)?.map((e) => e.type), ['blur'], 'the raster paths never see it');
  assert.deepEqual(activeGeometryEffects(list)?.map((e) => e.type), ['splatter']);
});

test('a Splatter scales its lengths, turns its angle and mirrors it with its mark', () => {
  const splatter = { ...defaultEffect('splatter'), angle: 30 };
  const [scaled] = scaleEffects([splatter], 2) as typeof splatter[];
  assert.deepEqual([scaled.width, scaled.spacing, scaled.overlapVariation, scaled.curviness], [6, 10, 10, 5], 'a percent does not scale');
  const turn = (t: Parameters<typeof effectsAfterTransform>[1]): number => (effectsAfterTransform([splatter], t)[0] as typeof splatter).angle;
  assert.equal(turn({ rotate: 90 }), -60, 'counterclockwise, as the page turns clockwise');
  assert.equal(turn({ flipX: true }), 150);
  assert.equal(turn({ flipY: true }), -30);
  assert.equal(turn({ rotate: -170 }), -160);
});

test('the options form reads the preset the values match, and a preset sets them all', () => {
  const effect = defaultEffect('splatter');
  assert.equal(effectFieldValue(effect, 'preset'), 'default');
  const loose = withEffectField(effect, 'preset', 'loose') as typeof effect;
  assert.equal(loose.spacing, SPLATTER_PRESETS.loose.spacing);
  assert.equal(loose.seed, effect.seed, 'the seed stays');
  assert.equal(effectFieldValue({ ...loose, width: 9 }, 'preset'), '', 'changed by hand, it is Custom');
});

// ---- A splattered mark ------------------------------------------------------------------------------

const pts = (list: Array<[number, number]>): Point[] => list.map(([x, y]) => ({ x, y, pressure: 0.5 }));

/** A filled square mark with an outline, and whatever effects it is given. */
const card = (effects: Effect[], extra: Partial<Stroke> = {}): Stroke => ({
  id: 'card',
  layer: 'ly_card',
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill: '#2f6feb',
  points: pts([[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]),
  effects,
  ...extra,
});

const pageOf = (...strokes: Stroke[]): Sketch => {
  const book = createSketchBook('splatter');
  const sketch = book.sketches[0];
  sketch.background = '#ffffff';
  sketch.sizeMode = 'sized';
  sketch.width = 300;
  sketch.height = 300;
  sketch.layers = strokes.map((s): Layer => ({ id: s.layer ?? `ly_${s.id}`, name: s.id, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes;
  return sketch;
};

const splat = (extra: Partial<SplatterOptions & { target: 'fill' | 'stroke' }> = {}): Effect => ({ ...defaultEffect('splatter'), ...exact({ spacing: 8, width: 3 }), ...extra }) as Effect;

test('a splattered fill draws as a hatch in the fill\'s color, under the outline as it always was', () => {
  const mark = card([splat()]);
  const parts = geometryParts(mark);
  assert.ok(parts);
  assert.deepEqual(parts.changed, { fill: true, stroke: false });
  assert.equal(parts.fill.color, '#2f6feb', 'the hatch is the fill\'s color');
  assert.equal(parts.fill.width, 3, 'at the Splatter\'s width');
  assert.equal(parts.fill.fill, undefined, 'a line, not a fill');
  assert.ok(parts.fill.points.every((p) => p.pressure === 1), 'at full pressure, so a pen draws its whole width');
  assert.equal(parts.stroke.fill, undefined);
  assert.equal(parts.stroke.color, '#1f2328', 'the outline as it was');
  assert.equal(geometryParts(mark), parts, 'kept while nothing changes');
  mark.points[0].x = 90;
  assert.notEqual(geometryParts(mark), parts, 'worked out again when a point moves in place');
  assert.equal(markEffectPlan(card([splat()]))?.split, true, 'a mark a Splatter draws always draws its parts apart');
  assert.equal(geometryParts(card([{ ...splat(), on: false }])), null, 'switched off, it draws nothing new');
});

test('aimed at the stroke, a Splatter hatches the stroke\'s ink in its color, and the fill stays a fill', () => {
  const mark = card([splat({ target: 'stroke' })], { width: 16 });
  const parts = geometryParts(mark)!;
  assert.deepEqual(parts.changed, { fill: false, stroke: true });
  assert.equal(parts.stroke.color, '#1f2328');
  assert.equal(parts.fill.fill, '#2f6feb');
  assert.equal(drawnPart(mark, 'fill').fill, '#2f6feb');
  // The hatch stays within the ink: the square's outline, 8 wide either side.
  for (const p of parts.stroke.points) assert.ok(p.x > 90 && p.x < 210 && p.y > 90 && p.y < 210);
});

test('a gradient fill\'s hatch is the hatch\'s outline, filled with the gradient', () => {
  const gradient = { type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };
  const parts = geometryParts(card([splat()], { gradient }))!;
  assert.deepEqual(parts.fill.gradient, gradient);
  assert.equal(parts.fill.noStroke, true);
  assert.ok(parts.fill.points.length > 20);
});

test('a mark\'s bounds take in a hatch carried past its edge, and a click finds it where the hatch is', () => {
  const plain = strokeBounds(card([]))!;
  const carried = strokeBounds(card([splat({ overlap: 10 })]))!;
  assert.ok(carried.minX <= plain.minX - 10 + 1e-6 && carried.maxX >= plain.maxX + 10 - 1e-6, JSON.stringify({ plain, carried }));
  const sketch = pageOf(card([splat({ overlap: 10, spacing: 30 })]));
  const hit = (x: number, y: number): string | null => hitMark(sketch, { x, y }, { zoom: 1, tolerancePx: 1 })?.id ?? null;
  // The first fold is 10 past the left edge, on the first scanline (y 115).
  assert.equal(hit(91, 115), 'card', 'on the hatch past the edge');
  // Midway between the first two passes, inside the square, where the fill no longer paints.
  assert.equal(hit(150, 145), null, 'between the passes, nothing');
  assert.equal(hit(100, 160), 'card', 'on the outline');
});

test('Expand Appearance turns a splattered mark into its outline and a run of the hatch each, raster effects where they were aimed', () => {
  const glow: Effect = { ...defaultEffect('outer-glow'), target: 'fill' };
  const blur: Effect = { type: 'blur', radius: 1 };
  const hole: Point[] = pts([[130, 130], [130, 170], [170, 170], [170, 130], [130, 130]]).map((p, i) => (i === 0 ? { ...p, move: true as const } : p));
  const mark = card([splat({ spacing: 6 }), glow, blur], { opacity: 0.5, points: [...card([]).points, ...hole] });
  const expanded = expandAppearance(mark);
  assert.ok(expanded);
  const hatch = expanded.marks.filter((m) => m.color === '#2f6feb');
  const outline = expanded.marks.filter((m) => m.color === '#1f2328');
  assert.ok(hatch.length >= 3, `a run each round the hole (${hatch.length})`);
  assert.equal(outline.length, 1);
  assert.equal(expanded.marks.at(-1), outline[0], 'the outline on top');
  for (const run of hatch) {
    assert.ok(run.vector && !run.vector.closed && run.vector.anchors.length >= 2, 'an open mark of anchors');
    assert.deepEqual(run.effects?.map((e) => [e.type, e.target ?? 'object']), [['outer-glow', 'object']], 'the fill\'s glow, on the fill\'s marks');
    assert.notEqual(run.id, mark.id, 'a mark of its own');
  }
  assert.equal(outline[0].effects, undefined, 'nothing was aimed at the stroke');
  assert.equal(outline[0].fill, undefined, 'the outline alone');
  assert.deepEqual(expanded.effects.map((e) => e.type), ['blur'], 'the whole mark\'s effects, for the group');
  assert.equal(expanded.opacity, 0.5, 'and its opacity');
});

// ---- The outputs --------------------------------------------------------------------------------------

test('every output draws the hatch: SVG keeps the source to read it back, PDF, the Illustrator script and the PNG draw it', () => {
  const sketch = pageOf(card([splat()]));
  const svg = sketchToSvg(sketch);
  assert.match(svg, /data-napkin-split="1"/, 'the mark as its two parts');
  assert.match(svg, /data-napkin-part="fill"[^>]*stroke="#2f6feb"|stroke="#2f6feb"[^>]*data-napkin-part="fill"/, 'the hatch stroked in the fill\'s color');
  assert.match(svg, /data-fill="#2f6feb"/, 'and carrying the fill it stands for');
  assert.match(svg, /&quot;type&quot;:&quot;splatter&quot;/, 'the live effect in data-effects');

  // The fill's blue, 0.1843 0.4353 0.9216: a stroke color (RG) for the hatch, never a fill (rg).
  const warnings: string[] = [];
  const pdf = sketchesToPdf([sketch], { onWarning: (message: string) => warnings.push(message) });
  assert.match(pdf, /0\.1843 0\.4353 0\.9216 RG\n3 w/, 'the PDF strokes the hatch in the fill\'s color, at its width');
  assert.doesNotMatch(pdf, /0\.1843 0\.4353 0\.9216 rg/, 'and fills nothing with it');
  assert.match(sketchesToPdf([pageOf(card([]))]), /0\.1843 0\.4353 0\.9216 rg/, 'as the plain card does');
  assert.deepEqual(warnings, [], 'and leaves nothing out');

  const jsx = sketchesToJsx([sketch]);
  assert.match(jsx, /path\(\[\[\[100, \d+\], \[200, \d+\],[^\n]*false, \{stroke: \[47, 111, 235\], width: 3\}\);/, 'the Illustrator script draws the hatch, open, in the fill\'s color');
  assert.doesNotMatch(jsx, /fill: \[47, 111, 235\]/, 'and fills nothing with it');
  assert.doesNotMatch(jsx, /Splatter/, 'and leaves nothing out');

  const { width, data } = rasterizeComposition(sketchToComposition(sketch));
  const at = (x: number, y: number): number[] => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  const blue = (c: number[]): boolean => c[2] > 200 && c[0] < 120;
  let inked = 0;
  let paper = 0;
  for (let y = 110; y < 190; y++) {
    const c = at(150, y);
    if (blue(c)) inked++;
    else if (c[0] > 240 && c[1] > 240 && c[2] > 240) paper++;
  }
  assert.ok(inked > 10 && paper > 10, `down the middle, hatch and paper between (${inked} inked, ${paper} paper)`);
});

test('a hatched Copic or Pencil line carries the tool\'s own source in the SVG, so it reads back as the mark it was', () => {
  const line = (id: string, extra: Partial<Stroke>): Stroke => ({
    id,
    layer: `ly_${id}`,
    tool: 'pen',
    color: '#2a9d4b',
    width: 14,
    points: pts([[40, 150], [260, 150]]),
    effects: [splat({ target: 'stroke' })],
    ...extra,
  });
  const smudges = [{ path: [{ p: { x: 60, y: 150 } }, { p: { x: 120, y: 150 } }], width: 20, strength: 0.5 }];
  const svg = sketchToSvg(
    pageOf(
      line('nib', { tool: 'copic', nibAngle: 30 }),
      line('lead', { tool: 'pencil', pencil: { medium: 'graphite', grade: '2B' }, smudges } as Partial<Stroke>),
    ),
  );
  const strokeParts = svg.split('\n').filter((row) => row.includes('data-napkin-part="stroke"'));
  assert.equal(strokeParts.length, 2, 'each line\'s hatch, as its stroke part');
  const [copic, pencil] = strokeParts;
  assert.match(copic, /data-tool="copic"/, 'the Copic\'s hatch names its tool');
  assert.match(copic, /data-pts="40,150 260,150"/, 'and carries its centreline, as a Copic\'s own markup does');
  assert.match(copic, /data-nib="30"/, 'and its nib');
  assert.doesNotMatch(copic, /data-d=/, 'not a centreline the importer would read as a pen');
  assert.match(pencil, /data-tool="pencil"/, 'the Pencil\'s hatch names its tool');
  assert.match(pencil, /data-d="M40 150H260"/, 'and carries its centreline');
  assert.match(pencil, /data-pencil="2B"/, 'and its lead');
  assert.match(pencil, /data-smudges="\[\{&quot;path&quot;/, 'and its smudges');
});

test('an element of the compose API takes no Splatter: it is left out and said so, and the element draws as it is', () => {
  const design = createComposition({ width: 100, height: 100, background: null });
  design.rect({ x: 20, y: 20, width: 40, height: 40, fill: '#000000', effects: [splat()] });
  const doc = design.toDocument();
  const { data, width, warnings } = renderPng(doc);
  assert.deepEqual(warnings, ["rect: Splatter draws on a sketch's marks, not on an element, and was left out"]);
  const image = decodePng(data);
  const at = (x: number, y: number): number[] => [...image.data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(at(40, 40), [0, 0, 0, 255], 'solid, as without it');
  assert.doesNotMatch(compositionToSvg(doc), /<filter/, 'and the SVG has no filter for it');
});

// ---- The script ------------------------------------------------------------------------------------------

test('`effect splatter` reads its preset and every option, writes back as little as says it, and reads again the same', () => {
  const text = [
    'layer "Scribbled"',
    'fill #8ab4ff',
    'effect splatter preset sketch angle 45 overlap 2 1 seed 7',
    'rect 40 40 160 120',
    'effect splatter width 4 curviness 30 10 spacing 6 2 on stroke',
    'circle 300 100 50',
  ].join('\n');
  const first = evaluate(text, { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
  assert.deepEqual(first.diagnostics.map((d) => formatDiagnostic(d)), []);
  const [rect, circle] = first.book.sketches[0].strokes;
  const a = rect.effects?.[0];
  assert.ok(a && a.type === 'splatter');
  assert.deepEqual(
    [a.angle, a.overlap, a.overlapVariation, a.width, a.spacing, a.seed],
    [45, 2, 1, SPLATTER_PRESETS.sketch.width, SPLATTER_PRESETS.sketch.spacing, 7],
  );
  const b = circle.effects?.[0];
  assert.ok(b && b.type === 'splatter' && b.target === 'stroke');
  assert.deepEqual([b.width, b.curviness, b.curvinessVariation, b.spacing, b.spacingVariation], [4, 30, 10, 6, 2]);

  const written = formatScript(sketchToInstructions(first.book.sketches[0]).script);
  assert.match(written, /^effect splatter angle 45 overlap 2 1 width 1 curviness 2 5 spacing 3 1 seed 7$|^effect splatter preset sketch/m);
  const again = evaluate(written, { timestamp: TIME, ...SCRIPT_FIXTURES });
  assert.deepEqual(again.diagnostics.map((d) => formatDiagnostic(d)), []);
  assert.deepEqual(again.book.sketches[0].strokes.map((s) => s.effects), first.book.sketches[0].strokes.map((s) => s.effects));

  const plain = evaluate('effect splatter\nrect 0 0 10 10', { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
  const written2 = formatScript(sketchToInstructions(plain.book.sketches[0]).script);
  assert.match(written2, /^effect splatter$/m, 'a Default Splatter with its seed is the bare line');
  const preset = evaluate('effect splatter preset swash seed 9\nrect 0 0 10 10', { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
  assert.match(formatScript(sketchToInstructions(preset.book.sketches[0]).script), /^effect splatter preset swash seed 9$/m, 'a preset is named');
});
