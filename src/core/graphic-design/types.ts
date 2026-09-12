/**
 * Data model for the graphic-design API.
 *
 * A composition is a list of elements over a page of a known size. Every
 * element is a plain object - no classes, no DOM, no canvas - so a composition
 * can be built in Node, posted over IPC, stored as JSON, and rendered by more
 * than one back end. Two back ends ship: an SVG writer and a software
 * rasterizer that encodes PNG. Both read this model and nothing else, which is
 * what makes "the same graphic in two formats" a property of the design rather
 * than a claim the tests have to police.
 *
 * Coordinates are numbers in the composition's `units` (pixels by default),
 * measured from the top-left corner with y increasing downwards - the same
 * frame SVG uses, so what is written here is what the SVG says.
 */

import type { LengthUnit } from '../units.js';

/** A point in composition units. */
export interface Point {
  x: number;
  y: number;
}

/** The page a composition is drawn on. */
export interface PageOptions {
  /** Page width in `units`. Defaults to {@link DEFAULT_COMPOSITION_SIZE}. */
  width?: number;
  /** Page height in `units`. Defaults to {@link DEFAULT_COMPOSITION_SIZE}. */
  height?: number;
  /** Unit every coordinate in the composition is expressed in. Default `px`. */
  units?: LengthUnit;
  /** Page background. `null` (the default) leaves the page transparent. */
  background?: string | null;
  /** Document id, written as the root `<svg id>`. */
  id?: string;
  /** Human title, written as `<title>` for accessibility. */
  title?: string;
  /**
   * Draw into the GUI's current canvas rather than a standalone page.
   *
   * False by default: the API is headless, and a composition rendered by a
   * script has nothing to do with whatever sketch happens to be open. Set it
   * true only in the renderer, where `paintComposition` is handed the app's
   * own 2D context.
   */
  useGuiCanvas?: boolean;
}

/** Fill rule for self-intersecting outlines. */
export type FillRule = 'nonzero' | 'evenodd';

/** Stroke cap shape. */
export type LineCap = 'butt' | 'round' | 'square';

/** Stroke join shape. */
export type LineJoin = 'miter' | 'round' | 'bevel';

/** Paint and geometry properties every element understands. */
export interface CommonProps {
  /** Stable id. Referenced by clipping masks and written to the SVG. */
  id?: string;
  /** Name, written as `data-name` - the label a design tool would show. */
  name?: string;
  /** Fill paint as a CSS color, or `null` for no fill. */
  fill?: string | null;
  /** Fill alpha in 0-1, multiplied into the fill color's own alpha. */
  fillOpacity?: number;
  /** How a self-intersecting outline decides inside from outside. */
  fillRule?: FillRule;
  /** Stroke paint as a CSS color, or `null` for no stroke. */
  stroke?: string | null;
  /** Stroke width in composition units. Default 1 when a stroke is set. */
  strokeWidth?: number;
  /** Stroke alpha in 0-1. */
  strokeOpacity?: number;
  /** Cap drawn at the ends of an open stroke. Default `butt`. */
  lineCap?: LineCap;
  /** Join drawn where two stroke segments meet. Default `miter`. */
  lineJoin?: LineJoin;
  /** Dash pattern in composition units, e.g. `[4, 2]`. */
  dash?: number[];
  /** Offset into the dash pattern. */
  dashOffset?: number;
  /** Element alpha in 0-1, multiplied over fill and stroke alike. */
  opacity?: number;
  /** Rotation in degrees, clockwise, about `origin`. */
  rotate?: number;
  /** Uniform or per-axis scale applied about `origin`. */
  scale?: number | Point;
  /** Translation applied after rotation and scale. */
  translate?: Point;
  /** Pivot for rotation and scale. Defaults to the element's own centre. */
  origin?: Point;
  /** Clipping mask: an id defined with `defineClip`, or an inline shape. */
  clip?: string | ClipShape;
  /** Set false to keep an element in the model but out of every render. */
  visible?: boolean;
}

/** An axis-aligned rectangle, optionally with rounded corners. */
export interface RectElement extends CommonProps {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius on x. Also sets `ry` when `ry` is omitted. */
  rx?: number;
  /** Corner radius on y. */
  ry?: number;
}

/** A circle given by its centre and radius. */
export interface CircleElement extends CommonProps {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}

