/**
 * A drawing as an Adobe Illustrator script, with no DOM: an ExtendScript file
 * that, run in Illustrator with File > Scripts > Other Script, rebuilds the
 * drawing natively, out of the objects Illustrator would have made of it.
 *
 * - **Each page is a document**, its artboard the page - or the box the page
 *   is cut to - and a page pixel a point: Illustrator's own pixel, and the
 *   unit napkin's PDF is written in. The page's paper is a locked
 *   `Background` layer under everything, unless the page is transparent.
 * - **Layers are layers.** A top-level layer is an Illustrator `Layer`, and
 *   the layers in a group are named `GroupItem`s inside it, nested as the
 *   tree nests: the objects Illustrator makes of napkin's own SVG. Opacity,
 *   visibility and the lock carry over, a layer hidden or locked once what is
 *   on it is drawn, since Illustrator draws on neither.
 * - **Marks are paths on their own anchors.** A curve's anchors and handles
 *   map one to one - `leftDirection` is `hIn`, `rightDirection` is `hOut`,
 *   and a point is `SMOOTH` when its handles are in line - and a freehand
 *   line is its samples, pruned as the SVG export prunes them. A mark of
 *   several contours is a `CompoundPathItem`, filled nonzero. A profiled or
 *   Copic mark is the outline it fills, as the SVG export writes it.
 * - **Paint is Illustrator paint**: `RGBColor`s, a gradient as a
 *   `GradientColor` over the axis the SVG export draws it on, dashes as
 *   `strokeDashes`, round caps and joins, and opacity as `opacity`, with a
 *   color's own alpha folded in.
 * - **Text is a text frame**: point text from the item's top-left, or area
 *   text for a box of fixed width, set in the first family of the item's list
 *   that Illustrator has.
 * - **An image is embedded and a link is placed.** An image's bytes ride in
 *   the script, which writes them to a file, places it and embeds it as a
 *   raster; a linked file is a `PlacedItem` whose `file` is the file, which
 *   is what a linked graphic means in Illustrator.
 *
 * What the script cannot make, the writer says through
 * {@link JsxOptions.onWarning}: an effect is left off, and an eraser is drawn
 * in the paper's color, as the PDF draws one. A linked file the script cannot
 * find, or that Illustrator will not place, is drawn as its placeholder, and
 * the script names it when it ends.
 *
 * The script is ES3, which is what ExtendScript runs, and ASCII, every other
 * character escaped, so no guess at its encoding can change a name. It runs
 * inside a try/catch that says the page, the layer and the mark it stopped
 * at, and returns what it did as its result, for a caller that runs it
 * without a window.
 */

import { simplify } from '../sharpen/geometry.js';
import { strokeBounds } from './bounds.js';
import { readEffects } from './effects.js';
import { parseColor } from './graphic-design/color.js';
import { wrapText } from './graphic-design/font.js';
import { linkName, safeLinkPath } from './link.js';
import { copicNibPolygons } from './nib.js';
import { meanPressure, pencilMeanCoverage, pencilPaint } from './pencil.js';
import { activeProfile, profileInputOf, profileOutline } from './stroke-profile.js';
import { EXPORT_SIMPLIFY_EPSILON } from './svg-path.js';
import {
  DEFAULT_FONT_FAMILY,
  dashPatternFor,
  defaultOpacityFor,
  isImageStroke,
  isTextStroke,
  normalizedStops,
  strokesByLayer,
  type Layer,
  type Point,
  type Sketch,
  type Stroke,
  type VectorAnchor,
} from './types.js';
import { clipIndex } from './clip.js';

/** How {@link sketchesToJsx} writes its script. */
export interface JsxOptions {
  /**
   * A box a page, in page pixels, which becomes that page's artboard. A
   * missing or null entry makes the artboard the whole page.
   */
  crops?: ReadonlyArray<{ x: number; y: number; width: number; height: number } | null | undefined>;
  /** Leave the paper out: no `Background` layer, and nothing under the marks. */
  transparent?: boolean;
  /**
   * The folder the script looks for a linked file in, relative to the
   * script's own folder or absolute. The script's own folder unless given:
   * `writeBook` and `drawToFiles` set it to the folder the links are read in.
   */
  linkFolder?: string;
  /** Told about each thing a page holds that the script leaves out or draws as a stand-in. */
  onWarning?: (message: string) => void;
}

/** A color as the script paints it: its channels, 0 to 255, and its alpha. */
interface Rgba {
  rgb: [number, number, number];
  alpha: number;
}

/** A key of a style object and its value as script text, or undefined to leave the key out. */
type Field = [string, string | undefined];

/** What a page's marks are written with. */
interface Context {
  /** `page "name"`, which every warning starts with. */
  page: string;
  /** The paper's paint, or null for a transparent page. */
  paper: Rgba | null;
  warn(message: string): void;
  /** A color that paints, null - said once - for one that is not a color, and null for none. */
  paint(color: string | undefined): Rgba | null;
  fonts: FontTable;
  images: ImageTable;
  linkFolder: string | undefined;
}

/** Formats a number at two decimals, with no trailing zeros. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A share from 0 to 1 as Illustrator's opacity, 0 to 100. */
function pct(share: number): string {
  return num(Math.min(1, Math.max(0, share)) * 100);
}

/** An opacity worth writing: undefined for one that is whole. */
function opacityField(share: number): string | undefined {
  return share < 1 ? pct(share) : undefined;
}

/**
 * A string as an ES3 string literal in ASCII: quotes, backslashes and line
 * breaks escaped as themselves, and every character outside printable ASCII
 * as its code unit, so the file reads the same in any encoding.
 */
function str(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 34) out += '\\"';
    else if (code === 92) out += '\\\\';
    else if (code === 10) out += '\\n';
    else if (code === 13) out += '\\r';
    else if (code === 9) out += '\\t';
    else if (code < 32 || code > 126) out += '\\' + 'u' + code.toString(16).padStart(4, '0');
    else out += text[i];
  }
  return `${out}"`;
}

