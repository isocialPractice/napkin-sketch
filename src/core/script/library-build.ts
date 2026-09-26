/**
 * Reads the shape library's SVG assets into library shapes, with no DOM.
 *
 * `npm run shape-library` runs this to write `shape-library.json`, and a test
 * runs it to prove the committed file is current. It reads the three assets
 * the library is made from, which use a small part of SVG: basic shapes and
 * paths, groups, and class rules in one `<style>`. What it reads it reads
 * with the importer's own code - `elementSubpaths` and `parsePathD` - so a
 * library shape has exactly the anchors importing the asset would give it.
 * Anything outside that part of SVG - a transform, a `<text>`, a selector
 * other than a class - stops it with an error naming the element, rather than
 * a library shape quietly drawn wrong.
 *
 * Each element or group at the top of an asset is one shape, named by its id.
 * Every drawing element inside it, however deeply grouped, is one part, in
 * document order.
 */

import { elementSubpaths, parsePathD } from '../path-data.js';
import type { VectorAnchor } from '../types.js';
import { joinSubpaths } from './shapes.js';
import type { LibraryAnchor, LibraryPart, LibraryPoint, LibraryShape, ShapeLibrary } from './library.js';

/** Where the assets live, from the repository root. */
export const LIBRARY_ASSET_DIR = 'ai-helper/vectors/skills/vector-graphics/assets';

/** The assets, in the order the library lists their shapes. */
export const LIBRARY_ASSETS: readonly string[] = ['shapes.svg', 'isometric-objects.svg', 'perspective-objects.svg'];

/** One asset's name and text. */
export interface LibrarySource {
  file: string;
  text: string;
}

/**
 * Names that read better than the asset's ids. `polygon` is a hexagon, the
 * lines are named for their angle, `curve` and `curve-2` wrap an arc and a
 * spiral, and `verticla` is a typo in the asset. An id Illustrator wrote with
 * a leading underscore, because an XML id cannot start with a digit, loses it.
 */
const RENAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'shapes.svg': { polygon: 'hexagon', verticla: 'vertical', curve: 'arc', 'curve-2': 'spiral' },
};

const DRAWING = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SKIPPED = new Set(['defs', 'style', 'title', 'desc', 'metadata']);
const CONTAINER = 'g';

/** How many decimals a unit-box coordinate keeps: a hundredth of a pixel on a shape 1000 pixels across. */
const DECIMALS = 5;

interface Element {
  name: string;
  attrs: Record<string, string>;
  children: Element[];
  text: string;
}

/** Reads every asset into one library. */
export function buildShapeLibrary(sources: readonly LibrarySource[]): ShapeLibrary {
  const shapes: LibraryShape[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const shape of readAsset(source)) {
      if (seen.has(shape.name)) throw new Error(`${shape.source}: the library already has a shape named "${shape.name}".`);
      seen.add(shape.name);
      shapes.push(shape);
    }
  }
  return {
    about:
      'The shapes `shape "<name>"` draws. Written by `npm run shape-library` from the SVG assets in ' +
      `${LIBRARY_ASSET_DIR}; edit the assets and run it again rather than editing this file. ` +
      'Each part is one mark: anchors in a unit box over the shape\'s natural width and height, and whether the asset closed, filled and stroked it.',
    shapes,
  };
}

/**
 * The library as the text of `shape-library.json`: indented, with each part
 * on a line of its own so a change to one shape reads as a change to its
 * lines.
 */
