/**
 * The type layout (src/core/type/layout.ts), with a measure whose every
 * character is half an em wide, so each place can be worked out by hand:
 * point type's lines, alignment and box; area type in a circle, overset and
 * a box that grows; path type on a straight line landing where point type
 * does, flipped, and each effect's rule for turning; vertical columns;
 * justification; lists; superscripts, small caps and kerning; hyphenation;
 * decorations; and the stretches a painter sets as one string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { glyphCorners, layoutType, SCRIPT_SHIFT, SCRIPT_SIZE, SMALL_CAPS_SIZE, typeSpans, type TypeLayout } from '../src/core/type/layout.js';
import type { TypeMeasure } from '../src/core/type/measure.js';
import { applyChar, applyPara, withTypeset, type TypeSpec } from '../src/core/type/model.js';
import type { Stroke, VectorAnchor } from '../src/core/types.js';

/** Every character half an em wide, `AV` kerned a tenth of an em closer; ascent 0.8 em, descent 0.2. */
const FIXED: TypeMeasure = {
  id: 'fixed',
  exact: true,
  smallCaps: false,
  width(text, font) {
    let width = 0;
    for (const _ of text) width += font.size * 0.5;
    if (font.kerning && text === 'AV') width -= font.size * 0.1;
    return width;
  },
  extent(font) {
    return { ascent: font.size * 0.8, descent: font.size * 0.2 };
  },
};

const mark = (text: string, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'tx',
  tool: 'text',
  color: '#1f2328',
  width: 1,
  points: [{ x: 10, y: 100, pressure: 0.5 }],
  text,
  fontSize: 20,
  fontFamily: 'Georgia',
  ...extra,
});

const at = (x: number, y: number): Stroke['points'] => [{ x, y, pressure: 0.5 }];

