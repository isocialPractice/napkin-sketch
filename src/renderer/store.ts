/**
 * Renderer-side application store.
 *
 * Holds the open sketch book, the active page, tool settings, selection state,
 * sharpen configuration, dirty/saved status, and a bounded undo/redo history of
 * strokes for the active page. Emits a change event so the UI re-renders.
 */

import { diffSnapshots, isEmptyDiff, sameData, type SnapshotDiff } from '../core/history-diff.js';
import { buildImportedLayers, type ImportedTreeNode } from '../core/imported-sketch.js';
import { basename } from '../core/paths.js';
import {
  createGroupLayer,
  createId,
  createLayer,
  createSketch,
  DEFAULT_NIB_ANGLE,
  descendantLayerIds,
  effectiveLayer,
  isClosedStroke,
  isImageStroke,
  isTextStroke,
  layerOf,
  type Layer,
  type Point,
  type Sketch,
  type SketchBook,
  type Stroke,
  type StrokeProfile,
  type Tool,
} from '../core/types.js';
import { DEFAULT_SHARPEN_OPTIONS, type SharpenOptions } from '../sharpen/sharpen.js';
import type { EraseResult } from '../core/erase.js';
import { CLIP_GROUP_NAME, makeClip, releaseClip, type ClipProblem } from '../core/clip.js';
import { isBlended, type BlendModeId } from '../core/blend.js';
import { effectsAfterTransform, sameEffects } from '../core/appearance.js';
import { bindGeometry } from '../core/geometry-effects.js';
import type { Effect } from '../core/effects.js';
import type { MarkEdit } from '../core/wipe.js';
import { paintPatch, swapPaint, type ColorTarget } from '../core/paint.js';
import { DEFAULT_PENCIL, type PencilChoice } from '../core/pencil.js';
import { mapSmudges } from '../core/smudge.js';
import { catmullRom, cubicBezierPoints, rotateAbout, rotationTrig } from '../sharpen/geometry.js';
import { mirrorStroke, type Mirror, type TransformBox } from '../core/transform.js';
import { mapTypesetAnchors, scaleTypeShape, scaleTypeset, textColorPatch, typeSpecOf, typesetIsShape, type TextConfig } from '../core/type/model.js';
import { adoptTextConfigs } from '../core/type/configs.js';
import { withMarkdownConfigs } from '../core/type/markdown-flow.js';

/** Applies a property patch to a stroke in place: a key set to `undefined` is taken away, not stored. */
/** A text mark's text and type: what {@link Store.setTypeset} writes. */
export const TYPE_FIELDS = ['text', 'typeset', 'fontSize', 'fontFamily', 'color', 'textBoxWidth'] as const;

function applyPatch(stroke: Stroke, patch: Partial<Stroke>): void {
  const record = stroke as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete record[key];
    else record[key] = value;
  }
}

/** Snapshot of the current tool configuration. */
export interface ToolState {
  tool: Tool;
  /** The ink: every new mark's outline. Always a color - every drawing tool draws with it. */
  color: string;
  /**
   * The fill new closed shapes take - Rectangle, Ellipse, a closed Vector
   * Path - and the Paint Bucket and Fill Color paint with, or null for none,
   * as it is until one is picked: a sketch's shapes are outlines.
   */
  fill: string | null;
  /** Which of the ink and the fill the colors paint: `X` puts the other one in front. */
  colorTarget: ColorTarget;
  width: number;
  /**
   * Explicit stroke opacity (0-1) applied to new strokes, or null to use each
   * tool's default. Set via the Quick Opacity feature.
   */
  opacity: number | null;
  /** When true, finished strokes are auto-sharpened on pen-up. */
  liveSharpen: boolean;
  /** Font size used by the text tool. */
  fontSize: number;
  /** Mirror axes for symmetry ("surprise") mode; 1 disables it. */
  symmetry: number;
  /** Copic broad-nib rotation in degrees (0 = horizontal, clockwise). */
  nibAngle: number;
  /** The pencil the Pencil draws with, chosen from its kit (core/pencil.ts). */
  pencil: PencilChoice;
  /**
   * The profile new pen and marker strokes are drawn with. Tool state, like
   * the width: it lasts while the app runs and is not saved as a setting.
   */
  profile: StrokeProfile;
  /** Tunable auto-sharpen settings. */
  sharpen: SharpenOptions;
}

const HISTORY_LIMIT = 100;

/** Display-name stems for the auto-created per-element layers. */
const TOOL_LAYER_NAMES: Partial<Record<Tool, string>> = {
  // The app calls the `pen` the Brush; a file's older "Pen N" rows keep their names.
  pen: 'Brush',
  marker: 'Marker',
  copic: 'Copic',
  pencil: 'Pencil',
  text: 'Text',
  image: 'Image',
};

/**
 * One copied layer: its own marks and whatever nested inside it. What the
 * clipboard holds when a group was copied, so the paste can rebuild the tree
 * instead of flattening it into a single layer.
 */
export interface LayerTreeNode {
  name: string;
  /** True for a group row, which holds no marks of its own. */
  group: boolean;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /**
   * Marks sitting directly on this layer, each with the paint order it had on
   * the page it came from. Rebuilding sorts by it, so a graphic whose parts
   * overlap comes back stacked the way it was drawn.
   */
  marks: { stroke: Stroke; order: number }[];
  children: LayerTreeNode[];
}

/** One layer parsed from an imported file; may nest (SVG group layers). See `core/imported-sketch.ts`. */
export type ImportedLayerNode = ImportedTreeNode;

type Listener = () => void;

/**
 * One undo/redo snapshot of the active page (strokes + layer stack), and the
 * book's Text Configurations, which a step on the page can change. A step
 * that reaches past the page - a configuration changed under text on every
 * page - holds the other pages' marks too.
 */
interface PageSnapshot {
  strokes: Stroke[];
  layers: Layer[];
  activeLayerId: string;
  textConfigs: TextConfig[] | undefined;
  /** The other pages' marks as they were, by page id: a step that reached every page. */
  pages?: Array<{ id: string; strokes: Stroke[] }>;
}

/** An edit shown live, and everything needed to put the page back if it goes. */
interface Transaction {
  before: PageSnapshot;
  dirty: boolean;
  selectedIds: string[];
  selectedLayerIds: string[];
  onSettled?: () => void;
  /** The command running when it began, and when that was: its step is recorded under them. */
  command: string | null;
  at: string;
  /** Something was changed since it began: there is a step to undo. */
  touched?: boolean;
}

/**
 * One step of the history, as a history listener hears it: what kind of step
 * it was, the page it happened on, when it began, the command that was
 * running then, and what it changed.
 */
export interface HistoryStep {
  readonly kind: 'edit' | 'undo' | 'redo';
  /** The page it happened on, by index. */
  readonly page: number;
  /** When it began, as an ISO time. */
  readonly at: string;
  /**
   * The command running when it began: a menu id, `tool:<tool>` for a press
   * on the canvas, or null when nothing named one (see {@link Store.beginCommand}).
   */
  readonly command: string | null;
  readonly diff: SnapshotDiff;
}

/** What a history listener hears: a step, or that the document was replaced and its history with it. */
export type HistoryEvent = { readonly type: 'step'; readonly step: HistoryStep } | { readonly type: 'reset' };

/** A step begun and not yet closed: the page before it, and what it is recorded under. */
interface PendingStep {
  kind: HistoryStep['kind'];
  before: PageSnapshot;
  page: number;
  at: string;
  command: string | null;
}

export class Store {
  book: SketchBook;
  filePath: string | null = null;
  activeIndex = 0;
  dirty = false;

  /** Id of the layer new strokes are drawn on. */
  activeLayerId = '';

  /** Ids of the layers highlighted in the layers panel (Shift multi-select). */
  selectedLayerIds = new Set<string>();
  /**
   * Whether a transform takes a mark's line weight and effects with it, as a
   * vector editor's Scale Strokes and Effects: a scale scales its width and
   * its effects' lengths, a turn turns a shadow's offset and a bevel's light,
   * and a mirror flips them. Set from the setting of that name.
   */
  scaleStrokesAndEffects = true;

  /** Ids of currently selected strokes (Select tool). */
  selectedIds = new Set<string>();

  tool: ToolState = {
    tool: 'pen',
    color: '#1f2328',
    fill: null,
    colorTarget: 'stroke',
    width: 3,
    opacity: null,
    // Per request: Live Sharpen defaults OFF.
    liveSharpen: false,
    fontSize: 24,
    symmetry: 1,
    nibAngle: DEFAULT_NIB_ANGLE,
    pencil: { ...DEFAULT_PENCIL },
    profile: 'uniform',
    sharpen: { ...DEFAULT_SHARPEN_OPTIONS },
  };

  // Per-page history of page snapshots (deep-enough copies for undo/redo).
  private undoStack: PageSnapshot[] = [];
  private redoStack: PageSnapshot[] = [];
  private listeners = new Set<Listener>();

  // The edit being shown live, if one is open (see beginTransaction).
  private transaction: Transaction | null = null;

  // Told before the page in view changes (see onPageLeave).
  private pageLeaveListeners = new Set<() => void>();

  // Track History's hook (see onHistory). With no listener, none of it runs.
  private historyListeners = new Set<(event: HistoryEvent) => void>();
  private pendingStep: PendingStep | null = null;
  // The commands running now, innermost last (see beginCommand).
  private commandStack: { token: number; label: string }[] = [];
  private nextCommandToken = 1;

  constructor(book: SketchBook, filePath: string | null = null) {
    this.book = book;
    this.filePath = filePath;
    this.activeLayerId = this.sketch.layers[0]?.id ?? '';
  }

  /** Subscribes to store changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Hears the page in view about to change - another page turned to, one
   * added or removed, a new book - while it is still the old one: for an
   * edit held open on it, such as text being typed, to finish there.
   * Returns the function that stops listening.
   */
  onPageLeave(listener: () => void): () => void {
    this.pageLeaveListeners.add(listener);
    return () => this.pageLeaveListeners.delete(listener);
  }

  private leavePage(): void {
    for (const listener of this.pageLeaveListeners) listener();
  }

  private emit(): void {
    // A layer's Warp bends what it holds over the box of all of it: laid on
    // again at every change, so the marks' bounds and hits follow it.
    bindGeometry(this.sketch);
    for (const l of this.listeners) l();
  }

  /** The currently active sketch (page). */
  get sketch() {
    return this.book.sketches[this.activeIndex];
  }

  /** The layer new strokes land on (falls back to the bottom layer). */
  get activeLayer(): Layer {
    return this.sketch.layers.find((l) => l.id === this.activeLayerId) ?? this.sketch.layers[0];
  }

  /** True when the active layer accepts new marks. */
  get canDraw(): boolean {
    const layer = this.activeLayer;
    if (layer.group) return false;
    const effective = effectiveLayer(this.sketch, layer);
    return effective.visible && !effective.locked;
  }

  /** Human-readable document name derived from the file path or book name. */
  get displayName(): string {
    if (this.filePath) return basename(this.filePath).replace(/\.skbk$/i, '');
    return this.book.name || 'untitled';
  }

  /** Replaces the entire book (e.g. after opening a file) and resets history. */
  setBook(book: SketchBook, filePath: string | null): void {
    this.leavePage();
    this.settleTransaction();
    this.flushHistoryStep();
    this.book = book;
    this.filePath = filePath;
    if (filePath) this.book.name = basename(filePath).replace(/\.skbk$/i, '');
    this.activeIndex = 0;
    this.activeLayerId = this.sketch.layers[0]?.id ?? '';
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.dirty = false;
    // A new document is a new session: its history starts empty.
    for (const listener of this.historyListeners) listener({ type: 'reset' });
    this.emit();
  }

  /**
   * Pushes the current page state onto the undo stack before a mutation;
   * with `book`, every other page's marks too, for a change that reaches them.
   */
  pushHistory(book = false): void {
    // An edit that keeps history is the end of any edit being previewed: the
    // preview is what is on the page, so it is kept, and this builds on it.
    this.settleTransaction();
    this.flushHistoryStep();
    const before = this.snapshot(book);
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.openHistoryStep('edit', before);
  }

  // ---- Track History ---------------------------------------------------------

