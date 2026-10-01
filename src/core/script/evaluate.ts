/**
 * Napkin script instructions to a sketch book: the evaluator.
 *
 * `evaluate` reads a script - text, or JSON a program built - and runs it,
 * writing pages, layers and marks to a sink. The marks are the `Stroke`
 * objects the app itself commits: Bezier anchors in `vector`, points sampled
 * from them, and the paint fields the language names. A generated drawing is
 * therefore as editable in the app as a drawn one, and exports the way a drawn
 * one does.
 *
 * How state flows through a script:
 *
 * - The paint state, the transform and the units carry from one instruction
 *   to the next. `push` saves all three and `pop` restores them.
 * - A `group`, a `wipe`, a `stack` or a placed definition keeps its changes
 *   to itself: whatever it changes is put back when it ends. A `repeat` does not - its passes build on
 *   one another, so `translate` in a repeat walks across the page - and a
 *   `push` and `pop` inside the body keep a pass to itself.
 * - `let` sets the nearest name already set, or makes a new one in the current
 *   block. A placed definition reads the names in force where it is placed.
 * - `define` is hoisted within its block, so a `place` may come before it.
 *
 * Errors are values. An instruction that cannot run is reported and skipped,
 * and the run goes on; only the budget stops a run, keeping what was drawn up
 * to that point.
 */

import {
  DEFAULT_BACKGROUND,
  DEFAULT_SURFACE,
  type Gradient,
  type Layer,
  type Sketch,
  type SketchBook,
  type Stroke,
  type VectorAnchor,
  toolId,
} from '../types.js';
import { isWipeable, stackFaces, wipeMarks, WIPE_FACE_LIMIT, WIPE_OPERAND_LIMIT, type WipeOp, type WipeResult } from '../wipe.js';
import { splitMark, splitTarget, SPLIT_REACH_PX } from '../split.js';
import { canClip, CLIP_GROUP_NAME } from '../clip.js';
import { paintOrder } from '../paint-order.js';
import { parsePencil, pencilPaint } from '../pencil.js';
import { smudgeFor } from '../smudge.js';
import { liquifyMarks, type LiquifyDab } from '../liquify.js';
import { eraseMarks, eraseRegionOf } from '../erase.js';
import { fromPx, isLengthUnit, toPx } from '../units.js';
import { IDENTITY, apply, meanScale, multiply, rotation, scaling, translation, type Matrix } from '../graphic-design/geometry.js';
import { SubpathBuilder, parsePathD, sampleOutline } from '../path-data.js';
import { linkKind, linkName, linkPlaceholder, type LinkResolver } from '../link.js';
import { hasErrors, makeDiagnostic, sortDiagnostics, suggest, type Where } from './diagnostics.js';
import { ExpressionError, evaluateExpression, parseExpression, type ExprNode, type ExprScope } from './expr.js';
import { formSlots } from './grammar.js';
import { effectOf } from './effects.js';
import type { Effect } from '../effects.js';
import {
  PAPER_SIZES,
  SCRIPT_LIMITS,
  VERBS,
  type ClipInstruction,
  type SmearInstruction,
  type LiquifyInstruction,
  type WarpInstruction,
  type CropInstruction,
  type DefineInstruction,
  type Diagnostic,
  type DiagnosticCode,
  type EffectInstruction,
  type Expr,
  type FontInstruction,
  type GradientInstruction,
  type GroupInstruction,
  type ImageInstruction,
  type Instruction,
  type LinkInstruction,
  type LengthArg,
  type LetInstruction,
  type NewPageInstruction,
  type NumberArg,
  type PageInstruction,
  type PathInstruction,
  type PathStep,
  type PercentAxis,
  type PlaceInstruction,
  type PointArg,
  type RegistrationInstruction,
  type RepeatInstruction,
  type RoughInstruction,
  type ScriptLimits,
  type ShapeInstruction,
  type TextInstruction,
  type UseInstruction,
  type SplitInstruction,
  type StackInstruction,
  type WipeInstruction,
} from './instructions.js';
import { SHAPE_NAMES, findShape, fitShape } from './library.js';
import {
  axisScales,
  copyStroke,
  documentPage,
  imageSize,
  imageSizeOfBytes,
  isImageDataUrl,
  layerTree,
  uprightBox,
  type LayerNode,
  type ScriptDocument,
} from './media.js';
import { parseScript, type ParseOptions } from './parse.js';
import {
  ROUGH_SECOND_PASS_OPACITY,
  ROUGH_SECOND_PASS_WIDTH,
  geometryKey,
  hash32,
  roughMark,
  type RoughPiece,
} from './rough.js';
import { validateScript } from './validate.js';
import { isExpr, readLengthLiteral } from './values.js';
import { SketchSink, type LayerProps, type ScriptSink } from './sink.js';
import { DEFAULT_INK, copyFrame, initialFrame, transformAnchors, transformAngle, transformGradient, type Frame } from './state.js';
import {
  arcOutline,
  ellipseOutline,
  joinSubpaths,
  lineOutline,
  polyOutline,
  rectOutline,
  roundedPolygonOutline,
  spiralOutline,
  starOutline,
  type Outline,
} from './shapes.js';
import { measureTextBlock, missingGlyphs, textOutline } from './text.js';
import { throughAnchors } from './through.js';

/** How to run a script. */
export interface EvaluateOptions extends ParseOptions {
  /** The book's name, and its first page's. `drawing` unless given. */
  name?: string;
  /**
   * The seed for the hand-drawn pass until a `seed` instruction names one: a
   * whole number, 0 unless given. A fraction is cut to its whole part.
   */
  seed?: number;
  /** Raises or lowers the budget. A limit not named keeps its default. */
  limits?: Partial<ScriptLimits>;
  /**
   * Images a script places by name, as data URLs: `image "logo"` draws
   * `assets.logo`. A script reads no files, so a host with an image on disk
   * loads it and passes it here.
   */
  assets?: Readonly<Record<string, string>>;
  /**
   * Documents a script copies in by name with `use`: a page, or a book whose
   * first page is used.
   */
  documents?: Readonly<Record<string, ScriptDocument>>;
  /**
   * Reads a linked file, so that `link` can take its size from the file when
   * the script does not give both. A host with files on disk passes one, such
   * as `resolveLinkFromDir`; without one, a link needs both sizes.
   */
  resolveLink?: LinkResolver;
  /**
   * The time stamped on the book and its pages, as an ISO string. The current
   * time unless given; fix it for a book that is the same byte for byte on
   * every run.
   */
  timestamp?: string;
}

/** How much a run did. */
export interface ScriptStats {
  /** Instructions executed, every pass through a `repeat` counted. */
  instructions: number;
  marks: number;
  anchors: number;
  /** Points sampled from the anchors for the canvas to paint. */
  points: number;
  pages: number;
}

/** A box in page coordinates, in pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `crop` asked every output to be cut to. */
export type CropHint = { mode: 'auto'; pad: number } | { mode: 'none' } | ({ mode: 'box' } & Box);

/** What the script asked of its outputs. The last `crop` and `registration` run are the ones kept. */
export interface OutputHints {
  crop?: CropHint;
  registration?: Box;
}

/** A script as {@link evaluate} reads it: napkin script text, or the object form as a JSON value. */
export type ScriptSource = string | readonly unknown[];

/** What running a script gives back. */
export interface ScriptResult {
  /** True when nothing was an error. */
  ok: boolean;
  /** The drawing: always a book with at least one page, however much of the script ran. */
  book: SketchBook;
  /** What was wrong or worth knowing, from reading and from running, in reading order. */
  diagnostics: Diagnostic[];
  stats: ScriptStats;
  output: OutputHints;
  /** The seed the hand-drawn pass ended on. */
  seed: number;
}

/** What {@link runScript} gives back: everything but the book, which the sink holds. */
export interface RunResult {
  diagnostics: Diagnostic[];
  stats: ScriptStats;
  output: OutputHints;
  seed: number;
}

type P = { x: number; y: number };

/** Stops a run: the budget is spent. Not an error to a caller; the run ends and its diagnostic says why. */
class Halt {}

/** Skips one instruction, carrying the diagnostic that says why. */
class Skip {
  constructor(readonly diagnostic: Diagnostic) {}
}

interface Definition {
  instruction: DefineInstruction;
  /** Where the definition sits, for index paths into its body. */
  path: number[];
}

/** One block's names and definitions. */
interface Scope {
  vars: Map<string, number>;
  defs: Map<string, Definition>;
}

/** What a `push` saved, and where it was, for the warning when it is never popped. */
interface Saved {
  frame: Frame;
  where: Where;
}

/** Every verb's arguments and the axis a percentage in each is measured along. */
const AXES = new Map<string, Map<string, PercentAxis>>(
  VERBS.map((verb) => {
    const fields = new Map<string, PercentAxis>();
    for (const form of verb.forms) {
      for (const { slot } of formSlots(form)) if (slot.axis) fields.set(slot.slot, slot.axis);
    }
    return [verb.name, fields];
  }),
);

function axisOf(verb: string, field: string): PercentAxis {
  return AXES.get(verb)?.get(field) ?? 'none';
}

/** Why each wipe can leave nothing, for its warning. */
const WIPE_EMPTY: Readonly<Record<WipeOp, string>> = {
  in: 'its marks cover no ground',
  'out-front': 'the marks above the bottom one cover all of it',
  'out-back': 'the marks below the top one cover all of it',
  mid: 'there is no ground all of its marks cover',
  outer: 'no ground is covered by an odd number of its marks',
  clean: 'its marks cover no ground',
};

/**
 * How far a mark a Liquify verb bent may stray when it is fitted again, in
 * page pixels: the Smear's fit, a third of the app's Freehand fidelity, since
 * a script's marks are read at every size.
 */
const LIQUIFY_REFIT_PX = 0.5;

/** A number as a message shows it: four decimals at most. */
/** A number rounded to a millionth, so a computed size does not carry the last bits of its arithmetic. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function shown(value: number): string {
  return String(Math.round(value * 1e4) / 1e4);
}

function degrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** A transform about a pivot rather than the origin. */
function about(cx: number, cy: number, m: Matrix): Matrix {
  return multiply(multiply(translation(cx, cy), m), translation(-cx, -cy));
}

