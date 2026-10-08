/**
 * The napkin script object form: the instruction list every front end lowers
 * to and the evaluator runs.
 *
 * A napkin script says what to draw without a pointer. People and AI helpers
 * write it as text (`.napkin`), one instruction per line; a program in any
 * language builds the same thing as JSON (`.napkin.json`) - an array of plain
 * objects, each naming its `verb`. Both reach the evaluator as the types
 * below, which makes this file the contract: the text syntax can change
 * without touching anything downstream of it, and nothing downstream reads
 * text.
 *
 * `verbs.json` beside this file is the verb table: every verb's category, a
 * one-line summary, an example, and the argument grammar the text parser
 * follows. The parser, the documentation tables, the CLI's verb listing and
 * the helper skill all read that one table, and a test holds it to the types
 * here field for field.
 *
 * Compatibility: {@link SCRIPT_VERSION} changes only when a script that ran
 * under the old version would run differently under the new one. A new verb or
 * a new optional field is an addition, not a change - a script that uses one
 * reports `unknown-verb` on an older build rather than drawing something else.
 */

import { DEFAULT_SURFACE, TOOL_ALIASES, type StrokeProfile, type StrokeStyle, type ToolAlias } from '../types.js';
import type { StackMode, WipeOp } from '../wipe.js';
import type { LengthUnit } from '../units.js';
import verbTable from './verbs.json';

// ---- Values ----------------------------------------------------------------

/** Where an instruction came from in a text script. Both are 1-based. */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * A number worked out when its instruction runs: arithmetic (`+ - * / %`,
 * unary minus, parentheses) over numbers, `let` names, a `repeat` counter and
 * the page's `width` and `height`, all in the script's current units, with
 * `sin`, `cos` and `tan` in degrees and `sqrt`, `abs`, `round`, `floor`,
 * `ceil`, `min` and `max`. A number inside may carry a unit (`10mm`), which is
 * converted into the current units, or a `%` of the page along the argument's
 * axis. The text form writes one in parentheses, `(i * 40 + 20)`, and the
 * object form carries the same source without them. `expr.ts` reads and runs
 * them.
 */
export interface Expr {
  expr: string;
}

/** A plain number, or an expression. Angles are degrees, clockwise. */
export type NumberArg = number | Expr;

/**
 * A length. A bare number is in the script's current `units` (pixels unless a
 * `units` instruction says otherwise). A string carries its own unit - `"10mm"`,
 * `"0.5in"`, `"12pt"`, `"4px"` - or is a share of the page, `"50%"`, measured
 * along the axis the argument runs on. An expression is in the current units.
 */
export type LengthArg = number | string | Expr;

/** A point, as two lengths. */
export interface PointArg {
  x: LengthArg;
  y: LengthArg;
}

/** One color stop of a gradient: a CSS color at an offset from 0 to 1. */
export interface StopArg {
  color: string;
  offset: NumberArg;
}

/** The character attributes `character` sets for text after it, and a run of a text sets for its own characters. */
export interface CharacterFields {
  /** The face's name, as the font list names it: `Bold`, `Italic`. */
  face?: string;
  /** Space after every character, in thousandths of an em. */
  tracking?: NumberArg;
  /** Kerning by hand after each character, in thousandths of an em. */
  kern?: NumberArg;
  /** The font's own pair kerning. */
  kerning?: 'auto' | 'none';
  /** The distance from a line's baseline to the one before it. */
  leading?: LengthArg;
  /** A word space's width, as a percent of the font's own. */
  spacing?: NumberArg;
  caps?: 'normal' | 'all' | 'small';
  /** Horizontal and vertical scale, percent. */
  hscale?: NumberArg;
  vscale?: NumberArg;
  /** How far a character sits above its baseline, up positive. */
  shift?: LengthArg;
  /** Degrees each character is turned about its own middle, clockwise. */
  rotate?: NumberArg;
  /** A background behind the characters. */
  highlight?: string;
  position?: 'superscript' | 'subscript';
  underline?: boolean;
  strike?: boolean;
}

/**
 * A run of a text's characters, from `start` to `end` (not included,
 * counting from 0), and the attributes it has: `character`'s, and its own
 * size, family and color.
 */
export interface RunArg extends CharacterFields {
  start: number;
  end: number;
  /** The Text Configuration the run follows, by name: its own attributes override it. */
  config?: string;
  size?: LengthArg;
  family?: string;
  color?: string;
}

/**
 * The marks a script can draw with. `eraser` takes away what is under it on
 * its own layer, as the app's eraser does, and takes no fill, outline style,
 * profile or effect.
 */
export const SCRIPT_TOOLS = ['pen', 'marker', 'copic', 'pencil', 'eraser'] as const;

/** A tool a script can draw with. */
export type ScriptTool = (typeof SCRIPT_TOOLS)[number];

/**
 * Every name `tool` takes: the tools, then their other names - `brush` for
 * `pen`, the app's Brush. A script the app writes names the tool itself.
 */
export const SCRIPT_TOOL_NAMES: readonly string[] = [...SCRIPT_TOOLS, ...Object.keys(TOOL_ALIASES)];

/** Named page sizes. */
export type PaperName =
  | 'a3'
  | 'a4'
  | 'a5'
  | 'letter'
  | 'legal'
  | 'tabloid'
  | 'square'
  | 'slide'
  | 'napkin';

/** A named page size, in the unit it is usually quoted in. */
export interface PaperSize {
  width: number;
  height: number;
  units: LengthUnit;
}

/**
 * The named page sizes, each lying the way it is usually quoted: the paper
 * sizes portrait, `slide` landscape, and `napkin` the size a new sketch opens
 * at in the app.
 */
export const PAPER_SIZES: { readonly [P in PaperName]: PaperSize } = {
  a3: { width: 297, height: 420, units: 'mm' },
  a4: { width: 210, height: 297, units: 'mm' },
  a5: { width: 148, height: 210, units: 'mm' },
  letter: { width: 8.5, height: 11, units: 'in' },
  legal: { width: 8.5, height: 14, units: 'in' },
  tabloid: { width: 11, height: 17, units: 'in' },
  square: { width: 1080, height: 1080, units: 'px' },
  slide: { width: 1920, height: 1080, units: 'px' },
  napkin: { width: DEFAULT_SURFACE.width, height: DEFAULT_SURFACE.height, units: 'px' },
};

// ---- Instructions ------------------------------------------------------------

/** What every instruction carries besides its own arguments. */
interface InstructionBase {
  /** Where a parsed instruction came from. Absent on one a program built. */
  at?: SourcePosition;
}

// Document

/** `napkin 1`: the language version the script was written for. */
export interface NapkinInstruction extends InstructionBase {
  verb: 'napkin';
  version: number;
}