/** A style as an object literal, the keys with no value left out. */
function style(fields: readonly Field[]): string {
  return `{${fields.filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${value}`).join(', ')}}`;
}

/** A color as the script's `[r, g, b]`. */
function rgbText(color: Rgba): string {
  return `[${color.rgb.join(', ')}]`;
}

/** Reads a CSS color, or null for anything that is not one. */
function readColor(color: string): Rgba | null {
  try {
    const { r, g, b, a } = parseColor(color);
    return { rgb: [Math.round(r), Math.round(g), Math.round(b)], alpha: a };
  } catch {
    return null;
  }
}

/** A paint that shows: null for none and for a color with no alpha. */
function shown(color: Rgba | null): Rgba | null {
  return color && color.alpha > 0 ? color : null;
}

/**
 * A point is smooth when its two handles lie on one line through it, pointing
 * away from each other; a missing or zero-length handle makes it a corner.
 */
function isSmooth(anchor: VectorAnchor): boolean {
  if (!anchor.hIn || !anchor.hOut) return false;
  const ix = anchor.hIn.x - anchor.p.x;
  const iy = anchor.hIn.y - anchor.p.y;
  const ox = anchor.hOut.x - anchor.p.x;
  const oy = anchor.hOut.y - anchor.p.y;
  const lengths = Math.hypot(ix, iy) * Math.hypot(ox, oy);
  if (lengths < 1e-9) return false;
  return ix * ox + iy * oy < 0 && Math.abs(ix * oy - iy * ox) <= 0.01 * lengths;
}

/** An anchor as the script writes it: `[x, y]` for a corner with no handles, else its handles and whether it is smooth. */
function anchorText(anchor: VectorAnchor): string {
  const p = anchor.p;
  if (!anchor.hIn && !anchor.hOut) return `[${num(p.x)}, ${num(p.y)}]`;
  const hIn = anchor.hIn ?? p;
  const hOut = anchor.hOut ?? p;
  return `[${[p.x, p.y, hIn.x, hIn.y, hOut.x, hOut.y].map(num).join(', ')}, ${isSmooth(anchor) ? 1 : 0}]`;
}

/** Samples as a run of corners, pruned as the SVG export prunes them. */
function sampleRun(points: ReadonlyArray<{ x: number; y: number }>): string {
  return `[${simplify(points as Point[], EXPORT_SIMPLIFY_EPSILON).map((p) => `[${num(p.x)}, ${num(p.y)}]`).join(', ')}]`;
}

/**
 * A mark's subpaths as the script's runs, and whether they close: its Bezier
 * anchors when it has them, a subpath from each `move`, and otherwise its
 * samples, each run pruned on its own. A run of one point draws nothing and is
 * left out. Null when nothing is left.
 */
function runsOf(stroke: Stroke): { runs: string; closed: boolean } | null {
  const anchors = stroke.vector?.anchors;
  const runs: string[] = [];
  if (anchors && anchors.length >= 2) {
    let run: VectorAnchor[] = [];
    const flush = (): void => {
      if (run.length >= 2) runs.push(`[${run.map(anchorText).join(', ')}]`);
      run = [];
    };
    for (const anchor of anchors) {
      if (anchor.move && run.length > 0) flush();
      run.push(anchor);
    }
    flush();
    return runs.length > 0 ? { runs: `[${runs.join(', ')}]`, closed: stroke.vector?.closed === true } : null;
  }
  let run: Point[] = [];
  const flush = (): void => {
    if (run.length >= 2) runs.push(sampleRun(run));
    run = [];
  };
  for (const point of stroke.points) {
    if (point.move && run.length > 0) flush();
    run.push(point);
  }
  flush();
  return runs.length > 0 ? { runs: `[${runs.join(', ')}]`, closed: false } : null;
}

/** Closed outlines - a profile's, a Copic nib's - as runs. Null when none has a length. */
function outlineRuns(contours: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): string | null {
  const runs = contours.filter((contour) => contour.length >= 2).map(sampleRun);
  return runs.length > 0 ? `[${runs.join(', ')}]` : null;
}

/** A dash as the script's `strokeDashes`, or undefined for a solid line. */
function dashField(stroke: Stroke): string | undefined {
  const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
  return dash.length > 0 ? `[${dash.map(num).join(', ')}]` : undefined;
}

/**
 * A gradient fill as the script's gradient: its stops, each with its alpha,
 * and the axis the SVG export draws it on - a linear one across the shape's
 * box at its angle, a radial one from the box's centre out to its corner - as
 * a start or centre, an angle measured Illustrator's way, and a length. A stop
 * that is not a color is left out, and null comes back when fewer than two
 * are left.
 */
function gradientText(stroke: Stroke, ctx: Context): string | null {
  const gradient = stroke.gradient;
  const stops = gradient ? normalizedStops(gradient) : null;
  const box = strokeBounds(stroke);
  if (!gradient || !stops || !box) return null;
  const painted = stops.flatMap((stop) => {
    const color = ctx.paint(stop.color);
    return color ? [`[${num(stop.offset * 100)}, ${color.rgb.join(', ')}, ${pct(color.alpha)}]`] : [];
  });
  if (painted.length < 2) return null;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const stopsText = `[${painted.join(', ')}]`;
  if (gradient.type === 'radial') {
    return `{radial: true, stops: ${stopsText}, x: ${num(cx)}, y: ${num(cy)}, angle: 0, length: ${num(Math.hypot(w, h) / 2)}}`;
  }
  const angle = gradient.angle ?? 0;
  const rad = (angle * Math.PI) / 180;
  const reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  // Illustrator's y runs up, so a turn clockwise on the page is a negative angle there.
  return `{stops: ${stopsText}, x: ${num(cx - Math.cos(rad) * reach)}, y: ${num(cy - Math.sin(rad) * reach)}, angle: ${num(angle === 0 ? 0 : -angle)}, length: ${num(2 * reach)}}`;
}

/** A shape's fill: its gradient when it has one that paints, else its flat fill, else none. */
function fillOf(stroke: Stroke, ctx: Context): { field: Field; alpha: number } | null {
  const gradient = gradientText(stroke, ctx);
  if (gradient) return { field: ['gradient', gradient], alpha: 1 };
  const fill = shown(ctx.paint(stroke.fill));
  return fill ? { field: ['fill', rgbText(fill)], alpha: fill.alpha } : null;
}

/** The generic families, as the faces Illustrator is likely to have for each. */
const GENERIC_FONTS: Readonly<Record<string, readonly string[]>> = {
  'sans-serif': ['ArialMT', 'Helvetica', 'MyriadPro-Regular'],
  'system-ui': ['SegoeUI', 'HelveticaNeue', 'Helvetica', 'ArialMT'],
  '-apple-system': ['HelveticaNeue', 'Helvetica', 'SegoeUI', 'ArialMT'],
  blinkmacsystemfont: ['HelveticaNeue', 'Helvetica', 'SegoeUI', 'ArialMT'],
  serif: ['TimesNewRomanPSMT', 'Times-Roman', 'MinionPro-Regular'],
  monospace: ['CourierNewPSMT', 'Courier', 'Menlo-Regular', 'Consolas'],
  cursive: ['ComicSansMS', 'Chalkboard'],
};

/**
 * The CSS font lists a script sets text in, each written once as what the
 * script tries: for each family in order, the PostScript names it is most
 * often installed under, and the family itself, which the script finds by
 * looking through Illustrator's fonts when no name matches.
 */
class FontTable {
  private readonly index = new Map<string, number>();
  readonly entries: string[] = [];

  of(css: string): number {
    let n = this.index.get(css);
    if (n === undefined) {
      n = this.entries.length;
      this.index.set(css, n);
      this.entries.push(fontEntry(css));
    }
    return n;
  }
}

function fontEntry(css: string): string {
  const families = css
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, '').trim())
    .filter((family) => family !== '');
  const tries = families.map((family) => {
    const generic = GENERIC_FONTS[family.toLowerCase()];
    if (generic) return `{names: [${generic.map(str).join(', ')}]}`;
    const bare = family.replace(/\s+/g, '');
    const names = [...new Set([family, bare, `${bare}MT`, `${bare}-Regular`])];
    return `{names: [${names.map(str).join(', ')}], family: ${str(family)}}`;
  });
  return `{label: ${str(families.join(', '))}, tries: [${tries.join(', ')}]}`;
}

/** The extension a placed image's file is written with, by its media type. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'application/pdf': 'pdf',
};

/** Base64 of bytes, with no `btoa`. */
function base64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63];
    out += i + 1 < bytes.length ? table[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? table[n & 63] : '=';
  }
  return out;
}

/** How many base64 characters a line of the image table holds: whole groups of four, so each decodes alone. */
const IMAGE_CHUNK = 4096;

/**
 * The images a script embeds, each written once however often it is placed:
 * its type, and its bytes as base64 in lines the script decodes one at a
 * time.
 */
class ImageTable {
  private readonly index = new Map<string, number>();
  readonly entries: string[] = [];

  /** The image's number in the table, or null for an image that is not a data URL. */
  of(dataUrl: string): number | null {
    const known = this.index.get(dataUrl);
    if (known !== undefined) return known;
    const match = /^data:([^,]*),/i.exec(dataUrl);
    if (!match) return null;
    const params = match[1].split(';').map((part) => part.trim().toLowerCase());
    const body = dataUrl.slice(match[0].length);
    let data: string;
    if (params.includes('base64')) {
      data = body.replace(/[^A-Za-z0-9+/=]/g, '');
    } else {
      let text: string;
      try {
        text = decodeURIComponent(body);
      } catch {
        text = body;
      }
      data = base64(new TextEncoder().encode(text));
    }
    const type = IMAGE_EXTENSIONS[params[0]] ?? 'bin';
    const lines: string[] = [];
    for (let i = 0; i < data.length; i += IMAGE_CHUNK) lines.push(`      "${data.slice(i, i + IMAGE_CHUNK)}"`);
    const n = this.entries.length;
    this.index.set(dataUrl, n);
    this.entries.push(`    {type: ${str(type)}, data: [\n${lines.join(',\n')}\n    ]}`);
    return n;
  }
}

/**
 * Where the script looks for a linked file: its path from the script's own
 * folder, through `folder` when one is given, with forward slashes and the
 * `..` steps it can fold, or the path as written when it is absolute.
 */
function linkPath(href: string, folder: string | undefined): string {
  const file = safeLinkPath(href) ?? href.trim().replace(/\\/g, '/');
  if (!folder || /^([a-z]:)?\//i.test(file) || /^[a-z][a-z0-9+.-]*:/i.test(file)) return file;
  const base = folder.replace(/\\/g, '/');
  const root = /^([a-z]:)?\//i.exec(base)?.[0] ?? '';
  const parts: string[] = [];
  for (const part of `${base.slice(root.length)}/${file}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else if (!root) parts.push(part);
  }
  return root + parts.join('/');
}

