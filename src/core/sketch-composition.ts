/**
 * A sketch lowered into the graphic-design composition model, so that the
 * composition rasterizer draws it to PNG with no DOM, and with no second
 * rasterizer to keep in step with the first.
 *
 * Each mark is lowered the way the sketch's SVG export writes it, so the PNG
 * is the picture the SVG draws: the same path data, from the one path writer;
 * round caps and joins; the same dashes; a fill or a gradient placed as the
 * export places it; a profiled or Copic mark as the outline it fills; text as
 * text, an image as an image and a link as a linked image. Layers become
 * nested groups with their opacity, each drawn as one picture and laid down
 * at it, as the app composites a layer, and hidden layers are left out. An
 * eraser cuts through its own layer only: its marks become that layer's
 * `erase` shapes.
 *
 * A color the composition model cannot read - an imported `currentColor`,
 * say - paints nothing, which is what an SVG viewer does with it, and is
 * reported through `onWarning` rather than failing the page.
 */

import { simplify } from '../sharpen/geometry.js';
import { readEffects } from './effects.js';
import { parseColor } from './graphic-design/color.js';
import type { CompositionDocument, Element, GradientPaint, Paint } from './graphic-design/types.js';
import { copicNibPolygons } from './nib.js';
import { activeProfile, profileInputOf, profileOutline } from './stroke-profile.js';
import { EXPORT_SIMPLIFY_EPSILON, PathData, pathD } from './svg-path.js';
import {
  DEFAULT_FONT_FAMILY,
  dashPatternFor,
  defaultOpacityFor,
  isImageStroke,
  isTextStroke,
  normalizedStops,
  strokesByLayer,
  type Layer,
  type Sketch,
  type Stroke,
} from './types.js';
import { clipIndex } from './clip.js';
import { encodePng } from './graphic-design/png.js';
import { pencilPicture, pencilRegion, pngDataUrl } from './pencil.js';

/** What of a sketch {@link sketchToComposition} draws. */
export interface SketchCompositionOptions {
  /** Draw this box of the page, in page pixels, instead of the whole page. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Leave the paper out, so the page is transparent wherever nothing is drawn. */
  transparent?: boolean;
  /** Told about each color that paints nothing because the composition model cannot read it. */
  onWarning?: (message: string) => void;
  /**
   * Device pixels per page pixel the composition is to be drawn at: a Pencil
   * mark's grain is worked out for them, as the canvas works it out for the
   * screen's. Default 1.
   */
  scale?: number;
}

/** Reads a color once: the color when it paints, null when it cannot. */
type PaintCheck = (color: string | undefined | null) => string | null;

/** A color check that remembers what it has read, so a page of one bad color warns once. */
function paintCheck(onWarning?: (message: string) => void): PaintCheck {
  const read = new Map<string, boolean>();
  return (color) => {
    if (color === undefined || color === null) return null;
    let ok = read.get(color);
    if (ok === undefined) {
      try {
        parseColor(color);
        ok = true;
      } catch {
        ok = false;
        onWarning?.(`color "${color}" is not a color the PNG can paint, so what it colors was left out`);
      }
      read.set(color, ok);
    }
    return ok ? color : null;
  };
}