/** `page a4 landscape`, `page 400 300`: the size of the current page. */
export interface PageInstruction extends InstructionBase {
  verb: 'page';
  /** A named size. When given, `width` and `height` are not read. */
  paper?: PaperName;
  width?: LengthArg;
  height?: LengthArg;
  /** Turns the size so its longer side runs across or down. */
  orientation?: 'portrait' | 'landscape';
}

/** `background #fcfaf5`, `background none`: the page color. */
export interface BackgroundInstruction extends InstructionBase {
  verb: 'background';
  /** A CSS color, or `null` for a transparent page. */
  color: string | null;
}

/** `name "card"`: the page's name, and the file stem it is written under. */
export interface NameInstruction extends InstructionBase {
  verb: 'name';
  name: string;
}

/** `units mm`: the unit bare numbers are read in from here on. */
export interface UnitsInstruction extends InstructionBase {
  verb: 'units';
  units: LengthUnit;
}

/** `seed 7`: the seed for the hand-drawn pass. */
export interface SeedInstruction extends InstructionBase {
  verb: 'seed';
  seed: number;
}

/** `newpage "Back"`: starts another page. */
export interface NewPageInstruction extends InstructionBase {
  verb: 'newpage';
  name?: string;
}

// Layers

/** A layer's own properties, shared by `layer` and `group`. */
interface LayerFields {
  name: string;
  /** 0 to 1. */
  opacity?: NumberArg;
  hidden?: boolean;
  locked?: boolean;
}

/** `layer "Sky" opacity 0.8`: marks after it go on this layer. */
export interface LayerInstruction extends InstructionBase, LayerFields {
  verb: 'layer';
}

/** `group "Figure" { ... }`: a group layer holding the layers in its body. */
export interface GroupInstruction extends InstructionBase, LayerFields {
  verb: 'group';
  body: DocumentInstruction[];
}

/**
 * `clip "Window" { ... }`: a group whose content shows only inside the
 * block's last closed shape, which paints nothing while it clips.
 */
export interface ClipInstruction extends InstructionBase {
  verb: 'clip';
  /** The group's name; "Clip Group" unless given. */
  name?: string;
  body: DocumentInstruction[];
}

// Paint

/** `tool marker`; `tool brush` is `tool pen`. */
export interface ToolInstruction extends InstructionBase {
  verb: 'tool';
  tool: ScriptTool | ToolAlias;
}

/** `color #1f2328`: the ink color. */
export interface ColorInstruction extends InstructionBase {
  verb: 'color';
  color: string;
}

/** `width 3`: the stroke width. */
export interface WidthInstruction extends InstructionBase {
  verb: 'width';
  width: LengthArg;
}

/** `opacity 0.5`: 0 to 1. */
export interface OpacityInstruction extends InstructionBase {
  verb: 'opacity';
  opacity: NumberArg;
}

/** `fill #ffe08a`, `fill none`. */
export interface FillInstruction extends InstructionBase {
  verb: 'fill';
  /** A CSS color, or `null` for no fill. */
  fill: string | null;
}

/** `gradient linear 90 (#ffe08a 0, #ff8a65 1)`, `gradient none`. */
export interface GradientInstruction extends InstructionBase {
  verb: 'gradient';
  type: 'linear' | 'radial' | 'none';
  /** Linear only: degrees, 0 running left to right, clockwise. */
  angle?: NumberArg;
  /** Two or more, for `linear` and `radial`. */
  stops?: StopArg[];
}

/** `stroke off`: with the outline off, a closed shape is its fill alone. */
export interface StrokeInstruction extends InstructionBase {
  verb: 'stroke';
  on: boolean;
}

/** `style dashed`. */
export interface StyleInstruction extends InstructionBase {
  verb: 'style';
  style: StrokeStyle;
}

/** `profile tapered`. */
export interface ProfileInstruction extends InstructionBase {
  verb: 'profile';
  profile: StrokeProfile;
}

/** `nib 30`: the copic nib angle, in degrees. */
export interface NibInstruction extends InstructionBase {
  verb: 'nib';
  angle: NumberArg;
}

/** `pencil 2B`, `pencil charcoal 4B`, `pencil vine soft #3b6e8f`: the Pencil at a grade, in its tone or a color. */
export interface PencilInstruction extends InstructionBase {
  verb: 'pencil';
  /** The pencil as the API names it (`core/pencil.ts`): `2B`, `charcoal-4B`, `vine-soft`. */
  pencil: string;
  /** A colored pencil's color; absent, the grade's own tone. */
  color?: string;
}

/** `rough 0.6 passes 2`, `rough off`: the hand-drawn pass. */
export interface RoughInstruction extends InstructionBase {
  verb: 'rough';
  /** 0 is exact; 1 is clearly drawn by hand. */
  amount: NumberArg;
  /** 1, or 2 to restate each line once, as a pencil does. */
  passes?: number;
  /** How far an open mark runs past its ends. */
  overshoot?: LengthArg;
}

/** `font "Georgia" 24`. */
export interface FontInstruction extends InstructionBase {
  verb: 'font';
  family?: string;
  size?: LengthArg;
}

/** `character face "Bold" tracking 50 underline`, `character reset`: the character attributes of text after it. */
export interface CharacterInstruction extends InstructionBase, CharacterFields {
  verb: 'character';
  /** Puts every character attribute back. */
  reset?: boolean;
}

/**
 * `textconfig "Callout" face "Bold" color #cc0000`: a Text Configuration - a
 * named set of character attributes the book keeps - which text follows with
 * `config`. Kerning by hand is a pair's, and not one of them.
 */
export interface TextConfigInstruction extends InstructionBase, Omit<CharacterFields, 'kern'> {
  verb: 'textconfig';
  name: string;
  size?: LengthArg;
  family?: string;
  color?: string;
}

/**
 * `accent python`: a Clean Language Accent for the next `text` - a language
 * by its id or a name highlight.js knows it by, `auto`, or `none` - whose
 * paragraphs are then colored as the language reads them.
 */
export interface AccentInstruction extends InstructionBase {
  verb: 'accent';
  language: string;
}

/** `paragraph align justify first 18 hyphenate`, `paragraph reset`: the paragraph attributes of text after it. */
export interface ParagraphInstruction extends InstructionBase {
  verb: 'paragraph';
  align?: 'left' | 'center' | 'right' | 'justify';
  /** The left indent, and the right one. */
  indent?: LengthArg;
  indentRight?: LengthArg;
  /** The first line's indent, on top of the left one; below 0 it hangs. */
  first?: LengthArg;
  before?: LengthArg;
  after?: LengthArg;
  hyphenate?: boolean;
  list?: 'bullet' | 'number' | 'none';
  level?: number;
  /** Puts every paragraph attribute back. */
  reset?: boolean;
}

// Shapes

