/**
 * Markdown Flow: a text typed as Markdown, and shown as Markdown renders -
 * headings, emphasis, code, lists, task lists, quotes, rules, links and
 * tables - with no HTML made or read on the way.
 *
 * The text keeps its Markdown, its **source**, in `text`, and its
 * `typeset.flow` is `markdown`. What it shows, its **display**, is made from
 * the source by {@link markdownToType}: a Markdown lexer's tokens - marked's,
 * which `napkin-sketch/markdown`, the app and the command line register with
 * {@link setMarkdownLexer}, the core importing none - turned into display
 * text, runs, paragraph attributes and a **source map**, the place in the
 * source each display character came from. The layout lays the display out
 * (core/type/layout.ts); the editor's caret, which moves through the source,
 * finds its place in it by the map.
 *
 * While a text is edited, the blocks the caret or the selection is in - a
 * paragraph, a heading, a list item, a quote, a code block, a table, or the
 * blank lines between them - are shown as their source, the Markdown's own
 * characters muted, and every other block as it renders
 * ({@link setMarkdownReveal}). Output - SVG, PDF, an Illustrator script - is
 * made with every block rendered ({@link withoutMarkdownReveal}). With no
 * lexer registered, the source is shown as it is, as a build from before
 * shows it.
 *
 * A fenced code block that names its language comes from the lexer as
 * highlight.js's HTML, which is read into colors and never rendered
 * (core/type/accents.ts); every code block sits on the accent theme's shade.
 *
 * Headings, code, quotes and links follow Text Configurations -
 * `Markdown Heading 1` to `6`, `Markdown Code`, `Markdown Code Block`,
 * `Markdown Quote` and `Markdown Link` - which every Markdown text carries
 * and its book keeps ({@link withMarkdownConfigs}), so restyling Markdown is
 * restyling a configuration. A heading's size is its level's share of the
 * text's own size, unless its configuration sets a size.
 */

import type { Stroke } from '../types.js';
import { ACCENT_THEMES, accentGeneration, accentHighlighter, accentShown, currentAccentTheme, hljsHtmlToRuns, type AccentTheme } from './accents.js';
import { HEADLESS_MEASURE, type TypeFont, type TypeMeasure } from './measure.js';
import {
  DEFAULT_CHAR,
  TYPE_LIMITS,
  baseAttrs,
  readTextConfig,
  sameConfigName,
  withTypeset,
  type CharAttrs,
  type ParaAttrs,
  type TextConfig,
  type TypeRun,
} from './model.js';

// ---- The lexer -------------------------------------------------------------------------------------------------------

/** A Markdown token as a lexer gives it: marked's, with GitHub's tables, task lists and strikethrough, a single newline a line break. */
export interface MarkdownToken {
  type: string;
  raw: string;
  text?: string;
  tokens?: MarkdownToken[];
  /** A heading's level. */
  depth?: number;
  /** A list's. */
  ordered?: boolean;
  start?: number | '';
  loose?: boolean;
  items?: MarkdownToken[];
  /** A list item's: a task's box, and whether it is ticked. */
  task?: boolean;
  checked?: boolean;
  /** A code block's: indented, or fenced; the language its fence names; and whether a highlighter made its text HTML. */
  codeBlockStyle?: string;
  lang?: string;
  escaped?: boolean;
  /** A table's. */
  header?: MarkdownCell[];
  rows?: MarkdownCell[][];
}

/** A table's cell: its text and its inline tokens. */
export interface MarkdownCell {
  text: string;
  tokens: MarkdownToken[];
}

/** What reads Markdown into tokens: marked's lexer, with GitHub's extensions and `breaks`. */
export type MarkdownLexer = (source: string) => readonly MarkdownToken[];

let registered: MarkdownLexer | null = null;
/** Counts the lexers registered, so what was shown with one is not kept for the next. */
let generation = 0;

/** Makes a lexer the one Markdown Flow text is read with; with null, none: the source is then shown as it is. */
export function setMarkdownLexer(lexer: MarkdownLexer | null): void {
  registered = lexer;
  generation++;
}

/** The lexer Markdown Flow text is read with, or null. */
export function markdownLexer(): MarkdownLexer | null {
  return registered;
}

// ---- The theme -------------------------------------------------------------------------------------------------------

/** The Markdown configurations, by what they style. */
export type MarkdownConfigKey = 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'code' | 'codeBlock' | 'quote' | 'link';

