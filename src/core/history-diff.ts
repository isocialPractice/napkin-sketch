/**
 * What one step of the history changed on a page.
 *
 * The store snapshots the page at every history boundary so the step can be
 * undone. Track History compares that snapshot with the page as the next
 * boundary finds it and keeps what differs: the marks added, removed and
 * changed, by id, the paint order when it moved, and what happened to the
 * layers. It is the comparison the store already makes to tell whether an
 * edit changed anything ({@link sameData}), reported instead of summed.
 *
 * A diff holds copies, never the page's own objects, so a later edit cannot
 * reach back into a step already recorded. A change also keeps what each
 * property it changed was before, so a script written from the history can
 * leave out one step's change and keep a later step's, property by property.
 * Pure and DOM-free.
 */

import type { Layer, Stroke } from './types.js';

/** A page as the history keeps it: its marks in paint order and its layer stack, bottom first. */
export interface PageState {
  readonly strokes: readonly Stroke[];
  readonly layers: readonly Layer[];
}

/** What happened to one layer row in a step. */
export type LayerChange =
  /** A row the step made: the row as it is after the step, and its place in the stack. */
  | { readonly op: 'add'; readonly layer: Layer; readonly index: number }
  /** A row the step took away: the row as it was. */
  | { readonly op: 'remove'; readonly layer: Layer }
  | { readonly op: 'rename'; readonly id: string; readonly from: string; readonly to: string }
  /** A row moved into, out of or between groups; null is the top level. */
  | { readonly op: 'reparent'; readonly id: string; readonly from: string | null; readonly to: string | null }
  /**
   * Opacity, visibility, lock, effects, group: each property that changed, as
   * it is after the step and as it was before it, null where it was not set.
   */
  | {
      readonly op: 'props';
      readonly id: string;
      readonly props: Readonly<Record<string, unknown>>;
      readonly was: Readonly<Record<string, unknown>>;
    }
  /** The rows both pages hold changed order: the whole stack after the step, bottom first. */
  | { readonly op: 'restack'; readonly order: readonly string[] };

/** What one step changed. */
export interface SnapshotDiff {
  /** Marks the step made, as they are after it, in paint order. */
  readonly added: readonly Stroke[];
  /** Marks the step took away, as they were before it, in the order they had. */
  readonly removed: readonly Stroke[];
  /** Marks the step changed, as they are after it, in paint order. */
  readonly changed: readonly Stroke[];
  /**
   * For each changed mark, by id, the properties the step changed and what
   * each was before it, null where the mark did not have it.
   */
  readonly was: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** The paint order after the step, by id, when the marks both pages hold changed order; absent otherwise. */
  readonly order?: readonly string[];
  readonly layers: readonly LayerChange[];
}

/**
 * Structural equality for plain data - primitives, arrays and plain objects,
 * the only things a page is made of. A key holding `undefined` counts as
 * absent, since `setStrokeProps` deletes keys and spreads can leave them.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  // Every step compares every mark on the page, point by point, so this
  // allocates nothing: a page's plain objects have no inherited keys for
  // `for...in` to find.
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let held = 0;
  for (const key in left) {
    const value = left[key];
    if (value === undefined) continue;
    held++;
    if (!sameData(value, right[key])) return false;
  }
  for (const key in right) if (right[key] !== undefined) held--;
  return held === 0;
}

/** A copy that shares nothing with the page. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The ids of `after` in order, when the ids it shares with `before` stand in
 * a different order there; null when they do not. Items only one side holds
 * are an addition or a removal, not a change of order.
 */
function reordered(before: readonly { id: string }[], after: readonly { id: string }[]): string[] | null {
  const inBefore = new Set(before.map((item) => item.id));
  const inAfter = new Set(after.map((item) => item.id));
  const was = before.filter((item) => inAfter.has(item.id)).map((item) => item.id);
  const now = after.filter((item) => inBefore.has(item.id)).map((item) => item.id);
  return was.every((id, i) => id === now[i]) ? null : after.map((item) => item.id);
}

/**
 * The properties that differ between two versions of one thing, with their
 * values on each side, null where a side does not have the property. `skip`
 * names properties another change reports.
 */
function differences(
  before: object,
  after: object,
  skip: ReadonlySet<string> = new Set(),
): { now: Record<string, unknown>; was: Record<string, unknown> } | null {
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const now: Record<string, unknown> = {};
  const was: Record<string, unknown> = {};
  let any = false;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (skip.has(key) || sameData(left[key], right[key])) continue;
    now[key] = right[key] === undefined ? null : copy(right[key]);
    was[key] = left[key] === undefined ? null : copy(left[key]);
    any = true;
  }
  return any ? { now, was } : null;
}

/** A layer's id, name and parent have changes of their own; `props` covers the rest. */
const LAYER_OWN = new Set(['id', 'name', 'parent']);

/** What changed between two states of one page. */
export function diffSnapshots(before: PageState, after: PageState): SnapshotDiff {
  const wasMark = new Map(before.strokes.map((stroke) => [stroke.id, stroke]));
  const isMark = new Set(after.strokes.map((stroke) => stroke.id));
  const added: Stroke[] = [];
  const changed: Stroke[] = [];
  const was: Record<string, Record<string, unknown>> = {};
  for (const stroke of after.strokes) {
    const before = wasMark.get(stroke.id);
    if (!before) {
      added.push(copy(stroke));
      continue;
    }
    const change = differences(before, stroke);
    if (!change) continue;
    changed.push(copy(stroke));
    was[stroke.id] = change.was;
  }
  const removed = before.strokes.filter((stroke) => !isMark.has(stroke.id)).map(copy);
  const order = reordered(before.strokes, after.strokes);

  const wasLayer = new Map(before.layers.map((layer) => [layer.id, layer]));
  const isLayer = new Set(after.layers.map((layer) => layer.id));
  const layers: LayerChange[] = [];
  after.layers.forEach((layer, index) => {
    const was = wasLayer.get(layer.id);
    if (!was) {
      layers.push({ op: 'add', layer: copy(layer), index });
      return;
    }
    if (was.name !== layer.name) layers.push({ op: 'rename', id: layer.id, from: was.name, to: layer.name });
    if ((was.parent ?? null) !== (layer.parent ?? null)) {
      layers.push({ op: 'reparent', id: layer.id, from: was.parent ?? null, to: layer.parent ?? null });
    }
    const props = differences(was, layer, LAYER_OWN);
    if (props) layers.push({ op: 'props', id: layer.id, props: props.now, was: props.was });
  });
  for (const layer of before.layers) if (!isLayer.has(layer.id)) layers.push({ op: 'remove', layer: copy(layer) });
  const stack = reordered(before.layers, after.layers);
  if (stack) layers.push({ op: 'restack', order: stack });

  return { added, removed, changed, was, ...(order ? { order } : {}), layers };
}

/** True when a step changed nothing a page is made of. */
export function isEmptyDiff(diff: SnapshotDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0 &&
    diff.order === undefined &&
    diff.layers.length === 0
  );
}
