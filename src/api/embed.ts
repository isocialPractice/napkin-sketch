/**
 * Embeddable, framework-agnostic napkin-sketch editor.
 *
 * This is the plug-n-play surface used outside Electron — on a website, in a
 * WordPress block, or inside a VS Code webview. It has **no Node or Electron
 * dependencies**: give it a host element and it mounts a drawing canvas with
 * the same auto-sharpen engine as the desktop app.
 *
 * @example
 * ```ts
 * import { NapkinSketch } from 'napkin-sketch';
 * const editor = new NapkinSketch(document.getElementById('host')!, {
 *   liveSharpen: false,
 * });
 * editor.setTool('pen');
 * const png = editor.toDataURL('image/png');
 * ```
 */

import {
  createSketch,
  createSketchBook,
  type Sketch,
  type SketchBook,
  type Stroke,
  type Tool,
} from '../core/types.js';
import { parseSketchBook, serializeSketchBook } from '../core/serialize.js';
import { DEFAULT_SHARPEN_OPTIONS, sharpenStroke, sharpenStrokes, type SharpenOptions } from '../sharpen/sharpen.js';
import { Surface } from '../renderer/surface.js';

/** Options accepted when constructing a {@link NapkinSketch} editor. */
export interface NapkinOptions {
  /** Starting tool. Defaults to `'pen'`. */
  tool?: Tool;
  /** Ink color (any CSS color). Defaults to `'#1f2328'`. */
  color?: string;
  /** Stroke width in pixels. Defaults to `3`. */
  width?: number;
  /** Sharpen each stroke as it is finished. Defaults to `false`. */
  liveSharpen?: boolean;
  /** Overrides for the auto-sharpen algorithm. */
  sharpen?: Partial<SharpenOptions>;
  /** Optional existing document to load on mount. */
  sketch?: Sketch;
  /** Called whenever the drawing changes (debounce in your own handler if needed). */
  onChange?: (editor: NapkinSketch) => void;
}

const MAX_HISTORY = 100;

export class NapkinSketch {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly surface: Surface;
  private readonly resizeObserver: ResizeObserver;

  private sketch: Sketch;
  private tool: Tool;
  private color: string;
  private width: number;
  private liveSharpen: boolean;
  private sharpen: SharpenOptions;
  private readonly onChange?: (editor: NapkinSketch) => void;

  private live: Stroke | null = null;
  private drawing = false;
  private readonly undoStack: Stroke[][] = [];
  private readonly redoStack: Stroke[][] = [];

  constructor(host: HTMLElement, options: NapkinOptions = {}) {
    this.host = host;
    this.sketch = options.sketch ?? createSketch();
    this.tool = options.tool ?? 'pen';
    this.color = options.color ?? '#1f2328';
    this.width = options.width ?? 3;
    this.liveSharpen = options.liveSharpen ?? false;
    this.sharpen = { ...DEFAULT_SHARPEN_OPTIONS, ...options.sharpen };
    this.onChange = options.onChange;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'napkin-canvas';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    host.appendChild(this.canvas);

    this.surface = new Surface(this.canvas);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(host);
    this.fit();
  }

  // ---- Configuration ------------------------------------------------------

  /** Switches the active drawing tool. */
  setTool(tool: Tool): void {
    this.tool = tool;
  }

  /** Sets the ink color (any CSS color string). */
  setColor(color: string): void {
    this.color = color;
  }

  /** Sets the stroke width in pixels. */
  setWidth(width: number): void {
    this.width = Math.max(1, width);
  }

  /** Enables or disables sharpening each stroke as it is finished. */
  setLiveSharpen(enabled: boolean): void {
    this.liveSharpen = enabled;
  }

  /** Merges overrides into the auto-sharpen algorithm options. */
  setSharpenOptions(patch: Partial<SharpenOptions>): void {
    this.sharpen = { ...this.sharpen, ...patch };
  }

  // ---- Commands -----------------------------------------------------------

  /** Re-runs the auto-sharpen algorithm over every stroke on the page. */
  sharpenAll(): void {
    this.pushHistory();
    this.sketch.strokes = sharpenStrokes(this.sketch.strokes, this.sharpen);
    this.commit();
  }

  /** Removes every stroke from the page. */
  clear(): void {
    if (this.sketch.strokes.length === 0) return;
    this.pushHistory();
    this.sketch.strokes = [];
    this.commit();
  }

  /** Reverts the last change, if any. */
  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.sketch.strokes.map(cloneStroke));
    this.sketch.strokes = prev;
    this.commit();
  }

  /** Re-applies the last undone change, if any. */
  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.sketch.strokes.map(cloneStroke));
    this.sketch.strokes = next;
    this.commit();
  }

  // ---- Serialization ------------------------------------------------------

  /** Serializes the current drawing as a single-page sketch book JSON string. */
  toJSON(): string {
    const book = createSketchBook(this.sketch.name);
    book.sketches = [this.sketch];
    return serializeSketchBook(book);
  }

  /** Loads a sketch book JSON string, replacing the current drawing. */
  loadJSON(text: string): void {
    const book: SketchBook = parseSketchBook(text, this.sketch.name);
    this.sketch = book.sketches[0] ?? createSketch();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.fit();
  }

  /** Exports the current drawing as a data URL (PNG or JPEG). */
  toDataURL(type: 'image/png' | 'image/jpeg' = 'image/png'): string {
    const background = type === 'image/jpeg' ? this.sketch.background : undefined;
    return this.surface.toDataURL(type, background);
  }

  /** Detaches all listeners and removes the canvas from the host. */
  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.remove();
  }

  // ---- Internals ----------------------------------------------------------

  private fit(): void {
    const rect = this.host.getBoundingClientRect();
    this.surface.resize(Math.max(1, rect.width), Math.max(1, rect.height));
    this.render();
  }

  private render(): void {
    this.surface.render(this.sketch, this.live);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.tool === 'select' || this.tool === 'text') return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.drawing = true;
    const point = this.surface.toSketchPoint(event.clientX, event.clientY, event.pressure);
    this.live = {
      id: `live-${Date.now()}`,
      tool: this.tool,
      color: this.color,
      width: this.width,
      points: [point],
      sharpened: false,
    };
    this.render();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drawing || !this.live) return;
    event.preventDefault();
    this.live.points.push(this.surface.toSketchPoint(event.clientX, event.clientY, event.pressure));
    this.render();
  };

  private readonly onPointerUp = (): void => {
    if (!this.drawing || !this.live) return;
    this.drawing = false;
    let finished = this.live;
    this.live = null;
    if (finished.points.length === 0) {
      this.render();
      return;
    }
    if (this.liveSharpen && finished.tool !== 'eraser') {
      finished = sharpenStroke(finished, this.sharpen);
    }
    this.pushHistory();
    this.sketch.strokes.push(finished);
    this.commit();
  };

  private pushHistory(): void {
    this.undoStack.push(this.sketch.strokes.map(cloneStroke));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private commit(): void {
    this.sketch.updatedAt = new Date().toISOString();
    this.render();
    this.onChange?.(this);
  }
}

function cloneStroke(stroke: Stroke): Stroke {
  return { ...stroke, points: stroke.points.map((p) => ({ ...p })) };
}