const CONFIG_KEYS: readonly MarkdownConfigKey[] = ['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'code', 'codeBlock', 'quote', 'link'];

/** How Markdown is shown: sizes and spaces in ems of the text's own size, colors, and the configurations' first attributes. */
export interface MarkdownTheme {
  /** Each heading level's size, 1 to 6. */
  readonly headingSizes: readonly number[];
  /** The space before and after a heading, in ems of its own size. */
  readonly headingSpace: { readonly before: number; readonly after: number };
  /** The space after a block: a paragraph, a list, a quote, a code block, a table. */
  readonly blockSpace: number;
  /** A quote's bar, down its left. */
  readonly quoteBar: string;
  /** A horizontal rule. */
  readonly rule: string;
  /** The Markdown's own characters in a block shown as its source: the `#`, the `**`. */
  readonly muted: string;
  /** The marker an open task and a done one show. */
  readonly taskOpen: string;
  readonly taskDone: string;
  /** Each configuration's attributes when it is first made. */
  readonly configs: Readonly<Record<MarkdownConfigKey, Partial<CharAttrs>>>;
}

/** A monospaced family list, for code. */
const MONOSPACE = 'Consolas, "Courier New", monospace';

export const MARKDOWN_THEME: MarkdownTheme = {
  headingSizes: [2, 1.5, 1.25, 1.1, 1, 0.9],
  headingSpace: { before: 0.6, after: 0.3 },
  blockSpace: 0.6,
  quoteBar: '#d0d7de',
  rule: '#d0d7de',
  muted: '#8c959f',
  taskOpen: '☐',
  taskDone: '☑',
  configs: {
    heading1: { fontStyle: 'Bold' },
    heading2: { fontStyle: 'Bold' },
    heading3: { fontStyle: 'Bold' },
    heading4: { fontStyle: 'Bold' },
    heading5: { fontStyle: 'Bold' },
    heading6: { fontStyle: 'Bold' },
    code: { fontFamily: MONOSPACE, highlight: '#eff1f3' },
    codeBlock: { fontFamily: MONOSPACE },
    quote: { color: '#57606a' },
    link: { color: '#0969da', underline: true },
  },
};

/** Each Markdown configuration's name, as the Type panel lists it. */
export const MARKDOWN_CONFIG_NAMES: Readonly<Record<MarkdownConfigKey, string>> = {
  heading1: 'Markdown Heading 1',
  heading2: 'Markdown Heading 2',
  heading3: 'Markdown Heading 3',
  heading4: 'Markdown Heading 4',
  heading5: 'Markdown Heading 5',
  heading6: 'Markdown Heading 6',
  code: 'Markdown Code',
  codeBlock: 'Markdown Code Block',
  quote: 'Markdown Quote',
  link: 'Markdown Link',
};

/** The id each is made with: one every book shares, so books meeting in a paste find one configuration. */
const CONFIG_IDS: Readonly<Record<MarkdownConfigKey, string>> = {
  heading1: 'tc_markdown_heading_1',
  heading2: 'tc_markdown_heading_2',
  heading3: 'tc_markdown_heading_3',
  heading4: 'tc_markdown_heading_4',
  heading5: 'tc_markdown_heading_5',
  heading6: 'tc_markdown_heading_6',
  code: 'tc_markdown_code',
  codeBlock: 'tc_markdown_code_block',
  quote: 'tc_markdown_quote',
  link: 'tc_markdown_link',
};

/** The Markdown configurations, found among those given - by id, then by name - or made from the theme; and those used. */
class ConfigBook {
  readonly used: TextConfig[] = [];
  constructor(
    private readonly known: readonly TextConfig[],
    private readonly theme: MarkdownTheme,
  ) {}

  get(key: MarkdownConfigKey): TextConfig {
    const id = CONFIG_IDS[key];
    const name = MARKDOWN_CONFIG_NAMES[key];
    const already = this.used.find((config) => config.id === id || sameConfigName(config.name, name));
    if (already) return already;
    const known = this.known.find((config) => config.id === id) ?? this.known.find((config) => sameConfigName(config.name, name));
    const config = known ?? readTextConfig({ id, name, attrs: this.theme.configs[key] })!;
    this.used.push(config);
    return config;
  }

  byId(id: string): TextConfig | undefined {
    return this.used.find((config) => config.id === id);
  }
}

// ---- The reveal ------------------------------------------------------------------------------------------------------

let revealed: { id: string; start: number; end: number } | null = null;

/**
 * Shows the blocks a stretch of a Markdown text's source touches - its
 * caret, or its selection - as their source; with a null id, every block of
 * every text as it renders.
 */
export function setMarkdownReveal(id: string | null, start = 0, end = start): void {
  revealed = id === null ? null : { id, start: Math.min(start, end), end: Math.max(start, end) };
}

/** The stretch of a text whose blocks are shown as their source, or null. */
export function markdownReveal(id: string): { start: number; end: number } | null {
  return revealed && revealed.id === id ? { start: revealed.start, end: revealed.end } : null;
}

/** What `make` makes with every block of every text rendered: output, which shows no caret. */
export function withoutMarkdownReveal<T>(make: () => T): T {
  const was = revealed;
  revealed = null;
  try {
    return make();
  } finally {
    revealed = was;
  }
}

// ---- Places ----------------------------------------------------------------------------------------------------------

/** How far ahead a character is looked for: past a quote's `> ` or a list's indent, and no further. */
const ALIGN_REACH = 32;

/**
 * Each character of `inner`'s place: `inner` is `outer` with characters left
 * out - a quote's `> `, a list item's indent - so each is the next character
 * of `outer` like it, a little way on at most. One not found takes the place
 * the next would.
 */
function align(inner: string, outer: string, at: readonly number[]): number[] {
  const out = new Array<number>(inner.length);
  let k = 0;
  for (let i = 0; i < inner.length; i++) {
    let j = k;
    while (j < outer.length && j - k <= ALIGN_REACH && outer[j] !== inner[i]) j++;
    if (j < outer.length && outer[j] === inner[i]) {
      out[i] = at[j];
      k = j + 1;
    } else {
      out[i] = k < outer.length ? at[k] : (at[outer.length - 1] ?? -1) + 1;
    }
  }
  return out;
}

/** The places of `inner` in `outer`: where it is whole, else character by character. */
function locate(inner: string, outer: string, at: readonly number[]): number[] {
  const found = outer.indexOf(inner);
  return found >= 0 ? at.slice(found, found + inner.length) : align(inner, outer, at);
}

/** The places of `part`, found in `whole` from `from`, and where the search goes on; where it is not whole, character by character. */
function placesOf(part: string, whole: string, at: readonly number[], from: number): { places: number[]; next: number } {
  const found = whole.indexOf(part, from);
  if (found >= 0) return { places: at.slice(found, found + part.length), next: found + part.length };
  return { places: align(part, whole.slice(from), at.slice(from)), next: from };
}

// ---- The display -----------------------------------------------------------------------------------------------------

/** One display character: what it is, the place in the source it came from, and the Markdown's attributes for it. */
interface Cell {
  ch: string;
  source: number;
  attrs: Partial<CharAttrs>;
}

/** The display as it is built: its characters, and each paragraph's attributes, a newline starting the next. */
class Builder {
  readonly cells: Cell[] = [];
  readonly paras: Array<Partial<ParaAttrs>> = [{}];

  get para(): Partial<ParaAttrs> {
    return this.paras[this.paras.length - 1];
  }

  push(ch: string, source: number, attrs: Partial<CharAttrs>): void {
    this.cells.push({ ch, source, attrs });
  }

  /** Ends the paragraph with a newline from `source`, the next one taking `next`. */
  breakLine(source: number, next: Partial<ParaAttrs> = {}): void {
    const before = this.cells[this.cells.length - 1];
    this.cells.push({ ch: '\n', source, attrs: before && before.ch !== '\n' ? before.attrs : {} });
    this.paras.push({ ...next });
  }
}

/** What a block's characters are set in: its configuration, and a heading's size. */
interface BlockStyle {
  config: MarkdownConfigKey | null;
  size?: number;
}

/** What an inline stretch is: strong, emphasized, struck, or in a configuration of its own - code, a link. */
interface InlineStyle {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  config: MarkdownConfigKey | null;
}

const PLAIN: InlineStyle = { bold: false, italic: false, strike: false, config: null };
const NO_BLOCK: BlockStyle = { config: null };

/** Where a block sits: its list's level, its paragraphs' left indent, and its quotes' bars, as offsets from the line's box. */
interface Place {
  level: number;
  indent: number;
  bars: number[];
}

const TOP: Place = { level: 0, indent: 0, bars: [] };

/** How far a list stands in a level, in ems: the layout's own step. */
const LIST_STEP = 1.5;

/** Everything a rendering needs. */
interface Render {
  readonly theme: MarkdownTheme;
  readonly book: ConfigBook;
  /** The text's own attributes, and its size, which ems are of. */
  readonly base: CharAttrs;
  readonly size: number;
  readonly measure: TypeMeasure;
  /** The theme code is colored in, and its blocks shaded. */
  readonly accent: AccentTheme;
  /** Attributes made, by what they are made of: one object each, so runs join by identity. */
  readonly made: Map<string, Partial<CharAttrs>>;
}

/** Code's attributes in a color: one object a color, so runs join by identity. */
function inColor(r: Render, attrs: Partial<CharAttrs>, color: string): Partial<CharAttrs> {
  const key = `code-color|${color}`;
  const made = r.made.get(key);
  if (made) return made;
  const colored = { ...attrs, color };
  r.made.set(key, colored);
  return colored;
}

/** The attributes a character has: its block's configuration and size, and its inline style over them. */
function attrsFor(r: Render, block: BlockStyle, inline: InlineStyle): Partial<CharAttrs> {
  const key = `${block.config}|${block.size}|${inline.config}|${+inline.bold}${+inline.italic}${+inline.strike}`;
  const made = r.made.get(key);
  if (made) return made;
  const blockConfig = block.config ? r.book.get(block.config) : null;
  const inlineConfig = inline.config ? r.book.get(inline.config) : null;
  const config = inlineConfig ?? blockConfig;
  const out: Partial<CharAttrs> = {};
  // Code or a link in a heading or a quote: its own configuration, and the block's look where it says nothing.
  if (inlineConfig && blockConfig) {
    for (const [name, value] of Object.entries(blockConfig.attrs)) {
      if (inlineConfig.attrs[name as keyof CharAttrs] === undefined) (out as Record<string, unknown>)[name] = value;
    }
  }
  if (config) out.config = config.id;
  if (block.size !== undefined && out.fontSize === undefined && config?.attrs.fontSize === undefined) out.fontSize = block.size;
  if (inline.bold || inline.italic) {
    const face = out.fontStyle ?? config?.attrs.fontStyle ?? r.base.fontStyle;
    const bold = inline.bold || /bold|black|heavy/i.test(face);
    const italic = inline.italic || /italic|oblique/i.test(face);
    out.fontStyle = bold && italic ? 'Bold Italic' : bold ? 'Bold' : 'Italic';
  }
  if (inline.strike) out.strike = true;
  r.made.set(key, out);
  return out;
}

/** The named character references a text shows as their characters; the rest show as written. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  larr: '←',
  rarr: '→',
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/y;

/** What a character reference stands for, or null when it is not one. */
function entityAt(text: string, i: number): { ch: string; length: number } | null {
  ENTITY.lastIndex = i;
  const m = ENTITY.exec(text);
  if (!m) return null;
  const code = m[1] !== undefined ? Number.parseInt(m[1], 10) : m[2] !== undefined ? Number.parseInt(m[2], 16) : -1;
  if (code >= 0) return code > 0 && code <= 0x10ffff ? { ch: String.fromCodePoint(code), length: m[0].length } : null;
  const named = ENTITIES[m[3]];
  return named !== undefined ? { ch: named, length: m[0].length } : null;
}

/** A paragraph that goes on from `para` after a line break: its look, no list marker - its indent instead - and none of its spaces. */
function continuation(r: Render, para: Partial<ParaAttrs>): Partial<ParaAttrs> {
  const { list, spaceBefore: _before, spaceAfter: _after, ...rest } = para;
  return list ? { ...rest, leftIndent: (rest.leftIndent ?? 0) + list.level * LIST_STEP * r.size } : rest;
}

/** Writes characters as they are - a newline a line break, a character reference its character when `decode` - each at its place. */
function plain(r: Render, b: Builder, text: string, at: readonly number[], attrs: Partial<CharAttrs>, decode: boolean): void {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      b.breakLine(at[i] ?? 0, continuation(r, b.para));
      continue;
    }
    const entity = decode && ch === '&' ? entityAt(text, i) : null;
    if (entity) {
      for (let k = 0; k < entity.ch.length; k++) b.push(entity.ch[k], at[i] ?? 0, attrs);
      i += entity.length - 1;
      continue;
    }
    b.push(ch, at[i] ?? 0, attrs);
  }
}

