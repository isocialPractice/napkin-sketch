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
  type TextElement,
} from './types.js';
import { elementMatrix, IDENTITY, shapeCentre, type Matrix } from './geometry.js';
import { layoutText, transformText } from './font.js';

/** Options for {@link compositionToSvg}. */
export interface SvgOptions {
  /** Indent nested elements. On by default; off writes one long line. */
  pretty?: boolean;
  /** Decimal places coordinates are rounded to. Default 3. */
  precision?: number;
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

/** The paint and stroke attributes shared by every drawable element. */
function paintAttrs(el: CommonProps, precision: number): Record<string, string | number | undefined> {
  const fill = el.fill === undefined ? undefined : el.fill === null ? 'none' : el.fill;
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
  clipIds: Map<object, string>,
): Record<string, string | number | undefined> {
  const clipId = clipIds.get(el);
  const clip = typeof el.clip === 'string' ? el.clip : clipId;
  return {
    id: el.id,
    'data-name': el.name,
    transform: matrixAttr(elementMatrix(el, shapeCentre(el)), precision),
    'clip-path': clip ? `url(#${clip})` : undefined,
  };
}

/** Serialises a list of points as an SVG `points` attribute. */
function pointList(points: Array<{ x: number; y: number }>, precision: number): string {
  return points.map((p) => `${fmt(p.x, precision)},${fmt(p.y, precision)}`).join(' ');
}

/** Writes the `<text>` element, one `<tspan>` per laid-out line. */
function textMarkup(el: TextElement, precision: number, frame: string): string {
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
  clipIds: Map<object, string>,
  indent: string,
  pretty: boolean,
): string {
  if (el.visible === false) return '';
  const frame = attrs(frameAttrs(el, precision, clipIds));
  const paint = attrs(paintAttrs(el, precision));
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
        opacity: el.opacity !== undefined ? fmt(el.opacity, 4) : undefined,
      })}>${title}</image>${nl}`;
    }
    case 'group': {
      const inner = el.children
        .map((child) => elementMarkup(child, precision, clipIds, pretty ? `${indent}  ` : '', pretty))
        .join('');
      return `${indent}<g${frame}${paint}>${nl}${inner}${indent}</g>${nl}`;
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

/** Maps a `fit` onto the SVG attribute that means the same thing. */
function preserveAspectRatio(fit: string | undefined): string | undefined {
  switch (fit) {
    case 'contain':
      return 'xMidYMid meet';
    case 'cover':
      return 'xMidYMid slice';
    case 'none':
      return 'xMidYMid meet';
    case 'fill':
    default:
      return fit === 'fill' ? 'none' : undefined;
  }
}

/** Writes the `<clipPath>` definitions a composition references. */
function clipMarkup(
  clips: ClipDefinition[],
  precision: number,
  clipIds: Map<object, string>,
  pretty: boolean,
): string {
  if (clips.length === 0) return '';
  const nl = pretty ? '\n' : '';
  const body = clips
    .map((clip) => {
      const shapes = clip.shapes
        .map((shape) => elementMarkup(shape as Element, precision, clipIds, '', false))
        .join('');
      return `${pretty ? '    ' : ''}<clipPath${attrs({
        id: clip.id,
        clipPathUnits: 'userSpaceOnUse',
      })}>${shapes}</clipPath>${nl}`;
    })
    .join('');
  return `${pretty ? '  ' : ''}<defs>${nl}${body}${pretty ? '  ' : ''}</defs>${nl}`;
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

  const clipIds = new Map<object, string>();
  const clips: ClipDefinition[] = [...doc.clips];
  collectInlineClips(doc.elements, clips, clipIds, { next: 1 });

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
    .map((el) => elementMarkup(el, precision, clipIds, indent, pretty))
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>${nl}` +
    `${head}${nl}` +
    title +
    clipMarkup(clips, precision, clipIds, pretty) +
    background +
    body +
    `</svg>${nl}`
  );
}
