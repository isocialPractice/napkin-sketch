/**
 * The font reader (src/core/type/sfnt.ts), on the two fixtures in
 * test/fonts/ - an OFL TrueType face and an OFL CFF face, each subset to a
 * few glyphs (make-fixtures.py, OFL.txt): the faces' names and metrics, the
 * character map, advances, a glyph's anchors, the quadratic raised to the
 * cubic that draws it exactly, composite glyphs, `kern` pairs, a collection
 * and its faces by name, and what it does not read, said.
 *
 * The expected values are fontTools' reading of the same files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { glyphOutline, isSfntProblem, openSfnt, sfntFaceNames, type SfntFace } from '../src/core/type/sfnt.js';
import { repoRoot } from './helpers/repo-root.js';
import type { VectorAnchor } from '../src/core/types.js';

const FONTS = join(repoRoot(), 'test', 'fonts');
const SANS = new Uint8Array(readFileSync(join(FONTS, 'napkin-test-sans.ttf')));
const CFF = new Uint8Array(readFileSync(join(FONTS, 'napkin-test-cff.otf')));

function open(bytes: Uint8Array, name?: string): SfntFace {
  const face = openSfnt(bytes, name);
  assert.ok(!isSfntProblem(face), isSfntProblem(face) ? face.problem : '');
  return face as SfntFace;
}

function outline(face: SfntFace, glyph: number): VectorAnchor[][] {
  const read = glyphOutline(face, glyph);
  assert.ok(!isSfntProblem(read), isSfntProblem(read) ? read.problem : '');
  return (read as { contours: VectorAnchor[][] }).contours;
}

const xy = (p: { x: number; y: number } | undefined): [number, number] | undefined => (p ? [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000] : undefined);
const shape = (contours: VectorAnchor[][]) => contours.map((contour) => contour.map((a) => ({ p: xy(a.p), in: xy(a.hIn), out: xy(a.hOut) })));

/** Two fonts in one collection, as a `.ttc` holds them: each table placed where it now lands. */
function collection(fonts: Uint8Array[]): Uint8Array {
  const header = 12 + 4 * fonts.length;
  const total = header + fonts.reduce((sum, font) => sum + font.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, fonts.length);
  let at = header;
  fonts.forEach((font, i) => {
    view.setUint32(12 + i * 4, at);
    out.set(font, at);
    const tables = view.getUint16(at + 4);
    for (let t = 0; t < tables; t++) {
      const record = at + 12 + t * 16 + 8;
      view.setUint32(record, view.getUint32(record) + at);
    }
    at += font.length;
  });
  return out;
}

test('both fixtures open: their names, their em, their glyphs and how far their lines reach', () => {
  const sans = open(SANS);
  assert.deepEqual(
    [sans.format, sans.postscriptName, sans.family, sans.style, sans.unitsPerEm, sans.numGlyphs, sans.ascender, sans.descender, sans.lineGap, sans.note],
    ['truetype', 'NapkinTestSans-Regular', 'Napkin Test Sans', 'Regular', 2048, 14, 1854, -434, 67, null],
  );
  const cff = open(CFF);
  assert.deepEqual(
    [cff.format, cff.postscriptName, cff.family, cff.unitsPerEm, cff.numGlyphs, cff.ascender, cff.descender, cff.lineGap],
    ['cff', 'NapkinTestCFF-Regular', 'Napkin Test CFF', 1000, 8, 969, -344, 0],
  );
});

test('the character map: each character its glyph, and 0 for one the face has none for', () => {
  const sans = open(SANS);
  const ids = (face: SfntFace, text: string) => [...text].map((ch) => face.glyphId(ch.codePointAt(0)!));
  assert.deepEqual(ids(sans, ' &.1ATVeoÅé'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]);
  assert.deepEqual(ids(sans, 'Zz\u{1f600}'), [0, 0, 0]);
  assert.deepEqual(ids(open(CFF), 'Ago1. &'), [1, 2, 3, 4, 5, 6, 7]);
});

test('advances, in font units', () => {
  const sans = open(SANS);
  assert.deepEqual([5, 6, 1, 12].map((id) => sans.advance(id)), [1366, 1251, 569, 1139]);
  const cff = open(CFF);
  assert.deepEqual([1, 2, 3, 6].map((id) => cff.advance(id)), [610, 585, 564, 270]);
});

test("a straight glyph's anchors are its corners, with no handles", () => {
  // The T: one contour of eight corners, as the font draws it.
  assert.deepEqual(shape(outline(open(SANS), 6)), [
    [[720, 1253], [720, 0], [530, 0], [530, 1253], [46, 1253], [46, 1409], [1204, 1409], [1204, 1253]].map((p) => ({ p, in: undefined, out: undefined })),
  ]);
});

test("a CFF glyph's curves are its own cubics: the o, an outline and its counter", () => {
  const contours = outline(open(CFF), 3);
  assert.equal(contours.length, 2);
  assert.deepEqual(shape(contours)[0], [
    { p: [282, -13], in: [162, -13], out: [402, -13] },
    { p: [499, 205], in: [499, 84], out: undefined },
    { p: [499, 361], in: undefined, out: [499, 482] },
    { p: [282, 579], in: [402, 579], out: [162, 579] },
    { p: [65, 361], in: [65, 482], out: undefined },
    { p: [65, 205], in: undefined, out: [65, 84] },
  ]);
});