/** Writes inline tokens - their text found in `text`, whose places are `at` - as they render. */
function inline(r: Render, b: Builder, tokens: readonly MarkdownToken[], text: string, at: readonly number[], block: BlockStyle, style: InlineStyle): void {
  let from = 0;
  for (const token of tokens) {
    const { places, next } = placesOf(token.raw, text, at, from);
    from = next;
    const here = places[0] ?? at[Math.min(from, at.length - 1)] ?? 0;
    // What a token holds: its text, found in its raw.
    const inner = (): { text: string; at: number[] } => {
      const content = token.text ?? '';
      return { text: content, at: locate(content, token.raw, places) };
    };
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'link': {
        const content = inner();
        const next: InlineStyle = {
          ...style,
          ...(token.type === 'strong' ? { bold: true } : {}),
          ...(token.type === 'em' ? { italic: true } : {}),
          ...(token.type === 'del' ? { strike: true } : {}),
          ...(token.type === 'link' ? { config: 'link' as const } : {}),
        };
        if (token.tokens && token.tokens.length > 0) inline(r, b, token.tokens, content.text, content.at, block, next);
        else plain(r, b, content.text, content.at, attrsFor(r, block, next), true);
        break;
      }
      case 'codespan': {
        const content = inner();
        plain(r, b, content.text, content.at, attrsFor(r, block, { ...style, config: 'code' }), false);
        break;
      }
      case 'image': {
        // Not fetched: its words, in italics.
        const content = inner();
        plain(r, b, content.text, content.at, attrsFor(r, block, { ...style, italic: true }), true);
        break;
      }
      case 'escape':
        b.push(token.text ?? token.raw.slice(1), places[places.length - 1] ?? here, attrsFor(r, block, style));
        break;
      case 'br':
        b.breakLine(here, continuation(r, b.para));
        break;
      case 'checkbox':
        // A task's box is its list item's marker.
        break;
      case 'text':
        if (token.tokens && token.tokens.length > 0) inline(r, b, token.tokens, token.raw, places, block, style);
        else plain(r, b, token.raw, places, attrsFor(r, block, style), true);
        break;
      default:
        // Raw HTML, and anything else: as it is written.
        plain(r, b, token.raw, places, attrsFor(r, block, style), false);
    }
  }
}

