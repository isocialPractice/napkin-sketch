/**
 * Where an evaluated script goes.
 *
 * The evaluator never touches a sketch: it tells a sink to start a page, make
 * a layer current, open and close a group, and add a mark, and the sink
 * builds whatever it builds. {@link SketchSink} builds a sketch book. Replaying
 * a script into the document open in the app is the same evaluator with a
 * sink that goes through the app's store instead - a second sink, rather than
 * a second evaluator that would drift from the first.
 */

import type { Effect } from '../effects.js';
import { SKETCHBOOK_VERSION, type Layer, type Sketch, type SketchBook, type Stroke } from '../types.js';

/** A page as a sink is asked to make it. Sizes are in pixels. */
export interface PageSpec {
  name: string;
  width: number;
  height: number;
  /** A CSS color, or `transparent`. */
  background: string;
}

/** A layer's own properties, as `layer` and `group` give them. */
export interface LayerProps {
  opacity?: number;
  hidden?: boolean;
  locked?: boolean;
  /** Effects for the layer or group, added after any it carries already. */
  effects?: Effect[];
}

/** Where marks are going, saved so a block can put it back when it ends. */
export type SinkCursor = unknown;

/** What an evaluation writes to. */
export interface ScriptSink {
  /** Starts a page; the first call starts the first page. */
  beginPage(page: PageSpec): void;
  /** Changes the current page's size, background or name. */
  updatePage(change: Partial<PageSpec>): void;
  /**
   * Makes a drawing layer current: the one of that name in the current group
   * when there is one, otherwise a new one.
   */
  useLayer(name: string, props: LayerProps): void;
  /**
   * Makes a new drawing layer current in the current group, even when the
   * group has one of that name already: how `use` copies a document's
   * layers one for one.
   */
  newLayer(name: string, props: LayerProps): void;
  /** Opens a group inside the current one, and gives its id; layers and marks go inside it until {@link endGroup}. */
  beginGroup(name: string, props: LayerProps): string;
  /** Closes the innermost group, making current again the layer that was current before it opened. */
  endGroup(): void;
  /** Where marks go now. */
  cursor(): SinkCursor;
  /** Sends marks where they went when {@link cursor} was taken. */
  restore(cursor: SinkCursor): void;
  /** Adds a mark to the current layer. The sink gives it its id and its layer. */
  addMark(stroke: Stroke): void;
  /** The current page as drawn so far, to be read and not changed: what a `split` can cut. */
  currentPage(): Sketch;
  /**
   * Puts `pieces` in the place of a mark added to the current page, on its
   * layer and in its paint order: the first keeps the mark's id, and the rest
   * get ids of their own.
   */
  replaceMark(target: Stroke, pieces: readonly Stroke[]): void;
  /** Takes a mark added to the current page away: what an eraser does to a mark it leaves nothing of. */
  removeMark(target: Stroke): void;
  /** The drawing layer marks go to now, or null when no mark has made one yet: the layer an eraser cuts on. */
  currentLayerId(): string | null;
  /** Makes a group a clip group: its content shows only inside `mark`, a closed mark it holds (core/clip.ts). */
  clipGroup(groupId: string, mark: Stroke): void;
}

/** One open level of the layer tree: the page itself, or a group. */
interface Scope {
  /** The group's id, or null for the page. */
  group: string | null;
  /** The group's name, for the layer a mark drawn straight into it lands on. */
  name: string | null;
  /** The drawing layer marks go to, or null when the group has none yet. */
  current: string | null;
}

/** How a {@link SketchSink} names and stamps what it makes. */
export interface SketchSinkOptions {
  /** The book's name. */
  name: string;
  /** The time stamped on the book and its pages, as an ISO string. */
  timestamp: string;
}

/**
 * Builds a sketch book: one sketch per page, the layer tree the script's
 * `layer` and `group` instructions describe, and the marks on it.
 *
 * Ids are counted rather than random - `sk_n1`, `ly_n2`, `st_n3` - so one
 * script gives the same book every time it runs, which is what a test, a diff,
 * or anybody who wants their drawing back tomorrow needs.
 */
export class SketchSink implements ScriptSink {
  private readonly sketches: Sketch[] = [];
  private sketch: Sketch | null = null;
  private scopes: Scope[] = [];
  /** Each page's starting layer, which is left out at the end if nothing was drawn on it. */
  private readonly starting = new Map<Sketch, string>();
  private counter = 0;

  constructor(private readonly options: SketchSinkOptions) {}

  private nextId(prefix: string): string {
    this.counter++;
    return `${prefix}_n${this.counter.toString(36)}`;
  }

  private get page(): Sketch {
    if (!this.sketch) throw new Error('SketchSink: no page has been started');
    return this.sketch;
  }

  private get scope(): Scope {
    return this.scopes[this.scopes.length - 1];
  }

  beginPage(page: PageSpec): void {
    const layer: Layer = { id: this.nextId('ly'), name: 'Layer 1', opacity: 1, visible: true, locked: false };
    const sketch: Sketch = {
      id: this.nextId('sk'),
      name: page.name,
      width: page.width,
      height: page.height,
      sizeMode: 'sized',
      background: page.background,
      layers: [layer],
      strokes: [],
      createdAt: this.options.timestamp,
      updatedAt: this.options.timestamp,
    };
    this.sketches.push(sketch);
    this.sketch = sketch;
    this.starting.set(sketch, layer.id);
    this.scopes = [{ group: null, name: null, current: layer.id }];
  }

  updatePage(change: Partial<PageSpec>): void {
    const page = this.page;
    if (change.name !== undefined) page.name = change.name;
    if (change.width !== undefined) page.width = change.width;
    if (change.height !== undefined) page.height = change.height;
    if (change.background !== undefined) page.background = change.background;
  }

