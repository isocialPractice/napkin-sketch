/**
 * What an evaluation carries from one instruction to the next: the paint every
 * mark is drawn with, the transform every anchor is mapped through, and the
 * units bare numbers are read in. `push` saves all three and `pop` restores
 * them, and a group or a placed definition restores them when it ends.
 *
 * The paint fields are exactly the `Stroke` fields the language names, so a
 * mark is its paint state copied onto its geometry.
 */

import { DEFAULT_FONT_FAMILY, DEFAULT_NIB_ANGLE, type Gradient, type StrokeProfile, type StrokeStyle, type VectorAnchor } from '../types.js';
import { IDENTITY, apply, type Matrix } from '../graphic-design/geometry.js';
import type { LengthUnit } from '../units.js';
import type { ScriptTool } from './instructions.js';

/** napkin's default ink: what a script draws in until it names a color. */
export const DEFAULT_INK = '#1f2328';

/** The stroke width a script draws with until it names one, in pixels. */
export const DEFAULT_WIDTH = 3;

/** The size text is set in until a script names one, in pixels. */
export const DEFAULT_TEXT_SIZE = 24;

/** The hand-drawn pass as the last `rough` set it. */
export interface RoughState {
  /** 0 is exact; 1 is clearly drawn by hand. */
  amount: number;
  /** 1, or 2 to restate each line once. */
  passes: number;
  /** How far an open mark runs past its ends, in pixels; absent for the default. */
  overshoot?: number;
}

/** Everything a mark is drawn with. */
export interface PaintState {
  tool: ScriptTool;
  color: string;
  /** Stroke width in pixels, before a transform scales it. */
  width: number;
  /** An explicit opacity; absent leaves the tool's own default, as the app does. */
  opacity?: number;
  fill: string | null;
  gradient: Gradient | null;
  /** Whether closed shapes draw their outline. */
  stroke: boolean;
  style: StrokeStyle;
  profile: StrokeProfile;
  /** The copic nib angle, in degrees. */
  nib: number;
  rough: RoughState;
  font: { family: string; size: number };
}

/** The paint a script starts with. */
export function defaultPaint(): PaintState {
  return {
    tool: 'pen',
    color: DEFAULT_INK,
    width: DEFAULT_WIDTH,
    fill: null,
    gradient: null,
    stroke: true,
    style: 'solid',
    profile: 'uniform',
    nib: DEFAULT_NIB_ANGLE,
    rough: { amount: 0, passes: 1 },
    font: { family: DEFAULT_FONT_FAMILY, size: DEFAULT_TEXT_SIZE },
  };
}

/** The state `push` saves and `pop` restores. */
export interface Frame {
  matrix: Matrix;
  paint: PaintState;
  units: LengthUnit;
}

/** The state a script starts in: no transform, the default paint, pixels. */
export function initialFrame(): Frame {
  return { matrix: IDENTITY, paint: defaultPaint(), units: 'px' };
}

/** A copy that shares nothing with the original, so a saved frame stays as it was saved. */
export function copyFrame(frame: Frame): Frame {
  const { paint } = frame;
  return {
    matrix: [...frame.matrix] as Matrix,
    units: frame.units,
    paint: {
      ...paint,
      gradient: paint.gradient ? { ...paint.gradient, stops: paint.gradient.stops.map((s) => ({ ...s })) } : null,
      rough: { ...paint.rough },
      font: { ...paint.font },
    },
  };
}

/**
 * Maps anchors through a transform. A transform is affine, so mapping a
 * curve's anchors and both of their handles maps the curve itself: nothing is
 * sampled, and a curve that was four numbers is still four numbers.
 */
export function transformAnchors(anchors: readonly VectorAnchor[], m: Matrix): VectorAnchor[] {
  return anchors.map((anchor) => {
    const out: VectorAnchor = { p: apply(m, anchor.p) };
    if (anchor.hIn) out.hIn = apply(m, anchor.hIn);
    if (anchor.hOut) out.hOut = apply(m, anchor.hOut);
    if (anchor.move) out.move = true;
    return out;
  });
}

function normalizeDegrees(degrees: number): number {
  const angle = ((degrees % 360) + 360) % 360;
  return Math.round(angle * 1e9) / 1e9;
}

/**
 * Turns a direction with the drawing: the angle, in degrees clockwise from
 * three o'clock, that a direction at `degrees` points at once `m` has mapped
 * it. A copic nib and a linear gradient's axis both carry one.
 */
export function transformAngle(degrees: number, m: Matrix): number {
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) return normalizeDegrees(degrees);
  const rad = (degrees * Math.PI) / 180;
  const x = m[0] * Math.cos(rad) + m[2] * Math.sin(rad);
  const y = m[1] * Math.cos(rad) + m[3] * Math.sin(rad);
  if (x === 0 && y === 0) return normalizeDegrees(degrees);
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

/** A gradient turned with the drawing; a radial one has no direction to turn. */
export function transformGradient(gradient: Gradient, m: Matrix): Gradient {
  const stops = gradient.stops.map((s) => ({ ...s }));
  if (gradient.type === 'radial') return { type: 'radial', stops };
  return { type: 'linear', angle: transformAngle(gradient.angle ?? 0, m), stops };
}
