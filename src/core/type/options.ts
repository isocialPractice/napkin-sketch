/**
 * The Type menu's options forms, as data and with no DOM: a vector editor's
 * Type on a Path Options and Area Type Options, each a list of fields over a
 * text's path or its frame, and a Text Configuration's Options, its name and
 * the character attributes it sets.
 *
 * A text's form opens on the values of the first text it is given, and writes
 * back only the fields a person changed, so texts set differently each keep
 * what they were not asked to change. Lengths are page pixels here, as the
 * model holds them; the form shows them, and reads them typed, in points, as
 * the Type panel does. A configuration's field left blank is one it does not
 * set.
 */

import type { Stroke } from '../types.js';
import { CONFIG_NAME_MAX, frameRectangle, typeSpecOf, withTypeset, TYPE_LIMITS, type CharAttrs, type PathAlign, type PathEffect, type TextConfig } from './model.js';

/** Which text form: Type on a Path Options, or Area Type Options. */
export type TypeOptionsKind = 'path' | 'area';

/** Which form the options popup shows: a text's, or a Text Configuration's Options. */
export type TypeOptionsForm = TypeOptionsKind | 'config';

/** One field of a form. */
export interface TypeOptionField {
  /** The path's, the frame's or the configuration's own property the field sets. */
  readonly key: string;
  readonly label: string;
  /**
   * One of a few words; a length, in points; a box to tick; a color or none;
   * a name typed in; a number, with its unit's sign; or a leading, Auto or a
   * length.
   */
  readonly kind: 'choice' | 'length' | 'check' | 'paint' | 'text' | 'number' | 'leading';
  /** The field's tooltip. */
  readonly title: string;
  readonly choices?: readonly { readonly value: string; readonly label: string }[];
  /** A length's or a number's range, page pixels for a length. */
  readonly min?: number;
  readonly max?: number;
  /** A number's sign: `%`, `°`. */
  readonly suffix?: string;
  /** The field may be left blank: null, which a configuration takes as an attribute it does not set. */
  readonly optional?: boolean;
}

/** A field's value: a word, a length in page pixels, a tick, or a color (null for none). */
export type TypeOptionValue = string | number | boolean | null;

/** A form's values, by field. */
export type TypeOptionValues = Readonly<Record<string, TypeOptionValue>>;

/** A vector editor's names for its Type on a Path effects. */
export const PATH_EFFECT_LABELS: Readonly<Record<PathEffect, string>> = {
  rainbow: 'Rainbow',
  skew: 'Skew',
  ribbon: '3D Ribbon',
  stair: 'Stair Step',
  gravity: 'Gravity',
};

/** Which line of the characters sits on the path, in a vector editor's order. */
export const PATH_ALIGN_LABELS: Readonly<Record<PathAlign, string>> = {
  ascender: 'Ascender',
  descender: 'Descender',
  center: 'Center',
  baseline: 'Baseline',
};

