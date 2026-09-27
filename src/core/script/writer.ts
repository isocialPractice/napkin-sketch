/**
 * A drawing to napkin script: the evaluator run the other way.
 *
 * `evaluate` turns a script into a sketch book through a sink. This turns a
 * sketch, or a whole book, into the script that draws it back: the same marks,
 * in the same layer tree, with the same paint. `formatScript` writes the result
 * as text a person can read and change, and running that text draws the page
 * again.
 *
 * What a mark becomes:
 *
 * - A line, shape or path: its paint where the paint changes, then
 *   `path { ... }` with `move`, `to` and `curve` steps from its Bezier anchors,
 *   and `close` when it closes. A freehand line has no anchors, so it is
 *   written as `to` steps through its points, pruned to within a tenth of a
 *   pixel as the SVG export prunes them. A Copic line or a profiled one keeps
 *   every point, since its outline is drawn from each of them.
 * - An eraser: `tool eraser`, then its path.
 * - Text: `font` and `color` where they change, then `text "..." at x y`, with
 *   `box` for a fixed width. The point is the text's top left, so it is
 *   written left-aligned.
 * - An image: `image` with its data URL. A linked file is `link`, which makes
 *   a layer of its own, so a layer whose first mark is a linked file is made
 *   by that `link`.
 * - Effects: `effect` lines just before the mark, layer or group they belong to.
 *
 * Paint is written only where it changes, the way the evaluator's running
 * state holds it, so a drawing in one color says `color` once. An `opacity`
 * cannot be taken back to "the tool's own", so marks with an opacity of their
 * own are written inside `push` and `pop`, which puts it back.
 *
 * Marks are written in the page's paint order wherever the layer tree allows:
 * a layer is named again to draw on it again, but a group is one block, so a
 * group's marks are written together. Layers are made in the order they
 * stack. Ids are not written; the evaluator counts its own.
 *
 * What the language cannot say is reported in `notes`, a sentence for each
 * kind: pen pressure, a mirrored Wave profile, a layer name used twice in one
 * group (renamed, since a script draws on a layer by naming it), and the like.
 *
 * Pure and DOM-free, so the app, the command line and a test all write scripts
 * with it.
 */

import { simplify } from '../../sharpen/geometry.js';
import type { Effect } from '../effects.js';
import { linkName } from '../link.js';
import { EXPORT_SIMPLIFY_EPSILON } from '../svg-path.js';
import { activeProfile } from '../stroke-profile.js';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_NIB_ANGLE,
  isClosedStroke,
  isImageStroke,
  isTextStroke,
  type Gradient,
  type Point,
  type Sketch,
  type SketchBook,
  type Stroke,
  type StrokeProfile,
  type StrokeStyle,
  type VectorAnchor,
} from '../types.js';
import { toPx } from '../units.js';
import {
  PAPER_SIZES,
  SCRIPT_VERSION,
  type DocumentInstruction,
  type EffectInstruction,
  type LayerInstruction,
  type PageInstruction,
  type PaperName,
  type PathStep,
  type ScriptTool,
  type StopArg,
} from './instructions.js';
import { isImageDataUrl, layerTree, type LayerNode } from './media.js';
import { inkBox } from './render.js';
import { DEFAULT_INK, DEFAULT_TEXT_SIZE, DEFAULT_WIDTH } from './state.js';
import { isColor } from './values.js';

// ---- Options and results ------------------------------------------------------

/** How much of a page to write, and how. */
export interface WriteOptions {
  /**
   * The layers to write, by id: each with everything inside it, and the groups
   * above it kept, holding only what was chosen, so the tree still stands.
   * Every layer when absent. A book writes every page's layers.
   */
  readonly layers?: readonly string[];
  /**
   * `fit` writes a page the size of the ink it holds - of the chosen layers,
   * when `layers` chooses some - with every mark moved so the ink starts at
   * the page's corner. `keep`, the default, writes the page at its own size
   * with every mark where it is.
   */
  readonly page?: 'keep' | 'fit';
  /**
   * The decimal places a coordinate is written to: 2 unless given, a hundredth
   * of a pixel, which is what the SVG export writes too. Null writes every
   * digit, and the script then draws the page back exactly. Widths, sizes,
   * opacities, angles and gradient stops are always written whole.
   */
  readonly decimals?: number | null;
  /**
   * Keep, for each mark written, the first instruction written for it - the
   * line that names its layer, a paint line, or its path - in
   * {@link WrittenScript.firsts}, so a comment can be put before the mark.
   */
  readonly trace?: boolean;
}

