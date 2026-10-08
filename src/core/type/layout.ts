/**
 * The type layout: where every character of a text mark goes, what it is set
 * in and how it is turned - `layoutType(stroke, measure)`. Every output draws
 * from it - the canvas, the SVG, the PDF, the Illustrator script, the PNG - so
 * a text mark breaks its lines in one place, and only the measure's advances
 * differ (core/type/measure.ts).
 *
 * - **Point type** (Sideless Typing) breaks lines only at `\n`. Its anchor,
 *   `points[0]`, is the top of its first line: the line's left end, its
 *   middle or its right end as the paragraph is aligned.
 * - **Area type** (Sheet Typing) fills its frame. The frame's inside is cut
 *   into bands, each as tall as its line; in each, the widest span the frame
 *   covers for the whole band is the line's box, less the inset and the
 *   paragraph's indents. A band with no room for a character is skipped. Text
 *   that does not fit is overset. A rectangle that grows to fit takes the
 *   text's height, as napkin's text boxes always have.
 * - **Path type** (Path Typing) sets one line along its path, from `start` to
 *   `end`, each character's middle on it, turned as its effect says. What
 *   runs past `end` is overset.
 * - **Vertical** text stacks upright characters top to bottom in columns that
 *   run right to left, its anchor the top right; the same engine runs it with
 *   its two axes swapped.
 *
 * Lines break greedily, after spaces, hyphens, dashes and slashes; a word
 * longer than its line breaks where the line ends. A paragraph that
 * hyphenates breaks a word that does not fit at a Liang point
 * (core/type/hyphenate.ts), no more than 3 lines in a row. Justified lines
 * spread their word spaces up to 133% of a space, then their letters; a
 * paragraph's last line is set left.
 *
 * Each character carries its tracking and kerning, its scales, its baseline
 * shift, its superscript or subscript (58.3% of the size, raised or lowered
 * 33.3% of it, a vector editor's defaults), all caps and small caps, and its
 * own turn about its middle. A glyph comes out as an origin - the left end of
 * its baseline - and a 2 by 2 transform about it, so a painter draws any of
 * them the same way.
 *
 * A line's box runs from its top - its baseline less its ascent - down by its
 * leading, or to its descent where that reaches further: a text mark from
 * before boxes exactly as it did, a line and a quarter of its size a line.
 */

import { curvatureAtLength, lengthTable, pointAtLength, tangentAtLength, type Vec } from '../arc-length.js';
import { sampleOutline } from '../path-data.js';
import type { Stroke, VectorAnchor } from '../types.js';
import { accentShown } from './accents.js';
import { hyphenationPoints, ILLUSTRATOR_LIMITS } from './hyphenate.js';
import { markdownShown, paragraphOf, paragraphStarts } from './markdown-flow.js';
import { HEADLESS_MEASURE, fontKey, type TypeFont, type TypeMeasure } from './measure.js';
import {
  AUTO_LEADING,
  baseAttrs,
  frameRectangle,
  paraAttrsOf,
  paragraphRanges,
  styleSegments,
  typeSpecOf,
  type CharAttrs,
  type ParaAttrs,
  type StyleSegment,
  type TypeSpec,
} from './model.js';

/** A box on the page. */
export interface TypeBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A 2 by 2 transform, `[a, b, c, d]`: a glyph's x axis goes to (a, b) and its y axis (down) to (c, d). */
export type GlyphMatrix = [number, number, number, number];

/** One character as the layout sets it. */
export interface TypeGlyph {
  /** Where it is in the text (UTF-16), or -1 for one the layout adds: the hyphen at a break. */
  index: number;
  /** What is drawn: the character after all caps and small caps. */
  ch: string;
  /** Its origin, the left end of its baseline, in page pixels. */
  x: number;
  y: number;
  /** Its width as the font sets it, before its own scale. */
  width: number;
  /** How far the pen moves past it along its line: its width scaled, its spacing, kerning and justification. */
  advance: number;
  /** Its transform about its origin: its turn, its scales and a path effect's slant. */
  matrix: GlyphMatrix;
  /** The turn in its transform, in degrees, as an SVG `rotate` list wants it. */
  rotation: number;
  /** Its horizontal and vertical scale, 1 for 100%. */
  hs: number;
  vs: number;
  font: TypeFont;
  color: string;
  /** Letter spacing after it, page pixels: what a painter setting a stretch as one string spaces it by. */
  tracking: number;
  /** For a space, what is added to the font's word space - word spacing and justification - page pixels. */
  wordSpace: number;
  /** Kerning by hand after it, page pixels: a stretch set as one string stops at it. */
  kern: number;
  /** How far its font reaches above and below its baseline, scaled. */
  ascent: number;
  descent: number;
  /** The line it is on. */
  line: number;
  /** Where its advance starts on its line's baseline, before any shift: where a caret before it stands. */
  pen: Vec;
  /** Which way its line runs there, and which way is down across it - toward the next line: unit vectors. */
  along: Vec;
  across: Vec;
  /** How far it sits off its line's baseline, against `across`: its baseline shift and a script's rise. */
  shift: number;
}

/** Where a glyph's caret stands: the start of its advance on the baseline, and the line's two directions there. */
interface CaretPlace {
  pen: Vec;
  along: Vec;
  across: Vec;
}

/** One line: the characters it holds, where its baseline is and how far it reaches. */
export interface TypeLine {
  paragraph: number;
  /** The text it holds, start to end (end not included). */
  start: number;
  end: number;
  /** Where its first character starts and its baseline. For vertical text, the column's middle and its top. */
  x: number;
  y: number;
  /** How long it is: its characters' advances, the spaces it ends with not counted. */
  width: number;
  ascent: number;
  descent: number;
  /** The leading it asks for: the most any of its characters do. */
  leading: number;
}

/** An underline or a strikethrough: a stretch of line. */
export interface TypeDecoration {
  kind: 'underline' | 'strike';
  from: Vec;
  to: Vec;
  thickness: number;
  color: string;
}

/** A background behind characters (a highlight) or behind a paragraph (a shade), as four corners. */
export interface TypeHighlight {
  kind: 'highlight' | 'shade';
  corners: [Vec, Vec, Vec, Vec];
  color: string;
}

/** A list paragraph's bullet or number, set before its first line. */
export interface TypeMarker {
  text: string;
  /** Where it starts, on the line's baseline. */
  x: number;
  y: number;
  width: number;
  font: TypeFont;
  color: string;
  paragraph: number;
}

/** Everything a text mark draws, where it draws it. */
export interface TypeLayout {
  kind: TypeSpec['kind'];
  orientation: 'horizontal' | 'vertical';
  glyphs: TypeGlyph[];
  lines: TypeLine[];
  decorations: TypeDecoration[];
  /** Shades first, then highlights: the order they are painted in, under the text. */
  highlights: TypeHighlight[];
  markers: TypeMarker[];
  /** The box it all covers: its lines, its glyphs and its frame or its path. */
  bounds: TypeBox;
  /** Some of the text did not fit: past the frame, or past the path's end. */
  overset: boolean;
  /** Area type's frame on the page - its outline, grown to fit when it grows - and its own paint. */
  frame?: { anchors: VectorAnchor[]; box: TypeBox; fill?: string; stroke?: string; width?: number };
  /** Path type's path on the page, and the same path as the text runs along it: backwards when flipped. */
  path?: { anchors: VectorAnchor[]; run: VectorAnchor[]; closed: boolean; length: number };
}

