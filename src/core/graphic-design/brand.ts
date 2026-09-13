/**
 * Brand resources: the bridge between a design language and the files a brand
 * actually owns.
 *
 * A captured design language says where a logo goes. It cannot say what the
 * logo is, because that is not a property of the asset it was measured from -
 * it is a property of whoever is drawing next. This module is the half that
 * closes that gap:
 *
 * - {@link parseResources} reads a `resources.md` - a plain markdown list of
 *   `- key: value` pairs - into paths and raw text.
 * - {@link inlineSvg} turns a vector asset into composition elements, so a
 *   placed logo draws in the PNG as well as in the SVG.
 * - {@link placeBrand} puts a resolved asset into a slot, and
 *   {@link brandMark} draws something in the design language when there is no
 *   asset to put there.
 *
 * Everything here is browser-safe: it takes strings and element lists, never a
 * file system. Reading `resources.md` off disk and turning a path into bytes is
 * the caller's half, which is what keeps this module in the same bundle as the
 * rest of the API.
 */

import { DEFAULT_FONT_SIZE } from './types.js';
import { contourBounds, elementMatrix, flattenShape, transformContours } from './geometry.js';
import type { Matrix } from './geometry.js';
import type { ElementList } from './compose.js';
import type { Element, ImageFit, Point } from './types.js';

/** A rectangle a brand element is fitted into. */
export interface BrandBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a brand element sits on the page, as ninths. */
export type BrandRegion =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** One `- key: value` line, as it was read. */
export interface ResourceEntry {
  /** Normalized key: `GLOBAL_ASSETS` and `Global Assets` both become `globalAssets`. */
  key: string;
  /** The key exactly as the file wrote it. */
  raw: string;
  /** The value with quotes, backticks and markdown link syntax removed. */
  value: string;
  /** Whether the value names a file or folder, or is text to draw. */
  kind: 'path' | 'text';
}

/** What a `resources.md` declares, before anything touches the disk. */
export interface ParsedResources {
  /** Single assets, keyed by descriptor: `logo`, `icon`, `wordmark`. */
  paths: Record<string, string>;
  /** Folders whose file names are their descriptors. */
  directories: Record<string, string>;
  /** Raw text: `brandName`, `domain`, `tagline`. */
  text: Record<string, string>;
  /** Every line, in the order the file wrote them. */
  entries: ResourceEntry[];
  /** Anything the file said that this parser could not use. */
  notes: string[];
}

/**
 * Keys whose value is a folder rather than one file.
 *
 * A folder is read by file name: `logo.png` inside it resolves to the `logo`
 * descriptor, which is what lets a brand drop assets into one place and have
 * them found without listing each one.
 */
const DIRECTORY_KEYS = new Set(['assets', 'globalAssets', 'media', 'brandAssets']);

/** Spellings that mean the same slot, normalized to the first. */
const KEY_ALIASES: Record<string, string> = {
  globalassets: 'globalAssets',
  global: 'globalAssets',
  globalAsset: 'globalAssets',
  brandassets: 'brandAssets',
  logotype: 'wordmark',
  wordMark: 'wordmark',
  tagLine: 'tagline',
  strapline: 'tagline',
  slogan: 'tagline',
  brandname: 'brandName',
  companyName: 'brandName',
  organisation: 'brandName',
  organization: 'brandName',
  site: 'domain',
  website: 'domain',
  url: 'domain',
  favicon: 'icon',
};

/** File extensions that make a value a path even with no folder in it. */
const MEDIA_EXTENSIONS = /\.(svg|png|jpe?g|gif|webp|avif|ico|pdf)$/i;

/**
 * Normalizes a key into the camelCase descriptor the rest of the API uses.
 *
 * `GLOBAL_ASSETS`, `Global Assets` and `global-assets` are the same slot, and a
 * brand should not have to guess which spelling was the blessed one.
 */