/** `rect 20 20 360 80 r 12`. */
export interface RectInstruction extends InstructionBase {
  verb: 'rect';
  x: LengthArg;
  y: LengthArg;
  width: LengthArg;
  height: LengthArg;
  /** Corner radius. */
  radius?: LengthArg;
}

/** `circle 200 150 48`. */
export interface CircleInstruction extends InstructionBase {
  verb: 'circle';
  cx: LengthArg;
  cy: LengthArg;
  r: LengthArg;
}

/** `ellipse 200 150 120 60`. */
export interface EllipseInstruction extends InstructionBase {
  verb: 'ellipse';
  cx: LengthArg;
  cy: LengthArg;
  rx: LengthArg;
  ry: LengthArg;
}

/** `line 20 20 380 280`. */
export interface LineInstruction extends InstructionBase {
  verb: 'line';
  x1: LengthArg;
  y1: LengthArg;
  x2: LengthArg;
  y2: LengthArg;
}

/** `polygon 200 40, 360 260, 40 260 r 8`. */
export interface PolygonInstruction extends InstructionBase {
  verb: 'polygon';
  points: PointArg[];
  /** Corner radius. */
  radius?: LengthArg;
}

/** `polyline 20 200, 120 120, 220 200`. */
export interface PolylineInstruction extends InstructionBase {
  verb: 'polyline';
  points: PointArg[];
}

/** `star 200 150 80 32 5`. */
export interface StarInstruction extends InstructionBase {
  verb: 'star';
  cx: LengthArg;
  cy: LengthArg;
  outer: LengthArg;
  inner: LengthArg;
  /** How many points the star has. */
  count: NumberArg;
}

/** `arc 200 150 80 0 90`: degrees, clockwise from three o'clock. */
export interface ArcInstruction extends InstructionBase {
  verb: 'arc';
  cx: LengthArg;
  cy: LengthArg;
  r: LengthArg;
  from: NumberArg;
  to: NumberArg;
}

/** `spiral 200 150 90 3`. */
export interface SpiralInstruction extends InstructionBase {
  verb: 'spiral';
  cx: LengthArg;
  cy: LengthArg;
  r: LengthArg;
  turns: NumberArg;
}

/** `shape "cube-isometric" at 40 40 size 120`: a library shape in a box. */
export interface ShapeInstruction extends InstructionBase {
  verb: 'shape';
  /** A name from the shape library, in any case. */
  name: string;
  x: LengthArg;
  y: LengthArg;
  /**
   * The box's width. Without a height it is the length of the shape's longer
   * side instead, and the other side keeps the shape's proportions.
   */
  width: LengthArg;
  /** The box's height: given, the shape is stretched to `width` by `height`. */
  height?: LengthArg;
}

/**
 * `wipe out-front { circle 100 100 60  circle 150 100 60 }`: the marks the
 * block draws, combined as the Wipe Stacks combine them, with what is left
 * drawn in their place.
 */
export interface WipeInstruction extends InstructionBase {
  verb: 'wipe';
  /** Which wipe: Wipe In, Wipe Out's two, Mid Wipe, Outer Wipes or Clean Wipe (`core/wipe.ts`'s ops). */
  op: WipeOp;
  body: DocumentInstruction[];
}

/**
 * `stack merge 60 100, 125 100 { ... }`: the marks the block draws stacked as
 * the Shape Stacker stacks them, at the pieces under the points.
 */
export interface StackInstruction extends InstructionBase {
  verb: 'stack';
  /** Merge the pieces under the points into one shape, or take them away. */
  mode: StackMode;
  /** Where the pieces are, as the `stack` line's transform places them. */
  points: PointArg[];
  body: DocumentInstruction[];
}

// Paths

/** `path "M20 20 C60 0 100 40 140 20"`, or `path { ... }`. */
export interface PathInstruction extends InstructionBase {
  verb: 'path';
  /** SVG path data. */
  d?: string;
  /** Path steps, when there is no `d`. */
  body?: PathStep[];
}

/** `move 20 20`: starts a subpath. Inside `path` only. */
export interface MoveInstruction extends InstructionBase {
  verb: 'move';
  x: LengthArg;
  y: LengthArg;
}

/** `to 120 20`: a straight segment to a point. Inside `path` only. */
export interface ToInstruction extends InstructionBase {
  verb: 'to';
  x: LengthArg;
  y: LengthArg;
}

/** `by 100 0`: a straight segment by an offset. Inside `path` only. */
export interface ByInstruction extends InstructionBase {
  verb: 'by';
  dx: LengthArg;
  dy: LengthArg;
}

/** `curve 60 20 140 20 180 100`: a cubic segment. Inside `path` only. */
export interface CurveInstruction extends InstructionBase {
  verb: 'curve';
  c1x: LengthArg;
  c1y: LengthArg;
  c2x: LengthArg;
  c2y: LengthArg;
  x: LengthArg;
  y: LengthArg;
}

/** `smooth 300 180 340 100`: a cubic whose first handle mirrors the last. */
export interface SmoothInstruction extends InstructionBase {
  verb: 'smooth';
  c2x: LengthArg;
  c2y: LengthArg;
  x: LengthArg;
  y: LengthArg;
}

/** `through 20 100, 80 40, 140 100`: a curve through the points. */
export interface ThroughInstruction extends InstructionBase {
  verb: 'through';
  points: PointArg[];
}

/** `close`: back to the subpath's start. Inside `path` only. */
export interface CloseInstruction extends InstructionBase {
  verb: 'close';
}

// Transforms

/** `push`: saves the transform, the paint state and the units. */
export interface PushInstruction extends InstructionBase {
  verb: 'push';
}

/** `pop`: restores what the last `push` saved. */
export interface PopInstruction extends InstructionBase {
  verb: 'pop';
}

/** `translate 40 0`. */
export interface TranslateInstruction extends InstructionBase {
  verb: 'translate';
  dx: LengthArg;
  dy: LengthArg;
}

/** `rotate 45 at 200 150`: about the origin unless a point is given. */
export interface RotateInstruction extends InstructionBase {
  verb: 'rotate';
  angle: NumberArg;
  cx?: LengthArg;
  cy?: LengthArg;
}

/** `scale 2`, `scale 2 1 at 200 150`: about the origin unless a point is given. */
export interface ScaleInstruction extends InstructionBase {
  verb: 'scale';
  sx: NumberArg;
  /** Defaults to `sx`. */
  sy?: NumberArg;
  cx?: LengthArg;
  cy?: LengthArg;
}

/** `mirror x at 200`: across a vertical line (`x`) or a horizontal one (`y`). */
export interface MirrorInstruction extends InstructionBase {
  verb: 'mirror';
  axis: 'x' | 'y';
  /** Where the line crosses its axis. 0 unless given. */
  about?: LengthArg;
}

// Control

