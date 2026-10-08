/**
 * The Type panel's model, with no DOM (renderer/type-panel.ts draws it): what
 * the Character and Paragraph tabs show for the text they act on, what a
 * value typed into one of their fields means, and the change each control
 * makes.
 *
 * The panel acts on targets, a vector editor's rule: while a text is being
 * edited, the selected stretch of it, or with none the caret, whose typing
 * attributes a character change sets; with text marks selected by a
 * selection tool, all of each one's text. A field shows the value every
 * target has, or nothing where they differ.
 *
 * Lengths are page pixels in the model and points in the fields: a field
 * reads `12pt`, `3 mm`, `0.5in` or `16px`, and a bare number in points.
 */

import { toPx, type LengthUnit } from '../units.js';
import {
  AUTO_LEADING,
  DEFAULT_CHAR,
  DEFAULT_PARA,
  applyChar,
  applyPara,
  charAttrsAt,
  paraAttrsOf,
  paragraphAt,
  paragraphRanges,
  styleSegments,
  typeSpecOf,
  withTypeset,
  type CharAttrs,
  type ParaAttrs,
} from './model.js';
import type { Stroke } from '../types.js';

/** Where the panel acts in one text: a stretch of it, or with `start` equal to `end` the caret, whose typing attributes `typing` holds. */
export interface TypeTarget {
  stroke: Stroke;
  start: number;
  end: number;
  typing?: Partial<CharAttrs> | null;
}

/** The character attributes the Character tab shows, in its order. */
export const PANEL_CHAR_KEYS = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'leading',
  'kerning',
  'kern',
  'tracking',
  'wordSpacing',
  'vScale',
  'hScale',
  'baselineShift',
  'rotation',
  'caps',
  'position',
  'underline',
  'strike',
  'color',
] as const;

type PanelCharKey = (typeof PANEL_CHAR_KEYS)[number];

/** The paragraph attributes the Paragraph tab shows. */
export const PANEL_PARA_KEYS = ['align', 'leftIndent', 'rightIndent', 'firstIndent', 'spaceBefore', 'spaceAfter', 'hyphenate'] as const;

type PanelParaKey = (typeof PANEL_PARA_KEYS)[number];

/** A list as the Paragraph tab reads it: the list every paragraph has, `none` when none has one. */
export type ListReading = NonNullable<ParaAttrs['list']> | 'none';

/** What the panel shows: each value the targets share, or null where they differ. */
export interface TypeReading {
  char: { [K in PanelCharKey]: CharAttrs[K] | null };
  para: { [K in PanelParaKey]: ParaAttrs[K] | null } & { list: ListReading | null };
  orientation: 'horizontal' | 'vertical' | null;
  /** Some target is Path Typing, which has no vertical. */
  path: boolean;
}

/** One value, when every one of `values` is it; else null. */
function shared<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const key = (v: T): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const first = key(values[0]);
  return values.every((v) => key(v) === first) ? values[0] : null;
}

/** The attributes typing at `index` would set: the character before it, or at the start the one after, and the typing attributes. */
export function typingAttrsAt(stroke: Stroke, index: number, typing?: Partial<CharAttrs> | null): CharAttrs {
  return { ...charAttrsAt(stroke, index > 0 ? index - 1 : 0), ...(typing ?? {}) };
}

/**
 * What the panel shows for its targets: over a stretch, every character's
 * attributes and every paragraph it touches; at a caret, the attributes
 * typing there would set and the caret's paragraph. Null with no targets.
 */
