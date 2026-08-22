/**
 * Renderer-side application store.
 *
 * Holds the open sketch book, the active page, tool settings, selection state,
 * sharpen configuration, dirty/saved status, and a bounded undo/redo history of
 * strokes for the active page. Emits a change event so the UI re-renders.
 */

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
  type Tool,
} from '../core/types.js';
import { DEFAULT_SHARPEN_OPTIONS, type SharpenOptions } from '../sharpen/sharpen.js';
import { catmullRom, cubicBezierPoints } from '../sharpen/geometry.js';

/** Snapshot of the current tool configuration. */
export interface ToolState {
  tool: Tool;
  color: string;
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
  /** Tunable auto-sharpen settings. */
  sharpen: SharpenOptions;
}

const HISTORY_LIMIT = 100;

/** Display-name stems for the auto-created per-element layers. */
const TOOL_LAYER_NAMES: Partial<Record<Tool, string>> = {
  pen: 'Pen',
  marker: 'Marker',
  copic: 'Copic',
  text: 'Text',
  image: 'Image',
};

/** One layer parsed from an imported file; may nest (SVG group layers). */
export interface ImportedLayerNode {
  name: string;
  opacity: number;
  strokes: Stroke[];
  children?: ImportedLayerNode[];
}

type Listener = () => void;

/** One undo/redo snapshot of the active page (strokes + layer stack). */
interface PageSnapshot {
  strokes: Stroke[];
  layers: Layer[];
  activeLayerId: string;
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

  /** Ids of currently selected strokes (Select tool). */
  selectedIds = new Set<string>();

  tool: ToolState = {
    tool: 'pen',
    color: '#1f2328',
    width: 3,
    opacity: null,
    // Per request: Live Sharpen defaults OFF.
    liveSharpen: false,
    fontSize: 24,
    symmetry: 1,
    nibAngle: DEFAULT_NIB_ANGLE,
    sharpen: { ...DEFAULT_SHARPEN_OPTIONS },
  };

  // Per-page history of page snapshots (deep-enough copies for undo/redo).
  private undoStack: PageSnapshot[] = [];
  private redoStack: PageSnapshot[] = [];
  private listeners = new Set<Listener>();

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

  private emit(): void {
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
    this.emit();
  }

