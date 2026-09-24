/**
 * The Transform tool's arithmetic: one bounding box, eight handles, and the
 * two modifiers that change what dragging one of them means.
 *
 * Kept here, and pure, because the interesting part of this tool is not the
 * drawing or the pointer plumbing - it is which point stays still and which
 * factors come out, and those are four rules that interact:
 *
 * | Held        | Anchor            | Factors                               |
 * |-------------|-------------------|---------------------------------------|
 * | nothing     | the opposite side | per axis, from the handle grabbed     |
 * | `Shift`     | the opposite side | one factor on both axes               |
 * | `Alt`       | the box's centre  | per axis, from the handle grabbed     |
 * | `Shift+Alt` | the box's centre  | one factor on both axes               |
 *
 * Which axes move at all is the handle's own business and no modifier changes
 * it: a side handle scales across, a top or bottom handle scales down, and a
 * corner scales both. `Shift` makes the two factors agree; `Alt` moves the
 * point they are measured from.
 *
 * The file also holds the Mirror palette's rules ({@link mirrorStroke}), for
 * the same reason: what a reflection does to each kind of element - a curve,
 * a nib, a gradient, a line of text, a placed image - is the whole of the
 * feature, and it is easiest to see right when it is pure.
 */

import {
  DEFAULT_NIB_ANGLE,
  isImageStroke,
  isTextStroke,
  type Stroke,
} from './types.js';
import { profileIsSymmetric } from './stroke-profile.js';

/** The eight grab points of a selection box, named by compass point. */
export type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The handles in drawing order - corners and sides, clockwise from top-left. */
export const TRANSFORM_HANDLES: readonly TransformHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/** A selection's bounds, the only thing the transform maths works on. */
export interface TransformBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A scale as {@link Store.scaleStrokes} takes one: two factors and a fixed point. */
export interface TransformScale {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/**
 * How far a scale may be pushed in one gesture.
 *
 * The floor is what keeps a drag past the anchor from flipping the selection
 * inside out. Flipping is a reasonable thing to want and this tool does not
 * do it yet: a negative factor mirrors the geometry correctly but a text
 * item's font size and an image's width are magnitudes, so they would come
 * back as 1px rather than mirrored. Until that is handled properly, dragging
 * through the anchor stops at a sliver rather than producing a selection that
 * is partly mirrored and partly destroyed. {@link mirrorStroke} already knows
 * how each kind of element flips, so that is where a flipping drag would send
 * a negative factor.
 */
export const SCALE_FACTOR_MIN = 0.01;
export const SCALE_FACTOR_MAX = 100;

/** True when this handle moves the selection's width. */
export function transformScalesX(handle: TransformHandle): boolean {
  return handle.includes('e') || handle.includes('w');
}

/** True when this handle moves the selection's height. */
export function transformScalesY(handle: TransformHandle): boolean {
  return handle.includes('n') || handle.includes('s');
}

/** Where a handle sits on a box. A side handle sits at the middle of its side. */
export function transformHandlePoint(
  box: TransformBox,
  handle: TransformHandle,
): { x: number; y: number } {
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  return {
    x: handle.includes('w') ? box.minX : handle.includes('e') ? box.maxX : midX,
    y: handle.includes('n') ? box.minY : handle.includes('s') ? box.maxY : midY,
  };
}

/**
 * The point that stays still while a handle is dragged.
 *
 * Normally it is the handle opposite the one in hand, which is what makes a
 * drag feel like pulling the box's edge: grab the right side and the left
 * side stays where it is. With `Alt` it is the centre instead, so both sides
 * move outward together and the selection grows in place.
 */
export function transformAnchor(
  box: TransformBox,
  handle: TransformHandle,
  fromCenter: boolean,
): { x: number; y: number } {
  if (fromCenter) {
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }
  return transformHandlePoint(box, opposite(handle));
}

/**
 * The handle across the box from this one: `se` from `nw`, `w` from `e`.
 *
 * A table rather than a string flip. There are eight of them, they will never
 * be more, and a table can be read as obviously right in a way that swapping
 * letters through a placeholder cannot.
 */
const OPPOSITE: Record<TransformHandle, TransformHandle> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
};