/** How big a written script is. */
export interface WriteStats {
  /** Instructions, counting what is inside a group and not a path's own steps. */
  readonly instructions: number;
  readonly marks: number;
  /** Layers and groups. */
  readonly layers: number;
  readonly pages: number;
}

/** A written script, and what it could not say exactly. */
export interface WrittenScript {
  readonly script: DocumentInstruction[];
  /**
   * A sentence for each kind of thing the script draws differently from the
   * page, or leaves out. Empty when it draws the page as it is.
   */
  readonly notes: string[];
  readonly stats: WriteStats;
  /** With `trace`: each mark written, by the page's own stroke object, and the first instruction written for it. */
  readonly firsts?: ReadonlyMap<Stroke, DocumentInstruction>;
}

// ---- Paint -------------------------------------------------------------------

/** What the evaluator's running paint holds, as far as the writer sets it. */
interface Paint {
  tool: ScriptTool;
  color: string;
  width: number;
  opacity: number | undefined;
  fill: string | null;
  gradient: Gradient | null;
  stroke: boolean;
  style: StrokeStyle;
  profile: StrokeProfile;
  nib: number;
  family: string;
  size: number;
}

/** The paint a script starts with, as `defaultPaint` gives it. */
function startingPaint(): Paint {
  return {
    tool: 'pen',
    color: DEFAULT_INK,
    width: DEFAULT_WIDTH,
    opacity: undefined,
    fill: null,
    gradient: null,
    stroke: true,
    style: 'solid',
    profile: 'uniform',
    nib: DEFAULT_NIB_ANGLE,
    family: DEFAULT_FONT_FAMILY,
    size: DEFAULT_TEXT_SIZE,
  };
}

function copyPaint(paint: Paint): Paint {
  return {
    ...paint,
    gradient: paint.gradient ? { ...paint.gradient, stops: paint.gradient.stops.map((stop) => ({ ...stop })) } : null,
  };
}

/** An angle as the evaluator keeps one: 0 up to 360. */
function turn(degrees: number): number {
  const angle = ((degrees % 360) + 360) % 360;
  return Math.round(angle * 1e9) / 1e9;
}

/** A gradient as the evaluator holds it once a `gradient` line has run: colors lower-cased, the angle turned into range. */
function heldGradient(gradient: Gradient): Gradient {
  const stops = gradient.stops.map((stop) => ({ offset: stop.offset, color: stop.color.toLowerCase() }));
  return gradient.type === 'radial' ? { type: 'radial', stops } : { type: 'linear', angle: turn(gradient.angle ?? 0), stops };
}

function sameGradient(a: Gradient | null, b: Gradient | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A gradient the evaluator can draw: two or more stops, each at an offset from 0 to 1. */
function drawableGradient(gradient: Gradient | undefined): Gradient | null {
  if (!gradient || gradient.stops.length < 2) return null;
  const inRange = gradient.stops.every((stop) => Number.isFinite(stop.offset) && stop.offset >= 0 && stop.offset <= 1);
  return inRange ? gradient : null;
}

// ---- Notes -----------------------------------------------------------------------

/** What could not be said exactly, counted by kind and worded once at the end. */
class Notes {
  private readonly counts = new Map<string, number>();
  private readonly lines: string[] = [];

  count(kind: string): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }

  /** A note that stands alone, such as one layer renamed. */
  say(sentence: string): void {
    if (!this.lines.includes(sentence)) this.lines.push(sentence);
  }

  sentences(): string[] {
    const n = (kind: string): number => this.counts.get(kind) ?? 0;
    const out = [...this.lines];
    const marks = (count: number, one: string, many: string): string => (count === 1 ? `1 ${one}` : `${count} ${many}`);
    if (n('pressure') > 0) {
      out.push(
        `${marks(n('pressure'), 'freehand line drawn with pen pressure is', 'freehand lines drawn with pen pressure are')} written with even pressure: the language has no pressure, so the width no longer swells and thins.`,
      );
    }
    if (n('mirrored') > 0) {
      out.push(`${marks(n('mirrored'), 'mark with a mirrored Wave profile is', 'marks with a mirrored Wave profile are')} written unmirrored: the language cannot mirror a profile.`);
    }
    if (n('gap') > 0) {
      out.push(`${marks(n('gap'), 'filled shape is', 'filled shapes are')} closed with a straight line across a gap in its outline, since a script fills only a closed path.`);
    }
    if (n('link') > 0) {
      out.push(`${marks(n('link'), 'linked file shared', 'linked files shared')} a layer with other marks and ${n('link') === 1 ? 'is' : 'are'} written on a layer of its own, as a link always is.`);
    }
    if (n('image') > 0) {
      out.push(`${marks(n('image'), 'image holds', 'images hold')} no image data and ${n('image') === 1 ? 'is' : 'are'} left out.`);
    }
    if (n('text') > 0) {
      out.push(`${marks(n('text'), 'empty text item is', 'empty text items are')} left out.`);
    }
    if (n('number') > 0) {
      out.push(`${marks(n('number'), 'mark with a position that is not a number is', 'marks with a position that is not a number are')} left out.`);
    }
    if (n('color') > 0) {
      out.push(`${marks(n('color'), 'color is not one', 'colors are not ones')} a script can name and ${n('color') === 1 ? 'is' : 'are'} written as black.`);
    }
    return out;
  }
}

