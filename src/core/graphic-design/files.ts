/**
 * Node-only file helpers for the graphic-design API.
 *
 * The renderers themselves import nothing from Node, so they run in a browser
 * bundle untouched. Reading a logo off disk and writing a pair of exports
 * beside each other is nevertheless what a script does first and last, and
 * doing it by hand means a caller reinventing base64 and MIME sniffing. This
 * module is the Node half, kept separate for the same reason `pdf-import.ts`
 * is: so importing the API never drags `node:fs` into a web build.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { compositionToSvg, type SvgOptions } from './svg.js';
import { renderPng, Composition, type CompositionFormat } from './compose.js';
import type { RasterOptions } from './raster.js';
import type { CompositionDocument } from './types.js';

/** Media types the loader recognises by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** The media type a path implies, or `application/octet-stream`. */
export function mediaTypeOf(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Reads an image file and returns it as a data URL, ready for `image.src`.
 *
 * SVG is embedded as UTF-8 rather than base64, which keeps a vector placement
 * readable in the output and roughly a third smaller.
 */
export async function imageDataUrl(path: string): Promise<string> {
  const bytes = await readFile(path);
  const mime = mediaTypeOf(path);
  if (mime === 'image/svg+xml') {
    return `data:image/svg+xml;utf8,${encodeURIComponent(bytes.toString('utf8'))}`;
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** Options for {@link writeComposition}. */
export interface WriteOptions extends RasterOptions, SvgOptions {
  /** Formats to write. Defaults to both. */
  formats?: CompositionFormat[];
}

/** What {@link writeComposition} wrote, keyed by format. */
export interface WrittenFiles {
  svg?: string;
  png?: string;
  /** Anything the raster pass could not draw. */
  warnings: string[];
}

/**
 * Writes a composition to `<dir>/<name>.svg` and `<dir>/<name>.png`.
 *
 * Both come off one document in one call, which is the point: a caller cannot
 * accidentally export the SVG of one revision beside the PNG of another.
 */
export async function writeComposition(
  source: Composition | CompositionDocument,
  dir: string,
  name: string,
  options: WriteOptions = {},
): Promise<WrittenFiles> {
  const doc = source instanceof Composition ? source.toDocument() : source;
  const formats = options.formats ?? ['svg', 'png'];
  await mkdir(dir, { recursive: true });

  const written: WrittenFiles = { warnings: [] };
  if (formats.includes('svg')) {
    const path = join(dir, `${name}.svg`);
    await writeFile(path, compositionToSvg(doc, options), 'utf8');
    written.svg = path;
  }
  if (formats.includes('png')) {
    const path = join(dir, `${name}.png`);
    const render = renderPng(doc, options);
    await writeFile(path, render.data);
    written.png = path;
    written.warnings.push(...render.warnings);
  }
  return written;
}