export function readTargets(targets: readonly TypeTarget[]): TypeReading | null {
  if (targets.length === 0) return null;
  const chars: CharAttrs[] = [];
  const paras: ParaAttrs[] = [];
  const orientations: Array<'horizontal' | 'vertical'> = [];
  let path = false;
  for (const target of targets) {
    const text = target.stroke.text ?? '';
    const start = Math.max(0, Math.min(text.length, target.start));
    const end = Math.max(start, Math.min(text.length, target.end));
    if (end > start) {
      for (const segment of styleSegments(target.stroke)) if (segment.end > start && segment.start < end) chars.push(segment.attrs);
    } else {
      chars.push(typingAttrsAt(target.stroke, start, target.typing));
    }
    for (let p = paragraphAt(text, start); p <= paragraphAt(text, end); p++) paras.push(paraAttrsOf(target.stroke, p));
    const spec = typeSpecOf(target.stroke);
    if (spec.kind === 'path') path = true;
    orientations.push(spec.orientation ?? 'horizontal');
  }
  const char = {} as TypeReading['char'];
  for (const key of PANEL_CHAR_KEYS) (char as Record<string, unknown>)[key] = shared(chars.map((attrs) => attrs[key]));
  const para = {} as TypeReading['para'];
  for (const key of PANEL_PARA_KEYS) (para as Record<string, unknown>)[key] = shared(paras.map((attrs) => attrs[key]));
  para.list = shared<ListReading>(paras.map((attrs) => attrs.list ?? 'none'));
  return { char, para, orientation: shared(orientations), path };
}

/**
 * What the panel shows with no text to act on: the next text's, as the text
 * tool will make it - its family, size and ink - and the rest as new text has
 * it.
 */
export function nextTextReading(base: Partial<CharAttrs>): TypeReading {
  const attrs = { ...DEFAULT_CHAR, ...base };
  const char = {} as TypeReading['char'];
  for (const key of PANEL_CHAR_KEYS) (char as Record<string, unknown>)[key] = attrs[key];
  const para = {} as TypeReading['para'];
  for (const key of PANEL_PARA_KEYS) (para as Record<string, unknown>)[key] = DEFAULT_PARA[key];
  para.list = 'none';
  return { char, para, orientation: 'horizontal', path: false };
}

// ---- Typed values -----------------------------------------------------------------------------------------

const NUMBER = String.raw`([+-]?(?:\d+(?:\.\d*)?|\.\d+))`;

/** The length units a field takes, beyond the app's own: centimetres, and picas of 12 points. */
type FieldUnit = LengthUnit | 'cm' | 'pc';

function unitPx(value: number, unit: FieldUnit): number {
  if (unit === 'cm') return toPx(value * 10, 'mm');
  if (unit === 'pc') return toPx(value * 12, 'pt');
  return toPx(value, unit);
}

/**
 * A length typed into a field, in page pixels: `12`, `12pt`, `3 mm`, `1.5cm`,
 * `0.5in`, `1pc`, `16px`. A bare number is in `unit`, points unless said.
 * Null when it is not a length.
 */
export function parseLength(text: string, unit: LengthUnit = 'pt'): number | null {
  const m = new RegExp(`^\\s*${NUMBER}\\s*(pt|px|mm|cm|in|pc)?\\s*$`, 'i').exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return unitPx(value, ((m[2]?.toLowerCase() as FieldUnit | undefined) ?? unit));
}