/** A leaf block's inline content - a paragraph's, a heading's - its text found in its raw. */
function leaf(r: Render, b: Builder, token: MarkdownToken, at: readonly number[], block: BlockStyle): void {
  const text = token.text ?? token.raw;
  const textAt = locate(text, token.raw, at);
  if (token.tokens && token.tokens.length > 0) inline(r, b, token.tokens, text, textAt, block, PLAIN);
  else plain(r, b, text, textAt, attrsFor(r, block, PLAIN), true);
}

/** The attributes a place gives its paragraphs: its indent, and its quotes' bars. */
function placed(r: Render, place: Place): Partial<ParaAttrs> {
  return {
    ...(place.indent !== 0 ? { leftIndent: place.indent } : {}),
    ...(place.bars.length > 0 ? { bar: { color: r.theme.quoteBar, at: [...place.bars] } } : {}),
  };
}

/** Block tokens - a quote's - as they render, each a paragraph or more, a block's space between them. */
function blocks(r: Render, b: Builder, tokens: readonly MarkdownToken[], text: string, at: readonly number[], place: Place, block: BlockStyle): void {
  let from = 0;
  let first = true;
  for (const token of tokens) {
    const { places, next } = placesOf(token.raw, text, at, from);
    from = next;
    if (token.type === 'space' || token.type === 'def') continue;
    if (!first) {
      if (b.para.spaceAfter === undefined) b.para.spaceAfter = r.theme.blockSpace * r.size;
      b.breakLine(places[0] ?? 0, placed(r, place));
    }
    first = false;
    one(r, b, token, places, place, block);
  }
}

/** One block token, as it renders, into the paragraph begun for it. */
function one(r: Render, b: Builder, token: MarkdownToken, at: readonly number[], place: Place, block: BlockStyle): void {
  switch (token.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, token.depth ?? 1));
      const size = r.size * (r.theme.headingSizes[level - 1] ?? 1);
      // The space before it, less what the block before leaves: the two make one, as margins do.
      Object.assign(b.para, { spaceBefore: Math.max(0, r.theme.headingSpace.before * size - r.theme.blockSpace * r.size), spaceAfter: r.theme.headingSpace.after * size });
      leaf(r, b, token, at, { config: `heading${level}` as MarkdownConfigKey, size });
      return;
    }
    case 'paragraph':
    case 'text':
      leaf(r, b, token, at, block);
      return;
    case 'code': {
      // A line a paragraph, on the accent theme's shade, in the code configuration; a fence's lines are the source's.
      // Code a highlighter read comes as its HTML: each character the color its scope gives, the rest the theme's
      // plain color, unless the configuration sets one.
      const read = token.escaped === true ? hljsHtmlToRuns(token.text ?? '', r.accent) : null;
      const text = read ? read.text : token.text ?? '';
      const body = token.codeBlockStyle === 'indented' ? 0 : token.raw.indexOf('\n') + 1;
      const textAt = locate(text, token.raw.slice(body), at.slice(body));
      const shade = { shade: r.accent.shade };
      Object.assign(b.para, shade);
      const attrs = attrsFor(r, { config: 'codeBlock' }, PLAIN);
      const plain = r.book.get('codeBlock').attrs.color === undefined ? r.accent.base : undefined;
      const colors = new Array<string | undefined>(text.length);
      for (const run of read?.runs ?? []) colors.fill(run.color, run.start, run.end);
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
          b.breakLine(textAt[i] ?? 0, { ...placed(r, place), ...shade });
          continue;
        }
        const color = colors[i] ?? plain;
        b.push(text[i], textAt[i] ?? 0, color === undefined ? attrs : inColor(r, attrs, color));
      }
      return;
    }
    case 'hr':
      Object.assign(b.para, { rule: r.theme.rule });
      return;
    case 'blockquote': {
      const text = token.text ?? '';
      const inner: Place = { ...place, indent: place.indent + r.size, bars: [...place.bars, place.indent] };
      Object.assign(b.para, placed(r, inner));
      blocks(r, b, token.tokens ?? [], text, align(text, token.raw, at), inner, { config: 'quote' });
      return;
    }
    case 'list':
      list(r, b, token, at, place, block);
      return;
    case 'table':
      table(r, b, token, at, place, block);
      return;
    default:
      // Raw HTML, and anything else: as it is written.
      plain(r, b, token.raw.replace(/\n+$/, ''), at, attrsFor(r, block, PLAIN), false);
  }
}

/** A list: its items, each from a paragraph of its own. */
function list(r: Render, b: Builder, token: MarkdownToken, at: readonly number[], place: Place, block: BlockStyle): void {
  let from = 0;
  (token.items ?? []).forEach((item, n) => {
    const { places, next } = placesOf(item.raw, token.raw, at, from);
    from = next;
    if (n > 0) b.breakLine(places[0] ?? 0, placed(r, place));
    listItem(r, b, item, places, place, block, token, n);
  });
}

/** A list item's marker, its indent and a task's box: up to where what it holds starts. */
const ITEM_LEAD = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*(?:\[[ xX]\][ \t]+)?/;

