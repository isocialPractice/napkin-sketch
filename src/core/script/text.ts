/**
 * Text in napkin script, with no DOM.
 *
 * A text item is the app's own: live text the app sets in the named font and
 * edits like any other text. Nothing here can ask a browser how wide a font
 * sets a word, so the evaluator measures with the built-in face the
 * composition renderers use (`graphic-design/font.ts`). That measure is what
 * `align` places a text item against. A real face usually sets a little wider
 * than the built-in one, so centred text is centred on the built-in face's
 * measure rather than the font's own.
 *
 * `text ... as marks` draws the letters instead: the built-in face's pen
 * strokes as one mark under the current paint, so `rough` roughens lettering
 * too - the sketchy caption a napkin wants - and the letters turn, mirror and
 * stretch with the drawing, which a text item cannot.
 */

import { glyph, layoutText, lineStrokes, measureText, wrapText } from '../graphic-design/font.js';
import type { ParsedSubpath } from '../path-data.js';
import { joinSubpaths, type Outline } from './shapes.js';

/** How far apart the app sets lines of text, as a share of the size. */
export const TEXT_LINE_HEIGHT = 1.25;

/** Where text sits against its `at` point. */
export type TextAlign = 'left' | 'center' | 'right';

/** Text measured with the built-in face: its lines, and the box they fill. */
export interface TextBlock {
  lines: string[];
  width: number;
  height: number;
}

/**
 * Measures text the way the app lays out a text item: a line for each
 * newline, and within a fixed box width, lines wrapped between words. The
 * width is the box's, or the widest line's; the height is one line height a
 * line.
 */
export function measureTextBlock(text: string, size: number, box?: number): TextBlock {
  const wrap = box !== undefined && box > 0;
  const paragraphs = text.split('\n');
  const lines = wrap ? paragraphs.flatMap((paragraph) => wrapText(paragraph, box, { fontSize: size })) : paragraphs;
  const width = wrap ? box : Math.max(0, ...lines.map((line) => measureText(line, { fontSize: size })));
  return { lines, width, height: lines.length * size * TEXT_LINE_HEIGHT };
}

/** The characters of `text` the built-in face cannot draw, each once, in order. */
export function missingGlyphs(text: string): string[] {
  const missing: string[] = [];
  for (const char of text) {
    if (char === '\n' || glyph(char) || missing.includes(char)) continue;
    missing.push(char);
  }
  return missing;
}

/**
 * Text drawn as the built-in face's pen strokes: one open mark, with every
 * stroke of every letter a subpath of it. `x`, `y` is the top of the first
 * line, and each line is aligned on `x` by itself, so a centred block is
 * centred line by line. A dot, which the face draws as a single point,
 * becomes a stroke a fiftieth of the size long, for a round cap to show.
 * Null when there is nothing to draw.
 */
export function textOutline(text: string, x: number, y: number, size: number, align: TextAlign, box?: number): Outline | null {
  const layout = layoutText(text, {
    x,
    y,
    fontSize: size,
    lineHeight: TEXT_LINE_HEIGHT,
    align,
    baseline: 'top',
    maxWidth: box !== undefined && box > 0 ? box : undefined,
  });
  const subpaths: ParsedSubpath[] = [];
  for (const line of layout.lines) {
    for (const stroke of lineStrokes(line.text, line.x, line.y, { fontSize: size, wordSpacing: line.wordSpacing })) {
      const points = stroke.length === 1 ? [stroke[0], { x: stroke[0].x + size / 50, y: stroke[0].y }] : stroke;
      subpaths.push({ anchors: points.map((p) => ({ p: { x: p.x, y: p.y } })), closed: false });
    }
  }
  return joinSubpaths(subpaths);
}
