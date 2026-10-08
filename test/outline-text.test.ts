/**
 * Text as shapes (src/core/type/outline.ts), on the fixture fonts in
 * test/fonts/: outlines land where the layout set each glyph; an o keeps its
 * counter as a hole; a text along a path follows the path's tangent; the
 * frame's paint, a highlight and an underline come out as shapes too; a run
 * of one color merges for a Warp, and every glyph for 3D; the font files'
 * own measure sets the layout by their advances and kerning; and what cannot
 * be drawn is said, with its font.
 *
 * At 20.48 px a 2048-unit em is 0.01 px a unit, so every place is the font's
 * own number moved two places.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { layoutType } from '../src/core/type/layout.js';
import { HEADLESS_MEASURE } from '../src/core/type/measure.js';
import { applyChar, rectangleAnchors, withTypeset } from '../src/core/type/model.js';
import { facesFromFiles, fileOutlineSource, mergedByColor, mergedSolid, outlineText, sfntMeasure, type OutlineFaces } from '../src/core/type/outline.js';
import type { Stroke, VectorAnchor } from '../src/core/types.js';
import { repoRoot } from './helpers/repo-root.js';

const FONTS = join(repoRoot(), 'test', 'fonts');
const SANS = new Uint8Array(readFileSync(join(FONTS, 'napkin-test-sans.ttf')));
const CFF = new Uint8Array(readFileSync(join(FONTS, 'napkin-test-cff.otf')));
const faces = facesFromFiles({ 'Napkin Test Sans': SANS, 'Napkin Test CFF': CFF });
const measure = sfntMeasure(faces, HEADLESS_MEASURE);

const text = (value: string, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'tx',
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 10, y: 100, pressure: 0.5 }],
  text: value,
  fontSize: 20.48,
  fontFamily: 'Napkin Test Sans',
  ...extra,
});

const near = (actual: number, expected: number, what: string, within = 1e-6): void =>
  assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual}, not ${expected}`);

/** A compound path's subpaths: a `move` starts the next. */
function subpaths(anchors: readonly VectorAnchor[]): VectorAnchor[][] {
  const out: VectorAnchor[][] = [];
  for (const anchor of anchors) {
    if (anchor.move || out.length === 0) out.push([]);
    out[out.length - 1].push(anchor);
  }
  return out;
}

/** A contour's signed area by its anchors: the sign is the way it winds. */
function area(contour: readonly VectorAnchor[]): number {
  let sum = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i].p;
    const b = contour[(i + 1) % contour.length].p;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

test("the faces' own measure: widths are advances, kerned where the font kerns; the ascent is the font's share of the em", () => {
  const font = { family: 'Napkin Test Sans', style: 'Regular', size: 20.48, kerning: true, smallCaps: false };
  near(measure.width('AV', font), (1366 + 1366 - 152) * 0.01, 'A V kerned');
  near(measure.width('AV', { ...font, kerning: false }), 2732 * 0.01, 'A V not');
  near(measure.extent(font).ascent, (20.48 * 1854) / (1854 + 434), 'ascent');
  // A family the files do not have is measured as the built-in face measures it.
  const other = { ...font, family: 'Georgia' };
  assert.equal(measure.width('AV', other), HEADLESS_MEASURE.width('AV', other));
});

test("outlines land where the layout set each glyph: the T's corners, two places moved, from its origin", () => {
  const stroke = text('To');
  const layout = layoutType(stroke, measure);
  const [t, o] = layout.glyphs;
  // The o starts the T's advance on, less the pair's kerning: 1251 - 227 units.
  near(o.x - t.x, (1251 - 227) * 0.01, 'T o kerned');
  const out = outlineText(stroke, layout, faces);
  assert.equal(out.problem, null);
  const marks = out.marks!;
  assert.deepEqual(marks.map((m) => [m.kind, m.label]), [['glyph', 'T'], ['glyph', 'o']]);
  const corners = [[720, 1253], [720, 0], [530, 0], [530, 1253], [46, 1253], [46, 1409], [1204, 1409], [1204, 1253]];
  const anchors = marks[0].mark.vector!.anchors;
  assert.equal(anchors.length, corners.length);
  anchors.forEach((anchor, i) => {
    near(anchor.p.x, t.x + corners[i][0] * 0.01, `corner ${i} x`, 1e-9);
    near(anchor.p.y, t.y - corners[i][1] * 0.01, `corner ${i} y`, 1e-9);
  });
  const mark = marks[0].mark;
  assert.deepEqual([mark.tool, mark.fill, mark.color, mark.noStroke, mark.vector?.closed], ['pen', '#1f2328', '#1f2328', true, true]);
  assert.ok(mark.points.length >= anchors.length, 'sampled into points as a shape is');
});

test('an o keeps its counter: two subpaths, wound against each other, so the non-zero rule leaves a hole', () => {
  for (const family of ['Napkin Test Sans', 'Napkin Test CFF']) {
    const out = outlineText(text('o', { fontFamily: family }), layoutType(text('o', { fontFamily: family }), measure), faces);
    const rings = subpaths(out.marks![0].mark.vector!.anchors);
    assert.equal(rings.length, 2, family);
    assert.ok(Math.sign(area(rings[0])) === -Math.sign(area(rings[1])), `${family}: ${area(rings[0])} and ${area(rings[1])}`);
  }
});

