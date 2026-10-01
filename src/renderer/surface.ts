/**
 * Canvas rendering surface for a single sketch.
 *
 * Renders in stacked passes so layers and the eraser work correctly:
 *   1. A base pass with the napkin background + paper texture.
 *   2. Each sketch layer is drawn onto a transparent scratch canvas; the
 *      eraser cuts holes in that layer with `destination-out`, so it only
 *      erases its own layer's content. The scratch canvas is then composited
 *      onto the ink canvas with the layer's opacity, and finally the ink
 *      canvas onto the base pass.
 *
 * Also renders text items, placed images, an optional symmetry guide, and a
 * selection outline. Pure rendering - it holds no document state of its own.
 */

import {
  DEFAULT_FONT_FAMILY,
  dashPatternFor,
  defaultOpacityFor,
  effectiveLayers,
  isImageStroke,
  isTextStroke,
  layerOf,
  normalizedStops,
  strokesByLayer,
  type Gradient,
  type Layer,
  type Point,
  type Sketch,
  type Stroke,
} from '../core/types.js';
import { cssFilter, effectReach, readEffects, type Effect, type LinearTransform } from '../core/effects.js';
import { copicNibPolygons } from '../core/nib.js';
import { sketchToSvg, type SvgExportOptions } from '../core/sketch-svg.js';
import { strokeBounds } from '../core/bounds.js';
import { paintSteps, paintsAsPicture } from '../core/paint-order.js';
import { clipIndex, shownBounds, type ClipIndex } from '../core/clip.js';
import { pencilPicture, pencilRegion, pencilRgb, rasterizePencil, type PencilRegion } from '../core/pencil.js';
import { smudgeBuffer, type SmudgePass, type SmudgeState } from '../core/smudge.js';
import { boxReachesView, clampView, clampZoom, zoomLimits, type ZoomLimits } from './zoom.js';

export { strokeBounds, type SvgExportOptions };
import { activeProfile, profileInputOf, profilePieces } from '../core/stroke-profile.js';

/**
 * A live (in-progress) stroke being drawn by the user. One with the id of a
 * stored mark is that mark being drawn on, and paints instead of it.
 */
export interface LiveStroke extends Stroke {
  points: Point[];
}

/** The canvas as it showed over a box - its device pixels - kept for a wipe to sweep away. */
export interface WipeSnapshot {
  image: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far a wipe's band leans from upright, in degrees. */
const WIPE_TILT_DEG = 6;

/**
 * How long a zoom must hold still before Pencil marks are worked out again at
 * it, in milliseconds. Until then each is drawn from its picture at the last
 * scale, stretched, so a wheel zoom never waits on the grain.
 */
const PENCIL_SETTLE_MS = 160;

/** The most device pixels one Pencil picture holds; a bigger mark is worked out for the part in view. */
const PENCIL_PICTURE_MAX = 4_000_000;

/**
 * The most device pixels a smeared Pencil mark's picture holds. A smear
 * carries graphite from anywhere in the mark, so it is worked out whole;
 * past this, at a lower scale, drawn stretched - a deep zoom on a big
 * smeared mark goes soft rather than out of memory.
 */
const SMEARED_PICTURE_MAX = 6_000_000;

/**
 * A Pencil mark's picture (core/pencil.ts), kept while the mark and the
 * scale are as they were. A live stroke grows its picture where it grew.
 */
interface PencilPicture {
  /** The paint and shape the picture was made from, all but the points. */
  key: string;
  /** The points array it was made from, how many there were, and their checksum. */
  points: Point[];
  count: number;
  sum: number;
  region: PencilRegion;
  canvas: HTMLCanvasElement;
  /** The scale the picture stands for: its own, or the bigger one a capped smeared picture is stretched to. */
  meant: number;
}

/** What a render puts under the ink. */
/** What one render's walk over the layer stack reads, worked out once for the frame. */
interface LayerWalk {
  sketch: Sketch;
  byLayer: Map<string, Stroke[]>;
  effectiveOf: ReturnType<typeof effectiveLayers>;
  byId: Map<string, Layer>;
  /** Groups that paint as one picture: those with effects, and clip groups. */
  pictureGroups: Set<string>;
  /** The page's clips: the marks that paint nothing while they clip, and each clip group's region. */
  clips: ClipIndex;
  live: LiveStroke | null;
  liveLayerId: string | null;
  /** The Eraser at work - its stroke, or the Shape Eraser's region - and whose layers it cuts (see Overlay.liveErase). */
  liveErase: {
    stroke: LiveStroke | null;
    region: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> | null;
    targets: ReadonlySet<string> | null;
  } | null;
  /** Device pixels to one page pixel, for a filter's lengths. */
  device: LinearTransform;
  /**
   * How far past the view every picture with effects is painted this render,
   * in device pixels (see Surface.effectPad): one pad for them all, so a
   * blurred mark on a blurred layer in a blurred group paints no further out
   * than any one of them.
   */
  pad: number;
}

/**
 * A canvas being painted, and where the view's device origin sits on it:
 * `pad` device pixels in from its corner. The ink canvas is the view itself;
 * a picture with effects is painted `pad` past the view on every side, so a
 * blur at the view's edge gathers what is just outside it as well.
 */
interface Frame {
  ctx: CanvasRenderingContext2D;
  pad: number;
}

export interface RenderOptions {
  /**
   * Leave the paper unpainted - no background, no texture, no page outline -
   * so the ink lands on transparency. What a cropped export of a selection
   * wants, for the same reason a sprite frame does.
   */
  transparent?: boolean;
}

/** Extra, transient things to overlay on top of the sketch. */
export interface Overlay {
  /** Ids of currently selected strokes (drawn with a highlight outline). */
  selectedIds?: Set<string>;
  /**
   * Draw the outline around the selected strokes. Only an explicit `false`
   * leaves it off, so a caller that says nothing still gets the border.
   *
   * The selection is unchanged either way - this is only about what is drawn,
   * so that a drawing can be judged with something selected and no dashed box
   * around it.
   */
  showSelectionBorders?: boolean;
  /** When > 1, draws faint mirror axes for symmetry drawing. */
  symmetry?: number;
  /**
   * Opacity of the symmetry axes, 0-1 (default 1). Drives the fade in/out
   * when symmetry is switched on or off; 0 skips the guide entirely.
   */
  symmetryAlpha?: number;
  /** Dashed rectangle preview while dragging a new text box. */
  liveTextBox?: { x1: number; y1: number; x2: number; y2: number };
  /** Dashed rectangle preview while rubber-band selecting. */
  selectBox?: { x1: number; y1: number; x2: number; y2: number };
  /** Dashed straight-line preview (Space + drag) in sketch coordinates. */
  straightLine?: { a: Point; b: Point; color: string; width: number };
  /**
   * The Rotate tool's pivot marker while its dialog is open: the centre the
   * selection turns about, plus the ray out to the pointer while a rotate
   * drag is in hand. Both are in sketch coordinates.
   */
  rotate?: {
    center: Point;
    /** Where the pointer is during a drag, so the marker can show the lever. */
    ray?: Point;
    /** True while the centre itself is being dragged to a new place. */
    moving?: boolean;
  };
  /**
   * The Transform tool's box and its eight handles, in sketch coordinates,
   * plus the index of the handle the pointer is over so it can be lit. The
   * handles arrive already placed: where they sit is arithmetic the tool owns
   * and the surface only draws.
   */
  transform?: {
    box: { minX: number; minY: number; maxX: number; maxY: number };
    handles: { x: number; y: number }[];
    hover?: number;
  };
  /** Ring marking the endpoint the pointer will snap to (Shift held while drawing). */
  snapTarget?: Point;
  /**
   * The live stroke is the Eraser at work: it paints nowhere of its own, and
   * cuts every layer holding one of `targets` instead - or, with no targets,
   * every layer that can be drawn on - as the release will cut the marks.
   * With a `region` it is the Shape Eraser: that region's interior is what
   * cuts, and the live stroke is left alone.
   */
  liveErase?: { targets: ReadonlySet<string> | null; region?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> };
  /**
   * A Smear drag under way: its pass so far, and the Pencil marks it has
   * reached, which paint with the pass run over them (core/smudge.ts).
   */
  liveSmear?: { pass: SmudgePass; ids: ReadonlySet<string> };
  /** The Shape Eraser's shape being dragged out, drawn as an outline over the cut. */
  shapeOutline?: ReadonlyArray<{ x: number; y: number }>;
  /**
   * The Shape Stacker's pieces: the one under the pointer, shaded with a
   * light mesh, or the ones a press has marked, with its path or its box -
   * to merge, or, with `remove`, to take away. Each piece is its contours.
   */
  /** Where a Split click would cut: a small ring there, a constant size on the screen. */
  splitRing?: { x: number; y: number };
  /** The Liquify brush, at the pointer or where a drag has it: its ring, in page units, and a small cross at its centre. */
  liquifyBrush?: { x: number; y: number; radius: number };
  stack?: {
    hover?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
    marked?: ReadonlyArray<ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>>;
    path?: ReadonlyArray<{ x: number; y: number }>;
    box?: { minX: number; minY: number; maxX: number; maxY: number };
    remove: boolean;
  };
  /**
   * A wipe under way (the Wipe Stacks): the picture from before it, and how
   * far across the napkin is, 0 to 1. Drawn over everything else.
   */
  wipe?: { snapshot: WipeSnapshot; t: number };
  /**
   * The Vector Path tool's first anchor, while a press would close the path
   * there: `close-path-indicator.svg` is drawn on it, 20 screen pixels
   * across whatever the zoom.
   */
  closeIndicator?: { x: number; y: number };
  /**
   * Anchor-point overlay, shared by Direct Select and the Vector Path tool:
   * the anchor points, which of them are selected (drawn blue), tangent
   * handles (tip positions, with guide lines from the anchor they belong
   * to), and whether the whole path is selected (drawn blue).
   */
  anchors?: {
    points: Point[];
    selected?: number[];
    /** Handle tip positions (not indices — tips sit between anchors). */
    handles?: Point[];
    /** Index of the anchor the handle guide lines radiate from. */
    handleOrigin?: number;
    pathSelected?: boolean;
    /**
     * Curve to outline when the whole path is selected. Defaults to
     * `points`; Bézier-structured strokes pass their sampled curve here so
     * the outline bows with the path instead of cutting anchor to anchor.
     */
    outline?: Point[];
    /** Corner-rounding target icon position (Vector Path edit mode). */
    roundTarget?: Point;
  };
  /** Mesh Warp's hover outline, mesh and pins. */
  warp?: WarpOverlay;
}

/**
 * What Mesh Warp draws over the art: the art under the pointer, outlined in
 * green; the mesh as the pins hold it; and the pins themselves. Everything is
 * in sketch coordinates and drawn at a fixed size on screen.
 */
export interface WarpOverlay {
  /** Art to outline, 1 screen pixel wide in green: what a click would mesh. */
  outline?: Stroke[];
  /** The deformed mesh: its vertices (x then y), triangles and outline edges. */
  mesh?: { positions: Float64Array; triangles: Uint32Array; boundary: Uint32Array };
  /** Where the pins are now. */
  pins?: Point[];
  /** Which pins are selected. */
  selected?: number[];
}

/** Pan/zoom viewport applied to the drawn content (in CSS pixels / unitless zoom). */
export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

/** How far a selected mark's dashed box stands off its bounds, in screen pixels. */
export const SELECTION_BOX_PAD = 6;

/** The steps an effect picture's pad comes in, in device pixels, so zooming does not resize its canvas at every frame. */
const EFFECT_PAD_STEP = 64;

/** How magnified an image is, in screen pixels to one of its own, before it shows its pixels rather than smoothing them. */
const IMAGE_PIXELS_AT = 4;

/** The Vector Path close indicator, as the drawing window reaches it from `dist/renderer`, and its size in screen pixels. */
const CLOSE_INDICATOR_SRC = '../assets/close-path-indicator.svg';
const CLOSE_INDICATOR_PX = 20;

/** One selected mark's dashed box, as `Surface.selectionBoxes` reports it (sketch units). */
export interface SelectionBox {
  /** The mark the box is drawn around. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Surface {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ink: HTMLCanvasElement;
  private readonly inkCtx: CanvasRenderingContext2D;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  /** A mark with effects is painted here first, then laid down through them. */
  private effectCanvas: HTMLCanvasElement | null = null;
  /** A drawing layer with effects is painted here, past the view by the render's pad. */
  private effectScratch: HTMLCanvasElement | null = null;
  /** Each stroke's filled outline, while the stroke is unchanged (see outlinePath). */
  private readonly outlines = new WeakMap<Stroke, { points: Point[]; key: string; path: Path2D }>();
  /** Each Pencil mark's picture, while it and the scale are unchanged (see paintPencil). */
  private readonly pencils = new WeakMap<Stroke, PencilPicture>();
  /** The scale Pencil marks were last painted at, and when that changed. */
  private pencilScale = 0;
  private pencilScaleAt = 0;
  /** A repaint asked for once a zoom holds still. */
  private pencilTimer: ReturnType<typeof setTimeout> | null = null;
  /** How many Pencil pictures were worked out, whole or in part, since the surface was made: for the checks. */
  pencilRasters = 0;
  /** The Smear drag under way, for the render in progress (see Overlay.liveSmear). */
  private liveSmear: Overlay['liveSmear'] | null = null;
  /**
   * Each reached mark's picture with the drag's pass run over it so far: the
   * pass goes on from where it stopped as the drag grows, so a long smear
   * costs only its new steps. Dropped when the drag ends.
   */
  private readonly smearing = new Map<string, { key: string; region: PencilRegion; data: Uint8ClampedArray<ArrayBuffer>; state: SmudgeState; canvas: HTMLCanvasElement }>();
  /** The pad of the render under way (see LayerWalk.pad); 0 between renders. */
  private renderPad = 0;
  /** How far past the view the canvas a layer's marks are going onto reaches, in device pixels. */
  private framePad = 0;
  /** A group with effects paints its layers here, one canvas for each depth of nesting. */
  private readonly groupCanvases: HTMLCanvasElement[] = [];
  private dpr = 1;
  /** The Shape Stacker's mesh patterns, by colour and pixel ratio. */
  private readonly meshes = new Map<string, CanvasPattern>();
  private cssWidth = 0;
  private cssHeight = 0;

