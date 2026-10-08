/**
 * Composition Styles: rule sets keyed by layer name that restyle a page, or a
 * composition, whose layers are named to match - a layout program's object
 * styles, applied by name rather than one object at a time.
 *
 * A style is JSON ({@link CompositionStyle}): a name, and three kinds of
 * rules, each a map from a layer name to what the rule sets.
 *
 * - **`layers`** set a layer's own properties - opacity, blend, Isolate
 *   Blending, effects, whether it shows - and a fill and a stroke color for
 *   every mark under it, unless a text or a stroke rule names the same layer.
 * - **`text`** set the text marks under the named layer: any character or
 *   paragraph attribute, a Text Configuration by name, Markdown Flow, a Clean
 *   Language Accent, effects and the blend.
 * - **`strokes`** set the paths under it: the outline, the fill or gradient,
 *   the profile, opacity, effects and the blend. Pictures keep their look.
 *
 * A rule names a layer as its name reads, trimmed and in any case, and
 * reaches every layer under it; where two rules reach one mark, the one
 * nearer the mark wins. What a rule leaves out stays as it was. A blend is a
 * layer's, so a text or stroke rule's goes on the layer each mark sits on.
 *
 * {@link applyCompositionStyle} restyles a page, or a graphic-design
 * composition by its elements' names, and reports what did not go as asked:
 * rules that matched no layer, with the names nearest theirs
 * ({@link nameSuggestions}); text rules on layers with no text and stroke
 * rules on layers with no paths; configurations the book does not have; and
 * values held to their range. {@link captureCompositionStyle} records a
 * page's named layers as a style that, applied again, changes nothing.
 *
 * No DOM, no store: the app, the API, the command line and the embed share it.
 */

import { BLEND_MODE_IDS, blendModeOf, isBlended, type BlendModeId } from './blend.js';
import { EFFECT_TYPES, readEffect, readEffects, type Effect } from './effects.js';
import type { Composition } from './graphic-design/compose.js';
import { parseColor } from './graphic-design/color.js';
import type { CompositionDocument, Element, GradientPaint, GroupElement, PageOptions, TextElement } from './graphic-design/types.js';
import { paintPatch } from './paint.js';
import { normalizeGradient } from './serialize.js';
import { profileApplies } from './stroke-profile.js';
import {
  dashPatternFor,
  defaultOpacityFor,
  isClosedStroke,
  isImageStroke,
  isTextStroke,
  normalizedStops,
  type Gradient,
  type Layer,
  type Sketch,
  type SketchBook,
  type Stroke,
  type StrokeProfile,
  type StrokeStyle,
} from './types.js';
import { ACCENT_LANGUAGES, accentLanguage, applyAccent } from './type/accents.js';
import { applyTextConfig, configsOf, DEFAULT_CONFIG_NAME, readConfigTargets } from './type/configs.js';
import { MARKDOWN_CONFIG_NAMES, markdownConfig, withMarkdownConfigs, type MarkdownConfigKey } from './type/markdown-flow.js';
import {
  applyPara,
  CONFIG_NAME_MAX,
  paraAttrsOf,
  paragraphRanges,
  readParaAttrs,
  restyleText,
  sameConfigName,
  styleSegments,
  TYPE_LIMITS,
  typeSpecOf,
  withTypeset,
  type CharAttrs,
  type ParaAttrs,
  type TextConfig,
} from './type/model.js';

// ---- The format ---------------------------------------------------------------------------------------------------

/** The format a composition style says it is in: `"napkinCompositionStyle": 1`. */
export const COMPOSITION_STYLE_FORMAT = 1;

/** The longest name a composition style takes. */
export const COMPOSITION_STYLE_NAME_MAX = 120;

/** A rule's kind: what it styles. */
export type CompositionRuleKind = 'layer' | 'text' | 'stroke';

/** Every kind, in the order a style lists them. */
export const COMPOSITION_RULE_KINDS: readonly CompositionRuleKind[] = ['layer', 'text', 'stroke'];

/** The JSON key that holds each kind's rules. */
export const COMPOSITION_RULE_KEYS: Readonly<Record<CompositionRuleKind, 'layers' | 'text' | 'strokes'>> = {
  layer: 'layers',
  text: 'text',
  stroke: 'strokes',
};

/** Each kind as a sentence names it: `Text rule 'Title'`. */
export const COMPOSITION_RULE_LABELS: Readonly<Record<CompositionRuleKind, string>> = {
  layer: 'Layer',
  text: 'Text',
  stroke: 'Stroke',
};

/** What a layer rule sets: the layer's own properties, and a paint for the marks under it. */
export interface CompositionLayerRule {
  /** The layer's opacity, 0 to 1. */
  opacity?: number;
  /** The layer's blend mode, as its napkin id: `stack`. A style may spell it any way the blend table reads (`multiply`). */
  blend?: BlendModeId;
  /** A group's Isolate Blending. */
  isolate?: boolean;
  /** Whether the layer shows. */
  visible?: boolean;
  /** The layer's effects, in place of its own: `[]` takes them away. */
  effects?: Effect[];
  /** Every closed shape's fill and every text's color under the layer, unless a text or stroke rule names it; `none` takes fills away. */
  fill?: string;
  /** Every path's outline color under the layer, turned on; `none` turns closed shapes' outlines off. */
  stroke?: string;
}

/** What a text rule sets on the text marks under its layer. Sizes and lengths are in the page's pixels. */
export interface CompositionTextRule {
  /** A Text Configuration by name: the book's, a Markdown one, or `Default Configuration` for none. */
  config?: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  leading?: number | 'auto';
  kerning?: CharAttrs['kerning'];
  tracking?: number;
  wordSpacing?: number;
  caps?: CharAttrs['caps'];
  position?: CharAttrs['position'];
  hScale?: number;
  vScale?: number;
  baselineShift?: number;
  rotation?: number;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  /** A highlight behind the characters, or `none`. */
  highlight?: string;
  align?: ParaAttrs['align'];
  leftIndent?: number;
  rightIndent?: number;
  firstIndent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  hyphenate?: boolean;
  /** A bulleted or numbered list, or `none`. */
  list?: NonNullable<ParaAttrs['list']> | 'none';
  /** A shade behind each paragraph, or `none`. */
  shade?: string;
  /** `markdown` turns Markdown Flow on; `plain` turns it off and shows the source as typed. */
  flow?: 'markdown' | 'plain';
  /** A Clean Language Accent: a language's id or alias, `auto`, or `none`. */
  accent?: string;
  effects?: Effect[];
  /** The blend of the layer each text sits on. */
  blend?: BlendModeId;
}

/** What a stroke rule sets on the paths under its layer. */
export interface CompositionStrokeRule {
  /** The outline's color. */
  color?: string;
  /** The outline's width, in pixels. */
  width?: number;
  strokeStyle?: StrokeStyle;
  /** A closed shape's outline off (`true`) or on. */
  noStroke?: boolean;
  /** A brush or marker line's width profile. */
  profile?: StrokeProfile;
  /** A closed shape's flat fill, or `none`. */
  fill?: string;
  /** A closed shape's gradient, or `none`. */
  gradient?: Gradient | 'none';
  /** The mark's opacity, 0 to 1. */
  opacity?: number;
  effects?: Effect[];
  /** The blend of the layer each path sits on. */
  blend?: BlendModeId;
}

/** A composition style, as its JSON reads. */
export interface CompositionStyle {
  napkinCompositionStyle: typeof COMPOSITION_STYLE_FORMAT;
  name: string;
  layers?: Record<string, CompositionLayerRule>;
  text?: Record<string, CompositionTextRule>;
  strokes?: Record<string, CompositionStrokeRule>;
}

// ---- The fields ---------------------------------------------------------------------------------------------------

/** How a field's value is read. */
export type CompositionFieldKind = 'number' | 'leading' | 'color' | 'choice' | 'boolean' | 'text' | 'blend' | 'effects' | 'gradient' | 'list' | 'language' | 'config';

/** One field a rule may set: how the format reads it, and how the editor's form shows it. */
export interface CompositionRuleField {
  readonly key: string;
  readonly label: string;
  readonly kind: CompositionFieldKind;
  /** The part of the editor's form it sits in. */
  readonly group: string;
  /** A number's range: a value past it is held to it, and the report says so. */
  readonly range?: { readonly min: number; readonly max: number };
  /** An angle, turned into -180 to 180 rather than held. */
  readonly turn?: boolean;
  readonly choices?: readonly string[];
  /** A color field that also takes `none`, which takes the paint away. */
  readonly none?: boolean;
  /** What a number is measured in, for the form. */
  readonly unit?: string;
  /** One line: the form's tooltip and the schema's description. */
  readonly summary: string;
}

const L = TYPE_LIMITS;

