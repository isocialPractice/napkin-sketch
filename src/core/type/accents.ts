/**
 * Clean Language Accents: code colored as its language reads it - keywords,
 * strings, numbers, comments, names and types each a color - from
 * highlight.js's reading of it, with no HTML ever rendered.
 *
 * The core never imports highlight.js. It reads code with the highlighter it
 * is given ({@link setAccentHighlighter}): `napkin-sketch/markdown`, the app,
 * the command line and `napkin-sketch/node` give it highlight.js with its
 * common set of 36 languages, and register more as they are installed. What
 * highlight.js gives back is HTML; {@link hljsHtmlToRuns} reads exactly the
 * HTML it writes - nested `<span class="hljs-...">` and the XML entities - into
 * colored runs, and takes anything else as the text it is.
 *
 * A language's colors come from a theme: **Napkin Light** or **Napkin
 * Dark**, each color at least 4.5:1 against its own block shade (WCAG AA).
 * The theme follows the page's lightness unless a setting picks one
 * ({@link setAccentOptions}); each page drawn says its paper
 * ({@link withAccentPage}).
 *
 * Code is accented two ways. A Markdown Flow text's fenced block with a
 * language is colored as it is read (core/type/markdown-flow.ts). And any
 * paragraph's `accent` - a language, or `auto` - colors it live: the colors
 * are worked out as the text is laid out, never stored, so they follow every
 * edit ({@link accentShown}).
 */

import type { Stroke } from '../types.js';
import { parsePaint } from '../graphic-design/color.js';
import CATALOG from './accent-languages.json';
import { applyTextConfig } from './configs.js';
import { applyPara, paragraphRanges, recolorText, type ParaAttrs, type TextConfig, type TypeSpec } from './model.js';

// ---- The catalog -----------------------------------------------------------------------------------------------------

/** A language highlight.js reads: its id, the name it goes by, the names a fence may give it, and whether the common set has it. */
export interface AccentLanguage {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly common: boolean;
}

/** Every language highlight.js 11.12.0 reads, by id: 193 of them (`npm run accent-languages` writes the list). */
export const ACCENT_LANGUAGES: readonly AccentLanguage[] = CATALOG as AccentLanguage[];

/** The 36 languages highlight.js's common set registers: the ones the app starts with. */
export const COMMON_ACCENT_LANGUAGES: readonly string[] = ACCENT_LANGUAGES.filter((language) => language.common).map((language) => language.id);

/** The language a name is - an id or an alias, in any case - or null. */
export function accentLanguage(name: string): AccentLanguage | null {
  const wanted = name.trim().toLowerCase();
  if (wanted === '') return null;
  return ACCENT_LANGUAGES.find((language) => language.id === wanted) ?? ACCENT_LANGUAGES.find((language) => language.aliases.includes(wanted)) ?? null;
}

// ---- Themes -----------------------------------------------------------------------------------------------------------

/** What a stretch of code is, as a theme colors it. */
export type AccentRole = 'keyword' | 'string' | 'number' | 'comment' | 'title' | 'type' | 'tag' | 'addition' | 'deletion';

/** The two themes. */
export type AccentThemeId = 'light' | 'dark';

/** A theme: the shade a block of code sits on, the color of its plain text, and a color for each role. */
export interface AccentTheme {
  readonly id: AccentThemeId;
  readonly name: string;
  readonly shade: string;
  readonly base: string;
  readonly colors: Readonly<Record<AccentRole, string>>;
}

/**
 * Napkin Light and Napkin Dark: every color at least 4.5:1 against its own
 * shade - the lowest, Light's keywords at 5.0 and Dark's comments at 5.3 - so
 * code reads at any size (WCAG AA).
 */