/** A sketch as a composition, ready for `rasterizeComposition` or `compositionToSvg`. */
export function sketchToComposition(sketch: Sketch, options: SketchCompositionOptions = {}): CompositionDocument {
  const crop = options.crop;
  const paint = paintCheck(options.onWarning);
  const byLayer = strokesByLayer(sketch);
  // The layer tree, as the SVG export rebuilds it: a layer sits under its
  // parent when that parent is a group, and at the top otherwise.
  const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
  const childrenOf = new Map<string, Layer[]>();
  const top: Layer[] = [];
  for (const layer of sketch.layers) {
    const parent = layer.parent ? byId.get(layer.parent) : undefined;
    if (parent?.group) {
      const siblings = childrenOf.get(parent.id) ?? [];
      siblings.push(layer);
      childrenOf.set(parent.id, siblings);
    } else {
      top.push(layer);
    }
  }

  // Clip groups (core/clip.ts): each clips with a mark that paints nothing while it does.
  const clips = clipIndex(sketch);
  const lowerLayer = (layer: Layer): Element | null => {
    if (!layer.visible) return null;
    const effects = readEffects(layer.effects);
    const own = { name: layer.name, ...(layer.opacity < 1 ? { opacity: layer.opacity } : {}), ...(effects ? { effects } : {}) };
    if (layer.group) {
      const children = (childrenOf.get(layer.id) ?? []).map(lowerLayer).filter((el): el is Element => el !== null);
      if (children.length === 0) return null;
      const clip = clips.byGroup.get(layer.id);
      if (!clip) return { type: 'group', ...own, children };
      // REUSE: the composition draws clips. A group's own clip is applied after
      // its effects, and the canvas cuts the picture before them, so a clip
      // group with effects carries the clip on a group of its own inside.
      const clipShape = { type: 'path' as const, d: outlineData(clip.region) };
      return effects
        ? { type: 'group', ...own, children: [{ type: 'group', clip: clipShape, children }] }
        : { type: 'group', ...own, clip: clipShape, children };
    }
    const strokes = clips.any ? (byLayer.get(layer.id) ?? []).filter((s) => !clips.marks.has(s.id)) : (byLayer.get(layer.id) ?? []);
    if (strokes.length === 0) return null;
    const erase = strokes.filter((s) => s.tool === 'eraser').flatMap(eraserElements);
    const children = strokes.filter((s) => s.tool !== 'eraser').flatMap((s) => withEffects(markElements(s, paint, options.scale ?? 1), s));
    return { type: 'group', ...own, children, ...(erase.length > 0 ? { erase } : {}) };
  };

  const elements = top.map(lowerLayer).filter((el): el is Element => el !== null);
  return {
    width: crop ? Math.max(1, crop.width) : sketch.width,
    height: crop ? Math.max(1, crop.height) : sketch.height,
    units: 'px',
    background: options.transparent ? null : paint(sketch.background),
    useGuiCanvas: false,
    clips: [],
    // A crop moves the page under the window rather than the marks, as the SVG's view box does.
    elements: crop && (crop.x !== 0 || crop.y !== 0) ? [{ type: 'group', translate: { x: -crop.x, y: -crop.y }, children: elements }] : elements,
  };
}

/** A mark's opacity, the tool's own default when it sets none, as an attribute only when it is not 1. */
function alphaOf(stroke: Stroke): { opacity?: number } {
  const opacity = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  return opacity === 1 ? {} : { opacity };
}

/** A filled shape's paint: its gradient when it has one that paints, otherwise its flat fill, otherwise none. */
function fillOf(stroke: Stroke, paint: PaintCheck): Paint | null {
  const stops = stroke.gradient ? normalizedStops(stroke.gradient) : null;
  if (stroke.gradient && stops) {
    const gradient: GradientPaint = { type: stroke.gradient.type, stops };
    if (stroke.gradient.type === 'linear') gradient.angle = stroke.gradient.angle ?? 0;
    return gradient;
  }
  return paint(stroke.fill);
}

/** Closed outlines as path data, their samples pruned as the export prunes them. */
function outlineData(contours: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): string {
  const out = new PathData();
  for (const contour of contours) {
    simplify(contour as { x: number; y: number }[], EXPORT_SIMPLIFY_EPSILON).forEach((p, i) =>
      i === 0 ? out.moveTo(p.x, p.y) : out.lineTo(p.x, p.y),
    );
    out.close();
  }
  return out.toString();
}

/**
 * A mark's elements with its effects on them: on the one element it draws as,
 * or on a group around the several, so the effects see the mark whole, as
 * the SVG's filter on the mark's outermost element does.
 */
function withEffects(elements: Element[], stroke: Stroke): Element[] {
  const effects = readEffects(stroke.effects);
  if (!effects || elements.length === 0) return elements;
  if (elements.length === 1) return [{ ...elements[0], effects }];
  return [{ type: 'group', effects, children: elements }];
}

/** One mark as the elements that draw it. */
function markElements(stroke: Stroke, paint: PaintCheck, scale: number): Element[] {
  if (isTextStroke(stroke)) return textElements(stroke, paint);
  if (isImageStroke(stroke)) return imageElements(stroke);
  if (stroke.tool === 'copic') return copicElements(stroke, paint);
  if (stroke.tool === 'pencil') return pencilElements(stroke, scale);
  if (activeProfile(stroke) && !stroke.noStroke) return profiledElements(stroke, paint);
  return pathElements(stroke, paint);
}