/** Every field each kind of rule may set, in the order the editor's form shows them. */
export const COMPOSITION_RULE_FIELDS: Readonly<Record<CompositionRuleKind, readonly CompositionRuleField[]>> = {
  layer: [
    { key: 'opacity', label: 'Opacity', kind: 'number', group: 'Layer', range: { min: 0, max: 1 }, summary: "The layer's opacity, 0 to 1." },
    { key: 'blend', label: 'Blend', kind: 'blend', group: 'Layer', summary: "The layer's blend mode, by its napkin name or a CSS one." },
    { key: 'isolate', label: 'Isolate Blending', kind: 'boolean', group: 'Layer', summary: "A group's Isolate Blending." },
    { key: 'visible', label: 'Visible', kind: 'boolean', group: 'Layer', summary: 'Whether the layer shows.' },
    { key: 'effects', label: 'Effects', kind: 'effects', group: 'Layer', summary: "The layer's effects, in place of its own; an empty list takes them away." },
    { key: 'fill', label: 'Fill', kind: 'color', none: true, group: 'Marks', summary: "Every closed shape's fill and every text's color under the layer; none takes the fills away." },
    { key: 'stroke', label: 'Stroke', kind: 'color', none: true, group: 'Marks', summary: "Every path's outline color under the layer, turned on; none turns closed shapes' outlines off." },
  ],
  text: [
    { key: 'config', label: 'Text Configuration', kind: 'config', group: 'Character', summary: "A Text Configuration by name, or Default Configuration for none." },
    { key: 'fontFamily', label: 'Font', kind: 'text', group: 'Character', summary: 'The font family.' },
    { key: 'fontStyle', label: 'Style', kind: 'text', group: 'Character', summary: 'The face: Regular, Bold, Italic and so on.' },
    { key: 'fontSize', label: 'Size', kind: 'number', group: 'Character', range: L.fontSize, unit: 'px', summary: 'The size, in pixels.' },
    { key: 'leading', label: 'Leading', kind: 'leading', group: 'Character', range: L.leading, unit: 'px', summary: 'The line spacing in pixels, or auto.' },
    { key: 'kerning', label: 'Kerning', kind: 'choice', group: 'Character', choices: ['auto', 'none'], summary: "The font's kerning, or none." },
    { key: 'tracking', label: 'Tracking', kind: 'number', group: 'Character', range: L.tracking, unit: '1/1000 em', summary: 'The space between letters, in thousandths of an em.' },
    { key: 'wordSpacing', label: 'Word Spacing', kind: 'number', group: 'Character', range: L.wordSpacing, unit: '%', summary: "The space between words, as a share of the font's." },
    { key: 'caps', label: 'Capitals', kind: 'choice', group: 'Character', choices: ['normal', 'all', 'small'], summary: 'All capitals, small capitals, or as typed.' },
    { key: 'position', label: 'Position', kind: 'choice', group: 'Character', choices: ['normal', 'superscript', 'subscript'], summary: 'Superscript, subscript, or on the line.' },
    { key: 'hScale', label: 'Horizontal Scale', kind: 'number', group: 'Character', range: L.scale, unit: '%', summary: 'The width of the letters, in percent.' },
    { key: 'vScale', label: 'Vertical Scale', kind: 'number', group: 'Character', range: L.scale, unit: '%', summary: 'The height of the letters, in percent.' },
    { key: 'baselineShift', label: 'Baseline Shift', kind: 'number', group: 'Character', range: L.baselineShift, unit: 'px', summary: 'How far the letters sit above their line.' },
    { key: 'rotation', label: 'Rotation', kind: 'number', group: 'Character', turn: true, unit: 'deg', summary: 'Each letter turned, in degrees.' },
    { key: 'underline', label: 'Underline', kind: 'boolean', group: 'Character', summary: 'A line under the letters.' },
    { key: 'strike', label: 'Strikethrough', kind: 'boolean', group: 'Character', summary: 'A line through the letters.' },
    { key: 'color', label: 'Color', kind: 'color', group: 'Character', summary: "The letters' color." },
    { key: 'highlight', label: 'Highlight', kind: 'color', none: true, group: 'Character', summary: 'A highlight behind the letters, or none.' },
    { key: 'align', label: 'Align', kind: 'choice', group: 'Paragraph', choices: ['left', 'center', 'right', 'justify'], summary: "The paragraphs' alignment." },
    { key: 'leftIndent', label: 'Left Indent', kind: 'number', group: 'Paragraph', range: L.indent, unit: 'px', summary: 'The indent on the left, in pixels.' },
    { key: 'rightIndent', label: 'Right Indent', kind: 'number', group: 'Paragraph', range: L.indent, unit: 'px', summary: 'The indent on the right, in pixels.' },
    { key: 'firstIndent', label: 'First Line Indent', kind: 'number', group: 'Paragraph', range: L.indent, unit: 'px', summary: "The first line's indent, in pixels." },
    { key: 'spaceBefore', label: 'Space Before', kind: 'number', group: 'Paragraph', range: L.space, unit: 'px', summary: 'The space before each paragraph, in pixels.' },
    { key: 'spaceAfter', label: 'Space After', kind: 'number', group: 'Paragraph', range: L.space, unit: 'px', summary: 'The space after each paragraph, in pixels.' },
    { key: 'hyphenate', label: 'Hyphenate', kind: 'boolean', group: 'Paragraph', summary: 'Whether long words break with a hyphen.' },
    { key: 'list', label: 'List', kind: 'list', group: 'Paragraph', summary: 'A bulleted or numbered list, or none.' },
    { key: 'shade', label: 'Shade', kind: 'color', none: true, group: 'Paragraph', summary: 'A shade behind each paragraph, or none.' },
    { key: 'flow', label: 'Flow', kind: 'choice', group: 'Flow', choices: ['markdown', 'plain'], summary: 'Markdown Flow on, or the text shown as typed.' },
    { key: 'accent', label: 'Clean Language Accent', kind: 'language', group: 'Flow', summary: "A language's id or alias, auto, or none." },
    { key: 'effects', label: 'Effects', kind: 'effects', group: 'Appearance', summary: "The text's effects, in place of its own; an empty list takes them away." },
    { key: 'blend', label: 'Blend', kind: 'blend', group: 'Appearance', summary: 'The blend mode of the layer each text sits on.' },
  ],
  stroke: [
    { key: 'color', label: 'Stroke', kind: 'color', group: 'Stroke', summary: "The outline's color." },
    { key: 'width', label: 'Width', kind: 'number', group: 'Stroke', range: { min: 0.01, max: 10000 }, unit: 'px', summary: "The outline's width, in pixels." },
    { key: 'strokeStyle', label: 'Stroke Style', kind: 'choice', group: 'Stroke', choices: ['solid', 'dashed', 'dotted'], summary: 'Solid, dashed or dotted.' },
    { key: 'noStroke', label: 'No Stroke', kind: 'boolean', group: 'Stroke', summary: "A closed shape's outline off, or on." },
    { key: 'profile', label: 'Profile', kind: 'choice', group: 'Stroke', choices: ['uniform', 'rounded', 'tapered', 'wave'], summary: "A brush or marker line's width profile." },
    { key: 'fill', label: 'Fill', kind: 'color', none: true, group: 'Fill', summary: "A closed shape's flat fill, or none." },
    { key: 'gradient', label: 'Gradient', kind: 'gradient', group: 'Fill', summary: "A closed shape's gradient: a type and two or more stops, or none." },
    { key: 'opacity', label: 'Opacity', kind: 'number', group: 'Appearance', range: { min: 0, max: 1 }, summary: "The mark's opacity, 0 to 1." },
    { key: 'effects', label: 'Effects', kind: 'effects', group: 'Appearance', summary: "The mark's effects, in place of its own; an empty list takes them away." },
    { key: 'blend', label: 'Blend', kind: 'blend', group: 'Appearance', summary: 'The blend mode of the layer each path sits on.' },
  ],
};

/** A field of a kind by its key. */
function fieldOf(kind: CompositionRuleKind, key: string): CompositionRuleField | undefined {
  return COMPOSITION_RULE_FIELDS[kind].find((field) => field.key === key);
}

// ---- Names --------------------------------------------------------------------------------------------------------

/** A name as rules match it: trimmed, in any case. */
export function layerNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The distance between two words as edits: a letter put in, taken out,
 * changed, or two side by side swapped (Damerau-Levenshtein, as optimal
 * string alignment).
 */
export function nameDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2][j - 2] + 1);
      d[i][j] = best;
    }
  }
  return d[a.length][b.length];
}

/**
 * The names nearest `name`, closest first: those at most two edits away, or a
 * third of the name's length when that is more ({@link nameDistance}), and
 * never one that changes every letter. Of two as near, the one sharing the
 * longer start comes first, a slip being likelier late in a word than at its
 * start. Compared trimmed and in any case; each comes back as it is spelled,
 * once.
 */
export function nameSuggestions(name: string, names: readonly string[], limit = 3): string[] {
  const wanted = layerNameKey(name);
  const allowed = Math.min(Math.max(2, Math.floor(wanted.length / 3)), wanted.length - 1);
  if (allowed < 1) return [];
  const seen = new Set<string>();
  const near: Array<{ name: string; distance: number; start: number; order: number }> = [];
  const startShared = (key: string): number => {
    let n = 0;
    while (n < key.length && n < wanted.length && key[n] === wanted[n]) n++;
    return n;
  };
  names.forEach((each, order) => {
    const key = layerNameKey(each);
    if (key === '' || key === wanted || seen.has(key)) return;
    seen.add(key);
    const distance = nameDistance(wanted, key);
    if (distance <= allowed) near.push({ name: each.trim(), distance, start: startShared(key), order });
  });
  near.sort((p, q) => p.distance - q.distance || q.start - p.start || p.order - q.order);
  return near.slice(0, Math.max(0, limit)).map((each) => each.name);
}

/** The names the app and the importer give a layer that nobody named: none of them is worth a rule. */
const MADE_NAME = /^(?:layer|group|brush|marker|copic|pencil|text|image|clip group|imported|pasted|erased|clipping path|path|rect|circle|ellipse|line|polyline|polygon|g|tspan|use)(?:[\s_-]*\d+)?$/i;

/**
 * Whether a layer's name is one the app gave it rather than a person - `Layer
 * 3`, `Group 1`, `<Group>`, `Brush 12`, a copy of one - or is empty: a
 * capture leaves those out.
 */
export function isDefaultLayerName(name: string): boolean {
  const trimmed = name.trim().replace(/\s+-\s+copy(?:\s+\d+)?$/i, '');
  return trimmed === '' || trimmed === '<Group>' || MADE_NAME.test(trimmed);
}

// ---- Reading a style ----------------------------------------------------------------------------------------------

/** A value a style asked for that is past its range, and the one used. */
export interface CompositionStyleNote {
  rule: CompositionRuleKind;
  name: string;
  field: string;
  value: number;
  used: number;
  message: string;
}

/** What reading a style found: the style, every value held to its range, or the reasons it is not one. */
export interface CompositionStyleValidation {
  ok: boolean;
  /** The style with its names trimmed and its values read - blends as napkin ids, effects as napkin reads them - or null when it is not one. */
  style: CompositionStyle | null;
  /** One sentence each, in the order the style is written. */
  errors: string[];
  /** Values past their range, held to it. */
  notes: CompositionStyleNote[];
}

const TOP_KEYS = ['napkinCompositionStyle', 'name', 'layers', 'text', 'strokes'];