export const ACCENT_THEMES: Readonly<Record<AccentThemeId, AccentTheme>> = {
  light: {
    id: 'light',
    name: 'Napkin Light',
    shade: '#f6f8fa',
    base: '#1f2328',
    colors: {
      keyword: '#cf222e',
      string: '#0a3069',
      number: '#0550ae',
      comment: '#57606a',
      title: '#6639ba',
      type: '#953800',
      tag: '#116329',
      addition: '#116329',
      deletion: '#82071e',
    },
  },
  dark: {
    id: 'dark',
    name: 'Napkin Dark',
    shade: '#1c2128',
    base: '#e6edf3',
    colors: {
      keyword: '#ff7b72',
      string: '#a5d6ff',
      number: '#79c0ff',
      comment: '#8b949e',
      title: '#d2a8ff',
      type: '#ffa657',
      tag: '#7ee787',
      addition: '#aff5b4',
      deletion: '#ffa198',
    },
  },
};

/**
 * What each highlight.js scope is: a role and its color; `base`, the plain
 * text's again (a template's substitution, a function's parameters,
 * punctuation); or `inherit`, the color around it. A function's or a class's
 * whole header inherits, as GitHub's theme has it, so its parentheses, arrow
 * and return type stay plain and only the names in it are colored. A scope
 * not listed inherits.
 */
export const ACCENT_SCOPES: Readonly<Record<string, AccentRole | 'base' | 'inherit'>> = {
  keyword: 'keyword',
  'built_in': 'type',
  type: 'type',
  literal: 'number',
  number: 'number',
  operator: 'base',
  punctuation: 'base',
  property: 'number',
  regexp: 'tag',
  string: 'string',
  'char.escape': 'number',
  subst: 'base',
  symbol: 'number',
  class: 'inherit',
  function: 'inherit',
  variable: 'type',
  'variable.language': 'keyword',
  'variable.constant': 'number',
  title: 'title',
  'title.class': 'type',
  'title.class.inherited': 'type',
  'title.function': 'title',
  'title.function.invoke': 'title',
  params: 'base',
  comment: 'comment',
  doctag: 'keyword',
  meta: 'number',
  'meta.prompt': 'comment',
  'meta.keyword': 'keyword',
  'meta.string': 'string',
  section: 'number',
  tag: 'tag',
  name: 'tag',
  attr: 'number',
  attribute: 'number',
  'selector-tag': 'tag',
  'selector-id': 'number',
  'selector-class': 'number',
  'selector-attr': 'number',
  'selector-pseudo': 'number',
  'template-tag': 'keyword',
  'template-variable': 'type',
  addition: 'addition',
  deletion: 'deletion',
  bullet: 'type',
  code: 'number',
  emphasis: 'inherit',
  strong: 'inherit',
  formula: 'number',
  link: 'string',
  quote: 'comment',
};

/** What a scope does in a theme: its color, `base`, or `inherit` - its longest listed prefix's, `title.function.invoke` before `title`. */
function scopeColor(theme: AccentTheme, scope: string): string | 'base' | 'inherit' {
  for (let name = scope; name !== ''; name = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '') {
    const role = ACCENT_SCOPES[name];
    if (role === undefined) continue;
    return role === 'base' || role === 'inherit' ? role : theme.colors[role];
  }
  return 'inherit';
}

/** A color's relative luminance, as WCAG 2 has it; null for no paint. */
export function relativeLuminance(color: string): number | null {
  let rgba;
  try {
    rgba = parsePaint(color);
  } catch {
    return null;
  }
  if (!rgba) return null;
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgba.r) + 0.7152 * channel(rgba.g) + 0.0722 * channel(rgba.b);
}

/** How far apart two colors stand, as WCAG 2's contrast ratio: 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a) ?? 1, relativeLuminance(b) ?? 1].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The luminance at which black text and white text stand equally far from a page. */
const EVEN_LUMINANCE = 0.179;

