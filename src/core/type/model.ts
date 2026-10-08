/**
 * The type model: what a text mark's characters and paragraphs look like,
 * beyond the one style it has always had.
 *
 * A text mark keeps its fields - `text`, `fontSize`, `fontFamily`, `color` and
 * `textBoxWidth` - as its **base**: the attributes of every character no run
 * says otherwise of. Everything else lives in one optional field,
 * `Stroke.typeset` ({@link TypeSpec}):
 *
 * - **runs**, sorted and apart, each a stretch of the text and the attributes
 *   it has that the base does not. A gap takes the base. A run that follows a
 *   Text Configuration (core/type/configs.ts) names it, and has as its own
 *   only what it has beyond the base and the configuration - its overrides;
 * - **configs**, the definitions of the configurations the runs follow, as
 *   the book has them;
 * - **paras**, one entry a paragraph (the text split at `\n`), each the
 *   paragraph attributes it has that the defaults do not, or null;
 * - the **kind** - point (Sideless Typing), area (Sheet Typing) in a frame, or
 *   path (Path Typing) along a path - and the orientation.
 *
 * The base is always kept in step with the first character: an edit that
 * restyles the first character moves the base to match and writes the old
 * base into runs where the rest still has it. So a build that knows nothing
 * of `typeset` still sets the text in the style it starts in.
 *
 * Every edit goes the same way - the runs made dense, a full set of
 * attributes for each stretch; the change made; then made sparse again
 * against the new base, neighbours with the same attributes joined - so
 * splitting, joining and keeping the base in step are one rule, not three.
 *
 * A frame's and a path's anchors are kept relative to the mark's anchor,
 * `points[0]`, so whatever moves a mark moves its frame or its path with it.
 *
 * A text mark written before this model - with `textBoxWidth` above 0 - reads
 * as Sheet Typing in a rectangle that grows to fit, which is what its box did
 * (a vector editor's area type with Auto Size). Writing area type in such a
 * rectangle writes `textBoxWidth` back, for a build from before to wrap it.
 */

import { lengthTable } from '../arc-length.js';
import { DEFAULT_FONT_FAMILY, type Stroke, type VectorAnchor } from '../types.js';

/** What a character looks like. Lengths are page pixels; tracking and kerning are thousandths of an em. */
export interface CharAttrs {
  fontFamily: string;
  /** The face's name from the font list: `Regular`, `Bold Italic`. */
  fontStyle: string;
  fontSize: number;
  /** The distance from this line's baseline to the one before it, or `auto`: a line and a quarter of the size. */
  leading: number | 'auto';
  /** The font's own pair kerning, on (`auto`) or off. */
  kerning: 'auto' | 'none';
  /** Kerning by hand after this character, in thousandths of an em. */
  kern: number;
  /** Tracking: space after every character, in thousandths of an em. */
  tracking: number;
  /** A word space's width, as a percent of the font's own: 100 is the font's. */
  wordSpacing: number;
  caps: 'normal' | 'all' | 'small';
  position: 'normal' | 'superscript' | 'subscript';
  /** Horizontal and vertical scale, percent. */
  hScale: number;
  vScale: number;
  /** How far the character sits above its baseline, up positive. */
  baselineShift: number;
  /** Degrees, each character turned about its own middle. */
  rotation: number;
  underline: boolean;
  strike: boolean;
  color: string;
  /** A background behind the characters: code, an accent. */
  highlight?: string;
  /** The Text Configuration the characters follow, by its id. */
  config?: string;
}

/** What a paragraph looks like. */
export interface ParaAttrs {
  align: 'left' | 'center' | 'right' | 'justify';
  leftIndent: number;
  rightIndent: number;
  /** The first line's indent, on top of the left one; below 0 it hangs. */
  firstIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  hyphenate: boolean;
  /** A bulleted or numbered list: its level from 1, its bullet, and the number it counts from. */
  list?: { kind: 'bullet' | 'number'; level: number; marker?: string; start?: number };
  /** A Clean Language Accents language id, or `auto`. */
  accent?: string;
  /** A background behind the whole paragraph: a code block's. */
  shade?: string;
  /** Bars down the paragraph's left, a quote's - their color, and how far each stands in from the line's box. */
  bar?: { color: string; at: number[] };
  /** A rule's color, across the paragraph's line: a Markdown horizontal rule's. */
  rule?: string;
}

/** A stretch of the text, start to end (end not included), and the attributes it has that the base does not. */
export interface TypeRun {
  start: number;
  end: number;
  attrs: Partial<CharAttrs>;
}

/** Sheet Typing's frame: its outline, relative to the mark's anchor, and how the text sits in it. */
export interface TypeFrame {
  anchors: VectorAnchor[];
  /** The frame grows down to fit the text: a vector editor's Auto Size, for a rectangle. */
  autoHeight?: boolean;
  /** How far the text stands in from the frame. */
  inset?: number;
  /** The frame's own paint, under the text. */
  fill?: string;
  stroke?: string;
  width?: number;
}

/** How Path Typing sets its characters along the path: a vector editor's Type on a Path effects. */
export type PathEffect = 'rainbow' | 'skew' | 'ribbon' | 'stair' | 'gravity';

/** Which line of the characters sits on the path. */
export type PathAlign = 'baseline' | 'ascender' | 'descender' | 'center';

/** Path Typing's path, relative to the mark's anchor, and where along it the text runs. */
export interface TypePath {
  anchors: VectorAnchor[];
  closed?: boolean;
  /** Where along the path the text may start and must stop, as lengths from its first anchor. */
  start: number;
  end: number;
  /** The text runs the other way, on the other side. */
  flip?: boolean;
  align: PathAlign;
  effect: PathEffect;
  /**
   * A vector editor's Spacing, page pixels: round a sharp turn the
   * characters are drawn together by this much times the path's curvature
   * there, so they do not fan apart on the outside of a bend. Nothing on a
   * straight stretch; below 0 they are spread instead.
   */
  spacing?: number;
}