/** A number written short: at most four places. */
function fmt(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

/** A list read as English: `a, b or c`. */
function anyOf(choices: readonly string[]): string {
  return choices.length <= 1 ? choices.join('') : `${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}`;
}

/** ` Did you mean 'x'?`, or nothing. */
function didYouMean(word: string, candidates: readonly string[]): string {
  const near = nameSuggestions(word, candidates, 1);
  return near.length > 0 ? ` Did you mean '${near[0]}'?` : '';
}

function isColor(value: string): boolean {
  if (value.trim() === '' || value.trim().toLowerCase() === 'none') return false;
  try {
    parseColor(value.trim());
    return true;
  } catch {
    return false;
  }
}

/** An angle turned into -180 to 180. */
function turn(degrees: number): number {
  if (degrees > -180 && degrees <= 180) return degrees;
  const t = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return t === -180 ? 180 : t;
}

/** What reading one field's value gave: the value, an error, and a note when it was held to its range. */
type FieldReading = { value: unknown; error?: undefined; note?: { value: number; used: number } } | { value?: undefined; error: string };

function readField(field: CompositionRuleField, raw: unknown): FieldReading {
  const k = field.key;
  switch (field.kind) {
    case 'number':
    case 'leading': {
      if (field.kind === 'leading' && raw === 'auto') return { value: 'auto' };
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: `${k} must be a number${field.kind === 'leading' ? ' or auto' : ''}.` };
      if (field.turn) return { value: turn(raw) };
      if (field.range && (raw < field.range.min || raw > field.range.max)) {
        const used = Math.min(field.range.max, Math.max(field.range.min, raw));
        return { value: used, note: { value: raw, used } };
      }
      return { value: raw };
    }
    case 'color': {
      if (typeof raw !== 'string') return { error: `${k} must be a color${field.none ? ' or none' : ''}.` };
      if (field.none && raw.trim().toLowerCase() === 'none') return { value: 'none' };
      if (!isColor(raw)) return { error: `${k} must be a color${field.none ? ' or none' : ''}, not '${raw}'.` };
      return { value: raw.trim() };
    }
    case 'choice': {
      const choices = field.choices ?? [];
      if (typeof raw !== 'string' || !choices.includes(raw)) {
        const word = typeof raw === 'string' ? raw : '';
        return { error: `${k} must be ${anyOf(choices)}.${word ? didYouMean(word, choices) : ''}` };
      }
      return { value: raw };
    }
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : { error: `${k} must be true or false.` };
    case 'text':
      return typeof raw === 'string' && raw.trim() !== '' ? { value: raw.trim() } : { error: `${k} must be a string that is not empty.` };
    case 'config':
      if (typeof raw !== 'string' || raw.trim() === '') return { error: `${k} must be a configuration's name.` };
      if (raw.trim().length > CONFIG_NAME_MAX) return { error: `${k} is longer than a configuration's name may be (${CONFIG_NAME_MAX} characters).` };
      return { value: raw.trim() };
    case 'blend': {
      const id = blendModeOf(raw);
      if (id) return { value: id };
      const word = typeof raw === 'string' ? raw : '';
      return { error: `${k} '${word}' is not a blend mode.${word ? didYouMean(word, BLEND_MODE_IDS) : ''}` };
    }
    case 'effects': {
      if (!Array.isArray(raw)) return { error: `${k} must be a list of effects.` };
      const effects: Effect[] = [];
      for (let i = 0; i < raw.length; i++) {
        const item = raw[i] as unknown;
        const type = item && typeof item === 'object' ? (item as Record<string, unknown>).type : undefined;
        if (typeof type !== 'string') return { error: `effect ${i + 1} has no type.` };
        if (!(EFFECT_TYPES as readonly string[]).includes(type)) return { error: `effect ${i + 1}'s type '${type}' is not an effect.${didYouMean(type, EFFECT_TYPES)}` };
        const effect = readEffect(item);
        if (!effect) return { error: `effect ${i + 1} (${type}) is missing a field it needs, or has one napkin cannot read.` };
        effects.push(effect);
      }
      return { value: effects };
    }
    case 'gradient': {
      if (raw === 'none') return { value: 'none' };
      const gradient = normalizeGradient(raw);
      return gradient ? { value: gradient } : { error: `${k} must be a gradient (a type and two or more stops) or none.` };
    }
    case 'list': {
      if (raw === 'none') return { value: 'none' };
      const list = readParaAttrs({ list: raw }).list;
      return list ? { value: list } : { error: `${k} must be none or a list with a kind, bullet or number.` };
    }
    case 'language': {
      if (typeof raw !== 'string' || raw.trim() === '') return { error: `${k} must be a language, auto or none.` };
      const word = raw.trim();
      if (word.toLowerCase() === 'auto' || word.toLowerCase() === 'none') return { value: word.toLowerCase() };
      const language = accentLanguage(word);
      if (language) return { value: language.id };
      return { error: `${k} '${word}' is not a language napkin knows.${didYouMean(word, ACCENT_LANGUAGES.map((each) => each.id))}` };
    }
  }
}

/**
 * Reads a composition style from anything, as a file or an API caller hands
 * it over. Every problem is one sentence in `errors`, in the order the style
 * is written; a value past its range is held to it and said in `notes`. The
 * style that comes back has its blends as napkin ids, its effects as napkin
 * reads them and its names trimmed.
 */
export function validateCompositionStyle(raw: unknown): CompositionStyleValidation {
  const errors: string[] = [];
  const notes: CompositionStyleNote[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, style: null, errors: ['A composition style is a JSON object.'], notes };
  }
  const r = raw as Record<string, unknown>;
  if (r.napkinCompositionStyle === undefined) {
    errors.push(`napkinCompositionStyle is missing: a composition style says its format, ${COMPOSITION_STYLE_FORMAT}.`);
  } else if (r.napkinCompositionStyle !== COMPOSITION_STYLE_FORMAT) {
    errors.push(`napkinCompositionStyle ${JSON.stringify(r.napkinCompositionStyle)} is not a format napkin reads: it reads ${COMPOSITION_STYLE_FORMAT}.`);
  }
  let name = '';
  if (typeof r.name !== 'string' || r.name.trim() === '') errors.push("name must be the style's name: a string that is not empty.");
  else if (r.name.trim().length > COMPOSITION_STYLE_NAME_MAX) errors.push(`name is longer than ${COMPOSITION_STYLE_NAME_MAX} characters.`);
  else name = r.name.trim();
  for (const key of Object.keys(r)) {
    if (!TOP_KEYS.includes(key)) errors.push(`There is no field '${key}': a composition style has ${anyOf(TOP_KEYS)}.${didYouMean(key, TOP_KEYS)}`);
  }
  const style: CompositionStyle = { napkinCompositionStyle: COMPOSITION_STYLE_FORMAT, name };
  for (const kind of COMPOSITION_RULE_KINDS) {
    const key = COMPOSITION_RULE_KEYS[kind];
    const group = r[key];
    if (group === undefined) continue;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      errors.push(`${key} must be an object of rules by layer name.`);
      continue;
    }
    const label = COMPOSITION_RULE_LABELS[kind];
    const rules: Record<string, Record<string, unknown>> = {};
    const named = new Map<string, string>();
    for (const [rawName, rawRule] of Object.entries(group as Record<string, unknown>)) {
      const ruleName = rawName.trim();
      if (ruleName === '') {
        errors.push(`A ${label.toLowerCase()} rule has no layer name.`);
        continue;
      }
      const twin = named.get(layerNameKey(ruleName));
      if (twin !== undefined) {
        errors.push(`${label} rules '${twin}' and '${ruleName}' name the same layer.`);
        continue;
      }
      named.set(layerNameKey(ruleName), ruleName);
      const where = `${label} rule '${ruleName}'`;
      if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
        errors.push(`${where} must be an object of styles.`);
        continue;
      }
      const rule: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(rawRule as Record<string, unknown>)) {
        const spec = fieldOf(kind, field);
        if (!spec) {
          const other = COMPOSITION_RULE_KINDS.find((each) => each !== kind && fieldOf(each, field));
          errors.push(
            other
              ? `${where}: ${field} is a ${COMPOSITION_RULE_LABELS[other].toLowerCase()} rule's field, not a ${label.toLowerCase()} rule's.`
              : `${where}: there is no field '${field}'.${didYouMean(field, COMPOSITION_RULE_FIELDS[kind].map((each) => each.key))}`,
          );
          continue;
        }
        const reading = readField(spec, value);
        if (reading.error !== undefined) {
          errors.push(`${where}: ${reading.error}`);
          continue;
        }
        rule[field] = reading.value;
        if (reading.note) {
          const range = spec.range ?? { min: reading.note.used, max: reading.note.used };
          notes.push({
            rule: kind,
            name: ruleName,
            field,
            value: reading.note.value,
            used: reading.note.used,
            message: `${where}: ${field} ${fmt(reading.note.value)} is past its range (${fmt(range.min)} to ${fmt(range.max)}), so ${fmt(reading.note.used)} is used.`,
          });
        }
      }
      rules[ruleName] = rule;
    }
    (style as unknown as Record<string, unknown>)[key] = rules;
  }
  return errors.length > 0 ? { ok: false, style: null, errors, notes } : { ok: true, style, errors, notes };
}

