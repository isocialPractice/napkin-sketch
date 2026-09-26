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
import { cssFilter, readEffects, type Effect, type LinearTransform } from '../core/effects.js';
import { copicNibPolygons } from '../core/nib.js';
import { sketchToSvg, type SvgExportOptions } from '../core/sketch-svg.js';
import { strokeBounds } from '../core/bounds.js';

export { strokeBounds, type SvgExportOptions };
import { activeProfile, profileInputOf, profilePieces } from '../core/stroke-profile.js';

/** A live (in-progress) stroke being drawn by the user. */
export interface LiveStroke extends Stroke {
  points: Point[];
}

/** What a render puts under the ink. */
/** What one render's walk over the layer stack reads, worked out once for the frame. */
interface LayerWalk {
  sketch: Sketch;
  byLayer: Map<string, Stroke[]>;
  effectiveOf: ReturnType<typeof effectiveLayers>;
  byId: Map<string, Layer>;
  /** Groups whose effects make them paint as one picture. */
  effectGroups: Set<string>;
  live: LiveStroke | null;
  liveLayerId: string | null;
  /** Device pixels to one page pixel, for a filter's lengths. */
  device: LinearTransform;
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
  /** A mark with effects is painted here first, then laid down through them. */
  private effectCanvas: HTMLCanvasElement | null = null;
  /** A group with effects paints its layers here, one canvas for each depth of nesting. */
  private readonly groupCanvases: HTMLCanvasElement[] = [];
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
    // One pass over the page, not one per layer: every mark commits to a
    // layer of its own, so rescanning the stroke list for each row made a
    // frame cost the square of the page's size.
    const scale = this.dpr * this.zoom;
    const walk: LayerWalk = {
      sketch,
      byLayer: strokesByLayer(sketch),
      effectiveOf: effectiveLayers(sketch),
      byId: new Map(sketch.layers.map((layer) => [layer.id, layer])),
      effectGroups: new Set(sketch.layers.filter((layer) => layer.group && readEffects(layer.effects)).map((layer) => layer.id)),
      live: live ?? null,
      liveLayerId: live ? layerOf(sketch, live).id : null,
      device: { a: scale, b: 0, c: 0, d: scale },
    };
    this.paintLayers(ink, null, walk, 0);
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

    if (overlay?.transform) {
      this.paintTransformBox(ctx, overlay.transform);
    }

    if (overlay?.rotate) {
      this.paintRotateCenter(ctx, overlay.rotate);
    }

    if (overlay?.anchors) {
      this.paintAnchors(ctx, overlay.anchors);
    }

