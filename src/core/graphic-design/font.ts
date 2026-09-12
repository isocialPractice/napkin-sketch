/**
 * A built-in single-stroke font, and the text layout both renderers share.
 *
 * The SVG writer emits real `<text>` and names whatever font family the
 * element asked for, which is what a designer wants: live, selectable,
 * restyleable text. The rasterizer has no font engine and no operating system
 * to ask for one, so it draws glyphs from the table below - a geometric
 * single-stroke alphabet in the Hershey tradition, carried as polylines on a
 * unit grid.
 *
 * The important consequence is that **both** renderers measure with this
 * table. Line breaking, alignment and the block's overall extent are therefore
 * identical in the SVG and the PNG even though the glyph shapes are not, so
 * "the same composition in two formats" holds for layout, which is the part a
 * composition actually controls. A caller who needs the raster text to match a
 * licensed face to the pixel should render the SVG through a browser instead;
 * that is a different trade, and it is named in `API.md` rather than hidden.
 *
 * Grid: x runs left to right from 0, y runs **up** from the baseline. The cap
 * height is 11, the x-height is 7, descenders reach -3, and the em is 15 units
 * tall, so a 16px font has an 11.7px cap - close to a normal sans.
 */

import type { Point } from './types.js';
import { strokeContour, type Contour } from './geometry.js';

/** Units per em in the glyph grid. */
export const FONT_UNITS_PER_EM = 15;

/** Cap height in glyph units. */
export const FONT_CAP_HEIGHT = 11;

/** x-height in glyph units. */
export const FONT_X_HEIGHT = 7;

/** Descender depth in glyph units (a positive distance below the baseline). */
export const FONT_DESCENDER = 3;

/** Advance width used for a character the table does not carry. */
const FALLBACK_ADVANCE = 9;

/**
 * The glyph table.
 *
 * Each entry is `advance|subpath|subpath|...`, a subpath is space-separated
 * `x,y` pairs, and a subpath of one point draws a dot under the round cap the
 * rasterizer uses.
 */
