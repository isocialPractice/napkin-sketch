/**
 * The readers wired to the core itself, as the app, the command line and
 * `napkin-sketch/node` read with them: importing this registers marked's
 * lexer and highlight.js.
 */

import { accentHighlighter, accentOptions, setAccentHighlighter } from '../core/type/accents.js';
import { setMarkdownLexer } from '../core/type/markdown-flow.js';
import { wireMarkdown } from './wire.js';

export const readers = wireMarkdown({ setMarkdownLexer, setAccentHighlighter, accentHighlighter, accentOptions });
