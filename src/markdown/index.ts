/**
 * `@isocialpractice/napkin-sketch/markdown`: Markdown Flow's and Clean Language Accents'
 * readers for the API.
 *
 * Importing it registers marked's lexer - GitHub's tables, task lists and
 * strikethrough, a single newline a line break - and highlight.js, with its
 * 36 common languages, with `@isocialpractice/napkin-sketch`. A Markdown Flow text there then
 * shows as its Markdown renders, its fenced code colored, and a paragraph's
 * accent colors its code: on the page, in SVG, PDF and PNG, and in an
 * Illustrator script. `markdownToType` reads with that lexer, and
 * `registerAccentLanguage` installs another language from its highlight.js
 * definition.
 *
 * ```ts
 * import { markdownToType, registerAccentLanguage } from '@isocialpractice/napkin-sketch/markdown';
 * import fortran from 'highlight.js/lib/languages/fortran';
 *
 * registerAccentLanguage('fortran', fortran);
 * markdownToType('# Notes\n\n- one\n- **two**').text; // 'Notes\none\ntwo'
 * ```
 *
 * It shares one core with the package's other entries and the command line,
 * and one set of readers with them: the ones `./core.js` makes and registers.
 * Importing it registers them again, so it gives the core marked's lexer and
 * highlight.js even after something else took them away.
 */

import {
  MARKDOWN_CONFIG_NAMES,
  MARKDOWN_THEME,
  markdownEnter,
  markdownToType as readMarkdown,
  setAccentHighlighter,
  setMarkdownLexer,
  type MarkdownOptions,
  type MarkdownTheme,
  type MarkdownType,
} from '../api/index.js';
import { readers } from './core.js';

// Registered when ./core.js first ran, by whichever entry imported it; again
// here, so importing this entry is always what puts the readers in place.
setMarkdownLexer(readers.markedLexer);
setAccentHighlighter(readers.hljsHighlighter);

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