/** A style written as its file holds it: two-space JSON and a newline. */
export function serializeCompositionStyle(style: CompositionStyle): string {
  const out: Record<string, unknown> = { napkinCompositionStyle: COMPOSITION_STYLE_FORMAT, name: style.name };
  for (const kind of COMPOSITION_RULE_KINDS) {
    const key = COMPOSITION_RULE_KEYS[kind];
    const rules = style[key];
    if (rules && Object.keys(rules).length > 0) out[key] = rules;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Device names Windows keeps for itself, which a file may not be called. */
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * The file a style is kept in, in a library that holds `taken`: its name in
 * lowercase, every run of other characters a dash, at most 80 long, and
 * numbered when the library has it already (`midnight-2.json`). Always a
 * plain name starting with a letter or a digit and ending `.json`.
 */
export function compositionStyleFileName(name: string, taken: readonly string[] = []): string {
  let stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  if (stem === '' || DEVICE_NAMES.test(stem)) stem = stem === '' ? 'style' : `${stem}-style`;
  const used = new Set(taken.map((file) => file.toLowerCase()));
  let file = `${stem}.json`;
  for (let n = 2; used.has(file); n++) file = `${stem}-${n}.json`;
  return file;
}

/** A name no style in `names` has, in any case: `name`, else `name 2`, `name 3` and on. */
export function uniqueStyleName(name: string, names: readonly string[]): string {
  const used = new Set(names.map((each) => layerNameKey(each)));
  const base = name.trim() || 'Composition Style';
  if (!used.has(layerNameKey(base))) return base;
  let n = 2;
  while (used.has(layerNameKey(`${base} ${n}`))) n++;
  return `${base} ${n}`;
}

/** How many rules a style has. */
export function compositionStyleRuleCount(style: CompositionStyle): number {
  return COMPOSITION_RULE_KINDS.reduce((n, kind) => n + Object.keys(style[COMPOSITION_RULE_KEYS[kind]] ?? {}).length, 0);
}

// ---- The report ---------------------------------------------------------------------------------------------------

/** What kind of thing a report item says. */
export type CompositionReportKind = 'unmatched' | 'empty' | 'missing-config' | 'clamped' | 'not-a-group';

/** One thing that did not go as the style asked. */
export interface CompositionReportItem {
  kind: CompositionReportKind;
  rule: CompositionRuleKind;
  /** The rule's layer name. */
  name: string;
  /** One sentence. */
  message: string;
  /** A rule that matched no layer: the names nearest its own, closest first. */
  suggestions?: string[];
  /** The field a note is about. */
  field?: string;
}

/** What applying a style did and did not do. */
export interface CompositionStyleReport {
  /** The style's name. */
  style: string;
  /** How many rules the style has. */
  rules: number;
  /** How many of them matched a layer. */
  matched: number;
  /** How many marks and layers it changed. */
  changed: number;
  items: CompositionReportItem[];
}

/** The report's heading: `Midnight: 3 rules did not match`, `Midnight: 1 note`, or `Applied Midnight` when there is nothing to say. */
export function compositionReportTitle(report: CompositionStyleReport): string {
  const unmatched = report.items.filter((item) => item.kind === 'unmatched').length;
  if (unmatched > 0) return `${report.style}: ${unmatched} ${unmatched === 1 ? 'rule' : 'rules'} did not match`;
  const n = report.items.length;
  return n > 0 ? `${report.style}: ${n} ${n === 1 ? 'note' : 'notes'}` : `Applied ${report.style}`;
}

/** A report's items as lines: each one's sentence, and its nearest name when it has one. */
export function compositionReportLines(report: CompositionStyleReport): string[] {
  return report.items.map((item) => (item.suggestions && item.suggestions.length > 0 ? `${item.message} Did you mean '${item.suggestions[0]}'?` : item.message));
}

function unmatchedItem(kind: CompositionRuleKind, name: string, names: readonly string[]): CompositionReportItem {
  return { kind: 'unmatched', rule: kind, name, message: `${COMPOSITION_RULE_LABELS[kind]} rule '${name}' matched no layer.`, suggestions: nameSuggestions(name, names) };
}

// ---- Equal values -------------------------------------------------------------------------------------------------

/** Two values alike: objects by their content, a missing field the same as one set to undefined. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((each, i) => same(each, b[i]));
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const key of keys) if (!same(x[key], y[key])) return false;
  return true;
}

/** An effect list as napkin reads it: empty for none. */
function effectList(effects: readonly Effect[] | undefined): Effect[] {
  return readEffects(effects ? [...effects] : undefined) ?? [];
}

function copyEffects(effects: readonly Effect[]): Effect[] | undefined {
  return effects.length > 0 ? effects.map((effect) => JSON.parse(JSON.stringify(effect)) as Effect) : undefined;
}

/** A copy of a mark with a patch on it: a key set to undefined taken away. */
function patched<T extends object>(item: T, patch: Record<string, unknown>): T {
  const next = { ...item } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

// ---- The rules a mark meets ---------------------------------------------------------------------------------------

type Rule = Readonly<Record<string, unknown>>;

/** A style's rules by the key of the name they match. */
interface RuleTable {
  readonly byKind: Readonly<Record<CompositionRuleKind, ReadonlyMap<string, { name: string; rule: Rule }>>>;
}

function ruleTable(style: CompositionStyle): RuleTable {
  const byKind = {} as Record<CompositionRuleKind, Map<string, { name: string; rule: Rule }>>;
  for (const kind of COMPOSITION_RULE_KINDS) {
    const map = new Map<string, { name: string; rule: Rule }>();
    for (const [name, rule] of Object.entries(style[COMPOSITION_RULE_KEYS[kind]] ?? {})) map.set(layerNameKey(name), { name, rule: rule as Rule });
    byKind[kind] = map;
  }
  return { byKind };
}

/**
 * What the rules on a mark's chain of layers, outermost first, ask of a mark
 * of one kind: each layer's rules in turn, the nearer one winning field by
 * field. A layer rule's fill and stroke reach the mark unless a rule of the
 * mark's own kind names the same layer.
 */
function wantedFor(table: RuleTable, chain: readonly string[], kind: 'text' | 'stroke'): { want: Record<string, unknown>; hit: boolean } {
  const want: Record<string, unknown> = {};
  let hit = false;
  for (const key of chain) {
    const own = table.byKind[kind].get(key);
    const layer = table.byKind.layer.get(key);
    if (layer && !own) {
      const fill = layer.rule.fill as string | undefined;
      const stroke = layer.rule.stroke as string | undefined;
      if (kind === 'text') {
        if (fill !== undefined && fill !== 'none') {
          want.color = fill;
          hit = true;
        }
      } else {
        if (fill !== undefined) {
          want.paintFill = fill;
          delete want.fill;
          delete want.gradient;
          hit = true;
        }
        if (stroke !== undefined) {
          want.paintStroke = stroke;
          delete want.color;
          delete want.noStroke;
          hit = true;
        }
      }
    }
    if (own) {
      for (const [field, value] of Object.entries(own.rule)) {
        want[field] = value;
        if (kind === 'stroke' && (field === 'fill' || field === 'gradient')) delete want.paintFill;
        if (kind === 'stroke' && (field === 'color' || field === 'noStroke')) delete want.paintStroke;
      }
      hit = true;
    }
  }
  return { want, hit };
}

// ---- Styling a sketch's marks -------------------------------------------------------------------------------------

/** The character attributes a text rule may set, as the model names them. */
const CHAR_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'leading',
  'kerning',
  'tracking',
  'wordSpacing',
  'caps',
  'position',
  'hScale',
  'vScale',
  'baselineShift',
  'rotation',
  'underline',
  'strike',
  'color',
  'highlight',
] as const;

/** The paragraph attributes a text rule may set. */
const PARA_FIELDS = ['align', 'leftIndent', 'rightIndent', 'firstIndent', 'spaceBefore', 'spaceAfter', 'hyphenate', 'list', 'shade'] as const;

/** A paragraph or character value as the model holds it: `none` is no value. */
function modelValue(value: unknown): unknown {
  return value === 'none' ? undefined : value;
}

/** A configuration a text rule names: the book's, a Markdown one, none for the Default Configuration, or not there. */
function configNamed(name: string, configs: readonly TextConfig[]): { found: boolean; config: TextConfig | null } {
  if (sameConfigName(name, DEFAULT_CONFIG_NAME)) return { found: true, config: null };
  const book = configs.find((config) => sameConfigName(config.name, name));
  if (book) return { found: true, config: book };
  const key = (Object.keys(MARKDOWN_CONFIG_NAMES) as MarkdownConfigKey[]).find((each) => sameConfigName(MARKDOWN_CONFIG_NAMES[each], name));
  if (key) return { found: true, config: markdownConfig(key, configs) };
  return { found: false, config: null };
}

/** A text mark restyled as a rule asks: only what differs is touched, so a text already so is the same object. */
function styleText(stroke: Stroke, want: Record<string, unknown>, configs: readonly TextConfig[], config: { found: boolean; config: TextConfig | null } | null): Stroke {
  let next = stroke;
  // Flow first: the runs and paragraphs below are the source's either way.
  if (want.flow !== undefined) {
    const on = next.typeset?.flow === 'markdown';
    if (want.flow === 'markdown' && !on) {
      next = withMarkdownConfigs(withTypeset(next, { ...typeSpecOf(next), flow: 'markdown' }), configs);
    } else if (want.flow === 'plain' && on) {
      const { flow: _flow, ...spec } = typeSpecOf(next);
      next = withTypeset(next, spec);
    }
  }
  const text = next.text ?? '';
  const whole = { start: 0, end: text.length };
  const known = [...configs, ...configsOf(next).values()];
  if (config?.found && text.length > 0) {
    const reading = readConfigTargets([{ stroke: next, start: 0, end: text.length }], known);
    const id = config.config ? config.config.id : null;
    if (!reading || reading.config !== id) next = applyTextConfig(next, whole, config.config, false);
  }
  if (text.length > 0) {
    const change: Partial<Record<(typeof CHAR_FIELDS)[number], unknown>> = {};
    const segments = styleSegments(next);
    for (const field of CHAR_FIELDS) {
      if (want[field] === undefined) continue;
      const value = modelValue(want[field]);
      if (segments.some((segment) => !same(segment.attrs[field], value))) change[field] = value;
    }
    if (Object.keys(change).length > 0) {
      next = restyleText(next, whole, (attrs) => patched(attrs, change as Record<string, unknown>), [...configs, ...configsOf(next).values()]);
    }
  }
  const ranges = paragraphRanges(text);
  const paraChange: Partial<ParaAttrs> = {};
  for (const field of PARA_FIELDS) {
    if (want[field] === undefined) continue;
    const value = modelValue(want[field]);
    if (ranges.some((_, p) => !same(paraAttrsOf(next, p)[field], value))) (paraChange as Record<string, unknown>)[field] = value;
  }
  if (Object.keys(paraChange).length > 0) next = applyPara(next, whole, paraChange);
  if (want.accent !== undefined) {
    const value = want.accent === 'none' ? undefined : (want.accent as string);
    const paras = next.typeset?.paras ?? [];
    if (ranges.some((_, p) => (paras[p]?.accent ?? undefined) !== value)) next = applyAccent(next, whole, value ?? null);
  }
  if (want.effects !== undefined) {
    const effects = want.effects as Effect[];
    if (!same(effectList(next.effects), effects)) next = patched(next, { effects: copyEffects(effects) });
  }
  return next;
}

/** A path restyled as a rule asks, likewise; the closed-shape rules a person's own pick follows (core/paint.ts). */
function stylePath(stroke: Stroke, want: Record<string, unknown>): Stroke {
  const patch: Record<string, unknown> = {};
  const closed = isClosedStroke(stroke);
  // A layer rule's paints, as a picked color: a fill fills a closed shape in
  // place of a gradient, an outline color turns the outline on.
  if (want.paintStroke !== undefined) {
    if (want.paintStroke === 'none') {
      if (closed && stroke.noStroke !== true) patch.noStroke = true;
    } else {
      const paint = paintPatch(stroke, 'stroke', want.paintStroke as string) ?? {};
      if (paint.color !== undefined && paint.color !== stroke.color) patch.color = paint.color;
      if (stroke.noStroke) patch.noStroke = undefined;
    }
  }
  if (want.paintFill !== undefined && closed) {
    if (want.paintFill === 'none') {
      if (stroke.fill !== undefined) patch.fill = undefined;
      if (stroke.gradient !== undefined) patch.gradient = undefined;
    } else {
      if (stroke.fill !== want.paintFill) patch.fill = want.paintFill;
      if (stroke.gradient !== undefined) patch.gradient = undefined;
    }
  }
  if (want.color !== undefined && stroke.color !== want.color) patch.color = want.color;
  if (want.width !== undefined && stroke.width !== want.width) patch.width = want.width;
  if (want.strokeStyle !== undefined) {
    const value = want.strokeStyle === 'solid' ? undefined : want.strokeStyle;
    const current = stroke.strokeStyle === 'solid' ? undefined : stroke.strokeStyle;
    if (current !== value) patch.strokeStyle = value;
  }
  if (want.noStroke !== undefined && closed) {
    const value = want.noStroke === true ? true : undefined;
    if ((stroke.noStroke === true ? true : undefined) !== value) patch.noStroke = value;
  }
  if (want.profile !== undefined && profileApplies(stroke)) {
    const value = want.profile === 'uniform' ? undefined : want.profile;
    if (stroke.profile !== value) patch.profile = value;
  }
  if (closed && (want.fill !== undefined || want.gradient !== undefined)) {
    if (want.fill !== undefined) {
      const value = modelValue(want.fill);
      if (stroke.fill !== value) patch.fill = value;
      // A flat fill, or none, in place of a gradient - unless the rule gives one too.
      if (want.gradient === undefined && stroke.gradient !== undefined) patch.gradient = undefined;
    }
    if (want.gradient !== undefined) {
      const value = modelValue(want.gradient);
      if (!same(stroke.gradient, value)) patch.gradient = value;
    }
  }
  if (want.opacity !== undefined) {
    const fallback = defaultOpacityFor(stroke.tool);
    if ((stroke.opacity ?? fallback) !== want.opacity) patch.opacity = want.opacity === fallback ? undefined : want.opacity;
  }
  if (want.effects !== undefined) {
    const effects = want.effects as Effect[];
    if (!same(effectList(stroke.effects), effects)) patch.effects = copyEffects(effects);
  }
  return Object.keys(patch).length > 0 ? patched(stroke, patch) : stroke;
}

/** The kind of mark a rule styles: text, a path, or neither (a picture, an eraser). */
function markKind(stroke: Stroke): 'text' | 'stroke' | null {
  if (isTextStroke(stroke)) return 'text';
  if (stroke.tool === 'eraser' || isImageStroke(stroke) || stroke.link !== undefined || stroke.tool === 'image') return null;
  return 'stroke';
}

// ---- Applying a style ---------------------------------------------------------------------------------------------

/** What restyling takes beyond the style: the book's Text Configurations, for a rule that names one. */
export interface CompositionStyleOptions {
  configs?: readonly TextConfig[];
}

/** A layer the style changed, and how: a field set to undefined is taken away. */
export interface CompositionLayerChange {
  id: string;
  patch: Partial<Omit<Layer, 'id'>>;
}

/** A page restyled: the new page, what changed on it, and what did not go as asked. */
export interface SketchStyleResult {
  sketch: Sketch;
  /** The marks the style changed, as they are now, in the page's order. */
  strokes: Stroke[];
  /** The layers it changed. */
  layers: CompositionLayerChange[];
  /** Configurations the restyled texts now follow that `configs` did not hold: a Markdown one a rule named. */
  configs: TextConfig[];
  report: CompositionStyleReport;
}

/** A composition restyled: a new one, the source untouched, and the report. */
export interface CompositionDocumentStyleResult<T extends Composition | CompositionDocument> {
  composition: T;
  report: CompositionStyleReport;
}

/** A style as given, read: its rules, or a throw naming every problem. */
function readStyle(style: CompositionStyle | unknown): { style: CompositionStyle; notes: CompositionStyleNote[] } {
  const read = validateCompositionStyle(style);
  if (!read.ok || !read.style) throw new Error(`Not a composition style: ${read.errors.join(' ')}`);
  return { style: read.style, notes: read.notes };
}

function noteItems(notes: readonly CompositionStyleNote[]): CompositionReportItem[] {
  return notes.map((note) => ({ kind: 'clamped', rule: note.rule, name: note.name, field: note.field, message: note.message }));
}

/** Every layer's chain, outermost first, as rule keys: the layer's own last. */
function layerChains(layers: readonly Layer[]): Map<string, string[]> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const chains = new Map<string, string[]>();
  for (const layer of layers) {
    const chain: string[] = [];
    const seen = new Set<string>();
    for (let at: Layer | undefined = layer; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
      seen.add(at.id);
      chain.unshift(layerNameKey(at.name));
    }
    chains.set(layer.id, chain);
  }
  return chains;
}

/** The layer a mark sits on: its own, or the first one that holds marks. */
function markLayer(sketch: Sketch, stroke: Stroke): Layer | undefined {
  return sketch.layers.find((layer) => layer.id === stroke.layer && !layer.group) ?? sketch.layers.find((layer) => !layer.group);
}

/** Every layer's id under each layer, its own among them. */
function subtreeIds(layers: readonly Layer[]): Map<string, Set<string>> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const under = new Map<string, Set<string>>(layers.map((layer) => [layer.id, new Set([layer.id])]));
  for (const layer of layers) {
    const seen = new Set<string>();
    for (let at = layer.parent ? byId.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
      seen.add(at.id);
      under.get(at.id)?.add(layer.id);
    }
  }
  return under;
}

