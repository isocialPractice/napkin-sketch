/**
 * Markdown Flow's and Clean Language Accents' readers wired to a core: marked's
 * lexer, highlight.js, and the way to install a language. A core is given
 * rather than imported. `core.ts` wires it once: the app with its own
 * bundle, and the package's entries and the command line with the one core
 * they share, so a language installed through any of them is installed for
 * all of them.
 */

import type { AccentHighlighter } from '../core/type/accents.js';
import type { MarkdownLexer } from '../core/type/markdown-flow.js';
import { createHljsReader, type AccentLanguageDefinition } from './highlight.js';
import { createMarkedLexer } from './lexer.js';

/** What the readers need of a core. */
export interface MarkdownCore {
  setMarkdownLexer(lexer: MarkdownLexer | null): void;
  setAccentHighlighter(highlighter: AccentHighlighter | null): void;
  accentHighlighter(): AccentHighlighter | null;
  accentOptions(): { detect: boolean };
}

/** The readers, registered with their core. */
export interface MarkdownReaders {
  readonly markedLexer: MarkdownLexer;
  readonly hljsHighlighter: AccentHighlighter;
  /**
   * Installs a language from its highlight.js definition - or a common one,
   * with none, from the app's own: code in it is colored from now on. False
   * for a language with neither.
   */
  registerAccentLanguage(id: string, definition?: AccentLanguageDefinition): boolean;
  /** Takes a language away: code in it is plain from now on. */
  unregisterAccentLanguage(id: string): void;
  /** The ids of the languages installed now. */
  accentLanguagesInstalled(): string[];
}

/** The readers, made and registered with `core`. */
export function wireMarkdown(core: MarkdownCore): MarkdownReaders {
  const reader = createHljsReader();
  const markedLexer = createMarkedLexer({ highlighter: () => core.accentHighlighter(), detect: () => core.accentOptions().detect });
  core.setMarkdownLexer(markedLexer);
  core.setAccentHighlighter(reader.highlighter);
  return {
    markedLexer,
    hljsHighlighter: reader.highlighter,
    registerAccentLanguage(id, definition) {
      if (!reader.register(id, definition)) return false;
      // The same highlighter again: what was colored without the language is colored again.
      core.setAccentHighlighter(reader.highlighter);
      return true;
    },
    unregisterAccentLanguage(id) {
      reader.unregister(id);
      core.setAccentHighlighter(reader.highlighter);
    },
    accentLanguagesInstalled: () => reader.languages(),
  };
}