export function opposite(handle: TransformHandle): TransformHandle {
  return OPPOSITE[handle];
}

/**
 * The scale a drag has asked for, measured from the box the drag started on.
 *
 * Total rather than incremental: the caller holds the box the gesture began
 * with and asks this what the pointer means against it, so a drag that wanders
 * out and comes back lands exactly where it started instead of accumulating
 * whatever the trip cost in rounding.
 *
 * A factor is the pointer's distance from the anchor over the handle's own
 * distance from it. An axis the handle does not move gets 1, and an axis whose
 * handle started *on* the anchor - a zero-width selection - gets 1 too, since
 * there is no distance to take a ratio of.
 */
export function transformScale(
  box: TransformBox,
  handle: TransformHandle,
  pointer: { x: number; y: number },
  opts: { uniform?: boolean; fromCenter?: boolean } = {},
): TransformScale {
  const anchor = transformAnchor(box, handle, opts.fromCenter === true);
  const start = transformHandlePoint(box, handle);
  const ratio = (p: number, s: number, a: number): number => {
    const span = s - a;
    if (Math.abs(span) < 1e-9) return 1;
    return (p - a) / span;
  };

  const movesX = transformScalesX(handle);
  const movesY = transformScalesY(handle);
  let sx = movesX ? ratio(pointer.x, start.x, anchor.x) : 1;
  let sy = movesY ? ratio(pointer.y, start.y, anchor.y) : 1;

  if (opts.uniform === true) {
    // The bigger of the two wins, so a corner follows whichever way the
    // pointer committed to. A side handle only measures one axis, and that
    // one then drives both - which is the whole point of holding Shift on a
    // side: scale the selection up without reshaping it.
    const driving = Math.max(movesX ? Math.abs(sx) : 0, movesY ? Math.abs(sy) : 0);
    sx = driving;
    sy = driving;
  }

  return {
    sx: clampFactor(sx),
    sy: clampFactor(sy),
    ox: anchor.x,
    oy: anchor.y,
  };
}

/** Holds a factor inside what one gesture may do, and out of the flip. */
export function clampFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, factor));
}

/**
 * The box a scale leaves behind, so the handles can follow the drag without
 * re-measuring the selection's geometry on every pointer event.
 */
export function scaledBox(box: TransformBox, scale: TransformScale): TransformBox {
  const at = (v: number, o: number, s: number): number => o + (v - o) * s;
  const xs = [at(box.minX, scale.ox, scale.sx), at(box.maxX, scale.ox, scale.sx)];
  const ys = [at(box.minY, scale.oy, scale.sy), at(box.maxY, scale.oy, scale.sy)];
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** The cursor a handle asks for, by the axis or axes it moves. */
export function transformCursor(handle: TransformHandle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    default:
      return 'nesw-resize';
  }
}

// ---- Mirror -------------------------------------------------------------------

/**
 * A reflection. `flipX` swaps left and right across the vertical line at
 * `x`; `flipY` swaps top and bottom across the horizontal line at `y`; both
 * together is the point reflection through (`x`, `y`), a half turn.
 *
 * The names follow the Mirror palette rather than Illustrator's Reflect:
 * *Horizontal* there is `flipX` here, the flip that turns a figure facing
 * right into one facing left.
 */
export interface Mirror {
  flipX: boolean;
  flipY: boolean;
  x: number;
  y: number;
}

/** Reflects one point in place. */
export function mirrorPoint(p: { x: number; y: number }, m: Mirror): void {
  if (m.flipX) p.x = 2 * m.x - p.x;
  if (m.flipY) p.y = 2 * m.y - p.y;
}