class Evaluator {
  readonly diagnostics: Diagnostic[] = [];
  readonly stats: ScriptStats = { instructions: 0, marks: 0, anchors: 0, points: 0, pages: 0 };
  readonly output: OutputHints = {};
  seed: number;

  private frame: Frame = initialFrame();
  private readonly scopes: Scope[] = [];
  private readonly pushes: Saved[][] = [];
  private readonly placing: string[] = [];
  private depth = 0;
  private groups = 0;
  private halted = false;
  private page: { width: number; height: number } = { width: DEFAULT_SURFACE.width, height: DEFAULT_SURFACE.height };
  private background = DEFAULT_BACKGROUND;
  private readonly baseName: string;
  private readonly parsed = new Map<string, ExprNode>();
  /** How many marks of each geometry the hand-drawn pass has drawn, so a shape drawn again wobbles anew. */
  private readonly roughSeen = new Map<number, number>();
  private readonly assets: Readonly<Record<string, string>>;
  private readonly documents: Readonly<Record<string, ScriptDocument>>;
  private readonly resolveLink: LinkResolver | undefined;
  /** Effects written and waiting for the next layer, group or mark, each with where it was written. */
  private pending: Array<{ effect: Effect; where: Where }> = [];
  /**
   * The `wipe` or `stack` blocks under way, the innermost last, each with the
   * marks it has drawn: its operands, held back from the sink until it
   * combines them.
   */
  private readonly combining: Array<{ verb: 'wipe' | 'stack'; held: Stroke[] }> = [];

  constructor(
    private readonly sink: ScriptSink,
    private readonly limits: ScriptLimits,
    options: EvaluateOptions,
  ) {
    this.seed = options.seed ?? 0;
    this.baseName = options.name ?? 'drawing';
    this.assets = options.assets ?? {};
    this.documents = options.documents ?? {};
    this.resolveLink = options.resolveLink;
  }

  run(script: readonly Instruction[]): void {
    this.sink.beginPage({ name: this.baseName, width: this.page.width, height: this.page.height, background: this.background });
    this.stats.pages = 1;
    try {
      this.block(script, [], false);
      this.dropEffects('the script ended');
    } catch (err) {
      if (!(err instanceof Halt)) throw err;
    }
  }

  // ---- Reporting ---------------------------------------------------------

  private whereOf(instruction: Instruction, path: number[]): Where {
    return instruction.at ? { line: instruction.at.line, column: instruction.at.column } : { index: path };
  }

  /** The skip to throw for an instruction that cannot run. */
  private problem(code: DiagnosticCode, message: string, where: Where, verb: string): Skip {
    return new Skip(makeDiagnostic(code, message, where, { verb }));
  }

  /** Reports a warning; the instruction carries on. */
  private warn(code: DiagnosticCode, message: string, where: Where, verb: string): void {
    this.diagnostics.push(makeDiagnostic(code, message, where, { verb }));
  }

  private halt(message: string, where: Where, verb: string): never {
    this.halted = true;
    this.diagnostics.push(makeDiagnostic('budget-exceeded', message, where, { verb }));
    throw new Halt();
  }

  // ---- Blocks --------------------------------------------------------------

  private charge(where: Where, verb: string): void {
    this.stats.instructions++;
    if (this.stats.instructions > this.limits.instructions) {
      this.halt(`The script ran more than ${this.limits.instructions} instructions, the budget for one run.`, where, verb);
    }
  }

  private enter(where: Where, verb: string): void {
    if (this.depth + 1 > this.limits.depth) this.halt(`Blocks nest more than ${this.limits.depth} deep here.`, where, verb);
    this.depth++;
  }

  private hoist(list: readonly Instruction[], path: number[], scope: Scope): void {
    list.forEach((instruction, k) => {
      if (instruction.verb !== 'define') return;
      const at = [...path, k];
      if (scope.defs.has(instruction.name)) {
        this.diagnostics.push(
          makeDiagnostic(
            'duplicate-definition',
            `\`${instruction.name}\` is defined again here, and this definition replaces the earlier one.`,
            this.whereOf(instruction, at),
            { verb: 'define' },
          ),
        );
      }
      scope.defs.set(instruction.name, { instruction, path: at });
    });
  }

  /** Puts back what pushes left unpopped saved; true when there were any. */
  private settle(stack: Saved[]): Saved | null {
    if (stack.length === 0) return null;
    this.frame = stack[0].frame;
    return stack[0];
  }

  private unbalanced(saved: Saved): void {
    if (this.halted) return;
    this.diagnostics.push(
      makeDiagnostic('unbalanced-push', 'This `push` is never popped before its block ends; what it saved is restored there.', saved.where, {
        verb: 'push',
      }),
    );
  }

  /** Runs a block in a scope of its own. A scoped block puts the frame back when it ends. */
  private block(list: readonly Instruction[], path: number[], scoped: boolean): void {
    const saved = scoped ? copyFrame(this.frame) : null;
    const scope: Scope = { vars: new Map(), defs: new Map() };
    this.hoist(list, path, scope);
    this.scopes.push(scope);
    this.pushes.push([]);
    // An effect waits inside its own block: one left waiting when the block ends is reported there.
    const outer = scoped ? this.pending : null;
    if (scoped) this.pending = [];
    try {
      this.runList(list, path);
      if (scoped) this.dropEffects('its block ended');
    } finally {
      const left = this.settle(this.pushes.pop() ?? []);
      if (left) this.unbalanced(left);
      this.scopes.pop();
      if (saved) this.frame = saved;
      if (outer) this.pending = outer;
    }
  }

  private runList(list: readonly Instruction[], path: number[]): void {
    for (let k = 0; k < list.length; k++) {
      const instruction = list[k];
      const at = [...path, k];
      const where = this.whereOf(instruction, at);
      this.charge(where, instruction.verb);
      try {
        this.exec(instruction, at, where);
      } catch (err) {
        if (err instanceof Skip) {
          this.diagnostics.push(err.diagnostic);
          continue;
        }
        throw err;
      }
    }
  }

  // ---- Values ------------------------------------------------------------

  private axisPx(axis: PercentAxis): number | undefined {
    if (axis === 'x') return this.page.width;
    if (axis === 'y') return this.page.height;
    if (axis === 'min') return Math.min(this.page.width, this.page.height);
    return undefined;
  }

  private lookup(name: string): number | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const value = this.scopes[i].vars.get(name);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  private scopeFor(axisPx: number | undefined): ExprScope {
    const units = this.frame.units;
    return {
      lookup: (name) => {
        if (name === 'width') return fromPx(this.page.width, units);
        if (name === 'height') return fromPx(this.page.height, units);
        return this.lookup(name);
      },
      convert: (value, unit) => fromPx(toPx(value, unit), units),
      percent: (value) => (axisPx === undefined ? undefined : fromPx((value / 100) * axisPx, units)),
    };
  }

  /** Runs an expression; the result is in the current units. */
  private expression(expr: Expr, axisPx: number | undefined, where: Where, verb: string): number {
    let node = this.parsed.get(expr.expr);
    if (!node) {
      const parsed = parseExpression(expr.expr);
      if (!parsed.ok) throw this.problem(parsed.code, `\`(${expr.expr})\`: ${parsed.message}`, where, verb);
      node = parsed.node;
      this.parsed.set(expr.expr, node);
    }
    try {
      return evaluateExpression(node, this.scopeFor(axisPx));
    } catch (err) {
      if (err instanceof ExpressionError) throw this.problem(err.code, `\`(${expr.expr})\`: ${err.message}`, where, verb);
      throw err;
    }
  }

  /** A length in pixels. A percentage is measured along `axis`. */
  private length(value: LengthArg, axis: PercentAxis, where: Where, verb: string): number {
    const units = this.frame.units;
    if (typeof value === 'number') return toPx(value, units);
    if (isExpr(value)) return toPx(this.expression(value, this.axisPx(axis), where, verb), units);
    const literal = readLengthLiteral(value);
    if (!literal) throw this.problem('expected-length', `\`${value}\` is not a length.`, where, verb);
    if (literal.unit === null) return toPx(literal.value, units);
    if (literal.unit === '%') {
      const base = this.axisPx(axis);
      if (base === undefined) {
        throw this.problem('invalid-value', `\`${value}\`: there is no page to measure a percentage against here.`, where, verb);
      }
      return (literal.value / 100) * base;
    }
    if (!isLengthUnit(literal.unit)) throw this.problem('unit-unknown', `\`${value}\`: \`${literal.unit}\` is not a unit.`, where, verb);
    return toPx(literal.value, literal.unit);
  }

  private number(value: NumberArg, where: Where, verb: string): number {
    return typeof value === 'number' ? value : this.expression(value, undefined, where, verb);
  }

  private point(x: LengthArg, y: LengthArg, where: Where, verb: string): P {
    return { x: this.length(x, 'x', where, verb), y: this.length(y, 'y', where, verb) };
  }

  private points(list: readonly PointArg[], where: Where, verb: string): P[] {
    return list.map((p) => this.point(p.x, p.y, where, verb));
  }

  private positive(value: number, what: string, where: Where, verb: string): number {
    if (!(value > 0)) throw this.problem('invalid-value', `${what} has to be more than 0, and is ${shown(value)}.`, where, verb);
    return value;
  }

  private nonNegative(value: number, what: string, where: Where, verb: string): number {
    if (!(value >= 0)) throw this.problem('invalid-value', `${what} cannot be less than 0, and is ${shown(value)}.`, where, verb);
    return value;
  }

  private fraction(value: number, what: string, where: Where, verb: string): number {
    if (!(value >= 0 && value <= 1)) {
      throw this.problem('invalid-value', `${what} runs from 0 to 1, and is ${shown(value)}.`, where, verb);
    }
    return value;
  }

  // ---- Marks ---------------------------------------------------------------