const GLYPHS: Record<string, string> = {
  ' ': '5',
  '!': '6|4,11 4,3|4,0.4',
  '"': '8|3,11 3,8|6,11 6,8',
  '#': '10|3.4,11 2.2,0|7.4,11 6.2,0|1.2,7.6 8.6,7.6|0.8,3.6 8.2,3.6',
  '$': '10|4.9,12.2 4.9,-1.2|8,9.6 6.4,10.8 3.4,10.8 1.7,9.6 1.7,7.6 2.9,6.5 6.9,5.2 8.1,4 8.1,1.9 6.4,0.6 3.2,0.6 1.6,1.8',
  '%': '12|2.6,11 1.3,9.8 1.3,8.2 2.6,7 3.9,8.2 3.9,9.8 2.6,11|9.6,11 1.6,0|8.4,4 7.1,2.8 7.1,1.2 8.4,0 9.7,1.2 9.7,2.8 8.4,4',
  '&': '11|9.4,0 3.2,6.2 2.1,7.8 2.5,9.9 4.1,11 5.7,10.4 5.9,8.8 4.7,7.2 1.5,4.6 1.3,2.4 2.9,0.4 5.1,0.2 7.1,1.4 8.3,3.4',
  "'": '5|3.6,11 3.6,8',
  '(': '7|5.8,11.6 3.9,8.5 3.1,5.5 3.1,3 3.9,0.3 5.8,-2.4',
  ')': '7|1.8,11.6 3.7,8.5 4.5,5.5 4.5,3 3.7,0.3 1.8,-2.4',
  '*': '9|4.5,10 4.5,5|2.3,8.8 6.7,6.2|2.3,6.2 6.7,8.8',
  '+': '10|4.9,8.4 4.9,1.4|1.4,4.9 8.4,4.9',
  ',': '5|3.9,0.6 3.9,0 2.9,-2.2',
  '-': '9|1.6,4.9 7.4,4.9',
  '.': '5|3.9,0.3',
  '/': '8|1,-1.4 7,12.2',
  '0': '10|4.8,11 2.7,10 1.4,7.5 1.4,3.5 2.7,1 4.8,0 6.9,1 8.2,3.5 8.2,7.5 6.9,10 4.8,11',
  '1': '10|2.5,9 4.8,11 4.8,0',
  '2': '10|1.4,9 2.7,10.7 5.5,11 7.6,10 8.2,8 7.3,6 1.3,0 8.5,0',
  '3': '10|1.6,10.4 4.5,11 7.3,10.3 8,8.7 7,6.8 4.5,6 7,5.4 8.3,3.6 7.8,1.4 5,0 2,0.4 1.2,1.6',
  '4': '10|6.6,0 6.6,11 1.1,3.6 8.7,3.6',
  '5': '10|8,11 2.1,11 1.6,6.2 3.6,7 6,7 7.9,5.6 8.3,3.2 7.3,1 4.8,0 2.3,0.5 1.3,1.8',
  '6': '10|8,10 5.5,11 3,10.3 1.5,7.5 1.3,3.4 2.5,1 4.8,0 7,0.8 8.2,2.8 7.6,5 5.6,6.1 3,5.7 1.5,3.8',
  '7': '10|1.3,11 8.7,11 4.1,0',
  '8': '10|4.8,6 2.5,5.2 1.5,3.4 2.3,1.1 4.8,0 7.3,1.1 8.1,3.4 7.1,5.2 4.8,6 2.9,7 2.3,9.2 3.5,10.7 4.8,11 6.1,10.7 7.3,9.2 6.7,7 4.8,6',
  '9': '10|1.7,1 4.1,0 6.6,0.7 8.1,3.5 8.3,7.6 7.1,10 4.8,11 2.6,10.2 1.4,8.2 2,6 4,4.9 6.6,5.3 8.1,7.2',
  ':': '5|3.9,5.2|3.9,0.3',
  ';': '5|3.9,5.2|3.9,0.6 3.9,0 2.9,-2.2',
  '<': '10|8.2,9 1.6,4.9 8.2,0.8',
  '=': '10|1.5,6.6 8.5,6.6|1.5,3.2 8.5,3.2',
  '>': '10|1.8,9 8.4,4.9 1.8,0.8',
  '?': '9|1.7,9.4 2.3,10.6 4.1,11 6,10.6 7,9.2 6.6,7.6 4.7,6.4 4.3,5 4.3,3.4|4.3,0.3',
  '@': '12|7.6,4.4 6.6,3.2 5,3.2 4,4.4 4,6 5.2,7 6.8,6.8 7.6,5.6 7.6,2.6 8.2,1.8 9.4,2.6 9.8,5 9,8.4 6.6,10.6 4,11 2.2,9.6 1.4,7 1.6,4 3,1.4 5.4,0.2 8,0.4',
  A: '10|1,0 4.9,11 8.8,0|2.4,3.6 7.4,3.6',
  B: '10|1.3,0 1.3,11|1.3,11 5.9,11 7.8,10 7.8,7.2 5.9,6 1.3,6|1.3,6 6.4,6 8.3,4.9 8.3,1.1 6.4,0 1.3,0',
  C: '10|8.5,8.6 7,10.4 4.6,11 2.6,10 1.2,7.5 1.2,3.5 2.6,1 4.6,0 7,0.6 8.5,2.4',
  D: '10|1.3,0 1.3,11 5,11 7.4,9.6 8.4,7 8.4,4 7.4,1.4 5,0 1.3,0',
  E: '10|8.4,11 1.3,11 1.3,0 8.4,0|1.3,6 6.4,6',
  F: '10|8.4,11 1.3,11 1.3,0|1.3,6 6.4,6',
  G: '11|8.6,8.6 7.1,10.4 4.7,11 2.7,10 1.3,7.5 1.3,3.5 2.7,1 4.7,0 7.1,0.6 8.6,2.6 8.6,4.6 5.6,4.6',
  H: '10|1.3,0 1.3,11|8.5,0 8.5,11|1.3,6 8.5,6',
  I: '5|2.5,0 2.5,11',
  J: '9|7,11 7,3 6,0.8 4,0 2,0.6 1.1,2.6',
  K: '10|1.3,0 1.3,11|8.5,11 1.3,4.4|3.7,6.6 8.5,0',
  L: '9|1.3,11 1.3,0 8,0',
  M: '11|1.2,0 1.2,11 5.2,3 9.2,11 9.2,0',
  N: '10|1.3,0 1.3,11 8.5,0 8.5,11',
  O: '11|4.9,11 2.7,10 1.3,7.5 1.3,3.5 2.7,1 4.9,0 7.1,1 8.5,3.5 8.5,7.5 7.1,10 4.9,11',
  P: '10|1.3,0 1.3,11 6,11 8.3,9.8 8.3,6.7 6,5.5 1.3,5.5',
  Q: '11|4.9,11 2.7,10 1.3,7.5 1.3,3.5 2.7,1 4.9,0 7.1,1 8.5,3.5 8.5,7.5 7.1,10 4.9,11|5.6,2.2 9,-1.6',
  R: '10|1.3,0 1.3,11 6,11 8.3,9.8 8.3,6.7 6,5.5 1.3,5.5|4.6,5.5 8.5,0',
  S: '10|8.3,9.5 6.5,11 3.3,11 1.4,9.7 1.4,7.5 2.7,6.3 6.8,5 8.2,3.7 8.2,1.5 6.4,0 3.1,0 1.3,1.4',
  T: '10|4.9,0 4.9,11|0.9,11 8.9,11',
  U: '10|1.3,11 1.3,3 2.6,0.8 4.9,0 7.2,0.8 8.5,3 8.5,11',
  V: '10|0.9,11 4.9,0 8.9,11',
  W: '13|0.8,11 3.1,0 6.2,8 9.3,0 11.6,11',
  X: '10|1.3,0 8.5,11|1.3,11 8.5,0',
  Y: '10|0.9,11 4.9,5.4 8.9,11|4.9,5.4 4.9,0',
  Z: '10|1.3,11 8.5,11 1.3,0 8.5,0',
  '[': '7|6,11.8 3.5,11.8 3.5,-2.4 6,-2.4',
  '\\': '8|1,12.2 7,-1.4',
  ']': '7|2,11.8 4.5,11.8 4.5,-2.4 2,-2.4',
  '^': '10|1.5,8 4.9,11.6 8.3,8',
  _: '10|0.4,-2.4 9.6,-2.4',
  '`': '5|2.8,11 4.6,9.2',
  a: '9|7.4,7 7.4,0|7.4,5.5 6.1,7 3.5,7 1.7,5.8 1.1,3.5 1.7,1.2 3.5,0 6.1,0 7.4,1.4',
  b: '9|1.2,11 1.2,0|1.2,5.5 2.5,7 5.1,7 6.9,5.8 7.5,3.5 6.9,1.2 5.1,0 2.5,0 1.2,1.4',
  c: '9|7.4,5.6 6,7 3.5,7 1.7,5.6 1.1,3.5 1.7,1.4 3.5,0 6,0 7.4,1.4',
  d: '9|7.4,11 7.4,0|7.4,5.5 6.1,7 3.5,7 1.7,5.8 1.1,3.5 1.7,1.2 3.5,0 6.1,0 7.4,1.4',
  e: '9|1.1,3.4 7.5,3.4 7.5,5 6.4,6.6 4,7 2.2,6.2 1.2,4.4 1.1,3 1.9,1 3.9,0 6.2,0 7.4,1',
  f: '6|5.6,10 4.6,11 3.2,10.6 2.8,9 2.8,0|1,7 5.2,7',
  g: '9|7.4,7 7.4,-1.4 6.4,-3 4,-3.4 2,-2.8|7.4,5.5 6,7 3.6,7 1.7,5.8 1.1,3.5 1.7,1.2 3.6,0 6,0 7.4,1.4',
  h: '9|1.2,11 1.2,0|1.2,5.2 2.7,7 5,7 6.7,5.8 7,4 7,0',
  i: '4|2,7 2,0|2,9.5',
  j: '5|2.6,7 2.6,-1.5 1.8,-3 0.4,-3.3|2.6,9.5',
  k: '9|1.2,11 1.2,0|6.9,7 1.2,2.2|3.3,4 7.1,0',
  l: '4|2,11 2,0',
  m: '13|1.2,7 1.2,0|1.2,5.3 2.6,7 4.2,7 5.4,5.6 5.4,0|5.4,5.3 6.8,7 8.4,7 9.6,5.6 9.6,0',
  n: '9|1.2,7 1.2,0|1.2,5.2 2.7,7 5,7 6.7,5.8 7,4 7,0',
  o: '9|4.3,7 2.3,6.2 1.1,4.4 1.1,2.6 2.3,0.8 4.3,0 6.3,0.8 7.5,2.6 7.5,4.4 6.3,6.2 4.3,7',
  p: '9|1.2,7 1.2,-3.4|1.2,5.5 2.5,7 5.1,7 6.9,5.8 7.5,3.5 6.9,1.2 5.1,0 2.5,0 1.2,1.4',
  q: '9|7.4,7 7.4,-3.4|7.4,5.5 6.1,7 3.5,7 1.7,5.8 1.1,3.5 1.7,1.2 3.5,0 6.1,0 7.4,1.4',
  r: '6|1.2,7 1.2,0|1.2,4.6 2.4,6.6 4.2,7 5.4,6.8',
  s: '8|6.8,5.8 5.4,7 3,7 1.4,6.2 1.2,4.8 2.4,3.8 5.6,3.2 6.8,2.2 6.6,0.8 5,0 2.6,0 1.2,1',
  t: '6|3.2,11 3.2,1.8 4,0.2 5.4,0|1,7 5.2,7',
  u: '9|1.2,7 1.2,2 2.4,0.3 4.2,0 6,0.6 7,2|7,7 7,0',
  v: '8|0.9,7 4,0 7.1,7',
  w: '11|0.8,7 2.6,0 5,5 7.4,0 9.2,7',
  x: '8|1,7 6.9,0|1,0 6.9,7',
  y: '8|0.9,7 4,0|7.1,7 3.4,-2 2,-3.2',
  z: '8|1.1,7 6.9,7 1.1,0 6.9,0',
  '{': '8|6.4,11.6 5,10.6 4.6,8.6 4.6,6.2 3,4.7 4.6,3.2 4.6,0.8 5,-1.2 6.4,-2.2',
  '|': '5|3.9,12.2 3.9,-2.4',
  '}': '8|2.4,11.6 3.8,10.6 4.2,8.6 4.2,6.2 5.8,4.7 4.2,3.2 4.2,0.8 3.8,-1.2 2.4,-2.2',
  '~': '10|1.1,4.4 3,6.2 5,4.4 6.9,2.6 8.9,4.4',
};