/**
 * An angle measured in the app's convention - 0 along +x, increasing
 * clockwise on the downward y axis - after a reflection, in [0, 360). A
 * direction (cos θ, sin θ) reflected left-right keeps its y and negates its
 * x, which is 180 − θ; reflected top-bottom it is −θ; both, θ + 180.
 */
export function mirrorAngle(degrees: number, m: Mirror): number {
  let angle = degrees;
  if (m.flipX) angle = 180 - angle;
  if (m.flipY) angle = -angle;
  return ((angle % 360) + 360) % 360;
}

/**
 * Mirrors one element in place.
 *
 * A reflection is affine, so it maps a Bézier curve exactly by mapping its
 * control points: every sampled point and every anchor with both of its
 * handles is reflected, `move` stays where it was, and a curve that was four
 * numbers is still four numbers. The path keeps its direction and each
 * handle stays on its own anchor; only the image of the path flips. Width,
 * dash, fill and opacity are untouched, since a reflection changes no
 * length.
 *
 * Two things carry a direction of their own and turn with the drawing: a
 * Copic stroke's broad nib and a linear gradient's axis, both reflected by
 * {@link mirrorAngle}. The gradient is replaced rather than edited, so an
 * undo snapshot that still holds the old object is left as it was.
 *
 * Text and placed images are boxes rather than shapes. Their box lands where
 * its mirror image would be - the box's far edge becomes its near one - and
 * what is inside keeps its orientation: text stays readable, which is the
 * rule Rotate already follows by orbiting text upright. `box` is the item's
 * measured box (text needs the canvas to measure it); without one, an image
 * is measured from its placed size and text moves by its anchor alone. An
 * image's pixels are mirrored by the caller, which has a canvas to do it
 * with; this moves the image, it does not redraw it.
 */
export function mirrorStroke(stroke: Stroke, m: Mirror, box?: TransformBox | null): void {
  if (!m.flipX && !m.flipY) return;

  if (isTextStroke(stroke) || isImageStroke(stroke)) {
    const anchor = stroke.points[0];
    if (!anchor) return;
    const measured =
      box ??
      (isImageStroke(stroke)
        ? {
            minX: anchor.x,
            minY: anchor.y,
            maxX: anchor.x + (stroke.imageWidth ?? 100),
            maxY: anchor.y + (stroke.imageHeight ?? 100),
          }
        : { minX: anchor.x, minY: anchor.y, maxX: anchor.x, maxY: anchor.y });
    const dx = m.flipX ? 2 * m.x - measured.maxX - measured.minX : 0;
    const dy = m.flipY ? 2 * m.y - measured.maxY - measured.minY : 0;
    for (const p of stroke.points) {
      p.x += dx;
      p.y += dy;
    }
    return;
  }

  for (const p of stroke.points) mirrorPoint(p, m);
  if (stroke.vector) {
    for (const anchor of stroke.vector.anchors) {
      mirrorPoint(anchor.p, m);
      if (anchor.hIn) mirrorPoint(anchor.hIn, m);
      if (anchor.hOut) mirrorPoint(anchor.hOut, m);
    }
  }
  if (stroke.tool === 'copic') {
    stroke.nibAngle = mirrorAngle(stroke.nibAngle ?? DEFAULT_NIB_ANGLE, m);
  }
  if (stroke.gradient && stroke.gradient.type === 'linear') {
    stroke.gradient = { ...stroke.gradient, angle: mirrorAngle(stroke.gradient.angle ?? 0, m) };
  }
  // One reflection turns a stroke's left side into its right, so a profile
  // that leans has to swap its sides to lean the mirrored way. Two are a half
  // turn, which keeps the handedness it had.
  if (stroke.profile && !profileIsSymmetric(stroke.profile) && m.flipX !== m.flipY) {
    if (stroke.profileMirrored) delete stroke.profileMirrored;
    else stroke.profileMirrored = true;
  }
}