/** The share of a character's size a superscript or a subscript is set at, and the share of it it rises or falls. */
export const SCRIPT_SIZE = 0.583;
export const SCRIPT_SHIFT = 0.333;
/** The share of a capital's size a small capital is set at, where the measure cannot set them. */
export const SMALL_CAPS_SIZE = 0.7;
/** How far a list paragraph stands in a level, in ems of its first character. */
export const LIST_INDENT = 1.5;
/** How far a justified word space may grow: to 133% of its width. */
const JUSTIFY_MAX_SPACE = 1.33;
/** The most lines in a row a paragraph ends with a hyphen. */
const HYPHEN_RUN = 3;
/** How many times a line looks further down its frame for room before the text is overset. */
const MAX_TRIES = 2000;
/** Characters a line may break after, besides a space. */
const BREAK_AFTER = new Set(['-', '‐', '–', '—', '/']);
/** Where an underline and a strikethrough sit under and through a character, and how thick they are, in ems. */
const UNDERLINE_AT = 0.12;
const STRIKE_AT = -0.28;
const DECORATION_WIDTH = 0.06;

// ---- Characters -----------------------------------------------------------------------------------------

/** One character, measured, before it has a place. */
interface Item {
  index: number;
  ch: string;
  attrs: CharAttrs;
  font: TypeFont;
  /** Width as the font sets it, unscaled. */
  raw: number;
  /** Along the line: horizontally its scaled width and spacing; vertically its em, scaled, and spacing. */
  advance: number;
  tracking: number;
  kern: number;
  /** For a space, what word spacing adds to it. */
  wordExtra: number;
  space: boolean;
  /** A line may break after it. */
  breakAfter: boolean;
  /** How far it sits off its baseline, up (or, vertical, right) positive. */
  shift: number;
  hs: number;
  vs: number;
  /** Its own font's reach, scaled: its box. */
  ascent: number;
  descent: number;
  /** What it asks of its line, at its full size. */
  lineAscent: number;
  lineDescent: number;
  leading: number;
}

function isLower(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}

/** One character measured in its attributes. */
function measureItem(ch: string, index: number, attrs: CharAttrs, measure: TypeMeasure, vertical: boolean): Item {
  let display = attrs.caps === 'all' ? ch.toUpperCase() : ch;
  let size = attrs.fontSize * (attrs.position === 'normal' ? 1 : SCRIPT_SIZE);
  // Small capitals a measure cannot set itself are capitals, smaller.
  if (attrs.caps === 'small' && !measure.smallCaps && isLower(ch)) {
    display = ch.toUpperCase();
    size *= SMALL_CAPS_SIZE;
  }
  const font: TypeFont = {
    family: attrs.fontFamily,
    style: attrs.fontStyle,
    size,
    kerning: attrs.kerning === 'auto',
    smallCaps: attrs.caps === 'small' && measure.smallCaps,
  };
  const hs = attrs.hScale / 100;
  const vs = attrs.vScale / 100;
  const raw = measure.width(display, font);
  const space = ch === ' ';
  const tracking = (attrs.tracking / 1000) * size;
  const kern = (attrs.kern / 1000) * size;
  const own = measure.extent(font);
  const full = size === attrs.fontSize ? own : measure.extent({ ...font, size: attrs.fontSize });
  const script = attrs.position === 'superscript' ? SCRIPT_SHIFT : attrs.position === 'subscript' ? -SCRIPT_SHIFT : 0;
  const wordExtra = space && !vertical ? raw * (attrs.wordSpacing / 100 - 1) * hs : 0;
  // Vertically each character takes its em down the column, a space half of one.
  const along = vertical ? size * vs * (space ? (0.5 * attrs.wordSpacing) / 100 : 1) : raw * hs + wordExtra;
  return {
    index,
    ch: display,
    attrs,
    font,
    raw,
    advance: along + tracking + kern,
    tracking,
    kern,
    wordExtra,
    space,
    breakAfter: space || BREAK_AFTER.has(ch),
    shift: attrs.baselineShift + script * attrs.fontSize,
    hs,
    vs,
    ascent: own.ascent * vs,
    descent: own.descent * vs,
    lineAscent: vertical ? attrs.fontSize / 2 : full.ascent,
    lineDescent: vertical ? attrs.fontSize / 2 : full.descent,
    leading: attrs.leading === 'auto' ? AUTO_LEADING * attrs.fontSize : attrs.leading,
  };
}

/** The characters from `from` to `to`, measured, newlines left out; horizontally, with the font's pair kerning. */
function measureItems(text: string, segments: readonly StyleSegment[], from: number, to: number, measure: TypeMeasure, vertical: boolean): Item[] {
  const items: Item[] = [];
  for (const segment of segments) {
    if (segment.end <= from || segment.start >= to) continue;
    const end = Math.min(to, segment.end);
    for (let i = Math.max(from, segment.start); i < end; ) {
      const ch = String.fromCodePoint(text.codePointAt(i) ?? 32);
      const index = i;
      i += ch.length;
      if (ch !== '\n') items.push(measureItem(ch, index, segment.attrs, measure, vertical));
    }
  }
  if (!vertical) {
    // A pair in one font sets shorter, or longer, than its two characters apart: the difference goes to the first.
    for (let k = 0; k + 1 < items.length; k++) {
      const a = items[k];
      const b = items[k + 1];
      if (!a.font.kerning || a.space || b.space || fontKey(a.font) !== fontKey(b.font)) continue;
      const pair = measure.width(a.ch + b.ch, a.font) - a.raw - b.raw;
      if (Math.abs(pair) > 1e-9) a.advance += pair * a.hs;
    }
  }
  return items;
}

/** The attributes of the character at `at`: past the end, the last one's; with no text, the base. */
function attrsAt(segments: readonly StyleSegment[], base: CharAttrs, at: number): CharAttrs {
  for (const segment of segments) if (at < segment.end) return segment.attrs;
  return segments[segments.length - 1]?.attrs ?? base;
}

interface Metrics {
  ascent: number;
  descent: number;
  leading: number;
}

/** What an empty line asks for: the metrics of the character it would take. */
function emptyMetrics(attrs: CharAttrs, measure: TypeMeasure, vertical: boolean): Metrics & { font: TypeFont; attrs: CharAttrs } {
  const font: TypeFont = { family: attrs.fontFamily, style: attrs.fontStyle, size: attrs.fontSize, kerning: attrs.kerning === 'auto', smallCaps: false };
  const extent = measure.extent(font);
  return {
    font,
    attrs,
    ascent: vertical ? attrs.fontSize / 2 : extent.ascent,
    descent: vertical ? attrs.fontSize / 2 : extent.descent,
    leading: attrs.leading === 'auto' ? AUTO_LEADING * attrs.fontSize : attrs.leading,
  };
}

/** A line's metrics: the most its characters ask for. */
function lineMetrics(items: readonly Item[], empty: Metrics): Metrics {
  if (items.length === 0) return { ascent: empty.ascent, descent: empty.descent, leading: empty.leading };
  let ascent = 0;
  let descent = 0;
  let leading = 0;
  for (const it of items) {
    ascent = Math.max(ascent, it.lineAscent);
    descent = Math.max(descent, it.lineDescent);
    leading = Math.max(leading, it.leading);
  }
  return { ascent, descent, leading };
}

