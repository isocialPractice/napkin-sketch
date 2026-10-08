/**
 * A mark's appearance: the parts its effects can aim at, the copies of it
 * that draw one part alone, and how its effects are laid out over those
 * parts (core/effects.ts's effectPlan). The canvas, the SVG and the PNG all
 * ask here, so a fill's Inner Glow is the fill's in every output.
 *
 * And the appearance stack the Appearance panel edits: an effect list as its
 * sections - the stroke's, the fill's, the whole mark's - each in the order
 * it is applied, top first; the edits the panel makes to it, each giving a new
 * list, never changing the one it was given, since an undo snapshot shares
 * it; how effects follow their mark through a scale, a turn or a mirror; the
 * fields each effect's options show; and the geometry effects Expand
 * Appearance bakes into a mark's anchors.
 *
 * Nothing here reads the DOM.
 */

import { BLEND_MODES, isBlended } from './blend.js';
import {
  activeEffects,
  activeGeometryEffects,
  EFFECT_LABELS,
  effectLayout,
  effectPlan,
  GEOMETRY_EFFECT_TYPES,
  scaleEffects,
  untargeted,
  type Effect,
  type EffectPlan,
  type EffectType,
  type MarkParts,
} from './effects.js';
import { matchingPreset, SPLATTER_PRESET_LABELS, SPLATTER_PRESET_NAMES, SPLATTER_PRESETS, splatterPresetOf } from './splatter.js';
import { WARP_PARTS, warpPartFor, warpPartsOf, WARP_STYLE_LABELS, WARP_STYLE_ORIGINS, WARP_STYLES, warpStyleOf, type WarpPart } from './warp-styles.js';
import { defaultOpacityFor, isImageStroke, isTextStroke, type Layer, type Stroke } from './types.js';
import { outlineSource } from './type/outline.js';

/**
 * The parts of a mark: text has a fill (its ink); an image has neither part,
 * and neither has an eraser; any other mark has a stroke unless its outline is
 * switched off, and a fill when it has a fill or a gradient and points enough
 * to fill.
 */
export function markParts(stroke: Stroke): MarkParts {
  if (isImageStroke(stroke) || stroke.tool === 'eraser') return { fill: false, stroke: false };
  if (isTextStroke(stroke)) return { fill: true, stroke: false };
  const fill = (stroke.fill !== undefined || stroke.gradient !== undefined) && stroke.points.length > 2;
  return { fill, stroke: stroke.noStroke !== true };
}

/**
 * The mark drawing one part alone, solid and with no effects of its own: its
 * fill with the outline switched off, or its outline with no fill. The
 * picture of the two together takes the mark's opacity, as one picture.
 */
export function partOnly(stroke: Stroke, part: 'fill' | 'stroke'): Stroke {
  if (part === 'fill') return { ...stroke, noStroke: true, opacity: 1, effects: undefined };
  const { fill: _fill, gradient: _gradient, ...rest } = stroke;
  return { ...rest, opacity: 1, effects: undefined };
}

/** A mark's own opacity: the tool's when it sets none. */
export function markOpacity(stroke: Stroke): number {
  return stroke.opacity ?? defaultOpacityFor(stroke.tool);
}

/**
 * The Outer Shadows and Outer Glows a mark lays under itself on its own,
 * mixing by their blends with what is under it (core/effects.ts's
 * effectLayout): only a solid mark does, since its opacity would otherwise
 * fall on them twice. Empty for most marks.
 */
export function markUnders(stroke: Stroke): Effect[] {
  const plan = markEffectPlan(stroke);
  return plan ? effectLayout(plan.object, markOpacity(stroke) >= 1).unders : [];
}

/**
 * The same for a layer or a group: only one laid down just as it is drawn -
 * solid, by no blend of its own, and (`erases` false) with no eraser marks
 * to cut its shadow - lays its shadows under itself on their own.
 */
export function layerUnders(layer: Layer, erases = false): Effect[] {
  const effects = activeEffects(layer.effects);
  if (!effects) return [];
  return effectLayout(effects, layer.opacity >= 1 && !isBlended(layer.blend) && !erases).unders;
}

/**
 * How a mark draws its effects (core/effects.ts's effectPlan), or null when
 * none of them draws. An eraser has none. A mark a geometry effect draws
 * anew - a Splatter - always draws its fill and its stroke apart, each as
 * core/geometry-effects.ts makes it, whatever its raster effects ask.
 */
