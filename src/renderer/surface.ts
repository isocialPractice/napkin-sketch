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
  defaultOpacityFor,
  effectiveLayer,
  isImageStroke,
  isTextStroke,
  layerOf,
  strokesOnLayer,
  type Point,
  type Sketch,
  type Stroke,
} from '../core/types.js';
import { copicNibPolygons } from '../core/nib.js';

/** A live (in-progress) stroke being drawn by the user. */
export interface LiveStroke extends Stroke {
  points: Point[];
}

/** Extra, transient things to overlay on top of the sketch. */
export interface Overlay {
  /** Ids of currently selected strokes (drawn with a highlight outline). */
  selectedIds?: Set<string>;
  /** When > 1, draws faint mirror axes for symmetry drawing. */
  symmetry?: number;
  /** Dashed rectangle preview while dragging a new text box. */
  liveTextBox?: { x1: number; y1: number; x2: number; y2: number };
  /** Dashed rectangle preview while rubber-band selecting. */
  selectBox?: { x1: number; y1: number; x2: number; y2: number };
  /** Dashed straight-line preview (Space + drag) in sketch coordinates. */
  straightLine?: { a: Point; b: Point; color: string; width: number };
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
  render(sketch: Sketch, live?: LiveStroke | null, overlay?: Overlay): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.paintBackground(sketch.background);
    this.paintPaperTexture();
    if (overlay?.symmetry && overlay.symmetry > 1) {
      this.paintSymmetryGuide(overlay.symmetry);
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
    for (const layer of sketch.layers) {
      if (layer.group) continue; // groups paint nothing; they scale their children
      const effective = effectiveLayer(sketch, layer);
      if (!effective.visible) continue;
      const strokes = strokesOnLayer(sketch, layer.id);
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
  private paintSymmetryGuide(axes: number): void {
    const ctx = this.ctx;
    ctx.save();
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

    // Filled shape (paint bucket / Fill Shape): paint the closed interior
    // first so the outline still reads on top of the fill.
    if (stroke.fill && stroke.tool !== 'eraser' && pts.length > 2) {
      ctx.save();
      ctx.fillStyle = stroke.fill;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Copic marker: a flat chisel nib stamped along the path.
    if (stroke.tool === 'copic') {
      this.paintCopicNib(ctx, stroke);
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
  ): string {
    const canvas = document.createElement('canvas');
    const surf = new Surface(canvas);
    surf.resize(sketch.width, sketch.height);
    surf.render(sketch);
    return surf.toDataURL(format, format === 'image/jpeg' ? sketch.background : undefined);
  }

  /**
   * Serialises a sketch to an SVG string (lossless vector).
   *
   * Each visible layer becomes a `<g>` group carrying its name and opacity;
   * eraser strokes become a black-on-white `<mask>` on the group so they cut
   * holes only in their own layer. Marks carry `data-tool` and `data-i`
   * (original paint order) so importing the file restores the layer stack.
   */
  static toSVG(sketch: Sketch): string {
    const { width, height, background } = sketch;
    const defs: string[] = [];
    const groups: string[] = [];

    sketch.layers.forEach((layer, li) => {
      if (layer.group) return; // groups export via their children's effective props
      const effective = effectiveLayer(sketch, layer);
      if (!effective.visible) return;
      const strokes = strokesOnLayer(sketch, layer.id);
      if (strokes.length === 0) return;

      const attrs = [`id="layer-${li}"`, `data-name="${escXml(layer.name)}"`];
      if (effective.opacity < 1) attrs.push(`opacity="${effective.opacity}"`);

      const erasers = strokes.filter((s) => s.tool === 'eraser');
      if (erasers.length > 0) {
        const maskId = `erase-${li}`;
        defs.push(
          `<mask id="${maskId}">` +
            `<rect width="${width}" height="${height}" fill="#fff"/>` +
            erasers.map((s) => svgPath(s, sketch.strokes.indexOf(s), '#000')).join('') +
            `</mask>`,
        );
        attrs.push(`mask="url(#${maskId})"`);
      }

      const marks = strokes
        .filter((s) => s.tool !== 'eraser')
        .map((s) => {
          const order = sketch.strokes.indexOf(s);
          if (isTextStroke(s)) return svgText(s, order);
          if (isImageStroke(s)) return svgImage(s, order);
          if (s.tool === 'copic') return svgCopic(s, order);
          return svgPath(s, order);
        })
        .filter(Boolean);

      groups.push(`<g ${attrs.join(' ')}>\n${marks.join('\n')}\n</g>`);
    });

    const parts: string[] = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-generator="napkin-sketch">`,
      `<rect width="${width}" height="${height}" fill="${escXml(background)}"/>`,
    ];
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

// ---- SVG helpers ------------------------------------------------------------

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Serialises a drawing stroke as an SVG path (or dot). `colorOverride` is
 * used for eraser strokes inside a layer's mask, where black means "hide".
 */
function svgPath(stroke: Stroke, order: number, colorOverride?: string): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const opacity = colorOverride ? 1 : stroke.opacity ?? defaultOpacityFor(stroke.tool);
  const color = escXml(colorOverride ?? stroke.color);
  const data = `data-tool="${stroke.tool}" data-i="${order}"`;
  if (pts.length === 1) {
    const p = pts[0];
    const r = (stroke.width / 2).toFixed(1);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}" opacity="${opacity}" ${data}/>`;
  }
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // Filled shapes paint their interior (SVG auto-closes fills, so the path
  // data stays an M/L polyline and round-trips through import unchanged);
  // `data-fill` lets import restore the fill exactly.
  const fill = !colorOverride && stroke.fill ? escXml(stroke.fill) : null;
  const fillAttrs = fill ? `fill="${fill}" data-fill="${fill}"` : 'fill="none"';
  return `<path d="${d}" stroke="${color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" ${fillAttrs} opacity="${opacity}" ${data}/>`;
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
  const opacity = stroke.opacity ?? defaultOpacityFor('copic');
  const d = polys
    .map((poly) => poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z')
    .join(' ');
  const pts = stroke.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const nib = (stroke.nibAngle ?? DEFAULT_NIB_ANGLE).toFixed(1);
  return `<path d="${d}" fill="${escXml(stroke.color)}" fill-rule="nonzero" opacity="${opacity}" data-tool="copic" data-i="${order}" data-nib="${nib}" data-width="${stroke.width}" data-pts="${pts}"/>`;
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
    .map((line, i) => `<tspan x="${anchor.x.toFixed(1)}" dy="${i === 0 ? 0 : lineHeight.toFixed(1)}">${escXml(line)}</tspan>`)
    .join('');
  return `<text x="${anchor.x.toFixed(1)}" y="${anchor.y.toFixed(1)}" font-size="${size}" font-family="${family}" fill="${color}" dominant-baseline="hanging"${opacity} data-tool="text" data-i="${order}">${tspans}</text>`;
}

function svgImage(stroke: Stroke, order: number): string {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.image) return '';
  const w = stroke.imageWidth ?? 100;
  const h = stroke.imageHeight ?? 100;
  const opacity = typeof stroke.opacity === 'number' ? ` opacity="${stroke.opacity}"` : '';
  return `<image x="${anchor.x.toFixed(1)}" y="${anchor.y.toFixed(1)}" width="${w}" height="${h}" href="${escXml(stroke.image)}"${opacity} data-tool="image" data-i="${order}"/>`;
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
