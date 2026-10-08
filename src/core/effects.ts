/**
 * Effects: the CSS filter functions and the appearance effects a vector
 * editor reaches for, as data every output can draw.
 *
 * An effect list rides on a mark, a layer or a group in the sketch model, and
 * on any element or group in the composition model, and every output reads
 * the same list: the SVG writers turn it into a `<filter>`, the rasterizer
 * into passes over the element's own pixels, and the app's canvas into
 * `ctx.filter` or those same passes.
 *
 * There are three tiers:
 *
 * - **The CSS filter functions** - `blur`, the color shifts and
 *   `drop-shadow` - which a canvas draws through `ctx.filter`.
 * - **The appearance effects** - Feather, Bevel, Emboss, Inner Shadow, Outer
 *   Glow and Inner Glow, and a drop shadow with a spread, an opacity or a
 *   blend - which no `ctx.filter` can draw. Each is defined as a small graph
 *   of SVG filter primitives that every viewer has: Gaussian blurs, component
 *   transfers, offsets, floods, composites, blends and diffuse lighting. The
 *   SVG writes that graph, and `appearance-fx.ts` runs the same graph on
 *   pixels for the canvas and the PNG, so the three agree. None uses
 *   `feMorphology`, whose radius librsvg holds to ten pixels: a spread or a
 *   choke is a levels step on the blurred matte, as Photoshop's is.
 * - **The geometry effects** - Splatter (core/splatter.ts), Warp
 *   (core/warp-styles.ts) and 3D (core/three-d/) - which change what a mark
 *   draws rather than its picture: the mark is drawn anew - bent, hatched or
 *   built in depth - before any picture is made (core/geometry-effects.ts). No raster pass sees one:
 *   {@link activeEffects} leaves them out.
 *
 * The color effects are the matrices the Filter Effects specification defines
 * them by, applied to straight (not premultiplied) color and worked in sRGB,
 * as CSS filter functions are; the SVG writers say so with
 * `color-interpolation-filters="sRGB"`, so a viewer does the same arithmetic
 * the rasterizer does. Lengths - a blur's radius, a shadow's offset and blur,
 * a bevel's size - are in the units of whatever carries the list: pixels on a
 * sketch, the composition's own units on a composition.
 *
 * Every effect may name a `target`: a mark's fill or its stroke, which it
 * then works on alone (see core/appearance.ts); and `on: false` keeps an
 * effect without drawing it, as the Appearance panel's closed eye does.
 *
 * Nothing here reads the DOM.
 */

import { blendModeInfo, blendModeOf, isBlended, type BlendModeId } from './blend.js';
import { parseColor, type Rgba } from './graphic-design/color.js';
import { SPLATTER_PRESETS } from './splatter.js';
import { WARP_PARTS, warpPartFor, warpStyleOf, type WarpPart, type WarpStyle } from './warp-styles.js';

/** The effects there are: the CSS filter functions by their CSS names, then the appearance effects. */
export type EffectType =
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'saturate'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'hue-rotate'
  | 'opacity'
  | 'drop-shadow'
  | 'feather'
  | 'bevel'
  | 'emboss'
  | 'inner-shadow'
  | 'outer-glow'
  | 'inner-glow'
  | 'splatter'
  | 'warp'
  | '3d';

/** The effects whose one argument is an amount: a factor, or a share from 0 to 1. */
export type AmountEffectType = 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert' | 'opacity';

/** The part of a mark an effect works on: the whole mark, its fill alone, or its stroke alone. */
export type EffectTarget = 'object' | 'fill' | 'stroke';

/** What any effect may carry beside its own fields. */
export interface EffectCommon {
  /**
   * The part of a mark it works on: `fill` or `stroke`. Absent, or `object`,
   * it works on the whole mark; on a layer or a group it always works on the
   * whole picture, which has no fill or stroke of its own.
   */
  target?: EffectTarget;
  /** `false` keeps the effect without drawing it, as the Appearance panel's closed eye does. */
  on?: boolean;
}

/** A bevel's or an emboss's light or shade: its color, how it mixes with the picture, and how strongly. */
export interface EffectShade {
  color: string;
  blend: BlendModeId;
  /** 0 to 1. */
  opacity: number;
}

/** The fields Bevel and Emboss share, as Photoshop's Bevel and Emboss names them. */
export interface ReliefFields {
  /** How steep the slope looks, in percent: 1 to 1000, 100 by default. */
  depth: number;
  /** `up` raises the shape; `down` presses it in, swapping the light and the shade. */
  direction: 'up' | 'down';
  /** How far the slope reaches, in the carrier's units. */
  size: number;
  /** A blur over the light and the shade, in the carrier's units. */
  soften: number;
  /** Where the light comes from, in degrees counterclockwise from the right: 120 is the upper left. */
  angle: number;
  /** How high the light stands, in degrees from 0 (grazing) to 90 (straight down). */
  altitude: number;
  highlight: EffectShade;
  shadow: EffectShade;
}

/**
 * One effect:
 *
 * - `blur` - a Gaussian blur; `radius` is its standard deviation, as CSS's
 *   `blur()` length is.
 * - `brightness`, `contrast`, `saturate` - a factor from 0: 1 leaves the color
 *   as it is.
 * - `grayscale`, `sepia`, `invert` - how much, from 0 to 1.
 * - `hue-rotate` - `angle` in degrees.
 * - `opacity` - from 0 to 1.
 * - `drop-shadow` - Outer Shadow: a shadow `dx` across and `dy` down, blurred
 *   by `blur`, which is CSS's blur radius - twice the standard deviation - in
 *   `color`. `spread` (0 to 100) firms its edge first, as Photoshop's Spread
 *   does; `opacity` fades it; `blend` mixes it with what is under the mark.
 *   A shadow without the three is CSS's own `drop-shadow()`.
 * - `feather` - fades the picture from clear at its edge to solid `radius`
 *   inside it, as Illustrator's Feather does.
 * - `bevel` and `emboss` - Photoshop's Bevel and Emboss: a slope `size` wide
 *   lit from `angle` and `altitude`, its light and shade laid over the
 *   picture. A bevel's slope is inside the shape (`inner`) or outside it
 *   (`outer`); an emboss's straddles the edge (`emboss`) or dips into it
 *   (`pillow`).
 * - `inner-shadow` - a shadow cast inside the shape from its edge, as if the
 *   shape were a hole: `dx` and `dy` as a drop shadow's, `choke` (0 to 100)
 *   firming its edge.
 * - `outer-glow` - a glow around the shape, `blur` wide.
 * - `inner-glow` - a glow inside the shape, from its edge or from its center.
 * - `splatter` - a vector editor's Scribble: the mark's fill drawn as a loose
 *   hatch `width` wide, `spacing` apart, at `angle` degrees counterclockwise
 *   from the right, its folds carried `overlap` past the edge and rounded by
 *   `curviness` (a percent), each varied by its variation from `seed`
 *   (core/splatter.ts). Aimed at the stroke, it hatches the stroke's ink.
 * - `warp` - a vector editor's Warp: what carries it bent by a `style`
 *   (core/warp-styles.ts) laid over its box, `bend` percent (-100 to 100),
 *   along the box's width or, `vertical`, its height, after `distortH` and
 *   `distortV` percent of taper across and up it. Arc and Shell bend the
 *   `part` of the box asked for. On a layer or a group it bends all it
 *   holds as one.
 * - `3d` - a vector editor's Classic 3D: the mark set in depth (`kind`
 *   `extrude`, `depth` deep, with or without `caps`) or swept round an
 *   upright axis at its left or right edge (`revolve`, `angle` degrees
 *   round, `offset` off the edge, in `segments` steps, 0 working them out),
 *   then scaled, turned by `rotation` (degrees about X, then Y, then Z) and
 *   moved by `position`, seen with `perspective` (0 to 160 degrees) and lit
 *   by `light` - `azimuth` counterclockwise from the right, `elevation` up
 *   off the page, `intensity` and `ambient` from 0 to 1 - in `shading`
 *   `plastic`, `diffuse`, `none` or `wireframe` (core/three-d/).
 *
 * Every blur here is CSS's blur radius, twice the standard deviation, but a
 * `blur` effect's own `radius`, which is the deviation, as CSS has it.
 */
