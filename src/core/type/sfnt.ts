/**
 * A font file's glyph outlines, read with no DOM: what Expand Text to Shape,
 * text bent by a Warp or built in 3D, the PDF's text and the headless PNG's
 * draw text from.
 *
 * It reads OpenType and TrueType faces - one file, or a collection (`.ttc`)
 * whose face is picked by its PostScript name:
 *
 * - `head`, `maxp`, `hhea` and `hmtx`: the em, the glyph count, the line's
 *   reach and each glyph's advance;
 * - `cmap` formats 4 and 12, a symbol font's (3, 0) table included;
 * - `glyf` and `loca`: TrueType's quadratic outlines, composite glyphs too -
 *   offset, scaled, turned or matched point to point;
 * - `CFF `: Type 2 charstrings with their subroutines, CID-keyed fonts' too;
 *   the hints are skipped;
 * - `kern` format 0, in Microsoft's table and Apple's;
 * - `name`: the face's PostScript, family and style names.
 *
 * An outline comes back in font units, y up, as the font draws it: closed
 * contours of cubic anchors, each quadratic raised to the cubic that draws
 * it exactly (its handles two thirds of the way to the quadratic's control
 * point). What it does not read - CFF2, a variable font's instances other
 * than its default, an accent built by the old `seac` - is a
 * {@link SfntProblem} with the reason, for the caller to report.
 */

import type { VectorAnchor } from '../types.js';

/** Why a font, a face or a glyph cannot be read: a sentence for a report. */
export interface SfntProblem {
  readonly problem: string;
}

/** True for a {@link SfntProblem}. */
export function isSfntProblem(value: unknown): value is SfntProblem {
  return typeof value === 'object' && value !== null && typeof (value as SfntProblem).problem === 'string';
}

/** One face of a font file, opened: its names, its metrics and its character map. */
export interface SfntFace {
  /** `truetype` for `glyf` outlines, `cff` for PostScript ones. */
  readonly format: 'truetype' | 'cff';
  readonly postscriptName: string;
  /** The family and the face's style, as the `name` table says (its typographic names first). */
  readonly family: string;
  readonly style: string;
  /** Font units to the em. */
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  /** How far the font's lines reach above and below the baseline, and the gap between them (`hhea`), font units. */
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  /** Something to pass on that is not a problem: a variable font read at its default instance. Null when there is nothing. */
  readonly note: string | null;
  /** The glyph a character maps to, or 0 - the `.notdef` glyph - when the face has none for it. */
  glyphId(codePoint: number): number;
  /** How far the pen moves past a glyph, font units. */
  advance(glyphId: number): number;
  /** The `kern` table's adjustment between two glyphs, font units; 0 when it has none for them. */
  kerning(left: number, right: number): number;
}

/** One glyph's outline, font units, y up: closed contours of cubic anchors, as the font winds them. */
export interface GlyphOutline {
  readonly contours: VectorAnchor[][];
  readonly advance: number;
}

/** A read past the end of the file: the file is damaged, not merely unusual. */
class Truncated extends Error {}

/** Reads big-endian numbers from the file, every read held to its bounds. */
class Bytes {
  private readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  private at(offset: number, size: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > this.bytes.byteLength) throw new Truncated(`read of ${size} at ${offset}`);
    return offset;
  }

  u8(offset: number): number {
    return this.view.getUint8(this.at(offset, 1));
  }

  i8(offset: number): number {
    return this.view.getInt8(this.at(offset, 1));
  }

  u16(offset: number): number {
    return this.view.getUint16(this.at(offset, 2));
  }

  i16(offset: number): number {
    return this.view.getInt16(this.at(offset, 2));
  }

  u32(offset: number): number {
    return this.view.getUint32(this.at(offset, 4));
  }

  i32(offset: number): number {
    return this.view.getInt32(this.at(offset, 4));
  }

  /** A 2.14 fixed-point number. */
  f2dot14(offset: number): number {
    return this.i16(offset) / 16384;
  }

  /** A 16.16 fixed-point number. */
  fixed(offset: number): number {
    return this.i32(offset) / 65536;
  }

  tag(offset: number): string {
    this.at(offset, 4);
    return String.fromCharCode(this.bytes[offset], this.bytes[offset + 1], this.bytes[offset + 2], this.bytes[offset + 3]);
  }
}

/** A table's place in the file. */
interface TableRecord {
  readonly offset: number;
  readonly length: number;
}

/** The faces' table directories a file holds: one, or a collection's. */
function directories(bytes: Bytes): number[] {
  const tag = bytes.tag(0);
  if (tag !== 'ttcf') return [0];
  const count = bytes.u32(8);
  if (count === 0 || count > 1024) throw new Truncated('a collection of no faces');
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(bytes.u32(12 + i * 4));
  return out;
}

/** A face's tables, by tag. */
function tablesAt(bytes: Bytes, base: number): Map<string, TableRecord> {
  const count = bytes.u16(base + 4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < count; i++) {
    const record = base + 12 + i * 16;
    const offset = bytes.u32(record + 8);
    const length = bytes.u32(record + 12);
    if (offset + length > bytes.length) throw new Truncated(`table ${bytes.tag(record)} past the end`);
    tables.set(bytes.tag(record), { offset, length });
  }
  return tables;
}

/** The flavours of a face's directory that this reader knows, and what to say of the rest. */
function flavourProblem(bytes: Bytes, base: number): string | null {
  const tag = bytes.tag(base);
  const version = bytes.u32(base);
  if (version === 0x00010000 || tag === 'true' || tag === 'OTTO') return null;
  if (tag === 'wOFF' || tag === 'wOF2') return 'it is a web font (WOFF), which is read only once it is unpacked';
  if (tag === 'typ1') return 'it is an old Mac PostScript font (typ1)';
  return 'it is not an OpenType or TrueType font';
}

// ---- Names ----------------------------------------------------------------------------------

/** Decodes a `name` record: UTF-16 for the Unicode and Windows platforms, one byte a character for the Mac's. */
function decodeName(bytes: Bytes, platform: number, offset: number, length: number): string {
  let out = '';
  if (platform === 0 || platform === 3) {
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(bytes.u16(offset + i));
  } else {
    for (let i = 0; i < length; i++) out += String.fromCharCode(bytes.u8(offset + i));
  }
  return out;
}