// ---- The frame -------------------------------------------------------------------------------------------

/** A frame's outline as rings of points, in the layout's axes: `a` along a line, `c` across lines. */
type Rings = Array<Array<{ a: number; c: number }>>;

/** The spans of `a` the rings cover on the line `c`, by the even-odd rule, in order. */
function spansAt(rings: Rings, c: number): Array<[number, number]> {
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      // Half open, so a corner on the line is counted once.
      if ((p.c <= c && q.c > c) || (q.c <= c && p.c > c)) xs.push(p.a + ((c - p.c) / (q.c - p.c)) * (q.a - p.a));
    }
  }
  xs.sort((m, n) => m - n);
  const spans: Array<[number, number]> = [];
  for (let k = 0; k + 1 < xs.length; k += 2) spans.push([xs[k], xs[k + 1]]);
  return spans;
}

/** Where two lists of spans overlap. */
function intersect(a: ReadonlyArray<[number, number]>, b: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi > lo) out.push([lo, hi]);
    }
  }
  return out.sort((m, n) => m[0] - n[0]);
}

/**
 * The widest span the frame covers for the whole of a band from `c0` to `c1`:
 * what it covers at the band's two edges and at every corner of its outline
 * between them, all at once. Null where it covers nothing all the way across.
 */
function bandSpan(rings: Rings, c0: number, c1: number): [number, number] | null {
  const rows = [c0 + 1e-7, c1 - 1e-7];
  for (const ring of rings) for (const p of ring) if (p.c > c0 && p.c < c1) rows.push(p.c);
  let spans: Array<[number, number]> | null = null;
  for (const row of rows) {
    const here = spansAt(rings, row);
    spans = spans ? intersect(spans, here) : here;
    if (spans.length === 0) return null;
  }
  let best: [number, number] | null = null;
  for (const span of spans ?? []) if (!best || span[1] - span[0] > best[1] - best[0]) best = span;
  return best;
}

// ---- Breaking lines -----------------------------------------------------------------------------------------

/** How many of a line's characters show: all but the spaces it ends with. */
function shownCount(items: readonly Item[]): number {
  let end = items.length;
  while (end > 0 && items[end - 1].space) end--;
  return end;
}

/** How long a line's shown characters are. */
function shownLength(items: readonly Item[]): number {
  let total = 0;
  for (let k = 0, end = shownCount(items); k < end; k++) total += items[k].advance;
  return total;
}

function widthOf(items: readonly Item[], from: number, to: number): number {
  let total = 0;
  for (let k = from; k < to; k++) total += items[k].advance;
  return total;
}

/**
 * Fills one line from `items[pos]` on, in `room`: as many whole words as fit,
 * the spaces after the last one hanging past it. A word that does not fit is
 * hyphenated where the paragraph allows it, or, alone on its line, broken
 * where the line ends; a line takes at least one character.
 */
function fillLine(items: readonly Item[], pos: number, room: number, hyphenate: boolean, measure: TypeMeasure): { end: number; hyphen: Item | null } {
  let used = 0;
  let lastBreak = -1;
  for (let k = pos; k < items.length; k++) {
    const it = items[k];
    if (it.space) {
      used += it.advance;
      lastBreak = k;
      continue;
    }
    if (k > pos && used + it.raw * it.hs > room + 1e-9) {
      const wordStart = lastBreak >= pos ? lastBreak + 1 : pos;
      if (hyphenate) {
        const cut = hyphenAt(items, wordStart, room - widthOf(items, pos, wordStart), measure);
        if (cut) return cut;
      }
      return { end: lastBreak >= pos ? lastBreak + 1 : k, hyphen: null };
    }
    used += it.advance;
    if (it.breakAfter && k + 1 < items.length) lastBreak = k;
  }
  return { end: items.length, hyphen: null };
}

/**
 * Where the word starting at `start` breaks with a hyphen so that its first
 * part and the hyphen fit in `room`: the last Liang point that does, the
 * word's letters alone weighed and its punctuation kept on it. Null where
 * none fits.
 */
function hyphenAt(items: readonly Item[], start: number, room: number, measure: TypeMeasure): { end: number; hyphen: Item } | null {
  let end = start;
  while (end < items.length && !items[end].space && !(items[end].breakAfter && end > start)) end++;
  const word = items.slice(start, end);
  let lead = 0;
  while (lead < word.length && !/^[A-Za-z]$/.test(word[lead].ch)) lead++;
  let tail = word.length;
  while (tail > lead && !/^[A-Za-z]$/.test(word[tail - 1].ch)) tail--;
  const letters = word.slice(lead, tail).map((it) => it.ch).join('');
  if (letters.length !== tail - lead) return null;
  const points = hyphenationPoints(letters, ILLUSTRATOR_LIMITS);
  for (let p = points.length - 1; p >= 0; p--) {
    const cut = start + lead + points[p];
    const before = items[cut - 1];
    const raw = measure.width('-', before.font);
    const hyphen: Item = { ...before, index: -1, ch: '-', raw, advance: raw * before.hs + before.tracking, kern: 0, wordExtra: 0, space: false, breakAfter: false };
    if (widthOf(items, start, cut) + hyphen.advance <= room + 1e-9) return { end: cut, hyphen };
  }
  return null;
}

/**
 * How a justified line takes up `room` more: its word spaces grow, each by
 * the same share of its width, up to 133% of it; what is left goes between its
 * letters. Spaces it ends with take nothing.
 */
function justify(items: readonly Item[], room: number): { word: number; letter: number } {
  if (room <= 1e-9) return { word: 0, letter: 0 };
  const shown = items.slice(0, shownCount(items));
  const spaces = shown.filter((it) => it.space).reduce((sum, it) => sum + it.raw * it.hs, 0);
  const most = spaces * (JUSTIFY_MAX_SPACE - 1);
  if (spaces > 0 && room <= most) return { word: room / spaces, letter: 0 };
  const gaps = shown.filter((it) => !it.space).length - 1;
  return { word: spaces > 0 ? JUSTIFY_MAX_SPACE - 1 : 0, letter: gaps > 0 ? (room - most) / gaps : 0 };
}

// ---- Lists ---------------------------------------------------------------------------------------------------

const BULLETS = ['•', '◦', '▪'];

/** The ways a numbered list counts, as its `marker` names them. */
const NUMBER_STYLES = ['1.', 'a.', 'i.'];

/** A number as a list at `level` counts it: as its `marker` says - `1.`, `a.` or `i.` - or by its level, 1., then a., then i., and round again. */
function listNumber(n: number, level: number, marker?: string): string {
  const chosen = marker === undefined ? -1 : NUMBER_STYLES.indexOf(marker);
  const style = chosen >= 0 ? chosen : (level - 1) % 3;
  if (style === 1) {
    let s = '';
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return `${s || 'a'}.`;
  }
  if (style === 2) {
    const romans: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    let k = n;
    for (const [value, letters] of romans) {
      while (k >= value) {
        s += letters;
        k -= value;
      }
    }
    return `${s || '0'}.`;
  }
  return `${n}.`;
}