/** A placeholder's label: the name, cut with an ellipsis to fit the box, at the size napkin's placeholder sets it. */
function placeholderLabel(name: string, width: number, height: number): { label: string; size: number } {
  const size = Math.min(28, Math.max(8, Math.min(width, height) * 0.14));
  const room = Math.max(3, Math.floor((width - 8) / (size * 0.6)));
  const chars = [...name];
  const label = chars.length > room ? chars.slice(0, room - 1).join('') + String.fromCharCode(0x2026) : name;
  return { label, size };
}

/** A pen or marker mark: a dot, or a path with its outline, its dash and its fill. */
function pathLines(stroke: Stroke, ctx: Context): string[] {
  const points = stroke.points;
  if (points.length === 0) return [];
  const opacity = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  if (points.length === 1) {
    const ink = shown(ctx.paint(stroke.color));
    if (!ink) return [];
    const fields: Field[] = [['fill', rgbText(ink)], ['opacity', opacityField(opacity * ink.alpha)]];
    return [`dot(${num(points[0].x)}, ${num(points[0].y)}, ${num(stroke.width / 2)}, ${style(fields)});`];
  }
  const shape = runsOf(stroke);
  if (!shape) return [];
  const ink = stroke.noStroke ? null : shown(ctx.paint(stroke.color));
  const fill = fillOf(stroke, ctx);
  if (!ink && !fill) return [];
  const outline: Field[] = ink ? [['stroke', rgbText(ink)], ['width', num(stroke.width)], ['dash', dashField(stroke)]] : [];
  const filling: Field[] = fill ? [fill.field] : [];
  const draw = (fields: Field[]): string => `path(${shape.runs}, ${shape.closed}, ${style(fields)});`;
  // An item has one opacity, so a fill and an outline of different alphas are two paths in a group.
  if (ink && fill && ink.alpha !== fill.alpha) {
    return [
      `begin(${pct(opacity)});`,
      `  ${draw([...filling, ['opacity', opacityField(fill.alpha)]])}`,
      `  ${draw([...outline, ['opacity', opacityField(ink.alpha)]])}`,
      'end();',
    ];
  }
  return [draw([...outline, ...filling, ['opacity', opacityField(opacity * (ink ?? fill)!.alpha)]])];
}

