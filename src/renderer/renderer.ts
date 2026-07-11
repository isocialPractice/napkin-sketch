/**
 * Renderer entry point.
 *
 * Wires the toolbar, native-menu actions, pointer input (mouse / touch / pen
 * with pressure), the drawing {@link Surface}, the {@link Store}, the
 * auto-sharpen engine, the pages panel, the sharpen-settings panel, text
 * editing, selection/move, and symmetry mode into the running GUI.
 */

import {
  createId,
  createSketch,
  createSketchBook,
  DEFAULT_FONT_FAMILY,
  isImageStroke,
  isTextStroke,
  layerOf,
  type Point,
  type Sketch,
  type Stroke,
} from '../core/types.js';
import type { ExportFormat, ImageFormat, MenuAction } from '../core/ipc.js';
import type { LaunchOptions } from '../core/launch.js';
import { sketchesToPdf } from '../core/pdf.js';
import { defaultSettings, type AppSettings } from '../core/settings.js';
import { sharpenStroke } from '../sharpen/sharpen.js';
import { Surface, strokeBounds, type LiveStroke } from './surface.js';
import { Store } from './store.js';
import { importSvg } from './svg-import.js';

/** Looks up a required element by id, throwing a clear error if absent. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

/** Minimum drag distance (px) before a text-tool press becomes a box draw. */
const TEXT_DRAG_THRESHOLD = 10;

/**
 * Pinch deviation (px) tolerated before a two-finger gesture switches from
 * panning to zooming. Within +/-72px of the initial finger distance the gesture
 * pans; beyond it, the gesture zooms.
 */
const PAN_ZOOM_THRESHOLD = 72;