/** A page restyled. The page given is not changed. */
function styleSketch(sketch: Sketch, given: CompositionStyle | unknown, options: CompositionStyleOptions): SketchStyleResult {
  const { style, notes } = readStyle(given);
  const configs = options.configs ?? [];
  const table = ruleTable(style);
  const items: CompositionReportItem[] = [];
  const names = [...sketch.layers].reverse().map((layer) => layer.name);
  const layersByKey = new Map<string, Layer[]>();
  for (const layer of sketch.layers) {
    const key = layerNameKey(layer.name);
    layersByKey.set(key, [...(layersByKey.get(key) ?? []), layer]);
  }
  const chains = layerChains(sketch.layers);
  const under = subtreeIds(sketch.layers);

  // Which rules matched, and which of them found nothing of their kind.
  let matched = 0;
  for (const kind of COMPOSITION_RULE_KINDS) {
    for (const [key, { name, rule }] of table.byKind[kind]) {
      const layers = layersByKey.get(key) ?? [];
      if (layers.length === 0) {
        items.push(unmatchedItem(kind, name, names));
        continue;
      }
      matched++;
      const ids = new Set(layers.flatMap((layer) => [...(under.get(layer.id) ?? [])]));
      const marks = sketch.strokes.filter((stroke) => {
        const own = markLayer(sketch, stroke);
        return own !== undefined && ids.has(own.id);
      });
      if (kind === 'text' && !marks.some((stroke) => markKind(stroke) === 'text')) {
        items.push({ kind: 'empty', rule: kind, name, message: `Text rule '${name}' matched a layer with no text.` });
      }
      if (kind === 'stroke' && !marks.some((stroke) => markKind(stroke) === 'stroke')) {
        items.push({ kind: 'empty', rule: kind, name, message: `Stroke rule '${name}' matched a layer with no paths.` });
      }
      if (kind === 'layer' && rule.isolate !== undefined && !layers.some((layer) => layer.group)) {
        items.push({ kind: 'not-a-group', rule: kind, name, field: 'isolate', message: `Layer rule '${name}' sets isolate, which only a group takes.` });
      }
      if (kind === 'text' && typeof rule.config === 'string' && !configNamed(rule.config, configs).found) {
        items.push({
          kind: 'missing-config',
          rule: kind,
          name,
          field: 'config',
          message: `Text rule '${name}' names the configuration '${rule.config}', which this book does not have.`,
        });
      }
    }
  }

  // The marks.
  const added = new Map<string, TextConfig>();
  const leafBlends = new Map<string, BlendModeId>();
  const changed: Stroke[] = [];
  const strokes = sketch.strokes.map((stroke) => {
    const kind = markKind(stroke);
    const layer = markLayer(sketch, stroke);
    if (!kind || !layer) return stroke;
    const { want, hit } = wantedFor(table, chains.get(layer.id) ?? [], kind);
    if (!hit) return stroke;
    let next: Stroke;
    if (kind === 'text') {
      const config = typeof want.config === 'string' ? configNamed(want.config, configs) : null;
      if (config?.found && config.config && !configs.some((each) => each.id === config.config?.id)) added.set(config.config.id, config.config);
      next = styleText(stroke, want, configs, config);
    } else {
      next = stylePath(stroke, want);
    }
    if (want.blend !== undefined) leafBlends.set(layer.id, want.blend as BlendModeId);
    if (next !== stroke) changed.push(next);
    return next;
  });

  // The layers: their own rules, then the blends their marks' rules give them.
  const layerChanges: CompositionLayerChange[] = [];
  const layers = sketch.layers.map((layer) => {
    const own = table.byKind.layer.get(layerNameKey(layer.name))?.rule;
    const patch: Record<string, unknown> = {};
    if (own) {
      if (own.opacity !== undefined && layer.opacity !== own.opacity) patch.opacity = own.opacity;
      if (own.visible !== undefined && layer.visible !== own.visible) patch.visible = own.visible;
      if (own.isolate !== undefined && layer.group && (layer.isolate === true) !== own.isolate) patch.isolate = own.isolate ? true : undefined;
      if (own.effects !== undefined && !same(effectList(layer.effects), own.effects)) patch.effects = copyEffects(own.effects as Effect[]);
    }
    const blend = leafBlends.get(layer.id) ?? (own?.blend as BlendModeId | undefined);
    if (blend !== undefined) {
      const value = isBlended(blend) ? blend : undefined;
      if (layer.blend !== value) patch.blend = value;
    }
    if (Object.keys(patch).length === 0) return layer;
    layerChanges.push({ id: layer.id, patch: patch as Partial<Omit<Layer, 'id'>> });
    return patched(layer, patch);
  });

  const report: CompositionStyleReport = {
    style: style.name,
    rules: compositionStyleRuleCount(style),
    matched,
    changed: changed.length + layerChanges.length,
    items: [...items, ...noteItems(notes)],
  };
  const restyled = changed.length > 0 || layerChanges.length > 0 ? { ...sketch, strokes, layers } : sketch;
  return { sketch: restyled, strokes: changed, layers: layerChanges, configs: [...added.values()], report };
}