  /**
   * Maps an outline through the transform and adds it, painted, as one mark -
   * or, while `rough` is on, as the marks a hand would draw in its place: see
   * `roughMark`. `shows` narrows the paint for a library part: a part the
   * asset left unfilled gets no fill, and one it left unstroked gets no
   * outline. The budget is checked for every mark of a shape before any is
   * drawn, so a run never stops halfway through one.
   */
  private emit(outline: Outline, where: Where, verb: string, shows = { fill: true, stroke: true }): void {
    const m = this.frame.matrix;
    const paint = this.frame.paint;
    const anchors = transformAnchors(outline.anchors, m);
    const width = Math.round(paint.width * meanScale(m) * 1e6) / 1e6;
    const filled = outline.closed && shows.fill && (paint.fill !== null || paint.gradient !== null);
    const stroked = paint.stroke && shows.stroke;
    const pieces: RoughPiece[] =
      paint.rough.amount > 0
        ? roughMark(anchors, outline.closed, { filled, stroked, width }, paint.rough, this.roughStream(anchors))
        : [{ anchors, closed: outline.closed, fill: filled, stroke: stroked, restate: false }];
    const sampled = pieces.map((piece) => sampleOutline(piece.anchors, piece.closed));
    const anchorCount = pieces.reduce((sum, piece) => sum + piece.anchors.length, 0);
    const pointCount = sampled.reduce((sum, points) => sum + points.length, 0);
    this.afford(pieces.length, anchorCount, pointCount, where, verb);
    // An eraser cuts what is under it and draws nothing of its own: no fill,
    // no outline style, and no effects, which wait for the next mark that shows.
    const erasing = paint.tool === 'eraser';
    // A mark the hand-drawn pass draws as several strokes goes on a layer of
    // its own when it takes effects, so they work on the whole mark at once -
    // except in a wipe or a stack, whose marks are its operands, each carrying them.
    const effects = erasing ? undefined : this.takeEffects();
    const ownLayer = effects !== undefined && pieces.length > 1 && this.combining.length === 0;
    const cursor = ownLayer ? this.sink.cursor() : null;
    if (ownLayer) this.sink.newLayer(verb, { effects });
    pieces.forEach((piece, k) => {
      const stroke: Stroke = {
        id: '',
        tool: paint.tool,
        color: paint.color,
        width: piece.restate ? round6(width * ROUGH_SECOND_PASS_WIDTH) : width,
        points: sampled[k],
        sharpened: true,
        vector: piece.closed ? { anchors: piece.anchors, closed: true } : { anchors: piece.anchors },
      };
      if (piece.restate) stroke.opacity = round6((paint.opacity ?? 1) * ROUGH_SECOND_PASS_OPACITY);
      else if (paint.opacity !== undefined) stroke.opacity = paint.opacity;
      if (!erasing) {
        if (piece.fill && paint.fill) stroke.fill = paint.fill;
        if (piece.fill && paint.gradient) stroke.gradient = transformGradient(paint.gradient, m);
        if (!piece.stroke) stroke.noStroke = true;
        if (paint.style !== 'solid') stroke.strokeStyle = paint.style;
      }
      if ((paint.tool === 'pen' || paint.tool === 'marker') && paint.profile !== 'uniform') stroke.profile = paint.profile;
      if (paint.tool === 'copic') stroke.nibAngle = transformAngle(paint.nib, m);
      // A Pencil mark is drawn in its lead's tone, or the colored pencil's color.
      if (paint.tool === 'pencil') {
        stroke.pencil = { ...paint.pencil };
        stroke.color = paint.pencilColor ?? pencilPaint(paint.pencil).tone;
      }
      if (effects && !ownLayer) stroke.effects = effects;
      if (erasing) this.eraseWith(stroke, where, verb);
      else this.put(stroke);
    });
    if (cursor) this.sink.restore(cursor);
    // An eraser's lines count for what they change, as they land (eraseWith).
    if (!erasing) this.spend(pieces.length, anchorCount, pointCount);
  }

  /**
   * A line drawn with `tool eraser`, at work as the app's Eraser works
   * (core/erase.ts): its swath cut out of the marks drawn before it on its
   * layer - in a `wipe` or a `stack` block, out of the block's own - each
   * mark it changes left in its place and each it leaves nothing of taken
   * away. It draws no mark of its own, unless the geometry cannot make a cut:
   * then the eraser mark itself goes on, as an older file's does, so the
   * picture shows the cut all the same. Text and pictures it reaches are
   * passed over, as the Eraser passes over them, with a warning.
   */
  private eraseWith(eraser: Stroke, where: Where, verb: string): void {
    const region = eraseRegionOf(eraser);
    const top = this.combining[this.combining.length - 1];
    const page = this.sink.currentPage();
    // A block's marks have no ids yet: each is given one for the cut.
    const held = top ? top.held.map((mark, i) => ({ mark, id: `held-${i}` })) : null;
    const layer = held ? null : this.sink.currentLayerId();
    const targets = held ? held.map(({ mark, id }) => ({ ...mark, id })) : page.strokes.filter((s) => layer !== null && s.layer === layer);
    const result = eraseMarks(held ? { ...page, strokes: targets } : page, targets.map((s) => s.id), region);
    const size = (s: Stroke): { anchors: number; points: number } => ({ anchors: s.vector?.anchors.length ?? 0, points: s.points.length });
    let marks = 0;
    let anchors = 0;
    let points = 0;
    const count = (sign: 1 | -1, s: Stroke): void => {
      const { anchors: a, points: p } = size(s);
      anchors += sign * a;
      points += sign * p;
    };
    for (const [id, cut] of result.changed) {
      const was = targets.find((s) => s.id === id);
      if (was) {
        count(-1, was);
        count(1, cut);
      }
    }
    for (const id of result.removed) {
      const was = targets.find((s) => s.id === id);
      if (was) {
        marks--;
        count(-1, was);
      }
    }
    const fallback = result.raster.size > 0;
    if (fallback) {
      marks++;
      count(1, eraser);
    }
    this.afford(marks, anchors, points, where, verb);
    if (held && top) {
      const kept: Stroke[] = [];
      for (const { mark, id } of held) {
        if (result.removed.has(id)) continue;
        const cut = result.changed.get(id);
        kept.push(cut ? { ...cut, id: '' } : mark);
      }
      top.held.splice(0, top.held.length, ...kept);
    } else {
      for (const target of targets) {
        if (result.removed.has(target.id)) this.sink.removeMark(target);
        else {
          const cut = result.changed.get(target.id);
          if (cut) this.sink.replaceMark(target, [cut]);
        }
      }
    }
    if (fallback) this.put(eraser);
    if (result.skipped.size > 0) {
      this.warn(
        'erase-skipped',
        `\`${verb}\` with \`tool eraser\` reached ${result.skipped.size === 1 ? 'text or a picture' : `${result.skipped.size} text items or pictures`}, which it passed over: an eraser cuts paths and lines, as the app's Eraser does.`,
        where,
        verb,
      );
    }
    this.spend(marks, anchors, points);
  }

  /** Stops the run when drawing this much more would go over the budget. */
  private afford(marks: number, anchors: number, points: number, where: Where, verb: string): void {
    if (this.stats.marks + marks > this.limits.marks) {
      this.halt(`The script drew more than ${this.limits.marks} marks, the budget for one run.`, where, verb);
    }
    if (this.stats.anchors + anchors > this.limits.anchors) {
      this.halt(`The script's marks came to more than ${this.limits.anchors} anchors, the budget for one run.`, where, verb);
    }
    if (this.stats.points + points > this.limits.points) {
      this.halt(`The script's marks sampled to more than ${this.limits.points} points, the budget for one run.`, where, verb);
    }
  }

  /** Counts what was drawn against the budget. */
  private spend(marks: number, anchors: number, points: number): void {
    this.stats.marks += marks;
    this.stats.anchors += anchors;
    this.stats.points += points;
  }

  /** Adds a text item or an image: a mark with no anchors, placed by its one point. */
  private addItem(stroke: Stroke, where: Where, verb: string): void {
    this.afford(1, 0, stroke.points.length, where, verb);
    const effects = this.takeEffects();
    if (effects) stroke.effects = effects;
    this.put(stroke);
    this.spend(1, 0, stroke.points.length);
  }

  /** Sends a finished mark on: to the innermost `wipe` or `stack` under way, which holds it back, or to the sink. */
  private put(stroke: Stroke): void {
    const top = this.combining[this.combining.length - 1];
    if (top) top.held.push(stroke);
    else this.sink.addMark(stroke);
  }

  /** Stops a verb that makes layers inside a `wipe` or a `stack`: the block's marks are combined where it is, on its layer. */
  private outsideCombining(where: Where, verb: string): void {
    const top = this.combining[this.combining.length - 1];
    if (!top) return;
    throw this.problem(
      'misplaced-verb',
      `\`${verb}\` cannot be inside a \`${top.verb}\`: the marks of its block are combined where the \`${top.verb}\` is, on its layer.`,
      where,
      verb,
    );
  }

  // ---- Text and media --------------------------------------------------------

  /**
   * A text item, measured with the built-in face and aligned on `at`, which
   * is the top of its first line: its left end, its middle or its right end.
   * It stays upright under a turn, as the app keeps text. `as marks` draws
   * the letters as pen strokes instead, which turn with the drawing and take
   * the paint and the hand-drawn pass like any other mark.
   */
  private text(instruction: TextInstruction, where: Where): void {
    const verb = 'text';
    const length = (field: string, value: LengthArg): number => this.length(value, axisOf(verb, field), where, verb);
    const paint = this.frame.paint;
    if (instruction.text.trim() === '') throw this.problem('invalid-value', 'This `text` has nothing in it to show.', where, verb);
    const size = instruction.size === undefined ? paint.font.size : this.positive(length('size', instruction.size), 'A text size', where, verb);
    const box = instruction.box === undefined ? undefined : this.positive(length('box', instruction.box), 'A text box', where, verb);
    const x = length('x', instruction.x);
    const y = length('y', instruction.y);
    const align = instruction.align ?? 'left';
    if (instruction.asMarks) {
      const missing = missingGlyphs(instruction.text);
      if (missing.length > 0) {
        const named = missing.map((char) => `\`${char}\``).join(', ');
        this.warn('glyph-missing', `The built-in face has no ${named}; ${missing.length === 1 ? 'it is' : 'they are'} left as a gap.`, where, verb);
      }
      const outline = textOutline(instruction.text, x, y, size, align, box);
      if (!outline) throw this.problem('invalid-value', 'This `text` has no letter the built-in face can draw.', where, verb);
      return this.emit(outline, where, verb);
    }
    const block = measureTextBlock(instruction.text, size, box);
    const left = align === 'center' ? x - block.width / 2 : align === 'right' ? x - block.width : x;
    const m = this.frame.matrix;
    const k = meanScale(m);
    const placed = uprightBox({ x: left, y, width: block.width, height: block.height }, m, k, k);
    const stroke: Stroke = {
      id: '',
      tool: 'text',
      color: paint.color,
      width: 1,
      points: [{ x: placed.x, y: placed.y, pressure: 0.5 }],
      text: instruction.text,
      fontSize: round6(size * k),
      fontFamily: paint.font.family,
      sharpened: true,
    };
    if (box !== undefined) stroke.textBoxWidth = round6(box * k);
    if (paint.opacity !== undefined) stroke.opacity = paint.opacity;
    this.addItem(stroke, where, verb);
  }