const choicesOf = (labels: Readonly<Record<string, string>>): { value: string; label: string }[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Each form's title, as its menu row names it. */
export const TYPE_OPTIONS_TITLES: Readonly<Record<TypeOptionsForm, string>> = {
  path: 'Type on a Path Options',
  area: 'Area Type Options',
  config: 'Text Configuration Options',
};

/** A choice of `on` and `off`, for a character attribute that is one or the other. */
const ON_OFF = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

/** The frame's stroke weight, and the inset, as `readTypeset` holds them. */
const FRAME_WIDTH = { min: 0.01, max: 1000 } as const;
const FRAME_INSET = { min: 0, max: 5000 } as const;

/** Each form's fields, top to bottom. */
export const TYPE_OPTION_FIELDS: Readonly<Record<TypeOptionsForm, readonly TypeOptionField[]>> = {
  path: [
    { key: 'effect', label: 'Effect', kind: 'choice', choices: choicesOf(PATH_EFFECT_LABELS), title: 'How each character stands on the path' },
    { key: 'align', label: 'Align to Path', kind: 'choice', choices: choicesOf(PATH_ALIGN_LABELS), title: 'Which line of the characters sits on the path' },
    {
      key: 'spacing',
      label: 'Spacing',
      kind: 'length',
      min: TYPE_LIMITS.pathSpacing.min,
      max: TYPE_LIMITS.pathSpacing.max,
      title: 'Draws the characters together round a sharp turn, so they do not fan apart on its outside; below 0 spreads them',
    },
    { key: 'flip', label: 'Flip', kind: 'check', title: 'The text runs the other way along the path, on its other side' },
  ],
  area: [
    { key: 'inset', label: 'Inset Spacing', kind: 'length', min: FRAME_INSET.min, max: FRAME_INSET.max, title: 'How far the text stands in from the frame' },
    { key: 'autoHeight', label: 'Auto Size', kind: 'check', title: 'The frame grows down to fit the text, and shrinks with it' },
    { key: 'fill', label: 'Frame Fill', kind: 'paint', title: "The frame's own fill, under the text" },
    { key: 'stroke', label: 'Frame Stroke', kind: 'paint', title: "The frame's own outline" },
    { key: 'width', label: 'Stroke Weight', kind: 'length', min: FRAME_WIDTH.min, max: FRAME_WIDTH.max, title: "The weight of the frame's outline" },
  ],
  config: [
    { key: 'name', label: 'Name', kind: 'text', title: "The configuration's name, as the Type panel lists it" },
    { key: 'fontFamily', label: 'Font', kind: 'text', optional: true, title: "The font family; blank keeps each text's own" },
    { key: 'fontStyle', label: 'Style', kind: 'text', optional: true, title: 'The face: Regular, Bold, Italic; blank keeps the text\'s own' },
    { key: 'fontSize', label: 'Size', kind: 'length', optional: true, min: TYPE_LIMITS.fontSize.min, max: TYPE_LIMITS.fontSize.max, title: 'The font size, in points' },
    { key: 'leading', label: 'Leading', kind: 'leading', optional: true, min: TYPE_LIMITS.leading.min, max: TYPE_LIMITS.leading.max, title: 'The line height: Auto, or a length' },
    { key: 'kerning', label: 'Kerning', kind: 'choice', optional: true, choices: [{ value: 'auto', label: 'Auto' }, { value: 'none', label: 'None' }], title: "The font's own pair kerning, on or off" },
    { key: 'tracking', label: 'Tracking', kind: 'number', optional: true, min: TYPE_LIMITS.tracking.min, max: TYPE_LIMITS.tracking.max, title: 'Space after every character, in thousandths of an em' },
    { key: 'wordSpacing', label: 'Word Spacing', kind: 'number', suffix: '%', optional: true, min: TYPE_LIMITS.wordSpacing.min, max: TYPE_LIMITS.wordSpacing.max, title: "A word space's width, as a share of the font's own" },
    { key: 'vScale', label: 'Vertical Scale', kind: 'number', suffix: '%', optional: true, min: TYPE_LIMITS.scale.min, max: TYPE_LIMITS.scale.max, title: 'Vertical scale' },
    { key: 'hScale', label: 'Horizontal Scale', kind: 'number', suffix: '%', optional: true, min: TYPE_LIMITS.scale.min, max: TYPE_LIMITS.scale.max, title: 'Horizontal scale' },
    { key: 'baselineShift', label: 'Baseline Shift', kind: 'length', optional: true, min: TYPE_LIMITS.baselineShift.min, max: TYPE_LIMITS.baselineShift.max, title: 'Up from the baseline, in points' },
    { key: 'rotation', label: 'Rotation', kind: 'number', suffix: '°', optional: true, min: -180, max: 180, title: 'Each character turned about its own middle' },
    { key: 'caps', label: 'Capitals', kind: 'choice', optional: true, choices: [{ value: 'normal', label: 'Normal' }, { value: 'all', label: 'All Caps' }, { value: 'small', label: 'Small Caps' }], title: 'All capitals, small capitals, or as typed' },
    { key: 'position', label: 'Position', kind: 'choice', optional: true, choices: [{ value: 'normal', label: 'Normal' }, { value: 'superscript', label: 'Superscript' }, { value: 'subscript', label: 'Subscript' }], title: 'Set on the baseline, raised or lowered' },
    { key: 'underline', label: 'Underline', kind: 'choice', optional: true, choices: ON_OFF, title: 'Underlined, or not' },
    { key: 'strike', label: 'Strikethrough', kind: 'choice', optional: true, choices: ON_OFF, title: 'Struck through, or not' },
    { key: 'color', label: 'Color', kind: 'paint', title: "The characters' color; unticked keeps each text's own" },
    { key: 'highlight', label: 'Highlight', kind: 'paint', title: 'A background behind the characters; unticked sets none' },
  ],
};

/** The form a text takes: Type on a Path Options for Path Typing, Area Type Options for Sheet Typing, none for Sideless Typing. */
export function typeOptionsKindOf(stroke: Stroke): TypeOptionsKind | null {
  const kind = typeSpecOf(stroke).kind;
  return kind === 'path' ? 'path' : kind === 'area' ? 'area' : null;
}

/** A text's values for its form, or null when the text is not that kind. */
export function typeOptionValues(kind: TypeOptionsKind, stroke: Stroke): Record<string, TypeOptionValue> | null {
  const spec = typeSpecOf(stroke);
  if (kind === 'path') {
    const path = spec.kind === 'path' ? spec.path : undefined;
    if (!path) return null;
    return { effect: path.effect, align: path.align, spacing: path.spacing ?? 0, flip: path.flip === true };
  }
  const frame = spec.kind === 'area' ? spec.frame : undefined;
  if (!frame) return null;
  return { inset: frame.inset ?? 0, autoHeight: frame.autoHeight === true, fill: frame.fill ?? null, stroke: frame.stroke ?? null, width: frame.width ?? 1 };
}

/** A value a field can take, held to its range; undefined for one it cannot. A blank - null - is one only an optional field takes. */
export function typeOptionValue(field: TypeOptionField, value: unknown): TypeOptionValue | undefined {
  const held = (n: number): number => Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, n));
  if (value === null && field.optional) return null;
  switch (field.kind) {
    case 'choice':
      return typeof value === 'string' && field.choices?.some((choice) => choice.value === value) ? value : undefined;
    case 'check':
      return typeof value === 'boolean' ? value : undefined;
    case 'paint':
      return value === null ? null : typeof value === 'string' && value.trim() !== '' ? value : undefined;
    case 'text': {
      if (typeof value !== 'string') return undefined;
      const text = value.trim().slice(0, CONFIG_NAME_MAX);
      return text !== '' ? text : field.optional ? null : undefined;
    }
    case 'leading':
      if (value === 'auto') return 'auto';
      return typeof value === 'number' && Number.isFinite(value) ? held(value) : undefined;
    case 'length':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? held(value) : undefined;
  }
}

