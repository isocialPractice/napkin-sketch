/**
 * The `effect` verb: an effect as a script writes it, turned into the model's
 * {@link Effect}, in page pixels.
 *
 * An effect waits for the next layer, group or mark the script makes, and
 * several wait together, in order; the evaluator keeps them and hands them
 * over. What is decided here is what one `effect` line means: its lengths are
 * read in the units in force where the line is and scaled by the transform in
 * force there, as a mark's width is, and a shadow's offset turns with that
 * transform, as a mark's anchors do.
 */

import type { Effect } from '../effects.js';
import { meanScale, type Matrix } from '../graphic-design/geometry.js';
import type { EffectInstruction, LengthArg, NumberArg, PercentAxis } from './instructions.js';

/** How an `effect` line's values are read and checked, each where the line is. */
export interface EffectReader {
  length(value: LengthArg, axis: PercentAxis): number;
  number(value: NumberArg): number;
  /** The value, or a diagnostic when it is below 0. */
  nonNegative(value: number, what: string): number;
  /** The value, or a diagnostic when it is outside 0 to 1. */
  fraction(value: number, what: string): number;
}

/**
 * The effect an `effect` line asks for, under the transform `matrix`. Not for
 * `effect none`, which asks for none.
 */
export function effectOf(instruction: EffectInstruction, read: EffectReader, matrix: Matrix): Effect {
  const scale = meanScale(matrix);
  switch (instruction.type) {
    case 'blur':
      return { type: 'blur', radius: read.nonNegative(read.length(instruction.radius ?? 0, 'min'), 'A blur') * scale };
    case 'brightness':
    case 'contrast':
    case 'saturate':
      return {
        type: instruction.type,
        amount: read.nonNegative(read.number(instruction.amount ?? 1), `A ${instruction.type} amount`),
      };
    case 'grayscale':
    case 'sepia':
    case 'invert':
    case 'opacity':
      return {
        type: instruction.type,
        amount: read.fraction(read.number(instruction.amount ?? 1), `A ${instruction.type} amount`),
      };
    case 'hue-rotate':
      return { type: 'hue-rotate', angle: read.number(instruction.angle ?? 0) };
    case 'drop-shadow': {
      const dx = read.length(instruction.dx ?? 0, 'x');
      const dy = read.length(instruction.dy ?? 0, 'y');
      const blur = read.nonNegative(read.length(instruction.blur ?? 0, 'min'), 'A shadow blur') * scale;
      return {
        type: 'drop-shadow',
        dx: matrix[0] * dx + matrix[2] * dy,
        dy: matrix[1] * dx + matrix[3] * dy,
        blur,
        color: instruction.color ?? '#000000',
      };
    }
    default:
      throw new Error(`effectOf: \`effect ${instruction.type}\` asks for no effect`);
  }
}