  /**
   * An image: a data URL, or the asset of that name. With one size it keeps
   * its proportions and with none it is its own size, both read from the
   * image's header; an image whose size cannot be read is placed square,
   * with a warning. It stays upright under a turn, as the app keeps images.
   */
  private image(instruction: ImageInstruction, where: Where): void {
    const verb = 'image';
    const length = (field: string, value: LengthArg): number => this.length(value, axisOf(verb, field), where, verb);
    const src = this.asset(instruction.src, where, verb);
    const x = length('x', instruction.x);
    const y = length('y', instruction.y);
    const width = instruction.width === undefined ? undefined : this.positive(length('width', instruction.width), 'An image width', where, verb);
    const height = instruction.height === undefined ? undefined : this.positive(length('height', instruction.height), 'An image height', where, verb);
    let size: { width: number; height: number };
    if (width !== undefined && height !== undefined) {
      size = { width, height };
    } else {
      const natural = imageSize(src);
      if (natural) {
        size = width === undefined ? natural : { width, height: (width * natural.height) / natural.width };
      } else {
        const side = width ?? 100;
        size = { width: side, height: side };
        this.warn(
          'image-size-unknown',
          `This image's size cannot be read from its data, so it is placed ${shown(side)} by ${shown(side)}. Give \`size <width> <height>\` to set it.`,
          where,
          verb,
        );
      }
    }
    const m = this.frame.matrix;
    const scales = axisScales(m);
    const placed = uprightBox({ x, y, ...size }, m, scales.x, scales.y);
    const stroke: Stroke = {
      id: '',
      tool: 'image',
      color: DEFAULT_INK,
      width: 1,
      points: [{ x: placed.x, y: placed.y, pressure: 0.5 }],
      image: src,
      imageWidth: round6(placed.width),
      imageHeight: round6(placed.height),
      sharpened: true,
    };
    const opacity = this.frame.paint.opacity;
    if (opacity !== undefined) stroke.opacity = opacity;
    this.addItem(stroke, where, verb);
  }

  /**
   * A linked file: one image item on a layer of its own, named for the file or
   * by `name`, that stands for the file rather than holding it. It is drawn as
   * a placeholder until an output that can read the file draws it. Sizes work
   * as an `image`'s do, read from the file when the host resolves links, and
   * it stays upright under a turn.
   */
  private link(instruction: LinkInstruction, where: Where): void {
    const verb = 'link';
    const length = (field: string, value: LengthArg): number => this.length(value, axisOf(verb, field), where, verb);
    const href = instruction.href.trim();
    if (href === '') throw this.problem('invalid-value', 'A `link` needs the path of the file it links.', where, verb);
    if (/^data:/i.test(href)) {
      throw this.problem('invalid-value', 'A `link` names a file. To place data carried in the script, use `image`.', where, verb);
    }
    const x = length('x', instruction.x);
    const y = length('y', instruction.y);
    const width = instruction.width === undefined ? undefined : this.positive(length('width', instruction.width), 'A link width', where, verb);
    const height = instruction.height === undefined ? undefined : this.positive(length('height', instruction.height), 'A link height', where, verb);
    let size: { width: number; height: number };
    if (width !== undefined && height !== undefined) {
      size = { width, height };
    } else {
      const file = this.resolveLink?.(href) ?? null;
      const natural = file ? imageSizeOfBytes(file.bytes) : null;
      if (natural) {
        size = width === undefined ? natural : { width, height: (width * natural.height) / natural.width };
      } else {
        const side = width ?? 100;
        size = { width: side, height: side };
        const why = this.resolveLink ? 'from the file' : 'without the file';
        this.warn(
          'image-size-unknown',
          `The size of \`${href}\` cannot be read ${why}, so it is placed ${shown(side)} by ${shown(side)}. Give \`size <width> <height>\` to set it.`,
          where,
          verb,
        );
      }
    }
    const m = this.frame.matrix;
    const scales = axisScales(m);
    const placed = uprightBox({ x, y, ...size }, m, scales.x, scales.y);
    const stroke: Stroke = {
      id: '',
      tool: 'image',
      color: DEFAULT_INK,
      width: 1,
      points: [{ x: placed.x, y: placed.y, pressure: 0.5 }],
      image: linkPlaceholder(linkName(href), placed.width, placed.height),
      imageWidth: round6(placed.width),
      imageHeight: round6(placed.height),
      link: { href, kind: linkKind(href) },
      sharpened: true,
    };
    const opacity = this.frame.paint.opacity;
    if (opacity !== undefined) stroke.opacity = opacity;
    // One layer row for the linked file, as a placed file has in a design tool.
    const saved = this.sink.cursor();
    this.sink.newLayer(instruction.name ?? linkName(href), {});
    try {
      this.addItem(stroke, where, verb);
    } finally {
      this.sink.restore(saved);
    }
  }

  /**
   * The data URL an `image` draws: its own, or the asset of that name. A
   * path or a web address is refused, since a script reads no files.
   */
  private asset(src: string, where: Where, verb: string): string {
    const trimmed = src.trim();
    if (/^data:/i.test(trimmed)) {
      if (!isImageDataUrl(trimmed)) throw this.problem('invalid-value', 'This data URL is not an image: `image` takes a `data:image/...` URL.', where, verb);
      return trimmed;
    }
    if (Object.prototype.hasOwnProperty.call(this.assets, src)) {
      const asset = this.assets[src];
      if (typeof asset !== 'string' || !isImageDataUrl(asset)) {
        throw this.problem('invalid-value', `The asset \`${src}\` is not an image data URL.`, where, verb);
      }
      return asset.trim();
    }
    const file = /[\\/.:]/.test(src);
    const guess = file ? undefined : suggest(src, Object.keys(this.assets));
    const hint = file
      ? ' A script reads no files: load the image, pass it in `assets` under a name, and use the name here.'
      : guess
        ? ` Did you mean \`${guess}\`?`
        : '';
    throw this.problem('unknown-asset', `There is no asset named \`${src}\`.${hint}`, where, verb);
  }

  /**
   * Copies a document the host supplied into a group of its own: every
   * layer, with its name, opacity, visibility and lock, and every mark,
   * mapped through the transform and placed at `at`, scaled by `scale`.
   * Marks are copied as they are - the paint and the hand-drawn pass do not
   * apply - and each gets a new id. The whole document is checked against
   * the budget before any of it is drawn.
   */
  private use(instruction: UseInstruction, where: Where): void {
    const verb = 'use';
    const document = Object.prototype.hasOwnProperty.call(this.documents, instruction.name) ? this.documents[instruction.name] : undefined;
    if (!document) {
      const guess = suggest(instruction.name, Object.keys(this.documents));
      const hint = guess ? ` Did you mean \`${guess}\`?` : ' A host passes documents to the run in `documents`.';
      throw this.problem('unknown-document', `There is no document named \`${instruction.name}\`.${hint}`, where, verb);
    }
    const page = documentPage(document);
    if (!page) throw this.problem('invalid-value', `The document \`${instruction.name}\` has no pages.`, where, verb);
    const length = (field: string, value: LengthArg): number => this.length(value, axisOf(verb, field), where, verb);
    const x = instruction.x === undefined ? 0 : length('x', instruction.x);
    const y = instruction.y === undefined ? 0 : length('y', instruction.y);
    const scale = instruction.scale === undefined ? 1 : this.number(instruction.scale, where, verb);
    if (scale === 0) throw this.problem('invalid-value', 'A `use` at scale 0 would draw nothing.', where, verb);
    const m = multiply(this.frame.matrix, multiply(translation(x, y), scaling(scale, scale)));
    const measure = (text: Stroke): { width: number; height: number } => measureTextBlock(text.text ?? '', text.fontSize ?? 24, text.textBoxWidth);
    const tree = layerTree(page);
    const copies = new Map<Stroke, Stroke>();
    let anchors = 0;
    let points = 0;
    const copyAll = (nodes: readonly LayerNode[]): void => {
      for (const node of nodes) {
        for (const stroke of node.strokes) {
          const copy = copyStroke(stroke, m, measure);
          copies.set(stroke, copy);
          anchors += copy.vector?.anchors.length ?? 0;
          points += copy.points.length;
        }
        copyAll(node.children);
      }
    };
    copyAll(tree);
    this.afford(copies.size, anchors, points, where, verb);
    const props = (layer: Layer): LayerProps => {
      const out: LayerProps = {};
      if (layer.opacity < 1) out.opacity = layer.opacity;
      if (!layer.visible) out.hidden = true;
      if (layer.locked) out.locked = true;
      return out;
    };
    const build = (nodes: readonly LayerNode[]): void => {
      for (const node of nodes) {
        if (node.layer.group) {
          this.sink.beginGroup(node.layer.name, props(node.layer));
          build(node.children);
          this.sink.endGroup();
        } else {
          this.sink.newLayer(node.layer.name, props(node.layer));
          for (const stroke of node.strokes) this.sink.addMark(copies.get(stroke)!);
        }
      }
    };
    this.sink.beginGroup(instruction.layer ?? instruction.name, this.effectProps());
    try {
      build(tree);
    } finally {
      this.sink.endGroup();
    }
    this.spend(copies.size, anchors, points);
  }

  /**
   * The noise stream for a mark drawn by hand: the seed, the mark's geometry
   * on the page, and how many marks of the same geometry came before it. A
   * mark's wobble therefore depends on nothing else in the script, so editing
   * one mark leaves the others as they were.
   */
  private roughStream(anchors: readonly VectorAnchor[]): number {
    const key = geometryKey(anchors);
    const seen = this.roughSeen.get(key) ?? 0;
    this.roughSeen.set(key, seen + 1);
    return hash32(this.seed, key, seen);
  }

  private transform(local: Matrix): void {
    this.frame.matrix = multiply(this.frame.matrix, local);
  }

