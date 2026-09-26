/**
 * SVG import (browser-only; relies on DOM SVG geometry APIs).
 *
 * Converts an SVG document into layered napkin-sketch strokes:
 * - `<g>` elements become layers (name from `data-name`, `inkscape:label`, or
 *   `id`, falling back to the `<Group>` placeholder when unnamed; group
 *   `opacity` becomes layer opacity), so napkin-sketch exports and
 *   Inkscape/Illustrator layer conventions both round-trip. Nested `<g>`
 *   elements become nested layer groups.
 * - Named geometry becomes its own layer. Illustrator (and any editor that
 *   writes object names into `id`) exports a named object as a loose
 *   `<path id="outline">` beside its sibling groups; those keep their name and
 *   their z-order position instead of being flattened onto the parent layer.
 * - Unnamed geometry stays on its group's layer. A run of unnamed siblings
 *   next to named ones collects into one tag-named layer (`path`, `line`, …)
 *   that holds its document position; pass `unnamedElements: 'split'` to give
 *   every unnamed element a layer of its own.
 * - napkin-sketch exports restore exactly: `data-tool`/`data-i` attributes
 *   recover each mark's tool and paint order, and eraser strokes are read
 *   back out of the layer's `<mask>`.
 * - Generic geometry keeps its Bézier structure. Path data (every command,
 *   absolute or relative: `M L H V C S Q T A Z`) is parsed into cubic anchors
 *   - quadratics are degree-elevated exactly, arcs become the standard cubic
 *   approximation - and `rect`, `circle`, `ellipse`, `line`, `polyline`, and
 *   `polygon` are built from their attributes, so a curve that arrives as
 *   four numbers leaves as four numbers instead of hundreds of samples. Each
 *   subpath becomes one editable vector stroke, with its transform applied
 *   to the anchors. Fill-only shapes import as fill-only (no outline). Path
 *   data the parser cannot read is sampled along its length as a fallback.
 *   `<text>` becomes text items and `<image>` becomes placed image items.
 */

import {
  DEFAULT_FONT_FAMILY,
  createId,
  type Gradient,
  type GradientStop,
  type Stroke,
  type Tool,
  type VectorAnchor,
} from '../core/types.js';
import { normalizeGradient } from '../core/serialize.js';
import { readEffects, type Effect } from '../core/effects.js';
import { linkKind, linkName, linkPlaceholder } from '../core/link.js';
import { elementSubpaths, parsePathD, sampleAnchors, type ParsedSubpath } from '../core/path-data.js';

// The DOM-free path-data parsers, re-exported for callers that reach them
// through the importer.
export { parsePathD, parseVectorD, type ParsedSubpath } from '../core/path-data.js';

/** One layer recovered from an imported SVG; nested groups become children. */
export interface ImportedLayer {
  name: string;
  opacity: number;
  strokes: Stroke[];
  /** Child layers recovered from nested `<g>` groups (expand/collapse in the panel). */
  children?: ImportedLayer[];
  /** Effects napkin-sketch wrote on the layer's group as `data-effects`. */
  effects?: Effect[];
}

/** Result of parsing an SVG document. */
export interface ImportedSvg {
  width: number;
  height: number;
  /** Full-canvas background rect color, when one was detected (and skipped). */
  background?: string;
  layers: ImportedLayer[];
}

/** Tuning for {@link importSvg}. */
export interface SvgImportOptions {
  /**
   * How geometry that carries no name is imported.
   * - `'merge'` (default): consecutive unnamed siblings share one layer, and a
   *   group holding nothing but unnamed geometry stays a single layer.
   * - `'split'`: every unnamed element becomes its own tag-named layer,
   *   mirroring the source markup exactly (verbose on stroke-heavy artwork).
   */
  unnamedElements?: 'merge' | 'split';
  /**
   * Name for top-level runs of unnamed geometry (a document with no names at
   * all arrives as a single layer under this name). Callers pass the source
   * file's stem; defaults to `'Imported'`.
   */
  unnamedRootName?: string;
}

const GEOMETRY_TAGS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const NAPKIN_TOOLS = new Set<Tool>(['pen', 'marker', 'copic', 'eraser', 'text', 'image']);

/** Non-drawing children skipped wherever elements are walked. */
const NON_CONTENT_TAGS = new Set(['defs', 'title', 'metadata', 'desc', 'style']);

/**
 * Id stems editors auto-generate (`path4521`, `g830`); an id built from one of
 * these plus digits names nothing and is treated as unnamed.
 */
const AUTO_ID_STEMS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'g',
  'text',
  'tspan',
  'image',
  'use',
  'svg',
  'defs',
  'mask',
  'clippath',
  'symbol',
  'marker',
]);

// Geometry with no id (or only an editor-generated one) is labeled with its
// tag name, so an unnamed <line> imports as a "line" layer and an unnamed
// <rect> as "rect" - the reader sees exactly what the source markup held.

/** Longest sampled polyline per imported path (length-sampling fallback). */
const MAX_SAMPLES = 1200;

