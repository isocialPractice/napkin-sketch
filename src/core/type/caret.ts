/**
 * The caret and the selection in a text, with no DOM: where an index stands
 * on the page, which index a point is nearest, what a selection covers, and
 * where each movement key takes the caret - by character and line in visual
 * order, by word and paragraph, to a line's ends and to the text's. Vertical
 * text swaps the axes: up and down step through a column, left and right
 * from one column to the next. The type editor (renderer/type-editor.ts)
 * keeps a selection and asks this module everything else.
 *
 * Indices are the text's UTF-16 places, as the model's runs are; the caret
 * never stands inside a character that takes two. An index that ends one
 * line and starts the next - a line wrapped at a space - stands at the start
 * of the next unless the selection says it is on the first, as it does after
 * End.
 */

import { lengthTable, pointAtLength, tangentAtLength, type Vec } from '../arc-length.js';
import { glyphCorners, type TypeGlyph, type TypeLayout } from './layout.js';
import { paragraphRanges } from './model.js';

/** A caret, or a selection: where it began (`anchor`) and where it is now (`focus`). */
export interface TextSelection {
  anchor: number;
  focus: number;
  /** The line the focus is drawn on, where its index ends one line and starts the next. */
  line?: number;
  /** Where up and down aim along a line, kept through a run of them. */
  goal?: number;
}

/** A place the caret can stand: its index, its line, and the caret drawn there, from the line's top to its bottom. */
export interface CaretSlot {
  index: number;
  line: number;
  /** On the baseline. */
  at: Vec;
  top: Vec;
  bottom: Vec;
}

/** Where each movement key takes the caret. */
export type CaretMove =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'word-left'
  | 'word-right'
  | 'paragraph-up'
  | 'paragraph-down'
  | 'line-start'
  | 'line-end'
  | 'text-start'
  | 'text-end';

/** How long a burst of typing waits for the next key before it is an undo step of its own, ms. */
export const BURST_MS = 1000;

const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** How many UTF-16 places the character at `index` takes. */
function charLength(text: string, index: number): number {
  return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}

/** The selection's two ends, in order. */
export function selectionRange(selection: TextSelection): { start: number; end: number } {
  return { start: Math.min(selection.anchor, selection.focus), end: Math.max(selection.anchor, selection.focus) };
}

/** A selection with no extent at `index`. */
export function caretAtIndex(index: number, line?: number): TextSelection {
  return { anchor: index, focus: index, ...(line !== undefined ? { line } : {}) };
}

/**
 * Every place the caret can stand, line by line and in order: before each
 * character the layout set, and after each line's last one - on an empty
 * line, at its start. A character the layout did not set, being overset, has
 * none.
 *
 * Each caret is as tall as the character typing there would copy - the one
 * before it on its line, or at the line's start the one after - and stands
 * on that character's baseline, shift and all: the caret shows the size and
 * the place of what the next key would set. Vertically it lies across the
 * column, as wide as the character's em.
 */
export function caretSlots(layout: TypeLayout, text: string): CaretSlot[] {
  const byLine = new Map<number, TypeGlyph[]>();
  for (const glyph of layout.glyphs) {
    if (glyph.index < 0) continue;
    const list = byLine.get(glyph.line) ?? [];
    list.push(glyph);
    byLine.set(glyph.line, list);
  }
  const vertical = layout.orientation === 'vertical';
  const slots: CaretSlot[] = [];
  layout.lines.forEach((line, i) => {
    // At `pen`, sized and lifted as the character `by` is; with none, as the empty line is.
    const slot = (index: number, pen: Vec, across: Vec, by: TypeGlyph | null): CaretSlot => {
      const up = by ? (vertical ? by.font.size / 2 : by.ascent) : line.ascent;
      const down = by ? (vertical ? by.font.size / 2 : by.descent) : line.descent;
      const at = by ? add(pen, across, -by.shift) : pen;
      return { index, line: i, at, top: add(at, across, -up), bottom: add(at, across, down) };
    };
    const glyphs = byLine.get(i) ?? [];
    glyphs.forEach((glyph, k) => slots.push(slot(glyph.index, glyph.pen, glyph.across, glyphs[k - 1] ?? glyph)));
    const last = glyphs[glyphs.length - 1];
    if (last) {
      slots.push(slot(last.index + charLength(text, last.index), add(last.pen, last.along, last.advance), last.across, last));
    } else {
      const start = emptyLineStart(layout, i);
      slots.push(slot(line.start, start.at, start.across, null));
    }
  });
  return slots;
}

