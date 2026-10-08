/**
 * How text is measured. The layout (core/type/layout.ts) asks a measure how
 * wide a string is set in a font, and how far the font reaches above and below
 * its baseline; nothing else about fonts reaches it. So one layout serves every
 * output, and only the advances differ:
 *
 * - **in the app**, the canvas measures in the real fonts the system has
 *   (renderer/type-measure.ts), and lines break where the canvas draws them;
 * - **headless** - the command line, the API, the tests - {@link HEADLESS_MEASURE}
 *   measures with the built-in single-stroke face the rasterizer draws
 *   (graphic-design/font.ts), which is narrower than most real faces. Text a
 *   browser sets in a real face from a headless SVG wraps where the built-in
 *   face did, not where the font would.
 *
 * A measure's ascent is the distance from the top of a line - where napkin
 * text has always been anchored - to its baseline: the canvas's `top`
 * baseline, the em box's top, so text from before lands where it did.
 */

import { charWidth, FONT_CAP_HEIGHT, FONT_UNITS_PER_EM } from '../graphic-design/font.js';

/** A font as the layout sets characters in it. */
export interface TypeFont {
  /** A family name, or a CSS family list. */
  family: string;
  /** The face: `Regular`, `Bold`, `Italic`, `Bold Italic`, `Semibold`. */
  style: string;
  /** Page pixels. */
  size: number;
  /** The font's own pair kerning. */
  kerning: boolean;
  /** The font's small capitals, where a measure can set them. */
  smallCaps: boolean;
}

/** What the layout asks of the world about fonts. */
export interface TypeMeasure {
  /** Changes when the measure would give other numbers: a layout kept for one is not another's. */
  readonly id: string;
  /**
   * True when its widths are the face's own, as a browser sets it: an SVG may
   * then pin each character where the layout put it. The built-in face's are
   * an approximation, and pinning would space real letters by them.
   */
  readonly exact: boolean;
  /** True when it sets small capitals itself; otherwise the layout sets capitals at 70% for them. */
  readonly smallCaps: boolean;
  /** How wide `text` is set in `font`, page pixels: the face's advances and, with kerning on, its pairs. */
  width(text: string, font: TypeFont): number;
  /** How far the font reaches above its baseline - to the top of its line - and below it, at its size. */
  extent(font: TypeFont): { ascent: number; descent: number };
}

/** A face name's weight and slant, as CSS has them: `Bold Italic` is 700 italic. */
export function faceStyle(style: string): { weight: number; italic: boolean } {
  const s = style.toLowerCase();
  const italic = /italic|oblique/.test(s);
  // The more particular names first: Extra Light before Light, Semibold and Extra Bold before Bold.
  const weights: Array<[RegExp, number]> = [
    [/thin|hairline/, 100],
    [/(extra|ultra)[\s-]?light/, 200],
    [/light/, 300],
    [/medium/, 500],
    [/(semi|demi)[\s-]?bold/, 600],
    [/(extra|ultra)[\s-]?bold|heavy/, 800],
    [/black/, 900],
    [/bold/, 700],
  ];
  for (const [pattern, weight] of weights) if (pattern.test(s)) return { weight, italic };
  return { weight: 400, italic };
}

/** A face's name from a CSS weight and slant: 700 italic is `Bold Italic`, the inverse of {@link faceStyle}. */
export function faceName(weight: number, italic: boolean): string {
  const names: Array<[number, string]> = [[100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']];
  let name = 'Regular';
  let best = Infinity;
  for (const [w, n] of names) {
    if (Math.abs(w - weight) < best) {
      best = Math.abs(w - weight);
      name = n;
    }
  }
  if (!italic) return name;
  return name === 'Regular' ? 'Italic' : `${name} Italic`;
}

/** A family as CSS takes it: a list stays a list; one name is quoted. */
export function cssFamily(family: string): string {
  const f = family.trim();
  if (f.includes(',') || /^["']/.test(f) || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(f)) return f;
  return `"${f.replace(/"/g, '')}"`;
}

/** A font as the CSS `font` shorthand: what a canvas and an SVG's style take. */
export function cssFont(font: TypeFont): string {
  const { weight, italic } = faceStyle(font.style);
  return `${italic ? 'italic ' : ''}${weight} ${font.size}px ${cssFamily(font.family)}`;
}

/** A key that names a font for a cache: everything that changes how it measures. */
export function fontKey(font: TypeFont): string {
  return `${font.family}\u0001${font.style}\u0001${font.size}\u0001${font.kerning ? 'k' : '-'}${font.smallCaps ? 's' : '-'}`;
}

/**
 * The built-in face's measure: its advances, no kerning, and the line box its
 * renderer has always set text in - the cap height above the baseline, so
 * text anchored at its top lands where the composition puts it.
 */
export const HEADLESS_MEASURE: TypeMeasure = {
  id: 'built-in',
  exact: false,
  smallCaps: false,
  width(text: string, font: TypeFont): number {
    let width = 0;
    for (const ch of text) width += charWidth(ch, font.size);
    return width;
  },
  extent(font: TypeFont): { ascent: number; descent: number } {
    const ascent = (FONT_CAP_HEIGHT / FONT_UNITS_PER_EM) * font.size;
    return { ascent, descent: font.size - ascent };
  },
};