/**
 * A profiled mark: the outline its profile makes, filled in the ink. With a
 * fill of its own as well, the fill goes under the outline, and the two are
 * one group so the opacity covers them together, as the SVG export writes
 * them.
 */
function profiledLines(stroke: Stroke, ctx: Context): string[] {
  const runs = outlineRuns(profileOutline(profileInputOf(stroke)));
  if (!runs) return [];
  const ink = shown(ctx.paint(stroke.color));
  const opacity = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  const fill = stroke.points.length >= 3 ? fillOf(stroke, ctx) : null;
  const shape = fill ? runsOf(stroke) : null;
  if (!fill || !shape) {
    return ink ? [`path(${runs}, true, ${style([['fill', rgbText(ink)], ['opacity', opacityField(opacity * ink.alpha)]])});`] : [];
  }
  return [
    `begin(${pct(opacity)});`,
    `  path(${shape.runs}, ${shape.closed}, ${style([fill.field, ['opacity', opacityField(fill.alpha)]])});`,
    ...(ink ? [`  path(${runs}, true, ${style([['fill', rgbText(ink)], ['opacity', opacityField(ink.alpha)]])});`] : []),
    'end();',
  ];
}

/** A Copic mark: the chisel nib's filled footprint. */
function copicLines(stroke: Stroke, ctx: Context): string[] {
  const runs = outlineRuns(copicNibPolygons(stroke));
  const ink = shown(ctx.paint(stroke.color));
  if (!runs || !ink) return [];
  const opacity = stroke.opacity ?? defaultOpacityFor('copic');
  return [`path(${runs}, true, ${style([['fill', rgbText(ink)], ['opacity', opacityField(opacity * ink.alpha)]])});`];
}

/**
 * A Pencil mark: the outline the canvas fills, at the lead's mean tone over
 * the paper's tooth - Illustrator has no grain paint to give it (open
 * question 32).
 */
function pencilLines(stroke: Stroke, ctx: Context): string[] {
  if (stroke.noStroke) return [];
  const runs = outlineRuns(profileOutline(profileInputOf(stroke)));
  const ink = shown(ctx.paint(stroke.color));
  if (!runs || !ink) return [];
  const lays = pencilMeanCoverage(pencilPaint(stroke.pencil), meanPressure(stroke.points));
  const opacity = (stroke.opacity ?? 1) * lays;
  return [`path(${runs}, true, ${style([['fill', rgbText(ink)], ['opacity', opacityField(opacity * ink.alpha)]])});`];
}

/**
 * An eraser, drawn in the paper's color as the PDF draws one: a script cannot
 * cut a layer's mask, so it covers what lies under it on other layers too.
 * With no paper there is nothing to draw it in, and it is left out.
 */
function eraserLines(stroke: Stroke, ctx: Context): string[] {
  const points = stroke.points;
  if (points.length === 0) return [];
  const paper = ctx.paper;
  if (!paper) {
    ctx.warn(`${ctx.page}: an eraser was left out, since the page has no paper to draw it in`);
    return [];
  }
  ctx.warn(`${ctx.page}: an eraser is drawn in the paper's color, since a script cannot cut a mask in Illustrator, so it covers what is under it on other layers too`);
  const named: Field = ['name', str('Eraser')];
  if (points.length === 1) {
    const fields: Field[] = [['fill', rgbText(paper)], ['opacity', opacityField(paper.alpha)], named];
    return [`dot(${num(points[0].x)}, ${num(points[0].y)}, ${num(stroke.width / 2)}, ${style(fields)});`];
  }
  const shape = runsOf(stroke);
  if (!shape) return [];
  const fields: Field[] = [['stroke', rgbText(paper)], ['width', num(stroke.width)], ['dash', dashField(stroke)], ['opacity', opacityField(paper.alpha)], named];
  return [`path(${shape.runs}, ${shape.closed}, ${style(fields)});`];
}

/**
 * A text item: its lines a paragraph each, from its top-left, a line and a
 * quarter apart. A box of fixed width is area text, made tall enough for the
 * lines napkin breaks it into and half as many again, since Illustrator sets
 * it in a real face that may break it later.
 */