/** Where an empty line starts, and which way is down across it. */
function emptyLineStart(layout: TypeLayout, i: number): { at: Vec; across: Vec } {
  const line = layout.lines[i];
  if (layout.path) {
    const table = lengthTable(layout.path.run, layout.path.closed);
    const t = tangentAtLength(table, line.x);
    return { at: pointAtLength(table, line.x), across: { x: -t.y, y: t.x } };
  }
  // A column's next is to its left.
  if (layout.orientation === 'vertical') return { at: { x: line.x, y: line.y }, across: { x: -1, y: 0 } };
  return { at: { x: line.x, y: line.y }, across: { x: 0, y: 1 } };
}

/**
 * The slot an index stands at: on the line the selection names when it is
 * there, else on the later of two lines it ends and starts. An index with no
 * slot - inside a character that takes two, or past what the layout set -
 * stands at the nearest before it.
 */
export function slotFor(slots: readonly CaretSlot[], index: number, line?: number): CaretSlot | null {
  let found: CaretSlot | null = null;
  for (const slot of slots) {
    if (slot.index !== index) continue;
    if (line !== undefined && slot.line === line) return slot;
    found = slot;
  }
  if (found) return found;
  let before: CaretSlot | null = null;
  for (const slot of slots) if (slot.index <= index && (!before || slot.index >= before.index)) before = slot;
  return before ?? slots[0] ?? null;
}

/** The caret for a selection's focus: its line segment on the page, top to bottom, and where it meets its baseline. Null with nothing laid out. */
export function caretSegment(layout: TypeLayout, text: string, selection: TextSelection): { at: Vec; top: Vec; bottom: Vec; line: number } | null {
  const slot = slotFor(caretSlots(layout, text), selection.focus, selection.line);
  return slot ? { at: slot.at, top: slot.top, bottom: slot.bottom, line: slot.line } : null;
}

/** How far along its line a slot is, in the layout's own direction. */
function alongOf(layout: TypeLayout, slot: CaretSlot): number {
  return layout.orientation === 'vertical' ? slot.at.y : slot.at.x;
}

/**
 * The index a point is nearest, and its line: on the line whose band the
 * point is in, or is nearest across, the place along it nearest the point.
 * Along a path, the nearest place outright.
 */
export function caretAt(layout: TypeLayout, text: string, p: Vec): { index: number; line: number } {
  const slots = caretSlots(layout, text);
  if (slots.length === 0) return { index: 0, line: 0 };
  if (layout.kind === 'path') {
    let best = slots[0];
    for (const slot of slots) if (Math.hypot(slot.at.x - p.x, slot.at.y - p.y) < Math.hypot(best.at.x - p.x, best.at.y - p.y)) best = slot;
    return { index: best.index, line: best.line };
  }
  const vertical = layout.orientation === 'vertical';
  // The nearest line across: no distance inside its band.
  let line = 0;
  let nearest = Infinity;
  layout.lines.forEach((l, i) => {
    const across = vertical ? p.x : p.y;
    const lo = vertical ? l.x - l.ascent : l.y - l.ascent;
    const hi = vertical ? l.x + l.descent : l.y + l.descent;
    const off = across < lo ? lo - across : across > hi ? across - hi : 0;
    if (off < nearest - 1e-9) {
      nearest = off;
      line = i;
    }
  });
  const target = vertical ? p.y : p.x;
  let best: CaretSlot | null = null;
  for (const slot of slots) {
    if (slot.line !== line) continue;
    if (!best || Math.abs(alongOf(layout, slot) - target) < Math.abs(alongOf(layout, best) - target)) best = slot;
  }
  return best ? { index: best.index, line } : { index: slots[0].index, line: slots[0].line };
}

