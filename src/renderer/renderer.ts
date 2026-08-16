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
  defaultOpacityFor,
  descendantLayerIds,
  effectiveLayer,
  isClosedStroke,
  isImageStroke,
  isTextStroke,
  layerOf,
  type Layer,
  type Point,
  type Sketch,
  type Stroke,
  type Tool,
  type VectorAnchor,
} from '../core/types.js';
import type { ExportFormat, ImageFormat, ImportFileResult, MenuAction } from '../core/ipc.js';
import type { LaunchOptions } from '../core/launch.js';
import { sketchesToPdf } from '../core/pdf.js';
import { defaultSettings, type AppSettings, type QuickModifier } from '../core/settings.js';
import {
  catmullRom,
  cubicBezierPoints,
  quarterArcCubic,
  roundedCornerAnchors,
  simplify,
  splitCubicBezier,
} from '../sharpen/geometry.js';
import { sharpenStroke } from '../sharpen/sharpen.js';
import { Surface, strokeBounds, type LiveStroke } from './surface.js';
import { Store, type ImportedLayerNode, type ToolState } from './store.js';
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

/** Degrees the quick curve's apex swings clockwise on each `Shift` press. */
const QUICK_CURVE_APEX_STEP = 90;

/**
 * Direct Select tangent handles: how far along the path (screen px) a lone
 * selected anchor's handles reach, and the multiple of that reach over which
 * a handle drag's bend fades back into the untouched remainder of the stroke.
 */
const HANDLE_REACH_PX = 42;
const HANDLE_FALLOFF = 2.5;

/** Stroke-width bounds (mirrors the width slider in the toolbar). */
const MIN_WIDTH = 1;
const MAX_WIDTH = 40;

/** Builds a CSS cursor value from inline SVG with a hotspot and fallback. */
function svgCursor(svg: string, x: number, y: number, fallback = 'default'): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

/**
 * Custom pointers. The Select tool carries the filled black arrow and Direct
 * Select the white one, mirroring the selection/direct-selection convention
 * of vector editors; the stemless arrowhead marks the Vector Path tool's
 * Alt (handle-toggle) mode, and the +/- badges show where a click will add
 * an anchor to the edited path or remove one from it.
 */
const CURSOR_ARROW_BLACK = svgCursor(
  `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><path d='M1 1 L1 14.5 L4.6 11.4 L6.8 16 L9.3 14.9 L7.1 10.5 L11.8 10.5 Z' fill='#1f2328' stroke='#ffffff' stroke-width='1.2' stroke-linejoin='round'/></svg>`,
  1,
  1,
);
const CURSOR_ARROW_WHITE = svgCursor(
  `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><path d='M1 1 L1 14.5 L4.6 11.4 L6.8 16 L9.3 14.9 L7.1 10.5 L11.8 10.5 Z' fill='#ffffff' stroke='#1f2328' stroke-width='1.2' stroke-linejoin='round'/></svg>`,
  1,
  1,
);
const CURSOR_ARROWHEAD = svgCursor(
  `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M1.5 1.5 L4 13.5 L12.5 6.5 Z' fill='#ffffff' stroke='#1f2328' stroke-width='1.2' stroke-linejoin='round'/></svg>`,
  1,
  1,
);
const CURSOR_ADD_POINT = svgCursor(
  `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='6.5' fill='#ffffff' stroke='#1f2328'/><path d='M8 4.5 V11.5 M4.5 8 H11.5' stroke='#1f2328' stroke-width='1.6'/></svg>`,
  8,
  8,
  'copy',
);
const CURSOR_REMOVE_POINT = svgCursor(
  `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='6.5' fill='#ffffff' stroke='#1f2328'/><path d='M4.5 8 H11.5' stroke='#1f2328' stroke-width='1.6'/></svg>`,
  8,
  8,
  'no-drop',
);

/** KeyboardEvent.key value produced by each configurable quick-feature modifier. */
const MODIFIER_EVENT_KEYS: Record<QuickModifier, string> = {
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
};

/** All tool buttons (main group + Sketch Support group). */
const TOOL_IDS = [
  'tool-pen',
  'tool-marker',
  'tool-copic',
  'tool-eraser',
  'tool-select',
  'tool-point',
  'tool-text',
  'tool-rect',
  'tool-ellipse',
  'tool-curve',
  'tool-vector',
  'tool-bucket',
  'tool-fill',
  'tool-eyedrop',
] as const;