test("a text along a path follows the path's tangent: down a straight path, the T's x runs along it and its height across it", () => {
  const stroke = withTypeset(text('T', { points: [{ x: 50, y: 50, pressure: 0.5 }] }), {
    kind: 'path',
    path: { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 0, y: 300 } }], start: 0, end: Number.MAX_SAFE_INTEGER, align: 'baseline', effect: 'rainbow' },
  });
  const layout = layoutType(stroke, measure);
  const glyph = layout.glyphs[0];
  const [a, b, c, d] = glyph.matrix;
  near(a, 0, 'the tangent is down the page', 1e-9);
  near(b, 1, 'the tangent is down the page', 1e-9);
  const corner = outlineText(stroke, layout, faces).marks![0].mark.vector!.anchors[5].p;
  // The T's corner (46, 1409): 0.46 along the path, 14.09 up from the baseline - against the matrix's down.
  near((corner.x - glyph.x) * a + (corner.y - glyph.y) * b, 0.46, 'along', 1e-9);
  near(-((corner.x - glyph.x) * c + (corner.y - glyph.y) * d), 14.09, 'across', 1e-9);
});

test("the frame's paint, a highlight and an underline are shapes too, bottom first as the canvas paints them", () => {
  let stroke = withTypeset(text('To'), { kind: 'area', frame: { anchors: rectangleAnchors(200, 60), fill: '#ffd43b', stroke: '#1f2328', width: 2 } });
  stroke = applyChar(stroke, { start: 0, end: 2 }, { underline: true, highlight: '#a5d8ff' });
  const out = outlineText(stroke, layoutType(stroke, measure), faces);
  const marks = out.marks!;
  assert.deepEqual(marks.map((m) => m.kind), ['frame', 'highlight', 'glyph', 'glyph', 'line']);
  const frame = marks[0].mark;
  assert.deepEqual([frame.fill, frame.color, frame.width, frame.noStroke], ['#ffd43b', '#1f2328', 2, undefined]);
  assert.equal(marks[1].mark.fill, '#a5d8ff');
  assert.equal(marks[4].label, 'Underline');
  assert.equal(marks[4].mark.vector!.anchors.length, 4, 'a band of four corners');
});

test('a run of one color is one mark for a Warp to bend; 3D builds every glyph as one', () => {
  const stroke = applyChar(text('ToTo'), { start: 2, end: 4 }, { color: '#d1242f' });
  const marks = outlineText(stroke, layoutType(stroke, measure), faces).marks!;
  const merged = mergedByColor(marks, stroke);
  assert.deepEqual(merged.map((m) => m.fill), ['#1f2328', '#d1242f']);
  assert.equal(subpaths(merged[0].vector!.anchors).length, 3, 'the T, and the o with its counter');
  const solid = mergedSolid(marks, stroke)!;
  assert.equal(subpaths(solid.vector!.anchors).length, 6);
  assert.equal(solid.fill, '#1f2328', 'in the first color');
});

test('what cannot be drawn is said with its font, and draws nothing', () => {
  const missing = outlineText(text('TZ'), layoutType(text('TZ'), measure), faces);
  assert.deepEqual(missing, { marks: null, problem: 'Napkin Test Sans has no glyph for "Z" (U+005A)', waiting: false });
  const unread: OutlineFaces = { face: () => null };
  const waiting = outlineText(text('T'), layoutType(text('T'), measure), unread);
  assert.match(waiting.problem ?? '', /Napkin Test Sans has not been read yet/);
  assert.equal(waiting.waiting, true, 'a face not read yet is only waiting');
  const broken = facesFromFiles({ 'Napkin Test Sans': new Uint8Array([1, 2, 3, 4]) });
  assert.match(outlineText(text('T'), layoutType(text('T'), measure), broken).problem ?? '', /^Napkin Test Sans: /);
  // Spaces draw nothing, and are no problem.
  assert.deepEqual(outlineText(text('T T'), layoutType(text('T T'), measure), faces).marks!.map((m) => m.label), ['T', 'T']);
});

test("a family list is read in order, the first family given drawing the text; a source carries the faces and their measure", () => {
  const listed = text('o', { fontFamily: '"Not Given", Napkin Test CFF, serif' });
  const out = outlineText(listed, layoutType(listed, measure), faces);
  assert.equal(subpaths(out.marks![0].mark.vector!.anchors).length, 2);
  const source = fileOutlineSource({ 'Napkin Test Sans': SANS }, HEADLESS_MEASURE);
  assert.deepEqual(source.families, ['napkin test sans']);
  assert.notEqual(source.id, fileOutlineSource({ 'Napkin Test Sans': SANS }, HEADLESS_MEASURE).id, 'each source its own id');
  near(source.measure.width('T', { family: 'Napkin Test Sans', style: 'Regular', size: 20.48, kerning: true, smallCaps: false }), 12.51, 'its measure');
});