export type Effect = EffectCommon &
  (
    | { type: 'blur'; radius: number }
    | { type: AmountEffectType; amount: number }
    | { type: 'hue-rotate'; angle: number }
    | {
        type: 'drop-shadow';
        dx: number;
        dy: number;
        blur: number;
        color: string;
        spread?: number;
        opacity?: number;
        blend?: BlendModeId;
      }
    | { type: 'feather'; radius: number }
    | ({ type: 'bevel'; style: 'inner' | 'outer' } & ReliefFields)
    | ({ type: 'emboss'; style: 'emboss' | 'pillow' } & ReliefFields)
    | {
        type: 'inner-shadow';
        dx: number;
        dy: number;
        blur: number;
        choke: number;
        color: string;
        blend: BlendModeId;
        opacity: number;
      }
    | { type: 'outer-glow'; blur: number; spread: number; color: string; blend: BlendModeId; opacity: number }
    | {
        type: 'inner-glow';
        blur: number;
        choke: number;
        source: 'edge' | 'center';
        color: string;
        blend: BlendModeId;
        opacity: number;
      }
    | {
        type: 'splatter';
        angle: number;
        overlap: number;
        overlapVariation: number;
        width: number;
        curviness: number;
        curvinessVariation: number;
        spacing: number;
        spacingVariation: number;
        seed: number;
      }
    | {
        type: 'warp';
        style: WarpStyle;
        orientation: 'horizontal' | 'vertical';
        bend: number;
        distortH: number;
        distortV: number;
        part: WarpPart;
      }
    | {
        type: '3d';
        kind: 'extrude' | 'revolve';
        depth: number;
        caps: boolean;
        angle: number;
        offset: number;
        axis: 'left' | 'right';
        rotation: [number, number, number];
        position: [number, number, number];
        scale: [number, number, number];
        perspective: number;
        shading: ThreeDShading;
        light: ThreeDLight;
        segments: number;
      }
  );

/** How a 3D effect's faces are painted: lit with a highlight, lit, flat, or as their edges. */
export type ThreeDShading = 'plastic' | 'diffuse' | 'none' | 'wireframe';

/** A 3D effect's light: where it comes from, and how strong it and the light all round are. */
export interface ThreeDLight {
  /** Degrees counterclockwise from the right, as seen. */
  azimuth: number;
  /** Degrees up off the page toward the viewer. */
  elevation: number;
  /** 0 to 1. */
  intensity: number;
  /** The light every face has, lit or not: 0 to 1. */
  ambient: number;
}

/** One effect of a type. The color effects share one member, so each is spelled out. */
export type EffectOf<T extends EffectType> = T extends AmountEffectType
  ? EffectCommon & { type: T; amount: number }
  : Extract<Effect, { type: T }>;

/** Bevel or Emboss. */
export type ReliefEffect = EffectOf<'bevel'> | EffectOf<'emboss'>;

/** The appearance effects: the ones a CSS filter function does not draw, each with defaults for every field. */
export type AppearanceEffectType = 'feather' | 'bevel' | 'emboss' | 'inner-shadow' | 'outer-glow' | 'inner-glow' | 'splatter' | 'warp' | '3d';

/** An appearance effect as a caller may write it: its type, and only the fields it changes. */
export type AppearanceEffectInput = {
  [T in AppearanceEffectType]: EffectCommon & { type: T } & Partial<Omit<EffectOf<T>, 'type' | 'highlight' | 'shadow'>> &
    (T extends 'bevel' | 'emboss' ? { highlight?: Partial<EffectShade>; shadow?: Partial<EffectShade> } : unknown);
}[AppearanceEffectType];

/**
 * An effect as a caller may write it: any {@link Effect}, or an appearance
 * effect with only the fields it changes, the rest its defaults
 * ({@link EFFECT_DEFAULTS}) when it is read. Every renderer reads a list
 * through {@link readEffects}.
 */
export type EffectInput = Effect | AppearanceEffectInput;

/** Every effect, in the order the documentation lists them. */
export const EFFECT_TYPES: readonly EffectType[] = [
  'blur',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'sepia',
  'invert',
  'hue-rotate',
  'opacity',
  'drop-shadow',
  'feather',
  'bevel',
  'emboss',
  'inner-shadow',
  'outer-glow',
  'inner-glow',
  'splatter',
  'warp',
  '3d',
];

/** Each effect's name in menus and reports: a vector editor's, Outer Shadow being the drop shadow. */
export const EFFECT_LABELS: { readonly [T in EffectType]: string } = {
  blur: 'Gaussian Blur',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturate: 'Saturate',
  grayscale: 'Grayscale',
  sepia: 'Sepia',
  invert: 'Invert',
  'hue-rotate': 'Hue Rotate',
  opacity: 'Opacity',
  'drop-shadow': 'Outer Shadow',
  feather: 'Feather',
  bevel: 'Bevel',
  emboss: 'Emboss',
  'inner-shadow': 'Inner Shadow',
  'outer-glow': 'Outer Glow',
  'inner-glow': 'Inner Glow',
  splatter: 'Splatter',
  warp: 'Warp',
  '3d': '3D',
};

/**
 * The geometry effects: the ones that change what a mark draws, not its
 * picture. They draw before every raster effect, whatever their place.
 */
export const GEOMETRY_EFFECT_TYPES: ReadonlySet<EffectType> = new Set<EffectType>(['splatter', 'warp', '3d']);

/**
 * The geometry effects that draw on a mark's own shape - a Splatter hatches
 * it, 3D builds from it - which a layer or a group has none of: on one they
 * draw nothing. A Warp bends whatever it is laid over, a group's marks as one.
 */
export const MARK_ONLY_EFFECT_TYPES: ReadonlySet<EffectType> = new Set<EffectType>(['splatter', '3d']);

/** The CSS filter functions: the effects a canvas can draw through `ctx.filter`. */
export const CSS_EFFECT_TYPES: readonly EffectType[] = EFFECT_TYPES.slice(0, 10);

/** Effects whose amount is a share, from 0 to 1. */
const SHARES = new Set<EffectType>(['grayscale', 'sepia', 'invert', 'opacity']);

/** Effects whose amount is a factor, from 0 up. */
const FACTORS = new Set<EffectType>(['brightness', 'contrast', 'saturate']);

/**
 * A new effect of each appearance kind as Photoshop and Illustrator start one:
 * a shadow and a bevel's shade multiply (Stack Blend), a glow and a bevel's
 * light screen (Sheer Blend), each at 75%, lit from 120 degrees at 30. A
 * stored effect that leaves a field out reads it from here - but a
 * `drop-shadow` written before these fields existed reads as it always
 * painted: Normal, solid, unspread (see readEffect).
 */