/** Each paragraph's list marker: numbers count on through a list's paragraphs, each level its own count. */
function listMarkers(paras: readonly ParaAttrs[]): Array<string | null> {
  const counters: number[] = [];
  return paras.map((para) => {
    const list = para.list;
    if (!list) {
      counters.length = 0;
      return null;
    }
    // Back out to a shallower level: the deeper counts start again.
    counters.length = Math.min(counters.length, list.level);
    if (list.kind === 'bullet') return list.marker ?? BULLETS[(list.level - 1) % BULLETS.length];
    const was = counters[list.level - 1];
    const next = was === undefined ? (list.start ?? 1) : was + 1;
    counters[list.level - 1] = next;
    return listNumber(next, list.level, list.marker);
  });
}

// ---- Placing -------------------------------------------------------------------------------------------------

/** The engine's two directions: along a line, and across lines - for vertical text, down, and right to left. */
interface Axes {
  vertical: boolean;
  toAxes(p: Vec): { a: number; c: number };
  toPage(a: number, c: number): Vec;
}

const HORIZONTAL: Axes = { vertical: false, toAxes: (p) => ({ a: p.x, c: p.y }), toPage: (a, c) => ({ x: a, y: c }) };
const VERTICAL: Axes = { vertical: true, toAxes: (p) => ({ a: p.y, c: -p.x }), toPage: (a, c) => ({ x: -c, y: a }) };

/** Anchors moved by `dx`, `dy`: a frame or a path from relative to the mark's anchor onto the page. */
function placeAnchors(anchors: readonly VectorAnchor[], dx: number, dy: number): VectorAnchor[] {
  const move = (p: Vec): Vec => ({ x: p.x + dx, y: p.y + dy });
  return anchors.map((a) => ({ p: move(a.p), ...(a.hIn ? { hIn: move(a.hIn) } : {}), ...(a.hOut ? { hOut: move(a.hOut) } : {}), ...(a.move ? { move: true as const } : {}) }));
}

/** The box points cover. */
function boxOf(points: readonly Vec[]): TypeBox | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** A glyph's four corners on the page: its width along, from its ascent above its baseline to its descent below, through its transform. */
export function glyphCorners(glyph: Pick<TypeGlyph, 'x' | 'y' | 'width' | 'matrix' | 'ascent' | 'descent' | 'vs'>): [Vec, Vec, Vec, Vec] {
  const [a, b, c, d] = glyph.matrix;
  // Its ascent and descent are scaled already, and its transform scales them again: back to the font's.
  const up = glyph.ascent / (glyph.vs || 1);
  const down = glyph.descent / (glyph.vs || 1);
  const at = (u: number, v: number): Vec => ({ x: glyph.x + a * u + c * v, y: glyph.y + b * u + d * v });
  return [at(0, -up), at(glyph.width, -up), at(glyph.width, down), at(0, down)];
}

/** A turn and the scales as a glyph transform: scaled about its origin, then turned. */
function turned(degrees: number, hs: number, vs: number): GlyphMatrix {
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  // A screen turn: positive is clockwise, y down.
  return [cos * hs, sin * hs, -sin * vs, cos * vs];
}

/** Two transforms one after the other: `m`, then `n`. */
function then(m: GlyphMatrix, n: GlyphMatrix): GlyphMatrix {
  return [n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1], n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3]];
}

/** The origin that puts the point `local` of a glyph - its own units, y down - at `page`, under `m`. */
function originFor(page: Vec, m: GlyphMatrix, local: Vec): Vec {
  return { x: page.x - (m[0] * local.x + m[2] * local.y), y: page.y - (m[1] * local.x + m[3] * local.y) };
}

/** A glyph made from a measured character at its origin. */
function glyphOf(it: Item, origin: Vec, matrix: GlyphMatrix, line: number, letter: number, wordSpace: number, caret: CaretPlace): TypeGlyph {
  const rotation = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
  return {
    index: it.index,
    ch: it.ch,
    x: origin.x,
    y: origin.y,
    width: it.raw,
    advance: it.advance + letter + wordSpace,
    matrix,
    rotation: Math.abs(rotation) < 1e-9 ? 0 : rotation,
    hs: it.hs,
    vs: it.vs,
    font: it.font,
    color: it.attrs.color,
    tracking: it.tracking + letter,
    wordSpace: it.wordExtra + wordSpace,
    kern: it.kern,
    ascent: it.ascent,
    descent: it.descent,
    line,
    pen: caret.pen,
    along: caret.along,
    across: caret.across,
    shift: it.shift,
  };
}

/**
 * A character placed on a line at `pen` along it, its baseline (or, vertical,
 * its column's middle) at `c` across, turned about its middle by its own
 * rotation and moved off its baseline by its shift.
 */
function placeInLine(it: Item, pen: number, c: number, axes: Axes, line: number, letter: number, wordSpace: number): TypeGlyph {
  const m = turned(it.attrs.rotation, it.hs, it.vs);
  const caret: CaretPlace = {
    pen: axes.toPage(pen, c),
    along: axes.vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
    // Vertical lines are columns, and the next one is to the left.
    across: axes.vertical ? { x: -1, y: 0 } : { x: 0, y: 1 },
  };
  // Not turned, a character's origin is the pen on its baseline, shifted: no round trip through its middle.
  if (!axes.vertical && it.attrs.rotation === 0) return glyphOf(it, { x: pen, y: c - it.shift }, m, line, letter, wordSpace, caret);
  const up = it.ascent / it.vs;
  const down = it.descent / it.vs;
  const middle: Vec = { x: it.raw / 2, y: (down - up) / 2 };
  let centre: Vec;
  if (axes.vertical) {
    // Upright in its em down the column, its middle on the column's middle.
    centre = axes.toPage(pen + (it.font.size * it.vs) / 2, c - it.shift);
  } else {
    const page = axes.toPage(pen + (it.raw * it.hs) / 2, c - it.shift);
    centre = { x: page.x, y: page.y + middle.y * it.vs };
  }
  return glyphOf(it, originFor(centre, m, middle), m, line, letter, wordSpace, caret);
}

/** Adds a decoration, joined to the one before it where it carries straight on from it. */
function pushDecoration(out: TypeDecoration[], next: TypeDecoration): void {
  const last = out[out.length - 1];
  if (
    last &&
    last.kind === next.kind &&
    last.color === next.color &&
    Math.abs(last.thickness - next.thickness) < 1e-6 &&
    Math.hypot(last.to.x - next.from.x, last.to.y - next.from.y) < 1e-6 &&
    Math.abs((last.to.x - last.from.x) * (next.to.y - next.from.y) - (last.to.y - last.from.y) * (next.to.x - next.from.x)) < 1e-6
  ) {
    last.to = next.to;
    return;
  }
  out.push(next);
}

/** Where a decoration sits across a line from the character's baseline, in its own size: an underline below (vertically, right of the column), a strike through. */
function decorationOffset(kind: TypeDecoration['kind'], size: number, vertical: boolean): number {
  if (vertical) return kind === 'underline' ? -(0.5 + UNDERLINE_AT) * size : 0;
  return (kind === 'underline' ? UNDERLINE_AT : STRIKE_AT) * size;
}

// ---- The layout ------------------------------------------------------------------------------------------------