/** A face's names by id: Windows US English first, then any Windows name, then the Mac's. */
function readNames(bytes: Bytes, table: TableRecord | undefined): Map<number, string> {
  const names = new Map<number, string>();
  if (!table) return names;
  const base = table.offset;
  const count = bytes.u16(base + 2);
  const strings = base + bytes.u16(base + 4);
  const rank = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const record = base + 6 + i * 12;
    const platform = bytes.u16(record);
    const encoding = bytes.u16(record + 2);
    const language = bytes.u16(record + 4);
    const id = bytes.u16(record + 6);
    const length = bytes.u16(record + 8);
    const offset = strings + bytes.u16(record + 10);
    const score =
      platform === 3 && language === 0x409 ? 4 : platform === 3 ? 3 : platform === 0 ? 2 : platform === 1 && encoding === 0 && language === 0 ? 1 : 0;
    if (score === 0 || (rank.get(id) ?? 0) >= score) continue;
    try {
      names.set(id, decodeName(bytes, platform, offset, length));
      rank.set(id, score);
    } catch {
      // A name past the end is no name.
    }
  }
  return names;
}

// ---- The character map --------------------------------------------------------------------

type CharMap = (codePoint: number) => number;

/** The `cmap` subtable to read: a full Unicode map (format 12) first, then the BMP's (format 4), then a symbol font's. */
function readCmap(bytes: Bytes, table: TableRecord | undefined): CharMap | null {
  if (!table) return null;
  const base = table.offset;
  const count = bytes.u16(base + 2);
  let best: { score: number; offset: number; format: number; symbol: boolean } | null = null;
  for (let i = 0; i < count; i++) {
    const record = base + 4 + i * 8;
    const platform = bytes.u16(record);
    const encoding = bytes.u16(record + 2);
    const offset = base + bytes.u32(record + 4);
    const format = bytes.u16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    const symbol = platform === 3 && encoding === 0;
    const score = format === 12 && unicode ? 4 : format === 4 && unicode ? 3 : format === 4 && symbol ? 2 : 0;
    if (score > 0 && (!best || score > best.score)) best = { score, offset, format, symbol };
  }
  if (!best) return null;
  const o = best.offset;
  let map: CharMap;
  if (best.format === 12) {
    const groups = bytes.u32(o + 12);
    map = (code) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = o + 16 + mid * 12;
        const start = bytes.u32(at);
        const end = bytes.u32(at + 4);
        if (code < start) hi = mid - 1;
        else if (code > end) lo = mid + 1;
        else return bytes.u32(at + 8) + (code - start);
      }
      return 0;
    };
  } else {
    const segX2 = bytes.u16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    map = (code) => {
      if (code > 0xffff) return 0;
      // The first segment whose end is at or past the code, by bisection.
      let lo = 0;
      let hi = segX2 / 2 - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bytes.u16(ends + mid * 2) < code) lo = mid + 1;
        else hi = mid;
      }
      const s = lo * 2;
      if (bytes.u16(ends + s) < code) return 0;
      const start = bytes.u16(starts + s);
      if (code < start) return 0;
      const delta = bytes.i16(deltas + s);
      const rangeOffset = bytes.u16(ranges + s);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyph = bytes.u16(ranges + s + rangeOffset + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    };
  }
  // A symbol font maps its characters at U+F000 up: its `A` is at U+F041.
  if (best.symbol) {
    const plain = map;
    map = (code) => plain(code) || (code <= 0xff ? plain(0xf000 + code) : 0);
  }
  return map;
}

// ---- Kerning ----------------------------------------------------------------------------------------

/** The `kern` table's format 0 pairs, Microsoft's table or Apple's, summed across its horizontal subtables. */
function readKern(bytes: Bytes, table: TableRecord | undefined): (left: number, right: number) => number {
  const none = (): number => 0;
  if (!table) return none;
  const base = table.offset;
  const subtables: Array<{ pairs: number; at: number; override: boolean }> = [];
  if (bytes.u16(base) === 0) {
    const count = bytes.u16(base + 2);
    let at = base + 4;
    for (let i = 0; i < count; i++) {
      const length = bytes.u16(at + 2);
      const coverage = bytes.u16(at + 4);
      const horizontal = (coverage & 1) === 1 && (coverage & 2) === 0 && (coverage & 4) === 0;
      if (horizontal && coverage >> 8 === 0) subtables.push({ pairs: bytes.u16(at + 6), at: at + 14, override: (coverage & 8) !== 0 });
      at += length;
    }
  } else if (bytes.u32(base) === 0x00010000) {
    const count = bytes.u32(base + 4);
    let at = base + 8;
    for (let i = 0; i < count; i++) {
      const length = bytes.u32(at);
      const coverage = bytes.u16(at + 4);
      const horizontal = (coverage & 0x8000) === 0 && (coverage & 0x4000) === 0 && (coverage & 0x2000) === 0;
      if (horizontal && (coverage & 0xff) === 0) subtables.push({ pairs: bytes.u16(at + 8), at: at + 16, override: false });
      at += length;
    }
  }
  if (subtables.length === 0) return none;
  const find = (sub: { pairs: number; at: number }, key: number): number | null => {
    let lo = 0;
    let hi = sub.pairs - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = sub.at + mid * 6;
      const pair = bytes.u32(at);
      if (pair < key) lo = mid + 1;
      else if (pair > key) hi = mid - 1;
      else return bytes.i16(at + 4);
    }
    return null;
  };
  return (left, right) => {
    const key = ((left & 0xffff) << 16 | (right & 0xffff)) >>> 0;
    let value = 0;
    for (const sub of subtables) {
      const found = find(sub, key);
      if (found === null) continue;
      value = sub.override ? found : value + found;
    }
    return value;
  };
}

// ---- Outlines as anchors -------------------------------------------------------------------------

type Pt = { x: number; y: number };

/** Builds contours of anchors from moves, lines and cubics; each closes back to where it began. */
class ContourBuilder {
  readonly contours: VectorAnchor[][] = [];
  private current: VectorAnchor[] | null = null;