export const EFFECT_DEFAULTS: { readonly [T in EffectType]: Readonly<EffectOf<T>> } = {
  blur: { type: 'blur', radius: 2 },
  brightness: { type: 'brightness', amount: 1 },
  contrast: { type: 'contrast', amount: 1 },
  saturate: { type: 'saturate', amount: 1 },
  grayscale: { type: 'grayscale', amount: 1 },
  sepia: { type: 'sepia', amount: 1 },
  invert: { type: 'invert', amount: 1 },
  'hue-rotate': { type: 'hue-rotate', angle: 0 },
  opacity: { type: 'opacity', amount: 1 },
  'drop-shadow': { type: 'drop-shadow', dx: 7, dy: 7, blur: 5, color: '#000000', opacity: 0.75, blend: 'stack' },
  feather: { type: 'feather', radius: 5 },
  bevel: {
    type: 'bevel',
    style: 'inner',
    depth: 100,
    direction: 'up',
    size: 5,
    soften: 0,
    angle: 120,
    altitude: 30,
    highlight: { color: '#ffffff', blend: 'sheer', opacity: 0.75 },
    shadow: { color: '#000000', blend: 'stack', opacity: 0.75 },
  },
  emboss: {
    type: 'emboss',
    style: 'emboss',
    depth: 100,
    direction: 'up',
    size: 5,
    soften: 0,
    angle: 120,
    altitude: 30,
    highlight: { color: '#ffffff', blend: 'sheer', opacity: 0.75 },
    shadow: { color: '#000000', blend: 'stack', opacity: 0.75 },
  },
  // Photoshop's angle of 120 degrees at a distance of 5: down and to the right.
  'inner-shadow': { type: 'inner-shadow', dx: 2.5, dy: 4.33, blur: 5, choke: 0, color: '#000000', blend: 'stack', opacity: 0.75 },
  'outer-glow': { type: 'outer-glow', blur: 7, spread: 0, color: '#ffffbe', blend: 'sheer', opacity: 0.75 },
  'inner-glow': { type: 'inner-glow', blur: 7, choke: 0, source: 'edge', color: '#ffffbe', blend: 'sheer', opacity: 0.75 },
  // A vector editor's Default Scribble; the seed is this app's, so a hatch draws the same every time.
  splatter: { type: 'splatter', ...SPLATTER_PRESETS.default, seed: 1 },
  // A vector editor's Warp Options as they open: Arc, horizontal, bent 50%.
  warp: { type: 'warp', style: 'arc', orientation: 'horizontal', bend: 50, distortH: 0, distortV: 0, part: 'whole' },
  // A vector editor's Classic Extrude & Bevel as it opens: Off-Axis Front, 50 deep, capped, Plastic Shading.
  '3d': {
    type: '3d',
    kind: 'extrude',
    depth: 50,
    caps: true,
    angle: 360,
    offset: 0,
    axis: 'left',
    rotation: [-18, -26, 8],
    position: [0, 0, 0],
    scale: [1, 1, 1],
    perspective: 0,
    shading: 'plastic',
    light: { azimuth: 135, elevation: 50, intensity: 0.6, ambient: 0.4 },
    segments: 0,
  },
};

/** A fresh effect of a type, as {@link EFFECT_DEFAULTS} starts it: the shades copied, so changing one changes nothing else. */
export function defaultEffect<T extends EffectType>(type: T): EffectOf<T> {
  return JSON.parse(JSON.stringify(EFFECT_DEFAULTS[type])) as EffectOf<T>;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/**
 * A number field: the default when it is absent, null when it is there but no
 * number, otherwise held to `lo`..`hi`. A length below `lo` is no length at
 * all, as it is not in CSS: `strict` says so by giving null instead of holding it.
 */
function readNumber(value: unknown, fallback: number, lo: number, hi: number, strict = false): number | null {
  if (value === undefined) return fallback;
  if (!finite(value)) return null;
  if (strict && value < lo) return null;
  return clamp(value, lo, hi);
}

/** A color field: the default when absent, null when it is not a string with something in it. */
function readColorField(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A blend field: any name of a mode (core/blend.ts), the default when absent or unknown. */
function readBlendField(value: unknown, fallback: BlendModeId): BlendModeId {
  return blendModeOf(value) ?? fallback;
}

/** One of a few words: the default when absent or not one of them. */
function readWord<W extends string>(value: unknown, words: readonly W[], fallback: W): W {
  return words.includes(value as W) ? (value as W) : fallback;
}

/** Three numbers, as a 3D effect's turn, place and scale: the default when absent, null when not three finite numbers. */
function readTriple(value: unknown, fallback: readonly [number, number, number], lo: number, hi: number): [number, number, number] | undefined {
  if (value === undefined) return [fallback[0], fallback[1], fallback[2]];
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) return undefined;
  return value.map((v) => clamp(v as number, lo, hi)) as [number, number, number];
}

/** A 3D effect's light, from what a file holds: its defaults for what it leaves out. */
function readLight(raw: unknown, fallback: ThreeDLight): ThreeDLight | undefined {
  if (raw === undefined) return { ...fallback };
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const azimuth = readNumber(r.azimuth, fallback.azimuth, -360, 360);
  const elevation = readNumber(r.elevation, fallback.elevation, -90, 90);
  const intensity = readNumber(r.intensity, fallback.intensity, 0, 1);
  const ambient = readNumber(r.ambient, fallback.ambient, 0, 1);
  if (azimuth === null || elevation === null || intensity === null || ambient === null) return undefined;
  return { azimuth, elevation, intensity, ambient };
}

/** A bevel's or an emboss's light or shade, from what a file holds. */
function readShade(raw: unknown, fallback: EffectShade): EffectShade | null {
  if (raw === undefined) return { ...fallback };
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const color = readColorField(r.color, fallback.color);
  const opacity = readNumber(r.opacity, fallback.opacity, 0, 1);
  if (color === null || opacity === null) return null;
  return { color, blend: readBlendField(r.blend, fallback.blend), opacity };
}

/** What every effect carries beside its own fields, as a file keeps it: only what is not the default. */
function readCommon(r: Record<string, unknown>): EffectCommon {
  return {
    ...(r.target === 'fill' || r.target === 'stroke' ? { target: r.target } : {}),
    ...(r.on === false ? { on: false } : {}),
  };
}

/**
 * Reads one effect: its type known, its numbers finite and in range. A share
 * is held to 0 to 1, as CSS clamps it; a negative factor or length is not an
 * effect at all, as it is not in CSS, and neither is a color that is not a
 * string. An appearance effect's missing fields are its defaults
 * ({@link EFFECT_DEFAULTS}), but a `drop-shadow` without a spread, an opacity
 * or a blend is the CSS shadow it always was. Anything else a stored effect
 * carries is left behind.
 */
export function readEffect(raw: unknown): Effect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as EffectType;
  if (!EFFECT_TYPES.includes(type)) return null;
  const effect = readOwn(type, r);
  return effect ? ({ ...effect, ...readCommon(r) } as Effect) : null;
}

