/**
 * Automate > Generate Script > From Session History: the steps Track History
 * recorded on a page, written as a script, with the steps the popup leaves
 * unticked left out.
 *
 * The page before the history began is found by walking the steps back from
 * the page as it is now: a mark or layer a step added was not there, one a
 * step removed was there as the step found it, and a change is undone
 * property by property. From there the ticked steps are played forward, in
 * order: an added mark comes in as it was added, a change sets the properties
 * that step changed and no others, a removal takes the mark away, and layers
 * are made, renamed, regrouped and changed the same way. So unticking a step
 * gives the drawing as it would be had that step not happened.
 *
 * What is written is what the session drew: the marks its ticked steps made,
 * and a mark drawn before the history began only when a ticked step changed
 * it, as the session left it. Layers are written as the replay leaves them,
 * stacked as the page stacks them now.
 *
 * The replayed page is written by the script writer in paint order - a group
 * cannot be opened twice, so marks cannot be written in the order they were
 * drawn - and each step's comment goes before the first mark it drew:
 * `# 7  Draw:Add:mark  Brush stroke  (2026-09-25 14:03)`, then a line for each
 * thing it did to marks other steps drew and to the layers, and on the step
 * that drew a mark a later step removed, `# removed in step 12`. A step that
 * drew nothing says what it did before the next step that drew something.
 * Pure and DOM-free.
 */

import type { LayerChange, SnapshotDiff } from '../history-diff.js';
import type { Layer, Sketch, Stroke } from '../types.js';
import { formatScript } from './format.js';
import type { DocumentInstruction } from './instructions.js';
import { sketchToInstructions, type WriteStats } from './writer.js';

/** One recorded step, as the script needs it: Track History's record, less the parts only the popup reads. */
export interface HistoryScriptStep {
  /** 1-based, in the order the steps happened. */
  readonly index: number;
  /** When the step began, as an ISO time. */
  readonly at: string;
  /** The page it happened on, by index. */
  readonly page: number;
  /** The tool type the popup lists it under: `Draw:Add:mark`. */
  readonly type: string;
  /** What the popup calls it: `Brush stroke`. */
  readonly label: string;
  readonly diff: SnapshotDiff;
}

export interface HistoryScriptOptions {
  /** The page the script is written from, by index: steps on other pages are not played. 0 unless given. */
  readonly page?: number;
  /** The steps written, by index: the ticked rows. Every step when absent. */
  readonly include?: ReadonlySet<number>;
  /** The app's version, for the first line. */
  readonly version?: string;
  /** When the script is written, as an ISO time, for the first line. */
  readonly now?: string;
  /** A time as the comments show it. The ISO date and minute, as recorded (UTC), unless given. */
  readonly time?: (iso: string) => string;
  /** The writer's decimals: 2 unless given; null writes every digit. */
  readonly decimals?: number | null;
}

/** A session's history as a script, and what the Generated script dialog says about it. */
export interface HistoryScript {
  readonly script: DocumentInstruction[];
  /** The script as text: the header, the steps' comments among the instructions, and any comments left over at the end. */
  readonly text: string;
  /** What the script draws differently from the page, a sentence each. */
  readonly notes: string[];
  readonly stats: WriteStats;
  /** The steps written, and the ones left out, by index. */
  readonly included: readonly number[];
  readonly excluded: readonly number[];
}