/** A pen or marker mark: a dot, or a round-capped path with its dash and its fill. */
function pathElements(stroke: Stroke, paint: PaintCheck): Element[] {
  const points = stroke.points;
  if (points.length === 0) return [];
  const alpha = alphaOf(stroke);
  if (points.length === 1) {
    return [{ type: 'circle', cx: points[0].x, cy: points[0].y, r: stroke.width / 2, fill: paint(stroke.color), ...alpha }];
  }
  const d = pathD(stroke);
  const fill = fillOf(stroke, paint);
  if (stroke.noStroke) return [{ type: 'path', d, fill, stroke: null, ...alpha }];
  const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
  return [
    {
      type: 'path',
      d,
      fill,
      stroke: paint(stroke.color),
      strokeWidth: stroke.width,
      lineCap: 'round',
      lineJoin: 'round',
      ...(dash.length > 0 ? { dash } : {}),
      ...alpha,
    },
  ];
}

/**
 * A profiled mark: the outline its profile makes, filled in the ink. With a
 * fill of its own as well, the fill goes under the outline, and the two are
 * one group so the opacity covers them together, as the export writes them.
 */
function profiledElements(stroke: Stroke, paint: PaintCheck): Element[] {
  const alpha = alphaOf(stroke);
  const outline: Element = { type: 'path', d: outlineData(profileOutline(profileInputOf(stroke))), fill: paint(stroke.color) };
  const fill = fillOf(stroke, paint);
  if (!fill || stroke.points.length < 3) return [{ ...outline, ...alpha }];
  return [{ type: 'group', ...alpha, children: [{ type: 'path', d: pathD(stroke), fill }, outline] }];
}

/** A Copic mark: the chisel nib's filled footprint. */
function copicElements(stroke: Stroke, paint: PaintCheck): Element[] {
  const polygons = copicNibPolygons(stroke);
  if (polygons.length === 0) return [];
  return [{ type: 'path', d: outlineData(polygons), fill: paint(stroke.color), fillRule: 'nonzero', ...alphaOf(stroke) }];
}

/**
 * A Pencil mark: its picture through the paper's tooth, its Smear passes
 * and all, worked out by the core (`pencilPicture`) at the scale the composition is drawn at, and
 * placed as an image on the page's own pixel grid - the canvas's pixels,
 * since the composition has no grain paint of its own.
 */
function pencilElements(stroke: Stroke, scale: number): Element[] {
  const region = pencilRegion(stroke, scale);
  if (!region) return [];
  const data = pencilPicture(stroke, region);
  return [
    {
      type: 'image',
      src: pngDataUrl(encodePng(data, region.width, region.height)),
      x: region.x / scale,
      y: region.y / scale,
      width: region.width / scale,
      height: region.height / scale,
      fit: 'fill',
      ...alphaOf(stroke),
    },
  ];
}

/** A text item: text set from its top, a line and a quarter apart, wrapped in its box when it has one. */
function textElements(stroke: Stroke, paint: PaintCheck): Element[] {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.text) return [];
  const box = stroke.textBoxWidth && stroke.textBoxWidth > 0 ? stroke.textBoxWidth : 0;
  return [
    {
      type: 'text',
      x: anchor.x,
      y: anchor.y,
      text: stroke.text,
      fontSize: stroke.fontSize ?? 24,
      fontFamily: stroke.fontFamily ?? DEFAULT_FONT_FAMILY,
      fill: paint(stroke.color),
      baseline: 'top',
      lineHeight: 1.25,
      ...(box > 0 ? { maxWidth: box } : {}),
      ...(typeof stroke.opacity === 'number' ? { opacity: stroke.opacity } : {}),
    },
  ];
}

/** A placed image stretched to its box; a link as a linked image, which the rasterizer follows only through its resolver. */
function imageElements(stroke: Stroke): Element[] {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.image) return [];
  const placed = {
    x: anchor.x,
    y: anchor.y,
    width: stroke.imageWidth ?? 100,
    height: stroke.imageHeight ?? 100,
    fit: 'fill' as const,
    ...(typeof stroke.opacity === 'number' ? { opacity: stroke.opacity } : {}),
  };
  if (stroke.link) return [{ type: 'image', src: stroke.link.href, link: true, ...placed }];
  return [{ type: 'image', src: stroke.image, ...placed }];
}

/** An eraser mark as the shape it clears: a dot, or a round-capped path its width. */
function eraserElements(stroke: Stroke): Element[] {
  const points = stroke.points;
  if (points.length === 0) return [];
  if (points.length === 1) return [{ type: 'circle', cx: points[0].x, cy: points[0].y, r: stroke.width / 2, fill: '#000' }];
  const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
  return [
    {
      type: 'path',
      d: pathD(stroke),
      fill: null,
      stroke: '#000',
      strokeWidth: stroke.width,
      lineCap: 'round',
      lineJoin: 'round',
      ...(dash.length > 0 ? { dash } : {}),
    },
  ];
}