/** An effect's own fields, before its target and its switch. */
function readOwn(type: EffectType, r: Record<string, unknown>): Effect | null {
  switch (type) {
    case 'blur':
      return finite(r.radius) && r.radius >= 0 ? { type, radius: r.radius } : null;
    case 'hue-rotate':
      return finite(r.angle) ? { type, angle: r.angle } : null;
    case 'drop-shadow': {
      if (!finite(r.dx) || !finite(r.dy)) return null;
      const blur = readNumber(r.blur, 0, 0, Infinity, true);
      const color = readColorField(r.color, '#000000');
      const spread = readNumber(r.spread, 0, 0, 100);
      const opacity = readNumber(r.opacity, 1, 0, 1);
      if (blur === null || color === null || spread === null || opacity === null) return null;
      const blend = blendModeOf(r.blend);
      return {
        type,
        dx: r.dx,
        dy: r.dy,
        blur,
        color,
        ...(spread > 0 ? { spread } : {}),
        ...(opacity < 1 ? { opacity } : {}),
        ...(isBlended(blend) ? { blend } : {}),
      };
    }
    case 'feather': {
      const radius = readNumber(r.radius, EFFECT_DEFAULTS.feather.radius, 0, Infinity, true);
      return radius === null ? null : { type, radius };
    }
    case 'bevel':
    case 'emboss': {
      const d = EFFECT_DEFAULTS[type];
      const depth = readNumber(r.depth, d.depth, 1, 1000);
      const size = readNumber(r.size, d.size, 0, Infinity, true);
      const soften = readNumber(r.soften, d.soften, 0, Infinity, true);
      const angle = readNumber(r.angle, d.angle, -Infinity, Infinity);
      const altitude = readNumber(r.altitude, d.altitude, 0, 90);
      const highlight = readShade(r.highlight, d.highlight);
      const shadow = readShade(r.shadow, d.shadow);
      if (depth === null || size === null || soften === null || angle === null || altitude === null || !highlight || !shadow) return null;
      const relief = {
        depth,
        direction: readWord(r.direction, ['up', 'down'] as const, d.direction),
        size,
        soften,
        angle: ((angle % 360) + 360) % 360,
        altitude,
        highlight,
        shadow,
      };
      return type === 'bevel'
        ? { type, style: readWord(r.style, ['inner', 'outer'] as const, 'inner'), ...relief }
        : { type, style: readWord(r.style, ['emboss', 'pillow'] as const, 'emboss'), ...relief };
    }
    case 'inner-shadow': {
      const d = EFFECT_DEFAULTS['inner-shadow'];
      const dx = readNumber(r.dx, d.dx, -Infinity, Infinity);
      const dy = readNumber(r.dy, d.dy, -Infinity, Infinity);
      const blur = readNumber(r.blur, d.blur, 0, Infinity, true);
      const choke = readNumber(r.choke, d.choke, 0, 100);
      const color = readColorField(r.color, d.color);
      const opacity = readNumber(r.opacity, d.opacity, 0, 1);
      if (dx === null || dy === null || blur === null || choke === null || color === null || opacity === null) return null;
      return { type, dx, dy, blur, choke, color, blend: readBlendField(r.blend, d.blend), opacity };
    }
    case 'outer-glow': {
      const d = EFFECT_DEFAULTS['outer-glow'];
      const blur = readNumber(r.blur, d.blur, 0, Infinity, true);
      const spread = readNumber(r.spread, d.spread, 0, 100);
      const color = readColorField(r.color, d.color);
      const opacity = readNumber(r.opacity, d.opacity, 0, 1);
      if (blur === null || spread === null || color === null || opacity === null) return null;
      return { type, blur, spread, color, blend: readBlendField(r.blend, d.blend), opacity };
    }
    case 'inner-glow': {
      const d = EFFECT_DEFAULTS['inner-glow'];
      const blur = readNumber(r.blur, d.blur, 0, Infinity, true);
      const choke = readNumber(r.choke, d.choke, 0, 100);
      const color = readColorField(r.color, d.color);
      const opacity = readNumber(r.opacity, d.opacity, 0, 1);
      if (blur === null || choke === null || color === null || opacity === null) return null;
      return {
        type,
        blur,
        choke,
        source: readWord(r.source, ['edge', 'center'] as const, d.source),
        color,
        blend: readBlendField(r.blend, d.blend),
        opacity,
      };
    }
    case 'splatter': {
      const d = EFFECT_DEFAULTS.splatter;
      const angle = readNumber(r.angle, d.angle, -Infinity, Infinity);
      const overlap = readNumber(r.overlap, d.overlap, -1000, 1000);
      const overlapVariation = readNumber(r.overlapVariation, d.overlapVariation, 0, 1000);
      const width = readNumber(r.width, d.width, 0.01, 1000, true);
      const curviness = readNumber(r.curviness, d.curviness, 0, 100);
      const curvinessVariation = readNumber(r.curvinessVariation, d.curvinessVariation, 0, 100);
      const spacing = readNumber(r.spacing, d.spacing, 0.1, 10000, true);
      const spacingVariation = readNumber(r.spacingVariation, d.spacingVariation, 0, 10000);
      const seed = readNumber(r.seed, d.seed, 0, 2 ** 31 - 1);
      if (
        angle === null ||
        overlap === null ||
        overlapVariation === null ||
        width === null ||
        curviness === null ||
        curvinessVariation === null ||
        spacing === null ||
        spacingVariation === null ||
        seed === null
      ) {
        return null;
      }
      // The angle as a vector editor shows it: past -180, up to 180.
      const turned = ((((angle + 180) % 360) + 360) % 360) - 180;
      return {
        type,
        angle: turned === -180 ? 180 : turned,
        overlap,
        overlapVariation,
        width,
        curviness,
        curvinessVariation,
        spacing,
        spacingVariation,
        seed: Math.trunc(seed),
      };
    }
    case 'warp': {
      const d = EFFECT_DEFAULTS.warp;
      // A style by this app's name or a vector editor's; Arc Lower and the like name their part.
      const named = r.style === undefined ? { style: d.style } : warpStyleOf(r.style);
      const bend = readNumber(r.bend, d.bend, -100, 100);
      const distortH = readNumber(r.distortH, d.distortH, -100, 100);
      const distortV = readNumber(r.distortV, d.distortV, -100, 100);
      if (!named || bend === null || distortH === null || distortV === null) return null;
      const orientation = readWord(r.orientation, ['horizontal', 'vertical'] as const, d.orientation);
      const part = warpPartFor(named.style, readWord(r.part, WARP_PARTS, named.part ?? d.part));
      return { type, style: named.style, orientation, bend, distortH, distortV, part };
    }
    case '3d': {
      const d = EFFECT_DEFAULTS['3d'];
      const depth = readNumber(r.depth, d.depth, 0, 10000);
      const angle = readNumber(r.angle, d.angle, 0, 360);
      const offset = readNumber(r.offset, d.offset, -10000, 10000);
      const perspective = readNumber(r.perspective, d.perspective, 0, 160);
      const segments = readNumber(r.segments, d.segments, 0, 256);
      // Each turn held to -180 to 180, as a vector editor shows it; one in range
      // is kept exactly, since the sum would leave a binary fraction's tail.
      const rotation = readTriple(r.rotation, d.rotation, -Infinity, Infinity)?.map((a) => {
        if (a > -180 && a <= 180) return a;
        const turned = ((((a + 180) % 360) + 360) % 360) - 180;
        return turned === -180 ? 180 : turned;
      }) as [number, number, number] | undefined;
      const position = readTriple(r.position, d.position, -100000, 100000);
      const scale = readTriple(r.scale, d.scale, 0.01, 100);
      const light = readLight(r.light, d.light);
      if (depth === null || angle === null || offset === null || perspective === null || segments === null || !rotation || !position || !scale || !light) return null;
      return {
        type,
        kind: readWord(r.kind, ['extrude', 'revolve'] as const, d.kind),
        depth,
        caps: r.caps === false ? false : d.caps,
        angle,
        offset,
        axis: readWord(r.axis, ['left', 'right'] as const, d.axis),
        rotation,
        position,
        scale,
        perspective,
        shading: readWord(r.shading, ['plastic', 'diffuse', 'none', 'wireframe'] as const, d.shading),
        light,
        segments: Math.round(segments),
      };
    }
    default: {
      const amount = r.amount === undefined ? 1 : r.amount;
      if (!finite(amount)) return null;
      if (SHARES.has(type)) return { type: type as AmountEffectType, amount: Math.min(1, Math.max(0, amount)) };
      if (FACTORS.has(type) && amount >= 0) return { type: type as AmountEffectType, amount };
      return null;
    }
  }
}