/** A number typed with or without its sign: `75`, `75%`, `-15°`. Null when it is not one. */
export function parseAmount(text: string, suffix = ''): number | null {
  const tail = suffix ? `(?:\\s*${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?` : '';
  const m = new RegExp(`^\\s*${NUMBER}${tail}\\s*$`, 'i').exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

/** The Leading field: Auto, a length, or a share of the size - the line height `140%` is - each read from it. */
export type LeadingInput = { auto: true } | { px: number } | { share: number };

/** What was typed into the Leading field, or null when it reads as none of its kinds. */
export function parseLeading(text: string): LeadingInput | null {
  if (/^\s*auto\s*$/i.test(text)) return { auto: true };
  const share = new RegExp(`^\\s*${NUMBER}\\s*%\\s*$`).exec(text);
  if (share) {
    const value = Number(share[1]);
    return Number.isFinite(value) && value >= 0 ? { share: value / 100 } : null;
  }
  const px = parseLength(text);
  return px !== null && px >= 0 ? { px } : null;
}

/** The Kerning field: the font's own pairs on (`Auto`) or off (`None`), or kerning by hand in thousandths of an em. */
export type KerningInput = { kerning: 'auto' | 'none' } | { kern: number };

/** What was typed into the Kerning field, or null. */
export function parseKerning(text: string): KerningInput | null {
  if (/^\s*auto\s*$/i.test(text)) return { kerning: 'auto' };
  if (/^\s*none\s*$/i.test(text)) return { kerning: 'none' };
  const kern = parseAmount(text);
  return kern === null ? null : { kern };
}

/** A length as its field shows it: points, to two places - `12 pt` - or blank when the targets differ. */
export function showLength(px: number | null): string {
  if (px === null || !Number.isFinite(px)) return '';
  const pt = Math.round((px * 72) / 96 * 100) / 100;
  return `${Object.is(pt, -0) ? 0 : pt} pt`;
}

/** A number as its field shows it, with its sign: `100%`, `15°`; blank when the targets differ. */
export function showAmount(value: number | null, suffix = ''): string {
  if (value === null || !Number.isFinite(value)) return '';
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}${suffix}`;
}

/** The Leading field's value: `Auto`, or the leading in points. */
export function showLeading(leading: number | 'auto' | null): string {
  if (leading === null) return '';
  return leading === 'auto' ? 'Auto' : showLength(leading);
}

/** The Kerning field's value: kerning by hand when there is some, else `Auto` or `None`. */
export function showKerning(kerning: 'auto' | 'none' | null, kern: number | null): string {
  if (kern === null) return '';
  if (kern !== 0) return showAmount(kern);
  if (kerning === null) return '';
  return kerning === 'auto' ? 'Auto' : 'None';
}

// ---- Changes ------------------------------------------------------------------------------------------------

/**
 * A change a control makes: character attributes; leading as a share of each
 * character's size; kerning by hand; paragraph attributes; a list's level up
 * or down; the text's orientation.
 */
export type TypeChange =
  | { kind: 'char'; patch: Partial<CharAttrs> }
  | { kind: 'leading-share'; share: number }
  | { kind: 'kern'; value: number }
  | { kind: 'para'; patch: Partial<ParaAttrs> }
  | { kind: 'list-level'; by: number }
  | { kind: 'orientation'; value: 'horizontal' | 'vertical' };

/** True when a change, at a caret, sets the typing attributes rather than the text. */
export function setsTyping(change: TypeChange): boolean {
  return change.kind === 'char' || change.kind === 'leading-share';
}

/** The typing attributes a change at the caret sets, from what typing there would set now; null when it changes the text instead. */
export function typingPatch(change: TypeChange, now: CharAttrs): Partial<CharAttrs> | null {
  if (change.kind === 'char') return change.patch;
  if (change.kind === 'leading-share') return { leading: now.fontSize * change.share };
  return null;
}

/** The character before `index` on its line - the one whose kerning by hand is the caret's - or null at a line's start. */
export function kernIndex(text: string, index: number): number | null {
  if (index <= 0 || index > text.length) return null;
  const low = text.charCodeAt(index - 1);
  const before = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return text[before] === '\n' ? null : before;
}

/**
 * A text with a change made over a target's stretch. At a caret, a
 * character change is the typing attributes' and leaves the text as it is
 * (see {@link typingPatch}); kerning is between the characters either side
 * of the caret; a paragraph change takes the caret's paragraph. A text
 * along a path has no vertical.
 */
export function applyTypeChange(target: TypeTarget, change: TypeChange): Stroke {
  const stroke = target.stroke;
  const text = stroke.text ?? '';
  const start = Math.max(0, Math.min(text.length, target.start));
  const end = Math.max(start, Math.min(text.length, target.end));
  const range = { start, end };
  switch (change.kind) {
    case 'char':
      return end > start ? applyChar(stroke, range, change.patch) : stroke;
    case 'leading-share': {
      if (end <= start) return stroke;
      let out = stroke;
      for (const segment of styleSegments(stroke)) {
        const a = Math.max(segment.start, start);
        const b = Math.min(segment.end, end);
        if (b > a) out = applyChar(out, { start: a, end: b }, { leading: segment.attrs.fontSize * change.share });
      }
      return out;
    }
    case 'kern': {
      if (end > start) return applyChar(stroke, range, { kern: change.value });
      const before = kernIndex(text, start);
      return before === null ? stroke : applyChar(stroke, { start: before, end: start }, { kern: change.value });
    }
    case 'para':
      return applyPara(stroke, range, change.patch);
    case 'list-level': {
      let out = stroke;
      const ranges = paragraphRanges(text);
      for (let p = paragraphAt(text, start); p <= paragraphAt(text, end); p++) {
        const list = paraAttrsOf(out, p).list;
        if (!list) continue;
        const level = Math.min(9, Math.max(1, list.level + change.by));
        if (level !== list.level) out = applyPara(out, { start: ranges[p].start, end: ranges[p].start }, { list: { ...list, level } });
      }
      return out;
    }
    case 'orientation': {
      const spec = typeSpecOf(stroke);
      if (spec.kind === 'path') return stroke;
      const vertical = change.value === 'vertical';
      if ((spec.orientation === 'vertical') === vertical) return stroke;
      const { orientation: _was, ...rest } = spec;
      return withTypeset(stroke, vertical ? { ...rest, orientation: 'vertical' } : rest);
    }
  }
}

// ---- Toggles and lists --------------------------------------------------------------------------------------

/** The Character tab's toggle buttons. */
export type TypeToggle = 'all-caps' | 'small-caps' | 'superscript' | 'subscript' | 'underline' | 'strike';

export const TYPE_TOGGLES: readonly TypeToggle[] = ['all-caps', 'small-caps', 'superscript', 'subscript', 'underline', 'strike'];

/** Whether a toggle shows pressed: every target has it, none has (false), or some (`mixed`). */
export function toggleState(toggle: TypeToggle, reading: TypeReading): boolean | 'mixed' {
  const { caps, position, underline, strike } = reading.char;
  const is = (value: unknown, on: unknown): boolean | 'mixed' => (value === null ? 'mixed' : value === on);
  switch (toggle) {
    case 'all-caps':
      return is(caps, 'all');
    case 'small-caps':
      return is(caps, 'small');
    case 'superscript':
      return is(position, 'superscript');
    case 'subscript':
      return is(position, 'subscript');
    case 'underline':
      return is(underline, true);
    case 'strike':
      return is(strike, true);
  }
}

/** What a toggle button does: puts its attribute on, or off when every target has it already. */
export function toggleChange(toggle: TypeToggle, reading: TypeReading): TypeChange {
  const on = toggleState(toggle, reading) !== true;
  switch (toggle) {
    case 'all-caps':
      return { kind: 'char', patch: { caps: on ? 'all' : 'normal' } };
    case 'small-caps':
      return { kind: 'char', patch: { caps: on ? 'small' : 'normal' } };
    case 'superscript':
      return { kind: 'char', patch: { position: on ? 'superscript' : 'normal' } };
    case 'subscript':
      return { kind: 'char', patch: { position: on ? 'subscript' : 'normal' } };
    case 'underline':
      return { kind: 'char', patch: { underline: on } };
    case 'strike':
      return { kind: 'char', patch: { strike: on } };
  }
}

/** The bullets a bulleted list can take, and the ways a numbered one counts. */
export const BULLET_MARKERS = ['•', '◦', '▪', '–', '✓'] as const;
export const NUMBER_MARKERS = ['1.', 'a.', 'i.'] as const;

/**
 * Bulleted or Numbered: the list on for every paragraph the targets touch,
 * with `marker` when given - or off, when they are all that list already and
 * no marker is asked for. A list put on keeps the level the paragraphs had.
 */
export function listChange(kind: 'bullet' | 'number', reading: TypeReading, marker?: string): TypeChange {
  const now = reading.para.list;
  const same = now !== null && now !== 'none' && now.kind === kind;
  if (same && marker === undefined) return { kind: 'para', patch: { list: undefined } };
  const level = now !== null && now !== 'none' ? now.level : 1;
  const kept = same && now.marker !== undefined ? { marker: now.marker } : {};
  return { kind: 'para', patch: { list: { kind, level, ...kept, ...(marker !== undefined ? { marker } : {}) } } };
}

/** The family a field shows for a family as the model keeps it: a CSS list's first name, unquoted. */
export function primaryFamily(family: string): string {
  const first = family.split(',')[0]?.trim() ?? '';
  return first.replace(/^["']|["']$/g, '');
}

/** Leading as the size it stands for, to show when it is Auto: a line and a quarter of the size. */
export function autoLeading(size: number): number {
  return size * AUTO_LEADING;
}