/** A glyph: its advance width and its pen strokes, in glyph units. */
export interface Glyph {
  advance: number;
  strokes: Point[][];
}

const PARSED = new Map<string, Glyph>();

/** Reads one glyph out of the table, parsing it the first time it is asked for. */
export function glyph(char: string): Glyph | null {
  const cached = PARSED.get(char);
  if (cached) return cached;
  const entry = GLYPHS[char];
  if (entry === undefined) return null;
  const [advance, ...subpaths] = entry.split('|');
  const parsed: Glyph = {
    advance: parseFloat(advance),
    strokes: subpaths.map((sub) =>
      sub
        .trim()
        .split(/\s+/)
        .filter((pair) => pair.length > 0)
        .map((pair) => {
          const [x, y] = pair.split(',');
          return { x: parseFloat(x), y: parseFloat(y) };
        }),
    ),
  };
  PARSED.set(char, parsed);
  return parsed;
}

/** The metrics a measured run of text carries. */
export interface FontMetrics {
  /** Units per em at this size. */
  size: number;
  /** Cap height in composition units. */
  capHeight: number;
  /** x-height in composition units. */
  xHeight: number;
  /** Descender depth in composition units. */
  descender: number;
  /** Stroke weight the rasterizer draws glyphs with. */
  strokeWidth: number;
  /** Horizontal shear applied for an italic, as a slope. */
  slant: number;
}

