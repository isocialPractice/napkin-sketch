/**
 * SVG import (browser-only; relies on DOM SVG geometry APIs).
 *
 * Converts an SVG document into layered napkin-sketch strokes:
 * - Top-level `<g>` elements become layers (name from `data-name`,
 *   `inkscape:label`, or `id`; group `opacity` becomes layer opacity), so
 *   napkin-sketch exports and Inkscape/Illustrator layer conventions both
 *   round-trip. Loose top-level elements are gathered into synthetic layers
 *   that preserve document z-order.
 * - napkin-sketch exports restore exactly: `data-tool`/`data-i` attributes
 *   recover each mark's tool and paint order, and eraser strokes are read
 *   back out of the layer's `<mask>`.
 * - Generic geometry (`path`, `line`, `polyline`, `polygon`, `rect`,
 *   `circle`, `ellipse`) is sampled along its length with transforms applied,
 *   so beziers and shapes become editable freehand strokes. Fill-only shapes
 *   import as thin outlines. `<text>` becomes text items and `<image>`
 *   becomes placed image items.
 */

import {
  DEFAULT_FONT_FAMILY,
  createId,
  type Stroke,
  type Tool,
} from '../core/types.js';

/** One layer recovered from an imported SVG. */
export interface ImportedLayer {
  name: string;
  opacity: number;
  strokes: Stroke[];
}

/** Result of parsing an SVG document. */
export interface ImportedSvg {
  width: number;
  height: number;
  /** Full-canvas background rect color, when one was detected (and skipped). */
  background?: string;
  layers: ImportedLayer[];
}

const GEOMETRY_TAGS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const NAPKIN_TOOLS = new Set<Tool>(['pen', 'marker', 'eraser', 'text', 'image']);

/** Longest sampled polyline per imported path. */
const MAX_SAMPLES = 300;

/** A stroke plus its recovered paint order (from `data-i`, else document order). */
interface OrderedStroke {
  order: number;
  stroke: Stroke;
}

/**
 * Parses an SVG string into layered strokes.
 *
 * The document is briefly mounted (hidden) so `getTotalLength`,
 * `getPointAtLength`, `getScreenCTM`, and computed styles are available.
 *
 * @throws Error when the text is not a valid SVG document.
 */
