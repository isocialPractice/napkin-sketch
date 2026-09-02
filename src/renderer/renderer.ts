/**
 * Renderer entry point.
 *
 * Wires the toolbar, native-menu actions, pointer input (mouse / touch / pen
 * with pressure), the drawing {@link Surface}, the {@link Store}, the
 * auto-sharpen engine, the pages panel, the sharpen-settings panel, text
 * editing, selection/move, and symmetry mode into the running GUI.
 */

import {
  createGradient,
  createId,
  createSketch,
  createSketchBook,
  DEFAULT_FONT_FAMILY,
  defaultOpacityFor,
  descendantLayerIds,
  effectiveLayer,
  effectiveLayers,
  hasOutline,
  isClosedStroke,
  isImageStroke,
  isTextStroke,
  layerOf,
  normalizedStops,
  strokesByLayer,
  STROKE_STYLES,
  type Gradient,
  type GradientStop,
  type Layer,
  type Point,
  type Sketch,
  type Stroke,
  type StrokeStyle,
  type Tool,
  type VectorAnchor,
} from '../core/types.js';
import {
  formatLength,
  isLengthUnit,
  isScaleUnit,
  LENGTH_UNITS,
  nudgeStep,
  SCALE_UNITS,
  toPx,
  unitStep,
  type LengthUnit,
  type ScaleUnit,
} from '../core/units.js';
import {
  animationFrameJob,
  animationFrameName,
  animationFrameOffsetX,
  animationFrameTransforms,
  animationPoseStep,
  clampSequenceFrames,
  defaultSequenceFrames,
  MAX_SEQUENCE_FRAMES,
  MIN_SEQUENCE_FRAMES,
  animationTypeSpec,
  ANIMATION_TYPES,
  assemblyPivot,
  buildAnimationForm,
  expandBounds,
  findAssemblyLayers,
  matchesAssembly,
  missingAssemblies,
  topMostParent,
  REQUIRED_ASSEMBLIES,
  type AnimationBounds,
  type AnimationCategory,
  type AnimationFrameJob,
  type AnimationPoint,
  type RequiredAssembly,
} from '../core/animation.js';
import type {
  AnimationFrameOutput,
  ExportFormat,
  ImageFormat,
  ImportFileResult,
  MenuAction,
} from '../core/ipc.js';
import type { LaunchOptions } from '../core/launch.js';
import { sketchesToPdf } from '../core/pdf.js';
import { defaultSettings, type AppSettings, type QuickModifier } from '../core/settings.js';
import {
  catmullRom,
  constrainDrag,
  cubicBezierPoints,
  normalizeRotation,
  quarterArcCubic,
  rotationStep,
  roundedCornerAnchors,
  simplify,
  snapRotation,
  splitCubicBezier,
} from '../sharpen/geometry.js';
import { PopupManager } from './popup.js';
import { sharpenStroke } from '../sharpen/sharpen.js';
import { Surface, strokeBounds, type LiveStroke } from './surface.js';
import { Store, type ImportedLayerNode, type LayerTreeNode, type ToolState } from './store.js';
import { importSvg } from './svg-import.js';

/** Looks up a required element by id, throwing a clear error if absent. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

/**
 * Bounds on a single scale operation from the properties panel. A stray digit
 * in a percentage field would otherwise throw the geometry clean off the page
 * (or collapse it to nothing, which no later scale could recover).
 */
const SCALE_FACTOR_MIN = 0.01;
const SCALE_FACTOR_MAX = 100;

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

/**
 * Sized-page bounds, matching the `min`/`max` on the Page Settings fields. A
 * page measured from a selection is clamped to them too, so every route to a
 * sized page lands somewhere the dialog would have accepted.
 */
const MIN_PAGE_SIZE = 64;
const MAX_PAGE_SIZE = 8192;

/**
 * How far a paste or a duplicate lands from what it came from, when there is
 * no pointer over the canvas to aim at. Far enough that the copy reads as a
 * second object rather than a smudge on the first.
 */
const PASTE_OFFSET = 16;

/**
 * How long a nested menu panel stays put after the pointer leaves the row that
 * opened it. Enough to cross the rows between that row and the panel, short
 * enough that a panel deliberately left behind does not linger.
 */
const SUBMENU_GRACE_MS = 320;

/** Page-turn animation length; must match `.turn-next`/`.turn-prev` in styles.css. */
const PAGE_TURN_MS = 360;

/**
 * Page thumbnails: the fallback CSS width used before the pages panel has been
 * laid out, and the horizontal chrome to subtract from the list's client width
 * (`.thumbs` padding plus the `.thumb` border, both sides).
 */
const THUMB_WIDTH = 150;
const THUMB_CHROME_PX = 28;

/** How long the mandala symmetry guide takes to fade in or out. */
const SYMMETRY_FADE_MS = 220;

/** True when the OS asks for reduced motion; animations are skipped outright. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

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
/**
 * The Alt-drag copy pointer: the Select arrow with a second one stepped out
 * behind it, filled the inverse of the common cursor so the pair reads as two
 * objects rather than one thick arrow, and a node square marking the copy the
 * drag is carrying.
 */