/** The theme a page takes: the one asked for, or with `auto` the one its paper suits - Dark on a page white text reads better on. */
export function accentThemeFor(background: string | null | undefined, choice: 'auto' | AccentThemeId = 'auto'): AccentTheme {
  if (choice !== 'auto') return ACCENT_THEMES[choice];
  const luminance = background ? relativeLuminance(background) : null;
  return luminance !== null && luminance < EVEN_LUMINANCE ? ACCENT_THEMES.dark : ACCENT_THEMES.light;
}

// ---- Reading highlight.js's HTML ----------------------------------------------------------------------------------------

/** A stretch of code in one color, start to end, and the scope that colors it. */
export interface AccentRun {
  start: number;
  end: number;
  scope: string;
  color: string;
}

const SPAN_OPEN = /<span class="([^"<>]*)">/y;
const SPAN_CLOSE = '</span>';
const XML_ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#x27;': "'", '&#39;': "'" };
const ENTITY = /&(?:amp|lt|gt|quot|apos|#x27|#39);/y;

/** A span's scope from its classes: `hljs-title function_` is `title.function`; `hljs`, the root, none. */
function scopeOf(classes: string): string {
  const parts = classes.trim().split(/\s+/);
  const head = parts[0]?.startsWith('hljs-') ? parts[0].slice(5) : '';
  if (head === '') return '';
  return [head, ...parts.slice(1).map((part) => part.replace(/_+$/, ''))].join('.');
}

/**
 * highlight.js's HTML read back into the text it highlighted and the runs a
 * theme colors: nested `<span class="hljs-...">` and the XML entities, and
 * nothing else - any other tag, `<script>` among them, is the text it is, so
 * nothing is rendered as HTML. A run is the innermost scope a color stands
 * for; a scope that sets the plain text's color back makes none.
 */
export function hljsHtmlToRuns(html: string, theme: AccentTheme): { text: string; runs: AccentRun[] } {
  let text = '';
  const runs: AccentRun[] = [];
  const open: Array<{ scope: string; color: string | 'base' | 'inherit' }> = [];
  /** The color the open spans give what is written now, and the scope that gives it. */
  const current = (): { scope: string; color: string } | null => {
    for (let k = open.length - 1; k >= 0; k--) {
      const color = open[k].color;
      if (color === 'base') return null;
      if (color !== 'inherit') return { scope: open[k].scope, color };
    }
    return null;
  };
  const write = (ch: string): void => {
    const at = current();
    const start = text.length;
    text += ch;
    if (!at) return;
    const last = runs[runs.length - 1];
    if (last && last.end === start && last.color === at.color && last.scope === at.scope) last.end = text.length;
    else runs.push({ start, end: text.length, scope: at.scope, color: at.color });
  };
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      SPAN_OPEN.lastIndex = i;
      const span = SPAN_OPEN.exec(html);
      if (span) {
        const scope = scopeOf(span[1]);
        open.push({ scope, color: scope === '' ? 'inherit' : scopeColor(theme, scope) });
        i = SPAN_OPEN.lastIndex;
        continue;
      }
      if (open.length > 0 && html.startsWith(SPAN_CLOSE, i)) {
        open.pop();
        i += SPAN_CLOSE.length;
        continue;
      }
    } else if (html[i] === '&') {
      ENTITY.lastIndex = i;
      const entity = ENTITY.exec(html);
      if (entity) {
        write(XML_ENTITIES[entity[0]]);
        i = ENTITY.lastIndex;
        continue;
      }
    }
    write(html[i]);
    i++;
  }
  return { text, runs };
}

// ---- The highlighter --------------------------------------------------------------------------------------------------

/** What reads code: highlight.js, with the languages registered with it. */
export interface AccentHighlighter {
  /** `code` highlighted as a language - an id or an alias - as HTML; null when no such language is registered. */
  highlight(code: string, language: string): string | null;
  /** The registered language `code` reads most like, and its HTML; null when none does. */
  highlightAuto(code: string): { language: string; html: string } | null;
  /** The id of the registered language a name is - an id or an alias - or null. */
  resolve(name: string): string | null;
}