// ---- The writer --------------------------------------------------------------------

/** One level of the layer tree as it is written: a node and the name it is written under. */
interface Scope {
  /** The child that marks go to now, by index, or -1 when none has been named yet. */
  current: number;
}

/** The page as far as a write reaches: the layers of the tree being written, and their marks, for measuring its ink. */
function partOf(sketch: Sketch, tree: readonly LayerNode[]): Sketch {
  const layers: Sketch['layers'] = [];
  const strokes: Stroke[] = [];
  const walk = (nodes: readonly LayerNode[]): void => {
    for (const node of nodes) {
      layers.push(node.layer);
      strokes.push(...node.strokes);
      walk(node.children);
    }
  };
  walk(tree);
  return { ...sketch, layers, strokes };
}

/** The part of a page a subtree write keeps: the chosen layers, what they hold, and the groups above them. */
function subtree(nodes: readonly LayerNode[], chosen: ReadonlySet<string>): LayerNode[] {
  const holds = (node: LayerNode): boolean => chosen.has(node.layer.id) || node.children.some(holds);
  const out: LayerNode[] = [];
  for (const node of nodes) {
    if (chosen.has(node.layer.id)) out.push(node);
    else if (node.layer.group && holds(node)) out.push({ ...node, children: subtree(node.children, chosen) });
  }
  return out;
}

class ScriptWriter {
  readonly script: DocumentInstruction[] = [];
  readonly notes = new Notes();
  private body: DocumentInstruction[] = this.script;
  private paint = startingPaint();
  /** The paint a `push` saved, while one is open. */
  private pushed: Paint | null = null;
  private instructions = 0;
  private marks = 0;
  private layers = 0;
  private pages = 0;
  /** Each mark's place in its page's paint order. */
  private order = new Map<Stroke, number>();
  private readonly scale: number | null;
  /** The marks the next instruction is the first of, while `trace` is on: one, or a mark and one written inside it. */
  private starting: Stroke[] = [];
  /** Each mark's first instruction, kept when `trace` is on. */
  readonly firsts = new Map<Stroke, DocumentInstruction>();

  constructor(private readonly options: WriteOptions) {
    const decimals = options.decimals === undefined ? 2 : options.decimals;
    this.scale = decimals === null ? null : 10 ** Math.max(0, Math.min(12, Math.round(decimals)));
  }

  stats(): WriteStats {
    return { instructions: this.instructions, marks: this.marks, layers: this.layers, pages: this.pages };
  }

  private add(instruction: DocumentInstruction): void {
    for (const stroke of this.starting) this.firsts.set(stroke, instruction);
    this.starting = [];
    this.body.push(instruction);
    this.instructions++;
  }

  /**
   * Writes a mark, keeping its first instruction when a trace is asked for:
   * the first line written from here on, which may make its layer.
   */
  private traced(stroke: Stroke, write: () => void): void {
    if (this.options.trace) this.starting.push(stroke);
    try {
      write();
    } finally {
      // A mark with nothing to draw writes nothing, and the next line is not its.
      this.starting = this.starting.filter((waiting) => waiting !== stroke);
    }
  }

  /** Where a fitted page's corner sits on the page it was written from. */
  private origin = { x: 0, y: 0 };
  /** The size the last page was written at, which the next page's `page` line is weighed against. */
  private written: { width: number; height: number } | null = null;

