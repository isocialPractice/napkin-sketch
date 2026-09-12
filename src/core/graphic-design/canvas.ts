/**
 * Canvas back end for the graphic-design API.
 *
 * This is what `useGuiCanvas` means. The API is headless by default - a
 * composition is a document, and the two renderers that matter write files -
 * but the app already owns a high-DPI 2D context, and a composition that is
 * meant to land *in the open sketch* should be drawn by the same context that
 * drew everything else on it rather than rasterized here and pasted in.
 *
 * Typed against the DOM's own `CanvasRenderingContext2D` and never imported by
 * the Node paths, so nothing outside the renderer pays for it. Text is drawn
 * with the browser's real fonts, positioned by the shared layout in `font.ts`,
 * so the line breaks match the SVG and the PNG and only the glyph shapes are
 * the host's own.
 */

import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_FONT,
  type ClipShape,
  type CompositionDocument,
  type Element,
  type TextElement,
} from './types.js';
import { elementMatrix, flattenShape, shapeCentre, type Contour, type Matrix } from './geometry.js';
import { layoutText, transformText } from './font.js';
import { toPx } from '../units.js';

/** Resolves an `image` element's `src` to something the canvas can draw. */
export type CanvasImageResolver = (src: string) => CanvasImageSource | null;

/** Options for {@link paintComposition}. */
export interface PaintOptions {
  /** Device pixels per composition pixel. Default 1. */
  scale?: number;
  /** Supplies the drawable behind each `image` element. */
  resolveImage?: CanvasImageResolver;
}

/** Traces closed and open contours into the current path. */
function tracePath(ctx: CanvasRenderingContext2D, contours: Contour[], close: boolean): void {
  for (const contour of contours) {
    if (contour.length < 2) continue;
    ctx.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) ctx.lineTo(contour[i].x, contour[i].y);
    if (close) ctx.closePath();
  }
}

/** Applies an element's transform to the context. */
function applyMatrix(ctx: CanvasRenderingContext2D, m: Matrix): void {
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

/** Sets the clip from a named mask or an inline shape. */
function applyClip(
  ctx: CanvasRenderingContext2D,
  clip: string | ClipShape,
  clips: Map<string, ClipShape[]>,
): void {
  const shapes = typeof clip === 'string' ? clips.get(clip) : [clip];
  if (!shapes || shapes.length === 0) return;
  ctx.beginPath();
  for (const shape of shapes) {
    ctx.save();
    applyMatrix(ctx, elementMatrix(shape, shapeCentre(shape)));
    const flat = flattenShape(shape);
    tracePath(ctx, flat.closed, true);
    ctx.restore();
  }
  ctx.clip();
}

/** Sets the paint state an element asks for. */
function applyPaint(ctx: CanvasRenderingContext2D, el: Element): void {
  if (el.opacity !== undefined) ctx.globalAlpha *= el.opacity;
  if (el.fill) ctx.fillStyle = el.fill;
  if (el.stroke) ctx.strokeStyle = el.stroke;
  ctx.lineWidth = el.strokeWidth ?? 1;
  ctx.lineCap = el.lineCap ?? 'butt';
  ctx.lineJoin = el.lineJoin ?? 'miter';
  if (el.dash && el.dash.length > 0) ctx.setLineDash(el.dash);
  else ctx.setLineDash([]);
  ctx.lineDashOffset = el.dashOffset ?? 0;
}

/** Draws a text element with the host's own fonts. */
function paintText(ctx: CanvasRenderingContext2D, el: TextElement): void {
  const fontSize = el.fontSize ?? DEFAULT_FONT_SIZE;
  const content = transformText(el.text, el.transform);
  const layout = layoutText(content, {
    x: el.x,
    y: el.y,
    fontSize,
    lineHeight: el.lineHeight ?? DEFAULT_LINE_HEIGHT,
    align: el.align ?? 'left',
    baseline: el.baseline ?? 'alphabetic',
    maxWidth: el.maxWidth,
    letterSpacing: el.letterSpacing,
    wordSpacing: el.wordSpacing,
    paragraphSpacing: el.paragraphSpacing,
    indent: el.indent,
  });

  const style = el.fontStyle === 'italic' ? 'italic ' : '';
  const weight = el.fontWeight === undefined ? '' : `${el.fontWeight} `;
  ctx.font = `${style}${weight}${fontSize}px ${el.fontFamily ?? DEFAULT_TEXT_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    if (el.fill !== null) ctx.fillText(line.text, line.x, line.y);
    if (el.stroke) ctx.strokeText(line.text, line.x, line.y);
  }
}

/** Draws one element, recursing through groups. */
function paintElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  clips: Map<string, ClipShape[]>,
  options: PaintOptions,
): void {
  if (el.visible === false) return;
  ctx.save();
  applyMatrix(ctx, elementMatrix(el, shapeCentre(el)));
  if (el.clip) applyClip(ctx, el.clip, clips);
  applyPaint(ctx, el);

  switch (el.type) {
    case 'group':
      for (const child of el.children) paintElement(ctx, child, clips, options);
      break;
    case 'text':
      paintText(ctx, el);
      break;
    case 'image': {
      const drawable = options.resolveImage?.(el.src) ?? null;
      if (drawable) ctx.drawImage(drawable, el.x, el.y, el.width, el.height);
      break;
    }
    default: {
      const flat = flattenShape(el);
      if (el.fill) {
        ctx.beginPath();
        tracePath(ctx, flat.closed, true);
        ctx.fill(el.fillRule ?? 'nonzero');
      }
      if (el.stroke) {
        ctx.beginPath();
        tracePath(ctx, flat.closed, true);
        tracePath(ctx, flat.open, false);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * Paints a composition into a 2D context.
 *
 * The context is left as it was found: everything happens inside one
 * save/restore pair, so the caller's own transform and paint state survive.
 */
export function paintComposition(
  ctx: CanvasRenderingContext2D,
  doc: CompositionDocument,
  options: PaintOptions = {},
): void {
  const unitScale = toPx(1, doc.units) * (options.scale ?? 1);
  const clips = new Map(doc.clips.map((clip) => [clip.id, clip.shapes]));

  ctx.save();
  ctx.scale(unitScale, unitScale);
  if (doc.background) {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  for (const el of doc.elements) paintElement(ctx, el, clips, options);
  ctx.restore();
}