export function markEffectPlan(stroke: Stroke): EffectPlan | null {
  if (stroke.tool === 'eraser') return null;
  const effects = activeEffects(stroke.effects) ?? [];
  // A mark 3D builds is one picture of faces: an effect aimed at its fill
  // or its stroke works on all of it, and its opacity falls on it once. So
  // is a text a geometry effect draws through its outlines.
  const faces = isTextStroke(stroke) ? outlineSource() !== null && hasGeometryEffects(stroke.effects) : !isImageStroke(stroke) && geometryShape(stroke.effects) === 'faces';
  if (faces) {
    const whole = effectPlan(untargeted(effects), markParts(stroke));
    return whole.object.length > 0 || markOpacity(stroke) < 1 ? { ...whole, split: false } : null;
  }
  const plan = effectPlan(effects, markParts(stroke));
  // A geometry effect that draws a part anew (a Splatter), or bends one part
  // alone (a Warp aimed at it), leaves the two parts apart; one that bends
  // the whole mark leaves it whole. Pictures have no shape for one to draw
  // on, and text drew as its outlines above (core/geometry-effects.ts).
  if (splitsParts(stroke.effects) && !isTextStroke(stroke) && !isImageStroke(stroke)) return { ...plan, split: true };
  return plan.split || plan.object.length > 0 ? plan : null;
}

/**
 * What a list's geometry effects leave a mark as, worked in their order:
 * `whole` - bent or not; `parts`, its fill and stroke apart, once a Splatter
 * draws one anew or a Warp bends one alone; or `faces`, once 3D builds it.
 * Whatever comes after parts or faces leaves them so (core/geometry-effects.ts).
 * Null with none.
 */
export function geometryShape(effects: unknown): 'whole' | 'parts' | 'faces' | null {
  const list = activeGeometryEffects(effects);
  if (!list) return null;
  let shape: 'whole' | 'parts' | 'faces' = 'whole';
  for (const effect of list) {
    if (shape !== 'whole') break;
    if (effect.type === '3d') shape = 'faces';
    else if (effect.type === 'splatter' || effect.target === 'fill' || effect.target === 'stroke') shape = 'parts';
  }
  return shape;
}

/**
 * Whether a list's geometry effects leave a mark's fill and stroke apart: a
 * Splatter draws one anew, and a Warp aimed at one bends it alone - unless
 * 3D built the mark first. A Warp on the whole mark bends it whole.
 */
export function splitsParts(effects: unknown): boolean {
  return geometryShape(effects) === 'parts';
}

// ---- The appearance stack ------------------------------------------------------------

/** What an effect in a mark's list works on: its stroke, its fill, or the whole mark. */
export type AppearanceTarget = 'stroke' | 'fill' | 'object';

/** An effect's place in its list, as a row of the Appearance panel names it. */
export interface StackEntry {
  effect: Effect;
  /** Its index in the list. */
  index: number;
}

/**
 * An effect as a row or a notice names it: its label, and a Warp's style -
 * "Warp: Arc Lower" - or a 3D effect's kind, as a vector editor's Appearance
 * panel says it.
 */
export function effectName(effect: Effect): string {
  const label = EFFECT_LABELS[effect.type] ?? effect.type;
  if (effect.type === '3d') return `${label}: ${effect.kind === 'revolve' ? 'Revolve' : 'Extrude'}`;
  if (effect.type !== 'warp') return label;
  const part = effect.part === 'lower' ? ' Lower' : effect.part === 'upper' ? ' Upper' : '';
  return `${label}: ${WARP_STYLE_LABELS[effect.style]}${part}`;
}

/** The target an effect works on. */
export function targetOf(effect: Effect): AppearanceTarget {
  return effect.target === 'fill' || effect.target === 'stroke' ? effect.target : 'object';
}

/**
 * A list as the Appearance panel's sections: the stroke's effects, the fill's,
 * then the whole mark's, each in the list's order, which is the order they are
 * applied - top first, as a vector editor applies its Appearance panel's.
 */
export function appearanceSections(effects: readonly Effect[]): Record<AppearanceTarget, StackEntry[]> {
  const sections: Record<AppearanceTarget, StackEntry[]> = { stroke: [], fill: [], object: [] };
  effects.forEach((effect, index) => sections[targetOf(effect)].push({ effect, index }));
  return sections;
}

/** An effect with its target set: `object` takes the field away. */
export function aimedAt(effect: Effect, target: AppearanceTarget): Effect {
  const { target: _was, ...rest } = effect;
  return (target === 'object' ? rest : { ...rest, target }) as Effect;
}

/** The list with an effect added at the end of its target's section, which is the end of the list. */
export function addEffect(effects: readonly Effect[], effect: Effect, target: AppearanceTarget = targetOf(effect)): Effect[] {
  return [...effects, aimedAt(effect, target)];
}

