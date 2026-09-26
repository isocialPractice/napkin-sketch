/**
 * The shape library: the named shapes `shape "<name>"` draws.
 *
 * The shapes come from the vector-graphics skill's assets - `shapes.svg`,
 * `isometric-objects.svg` and `perspective-objects.svg` under
 * `ai-helper/vectors/skills/vector-graphics/assets` - read by
 * `npm run shape-library` into `shape-library.json` beside this file, which is
 * committed. `library-build.ts` is the reader; a test reads the assets again
 * and fails when the committed file no longer matches them.
 *
 * A shape is one or more parts, and each part is one mark: Bezier anchors in
 * a unit box (0 to 1 across the shape's width and down its height), whether
 * the part is closed, and whether the asset filled it and stroked it. A part
 * is drawn in the current paint, so the asset's own black and white are not
 * carried over, and it shows only what the asset showed: an outline the asset
 * left unfilled stays unfilled, and a backdrop the asset filled without an
 * outline gets no outline.
 */

import type { VectorAnchor } from '../types.js';
import type { Outline } from './shapes.js';
import libraryFile from './shape-library.json';

/** A point in a shape's unit box: `[across, down]`, each 0 to 1 over the shape's extent. */
export type LibraryPoint = [number, number];

/** One anchor of a library part: its point, its handles, and `move` where a later subpath starts. */
export interface LibraryAnchor {
  p: LibraryPoint;
  in?: LibraryPoint;
  out?: LibraryPoint;
  move?: true;
}

/** One mark of a library shape. */
export interface LibraryPart {
  closed: boolean;
  /** The asset filled it; only a closed part is ever filled. */
  fill: boolean;
  /** The asset stroked it. */
  stroke: boolean;
  anchors: LibraryAnchor[];
}

/** A named shape. */
export interface LibraryShape {
  /** The name `shape` takes, lower case. */
  name: string;
  /** The asset file and the element id it was read from, as `file#id`. */
  source: string;
  /** Its natural size in the asset, in pixels: the extent of its curves. */
  width: number;
  height: number;
  /** Its marks, in the order they are drawn: the first is at the back. */
  parts: LibraryPart[];
}

/** The library file's shape. */
export interface ShapeLibrary {
  about: string;
  shapes: LibraryShape[];
}

/** The library, as committed. */
export const SHAPE_LIBRARY: ShapeLibrary = libraryFile as unknown as ShapeLibrary;

/** Every shape name, in the order the library lists them. */
export const SHAPE_NAMES: readonly string[] = SHAPE_LIBRARY.shapes.map((shape) => shape.name);

const BY_NAME = new Map(SHAPE_LIBRARY.shapes.map((shape) => [shape.name, shape]));

/** The shape of that name, in any case; `undefined` when the library has none. */
export function findShape(name: string): LibraryShape | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/**
 * The box a shape is drawn in. With a height, the shape is stretched to
 * `width` by `height`. Without one it keeps its proportions and its longer
 * side is `width` long, so a tall shape and a wide one given the same size
 * come out the same size - and a line, which has no height or no width,
 * still gets a length.
 */
export function shapeBox(shape: LibraryShape, width: number, height?: number): { width: number; height: number } {
  if (height !== undefined) return { width, height };
  return shape.width >= shape.height
    ? { width, height: (width * shape.height) / shape.width }
    : { width: (width * shape.width) / shape.height, height: width };
}

/** A library part fitted to a box on the page, ready to draw. */
export interface FittedPart {
  outline: Outline;
  fill: boolean;
  stroke: boolean;
}

/**
 * A shape's parts, fitted to the box whose top-left corner is `x`, `y`. See
 * {@link shapeBox} for how `width` and `height` size it.
 */
export function fitShape(shape: LibraryShape, x: number, y: number, width: number, height?: number): FittedPart[] {
  const box = shapeBox(shape, width, height);
  const at = (q: LibraryPoint): { x: number; y: number } => ({ x: x + q[0] * box.width, y: y + q[1] * box.height });
  return shape.parts.map((part) => ({
    outline: {
      anchors: part.anchors.map((a) => {
        const anchor: VectorAnchor = { p: at(a.p) };
        if (a.in) anchor.hIn = at(a.in);
        if (a.out) anchor.hOut = at(a.out);
        if (a.move) anchor.move = true;
        return anchor;
      }),
      closed: part.closed,
    },
    fill: part.fill,
    stroke: part.stroke,
  }));
}