/** One list item: a list paragraph - a task's box its marker, an ordered item's number its own - and what it holds after. */
function listItem(r: Render, b: Builder, item: MarkdownToken, at: readonly number[], place: Place, block: BlockStyle, owner: MarkdownToken, n: number): void {
  const level = Math.min(9, place.level + 1);
  const first = typeof owner.start === 'number' ? owner.start : 1;
  // Each number said, so a paragraph between items does not start the count again.
  const marker = item.task
    ? { kind: 'bullet' as const, marker: item.checked ? r.theme.taskDone : r.theme.taskOpen }
    : owner.ordered === true
      ? { kind: 'number' as const, marker: '1.', start: first + n }
      : { kind: 'bullet' as const };
  Object.assign(b.para, { ...placed(r, place), list: { ...marker, level } });
  const lead = ITEM_LEAD.exec(item.raw)?.[0].length ?? 0;
  const text = item.text ?? '';
  const textAt = locate(text, item.raw.slice(lead), at.slice(lead));
  const nested: Place = { ...place, level };
  const held: Place = { ...nested, indent: place.indent + level * LIST_STEP * r.size };
  let from = 0;
  let firstChild = true;
  for (const child of item.tokens ?? []) {
    if (child.type === 'checkbox') continue;
    const { places, next } = placesOf(child.raw, text, textAt, from);
    from = next;
    if (child.type === 'space' || child.type === 'def') continue;
    const sublist = child.type === 'list';
    if (!firstChild) {
      if (item.loose && !sublist && b.para.spaceAfter === undefined) b.para.spaceAfter = r.theme.blockSpace * r.size;
      b.breakLine(places[0] ?? 0, placed(r, sublist ? nested : held));
    }
    firstChild = false;
    if (sublist) list(r, b, child, places, nested, block);
    else one(r, b, child, places, held, block);
  }
}

/** How wide display characters are set, each run in its own font. */
function cellsWidth(r: Render, cells: readonly Cell[]): number {
  let width = 0;
  let i = 0;
  while (i < cells.length) {
    let j = i;
    let text = '';
    while (j < cells.length && cells[j].attrs === cells[i].attrs) text += cells[j++].ch;
    const own = cells[i].attrs;
    const config = own.config !== undefined ? r.book.byId(own.config) : undefined;
    const attrs: CharAttrs = { ...r.base, ...(config?.attrs ?? {}), ...own };
    const font: TypeFont = { family: attrs.fontFamily, style: attrs.fontStyle, size: attrs.fontSize, kerning: attrs.kerning === 'auto', smallCaps: false };
    width += r.measure.width(text, font);
    i = j;
  }
  return width;
}

/**
 * A table: a line a row, the header's cells strong, each cell starting where
 * its column does - the space after a cell kerned on to the next column, in as
 * many spaces as kerning by hand reaches.
 */
function table(r: Render, b: Builder, token: MarkdownToken, at: readonly number[], place: Place, block: BlockStyle): void {
  const raw = token.raw;
  const rows: MarkdownCell[][] = [token.header ?? [], ...(token.rows ?? [])];
  // Each cell rendered apart first, to measure the columns by.
  let from = 0;
  const shown = rows.map((row, i) =>
    row.map((cell) => {
      const { places, next } = placesOf(cell.text, raw, at, from);
      from = next;
      const scratch = new Builder();
      const style: InlineStyle = { ...PLAIN, bold: i === 0 };
      if (cell.tokens.length > 0) inline(r, scratch, cell.tokens, cell.text, places, block, style);
      else plain(r, scratch, cell.text, places, attrsFor(r, block, style), true);
      const cells = scratch.cells.filter((each) => each.ch !== '\n');
      const pipe = raw.indexOf('|', next);
      return { cells, width: cellsWidth(r, cells), after: at[pipe >= 0 ? pipe : Math.max(0, next - 1)] ?? 0, style };
    }),
  );
  const columns = Math.max(0, ...shown.map((row) => row.length));
  const stops: number[] = [];
  for (let c = 0; c < columns; c++) stops.push(Math.max(0, ...shown.map((row) => row[c]?.width ?? 0)) + r.size);
  shown.forEach((row, i) => {
    if (i > 0) b.breakLine(Math.max(0, (row[0]?.cells[0]?.source ?? row[0]?.after ?? 1) - 1), placed(r, place));
    else Object.assign(b.para, placed(r, place));
    row.forEach((cell, c) => {
      for (const each of cell.cells) b.push(each.ch, each.source, each.attrs);
      if (c === row.length - 1) return;
      const attrs = attrsFor(r, block, cell.style);
      const space = cellsWidth(r, [{ ch: ' ', source: 0, attrs }]);
      const size = attrs.fontSize ?? r.size;
      const most = (TYPE_LIMITS.kern.max / 1000) * size;
      let rest = stops[c] - cell.width;
      do {
        const extra = Math.max(0, Math.min(most, rest - space));
        b.push(' ', cell.after, extra > 0 ? { ...attrs, kern: (extra / size) * 1000 } : attrs);
        rest -= space + extra;
      } while (rest > 0.5);
    });
  });
}

// ---- The whole text ----------------------------------------------------------------------------------------------------

/** A block of the source: a top-level block, or a top-level list's item. */
interface Unit {
  /** Where it is in the source: its first character to its last, the white space after it not included. */
  start: number;
  end: number;
  token: MarkdownToken;
  /** The place of each character of its raw. */
  places: number[];
  item?: { list: MarkdownToken; n: number };
}

/** The blocks a source is shown in, in order: blank lines and link definitions are the gaps between them. */
function unitsOf(source: string, tokens: readonly MarkdownToken[]): Unit[] {
  const identity = Array.from({ length: source.length }, (_, i) => i);
  const units: Unit[] = [];
  let from = 0;
  for (const token of tokens) {
    const { places, next } = placesOf(token.raw, source, identity, from);
    from = next;
    if (token.type === 'space' || token.type === 'def') continue;
    if (token.type === 'list') {
      let at = 0;
      (token.items ?? []).forEach((item, n) => {
        const found = placesOf(item.raw, token.raw, places, at);
        at = found.next;
        const body = item.raw.replace(/\s+$/, '').length;
        if (body > 0) units.push({ start: found.places[0], end: found.places[body - 1] + 1, token: item, places: found.places, item: { list: token, n } });
      });
      continue;
    }
    const body = token.raw.replace(/\s+$/, '').length;
    if (body > 0 && places.length >= body) units.push({ start: places[0], end: places[body - 1] + 1, token, places });
  }
  return units;
}

