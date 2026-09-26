/**
 * One call, every format: a sketch or a book written as SVG, PNG, PDF,
 * `.skbk` or an Illustrator script, with no DOM, in a browser or in plain
 * Node.
 *
 * - **SVG** is the app's own export, `sketchToSvg`, cut to the box.
 * - **PNG** is the sketch lowered into the composition model and drawn by its
 *   rasterizer (`sketchToComposition`, then `renderPng`), so it is the picture
 *   the SVG draws, with no canvas and no dependency.
 * - **PDF** is `sketchesToPdf`, one page a sketch, its media box the box.
 * - **`.skbk`** is the book as the app saves it, which opens in the GUI with
 *   its layers and anchors. It is the whole document, so no box applies, and
 *   it keeps the book's own timestamps, so one script writes the same bytes
 *   every run.
 * - **`.jsx`** is `sketchesToJsx`: one ExtendScript file that rebuilds the
 *   book in Adobe Illustrator, each page a document, its artboard the box.
 *
 * Every format is cut to one box, from one option. `crop: 'auto'` is the ink:
 * the bounds of every mark on a visible layer, grown by half the widest
 * outline so the edge of a line is not sliced off - the box the app's
 * Selection export cuts to - and then by the pad. A box is used as given.
 * `registration` is a box every page shares and wins over `crop`, so frames
 * drawn by one script land on one origin and play back without shifting.
 */

import { strokeBounds } from '../bounds.js';
import { renderPng } from '../graphic-design/compose.js';
import type { ImageDecoder } from '../graphic-design/raster.js';
import type { LinkResolver } from '../link.js';
import { sketchesToJsx } from '../illustrator.js';
import { sketchesToPdf } from '../pdf.js';
import { sketchToComposition } from '../sketch-composition.js';
import { sketchToSvg } from '../sketch-svg.js';
import { effectiveLayers, SKETCHBOOK_VERSION, strokesByLayer, type Sketch, type SketchBook, type Stroke } from '../types.js';
import type { Box, CropHint } from './evaluate.js';
import { measureTextBlock } from './text.js';

/** The formats {@link renderSketch} and {@link renderBook} write. */
export type RenderFormat = 'svg' | 'png' | 'pdf' | 'skbk' | 'jsx';

/** Every {@link RenderFormat}, in the order the docs list them. */
export const RENDER_FORMATS: readonly RenderFormat[] = ['svg', 'png', 'pdf', 'skbk', 'jsx'];

/**
 * What to cut a page to: `'auto'` for its ink, `'none'` for the whole page, or
 * a box in page pixels. A script's `crop` hint (`ScriptResult.output.crop`)
 * is accepted as it comes, which is how `crop auto pad 8` reaches here.
 */
export type RenderCrop = 'auto' | 'none' | Box | CropHint;

/** How {@link renderSketch} and {@link renderBook} write a page. */
export interface RenderSketchOptions {
  /** The format to write. Default `'svg'`. */
  format?: RenderFormat;
  /** What to cut each page to. Default: the whole page. Not used by `.skbk`. */
  crop?: RenderCrop;
  /** One box every page is cut to; wins over `crop`. Not used by `.skbk`. */
  registration?: Box;
  /** Leave the paper out of an SVG, a PNG or an Illustrator script. A PDF keeps its paper, as the app's exports do. */
  transparent?: boolean;
  /** PNG pixels a page pixel. Default 1; 2 is a retina asset. */
  scale?: number;
  /** Reads the file behind a linked image for the PNG. Without one, a link draws as its placeholder. */
  resolveLink?: LinkResolver;
  /**
   * The folder an Illustrator script looks for a linked file in, relative to
   * the script's own folder or absolute. The script's own folder unless
   * given; `writeBook` and `drawToFiles` set it to the folder the links are
   * read in.
   */
  linkFolder?: string;
  /** Decodes a placed image the PNG cannot open itself - a JPEG, say. PNG needs none. */
  decodeImage?: ImageDecoder;
  /** Told about everything a format left out or drew as a stand-in: an image a PDF cannot embed, a link that did not resolve. */
  onWarning?: (message: string) => void;
}

/** Measures a text item with the built-in face, the measure every renderer here uses. */
function measureText(stroke: Stroke): { width: number; height: number } {
  const block = measureTextBlock(stroke.text ?? '', stroke.fontSize ?? 24, stroke.textBoxWidth);
  return { width: block.width, height: block.height };
}

/** Rounds to two decimals, the precision every writer here uses for a box. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The box a page's ink covers: every mark on a visible layer, text measured
 * with the built-in face, grown by half the widest outline, since a line's
 * bounds follow its centre and its outer edge lies half its width beyond.
 * An eraser adds no ink, so it adds nothing to the box. Null for a page with
 * nothing drawn.
 */
