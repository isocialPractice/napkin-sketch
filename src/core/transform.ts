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
 */

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
 * is partly mirrored and partly destroyed.
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