export function importSvg(svgText: string): ImportedSvg {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || !(parsed.documentElement instanceof SVGSVGElement)) {
    throw new Error('Not a valid SVG document.');
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  const root = document.importNode(parsed.documentElement, true);
  host.appendChild(root);
  document.body.appendChild(host);

  try {
    const { width, height } = svgSize(root);
    const result: ImportedSvg = { width, height, layers: [] };

    // Group direct children into layer buckets, preserving z-order.
    let docOrder = 0;
    let syntheticCount = 0;
    let groupCount = 0;
    for (const child of Array.from(root.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'title' || tag === 'metadata' || tag === 'desc' || tag === 'style') {
        continue;
      }

      // Skip a full-canvas background rect (napkin exports and many tools emit one).
      if (
        result.layers.length === 0 &&
        tag === 'rect' &&
        !child.hasAttribute('data-tool') &&
        coversCanvas(child, width, height)
      ) {
        result.background = child.getAttribute('fill') ?? undefined;
        continue;
      }

      if (tag === 'g') {
        groupCount += 1;
        const items: OrderedStroke[] = [];
        collectStrokes(child as SVGGElement, root, items, () => docOrder++);
        collectMaskErasers(child as SVGGElement, root, items, () => docOrder++);
        result.layers.push({
          name: layerName(child, groupCount),
          opacity: clamp01(Number(child.getAttribute('opacity') ?? 1)),
          strokes: sortByOrder(items),
        });
        continue;
      }

      // Loose top-level element: append to the current synthetic layer, or
      // start a new one so ordering relative to groups is preserved.
      let bucket = result.layers[result.layers.length - 1];
      if (!bucket || !bucket.name.startsWith('Imported')) {
        syntheticCount += 1;
        bucket = {
          name: syntheticCount === 1 ? 'Imported' : `Imported ${syntheticCount}`,
          opacity: 1,
          strokes: [],
        };
        result.layers.push(bucket);
      }
      const items: OrderedStroke[] = [];
      elementToStrokes(child as SVGElement, root, items, () => docOrder++);
      bucket.strokes.push(...sortByOrder(items));
    }

    result.layers = result.layers.filter((l) => l.strokes.length > 0);
    if (result.layers.length === 0) {
      throw new Error('No importable content found in the SVG.');
    }
    return result;
  } finally {
    host.remove();
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function sortByOrder(items: OrderedStroke[]): Stroke[] {
  return items.sort((a, b) => a.order - b.order).map((i) => i.stroke);
}

function layerName(group: Element, index: number): string {
  return (
    group.getAttribute('data-name') ||
    group.getAttribute('inkscape:label') ||
    group.getAttribute('id') ||
    `Layer ${index}`
  );
}

function svgSize(root: SVGSVGElement): { width: number; height: number } {
  const width = parseFloat(root.getAttribute('width') ?? '');
  const height = parseFloat(root.getAttribute('height') ?? '');
  if (width > 0 && height > 0) return { width, height };
  const viewBox = root.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  return { width: 1280, height: 800 };
}

function coversCanvas(el: Element, width: number, height: number): boolean {
  const x = parseFloat(el.getAttribute('x') ?? '0');
  const y = parseFloat(el.getAttribute('y') ?? '0');
  const w = parseFloat(el.getAttribute('width') ?? '0');
  const h = parseFloat(el.getAttribute('height') ?? '0');
  return x <= 0 && y <= 0 && w >= width * 0.999 && h >= height * 0.999;
}

/** Matrix mapping an element's user space into the root SVG's user space. */
function matrixToRoot(el: SVGGraphicsElement, root: SVGSVGElement): DOMMatrix {
  const rootCtm = root.getScreenCTM();
  const elCtm = el.getScreenCTM();
  if (!rootCtm || !elCtm) return new DOMMatrix();
  return rootCtm.inverse().multiply(elCtm);
}

function applyMatrix(m: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Average scale factor of a matrix, used to scale stroke widths. */
function matrixScale(m: DOMMatrix): number {
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Recursively converts a group's visible descendants into strokes. */
function collectStrokes(
  group: SVGGElement,
  root: SVGSVGElement,
  out: OrderedStroke[],
  nextOrder: () => number,
): void {
  for (const child of Array.from(group.children)) {
    if (child.tagName.toLowerCase() === 'g') {
      collectStrokes(child as SVGGElement, root, out, nextOrder);
    } else {
      elementToStrokes(child as SVGElement, root, out, nextOrder);
    }
  }
}

/** Recovers eraser strokes from a napkin-sketch layer mask, if present. */
function collectMaskErasers(
  group: SVGGElement,
  root: SVGSVGElement,
  out: OrderedStroke[],
  nextOrder: () => number,
): void {
  const ref = /url\(#([^)]+)\)/.exec(group.getAttribute('mask') ?? '');
  if (!ref) return;
  const mask = root.querySelector(`mask[id="${ref[1]}"]`);
  if (!mask) return;
  for (const child of Array.from(mask.children)) {
    // The full-canvas white rect is the mask's "show everything" base.
    if (child.tagName.toLowerCase() === 'rect' && !child.hasAttribute('data-tool')) continue;
    elementToStrokes(child as SVGElement, root, out, nextOrder, 'eraser');
  }
}

/** Converts one SVG element into zero or more ordered strokes. */
function elementToStrokes(
  el: SVGElement,
  root: SVGSVGElement,
  out: OrderedStroke[],
  nextOrder: () => number,
  forceTool?: Tool,
): void {
  const tag = el.tagName.toLowerCase();
  const orderAttr = Number(el.getAttribute('data-i'));
  const order = Number.isFinite(orderAttr) ? orderAttr : nextOrder() + 1_000_000;

  if (tag === 'text') {
    const stroke = textToStroke(el as SVGTextElement, root);
    if (stroke) out.push({ order, stroke });
    return;
  }
  if (tag === 'image') {
    const stroke = imageToStroke(el as SVGImageElement, root);
    if (stroke) out.push({ order, stroke });
    return;
  }
  if (!GEOMETRY_TAGS.has(tag) || !(el instanceof SVGGeometryElement)) return;

  const matrix = matrixToRoot(el, root);
  const style = getComputedStyle(el);
  const dataTool = el.getAttribute('data-tool') as Tool | null;
  const tool: Tool =
    forceTool ?? (dataTool && NAPKIN_TOOLS.has(dataTool) && dataTool !== 'text' && dataTool !== 'image'
      ? dataTool
      : 'pen');

  // Stroke paint wins; fill-only shapes import as thin outlines.
  const hasStroke = style.stroke !== 'none' && style.stroke !== '';
  const hasFill = style.fill !== 'none' && style.fill !== '';
  if (!hasStroke && !hasFill) return;
  const color = tool === 'eraser' ? '#000000' : hasStroke ? style.stroke : style.fill;
  const width = hasStroke
    ? Math.max(0.5, (parseFloat(style.strokeWidth) || 1) * matrixScale(matrix))
    : 1;
  const opacity = clamp01(
    Number(style.opacity || 1) * Number(hasStroke ? style.strokeOpacity || 1 : style.fillOpacity || 1),
  );

  // Exact round-trip for napkin exports: single-point dots are circles.
  if (dataTool && tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx') ?? '0');
    const cy = parseFloat(el.getAttribute('cy') ?? '0');
    const r = parseFloat(el.getAttribute('r') ?? '1');
    out.push({
      order,
      stroke: makeStroke(tool, color, r * 2 * matrixScale(matrix), [applyMatrix(matrix, cx, cy)], opacity),
    });
    return;
  }

  // Exact round-trip for napkin exports: M/L polyline paths parse directly.
  if (dataTool && tag === 'path') {
    const points = parsePolylineD(el.getAttribute('d') ?? '');
    if (points) {
      out.push({
        order,
        stroke: makeStroke(tool, color, width, points.map((p) => applyMatrix(matrix, p.x, p.y)), opacity),
      });
      return;
    }
  }

  // Generic geometry: sample evenly along the element's length.
  let length = 0;
  try {
    length = el.getTotalLength();
  } catch {
    return;
  }
  if (!Number.isFinite(length) || length <= 0) return;
  const samples = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(length / 2)));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = el.getPointAtLength((length * i) / samples);
    points.push(applyMatrix(matrix, p.x, p.y));
  }
  out.push({ order, stroke: makeStroke(tool, color, width, points, opacity) });
}

/** Parses a path `d` made only of absolute M/L pairs (napkin export format). */
function parsePolylineD(d: string): { x: number; y: number }[] | null {
  if (!d || /[^MLml\s,\-.\d]/.test(d)) return null;
  if (/[ml]/.test(d)) return null; // relative commands: fall back to sampling
  const points: { x: number; y: number }[] = [];
  const matches = d.match(/-?\d*\.?\d+/g);
  if (!matches || matches.length < 2 || matches.length % 2 !== 0) return null;
  for (let i = 0; i < matches.length; i += 2) {
    points.push({ x: Number(matches[i]), y: Number(matches[i + 1]) });
  }
  return points;
}

function makeStroke(
  tool: Tool,
  color: string,
  width: number,
  points: { x: number; y: number }[],
  opacity: number,
): Stroke {
  return {
    id: createId('st'),
    tool: tool === 'image' || tool === 'text' ? 'pen' : tool,
    color,
    width,
    points: points.map((p) => ({ x: p.x, y: p.y, pressure: 0.5 })),
    opacity: opacity < 1 ? opacity : undefined,
    sharpened: true,
  };
}

function textToStroke(el: SVGTextElement, root: SVGSVGElement): Stroke | null {
  const matrix = matrixToRoot(el, root);
  const style = getComputedStyle(el);
  const size = parseFloat(style.fontSize) || 24;
  const x = parseFloat(el.getAttribute('x') ?? '0');
  const rawY = parseFloat(el.getAttribute('y') ?? '0');
  // napkin exports anchor at the glyph top (hanging); generic SVG text
  // anchors at the baseline.
  const hanging =
    el.getAttribute('dominant-baseline') === 'hanging' || style.dominantBaseline === 'hanging';
  const y = hanging ? rawY : rawY - size * 0.8;

  const tspans = Array.from(el.querySelectorAll('tspan'));
  const lines =
    tspans.length > 0
      ? tspans.map((t) => t.textContent ?? '')
      : (el.textContent ?? '').split('\n');
  const text = lines.join('\n').trimEnd();
  if (!text) return null;

  const anchor = applyMatrix(matrix, x, y);
  const opacity = clamp01(Number(style.opacity || 1) * Number(style.fillOpacity || 1));
  return {
    id: createId('tx'),
    tool: 'text',
    color: style.fill !== 'none' && style.fill ? style.fill : '#1f2328',
    width: 1,
    points: [{ x: anchor.x, y: anchor.y, pressure: 0.5 }],
    text,
    fontSize: size * matrixScale(matrix),
    fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
    opacity: opacity < 1 ? opacity : undefined,
    sharpened: true,
  };
}

function imageToStroke(el: SVGImageElement, root: SVGSVGElement): Stroke | null {
  const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
  if (!href || !href.startsWith('data:image/')) return null;
  const matrix = matrixToRoot(el, root);
  const scale = matrixScale(matrix);
  const x = parseFloat(el.getAttribute('x') ?? '0');
  const y = parseFloat(el.getAttribute('y') ?? '0');
  const w = parseFloat(el.getAttribute('width') ?? '100');
  const h = parseFloat(el.getAttribute('height') ?? '100');
  const anchor = applyMatrix(matrix, x, y);
  const style = getComputedStyle(el);
  const opacity = clamp01(Number(style.opacity || 1));
  return {
    id: createId('im'),
    tool: 'image',
    color: '#1f2328',
    width: 1,
    points: [{ x: anchor.x, y: anchor.y, pressure: 0.5 }],
    image: href,
    imageWidth: w * scale,
    imageHeight: h * scale,
    opacity: opacity < 1 ? opacity : undefined,
    sharpened: true,
  };
}