/**
 * Every page of a book restyled, with one report for the book: a rule that
 * matched no layer on any page, with the nearest names any page has; one that
 * found nothing of its kind wherever it matched; and each other note once.
 * The book's Text Configurations are the ones a rule names, and the ones the
 * restyled texts follow that it had not join it. Nothing given is changed.
 */
export function applyCompositionStyleToBook(book: SketchBook, style: CompositionStyle | unknown, options: CompositionStyleOptions = {}): { book: SketchBook; report: CompositionStyleReport } {
  const read = readStyle(style);
  const configs = [...(options.configs ?? book.textConfigs ?? [])];
  const results = book.sketches.map((sketch) => styleSketch(sketch, read.style, { configs }));
  const pages = results.length;
  const items: CompositionReportItem[] = [];
  const said = new Set<string>();
  const ruleKey = (item: CompositionReportItem): string => `${item.rule}\u0000${layerNameKey(item.name)}`;
  const count = (kind: CompositionReportKind, key: string): number => results.filter((result) => result.report.items.some((item) => item.kind === kind && ruleKey(item) === key)).length;
  for (const result of results) {
    for (const item of result.report.items) {
      const key = ruleKey(item);
      if (item.kind === 'unmatched') {
        if (count('unmatched', key) < pages || said.has(`u${key}`)) continue;
        said.add(`u${key}`);
        const near = results.flatMap((each) => each.report.items.filter((other) => other.kind === 'unmatched' && ruleKey(other) === key).flatMap((other) => other.suggestions ?? []));
        items.push({ ...item, suggestions: [...new Set(near)].slice(0, 3) });
      } else if (item.kind === 'empty') {
        if (count('empty', key) + count('unmatched', key) < pages || said.has(`e${key}`)) continue;
        said.add(`e${key}`);
        items.push(item);
      } else if (!said.has(item.message)) {
        said.add(item.message);
        items.push(item);
      }
    }
  }
  const matched = COMPOSITION_RULE_KINDS.reduce(
    (n, kind) => n + Object.keys(read.style[COMPOSITION_RULE_KEYS[kind]] ?? {}).filter((name) => count('unmatched', `${kind}\u0000${layerNameKey(name)}`) < pages).length,
    0,
  );
  const added = new Map<string, TextConfig>();
  for (const result of results) for (const config of result.configs) added.set(config.id, config);
  const changed = results.some((result) => result.sketch !== book.sketches[results.indexOf(result)]) || added.size > 0;
  const next: SketchBook = changed
    ? { ...book, sketches: results.map((result) => result.sketch), ...(added.size > 0 ? { textConfigs: [...configs, ...added.values()] } : {}) }
    : book;
  return {
    book: next,
    report: { style: read.style.name, rules: compositionStyleRuleCount(read.style), matched, changed: results.reduce((n, result) => n + result.report.changed, 0), items },
  };
}

// ---- Styling a composition ----------------------------------------------------------------------------------------

/** A face's weight and slant as a composition's text reads them, from a napkin face name. */
function faceOf(fontStyle: string): { fontWeight: 'normal' | 'bold'; fontStyle: 'normal' | 'italic' } {
  return {
    fontWeight: /bold|black|heavy|semi ?bold|demi ?bold|extra ?bold/i.test(fontStyle) ? 'bold' : 'normal',
    fontStyle: /italic|oblique/i.test(fontStyle) ? 'italic' : 'normal',
  };
}

/** A composition's gradient paint from a napkin gradient. */
function gradientPaint(gradient: Gradient): GradientPaint | null {
  const stops = normalizedStops(gradient);
  if (!stops) return null;
  return gradient.type === 'linear' ? { type: 'linear', angle: gradient.angle ?? 0, stops } : { type: 'radial', stops };
}

/** A length worked out from another, without a float's last-place noise. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** A text element restyled as a text rule asks: the attributes a composition's text has. */
function styleTextElement(el: TextElement, want: Record<string, unknown>): TextElement {
  const patch: Record<string, unknown> = {};
  const size = typeof want.fontSize === 'number' ? want.fontSize : el.fontSize ?? 16;
  if (typeof want.fontFamily === 'string') patch.fontFamily = want.fontFamily;
  if (typeof want.fontSize === 'number') patch.fontSize = want.fontSize;
  if (typeof want.fontStyle === 'string') Object.assign(patch, faceOf(want.fontStyle));
  if (want.leading !== undefined) patch.lineHeight = want.leading === 'auto' ? 1.2 : round4((want.leading as number) / size);
  if (typeof want.tracking === 'number') patch.letterSpacing = round4((want.tracking / 1000) * size);
  if (want.underline !== undefined || want.strike !== undefined) {
    const underline = want.underline ?? el.decoration === 'underline';
    const strike = want.strike ?? el.decoration === 'line-through';
    patch.decoration = underline ? 'underline' : strike ? 'line-through' : 'none';
  }
  if (want.caps === 'all') patch.transform = 'uppercase';
  else if (want.caps === 'normal') patch.transform = 'none';
  if (typeof want.align === 'string') patch.align = want.align;
  if (typeof want.firstIndent === 'number') patch.indent = want.firstIndent;
  if (want.spaceBefore !== undefined || want.spaceAfter !== undefined) patch.paragraphSpacing = ((want.spaceBefore as number) ?? 0) + ((want.spaceAfter as number) ?? 0);
  if (typeof want.color === 'string') patch.fill = want.color;
  if (want.effects !== undefined) patch.effects = copyEffects(want.effects as Effect[]);
  if (want.blend !== undefined) patch.blend = isBlended(want.blend as BlendModeId) ? want.blend : undefined;
  const changes = Object.entries(patch).filter(([key, value]) => !same((el as unknown as Record<string, unknown>)[key], value));
  return changes.length > 0 ? patched(el, Object.fromEntries(changes)) : el;
}

/** A shape restyled as a stroke rule, or a layer rule's paints, asks. */
function styleShapeElement(el: Element, want: Record<string, unknown>): Element {
  const patch: Record<string, unknown> = {};
  const record = el as unknown as Record<string, unknown>;
  if (want.paintStroke !== undefined) patch.stroke = want.paintStroke === 'none' ? null : want.paintStroke;
  if (want.paintFill !== undefined) patch.fill = want.paintFill === 'none' ? null : want.paintFill;
  if (typeof want.color === 'string') patch.stroke = want.color;
  if (want.noStroke === true) patch.stroke = null;
  if (typeof want.width === 'number') patch.strokeWidth = want.width;
  if (want.strokeStyle !== undefined) {
    const width = typeof want.width === 'number' ? want.width : typeof record.strokeWidth === 'number' ? record.strokeWidth : 1;
    const dash = dashPatternFor(want.strokeStyle as StrokeStyle, width);
    patch.dash = dash.length > 0 ? dash : undefined;
  }
  if (want.fill !== undefined) patch.fill = want.fill === 'none' ? null : want.fill;
  if (want.gradient !== undefined) {
    if (want.gradient === 'none') {
      if (record.fill && typeof record.fill === 'object') patch.fill = want.fill === undefined ? null : patch.fill;
    } else {
      patch.fill = gradientPaint(want.gradient as Gradient) ?? record.fill;
    }
  }
  if (typeof want.opacity === 'number') patch.opacity = want.opacity;
  if (want.effects !== undefined) patch.effects = copyEffects(want.effects as Effect[]);
  if (want.blend !== undefined) patch.blend = isBlended(want.blend as BlendModeId) ? want.blend : undefined;
  const changes = Object.entries(patch).filter(([key, value]) => !same(record[key], value));
  return changes.length > 0 ? patched(el, Object.fromEntries(changes)) : el;
}

/** Every name in a composition's elements, as they are written, outermost first. */
function elementNames(elements: readonly Element[], out: string[] = []): string[] {
  for (const el of elements) {
    if (typeof el.name === 'string' && el.name.trim() !== '') out.push(el.name);
    if (el.type === 'group') elementNames(el.children, out);
  }
  return out;
}