const near = (actual: number, expected: number, what: string, within = 1e-6): void =>
  assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual}, not ${expected}`);

const shown = (layout: TypeLayout, line: number): string =>
  layout.glyphs
    .filter((g) => g.line === line)
    .map((g) => g.ch)
    .join('');

const rect = (w: number, h: number): VectorAnchor[] => [{ p: { x: 0, y: 0 } }, { p: { x: w, y: 0 } }, { p: { x: w, y: h } }, { p: { x: 0, y: h } }];

/** A circle of radius `r` about (cx, cy), four cubics clockwise from its top. */
function circle(cx: number, cy: number, r: number): VectorAnchor[] {
  const k = (4 / 3) * Math.tan(Math.PI / 8) * r;
  return [
    { p: { x: cx, y: cy - r }, hIn: { x: cx - k, y: cy - r }, hOut: { x: cx + k, y: cy - r } },
    { p: { x: cx + r, y: cy }, hIn: { x: cx + r, y: cy - k }, hOut: { x: cx + r, y: cy + k } },
    { p: { x: cx, y: cy + r }, hIn: { x: cx + k, y: cy + r }, hOut: { x: cx - k, y: cy + r } },
    { p: { x: cx - r, y: cy }, hIn: { x: cx - r, y: cy + k }, hOut: { x: cx - r, y: cy - k } },
  ];
}

const onPath = (stroke: Stroke, path: Partial<NonNullable<TypeSpec['path']>> & { anchors: VectorAnchor[] }): Stroke =>
  withTypeset(stroke, { kind: 'path', path: { start: 0, end: Number.MAX_SAFE_INTEGER, align: 'baseline', effect: 'rainbow', ...path } });

test('point type sets a line a paragraph, its anchor the top of the first, a line and a quarter of the size apart', () => {
  const layout = layoutType(mark('ab\ncd'), FIXED);
  assert.equal(layout.kind, 'point');
  // The first baseline is the ascent below the anchor; the next is the leading below that.
  assert.deepEqual(layout.lines.map((l) => [l.x, l.y, l.width]), [[10, 116, 20], [10, 141, 20]]);
  assert.deepEqual(layout.glyphs.map((g) => [g.ch, g.x, g.y]), [['a', 10, 116], ['b', 20, 116], ['c', 10, 141], ['d', 20, 141]]);
  // Its box is what a text mark's box has always been: its widest line across, a line and a quarter of its size a line.
  assert.deepEqual(layout.bounds, { minX: 10, minY: 100, maxX: 30, maxY: 150 });
  assert.equal(layout.overset, false);
  // An empty mark still has a line to type on.
  const empty = layoutType(mark(''), FIXED);
  assert.equal(empty.lines.length, 1);
  assert.deepEqual(empty.bounds, { minX: 10, minY: 100, maxX: 10, maxY: 125 });
  // The same mark and measure give the layout kept from before.
  const same = mark('ab');
  assert.equal(layoutType(same, FIXED), layoutType(same, FIXED));
});

test('point type aligns each line on its anchor: left from it, centred on it, right to it', () => {
  const two = mark('abcd\nab');
  const centred = layoutType(applyPara(two, { start: 0, end: 7 }, { align: 'center' }), FIXED);
  assert.deepEqual(centred.lines.map((l) => l.x), [-10, 0]);
  const right = layoutType(applyPara(two, { start: 0, end: 7 }, { align: 'right' }), FIXED);
  assert.deepEqual(right.lines.map((l) => l.x), [-30, -10]);
  // Indents stand in from the anchor; a paragraph's first line's on top of its left one.
  const indented = layoutType(applyPara(two, { start: 0, end: 4 }, { leftIndent: 5, firstIndent: 7 }), FIXED);
  assert.deepEqual(indented.lines.map((l) => l.x), [22, 10]);
});

test('area type fills a circle a band at a time, each line the widest span the circle covers for its whole height', () => {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna';
  const stroke = withTypeset(mark(words, { fontSize: 10, points: at(0, 0) }), { kind: 'area', frame: { anchors: circle(60, 60, 60) } });
  const layout = layoutType(stroke, FIXED);
  assert.equal(layout.kind, 'area');
  assert.ok(layout.lines.length >= 6, `${layout.lines.length} lines`);
  // Every character is inside the circle: the four cubics stand at most 0.027% outside a true one.
  for (const g of layout.glyphs) {
    if (g.ch === ' ') continue;
    for (const corner of glyphCorners(g)) assert.ok(Math.hypot(corner.x - 60, corner.y - 60) <= 60 * 1.0003, `${g.ch} at ${corner.x}, ${corner.y}`);
  }
  // The lines are short at the top, long through the middle.
  const widths = layout.lines.map((l) => l.width);
  const middle = layout.lines.findIndex((l) => l.y > 55);
  assert.ok(widths[middle] > widths[0] * 1.5, `the middle line ${widths[middle]} against the first ${widths[0]}`);
  assert.ok(layout.lines[0].y - layout.lines[0].ascent >= 0, 'the first line starts inside the frame');
  assert.deepEqual(layout.frame?.box, { minX: 0, minY: 0, maxX: 120, maxY: 120 });
});

test('area type that does not fit its frame is overset; a rectangle that grows to fit takes the text', () => {
  const tight = withTypeset(mark('aaaa bbbb cccc dddd', { fontSize: 10, points: at(0, 0) }), { kind: 'area', frame: { anchors: rect(40, 30) } });
  const layout = layoutType(tight, FIXED);
  assert.equal(layout.overset, true);
  assert.deepEqual([shown(layout, 0), shown(layout, 1)], ['aaaa ', 'bbbb ']);
  assert.equal(layout.lines.length, 2);
  // A box from before: it wraps at its width and grows a line and a quarter a line.
  const boxed = layoutType(mark('aaaa bbbb cccc', { fontSize: 10, points: at(0, 0), textBoxWidth: 45 }), FIXED);
  assert.equal(boxed.overset, false);
  assert.deepEqual(boxed.lines.map((l) => [l.y, l.width]), [[8, 45], [20.5, 20]]);
  assert.deepEqual(boxed.frame?.box, { minX: 0, minY: 0, maxX: 45, maxY: 25 });
  assert.deepEqual(boxed.bounds, { minX: 0, minY: 0, maxX: 45, maxY: 25 });
  // A word longer than its line breaks where the line ends.
  const long = layoutType(mark('abcdefghij', { fontSize: 10, points: at(0, 0), textBoxWidth: 22 }), FIXED);
  assert.deepEqual(long.lines.map((_, i) => shown(long, i)), ['abcd', 'efgh', 'ij']);
});

test('path type on a straight line sets its characters where point type does, its baseline on the path', () => {
  const path = onPath(mark('abc', { points: at(10, 100) }), { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 200, y: 0 } }] });
  const layout = layoutType(path, FIXED);
  assert.equal(layout.kind, 'path');
  // Point type anchored an ascent higher puts its baseline on the same line.
  const point = layoutType(mark('abc', { points: at(10, 84) }), FIXED);
  assert.deepEqual(
    layout.glyphs.map((g) => [g.ch, g.x, g.y, g.rotation]),
    point.glyphs.map((g) => [g.ch, g.x, g.y, 0]),
  );
  for (const g of layout.glyphs) assert.deepEqual(g.matrix.map((v) => v + 0), [1, 0, 0, 1]);
  assert.equal(layout.path?.length, 200);
  // Flipped, it runs back along the path from its end, upside down.
  const flipped = layoutType(onPath(mark('abc', { points: at(10, 100) }), { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 200, y: 0 } }], flip: true }), FIXED);
  for (const g of flipped.glyphs) near(Math.abs(g.rotation), 180, `${g.ch} turned`);
  near(flipped.glyphs[0].x, 210, 'the first character starts at the far end');
  assert.ok(flipped.glyphs[0].x > flipped.glyphs[2].x);
  // A character whose middle is past the path's end is overset, and the rest with it.
  const short = layoutType(onPath(mark('abcdef', { points: at(0, 0) }), { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 34, y: 0 } }] }), FIXED);
  assert.equal(short.overset, true);
  assert.equal(short.glyphs.length, 3);
  // Centred in what the path leaves it.
  const centred = layoutType(applyPara(onPath(mark('ab', { points: at(0, 0) }), { anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }] }), { start: 0, end: 2 }, { align: 'center' }), FIXED);
  near(centred.glyphs[0].x, 40, 'centred');
});

test("each path effect turns a character by its own rule", () => {
  const diagonal: VectorAnchor[] = [{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 100 } }];
  const of = (effect: NonNullable<TypeSpec['path']>['effect'], anchors = diagonal, closed = false): TypeLayout =>
    layoutType(onPath(mark('ab', { fontSize: 10, points: at(0, 0) }), { anchors, effect, closed }), FIXED);
  const r = Math.SQRT1_2;
  // Rainbow: turned with the path.
  for (const g of of('rainbow').glyphs) near(g.rotation, 45, 'rainbow');
  // Skew: along the path, its upright strokes upright.
  for (const g of of('skew').glyphs) {
    near(g.matrix[0], r, 'skew along');
    near(g.matrix[1], r, 'skew along');
    near(g.matrix[2], 0, 'skew upright');
    near(g.matrix[3], 1, 'skew upright');
  }
  // Ribbon: level strokes level, upright ones square to the path.
  for (const g of of('ribbon').glyphs) {
    near(g.matrix[0], 1, 'ribbon level');
    near(g.matrix[1], 0, 'ribbon level');
    near(g.matrix[2], -r, 'ribbon square');
    near(g.matrix[3], r, 'ribbon square');
  }
  // Stair: nothing turned, each character's baseline middle on the path.
  for (const g of of('stair').glyphs) {
    assert.deepEqual(g.matrix.map((v) => v + 0), [1, 0, 0, 1]);
    const mid = { x: g.x + g.width / 2, y: g.y };
    near(mid.x, mid.y, 'on the diagonal');
  }
  // Gravity: each character's down is toward the middle of the path's box.
  const ring = of('gravity', circle(0, 0, 50), true);
  for (const g of ring.glyphs) {
    const mid = { x: g.x + g.matrix[0] * (g.width / 2), y: g.y + g.matrix[1] * (g.width / 2) };
    const toward = Math.hypot(mid.x, mid.y);
    near(g.matrix[2], -mid.x / toward, 'gravity down', 1e-3);
    near(g.matrix[3], -mid.y / toward, 'gravity down', 1e-3);
  }
});

test('vertical text stacks characters down columns that run right to left from the anchor', () => {
  const layout = layoutType(withTypeset(mark('ab\ncd', { points: at(100, 0) }), { kind: 'point', orientation: 'vertical' }), FIXED);
  assert.equal(layout.orientation, 'vertical');
  // Each column's middle, and its top.
  assert.deepEqual(layout.lines.map((l) => [l.x, l.y]), [[90, 0], [65, 0]]);
  // Each character upright, its em centred on the column a size down from the one before.
  const centres = layout.glyphs.map((g) => [g.ch, g.x + g.width / 2, g.y - (g.ascent - g.descent) / 2]);
  assert.deepEqual(centres, [['a', 90, 10], ['b', 90, 30], ['c', 65, 10], ['d', 65, 30]]);
  for (const g of layout.glyphs) assert.equal(g.rotation, 0);
});

test('justified lines take up their box, word spaces first and then letters; the last line is set left', () => {
  const text = 'aa bb cc dd ee ff gg hh';
  const box = (w: number): TypeLayout =>
    layoutType(applyPara(withTypeset(mark(text, { fontSize: 10, points: at(0, 0) }), { kind: 'area', frame: { anchors: rect(w, 100) } }), { start: 0, end: text.length }, { align: 'justify' }), FIXED);
  // 5 more to go: the six word spaces take it all, under the 133% they may grow to.
  const words = box(105);
  const first = words.glyphs.filter((g) => g.line === 0 && g.ch !== ' ');
  const end = first[first.length - 1];
  near(end.x + end.width, 105, 'the line ends at the box');
  for (const g of first) near(g.tracking, 0, 'no letter spacing');
  for (const g of words.glyphs.filter((g) => g.line === 0 && g.ch === ' ').slice(0, 6)) near(g.wordSpace, 5 / 6, 'each space a sixth');
  assert.equal(words.lines[1].x, 0, 'the last line is set left');
  // 12 more: the spaces grow 33% and the letters take the rest.
  const letters = box(112);
  const line = letters.glyphs.filter((g) => g.line === 0 && g.ch !== ' ');
  near(line[line.length - 1].x + line[line.length - 1].width, 112, 'the line ends at the box');
  near(line[0].tracking, (12 - 30 * 0.33) / 13, 'letters take what is left');
});

test('a list paragraph stands in an em and a half a level, its number before it, counting on', () => {
  const listed = applyPara(mark('one\ntwo\nthree'), { start: 0, end: 13 }, { list: { kind: 'number', level: 1 } });
  const layout = layoutType(listed, FIXED);
  assert.deepEqual(layout.markers.map((m) => m.text), ['1.', '2.', '3.']);
  assert.deepEqual(layout.lines.map((l) => l.x), [40, 40, 40]);
  // Half an em before the text.
  assert.deepEqual(layout.markers.map((m) => [m.x, m.y]), [[10, 116], [10, 141], [10, 166]]);
  // A second level counts on its own, in letters; bullets are bullets.
  const nested = applyPara(applyPara(listed, { start: 4, end: 7 }, { list: { kind: 'number', level: 2 } }), { start: 8, end: 13 }, { list: { kind: 'bullet', level: 1 } });
  assert.deepEqual(layoutType(nested, FIXED).markers.map((m) => m.text), ['1.', 'a.', '•']);
});

test('a superscript is set smaller and raised; small caps are capitals, smaller; a kerned pair sets closer', () => {
  const squared = layoutType(applyChar(mark('x2'), { start: 1, end: 2 }, { position: 'superscript' }), FIXED);
  const two = squared.glyphs[1];
  near(two.font.size, 20 * SCRIPT_SIZE, 'its size');
  near(two.y, 116 - 20 * SCRIPT_SHIFT, 'raised');
  near(two.x, 20, 'after the x');
  // The line keeps its full size.
  assert.equal(squared.lines[0].ascent, 16);
  const small = layoutType(applyChar(mark('Ab'), { start: 0, end: 2 }, { caps: 'small' }), FIXED);
  assert.deepEqual(small.glyphs.map((g) => [g.ch, g.font.size]), [['A', 20], ['B', 20 * SMALL_CAPS_SIZE]]);
  const caps = layoutType(applyChar(mark('Ab'), { start: 0, end: 2 }, { caps: 'all' }), FIXED);
  assert.equal(caps.glyphs.map((g) => g.ch).join(''), 'AB');
  // The pair's kerning goes to its first character; off, the pair sets apart.
  const av = layoutType(mark('AV'), FIXED);
  near(av.glyphs[1].x, 18, 'kerned');
  const apart = layoutType(applyChar(mark('AV'), { start: 0, end: 2 }, { kerning: 'none' }), FIXED);
  near(apart.glyphs[1].x, 20, 'not kerned');
  // Tracking and kerning by hand, in thousandths of an em.
  const tracked = layoutType(applyChar(mark('abc'), { start: 0, end: 3 }, { tracking: 100 }), FIXED);
  assert.deepEqual(tracked.glyphs.map((g) => g.x), [10, 22, 34]);
  const kerned = layoutType(applyChar(mark('abc'), { start: 0, end: 1 }, { kern: -250 }), FIXED);
  assert.deepEqual(kerned.glyphs.map((g) => g.x), [10, 15, 25]);
});

test('a paragraph that hyphenates breaks a word at a Liang point that fits, the hyphen the layout adds', () => {
  const text = 'the hyphenation';
  const stroke = applyPara(withTypeset(mark(text, { fontSize: 10, points: at(0, 0) }), { kind: 'area', frame: { anchors: rect(60, 100) } }), { start: 0, end: text.length }, { hyphenate: true });
  const layout = layoutType(stroke, FIXED);
  assert.deepEqual(layout.lines.map((_, i) => shown(layout, i)), ['the hyphen-', 'ation']);
  const hyphen = layout.glyphs.find((g) => g.ch === '-');
  assert.equal(hyphen?.index, -1, 'the hyphen is not in the text');
  // Without hyphenation, the word goes whole to the next line.
  const whole = layoutType(applyPara(stroke, { start: 0, end: text.length }, { hyphenate: false }), FIXED);
  assert.deepEqual(whole.lines.map((_, i) => shown(whole, i)), ['the ', 'hyphenation']);
});

test('underlines join across characters; a stretch in one style is set as one string, a turned character alone', () => {
  const under = layoutType(applyChar(mark('ab cd'), { start: 0, end: 5 }, { underline: true }), FIXED);
  assert.equal(under.decorations.length, 1);
  const line = under.decorations[0];
  assert.deepEqual([line.from.x, line.to.x], [10, 60]);
  near(line.from.y, 116 + 20 * 0.12, 'under the baseline');
  const plain = typeSpans(layoutType(mark('Hello world'), FIXED));
  assert.deepEqual(plain.map((s) => [s.text, s.plain]), [['Hello world', true]]);
  const turnedOne = typeSpans(layoutType(applyChar(mark('Hello world'), { start: 4, end: 5 }, { rotation: 30 }), FIXED));
  assert.deepEqual(turnedOne.map((s) => [s.text, s.plain]), [['Hell', true], ['o', false], [' world', true]]);
  // A highlight is behind its characters, the line's height.
  const lit = layoutType(applyChar(mark('ab cd'), { start: 3, end: 5 }, { highlight: '#fff3bf' }), FIXED);
  assert.deepEqual(lit.highlights.map((h) => [h.kind, h.corners[0].x, h.corners[0].y, h.corners[2].x, h.corners[2].y]), [['highlight', 40, 100, 60, 120]]);
});

test("a path's spacing draws its characters together round a turn, by its curvature, and leaves a straight stretch alone", () => {
  // A quarter of a circle of radius 50: its curvature is a fiftieth.
  const [top, right] = circle(0, 0, 50);
  const quarter: VectorAnchor[] = [{ p: top.p, hOut: top.hOut }, { p: right.p, hIn: right.hIn }];
  const gaps = (layout: TypeLayout): number[] => layout.glyphs.slice(1).map((g, k) => Math.hypot(g.x - layout.glyphs[k].x, g.y - layout.glyphs[k].y));
  const set = (anchors: VectorAnchor[], spacing?: number): TypeLayout =>
    layoutType(onPath(mark('abcd', { fontSize: 10, points: at(0, 0) }), { anchors, ...(spacing === undefined ? {} : { spacing }) }), FIXED);
  for (const gap of gaps(set(quarter))) near(gap, 5, 'without spacing, a character apart', 0.01);
  // 10 times a fiftieth: each advance a fifth shorter round the turn. The
  // cubic's curvature is a circle's to within a few percent near its ends.
  for (const gap of gaps(set(quarter, 10))) near(gap, 4, 'with spacing 10, a fifth closer', 0.05);
  const straight: VectorAnchor[] = [{ p: { x: 0, y: 0 } }, { p: { x: 200, y: 0 } }];
  for (const gap of gaps(set(straight, 10))) near(gap, 5, 'on a straight stretch, as it was', 1e-9);
});