/** Resolves the metrics for a size, weight and style. */
export function fontMetrics(
  size: number,
  weight: number | 'normal' | 'bold' = 'normal',
  style: 'normal' | 'italic' = 'normal',
): FontMetrics {
  const numeric = weight === 'normal' ? 400 : weight === 'bold' ? 700 : weight;
  // 0.075em at 400 up to 0.13em at 900: the range a single-stroke alphabet can
  // carry before the counters of "e" and "a" close up.
  const ratio = 0.075 + Math.min(Math.max(numeric - 400, 0), 500) / 500 * 0.055;
  return {
    size,
    capHeight: (FONT_CAP_HEIGHT / FONT_UNITS_PER_EM) * size,
    xHeight: (FONT_X_HEIGHT / FONT_UNITS_PER_EM) * size,
    descender: (FONT_DESCENDER / FONT_UNITS_PER_EM) * size,
    strokeWidth: Math.max(size * ratio, 0.35),
    slant: style === 'italic' ? 0.21 : 0,
  };
}

/** Advance of one character in composition units, before letter spacing. */
export function charWidth(char: string, size: number): number {
  const g = glyph(char);
  const advance = g ? g.advance : FALLBACK_ADVANCE;
  return (advance / FONT_UNITS_PER_EM) * size;
}