export function normalizeResourceKey(key: string): string {
  const parts = key
    .trim()
    .replace(/[`*_]+/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  const camel =
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join('');
  return KEY_ALIASES[camel] ?? KEY_ALIASES[camel.toLowerCase()] ?? camel;
}

/**
 * The descriptor a file name carries.
 *
 * This is the rule behind a global assets folder: the name says what the file
 * is for, so `logo.png` fills the logo slot and `footer-band.png` fills
 * `footerBand`. No manifest, no second place to keep in step.
 */
export function descriptorFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  return normalizeResourceKey(stem);
}

/** Strips quotes, backticks and markdown link syntax from a declared value. */
function cleanValue(value: string): string {
  let out = value.trim();
  const link = /^\[[^\]]*\]\(([^)]+)\)$/.exec(out);
  if (link) out = link[1].trim();
  out = out.replace(/^[`'"<]+/, '').replace(/[`'">]+$/, '');
  return out.trim();
}

/** Whether a value names a file or folder rather than text to draw. */
function looksLikePath(key: string, value: string): boolean {
  if (DIRECTORY_KEYS.has(key)) return true;
  if (/^(https?|data|file):/i.test(value)) return true;
  if (MEDIA_EXTENSIONS.test(value)) return true;
  // A bare domain is text, not a path, so require a separator that a domain
  // would not have: `example.com` is a domain, `assets/example.com` is not.
  return /[\\/]/.test(value);
}

/**
 * Reads a `resources.md` into paths and text.
 *
 * The format is deliberately a markdown list and nothing more, because the
 * file is meant to be edited by whoever owns the brand rather than by whoever
 * owns the build. Headings, prose and `>` notes are ignored, so the same file
 * can explain itself to a reader and still parse.
 *
 * ```md
 * - logo: assets/logo.svg
 * - GLOBAL_ASSETS: assets/brand/
 * - brand name: Acme Corp.
 * - domain: example.com
 * ```
 */
export function parseResources(markdown: string): ParsedResources {
  const result: ParsedResources = {
    paths: {},
    directories: {},
    text: {},
    entries: [],
    notes: [],
  };
  if (!markdown) return result;

  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    // A fenced block is an example of the format, not a declaration in it.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*>/.test(line)) continue;

    const match = /^\s*[-*+]\s+(.+?)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;

    const raw = match[1].replace(/[`*]+/g, '').trim();
    const key = normalizeResourceKey(raw);
    const value = cleanValue(match[2]);
    if (!key) continue;
    if (!value || /^(todo|tbd|none|unset|path\/to\/)/i.test(value)) {
      result.notes.push(`\`${raw}\` is declared but not filled in.`);
      continue;
    }

    const kind: ResourceEntry['kind'] = looksLikePath(key, value) ? 'path' : 'text';
    result.entries.push({ key, raw, value, kind });
    if (kind === 'text') {
      result.text[key] = value;
    } else if (DIRECTORY_KEYS.has(key)) {
      result.directories[key] = value;
    } else {
      result.paths[key] = value;
    }
  }

  return result;
}

/** A vector asset taken apart into elements a composition can draw. */
export interface InlinedVector {
  /** The asset's own coordinate box, from its `viewBox` or its size. */
  viewBox: BrandBox;
  /** The asset's shapes, in its own coordinates and in drawing order. */
  elements: Element[];
  /** Anything in the file this did not translate. */
  notes: string[];
}

/** Paint and geometry an element inherits from a class or a `style`. */
type Style = Record<string, string>;

/** Reads `fill:#fff;stroke:none` into a map. */
function parseStyle(text: string): Style {
  const style: Style = {};
  for (const rule of text.split(';')) {
    const i = rule.indexOf(':');
    if (i < 0) continue;
    const name = rule.slice(0, i).trim().toLowerCase();
    const value = rule.slice(i + 1).trim();
    if (name && value) style[name] = value;
  }
  return style;
}

/** Reads every attribute of one tag into a map. */
function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*'([^']*)'/g)) {
    const name = (m[1] ?? m[3]).toLowerCase();
    attrs[name] = m[2] ?? m[4] ?? '';
  }
  return attrs;
}

/**
 * A 2x3 affine transform, in SVG's own `matrix(a b c d e f)` order - which is
 * the same order `geometry.Matrix` uses, so one can be handed to the other.
 */
type Affine = Matrix;

/** The transform that changes nothing. */
const NO_TRANSFORM: Affine = [1, 0, 0, 1, 0, 0];

