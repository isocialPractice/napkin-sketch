/**
 * Track History's record: the steps the store's history takes while tracking
 * is on, each named the way the Generate Script popup lists it.
 *
 * The store says when a step closes and what it changed (`Store.onHistory`);
 * this names it and keeps it. A step is named by the command that made it -
 * a menu row's id, with the type and name the menu files give that row - or
 * by the tool whose press on the canvas made it, as `tool:pen` and "Brush
 * stroke". A step nothing named, such as a change in the Layers panel or the
 * properties panel, is named by what it changed: "Changed 2 marks". The list
 * keeps the newest steps up to the History Limit and lets the oldest go.
 *
 * DOM-free: the settings window imports the usage line from here too.
 */

import type { LayerChange, SnapshotDiff } from '../core/history-diff.js';
import type { HistoryStats } from '../core/ipc.js';
import type { Tool } from '../core/types.js';
import type { HistoryStep } from './store.js';

/** One recorded step, as the popup lists it and the script writes it. */
export interface TrackedStep {
  /** 1-based, and never reused while the document is open. */
  readonly index: number;
  /** When the step began, as an ISO time. */
  readonly at: string;
  /** The page it happened on, by index. */
  readonly page: number;
  readonly kind: HistoryStep['kind'];
  /** A menu id, `tool:<tool>`, `undo`, `redo`, or `unknown`. */
  readonly command: string;
  /** The command's tool type, as the menu files give it: `Draw:Add:mark`. */
  readonly type: string;
  /** What the popup calls it: "Rotate", "Brush stroke", "Undo". */
  readonly label: string;
  readonly diff: SnapshotDiff;
  /** The length of the diff as JSON: what the step costs, for the estimate. */
  readonly bytes: number;
}

/** A menu row's type and full name, looked up by its id. */
export interface CommandInfo {
  readonly type: string;
  readonly name: string;
}

/** What a step is recorded as. */
export interface StepName {
  readonly command: string;
  readonly type: string;
  readonly label: string;
}

/** The menu row for each tool, whose type and name a press on the canvas takes. */
const TOOL_ROWS: Readonly<Record<Tool, string | null>> = {
  pen: 'tool-pen',
  marker: 'tool-marker',
  copic: 'tool-copic',
  pencil: 'tool-pencil',
  eraser: 'tool-eraser',
  select: 'tool-select',
  point: 'tool-point',
  text: 'tool-text',
  image: null,
  rect: 'tool-rect',
  ellipse: 'tool-ellipse',
  curve: 'tool-curve',
  vector: 'tool-vector',
  bucket: 'tool-bucket',
  fill: 'tool-fill',
  eyedrop: 'tool-eyedrop',
  warp: 'tool-warp',
  'shape-eraser': 'tool-shape-eraser',
  'shape-stacker': 'tool-shape-stacker',
  split: 'tool-split',
  smear: 'tool-smear',
  liquify: 'tool-liquify',
};

/** A tool's name when the menu files do not give one. */
const TOOL_NAMES: Readonly<Record<Tool, string>> = {
  pen: 'Brush',
  marker: 'Marker',
  copic: 'Copic marker',
  pencil: 'Pencil',
  eraser: 'Eraser',
  select: 'Select',
  point: 'Direct Select',
  text: 'Text',
  image: 'Image',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  curve: 'Curve',
  vector: 'Vector Path',
  bucket: 'Paint Bucket',
  fill: 'Fill Color',
  eyedrop: 'Eyedropper',
  warp: 'Mesh Warp',
  'shape-eraser': 'Shape Eraser',
  'shape-stacker': 'Shape Stacker',
  split: 'Split',
  smear: 'Smear',
  liquify: 'Liquify',
};

/** The tools whose press draws a line, which the popup calls a stroke. */
const STROKE_TOOLS: ReadonlySet<string> = new Set(['pen', 'marker', 'copic', 'pencil', 'eraser']);