  // ---- Instructions --------------------------------------------------------

  private exec(instruction: Instruction, path: number[], where: Where): void {
    const verb = instruction.verb;
    const paint = this.frame.paint;
    const length = (field: string, value: LengthArg): number => this.length(value, axisOf(verb, field), where, verb);
    switch (instruction.verb) {
      case 'napkin':
      case 'define':
        return;
      case 'page':
        return this.pageSize(instruction, where);
      case 'background':
        this.background = instruction.color ?? 'transparent';
        this.sink.updatePage({ background: this.background });
        return;
      case 'name':
        this.sink.updatePage({ name: instruction.name });
        return;
      case 'units':
        this.frame.units = instruction.units;
        return;
      case 'seed':
        this.seed = instruction.seed;
        return;
      case 'newpage':
        return this.newPage(instruction, where);
      case 'layer':
        this.outsideCombining(where, verb);
        this.sink.useLayer(instruction.name, { ...this.layerProps(instruction, where, verb), ...this.effectProps() });
        return;
      case 'group':
        this.outsideCombining(where, verb);
        return this.group(instruction, path, where);
      case 'clip':
        this.outsideCombining(where, verb);
        return this.clip(instruction, path, where);
      case 'tool':
        // `brush` is the Brush, which marks call `pen`.
        paint.tool = toolId(instruction.tool);
        return;
      case 'color':
        paint.color = instruction.color;
        return;
      case 'width':
        paint.width = this.positive(length('width', instruction.width), '`width`', where, verb);
        return;
      case 'opacity':
        paint.opacity = this.fraction(this.number(instruction.opacity, where, verb), '`opacity`', where, verb);
        return;
      case 'fill':
        paint.fill = instruction.fill;
        return;
      case 'gradient':
        paint.gradient = this.gradient(instruction, where);
        return;
      case 'stroke':
        paint.stroke = instruction.on;
        return;
      case 'style':
        paint.style = instruction.style;
        return;
      case 'profile':
        paint.profile = instruction.profile;
        return;
      case 'nib':
        paint.nib = degrees(this.number(instruction.angle, where, verb));
        return;
      case 'pencil':
        // The parser and the validator take only a pencil there is.
        paint.tool = 'pencil';
        paint.pencil = parsePencil(instruction.pencil) ?? paint.pencil;
        paint.pencilColor = instruction.color ?? null;
        return;
      case 'rough':
        return this.rough(instruction, where);
      case 'font':
        return this.font(instruction, where);
      case 'rect': {
        const width = this.positive(length('width', instruction.width), 'The width of a `rect`', where, verb);
        const height = this.positive(length('height', instruction.height), 'The height of a `rect`', where, verb);
        const radius =
          instruction.radius === undefined ? 0 : this.nonNegative(length('radius', instruction.radius), 'A corner radius', where, verb);
        return this.emit(rectOutline(length('x', instruction.x), length('y', instruction.y), width, height, radius), where, verb);
      }
      case 'circle': {
        const r = this.positive(length('r', instruction.r), 'The radius of a `circle`', where, verb);
        return this.emit(ellipseOutline(length('cx', instruction.cx), length('cy', instruction.cy), r, r), where, verb);
      }
      case 'ellipse': {
        const rx = this.positive(length('rx', instruction.rx), '`rx`', where, verb);
        const ry = this.positive(length('ry', instruction.ry), '`ry`', where, verb);
        return this.emit(ellipseOutline(length('cx', instruction.cx), length('cy', instruction.cy), rx, ry), where, verb);
      }
      case 'line':
        return this.emit(
          lineOutline(this.point(instruction.x1, instruction.y1, where, verb), this.point(instruction.x2, instruction.y2, where, verb)),
          where,
          verb,
        );
      case 'polygon': {
        const points = this.points(instruction.points, where, verb);
        const radius =
          instruction.radius === undefined ? 0 : this.nonNegative(length('radius', instruction.radius), 'A corner radius', where, verb);
        return this.emit(radius > 0 ? roundedPolygonOutline(points, radius) : polyOutline(points, true), where, verb);
      }
      case 'polyline':
        return this.emit(polyOutline(this.points(instruction.points, where, verb), false), where, verb);
      case 'star': {
        const count = this.number(instruction.count, where, verb);
        if (!Number.isInteger(count) || count < 2) {
          throw this.problem('invalid-value', `A \`star\` has a whole number of points, 2 or more, and got ${shown(count)}.`, where, verb);
        }
        const outer = this.positive(length('outer', instruction.outer), 'The outer radius of a `star`', where, verb);
        const inner = this.nonNegative(length('inner', instruction.inner), 'The inner radius of a `star`', where, verb);
        return this.emit(starOutline(length('cx', instruction.cx), length('cy', instruction.cy), outer, inner, count), where, verb);
      }
      case 'arc': {
        const r = this.positive(length('r', instruction.r), 'The radius of an `arc`', where, verb);
        const from = this.number(instruction.from, where, verb);
        const to = this.number(instruction.to, where, verb);
        if (from === to) throw this.problem('invalid-value', 'An `arc` from an angle to the same angle draws nothing.', where, verb);
        return this.emit(arcOutline(length('cx', instruction.cx), length('cy', instruction.cy), r, from, to), where, verb);
      }
      case 'spiral': {
        const r = this.positive(length('r', instruction.r), 'The radius of a `spiral`', where, verb);
        const turns = this.positive(this.number(instruction.turns, where, verb), 'The turns of a `spiral`', where, verb);
        return this.emit(spiralOutline(length('cx', instruction.cx), length('cy', instruction.cy), r, turns), where, verb);
      }
      case 'shape':
        return this.shape(instruction, where);
      case 'wipe':
        return this.wipe(instruction, path, where);
      case 'stack':
        return this.stack(instruction, path, where);
      case 'through': {
        const anchors = throughAnchors(this.points(instruction.points, where, verb));
        if (anchors.length < 2) throw this.problem('invalid-value', 'A `through` needs at least two different points.', where, verb);
        return this.emit({ anchors, closed: false }, where, verb);
      }
      case 'text':
        return this.text(instruction, where);
      case 'image':
        return this.image(instruction, where);
      case 'use':
        this.outsideCombining(where, verb);
        return this.use(instruction, where);
      case 'link':
        return this.link(instruction, where);
      case 'path':
        return this.path(instruction, path, where);
      case 'split':
        return this.split(instruction, where);
      case 'smear':
        return this.smear(instruction, where);
      case 'warp':
      case 'twirl':
      case 'pucker':
      case 'bloat':
        return this.liquify(instruction, where);
      case 'move':
      case 'to':
      case 'by':
      case 'curve':
      case 'smooth':
      case 'close':
        throw this.problem('misplaced-verb', `\`${verb}\` only works inside a \`path { ... }\` block.`, where, verb);
      case 'push':
        this.pushes[this.pushes.length - 1].push({ frame: copyFrame(this.frame), where });
        return;
      case 'pop': {
        const saved = this.pushes[this.pushes.length - 1].pop();
        if (!saved) throw this.problem('pop-without-push', 'There is no `push` in this block for this `pop` to restore.', where, verb);
        this.frame = saved.frame;
        return;
      }
      case 'translate':
        return this.transform(translation(length('dx', instruction.dx), length('dy', instruction.dy)));
      case 'rotate': {
        const angle = this.number(instruction.angle, where, verb);
        const cx = instruction.cx === undefined ? 0 : length('cx', instruction.cx);
        const cy = instruction.cy === undefined ? 0 : length('cy', instruction.cy);
        return this.transform(about(cx, cy, rotation(angle)));
      }
      case 'scale': {
        const sx = this.number(instruction.sx, where, verb);
        const sy = instruction.sy === undefined ? sx : this.number(instruction.sy, where, verb);
        if (sx === 0 || sy === 0) throw this.problem('invalid-value', 'A `scale` of 0 would flatten everything after it.', where, verb);
        const cx = instruction.cx === undefined ? 0 : length('cx', instruction.cx);
        const cy = instruction.cy === undefined ? 0 : length('cy', instruction.cy);
        return this.transform(about(cx, cy, scaling(sx, sy)));
      }
      case 'mirror': {
        const at = instruction.about === undefined ? 0 : this.length(instruction.about, instruction.axis, where, verb);
        return this.transform(instruction.axis === 'x' ? about(at, 0, scaling(-1, 1)) : about(0, at, scaling(1, -1)));
      }
      case 'let':
        return this.let(instruction, where);
      case 'place':
        return this.place(instruction, where);
      case 'repeat':
        return this.repeat(instruction, path, where);
      case 'effect':
        return this.effect(instruction, where);
      case 'crop':
        this.output.crop = this.crop(instruction, where);
        return;
      case 'registration':
        this.output.registration = this.box(instruction, where);
        return;
      default: {
        const unreachable: never = instruction;
        throw new Error(`evaluate: no case for ${String((unreachable as Instruction).verb)}`);
      }
    }
  }

  private pageSize(instruction: PageInstruction, where: Where): void {
    let width: number;
    let height: number;
    if (instruction.paper) {
      const paper = PAPER_SIZES[instruction.paper];
      width = toPx(paper.width, paper.units);
      height = toPx(paper.height, paper.units);
    } else if (instruction.width !== undefined && instruction.height !== undefined) {
      width = this.positive(this.length(instruction.width, 'none', where, 'page'), 'A page width', where, 'page');
      height = this.positive(this.length(instruction.height, 'none', where, 'page'), 'A page height', where, 'page');
    } else {
      throw this.problem('missing-argument', '`page` needs a paper size, or a width and a height.', where, 'page');
    }
    const turn =
      (instruction.orientation === 'landscape' && height > width) || (instruction.orientation === 'portrait' && width > height);
    if (turn) [width, height] = [height, width];
    this.page = { width, height };
    this.sink.updatePage({ width, height });
  }

  private newPage(instruction: NewPageInstruction, where: Where): void {
    if (this.groups > 0 || this.placing.length > 0 || this.combining.length > 0) {
      throw this.problem(
        'misplaced-verb',
        '`newpage` cannot be inside a group, a wipe, a stack or a placed definition; it belongs at the top of a script, or in a repeat there.',
        where,
        'newpage',
      );
    }
    this.dropEffects('its page ended');
    this.stats.pages++;
    const name = instruction.name ?? `${this.baseName}-${this.stats.pages}`;
    this.sink.beginPage({ name, width: this.page.width, height: this.page.height, background: this.background });
    this.frame.matrix = IDENTITY;
  }