/** The fields a Text Configuration sets, as the form names them, and the attribute each one is. */
const CONFIG_ATTRS: ReadonlyArray<keyof CharAttrs> = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'leading',
  'kerning',
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
  'highlight',
];

/** A Text Configuration's values for its Options: its name, and each attribute it sets, null for one it does not. */
export function configOptionValues(config: TextConfig): Record<string, TypeOptionValue> {
  const values: Record<string, TypeOptionValue> = { name: config.name };
  for (const key of CONFIG_ATTRS) {
    const value = config.attrs[key];
    if (key === 'underline' || key === 'strike') values[key] = value === undefined ? null : value ? 'on' : 'off';
    else values[key] = value === undefined ? null : (value as TypeOptionValue);
  }
  return values;
}

/**
 * A Text Configuration with the named fields of `values` written to it: its
 * name, and each attribute - a blank one taken off, so the configuration no
 * longer sets it. Each value is held to its field's range; one a field
 * cannot take is left as it was.
 */
export function configWithOptions(config: TextConfig, values: TypeOptionValues, keys: Iterable<string>): TextConfig {
  const attrs: Partial<CharAttrs> = { ...config.attrs };
  let name = config.name;
  for (const key of keys) {
    const field = TYPE_OPTION_FIELDS.config.find((each) => each.key === key);
    const value = field ? typeOptionValue(field, values[key]) : undefined;
    if (value === undefined) continue;
    if (key === 'name') {
      if (typeof value === 'string') name = value;
      continue;
    }
    const attr = key as keyof CharAttrs;
    if (value === null) delete attrs[attr];
    else if (attr === 'underline' || attr === 'strike') attrs[attr] = value === 'on';
    else (attrs as Record<string, unknown>)[attr] = value;
  }
  return { id: config.id, name, attrs };
}

/**
 * A text with the named fields of `values` written to its path or frame,
 * each held to its range. The text itself when it is not that kind, or when
 * nothing it is asked to take changes it.
 */
export function withTypeOptions(stroke: Stroke, kind: TypeOptionsKind, values: TypeOptionValues, keys: Iterable<string>): Stroke {
  const now = typeOptionValues(kind, stroke);
  if (!now) return stroke;
  const next: Record<string, TypeOptionValue> = { ...now };
  let changed = false;
  for (const key of keys) {
    const field = TYPE_OPTION_FIELDS[kind].find((each) => each.key === key);
    const value = field ? typeOptionValue(field, values[key]) : undefined;
    if (value === undefined || value === now[key]) continue;
    next[key] = value;
    changed = true;
  }
  if (!changed) return stroke;
  const spec = typeSpecOf(stroke);
  if (kind === 'path' && spec.path) {
    const path = { ...spec.path, effect: next.effect as PathEffect, align: next.align as PathAlign, spacing: next.spacing as number, flip: next.flip === true };
    return withTypeset(stroke, { ...spec, path });
  }
  if (kind === 'area' && spec.frame) {
    // A default is left out rather than written, as the files have it; no outline, no weight.
    const { inset: _inset, autoHeight: _auto, fill: _fill, stroke: _stroke, width: _width, ...shape } = spec.frame;
    const frame = {
      ...shape,
      ...((next.inset as number) > 0 ? { inset: next.inset as number } : {}),
      ...(next.autoHeight === true ? { autoHeight: true } : {}),
      ...(typeof next.fill === 'string' ? { fill: next.fill } : {}),
      ...(typeof next.stroke === 'string' ? { stroke: next.stroke, ...(next.width !== 1 ? { width: next.width as number } : {}) } : {}),
    };
    return withTypeset(stroke, { ...spec, frame });
  }
  return stroke;
}

/**
 * Why a field is greyed for these texts, or null when it is not: Auto Size
 * grows only a rectangle square to the page, so with no such frame among
 * them it has nothing to do; the weight is the outline's, so with no outline
 * it has nothing to weigh.
 */
export function typeOptionDisabled(kind: TypeOptionsKind, strokes: readonly Stroke[], key: string, values: TypeOptionValues): string | null {
  if (kind !== 'area') return null;
  if (key === 'autoHeight') {
    const grows = strokes.some((stroke) => {
      const frame = typeSpecOf(stroke).frame;
      return frame !== undefined && frameRectangle(frame.anchors) !== null;
    });
    return grows ? null : 'Only a rectangle square to the page grows to fit its text';
  }
  if (key === 'width' && values.stroke === null) return 'The frame has no outline to weigh';
  return null;
}