/**
 * Thinnest outline an import produces. Artwork authored in small user units
 * (an icon in a 24-unit viewBox, a sprite in a 43-unit one) legitimately
 * carries widths well under a pixel; clamping them up would fatten every
 * line relative to the shapes it outlines.
 */
const MIN_IMPORT_WIDTH = 0.1;

/**
 * napkin's default ink, the colour a new sketch draws in. A paint server that
 * resolves to no colour at all is drawn in it, so it arrives visibly rather
 * than not at all.
 */
const DEFAULT_INK = '#1f2328';

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
export function importSvg(svgText: string, options: SvgImportOptions = {}): ImportedSvg {
  const splitUnnamed = options.unnamedElements === 'split';
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

    // Every top-level group imports as a layer group: a named one (e.g.
    // <g id="circles">) under its name, an anonymous one as "<Group>" - no
    // wrapper is ever flattened away, so the imported stack always mirrors
    // the document. Top-level loose geometry collects under the file's name.
    // Group direct children into layer buckets, preserving z-order.
    let docOrder = 0;
    const nextOrder = () => docOrder++;
    const top = contentChildren(root).filter((child, index) => {
      // Skip a leading full-canvas background rect (napkin exports and many
      // other tools emit one).
      if (
        index === 0 &&
        child.tagName.toLowerCase() === 'rect' &&
        !child.hasAttribute('data-tool') &&
        coversCanvas(child, width, height)
      ) {
        result.background = child.getAttribute('fill') ?? undefined;
        return false;
      }
      return true;
    });

    const rootName = options.unnamedRootName ?? 'Imported';
    result.layers = childLayers(top, root, nextOrder, splitUnnamed, rootName);

    // A document with no <g> elements still gets a single top row: its loose
    // tag-named layers collect inside one group named after the file, so the
    // panel shows "file > path, line, rect, ..." instead of a flat pile.
    const hasGroups = top.some((el) => el.tagName.toLowerCase() === 'g');
    if (!hasGroups && !(result.layers.length === 1 && result.layers[0].name === rootName)) {
      result.layers = [{ name: rootName, opacity: 1, strokes: [], children: result.layers }];
    }

    result.layers = pruneEmptyLayers(result.layers);
    if (result.layers.length === 0) {
      throw new Error('No importable content found in the SVG.');
    }
    return result;
  } finally {
    host.remove();
  }
}