function textLines(stroke: Stroke, ctx: Context): string[] {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.text) return [];
  const ink = shown(ctx.paint(stroke.color));
  if (!ink) return [];
  const size = stroke.fontSize ?? 24;
  const leading = size * 1.25;
  const text = stroke.text.replace(/\r\n?/g, '\n');
  const fields: Field[] = [
    ['size', num(size)],
    ['leading', num(leading)],
    ['color', rgbText(ink)],
    ['font', String(ctx.fonts.of(stroke.fontFamily ?? DEFAULT_FONT_FAMILY))],
  ];
  const box = stroke.textBoxWidth && stroke.textBoxWidth > 0 ? stroke.textBoxWidth : 0;
  if (box > 0) {
    const lines = text.split('\n').flatMap((paragraph) => wrapText(paragraph, box, { fontSize: size })).length;
    fields.push(['box', num(box)], ['height', num((lines * 1.5 + 1) * leading)]);
  }
  fields.push(['opacity', opacityField((stroke.opacity ?? defaultOpacityFor('text')) * ink.alpha)]);
  return [`text(${str(text.replace(/\n/g, '\r'))}, ${num(anchor.x)}, ${num(anchor.y)}, ${style(fields)});`];
}

/** A placed image, embedded from the table; or a linked file, placed by link. */
function imageLines(stroke: Stroke, ctx: Context): string[] {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.image) return [];
  const width = stroke.imageWidth ?? 100;
  const height = stroke.imageHeight ?? 100;
  const opacity = opacityField(stroke.opacity ?? defaultOpacityFor('image'));
  const box = `${num(anchor.x)}, ${num(anchor.y)}, ${num(width)}, ${num(height)}`;
  if (stroke.link) {
    const name = linkName(stroke.link.href);
    const { label, size } = placeholderLabel(name, width, height);
    const fields: Field[] = [['name', str(name)], ['label', str(label)], ['size', num(size)], ['opacity', opacity]];
    return [`link(${str(linkPath(stroke.link.href, ctx.linkFolder))}, ${box}, ${style(fields)});`];
  }
  const n = ctx.images.of(stroke.image);
  if (n === null) {
    ctx.warn(`${ctx.page}: an image that is not a data URL was left out`);
    return [];
  }
  const { label, size } = placeholderLabel('image', width, height);
  return [`image(${n}, ${box}, ${style([['label', str(label)], ['size', num(size)], ['opacity', opacity]])});`];
}

/** One mark as the script's calls. */
function markLines(stroke: Stroke, ctx: Context): string[] {
  if (readEffects(stroke.effects)) ctx.warn(`${ctx.page}: an effect is not written to an Illustrator script, so what carries it is drawn plain`);
  if (isTextStroke(stroke)) return textLines(stroke, ctx);
  if (isImageStroke(stroke)) return imageLines(stroke, ctx);
  if (stroke.tool === 'eraser') return eraserLines(stroke, ctx);
  if (stroke.tool === 'copic') return copicLines(stroke, ctx);
  if (stroke.tool === 'pencil') return pencilLines(stroke, ctx);
  if (activeProfile(stroke) && !stroke.noStroke) return profiledLines(stroke, ctx);
  return pathLines(stroke, ctx);
}

/**
 * What the script runs: its helpers, ES3 throughout, with no backslash in
 * them, so this text is the script's text exactly.
 */