  private applyProps(layer: Layer, props: LayerProps): void {
    if (props.opacity !== undefined) layer.opacity = props.opacity;
    if (props.hidden) layer.visible = false;
    if (props.locked) layer.locked = true;
    if (props.effects && props.effects.length > 0) layer.effects = [...(layer.effects ?? []), ...props.effects];
  }

  useLayer(name: string, props: LayerProps): void {
    const scope = this.scope;
    const page = this.page;
    let layer = page.layers.find((l) => !l.group && l.name === name && (l.parent ?? null) === scope.group);
    if (!layer) {
      layer = { id: this.nextId('ly'), name, opacity: 1, visible: true, locked: false };
      if (scope.group) layer.parent = scope.group;
      page.layers.push(layer);
    }
    this.applyProps(layer, props);
    scope.current = layer.id;
  }

  newLayer(name: string, props: LayerProps): void {
    const scope = this.scope;
    const layer: Layer = { id: this.nextId('ly'), name, opacity: 1, visible: true, locked: false };
    if (scope.group) layer.parent = scope.group;
    this.applyProps(layer, props);
    this.page.layers.push(layer);
    scope.current = layer.id;
  }

  beginGroup(name: string, props: LayerProps): string {
    const scope = this.scope;
    const group: Layer = { id: this.nextId('gp'), name, opacity: 1, visible: true, locked: false, group: true };
    if (scope.group) group.parent = scope.group;
    this.applyProps(group, props);
    this.page.layers.push(group);
    this.scopes.push({ group: group.id, name, current: null });
    return group.id;
  }

  clipGroup(groupId: string, mark: Stroke): void {
    const group = this.page.layers.find((layer) => layer.id === groupId);
    if (group?.group) group.clip = mark.id;
  }

  endGroup(): void {
    if (this.scopes.length > 1) this.scopes.pop();
  }

  cursor(): SinkCursor {
    return this.scopes.map((scope) => ({ ...scope }));
  }

  restore(cursor: SinkCursor): void {
    this.scopes = (cursor as Scope[]).map((scope) => ({ ...scope }));
  }

  addMark(stroke: Stroke): void {
    const scope = this.scope;
    const page = this.page;
    if (!scope.current) {
      // A mark drawn straight into a group lands on a layer named after it,
      // as loose geometry does when a file is imported.
      const layer: Layer = { id: this.nextId('ly'), name: scope.name ?? 'Layer', opacity: 1, visible: true, locked: false };
      if (scope.group) layer.parent = scope.group;
      page.layers.push(layer);
      scope.current = layer.id;
    }
    stroke.id = this.nextId('st');
    stroke.layer = scope.current;
    page.strokes.push(stroke);
  }

  currentPage(): Sketch {
    return this.page;
  }

  replaceMark(target: Stroke, pieces: readonly Stroke[]): void {
    const page = this.page;
    const at = page.strokes.indexOf(target);
    if (at < 0 || pieces.length === 0) return;
    const placed = pieces.map((piece, k) => ({ ...piece, id: k === 0 ? target.id : this.nextId('st'), layer: target.layer }));
    page.strokes.splice(at, 1, ...placed);
  }

  removeMark(target: Stroke): void {
    const page = this.page;
    const at = page.strokes.indexOf(target);
    if (at >= 0) page.strokes.splice(at, 1);
  }

  currentLayerId(): string | null {
    return this.scope.current;
  }

  /**
   * The finished book. A page's starting layer is left out when nothing was
   * drawn on it and the script made a layer of its own, so a script that
   * names its layers gets only those. Each group's header moves after what it
   * holds, where the app keeps it.
   */
  finish(): SketchBook {
    for (const sketch of this.sketches) {
      const id = this.starting.get(sketch);
      const used = sketch.strokes.some((s) => s.layer === id);
      const others = sketch.layers.some((l) => !l.group && l.id !== id);
      if (!used && others) sketch.layers = sketch.layers.filter((l) => l.id !== id);
      sketch.layers = headersAbove(sketch.layers);
    }
    return {
      format: 'napkin-sketch',
      version: SKETCHBOOK_VERSION,
      name: this.options.name,
      sketches: this.sketches,
      createdAt: this.options.timestamp,
      updatedAt: this.options.timestamp,
    };
  }
}

/**
 * The stack with each group's header after everything the group holds, which
 * is where the app keeps it: the stack runs bottom first and the Layers panel
 * draws it top first, so a header after its children is drawn above them. A
 * group's header is added when the group opens, before anything inside it,
 * and this moves it into place once the tree is whole. Sibling order, and so
 * paint order, stays as it was.
 */
function headersAbove(layers: Layer[]): Layer[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const childrenOf = new Map<string, Layer[]>();
  const top: Layer[] = [];
  for (const layer of layers) {
    const parent = layer.parent ? byId.get(layer.parent) : undefined;
    if (parent?.group && parent !== layer) {
      const siblings = childrenOf.get(parent.id) ?? [];
      siblings.push(layer);
      childrenOf.set(parent.id, siblings);
    } else {
      top.push(layer);
    }
  }
  const out: Layer[] = [];
  const placed = new Set<Layer>();
  const place = (layer: Layer): void => {
    if (placed.has(layer)) return;
    placed.add(layer);
    for (const child of childrenOf.get(layer.id) ?? []) place(child);
    out.push(layer);
  };
  for (const layer of top) place(layer);
  // Nothing the sink builds is out of reach of the top, but nothing is dropped if it were.
  for (const layer of layers) place(layer);
  return out;
}
