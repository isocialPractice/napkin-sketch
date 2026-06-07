/**
 * Renderer entry point.
 *
 * Wires the toolbar, native-menu actions, pointer input (mouse / touch / pen
 * with pressure), the drawing {@link Surface}, the {@link Store}, the
 * auto-sharpen engine, the pages panel, the sharpen-settings panel, text
 * editing, selection/move, and symmetry mode into the running GUI.
 */

import { createId, createSketchBook, DEFAULT_FONT_FAMILY, isTextStroke, type Point, type Stroke } from '../core/types.js';
import type { ExportFormat, ImageFormat, MenuAction } from '../core/ipc.js';
import type { LaunchOptions } from '../core/launch.js';
import { sharpenStroke, sharpenStrokes } from '../sharpen/sharpen.js';
import { Surface, strokeBounds, type LiveStroke } from './surface.js';
import { Store } from './store.js';

/** Looks up a required element by id, throwing a clear error if absent. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

/** Ink colors offered to the user (drawing content, not UI chrome). */
const PALETTE = ['#1f2328', '#27496d', '#2e7d5b', '#b3541e', '#7a4988', '#c0392b'];

/** Minimum drag distance (px) before a text-tool press becomes a box draw. */
const TEXT_DRAG_THRESHOLD = 10;

class App {
  private readonly surface: Surface;
  private readonly store: Store;
  private readonly canvas: HTMLCanvasElement;

  private live: LiveStroke | null = null;
  private activePointerId: number | null = null;
  private renderQueued = false;
  private toastTimer: number | null = null;

  // Select-tool drag state (moving selected strokes).
  private dragging = false;
  private dragLast: Point | null = null;

  // Rubber-band selection state.
  private rubberBandStart: Point | null = null;
  private rubberBandBox: { x1: number; y1: number; x2: number; y2: number } | null = null;

  // Text-tool drag-to-draw state.
  private textDragStart: Point | null = null;
  private textDragLive: { x1: number; y1: number; x2: number; y2: number } | null = null;

  // Text editor overlay state.
  private editingId: string | null = null;

  // CapsLock tracking.
  private capsLockOn = false;

  private pagesOpen = false;

  constructor() {
    this.canvas = el<HTMLCanvasElement>('canvas');
    this.surface = new Surface(this.canvas);
    this.store = new Store(createSketchBook('untitled'));

    this.store.subscribe(() => this.scheduleRender());
    this.store.subscribe(() => this.syncUi());

    this.bindTools();
    this.bindFileActions();
    this.bindPages();
    this.bindSettings();
    this.bindPointer();
    this.bindKeyboard();
    this.bindResize();
    this.bindMenu();

    this.resizeSurface();
  }

  /** Loads launch options from the main process and prepares the initial book. */
  async start(): Promise<void> {
    let launch: LaunchOptions = { mode: 'new', sketchName: 'unnamed' };
    try {
      launch = await window.napkin.getLaunch();
    } catch {
      // Standalone/dev fallback: keep the default new book.
    }

    if (launch.mode === 'book' && launch.filePath) {
      const result = await window.napkin.loadBook(launch.filePath);
      if (result.ok && result.book) {
        this.store.setBook(result.book, result.filePath ?? launch.filePath);
      } else {
        this.toast(result.error ?? 'Could not open sketch book.');
      }
    } else {
      const name = launch.sketchName || 'unnamed';
      this.store.setBook(createSketchBook(name, name), null);
    }

    this.syncUi();
    this.scheduleRender();
  }