/**
 * A Text Configuration: a vector editor's Character Style. A named set of
 * character attributes, kept in the book, which a run of text follows by its
 * id; the run's own attributes override it (core/type/configs.ts).
 */
export interface TextConfig {
  id: string;
  name: string;
  /** The attributes it sets; a text's own stand for the rest. */
  attrs: Partial<CharAttrs>;
}

/** Everything a text mark is beyond its base: see the module's notes. */
export interface TypeSpec {
  kind: 'point' | 'area' | 'path';
  orientation?: 'horizontal' | 'vertical';
  runs?: TypeRun[];
  /**
   * The Text Configurations its runs follow, as the book defines them: a
   * copy, so a text set apart from its book - pasted, imported, rendered
   * alone - still looks as it does in it. The book keeps them in step.
   */
  configs?: TextConfig[];
  paras?: (Partial<ParaAttrs> | null)[];
  frame?: TypeFrame;
  path?: TypePath;
  /** The text is Markdown, set as it renders. */
  flow?: 'markdown';
}

/** Auto leading: a line and a quarter of the size, the line spacing napkin text has always had. A vector editor's is 120%. */
export const AUTO_LEADING = 1.25;

/** The size a text mark has when it says none. */
export const DEFAULT_TEXT_SIZE = 24;

/** The text color a mark has when it says none. */
export const DEFAULT_TEXT_COLOR = '#1f2328';

/** Every character attribute as it is when nothing says otherwise. */
export const DEFAULT_CHAR: Readonly<CharAttrs> = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontStyle: 'Regular',
  fontSize: DEFAULT_TEXT_SIZE,
  leading: 'auto',
  kerning: 'auto',
  kern: 0,
  tracking: 0,
  wordSpacing: 100,
  caps: 'normal',
  position: 'normal',
  hScale: 100,
  vScale: 100,
  baselineShift: 0,
  rotation: 0,
  underline: false,
  strike: false,
  color: DEFAULT_TEXT_COLOR,
};

/** Every paragraph attribute as it is when nothing says otherwise. */
export const DEFAULT_PARA: Readonly<ParaAttrs> = {
  align: 'left',
  leftIndent: 0,
  rightIndent: 0,
  firstIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  hyphenate: false,
};

/** The character attributes, in the order they are written and compared. */
export const CHAR_KEYS = Object.keys(DEFAULT_CHAR).concat(['highlight', 'config']) as Array<keyof CharAttrs>;

/** The paragraph attributes, likewise. */
export const PARA_KEYS = Object.keys(DEFAULT_PARA).concat(['list', 'accent', 'shade', 'bar', 'rule']) as Array<keyof ParaAttrs>;

/** The character attributes a Text Configuration sets: all but kerning by hand, which is a pair's, and the link itself. */
export const CONFIG_KEYS = CHAR_KEYS.filter((key) => key !== 'kern' && key !== 'config');

/** The longest name a Text Configuration takes. */
export const CONFIG_NAME_MAX = 120;

// ---- Ranges ----------------------------------------------------------------------------------------

/** One point in pixels: a vector editor's sizes are in points, and a page is in pixels. */
const PX_PER_PT = 4 / 3;

/** A vector editor's ranges, in the model's units. */
export const TYPE_LIMITS = {
  fontSize: { min: 0.1 * PX_PER_PT, max: 1296 * PX_PER_PT },
  tracking: { min: -1000, max: 10000 },
  kern: { min: -1000, max: 10000 },
  scale: { min: 1, max: 10000 },
  leading: { min: 0, max: 5000 },
  baselineShift: { min: -1296, max: 1296 },
  wordSpacing: { min: 0, max: 1000 },
  indent: { min: -1296 * PX_PER_PT, max: 1296 * PX_PER_PT },
  space: { min: 0, max: 1296 * PX_PER_PT },
  pathSpacing: { min: -1296 * PX_PER_PT, max: 1296 * PX_PER_PT },
} as const;

