/**
 * Effects: the CSS filter functions, as data every output can draw.
 *
 * An effect list rides on a mark, a layer or a group in the sketch model, and
 * on any element or group in the composition model, and every output reads
 * the same list: the SVG writers turn it into a `<filter>`, the rasterizer
 * into passes over the element's own pixels, and the app's canvas into
 * `ctx.filter`. The set is exactly the CSS filter functions, because that is
 * the one vocabulary all three can honour the same way.
 *
 * The color effects are the matrices the Filter Effects specification defines
 * them by, applied to straight (not premultiplied) color and worked in sRGB,
 * as CSS filter functions are; the SVG writers say so with
 * `color-interpolation-filters="sRGB"`, so a viewer does the same arithmetic
 * the rasterizer does. Lengths - a blur's radius, a shadow's offset and blur -
 * are in the units of whatever carries the list: pixels on a sketch, the
 * composition's own units on a composition.
 *
 * Nothing here reads the DOM.
 */

import { parseColor, type Rgba } from './graphic-design/color.js';

/** The effects there are, by their CSS names. */
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
  | 'drop-shadow';

/** The effects whose one argument is an amount: a factor, or a share from 0 to 1. */
export type AmountEffectType = 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert' | 'opacity';

/**
 * One effect, as its CSS filter function says it:
 *
 * - `blur` - a Gaussian blur; `radius` is its standard deviation, as CSS's
 *   `blur()` length is.
 * - `brightness`, `contrast`, `saturate` - a factor from 0: 1 leaves the color
 *   as it is.
 * - `grayscale`, `sepia`, `invert` - how much, from 0 to 1.
 * - `hue-rotate` - `angle` in degrees.
 * - `opacity` - from 0 to 1.
 * - `drop-shadow` - a shadow `dx` across and `dy` down, blurred by `blur`,
 *   which is CSS's blur radius - twice the standard deviation - in `color`.
 */
export type Effect =
  | { type: 'blur'; radius: number }
  | { type: AmountEffectType; amount: number }
  | { type: 'hue-rotate'; angle: number }
  | { type: 'drop-shadow'; dx: number; dy: number; blur: number; color: string };

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
];

/** Effects whose amount is a share, from 0 to 1. */
const SHARES = new Set<EffectType>(['grayscale', 'sepia', 'invert', 'opacity']);

/** Effects whose amount is a factor, from 0 up. */
const FACTORS = new Set<EffectType>(['brightness', 'contrast', 'saturate']);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Reads one effect: its type known, its numbers finite and in range. A share
 * is held to 0 to 1, as CSS clamps it; a negative factor or length is not an
 * effect at all, as it is not in CSS, and neither is a shadow color that is
 * not a string. Anything else a stored effect carries is left behind.
 */
export function readEffect(raw: unknown): Effect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as EffectType;
  if (!EFFECT_TYPES.includes(type)) return null;
  switch (type) {
    case 'blur':
      return finite(r.radius) && r.radius >= 0 ? { type, radius: r.radius } : null;
    case 'hue-rotate':
      return finite(r.angle) ? { type, angle: r.angle } : null;
    case 'drop-shadow': {
      if (!finite(r.dx) || !finite(r.dy)) return null;
      const blur = r.blur === undefined ? 0 : r.blur;
      if (!finite(blur) || blur < 0) return null;
      const color = r.color === undefined ? '#000000' : r.color;
      if (typeof color !== 'string' || color.trim() === '') return null;
      return { type, dx: r.dx, dy: r.dy, blur, color };
    }
    default: {
      const amount = r.amount === undefined ? 1 : r.amount;
      if (!finite(amount)) return null;
      if (SHARES.has(type)) return { type, amount: Math.min(1, Math.max(0, amount)) };
      if (FACTORS.has(type) && amount >= 0) return { type, amount };
      return null;
    }
  }
}

/**
 * Reads an effect list, keeping the effects that read and dropping the rest.
 * Gives `undefined` when nothing is left, so a mark or a layer without
 * effects carries no field at all.
 */
export function readEffects(raw: unknown): Effect[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const effects = raw.map(readEffect).filter((effect): effect is Effect => effect !== null);
  return effects.length > 0 ? effects : undefined;
}

/**
 * How far past the ink an effect list can reach, in its own units: three
 * standard deviations for each blur, which is where a Gaussian's last visible
 * tail ends, and a shadow's offset and its blur. A list reaches as far as its
 * effects together, since each works on what the one before it made.
 */