  // Pan/zoom viewport applied to drawn content (strokes, texture, overlays).
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  /** Decoded-image cache for image items, keyed by data URL. */
  private readonly imageCache = new Map<string, HTMLImageElement>();

  /** Called when a lazily-decoded image finishes loading (schedule a re-render). */
  onImageLoad: (() => void) | null = null;

  /** The Vector Path close indicator, loaded the first time it is drawn. */
  private closeIndicatorImage: HTMLImageElement | null = null;

  /**
   * Drops every decoded image the surface is holding.
   *
   * The cache is keyed by the image's full data URL and nothing ages out of
   * it, so without this it grows for the life of the window - across page
   * turns, across documents, and past the deletion of the mark that put an
   * image there. Each entry also pins its data URL string and, through the
   * load handler, the surface itself.
   *
   * Call it when the whole document is replaced, and when a surface built for
   * one render is finished with. Anything still on the page decodes again the
   * next time it is painted, which is what the lazy path already does.
   */
  clearImages(): void {
    for (const img of this.imageCache.values()) img.onload = null;
    this.imageCache.clear();
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');
    this.ctx = ctx;

    this.ink = document.createElement('canvas');
    const inkCtx = this.ink.getContext('2d', { alpha: true });
    if (!inkCtx) throw new Error('Offscreen 2D context is unavailable.');
    this.inkCtx = inkCtx;

    this.scratch = document.createElement('canvas');
    const scratchCtx = this.scratch.getContext('2d', { alpha: true });
    if (!scratchCtx) throw new Error('Offscreen 2D context is unavailable.');
    this.scratchCtx = scratchCtx;
  }

  /** Resizes the backing store to match the CSS size and device pixel ratio. */
  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const w = Math.round(cssWidth * this.dpr);
    const h = Math.round(cssHeight * this.dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ink.width = w;
    this.ink.height = h;
    this.scratch.width = w;
    this.scratch.height = h;
    // A canvas that shrank below its zoom zooms out about its middle.
    const held = clampView({ panX: this.panX, panY: this.panY, zoom: this.zoom }, this.getZoomLimits(), cssWidth / 2, cssHeight / 2);
    this.panX = held.panX;
    this.panY = held.panY;
    this.zoom = held.zoom;
  }

  /** Width of the drawable area in CSS pixels. */
  get width(): number {
    return this.cssWidth;
  }

  /** Height of the drawable area in CSS pixels. */
  get height(): number {
    return this.cssHeight;
  }

