/**
 * Shared data model for napkin-sketch.
 *
 * A SketchBook (`.skbk` file) is a JSON document holding one or more Sketches.
 * Each Sketch has a stack of Layers and a list of Strokes; each Stroke is a
 * list of sampled Points and belongs to one layer (via its `layer` id).
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
export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'text' | 'image';

/**
 * A single layer in a sketch's layer stack. Layers paint in array order
 * (index 0 is the bottom); each stroke references its layer by id.
 */
export interface Layer {
  /** Stable id within the sketch. */
  id: string;
  /** Display name shown in the layers panel. */
  name: string;
  /** Layer opacity (0-1) applied to the layer's composited content. */
  opacity: number;
  /** Hidden layers are skipped when rendering and exporting. */
  visible: boolean;
  /** Locked layers reject drawing, selection, and erasing. */
  locked: boolean;
}

/**
 * A continuous drawing stroke, a text item when `tool === 'text'`, or a
 * placed raster image when `tool === 'image'`.
 */
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
  /**
   * Explicit stroke opacity (0-1). When absent, the tool default is used
   * (1 for pen/text, 0.38 for marker). Set via the Quick Opacity feature.
   */
  opacity?: number;
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
  /**
   * Id of the layer this stroke belongs to. When absent the stroke paints on
   * the sketch's first (bottom) layer.
   */
  layer?: string;
  /** Image data URL (only present when `tool === 'image'`). */
  image?: string;
  /** Rendered image width in pixels (image items). `points[0]` is the top-left anchor. */
  imageWidth?: number;
  /** Rendered image height in pixels (image items). */
  imageHeight?: number;
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
  /** Layer stack, bottom first. Always holds at least one layer. */
  layers: Layer[];
  /** Ordered strokes (paint order = array order within each layer). */
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

/** Current on-disk schema version. Version 2 introduced the layer stack. */
export const SKETCHBOOK_VERSION = 2;

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

/** Returns true if a stroke is a placed raster image item. */
export function isImageStroke(stroke: Stroke): boolean {
  return stroke.tool === 'image' && typeof stroke.image === 'string';
}

/** Creates a new layer with sensible defaults. */
export function createLayer(name = 'Layer 1'): Layer {
  return { id: createId('ly'), name, opacity: 1, visible: true, locked: false };
}

/**
 * Resolves the layer a stroke paints on. Strokes without a valid layer id
 * fall back to the sketch's first (bottom) layer.
 */
export function layerOf(sketch: Sketch, stroke: Stroke): Layer {
  return sketch.layers.find((l) => l.id === stroke.layer) ?? sketch.layers[0];
}

/** Returns the strokes belonging to one layer, in paint order. */
export function strokesOnLayer(sketch: Sketch, layerId: string): Stroke[] {
  return sketch.strokes.filter((s) => layerOf(sketch, s).id === layerId);
}

/** Generates a short, collision-resistant id. */
export function createId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

/** Creates an empty sketch (with a single default layer) with sensible defaults. */
export function createSketch(name = 'unnamed'): Sketch {
  const now = new Date().toISOString();
  return {
    id: createId('sk'),
    name,
    width: DEFAULT_SURFACE.width,
    height: DEFAULT_SURFACE.height,
    background: DEFAULT_BACKGROUND,
    layers: [createLayer()],
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
