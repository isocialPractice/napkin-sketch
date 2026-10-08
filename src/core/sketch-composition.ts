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
import { markEffectPlan, markOpacity } from './appearance.js';
import { bindGeometry, drawnMark, drawnPart, geometryOf } from './geometry-effects.js';
import { activeEffects, untargeted, type Effect } from './effects.js';
import { isBlended } from './blend.js';
import { parseColor } from './graphic-design/color.js';
import type { CompositionDocument, Element, GradientPaint, Paint } from './graphic-design/types.js';
import { copicNibPolygons } from './nib.js';
import { activeProfile, profileInputOf, profileOutline } from './stroke-profile.js';
import { EXPORT_SIMPLIFY_EPSILON, PathData, pathD } from './svg-path.js';
import {
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
import { anchorsToPathData } from './path-data.js';
import { layoutType, typeSpans } from './type/layout.js';
import { withAccentPage } from './type/accents.js';
import { withoutMarkdownReveal } from './type/markdown-flow.js';
import { outlineSource, outlineText } from './type/outline.js';
import { faceStyle, type TypeFont } from './type/measure.js';

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
  return withoutMarkdownReveal(() => withAccentPage(sketch.background, () => compositionOf(sketch, options)));
}

/** The composition {@link sketchToComposition} makes, every Markdown block rendered, code accented for its paper. */
function compositionOf(sketch: Sketch, options: SketchCompositionOptions): CompositionDocument {
  // A layer's Warp bends what it holds: each mark is drawn as it is bent.
  bindGeometry(sketch);
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
    const read = activeEffects(layer.effects);
    const effects = read ? untargeted(read) : undefined;
    const own = {
      name: layer.name,
      ...(layer.opacity < 1 ? { opacity: layer.opacity } : {}),
      ...(effects ? { effects } : {}),
      ...(isBlended(layer.blend) ? { blend: layer.blend } : {}),
      ...(layer.group && layer.isolate ? { isolate: true } : {}),
    };
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
    const children = strokes.filter((s) => s.tool !== 'eraser').flatMap((s) => lowerMark(s, paint, options.scale ?? 1));
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
 * Elements with an effect list on them: on the one element there is, or on a
 * group around the several, so the effects see them whole, as the SVG's
 * filter on a mark's outermost element does.
 */
function withEffects(elements: Element[], effects: readonly Effect[]): Element[] {
  if (effects.length === 0 || elements.length === 0) return elements;
  if (elements.length === 1) return [{ ...elements[0], effects: untargeted(effects) }];
  return [{ type: 'group', effects: untargeted(effects), children: elements }];
}

/**
 * One mark as the elements that draw it, bent by its Warps, with its effects
 * (core/appearance.ts): on the mark as a whole, or - for a mark whose fill
 * and stroke each take effects of their own - as a group of its fill alone
 * and its stroke alone, each through its own effects, the whole mark's on the
 * group, and the mark's opacity on the group too, so the two parts take it as
 * one picture. The group is isolated, as the canvas composes the parts inside
 * the mark.
 */
function lowerMark(stroke: Stroke, paint: PaintCheck, scale: number): Element[] {
  const plan = markEffectPlan(stroke);
  // A mark 3D built is its faces, far first: as a group that takes the mark's
  // opacity and its effects once, when it has either.
  const faces = geometryOf(stroke)?.faces;
  if (faces) {
    const children = faces.flatMap((face) => markElements(face, paint, scale));
    if (!plan || children.length === 0) return children;
    const opacity = markOpacity(stroke);
    return [{ type: 'group', ...(opacity < 1 ? { opacity } : {}), ...(plan.object.length > 0 ? { effects: untargeted(plan.object) } : {}), children }];
  }
  // A mark a Warp bent whole is drawn as it is bent (core/geometry-effects.ts).
  if (!plan) return markElements(drawnMark(stroke), paint, scale);
  if (!plan.split) return withEffects(markElements(drawnMark(stroke), paint, scale), plan.object);
  const children = [
    ...withEffects(markElements(drawnPart(stroke, 'fill'), paint, scale), plan.fill),
    ...withEffects(markElements(drawnPart(stroke, 'stroke'), paint, scale), plan.stroke),
  ];
  if (children.length === 0) return [];
  const opacity = markOpacity(stroke);
  return [
    {
      type: 'group',
      // A part's own blended shadow mixes with the part under it, and no further.
      isolate: true,
      ...(opacity < 1 ? { opacity } : {}),
      ...(plan.object.length > 0 ? { effects: untargeted(plan.object) } : {}),
      children,
    },
  ];
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

/** Four corners as path data. */
function cornersD(corners: ReadonlyArray<{ x: number; y: number }>): string {
  return `${corners.map((p, k) => `${k === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('')}Z`;
}

/** A font as a text element's style: its family, size, weight and slant. */
function fontStyleOf(font: TypeFont): { fontFamily: string; fontSize: number; fontWeight: number; fontStyle: 'normal' | 'italic' } {
  const { weight, italic } = faceStyle(font.style);
  return { fontFamily: font.family, fontSize: font.size, fontWeight: weight, fontStyle: italic ? 'italic' : 'normal' };
}

/**
 * A text item as its shapes, when an outline source can draw them - a
 * headless render given its fonts' files (core/type/outline.ts). Otherwise,
 * as the type layout sets it with the built-in face - the face the
 * composition draws text in: its frame's paint, its shades and
 * highlights, each stretch in one style a text element on its baseline, each
 * turned or scaled character alone, turned and scaled about its origin (a
 * Path Typing slant left out), its list markers, and its underlines and
 * strikethroughs as thin filled shapes. A group, when the mark has an opacity
 * of its own, so what overlaps is not laid twice.
 */
function textElements(stroke: Stroke, paint: PaintCheck): Element[] {
  if (!stroke.points[0]) return [];
  // With fonts to draw it from - a headless render given its font files - a text is its shapes.
  const source = outlineSource();
  if (source) {
    const outlined = outlineText(stroke, layoutType(stroke, source.measure), source);
    if (outlined.marks) {
      const shapes = outlined.marks.flatMap(({ mark }) => markElements(mark, paint, 1));
      if (shapes.length === 0) return [];
      return typeof stroke.opacity === 'number' ? [{ type: 'group', opacity: stroke.opacity, children: shapes }] : shapes;
    }
  }
  const layout = layoutType(stroke);
  const out: Element[] = [];
  const frame = layout.frame;
  if (frame && (frame.fill || frame.stroke)) {
    out.push({
      type: 'path',
      d: anchorsToPathData(frame.anchors, true),
      fill: frame.fill ? paint(frame.fill) : null,
      stroke: frame.stroke ? paint(frame.stroke) : null,
      ...(frame.stroke ? { strokeWidth: frame.width ?? 1 } : {}),
    });
  }
  for (const highlight of layout.highlights) out.push({ type: 'path', d: cornersD(highlight.corners), fill: paint(highlight.color) });
  for (const span of typeSpans(layout)) {
    if (span.text.trim() === '') continue;
    if (span.plain) {
      out.push({
        type: 'text',
        x: span.x,
        y: span.y,
        text: span.text,
        ...fontStyleOf(span.font),
        ...(span.tracking !== 0 ? { letterSpacing: span.tracking } : {}),
        ...(span.wordSpace !== 0 ? { wordSpacing: span.wordSpace } : {}),
        fill: paint(span.color),
        baseline: 'alphabetic',
      });
      continue;
    }
    // A turn and two scales about its origin: the composition's own transform, which has no slant.
    const g = span.glyphs[0];
    const [a, b, c, d] = g.matrix;
    const sx = Math.hypot(a, b);
    const sy = sx > 0 ? (a * d - b * c) / sx : 1;
    const turn = (Math.atan2(b, a) * 180) / Math.PI;
    out.push({
      type: 'text',
      x: g.x,
      y: g.y,
      text: g.ch,
      ...fontStyleOf(g.font),
      fill: paint(g.color),
      baseline: 'alphabetic',
      origin: { x: g.x, y: g.y },
      ...(Math.abs(turn) > 1e-9 ? { rotate: turn } : {}),
      ...(Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9 ? { scale: { x: sx, y: sy } } : {}),
    });
  }
  for (const marker of layout.markers) {
    out.push({ type: 'text', x: marker.x, y: marker.y, text: marker.text, ...fontStyleOf(marker.font), fill: paint(marker.color), baseline: 'alphabetic' });
  }
  for (const line of layout.decorations) {
    const length = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
    if (length === 0) continue;
    const nx = (-(line.to.y - line.from.y) / length) * (line.thickness / 2);
    const ny = ((line.to.x - line.from.x) / length) * (line.thickness / 2);
    const corners = [
      { x: line.from.x + nx, y: line.from.y + ny },
      { x: line.to.x + nx, y: line.to.y + ny },
      { x: line.to.x - nx, y: line.to.y - ny },
      { x: line.from.x - nx, y: line.from.y - ny },
    ];
    out.push({ type: 'path', d: cornersD(corners), fill: paint(line.color) });
  }
  if (out.length === 0) return [];
  return typeof stroke.opacity === 'number' ? [{ type: 'group', opacity: stroke.opacity, children: out }] : out;
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