  /** A coordinate as it is written: moved onto a fitted page, then rounded to the decimals asked for. */
  private round(value: number): number {
    if (this.scale === null) return value;
    const rounded = Math.round(value * this.scale) / this.scale;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  private x(value: number): number {
    return this.round(value - this.origin.x);
  }

  private y(value: number): number {
    return this.round(value - this.origin.y);
  }

  // ---- Pages ----------------------------------------------------------------

  /**
   * Writes one page: its size, paper and name, then its layers and marks.
   * A fitted page is the size of the ink written on it, with every mark moved
   * by the same amount so the ink starts at its corner.
   */
  page(sketch: Sketch, previous: Sketch | null): void {
    this.pages++;
    this.order = new Map(sketch.strokes.map((stroke, index) => [stroke, index]));
    const all = layerTree(sketch);
    const chosen = this.options.layers ? new Set(this.options.layers) : null;
    const tree = chosen ? subtree(all, chosen) : all;
    let size = { width: sketch.width, height: sketch.height };
    this.origin = { x: 0, y: 0 };
    if (this.options.page === 'fit') {
      const box = inkBox(partOf(sketch, tree));
      if (box) {
        this.origin = { x: box.x, y: box.y };
        size = { width: Math.max(1, Math.ceil(box.width)), height: Math.max(1, Math.ceil(box.height)) };
      }
    }
    if (previous === null) {
      this.add({ verb: 'napkin', version: SCRIPT_VERSION });
      this.add(pageInstruction(size.width, size.height));
      this.add(this.background(sketch.background));
      this.add({ verb: 'name', name: sketch.name });
    } else {
      this.closePush();
      this.add({ verb: 'newpage', name: sketch.name });
      if (size.width !== this.written?.width || size.height !== this.written?.height) this.add(pageInstruction(size.width, size.height));
      if (sketch.background !== previous.background) this.add(this.background(sketch.background));
    }
    this.written = size;
    this.scope(tree, true);
    this.closePush();
  }

  private background(color: string): DocumentInstruction {
    const value = color.trim().toLowerCase();
    if (value === 'transparent' || value === 'none' || value === '') return { verb: 'background', color: null };
    return { verb: 'background', color: this.color(color) };
  }

  // ---- The layer tree ---------------------------------------------------------

  /** The first mark of a node's subtree in paint order, or Infinity when it holds none. */
  private firstMark(node: LayerNode): number {
    let first = Infinity;
    for (const stroke of node.strokes) first = Math.min(first, this.order.get(stroke) ?? Infinity);
    for (const child of node.children) first = Math.min(first, this.firstMark(child));
    return first;
  }

  /**
   * The name each child is written under. A script draws on a layer by naming
   * it, so two drawing layers of one name in one group would become one: the
   * second takes a `-2`, as editors number a repeat. At the top of a page the
   * page's first layer, `Layer 1`, is already there; a `Layer 1` anywhere but
   * first is renamed for the same reason.
   */
  private names(children: readonly LayerNode[], top: boolean): string[] {
    const taken = new Set<string>();
    if (top && !(children[0] && !children[0].layer.group && children[0].layer.name === 'Layer 1')) taken.add('Layer 1');
    return children.map((child) => {
      const name = child.layer.name;
      if (child.layer.group) return name;
      let written = name;
      for (let n = 2; taken.has(written); n++) written = `${name}-${n}`;
      taken.add(written);
      if (written !== name) {
        this.notes.say(`The layer "${name}" is written as "${written}", since a script draws on a layer by naming it and another layer in its group already has that name.`);
      }
      return written;
    });
  }

  /**
   * Writes one level of the tree. Its layers and groups are made in the order
   * they stack; its marks follow the page's paint order, a layer named again
   * when a mark goes to another one. A group is written whole where its first
   * mark falls, since a group cannot be opened twice.
   */
  private scope(children: readonly LayerNode[], top: boolean): void {
    const names = this.names(children, top);
    const events: { at: number; child: number; stroke?: Stroke }[] = [];
    children.forEach((node, child) => {
      if (node.layer.group) events.push({ at: this.firstMark(node), child });
      else for (const stroke of node.strokes) events.push({ at: this.order.get(stroke) ?? Infinity, child, stroke });
    });
    events.sort((a, b) => a.at - b.at);
    const scope: Scope = { current: -1 };
    const written = new Set<Stroke>();
    let made = 0;
    const makeThrough = (last: number): void => {
      for (; made <= last && made < children.length; made++) this.make(children[made], names[made], made, top, scope, written);
    };
    for (const event of events) {
      const stroke = event.stroke;
      if (!stroke || written.has(stroke)) {
        makeThrough(event.child);
        continue;
      }
      // The layers made for a mark are part of it: a comment before the mark
      // goes before the layer it is the first to need.
      this.traced(stroke, () => {
        makeThrough(event.child);
        // Making a layer for a linked file writes the file itself.
        if (written.has(stroke)) return;
        written.add(stroke);
        if (scope.current !== event.child) {
          this.add({ verb: 'layer', name: names[event.child] });
          scope.current = event.child;
        }
        this.mark(stroke, null);
      });
    }
    makeThrough(children.length - 1);
  }

  /** Makes one child: a group written whole, or a layer named with its own properties. */
  private make(node: LayerNode, name: string, index: number, top: boolean, scope: Scope, written: Set<Stroke>): void {
    const layer = node.layer;
    this.layers++;
    if (layer.group) {
      this.group(node, name);
      return;
    }
    const props = layerProps(layer);
    const plain = Object.keys(props).length === 0 && !layer.effects?.length;
    const first = node.strokes[0];
    if (first && isImageStroke(first) && first.link) {
      // A linked file makes a layer of its own, so the first one on this
      // layer makes it; the marks after it name the layer to join it.
      written.add(first);
      this.traced(first, () => this.mark(first, name));
      if (!plain) {
        this.effects(layer.effects);
        this.add({ verb: 'layer', name, ...props });
        scope.current = index;
      }
      return;
    }
    // A page starts on a layer called `Layer 1`, so the first layer of that
    // name needs no line of its own unless it has something to say.
    if (top && index === 0 && name === 'Layer 1' && plain) {
      scope.current = index;
      return;
    }
    this.effects(layer.effects);
    this.add({ verb: 'layer', name, ...props });
    scope.current = index;
  }

  private group(node: LayerNode, name: string): void {
    this.closePush();
    this.effects(node.layer.effects);
    const body: DocumentInstruction[] = [];
    this.add({ verb: 'group', name, ...layerProps(node.layer), body });
    const outer = this.body;
    // A group's block puts the paint back when it ends, as the evaluator does.
    const paint = copyPaint(this.paint);
    this.body = body;
    try {
      this.scope(node.children, false);
      this.closePush();
    } finally {
      this.body = outer;
      this.paint = paint;
    }
  }

  // ---- Marks ------------------------------------------------------------------------

  /**
   * One mark. `layer` is the name of the layer a linked file is making, or
   * null for a mark drawn on the layer already current.
   */
  private mark(stroke: Stroke, layer: string | null): void {
    if (isTextStroke(stroke)) return this.text(stroke);
    if (isImageStroke(stroke)) return stroke.link ? this.link(stroke, layer) : this.image(stroke);
    if (stroke.tool === 'pen' || stroke.tool === 'marker' || stroke.tool === 'copic' || stroke.tool === 'eraser') this.line(stroke);
  }

  private line(stroke: Stroke): void {
    const shape = this.pathOf(stroke);
    if (!shape) return;
    const tool = stroke.tool as ScriptTool;
    this.setOpacity(stroke.opacity);
    this.setTool(tool);
    this.setColor(stroke.color);
    if (Number.isFinite(stroke.width) && stroke.width > 0) this.setWidth(stroke.width);
    if (tool !== 'eraser') {
      if (shape.closed) {
        this.setFill(stroke.fill ?? null);
        this.setGradient(drawableGradient(stroke.gradient));
      }
      // A width of nothing draws no outline, which is what `stroke off` says.
      this.setStroke(!stroke.noStroke && Number.isFinite(stroke.width) && stroke.width > 0);
      this.setStyle(stroke.strokeStyle ?? 'solid');
      if (tool === 'pen' || tool === 'marker') this.setProfile(stroke.profile ?? 'uniform');
      if (tool === 'copic') this.setNib(stroke.nibAngle ?? DEFAULT_NIB_ANGLE);
      this.effects(stroke.effects);
    }
    if (stroke.profileMirrored && stroke.profile === 'wave') this.notes.count('mirrored');
    if (!stroke.vector && stroke.points.some((p) => p.pressure !== undefined && p.pressure !== 0.5)) this.notes.count('pressure');
    this.add({ verb: 'path', body: shape.steps });
    this.marks++;
  }

  /**
   * A mark's outline as path steps: from its anchors when it has them, from
   * its points when it is freehand. Null when there is nothing to draw, or a
   * position is not a number.
   */
  private pathOf(stroke: Stroke): { steps: PathStep[]; closed: boolean } | null {
    const filled = (stroke.fill !== undefined || drawableGradient(stroke.gradient) !== null) && stroke.tool !== 'eraser';
    const anchors = stroke.vector?.anchors;
    // Closing a shape to keep its fill draws a line across the gap in its
    // outline, which shows only when the outline does.
    const outlined = !stroke.noStroke && stroke.width > 0;
    let shape: { steps: PathStep[]; closed: boolean } | null;
    if (anchors && anchors.length >= 2) {
      const closed = stroke.vector?.closed === true;
      // The app fills a shape whose ends nearly meet; a script fills only a closed one.
      const closing = !closed && filled && isClosedStroke(stroke);
      if (closing && outlined && gap(anchors[0].p, anchors[anchors.length - 1].p) > 0.5) this.notes.count('gap');
      shape = this.anchorSteps(anchors, closed || closing, closed);
    } else {
      const points = stroke.points;
      const closed = filled && isClosedStroke(stroke);
      if (closed && outlined && points.length > 1 && gap(points[0], points[points.length - 1]) > 0.5) this.notes.count('gap');
      // A Copic nib and a profile draw from every point; anything else is pruned as the SVG export prunes it.
      const keepAll = stroke.tool === 'copic' || activeProfile(stroke) !== undefined;
      shape = this.pointSteps(points, closed, keepAll);
    }
    if (shape === null) return null;
    if (!shape.steps.every(finiteStep)) {
      this.notes.count('number');
      return null;
    }
    return shape;
  }

  /**
   * Steps through Bezier anchors: a subpath from each `move` anchor, each
   * closed back to its own start when the mark closes. `kept` is true when
   * the mark was closed already, so a last anchor sitting on its start is
   * one of its own and is kept; a mark closed only to keep its fill lets it
   * fold.
   */
  private anchorSteps(anchors: readonly VectorAnchor[], closed: boolean, kept: boolean): { steps: PathStep[]; closed: boolean } | null {
    const steps: PathStep[] = [];
    const subpaths: VectorAnchor[][] = [];
    for (const anchor of anchors) {
      if (anchor.move || subpaths.length === 0) subpaths.push([anchor]);
      else subpaths[subpaths.length - 1].push(anchor);
    }
    for (const sub of subpaths) {
      if (sub.length < 2) continue;
      steps.push({ verb: 'move', x: this.x(sub[0].p.x), y: this.y(sub[0].p.y) });
      for (let i = 1; i < sub.length; i++) steps.push(this.segment(sub[i - 1], sub[i]));
      if (closed) {
        const last = sub[sub.length - 1];
        // `close` folds a last anchor that sits on the start into the start,
        // as it does for SVG path data. So the way back is written out - as a
        // curve when it curves, and as a line of no length when the last
        // anchor already sits on the start - and it is that repeat that folds,
        // leaving every anchor the mark has.
        if (last.hOut || sub[0].hIn || (kept && samePlace(last.p, sub[0].p))) steps.push(this.segment(last, sub[0]));
        steps.push({ verb: 'close' });
      }
    }
    return steps.length > 0 ? { steps, closed } : null;
  }

  private segment(from: VectorAnchor, to: VectorAnchor): PathStep {
    if (!from.hOut && !to.hIn) return { verb: 'to', x: this.x(to.p.x), y: this.y(to.p.y) };
    const c1 = from.hOut ?? from.p;
    const c2 = to.hIn ?? to.p;
    return {
      verb: 'curve',
      c1x: this.x(c1.x),
      c1y: this.y(c1.y),
      c2x: this.x(c2.x),
      c2y: this.y(c2.y),
      x: this.x(to.p.x),
      y: this.y(to.p.y),
    };
  }

  /** Steps through a freehand mark's points: a subpath from each `move` point, a lone point drawn as a dot. */
  private pointSteps(points: readonly Point[], closed: boolean, keepAll: boolean): { steps: PathStep[]; closed: boolean } | null {
    const runs: Point[][] = [];
    for (const point of points) {
      if (point.move || runs.length === 0) runs.push([point]);
      else runs[runs.length - 1].push(point);
    }
    const steps: PathStep[] = [];
    for (const run of runs) {
      const kept = keepAll || run.length < 3 ? run : simplify([...run], EXPORT_SIMPLIFY_EPSILON);
      const first = kept[0];
      steps.push({ verb: 'move', x: this.x(first.x), y: this.y(first.y) });
      // A dot is a line of no length, which the round cap draws as a dot.
      const rest = kept.length === 1 ? [first] : kept.slice(1);
      for (const point of rest) steps.push({ verb: 'to', x: this.x(point.x), y: this.y(point.y) });
      if (closed && kept.length >= 3) steps.push({ verb: 'close' });
    }
    return steps.length > 0 ? { steps, closed } : null;
  }

  private text(stroke: Stroke): void {
    const text = stroke.text ?? '';
    const at = stroke.points[0];
    if (text.trim() === '') {
      this.notes.count('text');
      return;
    }
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
      this.notes.count('number');
      return;
    }
    this.setOpacity(stroke.opacity);
    this.setColor(stroke.color);
    const size = stroke.fontSize !== undefined && stroke.fontSize > 0 ? stroke.fontSize : DEFAULT_TEXT_SIZE;
    this.setFont(stroke.fontFamily ?? DEFAULT_FONT_FAMILY, size);
    this.effects(stroke.effects);
    const box = stroke.textBoxWidth !== undefined && stroke.textBoxWidth > 0 ? stroke.textBoxWidth : undefined;
    this.add({ verb: 'text', text, x: this.x(at.x), y: this.y(at.y), ...(box !== undefined ? { box } : {}) });
    this.marks++;
  }