/** A composition's elements restyled, with the report. Elements nothing changed are the same objects. */
function styleElements(elements: readonly Element[], given: CompositionStyle | unknown): { elements: Element[]; report: CompositionStyleReport } {
  const { style, notes } = readStyle(given);
  const table = ruleTable(style);
  const items: CompositionReportItem[] = [];
  const names = elementNames(elements);
  const found = new Map<string, { any: boolean; text: boolean; shape: boolean; group: boolean }>();
  let changed = 0;

  const visit = (list: readonly Element[], chain: readonly string[], within: readonly string[]): Element[] => {
    let touched = false;
    const out = list.map((el) => {
      const key = typeof el.name === 'string' ? layerNameKey(el.name) : '';
      const here = key ? [...chain, key] : chain;
      const inside = key ? [...within, key] : within;
      for (const each of inside) {
        const seen = found.get(each) ?? { any: false, text: false, shape: false, group: false };
        if (each === key) {
          seen.any = true;
          if (el.type === 'group') seen.group = true;
        }
        if (el.type === 'text') seen.text = true;
        else if (el.type !== 'group' && el.type !== 'image') seen.shape = true;
        found.set(each, seen);
      }
      let next: Element = el;
      if (el.type === 'group') {
        const children = visit(el.children, here, inside);
        if (children !== el.children) next = { ...el, children } as GroupElement;
      } else if (el.type === 'text') {
        const { want, hit } = wantedFor(table, here, 'text');
        if (hit) next = styleTextElement(el, want);
      } else if (el.type !== 'image') {
        const { want, hit } = wantedFor(table, here, 'stroke');
        if (hit) next = styleShapeElement(el, want);
      }
      const own = key ? table.byKind.layer.get(key)?.rule : undefined;
      if (own) {
        const patch: Record<string, unknown> = {};
        const record = next as unknown as Record<string, unknown>;
        if (own.opacity !== undefined) patch.opacity = own.opacity;
        if (own.visible !== undefined) patch.visible = own.visible;
        if (own.blend !== undefined) patch.blend = isBlended(own.blend as BlendModeId) ? own.blend : undefined;
        if (own.isolate !== undefined && next.type === 'group') patch.isolate = own.isolate ? true : undefined;
        if (own.effects !== undefined) patch.effects = copyEffects(own.effects as Effect[]);
        const changes = Object.entries(patch).filter(([field, value]) => !same(record[field], value));
        if (changes.length > 0) next = patched(next, Object.fromEntries(changes));
      }
      if (next !== el) {
        touched = true;
        if (next.type !== 'group' || Object.keys(next).some((field) => field !== 'children' && !same((next as unknown as Record<string, unknown>)[field], (el as unknown as Record<string, unknown>)[field]))) changed++;
      }
      return next;
    });
    return touched ? out : (list as Element[]);
  };
  const restyled = visit(elements, [], []);

  let matched = 0;
  for (const kind of COMPOSITION_RULE_KINDS) {
    for (const [key, { name, rule }] of table.byKind[kind]) {
      const seen = found.get(key);
      if (!seen?.any) {
        items.push(unmatchedItem(kind, name, names));
        continue;
      }
      matched++;
      if (kind === 'text' && !seen.text) items.push({ kind: 'empty', rule: kind, name, message: `Text rule '${name}' matched a layer with no text.` });
      if (kind === 'stroke' && !seen.shape) items.push({ kind: 'empty', rule: kind, name, message: `Stroke rule '${name}' matched a layer with no paths.` });
      if (kind === 'layer' && rule.isolate !== undefined && !seen.group) {
        items.push({ kind: 'not-a-group', rule: kind, name, field: 'isolate', message: `Layer rule '${name}' sets isolate, which only a group takes.` });
      }
    }
  }
  return {
    elements: restyled,
    report: { style: style.name, rules: compositionStyleRuleCount(style), matched, changed, items: [...items, ...noteItems(notes)] },
  };
}

/** A graphic-design composition: told by its shape, so this module brings no renderer of its own into a bundle. */
function isComposition(value: unknown): value is Composition {
  return !!value && typeof value === 'object' && typeof (value as Composition).toDocument === 'function' && Array.isArray((value as Composition).elements);
}

function isCompositionDocument(value: unknown): value is CompositionDocument {
  return !!value && typeof value === 'object' && Array.isArray((value as CompositionDocument).elements) && !Array.isArray((value as Sketch).layers);
}

/**
 * Restyles a page by its layers' names - or a graphic-design composition by
 * its elements' and groups' names - as a composition style's rules ask, and
 * says what did not go as asked. Nothing given is changed: a page comes back
 * new with the marks and layers that changed, a composition as a new one of
 * the same kind.
 *
 * A composition's text takes the character and paragraph attributes it has -
 * font, size, face, leading, tracking, underline or strikethrough, capitals,
 * alignment, first-line indent, paragraph spacing - with its color, effects
 * and blend; its shapes take the stroke rules' outline, dashes, fill or
 * gradient, opacity, effects and blend. The rest are a page's.
 *
 * Throws when the style is not one ({@link validateCompositionStyle} says why).
 */
export function applyCompositionStyle(sketch: Sketch, style: CompositionStyle | unknown, options?: CompositionStyleOptions): SketchStyleResult;
export function applyCompositionStyle(composition: Composition, style: CompositionStyle | unknown): CompositionDocumentStyleResult<Composition>;
export function applyCompositionStyle(composition: CompositionDocument, style: CompositionStyle | unknown): CompositionDocumentStyleResult<CompositionDocument>;
export function applyCompositionStyle(
  target: Sketch | Composition | CompositionDocument,
  style: CompositionStyle | unknown,
  options: CompositionStyleOptions = {},
): SketchStyleResult | CompositionDocumentStyleResult<Composition> | CompositionDocumentStyleResult<CompositionDocument> {
  if (isComposition(target)) {
    const { elements, report } = styleElements(target.elements, style);
    // The same class the composition was made with, so the copy renders as it does.
    const Made = target.constructor as new (options: PageOptions) => Composition;
    const next = new Made({
      width: target.width,
      height: target.height,
      units: target.units,
      background: target.background,
      id: target.id,
      title: target.title,
      useGuiCanvas: target.useGuiCanvas,
    });
    next.addAll(elements);
    next.clips.push(...target.clips);
    return { composition: next, report };
  }
  if (isCompositionDocument(target)) {
    const { elements, report } = styleElements(target.elements, style);
    return { composition: elements === target.elements ? target : { ...target, elements }, report };
  }
  return styleSketch(target, style, options);
}

// ---- Capturing a style --------------------------------------------------------------------------------------------

/** The one value every item gives, or undefined when they differ or there are none. */
function shared<T>(items: readonly T[], read: (item: T) => unknown): unknown {
  if (items.length === 0) return undefined;
  const first = read(items[0]);
  return items.every((item) => same(read(item), first)) ? first : undefined;
}

/** A configuration's name by its id: the text's own copy, else the book's. */
function configName(stroke: Stroke, id: string | null, configs: readonly TextConfig[]): string | undefined {
  if (id === null) return DEFAULT_CONFIG_NAME;
  return configsOf(stroke).get(id)?.name ?? configs.find((config) => config.id === id)?.name;
}

/** What every text under a layer shares, as a text rule. */
function captureText(texts: readonly Stroke[], configs: readonly TextConfig[]): CompositionTextRule {
  const rule: Record<string, unknown> = {};
  const filled = texts.filter((stroke) => (stroke.text ?? '').length > 0);
  if (filled.length === 0) return rule;
  const reading = readConfigTargets(
    filled.map((stroke) => ({ stroke, start: 0, end: (stroke.text ?? '').length })),
    configs,
  );
  if (reading && reading.config !== 'mixed') {
    const name = configName(filled[0], reading.config, configs);
    if (name !== undefined) rule.config = name;
  }
  const segments = filled.flatMap((stroke) => styleSegments(stroke));
  for (const field of CHAR_FIELDS) {
    const value = shared(segments, (segment) => segment.attrs[field]);
    if (value !== undefined) rule[field] = value;
    else if ((field === 'highlight') && segments.every((segment) => segment.attrs.highlight === undefined)) rule[field] = 'none';
  }
  const paragraphs = filled.flatMap((stroke) => paragraphRanges(stroke.text ?? '').map((_, p) => ({ stroke, p })));
  for (const field of PARA_FIELDS) {
    const values = paragraphs.map(({ stroke, p }) => paraAttrsOf(stroke, p)[field]);
    if (values.every((value) => value === undefined)) {
      if (field === 'list' || field === 'shade') rule[field] = 'none';
      continue;
    }
    const value = shared(values, (each) => each);
    if (value !== undefined) rule[field] = JSON.parse(JSON.stringify(value)) as unknown;
  }
  const flow = shared(filled, (stroke) => (stroke.typeset?.flow === 'markdown' ? 'markdown' : 'plain'));
  if (flow !== undefined) rule.flow = flow;
  const accent = shared(paragraphs, ({ stroke, p }) => stroke.typeset?.paras?.[p]?.accent ?? 'none');
  if (accent !== undefined) rule.accent = accent;
  const effects = shared(filled, (stroke) => effectList(stroke.effects));
  if (effects !== undefined) rule.effects = JSON.parse(JSON.stringify(effects)) as Effect[];
  return rule as CompositionTextRule;
}

/** What every path under a layer shares, as a stroke rule. */
function capturePaths(paths: readonly Stroke[]): CompositionStrokeRule {
  const rule: Record<string, unknown> = {};
  const put = (field: string, value: unknown): void => {
    if (value !== undefined) rule[field] = JSON.parse(JSON.stringify(value)) as unknown;
  };
  put('color', shared(paths, (stroke) => stroke.color));
  put('width', shared(paths, (stroke) => stroke.width));
  put('strokeStyle', shared(paths, (stroke) => stroke.strokeStyle ?? 'solid'));
  const shaped = paths.filter(profileApplies);
  if (shaped.length > 0) put('profile', shared(shaped, (stroke) => stroke.profile ?? 'uniform'));
  const closed = paths.filter(isClosedStroke);
  if (closed.length > 0) {
    put('noStroke', shared(closed, (stroke) => stroke.noStroke === true));
    // A fill is kept only with the gradient beside it, so applying the rule
    // again cannot take a gradient away.
    const fill = shared(closed, (stroke) => stroke.fill ?? 'none');
    const gradient = shared(closed, (stroke) => stroke.gradient ?? 'none');
    if (fill !== undefined && gradient !== undefined) {
      put('fill', fill);
      put('gradient', gradient);
    }
  }
  put('opacity', shared(paths, (stroke) => stroke.opacity ?? defaultOpacityFor(stroke.tool)));
  put('effects', shared(paths, (stroke) => effectList(stroke.effects)));
  return rule as CompositionStrokeRule;
}

/**
 * Records a page's named layers as a style: for each name, a layer rule with
 * the layer's opacity, blend, visibility, effects and (a group's) Isolate
 * Blending; a text rule with what every text under it shares; and a stroke
 * rule with what every path under it shares. Names the app gave (`Layer 3`,
 * `Group 1`, `Brush 12`, `<Group>`, a group's `contents`) are left out, and
 * layers sharing a name give one rule of what they share. Applied to the same
 * page, the style changes nothing.
 */