  /**
   * Listens to the history: every step the undo stack gains - an edit, an
   * undo, a redo - with what it changed on the page, and a `reset` when a new
   * document replaces the book. Returns the function that stops listening.
   *
   * A step is heard when it is closed, and it closes at the next history
   * boundary: the next edit that keeps history, an undo or redo, a
   * transaction beginning, a page change, a new book - or
   * {@link flushHistoryStep}. So a drag that saved the page at its first
   * move and changed it on every move after is one step, holding where the
   * drag ended, just as it is one undo. A step that changed nothing is not
   * heard. With no listener the store keeps no steps at all.
   */
  onHistory(listener: (event: HistoryEvent) => void): () => void {
    this.historyListeners.add(listener);
    return () => {
      this.historyListeners.delete(listener);
      if (this.historyListeners.size === 0) this.pendingStep = null;
    };
  }

  /**
   * Names what the history steps begun from now on are part of, until the
   * returned function is called: a menu command by its id, a press on the
   * canvas as `tool:<tool>`. Names nest, the innermost wins, and ending one
   * out of order ends that one alone - which is what an async command does
   * when it finishes after a gesture began.
   */
  beginCommand(label: string): () => void {
    const token = this.nextCommandToken++;
    this.commandStack.push({ token, label });
    return () => {
      const index = this.commandStack.findIndex((entry) => entry.token === token);
      if (index >= 0) this.commandStack.splice(index, 1);
    };
  }

  /** The command running now, as {@link beginCommand} named it, or null. */
  get currentCommand(): string | null {
    return this.commandStack.length > 0 ? this.commandStack[this.commandStack.length - 1].label : null;
  }

  /**
   * Closes the step in progress now rather than at the next boundary, and
   * tells the listeners what it changed: for reading the history up to this
   * moment, and at the end of a gesture or a command, when nothing more
   * belongs to its step.
   */
  flushHistoryStep(): void {
    const pending = this.pendingStep;
    if (!pending) return;
    this.pendingStep = null;
    if (this.historyListeners.size === 0 || pending.page !== this.activeIndex) return;
    const diff = diffSnapshots(pending.before, this.sketch);
    if (isEmptyDiff(diff)) return;
    const step: HistoryStep = { kind: pending.kind, page: pending.page, at: pending.at, command: pending.command, diff };
    for (const listener of this.historyListeners) listener({ type: 'step', step });
  }

  /** Begins a step from the page as it was, when anyone is listening. */
  private openHistoryStep(
    kind: HistoryStep['kind'],
    before: PageSnapshot,
    named: { command: string | null; at: string } = { command: this.currentCommand, at: new Date().toISOString() },
  ): void {
    if (this.historyListeners.size === 0) return;
    this.pendingStep = { kind, before, page: this.activeIndex, ...named };
  }

  // ---- Transactions ---------------------------------------------------------

  /**
   * Opens an edit that is shown live and then either kept as one undo step
   * or thrown away - a palette's live preview, a warp in progress. Edits made
   * inside pass `history: false`. {@link commitTransaction} turns the page as
   * it was here into the undo step; {@link rollbackTransaction} puts it back,
   * selection and saved state included, so a cancelled preview leaves no trace.
   *
   * Reversible deltas - the way Move and Rotate preview - cannot express an
   * edit that adds strokes, like a mirrored copy, or one that rewrites every
   * anchor, like a warp. A snapshot can.
   *
   * One runs at a time, and anything that would otherwise build on top of it
   * settles it first: another edit that keeps history, an undo or redo, a new
   * book or a page change all commit the open transaction - it is what the
   * page shows - and then call `onSettled`, so its owner can close whatever
   * was previewing. Beginning a second transaction settles the first the same
   * way. The owner's own commit or rollback does not call back.
   */
  beginTransaction(onSettled?: () => void, book = false): void {
    this.settleTransaction();
    // The step before is over: what the transaction previews is not part of it.
    this.flushHistoryStep();
    this.transaction = {
      before: this.snapshot(book),
      dirty: this.dirty,
      selectedIds: [...this.selectedIds],
      selectedLayerIds: [...this.selectedLayerIds],
      onSettled,
      command: this.currentCommand,
      at: new Date().toISOString(),
    };
  }

  /** True while a transaction is open. */
  get inTransaction(): boolean {
    return this.transaction !== null;
  }

  /**
   * A mark as the open transaction found it, or undefined when there is no
   * transaction or the mark was not there: for an edit that weighs what it
   * did against what was - Liquify's refit, which leaves a path it never
   * split with the anchors it was drawn with.
   */
  strokeBeforeTransaction(id: string): Stroke | undefined {
    return this.transaction?.before.strokes.find((s) => s.id === id);
  }