  // ---- Rendering -----------------------------------------------------------

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.surface.render(this.store.sketch, this.live, {
        selectedIds: this.store.selectedIds,
        symmetry: this.store.tool.symmetry,
        liveTextBox: this.textDragLive ?? undefined,
        selectBox: this.rubberBandBox ?? undefined,
      });
    });
  }

  private resizeSurface(): void {
    const stage = el<HTMLElement>('stage');
    const rect = stage.getBoundingClientRect();
    this.surface.resize(rect.width, rect.height);
    this.store.sketch.width = Math.round(rect.width);
    this.store.sketch.height = Math.round(rect.height);
    this.scheduleRender();
  }

  // ---- Pointer / drawing ---------------------------------------------------

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    c.addEventListener('pointerleave', (e) => {
      if (this.activePointerId !== null) this.onPointerUp(e);
    });
    c.style.touchAction = 'none';
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.activePointerId !== null) return;
    const tool = this.store.tool.tool;
    const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);

    if (tool === 'text') {
      e.preventDefault();
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.textDragStart = pt;
      this.textDragLive = null;
      return;
    }

    if (tool === 'select') {
      this.beginSelect(e, pt);
      return;
    }

    e.preventDefault();
    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    const { color, width } = this.store.tool;
    this.live = { id: createId('st'), tool, color, width, points: [pt] };
    this.scheduleRender();
  }

  private onPointerMove(e: PointerEvent): void {
    const tool = this.store.tool.tool;

    // Text-tool: track drag to define a text-box rectangle.
    if (tool === 'text' && this.textDragStart !== null && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      const dx = pt.x - this.textDragStart.x;
      const dy = pt.y - this.textDragStart.y;
      if (Math.abs(dx) > TEXT_DRAG_THRESHOLD || Math.abs(dy) > TEXT_DRAG_THRESHOLD) {
        this.textDragLive = { x1: this.textDragStart.x, y1: this.textDragStart.y, x2: pt.x, y2: pt.y };
        this.scheduleRender();
      }
      return;
    }

    // Select: rubber-band drag over empty area.
    if (tool === 'select' && this.rubberBandStart !== null && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.rubberBandBox = { x1: this.rubberBandStart.x, y1: this.rubberBandStart.y, x2: pt.x, y2: pt.y };
      this.scheduleRender();
      return;
    }

    // Select: drag to move selected strokes.
    if (tool === 'select' && this.dragging) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      if (this.dragLast) {
        this.store.nudgeSelected(pt.x - this.dragLast.x, pt.y - this.dragLast.y);
      }
      this.dragLast = pt;
      return;
    }

    if (this.activePointerId !== e.pointerId || !this.live) return;
    e.preventDefault();

    const events =
      typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];

    for (const ev of events) {
      const pt = this.surface.toSketchPoint(ev.clientX, ev.clientY, ev.pressure);
      const last = this.live.points[this.live.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.75) {
        this.live.points.push(pt);
      }
    }
    this.scheduleRender();
  }

  private onPointerUp(e: PointerEvent): void {
    const tool = this.store.tool.tool;

    // Text-tool: open editor (sized to drag, or auto-size for a click).
    if (tool === 'text' && this.textDragStart !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      const start = this.textDragStart;
      const live = this.textDragLive;
      this.textDragStart = null;
      this.textDragLive = null;
      this.activePointerId = null;
      this.scheduleRender();

      if (live && Math.abs(live.x2 - live.x1) > TEXT_DRAG_THRESHOLD) {
        // Drag-to-draw: open text editor constrained to the drawn rectangle.
        const boxW = Math.abs(live.x2 - live.x1);
        const anchorX = Math.min(live.x1, live.x2);
        const anchorY = Math.min(live.y1, live.y2);
        const rect = this.canvas.getBoundingClientRect();
        this.openTextEditor(
          { x: anchorX, y: anchorY, pressure: 0.5 },
          anchorX + rect.left,
          anchorY + rect.top,
          undefined,
          boxW,
        );
      } else {
        // Plain click: auto-sizing text box.
        this.openTextEditor(start, e.clientX, e.clientY);
      }
      return;
    }

    // Select: complete rubber-band selection.
    if (tool === 'select' && this.rubberBandStart !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      const box = this.rubberBandBox;
      this.rubberBandStart = null;
      this.rubberBandBox = null;
      this.activePointerId = null;
      if (box && (Math.abs(box.x2 - box.x1) > 2 || Math.abs(box.y2 - box.y1) > 2)) {
        const minX = Math.min(box.x1, box.x2);
        const maxX = Math.max(box.x1, box.x2);
        const minY = Math.min(box.y1, box.y2);
        const maxY = Math.max(box.y1, box.y2);
        const ids = this.store.sketch.strokes
          .filter((s) => this.strokeIntersectsBox(s, minX, minY, maxX, maxY))
          .map((s) => s.id);
        this.store.setSelection(ids);
      }
      this.scheduleRender();
      return;
    }

    // Select: stop moving selected strokes.
    if (tool === 'select' && this.dragging) {
      this.dragging = false;
      this.dragLast = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      if (this.activePointerId === e.pointerId) this.activePointerId = null;
      return;
    }

    if (this.activePointerId !== e.pointerId || !this.live) return;
    e.preventDefault();
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    let finished: Stroke = { ...this.live, points: this.live.points };
    this.live = null;
    this.activePointerId = null;

    if (this.store.tool.liveSharpen && finished.tool !== 'eraser') {
      finished = sharpenStroke(finished, this.store.tool.sharpen);
    }

    const extras = this.symmetryCopies(finished);
    this.store.addStrokes([finished, ...extras]);
  }

  /** Generates rotational symmetry copies of a finished stroke (mandala mode). */
  private symmetryCopies(stroke: Stroke): Stroke[] {
    const k = this.store.tool.symmetry;
    if (k <= 1 || stroke.tool === 'eraser') return [];
    const cx = this.surface.width / 2;
    const cy = this.surface.height / 2;
    const copies: Stroke[] = [];
    for (let i = 1; i < k; i++) {
      const angle = (Math.PI * 2 * i) / k;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      copies.push({
        ...stroke,
        id: createId('st'),
        points: stroke.points.map((p) => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          return { ...p, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
        }),
      });
    }
    return copies;
  }

  // ---- Select tool ---------------------------------------------------------

  private beginSelect(e: PointerEvent, pt: Point): void {
    const hit = this.hitTest(pt);
    if (hit) {
      if (!this.store.selectedIds.has(hit.id)) this.store.setSelection([hit.id]);
      this.dragging = true;
      this.dragLast = pt;
      this.store.pushHistory();
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
    } else {
      // Start rubber-band selection over empty canvas.
      this.store.clearSelection();
      this.rubberBandStart = pt;
      this.rubberBandBox = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
      this.scheduleRender();
    }
  }

  /** Returns the topmost stroke under a point, or null. */
  private hitTest(pt: Point): Stroke | null {
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (isTextStroke(s)) {
        const b = strokeBounds(s, (t) => this.surface.measureText(t));
        if (b && pt.x >= b.minX - 6 && pt.x <= b.maxX + 6 && pt.y >= b.minY - 6 && pt.y <= b.maxY + 6) {
          return s;
        }
        continue;
      }
      const pad = Math.max(8, s.width * 1.5);
      for (let j = 1; j < s.points.length; j++) {
        if (distToSegment(pt, s.points[j - 1], s.points[j]) <= pad) return s;
      }
      if (s.points.length === 1 && Math.hypot(pt.x - s.points[0].x, pt.y - s.points[0].y) <= pad) {
        return s;
      }
    }
    return null;
  }

  /** Returns true if any point of `stroke` falls inside the given AABB. */
  private strokeIntersectsBox(
    stroke: Stroke,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): boolean {
    if (isTextStroke(stroke)) {
      const b = strokeBounds(stroke, (t) => this.surface.measureText(t));
      if (!b) return false;
      return b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
    }
    return stroke.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
  }

  // ---- Text tool -----------------------------------------------------------

  /**
   * Opens a textarea overlay for text input.
   * @param anchor Sketch-space position for the text anchor point.
   * @param clientX Client X for overlay positioning (used for new text items).
   * @param clientY Client Y for overlay positioning.
   * @param existing Existing text stroke being edited (if any).
   * @param boxWidth When > 0, creates a fixed-width text box drawn by dragging.
   */
  private openTextEditor(
    anchor: Point,
    clientX: number,
    clientY: number,
    existing?: Stroke,
    boxWidth = 0,
  ): void {
    this.closeTextEditor();
    const stage = el<HTMLElement>('stage');
    const rect = this.canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const editor = document.createElement('textarea');
    editor.className = 'text-editor';
    editor.value = existing?.text ?? '';

    const size = existing?.fontSize ?? this.store.tool.fontSize;
    const posX = existing ? existing.points[0].x + rect.left - stageRect.left : clientX - stageRect.left;
    const posY = existing ? existing.points[0].y + rect.top - stageRect.top : clientY - stageRect.top;
    editor.style.left = `${posX}px`;
    editor.style.top = `${posY}px`;
    editor.style.font = `${size}px ${DEFAULT_FONT_FAMILY}`;
    editor.style.color = existing?.color ?? this.store.tool.color;
    editor.style.lineHeight = '1.25';

    if (boxWidth > 0) {
      editor.style.width = `${boxWidth}px`;
      editor.style.minWidth = `${boxWidth}px`;
      editor.style.resize = 'vertical';
    } else {
      editor.style.width = 'auto';
      editor.style.minWidth = '120px';
      editor.style.resize = 'both';
    }

    stage.appendChild(editor);
    editor.focus();
    this.editingId = existing?.id ?? null;

    // Auto-height as the user types (for both box and auto-sizing modes).
    const autoHeight = (): void => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    };
    editor.addEventListener('input', autoHeight);
    // Trigger once to set initial height.
    requestAnimationFrame(autoHeight);

    const commit = (): void => {
      const text = editor.value.trim();
      editor.remove();
      if (!text) {
        if (this.editingId) {
          this.store.setSelection([this.editingId]);
          this.store.deleteSelected();
        }
        this.editingId = null;
        return;
      }
      const effectiveAnchor = existing ? existing.points[0] : anchor;
      const item: Stroke = {
        id: this.editingId ?? createId('tx'),
        tool: 'text',
        color: existing?.color ?? this.store.tool.color,
        width: 1,
        points: [effectiveAnchor],
        text,
        fontSize: size,
        fontFamily: DEFAULT_FONT_FAMILY,
        textBoxWidth: boxWidth > 0 ? boxWidth : undefined,
        sharpened: true,
      };
      if (this.editingId) {
        this.store.pushHistory();
        this.store.replaceStroke(this.editingId, item);
      } else {
        this.store.addStroke(item);
      }
      this.editingId = null;
    };

    editor.addEventListener('blur', commit);
    editor.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        editor.blur();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        editor.value = existing?.text ?? '';
        editor.blur();
      }
    });
  }

  private closeTextEditor(): void {
    const existing = document.querySelector<HTMLTextAreaElement>('.text-editor');
    existing?.blur();
  }

  // ---- Cursor --------------------------------------------------------------

  private updateCursor(): void {
    const tool = this.store.tool.tool;

    if (this.capsLockOn) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (tool === 'select') {
      this.canvas.style.cursor = 'default';
      return;
    }
    if (tool === 'text') {
      this.canvas.style.cursor = 'text';
      return;
    }
    if (tool === 'eraser') {
      this.canvas.style.cursor = 'cell';
      return;
    }

    // Drawing tools: circle cursor sized to the current stroke width.
    const { url, hotspotX, hotspotY } = Surface.makeCursorDataUrl(
      this.store.tool.width,
      this.store.tool.color,
    );
    if (url) {
      this.canvas.style.cursor = `url('${url}') ${hotspotX} ${hotspotY}, crosshair`;
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  // ---- Toolbar -------------------------------------------------------------

  private bindTools(): void {
    for (const t of ['pen', 'marker', 'eraser', 'select', 'text'] as const) {
      el(`tool-${t}`).addEventListener('click', () => {
        this.store.setTool({ tool: t });
        this.updateCursor();
      });
    }

    const swatches = el('swatches');
    for (const color of PALETTE) {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.style.setProperty('--swatch', color);
      btn.title = color;
      btn.setAttribute('aria-label', `Ink color ${color}`);
      btn.dataset.color = color;
      btn.addEventListener('click', () => {
        this.store.setTool({ color });
        this.updateCursor();
      });
      swatches.appendChild(btn);
    }

    const custom = el<HTMLInputElement>('color-custom');
    custom.addEventListener('input', () => {
      this.store.setTool({ color: custom.value });
      this.updateCursor();
    });

    const width = el<HTMLInputElement>('width');
    width.addEventListener('input', () => {
      this.store.setTool({ width: Number(width.value) });
      this.updateCursor();
    });

    el('sharpen-all').addEventListener('click', () => this.sharpenAll());
    el('undo').addEventListener('click', () => this.store.undo());
    el('redo').addEventListener('click', () => this.store.redo());
    el('clear').addEventListener('click', () => this.store.clear());
  }

  private sharpenAll(): void {
    const sharpened = sharpenStrokes(this.store.sketch.strokes, this.store.tool.sharpen);
    this.store.replaceAllStrokes(sharpened);
    this.toast('Sharpened all strokes on this page.');
  }

  // ---- Sharpen settings panel ---------------------------------------------

  private bindSettings(): void {
    el('settings-toggle').addEventListener('click', () => this.toggleSettings());
    el('settings-close').addEventListener('click', () => this.toggleSettings(false));

    el<HTMLInputElement>('live-sharpen').addEventListener('change', (e) =>
      this.store.setTool({ liveSharpen: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('set-wobble').addEventListener('input', (e) =>
      this.store.setSharpen({ wobble: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('set-simplify').addEventListener('input', (e) =>
      this.store.setSharpen({ simplifyEpsilon: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('set-circle').addEventListener('input', (e) =>
      this.store.setSharpen({ circleTolerance: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('set-taper').addEventListener('change', (e) =>
      this.store.setSharpen({ taperEnds: (e.target as HTMLInputElement).checked }),
    );
    el<HTMLInputElement>('set-symmetry').addEventListener('input', (e) =>
      this.store.setTool({ symmetry: Number((e.target as HTMLInputElement).value) }),
    );
    el<HTMLInputElement>('set-fontsize').addEventListener('input', (e) =>
      this.store.setTool({ fontSize: Number((e.target as HTMLInputElement).value) }),
    );
  }

  private toggleSettings(force?: boolean): void {
    const panel = el('settings-panel');
    const open = force ?? panel.classList.contains('is-hidden');
    panel.classList.toggle('is-hidden', !open);
  }

  // ---- File actions --------------------------------------------------------

  private bindFileActions(): void {
    el('new-sketch').addEventListener('click', () => this.newSketch());
    el('open').addEventListener('click', () => this.openBook());
    el('save').addEventListener('click', () => this.saveBook(false));
    el('save-as').addEventListener('click', () => this.saveBook(true));
  }

  private newSketch(): void {
    if (this.store.dirty && !confirm('Discard unsaved changes and start a new sketch?')) return;
    this.store.setBook(createSketchBook('untitled', 'unnamed'), null);
    this.toast('Started a new sketch.');
  }

  private async openBook(): Promise<void> {
    const result = await window.napkin.openBook();
    if (result.cancelled) return;
    if (result.ok && result.book) {
      this.store.setBook(result.book, result.filePath ?? null);
      this.toast(`Opened ${this.store.displayName}.`);
    } else {
      this.toast(result.error ?? 'Could not open sketch book.');
    }
  }

  private async saveBook(forceDialog: boolean): Promise<void> {
    const target = forceDialog ? null : this.store.filePath;
    const result = forceDialog
      ? await window.napkin.saveBookAs(this.store.book)
      : await window.napkin.saveBook(target, this.store.book);
    if (result.cancelled) return;
    if (result.ok && result.filePath) {
      this.store.markSaved(result.filePath);
      this.toast(`Saved ${this.store.displayName}.`);
    } else {
      this.toast(result.error ?? 'Could not save sketch book.');
    }
  }

  // ---- Export --------------------------------------------------------------

  /**
   * Shows the export dialog and returns the user's choice.
   * Resolves to 'page' (current page only), 'all' (every page), or null (cancelled).
   */
  private showExportDialog(format: ExportFormat): Promise<'page' | 'all' | null> {
    return new Promise((resolve) => {
      const dlg = el('export-dialog');
      el('export-fmt').textContent = format.toUpperCase();
      el('export-page-label').textContent = String(this.store.activeIndex + 1);
      dlg.classList.remove('is-hidden');

      const close = (choice: 'page' | 'all' | null): void => {
        dlg.classList.add('is-hidden');
        // Remove listeners to avoid double-firing.
        el('export-page-btn').removeEventListener('click', onPage);
        el('export-all-btn').removeEventListener('click', onAll);
        el('export-cancel-btn').removeEventListener('click', onCancel);
        resolve(choice);
      };

      const onPage = (): void => close('page');
      const onAll = (): void => close('all');
      const onCancel = (): void => close(null);

      el('export-page-btn').addEventListener('click', onPage, { once: true });
      el('export-all-btn').addEventListener('click', onAll, { once: true });
      el('export-cancel-btn').addEventListener('click', onCancel, { once: true });
    });
  }

  private async exportRaster(format: ImageFormat): Promise<void> {
    const choice = await this.showExportDialog(format);
    if (choice === null) return;
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';

    if (choice === 'page') {
      const dataUrl = this.surface.toDataURL(mime, this.store.sketch.background);
      const result = await window.napkin.saveImage(format, dataUrl, this.store.displayName);
      if (result.cancelled) return;
      if (result.ok) this.toast(`Exported ${format.toUpperCase()}.`);
      else this.toast(result.error ?? 'Export failed.');
    } else {
      const contents = this.store.book.sketches.map((sk) =>
        Surface.renderSketchToDataURL(sk, mime),
      );
      const result = await window.napkin.saveImages(format, contents, this.store.displayName);
      if (result.cancelled) return;
      if (result.ok) this.toast(`Exported ${result.filePaths?.length ?? 0} pages as ${format.toUpperCase()}.`);
      else this.toast(result.error ?? 'Export failed.');
    }
  }

  private async exportSvg(): Promise<void> {
    const choice = await this.showExportDialog('svg');
    if (choice === null) return;

    if (choice === 'page') {
      const svgContent = Surface.toSVG(this.store.sketch);
      const result = await window.napkin.saveSvg(svgContent, this.store.displayName);
      if (result.cancelled) return;
      if (result.ok) this.toast('Exported SVG.');
      else this.toast(result.error ?? 'Export failed.');
    } else {
      const contents = this.store.book.sketches.map((sk) => Surface.toSVG(sk));
      const result = await window.napkin.saveImages('svg', contents, this.store.displayName);
      if (result.cancelled) return;
      if (result.ok) this.toast(`Exported ${result.filePaths?.length ?? 0} pages as SVG.`);
      else this.toast(result.error ?? 'Export failed.');
    }
  }

  // ---- Pages ---------------------------------------------------------------

  private bindPages(): void {
    el('prev-page').addEventListener('click', () => this.turnPage(this.store.activeIndex - 1));
    el('next-page').addEventListener('click', () => this.turnPage(this.store.activeIndex + 1));
    el('new-page').addEventListener('click', () => {
      this.store.addPage('unnamed');
      this.renderThumbnails();
      this.toast('Added a new page.');
    });
    el('pages-toggle').addEventListener('click', () => this.togglePages());
    el('delete-page').addEventListener('click', () => {
      this.store.removePage();
      this.renderThumbnails();
    });
  }

  private togglePages(force?: boolean): void {
    this.pagesOpen = force ?? !this.pagesOpen;
    el('app').classList.toggle('pages-open', this.pagesOpen);
    if (this.pagesOpen) this.renderThumbnails();
    requestAnimationFrame(() => this.resizeSurface());
  }

  /** Switches pages with a brief page-turn animation. */
  private turnPage(index: number): void {
    const clamped = Math.max(0, Math.min(this.store.book.sketches.length - 1, index));
    if (clamped === this.store.activeIndex) return;
    const forward = clamped > this.store.activeIndex;
    const stageEl = el('canvas-wrap');
    stageEl.classList.remove('turn-next', 'turn-prev');
    // Force reflow so the animation restarts each time.
    void stageEl.offsetWidth;
    stageEl.classList.add(forward ? 'turn-next' : 'turn-prev');
    this.store.goToPage(clamped);
    this.renderThumbnails();
    window.setTimeout(() => stageEl.classList.remove('turn-next', 'turn-prev'), 360);
  }

  /** Renders the thumbnail strip for the pages panel. */
  private renderThumbnails(): void {
    if (!this.pagesOpen) return;
    const list = el('thumbs');
    list.textContent = '';
    this.store.book.sketches.forEach((sketch, index) => {
      const item = document.createElement('button');
      item.className = 'thumb';
      item.classList.toggle('is-active', index === this.store.activeIndex);
      item.setAttribute('aria-label', `Go to page ${index + 1}`);

      const c = document.createElement('canvas');
      const tw = 150;
      const th = Math.round((sketch.height / sketch.width) * tw) || 96;
      c.width = tw;
      c.height = th;
      const tctx = c.getContext('2d');
      if (tctx) {
        tctx.fillStyle = sketch.background;
        tctx.fillRect(0, 0, tw, th);
        const scale = tw / sketch.width;
        tctx.scale(scale, scale);
        tctx.lineCap = 'round';
        tctx.lineJoin = 'round';
        for (const s of sketch.strokes) {
          if (isTextStroke(s)) continue;
          tctx.globalAlpha = s.tool === 'marker' ? 0.38 : 1;
          tctx.strokeStyle = s.tool === 'eraser' ? sketch.background : s.color;
          tctx.lineWidth = s.width;
          tctx.beginPath();
          s.points.forEach((p, i) => (i ? tctx.lineTo(p.x, p.y) : tctx.moveTo(p.x, p.y)));
          tctx.stroke();
        }
      }
      item.appendChild(c);
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = `${index + 1}`;
      item.appendChild(label);
      item.addEventListener('click', () => this.turnPage(index));
      list.appendChild(item);
    });
  }

  // ---- Native menu ---------------------------------------------------------

  private bindMenu(): void {
    try {
      window.napkin.onMenuAction((action: MenuAction) => this.handleMenu(action));
    } catch {
      // running outside Electron — menus unavailable
    }
  }

  private handleMenu(action: MenuAction): void {
    switch (action) {
      case 'new':
        this.newSketch();
        break;
      case 'open':
        void this.openBook();
        break;
      case 'save':
        void this.saveBook(false);
        break;
      case 'save-as':
        void this.saveBook(true);
        break;
      case 'export-png':
        void this.exportRaster('png');
        break;
      case 'export-jpeg':
        void this.exportRaster('jpeg');
        break;
      case 'export-svg':
        void this.exportSvg();
        break;
      case 'undo':
        this.store.undo();
        break;
      case 'redo':
        this.store.redo();
        break;
      case 'toggle-pages':
        this.togglePages();
        break;
      case 'toggle-settings':
        this.toggleSettings();
        break;
    }
  }

  // ---- Keyboard shortcuts --------------------------------------------------

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Track CapsLock state.
      const newCapsLock = e.getModifierState('CapsLock');
      if (newCapsLock !== this.capsLockOn) {
        this.capsLockOn = newCapsLock;
        this.updateCursor();
      }

      if (document.activeElement instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.store.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.store.redo();
      } else if (mod && key === 's') {
        e.preventDefault();
        void this.saveBook(e.shiftKey);
      } else if (mod && key === 'b') {
        e.preventDefault();
        this.togglePages();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.store.selectedIds.size > 0) {
        e.preventDefault();
        this.store.deleteSelected();
      } else if (!mod && key === 'p') {
        this.store.setTool({ tool: 'pen' });
        this.updateCursor();
      } else if (!mod && key === 'm') {
        this.store.setTool({ tool: 'marker' });
        this.updateCursor();
      } else if (!mod && key === 'e') {
        this.store.setTool({ tool: 'eraser' });
        this.updateCursor();
      } else if (!mod && key === 's') {
        this.store.setTool({ tool: 'select' });
        this.updateCursor();
      } else if (!mod && key === 't') {
        this.store.setTool({ tool: 'text' });
        this.updateCursor();
      } else if (!mod && key === 'h') {
        this.sharpenAll();
      }
    });

    window.addEventListener('keyup', (e) => {
      const newCapsLock = e.getModifierState('CapsLock');
      if (newCapsLock !== this.capsLockOn) {
        this.capsLockOn = newCapsLock;
        this.updateCursor();
      }
    });
  }

  private bindResize(): void {
    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.resizeSurface());
    });
  }

  // ---- UI sync -------------------------------------------------------------

  private syncUi(): void {
    const { tool, color, width, liveSharpen, sharpen, symmetry, fontSize } = this.store.tool;

    for (const id of ['tool-pen', 'tool-marker', 'tool-eraser', 'tool-select', 'tool-text']) {
      el(id).classList.toggle('is-active', id === `tool-${tool}`);
    }
    this.canvas.dataset.tool = tool;
    this.updateCursor();

    for (const node of Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch'))) {
      node.classList.toggle('is-active', node.dataset.color === color);
    }

    el<HTMLInputElement>('width').value = String(width);
    el('width-value').textContent = `${width}px`;

    el<HTMLInputElement>('live-sharpen').checked = liveSharpen;
    el<HTMLInputElement>('set-wobble').value = String(sharpen.wobble);
    el<HTMLInputElement>('set-simplify').value = String(sharpen.simplifyEpsilon);
    el<HTMLInputElement>('set-circle').value = String(sharpen.circleTolerance);
    el<HTMLInputElement>('set-taper').checked = sharpen.taperEnds;
    el<HTMLInputElement>('set-symmetry').value = String(symmetry);
    el('set-symmetry-value').textContent = symmetry > 1 ? `${symmetry}×` : 'off';
    el<HTMLInputElement>('set-fontsize').value = String(fontSize);

    const undoBtn = el<HTMLButtonElement>('undo');
    const redoBtn = el<HTMLButtonElement>('redo');
    undoBtn.disabled = !this.store.canUndo;
    redoBtn.disabled = !this.store.canRedo;

    const total = this.store.book.sketches.length;
    el('page-indicator').textContent = `Page ${this.store.activeIndex + 1} / ${total}`;
    el<HTMLButtonElement>('prev-page').disabled = this.store.activeIndex === 0;
    el<HTMLButtonElement>('next-page').disabled = this.store.activeIndex >= total - 1;
    el<HTMLButtonElement>('delete-page').disabled = total <= 1;

    const name = this.store.displayName;
    const dirtyMark = this.store.dirty ? ' •' : '';
    el('status-name').textContent = name;
    el('status-dirty').textContent = this.store.dirty ? 'Unsaved changes' : 'Saved';
    el('status-dirty').classList.toggle('is-dirty', this.store.dirty);

    const title = `${name}${dirtyMark} — napkin-sketch`;
    try {
      window.napkin.setTitle(title);
    } catch {
      document.title = title;
    }

    if (this.pagesOpen) {
      for (const node of Array.from(document.querySelectorAll<HTMLButtonElement>('.thumb'))) {
        const idx = Array.from(node.parentElement?.children ?? []).indexOf(node);
        node.classList.toggle('is-active', idx === this.store.activeIndex);
      }
    }
  }

  private toast(message: string): void {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }
}

/** Distance from a point to a line segment a–b. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  void app.start();
});