/** An ISO time as the comments show it by default: its date and minute, as recorded. */
function isoMinute(iso: string): string {
  return iso.length >= 16 ? iso.slice(0, 16).replace('T', ' ') : iso;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

/** Sets each of `keys` on `target` from `source`; a key `source` has no value for is taken away. */
function setFrom(target: object, source: object, keys: Iterable<string>): void {
  const to = target as Record<string, unknown>;
  const from = source as Record<string, unknown>;
  for (const key of keys) {
    const value = from[key];
    if (value === undefined || value === null) delete to[key];
    else to[key] = copy(value);
  }
}

/** Puts back what a change's `was` holds; null means the property was not set. */
function putBack(target: object, was: Readonly<Record<string, unknown>>): void {
  setFrom(target, was, Object.keys(was));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A layer as a comment names it. */
function named(layer: Layer | null | undefined, id: string): string {
  return `"${layer?.name ?? id}"`;
}

/** A mark's state in the replay. */
interface MarkState {
  stroke: Stroke;
  present: boolean;
  /** True for a mark the history began without: one a step made. */
  session: boolean;
  /** The ticked step that made it. */
  madeIn: number | null;
  /** For a mark drawn before the history began: the first ticked step that changed it, where it is written. */
  changedIn: number | null;
  /** The ticked step that last removed it, while it stays removed. */
  removedIn: number | null;
}

/** A layer's state in the replay: always its last known row, and whether it is on the page. */
interface LayerState {
  row: Layer;
  present: boolean;
  session: boolean;
  madeIn: number | null;
}

/** The layer a layer change is about. */
function changedLayer(change: LayerChange): string | null {
  switch (change.op) {
    case 'add':
    case 'remove':
      return change.layer.id;
    case 'restack':
      return null;
    default:
      return change.id;
  }
}

/** One step's marks by id, so walking a mark back through every step looks each one up rather than searching it. */
interface MarkIndex {
  readonly added: ReadonlySet<string>;
  readonly removed: ReadonlyMap<string, Stroke>;
  readonly changed: ReadonlySet<string>;
}

function indexMarks(diff: SnapshotDiff): MarkIndex {
  return {
    added: new Set(diff.added.map((stroke) => stroke.id)),
    removed: new Map(diff.removed.map((stroke) => [stroke.id, stroke])),
    changed: new Set(diff.changed.map((stroke) => stroke.id)),
  };
}

/**
 * Walks a mark back from how the page has it now to how it was before the
 * first of the steps: absent where a step added it, as found where a step
 * removed it, and each change undone.
 */
function markBefore(id: string, now: Stroke | undefined, steps: readonly HistoryScriptStep[], index: readonly MarkIndex[]): Stroke | null {
  let state: Stroke | null = now ? copy(now) : null;
  for (let s = steps.length - 1; s >= 0; s--) {
    const marks = index[s];
    if (marks.added.has(id)) state = null;
    const removed = marks.removed.get(id);
    if (removed) state = copy(removed);
    const was = steps[s].diff.was[id];
    if (was && state && marks.changed.has(id)) putBack(state, was);
  }
  return state;
}

function layerBefore(id: string, now: Layer | undefined, steps: readonly HistoryScriptStep[]): Layer | null {
  let state: Layer | null = now ? copy(now) : null;
  for (let s = steps.length - 1; s >= 0; s--) {
    const changes = steps[s].diff.layers;
    for (let c = changes.length - 1; c >= 0; c--) {
      const change = changes[c];
      if (changedLayer(change) !== id) continue;
      if (change.op === 'add') state = null;
      else if (change.op === 'remove') state = copy(change.layer);
      else if (!state) continue;
      else if (change.op === 'rename') state.name = change.from;
      else if (change.op === 'reparent') {
        if (change.from === null) delete state.parent;
        else state.parent = change.from;
      } else if (change.op === 'props') putBack(state, change.was);
    }
  }
  return state;
}

/** The last full row of a layer the history saw, for a layer the page no longer has. */
function lastRow(id: string, now: Layer | undefined, steps: readonly HistoryScriptStep[]): Layer | null {
  if (now) return copy(now);
  for (let s = steps.length - 1; s >= 0; s--) {
    for (const change of steps[s].diff.layers) {
      if ((change.op === 'add' || change.op === 'remove') && change.layer.id === id) return copy(change.layer);
    }
  }
  return null;
}

/** Writes the steps of `page` Track History recorded as a script, the ticked ones played. */
export function historyScript(steps: readonly HistoryScriptStep[], page: Sketch, options: HistoryScriptOptions = {}): HistoryScript {
  const pageIndex = options.page ?? 0;
  const time = options.time ?? isoMinute;
  const mine = [...steps].filter((step) => step.page === pageIndex).sort((a, b) => a.index - b.index);
  const ticked = (step: HistoryScriptStep): boolean => options.include === undefined || options.include.has(step.index);
  const included = mine.filter(ticked).map((step) => step.index);
  const excluded = mine.filter((step) => !ticked(step)).map((step) => step.index);

  // ---- Before the history began ----
  const nowMarks = new Map(page.strokes.map((stroke) => [stroke.id, stroke]));
  const nowLayers = new Map(page.layers.map((layer) => [layer.id, layer]));
  const markIds = new Set<string>();
  const layerIds = new Set<string>();
  for (const step of mine) {
    for (const stroke of [...step.diff.added, ...step.diff.removed, ...step.diff.changed]) markIds.add(stroke.id);
    for (const change of step.diff.layers) {
      const id = changedLayer(change);
      if (id) layerIds.add(id);
    }
  }
  const marks = new Map<string, MarkState>();
  const index = mine.map((step) => indexMarks(step.diff));
  // A mark the page no longer has, as a step first drew it.
  const firstDrawn = new Map<string, Stroke>();
  for (const step of mine) for (const stroke of step.diff.added) if (!firstDrawn.has(stroke.id)) firstDrawn.set(stroke.id, stroke);
  for (const id of markIds) {
    const before = markBefore(id, nowMarks.get(id), mine, index);
    const known = before ?? copy(nowMarks.get(id) ?? firstDrawn.get(id) ?? index.map((marks) => marks.removed.get(id)).find((stroke) => stroke !== undefined)!);
    marks.set(id, { stroke: known, present: before !== null, session: before === null, madeIn: null, changedIn: null, removedIn: null });
  }
  const layers = new Map<string, LayerState>();
  for (const id of layerIds) {
    const before = layerBefore(id, nowLayers.get(id), mine);
    const row = before ?? lastRow(id, nowLayers.get(id), mine);
    if (row) layers.set(id, { row, present: before !== null, session: before === null, madeIn: null });
  }

  // ---- The ticked steps, played forward ----
  const blocks = new Map<number, string[]>();
  for (const step of mine) {
    if (!ticked(step)) continue;
    const lines = [`${step.index}  ${step.type}  ${step.label}  (${time(step.at)})`];
    blocks.set(step.index, lines);
    const diff = step.diff;
    for (const change of diff.layers) {
      const id = changedLayer(change);
      const state = id ? layers.get(id) : undefined;
      if (change.op === 'restack') {
        lines.push('restacked the layers');
        continue;
      }
      if (!state) continue;
      if (change.op === 'add') {
        state.row = copy(change.layer);
        if (!state.present && state.session && state.madeIn === null) {
          state.madeIn = step.index;
          lines.push(`added layer ${named(state.row, change.layer.id)}`);
        } else {
          lines.push(`brought back layer ${named(state.row, change.layer.id)}`);
        }
        state.present = true;
      } else if (change.op === 'remove') {
        if (state.present) lines.push(`removed layer ${named(state.row, change.layer.id)}`);
        state.present = false;
      } else if (!state.present) {
        lines.push(`changed layer ${named(state.row, change.id)}, which is left out`);
      } else if (change.op === 'rename') {
        lines.push(`renamed layer "${state.row.name}" to "${change.to}"`);
        state.row.name = change.to;
      } else if (change.op === 'reparent') {
        const into = change.to === null ? null : layers.get(change.to)?.row ?? nowLayers.get(change.to) ?? null;
        lines.push(change.to === null ? `moved layer ${named(state.row, change.id)} out of its group` : `moved layer ${named(state.row, change.id)} into ${named(into, change.to)}`);
        if (change.to === null) delete state.row.parent;
        else state.row.parent = change.to;
      } else if (change.op === 'props') {
        lines.push(`changed layer ${named(state.row, change.id)}: ${Object.keys(change.props).join(', ')}`);
        setFrom(state.row, change.props, Object.keys(change.props));
      }
    }
    for (const stroke of diff.added) {
      const state = marks.get(stroke.id)!;
      state.stroke = copy(stroke);
      if (state.present) continue;
      state.present = true;
      state.removedIn = null;
      if (state.session && state.madeIn === null) state.madeIn = step.index;
      else if (state.session) lines.push(`brought back mark from step ${state.madeIn}`);
      else lines.push('brought back a mark drawn before the history began');
    }
    for (const stroke of diff.changed) {
      const state = marks.get(stroke.id)!;
      if (!state.present) {
        lines.push(state.session && state.madeIn === null ? 'changed a mark from a step that is left out' : 'changed a mark that is not on the page here');
        continue;
      }
      const was = diff.was[stroke.id];
      if (was) setFrom(state.stroke, stroke, Object.keys(was));
      else state.stroke = copy(stroke);
      if (state.session) lines.push(`modified mark from step ${state.madeIn}`);
      else {
        if (state.changedIn === null) state.changedIn = step.index;
        lines.push('changed a mark drawn before the history began');
      }
    }
    for (const stroke of diff.removed) {
      const state = marks.get(stroke.id)!;
      if (!state.present) continue;
      state.present = false;
      state.removedIn = step.index;
      lines.push(state.session ? `removed mark from step ${state.madeIn}` : 'removed a mark drawn before the history began');
    }
  }

  // ---- What is written ----
  const drawn = [...marks.entries()].filter(([, state]) => state.present && (state.session || state.changedIn !== null));
  for (const [, state] of marks) {
    if (state.session && !state.present && state.madeIn !== null && state.removedIn !== null) {
      blocks.get(state.madeIn)?.push(`removed in step ${state.removedIn}`);
    }
  }
  const finalIndex = new Map(page.strokes.map((stroke, index) => [stroke.id, index]));
  drawn.sort(([a, sa], [b, sb]) => {
    const ia = finalIndex.get(a) ?? Number.POSITIVE_INFINITY;
    const ib = finalIndex.get(b) ?? Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    return (sa.madeIn ?? sa.changedIn ?? 0) - (sb.madeIn ?? sb.changedIn ?? 0);
  });
  const strokes = drawn.map(([, state]) => state.stroke);
  const anchorOf = new Map<Stroke, number>(drawn.map(([, state]) => [state.stroke, (state.session ? state.madeIn : state.changedIn) ?? 0]));

  // Layers: the replay's, the ones the drawn marks are on, stacked as the page stacks them now.
  const kept = new Map<string, Layer>();
  const notes: string[] = [];
  let revived = 0;
  for (const [id, state] of layers) if (state.present) kept.set(id, state.row);
  for (const stroke of strokes) {
    const id = stroke.layer;
    if (!id || kept.has(id)) continue;
    const state = layers.get(id);
    const row = state?.row ?? (nowLayers.get(id) ? copy(nowLayers.get(id)!) : null);
    if (!row) continue;
    if (state && !state.present) revived++;
    kept.set(id, row);
  }
  // Groups above a kept layer stay, so the tree still stands.
  for (const row of [...kept.values()]) {
    let parent = row.parent;
    while (parent && !kept.has(parent)) {
      const group = layers.get(parent)?.row ?? (nowLayers.get(parent) ? copy(nowLayers.get(parent)!) : null);
      if (!group) break;
      kept.set(parent, group);
      parent = group.parent;
    }
  }
  const stack: Layer[] = page.layers.filter((layer) => kept.has(layer.id)).map((layer) => kept.get(layer.id)!);
  for (const [id, row] of kept) if (!nowLayers.has(id)) stack.push(row);

  const chosen = [
    ...new Set([
      ...strokes.map((stroke) => stroke.layer).filter((id): id is string => id !== undefined && kept.has(id)),
      ...[...layers.entries()].filter(([, state]) => state.present && state.session).map(([id]) => id),
    ]),
  ];
  const replayed: Sketch = { ...page, layers: stack, strokes };
  const written = sketchToInstructions(replayed, { layers: chosen, decimals: options.decimals, trace: true });

  const prior = drawn.filter(([, state]) => !state.session).length;
  if (prior > 0) {
    notes.push(
      `${plural(prior, 'mark')} drawn before the history began ${prior === 1 ? 'is' : 'are'} written as the session left ${prior === 1 ? 'it' : 'them'}, since a step changed ${prior === 1 ? 'it' : 'them'}.`,
    );
  }
  if (revived > 0) notes.push(`${plural(revived, 'layer')} a step removed ${revived === 1 ? 'is' : 'are'} kept, since marks written here are on ${revived === 1 ? 'it' : 'them'}.`);
  notes.push(...written.notes);

  // ---- The comments, before the first mark each step drew ----
  const position = new Map<object, number>();
  const walk = (list: readonly DocumentInstruction[]): void => {
    for (const instruction of list) {
      position.set(instruction, position.size);
      const record = instruction as unknown as Record<string, unknown>;
      if (record.verb === 'group' && Array.isArray(record.body)) walk(record.body as DocumentInstruction[]);
    }
  };
  walk(written.script);
  const firstOf = new Map<number, DocumentInstruction>();
  for (const [stroke, first] of written.firsts ?? []) {
    const step = anchorOf.get(stroke);
    if (step === undefined) continue;
    const held = firstOf.get(step);
    if (!held || (position.get(first) ?? Infinity) < (position.get(held) ?? Infinity)) firstOf.set(step, first);
  }
  const comments = new Map<object, string[]>();
  const trailing: string[] = [];
  let waiting: string[] = [];
  for (const index of included) {
    waiting.push(...(blocks.get(index) ?? []));
    const anchor = firstOf.get(index);
    if (!anchor) continue;
    comments.set(anchor, [...(comments.get(anchor) ?? []), ...waiting]);
    waiting = [];
  }
  trailing.push(...waiting);

  const header = [
    `Written by napkin-sketch${options.version ? ` ${options.version}` : ''} from the session history of "${page.name}"${options.now ? `, ${time(options.now)}` : ''}.`,
    excluded.length === 0
      ? `${plural(included.length, 'step')}, every one recorded on this page.`
      : `${plural(included.length, 'step')} of ${mine.length}; left out: ${excluded.join(', ')}.`,
    ...notes,
  ];
  const comment = (line: string): string => `# ${line.replace(/\s*\n\s*/g, ' ')}`;
  const text =
    header.map(comment).join('\n') +
    '\n' +
    formatScript(written.script, { comments }) +
    (trailing.length > 0 ? `${trailing.map(comment).join('\n')}\n` : '');
  return { script: written.script, text, notes, stats: written.stats, included, excluded };
}
