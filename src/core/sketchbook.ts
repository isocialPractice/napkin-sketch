/**
 * Sketch-book (`.skbk`) file I/O.
 *
 * The on-disk format is pretty-printed JSON (human-diffable). All parsing,
 * normalization, and serialization lives in the browser-safe `serialize.ts`;
 * this module only adds Node file-system concerns (atomic writes, existence).
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SketchBook } from './types.js';
import {
  deriveName,
  normalizeSketchBook,
  parseSketchBook,
  serializeSketchBook,
  withSketchBookExtension,
} from './serialize.js';

export {
  deriveName,
  normalizeSketchBook,
  parseSketchBook,
  serializeSketchBook,
  withSketchBookExtension,
};

/** Reads and validates a sketch book from disk. Throws if the file is unreadable. */
export async function readSketchBook(filePath: string): Promise<SketchBook> {
  const full = resolve(withSketchBookExtension(filePath));
  const text = await readFile(full, 'utf8');
  return parseSketchBook(text, deriveName(full));
}

/**
 * Writes a sketch book to disk atomically (write temp, then rename) so an
 * interrupted save cannot corrupt the original file.
 */
export async function writeSketchBook(filePath: string, book: SketchBook): Promise<string> {
  const full = resolve(withSketchBookExtension(filePath));
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, serializeSketchBook(book), 'utf8');
  await rename(tmp, full);
  return full;
}

/** Returns true if a sketch-book file already exists at the (extension-normalized) path. */
export function sketchBookExists(filePath: string): boolean {
  return existsSync(resolve(withSketchBookExtension(filePath)));
}
