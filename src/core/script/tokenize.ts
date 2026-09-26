/**
 * Napkin script text to tokens.
 *
 * A cursor over the string with one small reader per kind of token, in the
 * manner of `parsePathD`. Every token keeps its line and column, 1-based, and
 * its offsets into the source, so the parser can point at it and can lift an
 * expression or a color function out of the text exactly as it was written.
 *
 * The lexical rules:
 *
 * - An instruction ends at a newline or a `;`. A `{` or a `}` ends one too.
 * - `#` at the start of a line, or followed by a space or the end of the line,
 *   starts a comment that runs to the end of the line. `#` followed by
 *   anything else starts a color, `#1f2328`.
 * - A string is double-quoted. `\"`, `\\`, `\n` and `\t` are escapes; any other
 *   backslash is kept as written, so a Windows path survives.
 * - A number may carry a unit or a `%` straight after it (`10mm`, `50%`), and a
 *   sign when it stands outside parentheses (`-10`). Inside parentheses a sign
 *   is an operator, for the expression reader to sort out.
 * - A word is letters, digits and underscores, starting with a letter or an
 *   underscore. Outside parentheses a hyphen with a letter after it joins
 *   two such runs into one word, as in `drop-shadow`; inside, it is a minus.
 */

import type { Diagnostic } from './instructions.js';
import { makeDiagnostic } from './diagnostics.js';

/** What a token is. */
export type TokenKind = 'word' | 'number' | 'string' | 'color' | 'punct' | 'op' | 'sep' | 'eof';

/** One token of a script. */
export interface Token {
  kind: TokenKind;
  /** The token exactly as written; a string keeps its quotes. */
  text: string;
  /** A string's contents with its escapes resolved, or a number's value. */
  value?: string | number;
  /** A number's unit as written, lower-cased: `''` for none, `'%'` for a share of the page. */
  unit?: string;
  line: number;
  column: number;
  /** Offsets into the source: the token is `source.slice(start, end)`. */
  start: number;
  end: number;
}

/** The tokens of a script, ending in one `eof` token, and what could not be read. */
export interface TokenizeResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const UNIT = /[A-Za-z]+/y;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
/** A word outside parentheses, where a hyphen can join its parts: `drop-shadow`, `hue-rotate`. */
const JOINED_WORD = /[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z][A-Za-z0-9_]*)*/y;
const COLOR = /#[A-Za-z0-9]*/y;
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t' };

/** Splits a script into tokens. Never throws; what it cannot read it reports and skips. */
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let lineStart = i;
  let depth = 0;
  let atLineStart = true;

  const push = (kind: TokenKind, start: number, end: number, extra: Partial<Token> = {}): void => {
    tokens.push({ kind, text: source.slice(start, end), line, column: start - lineStart + 1, start, end, ...extra });
    atLineStart = false;
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '\n') {
      push('sep', i, i + 1);
      i++;
      line++;
      lineStart = i;
      depth = 0;
      atLineStart = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === ';') {
      push('sep', i, i + 1);
      i++;
      depth = 0;
      continue;
    }
    if (ch === '#') {
      const comment = atLineStart || next === undefined || next === ' ' || next === '\t' || next === '\r' || next === '\n' || next === '#';
      if (comment) {
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
      COLOR.lastIndex = i;
      const m = COLOR.exec(source)!;
      push('color', i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      const start = i;
      let value = '';
      i++;
      let closed = false;
      while (i < source.length && source[i] !== '\n') {
        const c = source[i];
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === '\\' && i + 1 < source.length && source[i + 1] !== '\n') {
          const escape = ESCAPES[source[i + 1]];
          value += escape ?? `\\${source[i + 1]}`;
          i += 2;
          continue;
        }
        value += c;
        i++;
      }
      if (!closed) {
        diagnostics.push(
          makeDiagnostic('unclosed-string', 'This string runs to the end of the line without its closing `"`.', {
            line,
            column: start - lineStart + 1,
          }),
        );
      }
      push('string', start, i, { value });
      continue;
    }
    const signed = (ch === '-' || ch === '+') && depth === 0 && /[0-9.]/.test(next ?? '');
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next ?? '')) || signed) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(source);
      if (m) {
        const start = i;
        i += m[0].length;
        let unit = '';
        if (source[i] === '%') {
          unit = '%';
          i++;
        } else {
          UNIT.lastIndex = i;
          const u = UNIT.exec(source);
          if (u) {
            unit = u[0].toLowerCase();
            i += u[0].length;
          }
        }
        // `|| 0` reads `-0` as `0`: the two print the same, and should compare the same.
        push('number', start, i, { value: Number(m[0]) || 0, unit });
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      const pattern = depth === 0 ? JOINED_WORD : WORD;
      pattern.lastIndex = i;
      const m = pattern.exec(source)!;
      push('word', i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === ',') {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      push('punct', i, i + 1);
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      push('op', i, i + 1);
      i++;
      continue;
    }
    diagnostics.push(
      makeDiagnostic('unexpected-token', `\`${ch}\` cannot appear here.`, { line, column: i - lineStart + 1 }),
    );
    i++;
  }
  tokens.push({ kind: 'eof', text: '', line, column: i - lineStart + 1, start: i, end: i });
  return { tokens, diagnostics };
}