/**
 * Reads an effect list, keeping the effects that read and dropping the rest.
 * Gives `undefined` when nothing is left, so a mark or a layer without
 * effects carries no field at all. An effect switched off is kept: it is
 * still the carrier's, to switch back on.
 */
export function readEffects(raw: unknown): Effect[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const effects = raw.map(readEffect).filter((effect): effect is Effect => effect !== null);
  return effects.length > 0 ? effects : undefined;
}

/**
 * The raster effects of a list that draw: read as {@link readEffects} reads
 * them, less the ones switched off and less the geometry effects, which
 * change what a mark draws before any picture is made
 * ({@link activeGeometryEffects}). `undefined` when none draws, so "has
 * effects" means "has effects that show on its picture". Every raster path
 * reads this.
 */
export function activeEffects(raw: unknown): Effect[] | undefined {
  const effects = readEffects(raw)?.filter((effect) => effect.on !== false && !GEOMETRY_EFFECT_TYPES.has(effect.type));
  return effects && effects.length > 0 ? effects : undefined;
}

/** The geometry effects of a list that draw, in their order: Splatter, Warp and 3D. `undefined` when none does. */
export function activeGeometryEffects(raw: unknown): Effect[] | undefined {
  const effects = readEffects(raw)?.filter((effect) => effect.on !== false && GEOMETRY_EFFECT_TYPES.has(effect.type));
  return effects && effects.length > 0 ? effects : undefined;
}

/** Whether an effect is one of the CSS filter functions as CSS has it, so a canvas can draw it through `ctx.filter`. */
export function isCssEffect(effect: Effect): boolean {
  if (!CSS_EFFECT_TYPES.includes(effect.type)) return false;
  // A spread is a step no CSS function takes; an opacity rides in the color,
  // and a blend inside a picture mixes with nothing under it.
  return effect.type !== 'drop-shadow' || !(effect.spread && effect.spread > 0);
}

/**
 * How far past the ink an effect list can reach, in its own units: three
 * standard deviations for each blur, which is where a Gaussian's last visible
 * tail ends, a shadow's offset and its blur, a glow's blur, and a bevel's
 * size and its softening. An inner shadow, an inner glow and a feather paint
 * nothing outside, but read that far around the shape - a filter region that
 * cut their blur short would lose its tail - so they count too. A list
 * reaches as far as its effects together, since each works on what the one
 * before it made. An effect switched off reaches nowhere.
 */
export function effectReach(effects: readonly Effect[]): number {
  let reach = 0;
  for (const effect of effects) {
    if (effect.on === false) continue;
    switch (effect.type) {
      case 'blur':
        reach += 3 * effect.radius;
        break;
      case 'drop-shadow':
      case 'inner-shadow':
        reach += Math.max(Math.abs(effect.dx), Math.abs(effect.dy)) + 1.5 * effect.blur;
        break;
      case 'outer-glow':
      case 'inner-glow':
        reach += 1.5 * effect.blur;
        break;
      case 'feather':
        // Its blur paints nothing outside, but reads that far around the edge.
        reach += 1.5 * effect.radius;
        break;
      case 'bevel':
      case 'emboss':
        reach += 1.5 * effect.size + 1.5 * effect.soften;
        break;
      default:
        break;
    }
  }
  return reach;
}

/**
 * How far past the ink what an effect list paints reaches: the reach Use
 * Preview Bounds counts in a mark's bounds. Unlike {@link effectReach}, an
 * effect that paints nothing outside the shape - an inner shadow, an inner
 * glow, a feather, an inner bevel - adds nothing, whatever it reads.
 */
export function effectPaintReach(effects: readonly Effect[]): number {
  let reach = 0;
  for (const effect of effects) {
    if (effect.on === false) continue;
    switch (effect.type) {
      case 'blur':
        reach += 3 * effect.radius;
        break;
      case 'drop-shadow':
        reach += Math.max(Math.abs(effect.dx), Math.abs(effect.dy)) + 1.5 * effect.blur;
        break;
      case 'outer-glow':
        reach += 1.5 * effect.blur;
        break;
      case 'bevel':
      case 'emboss':
        if (effect.style !== 'inner') reach += 1.5 * effect.size + 1.5 * effect.soften;
        break;
      default:
        break;
    }
  }
  return reach;
}

/** The list with every length multiplied by `scale`: how effects follow their mark when it is resized. */
export function scaleEffects(effects: readonly Effect[], scale: number): Effect[] {
  return effects.map((effect): Effect => {
    switch (effect.type) {
      case 'blur':
      case 'feather':
        return { ...effect, radius: effect.radius * scale };
      case 'drop-shadow':
      case 'inner-shadow':
        return { ...effect, dx: effect.dx * scale, dy: effect.dy * scale, blur: effect.blur * scale };
      case 'outer-glow':
      case 'inner-glow':
        return { ...effect, blur: effect.blur * scale };
      case 'bevel':
      case 'emboss':
        return { ...effect, size: effect.size * scale, soften: effect.soften * scale, highlight: { ...effect.highlight }, shadow: { ...effect.shadow } };
      case 'splatter':
        return {
          ...effect,
          overlap: effect.overlap * scale,
          overlapVariation: effect.overlapVariation * scale,
          width: effect.width * scale,
          spacing: effect.spacing * scale,
          spacingVariation: effect.spacingVariation * scale,
        };
      case '3d':
        // Its lengths: the depth, the axis's offset and how far it is moved.
        return {
          ...effect,
          depth: effect.depth * scale,
          offset: effect.offset * scale,
          position: [effect.position[0] * scale, effect.position[1] * scale, effect.position[2] * scale],
          rotation: [...effect.rotation],
          scale: [...effect.scale],
          light: { ...effect.light },
        };
      default:
        return { ...effect };
    }
  });
}

/** Hue rotation, as the matrix `feColorMatrix type="hueRotate"` is defined by. */
function hueMatrix(degrees: number): number[] {
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/**
 * The color matrix an effect is defined by: four rows of red, green, blue,
 * alpha and a constant, applied to straight color in 0 to 1 and clamped
 * there. Every color effect is one; the others give null. Brightness,
 * contrast, invert and opacity are component transfers in the specification,
 * and each is a straight line, so the matrix is the same arithmetic.
 */
export function colorMatrix(effect: Effect): number[] | null {
  switch (effect.type) {
    case 'brightness': {
      const a = effect.amount;
      return [a, 0, 0, 0, 0, 0, a, 0, 0, 0, 0, 0, a, 0, 0, 0, 0, 0, 1, 0];
    }
    case 'contrast': {
      const a = effect.amount;
      const c = 0.5 - 0.5 * a;
      return [a, 0, 0, 0, c, 0, a, 0, 0, c, 0, 0, a, 0, c, 0, 0, 0, 1, 0];
    }
    case 'saturate': {
      const s = effect.amount;
      return [
        0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
        0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
        0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
        0, 0, 0, 1, 0,
      ];
    }
    case 'grayscale': {
      const k = 1 - effect.amount;
      return [
        0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0, 0,
        0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0, 0,
        0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k, 0, 0,
        0, 0, 0, 1, 0,
      ];
    }
    case 'sepia': {
      const k = 1 - effect.amount;
      return [
        0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0, 0,
        0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0, 0,
        0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k, 0, 0,
        0, 0, 0, 1, 0,
      ];
    }
    case 'invert': {
      const a = effect.amount;
      const k = 1 - 2 * a;
      return [k, 0, 0, 0, a, 0, k, 0, 0, a, 0, 0, k, 0, a, 0, 0, 0, 1, 0];
    }
    case 'hue-rotate':
      return hueMatrix(effect.angle);
    case 'opacity': {
      const a = effect.amount;
      return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, a, 0];
    }
    default:
      return null;
  }
}

