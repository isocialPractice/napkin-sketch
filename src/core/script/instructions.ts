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

import { DEFAULT_SURFACE, type StrokeProfile, type StrokeStyle } from '../types.js';
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

/** The marks a script can draw with. */
export const SCRIPT_TOOLS = ['pen', 'marker', 'copic'] as const;

/** A tool a script can draw with. */
export type ScriptTool = (typeof SCRIPT_TOOLS)[number];

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

// Paint

/** `tool marker`. */
export interface ToolInstruction extends InstructionBase {
  verb: 'tool';
  tool: ScriptTool;
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
  align?: 'left' | 'center' | 'right';
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
 * `effect blur 4`, `effect drop-shadow 4 4 8 #00000066`, `effect none`: an
 * effect for the next layer, group or mark, by its CSS filter function's name.
 */
export interface EffectInstruction extends InstructionBase {
  verb: 'effect';
  type: 'blur' | 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert' | 'hue-rotate' | 'opacity' | 'drop-shadow' | 'none';
  /** `blur`: the standard deviation, as CSS's `blur()` length is. */
  radius?: LengthArg;
  /** A factor for `brightness`, `contrast` and `saturate`; a share from 0 to 1 for `grayscale`, `sepia`, `invert` and `opacity`. */
  amount?: NumberArg;
  /** `hue-rotate`: degrees. */
  angle?: NumberArg;
  /** `drop-shadow`: the offset across and down. */
  dx?: LengthArg;
  dy?: LengthArg;
  /** `drop-shadow`: the blur radius, twice the standard deviation, as CSS has it. */
  blur?: LengthArg;
  /** `drop-shadow`: the shadow's color. */
  color?: string;
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
  | RoughInstruction
  | FontInstruction
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
  | PathInstruction
  | MoveInstruction
  | ToInstruction
  | ByInstruction
  | CurveInstruction
  | SmoothInstruction
  | ThroughInstruction
  | CloseInstruction
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
  rough: { amount: 'required', passes: 'optional', overshoot: 'optional' },
  font: { family: 'optional', size: 'optional' },
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
  path: { d: 'optional', body: 'optional' },
  move: { x: 'required', y: 'required' },
  to: { x: 'required', y: 'required' },
  by: { dx: 'required', dy: 'required' },
  curve: { c1x: 'required', c1y: 'required', c2x: 'required', c2y: 'required', x: 'required', y: 'required' },
  smooth: { c2x: 'required', c2y: 'required', x: 'required', y: 'required' },
  through: { points: 'required' },
  close: {},
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
    align: 'optional',
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
  },
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
  | 'unused-effect';

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
  /** Blocks open at once: groups, definitions being placed, repeats. */
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
  | 'points'
  | 'stops';

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