const RUNTIME = `  // Set QUIET to true to have the script report through its result alone, with no alert.
  var QUIET = false;

  var NL = String.fromCharCode(10);
  var HERE = null;
  try { HERE = File($.fileName).parent; } catch (e) {}
  var STAMP = new Date().getTime();
  var doc = null, AB = null, X = 0, Y = 0, fresh = false;
  var stack = [], names = [], marks = 0, inMark = false, pageName = "", built = 0;
  var gradients = {}, fonts = [], families = null, files = [], temps = [];
  var missing = [], refused = [], fontless = [];

  // Where the script is, for the message it stops with.
  function where() {
    var text = "page " + quote(pageName);
    if (names.length) text += ", layer " + quote(names.join(" / "));
    if (marks) text += ", mark " + marks;
    return text;
  }

  function quote(text) {
    return '"' + text + '"';
  }

  // A page: a document its box's size, a page pixel a point.
  function page(name, x, y, width, height) {
    pageName = name;
    names = [];
    marks = 0;
    doc = app.documents.add(DocumentColorSpace.RGB, width, height);
    var board = doc.artboards[0];
    try { board.name = name; } catch (e) {}
    AB = board.artboardRect;
    X = AB[0] - x;
    Y = AB[1] + y;
    stack = [doc];
    fresh = true;
    gradients = {};
    built++;
  }

  // A page point as a document point, whose y runs up.
  function at(x, y) {
    return [X + x, Y - y];
  }

  function rgb(c) {
    var color = new RGBColor();
    color.red = c[0];
    color.green = c[1];
    color.blue = c[2];
    return color;
  }

  function top() {
    return stack[stack.length - 1];
  }

  // A layer: a layer at the top of the tree, a named group inside one.
  function open(name, opacity) {
    var parent = top(), item;
    if (parent === doc) {
      item = fresh ? doc.layers[0] : doc.layers.add();
      fresh = false;
    } else {
      item = parent.groupItems.add();
    }
    item.name = name;
    if (opacity < 100) item.opacity = opacity;
    stack.push(item);
    names.push(name);
    marks = 0;
  }

  // A clip group's content: a group of its own, which its clipping path will clip.
  function clipOpen() {
    var group = top().groupItems.add();
    group.name = "Clip Group";
    stack.push(group);
  }

  // The clipping path, drawn last so it is on top of what it clips, unpainted,
  // and the group clipped by it - Illustrator clips with the topmost path.
  function clipClose(runs, closed) {
    var group = stack.pop(), item, part, i;
    if (runs.length === 1) {
      item = anchors(group.pathItems.add(), runs[0], closed);
      item.filled = false;
      item.stroked = false;
    } else {
      item = group.compoundPathItems.add();
      for (i = 0; i < runs.length; i++) {
        part = anchors(item.pathItems.add(), runs[i], closed);
        part.filled = false;
        part.stroked = false;
      }
    }
    group.clipped = true;
  }

  // Hidden and locked once what is on it is drawn: Illustrator draws on neither.
  function close(visible, locked) {
    var item = stack.pop();
    names.pop();
    if (!visible) {
      if (item.typename === "Layer") item.visible = false;
      else item.hidden = true;
    }
    if (locked) item.locked = true;
  }

  // A mark drawn as more than one item: a group, with the mark's opacity.
  function begin(opacity) {
    var group = next().groupItems.add();
    if (opacity < 100) group.opacity = opacity;
    stack.push(group);
    inMark = true;
  }

  function end() {
    stack.pop();
    inMark = false;
  }

  // Where the next mark goes, counted.
  function next() {
    if (!inMark) marks++;
    return top();
  }

  // The paper: a locked layer under everything.
  function paper(color, opacity) {
    open("Background", 100);
    var sheet = top().pathItems.rectangle(AB[1], AB[0], AB[2] - AB[0], AB[1] - AB[3]);
    sheet.stroked = false;
    sheet.filled = true;
    sheet.fillColor = rgb(color);
    if (opacity < 100) sheet.opacity = opacity;
    close(true, true);
  }

  // One subpath on its anchors: [x, y] for a corner, or [x, y, inX, inY, outX, outY, smooth].
  function anchors(item, run, closed) {
    var points = [], i, a, point;
    for (i = 0; i < run.length; i++) points.push(at(run[i][0], run[i][1]));
    item.setEntirePath(points);
    for (i = 0; i < run.length; i++) {
      a = run[i];
      if (a.length < 7) continue;
      point = item.pathPoints[i];
      point.leftDirection = at(a[2], a[3]);
      point.rightDirection = at(a[4], a[5]);
      point.pointType = a[6] ? PointType.SMOOTH : PointType.CORNER;
    }
    item.closed = closed;
    return item;
  }

  // A mark: a path, or a compound path for several subpaths.
  function path(runs, closed, style) {
    var parent = next(), item, i;
    if (runs.length === 1) {
      item = anchors(parent.pathItems.add(), runs[0], closed);
    } else {
      item = parent.compoundPathItems.add();
      for (i = 0; i < runs.length; i++) anchors(item.pathItems.add(), runs[i], closed);
    }
    paint(item, style);
  }

  // A mark of one point: a dot its width across.
  function dot(x, y, r, style) {
    paint(next().pathItems.ellipse(Y - y + r, X + x - r, 2 * r, 2 * r), style);
  }

  function paint(item, style) {
    var parts = item.typename === "CompoundPathItem" ? item.pathItems : null;
    var fill = style.gradient ? gradient(style.gradient) : style.fill ? rgb(style.fill) : null;
    var count = parts ? parts.length : 1, i, part;
    for (i = 0; i < count; i++) {
      part = parts ? parts[i] : item;
      part.filled = fill !== null;
      if (fill !== null) part.fillColor = fill;
      part.stroked = style.stroke !== undefined;
      if (style.stroke !== undefined) {
        part.strokeColor = rgb(style.stroke);
        part.strokeWidth = style.width;
        part.strokeCap = StrokeCap.ROUNDENDCAP;
        part.strokeJoin = StrokeJoin.ROUNDENDJOIN;
        if (style.dash !== undefined) part.strokeDashes = style.dash;
      }
      if (parts) part.evenodd = false;
    }
    if (style.opacity !== undefined) item.opacity = style.opacity;
    if (style.name !== undefined) item.name = style.name;
  }

  // A gradient: made once a page, and laid on the axis napkin draws it on.
  function gradient(spec) {
    var key = (spec.radial ? "radial" : "linear") + ":" + spec.stops.join(";");
    var made = gradients[key], i, stop, data, color;
    if (!made) {
      made = doc.gradients.add();
      made.type = spec.radial ? GradientType.RADIAL : GradientType.LINEAR;
      while (made.gradientStops.length < spec.stops.length) made.gradientStops.add();
      while (made.gradientStops.length > spec.stops.length) made.gradientStops[made.gradientStops.length - 1].remove();
      for (i = 0; i < spec.stops.length; i++) {
        data = spec.stops[i];
        stop = made.gradientStops[i];
        stop.rampPoint = data[0];
        stop.midPoint = 50;
        stop.color = rgb([data[1], data[2], data[3]]);
        if (data[4] < 100) stop.opacity = data[4];
      }
      gradients[key] = made;
    }
    color = new GradientColor();
    color.gradient = made;
    color.origin = at(spec.x, spec.y);
    color.angle = spec.angle;
    color.length = spec.length;
    return color;
  }

  // Text: point text from its top-left, or area text for a box of fixed width.
  function text(content, x, y, style) {
    var parent = next(), frame, attributes, face;
    if (style.box !== undefined) {
      frame = parent.textFrames.areaText(parent.pathItems.rectangle(Y - y, X + x, style.box, style.height));
    } else {
      frame = parent.textFrames.add();
    }
    frame.contents = content;
    attributes = frame.textRange.characterAttributes;
    attributes.size = style.size;
    attributes.autoLeading = false;
    attributes.leading = style.leading;
    attributes.fillColor = rgb(style.color);
    face = font(style.font);
    if (face) attributes.textFont = face;
    if (style.box === undefined) frame.position = at(x, y);
    if (style.opacity !== undefined) frame.opacity = style.opacity;
  }

  // The first family of a list that Illustrator has, by the names it is likely installed under.
  function font(n) {
    if (fonts[n] !== undefined) return fonts[n];
    var spec = FONTS[n], found = null, i, j, entry;
    for (i = 0; i < spec.tries.length && !found; i++) {
      entry = spec.tries[i];
      for (j = 0; j < entry.names.length && !found; j++) {
        try { found = app.textFonts.getByName(entry.names[j]); } catch (e) {}
      }
      if (!found && entry.family !== undefined) found = family(entry.family);
    }
    if (!found) fontless.push(spec.label);
    fonts[n] = found;
    return found;
  }

  // A family by its name, looked up once through every font Illustrator has.
  function family(name) {
    var i, face, key;
    if (!families) {
      families = {};
      for (i = 0; i < app.textFonts.length; i++) {
        face = app.textFonts[i];
        key = "~" + String(face.family).toLowerCase();
        if (!families[key] || /^(regular|roman|book|normal)$/i.test(face.style)) families[key] = face;
      }
    }
    return families["~" + name.toLowerCase()] || null;
  }

  // An image: its bytes written to a file, placed, and embedded.
  function image(n, x, y, width, height, style) {
    var parent = next();
    try {
      place(parent, imageFile(n), x, y, width, height, true, style);
    } catch (e) {
      refused.push("the image at " + where());
      placeholder(parent, x, y, width, height, style);
    }
  }

  // A linked file: placed by link, or its placeholder when it is not there or will not place.
  function link(path, x, y, width, height, style) {
    var parent = next(), file = linked(path);
    if (file && file.exists) {
      try {
        place(parent, file, x, y, width, height, false, style);
        return;
      } catch (e) {
        refused.push(file.fsName);
      }
    } else {
      missing.push(file ? file.fsName : path);
    }
    placeholder(parent, x, y, width, height, style);
  }

  // A link's file, from this script's folder unless its path is absolute.
  function linked(path) {
    if (path.charAt(0) === "/" || path.charAt(1) === ":") return new File(path);
    var folder = HERE;
    if (!folder) return null;
    while (path.substring(0, 3) === "../" && folder.parent) {
      folder = folder.parent;
      path = path.substring(3);
    }
    return new File(folder.fsName + "/" + path);
  }

  function place(parent, file, x, y, width, height, embed, style) {
    var item = parent.placedItems.add();
    try {
      item.file = file;
    } catch (e) {
      item.remove();
      throw e;
    }
    item.width = width;
    item.height = height;
    item.position = at(x, y);
    if (embed) {
      item.embed();
      item = parent.pageItems[0];
    }
    if (style.opacity !== undefined) item.opacity = style.opacity;
    if (style.name !== undefined) item.name = style.name;
  }

  // The placeholder napkin draws for a link: a dashed box, crossed, with the file's name.
  function placeholder(parent, x, y, width, height, style) {
    var group = parent.groupItems.add(), box, cross, label, i;
    group.name = style.name !== undefined ? style.name : style.label;
    box = group.pathItems.rectangle(Y - y - 1, X + x + 1, width - 2, height - 2);
    box.filled = true;
    box.fillColor = rgb([246, 248, 250]);
    box.stroked = true;
    box.strokeColor = rgb([110, 119, 129]);
    box.strokeWidth = 2;
    box.strokeDashes = [6, 4];
    for (i = 0; i < 2; i++) {
      cross = group.pathItems.add();
      cross.setEntirePath(i === 0 ? [at(x + 1, y + 1), at(x + width - 1, y + height - 1)] : [at(x + width - 1, y + 1), at(x + 1, y + height - 1)]);
      cross.filled = false;
      cross.stroked = true;
      cross.strokeColor = rgb([208, 215, 222]);
      cross.strokeWidth = 1;
    }
    label = group.textFrames.pointText(at(x + width / 2, y + height / 2 + style.size * 0.35));
    label.contents = style.label;
    label.textRange.characterAttributes.size = style.size;
    label.textRange.characterAttributes.fillColor = rgb([87, 96, 106]);
    label.textRange.paragraphAttributes.justification = Justification.CENTER;
    if (style.opacity !== undefined) group.opacity = style.opacity;
  }

  // An image's file, written once from its base64 lines.
  function imageFile(n) {
    if (files[n]) return files[n];
    var entry = IMAGES[n], i;
    var file = new File(Folder.temp.fsName + "/napkin-sketch-" + STAMP + "-" + (n + 1) + "." + entry.type);
    file.encoding = "BINARY";
    if (!file.open("w")) throw new Error("could not write " + file.fsName);
    for (i = 0; i < entry.data.length; i++) file.write(decode(entry.data[i]));
    file.close();
    temps.push(file);
    files[n] = file;
    return file;
  }

  // Base64 to bytes, one character a byte.
  function decode(chunk) {
    var out = [], buffer = 0, bits = 0, i, c, v;
    for (i = 0; i < chunk.length; i++) {
      c = chunk.charCodeAt(i);
      if (c >= 65 && c <= 90) v = c - 65;
      else if (c >= 97 && c <= 122) v = c - 71;
      else if (c >= 48 && c <= 57) v = c + 4;
      else if (c === 43) v = 62;
      else if (c === 47) v = 63;
      else continue;
      buffer = (buffer << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push(String.fromCharCode((buffer >> bits) & 255));
        buffer &= (1 << bits) - 1;
      }
    }
    return out.join("");
  }

  // What the run could not do as asked, a sentence each.
  function report() {
    var notes = [];
    if (missing.length) notes.push("Not found, so drawn as placeholders: " + missing.join(", ") + ".");
    if (refused.length) notes.push("Not placed by Illustrator, so drawn as placeholders: " + refused.join(", ") + ".");
    if (fontless.length) notes.push("No font found for " + fontless.join("; ") + ", so Illustrator's default was used.");
    return notes;
  }`;