export function effectReach(effects: readonly Effect[]): number {
  let reach = 0;
  for (const effect of effects) {
    if (effect.type === 'blur') reach += 3 * effect.radius;
    else if (effect.type === 'drop-shadow') reach += Math.max(Math.abs(effect.dx), Math.abs(effect.dy)) + 1.5 * effect.blur;
  }
  return reach;
}

/** The list with every length multiplied by `scale`: how effects follow their mark when it is resized. */
export function scaleEffects(effects: readonly Effect[], scale: number): Effect[] {
  return effects.map((effect) => {
    if (effect.type === 'blur') return { ...effect, radius: effect.radius * scale };
    if (effect.type === 'drop-shadow') return { ...effect, dx: effect.dx * scale, dy: effect.dy * scale, blur: effect.blur * scale };
    return { ...effect };
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
 * there. Every effect but a blur and a shadow is one; those two give null.
 * Brightness, contrast, invert and opacity are component transfers in the
 * specification, and each is a straight line, so the matrix is the same
 * arithmetic.
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

/**
 * The list as a CSS `filter` value, for a 2D canvas. A canvas works a
 * filter in device pixels whatever its transform, so the transform the list
 * is drawn under is applied here: its scale sizes every blur and shadow, and
 * its turn carries a shadow's offset, as it does in SVG. A context's own
 * `getTransform()` will do. `maxBlurPx` holds every blur, a shadow's
 * included, to that many device pixels: a painter that paints only so far past
 * its canvas gives it, so a blur never gathers from beyond what was painted.
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
    .map((effect) => {
      switch (effect.type) {
        case 'blur':
          return `blur(${num(blur(effect.radius))}px)`;
        case 'hue-rotate':
          return `hue-rotate(${num(effect.angle)}deg)`;
        case 'drop-shadow': {
          const dx = a * effect.dx + c * effect.dy;
          const dy = b * effect.dx + d * effect.dy;
          return `drop-shadow(${num(dx)}px ${num(dy)}px ${num(blur(effect.blur))}px ${effect.color})`;
        }
        default:
          return `${effect.type}(${num(effect.amount)})`;
      }
    })
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

/**
 * The list as an SVG `<filter>`: one primitive for each color effect, a
 * Gaussian blur for each blur, and for each shadow the blur, offset, flood,
 * composite and merge the specification spells `drop-shadow` out as, so an
 * editor that reads only SVG 1.1 filters reads it too. Each primitive works
 * on the result of the one before. The region is in user space, so a small
 * element and a wide shadow both fit it.
 */
export function svgFilterMarkup(effects: readonly Effect[], id: string, region: FilterRegion, format: (value: number) => string): string {
  const parts: string[] = [];
  let input = 'SourceGraphic';
  effects.forEach((effect, k) => {
    const result = `${id}-${k}`;
    const matrix = colorMatrix(effect);
    if (matrix) {
      parts.push(`<feColorMatrix in="${input}" type="matrix" values="${matrix.map(num).join(' ')}" result="${result}"/>`);
    } else if (effect.type === 'blur') {
      parts.push(`<feGaussianBlur in="${input}" stdDeviation="${num(effect.radius)}" result="${result}"/>`);
    } else if (effect.type === 'drop-shadow') {
      const color = shadowColor(effect.color);
      if (!color) return; // no color, no shadow: the chain carries on without it
      const hex = `#${[color.r, color.g, color.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      // A shadow with no blur is its offset alone: a zero deviation is a blur some viewers leave empty.
      if (effect.blur > 0) parts.push(`<feGaussianBlur in="${input}" stdDeviation="${num(effect.blur / 2)}" result="${result}-blur"/>`);
      parts.push(
        `<feOffset in="${effect.blur > 0 ? `${result}-blur` : input}" dx="${num(effect.dx)}" dy="${num(effect.dy)}" result="${result}-offset"/>`,
        `<feFlood flood-color="${hex}" flood-opacity="${num(color.a)}" result="${result}-color"/>`,
        `<feComposite in="${result}-color" in2="${result}-offset" operator="in" result="${result}-shadow"/>`,
        `<feMerge result="${result}"><feMergeNode in="${result}-shadow"/><feMergeNode in="${input}"/></feMerge>`,
      );
    } else {
      return;
    }
    input = result;
  });
  const box = `x="${format(region.x)}" y="${format(region.y)}" width="${format(region.width)}" height="${format(region.height)}"`;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" ${box} color-interpolation-filters="sRGB">${parts.join('')}</filter>`;
}