  // ---- Effects -------------------------------------------------------------

  /** An `effect` line: one more effect waiting for the next layer, group or mark - or, with `none`, none. */
  private effect(instruction: EffectInstruction, where: Where): void {
    const verb = 'effect';
    if (instruction.type === 'none') {
      this.pending = [];
      return;
    }
    const effect = effectOf(
      instruction,
      {
        length: (value, axis) => this.length(value, axis, where, verb),
        number: (value) => this.number(value, where, verb),
        nonNegative: (value, what) => this.nonNegative(value, what, where, verb),
        fraction: (value, what) => this.fraction(value, what, where, verb),
      },
      this.frame.matrix,
    );
    this.pending.push({ effect, where });
  }

  /** The effects waiting, handed over, in the order they were written; undefined when none are. */
  private takeEffects(): Effect[] | undefined {
    if (this.pending.length === 0) return undefined;
    const effects = this.pending.map((waiting) => waiting.effect);
    this.pending = [];
    return effects;
  }

  /** The effects waiting, as the properties of the layer or group taking them. */
  private effectProps(): LayerProps {
    const effects = this.takeEffects();
    return effects ? { effects } : {};
  }

  /** Reports each effect still waiting when its block, its page or the script ends, and lets it go. */
  private dropEffects(ended: string): void {
    for (const { effect, where } of this.pending) {
      this.warn('unused-effect', `\`effect ${effect.type}\` did nothing: no layer, group or mark followed it before ${ended}.`, where, 'effect');
    }
    this.pending = [];
  }

  private layerProps(instruction: { opacity?: NumberArg; hidden?: boolean; locked?: boolean }, where: Where, verb: string): LayerProps {
    const props: LayerProps = {};
    if (instruction.opacity !== undefined) {
      props.opacity = this.fraction(this.number(instruction.opacity, where, verb), 'A layer opacity', where, verb);
    }
    if (instruction.hidden) props.hidden = true;
    if (instruction.locked) props.locked = true;
    return props;
  }

  private group(instruction: GroupInstruction, path: number[], where: Where): void {
    const props = { ...this.layerProps(instruction, where, 'group'), ...this.effectProps() };
    this.enter(where, 'group');
    this.sink.beginGroup(instruction.name, props);
    this.groups++;
    try {
      this.block(instruction.body, path, true);
    } finally {
      this.groups--;
      this.sink.endGroup();
      this.depth--;
    }
  }

  /**
   * A `wipe`: the marks its block draws, combined as the app's Wipe Stacks
   * combine them (`core/wipe.ts`), and what is left drawn in their place.
   */
  private wipe(instruction: WipeInstruction, path: number[], where: Where): void {
    const op = instruction.op;
    this.combine(instruction.body, path, where, 'wipe', `wipe ${op}`, WIPE_EMPTY[op], (page, ids) => wipeMarks(page, ids, op));
  }

  /**
   * A `stack`: the marks its block draws, stacked as the app's Shape Stacker
   * stacks them (`core/wipe.ts`'s `stackFaces`) - the pieces under its points
   * merged into one shape, or taken away - and what is left drawn in their
   * place. The points are where the `stack` line is, under its transform, as
   * a mark drawn there would be; one on none of the pieces picks nothing, and
   * says so.
   */
  private stack(instruction: StackInstruction, path: number[], where: Where): void {
    const verb = 'stack';
    const mode = instruction.mode;
    const at = this.points(instruction.points, where, verb).map((p) => apply(this.frame.matrix, p));
    let missed: number[] = [];
    this.combine(instruction.body, path, where, verb, `stack ${mode}`, 'its points took every piece away', (page, ids) => {
      const result = stackFaces(page, ids, at, mode);
      missed = at.flatMap((p, k) => (result.missed.includes(p) ? [k + 1] : []));
      return result;
    });
    if (missed.length === 0) return;
    const which =
      missed.length === 1 ? `point ${missed[0]}` : `points ${missed.slice(0, -1).join(', ')} and ${missed[missed.length - 1]}`;
    this.warn(
      'stack-missed',
      `\`stack ${mode}\` found no piece under ${which} of its ${at.length}: a point picks the piece of its block's marks under it.`,
      where,
      verb,
    );
  }

  /**
   * A `split`: the topmost mark drawn so far whose path passes within
   * {@link SPLIT_REACH_PX} of the point - under the `split` line's transform,
   * as a mark drawn there would be - cut there as the app's Split cuts it
   * (`core/split.ts`), and the pieces put in its place, on its layer. In a
   * `wipe` or a `stack` block, it cuts among the marks the block has drawn,
   * which the block goes on to combine.
   */
  private split(instruction: SplitInstruction, where: Where): void {
    const verb = 'split';
    const local = this.point(instruction.x, instruction.y, where, verb);
    const at = apply(this.frame.matrix, local);
    const top = this.combining[this.combining.length - 1];
    const marks = top ? top.held : paintOrder(this.sink.currentPage());
    const place = `(${shown(fromPx(local.x, this.frame.units))}, ${shown(fromPx(local.y, this.frame.units))})`;
    const target = splitTarget(marks, at, SPLIT_REACH_PX, { anchorReach: SPLIT_REACH_PX / 2 });
    if (!target) {
      this.warn('split-missed', `\`split\` found no path within ${SPLIT_REACH_PX} px of ${place}.`, where, verb);
      return;
    }
    const pieces = splitMark(target.stroke, target.at);
    if (!pieces) {
      this.warn('split-missed', `\`split\` at ${place} lands on the end of an open path: there is nothing there to cut.`, where, verb);
      return;
    }
    const placed = pieces.second ? [pieces.first, pieces.second] : [pieces.first];
    // The budget counts the pieces, less the mark they replace.
    const size = (list: readonly Stroke[]): { anchors: number; points: number } =>
      list.reduce((sum, s) => ({ anchors: sum.anchors + (s.vector?.anchors.length ?? 0), points: sum.points + s.points.length }), { anchors: 0, points: 0 });
    const before = size([target.stroke]);
    const after = size(placed);
    this.afford(placed.length - 1, after.anchors - before.anchors, after.points - before.points, where, verb);
    if (top) {
      const i = top.held.indexOf(target.stroke);
      top.held.splice(i, 1, ...placed.map((piece) => ({ ...piece, id: '' })));
    } else {
      this.sink.replaceMark(target.stroke, placed);
    }
    this.spend(placed.length - 1, after.anchors - before.anchors, after.points - before.points);
  }

  /**
   * A `smear`: a pass of the app's Smear along the points, where the `smear`
   * line is under its transform, over every Pencil mark drawn so far that it
   * reaches - in a wipe or a stack block, the block's marks - each keeping
   * the part of the pass that reached it (core/smudge.ts). The width scales
   * with the transform, as a mark's does. Reaching none, it says so.
   */
  private smear(instruction: SmearInstruction, where: Where): void {
    const verb = 'smear';
    const m = this.frame.matrix;
    const width = this.positive(this.length(instruction.width, axisOf(verb, 'width'), where, verb), "A smear's width", where, verb) * meanScale(m);
    const strength = Math.min(1, Math.max(0, this.number(instruction.strength, where, verb)));
    const at = this.points(instruction.points, where, verb).map((p) => ({ ...apply(m, p), pressure: 0.5 }));
    const top = this.combining[this.combining.length - 1];
    const marks = top ? top.held : this.sink.currentPage().strokes;
    let reached = 0;
    for (const mark of marks) {
      if (mark.tool !== 'pencil') continue;
      const pass = smudgeFor(mark, at, width, strength);
      if (!pass) continue;
      mark.smudges = [...(mark.smudges ?? []), pass];
      reached++;
    }
    if (reached === 0) this.warn('smear-missed', '`smear` reached no pencil mark drawn so far: it spreads the graphite of the pencil marks it passes over.', where, verb);
  }

  /**
   * A `warp`, `twirl`, `pucker` or `bloat`: one of the app's Liquify brushes
   * pressed once at the point, where the line is under its transform, on
   * every mark drawn so far that it reaches - in a wipe or a stack block, the
   * block's marks - each bent where it is and fitted again after, as the app's
   * release fits it (core/liquify.ts). The radius scales with the transform,
   * Warp's push turns and scales with it, and a mirrored transform turns a
   * Twirl the other way, as it turns everything else. Reaching none, it says so.
   */
  private liquify(instruction: WarpInstruction | LiquifyInstruction, where: Where): void {
    const verb = instruction.verb;
    const m = this.frame.matrix;
    const local = this.point(instruction.x, instruction.y, where, verb);
    const at = apply(m, local);
    const radius = this.positive(this.length(instruction.radius, axisOf(verb, 'radius'), where, verb), "A brush's radius", where, verb) * meanScale(m);
    const dab: LiquifyDab = { mode: verb, x: at.x, y: at.y, radius };
    if (instruction.verb === 'warp') {
      const push = this.point(instruction.dx, instruction.dy, where, verb);
      const tip = apply(m, { x: local.x + push.x, y: local.y + push.y });
      dab.dx = tip.x - at.x;
      dab.dy = tip.y - at.y;
    } else {
      const amount = this.number(instruction.amount, where, verb);
      const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
      dab.amount = instruction.verb === 'twirl' ? (mirrored ? -amount : amount) : Math.min(1, Math.max(0, amount));
    }
    const top = this.combining[this.combining.length - 1];
    const marks = top ? top.held : this.sink.currentPage().strokes;
    // Each mark on its own: a block's held marks have no ids to tell them apart by.
    const bends: Array<{ mark: Stroke; bent: Stroke }> = [];
    for (const mark of marks) {
      const bent = liquifyMarks([mark], [dab], { refit: LIQUIFY_REFIT_PX }).values().next().value;
      if (bent) bends.push({ mark, bent });
    }
    if (bends.length === 0) {
      const place = `(${shown(fromPx(local.x, this.frame.units))}, ${shown(fromPx(local.y, this.frame.units))})`;
      this.warn('liquify-missed', `\`${verb}\` at ${place} reached no mark drawn so far: Liquify bends the marks under its brush, all but pencil marks.`, where, verb);
      return;
    }
    const size = (list: readonly Stroke[]): { anchors: number; points: number } =>
      list.reduce((sum, s) => ({ anchors: sum.anchors + (s.vector?.anchors.length ?? 0), points: sum.points + s.points.length }), { anchors: 0, points: 0 });
    const before = size(bends.map((b) => b.mark));
    const after = size(bends.map((b) => b.bent));
    this.afford(0, after.anchors - before.anchors, after.points - before.points, where, verb);
    for (const { mark, bent } of bends) {
      mark.points = bent.points;
      if (bent.vector) mark.vector = bent.vector;
      if (bent.nibAngle !== undefined) mark.nibAngle = bent.nibAngle;
    }
    this.spend(0, after.anchors - before.anchors, after.points - before.points);
  }