/** Drops layers (recursively) that hold neither strokes nor children. */
function pruneEmptyLayers(layers: ImportedLayer[]): ImportedLayer[] {
  const kept: ImportedLayer[] = [];
  for (const layer of layers) {
    const children = layer.children ? pruneEmptyLayers(layer.children) : [];
    if (layer.strokes.length === 0 && children.length === 0) continue;
    kept.push({ ...layer, children: children.length > 0 ? children : undefined });
  }
  return kept;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function sortByOrder(items: OrderedStroke[]): Stroke[] {
  return items.sort((a, b) => a.order - b.order).map((i) => i.stroke);
}

/** Direct children that can hold drawable content. */
function contentChildren(parent: Element): Element[] {
  return Array.from(parent.children).filter(
    (child) => !NON_CONTENT_TAGS.has(child.tagName.toLowerCase()),
  );
}

/**
 * The author-given name of an element, or null when it has none.
 *
 * `data-name` (napkin, Illustrator) and `inkscape:label` are real names and are
 * taken verbatim. An `id` is a real name too, but XML ids must be unique, so
 * editors uniquify repeats by appending `-2`, `-3`, … and escape characters
 * that are illegal in an id as `_xHH_`; both are undone so `strokes-10` reads
 * as `strokes`, matching what the source editor's layers panel shows.
 *
 * Marks written by napkin-sketch's own exporter (`data-tool`) are never named:
 * they are strokes on their layer, not layers of their own.
 */
function elementName(el: Element): string | null {
  const label = el.getAttribute('data-name') ?? el.getAttribute('inkscape:label');
  if (label && label.trim()) return label.trim();
  if (el.hasAttribute('data-tool')) return null;
  const id = el.getAttribute('id');
  if (!id || !id.trim()) return null;
  const name = decodeIdName(id.trim());
  return isAutoId(name) ? null : name;
}

/**
 * True for an id an editor made up rather than one the author typed.
 *
 * Inkscape gives every element an id whether or not it is named (`path4521`,
 * `g830`, `rect12`); treating those as layer names would bury the drawing in
 * meaningless rows, so a tag name *followed by digits* is read as "unnamed".
 * The digits are required: a layer the author called `text` or `line` keeps
 * its name.
 */
export function isAutoId(name: string): boolean {
  const stem = /^(.*?)[\s_-]*\d+$/.exec(name);
  return stem !== null && AUTO_ID_STEMS.has(stem[1].toLowerCase());
}

/** Undoes an editor's `_xHH_` escaping and `-N` uniquifier suffix on an id. */
export function decodeIdName(id: string): string {
  const decoded = id.replace(/_x([0-9A-Fa-f]{2,6})_/g, (match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
  // Only `-2` and up: editors leave the first use of a name unsuffixed, so a
  // trailing `-0` or `-1` is part of the name the author chose.
  const suffix = /-(\d+)$/.exec(decoded);
  if (!suffix || Number(suffix[1]) < 2) return decoded;
  return decoded.slice(0, -suffix[0].length) || decoded;
}

/** Placeholder name for geometry the source document left unnamed: its tag. */
function unnamedLabel(el: Element): string {
  return el.tagName.toLowerCase();
}

/** A group's author-given name, or the "<Group>" placeholder when unnamed. */
function layerName(group: Element): string {
  return elementName(group) ?? '<Group>';
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

/**
 * Converts a `<g>` into a layer.
 *
 * A group whose children are all unnamed geometry stays one layer holding those
 * marks as its strokes - nesting them would add rows, not structure. As soon as
 * the group holds a nested `<g>` or a named element it becomes a group layer
 * and every child (named element, nested group, run of unnamed geometry) gets
 * its own child layer in document order, so both names and z-order survive.
 */
function groupToLayer(
  group: SVGGElement,
  root: SVGSVGElement,
  nextOrder: () => number,
  name: string,
  splitUnnamed: boolean,
): ImportedLayer {
  const opacity = clamp01(Number(group.getAttribute('opacity') ?? 1));
  const kids = contentChildren(group);
  // A group stays a single leaf layer only when it holds nothing but
  // napkin's own exported marks (data-tool) - those merge back as the
  // layer's strokes so exports round-trip. Any generic child (named, a
  // nested group, or unnamed geometry from another editor) makes the group
  // a group row whose children each get their own layer.
  const structured =
    splitUnnamed ||
    kids.some(
      (child) =>
        isLayerGroup(child) ||
        elementName(child) !== null ||
        !child.hasAttribute('data-tool'),
    );

  if (!structured) {
    const items: OrderedStroke[] = [];
    for (const child of kids) elementToStrokes(child as SVGElement, root, items, nextOrder);
    collectMaskErasers(group, root, items, nextOrder);
    return { name, opacity, strokes: sortByOrder(items), ...effectsOf(group) };
  }

  const children = childLayers(kids, root, nextOrder, splitUnnamed);
  // Erased areas are recovered from the layer's mask; they belong on top of
  // everything the group paints.
  const erased: OrderedStroke[] = [];
  collectMaskErasers(group, root, erased, nextOrder);
  if (erased.length > 0) {
    children.push({ name: 'Erased', opacity: 1, strokes: sortByOrder(erased) });
  }
  return { name, opacity, strokes: [], children, ...effectsOf(group) };
}

/**
 * Builds one child layer per element in `elements`, preserving document order.
 *
 * Nested `<g>` elements recurse, named elements keep their name, and unnamed
 * geometry collects into placeholder layers - one per run of adjacent unnamed
 * siblings, or one per element when `splitUnnamed` is set.
 *
 * @param unnamedName Name for placeholder layers; defaults to an
 *   Illustrator-style tag label such as `<Path>`.
 */
function childLayers(
  elements: Element[],
  root: SVGSVGElement,
  nextOrder: () => number,
  splitUnnamed: boolean,
  unnamedName?: string,
): ImportedLayer[] {
  const layers: ImportedLayer[] = [];
  let unnamedIndex = 0;
  let run: OrderedStroke[] = [];
  let runName = '';
  let runOpen = false;

  const flushRun = (): void => {
    if (run.length > 0) layers.push({ name: runName, opacity: 1, strokes: sortByOrder(run) });
    run = [];
    runOpen = false;
  };

  for (const child of elements) {
    if (isLayerGroup(child)) {
      flushRun();
      layers.push(
        groupToLayer(child as SVGGElement, root, nextOrder, layerName(child), splitUnnamed),
      );
      continue;
    }

    const named = elementName(child);
    if (named !== null) {
      flushRun();
      const marks: OrderedStroke[] = [];
      elementToStrokes(child as SVGElement, root, marks, nextOrder);
      layers.push({ name: named, opacity: 1, strokes: sortByOrder(marks) });
      continue;
    }

    // Generic unnamed geometry (anything that is not one of napkin's own
    // data-tool marks) gets a layer of its own, named after its tag - "if no
    // id, use the tag name". Only data-tool marks fall through to the run
    // below and merge back onto their layer.
    if (!child.hasAttribute('data-tool')) {
      flushRun();
      const marks: OrderedStroke[] = [];
      elementToStrokes(child as SVGElement, root, marks, nextOrder);
      layers.push({ name: unnamedLabel(child), opacity: 1, strokes: sortByOrder(marks) });
      continue;
    }

    if (splitUnnamed) flushRun();
    if (!runOpen) {
      unnamedIndex += 1;
      runName = unnamedName
        ? unnamedIndex === 1
          ? unnamedName
          : `${unnamedName} ${unnamedIndex}`
        : unnamedLabel(child);
      runOpen = true;
    }
    elementToStrokes(child as SVGElement, root, run, nextOrder);
  }
  flushRun();
  return layers;
}

/**
 * True for a `<g>` that is a layer. A group napkin wrote for one mark - a
 * profiled stroke with a fill, which takes two paths - carries `data-tool`
 * like any other mark and is read as that mark instead.
 */
function isLayerGroup(el: Element): boolean {
  return el.tagName.toLowerCase() === 'g' && !el.hasAttribute('data-tool');
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
  // The id comes out of the document, so it goes into the selector escaped:
  // a quote or a bracket in it would otherwise throw a SyntaxError and take
  // the whole import down with it.
  const mask = root.querySelector(`mask[id=${cssString(ref[1])}]`);
  if (!mask) return;
  for (const child of Array.from(mask.children)) {
    // The full-canvas white rect is the mask's "show everything" base.
    if (child.tagName.toLowerCase() === 'rect' && !child.hasAttribute('data-tool')) continue;
    elementToStrokes(child as SVGElement, root, out, nextOrder, 'eraser');
  }
}

/**
 * Quotes an id for use as a CSS attribute-selector value. A double-quoted
 * selector string only has to escape the quote itself and the backslash that
 * escapes it, which is exactly what a document-supplied id might carry.
 */
function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/** The effects napkin-sketch wrote on an element as `data-effects`, as a field to spread in: nothing when it has none. */
function effectsOf(el: Element): { effects?: Effect[] } {
  const raw = el.getAttribute('data-effects');
  if (!raw) return {};
  try {
    const effects = readEffects(JSON.parse(raw));
    return effects ? { effects } : {};
  } catch {
    return {};
  }
}

/**
 * Reads one element's marks, and gives them the effects napkin-sketch wrote
 * on it: the filter is on the mark's outermost element, whichever kind of
 * mark it is.
 */
function elementToStrokes(
  el: SVGElement,
  root: SVGSVGElement,
  out: OrderedStroke[],
  nextOrder: () => number,
  forceTool?: Tool,
): void {
  const before = out.length;
  elementMarks(el, root, out, nextOrder, forceTool);
  const { effects } = effectsOf(el);
  if (effects) for (let k = before; k < out.length; k++) out[k].stroke.effects = effects;
}

/** Converts one SVG element into zero or more ordered strokes. */
function elementMarks(
  el: SVGElement,
  root: SVGSVGElement,
  out: OrderedStroke[],
  nextOrder: () => number,
  forceTool?: Tool,
): void {
  const tag = el.tagName.toLowerCase();
  // Only a mark that actually carries `data-i` keeps its recorded paint
  // order. `Number(null)` is 0, so reading the attribute without checking for
  // it first filed every element of a foreign document under order 0 and left
  // the document-order fallback below unreachable.
  const orderAttr = el.getAttribute('data-i');
  const recorded = orderAttr !== null && orderAttr.trim() !== '' ? Number(orderAttr) : NaN;
  const order = Number.isFinite(recorded) ? recorded : nextOrder() + 1_000_000;

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
  // A profiled napkin stroke: its outline is for other editors, and the
  // stroke comes back from the centreline it carries.
  if (el.hasAttribute('data-tool') && el.hasAttribute('data-d')) {
    const stroke = profiledToStroke(el, root);
    if (stroke) {
      out.push({ order, stroke });
      return;
    }
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
  // A napkin shape whose outline was switched off exports as stroke="none"
  // with the kept color and width in data attributes. Read those back rather
  // than deriving a color from the fill, which may be a gradient paint server
  // (`url(#…)`) and not a color at all.
  const keptColor = el.getAttribute('data-color');
  const keptWidth = Number(el.getAttribute('data-width'));
  const outlineOff = el.getAttribute('data-nostroke') === '1';
  const color = resolvePaintColor(
    tool === 'eraser'
      ? '#000000'
      : outlineOff && keptColor
        ? keptColor
        : hasStroke
          ? style.stroke
          : style.fill,
    root,
  );
  const width = importWidth(
    outlineOff && Number.isFinite(keptWidth) && keptWidth > 0
      ? keptWidth * matrixScale(matrix)
      : hasStroke
        ? (parseFloat(style.strokeWidth) || 1) * matrixScale(matrix)
        : 1,
  );
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

  // Exact round-trip for napkin exports: Copic strokes carry their editable
  // centreline and nib data on the filled chisel-outline path.
  if (dataTool === 'copic' && tag === 'path') {
    const centreline = parseDataPoints(el.getAttribute('data-pts'));
    if (centreline) {
      const nib = Number(el.getAttribute('data-nib'));
      const nibWidth = Number(el.getAttribute('data-width'));
      const stroke = makeStroke(
        'copic',
        color,
        Number.isFinite(nibWidth) && nibWidth > 0 ? nibWidth * matrixScale(matrix) : width,
        centreline.map((p) => applyMatrix(matrix, p.x, p.y)),
        opacity,
      );
      if (Number.isFinite(nib)) stroke.nibAngle = ((nib % 360) + 360) % 360;
      out.push({ order, stroke });
      return;
    }
    // Missing data attributes: fall through to generic outline sampling.
  }

  // Exact round-trip for napkin exports: M/L polyline paths parse directly.
  if (dataTool && tag === 'path') {
    const points = parsePolylineD(el.getAttribute('d') ?? '');
    if (points) {
      const stroke = makeStroke(tool, color, width, points.map((p) => applyMatrix(matrix, p.x, p.y)), opacity);
      const dataFill = el.getAttribute('data-fill');
      if (dataFill) stroke.fill = dataFill;
      applyNapkinPaint(el, stroke);
      out.push({ order, stroke });
      return;
    }
  }

  // Everything else keeps its Bézier structure: path data parses into cubic
  // anchors and the shape elements are built from their attributes. Each
  // subpath becomes its own vector stroke whose points are sampled from the
  // (transformed) anchors, so the export writes the curve back as the same
  // few control points the source held rather than a polyline through its
  // samples. A fill-only source shape stays fill-only: painting an outline
  // in the fill color would grow the shape by half a stroke width.
  const subpaths =
    tag === 'path' ? parsePathD(el.getAttribute('d') ?? '') : elementSubpaths(tag, (name) => el.getAttribute(name));
  if (subpaths) {
    // A paint server is read out of the document's defs rather than dropped:
    // a gradient keeps its first stop as the flat fill beneath it, and one
    // that resolves to no gradient paints the flat colour it falls back to.
    const paintsFill = hasFill && tool !== 'eraser';
    const paintGradient =
      paintsFill && style.fill.startsWith('url(') ? readPaintServer(style.fill, root) : undefined;
    const fill = !paintsFill
      ? null
      : !style.fill.startsWith('url(')
        ? normalizeColor(style.fill)
        : paintGradient
          ? paintGradient.stops[0].color
          : paintFallback(style.fill, root);
    const geometry = geometryOf(subpaths, matrix);
    if (!geometry) return;
    const { anchors, points, closed } = geometry;
    const stroke = makeStroke(tool, color, width, points, opacity);
    for (let k = 0; k < points.length; k++) if (points[k].move) stroke.points[k].move = true;
    if (fill && points.length > 2) {
      stroke.fill = fill;
      if (!hasStroke) stroke.noStroke = true;
    }
    if (paintGradient && points.length > 2) stroke.gradient = paintGradient;
    applyNapkinPaint(el, stroke);
    stroke.vector = { anchors, ...(closed ? { closed: true } : {}) };
    out.push({ order, stroke });
    return;
  }

  // Fallback for path data the parser could not read: sample evenly along
  // the element's length. One sample per unit of path length keeps curves
  // smooth at import size instead of the visibly faceted outlines a coarser
  // step produces.
  let length = 0;
  try {
    length = el.getTotalLength();
  } catch {
    return;
  }
  if (!Number.isFinite(length) || length <= 0) return;
  const samples = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(length)));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = el.getPointAtLength((length * i) / samples);
    points.push(applyMatrix(matrix, p.x, p.y));
  }
  const stroke = makeStroke(tool, color, width, points, opacity);
  // Filled source shapes stay filled (previously they imported as outlines).
  // A `url(#…)` paint server is not a color: the gradient it points at is
  // read out of the document's defs (napkin's own exports are restored from
  // `data-gradient` below), and one that resolves to no gradient paints the
  // flat colour it falls back to rather than being stored as a fill string.
  if (hasFill && tool !== 'eraser' && points.length > 2) {
    const paintServer = style.fill.startsWith('url(');
    const gradient = paintServer ? readPaintServer(style.fill, root) : undefined;
    if (gradient) stroke.gradient = gradient;
    stroke.fill = gradient
      ? gradient.stops[0].color
      : paintServer
        ? paintFallback(style.fill, root)
        : normalizeColor(style.fill);
    if (!hasStroke) stroke.noStroke = true;
  }
  applyNapkinPaint(el, stroke);
  out.push({ order, stroke });
}

/**
 * One element's subpaths as the geometry of one vector stroke: the anchors
 * mapped into root space, the points sampled from them, and whether it
 * closes.
 *
 * One element is one stroke, however many subpaths it holds: a compound path
 * (an outlined stroke with its inner contour, a ring, a letter with a
 * counter) fills as outer-minus-inner only while its contours stay together.
 * Each later subpath starts at a `move` anchor. The whole closes when its
 * contours all close, which is what an outlined shape is; a subpath left open
 * in a mostly closed compound (rare) still fills correctly and only loses its
 * explicit Z. Null when nothing long enough to draw is left.
 */
function geometryOf(
  subpaths: ParsedSubpath[],
  matrix: DOMMatrix,
): { anchors: VectorAnchor[]; points: Vec2WithMove[]; closed: boolean } | null {
  const anchors: VectorAnchor[] = [];
  const points: Vec2WithMove[] = [];
  for (const sub of subpaths) {
    const mapped: VectorAnchor[] = sub.anchors.map((a) => ({
      p: applyMatrix(matrix, a.p.x, a.p.y),
      ...(a.hIn ? { hIn: applyMatrix(matrix, a.hIn.x, a.hIn.y) } : {}),
      ...(a.hOut ? { hOut: applyMatrix(matrix, a.hOut.x, a.hOut.y) } : {}),
    }));
    const sampled = sampleAnchors(mapped, sub.closed);
    if (sampled.length < 2) continue;
    if (anchors.length > 0) {
      mapped[0].move = true;
      sampled[0].move = true;
    }
    anchors.push(...mapped);
    points.push(...sampled);
  }
  if (points.length < 2) return null;
  return { anchors, points, closed: subpaths.every((sub) => sub.closed) };
}

/**
 * Rebuilds a profiled napkin stroke. SVG has no variable-width stroke, so the
 * exporter writes the shape a profile makes as a filled outline - grouped with
 * the shape's fill, when it has one - and carries the stroke itself on the
 * outer element as data: its centreline (`data-d`), width, ink and profile.
 * The stroke is rebuilt from those, as the mark it was drawn as: a polyline
 * comes back as its samples and anything with curves or several contours as
 * a Vector Path, just as the same path data would as a mark's own `d`.
 * Null when the centreline does not parse, and the caller reads the element
 * as it would any other.
 */
function profiledToStroke(el: Element, root: SVGSVGElement): Stroke | null {
  const subpaths = parsePathD(el.getAttribute('data-d') ?? '');
  if (!subpaths || subpaths.length === 0) return null;
  const matrix = matrixToRoot(el as SVGGraphicsElement, root);
  const tool: Tool = el.getAttribute('data-tool') === 'marker' ? 'marker' : 'pen';
  const color = normalizeColor(el.getAttribute('data-color') ?? DEFAULT_INK);
  const width = importWidth((Number(el.getAttribute('data-width')) || 1) * matrixScale(matrix));
  const opacity = clamp01(Number(getComputedStyle(el).opacity || 1));
  const [only] = subpaths;
  let stroke: Stroke;
  if (subpaths.length === 1 && !only.closed && !only.anchors.some((a) => a.hIn || a.hOut)) {
    const points = only.anchors.map((a) => applyMatrix(matrix, a.p.x, a.p.y));
    if (points.length < 2) return null;
    stroke = makeStroke(tool, color, width, points, opacity);
  } else {
    const geometry = geometryOf(subpaths, matrix);
    if (!geometry) return null;
    stroke = makeStroke(tool, color, width, geometry.points, opacity);
    geometry.points.forEach((p, k) => {
      if (p.move) stroke.points[k].move = true;
    });
    stroke.vector = { anchors: geometry.anchors, ...(geometry.closed ? { closed: true } : {}) };
  }
  const fill = el.getAttribute('data-fill');
  if (fill && stroke.points.length > 2) stroke.fill = fill;
  applyNapkinPaint(el, stroke);
  return stroke;
}

/**
 * Rounds an imported outline width to a thousandth and floors it at
 * {@link MIN_IMPORT_WIDTH}. Transform matrices come back from the DOM with
 * floating-point dust (`0.9999999999999999` for an untransformed element),
 * which would otherwise be written into every exported `stroke-width`.
 */
function importWidth(width: number): number {
  const rounded = Math.round(width * 1000) / 1000;
  return Number.isFinite(rounded) ? Math.max(MIN_IMPORT_WIDTH, rounded) : 1;
}

/**
 * Writes a computed `rgb(r, g, b)` color as `#rrggbb`. Computed styles hand
 * every color back in the functional form; the source file almost always
 * held hex, and hex is what the export should write back. Anything else
 * (`rgba(…)` with alpha, named colors, `currentColor`) passes through.
 */
export function normalizeColor(color: string): string {
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color.trim());
  if (!m) return color;
  const hex = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

type Vec2 = { x: number; y: number };

/** A sampled point that may open a new subpath of a compound shape. */
type Vec2WithMove = Vec2 & { move?: true };

/**
 * A paint as a flat colour, resolving a paint server to one of its stops.
 *
 * `normalizeColor` passes anything that is not `rgb(…)` straight through, so
 * a `url(#id)` paint used to be stored as a stroke's colour verbatim and then
 * written back out as `stroke="url(#id)"` - a reference to a definition the
 * export does not carry, which renders as nothing at all. Resolving it here
 * means the worst case is a flat colour from the right ramp rather than a
 * shape nobody can see, and a paint with no ramp to take a colour from gets
 * the one {@link paintFallback} gives it. A `url(…)` string is never stored.
 */
function resolvePaintColor(paint: string, root: SVGSVGElement): string {
  if (!paint.trim().startsWith('url(')) return normalizeColor(paint);
  const gradient = readPaintServer(paint, root);
  if (!gradient) return paintFallback(paint, root);
  // The middle of the ramp reads as the shape's colour better than either
  // end, which are its lightest and darkest extremes.
  return gradient.stops[Math.floor(gradient.stops.length / 2)].color;
}

/**
 * Splits a `url(…)` paint into the element id it references (empty when the
 * target is not in this document) and the fallback written after it, as in
 * `url(#skin) #c48a5f`. Null for a paint that is not a reference at all.
 */
function paintReference(paint: string): { id: string; fallback: string } | null {
  const ref = /^url\(\s*(["']?)(.*?)\1\s*\)\s*(.*)$/.exec(paint.trim());
  if (!ref) return null;
  return { id: ref[2].startsWith('#') ? ref[2].slice(1) : '', fallback: ref[3].trim() };
}

/**
 * The flat colour a `url(…)` paint stands for when it resolves to no
 * gradient.
 *
 * SVG paints a gradient with a single stop as that stop's solid colour, and a
 * reference that finds nothing - an id the document never defines, or a
 * gradient left with no stops - as the fallback colour written after it.
 * With no fallback a browser paints nothing at all, which is the invisible
 * shape this importer exists to avoid, so the default ink stands in: wrong,
 * but visibly so, and one click from fixed.
 */
function paintFallback(paint: string, root: SVGSVGElement): string {
  const ref = paintReference(paint);
  const stops = ref ? (findPaintServer(ref.id, root)?.stops ?? []) : [];
  if (stops.length === 1) return stops[0].color;
  const fallback = ref?.fallback ?? '';
  return fallback && fallback !== 'none' ? normalizeColor(fallback) : DEFAULT_INK;
}

/**
 * The gradient a `url(#id)` paint points at, read out of the document's defs.
 *
 * Foreign gradients used to be dropped: the importer restored one only from
 * `data-gradient`, which is napkin's own export attribute, and anything else
 * that painted with `url(#…)` came back with no paint at all. A drawing whose
 * every base shape was gradient-filled therefore imported as an invisible
 * ghost - correct geometry, correct layer tree, nothing painted. It is the
 * silent kind of data loss, because the shapes are all still there.
 *
 * SVG's gradient model and this app's line up closely enough to carry across:
 * ordered stops of offset and colour, plus an angle for a linear one. What is
 * not carried is the paint server's own coordinate system - `gradientUnits`,
 * `spreadMethod`, transforms and focal points - so a gradient lands as its
 * stops along its own axis, which is right for the overwhelming majority and
 * approximate for the rest. Approximate and visible beats exact and absent.
 */
function readPaintServer(paint: string, root: SVGSVGElement): Gradient | undefined {
  const ref = paintReference(paint);
  const server = ref ? findPaintServer(ref.id, root) : undefined;
  if (!server) return undefined;
  const { node, stops } = server;

  const type = node.tagName.toLowerCase() === 'radialgradient' ? 'radial' : 'linear';
  // A linear gradient's direction, from its axis. Absent coordinates mean the
  // SVG default, which is left to right.
  const num = (name: string, fallback: number): number => {
    const raw = node.getAttribute(name);
    if (raw === null) return fallback;
    const value = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const angle =
    type === 'linear'
      ? (Math.atan2(num('y2', 0) - num('y1', 0), num('x2', 1) - num('x1', 0)) * 180) / Math.PI
      : 0;

  return normalizeGradient({ type, angle, stops });
}

/**
 * The gradient element an id names, with its colour stops: its own, or those
 * of the gradient its `href` inherits them from. Stops with no readable
 * colour are left out, so the list may hold one stop or none.
 */
function findPaintServer(
  id: string,
  root: SVGSVGElement,
): { node: Element; stops: GradientStop[] } | undefined {
  if (!id) return undefined;
  // `getElementById` is not on a detached fragment in every engine, and the
  // id may hold characters a selector would have to escape.
  const defs = Array.from(root.querySelectorAll('linearGradient, radialGradient'));
  const node = defs.find((d) => d.getAttribute('id') === id);
  if (!node) return undefined;

  // `xlink:href` / `href` lets a gradient inherit another one's stops, which
  // is how editors emit a family of gradients sharing a ramp.
  let stopSource: Element = node;
  for (let hops = 0; hops < 4 && stopSource.children.length === 0; hops++) {
    const href =
      stopSource.getAttribute('href') ??
      stopSource.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
      '';
    const target = href.startsWith('#') ? href.slice(1) : '';
    const next = target ? defs.find((d) => d.getAttribute('id') === target) : undefined;
    if (!next) break;
    stopSource = next;
  }

  const stops = Array.from(stopSource.querySelectorAll('stop')).map((stop, i, all) => {
    const raw = stop.getAttribute('offset') ?? '';
    const offset = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    const style = stop.getAttribute('style') ?? '';
    const inline = /stop-color\s*:\s*([^;]+)/.exec(style);
    const color = (stop.getAttribute('stop-color') ?? inline?.[1] ?? '').trim();
    return {
      offset: Number.isFinite(offset) ? offset : all.length < 2 ? 0 : i / (all.length - 1),
      color: color ? normalizeColor(color) : '',
    };
  });
  return { node, stops: stops.filter((s) => s.color) };
}

/**
 * Restores the properties-panel paint a napkin export carries in its data
 * attributes: an editable gradient fill (`data-gradient`), a dash style
 * (`data-dash`), a switched-off outline (`data-nostroke`), and a stroke
 * profile (`data-profile`, with `data-profile-mirrored` when its sides are
 * swapped), which only a pen or marker mark keeps. Foreign SVGs carry none of
 * these and pass through untouched.
 */
function applyNapkinPaint(el: Element, stroke: Stroke): void {
  const raw = el.getAttribute('data-gradient');
  if (raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null; // Malformed attribute: keep whatever flat fill was read.
    }
    const gradient = normalizeGradient(parsed);
    if (gradient) {
      stroke.gradient = gradient;
      // The flat fill beneath the gradient is kept when the export carried
      // one; without it the computed `url(#…)` paint is not a color and must
      // not be stored as one.
      const kept = el.getAttribute('data-fill');
      if (kept) stroke.fill = kept;
      else delete stroke.fill;
    }
  }
  const dash = el.getAttribute('data-dash');
  if (dash === 'dashed' || dash === 'dotted') stroke.strokeStyle = dash;
  if (el.getAttribute('data-nostroke') === '1') stroke.noStroke = true;
  const profile = el.getAttribute('data-profile');
  if (
    (profile === 'rounded' || profile === 'tapered' || profile === 'wave') &&
    (stroke.tool === 'pen' || stroke.tool === 'marker')
  ) {
    stroke.profile = profile;
    if (el.getAttribute('data-profile-mirrored') === '1') stroke.profileMirrored = true;
  }
}

/** Parses a `data-pts` attribute of space-separated "x,y" pairs. */
function parseDataPoints(attr: string | null): { x: number; y: number }[] | null {
  if (!attr) return null;
  const points: { x: number; y: number }[] = [];
  for (const pair of attr.trim().split(/\s+/)) {
    const [x, y] = pair.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  return points.length > 0 ? points : null;
}

/**
 * Parses a path made only of straight segments - the polyline napkin writes
 * for a stroke that carries no Bézier structure - back into its points.
 *
 * Reads every spelling the exporter picks between: relative or absolute,
 * `H`/`V` runs, and command letters left off a repeat. Returns null for
 * anything that curves or closes, which the caller reads as Bézier geometry
 * instead.
 */
function parsePolylineD(d: string): { x: number; y: number }[] | null {
  if (!d || /[CcSsQqTtAaZz]/.test(d)) return null;
  const subpaths = parsePathD(d);
  if (!subpaths || subpaths.length !== 1) return null;
  const [sub] = subpaths;
  if (sub.closed || sub.anchors.some((a) => a.hIn || a.hOut)) return null;
  return sub.anchors.map((a) => ({ x: a.p.x, y: a.p.y }));
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
  // napkin's own export carries a boxed text as typed, and its box, beside
  // the lines it was wrapped into for viewers that cannot wrap.
  const typed = el.getAttribute('data-text');
  const box = parseFloat(el.getAttribute('data-box') ?? '');
  const text = (typed ?? lines.join('\n')).trimEnd();
  if (!text) return null;

  const anchor = applyMatrix(matrix, x, y);
  const opacity = clamp01(Number(style.opacity || 1) * Number(style.fillOpacity || 1));
  return {
    id: createId('tx'),
    tool: 'text',
    color: style.fill !== 'none' && style.fill ? normalizeColor(style.fill) : '#1f2328',
    width: 1,
    points: [{ x: anchor.x, y: anchor.y, pressure: 0.5 }],
    text,
    fontSize: size * matrixScale(matrix),
    fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
    ...(typed !== null && Number.isFinite(box) && box > 0 ? { textBoxWidth: box * matrixScale(matrix) } : {}),
    opacity: opacity < 1 ? opacity : undefined,
    sharpened: true,
  };
}

/**
 * A placed image. An embedded one (`data:image/...`) comes in as its picture.
 * One that references a file - a path, or an address - comes in as a linked
 * file: an image item that stands for the file, drawn as a placeholder with
 * the file's name, which is how napkin writes a link and how a design tool
 * writes a placed file. Any other data URL is not an image, and is skipped.
 */
function imageToStroke(el: SVGImageElement, root: SVGSVGElement): Stroke | null {
  const href = (el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '').trim();
  if (!href) return null;
  const linked = !/^data:/i.test(href);
  if (!linked && !href.startsWith('data:image/')) return null;
  const matrix = matrixToRoot(el, root);
  const scale = matrixScale(matrix);
  const x = parseFloat(el.getAttribute('x') ?? '0');
  const y = parseFloat(el.getAttribute('y') ?? '0');
  const w = parseFloat(el.getAttribute('width') ?? '100');
  const h = parseFloat(el.getAttribute('height') ?? '100');
  const anchor = applyMatrix(matrix, x, y);
  const style = getComputedStyle(el);
  const opacity = clamp01(Number(style.opacity || 1));
  const width = w * scale;
  const height = h * scale;
  return {
    id: createId('im'),
    tool: 'image',
    color: '#1f2328',
    width: 1,
    points: [{ x: anchor.x, y: anchor.y, pressure: 0.5 }],
    image: linked ? linkPlaceholder(linkName(href), width, height) : href,
    imageWidth: width,
    imageHeight: height,
    opacity: opacity < 1 ? opacity : undefined,
    sharpened: true,
    ...(linked ? { link: { href, kind: linkKind(href) } } : {}),
  };
}