const clamp = (value: number, range: { min: number; max: number }): number => Math.min(range.max, Math.max(range.min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** An angle held to -180 to 180, 180 rather than -180. */
function turn(degrees: number): number {
  if (degrees > -180 && degrees <= 180) return degrees;
  const t = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return t === -180 ? 180 : t;
}

/** Character attributes read from anything, each held to its range; what does not read is left out. */
export function readCharAttrs(raw: unknown): Partial<CharAttrs> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<CharAttrs> = {};
  const L = TYPE_LIMITS;
  if (typeof r.fontFamily === 'string' && r.fontFamily.trim() !== '') out.fontFamily = r.fontFamily;
  if (typeof r.fontStyle === 'string' && r.fontStyle.trim() !== '') out.fontStyle = r.fontStyle;
  if (finite(r.fontSize) && r.fontSize > 0) out.fontSize = clamp(r.fontSize, L.fontSize);
  if (r.leading === 'auto') out.leading = 'auto';
  else if (finite(r.leading)) out.leading = clamp(r.leading, L.leading);
  if (r.kerning === 'auto' || r.kerning === 'none') out.kerning = r.kerning;
  if (finite(r.kern)) out.kern = clamp(r.kern, L.kern);
  if (finite(r.tracking)) out.tracking = clamp(r.tracking, L.tracking);
  if (finite(r.wordSpacing)) out.wordSpacing = clamp(r.wordSpacing, L.wordSpacing);
  if (r.caps === 'normal' || r.caps === 'all' || r.caps === 'small') out.caps = r.caps;
  if (r.position === 'normal' || r.position === 'superscript' || r.position === 'subscript') out.position = r.position;
  if (finite(r.hScale)) out.hScale = clamp(r.hScale, L.scale);
  if (finite(r.vScale)) out.vScale = clamp(r.vScale, L.scale);
  if (finite(r.baselineShift)) out.baselineShift = clamp(r.baselineShift, L.baselineShift);
  if (finite(r.rotation)) out.rotation = turn(r.rotation);
  if (typeof r.underline === 'boolean') out.underline = r.underline;
  if (typeof r.strike === 'boolean') out.strike = r.strike;
  if (typeof r.color === 'string' && r.color.trim() !== '') out.color = r.color;
  if (typeof r.highlight === 'string' && r.highlight.trim() !== '') out.highlight = r.highlight;
  if (typeof r.config === 'string' && r.config.trim() !== '') out.config = r.config;
  return out;
}

/** Paragraph attributes read from anything, likewise. */
export function readParaAttrs(raw: unknown): Partial<ParaAttrs> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<ParaAttrs> = {};
  const L = TYPE_LIMITS;
  if (r.align === 'left' || r.align === 'center' || r.align === 'right' || r.align === 'justify') out.align = r.align;
  if (finite(r.leftIndent)) out.leftIndent = clamp(r.leftIndent, L.indent);
  if (finite(r.rightIndent)) out.rightIndent = clamp(r.rightIndent, L.indent);
  if (finite(r.firstIndent)) out.firstIndent = clamp(r.firstIndent, L.indent);
  if (finite(r.spaceBefore)) out.spaceBefore = clamp(r.spaceBefore, L.space);
  if (finite(r.spaceAfter)) out.spaceAfter = clamp(r.spaceAfter, L.space);
  if (typeof r.hyphenate === 'boolean') out.hyphenate = r.hyphenate;
  if (r.list && typeof r.list === 'object') {
    const l = r.list as Record<string, unknown>;
    if (l.kind === 'bullet' || l.kind === 'number') {
      out.list = {
        kind: l.kind,
        level: finite(l.level) ? Math.min(9, Math.max(1, Math.round(l.level))) : 1,
        ...(typeof l.marker === 'string' && l.marker !== '' ? { marker: l.marker } : {}),
        ...(finite(l.start) && l.start >= 0 ? { start: Math.round(l.start) } : {}),
      };
    }
  }
  if (typeof r.accent === 'string' && r.accent !== '') out.accent = r.accent;
  if (typeof r.shade === 'string' && r.shade !== '') out.shade = r.shade;
  if (r.bar && typeof r.bar === 'object') {
    const b = r.bar as Record<string, unknown>;
    const at = Array.isArray(b.at) ? b.at.filter(finite).slice(0, 9).map((x) => clamp(x, L.indent)) : [];
    if (typeof b.color === 'string' && b.color !== '' && at.length > 0) out.bar = { color: b.color, at };
  }
  if (typeof r.rule === 'string' && r.rule !== '') out.rule = r.rule;
  return out;
}

/** Whether two Text Configuration names are one name: alike once trimmed, in any case. */
export function sameConfigName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A Text Configuration read from anything: an id, a name, and the attributes it may set, each held to its range. Null when it is not one. */
export function readTextConfig(raw: unknown): TextConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.trim() === '' || typeof r.name !== 'string' || r.name.trim() === '') return null;
  const read = readCharAttrs(r.attrs);
  const attrs: Partial<CharAttrs> = {};
  for (const key of CONFIG_KEYS) if (read[key] !== undefined) (attrs as Record<string, unknown>)[key] = read[key];
  return { id: r.id, name: r.name.trim().slice(0, CONFIG_NAME_MAX), attrs };
}

/**
 * A list of Text Configurations read from anything, each id once - and with
 * `uniqueNames`, each name once, as a book's list has them: a later repeat is
 * dropped.
 */
export function readTextConfigs(raw: unknown, uniqueNames = true): TextConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: TextConfig[] = [];
  for (const entry of raw) {
    const config = readTextConfig(entry);
    if (!config || out.some((each) => each.id === config.id || (uniqueNames && sameConfigName(each.name, config.name)))) continue;
    out.push(config);
  }
  return out;
}

/** The Text Configurations a typeset carries, by id, and any `extra` ones over them. */
function configTable(spec: TypeSpec | undefined, extra: readonly TextConfig[] = []): Map<string, TextConfig> {
  const table = new Map<string, TextConfig>();
  for (const config of spec?.configs ?? []) table.set(config.id, config);
  for (const config of extra) table.set(config.id, config);
  return table;
}

/** A path's anchors as a file holds them, or null when they are not anchors: each `p` a point, its handles optional. */
function readAnchors(raw: unknown): VectorAnchor[] | null {
  if (!Array.isArray(raw)) return null;
  const point = (v: unknown): { x: number; y: number } | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    return finite(o.x) && finite(o.y) ? { x: o.x, y: o.y } : null;
  };
  const anchors: VectorAnchor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const a = entry as Record<string, unknown>;
    const p = point(a.p);
    if (!p) return null;
    const hIn = point(a.hIn);
    const hOut = point(a.hOut);
    anchors.push({ p, ...(hIn ? { hIn } : {}), ...(hOut ? { hOut } : {}), ...(a.move === true ? { move: true as const } : {}) });
  }
  return anchors;
}

const PATH_EFFECTS: readonly PathEffect[] = ['rainbow', 'skew', 'ribbon', 'stair', 'gravity'];
const PATH_ALIGNS: readonly PathAlign[] = ['baseline', 'ascender', 'descender', 'center'];

/**
 * A text mark's `typeset` as a file holds it, made sound for `text`: every
 * number held to its range, runs cut to the text and apart, paragraph entries
 * one a paragraph. Undefined when nothing of it reads; a frame or a path that
 * does not read leaves its kind as point type.
 */