/**
 * What a selection covers on the page, as quadrilaterals: on each line it
 * crosses, from where it starts to where it ends, the line's height; along a
 * path, each character's box.
 */
export function selectionQuads(layout: TypeLayout, text: string, start: number, end: number): Array<[Vec, Vec, Vec, Vec]> {
  if (end <= start) return [];
  if (layout.kind === 'path') {
    return layout.glyphs.filter((g) => g.index >= start && g.index < end).map((g) => glyphCorners(g));
  }
  const slots = caretSlots(layout, text);
  const vertical = layout.orientation === 'vertical';
  const quads: Array<[Vec, Vec, Vec, Vec]> = [];
  layout.lines.forEach((line, i) => {
    const inside = slots.filter((slot) => slot.line === i && slot.index >= start && slot.index <= end);
    if (inside.length === 0) return;
    // The selection running on past the line's end reaches its last slot.
    const first = inside[0];
    const last = inside[inside.length - 1];
    if (last.index <= first.index) return;
    // The line's whole band, whatever size each caret in it is.
    if (vertical) {
      const right = line.x + line.descent;
      const left = line.x - line.ascent;
      quads.push([{ x: right, y: first.at.y }, { x: right, y: last.at.y }, { x: left, y: last.at.y }, { x: left, y: first.at.y }]);
    } else {
      const top = line.y - line.ascent;
      const bottom = line.y + line.descent;
      quads.push([{ x: first.at.x, y: top }, { x: last.at.x, y: top }, { x: last.at.x, y: bottom }, { x: first.at.x, y: bottom }]);
    }
  });
  return quads;
}

// ---- Movement ----------------------------------------------------------------------------------------

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_']/u.test(ch);
}

/** The next character boundary after `index`, or the text's end. */
export function nextIndex(text: string, index: number): number {
  return index >= text.length ? text.length : index + charLength(text, index);
}

/** The character boundary before `index`, or 0. */
export function previousIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const low = text.charCodeAt(index - 1);
  const high = index >= 2 ? text.charCodeAt(index - 2) : 0;
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? index - 2 : index - 1;
}

/** Back to the start of the word the index is in or after, as Ctrl+Left goes. */
export function wordStartBefore(text: string, index: number): number {
  let i = index;
  while (i > 0 && !isWordChar(text[i - 1])) i--;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  return i;
}

/** On to the start of the next word, as Ctrl+Right goes: past the word the index is in, then past the gap after it. */
export function wordStartAfter(text: string, index: number): number {
  let i = index;
  while (i < text.length && isWordChar(text[i])) i++;
  while (i < text.length && !isWordChar(text[i]) && text[i] !== '\n') i++;
  if (i === index && i < text.length) i++;
  return i;
}

/**
 * The word an index is in, as a double-click takes it: its letters, or the
 * run of spaces or the run of other characters it stands in.
 */
export function wordBounds(text: string, index: number): { start: number; end: number } {
  if (text.length === 0) return { start: 0, end: 0 };
  const at = Math.min(Math.max(0, index), text.length - 1);
  const kind = (ch: string): number => (ch === '\n' ? 3 : isWordChar(ch) ? 0 : /\s/.test(ch) ? 1 : 2);
  // At the end of a word, a click takes the word before.
  const here = index > 0 && (index >= text.length || kind(text[at]) !== 0) && kind(text[index - 1]) === 0 ? index - 1 : at;
  const k = kind(text[here]);
  if (k === 3) return { start: here, end: here };
  let start = here;
  while (start > 0 && kind(text[start - 1]) === k) start--;
  let end = here;
  while (end < text.length && kind(text[end]) === k) end++;
  return { start, end };
}

