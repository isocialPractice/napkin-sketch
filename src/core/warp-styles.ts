/**
 * Warp styles: a vector editor's Effect > Warp. Each style is a closed-form
 * map of the plane over a box - the box of what it warps - that art is
 * carried through as Mesh Warp's and Liquify's are (core/mesh-warp.ts's
 * mapStrokeGeometry): anchors and handles along the map, a segment the map
 * bends split where it must.
 *
 * The maps work in the box's own frame: `u` runs -1 to 1 across it, left to
 * right, and `v` -1 to 1 up it, bottom to top, so a box of any size and
 * shape takes the same style the same way. `k` is the bend, -1 to 1.
 *
 * 1. **Distortion** comes first, a perspective's taper: Horizontal
 *    Distortion scales the height across the box (`v *= 1 + h u`), Vertical
 *    Distortion the width up it (`u *= 1 + d v`).
 * 2. **The style** then bends the box. A vertical warp is the horizontal one
 *    turned a quarter: the box is mirrored about its diagonal, warped, and
 *    mirrored back.
 *
 * Every map is smooth, so it gives its derivative too ({@link WarpMap}'s
 * `jacobian`), and the carrier bends a straight edge into a curve along its
 * tangents, with an anchor at each end and few between. A map that leaves a
 * point where it was gives that point back exactly: at no bend and no
 * distortion, the art is not touched.
 *
 * Pure: no DOM, nothing random.
 */

import type { PointMap } from './mesh-warp.js';

/** The styles, in a vector editor's Warp menu's order. */
export const WARP_STYLES = ['arc', 'arch', 'unroll', 'shell', 'windy', 'breezy', 'curvy', 'chart', 'puffy', 'expand', 'cram', 'twirl'] as const;

export type WarpStyle = (typeof WARP_STYLES)[number];

/** Each style as this app names it. */
export const WARP_STYLE_LABELS: Readonly<Record<WarpStyle, string>> = {
  arc: 'Arc',
  arch: 'Arch',
  unroll: 'Unroll',
  shell: 'Shell',
  windy: 'Windy',
  breezy: 'Breezy',
  curvy: 'Curvy',
  chart: 'Chart',
  puffy: 'Puffy',
  expand: 'Expand',
  cram: 'Cram',
  twirl: 'Twirl',
};

/** Each style as a vector editor names it. */
export const WARP_STYLE_ORIGINS: Readonly<Record<WarpStyle, string>> = {
  arc: 'Arc',
  arch: 'Arch',
  unroll: 'Bulge',
  shell: 'Shell',
  windy: 'Flag',
  breezy: 'Wave',
  curvy: 'Fish',
  chart: 'Rise',
  puffy: 'Fisheye',
  expand: 'Inflate',
  cram: 'Squeeze',
  twirl: 'Twist',
};

/** Which part of the box a style bends: all of it, or its lower or upper half's edge. */
export type WarpPart = 'whole' | 'lower' | 'upper';

export const WARP_PARTS: readonly WarpPart[] = ['whole', 'lower', 'upper'];

/** The parts a style takes: Arc all three, Shell its lower and upper edge, the rest the whole. */
export function warpPartsOf(style: WarpStyle): readonly WarpPart[] {
  if (style === 'arc') return WARP_PARTS;
  if (style === 'shell') return ['lower', 'upper'];
  return ['whole'];
}

/** A part a style takes: the one asked for when it takes it, else its first. */
export function warpPartFor(style: WarpStyle, part: WarpPart | undefined): WarpPart {
  const parts = warpPartsOf(style);
  return part !== undefined && parts.includes(part) ? part : parts[0];
}

/** What shapes a warp besides its style, as a vector editor's Warp Options have it. */
export interface WarpOptions {
  /** Which way the style bends: along the box's width, or turned a quarter, along its height. */
  orientation: 'horizontal' | 'vertical';
  /** How far, in percent: -100 to 100. */
  bend: number;
  /** The taper across the box, in percent: -100 to 100. */
  distortH: number;
  /** The taper up the box, in percent: -100 to 100. */
  distortV: number;
  /** The part of the box Arc and Shell bend. */
  part: WarpPart;
}