export function readTypeset(raw: unknown, text: string): TypeSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const spec: TypeSpec = { kind: 'point' };
  if (r.orientation === 'vertical') spec.orientation = 'vertical';
  if (r.kind === 'area' && r.frame && typeof r.frame === 'object') {
    const f = r.frame as Record<string, unknown>;
    const anchors = readAnchors(f.anchors);
    if (anchors && anchors.length >= 2) {
      spec.kind = 'area';
      spec.frame = {
        anchors,
        ...(f.autoHeight === true ? { autoHeight: true } : {}),
        ...(finite(f.inset) && f.inset > 0 ? { inset: Math.min(f.inset, 5000) } : {}),
        ...(typeof f.fill === 'string' && f.fill !== '' ? { fill: f.fill } : {}),
        ...(typeof f.stroke === 'string' && f.stroke !== '' ? { stroke: f.stroke } : {}),
        ...(finite(f.width) && f.width > 0 ? { width: Math.min(f.width, 1000) } : {}),
      };
    }
  } else if (r.kind === 'path' && r.path && typeof r.path === 'object') {
    const p = r.path as Record<string, unknown>;
    const anchors = readAnchors(p.anchors);
    if (anchors && anchors.length >= 2) {
      const start = finite(p.start) ? Math.max(0, p.start) : 0;
      const end = finite(p.end) ? Math.max(start, p.end) : Number.MAX_SAFE_INTEGER;
      spec.kind = 'path';
      spec.path = {
        anchors,
        ...(p.closed === true ? { closed: true } : {}),
        start,
        end,
        ...(p.flip === true ? { flip: true } : {}),
        align: PATH_ALIGNS.includes(p.align as PathAlign) ? (p.align as PathAlign) : 'baseline',
        effect: PATH_EFFECTS.includes(p.effect as PathEffect) ? (p.effect as PathEffect) : 'rainbow',
        ...(finite(p.spacing) && p.spacing !== 0 ? { spacing: clamp(p.spacing, TYPE_LIMITS.pathSpacing) } : {}),
      };
    }
  }
  if (Array.isArray(r.runs)) {
    const runs: TypeRun[] = [];
    for (const entry of r.runs) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (!finite(e.start) || !finite(e.end)) continue;
      const attrs = readCharAttrs(e.attrs);
      if (Object.keys(attrs).length === 0) continue;
      runs.push({ start: Math.round(e.start), end: Math.round(e.end), attrs });
    }
    const sound = soundRuns(runs, text.length);
    if (sound.length > 0) spec.runs = sound;
  }
  // The configurations the runs follow; one no run follows goes when the mark is settled.
  const configs = readTextConfigs(r.configs, false);
  if (configs.length > 0) spec.configs = configs;
  if (Array.isArray(r.paras)) {
    const paras = r.paras.slice(0, paragraphCount(text)).map((entry) => {
      const attrs = entry === null ? {} : readParaAttrs(entry);
      return Object.keys(attrs).length > 0 ? attrs : null;
    });
    const kept = trimParas(paras);
    if (kept) spec.paras = kept;
  }
  if (r.flow === 'markdown') spec.flow = 'markdown';
  return spec;
}

/** Runs sorted, cut to the text, apart - a later run giving way where an earlier one already is - and none empty. */
function soundRuns(runs: readonly TypeRun[], length: number): TypeRun[] {
  const sorted = runs
    .map((run) => ({ start: Math.max(0, Math.min(length, run.start)), end: Math.max(0, Math.min(length, run.end)), attrs: run.attrs }))
    .filter((run) => run.end > run.start)
    .sort((a, b) => a.start - b.start);
  const out: TypeRun[] = [];
  let reached = 0;
  for (const run of sorted) {
    const start = Math.max(run.start, reached);
    if (run.end <= start) continue;
    out.push({ start, end: run.end, attrs: run.attrs });
    reached = run.end;
  }
  return out;
}

/** Paragraph entries with the trailing empty ones dropped; undefined when none is left. */
function trimParas(paras: (Partial<ParaAttrs> | null)[]): (Partial<ParaAttrs> | null)[] | undefined {
  let end = paras.length;
  while (end > 0 && paras[end - 1] === null) end--;
  return end > 0 ? paras.slice(0, end) : undefined;
}

// ---- Reading a mark -----------------------------------------------------------------------------------

/** How many paragraphs a text has: one more than its newlines. */
export function paragraphCount(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Where each paragraph is in a text: start to end, the newline after it not included. */
export function paragraphRanges(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      out.push({ start, end: i });
      start = i + 1;
    }
  }
  return out;
}