export function formatShapeLibrary(library: ShapeLibrary): string {
  const lines = ['{', `  "about": ${JSON.stringify(library.about)},`, '  "shapes": ['];
  library.shapes.forEach((shape, s) => {
    lines.push('    {');
    lines.push(`      "name": ${JSON.stringify(shape.name)},`);
    lines.push(`      "source": ${JSON.stringify(shape.source)},`);
    lines.push(`      "width": ${JSON.stringify(shape.width)},`);
    lines.push(`      "height": ${JSON.stringify(shape.height)},`);
    lines.push('      "parts": [');
    shape.parts.forEach((part, p) => lines.push(`        ${JSON.stringify(part)}${p < shape.parts.length - 1 ? ',' : ''}`));
    lines.push('      ]');
    lines.push(`    }${s < library.shapes.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

function readAsset(source: LibrarySource): LibraryShape[] {
  const root = parseMarkup(source.text, source.file);
  if (root.name !== 'svg') throw new Error(`${source.file}: expected an <svg> at the top, found <${root.name}>.`);
  const rules = readStyles(root, source.file);
  const renames = RENAMES[source.file] ?? {};
  const shapes: LibraryShape[] = [];
  for (const child of root.children) {
    if (SKIPPED.has(child.name)) continue;
    const id = child.attrs.id;
    const where = `${source.file}${id ? `#${id}` : ` ${label(child)}`}`;
    if (!id) throw new Error(`${where}: a shape needs an id to be named by.`);
    const name = (renames[id] ?? id.replace(/^_(?=\d)/, '')).toLowerCase();
    const parts: Array<{ anchors: VectorAnchor[]; closed: boolean; fill: boolean; stroke: boolean }> = [];
    collectParts(child, rules, inheritedPaint(), where, parts);
    if (parts.length === 0) throw new Error(`${where}: nothing in it is drawn.`);
    shapes.push(normalise(name, where, parts));
  }
  return shapes;
}

interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: string;
}

/** SVG's initial paint: filled black, not stroked. */
function inheritedPaint(): Paint {
  return { fill: 'black', stroke: 'none', strokeWidth: '1' };
}

/** An element as an error message names it: its id, or its tag when it has none. */
function label(el: Element): string {
  return el.attrs.id ? `#${el.attrs.id}` : `<${el.name}>`;
}

/** The parts `el` draws, appended to `out`; `here` names `el` in errors. */
function collectParts(
  el: Element,
  rules: readonly Rule[],
  parent: Paint,
  here: string,
  out: Array<{ anchors: VectorAnchor[]; closed: boolean; fill: boolean; stroke: boolean }>,
): void {
  if (SKIPPED.has(el.name)) return;
  if (el.attrs.transform !== undefined) {
    throw new Error(`${here}: has a transform, which the shape library does not read. Apply it to the geometry in the asset.`);
  }
  const paint = resolvePaint(el, rules, parent);
  if (el.name === CONTAINER) {
    for (const child of el.children) collectParts(child, rules, paint, `${here} > ${label(child)}`, out);
    return;
  }
  if (!DRAWING.has(el.name)) throw new Error(`${here}: <${el.name}> is not something the shape library reads.`);
  const attribute = (name: string): string | null => el.attrs[name] ?? null;
  const subpaths = el.name === 'path' ? parsePathD(attribute('d') ?? '') : elementSubpaths(el.name, attribute);
  const outline = subpaths ? joinSubpaths(subpaths) : null;
  if (!outline) throw new Error(`${here}: <${el.name}> draws nothing.`);
  const fill = outline.closed && visible(paint.fill);
  const stroke = visible(paint.stroke) && parseFloat(paint.strokeWidth) !== 0;
  // A part the asset neither fills nor strokes shows nothing, and is left out.
  if (fill || stroke) out.push({ anchors: outline.anchors, closed: outline.closed, fill, stroke });
}

function visible(paint: string): boolean {
  const value = paint.trim().toLowerCase();
  return value !== 'none' && value !== 'transparent' && value !== '';
}

/**
 * The shape's parts in its unit box. The box is the extent of the curves
 * themselves - found where each cubic turns, not from the handles - so a
 * shape fitted to a box fills it. An axis with no extent, as a straight line
 * has across it, puts everything at its middle.
 */
function normalise(
  name: string,
  source: string,
  parts: ReadonlyArray<{ anchors: VectorAnchor[]; closed: boolean; fill: boolean; stroke: boolean }>,
): LibraryShape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const part of parts) {
    for (const [from, to] of segments(part.anchors, part.closed)) {
      take(from.p.x, from.p.y);
      take(to.p.x, to.p.y);
      const c1 = from.hOut ?? from.p;
      const c2 = to.hIn ?? to.p;
      for (const t of [...turningPoints(from.p.x, c1.x, c2.x, to.p.x), ...turningPoints(from.p.y, c1.y, c2.y, to.p.y)]) {
        take(cubic(from.p.x, c1.x, c2.x, to.p.x, t), cubic(from.p.y, c1.y, c2.y, to.p.y, t));
      }
    }
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const round = (v: number, places: number): number => {
    const scale = 10 ** places;
    return Math.round(v * scale) / scale + 0;
  };
  const unit = (p: { x: number; y: number }): LibraryPoint => [
    width > 1e-9 ? round((p.x - minX) / width, DECIMALS) : 0.5,
    height > 1e-9 ? round((p.y - minY) / height, DECIMALS) : 0.5,
  ];
  const libraryParts: LibraryPart[] = parts.map((part) => ({
    closed: part.closed,
    fill: part.fill,
    stroke: part.stroke,
    anchors: part.anchors.map((a) => {
      const anchor: LibraryAnchor = { p: unit(a.p) };
      if (a.hIn) anchor.in = unit(a.hIn);
      if (a.hOut) anchor.out = unit(a.hOut);
      if (a.move) anchor.move = true;
      return anchor;
    }),
  }));
  return { name, source, width: round(width, 3), height: round(height, 3), parts: libraryParts };
}

/** Each segment of an outline, subpath by subpath, with the closing segment of each when it closes. */
function segments(anchors: readonly VectorAnchor[], closed: boolean): Array<[VectorAnchor, VectorAnchor]> {
  const out: Array<[VectorAnchor, VectorAnchor]> = [];
  let start = 0;
  for (let i = 1; i <= anchors.length; i++) {
    if (i < anchors.length && !anchors[i].move) {
      out.push([anchors[i - 1], anchors[i]]);
      continue;
    }
    if (closed && i - start >= 2) out.push([anchors[i - 1], anchors[start]]);
    start = i;
  }
  return out;
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

/** Where, strictly inside a cubic, one coordinate stops rising or falling: the roots of its derivative. */
function turningPoints(a: number, b: number, c: number, d: number): number[] {
  const qa = -a + 3 * b - 3 * c + d;
  const qb = 2 * (a - 2 * b + c);
  const qc = b - a;
  const inside = (t: number): boolean => t > 0 && t < 1;
  if (Math.abs(qa) < 1e-12) return Math.abs(qb) < 1e-12 ? [] : [-qc / qb].filter(inside);
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-qb + root) / (2 * qa), (-qb - root) / (2 * qa)].filter(inside);
}

// ---- Reading the markup ------------------------------------------------------

/**
 * The element tree of an SVG file's text: tags, attributes and text, with the
 * XML declaration, comments and doctype dropped. It reads well-formed
 * markup, which is what an exported asset is, and is no general XML parser.
 */
function parseMarkup(text: string, file: string): Element {
  const cleaned = text
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body: string) => body.replace(/</g, '&lt;'));
  const document: Element = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: Element[] = [document];
  const token = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(cleaned))) {
    const [, closing, name, attrText, selfClosing, textRun, stray] = match;
    const top = stack[stack.length - 1];
    if (stray) throw new Error(`${file}: cannot read the markup near "${cleaned.slice(match.index, match.index + 40)}".`);
    if (textRun !== undefined) {
      top.text += decode(textRun);
      continue;
    }
    if (closing) {
      if (top.name !== name) throw new Error(`${file}: </${name}> closes <${top.name}>.`);
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    const element: Element = { name, attrs, children: [], text: '' };
    top.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length !== 1) throw new Error(`${file}: <${stack[stack.length - 1].name}> is never closed.`);
  const [root] = document.children;
  if (!root) throw new Error(`${file}: has no elements.`);
  return root;
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[lower] ?? whole;
  });
}