interface Kept {
  text: string | undefined;
  typeset: TypeSpec | undefined;
  fontSize: number | undefined;
  fontFamily: string | undefined;
  color: string;
  box: number | undefined;
  x: number;
  y: number;
  layout: TypeLayout;
}

const kept = new WeakMap<Stroke, Map<string, Kept>>();

/**
 * Where everything a text mark draws goes, set with `measure`'s advances - the
 * built-in face's when none is given. Kept per mark and measure until its
 * text, its typeset, its base or its anchor changes. A Markdown Flow text is
 * laid out as it is shown (core/type/markdown-flow.ts): its glyphs' and lines'
 * places are in its display, as is every attribute a painter reads.
 */
export function layoutType(stroke: Stroke, measure: TypeMeasure = HEADLESS_MEASURE): TypeLayout {
  const shown = markdownShown(stroke, measure);
  if (shown) return layoutType(shown.stroke, measure);
  // Paragraphs with a Clean Language Accent are laid out colored (core/type/accents.ts).
  const accented = accentShown(stroke);
  if (accented) return layoutType(accented, measure);
  const anchor = stroke.points[0] ?? { x: 0, y: 0 };
  let byMeasure = kept.get(stroke);
  const was = byMeasure?.get(measure.id);
  if (
    was &&
    was.text === stroke.text &&
    was.typeset === stroke.typeset &&
    was.fontSize === stroke.fontSize &&
    was.fontFamily === stroke.fontFamily &&
    was.color === stroke.color &&
    was.box === stroke.textBoxWidth &&
    was.x === anchor.x &&
    was.y === anchor.y
  ) {
    return was.layout;
  }
  const spec = typeSpecOf(stroke);
  const at = { x: anchor.x, y: anchor.y };
  const layout = spec.kind === 'path' && spec.path ? layoutPath(stroke, spec, measure, at) : layoutLines(stroke, spec, measure, at, spec.orientation === 'vertical' ? VERTICAL : HORIZONTAL);
  if (!byMeasure) {
    byMeasure = new Map();
    kept.set(stroke, byMeasure);
  }
  byMeasure.set(measure.id, { text: stroke.text, typeset: stroke.typeset, fontSize: stroke.fontSize, fontFamily: stroke.fontFamily, color: stroke.color, box: stroke.textBoxWidth, x: anchor.x, y: anchor.y, layout });
  return layout;
}

const editing = new WeakMap<TypeLayout, TypeLayout>();

/**
 * The layout a caret goes by: for a Markdown Flow text, its display's, each
 * glyph's index, each line's ends and paragraph its place in the source - the
 * text the caret moves through; for any other text, its own layout.
 */
export function layoutForEditing(stroke: Stroke, measure: TypeMeasure = HEADLESS_MEASURE): TypeLayout {
  const shown = markdownShown(stroke, measure);
  if (!shown) return layoutType(stroke, measure);
  const display = layoutType(shown.stroke, measure);
  const was = editing.get(display);
  if (was) return was;
  const map = shown.map;
  const sourceOf = (i: number): number => map[Math.max(0, Math.min(map.length - 1, i))];
  const starts = paragraphStarts(stroke.text ?? '');
  const lines = display.lines.map((line) => {
    const start = sourceOf(line.start);
    return { ...line, start, end: line.end > line.start ? sourceOf(line.end - 1) + 1 : start, paragraph: paragraphOf(starts, start) };
  });
  const out: TypeLayout = { ...display, glyphs: display.glyphs.map((glyph) => (glyph.index < 0 ? glyph : { ...glyph, index: sourceOf(glyph.index) })), lines };
  editing.set(display, out);
  return out;
}

/** Where a line fits: its baseline and its top across, the span of its box, what it holds and its metrics. */
interface LineFit {
  c: number;
  top: number;
  span: [number, number];
  end: number;
  hyphen: Item | null;
  metrics: Metrics;
}

/** A line as it was placed, in the engine's axes: its baseline and its top across, its start and length along, and its box's ends along. */
interface Placed {
  c: number;
  top: number;
  start: number;
  width: number;
  metrics: Metrics;
  paragraph: number;
  /** Where its box starts along - the frame's inside, or point type's anchor - and, in a frame, where it stops. */
  left: number;
  right: number | null;
}

