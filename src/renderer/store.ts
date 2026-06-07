/**
 * Renderer-side application store.
 *
 * Holds the open sketch book, the active page, tool settings, selection state,
 * sharpen configuration, dirty/saved status, and a bounded undo/redo history of
 * strokes for the active page. Emits a change event so the UI re-renders.
 */

import { basename } from '../core/paths.js';
import { createSketch, type SketchBook, type Stroke, type Tool } from '../core/types.js';
import { DEFAULT_SHARPEN_OPTIONS, type SharpenOptions } from '../sharpen/sharpen.js';

/** Snapshot of the current tool configuration. */
export interface ToolState {
  tool: Tool;
  color: string;
  width: number;
  /** When true, finished strokes are auto-sharpened on pen-up. */
  liveSharpen: boolean;
  /** Font size used by the text tool. */
  fontSize: number;
  /** Mirror axes for symmetry ("surprise") mode; 1 disables it. */
  symmetry: number;
  /** Tunable auto-sharpen settings. */
  sharpen: SharpenOptions;
}

const HISTORY_LIMIT = 100;

type Listener = () => void;

export class Store {
  book: SketchBook;
  filePath: string | null = null;
  activeIndex = 0;
  dirty = false;

  /** Ids of currently selected strokes (Select tool). */
  selectedIds = new Set<string>();

  tool: ToolState = {
    tool: 'pen',
    color: '#1f2328',
    width: 3,
    // Per request: Live Sharpen defaults OFF.
    liveSharpen: false,
    fontSize: 24,
    symmetry: 1,
    sharpen: { ...DEFAULT_SHARPEN_OPTIONS },
  };

  // Per-page history of stroke arrays (deep-enough copies for undo/redo).
  private undoStack: Stroke[][] = [];
  private redoStack: Stroke[][] = [];
  private listeners = new Set<Listener>();

  constructor(book: SketchBook, filePath: string | null = null) {
    this.book = book;
    this.filePath = filePath;
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
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.dirty = false;
    this.emit();
  }

  /** Pushes the current stroke list onto the undo stack before a mutation. */
  pushHistory(): void {
    this.undoStack.push(this.cloneStrokes(this.sketch.strokes));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private cloneStrokes(strokes: Stroke[]): Stroke[] {
    return strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) }));
  }

  /** Commits a finished stroke to the active page. */
  addStroke(stroke: Stroke): void {
    this.pushHistory();
    this.sketch.strokes.push(stroke);
    this.touch();
  }

  /** Commits several strokes to the active page as a single history step. */
  addStrokes(strokes: Stroke[]): void {
    if (strokes.length === 0) return;
    this.pushHistory();
    this.sketch.strokes.push(...strokes);
    this.touch();
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

  /** Clears the active page. */
  clear(): void {
    if (this.sketch.strokes.length === 0) return;
    this.pushHistory();
    this.sketch.strokes = [];
    this.selectedIds.clear();
    this.touch();
  }

  // ---- Selection -----------------------------------------------------------

  /** Sets the current selection set. */
  setSelection(ids: Iterable<string>): void {
    this.selectedIds = new Set(ids);
    this.emit();
  }

  /** Clears the current selection. */
  clearSelection(): void {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this.emit();
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
    }
    this.touch();
  }

  /** Deletes the selected strokes (with history). */
  deleteSelected(): void {
    if (this.selectedIds.size === 0) return;
    this.pushHistory();
    this.sketch.strokes = this.sketch.strokes.filter((s) => !this.selectedIds.has(s.id));
    this.selectedIds.clear();
    this.touch();
  }

  // ---- Undo / redo ---------------------------------------------------------

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.cloneStrokes(this.sketch.strokes));
    this.sketch.strokes = prev;
    this.selectedIds.clear();
    this.touch();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.cloneStrokes(this.sketch.strokes));
    this.sketch.strokes = next;
    this.selectedIds.clear();
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
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.touch();
  }

  /** Removes the active page (keeps at least one). */
  removePage(): void {
    if (this.book.sketches.length <= 1) return;
    this.book.sketches.splice(this.activeIndex, 1);
    this.activeIndex = Math.max(0, this.activeIndex - 1);
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.touch();
  }

  /** Switches to a page by index (clamped). Resets per-page history. */
  goToPage(index: number): void {
    const clamped = Math.max(0, Math.min(this.book.sketches.length - 1, index));
    if (clamped === this.activeIndex) return;
    this.activeIndex = clamped;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.emit();
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