/** `let gap 24`, `let margin 10mm`: a named number, in the current units. */
export interface LetInstruction extends InstructionBase {
  verb: 'let';
  name: string;
  value: LengthArg;
}

/** `define "tick" { ... }`: records a block without drawing it. */
export interface DefineInstruction extends InstructionBase {
  verb: 'define';
  name: string;
  body: DocumentInstruction[];
}

/** `place "tick" at 40 40 scale 2 rotate 15`: draws a definition. */
export interface PlaceInstruction extends InstructionBase {
  verb: 'place';
  name: string;
  x?: LengthArg;
  y?: LengthArg;
  scale?: NumberArg;
  rotate?: NumberArg;
}

/** `repeat 10 as i { ... }`: runs a block, counting from 0. */
export interface RepeatInstruction extends InstructionBase {
  verb: 'repeat';
  count: NumberArg;
  /** The counter's name, for expressions in the block. */
  as?: string;
  body: DocumentInstruction[];
}

// Text and media

/** `text "Acme Corp" at 200 70 size 28 align center`. */
export interface TextInstruction extends InstructionBase {
  verb: 'text';
  text: string;
  x: LengthArg;
  y: LengthArg;
  size?: LengthArg;
  /** A fixed wrap width. Without one the box is measured from the text. */
  box?: LengthArg;
  /** Sheet Typing inside a shape: SVG path data, from `at`. */
  inside?: string;
  /** Path Typing along a path: SVG path data, from `at`. */
  along?: string;
  /** How far along the path the text starts. */
  start?: LengthArg;
  /** The text runs the other way along its path, on the other side. */
  flip?: boolean;
  effect?: 'rainbow' | 'skew' | 'ribbon' | 'stair' | 'gravity';
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Upright characters down columns that run right to left. */
  vertical?: boolean;
  /** The Text Configuration the whole text follows, by name: what `character` set, and its runs, override it. */
  config?: string;
  /** Runs of the text's characters in styles of their own. */
  runs?: RunArg[];
  /** The text is Markdown, shown as it renders: Markdown Flow. */
  markdown?: boolean;
  /** Draws the letters as pen strokes instead of a text item. */
  asMarks?: boolean;
}

/** `image "logo" at 20 20 size 120`: an asset the host supplied, or a data URL. */
export interface ImageInstruction extends InstructionBase {
  verb: 'image';
  src: string;
  x: LengthArg;
  y: LengthArg;
  width?: LengthArg;
  height?: LengthArg;
}

/** `link "assets/logo.svg" at 20 120 size 120 120 name "Logo"`: a linked file. */
export interface LinkInstruction extends InstructionBase {
  verb: 'link';
  href: string;
  x: LengthArg;
  y: LengthArg;
  width?: LengthArg;
  height?: LengthArg;
  /** The layer name it is shown under. */
  name?: string;
}

/** `use "badge" at 200 40 scale 0.5`: copies in a document the host supplied. */
export interface UseInstruction extends InstructionBase {
  verb: 'use';
  name: string;
  x?: LengthArg;
  y?: LengthArg;
  scale?: NumberArg;
  /** The group it lands in. Defaults to the document's name. */
  layer?: string;
}

// Effects

/**
 * `effect blur 4`, `effect drop-shadow 4 4 8 #00000066`, `effect bevel size 6`,
 * `effect none`: an effect for the next layer, group or mark, by its CSS
 * filter function's name or its appearance effect's (core/effects.ts).
 */
/** A Warp's style as a script may name it: this app's name, or a vector editor's (core/warp-styles.ts). */
export type WarpStyleWord =
  | 'arc'
  | 'arch'
  | 'unroll'
  | 'shell'
  | 'windy'
  | 'breezy'
  | 'curvy'
  | 'chart'
  | 'puffy'
  | 'expand'
  | 'cram'
  | 'twirl'
  | 'arc-lower'
  | 'arc-upper'
  | 'bulge'
  | 'shell-lower'
  | 'shell-upper'
  | 'flag'
  | 'wave'
  | 'fish'
  | 'rise'
  | 'fisheye'
  | 'inflate'
  | 'squeeze'
  | 'twist';