/** An ellipse given by its centre and two radii. */
export interface EllipseElement extends CommonProps {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * A triangle.
 *
 * Either three explicit `points`, or a bounding box plus a `variant` - the
 * box form is what a layout wants ("a triangle in this slot"), and the points
 * form is what a drawing wants.
 */
export interface TriangleElement extends CommonProps {
  type: 'triangle';
  points?: [Point, Point, Point];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Which way the apex points when the box form is used. Default `up`. */
  variant?: 'up' | 'down' | 'left' | 'right';
}

/** A closed polygon through the given points. */
export interface PolygonElement extends CommonProps {
  type: 'polygon';
  points: Point[];
}

/** An open polyline through the given points. */
export interface PolylineElement extends CommonProps {
  type: 'polyline';
  points: Point[];
}

/** A straight line segment. */
export interface LineElement extends CommonProps {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * A path written in SVG path syntax.
 *
 * The supported commands are `M L H V C S Q T Z` in both cases. Elliptical
 * arcs (`A`) are deliberately absent: every rounded corner this API draws is
 * generated as Beziers, so nothing in the model needs them, and a half-right
 * arc converter is worse than an honest gap.
 */
export interface PathElement extends CommonProps {
  type: 'path';
  d: string;
}

/** Horizontal alignment of a text block against its anchor. */
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** Which part of the first line the `y` coordinate names. */
export type TextBaseline = 'alphabetic' | 'top' | 'middle' | 'bottom';

/** Character-level text styling. */
export interface TextStyle {
  /** CSS font family list. Default `DEFAULT_TEXT_FONT`. */
  fontFamily?: string;
  /** Font size in composition units. Default `DEFAULT_FONT_SIZE`. */
  fontSize?: number;
  /** `normal`, `bold`, or a numeric CSS weight. */
  fontWeight?: number | 'normal' | 'bold';
  /** `normal` or `italic`. */
  fontStyle?: 'normal' | 'italic';
  /** Extra space between characters, in composition units. */
  letterSpacing?: number;
  /** Extra space added to each word gap, in composition units. */
  wordSpacing?: number;
  /** Underline or strike-through. */
  decoration?: 'none' | 'underline' | 'line-through';
  /** Case transform applied before layout, so it also affects wrapping. */
  transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

/** Block-level text styling. */
export interface ParagraphStyle {
  /** Horizontal alignment within the text block. Default `left`. */
  align?: TextAlign;
  /** Line advance as a multiple of the font size. Default 1.2. */
  lineHeight?: number;
  /** Wrap width in composition units. Omit to break only on newlines. */
  maxWidth?: number;
  /** Extra space before each paragraph after the first. */
  paragraphSpacing?: number;
  /** First-line indent of each paragraph. */
  indent?: number;
  /** What `y` measures on the first line. Default `alphabetic`. */
  baseline?: TextBaseline;
}

/** A run of text, wrapped and aligned as a block. */
export interface TextElement extends CommonProps, TextStyle, ParagraphStyle {
  type: 'text';
  /** Anchor x. What it means depends on the paragraph alignment. */
  x: number;
  /** Anchor y. What it means depends on the paragraph baseline. */
  y: number;
  /** The text. A newline starts a new paragraph. */
  text: string;
}

/** How a placed image fills the box it was given. */
export type ImageFit = 'fill' | 'contain' | 'cover' | 'none';

/**
 * A placed media file.
 *
 * `src` is a data URL, or in Node a file path that `loadImageFile` turns into
 * one. The SVG writer embeds whatever it is handed, so JPEG, PNG, GIF and SVG
 * all round-trip; the rasterizer decodes PNG itself and asks the caller for a
 * decoder for anything else (see `RasterOptions.decodeImage`).
 */
export interface ImageElement extends CommonProps {
  type: 'image';
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** How the image is fitted into the box. Default `fill`. */
  fit?: ImageFit;
  /** Alternative text, written as a `<title>` inside the `<image>`. */
  alt?: string;
}

/** A transform applied to a set of children as one. */
export interface GroupElement extends CommonProps {
  type: 'group';
  children: Element[];
}

/** Any element a composition can hold. */
export type Element =
  | RectElement
  | CircleElement
  | EllipseElement
  | TriangleElement
  | PolygonElement
  | PolylineElement
  | LineElement
  | PathElement
  | TextElement
  | ImageElement
  | GroupElement;

/** The element kinds a clipping mask may be built from. */
export type ClipShape =
  | RectElement
  | CircleElement
  | EllipseElement
  | TriangleElement
  | PolygonElement
  | PathElement;

/** A named clipping mask, referenced by `clip: '<id>'`. */
export interface ClipDefinition {
  id: string;
  shapes: ClipShape[];
  /** Fill rule used to decide what the mask keeps. Default `nonzero`. */
  fillRule?: FillRule;
}

/** A finished composition: a page, its elements, and its clipping masks. */
export interface CompositionDocument {
  width: number;
  height: number;
  units: LengthUnit;
  background: string | null;
  id?: string;
  title?: string;
  useGuiCanvas: boolean;
  elements: Element[];
  clips: ClipDefinition[];
}

/** Page size used when a composition does not name one: 360 by 360. */
export const DEFAULT_COMPOSITION_SIZE = 360;

/** Unit every coordinate is read in unless the page names another. */
export const DEFAULT_UNITS: LengthUnit = 'px';

/** Font stack used by a text element that does not name one. */
export const DEFAULT_TEXT_FONT = "Helvetica, Arial, 'Liberation Sans', sans-serif";

/** Font size used by a text element that does not name one. */
export const DEFAULT_FONT_SIZE = 16;

/** Line advance as a multiple of the font size. */
export const DEFAULT_LINE_HEIGHT = 1.2;

/** Type guard for the elements that carry a `children` array. */
export function isGroup(el: Element): el is GroupElement {
  return el.type === 'group';
}