/** Options that change how wide a run of text measures. */
export interface MeasureOptions {
  fontSize: number;
  letterSpacing?: number;
  wordSpacing?: number;
}

/** Width of a run of text in composition units. */
export function measureText(text: string, options: MeasureOptions): number {
  const spacing = options.letterSpacing ?? 0;
  const wordSpacing = options.wordSpacing ?? 0;
  let width = 0;
  for (const char of text) {
    width += charWidth(char, options.fontSize) + spacing;
    if (char === ' ') width += wordSpacing;
  }
  // The trailing letter space is a gap after the last glyph, not part of the
  // run, so a centred line stays centred.
  return Math.max(0, width - (text.length > 0 ? spacing : 0));
}

/** Applies a CSS-style case transform before anything is measured. */
export function transformText(text: string, transform: string | undefined): string {
  switch (transform) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/(^|\s)(\S)/g, (_, lead: string, c: string) => lead + c.toUpperCase());
    default:
      return text;
  }
}

/** Greedy word wrap at `maxWidth`, measured with the built-in font. */
export function wrapText(text: string, maxWidth: number, options: MeasureOptions): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureText(candidate, options) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** One laid-out line of a text block. */
export interface LaidOutLine {
  text: string;
  /** Left edge of the line, in composition units. */
  x: number;
  /** Baseline of the line, in composition units. */
  y: number;
  /** Measured width of the line. */
  width: number;
  /** Extra space added per gap when the line is justified. */
  wordSpacing: number;
}

/** The outcome of laying out a text element. */
export interface TextLayout {
  lines: LaidOutLine[];
  /** Width of the widest line. */
  width: number;
  /** Distance from the first baseline to the last. */
  height: number;
  /** Baseline advance between lines. */
  lineHeight: number;
}

/** Everything layout needs from a text element. */
export interface LayoutOptions {
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  baseline: 'alphabetic' | 'top' | 'middle' | 'bottom';
  maxWidth?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  paragraphSpacing?: number;
  indent?: number;
}

/**
 * Lays a text block out into positioned lines.
 *
 * Both renderers call this, so the line breaks, the alignment and the block's
 * extent are one decision made once rather than two that have to be kept in
 * step.
 */
