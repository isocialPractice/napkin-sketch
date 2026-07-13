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

/**
 * Tool used to lay down a stroke or interact with the canvas.
 *
 * The Sketch Support tools (`rect`, `ellipse`, `curve`, `bucket`, `fill`,
 * `eyedrop`) and the Direct Select tool (`point`) are UI-only: they never
 * persist on a stroke. Shape tools commit their outlines as `pen` strokes,
 * the bucket commits a filled `pen` shape, Fill Color recolors existing
 * strokes, Direct Select edits anchor points, and the eyedropper commits
 * nothing.
 */
export type Tool =
  | 'pen'
  | 'marker'
  | 'copic'
  | 'eraser'
  | 'select'
  | 'point'
  | 'text'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'curve'
  | 'bucket'
  | 'fill'
  | 'eyedrop';

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
  /**
   * True for group rows. A group holds no strokes of its own; child layers
   * reference it via `parent`, and its visibility/opacity/lock apply to every
   * descendant. Groups may nest (a group's `parent` can be another group).
   */
  group?: boolean;
  /** Id of the parent group layer. Absent = top level. */
  parent?: string;
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
  /**
   * Fill color (CSS) painted inside the stroke's closed outline before the
   * outline itself is drawn. Set by the paint bucket and Fill Shape features.
   */
  fill?: string;
  /**
   * Broad-nib rotation in degrees for Copic marker strokes (0 = horizontal,
   * increasing clockwise on screen). Only present when `tool === 'copic'`.
   */
  nibAngle?: number;
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

/**
 * Current on-disk schema version. Version 2 introduced the layer stack;
 * version 3 added layer groups (`group`/`parent`) and stroke fills (`fill`).
 */
export const SKETCHBOOK_VERSION = 3;

/** Canonical sketch-book file extension (without the dot). */
export const SKETCHBOOK_EXTENSION = 'skbk';

/** Default surface dimensions for a fresh sketch. */
export const DEFAULT_SURFACE = { width: 1280, height: 800 } as const;

/** Default paper-like background color (warm off-white "napkin"). */
export const DEFAULT_BACKGROUND = '#fcfaf5';

/** Default font family used by text items. */
export const DEFAULT_FONT_FAMILY =
  '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

/** Default Copic broad-nib rotation in degrees. */
export const DEFAULT_NIB_ANGLE = 45;

/**
 * Default rendering opacity for strokes that carry no explicit opacity.
 * Markers are translucent so overlapping passes layer like real ink; the
 * Copic marker mimics alcohol ink, which builds a little more per pass.
 */
export function defaultOpacityFor(tool: Tool): number {
  if (tool === 'marker') return 0.38;
  if (tool === 'copic') return 0.5;
  return 1;
}

/**
 * True when a drawing stroke's outline forms a closed (or nearly closed)
 * shape: at least a triangle, with the endpoint gap small relative to the
 * perimeter. Used by the paint bucket, Fill Shape, and fill rendering.
 */
export function isClosedStroke(stroke: Stroke): boolean {
  if (stroke.tool === 'eraser' || isTextStroke(stroke) || isImageStroke(stroke)) return false;
  const pts = stroke.points;
  if (pts.length < 3) return false;
  let perimeter = 0;
  for (let i = 1; i < pts.length; i++) {
    perimeter += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const gap = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return perimeter > 0 && gap <= Math.max(20, perimeter * 0.15);
}

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

/** Creates a new (empty) layer group. */
export function createGroupLayer(name = 'Group 1'): Layer {
  return { ...createLayer(name), id: createId('gp'), group: true };
}

/**
 * Resolves a layer's effective visibility, opacity, and lock state by
 * combining it with every ancestor group (nested groups multiply opacity;
 * any hidden ancestor hides, any locked ancestor locks). Cycle-safe.
 */
export function effectiveLayer(
  sketch: Sketch,
  layer: Layer,
): { visible: boolean; opacity: number; locked: boolean } {
  let visible = layer.visible;
  let opacity = layer.opacity;
  let locked = layer.locked;
  const seen = new Set<string>([layer.id]);
  let parent = layer.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const p = sketch.layers.find((l) => l.id === parent);
    if (!p) break;
    visible = visible && p.visible;
    opacity *= p.opacity;
    locked = locked || p.locked;
    parent = p.parent;
  }
  return { visible, opacity, locked };
}

/** Ids of a group's descendants (children, grandchildren, …), cycle-safe. */
export function descendantLayerIds(sketch: Sketch, groupId: string): Set<string> {
  const ids = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const layer of sketch.layers) {
      if (ids.has(layer.id) || !layer.parent) continue;
      if (layer.parent === groupId || ids.has(layer.parent)) {
        ids.add(layer.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Resolves the layer a stroke paints on. Strokes without a valid layer id
 * fall back to the sketch's first (bottom) non-group layer.
 */
export function layerOf(sketch: Sketch, stroke: Stroke): Layer {
  return (
    sketch.layers.find((l) => l.id === stroke.layer && !l.group) ??
    sketch.layers.find((l) => !l.group) ??
    sketch.layers[0]
  );
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