  /**
   * A block whose marks are combined into what it draws: a `wipe`'s or a
   * `stack`'s. The block keeps its paint and transforms to itself, as a
   * group's does, and its marks are held back from the sink while it runs.
   * `edit` then says what becomes of them - given them as a page of their
   * own, each on a layer of its own, so a piece added from one can be told
   * apart by the mark it is of - and each is put back as the edit left it, in
   * the order drawn: a mark changed, with the pieces added from it right
   * after; nothing for one taken away; and text, pictures and eraser marks
   * as they were. Effects written just before the block go on every mark it
   * leaves, as a group's go on everything in it. An edit that cannot be made
   * draws the marks as they are, with a warning.
   */
  private combine(
    body: readonly Instruction[],
    path: number[],
    where: Where,
    verb: 'wipe' | 'stack',
    label: string,
    emptyReason: string,
    edit: (page: Sketch, ids: string[]) => WipeResult,
  ): void {
    const effects = this.takeEffects();
    this.enter(where, verb);
    const held: Stroke[] = [];
    this.combining.push({ verb, held });
    let drawn = false;
    try {
      this.block(body, path, true);
      drawn = true;
    } finally {
      this.combining.pop();
      this.depth--;
      // The budget ran out in the block: what it drew stays as it was drawn.
      if (!drawn) for (const stroke of held) this.put(stroke);
    }
    const leave = (list: readonly Stroke[]): void => {
      for (const stroke of list) this.put(effects ? { ...stroke, effects: [...(stroke.effects ?? []), ...effects] } : stroke);
    };

    // The block's marks as a page of their own, each on a layer of its own,
    // so each piece added can be told apart by the mark it is of.
    const layerOf = (i: number): string => `wl${i}`;
    const idOf = (i: number): string => `w${i}`;
    const page: Sketch = {
      id: verb,
      name: verb,
      width: this.page.width,
      height: this.page.height,
      background: this.background,
      layers: held.map((_, i) => ({ id: layerOf(i), name: layerOf(i), opacity: 1, visible: true, locked: false })),
      strokes: held.map((stroke, i) => ({ ...stroke, id: idOf(i), layer: layerOf(i) })),
      createdAt: '',
      updatedAt: '',
    };
    const result = edit(page, page.strokes.map((stroke) => stroke.id));
    if (result.problem) {
      const operands = held.filter(isWipeable).length;
      const why =
        result.problem === 'too-few'
          ? 'its block drew fewer than two marks it can combine'
          : result.problem === 'too-many'
            ? operands > WIPE_OPERAND_LIMIT
              ? `it combines up to ${WIPE_OPERAND_LIMIT} marks, and its block drew ${operands}`
              : `its marks cut into more than ${WIPE_FACE_LIMIT} pieces`
            : 'the geometry of its marks could not be combined';
      this.warn('wipe-failed', `\`${label}\` did nothing: ${why}. Its marks are drawn as they are.`, where, verb);
      leave(held);
      return;
    }

    const bare = (stroke: Stroke): Stroke => {
      const copy: Stroke = { ...stroke, id: '' };
      delete copy.layer;
      return copy;
    };
    const left: Stroke[] = [];
    let passed = 0;
    held.forEach((stroke, i) => {
      const changed = result.changed.get(idOf(i));
      if (changed) left.push(bare(changed));
      else if (!result.removed.has(idOf(i))) {
        left.push(stroke);
        // As it was: a mark the edit cannot take, or one it never reached.
        if (result.skipped.has(idOf(i)) || stroke.tool === 'eraser') passed++;
      }
      for (const piece of result.added) if (piece.above === layerOf(i)) left.push(bare(piece.stroke));
    });
    if (passed > 0) {
      this.warn(
        'wipe-skipped',
        `\`${label}\` passed over ${passed === 1 ? 'a mark' : `${passed} marks`} it cannot combine, such as text, pictures and eraser marks, and drew ${passed === 1 ? 'it' : 'them'} as ${passed === 1 ? 'it was' : 'they were'}.`,
        where,
        verb,
      );
    }
    if (result.empty) this.warn('wipe-empty', `\`${label}\` left nothing: ${emptyReason}.`, where, verb);

    // The budget counts what the block leaves, not the operands it took.
    const size = (list: readonly Stroke[]): { anchors: number; points: number } =>
      list.reduce((sum, s) => ({ anchors: sum.anchors + (s.vector?.anchors.length ?? 0), points: sum.points + s.points.length }), { anchors: 0, points: 0 });
    const before = size(held);
    const after = size(left);
    const more = { marks: left.length - held.length, anchors: after.anchors - before.anchors, points: after.points - before.points };
    try {
      this.afford(more.marks, more.anchors, more.points, where, verb);
    } catch (err) {
      // No room for what the block leaves: its marks stay as they were drawn.
      leave(held);
      throw err;
    }
    leave(left);
    this.spend(more.marks, more.anchors, more.points);
  }

  /**
   * A `clip`: a group, as `group` makes one, whose content shows only inside
   * the block's last closed shape in paint order - the app's Make Clipping
   * Mask takes the topmost - which paints nothing while it clips
   * (core/clip.ts). With no closed shape in the block it is a plain group,
   * and says so.
   */
  private clip(instruction: ClipInstruction, path: number[], where: Where): void {
    const verb = 'clip';
    const page = this.sink.currentPage();
    const before = new Set(page.strokes);
    this.enter(where, verb);
    const groupId = this.sink.beginGroup(instruction.name ?? CLIP_GROUP_NAME, this.effectProps());
    this.groups++;
    try {
      this.block(instruction.body, path, true);
    } finally {
      this.groups--;
      this.sink.endGroup();
      this.depth--;
    }
    const drawn = new Set(page.strokes.filter((s) => !before.has(s)));
    const mark = paintOrder(page)
      .filter((s) => drawn.has(s))
      .reverse()
      .find(canClip);
    if (!mark) {
      this.warn('clip-open', '`clip` drew no closed shape in its block to clip with, so it is a plain group.', where, verb);
      return;
    }
    this.sink.clipGroup(groupId, mark);
  }

  private gradient(instruction: GradientInstruction, where: Where): Gradient | null {
    if (instruction.type === 'none') return null;
    const stops = (instruction.stops ?? []).map((stop) => ({
      offset: this.fraction(this.number(stop.offset, where, 'gradient'), 'A gradient stop offset', where, 'gradient'),
      color: stop.color,
    }));
    if (stops.length < 2) throw this.problem('invalid-value', 'A gradient needs at least two stops.', where, 'gradient');
    if (instruction.type === 'radial') return { type: 'radial', stops };
    const angle = instruction.angle === undefined ? 0 : degrees(this.number(instruction.angle, where, 'gradient'));
    return { type: 'linear', angle, stops };
  }

  private rough(instruction: RoughInstruction, where: Where): void {
    const amount = this.fraction(this.number(instruction.amount, where, 'rough'), 'A `rough` amount', where, 'rough');
    const passes = instruction.passes ?? 1;
    if (passes !== 1 && passes !== 2) {
      throw this.problem('invalid-value', `\`rough\` draws 1 pass or 2, and got ${shown(passes)}.`, where, 'rough');
    }
    const next = { amount, passes } as Frame['paint']['rough'];
    if (instruction.overshoot !== undefined) {
      next.overshoot = this.nonNegative(this.length(instruction.overshoot, 'min', where, 'rough'), 'An overshoot', where, 'rough');
    }
    this.frame.paint.rough = next;
  }

  private font(instruction: FontInstruction, where: Where): void {
    if (instruction.family !== undefined) this.frame.paint.font.family = instruction.family;
    if (instruction.size !== undefined) {
      this.frame.paint.font.size = this.positive(this.length(instruction.size, 'min', where, 'font'), 'A font size', where, 'font');
    }
  }

