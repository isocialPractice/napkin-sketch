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
  DEFAULT_NIB_ANGLE,
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
  type VectorAnchor,
} from '../core/types.js';
import { copicNibPolygons } from '../core/nib.js';
import { simplify } from '../sharpen/geometry.js';

/** How much of the page {@link Surface.toSVG} writes, and on what. */
export interface SvgExportOptions {
  /**
   * Size the document to this box (in sketch coordinates) instead of to the
   * page, so the file holds the graphic and no empty margin around it. The
   * viewBox is offset to the box rather than the geometry being moved, which
   * keeps every coordinate identical to a full-page export.
   */
  crop?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Leave the background rect out, so the document is transparent. */
  transparent?: boolean;
}

/** Rounds to two decimals, so bounds-derived sizes stay readable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A live (in-progress) stroke being drawn by the user. */
export interface LiveStroke extends Stroke {
  points: Point[];
}

/** What a render puts under the ink. */
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
  /** Ring marking the endpoint the pointer will snap to (Shift held while drawing). */
  snapTarget?: Point;
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
}

/** Pan/zoom viewport applied to the drawn content (in CSS pixels / unitless zoom). */
export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

/** Smallest and largest allowed zoom factors. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;

export class Surface {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ink: HTMLCanvasElement;
  private readonly inkCtx: CanvasRenderingContext2D;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  private dpr = 1;
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

  /** Replaces the viewport, clamping zoom to the supported range. */
  setViewport(viewport: Viewport): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom));
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
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
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
      ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
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
    const liveLayerId = live ? layerOf(sketch, live).id : null;
    // One pass over the page, not one per layer: every mark commits to a
    // layer of its own, so rescanning the stroke list for each row made a
    // frame cost the square of the page's size.
    const byLayer = strokesByLayer(sketch);
    const effectiveOf = effectiveLayers(sketch);
    for (const layer of sketch.layers) {
      if (layer.group) continue; // groups paint nothing; they scale their children
      const effective = effectiveOf.get(layer.id);
      if (!effective || !effective.visible) continue;
      const strokes = byLayer.get(layer.id) ?? [];
      const liveHere = live && live.points.length > 0 && liveLayerId === layer.id ? live : null;
      if (strokes.length === 0 && !liveHere) continue;

      const scratch = this.scratchCtx;
      scratch.save();
      scratch.setTransform(1, 0, 0, 1, 0, 0);
      scratch.clearRect(0, 0, this.scratch.width, this.scratch.height);
      scratch.scale(this.dpr, this.dpr);
      this.applyWorld(scratch);
      for (const stroke of strokes) {
        this.paintStroke(scratch, stroke);
      }
      if (liveHere) this.paintStroke(scratch, liveHere);
      scratch.restore();

      ink.globalAlpha = effective.opacity;
      ink.drawImage(this.scratch, 0, 0);
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

    if (overlay?.selectedIds && overlay.selectedIds.size > 0) {
      for (const stroke of sketch.strokes) {
        if (overlay.selectedIds.has(stroke.id)) this.paintSelection(ctx, stroke);
      }
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

    if (overlay?.rotate) {
      this.paintRotateCenter(ctx, overlay.rotate);
    }

    if (overlay?.anchors) {
      this.paintAnchors(ctx, overlay.anchors);
    }

    ctx.restore();
  }

  /** Applies the pan/zoom viewport to a context already scaled by the DPR. */
  private applyWorld(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
  }

  private paintBackground(color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
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
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
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
    ctx.setLineDash([8, 6]);
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

  private paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
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

    // Pressure-aware variable width: draw segment-by-segment so the line can
    // swell and taper like a real pen rather than a uniform vector path.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b.move) continue; // pen lifts between a compound shape's contours
      const avgPressure = ((a.pressure ?? 0.5) + (b.pressure ?? 0.5)) / 2;
      const widthScale =
        stroke.tool === 'marker' || stroke.tool === 'eraser' ? 1 : 0.4 + 0.6 * avgPressure;
      ctx.lineWidth = Math.max(0.5, stroke.width * widthScale);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Fills a Copic broad-nib stroke. All nib footprints go into one path with
   * a single fill so the translucent ink never double-darkens where segments
   * overlap - matching how one pass of a real marker lays down flat color.
   */
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

  private paintSelection(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const box = strokeBounds(stroke, (s) => this.measureText(s));
    if (!box) return;
    ctx.save();
    ctx.strokeStyle = '#2f6feb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    const pad = 6;
    ctx.strokeRect(
      box.minX - pad,
      box.minY - pad,
      box.maxX - box.minX + pad * 2,
      box.maxY - box.minY + pad * 2,
    );
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
   * Serialises a sketch to an SVG string (lossless vector).
   *
   * Each visible layer becomes a `<g>` group carrying its name and opacity,
   * and layer groups become nested `<g>` elements holding their children, so
   * the exported markup mirrors the layer tree instead of flattening it -
   * an imported document's group hierarchy survives the round trip. Eraser
   * strokes become a black-on-white `<mask>` on their layer's group so they
   * cut holes only in that layer. Marks carry `data-tool` and `data-i`
   * (original paint order) so importing the file restores the layer stack.
   *
   * A layer's name is written three ways so it survives the trip into other
   * editors: `data-name` (napkin's own), `inkscape:label` plus
   * `inkscape:groupmode="layer"` (what Inkscape's layers panel reads), and
   * the group `id` (what Illustrator reads).
   *
   * {@link SvgExportOptions} trims the document down for use as a sprite:
   * `crop` sizes it to a box instead of the page, and `transparent` leaves
   * the background rect out. Called without options the output is the full
   * page on its paper color.
   */
  static toSVG(sketch: Sketch, options: SvgExportOptions = {}): string {
    const { background } = sketch;
    // The document window: the page by default, or the crop box, which is
    // reached by offsetting the viewBox rather than moving the geometry -
    // the marks keep the coordinates every other export writes.
    const crop = options.crop;
    const viewX = crop ? round2(crop.minX) : 0;
    const viewY = crop ? round2(crop.minY) : 0;
    const width = crop ? Math.max(round2(crop.maxX - crop.minX), 1) : sketch.width;
    const height = crop ? Math.max(round2(crop.maxY - crop.minY), 1) : sketch.height;
    const defs: string[] = [];
    const usedIds = new Set<string>();
    const layerIndex = new Map(sketch.layers.map((layer, i) => [layer.id, i]));
    // Paint order and the per-layer stroke lists are both read once here
    // rather than searched for per mark: `indexOf` inside the mark loop made
    // an export cost the square of the page's size, and so did resolving
    // each layer's strokes by rescanning the page.
    const paintOrder = new Map(sketch.strokes.map((stroke, i) => [stroke.id, i]));
    const orderOf = (stroke: Stroke): number => paintOrder.get(stroke.id) ?? 0;
    const byLayer = strokesByLayer(sketch);
    const defaults = paintDefaults(sketch);

    // A rect covering the whole document window, wherever the viewBox sits.
    // The eraser mask needs that cover as much as the paper does: a mask rect
    // left at the origin while the viewBox is offset would fall outside the
    // crop and black out the layer it was meant to keep whole.
    const coverAt = crop ? `x="${viewX}" y="${viewY}" ` : '';
    const coverRect = (fill: string): string =>
      `<rect ${coverAt}width="${width}" height="${height}" fill="${fill}"/>`;

    // Rebuild the tree from the flat stack: a layer belongs under its parent
    // when that parent exists and is a group; anything else (no parent, or a
    // dangling id) exports at the top level. Sibling order follows the stack,
    // and since the store keeps a group's children adjacent to their group
    // row, tree order is paint order.
    const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
    const childrenOf = new Map<string, Layer[]>();
    const topLevel: Layer[] = [];
    for (const layer of sketch.layers) {
      const parent = layer.parent ? byId.get(layer.parent) : undefined;
      if (parent?.group) {
        const siblings = childrenOf.get(parent.id) ?? [];
        siblings.push(layer);
        childrenOf.set(parent.id, siblings);
      } else {
        topLevel.push(layer);
      }
    }

    // Visibility and opacity are written per group and inherit through the
    // nesting (SVG multiplies a child's opacity into its ancestors'), which
    // matches how effectiveLayer resolves them for rendering.
    const emitLayer = (layer: Layer): string | null => {
      if (!layer.visible) return null;
      const li = layerIndex.get(layer.id) ?? 0;
      const name = escXml(layer.name);
      const attrs = [
        `id="${uniqueId(idFromName(layer.name) || `layer-${li}`, usedIds)}"`,
        `data-name="${name}"`,
        `inkscape:label="${name}"`,
        `inkscape:groupmode="layer"`,
      ];
      if (layer.opacity < 1) attrs.push(`opacity="${layer.opacity}"`);

      if (layer.group) {
        const inner = (childrenOf.get(layer.id) ?? [])
          .map(emitLayer)
          .filter((g): g is string => g !== null);
        if (inner.length === 0) return null;
        return `<g ${attrs.join(' ')}>\n${inner.join('\n')}\n</g>`;
      }

      const strokes = byLayer.get(layer.id) ?? [];
      if (strokes.length === 0) return null;

      const erasers = strokes.filter((s) => s.tool === 'eraser');
      if (erasers.length > 0) {
        const maskId = `erase-${li}`;
        defs.push(
          `<mask id="${maskId}">` +
            coverRect('#fff') +
            erasers.map((s) => svgPath(s, orderOf(s), defaults, '#000')).join('') +
            `</mask>`,
        );
        attrs.push(`mask="url(#${maskId})"`);
      }

      const marks = strokes
        .filter((s) => s.tool !== 'eraser')
        .map((s) => {
          const order = orderOf(s);
          if (isTextStroke(s)) return svgText(s, order);
          if (isImageStroke(s)) return svgImage(s, order);
          if (s.tool === 'copic') return svgCopic(s, order);
          return svgPath(s, order, defaults, undefined, defs);
        })
        .filter(Boolean);

      return `<g ${attrs.join(' ')}>\n${marks.join('\n')}\n</g>`;
    };

    const groups = topLevel.map(emitLayer).filter((g): g is string => g !== null);
    // Inherited paint, stated once. `stroke-width` is only worth naming when
    // the shared width is not the 1 that SVG already defaults to.
    const rootPaint =
      ` fill="none" stroke-linecap="round" stroke-linejoin="round"` +
      (defaults.strokeWidth === 1 ? '' : ` stroke-width="${fmt(defaults.strokeWidth)}"`);
    const parts: string[] = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${width} ${height}"${rootPaint} data-generator="napkin-sketch">`,
    ];
    // A transparent document leaves no paper under the marks, which is what
    // lets a frame drop into a composition without a rectangle behind it.
    if (!options.transparent) {
      parts.push(coverRect(escXml(background)));
    }
    if (defs.length > 0) parts.push(`<defs>\n${defs.join('\n')}\n</defs>`);
    parts.push(...groups, '</svg>');
    return parts.join('\n');
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

/** Axis-aligned bounds of a stroke (or text item) in CSS pixels. */
export function strokeBounds(
  stroke: Stroke,
  measure?: (s: Stroke) => { width: number; height: number },
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (isImageStroke(stroke)) {
    const a = stroke.points[0];
    if (!a) return null;
    // Fall back to a nominal footprint when the placed size is unknown.
    const w = stroke.imageWidth ?? 100;
    const h = stroke.imageHeight ?? 100;
    return { minX: a.x, minY: a.y, maxX: a.x + w, maxY: a.y + h };
  }
  if (isTextStroke(stroke)) {
    const a = stroke.points[0];
    if (!a) return null;
    const m = measure
      ? measure(stroke)
      : {
          width: (stroke.text ?? '').length * (stroke.fontSize ?? 24) * 0.55,
          height: stroke.fontSize ?? 24,
        };
    return { minX: a.x, minY: a.y, maxX: a.x + m.width, maxY: a.y + m.height };
  }
  if (stroke.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Adds a stroke's points to the current canvas path, starting a new subpath
 * at every `move` point so compound shapes keep their holes and islands.
 */
function tracePoints(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  pts.forEach((p, i) => (i === 0 || p.move ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

// ---- SVG helpers ------------------------------------------------------------

/**
 * Tolerance (px) for dropping redundant polyline samples on export: a tenth
 * of a pixel is below anything a freehand stroke can show, so pruning to it
 * keeps files compact without a visible change. Vector anchors are never
 * pruned - they are the curve's definition, not samples of it.
 */
const EXPORT_SIMPLIFY_EPSILON = 0.1;

/**
 * Formats a coordinate at two-decimal precision without trailing zeros.
 * Two decimals keep artwork authored in small user units (a sprite in a
 * 43-unit viewBox, where the source itself carries hundredths) intact on the
 * round trip; one decimal was a visible distortion at that scale.
 */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Formats a path-data coordinate: two decimals, no trailing zeros, and no
 * leading zero in front of a fraction (`.5`, `-.5`). Path data is where the
 * numbers are, so the two bytes every SVG reader is happy to do without are
 * worth dropping there even though {@link fmt} keeps them in attributes.
 */
function fmtPathNum(n: number): string {
  const s = String(Math.round(n * 100) / 100);
  if (s.startsWith('0.')) return s.slice(1);
  if (s.startsWith('-0.')) return `-${s.slice(2)}`;
  return s;
}

/**
 * Renders one path command without committing it, so a caller can price two
 * spellings of the same segment against each other.
 *
 * The command letter is left out when it repeats the previous one (readers
 * carry it over), and a separator is left out wherever the next number is
 * self-delimiting: a leading `-` always is, and a leading `.` is once the
 * number before it has already spent its decimal point.
 */
function renderCommand(
  letter: string,
  nums: number[],
  lastLetter: string,
  prevNum: string,
): { text: string; prevNum: string } {
  let text = letter === lastLetter ? '' : letter;
  let prev = letter === lastLetter ? prevNum : '';
  for (const n of nums) {
    const token = fmtPathNum(n);
    const joined =
      prev !== '' && !(token.startsWith('-') || (token.startsWith('.') && prev.includes('.')));
    text += joined ? ` ${token}` : token;
    prev = token;
  }
  return { text, prevNum: prev };
}

/**
 * Builds SVG path data at the smallest byte count that still parses back to
 * the exact coordinates written.
 *
 * Four reductions, none of which moves a curve: every command is offered in
 * both its absolute and its relative spelling and the shorter one wins; a
 * repeated command letter is dropped; an axis-aligned line collapses to
 * `H`/`V`; and a cubic whose incoming handle mirrors the outgoing handle of
 * the cubic before it collapses to `S`, which draws the identical curve with
 * two numbers instead of four.
 *
 * Relative deltas are measured from the *rounded* current point rather than
 * the true one, so a reader reconstructs the rounded absolute coordinate
 * exactly and nothing drifts along a long path.
 */
class PathData {
  private text = '';
  private prevNum = '';
  private last = '';
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  /** Second control point of the cubic just written; null after anything else. */
  private ctrl: { x: number; y: number } | null = null;

  toString(): string {
    return this.text;
  }

  moveTo(px: number, py: number): void {
    const x = round2(px);
    const y = round2(py);
    this.emit('M', [x, y], [round2(x - this.x), round2(y - this.y)]);
    // A further coordinate pair after a moveto is an implicit lineto, so that
    // is the letter the next command has to beat.
    this.last = this.last === 'M' ? 'L' : 'l';
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
    this.ctrl = null;
  }

  lineTo(px: number, py: number): void {
    const x = round2(px);
    const y = round2(py);
    if (y === this.y && x !== this.x) {
      this.emit('H', [x], [round2(x - this.x)]);
    } else if (x === this.x && y !== this.y) {
      this.emit('V', [y], [round2(y - this.y)]);
    } else {
      this.emit('L', [x, y], [round2(x - this.x), round2(y - this.y)]);
    }
    this.x = x;
    this.y = y;
    this.ctrl = null;
  }

  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number): void {
    const ax = round2(c1x);
    const ay = round2(c1y);
    const bx = round2(c2x);
    const by = round2(c2y);
    const x = round2(px);
    const y = round2(py);
    // A smooth join writes its leading handle as the reflection of the last
    // one, which is what `S` infers for free.
    const smooth =
      this.ctrl !== null &&
      ax === round2(2 * this.x - this.ctrl.x) &&
      ay === round2(2 * this.y - this.ctrl.y);
    if (smooth) {
      this.emit(
        'S',
        [bx, by, x, y],
        [round2(bx - this.x), round2(by - this.y), round2(x - this.x), round2(y - this.y)],
      );
    } else {
      this.emit(
        'C',
        [ax, ay, bx, by, x, y],
        [
          round2(ax - this.x),
          round2(ay - this.y),
          round2(bx - this.x),
          round2(by - this.y),
          round2(x - this.x),
          round2(y - this.y),
        ],
      );
    }
    this.x = x;
    this.y = y;
    this.ctrl = { x: bx, y: by };
  }

  close(): void {
    this.emit('Z', [], []);
    this.x = this.startX;
    this.y = this.startY;
    this.ctrl = null;
  }

  /** Writes whichever of the two spellings costs fewer bytes here. */
  private emit(absolute: string, absArgs: number[], relArgs: number[]): void {
    const abs = renderCommand(absolute, absArgs, this.last, this.prevNum);
    const relative = absolute.toLowerCase();
    const rel = renderCommand(relative, relArgs, this.last, this.prevNum);
    const shorter = rel.text.length < abs.text.length;
    this.text += shorter ? rel.text : abs.text;
    this.prevNum = shorter ? rel.prevNum : abs.prevNum;
    this.last = shorter ? relative : absolute;
  }
}

/**
 * Paint that the root `<svg>` element states once for every mark below it to
 * inherit, instead of each `<path>` repeating it. `fill="none"`, round caps
 * and round joins are what a napkin mark always is; the width is whichever
 * one most of the marks on the page happen to share.
 */
interface SvgPaintDefaults {
  strokeWidth: number;
}

/**
 * The stroke width the most marks share. Ties keep the first width seen, so
 * the same page always exports the same document.
 */
function paintDefaults(sketch: Sketch): SvgPaintDefaults {
  const counts = new Map<number, number>();
  for (const stroke of sketch.strokes) {
    if (isTextStroke(stroke) || isImageStroke(stroke) || stroke.tool === 'copic') continue;
    const width = round2(stroke.width);
    counts.set(width, (counts.get(width) ?? 0) + 1);
  }
  let strokeWidth = 1;
  let best = 0;
  for (const [width, n] of counts) {
    if (n > best) {
      strokeWidth = width;
      best = n;
    }
  }
  return { strokeWidth };
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Turns a layer name into an XML id, escaping everything an id may not hold
 * as `_xHH_`. Inverse of the importer's `decodeIdName`, so a name written
 * here reads back as itself in editors that show ids as object names.
 * Returns `''` for a name with nothing usable left in it.
 */
function idFromName(name: string): string {
  const escaped = name
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, (c) => `_x${c.codePointAt(0)!.toString(16).toUpperCase()}_`);
  if (escaped === '') return '';
  // XML ids must begin with a letter or an underscore.
  return /^[A-Za-z_]/.test(escaped) ? escaped : `_${escaped}`;
}

/** Uniquifies an id with the `-2`, `-3`, … suffix editors use for repeats. */
function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  for (let n = 2; used.has(candidate); n++) candidate = `${id}-${n}`;
  used.add(candidate);
  return candidate;
}

/**
 * Path data for a stroke: strokes carrying Bézier anchor structure export as
 * exact cubic curves (a handful of C segments instead of hundreds of sampled
 * L points), everything else as its sampled polyline with samples that sit
 * within {@link EXPORT_SIMPLIFY_EPSILON} of the line through their
 * neighbours pruned away.
 */
function pathD(stroke: Stroke): string {
  const anchors = stroke.vector?.anchors;
  const out = new PathData();
  if (anchors && anchors.length >= 2) {
    const segment = (from: VectorAnchor, to: VectorAnchor): void => {
      if (!from.hOut && !to.hIn) {
        out.lineTo(to.p.x, to.p.y);
        return;
      }
      const c1 = from.hOut ?? from.p;
      const c2 = to.hIn ?? to.p;
      out.curveTo(c1.x, c1.y, c2.x, c2.y, to.p.x, to.p.y);
    };
    // A compound path is several subpaths; each closes back to its own start.
    const closed = stroke.vector?.closed === true;
    out.moveTo(anchors[0].p.x, anchors[0].p.y);
    let subStart = 0;
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i].move) {
        if (closed) {
          segment(anchors[i - 1], anchors[subStart]);
          out.close();
        }
        out.moveTo(anchors[i].p.x, anchors[i].p.y);
        subStart = i;
        continue;
      }
      segment(anchors[i - 1], anchors[i]);
    }
    if (closed) {
      segment(anchors[anchors.length - 1], anchors[subStart]);
      out.close();
    }
    return out.toString();
  }
  const pts = simplify(stroke.points, EXPORT_SIMPLIFY_EPSILON);
  pts.forEach((p, i) => (i === 0 ? out.moveTo(p.x, p.y) : out.lineTo(p.x, p.y)));
  return out.toString();
}

/**
 * Serialises a drawing stroke as an SVG path (or dot). `colorOverride` is
 * used for eraser strokes inside a layer's mask, where black means "hide".
 */
function svgPath(
  stroke: Stroke,
  order: number,
  defaults: SvgPaintDefaults,
  colorOverride?: string,
  defs?: string[],
): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const opacity = colorOverride ? 1 : stroke.opacity ?? defaultOpacityFor(stroke.tool);
  // `opacity` is not inherited and defaults to 1, so a fully opaque mark says
  // nothing about it; everything else here is inherited from the root element.
  const alpha = opacity === 1 ? '' : ` opacity="${opacity}"`;
  const color = escXml(colorOverride ?? stroke.color);
  const data = `data-tool="${stroke.tool}" data-i="${order}"`;
  if (pts.length === 1) {
    const p = pts[0];
    const r = fmt(stroke.width / 2);
    return `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${r}" fill="${color}"${alpha} ${data}/>`;
  }
  const d = pathD(stroke);
  // Filled shapes paint their interior (SVG auto-closes fills, so the path
  // data stays an M/L polyline and round-trips through import unchanged);
  // `data-fill` lets import restore the fill exactly. A gradient registers a
  // paint server in <defs> and rides along as `data-gradient` so napkin's own
  // importer restores the editable stops rather than re-reading the server.
  let fillAttrs = '';
  if (!colorOverride && stroke.gradient && defs) {
    const id = `grad-${order}`;
    const server = svgGradient(stroke, id);
    if (server) {
      defs.push(server);
      const json = escXml(JSON.stringify(stroke.gradient));
      // The flat fill rides along beside the gradient: the model keeps it so
      // removing the gradient restores it, and the round trip must too.
      const kept = stroke.fill ? ` data-fill="${escXml(stroke.fill)}"` : '';
      fillAttrs = ` fill="url(#${id})" data-gradient="${json}"${kept}`;
    }
  }
  if (fillAttrs === '' && !colorOverride && stroke.fill) {
    const fill = escXml(stroke.fill);
    fillAttrs = ` fill="${fill}" data-fill="${fill}"`;
  }
  // An outline switched off exports as `stroke="none"` - the SVG spelling of
  // a fill-only shape - with the kept color/width riding along for re-import.
  if (!colorOverride && stroke.noStroke) {
    return `<path d="${d}" stroke="none"${fillAttrs}${alpha} ${data} data-nostroke="1" data-color="${escXml(stroke.color)}" data-width="${stroke.width}"/>`;
  }
  const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
  const dashAttrs =
    dash.length > 0
      ? ` stroke-dasharray="${dash.map(fmt).join(',')}" data-dash="${stroke.strokeStyle}"`
      : '';
  // The root element carries the width most marks share; only the odd one out
  // has to name its own.
  const widthAttr =
    round2(stroke.width) === defaults.strokeWidth ? '' : ` stroke-width="${fmt(stroke.width)}"`;
  return `<path d="${d}" stroke="${color}"${widthAttr}${dashAttrs}${fillAttrs}${alpha} ${data}/>`;
}

/**
 * A gradient paint server for a stroke's fill, sized to the shape's bounding
 * box in user space (`gradientUnits="userSpaceOnUse"`) so it lines up with
 * the canvas rendering exactly. Returns null when the gradient has too few
 * stops to paint or the stroke has no bounds.
 */
function svgGradient(stroke: Stroke, id: string): string | null {
  const gradient = stroke.gradient;
  const box = strokeBounds(stroke);
  const stops = gradient ? normalizedStops(gradient) : null;
  if (!gradient || !box || !stops) return null;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const body = stops
    .map((s) => `<stop offset="${fmt(s.offset * 100)}%" stop-color="${escXml(s.color)}"/>`)
    .join('');
  if (gradient.type === 'radial') {
    const r = Math.hypot(w, h) / 2;
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}">${body}</radialGradient>`;
  }
  const rad = ((gradient.angle ?? 0) * Math.PI) / 180;
  const reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const dx = Math.cos(rad) * reach;
  const dy = Math.sin(rad) * reach;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(cx - dx)}" y1="${fmt(cy - dy)}" x2="${fmt(cx + dx)}" y2="${fmt(cy + dy)}">${body}</linearGradient>`;
}

/**
 * Serialises a Copic stroke as its filled chisel-nib outline so external
 * viewers see the flat-nib look. The centreline samples and nib angle ride
 * along in `data-pts` / `data-nib` so importing the file restores the
 * editable stroke exactly.
 */
function svgCopic(stroke: Stroke, order: number): string {
  const polys = copicNibPolygons(stroke);
  if (polys.length === 0) return '';
  const raw = stroke.opacity ?? defaultOpacityFor('copic');
  const opacity = raw === 1 ? '' : ` opacity="${raw}"`;
  // The chisel outline is derived viewer-only data (import rebuilds it from
  // `data-pts`), so its samples can be pruned like any other polyline.
  const outline = new PathData();
  for (const poly of polys) {
    simplify(poly, EXPORT_SIMPLIFY_EPSILON).forEach((p, i) =>
      i === 0 ? outline.moveTo(p.x, p.y) : outline.lineTo(p.x, p.y),
    );
    outline.close();
  }
  const d = outline.toString();
  const pts = stroke.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
  const nib = fmt(stroke.nibAngle ?? DEFAULT_NIB_ANGLE);
  return `<path d="${d}" fill="${escXml(stroke.color)}" fill-rule="nonzero"${opacity} data-tool="copic" data-i="${order}" data-nib="${nib}" data-width="${stroke.width}" data-pts="${pts}"/>`;
}

function svgText(stroke: Stroke, order: number): string {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.text) return '';
  const size = stroke.fontSize ?? 24;
  const lineHeight = size * 1.25;
  const color = escXml(stroke.color);
  const family = escXml(stroke.fontFamily ?? DEFAULT_FONT_FAMILY);
  const opacity = typeof stroke.opacity === 'number' ? ` opacity="${stroke.opacity}"` : '';
  const lines = stroke.text.split('\n');
  const tspans = lines
    .map((line, i) => `<tspan x="${fmt(anchor.x)}" dy="${i === 0 ? 0 : fmt(lineHeight)}">${escXml(line)}</tspan>`)
    .join('');
  return `<text x="${fmt(anchor.x)}" y="${fmt(anchor.y)}" font-size="${size}" font-family="${family}" fill="${color}" dominant-baseline="hanging"${opacity} data-tool="text" data-i="${order}">${tspans}</text>`;
}

function svgImage(stroke: Stroke, order: number): string {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.image) return '';
  const w = stroke.imageWidth ?? 100;
  const h = stroke.imageHeight ?? 100;
  const opacity = typeof stroke.opacity === 'number' ? ` opacity="${stroke.opacity}"` : '';
  return `<image x="${fmt(anchor.x)}" y="${fmt(anchor.y)}" width="${w}" height="${h}" href="${escXml(stroke.image)}"${opacity} data-tool="image" data-i="${order}"/>`;
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