/** Stroke-width bounds (mirrors the width slider in the toolbar). */
const MIN_WIDTH = 1;
const MAX_WIDTH = 40;

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
  private layersOpen = false;

  // True while a layer-opacity slider drag is in progress (one history step).
  private layerOpacityDragging = false;

  // Application settings (loaded from the main process on start).
  private settings: AppSettings = defaultSettings();

  // Multi-touch pan/zoom gesture state.
  private pointers = new Map<number, { x: number; y: number }>();
  private gesturing = false;
  private gestureStartDist = 0;
  private lastGestureDist = 0;
  private lastCentroid: { x: number; y: number } | null = null;

  // Straight-line (Space + drag) state.
  private spaceDown = false;
  private straightStart: Point | null = null;
  private straightEnd: Point | null = null;

  // Quick-feature digit entry (Quick Width "W" / Quick Opacity "Q").
  private quickMode: 'width' | 'opacity' | null = null;
  private quickBuffer = '';
  private quickTimer: number | null = null;

  // Toolbar rearrange mode.
  private rearranging = false;

  // Captured toolbar group order, for top/side/both menu placement.
  private toolbarGroups: HTMLElement[] = [];

  // Auto-save interval handle.
  private autoSaveTimer: number | null = null;

  constructor() {
    this.canvas = el<HTMLCanvasElement>('canvas');
    this.surface = new Surface(this.canvas);
    this.surface.onImageLoad = () => this.scheduleRender();
    this.store = new Store(createSketchBook('untitled'));

    this.store.subscribe(() => this.scheduleRender());
    this.store.subscribe(() => this.syncUi());

    this.bindTools();
    this.bindFileActions();
    this.bindPages();
    this.bindLayers();
    this.bindSettings();
    this.bindPointer();
    this.bindKeyboard();
    this.bindResize();
    this.bindMenu();

    this.resizeSurface();
  }

  /** Loads launch options from the main process and prepares the initial book. */
  async start(): Promise<void> {
    // Load and apply persisted settings before opening a document.
    try {
      this.settings = await window.napkin.getSettings();
    } catch {
      // Standalone/dev fallback: keep default settings.
    }
    this.applySettings();
    try {
      window.napkin.onSettingsChanged((settings) => {
        this.settings = settings;
        this.applySettings();
      });
      window.napkin.onRearrangeMode((enabled) => this.toggleRearrange(enabled));
    } catch {
      // running outside Electron — settings sync unavailable
    }

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
        straightLine:
          this.straightStart && this.straightEnd
            ? {
                a: this.straightStart,
                b: this.straightEnd,
                color: this.store.tool.color,
                width: this.store.tool.width,
              }
            : undefined,
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
    // Track every pointer for two-finger pan/zoom detection.
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      this.beginGesture();
      return;
    }

    if (this.activePointerId !== null) return;
    const tool = this.store.tool.tool;
    const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);

    // Every mark-making tool needs an editable (visible, unlocked) layer.
    if (tool !== 'select' && !this.store.canDraw) {
      this.toast(
        this.store.activeLayer.locked
          ? `Layer "${this.store.activeLayer.name}" is locked.`
          : `Layer "${this.store.activeLayer.name}" is hidden.`,
      );
      return;
    }

    // Straight-line mode: Space held + single-pointer drag draws a straight line.
    if (this.spaceDown && tool !== 'select' && tool !== 'text') {
      e.preventDefault();
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.straightStart = pt;
      this.straightEnd = pt;
      this.scheduleRender();
      return;
    }

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
    const { color, width, opacity } = this.store.tool;
    this.live = {
      id: createId('st'),
      tool,
      color,
      width,
      points: [pt],
      // Preview on the layer the stroke will land on.
      layer: this.store.activeLayer.id,
      ...(opacity != null ? { opacity } : {}),
    };
    this.scheduleRender();
  }

  private onPointerMove(e: PointerEvent): void {
    // Keep the tracked pointer position current for gesture math.
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.gesturing) {
      this.updateGesture();
      return;
    }

    const tool = this.store.tool.tool;

    // Straight-line mode: update the dashed preview endpoint.
    if (this.straightStart !== null && this.activePointerId === e.pointerId) {
      this.straightEnd = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.scheduleRender();
      return;
    }

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
    // Release this pointer from gesture tracking first.
    this.pointers.delete(e.pointerId);
    if (this.gesturing) {
      if (this.pointers.size < 2) this.endGesture();
      return;
    }

    const tool = this.store.tool.tool;

    // Straight-line mode: commit a clean two-point line on release.
    if (this.straightStart !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      const a = this.straightStart;
      const b = this.straightEnd ?? a;
      this.straightStart = null;
      this.straightEnd = null;
      this.activePointerId = null;
      const { color, width, opacity } = this.store.tool;
      let finished: Stroke = {
        id: createId('st'),
        tool,
        color,
        width,
        points: [a, b],
        ...(opacity != null ? { opacity } : {}),
      };
      if (this.store.tool.liveSharpen && tool !== 'eraser') {
        finished = sharpenStroke(finished, this.store.tool.sharpen);
      }
      const extras = this.symmetryCopies(finished);
      this.store.addStrokes([finished, ...extras]);
      return;
    }

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

  // ---- Pan / zoom gestures -------------------------------------------------

  /** Enters two-finger gesture mode, discarding any in-progress interaction. */
  private beginGesture(): void {
    this.gesturing = true;
    // Abandon any single-pointer drawing or drag that was in progress so it
    // does not resume when the gesture ends.
    this.live = null;
    this.straightStart = null;
    this.straightEnd = null;
    this.dragging = false;
    this.dragLast = null;
    this.rubberBandStart = null;
    this.rubberBandBox = null;
    this.textDragStart = null;
    this.textDragLive = null;
    if (this.activePointerId !== null && this.canvas.hasPointerCapture(this.activePointerId)) {
      this.canvas.releasePointerCapture(this.activePointerId);
    }
    this.activePointerId = null;

    const pts = [...this.pointers.values()];
    this.gestureStartDist = distance(pts[0], pts[1]);
    this.lastGestureDist = this.gestureStartDist;
    this.lastCentroid = centroid(pts);
    this.scheduleRender();
  }

  /**
   * Updates pan/zoom from the current finger positions. Within +/-72px of the
   * initial finger distance the gesture pans; beyond that it zooms in or out
   * (toward the pinch centroid), scaled by the configured sensitivities.
   */
  private updateGesture(): void {
    if (this.pointers.size < 2) return;
    const pts = [...this.pointers.values()];
    const dist = distance(pts[0], pts[1]);
    const cen = centroid(pts);
    const delta = dist - this.gestureStartDist;

    if (Math.abs(delta) <= PAN_ZOOM_THRESHOLD) {
      if (this.lastCentroid) {
        const dx = (cen.x - this.lastCentroid.x) * this.settings.panSensitivity;
        const dy = (cen.y - this.lastCentroid.y) * this.settings.panSensitivity;
        this.surface.panBy(dx, dy);
      }
    } else {
      let ratio = this.lastGestureDist > 0 ? dist / this.lastGestureDist : 1;
      if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
      // Amplify the deviation from 1 by the zoom sensitivity.
      ratio = 1 + (ratio - 1) * this.settings.zoomSensitivity;
      if (this.settings.invertZoom && ratio !== 0) ratio = 1 / ratio;
      const rect = this.canvas.getBoundingClientRect();
      this.surface.zoomAt(ratio, cen.x - rect.left, cen.y - rect.top);
    }

    this.lastCentroid = cen;
    this.lastGestureDist = dist;
    this.scheduleRender();
  }

  /** Leaves gesture mode and clears any remaining tracked pointers. */
  private endGesture(): void {
    this.gesturing = false;
    this.lastCentroid = null;
    // Drop any lingering single pointer so it does not start a stray stroke.
    this.pointers.clear();
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

  /** True when a stroke's layer allows selecting and editing it. */
  private strokeEditable(stroke: Stroke): boolean {
    const layer = layerOf(this.store.sketch, stroke);
    return layer.visible && !layer.locked;
  }

  /** Returns the topmost editable stroke under a point, or null. */
  private hitTest(pt: Point): Stroke | null {
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!this.strokeEditable(s)) continue;
      if (isImageStroke(s)) {
        const b = strokeBounds(s);
        if (b && pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY) {
          return s;
        }
        continue;
      }
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
    if (!this.strokeEditable(stroke)) return false;
    if (isTextStroke(stroke) || isImageStroke(stroke)) {
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

    if (this.capsLockOn || this.spaceDown) {
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
    // Capture the toolbar group order once for top/side/both menu placement.
    const toolbar = el('toolbar');
    this.toolbarGroups = Array.from(toolbar.querySelectorAll<HTMLElement>(':scope > .group'));

    for (const t of ['pen', 'marker', 'eraser', 'select', 'text'] as const) {
      el(`tool-${t}`).addEventListener('click', () => {
        if (this.rearranging) return;
        this.store.setTool({ tool: t });
        this.updateCursor();
      });
    }

    this.rebuildSwatches();

    // Drag-to-reorder support (active only in rearrange mode).
    this.makeSortable(el('tool-group'), '.tool', () => this.persistToolOrder());
    this.makeSortable(el('swatches'), '.swatch', () => this.persistQuickColors());

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

    el('app-settings').addEventListener('click', () => {
      try {
        window.napkin.openSettings();
      } catch {
        this.toast('Settings are only available in the desktop app.');
      }
    });
  }

  /** (Re)builds the quick-access color swatches from the current settings. */
  private rebuildSwatches(): void {
    const swatches = el('swatches');
    swatches.textContent = '';
    for (const color of this.settings.quickColors) {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.style.setProperty('--swatch', color);
      btn.title = color;
      btn.setAttribute('aria-label', `Ink color ${color}`);
      btn.dataset.color = color;
      btn.draggable = this.rearranging;
      btn.addEventListener('click', () => {
        if (this.rearranging) return;
        this.store.setTool({ color });
        this.updateCursor();
      });
      swatches.appendChild(btn);
    }
  }

  // ---- Settings application ------------------------------------------------

  /** Applies every setting to the live UI (called on load and on change). */
  private applySettings(): void {
    this.rebuildSwatches();
    this.applyMenuPlacement();
    this.applyToolOrder();
    this.applyTheme();
    this.restartAutoSave();
    this.syncUi();
  }

  /** Moves toolbar groups between the top bar and the side rail. */
  private applyMenuPlacement(): void {
    const app = el('app');
    const toolbar = el('toolbar');
    const rail = el('side-rail');
    const placement = this.settings.menuPlacement;

    for (const group of this.toolbarGroups) {
      if (placement === 'side') rail.appendChild(group);
      else if (placement === 'both') (group.id === 'tool-group' ? rail : toolbar).appendChild(group);
      else toolbar.appendChild(group);
    }

    app.classList.remove('menu-top', 'menu-side', 'menu-both');
    app.classList.add(`menu-${placement}`);
    requestAnimationFrame(() => this.resizeSurface());
  }

  /** Reorders the tool buttons to match the saved tool order. */
  private applyToolOrder(): void {
    const group = el('tool-group');
    for (const id of this.settings.toolOrder) {
      const node = document.getElementById(id);
      if (node && node.parentElement === group) group.appendChild(node);
    }
  }

  /** Applies the chosen color theme to the document root. */
  private applyTheme(): void {
    document.documentElement.dataset.theme = this.settings.theme;
  }

  /** Restarts the auto-save interval based on the current setting. */
  private restartAutoSave(): void {
    if (this.autoSaveTimer !== null) {
      window.clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    const seconds = this.settings.autoSaveIntervalSec;
    if (seconds > 0) {
      this.autoSaveTimer = window.setInterval(() => {
        if (this.store.dirty && this.store.filePath) void this.saveBook(false);
      }, seconds * 1000);
    }
  }

  // ---- Rearrange mode ------------------------------------------------------

  /** Toggles drag-to-reorder mode for the toolbar tools and color swatches. */
  private toggleRearrange(force?: boolean): void {
    this.rearranging = force ?? !this.rearranging;
    el('app').classList.toggle('rearranging', this.rearranging);

    const draggables = [
      ...Array.from(el('tool-group').querySelectorAll<HTMLElement>('.tool')),
      ...Array.from(el('swatches').querySelectorAll<HTMLElement>('.swatch')),
    ];
    for (const node of draggables) node.draggable = this.rearranging;

    this.toast(
      this.rearranging
        ? 'Rearrange mode on: drag tools and colors to reorder.'
        : 'Rearrange mode off.',
    );
  }

  /** Persists the current DOM order of the tool buttons. */
  private persistToolOrder(): void {
    const order = Array.from(el('tool-group').querySelectorAll<HTMLElement>('.tool')).map((n) => n.id);
    void this.saveSettings({ toolOrder: order });
  }

  /** Persists the current DOM order of the quick-access colors. */
  private persistQuickColors(): void {
    const colors = Array.from(el('swatches').querySelectorAll<HTMLElement>('.swatch'))
      .map((n) => n.dataset.color ?? '')
      .filter(Boolean);
    void this.saveSettings({ quickColors: colors });
  }

  /** Sends a settings patch to the main process (no-op outside Electron). */
  private async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    try {
      this.settings = await window.napkin.updateSettings(patch);
    } catch {
      // Outside Electron: apply locally so the UI still reflects the change.
      this.settings = { ...this.settings, ...patch };
      this.applySettings();
    }
  }

  /**
   * Generic drag-to-reorder for a container's children, active only while in
   * rearrange mode. Calls `onReorder` after a drop so the order can be saved.
   */
  private makeSortable(container: HTMLElement, itemSelector: string, onReorder: () => void): void {
    let dragEl: HTMLElement | null = null;

    container.addEventListener('dragstart', (e) => {
      if (!this.rearranging) return;
      const target = (e.target as HTMLElement).closest(itemSelector) as HTMLElement | null;
      if (!target || !container.contains(target)) return;
      dragEl = target;
      target.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', target.id || 'item');
    });

    container.addEventListener('dragover', (e) => {
      if (!this.rearranging || !dragEl) return;
      e.preventDefault();
      const after = dragAfterElement(container, itemSelector, e.clientX, e.clientY);
      if (after === null) container.appendChild(dragEl);
      else if (after !== dragEl) container.insertBefore(dragEl, after);
    });

    container.addEventListener('drop', (e) => {
      if (this.rearranging) e.preventDefault();
    });

    container.addEventListener('dragend', () => {
      if (dragEl) dragEl.classList.remove('dragging');
      dragEl = null;
      if (this.rearranging) onReorder();
    });
  }

  // ---- Quick features (Quick Width "W" / Quick Opacity "Q") ----------------

  /** Begins capturing digits for a quick-feature value. */
  private startQuickEntry(mode: 'width' | 'opacity'): void {
    this.quickMode = mode;
    this.quickBuffer = '';
    this.restartQuickTimer();
    this.toast(mode === 'width' ? 'Quick width: type a number…' : 'Quick opacity: type a number…');
  }

  /** Adds a digit to the active quick-feature buffer and resets the timer. */
  private pushQuickDigit(digit: string): void {
    this.quickBuffer += digit;
    this.restartQuickTimer();
    const label = this.quickMode === 'width' ? 'Quick width' : 'Quick opacity';
    this.toast(`${label}: ${this.quickBuffer}`);
  }

  /** (Re)starts the idle timer that commits the quick-feature value. */
  private restartQuickTimer(): void {
    if (this.quickTimer !== null) window.clearTimeout(this.quickTimer);
    this.quickTimer = window.setTimeout(() => this.commitQuickEntry(), this.settings.quickTimerMs);
  }

  /** Applies the captured quick-feature value once the timer elapses. */
  private commitQuickEntry(): void {
    const mode = this.quickMode;
    const buffer = this.quickBuffer;
    this.quickMode = null;
    this.quickBuffer = '';
    if (this.quickTimer !== null) {
      window.clearTimeout(this.quickTimer);
      this.quickTimer = null;
    }
    if (!mode || buffer === '') return;

    if (mode === 'width') {
      const value = Number.parseInt(buffer, 10);
      if (Number.isNaN(value)) return;
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
      this.store.setTool({ width });
      this.updateCursor();
      this.toast(`Width set to ${width}px.`);
      return;
    }

    // Opacity: "0" means 100%, "00" means 0.1%, otherwise the typed percentage.
    let percent: number;
    if (buffer === '0') percent = 100;
    else if (buffer === '00') percent = 0.1;
    else {
      const value = Number.parseInt(buffer, 10);
      if (Number.isNaN(value)) return;
      percent = value;
    }
    percent = Math.min(100, Math.max(0.1, percent));
    this.store.setTool({ opacity: percent / 100 });
    this.toast(`Opacity set to ${percent}%.`);
  }

  // ---- Quick Access Colors (cycle with "C" / Shift+C) ----------------------

  /** Cycles the ink color through the quick-access colors (dir 1 = next, -1 = prev). */
  private cycleColor(dir: 1 | -1): void {
    const colors = this.settings.quickColors;
    if (colors.length === 0) return;
    const current = this.store.tool.color.toLowerCase();
    const index = colors.findIndex((c) => c.toLowerCase() === current);
    let next: number;
    if (index === -1) next = dir === 1 ? 0 : colors.length - 1;
    else next = (index + dir + colors.length) % colors.length;
    this.store.setTool({ color: colors[next] });
    this.updateCursor();
  }

  private sharpenAll(): void {
    // Locked and hidden layers keep their strokes untouched.
    const sharpened = this.store.sketch.strokes.map((s) =>
      !s.sharpened && this.strokeEditable(s) ? sharpenStroke(s, this.store.tool.sharpen) : s,
    );
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
    el('import').addEventListener('click', () => this.importFile());
    el('save').addEventListener('click', () => this.saveBook(false));
    el('save-as').addEventListener('click', () => this.saveBook(true));
  }

  private newSketch(): void {
    if (this.store.dirty && !confirm('Discard unsaved changes and start a new sketch?')) return;
    this.store.setBook(createSketchBook('untitled', 'unnamed'), null);
    this.surface.resetViewport();
    this.toast('Started a new sketch.');
  }

  private async openBook(): Promise<void> {
    const result = await window.napkin.openBook();
    if (result.cancelled) return;
    if (result.ok && result.book) {
      this.store.setBook(result.book, result.filePath ?? null);
      this.surface.resetViewport();
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

  private async exportPdf(): Promise<void> {
    const choice = await this.showExportDialog('pdf');
    if (choice === null) return;
    const sketches = choice === 'page' ? [this.store.sketch] : this.store.book.sketches;
    const prepared = await Promise.all(sketches.map((sk) => this.flattenImagesForPdf(sk)));
    const result = await window.napkin.savePdf(sketchesToPdf(prepared), this.store.displayName);
    if (result.cancelled) return;
    if (result.ok) {
      this.toast(choice === 'page' ? 'Exported PDF.' : `Exported ${prepared.length} pages as one PDF.`);
    } else {
      this.toast(result.error ?? 'Export failed.');
    }
  }

  /**
   * Returns a sketch whose image items all carry JPEG data URLs, converting
   * other formats via a canvas (the PDF writer embeds JPEG only). PNG
   * transparency is flattened onto the page background.
   */
  private async flattenImagesForPdf(sketch: Sketch): Promise<Sketch> {
    const needsWork = sketch.strokes.some(
      (s) => isImageStroke(s) && !/^data:image\/jpe?g[;,]/i.test(s.image ?? ''),
    );
    if (!needsWork) return sketch;

    const strokes = await Promise.all(
      sketch.strokes.map(async (s) => {
        if (!isImageStroke(s) || /^data:image\/jpe?g[;,]/i.test(s.image ?? '')) return s;
        try {
          const img = await loadImage(s.image!);
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return s;
          ctx.fillStyle = sketch.background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          return { ...s, image: canvas.toDataURL('image/jpeg', 0.92) };
        } catch {
          return s;
        }
      }),
    );
    return { ...sketch, strokes };
  }

  // ---- Import ----------------------------------------------------------------

  /** Imports an SVG (as layers), PDF (as pages), or PNG/JPEG (as an image item). */
  private async importFile(): Promise<void> {
    const result = await window.napkin.importFile();
    if (!result.ok) {
      if (!result.cancelled) this.toast(result.error ?? 'Import failed.');
      return;
    }

    if (result.kind === 'svg') {
      try {
        const imported = importSvg(result.text);
        this.store.addImportedLayers(imported.layers);
        this.renderLayers();
        this.toast(
          `Imported ${imported.layers.length} layer${imported.layers.length === 1 ? '' : 's'} from ${result.name}.svg.`,
        );
      } catch (err) {
        this.toast((err as Error).message);
      }
      return;
    }

    if (result.kind === 'pdf') {
      const pages = result.pages.map((page, index) => {
        const sketch = createSketch(
          result.pages.length === 1 ? result.name : `${result.name}-${index + 1}`,
        );
        sketch.width = Math.round(page.width);
        sketch.height = Math.round(page.height);
        if (page.background) sketch.background = page.background;
        sketch.strokes = page.strokes.map((s) => ({ ...s, layer: sketch.layers[0].id }));
        return sketch;
      });
      this.store.addImportedPages(pages);
      this.renderThumbnails();
      this.toast(`Imported ${pages.length} page${pages.length === 1 ? '' : 's'} from ${result.name}.pdf.`);
      return;
    }

    // Raster image: place on the active layer, scaled to fit the page.
    if (!this.store.canDraw) {
      this.toast(`Layer "${this.store.activeLayer.name}" is locked or hidden.`);
      return;
    }
    try {
      const img = await loadImage(result.dataUrl);
      const sketch = this.store.sketch;
      const scale = Math.min(
        1,
        (sketch.width * 0.9) / img.naturalWidth,
        (sketch.height * 0.9) / img.naturalHeight,
      );
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      this.store.addStroke({
        id: createId('im'),
        tool: 'image',
        color: this.store.tool.color,
        width: 1,
        points: [
          {
            x: Math.round((sketch.width - w) / 2),
            y: Math.round((sketch.height - h) / 2),
            pressure: 0.5,
          },
        ],
        image: result.dataUrl,
        imageWidth: w,
        imageHeight: h,
        sharpened: true,
      });
      this.toast(`Imported ${result.name} onto layer "${this.store.activeLayer.name}".`);
    } catch {
      this.toast('Could not decode the image file.');
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

  // ---- Layers ----------------------------------------------------------------

  private bindLayers(): void {
    el('layers-toggle').addEventListener('click', () => this.toggleLayers());
    el('add-layer').addEventListener('click', () => {
      this.store.addLayer();
      this.toast(`Added layer "${this.store.activeLayer.name}".`);
    });
    el('delete-layer').addEventListener('click', () => {
      if (this.store.sketch.layers.length <= 1) {
        this.toast('A sketch needs at least one layer.');
        return;
      }
      const layer = this.store.activeLayer;
      const strokes = this.store.sketch.strokes.filter((s) => s.layer === layer.id).length;
      if (strokes > 0 && !confirm(`Delete layer "${layer.name}" and its ${strokes} stroke(s)?`)) {
        return;
      }
      this.store.removeLayer(layer.id);
    });
    el('layer-up').addEventListener('click', () => this.store.moveLayer(this.store.activeLayer.id, 1));
    el('layer-down').addEventListener('click', () => this.store.moveLayer(this.store.activeLayer.id, -1));

    // Opacity drags collapse into one history step (pushed on the first tick).
    const opacity = el<HTMLInputElement>('layer-opacity');
    opacity.addEventListener('input', () => {
      const first = !this.layerOpacityDragging;
      this.layerOpacityDragging = true;
      this.store.setLayerProps(this.store.activeLayer.id, { opacity: Number(opacity.value) / 100 }, first);
      el('layer-opacity-value').textContent = `${opacity.value}%`;
    });
    opacity.addEventListener('change', () => {
      this.layerOpacityDragging = false;
      this.renderLayers();
    });
  }

  private toggleLayers(force?: boolean): void {
    this.layersOpen = force ?? !this.layersOpen;
    el('app').classList.toggle('layers-open', this.layersOpen);
    if (this.layersOpen) this.renderLayers();
    requestAnimationFrame(() => this.resizeSurface());
  }

  /** Rebuilds the layers panel (topmost layer first). */
  private renderLayers(): void {
    if (!this.layersOpen) return;
    const list = el('layers-list');
    list.textContent = '';
    const layers = this.store.sketch.layers;
    const active = this.store.activeLayer;

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.classList.toggle('is-active', layer.id === active.id);
      row.classList.toggle('is-hidden', !layer.visible);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(layer.id === active.id));

      const eye = document.createElement('button');
      eye.className = 'layer-toggle';
      eye.classList.toggle('is-off', !layer.visible);
      eye.type = 'button';
      eye.title = layer.visible ? 'Hide layer' : 'Show layer';
      eye.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
      eye.textContent = layer.visible ? '◉' : '○';
      eye.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.store.setLayerProps(layer.id, { visible: !layer.visible });
      });

      const lock = document.createElement('button');
      lock.className = 'layer-toggle';
      lock.classList.toggle('is-off', !layer.locked);
      lock.type = 'button';
      lock.title = layer.locked ? 'Unlock layer' : 'Lock layer';
      lock.setAttribute('aria-label', `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`);
      lock.textContent = layer.locked ? '🔒' : '🔓';
      lock.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.store.setLayerProps(layer.id, { locked: !layer.locked });
      });

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layer.name;
      name.title = `${layer.name} (double-click to rename)`;
      name.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        this.beginLayerRename(layer.id, row, name);
      });

      const badge = document.createElement('span');
      badge.className = 'layer-opacity-badge';
      badge.textContent = layer.opacity < 1 ? `${Math.round(layer.opacity * 100)}%` : '';

      row.append(eye, lock, name, badge);
      row.addEventListener('click', () => this.store.setActiveLayer(layer.id));
      list.appendChild(row);
    }

    const index = layers.findIndex((l) => l.id === active.id);
    el<HTMLInputElement>('layer-opacity').value = String(Math.round(active.opacity * 100));
    el('layer-opacity-value').textContent = `${Math.round(active.opacity * 100)}%`;
    el<HTMLButtonElement>('delete-layer').disabled = layers.length <= 1;
    el<HTMLButtonElement>('layer-up').disabled = index >= layers.length - 1;
    el<HTMLButtonElement>('layer-down').disabled = index <= 0;
  }

  /** Swaps a layer's name label for an inline rename input. */
  private beginLayerRename(id: string, row: HTMLElement, label: HTMLElement): void {
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = label.textContent ?? '';
    row.replaceChild(input, label);
    input.focus();
    input.select();

    const previous = label.textContent ?? '';
    const commit = (): void => {
      const name = input.value.trim();
      if (name && name !== previous) this.store.setLayerProps(id, { name });
      else this.renderLayers();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') input.blur();
      else if (ev.key === 'Escape') {
        input.value = label.textContent ?? '';
        input.blur();
      }
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
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
          if (isTextStroke(s) || isImageStroke(s)) continue;
          const layer = layerOf(sketch, s);
          if (!layer.visible) continue;
          tctx.globalAlpha = (s.opacity ?? (s.tool === 'marker' ? 0.38 : 1)) * layer.opacity;
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
      case 'import':
        void this.importFile();
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
      case 'export-pdf':
        void this.exportPdf();
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
      case 'toggle-layers':
        this.toggleLayers();
        break;
      case 'toggle-settings':
        this.toggleSettings();
        break;
      case 'open-app-settings':
        try {
          window.napkin.openSettings();
        } catch {
          this.toast('Settings are only available in the desktop app.');
        }
        break;
      case 'toggle-rearrange':
        this.toggleRearrange();
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

      // Space (held) arms straight-line mode for the next single-pointer drag.
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.updateCursor();
        }
        return;
      }

      // While a quick-feature is capturing, digits feed its buffer.
      if (this.quickMode && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        this.pushQuickDigit(e.key);
        return;
      }

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
      } else if (mod && key === 'l') {
        e.preventDefault();
        this.toggleLayers();
      } else if (mod && key === 'i') {
        e.preventDefault();
        void this.importFile();
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
      } else if (!mod && key === 'w') {
        this.startQuickEntry('width');
      } else if (!mod && key === 'q') {
        this.startQuickEntry('opacity');
      } else if (!mod && key === 'c') {
        this.cycleColor(e.shiftKey ? -1 : 1);
      }
    });

    window.addEventListener('keyup', (e) => {
      const newCapsLock = e.getModifierState('CapsLock');
      if (newCapsLock !== this.capsLockOn) {
        this.capsLockOn = newCapsLock;
        this.updateCursor();
      }
      if (e.key === ' ' || e.code === 'Space') {
        this.spaceDown = false;
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

    // Keep the layers panel current, but never mid-slider-drag (the rebuild
    // would interrupt the pointer capture).
    if (this.layersOpen && !this.layerOpacityDragging) this.renderLayers();
  }

  private toast(message: string): void {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }
}

/** Loads an image from a data URL, resolving once it is decoded. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}

/** Euclidean distance between two screen points. */
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint (centroid) of a set of screen points. */
function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Returns the child element (matching `selector`) that a dragged item should be
 * inserted before, based on the pointer position, or null to append at the end.
 * Uses whichever axis (horizontal or vertical) the items are laid out along.
 */
function dragAfterElement(
  container: HTMLElement,
  selector: string,
  x: number,
  y: number,
): HTMLElement | null {
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (n) => !n.classList.contains('dragging'),
  );
  if (items.length === 0) return null;

  // Detect layout axis from the first two items' positions.
  const vertical =
    items.length > 1 &&
    Math.abs(items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top) >
      Math.abs(items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().left);

  let closest: { offset: number; element: HTMLElement } | null = null;
  for (const item of items) {
    const box = item.getBoundingClientRect();
    const offset = vertical ? y - (box.top + box.height / 2) : x - (box.left + box.width / 2);
    if (offset < 0 && (closest === null || offset > closest.offset)) {
      closest = { offset, element: item };
    }
  }
  return closest?.element ?? null;
}

/** Distance from a point to a line segment a-b. */
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
