/**
 * The values napkin script reads, and how each is written back.
 *
 * One vocabulary for the text parser, the JSON validator, the formatter and the
 * evaluator: what a length literal, a color, an identifier and a number look
 * like. Keeping it in one place is what keeps a script that parses as text
 * valid as JSON, and the other way round.
 */

import { parseColor } from '../graphic-design/color.js';
import { isLengthUnit, type LengthUnit } from '../units.js';
import { EXPRESSION_FUNCTIONS, PAGE_NAMES } from './expr.js';
import type { Expr } from './instructions.js';

/** A length literal taken apart: its number, and its unit as written, lower-cased, or `null` for none. */
export interface LengthLiteral {
  value: number;
  unit: string | null;
}

const LENGTH_LITERAL = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([A-Za-z]+|%)?$/;

/**
 * Takes `"10mm"`, `"50%"`, `"4px"` or `"12"` apart. Returns null for text that
 * is not a number with an optional unit; the unit is not checked, so a caller
 * can say `cm` is not a unit rather than that the text is not a length.
 */
export function readLengthLiteral(text: string): LengthLiteral | null {
  const m = LENGTH_LITERAL.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2] ? m[2].toLowerCase() : null };
}

/** A unit a length may carry: `px`, `in`, `mm`, `pt`, or `%` for a share of the page. */
export function isKnownUnit(unit: string): unit is LengthUnit | '%' {
  return unit === '%' || isLengthUnit(unit);
}

/** The units, as a message lists them. */
export const UNITS_SENTENCE = 'The units are px, in, mm and pt, and % for a share of the page.';

/** True for `{ expr: "..." }`, the object form of an expression. */
export function isExpr(value: unknown): value is Expr {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as Expr).expr === 'string';
}

/** Writes a number the way the tokenizer reads it back: plain digits where it can, and never `-0`. */
export function formatNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

/**
 * True for a color every output can paint: `#` and 3, 4, 6 or 8 hex digits, a
 * CSS color name, or `rgb()`, `rgba()`, `hsl()` and `hsla()`. `none` is not a
 * color; the verbs that accept it spell it themselves.
 */
export function isColor(text: string): boolean {
  const value = text.trim().toLowerCase();
  if (value === '' || value === 'none') return false;
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}

/** Letters, digits and underscores, starting with a letter or an underscore. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The names an expression already means something by, which a `let` or a `repeat` cannot take. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set<string>([...PAGE_NAMES, ...Object.keys(EXPRESSION_FUNCTIONS)]);

/** True for a name a `let` or a `repeat` can take. */
export function isIdentifier(text: string): boolean {
  return IDENTIFIER.test(text) && !RESERVED_NAMES.has(text);
}

/**
 * Writes a string in double quotes. A backslash, a quote, a newline and a tab
 * are escaped; everything else is written as it is.
 */
export function quoteString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