function isTool(name: string): name is Tool {
  return Object.prototype.hasOwnProperty.call(TOOL_NAMES, name);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a layer change is called in a sentence. */
const LAYER_WORDS: Readonly<Record<LayerChange['op'], string>> = {
  add: 'added',
  remove: 'removed',
  rename: 'renamed',
  reparent: 'regrouped',
  props: 'changed',
  restack: 'restacked',
};

/**
 * A step nothing named, named by what it changed: "Changed 2 marks",
 * "Renamed 1 layer", with the type the change is closest to.
 */
export function describeDiff(diff: SnapshotDiff): { type: string; label: string } {
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(`added ${count(diff.added.length, 'mark')}`);
  if (diff.changed.length > 0) parts.push(`changed ${count(diff.changed.length, 'mark')}`);
  if (diff.removed.length > 0) parts.push(`removed ${count(diff.removed.length, 'mark')}`);
  if (diff.order && parts.length === 0) parts.push('reordered the marks');
  const layers = new Map<LayerChange['op'], number>();
  for (const change of diff.layers) layers.set(change.op, (layers.get(change.op) ?? 0) + 1);
  for (const [op, n] of layers) parts.push(op === 'restack' ? 'restacked the layers' : `${LAYER_WORDS[op]} ${count(n, 'layer')}`);
  const sentence = parts.length > 0 ? parts.join(', ') : 'changed the page';
  const label = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  const marks = diff.added.length + diff.changed.length + diff.removed.length;
  let type = 'Draw:Modify:element';
  if (marks === 0 && diff.order === undefined) type = 'App:Modify:layer';
  else if (diff.added.length === marks && diff.order === undefined) type = 'Draw:Add:mark';
  else if (diff.removed.length === marks && diff.order === undefined) type = 'Composition:Subtract:element';
  return { type, label };
}

/**
 * The tool a step nothing named belongs to, when all it did was add marks
 * of one tool (and the layers they landed on): a text box committed when it
 * lost focus, long after the press that opened it.
 */
function toolOf(diff: SnapshotDiff): Tool | null {
  if (diff.added.length === 0 || diff.changed.length > 0 || diff.removed.length > 0) return null;
  if (diff.layers.some((change) => change.op !== 'add')) return null;
  const tools = new Set(diff.added.map((stroke) => stroke.tool));
  const [tool] = tools;
  return tools.size === 1 && isTool(tool) ? tool : null;
}

/**
 * Names a step: by its command's menu row, by the tool that made it, or by
 * what it changed. `lookup` finds a menu row's type and name by its id.
 */
export function describeStep(step: HistoryStep, lookup: (id: string) => CommandInfo | null): StepName {
  if (step.kind === 'undo' || step.kind === 'redo') {
    const row = lookup(step.kind);
    return { command: step.kind, type: row?.type ?? 'Composition:edit', label: row?.name ?? (step.kind === 'undo' ? 'Undo' : 'Redo') };
  }
  const inferred = toolOf(step.diff);
  const command = step.command ?? (inferred ? `tool:${inferred}` : null);
  if (command?.startsWith('tool:')) {
    const tool = command.slice('tool:'.length);
    if (isTool(tool)) {
      const id = TOOL_ROWS[tool];
      const row = id ? lookup(id) : null;
      const name = row?.name ?? TOOL_NAMES[tool];
      const type = row?.type ?? (step.diff.added.length > 0 ? 'Draw:Add:mark' : 'Draw:Modify:element');
      return { command, type, label: STROKE_TOOLS.has(tool) ? `${name} stroke` : name };
    }
  }
  if (command && !command.startsWith('tool:')) {
    const row = lookup(command);
    if (row) return { command, type: row.type, label: row.name };
  }
  return { command: 'unknown', ...describeDiff(step.diff) };
}

/** The steps recorded while Track History is on, the newest last, no more than the limit. */
export class HistoryTracker {
  private list: TrackedStep[] = [];
  private nextIndex = 1;
  private max: number;

  constructor(limit: number) {
    this.max = Math.max(1, Math.floor(limit));
  }

  get steps(): readonly TrackedStep[] {
    return this.list;
  }

  get count(): number {
    return this.list.length;
  }

  get limit(): number {
    return this.max;
  }

  /** Changes the limit, letting the oldest steps go when there are more than it keeps. */
  setLimit(limit: number): void {
    this.max = Math.max(1, Math.floor(limit));
    this.trim();
  }

  /** Records a closed step under its name; the oldest goes when the list is full. */
  pushStep(step: HistoryStep, name: StepName): TrackedStep {
    const tracked: TrackedStep = {
      index: this.nextIndex++,
      at: step.at,
      page: step.page,
      kind: step.kind,
      command: name.command,
      type: name.type,
      label: name.label,
      diff: step.diff,
      bytes: JSON.stringify(step.diff).length,
    };
    this.list.push(tracked);
    this.trim();
    return tracked;
  }

  /** Forgets every step: a new document is a new session, and its steps count from 1 again. */
  clear(): void {
    this.list = [];
    this.nextIndex = 1;
  }

  /** What the steps hold, as the length of their diffs written as JSON. */
  estimateBytes(): number {
    return this.list.reduce((sum, step) => sum + step.bytes, 0);
  }

  private trim(): void {
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
  }
}

/** An ISO time as the history's comments show it: the date and the minute, in this computer's time. */
export function localMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** A size in bytes, as a person reads it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The line under the History Limit in Verbose Settings: how many steps there are, and what they hold. */
export function historyUsage(stats: HistoryStats | null): string {
  if (!stats) return 'The drawing window has not said how much history it holds yet.';
  if (!stats.tracking) return 'Track History is off, so nothing is recorded.';
  if (stats.steps === 0) return `Nothing recorded yet. The last ${stats.limit} steps are kept.`;
  return `${stats.steps} of ${stats.limit} steps recorded, about ${formatBytes(stats.bytes)}.`;
}