let highlighter: AccentHighlighter | null = null;
/** Counts each change that colors code otherwise: a highlighter, a language registered, the theme or detection set. */
let generation = 0;

/** Makes a highlighter the one code is read with, or with null, none: code is then plain. Call it again when its languages change. */
export function setAccentHighlighter(next: AccentHighlighter | null): void {
  highlighter = next;
  generation++;
}

/** The highlighter code is read with, or null. */
export function accentHighlighter(): AccentHighlighter | null {
  return highlighter;
}

/** A number that changes whenever code would be colored otherwise: what is kept of a colored text keys on it. */
export function accentGeneration(): number {
  return generation;
}

// ---- What is set ------------------------------------------------------------------------------------------------------

let themeChoice: 'auto' | AccentThemeId = 'auto';
let detect = false;
let page: string | null = null;

/** The theme, `auto` to follow each page's paper, and whether a Markdown code block with no language is read for one. */
export function setAccentOptions(options: { theme?: 'auto' | AccentThemeId; detect?: boolean }): void {
  const theme = options.theme ?? themeChoice;
  const guess = options.detect ?? detect;
  if (theme === themeChoice && guess === detect) return;
  themeChoice = theme;
  detect = guess;
  generation++;
}

/** The theme asked for, and whether unlabelled code is read for its language. */
export function accentOptions(): { theme: 'auto' | AccentThemeId; detect: boolean } {
  return { theme: themeChoice, detect };
}

/** What `make` makes with code colored for a page on `background`: each page drawn says its paper. */
export function withAccentPage<T>(background: string | null | undefined, make: () => T): T {
  const was = page;
  page = background ?? null;
  try {
    return make();
  } finally {
    page = was;
  }
}

/** The paper of the page being drawn now, inside a {@link withAccentPage}: a writer of several pages says each one's as it comes to it. */
export function setAccentPage(background: string | null | undefined): void {
  page = background ?? null;
}

/** The theme code is colored in now: the one asked for, or the one the page being drawn suits. */
export function currentAccentTheme(): AccentTheme {
  return accentThemeFor(page, themeChoice);
}

// ---- Coloring code ---------------------------------------------------------------------------------------------------

/** What reading code gave: its colored runs, the language it was read as, and the language asked for when none is registered by that name. */
export interface AccentResult {
  runs: AccentRun[];
  language: string | null;
  missing: string | null;
}

/**
 * Code colored as `language` reads it - an id or an alias; `auto`, the
 * registered language it reads most like; `none`, plain - in `theme`. No
 * runs with no highlighter, for a language not registered (`missing` names
 * it), or should highlight.js's HTML not read back as the code it was given.
 */
export function accentRuns(code: string, language: string, theme: AccentTheme = currentAccentTheme()): AccentResult {
  const wanted = language.trim();
  const none: AccentResult = { runs: [], language: null, missing: null };
  if (!highlighter || code === '' || wanted === '' || wanted.toLowerCase() === 'none') return none;
  let html: string | null;
  let read: string | null;
  if (wanted.toLowerCase() === 'auto') {
    const auto = highlighter.highlightAuto(code);
    html = auto?.html ?? null;
    read = auto?.language ?? null;
  } else {
    read = highlighter.resolve(wanted);
    if (read === null) return { ...none, missing: wanted };
    html = highlighter.highlight(code, read);
  }
  if (html === null) return none;
  const result = hljsHtmlToRuns(html, theme);
  return result.text === code ? { runs: result.runs, language: read, missing: null } : none;
}

// ---- Accenting a text -----------------------------------------------------------------------------------------------------

/** The paragraphs a stretch of a text touches, as one stretch: the first one's start to the last one's end. */
export function paragraphSpan(text: string, start: number, end: number): { start: number; end: number } {
  const ranges = paragraphRanges(text);
  const first = ranges.find((range) => start <= range.end) ?? ranges[ranges.length - 1];
  const last = [...ranges].reverse().find((range) => Math.max(start, end) >= range.start) ?? first;
  return { start: first.start, end: Math.max(first.start, last.end) };
}