    if (overlay?.warp) {
      this.paintWarpOverlay(ctx, overlay.warp);
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
  private paintLayers(target: CanvasRenderingContext2D, scope: Layer | null, walk: LayerWalk, depth: number): void {
    const done = new Set<string>();
    for (const layer of walk.sketch.layers) {
      if (layer.group) continue;
      const effective = walk.effectiveOf.get(layer.id);
      if (!effective || !effective.visible) continue;
      if (scope && !this.isUnder(layer, scope, walk)) continue;
      const group = this.effectGroupOf(layer, scope, walk);
      if (group) {
        if (!done.has(group.id)) {
          done.add(group.id);
          this.paintGroupPicture(target, group, scope, walk, depth);
        }
        continue;
      }
      this.paintLeaf(target, layer, this.opacityBetween(layer, scope, walk), walk);
    }
  }

  /** One drawing layer: its marks on the scratch canvas, laid down at `opacity` through its own effects. */
  private paintLeaf(target: CanvasRenderingContext2D, layer: Layer, opacity: number, walk: LayerWalk): void {
    const strokes = walk.byLayer.get(layer.id) ?? [];
    const live = walk.live;
    const liveHere = live && live.points.length > 0 && walk.liveLayerId === layer.id ? live : null;
    if (strokes.length === 0 && !liveHere) return;

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

    this.layDown(target, this.scratch, opacity, readEffects(layer.effects), walk.device);
  }

  /** A group with effects: what it holds, on a canvas of its own, laid down through its effects. */
  private paintGroupPicture(target: CanvasRenderingContext2D, group: Layer, scope: Layer | null, walk: LayerWalk, depth: number): void {
    const canvas = this.groupCanvas(depth);
    const gctx = canvas.getContext('2d');
    if (!gctx) return;
    this.paintLayers(gctx, group, walk, depth + 1);
    this.layDown(target, canvas, this.opacityBetween(group, scope, walk), readEffects(group.effects), walk.device);
  }

  /** Draws a device-sized picture onto `target` at `opacity`, through `effects` when it has any. */
  private layDown(
    target: CanvasRenderingContext2D,
    picture: HTMLCanvasElement,
    opacity: number,
    effects: Effect[] | undefined,
    device: LinearTransform,
  ): void {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = opacity;
    if (effects) target.filter = cssFilter(effects, device);
    target.drawImage(picture, 0, 0);
    target.restore();
  }

  /** A cleared, device-sized canvas for a group's picture at a depth of nesting. */
  private groupCanvas(depth: number): HTMLCanvasElement {
    let canvas = this.groupCanvases[depth];
    if (!canvas) {
      canvas = document.createElement('canvas');
      this.groupCanvases[depth] = canvas;
    }
    if (canvas.width !== this.ink.width || canvas.height !== this.ink.height) {
      canvas.width = this.ink.width;
      canvas.height = this.ink.height;
    } else {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
    return canvas;
  }

  /** True when `layer` sits somewhere inside `group`. */
  private isUnder(layer: Layer, group: Layer, walk: LayerWalk): boolean {
    const seen = new Set<string>();
    for (let at = layer.parent ? walk.byId.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? walk.byId.get(at.parent) : undefined) {
      if (at.id === group.id) return true;
      seen.add(at.id);
    }
    return false;
  }

  /** The outermost group with effects between `layer` and `scope`, which paints `layer` as part of its picture. */
  private effectGroupOf(layer: Layer, scope: Layer | null, walk: LayerWalk): Layer | null {
    if (walk.effectGroups.size === 0) return null;
    let found: Layer | null = null;
    const seen = new Set<string>();
    for (let at = layer.parent ? walk.byId.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? walk.byId.get(at.parent) : undefined) {
      if (scope && at.id === scope.id) break;
      seen.add(at.id);
      if (walk.effectGroups.has(at.id)) found = at;
    }
    return found;
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

  private paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const effects = stroke.tool === 'eraser' ? undefined : readEffects(stroke.effects);
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

    // A stroke profile runs the width along the length, which no canvas line
    // can: the stroke paints as the shape it is, its pieces merged by one
    // non-zero fill so translucent ink lays down flat. Dashes are cut from
    // the profiled outline, so this goes before the dash branch below.
    if (pts.length > 1 && activeProfile(stroke)) {
      ctx.beginPath();
      for (const piece of profilePieces(profileInputOf(stroke))) {
        piece.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
      }
      ctx.fill('nonzero');
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
  /**
   * Paints a mark that carries effects: the mark itself on a canvas of its
   * own, then that picture laid down through its effects, so they work on
   * the whole mark - its fill and its outline as one - as the exports do.
   */
  private paintWithEffects(ctx: CanvasRenderingContext2D, stroke: Stroke, effects: Effect[]): void {
    let canvas = this.effectCanvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      this.effectCanvas = canvas;
    }
    if (canvas.width !== ctx.canvas.width || canvas.height !== ctx.canvas.height) {
      canvas.width = ctx.canvas.width;
      canvas.height = ctx.canvas.height;
    }
    const fx = canvas.getContext('2d');
    if (!fx) return;
    const transform = ctx.getTransform();
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, canvas.width, canvas.height);
    fx.setTransform(transform);
    this.paintStroke(fx, { ...stroke, effects: undefined });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = cssFilter(effects, transform);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
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