  moveTo(p: Pt): void {
    this.close();
    this.current = [{ p: { x: p.x, y: p.y } }];
  }

  lineTo(p: Pt): void {
    if (!this.current) this.moveTo({ x: 0, y: 0 });
    this.current!.push({ p: { x: p.x, y: p.y } });
  }

  curveTo(c1: Pt, c2: Pt, p: Pt): void {
    if (!this.current) this.moveTo({ x: 0, y: 0 });
    const contour = this.current!;
    contour[contour.length - 1].hOut = { x: c1.x, y: c1.y };
    contour.push({ p: { x: p.x, y: p.y }, hIn: { x: c2.x, y: c2.y } });
  }

  /** A quadratic from the pen through `q` to `p`, raised to the cubic that draws it exactly. */
  quadTo(q: Pt, p: Pt): void {
    if (!this.current) this.moveTo({ x: 0, y: 0 });
    const contour = this.current!;
    const from = contour[contour.length - 1].p;
    this.curveTo(
      { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) },
      { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
      p,
    );
  }

  /** Ends the contour: a last anchor back on the first merges into it, and a contour of one point is dropped. */
  close(): void {
    const contour = this.current;
    this.current = null;
    if (!contour) return;
    if (contour.length > 1) {
      const first = contour[0];
      const last = contour[contour.length - 1];
      if (Math.abs(first.p.x - last.p.x) < 1e-9 && Math.abs(first.p.y - last.p.y) < 1e-9) {
        if (last.hIn) first.hIn = last.hIn;
        contour.pop();
      }
    }
    if (contour.length > 1 || (contour.length === 1 && (contour[0].hIn || contour[0].hOut))) this.contours.push(contour);
  }
}

// ---- TrueType -------------------------------------------------------------------------------------

/** A TrueType point: on the curve, or a quadratic's control point. */
interface QuadPoint {
  x: number;
  y: number;
  on: boolean;
}

/** One glyph's contours as points, a composite's children placed and transformed. */
function glyfPoints(face: OpenFace, glyphId: number, depth: number): QuadPoint[][] {
  if (depth > 16) throw new GlyphError('its composite glyphs nest too deep');
  const { bytes } = face;
  const loca = face.table('loca');
  const glyf = face.table('glyf');
  if (!loca || !glyf) return [];
  if (glyphId < 0 || glyphId >= face.numGlyphs) return [];
  const long = face.indexToLocFormat !== 0;
  const start = long ? bytes.u32(loca.offset + glyphId * 4) : bytes.u16(loca.offset + glyphId * 2) * 2;
  const end = long ? bytes.u32(loca.offset + glyphId * 4 + 4) : bytes.u16(loca.offset + glyphId * 2 + 2) * 2;
  if (end <= start) return [];
  const at = glyf.offset + start;
  const contourCount = bytes.i16(at);
  if (contourCount >= 0) {
    const contours = simpleGlyph(bytes, at, contourCount);
    // A glyph drawn on its own has its origin where its left side bearing says (phantom point 1): one
    // whose `xMin` differs from its `hmtx` bearing is drawn shifted by the difference, as fontTools and
    // the rasterizers draw it. A component of a composite is placed by the composite, and is not.
    const shift = depth === 0 ? face.leftSideBearing(glyphId) - bytes.i16(at + 2) : 0;
    return shift === 0 ? contours : contours.map((contour) => contour.map((q) => ({ x: q.x + shift, y: q.y, on: q.on })));
  }

  // A composite: each component a glyph, offset and transformed, or placed so a point of it meets a point of what came before.
  const out: QuadPoint[][] = [];
  let p = at + 10;
  for (let guard = 0; guard < 1024; guard++) {
    const flags = bytes.u16(p);
    const child = bytes.u16(p + 2);
    p += 4;
    const words = (flags & 0x0001) !== 0;
    const xy = (flags & 0x0002) !== 0;
    let arg1: number;
    let arg2: number;
    if (words) {
      arg1 = xy ? bytes.i16(p) : bytes.u16(p);
      arg2 = xy ? bytes.i16(p + 2) : bytes.u16(p + 2);
      p += 4;
    } else {
      arg1 = xy ? bytes.i8(p) : bytes.u8(p);
      arg2 = xy ? bytes.i8(p + 1) : bytes.u8(p + 1);
      p += 2;
    }
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    if (flags & 0x0008) {
      a = d = bytes.f2dot14(p);
      p += 2;
    } else if (flags & 0x0040) {
      a = bytes.f2dot14(p);
      d = bytes.f2dot14(p + 2);
      p += 4;
    } else if (flags & 0x0080) {
      a = bytes.f2dot14(p);
      b = bytes.f2dot14(p + 2);
      c = bytes.f2dot14(p + 4);
      d = bytes.f2dot14(p + 6);
      p += 8;
    }
    const placed = glyfPoints(face, child, depth + 1).map((contour) => contour.map((q) => ({ x: a * q.x + c * q.y, y: b * q.x + d * q.y, on: q.on })));
    let dx: number;
    let dy: number;
    if (xy) {
      dx = arg1;
      dy = arg2;
      // Apple's fonts may ask for the offset to be scaled with the component, as FreeType scales it -
      // each by the length of its column of the transform; Microsoft's leave it as it is.
      if ((flags & 0x0800) !== 0 && (flags & 0x1000) === 0) {
        dx = arg1 * Math.hypot(a, c);
        dy = arg2 * Math.hypot(b, d);
      }
    } else {
      const parent = out.flat();
      const own = placed.flat();
      const anchor = parent[arg1];
      const point = own[arg2];
      if (!anchor || !point) throw new GlyphError('a composite glyph matches points it does not have');
      dx = anchor.x - point.x;
      dy = anchor.y - point.y;
    }
    for (const contour of placed) out.push(contour.map((q) => ({ x: q.x + dx, y: q.y + dy, on: q.on })));
    if ((flags & 0x0020) === 0) break;
  }
  return out;
}