export interface EffectInstruction extends InstructionBase {
  verb: 'effect';
  type:
    | 'blur'
    | 'brightness'
    | 'contrast'
    | 'saturate'
    | 'grayscale'
    | 'sepia'
    | 'invert'
    | 'hue-rotate'
    | 'opacity'
    | 'drop-shadow'
    | 'feather'
    | 'bevel'
    | 'emboss'
    | 'inner-shadow'
    | 'outer-glow'
    | 'inner-glow'
    | 'splatter'
    | 'warp'
    | 'extrude'
    | 'revolve'
    | 'none';
  /** `blur`: the standard deviation, as CSS's `blur()` length is. */
  radius?: LengthArg;
  /** A factor for `brightness`, `contrast` and `saturate`; a share from 0 to 1 for `grayscale`, `sepia`, `invert` and `opacity`. */
  amount?: NumberArg;
  /** `hue-rotate`: degrees; `splatter`: the hatch's direction, degrees counterclockwise from the right. */
  angle?: NumberArg;
  /** `drop-shadow`: the offset across and down. */
  dx?: LengthArg;
  dy?: LengthArg;
  /** `drop-shadow`: the blur radius, twice the standard deviation, as CSS has it. */
  blur?: LengthArg;
  /** `drop-shadow`, `inner-shadow` and the glows: the shadow's or the glow's color. */
  color?: string;
  /** `drop-shadow` and `outer-glow`: how much of the blur becomes a firm edge first, 0 to 100. */
  spread?: NumberArg;
  /** `inner-shadow` and `inner-glow`: the same, inside the shape. */
  choke?: NumberArg;
  /** A shadow's or a glow's blend, by any name of a mode (core/blend.ts). */
  blend?: string;
  /** A shadow's or a glow's opacity, 0 to 1. */
  opacity?: NumberArg;
  /**
   * `bevel`: `inner` or `outer`; `emboss`: `emboss` or `pillow`; `warp`: its
   * style, by this app's name or a vector editor's (core/warp-styles.ts).
   */
  style?: 'inner' | 'outer' | 'emboss' | 'pillow' | WarpStyleWord;
  /** `bevel` and `emboss`: how far the slope reaches. */
  size?: LengthArg;
  /** `bevel` and `emboss`: how steep the slope looks, in percent; `extrude`: how deep the shape is set. */
  depth?: LengthArg;
  /** `bevel` and `emboss`: how high the light stands, in degrees. (Its `angle` is where it comes from.) */
  altitude?: NumberArg;
  /** `bevel` and `emboss`: a blur over the light and the shade. */
  soften?: LengthArg;
  /** `bevel` and `emboss`: raised (`up`) or pressed in (`down`). */
  direction?: 'up' | 'down';
  /** `bevel` and `emboss`: the light's color, opacity and blend. */
  lightColor?: string;
  lightOpacity?: NumberArg;
  lightBlend?: string;
  /** `bevel` and `emboss`: the shade's color, opacity and blend. */
  shadeColor?: string;
  shadeOpacity?: NumberArg;
  shadeBlend?: string;
  /** `inner-glow`: from the shape's `edge` or its `center`. */
  source?: 'edge' | 'center';
  /** `splatter`: a preset to start from, by its name (core/splatter.ts). */
  preset?: string;
  /** `splatter`: how far each fold reaches past the edge (negative: short of it), and how much that varies. */
  overlap?: LengthArg;
  overlapVariation?: LengthArg;
  /** `splatter`: the hatch line's width. */
  width?: LengthArg;
  /** `splatter`: how round each turn is, in percent, and how much that varies. */
  curviness?: NumberArg;
  curvinessVariation?: NumberArg;
  /** `splatter`: the distance between passes, and how much that varies. */
  spacing?: LengthArg;
  spacingVariation?: LengthArg;
  /** `splatter`: seeds every variation, so the hatch draws the same every time. */
  seed?: NumberArg;
  /** `warp`: how far it bends, in percent, -100 to 100. */
  bend?: NumberArg;
  /** `warp`: along the box's width (`horizontal`) or its height (`vertical`). */
  orientation?: 'horizontal' | 'vertical';
  /** `warp`: the taper across the box and up it, in percent, -100 to 100. */
  distortH?: NumberArg;
  distortV?: NumberArg;
  /** `warp`: the part of the box Arc and Shell bend. */
  part?: 'whole' | 'lower' | 'upper';
  /** `extrude` and `revolve`: left open - no caps. */
  hollow?: boolean;
  /** `revolve`: how far the axis stands off the shape's edge, and which edge. (Its `angle` is how far round.) */
  offset?: LengthArg;
  axis?: 'left' | 'right';
  /** `revolve`: how many steps round; 0 works them out. */
  segments?: NumberArg;
  /** `extrude` and `revolve`: the turn about X, then Y, then Z, in degrees. */
  rotateX?: NumberArg;
  rotateY?: NumberArg;
  rotateZ?: NumberArg;
  /** `extrude` and `revolve`: how far it is moved, across, down and toward the viewer. */
  positionX?: LengthArg;
  positionY?: LengthArg;
  positionZ?: LengthArg;
  /** `extrude` and `revolve`: its scale along X, Y and Z, 1 as it is. */
  scaleX?: NumberArg;
  scaleY?: NumberArg;
  scaleZ?: NumberArg;
  /** `extrude` and `revolve`: the perspective, 0 to 160 degrees. */
  perspective?: NumberArg;
  /** `extrude` and `revolve`: how the faces are painted. */
  shading?: 'plastic' | 'diffuse' | 'none' | 'wireframe';
  /** `extrude` and `revolve`: where the light comes from - degrees round from the right, and up off the page - and how strong it and the light all round are, 0 to 1. */
  lightAzimuth?: NumberArg;
  lightElevation?: NumberArg;
  lightIntensity?: NumberArg;
  lightAmbient?: NumberArg;
  /** On a mark, the part it works on alone: its `fill` or its `stroke`. */
  target?: 'fill' | 'stroke';
  /** Kept without being drawn, as the Appearance panel's closed eye keeps it. */
  hidden?: boolean;
}

/**
 * `blend stack`, `blend multiply`: how the next layer or group mixes with what
 * is drawn under it, by a Napkin Blend's name or Illustrator's (core/blend.ts).
 */
export interface BlendInstruction extends InstructionBase {
  verb: 'blend';
  /** A name of a mode, as the verb table lists them. */
  mode: string;
}

// Output

/** `crop auto pad 12`, `crop none`, `crop 0 0 400 300`. */
export interface CropInstruction extends InstructionBase {
  verb: 'crop';
  mode: 'auto' | 'none' | 'box';
  /** `auto` only: room left around the ink. */
  pad?: LengthArg;
  x?: LengthArg;
  y?: LengthArg;
  width?: LengthArg;
  height?: LengthArg;
}

/** `registration 0 0 400 300`: one box every page is written in. */
export interface RegistrationInstruction extends InstructionBase {
  verb: 'registration';
  x: LengthArg;
  y: LengthArg;
  width: LengthArg;
  height: LengthArg;
}

/** `split 120 60`: the topmost path drawn so far within 4 px of the point, cut there. */
export interface SplitInstruction extends InstructionBase {
  verb: 'split';
  x: LengthArg;
  y: LengthArg;
}

/** `smear 24 0.6 10 80, 150 80`: a pass of the Smear, a blending stump, over the pencil marks drawn so far. */
export interface SmearInstruction extends InstructionBase {
  verb: 'smear';
  /** The stump's width. */
  width: LengthArg;
  /** Its strength, 0 to 1. */
  strength: NumberArg;
  points: PointArg[];
}

/** `warp 120 40 30 0 24`: Liquify's Warp, a brush pushed from the point by `dx`, `dy`, over the marks drawn so far. */
export interface WarpInstruction extends InstructionBase {
  verb: 'warp';
  x: LengthArg;
  y: LengthArg;
  /** The brush's radius. */
  radius: LengthArg;
  dx: LengthArg;
  dy: LengthArg;
}

/** `twirl 120 100 70 90`: one of Liquify's brushes pressed once at the point, over the marks drawn so far. */
export interface LiquifyInstruction extends InstructionBase {
  verb: 'twirl' | 'pucker' | 'bloat';
  x: LengthArg;
  y: LengthArg;
  /** The brush's radius. */
  radius: LengthArg;
  /** Twirl's turn at the centre, in degrees; Pucker's and Bloat's share of a point's distance, 0 to 1. */
  amount: NumberArg;
}

/** Instructions that only make sense inside a `path` block. */
export type PathOnlyInstruction =
  | MoveInstruction
  | ToInstruction
  | ByInstruction
  | CurveInstruction
  | SmoothInstruction
  | CloseInstruction;

/** What a `path` block holds: its own steps, plus `through`. */
export type PathStep = PathOnlyInstruction | ThroughInstruction;