/** The paragraph a place in the text is in. */
export function paragraphAt(text: string, index: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(index, text.length); i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The rectangle a box of width `width` and height `height` is, as anchors from its top-left. */
export function rectangleAnchors(width: number, height: number): VectorAnchor[] {
  return [{ p: { x: 0, y: 0 } }, { p: { x: width, y: 0 } }, { p: { x: width, y: height } }, { p: { x: 0, y: height } }];
}

/** A rectangle's box, when a frame's anchors are one - four corners, straight sides, square to the page - or null. */
export function frameRectangle(anchors: readonly VectorAnchor[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (anchors.length !== 4 || anchors.some((a) => a.move || (a.hIn && (a.hIn.x !== a.p.x || a.hIn.y !== a.p.y)) || (a.hOut && (a.hOut.x !== a.p.x || a.hOut.y !== a.p.y)))) return null;
  const xs = [...new Set(anchors.map((a) => a.p.x))];
  const ys = [...new Set(anchors.map((a) => a.p.y))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  for (let i = 0; i < 4; i++) {
    const a = anchors[i].p;
    const b = anchors[(i + 1) % 4].p;
    if (a.x !== b.x && a.y !== b.y) return null;
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * The type a mark is set as: its `typeset`, or for a mark from before it, as
 * it always was - point type, or with a box of fixed width, area type in a
 * rectangle that grows down to fit.
 */
export function typeSpecOf(stroke: Stroke): TypeSpec {
  if (stroke.typeset) return stroke.typeset;
  const box = stroke.textBoxWidth ?? 0;
  if (box > 0) {
    const size = stroke.fontSize ?? DEFAULT_TEXT_SIZE;
    return { kind: 'area', frame: { anchors: rectangleAnchors(box, size * AUTO_LEADING), autoHeight: true } };
  }
  return { kind: 'point' };
}

/** A mark's base attributes: the defaults, with its own size, family and color. */
export function baseAttrs(stroke: Stroke): CharAttrs {
  return {
    ...DEFAULT_CHAR,
    ...(stroke.fontSize !== undefined && stroke.fontSize > 0 ? { fontSize: stroke.fontSize } : {}),
    ...(stroke.fontFamily ? { fontFamily: stroke.fontFamily } : {}),
    ...(stroke.color ? { color: stroke.color } : {}),
  };
}

/** A stretch of the text with every one of its attributes. */
export interface StyleSegment {
  start: number;
  end: number;
  attrs: CharAttrs;
}

/**
 * The whole text as stretches of one style each, gaps and all, in order: none
 * for empty text. A stretch that follows a Text Configuration has its
 * attributes as base, then configuration, then its own.
 */
export function styleSegments(stroke: Stroke): StyleSegment[] {
  const text = stroke.text ?? '';
  const base = baseAttrs(stroke);
  const table = configTable(stroke.typeset);
  const out: StyleSegment[] = [];
  let at = 0;
  for (const run of stroke.typeset?.runs ?? []) {
    if (run.start > at) out.push({ start: at, end: run.start, attrs: base });
    const config = run.attrs.config !== undefined ? table.get(run.attrs.config) : undefined;
    out.push({ start: run.start, end: run.end, attrs: config ? { ...base, ...config.attrs, ...run.attrs } : { ...base, ...run.attrs } });
    at = run.end;
  }
  if (at < text.length) out.push({ start: at, end: text.length, attrs: base });
  return out.filter((segment) => segment.end > segment.start);
}

/** The attributes of the character at `index` - or, past the end, of the last one; with no text, the base. */
export function charAttrsAt(stroke: Stroke, index: number): CharAttrs {
  const segments = styleSegments(stroke);
  if (segments.length === 0) return baseAttrs(stroke);
  for (const segment of segments) if (index < segment.end) return segment.attrs;
  return segments[segments.length - 1].attrs;
}

/** A paragraph's attributes, the defaults filled in. */
export function paraAttrsOf(stroke: Stroke, paragraph: number): ParaAttrs {
  return { ...DEFAULT_PARA, ...(stroke.typeset?.paras?.[paragraph] ?? {}) };
}

// ---- Editing ----------------------------------------------------------------------------------------------

/** A stretch of the text: start to end, end not included. */
export interface TextRange {
  start: number;
  end: number;
}

/** Whether two attribute values are the same: a missing optional one equals a missing one. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** The attributes of `attrs` that `base` does not have, in the keys' order. */
function differences<T extends object>(attrs: Partial<T>, base: Partial<T>, keys: ReadonlyArray<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    const value = attrs[key];
    if (value === undefined) continue;
    if (!same(value, base[key])) out[key] = value;
  }
  return out;
}

/**
 * A mark made sound from dense stretches of style: its base moved to the
 * first character's size, family and color, and its runs the stretches'
 * differences from that base, neighbours joined. A rectangle frame that grows
 * to fit writes its width into `textBoxWidth` for a build from before.
 *
 * A stretch that follows a Text Configuration keeps its link and what it has
 * beyond the base and the configuration - its overrides - so the
 * configuration can be changed under it. The base follows the first
 * character as it would be with no configuration: what the configuration
 * gives it is the configuration's. A link to a configuration it has no
 * definition of - in the typeset or in `configs` - goes; the stretch keeps its
 * look. The typeset carries the definitions of those its runs follow.
 */
function settle(stroke: Stroke, segments: readonly StyleSegment[], typeset: TypeSpec, configs: readonly TextConfig[] = []): Stroke {
  const out: Stroke = { ...stroke };
  const table = configTable(typeset, configs);
  const linked = (attrs: CharAttrs): TextConfig | undefined => (attrs.config !== undefined ? table.get(attrs.config) : undefined);
  const first = segments[0]?.attrs;
  if (first) {
    const was = baseAttrs(stroke);
    const config = linked(first);
    // A value the configuration gives the first character is not the character's own: the base keeps what is under it.
    const own = <K extends 'fontSize' | 'fontFamily' | 'color'>(key: K): CharAttrs[K] =>
      config && config.attrs[key] !== undefined && same(first[key], config.attrs[key]) ? was[key] : first[key];
    out.fontSize = own('fontSize');
    out.fontFamily = own('fontFamily');
    out.color = own('color');
  }
  const base = baseAttrs(out);
  const runs: TypeRun[] = [];
  const used: TextConfig[] = [];
  for (const segment of segments) {
    const config = linked(segment.attrs);
    const attrs = differences(segment.attrs, config ? { ...base, ...config.attrs } : base, CHAR_KEYS);
    if (config && !used.includes(config)) used.push(config);
    if (!config) delete attrs.config;
    if (Object.keys(attrs).length === 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === segment.start && same(last.attrs, attrs)) last.end = segment.end;
    else runs.push({ start: segment.start, end: segment.end, attrs });
  }
  // A Markdown Flow text keeps the configurations its Markdown is shown in, which no run of its source names.
  if (typeset.flow === 'markdown') {
    for (const config of typeset.configs ?? []) if (!used.some((each) => each.id === config.id)) used.push(table.get(config.id) ?? config);
  }
  // Each paragraph's attributes in the keys' order, and the typeset's fields in one order, so one typeset is one string.
  const paras = typeset.paras
    ? trimParas(typeset.paras.map((entry) => {
      const kept = entry ? differences<ParaAttrs>(entry, {}, PARA_KEYS) : {};
      return Object.keys(kept).length > 0 ? kept : null;
    }))
    : undefined;
  const next: TypeSpec = {
    kind: typeset.kind,
    ...(typeset.orientation ? { orientation: typeset.orientation } : {}),
    ...(runs.length > 0 ? { runs } : {}),
    ...(used.length > 0 ? { configs: used.map((config) => ({ id: config.id, name: config.name, attrs: differences<CharAttrs>(config.attrs, {}, CONFIG_KEYS) })) } : {}),
    ...(paras ? { paras } : {}),
    ...(typeset.frame ? { frame: typeset.frame } : {}),
    ...(typeset.path ? { path: typeset.path } : {}),
    ...(typeset.flow ? { flow: typeset.flow } : {}),
  };
  // A plain point text needs no typeset at all; nor does one that says no more than a text box
  // from before - a rectangle from the anchor that grows to fit, and nothing else - which is its width.
  const rect = next.kind === 'area' && next.frame?.autoHeight ? frameRectangle(next.frame.anchors) : null;
  const bare = !next.orientation && !next.runs && !next.paras && !next.flow;
  const frame = next.frame;
  const boxOnly = rect !== null && rect.minX === 0 && rect.minY === 0 && frame !== undefined && frame.inset === undefined && frame.fill === undefined && frame.stroke === undefined && frame.width === undefined;
  if (bare && (next.kind === 'point' || boxOnly)) delete out.typeset;
  else out.typeset = next;
  if (rect) out.textBoxWidth = rect.maxX - rect.minX;
  else if (stroke.typeset || next.kind !== 'point') delete out.textBoxWidth;
  return out;
}

/**
 * A mark's typeset made explicit - its kind and frame as {@link typeSpecOf}
 * reads them - so an edit to a mark from before keeps its box as a frame.
 */
function explicit(stroke: Stroke): TypeSpec {
  const spec = typeSpecOf(stroke);
  return { ...spec, ...(spec.runs ? { runs: spec.runs.map((run) => ({ ...run, attrs: { ...run.attrs } })) } : {}) };
}

/**
 * Restyles the characters in `range` with `patch`, splitting runs at its ends
 * and joining any that come out alike. A value the characters already have
 * changes nothing; the base follows the first character. A patch that links
 * a Text Configuration the text does not follow yet comes with its
 * definition in `configs`; an explicit `config: undefined` takes the link off.
 */
export function applyChar(stroke: Stroke, range: TextRange, patch: Partial<CharAttrs>, configs: readonly TextConfig[] = []): Stroke {
  const clean = readCharAttrs(patch);
  const unlink = 'config' in patch && patch.config === undefined;
  if (Object.keys(clean).length === 0 && !unlink) return stroke;
  return restyleText(
    stroke,
    range,
    (attrs) => {
      const next = { ...attrs, ...clean };
      if (unlink) delete next.config;
      return next;
    },
    configs,
  );
}

/**
 * Restyles the characters in `range` stretch by stretch: each takes what
 * `restyle` makes of its attributes - a configuration's link among them, its
 * definition in the typeset or in `configs` - and the text is settled again.
 * The text itself when the range is empty.
 */
export function restyleText(stroke: Stroke, range: TextRange, restyle: (attrs: CharAttrs) => CharAttrs, configs: readonly TextConfig[] = []): Stroke {
  const text = stroke.text ?? '';
  const start = Math.max(0, Math.min(text.length, range.start));
  const end = Math.max(start, Math.min(text.length, range.end));
  if (end === start) return stroke;
  const segments: StyleSegment[] = [];
  for (const segment of styleSegments(stroke)) {
    // Each stretch cut at the range's ends, the part inside restyled.
    const cuts = [segment.start, Math.max(segment.start, Math.min(segment.end, start)), Math.max(segment.start, Math.min(segment.end, end)), segment.end];
    for (let k = 0; k < 3; k++) {
      if (cuts[k + 1] <= cuts[k]) continue;
      const inside = k === 1;
      segments.push({ start: cuts[k], end: cuts[k + 1], attrs: inside ? restyle(segment.attrs) : segment.attrs });
    }
  }
  return settle(stroke, segments, explicit(stroke), configs);
}

/**
 * A mark whose characters take the colors `colors` gives them, one a
 * character or none - a code accent's - over their own, the text settled in
 * one pass. The mark itself when no color changes.
 */
export function recolorText(stroke: Stroke, colors: ReadonlyArray<string | undefined>): Stroke {
  const segments: StyleSegment[] = [];
  let changed = false;
  for (const segment of styleSegments(stroke)) {
    const colorOf = (i: number): string => colors[i] ?? segment.attrs.color;
    let from = segment.start;
    for (let i = segment.start + 1; i <= segment.end; i++) {
      if (i < segment.end && colorOf(i) === colorOf(from)) continue;
      const color = colorOf(from);
      if (color !== segment.attrs.color) changed = true;
      segments.push({ start: from, end: i, attrs: color === segment.attrs.color ? segment.attrs : { ...segment.attrs, color } });
      from = i;
    }
  }
  return changed ? settle(stroke, segments, explicit(stroke)) : stroke;
}

/**
 * Sets paragraph attributes on every paragraph `range` touches: a paragraph
 * edit takes whole paragraphs, as a vector editor's does. A value equal to the
 * default is taken away.
 */
export function applyPara(stroke: Stroke, range: TextRange, patch: Partial<ParaAttrs>): Stroke {
  const text = stroke.text ?? '';
  const first = paragraphAt(text, Math.max(0, range.start));
  const last = paragraphAt(text, Math.max(range.start, range.end));
  const clean = readParaAttrs(patch);
  // An explicit undefined takes a list, an accent or a shade off.
  const cleared = (['list', 'accent', 'shade'] as const).filter((key) => key in patch && patch[key] === undefined);
  if (Object.keys(clean).length === 0 && cleared.length === 0) return stroke;
  const spec = explicit(stroke);
  const paras = [...(spec.paras ?? [])];
  while (paras.length < paragraphCount(text)) paras.push(null);
  for (let p = first; p <= last; p++) {
    const merged: Partial<ParaAttrs> = { ...(paras[p] ?? {}), ...clean };
    for (const key of cleared) delete merged[key];
    const kept = differences<ParaAttrs>(merged, DEFAULT_PARA, PARA_KEYS);
    paras[p] = Object.keys(kept).length > 0 ? kept : null;
  }
  spec.paras = paras;
  return settle(stroke, styleSegments(stroke), spec);
}

/**
 * Replaces `from` to `to` of the text with `inserted`. The runs after it
 * shift; what is typed takes the attributes of the character before it, or at
 * the very start those of the character after it, as a vector editor's typing
 * does - all but its kerning by hand, which is between it and its neighbour.
 * Paragraphs the range joins keep the first one's attributes, and paragraphs
 * the insert splits off take them too.
 */
export function spliceText(stroke: Stroke, from: number, to: number, inserted: string): Stroke {
  const text = stroke.text ?? '';
  const a = Math.max(0, Math.min(text.length, from));
  const b = Math.max(a, Math.min(text.length, to));
  const next = text.slice(0, a) + inserted + text.slice(b);
  const old = styleSegments(stroke);
  // Kerning by hand is a pair's: what is typed beside a kerned character does not take it.
  const typed = { ...(a > 0 ? charAttrsAt(stroke, a - 1) : b < text.length ? charAttrsAt(stroke, b) : baseAttrs(stroke)), kern: 0 };
  const delta = inserted.length - (b - a);
  const segments: StyleSegment[] = [];
  for (const segment of old) {
    // The part before the range, and the part after it, shifted.
    if (segment.start < a) segments.push({ start: segment.start, end: Math.min(segment.end, a), attrs: segment.attrs });
    if (segment.end > b) segments.push({ start: Math.max(segment.start, b) + delta, end: segment.end + delta, attrs: segment.attrs });
  }
  if (inserted.length > 0) segments.push({ start: a, end: a + inserted.length, attrs: typed });
  segments.sort((x, y) => x.start - y.start);
  // Paragraphs: those the range touches become one, and the insert's newlines split it again, all alike.
  const spec = explicit(stroke);
  if (spec.paras) {
    const firstPara = paragraphAt(text, a);
    const lastPara = paragraphAt(text, b);
    const made = paragraphCount(inserted);
    const paras = [...spec.paras];
    while (paras.length < paragraphCount(text)) paras.push(null);
    const kept = paras[firstPara] ?? null;
    paras.splice(firstPara, lastPara - firstPara + 1, ...new Array<Partial<ParaAttrs> | null>(made).fill(kept));
    spec.paras = paras;
  }
  return settle({ ...stroke, text: next }, segments, spec);
}

/**
 * Sets a mark's typeset as it is given - its kind, frame or path, runs and
 * paragraphs - made sound and in step with the base: what the script and the
 * readers build a mark with.
 */
export function withTypeset(stroke: Stroke, typeset: TypeSpec): Stroke {
  const text = stroke.text ?? '';
  const read = readTypeset(typeset, text) ?? { kind: 'point' };
  const withRuns: Stroke = { ...stroke, typeset: read };
  return settle(withRuns, styleSegments(withRuns), read);
}

/**
 * A stretch of a text as the clipboard carries it between texts: its text,
 * each stretch's every attribute, from 0, and the Text Configurations they
 * follow.
 */
export interface TypeClip {
  text: string;
  runs: Array<{ start: number; end: number; attrs: CharAttrs }>;
  configs?: TextConfig[];
}

/** The stretch from `start` to `end` of a text, as the clipboard carries it. */
export function clipOf(stroke: Stroke, start: number, end: number): TypeClip {
  const text = stroke.text ?? '';
  const a = Math.max(0, Math.min(text.length, start));
  const b = Math.max(a, Math.min(text.length, end));
  const runs = styleSegments(stroke)
    .filter((segment) => segment.end > a && segment.start < b)
    .map((segment) => ({ start: Math.max(segment.start, a) - a, end: Math.min(segment.end, b) - a, attrs: { ...segment.attrs } }));
  const followed = new Set(runs.flatMap((run) => (run.attrs.config !== undefined ? [run.attrs.config] : [])));
  const configs = (stroke.typeset?.configs ?? []).filter((config) => followed.has(config.id));
  return { text: text.slice(a, b), runs, ...(configs.length > 0 ? { configs } : {}) };
}

/**
 * Replaces `from` to `to` of a text with a clip, each of its runs taking its
 * own attributes - and the Text Configuration it follows - : a paste of what
 * was copied from a text.
 */
export function spliceClip(stroke: Stroke, from: number, to: number, clip: TypeClip): Stroke {
  const at = Math.max(0, Math.min((stroke.text ?? '').length, from));
  let out = spliceText(stroke, from, to, clip.text);
  // Each run's attributes whole: a run that follows no configuration does not take the one typing there would.
  for (const run of clip.runs) out = restyleText(out, { start: at + run.start, end: at + run.end }, () => ({ ...run.attrs }), clip.configs);
  return out;
}

/** The attributes {@link stepChar} steps. */
export type SteppedAttr = 'fontSize' | 'leading' | 'tracking' | 'kern' | 'baselineShift';

/**
 * Steps an attribute by `by` on every character of a range, each from what it
 * has: a size up by 2 points, a shift down by 2. Auto leading steps from the
 * leading it stands for. Held to the attribute's range.
 */
export function stepChar(stroke: Stroke, range: TextRange, key: SteppedAttr, by: number): Stroke {
  let out = stroke;
  for (const segment of styleSegments(stroke)) {
    const start = Math.max(segment.start, range.start);
    const end = Math.min(segment.end, range.end);
    if (end <= start) continue;
    const attrs = segment.attrs;
    const now = key === 'leading' ? (attrs.leading === 'auto' ? AUTO_LEADING * attrs.fontSize : attrs.leading) : attrs[key];
    out = applyChar(out, { start, end }, { [key]: now + by });
  }
  return out;
}

/**
 * What recolors a text mark whole, as a vector editor recolors a selected
 * text object: its base color, and its runs' own colors taken off. A
 * highlight stays, being a background rather than the text's color.
 */
export function textColorPatch(stroke: Stroke, color: string): Partial<Stroke> {
  // A run colored by a configuration it follows is colored too, as its override.
  const table = configTable(stroke.typeset);
  const colored = (run: TypeRun): boolean => run.attrs.color !== undefined || (run.attrs.config !== undefined && table.get(run.attrs.config)?.attrs.color !== undefined);
  if (!stroke.typeset?.runs?.some(colored)) return { color };
  const next = applyChar({ ...stroke, color }, { start: 0, end: (stroke.text ?? '').length }, { color });
  return { color: next.color, typeset: next.typeset };
}

// ---- Transforming -----------------------------------------------------------------------------------------

/** A typeset with its frame's or its path's anchors - relative to the mark's - each moved by `move`, handles and all. */
export function mapTypesetAnchors(spec: TypeSpec, move: (p: { x: number; y: number }) => { x: number; y: number }): TypeSpec {
  const map = (anchors: readonly VectorAnchor[]): VectorAnchor[] =>
    anchors.map((a) => ({ ...a, p: move(a.p), ...(a.hIn ? { hIn: move(a.hIn) } : {}), ...(a.hOut ? { hOut: move(a.hOut) } : {}) }));
  return {
    ...spec,
    ...(spec.frame ? { frame: { ...spec.frame, anchors: map(spec.frame.anchors) } } : {}),
    ...(spec.path ? { path: { ...spec.path, anchors: map(spec.path.anchors) } } : {}),
  };
}

/**
 * Whether a mark's frame or path is a shape that turns and mirrors with the
 * mark: a path, or a frame that is not a rectangle. A rectangle - a text box -
 * stays square to the page, its text upright, as text boxes always have.
 */
export function typesetIsShape(spec: TypeSpec | undefined): boolean {
  if (!spec) return false;
  if (spec.kind === 'path') return spec.path !== undefined;
  return spec.kind === 'area' && spec.frame !== undefined && frameRectangle(spec.frame.anchors) === null;
}

/**
 * A typeset scaled with its mark by `sx` and `sy`: its frame or its path
 * about the mark's anchor - its anchors are relative to it - and every length
 * a character or a paragraph has by their mean, as the base size is. A path's
 * start and end keep their share of its length.
 */
export function scaleTypeset(spec: TypeSpec, sx: number, sy: number): TypeSpec {
  const k = (sx + sy) / 2;
  const m = Math.abs(k);
  const out = mapTypesetAnchors(spec, (p) => ({ x: p.x * sx, y: p.y * sy }));
  if (spec.runs) {
    const table = configTable(spec);
    out.runs = spec.runs.map((run) => {
      const attrs: Partial<CharAttrs> = { ...run.attrs };
      // A length a configuration gives is scaled as the run's own: an override, as a vector editor's scaled text shows one.
      const config = attrs.config !== undefined ? table.get(attrs.config) : undefined;
      if (config && k !== 1) {
        if (attrs.fontSize === undefined && config.attrs.fontSize !== undefined) attrs.fontSize = config.attrs.fontSize;
        if (attrs.leading === undefined && typeof config.attrs.leading === 'number') attrs.leading = config.attrs.leading;
        if (attrs.baselineShift === undefined && config.attrs.baselineShift !== undefined && config.attrs.baselineShift !== 0) attrs.baselineShift = config.attrs.baselineShift;
      }
      if (attrs.fontSize !== undefined) attrs.fontSize = Math.min(TYPE_LIMITS.fontSize.max, Math.max(1, attrs.fontSize * k));
      if (typeof attrs.leading === 'number') attrs.leading = clamp(attrs.leading * m, TYPE_LIMITS.leading);
      if (attrs.baselineShift !== undefined) attrs.baselineShift = clamp(attrs.baselineShift * m, TYPE_LIMITS.baselineShift);
      return { ...run, attrs };
    });
  }
  if (spec.paras) {
    out.paras = spec.paras.map((para) => {
      if (!para) return null;
      const next: Partial<ParaAttrs> = { ...para };
      for (const key of ['leftIndent', 'rightIndent', 'firstIndent'] as const) {
        const value = next[key];
        if (value !== undefined) next[key] = clamp(value * m, TYPE_LIMITS.indent);
      }
      for (const key of ['spaceBefore', 'spaceAfter'] as const) {
        const value = next[key];
        if (value !== undefined) next[key] = clamp(value * m, TYPE_LIMITS.space);
      }
      return next;
    });
  }
  if (out.frame) {
    if (out.frame.inset !== undefined) out.frame.inset = out.frame.inset * m;
    if (out.frame.width !== undefined) out.frame.width = out.frame.width * m;
  }
  if (spec.path && out.path) out.path = rescaledPath(spec.path, out.path, m);
  return out;
}

/** A path scaled to `next`'s anchors: its start, end and spacing keep their share of its length. */
function rescaledPath(was: TypePath, next: TypePath, fallback: number): TypePath {
  const closed = was.closed === true;
  const before = lengthTable(was.anchors, closed).total;
  const after = lengthTable(next.anchors, closed).total;
  const share = before > 0 ? after / before : fallback;
  return {
    ...next,
    start: was.start * share,
    ...(was.end < Number.MAX_SAFE_INTEGER ? { end: was.end * share } : {}),
    ...(was.spacing !== undefined ? { spacing: was.spacing * share } : {}),
  };
}

/**
 * A typeset's frame or path scaled with its mark, and nothing else: Sheet
 * and Path Typing keep their type's size when the shape they are set in is
 * scaled, and the text reflows in it, as a vector editor's area type and type
 * on a path do. A path's start, end and spacing keep their share of its
 * length.
 */
export function scaleTypeShape(spec: TypeSpec, sx: number, sy: number): TypeSpec {
  const out = mapTypesetAnchors(spec, (p) => ({ x: p.x * sx, y: p.y * sy }));
  if (spec.path && out.path) out.path = rescaledPath(spec.path, out.path, Math.abs((sx + sy) / 2));
  return out;
}

/**
 * A typeset mirrored with its mark: its frame or its path reflected about the
 * mark's anchor. Text stays readable, so a path mirrored left to right runs
 * the other way - its `flip` turned over - and its start and end, lengths
 * along it, stay where they are.
 */
export function mirrorTypeset(spec: TypeSpec, flipX: boolean, flipY: boolean): TypeSpec {
  const out = mapTypesetAnchors(spec, (p) => ({ x: flipX ? -p.x : p.x, y: flipY ? -p.y : p.y }));
  if (out.path && flipX) {
    if (out.path.flip) delete out.path.flip;
    else out.path.flip = true;
  }
  return out;
}