/** A simple glyph's contours: its flags, then its x and y coordinates as deltas. */
function simpleGlyph(bytes: Bytes, at: number, contourCount: number): QuadPoint[][] {
  let p = at + 10;
  const ends: number[] = [];
  for (let i = 0; i < contourCount; i++) ends.push(bytes.u16(p + i * 2));
  p += contourCount * 2;
  const pointCount = contourCount > 0 ? ends[contourCount - 1] + 1 : 0;
  // Skip the hinting instructions.
  p += 2 + bytes.u16(p);
  const flags: number[] = [];
  while (flags.length < pointCount) {
    const flag = bytes.u8(p++);
    flags.push(flag);
    if (flag & 8) {
      for (let repeat = bytes.u8(p++); repeat > 0 && flags.length < pointCount; repeat--) flags.push(flag);
    }
  }
  const xs: number[] = [];
  let x = 0;
  for (const flag of flags) {
    if (flag & 2) {
      const delta = bytes.u8(p++);
      x += flag & 16 ? delta : -delta;
    } else if (!(flag & 16)) {
      x += bytes.i16(p);
      p += 2;
    }
    xs.push(x);
  }
  const ys: number[] = [];
  let y = 0;
  for (const flag of flags) {
    if (flag & 4) {
      const delta = bytes.u8(p++);
      y += flag & 32 ? delta : -delta;
    } else if (!(flag & 32)) {
      y += bytes.i16(p);
      p += 2;
    }
    ys.push(y);
  }
  const contours: QuadPoint[][] = [];
  let start = 0;
  for (const end of ends) {
    if (end < start || end >= pointCount) throw new GlyphError('its contours are out of order');
    const contour: QuadPoint[] = [];
    for (let i = start; i <= end; i++) contour.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
    contours.push(contour);
    start = end + 1;
  }
  return contours;
}

/**
 * TrueType contours as cubic anchors: two control points in a row imply the
 * on-curve point midway between them; a contour of control points alone
 * starts at the first such midpoint.
 */
function quadContours(contours: QuadPoint[][]): VectorAnchor[][] {
  const builder = new ContourBuilder();
  for (const contour of contours) {
    const n = contour.length;
    if (n === 0) continue;
    const points: QuadPoint[] = [];
    for (let i = 0; i < n; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % n];
      points.push(a);
      if (!a.on && !b.on) points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
    }
    const first = points.findIndex((q) => q.on);
    if (first < 0) continue;
    const m = points.length;
    const at = (k: number): QuadPoint => points[(first + k) % m];
    builder.moveTo(at(0));
    for (let k = 1; k <= m; ) {
      const q = at(k);
      if (q.on) {
        builder.lineTo(q);
        k++;
      } else {
        builder.quadTo(q, at(k + 1));
        k += 2;
      }
    }
    builder.close();
  }
  return builder.contours;
}

// ---- CFF ---------------------------------------------------------------------------------------------

/** A CFF INDEX: where each of its items starts and ends. */
interface CffIndex {
  readonly items: ReadonlyArray<{ start: number; end: number }>;
  readonly end: number;
}

function readIndex(bytes: Bytes, at: number): CffIndex {
  const count = bytes.u16(at);
  if (count === 0) return { items: [], end: at + 2 };
  const offSize = bytes.u8(at + 2);
  if (offSize < 1 || offSize > 4) throw new Truncated('a CFF INDEX with no offset size');
  const offsets = at + 3;
  const offset = (i: number): number => {
    let value = 0;
    for (let k = 0; k < offSize; k++) value = value * 256 + bytes.u8(offsets + i * offSize + k);
    return value;
  };
  const data = offsets + (count + 1) * offSize - 1;
  const items: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) items.push({ start: data + offset(i), end: data + offset(i + 1) });
  return { items, end: data + offset(count) };
}

/** A CFF DICT: each operator (escaped ones as 1200 + the second byte) with its operands. */
function readDict(bytes: Bytes, start: number, end: number): Map<number, number[]> {
  const dict = new Map<number, number[]>();
  let operands: number[] = [];
  let p = start;
  while (p < end) {
    const b0 = bytes.u8(p);
    if (b0 <= 21) {
      let op = b0;
      p++;
      if (b0 === 12) op = 1200 + bytes.u8(p++);
      dict.set(op, operands);
      operands = [];
    } else if (b0 === 28) {
      operands.push(bytes.i16(p + 1));
      p += 3;
    } else if (b0 === 29) {
      operands.push(bytes.i32(p + 1));
      p += 5;
    } else if (b0 === 30) {
      // A real number, in nibbles: digits, a point, an exponent, a minus.
      let text = '';
      p++;
      for (let done = false; !done; ) {
        const byte = bytes.u8(p++);
        for (const nibble of [byte >> 4, byte & 15]) {
          if (nibble === 15) {
            done = true;
            break;
          }
          text += nibble <= 9 ? String(nibble) : nibble === 10 ? '.' : nibble === 11 ? 'E' : nibble === 12 ? 'E-' : nibble === 14 ? '-' : '';
        }
      }
      operands.push(Number.parseFloat(text));
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      p++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + bytes.u8(p + 1) + 108);
      p += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - bytes.u8(p + 1) - 108);
      p += 2;
    } else {
      throw new Truncated(`a CFF DICT with the byte ${b0}`);
    }
  }
  return dict;
}

/** What a CFF face's charstrings need: the strings, the subroutines, and each glyph's own for a CID-keyed font. */
interface CffData {
  readonly charStrings: CffIndex;
  readonly globalSubrs: CffIndex;
  /** The local subroutines, by glyph: one INDEX for a name-keyed font, each glyph's font DICT's for a CID-keyed one. */
  localSubrs(glyphId: number): CffIndex;
  /** Charstring units to font units: the FontMatrix times the em, `[a, b, c, d, e, f]`. */
  readonly matrix: readonly number[];
}

const EMPTY_INDEX: CffIndex = { items: [], end: 0 };

/** A Private DICT's local subroutines, which it places from its own start. */
function privateSubrs(bytes: Bytes, cff: number, privateEntry: number[] | undefined): CffIndex {
  if (!privateEntry || privateEntry.length < 2) return EMPTY_INDEX;
  const [size, offset] = privateEntry;
  const start = cff + offset;
  const dict = readDict(bytes, start, start + size);
  const subrs = dict.get(19);
  return subrs ? readIndex(bytes, start + subrs[0]) : EMPTY_INDEX;
}