/** A shadow color, read: null for one no output can paint. */
export function shadowColor(color: string): Rgba | null {
  try {
    return parseColor(color);
  } catch {
    return null;
  }
}

// ---- The appearance effects' shared numbers ------------------------------------------
//
// The SVG writer and the pixel engine (appearance-fx.ts) both read these, so
// a filter in a file and a picture on the canvas are the same graph.

/**
 * The levels step a spread or a choke makes on a blurred matte: the matte
 * divided by what is left of it, held to 1, as Photoshop's Spread and Choke
 * firm an edge. 0 changes nothing; 100 makes every touched pixel solid.
 */
export function matteSlope(percent: number): number {
  const p = clamp(percent, 0, 100) / 100;
  return p >= 1 ? 255 : 1 / (1 - p);
}

/**
 * How a bevel's or an emboss's height is drawn from the picture: its alpha
 * blurred by `sigma` (in the carrier's units), then put through a straight
 * line (`slope`, `intercept`) or a `table`, as `feComponentTransfer` puts an
 * alpha through one.
 *
 * - **Inner bevel**: 0 at the edge, rising to the full height `size` inside.
 * - **Outer bevel**: the full height at the edge and inside, falling to 0
 *   `size` outside.
 * - **Emboss**: halfway at the edge, rising across `size` from outside to inside.
 * - **Pillow emboss**: 0 at the edge, rising `size` away from it either side.
 */
export function reliefHeight(effect: ReliefEffect): { sigma: number; slope?: number; intercept?: number; table?: number[] } {
  switch (effect.style) {
    case 'inner':
      return { sigma: effect.size / 2, slope: 2, intercept: -1 };
    case 'outer':
      return { sigma: effect.size / 2, slope: 2, intercept: 0 };
    case 'emboss':
      return { sigma: effect.size / 4 };
    case 'pillow':
      return { sigma: effect.size / 2, table: [1, 0, 1] };
  }
}

/**
 * The height a bevel's alpha is scaled by for `feDiffuseLighting`'s
 * `surfaceScale`, in the carrier's units: half its size at a depth of 100%,
 * which tilts the steepest part of the slope about 58 degrees.
 */
export function reliefSurfaceScale(effect: ReliefEffect): number {
  return (effect.size * effect.depth) / 200;
}

/**
 * The light, as `feDistantLight` takes it: SVG's azimuth turns clockwise from
 * the x axis, which points down the page, so Photoshop's angle (counter-
 * clockwise) is turned the other way; pressing the shape in (`down`) swings
 * the light round. The elevation is held off flat and off straight down,
 * where the light or the shade would have nothing to tell apart.
 */
export function reliefLight(effect: ReliefEffect): { azimuth: number; elevation: number } {
  const azimuth = (((effect.direction === 'down' ? 180 : 0) - effect.angle) % 360 + 360) % 360;
  return { azimuth, elevation: clamp(effect.altitude, 0.5, 89.5) };
}

/**
 * How the diffuse light's gray (N.L) becomes the light's and the shade's
 * alpha: a flat surface reads sin(elevation), so whatever is brighter than
 * that is the light, scaled to reach 1 when the surface faces the light, and
 * whatever is darker is the shade, reaching 1 when it faces away.
 */
export function reliefMasks(elevation: number): { highlight: { k: number; c: number }; shadow: { k: number; c: number } } {
  const flat = Math.sin((elevation * Math.PI) / 180);
  return {
    highlight: { k: 1 / (1 - flat), c: -flat / (1 - flat) },
    shadow: { k: -1 / flat, c: 1 },
  };
}

// ---- Parts and layers -----------------------------------------------------------------

/** A mark's effects by what they work on: its fill, its stroke, and the whole mark - each in order, switched-off ones left out. */
export interface EffectParts {
  fill: Effect[];
  stroke: Effect[];
  object: Effect[];
}

/** Sorts an effect list by its targets. On a layer or a group, `object` is all there is. */
export function effectParts(effects: readonly Effect[]): EffectParts {
  const parts: EffectParts = { fill: [], stroke: [], object: [] };
  for (const effect of effects) {
    if (effect.on === false) continue;
    parts[effect.target === 'fill' ? 'fill' : effect.target === 'stroke' ? 'stroke' : 'object'].push(effect);
  }
  return parts;
}

/** Which parts a mark has to aim an effect at: text has a fill (its ink); a stroke, its line; a filled shape, both; an image, neither. */
export interface MarkParts {
  fill: boolean;
  stroke: boolean;
}

/**
 * How a carrier draws its effects. A mark with both parts and effects aimed at
 * either `split`s: its fill and its stroke each draw as a picture of their own
 * through their own effects, the stroke over the fill, and the `object`
 * effects then work on the two together. Otherwise there is one chain: a mark
 * with only one part takes that part's effects first, then the whole mark's,
 * which come to the same thing; an effect aimed at a part it does not have
 * draws nothing. A layer or a group (`parts` null) has no parts, so every
 * effect on it works on its whole picture, whatever it is aimed at.
 */
export interface EffectPlan {
  split: boolean;
  fill: Effect[];
  stroke: Effect[];
  object: Effect[];
}

/** Works out {@link EffectPlan} for an effect list on a carrier with `parts`, or on a layer or a group. */
export function effectPlan(effects: readonly Effect[], parts: MarkParts | null): EffectPlan {
  const sorted = effectParts(effects);
  if (!parts) return { split: false, fill: [], stroke: [], object: effects.filter((effect) => effect.on !== false) };
  if (parts.fill && parts.stroke && (sorted.fill.length > 0 || sorted.stroke.length > 0)) return { split: true, ...sorted };
  return {
    split: false,
    fill: [],
    stroke: [],
    object: [...(parts.fill ? sorted.fill : []), ...(parts.stroke ? sorted.stroke : []), ...sorted.object],
  };
}

/** An effect list with its aims taken off, for a picture that has no parts of its own to aim at. */
export function untargeted(effects: readonly Effect[]): Effect[] {
  return effects.map((effect) => {
    if (effect.target === undefined) return effect;
    const { target: _aim, ...rest } = effect;
    return rest as Effect;
  });
}

/** Whether an effect is cast outside the picture, under it: Outer Shadow or Outer Glow. */
export function isOuterEffect(effect: Effect): effect is EffectOf<'drop-shadow'> | EffectOf<'outer-glow'> {
  return effect.type === 'drop-shadow' || effect.type === 'outer-glow';
}

/** The blend an effect mixes by: a shadow's or a glow's own, Normal for everything else. */
export function effectBlend(effect: Effect): BlendModeId {
  return (effect.type === 'drop-shadow' || effect.type === 'outer-glow' || effect.type === 'inner-shadow' || effect.type === 'inner-glow') && effect.blend
    ? effect.blend
    : 'normal';
}

/**
 * How an effect list is laid down: the effects that run on the picture itself
 * (`chain`), and the Outer Shadows and Outer Glows laid under it on their own
 * (`unders`), each mixing by its blend with what is under the picture, as a
 * vector editor's shadow multiplies into the page under its object.
 *
 * Only the run at the end of the list can go under: an effect after a shadow
 * works on the shadow too, so the shadow is part of the picture. In that run,
 * the effects from the first that blends by anything but Normal on go under,
 * in order; a Normal one before them stays in the picture, which looks the
 * same and costs nothing. `separate` false - a carrier laid down by a blend
 * of its own, or through a clip or an eraser that must cut its shadow too -
 * keeps them all in the picture, where a blend has nothing under it to mix
 * with.
 */