/** Point and area type: lines, broken and aligned, each glyph placed. */
function layoutLines(stroke: Stroke, spec: TypeSpec, measure: TypeMeasure, anchor: Vec, axes: Axes): TypeLayout {
  const text = stroke.text ?? '';
  const segments = styleSegments(stroke);
  const base = baseAttrs(stroke);
  const ranges = paragraphRanges(text);
  const paras = ranges.map((_, p) => paraAttrsOf(stroke, p));
  const markers = listMarkers(paras);
  const area = spec.kind === 'area' && spec.frame ? spec.frame : null;
  const inset = area?.inset ?? 0;
  const at = axes.toAxes(anchor);

  // The frame in the engine's axes: its rings, where its inside starts and stops across, and whether it grows.
  let rings: Rings = [];
  let frameAnchors: VectorAnchor[] = [];
  let frameBox: TypeBox | null = null;
  let top = at.c;
  let bottom = Infinity;
  let sides: [number, number] | null = null;
  if (area) {
    frameAnchors = placeAnchors(area.anchors, anchor.x, anchor.y);
    const points = sampleOutline(frameAnchors, true);
    const pageRings: Vec[][] = [];
    for (const p of points) {
      if (p.move || pageRings.length === 0) pageRings.push([]);
      pageRings[pageRings.length - 1].push({ x: p.x, y: p.y });
    }
    rings = pageRings.map((ring) => ring.map((p) => axes.toAxes(p)));
    frameBox = boxOf(points);
    const all = rings.flat();
    top = Math.min(...all.map((p) => p.c)) + inset;
    bottom = Math.max(...all.map((p) => p.c)) - inset;
    // Only a rectangle square to the page grows: a vector editor's Auto Size. Its sides hold all the way down.
    if (area.autoHeight && frameRectangle(area.anchors)) {
      bottom = Infinity;
      sides = [Math.min(...all.map((p) => p.a)) + inset, Math.max(...all.map((p) => p.a)) - inset];
    }
  }
  const spanOf = (c0: number, c1: number): [number, number] | null => {
    if (!area) return [-Infinity, Infinity];
    if (sides) return sides;
    const span = bandSpan(rings, c0, c1);
    return span && span[1] - span[0] > 2 * inset ? [span[0] + inset, span[1] - inset] : null;
  };

  const placed: Placed[] = [];
  const lines: TypeLine[] = [];
  const glyphs: TypeGlyph[] = [];
  const decorations: TypeDecoration[] = [];
  const highlights: TypeHighlight[] = [];
  const placedMarkers: TypeMarker[] = [];
  const reaching: Vec[] = [];
  let overset = false;
  let previous: number | null = null;
  let gap = 0;

  const sizes: number[] = [];
  for (let p = 0; p < ranges.length && !overset; p++) {
    const para = paras[p];
    const range = ranges[p];
    const items = measureItems(text, segments, range.start, range.end, measure, axes.vertical);
    const empty = emptyMetrics(attrsAt(segments, base, range.start), measure, axes.vertical);
    sizes[p] = items[0]?.attrs.fontSize ?? empty.attrs.fontSize;
    const listIn = para.list ? para.list.level * LIST_INDENT * sizes[p] : 0;
    let pos = 0;
    let first = true;
    let hyphens = 0;
    while (first || pos < items.length) {
      const lead = (first ? para.firstIndent : 0) + para.leftIndent + listIn;
      // The line's metrics guessed from its first character, then made what it holds; it drops past bands with no room.
      let guess = lineMetrics(items.slice(pos, pos + 1), empty);
      let drop = 0;
      let found: LineFit | null = null;
      for (let tries = 0; tries < MAX_TRIES && !found; tries++) {
        const c: number = (previous === null ? top + guess.ascent : previous + guess.leading + gap) + drop;
        if (c + guess.descent > bottom + 1e-6) break;
        const span = spanOf(c - guess.ascent, c + guess.descent);
        const room = span ? span[1] - span[0] - lead - para.rightIndent : 0;
        const least = items[pos] ? items[pos].raw * items[pos].hs : 0;
        if (!span || room <= 0 || (!sides && room < least - 1e-9)) {
          drop += Math.max(1, guess.leading / 4);
          continue;
        }
        const fill = area ? fillLine(items, pos, room, para.hyphenate && hyphens < HYPHEN_RUN, measure) : { end: items.length, hyphen: null };
        const metrics = lineMetrics(fill.hyphen ? [...items.slice(pos, fill.end), fill.hyphen] : items.slice(pos, fill.end), empty);
        if (metrics.ascent > guess.ascent + 1e-6 || metrics.descent > guess.descent + 1e-6 || metrics.leading > guess.leading + 1e-6) {
          // Taller than it looked: the band again, at what the line holds.
          guess = { ascent: Math.max(guess.ascent, metrics.ascent), descent: Math.max(guess.descent, metrics.descent), leading: Math.max(guess.leading, metrics.leading) };
          continue;
        }
        // The first line's top is the frame's or the anchor's, exactly.
        found = { c, top: previous === null ? top + drop : c - guess.ascent, span, end: fill.end, hyphen: fill.hyphen, metrics: guess };
      }
      if (!found) {
        overset = true;
        break;
      }
      const line: LineFit = found;
      const lineItems = items.slice(pos, line.end);
      const all = line.hyphen ? [...lineItems, line.hyphen] : lineItems;
      const last = line.end >= items.length;
      const length = shownLength(all);
      // Where the line starts along its box, as its paragraph aligns it.
      let start: number;
      let spread = { word: 0, letter: 0 };
      if (area) {
        const left = line.span[0] + lead;
        const right = line.span[1] - para.rightIndent;
        start = para.align === 'center' ? (left + right - length) / 2 : para.align === 'right' ? right - length : left;
        if (para.align === 'justify' && !last) spread = justify(all, right - left - length);
      } else {
        start = para.align === 'center' ? at.a + (lead - para.rightIndent - length) / 2 : para.align === 'right' ? at.a - para.rightIndent - length : at.a + lead;
      }
      const lineIndex = lines.length;
      const shown = shownCount(all);
      const lineTop = line.top;
      const lineBottom = line.c + line.metrics.descent;
      let pen = start;
      let open: { color: string; from: number; to: number } | null = null;
      const closeHighlight = (): void => {
        if (!open) return;
        highlights.push({ kind: 'highlight', color: open.color, corners: [axes.toPage(open.from, lineTop), axes.toPage(open.to, lineTop), axes.toPage(open.to, lineBottom), axes.toPage(open.from, lineBottom)] });
        open = null;
      };
      all.forEach((it, k) => {
        const letter = !it.space && k < shown - 1 ? spread.letter : 0;
        const wordSpace = it.space && k < shown ? spread.word * it.raw * it.hs : 0;
        const glyph = placeInLine(it, pen, line.c, axes, lineIndex, letter, wordSpace);
        glyphs.push(glyph);
        // A character turned, scaled, shifted or stood upright in a column may reach past its line's box.
        if (!it.space && (axes.vertical || it.attrs.rotation !== 0 || it.vs !== 1 || it.shift !== 0)) reaching.push(...glyphCorners(glyph));
        if (k < shown) {
          for (const kind of ['underline', 'strike'] as const) {
            if (!(kind === 'underline' ? it.attrs.underline : it.attrs.strike)) continue;
            const across = line.c - it.shift + decorationOffset(kind, it.font.size, axes.vertical);
            pushDecoration(decorations, { kind, from: axes.toPage(pen, across), to: axes.toPage(pen + glyph.advance, across), thickness: Math.max(0.5, it.font.size * DECORATION_WIDTH), color: it.attrs.color });
          }
          const highlight = it.attrs.highlight;
          if (!highlight) closeHighlight();
          else if (open && open.color === highlight && Math.abs(open.to - pen) < 1e-6) open.to = pen + glyph.advance;
          else {
            closeHighlight();
            open = { color: highlight, from: pen, to: pen + glyph.advance };
          }
        }
        pen += glyph.advance;
      });
      closeHighlight();
      const width = pen - start - widthOf(all, shown, all.length);
      placed.push({ c: line.c, top: line.top, start, width, metrics: line.metrics, paragraph: p, left: area ? line.span[0] : at.a, right: area ? line.span[1] : null });
      const origin = axes.toPage(start, line.c);
      lines.push({
        paragraph: p,
        start: lineItems[0]?.index ?? range.start,
        end: lineItems.length > 0 ? lineItems[lineItems.length - 1].index + lineItems[lineItems.length - 1].ch.length : range.start,
        x: axes.vertical ? origin.x : start,
        y: axes.vertical ? start : line.c,
        width,
        ascent: line.metrics.ascent,
        descent: line.metrics.descent,
        leading: line.metrics.leading,
      });
      // A list paragraph's marker, half an em before its first line.
      const marker = markers[p];
      if (first && marker && !axes.vertical) {
        const head = lineItems[0];
        const font: TypeFont = head ? { ...head.font, size: head.attrs.fontSize, smallCaps: false } : empty.font;
        const markerWidth = measure.width(marker, font);
        placedMarkers.push({ text: marker, x: start - 0.5 * font.size - markerWidth, y: line.c, width: markerWidth, font, color: (head?.attrs ?? empty.attrs).color, paragraph: p });
      }
      previous = line.c;
      gap = 0;
      hyphens = line.hyphen ? hyphens + 1 : 0;
      pos = line.end;
      first = false;
    }
    // The space after this paragraph and before the next.
    if (p + 1 < ranges.length) gap = para.spaceAfter + paras[p + 1].spaceBefore;
  }

  // Under the highlights: shades behind whole paragraphs - a run of paragraphs in one shade with no space between
  // them as one - across the frame's inside or the lines' own reach; then a quote's bars down its paragraphs' left,
  // and rules across.
  const shades: TypeHighlight[] = [];
  const insideSpan: [number, number] | null = sides ?? (rings.length > 0 ? [Math.min(...rings.flat().map((q) => q.a)) + inset, Math.max(...rings.flat().map((q) => q.a)) - inset] : null);
  const quad = (along0: number, along1: number, across0: number, across1: number, color: string): TypeHighlight => ({
    kind: 'shade',
    color,
    corners: [axes.toPage(along0, across0), axes.toPage(along1, across0), axes.toPage(along1, across1), axes.toPage(along0, across1)],
  });
  const linesOf = (first: number, last: number): Placed[] => placed.filter((line) => line.paragraph >= first && line.paragraph <= last);
  for (let p = 0; p < paras.length; p++) {
    const shade = paras[p].shade;
    if (!shade) continue;
    let q = p;
    while (q + 1 < paras.length && paras[q + 1].shade === shade && paras[q].spaceAfter + paras[q + 1].spaceBefore === 0) q++;
    const own = linesOf(p, q);
    p = q;
    if (own.length === 0) continue;
    const along0 = insideSpan ? insideSpan[0] : Math.min(...own.map((line) => line.start));
    const along1 = insideSpan ? insideSpan[1] : Math.max(...own.map((line) => line.start + line.width));
    shades.push(quad(along0, along1, Math.min(...own.map((line) => line.top)), Math.max(...own.map((line) => boxBottom(line))), shade));
  }
  // A bar, where it stands in from its lines' box, down a run of paragraphs with the same bar: drawn from the run's first.
  const hasBar = (p: number, offset: number, color: string): boolean => {
    const bar = paras[p]?.bar;
    return bar !== undefined && bar.color === color && bar.at.some((x) => Math.abs(x - offset) < 1e-6);
  };
  for (let p = 0; p < paras.length; p++) {
    const bar = paras[p].bar;
    if (!bar) continue;
    for (const offset of bar.at) {
      if (p > 0 && hasBar(p - 1, offset, bar.color)) continue;
      let q = p;
      while (q + 1 < paras.length && hasBar(q + 1, offset, bar.color)) q++;
      const own = linesOf(p, q);
      if (own.length === 0) continue;
      const along0 = own[0].left + offset;
      const thick = Math.max(1, 0.2 * (sizes[p] ?? base.fontSize));
      shades.push(quad(along0, along0 + thick, Math.min(...own.map((line) => line.top)), Math.max(...own.map((line) => boxBottom(line))), bar.color));
    }
  }
  // A rule across its paragraph's line, at its middle: to the frame's side, or as far as the widest line - ten ems at least.
  const widest = placed.length > 0 ? Math.max(...placed.map((line) => line.start + line.width)) : at.a;
  for (let p = 0; p < paras.length; p++) {
    const color = paras[p].rule;
    if (!color) continue;
    const line = placed.find((each) => each.paragraph === p);
    if (!line) continue;
    const size = sizes[p] ?? base.fontSize;
    const along0 = line.left + paras[p].leftIndent;
    const along1 = line.right !== null ? line.right - paras[p].rightIndent : Math.max(widest, along0 + 10 * size);
    const middle = (line.top + boxBottom(line)) / 2;
    const half = Math.max(0.5, 0.1 * size);
    shades.push(quad(along0, along1, middle - half, middle + half, color));
  }

  // The frame, grown to the text when it grows.
  let frame: TypeLayout['frame'];
  if (area && frameBox) {
    let box = frameBox;
    let anchors = frameAnchors;
    if (sides) {
      const end = placed.length > 0 ? boxBottom(placed[placed.length - 1]) : top;
      box = boxOf([axes.toPage(sides[0] - inset, top - inset), axes.toPage(sides[1] + inset, end + inset)])!;
      anchors = [{ p: { x: box.minX, y: box.minY } }, { p: { x: box.maxX, y: box.minY } }, { p: { x: box.maxX, y: box.maxY } }, { p: { x: box.minX, y: box.maxY } }];
    }
    frame = { anchors, box, ...(area.fill ? { fill: area.fill } : {}), ...(area.stroke ? { stroke: area.stroke } : {}), ...(area.width ? { width: area.width } : {}) };
  }

  // What it all covers: each line's box, each character that reaches past it, each marker and the frame.
  const points: Vec[] = [...reaching];
  for (const line of placed) points.push(axes.toPage(line.start, line.top), axes.toPage(line.start + line.width, boxBottom(line)));
  for (const m of placedMarkers) points.push({ x: m.x, y: m.y }, { x: m.x + m.width, y: m.y });
  for (const shade of shades) points.push(...shade.corners);
  if (frame) points.push({ x: frame.box.minX, y: frame.box.minY }, { x: frame.box.maxX, y: frame.box.maxY });
  if (points.length === 0) points.push({ x: anchor.x, y: anchor.y });

  return {
    kind: area ? 'area' : 'point',
    orientation: axes.vertical ? 'vertical' : 'horizontal',
    glyphs,
    lines,
    decorations,
    highlights: [...shades, ...highlights],
    markers: placedMarkers,
    bounds: boxOf(points)!,
    overset,
    ...(frame ? { frame } : {}),
  };
}