function readCff(bytes: Bytes, table: TableRecord, unitsPerEm: number, numGlyphs: number): CffData | string {
  const base = table.offset;
  if (bytes.u8(base) !== 1) return `its CFF table is version ${bytes.u8(base)}`;
  const names = readIndex(bytes, base + bytes.u8(base + 2));
  const topDicts = readIndex(bytes, names.end);
  const strings = readIndex(bytes, topDicts.end);
  const globalSubrs = readIndex(bytes, strings.end);
  const topItem = topDicts.items[0];
  if (!topItem) return 'its CFF table has no font in it';
  const top = readDict(bytes, topItem.start, topItem.end);
  const type = top.get(1206)?.[0] ?? 2;
  if (type !== 2) return `its charstrings are of type ${type}, not Type 2`;
  const charStringsAt = top.get(17)?.[0];
  if (charStringsAt === undefined) return 'its CFF table has no charstrings';
  const charStrings = readIndex(bytes, base + charStringsAt);
  if (charStrings.items.length < numGlyphs) return 'its CFF table has fewer glyphs than the font says';
  const fm = top.get(1207) ?? [0.001, 0, 0, 0.001, 0, 0];
  const matrix = fm.map((v) => v * unitsPerEm);

  if (!top.has(1230)) {
    const subrs = privateSubrs(bytes, base, top.get(18));
    return { charStrings, globalSubrs, localSubrs: () => subrs, matrix };
  }
  // CID-keyed: each glyph's font DICT, chosen by FDSelect, has its own Private DICT and subroutines.
  const fdArrayAt = top.get(1236)?.[0];
  const fdSelectAt = top.get(1237)?.[0];
  if (fdArrayAt === undefined || fdSelectAt === undefined) return 'its CID-keyed CFF table has no font DICTs';
  const fdArray = readIndex(bytes, base + fdArrayAt);
  const fdSubrs = fdArray.items.map((item) => privateSubrs(bytes, base, readDict(bytes, item.start, item.end).get(18)));
  const select = base + fdSelectAt;
  const format = bytes.u8(select);
  let fdOf: (glyphId: number) => number;
  if (format === 0) {
    fdOf = (glyphId) => bytes.u8(select + 1 + glyphId);
  } else if (format === 3) {
    const ranges = bytes.u16(select + 1);
    fdOf = (glyphId) => {
      let lo = 0;
      let hi = ranges - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const first = bytes.u16(select + 3 + mid * 3);
        const next = bytes.u16(select + 3 + (mid + 1) * 3);
        if (glyphId < first) hi = mid - 1;
        else if (glyphId >= next) lo = mid + 1;
        else return bytes.u8(select + 3 + mid * 3 + 2);
      }
      return 0;
    };
  } else {
    return `its CID-keyed CFF table selects font DICTs in format ${format}`;
  }
  return { charStrings, globalSubrs, localSubrs: (glyphId) => fdSubrs[fdOf(glyphId)] ?? EMPTY_INDEX, matrix };
}

/** The bias added to a subroutine's number, by how many there are. */
function subrBias(count: number): number {
  return count < 1240 ? 107 : count < 33900 ? 1131 : 32768;
}