export function effectLayout(effects: readonly Effect[], separate = true): { chain: Effect[]; unders: Effect[] } {
  const active = effects.filter((effect) => effect.on !== false);
  if (!separate) return { chain: active, unders: [] };
  let start = active.length;
  while (start > 0 && isOuterEffect(active[start - 1])) start--;
  let first = -1;
  for (let k = start; k < active.length; k++) {
    if (isBlended(effectBlend(active[k]))) {
      first = k;
      break;
    }
  }
  if (first < 0) return { chain: active, unders: [] };
  return { chain: active.slice(0, first), unders: active.slice(first) };
}

/** Whether a list lays anything under its carrier by a blend (see effectLayout). */
export function hasUnders(effects: readonly Effect[] | undefined): boolean {
  return effects !== undefined && effectLayout(effects).unders.length > 0;
}

/** A number for a CSS or SVG value: six decimals at most, and no trailing zeros. */
function num(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/** The linear part of a transform, as a `DOMMatrix` names it: device pixels for one unit across and down. */
export interface LinearTransform {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** A color with its alpha multiplied by `opacity`, as CSS writes it: null for one no output can paint. */
function fadedColor(color: string, opacity: number): string | null {
  if (opacity >= 1) return color;
  const rgba = shadowColor(color);
  if (!rgba) return null;
  return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${num(rgba.a * opacity)})`;
}

/**
 * The list as a CSS `filter` value, for a 2D canvas. A canvas works a
 * filter in device pixels whatever its transform, so the transform the list
 * is drawn under is applied here: its scale sizes every blur and shadow, and
 * its turn carries a shadow's offset, as it does in SVG. A context's own
 * `getTransform()` will do. `maxBlurPx` holds every blur, a shadow's
 * included, to that many device pixels: a painter that paints only so far past
 * its canvas gives it, so a blur never gathers from beyond what was painted.
 *
 * Only the CSS filter functions are written ({@link isCssEffect}): an effect
 * switched off, or one no CSS function draws, is left out, so a caller sends
 * a list with those to the pixel engine instead (appearance-fx.ts).
 */
export function cssFilter(
  effects: readonly Effect[],
  transform: LinearTransform = { a: 1, b: 0, c: 0, d: 1 },
  maxBlurPx = Infinity,
): string {
  const { a, b, c, d } = transform;
  const scale = Math.sqrt(Math.abs(a * d - b * c)) || 1;
  const blur = (length: number): number => Math.min(length * scale, maxBlurPx);
  return effects
    .filter((effect) => effect.on !== false && isCssEffect(effect))
    .map((effect) => {
      switch (effect.type) {
        case 'blur':
          return `blur(${num(blur(effect.radius))}px)`;
        case 'hue-rotate':
          return `hue-rotate(${num(effect.angle)}deg)`;
        case 'drop-shadow': {
          const dx = a * effect.dx + c * effect.dy;
          const dy = b * effect.dx + d * effect.dy;
          const color = fadedColor(effect.color, effect.opacity ?? 1);
          return color === null ? '' : `drop-shadow(${num(dx)}px ${num(dy)}px ${num(blur(effect.blur))}px ${color})`;
        }
        default:
          return 'amount' in effect ? `${effect.type}(${num(effect.amount)})` : '';
      }
    })
    .filter((part) => part !== '')
    .join(' ');
}

/** The box a filter works in, in the user units of whatever it is applied to. */
export interface FilterRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A bounding box grown by an effect list's reach, and a pixel more, as the region its filter works in. */
export function filterRegion(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  effects: readonly Effect[],
): FilterRegion {
  const grow = effectReach(effects) + 1;
  return {
    x: box.minX - grow,
    y: box.minY - grow,
    width: box.maxX - box.minX + 2 * grow,
    height: box.maxY - box.minY + 2 * grow,
  };
}

// ---- The SVG filter graphs ------------------------------------------------------------

/** A color as `feFlood` takes it: a hex color and its opacity, times `opacity`. Null for one no output can paint. */
function floodAttrs(color: string, opacity: number): string | null {
  const rgba = shadowColor(color);
  if (!rgba) return null;
  const hex = `#${[rgba.r, rgba.g, rgba.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  return `flood-color="${hex}" flood-opacity="${num(rgba.a * opacity)}"`;
}

/**
 * Writes filter primitives. Each effect's are named after the filter and the
 * effect's place in it - `effect-1-0` - which is what the effect's last
 * primitive gives, so the next effect reads it by that name; what comes
 * before it in the effect is that name and what it is: `effect-1-0-blur`.
 */
class FilterGraph {
  readonly parts: string[] = [];
  private prefix = '';
  private used = new Set<string>();
  /** Where the current effect's primitives start. */
  private start = 0;

  constructor(private readonly id: string) {}

  /** Starts the `k`th effect's primitives. */
  begin(k: number | string): void {
    this.prefix = `${this.id}-${k}`;
    this.used = new Set();
    this.start = this.parts.length;
  }

  /**
   * Ends the current effect, whose primitives read `before` and gave
   * `output`: its last primitive, which gave `output`, takes the effect's own
   * name, and that name is given. An effect that came to nothing - `output`
   * is `before` - takes back what it wrote and gives `before`.
   */
  end(before: string, output: string): string {
    if (output === before || this.parts.length === this.start) {
      this.parts.length = this.start;
      return before;
    }
    const last = this.parts.length - 1;
    this.parts[last] = this.parts[last].replace(/ result="[^"]*"/, ` result="${this.prefix}"`);
    return this.prefix;
  }

  /** A fresh result name: the effect's name and what it is, numbered when it is the second of its kind. */
  name(what: string): string {
    let name = `${this.prefix}-${what}`;
    for (let n = 2; this.used.has(name); n++) name = `${this.prefix}-${what}${n}`;
    this.used.add(name);
    return name;
  }

  /** Writes a primitive whose markup ends in `result="..."` for a fresh name, and gives the name. */
  add(what: string, markup: (result: string) => string): string {
    const result = this.name(what);
    this.parts.push(markup(result));
    return result;
  }

  /** A Gaussian blur of `input`, or `input` itself when the deviation is none: some viewers leave a zero blur empty. */
  blur(input: string, sigma: number): string {
    if (!(sigma > 0)) return input;
    return this.add('blur', (r) => `<feGaussianBlur in="${input}" stdDeviation="${num(sigma)}" result="${r}"/>`);
  }

  /** `input`'s alpha put through a straight line, held to 0 to 1. */
  linearAlpha(input: string, slope: number, intercept: number): string {
    if (slope === 1 && intercept === 0) return input;
    return this.add(
      'levels',
      (r) => `<feComponentTransfer in="${input}" result="${r}"><feFuncA type="linear" slope="${num(slope)}" intercept="${num(intercept)}"/></feComponentTransfer>`,
    );
  }

  /** `input`'s alpha put through a table, as `feComponentTransfer` reads one. */
  tableAlpha(input: string, table: readonly number[]): string {
    return this.add(
      'table',
      (r) => `<feComponentTransfer in="${input}" result="${r}"><feFuncA type="table" tableValues="${table.map(num).join(' ')}"/></feComponentTransfer>`,
    );
  }

  offset(input: string, dx: number, dy: number): string {
    if (dx === 0 && dy === 0) return input;
    return this.add('offset', (r) => `<feOffset in="${input}" dx="${num(dx)}" dy="${num(dy)}" result="${r}"/>`);
  }

  /** A flood of a color, kept where `matte` is, at its alpha: a colored matte, named `what`. */
  colored(matte: string, flood: string, what = 'shadow'): string {
    const color = this.add('color', (r) => `<feFlood ${flood} result="${r}"/>`);
    return this.composite(color, matte, 'in', what);
  }

  composite(input: string, input2: string, operator: 'in' | 'out' | 'over', what: string = operator): string {
    return this.add(what, (r) => `<feComposite in="${input}" in2="${input2}" operator="${operator}" result="${r}"/>`);
  }

  /** `top` laid over `bottom` by a blend mode, as `feBlend` composites them. */
  blend(top: string, bottom: string, mode: BlendModeId): string {
    return this.add('blend', (r) => `<feBlend in="${top}" in2="${bottom}" mode="${blendModeInfo(mode).css}" result="${r}"/>`);
  }

  /** `under` laid under `input`. */
  merge(under: string, input: string): string {
    return this.add('merge', (r) => `<feMerge result="${r}"><feMergeNode in="${under}"/><feMergeNode in="${input}"/></feMerge>`);
  }
}

/**
 * An Outer Shadow's or an Outer Glow's colored matte, cast from `input`'s
 * alpha: blurred, firmed by its spread, moved by its offset, in its color at
 * its opacity. Null for a color no output can paint.
 */
function outerLayer(graph: FilterGraph, effect: EffectOf<'drop-shadow'> | EffectOf<'outer-glow'>, input: string): string | null {
  const flood = floodAttrs(effect.color, effect.opacity ?? 1);
  if (!flood) return null;
  let matte = graph.blur(input, effect.blur / 2);
  matte = graph.linearAlpha(matte, matteSlope(effect.spread ?? 0), 0);
  if (effect.type === 'drop-shadow') matte = graph.offset(matte, effect.dx, effect.dy);
  return graph.colored(matte, flood, effect.type === 'drop-shadow' ? 'shadow' : 'glow');
}

/** Writes one effect's primitives over `input`, giving the result the next effect reads; `input` itself when it draws nothing. */
function writeEffect(graph: FilterGraph, effect: Effect, input: string): string {
  const matrix = colorMatrix(effect);
  if (matrix) {
    return graph.add('matrix', (r) => `<feColorMatrix in="${input}" type="matrix" values="${matrix.map(num).join(' ')}" result="${r}"/>`);
  }
  switch (effect.type) {
    case 'blur':
      return graph.add('blur', (r) => `<feGaussianBlur in="${input}" stdDeviation="${num(effect.radius)}" result="${r}"/>`);
    case 'drop-shadow':
    case 'outer-glow': {
      // In the picture a shadow lies under it: there is nothing under it to mix with.
      const layer = outerLayer(graph, effect, input);
      return layer ? graph.merge(layer, input) : input;
    }
    case 'inner-shadow':
    case 'inner-glow': {
      const flood = floodAttrs(effect.color, effect.opacity);
      if (!flood) return input;
      // An edge's glow and a shadow come from outside the shape, so their
      // matte is the inverse of its alpha; a glow from the center comes from the alpha itself.
      const source = effect.type === 'inner-glow' && effect.source === 'center' ? input : graph.tableAlpha(input, [1, 0]);
      let matte = graph.blur(source, effect.blur / 2);
      matte = graph.linearAlpha(matte, matteSlope(effect.choke), 0);
      if (effect.type === 'inner-shadow') matte = graph.offset(matte, effect.dx, effect.dy);
      const inside = graph.composite(graph.colored(matte, flood, effect.type === 'inner-shadow' ? 'shadow' : 'glow'), input, 'in', 'inside');
      return graph.blend(inside, input, effect.blend);
    }
    case 'feather': {
      if (!(effect.radius > 0)) return input;
      const matte = graph.linearAlpha(graph.blur(input, effect.radius / 2), 2, -1);
      return graph.composite(input, matte, 'in');
    }
    case 'bevel':
    case 'emboss': {
      if (!(effect.size > 0)) return input;
      const height = reliefHeight(effect);
      let bump = graph.blur(input, height.sigma);
      if (height.table) bump = graph.tableAlpha(bump, height.table);
      else bump = graph.linearAlpha(bump, height.slope ?? 1, height.intercept ?? 0);
      const light = reliefLight(effect);
      const lit = graph.add(
        'light',
        (r) =>
          `<feDiffuseLighting in="${bump}" surfaceScale="${num(reliefSurfaceScale(effect))}" diffuseConstant="1" kernelUnitLength="1" lighting-color="#ffffff" result="${r}">` +
          `<feDistantLight azimuth="${num(light.azimuth)}" elevation="${num(light.elevation)}"/></feDiffuseLighting>`,
      );
      const masks = reliefMasks(light.elevation);
      let out = input;
      // The shade first, then the light over it, each kept to the inside of
      // an inner bevel and the outside of an outer one.
      for (const [shade, mask, what] of [
        [effect.shadow, masks.shadow, 'shade'],
        [effect.highlight, masks.highlight, 'light'],
      ] as const) {
        const flood = floodAttrs(shade.color, shade.opacity);
        if (!flood || shade.opacity <= 0) continue;
        let matte = graph.add(
          `${what}-mask`,
          (r) => `<feColorMatrix in="${lit}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${num(mask.k)} 0 0 0 ${num(mask.c)}" result="${r}"/>`,
        );
        matte = graph.blur(matte, effect.soften / 2);
        if (effect.style === 'inner') matte = graph.composite(matte, input, 'in', `${what}-inside`);
        else if (effect.style === 'outer') matte = graph.composite(matte, input, 'out', `${what}-outside`);
        out = graph.blend(graph.colored(matte, flood, what), out, shade.blend);
      }
      return out;
    }
    default:
      return input;
  }
}

/** The `<filter>` element around a graph. */
function filterElement(id: string, region: FilterRegion, format: (value: number) => string, parts: readonly string[]): string {
  const box = `x="${format(region.x)}" y="${format(region.y)}" width="${format(region.width)}" height="${format(region.height)}"`;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" ${box} color-interpolation-filters="sRGB">${parts.join('')}</filter>`;
}

/**
 * The list as an SVG `<filter>`, each effect working on the result of the one
 * before: one primitive for each color effect and each blur; for a shadow the
 * blur, offset, flood, composite and merge the specification spells
 * `drop-shadow` out as, so an editor that reads only SVG 1.1 filters reads it
 * too; and for each appearance effect its graph (see the module's note). An
 * effect switched off is left out. The region is in user space, so a small
 * element and a wide shadow both fit it.
 *
 * Every effect in the list is drawn into the picture: a caller that lays a
 * shadow under the element on its own (effectLayout) passes the `chain` here
 * and the `unders` to {@link svgUnderFilterMarkup}.
 */
export function svgFilterMarkup(effects: readonly Effect[], id: string, region: FilterRegion, format: (value: number) => string): string {
  const graph = new FilterGraph(id);
  let input = 'SourceGraphic';
  effects.forEach((effect, k) => {
    if (effect.on === false) return;
    graph.begin(k);
    input = graph.end(input, writeEffect(graph, effect, input));
  });
  return filterElement(id, region, format, graph.parts);
}

/**
 * The filter that draws the `k`th of an element's `unders` alone (see
 * effectLayout), for a `<use>` of the element laid under it: from the
 * element's own picture, the unders before it laid under that picture, then
 * this one's colored matte by itself. The `<use>` carries the blend. Null
 * when it draws nothing - its color is not one - so no `<use>` is written.
 */
export function svgUnderFilterMarkup(
  unders: readonly Effect[],
  k: number,
  id: string,
  region: FilterRegion,
  format: (value: number) => string,
): string | null {
  const graph = new FilterGraph(id);
  let input = 'SourceGraphic';
  for (let j = 0; j < k; j++) {
    graph.begin(j);
    input = graph.end(input, writeEffect(graph, unders[j], input));
  }
  const under = unders[k];
  if (!under || !isOuterEffect(under)) return null;
  graph.begin(k);
  const layer = outerLayer(graph, under, input);
  if (layer === null) return null;
  graph.end(input, layer);
  return filterElement(id, region, format, graph.parts);
}