// ---- Reading the styles --------------------------------------------------------

/** One class rule's declarations, in stylesheet order. */
interface Rule {
  className: string;
  declarations: Record<string, string>;
}

/** The class rules of every `<style>` in the file, in order. Any other kind of selector is refused. */
function readStyles(root: Element, file: string): Rule[] {
  const rules: Rule[] = [];
  const styles: Element[] = [];
  const find = (el: Element): void => {
    for (const child of el.children) {
      if (child.name === 'style') styles.push(child);
      else find(child);
    }
  };
  find(root);
  for (const style of styles) {
    const css = style.text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const declarations = readDeclarations(rule[2]);
      for (const selector of rule[1].split(',').map((s) => s.trim())) {
        const m = /^\.([A-Za-z_][\w-]*)$/.exec(selector);
        if (!m) throw new Error(`${file}: the style selector "${selector}" is not a class, and the shape library reads class rules only.`);
        rules.push({ className: m[1], declarations });
      }
    }
  }
  return rules;
}

function readDeclarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    out[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return out;
}

/**
 * An element's fill, stroke and stroke width, the way a browser would work
 * them out: its `style` attribute first, then the class rules in stylesheet
 * order (a later rule winning), then its presentation attributes, then what
 * it inherits from its parent.
 */
function resolvePaint(el: Element, rules: readonly Rule[], parent: Paint): Paint {
  const inline = readDeclarations(el.attrs.style ?? '');
  const classes = new Set((el.attrs.class ?? '').split(/\s+/).filter(Boolean));
  const fromRules: Record<string, string> = {};
  for (const rule of rules) if (classes.has(rule.className)) Object.assign(fromRules, rule.declarations);
  const value = (property: string, inherited: string): string =>
    inline[property] ?? fromRules[property] ?? el.attrs[property] ?? inherited;
  return {
    fill: value('fill', parent.fill),
    stroke: value('stroke', parent.stroke),
    strokeWidth: value('stroke-width', parent.strokeWidth),
  };
}