/** Runs a glyph's Type 2 charstring into contours, in charstring units. */
function cffContours(bytes: Bytes, cff: CffData, glyphId: number): VectorAnchor[][] {
  const item = cff.charStrings.items[glyphId];
  if (!item) return [];
  const local = cff.localSubrs(glyphId);
  const builder = new ContourBuilder();
  const stack: number[] = [];
  const storage: number[] = [];
  let x = 0;
  let y = 0;
  let stems = 0;
  let width = false;
  let open = false;
  const move = (dx: number, dy: number): void => {
    x += dx;
    y += dy;
    builder.moveTo({ x, y });
    open = true;
  };
  const line = (dx: number, dy: number): void => {
    x += dx;
    y += dy;
    builder.lineTo({ x, y });
  };
  const curve = (dxa: number, dya: number, dxb: number, dyb: number, dxc: number, dyc: number): void => {
    const c1 = { x: x + dxa, y: y + dya };
    const c2 = { x: c1.x + dxb, y: c1.y + dyb };
    x = c2.x + dxc;
    y = c2.y + dyc;
    builder.curveTo(c1, c2, { x, y });
  };
  /**
   * The first stack-clearing operator may carry the advance width before its
   * own operands: one more than it takes. `even` is whether it takes an even
   * number - the stems' pairs, rmoveto's two, endchar's none - or an odd one,
   * hmoveto's and vmoveto's one.
   */
  const takeWidth = (even: boolean): void => {
    if (!width && stack.length > 0 && (stack.length % 2 === 1) === even) stack.shift();
    width = true;
  };
  const hints = (): void => {
    takeWidth(true);
    stems += stack.length >> 1;
    stack.length = 0;
  };
  const run = (code: { start: number; end: number }, depth: number): 'end' | null => {
    if (depth > 10) throw new GlyphError('its charstring calls subroutines too deep');
    let p = code.start;
    while (p < code.end) {
      const b0 = bytes.u8(p++);
      if (b0 >= 32 || b0 === 28) {
        if (b0 === 28) {
          stack.push(bytes.i16(p));
          p += 2;
        } else if (b0 <= 246) stack.push(b0 - 139);
        else if (b0 <= 250) stack.push((b0 - 247) * 256 + bytes.u8(p++) + 108);
        else if (b0 <= 254) stack.push(-(b0 - 251) * 256 - bytes.u8(p++) - 108);
        else {
          stack.push(bytes.fixed(p));
          p += 4;
        }
        if (stack.length > 48) throw new GlyphError('its charstring overflows the stack');
        continue;
      }
      const s = stack;
      switch (b0) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          hints();
          break;
        case 19: // hintmask
        case 20: // cntrmask
          hints();
          p += (stems + 7) >> 3;
          break;
        case 21: // rmoveto
          takeWidth(true);
          if (open) builder.close();
          move(s[s.length - 2] ?? 0, s[s.length - 1] ?? 0);
          s.length = 0;
          break;
        case 22: // hmoveto
          takeWidth(false);
          if (open) builder.close();
          move(s[s.length - 1] ?? 0, 0);
          s.length = 0;
          break;
        case 4: // vmoveto
          takeWidth(false);
          if (open) builder.close();
          move(0, s[s.length - 1] ?? 0);
          s.length = 0;
          break;
        case 5: // rlineto
          for (let i = 0; i + 1 < s.length; i += 2) line(s[i], s[i + 1]);
          s.length = 0;
          break;
        case 6: // hlineto
        case 7: {
          // vlineto
          let horizontal = b0 === 6;
          for (const d of s) {
            if (horizontal) line(d, 0);
            else line(0, d);
            horizontal = !horizontal;
          }
          s.length = 0;
          break;
        }
        case 8: // rrcurveto
          for (let i = 0; i + 5 < s.length; i += 6) curve(s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5]);
          s.length = 0;
          break;
        case 24: {
          // rcurveline
          let i = 0;
          for (; i + 7 < s.length; i += 6) curve(s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5]);
          line(s[i], s[i + 1]);
          s.length = 0;
          break;
        }
        case 25: {
          // rlinecurve
          let i = 0;
          for (; i + 7 < s.length; i += 2) line(s[i], s[i + 1]);
          curve(s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5]);
          s.length = 0;
          break;
        }
        case 26: {
          // vvcurveto
          let i = 0;
          let dx1 = 0;
          if (s.length % 2) dx1 = s[i++];
          for (; i + 3 < s.length; i += 4) {
            curve(dx1, s[i], s[i + 1], s[i + 2], 0, s[i + 3]);
            dx1 = 0;
          }
          s.length = 0;
          break;
        }
        case 27: {
          // hhcurveto
          let i = 0;
          let dy1 = 0;
          if (s.length % 2) dy1 = s[i++];
          for (; i + 3 < s.length; i += 4) {
            curve(s[i], dy1, s[i + 1], s[i + 2], s[i + 3], 0);
            dy1 = 0;
          }
          s.length = 0;
          break;
        }
        case 30: // vhcurveto
        case 31: {
          // hvcurveto
          let horizontal = b0 === 31;
          let i = 0;
          while (i + 3 < s.length) {
            const last = s.length - i === 5 ? s[i + 4] : 0;
            if (horizontal) curve(s[i], 0, s[i + 1], s[i + 2], last, s[i + 3]);
            else curve(0, s[i], s[i + 1], s[i + 2], s[i + 3], last);
            i += 4;
            horizontal = !horizontal;
          }
          s.length = 0;
          break;
        }
        case 10: {
          // callsubr
          const index = (s.pop() ?? 0) + subrBias(local.items.length);
          const subr = local.items[index];
          if (!subr) throw new GlyphError('its charstring calls a subroutine it does not have');
          if (run(subr, depth + 1) === 'end') return 'end';
          break;
        }
        case 29: {
          // callgsubr
          const index = (s.pop() ?? 0) + subrBias(cff.globalSubrs.items.length);
          const subr = cff.globalSubrs.items[index];
          if (!subr) throw new GlyphError('its charstring calls a global subroutine it does not have');
          if (run(subr, depth + 1) === 'end') return 'end';
          break;
        }
        case 11: // return
          return null;
        case 14: // endchar
          if (s.length === 4 || s.length === 5) throw new GlyphError("it is an accented glyph built by the old 'seac' operator, which is not read");
          takeWidth(true);
          if (open) builder.close();
          open = false;
          s.length = 0;
          return 'end';
        case 12: {
          const b1 = bytes.u8(p++);
          escape(b1, s);
          break;
        }
        default:
          throw new GlyphError(`its charstring uses the operator ${b0}, which is not read`);
      }
    }
    return null;
  };
  /** The two-byte operators: the flexes, which draw two curves, and the arithmetic few fonts use. */
  const escape = (op: number, s: number[]): void => {
    switch (op) {
      case 35: // flex
        curve(s[0], s[1], s[2], s[3], s[4], s[5]);
        curve(s[6], s[7], s[8], s[9], s[10], s[11]);
        s.length = 0;
        return;
      case 34: // hflex: level ends, the second curve undoing the first's rise
        curve(s[0], 0, s[1], s[2], s[3], 0);
        curve(s[4], 0, s[5], -s[2], s[6], 0);
        s.length = 0;
        return;
      case 36: // hflex1: the last point back on the level the flex began at
        curve(s[0], s[1], s[2], s[3], s[4], 0);
        curve(s[5], 0, s[6], s[7], s[8], -(s[1] + s[3] + s[7]));
        s.length = 0;
        return;
      case 37: {
        // flex1: the last point's lesser coordinate returns to where the flex began
        let dx = 0;
        let dy = 0;
        for (let i = 0; i < 10; i += 2) {
          dx += s[i];
          dy += s[i + 1];
        }
        curve(s[0], s[1], s[2], s[3], s[4], s[5]);
        if (Math.abs(dx) > Math.abs(dy)) curve(s[6], s[7], s[8], s[9], s[10], -dy);
        else curve(s[6], s[7], s[8], s[9], -dx, s[10]);
        s.length = 0;
        return;
      }
      case 3: // and
        s.push((s.pop() ? 1 : 0) & (s.pop() ? 1 : 0));
        return;
      case 4: // or
        s.push((s.pop() ? 1 : 0) | (s.pop() ? 1 : 0));
        return;
      case 5: // not
        s.push(s.pop() ? 0 : 1);
        return;
      case 9: // abs
        s.push(Math.abs(s.pop() ?? 0));
        return;
      case 10: {
        // add
        const b = s.pop() ?? 0;
        s.push((s.pop() ?? 0) + b);
        return;
      }
      case 11: {
        // sub
        const b = s.pop() ?? 0;
        s.push((s.pop() ?? 0) - b);
        return;
      }
      case 12: {
        // div
        const b = s.pop() ?? 1;
        s.push((s.pop() ?? 0) / (b || 1));
        return;
      }
      case 14: // neg
        s.push(-(s.pop() ?? 0));
        return;
      case 15: {
        // eq
        const b = s.pop();
        s.push(s.pop() === b ? 1 : 0);
        return;
      }
      case 18: // drop
        s.pop();
        return;
      case 20: {
        // put
        const index = s.pop() ?? 0;
        storage[index] = s.pop() ?? 0;
        return;
      }
      case 21: // get
        s.push(storage[s.pop() ?? 0] ?? 0);
        return;
      case 22: {
        // ifelse
        const v2 = s.pop() ?? 0;
        const v1 = s.pop() ?? 0;
        const s2 = s.pop() ?? 0;
        const s1 = s.pop() ?? 0;
        s.push(v1 <= v2 ? s1 : s2);
        return;
      }
      case 23: // random: a fixed draw, so an outline is the same each time it is read
        s.push(0.5);
        return;
      case 24: {
        // mul
        const b = s.pop() ?? 0;
        s.push((s.pop() ?? 0) * b);
        return;
      }
      case 26: // sqrt
        s.push(Math.sqrt(Math.max(0, s.pop() ?? 0)));
        return;
      case 27: // dup
        s.push(s[s.length - 1] ?? 0);
        return;
      case 28: {
        // exch
        const b = s.pop() ?? 0;
        const a = s.pop() ?? 0;
        s.push(b, a);
        return;
      }
      case 29: {
        // index
        const i = s.pop() ?? 0;
        s.push(s[s.length - 1 - Math.max(0, i)] ?? 0);
        return;
      }
      case 30: {
        // roll
        const j = s.pop() ?? 0;
        const n = s.pop() ?? 0;
        if (n > 0 && n <= s.length) {
          const part = s.splice(s.length - n, n);
          const shift = ((j % n) + n) % n;
          s.push(...part.slice(n - shift), ...part.slice(0, n - shift));
        }
        return;
      }
      default:
        throw new GlyphError(`its charstring uses the operator 12 ${op}, which is not read`);
    }
  };
  run(item, 0);
  if (open) builder.close();
  return builder.contours;
}