  /**
   * Keeps what the open transaction did, as a single undo step. One that left
   * the page exactly as it found it leaves no step behind - an undo press that
   * changes nothing is a defect this store has fixed once already - and puts
   * the saved state back the way it was.
   */
  commitTransaction(): void {
    const open = this.transaction;
    if (!open) return;
    this.transaction = null;
    if (this.pageMatches(open.before)) {
      this.dirty = open.dirty;
      this.emit();
      return;
    }
    this.undoStack.push(open.before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.flushHistoryStep();
    this.openHistoryStep('edit', open.before, { command: open.command, at: open.at });
    this.touch();
  }

  /**
   * Throws the open transaction away: the page, the selection and the saved
   * state go back to exactly what they were when it began.
   */
  rollbackTransaction(): void {
    const open = this.transaction;
    if (!open) return;
    this.transaction = null;
    this.restore(open.before);
    this.selectedIds = new Set(open.selectedIds);
    this.selectedLayerIds = new Set(open.selectedLayerIds);
    this.dirty = open.dirty;
    this.emit();
  }

  /** Commits an open transaction on its owner's behalf, and tells the owner. */
  private settleTransaction(): void {
    const open = this.transaction;
    if (!open) return;
    this.commitTransaction();
    open.onSettled?.();
  }

  /** True when the active page - and the book's configurations, and any other pages the snapshot holds - are exactly what it holds. */
  private pageMatches(snapshot: PageSnapshot): boolean {
    return (
      snapshot.activeLayerId === this.activeLayerId &&
      sameData(snapshot.layers, this.sketch.layers) &&
      sameData(snapshot.strokes, this.sketch.strokes) &&
      sameData(snapshot.textConfigs ?? [], this.book.textConfigs ?? []) &&
      (snapshot.pages ?? []).every((page) => {
        const sketch = this.book.sketches.find((s) => s.id === page.id);
        return !sketch || sketch.strokes === page.strokes || sameData(page.strokes, sketch.strokes);
      })
    );
  }

  /**
   * The page as it is, with the book's configurations; with `book`, the other
   * pages' marks too. Those are kept as they are, not copied: a change that
   * reaches another page puts new marks there rather than changing these, and
   * nothing else can change a page while another is in view.
   */
  private snapshot(book = false): PageSnapshot {
    return {
      strokes: this.cloneStrokes(this.sketch.strokes),
      layers: this.sketch.layers.map((l) => ({ ...l })),
      activeLayerId: this.activeLayerId,
      textConfigs: this.book.textConfigs ? [...this.book.textConfigs] : undefined,
      ...(book ? { pages: this.book.sketches.filter((s) => s !== this.sketch).map((s) => ({ id: s.id, strokes: [...s.strokes] })) } : {}),
    };
  }

  private restore(snapshot: PageSnapshot): void {
    this.sketch.strokes = snapshot.strokes;
    this.sketch.layers = snapshot.layers;
    this.activeLayerId = snapshot.activeLayerId;
    if (snapshot.textConfigs) this.book.textConfigs = [...snapshot.textConfigs];
    else delete this.book.textConfigs;
    for (const page of snapshot.pages ?? []) {
      const sketch = this.book.sketches.find((s) => s.id === page.id);
      if (sketch) sketch.strokes = page.strokes;
    }
  }

  /**
   * Copies strokes deeply enough that a later edit cannot reach back into a
   * snapshot. `move` rides along on each anchor: without it a compound
   * shape's contours export as one stitched outline after an undo, although
   * the canvas - which draws the sampled points - still looks right. The
   * gradient is copied rather than shared for the same reason the points are.
   */
  private cloneStrokes(strokes: Stroke[]): Stroke[] {
    return strokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ ...p })),
      ...(s.vector
        ? {
            vector: {
              anchors: s.vector.anchors.map((a) => ({
                p: { ...a.p },
                ...(a.hIn ? { hIn: { ...a.hIn } } : {}),
                ...(a.hOut ? { hOut: { ...a.hOut } } : {}),
                ...(a.move ? { move: true as const } : {}),
                ...(a.pressure !== undefined ? { pressure: a.pressure } : {}),
              })),
              ...(s.vector.closed ? { closed: true as const } : {}),
              ...(s.vector.fitted ? { fitted: true as const } : {}),
            },
          }
        : {}),
      ...(s.gradient
        ? { gradient: { ...s.gradient, stops: s.gradient.stops.map((stop) => ({ ...stop })) } }
        : {}),
    }));
  }

  /**
   * Commits a finished stroke to the active page. Every new non-eraser
   * element gets its own layer (an empty active layer is reused), mirroring
   * per-object layer rows in vector editors; eraser strokes stay on the
   * active layer so they keep cutting its content.
   */
  addStroke(stroke: Stroke): void {
    this.pushHistory();
    stroke.layer =
      stroke.tool === 'eraser' ? this.activeLayer.id : this.elementLayerFor(stroke.tool).id;
    this.sketch.strokes.push(stroke);
    this.touch();
  }

  /** Commits several strokes as a single history step (one shared new layer). */
  addStrokes(strokes: Stroke[]): void {
    if (strokes.length === 0) return;
    this.pushHistory();
    const target =
      strokes[0].tool === 'eraser' ? this.activeLayer : this.elementLayerFor(strokes[0].tool);
    for (const stroke of strokes) stroke.layer = target.id;
    this.adoptConfigs(strokes);
    this.sketch.strokes.push(...strokes);
    this.touch();
  }

  /**
   * The layer a new element lands on: reuses the active layer while it is an
   * empty non-group layer, otherwise creates a sibling right above it (inside
   * the same group, if any) named after the tool.
   */
  private elementLayerFor(tool: Tool): Layer {
    const active = this.activeLayer;
    if (active && !active.group && !this.sketch.strokes.some((s) => layerOf(this.sketch, s).id === active.id)) {
      return active;
    }
    const base = TOOL_LAYER_NAMES[tool] ?? 'Layer';
    const n = this.sketch.layers.filter((l) => l.name.startsWith(base)).length + 1;
    const layer = createLayer(`${base} ${n}`);
    layer.parent = active?.parent;
    const index = this.sketch.layers.findIndex((l) => l.id === active?.id);
    this.sketch.layers.splice(index + 1, 0, layer);
    this.activeLayerId = layer.id;
    return layer;
  }

  /**
   * Adds a new empty layer inside a group (topmost within it) and makes it
   * active. Used when drawing starts while a group row is selected: the
   * group itself holds no marks, so the stroke needs a real layer.
   */
  addLayerInGroup(groupId: string): Layer {
    this.pushHistory();
    const layer = createLayer(`Layer ${this.sketch.layers.length + 1}`);
    layer.parent = groupId;
    // Children sit before their group header in the stack; inserting at the
    // header's index places the new layer topmost inside the group.
    const index = this.sketch.layers.findIndex((l) => l.id === groupId);
    this.sketch.layers.splice(Math.max(0, index), 0, layer);
    this.activeLayerId = layer.id;
    this.touch();
    return layer;
  }

  /** Replaces a stroke (used by live-sharpen) without adding a new history entry. */
  replaceStroke(id: string, next: Stroke): void {
    const idx = this.sketch.strokes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this.sketch.strokes[idx] = next;
    this.touch();
  }

  /**
   * Gives a text mark the text and type of `next` - its text, its typeset and
   * the base the typeset is kept against - with no history of its own: the
   * type editor writes every keystroke this way inside the typing
   * transaction it opens, so a burst of typing is one undo step. A field
   * `next` leaves out is taken away.
   */
  setTypeset(id: string, next: Pick<Stroke, (typeof TYPE_FIELDS)[number]>): void {
    this.setTypesets([{ id, next }], false);
  }

  /**
   * Gives several text marks their text and type at once, as
   * {@link setTypeset} gives one: the Type panel's change to the selected
   * texts, one undo step for all of them - or with `history` false part of
   * the step that is open, as a drag on a field's name previews. Returns how
   * many marks it reached.
   */
  setTypesets(entries: ReadonlyArray<{ id: string; next: Pick<Stroke, (typeof TYPE_FIELDS)[number]> }>, history = true): number {
    const reached = entries.flatMap(({ id, next }) => {
      const stroke = this.sketch.strokes.find((s) => s.id === id);
      return stroke ? [{ stroke, next }] : [];
    });
    if (reached.length === 0) return 0;
    if (history) this.pushHistory();
    for (const { stroke, next } of reached) {
      const patch: Partial<Stroke> = {};
      for (const key of TYPE_FIELDS) (patch as Record<string, unknown>)[key] = next[key];
      applyPatch(stroke, patch);
    }
    // A text pasted from another book brings the configurations it follows.
    this.adoptConfigs(reached.map(({ stroke }) => stroke));
    this.touch();
    return reached.length;
  }

  // ---- Text Configurations (core/type/configs.ts) ---------------------------

  /** The book's Text Configurations, in the order the Type panel lists them. */
  get textConfigs(): readonly TextConfig[] {
    return this.book.textConfigs ?? [];
  }

  /**
   * Sets the book's Text Configurations, and puts the text on every page
   * through `restyle` - a configuration changed, renamed or deleted - as one
   * undo step that reaches every page; or with `history` false, part of the
   * step open, such as a preview's. A text `restyle` gives back as it was is
   * left alone, and a page none changed keeps its marks.
   */
  editTextConfigs(configs: readonly TextConfig[], restyle: ((stroke: Stroke) => Stroke) | null, history = true): void {
    if (history) this.pushHistory(true);
    if (configs.length > 0) this.book.textConfigs = [...configs];
    else delete this.book.textConfigs;
    if (restyle) {
      for (const sketch of this.book.sketches) {
        let changed = false;
        const next = sketch.strokes.map((stroke) => {
          if (!isTextStroke(stroke)) return stroke;
          const made = restyle(stroke);
          if (made !== stroke) changed = true;
          return made;
        });
        // New marks rather than changed ones, so a snapshot of the page as it was still holds it.
        if (changed) sketch.strokes = next;
      }
    }
    this.touch();
  }

  /**
   * Marks from elsewhere - pasted, imported - with the Text Configurations
   * they carry brought into the book by name: one the book has, they follow
   * as the book defines it; one it has not joins its list. Changes the marks
   * in place, inside the step that adds them.
   */
  private adoptConfigs(strokes: readonly Stroke[]): void {
    // A Markdown Flow text carries the Markdown configurations, as the book defines them when it has them.
    for (const stroke of strokes) {
      const carrying = withMarkdownConfigs(stroke, this.textConfigs);
      if (carrying !== stroke) stroke.typeset = carrying.typeset;
    }
    if (!strokes.some((stroke) => stroke.typeset?.configs)) return;
    const adopted = adoptTextConfigs(this.textConfigs, strokes, () => createId('tc'));
    strokes.forEach((stroke, i) => {
      if (adopted.strokes[i] !== stroke) stroke.typeset = adopted.strokes[i].typeset;
    });
    if (adopted.list.length !== this.textConfigs.length) this.book.textConfigs = adopted.list;
  }

  /**
   * Adds a new mark with no history of its own, on a layer of its own as
   * {@link addStroke} gives it: a new text's first keystroke, inside the
   * typing transaction, so the mark and what was typed are one undo step.
   */
  addStrokeLive(stroke: Stroke): void {
    stroke.layer = this.elementLayerFor(stroke.tool).id;
    this.adoptConfigs([stroke]);
    this.sketch.strokes.push(stroke);
    this.touch();
  }

  /**
   * Puts a mark in another's place - on its layer, where it stood among the
   * marks - and takes that one off the page: a path the Text tool turns into
   * type. Without `history` it joins the step that is open. False when the
   * mark to replace is not on the page.
   */
  replaceMark(oldId: string, next: Stroke, history = true): boolean {
    const index = this.sketch.strokes.findIndex((s) => s.id === oldId);
    if (index < 0) return false;
    if (history) this.pushHistory();
    next.layer = this.sketch.strokes[index].layer;
    this.adoptConfigs([next]);
    this.sketch.strokes[index] = next;
    this.selectedIds.delete(oldId);
    this.touch();
    return true;
  }

  /**
   * Removes one mark, and the layer that leaves empty, as
   * {@link deleteSelected} does: a text left with no text when its editing
   * ends. Without `history` it joins the step that is open.
   */
  removeMark(id: string, history = true): void {
    const stroke = this.sketch.strokes.find((s) => s.id === id);
    if (!stroke) return;
    if (history) this.pushHistory();
    const affected = new Set([layerOf(this.sketch, stroke).id]);
    this.sketch.strokes = this.sketch.strokes.filter((s) => s.id !== id);
    this.pruneEmptyLayers(affected);
    this.selectedIds.delete(id);
    this.touch();
  }

  /** Replaces every stroke on the active page (used by "sharpen all"). */
  replaceAllStrokes(strokes: Stroke[]): void {
    this.pushHistory();
    this.sketch.strokes = strokes;
    this.touch();
  }

  /** Clears the active page (strokes and the per-element layer stack). */
  clear(): void {
    if (this.sketch.strokes.length === 0) return;
    this.pushHistory();
    this.sketch.strokes = [];
    this.sketch.layers = [createLayer()];
    this.activeLayerId = this.sketch.layers[0].id;
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.touch();
  }

  // ---- Selection -----------------------------------------------------------

  /**
   * Sets the current selection set. Unless `syncLayers` is false, the layers
   * panel highlight follows the selection (the selected strokes' layers are
   * highlighted and the first becomes the active layer).
   */
  setSelection(ids: Iterable<string>, syncLayers = true): void {
    this.selectedIds = new Set(ids);
    if (syncLayers) this.syncLayerHighlight();
    this.emit();
  }

  /** Mirrors the canvas selection into the layers-panel highlight. */
  private syncLayerHighlight(): void {
    const layerIds = new Set<string>();
    for (const stroke of this.sketch.strokes) {
      if (this.selectedIds.has(stroke.id)) layerIds.add(layerOf(this.sketch, stroke).id);
    }
    this.selectedLayerIds = layerIds;
    const first = layerIds.values().next().value;
    if (first) this.activeLayerId = first;
  }

  /**
   * Selects a layer row in the panel and highlights the strokes on every
   * selected layer, groups including their descendants.
   *
   * `additive` is Ctrl/Cmd-click: it toggles this one row's membership and
   * leaves the rest of the selection alone. Shift-click is a range and goes
   * through {@link selectLayerRange}.
   */
  selectLayer(id: string, additive = false): void {
    const layer = this.sketch.layers.find((l) => l.id === id);
    if (!layer) return;
    if (additive) {
      if (this.selectedLayerIds.has(id)) this.selectedLayerIds.delete(id);
      else this.selectedLayerIds.add(id);
    } else {
      this.selectedLayerIds = new Set([id]);
    }
    if (this.selectedLayerIds.has(id)) {
      this.activeLayerId = id;
    } else if (!this.selectedLayerIds.has(this.activeLayerId)) {
      const fallback = this.selectedLayerIds.values().next().value;
      if (fallback) this.activeLayerId = fallback;
    }
    const layerIds = new Set<string>();
    for (const lid of this.selectedLayerIds) {
      layerIds.add(lid);
      for (const d of descendantLayerIds(this.sketch, lid)) layerIds.add(d);
    }
    this.selectedIds = new Set(
      this.sketch.strokes.filter((s) => layerIds.has(layerOf(this.sketch, s).id)).map((s) => s.id),
    );
    this.emit();
  }

  /**
   * Selects every layer between the active (anchor) layer and `id`, inclusive
   * - Shift-click - and highlights their elements on the canvas.
   *
   * `order` is the rows as the panel is showing them, and it is what makes
   * the range mean what it looks like it means. The layer array is the paint
   * order with every group's children inlined, so a range taken on it sweeps
   * up rows folded away inside a collapsed group: six visible rows, and a
   * selection of forty that cannot be seen or reasoned about. Passed the
   * visible order, the range covers exactly the rows between the two that
   * were clicked. Omitted, it falls back to the stack, which is right when
   * nothing is collapsed and is the only thing available off-screen.
   */
  selectLayerRange(id: string, order?: readonly string[]): void {
    const rows = order ?? this.sketch.layers.map((l) => l.id);
    const anchor = rows.indexOf(this.activeLayerId);
    const target = rows.indexOf(id);
    if (target === -1) return;
    if (anchor === -1) {
      this.selectLayer(id);
      return;
    }
    const lo = Math.min(anchor, target);
    const hi = Math.max(anchor, target);
    this.selectedLayerIds = new Set(rows.slice(lo, hi + 1));
    this.activeLayerId = id;
    const layerIds = new Set<string>();
    for (const lid of this.selectedLayerIds) {
      layerIds.add(lid);
      for (const d of descendantLayerIds(this.sketch, lid)) layerIds.add(d);
    }
    this.selectedIds = new Set(
      this.sketch.strokes.filter((s) => layerIds.has(layerOf(this.sketch, s).id)).map((s) => s.id),
    );
    this.emit();
  }

  /**
   * How many marks are selected. An older file's eraser marks ride along
   * with their layer's selection, so that a move takes their cuts with it,
   * but they are no element of their own: they are not counted.
   */
  get selectedMarkCount(): number {
    let count = 0;
    for (const stroke of this.sketch.strokes) {
      if (stroke.tool !== 'eraser' && this.selectedIds.has(stroke.id)) count++;
    }
    return count;
  }

  /** Clears the current selection (strokes and layer highlight). */
  clearSelection(): void {
    if (this.selectedIds.size === 0 && this.selectedLayerIds.size === 0) return;
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.emit();
  }

  /** Shifts a stroke's Bézier anchor structure with its points, and the Smear's passes over it. */
  private shiftVector(stroke: Stroke, dx: number, dy: number): void {
    if (stroke.smudges) stroke.smudges = mapSmudges(stroke.smudges, (p) => ({ x: p.x + dx, y: p.y + dy }));
    if (!stroke.vector) return;
    for (const anchor of stroke.vector.anchors) {
      anchor.p.x += dx;
      anchor.p.y += dy;
      if (anchor.hIn) {
        anchor.hIn.x += dx;
        anchor.hIn.y += dy;
      }
      if (anchor.hOut) {
        anchor.hOut.x += dx;
        anchor.hOut.y += dy;
      }
    }
  }

  /** Moves all selected strokes by (dx, dy) without pushing history. */
  nudgeSelected(dx: number, dy: number): void {
    if (this.selectedIds.size === 0) return;
    for (const stroke of this.sketch.strokes) {
      if (!this.selectedIds.has(stroke.id)) continue;
      for (const p of stroke.points) {
        p.x += dx;
        p.y += dy;
      }
      this.shiftVector(stroke, dx, dy);
    }
    this.touch();
  }

  /** Moves the given anchor points of a stroke by (dx, dy) (no history). */
  nudgeStrokePoints(strokeId: string, indices: number[], dx: number, dy: number): void {
    const stroke = this.sketch.strokes.find((s) => s.id === strokeId);
    if (!stroke) return;
    for (const index of indices) {
      const point = stroke.points[index];
      if (!point) continue;
      point.x += dx;
      point.y += dy;
    }
    this.touch();
  }

  /**
   * Replaces a stroke's sampled points and editable vector structure — the
   * Vector Path edit and Sharpen Selection flows, which regenerate geometry
   * wholesale (no history; callers push it per discrete operation). Passing
   * no `vector` clears the structure, since points reshaped outside the
   * anchor model no longer match it.
   */
  setStrokeGeometry(strokeId: string, points: Point[], vector?: Stroke['vector']): void {
    const stroke = this.sketch.strokes.find((s) => s.id === strokeId);
    if (!stroke || points.length === 0) return;
    stroke.points = points;
    if (vector) stroke.vector = vector;
    else delete stroke.vector;
    this.touch();
  }

  /**
   * Sets the geometry of several strokes at once, with one change event and
   * no history of its own: a frame of a live gesture - a Mesh Warp drag -
   * inside a transaction that keeps the whole gesture as one undo step. A
   * stroke given no `vector` loses the one it had, as {@link setStrokeGeometry}
   * does, and a `nibAngle` turns a Copic nib.
   */
  setStrokesGeometry(
    updates: Array<{ id: string; points: Point[]; vector?: Stroke['vector']; nibAngle?: number; smudges?: Stroke['smudges'] }>,
  ): void {
    const byId = new Map(updates.map((u) => [u.id, u]));
    let changed = false;
    for (const stroke of this.sketch.strokes) {
      const update = byId.get(stroke.id);
      if (!update || update.points.length === 0) continue;
      stroke.points = update.points;
      if (update.vector) stroke.vector = update.vector;
      else delete stroke.vector;
      if (update.nibAngle !== undefined) stroke.nibAngle = update.nibAngle;
      if (update.smudges) stroke.smudges = update.smudges;
      changed = true;
    }
    if (changed) this.touch();
  }

  /**
   * Sets absolute positions for specific points of a stroke — the Direct
   * Select handle drag, which recomputes every affected point from the
   * geometry captured at drag start (no history; pushed at drag start).
   */
  setStrokePointPositions(
    strokeId: string,
    updates: Array<{ index: number; x: number; y: number }>,
  ): void {
    const stroke = this.sketch.strokes.find((s) => s.id === strokeId);
    if (!stroke) return;
    for (const { index, x, y } of updates) {
      const point = stroke.points[index];
      if (!point) continue;
      point.x = x;
      point.y = y;
    }
    this.touch();
  }

  /** Moves every point of a stroke by (dx, dy) — Direct Select path move (no history). */
  nudgeStroke(strokeId: string, dx: number, dy: number): void {
    const stroke = this.sketch.strokes.find((s) => s.id === strokeId);
    if (!stroke) return;
    for (const point of stroke.points) {
      point.x += dx;
      point.y += dy;
    }
    this.shiftVector(stroke, dx, dy);
    this.touch();
  }

  /**
   * Deletes the selected strokes (with history). Layers left empty by the
   * delete are removed with their elements, as are groups this empties.
   */
  deleteSelected(): void {
    if (this.selectedIds.size === 0) return;
    this.pushHistory();
    const affected = new Set<string>();
    for (const stroke of this.sketch.strokes) {
      if (this.selectedIds.has(stroke.id)) affected.add(layerOf(this.sketch, stroke).id);
    }
    this.sketch.strokes = this.sketch.strokes.filter((s) => !this.selectedIds.has(s.id));
    this.pruneEmptyLayers(affected);
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.touch();
  }

  /**
   * Applies an erase (`core/erase.ts`) as one history step: each changed
   * mark replaced where it was, its id and layer kept, so Track History
   * records a change; each mark with nothing left removed, and the layers
   * that leaves empty pruned. `legacy` are eraser marks laid on the marks
   * the geometry could not cut (`raster`), each on its mark's layer just
   * above it, so the canvas still shows the cut. The selection stays on
   * whatever is left of it.
   */
  eraseMarks(result: Pick<EraseResult, 'changed' | 'removed'>, legacy: Array<{ above: string; eraser: Stroke }> = []): void {
    // REUSE: the Eraser's commit is the wipes' (applyMarkEdit) with the
    // selection kept for the next cut, and the raster fallback's eraser
    // marks put in beside the marks they cut.
    this.applyMarkEdit({ changed: result.changed, removed: result.removed, added: [] }, { select: 'keep', beside: legacy });
  }

  /**
   * Commits an edit of the page's marks as one undo step - what a wipe
   * (core/wipe.ts) or the Eraser leaves. Changed marks are replaced in place,
   * keeping their ids and layers; removed ones go. Each added mark goes on a
   * new layer of its own right above the layer it names, in the same group,
   * with that layer's opacity and effects, named for its tool as a drawn
   * mark's layer is; several above one layer stack in the order given. The
   * layers left empty are pruned. `beside` puts marks on the layer of the
   * mark they follow, just after it. The selection becomes the changed and
   * added marks (`select: 'result'`, the default), or keeps what it had but
   * the removed (`'keep'`).
   */
  applyMarkEdit(
    edit: MarkEdit,
    options: { select?: 'result' | 'keep'; beside?: Array<{ above: string; eraser: Stroke }> } = {},
  ): void {
    const beside = options.beside ?? [];
    if (edit.changed.size === 0 && edit.removed.size === 0 && edit.added.length === 0 && beside.length === 0) return;
    this.pushHistory();
    const vacated = new Set<string>();
    const strokes: Stroke[] = [];
    for (const stroke of this.sketch.strokes) {
      if (edit.removed.has(stroke.id)) {
        vacated.add(layerOf(this.sketch, stroke).id);
        continue;
      }
      const next = edit.changed.get(stroke.id);
      strokes.push(next ? { ...next, id: stroke.id, layer: stroke.layer } : stroke);
      for (const extra of beside) {
        if (extra.above === stroke.id) strokes.push({ ...extra.eraser, layer: layerOf(this.sketch, stroke).id });
      }
    }
    // The added marks' layers: each right above the last one put above the same layer.
    const lastAbove = new Map<string, string>();
    const added: Stroke[] = [];
    for (const { stroke, above } of edit.added) {
      const after = lastAbove.get(above) ?? above;
      const index = this.sketch.layers.findIndex((l) => l.id === after);
      const anchor = this.sketch.layers.find((l) => l.id === above);
      const base = TOOL_LAYER_NAMES[stroke.tool] ?? 'Layer';
      const n = this.sketch.layers.filter((l) => l.name.startsWith(base)).length + 1;
      const layer = createLayer(`${base} ${n}`);
      layer.parent = anchor?.parent;
      if (anchor) {
        layer.opacity = anchor.opacity;
        if (anchor.effects) layer.effects = anchor.effects.map((effect) => ({ ...effect }));
      }
      this.sketch.layers.splice(index < 0 ? this.sketch.layers.length : index + 1, 0, layer);
      lastAbove.set(above, layer.id);
      added.push({ ...stroke, layer: layer.id });
    }
    this.sketch.strokes = [...strokes, ...added];
    if (options.select === 'keep') {
      for (const id of edit.removed) this.selectedIds.delete(id);
      for (const stroke of added) this.selectedIds.add(stroke.id);
      if (added.length > 0) this.syncLayerHighlight();
    } else {
      this.selectedIds = new Set([...edit.changed.keys(), ...added.map((s) => s.id)].filter((id) => !edit.removed.has(id)));
      this.syncLayerHighlight();
    }
    this.pruneEmptyLayers(vacated);
    this.touch();
  }

  /**
   * Expand Appearance (core/appearance.ts's expandAppearance), as one undo
   * step: each mark named gives way to the marks it becomes. One mark takes
   * its place outright, on its layer. Several - a Splatter's hatch beside the
   * mark's outline - become a group in its place: the group takes the name,
   * visibility, lock, blend and effects of the mark's layer, and the layer's
   * opacity times the mark's, with the whole mark's effects ahead of the
   * layer's own; each new mark gets a layer of its own in it, bottom first. A
   * layer that held other marks as well keeps them, and the group goes just
   * above it. What the marks became is selected. False when no mark named is
   * on the page.
   *
   * Expand Text to Shape asks more of it: `grouped`, a group even round one
   * mark; `name`, the group's name in place of the layer's - the text's
   * first words; `labels`, each new mark's layer's name - its character.
   */
  expandMarks(
    items: ReadonlyArray<{
      id: string;
      marks: readonly Stroke[];
      effects: readonly Effect[];
      opacity: number;
      grouped?: boolean;
      name?: string;
      labels?: readonly string[];
    }>,
  ): boolean {
    const found = items.filter((item) => item.marks.length > 0 && this.sketch.strokes.some((s) => s.id === item.id));
    if (found.length === 0) return false;
    this.pushHistory();
    const selected: string[] = [];
    for (const item of found) {
      const stroke = this.sketch.strokes.find((s) => s.id === item.id)!;
      const index = this.sketch.strokes.indexOf(stroke);
      if (item.marks.length === 1 && !item.grouped) {
        const mark = { ...item.marks[0], id: stroke.id, ...(stroke.layer ? { layer: stroke.layer } : {}) };
        this.sketch.strokes[index] = mark;
        selected.push(mark.id);
        continue;
      }
      const leaf = layerOf(this.sketch, stroke);
      const alone = !this.sketch.strokes.some((s) => s !== stroke && layerOf(this.sketch, s).id === leaf.id);
      const group = createGroupLayer(item.name ?? leaf.name);
      group.parent = leaf.parent;
      group.visible = leaf.visible;
      group.locked = leaf.locked;
      group.opacity = leaf.opacity * item.opacity;
      if (isBlended(leaf.blend)) group.blend = leaf.blend;
      const effects = [...item.effects, ...(leaf.effects ?? [])];
      if (effects.length > 0) group.effects = effects;
      // Each mark on a layer of its own inside the group, named as a new mark's layer is.
      const counts = new Map<string, number>();
      const layers = item.marks.map((mark, k) => {
        const label = item.labels?.[k];
        if (label !== undefined) {
          const named = createLayer(label);
          named.parent = group.id;
          return named;
        }
        const base = TOOL_LAYER_NAMES[mark.tool] ?? 'Layer';
        const n = (counts.get(base) ?? this.sketch.layers.filter((l) => l.name.startsWith(base)).length) + 1;
        counts.set(base, n);
        const layer = createLayer(`${base} ${n}`);
        layer.parent = group.id;
        return layer;
      });
      // The group's rows: its layers, then the group itself, which the panel draws above them.
      const at = this.sketch.layers.findIndex((l) => l.id === leaf.id);
      if (alone) this.sketch.layers.splice(at, 1, ...layers, group);
      else this.sketch.layers.splice(at + 1, 0, ...layers, group);
      if (alone && this.activeLayerId === leaf.id) this.activeLayerId = group.id;
      const marks = item.marks.map((mark, k) => ({ ...mark, layer: layers[k].id }));
      this.sketch.strokes.splice(index, 1, ...marks);
      selected.push(...marks.map((mark) => mark.id));
    }
    this.selectedIds = new Set(selected);
    this.syncLayerHighlight();
    this.touch();
    return true;
  }

  /**
   * Removes the candidate layers that no longer hold strokes, then any group
   * emptied by that removal. Always keeps at least one drawable layer. A
   * layer holding only eraser marks is empty - they cut what is on their own
   * layer, and there is nothing - and they go with it.
   */
  private pruneEmptyLayers(candidates: Set<string>): void {
    const hadChildren = new Set(
      this.sketch.layers
        .filter((l) => l.group && this.sketch.layers.some((c) => c.parent === l.id))
        .map((l) => l.id),
    );
    const before = this.sketch.layers;
    let layers = this.sketch.layers.filter(
      (l) =>
        l.group ||
        !candidates.has(l.id) ||
        this.sketch.strokes.some((s) => s.tool !== 'eraser' && layerOf(this.sketch, s).id === l.id),
    );
    // The erasers of a layer pruned away go with it.
    const keptIds = new Set(layers.map((l) => l.id));
    const gone = new Set(before.filter((l) => !keptIds.has(l.id)).map((l) => l.id));
    if (gone.size > 0) {
      this.sketch.strokes = this.sketch.strokes.filter((s) => s.tool !== 'eraser' || !gone.has(layerOf(this.sketch, s).id));
    }
    for (;;) {
      const next = layers.filter(
        (l) => !l.group || !hadChildren.has(l.id) || layers.some((c) => c.parent === l.id),
      );
      if (next.length === layers.length) break;
      layers = next;
    }
    if (!layers.some((l) => !l.group)) layers = [createLayer()];
    this.sketch.layers = layers;
    if (!layers.some((l) => l.id === this.activeLayerId)) {
      this.activeLayerId = layers.find((l) => !l.group)!.id;
    }
  }

  // ---- Undo / redo ---------------------------------------------------------

  undo(): void {
    // Undo while a preview is showing takes the preview back: settling makes
    // it the step this pops.
    this.settleTransaction();
    this.flushHistoryStep();
    const prev = this.undoStack.pop();
    if (!prev) return;
    // What comes back holds what the step reached, so redo can put back as much.
    const current = this.snapshot(prev.pages !== undefined);
    this.redoStack.push(current);
    this.restore(prev);
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.openHistoryStep('undo', current);
    this.touch();
  }

  redo(): void {
    this.settleTransaction();
    this.flushHistoryStep();
    const next = this.redoStack.pop();
    if (!next) return;
    const current = this.snapshot(next.pages !== undefined);
    this.undoStack.push(current);
    this.restore(next);
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.openHistoryStep('redo', current);
    this.touch();
  }

  /** True when there is a step to undo: one on the stack, or a transaction open that has changed something - a burst of typing under way. */
  get canUndo(): boolean {
    return this.undoStack.length > 0 || this.transaction?.touched === true;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ---- Pages ---------------------------------------------------------------

  /** Adds a new blank page after the active one and switches to it. */
  addPage(name = 'unnamed'): void {
    // A transaction belongs to the page it began on, and history is per page.
    this.leavePage();
    this.settleTransaction();
    this.flushHistoryStep();
    const sketch = createSketch(name);
    sketch.width = this.sketch.width;
    sketch.height = this.sketch.height;
    sketch.background = this.sketch.background;
    this.book.sketches.splice(this.activeIndex + 1, 0, sketch);
    this.activeIndex += 1;
    this.resetPageState();
    this.touch();
  }

  /** Appends already-built pages (e.g. from a PDF import) after the active one. */
  addImportedPages(pages: Sketch[]): void {
    if (pages.length === 0) return;
    this.leavePage();
    this.settleTransaction();
    this.flushHistoryStep();
    for (const page of pages) this.adoptConfigs(page.strokes);
    this.book.sketches.splice(this.activeIndex + 1, 0, ...pages);
    this.activeIndex += 1;
    this.resetPageState();
    this.touch();
  }

  /**
   * Sets the active page's size mode. A 'sized' page pins the given
   * dimensions; an 'endless' page goes back to tracking the window.
   */
  setPageSize(mode: 'endless' | 'sized', width?: number, height?: number): void {
    this.sketch.sizeMode = mode;
    if (mode === 'sized') {
      if (typeof width === 'number' && width > 0) this.sketch.width = Math.round(width);
      if (typeof height === 'number' && height > 0) this.sketch.height = Math.round(height);
    }
    this.touch();
  }

  /** Removes the active page (keeps at least one). */
  removePage(): void {
    if (this.book.sketches.length <= 1) return;
    this.leavePage();
    this.settleTransaction();
    this.flushHistoryStep();
    this.book.sketches.splice(this.activeIndex, 1);
    this.activeIndex = Math.max(0, this.activeIndex - 1);
    this.resetPageState();
    this.touch();
  }

  /** Switches to a page by index (clamped). Resets per-page history. */
  goToPage(index: number): void {
    const clamped = Math.max(0, Math.min(this.book.sketches.length - 1, index));
    if (clamped === this.activeIndex) return;
    this.leavePage();
    this.settleTransaction();
    this.flushHistoryStep();
    this.activeIndex = clamped;
    this.resetPageState();
    this.emit();
  }

  /** Clears per-page state after the active page changes. */
  private resetPageState(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingStep = null;
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.activeLayerId = this.sketch.layers[0]?.id ?? '';
  }

  // ---- Layers ---------------------------------------------------------------

  /** Adds a new empty layer above the active one and makes it active. */
  addLayer(): void {
    this.pushHistory();
    const layer = createLayer(`Layer ${this.sketch.layers.length + 1}`);
    // New layers sit beside the active layer, inside the same group (if any).
    layer.parent = this.activeLayer.parent;
    const index = this.sketch.layers.findIndex((l) => l.id === this.activeLayer.id);
    this.sketch.layers.splice(index + 1, 0, layer);
    this.activeLayerId = layer.id;
    this.touch();
  }

  /**
   * Wraps the active layer (or group — nesting allowed) in a new group and
   * returns the group.
   */
  groupActiveLayer(): Layer {
    return this.groupLayers([this.activeLayer.id]);
  }

  /**
   * Wraps the given layers in one new group (fixing "selected layers do not
   * group"). Selection roots — members whose parent is not also selected —
   * are reparented into the group; their descendants come along, and the
   * grouped block is made contiguous with the group header rendered on top.
   * Falls back to the active layer when `ids` is empty.
   */
  groupLayers(ids: string[]): Layer {
    this.pushHistory();
    const members = new Set(
      (ids.length > 0 ? ids : [this.activeLayer.id]).filter((id) =>
        this.sketch.layers.some((l) => l.id === id),
      ),
    );
    if (members.size === 0) members.add(this.activeLayer.id);

    // Roots: selected layers not nested inside another selected layer.
    const roots = [...members].filter((id) => {
      const parent = this.sketch.layers.find((l) => l.id === id)?.parent;
      return !parent || !members.has(parent);
    });

    const count = this.sketch.layers.filter((l) => l.group).length;
    const group = createGroupLayer(`Group ${count + 1}`);
    group.parent = this.sketch.layers.find((l) => l.id === roots[0])?.parent;

    // The block is every root plus everything already nested beneath it.
    const blockIds = new Set<string>();
    for (const root of roots) {
      blockIds.add(root);
      for (const d of descendantLayerIds(this.sketch, root)) blockIds.add(d);
      this.sketch.layers.find((l) => l.id === root)!.parent = group.id;
    }

    const original = this.sketch.layers;
    const block = original.filter((l) => blockIds.has(l.id));
    const rest = original.filter((l) => !blockIds.has(l.id));
    const topIndex = Math.max(...block.map((l) => original.indexOf(l)));
    const insertAt = rest.filter((l) => original.indexOf(l) < topIndex).length;
    rest.splice(insertAt, 0, ...block, group);
    this.sketch.layers = rest;

    this.activeLayerId = group.id;
    this.selectedLayerIds = new Set([group.id]);
    this.touch();
    return group;
  }

  /**
   * Make Clipping Mask (core/clip.ts): the topmost of the marks of `ids`,
   * when it is a closed shape, clips the rest. Their layers are grouped into a
   * "Clip Group" (REUSE: {@link groupLayers}) whose `clip` names that mark,
   * and the clip's layer goes on top inside it. One undo step. Returns why it
   * could not - fewer than two marks, or an open path on top - or null.
   */
  makeClipping(ids: Iterable<string>): ClipProblem | null {
    const plan = makeClip(this.sketch, ids);
    if ('problem' in plan) return plan.problem;
    const group = this.groupLayers(plan.layers);
    group.name = CLIP_GROUP_NAME;
    group.clip = plan.clip.id;
    // The block the clip's layer heads in the group, moved up under the group's row.
    const byId = new Map(this.sketch.layers.map((l) => [l.id, l]));
    let root = byId.get(plan.clip.layer ?? '');
    while (root && root.parent !== group.id) root = root.parent ? byId.get(root.parent) : undefined;
    if (root) {
      const block = new Set([root.id, ...descendantLayerIds(this.sketch, root.id)]);
      const moved = this.sketch.layers.filter((l) => block.has(l.id));
      const rest = this.sketch.layers.filter((l) => !block.has(l.id));
      rest.splice(rest.findIndex((l) => l.id === group.id), 0, ...moved);
      this.sketch.layers = rest;
    }
    this.touch();
    return null;
  }

  /**
   * Release Clipping Mask: the clip taken off the clip group `layerId` is or
   * is in. The group stays a group - Ungroup ungroups it - and its clip mark
   * paints again. One undo step; false when there is no clip to release.
   */
  releaseClipping(layerId: string): boolean {
    const group = releaseClip(this.sketch, layerId);
    if (!group) return false;
    this.pushHistory();
    delete group.clip;
    this.touch();
    return true;
  }

  /**
   * Dissolves the active group: its children move up to the group's parent
   * and keep their strokes. Returns false when the active layer is no group.
   */
  ungroupActiveLayer(): boolean {
    const group = this.activeLayer;
    if (!group.group) return false;
    this.pushHistory();
    let firstChild: Layer | null = null;
    for (const layer of this.sketch.layers) {
      if (layer.parent === group.id) {
        layer.parent = group.parent;
        firstChild ??= layer;
      }
    }
    this.sketch.layers = this.sketch.layers.filter((l) => l.id !== group.id);
    this.activeLayerId =
      firstChild?.id ?? this.sketch.layers.find((l) => !l.group)?.id ?? this.sketch.layers[0].id;
    this.touch();
    return true;
  }

  /**
   * Appends imported layers (with their strokes) above the current stack.
   * Nested children (SVG group layers) become group rows whose child layers
   * carry the strokes, so imported structure can expand/collapse in the panel.
   */
  addImportedLayers(imported: ImportedLayerNode[]): void {
    if (imported.length === 0) return;
    this.pushHistory();
    // One routine builds the rows for an import and for a script generated
    // from a file, so the two cannot disagree about the tree a file makes.
    const built = buildImportedLayers(imported);
    this.sketch.layers.push(...built.layers);
    this.adoptConfigs(built.strokes);
    this.sketch.strokes.push(...built.strokes);
    if (built.active) this.activeLayerId = built.active;
    this.touch();
  }

  /**
   * Rebuilds copied layers in the stack rather than flattening them: a group
   * comes back a group, with everything that nested inside it still nested,
   * and each layer keeps its own opacity, visibility, and lock.
   *
   * The tree lands beside `siblingOf` - the layer it was copied from - at that
   * layer's own nesting level, so a pasted group sits *next to* the original
   * rather than inside it. When that layer is not on this page (a paste onto
   * another page) the tree goes to the top level instead.
   *
   * Returns the strokes that were added, which the caller makes the selection.
   */
  pasteLayerTree(
    roots: LayerTreeNode[],
    siblingOf: string | null,
    options: { history?: boolean } = {},
  ): Stroke[] {
    if (roots.length === 0) return [];
    // The Alt-drag copy pushes one step covering the copy and the drag that
    // follows, so it asks for no step of its own here.
    if (options.history !== false) this.pushHistory();
    const source = siblingOf ? this.sketch.layers.find((l) => l.id === siblingOf) : undefined;
    const built: Layer[] = [];
    const marks: { stroke: Stroke; order: number }[] = [];

    const build = (node: LayerTreeNode, parent: string | undefined): void => {
      const layer = node.group ? createGroupLayer(node.name) : createLayer(node.name);
      layer.opacity = node.opacity;
      layer.visible = node.visible;
      layer.locked = node.locked;
      layer.parent = parent;
      // Children go into the stack before their group header, which is what
      // renders the header above them in the panel and keeps paint order.
      for (const child of node.children) build(child, layer.id);
      for (const mark of node.marks) {
        marks.push({ stroke: { ...mark.stroke, id: createId('st'), layer: layer.id }, order: mark.order });
      }
      built.push(layer);
    };
    for (const root of roots) build(root, source?.parent);

    // Right after the source layer's own row, so the copy reads as the
    // sibling sitting above it in the panel.
    const at = source
      ? this.sketch.layers.findIndex((l) => l.id === source.id) + 1
      : this.sketch.layers.length;
    this.sketch.layers.splice(at, 0, ...built);

    // Paint order within the copy is the order the originals had.
    marks.sort((a, b) => a.order - b.order);
    const added = marks.map((m) => m.stroke);
    this.adoptConfigs(added);
    this.sketch.strokes.push(...added);

    // The pasted root becomes the active row, the way a new layer does.
    this.activeLayerId = built[built.length - 1]?.id ?? this.activeLayerId;
    this.touch();
    return added;
  }

  /**
   * Deletes a layer and its strokes. Deleting a group deletes every layer
   * inside it (nested included). Always keeps at least one drawable layer.
   */
  removeLayer(id: string): void {
    const index = this.sketch.layers.findIndex((l) => l.id === id);
    if (index === -1) return;
    const doomed = new Set<string>([id, ...descendantLayerIds(this.sketch, id)]);
    const survivors = this.sketch.layers.filter((l) => !doomed.has(l.id));
    if (!survivors.some((l) => !l.group)) return;
    this.pushHistory();
    this.sketch.layers = survivors;
    this.sketch.strokes = this.sketch.strokes.filter((s) => !s.layer || !doomed.has(s.layer));
    if (doomed.has(this.activeLayerId)) {
      this.activeLayerId = survivors.find((l) => !l.group)!.id;
    }
    this.selectedIds.clear();
    this.selectedLayerIds = new Set([...this.selectedLayerIds].filter((lid) => !doomed.has(lid)));
    this.touch();
  }

  /**
   * Moves a layer one step up (+1, toward the top) or down (-1) in the stack.
   * Group rows themselves stay put (their children carry the paint order).
   * Returns false when the move was not possible, so a keyboard caller can
   * say why nothing happened.
   */
  moveLayer(id: string, direction: 1 | -1): boolean {
    const index = this.sketch.layers.findIndex((l) => l.id === id);
    if (index === -1 || this.sketch.layers[index].group) return false;
    const target = index + direction;
    if (target < 0 || target >= this.sketch.layers.length) return false;
    this.pushHistory();
    const [layer] = this.sketch.layers.splice(index, 1);
    this.sketch.layers.splice(target, 0, layer);
    this.touch();
    return true;
  }

  /**
   * Restacks every layer in `ids` one step up (+1, toward the top of the
   * panel) or down (-1).
   *
   * Each one travels as a block - the layer plus everything nested under it,
   * which the stack already keeps contiguous - and moves among its own
   * siblings, so a layer never leaves the group it lives in. Blocks are moved
   * destination-first, which keeps the selection's own order and lets a block
   * that has reached the end hold the ones behind it rather than letting them
   * pile through. A row selected inside a selected group travels with that
   * group instead of separately.
   *
   * Returns false when nothing could move, so the caller can say why.
   */
  moveLayers(ids: Iterable<string>, direction: 1 | -1): boolean {
    const plan = this.movePlan(ids);
    if (!plan) return false;
    const { blocks, moving } = plan;

    const blockIds = (id: string): Set<string> =>
      new Set([id, ...descendantLayerIds(this.sketch, id)]);

    const step = (id: string): boolean => {
      const neighbour = this.moveNeighbour(id, direction, moving);
      if (!neighbour) return false;
      const block = blockIds(id);
      const past = blockIds(neighbour.id);
      const rest = this.sketch.layers.filter((l) => !block.has(l.id));
      const lifted = this.sketch.layers.filter((l) => block.has(l.id));
      const anchor =
        direction === 1
          ? rest.findIndex((l) => l.id === neighbour.id) + 1
          : Math.min(...[...past].map((pid) => rest.findIndex((l) => l.id === pid)).filter((i) => i >= 0));
      rest.splice(anchor, 0, ...lifted);
      this.sketch.layers = rest;
      return true;
    };

    // Nearest the destination first.
    const ordered = [...blocks]
      .map((id) => ({ id, index: this.sketch.layers.findIndex((l) => l.id === id) }))
      .sort((a, b) => (direction === 1 ? b.index - a.index : a.index - b.index))
      .map((b) => b.id);

    this.pushHistory();
    let moved = false;
    for (const id of ordered) moved = step(id) || moved;
    if (!moved) {
      // Nothing shifted, so the history step just pushed would be a no-op the
      // user would have to undo twice past.
      this.undoStack.pop();
      this.pendingStep = null;
      return false;
    }
    this.touch();
    return true;
  }

  /**
   * Whether {@link moveLayers} would shift anything, so the panel's move
   * buttons can grey out at the ends of the stack instead of doing nothing.
   */
  canMoveLayers(ids: Iterable<string>, direction: 1 | -1): boolean {
    const plan = this.movePlan(ids);
    if (!plan) return false;
    return plan.blocks.some((id) => this.moveNeighbour(id, direction, plan.moving) !== null);
  }

  /**
   * The blocks a move would shift: one per selected layer that no other
   * selected layer already carries, plus every id travelling with them.
   */
  private movePlan(ids: Iterable<string>): { blocks: string[]; moving: Set<string> } | null {
    const present = [...new Set(ids)].filter((id) => this.sketch.layers.some((l) => l.id === id));
    if (present.length === 0) return null;
    // Rows already carried by a selected group are not blocks of their own.
    const carried = new Set<string>();
    for (const id of present) {
      const layer = this.sketch.layers.find((l) => l.id === id);
      if (!layer?.group) continue;
      for (const d of descendantLayerIds(this.sketch, id)) carried.add(d);
    }
    const blocks = present.filter((id) => !carried.has(id));
    if (blocks.length === 0) return null;
    // Everything that is moving, so a block never swaps with another block.
    const moving = new Set<string>(blocks);
    for (const id of blocks) for (const d of descendantLayerIds(this.sketch, id)) moving.add(d);
    return { blocks, moving };
  }

  /**
   * The sibling a block would swap with, or null when it has reached the end
   * of the run it may travel in - no sibling that way, or the only one there
   * is moving too.
   */
  private moveNeighbour(id: string, direction: 1 | -1, moving: Set<string>): Layer | null {
    const layer = this.sketch.layers.find((l) => l.id === id);
    if (!layer) return null;
    const siblings = this.sketch.layers.filter((l) => l.parent === layer.parent);
    const at = siblings.findIndex((sib) => sib.id === id);
    const neighbour = siblings[at + direction];
    return neighbour && !moving.has(neighbour.id) ? neighbour : null;
  }

  /**
   * Drag-and-drop reorder for the layers panel. Moves `dragId` (together with
   * everything nested under it) so it sits panel-above or panel-below
   * `targetId`, or drops it `into` a group. Returns false for invalid drops
   * (dropping a group into its own descendant, `into` a non-group, ...).
   */
  reorderLayer(dragId: string, targetId: string, position: 'above' | 'below' | 'into'): boolean {
    if (dragId === targetId) return false;
    const drag = this.sketch.layers.find((l) => l.id === dragId);
    const target = this.sketch.layers.find((l) => l.id === targetId);
    if (!drag || !target) return false;
    const dragBlockIds = new Set<string>([dragId, ...descendantLayerIds(this.sketch, dragId)]);
    if (dragBlockIds.has(targetId)) return false;
    if (position === 'into' && !target.group) return false;
    this.pushHistory();
    const block = this.sketch.layers.filter((l) => dragBlockIds.has(l.id));
    const rest = this.sketch.layers.filter((l) => !dragBlockIds.has(l.id));
    const targetIndex = rest.findIndex((l) => l.id === targetId);
    let insertAt: number;
    if (position === 'into') {
      drag.parent = target.id;
      insertAt = targetIndex; // directly beneath the group header in the panel
    } else if (position === 'above') {
      drag.parent = target.parent;
      insertAt = targetIndex + 1; // panel-above = later in paint order
    } else {
      // Panel-below = before the target and everything nested under it.
      drag.parent = target.parent;
      insertAt = targetIndex;
      for (const id of descendantLayerIds(this.sketch, targetId)) {
        const i = rest.findIndex((l) => l.id === id);
        if (i !== -1 && i < insertAt) insertAt = i;
      }
    }
    rest.splice(insertAt, 0, ...block);
    this.sketch.layers = rest;
    this.touch();
    return true;
  }

  /**
   * Sets the blend of each layer named, as one step (core/blend.ts). Normal
   * takes the field away, so a layer set back to Normal is the layer it was.
   * False, with no step, when every one already has it.
   */
  setLayersBlend(ids: Iterable<string>, blend: BlendModeId, history = true): boolean {
    const wanted = new Set(ids);
    const changing = this.sketch.layers.filter((layer) => wanted.has(layer.id) && (layer.blend ?? 'normal') !== blend);
    if (changing.length === 0) return false;
    if (history) this.pushHistory();
    for (const layer of changing) {
      if (isBlended(blend)) layer.blend = blend;
      else delete layer.blend;
    }
    this.touch();
    return true;
  }

  /**
   * Gives the marks named new effect lists, as one step: `change` is the new
   * list, or what to make of each mark's own. Each mark takes a new array,
   * never its old one changed - an undo snapshot shares the old one - and an
   * empty list takes the field away. Erasers have none. False when nothing
   * changes.
   */
  setEffects(
    ids: Iterable<string>,
    change: readonly Effect[] | ((current: readonly Effect[], stroke: Stroke) => readonly Effect[]),
    history = true,
  ): boolean {
    const wanted = new Set(ids);
    const updates: Array<[Stroke, Effect[]]> = [];
    for (const stroke of this.sketch.strokes) {
      if (!wanted.has(stroke.id) || stroke.tool === 'eraser') continue;
      const current = stroke.effects ?? [];
      const next = typeof change === 'function' ? change(current, stroke) : change;
      if (!sameEffects(current, next)) updates.push([stroke, [...next]]);
    }
    if (updates.length === 0) return false;
    if (history) this.pushHistory();
    for (const [stroke, next] of updates) {
      if (next.length > 0) stroke.effects = next;
      else delete stroke.effects;
    }
    this.touch();
    return true;
  }

  /** The same for layers and groups: a layer's effects work on its whole picture. */
  setLayerEffects(
    ids: Iterable<string>,
    change: readonly Effect[] | ((current: readonly Effect[], layer: Layer) => readonly Effect[]),
    history = true,
  ): boolean {
    const wanted = new Set(ids);
    const updates: Array<[Layer, Effect[]]> = [];
    for (const layer of this.sketch.layers) {
      if (!wanted.has(layer.id)) continue;
      const current = layer.effects ?? [];
      const next = typeof change === 'function' ? change(current, layer) : change;
      if (!sameEffects(current, next)) updates.push([layer, [...next]]);
    }
    if (updates.length === 0) return false;
    if (history) this.pushHistory();
    for (const [layer, next] of updates) {
      if (next.length > 0) layer.effects = next;
      else delete layer.effects;
    }
    this.touch();
    return true;
  }

  /**
   * Turns Isolate Blending on or off for each group named, as one step;
   * layers that are not groups are passed by. False when nothing changes.
   */
  setLayersIsolate(ids: Iterable<string>, on: boolean, history = true): boolean {
    const wanted = new Set(ids);
    const changing = this.sketch.layers.filter((layer) => wanted.has(layer.id) && layer.group === true && (layer.isolate === true) !== on);
    if (changing.length === 0) return false;
    if (history) this.pushHistory();
    for (const layer of changing) {
      if (on) layer.isolate = true;
      else delete layer.isolate;
    }
    this.touch();
    return true;
  }

  /**
   * Updates a layer's properties. Structural toggles push a history step;
   * pass `history: false` for continuous updates (opacity slider drags).
   */
  setLayerProps(id: string, patch: Partial<Omit<Layer, 'id'>>, history = true): void {
    const layer = this.sketch.layers.find((l) => l.id === id);
    if (!layer) return;
    if (history) this.pushHistory();
    Object.assign(layer, patch);
    if ((patch.visible === false || patch.locked === true) && this.selectedIds.size > 0) {
      // Hidden/locked content must not stay selected (group toggles cascade).
      const layerIds = new Set<string>([id, ...descendantLayerIds(this.sketch, id)]);
      const affected = new Set(
        this.sketch.strokes.filter((s) => s.layer && layerIds.has(s.layer)).map((s) => s.id),
      );
      this.selectedIds = new Set([...this.selectedIds].filter((sid) => !affected.has(sid)));
    }
    this.touch();
  }

  /**
   * A composition style's restyle (core/composition-style.ts) as one undo
   * step - or, with `history` false, part of the step open: the marks it
   * changed, and the layers it changed, a field set to undefined taken away.
   * The Text Configurations the restyled texts follow join the book. Nothing,
   * and no step, when nothing changes. The selection stays, less what a layer
   * hidden or locked now holds.
   */
  restyle(
    edit: { readonly strokes: readonly Stroke[]; readonly layers: ReadonlyArray<{ readonly id: string; readonly patch: Partial<Omit<Layer, 'id'>> }> },
    history = true,
  ): boolean {
    const marks = new Map(edit.strokes.map((stroke) => [stroke.id, stroke]));
    const layers = edit.layers.filter(({ id }) => this.sketch.layers.some((layer) => layer.id === id));
    if (!this.sketch.strokes.some((stroke) => marks.has(stroke.id)) && layers.length === 0) return false;
    if (history) this.pushHistory();
    const made: Stroke[] = [];
    // New marks and new layers, so the snapshot just taken still holds the page as it was.
    this.sketch.strokes = this.sketch.strokes.map((stroke) => {
      const next = marks.get(stroke.id);
      if (!next) return stroke;
      const mark = { ...next, id: stroke.id, layer: stroke.layer };
      made.push(mark);
      return mark;
    });
    this.adoptConfigs(made);
    const shut = new Set<string>();
    for (const { id, patch } of layers) {
      const index = this.sketch.layers.findIndex((layer) => layer.id === id);
      const layer = { ...this.sketch.layers[index] } as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete layer[key];
        else layer[key] = value;
      }
      this.sketch.layers[index] = layer as unknown as Layer;
      if (patch.visible === false || patch.locked === true) shut.add(id);
    }
    if (shut.size > 0 && this.selectedIds.size > 0) {
      const ids = new Set([...shut].flatMap((id) => [id, ...descendantLayerIds(this.sketch, id)]));
      const affected = new Set(this.sketch.strokes.filter((s) => s.layer && ids.has(s.layer)).map((s) => s.id));
      this.selectedIds = new Set([...this.selectedIds].filter((sid) => !affected.has(sid)));
    }
    this.touch();
    return true;
  }

  // ---- Close shape ----------------------------------------------------------

  /**
   * Closes each selected drawing stroke by joining its two end points.
   * 'sharp' bridges them with a straight segment; 'smooth' runs a Catmull-Rom
   * blend through the surrounding points so the seam continues each end's
   * direction. Strokes whose ends already touch are skipped, as are text,
   * images, erasers, and anything too short to enclose space. Returns how
   * many strokes were closed.
   */
  closeSelectedStrokes(mode: 'sharp' | 'smooth'): number {
    const candidates = this.sketch.strokes.filter((s) => {
      if (!this.selectedIds.has(s.id)) return false;
      if (s.tool === 'eraser' || isTextStroke(s) || isImageStroke(s)) return false;
      if (s.points.length < 3) return false;
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      return Math.hypot(first.x - last.x, first.y - last.y) > 0.5;
    });
    if (candidates.length === 0) return 0;
    this.pushHistory();
    for (const stroke of candidates) {
      this.closeStroke(stroke, mode);
    }
    this.touch();
    return candidates.length;
  }

  /** Closes one stroke's end gap (see {@link closeSelectedStrokes}). */
  private closeStroke(stroke: Stroke, mode: 'sharp' | 'smooth'): void {
    const pts = stroke.points;
    const first = pts[0];
    const last = pts[pts.length - 1];

    if (stroke.vector && stroke.vector.anchors.length >= 2) {
      // Bezier-structured strokes close through their anchor model, so the
      // seam stays editable with the Vector Path tool and exports as a true
      // closing segment. A smooth close adds Catmull-Rom-derived tangents on
      // the closing pair - only where no handle exists, so the drawn curve
      // keeps its shape.
      const anchors = stroke.vector.anchors;
      const head = anchors[0];
      const tail = anchors[anchors.length - 1];
      stroke.vector.closed = true;
      if (mode === 'smooth') {
        const prev = anchors[anchors.length - 2] ?? head;
        const next = anchors[1] ?? tail;
        if (!tail.hOut) {
          tail.hOut = {
            x: tail.p.x + (head.p.x - prev.p.x) / 6,
            y: tail.p.y + (head.p.y - prev.p.y) / 6,
          };
        }
        if (!head.hIn) {
          head.hIn = {
            x: head.p.x - (next.p.x - tail.p.x) / 6,
            y: head.p.y - (next.p.y - tail.p.y) / 6,
          };
        }
      }
      if (mode === 'sharp') {
        // A sharp close is a straight closing segment, so the two handles
        // that would bend it are dropped. Neither is used while the path is
        // open - nothing follows the last anchor and nothing precedes the
        // first - so clearing them changes the seam and nothing else.
        delete tail.hOut;
        delete head.hIn;
      }
      // Resample the closing run onto the drawn points so the canvas shows
      // the seam at once: one straight segment when neither end has a handle.
      const straight = !tail.hOut && !head.hIn;
      const bridge = cubicBezierPoints(
        { ...tail.p, pressure: last.pressure },
        tail.hOut ?? tail.p,
        head.hIn ?? head.p,
        { ...head.p, pressure: first.pressure },
        straight ? 1 : 16,
      );
      pts.push(...bridge.slice(1));
      return;
    }

    if (mode === 'sharp') {
      // A straight bridge: one segment from the last point back to the first.
      pts.push({ x: first.x, y: first.y, pressure: last.pressure });
      return;
    }

    // Smooth: a Catmull-Rom span between the two ends, with one context
    // point on each side so the bridge leaves and arrives along the drawn
    // directions instead of kinking at the seam.
    const context = [pts[pts.length - 2], last, first, pts[1]];
    const sampled = catmullRom(context, 12);
    // The middle span (last -> first) sits between the two context spans.
    const bridge = sampled.slice(12, 25);
    pts.push(...bridge.slice(1, -1), { x: first.x, y: first.y, pressure: first.pressure });
  }

  // ---- Drag copy ------------------------------------------------------------

  /**
   * Duplicates the current selection in place - the Alt-drag copy. Selected
   * strokes are cloned onto cloned layers: every involved layer is copied (a
   * group row selected in the panel brings its whole subtree), a copied
   * root's name takes the " - copy" suffix while layers nested under a
   * copied group keep their names, and the clones become the selection so
   * the drag that follows moves the copy. Pushes no history step of its own:
   * the caller wraps the copy and the drag into one.
   */
  duplicateSelectedElements(): number {
    const strokes = this.sketch.strokes.filter((s) => this.selectedIds.has(s.id));
    if (strokes.length === 0) return 0;

    // Layers to copy: each selected stroke's layer, plus the full subtree of
    // every group row picked in the panel (so a group copies as a group).
    const involved = new Set<string>();
    for (const stroke of strokes) involved.add(layerOf(this.sketch, stroke).id);
    for (const id of this.selectedLayerIds) {
      const layer = this.sketch.layers.find((l) => l.id === id);
      if (!layer) continue;
      involved.add(id);
      for (const d of descendantLayerIds(this.sketch, id)) involved.add(d);
    }

    // Clone the involved layers in stack order, remapping parents that were
    // copied too; a parent left behind keeps nesting the copy where the
    // original lives. Only the copied roots take the " - copy" name.
    const idMap = new Map<string, string>();
    const clones: Layer[] = [];
    let insertAt = -1;
    this.sketch.layers.forEach((layer, index) => {
      if (!involved.has(layer.id)) return;
      insertAt = index;
      const clone: Layer = { ...layer, id: createId(layer.group ? 'gp' : 'ly') };
      idMap.set(layer.id, clone.id);
      clones.push(clone);
    });
    for (const clone of clones) {
      const mapped = clone.parent ? idMap.get(clone.parent) : undefined;
      if (mapped) {
        // Copied along with its group: nest under the copy, keep the name.
        clone.parent = mapped;
      } else {
        // A copied root (top level, or left nested in an uncopied group):
        // this is the row that reads as "the copy", so it takes the suffix.
        clone.name = `${clone.name} - copy`;
      }
    }
    this.sketch.layers.splice(insertAt + 1, 0, ...clones);

    // Clone the strokes onto the copied layers, appended so the copies paint
    // above their originals within each layer.
    const copies = strokes.map((stroke) => {
      const clone = JSON.parse(JSON.stringify(stroke)) as Stroke;
      clone.id = createId('st');
      clone.layer = idMap.get(layerOf(this.sketch, stroke).id);
      return clone;
    });
    this.sketch.strokes.push(...copies);

    this.selectedIds = new Set(copies.map((s) => s.id));
    this.syncLayerHighlight();
    this.touch();
    return copies.length;
  }

  // ---- Join / fill ----------------------------------------------------------

  /**
   * Joins two or more selected drawing strokes end-to-end into one stroke
   * (nearest endpoints first), keeping the first stroke's style. Returns the
   * merged stroke, or null when fewer than two drawing strokes are selected.
   */
  joinSelectedStrokes(): Stroke | null {
    const candidates = this.sketch.strokes.filter(
      (s) =>
        this.selectedIds.has(s.id) &&
        s.tool !== 'eraser' &&
        !isTextStroke(s) &&
        !isImageStroke(s) &&
        s.points.length > 0,
    );
    if (candidates.length < 2) return null;
    this.pushHistory();

    // Greedy chain: repeatedly merge the pair with the closest endpoints.
    const pool = candidates.map((s) => s.points.map((p) => ({ ...p })));
    while (pool.length > 1) {
      let best = { i: 0, j: 1, flipI: false, flipJ: false, dist: Infinity };
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const a = pool[i];
          const b = pool[j];
          // Try every endpoint pairing: i's tail meets j's head after flips.
          const pairs = [
            { flipI: false, flipJ: false, pa: a[a.length - 1], pb: b[0] },
            { flipI: false, flipJ: true, pa: a[a.length - 1], pb: b[b.length - 1] },
            { flipI: true, flipJ: false, pa: a[0], pb: b[0] },
            { flipI: true, flipJ: true, pa: a[0], pb: b[b.length - 1] },
          ];
          for (const pair of pairs) {
            const dist = Math.hypot(pair.pa.x - pair.pb.x, pair.pa.y - pair.pb.y);
            if (dist < best.dist) best = { i, j, flipI: pair.flipI, flipJ: pair.flipJ, dist };
          }
        }
      }
      const a = best.flipI ? pool[best.i].reverse() : pool[best.i];
      const b = best.flipJ ? pool[best.j].reverse() : pool[best.j];
      a.push(...b);
      pool.splice(best.j, 1);
      pool[best.i] = a;
    }

    // One stroke means one layer: the merge lands on the first stroke's
    // layer and the layers the other pieces vacated are pruned, rather than
    // leaving a row per piece behind with nothing on it.
    const first = candidates[0];
    const home = layerOf(this.sketch, first);
    const merged: Stroke = {
      ...first,
      id: createId('st'),
      points: pool[0],
      fill: undefined,
      // The first piece's anchors describe the first piece alone; the caller
      // fits the whole joined run afresh.
      vector: undefined,
      layer: home.id,
      sharpened: candidates.every((s) => s.sharpened),
    };
    const vacated = new Set(candidates.map((s) => layerOf(this.sketch, s).id));
    vacated.delete(home.id);
    const removeIds = new Set(candidates.map((s) => s.id));
    const at = this.sketch.strokes.findIndex((s) => removeIds.has(s.id));
    this.sketch.strokes = this.sketch.strokes.filter((s) => !removeIds.has(s.id));
    this.sketch.strokes.splice(at, 0, merged);
    this.pruneEmptyLayers(vacated);
    this.activeLayerId = home.id;
    this.selectedIds = new Set([merged.id]);
    this.selectedLayerIds = new Set([home.id]);
    this.touch();
    return merged;
  }

  /**
   * Replaces the given strokes with one merged stroke in a single history
   * step (used by the Join-stroke-on-snap setting).
   */
  replaceWithJoined(removeIds: string[], merged: Stroke): void {
    this.pushHistory();
    const doomed = new Set(removeIds);
    // Layers the absorbed pieces leave behind are pruned, so a join reads as
    // one element on one layer (see joinSelectedStrokes).
    const vacated = new Set(
      this.sketch.strokes.filter((s) => doomed.has(s.id)).map((s) => layerOf(this.sketch, s).id),
    );
    const at = this.sketch.strokes.findIndex((s) => doomed.has(s.id));
    this.sketch.strokes = this.sketch.strokes.filter((s) => !doomed.has(s.id));
    this.sketch.strokes.splice(at === -1 ? this.sketch.strokes.length : at, 0, merged);
    vacated.delete(layerOf(this.sketch, merged).id);
    this.pruneEmptyLayers(vacated);
    this.touch();
  }

  /**
   * Applies `color` to the selection: closed shapes are filled, other
   * drawing strokes and text recolored. Returns the counts of each.
   * Continuous edits (a color picker being dragged) pass `history: false`
   * after the first tick so the whole drag collapses into one undo step.
   */
  fillSelected(color: string, history = true): { filled: number; recolored: number } {
    const targets = this.sketch.strokes.filter(
      (s) => this.selectedIds.has(s.id) && !isImageStroke(s) && s.tool !== 'eraser',
    );
    if (targets.length === 0) return { filled: 0, recolored: 0 };
    if (history) this.pushHistory();
    let filled = 0;
    let recolored = 0;
    for (const stroke of targets) {
      if (isClosedStroke(stroke)) {
        stroke.fill = color;
        filled++;
      } else {
        // A text takes the color whole, its runs' own colors too.
        if (isTextStroke(stroke)) applyPatch(stroke, textColorPatch(stroke, color));
        else stroke.color = color;
        recolored++;
      }
    }
    this.touch();
    return { filled, recolored };
  }

  /**
   * Paints the selection with `color` as the one of fill and stroke in front
   * would (core/paint.ts's `paintPatch`, mark by mark): with the stroke,
   * every outline and text takes it; with the fill, every closed shape is
   * filled, and text takes it. Continuous edits (a picker being dragged) pass
   * `history: false` after the first tick, so the drag is one undo step.
   * Returns how many shapes were filled and how many marks recolored.
   */
  paintSelected(target: ColorTarget, color: string, history = true): { filled: number; recolored: number } {
    const patches: Array<[Stroke, Partial<Stroke>]> = [];
    for (const stroke of this.sketch.strokes) {
      if (!this.selectedIds.has(stroke.id)) continue;
      const patch = paintPatch(stroke, target, color);
      if (patch) patches.push([stroke, patch]);
    }
    if (patches.length === 0) return { filled: 0, recolored: 0 };
    if (history) this.pushHistory();
    let filled = 0;
    let recolored = 0;
    for (const [stroke, patch] of patches) {
      applyPatch(stroke, patch);
      if ('fill' in patch) filled++;
      else recolored++;
    }
    this.touch();
    return { filled, recolored };
  }

  /**
   * Swap Fill and Stroke on the selection: each selected closed shape's fill
   * and outline trade colors (core/paint.ts's `swapPaint`), in one undo
   * step. Returns how many shapes swapped.
   */
  swapSelectedPaint(): number {
    const patches: Array<[Stroke, Partial<Stroke>]> = [];
    for (const stroke of this.sketch.strokes) {
      if (!this.selectedIds.has(stroke.id)) continue;
      const patch = swapPaint(stroke);
      if (patch) patches.push([stroke, patch]);
    }
    if (patches.length === 0) return 0;
    this.pushHistory();
    for (const [stroke, patch] of patches) applyPatch(stroke, patch);
    this.touch();
    return patches.length;
  }

  // ---- Element properties (properties panel) -------------------------------

  /**
   * Applies a property patch to specific strokes. Keys set to `undefined` are
   * deleted rather than stored, so `{ fill: undefined }` removes a fill.
   * Continuous edits (a color picker being dragged) pass `history: false`
   * after the first tick so the whole drag collapses into one undo step.
   */
  setStrokeProps(ids: Iterable<string>, patch: Partial<Stroke>, history = true): number {
    const targets = new Set(ids);
    const strokes = this.sketch.strokes.filter((s) => targets.has(s.id));
    if (strokes.length === 0) return 0;
    if (history) this.pushHistory();
    for (const stroke of strokes) applyPatch(stroke, patch);
    this.touch();
    return strokes.length;
  }

  /** Moves specific strokes by (dx, dy) with an optional history step. */
  moveStrokes(ids: Iterable<string>, dx: number, dy: number, history = true): void {
    const targets = new Set(ids);
    const strokes = this.sketch.strokes.filter((s) => targets.has(s.id));
    if (strokes.length === 0 || (dx === 0 && dy === 0)) return;
    if (history) this.pushHistory();
    for (const stroke of strokes) {
      for (const p of stroke.points) {
        p.x += dx;
        p.y += dy;
      }
      this.shiftVector(stroke, dx, dy);
    }
    this.touch();
  }

  /**
   * Scales specific strokes about (ox, oy) by the given factors. Text and
   * image items have no points to spread, so their footprint is scaled
   * instead: a text item's font size (and fixed box width) and an image's
   * rendered width and height, each anchored the same way as the geometry.
   */
  scaleStrokes(
    ids: Iterable<string>,
    sx: number,
    sy: number,
    ox: number,
    oy: number,
    history = true,
  ): void {
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return;
    if (sx === 1 && sy === 1) return;
    const targets = new Set(ids);
    const strokes = this.sketch.strokes.filter((s) => targets.has(s.id));
    if (strokes.length === 0) return;
    if (history) this.pushHistory();
    const map = (p: { x: number; y: number }): void => {
      p.x = ox + (p.x - ox) * sx;
      p.y = oy + (p.y - oy) * sy;
    };
    for (const stroke of strokes) {
      for (const p of stroke.points) map(p);
      if (stroke.vector) {
        for (const anchor of stroke.vector.anchors) {
          map(anchor.p);
          if (anchor.hIn) map(anchor.hIn);
          if (anchor.hOut) map(anchor.hOut);
        }
      }
      if (stroke.smudges) stroke.smudges = mapSmudges(stroke.smudges, (p) => ({ x: ox + (p.x - ox) * sx, y: oy + (p.y - oy) * sy }), Math.sqrt(Math.abs(sx * sy)));
      if (isImageStroke(stroke)) {
        stroke.imageWidth = Math.max(1, (stroke.imageWidth ?? 100) * sx);
        stroke.imageHeight = Math.max(1, (stroke.imageHeight ?? 100) * sy);
      } else if (isTextStroke(stroke) && typeSpecOf(stroke).kind !== 'point') {
        // Sheet and Path Typing: the frame or the path scales, and the type
        // keeps its size and reflows in it, as a vector editor's area type and
        // type on a path do.
        if (stroke.typeset) stroke.typeset = scaleTypeShape(stroke.typeset, sx, sy);
        if (stroke.textBoxWidth) stroke.textBoxWidth = Math.max(1, stroke.textBoxWidth * sx);
      } else if (isTextStroke(stroke)) {
        // Sideless Typing scales its type, by one factor; the mean of the two
        // keeps a non-uniform scale from silently ignoring one axis.
        stroke.fontSize = Math.max(1, (stroke.fontSize ?? 24) * ((sx + sy) / 2));
        // Its runs and paragraphs scale with it.
        if (stroke.typeset) stroke.typeset = scaleTypeset(stroke.typeset, sx, sy);
      } else if (this.scaleStrokesAndEffects) {
        // Line weight follows the shape so a scaled-down element does not
        // keep a disproportionately heavy outline.
        stroke.width = Math.max(0.5, stroke.width * Math.sqrt(Math.abs(sx * sy)));
      }
      // Its effects scale with it too, and a scale through zero mirrors them.
      if (this.scaleStrokesAndEffects && stroke.effects) {
        stroke.effects = effectsAfterTransform(stroke.effects, {
          scale: Math.sqrt(Math.abs(sx * sy)),
          flipX: sx < 0 && !isTextStroke(stroke),
          flipY: sy < 0 && !isTextStroke(stroke),
        });
      }
    }
    this.touch();
  }

  /**
   * Turns specific strokes about (cx, cy) by `degrees`, clockwise for a
   * positive angle and counterclockwise for a negative one.
   *
   * Sampled points and Bezier anchors (with both tangent handles) all turn,
   * so a rotated vector path stays editable and bows exactly as it did. A
   * Copic stroke's broad nib turns with it: the nib angle is measured in the
   * same clockwise degrees, so the chisel keeps its bearing relative to the
   * mark rather than staying pinned to the page.
   *
   * Text and images have no orientation in the model - a text item is drawn
   * along the page's own axis and an image into an upright box - so those two
   * orbit the centre without tipping. An image orbits by its middle rather
   * than by the top-left corner its anchor records, which is what keeps a
   * turned image where the eye expects it. Path type's path turns with it,
   * and the text follows the path; so does area type's frame when it is not
   * a rectangle.
   */
  rotateStrokes(
    ids: Iterable<string>,
    degrees: number,
    cx: number,
    cy: number,
    history = true,
  ): void {
    if (!Number.isFinite(degrees) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
    if (degrees % 360 === 0) return;
    const targets = new Set(ids);
    const strokes = this.sketch.strokes.filter((s) => targets.has(s.id));
    if (strokes.length === 0) return;
    if (history) this.pushHistory();
    const trig = rotationTrig(degrees);
    const turn = (p: { x: number; y: number }): void => {
      const moved = rotateAbout(p, cx, cy, trig);
      p.x = moved.x;
      p.y = moved.y;
    };
    for (const stroke of strokes) {
      if (isImageStroke(stroke)) {
        // The anchor is the top-left corner; the middle is what orbits.
        const anchor = stroke.points[0];
        if (!anchor) continue;
        const halfW = (stroke.imageWidth ?? 100) / 2;
        const halfH = (stroke.imageHeight ?? 100) / 2;
        const middle = rotateAbout(
          { x: anchor.x + halfW, y: anchor.y + halfH },
          cx,
          cy,
          trig,
        );
        anchor.x = middle.x - halfW;
        anchor.y = middle.y - halfH;
        continue;
      }
      for (const p of stroke.points) turn(p);
      if (isTextStroke(stroke) && stroke.typeset && typesetIsShape(stroke.typeset)) {
        stroke.typeset = mapTypesetAnchors(stroke.typeset, (p) => rotateAbout(p, 0, 0, trig));
      }
      if (stroke.smudges) stroke.smudges = mapSmudges(stroke.smudges, (p) => rotateAbout(p, cx, cy, trig));
      if (stroke.vector) {
        for (const anchor of stroke.vector.anchors) {
          turn(anchor.p);
          if (anchor.hIn) turn(anchor.hIn);
          if (anchor.hOut) turn(anchor.hOut);
        }
      }
      if (stroke.tool === 'copic') {
        const nib = (stroke.nibAngle ?? DEFAULT_NIB_ANGLE) + degrees;
        stroke.nibAngle = ((nib % 360) + 360) % 360;
      }
      // A shadow turns with the mark that casts it, and a bevel's light too;
      // text and images orbit upright, so theirs stay as they are.
      if (this.scaleStrokesAndEffects && stroke.effects && !isTextStroke(stroke)) {
        stroke.effects = effectsAfterTransform(stroke.effects, { rotate: degrees });
      }
    }
    this.touch();
  }

  /**
   * Mirrors specific strokes - left-right across x = `mirror.x`, top-bottom
   * across y = `mirror.y`, or both. What happens to each kind of element is
   * {@link mirrorStroke}'s business; `boxOf` measures text the way the canvas
   * lays it out, so a mirrored text box lands where its image would.
   */
  mirrorStrokes(
    ids: Iterable<string>,
    mirror: Mirror,
    options: { history?: boolean; boxOf?: (stroke: Stroke) => TransformBox | null } = {},
  ): void {
    if (!mirror.flipX && !mirror.flipY) return;
    if (!Number.isFinite(mirror.x) || !Number.isFinite(mirror.y)) return;
    const targets = new Set(ids);
    const strokes = this.sketch.strokes.filter((s) => targets.has(s.id));
    if (strokes.length === 0) return;
    if (options.history !== false) this.pushHistory();
    for (const stroke of strokes) {
      mirrorStroke(stroke, mirror, options.boxOf?.(stroke));
      // A shadow and a bevel's light flip with the mark; text stays readable, so its own stay.
      if (this.scaleStrokesAndEffects && stroke.effects && !isTextStroke(stroke)) {
        stroke.effects = effectsAfterTransform(stroke.effects, { flipX: mirror.flipX, flipY: mirror.flipY });
      }
    }
    this.touch();
  }

  // ---- Tool settings -------------------------------------------------------

  /** Updates tool settings (partial merge). */
  setTool(patch: Partial<ToolState>): void {
    this.tool = { ...this.tool, ...patch };
    this.emit();
  }

  /** Updates auto-sharpen settings (partial merge). */
  setSharpen(patch: Partial<SharpenOptions>): void {
    this.tool = { ...this.tool, sharpen: { ...this.tool.sharpen, ...patch } };
    this.emit();
  }

  // ---- Status --------------------------------------------------------------

  private touch(): void {
    if (this.transaction) this.transaction.touched = true;
    this.dirty = true;
    this.sketch.updatedAt = new Date().toISOString();
    this.emit();
  }

  /** Marks the document as cleanly saved and adopts the saved name. */
  markSaved(filePath: string): void {
    this.filePath = filePath;
    this.book.name = basename(filePath).replace(/\.skbk$/i, '');
    this.dirty = false;
    this.emit();
  }
}