/** Every instruction. */
export type Instruction =
  | NapkinInstruction
  | PageInstruction
  | BackgroundInstruction
  | NameInstruction
  | UnitsInstruction
  | SeedInstruction
  | NewPageInstruction
  | LayerInstruction
  | GroupInstruction
  | ClipInstruction
  | ToolInstruction
  | ColorInstruction
  | WidthInstruction
  | OpacityInstruction
  | FillInstruction
  | GradientInstruction
  | StrokeInstruction
  | StyleInstruction
  | ProfileInstruction
  | NibInstruction
  | PencilInstruction
  | RoughInstruction
  | FontInstruction
  | CharacterInstruction
  | ParagraphInstruction
  | TextConfigInstruction
  | AccentInstruction
  | RectInstruction
  | CircleInstruction
  | EllipseInstruction
  | LineInstruction
  | PolygonInstruction
  | PolylineInstruction
  | StarInstruction
  | ArcInstruction
  | SpiralInstruction
  | ShapeInstruction
  | WipeInstruction
  | StackInstruction
  | PathInstruction
  | MoveInstruction
  | ToInstruction
  | ByInstruction
  | CurveInstruction
  | SmoothInstruction
  | ThroughInstruction
  | CloseInstruction
  | SplitInstruction
  | SmearInstruction
  | WarpInstruction
  | LiquifyInstruction
  | PushInstruction
  | PopInstruction
  | TranslateInstruction
  | RotateInstruction
  | ScaleInstruction
  | MirrorInstruction
  | LetInstruction
  | DefineInstruction
  | PlaceInstruction
  | RepeatInstruction
  | TextInstruction
  | ImageInstruction
  | LinkInstruction
  | UseInstruction
  | EffectInstruction
  | BlendInstruction
  | CropInstruction
  | RegistrationInstruction;

/**
 * Instructions that may appear outside a `path` block: at the top of a script,
 * and in the body of a group, a definition or a repeat.
 */
export type DocumentInstruction = Exclude<Instruction, PathOnlyInstruction>;

/**
 * A whole script: its instructions, in order. The first is usually `napkin`,
 * naming the version it was written for.
 */
export type Script = DocumentInstruction[];

/** Every verb. */
export type Verb = Instruction['verb'];

type InstructionOf<V extends Verb> = Extract<Instruction, { verb: V }>;
type FieldOf<V extends Verb> = Exclude<keyof InstructionOf<V>, 'verb' | 'at'>;
type Presence<V extends Verb, F extends keyof InstructionOf<V>> =
  undefined extends InstructionOf<V>[F] ? 'optional' : 'required';

/**
 * Every verb's fields, and whether each one is required.
 *
 * The type makes this table exact: leave a verb or a field out, add one the
 * instruction does not have, or call an optional field required, and it does
 * not compile. That turns it into the runtime copy of the union above, which
 * is what the test comparing it with `verbs.json` needs.
 */
export const INSTRUCTION_FIELDS: {
  readonly [V in Verb]: { readonly [F in FieldOf<V>]: Presence<V, F> };
} = {
  napkin: { version: 'required' },
  page: { paper: 'optional', width: 'optional', height: 'optional', orientation: 'optional' },
  background: { color: 'required' },
  name: { name: 'required' },
  units: { units: 'required' },
  seed: { seed: 'required' },
  newpage: { name: 'optional' },
  layer: { name: 'required', opacity: 'optional', hidden: 'optional', locked: 'optional' },
  group: { name: 'required', opacity: 'optional', hidden: 'optional', locked: 'optional', body: 'required' },
  clip: { name: 'optional', body: 'required' },
  tool: { tool: 'required' },
  color: { color: 'required' },
  width: { width: 'required' },
  opacity: { opacity: 'required' },
  fill: { fill: 'required' },
  gradient: { type: 'required', angle: 'optional', stops: 'optional' },
  stroke: { on: 'required' },
  style: { style: 'required' },
  profile: { profile: 'required' },
  nib: { angle: 'required' },
  pencil: { pencil: 'required', color: 'optional' },
  rough: { amount: 'required', passes: 'optional', overshoot: 'optional' },
  font: { family: 'optional', size: 'optional' },
  character: {
    face: 'optional',
    tracking: 'optional',
    kern: 'optional',
    kerning: 'optional',
    leading: 'optional',
    spacing: 'optional',
    caps: 'optional',
    hscale: 'optional',
    vscale: 'optional',
    shift: 'optional',
    rotate: 'optional',
    highlight: 'optional',
    position: 'optional',
    underline: 'optional',
    strike: 'optional',
    reset: 'optional',
  },
  paragraph: {
    align: 'optional',
    indent: 'optional',
    indentRight: 'optional',
    first: 'optional',
    before: 'optional',
    after: 'optional',
    hyphenate: 'optional',
    list: 'optional',
    level: 'optional',
    reset: 'optional',
  },
  textconfig: {
    name: 'required',
    face: 'optional',
    tracking: 'optional',
    kerning: 'optional',
    leading: 'optional',
    spacing: 'optional',
    caps: 'optional',
    hscale: 'optional',
    vscale: 'optional',
    shift: 'optional',
    rotate: 'optional',
    highlight: 'optional',
    position: 'optional',
    underline: 'optional',
    strike: 'optional',
    size: 'optional',
    family: 'optional',
    color: 'optional',
  },
  accent: { language: 'required' },
  rect: { x: 'required', y: 'required', width: 'required', height: 'required', radius: 'optional' },
  circle: { cx: 'required', cy: 'required', r: 'required' },
  ellipse: { cx: 'required', cy: 'required', rx: 'required', ry: 'required' },
  line: { x1: 'required', y1: 'required', x2: 'required', y2: 'required' },
  polygon: { points: 'required', radius: 'optional' },
  polyline: { points: 'required' },
  star: { cx: 'required', cy: 'required', outer: 'required', inner: 'required', count: 'required' },
  arc: { cx: 'required', cy: 'required', r: 'required', from: 'required', to: 'required' },
  spiral: { cx: 'required', cy: 'required', r: 'required', turns: 'required' },
  shape: { name: 'required', x: 'required', y: 'required', width: 'required', height: 'optional' },
  wipe: { op: 'required', body: 'required' },
  stack: { mode: 'required', points: 'required', body: 'required' },
  path: { d: 'optional', body: 'optional' },
  move: { x: 'required', y: 'required' },
  to: { x: 'required', y: 'required' },
  by: { dx: 'required', dy: 'required' },
  curve: { c1x: 'required', c1y: 'required', c2x: 'required', c2y: 'required', x: 'required', y: 'required' },
  smooth: { c2x: 'required', c2y: 'required', x: 'required', y: 'required' },
  through: { points: 'required' },
  close: {},
  split: { x: 'required', y: 'required' },
  smear: { width: 'required', strength: 'required', points: 'required' },
  warp: { x: 'required', y: 'required', radius: 'required', dx: 'required', dy: 'required' },
  twirl: { x: 'required', y: 'required', radius: 'required', amount: 'required' },
  pucker: { x: 'required', y: 'required', radius: 'required', amount: 'required' },
  bloat: { x: 'required', y: 'required', radius: 'required', amount: 'required' },
  push: {},
  pop: {},
  translate: { dx: 'required', dy: 'required' },
  rotate: { angle: 'required', cx: 'optional', cy: 'optional' },
  scale: { sx: 'required', sy: 'optional', cx: 'optional', cy: 'optional' },
  mirror: { axis: 'required', about: 'optional' },
  let: { name: 'required', value: 'required' },
  define: { name: 'required', body: 'required' },
  place: { name: 'required', x: 'optional', y: 'optional', scale: 'optional', rotate: 'optional' },
  repeat: { count: 'required', as: 'optional', body: 'required' },
  text: {
    text: 'required',
    x: 'required',
    y: 'required',
    size: 'optional',
    box: 'optional',
    inside: 'optional',
    along: 'optional',
    start: 'optional',
    flip: 'optional',
    effect: 'optional',
    align: 'optional',
    vertical: 'optional',
    config: 'optional',
    runs: 'optional',
    markdown: 'optional',
    asMarks: 'optional',
  },
  image: { src: 'required', x: 'required', y: 'required', width: 'optional', height: 'optional' },
  link: { href: 'required', x: 'required', y: 'required', width: 'optional', height: 'optional', name: 'optional' },
  use: { name: 'required', x: 'optional', y: 'optional', scale: 'optional', layer: 'optional' },
  effect: {
    type: 'required',
    radius: 'optional',
    amount: 'optional',
    angle: 'optional',
    dx: 'optional',
    dy: 'optional',
    blur: 'optional',
    color: 'optional',
    spread: 'optional',
    choke: 'optional',
    blend: 'optional',
    opacity: 'optional',
    style: 'optional',
    size: 'optional',
    depth: 'optional',
    altitude: 'optional',
    soften: 'optional',
    direction: 'optional',
    lightColor: 'optional',
    lightOpacity: 'optional',
    lightBlend: 'optional',
    shadeColor: 'optional',
    shadeOpacity: 'optional',
    shadeBlend: 'optional',
    source: 'optional',
    preset: 'optional',
    overlap: 'optional',
    overlapVariation: 'optional',
    width: 'optional',
    curviness: 'optional',
    curvinessVariation: 'optional',
    spacing: 'optional',
    spacingVariation: 'optional',
    seed: 'optional',
    bend: 'optional',
    orientation: 'optional',
    distortH: 'optional',
    distortV: 'optional',
    part: 'optional',
    hollow: 'optional',
    offset: 'optional',
    axis: 'optional',
    segments: 'optional',
    rotateX: 'optional',
    rotateY: 'optional',
    rotateZ: 'optional',
    positionX: 'optional',
    positionY: 'optional',
    positionZ: 'optional',
    scaleX: 'optional',
    scaleY: 'optional',
    scaleZ: 'optional',
    perspective: 'optional',
    shading: 'optional',
    lightAzimuth: 'optional',
    lightElevation: 'optional',
    lightIntensity: 'optional',
    lightAmbient: 'optional',
    target: 'optional',
    hidden: 'optional',
  },
  blend: { mode: 'required' },
  crop: { mode: 'required', pad: 'optional', x: 'optional', y: 'optional', width: 'optional', height: 'optional' },
  registration: { x: 'required', y: 'required', width: 'required', height: 'required' },
};