export function layoutText(text: string, options: LayoutOptions): TextLayout {
  const measure: MeasureOptions = {
    fontSize: options.fontSize,
    letterSpacing: options.letterSpacing,
    wordSpacing: options.wordSpacing,
  };
  const advance = options.fontSize * options.lineHeight;
  const paragraphs = text.split('\n');
  const indent = options.indent ?? 0;

  const flowed: Array<{ text: string; last: boolean; first: boolean; paragraph: number }> = [];
  paragraphs.forEach((paragraph, index) => {
    const wrapped = options.maxWidth
      ? wrapText(paragraph, Math.max(options.maxWidth - (indent || 0), 1), measure)
      : [paragraph];
    wrapped.forEach((line, i) => {
      flowed.push({
        text: line,
        first: i === 0,
        last: i === wrapped.length - 1,
        paragraph: index,
      });
    });
  });

  const widths = flowed.map((line) => measureText(line.text, measure) + (line.first ? indent : 0));
  const blockWidth = options.maxWidth ?? Math.max(0, ...widths);
  const spacing = options.paragraphSpacing ?? 0;

  // Where the first baseline sits, given what `y` was said to measure.
  const metrics = fontMetrics(options.fontSize);
  const blockHeight = advance * (flowed.length - 1);
  let firstBaseline = options.y;
  if (options.baseline === 'top') firstBaseline = options.y + metrics.capHeight;
  else if (options.baseline === 'middle') {
    firstBaseline = options.y + metrics.capHeight / 2 - blockHeight / 2;
  } else if (options.baseline === 'bottom') firstBaseline = options.y - blockHeight;

  let paragraph = 0;
  let offset = 0;
  const lines: LaidOutLine[] = flowed.map((line, i) => {
    if (line.paragraph !== paragraph) {
      paragraph = line.paragraph;
      offset += spacing;
    }
    const width = widths[i];
    const lead = line.first ? indent : 0;
    let x = options.x + lead;
    if (options.align === 'center') x = options.x - width / 2 + lead;
    else if (options.align === 'right') x = options.x - width;

    let extra = 0;
    if (options.align === 'justify' && !line.last) {
      const gaps = (line.text.match(/ /g) ?? []).length;
      if (gaps > 0) extra = Math.max(0, blockWidth - width) / gaps;
    }
    return {
      text: line.text,
      x,
      y: firstBaseline + advance * i + offset,
      width: width + extra * ((line.text.match(/ /g) ?? []).length),
      wordSpacing: extra,
    };
  });

  return {
    lines,
    width: Math.max(0, ...lines.map((l) => l.width)),
    height: lines.length > 0 ? lines[lines.length - 1].y - lines[0].y : 0,
    lineHeight: advance,
  };
}

/** How a line of glyphs is turned into pen strokes. */
export interface GlyphStrokeOptions {
  fontSize: number;
  letterSpacing?: number;
  wordSpacing?: number;
  slant?: number;
}

/**
 * The pen strokes for one line of text, in composition units.
 *
 * Returned as open contours with y already flipped into screen space, ready
 * for the stroker.
 */
export function lineStrokes(
  text: string,
  x: number,
  baseline: number,
  options: GlyphStrokeOptions,
): Point[][] {
  const scale = options.fontSize / FONT_UNITS_PER_EM;
  const spacing = options.letterSpacing ?? 0;
  const wordSpacing = options.wordSpacing ?? 0;
  const slant = options.slant ?? 0;
  const out: Point[][] = [];
  let pen = x;
  for (const char of text) {
    const g = glyph(char);
    if (g) {
      for (const stroke of g.strokes) {
        out.push(
          stroke.map((p) => ({
            x: pen + (p.x + p.y * slant) * scale,
            y: baseline - p.y * scale,
          })),
        );
      }
    }
    pen += charWidth(char, options.fontSize) + spacing + (char === ' ' ? wordSpacing : 0);
  }
  return out;
}

/** The filled outlines for one line of text, ready to rasterize. */
export function lineContours(
  text: string,
  x: number,
  baseline: number,
  options: GlyphStrokeOptions & { strokeWidth: number },
): Contour[] {
  const out: Contour[] = [];
  for (const stroke of lineStrokes(text, x, baseline, options)) {
    out.push(...strokeContour(stroke, { width: options.strokeWidth, cap: 'round', join: 'round' }));
  }
  return out;
}
