/**
 * Canvas rendering surface for a single sketch.
 *
 * Renders in two layers so the eraser works correctly:
 *   1. A base layer with the napkin background + paper texture.
 *   2. An offscreen, transparent "ink" layer that holds the strokes; the
 *      eraser cuts holes in this layer with `destination-out`, revealing the
 *      paper beneath instead of painting opaque black.
 * The ink layer is then composited onto the base layer.
 *
 * Also renders text items, an optional symmetry guide, and a selection
 * outline. Pure rendering — it holds no document state of its own.
 */

import {
  DEFAULT_FONT_FAMILY,
  isTextStroke,
  type Point,
  type Sketch,
  type Stroke,
} from '../core/types.js';

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
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  // Pan/zoom viewport applied to drawn content (strokes, texture, overlays).
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');
    this.ctx = ctx;

    this.ink = document.createElement('canvas');
    const inkCtx = this.ink.getContext('2d', { alpha: true });
    if (!inkCtx) throw new Error('Offscreen 2D context is unavailable.');
    this.inkCtx = inkCtx;
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
  }

  /** Width of the drawable area in CSS pixels. */
  get width(): number {
    return this.cssWidth;
  }

  /** Height of the drawable area in CSS pixels. */
  get height(): number {
    return this.cssHeight;
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

    // Strokes go on the transparent ink layer so the eraser reveals paper.
    // The pan/zoom viewport is applied here so drawn content moves and scales
    // while the paper background and texture stay put (a stable canvas).
    const ink = this.inkCtx;
    ink.save();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, this.ink.width, this.ink.height);
    ink.scale(this.dpr, this.dpr);
    this.applyWorld(ink);
    for (const stroke of sketch.strokes) {
      this.paintStroke(ink, stroke);
    }
    if (live && live.points.length > 0) {
      this.paintStroke(ink, live);
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

  private paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (isTextStroke(stroke)) {
      this.paintText(ctx, stroke);
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
      ctx.globalAlpha = stroke.opacity ?? (stroke.tool === 'marker' ? 0.38 : 1);
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

  /** Serialises a sketch to an SVG string (lossless vector). */
  static toSVG(sketch: Sketch): string {
    const { width, height, background, strokes } = sketch;
    const parts: string[] = [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" fill="${escXml(background)}"/>`,
    ];

    for (const stroke of strokes) {
      if (isTextStroke(stroke)) {
        parts.push(svgText(stroke));
      } else if (stroke.tool === 'eraser') {
        parts.push(svgEraserPath(stroke, background));
      } else {
        parts.push(svgPath(stroke));
      }
    }

    parts.push('</svg>');
    return parts.join('\n');
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

function svgPath(stroke: Stroke): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const opacity = stroke.opacity ?? (stroke.tool === 'marker' ? 0.38 : 1);
  const color = escXml(stroke.color);
  if (pts.length === 1) {
    const p = pts[0];
    const r = (stroke.width / 2).toFixed(1);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}" opacity="${opacity}"/>`;
  }
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `<path d="${d}" stroke="${color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${opacity}"/>`;
}

function svgEraserPath(stroke: Stroke, background: string): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const bg = escXml(background);
  if (pts.length === 1) {
    const p = pts[0];
    const r = (stroke.width / 2).toFixed(1);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${bg}"/>`;
  }
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `<path d="${d}" stroke="${bg}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}

function svgText(stroke: Stroke): string {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.text) return '';
  const size = stroke.fontSize ?? 24;
  const lineHeight = size * 1.25;
  const color = escXml(stroke.color);
  const family = escXml(stroke.fontFamily ?? DEFAULT_FONT_FAMILY);
  const lines = stroke.text.split('\n');
  const tspans = lines
    .map((line, i) => `<tspan x="${anchor.x.toFixed(1)}" dy="${i === 0 ? 0 : lineHeight.toFixed(1)}">${escXml(line)}</tspan>`)
    .join('');
  return `<text x="${anchor.x.toFixed(1)}" y="${anchor.y.toFixed(1)}" font-size="${size}" font-family="${family}" fill="${color}" dominant-baseline="hanging">${tspans}</text>`;
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