  /**
   * A shape from the library, fitted to its box. Each part is a mark in the
   * current paint that shows only what the asset showed. A part that would
   * show nothing in this paint - a backdrop when nothing is filled - is left
   * out.
   */
  private shape(instruction: ShapeInstruction, where: Where): void {
    const verb = 'shape';
    const found = findShape(instruction.name);
    if (!found) {
      const name = instruction.name.trim().toLowerCase();
      // `cube` means one of the cubes, which edit distance alone would not find.
      const family = name ? SHAPE_NAMES.filter((candidate) => candidate.startsWith(`${name}-`)) : [];
      const guesses = family.length > 0 ? family : [suggest(name, SHAPE_NAMES)].filter((g): g is string => g !== undefined);
      const hint = guesses.length > 0 ? ` Did you mean ${guesses.map((g) => `\`${g}\``).join(' or ')}?` : '';
      throw this.problem('unknown-shape', `The shape library has no \`${instruction.name}\`.${hint}`, where, verb);
    }
    const length = (field: string, value: LengthArg): number => this.length(value, axisOf(verb, field), where, verb);
    const width = this.positive(length('width', instruction.width), 'The size of a `shape`', where, verb);
    const height =
      instruction.height === undefined
        ? undefined
        : this.positive(length('height', instruction.height), 'The height of a `shape`', where, verb);
    const paint = this.frame.paint;
    const parts = [...fitShape(found, length('x', instruction.x), length('y', instruction.y), width, height)].filter(
      (part) => (part.fill && part.outline.closed && (paint.fill !== null || paint.gradient !== null)) || (part.stroke && paint.stroke),
    );
    // A shape of several parts takes its effects on a layer of its own, so they see the shape whole.
    const effects = parts.length > 1 ? this.takeEffects() : undefined;
    const cursor = effects ? this.sink.cursor() : null;
    if (effects) this.sink.newLayer(instruction.name, { effects });
    for (const part of parts) this.emit(part.outline, where, verb, { fill: part.fill, stroke: part.stroke });
    if (cursor) this.sink.restore(cursor);
  }

  private path(instruction: PathInstruction, path: number[], where: Where): void {
    let outline: Outline | null;
    if (instruction.d !== undefined) {
      const subpaths = parsePathD(instruction.d);
      if (!subpaths) {
        const text = instruction.d.length > 40 ? `${instruction.d.slice(0, 40)}...` : instruction.d;
        throw this.problem('invalid-value', `\`${text}\` is not SVG path data this build reads.`, where, 'path');
      }
      // Path data is read in the current units, like every other bare number.
      const unit = toPx(1, this.frame.units);
      const scale = (p: P): P => ({ x: p.x * unit, y: p.y * unit });
      outline = joinSubpaths(
        unit === 1
          ? subpaths
          : subpaths.map((sub) => ({
              closed: sub.closed,
              anchors: sub.anchors.map((a) => ({
                p: scale(a.p),
                ...(a.hIn ? { hIn: scale(a.hIn) } : {}),
                ...(a.hOut ? { hOut: scale(a.hOut) } : {}),
              })),
            })),
      );
    } else {
      outline = this.steps(instruction.body ?? [], path);
    }
    if (!outline) {
      throw this.problem('invalid-value', 'This `path` draws nothing: it needs a `move` and at least one segment after it.', where, 'path');
    }
    this.emit(outline, where, 'path');
  }

  /** A path block's steps to one outline, the way SVG path data draws. */
  private steps(steps: readonly PathStep[], path: number[]): Outline | null {
    const builder = new SubpathBuilder();
    let current: P | null = null;
    let start: P | null = null;
    let open = false;
    let control: P | null = null;
    for (let k = 0; k < steps.length; k++) {
      const step = steps[k];
      const verb = step.verb;
      const where = this.whereOf(step, [...path, k]);
      this.charge(where, verb);
      if (step.verb === 'move') {
        const p = this.point(step.x, step.y, where, verb);
        builder.moveTo(p);
        current = p;
        start = p;
        open = true;
        control = null;
        continue;
      }
      if (step.verb === 'close') {
        if (open) builder.close();
        open = false;
        current = start;
        control = null;
        continue;
      }
      if (!current || !start) {
        throw this.problem('invalid-value', `\`${verb}\` needs a point to start from: a path starts with \`move\`.`, where, verb);
      }
      // A step after `close` starts a new subpath where the closed one began.
      if (!open) {
        builder.moveTo(start);
        open = true;
      }
      const from: P = current;
      if (step.verb === 'through') {
        // After a curve, the mirror of its last handle sets off the curve smoothly.
        const lead = control ? { x: from.x - control.x, y: from.y - control.y } : undefined;
        const chain = throughAnchors([from, ...this.points(step.points, where, verb)], lead);
        for (let i = 1; i < chain.length; i++) {
          const a = chain[i - 1];
          const b = chain[i];
          if (a.hOut || b.hIn) builder.cubicTo(a.hOut ?? a.p, b.hIn ?? b.p, b.p);
          else builder.lineTo(b.p);
        }
        current = chain[chain.length - 1].p;
        control = chain[chain.length - 1].hIn ?? null;
        continue;
      }
      if (step.verb === 'to' || step.verb === 'by') {
        const p =
          step.verb === 'to'
            ? this.point(step.x, step.y, where, verb)
            : { x: from.x + this.length(step.dx, 'x', where, verb), y: from.y + this.length(step.dy, 'y', where, verb) };
        builder.lineTo(p);
        current = p;
        control = null;
        continue;
      }
      const c1: P =
        step.verb === 'curve'
          ? this.point(step.c1x, step.c1y, where, verb)
          : control
            ? { x: 2 * from.x - control.x, y: 2 * from.y - control.y }
            : from;
      const c2 = this.point(step.c2x, step.c2y, where, verb);
      const p = this.point(step.x, step.y, where, verb);
      builder.cubicTo(c1, c2, p);
      current = p;
      control = c2;
    }
    builder.flush();
    return joinSubpaths(builder.subpaths);
  }

  private let(instruction: LetInstruction, where: Where): void {
    const value = instruction.value;
    let number: number;
    if (typeof value === 'number') number = value;
    else if (isExpr(value)) number = this.expression(value, undefined, where, 'let');
    else {
      // A length with a unit becomes a number in the units in force now.
      const px = this.length(value, 'none', where, 'let');
      number = fromPx(px, this.frame.units);
    }
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].vars.has(instruction.name)) {
        this.scopes[i].vars.set(instruction.name, number);
        return;
      }
    }
    this.scopes[this.scopes.length - 1].vars.set(instruction.name, number);
  }

  private definition(name: string): Definition | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i].defs.get(name);
      if (found) return found;
    }
    return undefined;
  }

  private place(instruction: PlaceInstruction, where: Where): void {
    const name = instruction.name;
    const entry = this.definition(name);
    if (!entry) {
      throw this.problem('unknown-definition', `\`${name}\` has not been defined; \`define "${name}" { ... }\` records it.`, where, 'place');
    }
    const loop = this.placing.indexOf(name);
    if (loop >= 0) {
      const via = this.placing.slice(loop + 1);
      const how = via.length > 0 ? `, by way of ${via.map((n) => `\`${n}\``).join(', ')}` : '';
      throw this.problem('recursive-definition', `\`${name}\` places itself${how}.`, where, 'place');
    }
    const x = instruction.x === undefined ? 0 : this.length(instruction.x, 'x', where, 'place');
    const y = instruction.y === undefined ? 0 : this.length(instruction.y, 'y', where, 'place');
    const s = instruction.scale === undefined ? 1 : this.number(instruction.scale, where, 'place');
    if (s === 0) throw this.problem('invalid-value', 'A `place` at scale 0 would draw nothing.', where, 'place');
    const r = instruction.rotate === undefined ? 0 : this.number(instruction.rotate, where, 'place');
    this.enter(where, 'place');
    const saved = copyFrame(this.frame);
    const cursor = this.sink.cursor();
    // A placement that takes effects is drawn as a group of its own, which carries them.
    const effects = this.takeEffects();
    const outer = this.pending;
    this.pending = [];
    this.placing.push(name);
    try {
      // The definition's origin lands at the placing point, turned and scaled about itself.
      this.transform(multiply(multiply(translation(x, y), rotation(r)), scaling(s, s)));
      if (effects) this.sink.beginGroup(name, { effects });
      this.block(entry.instruction.body, entry.path, false);
      this.dropEffects('its definition ended');
    } finally {
      this.placing.pop();
      this.sink.restore(cursor);
      this.frame = saved;
      this.depth--;
      this.pending = outer;
    }
  }

  private repeat(instruction: RepeatInstruction, path: number[], where: Where): void {
    const count = this.number(instruction.count, where, 'repeat');
    if (!Number.isInteger(count) || count < 0) {
      throw this.problem('invalid-value', `\`repeat\` runs a whole number of times, 0 or more, and got ${shown(count)}.`, where, 'repeat');
    }
    this.enter(where, 'repeat');
    const scope: Scope = { vars: new Map(), defs: new Map() };
    this.hoist(instruction.body, path, scope);
    this.scopes.push(scope);
    let warned = false;
    try {
      for (let n = 0; n < count; n++) {
        // Each pass costs at least one instruction, so an empty body cannot spin forever.
        this.charge(where, 'repeat');
        if (instruction.as) scope.vars.set(instruction.as, n);
        this.pushes.push([]);
        try {
          this.runList(instruction.body, path);
        } finally {
          const left = this.settle(this.pushes.pop() ?? []);
          if (left && !warned) {
            warned = true;
            this.unbalanced(left);
          }
        }
      }
    } finally {
      this.scopes.pop();
      this.depth--;
    }
  }

  private box(instruction: RegistrationInstruction | (CropInstruction & { mode: 'box' }), where: Where): Box {
    const verb = instruction.verb;
    return {
      x: this.length(instruction.x ?? 0, 'x', where, verb),
      y: this.length(instruction.y ?? 0, 'y', where, verb),
      width: this.positive(this.length(instruction.width ?? 0, 'x', where, verb), 'A box width', where, verb),
      height: this.positive(this.length(instruction.height ?? 0, 'y', where, verb), 'A box height', where, verb),
    };
  }

  private crop(instruction: CropInstruction, where: Where): CropHint {
    if (instruction.mode === 'none') return { mode: 'none' };
    if (instruction.mode === 'auto') {
      const pad = instruction.pad === undefined ? 0 : this.nonNegative(this.length(instruction.pad, 'min', where, 'crop'), 'A crop pad', where, 'crop');
      return { mode: 'auto', pad };
    }
    return { mode: 'box', ...this.box({ ...instruction, mode: 'box' }, where) };
  }
}

/**
 * Runs a checked script against a sink. The script must come from
 * `parseScript` or `validateScript`; {@link evaluate} does both halves.
 */
export function runScript(script: readonly Instruction[], sink: ScriptSink, options: EvaluateOptions = {}): RunResult {
  const evaluator = new Evaluator(sink, { ...SCRIPT_LIMITS, ...options.limits }, options);
  evaluator.run(script);
  return { diagnostics: evaluator.diagnostics, stats: evaluator.stats, output: evaluator.output, seed: evaluator.seed };
}

/**
 * Reads and runs a script - napkin script text, or a JSON value built as the
 * object form - and returns the drawing as a sketch book with everything that
 * was wrong. Never throws for anything in the script. A script that names a
 * language version newer than this build reads is not run at all.
 */
export function evaluate(source: ScriptSource, options: EvaluateOptions = {}): ScriptResult {
  const read = typeof source === 'string' ? parseScript(source, options) : validateScript(source, options);
  const sink = new SketchSink({ name: options.name ?? 'drawing', timestamp: options.timestamp ?? new Date().toISOString() });
  const newer = read.diagnostics.some((d) => d.code === 'version-unsupported');
  const run = runScript(newer ? [] : read.script, sink, options);
  const diagnostics = sortDiagnostics([...read.diagnostics, ...run.diagnostics]);
  return {
    ok: !hasErrors(diagnostics),
    book: sink.finish(),
    diagnostics,
    stats: run.stats,
    output: run.output,
    seed: run.seed,
  };
}