test('a quadratic is raised to the cubic that draws it exactly: its handles meet at its control point, and its middle is the quadratic\'s', () => {
  // The TrueType o's first segment: from (1053, 542) through the control point (1053, 258)
  // to the on-curve point implied between it and the next control point, (928, 119).
  const [outer] = outline(open(SANS), 9);
  const start = outer.findIndex((a) => a.p.x === 1053 && a.p.y === 542);
  const from = outer[start];
  const to = outer[(start + 1) % outer.length];
  assert.deepEqual(xy(to.p), [928, 119]);
  const q = { x: 1053, y: 258 };
  // Each handle two thirds of the way to the control point...
  assert.deepEqual(xy(from.hOut), xy({ x: from.p.x + (2 / 3) * (q.x - from.p.x), y: from.p.y + (2 / 3) * (q.y - from.p.y) }));
  assert.deepEqual(xy(to.hIn), xy({ x: to.p.x + (2 / 3) * (q.x - to.p.x), y: to.p.y + (2 / 3) * (q.y - to.p.y) }));
  // ...so the cubic's middle is the quadratic's, (p0 + 2q + p2) / 4.
  const c1 = from.hOut!;
  const c2 = to.hIn!;
  const mid = { x: (from.p.x + 3 * c1.x + 3 * c2.x + to.p.x) / 8, y: (from.p.y + 3 * c1.y + 3 * c2.y + to.p.y) / 8 };
  assert.deepEqual(xy(mid), xy({ x: (1053 + 2 * q.x + 928) / 4, y: (542 + 2 * q.y + 119) / 4 }));
  // Every curve of the glyph is such a raise: both handles point at one control point.
  for (const contour of outline(open(SANS), 9)) {
    contour.forEach((a, i) => {
      const b = contour[(i + 1) % contour.length];
      if (!a.hOut || !b.hIn) return;
      const qa = { x: a.p.x + 1.5 * (a.hOut.x - a.p.x), y: a.p.y + 1.5 * (a.hOut.y - a.p.y) };
      const qb = { x: b.p.x + 1.5 * (b.hIn.x - b.p.x), y: b.p.y + 1.5 * (b.hIn.y - b.p.y) };
      assert.deepEqual(xy(qa), xy(qb), `segment ${i}`);
    });
  }
});

test('a composite glyph is its components, each placed: the A and its ring, the e and its acute', () => {
  const sans = open(SANS);
  const ring = outline(sans, 13).map((contour) => contour.map((a) => ({ ...a, p: { x: a.p.x + 393, y: a.p.y + 136 } })));
  const aring = outline(sans, 11);
  assert.equal(aring.length, outline(sans, 5).length + ring.length);
  assert.deepEqual(shape(aring.slice(0, 2)), shape(outline(sans, 5)), 'the A, where it is');
  assert.deepEqual(aring.slice(2).map((contour) => contour.map((a) => xy(a.p))), ring.map((contour) => contour.map((a) => xy(a.p))), 'the ring, moved by its offset');
  const eacute = outline(sans, 12);
  assert.deepEqual(shape(eacute.slice(0, outline(sans, 8).length)), shape(outline(sans, 8)), 'the e');
  assert.ok(eacute.length > outline(sans, 8).length, 'and its acute');
});

test("kern pairs: the table's own, zero for a pair it does not list", () => {
  const sans = open(SANS);
  assert.deepEqual([sans.kerning(5, 7), sans.kerning(6, 9), sans.kerning(7, 9), sans.kerning(4, 4)], [-152, -227, -113, -152]);
  assert.equal(sans.kerning(5, 9), 0, 'A o');
  assert.equal(open(CFF).kerning(1, 3), 0, 'a face with no kern table');
});

test('a collection: its faces by PostScript name', () => {
  const ttc = collection([SANS, CFF]);
  assert.deepEqual(sfntFaceNames(ttc), ['NapkinTestSans-Regular', 'NapkinTestCFF-Regular']);
  const cff = open(ttc, 'NapkinTestCFF-Regular');
  assert.equal(cff.format, 'cff');
  assert.deepEqual(shape(outline(cff, 3)), shape(outline(open(CFF), 3)), 'the same outlines as from its own file');
  assert.equal(open(ttc).postscriptName, 'NapkinTestSans-Regular', 'the first face with no name asked for');
  const missing = openSfnt(ttc, 'NoSuchFace-Bold');
  assert.ok(isSfntProblem(missing) && /no face named NoSuchFace-Bold/.test(missing.problem));
});

test('what the reader does not read is a problem with its reason, never a throw', () => {
  const retagged = CFF.slice();
  const view = new DataView(retagged.buffer);
  for (let t = 0; t < view.getUint16(4); t++) {
    const record = 12 + t * 16;
    if (String.fromCharCode(...retagged.slice(record, record + 4)) === 'CFF ') retagged.set([0x43, 0x46, 0x46, 0x32], record);
  }
  const cff2 = openSfnt(retagged);
  assert.ok(isSfntProblem(cff2) && /CFF2/.test(cff2.problem), JSON.stringify(cff2));
  const woff = openSfnt(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 1, 0, 0, 0, 0, 0, 0]));
  assert.ok(isSfntProblem(woff) && /web font/.test(woff.problem), JSON.stringify(woff));
  const cut = openSfnt(SANS.slice(0, 400));
  assert.ok(isSfntProblem(cut) && /damaged|cut short/.test(cut.problem), JSON.stringify(cut));
  const nothing = openSfnt(new Uint8Array([1, 2, 3]));
  assert.ok(isSfntProblem(nothing), JSON.stringify(nothing));
  // A glyph past the end is empty, not an error.
  const past = glyphOutline(open(SANS), 999);
  assert.ok(!isSfntProblem(past) && past.contours.length === 0);
});