/** What the script runs last: the build, the report, and the settings put back as they were. */
const TAIL = `  var saved = {}, message = "", notes = [], failed = false, i;
  try {
    saved.coordinates = app.coordinateSystem;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
  } catch (e) {}
  try {
    saved.interaction = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  } catch (e) {}
  try {
    build();
    notes = report();
    message = "napkin-sketch rebuilt " + built + (built === 1 ? " page" : " pages") + " in Illustrator.";
  } catch (e) {
    failed = true;
    message = "napkin-sketch stopped at " + where() + ": " + (e && e.message ? e.message : e) + (e && e.line ? " (line " + e.line + " of the script)" : "") + ".";
  } finally {
    for (i = 0; i < temps.length; i++) {
      try { temps[i].remove(); } catch (e) {}
    }
    try { if (saved.coordinates !== undefined) app.coordinateSystem = saved.coordinates; } catch (e) {}
    try { if (saved.interaction !== undefined) app.userInteractionLevel = saved.interaction; } catch (e) {}
  }
  if (notes.length) message += NL + NL + notes.join(NL);
  try { $.writeln(message); } catch (e) {}
  if (!QUIET && (failed || notes.length)) alert(message);
  return message;`;

/**
 * Writes sketches as one Illustrator script that rebuilds each as a document
 * of its own, in order. See the module's comment for what becomes what.
 */
