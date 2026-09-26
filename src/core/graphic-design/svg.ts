/**
 * SVG back end for the graphic-design API.
 *
 * Writes the composition out as the shapes it was described with - a rect
 * stays a `<rect>`, a circle stays a `<circle>`, text stays live `<text>` - so
 * the file opens in a design tool as an editable document rather than as a
 * field of paths. Nothing here touches the DOM, so it runs in Node, in the
 * renderer, and in a browser bundle alike.
 *
 * Line breaking and alignment come from `font.ts`, the same table the
 * rasterizer measures with, so the two formats agree on where the text sits
 * even though each draws the glyphs its own way.
 */

import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_FONT,
  type ClipDefinition,
  type ClipShape,
  type CommonProps,
  type CompositionDocument,
  type Element,
  type GradientPaint,
  type TextElement,
  eraseShapes,
} from './types.js';
import { effectReach, filterRegion, readEffects, svgFilterMarkup } from '../effects.js';
import { apply, contourBounds, elementMatrix, flattenShape, IDENTITY, shapeCentre, type Matrix } from './geometry.js';
import { layoutText, transformText } from './font.js';
import { flatPaint, gradientAxis, isGradientPaint, sortedStops, type PaintBox } from './gradient.js';

/** Options for {@link compositionToSvg}. */
export interface SvgOptions {
  /** Indent nested elements. On by default; off writes one long line. */
  pretty?: boolean;
  /** Decimal places coordinates are rounded to. Default 3. */
  precision?: number;
}

/** The definitions elements refer to by id: a clip, a gradient fill, and a group's erase mask. */
interface Refs {
  clips: Map<object, string>;
  gradients: Map<object, string>;
  masks: Map<object, string>;
  filters: Map<object, string>;
}

/** Escapes the five characters that cannot appear raw in XML text or values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Rounds a coordinate and drops the trailing zeros a design tool would not write. */
function fmt(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(precision));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Serialises an attribute map, skipping anything undefined. */
function attrs(map: Record<string, string | number | undefined>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'string' ? escapeXml(v) : v}"`)
    .join('');
}

/** Writes a transform as the `matrix()` SVG understands, or nothing. */
function matrixAttr(m: Matrix, precision: number): string | undefined {
  if (m === IDENTITY) return undefined;
  const [a, b, c, d, e, f] = m;
  if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) return undefined;
  return `matrix(${[a, b, c, d, e, f].map((n) => fmt(n, precision)).join(' ')})`;
}

/**
 * The paint and stroke attributes shared by every drawable element. A
 * gradient fill refers to its `<linearGradient>` or `<radialGradient>` by
 * `gradientId`; without one - text, whose glyphs the rasterizer strokes - it
 * is written as its first color.
 */
function paintAttrs(el: CommonProps, precision: number, gradientId?: string): Record<string, string | number | undefined> {
  const flat = flatPaint(el.fill);
  const fill = gradientId ? `url(#${gradientId})` : flat === undefined ? undefined : flat === null ? 'none' : flat;
  const stroke = el.stroke === undefined || el.stroke === null ? undefined : el.stroke;
  return {
    fill,
    'fill-opacity': el.fillOpacity !== undefined ? fmt(el.fillOpacity, 4) : undefined,
    'fill-rule': el.fillRule,
    stroke,
    'stroke-width': stroke && el.strokeWidth !== undefined ? fmt(el.strokeWidth, precision) : undefined,
    'stroke-opacity': el.strokeOpacity !== undefined ? fmt(el.strokeOpacity, 4) : undefined,
    'stroke-linecap': el.lineCap,
    'stroke-linejoin': el.lineJoin,
    'stroke-dasharray': el.dash && el.dash.length > 0 ? el.dash.map((n) => fmt(n, precision)).join(' ') : undefined,
    'stroke-dashoffset': el.dashOffset !== undefined ? fmt(el.dashOffset, precision) : undefined,
    opacity: el.opacity !== undefined ? fmt(el.opacity, 4) : undefined,
  };
}