/** The box a warp is laid over: what it warps, in its own coordinates. */
export interface WarpBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A map's derivative at a point: `[dx'/dx, dx'/dy, dy'/dx, dy'/dy]`. */
export type Jacobian = readonly [number, number, number, number];

/** A style laid over a box: where a point goes, how far the map turns there, and its derivative. */
export interface WarpMap extends PointMap {
  jacobian(p: { x: number; y: number }): Jacobian;
}

/**
 * A style by its name: this app's id or a vector editor's name, in any case,
 * spaces or hyphens between words. The vector editor's Arc Lower, Arc Upper,
 * Shell Lower and Shell Upper give their part too. Undefined for no style.
 */
export function warpStyleOf(name: unknown): { style: WarpStyle; part?: WarpPart } | undefined {
  if (typeof name !== 'string') return undefined;
  const wanted = name.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const parted = /^(arc|shell)-(lower|upper)$/.exec(wanted);
  if (parted) return { style: parted[1] as WarpStyle, part: parted[2] as WarpPart };
  const style = WARP_STYLES.find((id) => id === wanted || WARP_STYLE_ORIGINS[id].toLowerCase() === wanted);
  return style ? { style } : undefined;
}

/**
 * How far Puffy's middle swells at full bend: its scale there is 1 plus this.
 * Under 1, so a full negative bend shrinks the middle without folding it.
 */
const PUFF = 0.9;

/**
 * A style's displacement in its own frame - `U` along the bend, `V` across
 * it, up - at bend `k`, for a frame `beta` times as tall as it is wide.
 * Zero where the style leaves a point alone.
 */
function styleShift(style: WarpStyle, part: WarpPart, U: number, V: number, k: number, beta: number): [number, number] {
  switch (style) {
    case 'arc': {
      if (part === 'whole') return arcShift(U, V, k, beta);
      // Arc Lower and Upper bend one half: the arc's shift, faded to nothing at the other edge.
      const t = part === 'lower' ? (1 - V) / 2 : (1 + V) / 2;
      const [dU, dV] = arcShift(U, V, k, beta);
      return [t * dU, t * dV];
    }
    case 'arch':
      // The whole box lifts at its middle; its sides stay upright.
      return [0, k * (1 - U * U)];
    case 'unroll':
      // Bulge: the height swells at the middle, top and bottom alike.
      return [0, V * k * (1 - U * U)];
    case 'shell':
      // One edge bows out, the other stays put.
      return [0, part === 'upper' ? (k * (1 - U * U) * (1 + V)) / 2 : (-k * (1 - U * U) * (1 - V)) / 2];
    case 'windy':
      // Flag: one wave across, top and bottom together.
      return [0, 0.5 * k * Math.sin(Math.PI * U)];
    case 'breezy':
      // Wave: the wave's phase drifts with the height.
      return [0, 0.5 * k * Math.sin(Math.PI * (U + V / 2))];
    case 'curvy':
      // Fish: a body that swells, then narrows to a tail.
      return [0, V * 0.6 * k * Math.sin(0.75 * Math.PI * (U + 1))];
    case 'chart':
      // Rise: climbing to the right.
      return [0, k * ((U + 1) / 2) ** 2];
    case 'puffy': {
      // Fisheye: each point moves out from the middle (or in), most near the
      // middle and less and less past it, so the middle swells and the edges
      // bow out a little. A point's place along its ray never turns back.
      const grow = k * PUFF * Math.exp(-2 * (U * U + V * V));
      return [U * grow, V * grow];
    }
    case 'expand':
      // Inflate: every edge bows out at its middle.
      return [U * 0.5 * k * (1 - V * V), V * 0.5 * k * (1 - U * U)];
    case 'cram':
      // Squeeze: the sides pulled in at the middle of the height.
      return [-U * 0.5 * k * (1 - V * V), 0];
    case 'twirl': {
      // Twist: each ring round the middle turned, half a turn at the middle
      // at full bend and less and less outward, the corners a little.
      const alpha = k * Math.PI * Math.exp(-1.5 * (U * U + V * V));
      const c = Math.cos(alpha);
      const s = Math.sin(alpha);
      return [U * c - V * s - U, U * s + V * c - V];
    }
  }
}