/** An endpoint-snap hit: the endpoint position plus the stroke it ends. */
interface SnapHit {
  x: number;
  y: number;
  strokeId: string;
  at: 'start' | 'end';
}

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

  // Straight-line (Space + drag) state. `straightRaw` is the unconstrained
  // pointer position, kept so pressing or releasing Shift mid-drag (which
  // toggles the strict horizontal/vertical constraint) can recompute the end
  // without waiting for the pointer to move.
  private spaceDown = false;
  private straightStart: Point | null = null;
  private straightEnd: Point | null = null;
  private straightRaw: Point | null = null;

  // Select-tool Space + drag pan state (screen-space pointer tracking).
  private panDragging = false;
  private panLast: { x: number; y: number } | null = null;

  // Endpoint snap (hold Shift while drawing): the endpoint the pointer will
  // snap to, shown as a ring while within the configured sensitivity.
  private snapTarget: SnapHit | null = null;
  // Snap hit recorded when the stroke started (for Join stroke on snap).
  private startSnapHit: SnapHit | null = null;

  // Shape tools (Rectangle / Ellipse): drag origin while a shape is drawn.
  private shapeStart: Point | null = null;

  // Curve tool: chord endpoints; after the chord drag is released the tool
  // enters the bend phase (move to bow the curve, click to commit). The bend
  // control point is kept so the commit can carry the curve's editable
  // two-anchor Bézier structure.
  private curveA: Point | null = null;
  private curveB: Point | null = null;
  private curveBending = false;
  private curveControl: { x: number; y: number } | null = null;
  // Stroke tool the pending curve commits as (current tool in quick mode).
  private curveTool: Tool = 'pen';
  // Curve variant (tool flyout): the default snaps the chord's start and end
  // to nearby stroke endpoints; 'free' keeps the ends where the pointer is.
  private curveVariant: 'endpoints' | 'free' = 'endpoints';
  // Quick curve (Ctrl + Space + drag): true while the quarter-arc drag runs.
  // Unlike the Curve tool it has no bend phase — the drag start and the point
  // released at draw the whole arc, so pointer-up commits it. `Alt` swaps the
  // quarter ellipse for a quarter circle and can be pressed or let go mid-drag.
  // Each `Shift` press swings the arc's apex a further step clockwise
  // (degrees); both ends stay where the drag put them.
  private quickCurve = false;
  private quickCurveUniform = false;
  private quickCurveApex = 0;

  // Direct Select (A): stroke whose anchor points are shown, which anchors
  // are selected (Shift adds), whether the whole path is selected, and the
  // in-progress drag. Freehand strokes edit raw samples ('anchor' moves
  // them, 'handle' is the tangent-handle bend); strokes with Bézier
  // structure edit their few vector anchors instead ('vanchor' moves one,
  // 'vhIn'/'vhOut' steer its curvature handles), so a curve shows two or
  // three points rather than every sample.
  private anchorStrokeId: string | null = null;
  private selectedAnchors = new Set<number>();
  private pathSelected = false;
  private anchorDragKind: 'anchor' | 'handle' | 'path' | 'vanchor' | 'vhIn' | 'vhOut' | null =
    null;
  private anchorDragLast: Point | null = null;
  // Tangent-handle drag, captured at grab time. The handle pivots the curve
  // around the anchor: the span between anchor and handle turns rigidly and
  // the effect fades to nothing over the falloff window, so each move is
  // recomputed from these original positions (never accumulated).
  private handleDrag: {
    anchor: Point;
    tip: { x: number; y: number };
    points: Array<{ index: number; x: number; y: number; weight: number }>;
  } | null = null;

  // Vector Path (B): the pen-tool path being placed. Each anchor holds its
  // position plus optional Bézier direction handles — `hOut` steers the
  // segment leaving it, `hIn` the segment arriving (a drag on placement pulls
  // both out symmetrically; a plain click leaves them unset for a corner).
  // `vectorDragging` is true while that placement drag runs, and
  // `vectorHover` previews the rubber-band segment to the pointer.
  private vectorAnchors: VectorAnchor[] = [];
  private vectorDragging = false;
  private vectorHover: Point | null = null;

  // Vector Path edit mode: a committed vector stroke whose anchors are being
  // reworked. Plain clicks add (on a segment) or remove (on an anchor)
  // points; Ctrl grabs a single anchor, handle, or the corner-rounding
  // target; Alt toggles an anchor's direction handles. Every change
  // regenerates the stroke's sampled points from the working anchors.
  private vectorEditId: string | null = null;
  private vectorEditAnchors: VectorAnchor[] = [];
  private vectorEditClosed = false;
  private vectorEditSelected: number | null = null;
  private vectorEditDrag:
    | { kind: 'anchor' | 'hIn' | 'hOut'; index: number; last: Point }
    | { kind: 'round'; index: number; base: VectorAnchor[] }
    | null = null;
  // Live Ctrl/Alt tracking: Ctrl shows the corner-rounding target and the
  // Select pointer in vector edit mode, Alt the handle-toggle arrowhead.
  private ctrlDown = false;
  private altDown = false;
  // Last hover position inside a vector edit, so modifier presses can
  // restyle the pointer without waiting for the mouse to move.
  private vectorEditHoverPt: Point | null = null;

  // Sharpen Selection: original geometry of the strokes being previewed in
  // the dialog, keyed by stroke id, so Cancel restores them exactly and
  // Apply can record one clean history step from the pre-dialog state.
  private sharpenPreview: Map<
    string,
    { points: Point[]; vector?: Stroke['vector'] }
  > | null = null;

  // Eyedropper: true while Ctrl temporarily switched to the select tool.
  private eyedropTempSelect = false;

  // Quick-feature digit entry (Quick Width "W" / Quick Opacity "Q").
  private quickMode: 'width' | 'opacity' | null = null;
  private quickBuffer = '';
  private quickTimer: number | null = null;

  // Quick Zoom ("Z" then a digit): armed while waiting for the digit that
  // sets the zoom level (9 => 90%, 0 => 100%).
  private quickZoomArmed = false;
  private quickZoomTimer: number | null = null;

  // Copic quick nib-rotate (hold Ctrl → Alt/Shift rotate the broad nib).
  private nibHoldDown = false;
  private nibHoldTimer: number | null = null;
  private nibRotateActive = false;
  private nibRotateDir: 1 | -1 | 0 = 0;
  private nibRotateRaf = 0;
  private nibRotateLastTs = 0;
  // Tool and width in use before quick nib-rotate switched to the Copic
  // marker (the width is doubled while the mode is active so the nib preview
  // reads clearly); both are restored when the mode ends.
  private lastUsedTool: Tool | null = null;
  private lastUsedWidth: number | null = null;
  private nibModeWidth: number | null = null;

  // Toolbar rearrange mode.
  private rearranging = false;

  // Layers panel UI state: collapsed group rows and the row being dragged.
  private collapsedGroups = new Set<string>();
  private layerDragId: string | null = null;

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
    this.bindVectorOptions();
    this.bindSharpenSelection();
    this.bindContextMenus();
    this.bindPageSettings();
    this.bindPanelResize();

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

    if (launch.importFiles && launch.importFiles.length > 0) {
      await this.importLaunchFiles(launch.importFiles, launch.importGrid === true);
    }

    // Opening defaults: the layers panel is in view and Select is the active
    // tool, so a fresh session starts in arrange-and-inspect mode.
    this.toggleLayers(true);
    this.store.setTool({ tool: 'select' });

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
            : this.curveA && this.curveB && !this.curveBending && !this.quickCurve
              ? {
                  a: this.curveA,
                  b: this.curveB,
                  color: this.store.tool.color,
                  width: this.store.tool.width,
                }
              : undefined,
        snapTarget: this.snapTarget ?? undefined,
        anchors: this.anchorOverlay() ?? undefined,
      });
    });
  }

  /** Anchor points to overlay while the Direct Select tool edits a stroke. */
  private anchorOverlay(): {
    points: Point[];
    selected?: number[];
    handles?: Point[];
    handleOrigin?: number;
    pathSelected?: boolean;
    outline?: Point[];
    roundTarget?: Point;
  } | null {
    // Vector Path edit mode: every anchor of the edited path, the selected
    // one with its direction handles, plus the corner-rounding target while
    // Ctrl is held.
    if (this.store.tool.tool === 'vector' && this.vectorEditId) {
      const sel = this.vectorEditSelected;
      const anchor = sel !== null ? this.vectorEditAnchors[sel] : undefined;
      const handles: Point[] = [];
      if (anchor?.hIn) handles.push({ ...anchor.hIn, pressure: 0.5 });
      if (anchor?.hOut) handles.push({ ...anchor.hOut, pressure: 0.5 });
      const target = this.ctrlDown && sel !== null ? this.roundTargetPos(sel) : null;
      return {
        points: this.vectorEditAnchors.map((a) => ({ ...a.p, pressure: 0.5 })),
        selected: sel !== null ? [sel] : [],
        handles,
        handleOrigin: sel ?? undefined,
        ...(target ? { roundTarget: target } : {}),
      };
    }

    // Vector Path: show the placed anchors, the newest one selected, with its
    // pulled-out direction handles.
    if (this.store.tool.tool === 'vector' && this.vectorAnchors.length > 0) {
      const lastIndex = this.vectorAnchors.length - 1;
      const last = this.vectorAnchors[lastIndex];
      const handles: Point[] = [];
      if (last.hOut) handles.push({ ...last.hOut, pressure: 0.5 });
      if (last.hIn) handles.push({ ...last.hIn, pressure: 0.5 });
      return {
        points: this.vectorAnchors.map((a) => a.p),
        selected: [lastIndex],
        handles,
        handleOrigin: lastIndex,
      };
    }

    if (this.store.tool.tool !== 'point' || !this.anchorStrokeId) return null;
    const stroke = this.store.sketch.strokes.find((s) => s.id === this.anchorStrokeId);
    if (!stroke || isTextStroke(stroke) || isImageStroke(stroke)) return null;

    // A stroke with Bézier structure shows its few anchors — the curvature
    // lives in the selected anchor's handles — instead of every sample.
    if (stroke.vector) {
      const anchors = stroke.vector.anchors;
      let handleOrigin: number | undefined;
      const handles: Point[] = [];
      if (this.selectedAnchors.size === 1) {
        handleOrigin = [...this.selectedAnchors][0];
        const anchor = anchors[handleOrigin];
        if (anchor?.hIn) handles.push({ ...anchor.hIn, pressure: 0.5 });
        if (anchor?.hOut) handles.push({ ...anchor.hOut, pressure: 0.5 });
      }
      return {
        points: anchors.map((a) => ({ ...a.p, pressure: 0.5 })),
        selected: [...this.selectedAnchors],
        handles,
        handleOrigin,
        pathSelected: this.pathSelected,
        // The whole-path outline follows the sampled curve, not the chord
        // between the two anchors.
        outline: stroke.points,
      };
    }

    // A single selected anchor exposes its tangent handles.
    let handleOrigin: number | undefined;
    let handles: Point[] = [];
    if (this.selectedAnchors.size === 1) {
      handleOrigin = [...this.selectedAnchors][0];
      handles = this.anchorHandleTips(stroke, handleOrigin).map((h) => h.tip);
    }
    return {
      points: stroke.points,
      selected: [...this.selectedAnchors],
      handles,
      handleOrigin,
      pathSelected: this.pathSelected,
    };
  }

  /**
   * Tangent-handle tips for an anchor: one per side of the stroke that has
   * any length, sitting on the path at the handle reach (a fixed screen
   * distance, so zoom changes the bend's grain, not the handle's size). On a
   * dense freehand stroke the raw neighbour samples sit a pixel or two from
   * the anchor — far too close to see or grab — so the tips reach out along
   * the path instead, like a vector editor's direction handles.
   */
  private anchorHandleTips(
    stroke: Stroke,
    origin: number,
  ): Array<{ side: -1 | 1; tip: Point; reach: number }> {
    const reach = HANDLE_REACH_PX / this.surface.getViewport().zoom;
    const tips: Array<{ side: -1 | 1; tip: Point; reach: number }> = [];
    for (const side of [-1, 1] as const) {
      const walked = this.walkPath(stroke.points, origin, side, reach);
      if (walked && walked.distance > 1) {
        tips.push({ side, tip: walked.point, reach: walked.distance });
      }
    }
    return tips;
  }

  /**
   * Walks the polyline from `origin` in `side` direction until `target` path
   * distance, returning the (interpolated) point there — or the side's last
   * point when the side is shorter. Null when the side has no points.
   */
  private walkPath(
    points: Point[],
    origin: number,
    side: -1 | 1,
    target: number,
  ): { point: Point; distance: number } | null {
    let travelled = 0;
    let prev = points[origin];
    if (!prev) return null;
    for (let i = origin + side; i >= 0 && i < points.length; i += side) {
      const curr = points[i];
      const seg = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      if (travelled + seg >= target && seg > 0) {
        const t = (target - travelled) / seg;
        return {
          point: {
            x: prev.x + (curr.x - prev.x) * t,
            y: prev.y + (curr.y - prev.y) * t,
            pressure: 0.5,
          },
          distance: target,
        };
      }
      travelled += seg;
      prev = curr;
    }
    if (prev === points[origin]) return null;
    return { point: { ...prev }, distance: travelled };
  }

  private resizeSurface(): void {
    const stage = el<HTMLElement>('stage');
    const rect = stage.getBoundingClientRect();
    this.surface.resize(rect.width, rect.height);
    // Endless pages track the window; sized pages keep their pinned
    // dimensions (set in Page Settings) whatever the window does.
    if (this.store.sketch.sizeMode !== 'sized') {
      this.store.sketch.width = Math.round(rect.width);
      this.store.sketch.height = Math.round(rect.height);
    }
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
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Vector Path: a double-click finishes the open path where it stands.
    c.addEventListener('dblclick', () => {
      if (this.store.tool.tool === 'vector' && this.vectorAnchors.length >= 2) {
        this.commitVectorPath(false);
      }
    });
    c.style.touchAction = 'none';
  }

  /**
   * Mouse-wheel navigation. Alt + wheel zooms toward the pointer; Ctrl+Shift +
   * wheel pans horizontally (scroll down = left, up = right); a plain wheel
   * pans vertically (scroll up = up, down = down). Zoom and pan directions
   * are configurable; plain wheel events over the canvas are consumed.
   */
  private onWheel(e: WheelEvent): void {
    if (e.deltaY === 0) return;
    const scrollUp = e.deltaY < 0;

    if (e.altKey) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      let zoomIn = scrollUp;
      if (this.settings.invertScrollZoom) zoomIn = !zoomIn;
      const factor = zoomIn ? 1.1 : 1 / 1.1;
      this.surface.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      this.scheduleRender();
      return;
    }

    // Pan: Ctrl+Shift scrolls horizontally, otherwise vertically.
    e.preventDefault();
    const step = 60 * this.settings.panSensitivity;
    const sign = (this.settings.invertScrollPan ? -1 : 1) * (scrollUp ? 1 : -1);
    if (e.ctrlKey && e.shiftKey) {
      this.surface.panBy(step * sign, 0);
    } else {
      this.surface.panBy(0, step * sign);
    }
    this.scheduleRender();
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

    // Eyedropper reads the canvas; it needs no editable layer.
    if (tool === 'eyedrop') {
      e.preventDefault();
      this.applyEyedrop(e);
      return;
    }

    // Direct Select: Space + drag pans (as with the Select tool); otherwise
    // grab an anchor point, or pick a stroke to edit.
    if (tool === 'point') {
      e.preventDefault();
      if (this.spaceDown) {
        this.beginPanDrag(e);
        return;
      }
      this.beginPointSelect(e, pt);
      return;
    }

    // Fill Color: fill the selection, or the element under the click.
    if (tool === 'fill') {
      e.preventDefault();
      this.applyFillColor(pt);
      return;
    }

    // Every mark-making tool needs an editable (visible, unlocked) layer.
    if (tool !== 'select' && !this.store.canDraw) {
      const layer = this.store.activeLayer;
      const effective = effectiveLayer(this.store.sketch, layer);
      if (layer.group && effective.visible && !effective.locked) {
        // A group holds no marks itself: drop a fresh layer inside it, tell
        // the user, and let the stroke land there instead of being swallowed.
        const created = this.store.addLayerInGroup(layer.id);
        this.toast(`"${layer.name}" is a group — added layer "${created.name}" inside it to draw.`);
      } else {
        const kind = layer.group ? 'Group' : 'Layer';
        this.toast(
          effective.locked
            ? `${kind} "${layer.name}" is locked.`
            : `${kind} "${layer.name}" is hidden.`,
        );
        return;
      }
    }

    // Curve tool, bend phase: a click commits the pending curve.
    if (this.curveBending) {
      e.preventDefault();
      this.commitCurve();
      return;
    }

    // Curve chord: the Curve tool, or the Ctrl+Space quick feature
    // (Shift+Ctrl+Space additionally snaps the chord ends).
    if (
      (tool === 'curve' || (this.spaceDown && e.ctrlKey && tool !== 'select' && tool !== 'text')) &&
      tool !== 'bucket'
    ) {
      e.preventDefault();
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.curveTool = drawingToolOf(tool);
      // The default Curve variant starts (and ends) at nearby stroke endpoints.
      const snapEnds = e.shiftKey || (tool === 'curve' && this.curveVariant === 'endpoints');
      const start = this.applyEndpointSnap(pt, snapEnds, this.curveTool);
      this.startSnapHit = this.snapTarget;
      this.curveA = start;
      this.curveB = start;
      this.curveBending = false;
      // The quick curve draws the whole arc in one gesture. The Curve tool
      // keeps its two-phase chord-and-bend flow for a mouse, which can hover
      // between clicks; pen and touch input cannot, so they take the quick
      // curve's single-gesture flow instead.
      this.quickCurve = tool !== 'curve' || e.pointerType !== 'mouse';
      this.quickCurveUniform = this.quickCurve && e.altKey;
      this.quickCurveApex = 0;
      this.scheduleRender();
      return;
    }

    // Vector Path: each press places an anchor (drag pulls out its Bézier
    // handles; a plain click leaves a corner). Pressing on the first anchor
    // closes the path and commits it. Space defers to the quick straight
    // line, as with every drawing tool.
    if (tool === 'vector' && !this.spaceDown) {
      e.preventDefault();
      // Editing a committed path claims every press; with no pending path, a
      // press on an existing vector stroke picks it up for editing instead
      // of starting a new path.
      if (this.vectorEditId) {
        this.vectorEditPointerDown(e, pt);
        return;
      }
      if (this.vectorAnchors.length === 0) {
        const editable = this.findVectorStroke(pt);
        if (editable) {
          this.enterVectorEdit(editable);
          return;
        }
      }
      const grab = this.vectorGrab();
      const first = this.vectorAnchors[0];
      if (
        first &&
        this.vectorAnchors.length >= 2 &&
        Math.hypot(first.p.x - pt.x, first.p.y - pt.y) <= grab
      ) {
        this.commitVectorPath(true);
        return;
      }
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.vectorAnchors.push({ p: { x: pt.x, y: pt.y } });
      this.vectorDragging = true;
      this.vectorHover = null;
      if (this.vectorAnchors.length === 1) {
        this.toast('Click to add points, drag for curves; click the first point to close, Enter to finish (Esc cancels).');
      }
      this.previewVectorPath();
      return;
    }

    // Straight-line mode: Space held + single-pointer drag draws a straight line.
    if (this.spaceDown && tool !== 'select' && tool !== 'text') {
      e.preventDefault();
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      const start = this.applyEndpointSnap(pt, e.shiftKey, tool);
      this.startSnapHit = this.snapTarget;
      this.straightStart = start;
      this.straightEnd = start;
      this.straightRaw = start;
      this.scheduleRender();
      return;
    }

    // Select tool + Space: drag to pan the canvas (quick-feature pan). The
    // Direct Select branch above routes its own Space press here too.
    if (this.spaceDown && tool === 'select') {
      e.preventDefault();
      this.beginPanDrag(e);
      return;
    }

    // Paint bucket: fill the enclosed shape under the click.
    if (tool === 'bucket') {
      e.preventDefault();
      this.applyBucket(pt);
      return;
    }

    // Shape tools: drag out a rectangle or ellipse (Shift = square / circle).
    if (tool === 'rect' || tool === 'ellipse') {
      e.preventDefault();
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.shapeStart = pt;
      const { color, width, opacity } = this.store.tool;
      this.live = {
        id: createId('st'),
        tool: 'pen',
        color,
        width,
        points: [{ ...pt }],
        layer: this.store.activeLayer.id,
        sharpened: true,
        ...(opacity != null ? { opacity } : {}),
      };
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
    const { color, width, opacity, nibAngle } = this.store.tool;
    const start = this.applyEndpointSnap(pt, e.shiftKey, tool);
    this.startSnapHit = this.snapTarget;
    this.live = {
      id: createId('st'),
      tool,
      color,
      width,
      points: [start],
      // Preview on the layer the stroke will land on.
      layer: this.store.activeLayer.id,
      ...(opacity != null ? { opacity } : {}),
      ...(tool === 'copic' ? { nibAngle } : {}),
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

    // Select-tool Space + drag: pan the canvas following the pointer.
    if (this.panDragging && this.activePointerId === e.pointerId && this.panLast) {
      const sign = this.settings.invertPanDrag ? -1 : 1;
      this.surface.panBy((e.clientX - this.panLast.x) * sign, (e.clientY - this.panLast.y) * sign);
      this.panLast = { x: e.clientX, y: e.clientY };
      this.scheduleRender();
      return;
    }

    // Direct Select: drag the grabbed anchor(s), handle, or whole path.
    if (this.anchorDragKind && this.anchorStrokeId && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      if (this.anchorDragLast) {
        const dx = pt.x - this.anchorDragLast.x;
        const dy = pt.y - this.anchorDragLast.y;
        if (this.anchorDragKind === 'anchor') {
          this.store.nudgeStrokePoints(this.anchorStrokeId, [...this.selectedAnchors], dx, dy);
        } else if (this.anchorDragKind === 'handle') {
          this.applyHandleDrag(pt);
        } else if (this.anchorDragKind === 'vanchor') {
          this.dragVectorPointAnchors(dx, dy);
        } else if (this.anchorDragKind === 'vhIn' || this.anchorDragKind === 'vhOut') {
          this.dragVectorPointHandle(this.anchorDragKind, pt);
        } else if (this.anchorDragKind === 'path') {
          this.store.nudgeStroke(this.anchorStrokeId, dx, dy);
        }
      }
      this.anchorDragLast = pt;
      return;
    }

    // Quick curve: the pointer sizes the arc, and Alt (tracked live) decides
    // quarter circle versus quarter ellipse. The far end does not snap to
    // stroke endpoints, because Shift is the apex key here, so the snap ring
    // from a Shift-anchored start is dropped once the drag is under way.
    if (this.quickCurve && this.curveA !== null && this.activePointerId === e.pointerId) {
      this.curveB = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.quickCurveUniform = e.altKey;
      this.setSnapTarget(null);
      this.previewQuickCurve();
      return;
    }

    // Curve, chord phase: update the dashed chord endpoint (Shift snaps it).
    if (this.curveA !== null && !this.curveBending && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      const snapEnds = e.shiftKey || (tool === 'curve' && this.curveVariant === 'endpoints');
      this.curveB = this.applyEndpointSnap(pt, snapEnds, this.curveTool);
      this.scheduleRender();
      return;
    }

    // Curve, bend phase (no button held): the pointer bows the curve through
    // itself; the pending stroke previews live until a click commits it.
    if (this.curveBending && this.curveA && this.curveB) {
      const m = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      const control = {
        x: 2 * m.x - (this.curveA.x + this.curveB.x) / 2,
        y: 2 * m.y - (this.curveA.y + this.curveB.y) / 2,
      };
      this.curveControl = control;
      const { color, width, opacity, nibAngle } = this.store.tool;
      this.live = {
        id: this.live?.id ?? createId('st'),
        tool: this.curveTool,
        color,
        width,
        points: quadraticPoints(this.curveA, control, this.curveB),
        layer: this.store.activeLayer.id,
        sharpened: true,
        ...(opacity != null ? { opacity } : {}),
        ...(this.curveTool === 'copic' ? { nibAngle } : {}),
      };
      this.scheduleRender();
      return;
    }

    // Shape tools: rebuild the live outline from the drag box.
    if (this.shapeStart !== null && this.activePointerId === e.pointerId && this.live) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.live.points =
        tool === 'ellipse'
          ? ellipsePoints(this.shapeStart, pt, e.shiftKey)
          : rectPoints(this.shapeStart, pt, e.shiftKey);
      this.scheduleRender();
      return;
    }

    // Vector Path edit mode: drag the grabbed anchor (handles ride along),
    // handle, or corner-rounding target.
    if (this.vectorEditDrag && this.vectorEditId && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      const drag = this.vectorEditDrag;
      if (drag.kind === 'round') {
        const corner = drag.base[drag.index];
        if (corner) {
          this.applyCornerRadius(drag, Math.hypot(pt.x - corner.p.x, pt.y - corner.p.y));
        }
      } else {
        const anchor = this.vectorEditAnchors[drag.index];
        if (anchor) {
          if (drag.kind === 'anchor') {
            const dx = pt.x - drag.last.x;
            const dy = pt.y - drag.last.y;
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
          } else {
            const handle = drag.kind === 'hIn' ? anchor.hIn : anchor.hOut;
            if (handle) {
              handle.x = pt.x;
              handle.y = pt.y;
              // Smooth-point reflection: the opposite handle turns to stay
              // collinear through the anchor (H' = P + (P - H) scaled to its
              // own length), so the curve keeps a continuous tangent instead
              // of creasing into a cusp at the anchor.
              const opposite = drag.kind === 'hIn' ? anchor.hOut : anchor.hIn;
              if (opposite) {
                const dx = anchor.p.x - handle.x;
                const dy = anchor.p.y - handle.y;
                const len = Math.hypot(dx, dy);
                if (len > 1e-6) {
                  const oppLen = Math.hypot(
                    opposite.x - anchor.p.x,
                    opposite.y - anchor.p.y,
                  );
                  opposite.x = anchor.p.x + (dx / len) * oppLen;
                  opposite.y = anchor.p.y + (dy / len) * oppLen;
                }
              }
            }
          }
          drag.last = pt;
          this.applyVectorEdit();
        }
      }
      return;
    }

    // Vector Path edit mode, hovering: restyle the pointer for what a click
    // would do at this position (add, remove, or grab).
    if (
      this.vectorEditId &&
      tool === 'vector' &&
      !this.vectorEditDrag &&
      this.activePointerId === null &&
      this.straightStart === null
    ) {
      this.vectorEditHoverPt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.updateVectorEditCursor();
      return;
    }

    // Vector Path: while placing, the drag pulls the newest anchor's handles
    // out symmetrically (Illustrator-style smooth point); otherwise the
    // pointer position previews the next segment as a rubber band. An active
    // quick straight line takes precedence over the hover preview.
    if (tool === 'vector' && this.straightStart === null) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      if (this.vectorDragging && this.activePointerId === e.pointerId) {
        const anchor = this.vectorAnchors[this.vectorAnchors.length - 1];
        const dx = pt.x - anchor.p.x;
        const dy = pt.y - anchor.p.y;
        if (Math.hypot(dx, dy) >= 3) {
          anchor.hOut = { x: anchor.p.x + dx, y: anchor.p.y + dy };
          anchor.hIn = { x: anchor.p.x - dx, y: anchor.p.y - dy };
        } else {
          // Back inside the click radius: the anchor reverts to a corner.
          anchor.hOut = undefined;
          anchor.hIn = undefined;
        }
        this.previewVectorPath();
        return;
      }
      if (this.vectorAnchors.length > 0) {
        this.vectorHover = pt;
        this.previewVectorPath();
        return;
      }
    }

    // Straight-line mode: update the dashed preview endpoint. While Shift is
    // held the line is strictly horizontal or vertical (whichever axis the
    // drag favours); releasing Shift frees it again mid-drag.
    if (this.straightStart !== null && this.activePointerId === e.pointerId) {
      this.straightRaw = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.setSnapTarget(null);
      this.updateStraightEnd(e.shiftKey);
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

    // Endpoint snap: preview where the stroke end will land if released now.
    if (this.snapApplies(this.live.tool)) {
      const tip = this.live.points[this.live.points.length - 1];
      this.setSnapTarget(e.shiftKey ? this.nearestEndpoint(tip) : null);
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

    // Select-tool Space + drag: end the pan.
    if (this.panDragging && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.panDragging = false;
      this.panLast = null;
      this.activePointerId = null;
      return;
    }

    // Direct Select: release the dragged anchor(s), handle, or path.
    if (this.anchorDragKind && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.anchorDragKind = null;
      this.handleDrag = null;
      this.anchorDragLast = null;
      this.activePointerId = null;
      this.scheduleRender();
      return;
    }

    // Vector Path edit mode: the release ends the anchor/handle/round drag.
    if (this.vectorEditDrag && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.activePointerId = null;
      this.vectorEditDrag = null;
      this.updateVectorEditCursor();
      this.scheduleRender();
      return;
    }

    // Vector Path: the release ends the anchor's handle pull. The path stays
    // open for more points — commit comes from closing, Enter, or dblclick.
    if (this.vectorDragging && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.activePointerId = null;
      this.vectorDragging = false;
      this.previewVectorPath();
      return;
    }

    // Quick curve: the release places the arc's far end and commits it.
    if (this.quickCurve && this.curveA !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.activePointerId = null;
      this.commitQuickCurve();
      return;
    }

    // Curve, chord release: enter the bend phase (move to bow, click commits).
    if (this.curveA !== null && !this.curveBending && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.activePointerId = null;
      const a = this.curveA;
      const b = this.curveB ?? a;
      // A click without a drag never entered a usable chord: cancel.
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) {
        this.cancelCurve();
        return;
      }
      this.curveBending = true;
      this.curveControl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { color, width, opacity, nibAngle } = this.store.tool;
      this.live = {
        id: createId('st'),
        tool: this.curveTool,
        color,
        width,
        points: quadraticPoints(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b),
        layer: this.store.activeLayer.id,
        sharpened: true,
        ...(opacity != null ? { opacity } : {}),
        ...(this.curveTool === 'copic' ? { nibAngle } : {}),
      };
      this.toast('Move to bend the curve, click to place it (Esc cancels).');
      this.scheduleRender();
      return;
    }

    // Shape tools: commit the dragged rectangle / ellipse outline.
    if (this.shapeStart !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.shapeStart = null;
      this.activePointerId = null;
      const finished = this.live;
      this.live = null;
      if (finished && finished.points.length > 2) {
        const extras = this.symmetryCopies(finished);
        this.store.addStrokes([finished, ...extras]);
      } else {
        this.scheduleRender();
      }
      return;
    }

    // Straight-line mode: commit a clean two-point line on release.
    if (this.straightStart !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      const a = this.straightStart;
      const b = this.straightEnd ?? a;
      const startHit = this.startSnapHit;
      // The end never snaps: Shift is the horizontal/vertical lock mid-drag,
      // so only the start (snapped on pointer-down) can join a stroke.
      const endHit = null;
      this.straightStart = null;
      this.straightEnd = null;
      this.straightRaw = null;
      this.startSnapHit = null;
      this.activePointerId = null;
      this.setSnapTarget(null);
      const lineTool = drawingToolOf(tool);
      const { color, width, opacity, nibAngle } = this.store.tool;
      let finished: Stroke = {
        id: createId('st'),
        tool: lineTool,
        color,
        width,
        points: [a, b],
        ...(opacity != null ? { opacity } : {}),
        ...(lineTool === 'copic' ? { nibAngle } : {}),
      };
      if (this.store.tool.liveSharpen && lineTool !== 'eraser') {
        finished = sharpenStroke(finished, this.store.tool.sharpen);
      }
      this.commitWithJoin(finished, startHit, endHit);
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

    // Endpoint snap: pull the stroke's final point onto the nearest endpoint.
    let endHit: SnapHit | null = null;
    if (e.shiftKey && this.snapApplies(finished.tool) && finished.points.length > 1) {
      const tail = finished.points[finished.points.length - 1];
      endHit = this.nearestEndpoint(tail);
      if (endHit) {
        finished.points[finished.points.length - 1] = { ...tail, x: endHit.x, y: endHit.y };
      }
    }
    const startHit = this.startSnapHit;
    this.startSnapHit = null;
    this.setSnapTarget(null);

    if (this.store.tool.liveSharpen && finished.tool !== 'eraser' && !finished.sharpened) {
      finished = sharpenStroke(finished, this.store.tool.sharpen);
    }

    this.commitWithJoin(finished, startHit, endHit);
  }

  /**
   * Commits a finished stroke. With the Join-stroke setting on, a stroke
   * whose snapped start/end landed on another stroke's endpoint (same tool
   * and color) merges into that stroke instead of stacking on top of it.
   */
  private commitWithJoin(finished: Stroke, startHit: SnapHit | null, endHit: SnapHit | null): void {
    const extras = this.symmetryCopies(finished);
    // Symmetry copies and joins don't mix; plain add covers that case.
    if (!this.settings.joinStrokeOnSnap || extras.length > 0 || (!startHit && !endHit)) {
      this.store.addStrokes([finished, ...extras]);
      return;
    }

    const removeIds: string[] = [];
    let points = finished.points.map((p) => ({ ...p }));
    const joinable = (hit: SnapHit | null): Stroke | null => {
      if (!hit) return null;
      const target = this.store.sketch.strokes.find((s) => s.id === hit.strokeId);
      if (!target || removeIds.includes(target.id)) return null;
      if (target.tool !== finished.tool || target.color !== finished.color) return null;
      return target;
    };

    const startTarget = joinable(startHit);
    if (startTarget) {
      // The target's snapped endpoint must lead into the new stroke's start.
      const tpts = startTarget.points.map((p) => ({ ...p }));
      if (startHit!.at === 'start') tpts.reverse();
      points = [...tpts, ...points];
      removeIds.push(startTarget.id);
    }
    const endTarget = joinable(endHit);
    if (endTarget) {
      // The new stroke's end must lead into the target's snapped endpoint.
      const tpts = endTarget.points.map((p) => ({ ...p }));
      if (endHit!.at === 'end') tpts.reverse();
      points = [...points, ...tpts];
      removeIds.push(endTarget.id);
    }

    if (removeIds.length === 0) {
      this.store.addStrokes([finished]);
      return;
    }
    const merged: Stroke = { ...finished, points, layer: this.store.activeLayer.id };
    this.store.replaceWithJoined(removeIds, merged);
    this.toast('Joined stroke.');
  }

  /** Commits the pending curve stroke (bend phase click). */
  private commitCurve(): void {
    const finished = this.live;
    const a = this.curveA;
    const b = this.curveB;
    const control = this.curveControl;
    this.cancelCurve();
    if (!finished || finished.points.length < 2) return;
    if (a && b && control) {
      // The bend is a quadratic Bézier B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2;
      // its exact cubic form lifts the control point to C1 = P0 + ⅔(P1-P0)
      // and C2 = P2 + ⅔(P1-P2), giving the stroke two editable anchors.
      finished.vector = {
        anchors: [
          {
            p: { x: a.x, y: a.y },
            hOut: { x: a.x + (2 / 3) * (control.x - a.x), y: a.y + (2 / 3) * (control.y - a.y) },
          },
          {
            p: { x: b.x, y: b.y },
            hIn: { x: b.x + (2 / 3) * (control.x - b.x), y: b.y + (2 / 3) * (control.y - b.y) },
          },
        ],
      };
    }
    const extras = this.symmetryCopies(finished);
    this.store.addStrokes([finished, ...extras]);
  }

  /**
   * The in-progress quick curve as one cubic Bézier — two anchors and two
   * control points. Null until the drag has enough reach for an arc (a
   * nearly straight or, under Alt, a nearly axis-aligned drag has no usable
   * radius); both ends are fixed by the drag whatever the apex is doing, so
   * the reach test is the same at every angle.
   */
  private quickCurveCubic(): ReturnType<typeof quarterArcCubic> | null {
    const a = this.curveA;
    const b = this.curveB;
    if (!a || !b) return null;
    const cubic = quarterArcCubic(a, b, this.quickCurveUniform, this.quickCurveApex);
    return Math.hypot(cubic.p3.x - a.x, cubic.p3.y - a.y) < 2 ? null : cubic;
  }

  /** Sampled points of the in-progress quick curve (empty while unusable). */
  private quickCurvePoints(): Point[] {
    const cubic = this.quickCurveCubic();
    if (!cubic) return [];
    return cubicBezierPoints(
      { ...cubic.p0, pressure: 0.5 },
      cubic.c1,
      cubic.c2,
      { ...cubic.p3, pressure: 0.5 },
      48,
    );
  }

  /** Builds the live quick-curve stroke, or clears it while the arc is empty. */
  private quickCurveStroke(points: Point[]): LiveStroke | null {
    if (points.length < 2) return null;
    const { color, width, opacity, nibAngle } = this.store.tool;
    return {
      id: this.live?.id ?? createId('st'),
      tool: this.curveTool,
      color,
      width,
      points,
      layer: this.store.activeLayer.id,
      sharpened: true,
      ...(opacity != null ? { opacity } : {}),
      ...(this.curveTool === 'copic' ? { nibAngle } : {}),
    };
  }

  /**
   * Swings the in-progress quick curve's apex one step further clockwise. The
   * arc's two ends stay put; only the side it bows out to moves. Two presses
   * mirror the bow across the chord and four bring it back around. On an Alt
   * quarter circle (or a square drag) the odd stops put the apex on the chord
   * itself, flattening the arc into a straight segment — the price of pinning
   * both ends — so mirroring a circle is two presses, not one.
   */
  private turnQuickCurveApex(): void {
    if (!this.quickCurve) return;
    this.quickCurveApex = (this.quickCurveApex + QUICK_CURVE_APEX_STEP) % 360;
    this.previewQuickCurve();
  }

  /**
   * Recomputes the straight-line preview end from the last raw pointer
   * position. With Shift down the line locks to whichever axis the drag
   * favours — strictly horizontal or strictly vertical; without it the end
   * follows the pointer. Called from pointer moves and from Shift key
   * transitions, so the lock engages and releases without pointer movement.
   */
  private updateStraightEnd(shift: boolean): void {
    const a = this.straightStart;
    const raw = this.straightRaw;
    if (!a || !raw) return;
    this.straightEnd =
      shift && Math.abs(raw.x - a.x) >= Math.abs(raw.y - a.y)
        ? { ...raw, y: a.y }
        : shift
          ? { ...raw, x: a.x }
          : raw;
    this.scheduleRender();
  }

  /** Switches an in-progress quick curve between quarter circle and ellipse. */
  private setQuickCurveUniform(uniform: boolean): void {
    if (!this.quickCurve || this.quickCurveUniform === uniform) return;
    this.quickCurveUniform = uniform;
    this.previewQuickCurve();
  }

  /** Live preview of the quick curve while the drag (or Alt) reshapes it. */
  private previewQuickCurve(): void {
    this.live = this.quickCurveStroke(this.quickCurvePoints());
    this.scheduleRender();
  }

  /** Commits the quick curve on pointer-up (too small a drag cancels). */
  private commitQuickCurve(): void {
    const cubic = this.quickCurveCubic();
    const finished = this.quickCurveStroke(this.quickCurvePoints());
    this.cancelCurve();
    if (!finished || !cubic) return;
    // The whole arc is one cubic: two anchors, two control points.
    finished.vector = {
      anchors: [
        { p: { ...cubic.p0 }, hOut: { ...cubic.c1 } },
        { p: { ...cubic.p3 }, hIn: { ...cubic.c2 } },
      ],
    };
    const extras = this.symmetryCopies(finished);
    this.store.addStrokes([finished, ...extras]);
  }

  /** Abandons any in-progress curve (Esc, gesture, or an empty chord). */
  private cancelCurve(): void {
    this.curveA = null;
    this.curveB = null;
    this.curveBending = false;
    this.curveControl = null;
    this.quickCurve = false;
    this.quickCurveUniform = false;
    this.quickCurveApex = 0;
    this.startSnapHit = null;
    this.live = null;
    this.setSnapTarget(null);
    this.scheduleRender();
  }

  // ---- Vector Path tool ----------------------------------------------------

  /**
   * Samples the pending vector path into stroke points. `rubberTo` appends
   * the live preview segment from the last anchor toward the pointer, and
   * `close` appends the segment back to the first anchor.
   */
  private vectorPathPoints(rubberTo: Point | null, close: boolean): Point[] {
    const anchors = this.vectorAnchors;
    if (anchors.length === 0) return [];
    const withRubber = rubberTo
      ? [...anchors, { p: { x: rubberTo.x, y: rubberTo.y } }]
      : anchors;
    return sampleVectorPathPoints(withRubber, close && !rubberTo);
  }

  /** Live preview of the pending vector path (with the rubber-band segment). */
  private previewVectorPath(): void {
    const points = this.vectorPathPoints(this.vectorDragging ? null : this.vectorHover, false);
    if (points.length < 2) {
      this.live = null;
      this.scheduleRender();
      return;
    }
    const { color, width, opacity } = this.store.tool;
    this.live = {
      id: this.live?.id ?? createId('st'),
      tool: 'pen',
      color,
      width,
      points,
      layer: this.store.activeLayer.id,
      sharpened: true,
      ...(opacity != null ? { opacity } : {}),
    };
    this.scheduleRender();
  }

  /**
   * Commits the pending vector path as a pen stroke — closed back to the
   * first anchor, or open (Enter / double-click). The path is deliberate
   * vector work, so it commits as drawn and is never auto-sharpened.
   */
  private commitVectorPath(close: boolean): void {
    // A double-click lands a second anchor on top of the last one: drop it.
    while (
      this.vectorAnchors.length >= 2 &&
      Math.hypot(
        this.vectorAnchors[this.vectorAnchors.length - 1].p.x -
          this.vectorAnchors[this.vectorAnchors.length - 2].p.x,
        this.vectorAnchors[this.vectorAnchors.length - 1].p.y -
          this.vectorAnchors[this.vectorAnchors.length - 2].p.y,
      ) < 2
    ) {
      this.vectorAnchors.pop();
    }
    if (this.vectorAnchors.length < 2) {
      this.cancelVectorPath();
      return;
    }
    const points = this.vectorPathPoints(null, close);
    const { color, width, opacity } = this.store.tool;
    const finished: Stroke = {
      id: createId('st'),
      tool: 'pen',
      color,
      width,
      points,
      layer: this.store.activeLayer.id,
      sharpened: true,
      ...(opacity != null ? { opacity } : {}),
      // The anchors persist so the path stays Vector Path editable.
      vector: {
        anchors: cloneAnchors(this.vectorAnchors),
        ...(close ? { closed: true } : {}),
      },
    };
    this.cancelVectorPath();
    const extras = this.symmetryCopies(finished);
    this.store.addStrokes([finished, ...extras]);
  }

  /** Abandons the pending vector path (Esc, blur, gesture, or tool switch). */
  private cancelVectorPath(): void {
    this.vectorAnchors = [];
    this.vectorDragging = false;
    this.vectorHover = null;
    this.live = null;
    this.scheduleRender();
  }

  // ---- Vector Path edit mode -----------------------------------------------

  /**
   * Grab radius for vector-edit interactions, in sketch units. Anchors,
   * handles, and the rounding target are deliberate click targets, so the
   * radius never drops below a comfortable 8 screen pixels even when the
   * Direct Select sensitivity is tuned finer.
   */
  private vectorGrab(): number {
    return (
      Math.max(8, this.settings.directSelectSensitivityPx) / this.surface.getViewport().zoom
    );
  }

  /** Topmost editable stroke with vector structure under the point, or null. */
  private findVectorStroke(pt: Point): Stroke | null {
    const grab = this.vectorGrab();
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      if (!stroke.vector || !this.strokeEditable(stroke)) continue;
      const onAnchor = stroke.vector.anchors.some(
        (a) => Math.hypot(a.p.x - pt.x, a.p.y - pt.y) <= grab,
      );
      if (onAnchor || this.pointOnPath(stroke, pt, grab)) return stroke;
    }
    return null;
  }

  /** Starts editing a committed vector stroke's anchors. */
  private enterVectorEdit(stroke: Stroke): void {
    if (!stroke.vector) return;
    this.vectorEditId = stroke.id;
    this.vectorEditAnchors = cloneAnchors(stroke.vector.anchors);
    this.vectorEditClosed = stroke.vector.closed === true;
    this.vectorEditSelected = null;
    this.vectorEditDrag = null;
    this.vectorEditHoverPt = null;
    this.store.setSelection([stroke.id]);
    this.toast('Click a segment to add a point, a point to remove it; Ctrl moves points and rounds corners, Alt toggles handles.');
    this.updateCursor();
    this.scheduleRender();
  }

  /** Ends the anchor edit (Esc, empty-canvas click, blur, or tool switch). */
  private exitVectorEdit(): void {
    this.vectorEditId = null;
    this.vectorEditAnchors = [];
    this.vectorEditClosed = false;
    this.vectorEditSelected = null;
    this.vectorEditDrag = null;
    this.vectorEditHoverPt = null;
    this.updateCursor();
    this.scheduleRender();
  }

  /** Writes the working anchors back to the stroke, resampling its points. */
  private applyVectorEdit(): void {
    if (!this.vectorEditId) return;
    const points = sampleVectorPathPoints(this.vectorEditAnchors, this.vectorEditClosed);
    if (points.length < 2) return;
    this.store.setStrokeGeometry(this.vectorEditId, points, {
      anchors: cloneAnchors(this.vectorEditAnchors),
      ...(this.vectorEditClosed ? { closed: true } : {}),
    });
  }

  /** The edited path's neighbour anchor in `dir`, wrapping on closed paths. */
  private vectorNeighbor(index: number, dir: -1 | 1): VectorAnchor | null {
    const n = this.vectorEditAnchors.length;
    let j = index + dir;
    if (this.vectorEditClosed) j = ((j % n) + n) % n;
    else if (j < 0 || j >= n) return null;
    return j === index ? null : (this.vectorEditAnchors[j] ?? null);
  }

  /** Index of the edited anchor within `tol` of the point, or null. */
  private nearestVectorAnchor(pt: Point, tol: number): number | null {
    let best: number | null = null;
    let bestDist = tol;
    this.vectorEditAnchors.forEach((a, i) => {
      const d = Math.hypot(a.p.x - pt.x, a.p.y - pt.y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Corner-rounding target position for an anchor: a small way into the
   * corner's wedge, along the bisector of its two chords (or beside the
   * anchor when the path runs straight through). Endpoint anchors of an open
   * path have no corner to round.
   */
  private roundTargetPos(index: number): Point | null {
    const anchor = this.vectorEditAnchors[index];
    const prev = this.vectorNeighbor(index, -1);
    const next = this.vectorNeighbor(index, 1);
    if (!anchor || !prev || !next) return null;
    const uLen = Math.hypot(prev.p.x - anchor.p.x, prev.p.y - anchor.p.y);
    const vLen = Math.hypot(next.p.x - anchor.p.x, next.p.y - anchor.p.y);
    if (uLen < 1e-6 || vLen < 1e-6) return null;
    let bx = (prev.p.x - anchor.p.x) / uLen + (next.p.x - anchor.p.x) / vLen;
    let by = (prev.p.y - anchor.p.y) / uLen + (next.p.y - anchor.p.y) / vLen;
    const bLen = Math.hypot(bx, by);
    if (bLen < 1e-3) {
      // A straight-through anchor has no wedge: offset perpendicular instead.
      bx = -(next.p.y - anchor.p.y) / vLen;
      by = (next.p.x - anchor.p.x) / vLen;
    } else {
      bx /= bLen;
      by /= bLen;
    }
    const off = 18 / this.surface.getViewport().zoom;
    return { x: anchor.p.x + bx * off, y: anchor.p.y + by * off, pressure: 0.5 };
  }

  /**
   * Replaces the corner at `drag.index` (working from the pre-drag anchors in
   * `drag.base`) with a circular fillet of the given radius; a sub-pixel
   * radius restores the sharp corner. Recomputing from the base every time
   * keeps the drag and the radius field idempotent.
   */
  private applyCornerRadius(drag: { index: number; base: VectorAnchor[] }, radius: number): void {
    const base = drag.base;
    const n = base.length;
    const prevIdx = this.vectorEditClosed ? (drag.index - 1 + n) % n : drag.index - 1;
    const nextIdx = this.vectorEditClosed ? (drag.index + 1) % n : drag.index + 1;
    const prev = base[prevIdx];
    const next = base[nextIdx];
    const corner = base[drag.index];
    if (!prev || !next || !corner) return;
    const work = cloneAnchors(base);
    const rounded =
      radius >= 1 ? roundedCornerAnchors(prev.p, corner.p, next.p, radius) : null;
    if (rounded) work.splice(drag.index, 1, ...rounded);
    this.vectorEditAnchors = work;
    this.vectorEditSelected = drag.index;
    el<HTMLInputElement>('vector-radius').value = String(Math.max(0, Math.round(radius)));
    this.applyVectorEdit();
  }

  /**
   * Alt-click on an anchor: strips its direction handles when it has any
   * (smooth point becomes a corner), otherwise grows a pair along the
   * neighbour chord (corner becomes a smooth point) — each handle one third
   * of its side's chord, per the standard smooth-tangent construction.
   */
  private toggleVectorHandles(index: number): void {
    const anchor = this.vectorEditAnchors[index];
    if (!anchor) return;
    const prev = this.vectorNeighbor(index, -1);
    const next = this.vectorNeighbor(index, 1);
    if (!prev && !next) return;
    this.store.pushHistory();
    if (anchor.hIn || anchor.hOut) {
      delete anchor.hIn;
      delete anchor.hOut;
    } else {
      const from = prev ? prev.p : anchor.p;
      const to = next ? next.p : anchor.p;
      let dx = to.x - from.x;
      let dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      if (prev) {
        const reach = Math.hypot(anchor.p.x - prev.p.x, anchor.p.y - prev.p.y) / 3;
        anchor.hIn = { x: anchor.p.x - dx * reach, y: anchor.p.y - dy * reach };
      }
      if (next) {
        const reach = Math.hypot(next.p.x - anchor.p.x, next.p.y - anchor.p.y) / 3;
        anchor.hOut = { x: anchor.p.x + dx * reach, y: anchor.p.y + dy * reach };
      }
    }
    this.vectorEditSelected = index;
    this.applyVectorEdit();
  }

  /** Removes an anchor from the edited path (a path keeps at least two). */
  private removeVectorAnchor(index: number): void {
    if (this.vectorEditAnchors.length <= 2) {
      this.toast('A path needs at least two points.');
      return;
    }
    this.store.pushHistory();
    this.vectorEditAnchors.splice(index, 1);
    this.vectorEditSelected = null;
    this.applyVectorEdit();
  }

  /**
   * Nearest edited segment within `tol` of the point, located by sampling
   * each segment's cubic; `t` is the split parameter, kept off the exact
   * ends (anchor hits are claimed before segment hits).
   */
  private locateVectorSegment(pt: Point, tol: number): { index: number; t: number } | null {
    const anchors = this.vectorEditAnchors;
    const segCount = anchors.length - 1 + (this.vectorEditClosed ? 1 : 0);
    let best: { index: number; t: number; d: number } | null = null;
    for (let i = 0; i < segCount; i++) {
      const from = anchors[i];
      const to = anchors[(i + 1) % anchors.length];
      const a = { x: from.p.x, y: from.p.y, pressure: 0.5 };
      const b = { x: to.p.x, y: to.p.y, pressure: 0.5 };
      const samples = cubicBezierPoints(a, from.hOut ?? from.p, to.hIn ?? to.p, b, 32);
      samples.forEach((s, k) => {
        const d = Math.hypot(s.x - pt.x, s.y - pt.y);
        if (!best || d < best.d) best = { index: i, t: k / 32, d };
      });
    }
    if (!best) return null;
    const hit = best as { index: number; t: number; d: number };
    if (hit.d > tol) return null;
    return { index: hit.index, t: Math.min(0.95, Math.max(0.05, hit.t)) };
  }

  /**
   * Inserts an anchor into a segment without changing the path's shape: a
   * curved segment splits by de Casteljau (the halves' control points become
   * the neighbours' and the new anchor's handles); a straight segment just
   * gains a plain corner on the line.
   */
  private insertVectorAnchor(hit: { index: number; t: number }): void {
    const anchors = this.vectorEditAnchors;
    const from = anchors[hit.index];
    const to = anchors[(hit.index + 1) % anchors.length];
    if (!from || !to) return;
    this.store.pushHistory();
    const split = splitCubicBezier(from.p, from.hOut ?? from.p, to.hIn ?? to.p, to.p, hit.t);
    const straight = !from.hOut && !to.hIn;
    const inserted: VectorAnchor = straight
      ? { p: split.point }
      : {
          p: split.point,
          hIn: { x: split.left.c2.x, y: split.left.c2.y },
          hOut: { x: split.right.c1.x, y: split.right.c1.y },
        };
    if (!straight) {
      from.hOut = { x: split.left.c1.x, y: split.left.c1.y };
      to.hIn = { x: split.right.c2.x, y: split.right.c2.y };
    }
    anchors.splice(hit.index + 1, 0, inserted);
    this.vectorEditSelected = hit.index + 1;
    this.applyVectorEdit();
  }

  /**
   * Corner-radius field in the toolbar: typing a value rounds the selected
   * anchor of the edited path by that radius (the drag on the rounding
   * target does the same thing by feel).
   */
  private bindVectorOptions(): void {
    el<HTMLInputElement>('vector-radius').addEventListener('change', () => {
      const value = Number(el<HTMLInputElement>('vector-radius').value);
      if (!this.vectorEditId || this.vectorEditSelected === null || !Number.isFinite(value)) {
        return;
      }
      const base = cloneAnchors(this.vectorEditAnchors);
      this.store.pushHistory();
      this.applyCornerRadius({ index: this.vectorEditSelected, base }, Math.max(0, value));
    });
  }

  // ---- Sharpen Selection ---------------------------------------------------

  /**
   * Smoothed-and-simplified copy of a stroke's points at the dialog's
   * current slider values: simplify drops noise nodes within the tolerance,
   * then a Catmull-Rom pass draws a smooth curve through what remains.
   */
  private sharpenedPoints(original: Point[]): Point[] {
    const smooth = Number(el<HTMLInputElement>('sharpen-smooth').value);
    const epsilon = Number(el<HTMLInputElement>('sharpen-simplify').value);
    let pts = original.map((p) => ({ ...p }));
    if (epsilon > 0) pts = simplify(pts, epsilon);
    if (smooth > 0 && pts.length >= 3) {
      pts = catmullRom(pts, Math.max(4, Math.round(smooth * 1.6)));
    }
    return pts;
  }

  private bindSharpenSelection(): void {
    el('sharpen-selection').addEventListener('click', () => this.openSharpenDialog());
    el('sharpen-apply-btn').addEventListener('click', () => this.closeSharpenDialog(true));
    el('sharpen-cancel-btn').addEventListener('click', () => this.closeSharpenDialog(false));
    const update = (): void => this.updateSharpenPreview();
    el<HTMLInputElement>('sharpen-smooth').addEventListener('input', update);
    el<HTMLInputElement>('sharpen-simplify').addEventListener('input', update);
  }

  /** Opens the Sharpen Selection dialog over the selected drawing strokes. */
  private openSharpenDialog(): void {
    const targets = this.store.sketch.strokes.filter(
      (s) =>
        this.store.selectedIds.has(s.id) &&
        !isTextStroke(s) &&
        !isImageStroke(s) &&
        s.tool !== 'eraser' &&
        s.points.length >= 3,
    );
    if (targets.length === 0) {
      this.toast('Select one or more strokes to sharpen first.');
      return;
    }
    this.sharpenPreview = new Map(
      targets.map((s) => [
        s.id,
        { points: s.points.map((p) => ({ ...p })), vector: s.vector },
      ]),
    );
    el('sharpen-dialog').classList.remove('is-hidden');
    this.updateSharpenPreview();
  }

  /** Re-applies the sliders to every previewed stroke, live on the canvas. */
  private updateSharpenPreview(): void {
    if (!this.sharpenPreview) return;
    for (const [id, original] of this.sharpenPreview) {
      const pts = this.sharpenedPoints(original.points);
      if (pts.length >= 2) this.store.setStrokeGeometry(id, pts);
    }
  }

  /**
   * Closes the dialog. The preview always rolls back to the original
   * geometry first; applying then re-runs the sliders as a single history
   * step, so one undo returns the strokes to their pre-dialog shape.
   */
  private closeSharpenDialog(apply: boolean): void {
    const preview = this.sharpenPreview;
    if (!preview) return;
    this.sharpenPreview = null;
    for (const [id, original] of preview) {
      this.store.setStrokeGeometry(id, original.points, original.vector);
    }
    if (apply) {
      this.store.pushHistory();
      for (const [id, original] of preview) {
        const pts = this.sharpenedPoints(original.points);
        // Reshaped points no longer match any stored anchor structure.
        if (pts.length >= 2) this.store.setStrokeGeometry(id, pts);
      }
    }
    el('sharpen-dialog').classList.add('is-hidden');
  }

  /**
   * Pointer styling while a vector edit is open, from the hover position and
   * the held modifier. Alt shows the stemless arrowhead (handle toggling).
   * Ctrl is direct-select mode, so the pointer becomes the Select arrow over
   * anything it can grab — an anchor, the selected anchor's handles, or the
   * rounding target — and the add badge over a segment (Ctrl-clicking a
   * segment inserts an anchor too). With no modifier, hovering an anchor
   * shows the remove badge and hovering the path the add badge, matching
   * what a plain click does there.
   */
  private updateVectorEditCursor(): void {
    if (!this.vectorEditId || this.store.tool.tool !== 'vector') return;
    if (this.altDown) {
      this.canvas.style.cursor = CURSOR_ARROWHEAD;
      return;
    }
    const pt = this.vectorEditHoverPt;
    if (!pt) {
      this.canvas.style.cursor = this.ctrlDown ? CURSOR_ARROW_BLACK : 'crosshair';
      return;
    }
    const grab = this.vectorGrab();
    const near = (q: { x: number; y: number } | null | undefined): boolean =>
      !!q && Math.hypot(q.x - pt.x, q.y - pt.y) <= grab;
    const overAnchor = this.nearestVectorAnchor(pt, grab) !== null;
    if (this.ctrlDown) {
      const sel = this.vectorEditSelected;
      const anchor = sel !== null ? this.vectorEditAnchors[sel] : undefined;
      const grabbable =
        overAnchor ||
        near(anchor?.hIn) ||
        near(anchor?.hOut) ||
        (sel !== null && near(this.roundTargetPos(sel)));
      this.canvas.style.cursor = grabbable
        ? CURSOR_ARROW_BLACK
        : this.locateVectorSegment(pt, grab)
          ? CURSOR_ADD_POINT
          : CURSOR_ARROW_BLACK;
      return;
    }
    this.canvas.style.cursor = overAnchor
      ? CURSOR_REMOVE_POINT
      : this.locateVectorSegment(pt, grab)
        ? CURSOR_ADD_POINT
        : 'crosshair';
  }

  /** Pointer-down dispatch while a committed vector stroke is being edited. */
  private vectorEditPointerDown(e: PointerEvent, pt: Point): void {
    const grab = this.vectorGrab();
    const near = (q: { x: number; y: number } | null | undefined): boolean =>
      !!q && Math.hypot(q.x - pt.x, q.y - pt.y) <= grab;

    // Ctrl: direct-select mode — grab the rounding target, a handle, or an
    // anchor, and drag just that.
    if (e.ctrlKey) {
      const sel = this.vectorEditSelected;
      if (sel !== null) {
        if (near(this.roundTargetPos(sel))) {
          this.store.pushHistory();
          this.vectorEditDrag = { kind: 'round', index: sel, base: cloneAnchors(this.vectorEditAnchors) };
          this.beginPointerDrag(e);
          return;
        }
        const anchor = this.vectorEditAnchors[sel];
        for (const kind of ['hOut', 'hIn'] as const) {
          if (near(anchor?.[kind])) {
            this.store.pushHistory();
            this.vectorEditDrag = { kind, index: sel, last: pt };
            this.beginPointerDrag(e);
            return;
          }
        }
      }
      const idx = this.nearestVectorAnchor(pt, grab);
      if (idx !== null) {
        this.vectorEditSelected = idx;
        this.store.pushHistory();
        this.vectorEditDrag = { kind: 'anchor', index: idx, last: pt };
        this.beginPointerDrag(e);
        return;
      }
      // Ctrl over a bare segment adds an anchor there, as the pointer's add
      // badge promises.
      const ctrlSeg = this.locateVectorSegment(pt, grab);
      if (ctrlSeg) this.insertVectorAnchor(ctrlSeg);
      return;
    }

    // Alt: toggle the clicked anchor's direction handles.
    if (e.altKey) {
      const idx = this.nearestVectorAnchor(pt, grab);
      if (idx !== null) this.toggleVectorHandles(idx);
      return;
    }

    // Plain click: an anchor removes itself, a segment gains one, empty
    // canvas selects (near the path) or ends the edit.
    const idx = this.nearestVectorAnchor(pt, grab);
    if (idx !== null) {
      this.removeVectorAnchor(idx);
      return;
    }
    const seg = this.locateVectorSegment(pt, grab);
    if (seg) {
      this.insertVectorAnchor(seg);
      return;
    }
    this.exitVectorEdit();
  }

  // ---- Sketch Support actions ----------------------------------------------

  /**
   * Paint bucket: fills the topmost enclosed shape under the click with the
   * current ink color, added as a new selectable shape on the active layer.
   */
  private applyBucket(pt: Point): void {
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!this.strokeEditable(s) || !isClosedStroke(s)) continue;
      if (!pointInPolygon(pt, s.points)) continue;
      const color = this.store.tool.color;
      const points = s.points.map((p) => ({ ...p }));
      const first = points[0];
      const last = points[points.length - 1];
      if (first.x !== last.x || first.y !== last.y) points.push({ ...first });
      this.store.addStroke({
        id: createId('st'),
        tool: 'pen',
        color,
        fill: color,
        width: 1,
        points,
        sharpened: true,
      });
      this.toast(`Filled shape with ${color}.`);
      return;
    }
    this.toast('No enclosed shape under the pointer.');
  }

  /**
   * Eyedropper: picks the average rendered color around the click (within
   * the configured pixel sensitivity). The pick becomes the ink color and,
   * when a shape is selected, fills that shape.
   */
  private applyEyedrop(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const color = this.surface.sampleAverageColor(
      e.clientX - rect.left,
      e.clientY - rect.top,
      this.settings.eyedropSensitivityPx,
    );
    this.store.setTool({ color });
    this.updateCursor();
    if (this.store.selectedIds.size > 0) {
      const result = this.store.fillSelected(color);
      if (result.filled + result.recolored > 0) {
        this.toast(
          result.filled > 0
            ? `Picked ${color} and filled the selected shape.`
            : `Picked ${color} and recolored the selection.`,
        );
        return;
      }
    }
    this.toast(`Picked ${color}.`);
  }

  /** Join strokes (Ctrl+J / toolbar): merges the selected strokes into one. */
  private joinSelectedStrokes(): void {
    const merged = this.store.joinSelectedStrokes();
    this.toast(merged ? 'Joined selected strokes.' : 'Select two or more strokes to join.');
  }

  /**
   * Fill Color tool: applies the selected ink color to the selected
   * element(s), or to the element under the click when nothing is selected.
   */
  private applyFillColor(pt: Point): void {
    // Clicking an element selects it first — anywhere within the element's
    // dimensions counts, not just its outline — and the fill applies to it.
    // Strokes the tool cannot act on (erasers, images) are skipped so the
    // pick falls through to the fillable element beneath them. With no
    // element under the click, an existing selection is filled.
    const hit = this.hitTestWithinBounds(pt, (s) => s.tool !== 'eraser' && !isImageStroke(s));
    if (hit) {
      this.store.setSelection([hit.id]);
    } else if (this.store.selectedIds.size === 0) {
      this.toast('Select an element (or click one) to fill.');
      return;
    }
    const color = this.store.tool.color;
    const result = this.store.fillSelected(color);
    if (result.filled > 0) this.toast(`Filled ${result.filled} element(s) with ${color}.`);
    else if (result.recolored > 0) this.toast(`Recolored ${result.recolored} element(s) with ${color}.`);
    else this.toast('Nothing fillable in the selection.');
  }

  /**
   * Direct Select (A): grabs an anchor, a handle, or the whole path of the
   * edited stroke to drag; Shift extends the anchor selection. Clicking a
   * different stroke picks it for editing; clicking empty canvas drops it.
   */
  private beginPointSelect(e: PointerEvent, pt: Point): void {
    const grab = this.settings.directSelectSensitivityPx / this.surface.getViewport().zoom;
    const stroke = this.anchorStrokeId
      ? this.store.sketch.strokes.find((s) => s.id === this.anchorStrokeId)
      : null;

    if (stroke && this.strokeEditable(stroke)) {
      // Strokes with Bézier structure edit through their few anchors — the
      // curvature lives in the handles — instead of raw samples.
      if (stroke.vector) {
        if (this.beginVectorPointSelect(e, pt, stroke)) return;
      } else if (this.beginRawPointSelect(e, pt, stroke, grab)) {
        return;
      }
    }

    // Pick a different stroke for editing, or drop the edit on empty canvas.
    // As with the Select tool, a filled shape's interior counts as the shape.
    const hit = this.hitTest(pt) ?? this.hitFilledInterior(pt);
    if (hit && !isTextStroke(hit) && !isImageStroke(hit)) {
      this.anchorStrokeId = hit.id;
      this.selectedAnchors.clear();
      this.pathSelected = false;
      this.store.setSelection([hit.id]);
    } else {
      this.anchorStrokeId = null;
      this.selectedAnchors.clear();
      this.pathSelected = false;
      this.store.clearSelection();
    }
    this.scheduleRender();
  }

  /**
   * Direct Select interactions for a stroke with Bézier structure: the
   * lone selected anchor's curvature handles, then the anchors, then the
   * path body. Returns false when nothing was hit.
   */
  private beginVectorPointSelect(e: PointerEvent, pt: Point, stroke: Stroke): boolean {
    const anchors = stroke.vector!.anchors;
    const grab = this.vectorGrab();
    const near = (q: { x: number; y: number } | null | undefined): boolean =>
      !!q && Math.hypot(q.x - pt.x, q.y - pt.y) <= grab;

    // 1. A curvature handle of the lone selected anchor.
    if (this.selectedAnchors.size === 1) {
      const origin = [...this.selectedAnchors][0];
      const anchor = anchors[origin];
      for (const kind of ['vhOut', 'vhIn'] as const) {
        const handle = kind === 'vhIn' ? anchor?.hIn : anchor?.hOut;
        if (near(handle)) {
          this.store.pushHistory();
          this.anchorDragKind = kind;
          this.anchorDragLast = pt;
          this.beginPointerDrag(e);
          return true;
        }
      }
    }

    // 2. An anchor: Shift toggles it in the selection, else it selects
    //    alone; the selection then drags together.
    let best = -1;
    let bestDist = grab;
    anchors.forEach((a, i) => {
      const d = Math.hypot(a.p.x - pt.x, a.p.y - pt.y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== -1) {
      if (e.shiftKey) {
        if (this.selectedAnchors.has(best)) this.selectedAnchors.delete(best);
        else this.selectedAnchors.add(best);
      } else if (!this.selectedAnchors.has(best)) {
        this.selectedAnchors = new Set([best]);
      }
      this.pathSelected = false;
      if (this.selectedAnchors.has(best)) {
        this.store.pushHistory();
        this.anchorDragKind = 'vanchor';
        this.anchorDragLast = pt;
        this.beginPointerDrag(e);
      } else {
        this.scheduleRender();
      }
      return true;
    }

    // 3. The path body: select and move the whole path (anchors follow).
    if (this.pointOnPath(stroke, pt, grab)) {
      this.selectedAnchors.clear();
      this.pathSelected = true;
      this.store.setSelection([stroke.id]);
      this.store.pushHistory();
      this.anchorDragKind = 'path';
      this.anchorDragLast = pt;
      this.beginPointerDrag(e);
      return true;
    }
    return false;
  }

  /**
   * Direct Select interactions for a freehand (sample-based) stroke: the
   * tangent handles, then the raw anchor points, then the path body.
   * Returns false when nothing was hit.
   */
  private beginRawPointSelect(
    e: PointerEvent,
    pt: Point,
    stroke: Stroke,
    grab: number,
  ): boolean {
    // 1. A tangent-handle tip around a lone selected anchor grabs it: the
    //    drag bends the stroke around the anchor (see applyHandleDrag).
    if (this.selectedAnchors.size === 1) {
      const origin = [...this.selectedAnchors][0];
      for (const handle of this.anchorHandleTips(stroke, origin)) {
        if (Math.hypot(handle.tip.x - pt.x, handle.tip.y - pt.y) <= grab) {
          this.store.pushHistory();
          this.anchorDragKind = 'handle';
          this.handleDrag = this.captureHandleDrag(stroke, origin, handle);
          this.anchorDragLast = pt;
          this.beginPointerDrag(e);
          return true;
        }
      }
    }

    // 2. An anchor point: Shift toggles it in the selection, else selects it
    //    alone; then the whole selection drags together.
    let bestDist = grab;
    let best = -1;
    stroke.points.forEach((p, i) => {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== -1) {
      if (e.shiftKey) {
        if (this.selectedAnchors.has(best)) this.selectedAnchors.delete(best);
        else this.selectedAnchors.add(best);
      } else if (!this.selectedAnchors.has(best)) {
        this.selectedAnchors = new Set([best]);
      }
      this.pathSelected = false;
      if (this.selectedAnchors.has(best)) {
        this.store.pushHistory();
        this.anchorDragKind = 'anchor';
        this.anchorDragLast = pt;
        this.beginPointerDrag(e);
      } else {
        this.scheduleRender();
      }
      return true;
    }

    // 3. The path body (a segment within range): select and move the path.
    if (this.pointOnPath(stroke, pt, grab)) {
      this.selectedAnchors.clear();
      this.pathSelected = true;
      this.store.setSelection([stroke.id]);
      this.store.pushHistory();
      this.anchorDragKind = 'path';
      this.anchorDragLast = pt;
      this.beginPointerDrag(e);
      return true;
    }
    return false;
  }

  /**
   * Writes changed vector anchors back to a Direct Select-edited stroke,
   * resampling its points so the drawn curve follows the anchors.
   */
  private commitVectorPointEdit(stroke: Stroke, anchors: VectorAnchor[]): void {
    const closed = stroke.vector?.closed === true;
    const points = sampleVectorPathPoints(anchors, closed);
    if (points.length < 2) return;
    this.store.setStrokeGeometry(stroke.id, points, {
      anchors,
      ...(closed ? { closed: true } : {}),
    });
  }

  /** Moves the selected vector anchors (handles riding along) by a delta. */
  private dragVectorPointAnchors(dx: number, dy: number): void {
    const stroke = this.store.sketch.strokes.find((s) => s.id === this.anchorStrokeId);
    if (!stroke?.vector) return;
    const anchors = cloneAnchors(stroke.vector.anchors);
    for (const index of this.selectedAnchors) {
      const anchor = anchors[index];
      if (!anchor) continue;
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
    this.commitVectorPointEdit(stroke, anchors);
  }

  /**
   * Drags one curvature handle of the lone selected vector anchor. The
   * opposite handle turns to stay collinear through the anchor (each keeps
   * its own length) so the curve bends smoothly rather than creasing.
   */
  private dragVectorPointHandle(kind: 'vhIn' | 'vhOut', pt: Point): void {
    const stroke = this.store.sketch.strokes.find((s) => s.id === this.anchorStrokeId);
    if (!stroke?.vector || this.selectedAnchors.size !== 1) return;
    const origin = [...this.selectedAnchors][0];
    const anchors = cloneAnchors(stroke.vector.anchors);
    const anchor = anchors[origin];
    const handle = kind === 'vhIn' ? anchor?.hIn : anchor?.hOut;
    if (!anchor || !handle) return;
    handle.x = pt.x;
    handle.y = pt.y;
    const opposite = kind === 'vhIn' ? anchor.hOut : anchor.hIn;
    if (opposite) {
      const dx = anchor.p.x - handle.x;
      const dy = anchor.p.y - handle.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        const oppLen = Math.hypot(opposite.x - anchor.p.x, opposite.y - anchor.p.y);
        opposite.x = anchor.p.x + (dx / len) * oppLen;
        opposite.y = anchor.p.y + (dy / len) * oppLen;
      }
    }
    this.commitVectorPointEdit(stroke, anchors);
  }

  /** Captures the pointer and marks it active for a Direct Select drag. */
  private beginPointerDrag(e: PointerEvent): void {
    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.scheduleRender();
  }

  /** Starts a Space + drag canvas pan (Select and Direct Select tools). */
  private beginPanDrag(e: PointerEvent): void {
    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.panDragging = true;
    this.panLast = { x: e.clientX, y: e.clientY };
    this.updateCursor();
  }

  /**
   * Captures the geometry a tangent-handle drag works from: the anchor (the
   * fixed pivot), the grabbed tip, and every point on the tip's side of the
   * stroke with its blend weight. Points between anchor and tip move rigidly
   * (weight 1) so the tip tracks the pointer exactly; past the tip the
   * weight eases to zero across the falloff window, blending the bend into
   * the untouched remainder. A side too sparse to reach the window (a plain
   * two-point line) keeps its nearest point rigid so the drag still works.
   */
  private captureHandleDrag(
    stroke: Stroke,
    origin: number,
    handle: { side: -1 | 1; tip: Point; reach: number },
  ): { anchor: Point; tip: { x: number; y: number }; points: Array<{ index: number; x: number; y: number; weight: number }> } {
    const anchor = stroke.points[origin];
    const falloffEnd = handle.reach * HANDLE_FALLOFF;
    const points: Array<{ index: number; x: number; y: number; weight: number }> = [];
    let travelled = 0;
    let prev = anchor;
    for (let i = origin + handle.side; i >= 0 && i < stroke.points.length; i += handle.side) {
      const curr = stroke.points[i];
      travelled += Math.hypot(curr.x - prev.x, curr.y - prev.y);
      prev = curr;
      if (travelled >= falloffEnd) break;
      const over = Math.max(0, travelled - handle.reach) / (falloffEnd - handle.reach);
      // Cosine ease from rigid (inside the reach) to untouched (window edge).
      const weight = over <= 0 ? 1 : 0.5 * (1 + Math.cos(Math.PI * over));
      points.push({ index: i, x: curr.x, y: curr.y, weight });
    }
    if (points.length === 0) {
      const nearest = stroke.points[origin + handle.side];
      if (nearest) points.push({ index: origin + handle.side, x: nearest.x, y: nearest.y, weight: 1 });
    }
    return { anchor: { ...anchor }, tip: { x: handle.tip.x, y: handle.tip.y }, points };
  }

  /**
   * Applies a tangent-handle drag: the rotation and stretch that carry the
   * grabbed tip onto the pointer are applied around the anchor to each
   * captured point, scaled by its blend weight — always from the original
   * captured positions, so the drag never accumulates error.
   */
  private applyHandleDrag(pt: Point): void {
    const drag = this.handleDrag;
    if (!drag || !this.anchorStrokeId) return;
    const { anchor, tip } = drag;
    const toTip = { x: tip.x - anchor.x, y: tip.y - anchor.y };
    const toPtr = { x: pt.x - anchor.x, y: pt.y - anchor.y };
    const tipLen = Math.hypot(toTip.x, toTip.y);
    const ptrLen = Math.hypot(toPtr.x, toPtr.y);
    if (tipLen < 1e-6 || ptrLen < 1) return;
    const angle = Math.atan2(toPtr.y, toPtr.x) - Math.atan2(toTip.y, toTip.x);
    const scale = Math.min(10, Math.max(0.1, ptrLen / tipLen));
    const updates = drag.points.map(({ index, x, y, weight }) => {
      const a = angle * weight;
      const s = 1 + (scale - 1) * weight;
      const cos = Math.cos(a) * s;
      const sin = Math.sin(a) * s;
      const dx = x - anchor.x;
      const dy = y - anchor.y;
      return {
        index,
        x: anchor.x + dx * cos - dy * sin,
        y: anchor.y + dx * sin + dy * cos,
      };
    });
    this.store.setStrokePointPositions(this.anchorStrokeId, updates);
  }

  /** True when `pt` lies within `tol` of any segment of the stroke's path. */
  private pointOnPath(stroke: Stroke, pt: Point, tol: number): boolean {
    const pts = stroke.points;
    if (pts.length === 1) return Math.hypot(pts[0].x - pt.x, pts[0].y - pt.y) <= tol;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(pt, pts[i - 1], pts[i]) <= tol) return true;
    }
    return false;
  }

  // ---- Endpoint snap (hold Shift while drawing) ----------------------------

  /** True when endpoint snapping applies to the given tool. */
  private snapApplies(tool: Tool): boolean {
    return this.settings.endpointSnap && (tool === 'pen' || tool === 'marker' || tool === 'copic');
  }

  /**
   * Finds the endpoint (first or last point) of an existing drawing stroke on
   * a visible layer nearest to `pt`, or null when none is within the snap
   * sensitivity. The sensitivity is measured in screen pixels so the snap
   * feel stays the same at any zoom level.
   */
  private nearestEndpoint(pt: Point): SnapHit | null {
    let bestDist = this.settings.endpointSnapPx / this.surface.getViewport().zoom;
    let best: SnapHit | null = null;
    for (const stroke of this.store.sketch.strokes) {
      if (stroke.tool === 'eraser' || stroke.tool === 'text' || stroke.tool === 'image') continue;
      if (!effectiveLayer(this.store.sketch, layerOf(this.store.sketch, stroke)).visible) continue;
      const pts = stroke.points;
      if (pts.length === 0) continue;
      for (const at of ['start', 'end'] as const) {
        const end = at === 'start' ? pts[0] : pts[pts.length - 1];
        const dist = Math.hypot(end.x - pt.x, end.y - pt.y);
        if (dist <= bestDist) {
          bestDist = dist;
          best = { x: end.x, y: end.y, strokeId: stroke.id, at };
        }
      }
    }
    return best;
  }

  /**
   * Returns `pt` moved onto the nearest stroke endpoint when Shift is held
   * and one is in range, updating the snap-indicator ring either way.
   */
  private applyEndpointSnap(pt: Point, shiftKey: boolean, tool: Tool): Point {
    const target = shiftKey && this.snapApplies(tool) ? this.nearestEndpoint(pt) : null;
    this.setSnapTarget(target);
    return target ? { ...pt, x: target.x, y: target.y } : pt;
  }

  /** Updates the snap-indicator ring, re-rendering only when it changes. */
  private setSnapTarget(target: SnapHit | null): void {
    const prev = this.snapTarget;
    if (prev === target || (prev && target && prev.x === target.x && prev.y === target.y)) return;
    this.snapTarget = target;
    this.scheduleRender();
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
        // The copy's points are rotated below, so any anchor structure from
        // the source no longer describes them.
        vector: undefined,
        // Rotate the copic nib with the copy so every arm of the mandala
        // shows the same thick/thin chisel behaviour.
        ...(stroke.nibAngle != null
          ? { nibAngle: (stroke.nibAngle + (angle * 180) / Math.PI) % 360 }
          : {}),
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

  /**
   * Fits every graphic on the page into view (View > Fit All in View,
   * Ctrl+0). The viewport zooms and pans so the bounding box of all strokes
   * sits centered on the canvas with a little breathing room; an empty page
   * resets to the 1:1 origin.
   */
  private fitAllInView(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of this.store.sketch.strokes) {
      const b = strokeBounds(stroke);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) {
      this.surface.resetViewport();
      this.scheduleRender();
      return;
    }
    const pad = 32;
    const w = Math.max(1, maxX - minX + pad * 2);
    const h = Math.max(1, maxY - minY + pad * 2);
    // setViewport clamps the zoom, so read it back before centering.
    this.surface.setViewport({
      zoom: Math.min(this.surface.width / w, this.surface.height / h),
      panX: 0,
      panY: 0,
    });
    const zoom = this.surface.getViewport().zoom;
    this.surface.setViewport({
      zoom,
      panX: (this.surface.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      panY: (this.surface.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
    this.scheduleRender();
  }

  /** Enters two-finger gesture mode, discarding any in-progress interaction. */
  private beginGesture(): void {
    this.gesturing = true;
    // Abandon any single-pointer drawing or drag that was in progress so it
    // does not resume when the gesture ends.
    this.live = null;
    this.straightStart = null;
    this.straightEnd = null;
    this.straightRaw = null;
    this.shapeStart = null;
    this.curveA = null;
    this.curveB = null;
    this.curveBending = false;
    this.curveControl = null;
    this.quickCurve = false;
    this.quickCurveUniform = false;
    this.quickCurveApex = 0;
    this.vectorAnchors = [];
    this.vectorDragging = false;
    this.vectorHover = null;
    this.vectorEditDrag = null;
    this.startSnapHit = null;
    this.setSnapTarget(null);
    this.dragging = false;
    this.dragLast = null;
    this.rubberBandStart = null;
    this.rubberBandBox = null;
    this.textDragStart = null;
    this.textDragLive = null;
    this.anchorDragKind = null;
    this.handleDrag = null;
    this.anchorDragLast = null;
    this.panDragging = false;
    this.panLast = null;
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
    // Outline hits win; failing that, a click on a shape's painted fill (its
    // interior) selects the shape, so filled elements act solid. A click on
    // genuinely empty canvas still starts a rubber-band selection.
    const hit = this.hitTest(pt) ?? this.hitFilledInterior(pt);
    if (hit) {
      if (e.shiftKey) {
        // Shift-click toggles membership without dropping the rest.
        const ids = new Set(this.store.selectedIds);
        if (ids.has(hit.id)) ids.delete(hit.id);
        else ids.add(hit.id);
        this.store.setSelection(ids);
        if (!ids.has(hit.id)) return; // removed from the selection: no drag
      } else if (!this.store.selectedIds.has(hit.id)) {
        this.store.setSelection([hit.id]);
      }
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
    const effective = effectiveLayer(this.store.sketch, layerOf(this.store.sketch, stroke));
    return effective.visible && !effective.locked;
  }

  /** Selects every editable stroke on the page (Ctrl/Cmd + A). */
  private selectAll(): void {
    const ids = this.store.sketch.strokes.filter((s) => this.strokeEditable(s)).map((s) => s.id);
    if (ids.length === 0) {
      this.toast('Nothing to select.');
      return;
    }
    this.store.setSelection(ids);
    this.toast(`Selected ${ids.length} element${ids.length === 1 ? '' : 's'}.`);
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

  /**
   * Topmost filled shape whose painted interior contains the point.
   *
   * Used by the selection tools so a shape with a fill reads as solid: a
   * click on its color grabs it, while unfilled outlines stay click-through
   * (their middle is empty canvas, where rubber-banding must still work).
   */
  private hitFilledInterior(pt: Point): Stroke | null {
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!s.fill || s.tool === 'eraser' || s.points.length < 3) continue;
      if (!this.strokeEditable(s)) continue;
      if (pointInPolygon(pt, s.points)) return s;
    }
    return null;
  }

  /**
   * Like {@link hitTest}, but a click anywhere within an element's
   * dimensions counts, not just near its outline. Three passes, each
   * topmost-first: exact outline proximity, then shape interior
   * (point-in-polygon over the stroke's points), then bounding box.
   *
   * @param eligible Optional filter; ineligible strokes are skipped so the
   *   pick falls through to whatever sits beneath them.
   */
  private hitTestWithinBounds(pt: Point, eligible?: (s: Stroke) => boolean): Stroke | null {
    const strokes = this.store.sketch.strokes;
    const pickable = (s: Stroke): boolean =>
      this.strokeEditable(s) && (eligible === undefined || eligible(s));
    const exact = this.hitTest(pt);
    if (exact && pickable(exact)) return exact;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!pickable(s)) continue;
      if (s.points.length >= 3 && pointInPolygon(pt, s.points)) return s;
    }
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!pickable(s)) continue;
      const b = strokeBounds(s, (t) => this.surface.measureText(t));
      if (b && pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY) return s;
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

    // Select or Direct Select + Space pans: show a grab cursor.
    if (this.spaceDown && (tool === 'select' || tool === 'point')) {
      this.canvas.style.cursor = this.panDragging ? 'grabbing' : 'grab';
      return;
    }

    if (this.capsLockOn || this.spaceDown) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Selection arrows: black for Select, white for Direct Select — the
    // selection / direct-selection convention of vector editors.
    if (tool === 'select') {
      this.canvas.style.cursor = CURSOR_ARROW_BLACK;
      return;
    }
    if (tool === 'point') {
      this.canvas.style.cursor = CURSOR_ARROW_WHITE;
      return;
    }

    // Vector Path edit mode: the pointer follows the hover target and the
    // held modifier (see updateVectorEditCursor).
    if (tool === 'vector' && this.vectorEditId) {
      this.updateVectorEditCursor();
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
    if (
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'curve' ||
      tool === 'vector' ||
      tool === 'bucket' ||
      tool === 'fill' ||
      tool === 'eyedrop'
    ) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Copic marker: flat-nib cursor rotated to the current nib angle.
    // Other drawing tools: circle cursor sized to the current stroke width.
    const { url, hotspotX, hotspotY } =
      tool === 'copic'
        ? Surface.makeNibCursorDataUrl(
            this.store.tool.width,
            this.store.tool.color,
            this.store.tool.nibAngle,
          )
        : Surface.makeCursorDataUrl(this.store.tool.width, this.store.tool.color);
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

    for (const id of TOOL_IDS) {
      el(id).addEventListener('click', () => {
        if (this.rearranging) return;
        this.store.setTool({ tool: id.replace('tool-', '') as Tool });
        this.updateCursor();
      });
    }

    this.bindCurveFlyout();

    el('join-strokes').addEventListener('click', () => this.joinSelectedStrokes());

    this.rebuildSwatches();

    // Drag-to-reorder support (active only in rearrange mode). Every tool in
    // both toolbar groups takes part, and tools may move between the groups.
    this.makeSortable([el('tool-group'), el('sketch-group')], '.tool', () => this.persistToolOrder());
    this.makeSortable([el('swatches')], '.swatch', () => this.persistQuickColors());

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

  /**
   * Curve tool flyout: click and hold the Curve button to show its sibling
   * variants (like tool groups in common vector editors). The default variant
   * starts and ends the chord at nearby stroke endpoints; the sibling keeps
   * the chord ends free.
   */
  private bindCurveFlyout(): void {
    const btn = el('tool-curve');
    let holdTimer: number | null = null;

    const options = [
      { id: 'endpoints' as const, label: 'Curve — start and end at endpoints' },
      { id: 'free' as const, label: 'Curve — free ends' },
    ];

    const openFlyout = (): void => {
      this.closeToolFlyout();
      const menu = document.createElement('div');
      menu.className = 'tool-flyout';
      menu.id = 'tool-flyout';
      const rect = btn.getBoundingClientRect();
      menu.style.left = `${Math.round(rect.left)}px`;
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
      for (const option of options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = option.label;
        item.classList.toggle('is-active', this.curveVariant === option.id);
        item.addEventListener('click', () => {
          this.curveVariant = option.id;
          this.closeToolFlyout();
          this.updateCurveTitle();
          this.store.setTool({ tool: 'curve' });
          this.updateCursor();
          this.toast(
            option.id === 'endpoints'
              ? 'Curve snaps its start and end to stroke endpoints.'
              : 'Curve ends stay where the pointer is.',
          );
        });
        menu.appendChild(item);
      }
      document.body.appendChild(menu);
      // Dismiss on the next press outside the flyout.
      window.setTimeout(() => {
        window.addEventListener(
          'pointerdown',
          (ev) => {
            if (!(ev.target instanceof Node) || !menu.contains(ev.target)) this.closeToolFlyout();
          },
          { once: true, capture: true },
        );
      });
    };

    const cancelHold = (): void => {
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    btn.addEventListener('pointerdown', () => {
      if (this.rearranging) return;
      cancelHold();
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        openFlyout();
      }, 400);
    });
    btn.addEventListener('pointerup', cancelHold);
    btn.addEventListener('pointerleave', cancelHold);
  }

  /** Removes any open tool flyout menu. */
  private closeToolFlyout(): void {
    document.getElementById('tool-flyout')?.remove();
  }

  /** Reflects the active curve variant in the Curve button's hover text. */
  private updateCurveTitle(): void {
    el('tool-curve').title =
      this.curveVariant === 'endpoints'
        ? 'Curve (V) — drag a chord (ends snap to stroke endpoints), then bend and click. Click and hold for curve options'
        : 'Curve (V) — drag a chord, then bend and click. Click and hold for curve options';
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
        // Fill Shape: with the select tool active and a selection made,
        // picking a color fills the selected shape(s) instead of only
        // changing the ink color.
        if (this.store.tool.tool === 'select' && this.store.selectedIds.size > 0) {
          const result = this.store.fillSelected(color);
          if (result.filled > 0) this.toast(`Filled ${result.filled} shape(s) with ${color}.`);
          else if (result.recolored > 0) this.toast(`Recolored the selection with ${color}.`);
        }
        this.store.setTool({ color });
        this.updateCursor();
      });
      swatches.appendChild(btn);
    }
  }

  // ---- Settings application ------------------------------------------------

  /** Applies every setting to the live UI (called on load and on change). */
  private applySettings(): void {
    // Quick Settings live in AppSettings so the in-app panel and the
    // Verbose Settings window edit the same persisted values.
    const s = this.settings;
    this.store.setTool({
      liveSharpen: s.liveSharpen,
      symmetry: s.symmetry,
      fontSize: s.textSize,
    });
    this.store.setSharpen({
      wobble: s.sharpenWobble,
      simplifyEpsilon: s.sharpenSmoothing,
      circleTolerance: s.sharpenCircleSnap,
      taperEnds: s.sharpenTaperEnds,
    });
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

  /** Reorders the tool buttons (both groups) to match the saved tool order. */
  private applyToolOrder(): void {
    for (const id of this.settings.toolOrder) {
      const node = document.getElementById(id);
      const parent = node?.parentElement;
      if (node && parent && (parent.id === 'tool-group' || parent.id === 'sketch-group')) {
        parent.appendChild(node);
      }
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
      ...Array.from(el('sketch-group').querySelectorAll<HTMLElement>('.tool')),
      ...Array.from(el('swatches').querySelectorAll<HTMLElement>('.swatch')),
    ];
    for (const node of draggables) node.draggable = this.rearranging;

    this.toast(
      this.rearranging
        ? 'Rearrange mode on: drag tools and colors to reorder.'
        : 'Rearrange mode off.',
    );
  }

  /** Persists the current DOM order of every tool button (both groups). */
  private persistToolOrder(): void {
    const order = Array.from(
      document.querySelectorAll<HTMLElement>('#tool-group .tool, #sketch-group .tool'),
    ).map((n) => n.id);
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
   * Generic drag-to-reorder for the children of one or more containers,
   * active only while in rearrange mode. Items can move between the given
   * containers (like docking a tool elsewhere in a vector editor's toolbar).
   * Calls `onReorder` after a drop so the order can be saved.
   */
  private makeSortable(containers: HTMLElement[], itemSelector: string, onReorder: () => void): void {
    let dragEl: HTMLElement | null = null;

    for (const container of containers) {
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

  // ---- Quick Zoom ("Z" then a digit) ---------------------------------------

  /** Arms Quick Zoom; the next digit within the timer sets the zoom level. */
  private startQuickZoom(): void {
    this.quickZoomArmed = true;
    if (this.quickZoomTimer !== null) window.clearTimeout(this.quickZoomTimer);
    this.quickZoomTimer = window.setTimeout(() => {
      this.quickZoomArmed = false;
      this.quickZoomTimer = null;
    }, this.settings.quickTimerMs);
    this.toast('Quick zoom: press a digit (9 = 90%, 0 = 100%)…');
  }

  /** Applies a Quick Zoom digit: 1–9 => 10%–90%, 0 => 100% (centered). */
  private applyQuickZoom(digit: string): void {
    this.quickZoomArmed = false;
    if (this.quickZoomTimer !== null) {
      window.clearTimeout(this.quickZoomTimer);
      this.quickZoomTimer = null;
    }
    const d = Number(digit);
    const percent = d === 0 ? 100 : d * 10;
    const zoom = this.surface.getViewport().zoom;
    if (zoom > 0) {
      this.surface.zoomAt(percent / 100 / zoom, this.surface.width / 2, this.surface.height / 2);
    }
    this.scheduleRender();
    this.toast(`Zoom ${percent}%.`);
  }

  // ---- Copic quick nib-rotate (hold Ctrl, then Alt / Shift) ----------------

  /**
   * Called on keydown of the configured hold key. After the configured hold
   * time (with the key still down) the nib-rotate mode activates: the
   * bottom-right indicator appears and the rotate keys steer the broad nib.
   */
  private beginNibHold(): void {
    if (this.nibHoldDown) return;
    // Space (straight-line / quick-curve modes), the eyedropper, and the
    // Vector Path tool (whose Ctrl is direct-select mode) all borrow
    // modifier keys; never arm nib rotate underneath them.
    if (
      this.spaceDown ||
      this.eyedropTempSelect ||
      this.store.tool.tool === 'eyedrop' ||
      this.store.tool.tool === 'vector'
    ) {
      return;
    }
    this.nibHoldDown = true;
    this.nibHoldTimer = window.setTimeout(
      () => this.activateNibRotate(),
      Math.round(this.settings.copicHoldSec * 1000),
    );
  }

  /** Activates rotate mode once the hold key has been down long enough. */
  private activateNibRotate(): void {
    this.nibHoldTimer = null;
    if (!this.nibHoldDown) return;
    this.nibRotateActive = true;
    // Switch to the Copic marker at the configured width multiplier for the
    // duration of the mode, remembering the previous tool and width so both
    // come back when the hold key is released.
    this.lastUsedTool = this.store.tool.tool;
    this.lastUsedWidth = this.store.tool.width;
    this.nibModeWidth = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, Math.round(this.lastUsedWidth * this.settings.copicWidthMultiplier)),
    );
    this.store.setTool({ tool: 'copic', width: this.nibModeWidth });
    this.updateNibIndicator();
    el('nib-indicator').classList.remove('is-hidden');
  }

  /** Cancels a pending (not yet active) nib-rotate hold. */
  private cancelNibHold(): void {
    this.nibHoldDown = false;
    if (this.nibHoldTimer !== null) {
      window.clearTimeout(this.nibHoldTimer);
      this.nibHoldTimer = null;
    }
  }

  /** Ends rotate mode (hold key released, window blurred, or feature off). */
  private endNibRotate(): void {
    this.nibHoldDown = false;
    if (this.nibHoldTimer !== null) {
      window.clearTimeout(this.nibHoldTimer);
      this.nibHoldTimer = null;
    }
    if (!this.nibRotateActive) return;
    this.nibRotateActive = false;
    this.setNibRotateDir(0);
    el('nib-indicator').classList.add('is-hidden');
    // Hand the canvas back to the tool and width that were active before the
    // mode began, unless the user explicitly changed either while the mode
    // was active (their deliberate choice wins over the automatic restore).
    const restore: Partial<ToolState> = {};
    if (this.lastUsedTool && this.lastUsedTool !== 'copic' && this.store.tool.tool === 'copic') {
      restore.tool = this.lastUsedTool;
    }
    if (this.lastUsedWidth !== null && this.store.tool.width === this.nibModeWidth) {
      restore.width = this.lastUsedWidth;
    }
    if (Object.keys(restore).length > 0) this.store.setTool(restore);
    this.lastUsedTool = null;
    this.lastUsedWidth = null;
    this.nibModeWidth = null;
  }

  /** Starts, redirects, or stops (dir 0) the continuous nib rotation. */
  private setNibRotateDir(dir: 1 | -1 | 0): void {
    if (this.nibRotateDir === dir) return;
    this.nibRotateDir = dir;
    if (dir === 0) {
      cancelAnimationFrame(this.nibRotateRaf);
      return;
    }
    this.nibRotateLastTs = performance.now();
    cancelAnimationFrame(this.nibRotateRaf);
    this.nibRotateRaf = requestAnimationFrame((ts) => this.nibRotateStep(ts));
  }

  /** One animation frame of nib rotation at the configured speed. */
  private nibRotateStep(ts: number): void {
    if (!this.nibRotateActive || this.nibRotateDir === 0) return;
    const dt = Math.min(0.1, Math.max(0, (ts - this.nibRotateLastTs) / 1000));
    this.nibRotateLastTs = ts;
    const delta = this.nibRotateDir * this.settings.copicRotateSpeedDeg * dt;
    const nibAngle = ((this.store.tool.nibAngle + delta) % 360 + 360) % 360;
    this.store.setTool({ nibAngle });
    this.updateNibIndicator();
    if (this.store.tool.tool === 'copic') this.updateCursor();
    this.nibRotateRaf = requestAnimationFrame((t) => this.nibRotateStep(t));
  }

  /** Reflects the current nib angle in the bottom-right indicator. */
  private updateNibIndicator(): void {
    const angle = Math.round(this.store.tool.nibAngle) % 360;
    el('nib-indicator-bar').style.setProperty('--nib-angle', `${angle}deg`);
    el('nib-indicator-value').textContent = `${angle}°`;
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

    // Each Quick Setting applies immediately AND persists via the shared
    // settings store, keeping the Verbose Settings window in sync.
    el<HTMLInputElement>('live-sharpen').addEventListener('change', (e) => {
      const liveSharpen = (e.target as HTMLInputElement).checked;
      this.store.setTool({ liveSharpen });
      void this.saveSettings({ liveSharpen });
    });
    el<HTMLInputElement>('set-wobble').addEventListener('input', (e) => {
      const wobble = Number((e.target as HTMLInputElement).value);
      this.store.setSharpen({ wobble });
      void this.saveSettings({ sharpenWobble: wobble });
    });
    el<HTMLInputElement>('set-simplify').addEventListener('input', (e) => {
      const simplifyEpsilon = Number((e.target as HTMLInputElement).value);
      this.store.setSharpen({ simplifyEpsilon });
      void this.saveSettings({ sharpenSmoothing: simplifyEpsilon });
    });
    el<HTMLInputElement>('set-circle').addEventListener('input', (e) => {
      const circleTolerance = Number((e.target as HTMLInputElement).value);
      this.store.setSharpen({ circleTolerance });
      void this.saveSettings({ sharpenCircleSnap: circleTolerance });
    });
    el<HTMLInputElement>('set-taper').addEventListener('change', (e) => {
      const taperEnds = (e.target as HTMLInputElement).checked;
      this.store.setSharpen({ taperEnds });
      void this.saveSettings({ sharpenTaperEnds: taperEnds });
    });
    el<HTMLInputElement>('set-symmetry').addEventListener('input', (e) => {
      const symmetry = Number((e.target as HTMLInputElement).value);
      this.store.setTool({ symmetry });
      void this.saveSettings({ symmetry });
    });
    el<HTMLInputElement>('set-fontsize').addEventListener('input', (e) => {
      const fontSize = Number((e.target as HTMLInputElement).value);
      this.store.setTool({ fontSize });
      void this.saveSettings({ textSize: fontSize });
    });
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
    // Export offers the same four formats as File > Export, dropped down
    // beneath the button via the shared context menu.
    el('export').addEventListener('click', () => {
      const rect = el('export').getBoundingClientRect();
      this.showContextMenu(rect.left, rect.bottom + 4, [
        { label: 'PNG Image…', action: () => void this.exportRaster('png') },
        { label: 'JPEG Image…', action: () => void this.exportRaster('jpeg') },
        { label: 'SVG Vector…', action: () => void this.exportSvg() },
        { label: 'PDF Document…', action: () => void this.exportPdf() },
      ]);
    });
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
    await this.applyImportResult(result);
  }

  /** Applies one read import result to the current book (menu and CLI import). */
  private async applyImportResult(result: ImportFileSuccess): Promise<void> {
    if (result.kind === 'svg') {
      try {
        // Fully unnamed documents arrive as one layer named after the file.
        const imported = importSvg(result.text, { unnamedRootName: result.name });
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

  /**
   * Imports files handed over by the CLI (-i, --import / -m, --multiple-imports)
   * once the opening book is in place.
   *
   * Without `grid`, each file imports exactly like the File > Import menu item.
   * With `grid`, every file becomes its own layer and the graphics flow into
   * rows across the page: each fills the current row left to right and wraps
   * to a new row when the next one would overrun the page width.
   */
  private async importLaunchFiles(files: string[], grid: boolean): Promise<void> {
    if (!grid) {
      for (const file of files) {
        const result = await window.napkin.readImportFile(file);
        if (!result.ok) {
          this.toast(result.error ?? `Could not import ${file}.`);
          continue;
        }
        await this.applyImportResult(result);
      }
      return;
    }

    // Measure pass: read every file and record its graphic size (and the page
    // size) before anything is placed, so the row layout knows each footprint.
    const items: ImportGridItem[] = [];
    for (const file of files) {
      const result = await window.napkin.readImportFile(file);
      if (!result.ok) {
        this.toast(result.error ?? `Could not import ${file}.`);
        continue;
      }
      try {
        items.push(...(await importResultToGridItems(result)));
      } catch (err) {
        this.toast(`${result.name}: ${(err as Error).message}`);
      }
    }
    if (items.length === 0) return;

    this.placeImportedGrid(items);
    this.renderLayers();
    this.renderThumbnails();
    this.toast(`Imported ${items.length} graphic${items.length === 1 ? '' : 's'} into a grid.`);
  }

  /** Flows measured graphics into rows across the page, one layer per graphic. */
  private placeImportedGrid(items: ImportGridItem[]): void {
    const sketch = this.store.sketch;
    const margin = 24;
    const gap = 24;
    const maxRowWidth = Math.max(1, sketch.width - margin * 2);
    const maxHeight = Math.max(1, sketch.height - margin * 2);

    const nodes: ImportedLayerNode[] = [];
    let x = 0;
    let y = margin;
    let rowHeight = 0;
    for (const item of items) {
      // Oversized graphics scale down to the page; smaller ones keep their size.
      const scale = Math.min(1, maxRowWidth / item.width, maxHeight / item.height);
      const w = item.width * scale;
      const h = item.height * scale;
      if (x > 0 && x + w > maxRowWidth) {
        // The next graphic would overrun the page width: start a new row.
        x = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      transformImportedLayers(item.layers, scale, margin + x, y);
      nodes.push(...item.layers);
      x += w + gap;
      rowHeight = Math.max(rowHeight, h);
    }
    this.store.addImportedLayers(nodes);
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
    // "Panel in View" state on the toolbar toggle mirrors the panel.
    el('pages-toggle').classList.toggle('is-open', this.pagesOpen);
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
    el('group-layer').addEventListener('click', () => this.groupActiveLayer());
    el('delete-layer').addEventListener('click', () => this.deleteSelectedLayers());
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
    // "Panel in View" state on the toolbar toggle mirrors the panel.
    el('layers-toggle').classList.toggle('is-open', this.layersOpen);
    if (this.layersOpen) this.renderLayers();
    requestAnimationFrame(() => this.resizeSurface());
  }

  // ---- Panel context menus & resize ----------------------------------------

  /** Right-click menus on the pages and layers panels, scoped to each panel. */
  private bindContextMenus(): void {
    el('layers-panel').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, [
        {
          label: 'Add Layer',
          action: () => {
            this.store.addLayer();
            this.toast(`Added layer "${this.store.activeLayer.name}".`);
          },
        },
        { label: 'Group Layer', action: () => this.groupActiveLayer() },
        {
          label: 'Ungroup',
          disabled: this.store.activeLayer.group !== true,
          action: () => this.ungroupActiveLayer(),
        },
        { label: 'Rename', action: () => this.renameActiveLayerFromMenu() },
        { label: 'Delete Layer(s)', action: () => this.deleteSelectedLayers() },
        { separator: true },
        { label: 'Move Layer Up', action: () => this.store.moveLayer(this.store.activeLayer.id, 1) },
        { label: 'Move Layer Down', action: () => this.store.moveLayer(this.store.activeLayer.id, -1) },
        { separator: true },
        { label: 'Hide Layers Panel', action: () => this.toggleLayers(false) },
      ]);
    });

    el('pages-panel').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, [
        {
          label: 'Add Page',
          action: () => {
            this.store.addPage('unnamed');
            this.renderThumbnails();
            this.toast('Added a new page.');
          },
        },
        {
          label: 'Delete Page',
          disabled: this.store.book.sketches.length <= 1,
          action: () => {
            this.store.removePage();
            this.renderThumbnails();
          },
        },
        { separator: true },
        { label: 'Page Settings…', action: () => this.openPageSettings() },
        { separator: true },
        { label: 'Hide Pages Panel', action: () => this.togglePages(false) },
      ]);
    });

    window.addEventListener('pointerdown', (e) => {
      if (!(e.target instanceof Node) || !el('context-menu').contains(e.target)) {
        this.hideContextMenu();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideContextMenu();
    });
    window.addEventListener('blur', () => this.hideContextMenu());
  }

  /** Builds and positions the shared context menu at a client point. */
  private showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    const menu = el('context-menu');
    menu.innerHTML = '';
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-sep';
        menu.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label ?? '';
      btn.disabled = item.disabled === true;
      btn.addEventListener('click', () => {
        this.hideContextMenu();
        item.action?.();
      });
      menu.appendChild(btn);
    }
    menu.classList.remove('is-hidden');
    // Nudge the menu back on-screen when opened near a window edge.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  }

  private hideContextMenu(): void {
    el('context-menu').classList.add('is-hidden');
  }

  /** Opens the inline rename input on the active layer's row (context menu). */
  private renameActiveLayerFromMenu(): void {
    const row = document.querySelector<HTMLElement>('.layer-row.is-active');
    const label = row?.querySelector<HTMLElement>('.layer-name');
    if (row && label) {
      this.beginLayerRename(this.store.activeLayer.id, row, label);
    } else {
      this.toast('Select a layer row to rename it.');
    }
  }

  /** Drag handles on the panels' inner edges adjust each panel's width. */
  private bindPanelResize(): void {
    // The layers panel sits on the right, so dragging its handle left widens
    // it; the pages panel sits on the left and widens by dragging right.
    this.bindPanelResizeHandle('layers-resize', 'layers-panel', '--layers-width', -1);
    this.bindPanelResizeHandle('pages-resize', 'pages-panel', '--pages-width', 1);
  }

  /**
   * Wires one resize handle to its panel.
   *
   * @param direction +1 when dragging right widens the panel, -1 when
   *   dragging left does.
   */
  private bindPanelResizeHandle(
    handleId: string,
    panelId: string,
    cssVar: string,
    direction: 1 | -1,
  ): void {
    const handle = el(handleId);
    const panel = el(panelId);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
      panel.classList.add('is-resizing');
      const startX = e.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      const move = (ev: PointerEvent): void => {
        const delta = (ev.clientX - startX) * direction;
        const width = Math.min(480, Math.max(160, startWidth + delta));
        document.documentElement.style.setProperty(cssVar, `${Math.round(width)}px`);
        this.resizeSurface();
      };
      const up = (): void => {
        handle.classList.remove('is-dragging');
        panel.classList.remove('is-resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.resizeSurface();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ---- Page Settings (endless / sized pages) --------------------------------

  private bindPageSettings(): void {
    const sized = el<HTMLInputElement>('page-sized');
    sized.addEventListener('change', () => {
      el<HTMLInputElement>('page-width').disabled = !sized.checked;
      el<HTMLInputElement>('page-height').disabled = !sized.checked;
    });
    el('page-settings-apply').addEventListener('click', () => this.applyPageSettings());
    el('page-settings-close').addEventListener('click', () =>
      el('page-settings-dialog').classList.add('is-hidden'),
    );
  }

  /** Opens the Page Settings dialog pre-filled from the active page. */
  private openPageSettings(): void {
    const sketch = this.store.sketch;
    const sized = el<HTMLInputElement>('page-sized');
    sized.checked = sketch.sizeMode === 'sized';
    const width = el<HTMLInputElement>('page-width');
    const height = el<HTMLInputElement>('page-height');
    width.value = String(sketch.width);
    height.value = String(sketch.height);
    width.disabled = !sized.checked;
    height.disabled = !sized.checked;
    el('page-settings-dialog').classList.remove('is-hidden');
  }

  private applyPageSettings(): void {
    const sized = el<HTMLInputElement>('page-sized').checked;
    if (sized) {
      const width = Math.round(Number(el<HTMLInputElement>('page-width').value));
      const height = Math.round(Number(el<HTMLInputElement>('page-height').value));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) {
        this.toast('Enter a page width and height of at least 64 pixels.');
        return;
      }
      this.store.setPageSize('sized', Math.min(8192, width), Math.min(8192, height));
      this.toast(`Page sized to ${this.store.sketch.width} × ${this.store.sketch.height}.`);
    } else {
      // Endless pages fall back to tracking the window size.
      this.store.setPageSize('endless');
      this.toast('Page set to endless (fills the window).');
    }
    el('page-settings-dialog').classList.add('is-hidden');
    this.resizeSurface();
    this.renderThumbnails();
  }

  /** Wraps the selected layers (or the active layer) in a new group. */
  private groupActiveLayer(): void {
    const ids =
      this.store.selectedLayerIds.size > 0
        ? [...this.store.selectedLayerIds]
        : [this.store.activeLayer.id];
    const group = this.store.groupLayers(ids);
    this.toast(
      ids.length > 1
        ? `Grouped ${ids.length} layers into "${group.name}" (Ctrl+Shift+G ungroups).`
        : `Grouped "${group.name}" (Ctrl+Shift+G ungroups).`,
    );
  }

  /** Dissolves the active group, keeping its layers and strokes. */
  private ungroupActiveLayer(): void {
    const layer = this.store.activeLayer;
    if (this.store.ungroupActiveLayer()) this.toast(`Ungrouped "${layer.name}".`);
    else this.toast('Select a group row to ungroup (Ctrl+Shift+G).');
  }

  /**
   * Deletes every selected layer (falling back to the active one) together
   * with the elements on it, after a confirmation when strokes are involved.
   */
  private deleteSelectedLayers(): void {
    const ids =
      this.store.selectedLayerIds.size > 0
        ? [...this.store.selectedLayerIds]
        : [this.store.activeLayer.id];
    const doomed = new Set<string>();
    for (const id of ids) {
      doomed.add(id);
      for (const d of descendantLayerIds(this.store.sketch, id)) doomed.add(d);
    }
    if (!this.store.sketch.layers.some((l) => !l.group && !doomed.has(l.id))) {
      this.toast('A sketch needs at least one layer.');
      return;
    }
    const strokes = this.store.sketch.strokes.filter((s) => s.layer && doomed.has(s.layer)).length;
    if (
      strokes > 0 &&
      !confirm(`Delete ${ids.length} layer(s) and the ${strokes} element(s) on them?`)
    ) {
      return;
    }
    for (const id of ids) this.store.removeLayer(id);
  }

  /** Nesting depth of a layer (0 = top level), cycle-safe. */
  private layerDepth(layer: Layer): number {
    let depth = 0;
    const seen = new Set<string>([layer.id]);
    let parent = layer.parent;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      depth++;
      parent = this.store.sketch.layers.find((l) => l.id === parent)?.parent;
    }
    return depth;
  }

  /** True when any ancestor group of `layer` is collapsed in the panel. */
  private hasCollapsedAncestor(layer: Layer): boolean {
    const seen = new Set<string>([layer.id]);
    let parent = layer.parent;
    while (parent && !seen.has(parent)) {
      if (this.collapsedGroups.has(parent)) return true;
      seen.add(parent);
      parent = this.store.sketch.layers.find((l) => l.id === parent)?.parent;
    }
    return false;
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
      // Rows inside a collapsed group stay hidden.
      if (this.hasCollapsedAncestor(layer)) continue;
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.classList.toggle('is-active', layer.id === active.id);
      row.classList.toggle(
        'is-selected',
        this.store.selectedLayerIds.has(layer.id) && layer.id !== active.id,
      );
      row.classList.toggle('is-hidden', !effectiveLayer(this.store.sketch, layer).visible);
      row.classList.toggle('is-group', layer.group === true);
      // Indent nested layers under their group.
      const depth = this.layerDepth(layer);
      if (depth > 0) row.style.paddingLeft = `${depth * 14}px`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(layer.id === active.id));
      row.dataset.layerId = layer.id;
      row.draggable = true;

      // Disclosure caret: groups expand/collapse their nested rows.
      if (layer.group) {
        const caret = document.createElement('button');
        caret.className = 'layer-caret';
        caret.type = 'button';
        const collapsed = this.collapsedGroups.has(layer.id);
        caret.textContent = collapsed ? '▸' : '▾';
        caret.title = collapsed ? 'Expand group' : 'Collapse group';
        caret.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${layer.name}`);
        caret.setAttribute('aria-expanded', String(!collapsed));
        caret.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (collapsed) this.collapsedGroups.delete(layer.id);
          else this.collapsedGroups.add(layer.id);
          this.renderLayers();
        });
        row.appendChild(caret);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'layer-caret is-blank';
        spacer.setAttribute('aria-hidden', 'true');
        row.appendChild(spacer);
      }

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
      // Click selects the layer and highlights its elements on the canvas;
      // Shift-click adds/removes it; Ctrl/Cmd+Shift-click selects the range
      // between the active layer and this one.
      row.addEventListener('click', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) this.store.selectLayerRange(layer.id);
        else this.store.selectLayer(layer.id, ev.shiftKey);
      });
      this.bindLayerRowDnD(row, layer);
      list.appendChild(row);
    }

    const index = layers.findIndex((l) => l.id === active.id);
    el<HTMLInputElement>('layer-opacity').value = String(Math.round(active.opacity * 100));
    el('layer-opacity-value').textContent = `${Math.round(active.opacity * 100)}%`;
    el<HTMLButtonElement>('delete-layer').disabled = layers.filter((l) => !l.group).length <= 1;
    // Group rows themselves are not reorderable; their children are.
    el<HTMLButtonElement>('layer-up').disabled = active.group === true || index >= layers.length - 1;
    el<HTMLButtonElement>('layer-down').disabled = active.group === true || index <= 0;
  }

  /** HTML5 drag-and-drop for a layer row: reposition, or drop into a group. */
  private bindLayerRowDnD(row: HTMLElement, layer: Layer): void {
    row.addEventListener('dragstart', (e) => {
      this.layerDragId = layer.id;
      row.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', layer.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      this.layerDragId = null;
      row.classList.remove('dragging');
      this.clearLayerDropMarkers();
    });
    row.addEventListener('dragover', (e) => {
      if (!this.layerDragId || this.layerDragId === layer.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const zone = this.layerDropZone(row, layer, e.clientY);
      this.clearLayerDropMarkers();
      row.classList.add(zone === 'into' ? 'drop-into' : zone === 'above' ? 'drop-above' : 'drop-below');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-above', 'drop-below', 'drop-into');
    });
    row.addEventListener('drop', (e) => {
      if (!this.layerDragId || this.layerDragId === layer.id) return;
      e.preventDefault();
      const zone = this.layerDropZone(row, layer, e.clientY);
      const moved = this.store.reorderLayer(this.layerDragId, layer.id, zone);
      this.layerDragId = null;
      this.clearLayerDropMarkers();
      if (!moved) this.toast('That layer cannot be dropped there.');
      else if (zone === 'into') this.collapsedGroups.delete(layer.id);
    });
  }

  /**
   * Drop zone for a pointer over a layer row: group rows accept `into`
   * (their body) or `above` (their top edge); plain rows split above/below.
   */
  private layerDropZone(row: HTMLElement, layer: Layer, clientY: number): 'above' | 'below' | 'into' {
    const rect = row.getBoundingClientRect();
    const ratio = (clientY - rect.top) / Math.max(1, rect.height);
    if (layer.group) return ratio < 0.3 ? 'above' : 'into';
    return ratio < 0.5 ? 'above' : 'below';
  }

  /** Clears every drop-position marker in the layers panel. */
  private clearLayerDropMarkers(): void {
    for (const node of Array.from(
      el('layers-list').querySelectorAll('.drop-above, .drop-below, .drop-into'),
    )) {
      node.classList.remove('drop-above', 'drop-below', 'drop-into');
    }
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
          const effective = effectiveLayer(sketch, layerOf(sketch, s));
          if (!effective.visible) continue;
          tctx.globalAlpha = (s.opacity ?? defaultOpacityFor(s.tool)) * effective.opacity;
          tctx.strokeStyle = s.tool === 'eraser' ? sketch.background : s.color;
          tctx.lineWidth = s.width;
          tctx.beginPath();
          s.points.forEach((p, i) => (i ? tctx.lineTo(p.x, p.y) : tctx.moveTo(p.x, p.y)));
          if (s.fill && s.tool !== 'eraser' && s.points.length > 2) {
            tctx.closePath();
            tctx.fillStyle = s.fill;
            tctx.fill();
          }
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
      case 'fit-view':
        this.fitAllInView();
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

      // Track Ctrl while a vector edit is open: holding it reveals the
      // corner-rounding target and switches the pointer to the Select arrow.
      if (e.key === 'Control' && !this.ctrlDown) {
        this.ctrlDown = true;
        if (this.vectorEditId) {
          this.updateVectorEditCursor();
          this.scheduleRender();
        }
      }

      // Vector Path: Alt is the handle-toggle modifier — keep the keypress
      // from reaching the native menu bar, which would steal focus (the
      // resulting blur would put the edited path down mid-gesture). Holding
      // it shows the stemless arrowhead pointer.
      if (e.key === 'Alt' && this.store.tool.tool === 'vector') {
        e.preventDefault();
        if (!this.altDown) {
          this.altDown = true;
          if (this.vectorEditId) this.updateVectorEditCursor();
        }
      }

      // Sharpen Selection dialog: Escape cancels the preview.
      if (e.key === 'Escape' && this.sharpenPreview) {
        e.preventDefault();
        this.closeSharpenDialog(false);
        return;
      }

      // Vector Path edit mode: Escape puts the path down.
      if (e.key === 'Escape' && this.vectorEditId) {
        e.preventDefault();
        this.exitVectorEdit();
        return;
      }

      // Vector Path: Enter commits the open path, Escape abandons it.
      if (e.key === 'Enter' && this.store.tool.tool === 'vector' && this.vectorAnchors.length >= 2) {
        e.preventDefault();
        this.commitVectorPath(false);
        return;
      }
      if (e.key === 'Escape' && this.vectorAnchors.length > 0) {
        e.preventDefault();
        this.cancelVectorPath();
        return;
      }

      // Escape abandons a pending curve (chord or bend phase).
      if (e.key === 'Escape' && (this.curveA !== null || this.curveBending)) {
        e.preventDefault();
        this.cancelCurve();
        return;
      }

      // Quick curve: Alt swaps the quarter ellipse for a quarter circle for
      // as long as it is held, so the arc can be toggled mid-drag. Claimed
      // before the Copic nib-rotate block, which also listens for modifiers.
      if (e.key === 'Alt' && this.quickCurve) {
        e.preventDefault();
        this.setQuickCurveUniform(true);
        return;
      }

      // Quick curve: each Shift press swings the arc's apex another 90 degrees
      // clockwise. Auto-repeat is ignored so a held key parks the apex at one
      // angle instead of spinning it.
      if (e.key === 'Shift' && this.quickCurve) {
        e.preventDefault();
        if (!e.repeat) this.turnQuickCurveApex();
        return;
      }

      // Straight line: pressing Shift mid-drag locks the line to a strict
      // horizontal or vertical immediately, before the pointer next moves.
      if (e.key === 'Shift' && this.straightStart !== null && !e.repeat) {
        this.updateStraightEnd(true);
        return;
      }

      // Escape drops the Direct Select anchor edit.
      if (e.key === 'Escape' && this.anchorStrokeId !== null) {
        e.preventDefault();
        this.anchorStrokeId = null;
        this.selectedAnchors.clear();
        this.pathSelected = false;
        this.anchorDragKind = null;
        this.handleDrag = null;
        this.anchorDragLast = null;
        this.scheduleRender();
        return;
      }

      // Eyedropper: holding Ctrl temporarily switches to the select tool so
      // a shape can be picked; releasing Ctrl returns to the eyedropper.
      if (e.key === 'Control' && this.store.tool.tool === 'eyedrop' && !this.eyedropTempSelect) {
        this.eyedropTempSelect = true;
        this.store.setTool({ tool: 'select' });
        this.updateCursor();
      }

      // Copic quick nib-rotate: holding the hold key arms the timer; once
      // active, the rotate keys steer the broad nib and are consumed.
      if (this.settings.copicQuickRotate) {
        if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicHoldKey]) {
          this.beginNibHold();
        }
        if (this.nibRotateActive) {
          if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicRotateCwKey]) {
            e.preventDefault();
            this.setNibRotateDir(1);
            return;
          }
          if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicRotateCcwKey]) {
            e.preventDefault();
            this.setNibRotateDir(-1);
            return;
          }
        }
      }

      // Space (held) arms straight-line mode for the next single-pointer
      // drag; with Ctrl also held it arms the quick curve instead.
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.cancelNibHold();
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

      // Quick Zoom: after Z, the next digit sets the zoom (9 => 90%, 0 => 100%).
      if (this.quickZoomArmed && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        this.applyQuickZoom(e.key);
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
      } else if (mod && key === 'a' && e.shiftKey) {
        // Deselect all (Ctrl/Cmd + Shift + A).
        e.preventDefault();
        this.store.clearSelection();
      } else if (mod && key === 'a') {
        // Select all editable strokes (Ctrl/Cmd + A).
        e.preventDefault();
        this.selectAll();
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
      } else if (mod && key === 'j') {
        e.preventDefault();
        this.joinSelectedStrokes();
      } else if (mod && key === 'g' && e.shiftKey) {
        e.preventDefault();
        this.ungroupActiveLayer();
      } else if (mod && key === 'g') {
        e.preventDefault();
        this.groupActiveLayer();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.store.selectedIds.size > 0) {
        e.preventDefault();
        this.store.deleteSelected();
      } else if (!mod && key === 'p') {
        this.store.setTool({ tool: 'pen' });
        this.updateCursor();
      } else if (!mod && key === 'm') {
        this.store.setTool({ tool: 'marker' });
        this.updateCursor();
      } else if (!mod && key === 'k') {
        this.store.setTool({ tool: 'copic' });
        this.updateCursor();
      } else if (!mod && key === 'e') {
        this.store.setTool({ tool: 'eraser' });
        this.updateCursor();
      } else if (!mod && key === 's') {
        this.store.setTool({ tool: 'select' });
        this.updateCursor();
      } else if (!mod && key === 'a') {
        this.store.setTool({ tool: 'point' });
        this.updateCursor();
      } else if (!mod && key === 't') {
        this.store.setTool({ tool: 'text' });
        this.updateCursor();
      } else if (!mod && key === 'r') {
        this.store.setTool({ tool: 'rect' });
        this.updateCursor();
      } else if (!mod && key === 'l') {
        this.store.setTool({ tool: 'ellipse' });
        this.updateCursor();
      } else if (!mod && key === 'v') {
        this.store.setTool({ tool: 'curve' });
        this.updateCursor();
      } else if (!mod && key === 'b') {
        this.store.setTool({ tool: 'vector' });
        this.updateCursor();
      } else if (!mod && key === 'g') {
        this.store.setTool({ tool: 'bucket' });
        this.updateCursor();
      } else if (!mod && key === 'i') {
        this.store.setTool({ tool: 'eyedrop' });
        this.updateCursor();
      } else if (!mod && key === 'h') {
        this.sharpenAll();
      } else if (!mod && key === 'w') {
        this.startQuickEntry('width');
      } else if (!mod && key === 'q') {
        this.startQuickEntry('opacity');
      } else if (!mod && key === 'z') {
        this.startQuickZoom();
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

      // Quick curve: releasing Alt returns the arc to a quarter ellipse.
      if (e.key === 'Alt' && this.quickCurve) {
        e.preventDefault();
        this.setQuickCurveUniform(false);
      }

      // Straight line: releasing Shift frees the horizontal/vertical lock.
      if (e.key === 'Shift' && this.straightStart !== null) {
        this.updateStraightEnd(false);
      }

      // Endpoint snap: releasing Shift dismisses the snap-indicator ring.
      if (e.key === 'Shift') this.setSnapTarget(null);

      // Releasing Ctrl hides the corner-rounding target and restores the
      // hover pointer.
      if (e.key === 'Control' && this.ctrlDown) {
        this.ctrlDown = false;
        if (this.vectorEditId) {
          this.updateVectorEditCursor();
          this.scheduleRender();
        }
      }

      // Vector Path: an Alt keyup would otherwise focus the native menu bar
      // and blur the canvas mid-edit. The held-Alt flag resets regardless of
      // the active tool so a stale arrowhead pointer cannot linger.
      if (e.key === 'Alt') {
        if (this.store.tool.tool === 'vector') e.preventDefault();
        if (this.altDown) {
          this.altDown = false;
          if (this.vectorEditId) this.updateVectorEditCursor();
        }
      }

      // Eyedropper: releasing Ctrl ends the temporary select tool.
      if (e.key === 'Control' && this.eyedropTempSelect) {
        this.eyedropTempSelect = false;
        this.store.setTool({ tool: 'eyedrop' });
        this.updateCursor();
      }

      // Copic quick nib-rotate: releasing the hold key ends the mode;
      // releasing a rotate key stops the spin in that direction. Runs even
      // when the feature was toggled off mid-hold so no state gets stuck.
      // preventDefault keeps an Alt keyup from focusing the native menu bar.
      if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicHoldKey]) {
        if (this.nibRotateActive) e.preventDefault();
        this.endNibRotate();
      } else if (this.nibRotateActive) {
        if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicRotateCwKey]) {
          e.preventDefault();
          if (this.nibRotateDir === 1) this.setNibRotateDir(0);
        }
        if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicRotateCcwKey]) {
          e.preventDefault();
          if (this.nibRotateDir === -1) this.setNibRotateDir(0);
        }
      }
    });

    // A lost focus swallows keyup events; never leave rotate mode, the
    // eyedropper's temporary select, or a pending curve stuck on.
    window.addEventListener('blur', () => {
      this.endNibRotate();
      if (this.eyedropTempSelect) {
        this.eyedropTempSelect = false;
        this.store.setTool({ tool: 'eyedrop' });
        this.updateCursor();
      }
      if (this.curveA !== null || this.curveBending) this.cancelCurve();
      // A pending vector path is accepted rather than lost when the window
      // loses focus (a too-short path drops in the commit).
      if (this.vectorAnchors.length > 0) this.commitVectorPath(false);
      this.vectorEditDrag = null;
      this.ctrlDown = false;
      this.altDown = false;
      this.updateCursor();
      if (this.sharpenPreview) this.closeSharpenDialog(false);
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

    // Leaving the Vector Path tool commits its pending path — switching to
    // any other tool (a shortcut like `S`, a toolbar click) accepts the
    // curve as drawn; only `Esc` abandons it. A path still too short to be
    // a stroke is dropped by the commit itself.
    if (tool !== 'vector' && this.vectorAnchors.length > 0) {
      this.commitVectorPath(false);
    }
    if (tool !== 'vector' && this.vectorEditId) {
      this.exitVectorEdit();
    }
    el('vector-options').classList.toggle('is-hidden', tool !== 'vector');

    // Leaving the Direct Select tool drops its anchor-edit state.
    if (tool !== 'point' && this.anchorStrokeId !== null) {
      this.anchorStrokeId = null;
      this.selectedAnchors.clear();
      this.pathSelected = false;
      this.anchorDragKind = null;
      this.handleDrag = null;
      this.anchorDragLast = null;
    }

    for (const id of TOOL_IDS) {
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

/** One entry in the shared right-click context menu. */
interface ContextMenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  /** Renders a divider line instead of a button. */
  separator?: boolean;
}

/** A successfully read import, before it is applied to the book. */
type ImportFileSuccess = Extract<ImportFileResult, { ok: true }>;

/** One measured graphic waiting for a spot in the CLI import grid. */
interface ImportGridItem {
  name: string;
  /** Natural (unscaled) size of the graphic in page units. */
  width: number;
  height: number;
  /** Layer tree holding the graphic's strokes in its own local coordinates. */
  layers: ImportedLayerNode[];
}

/**
 * Converts a read import into measured grid items.
 *
 * An SVG becomes one item (multi-layer documents keep their layers under a
 * group named after the file), a raster image becomes one image item, and a
 * PDF contributes one item per page.
 */
async function importResultToGridItems(result: ImportFileSuccess): Promise<ImportGridItem[]> {
  if (result.kind === 'svg') {
    // Unnamed content is named after the file; a lone named top layer (e.g.
    // a document-wide "circles" group) keeps the name the author gave it.
    const imported = importSvg(result.text, { unnamedRootName: result.name });
    const layers: ImportedLayerNode[] =
      imported.layers.length > 1
        ? [{ name: result.name, opacity: 1, strokes: [], children: imported.layers }]
        : imported.layers;
    return [{ name: result.name, width: imported.width, height: imported.height, layers }];
  }

  if (result.kind === 'pdf') {
    return result.pages.map((page, index) => {
      const name = result.pages.length === 1 ? result.name : `${result.name}-${index + 1}`;
      return {
        name,
        width: Math.max(1, page.width),
        height: Math.max(1, page.height),
        layers: [{ name, opacity: 1, strokes: page.strokes.map((s) => ({ ...s })) }],
      };
    });
  }

  const img = await loadImage(result.dataUrl);
  const stroke: Stroke = {
    id: createId('im'),
    tool: 'image',
    color: '#1f2328',
    width: 1,
    points: [{ x: 0, y: 0, pressure: 0.5 }],
    image: result.dataUrl,
    imageWidth: img.naturalWidth,
    imageHeight: img.naturalHeight,
    sharpened: true,
  };
  return [
    {
      name: result.name,
      width: Math.max(1, img.naturalWidth),
      height: Math.max(1, img.naturalHeight),
      layers: [{ name: result.name, opacity: 1, strokes: [stroke] }],
    },
  ];
}

/** Scales and offsets every stroke in an imported layer tree, in place. */
function transformImportedLayers(
  layers: ImportedLayerNode[],
  scale: number,
  dx: number,
  dy: number,
): void {
  for (const layer of layers) {
    for (const stroke of layer.strokes) {
      stroke.points = stroke.points.map((p) => ({
        ...p,
        x: p.x * scale + dx,
        y: p.y * scale + dy,
      }));
      stroke.width = Math.max(0.5, stroke.width * scale);
      if (stroke.fontSize !== undefined) stroke.fontSize *= scale;
      if (stroke.imageWidth !== undefined) stroke.imageWidth *= scale;
      if (stroke.imageHeight !== undefined) stroke.imageHeight *= scale;
    }
    if (layer.children) transformImportedLayers(layer.children, scale, dx, dy);
  }
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

/**
 * Maps the active tool to the drawing tool a quick-mode stroke commits as
 * (UI-only tools like the shape tools and bucket fall back to the pen).
 */
function drawingToolOf(tool: Tool): Tool {
  return tool === 'pen' || tool === 'marker' || tool === 'copic' || tool === 'eraser'
    ? tool
    : 'pen';
}

/** Deep-copies vector anchors so working copies never alias stored strokes. */
function cloneAnchors(anchors: VectorAnchor[]): VectorAnchor[] {
  return anchors.map((a) => ({
    p: { ...a.p },
    ...(a.hIn ? { hIn: { ...a.hIn } } : {}),
    ...(a.hOut ? { hOut: { ...a.hOut } } : {}),
  }));
}

/**
 * Samples the segments between vector anchors into stroke points. Each
 * segment is the cubic Bézier steered by its anchors' handles; a segment
 * with no handles on either end is a straight line and needs no
 * intermediate samples. `closed` appends the segment back to the first
 * anchor.
 */
function sampleVectorPathPoints(anchors: VectorAnchor[], closed: boolean): Point[] {
  if (anchors.length === 0) return [];
  const out: Point[] = [{ x: anchors[0].p.x, y: anchors[0].p.y, pressure: 0.5 }];
  const addSegment = (from: VectorAnchor, to: VectorAnchor): void => {
    if (!from.hOut && !to.hIn) {
      out.push({ x: to.p.x, y: to.p.y, pressure: 0.5 });
      return;
    }
    const a = { x: from.p.x, y: from.p.y, pressure: 0.5 };
    const b = { x: to.p.x, y: to.p.y, pressure: 0.5 };
    out.push(...cubicBezierPoints(a, from.hOut ?? from.p, to.hIn ?? to.p, b).slice(1));
  };
  for (let i = 1; i < anchors.length; i++) addSegment(anchors[i - 1], anchors[i]);
  if (closed && anchors.length >= 2) addSegment(anchors[anchors.length - 1], anchors[0]);
  return out;
}

/** Closed rectangle outline for a drag from `a` to `b` (uniform = square). */
function rectPoints(a: Point, b: Point, uniform: boolean): Point[] {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (uniform) {
    const size = Math.min(Math.abs(dx), Math.abs(dy));
    dx = (Math.sign(dx) || 1) * size;
    dy = (Math.sign(dy) || 1) * size;
  }
  const x2 = a.x + dx;
  const y2 = a.y + dy;
  const P = (x: number, y: number): Point => ({ x, y, pressure: 0.5 });
  return [P(a.x, a.y), P(x2, a.y), P(x2, y2), P(a.x, y2), P(a.x, a.y)];
}

/** Closed ellipse outline for a drag from `a` to `b` (uniform = circle). */
function ellipsePoints(a: Point, b: Point, uniform: boolean, samples = 64): Point[] {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (uniform) {
    const size = Math.min(Math.abs(dx), Math.abs(dy));
    dx = (Math.sign(dx) || 1) * size;
    dy = (Math.sign(dy) || 1) * size;
  }
  const cx = a.x + dx / 2;
  const cy = a.y + dy / 2;
  const rx = Math.abs(dx) / 2;
  const ry = Math.abs(dy) / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const angle = (Math.PI * 2 * i) / samples;
    pts.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, pressure: 0.5 });
  }
  return pts;
}

/** Samples a quadratic bezier from `a` to `b` through control point `c`. */
function quadraticPoints(a: Point, c: { x: number; y: number }, b: Point, samples = 48): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
      pressure: 0.5,
    });
  }
  return pts;
}

/** Even-odd (ray cast) point-in-polygon test; the polygon closes implicitly. */
function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
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