  /** Pushes the current page state onto the undo stack before a mutation. */
  pushHistory(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private snapshot(): PageSnapshot {
    return {
      strokes: this.cloneStrokes(this.sketch.strokes),
      layers: this.sketch.layers.map((l) => ({ ...l })),
      activeLayerId: this.activeLayerId,
    };
  }

  private restore(snapshot: PageSnapshot): void {
    this.sketch.strokes = snapshot.strokes;
    this.sketch.layers = snapshot.layers;
    this.activeLayerId = snapshot.activeLayerId;
  }

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
              })),
              ...(s.vector.closed ? { closed: true as const } : {}),
            },
          }
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
   * Selects a layer row in the panel (Shift = add/remove) and highlights the
   * strokes on every selected layer, groups including their descendants.
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
   * Selects every layer between the active (anchor) layer and `id` in the
   * stack, inclusive (Ctrl+Shift+click range select), and highlights their
   * elements on the canvas.
   */
  selectLayerRange(id: string): void {
    const anchor = this.sketch.layers.findIndex((l) => l.id === this.activeLayerId);
    const target = this.sketch.layers.findIndex((l) => l.id === id);
    if (target === -1) return;
    if (anchor === -1) {
      this.selectLayer(id);
      return;
    }
    const lo = Math.min(anchor, target);
    const hi = Math.max(anchor, target);
    this.selectedLayerIds = new Set(this.sketch.layers.slice(lo, hi + 1).map((l) => l.id));
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

  /** Clears the current selection (strokes and layer highlight). */
  clearSelection(): void {
    if (this.selectedIds.size === 0 && this.selectedLayerIds.size === 0) return;
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.emit();
  }

  /** Shifts a stroke's Bézier anchor structure with its points. */
  private shiftVector(stroke: Stroke, dx: number, dy: number): void {
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
   * Removes the candidate layers that no longer hold strokes, then any group
   * emptied by that removal. Always keeps at least one drawable layer.
   */
  private pruneEmptyLayers(candidates: Set<string>): void {
    const hadChildren = new Set(
      this.sketch.layers
        .filter((l) => l.group && this.sketch.layers.some((c) => c.parent === l.id))
        .map((l) => l.id),
    );
    let layers = this.sketch.layers.filter(
      (l) =>
        l.group ||
        !candidates.has(l.id) ||
        this.sketch.strokes.some((s) => layerOf(this.sketch, s).id === l.id),
    );
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
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.touch();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    this.selectedIds.clear();
    this.selectedLayerIds.clear();
    this.touch();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ---- Pages ---------------------------------------------------------------

  /** Adds a new blank page after the active one and switches to it. */
  addPage(name = 'unnamed'): void {
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
    this.book.sketches.splice(this.activeIndex, 1);
    this.activeIndex = Math.max(0, this.activeIndex - 1);
    this.resetPageState();
    this.touch();
  }

  /** Switches to a page by index (clamped). Resets per-page history. */
  goToPage(index: number): void {
    const clamped = Math.max(0, Math.min(this.book.sketches.length - 1, index));
    if (clamped === this.activeIndex) return;
    this.activeIndex = clamped;
    this.resetPageState();
    this.emit();
  }

  /** Clears per-page state after the active page changes. */
  private resetPageState(): void {
    this.undoStack = [];
    this.redoStack = [];
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
    const appendLeaf = (
      item: ImportedLayerNode,
      parent?: string,
      opacity = item.opacity,
      name = item.name,
    ): void => {
      const layer = createLayer(name);
      layer.opacity = opacity;
      layer.parent = parent;
      this.sketch.layers.push(layer);
      for (const stroke of item.strokes) {
        this.sketch.strokes.push({ ...stroke, id: createId('st'), layer: layer.id });
      }
      this.activeLayerId = layer.id;
    };
    const append = (item: ImportedLayerNode, parent?: string): void => {
      if (item.children && item.children.length > 0) {
        const group = createGroupLayer(item.name);
        group.opacity = item.opacity;
        group.parent = parent;
        // Children push first: the group header renders above them in the panel.
        for (const child of item.children) append(child, group.id);
        // Marks the source kept on the group itself get a row of their own; it
        // is named apart from the group so the panel shows no duplicate name.
        if (item.strokes.length > 0) appendLeaf(item, group.id, 1, `${item.name} contents`);
        this.sketch.layers.push(group);
      } else {
        appendLeaf(item, parent);
      }
    };
    for (const item of imported) append(item);
    this.touch();
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
   */
  fillSelected(color: string): { filled: number; recolored: number } {
    const targets = this.sketch.strokes.filter(
      (s) => this.selectedIds.has(s.id) && !isImageStroke(s) && s.tool !== 'eraser',
    );
    if (targets.length === 0) return { filled: 0, recolored: 0 };
    this.pushHistory();
    let filled = 0;
    let recolored = 0;
    for (const stroke of targets) {
      if (isClosedStroke(stroke)) {
        stroke.fill = color;
        filled++;
      } else {
        stroke.color = color;
        recolored++;
      }
    }
    this.touch();
    return { filled, recolored };
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
    for (const stroke of strokes) {
      const record = stroke as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete record[key];
        else record[key] = value;
      }
    }
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
      if (isImageStroke(stroke)) {
        stroke.imageWidth = Math.max(1, (stroke.imageWidth ?? 100) * sx);
        stroke.imageHeight = Math.max(1, (stroke.imageHeight ?? 100) * sy);
      } else if (isTextStroke(stroke)) {
        // Type scales by one factor; the mean of the two keeps a non-uniform
        // scale from silently ignoring one axis.
        stroke.fontSize = Math.max(1, (stroke.fontSize ?? 24) * ((sx + sy) / 2));
        if (stroke.textBoxWidth) stroke.textBoxWidth = Math.max(1, stroke.textBoxWidth * sx);
      } else {
        // Line weight follows the shape so a scaled-down element does not
        // keep a disproportionately heavy outline.
        stroke.width = Math.max(0.5, stroke.width * Math.sqrt(Math.abs(sx * sy)));
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