/** The list with the effect at `index` replaced. */
export function replaceEffect(effects: readonly Effect[], index: number, effect: Effect): Effect[] {
  return effects.map((each, k) => (k === index ? effect : each));
}

/** The list without the effect at `index`. */
export function removeEffect(effects: readonly Effect[], index: number): Effect[] {
  return effects.filter((_, k) => k !== index);
}

/** The list with a copy of the effect at `index` just after it. */
export function duplicateEffect(effects: readonly Effect[], index: number): Effect[] {
  const effect = effects[index];
  if (!effect) return [...effects];
  return [...effects.slice(0, index + 1), JSON.parse(JSON.stringify(effect)) as Effect, ...effects.slice(index + 1)];
}

/** The list with the effect at `index` switched on or off, as the panel's eye does: on takes the field away. */
export function toggleEffect(effects: readonly Effect[], index: number, on = effects[index]?.on === false): Effect[] {
  return effects.map((effect, k) => {
    if (k !== index) return effect;
    const { on: _was, ...rest } = effect;
    return (on ? rest : { ...rest, on: false }) as Effect;
  });
}

/** The list with the effect at `index` moved to work on another target, keeping its place. */
export function retargetEffect(effects: readonly Effect[], index: number, target: AppearanceTarget): Effect[] {
  return effects.map((effect, k) => (k === index ? aimedAt(effect, target) : effect));
}

/**
 * The list with the effect at `from` moved to sit just before the effect now
 * at `to` - the list's length for the end - as a drag in the panel puts it,
 * aimed at `target`, or at the target of the effect it lands before (its own
 * at the end), so a drag into another section moves it there.
 */
export function moveEffect(effects: readonly Effect[], from: number, to: number, target?: AppearanceTarget): Effect[] {
  if (from === to || from < 0 || from >= effects.length) return [...effects];
  const moving = effects[from];
  const rest = effects.filter((_, k) => k !== from);
  const at = Math.max(0, Math.min(rest.length, to > from ? to - 1 : to));
  const landed = target ?? (effects[to] ? targetOf(effects[to]) : targetOf(moving));
  return [...rest.slice(0, at), aimedAt(moving, landed), ...rest.slice(at)];
}