/** Every verb, in the verb table's order. */
export const VERB_NAMES: readonly Verb[] = Object.keys(INSTRUCTION_FIELDS) as Verb[];

/** The verbs that only make sense inside a `path` block. */
export const PATH_ONLY_VERBS: readonly PathOnlyInstruction['verb'][] = ['move', 'to', 'by', 'curve', 'smooth', 'close'];

// ---- Diagnostics ---------------------------------------------------------

/** How serious a diagnostic is. An error skips its instruction; a warning does not. */
export type DiagnosticLevel = 'error' | 'warning';

/**
 * The stable codes a diagnostic carries. A program matches on these, never on
 * the message, so a code is never renamed or reused; new ones are added.
 */
export type DiagnosticCode =
  | 'unknown-verb'
  | 'misplaced-verb'
  | 'unsupported-verb'
  | 'expected-number'
  | 'expected-length'
  | 'expected-string'
  | 'expected-identifier'
  | 'expected-color'
  | 'expected-choice'
  | 'expected-points'
  | 'expected-stops'
  | 'unexpected-token'
  | 'missing-argument'
  | 'expected-block'
  | 'unclosed-block'
  | 'unexpected-close'
  | 'unclosed-string'
  | 'invalid-expression'
  | 'unit-unknown'
  | 'invalid-value'
  | 'version-missing'
  | 'version-unsupported'
  | 'unknown-variable'
  | 'unknown-definition'
  | 'unknown-shape'
  | 'unknown-asset'
  | 'unknown-document'
  | 'unknown-config'
  | 'image-size-unknown'
  | 'glyph-missing'
  | 'unknown-field'
  | 'recursive-definition'
  | 'division-by-zero'
  | 'budget-exceeded'
  | 'pop-without-push'
  | 'unbalanced-push'
  | 'duplicate-definition'
  | 'link-unresolved'
  | 'unused-effect'
  | 'unused-blend'
  | 'unused-accent'
  | 'wipe-skipped'
  | 'wipe-empty'
  | 'wipe-failed'
  | 'stack-missed'
  | 'split-missed'
  | 'clip-open'
  | 'smear-missed'
  | 'liquify-missed'
  | 'erase-skipped';

/** Every diagnostic code, and the level it is reported at. */
export const DIAGNOSTIC_LEVELS: { readonly [C in DiagnosticCode]: DiagnosticLevel } = {
  'unknown-verb': 'error',
  'misplaced-verb': 'error',
  'unsupported-verb': 'error',
  'expected-number': 'error',
  'expected-length': 'error',
  'expected-string': 'error',
  'expected-identifier': 'error',
  'expected-color': 'error',
  'expected-choice': 'error',
  'expected-points': 'error',
  'expected-stops': 'error',
  'unexpected-token': 'error',
  'missing-argument': 'error',
  'expected-block': 'error',
  'unclosed-block': 'error',
  'unexpected-close': 'error',
  'unclosed-string': 'error',
  'invalid-expression': 'error',
  'unit-unknown': 'error',
  'invalid-value': 'error',
  'version-missing': 'warning',
  'version-unsupported': 'error',
  'unknown-variable': 'error',
  'unknown-definition': 'error',
  'unknown-shape': 'error',
  'unknown-asset': 'error',
  'unknown-document': 'error',
  'unknown-config': 'error',
  'image-size-unknown': 'warning',
  'glyph-missing': 'warning',
  'unknown-field': 'warning',
  'recursive-definition': 'error',
  'division-by-zero': 'error',
  'budget-exceeded': 'error',
  'pop-without-push': 'error',
  'unbalanced-push': 'warning',
  'duplicate-definition': 'warning',
  'link-unresolved': 'warning',
  'unused-effect': 'warning',
  'unused-blend': 'warning',
  'unused-accent': 'warning',
  'wipe-skipped': 'warning',
  'wipe-empty': 'warning',
  'wipe-failed': 'warning',
  'stack-missed': 'warning',
  'split-missed': 'warning',
  'clip-open': 'warning',
  'smear-missed': 'warning',
  'liquify-missed': 'warning',
  'erase-skipped': 'warning',
};