  /**
   * Average rendered color inside a circle around a canvas-local CSS point
   * (used by the eyedropper; the radius is its pixel sensitivity).
   */
  sampleAverageColor(cssX: number, cssY: number, radiusCss: number): string {
    const r = Math.max(1, Math.round(radiusCss * this.dpr));
    const cx = Math.round(cssX * this.dpr);
    const cy = Math.round(cssY * this.dpr);
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const w = Math.min(this.canvas.width, cx + r + 1) - x0;
    const h = Math.min(this.canvas.height, cy + r + 1) - y0;
    if (w <= 0 || h <= 0) return '#000000';
    const data = this.ctx.getImageData(x0, y0, w, h).data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const dx = x0 + xx - cx;
        const dy = y0 + yy - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const idx = (yy * w + xx) * 4;
        sr += data[idx];
        sg += data[idx + 1];
        sb += data[idx + 2];
        n++;
      }
    }
    if (n === 0) return '#000000';
    const hex = (v: number): string => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(sr)}${hex(sg)}${hex(sb)}`;
  }

  /** Converts a client (event) coordinate into sketch-space pixels (viewport-aware). */
  toSketchPoint(clientX: number, clientY: number, pressure: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top - this.panY) / this.zoom,
      pressure: pressure > 0 ? pressure : 0.5,
      t: performance.now(),
    };
  }

  // ---- Viewport (pan / zoom) ----------------------------------------------

  /** Returns a copy of the current pan/zoom viewport. */
  getViewport(): Viewport {
    return { panX: this.panX, panY: this.panY, zoom: this.zoom };
  }

  /** How far this canvas zooms: out to a fifth, in until one page pixel spans its shorter side. */
  getZoomLimits(): ZoomLimits {
    return zoomLimits(this.cssWidth, this.cssHeight);
  }

  /** Replaces the viewport, clamping zoom to the supported range. */
  setViewport(viewport: Viewport): void {
    this.zoom = clampZoom(viewport.zoom, this.getZoomLimits());
    this.panX = viewport.panX;
    this.panY = viewport.panY;
  }

  /** Resets pan to the origin and zoom to 1:1. */
  resetViewport(): void {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
  }

  /** Pans the viewport by a delta in CSS pixels. */
  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  /**
   * Multiplies the zoom by `factor`, keeping the canvas-local point
   * (`centerX`, `centerY`) fixed on screen (zoom toward the pinch centroid).
   */
  zoomAt(factor: number, centerX: number, centerY: number): void {
    const next = clampZoom(this.zoom * factor, this.getZoomLimits());
    if (next === this.zoom) return;
    // World point currently under the cursor must stay under the cursor.
    const worldX = (centerX - this.panX) / this.zoom;
    const worldY = (centerY - this.panY) / this.zoom;
    this.panX = centerX - worldX * next;
    this.panY = centerY - worldY * next;
    this.zoom = next;
  }

  /** Renders a full sketch plus an optional in-progress live stroke and overlay. */
  render(sketch: Sketch, live?: LiveStroke | null, overlay?: Overlay, options?: RenderOptions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    if (options?.transparent) {
      // A cropped export drops into somebody else's composition, so no paper,
      // no texture, and no page outline goes under the ink.
      ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    } else {
      this.paintBackground(sketch.background);
      this.paintPaperTexture();
      if (sketch.sizeMode === 'sized') this.paintPageBounds(sketch.width, sketch.height);
    }
    const symmetryAlpha = options?.transparent ? 0 : overlay?.symmetryAlpha ?? 1;
    if (overlay?.symmetry && overlay.symmetry > 1 && symmetryAlpha > 0) {
      this.paintSymmetryGuide(overlay.symmetry, symmetryAlpha);
    }
    ctx.restore();

    // Strokes go on the transparent ink canvas so the eraser reveals paper.
    // Each layer is drawn onto its own scratch pass first so erasers only cut
    // holes in their own layer, then composited with the layer's opacity. The
    // pan/zoom viewport is applied per pass so drawn content moves and scales
    // while the paper background and texture stay put (a stable canvas).
    const ink = this.inkCtx;
    ink.save();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, this.ink.width, this.ink.height);
    // One pass over the page, not one per layer: every mark commits to a
    // layer of its own, so rescanning the stroke list for each row made a
    // frame cost the square of the page's size.
    const scale = this.dpr * this.zoom;
    this.liveSmear = overlay?.liveSmear ?? null;
    if (!this.liveSmear) this.smearing.clear();
    const region = overlay?.liveErase?.region ?? null;
    const erasing = !region && overlay?.liveErase && live && live.tool === 'eraser' && live.points.length > 0 ? live : null;
    const walk: LayerWalk = {
      sketch,
      byLayer: strokesByLayer(sketch),
      effectiveOf: effectiveLayers(sketch),
      byId: new Map(sketch.layers.map((layer) => [layer.id, layer])),
      pictureGroups: new Set(sketch.layers.filter(paintsAsPicture).map((layer) => layer.id)),
      clips: clipIndex(sketch),
      live: erasing ? null : (live ?? null),
      liveLayerId: live && !erasing ? layerOf(sketch, live).id : null,
      liveErase:
        overlay?.liveErase && (erasing || region)
          ? { stroke: erasing, region, targets: overlay.liveErase.targets }
          : null,
      device: { a: scale, b: 0, c: 0, d: scale },
      pad: this.effectPad(sketch, scale),
    };
    this.renderPad = walk.pad;
    try {
      this.paintLayers({ ctx: ink, pad: 0 }, null, walk, 0);
    } finally {
      this.renderPad = 0;
      this.framePad = 0;
    }
    ink.restore();

    // Composite the ink layer onto the base layer at 1:1 device pixels.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.ink, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.applyWorld(ctx);

    if (overlay?.selectedIds && overlay.selectedIds.size > 0 && overlay.showSelectionBorders !== false) {
      for (const box of this.selectionBoxes(sketch, overlay.selectedIds)) this.paintSelection(ctx, box);
    }

    if (overlay?.liveTextBox) {
      this.paintDashedRect(ctx, overlay.liveTextBox, '#2f6feb', [5, 4]);
    }

    if (overlay?.selectBox) {
      this.paintDashedRect(ctx, overlay.selectBox, '#27496d', [6, 4]);
    }

    if (overlay?.straightLine) {
      this.paintStraightPreview(ctx, overlay.straightLine);
    }

    if (overlay?.snapTarget) {
      this.paintSnapTarget(ctx, overlay.snapTarget);
    }

    if (overlay?.transform) {
      this.paintTransformBox(ctx, overlay.transform);
    }

    if (overlay?.rotate) {
      this.paintRotateCenter(ctx, overlay.rotate);
    }

    if (overlay?.anchors) {
      this.paintAnchors(ctx, overlay.anchors);
    }

    if (overlay?.closeIndicator) {
      this.paintCloseIndicator(ctx, overlay.closeIndicator);
    }

    if (overlay?.shapeOutline && overlay.shapeOutline.length > 1) {
      // The Shape Eraser's shape, in the close indicator's blue, a constant
      // width on the screen.
      ctx.save();
      ctx.strokeStyle = '#20557b';
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      overlay.shapeOutline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    if (overlay?.warp) {
      this.paintWarpOverlay(ctx, overlay.warp);
    }

    if (overlay?.stack) {
      this.paintStack(ctx, overlay.stack);
    }

    if (overlay?.splitRing) {
      // Split's cut, in the close indicator's blue over a white halo.
      const { x, y } = overlay.splitRing;
      const r = 4.5 / this.zoom;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3.5 / this.zoom;
      ctx.stroke();
      ctx.strokeStyle = '#20557b';
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.stroke();
      ctx.restore();
    }

    if (overlay?.liquifyBrush) {
      // Liquify's brush, in the Split ring's blue over a white halo, as a
      // vector editor draws its warp brushes: the ring is what bends.
      const { x, y, radius } = overlay.liquifyBrush;
      const arm = 4 / this.zoom;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3 / this.zoom;
      ctx.stroke();
      ctx.strokeStyle = '#20557b';
      ctx.lineWidth = 1.25 / this.zoom;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    if (overlay?.wipe) this.paintWipe(overlay.wipe.snapshot, overlay.wipe.t, sketch.background);
  }

  /**
   * The Shape Stacker's pieces, as a vector editor's Shape Builder shades
   * them: the one under the pointer with a light tint and a fine mesh, those
   * a press has marked with a stronger one - blue to merge, red to take away
   * - each outlined, and the press's path or box over them. The mesh keeps
   * its size on the screen whatever the zoom.
   */
  private paintStack(ctx: CanvasRenderingContext2D, stack: NonNullable<Overlay['stack']>): void {
    const ink = stack.remove ? '179, 38, 30' : '32, 85, 123';
    const shade = (pieces: ReadonlyArray<ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>>, tint: number, mesh: number, edge: number): void => {
      if (pieces.length === 0) return;
      ctx.save();
      ctx.beginPath();
      for (const piece of pieces) {
        for (const ring of piece) {
          ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
        }
      }
      ctx.fillStyle = `rgba(${ink}, ${tint})`;
      ctx.fill('evenodd');
      ctx.strokeStyle = `rgba(${ink}, ${edge})`;
      ctx.lineWidth = 1 / this.zoom;
      ctx.stroke();
      ctx.clip('evenodd');
      // The mesh, in device pixels, over everything the pieces cover.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const pattern = this.meshPattern(`rgba(${ink}, ${mesh})`);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      ctx.restore();
    };
    if (stack.hover) shade([stack.hover], 0.1, 0.35, 0.6);
    if (stack.marked) shade(stack.marked, 0.2, 0.55, 0.85);
    ctx.save();
    ctx.strokeStyle = `rgb(${ink})`;
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (stack.path && stack.path.length > 1) {
      ctx.beginPath();
      stack.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    if (stack.box) {
      ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
      ctx.strokeRect(stack.box.minX, stack.box.minY, stack.box.maxX - stack.box.minX, stack.box.maxY - stack.box.minY);
    }
    ctx.restore();
  }

  /** The Shape Stacker's mesh in a colour: a diagonal lattice a few device pixels apart, made once. */
  private meshPattern(color: string): CanvasPattern | null {
    const key = color + '@' + this.dpr;
    const held = this.meshes.get(key);
    if (held) return held;
    const size = Math.max(6, Math.round(6 * this.dpr));
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const t = tile.getContext('2d');
    if (!t) return null;
    t.strokeStyle = color;
    t.lineWidth = Math.max(1, this.dpr * 0.75);
    t.beginPath();
    t.moveTo(0, size);
    t.lineTo(size, 0);
    t.moveTo(0, 0);
    t.lineTo(size, size);
    t.stroke();
    const pattern = this.ctx.createPattern(tile, 'repeat');
    if (pattern) this.meshes.set(key, pattern);
    return pattern;
  }

  /**
   * The canvas as it shows now over a page box and a margin round it, in
   * device pixels, clipped to the canvas - or null when none of the box is on
   * it. A copy, taken at once: the page may change the moment after.
   */
  snapshot(box: { minX: number; minY: number; maxX: number; maxY: number }, marginCss = 12): WipeSnapshot | null {
    const k = this.dpr;
    const x0 = Math.max(0, Math.floor((this.panX + box.minX * this.zoom - marginCss) * k));
    const y0 = Math.max(0, Math.floor((this.panY + box.minY * this.zoom - marginCss) * k));
    const x1 = Math.min(this.canvas.width, Math.ceil((this.panX + box.maxX * this.zoom + marginCss) * k));
    const y1 = Math.min(this.canvas.height, Math.ceil((this.panY + box.maxY * this.zoom + marginCss) * k));
    if (x1 <= x0 || y1 <= y0) return null;
    const image = document.createElement('canvas');
    image.width = x1 - x0;
    image.height = y1 - y0;
    const copy = image.getContext('2d');
    if (!copy) return null;
    copy.drawImage(this.canvas, x0, y0, image.width, image.height, 0, 0, image.width, image.height);
    return { image, x: x0, y: y0, w: image.width, h: image.height };
  }

  /**
   * A napkin wiping across the box of a wipe: a band of the paper's colour, a
   * third of the box wide and leaning a few degrees, with a soft shadow and a
   * few faint creases, eased from left to right as `t` goes from 0 to 1. The
   * picture from before the wipe shows ahead of it, and the result behind.
   */
  private paintWipe(snapshot: WipeSnapshot, t: number, paper: string): void {
    const ctx = this.ctx;
    const { image, x, y, w, h } = snapshot;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const band = Math.max(12 * this.dpr, w / 3);
    const lean = Math.tan((WIPE_TILT_DEG * Math.PI) / 180);
    const mid = y + h / 2;
    // From wholly left of the box to wholly past it, the lean included.
    const start = x - band - (h / 2) * lean;
    const left = start + (w + band + h * lean) * e;
    const at = (edge: number, yy: number): number => edge + (yy - mid) * lean;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    // Ahead of the band: the page as it was.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(at(left + band, y), y);
    ctx.lineTo(x + w + h, y);
    ctx.lineTo(x + w + h, y + h);
    ctx.lineTo(at(left + band, y + h), y + h);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, x, y);
    ctx.restore();
    // The napkin.
    ctx.beginPath();
    ctx.moveTo(at(left, y), y);
    ctx.lineTo(at(left + band, y), y);
    ctx.lineTo(at(left + band, y + h), y + h);
    ctx.lineTo(at(left, y + h), y + h);
    ctx.closePath();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 10 * this.dpr;
    ctx.shadowOffsetX = 2 * this.dpr;
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Its creases: faint and a little crooked, the same every frame.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
    ctx.lineWidth = this.dpr;
    for (const [across, bend] of [
      [0.28, 0.06],
      [0.55, -0.05],
      [0.8, 0.04],
    ]) {
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        const yy = y + (h * k) / 4;
        const xx = at(left + band * (across + (k % 2 === 0 ? 0 : bend)), yy);
        if (k === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Mesh Warp's overlay, drawn as the Puppet Warp it follows draws it: the
   * mesh in thin grey lines with its outline in green, the art under the
   * pointer outlined in green, and the pins - black with a white edge, a
   * selected one white with a black edge and a dot, and a dashed ring round a
   * pin selected on its own. Sizes are in screen pixels, whatever the zoom.
   */
  private paintWarpOverlay(ctx: CanvasRenderingContext2D, warp: WarpOverlay): void {
    const px = 1 / this.zoom;
    const green = '#2da44e';
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    if (warp.mesh) {
      const { positions: p, triangles: t, boundary: b } = warp.mesh;
      ctx.beginPath();
      for (let i = 0; i < t.length; i += 3) {
        ctx.moveTo(p[2 * t[i]], p[2 * t[i] + 1]);
        ctx.lineTo(p[2 * t[i + 1]], p[2 * t[i + 1] + 1]);
        ctx.lineTo(p[2 * t[i + 2]], p[2 * t[i + 2] + 1]);
        ctx.closePath();
      }
      ctx.strokeStyle = 'rgba(96, 102, 110, 0.45)';
      ctx.lineWidth = 0.5 * px;
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 2) {
        ctx.moveTo(p[2 * b[i]], p[2 * b[i] + 1]);
        ctx.lineTo(p[2 * b[i + 1]], p[2 * b[i + 1] + 1]);
      }
      ctx.strokeStyle = green;
      ctx.lineWidth = px;
      ctx.stroke();
    }
    if (warp.outline && warp.outline.length > 0) {
      ctx.strokeStyle = green;
      ctx.lineWidth = px;
      for (const stroke of warp.outline) {
        if (isTextStroke(stroke) || isImageStroke(stroke)) {
          const box = strokeBounds(stroke, (t) => this.measureText(t));
          if (box) ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
          continue;
        }
        ctx.beginPath();
        tracePoints(ctx, stroke.points);
        if (stroke.fill) ctx.closePath();
        ctx.stroke();
      }
    }
    const pins = warp.pins ?? [];
    const selected = new Set(warp.selected ?? []);
    pins.forEach((p, i) => {
      const on = selected.has(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5 * px, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#ffffff' : '#1f2328';
      ctx.fill();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = on ? '#1f2328' : '#ffffff';
      ctx.stroke();
      if (on) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 * px, 0, Math.PI * 2);
        ctx.fillStyle = '#1f2328';
        ctx.fill();
      }
    });
    if (selected.size === 1) {
      const p = pins[[...selected][0]];
      if (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14 * px, 0, Math.PI * 2);
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.lineWidth = px;
        ctx.strokeStyle = '#1f2328';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Paints strokes into a coverage mask for Mesh Warp: every mark at its real
   * width, fills and outlines alike, on transparency, `scale` mask pixels to
   * the sketch pixel from `origin`. Returns the RGBA pixels; their alpha is
   * the coverage.
   */
  paintMask(
    strokes: Stroke[],
    originX: number,
    originY: number,
    width: number,
    height: number,
    scale: number,
  ): Uint8ClampedArray {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return new Uint8ClampedArray(width * height * 4);
    ctx.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale);
    for (const stroke of strokes) this.paintStroke(ctx, stroke);
    return ctx.getImageData(0, 0, width, height).data;
  }

  /** Applies the pan/zoom viewport to a context already scaled by the DPR. */
  /**
   * Paints the layers under `scope` - the page when it is null - onto
   * `target`, bottom first. Groups paint nothing of their own; their opacity
   * multiplies into what they hold. A group with effects is the exception: it
   * paints what it holds on a canvas of its own and lays that down through
   * its effects as one picture, as the exports draw it.
   */
  private paintLayers(target: Frame, scope: Layer | null, walk: LayerWalk, depth: number): void {
    // The steps the hit test walks too (core/paint-order.ts), so what a click
    // picks is what is on top here.
    for (const step of paintSteps(walk.sketch, scope, walk, (layer) => this.layerPaints(layer, walk))) {
      if (step.kind === 'group') this.paintGroupPicture(target, step.group, scope, walk, depth);
      else this.paintLeaf(target, step.layer, this.opacityBetween(step.layer, scope, walk), walk);
    }
  }

  private layerPaints(layer: Layer, walk: LayerWalk): boolean {
    return walk.effectiveOf.get(layer.id)?.visible === true;
  }

  /**
   * One drawing layer: its marks on a scratch canvas, laid down at `opacity`
   * through its own effects. A layer with effects is painted past the view
   * by their reach, and not at all when nothing it paints reaches the view:
   * its blur is worked over the whole picture, which deep in costs as much
   * off the screen as on it.
   */
  private paintLeaf(target: Frame, layer: Layer, opacity: number, walk: LayerWalk): void {
    const live = walk.live;
    const stored = walk.byLayer.get(layer.id) ?? [];
    // A live stroke that carries a stored mark's id is that mark being drawn
    // on (a Shift-click line): it paints in the mark's place, not over it. A
    // clip mark paints nothing while it clips.
    const unclipped = walk.clips.any ? stored.filter((s) => !walk.clips.marks.has(s.id)) : stored;
    const strokes = live ? unclipped.filter((s) => s.id !== live.id) : unclipped;
    const liveHere = live && live.points.length > 0 && walk.liveLayerId === layer.id ? live : null;
    if (strokes.length === 0 && !liveHere) return;

    const effects = readEffects(layer.effects);
    let marks = liveHere ? [...strokes, liveHere] : strokes;
    // The Eraser at work cuts this layer when it holds a mark the release
    // will cut: painted over the layer's marks, it takes away what it covers
    // - its swath, or the Shape Eraser's shape, filled.
    const erase = walk.liveErase && this.eraseCuts(layer, strokes, walk.liveErase.targets, walk) ? walk.liveErase : null;
    if (erase?.stroke) marks = [...marks, erase.stroke];
    if (effects && !this.marksReachView(marks, effectReach(effects), walk)) return;
    // A layer with effects is painted past the view, and so is any layer
    // going into a picture that is: a group's blur gathers from its margin.
    const pad = effects ? walk.pad : target.pad;
    const canvas = pad === 0 ? this.scratch : (this.effectScratch = this.paddedCanvas(this.effectScratch, pad));
    const scratch = pad === 0 ? this.scratchCtx : canvas.getContext('2d');
    if (!scratch) return;
    scratch.save();
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.clearRect(0, 0, canvas.width, canvas.height);
    scratch.translate(pad, pad);
    scratch.scale(this.dpr, this.dpr);
    this.applyWorld(scratch);
    const framePad = this.framePad;
    this.framePad = pad;
    try {
      for (const stroke of marks) this.paintStroke(scratch, stroke);
      if (erase?.region) this.cutRegion(scratch, erase.region);
    } finally {
      this.framePad = framePad;
      scratch.restore();
    }

    this.layDown(target, { ctx: scratch, pad }, opacity, effects, walk.device);
  }

  /** Takes a region's interior out of what a layer's pass has painted so far: the Shape Eraser's cut, before the release makes it. */
  private cutRegion(ctx: CanvasRenderingContext2D, region: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): void {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const ring of region) {
      ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fill('nonzero');
    ctx.restore();
  }

  /**
   * Whether the Eraser at work cuts a layer: it holds one of the targets, or,
   * with none, it can be drawn on - visible and unlocked, groups and all -
   * and holds a mark an eraser can cut.
   */
  private eraseCuts(layer: Layer, strokes: readonly Stroke[], targets: ReadonlySet<string> | null, walk: LayerWalk): boolean {
    if (targets) return strokes.some((s) => targets.has(s.id));
    const effective = walk.effectiveOf.get(layer.id);
    if (!effective || !effective.visible || effective.locked) return false;
    return strokes.some((s) => s.tool !== 'eraser' && !isTextStroke(s) && !isImageStroke(s));
  }

  /**
   * A group painting as one picture: what it holds, on a canvas of its own -
   * past the view by its effects' reach - cut to its clip's interior when it
   * is a clip group (the inverse of the Shape Eraser's cut, and before the
   * effects, so a shadow falls under what shows), and laid down through its
   * effects.
   */
  private paintGroupPicture(target: Frame, group: Layer, scope: Layer | null, walk: LayerWalk, depth: number): void {
    const effects = readEffects(group.effects);
    if (effects && !this.contentReachesView(group, effectReach(effects), walk)) return;
    const pad = effects ? walk.pad : target.pad;
    const canvas = this.groupCanvas(depth, pad);
    const gctx = canvas.getContext('2d');
    if (!gctx) return;
    const frame = { ctx: gctx, pad };
    this.paintLayers(frame, group, walk, depth + 1);
    // A clip naming no closed mark in the group clips nothing.
    const clip = walk.clips.byGroup.get(group.id);
    if (clip) this.keepRegion(frame, clip.region);
    this.layDown(target, frame, this.opacityBetween(group, scope, walk), effects, walk.device);
  }

  /** Keeps only a region's interior of what a picture's canvas holds: a clip group's clip. */
  private keepRegion(frame: Frame, region: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): void {
    const ctx = frame.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(frame.pad, frame.pad);
    ctx.scale(this.dpr, this.dpr);
    this.applyWorld(ctx);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const ring of region) {
      ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fill('nonzero');
    ctx.restore();
  }

  /**
   * Lays a picture painted on its own canvas onto `target` at `opacity`,
   * through `effects` when it has any. The two frames' pads line their views
   * up; a blur is held to a third of the picture's pad, so all it gathers
   * was painted.
   */
  private layDown(
    target: Frame,
    picture: Frame,
    opacity: number,
    effects: Effect[] | undefined,
    device: LinearTransform,
  ): void {
    const ctx = target.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    if (effects) ctx.filter = cssFilter(effects, device, blurCap(picture.pad));
    ctx.drawImage(picture.ctx.canvas, target.pad - picture.pad, target.pad - picture.pad);
    ctx.restore();
  }

  /** A cleared canvas for a group's picture at a depth of nesting, the view's size plus `pad` on every side. */
  private groupCanvas(depth: number, pad: number): HTMLCanvasElement {
    const canvas = this.paddedCanvas(this.groupCanvases[depth] ?? null, pad);
    this.groupCanvases[depth] = canvas;
    return canvas;
  }

  /**
   * `canvas`, or a new one, sized to the view plus `pad` device pixels on
   * every side and cleared. A canvas already that size is only cleared:
   * resizing one is what costs, so the pads come in steps (see effectPad).
   */
  private paddedCanvas(canvas: HTMLCanvasElement | null, pad: number): HTMLCanvasElement {
    const out = canvas ?? document.createElement('canvas');
    const w = this.ink.width + pad * 2;
    const h = this.ink.height + pad * 2;
    if (out.width !== w || out.height !== h) {
      out.width = w;
      out.height = h;
    } else {
      out.getContext('2d')?.clearRect(0, 0, w, h);
    }
    return out;
  }

  /**
   * How far past the view this render paints every picture with effects, in
   * device pixels: the farthest any effect on the page reaches at `scale`,
   * in steps of {@link EFFECT_PAD_STEP} so zooming does not resize a canvas
   * at every frame, and at most half the view's diagonal. Past that, deep in,
   * a blur already wider than the view is held to a third of the pad (see
   * blurCap), which inside a shape looks the same and saves painting a canvas
   * many times the view's size. 0 on a page with no blur and no shadow.
   */
  private effectPad(sketch: Sketch, scale: number): number {
    let reach = 0;
    for (const layer of sketch.layers) {
      const effects = readEffects(layer.effects);
      if (effects) reach = Math.max(reach, effectReach(effects));
    }
    for (const stroke of sketch.strokes) {
      if (!stroke.effects || stroke.tool === 'eraser') continue;
      const effects = readEffects(stroke.effects);
      if (effects) reach = Math.max(reach, effectReach(effects));
    }
    const px = reach * scale;
    if (!(px > 0)) return 0;
    const cap = Math.ceil(Math.hypot(this.ink.width, this.ink.height) / 2);
    return Math.min(cap, Math.ceil(px / EFFECT_PAD_STEP) * EFFECT_PAD_STEP);
  }

  /**
   * Whether anything these marks paint, their own effects included and then
   * `reach` page units more, lands in the view. Each mark on its own: two
   * marks either side of the view reach it no more than one does.
   */
  private marksReachView(strokes: readonly Stroke[], reach: number, walk: LayerWalk): boolean {
    const scale = walk.device.a;
    const transform = { a: scale, b: 0, c: 0, d: scale, e: this.panX * this.dpr, f: this.panY * this.dpr };
    for (const stroke of strokes) {
      const box = strokeBounds(stroke, (s) => this.measureText(s));
      if (!box) continue;
      const effects = stroke.tool === 'eraser' ? undefined : readEffects(stroke.effects);
      const own = inkMargin(stroke) + (effects ? effectReach(effects) : 0);
      if (boxReachesView(box, own + reach, transform, this.ink.width, this.ink.height)) return true;
    }
    return false;
  }

  /** Whether anything a group holds reaches the view, with `reach` page units of the effects around it more. */
  private contentReachesView(scope: Layer, reach: number, walk: LayerWalk): boolean {
    for (const step of paintSteps(walk.sketch, scope, walk, (layer) => this.layerPaints(layer, walk))) {
      if (step.kind === 'group') {
        const effects = readEffects(step.group.effects);
        if (this.contentReachesView(step.group, reach + (effects ? effectReach(effects) : 0), walk)) return true;
        continue;
      }
      const strokes = walk.byLayer.get(step.layer.id) ?? [];
      const marks = walk.live && walk.liveLayerId === step.layer.id ? [...strokes, walk.live] : strokes;
      const effects = readEffects(step.layer.effects);
      if (this.marksReachView(marks, reach + (effects ? effectReach(effects) : 0), walk)) return true;
    }
    return false;
  }

  /** The opacity of `layer` and of every group above it, up to `scope` and not counting it. */
  private opacityBetween(layer: Layer, scope: Layer | null, walk: LayerWalk): number {
    let opacity = 1;
    const seen = new Set<string>();
    for (let at: Layer | undefined = layer; at && !seen.has(at.id); at = at.parent ? walk.byId.get(at.parent) : undefined) {
      if (scope && at.id === scope.id) break;
      seen.add(at.id);
      opacity *= at.opacity;
    }
    return opacity;
  }

  private applyWorld(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
  }

  /**
   * The paper, over every pixel of the backing store. That is the CSS size
   * times the device pixel ratio rounded, which can be half a pixel more than
   * the CSS size covers: filled at the CSS size, a canvas 617.67 pixels tall
   * at 1.5 left its last row half painted over the opaque black under it, a
   * grey line along the bottom that any shadow reaching it darkened.
   */
  private paintBackground(color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
  }

  /**
   * Dashed outline marking a sized page's bounds, drawn in world space so it
   * pans and zooms with the drawing.
   */
  private paintPageBounds(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    this.applyWorld(ctx);
    ctx.strokeStyle = 'rgba(31, 35, 40, 0.35)';
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
    ctx.strokeRect(0, 0, width, height);
    ctx.restore();
  }

  /** Faint dot grid that gives the surface a tactile, napkin-like quality. */
  private paintPaperTexture(): void {
    const ctx = this.ctx;
    const gap = 26;
    ctx.save();
    ctx.fillStyle = 'rgba(31, 35, 40, 0.05)';
    for (let y = gap; y < this.cssHeight; y += gap) {
      for (let x = gap; x < this.cssWidth; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Draws faint mirror axes used by symmetry ("surprise") mode. */
  private paintSymmetryGuide(axes: number, alpha = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(39, 73, 109, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    const reach = Math.hypot(this.cssWidth, this.cssHeight);
    for (let i = 0; i < axes; i++) {
      const angle = (Math.PI * i) / axes;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(angle) * reach, cy - Math.sin(angle) * reach);
      ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintDashedRect(
    ctx: CanvasRenderingContext2D,
    box: { x1: number; y1: number; x2: number; y2: number },
    color: string,
    dash: number[],
  ): void {
    // In screen pixels, whatever the zoom: a rubber band or a text box's
    // outline is the pointer's, not the drawing's.
    const px = 1 / this.zoom;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash(dash.map((d) => d * px));
    const x = Math.min(box.x1, box.x2);
    const y = Math.min(box.y1, box.y2);
    const w = Math.abs(box.x2 - box.x1);
    const h = Math.abs(box.y2 - box.y1);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  /** Draws the dashed preview of a pending straight line (Space + drag). */
  private paintStraightPreview(
    ctx: CanvasRenderingContext2D,
    line: { a: Point; b: Point; color: string; width: number },
  ): void {
    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, line.width);
    ctx.lineCap = 'round';
    ctx.setLineDash([8 / this.zoom, 6 / this.zoom]);
    ctx.beginPath();
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Draws a small ring marking the endpoint the pointer will snap to. */
  private paintSnapTarget(ctx: CanvasRenderingContext2D, pt: Point): void {
    ctx.save();
    // Divide by zoom so the ring keeps a constant on-screen size.
    ctx.strokeStyle = '#2f6feb';
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6 / this.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The close indicator on a Vector Path's first anchor: the asset, 20
   * screen pixels across, loaded the first time it is wanted. Until it has
   * decoded - or if it never does - a ring in its colour stands in.
   */
  private paintCloseIndicator(ctx: CanvasRenderingContext2D, at: { x: number; y: number }): void {
    let img = this.closeIndicatorImage;
    if (!img && typeof Image !== 'undefined') {
      img = this.closeIndicatorImage = new Image();
      img.onload = () => this.onImageLoad?.();
      img.src = CLOSE_INDICATOR_SRC;
    }
    const size = CLOSE_INDICATOR_PX / this.zoom;
    ctx.save();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, at.x - size / 2, at.y - size / 2, size, size);
    } else {
      ctx.strokeStyle = '#20557b';
      ctx.lineWidth = 2.5 / this.zoom;
      ctx.beginPath();
      ctx.arc(at.x, at.y, size * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Whether the close indicator's image has decoded (for the GUI checks). */
  closeIndicatorReady(): boolean {
    const img = this.closeIndicatorImage;
    return !!img && img.complete && img.naturalWidth > 0;
  }

  /**
   * Draws the Rotate tool's pivot: a crosshair inside a ring, at a constant
   * on-screen size whatever the zoom, so it stays a target that can be
   * grabbed and dragged rather than something that shrinks with the page.
   *
   * The shape is the one the Move palette's own cursor uses - four arms
   * around a hollow centre - because it means the same thing here: a point
   * that can be picked up and put somewhere else. While a rotate drag is in
   * hand a dashed lever runs out to the pointer, which is what shows how far
   * round the gesture has carried and which way it went.
   */
  private paintRotateCenter(
    ctx: CanvasRenderingContext2D,
    rotate: { center: Point; ray?: Point; moving?: boolean },
  ): void {
    const { center, ray, moving } = rotate;
    const px = 1 / this.zoom;
    ctx.save();

    if (ray) {
      ctx.strokeStyle = 'rgba(47, 111, 235, 0.75)';
      ctx.lineWidth = 1.25 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(ray.x, ray.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const arm = 13 * px;
    const gap = 5.5 * px;
    ctx.strokeStyle = moving ? '#2f6feb' : '#20557b';
    ctx.lineWidth = 1.8 * px;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      ctx.moveTo(center.x + dx * gap, center.y + dy * gap);
      ctx.lineTo(center.x + dx * arm, center.y + dy * arm);
    }
    ctx.stroke();

    // A filled disc under the ring keeps the pivot readable over dark ink.
    ctx.beginPath();
    ctx.arc(center.x, center.y, gap - 0.5 * px, 0, Math.PI * 2);
    ctx.fillStyle = moving ? 'rgba(47, 111, 235, 0.25)' : 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws the Transform box: a solid outline with a square on each corner and
   * the middle of each side.
   *
   * Solid rather than dashed, which is what the selection border already is -
   * two dashed rectangles around the same marks would read as one confused
   * one. The squares are drawn at a constant on-screen size for the same
   * reason the rotate pivot is: they are things to grab, and a handle that
   * shrinks with the page stops being grabbable exactly when the drawing gets
   * detailed enough to need it.
   */
  private paintTransformBox(
    ctx: CanvasRenderingContext2D,
    transform: {
      box: { minX: number; minY: number; maxX: number; maxY: number };
      handles: { x: number; y: number }[];
      hover?: number;
    },
  ): void {
    const { box, handles, hover } = transform;
    const px = 1 / this.zoom;
    const half = 4 * px;
    ctx.save();
    ctx.strokeStyle = 'rgba(47, 111, 235, 0.9)';
    ctx.lineWidth = 1.25 * px;
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);

    ctx.lineWidth = 1.25 * px;
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      ctx.fillStyle = i === hover ? '#2f6feb' : 'rgba(255, 255, 255, 0.95)';
      ctx.strokeStyle = '#2f6feb';
      ctx.beginPath();
      ctx.rect(h.x - half, h.y - half, half * 2, half * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Draws anchor squares and tangent handles at a constant on-screen size. */
  private paintAnchors(
    ctx: CanvasRenderingContext2D,
    anchors: {
      points: Point[];
      selected?: number[];
      handles?: Point[];
      handleOrigin?: number;
      pathSelected?: boolean;
      outline?: Point[];
      roundTarget?: Point;
    },
  ): void {
    const pts = anchors.points;
    if (pts.length === 0) return;
    const blue = '#2f6feb';
    const half = 3 / this.zoom;
    const selected = new Set(anchors.selected ?? []);
    ctx.save();
    ctx.lineWidth = 1 / this.zoom;

    // A selected path draws its outline in blue so the whole stroke reads as
    // picked and movable.
    if (anchors.pathSelected) {
      const outline = anchors.outline ?? pts;
      ctx.strokeStyle = blue;
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.beginPath();
      outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.lineWidth = 1 / this.zoom;
    }

    // Tangent handles: a thin guide line from the owning anchor out to each
    // tip, with a hollow circle at the tip itself.
    const origin =
      anchors.handleOrigin !== undefined ? pts[anchors.handleOrigin] : undefined;
    if (origin && anchors.handles && anchors.handles.length > 0) {
      ctx.strokeStyle = blue;
      for (const tip of anchors.handles) {
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, half * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Anchors: blue when selected, white otherwise.
    ctx.strokeStyle = blue;
    pts.forEach((p, i) => {
      ctx.fillStyle = selected.has(i) ? blue : '#ffffff';
      ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
    });

    // Corner-rounding target: concentric rings with a centre dot, sitting
    // inside the corner's wedge — drag it to round the corner.
    if (anchors.roundTarget) {
      const t = anchors.roundTarget;
      ctx.strokeStyle = blue;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(t.x, t.y, half * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(t.x, t.y, half * 1.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = blue;
      ctx.beginPath();
      ctx.arc(t.x, t.y, half * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Paints a mark; `bare` paints it without its effects, as `paintWithEffects` does first. */
  private paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, bare = false): void {
    const effects = bare || stroke.tool === 'eraser' ? undefined : readEffects(stroke.effects);
    if (effects) {
      this.paintWithEffects(ctx, stroke, effects);
      return;
    }
    if (isTextStroke(stroke)) {
      this.paintText(ctx, stroke);
      return;
    }
    if (isImageStroke(stroke)) {
      this.paintImage(ctx, stroke);
      return;
    }

    const pts = stroke.points;
    if (pts.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      // Cut holes in the transparent ink layer to reveal the paper below.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      // Explicit opacity (Quick Opacity) overrides the per-tool default.
      ctx.globalAlpha = stroke.opacity ?? defaultOpacityFor(stroke.tool);
    }

    // Filled shape (paint bucket / Fill Shape / properties panel): paint the
    // closed interior first so the outline still reads on top of the fill.
    const fillPaint = stroke.tool === 'eraser' ? null : fillPaintFor(ctx, stroke);
    if (fillPaint && pts.length > 2) {
      ctx.save();
      ctx.fillStyle = fillPaint;
      ctx.beginPath();
      // A compound shape's contours are separate subpaths, so the winding
      // rule cuts its holes out instead of filling across them.
      tracePoints(ctx, pts);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // An outline switched off in the properties panel leaves the fill alone.
    if (stroke.noStroke) {
      ctx.restore();
      return;
    }

    // Copic marker: a flat chisel nib stamped along the path.
    if (stroke.tool === 'copic') {
      this.paintCopicNib(ctx, stroke);
      ctx.restore();
      return;
    }

    // Pencil: the lead through the paper's tooth.
    if (stroke.tool === 'pencil') {
      this.paintPencil(ctx, stroke);
      ctx.restore();
      return;
    }

    // A stroke profile runs the width along the length, which no canvas line
    // can: the stroke paints as the shape it is, its pieces merged by one
    // non-zero fill so translucent ink lays down flat. Dashes are cut from
    // the profiled outline, so this goes before the dash branch below.
    if (pts.length > 1 && activeProfile(stroke)) {
      ctx.fill(this.outlinePath(stroke), 'nonzero');
      ctx.restore();
      return;
    }

    // Dashed and dotted outlines paint as one continuous path at a uniform
    // width: the per-segment pressure taper below restarts the dash pattern
    // at every sample, which would render as a solid line.
    const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
    if (dash.length > 0 && pts.length > 1) {
      ctx.setLineDash(dash);
      ctx.lineWidth = Math.max(0.5, stroke.width);
      ctx.beginPath();
      tracePoints(ctx, pts);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // A single point: render a dot sized by pressure / width.
    if (pts.length === 1) {
      const p = pts[0];
      const r = (stroke.width * (0.4 + 0.6 * (p.pressure ?? 0.5))) / 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // A plain line, painted as one mark so translucent ink lays down flat.
    // It used to be stroked a segment at a time, each segment with its own
    // round ends at the stroke's opacity, so wherever two met the ends
    // overlapped and darkened: a string of beads, one to a sample. A line
    // whose width never changes - a marker, an eraser, anything drawn with a
    // mouse, whose pressure is the same all along - is one path, which the
    // canvas strokes once. A stylus line that swells and tapers is the uniform
    // profile's outline (stroke-profile.ts), filled once, as a profiled
    // stroke is: the same widths the segments had, sample by sample.
    const uniform = stroke.tool === 'marker' || stroke.tool === 'eraser';
    const scale = (p: Point): number => (uniform ? 1 : 0.4 + 0.6 * (p.pressure ?? 0.5));
    const first = scale(pts[0]);
    if (pts.every((p) => Math.abs(scale(p) - first) < 1e-3)) {
      ctx.lineWidth = Math.max(0.5, stroke.width * first);
      ctx.beginPath();
      tracePoints(ctx, pts);
      ctx.stroke();
    } else {
      ctx.fill(this.outlinePath(stroke), 'nonzero');
    }

    ctx.restore();
  }

  /**
   * A stroke's filled outline as the canvas paints it (`profilePieces`),
   * built once and kept while the stroke is as it was: the same points - the
   * store moves a stroke by moving its points in place, so their values are
   * checked as well as the array - width, profile, closure and dash. The
   * live stroke, whose points grow at every move, is built afresh each time.
   */
  private outlinePath(stroke: Stroke): Path2D {
    const pts = stroke.points;
    const key = `${pts.length}|${stroke.width}|${stroke.profile ?? ''}|${stroke.profileMirrored === true}|${stroke.vector?.closed === true}|${stroke.strokeStyle ?? ''}|${stroke.tool}|${pointsChecksum(pts)}`;
    const kept = this.outlines.get(stroke);
    if (kept && kept.points === pts && kept.key === key) return kept.path;
    const path = new Path2D();
    for (const piece of profilePieces(profileInputOf(stroke))) {
      piece.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
      path.closePath();
    }
    this.outlines.set(stroke, { points: pts, key, path });
    return path;
  }

  /**
   * Fills a Copic broad-nib stroke. All nib footprints go into one path with
   * a single fill so the translucent ink never double-darkens where segments
   * overlap - matching how one pass of a real marker lays down flat color.
   */
  /**
   * Paints a mark that carries effects: the mark itself on a canvas of its
   * own, then that picture laid down through its effects, so they work on
   * the whole mark - its fill and its outline as one - as the exports do.
   */
  private paintWithEffects(ctx: CanvasRenderingContext2D, stroke: Stroke, effects: Effect[]): void {
    const transform = ctx.getTransform();
    // Nothing it paints reaches the canvas: its blur would be worked for nothing.
    const box = strokeBounds(stroke, (s) => this.measureText(s));
    if (!box || !boxReachesView(box, inkMargin(stroke) + effectReach(effects), transform, ctx.canvas.width, ctx.canvas.height)) return;
    // Painted past the view by the render's pad, as a layer's are (see
    // paintLeaf), so a blur at the view's edge gathers what lies beyond it.
    // A layer's canvas that is already that far out needs no more.
    const pad = Math.max(0, this.renderPad - this.framePad);
    const canvas = this.effectCanvas ?? document.createElement('canvas');
    this.effectCanvas = canvas;
    const w = ctx.canvas.width + pad * 2;
    const h = ctx.canvas.height + pad * 2;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const fx = canvas.getContext('2d');
    if (!fx) return;
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, canvas.width, canvas.height);
    fx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e + pad, transform.f + pad);
    // The mark itself, not a copy: what it keeps for itself (a Pencil mark's picture) is found again.
    this.paintStroke(fx, stroke, true);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = cssFilter(effects, transform, blurCap(Math.max(this.renderPad, this.framePad)));
    ctx.drawImage(canvas, -pad, -pad);
    ctx.restore();
  }

  /**
   * Paints a Pencil mark: its picture through the paper's tooth
   * (`rasterizePencil`), on the page's own pixel grid at this scale, laid
   * down at the mark's opacity. The picture is kept per mark and worked out
   * again only when the mark, its paint or the scale changes. A live stroke
   * that grew has only its new end worked out; a zoom under way draws the
   * old picture stretched until it holds still; and a mark bigger than
   * {@link PENCIL_PICTURE_MAX} pixels is worked out for the part in view.
   */
  private paintPencil(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const t = ctx.getTransform();
    const scale = Math.hypot(t.a, t.b);
    if (!(scale > 0) || Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) return;
    const whole = pencilRegion(stroke, scale);
    if (!whole) return;
    // The view on the page's grid: a device pixel is a grid pixel moved by the translation.
    const view = { x: Math.floor(-t.e), y: Math.floor(-t.f), width: ctx.canvas.width + 1, height: ctx.canvas.height + 1 };
    const shown = overlap(whole, view);
    if (!shown) return;
    const now = performance.now();
    if (scale !== this.pencilScale) {
      this.pencilScale = scale;
      this.pencilScaleAt = now;
    }
    const pts = stroke.points;
    const key = `${stroke.width}|${stroke.color}|${stroke.pencil?.medium ?? ''}|${stroke.pencil?.grade ?? ''}|${stroke.vector?.closed === true}|${stroke.strokeStyle ?? ''}|${smudgesKey(stroke)}`;
    // A Smear drag over this mark: its picture with the pass so far.
    if (this.liveSmear?.ids.has(stroke.id)) {
      this.paintSmearing(ctx, stroke, whole, key, t);
      return;
    }
    let pic = this.pencils.get(stroke);
    const sum = pointsChecksum(pts);
    const same = pic !== undefined && pic.key === key && pic.points === pts;

    // A zoom under way: last scale's picture, stretched, until it holds still.
    if (pic && pic.key === key && pic.meant !== scale && pic.count === pts.length && pic.sum === sum && now - this.pencilScaleAt < PENCIL_SETTLE_MS) {
      const k = scale / pic.region.scale;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(pic.canvas, pic.region.x * k + t.e, pic.region.y * k + t.f, pic.region.width * k, pic.region.height * k);
      ctx.restore();
      this.repaintWhenSettled();
      return;
    }

    if (!(pic && same && pic.meant === scale && pic.count === pts.length && pic.sum === sum && (pic.region.scale !== scale || contains(pic.region, shown)))) {
      // A live stroke that only grew, and still fits its picture: its new end.
      const grew =
        pic !== undefined &&
        !stroke.smudges &&
        same &&
        pic.region.scale === scale &&
        pts.length > pic.count &&
        pointsChecksum(pts.slice(0, pic.count)) === pic.sum &&
        contains(pic.region, shown);
      if (grew && pic) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        // From the point before the old end, whose cap the new segment turns into a join.
        for (let i = Math.max(0, pic.count - 2); i < pts.length; i++) {
          minX = Math.min(minX, pts[i].x);
          minY = Math.min(minY, pts[i].y);
          maxX = Math.max(maxX, pts[i].x);
          maxY = Math.max(maxY, pts[i].y);
        }
        const half = stroke.width / 2 + 2 / scale;
        const dirty = overlap(
          {
            x: Math.floor((minX - half) * scale) - 1,
            y: Math.floor((minY - half) * scale) - 1,
            width: Math.ceil((maxX - minX + 2 * half) * scale) + 3,
            height: Math.ceil((maxY - minY + 2 * half) * scale) + 3,
          },
          pic.region,
        );
        if (dirty) {
          const px = pic.canvas.getContext('2d');
          if (px) {
            const data = rasterizePencil(stroke, { scale, ...dirty });
            px.putImageData(new ImageData(data, dirty.width, dirty.height), dirty.x - pic.region.x, dirty.y - pic.region.y);
            this.pencilRasters++;
          }
        }
        pic.count = pts.length;
        pic.sum = sum;
      } else {
        // Worked out whole - with room to grow, for a live stroke - or, for a
        // big mark, the part in view and half a view round it.
        const live = pic !== undefined && same && pts.length > pic.count;
        const grow = live ? Math.ceil(Math.max(whole.width, whole.height) * 0.5 + 64) : 0;
        let region: PencilRegion = grow > 0 ? { scale, x: whole.x - grow, y: whole.y - grow, width: whole.width + grow * 2, height: whole.height + grow * 2 } : whole;
        const smeared = (stroke.smudges?.length ?? 0) > 0;
        if (!smeared && region.width * region.height > PENCIL_PICTURE_MAX) {
          const around = { x: view.x - view.width / 2, y: view.y - view.height / 2, width: view.width * 2, height: view.height * 2 };
          region = { scale, ...(overlap(whole, around) ?? shown) };
        }
        if (smeared && region.width * region.height > SMEARED_PICTURE_MAX) {
          region = pencilRegion(stroke, scale * Math.sqrt(SMEARED_PICTURE_MAX / (region.width * region.height))) ?? region;
        }
        const canvas = pic && pic.canvas.width === region.width && pic.canvas.height === region.height ? pic.canvas : document.createElement('canvas');
        canvas.width = region.width;
        canvas.height = region.height;
        const px = canvas.getContext('2d');
        if (!px) return;
        px.putImageData(new ImageData(smeared ? pencilPicture(stroke, region) : rasterizePencil(stroke, region), region.width, region.height), 0, 0);
        this.pencilRasters++;
        pic = { key, points: pts, count: pts.length, sum, region, canvas, meant: scale };
        this.pencils.set(stroke, pic);
      }
    }
    if (!pic) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const k = scale / pic.region.scale;
    if (k === 1) ctx.drawImage(pic.canvas, pic.region.x + t.e, pic.region.y + t.f);
    else ctx.drawImage(pic.canvas, pic.region.x * k + t.e, pic.region.y * k + t.f, pic.region.width * k, pic.region.height * k);
    ctx.restore();
  }

  /**
   * Paints a Pencil mark a Smear drag has reached: its picture, passes and
   * all, with the drag's pass run over it - the whole of it the first time,
   * and after that only the steps the drag has added. At a new scale, or
   * when the mark itself changed, it starts again.
   */
  private paintSmearing(ctx: CanvasRenderingContext2D, stroke: Stroke, whole: PencilRegion, key: string, t: DOMMatrix): void {
    const drag = this.liveSmear;
    if (!drag) return;
    // Room round the mark for as far as the stump carries its graphite past
    // it (core/smudge.ts's reach), and the stump's own half width.
    let room = Math.ceil(3 * drag.pass.width * whole.scale);
    let region: PencilRegion = { scale: whole.scale, x: whole.x - room, y: whole.y - room, width: whole.width + 2 * room, height: whole.height + 2 * room };
    if (region.width * region.height > SMEARED_PICTURE_MAX) {
      const lower = pencilRegion(stroke, whole.scale * Math.sqrt(SMEARED_PICTURE_MAX / (region.width * region.height)));
      if (lower) {
        room = Math.ceil(3 * drag.pass.width * lower.scale);
        region = { scale: lower.scale, x: lower.x - room, y: lower.y - room, width: lower.width + 2 * room, height: lower.height + 2 * room };
      }
    }
    const stamp = `${key}|${region.scale}|${region.x}|${region.y}|${region.width}|${region.height}|${pointsChecksum(stroke.points)}`;
    let live = this.smearing.get(stroke.id);
    if (!live || live.key !== stamp) {
      const data = pencilPicture(stroke, region);
      const canvas = document.createElement('canvas');
      canvas.width = region.width;
      canvas.height = region.height;
      live = { key: stamp, region, data, state: smudgeBuffer(data, region, drag.pass, pencilRgb(stroke)), canvas };
      this.smearing.set(stroke.id, live);
      this.pencilRasters++;
    } else {
      live.state = smudgeBuffer(live.data, live.region, drag.pass, pencilRgb(stroke), live.state);
    }
    live.canvas.getContext('2d')?.putImageData(new ImageData(live.data, region.width, region.height), 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const k = whole.scale / region.scale;
    ctx.drawImage(live.canvas, region.x * k + t.e, region.y * k + t.f, region.width * k, region.height * k);
    ctx.restore();
  }

  /** Asks for a repaint once a zoom has held still, so Pencil marks are worked out at it. */
  private repaintWhenSettled(): void {
    if (this.pencilTimer !== null) return;
    this.pencilTimer = setTimeout(() => {
      this.pencilTimer = null;
      this.onImageLoad?.();
    }, PENCIL_SETTLE_MS);
  }

  private paintCopicNib(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    ctx.beginPath();
    for (const poly of copicNibPolygons(stroke)) {
      poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fill();
  }

  /** Draws a placed raster image item; decodes lazily and re-renders on load. */
  private paintImage(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const anchor = stroke.points[0];
    if (!anchor || !stroke.image) return;
    let img = this.imageCache.get(stroke.image);
    if (!img) {
      img = new Image();
      img.onload = () => this.onImageLoad?.();
      img.src = stroke.image;
      this.imageCache.set(stroke.image, img);
    }
    if (!img.complete || img.naturalWidth === 0) return;
    const w = stroke.imageWidth ?? img.naturalWidth;
    const h = stroke.imageHeight ?? img.naturalHeight;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    if (typeof stroke.opacity === 'number') ctx.globalAlpha = stroke.opacity;
    // Magnified far enough that one of its pixels covers several of the
    // screen's, an image shows its pixels, as an image editor does, rather
    // than smoothing them into a blur.
    const t = ctx.getTransform();
    const devicePerPage = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
    const screenPerPixel = (devicePerPage / this.dpr) * Math.min(w / img.naturalWidth, h / img.naturalHeight);
    if (screenPerPixel >= IMAGE_PIXELS_AT) ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, anchor.x, anchor.y, w, h);
    ctx.restore();
  }

  private paintText(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const anchor = stroke.points[0];
    if (!anchor || !stroke.text) return;
    const size = stroke.fontSize ?? 24;
    const lineHeight = size * 1.25;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = stroke.color;
    if (typeof stroke.opacity === 'number') ctx.globalAlpha = stroke.opacity;
    ctx.textBaseline = 'top';
    ctx.font = `${size}px ${stroke.fontFamily ?? DEFAULT_FONT_FAMILY}`;

    const boxWidth = stroke.textBoxWidth ?? 0;
    if (boxWidth > 0) {
      // Word-wrap within the fixed text-box width.
      const lines = wrapTextToLines(ctx, stroke.text, boxWidth);
      lines.forEach((line, i) => ctx.fillText(line, anchor.x, anchor.y + i * lineHeight));
    } else {
      stroke.text.split('\n').forEach((line, i) => {
        ctx.fillText(line, anchor.x, anchor.y + i * lineHeight);
      });
    }
    ctx.restore();
  }

  /**
   * The dashed boxes a selection is drawn with, in sketch units: one for each
   * selected mark, in paint-array order, its bounds padded by
   * {@link SELECTION_BOX_PAD} screen pixels at the current zoom. `render` draws exactly these, so a GUI check
   * that reads them back reads what is on the screen.
   */
  selectionBoxes(sketch: Sketch, selectedIds: ReadonlySet<string>): SelectionBox[] {
    const boxes: SelectionBox[] = [];
    const pad = SELECTION_BOX_PAD / this.zoom;
    const clips = clipIndex(sketch);
    for (const stroke of sketch.strokes) {
      // An eraser mark from an older file rides along with its layer but is
      // no element of its own: no box.
      if (!selectedIds.has(stroke.id) || stroke.tool === 'eraser') continue;
      const bounds = strokeBounds(stroke, (s) => this.measureText(s));
      // In a clip group a mark is boxed as it shows: cut to the clip's bounds.
      const box = bounds && shownBounds(sketch, stroke, bounds, clips);
      if (!box) continue;
      boxes.push({
        id: stroke.id,
        x: box.minX - pad,
        y: box.minY - pad,
        width: box.maxX - box.minX + pad * 2,
        height: box.maxY - box.minY + pad * 2,
      });
    }
    return boxes;
  }

  private paintSelection(ctx: CanvasRenderingContext2D, box: SelectionBox): void {
    const px = 1 / this.zoom;
    ctx.save();
    ctx.strokeStyle = '#2f6feb';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  /** Measures a text item's rendered width/height in CSS pixels. */
  measureText(stroke: Stroke): { width: number; height: number } {
    const size = stroke.fontSize ?? 24;
    const lineHeight = size * 1.25;
    const ctx = this.inkCtx;
    ctx.save();
    ctx.font = `${size}px ${stroke.fontFamily ?? DEFAULT_FONT_FAMILY}`;

    const boxWidth = stroke.textBoxWidth ?? 0;
    let width = 0;
    let lineCount = 0;
    if (boxWidth > 0) {
      const lines = wrapTextToLines(ctx, stroke.text ?? '', boxWidth);
      lineCount = lines.length;
      width = boxWidth;
    } else {
      const rawLines = (stroke.text ?? '').split('\n');
      lineCount = rawLines.length;
      for (const line of rawLines) width = Math.max(width, ctx.measureText(line).width);
    }

    ctx.restore();
    return { width, height: lineCount * lineHeight };
  }

  /**
   * Renders the current sketch to an image data URL.
   * @param type MIME type, e.g. 'image/png' or 'image/jpeg'.
   * @param background optional solid background (required for opaque JPEG).
   */
  toDataURL(type: 'image/png' | 'image/jpeg' = 'image/png', background?: string): string {
    if (type === 'image/jpeg' && background) {
      const flat = document.createElement('canvas');
      flat.width = this.canvas.width;
      flat.height = this.canvas.height;
      const fctx = flat.getContext('2d');
      if (fctx) {
        fctx.fillStyle = background;
        fctx.fillRect(0, 0, flat.width, flat.height);
        fctx.drawImage(this.canvas, 0, 0);
        return flat.toDataURL('image/jpeg', 0.92);
      }
    }
    return this.canvas.toDataURL(type, 0.92);
  }

  /** Renders any sketch to a data URL without needing an on-screen surface. */
  static renderSketchToDataURL(
    sketch: Sketch,
    format: 'image/png' | 'image/jpeg' = 'image/png',
    options: RenderOptions = {},
  ): string {
    const canvas = document.createElement('canvas');
    const surf = new Surface(canvas);
    surf.resize(sketch.width, sketch.height);
    surf.render(sketch, null, undefined, options);
    const url = surf.toDataURL(format, format === 'image/jpeg' ? sketch.background : undefined);
    // The surface is thrown away here, but a pending image load would keep it
    // (and every bitmap it decoded) alive until it settled. Exporting a book
    // builds one of these per page.
    surf.clearImages();
    return url;
  }

  /**
   * Serialises a sketch to an SVG string (lossless vector). The writer lives
   * in `core/sketch-svg.ts`, where code with no DOM reaches it too; see
   * {@link sketchToSvg}.
   */
  static toSVG(sketch: Sketch, options: SvgExportOptions = {}): string {
    return sketchToSvg(sketch, options);
  }
  /**
   * Generates a flat-nib cursor data URL for the Copic marker: a short bar
   * rotated to the current nib angle, sized to the tool width.
   * Returns the URL and the hotspot coordinates (center of the nib).
   */
  static makeNibCursorDataUrl(
    cssWidth: number,
    color: string,
    nibAngleDeg: number,
  ): { url: string; hotspotX: number; hotspotY: number } {
    const half = Math.max(4, cssWidth / 2);
    const pad = 4;
    const size = Math.min(128, Math.ceil(half * 2 + pad * 2));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { url: '', hotspotX: 0, hotspotY: 0 };
    const cx = size / 2;
    const cy = size / 2;
    const reach = Math.min(half, cx - 2);
    const rad = (nibAngleDeg * Math.PI) / 180;
    const dx = Math.cos(rad) * reach;
    const dy = Math.sin(rad) * reach;
    ctx.lineCap = 'round';
    // White halo for visibility on dark backgrounds.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    // Ink-colored nib bar.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    return {
      url: canvas.toDataURL(),
      hotspotX: Math.round(cx),
      hotspotY: Math.round(cy),
    };
  }

  /**
   * Generates a circular cursor data URL matching the current tool width.
   * Returns the URL and the hotspot coordinates (center of the circle).
   */
  static makeCursorDataUrl(
    cssWidth: number,
    color: string,
  ): { url: string; hotspotX: number; hotspotY: number } {
    const r = Math.max(2, cssWidth / 2);
    const pad = 3;
    const size = Math.min(128, Math.ceil(r * 2 + pad * 2));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { url: '', hotspotX: 0, hotspotY: 0 };
    const cx = size / 2;
    const cy = size / 2;
    const drawR = Math.min(r, cx - 1);
    // White halo for visibility on dark backgrounds.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, drawR, 0, Math.PI * 2);
    ctx.stroke();
    // Ink-colored ring.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, drawR, 0, Math.PI * 2);
    ctx.stroke();
    return {
      url: canvas.toDataURL(),
      hotspotX: Math.round(cx),
      hotspotY: Math.round(cy),
    };
  }

  /**
   * The Shape Stacker's cursor: a crosshair with a plus beside it - a press
   * merges - or, while `Alt` is held, a minus - it takes away.
   */
  static makeStackerCursorDataUrl(minus: boolean): { url: string; hotspotX: number; hotspotY: number } {
    const size = 26;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { url: '', hotspotX: 0, hotspotY: 0 };
    const c = 9;
    const lines = (stroke: string, width: number): void => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c, 2);
      ctx.lineTo(c, 16);
      ctx.moveTo(2, c);
      ctx.lineTo(16, c);
      // The sign, below and to the right.
      ctx.moveTo(15, 20);
      ctx.lineTo(23, 20);
      if (!minus) {
        ctx.moveTo(19, 16);
        ctx.lineTo(19, 24);
      }
      ctx.stroke();
    };
    // A white halo under the dark lines, so the cursor reads on any paper.
    lines('rgba(255,255,255,0.9)', 3.5);
    lines('rgba(31,35,40,0.95)', 1.5);
    return { url: canvas.toDataURL(), hotspotX: c, hotspotY: c };
  }

  /**
   * Generates the eraser cursor: a dashed circle the size of the eraser's
   * footprint, so the area about to be cleared is visible before pressing.
   * Returns the URL and the hotspot coordinates (center of the circle).
   */
  static makeEraserCursorDataUrl(
    cssWidth: number,
  ): { url: string; hotspotX: number; hotspotY: number } {
    const r = Math.max(3, cssWidth / 2);
    const pad = 3;
    const size = Math.min(128, Math.ceil(r * 2 + pad * 2));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { url: '', hotspotX: 0, hotspotY: 0 };
    const cx = size / 2;
    const cy = size / 2;
    const drawR = Math.min(r, cx - 1.5);
    const ring = (stroke: string, lineWidth: number, dashOffset: number): void => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = dashOffset;
      ctx.beginPath();
      ctx.arc(cx, cy, drawR, 0, Math.PI * 2);
      ctx.stroke();
    };
    // Interleaved light/dark dashes so the ring reads on any background.
    ring('rgba(255,255,255,0.9)', 2.5, 0);
    ring('rgba(31,35,40,0.85)', 1.25, 0);
    ring('rgba(31,35,40,0.35)', 1.25, 4);
    // Center dot marks the exact hotspot on a wide eraser.
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(31,35,40,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1, 0, Math.PI * 2);
    ctx.fill();
    return {
      url: canvas.toDataURL(),
      hotspotX: Math.round(cx),
      hotspotY: Math.round(cy),
    };
  }
}

/**
 * The paint for a stroke's interior: a canvas gradient when the stroke
 * carries one, otherwise its flat fill color (or null when it has neither).
 */
function fillPaintFor(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
): string | CanvasGradient | null {
  if (stroke.gradient) {
    const paint = canvasGradient(ctx, stroke.gradient, strokeBounds(stroke));
    if (paint) return paint;
  }
  return stroke.fill ?? null;
}

/**
 * Builds a canvas gradient spanning a shape's bounding box. A linear gradient
 * runs across the box at its angle (0 = left to right, clockwise); a radial
 * one runs from the box's centre out to its corner.
 */
function canvasGradient(
  ctx: CanvasRenderingContext2D,
  gradient: Gradient,
  box: { minX: number; minY: number; maxX: number; maxY: number } | null,
): CanvasGradient | null {
  const stops = normalizedStops(gradient);
  if (!box || !stops) return null;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  let paint: CanvasGradient;
  if (gradient.type === 'radial') {
    paint = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2);
  } else {
    // Project the box's half-diagonal onto the gradient axis so the ramp
    // spans the whole shape at any angle, matching CSS linear-gradient.
    const rad = ((gradient.angle ?? 0) * Math.PI) / 180;
    const reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
    const dx = Math.cos(rad) * reach;
    const dy = Math.sin(rad) * reach;
    paint = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  for (const stop of stops) paint.addColorStop(stop.offset, stop.color);
  return paint;
}

/**
 * Adds a stroke's points to the current canvas path, starting a new subpath
 * at every `move` point so compound shapes keep their holes and islands.
 */
/** A number that changes when any point does: position or pressure, in order. */
/** A mark's Smear passes as a key: a smear changes the picture. */
function smudgesKey(stroke: Stroke): string {
  if (!stroke.smudges || stroke.smudges.length === 0) return '';
  let sum = 0;
  stroke.smudges.forEach((smudge, k) => {
    sum += (k + 1) * (smudge.width * 1.7 + smudge.strength * 3.1);
    smudge.path.forEach((a, i) => {
      sum += (k + 1) * (i + 1) * (a.p.x * 1.0001 + a.p.y * 1.7321 + (a.pressure ?? 0.5) * 2.2361 + (a.hIn ? a.hIn.x + a.hIn.y * 0.7 : 0) + (a.hOut ? a.hOut.x * 0.3 + a.hOut.y : 0));
    });
  });
  return `${stroke.smudges.length}:${sum}`;
}

/** Where two boxes of whole pixels overlap, or null when they do not. */
function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(right - x), height: Math.ceil(bottom - y) } : null;
}

/** Whether box `outer` holds all of box `inner`. */
function contains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function pointsChecksum(pts: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    sum += (i + 1) * (p.x * 1.0001 + p.y * 1.7321 + (p.pressure ?? 0.5) * 2.2361);
  }
  return sum;
}

/**
 * The widest blur a picture padded `pad` device pixels past the view may
 * have: a third of it, so the three standard deviations a Gaussian gathers
 * from never run past what was painted. No cap on a picture with no pad,
 * which has nothing to blur.
 */
function blurCap(pad: number): number {
  return pad > 0 ? pad / 3 : Infinity;
}

/**
 * How far a mark's ink can reach past its points' bounds, in page units,
 * with room to spare: a whole width covers a Copic's nib and the widest
 * stroke profile, which reach less. Text and images are their boxes.
 */
function inkMargin(stroke: Stroke): number {
  if (isTextStroke(stroke) || isImageStroke(stroke)) return 2;
  return Math.max(1, stroke.width);
}

function tracePoints(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  pts.forEach((p, i) => (i === 0 || p.move ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

// ---- Word-wrap helper -------------------------------------------------------

/**
 * Breaks `text` into display lines that fit within `maxWidth` CSS pixels.
 * Respects explicit newlines and wraps on word boundaries.
 */
function wrapTextToLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) { result.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    result.push(line);
  }
  return result;
}
