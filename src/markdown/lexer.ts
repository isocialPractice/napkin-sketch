/**
 * Markdown Flow's reader: marked's lexer, with GitHub's tables, task lists and
 * strikethrough, and a single newline a line break - what typing expects -
 * and `marked-highlight` reading each fenced block with the highlighter the
 * core has, so a block's text comes as highlight.js's HTML, which the core
 * reads into colors and never renders.
 *
 * It takes the core it serves as a {@link LexerHost} rather than importing
 * one, so `napkin-sketch/markdown` can give it the API's core and the app its
 * own (see wire.ts).
 */

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import type { AccentHighlighter } from '../core/type/accents.js';
import type { MarkdownLexer, MarkdownToken } from '../core/type/markdown-flow.js';

/** What the lexer asks of the core it reads for: its highlighter, and whether a block with no language is read for one. */
export interface LexerHost {
  highlighter(): AccentHighlighter | null;
  detect(): boolean;
}

/**
 * A lexer that reads with marked and has each fenced block highlighted: as
 * the language its fence names when the highlighter has it, as the language
 * it reads most like when it names none and detection is on, and otherwise
 * left as it is - its `escaped` unset - so the core shows it plain.
 */
export function createMarkedLexer(host: LexerHost): MarkdownLexer {
  const marked = new Marked(
    { gfm: true, breaks: true },
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code: string, language: string): string {
        const highlighter = host.highlighter();
        if (!highlighter) return code;
        if (language !== '') {
          const id = highlighter.resolve(language);
          return id === null ? code : highlighter.highlight(code, id) ?? code;
        }
        return host.detect() ? highlighter.highlightAuto(code)?.html ?? code : code;
      },
    }),
  );
  return (source) => {
    const tokens = marked.lexer(source);
    if (marked.defaults.walkTokens) marked.walkTokens(tokens, marked.defaults.walkTokens);
    return tokens as unknown as readonly MarkdownToken[];
  };
}
