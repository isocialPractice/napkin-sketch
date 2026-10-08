/**
 * Effects on pixels, as the rasterizer runs them: over an element's own
 * picture before laying it down, one pass for each effect in the list, in
 * order.
 *
 * The passes themselves are core/appearance-fx.ts's, which the app's canvas
 * runs too, so a composition's PNG and a sketch on the canvas draw an effect
 * the same way. Nothing here reads the DOM.
 */

import { runEffects, type FxImage, type FxUnder } from '../appearance-fx.js';
import type { Effect } from '../effects.js';
import type { Matrix } from './geometry.js';

/** A premultiplied RGBA picture: four floats a pixel, row by row. */
export type EffectPixels = FxImage;

/**
 * Runs an effect list over a picture, in order. `matrix` is the element's
 * transform to device pixels: its scale sizes every blur and shadow, and its
 * turn carries a shadow's offset and a bevel's light. Only the ink and as far
 * as the effects can reach from it is worked on, so a small element on a
 * large page costs little.
 *
 * With `separate`, an Outer Shadow or Outer Glow that blends is not drawn into
 * the picture: it comes back as a layer of its own, for the caller to lay
 * under the element by its blend (core/effects.ts's effectLayout).
 */
export function applyEffects(
  buf: EffectPixels,
  effects: readonly Effect[],
  matrix: Matrix,
  warn: (message: string) => void,
  separate = false,
): FxUnder[] {
  return runEffects(buf, effects, matrix, warn, separate);
}