  private image(stroke: Stroke): void {
    const src = (stroke.image ?? '').trim();
    const at = stroke.points[0];
    if (!isImageDataUrl(src)) {
      this.notes.count('image');
      return;
    }
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
      this.notes.count('number');
      return;
    }
    this.setOpacity(stroke.opacity);
    this.effects(stroke.effects);
    this.add({ verb: 'image', src, x: this.x(at.x), y: this.y(at.y), ...size(stroke) });
    this.marks++;
  }

  /**
   * A linked file. It makes a layer of its own: the one being made when
   * `layer` names it, or else one of its file's name beside the layer it was
   * on, which the notes say.
   */
  private link(stroke: Stroke, layer: string | null): void {
    const href = stroke.link?.href.trim() ?? '';
    const at = stroke.points[0];
    if (href === '' || /^data:/i.test(href)) {
      this.notes.count('image');
      return;
    }
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
      this.notes.count('number');
      return;
    }
    if (layer === null) this.notes.count('link');
    this.setOpacity(stroke.opacity);
    this.effects(stroke.effects);
    const name = layer !== null && layer !== linkName(href) ? { name: layer } : {};
    this.add({ verb: 'link', href, x: this.x(at.x), y: this.y(at.y), ...size(stroke), ...name });
    this.marks++;
  }

  // ---- Paint, where it changes --------------------------------------------------------

  /** A color a script can name, lower-cased as the parser reads it, or black with a note. */
  private color(value: string): string {
    const color = value.trim().toLowerCase();
    if (isColor(color)) return color;
    this.notes.count('color');
    return '#000000';
  }

  /**
   * An opacity of the mark's own. Setting one opens a `push`, since nothing
   * but `pop` gives a mark the tool's own opacity back; a mark with none pops.
   */
  private setOpacity(target: number | undefined): void {
    const opacity = target === undefined || !Number.isFinite(target) ? undefined : Math.min(1, Math.max(0, target));
    if (opacity === this.paint.opacity) return;
    if (opacity === undefined) {
      this.closePush();
      return;
    }
    if (this.pushed === null) {
      this.add({ verb: 'push' });
      this.pushed = copyPaint(this.paint);
    }
    this.add({ verb: 'opacity', opacity });
    this.paint.opacity = opacity;
  }

  /** Closes an open `push`, which puts back the paint it saved. */
  private closePush(): void {
    if (this.pushed === null) return;
    this.add({ verb: 'pop' });
    this.paint = this.pushed;
    this.pushed = null;
  }

  private setTool(tool: ScriptTool): void {
    if (this.paint.tool === tool) return;
    this.add({ verb: 'tool', tool });
    this.paint.tool = tool;
  }

  private setColor(value: string): void {
    const color = this.color(value);
    if (this.paint.color === color) return;
    this.add({ verb: 'color', color });
    this.paint.color = color;
  }

  private setWidth(width: number): void {
    if (this.paint.width === width) return;
    this.add({ verb: 'width', width });
    this.paint.width = width;
  }

  private setFill(value: string | null): void {
    const fill = value === null ? null : this.color(value);
    if (this.paint.fill === fill) return;
    this.add({ verb: 'fill', fill });
    this.paint.fill = fill;
  }

  private setGradient(gradient: Gradient | null): void {
    const held = gradient ? heldGradient(gradient) : null;
    if (sameGradient(this.paint.gradient, held)) return;
    if (!gradient || !held) {
      this.add({ verb: 'gradient', type: 'none' });
    } else {
      const stops: StopArg[] = held.stops.map((stop) => ({ color: this.color(stop.color), offset: stop.offset }));
      if (held.type === 'radial') this.add({ verb: 'gradient', type: 'radial', stops });
      else this.add({ verb: 'gradient', type: 'linear', angle: gradient.angle ?? 0, stops });
    }
    this.paint.gradient = held;
  }

  private setStroke(on: boolean): void {
    if (this.paint.stroke === on) return;
    this.add({ verb: 'stroke', on });
    this.paint.stroke = on;
  }

  private setStyle(style: StrokeStyle): void {
    if (this.paint.style === style) return;
    this.add({ verb: 'style', style });
    this.paint.style = style;
  }

  private setProfile(profile: StrokeProfile): void {
    if (this.paint.profile === profile) return;
    this.add({ verb: 'profile', profile });
    this.paint.profile = profile;
  }

  private setNib(angle: number): void {
    if (turn(this.paint.nib) === turn(angle)) return;
    this.add({ verb: 'nib', angle });
    this.paint.nib = angle;
  }

  private setFont(family: string, size: number): void {
    const change: { family?: string; size?: number } = {};
    if (this.paint.family !== family) change.family = family;
    if (this.paint.size !== size) change.size = size;
    if (change.family === undefined && change.size === undefined) return;
    this.add({ verb: 'font', ...change });
    this.paint.family = family;
    this.paint.size = size;
  }

  /** `effect` lines for the mark, layer or group written next. */
  private effects(effects: readonly Effect[] | undefined): void {
    for (const effect of effects ?? []) this.add(effectInstruction(effect, (color) => this.color(color)));
  }
}