export function sketchesToJsx(sketches: readonly Sketch[], options: JsxOptions = {}): string {
  // Each thing left out is said once for the script, however often it recurs.
  const said = new Set<string>();
  const warn = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    options.onWarning?.(message);
  };
  const fonts = new FontTable();
  const images = new ImageTable();
  const contents: string[] = [];
  const body: string[] = [];

  sketches.forEach((sketch, index) => {
    const page = `page "${sketch.name}"`;
    const box = options.crops?.[index] ?? { x: 0, y: 0, width: sketch.width, height: sketch.height };
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    const paint = (color: string | undefined): Rgba | null => {
      if (color === undefined) return null;
      const read = readColor(color);
      if (!read) warn(`${page}: "${color}" is not a color, so what it colors was left out`);
      return read;
    };
    const paper = options.transparent ? null : shown(paint(sketch.background));
    const ctx: Context = { page, paper, warn, paint, fonts, images, linkFolder: options.linkFolder };
    contents.push(`// Page ${index + 1}: ${str(sketch.name)}, ${num(width)} x ${num(height)}.`);
    if (index > 0) body.push('');
    body.push(`    page(${str(sketch.name)}, ${num(box.x)}, ${num(box.y)}, ${num(width)}, ${num(height)});`);
    if (paper) body.push(`    paper(${rgbText(paper)}, ${pct(paper.alpha)});`);

    // The tree as the SVG export rebuilds it: a layer sits in its parent when
    // that parent is a group, and at the top otherwise, in stack order.
    const byLayer = strokesByLayer(sketch);
    const clips = clipIndex(sketch);
    const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
    const childrenOf = new Map<string, Layer[]>();
    const topLevel: Layer[] = [];
    for (const layer of sketch.layers) {
      const parent = layer.parent ? byId.get(layer.parent) : undefined;
      if (parent?.group) {
        const siblings = childrenOf.get(parent.id) ?? [];
        siblings.push(layer);
        childrenOf.set(parent.id, siblings);
      } else {
        topLevel.push(layer);
      }
    }
    const emit = (layer: Layer, depth: number): void => {
      const pad = `    ${'  '.repeat(depth)}`;
      body.push(`${pad}open(${str(layer.name)}, ${pct(layer.opacity)});`);
      if (readEffects(layer.effects)) warn(`${page}: an effect is not written to an Illustrator script, so what carries it is drawn plain`);
      if (layer.group) {
        // A clip group: what it holds in a group of its own, clipped by the
        // clip mark drawn on top of it as the clipping path.
        const clip = clips.byGroup.get(layer.id);
        const shape = clip ? runsOf(clip.mark) : null;
        if (shape) body.push(`${pad}  clipOpen();`);
        for (const child of childrenOf.get(layer.id) ?? []) emit(child, depth + 1);
        if (shape) body.push(`${pad}  clipClose(${shape.runs}, ${shape.closed});`);
      } else {
        for (const stroke of byLayer.get(layer.id) ?? []) {
          // A clip mark is its group's clipping path, and paints nothing.
          if (clips.marks.has(stroke.id)) continue;
          for (const line of markLines(stroke, ctx)) body.push(`${pad}  ${line}`);
        }
      }
      body.push(`${pad}close(${layer.visible !== false}, ${layer.locked === true});`);
    };
    for (const layer of topLevel) emit(layer, 0);
  });

  return [
    '//@target illustrator',
    '// A napkin-sketch drawing, rebuilt in Adobe Illustrator.',
    '//',
    '// Run it in Illustrator with File > Scripts > Other Script. Each page opens as',
    '// a document of its own, its artboard the page and a pixel a point, with the',
    "// page's layers as layers, the layers in a group as named groups - a clip",
    '// group clipped by its clipping path - and every mark as a path on its own',
    '// anchors. An image is embedded. A linked file is',
    "// placed by link, found from this script's folder, and one that cannot be",
    '// found or placed is drawn as its placeholder and named when the script ends.',
    '//',
    ...contents,
    '//',
    '// Written by napkin-sketch.',
    '',
    '(function () {',
    RUNTIME,
    '',
    `  var IMAGES = [${images.entries.length > 0 ? `\n${images.entries.join(',\n')}\n  ` : ''}];`,
    `  var FONTS = [${fonts.entries.length > 0 ? `\n${fonts.entries.map((entry) => `    ${entry}`).join(',\n')}\n  ` : ''}];`,
    '',
    '  function build() {',
    ...body,
    '  }',
    '',
    TAIL,
    '})();',
    '',
  ].join('\n');
}
