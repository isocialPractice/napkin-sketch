/**
 * Placing a Vector Path: where a press puts the next anchor, where the
 * rubber band to the pointer ends, and when a press closes the path.
 *
 * `Shift` holds the new anchor, and the band that previews it, to the
 * nearest of eight directions from the last anchor - level, plumb or a 45
 * degree diagonal - and a handle being pulled out to the nearest of eight
 * about its own anchor. Once the path has two anchors, a press within the
 * grab radius of the first closes it, `Shift` or not; the band then ends on
 * the first anchor, and the drawing window marks it with the close
 * indicator, so what the pointer shows is what a press will do.
 *
 * Nothing here touches the DOM.
 */

import type { VectorAnchor } from '../core/types.js';
import { constrainDrag } from '../sharpen/geometry.js';

type Vec = { x: number; y: number };

/** Whether a press at `at` closes the path: two anchors or more, and `at` within `grab` of the first. */
export function closesAt(anchors: readonly VectorAnchor[], at: Vec, grab: number): boolean {
  const first = anchors[0];
  return !!first && anchors.length >= 2 && Math.hypot(first.p.x - at.x, first.p.y - at.y) <= grab;
}

/** Where a press at `at` puts the next anchor: under the pointer, or held by `shift` to eight directions from the last. */
export function nextAnchorAt(anchors: readonly VectorAnchor[], at: Vec, shift: boolean): Vec {
  const last = anchors[anchors.length - 1];
  const to = shift && last ? constrainDrag(last.p, at) : at;
  return { x: to.x, y: to.y };
}

/**
 * The rubber band's end for the pointer at `at`, and whether a press there
 * would close the path - in which case the band ends on the first anchor.
 */
export function bandEnd(anchors: readonly VectorAnchor[], at: Vec, shift: boolean, grab: number): { end: Vec; closes: boolean } {
  if (closesAt(anchors, at, grab)) return { end: { x: anchors[0].p.x, y: anchors[0].p.y }, closes: true };
  return { end: nextAnchorAt(anchors, at, shift), closes: false };
}

/**
 * The handles a placing drag pulls out of `anchor` to `at`: symmetric, the
 * one leaving toward the pointer - held by `shift` to eight directions about
 * the anchor - or none inside `least`, where the anchor stays a corner.
 */
export function pulledHandles(anchor: VectorAnchor, at: Vec, shift: boolean, least: number): { hIn: Vec; hOut: Vec } | null {
  const to = shift ? constrainDrag(anchor.p, at) : at;
  const dx = to.x - anchor.p.x;
  const dy = to.y - anchor.p.y;
  if (Math.hypot(dx, dy) < least) return null;
  return { hOut: { x: anchor.p.x + dx, y: anchor.p.y + dy }, hIn: { x: anchor.p.x - dx, y: anchor.p.y - dy } };
}
