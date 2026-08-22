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
 * - Generic geometry (`path`, `line`, `polyline`, `polygon`, `rect`,
 *   `circle`, `ellipse`) is sampled along its length with transforms applied,
 *   so beziers and shapes become editable freehand strokes. Fill-only shapes
 *   import filled. `<text>` becomes text items and `<image>` becomes placed
 *   image items.
 */

import {
  DEFAULT_FONT_FAMILY,
  createId,
  type Stroke,
  type Tool,
  type VectorAnchor,
} from '../core/types.js';
import { normalizeGradient } from '../core/serialize.js';

/** One layer recovered from an imported SVG; nested groups become children. */
export interface ImportedLayer {
  name: string;
  opacity: number;
  strokes: Stroke[];
  /** Child layers recovered from nested `<g>` groups (expand/collapse in the panel). */
  children?: ImportedLayer[];
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

/** Longest sampled polyline per imported path. */
const MAX_SAMPLES = 1200;

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
        child.tagName.toLowerCase() === 'g' ||
        elementName(child) !== null ||
        !child.hasAttribute('data-tool'),
    );

  if (!structured) {
    const items: OrderedStroke[] = [];
    for (const child of kids) elementToStrokes(child as SVGElement, root, items, nextOrder);
    collectMaskErasers(group, root, items, nextOrder);
    return { name, opacity, strokes: sortByOrder(items) };
  }

  const children = childLayers(kids, root, nextOrder, splitUnnamed);
  // Erased areas are recovered from the layer's mask; they belong on top of
  // everything the group paints.
  const erased: OrderedStroke[] = [];
  collectMaskErasers(group, root, erased, nextOrder);
  if (erased.length > 0) {
    children.push({ name: 'Erased', opacity: 1, strokes: sortByOrder(erased) });
  }
  return { name, opacity, strokes: [], children };
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
    if (child.tagName.toLowerCase() === 'g') {
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
  // A napkin shape whose outline was switched off exports as stroke="none"
  // with the kept color and width in data attributes. Read those back rather
  // than deriving a color from the fill, which may be a gradient paint server
  // (`url(#…)`) and not a color at all.
  const keptColor = el.getAttribute('data-color');
  const keptWidth = Number(el.getAttribute('data-width'));
  const outlineOff = el.getAttribute('data-nostroke') === '1';
  const color =
    tool === 'eraser'
      ? '#000000'
      : outlineOff && keptColor
        ? keptColor
        : hasStroke
          ? style.stroke
          : style.fill;
  const width =
    outlineOff && Number.isFinite(keptWidth) && keptWidth > 0
      ? Math.max(0.5, keptWidth * matrixScale(matrix))
      : hasStroke
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

  // Napkin's vector strokes export as exact cubic Bézier paths; rebuild their
  // editable anchors so the structure survives the round-trip, and let the
  // generic sampler below turn the curve into stroke points.
  const vector = dataTool && tag === 'path' ? parseVectorD(el.getAttribute('d') ?? '') : null;

  // Generic geometry: sample evenly along the element's length. One sample
  // per unit of path length keeps curves smooth at import size instead of
  // the visibly faceted outlines a coarser step produces.
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
  // restored from `data-gradient` below for napkin's own exports, and a
  // foreign one is dropped rather than stored as a broken fill string.
  if (hasFill && tool !== 'eraser' && points.length > 2 && !style.fill.startsWith('url(')) {
    stroke.fill = style.fill;
  }
  applyNapkinPaint(el, stroke);
  if (vector) {
    const mapped = vector.anchors.map((a) => ({
      p: applyMatrix(matrix, a.p.x, a.p.y),
      ...(a.hIn ? { hIn: applyMatrix(matrix, a.hIn.x, a.hIn.y) } : {}),
      ...(a.hOut ? { hOut: applyMatrix(matrix, a.hOut.x, a.hOut.y) } : {}),
    }));
    stroke.vector = { anchors: mapped, ...(vector.closed ? { closed: true } : {}) };
  }
  out.push({ order, stroke });
}

/**
 * Restores the properties-panel paint a napkin export carries in its data
 * attributes: an editable gradient fill (`data-gradient`), a dash style
 * (`data-dash`), and a switched-off outline (`data-nostroke`). Foreign SVGs
 * carry none of these and pass through untouched.
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

/**
 * Parses a napkin-exported vector path — one absolute `M`, then `L`/`C`
 * segments and an optional trailing `Z` — back into Bézier anchors. A control
 * point sitting on its anchor reads as a collapsed (absent) handle, and a
 * closed path's duplicate final anchor folds onto the first. Returns null on
 * anything else (relative commands, arcs, subpaths), in which case the caller
 * falls back to sampling. Exported for tests.
 */
export function parseVectorD(d: string): { anchors: VectorAnchor[]; closed: boolean } | null {
  if (!d || !/[CZ]/.test(d)) return null; // open pure polylines parse elsewhere
  if (/[^MLCZ\s,\-.\d]/.test(d)) return null;
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g);
  if (!tokens) return null;
  let i = 0;
  const readPoint = (): { x: number; y: number } | null => {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    i += 2;
    return { x, y };
  };
  if (tokens[i++] !== 'M') return null;
  const start = readPoint();
  if (!start) return null;
  const anchors: VectorAnchor[] = [{ p: start }];
  let closed = false;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'Z') {
      // Z must be the final command; anything after it is not our format.
      if (i !== tokens.length) return null;
      closed = true;
      break;
    }
    if (cmd === 'L') {
      const p = readPoint();
      if (!p) return null;
      anchors.push({ p });
      continue;
    }
    if (cmd === 'C') {
      const c1 = readPoint();
      const c2 = readPoint();
      const p = readPoint();
      if (!c1 || !c2 || !p) return null;
      const from = anchors[anchors.length - 1];
      if (c1.x !== from.p.x || c1.y !== from.p.y) from.hOut = c1;
      const to: VectorAnchor = { p };
      if (c2.x !== p.x || c2.y !== p.y) to.hIn = c2;
      anchors.push(to);
      continue;
    }
    return null;
  }
  if (closed && anchors.length >= 3) {
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (last.p.x === first.p.x && last.p.y === first.p.y) {
      if (last.hIn) first.hIn = last.hIn;
      anchors.pop();
    }
  }
  return anchors.length >= 2 ? { anchors, closed } : null;
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
