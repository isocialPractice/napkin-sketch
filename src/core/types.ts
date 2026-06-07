/**
 * Shared data model for napkin-sketch.
 *
 * A SketchBook (`.skbk` file) is a JSON document holding one or more Sketches.
 * Each Sketch is a list of Strokes; each Stroke is a list of sampled Points.
 */

/** A single sampled point along a stroke. */
export interface Point {
  /** X position in canvas pixels. */
  x: number;
  /** Y position in canvas pixels. */
  y: number;
  /** Normalized pen pressure (0–1). Defaults to 0.5 for mouse input. */
  pressure?: number;
  /** Timestamp (ms, relative to stroke start) used for velocity-aware sharpening. */
  t?: number;
}

/** Tool used to lay down a stroke or interact with the canvas. */
export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'text';

/** A continuous drawing stroke, or a text item when `tool === 'text'`. */
export interface Stroke {
  /** Unique id within the sketch. */
  id: string;
  /** Tool used to create the stroke. */
  tool: Tool;
  /** CSS color string. */
  color: string;
  /** Nominal stroke width in pixels. */
  width: number;
  /** Raw sampled input points. For text items, `points[0]` is the anchor. */
  points: Point[];
  /** Whether this stroke has already been auto-sharpened. */
  sharpened?: boolean;
  /** Text content (only present when `tool === 'text'`). */
  text?: string;
  /** Font size in pixels (text items). */
  fontSize?: number;
  /** Font family (text items). */
  fontFamily?: string;
  /**
   * Fixed width for a text box drawn by dragging (text items only).
   * When 0 or absent the text box auto-sizes to its content.
   */
  textBoxWidth?: number;
}

/** A single drawing surface (one "napkin"). */
export interface Sketch {
  /** Stable id within the book. */
  id: string;
  /** Display name / file-stem. */
  name: string;
  /** Surface width in pixels. */
  width: number;
  /** Surface height in pixels. */
  height: number;
  /** Background CSS color. */
  background: string;
  /** Ordered strokes (paint order = array order). */
  strokes: Stroke[];
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-modified timestamp. */
  updatedAt: string;
}

/** Top-level `.skbk` document. */
export interface SketchBook {
  /** File-format magic, always "napkin-sketch". */
  format: 'napkin-sketch';
  /** Schema version. */
  version: number;
  /** Book display name. */
  name: string;
  /** Pages in the book. */
  sketches: Sketch[];
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-modified timestamp. */
  updatedAt: string;
}

/** Current on-disk schema version. */
export const SKETCHBOOK_VERSION = 1;

/** Canonical sketch-book file extension (without the dot). */
export const SKETCHBOOK_EXTENSION = 'skbk';

/** Default surface dimensions for a fresh sketch. */
export const DEFAULT_SURFACE = { width: 1280, height: 800 } as const;

/** Default paper-like background color (warm off-white "napkin"). */
export const DEFAULT_BACKGROUND = '#fcfaf5';

/** Default font family used by text items. */
export const DEFAULT_FONT_FAMILY =
  '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

/** Returns true if a stroke is a text item. */
export function isTextStroke(stroke: Stroke): boolean {
  return stroke.tool === 'text' && typeof stroke.text === 'string';
}

/** Generates a short, collision-resistant id. */
export function createId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

/** Creates an empty sketch with sensible defaults. */
export function createSketch(name = 'unnamed'): Sketch {
  const now = new Date().toISOString();
  return {
    id: createId('sk'),
    name,
    width: DEFAULT_SURFACE.width,
    height: DEFAULT_SURFACE.height,
    background: DEFAULT_BACKGROUND,
    strokes: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Creates an empty sketch book containing a single blank sketch. */
export function createSketchBook(name = 'untitled', firstSketchName = 'unnamed'): SketchBook {
  const now = new Date().toISOString();
  return {
    format: 'napkin-sketch',
    version: SKETCHBOOK_VERSION,
    name,
    sketches: [createSketch(firstSketchName)],
    createdAt: now,
    updatedAt: now,
  };
}