// ---- Faces ------------------------------------------------------------------------------------------

/** A glyph that cannot be read, and why. */
class GlyphError extends Error {}

/** An open face: what {@link SfntFace} shows, and what the outline readers need. */
class OpenFace implements SfntFace {
  readonly format: 'truetype' | 'cff';
  readonly postscriptName: string;
  readonly family: string;
  readonly style: string;
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly note: string | null;
  readonly indexToLocFormat: number;
  readonly cff: CffData | null;
  private readonly cmap: CharMap;
  private readonly metricCount: number;
  private readonly kern: (left: number, right: number) => number;

  constructor(
    readonly bytes: Bytes,
    private readonly tables: Map<string, TableRecord>,
    names: Map<number, string>,
    note: string | null,
  ) {
    const head = this.need('head');
    const maxp = this.need('maxp');
    const hhea = this.need('hhea');
    this.need('hmtx');
    this.unitsPerEm = bytes.u16(head.offset + 18);
    if (this.unitsPerEm < 16 || this.unitsPerEm > 16384) throw new FaceError(`its em of ${this.unitsPerEm} units is out of range`);
    this.indexToLocFormat = bytes.i16(head.offset + 50);
    this.numGlyphs = bytes.u16(maxp.offset + 4);
    this.ascender = bytes.i16(hhea.offset + 4);
    this.descender = bytes.i16(hhea.offset + 6);
    this.lineGap = bytes.i16(hhea.offset + 8);
    this.metricCount = Math.max(1, bytes.u16(hhea.offset + 34));
    const cmap = readCmap(bytes, tables.get('cmap'));
    if (!cmap) throw new FaceError('it has no Unicode character map');
    this.cmap = cmap;
    this.kern = readKern(bytes, tables.get('kern'));
    this.postscriptName = names.get(6) ?? '';
    this.family = names.get(16) ?? names.get(1) ?? '';
    this.style = names.get(17) ?? names.get(2) ?? '';
    this.note = note;
    if (tables.has('glyf') && tables.has('loca')) {
      this.format = 'truetype';
      this.cff = null;
    } else if (tables.has('CFF ')) {
      this.format = 'cff';
      const cff = readCff(bytes, tables.get('CFF ')!, this.unitsPerEm, this.numGlyphs);
      if (typeof cff === 'string') throw new FaceError(cff);
      this.cff = cff;
    } else if (tables.has('CFF2')) {
      throw new FaceError('its outlines are CFF2, which is not read');
    } else {
      throw new FaceError('it has no outlines - a bitmap or color font');
    }
  }

  table(tag: string): TableRecord | undefined {
    return this.tables.get(tag);
  }

  private need(tag: string): TableRecord {
    const table = this.tables.get(tag);
    if (!table) throw new FaceError(`it has no '${tag}' table`);
    return table;
  }

  glyphId(codePoint: number): number {
    try {
      const id = this.cmap(codePoint);
      return id < this.numGlyphs ? id : 0;
    } catch {
      return 0;
    }
  }

  advance(glyphId: number): number {
    const hmtx = this.tables.get('hmtx')!;
    const index = Math.min(Math.max(0, glyphId), this.metricCount - 1);
    try {
      return this.bytes.u16(hmtx.offset + index * 4);
    } catch {
      return 0;
    }
  }

  kerning(left: number, right: number): number {
    try {
      return this.kern(left, right);
    } catch {
      return 0;
    }
  }

  /** A glyph's left side bearing in `hmtx`: the long metrics' for the first glyphs, the bearings array's for the rest. */
  leftSideBearing(glyphId: number): number {
    const hmtx = this.tables.get('hmtx')!;
    try {
      if (glyphId < this.metricCount) return this.bytes.i16(hmtx.offset + glyphId * 4 + 2);
      return this.bytes.i16(hmtx.offset + this.metricCount * 4 + (glyphId - this.metricCount) * 2);
    } catch {
      return 0;
    }
  }
}

/** A face that cannot be opened, and why. */
class FaceError extends Error {}

