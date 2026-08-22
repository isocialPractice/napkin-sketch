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
  createLayer,
  createSketch,
  createSketchBook,
  type Gradient,
  type GradientStop,
  type Layer,
  type Sketch,
  type SketchBook,
  type Stroke,
  type StrokeStyle,
  type Tool,
  type VectorAnchor,
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

const VALID_TOOLS: Tool[] = ['pen', 'marker', 'copic', 'eraser', 'select', 'text', 'image'];

/** Reads an `{x, y}` position, or null when the shape is invalid. */
function normalizeXY(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.x !== 'number' || typeof r.y !== 'number') return null;
  return { x: r.x, y: r.y };
}

/**
 * Reads a stroke's editable vector structure (Bézier anchors). Invalid or
 * partial data drops the whole structure — the stroke still renders from its
 * sampled points, it just stops being Vector Path editable.
 */
function normalizeVector(raw: unknown): Stroke['vector'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.anchors)) return undefined;
  const anchors: VectorAnchor[] = [];
  for (const entry of r.anchors) {
    if (!entry || typeof entry !== 'object') return undefined;
    const a = entry as Record<string, unknown>;
    const p = normalizeXY(a.p);
    if (!p) return undefined;
    const hIn = normalizeXY(a.hIn);
    const hOut = normalizeXY(a.hOut);
    anchors.push({ p, ...(hIn ? { hIn } : {}), ...(hOut ? { hOut } : {}) });
  }
  if (anchors.length < 2) return undefined;
  return { anchors, ...(r.closed === true ? { closed: true } : {}) };
}

/**
 * Reads a gradient fill. A gradient needs at least two usable stops to paint;
 * anything less drops the whole structure and the stroke falls back to its
 * flat `fill` color.
 */
export function normalizeGradient(raw: unknown): Gradient | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.stops)) return undefined;
  const stops: GradientStop[] = [];
  for (const entry of r.stops) {
    if (!entry || typeof entry !== 'object') continue;
    const stop = entry as Record<string, unknown>;
    if (typeof stop.color !== 'string' || typeof stop.offset !== 'number') continue;
    if (!Number.isFinite(stop.offset)) continue;
    stops.push({ offset: Math.min(1, Math.max(0, stop.offset)), color: stop.color });
  }
  if (stops.length < 2) return undefined;
  stops.sort((a, b) => a.offset - b.offset);
  const type = r.type === 'radial' ? 'radial' : 'linear';
  const angle =
    typeof r.angle === 'number' && Number.isFinite(r.angle) ? ((r.angle % 360) + 360) % 360 : 0;
  return { type, stops, ...(type === 'linear' ? { angle } : {}) };
}

/** Reads a stroke's dash style; anything unrecognized reads as solid. */
function normalizeStrokeStyle(raw: unknown): StrokeStyle | undefined {
  return raw === 'dashed' || raw === 'dotted' ? raw : undefined;
}

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
  const isImage = tool === 'image' && typeof r.image === 'string';
  // An image item without its data is unrenderable; drop it.
  if (tool === 'image' && !isImage) return null;

  return {
    id: typeof r.id === 'string' ? r.id : createId('st'),
    tool,
    color: typeof r.color === 'string' ? r.color : '#1f2328',
    width: typeof r.width === 'number' && r.width > 0 ? r.width : 3,
    points,
    opacity:
      typeof r.opacity === 'number' && r.opacity > 0 && r.opacity <= 1 ? r.opacity : undefined,
    sharpened: r.sharpened === true,
    fill:
      typeof r.fill === 'string' && !isText && !isImage && tool !== 'eraser'
        ? r.fill
        : undefined,
    gradient: !isText && !isImage && tool !== 'eraser' ? normalizeGradient(r.gradient) : undefined,
    strokeStyle: !isImage && tool !== 'eraser' ? normalizeStrokeStyle(r.strokeStyle) : undefined,
    noStroke:
      r.noStroke === true && !isText && !isImage && tool !== 'eraser' ? true : undefined,
    nibAngle:
      tool === 'copic' && typeof r.nibAngle === 'number' && Number.isFinite(r.nibAngle)
        ? ((r.nibAngle % 360) + 360) % 360
        : undefined,
    text: isText ? (r.text as string) : undefined,
    fontSize: isText && typeof r.fontSize === 'number' ? r.fontSize : undefined,
    fontFamily: isText && typeof r.fontFamily === 'string' ? r.fontFamily : undefined,
    textBoxWidth: isText && typeof r.textBoxWidth === 'number' ? r.textBoxWidth : undefined,
    layer: typeof r.layer === 'string' ? r.layer : undefined,
    vector: !isText && !isImage && tool !== 'eraser' ? normalizeVector(r.vector) : undefined,
    image: isImage ? (r.image as string) : undefined,
    imageWidth: isImage && typeof r.imageWidth === 'number' ? r.imageWidth : undefined,
    imageHeight: isImage && typeof r.imageHeight === 'number' ? r.imageHeight : undefined,
  };
}

function normalizeLayer(raw: unknown, index: number): Layer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' ? r.id : createId('ly'),
    name: typeof r.name === 'string' && r.name.length > 0 ? r.name : `Layer ${index + 1}`,
    opacity: typeof r.opacity === 'number' ? Math.min(1, Math.max(0, r.opacity)) : 1,
    visible: r.visible !== false,
    locked: r.locked === true,
    group: r.group === true ? true : undefined,
    parent: typeof r.parent === 'string' ? r.parent : undefined,
  };
}

/**
 * Drops invalid layer parent links: a parent must reference an existing group
 * and must not form a cycle. Bad links become top-level layers.
 */
function sanitizeLayerParents(layers: Layer[]): void {
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const layer of layers) {
    if (!layer.parent) continue;
    const parent = byId.get(layer.parent);
    if (!parent || !parent.group || parent === layer) {
      delete layer.parent;
      continue;
    }
    // Walk up; a path that revisits this layer is a cycle.
    const seen = new Set<string>([layer.id]);
    let cursor: Layer | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) {
        delete layer.parent;
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
  }
}

function normalizeSketch(raw: unknown): Sketch {
  const base = createSketch();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const strokes = Array.isArray(r.strokes)
    ? r.strokes.map(normalizeStroke).filter((s): s is Stroke => s !== null)
    : [];

  // Version 1 documents carry no layer stack; give them a single default
  // layer. Invalid or missing stroke layer ids fall back to the first layer.
  const layers = Array.isArray(r.layers)
    ? r.layers.map(normalizeLayer).filter((l): l is Layer => l !== null)
    : [];
  // Every sketch needs at least one drawable (non-group) layer.
  if (!layers.some((l) => !l.group)) layers.push(createLayer());
  sanitizeLayerParents(layers);
  const drawableIds = new Set(layers.filter((l) => !l.group).map((l) => l.id));
  const fallbackId = layers.find((l) => !l.group)!.id;
  for (const stroke of strokes) {
    if (!stroke.layer || !drawableIds.has(stroke.layer)) stroke.layer = fallbackId;
  }

  return {
    id: typeof r.id === 'string' ? r.id : base.id,
    name: typeof r.name === 'string' ? r.name : base.name,
    width: typeof r.width === 'number' && r.width > 0 ? r.width : base.width,
    height: typeof r.height === 'number' && r.height > 0 ? r.height : base.height,
    sizeMode: r.sizeMode === 'sized' ? 'sized' : undefined,
    background: typeof r.background === 'string' ? r.background : base.background,
    layers,
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
