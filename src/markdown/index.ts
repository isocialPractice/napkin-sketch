/**
 * `napkin-sketch/markdown`: Markdown Flow's and Clean Language Accents'
 * readers for the API.
 *
 * Importing it registers marked's lexer - GitHub's tables, task lists and
 * strikethrough, a single newline a line break - and highlight.js, with its
 * 36 common languages, with `napkin-sketch`. A Markdown Flow text there then
 * shows as its Markdown renders, its fenced code colored, and a paragraph's
 * accent colors its code: on the page, in SVG, PDF and PNG, and in an
 * Illustrator script. `markdownToType` reads with that lexer, and
 * `registerAccentLanguage` installs another language from its highlight.js
 * definition.
 *
 * ```ts
 * import { markdownToType, registerAccentLanguage } from 'napkin-sketch/markdown';
 * import fortran from 'highlight.js/lib/languages/fortran';
 *
 * registerAccentLanguage('fortran', fortran);
 * markdownToType('# Notes\n\n- one\n- **two**').text; // 'Notes\none\ntwo'
 * ```
 *
 * It imports `napkin-sketch` rather than holding a copy of it, so the readers
 * it registers are the ones the API reads with.
 */

import {
  MARKDOWN_CONFIG_NAMES,
  MARKDOWN_THEME,
  accentHighlighter,
  accentOptions,
  markdownEnter,
  markdownToType as readMarkdown,
  setAccentHighlighter,
  setMarkdownLexer,
  type MarkdownOptions,
  type MarkdownTheme,
  type MarkdownType,
} from '../api/index.js';
import { wireMarkdown } from './wire.js';

const readers = wireMarkdown({ setMarkdownLexer, setAccentHighlighter, accentHighlighter, accentOptions });

/** marked's lexer, as Markdown Flow reads with it. */
export const markedLexer = readers.markedLexer;

/** highlight.js, as Clean Language Accents read with it. */
export const hljsHighlighter = readers.hljsHighlighter;

/** Installs a language from its highlight.js definition: code in it is colored from now on. */
export const registerAccentLanguage = readers.registerAccentLanguage;

/** Takes a language away: code in it is plain from now on. */
export const unregisterAccentLanguage = readers.unregisterAccentLanguage;

/** The ids of the languages installed now. */
export const accentLanguagesInstalled = readers.accentLanguagesInstalled;

/** Markdown as a text shows it, read with marked's lexer unless `options` gives another. */
export function markdownToType(source: string, theme: MarkdownTheme = MARKDOWN_THEME, options: MarkdownOptions = {}): MarkdownType {
  return readMarkdown(source, theme, { lexer: markedLexer, ...options });
}

export { MARKDOWN_CONFIG_NAMES, MARKDOWN_THEME, markdownEnter };
export type { AccentLanguageDefinition } from './highlight.js';
export type { MarkdownBlock, MarkdownLexer, MarkdownOptions, MarkdownTheme, MarkdownToken, MarkdownType } from '../api/index.js';