/** Whether any paragraph a stretch of a text touches has an accent. */
export function hasAccent(stroke: Stroke, start: number, end: number): boolean {
  const paras = stroke.typeset?.paras;
  if (!paras) return false;
  const text = stroke.text ?? '';
  const ranges = paragraphRanges(text);
  return ranges.some((range, p) => paras[p]?.accent !== undefined && range.start <= Math.max(start, end) && range.end >= start);
}

/**
 * A text whose paragraphs a stretch touches are accented as `language` - an
 * installed language's id, or `auto` - or with null, no longer accented: the
 * colors are worked out as it is laid out, so they follow every edit. With
 * `code`, a configuration - Markdown Code - their characters follow it too,
 * for a monospaced face.
 */
export function applyAccent(stroke: Stroke, range: { start: number; end: number }, language: string | null, code: TextConfig | null = null): Stroke {
  let next = applyPara(stroke, range, language === null ? { accent: undefined } : { accent: language });
  if (code) next = applyTextConfig(next, paragraphSpan(next.text ?? '', range.start, range.end), code);
  return next;
}

// ---- A text's accented paragraphs ---------------------------------------------------------------------------------------

interface AccentKept {
  text: string | undefined;
  typeset: TypeSpec | undefined;
  color: string;
  generation: number;
  theme: AccentThemeId;
  shown: Stroke | null;
}

const accentKept = new WeakMap<Stroke, AccentKept>();

/** The paragraphs' attributes without their accents: a colored copy has none left to color. */
function withoutAccents(paras: ReadonlyArray<Partial<ParaAttrs> | null>): Array<Partial<ParaAttrs> | null> {
  return paras.map((para) => {
    if (!para || para.accent === undefined) return para;
    const { accent: _accent, ...rest } = para;
    return Object.keys(rest).length > 0 ? rest : null;
  });
}

/**
 * A text whose paragraphs with an `accent` are colored as their language
 * reads them - a run of paragraphs with one accent read as one piece of code,
 * so a comment or a string may run across lines - their plain characters
 * keeping their own color. Null when no paragraph has an accent, with no
 * highlighter, or when the code takes no color. Kept until the text, the
 * highlighter, the options or the theme change.
 */
export function accentShown(stroke: Stroke): Stroke | null {
  const paras = stroke.typeset?.paras;
  if (!paras || !paras.some((para) => para?.accent) || !highlighter) return null;
  const theme = currentAccentTheme();
  const was = accentKept.get(stroke);
  if (was && was.text === stroke.text && was.typeset === stroke.typeset && was.color === stroke.color && was.generation === generation && was.theme === theme.id) return was.shown;
  const text = stroke.text ?? '';
  const ranges = paragraphRanges(text);
  const colors = new Array<string | undefined>(text.length);
  for (let p = 0; p < ranges.length; p++) {
    const accent = paras[p]?.accent;
    if (!accent) continue;
    let q = p;
    while (q + 1 < ranges.length && paras[q + 1]?.accent === accent) q++;
    const start = ranges[p].start;
    const code = text.slice(start, ranges[q].end);
    for (const run of accentRuns(code, accent, theme).runs) colors.fill(run.color, start + run.start, start + run.end);
    p = q;
  }
  const colored = recolorText(stroke, colors);
  let shown: Stroke | null = null;
  if (colored !== stroke) {
    const { paras: had, ...spec } = colored.typeset ?? { kind: 'point' as const };
    const paras = had ? withoutAccents(had) : [];
    shown = { ...colored, typeset: paras.some((para) => para !== null) ? { ...spec, paras } : spec };
  }
  accentKept.set(stroke, { text: stroke.text, typeset: stroke.typeset, color: stroke.color, generation, theme: theme.id, shown });
  return shown;
}