/** Two effect lists that are the same, field for field: what lets the panel edit several marks as one. */
export function sameEffects(a: readonly Effect[] | undefined, b: readonly Effect[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

// ---- Effects through a transform -----------------------------------------------------

/** What a transform did to a mark, for its effects to follow. */
export interface EffectTransform {
  /** A scale, as one factor: lengths are multiplied by it. */
  scale?: number;
  /** A turn, in degrees clockwise on the page, as the store turns marks. */
  rotate?: number;
  /** A mirror across a vertical line (left for right), or a horizontal one. */
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * The list as it is after its mark went through a transform, as a vector
 * editor's Scale Strokes and Effects has it: lengths scaled, a shadow's
 * offset turned and mirrored with the mark, and a bevel's light turned and
 * mirrored too, so it still falls on the same side of the mark. A new list;
 * the one given is left as it is.
 */
export function effectsAfterTransform(effects: readonly Effect[], transform: EffectTransform): Effect[] {
  const scaled = transform.scale !== undefined && transform.scale !== 1;
  let out = scaled ? scaleEffects(effects, Math.abs(transform.scale ?? 1)) : effects.map((effect) => ({ ...effect }) as Effect);
  const rotate = transform.rotate ?? 0;
  const turns = rotate % 360 !== 0;
  if (!turns && !transform.flipX && !transform.flipY) return out;
  const r = (rotate * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const round = (v: number): number => Math.round(v * 1e9) / 1e9;
  const angleOf = (degrees: number): number => ((round(degrees) % 360) + 360) % 360;
  out = out.map((effect): Effect => {
    if (effect.type === 'drop-shadow' || effect.type === 'inner-shadow') {
      let dx = effect.dx;
      let dy = effect.dy;
      if (turns) [dx, dy] = [dx * cos - dy * sin, dx * sin + dy * cos];
      if (transform.flipX) dx = -dx;
      if (transform.flipY) dy = -dy;
      return { ...effect, dx: round(dx), dy: round(dy) };
    }
    if (effect.type === 'bevel' || effect.type === 'emboss') {
      // Photoshop's angle turns counterclockwise; the page's turn is clockwise.
      let angle = effect.angle - rotate;
      if (transform.flipX) angle = 180 - angle;
      if (transform.flipY) angle = -angle;
      return { ...effect, angle: angleOf(angle), highlight: { ...effect.highlight }, shadow: { ...effect.shadow } };
    }
    if (effect.type === 'splatter') {
      // The hatch runs the same way across the mark: counterclockwise, as the light does, from -180 to 180.
      let angle = effect.angle - rotate;
      if (transform.flipX) angle = 180 - angle;
      if (transform.flipY) angle = -angle;
      const shown = angleOf(angle + 180) - 180;
      return { ...effect, angle: shown === -180 ? 180 : shown };
    }
    if (effect.type === '3d') {
      // The base shape turns on the page, and the view with it; a mirror
      // mirrors the view - its turns about the other axes, its place across -
      // and swaps a revolve's axis to the other edge.
      const rotation: [number, number, number] = [...effect.rotation];
      const position: [number, number, number] = [...effect.position];
      let axis = effect.axis;
      if (transform.flipX) {
        rotation[1] = -rotation[1];
        rotation[2] = -rotation[2];
        position[0] = -position[0];
        axis = axis === 'left' ? 'right' : 'left';
      }
      if (transform.flipY) {
        rotation[0] = -rotation[0];
        rotation[2] = -rotation[2];
        position[1] = -position[1];
      }
      return { ...effect, rotation: rotation.map((a) => round(a) || 0) as [number, number, number], position, axis, scale: [...effect.scale], light: { ...effect.light } };
    }
    return effect;
  });
  return out;
}

// ---- Each effect's options -----------------------------------------------------------

/**
 * How a field of an effect's options is edited: a length, in the carrier's
 * units; a plain number; a share from 0 to 1, shown as a percent; a percent
 * kept as written (a spread, a choke, a depth); degrees, with a dial; a color;
 * a blend mode (core/blend.ts); one of a few words; or a preset, which sets
 * every other field at once and reads as none when they match no preset.
 */
export type EffectFieldKind = 'length' | 'number' | 'share' | 'percent' | 'angle' | 'color' | 'blend' | 'choice' | 'preset' | 'check';

/** One field of an effect's options. */
export interface EffectField {
  /** Where it is in the effect: a key, or a shade's, dotted - `highlight.color`. */
  key: string;
  label: string;
  kind: EffectFieldKind;
  min?: number;
  max?: number;
  step?: number;
  /** A choice's words and what each is called. */
  choices?: ReadonlyArray<{ value: string; label: string }>;
  /** A heading the field sits under: a bevel's Highlight and Shadow, a Splatter's Line Options. */
  group?: string;
  /** Changing it changes the form: a Warp's style decides whether it has a Part. */
  rebuilds?: boolean;
  /** Whether the field shows for this effect; always, when absent. */
  shown?: (effect: Effect) => boolean;
  /** A choice's words for this effect, when they depend on it: Shell has no whole Part. */
  choicesFor?: (effect: Effect) => ReadonlyArray<{ value: string; label: string }>;
}

const LENGTH = { kind: 'length', min: 0, max: 250, step: 0.5 } as const;
const OFFSET = { kind: 'length', min: -500, max: 500, step: 0.5 } as const;
const SHARE = { kind: 'share', min: 0, max: 1, step: 0.01 } as const;
const PERCENT = { kind: 'percent', min: 0, max: 100, step: 1 } as const;
const SIGNED_PERCENT = { kind: 'percent', min: -100, max: 100, step: 1 } as const;

/** A Warp's parts as the form names them. */
const PART_LABELS: Readonly<Record<WarpPart, string>> = { whole: 'Whole', lower: 'Lower', upper: 'Upper' };

/** A bevel's or an emboss's fields, given its styles. */
function reliefFields(styles: ReadonlyArray<{ value: string; label: string }>): EffectField[] {
  const shade = (key: 'highlight' | 'shadow', group: string): EffectField[] => [
    { key: `${key}.blend`, label: 'Mode', kind: 'blend', group },
    { key: `${key}.color`, label: 'Color', kind: 'color', group },
    { key: `${key}.opacity`, label: 'Opacity', ...SHARE, group },
  ];
  return [
    { key: 'style', label: 'Style', kind: 'choice', choices: styles },
    { key: 'depth', label: 'Depth', kind: 'percent', min: 1, max: 1000, step: 1 },
    {
      key: 'direction',
      label: 'Direction',
      kind: 'choice',
      choices: [
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
      ],
    },
    { key: 'size', label: 'Size', ...LENGTH },
    { key: 'soften', label: 'Soften', ...LENGTH },
    { key: 'angle', label: 'Angle', kind: 'angle', min: 0, max: 360, step: 1 },
    { key: 'altitude', label: 'Altitude', kind: 'number', min: 0, max: 90, step: 1 },
    ...shade('highlight', 'Highlight'),
    ...shade('shadow', 'Shadow'),
  ];
}

/**
 * The fields each effect's options show, in the order a vector editor shows
 * them: for a shadow and a glow, its blend and opacity first, then its
 * lengths, then its color.
 */
export const EFFECT_FIELDS: { readonly [T in EffectType]: readonly EffectField[] } = {
  blur: [{ key: 'radius', label: 'Radius', ...LENGTH }],
  brightness: [{ key: 'amount', label: 'Amount', kind: 'number', min: 0, max: 4, step: 0.05 }],
  contrast: [{ key: 'amount', label: 'Amount', kind: 'number', min: 0, max: 4, step: 0.05 }],
  saturate: [{ key: 'amount', label: 'Amount', kind: 'number', min: 0, max: 4, step: 0.05 }],
  grayscale: [{ key: 'amount', label: 'Amount', ...SHARE }],
  sepia: [{ key: 'amount', label: 'Amount', ...SHARE }],
  invert: [{ key: 'amount', label: 'Amount', ...SHARE }],
  'hue-rotate': [{ key: 'angle', label: 'Angle', kind: 'angle', min: -360, max: 360, step: 1 }],
  opacity: [{ key: 'amount', label: 'Amount', ...SHARE }],
  'drop-shadow': [
    { key: 'blend', label: 'Mode', kind: 'blend' },
    { key: 'opacity', label: 'Opacity', ...SHARE },
    { key: 'dx', label: 'X Offset', ...OFFSET },
    { key: 'dy', label: 'Y Offset', ...OFFSET },
    { key: 'blur', label: 'Blur', ...LENGTH },
    { key: 'spread', label: 'Spread', ...PERCENT },
    { key: 'color', label: 'Color', kind: 'color' },
  ],
  feather: [{ key: 'radius', label: 'Radius', ...LENGTH }],
  bevel: reliefFields([
    { value: 'inner', label: 'Inner Bevel' },
    { value: 'outer', label: 'Outer Bevel' },
  ]),
  emboss: reliefFields([
    { value: 'emboss', label: 'Emboss' },
    { value: 'pillow', label: 'Pillow Emboss' },
  ]),
  'inner-shadow': [
    { key: 'blend', label: 'Mode', kind: 'blend' },
    { key: 'opacity', label: 'Opacity', ...SHARE },
    { key: 'dx', label: 'X Offset', ...OFFSET },
    { key: 'dy', label: 'Y Offset', ...OFFSET },
    { key: 'blur', label: 'Blur', ...LENGTH },
    { key: 'choke', label: 'Choke', ...PERCENT },
    { key: 'color', label: 'Color', kind: 'color' },
  ],
  'outer-glow': [
    { key: 'blend', label: 'Mode', kind: 'blend' },
    { key: 'opacity', label: 'Opacity', ...SHARE },
    { key: 'blur', label: 'Blur', ...LENGTH },
    { key: 'spread', label: 'Spread', ...PERCENT },
    { key: 'color', label: 'Color', kind: 'color' },
  ],
  'inner-glow': [
    { key: 'blend', label: 'Mode', kind: 'blend' },
    { key: 'opacity', label: 'Opacity', ...SHARE },
    { key: 'blur', label: 'Blur', ...LENGTH },
    { key: 'choke', label: 'Choke', ...PERCENT },
    {
      key: 'source',
      label: 'Source',
      kind: 'choice',
      choices: [
        { value: 'edge', label: 'Edge' },
        { value: 'center', label: 'Center' },
      ],
    },
    { key: 'color', label: 'Color', kind: 'color' },
  ],
  splatter: [
    { key: 'preset', label: 'Settings', kind: 'preset', choices: [...SPLATTER_PRESET_NAMES.map((name) => ({ value: name, label: SPLATTER_PRESET_LABELS[name] })), { value: '', label: 'Custom' }] },
    { key: 'angle', label: 'Angle', kind: 'angle', min: -180, max: 180, step: 1 },
    { key: 'overlap', label: 'Path Overlap', ...OFFSET },
    { key: 'overlapVariation', label: 'Variation', ...LENGTH },
    { key: 'width', label: 'Stroke Width', kind: 'length', min: 0.1, max: 100, step: 0.1, group: 'Line Options' },
    { key: 'curviness', label: 'Curviness', ...PERCENT, group: 'Line Options' },
    { key: 'curvinessVariation', label: 'Variation', ...PERCENT, group: 'Line Options' },
    { key: 'spacing', label: 'Spacing', kind: 'length', min: 0.1, max: 250, step: 0.1, group: 'Line Options' },
    { key: 'spacingVariation', label: 'Variation', ...LENGTH, group: 'Line Options' },
    { key: 'seed', label: 'Seed', kind: 'number', min: 0, max: 2147483647, step: 1, group: 'Line Options' },
  ],
  warp: [
    {
      key: 'style',
      label: 'Style',
      kind: 'choice',
      choices: WARP_STYLES.map((style) => ({
        value: style,
        label: WARP_STYLE_ORIGINS[style] === WARP_STYLE_LABELS[style] ? WARP_STYLE_LABELS[style] : `${WARP_STYLE_LABELS[style]} (${WARP_STYLE_ORIGINS[style]})`,
      })),
      rebuilds: true,
    },
    {
      key: 'part',
      label: 'Part',
      kind: 'choice',
      choices: WARP_PARTS.map((part) => ({ value: part, label: PART_LABELS[part] })),
      choicesFor: (effect) => (effect.type === 'warp' ? warpPartsOf(effect.style) : WARP_PARTS).map((part) => ({ value: part, label: PART_LABELS[part] })),
      shown: (effect) => effect.type === 'warp' && warpPartsOf(effect.style).length > 1,
    },
    {
      key: 'orientation',
      label: 'Orientation',
      kind: 'choice',
      choices: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
    },
    { key: 'bend', label: 'Bend', ...SIGNED_PERCENT },
    { key: 'distortH', label: 'Horizontal', ...SIGNED_PERCENT, group: 'Distortion' },
    { key: 'distortV', label: 'Vertical', ...SIGNED_PERCENT, group: 'Distortion' },
  ],
  '3d': [
    {
      key: 'kind',
      label: 'Kind',
      kind: 'choice',
      choices: [
        { value: 'extrude', label: 'Extrude' },
        { value: 'revolve', label: 'Revolve' },
      ],
      rebuilds: true,
    },
    { key: 'depth', label: 'Extrude Depth', kind: 'length', min: 0, max: 2000, step: 1, shown: (effect) => effect.type === '3d' && effect.kind === 'extrude' },
    { key: 'angle', label: 'Angle', kind: 'angle', min: 0, max: 360, step: 1, shown: (effect) => effect.type === '3d' && effect.kind === 'revolve' },
    { key: 'offset', label: 'Offset', kind: 'length', min: -2000, max: 2000, step: 1, shown: (effect) => effect.type === '3d' && effect.kind === 'revolve' },
    {
      key: 'axis',
      label: 'From',
      kind: 'choice',
      choices: [
        { value: 'left', label: 'Left Edge' },
        { value: 'right', label: 'Right Edge' },
      ],
      shown: (effect) => effect.type === '3d' && effect.kind === 'revolve',
    },
    { key: 'segments', label: 'Steps (0: auto)', kind: 'number', min: 0, max: 256, step: 1, shown: (effect) => effect.type === '3d' && effect.kind === 'revolve' },
    { key: 'caps', label: 'Cap', kind: 'check' },
    { key: 'rotation.0', label: 'Turn about X', kind: 'angle', min: -180, max: 180, step: 1, group: 'Position' },
    { key: 'rotation.1', label: 'Turn about Y', kind: 'angle', min: -180, max: 180, step: 1, group: 'Position' },
    { key: 'rotation.2', label: 'Turn about Z', kind: 'angle', min: -180, max: 180, step: 1, group: 'Position' },
    { key: 'perspective', label: 'Perspective', kind: 'angle', min: 0, max: 160, step: 1, group: 'Position' },
    { key: 'position.0', label: 'Move X', kind: 'length', min: -5000, max: 5000, step: 1, group: 'Position' },
    { key: 'position.1', label: 'Move Y', kind: 'length', min: -5000, max: 5000, step: 1, group: 'Position' },
    { key: 'position.2', label: 'Move Z', kind: 'length', min: -5000, max: 5000, step: 1, group: 'Position' },
    { key: 'scale.0', label: 'Scale X', kind: 'share', min: 0.01, max: 100, step: 0.01, group: 'Position' },
    { key: 'scale.1', label: 'Scale Y', kind: 'share', min: 0.01, max: 100, step: 0.01, group: 'Position' },
    { key: 'scale.2', label: 'Scale Z', kind: 'share', min: 0.01, max: 100, step: 0.01, group: 'Position' },
    {
      key: 'shading',
      label: 'Shading',
      kind: 'choice',
      choices: [
        { value: 'plastic', label: 'Plastic Shading' },
        { value: 'diffuse', label: 'Diffuse Shading' },
        { value: 'none', label: 'No Shading' },
        { value: 'wireframe', label: 'Wireframe' },
      ],
      group: 'Surface',
    },
    { key: 'light.azimuth', label: 'Light From', kind: 'angle', min: 0, max: 360, step: 1, group: 'Surface' },
    { key: 'light.elevation', label: 'Light Height', kind: 'angle', min: -90, max: 90, step: 1, group: 'Surface' },
    { key: 'light.intensity', label: 'Light Intensity', ...SHARE, group: 'Surface' },
    { key: 'light.ambient', label: 'Ambient Light', ...SHARE, group: 'Surface' },
  ],
};

/**
 * Where each effect comes from, as a vector editor's menus or a photo
 * editor's layer styles name it: what the Appearance panel's rows say in
 * their tooltips, beside the name they show.
 */
export const EFFECT_ORIGINS: { readonly [T in EffectType]: string } = {
  blur: 'Effect > Blur > Gaussian Blur',
  brightness: 'the CSS filter brightness()',
  contrast: 'the CSS filter contrast()',
  saturate: 'the CSS filter saturate()',
  grayscale: 'the CSS filter grayscale()',
  sepia: 'the CSS filter sepia()',
  invert: 'the CSS filter invert()',
  'hue-rotate': 'the CSS filter hue-rotate()',
  opacity: 'the CSS filter opacity()',
  'drop-shadow': 'Effect > Stylize > Drop Shadow',
  feather: 'Effect > Stylize > Feather',
  bevel: 'Photoshop Bevel and Emboss: Inner and Outer Bevel',
  emboss: 'Photoshop Bevel and Emboss: Emboss and Pillow Emboss',
  'inner-shadow': 'Photoshop Inner Shadow',
  'outer-glow': 'Effect > Stylize > Outer Glow',
  'inner-glow': 'Effect > Stylize > Inner Glow',
  splatter: 'Effect > Stylize > Scribble',
  warp: 'Effect > Warp',
  '3d': 'Effect > 3D (Classic): Extrude & Bevel, Revolve',
};

/** The blend modes a blend field offers, in a vector editor's order, each with the vector editor's name beside it. */
export const BLEND_FIELD_CHOICES: ReadonlyArray<{ value: string; label: string }> = BLEND_MODES.map((mode) => ({
  value: mode.id,
  label: mode.id === 'normal' ? mode.label : `${mode.label} (${mode.illustrator})`,
}));

/**
 * A field's value in an effect, a shade's by its dotted key. What a drop
 * shadow written before its spread, opacity and blend leaves out reads as
 * what it paints: 0, 1 and Normal.
 */
export function effectFieldValue(effect: Effect, key: string): unknown {
  if (key === 'preset') return effect.type === 'splatter' ? (matchingPreset(effect) ?? '') : '';
  const record = effect as unknown as Record<string, unknown>;
  const [head, tail] = key.split('.');
  if (tail) return (record[head] as Record<string, unknown> | undefined)?.[tail];
  if (effect.type === 'drop-shadow' && record[head] === undefined) {
    if (head === 'spread') return 0;
    if (head === 'opacity') return 1;
    if (head === 'blend') return 'normal';
  }
  return record[head];
}

/**
 * The effect with one field changed: a new effect, with a shade copied rather
 * than shared. A preset sets every field it holds; a Warp's new style keeps
 * its part only where the style takes it.
 */
export function withEffectField(effect: Effect, key: string, value: unknown): Effect {
  if (key === 'preset') {
    const preset = splatterPresetOf(value);
    return effect.type === 'splatter' && preset ? { ...effect, ...SPLATTER_PRESETS[preset] } : { ...effect };
  }
  if (effect.type === 'warp' && key === 'style') {
    const named = warpStyleOf(value);
    return named ? { ...effect, style: named.style, part: warpPartFor(named.style, named.part ?? effect.part) } : { ...effect };
  }
  if (effect.type === 'warp' && key === 'part') return { ...effect, part: warpPartFor(effect.style, value as WarpPart) };
  const record = effect as unknown as Record<string, unknown>;
  const [head, tail] = key.split('.');
  if (tail && Array.isArray(record[head])) {
    const list = [...(record[head] as unknown[])];
    list[Number(tail)] = value;
    return { ...record, [head]: list } as unknown as Effect;
  }
  if (tail) return { ...record, [head]: { ...(record[head] as Record<string, unknown>), [tail]: value } } as unknown as Effect;
  return { ...record, [head]: value } as unknown as Effect;
}

// ---- Geometry effects and Expand Appearance --------------------------------------------

/**
 * What a geometry effect makes of a mark, baked: the marks that draw what it
 * drew, bottom first, each with the effect's geometry made its own anchors
 * and points - one mark when the effect bends the mark (a warp), several
 * when it draws a part anew (a Splatter's hatch beside the mark's outline).
 * Every mark it gives is solid and carries the effects that were aimed at
 * the part it draws; the mark's own opacity and whole-mark effects stay for
 * {@link expandAppearance} to place. Splatter registers its own
 * (core/geometry-effects.ts); Warp and 3D come later.
 */
export interface GeometryEffectKind {
  /**
   * `all` is every mark the effects before this one made of the mark, this
   * one among them: a Warp on the whole mark bends them over their one box.
   */
  expand(stroke: Stroke, effect: Effect, all: readonly Stroke[]): Stroke[];
}

const GEOMETRY_EFFECTS = new Map<string, GeometryEffectKind>();

/** Names an effect type as a geometry effect, with what Expand Appearance makes of it. */
export function registerGeometryEffect(type: string, kind: GeometryEffectKind): void {
  GEOMETRY_EFFECTS.set(type, kind);
}

/** Whether an effect bends or redraws its mark's geometry, rather than its pixels: a geometry type, or one registered as one. */
export function isGeometryEffect(effect: Effect): boolean {
  return GEOMETRY_EFFECT_TYPES.has(effect.type) || GEOMETRY_EFFECTS.has(effect.type);
}

/**
 * A list in the order it draws: a geometry effect works on the shape before
 * any raster effect works on its picture, whatever its place - a raster
 * effect needs the shape - so the geometry effects come first, each kind in
 * its own order.
 */
export function inDrawingOrder(effects: readonly Effect[]): Effect[] {
  return [...effects.filter(isGeometryEffect), ...effects.filter((effect) => !isGeometryEffect(effect))];
}

/** Whether a list holds a geometry effect that draws, for Expand Appearance to bake. */
export function hasGeometryEffects(effects: readonly Effect[] | undefined): boolean {
  return (effects ?? []).some((effect) => effect.on !== false && isGeometryEffect(effect));
}

/** What a text is as marks, to bake: its outlines, which core/geometry-effects.ts gives; null when they cannot be read. */
let textShapes: ((stroke: Stroke) => Stroke[] | null) | null = null;

/** Gives Expand Appearance a text's shapes to bake (core/geometry-effects.ts registers it, as it does the effects). */
export function registerTextShapes(make: (stroke: Stroke) => Stroke[] | null): void {
  textShapes = make;
}

/** What Expand Appearance makes of a mark: the marks it becomes, and what goes round them when there are several. */
export interface ExpandedAppearance {
  /** The marks, bottom first. One means it stays one mark, which keeps the mark's opacity and its raster effects itself. */
  marks: Stroke[];
  /** The whole mark's raster effects, for a group round several marks. */
  effects: Effect[];
  /** The mark's opacity, for a group round several marks; each mark in it is solid. */
  opacity: number;
}

/**
 * A mark with its geometry effects baked, in the order they draw, and taken
 * off its list; the raster effects stay live, as they have no vector form.
 * Null when it has none to bake, or when no kind is registered to bake the
 * ones it has. A switched-off one draws nothing, and stays as it is.
 *
 * An effect that bends the mark leaves one mark. One that draws a part anew
 * leaves several - a Splatter, its hatch and its outline - which a group
 * holds: the whole mark's effects and its opacity go on the group, and the
 * effects aimed at a part on the marks that draw it.
 */
export function expandAppearance(stroke: Stroke): ExpandedAppearance | null {
  const effects = stroke.effects ?? [];
  if (!hasGeometryEffects(effects)) return null;
  const geometric = inDrawingOrder(effects).filter((effect) => effect.on !== false && isGeometryEffect(effect));
  if (!geometric.every((effect) => GEOMETRY_EFFECTS.has(effect.type))) return null;
  const kept = effects.filter((effect) => effect.on === false || !isGeometryEffect(effect));
  const own: Stroke = { ...stroke };
  if (kept.length > 0) own.effects = kept;
  else delete own.effects;
  let marks: Stroke[] = [own];
  // A text bakes as its shapes; one whose font cannot be read stays as it is.
  if (isTextStroke(stroke)) {
    const shapes = textShapes?.(stroke) ?? null;
    if (!shapes || shapes.length === 0) return null;
    marks = shapes.length === 1 ? [{ ...shapes[0], ...(kept.length > 0 ? { effects: kept } : {}), ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}) }] : shapes;
  }
  for (const effect of geometric) {
    const all = marks;
    marks = all.flatMap((mark) => GEOMETRY_EFFECTS.get(effect.type)!.expand(mark, effect, all));
  }
  if (marks.length === 1) return { marks, effects: [], opacity: 1 };
  const whole = kept.filter((effect) => effect.on !== false && effect.target !== 'fill' && effect.target !== 'stroke');
  return { marks, effects: whole, opacity: markOpacity(stroke) };
}