export function inkBox(sketch: Sketch): Box | null {
  const layers = effectiveLayers(sketch);
  const byLayer = strokesByLayer(sketch);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let widest = 0;
  for (const [layerId, strokes] of byLayer) {
    if (!layers.get(layerId)?.visible) continue;
    for (const stroke of strokes) {
      if (stroke.tool === 'eraser') continue;
      const bounds = strokeBounds(stroke, measureText);
      if (!bounds) continue;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
      widest = Math.max(widest, stroke.width ?? 0);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const half = widest / 2;
  return { x: minX - half, y: minY - half, width: maxX - minX + widest, height: maxY - minY + widest };
}

/**
 * The box a page is written in: the registration box when there is one,
 * otherwise what `crop` asks for, rounded to two decimals so every format
 * reads the same numbers. Null for the whole page, which is also what
 * `crop: 'auto'` gives a page with nothing drawn on it.
 */
export function renderBox(sketch: Sketch, options: Pick<RenderSketchOptions, 'crop' | 'registration'> = {}): Box | null {
  const box = options.registration ?? cropBox(sketch, options.crop);
  if (!box) return null;
  return { x: round2(box.x), y: round2(box.y), width: round2(box.width), height: round2(box.height) };
}

function cropBox(sketch: Sketch, crop: RenderCrop | undefined): Box | null {
  if (crop === undefined || crop === 'none') return null;
  if (crop === 'auto') return inkBox(sketch);
  if ('mode' in crop) {
    if (crop.mode === 'none') return null;
    if (crop.mode === 'box') return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    const ink = inkBox(sketch);
    const pad = Math.max(0, crop.pad);
    return ink && { x: ink.x - pad, y: ink.y - pad, width: ink.width + 2 * pad, height: ink.height + 2 * pad };
  }
  return crop;
}

/** A page's box as the SVG writer takes it. */
function svgCrop(box: Box | null): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  return box ? { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height } : undefined;
}

function checkFormat(format: string): RenderFormat {
  if ((RENDER_FORMATS as readonly string[]).includes(format)) return format as RenderFormat;
  throw new Error(`napkin-sketch: cannot render "${format}"; the formats are ${RENDER_FORMATS.join(', ')}`);
}

/** A book written as the app saves one, keeping the book's own timestamps. */
function skbkOf(book: SketchBook): string {
  return JSON.stringify(book, null, 2);
}

function pngOf(sketch: Sketch, box: Box | null, options: RenderSketchOptions): Uint8Array {
  const warn = (message: string): void => options.onWarning?.(`page "${sketch.name}": ${message}`);
  const doc = sketchToComposition(sketch, { crop: box ?? undefined, transparent: options.transparent, onWarning: warn });
  const png = renderPng(doc, { scale: options.scale, resolveLink: options.resolveLink, decodeImage: options.decodeImage });
  for (const warning of png.warnings) warn(warning);
  return png.data;
}

/** The options an Illustrator script is written with, for these pages. */
function jsxOptions(sketches: readonly Sketch[], options: RenderSketchOptions): Parameters<typeof sketchesToJsx>[1] {
  return {
    crops: sketches.map((sketch) => renderBox(sketch, options)),
    transparent: options.transparent,
    linkFolder: options.linkFolder,
    onWarning: options.onWarning,
  };
}

/**
 * Writes one page. A string for `svg`, `pdf` (latin1: write it with
 * `'latin1'` encoding, as `sketchesToPdf` says), `skbk` and `jsx`, and PNG
 * bytes for `png`.
 */
export function renderSketch(sketch: Sketch, options: RenderSketchOptions & { format: 'png' }): Uint8Array;
export function renderSketch(sketch: Sketch, options?: RenderSketchOptions & { format?: 'svg' | 'pdf' | 'skbk' | 'jsx' }): string;
export function renderSketch(sketch: Sketch, options?: RenderSketchOptions): string | Uint8Array;
export function renderSketch(sketch: Sketch, options: RenderSketchOptions = {}): string | Uint8Array {
  const format = checkFormat(options.format ?? 'svg');
  if (format === 'skbk') {
    return skbkOf({
      format: 'napkin-sketch',
      version: SKETCHBOOK_VERSION,
      name: sketch.name,
      sketches: [sketch],
      createdAt: sketch.createdAt,
      updatedAt: sketch.updatedAt,
    });
  }
  if (format === 'jsx') return sketchesToJsx([sketch], jsxOptions([sketch], options));
  const box = renderBox(sketch, options);
  if (format === 'svg') return sketchToSvg(sketch, { crop: svgCrop(box), transparent: options.transparent });
  if (format === 'png') return pngOf(sketch, box, options);
  return sketchesToPdf([sketch], { crops: [box], onWarning: options.onWarning });
}

/**
 * Writes every page of a book: one SVG or one PNG a page, in page order, and
 * one PDF, one `.skbk` or one Illustrator script for the whole book.
 * `crop: 'auto'` cuts each page to its own ink; `registration` cuts every
 * page to the same box.
 */
export function renderBook(book: SketchBook, options: RenderSketchOptions & { format: 'png' }): Uint8Array[];
export function renderBook(book: SketchBook, options: RenderSketchOptions & { format: 'pdf' | 'skbk' | 'jsx' }): string;
export function renderBook(book: SketchBook, options?: RenderSketchOptions & { format?: 'svg' }): string[];
export function renderBook(book: SketchBook, options?: RenderSketchOptions): string | string[] | Uint8Array[];
export function renderBook(book: SketchBook, options: RenderSketchOptions = {}): string | string[] | Uint8Array[] {
  const format = checkFormat(options.format ?? 'svg');
  if (format === 'skbk') return skbkOf(book);
  if (format === 'jsx') return sketchesToJsx(book.sketches, jsxOptions(book.sketches, options));
  if (format === 'pdf') {
    return sketchesToPdf(book.sketches, { crops: book.sketches.map((sketch) => renderBox(sketch, options)), onWarning: options.onWarning });
  }
  if (format === 'png') return book.sketches.map((sketch) => pngOf(sketch, renderBox(sketch, options), options));
  return book.sketches.map((sketch) => sketchToSvg(sketch, { crop: svgCrop(renderBox(sketch, options)), transparent: options.transparent }));
}