/** Whether a stretch of the source touches a block, its ends included. */
function touches(unit: Unit, reveal: { start: number; end: number } | null): boolean {
  return reveal !== null && reveal.start <= unit.end && reveal.end >= unit.start;
}

/** Whether a stretch of the source is in gap `g` - after block `g - 1` and before block `g`, strictly between them: on its blank lines. */
function inGap(units: readonly Unit[], g: number, length: number, reveal: { start: number; end: number } | null): boolean {
  if (reveal === null) return false;
  const after = units[g - 1]?.end ?? -1;
  const before = units[g]?.start ?? length + 1;
  return reveal.start < before && reveal.end > after;
}

/** What a reveal shows as source, as a key: the same key, the same display. */
function revealKey(units: readonly Unit[], reveal: { start: number; end: number } | null, length: number): string {
  if (reveal === null) return '';
  const shown: number[] = [];
  units.forEach((unit, u) => {
    if (touches(unit, reveal)) shown.push(u);
  });
  const gaps: number[] = [];
  for (let g = 0; g <= units.length; g++) if (inGap(units, g, length, reveal)) gaps.push(g);
  return `${shown.join(',')}|${gaps.join(',')}`;
}

/** A block of the source, where it is, and whether it is shown as its source. */
export interface MarkdownBlock {
  start: number;
  end: number;
  source: boolean;
}

/** Markdown as a text shows it. */
export interface MarkdownType {
  /** What is shown. */
  text: string;
  /** Its runs: what each stretch has beyond the text's own attributes, a configuration's link among them. */
  runs: TypeRun[];
  /** Each paragraph's attributes. */
  paras: Array<Partial<ParaAttrs> | null>;
  /** The configurations the runs follow. */
  configs: TextConfig[];
  /** For each character shown - and one past the last - the place in the source it came from. */
  map: number[];
  /** The source's blocks, in order. */
  blocks: MarkdownBlock[];
}

/** How {@link markdownToType} reads a source. */
export interface MarkdownOptions {
  /** The lexer: the registered one unless given. */
  lexer?: MarkdownLexer | null;
  /** Configurations already defined - a book's, a text's own - which the Markdown ones are taken from, by id or by name, before any is made. */
  configs?: readonly TextConfig[];
  /** A stretch of the source whose blocks are shown as their source: a caret's, a selection's. */
  reveal?: { start: number; end: number } | null;
  /** The text's own attributes, which sizes are ems of: the defaults unless given. */
  base?: CharAttrs;
  /** What a table's columns are measured with: the built-in face's unless given. */
  measure?: TypeMeasure | null;
  /** The theme code blocks are shaded and colored in: Napkin Light unless given. */
  accentTheme?: AccentTheme;
}

/** A source shown as it is: each character itself. */
function asWritten(source: string): MarkdownType {
  return { text: source, runs: [], paras: [], configs: [], map: Array.from({ length: source.length + 1 }, (_, i) => i), blocks: [] };
}

/** The display of a source read into blocks. */
function render(source: string, units: readonly Unit[], theme: MarkdownTheme, options: MarkdownOptions): MarkdownType {
  if (units.length === 0) return asWritten(source);
  const base = options.base ?? { ...DEFAULT_CHAR };
  const r: Render = {
    theme,
    book: new ConfigBook(options.configs ?? [], theme),
    base,
    size: base.fontSize,
    measure: options.measure ?? HEADLESS_MEASURE,
    accent: options.accentTheme ?? ACCENT_THEMES.light,
    made: new Map(),
  };
  const reveal = options.reveal ?? null;
  const b = new Builder();
  const blocksOut: MarkdownBlock[] = [];
  /** The source from `start` to `end` as it is written, a newline a paragraph: blank lines, or a block shown as its source. */
  const written = (start: number, end: number, attrsAt: (i: number) => Partial<CharAttrs>, para: Partial<ParaAttrs>): void => {
    for (let i = start; i < end; i++) {
      if (source[i] === '\n') b.breakLine(i, para);
      else b.push(source[i], i, attrsAt(i));
    }
  };
  const none = (): Partial<CharAttrs> => ({});
  if (inGap(units, 0, source.length, reveal)) written(0, units[0].start, none, {});

  units.forEach((unit, u) => {
    const asSource = touches(unit, reveal);
    blocksOut.push({ start: unit.start, end: unit.end, source: asSource });
    const draw = (into: Builder): void => {
      if (unit.item) listItem(r, into, unit.token, unit.places, TOP, NO_BLOCK, unit.item.list, unit.item.n);
      else one(r, into, unit.token, unit.places, TOP, NO_BLOCK);
    };
    if (!asSource) {
      draw(b);
    } else {
      // As its source: each character itself, as it renders where it is shown, and the Markdown's own muted in the block's size.
      const scratch = new Builder();
      draw(scratch);
      const content = new Map<number, Partial<CharAttrs>>();
      for (const cell of scratch.cells) if (cell.ch !== '\n' && cell.ch === source[cell.source] && !content.has(cell.source)) content.set(cell.source, cell.attrs);
      const lead = scratch.cells.find((cell) => cell.ch !== '\n')?.attrs ?? {};
      const muted: Partial<CharAttrs> = { ...(lead.config !== undefined ? { config: lead.config } : {}), ...(lead.fontSize !== undefined ? { fontSize: lead.fontSize } : {}), color: theme.muted };
      const first = scratch.paras[0];
      const last = scratch.paras[scratch.paras.length - 1];
      const shade = first.shade ? { shade: first.shade } : {};
      Object.assign(b.para, shade, first.spaceBefore !== undefined ? { spaceBefore: first.spaceBefore } : {});
      written(unit.start, unit.end, (i) => content.get(i) ?? muted, shade);
      if (last.spaceAfter !== undefined) b.para.spaceAfter = last.spaceAfter;
    }
    // The space after it - none between a tight list's items - then the blank lines before the next, as written when the caret is on them.
    const next = units[u + 1];
    if (next && b.para.spaceAfter === undefined) {
      const sameList = unit.item !== undefined && next.item !== undefined && next.item.list === unit.item.list;
      b.para.spaceAfter = sameList && unit.item!.list.loose !== true ? 0 : theme.blockSpace * r.size;
    }
    if (inGap(units, u + 1, source.length, reveal)) written(unit.end, next ? next.start : source.length, none, {});
    else if (next) b.breakLine(unit.end, {});
  });

  // The display: its text, its runs - neighbours alike joined - its paragraphs and its map.
  let text = '';
  const map: number[] = [];
  const runs: TypeRun[] = [];
  b.cells.forEach((cell, i) => {
    text += cell.ch;
    map.push(cell.source);
    if (Object.keys(cell.attrs).length === 0) return;
    const last = runs[runs.length - 1];
    if (last && last.end === i && (last.attrs === cell.attrs || JSON.stringify(last.attrs) === JSON.stringify(cell.attrs))) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, attrs: cell.attrs });
  });
  const end = b.cells[b.cells.length - 1];
  map.push(end ? Math.min(source.length, end.source + 1) : 0);
  const paras = b.paras.map((para) => {
    const kept = Object.fromEntries(Object.entries(para).filter(([, value]) => value !== undefined && value !== 0)) as Partial<ParaAttrs>;
    return Object.keys(kept).length > 0 ? kept : null;
  });
  // Each run its own attributes: the ones made above are shared, one an alike style.
  return { text, runs: runs.map((run) => ({ ...run, attrs: { ...run.attrs } })), paras, configs: [...r.book.used], map, blocks: blocksOut };
}