/** The paragraph an index is in, as a triple-click takes it: its text, the newline after it not included. */
export function paragraphBounds(text: string, index: number): { start: number; end: number } {
  for (const range of paragraphRanges(text)) if (index <= range.end) return range;
  const last = paragraphRanges(text).pop();
  return last ?? { start: 0, end: 0 };
}

/**
 * Where a movement key takes the selection. With `extend` (Shift) the anchor
 * stays; without it, a selection with extent collapses to its near end on a
 * step left or right, rather than moving past it. Up and down keep their goal
 * along the line through a run of them.
 */
export function moveCaret(layout: TypeLayout, text: string, selection: TextSelection, move: CaretMove, extend: boolean): TextSelection {
  const vertical = layout.orientation === 'vertical';
  // Vertical text: up and down step through the column, left and right go from column to column - left to the next.
  const key: CaretMove = vertical
    ? ({ up: 'left', down: 'right', left: 'down', right: 'up' } as Partial<Record<CaretMove, CaretMove>>)[move] ?? move
    : move;
  const { start, end } = selectionRange(selection);
  const done = (focus: number, line?: number, goal?: number): TextSelection => ({
    anchor: extend ? selection.anchor : focus,
    focus,
    ...(line !== undefined ? { line } : {}),
    ...(goal !== undefined ? { goal } : {}),
  });
  if (!extend && start !== end && (key === 'left' || key === 'right')) return done(key === 'left' ? start : end);
  const slots = caretSlots(layout, text);
  const here = slotFor(slots, selection.focus, selection.line);
  switch (key) {
    case 'left':
      return done(previousIndex(text, selection.focus));
    case 'right':
      return done(nextIndex(text, selection.focus));
    case 'word-left':
      return done(wordStartBefore(text, selection.focus));
    case 'word-right':
      return done(wordStartAfter(text, selection.focus));
    case 'paragraph-up': {
      const own = paragraphBounds(text, selection.focus);
      if (selection.focus > own.start) return done(own.start);
      return done(own.start > 0 ? paragraphBounds(text, own.start - 1).start : 0);
    }
    case 'paragraph-down': {
      const own = paragraphBounds(text, selection.focus);
      return done(own.end < text.length ? own.end + 1 : text.length);
    }
    case 'text-start':
      return done(0);
    case 'text-end':
      return done(text.length);
    case 'line-start':
    case 'line-end': {
      if (!here) return done(key === 'line-start' ? 0 : text.length);
      const own = slots.filter((slot) => slot.line === here.line);
      const slot = key === 'line-start' ? own[0] : own[own.length - 1];
      return done(slot.index, slot.line);
    }
    case 'up':
    case 'down': {
      if (!here) return done(selection.focus);
      const goal = selection.goal ?? alongOf(layout, here);
      const line = here.line + (key === 'up' ? -1 : 1);
      if (layout.kind === 'path' || line < 0 || line >= layout.lines.length) return done(key === 'up' ? 0 : text.length, undefined, goal);
      let best: CaretSlot | null = null;
      for (const slot of slots) {
        if (slot.line !== line) continue;
        if (!best || Math.abs(alongOf(layout, slot) - goal) < Math.abs(alongOf(layout, best) - goal)) best = slot;
      }
      return best ? done(best.index, best.line, goal) : done(selection.focus, undefined, goal);
    }
  }
}

// ---- Bursts of typing ------------------------------------------------------------------------------

/** One edit in a burst of typing: when it was made, and where it left the caret. */
export interface BurstEdit {
  at: number;
  /** Where the caret stood before the edit, and after it. */
  from: number;
  to: number;
}

/**
 * Whether an edit carries on the burst the last one belongs to: it comes
 * within {@link BURST_MS} of it, and starts where it left the caret. A caret
 * moved in between - a jump - starts a burst of its own, as does a pause.
 */
export function burstContinues(last: BurstEdit | null, next: BurstEdit, wait = BURST_MS): boolean {
  if (!last) return false;
  return next.at - last.at <= wait && next.from === last.to;
}
