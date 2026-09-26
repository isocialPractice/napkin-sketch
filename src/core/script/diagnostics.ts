/**
 * Building, sorting and printing diagnostics, and suggesting what a typo meant.
 *
 * A diagnostic's level comes from its code, never from the call site, so a code
 * is an error everywhere or a warning everywhere. Printed, a diagnostic takes
 * the shape editors and CI already parse: `file:line:column: level code:
 * message`.
 */

import { DIAGNOSTIC_LEVELS, type Diagnostic, type DiagnosticCode } from './instructions.js';

/** Where a diagnostic points: a line and column in text, or an index path in a JSON script. */
export interface Where {
  line?: number;
  column?: number;
  index?: number[];
}

/** Builds a diagnostic, taking its level from its code. */
export function makeDiagnostic(
  code: DiagnosticCode,
  message: string,
  where: Where = {},
  extra: { verb?: string; expected?: string } = {},
): Diagnostic {
  const diagnostic: Diagnostic = { level: DIAGNOSTIC_LEVELS[code], code, message };
  if (where.line !== undefined) diagnostic.line = where.line;
  if (where.column !== undefined) diagnostic.column = where.column;
  if (where.index !== undefined) diagnostic.index = [...where.index];
  if (extra.verb !== undefined) diagnostic.verb = extra.verb;
  if (extra.expected !== undefined) diagnostic.expected = extra.expected;
  return diagnostic;
}

/** True when any diagnostic is an error. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.level === 'error');
}

function compareIndex(a: number[] | undefined, b: number[] | undefined): number {
  const x = a ?? [];
  const y = b ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** Diagnostics in reading order: by line and column, or by index path. The sort is stable. */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort(
    (a, b) =>
      (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || compareIndex(a.index, b.index),
  );
}

/**
 * One line per diagnostic, in the shape editors and CI parsers read:
 * `card.napkin:3:12: error expected-length: ...`, or for a JSON script
 * `card.napkin.json[3][0]: error ...`.
 */
export function formatDiagnostic(diagnostic: Diagnostic, file = 'script'): string {
  let where = file;
  if (diagnostic.line !== undefined) {
    where += `:${diagnostic.line}`;
    if (diagnostic.column !== undefined) where += `:${diagnostic.column}`;
  } else if (diagnostic.index !== undefined && diagnostic.index.length > 0) {
    where += diagnostic.index.map((i) => `[${i}]`).join('');
  }
  return `${where}: ${diagnostic.level} ${diagnostic.code}: ${diagnostic.message}`;
}

/** The number of single-character edits between two words. */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/**
 * The candidate a word most likely meant: an alias when one is listed, or the
 * nearest candidate within a third of the word's length in edits. `undefined`
 * when nothing is close enough to be worth saying.
 */
export function suggest(
  word: string,
  candidates: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): string | undefined {
  const lower = word.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(aliases, lower)) return aliases[lower];
  const allowed = Math.max(1, Math.floor(lower.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= allowed ? best : undefined;
}