/** Identity, transform and clip attributes shared by every element. */
function frameAttrs(
  el: Element | ClipShape,
  precision: number,
  refs: Refs,
): Record<string, string | number | undefined> {
  const clipId = refs.clips.get(el);
  const clip = typeof el.clip === 'string' ? el.clip : clipId;
  return {
    id: el.id,
    'data-name': el.name,
    transform: matrixAttr(elementMatrix(el, shapeCentre(el)), precision),
    'clip-path': clip ? `url(#${clip})` : undefined,
    filter: refs.filters.has(el) ? `url(#${refs.filters.get(el)})` : undefined,
  };
}

/** Serialises a list of points as an SVG `points` attribute. */
function pointList(points: Array<{ x: number; y: number }>, precision: number): string {
  return points.map((p) => `${fmt(p.x, precision)},${fmt(p.y, precision)}`).join(' ');
}

/** Writes the `<text>` element, one `<tspan>` per laid-out line. */
/** A text element laid out into lines, as both renderers lay it out. */
function textLayout(el: TextElement): ReturnType<typeof layoutText> {
  const fontSize = el.fontSize ?? DEFAULT_FONT_SIZE;
  return layoutText(transformText(el.text, el.transform), {
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
}

function textMarkup(el: TextElement, precision: number, frame: string): string {
  const fontSize = el.fontSize ?? DEFAULT_FONT_SIZE;
  const layout = textLayout(el);

  const style = attrs({
    'font-family': el.fontFamily ?? DEFAULT_TEXT_FONT,
    'font-size': fmt(fontSize, precision),
    'font-weight': el.fontWeight === undefined ? undefined : String(el.fontWeight),
    'font-style': el.fontStyle,
    'letter-spacing': el.letterSpacing !== undefined ? fmt(el.letterSpacing, precision) : undefined,
    'word-spacing': el.wordSpacing !== undefined ? fmt(el.wordSpacing, precision) : undefined,
    'text-decoration': el.decoration && el.decoration !== 'none' ? el.decoration : undefined,
    'xml:space': 'preserve',
  });

  // Each line carries its own x, already aligned by the shared layout, so the
  // SVG does not depend on the viewer's own text-anchor arithmetic.
  const spans = layout.lines
    .map(
      (line) =>
        `<tspan${attrs({
          x: fmt(line.x, precision),
          y: fmt(line.y, precision),
          'word-spacing':
            line.wordSpacing > 0
              ? fmt((el.wordSpacing ?? 0) + line.wordSpacing, precision)
              : undefined,
        })}>${escapeXml(line.text)}</tspan>`,
    )
    .join('');

  return `<text${frame}${style}${attrs(paintAttrs(el, precision))}>${spans}</text>`;
}

/** Writes one element, recursing through groups. */
function elementMarkup(
  el: Element,
  precision: number,
  refs: Refs,
  indent: string,
  pretty: boolean,
): string {
  if (el.visible === false) return '';
  const frame = attrs(frameAttrs(el, precision, refs));
  const paint = attrs(paintAttrs(el, precision, refs.gradients.get(el)));
  const nl = pretty ? '\n' : '';

  switch (el.type) {
    case 'rect':
      return `${indent}<rect${frame}${attrs({
        x: fmt(el.x, precision),
        y: fmt(el.y, precision),
        width: fmt(el.width, precision),
        height: fmt(el.height, precision),
        rx: el.rx !== undefined ? fmt(el.rx, precision) : undefined,
        ry: el.ry !== undefined ? fmt(el.ry, precision) : undefined,
      })}${paint}/>${nl}`;
    case 'circle':
      return `${indent}<circle${frame}${attrs({
        cx: fmt(el.cx, precision),
        cy: fmt(el.cy, precision),
        r: fmt(el.r, precision),
      })}${paint}/>${nl}`;
    case 'ellipse':
      return `${indent}<ellipse${frame}${attrs({
        cx: fmt(el.cx, precision),
        cy: fmt(el.cy, precision),
        rx: fmt(el.rx, precision),
        ry: fmt(el.ry, precision),
      })}${paint}/>${nl}`;
    case 'triangle':
    case 'polygon': {
      const points = el.type === 'polygon' ? el.points : el.points ?? triangleFallback(el);
      return `${indent}<polygon${frame}${attrs({ points: pointList(points, precision) })}${paint}/>${nl}`;
    }
    case 'polyline':
      return `${indent}<polyline${frame}${attrs({ points: pointList(el.points, precision) })}${paint}/>${nl}`;
    case 'line':
      return `${indent}<line${frame}${attrs({
        x1: fmt(el.x1, precision),
        y1: fmt(el.y1, precision),
        x2: fmt(el.x2, precision),
        y2: fmt(el.y2, precision),
      })}${paint}/>${nl}`;
    case 'path':
      return `${indent}<path${frame}${attrs({ d: el.d })}${paint}/>${nl}`;
    case 'text':
      return `${indent}${textMarkup(el, precision, frame)}${nl}`;
    case 'image': {
      const box = imageBox(el);
      const title = el.alt ? `<title>${escapeXml(el.alt)}</title>` : '';
      return `${indent}<image${frame}${attrs({
        x: fmt(box.x, precision),
        y: fmt(box.y, precision),
        width: fmt(box.width, precision),
        height: fmt(box.height, precision),
        preserveAspectRatio: preserveAspectRatio(el.fit),
        href: el.src,
        'xlink:href': el.src,
        'data-link': el.link ? 'true' : undefined,
        opacity: el.opacity !== undefined ? fmt(el.opacity, 4) : undefined,
      })}>${title}</image>${nl}`;
    }
    case 'group': {
      const inner = el.children
        .map((child) => elementMarkup(child, precision, refs, pretty ? `${indent}  ` : '', pretty))
        .join('');
      const mask = refs.masks.get(el);
      return `${indent}<g${frame}${paint}${attrs({ mask: mask ? `url(#${mask})` : undefined })}>${nl}${inner}${indent}</g>${nl}`;
    }
    default:
      return '';
  }
}

/** The three corners a box-form triangle resolves to. */
function triangleFallback(el: Extract<Element, { type: 'triangle' }>): Array<{ x: number; y: number }> {
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  switch (el.variant) {
    case 'down':
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w / 2, y: y + h },
      ];
    case 'left':
      return [
        { x, y: y + h / 2 },
        { x: x + w, y },
        { x: x + w, y: y + h },
      ];
    case 'right':
      return [
        { x, y },
        { x: x + w, y: y + h / 2 },
        { x, y: y + h },
      ];
    default:
      return [
        { x: x + w / 2, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
  }
}

/** The box an image is drawn in. `fit` is left to `preserveAspectRatio`. */
function imageBox(el: Extract<Element, { type: 'image' }>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/**
 * Maps a `fit` onto the SVG attribute that means the same thing. No `fit` is
 * `fill`, the documented default and what the rasterizer draws, so it is
 * written as `none` too: left out, SVG's own default would letterbox an image
 * the PNG stretches.
 */
function preserveAspectRatio(fit: string | undefined): string {
  switch (fit) {
    case 'contain':
      return 'xMidYMid meet';
    case 'cover':
      return 'xMidYMid slice';
    case 'none':
      return 'xMidYMid meet';
    case 'fill':
    default:
      return 'none';
  }
}

/** The `<clipPath>` definitions a composition references. */
function clipDefs(clips: ClipDefinition[], precision: number, refs: Refs): string[] {
  return clips.map((clip) => {
    const shapes = clip.shapes.map((shape) => elementMarkup(shape as Element, precision, refs, '', false)).join('');
    return `<clipPath${attrs({ id: clip.id, clipPathUnits: 'userSpaceOnUse' })}>${shapes}</clipPath>`;
  });
}

/**
 * A gradient paint server for an element whose box, in its own coordinates,
 * is `box`: in user space, so a linear gradient keeps its angle on a box that
 * is not square, where `objectBoundingBox` would skew it.
 */
function gradientMarkup(paint: GradientPaint, box: PaintBox, id: string, precision: number): string {
  const stops = sortedStops(paint)
    .map((stop) => `<stop${attrs({ offset: `${fmt(stop.offset * 100, 3)}%`, 'stop-color': stop.color })}/>`)
    .join('');
  const axis = gradientAxis(paint, box);
  if (axis.type === 'radial') {
    return `<radialGradient${attrs({
      id,
      gradientUnits: 'userSpaceOnUse',
      cx: fmt(axis.cx, precision),
      cy: fmt(axis.cy, precision),
      r: fmt(axis.r, precision),
    })}>${stops}</radialGradient>`;
  }
  return `<linearGradient${attrs({
    id,
    gradientUnits: 'userSpaceOnUse',
    x1: fmt(axis.x1, precision),
    y1: fmt(axis.y1, precision),
    x2: fmt(axis.x2, precision),
    y2: fmt(axis.y2, precision),
  })}>${stops}</linearGradient>`;
}

/** How far a mask's white cover reaches either way from the origin, in its group's units. */
const MASK_REACH = 100000;

/**
 * The mask a group's erase shapes make: white wherever the group shows, and
 * the shapes in black where it does not. Their own colors and opacity do not
 * count: an erase shape clears all the way.
 */
function maskMarkup(shapes: readonly Element[], id: string, precision: number, refs: Refs): string {
  const body = eraseShapes(shapes)
    .map((shape) => elementMarkup(shape, precision, refs, '', false))
    .join('');
  const cover = { x: -MASK_REACH, y: -MASK_REACH, width: 2 * MASK_REACH, height: 2 * MASK_REACH };
  return `<mask${attrs({ id, maskUnits: 'userSpaceOnUse', ...cover })}><rect${attrs({ ...cover, fill: '#fff' })}/>${body}</mask>`;
}

/** Finds the gradient fills and erase masks a tree of elements needs, and writes their definitions. */
function collectPaintDefs(
  elements: readonly Element[],
  refs: Refs,
  defs: string[],
  counter: { next: number },
  precision: number,
): void {
  for (const el of elements) {
    if (isGradientPaint(el.fill) && el.type !== 'text' && el.type !== 'image' && el.type !== 'group') {
      const flat = flattenShape(el);
      const box = contourBounds([...flat.closed, ...flat.open]);
      if (box) {
        const id = `gradient-${counter.next++}`;
        refs.gradients.set(el, id);
        defs.push(gradientMarkup(el.fill, box, id, precision));
      }
    }
    if (el.type === 'group') {
      collectPaintDefs(el.children, refs, defs, counter, precision);
      if (el.erase && el.erase.length > 0) {
        const id = `erase-${counter.next++}`;
        refs.masks.set(el, id);
        defs.push(maskMarkup(el.erase, id, precision, refs));
      }
    }
  }
}

/** A box by its edges. */
type Edges = { minX: number; minY: number; maxX: number; maxY: number };

const grown = (box: Edges, by: number): Edges => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by });

const joined = (a: Edges, b: Edges): Edges => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

/** The box a box covers once transformed. */
function placedBox(box: Edges, m: Matrix): Edges {
  const corners = [
    apply(m, { x: box.minX, y: box.minY }),
    apply(m, { x: box.maxX, y: box.minY }),
    apply(m, { x: box.minX, y: box.maxY }),
    apply(m, { x: box.maxX, y: box.maxY }),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

/**
 * An element's box in its own coordinates - its geometry as written, before
 * its own transform, which is the space its filter region is read in - with
 * room for its outline and for what a child's own effects reach. Text gets a
 * font size of room around the measured lines, since a viewer sets it in a
 * real face. Null for an element with nothing to box.
 */
function localBox(el: Element): Edges | null {
  if (el.visible === false) return null;
  switch (el.type) {
    case 'group': {
      let box: Edges | null = null;
      for (const child of el.children) {
        const inner = localBox(child);
        if (!inner) continue;
        const effects = readEffects(child.effects);
        const placed = placedBox(effects ? grown(inner, effectReach(effects)) : inner, elementMatrix(child, shapeCentre(child)));
        box = box ? joined(box, placed) : placed;
      }
      return box;
    }
    case 'text': {
      const lines = textLayout(el).lines;
      if (lines.length === 0) return null;
      const size = el.fontSize ?? DEFAULT_FONT_SIZE;
      return {
        minX: Math.min(...lines.map((line) => line.x)) - size,
        minY: Math.min(...lines.map((line) => line.y)) - 2 * size,
        maxX: Math.max(...lines.map((line) => line.x + line.width)) + size,
        maxY: Math.max(...lines.map((line) => line.y)) + size,
      };
    }
    case 'image':
      return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
    default: {
      const flat = flattenShape(el);
      const box = contourBounds([...flat.closed, ...flat.open]);
      if (!box) return null;
      // A miter can stand out past the half width an outline covers, so a whole width is room enough.
      const outline = el.stroke ? el.strokeWidth ?? 1 : 0;
      return grown({ minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, outline);
    }
  }
}

/**
 * Writes a filter for each element that carries effects. Elements with the
 * same effects over the same region share one; the region is the element's
 * own box grown by as far as the effects reach, in its own user space, so a
 * small element and a wide shadow both fit it.
 */
function collectFilterDefs(
  elements: readonly Element[],
  refs: Refs,
  defs: string[],
  seen: Map<string, string>,
  counter: { next: number },
  precision: number,
): void {
  for (const el of elements) {
    const effects = readEffects(el.effects);
    const box = effects ? localBox(el) : null;
    if (effects && box) {
      const region = filterRegion(box, effects);
      const format = (value: number): string => fmt(value, precision);
      const key = JSON.stringify([effects, [region.x, region.y, region.width, region.height].map(format)]);
      let id = seen.get(key);
      if (!id) {
        id = `effect-${counter.next++}`;
        seen.set(key, id);
        defs.push(svgFilterMarkup(effects, id, region, format));
      }
      refs.filters.set(el, id);
    }
    if (el.type === 'group') collectFilterDefs(el.children, refs, defs, seen, counter, precision);
  }
}

/**
 * Collects the inline clip shapes an element tree carries and gives each one a
 * generated id, so an inline `clip: { type: 'circle', ... }` becomes a real
 * `<clipPath>` without the caller having to name it.
 */
function collectInlineClips(
  elements: Element[],
  clips: ClipDefinition[],
  clipIds: Map<object, string>,
  counter: { next: number },
): void {
  for (const el of elements) {
    if (el.clip && typeof el.clip !== 'string') {
      const id = `clip-inline-${counter.next++}`;
      clipIds.set(el, id);
      clips.push({ id, shapes: [el.clip] });
    }
    if (el.type === 'group') collectInlineClips(el.children, clips, clipIds, counter);
  }
}

/**
 * Renders a composition as an SVG document.
 *
 * The root carries a `viewBox` in composition units and a width and height in
 * the composition's own unit, so a page described in millimetres prints at the
 * size it says while every coordinate inside stays the number that was written.
 */
export function compositionToSvg(doc: CompositionDocument, options: SvgOptions = {}): string {
  const precision = options.precision ?? 3;
  const pretty = options.pretty !== false;
  const nl = pretty ? '\n' : '';
  const indent = pretty ? '  ' : '';

  const refs: Refs = { clips: new Map(), gradients: new Map(), masks: new Map(), filters: new Map() };
  const clips: ClipDefinition[] = [...doc.clips];
  collectInlineClips(doc.elements, clips, refs.clips, { next: 1 });
  const paintDefs: string[] = [];
  collectPaintDefs(doc.elements, refs, paintDefs, { next: 1 }, precision);
  collectFilterDefs(doc.elements, refs, paintDefs, new Map(), { next: 1 }, precision);
  const defs = [...clipDefs(clips, precision, refs), ...paintDefs];
  const defsMarkup =
    defs.length > 0 ? `${indent}<defs>${nl}${defs.map((def) => `${pretty ? '    ' : ''}${def}${nl}`).join('')}${indent}</defs>${nl}` : '';

  const size =
    doc.units === 'px'
      ? { width: fmt(doc.width, precision), height: fmt(doc.height, precision) }
      : { width: `${fmt(doc.width, precision)}${doc.units}`, height: `${fmt(doc.height, precision)}${doc.units}` };

  const head = `<svg${attrs({
    xmlns: 'http://www.w3.org/2000/svg',
    'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    id: doc.id,
    width: size.width,
    height: size.height,
    viewBox: `0 0 ${fmt(doc.width, precision)} ${fmt(doc.height, precision)}`,
  })}>`;

  const title = doc.title ? `${indent}<title>${escapeXml(doc.title)}</title>${nl}` : '';
  const background = doc.background
    ? `${indent}<rect${attrs({
        width: fmt(doc.width, precision),
        height: fmt(doc.height, precision),
        fill: doc.background,
        'data-name': 'background',
      })}/>${nl}`
    : '';
  const body = doc.elements
    .map((el) => elementMarkup(el, precision, refs, indent, pretty))
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>${nl}` +
    `${head}${nl}` +
    title +
    defsMarkup +
    background +
    body +
    `</svg>${nl}`
  );
}
