/**
 * Browser-safe sketch-book (de)serialization and validation.
 *
 * This module has **no Node dependencies** so it can be bundled into the
 * renderer and the embeddable web API. File-system I/O lives in
 * `sketchbook.ts`, which builds on top of these pure helpers.
 *
 * Reading is defensive: unknown/old documents are normalized rather than
 * trusted.
 */

import { extension, stem } from './paths.js';
import {
  SKETCHBOOK_EXTENSION,
  SKETCHBOOK_VERSION,
  createId,
  createSketch,
  createSketchBook,
  type Sketch,
  type SketchBook,
  type Stroke,
  type Tool,
} from './types.js';

/** Ensures a path/name ends with the `.skbk` extension. */
export function withSketchBookExtension(filePath: string): string {
  if (extension(filePath) === SKETCHBOOK_EXTENSION) {
    return filePath;
  }
  return `${filePath}.${SKETCHBOOK_EXTENSION}`;
}

/** Derives a book name from a file path (basename without extension). */
export function deriveName(filePath: string): string {
  return stem(filePath) || 'untitled';
}

const VALID_TOOLS: Tool[] = ['pen', 'marker', 'eraser', 'select', 'text'];

function normalizeStroke(raw: unknown): Stroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const points = Array.isArray(r.points)
    ? r.points
        .map((p) => {
          if (!p || typeof p !== 'object') return null;
          const pr = p as Record<string, unknown>;
          if (typeof pr.x !== 'number' || typeof pr.y !== 'number') return null;
          return {
            x: pr.x,
            y: pr.y,
            pressure: typeof pr.pressure === 'number' ? pr.pressure : undefined,
            t: typeof pr.t === 'number' ? pr.t : undefined,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
    : [];

  if (points.length === 0) return null;

  // 'select' is a transient UI tool and never persisted as a mark.
  const rawTool = VALID_TOOLS.includes(r.tool as Tool) ? (r.tool as Tool) : 'pen';
  const tool: Tool = rawTool === 'select' ? 'pen' : rawTool;
  const isText = tool === 'text' && typeof r.text === 'string';

  return {
    id: typeof r.id === 'string' ? r.id : createId('st'),
    tool,
    color: typeof r.color === 'string' ? r.color : '#1f2328',
    width: typeof r.width === 'number' && r.width > 0 ? r.width : 3,
    points,
    sharpened: r.sharpened === true,
    text: isText ? (r.text as string) : undefined,
    fontSize: isText && typeof r.fontSize === 'number' ? r.fontSize : undefined,
    fontFamily: isText && typeof r.fontFamily === 'string' ? r.fontFamily : undefined,
  };
}

function normalizeSketch(raw: unknown): Sketch {
  const base = createSketch();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const strokes = Array.isArray(r.strokes)
    ? r.strokes.map(normalizeStroke).filter((s): s is Stroke => s !== null)
    : [];

  return {
    id: typeof r.id === 'string' ? r.id : base.id,
    name: typeof r.name === 'string' ? r.name : base.name,
    width: typeof r.width === 'number' && r.width > 0 ? r.width : base.width,
    height: typeof r.height === 'number' && r.height > 0 ? r.height : base.height,
    background: typeof r.background === 'string' ? r.background : base.background,
    strokes,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : base.createdAt,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : base.updatedAt,
  };
}

/** Coerces an arbitrary parsed object into a valid SketchBook. */
export function normalizeSketchBook(raw: unknown, fallbackName = 'untitled'): SketchBook {
  if (!raw || typeof raw !== 'object') {
    return createSketchBook(fallbackName);
  }
  const r = raw as Record<string, unknown>;
  const sketches = Array.isArray(r.sketches) ? r.sketches.map(normalizeSketch) : [];
  const book: SketchBook = {
    format: 'napkin-sketch',
    version: SKETCHBOOK_VERSION,
    name: typeof r.name === 'string' ? r.name : fallbackName,
    sketches: sketches.length > 0 ? sketches : [createSketch()],
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  };
  return book;
}

/** Serializes a sketch book to pretty-printed, human-diffable JSON. */
export function serializeSketchBook(book: SketchBook): string {
  const toWrite: SketchBook = { ...book, updatedAt: new Date().toISOString() };
  return JSON.stringify(toWrite, null, 2);
}

/** Parses and normalizes a sketch book from a JSON string. */
export function parseSketchBook(text: string, fallbackName = 'untitled'): SketchBook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not a valid .skbk document: ${(err as Error).message}`);
  }
  return normalizeSketchBook(parsed, fallbackName);
}