/** Where a line's box ends across: down its leading from its top, or to its descent where that is further. */
function boxBottom(line: Placed): number {
  return Math.max(line.c + line.metrics.descent, line.top + line.metrics.leading);
}

// ---- Path type ---------------------------------------------------------------------------------------------------

/**
 * Path type: one line set along the path, each character's middle on it at
 * its length along, its frame turned as the effect says, as a vector editor's
 * Type on a Path effects do:
 *
 * - **rainbow** turns each character with the path;
 * - **skew** keeps its upright strokes upright, slanting it along the path;
 * - **ribbon** keeps its level strokes level, its upright ones square to the path;
 * - **stair** turns nothing, each character upright on the path;
 * - **gravity** turns each character to face the middle of the path's box.
 *
 * `flip` runs it the other way along the path, on the other side. A newline
 * sets nothing: the paragraphs run on along the one line.
 */
function layoutPath(stroke: Stroke, spec: TypeSpec, measure: TypeMeasure, anchor: Vec): TypeLayout {
  const path = spec.path!;
  const text = stroke.text ?? '';
  const closed = path.closed === true;
  const pageAnchors = placeAnchors(path.anchors, anchor.x, anchor.y);
  const runAnchors = path.flip ? reverseAnchors(pageAnchors, closed) : pageAnchors;
  const table = lengthTable(runAnchors, closed);
  const length = table.total;
  const from = Math.min(length, path.start);
  const to = Math.max(from, Math.min(length, path.end));
  // Flipped, the same stretch of path is run from its other end.
  const start = path.flip ? length - to : from;
  const end = path.flip ? length - from : to;
  const items = measureItems(text, styleSegments(stroke), 0, text.length, measure, false);
  const para = paraAttrsOf(stroke, 0);
  const total = shownLength(items);
  const room = end - start;
  let offset = start;
  let letter = 0;
  if (total <= room) {
    if (para.align === 'center') offset = start + (room - total) / 2;
    else if (para.align === 'right') offset = end - total;
    else if (para.align === 'justify' && items.length > 1) letter = (room - total) / (items.length - 1);
  }
  const outline = sampleOutline(pageAnchors, closed);
  const pathBox = boxOf(outline);
  const middle = pathBox ? { x: (pathBox.minX + pathBox.maxX) / 2, y: (pathBox.minY + pathBox.maxY) / 2 } : anchor;

  const glyphs: TypeGlyph[] = [];
  const decorations: TypeDecoration[] = [];
  const highlights: TypeHighlight[] = [];
  let overset = false;
  let pen = offset;
  for (const it of items) {
    const s = pen + (it.raw * it.hs) / 2;
    if (s > end + 1e-6) {
      overset = true;
      break;
    }
    const p = pointAtLength(table, s);
    const t = tangentAtLength(table, s);
    const n = { x: -t.y, y: t.x };
    // The effect's frame: where the character's own x axis, and its y axis (down), go.
    let xAxis: Vec = t;
    let yAxis: Vec = n;
    if (path.effect === 'skew') {
      yAxis = { x: 0, y: t.x >= 0 ? 1 : -1 };
    } else if (path.effect === 'ribbon') {
      xAxis = { x: t.x >= 0 ? 1 : -1, y: 0 };
    } else if (path.effect === 'stair') {
      xAxis = { x: 1, y: 0 };
      yAxis = { x: 0, y: 1 };
    } else if (path.effect === 'gravity') {
      const toward = { x: middle.x - p.x, y: middle.y - p.y };
      const far = Math.hypot(toward.x, toward.y);
      // Down toward the middle of the path's box; on the middle itself, as the rainbow.
      if (far > 1e-9) {
        yAxis = { x: toward.x / far, y: toward.y / far };
        xAxis = { x: yAxis.y, y: -yAxis.x };
      }
    }
    const m = then(turned(it.attrs.rotation, it.hs, it.vs), [xAxis.x, xAxis.y, yAxis.x, yAxis.y]);
    // Which of the character's lines sits on the path, and its shift off it, in its own units.
    const up = it.ascent / it.vs;
    const down = it.descent / it.vs;
    const sit = path.align === 'ascender' ? -up : path.align === 'descender' ? down : path.align === 'center' ? (down - up) / 2 : 0;
    // The caret before it: where its advance starts on the path, on the baseline its alignment sets.
    const startAt = pointAtLength(table, pen);
    const startTangent = tangentAtLength(table, pen);
    const startNormal = { x: -startTangent.y, y: startTangent.x };
    const sitBy = -sit * it.vs;
    const caret: CaretPlace = { pen: { x: startAt.x + startNormal.x * sitBy, y: startAt.y + startNormal.y * sitBy }, along: startTangent, across: startNormal };
    const glyph = glyphOf(it, originFor(p, m, { x: it.raw / 2, y: sit + it.shift / (it.vs || 1) }), m, 0, letter, 0, caret);
    // Spacing: round a sharp turn the characters close up by the curvature there; a straight stretch is as it was.
    if (path.spacing) glyph.advance *= Math.max(0.2, 1 - path.spacing * Math.abs(curvatureAtLength(table, s)));
    glyphs.push(glyph);
    if (!it.space) {
      // Decorations follow the path itself, at the character's baseline off it.
      const baseline = -(sit * it.vs + it.shift);
      for (const kind of ['underline', 'strike'] as const) {
        if (!(kind === 'underline' ? it.attrs.underline : it.attrs.strike)) continue;
        const off = baseline + decorationOffset(kind, it.font.size, false);
        const along = (l: number): Vec => {
          const q = pointAtLength(table, l);
          const tq = tangentAtLength(table, l);
          return { x: q.x - tq.y * off, y: q.y + tq.x * off };
        };
        pushDecoration(decorations, { kind, from: along(pen), to: along(Math.min(end, pen + glyph.advance)), thickness: Math.max(0.5, it.font.size * DECORATION_WIDTH), color: it.attrs.color });
      }
      if (it.attrs.highlight) highlights.push({ kind: 'highlight', color: it.attrs.highlight, corners: glyphCorners(glyph) });
    }
    pen += glyph.advance;
  }

  const points: Vec[] = outline.map((q) => ({ x: q.x, y: q.y }));
  for (const g of glyphs) if (g.ch !== ' ') points.push(...glyphCorners(g));
  if (points.length === 0) points.push(anchor);
  return {
    kind: 'path',
    orientation: 'horizontal',
    glyphs,
    lines: [
      {
        paragraph: 0,
        start: 0,
        end: text.length,
        x: offset,
        y: 0,
        width: pen - offset,
        ascent: Math.max(0, ...items.map((it) => it.lineAscent)),
        descent: Math.max(0, ...items.map((it) => it.lineDescent)),
        leading: Math.max(0, ...items.map((it) => it.leading)),
      },
    ],
    decorations,
    highlights,
    markers: [],
    bounds: boxOf(points)!,
    overset,
    path: { anchors: pageAnchors, run: runAnchors, closed, length },
  };
}