/** The PostScript name of the face at `base`, and its variation instances' names when it is a variable font. */
function faceNamesAt(bytes: Bytes, base: number): { name: string; instances: Array<{ name: string; isDefault: boolean }> } {
  const tables = tablesAt(bytes, base);
  const names = readNames(bytes, tables.get('name'));
  return { name: names.get(6) ?? '', instances: instancesOf(bytes, tables, names) };
}

/** A variable font's named instances: each one's PostScript name, where the font gives one, and whether it is the default. */
function instancesOf(bytes: Bytes, tables: Map<string, TableRecord>, names: Map<number, string>): Array<{ name: string; isDefault: boolean }> {
  const fvar = tables.get('fvar');
  if (!fvar) return [];
  const base = fvar.offset;
  const axesAt = base + bytes.u16(base + 4);
  const axisCount = bytes.u16(base + 8);
  const axisSize = bytes.u16(base + 10);
  const instanceCount = bytes.u16(base + 12);
  const instanceSize = bytes.u16(base + 14);
  const defaults: number[] = [];
  for (let i = 0; i < axisCount; i++) defaults.push(bytes.fixed(axesAt + i * axisSize + 8));
  const out: Array<{ name: string; isDefault: boolean }> = [];
  const instancesAt = axesAt + axisCount * axisSize;
  for (let i = 0; i < instanceCount; i++) {
    const at = instancesAt + i * instanceSize;
    const isDefault = defaults.every((value, k) => Math.abs(bytes.fixed(at + 4 + k * 4) - value) < 1e-6);
    const hasName = instanceSize >= 4 + axisCount * 4 + 2;
    const nameId = hasName ? bytes.u16(at + 4 + axisCount * 4) : 0xffff;
    const name = nameId !== 0xffff ? (names.get(nameId) ?? '') : '';
    out.push({ name, isDefault });
  }
  return out;
}

/** The PostScript names of the faces a font file holds: one for a font, each face's for a collection. */
export function sfntFaceNames(data: Uint8Array): string[] | SfntProblem {
  try {
    const bytes = new Bytes(data);
    return directories(bytes).map((base) => faceNamesAt(bytes, base).name);
  } catch (error) {
    return { problem: damaged(error) };
  }
}

function damaged(error: unknown): string {
  if (error instanceof Truncated || error instanceof RangeError) return 'the font file is damaged or cut short';
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens a face of a font file: the file's own, or a collection's by its
 * PostScript name - the first face when none is named. A variable font is
 * read at its default instance, which `note` says; a named instance other
 * than the default is a problem, its outlines being the default's moved by
 * deltas this reader does not apply.
 */
export function openSfnt(data: Uint8Array, postscriptName?: string): SfntFace | SfntProblem {
  try {
    const bytes = new Bytes(data);
    const bases = directories(bytes);
    let base = bases[0];
    let note: string | null = null;
    const wanted = postscriptName?.trim() ?? '';
    if (wanted !== '') {
      const faces = bases.map((at) => ({ at, ...faceNamesAt(bytes, at) }));
      const exact = faces.find((face) => face.name === wanted) ?? faces.find((face) => face.name.toLowerCase() === wanted.toLowerCase());
      if (exact) {
        base = exact.at;
      } else {
        const variable = faces.find((face) => face.instances.some((instance) => instance.name.toLowerCase() === wanted.toLowerCase()));
        if (variable) {
          const instance = variable.instances.find((each) => each.name.toLowerCase() === wanted.toLowerCase())!;
          if (!instance.isDefault) return { problem: `${wanted} is an instance of the variable font ${variable.name}, and only its default instance is read` };
          base = variable.at;
        } else if (bases.length > 1) {
          return { problem: `the collection has no face named ${wanted}` };
        } else if (faces[0].instances.length > 0) {
          return { problem: `${wanted} is an instance of the variable font ${faces[0].name}, and only its default instance is read` };
        }
      }
    }
    const problem = flavourProblem(bytes, base);
    if (problem) return { problem };
    const tables = tablesAt(bytes, base);
    const names = readNames(bytes, tables.get('name'));
    if (tables.has('fvar')) note = `${names.get(6) ?? 'the font'} is a variable font, read at its default instance`;
    return new OpenFace(bytes, tables, names, note);
  } catch (error) {
    return { problem: error instanceof FaceError ? error.message : damaged(error) };
  }
}

/**
 * One glyph's outline in font units, y up: TrueType's quadratics raised to
 * cubics, CFF's cubics as they are, a composite's components placed. An
 * empty glyph - a space - has no contours. A glyph the reader cannot read is
 * a problem, with the reason.
 */
export function glyphOutline(face: SfntFace, glyphId: number): GlyphOutline | SfntProblem {
  if (!(face instanceof OpenFace)) return { problem: 'the face was not opened by this reader' };
  try {
    const advance = face.advance(glyphId);
    if (face.format === 'truetype') return { contours: quadContours(glyfPoints(face, glyphId, 0)), advance };
    const cff = face.cff!;
    const contours = cffContours(face.bytes, cff, glyphId);
    const [a, b, c, d, e, f] = cff.matrix;
    // The FontMatrix takes charstring units to the em; the em times its units is font units, as `hmtx` and `head` count them.
    // A matrix a converter wrote a hair off the usual one - 0.0009999996 for 0.001 - is the usual one.
    const identity = Math.abs(a - 1) < 1e-5 && Math.abs(b) < 1e-5 && Math.abs(c) < 1e-5 && Math.abs(d - 1) < 1e-5 && Math.abs(e) < 1e-3 && Math.abs(f) < 1e-3;
    if (identity) return { contours, advance };
    const map = (q: { x: number; y: number }): { x: number; y: number } => ({ x: a * q.x + c * q.y + e, y: b * q.x + d * q.y + f });
    return {
      contours: contours.map((contour) => contour.map((anchor) => ({ p: map(anchor.p), ...(anchor.hIn ? { hIn: map(anchor.hIn) } : {}), ...(anchor.hOut ? { hOut: map(anchor.hOut) } : {}) }))),
      advance,
    };
  } catch (error) {
    if (error instanceof GlyphError) return { problem: error.message };
    return { problem: damaged(error) };
  }
}
