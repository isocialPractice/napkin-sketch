/**
 * A mark's two paints, and the rules that move a color between them.
 *
 * A mark carries an outline - its `color`, drawn unless `noStroke` - and, when
 * it is a closed shape, a fill (`fill`, or a `gradient` in its place). A
 * vector editor's toolbar has a fill and stroke control that decides which of
 * the two a picked color paints, with one of them in front, and a key that
 * swaps them. These are those two rules for one mark; the drawing window
 * applies them to the selection (renderer/fill-stroke.ts holds the rest).
 */

import { isClosedStroke, isImageStroke, isTextStroke, type Stroke } from './types.js';

/** Which of a mark's two paints a picked color goes to: the one in front. */
export type ColorTarget = 'stroke' | 'fill';

/** Every color target, the default first. */
export const COLOR_TARGETS: readonly ColorTarget[] = ['stroke', 'fill'];

/** A mark that holds no paint of its own to change: a picture, a placed graphic or an older file's eraser mark. */
function paintless(stroke: Stroke): boolean {
  return stroke.tool === 'eraser' || isImageStroke(stroke) || stroke.link !== undefined;
}

/**
 * What `color`, picked with `target` in front, does to one mark: the patch
 * to apply (a key set to `undefined` is taken away), or null when it does
 * nothing to that mark.
 *
 * - The stroke in front recolors the outline and turns it on, as a vector
 *   editor gives a shape with no stroke one when a stroke color is picked.
 * - The fill in front fills a closed shape - in place of a gradient, which
 *   a flat color replaces - and leaves an open line alone: its fill would
 *   paint the straight edge that closes it, which a sketch never meant.
 * - Text has one color, and takes it with either in front.
 *
 * REUSE: a closed shape is the one Fill Shape filled before this rule took
 * its place - `isClosedStroke`, whose ends lie close - so a shape Fill
 * Shape could fill, the fill in front can.
 */
export function paintPatch(stroke: Stroke, target: ColorTarget, color: string): Partial<Stroke> | null {
  if (paintless(stroke)) return null;
  if (isTextStroke(stroke)) return { color };
  if (target === 'stroke') return { color, noStroke: undefined };
  if (!isClosedStroke(stroke)) return null;
  return { fill: color, gradient: undefined };
}

/**
 * A closed shape's fill and outline colors, swapped - Swap Fill and Stroke.
 * A shape with no fill ends with no outline, and one with no outline ends
 * with no fill, as a vector editor's swap leaves them. Null when there is
 * nothing to swap: an open line or text has one color, a gradient cannot be
 * an outline, and a shape with neither has nothing to give.
 */
export function swapPaint(stroke: Stroke): Partial<Stroke> | null {
  if (paintless(stroke) || isTextStroke(stroke) || !isClosedStroke(stroke)) return null;
  if (stroke.gradient) return null;
  const fill = stroke.fill ?? null;
  const outline = stroke.noStroke ? null : stroke.color;
  if (fill === null && outline === null) return null;
  return {
    fill: outline ?? undefined,
    ...(fill === null ? { noStroke: true } : { color: fill, noStroke: undefined }),
  };
}