/**
 * Markdown as a text shows it: display text, its runs and paragraph
 * attributes, the configurations they follow, and the source map. The blocks
 * a `reveal` touches are shown as their source - each character itself, the
 * Markdown's own muted - and so are the blank lines it is on; the rest as they
 * render, the blank lines between two blocks the space after the first. With
 * no lexer, the source as it is.
 */
export function markdownToType(source: string, theme: MarkdownTheme = MARKDOWN_THEME, options: MarkdownOptions = {}): MarkdownType {
  const lexer = options.lexer === undefined ? registered : options.lexer;
  if (!lexer) return asWritten(source);
  return render(source, unitsOf(source, lexer(source)), theme, options);
}

// ---- A text as it is shown -------------------------------------------------------------------------------------------

/** A Markdown Flow text as shown: a plain text of its display, and its source map. */
export interface MarkdownShown {
  stroke: Stroke;
  map: number[];
}

/** A code block whose language no highlighter has: where it is in the source, and the language its fence names. */
export interface MarkdownMissing {
  start: number;
  end: number;
  language: string;
}

/** A text's source read into blocks, and its code blocks in a language not installed, kept until its source, the lexer or the highlighter changes. */
interface Lexed {
  text: string;
  generation: number;
  accent: number;
  units: Unit[];
  missing: MarkdownMissing[];
}

const lexedKept = new WeakMap<Stroke, Lexed>();

/** The blocks of a source with a code block in them whose fence names a language no highlighter has: each block once, with its first such language. */
function missingIn(units: readonly Unit[]): MarkdownMissing[] {
  const out: MarkdownMissing[] = [];
  const named = (token: MarkdownToken): string | null => {
    if (token.type === 'code' && token.escaped !== true) {
      const language = (token.lang ?? '').match(/\S*/)?.[0] ?? '';
      if (language !== '' && accentHighlighter()?.resolve(language) == null) return language;
    }
    for (const child of [...(token.tokens ?? []), ...(token.items ?? [])]) {
      const found = named(child);
      if (found) return found;
    }
    return null;
  };
  for (const unit of units) {
    const language = named(unit.token);
    if (language) out.push({ start: unit.start, end: unit.end, language });
  }
  return out;
}

/** A text's source read into blocks, kept per text. */
function lexedOf(stroke: Stroke, lexer: MarkdownLexer): Lexed {
  const source = stroke.text ?? '';
  const was = lexedKept.get(stroke);
  if (was && was.text === source && was.generation === generation && was.accent === accentGeneration()) return was;
  const units = unitsOf(source, lexer(source));
  const lexed: Lexed = { text: source, generation, accent: accentGeneration(), units, missing: missingIn(units) };
  lexedKept.set(stroke, lexed);
  return lexed;
}

/**
 * The code blocks of a Markdown Flow text whose fence names a language no
 * highlighter has - where they are in the source, and the language - which
 * the editor says are not installed; none for any other text.
 */
export function markdownMissing(stroke: Stroke): MarkdownMissing[] {
  if (stroke.typeset?.flow !== 'markdown' || !registered) return [];
  return lexedOf(stroke, registered).missing;
}

interface ShownKept {
  text: string | undefined;
  typeset: Stroke['typeset'];
  fontSize: number | undefined;
  fontFamily: string | undefined;
  color: string;
  generation: number;
  accent: number;
  shown: MarkdownShown;
}

/** What has been shown of each text, by measure and by what is shown as source; a few each. */
const shownKept = new WeakMap<Stroke, Map<string, ShownKept>>();
const SHOWN_KEPT = 6;