/** Composes two affine transforms, outer first. */
function compose(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Reads an SVG `transform` attribute into one affine. */
function parseTransform(value: string): Affine {
  let out: Affine = NO_TRANSFORM;
  for (const m of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const n = m[2].trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
    switch (m[1].toLowerCase()) {
      case 'translate':
        out = compose(out, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
        break;
      case 'scale':
        out = compose(out, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
        break;
      case 'rotate': {
        const rad = ((n[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotation: Affine = [cos, sin, -sin, cos, 0, 0];
        if (n.length >= 3) {
          out = compose(out, compose([1, 0, 0, 1, n[1], n[2]], compose(rotation, [1, 0, 0, 1, -n[1], -n[2]])));
        } else {
          out = compose(out, rotation);
        }
        break;
      }
      case 'matrix':
        if (n.length >= 6) out = compose(out, [n[0], n[1], n[2], n[3], n[4], n[5]]);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Whether an affine is close enough to the identity to skip. */
function isIdentity(m: Affine): boolean {
  return (
    Math.abs(m[0] - 1) < 1e-9 &&
    Math.abs(m[1]) < 1e-9 &&
    Math.abs(m[2]) < 1e-9 &&
    Math.abs(m[3] - 1) < 1e-9 &&
    Math.abs(m[4]) < 1e-9 &&
    Math.abs(m[5]) < 1e-9
  );
}

/**
 * Splits an affine into the rotate, scale and translate a group understands.
 *
 * A group applies translate, then rotation, then scale about its origin, so an
 * affine with no shear decomposes exactly. Shear is reported rather than
 * silently dropped: a sheared logo drawn unsheared is a wrong graphic, and a
 * note is the honest version of that.
 */
function decompose(m: Affine): {
  rotate: number;
  scale: Point;
  translate: Point;
  shear: number;
} {
  const sx = Math.hypot(m[0], m[1]) || 1;
  const rotate = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const determinant = m[0] * m[3] - m[1] * m[2];
  const sy = determinant / sx || 1;
  const shear = (m[0] * m[2] + m[1] * m[3]) / (sx * sx);
  return { rotate, scale: { x: sx, y: sy }, translate: { x: m[4], y: m[5] }, shear };
}

/** Reads a `points="x,y x,y"` list. */
function parsePoints(value: string): Point[] {
  const n = value.trim().split(/[\s,]+/).map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) points.push({ x: n[i], y: n[i + 1] });
  }
  return points;
}

/** A number attribute, or a default. */
function num(attrs: Record<string, string>, name: string, fallback = 0): number {
  const value = parseFloat(attrs[name]);
  return Number.isFinite(value) ? value : fallback;
}

/** Paint that resolves to no paint at all. */
function paint(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (!v || v === 'none' || v === 'transparent') return null;
  // Gradients and patterns are `url(#id)`, and this API paints solids only.
  if (/^url\(/i.test(v)) return undefined;
  return v;
}

/** Tags {@link inlineSvg} knows how to draw. */
const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image']);

/**
 * Turns a vector asset into composition elements.
 *
 * This exists for one reason, and it is worth stating plainly: the rasterizer
 * decodes PNG and nothing else, so an SVG logo placed as an `image` shows up in
 * the SVG export and is a hole in the PNG. Inlining the asset's shapes as
 * elements makes both renderers draw the same brand mark, which is the whole
 * premise of "one composition, two formats".
 *
 * What it handles: `rect`, `circle`, `ellipse`, `line`, `polygon`, `polyline`,
 * `path`, `text` and data-URL `image`, painted by presentation attribute, by
 * inline `style`, or by a class declared in a `<style>` block - which is what a
 * design tool writes. Nested `<g>` transforms are composed and applied.
 *
 * What it does not: gradients, patterns, filters, masks, `<use>` references,
 * and elliptical arc path commands, each of which lands in `notes` rather than
 * being approximated. Returns `null` when the text is not an SVG at all.
 */
export function inlineSvg(text: string): InlinedVector | null {
  if (!/<svg[\s>]/i.test(text)) return null;
  const notes: string[] = [];

  // Class to style, the way a design tool writes it: colors declared once in a
  // `<style>` block and referenced by every element that uses them.
  const classStyles = new Map<string, Style>();
  for (const block of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const declarations = parseStyle(rule[2]);
      for (const selector of rule[1].split(',')) {
        const name = /^\s*\.([\w-]+)\s*$/.exec(selector);
        if (name) classStyles.set(name[1], { ...classStyles.get(name[1]), ...declarations });
      }
    }
  }

  const root = /<svg\b([^>]*)>/i.exec(text);
  const rootAttrs = parseAttributes(root ? root[1] : '');
  const box = (rootAttrs.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
  const viewBox: BrandBox =
    box.length === 4 && box.every((v) => Number.isFinite(v))
      ? { x: box[0], y: box[1], width: box[2], height: box[3] }
      : {
          x: 0,
          y: 0,
          width: num(rootAttrs, 'width', 100),
          height: num(rootAttrs, 'height', 100),
        };

  const elements: Element[] = [];
  const stack: Affine[] = [NO_TRANSFORM];
  const body = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

  // Everything between `<defs>` and `</defs>` is a definition, not a drawing.
  let depthInDefs = 0;
  let skipped = new Set<string>();

  for (const match of body.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g)) {
    const [, name, attrText, selfClosing] = match;
    const tag = name.toLowerCase();
    const closing = match[0].startsWith('</');

    if (tag === 'defs' || tag === 'clippath' || tag === 'mask' || tag === 'symbol') {
      if (closing) depthInDefs = Math.max(0, depthInDefs - 1);
      else if (!selfClosing) depthInDefs++;
      continue;
    }
    if (depthInDefs > 0) continue;

    if (tag === 'g' || tag === 'svg') {
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else if (!selfClosing) {
        const attrs = parseAttributes(attrText);
        const local = attrs.transform ? parseTransform(attrs.transform) : NO_TRANSFORM;
        stack.push(compose(stack[stack.length - 1], local));
      }
      continue;
    }

    if (closing || !SHAPE_TAGS.has(tag)) {
      if (!closing && !SHAPE_TAGS.has(tag) && /^(use|filter|lineargradient|radialgradient|pattern|foreignobject)$/.test(tag)) {
        skipped.add(tag);
      }
      continue;
    }

    const attrs = parseAttributes(attrText);
    const style: Style = {};
    for (const cls of (attrs.class ?? '').trim().split(/\s+/)) {
      const declared = classStyles.get(cls);
      if (declared) Object.assign(style, declared);
    }
    if (attrs.style) Object.assign(style, parseStyle(attrs.style));

    const value = (prop: string): string | undefined => style[prop] ?? attrs[prop];
    const fill = paint(value('fill'));
    const stroke = paint(value('stroke'));
    const common: Record<string, unknown> = {};
    // SVG fills black when nothing says otherwise; this API fills nothing. Say
    // what the asset meant rather than inheriting a different default.
    common.fill = fill === undefined ? (stroke ? null : '#000000') : fill;
    if (stroke !== undefined && stroke !== null) {
      common.stroke = stroke;
      common.strokeWidth = parseFloat(value('stroke-width') ?? '1') || 1;
    }
    const opacity = parseFloat(value('opacity') ?? '');
    if (Number.isFinite(opacity) && opacity < 1) common.opacity = opacity;
    const fillOpacity = parseFloat(value('fill-opacity') ?? '');
    if (Number.isFinite(fillOpacity) && fillOpacity < 1) common.fillOpacity = fillOpacity;
    const rule = value('fill-rule');
    if (rule === 'evenodd' || rule === 'nonzero') common.fillRule = rule;
    if (attrs.id) common.id = attrs.id;

    let element: Element | null = null;
    switch (tag) {
      case 'rect':
        element = {
          type: 'rect',
          x: num(attrs, 'x'),
          y: num(attrs, 'y'),
          width: num(attrs, 'width'),
          height: num(attrs, 'height'),
          ...(attrs.rx ? { rx: num(attrs, 'rx') } : {}),
          ...(attrs.ry ? { ry: num(attrs, 'ry') } : {}),
          ...common,
        } as Element;
        break;
      case 'circle':
        element = { type: 'circle', cx: num(attrs, 'cx'), cy: num(attrs, 'cy'), r: num(attrs, 'r'), ...common } as Element;
        break;
      case 'ellipse':
        element = {
          type: 'ellipse',
          cx: num(attrs, 'cx'),
          cy: num(attrs, 'cy'),
          rx: num(attrs, 'rx'),
          ry: num(attrs, 'ry'),
          ...common,
        } as Element;
        break;
      case 'line':
        element = {
          type: 'line',
          x1: num(attrs, 'x1'),
          y1: num(attrs, 'y1'),
          x2: num(attrs, 'x2'),
          y2: num(attrs, 'y2'),
          ...common,
          fill: null,
          stroke: (common.stroke as string) ?? '#000000',
        } as Element;
        break;
      case 'polygon':
      case 'polyline':
        element = { type: tag, points: parsePoints(attrs.points ?? ''), ...common } as Element;
        break;
      case 'path':
        if (/[aA]\s*[\d.-]/.test(attrs.d ?? '')) {
          notes.push('A path used an elliptical arc command, which this API does not draw.');
        }
        element = { type: 'path', d: attrs.d ?? '', ...common } as Element;
        break;
      case 'image': {
        const src = attrs.href || attrs['xlink:href'] || '';
        if (!src.startsWith('data:')) {
          notes.push('A nested image referenced an external file and was skipped.');
          break;
        }
        element = {
          type: 'image',
          src,
          x: num(attrs, 'x'),
          y: num(attrs, 'y'),
          width: num(attrs, 'width'),
          height: num(attrs, 'height'),
          fit: 'contain',
        } as Element;
        break;
      }
      case 'text': {
        // Only the simple case: one run, no `<tspan>`. Anything richer is a
        // layout this module would have to guess at.
        const after = body.slice((match.index ?? 0) + match[0].length);
        const close = after.indexOf('</text>');
        const inner = close >= 0 ? after.slice(0, close) : '';
        if (/<tspan/i.test(inner)) {
          notes.push('A text element used `<tspan>` runs and was skipped.');
          break;
        }
        const content = inner.replace(/<[^>]*>/g, '').trim();
        if (!content) break;
        element = {
          type: 'text',
          x: num(attrs, 'x'),
          y: num(attrs, 'y'),
          text: content,
          fontSize: parseFloat(value('font-size') ?? '') || DEFAULT_FONT_SIZE,
          ...(value('font-family') ? { fontFamily: value('font-family') as string } : {}),
          ...common,
        } as Element;
        break;
      }
      default:
        break;
    }

    if (!element) continue;

    // A shape carries its own `transform` as often as a group does - an editor
    // writes `translate(...) rotate(...)` straight onto a rotated rect rather
    // than wrapping it in a `<g>` - so the element's own transform composes
    // under its ancestors' rather than being the group branch's business alone.
    // Dropping it is silent and geometric: the shape lands in the right place
    // at the wrong angle, which reads as a drawing that was always like that.
    const inherited = stack[stack.length - 1];
    const matrix = attrs.transform ? compose(inherited, parseTransform(attrs.transform)) : inherited;
    if (isIdentity(matrix)) {
      elements.push(element);
    } else {
      const { rotate, scale, translate, shear } = decompose(matrix);
      if (Math.abs(shear) > 1e-6) {
        notes.push('A transform included a shear, which a group cannot express; it was dropped.');
      }
      elements.push({
        type: 'group',
        origin: { x: 0, y: 0 },
        ...(rotate ? { rotate } : {}),
        scale,
        translate,
        children: [element],
      } as Element);
    }
  }

  if (skipped.size > 0) {
    notes.push(`Skipped ${[...skipped].map((t) => `\`<${t}>\``).join(', ')}: this API paints solids only.`);
  }
  if (elements.length === 0) notes.push('No drawable shapes were found in the asset.');

  return { viewBox, elements, notes };
}

/** The transform that fits one box into another. */
export function fitInto(
  source: BrandBox,
  target: BrandBox,
  fit: ImageFit = 'contain',
): { scale: Point; translate: Point } {
  const sx = source.width > 0 ? target.width / source.width : 1;
  const sy = source.height > 0 ? target.height / source.height : 1;
  let scale: Point;
  switch (fit) {
    case 'fill':
      scale = { x: sx, y: sy };
      break;
    case 'cover': {
      const s = Math.max(sx, sy);
      scale = { x: s, y: s };
      break;
    }
    case 'none':
      scale = { x: 1, y: 1 };
      break;
    case 'contain':
    default: {
      const s = Math.min(sx, sy);
      scale = { x: s, y: s };
      break;
    }
  }
  // Centre whatever is left over, which is what every layout means by "put the
  // logo in this box" and is the only choice that does not need a second flag.
  const drawn = { width: source.width * scale.x, height: source.height * scale.y };
  return {
    scale,
    translate: {
      x: target.x + (target.width - drawn.width) / 2 - source.x * scale.x,
      y: target.y + (target.height - drawn.height) / 2 - source.y * scale.y,
    },
  };
}

/** An asset resolved far enough to draw: its bytes, or its markup. */
export type BrandSource =
  | { kind: 'vector'; svg: string; alt?: string }
  | { kind: 'raster'; dataUrl: string; alt?: string }
  | null;

/** What a brand slot ended up holding. */
export interface PlacedBrand {
  /** Whether anything was drawn at all. */
  placed: boolean;
  /** How it was drawn: inlined shapes, a placed image, or the fallback mark. */
  mode: 'vector' | 'image' | 'fallback' | 'none';
  /** The box it was drawn into. */
  box: BrandBox;
  /** Anything worth telling the caller about what was drawn. */
  notes: string[];
}

/** Options shared by {@link placeBrand} and {@link brandMark}. */
export interface PlaceBrandOptions {
  /** How the asset fills its slot. Default `contain`, which never distorts. */
  fit?: ImageFit;
  /** Alternative text, written into the SVG. */
  alt?: string;
  /** `data-name` for the group, so the output says which slot this was. */
  name?: string;
  /** Element id. */
  id?: string;
}

/**
 * Draws a resolved brand asset into a slot.
 *
 * A vector is inlined so both renderers draw it; a raster is placed as an
 * image, which both renderers already agree on. Passing `null` draws nothing
 * and reports it, which is the signal a caller uses to fall back to
 * {@link brandMark}.
 */
export function placeBrand(
  list: ElementList,
  box: BrandBox,
  source: BrandSource,
  options: PlaceBrandOptions = {},
): PlacedBrand {
  if (!source) return { placed: false, mode: 'none', box, notes: [] };
  const fit = options.fit ?? 'contain';

  if (source.kind === 'raster') {
    list.image({
      src: source.dataUrl,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      fit,
      ...(options.alt || source.alt ? { alt: options.alt ?? source.alt } : {}),
      ...(options.name ? { name: options.name } : {}),
      ...(options.id ? { id: options.id } : {}),
    });
    return { placed: true, mode: 'image', box, notes: [] };
  }

  const inlined = inlineSvg(source.svg);
  if (!inlined || inlined.elements.length === 0) {
    return { placed: false, mode: 'none', box, notes: inlined?.notes ?? ['The asset held no drawable shapes.'] };
  }

  const { scale, translate } = fitInto(inlined.viewBox, box, fit);
  list.group(
    {
      origin: { x: 0, y: 0 },
      scale,
      translate,
      children: inlined.elements,
      ...(options.name ? { name: options.name } : {}),
      ...(options.id ? { id: options.id } : {}),
    },
  );
  return { placed: true, mode: 'vector', box, notes: inlined.notes };
}

/** The palette a fallback mark draws itself in. */
export interface BrandPalette {
  /** The field the mark sits on. */
  ground?: string;
  /** The mark's own field. */
  accent?: string;
  /** What reads on the accent. */
  paper?: string;
}

/** Options for {@link brandMark}. */
export interface BrandMarkOptions extends BrandPalette {
  /** The name the mark stands for. Its initials are what get drawn. */
  label?: string;
  /** `tile` for a square block, `circle` for a disc, `wordmark` for set text. */
  shape?: 'tile' | 'circle' | 'wordmark';
  /** Font stack for the letters. */
  fontFamily?: string;
  /** `data-name` for the group. */
  name?: string;
}

/** The initials a label reduces to: at most two, upper case. */
function initials(label: string): string {
  const words = label.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Draws a brand slot with no asset behind it.
 *
 * This is the answer to "what happens when `resources.md` is not configured".
 * Leaving the slot empty makes a hole in the composition; drawing a stand-in
 * logo makes a lie. A monogram or a wordmark in the language's own palette is
 * neither: it fills the space in the design language it was measured from, and
 * it is obviously a placeholder to anyone who has the real mark.
 */
export function brandMark(list: ElementList, box: BrandBox, options: BrandMarkOptions = {}): PlacedBrand {
  const accent = options.accent ?? '#4c8faf';
  const paper = options.paper ?? '#ffffff';
  const label = options.label ?? '';
  const shape = options.shape ?? 'tile';
  const family = options.fontFamily;

  if (shape === 'wordmark') {
    if (!label) return { placed: false, mode: 'none', box, notes: ['No label to set as a wordmark.'] };
    list.text({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      text: label,
      align: 'center',
      baseline: 'middle',
      fontSize: Math.min(box.height * 0.72, (box.width / Math.max(label.length, 1)) * 1.6),
      letterSpacing: 0.6,
      transform: 'uppercase',
      fill: accent,
      ...(family ? { fontFamily: family } : {}),
      ...(options.name ? { name: options.name } : {}),
    });
    return { placed: true, mode: 'fallback', box, notes: [] };
  }

  const letters = initials(label);
  const size = Math.min(box.width, box.height);
  if (shape === 'circle') {
    list.circle({
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
      r: size / 2,
      fill: accent,
      ...(options.name ? { name: options.name } : {}),
    });
  } else {
    list.rect({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      fill: accent,
      ...(options.name ? { name: options.name } : {}),
    });
  }
  if (letters) {
    list.text({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      text: letters,
      align: 'center',
      baseline: 'middle',
      fontSize: size * 0.52,
      letterSpacing: 0.4,
      fill: paper,
      ...(family ? { fontFamily: family } : {}),
    });
  }
  return { placed: true, mode: 'fallback', box, notes: [] };
}

/** Which ninth of a page a box sits in. */
export function brandRegion(box: BrandBox, page: { width: number; height: number }): BrandRegion {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const column = cx < page.width / 3 ? 'left' : cx < (page.width * 2) / 3 ? 'center' : 'right';
  const row = cy < page.height / 3 ? 'top' : cy < (page.height * 2) / 3 ? 'middle' : 'bottom';
  return `${row}-${column}` as BrandRegion;
}

/**
 * Names that mark an element as a brand element, most specific first.
 *
 * A design tool writes layer names into `id`, `data-name` or `inkscape:label`,
 * and a designer who called a layer "Logo" has already said where the logo
 * goes. Reading that is cheaper and far more reliable than looking at pixels,
 * which is why {@link detectBrandSlots} tries it before anything else.
 */
const BRAND_PATTERNS: Array<{ key: string; test: RegExp; confidence: number }> = [
  { key: 'linkedMedia', test: /linked[-_\s]?media|placed[-_\s]?(image|media|art)/i, confidence: 0.9 },
  { key: 'wordmark', test: /word[-_\s]?mark|logo[-_\s]?type/i, confidence: 0.9 },
  { key: 'logo', test: /(^|[^a-z])logos?([^a-z]|$)|brand[-_\s]?mark/i, confidence: 0.95 },
  { key: 'icon', test: /(^|[^a-z])icons?([^a-z]|$)|favicon|symbol[-_\s]?mark/i, confidence: 0.85 },
  { key: 'tagline', test: /tag[-_\s]?line|strap[-_\s]?line|slogan/i, confidence: 0.85 },
  { key: 'brandName', test: /brand[-_\s]?name|company[-_\s]?name|client[-_\s]?name/i, confidence: 0.85 },
  { key: 'domain', test: /(^|[^a-z])(domain|website|url)([^a-z]|$)/i, confidence: 0.8 },
  { key: 'badge', test: /badge|stamp|seal/i, confidence: 0.6 },
  { key: 'footer', test: /footer|colophon/i, confidence: 0.6 },
  { key: 'link', test: /(^|[^a-z])links?[-_\s]?\d*([^a-z]|$)/i, confidence: 0.55 },
  { key: 'brand', test: /brand|identity/i, confidence: 0.5 },
];

/** Attributes an editor writes a layer name into. */
const NAME_ATTRIBUTES = ['id', 'data-name', 'inkscape:label', 'serif:id', 'aria-label'];

/** A place on the page a brand element occupies, and how it was found. */
export interface BrandSlot {
  /** The descriptor a `resources.md` would fill: `logo`, `icon`, `tagline`. */
  key: string;
  /** The layer or id name that matched, or the band a scan settled on. */
  source: string;
  /** `named` read a layer name; `scan` looked at the media itself. */
  found: 'named' | 'scan';
  /** The box, in the asset's own coordinates. */
  box: BrandBox;
  /** Which ninth of the page that box sits in. */
  region: BrandRegion;
  /** The box's share of the page area, 0 to 1. */
  share: number;
  /** How much to trust it, 0 to 1. A scan is never as sure as a name. */
  confidence: number;
}

/** What a brand pass found, and what it could not. */
export interface BrandDetection {
  page: { width: number; height: number };
  slots: BrandSlot[];
  notes: string[];
}

/** The brand slot a name implies, or null. */
function slotForName(name: string): { key: string; confidence: number } | null {
  for (const pattern of BRAND_PATTERNS) {
    if (pattern.test.test(name)) return { key: pattern.key, confidence: pattern.confidence };
  }
  return null;
}

/** The smallest box holding both. */
function union(a: BrandBox | null, b: BrandBox | null): BrandBox | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Whether the first box holds the second, give or take a unit of rounding. */
function contains(outer: BrandBox, inner: BrandBox): boolean {
  const slack = 1;
  return (
    outer.x <= inner.x + slack &&
    outer.y <= inner.y + slack &&
    outer.x + outer.width >= inner.x + inner.width - slack &&
    outer.y + outer.height >= inner.y + inner.height - slack
  );
}

/** The bounds of one parsed element under a transform, or null. */
function elementBounds(element: Element, matrix: Matrix): BrandBox | null {
  // A group arrives here whenever `inlineSvg` wrapped a shape to carry its own
  // transform, so measuring has to follow it in rather than give up - giving up
  // is how a named layer of rotated parts measures as nothing at all.
  if (element.type === 'group') {
    const local = elementMatrix(element, { x: 0, y: 0 });
    let box: BrandBox | null = null;
    for (const child of element.children) {
      box = union(box, elementBounds(child, compose(matrix, local)));
    }
    return box;
  }
  if (element.type === 'image') {
    const corners = [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
    ];
    return contourBounds(transformContours([corners], matrix));
  }
  if (element.type === 'text') {
    // A text box cannot be measured without the font the SVG names, so this is
    // an estimate from an average advance. Good enough to say which ninth of
    // the page a tagline sits in; not good enough to lay out against.
    const size = element.fontSize ?? DEFAULT_FONT_SIZE;
    const corners = [
      { x: element.x, y: element.y - size },
      { x: element.x + element.text.length * size * 0.5, y: element.y + size * 0.25 },
    ];
    return contourBounds(transformContours([corners], matrix));
  }
  const flat = flattenShape(element);
  const contours = [...flat.closed, ...flat.open];
  if (contours.length === 0) return null;
  return contourBounds(transformContours(contours, matrix));
}

/**
 * Finds the brand elements in a vector by reading its layer names.
 *
 * This is the branch that makes the feature cheap: a designer who named a layer
 * `logo` has already marked the slot, and reading that name costs one pass over
 * the markup. Everything the scan-based fallback guesses at, this knows.
 *
 * Names are read from `id`, `data-name`, `inkscape:label`, `serif:id` and
 * `aria-label`, so a file exported from Illustrator, Inkscape, Affinity or
 * Figma is covered without asking which tool wrote it.
 */
export function detectBrandSlots(svgText: string): BrandDetection {
  const inlined = inlineSvg(svgText);
  const page = inlined
    ? { width: inlined.viewBox.width, height: inlined.viewBox.height }
    : { width: 0, height: 0 };
  const detection: BrandDetection = { page, slots: [], notes: [] };
  if (!inlined) {
    detection.notes.push('Not an SVG, so there are no layer names to read.');
    return detection;
  }

  const body = svgText.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

  /** One open tag: its transform, the slot it declares, and what it holds. */
  interface Frame {
    tag: string;
    matrix: Matrix;
    slot: { key: string; confidence: number; source: string } | null;
    box: BrandBox | null;
  }

  const stack: Frame[] = [{ tag: 'svg', matrix: NO_TRANSFORM, slot: null, box: null }];
  const found: BrandSlot[] = [];
  let inDefs = 0;

  const close = (frame: Frame): void => {
    if (frame.slot && frame.box && frame.box.width > 0 && frame.box.height > 0) {
      found.push({
        key: frame.slot.key,
        source: frame.slot.source,
        found: 'named',
        box: frame.box,
        region: brandRegion(frame.box, page),
        share: (frame.box.width * frame.box.height) / Math.max(page.width * page.height, 1),
        confidence: frame.slot.confidence,
      });
    }
    // A box belongs to the parent too: a group's extent is its children's.
    const parent = stack[stack.length - 1];
    if (parent) parent.box = union(parent.box, frame.box);
  };

  for (const match of body.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g)) {
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    const selfClosing = match[3] === '/';

    if (tag === 'defs' || tag === 'clippath' || tag === 'mask' || tag === 'symbol') {
      if (closing) inDefs = Math.max(0, inDefs - 1);
      else if (!selfClosing) inDefs++;
      continue;
    }
    if (inDefs > 0) continue;
    if (closing) {
      if (stack.length > 1) close(stack.pop() as Frame);
      continue;
    }

    const attrs = parseAttributes(match[2]);
    const parent = stack[stack.length - 1];

    // A container's own transform composes onto what it inherited, and applies
    // to everything inside it. A *shape's* own transform is a different matter:
    // `inlineSvg` already returns such a shape wrapped in a group carrying it,
    // so composing it here as well would apply it twice - which lands the box
    // off the page and looks like a measurement bug rather than a double count.
    const matrix = attrs.transform ? compose(parent.matrix, parseTransform(attrs.transform)) : parent.matrix;

    let slot: Frame['slot'] = null;
    for (const attribute of NAME_ATTRIBUTES) {
      const name = attrs[attribute];
      if (!name) continue;
      const hit = slotForName(name);
      if (hit) {
        slot = { ...hit, source: name };
        break;
      }
    }

    const frame: Frame = { tag, matrix, slot, box: null };
    if (SHAPE_TAGS.has(tag)) {
      // A shape has no children, so its own bounds are the whole story. Parsing
      // it through `inlineSvg` keeps one implementation of "what does this tag
      // mean" rather than a second that can drift from it.
      const single = inlineSvg(`<svg viewBox="0 0 1 1">${match[0]}${selfClosing ? '' : `</${tag}>`}</svg>`);
      const element = single?.elements[0];
      frame.box = element ? elementBounds(element, parent.matrix) : null;
      close(frame);
      continue;
    }
    if (selfClosing) {
      close(frame);
      continue;
    }
    stack.push(frame);
  }

  while (stack.length > 1) close(stack.pop() as Frame);

  // The same mark is often a group inside a group inside a layer, each named
  // for it, so a nested box is dropped in favour of the one that holds it - the
  // outer box is the slot a caller draws into. Two boxes that merely share a
  // key are kept apart: `linkedMedia-data` and `linkedMedia-footer` are two
  // slots, not one wrong one spanning both.
  detection.slots = found
    .filter(
      (slot, i) =>
        !found.some((other, j) => j !== i && other.key === slot.key && contains(other.box, slot.box) && (!contains(slot.box, other.box) || j < i)),
    )
    .sort((a, b) => b.confidence - a.confidence || b.share - a.share);
  if (detection.slots.length === 0) {
    detection.notes.push('No layer or id name in this file named a brand element.');
  }
  return detection;
}

/** A raster, in the shape `decodePng` returns one. */
export interface PixelSource {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** What one quarter-band of a scan measured. */
export interface BrandBand {
  /** 1 for the top quarter, 4 for the bottom. */
  quarter: number;
  /** Share of the band's pixels that are not the page's ground color. */
  coverage: number;
  /** The bounds of everything that is not ground, in page coordinates. */
  box: BrandBox | null;
  /** How much of the page's width that box spans, 0 to 1. */
  spread: number;
}

/** What a band scan found. */
export interface BrandScan extends BrandDetection {
  /** Every band looked at, in the order they were looked at. */
  bands: BrandBand[];
  /** The color the scan took to be the page. */
  ground: string | null;
}

/** The most common color in a raster, quantized five bits a channel. */
function groundColor(image: PixelSource): { hex: string; rgb: [number, number, number] } | null {
  const counts = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 128) continue;
    const key = ((image.data[i] >> 3) << 10) | ((image.data[i + 1] >> 3) << 5) | (image.data[i + 2] >> 3);
    const bucket = counts.get(key);
    if (bucket) {
      bucket.r += image.data[i];
      bucket.g += image.data[i + 1];
      bucket.b += image.data[i + 2];
      bucket.n++;
    } else {
      counts.set(key, { r: image.data[i], g: image.data[i + 1], b: image.data[i + 2], n: 1 });
    }
  }
  let top: { r: number; g: number; b: number; n: number } | null = null;
  for (const bucket of counts.values()) {
    if (!top || bucket.n > top.n) top = bucket;
  }
  if (!top) return null;
  const rgb: [number, number, number] = [
    Math.round(top.r / top.n),
    Math.round(top.g / top.n),
    Math.round(top.b / top.n),
  ];
  return { hex: `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`, rgb };
}

/**
 * Looks for a brand element in a raster, a quarter of the page at a time.
 *
 * The order is not arbitrary. A logo sits at the top of a page far more often
 * than anywhere else, so the top quarter is read first and the scan stops as
 * soon as a band holds something that behaves like a mark: ink that covers a
 * little of the band and is gathered into one compact cluster rather than
 * spread across it the way a line of text is. Failing that it moves down a
 * quarter at a time, which is the cheapest order that still finds a footer
 * mark.
 *
 * Be clear about what this is: a heuristic over pixels, with no idea what a
 * logo looks like. It reports where a brand element would be and says how sure
 * it is, and `confidence` never reaches a layer name's. Prefer the vector, and
 * prefer a named layer inside it.
 */
export function scanBrandBands(image: PixelSource, options: { quarters?: number } = {}): BrandScan {
  const quarters = Math.max(1, options.quarters ?? 4);
  const page = { width: image.width, height: image.height };
  const scan: BrandScan = { page, slots: [], bands: [], notes: [], ground: null };

  const ground = groundColor(image);
  if (!ground) {
    scan.notes.push('The image is fully transparent, so there was nothing to scan.');
    return scan;
  }
  scan.ground = ground.hex;

  const bandHeight = Math.max(1, Math.floor(image.height / quarters));
  for (let quarter = 1; quarter <= quarters; quarter++) {
    const top = (quarter - 1) * bandHeight;
    const bottom = quarter === quarters ? image.height : Math.min(image.height, top + bandHeight);
    let marked = 0;
    let minX = image.width;
    let maxX = -1;
    let minY = bottom;
    let maxY = -1;

    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (image.data[i + 3] < 128) continue;
        const distance =
          Math.abs(image.data[i] - ground.rgb[0]) +
          Math.abs(image.data[i + 1] - ground.rgb[1]) +
          Math.abs(image.data[i + 2] - ground.rgb[2]);
        if (distance < 60) continue;
        marked++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const pixels = Math.max(1, (bottom - top) * image.width);
    const coverage = marked / pixels;
    const box: BrandBox | null =
      maxX >= minX && maxY >= minY ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
    const spread = box ? box.width / image.width : 0;
    scan.bands.push({ quarter, coverage, box, spread });

    // A mark is present but neither a stray speck nor a full-width field. The
    // spread test is what separates a logo from a line of text, which runs the
    // width of the column it is set in.
    if (box && coverage > 0.004 && coverage < 0.5 && spread < 0.75) {
      scan.slots.push({
        key: quarter === 1 ? 'logo' : quarter === quarters ? 'footer' : 'brand',
        source: `quarter ${quarter} of ${quarters}`,
        found: 'scan',
        box,
        region: brandRegion(box, page),
        share: (box.width * box.height) / Math.max(page.width * page.height, 1),
        // Compact and sparse reads more like a mark than broad and dense does.
        confidence: Math.max(0.2, Math.min(0.6, (1 - spread) * 0.6)),
      });
      scan.notes.push(
        `Found by scanning quarter ${quarter}, not by name. A scan cannot tell a logo from any other compact mark, so confirm the box before drawing into it.`,
      );
      return scan;
    }
  }

  scan.notes.push(
    `Scanned ${quarters} quarters and found no compact mark. Either this page carries no brand element, or it carries one that covers the page.`,
  );
  return scan;
}

/**
 * Finds brand slots in whatever was handed over.
 *
 * The order is the one the media deserves: an SVG's layer names first, because
 * a name is a statement of intent, then a pixel scan of the raster. A caller
 * gets the best answer available without having to decide which branch applies.
 */
export function findBrandSlots(
  media: { svg?: string; pixels?: PixelSource },
  options: { quarters?: number } = {},
): BrandDetection {
  if (media.svg) {
    const named = detectBrandSlots(media.svg);
    if (named.slots.length > 0 || !media.pixels) return named;
    const scanned = scanBrandBands(media.pixels, options);
    return { ...scanned, notes: [...named.notes, ...scanned.notes] };
  }
  if (media.pixels) return scanBrandBands(media.pixels, options);
  return { page: { width: 0, height: 0 }, slots: [], notes: ['Nothing to look at.'] };
}