/** A path's anchors in the opposite order, each one's handles swapped; a closed path still starts where it started. */
function reverseAnchors(anchors: readonly VectorAnchor[], closed: boolean): VectorAnchor[] {
  const flipped = [...anchors].reverse().map((a) => ({ p: { ...a.p }, ...(a.hOut ? { hIn: { ...a.hOut } } : {}), ...(a.hIn ? { hOut: { ...a.hIn } } : {}) }));
  if (closed && flipped.length > 1) flipped.unshift(flipped.pop()!);
  return flipped;
}

// ---- Stretches a painter sets as one string ---------------------------------------------------------------------

/** Glyphs a painter may set as one string, or one glyph it sets alone. */
export interface TypeSpan {
  glyphs: TypeGlyph[];
  text: string;
  /** The first glyph's origin. */
  x: number;
  y: number;
  font: TypeFont;
  color: string;
  /** The letter spacing and the word spacing to set it with, page pixels. */
  tracking: number;
  wordSpace: number;
  /** True when it is set as a string at its origin, untransformed; false for a glyph set alone with its matrix. */
  plain: boolean;
  /** How far the pen goes along it. */
  advance: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/**
 * A layout's glyphs as stretches a painter sets as one string: on one line,
 * in one font and color, with one letter spacing and one word spacing, none
 * turned or scaled, each where the one before it leaves the pen, and none
 * kerned by hand but the last. Set so, with the font's own kerning, a string
 * lands where the layout put each glyph. A glyph that is turned or scaled is
 * a stretch of its own, set with its matrix; so is every vertical glyph.
 */
export function typeSpans(layout: TypeLayout): TypeSpan[] {
  const spans: TypeSpan[] = [];
  let open: TypeSpan | null = null;
  let spaceSeen = false;
  for (const g of layout.glyphs) {
    const plain = layout.orientation === 'horizontal' && near(g.matrix[0], 1) && near(g.matrix[1], 0) && near(g.matrix[2], 0) && near(g.matrix[3], 1);
    const prev = open ? open.glyphs[open.glyphs.length - 1] : undefined;
    if (
      open &&
      prev &&
      plain &&
      open.plain &&
      g.line === prev.line &&
      prev.kern === 0 &&
      fontKey(g.font) === fontKey(open.font) &&
      g.color === open.color &&
      near(g.tracking, open.tracking) &&
      (g.ch !== ' ' || !spaceSeen || near(g.wordSpace, open.wordSpace)) &&
      near(g.y, open.y) &&
      near(g.x, open.x + open.advance)
    ) {
      open.glyphs.push(g);
      open.text += g.ch;
      open.advance += g.advance;
      if (g.ch === ' ' && !spaceSeen) {
        open.wordSpace = g.wordSpace;
        spaceSeen = true;
      }
      continue;
    }
    open = { glyphs: [g], text: g.ch, x: g.x, y: g.y, font: g.font, color: g.color, tracking: g.tracking, wordSpace: g.ch === ' ' ? g.wordSpace : 0, plain, advance: g.advance };
    spaceSeen = g.ch === ' ';
    spans.push(open);
  }
  return spans;
}