/** Each paragraph's start in a text. */
export function paragraphStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** The paragraph a place is in, by its paragraphs' starts. */
export function paragraphOf(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * A Markdown Flow text as it is shown - a plain text of its display, in the
 * text's own attributes, with what the source's characters have of their own
 * over the Markdown's and its paragraphs' own attributes under the
 * Markdown's - and its source map. With `reveal`, the blocks the text's
 * caret or selection is in are shown as their source. Null for any other
 * text, or with no lexer. Kept until the text, the lexer or what is shown as
 * source changes.
 */
export function markdownShown(stroke: Stroke, measure: TypeMeasure | null = null, reveal = true): MarkdownShown | null {
  const spec = stroke.typeset;
  if (spec?.flow !== 'markdown' || !registered) return null;
  const source = stroke.text ?? '';
  const lexed = lexedOf(stroke, registered);
  const stretch = reveal ? markdownReveal(stroke.id) : null;
  const accentTheme = currentAccentTheme();
  const key = `${measure?.id ?? ''}|${accentTheme.id}|${revealKey(lexed.units, stretch, source.length)}`;
  let byKey = shownKept.get(stroke);
  const was = byKey?.get(key);
  if (
    was &&
    was.text === stroke.text &&
    was.typeset === stroke.typeset &&
    was.fontSize === stroke.fontSize &&
    was.fontFamily === stroke.fontFamily &&
    was.color === stroke.color &&
    was.generation === generation &&
    was.accent === accentGeneration()
  ) {
    return was.shown;
  }
  const md = render(source, lexed.units, MARKDOWN_THEME, { configs: spec.configs ?? [], reveal: stretch, base: baseAttrs(stroke), measure, accentTheme });
  // What the source's characters have of their own - set in the Type panel - over the Markdown's.
  const own = new Array<Partial<CharAttrs> | undefined>(source.length);
  for (const run of spec.runs ?? []) for (let i = run.start; i < run.end && i < source.length; i++) own[i] = run.attrs;
  const runs: TypeRun[] = [];
  let k = 0;
  for (let i = 0; i < md.text.length; i++) {
    while (k < md.runs.length && md.runs[k].end <= i) k++;
    const markdown = k < md.runs.length && md.runs[k].start <= i ? md.runs[k].attrs : undefined;
    const mine = own[md.map[i]];
    const attrs = mine ? { ...(markdown ?? {}), ...mine } : markdown;
    if (!attrs) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === i && (last.attrs === attrs || JSON.stringify(last.attrs) === JSON.stringify(attrs))) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, attrs });
  }
  // Each paragraph: its source paragraph's own attributes - its alignment - under the Markdown's.
  const sourceStarts = paragraphStarts(source);
  const displayStarts = paragraphStarts(md.text);
  const paras = md.paras.map((para, p) => {
    const mine = spec.paras?.[paragraphOf(sourceStarts, md.map[displayStarts[p]] ?? 0)] ?? null;
    const merged = { ...(mine ?? {}), ...(para ?? {}) };
    return Object.keys(merged).length > 0 ? merged : null;
  });
  const configs = [...md.configs, ...(spec.configs ?? []).filter((config) => !md.configs.some((each) => each.id === config.id))];
  const { flow: _flow, runs: _runs, paras: _paras, configs: _configs, ...shape } = spec;
  const shown: MarkdownShown = { stroke: withTypeset({ ...stroke, text: md.text }, { ...shape, runs, paras, configs }), map: md.map };
  if (!byKey) {
    byKey = new Map();
    shownKept.set(stroke, byKey);
  }
  if (byKey.size >= SHOWN_KEPT) byKey.clear();
  byKey.set(key, { text: stroke.text, typeset: stroke.typeset, fontSize: stroke.fontSize, fontFamily: stroke.fontFamily, color: stroke.color, generation, accent: accentGeneration(), shown });
  return shown;
}

/** The plain text a text is drawn as: a Markdown Flow text's display, or the text itself, with its accented paragraphs colored (core/type/accents.ts). */
export function typeShown(stroke: Stroke, measure: TypeMeasure | null = null): Stroke {
  const shown = markdownShown(stroke, measure)?.stroke ?? stroke;
  return accentShown(shown) ?? shown;
}

/**
 * A Markdown Flow text carrying the Markdown configurations - those `known`
 * defines, by id or by name, as it defines them, and the rest made from the
 * theme - for its book to keep. The text itself when it is not one, or
 * carries them all already.
 */
export function withMarkdownConfigs(stroke: Stroke, known: readonly TextConfig[] = []): Stroke {
  const spec = stroke.typeset;
  if (spec?.flow !== 'markdown') return stroke;
  const carried = spec.configs ?? [];
  const book = new ConfigBook([...carried, ...known], MARKDOWN_THEME);
  const missing = CONFIG_KEYS.map((key) => book.get(key)).filter((config) => !carried.some((each) => each.id === config.id));
  if (missing.length === 0) return stroke;
  return { ...stroke, typeset: { ...spec, configs: [...carried, ...missing] } };
}

/** A Markdown configuration: as `known` defines it - by id, then by name - or as the theme first makes it. */
export function markdownConfig(key: MarkdownConfigKey, known: readonly TextConfig[] = []): TextConfig {
  return new ConfigBook(known, MARKDOWN_THEME).get(key);
}

/** The Markdown configuration a configuration is - by its id or its name - as the theme first makes it; null when it is none of them. */
export function markdownConfigAsMade(config: TextConfig, theme: MarkdownTheme = MARKDOWN_THEME): TextConfig | null {
  const key = CONFIG_KEYS.find((each) => config.id === CONFIG_IDS[each] || sameConfigName(config.name, MARKDOWN_CONFIG_NAMES[each]));
  return key ? readTextConfig({ id: CONFIG_IDS[key], name: MARKDOWN_CONFIG_NAMES[key], attrs: theme.configs[key] }) : null;
}

/**
 * What Enter does at `index` in Markdown, as a Markdown editor does: in a
 * list item, the next item's marker - the next number, a task's open box - and
 * in a quote, its `> `; on an empty item or quote line, the marker taken off
 * instead, ending it; in a fenced code block, a newline alone.
 */
export function markdownEnter(source: string, index: number): { from: number; to: number; insert: string } {
  const plainBreak = { from: index, to: index, insert: '\n' };
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  // In a fenced code block: an odd count of fences before the line.
  const fences = source.slice(0, lineStart).split('\n').filter((line) => /^\s{0,3}(```|~~~)/.test(line)).length;
  if (fences % 2 === 1) return plainBreak;
  const lineEnd = source.indexOf('\n', index);
  const line = source.slice(lineStart, index);
  const rest = source.slice(index, lineEnd < 0 ? source.length : lineEnd);
  const item = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line);
  if (item) {
    if (line.slice(item[0].length).trim() === '' && rest.trim() === '') return { from: lineStart, to: index, insert: '' };
    const marker = /^\d/.test(item[3]) ? `${Number.parseInt(item[3], 10) + 1}${item[3].slice(-1)}` : item[3];
    return { from: index, to: index, insert: `\n${item[1]}${item[2]}${marker}${item[4]}${item[5] ? '[ ] ' : ''}` };
  }
  const quote = /^(?:[ \t]*>[ \t]?)+/.exec(line);
  if (quote) {
    if (line.slice(quote[0].length).trim() === '' && rest.trim() === '') return { from: lineStart, to: index, insert: '' };
    return { from: index, to: index, insert: `\n${quote[0]}` };
  }
  return plainBreak;
}
