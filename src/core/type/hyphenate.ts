/**
 * Hyphenation by Liang's algorithm - TeX's - over the en-US patterns
 * (`hyphenation/en-us.json`: hyph-utf8's hyph-en-us, Liang's patterns from
 * Knuth's hyphen.tex with Gerard D.C. Kuiken's additions, under the notice it
 * carries). A word is matched against every pattern inside it, each pattern's
 * digits voting between letters, the highest vote winning; an odd vote is a
 * place a hyphen may go. A word the exceptions list spells out takes its
 * breaks from there.
 *
 * Where a hyphen may go is then held to Illustrator's limits by default: a
 * word of 6 letters or more, 2 letters before the hyphen and 2 after. TeX's
 * are 2 and 3, so `university` breaks `uni-ver-si-ty` here where TeX gives
 * `uni-ver-sity`. How many lines in a row may end in a hyphen is the layout's
 * call (core/type/layout.ts).
 */

import table from './hyphenation/en-us.json';

/** When a word may break: how long it must be, and how many letters each side of a hyphen keeps. */
export interface HyphenationLimits {
  /** The fewest letters a word must have to break at all. */
  minWord: number;
  /** The fewest letters before a hyphen, and after one. */
  before: number;
  after: number;
}

/** Illustrator's defaults: words of 6 letters or more, 2 letters before the hyphen and 2 after. */
export const ILLUSTRATOR_LIMITS: Readonly<HyphenationLimits> = { minWord: 6, before: 2, after: 2 };

/** TeX's: any word long enough, 2 letters before the hyphen and 3 after. */
export const TEX_LIMITS: Readonly<HyphenationLimits> = { minWord: 5, before: 2, after: 3 };

/** The notice the patterns ship under, for the third-party notices. */
export const HYPHENATION_NOTICE = { source: table.source, copyright: table.copyright, license: table.license } as const;

interface Patterns {
  /** Each pattern's letters, with the votes between them: `points[i]` before the i-th letter. */
  byLetters: Map<string, number[]>;
  longest: number;
  /** Words spelled out whole, by the letters, with where they break. */
  exceptions: Map<string, number[]>;
}

let loaded: Patterns | null = null;

/** The patterns, read the first time a word is hyphenated. */
function patterns(): Patterns {
  if (loaded) return loaded;
  const byLetters = new Map<string, number[]>();
  let longest = 0;
  for (const raw of table.patterns.split(' ')) {
    if (!raw) continue;
    const letters = raw.replace(/\d/g, '');
    const points = new Array<number>(letters.length + 1).fill(0);
    let i = 0;
    for (const ch of raw) {
      if (ch >= '0' && ch <= '9') points[i] = Number(ch);
      else i++;
    }
    byLetters.set(letters, points);
    longest = Math.max(longest, letters.length);
  }
  const exceptions = new Map<string, number[]>();
  for (const raw of table.exceptions.split(' ')) {
    if (!raw) continue;
    const breaks: number[] = [];
    let at = 0;
    for (const part of raw.split('-').slice(0, -1)) {
      at += part.length;
      breaks.push(at);
    }
    exceptions.set(raw.replace(/-/g, ''), breaks);
  }
  loaded = { byLetters, longest, exceptions };
  return loaded;
}

/** Whether a word is one the patterns know how to read: plain letters, a to z. */
export function hyphenatable(word: string): boolean {
  return /^[A-Za-z]+$/.test(word);
}

/**
 * Where a word may break, as indices into it: a hyphen at `i` goes between
 * `word[i - 1]` and `word[i]`. A word of anything but the letters a to z, or
 * too short for the limits, has none.
 */
export function hyphenationPoints(word: string, limits: HyphenationLimits = ILLUSTRATOR_LIMITS): number[] {
  if (!hyphenatable(word) || word.length < Math.max(limits.minWord, limits.before + limits.after)) return [];
  const lower = word.toLowerCase();
  const { byLetters, longest, exceptions } = patterns();
  const keep = (i: number): boolean => i >= limits.before && i <= lower.length - limits.after;
  const known = exceptions.get(lower);
  if (known) return known.filter(keep);
  // The word between dots, which patterns that start or end a word match.
  const w = `.${lower}.`;
  const votes = new Array<number>(w.length + 1).fill(0);
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j <= Math.min(w.length, i + longest); j++) {
      const p = byLetters.get(w.slice(i, j));
      if (!p) continue;
      for (let k = 0; k < p.length; k++) if (p[k] > votes[i + k]) votes[i + k] = p[k];
    }
  }
  const points: number[] = [];
  // votes[m + 1] sits between the word's letters m - 1 and m (the dot shifts it by one).
  for (let m = 1; m < lower.length; m++) if (votes[m + 1] % 2 === 1 && keep(m)) points.push(m);
  return points;
}

/** A word cut where it may break: `hy`, `phen`, `ation`. */
export function hyphenate(word: string, limits: HyphenationLimits = ILLUSTRATOR_LIMITS): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const at of hyphenationPoints(word, limits)) {
    parts.push(word.slice(start, at));
    start = at;
  }
  parts.push(word.slice(start));
  return parts;
}
