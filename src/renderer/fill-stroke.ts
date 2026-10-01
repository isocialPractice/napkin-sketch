/**
 * Fill and stroke, as the drawing window keeps them: the tool's ink and fill,
 * which of the two is in front, and what the keys do with them.
 *
 * `X` puts the other one in front, as it does on a vector editor's fill and
 * stroke control, and the Quick Access Colors, the swatches and the color
 * well paint the one in front: the tool's, for the next mark, and with the
 * Select tool the selection's too (core/paint.ts holds that rule, mark by
 * mark). `Shift+X` swaps the two.
 *
 * The ink is always a color - every drawing tool draws with it - while the
 * fill may be none, which it is until one is picked: a sketch's shapes are
 * outlines.
 */

import type { ColorTarget } from '../core/paint.js';

/** The tool's two paints and the one in front. */
export interface ToolPaint {
  /** The ink: the outline of every new mark. */
  color: string;
  /** The fill new closed shapes take, or null for none. */
  fill: string | null;
  colorTarget: ColorTarget;
}

/** The other one: `X`. */
export function otherTarget(target: ColorTarget): ColorTarget {
  return target === 'fill' ? 'stroke' : 'fill';
}

/** The color in front - null for a fill of none. */
export function frontColor(paint: ToolPaint): string | null {
  return paint.colorTarget === 'fill' ? paint.fill : paint.color;
}

/**
 * Where `C` (`dir` 1) or `Shift+C` (-1) takes the color in front, through
 * the Quick Access Colors. The fill's stops begin with None, so the keys can
 * take a fill away as well as give one; the ink's are the colors alone. A
 * color not among them starts from the end the keys move away from. Null is
 * None; with no Quick Access Colors the color stays as it is.
 */
export function nextQuickColor(colors: readonly string[], current: string | null, dir: 1 | -1, target: ColorTarget): string | null {
  const stops: (string | null)[] = target === 'fill' ? [null, ...colors] : [...colors];
  if (colors.length === 0) return current;
  const key = current === null ? null : current.toLowerCase();
  const index = stops.findIndex((stop) => (stop === null ? key === null : stop.toLowerCase() === key));
  if (index === -1) return dir === 1 ? stops[0] : stops[stops.length - 1];
  return stops[(index + dir + stops.length) % stops.length];
}

/**
 * The tool's paints after `Shift+X`: the ink and the fill trade colors. Null
 * when the fill is none: the ink cannot be none, so there is nothing to trade.
 */
export function swapToolPaint(paint: ToolPaint): Pick<ToolPaint, 'color' | 'fill'> | null {
  if (paint.fill === null) return null;
  return { color: paint.fill, fill: paint.color };
}