export function captureCompositionStyle(sketch: Sketch, name: string, options: CompositionStyleOptions = {}): CompositionStyle {
  const configs = options.configs ?? [];
  const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
  const under = subtreeIds(sketch.layers);
  const groups = new Map<string, { name: string; layers: Layer[] }>();
  // Top of the Layers panel first.
  for (const layer of [...sketch.layers].reverse()) {
    if (isDefaultLayerName(layer.name)) continue;
    const parent = layer.parent ? byId.get(layer.parent) : undefined;
    if (parent && layerNameKey(layer.name) === `${layerNameKey(parent.name)} contents`) continue;
    const key = layerNameKey(layer.name);
    const group = groups.get(key) ?? { name: layer.name.trim(), layers: [] };
    group.layers.push(layer);
    groups.set(key, group);
  }
  const layers: Record<string, CompositionLayerRule> = {};
  const text: Record<string, CompositionTextRule> = {};
  const strokes: Record<string, CompositionStrokeRule> = {};
  for (const { name: ruleName, layers: named } of groups.values()) {
    const rule: Record<string, unknown> = {};
    const put = (field: string, value: unknown): void => {
      if (value !== undefined) rule[field] = JSON.parse(JSON.stringify(value)) as unknown;
    };
    put('opacity', shared(named, (layer) => layer.opacity));
    put('blend', shared(named, (layer) => layer.blend ?? 'normal'));
    put('visible', shared(named, (layer) => layer.visible));
    put('effects', shared(named, (layer) => effectList(layer.effects)));
    if (named.every((layer) => layer.group)) put('isolate', shared(named, (layer) => layer.isolate === true));
    layers[ruleName] = rule as CompositionLayerRule;
    const ids = new Set(named.flatMap((layer) => [...(under.get(layer.id) ?? [])]));
    const marks = sketch.strokes.filter((stroke) => {
      const own = markLayer(sketch, stroke);
      return own !== undefined && ids.has(own.id);
    });
    const texts = marks.filter((stroke) => markKind(stroke) === 'text');
    const paths = marks.filter((stroke) => markKind(stroke) === 'stroke');
    if (texts.length > 0) text[ruleName] = captureText(texts, configs);
    if (paths.length > 0) strokes[ruleName] = capturePaths(paths);
  }
  const style: CompositionStyle = { napkinCompositionStyle: COMPOSITION_STYLE_FORMAT, name: name.trim() || 'Composition Style' };
  if (Object.keys(layers).length > 0) style.layers = layers;
  if (Object.keys(text).length > 0) style.text = text;
  if (Object.keys(strokes).length > 0) style.strokes = strokes;
  return style;
}

/**
 * One layer's rule of a kind, as a capture would record it - for an editor's
 * "from the selection". Null when the layer holds nothing of that kind.
 */
export function captureLayerRule(sketch: Sketch, layerId: string, kind: CompositionRuleKind, options: CompositionStyleOptions = {}): Record<string, unknown> | null {
  const layer = sketch.layers.find((each) => each.id === layerId);
  if (!layer) return null;
  if (kind === 'layer') {
    const rule: Record<string, unknown> = { opacity: layer.opacity, blend: layer.blend ?? 'normal', visible: layer.visible, effects: effectList(layer.effects) };
    if (layer.group) rule.isolate = layer.isolate === true;
    return JSON.parse(JSON.stringify(rule)) as Record<string, unknown>;
  }
  const ids = subtreeIds(sketch.layers).get(layer.id) ?? new Set([layer.id]);
  const marks = sketch.strokes.filter((stroke) => {
    const own = markLayer(sketch, stroke);
    return own !== undefined && ids.has(own.id) && markKind(stroke) === kind;
  });
  if (marks.length === 0) return null;
  return (kind === 'text' ? captureText(marks, options.configs ?? []) : capturePaths(marks)) as Record<string, unknown>;
}

// ---- Renaming -----------------------------------------------------------------------------------------------------

/**
 * The page with every layer named `from` - trimmed, in any case - named `to`
 * instead: a report's Rename layer, which makes a near miss match. Gives the
 * changes as layer patches, with the page.
 */
export function renameLayers(sketch: Sketch, from: string, to: string): { sketch: Sketch; layers: CompositionLayerChange[] } {
  const key = layerNameKey(from);
  const name = to.trim();
  const changes: CompositionLayerChange[] = [];
  const layers = sketch.layers.map((layer) => {
    if (layerNameKey(layer.name) !== key || layer.name === name) return layer;
    changes.push({ id: layer.id, patch: { name } });
    return { ...layer, name };
  });
  return { sketch: changes.length > 0 ? { ...sketch, layers } : sketch, layers: changes };
}

// ---- Describing a rule --------------------------------------------------------------------------------------------

/** A value as a summary shows it. */
function shown(field: CompositionRuleField, value: unknown): string {
  if (field.kind === 'effects') {
    const n = (value as unknown[]).length;
    return n === 0 ? 'no effects' : `${n} ${n === 1 ? 'effect' : 'effects'}`;
  }
  if (field.kind === 'gradient') return value === 'none' ? 'no gradient' : `${(value as Gradient).type} gradient`;
  if (field.kind === 'list') return value === 'none' ? 'no list' : `${(value as { kind: string }).kind} list`;
  if (field.kind === 'boolean') return value ? field.label.toLowerCase() : `no ${field.label.toLowerCase()}`;
  if (typeof value === 'number') return `${field.label.toLowerCase()} ${fmt(value)}${field.unit === '%' ? '%' : field.unit === 'px' ? ' px' : ''}`;
  return `${field.label.toLowerCase()} ${String(value)}`;
}

/** A rule in a few words, for a list: `opacity 0.5, blend stack, 1 effect`. Empty for a rule that sets nothing. */
export function compositionRuleSummary(kind: CompositionRuleKind, rule: Readonly<Record<string, unknown>>): string {
  return COMPOSITION_RULE_FIELDS[kind]
    .filter((field) => rule[field.key] !== undefined)
    .map((field) => shown(field, rule[field.key]))
    .join(', ');
}

// ---- The schema ---------------------------------------------------------------------------------------------------

/** Where the schema is published, as its `$id` names it. */
export const COMPOSITION_STYLE_SCHEMA_ID = 'https://github.com/isocialPractice/napkin-sketch/docs/api/schema/composition-style.schema.json';

function fieldSchema(field: CompositionRuleField): Record<string, unknown> {
  const description = field.summary;
  switch (field.kind) {
    case 'number':
      return field.range ? { type: 'number', minimum: field.range.min, maximum: field.range.max, description } : { type: 'number', description };
    case 'leading':
      return { anyOf: [{ type: 'number', minimum: field.range?.min ?? 0 }, { const: 'auto' }], description };
    case 'color':
      return field.none ? { anyOf: [{ $ref: '#/definitions/color' }, { const: 'none' }], description } : { $ref: '#/definitions/color', description };
    case 'choice':
      return { enum: [...(field.choices ?? [])], description };
    case 'boolean':
      return { type: 'boolean', description };
    case 'text':
    case 'config':
      return { type: 'string', minLength: 1, description };
    case 'blend':
      return { $ref: '#/definitions/blend', description };
    case 'effects':
      return { type: 'array', items: { $ref: '#/definitions/effect' }, description };
    case 'gradient':
      return { anyOf: [{ $ref: '#/definitions/gradient' }, { const: 'none' }], description };
    case 'list':
      return { anyOf: [{ $ref: '#/definitions/list' }, { const: 'none' }], description };
    case 'language':
      return { type: 'string', minLength: 1, description };
  }
}

function ruleSchema(kind: CompositionRuleKind): Record<string, unknown> {
  return {
    type: 'object',
    description: `A ${COMPOSITION_RULE_LABELS[kind].toLowerCase()} rule: what it sets on the layers it names.`,
    additionalProperties: false,
    properties: Object.fromEntries(COMPOSITION_RULE_FIELDS[kind].map((field) => [field.key, fieldSchema(field)])),
  };
}

/** The composition style format as a JSON Schema (draft-07), built from the same field tables the reader uses. */
export function compositionStyleSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: COMPOSITION_STYLE_SCHEMA_ID,
    title: 'Napkin composition style',
    description: 'Rules keyed by layer name that restyle a page or a composition whose layers are named to match.',
    type: 'object',
    required: ['napkinCompositionStyle', 'name'],
    additionalProperties: false,
    properties: {
      napkinCompositionStyle: { const: COMPOSITION_STYLE_FORMAT, description: 'The format: 1.' },
      name: { type: 'string', minLength: 1, maxLength: COMPOSITION_STYLE_NAME_MAX, description: "The style's name." },
      layers: { type: 'object', description: 'Layer rules by layer name.', additionalProperties: { $ref: '#/definitions/layerRule' } },
      text: { type: 'object', description: 'Text rules by layer name.', additionalProperties: { $ref: '#/definitions/textRule' } },
      strokes: { type: 'object', description: 'Stroke rules by layer name.', additionalProperties: { $ref: '#/definitions/strokeRule' } },
    },
    definitions: {
      layerRule: ruleSchema('layer'),
      textRule: ruleSchema('text'),
      strokeRule: ruleSchema('stroke'),
      color: { type: 'string', minLength: 1, description: 'A CSS color: #rrggbb, rgb(), hsl() or a name.' },
      blend: { type: 'string', description: `A blend mode: ${BLEND_MODE_IDS.join(', ')}, or a CSS name such as multiply.` },
      effect: { type: 'object', required: ['type'], properties: { type: { enum: [...EFFECT_TYPES] } }, description: "An effect as napkin's .skbk and API write it." },
      gradient: {
        type: 'object',
        required: ['type', 'stops'],
        properties: {
          type: { enum: ['linear', 'radial'] },
          angle: { type: 'number' },
          stops: {
            type: 'array',
            minItems: 2,
            items: { type: 'object', required: ['offset', 'color'], properties: { offset: { type: 'number' }, color: { $ref: '#/definitions/color' } } },
          },
        },
      },
      list: {
        type: 'object',
        required: ['kind'],
        properties: { kind: { enum: ['bullet', 'number'] }, level: { type: 'number' }, marker: { type: 'string' }, start: { type: 'number' } },
      },
    },
  };
}