const CURSOR_ARROW_COPY = svgCursor(
  `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='25'>` +
    // The offset arrow, stepped clear to the right rather than laid over the
    // first: two arrows sharing a diagonal tangle into one thick smear.
    `<g transform='translate(12 2)'><path d='M1 1 L1 14.5 L4.6 11.4 L6.8 16 L9.3 14.9 L7.1 10.5 L11.8 10.5 Z' fill='#ffffff' stroke='#1f2328' stroke-width='1.3' stroke-linejoin='round'/></g>` +
    `<path d='M1 1 L1 14.5 L4.6 11.4 L6.8 16 L9.3 14.9 L7.1 10.5 L11.8 10.5 Z' fill='#1f2328' stroke='#ffffff' stroke-width='1.2' stroke-linejoin='round'/>` +
    `<rect x='21' y='17' width='6' height='6' fill='#ffffff' stroke='#1f2328' stroke-width='1.3'/>` +
    `</svg>`,
  1,
  1,
  'copy',
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

/**
 * The Rotate tool's canvas pointer: the three-quarter sweep with an arrowhead
 * on its clockwise end, which is the shape a rotate handle carries in every
 * editor that has one.
 *
 * Unlike the arrows above it is a file rather than inline markup, because the
 * Move palette's crosshair is already a file and the two are drawn as a pair -
 * one icon, one place to change it. The white underlay in the file is what
 * keeps the sweep readable where the pointer crosses dark ink.
 */
const CURSOR_ROTATE = "url('../assets/rotate-popup.svg') 16 16, grab";

/** KeyboardEvent.key value produced by each configurable quick-feature modifier. */
const MODIFIER_EVENT_KEYS: Record<QuickModifier, string> = {
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
};

/**
 * The step a constrained rotation lands on. Fifteen degrees divides a quarter
 * turn into six and a full turn into twenty-four, so the angles a sketch
 * actually wants - 15, 30, 45, 90, 180 - are all on it.
 */
const ROTATE_SNAP_DEGREES = 15;

/**
 * How close to the Rotate tool's pivot marker a press has to land to pick it
 * up instead of starting a rotation, in screen pixels. Slightly wider than
 * the marker itself, because a pivot that cannot be grabbed at the first try
 * reads as one that cannot be moved at all.
 */
const ROTATE_CENTER_GRAB = 14;

/** The nine handles of a bounding box, as a rotation centre can be put on any. */
const ROTATE_ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const;

type RotateAnchor = (typeof ROTATE_ANCHORS)[number];

/** Type guard for a preset centre read back off a button's dataset. */
function isRotateAnchor(value: unknown): value is RotateAnchor {
  return typeof value === 'string' && (ROTATE_ANCHORS as readonly string[]).includes(value);
}

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

  /**
   * Move, resize, dock, and undock for every editing popup. Docking changes
   * the width of the workspace, so the surface is re-measured when it does.
   */
  private readonly popups = new PopupManager(() => this.resizeSurface());

  private live: LiveStroke | null = null;
  private activePointerId: number | null = null;
  private renderQueued = false;
  /** Animation-frame handle for a pending panel sync, or null when none is due. */
  private uiSyncFrame: number | null = null;
  private toastTimer: number | null = null;

  // Symmetry guide fade: current opacity, the axis count it is drawn with
  // (held through a fade-out), and the timestamp of the last fade step.
  private symmetryFade = 0;
  private symmetryGuideAxes = 1;
  private symmetryFadeAt = 0;

  // Select-tool drag state (moving selected strokes).
  private dragging = false;
  private dragLast: Point | null = null;

  /** Where the move drag began, which a Shift-held drag measures its axis from. */
  private dragOrigin: Point | null = null;

  /** True once a move drag has actually shifted the selection. */
  private dragMoved = false;

  /**
   * Set when a press over empty canvas left a multi-element selection in
   * place. The selection goes when the gesture resolves into a rubber band
   * or a bare click, not on the press itself.
   */
  private pendingSelectionClear = false;

  /**
   * The element a Shift-press landed on while it was already selected. Shift
   * there means either "take this out of the selection" or "constrain this
   * drag", and which one only becomes clear when the pointer moves or does
   * not, so the removal waits for the release.
   */
  private shiftToggleId: string | null = null;

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

  /** Page Settings is standing in as the size prompt for a page not yet added. */
  private pageSettingsAddsPage = false;

  /** The button whose press opened the menu, so its next press closes it. */
  private menuOwner: HTMLElement | null = null;

  /**
   * Copied elements, held by the app rather than by a page, so a copy taken
   * on one page pastes onto another. `origin` is the top-left of what was
   * copied, which is what Paste in Place puts back and what a pointer paste
   * measures its offset from.
   *
   * A copy taken from layer rows that include a group keeps its `tree`: the
   * paste rebuilds those layers instead of flattening the graphic onto one.
   * Everything else copies `flat`, which is what a handful of marks picked
   * out on the canvas should do.
   */
  private clipboard: ClipboardContents | null = null;

  /** The SVG last written to the system clipboard, to spot a newer outside copy. */
  private clipboardSvgSent = '';

  /** How many times the clipboard has been pasted without a pointer to aim at. */
  private pasteCascade = 0;

  /** Latest pointer position over the canvas, in sketch coordinates. */
  private lastCanvasPoint: Point | null = null;

  /** Whether the pointer is currently over the canvas at all. */
  private pointerOverCanvas = false;

  /** Pending close of the nested panel, cancelled if the pointer reaches it. */
  private submenuCloseTimer: number | null = null;

  private pagesOpen = false;
  private layersOpen = false;
  private propertiesOpen = false;

  // Units the properties panel reads and writes its fields in.
  private propUnits: { x: LengthUnit; y: LengthUnit; scaleX: ScaleUnit; scaleY: ScaleUnit } = {
    x: 'px',
    y: 'px',
    scaleX: '%',
    scaleY: '%',
  };

  // Index of the gradient stop the editor's fields are pointed at.
  private gradientStop = 0;
  // True while a gradient handle or the angle slider is being dragged: the
  // bar must not be rebuilt under the pointer, and the whole drag collapses
  // into one history step.
  private gradientDragging = false;
  // True while the fill color picker is open (same one-history-step rule).
  private fillDragging = false;

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

  /** Where the pan began, in client pixels, for the Shift constraint. */
  private panOrigin: { x: number; y: number } | null = null;

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

  /** Where the anchor/handle/path drag began, for the Shift constraint. */
  private anchorDragOrigin: Point | null = null;
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

  /** An Alt-drag copy is under way, so the pointer keeps the copy arrows. */
  private copyDragging = false;
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

  /**
   * True when Animation Mode is installed. The feature is an optional add-on
   * (npm run animation-mode -- --install) because it needs an AI tool the app
   * does not ship; with no install every entry point into it stays shut and
   * the rest of the app is untouched.
   */
  private animationInstalled = false;

  /**
   * True when that install was the `vectors` plugin rather than files copied
   * into a dot-folder. The form has to say which, because a plugin renames
   * the skills it carries: they answer to `vectors:<skill>` there, and a
   * form naming the bare skill would name something the tool cannot find.
   */
  private animationPlugin = false;

  /** Executable of the AI tool the run needs, learned from a failed run. */
  private animationToolBinary = '';

  /** True while Animation Mode is active (Edit menu, Ctrl+Shift+N). */
  private animationMode = false;

  /** True while the animation wizard is drawing frames (one run at a time). */
  private animationBusy = false;

  /** Set when Cancel is pressed while a frame is drawing; checked after the await. */
  private animationCancelled = false;

  /** Latest note from the helper run, rendered into the dialog's readout. */
  private animationNote = '';

  /** Frames kept so far in this wizard run (for the readout). */
  private animationKept = 0;

  /** When the running frame started (for the elapsed readout). */
  private animationStartedAt = 0;

  constructor() {
    this.canvas = el<HTMLCanvasElement>('canvas');
    this.surface = new Surface(this.canvas);
    this.surface.onImageLoad = () => this.scheduleRender();
    this.store = new Store(createSketchBook('untitled'));

    this.store.subscribe(() => this.scheduleRender());
    this.store.subscribe(() => this.scheduleSyncUi());

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
    this.bindAnimationMode();
    this.bindPageSettings();
    this.bindProperties();
    this.bindMove();
    this.bindRotate();
    this.bindPopups();
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
      // The close prompt's Save answers through here: the window waits for
      // this to resolve, and stays open when the save did not happen.
      window.napkin.onSaveBeforeClose(() => this.saveBook(false));
    } catch {
      // running outside Electron — settings sync unavailable
    }

    try {
      const mode = await window.napkin.getAnimationMode();
      this.animationInstalled = mode.installed;
      this.animationPlugin = mode.plugin;
    } catch {
      // Outside Electron the feature has no install record, so it is absent.
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
        this.surface.clearImages();
        this.store.setBook(result.book, result.filePath ?? launch.filePath);
      } else {
        this.toast(result.error ?? 'Could not open sketch book.');
      }
    } else {
      const name = launch.sketchName || 'unnamed';
      this.surface.clearImages();
      this.store.setBook(createSketchBook(name, name), null);
    }

    if (launch.importFiles && launch.importFiles.length > 0) {
      await this.importLaunchFiles(launch.importFiles, launch.importGrid === true);
    }

    // Opening defaults: the layers panel is in view and Select is the active
    // tool, so a fresh session starts in arrange-and-inspect mode. Animation
    // Mode is a per-session mode and always starts off, whatever state the
    // markup or a stale class might carry.
    this.toggleLayers(true);
    this.store.setTool({ tool: 'select' });
    this.animationMode = false;
    document.body.classList.remove('animation-mode');
    el('animation-banner').classList.add('is-hidden');

    this.syncUi();
    this.scheduleRender();
  }

  // ---- Rendering -----------------------------------------------------------

  /**
   * Queues one panel sync for the next animation frame.
   *
   * Every store mutation emits, and a drag mutates once per pointer event -
   * faster than the canvas is repainted. {@link syncUi} rebuilds the whole
   * layers panel and every properties field, so running it per emit meant a
   * drag rebuilt those panels several times between frames and threw all but
   * the last away. Coalescing collapses a burst into the single pass whose
   * result is the one the user sees.
   *
   * Nothing reads back what the sync writes in the same turn, with one
   * exception - starting a layer rename, which needs the row in the DOM - and
   * that path calls {@link flushUi} first.
   */
  private scheduleSyncUi(): void {
    if (this.uiSyncFrame !== null) return;
    this.uiSyncFrame = requestAnimationFrame(() => {
      this.uiSyncFrame = null;
      this.syncUi();
    });
  }

  /**
   * Runs a queued panel sync now, for a caller about to read the DOM the sync
   * produces. A no-op when nothing is pending.
   */
  private flushUi(): void {
    if (this.uiSyncFrame === null) return;
    cancelAnimationFrame(this.uiSyncFrame);
    this.uiSyncFrame = null;
    this.syncUi();
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame((now) => {
      this.renderQueued = false;
      const fading = this.stepSymmetryFade(now);
      this.surface.render(this.store.sketch, this.live, {
        selectedIds: this.store.selectedIds,
        symmetry: this.symmetryGuideAxes,
        symmetryAlpha: this.symmetryFade,
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
        rotate: this.rotateOverlay() ?? undefined,
        anchors: this.anchorOverlay() ?? undefined,
      });
      if (fading) this.scheduleRender();
    });
  }

  /**
   * Advances the symmetry guide's fade one frame toward its target (visible
   * while symmetry is on, hidden while it is off) and reports whether more
   * frames are needed. The axis count is held through a fade-out so the
   * guide dissolves as the shape it was rather than snapping to one axis.
   */
  private stepSymmetryFade(now: number): boolean {
    const target = this.store.tool.symmetry > 1 ? 1 : 0;
    if (target === 1) this.symmetryGuideAxes = this.store.tool.symmetry;
    const elapsed = this.symmetryFadeAt === 0 ? 0 : now - this.symmetryFadeAt;
    this.symmetryFadeAt = now;
    if (this.symmetryFade === target) return false;
    if (prefersReducedMotion()) {
      this.symmetryFade = target;
      return false;
    }
    const step = elapsed / SYMMETRY_FADE_MS;
    this.symmetryFade =
      target > this.symmetryFade
        ? Math.min(target, this.symmetryFade + step)
        : Math.max(target, this.symmetryFade - step);
    return this.symmetryFade !== target;
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
      // Paste aims at the pointer only while there is one on the page.
      this.pointerOverCanvas = false;
    });
    c.addEventListener('pointerenter', () => {
      this.pointerOverCanvas = true;
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

    // Rotate: while its dialog is open the canvas turns the selection rather
    // than drawing on it, and the pivot marker can be dragged somewhere else.
    // Claimed ahead of every tool, since the gesture belongs to the dialog
    // and not to whichever tool happened to be active when it opened.
    if (this.rotateDialogOpen && this.beginRotateDrag(e, pt)) return;

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
    if (tool !== 'select' && !this.ensureDrawableLayer()) return;

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
    // Where a paste with no explicit target lands.
    this.lastCanvasPoint = this.surface.toSketchPoint(e.clientX, e.clientY, 0.5);
    this.pointerOverCanvas = true;
    // The event carries the live modifier state, which keeps the copy pointer
    // right even when the Alt keydown landed in another window.
    if (e.altKey !== this.altDown && !this.vectorEditId) {
      this.altDown = e.altKey;
      this.updateCursor();
    }
    if (this.gesturing) {
      this.updateGesture();
      return;
    }

    // Rotate: carry a rotation or a pivot drag along, and keep the pointer
    // telling the truth about which of the two a press would start.
    if (this.rotateDialogOpen && this.onRotatePointerMove(e, this.lastCanvasPoint)) return;

    const tool = this.store.tool.tool;

    // Select-tool Space + drag: pan the canvas following the pointer.
    if (this.panDragging && this.activePointerId === e.pointerId && this.panLast) {
      // Shift pins the pan to the nearest axis or diagonal too, so the page
      // scrolls straight. The pan works in client pixels, so the constraint
      // is applied there rather than in sketch coordinates.
      const to =
        e.shiftKey && this.panOrigin
          ? constrainDrag(this.panOrigin, { x: e.clientX, y: e.clientY })
          : { x: e.clientX, y: e.clientY };
      const sign = this.settings.invertPanDrag ? -1 : 1;
      this.surface.panBy((to.x - this.panLast.x) * sign, (to.y - this.panLast.y) * sign);
      this.panLast = to;
      this.scheduleRender();
      return;
    }

    // Direct Select: drag the grabbed anchor(s), handle, or whole path.
    if (this.anchorDragKind && this.anchorStrokeId && this.activePointerId === e.pointerId) {
      const raw = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      // Shift pins the drag to the nearest axis or diagonal, whether it is
      // carrying anchors, a handle, or the whole path.
      const pt =
        e.shiftKey && this.anchorDragOrigin ? constrainDrag(this.anchorDragOrigin, raw) : raw;
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
      // Movement settles it: this is a rubber band, so a selection held over
      // from the press goes now rather than on the press itself.
      if (this.pendingSelectionClear) {
        this.pendingSelectionClear = false;
        this.store.clearSelection();
      }
      this.rubberBandBox = { x1: this.rubberBandStart.x, y1: this.rubberBandStart.y, x2: pt.x, y2: pt.y };
      this.scheduleRender();
      return;
    }

    // Select: drag to move selected strokes. Shift pins the move to the
    // nearest axis or diagonal; `dragLast` tracks where the selection was
    // actually put, so letting Shift go hands the selection back to the
    // pointer rather than leaving it offset by the constraint.
    if (tool === 'select' && this.dragging) {
      const raw = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      const pt = e.shiftKey && this.dragOrigin ? constrainDrag(this.dragOrigin, raw) : raw;
      if (this.dragLast) {
        const dx = pt.x - this.dragLast.x;
        const dy = pt.y - this.dragLast.y;
        if (dx !== 0 || dy !== 0) {
          this.store.nudgeSelected(dx, dy);
          this.dragMoved = true;
        }
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
    // The copy has been put down: the pointer goes back to the plain arrow.
    if (this.copyDragging) {
      this.copyDragging = false;
      this.updateCursor();
    }
    if (this.gesturing) {
      if (this.pointers.size < 2) this.endGesture();
      return;
    }

    // Rotate: a released rotation is committed as one history step.
    if (this.rotateDialogOpen && this.endRotateDrag(e)) return;

    const tool = this.store.tool.tool;

    // Select-tool Space + drag: end the pan.
    if (this.panDragging && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.panDragging = false;
      this.panLast = null;
      this.panOrigin = null;
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
      this.anchorDragOrigin = null;
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
      // Released without ever moving: a click on empty canvas, which drops
      // the selection the press deliberately kept.
      if (this.pendingSelectionClear) {
        this.pendingSelectionClear = false;
        this.store.clearSelection();
      }
      if (box && (Math.abs(box.x2 - box.x1) > 2 || Math.abs(box.y2 - box.y1) > 2)) {
        const minX = Math.min(box.x1, box.x2);
        const maxX = Math.max(box.x1, box.x2);
        const minY = Math.min(box.y1, box.y2);
        const maxY = Math.max(box.y1, box.y2);
        const editable = this.editableStrokeIds();
        const ids = this.store.sketch.strokes
          .filter((s) => this.strokeIntersectsBox(s, minX, minY, maxX, maxY, editable))
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
      this.dragOrigin = null;
      // A Shift-press on a selected element that never went anywhere was a
      // click, so it means what a Shift-click has always meant.
      if (this.shiftToggleId && !this.dragMoved) {
        const ids = new Set(this.store.selectedIds);
        ids.delete(this.shiftToggleId);
        this.store.setSelection(ids);
      }
      this.shiftToggleId = null;
      this.dragMoved = false;
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
          this.anchorDragOrigin = pt;
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
        this.anchorDragOrigin = pt;
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
      this.anchorDragOrigin = pt;
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
    this.panOrigin = { x: e.clientX, y: e.clientY };
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
    const visible = this.visibleStrokeIds();
    for (const stroke of this.store.sketch.strokes) {
      if (stroke.tool === 'eraser' || stroke.tool === 'text' || stroke.tool === 'image') continue;
      if (!visible.has(stroke.id)) continue;
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

    // A press inside a selection of several elements moves it, even where it
    // lands on a gap between the marks. Demanding an exact hit made a group
    // or a multi-row selection easy to lose by accident: pressing the space
    // between two strokes of the thing you were about to drag cleared the
    // selection and started a rubber band instead.
    const insideSelection =
      !hit && this.store.selectedIds.size > 1 && this.pointInSelectedBounds(pt);

    if (hit || insideSelection) {
      if (hit && e.shiftKey) {
        // Shift-click toggles membership without dropping the rest. Taking
        // something *out* waits for the release, because the same press with
        // the same modifier is also how a drag is pinned to an axis - and
        // dropping the element on the press would leave nothing to drag.
        if (this.store.selectedIds.has(hit.id)) {
          this.shiftToggleId = hit.id;
        } else {
          this.store.setSelection(new Set(this.store.selectedIds).add(hit.id));
        }
      } else if (hit && !this.store.selectedIds.has(hit.id)) {
        this.store.setSelection([hit.id]);
      }
      this.dragging = true;
      this.dragLast = pt;
      this.dragOrigin = pt;
      this.store.pushHistory();
      // Alt-drag copies the selection: the layers panel gains " - Copy"
      // rows, the clones become the selection, and this drag moves them
      // while the originals stay put. The history step above covers the
      // copy and the move together, so one undo removes both.
      if (e.altKey) {
        const copied = this.duplicateForDrag();
        if (copied > 0) {
          this.copyDragging = true;
          this.updateCursor();
          this.toast(`Dragging a copy of ${copied} element${copied === 1 ? '' : 's'}.`);
        }
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
    } else {
      // Start rubber-band selection over empty canvas. A selection of several
      // elements is not dropped on the press itself: the gesture has not said
      // yet whether it is a rubber band or a mis-aimed grab, and clearing on
      // mousedown is what made a multi-row selection so easy to lose. The
      // clear waits for movement (a real rubber band) or for a release with
      // none (a click on empty canvas).
      if (this.store.selectedIds.size > 1) this.pendingSelectionClear = true;
      else this.store.clearSelection();
      this.rubberBandStart = pt;
      this.rubberBandBox = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
      this.scheduleRender();
    }
  }

  /** Bounds of every selected mark, or null when nothing is selected. */
  private selectedBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of this.store.sketch.strokes) {
      if (!this.store.selectedIds.has(stroke.id)) continue;
      const b = strokeBounds(stroke, (t) => this.surface.measureText(t));
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  /**
   * True when a point falls within the selection's own box, with a few
   * screen pixels of slack so the edge stays grabbable at any zoom.
   */
  private pointInSelectedBounds(pt: Point): boolean {
    const box = this.selectedBounds();
    if (!box) return false;
    // Generous on purpose: a press aimed at a group of scattered marks often
    // lands just outside the box that encloses them, and losing the whole
    // selection is a far worse outcome than starting a move a few pixels off.
    const pad = 12 / Math.max(0.01, this.surface.getViewport().zoom);
    return (
      pt.x >= box.minX - pad &&
      pt.x <= box.maxX + pad &&
      pt.y >= box.minY - pad &&
      pt.y <= box.maxY + pad
    );
  }

  /** True when a stroke's layer allows selecting and editing it. */
  private strokeEditable(stroke: Stroke): boolean {
    const effective = effectiveLayer(this.store.sketch, layerOf(this.store.sketch, stroke));
    return effective.visible && !effective.locked;
  }

  /**
   * Ids of the marks a gesture may pick up: those on a layer that is visible
   * and unlocked once its groups are folded in.
   *
   * {@link strokeEditable} answers for one mark and re-resolves the layer
   * stack to do it, so asking it per mark in a loop costs the square of the
   * drawing's size - and the loops that ask are the hit tests, which run on
   * every pointer move. The whole answer is resolved once here instead, in a
   * single pass over the layers and a single pass over the marks.
   *
   * The set is built per call and never cached: it is read within one gesture
   * step, and a stale one would silently let a hidden or locked layer be
   * selected. There is no invalidation rule to get wrong because there is
   * nothing to invalidate.
   */
  private editableStrokeIds(): Set<string> {
    return this.strokeIdsWhere((effective) => effective.visible && !effective.locked);
  }

  /** Ids of the marks that actually paint - no hidden layer or group above them. */
  private visibleStrokeIds(): Set<string> {
    return this.strokeIdsWhere((effective) => effective.visible);
  }

  /** Ids of every mark whose layer's resolved state passes `keep`. */
  private strokeIdsWhere(
    keep: (effective: { visible: boolean; locked: boolean }) => boolean,
  ): Set<string> {
    const sketch = this.store.sketch;
    const effectiveOf = effectiveLayers(sketch);
    const ids = new Set<string>();
    for (const [layerId, strokes] of strokesByLayer(sketch)) {
      const effective = effectiveOf.get(layerId);
      if (!effective || !keep(effective)) continue;
      for (const stroke of strokes) ids.add(stroke.id);
    }
    return ids;
  }

  /** Selects every editable stroke on the page (Ctrl/Cmd + A). */
  private selectAll(): void {
    const editable = this.editableStrokeIds();
    const ids = this.store.sketch.strokes.filter((s) => editable.has(s.id)).map((s) => s.id);
    if (ids.length === 0) {
      this.toast('Nothing to select.');
      return;
    }
    this.store.setSelection(ids);
    this.toast(`Selected ${ids.length} element${ids.length === 1 ? '' : 's'}.`);
  }

  /**
   * Returns the topmost editable stroke under a point, or null.
   *
   * `editable` is the pickable set from {@link editableStrokeIds}; a caller
   * making several passes over the page passes its own so the layer stack is
   * resolved once for the whole gesture step rather than once per pass.
   */
  private hitTest(pt: Point, editable = this.editableStrokeIds()): Stroke | null {
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!editable.has(s.id)) continue;
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
  private hitFilledInterior(pt: Point, editable = this.editableStrokeIds()): Stroke | null {
    const strokes = this.store.sketch.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!s.fill || s.tool === 'eraser' || s.points.length < 3) continue;
      if (!editable.has(s.id)) continue;
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
    const editable = this.editableStrokeIds();
    const pickable = (s: Stroke): boolean =>
      editable.has(s.id) && (eligible === undefined || eligible(s));
    const exact = this.hitTest(pt, editable);
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
    editable = this.editableStrokeIds(),
  ): boolean {
    if (!editable.has(stroke.id)) return false;
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

    // Rotate: while its dialog is open the canvas is a rotation handle, and
    // the pivot marker under the pointer is something to pick up instead.
    if (this.rotateDialogOpen && this.rotateCenter) {
      this.canvas.style.cursor =
        this.rotateCenterDrag !== null
          ? 'grabbing'
          : this.rotateOverCenter
            ? 'grab'
            : CURSOR_ROTATE;
      return;
    }

    // Select or Direct Select + Space pans: show a grab cursor.
    if (this.spaceDown && (tool === 'select' || tool === 'point')) {
      this.canvas.style.cursor = this.panDragging ? 'grabbing' : 'grab';
      return;
    }

    if (this.capsLockOn || this.spaceDown) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Alt-drag copy: the doubled arrow, both while the copy is being dragged
    // and while Alt merely arms one, so the modifier shows its effect before
    // the drag commits to it.
    if (
      tool === 'select' &&
      (this.copyDragging || (this.altDown && this.store.selectedIds.size > 0))
    ) {
      this.canvas.style.cursor = CURSOR_ARROW_COPY;
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
      const eraser = Surface.makeEraserCursorDataUrl(this.store.tool.width);
      this.canvas.style.cursor = eraser.url
        ? `url('${eraser.url}') ${eraser.hotspotX} ${eraser.hotspotY}, cell`
        : 'cell';
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
    // Close Shape offers its two joins as a submenu on press (mousedown),
    // reusing the shared context menu the panels already build. The press
    // must not reach the window listener that dismisses that menu on any
    // pointerdown outside it - the menu would be built and torn down within
    // this one event dispatch, and nothing would ever appear.
    el('close-shape').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMenuUnder(el('close-shape'), [
        { label: 'Sharp - straight line between the end points', action: () => this.closeSelectedShapes('sharp') },
        { label: 'Smooth - curve on through the end points', action: () => this.closeSelectedShapes('smooth') },
      ]);
    });

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
    const editable = this.editableStrokeIds();
    const sharpened = this.store.sketch.strokes.map((s) =>
      !s.sharpened && editable.has(s.id) ? sharpenStroke(s, this.store.tool.sharpen) : s,
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
      // "Selection" holds the same four formats one level in, and exports
      // only what is selected, on a page cut to fit it.
      const selection = this.exportSelectionStrokes();
      this.toggleMenuUnder(el('export'), [
        { label: 'PNG Image…', action: () => void this.exportRaster('png') },
        { label: 'JPEG Image…', action: () => void this.exportRaster('jpeg') },
        { label: 'SVG Vector…', action: () => void this.exportSvg() },
        { label: 'PDF Document…', action: () => void this.exportPdf() },
        { separator: true },
        {
          label: 'Selection',
          disabled: selection.length === 0,
          items: [
            { label: 'PNG Image…', action: () => void this.exportSelection('png') },
            { label: 'JPEG Image…', action: () => void this.exportSelection('jpeg') },
            { label: 'SVG Vector…', action: () => void this.exportSelection('svg') },
            { label: 'PDF Document…', action: () => void this.exportSelection('pdf') },
          ],
        },
      ]);
    });
    el('save').addEventListener('click', () => this.saveBook(false));
    el('save-as').addEventListener('click', () => this.saveBook(true));
  }

  private newSketch(): void {
    if (this.store.dirty && !confirm('Discard unsaved changes and start a new sketch?')) return;
    // The images the old document decoded are nothing to do with this one.
    this.surface.clearImages();
    this.store.setBook(createSketchBook('untitled', 'unnamed'), null);
    this.surface.resetViewport();
    this.toast('Started a new sketch.');
  }

  private async openBook(): Promise<void> {
    const result = await window.napkin.openBook();
    if (result.cancelled) return;
    if (result.ok && result.book) {
      this.surface.clearImages();
      this.store.setBook(result.book, result.filePath ?? null);
      this.surface.resetViewport();
      this.toast(`Opened ${this.store.displayName}.`);
    } else {
      this.toast(result.error ?? 'Could not open sketch book.');
    }
  }

  private async saveBook(forceDialog: boolean): Promise<boolean> {
    const target = forceDialog ? null : this.store.filePath;
    const result = forceDialog
      ? await window.napkin.saveBookAs(this.store.book)
      : await window.napkin.saveBook(target, this.store.book);
    if (result.cancelled) return false;
    if (result.ok && result.filePath) {
      this.store.markSaved(result.filePath);
      this.toast(`Saved ${this.store.displayName}.`);
      return true;
    }
    this.toast(result.error ?? 'Could not save sketch book.');
    return false;
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

  // ---- Clipboard -----------------------------------------------------------

  /**
   * Copies the selection. The elements are kept in full inside the app, and
   * the same graphic goes out to the system clipboard as SVG so it can be
   * pasted into another vector editor.
   */
  private copySelection(): boolean {
    const strokes = this.exportSelectionStrokes();
    if (strokes.length === 0) {
      this.toast('Select something to copy first.');
      return false;
    }
    // The origin follows what can be seen, so a paste at the pointer puts the
    // visible graphic under it even when a hidden sublayer reaches further.
    const box = this.boundsOfStrokes(strokes);
    const origin = { x: box?.minX ?? 0, y: box?.minY ?? 0 };
    const tree = this.captureLayerTree();
    this.clipboard = tree ? { kind: 'tree', ...tree, origin } : {
      kind: 'flat',
      strokes: strokes.map((stroke) => JSON.parse(JSON.stringify(stroke)) as Stroke),
      origin,
    };
    this.pasteCascade = 0;
    void this.publishClipboardSvg(strokes);
    return true;
  }

  /**
   * The layer subtree(s) behind the selection, whenever the selection amounts
   * to a group. A group is a shape made of layers - flattening it onto one
   * layer loses the structure the graphic was built from - so a copy of one
   * carries the tree.
   *
   * Whether the group was reached by clicking its row or by picking out its
   * marks on the canvas makes no difference: a group joins the copy when
   * every one of its mark-carrying layers is in the copy already. That is
   * what makes a rubber band around a whole graphic the same gesture as
   * clicking the row above it. A selection that covers no group at all
   * returns null and copies flat, which is what picking out a few marks
   * should do.
   */
  private captureLayerTree(): { roots: LayerTreeNode[]; sourceId: string } | null {
    const sketch = this.store.sketch;

    // The layers the copy touches: those holding a selected mark, plus any
    // row picked out in the panel together with everything under it.
    const held = new Set<string>();
    for (const stroke of sketch.strokes) {
      if (this.store.selectedIds.has(stroke.id)) held.add(layerOf(sketch, stroke).id);
    }
    for (const id of this.store.selectedLayerIds) {
      if (!sketch.layers.some((layer) => layer.id === id)) continue;
      held.add(id);
      for (const child of descendantLayerIds(sketch, id)) held.add(child);
    }
    if (held.size === 0) return null;

    // Which layers carry marks at all: a group is judged on those alone, so
    // an empty layer sitting in it does not keep it out of the copy.
    const carries = new Set(sketch.strokes.map((stroke) => layerOf(sketch, stroke).id));
    const fullyHeld = (group: Layer): boolean => {
      let any = false;
      for (const id of descendantLayerIds(sketch, group.id)) {
        if (!carries.has(id)) continue;
        any = true;
        if (!held.has(id)) return false;
      }
      return any;
    };
    for (const layer of sketch.layers) {
      if (layer.group && fullyHeld(layer)) held.add(layer.id);
    }
    // A group that joined brings everything inside it, empty rows included.
    for (const id of [...held]) {
      const layer = sketch.layers.find((l) => l.id === id);
      if (layer?.group) for (const child of descendantLayerIds(sketch, id)) held.add(child);
    }

    // Roots are the held layers no held layer contains.
    const roots = sketch.layers.filter(
      (layer) => held.has(layer.id) && !(layer.parent && held.has(layer.parent)),
    );
    // Nothing grouped came out of it: a handful of marks, which copies flat.
    if (roots.length === 0 || !roots.some((layer) => layer.group)) return null;

    return {
      roots: roots.map((layer) => this.layerToTree(layer)),
      // The topmost copied row: what the paste lands beside.
      sourceId: roots[roots.length - 1].id,
    };
  }

  /**
   * One layer and everything under it, deep-copied for the clipboard. Only
   * selected marks come along, which for a layer row is all of them (picking
   * a row selects its elements) and for a canvas selection is exactly what
   * was picked out.
   */
  private layerToTree(layer: Layer): LayerTreeNode {
    const sketch = this.store.sketch;
    return {
      name: layer.name,
      group: layer.group === true,
      opacity: layer.opacity,
      visible: layer.visible,
      locked: layer.locked,
      marks: sketch.strokes
        .map((stroke, order) => ({ stroke, order }))
        .filter(
          ({ stroke }) =>
            layerOf(sketch, stroke).id === layer.id && this.store.selectedIds.has(stroke.id),
        )
        .map(({ stroke, order }) => ({
          stroke: JSON.parse(JSON.stringify(stroke)) as Stroke,
          order,
        })),
      children: sketch.layers
        .filter((child) => child.parent === layer.id)
        .map((child) => this.layerToTree(child)),
    };
  }

  /** Puts the copied graphic on the system clipboard, cropped to its own ink. */
  private async publishClipboardSvg(strokes: Stroke[]): Promise<void> {
    try {
      const crop = this.cropBoundsOfStrokes(strokes);
      if (!crop) return;
      const svg = Surface.toSVG(
        { ...this.store.sketch, strokes },
        { crop, transparent: true },
      );
      this.clipboardSvgSent = svg;
      await window.napkin.writeClipboardSvg(svg);
    } catch {
      // An unavailable system clipboard is not worth failing the copy over:
      // the in-app clipboard is already loaded and paste works from it.
    }
  }

  private cutSelection(): void {
    if (!this.copySelection()) return;
    const count = clipboardMarkCount(this.clipboard);
    // Cut acts on the canvas selection; a layer-row selection with nothing
    // selected on the canvas would otherwise delete nothing and look broken.
    if (this.store.selectedIds.size === 0) {
      this.store.setSelection(this.exportSelectionStrokes().map((stroke) => stroke.id));
    }
    this.store.deleteSelected();
    this.renderLayers();
    this.toast(`Cut ${count} element${count === 1 ? '' : 's'}.`);
  }

  private copySelectionWithToast(): void {
    if (!this.copySelection()) return;
    const count = clipboardMarkCount(this.clipboard);
    const layers = this.clipboard?.kind === 'tree' ? countTreeLayers(this.clipboard.roots) : 0;
    this.toast(
      layers > 0
        ? `Copied ${count} element${count === 1 ? '' : 's'} across ${layers} layer${layers === 1 ? '' : 's'}.`
        : `Copied ${count} element${count === 1 ? '' : 's'}.`,
    );
  }

  /**
   * Pastes the clipboard onto the active page.
   *
   * `inPlace` puts the elements back at the coordinates they were copied
   * from - the way to move a graphic between pages without it drifting.
   * Otherwise they land under the pointer when it is over the canvas, and
   * cascade down-right from the copied position when it is not, so a run of
   * pastes stacks visibly instead of piling up in one spot.
   *
   * A graphic copied in another editor since the last copy here wins: the
   * system clipboard is checked first, and its SVG is imported instead.
   */
  private async pasteClipboard(inPlace: boolean): Promise<void> {
    const outside = await this.readOutsideSvg();
    if (outside) {
      await this.pasteOutsideSvg(outside);
      return;
    }
    const clip = this.clipboard;
    if (!clip || clipboardMarkCount(clip) === 0) {
      this.toast('Nothing to paste.');
      return;
    }

    // Where the copy lands: under the pointer when there is one on the page,
    // otherwise a step further down-right on each repeat.
    let dx = 0;
    let dy = 0;
    if (!inPlace) {
      if (this.pointerOverCanvas && this.lastCanvasPoint) {
        dx = this.lastCanvasPoint.x - clip.origin.x;
        dy = this.lastCanvasPoint.y - clip.origin.y;
      } else {
        this.pasteCascade += 1;
        dx = PASTE_OFFSET * this.pasteCascade;
        dy = PASTE_OFFSET * this.pasteCascade;
      }
    }

    const added =
      clip.kind === 'tree'
        ? this.pasteLayerTree(clip, dx, dy)
        : this.pasteFlat(clip, dx, dy);
    if (added === null) return;

    this.store.setSelection(added.map((stroke) => stroke.id));
    // Land on the Select tool so the pasted graphic can be dragged at once.
    this.store.setTool({ tool: 'select' });
    this.updateCursor();
    this.renderLayers();
    this.renderThumbnails();
    const layers = clip.kind === 'tree' ? countTreeLayers(clip.roots) : 0;
    const where = inPlace ? ' in place' : '';
    this.toast(
      layers > 0
        ? `Pasted ${added.length} element${added.length === 1 ? '' : 's'} across ${layers} layer${layers === 1 ? '' : 's'}${where}.`
        : `Pasted ${added.length} element${added.length === 1 ? '' : 's'}${where}.`,
    );
  }

  /**
   * Pastes a copied group with its layers intact: the tree is rebuilt as a
   * sibling of the layer it was copied from, so the copy sits beside the
   * original rather than nested inside it, and only the pasted root takes the
   * " - Copy" suffix - the layers under it keep the names the graphic gave
   * them, which is what keeps an imported SVG readable after a copy.
   */
  private pasteLayerTree(
    clip: Extract<ClipboardContents, { kind: 'tree' }>,
    dx: number,
    dy: number,
  ): Stroke[] {
    const roots = clip.roots.map((root) => ({
      ...moveTreeNode(root, dx, dy),
      name: `${root.name} - Copy`,
    }));
    // Beside the original when it is still on this page; a paste onto another
    // page has no original to sit beside, so it goes to the top level.
    const beside = this.store.sketch.layers.some((layer) => layer.id === clip.sourceId)
      ? clip.sourceId
      : null;
    return this.store.pasteLayerTree(roots, beside);
  }

  /** Pastes a plain selection of marks onto one layer, as any element lands. */
  private pasteFlat(
    clip: Extract<ClipboardContents, { kind: 'flat' }>,
    dx: number,
    dy: number,
  ): Stroke[] | null {
    if (!this.ensureDrawableLayer()) return null;
    const copies = translateStrokes(
      clip.strokes.map((stroke) => JSON.parse(JSON.stringify(stroke)) as Stroke),
      dx,
      dy,
    ).map((stroke) => ({ ...stroke, id: createId('st') }));
    this.store.addStrokes(copies);
    return copies;
  }

  /**
   * SVG sitting on the system clipboard that did not come from this app's own
   * last copy, or null. Comparing against what was written on copy is what
   * keeps an in-app copy (which carries far more than SVG can) from being
   * replaced by its own lower-fidelity echo.
   */
  private async readOutsideSvg(): Promise<string | null> {
    try {
      const text = await window.napkin.readClipboardSvg();
      if (!text || text === this.clipboardSvgSent) return null;
      return text;
    } catch {
      return null;
    }
  }

  /** Imports SVG copied in another editor as new layers on the active page. */
  private async pasteOutsideSvg(svgText: string): Promise<void> {
    try {
      const imported = importSvg(svgText, { unnamedRootName: 'pasted' });
      if (imported.layers.length === 0) {
        this.toast('The clipboard held no drawable shapes.');
        return;
      }
      this.store.addImportedLayers(imported.layers);
      // The paste came from outside, so this app's own clipboard no longer
      // describes what a further paste should produce.
      this.clipboard = null;
      this.clipboardSvgSent = svgText;
      this.renderLayers();
      this.renderThumbnails();
      this.toast(
        `Pasted ${imported.layers.length} layer${imported.layers.length === 1 ? '' : 's'} from the clipboard.`,
      );
    } catch (err) {
      this.toast((err as Error).message);
    }
  }

  /**
   * Copy and paste in one step, leaving the clipboard alone. A group
   * duplicates the way it pastes: the tree is rebuilt beside the original
   * rather than flattened onto one layer.
   */
  private duplicateSelection(): void {
    const strokes = this.exportSelectionStrokes();
    if (strokes.length === 0) {
      this.toast('Select something to duplicate first.');
      return;
    }
    const tree = this.captureLayerTree();
    const added = tree
      ? this.pasteLayerTree(
          { kind: 'tree', ...tree, origin: { x: 0, y: 0 } },
          PASTE_OFFSET,
          PASTE_OFFSET,
        )
      : this.pasteFlat(
          {
            kind: 'flat',
            strokes: strokes.map((stroke) => JSON.parse(JSON.stringify(stroke)) as Stroke),
            origin: { x: 0, y: 0 },
          },
          PASTE_OFFSET,
          PASTE_OFFSET,
        );
    if (added === null) return;
    this.store.setSelection(added.map((stroke) => stroke.id));
    this.renderLayers();
    const layers = tree ? countTreeLayers(tree.roots) : 0;
    this.toast(
      layers > 0
        ? `Duplicated ${added.length} element${added.length === 1 ? '' : 's'} across ${layers} layer${layers === 1 ? '' : 's'}.`
        : `Duplicated ${added.length} element${added.length === 1 ? '' : 's'}.`,
    );
  }

  /**
   * The Alt-drag copy: clones the selection where it stands and makes the
   * clones the selection, so the drag that follows moves the copy while the
   * originals stay put. A copied group keeps its layers, exactly as a paste
   * of one does; anything else clones flat.
   *
   * Pushes no history step of its own - the caller wrapped the copy and the
   * drag into a single one.
   */
  private duplicateForDrag(): number {
    const tree = this.captureLayerTree();
    if (!tree) return this.store.duplicateSelectedElements();
    const roots = tree.roots.map((root) => ({ ...root, name: `${root.name} - Copy` }));
    const beside = this.store.sketch.layers.some((layer) => layer.id === tree.sourceId)
      ? tree.sourceId
      : null;
    // No offset: the drag that follows is what moves the copy.
    const added = this.store.pasteLayerTree(roots, beside, { history: false });
    this.store.setSelection(added.map((stroke) => stroke.id));
    return added.length;
  }

  /** The clipboard rows, shared by the canvas menu and the layers-panel menu. */
  private clipboardMenuItems(): ContextMenuItem[] {
    const hasSelection = this.exportSelectionStrokes().length > 0;
    const hasClipboard = clipboardMarkCount(this.clipboard) > 0;
    return [
      { label: 'Cut', disabled: !hasSelection, action: () => this.cutSelection() },
      { label: 'Copy', disabled: !hasSelection, action: () => this.copySelectionWithToast() },
      // Paste stays enabled with an empty in-app clipboard: the system
      // clipboard may hold a graphic from another editor, and only reading it
      // (which the action does) can tell.
      { label: 'Paste', action: () => void this.pasteClipboard(false) },
      {
        label: 'Paste in Place',
        disabled: !hasClipboard,
        action: () => void this.pasteClipboard(true),
      },
      { label: 'Duplicate', disabled: !hasSelection, action: () => this.duplicateSelection() },
    ];
  }

  // ---- Export > Selection --------------------------------------------------

  /**
   * What a Selection export covers: the selected elements, or - when the
   * canvas selection is empty but rows are lit in the layers panel - every
   * stroke on those layers and their descendants. Selecting a layer and
   * exporting it is the same gesture either way round.
   */
  private exportSelectionStrokes(): Stroke[] {
    const selected = this.propertyStrokes();
    if (selected.length > 0) return selected;
    if (this.store.selectedLayerIds.size === 0) return [];
    // A hidden layer is left out of an exported document, so its marks must
    // stay out of the measurement too - counting them would size the file to
    // ink that is never drawn into it.
    const visible = this.visibleStrokeIds();
    return this.strokesInLayerSubtree([...this.store.selectedLayerIds]).filter((stroke) =>
      visible.has(stroke.id),
    );
  }

  /**
   * Exports the selection alone, on a page cut to its own dimensions.
   *
   * PNG and SVG come out transparent, since a graphic cropped to its ink is
   * one somebody is about to drop into a composition. JPEG and PDF have no
   * usable transparency, so those keep the page background behind the marks.
   */
  private async exportSelection(format: ExportFormat): Promise<void> {
    const strokes = this.exportSelectionStrokes();
    const crop = this.cropBoundsOfStrokes(strokes);
    if (strokes.length === 0 || !crop) {
      this.toast('Select something to export first.');
      return;
    }
    const name = `${this.store.displayName}-selection`;
    const size = `${Math.max(1, Math.round(crop.maxX - crop.minX))} × ${Math.max(1, Math.round(crop.maxY - crop.minY))}`;

    if (format === 'svg') {
      // The viewBox does the cropping, so every coordinate stays exactly
      // what a full-page export would have written.
      const svg = Surface.toSVG(
        { ...this.store.sketch, strokes },
        { crop, transparent: true },
      );
      const result = await window.napkin.saveSvg(svg, name);
      if (result.cancelled) return;
      this.toast(result.ok ? `Exported the selection as a ${size} SVG.` : result.error ?? 'Export failed.');
      return;
    }

    const cropped = this.croppedSketch(strokes, crop);
    if (format === 'pdf') {
      const prepared = await this.flattenImagesForPdf(cropped);
      const result = await window.napkin.savePdf(sketchesToPdf([prepared]), name);
      if (result.cancelled) return;
      this.toast(result.ok ? `Exported the selection as a ${size} PDF.` : result.error ?? 'Export failed.');
      return;
    }

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = Surface.renderSketchToDataURL(cropped, mime, {
      transparent: format === 'png',
    });
    const result = await window.napkin.saveImage(format, dataUrl, name);
    if (result.cancelled) return;
    this.toast(
      result.ok ? `Exported the selection as a ${size} ${format.toUpperCase()}.` : result.error ?? 'Export failed.',
    );
  }

  /**
   * A one-page sketch holding `strokes` alone, moved so `crop` starts at the
   * origin and sized to it. The raster and PDF writers both draw from the
   * page origin, so for them the geometry has to move; the SVG export offsets
   * its viewBox instead and leaves the coordinates alone.
   */
  private croppedSketch(strokes: Stroke[], crop: AnimationBounds): Sketch {
    return {
      ...this.store.sketch,
      sizeMode: 'sized',
      width: Math.max(1, Math.round(crop.maxX - crop.minX)),
      height: Math.max(1, Math.round(crop.maxY - crop.minY)),
      strokes: translateStrokes(strokes, -crop.minX, -crop.minY),
    };
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
    if (!this.ensureDrawableLayer()) return;
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
    el('new-page').addEventListener('click', () => this.addDefaultPage());
    el('pages-menu').addEventListener('click', () =>
      this.toggleMenuUnder(el('pages-menu'), this.pageMenuItems()),
    );
    el('pages-toggle').addEventListener('click', () => this.togglePages());
    el('delete-page').addEventListener('click', () => {
      this.store.removePage();
      this.renderThumbnails();
    });
  }

  /** The three ways to start a page, behind the pages panel's hamburger. */
  private pageMenuItems(): ContextMenuItem[] {
    return [
      {
        label: 'From Selection',
        disabled: this.exportSelectionStrokes().length === 0,
        action: () => this.addPageFromSelection(),
      },
      { label: 'Default New Page', action: () => this.addDefaultPage() },
      { label: 'Custom New Page…', action: () => this.openPageSettings({ forNewPage: true }) },
    ];
  }

  /** A new page the size of the one in view - what "+ Page" has always done. */
  private addDefaultPage(): void {
    this.store.addPage('unnamed');
    this.renderThumbnails();
    this.toast('Added a new page.');
  }

  /**
   * A new page cut to the selection's own dimensions, carrying a copy of the
   * selection: the graphic gets a page that fits it rather than the other way
   * round, and arrives on it rather than being left behind on the old page.
   *
   * The originals stay where they were - this copies, it does not move - and
   * the copies land at the new page's origin and become the selection, so the
   * marks that were selected before the page turned are still the marks that
   * are selected after it.
   */
  private addPageFromSelection(): void {
    const strokes = this.exportSelectionStrokes();
    const crop = this.cropBoundsOfStrokes(strokes);
    if (!crop) {
      this.toast('Select something to measure the new page from first.');
      return;
    }
    // The Page Settings floor applies here too: a page below it cannot be
    // typed, so it should not be measurable either.
    const width = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(crop.maxX - crop.minX)));
    const height = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(crop.maxY - crop.minY)));

    // Deep-copy before the page turns: fresh ids, and nothing (a gradient's
    // stops, say) still shared with the marks left behind on the old page.
    const copies = translateStrokes(
      strokes.map((stroke) => JSON.parse(JSON.stringify(stroke)) as Stroke),
      -crop.minX,
      -crop.minY,
    ).map((stroke) => ({ ...stroke, id: createId('st') }));

    this.store.addPage('unnamed');
    this.store.setPageSize('sized', width, height);
    this.store.addStrokes(copies);
    this.store.setSelection(copies.map((stroke) => stroke.id));
    this.renderLayers();
    this.renderThumbnails();
    this.resizeSurface();
    this.toast(
      `Added a ${width} × ${height} page with ${copies.length} copied ` +
        `${copies.length === 1 ? 'mark' : 'marks'}.`,
    );
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
    el('layer-up').addEventListener('click', () => this.moveSelectedLayers(1));
    el('layer-down').addEventListener('click', () => this.moveSelectedLayers(-1));

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
        { label: 'Rename', action: () => this.renameActiveLayer() },
        { label: 'Delete Layer(s)', action: () => this.deleteSelectedLayers() },
        { separator: true },
        ...this.clipboardMenuItems(),
        { separator: true },
        { label: 'Move Layer(s) Up', action: () => this.moveSelectedLayers(1) },
        { label: 'Move Layer(s) Down', action: () => this.moveSelectedLayers(-1) },
        { separator: true },
        { label: 'Hide Layers Panel', action: () => this.toggleLayers(false) },
      ]);
    });

    // The canvas menu is where the clipboard lives for the pointer: right-click
    // acts on what is under (or already picked out on) the page.
    el('canvas-wrap').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Right-clicking an unselected element picks it first, so "Copy" means
      // the thing just clicked rather than whatever was selected before.
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, 0.5);
      const hit = this.hitTest(pt);
      if (hit && !this.store.selectedIds.has(hit.id)) this.store.setSelection([hit.id]);
      // Paste aims at the point that was right-clicked, not at wherever the
      // pointer drifts to while the menu is open.
      this.lastCanvasPoint = pt;
      this.pointerOverCanvas = true;
      const hasSelection = this.exportSelectionStrokes().length > 0;
      this.showContextMenu(e.clientX, e.clientY, [
        ...this.clipboardMenuItems(),
        { separator: true },
        {
          label: 'Delete',
          disabled: !hasSelection,
          action: () => this.deleteSelectionOrLayers(),
        },
        { separator: true },
        { label: 'Select All', action: () => this.selectAll() },
        {
          label: 'Deselect All',
          disabled: this.store.selectedIds.size === 0,
          action: () => this.store.clearSelection(),
        },
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

    // Reaching the nested panel keeps it: the pointer got there, whatever
    // rows it crossed on the way.
    el('context-submenu').addEventListener('pointerenter', () => this.cancelSubmenuClose());

    window.addEventListener('pointerdown', (e) => {
      const inside =
        e.target instanceof Node &&
        (el('context-menu').contains(e.target) ||
          el('context-submenu').contains(e.target) ||
          // The owner's press is its own toggle; closing here would let that
          // toggle reopen the menu it was meant to dismiss.
          this.menuOwner?.contains(e.target) === true);
      if (!inside) this.hideContextMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideContextMenu();
    });
    window.addEventListener('blur', () => this.hideContextMenu());
  }

  /**
   * Drops `items` under `button`, or takes them back when that button's own
   * menu is already out. The press that opens a menu is the press that
   * dismisses it, which is what a toolbar dropdown does everywhere else.
   */
  private toggleMenuUnder(button: HTMLElement, items: ContextMenuItem[]): void {
    if (this.menuOwner === button && !el('context-menu').classList.contains('is-hidden')) {
      this.hideContextMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    this.showContextMenu(rect.left, rect.bottom + 4, items, button);
  }

  /**
   * Builds and positions the shared context menu at a client point. `owner` is
   * the button it was dropped from, if any: it lights up while the menu is out
   * and its next press closes it.
   */
  private showContextMenu(
    x: number,
    y: number,
    items: ContextMenuItem[],
    owner: HTMLElement | null = null,
  ): void {
    const menu = el('context-menu');
    this.hideSubmenu();
    this.menuOwner?.classList.remove('is-open');
    this.menuOwner = owner;
    owner?.classList.add('is-open');
    this.fillMenu(menu, items);
    menu.classList.remove('is-hidden');
    // Nudge the menu back on-screen when opened near a window edge.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  }

  /**
   * Fills one menu panel with rows, wiring nested entries to open beside them.
   * `nested` marks the panel as the one opened by a row rather than the one
   * holding that row, which is what decides whether hovering a plain row
   * dismisses the nested panel or keeps it.
   */
  private fillMenu(menu: HTMLElement, items: ContextMenuItem[], nested = false): void {
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
      const children = item.items;
      if (children && children.length > 0) {
        btn.classList.add('has-submenu');
        btn.setAttribute('aria-haspopup', 'menu');
        const open = (): void => {
          if (btn.disabled) return;
          this.cancelSubmenuClose();
          this.showSubmenu(btn, children);
        };
        // Hover opens it; so does keyboard focus, and so does a click, which
        // is what a pointer that never rests on the row will do.
        btn.addEventListener('pointerenter', open);
        btn.addEventListener('focus', open);
        btn.addEventListener('click', open);
      } else {
        btn.addEventListener('pointerenter', () => {
          if (nested) {
            // A row *inside* the nested panel: the pointer arrived, so keep
            // the panel up. `pointerenter` on the panel itself fires only on
            // the way in and never again as the pointer moves between its
            // rows, so without this the first row reached would start the
            // dismissal that the panel could no longer cancel.
            this.cancelSubmenuClose();
          } else {
            // A plain row in the parent menu starts dismissing the nested
            // panel - but only starts it. That panel is a separate element
            // sitting beside this one, so a pointer travelling toward it
            // crosses rows it is not aiming at, and closing on the first of
            // them would put the panel out of reach.
            this.scheduleSubmenuClose();
          }
        });
        btn.addEventListener('click', () => {
          this.hideContextMenu();
          item.action?.();
        });
      }
      menu.appendChild(btn);
    }
  }

  /** Opens a nested panel beside `anchor`, flipping left when it would overrun. */
  private showSubmenu(anchor: HTMLElement, items: ContextMenuItem[]): void {
    const sub = el('context-submenu');
    for (const open of el('context-menu').querySelectorAll('.is-open')) {
      open.classList.remove('is-open');
    }
    anchor.classList.add('is-open');
    this.fillMenu(sub, items, true);
    sub.classList.remove('is-hidden');
    const box = anchor.getBoundingClientRect();
    const rect = sub.getBoundingClientRect();
    const right = box.right - 2;
    const left = right + rect.width > window.innerWidth - 4 ? box.left - rect.width + 2 : right;
    sub.style.left = `${Math.max(0, left)}px`;
    sub.style.top = `${Math.max(0, Math.min(box.top, window.innerHeight - rect.height - 4))}px`;
  }

  /**
   * Closes the nested panel after a grace period, long enough for a pointer
   * travelling toward it to get there across the rows in between.
   */
  private scheduleSubmenuClose(): void {
    if (el('context-submenu').classList.contains('is-hidden')) return;
    this.cancelSubmenuClose();
    this.submenuCloseTimer = window.setTimeout(() => {
      this.submenuCloseTimer = null;
      this.hideSubmenu();
    }, SUBMENU_GRACE_MS);
  }

  private cancelSubmenuClose(): void {
    if (this.submenuCloseTimer === null) return;
    window.clearTimeout(this.submenuCloseTimer);
    this.submenuCloseTimer = null;
  }

  private hideSubmenu(): void {
    this.cancelSubmenuClose();
    el('context-submenu').classList.add('is-hidden');
    for (const open of el('context-menu').querySelectorAll('.is-open')) {
      open.classList.remove('is-open');
    }
  }

  private hideContextMenu(): void {
    this.hideSubmenu();
    el('context-menu').classList.add('is-hidden');
    this.menuOwner?.classList.remove('is-open');
    this.menuOwner = null;
  }

  /**
   * Starts an inline rename on the active layer's row. Shared by the layers
   * panel's context menu and the `F2` shortcut. The panel is opened first when
   * it is hidden, since the input takes the place of a rendered row, and the
   * row is scrolled into view so a rename below the fold is not typed blind.
   */
  private renameActiveLayer(): void {
    if (!this.layersOpen) this.toggleLayers(true);
    // The row about to be looked for may have been created by the action that
    // led here (grouping, pasting, adding a layer), whose panel rebuild is
    // still queued for the next frame.
    this.flushUi();
    const id = this.store.activeLayer.id;
    this.expandLayerAncestors(this.store.activeLayer);
    const row = this.layerRow(id);
    if (!row) {
      this.toast('Select a layer row to rename it.');
      return;
    }
    row.scrollIntoView({ block: 'nearest' });
    this.beginLayerRename(id);
  }

  /**
   * Expands every collapsed group above a layer so its row is rendered, and
   * redraws the panel when that changed anything. A layer can be the active
   * one while its group is folded shut, which would otherwise leave `F2` with
   * no row to edit.
   */
  private expandLayerAncestors(layer: Layer): void {
    let changed = false;
    let parent = layer.parent;
    while (parent) {
      if (this.collapsedGroups.delete(parent)) changed = true;
      parent = this.store.sketch.layers.find((l) => l.id === parent)?.parent;
    }
    if (changed) this.renderLayers();
  }

  /** The layers panel row for a layer id, if that row is currently rendered. */
  private layerRow(id: string): HTMLElement | null {
    const rows = el('layers-list').querySelectorAll<HTMLElement>('.layer-row');
    return Array.from(rows).find((row) => row.dataset.layerId === id) ?? null;
  }

  /** Drag handles on the panels' inner edges adjust each panel's width. */
  private bindPanelResize(): void {
    // The layers panel sits on the right, so dragging its handle left widens
    // it; the pages panel sits on the left and widens by dragging right.
    this.bindPanelResizeHandle('layers-resize', 'layers-panel', '--layers-width', -1);
    this.bindPanelResizeHandle('pages-resize', 'pages-panel', '--pages-width', 1);
    this.bindPanelResizeHandle('properties-resize', 'properties-panel', '--properties-width', -1);

    // The panels animate their width over 160 ms, but the open/close toggles
    // can only resize the canvas on the next frame - mid-transition, when
    // the stage still has (nearly) its old size - so closing a panel left
    // the canvas sized as if it were still open. Resize again once the
    // width transition actually lands. (Under reduced motion the transition
    // collapses and the toggles' immediate resize is already correct.)
    for (const panelId of ['pages-panel', 'layers-panel', 'properties-panel']) {
      el(panelId).addEventListener('transitionend', (e) => {
        if (e.target === el(panelId) && e.propertyName === 'width') this.resizeSurface();
      });
    }
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
        // Thumbnails are drawn for an exact pixel width; redraw at the new one.
        if (panelId === 'pages-panel') this.renderThumbnails();
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
    el('page-settings-close').addEventListener('click', () => this.closePageSettings());
  }

  /**
   * Opens the Page Settings dialog pre-filled from the active page.
   *
   * With `forNewPage`, the dialog is instead the size prompt for a page that
   * does not exist yet: Sized Page comes up already applied, and the page is
   * only added if Apply is pressed, so closing the dialog leaves no empty
   * page behind.
   */
  private openPageSettings(options: { forNewPage?: boolean } = {}): void {
    const sketch = this.store.sketch;
    const forNewPage = options.forNewPage === true;
    this.pageSettingsAddsPage = forNewPage;
    const sized = el<HTMLInputElement>('page-sized');
    sized.checked = forNewPage || sketch.sizeMode === 'sized';
    const width = el<HTMLInputElement>('page-width');
    const height = el<HTMLInputElement>('page-height');
    width.value = String(sketch.width);
    height.value = String(sketch.height);
    width.disabled = !sized.checked;
    height.disabled = !sized.checked;
    el('page-settings-title').textContent = forNewPage ? 'New Page' : 'Page Settings';
    el('page-settings-apply').textContent = forNewPage ? 'Add Page' : 'Apply';
    el('page-settings-dialog').classList.remove('is-hidden');
    if (forNewPage) width.focus();
  }

  private applyPageSettings(): void {
    const sized = el<HTMLInputElement>('page-sized').checked;
    const adding = this.pageSettingsAddsPage;
    if (sized) {
      const width = Math.round(Number(el<HTMLInputElement>('page-width').value));
      const height = Math.round(Number(el<HTMLInputElement>('page-height').value));
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < MIN_PAGE_SIZE ||
        height < MIN_PAGE_SIZE
      ) {
        this.toast(`Enter a page width and height of at least ${MIN_PAGE_SIZE} pixels.`);
        return;
      }
      if (adding) this.store.addPage('unnamed');
      this.store.setPageSize('sized', Math.min(MAX_PAGE_SIZE, width), Math.min(MAX_PAGE_SIZE, height));
      this.toast(
        adding
          ? `Added a ${this.store.sketch.width} × ${this.store.sketch.height} page.`
          : `Page sized to ${this.store.sketch.width} × ${this.store.sketch.height}.`,
      );
    } else {
      // Endless pages fall back to tracking the window size.
      if (adding) this.store.addPage('unnamed');
      this.store.setPageSize('endless');
      this.toast(adding ? 'Added an endless page.' : 'Page set to endless (fills the window).');
    }
    this.closePageSettings();
    this.resizeSurface();
    this.renderThumbnails();
  }

  /** Closes the dialog, dropping any pending new page with it. */
  private closePageSettings(): void {
    this.pageSettingsAddsPage = false;
    el('page-settings-dialog').classList.add('is-hidden');
  }

  /**
   * Makes sure there is a layer that can take new marks, and says whether
   * there is.
   *
   * An active *group* is not a refusal: a group holds no marks itself, so a
   * fresh layer drops inside it and the caller carries on - which is what
   * happens when the row picked out in the panel is the group wrapping an
   * imported graphic, the natural row to click to select the whole thing.
   * Only a locked or hidden target actually refuses, and it says which.
   */
  private ensureDrawableLayer(): boolean {
    if (this.store.canDraw) return true;
    const layer = this.store.activeLayer;
    const effective = effectiveLayer(this.store.sketch, layer);
    if (layer.group && effective.visible && !effective.locked) {
      const created = this.store.addLayerInGroup(layer.id);
      this.toast(`"${layer.name}" is a group — added layer "${created.name}" inside it.`);
      return true;
    }
    const kind = layer.group ? 'Group' : 'Layer';
    this.toast(
      effective.locked
        ? `${kind} "${layer.name}" is locked.`
        : `${kind} "${layer.name}" is hidden.`,
    );
    return false;
  }

  /**
   * Delete as the Edit menu, the canvas menu, and the Delete key all mean it:
   * selected elements go first (emptied layers prune away with them); with
   * none, the selected layer rows go, empty layers and groups included.
   */
  private deleteSelectionOrLayers(): void {
    if (this.store.selectedIds.size > 0) {
      this.store.deleteSelected();
      this.renderLayers();
    } else if (this.store.selectedLayerIds.size > 0) {
      this.deleteSelectedLayers();
    }
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
    // The whole stack resolved once for the rebuild, rather than once per row.
    const effectiveOf = effectiveLayers(this.store.sketch);

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
      row.classList.toggle('is-hidden', !(effectiveOf.get(layer.id)?.visible ?? true));
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
      name.title = `${layer.name} (double-click or F2 to rename)`;

      const badge = document.createElement('span');
      badge.className = 'layer-opacity-badge';
      badge.textContent = layer.opacity < 1 ? `${Math.round(layer.opacity * 100)}%` : '';

      row.append(eye, lock, name, badge);
      // Double-click anywhere on the row - not just the name - starts the
      // rename, the pointer counterpart of `F2`. The caret and the two
      // toggles keep their own single-click jobs: a double-click on one of
      // them has already re-rendered the panel, leaving this row detached, so
      // those targets are skipped rather than renamed.
      row.addEventListener('dblclick', (ev) => {
        if (ev.target instanceof Element && ev.target.closest('button')) return;
        ev.preventDefault();
        this.beginLayerRename(layer.id);
      });
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

    el<HTMLInputElement>('layer-opacity').value = String(Math.round(active.opacity * 100));
    el('layer-opacity-value').textContent = `${Math.round(active.opacity * 100)}%`;
    el<HTMLButtonElement>('delete-layer').disabled = layers.filter((l) => !l.group).length <= 1;
    // The move buttons act on the whole selection, groups included, and grey
    // out only where that selection has nowhere left to go.
    const movable =
      this.store.selectedLayerIds.size > 0 ? [...this.store.selectedLayerIds] : [active.id];
    el<HTMLButtonElement>('layer-up').disabled = !this.store.canMoveLayers(movable, 1);
    el<HTMLButtonElement>('layer-down').disabled = !this.store.canMoveLayers(movable, -1);
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

  /**
   * Swaps a layer's name label for an inline rename input. The row is looked
   * up by layer id rather than handed in, because selecting a row redraws the
   * whole panel - the first click of a double-click can replace the very row
   * the second click lands on.
   */
  private beginLayerRename(id: string): void {
    // A rename already in flight keeps its input; re-focusing it re-selects
    // the text instead of starting a second edit over the top of the first.
    const open = el('layers-list').querySelector<HTMLInputElement>('.layer-name-input');
    if (open) {
      open.focus();
      open.select();
      return;
    }
    const row = this.layerRow(id);
    const label = row?.querySelector<HTMLElement>('.layer-name');
    if (!row || !label) return;

    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = label.textContent ?? '';
    row.replaceChild(input, label);
    // The current name arrives highlighted, so typing replaces it outright
    // and an arrow key drops the caret without clearing the name.
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
    if (!prefersReducedMotion()) {
      // Force reflow so the animation restarts each time.
      void stageEl.offsetWidth;
      stageEl.classList.add(forward ? 'turn-next' : 'turn-prev');
      window.setTimeout(() => stageEl.classList.remove('turn-next', 'turn-prev'), PAGE_TURN_MS);
    }
    this.store.goToPage(clamped);
    this.renderThumbnails();
  }

  /** Renders the thumbnail strip for the pages panel. */
  private renderThumbnails(): void {
    if (!this.pagesOpen) return;
    const list = el('thumbs');
    // The canvases stretch to the list's content width (see `.thumb canvas`),
    // and the panel is resizable, so draw at that width times the device
    // pixel ratio - anything less is upscaled and blurry.
    const cssWidth = Math.max(80, Math.round(list.clientWidth - THUMB_CHROME_PX) || THUMB_WIDTH);
    const dpr = Math.min(4, Math.max(1, window.devicePixelRatio || 1));
    list.textContent = '';
    this.store.book.sketches.forEach((sketch, index) => {
      const item = document.createElement('button');
      item.className = 'thumb';
      item.classList.toggle('is-active', index === this.store.activeIndex);
      item.setAttribute('aria-label', `Go to page ${index + 1}`);

      const c = document.createElement('canvas');
      const tw = cssWidth;
      const th = Math.round((sketch.height / sketch.width) * tw) || 96;
      c.width = Math.round(tw * dpr);
      c.height = Math.round(th * dpr);
      const tctx = c.getContext('2d');
      if (tctx) {
        tctx.scale(dpr, dpr);
        tctx.fillStyle = sketch.background;
        tctx.fillRect(0, 0, tw, th);
        const scale = tw / sketch.width;
        tctx.scale(scale, scale);
        tctx.lineCap = 'round';
        tctx.lineJoin = 'round';
        // Resolved once per page rather than per mark: a page has as many
        // layers as it has elements, so asking per mark cost the square of
        // the page's size for every thumbnail in the panel.
        const effectiveOf = effectiveLayers(sketch);
        const layerOfStroke = new Map<string, string>();
        for (const [layerId, marks] of strokesByLayer(sketch)) {
          for (const m of marks) layerOfStroke.set(m.id, layerId);
        }
        for (const s of sketch.strokes) {
          if (isTextStroke(s) || isImageStroke(s)) continue;
          const layerId = layerOfStroke.get(s.id);
          const effective = layerId ? effectiveOf.get(layerId) : undefined;
          if (!effective || !effective.visible) continue;
          tctx.globalAlpha = (s.opacity ?? defaultOpacityFor(s.tool)) * effective.opacity;
          tctx.strokeStyle = s.tool === 'eraser' ? sketch.background : s.color;
          tctx.lineWidth = s.width;
          tctx.beginPath();
          // A `move` point lifts the pen between a compound shape's contours,
          // the way the canvas and the exports read it; drawing straight
          // through them ruled a line across every hole in the thumbnail.
          s.points.forEach((p, i) =>
            i === 0 || p.move ? tctx.moveTo(p.x, p.y) : tctx.lineTo(p.x, p.y),
          );
          if (s.fill && s.tool !== 'eraser' && s.points.length > 2) {
            tctx.closePath();
            tctx.fillStyle = s.fill;
            tctx.fill();
          }
          // A fill-only shape has no outline to draw - painting one in the
          // fill color grew it by half a stroke width in the thumbnail only.
          if (hasOutline(s)) tctx.stroke();
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
      case 'cut':
        this.cutSelection();
        break;
      case 'copy':
        this.copySelectionWithToast();
        break;
      case 'paste':
        void this.pasteClipboard(false);
        break;
      case 'paste-in-place':
        void this.pasteClipboard(true);
        break;
      case 'duplicate':
        this.duplicateSelection();
        break;
      case 'delete-selection':
        this.deleteSelectionOrLayers();
        break;
      case 'select-all':
        this.selectAll();
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
      case 'toggle-properties':
        this.toggleProperties();
        break;
      case 'toggle-settings':
        this.toggleSettings();
        break;
      case 'rotate':
        this.openRotateDialog();
        break;
      case 'toggle-rearrange':
        this.toggleRearrange();
        break;
      case 'toggle-animation':
        this.toggleAnimationMode();
        break;
    }
  }

  // ---- Animation Mode ------------------------------------------------------

  private bindAnimationMode(): void {
    el('animation-exit').addEventListener('click', () => this.toggleAnimationMode(false));
    el('animation-generate').addEventListener('click', () => void this.startAnimationWizard());
  }

  /**
   * Enters or leaves Animation Mode. Entering validates the active page
   * against the required character assemblies and switches to the Select
   * tool, so the smart edit tools (Select, Direct Select, Vector Path,
   * Sharpen Selection) work the existing frame layers instead of laying
   * down new ink by accident.
   */
  private toggleAnimationMode(force?: boolean): void {
    // The one gate for the whole feature: without an install there is no
    // banner, no wizard, and no AI tool in the picture.
    if (!this.animationInstalled) return;
    const next = force ?? !this.animationMode;
    if (next === this.animationMode) return;
    this.animationMode = next;
    document.body.classList.toggle('animation-mode', next);
    el('animation-banner').classList.toggle('is-hidden', !next);
    if (next) {
      // Anything the Move dialog was showing belongs to the sketch, not to a
      // frame: a preview left applied would be baked into the pose the helper
      // is handed, and the dialog itself would sit on top of the wizard.
      if (this.moveDialogOpen) this.closeMoveDialog(true);
      this.store.setTool({ tool: 'select' });
      this.toggleLayers(true);
      this.refreshAnimationStatus();
    }
    this.syncUi();
  }

  /**
   * Updates the banner with the required-assembly validation result for the
   * active page. Rerun on every store change while the mode is active, so
   * renaming or grouping layers flips the status live.
   */
  private refreshAnimationStatus(): void {
    const status = el('animation-status');
    const missing = missingAssemblies(this.store.sketch);
    if (missing.length === 0) {
      status.textContent = 'Character assemblies found. Ready to animate.';
      status.classList.remove('is-missing');
    } else {
      // Only character animations need the assemblies; an object animation
      // moves the graphic as a whole, so this reads as a note, not a block.
      status.textContent = `Missing character assemblies: ${missing.join(', ')} (object animations do not need them)`;
      status.classList.add('is-missing');
    }
  }

  /**
   * Runs the animation wizard: pick the category and animation type, map any
   * missing assemblies onto existing layers, then draw the sequence one
   * frame at a time through the AI helper. The temp form file is cleared
   * when the run ends.
   *
   * Setup comes first because it decides whether the assemblies are needed
   * at all: a character animation moves the six required assemblies, while
   * an object animation moves the graphic as a whole and would have nothing
   * to map an arm or a leg onto.
   */
  private async startAnimationWizard(): Promise<void> {
    if (this.animationBusy) return;

    // The wizard runs again from the top when the completion prompt asks for
    // another animation, so a second sequence picks its own type and length
    // rather than inheriting the finished one's.
    for (;;) {
      const setup = await this.animationStep2(this.animationSourceLayer()?.name ?? null);
      if (!setup) return;

      if (setup.category === 'character') {
        const missing = missingAssemblies(this.store.sketch);
        if (missing.length > 0) {
          const mapped = await this.animationStep1(missing);
          if (!mapped) return;
        }
      }

      if (!(await this.animationStep3(setup))) return;
    }
  }

  /**
   * Announces a finished sequence and asks what happens next. Shown once the
   * run has as many frames as the setup asked for, so the count that was
   * chosen is the count that gets reported.
   *
   * Resolves true when another animation should be set up.
   */
  private animationDonePrompt(frames: number): Promise<boolean> {
    return new Promise((resolve) => {
      const dlg = el('anim-done-dialog');
      el('anim-done-msg').textContent =
        `All ${frames} frame${frames === 1 ? '' : 's'} have been generated.`;
      const done = (again: boolean): void => {
        dlg.classList.add('is-hidden');
        resolve(again);
      };
      el('anim-done-new').onclick = () => done(true);
      el('anim-done-close').onclick = () => done(false);
      dlg.classList.remove('is-hidden');
    });
  }

  /**
   * Step 1: one dialog per missing assembly asking which layers make it up.
   * Each confirmed selection is grouped under a new group layer named for
   * the assembly, so the page validates from then on. Resolves false when
   * the user cancels (Back revisits the previous assembly).
   */
  private async animationStep1(missing: RequiredAssembly[]): Promise<boolean> {
    const chosen = new Map<RequiredAssembly, string[]>();
    let i = 0;
    while (i < missing.length) {
      const taken = new Set([...chosen.values()].flat());
      const result = await this.animationStep1Prompt(missing[i], i > 0, taken);
      if (result === null) return false;
      if (result === 'back') {
        i = Math.max(0, i - 1);
        chosen.delete(missing[i]);
        continue;
      }
      chosen.set(missing[i], result);
      i++;
    }
    for (const [assembly, ids] of chosen) {
      const group = this.store.groupLayers(ids);
      this.store.setLayerProps(group.id, { name: assembly }, false);
    }
    return true;
  }

  /** Shows the step-1 dialog for one assembly; resolves with layer ids, 'back', or null. */
  private animationStep1Prompt(
    assembly: RequiredAssembly,
    canGoBack: boolean,
    taken: Set<string>,
  ): Promise<string[] | 'back' | null> {
    return new Promise((resolve) => {
      const dlg = el('anim-step1-dialog');
      el('anim-step1-msg').textContent =
        `Missing required layers, select layers that consist of the ${assembly}`;

      const list = el('anim-step1-list');
      list.innerHTML = '';
      const candidates = this.store.sketch.layers.filter((l) => !l.parent && !taken.has(l.id));
      for (const layer of candidates) {
        const item = document.createElement('label');
        item.className = 'anim-layer-item';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = layer.id;
        const name = document.createElement('span');
        name.textContent = layer.group ? `${layer.name} (group)` : layer.name;
        item.append(box, name);
        list.append(item);
      }

      const back = el('anim-step1-back');
      back.classList.toggle('is-hidden', !canGoBack);
      const done = (value: string[] | 'back' | null): void => {
        dlg.classList.add('is-hidden');
        resolve(value);
      };
      el('anim-step1-next').onclick = () => {
        const ids = [...list.querySelectorAll<HTMLInputElement>('input:checked')].map(
          (input) => input.value,
        );
        if (ids.length === 0) {
          this.toast('Select at least one layer.');
          return;
        }
        done(ids);
      };
      back.onclick = () => done('back');
      el('anim-step1-cancel').onclick = () => done(null);
      dlg.classList.remove('is-hidden');
    });
  }

  /**
   * Step 2: category and animation type.
   *
   * Both lists are built from `ANIMATION_TYPES`, so every type the table
   * describes is offered and none can appear without the prompt template
   * behind it. Only `walk` runs off a measured cycle; the rest are marked
   * **Work in Progress** and are posed by the AI helper from their template,
   * which is what makes them usable now rather than later.
   *
   * There is no frame count - frames are drawn one at a time and the
   * sequence ends when the user says so - so the note names the frame the
   * first run will draw.
   */
  private animationStep2(sourceName: string | null): Promise<{
    category: AnimationCategory;
    type: string;
    frames: number;
  } | null> {
    return new Promise((resolve) => {
      const dlg = el('anim-step2-dialog');
      const category = el<HTMLSelectElement>('anim-category');
      const type = el<HTMLSelectElement>('anim-type');
      const frames = el<HTMLInputElement>('anim-frames');

      const categories: AnimationCategory[] = ['character', 'object'];
      category.innerHTML = '';
      for (const value of categories) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === 'character' ? 'Character' : 'Object';
        category.append(option);
      }
      if (!categories.includes(category.value as AnimationCategory)) category.value = 'character';
      frames.min = String(MIN_SEQUENCE_FRAMES);
      frames.max = String(MAX_SEQUENCE_FRAMES);

      // The type list follows the category, so the two can never disagree.
      const fillTypes = (): void => {
        const chosen = category.value as AnimationCategory;
        type.innerHTML = '';
        for (const spec of ANIMATION_TYPES.filter((t) => t.category === chosen)) {
          const option = document.createElement('option');
          option.value = spec.id;
          option.textContent =
            spec.status === 'ready' ? spec.label : `${spec.label} (Work in Progress)`;
          type.append(option);
        }
      };

      // Each type opens at its own natural length - the number of skeletons
      // its cycle was measured from - so the default paces one drawn frame
      // per drawn pose and any other number reads as a deliberate choice.
      const fillFrames = (): void => {
        frames.value = String(defaultSequenceFrames(type.value));
      };

      const updateNote = (): void => {
        // The cycle behind a type is the AI helper's business, not the
        // user's: how many skeletons the asset happens to hold says nothing
        // about the sequence being asked for here.
        const spec = animationTypeSpec(type.value);
        const name = animationFrameName(animationFrameJob(sourceName, type.value));
        const note = `First frame drawn: ${name}`;
        el('anim-next-frame').textContent =
          spec && spec.status !== 'ready'
            ? `${note} · work in progress: the AI helper poses this one from a template, so check each frame.`
            : note;
      };

      category.onchange = () => {
        fillTypes();
        fillFrames();
        updateNote();
      };
      type.onchange = () => {
        fillFrames();
        updateNote();
      };
      frames.oninput = updateNote;
      fillTypes();
      fillFrames();
      updateNote();

      const done = (
        value: { category: AnimationCategory; type: string; frames: number } | null,
      ): void => {
        dlg.classList.add('is-hidden');
        resolve(value);
      };
      el('anim-step2-next').onclick = () =>
        done({
          category: category.value as AnimationCategory,
          type: type.value,
          frames: clampSequenceFrames(Number(frames.value)),
        });
      el('anim-step2-cancel').onclick = () => done(null);
      dlg.classList.remove('is-hidden');
    });
  }

  /**
   * Step 3: draw the sequence one frame at a time. Each run hands the AI
   * helper a single pose to advance by one step, so the work stays small
   * enough to finish; the drawn frame imports as a group layer and then
   * becomes the source for the next run. After each frame the dialog offers
   * Redraw, Keep and draw next, or Done, so the sequence runs as long as the
   * user wants. `setup.frames` never limits that: it is the pacing the cycle
   * is spread across, so it decides how far one frame moves, not how many get
   * drawn.
   */
  private async animationStep3(setup: {
    category: AnimationCategory;
    type: string;
    frames: number;
  }): Promise<boolean> {
    const dlg = el('anim-step3-dialog');
    const assemblyNames: Partial<Record<RequiredAssembly, string>> = {};
    for (const [key, layer] of findAssemblyLayers(this.store.sketch)) {
      assemblyNames[key] = layer.name;
    }

    // The first source is the existing frame: its enclosing group when the
    // assemblies share one, the assembly layers themselves when they sit at
    // the top level, and the whole page when there are no assemblies at all -
    // which is how an object animation starts, since it has none.
    const rootLayer = this.animationSourceLayer();
    let sourceName = rootLayer?.name ?? null;
    const assemblyIds = [...findAssemblyLayers(this.store.sketch).values()].map((l) => l.id);
    let sourceIds = rootLayer
      ? [rootLayer.id]
      : assemblyIds.length > 0
        ? assemblyIds
        : this.store.sketch.layers.filter((l) => !l.parent).map((l) => l.id);

    this.animationBusy = true;
    this.animationKept = 0;
    dlg.classList.remove('is-hidden');
    try {
      for (;;) {
        const job = animationFrameJob(sourceName, setup.type);
        const frameName = animationFrameName(job);
        // The pose is measured here, from the frame the helper will edit, so
        // the form can hand over finished transform values instead of asking
        // an AI to work out joint positions from the geometry.
        const step = animationPoseStep(setup.type, job.frameIndex, setup.frames);
        const pose = this.animationPose(sourceIds);
        const form = buildAnimationForm({
          category: setup.category,
          type: setup.type,
          job,
          sourceLayerName: sourceName,
          assemblies: assemblyNames,
          transforms: step
            ? animationFrameTransforms(step, pose.pivots, pose.figureHeight, pose.figurePivot)
            : {},
          frames: setup.frames,
          delivery: this.animationPlugin ? 'plugin' : 'files',
        });

        const frame = await this.animationDrawFrame(
          frameName,
          form,
          job,
          this.animationSubtreeSvg(sourceIds),
        );
        if (!frame) return false;

        const layerId = this.importAnimationFrame(frameName, frame.svg);
        if (!layerId) {
          this.toast(`${frameName} came back empty. See logs/animation-helper.log.`);
          return false;
        }
        // Stand the frame beside its source and bring the strip into view, so
        // the pose can actually be judged before Keep or Redraw.
        this.animationPlaceFrame(layerId, sourceIds);
        this.fitAllInView();
        // Rewrite the saved file from what actually landed: cropped to the
        // ink and transparent, which the helper's own copy of a page-sized
        // source would not be.
        try {
          await window.napkin.saveAnimationFrame(frameName, this.animationSubtreeSvg([layerId]));
        } catch {
          // Outside Electron there is no output folder to rewrite.
        }

        // Keeping this one meets the frame count when it is the last the
        // sequence asked for.
        const choice = await this.animationFrameChoice(
          frameName,
          this.animationKept + 1 >= setup.frames,
        );
        if (choice === 'redraw') {
          this.store.removeLayer(layerId);
          continue;
        }
        this.animationKept++;
        this.toast(`Kept ${frameName} (${this.animationKept} of ${setup.frames}).`);
        // The sequence has as many frames as it was asked for, so it is
        // finished whatever this frame's own answer was.
        if (this.animationKept >= setup.frames) {
          dlg.classList.add('is-hidden');
          return await this.animationDonePrompt(this.animationKept);
        }
        if (choice === 'done') return false;
        sourceName = frameName;
        sourceIds = [layerId];
      }
    } finally {
      this.animationBusy = false;
      dlg.classList.add('is-hidden');
      try {
        await window.napkin.clearAnimationTemp();
      } catch {
        // Temp cleanup is main-process-only; nothing to clear outside Electron.
      }
    }
  }

  /**
   * Runs one frame through the AI helper with the dialog in its working
   * state. Resolves with the drawn frame, or null when the run was
   * cancelled or failed (already reported).
   */
  private async animationDrawFrame(
    frameName: string,
    form: string,
    job: AnimationFrameJob,
    sourceSvg: string,
  ): Promise<AnimationFrameOutput | null> {
    this.animationCancelled = false;
    this.animationStartedAt = Date.now();
    this.animationNote = 'Starting the AI helper…';
    el('anim-step3-title').textContent = `Drawing ${frameName}`;
    this.animationSetDialogState('working');
    this.animationRenderStatus();
    el('anim-step3-cancel').onclick = () => {
      this.animationCancelled = true;
      this.animationNote = 'Cancelling…';
      this.animationRenderStatus();
      try {
        window.napkin.cancelAnimationHelper();
      } catch {
        // Outside Electron there is no helper process to kill.
      }
    };

    // The helper reports what it is doing; the ticker keeps the elapsed
    // readout moving between reports.
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = window.napkin.onAnimationStatus((update) => {
        this.animationNote = update.note;
        this.animationRenderStatus();
      });
    } catch {
      // Outside Electron there is no status feed.
    }
    const ticker = window.setInterval(() => this.animationRenderStatus(), 1000);

    try {
      let result;
      try {
        result = await window.napkin.runAnimationHelper(form, job, sourceSvg);
      } catch {
        this.toast('The AI helper is only available in the desktop app.');
        return null;
      }
      if (this.animationCancelled || result.cancelled) return null;
      if (!result.ok || !result.frame) {
        // A tool that is missing or not signed in is not a drawing problem,
        // and pointing at a log file does not fix it: walk the user into the
        // tool's own sign-in instead.
        if (result.failure === 'auth' || result.failure === 'missing-tool') {
          this.animationToolBinary = result.tool ?? '';
          await this.animationSignInPrompt(
            result.failure,
            result.toolLabel ?? result.tool ?? 'your AI tool',
          );
          return null;
        }
        this.toast(
          `${result.error ?? 'AI helper produced no frame.'} See logs/animation-helper.log.`,
        );
        return null;
      }
      return result.frame;
    } finally {
      window.clearInterval(ticker);
      unsubscribe?.();
    }
  }

  /**
   * Puts the drawn frame up for approval: Redraw discards it and draws the
   * same index again, Next keeps it as the source for the frame after it,
   * and Done ends the sequence with the frame kept.
   */
  private animationFrameChoice(
    frameName: string,
    lastOfSequence: boolean,
  ): Promise<'redraw' | 'next' | 'done'> {
    return new Promise((resolve) => {
      el('anim-step3-title').textContent = `${frameName} drawn`;
      // Keeping this one finishes the sequence, so the button that keeps it
      // says as much and leads. The completion prompt does the announcing
      // once the frame is actually kept, so nothing is said twice here.
      this.animationNote = lastOfSequence
        ? 'This is the last frame the sequence asked for. Keep it to finish, or redraw it.'
        : 'Keep this frame and draw the next, redraw it, or finish here.';
      el('anim-step3-next').textContent = lastOfSequence
        ? 'Keep and finish'
        : 'Keep and draw next';
      this.animationSetDialogState('decision');
      this.animationRenderStatus();
      const done = (choice: 'redraw' | 'next' | 'done'): void => resolve(choice);
      el('anim-step3-redraw').onclick = () => done('redraw');
      el('anim-step3-next').onclick = () => done('next');
      el('anim-step3-done').onclick = () => done('done');
    });
  }

  /**
   * Walks the user into their AI tool's own sign-in.
   *
   * Animation Mode is the only feature that needs an outside tool, so the two
   * ways it can fail before drawing anything - the tool is not on the PATH,
   * or nobody has signed in to it - deserve an answer rather than a toast
   * pointing at a log. **Open sign-in** starts the tool in a terminal of its
   * own, where it runs whatever sign-in it uses.
   *
   * napkin-sketch never asks for, reads, or stores a credential. It starts
   * the tool and steps out of the way; the account stays between the user and
   * that tool.
   */
  private animationSignInPrompt(
    failure: 'auth' | 'missing-tool',
    toolLabel: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      const dlg = el('anim-signin-dialog');
      const missing = failure === 'missing-tool';
      el('anim-signin-title').textContent = missing
        ? `${toolLabel} was not found`
        : `Sign in to ${toolLabel}`;
      el('anim-signin-msg').textContent = missing
        ? `Animation Mode runs ${toolLabel}, and it is not on this machine's PATH. Install it, or point the helper command at the tool you do have.`
        : `Animation Mode ran ${toolLabel}, which reported that it is not signed in. Sign in once and the frame can be drawn.`;

      const steps = el('anim-signin-steps');
      steps.innerHTML = '';
      const addStep = (text: string, code?: string): void => {
        const li = document.createElement('li');
        li.textContent = text;
        if (code) {
          const tag = document.createElement('code');
          tag.textContent = code;
          li.append(' ', tag);
        }
        steps.append(li);
      };
      if (missing) {
        addStep(`Install ${toolLabel} and make sure its command runs in a terminal.`);
        addStep('Or set a different tool in Verbose Settings:', 'animationHelperCommand');
      } else {
        addStep('Open sign-in below, or start the tool yourself:', this.animationToolBinary);
        addStep('Follow the prompt the tool shows to sign in to your account.');
        addStep('Come back and press Generate again.');
      }

      const done = (): void => {
        dlg.classList.add('is-hidden');
        resolve();
      };
      const open = el('anim-signin-open');
      open.classList.toggle('is-hidden', missing || !this.animationToolBinary);
      open.onclick = () => {
        void (async () => {
          try {
            const result = await window.napkin.openAiToolSignIn(this.animationToolBinary);
            this.toast(
              result.ok
                ? `Opened a terminal for ${toolLabel}. Sign in there, then press Generate again.`
                : (result.error ?? `Could not start ${toolLabel}.`),
            );
          } catch {
            this.toast('Starting the AI tool is only available in the desktop app.');
          }
          done();
        })();
      };
      el('anim-signin-cancel').onclick = () => done();
      dlg.classList.remove('is-hidden');
    });
  }

  /** Swaps the generation dialog between its working and approval states. */
  private animationSetDialogState(state: 'working' | 'decision'): void {
    const working = state === 'working';
    el('anim-progress').classList.toggle('is-busy', working);
    el('anim-progress').classList.toggle('is-hidden', !working);
    el('anim-step3-cancel').classList.toggle('is-hidden', !working);
    for (const id of ['anim-step3-redraw', 'anim-step3-next', 'anim-step3-done']) {
      el(id).classList.toggle('is-hidden', working);
    }
  }

  /** Renders the helper's latest note, the elapsed time, and the frame tally. */
  private animationRenderStatus(): void {
    const seconds = Math.floor((Date.now() - this.animationStartedAt) / 1000);
    const kept = `${this.animationKept} frame${this.animationKept === 1 ? '' : 's'} kept`;
    el('anim-step3-status').textContent = `${this.animationNote} · ${seconds}s · ${kept}`;
  }

  /**
   * The group layer holding the required assemblies, when a single one does.
   * That layer is the source frame and its name drives the sequence naming;
   * assemblies sitting at the top level have no shared parent and start a
   * fresh `animationLayer-<type>` sequence instead.
   */
  private animationSourceLayer(): Layer | undefined {
    const sketch = this.store.sketch;
    const roots = new Set(
      [...findAssemblyLayers(sketch).values()].map((layer) => topMostParent(sketch, layer).id),
    );
    if (roots.size !== 1) return undefined;
    return sketch.layers.find((l) => l.id === [...roots][0] && l.group);
  }

  /**
   * Imports one drawn frame as a group layer continuing the sequence and
   * returns the new layer's id, so the next frame can be drawn from it (and
   * a redraw can drop it again). Null when the markup held no layers.
   */
  private importAnimationFrame(name: string, svg: string): string | null {
    const before = new Set(this.store.sketch.layers.map((l) => l.id));
    const imported = importSvg(svg, { unnamedRootName: name });
    if (imported.layers.length === 0) return null;
    const node: ImportedLayerNode =
      imported.layers.length === 1
        ? { ...imported.layers[0], name }
        : { name, opacity: 1, strokes: [], children: imported.layers };
    this.store.addImportedLayers([node]);
    const added = this.store.sketch.layers.find((l) => !before.has(l.id) && !l.parent);
    return added?.id ?? null;
  }

  /**
   * Measures the source frame: where each assembly's joint sits and how tall
   * the whole figure is. The helper is handed finished `transform` values
   * built from these numbers, so it never has to work out a pivot from the
   * geometry - the app already knows where every stroke is.
   *
   * Assemblies are resolved inside the source subtree, not across the page:
   * once a generated frame lands, the document holds more than one set of
   * assemblies and only the source frame's own may be measured.
   */
  private animationPose(rootIds: string[]): {
    pivots: Partial<Record<RequiredAssembly, AnimationPoint>>;
    figureHeight: number;
    figurePivot?: AnimationPoint;
  } {
    const sketch = this.store.sketch;
    const scope = new Set<string>();
    for (const rootId of rootIds) {
      scope.add(rootId);
      for (const id of descendantLayerIds(sketch, rootId)) scope.add(id);
    }

    const pivots: Partial<Record<RequiredAssembly, AnimationPoint>> = {};
    let figureTop = Infinity;
    let figureBottom = -Infinity;
    for (const assembly of REQUIRED_ASSEMBLIES) {
      const layer = sketch.layers.find(
        (l) => scope.has(l.id) && matchesAssembly(l.name, assembly),
      );
      if (!layer) continue;
      const bounds = this.animationLayerBounds([layer.id]);
      if (!bounds) continue;
      figureTop = Math.min(figureTop, bounds.minY);
      figureBottom = Math.max(figureBottom, bounds.maxY);
      const pivot = assemblyPivot(assembly, bounds);
      if (pivot) pivots[assembly] = pivot;
    }
    const figureHeight = figureBottom > figureTop ? figureBottom - figureTop : 0;
    // A figure tips about the ground it stands on, so the whole-figure pivot
    // is the bottom-centre of its bounds rather than a joint.
    const whole = this.animationLayerBounds(rootIds);
    const figurePivot = whole
      ? { x: (whole.minX + whole.maxX) / 2, y: whole.maxY }
      : undefined;
    return { pivots, figureHeight, figurePivot };
  }

  /**
   * Moves a drawn frame so it stands to the right of the frame it came from
   * instead of on top of it. A generated frame is a copy of its source with
   * the assemblies turned, so it lands in the source's own coordinates and
   * the two overlap exactly - the new pose is invisible under the old one,
   * and there is nothing to judge before keeping or redrawing it.
   *
   * Frames chain, so each run pushes another panel further right and the
   * sequence reads as an animation strip. Only x moves: the cycle's vertical
   * bob is part of the pose.
   */
  private animationPlaceFrame(frameLayerId: string, sourceIds: string[]): void {
    const source = this.animationLayerBounds(sourceIds);
    const frame = this.animationLayerBounds([frameLayerId]);
    if (!source || !frame) return;
    const dx = animationFrameOffsetX(source, frame);
    if (dx === 0) return;
    const strokeIds = this.strokesInLayerSubtree([frameLayerId]).map((s) => s.id);
    // No history step of its own: the placement belongs to the import that
    // preceded it, so one undo takes the whole frame back off the page.
    this.store.moveStrokes(strokeIds, dx, 0, false);
  }

  /** Every stroke on the given layers and their descendants. */
  private strokesInLayerSubtree(layerIds: string[]): Stroke[] {
    const sketch = this.store.sketch;
    const ids = new Set<string>();
    for (const layerId of layerIds) {
      ids.add(layerId);
      for (const id of descendantLayerIds(sketch, layerId)) ids.add(id);
    }
    return sketch.strokes.filter((s) => ids.has(layerOf(sketch, s).id));
  }

  /** Union of the given strokes' bounds, or null when none of them has any. */
  private boundsOfStrokes(strokes: Stroke[]): AnimationBounds | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of strokes) {
      const b = strokeBounds(stroke, (t) => this.surface.measureText(t));
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  /**
   * Bounds to size an export by: the stroke bounds grown by half the widest
   * outline. `strokeBounds` follows centerlines, so a box drawn on them alone
   * would slice the outer edge of the ink off the graphic.
   */
  private cropBoundsOfStrokes(strokes: Stroke[]): AnimationBounds | null {
    const bounds = this.boundsOfStrokes(strokes);
    if (!bounds) return null;
    let widest = 0;
    for (const stroke of strokes) widest = Math.max(widest, stroke.width ?? 0);
    return expandBounds(bounds, widest / 2);
  }

  /** Bounds of every stroke on the given layers and their descendants. */
  private animationLayerBounds(layerIds: string[]): AnimationBounds | null {
    return this.boundsOfStrokes(this.strokesInLayerSubtree(layerIds));
  }

  /** Bounds to size an exported animation frame by. */
  private animationCropBounds(layerIds: string[]): AnimationBounds | null {
    return this.cropBoundsOfStrokes(this.strokesInLayerSubtree(layerIds));
  }

  /**
   * A frame as a standalone SVG document: the given layers (with their
   * descendants and enclosing groups) exported alone, sized to the ink and
   * left transparent.
   *
   * Both the pose handed to the AI helper and the file kept in
   * `animations/` are written this way, so a frame is a sprite as it stands -
   * no page-sized margin of empty space around it, and no paper rectangle
   * behind it to punch a hole in a composition.
   */
  private animationSubtreeSvg(rootIds: string[]): string {
    const sketch = this.store.sketch;
    const keep = new Set<string>();
    for (const rootId of rootIds) {
      const layer = sketch.layers.find((l) => l.id === rootId);
      if (!layer) continue;
      keep.add(layer.id);
      for (const id of descendantLayerIds(sketch, layer.id)) keep.add(id);
      let parent = sketch.layers.find((l) => l.id === layer.parent);
      while (parent && !keep.has(parent.id)) {
        keep.add(parent.id);
        parent = sketch.layers.find((l) => l.id === parent!.parent);
      }
    }
    const layers = sketch.layers.filter((l) => keep.has(l.id));
    const strokes = sketch.strokes.filter((s) => keep.has(layerOf(sketch, s).id));
    const crop = this.animationCropBounds(rootIds);
    return Surface.toSVG(
      { ...sketch, layers, strokes },
      { transparent: true, ...(crop ? { crop } : {}) },
    );
    return Surface.toSVG({ ...sketch, layers, strokes });
  }

  // ---- Properties panel ----------------------------------------------------

  /**
   * Wires the properties panel: the position, appearance, and scale fields
   * for whatever is selected. The panel edits the canvas selection, and the
   * store keeps that in step with the layers panel - selecting a layer row
   * selects the elements on it - so a selected layer's stroke width is
   * editable here too.
   */
  private bindProperties(): void {
    el('properties-toggle').addEventListener('click', () => this.toggleProperties());
    el('properties-close').addEventListener('click', () => this.toggleProperties(false));

    // The unit pickers are built from the shared unit tables, so the options
    // offered and the conversions applied can never drift apart.
    this.fillUnitSelect('prop-x-unit', LENGTH_UNITS, this.propUnits.x);
    this.fillUnitSelect('prop-y-unit', LENGTH_UNITS, this.propUnits.y);
    this.fillUnitSelect('prop-scale-x-unit', SCALE_UNITS, this.propUnits.scaleX);
    this.fillUnitSelect('prop-scale-y-unit', SCALE_UNITS, this.propUnits.scaleY);

    const onUnitChange = (id: string, apply: (value: string) => void): void => {
      const select = el<HTMLSelectElement>(id);
      select.addEventListener('change', () => {
        apply(select.value);
        this.renderProperties();
      });
    };
    onUnitChange('prop-x-unit', (v) => {
      if (isLengthUnit(v)) this.propUnits.x = v;
    });
    onUnitChange('prop-y-unit', (v) => {
      if (isLengthUnit(v)) this.propUnits.y = v;
    });
    onUnitChange('prop-scale-x-unit', (v) => {
      if (isScaleUnit(v)) this.propUnits.scaleX = v;
    });
    onUnitChange('prop-scale-y-unit', (v) => {
      if (isScaleUnit(v)) this.propUnits.scaleY = v;
    });

    // Position: the field holds the selection's top-left corner, so typing a
    // value moves the whole selection to it rather than resizing anything.
    el<HTMLInputElement>('prop-x').addEventListener('change', () => this.commitPosition('x'));
    el<HTMLInputElement>('prop-y').addEventListener('change', () => this.commitPosition('y'));

    // Fill: a live color drag collapses into one history step, the same way
    // the layer-opacity slider does.
    const fill = el<HTMLInputElement>('prop-fill');
    fill.addEventListener('input', () => {
      this.applyPropertyFill(fill.value, !this.fillDragging);
      this.fillDragging = true;
    });
    fill.addEventListener('change', () => {
      this.fillDragging = false;
    });
    el('prop-fill-remove').addEventListener('click', () => {
      const targets = this.propertyTargets();
      if (targets.length === 0) return;
      this.store.setStrokeProps(targets, { fill: undefined, gradient: undefined });
      this.toast('Removed the fill.');
    });
    el('prop-fill-gradient').addEventListener('click', () => this.startGradient());

    this.bindGradientEditor();

    // Stroke.
    const strokeWidth = el<HTMLInputElement>('prop-stroke-width');
    strokeWidth.addEventListener('change', () => {
      const shapes = this.propertyShapes().map((stroke) => stroke.id);
      const value = Number(strokeWidth.value);
      if (shapes.length === 0 || !Number.isFinite(value) || value <= 0) {
        this.renderProperties();
        return;
      }
      this.store.setStrokeProps(shapes, { width: Math.min(400, Math.max(0.5, value)) });
    });

    const strokeStyle = el<HTMLSelectElement>('prop-stroke-style');
    strokeStyle.addEventListener('change', () => {
      const shapes = this.propertyShapes().map((stroke) => stroke.id);
      if (shapes.length === 0) return;
      const value = strokeStyle.value as StrokeStyle;
      const style = STROKE_STYLES.includes(value) ? value : 'solid';
      // 'solid' is the absent state, not a stored one.
      this.store.setStrokeProps(shapes, { strokeStyle: style === 'solid' ? undefined : style });
    });

    el('prop-stroke-remove').addEventListener('click', () => {
      const strokes = this.propertyShapes();
      if (strokes.length === 0) return;
      // A mixed selection turns every outline off; an all-off one turns them
      // back on, so the button always has an unambiguous next state.
      const restore = strokes.every((stroke) => stroke.noStroke === true);
      this.store.setStrokeProps(
        strokes.map((stroke) => stroke.id),
        { noStroke: restore ? undefined : true },
      );
      this.toast(restore ? 'Restored the outline.' : 'Removed the outline.');
    });

    // Scale.
    el<HTMLInputElement>('prop-scale-x').addEventListener('change', () => this.commitScale('x'));
    el<HTMLInputElement>('prop-scale-y').addEventListener('change', () => this.commitScale('y'));
    el<HTMLInputElement>('prop-scale-uniform').addEventListener('change', () =>
      this.renderProperties(),
    );
  }

  /** Fills a unit picker with the shared unit list and selects one. */
  private fillUnitSelect(id: string, units: readonly string[], selected: string): void {
    const select = el<HTMLSelectElement>(id);
    select.textContent = '';
    for (const unit of units) {
      const option = document.createElement('option');
      option.value = unit;
      option.textContent = unit;
      select.appendChild(option);
    }
    select.value = selected;
  }

  /**
   * Restacks the selection one step (Ctrl+] / Ctrl+[ and the panel's move
   * buttons). Every selected row moves, not just the active one, and a
   * selected group takes its contents with it. The ends of the stack have
   * nowhere to go, so that case says so instead of failing silently.
   */
  private moveSelectedLayers(direction: 1 | -1): void {
    const ids =
      this.store.selectedLayerIds.size > 0
        ? [...this.store.selectedLayerIds]
        : [this.store.activeLayer.id];
    if (!this.store.moveLayers(ids, direction)) {
      const many = ids.length > 1;
      this.toast(
        direction === 1
          ? many
            ? 'Already at the top of the stack.'
            : 'Already the top layer.'
          : many
            ? 'Already at the bottom of the stack.'
            : 'Already the bottom layer.',
      );
      return;
    }
    this.renderLayers();
  }

  private toggleProperties(force?: boolean): void {
    this.propertiesOpen = force ?? !this.propertiesOpen;
    el('app').classList.toggle('properties-open', this.propertiesOpen);
    el('properties-toggle').classList.toggle('is-open', this.propertiesOpen);
    if (this.propertiesOpen) this.renderProperties();
    requestAnimationFrame(() => this.resizeSurface());
  }

  /**
   * The elements the panel edits. Selecting a layer row selects that layer's
   * elements (see `Store.selectLayer`), so this covers both the canvas
   * selection and a layer picked in the layers panel.
   */
  private propertyStrokes(): Stroke[] {
    return this.store.sketch.strokes.filter((s) => this.store.selectedIds.has(s.id));
  }

  private propertyTargets(): string[] {
    return this.propertyStrokes().map((stroke) => stroke.id);
  }

  /**
   * The selected elements an outline applies to. A text item's weight is its
   * font size and a placed image has no outline at all, so neither takes a
   * stroke width, dash style, or fill-only state.
   */
  private propertyShapes(): Stroke[] {
    return this.propertyStrokes().filter((s) => !isTextStroke(s) && !isImageStroke(s));
  }


  // ---- Move dialog ---------------------------------------------------------

  /**
   * Wires the Move dialog: a distance typed in rather than dragged. The
   * Properties panel already sets an absolute position, so this one is
   * relative - which is what "nudge it ten to the right" wants, and what the
   * same dialog does in every other editor.
   */
  private bindMove(): void {
    this.fillUnitSelect('move-x-unit', LENGTH_UNITS, this.propUnits.x);
    this.fillUnitSelect('move-y-unit', LENGTH_UNITS, this.propUnits.y);
    el('move-selection').addEventListener('click', () => this.openMoveDialog());
    el('move-cancel').addEventListener('click', () => this.closeMoveDialog(true));
    el('move-apply').addEventListener('click', () => {
      this.applyMove();
      this.closeMoveDialog(false);
    });
    el<HTMLInputElement>('move-preview').addEventListener('change', () => this.syncMovePreview());
    el<HTMLSelectElement>('move-x-unit').addEventListener('change', () =>
      this.changeMoveUnit('x'),
    );
    el<HTMLSelectElement>('move-y-unit').addEventListener('change', () =>
      this.changeMoveUnit('y'),
    );
    for (const id of ['move-x', 'move-y']) {
      const input = el<HTMLInputElement>(id);
      input.addEventListener('input', () => this.syncMovePreview());
      input.addEventListener('keydown', (ev) => this.onMoveFieldKey(ev, input));
    }
  }

  /**
   * Registers every editing popup with the shared {@link PopupManager}.
   *
   * The four capabilities - moveable, resizable, dockable, undockable - used
   * to be one private routine here that only the Move dialog called; they are
   * a module now because the moment Rotate wanted the same thing, keeping one
   * copy stopped being optional. Each popup says what it wants rather than
   * inheriting whatever the routine happened to do.
   */
  private bindPopups(): void {
    // The editing palettes: they sit over the drawing they are editing, which
    // is exactly why each one can be pushed aside or parked in the dock.
    for (const id of ['move-dialog', 'rotate-dialog', 'page-settings-dialog', 'sharpen-dialog']) {
      this.popups.register(id, { moveable: true, resize: true, dockable: true });
    }
    // The wizard's own dialogs move and resize the same way, so a step can be
    // pushed aside to see the frame it is talking about. They are not
    // dockable: a step of a modal flow parked in a column would be a prompt
    // with nothing left to answer it.
    for (const id of [
      'anim-step1-dialog',
      'anim-step2-dialog',
      'anim-step3-dialog',
      'anim-done-dialog',
      'anim-signin-dialog',
    ]) {
      this.popups.register(id, { moveable: true, resize: true });
    }
  }

  /** Pulls the Move panel back on screen, after a resize or before opening. */
  private clampMoveDialog(): void {
    this.popups.clamp('move-dialog');
  }

  /**
   * Arrow keys step a field by its unit's own increment, and Shift takes the
   * coarse one. The browser's native spinner only knows the `step` attribute,
   * which cannot change with a modifier, so both arrows are handled here.
   *
   * Enter applies the move and leaves the dialog open: the selection has
   * moved, the fields still hold the same distance, and pressing Enter again
   * moves it that far again from where it now is.
   */
  private onMoveFieldKey(ev: KeyboardEvent, input: HTMLInputElement): void {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const unitId = input.id === 'move-x' ? 'move-x-unit' : 'move-y-unit';
      const unit = el<HTMLSelectElement>(unitId).value;
      const step = isLengthUnit(unit) ? nudgeStep(unit, ev.shiftKey) : ev.shiftKey ? 10 : 1;
      const current = Number(input.value);
      const next = (Number.isFinite(current) ? current : 0) + (ev.key === 'ArrowUp' ? step : -step);
      // Trim the float noise a step of 0.125 or 3.175 leaves behind.
      input.value = String(Number(next.toFixed(4)));
      this.syncMovePreview();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.applyMove();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.closeMoveDialog(true);
    }
  }

  /** The unit each Move field is currently written in, for converting on a change. */
  private moveUnits: { x: LengthUnit; y: LengthUnit } = { x: 'px', y: 'px' };

  /** The distance a live preview is currently showing, and on what. */
  private movePreview: { ids: string[]; dx: number; dy: number } | null = null;

  /**
   * True when Enter should reach the Move dialog. Any other dialog on screen
   * owns the keyboard - Enter in an Animation Mode step means that step's
   * Next, and opening Move on top of it was what made the wizard look broken
   * - and Animation Mode itself is about frames rather than moving marks.
   */
  private canOpenMoveDialog(): boolean {
    if (this.moveDialogOpen || this.animationMode) return false;
    if (this.store.selectedIds.size === 0) return false;
    return !this.otherDialogOpen();
  }

  /**
   * True while any dialog other than `except` is showing. Both the Move and
   * the Rotate palette ask this of the other: two floating panels editing the
   * same selection would each be previewing a transform the other cannot see.
   */
  private otherDialogOpen(except = 'move-dialog'): boolean {
    for (const dlg of document.querySelectorAll<HTMLElement>('.export-dialog')) {
      if (dlg.id !== except && !dlg.classList.contains('is-hidden')) return true;
    }
    return false;
  }

  /** True while the Move dialog is up. */
  private get moveDialogOpen(): boolean {
    return !el('move-dialog').classList.contains('is-hidden');
  }

  /**
   * Rewrites a field in its new unit when the unit picker changes, so the
   * distance stays what it was and only the way it is written changes: an
   * inch becomes 25.4 mm rather than 1 mm. The preview is left showing the
   * same physical move, because the distance behind it did not move.
   */
  private changeMoveUnit(axis: 'x' | 'y'): void {
    const select = el<HTMLSelectElement>(axis === 'x' ? 'move-x-unit' : 'move-y-unit');
    const input = el<HTMLInputElement>(axis === 'x' ? 'move-x' : 'move-y');
    const next = select.value;
    if (isLengthUnit(next)) {
      const previous = this.moveUnits[axis];
      const typed = Number(input.value);
      if (next !== previous && Number.isFinite(typed)) {
        input.value = formatLength(toPx(typed, previous), next);
      }
      this.moveUnits[axis] = next;
    }
    this.syncMoveSteps();
    this.syncMovePreview();
  }

  /** Puts each field's spinner step on its unit's fine increment. */
  private syncMoveSteps(): void {
    for (const [id, unitId] of [
      ['move-x', 'move-x-unit'],
      ['move-y', 'move-y-unit'],
    ]) {
      const unit = el<HTMLSelectElement>(unitId).value;
      el<HTMLInputElement>(id).step = String(isLengthUnit(unit) ? nudgeStep(unit, false) : 1);
    }
  }

  /**
   * Opens the Move dialog for the current selection. Nothing selected means
   * there is nothing to move, which is worth saying rather than showing an
   * empty dialog.
   */
  private openMoveDialog(): void {
    if (this.animationMode) {
      this.toast('Move is not available in Animation Mode.');
      return;
    }
    if (this.otherDialogOpen()) return;
    const targets = this.propertyTargets();
    if (targets.length === 0) {
      this.toast('Select something to move first.');
      return;
    }
    el('move-msg').textContent =
      `Move ${targets.length} selected element${targets.length === 1 ? '' : 's'} by a set distance.`;
    const x = el<HTMLInputElement>('move-x');
    const y = el<HTMLInputElement>('move-y');
    x.value = '0';
    y.value = '0';
    el<HTMLSelectElement>('move-x-unit').value = this.propUnits.x;
    el<HTMLSelectElement>('move-y-unit').value = this.propUnits.y;
    this.moveUnits = { x: this.propUnits.x, y: this.propUnits.y };
    this.syncMoveSteps();
    el('move-dialog').classList.remove('is-hidden');
    // A panel left near an edge last time must not open off screen if the
    // window has shrunk since.
    this.clampMoveDialog();
    x.focus();
    x.select();
  }

  /** Closes the dialog, dropping any live preview when the move was abandoned. */
  private closeMoveDialog(revert: boolean): void {
    if (revert) this.revertMovePreview();
    else this.movePreview = null;
    // A drag that was still in hand when the dialog went - entering Animation
    // Mode, say - would otherwise leave the grab cursor stuck on the page.
    this.popups.releaseGrabs('move-dialog');
    el('move-dialog').classList.add('is-hidden');
  }

  /** The typed distance in canvas pixels, or null when either field is not a number. */
  private moveDelta(): { dx: number; dy: number } | null {
    const xUnit = el<HTMLSelectElement>('move-x-unit').value;
    const yUnit = el<HTMLSelectElement>('move-y-unit').value;
    const rawX = Number(el<HTMLInputElement>('move-x').value);
    const rawY = Number(el<HTMLInputElement>('move-y').value);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
    return {
      dx: isLengthUnit(xUnit) ? toPx(rawX, xUnit) : rawX,
      dy: isLengthUnit(yUnit) ? toPx(rawY, yUnit) : rawY,
    };
  }

  /**
   * Shows the typed distance on the canvas while it is being typed.
   *
   * The preview is the real move, made and unmade: the difference between
   * what is showing and what is now typed is applied each time, and none of
   * it takes a history step. Committing puts the preview back first and then
   * moves once for real, so the whole thing is a single undo.
   */
  private syncMovePreview(): void {
    const wanted =
      this.moveDialogOpen && el<HTMLInputElement>('move-preview').checked
        ? this.moveDelta()
        : null;
    if (!wanted) {
      this.revertMovePreview();
      return;
    }
    const showing = this.movePreview;
    const ids = showing ? showing.ids : this.propertyTargets();
    if (ids.length === 0) return;
    const dx = wanted.dx - (showing?.dx ?? 0);
    const dy = wanted.dy - (showing?.dy ?? 0);
    if (dx !== 0 || dy !== 0) this.store.moveStrokes(ids, dx, dy, false);
    this.movePreview = { ids, dx: wanted.dx, dy: wanted.dy };
  }

  /** Takes a live preview back off the canvas, leaving no history behind. */
  private revertMovePreview(): void {
    const showing = this.movePreview;
    this.movePreview = null;
    if (!showing) return;
    if (showing.dx !== 0 || showing.dy !== 0) {
      this.store.moveStrokes(showing.ids, -showing.dx, -showing.dy, false);
    }
  }

  /**
   * Applies the typed distance from wherever the selection is now.
   *
   * The dialog stays open, so Enter can be pressed again to move the same
   * distance again - each press measured from the selection's current
   * position rather than accumulating against the one it started at.
   */
  private applyMove(): void {
    const targets = this.propertyTargets();
    if (targets.length === 0) {
      this.closeMoveDialog(true);
      return;
    }
    const delta = this.moveDelta();
    if (!delta) {
      this.toast('Type a number for each distance.');
      return;
    }
    // The preview is undone first so the committed move is one history step
    // covering the whole distance, not a second one stacked on a shown move.
    this.revertMovePreview();
    if (delta.dx === 0 && delta.dy === 0) return;
    this.store.moveStrokes(targets, delta.dx, delta.dy);
    const xUnit = el<HTMLSelectElement>('move-x-unit').value;
    const yUnit = el<HTMLSelectElement>('move-y-unit').value;
    this.toast(
      `Moved ${targets.length} element${targets.length === 1 ? '' : 's'} by ` +
        `${el<HTMLInputElement>('move-x').value} ${xUnit}, ${el<HTMLInputElement>('move-y').value} ${yUnit}.`,
    );
    // Put the preview back so the canvas keeps showing what the next Enter
    // would do, now measured from where the selection has landed.
    this.syncMovePreview();
  }


  // ---- Rotate tool ---------------------------------------------------------

  /** The unit each Rotate centre field is written in, for converting on a change. */
  private rotateUnits: { x: LengthUnit; y: LengthUnit } = { x: 'px', y: 'px' };

  /** The rotation a live preview is currently showing, on what, and about where. */
  private rotatePreview: { ids: string[]; degrees: number; cx: number; cy: number } | null = null;

  /** The centre the selection turns about, in sketch coordinates. */
  private rotateCenter: Point | null = null;

  /**
   * The selection's box as it stood when the dialog last opened or committed,
   * which is what the nine preset centres are measured on. Taken while no
   * preview is showing, so a preset does not drift as the shape turns under
   * it - the box of a rotated shape is not the box of the shape.
   */
  private rotateBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  /** Which preset centre is in force, or null once one is dragged or typed. */
  private rotateAnchorKey: RotateAnchor | null = 'mc';

  /**
   * A rotate drag in hand: the pointer driving it, the bearing it last read,
   * the running total it has turned through (which keeps counting past a full
   * lap), and the angle it started from.
   */
  private rotateDrag: {
    pointerId: number;
    bearing: number;
    turned: number;
    base: number;
  } | null = null;

  /** The pointer dragging the centre marker itself, when one is. */
  private rotateCenterDrag: number | null = null;

  /** Where the pointer is while a rotate drag runs, for the overlay's lever. */
  private rotateRay: Point | null = null;

  /** True while the pointer is close enough to the centre marker to grab it. */
  private rotateOverCenter = false;

  /**
   * True when releasing a canvas rotate drag should accept the rotation and
   * put the palette away, rather than leaving it up for another turn.
   *
   * Set only when `Ctrl+R` opened it. Reaching for the keyboard shortcut is a
   * gesture in itself - press, swing, let go - and it is finished when the
   * pointer comes up; having then to find the Rotate button or press Escape is
   * one step too many for what was meant to be quick. Opening the palette from
   * the toolbar or the menu is the opposite intent, a panel wanted for typed
   * angles, presets, and repeated turns, so that one stays put.
   */
  private rotateAcceptOnRelease = false;

  /**
   * Wires the Rotate dialog: an angle typed in or dragged out, turned about a
   * centre that can be put anywhere.
   *
   * The dialog is the Move palette's twin - floating, resizable, and not
   * dimming the page - for the same reason and then one more: the canvas
   * underneath is where the rotation is actually dragged, so the panel has to
   * stay clear of a gesture aimed past it.
   */
  private bindRotate(): void {
    this.fillUnitSelect('rotate-cx-unit', LENGTH_UNITS, this.propUnits.x);
    this.fillUnitSelect('rotate-cy-unit', LENGTH_UNITS, this.propUnits.y);

    el('rotate-selection').addEventListener('click', () => this.openRotateDialog());
    el('rotate-cancel').addEventListener('click', () => this.closeRotateDialog(true));
    el('rotate-apply').addEventListener('click', () => {
      this.applyRotate();
      this.closeRotateDialog(false);
    });

    // The direction pair sets the sign of whatever magnitude is typed, which
    // is how a rotate panel is normally driven: a quarter turn is "90, that
    // way" rather than a number someone has to remember to write negative.
    el('rotate-cw').addEventListener('click', () => this.setRotateDirection(1));
    el('rotate-ccw').addEventListener('click', () => this.setRotateDirection(-1));

    const grid = '#rotate-anchor-grid .rotate-anchor';
    for (const button of document.querySelectorAll<HTMLElement>(grid)) {
      button.addEventListener('click', () => {
        const key = button.dataset.anchor;
        if (isRotateAnchor(key)) this.setRotateAnchor(key);
      });
    }

    const angle = el<HTMLInputElement>('rotate-angle');
    angle.addEventListener('input', () => {
      this.syncRotateDirection();
      this.syncRotatePreview();
    });
    angle.addEventListener('keydown', (ev) => this.onRotateAngleKey(ev, angle));

    for (const id of ['rotate-cx', 'rotate-cy']) {
      const input = el<HTMLInputElement>(id);
      input.addEventListener('input', () => this.readRotateCenterFields());
      input.addEventListener('keydown', (ev) => this.onRotateCenterKey(ev, input));
    }
    el<HTMLSelectElement>('rotate-cx-unit').addEventListener('change', () =>
      this.changeRotateUnit('x'),
    );
    el<HTMLSelectElement>('rotate-cy-unit').addEventListener('change', () =>
      this.changeRotateUnit('y'),
    );
    el<HTMLInputElement>('rotate-preview').addEventListener('change', () =>
      this.syncRotatePreview(),
    );
    // Arming the snap tidies whatever is already typed, so the checkbox has a
    // visible effect rather than only changing what the next gesture does.
    el<HTMLInputElement>('rotate-snap').addEventListener('change', () => {
      const typed = this.rotateAngle();
      const step = this.rotateSnapStep(false);
      if (typed === null || step <= 0) return;
      this.setRotateAngleField(snapRotation(typed, step));
      this.syncRotatePreview();
    });
  }

  /** True while the Rotate dialog is up. */
  private get rotateDialogOpen(): boolean {
    return !el('rotate-dialog').classList.contains('is-hidden');
  }

  /**
   * Opens the Rotate dialog for the current selection, with the centre at the
   * middle of its bounding box - the pivot a rotation is expected to have
   * before anyone says otherwise.
   */
  private openRotateDialog(quick = false): void {
    // A second press is not a request to start over: the panel is already up,
    // with an angle and a centre in it that were put there on purpose.
    if (this.rotateDialogOpen) return;
    if (this.animationMode) {
      this.toast('Rotate is not available in Animation Mode.');
      return;
    }
    if (this.otherDialogOpen('rotate-dialog')) return;
    const targets = this.propertyTargets();
    const box = this.selectionBounds();
    if (targets.length === 0 || !box) {
      this.toast('Select something to rotate first.');
      return;
    }
    this.rotateBox = box;
    this.rotateAnchorKey = 'mc';
    this.rotateCenter = this.rotateAnchorPoint('mc', box);
    this.rotateAcceptOnRelease = quick;
    // The panel says which of the two it is, since the difference only shows
    // up at the end of a drag - by which point it is too late to wonder.
    el('rotate-msg').textContent =
      `Rotate ${targets.length} selected element${targets.length === 1 ? '' : 's'} around a centre point.` +
      (quick ? ' Let go of a drag to accept it and close.' : '');

    const angle = el<HTMLInputElement>('rotate-angle');
    angle.value = '0';
    el<HTMLSelectElement>('rotate-cx-unit').value = this.propUnits.x;
    el<HTMLSelectElement>('rotate-cy-unit').value = this.propUnits.y;
    this.rotateUnits = { x: this.propUnits.x, y: this.propUnits.y };
    this.writeRotateCenterFields();
    this.syncRotateAnchorButtons();
    this.syncRotateDirection();

    el('rotate-dialog').classList.remove('is-hidden');
    this.parkRotateDialog();
    // A panel left near an edge last time must not open off screen if the
    // window has shrunk since.
    this.clampRotateDialog();
    this.updateCursor();
    this.scheduleRender();
    angle.focus();
    angle.select();
  }

  /**
   * Puts the panel in the top-right corner the first time it opens.
   *
   * Every other dialog in the app is centred, and this is the one that cannot
   * be: the canvas under the selection is where a rotation is actually
   * dragged, and a panel sitting in the middle of the screen is sitting on
   * exactly the pixels the gesture needs. Only the first opening is placed -
   * a palette that has been dragged somewhere deliberately stays there.
   */
  private parkRotateDialog(): void {
    // Docked, it is already out of the way, and the dock decides where it sits.
    if (this.popups.isPlaced('rotate-dialog') || this.popups.isDocked('rotate-dialog')) return;
    const panel = el('rotate-dialog').querySelector<HTMLElement>('.export-dialog-inner');
    if (!panel) return;
    const margin = 24;
    this.popups.park('rotate-dialog', window.innerWidth - panel.offsetWidth - margin, 72);
  }

  /** Pulls the Rotate panel back on screen, after a resize or before opening. */
  private clampRotateDialog(): void {
    this.popups.clamp('rotate-dialog');
  }

  /** Closes the dialog, dropping any live preview when the rotation was abandoned. */
  private closeRotateDialog(revert: boolean): void {
    if (revert) this.revertRotatePreview();
    else this.rotatePreview = null;
    this.rotateDrag = null;
    this.rotateCenterDrag = null;
    this.rotateRay = null;
    this.rotateOverCenter = false;
    this.rotateCenter = null;
    this.rotateBox = null;
    this.rotateAcceptOnRelease = false;
    // A drag still in hand when the dialog went - entering Animation Mode,
    // say - would otherwise leave the grab cursor stuck on the panel.
    this.popups.releaseGrabs('rotate-dialog');
    el('rotate-dialog').classList.add('is-hidden');
    this.updateCursor();
    this.scheduleRender();
  }

  /** The typed angle in degrees, or null when the field is not a number. */
  private rotateAngle(): number | null {
    const raw = Number(el<HTMLInputElement>('rotate-angle').value);
    return Number.isFinite(raw) ? raw : null;
  }

  /** Writes an angle back into the field, trimming the float noise a drag leaves. */
  private setRotateAngleField(degrees: number): void {
    el<HTMLInputElement>('rotate-angle').value = String(
      Number(normalizeRotation(degrees).toFixed(2)),
    );
    this.syncRotateDirection();
  }

  /**
   * The step a constrained rotation lands on, or 0 for none. The checkbox
   * arms it for typing and dragging alike; Shift arms it for one gesture, the
   * way it constrains a drag everywhere else in the app.
   */
  private rotateSnapStep(shift: boolean): number {
    return el<HTMLInputElement>('rotate-snap').checked || shift ? ROTATE_SNAP_DEGREES : 0;
  }

  /**
   * Points the typed angle the given way round, keeping its magnitude: the
   * direction buttons re-sign what is in the field rather than replacing it,
   * so pressing CCW on a typed 90 gives -90 and not a cleared field.
   */
  private setRotateDirection(sign: 1 | -1): void {
    const typed = this.rotateAngle() ?? 0;
    this.setRotateAngleField(Math.abs(typed) * sign);
    this.syncRotatePreview();
  }

  /** Lights whichever way the typed angle turns; neither, at rest. */
  private syncRotateDirection(): void {
    const typed = normalizeRotation(this.rotateAngle() ?? 0);
    el('rotate-cw').classList.toggle('is-active', typed > 0);
    el('rotate-ccw').classList.toggle('is-active', typed < 0);
  }

  /**
   * Arrow keys step the angle by a degree, and Shift takes the 15 degree step
   * a snapped drag lands on. Enter rotates and leaves the dialog open, so the
   * same quarter turn can be pressed again from where the selection now is;
   * Escape closes.
   */
  private onRotateAngleKey(ev: KeyboardEvent, input: HTMLInputElement): void {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const step = ev.shiftKey ? ROTATE_SNAP_DEGREES : 1;
      const current = Number(input.value);
      const next = (Number.isFinite(current) ? current : 0) + (ev.key === 'ArrowUp' ? step : -step);
      this.setRotateAngleField(next);
      this.syncRotatePreview();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.applyRotate();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.closeRotateDialog(true);
    }
  }

  /** Arrow keys step a centre field by its own unit, as the Move fields do. */
  private onRotateCenterKey(ev: KeyboardEvent, input: HTMLInputElement): void {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const unitId = input.id === 'rotate-cx' ? 'rotate-cx-unit' : 'rotate-cy-unit';
      const unit = el<HTMLSelectElement>(unitId).value;
      const step = isLengthUnit(unit) ? nudgeStep(unit, ev.shiftKey) : ev.shiftKey ? 10 : 1;
      const current = Number(input.value);
      const next = (Number.isFinite(current) ? current : 0) + (ev.key === 'ArrowUp' ? step : -step);
      // Trim the float noise a step of 0.125 or 3.175 leaves behind.
      input.value = String(Number(next.toFixed(4)));
      this.readRotateCenterFields();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.applyRotate();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.closeRotateDialog(true);
    }
  }

  /**
   * Rewrites a centre field in its new unit when the unit picker changes, so
   * the centre stays exactly where it is and only the way it is written
   * changes - the same rule the Move dialog's distances follow.
   */
  private changeRotateUnit(axis: 'x' | 'y'): void {
    const select = el<HTMLSelectElement>(axis === 'x' ? 'rotate-cx-unit' : 'rotate-cy-unit');
    const next = select.value;
    if (isLengthUnit(next)) this.rotateUnits[axis] = next;
    this.writeRotateCenterFields();
  }

  /** Shows the centre in each field's own unit, with a matching spinner step. */
  private writeRotateCenterFields(): void {
    const center = this.rotateCenter;
    if (!center) return;
    el<HTMLInputElement>('rotate-cx').value = formatLength(center.x, this.rotateUnits.x);
    el<HTMLInputElement>('rotate-cy').value = formatLength(center.y, this.rotateUnits.y);
    for (const [id, unitId] of [
      ['rotate-cx', 'rotate-cx-unit'],
      ['rotate-cy', 'rotate-cy-unit'],
    ]) {
      const unit = el<HTMLSelectElement>(unitId).value;
      el<HTMLInputElement>(id).step = String(isLengthUnit(unit) ? nudgeStep(unit, false) : 1);
    }
  }

  /** Takes a typed centre, which is one of the three ways the pivot moves. */
  private readRotateCenterFields(): void {
    const x = Number(el<HTMLInputElement>('rotate-cx').value);
    const y = Number(el<HTMLInputElement>('rotate-cy').value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.moveRotateCenter(
      { x: toPx(x, this.rotateUnits.x), y: toPx(y, this.rotateUnits.y), pressure: 0.5 },
      null,
      false,
    );
  }

  /** Where a preset centre sits on the selection's box. */
  private rotateAnchorPoint(
    key: RotateAnchor,
    box: { minX: number; minY: number; maxX: number; maxY: number },
  ): Point {
    const midX = (box.minX + box.maxX) / 2;
    const midY = (box.minY + box.maxY) / 2;
    const x = key[1] === 'l' ? box.minX : key[1] === 'r' ? box.maxX : midX;
    const y = key[0] === 't' ? box.minY : key[0] === 'b' ? box.maxY : midY;
    return { x, y, pressure: 0.5 };
  }

  /** Puts the centre on one of the nine handles of the selection's box. */
  private setRotateAnchor(key: RotateAnchor): void {
    const box = this.rotateBox;
    if (!box) return;
    this.moveRotateCenter(this.rotateAnchorPoint(key, box), key, true);
  }

  /**
   * Puts the centre somewhere - typed, picked from the grid, or dragged on
   * the canvas - and keeps everything that reads it in step.
   *
   * A preview already on screen was made about the old centre, so it comes
   * off and is re-made about the new one rather than left turning about a
   * point that has moved out from under it.
   */
  private moveRotateCenter(to: Point, anchor: RotateAnchor | null, writeFields: boolean): void {
    this.rotateAnchorKey = anchor;
    this.rotateCenter = { x: to.x, y: to.y, pressure: 0.5 };
    if (writeFields) this.writeRotateCenterFields();
    this.syncRotateAnchorButtons();
    this.syncRotatePreview();
    this.scheduleRender();
  }

  /** Lights the preset the centre is sitting on; none, once it is custom. */
  private syncRotateAnchorButtons(): void {
    const grid = '#rotate-anchor-grid .rotate-anchor';
    for (const button of document.querySelectorAll<HTMLElement>(grid)) {
      button.classList.toggle('is-active', button.dataset.anchor === this.rotateAnchorKey);
    }
  }

  /**
   * Shows the rotation on the canvas while it is being set.
   *
   * As with the Move dialog the preview is the real rotation made and unmade,
   * none of it taking a history step, and the difference between what is
   * showing and what is now wanted is what gets applied. A drag previews
   * whatever the checkbox says: a gesture that turned nothing until it was
   * released would be no gesture at all.
   */
  private syncRotatePreview(): void {
    const center = this.rotateCenter;
    const dragging = this.rotateDrag !== null;
    const wanted =
      this.rotateDialogOpen &&
      center &&
      (dragging || el<HTMLInputElement>('rotate-preview').checked)
        ? this.rotateAngle()
        : null;
    if (wanted === null || !center) {
      this.revertRotatePreview();
      return;
    }
    // A centre that has moved invalidates what is showing outright: the
    // rotation on screen was made about the old point and cannot be adjusted
    // into one about the new one.
    const showing = this.rotatePreview;
    if (showing && (showing.cx !== center.x || showing.cy !== center.y)) {
      this.revertRotatePreview();
    }
    const current = this.rotatePreview;
    const ids = current ? current.ids : this.propertyTargets();
    if (ids.length === 0) return;
    const delta = wanted - (current?.degrees ?? 0);
    if (delta !== 0) this.store.rotateStrokes(ids, delta, center.x, center.y, false);
    this.rotatePreview = { ids, degrees: wanted, cx: center.x, cy: center.y };
  }

  /** Takes a live preview back off the canvas, leaving no history behind. */
  private revertRotatePreview(): void {
    const showing = this.rotatePreview;
    this.rotatePreview = null;
    if (!showing) return;
    this.store.rotateStrokes(showing.ids, -showing.degrees, showing.cx, showing.cy, false);
  }

  /**
   * Applies the angle from wherever the selection is now.
   *
   * The dialog stays open and the angle stays typed, so Enter can be pressed
   * again to turn the same amount again - each press measured from where the
   * selection has landed. The box the preset centres are measured on is
   * re-taken afterwards, because a shape that has turned no longer has the
   * box it was drawn in.
   */
  private applyRotate(): void {
    const targets = this.propertyTargets();
    if (targets.length === 0) {
      this.closeRotateDialog(true);
      return;
    }
    const center = this.rotateCenter;
    const degrees = this.rotateAngle();
    if (!center || degrees === null) {
      this.toast('Type a number of degrees.');
      return;
    }
    // The preview comes off first so the committed rotation is one history
    // step covering the whole angle, not a second one stacked on a shown turn.
    this.revertRotatePreview();
    if (degrees % 360 === 0) return;
    this.store.rotateStrokes(targets, degrees, center.x, center.y);
    this.toast(
      `Rotated ${targets.length} element${targets.length === 1 ? '' : 's'} ` +
        this.rotationWording(degrees),
    );
    // The preset grid measures the shape as it now stands; the centre itself
    // stays put, since a pivot is a place on the page and not on the shape.
    this.rotateBox = this.selectionBounds();
    this.syncRotateAnchorButtons();
    this.syncRotatePreview();
    this.scheduleRender();
  }

  /** "90° clockwise" / "45° counterclockwise", for a toast to finish. */
  private rotationWording(degrees: number): string {
    const turned = normalizeRotation(degrees);
    const size = Math.abs(Number(turned.toFixed(2)));
    return `${size}° ${turned < 0 ? 'counterclockwise' : 'clockwise'}.`;
  }

  // ---- Rotate: canvas drag -------------------------------------------------

  /** The pointer's bearing from the centre, in the clockwise degrees the field holds. */
  private rotateBearing(pt: Point): number {
    const center = this.rotateCenter;
    if (!center) return 0;
    // The canvas y axis grows downward, so atan2 already counts clockwise.
    return (Math.atan2(pt.y - center.y, pt.x - center.x) * 180) / Math.PI;
  }

  /** True when a point is within grabbing distance of the centre marker. */
  private nearRotateCenter(pt: Point): boolean {
    const center = this.rotateCenter;
    if (!center) return false;
    // The marker is drawn at a constant on-screen size, so its grab radius is
    // a screen distance too and has to be taken back into sketch units.
    const reach = ROTATE_CENTER_GRAB / this.surface.getViewport().zoom;
    return Math.hypot(pt.x - center.x, pt.y - center.y) <= reach;
  }

  /**
   * Starts a rotate gesture on the canvas, and reports whether it took the
   * press. A press on the centre marker picks the pivot up; a press anywhere
   * else takes hold of the selection and turns it.
   */
  private beginRotateDrag(e: PointerEvent, pt: Point): boolean {
    if (!this.rotateCenter || this.activePointerId !== null) return false;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointerId = e.pointerId;

    if (this.nearRotateCenter(pt)) {
      this.rotateCenterDrag = e.pointerId;
      this.updateCursor();
      this.scheduleRender();
      return true;
    }

    // A drag continues from what the canvas is already showing: a previewed
    // angle is carried on from, while an angle typed with the preview off has
    // turned nothing yet, so the gesture starts at zero.
    const base = this.rotatePreview ? this.rotatePreview.degrees : 0;
    this.setRotateAngleField(base);
    this.rotateDrag = { pointerId: e.pointerId, bearing: this.rotateBearing(pt), turned: 0, base };
    this.rotateRay = pt;
    this.updateCursor();
    this.scheduleRender();
    return true;
  }

  /**
   * Carries a rotate gesture along, and reports whether it took the move.
   *
   * The pointer's bearing is sampled each frame and the shortest way round
   * from the last one added to a running total, so the gesture crosses the
   * seam at half a turn without flipping sign, and a second lap counts as a
   * second lap rather than undoing the first.
   */
  private onRotatePointerMove(e: PointerEvent, pt: Point): boolean {
    if (!this.rotateCenter) return false;

    if (this.rotateCenterDrag === e.pointerId) {
      this.moveRotateCenter(pt, null, true);
      return true;
    }

    const drag = this.rotateDrag;
    if (drag && drag.pointerId === e.pointerId) {
      const bearing = this.rotateBearing(pt);
      drag.turned += rotationStep(drag.bearing, bearing);
      drag.bearing = bearing;
      const step = this.rotateSnapStep(e.shiftKey);
      const angle = drag.base + drag.turned;
      this.setRotateAngleField(step > 0 ? snapRotation(angle, step) : angle);
      this.rotateRay = pt;
      this.syncRotatePreview();
      this.scheduleRender();
      return true;
    }

    // Not dragging: the pointer still has to say whether the marker under it
    // can be picked up, which is the only cue that the pivot is movable.
    const over = this.nearRotateCenter(pt);
    if (over !== this.rotateOverCenter) {
      this.rotateOverCenter = over;
      this.updateCursor();
      this.scheduleRender();
    }
    return false;
  }

  /**
   * Ends a rotate gesture, and reports whether it took the release. What the
   * drag turned is committed as a single history step and the field goes back
   * to zero: the rotation is in the drawing now, so the panel is back to
   * offering the next one.
   */
  private endRotateDrag(e: PointerEvent): boolean {
    if (this.rotateCenterDrag === e.pointerId) {
      this.rotateCenterDrag = null;
      this.activePointerId = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.updateCursor();
      this.scheduleRender();
      return true;
    }

    const drag = this.rotateDrag;
    if (!drag || drag.pointerId !== e.pointerId) return false;
    const angle = this.rotateAngle() ?? 0;
    const targets = this.propertyTargets();
    this.rotateDrag = null;
    this.rotateRay = null;
    this.activePointerId = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    // Undo the shown turn and make it once for real, so the whole gesture is
    // one undo step rather than one per pointer event.
    this.revertRotatePreview();
    const center = this.rotateCenter;
    const turned = center !== null && targets.length > 0 && angle % 360 !== 0;
    if (turned && center) {
      this.store.rotateStrokes(targets, angle, center.x, center.y);
      this.toast(`Rotated ${this.rotationWording(angle)}`);
      this.rotateBox = this.selectionBounds();
      this.syncRotateAnchorButtons();
    }
    this.setRotateAngleField(0);
    this.syncRotatePreview();
    // Opened with Ctrl+R, the release is the end of the gesture: the rotation
    // is already in the drawing, so the palette has nothing left to say. A
    // press that turned nothing is not a gesture, though, and dismissing on a
    // stray click would be a worse surprise than staying up.
    if (this.rotateAcceptOnRelease && turned) {
      this.closeRotateDialog(false);
      return true;
    }
    this.updateCursor();
    this.scheduleRender();
    return true;
  }

  /** The pivot marker and its lever, for the canvas overlay. */
  private rotateOverlay(): { center: Point; ray?: Point; moving?: boolean } | null {
    const center = this.rotateCenter;
    if (!this.rotateDialogOpen || !center) return null;
    const holding = this.rotateCenterDrag !== null || this.rotateOverCenter;
    return {
      center,
      ...(this.rotateRay ? { ray: this.rotateRay } : {}),
      ...(holding ? { moving: true } : {}),
    };
  }
  /** Union of the selected elements' bounds, or null when nothing is selected. */
  private selectionBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (const stroke of this.propertyStrokes()) {
      const b = strokeBounds(stroke, (t) => this.surface.measureText(t));
      if (!b) continue;
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : { ...b };
    }
    return box;
  }

  /** Moves the selection so its bounding box starts at the typed coordinate. */
  private commitPosition(axis: 'x' | 'y'): void {
    const input = el<HTMLInputElement>(axis === 'x' ? 'prop-x' : 'prop-y');
    const box = this.selectionBounds();
    const targets = this.propertyTargets();
    const value = Number(input.value);
    if (!box || targets.length === 0 || !Number.isFinite(value)) {
      this.renderProperties();
      return;
    }
    const px = toPx(value, axis === 'x' ? this.propUnits.x : this.propUnits.y);
    this.store.moveStrokes(
      targets,
      axis === 'x' ? px - box.minX : 0,
      axis === 'y' ? px - box.minY : 0,
    );
  }

  /**
   * Resizes the selection from a Scale field. A percentage is a factor
   * outright; a length is read as the size the selection should end up, so
   * the factor is that size over the current one. The scale is anchored at
   * the selection's top-left corner, which keeps the Position fields above
   * steady while the size changes.
   */
  private commitScale(axis: 'x' | 'y'): void {
    const input = el<HTMLInputElement>(axis === 'x' ? 'prop-scale-x' : 'prop-scale-y');
    const box = this.selectionBounds();
    const targets = this.propertyTargets();
    const value = Number(input.value);
    if (!box || targets.length === 0 || !Number.isFinite(value) || value <= 0) {
      this.renderProperties();
      return;
    }
    const unit = axis === 'x' ? this.propUnits.scaleX : this.propUnits.scaleY;
    const current = Math.max(0.01, axis === 'x' ? box.maxX - box.minX : box.maxY - box.minY);
    const raw = unit === '%' ? value / 100 : toPx(value, unit) / current;
    if (!Number.isFinite(raw) || raw <= 0) {
      this.renderProperties();
      return;
    }
    // A stray keystroke in a percentage field can ask for a factor that would
    // throw the geometry clean off the page; clamp it and say so.
    const factor = Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, raw));
    if (factor !== raw) this.toast('Scaling is limited to 1% - 10000%.');
    const uniform = el<HTMLInputElement>('prop-scale-uniform').checked;
    this.store.scaleStrokes(
      targets,
      uniform || axis === 'x' ? factor : 1,
      uniform || axis === 'y' ? factor : 1,
      box.minX,
      box.minY,
    );
    this.renderProperties();
  }

  /**
   * Applies a flat color to the selection: shapes take it as their fill (and
   * drop any gradient), text items as their ink, since a text item has no
   * separate interior to fill. Images are left alone.
   */
  private applyPropertyFill(color: string, history: boolean): void {
    const strokes = this.propertyStrokes();
    const shapes = strokes.filter((s) => !isTextStroke(s) && !isImageStroke(s)).map((s) => s.id);
    const texts = strokes.filter((s) => isTextStroke(s)).map((s) => s.id);
    let push = history;
    if (shapes.length > 0) {
      this.store.setStrokeProps(shapes, { fill: color, gradient: undefined }, push);
      push = false;
    }
    if (texts.length > 0) this.store.setStrokeProps(texts, { color }, push);
  }

  // ---- Gradient editor -----------------------------------------------------

  /** The gradient the editor is pointed at (the first selected element's). */
  private currentGradient(): Gradient | null {
    return this.propertyShapes()[0]?.gradient ?? null;
  }

  /** Writes a gradient to every selected shape, keeping their flat fills. */
  private applyGradient(next: Gradient, history = true): void {
    const shapes = this.propertyShapes().map((s) => s.id);
    if (shapes.length > 0) this.store.setStrokeProps(shapes, { gradient: next }, history);
  }

  /** Starts (or re-opens) a gradient fill on the selection. */
  private startGradient(): void {
    const strokes = this.propertyShapes();
    if (strokes.length === 0) return;
    if (this.currentGradient()) {
      // Already gradient-filled: just make sure the editor is showing.
      el('gradient-editor').classList.remove('is-hidden');
      return;
    }
    const first = strokes[0];
    this.gradientStop = 0;
    this.applyGradient(createGradient(first.fill ?? first.color));
    this.renderProperties();
  }

  /** Wires the gradient ramp, its stop fields, and the geometry controls. */
  private bindGradientEditor(): void {
    const bar = el('gradient-bar');
    // Double-clicking the ramp drops a new stop where it was clicked - the
    // gesture every gradient editor uses.
    bar.addEventListener('dblclick', (e) => {
      // Double-clicking a stop handle opens the color picker for that stop -
      // the gesture gradient editors share; the empty ramp adds a stop.
      const handle =
        e.target instanceof Element ? e.target.closest<HTMLElement>('.gradient-stop-handle') : null;
      if (handle) {
        e.preventDefault();
        this.gradientStop = Number(handle.dataset.index ?? 0);
        this.renderProperties();
        el<HTMLInputElement>('gradient-stop-color').click();
        return;
      }
      if (!this.currentGradient()) return;
      e.preventDefault();
      this.addGradientStop(this.gradientOffsetAt(e.clientX));
    });

    const color = el<HTMLInputElement>('gradient-stop-color');
    color.addEventListener('input', () => {
      this.updateGradientStop(this.gradientStop, { color: color.value }, !this.fillDragging);
      this.fillDragging = true;
    });
    color.addEventListener('change', () => {
      this.fillDragging = false;
    });

    const offset = el<HTMLInputElement>('gradient-stop-offset');
    offset.addEventListener('change', () => {
      const value = Number(offset.value);
      if (!Number.isFinite(value)) {
        this.renderProperties();
        return;
      }
      this.updateGradientStop(this.gradientStop, { offset: Math.min(1, Math.max(0, value / 100)) });
    });

    el('gradient-add-stop').addEventListener('click', () => {
      const gradient = this.currentGradient();
      if (!gradient) return;
      // A new stop lands midway between the selected one and its neighbour,
      // which is where a user reaching for "+" almost always wants it.
      const here = gradient.stops[this.gradientStop]?.offset ?? 0;
      const after = gradient.stops
        .map((stop) => stop.offset)
        .filter((o) => o > here)
        .sort((a, b) => a - b)[0];
      this.addGradientStop(after === undefined ? Math.min(1, here + 0.25) : (here + after) / 2);
    });

    el('gradient-remove-stop').addEventListener('click', () => {
      const gradient = this.currentGradient();
      if (!gradient) return;
      if (gradient.stops.length <= 2) {
        this.toast('A gradient needs at least two stops.');
        return;
      }
      const stops = gradient.stops.filter((_, i) => i !== this.gradientStop);
      this.gradientStop = Math.max(0, Math.min(this.gradientStop, stops.length - 1));
      this.applyGradient({ ...gradient, stops });
      this.renderProperties();
    });

    const type = el<HTMLSelectElement>('gradient-type');
    type.addEventListener('change', () => {
      const gradient = this.currentGradient();
      if (!gradient) return;
      this.applyGradient({ ...gradient, type: type.value === 'radial' ? 'radial' : 'linear' });
      this.renderProperties();
    });

    const angle = el<HTMLInputElement>('gradient-angle');
    angle.addEventListener('input', () => {
      const gradient = this.currentGradient();
      if (!gradient) return;
      this.applyGradient({ ...gradient, angle: Number(angle.value) }, !this.gradientDragging);
      this.gradientDragging = true;
      el('gradient-angle-value').textContent = angle.value + '°';
      this.refreshGradientRamp();
    });
    angle.addEventListener('change', () => {
      this.gradientDragging = false;
    });

    el('gradient-remove').addEventListener('click', () => {
      const targets = this.propertyTargets();
      if (targets.length === 0) return;
      // The flat fill was kept alongside the gradient, so it comes back.
      this.store.setStrokeProps(targets, { gradient: undefined });
      this.toast('Removed the gradient.');
    });
  }

  /** Applies a Close Shape join to the selection and reports the result. */
  private closeSelectedShapes(mode: 'sharp' | 'smooth'): void {
    const closed = this.store.closeSelectedStrokes(mode);
    this.toast(
      closed > 0
        ? `Closed ${closed} shape${closed === 1 ? '' : 's'} (${mode}).`
        : 'Select an open stroke to close its end points.',
    );
  }

  /** Position (0-1) along the gradient ramp for a client X coordinate. */
  private gradientOffsetAt(clientX: number): number {
    const rect = el('gradient-bar').getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  }

  /** Inserts a stop at `offset`, colored to match the ramp already there. */
  private addGradientStop(offset: number): void {
    const gradient = this.currentGradient();
    if (!gradient) return;
    const stops = [...gradient.stops, { offset, color: sampleGradient(gradient, offset) }];
    this.gradientStop = stops.length - 1;
    this.applyGradient({ ...gradient, stops });
    this.renderProperties();
  }

  /** Patches one stop of the current gradient in place. */
  private updateGradientStop(index: number, patch: Partial<GradientStop>, history = true): void {
    const gradient = this.currentGradient();
    if (!gradient || !gradient.stops[index]) return;
    const stops = gradient.stops.map((stop, i) =>
      i === index ? { ...stop, ...patch } : { ...stop },
    );
    this.applyGradient({ ...gradient, stops }, history);
  }

  /**
   * Drags one stop along the ramp. The bar is not rebuilt during the drag -
   * that would destroy the handle holding the pointer capture - so the handle
   * and the ramp preview are moved directly instead.
   */
  private beginGradientStopDrag(event: PointerEvent, handle: HTMLElement, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.gradientStop = index;
    // The selected-handle highlight is moved by hand rather than by a
    // re-render: rebuilding the bar here would replace the very handle about
    // to take the pointer capture, and the drag would never start.
    this.gradientDragging = true;
    for (const node of Array.from(
      el('gradient-bar').querySelectorAll<HTMLElement>('.gradient-stop-handle'),
    )) {
      node.classList.toggle('is-active', node === handle);
    }
    handle.setPointerCapture(event.pointerId);
    let first = true;
    const move = (ev: PointerEvent): void => {
      const offset = this.gradientOffsetAt(ev.clientX);
      this.updateGradientStop(index, { offset }, first);
      first = false;
      handle.style.left = offset * 100 + '%';
      this.refreshGradientRamp();
      const percent = el<HTMLInputElement>('gradient-stop-offset');
      if (document.activeElement !== percent) percent.value = String(Math.round(offset * 100));
    };
    const up = (): void => {
      this.gradientDragging = false;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.renderProperties();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  /** Repaints just the ramp preview (used mid-drag, when the bar must stand). */
  private refreshGradientRamp(): void {
    const gradient = this.currentGradient();
    const ramp = el('gradient-bar').querySelector<HTMLElement>('.gradient-bar-ramp');
    if (gradient && ramp) ramp.style.background = cssGradient(gradient);
  }

  // ---- Properties panel rendering ------------------------------------------

  /** Refreshes every field in the properties panel from the selection. */
  private renderProperties(): void {
    if (!this.propertiesOpen) return;
    const strokes = this.propertyStrokes();
    const box = this.selectionBounds();

    el('prop-summary').textContent = describeSelection(strokes, this.store.sketch);
    el('prop-fields').classList.toggle('is-empty', strokes.length === 0 || box === null);
    if (strokes.length === 0 || !box) {
      el('gradient-editor').classList.add('is-hidden');
      return;
    }

    // Position and scale.
    setFieldValue('prop-x', formatLength(box.minX, this.propUnits.x));
    setFieldValue('prop-y', formatLength(box.minY, this.propUnits.y));
    el<HTMLInputElement>('prop-x').step = String(unitStep(this.propUnits.x));
    el<HTMLInputElement>('prop-y').step = String(unitStep(this.propUnits.y));

    const width = Math.max(0, box.maxX - box.minX);
    const height = Math.max(0, box.maxY - box.minY);
    // A percentage field always reads 100: it is the factor to apply next,
    // not a size. A length field reads the size the selection is now.
    setFieldValue(
      'prop-scale-x',
      this.propUnits.scaleX === '%' ? '100' : formatLength(width, this.propUnits.scaleX),
    );
    setFieldValue(
      'prop-scale-y',
      this.propUnits.scaleY === '%' ? '100' : formatLength(height, this.propUnits.scaleY),
    );
    el<HTMLInputElement>('prop-scale-x').step =
      this.propUnits.scaleX === '%' ? '1' : String(unitStep(this.propUnits.scaleX));
    el<HTMLInputElement>('prop-scale-y').step =
      this.propUnits.scaleY === '%' ? '1' : String(unitStep(this.propUnits.scaleY));

    // Appearance. A placed image carries no paint of its own, and a text item
    // has ink but no outline, so each control is switched off for the kinds
    // it cannot act on. The fields read the first element they apply to.
    const paintable = strokes.filter((s) => !isImageStroke(s));
    const shapes = this.propertyShapes();
    const fillFirst = paintable[0];
    const fillSource = fillFirst
      ? isTextStroke(fillFirst)
        ? fillFirst.color
        : fillFirst.fill ?? fillFirst.color
      : '#1f2328';
    setFieldValue('prop-fill', toHexColor(fillSource) ?? '#1f2328');
    el<HTMLInputElement>('prop-fill').disabled = paintable.length === 0;
    el<HTMLButtonElement>('prop-fill-remove').disabled = paintable.length === 0;
    // Only a shape has an interior a gradient can run across.
    el<HTMLButtonElement>('prop-fill-gradient').disabled = shapes.length === 0;

    const outlineFirst = shapes[0];
    setFieldValue(
      'prop-stroke-width',
      outlineFirst ? String(Math.round(outlineFirst.width * 10) / 10) : '',
    );
    el<HTMLInputElement>('prop-stroke-width').disabled = shapes.length === 0;
    const styleSelect = el<HTMLSelectElement>('prop-stroke-style');
    if (document.activeElement !== styleSelect) {
      styleSelect.value = outlineFirst?.strokeStyle ?? 'solid';
    }
    styleSelect.disabled = shapes.length === 0;
    const removeStroke = el<HTMLButtonElement>('prop-stroke-remove');
    const allOff = shapes.length > 0 && shapes.every((s) => s.noStroke === true);
    removeStroke.textContent = allOff ? 'Add stroke' : 'No stroke';
    removeStroke.disabled = shapes.length === 0;

    this.renderGradientEditor();
  }

  /** Rebuilds the gradient ramp, its handles, and the stop fields. */
  private renderGradientEditor(): void {
    const editor = el('gradient-editor');
    const gradient = this.currentGradient();
    editor.classList.toggle('is-hidden', gradient === null);
    if (!gradient) return;
    // Mid-drag the bar must stand: rebuilding it would destroy the handle
    // holding the pointer capture.
    if (this.gradientDragging) {
      this.refreshGradientRamp();
      return;
    }
    editor.classList.toggle('is-radial', gradient.type === 'radial');
    this.gradientStop = Math.max(0, Math.min(this.gradientStop, gradient.stops.length - 1));

    const bar = el('gradient-bar');
    bar.textContent = '';
    const ramp = document.createElement('div');
    ramp.className = 'gradient-bar-ramp';
    ramp.style.background = cssGradient(gradient);
    bar.appendChild(ramp);

    gradient.stops.forEach((stop, index) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'gradient-stop-handle';
      handle.classList.toggle('is-active', index === this.gradientStop);
      handle.style.left = Math.min(1, Math.max(0, stop.offset)) * 100 + '%';
      handle.style.background = stop.color;
      const percent = Math.round(stop.offset * 100);
      handle.dataset.index = String(index);
      handle.title = 'Stop ' + (index + 1) + ' at ' + percent + '% - drag to move, double-click to recolor';
      handle.setAttribute('aria-label', 'Gradient stop ' + (index + 1) + ' at ' + percent + ' percent');
      handle.addEventListener('pointerdown', (ev) => this.beginGradientStopDrag(ev, handle, index));
      bar.appendChild(handle);
    });

    const active = gradient.stops[this.gradientStop];
    if (active) {
      setFieldValue('gradient-stop-color', toHexColor(active.color) ?? '#000000');
      setFieldValue('gradient-stop-offset', String(Math.round(active.offset * 100)));
    }
    const type = el<HTMLSelectElement>('gradient-type');
    if (document.activeElement !== type) type.value = gradient.type;
    setFieldValue('gradient-angle', String(Math.round(gradient.angle ?? 0)));
    el('gradient-angle-value').textContent = Math.round(gradient.angle ?? 0) + '°';
    el<HTMLButtonElement>('gradient-remove-stop').disabled = gradient.stops.length <= 2;
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

      // Reload throws the sketch away without asking, and Chromium still
      // handles both of these keys on its own however the menu is built - so
      // they are swallowed here, ahead of the text-field guard below. Inside
      // a field is exactly where the old ordering let one through, and a
      // reload triggered by a stray Ctrl+R while renaming a layer would take
      // the whole drawing with it.
      //
      // Ctrl+R then has a job rather than only a refusal: it opens Rotate for
      // the selection, the way Enter opens Move. F5 keeps the explanation,
      // since nothing else has ever wanted that key.
      const rotateKey = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
      if (rotateKey || e.key === 'F5') {
        e.preventDefault();
        if (e.key === 'F5') {
          this.toast(
            this.store.dirty
              ? 'Reload is off here - it would discard unsaved changes. Save with Ctrl+S.'
              : 'Reload is off here - it would discard the sketch.',
          );
        } else if (!isTextEntry(document.activeElement)) {
          this.openRotateDialog(true);
        }
        return;
      }

      // A focused text field owns its keys: the tool shortcuts, Delete, and
      // the document's own undo must not fire while a name, a coordinate, or
      // a scale is being typed. Sliders, checkboxes, and color wells consume
      // no letters, so they keep the shortcuts working.
      if (isTextEntry(document.activeElement)) return;

      // Track Ctrl while a vector edit is open: holding it reveals the
      // corner-rounding target and switches the pointer to the Select arrow.
      if (e.key === 'Control' && !this.ctrlDown) {
        this.ctrlDown = true;
        if (this.vectorEditId) {
          this.updateVectorEditCursor();
          this.scheduleRender();
        }
      }

      // Alt is tracked for every tool: the Vector Path tool shows the stemless
      // arrowhead while it is held (and needs the keypress kept from the
      // native menu bar, which would steal focus and put the edited path down
      // mid-gesture), and the Select tool shows the copy arrows.
      if (e.key === 'Alt') {
        if (this.store.tool.tool === 'vector') e.preventDefault();
        if (!this.altDown) {
          this.altDown = true;
          if (this.vectorEditId) this.updateVectorEditCursor();
          else this.updateCursor();
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

      // Rotate: Escape closes and Enter applies, from wherever the focus is.
      // The dialog's own fields handle both too, but a canvas drag takes the
      // focus off them, and that is the moment these keys are most wanted.
      // They come before Move's Enter, which stands down while another dialog
      // is open anyway.
      if (this.rotateDialogOpen && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        if (e.key === 'Escape') this.closeRotateDialog(true);
        else this.applyRotate();
        return;
      }

      // Enter opens the Move dialog for whatever is selected. It comes after
      // the Vector Path commit so an open path still finishes on Enter, and
      // the dialog's own fields are text entry, which returned above.
      if (e.key === 'Enter' && this.canOpenMoveDialog()) {
        e.preventDefault();
        this.openMoveDialog();
        return;
      }
      if (e.key === 'Escape' && this.moveDialogOpen) {
        e.preventDefault();
        this.closeMoveDialog(true);
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

      // F2 renames the active layer - the same inline edit a double-click on
      // its row opens. The rename input stops its own keys short of this
      // handler, so a second press cannot restart an edit mid-flight.
      if (e.key === 'F2') {
        e.preventDefault();
        this.renameActiveLayer();
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
      } else if (mod && key === 'c') {
        e.preventDefault();
        this.copySelectionWithToast();
      } else if (mod && key === 'x') {
        e.preventDefault();
        this.cutSelection();
      } else if (mod && key === 'v') {
        // Shift pastes back at the copied coordinates instead of at the
        // pointer - how a graphic moves between pages without drifting.
        e.preventDefault();
        void this.pasteClipboard(e.shiftKey);
      } else if (mod && key === 'd') {
        e.preventDefault();
        this.duplicateSelection();
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
      } else if (mod && key === 'p') {
        e.preventDefault();
        this.toggleProperties();
      } else if (mod && key === 'n' && e.shiftKey && this.animationInstalled) {
        e.preventDefault();
        this.toggleAnimationMode();
      } else if (mod && (key === ']' || key === '[')) {
        // Ctrl+] / Ctrl+[ restack the active layer, matching the panel's
        // move buttons.
        e.preventDefault();
        this.moveSelectedLayers(key === ']' ? 1 : -1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.store.selectedIds.size > 0 || this.store.selectedLayerIds.size > 0) {
          e.preventDefault();
          this.deleteSelectionOrLayers();
        }
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
          else this.updateCursor();
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

    // Animation Mode: keep the banner's layer-validation status live.
    if (this.animationMode) this.refreshAnimationStatus();

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
      // The main process holds the close prompt on this, so it has to learn
      // about an edit at the same moment the title bar does.
      window.napkin.setDirty(this.store.dirty);
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
    this.renderProperties();
  }

  private toast(message: string): void {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }
}

/**
 * True when an element is a field that swallows typing: a text area, a select,
 * or any input that is not one of the widget types (slider, checkbox, radio,
 * color well, button) that consume no letters of their own.
 */
function isTextEntry(node: Element | null): boolean {
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  if (!(node instanceof HTMLInputElement)) return false;
  return !WIDGET_INPUT_TYPES.has(node.type);
}

/** Input types that pass keystrokes through to the application shortcuts. */
const WIDGET_INPUT_TYPES = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit']);

/**
 * Sets a panel field's value unless the user is typing in it - a store change
 * arriving mid-edit must not overwrite what is being typed.
 */
function setFieldValue(id: string, value: string): void {
  const input = el<HTMLInputElement>(id);
  if (document.activeElement === input) return;
  input.value = value;
}

/**
 * Scratch context used to normalize CSS colors. Assigning to \`fillStyle\`
 * leaves the previous value in place when the color does not parse, so an
 * unreadable color reads back as the sentinel it was primed with.
 */
let colorProbe: CanvasRenderingContext2D | null = null;

/**
 * Normalizes any CSS color to \`#rrggbb\` for an \`<input type="color">\`, or
 * null when it has no opaque hex form (a named color resolves; \`rgba()\` with
 * alpha and an unparseable string do not).
 */
function toHexColor(color: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (!colorProbe) colorProbe = document.createElement('canvas').getContext('2d');
  if (!colorProbe) return null;
  colorProbe.fillStyle = '#000000';
  colorProbe.fillStyle = color;
  const value = colorProbe.fillStyle;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * CSS for a gradient's preview ramp. CSS measures a linear gradient's angle
 * from "to top" clockwise while the model measures from "to right", hence the
 * quarter turn; the radial preview is drawn as a horizontal ramp so the stop
 * handles below it still line up with what they control.
 */
function cssGradient(gradient: Gradient): string {
  const stops = normalizedStops(gradient);
  if (!stops) return 'transparent';
  const body = stops.map((s) => s.color + ' ' + Math.round(s.offset * 100) + '%').join(', ');
  if (gradient.type === 'radial') return 'linear-gradient(90deg, ' + body + ')';
  return 'linear-gradient(' + (((gradient.angle ?? 0) + 90) % 360) + 'deg, ' + body + ')';
}

/**
 * The color a gradient shows at \`offset\`, used to color a stop dropped onto
 * the ramp so adding one does not change what the gradient looks like. Picks
 * the nearer neighbour rather than blending, which keeps the sampled value a
 * real CSS color whatever notation the stops use.
 */
function sampleGradient(gradient: Gradient, offset: number): string {
  const stops = normalizedStops(gradient);
  if (!stops) return '#1f2328';
  let nearest = stops[0];
  for (const stop of stops) {
    if (Math.abs(stop.offset - offset) < Math.abs(nearest.offset - offset)) nearest = stop;
  }
  return nearest.color;
}

/**
 * One-line description of what the properties panel is about to edit: how
 * many elements, of what kind, and on how many layers.
 */
function describeSelection(strokes: Stroke[], sketch: Sketch): string {
  if (strokes.length === 0) return 'Nothing selected';
  const layers = new Set(strokes.map((s) => layerOf(sketch, s).id));
  if (strokes.length === 1) {
    const stroke = strokes[0];
    const kind = isTextStroke(stroke) ? 'text' : isImageStroke(stroke) ? 'image' : stroke.tool;
    return kind + ' on "' + layerOf(sketch, stroke).name + '"';
  }
  const where = layers.size === 1 ? '1 layer' : layers.size + ' layers';
  return strokes.length + ' elements on ' + where;
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

/** What the in-app clipboard is holding, and how a paste should rebuild it. */
type ClipboardContents =
  | { kind: 'flat'; strokes: Stroke[]; origin: { x: number; y: number } }
  | {
      kind: 'tree';
      roots: LayerTreeNode[];
      /** The layer the copy was taken from, which the paste lands beside. */
      sourceId: string;
      origin: { x: number; y: number };
    };

/** How many marks the clipboard holds, however it is holding them. */
function clipboardMarkCount(clip: ClipboardContents | null): number {
  if (!clip) return 0;
  if (clip.kind === 'flat') return clip.strokes.length;
  const count = (node: LayerTreeNode): number =>
    node.marks.length + node.children.reduce((n, child) => n + count(child), 0);
  return clip.roots.reduce((n, root) => n + count(root), 0);
}

/** How many layers a copied tree spans, counting groups and nesting. */
function countTreeLayers(roots: LayerTreeNode[]): number {
  const count = (node: LayerTreeNode): number =>
    1 + node.children.reduce((n, child) => n + count(child), 0);
  return roots.reduce((n, root) => n + count(root), 0);
}

/** A copied subtree with every mark in it shifted by (`dx`, `dy`). */
function moveTreeNode(node: LayerTreeNode, dx: number, dy: number): LayerTreeNode {
  return {
    ...node,
    marks: node.marks.map((mark, i) => ({
      stroke: translateStrokes([mark.stroke], dx, dy)[0],
      order: node.marks[i].order,
    })),
    children: node.children.map((child) => moveTreeNode(child, dx, dy)),
  };
}

/**
 * Copies strokes with every coordinate shifted by (`dx`, `dy`) - the sampled
 * points and, where a stroke carries one, the Bézier anchors and their
 * handles. The originals are left untouched.
 */
function translateStrokes(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  const shift = <T extends { x: number; y: number }>(p: T): T => ({
    ...p,
    x: p.x + dx,
    y: p.y + dy,
  });
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map(shift),
    ...(stroke.vector
      ? {
          vector: {
            ...stroke.vector,
            anchors: stroke.vector.anchors.map((a) => ({
              ...a,
              p: shift(a.p),
              ...(a.hIn ? { hIn: shift(a.hIn) } : {}),
              ...(a.hOut ? { hOut: shift(a.hOut) } : {}),
            })),
          },
        }
      : {}),
  }));
}

/** One entry in the shared right-click context menu. */
interface ContextMenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  /** Renders a divider line instead of a button. */
  separator?: boolean;
  /**
   * Nested entries. A row that carries them opens them in a panel beside
   * itself on hover (or on focus, for the keyboard) rather than acting on a
   * click of its own.
   */
  items?: ContextMenuItem[];
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
      const map = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: p.x * scale + dx,
        y: p.y * scale + dy,
      });
      stroke.points = stroke.points.map((p) => ({ ...p, ...map(p) }));
      // The Bézier structure moves with its samples, or the export (which
      // writes anchors, not samples) would draw the curve where it was.
      if (stroke.vector) {
        stroke.vector.anchors = stroke.vector.anchors.map((a) => ({
          p: map(a.p),
          ...(a.hIn ? { hIn: map(a.hIn) } : {}),
          ...(a.hOut ? { hOut: map(a.hOut) } : {}),
        }));
      }
      stroke.width = Math.max(0.1, stroke.width * scale);
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
    ...(a.move ? { move: true as const } : {}),
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
  // A compound path's subpaths each close back to their own first anchor,
  // and the pen lifts (a `move` point) between them.
  let subStart = 0;
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].move) {
      if (closed) addSegment(anchors[i - 1], anchors[subStart]);
      out.push({ x: anchors[i].p.x, y: anchors[i].p.y, pressure: 0.5, move: true });
      subStart = i;
      continue;
    }
    addSegment(anchors[i - 1], anchors[i]);
  }
  if (closed && anchors.length >= 2) addSegment(anchors[anchors.length - 1], anchors[subStart]);
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