/** Something a script did that the reader should know about. */
export interface Diagnostic {
  level: DiagnosticLevel;
  code: DiagnosticCode;
  /** One sentence for a person. Not stable; match on `code`. */
  message: string;
  /** Where in a text script, 1-based. */
  line?: number;
  column?: number;
  /**
   * Where in an object-form script: the instruction's index, then its index in
   * each enclosing body. `[3, 0]` is the first instruction in the body of the
   * fourth.
   */
  index?: number[];
  /** The verb being read or run. */
  verb?: string;
  /** What would have been accepted, for the `expected-*` codes. */
  expected?: string;
}

// ---- Version and limits -------------------------------------------------------

/** The newest script version this build reads. */
export const SCRIPT_VERSION = 1;

/** How much one evaluation may do before it stops. */
export interface ScriptLimits {
  /** Instructions executed, counting every pass through a `repeat` body. */
  instructions: number;
  /** Marks emitted: strokes, text items, images and links. */
  marks: number;
  /** Bezier anchors emitted, across every mark. */
  anchors: number;
  /**
   * Points sampled from those anchors for the canvas to paint. A curved
   * segment samples to many points and a straight one to a single point, so
   * this, not the mark count, is what bounds memory and file size.
   */
  points: number;
  /** Blocks open at once: groups, clips, definitions being placed, repeats, wipes, stacks. */
  depth: number;
}

/**
 * The default budget: one cap for everything that runs a script, named once.
 * A script that reaches it stops with `budget-exceeded` and keeps what it drew.
 * A caller that means to draw more raises it deliberately.
 *
 * The numbers were measured, in Node 21 on the machine this was written on.
 * Sampled points are the cost that matters: at a million of them, building the
 * marks, writing the SVG and writing the `.skbk` take about two seconds
 * together and the `.skbk` is about 155 MB, while 50,000 circles of radius 14
 * or more - 97 points each, since a curved segment samples to at most 24 -
 * come to 4.85 million points, and the `.skbk` writer cannot hold the result
 * in one string at all. Instructions that draw nothing are nearly free
 * (200,000 run in under 10 ms), so their cap exists to stop a loop that never
 * ends rather than to bound work.
 */
export const SCRIPT_LIMITS: Readonly<ScriptLimits> = Object.freeze({
  instructions: 200000,
  marks: 50000,
  anchors: 250000,
  points: 1000000,
  depth: 64,
});

// ---- The verb table ----------------------------------------------------------

/** The verb categories, in the order the documentation lists them. */
export const VERB_CATEGORY_IDS = [
  'document',
  'layers',
  'paint',
  'shapes',
  'paths',
  'transforms',
  'control',
  'media',
  'effects',
  'output',
] as const;

/** A verb category. */
export type VerbCategory = (typeof VERB_CATEGORY_IDS)[number];

/** Where a verb may appear: outside a `path` block, only inside one, or both. */
export type VerbContext = 'document' | 'path' | 'any';

/** What a slot reads. */
export type SlotType =
  | 'length'
  | 'number'
  | 'integer'
  | 'string'
  | 'identifier'
  | 'color'
  | 'choice'
  | 'switch'
  | 'pencil'
  | 'language'
  | 'points'
  | 'stops'
  | 'runs';

/**
 * What a percentage in a slot is a share of: the page's width (`x`), its
 * height (`y`), the shorter of the two (`min`), nothing (`none`, a percentage
 * is refused), or the axis named by the instruction's own `axis` field.
 */
export type PercentAxis = 'x' | 'y' | 'min' | 'none' | 'axis';

/** One argument, read into one field. */
export interface SlotPart {
  slot: string;
  type: SlotType;
  axis?: PercentAxis;
  /** The words a `choice` slot accepts. */
  choices?: string[];
  /** The fewest points a `points` slot accepts. */
  minItems?: number;
  optional?: boolean;
  /** True when an expression is not accepted, only a literal. */
  literal?: boolean;
  /** True when a number may carry a percent sign, which it stands for anyway: a Warp's bend. */
  percent?: boolean;
}

/** A fixed word in a fixed position: `none` in `fill none`. */
export interface WordPart {
  word: string;
}

/** A keyword and the slots after it, in any order after the positional ones: `at <x> <y>`. */
export interface ClausePart {
  clause: string;
  optional?: boolean;
  parts: SlotPart[];
}

/** One or more words that set a field when present: `landscape`, `as marks`. */
export interface FlagPart {
  flag: string;
  field: string;
  value: string | number | boolean;
}

/** A block opened with `{` at the end of the line. */
export interface BlockPart {
  block: 'instructions' | 'path';
  field: string;
}

/** One piece of a verb's grammar. */
export type FormPart = SlotPart | WordPart | ClausePart | FlagPart | BlockPart;

/**
 * One way of writing a verb. Positional slots and words come first, in order;
 * then clauses and flags, in any order, each at most once; then a block, when
 * the form has one. `set` fills fields the form implies without writing them.
 */
export interface VerbForm {
  signature: string;
  parts: FormPart[];
  set?: Record<string, string | number | boolean | null>;
}

/** One row of the verb table. */
export interface VerbSpec {
  name: Verb;
  category: VerbCategory;
  context: VerbContext;
  summary: string;
  /** A complete snippet that runs as written. */
  example: string;
  forms: VerbForm[];
}

/** A verb category, as the documentation introduces it. */
export interface CategorySpec {
  id: VerbCategory;
  title: string;
  summary: string;
}

/** A diagnostic code, as the documentation describes it. */
export interface DiagnosticSpec {
  code: DiagnosticCode;
  level: DiagnosticLevel;
  summary: string;
}

/** The version of the language the verb table describes. */
export const VERB_TABLE_VERSION: number = verbTable.version;

/** Every verb category, with its title and summary. */
export const VERB_CATEGORIES: readonly CategorySpec[] = verbTable.categories as unknown as CategorySpec[];

/** Every verb: its category, summary, example and grammar. */
export const VERBS: readonly VerbSpec[] = verbTable.verbs as unknown as VerbSpec[];

/** Every diagnostic code, with its level and a description. */
export const DIAGNOSTICS: readonly DiagnosticSpec[] = verbTable.diagnostics as unknown as DiagnosticSpec[];

const VERBS_BY_NAME = new Map<string, VerbSpec>(VERBS.map((spec) => [spec.name, spec]));

/** The verb table's row for a verb, or `undefined` for a word that is not one. */
export function verbSpec(name: string): VerbSpec | undefined {
  return VERBS_BY_NAME.get(name);
}
