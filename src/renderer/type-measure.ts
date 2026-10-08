/**
 * The canvas's type measure (core/type/measure.ts): how wide the fonts the
 * system has set a string, and how far they reach above and below the
 * baseline. The type layout breaks lines with it, so text breaks where the
 * canvas draws it.
 *
 * Its ascent is the distance from the em box's top - the canvas's `top`
 * baseline, where napkin text has always been anchored - down to the
 * alphabetic baseline; its descent is the rest of the size. So a text mark
 * from before draws exactly where it did.
 *
 * Widths are kept per string and font. When the document's fonts finish
 * loading, what was kept goes, the measure takes a new id - so every layout
 * made with the old widths is made again - and whoever asked to hear of it
 * repaints.
 */

import { cssFont, fontKey, type TypeFont, type TypeMeasure } from '../core/type/measure.js';

/** The canvas measure, and a way to hear when its widths change. */
export interface CanvasTypeMeasure extends TypeMeasure {
  /** Calls `listener` when the measure's widths change: a font finished loading. */
  onChange(listener: () => void): void;
}

/** How many widths are kept before the store starts again. */
const KEPT_WIDTHS = 50_000;

let shared: CanvasTypeMeasure | null = null;

/** The renderer's one canvas measure. */
export function canvasTypeMeasure(): CanvasTypeMeasure {
  if (shared) return shared;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('No 2D canvas to measure type with.');
  let generation = 0;
  let widths = new Map<string, number>();
  let extents = new Map<string, { ascent: number; descent: number }>();
  const listeners: Array<() => void> = [];
  const setFont = (font: TypeFont): void => {
    ctx.font = cssFont(font);
    ctx.fontKerning = font.kerning ? 'normal' : 'none';
    ctx.fontVariantCaps = font.smallCaps ? 'small-caps' : 'normal';
    ctx.letterSpacing = '0px';
    ctx.wordSpacing = '0px';
  };
  const measure: CanvasTypeMeasure = {
    get id() {
      return `canvas:${generation}`;
    },
    exact: true,
    smallCaps: true,
    width(text: string, font: TypeFont): number {
      const key = `${fontKey(font)}\u0002${text}`;
      let width = widths.get(key);
      if (width === undefined) {
        setFont(font);
        width = ctx.measureText(text).width;
        if (widths.size >= KEPT_WIDTHS) widths.clear();
        widths.set(key, width);
      }
      return width;
    },
    extent(font: TypeFont): { ascent: number; descent: number } {
      const key = fontKey(font);
      let extent = extents.get(key);
      if (!extent) {
        setFont(font);
        ctx.textBaseline = 'top';
        // From the em box's top down to the alphabetic baseline; a canvas that cannot say gives the usual 80%.
        const below = -ctx.measureText('H').alphabeticBaseline;
        const ascent = Number.isFinite(below) && below > 0 && below < font.size * 2 ? below : font.size * 0.8;
        extent = { ascent, descent: Math.max(0, font.size - ascent) };
        extents.set(key, extent);
      }
      return extent;
    },
    onChange(listener: () => void): void {
      listeners.push(listener);
    },
  };
  document.fonts?.addEventListener('loadingdone', () => {
    generation++;
    widths = new Map();
    extents = new Map();
    for (const listener of listeners) listener();
  });
  shared = measure;
  return measure;
}