// ---- Small pieces -----------------------------------------------------------------

/** Two points the path builder reads as one, as `close` compares them. */
function samePlace(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function gap(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function finiteStep(step: PathStep): boolean {
  return Object.values(step).every((value) => typeof value !== 'number' || Number.isFinite(value));
}

/** An image's or a linked file's size, as `size <width> <height>`. */
function size(stroke: Stroke): { width: number; height: number } {
  const width = stroke.imageWidth !== undefined && stroke.imageWidth > 0 ? stroke.imageWidth : 100;
  const height = stroke.imageHeight !== undefined && stroke.imageHeight > 0 ? stroke.imageHeight : 100;
  return { width, height };
}

/** A layer's own properties as `layer` and `group` write them: only the ones it does not have by default. */
function layerProps(layer: { opacity: number; visible: boolean; locked: boolean }): Pick<LayerInstruction, 'opacity' | 'hidden' | 'locked'> {
  const props: Pick<LayerInstruction, 'opacity' | 'hidden' | 'locked'> = {};
  if (Number.isFinite(layer.opacity) && layer.opacity < 1) props.opacity = Math.max(0, layer.opacity);
  if (!layer.visible) props.hidden = true;
  if (layer.locked) props.locked = true;
  return props;
}

/** The `page` line for a size: a named paper when the size is one, turned when it lies the other way. */
function pageInstruction(width: number, height: number): PageInstruction {
  for (const [paper, spec] of Object.entries(PAPER_SIZES) as [PaperName, (typeof PAPER_SIZES)[PaperName]][]) {
    const w = toPx(spec.width, spec.units);
    const h = toPx(spec.height, spec.units);
    if (width === w && height === h) return { verb: 'page', paper };
    if (w !== h && width === h && height === w) return { verb: 'page', paper, orientation: w > h ? 'portrait' : 'landscape' };
  }
  return { verb: 'page', width, height };
}

/** An effect as the `effect` line that makes it, with no transform in force. */
function effectInstruction(effect: Effect, color: (value: string) => string): EffectInstruction {
  switch (effect.type) {
    case 'blur':
      return { verb: 'effect', type: 'blur', radius: effect.radius };
    case 'hue-rotate':
      return { verb: 'effect', type: 'hue-rotate', angle: effect.angle };
    case 'drop-shadow':
      return { verb: 'effect', type: 'drop-shadow', dx: effect.dx, dy: effect.dy, blur: effect.blur, color: color(effect.color) };
    default:
      return { verb: 'effect', type: effect.type, amount: effect.amount };
  }
}

// ---- Entry points ---------------------------------------------------------------------

/**
 * Writes one page as a script that draws it back: `napkin 1`, the page, then
 * its layers and marks. `layers` writes only part of the page; see
 * {@link WriteOptions}.
 */
export function sketchToInstructions(sketch: Sketch, options: WriteOptions = {}): WrittenScript {
  const writer = new ScriptWriter(options);
  writer.page(sketch, null);
  return {
    script: writer.script,
    notes: writer.notes.sentences(),
    stats: writer.stats(),
    ...(options.trace ? { firsts: writer.firsts } : {}),
  };
}

/** Writes a whole book, a page after a `newpage` for each page after the first. */
export function bookToInstructions(book: SketchBook, options: Omit<WriteOptions, 'layers'> = {}): WrittenScript {
  const writer = new ScriptWriter(options);
  let previous: Sketch | null = null;
  for (const sketch of book.sketches) {
    writer.page(sketch, previous);
    previous = sketch;
  }
  return { script: writer.script, notes: writer.notes.sentences(), stats: writer.stats() };
}

/**
 * A comment block for the top of a written script: each line of `header`,
 * then each note, as `#` lines a person reads and the parser skips. Empty when
 * there is nothing to say.
 */
export function scriptComments(written: WrittenScript, header: readonly string[] = []): string {
  const lines = [...header, ...written.notes];
  return lines.length > 0 ? `${lines.map((line) => `# ${line.replace(/\s*\n\s*/g, ' ')}`).join('\n')}\n` : '';
}