/**
 * Arc: the line through the middle bends into an arc `k` half-turns round,
 * its length kept, and a point's distance from that line becomes its
 * distance from the arc - so the box bends round the arc's centre, below it
 * for a positive bend and above it for a negative one.
 */
function arcShift(U: number, V: number, k: number, beta: number): [number, number] {
  if (Math.abs(k) < 1e-9) return [0, 0];
  const s = Math.sign(k);
  // The arc's radius, in half-widths: its length, 2, over its angle, |k| pi.
  const R = 2 / (Math.abs(k) * Math.PI);
  const phi = U / R;
  // A point past the centre would turn inside out: it stops there.
  const r = Math.max(0, R + s * beta * V);
  const U2 = r * Math.sin(phi);
  const V2 = (s * (r * Math.cos(phi) - R)) / beta;
  return [U2 - U, V2 - V];
}

/**
 * A style laid over a box, as a map art is carried through. Bend and the
 * distortions are percents, -100 to 100. A box with no width or no height
 * is given a sliver of one, so a straight line still bends.
 */
export function warpStyleMap(style: WarpStyle, box: WarpBox, options: WarpOptions): WarpMap {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-9);
  const floor = span * 1e-6;
  const a = Math.max((box.maxX - box.minX) / 2, floor);
  const b = Math.max((box.maxY - box.minY) / 2, floor);
  const k = clampUnit(options.bend / 100);
  const h = clampUnit(options.distortH / 100);
  const d = clampUnit(options.distortV / 100);
  const part = warpPartFor(style, options.part);
  const vertical = options.orientation === 'vertical';
  const still = k === 0 && h === 0 && d === 0;

  /** The displacement of a point given in the box's frame. */
  const shift = (u: number, v: number): [number, number] => {
    // Distortion first, from where the point was.
    const u1 = u * (1 + d * v);
    const v1 = v * (1 + h * u);
    let du = u1 - u;
    let dv = v1 - v;
    if (k !== 0) {
      if (vertical) {
        // The frame mirrored about the box's diagonal - x for y on the page,
        // so up becomes left - warped, and mirrored back.
        const [dU, dV] = styleShift(style, part, -v1, -u1, k, a / b);
        du -= dV;
        dv -= dU;
      } else {
        const [dU, dV] = styleShift(style, part, u1, v1, k, b / a);
        du += dU;
        dv += dV;
      }
    }
    return [du, dv];
  };

  const point = (p: { x: number; y: number }): { x: number; y: number } => {
    if (still) return { x: p.x, y: p.y };
    const [du, dv] = shift((p.x - cx) / a, (cy - p.y) / b);
    if (du === 0 && dv === 0) return { x: p.x, y: p.y };
    return { x: p.x + a * du, y: p.y - b * dv };
  };

  // A step small beside the box and large beside a float's grain.
  const step = (a + b) * 1e-6;
  const jacobian = (p: { x: number; y: number }): Jacobian => {
    if (still) return [1, 0, 0, 1];
    const xp = point({ x: p.x + step, y: p.y });
    const xm = point({ x: p.x - step, y: p.y });
    const yp = point({ x: p.x, y: p.y + step });
    const ym = point({ x: p.x, y: p.y - step });
    return [(xp.x - xm.x) / (2 * step), (yp.x - ym.x) / (2 * step), (xp.y - xm.y) / (2 * step), (yp.y - ym.y) / (2 * step)];
  };

  return {
    point,
    jacobian,
    /** How far the map turns at a point, in degrees, clockwise on screen: its derivative's rotation. */
    rotation(p) {
      const [j11, j12, j21, j22] = jacobian(p);
      return (Math.atan2(j21 - j12, j11 + j22) * 180) / Math.PI;
    },
  };
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}
