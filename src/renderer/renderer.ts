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
  STROKE_PROFILES,
  STROKE_STYLES,
  type Gradient,
  type GradientStop,
  type Layer,
  type Point,
  type Sketch,
  type Stroke,
  type StrokeProfile,
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
  type AnimationFacing,
  type AnimationFootSpan,
  animationFrameJob,
  animationFrameName,
  figureFacing,
  matchesFoot,
  animationFrameOffsetX,
  animationFrameTransforms,
  animationLayerBoxes,
  animationPoseStep,
  clampSequenceFrames,
  defaultSequenceFrames,
  MAX_SEQUENCE_FRAMES,
  MIN_SEQUENCE_FRAMES,
  animationTypeSpec,
  ANIMATION_TYPES,
  assemblyPivot,
  buildAnimationForm,
  normalizeAnimationPrompt,
  expandBounds,
  findAssemblyLayers,
  matchesAssembly,
  missingAssemblies,
  topMostParent,
  REQUIRED_ASSEMBLIES,
  type AnimationBounds,
  type AnimationCategory,
  type AnimationLayerBox,
  type AnimationFrameJob,
  type AnimationPoint,
  type RequiredAssembly,
} from '../core/animation.js';
import type {
  AnimationFrameOutput,
  ExportFormat,
  HistoryStats,
  ImageFormat,
  ImportFileResult,
  MenuConfig,
} from '../core/ipc.js';
import type { LaunchOptions } from '../core/launch.js';
import { scaleEffects } from '../core/effects.js';
import { hitMark, marksInBox, outlineDistance } from '../core/hit-test.js';
import { paintOrder } from '../core/paint-order.js';
import { PENCIL_KIT, pencilGrade, pencilPaint, pencilRegion, pencilWidth, rasterizePencil, samePencil, type PencilChoice } from '../core/pencil.js';
import { DEFAULT_SMEAR_STRENGTH, mapSmudges, smearReaches, smudgeFor } from '../core/smudge.js';
import { LIQUIFY_MODES, liquifyMarks, liquifyReaches, refitLiquified, type LiquifyDab, type LiquifyMode } from '../core/liquify.js';
import { isSplittable, splitMark, splitTarget, type SplitPoint } from '../core/split.js';
import { sketchesToPdf } from '../core/pdf.js';
import { defaultSettings, type AppSettings, type QuickModifier } from '../core/settings.js';
import {
  catmullRom,
  constrainDrag,
  cubicBezierPoints,
  extendWithLine,
  sampleVectorPathPoints,
  normalizeRotation,
  quarterArcCubic,
  rotationStep,
  roundedCornerAnchors,
  simplify,
  snapRotation,
  splitCubicBezier,
} from '../sharpen/geometry.js';
import { PopupManager } from './popup.js';
import { importedToSketch, pdfPagesToSketches, withNewIds } from '../core/imported-sketch.js';
import { basename } from '../core/paths.js';
import { rasterScript, scriptFromHistory, scriptFromPages, type GeneratedScript } from '../core/script/generate.js';
import { inkBox } from '../core/script/render.js';
import { ScriptDialog } from './script-dialog.js';
import { Commands, type CommandHandlers } from './commands.js';
import { describeStep, HistoryTracker, localMinute, type CommandInfo } from './history-tracker.js';
import { contextMenuItems, inlineDeeperSubmenus, type ContextMenuItem } from './menus.js';
import { contextItems, defaultRegistry, loadRegistry, type MenuRegistry } from '../core/menu/registry.js';
import type { MenuCommand, MenuState } from '../core/menu/ids.js';
import { displayChord } from '../core/menu/chords.js';
import { commandForEvent, isNewTabKey, isReloadKey } from './keys.js';
import { ConfigDialog, type ConfigDialogSpec } from './config-dialog.js';
import {
  defaultShortcutRows,
  defaultToolTypeRows,
  resolveShortcuts,
  resolveToolTypes,
  shortcutEditorSpec,
  shortcutRows,
  toolTypeEditorSpec,
  toolTypeRows,
  type ShortcutRow,
  type ToolTypeRow,
} from './editors.js';
import { fitPoints, fitsFreehand, fitStroke, SHARPEN_FIT_TOLERANCE, sharpenStroke } from '../sharpen/sharpen.js';
import { Surface, strokeBounds, type LiveStroke, type Overlay, type WarpOverlay, type WipeSnapshot } from './surface.js';
import {
  faceAt,
  facesAlong,
  facesInBox,
  isWipeable,
  stackArrangement,
  stackEdit,
  wipeMarks,
  WIPE_OPERAND_LIMIT,
  type StackArrangement,
  type WipeOp,
} from '../core/wipe.js';
import { screenPx, wheelZoomFactor, ZOOM_MENU_STEP } from './zoom.js';
import {
  AfterPress,
  isStalePress,
  pressEndPolicy,
  type PressEndReason,
  type PressKind,
  type PressRecord,
} from './press-state.js';
import {
  ctrlJoinsPress,
  drawsLines,
  isModifierKey,
  lineStartOf,
  nibStep,
  shiftLineAction,
  SPRING_DELAY_MS,
  spaceAction,
  springsFrom,
  springStep,
  type InkPaint,
  type LineStart,
  type NibEvent,
  type NibState,
  type SelectionTool,
  type SpringEvent,
  type SpringState,
} from './held-keys.js';
import { fitCurve } from '../core/fit-curve.js';
import { bandEnd, closesAt, nextAnchorAt, pulledHandles } from './vector-place.js';
import { eraseKind, eraseMarks, eraseRegionOf } from '../core/erase.js';
import { CLIP_NOTICES, SessionNotices, SHAPE_ERASER_NOTICES, SHAPE_STACKER_NOTICES } from './notice.js';
import { clipIndex, releaseClip, shownBounds } from '../core/clip.js';
import { frontColor, nextQuickColor, otherTarget, swapToolPaint } from './fill-stroke.js';
import type { ColorTarget } from '../core/paint.js';
import { AltMenuRule } from './alt-menu.js';
import {
  ArapSolver,
  MeshLocator,
  MeshMap,
  autoPins,
  buildMesh,
  mapStrokeGeometry,
  maskFromRgba,
  pinRest,
  type Mesh,
  type Vec as WarpVec,
  type WarpPin,
} from '../core/mesh-warp.js';
import { Store, type HistoryEvent, type ImportedLayerNode, type LayerTreeNode, type ToolState } from './store.js';
import { MEASURED_ANIMATION_TYPES, MeasuredFramesError, measuredFramesScript, type MeasuredFrames } from '../core/script/animation.js';
import { evaluate } from '../core/script/evaluate.js';
import { layerTree, type LayerNode } from '../core/script/media.js';
import { importSvg } from './svg-import.js';
import {
  SCALE_FACTOR_MAX,
  SCALE_FACTOR_MIN,
  scaledBox,
  transformCursor,
  transformHandlePoint,
  transformScale,
  TRANSFORM_HANDLES,
  type Mirror,
  type TransformBox,
  type TransformHandle,
} from '../core/transform.js';
import { profileApplies, profilePreviewPath, STROKE_PROFILE_LABELS } from '../core/stroke-profile.js';

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
/** How close to a handle counts as grabbing it, in screen pixels. */
const TRANSFORM_GRAB_PX = 11;

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

/**
 * Every copy of the Show Selection Borders switch: the Move and Mirror
 * palettes', where it is reached while a selection is being worked on, and
 * Quick Settings'. They are one setting, bound and synced from this one list.
 */
const SELECTION_BORDER_SWITCHES = [
  'show-selection-borders',
  'mirror-show-selection-borders',
  'qs-show-selection-borders',
] as const;

/** A Mesh Warp in progress: the art being bent, its mesh and its pins. */
interface WarpSession {
  /** The page it began on: a warp does not follow the page when it turns. */
  sketch: Sketch;
  /** The art as it was when the warp began, which every frame is carried from afresh. */
  rest: Stroke[];
  mesh: Mesh;
  /** Finds points in the rest mesh. */
  locator: MeshLocator;
  solver: ArapSolver;
  pins: WarpPin[];
  /** Where each pin has been dragged to. */
  targets: WarpVec[];
  selected: Set<number>;
  /** The mesh as the pins hold it now. */
  deformed: Float64Array;
  /** Finds points in the deformed mesh - the one on screen - for a click to land in. */
  onScreen: MeshLocator;
  /** Pin states for Ctrl+Z to step back to while the warp is open, oldest first. */
  undo: Array<{ pins: WarpPin[]; targets: WarpVec[] }>;
  /** True once the art has moved: the store transaction is open from then. */
  moved: boolean;
}

/** The Mirror palette's four choices, as its checkboxes hold them. */
interface MirrorOptions {
  /** Swap left and right (`Mirror.flipX`). */
  horizontal: boolean;
  /** Swap top and bottom (`Mirror.flipY`). */
  vertical: boolean;
  /** Keep the selection and mirror a copy beside it. */
  copy: boolean;
  /** Show the result on the canvas before it is kept. */
  preview: boolean;
}

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

/**
 * How far a press on a selected element must travel before it counts as a
 * drag rather than as a click, in screen pixels.
 *
 * Without one, the first pointermove after the press moved the selection by
 * whatever distance it carried, one pixel for one pixel - and a click made by
 * a hand always carries some. Selecting an element left it a few pixels from
 * where it had been, which is a hard thing to even notice, let alone undo on
 * purpose. Screen pixels rather than sketch units, because the jitter being
 * absorbed is the hand's and does not get smaller when the page is zoomed out.
 *
 * Four is the smallest value that swallowed a deliberate click in testing
 * while still letting a one-pixel nudge be dragged. Direct Select's anchor,
 * handle and path drags wait for the same distance.
 */
const SELECT_DRAG_THRESHOLD_PX = 4;

/** What a Direct Select drag carries: raw points, a tangent handle, the path, or a vector anchor or handle. */
type AnchorDragKind = 'anchor' | 'handle' | 'path' | 'vanchor' | 'vhIn' | 'vhOut';

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
/** Split's scissors, their hotspot the crosshair where the cut lands. */
const CURSOR_SPLIT = "url('../assets/split-cursor.svg') 5 5, crosshair";

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
  'tool-pencil',
  'tool-smear',
  'tool-eraser',
  'tool-shape-eraser',
  'tool-shape-stacker',
  'tool-split',
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
  'tool-warp',
  'tool-liquify',
] as const;

/** How long a toast stays up. */
const TOAST_MS = 2400;

/** Shortcuts read the Mac way on a Mac: `Cmd` and `Option`. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

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

  /**
   * The shipped menu files with the user's merged in, as the main process
   * read them. The right-click menus and the toolbar dropdowns are generated
   * from it, as the menu bar is, so the two cannot disagree.
   */
  private menuRegistry: MenuRegistry = defaultRegistry();

  /**
   * The configuration popup the menu editors fill: a search, type radios,
   * a table of rows to edit, and Accept or Cancel. See config-dialog.ts.
   */
  private readonly configDialog: ConfigDialog;

  /** Automate > Generate Script's dialog: the script shown whole, before anything uses it. See script-dialog.ts. */
  private readonly scriptDialog: ScriptDialog;

  /**
   * Every command, by the id the menu files give it. The menu bar, the
   * right-click menus and the toolbar buttons all run through it; see
   * {@link commandHandlers}. A command the main process owns is handed to it.
   */
  private readonly commands = new Commands(this.commandHandlers(), (id) => {
    try {
      window.napkin.runMainCommand(id);
    } catch {
      this.toast('That is only available in the desktop app.');
    }
  });

  /** The menu state last sent to the menu bar, so an unchanged one is not sent again. */
  private sentMenuState = '';

  /**
   * Automate > Track History: the steps recorded while it is on. The store
   * says when a step closes (`Store.onHistory`); see history-tracker.ts.
   */
  private readonly tracker = new HistoryTracker(500);
  /** Stops listening to the store's history; null while Track History is off. */
  private stopTracking: (() => void) | null = null;
  /** False until the setting has been applied once, so the app starting with it on says nothing. */
  private trackingKnown = false;
  /** The pending report of the history figures to the main process. */
  private historyStatsTimer: number | null = null;
  /** Ends the name the press on the canvas records its steps under; null between presses. */
  private pressEnd: (() => void) | null = null;
  /** The app's version, for the first line of a script written from the history; null until the main process says. */
  private appVersion: string | null = null;

  private live: LiveStroke | null = null;
  private activePointerId: number | null = null;
  /**
   * The press that owns `activePointerId`: what it is doing and the tool it
   * began with, which its moves and its release act on (press-state.ts).
   */
  private press: PressRecord | null = null;
  /** Work asked for while a press is live - a change of tool above all - done when it ends. */
  private readonly afterPress = new AfterPress();
  /** Where the owning pointer last was, for finishing a press whose release never comes. */
  private pressClient: { x: number; y: number; pointerType: string } | null = null;
  /** Above zero while a release is being handled, which a capture lost during it belongs to. */
  private releasing = 0;
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
   * Where the press that armed a move landed, in client pixels, and whether
   * the move has since been committed to.
   *
   * A press on a selected element arms a drag but does not start one: nothing
   * is moved and no history step is pushed until the pointer has travelled
   * {@link SELECT_DRAG_THRESHOLD_PX} from here. Until then the gesture is
   * still a click, and a click must leave the drawing exactly as it found it.
   */
  private dragFrom: { x: number; y: number } | null = null;
  private dragCommitted = false;

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

  /**
   * The element a press landed on while a multi-element selection was already
   * under the pointer. Taking it on the press is what made a selection so
   * hard to move: the hit test is deliberately forgiving, so a press aimed at
   * the middle of a selection lands "on" any unselected mark within a few
   * pixels, and the whole selection is replaced by that one element a frame
   * before the drag that was meant to move it. The selection keeps the press;
   * the element gets it back on release, if the pointer never moved.
   */
  private pendingSelectHitId: string | null = null;

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
  // What the toolbar's custom color has done to the selection since its
  // popup opened, or null while no pick has reached a selection: set by the
  // first tick, which opens the one history step the rest of the drag folds
  // into, and cleared when the popup closes.
  private inkPick: { filled: number; recolored: number } | null = null;
  // The same for the toolbar's width: how many outlines the selection held
  // when a width first reached it, or null until one has. A slider drag's
  // first change opens the step and the rest fold into it.
  private widthPick: number | null = null;

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
  // Where the pointer puts the quick curve's far end, before the snap: kept
  // so Shift going down or up can free or snap the end without a move.
  private quickCurveRaw: Point | null = null;

  // Shift-click lines (held-keys.ts). `lineStart` is point 1, where the next
  // one starts. `shiftLine` is the press drawing one: the mark it carries on
  // (null when the line is a mark of its own), what the live stroke holds
  // before point 2, and point 2, where the press's own drawing begins.
  private lineStart: LineStart | null = null;
  private shiftLine: { markId: string | null; prefix: Point[]; to: Point } | null = null;

  // The Eraser press under way: the marks it cuts, fixed when it went down -
  // the selection, or null for every editable mark it touches.
  private erasing: { targets: Set<string> | null } | null = null;

  // Shape Eraser: the shape it cuts with, for the session (its panel sets it,
  // as the Curve flyout sets `curveVariant`), and the drag under way - the
  // selected marks it cuts, and the shape dragged out so far.
  private shapeEraserShape: ShapeEraserShape = 'rect';
  private shapeErase: { targets: Set<string>; outline: Point[] | null } | null = null;
  /** A Wipe Stacks wipe under way: the picture from before it, when it began, how far across it is, and its frame request. */
  private wipeAnim: { snapshot: WipeSnapshot; start: number; t: number; frame: number } | null = null;
  /**
   * The Shape Stacker's faces of the selection (core/wipe.ts), worked out when
   * first wanted after the page or the selection changed.
   */
  private stacker: StackArrangement | null = null;
  private stackerDirty = true;
  /** The face under the pointer while the Shape Stacker is in hand, or -1. */
  private stackerHover = -1;
  /**
   * A Shape Stacker press: whether it takes faces away (Alt at the press) or
   * drags a box (Shift), where it began and is now, its path, and the faces
   * it has marked in the order it reached them.
   */
  private stackDrag: { remove: boolean; box: boolean; start: Point; end: Point; path: Point[]; marked: number[] } | null = null;
  /**
   * A Smear drag under way: the stump's path, width and strength; the marks
   * it may smear - the selected ones, or with none selected every one it
   * passes - with their boxes; those it has reached; and whether it has
   * passed over a mark that is not a pencil's, which it leaves alone.
   */
  private smearDrag: {
    points: Point[];
    width: number;
    strength: number;
    candidates: Array<{ stroke: Stroke; box: { minX: number; minY: number; maxX: number; maxY: number } }>;
    reached: Set<string>;
    others: boolean;
  } | null = null;
  /** Whether the Smear has said, this session, that it blends pencil marks only. */
  private smearSaid = false;
  /** The Liquify brush in hand: which of the four, and its radius in page units. */
  private liquifyMode: LiquifyMode = 'warp';
  private liquifyRadius = LIQUIFY_RADIUS;
  /**
   * A Liquify press under way. A bend: the marks it may bend - the selected
   * ones, or with none selected every editable one - and those it has bent;
   * where the brush is, the pressure, and the frame clock of a brush that
   * works while held; whether the store transaction that keeps the drag as one
   * undo step is open; and whether it passed over pencil marks, which it leaves
   * to the Smear. A size (an Alt-drag): the brush's centre, the radius it had,
   * and whether the pointer has moved off the centre yet.
   */
  private liquifyDrag:
    | {
        kind: 'bend';
        mode: LiquifyMode;
        candidates: Set<string>;
        bent: Set<string>;
        at: Point;
        pressure: number;
        last: number;
        frame: number | null;
        open: boolean;
        pencils: boolean;
      }
    | { kind: 'size'; center: Point; from: number; moved: boolean }
    | null = null;
  /** Whether Liquify has said, this session, that it leaves pencil marks to the Smear. */
  private liquifySaid = false;
  /** Where a Split click would cut, while Split is in hand and the pointer is on a path. */
  private splitHover: { strokeId: string; at: SplitPoint } | null = null;

  // Why an action did nothing, once a session (notice.ts).
  private readonly notices = new SessionNotices((text) => this.toast(text));

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
  private anchorDragKind: AnchorDragKind | null = null;
  private anchorDragLast: Point | null = null;

  /** Where the anchor/handle/path drag began, for the Shift constraint. */
  private anchorDragOrigin: Point | null = null;

  /**
   * Where a Direct Select press landed, in client pixels, and whether its drag
   * has begun. As with the Select tool, nothing moves and no history step is
   * pushed until the pointer has travelled {@link SELECT_DRAG_THRESHOLD_PX}
   * from here, so a click that only picks an anchor leaves the drawing alone.
   */
  private anchorDragFrom: { x: number; y: number } | null = null;
  private anchorDragCommitted = false;
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
  // `vectorPointer` is where the pointer is, before Shift holds it to eight
  // directions, so Shift going down or up can redo the band or the handle
  // without a move (vector-place.ts); `vectorCloseHover` is true while a
  // press would close the path, and the close indicator shows.
  private vectorAnchors: VectorAnchor[] = [];
  private vectorDragging = false;
  private vectorHover: Point | null = null;
  private vectorPointer: Point | null = null;
  private vectorCloseHover = false;

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
    { points: Point[]; vector?: Stroke['vector']; fit: boolean }
  > | null = null;

  // Held keys (held-keys.ts). Ctrl on a drawing tool gives the last selection
  // tool chosen: `spring` is how far that has got, `springFrom` the drawing
  // tool to give back, `springTimer` the delay before it comes up by itself.
  private lastSelectionTool: SelectionTool = 'select';
  private spring: SpringState = 'off';
  private springFrom: Tool | null = null;
  private springTimer: number | null = null;
  /** Where the pointer was, in client pixels, over any part of the window. */
  private hoverClient: { x: number; y: number } | null = null;
  /** Where the pointer was when the nib-rotate's hold key went down. */
  private nibHoldOrigin: { x: number; y: number } | null = null;
  /** Whether a bare Alt may open the menu bar (alt-menu.ts). */
  private readonly altRule = new AltMenuRule();

  // Quick-feature digit entry (Quick Width "W" / Quick Opacity "Q").
  private quickMode: 'width' | 'opacity' | null = null;
  private quickBuffer = '';
  private quickTimer: number | null = null;

  // Quick Zoom ("Z" then a digit): armed while waiting for the digit that
  // sets the zoom level (9 => 90%, 0 => 100%).
  private quickZoomArmed = false;
  private quickZoomTimer: number | null = null;

  // Copic quick nib-rotate (hold Ctrl → Alt/Shift rotate the broad nib): a
  // still hold while `nib` is pending, the mode itself once it is on.
  private nib: NibState = 'off';
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
    this.configDialog = new ConfigDialog(el('config-dialog'), { mac: IS_MAC });
    this.scriptDialog = new ScriptDialog(el('script-dialog'), {
      copy: (script) => this.copyScript(script),
      save: (script, name) => this.saveScript(script, name),
      open: (script) => this.openScriptAsPages(script),
    });

    this.store.subscribe(() => this.scheduleRender());
    this.store.subscribe(() => this.scheduleSyncUi());
    this.store.subscribe(() => this.checkLineStart());
    this.store.subscribe(() => {
      this.stackerDirty = true;
    });

    this.bindTools();
    this.bindFileActions();
    this.bindPages();
    this.bindLayers();
    this.bindSettings();
    this.bindPointer();
    this.bindKeyboard();
    this.bindHeldKeys();
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
    this.bindMirror();
    this.bindStrokeProfile();
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
      this.appVersion = await window.napkin.getAppVersion();
    } catch {
      // Outside Electron the script names no version.
    }
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

    // The user's menu files, as the main process read them, so the right-click
    // menus come from the same registry as the menu bar.
    let menuWarning: string | null = null;
    try {
      menuWarning = this.applyMenuConfig(await window.napkin.getMenuConfig());
      window.napkin.onNotice((message) => this.toast(message));
      // An editor's Accept has the main process write the user's files and send
      // them back: the registry, the tooltips and the keys follow at once.
      window.napkin.onMenuConfigChanged((config) => {
        const warning = this.applyMenuConfig(config);
        this.applyShortcutTitles();
        if (warning !== null) this.toast(warning);
      });
    } catch {
      // Outside Electron the shipped menus are all there is.
    }
    this.applyShortcutTitles();
    this.installCheckHooks();

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

    // Said last, and after whatever opening the window said: a toast holds one
    // sentence at a time, and an import's "Imported 1 layer" used to replace
    // the warning that the user's menu files were ignored before anyone could
    // read it.
    if (menuWarning !== null) this.toastAfterCurrent(menuWarning);
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
        // The mesh and its pins are the selection while a warp is open.
        showSelectionBorders: this.settings.showSelectionBorders && !this.warp,
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
        liveErase:
          this.erasing && this.live?.tool === 'eraser'
            ? { targets: this.erasing.targets }
            : this.shapeErase?.outline
              ? { targets: this.shapeErase.targets, region: [this.shapeErase.outline] }
              : undefined,
        shapeOutline: this.shapeErase?.outline ?? undefined,
        stack: this.stackerOverlay() ?? undefined,
        liveSmear:
          this.smearDrag && this.smearDrag.reached.size > 0
            ? { pass: { points: this.smearDrag.points, width: this.smearDrag.width, strength: this.smearDrag.strength }, ids: this.smearDrag.reached }
            : undefined,
        splitRing: this.store.tool.tool === 'split' && this.splitHover && this.pointerOverCanvas ? this.splitHover.at.point : undefined,
        liquifyBrush: this.liquifyBrush() ?? undefined,
        wipe: this.wipeAnim ? { snapshot: this.wipeAnim.snapshot, t: this.wipeAnim.t } : undefined,
        closeIndicator:
          this.store.tool.tool === 'vector' && this.vectorCloseHover && this.vectorAnchors.length >= 2
            ? this.vectorAnchors[0].p
            : undefined,
        rotate: this.rotateOverlay() ?? undefined,
        transform: this.transformOverlay() ?? undefined,
        anchors: this.anchorOverlay() ?? undefined,
        warp: this.warpOverlay() ?? undefined,
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
        selected: withSeamTwins(
          anchors.map((a) => a.p),
          this.selectedAnchors,
        ),
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
      selected: withSeamTwins(stroke.points, this.selectedAnchors),
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
    c.addEventListener('pointerdown', (e) => {
      // Track History records what a press commits under the tool that made
      // it, or the dialog it turns or sizes the selection for.
      if (e.button === 0) {
        // A press still on record lost its release somewhere. It is finished
        // where it stands, under its own name, before this one begins -
        // rather than turning this one away, which is how the tools-break
        // stopped every tool for good.
        const owner = this.press?.pointerId ?? this.activePointerId;
        if (owner !== null && isStalePress(owner, e.pointerId, this.pointers)) this.endPressEarly('stale');
        // Ctrl held on a drawing tool: the selection tool comes up now, if it
        // has not already, so this press is the selection tool's.
        if (!this.press) this.springEvent('press');
        this.endPress();
        this.pressEnd = this.store.beginCommand(this.pressCommand());
      }
      this.onPointerDown(e);
    });
    // The capture can go before the release does - taken by the system, or by
    // another element. That ends the press where it stands. After an ordinary
    // release there is no press left by the time this is heard.
    c.addEventListener('lostpointercapture', (e) => {
      if (this.releasing === 0 && this.press?.pointerId === e.pointerId) this.endPressEarly('capture');
    });
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => {
      this.onPointerUp(e);
      this.endPress();
    });
    c.addEventListener('pointercancel', (e) => {
      this.onPointerUp(e);
      this.endPress();
    });
    c.addEventListener('pointerleave', (e) => {
      if (this.activePointerId !== null) {
        this.onPointerUp(e);
        this.endPress();
      }
      // Paste aims at the pointer only while there is one on the page.
      this.pointerOverCanvas = false;
      this.showWarpHint(null);
      if (this.store.tool.tool === 'liquify') this.scheduleRender();
      if (this.stackerHover >= 0 || this.splitHover) {
        this.stackerHover = -1;
        this.splitHover = null;
        this.scheduleRender();
      }
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
    this.endWipe();
    if (e.deltaY === 0) return;
    const scrollUp = e.deltaY < 0;

    if (e.altKey) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      // A notch of a mouse wheel is 1.1; a trackpad's smaller deltas zoom by
      // as much of a notch as they are, and a deep zoom takes no longer to
      // reach with a fast wheel.
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode, this.settings.invertScrollZoom);
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

  /**
   * What a press on the canvas is part of, as Track History names it: the
   * Rotate dialog or the Transform box it turns or sizes the selection for,
   * or else the tool in hand.
   */
  private pressCommand(): string {
    if (this.rotateDialogOpen) return 'rotate';
    if (this.transformActive) return 'toggle-transform';
    return `tool:${this.store.tool.tool}`;
  }

  /** Ends the press's name, and with it the press's step. */
  private endPress(): void {
    const end = this.pressEnd;
    if (!end) return;
    this.pressEnd = null;
    end();
    this.store.flushHistoryStep();
  }

  /**
   * Runs an edit a dialog or a mode commits - Move's, Rotate's, Mirror's,
   * Sharpen's, a finished Vector Path or text box - under the command it
   * belongs to, which has long returned by the time the dialog's button is
   * pressed, and closes its step.
   */
  private recordAs<T>(command: string, edit: () => T): T {
    const end = this.store.beginCommand(command);
    try {
      return edit();
    } finally {
      end();
      this.store.flushHistoryStep();
    }
  }

  // ---- The press record (press-state.ts) -----------------------------------

  /**
   * Takes the pointer for a press: its capture, and the record the press's
   * moves and release act on. Every press that captures the pointer comes
   * through here.
   */
  private claimPointer(e: PointerEvent, kind: PressKind): void {
    this.activePointerId = e.pointerId;
    this.press = { kind, pointerId: e.pointerId, tool: this.store.tool.tool };
    this.pressClient = { x: e.clientX, y: e.clientY, pointerType: e.pointerType };
    this.canvas.setPointerCapture(e.pointerId);
  }

  /**
   * Lets go of the pointer a press owns - its capture and its record - and
   * does whatever was asked for while it was down. Safe to call twice, and
   * from inside a release.
   */
  private releasePointer(): void {
    const id = this.press?.pointerId ?? this.activePointerId;
    this.press = null;
    this.activePointerId = null;
    this.pressClient = null;
    if (id !== null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.afterPress.flush();
    // With the press gone, a Space still held shows the hand again.
    this.updateCursor();
  }

  /** Does `work` now, or once the press in progress has ended. */
  private whenPressEnds(work: () => void): void {
    if (this.press) this.afterPress.add(work);
    else work();
  }

  /** The tool a press acts with: the one it began with while it lasts, the one in hand otherwise. */
  private pressTool(): Tool {
    return this.press?.tool ?? this.store.tool.tool;
  }

  /**
   * Ends the press in progress for something other than its release, as
   * {@link pressEndPolicy} says: finished where it stands - the release it
   * never had, at the last place its pointer was - or dropped. Either way the
   * pointer is let go and the press's history step is closed.
   */
  private endPressEarly(reason: PressEndReason): void {
    const owner = this.press?.pointerId ?? this.activePointerId;
    if (owner === null) return;
    const kind = this.press?.kind ?? 'freehand';
    if (pressEndPolicy(kind, reason) === 'finish') {
      const at = this.pressClient;
      this.onPointerUp(
        new PointerEvent('pointerup', {
          pointerId: owner,
          pointerType: at?.pointerType ?? 'mouse',
          isPrimary: true,
          clientX: at?.x ?? 0,
          clientY: at?.y ?? 0,
          button: 0,
          buttons: 0,
        }),
      );
    } else {
      this.dropPress();
    }
    this.endPress();
  }

  /** Drops the press in progress when it is one of `kinds`: a mode's own cancel, mid-drag. */
  private dropPressOf(...kinds: PressKind[]): void {
    if (!this.press || !kinds.includes(this.press.kind)) return;
    this.dropPress();
    this.endPress();
  }

  /**
   * Abandons the press in progress: every per-press field goes and the
   * pointer is let go, so nothing the press was about to add is added. What
   * a drag has already done to the drawing - a scale, a pin, an anchor -
   * stays, one undo away.
   */
  private dropPress(): void {
    this.clearPressFields();
    this.releasePointer();
    this.updateCursor();
    this.scheduleRender();
  }

  /** Clears every field a press sets, whatever the press was. */
  private clearPressFields(): void {
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
    this.quickCurveRaw = null;
    this.shiftLine = null;
    this.erasing = null;
    this.shapeErase = null;
    this.stackDrag = null;
    this.smearDrag = null;
    this.abandonLiquify();
    this.vectorDragging = false;
    this.vectorEditDrag = null;
    this.startSnapHit = null;
    this.setSnapTarget(null);
    this.dragging = false;
    this.dragLast = null;
    this.dragOrigin = null;
    this.dragFrom = null;
    this.dragCommitted = false;
    this.dragMoved = false;
    this.copyDragging = false;
    this.pendingSelectionClear = false;
    this.pendingSelectHitId = null;
    this.shiftToggleId = null;
    this.rubberBandStart = null;
    this.rubberBandBox = null;
    this.textDragStart = null;
    this.textDragLive = null;
    this.anchorDragKind = null;
    this.handleDrag = null;
    this.anchorDragLast = null;
    this.anchorDragOrigin = null;
    this.anchorDragFrom = null;
    this.anchorDragCommitted = false;
    this.panDragging = false;
    this.panLast = null;
    this.panOrigin = null;
    this.warpDrag = null;
    this.transformDrag = null;
    this.rotateDrag = null;
    this.rotateCenterDrag = null;
    this.rotateRay = null;
  }

  private onPointerDown(e: PointerEvent): void {
    // A press, whichever button, ends a wipe at once: the page already holds
    // the result, and the press goes on to do what it does.
    this.endWipe();
    // Only the primary button draws, selects and edits. A right press is the
    // canvas menu's: before this, it drew a dot with the pen, or dropped the
    // selection with the Select tool, before the menu meant to act on that
    // selection opened.
    if (e.button !== 0) return;

    // Track every pointer for two-finger pan/zoom detection.
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      this.beginGesture();
      return;
    }

    if (this.activePointerId !== null) return;
    const tool = this.store.tool.tool;
    const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);

    // Space held gives the hand, on every tool and over any box or dialog:
    // the press pans the canvas (held-keys.ts). The straight line and the
    // quick curve are Space pressed after the press (see bindKeyboard).
    if (this.spaceDown) {
      e.preventDefault();
      this.beginPanDrag(e);
      return;
    }

    // Rotate: while its dialog is open the canvas turns the selection rather
    // than drawing on it, and the pivot marker can be dragged somewhere else.
    // Claimed ahead of every tool, since the gesture belongs to the dialog
    // and not to whichever tool happened to be active when it opened.
    // Transform first: its handles sit on top of whatever is under them, and
    // a press on a handle is never a press on the drawing.
    if (this.transformActive && this.beginTransformDrag(e, pt)) return;
    if (this.rotateDialogOpen && this.beginRotateDrag(e, pt)) return;

    // Mesh Warp: pins, and picking the art to bend.
    if (tool === 'warp') {
      e.preventDefault();
      this.warpPointerDown(e, pt);
      return;
    }

    // Liquify: the drag bends the marks under the brush (core/liquify.ts), and
    // an Alt-drag sizes the brush. Like Mesh Warp it bends marks where they are.
    if (tool === 'liquify') {
      e.preventDefault();
      this.liquifyPointerDown(e, pt);
      return;
    }

    // Eyedropper reads the canvas; it needs no editable layer.
    if (tool === 'eyedrop') {
      e.preventDefault();
      this.applyEyedrop(e);
      return;
    }

    // Direct Select: grab an anchor point, or pick a stroke to edit.
    if (tool === 'point') {
      e.preventDefault();
      this.beginPointSelect(e, pt);
      return;
    }

    // Fill Color: fill the selection, or the element under the click.
    if (tool === 'fill') {
      e.preventDefault();
      this.applyFillColor(pt);
      return;
    }

    // Every mark-making tool needs an editable (visible, unlocked) layer - but
    // the Eraser and the Shape Eraser make no mark, and cut the marks where
    // they are, and the Shape Stacker and Split work on the marks where they are.
    if (
      tool !== 'select' &&
      tool !== 'eraser' &&
      tool !== 'shape-eraser' &&
      tool !== 'shape-stacker' &&
      tool !== 'split' &&
      !this.ensureDrawableLayer()
    ) {
      return;
    }

    // Curve tool, bend phase: a click commits the pending curve.
    if (this.curveBending) {
      e.preventDefault();
      this.commitCurve();
      return;
    }

    // Curve tool: the chord (Shift additionally snaps the chord ends). The
    // quick curve is Ctrl and Space pressed after a press (see bindKeyboard).
    if (tool === 'curve') {
      e.preventDefault();
      // The Curve tool keeps its two-phase chord-and-bend flow for a mouse,
      // which can hover between clicks; pen and touch input cannot, so they
      // take the quick curve's single-gesture flow instead.
      const quick = e.pointerType !== 'mouse';
      this.claimPointer(e, quick ? 'curve' : 'chord');
      this.curveTool = drawingToolOf(tool);
      // The default Curve variant starts (and ends) at nearby stroke endpoints.
      const snapEnds = e.shiftKey || this.curveVariant === 'endpoints';
      const start = this.applyEndpointSnap(pt, snapEnds, this.curveTool);
      this.startSnapHit = this.snapTarget;
      this.curveA = start;
      this.curveB = start;
      this.curveBending = false;
      this.quickCurve = quick;
      this.quickCurveUniform = this.quickCurve && e.altKey;
      this.quickCurveApex = 0;
      this.scheduleRender();
      return;
    }

    // Vector Path: each press places an anchor (drag pulls out its Bézier
    // handles; a plain click leaves a corner). Pressing on the first anchor
    // closes the path and commits it. Space pans, as with every tool, and
    // the path waits for the next press.
    if (tool === 'vector') {
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
      // A press where the close indicator shows closes the path, Shift or not.
      if (closesAt(this.vectorAnchors, pt, this.vectorGrab())) {
        this.commitVectorPath(true);
        return;
      }
      this.claimPointer(e, 'vector-place');
      // Shift holds the new anchor to eight directions from the last.
      this.vectorAnchors.push({ p: nextAnchorAt(this.vectorAnchors, pt, e.shiftKey) });
      this.vectorDragging = true;
      this.vectorHover = null;
      this.vectorPointer = pt;
      this.vectorCloseHover = false;
      if (this.vectorAnchors.length === 1) {
        this.toast('Click to add points, drag for curves; click the first point to close, Enter to finish (Esc cancels).');
      }
      this.previewVectorPath();
      return;
    }

    // Paint bucket: fill the enclosed shape under the click.
    if (tool === 'bucket') {
      e.preventDefault();
      this.applyBucket(pt);
      return;
    }

    // Shape Eraser: drag out the chosen shape over the selection, and the
    // release cuts it out of the selected marks (core/erase.ts).
    // REUSE: the drag is the Rectangle and Ellipse tools' press - the 'shape'
    // press kind and `shapeStart` - with `shapeErase` saying it is the
    // eraser's, so the move draws an outline and the release cuts instead of
    // adding a mark. Should the shape tools and the eraser ever need to part
    // ways mid-drag (a key that means one thing to each, say), give the Shape
    // Eraser a press kind of its own rather than growing the branches.
    if (tool === 'shape-eraser') {
      e.preventDefault();
      const targets = this.eraserTargets();
      if (!targets || targets.size === 0) {
        this.notices.show(SHAPE_ERASER_NOTICES.noSelection);
        return;
      }
      this.claimPointer(e, 'shape');
      this.shapeStart = pt;
      this.shapeErase = { targets, outline: null };
      this.scheduleRender();
      return;
    }

    // Shape Stacker: a press on the selection's pieces marks them - a drag
    // every piece it crosses, a click the one under it, a Shift-drag every
    // piece its box touches - and the release merges them into one shape,
    // or with Alt at the press takes them away (core/wipe.ts's stackEdit).
    if (tool === 'shape-stacker') {
      e.preventDefault();
      const arrangement = this.stackerFaces();
      if (arrangement.problem === 'too-few') {
        this.notices.show(SHAPE_STACKER_NOTICES.tooFew);
        return;
      }
      if (arrangement.problem) {
        this.toast(
          arrangement.problem === 'too-many'
            ? 'The Shape Stacker takes up to ' + WIPE_OPERAND_LIMIT + ' shapes and a few hundred pieces: select fewer.'
            : 'These shapes could not be cut into pieces: try fewer, or simpler ones.',
        );
        return;
      }
      this.claimPointer(e, 'stack');
      const first = faceAt(arrangement, pt);
      this.stackDrag = { remove: e.altKey, box: e.shiftKey, start: pt, end: pt, path: [pt], marked: first >= 0 ? [first] : [] };
      this.stackerHover = -1;
      this.scheduleRender();
      return;
    }

    // Split: a click on a path cuts it there (core/split.ts), nothing moving.
    if (tool === 'split') {
      e.preventDefault();
      this.splitAt(pt);
      return;
    }

    // Smear: a drag spreads the graphite of the Pencil marks it passes
    // (core/smudge.ts) - the selected ones, or with none selected every one,
    // as the Eraser chooses what it cuts.
    if (tool === 'smear') {
      e.preventDefault();
      this.claimPointer(e, 'smear');
      const targets = this.eraserTargets();
      const editable = this.editableStrokeIds();
      const candidates = this.store.sketch.strokes
        .filter((s) => editable.has(s.id) && (targets === null || targets.has(s.id)) && s.tool !== 'eraser')
        .map((stroke) => ({ stroke, box: strokeBounds(stroke, (s) => this.surface.measureText(s)) }))
        .filter((c): c is { stroke: Stroke; box: NonNullable<typeof c.box> } => c.box !== null);
      // REUSE: with the Smear in hand, Quick Width is the stump's size and
      // Quick Opacity its strength - the tool state those two quick features set.
      this.smearDrag = {
        points: [pt],
        width: this.store.tool.width,
        strength: this.store.tool.opacity ?? DEFAULT_SMEAR_STRENGTH,
        candidates,
        reached: new Set(),
        others: false,
      };
      this.smearReach([pt]);
      this.scheduleRender();
      return;
    }

    // Shape tools: drag out a rectangle or ellipse (Shift = square / circle).
    if (tool === 'rect' || tool === 'ellipse') {
      e.preventDefault();
      this.claimPointer(e, 'shape');
      this.shapeStart = pt;
      const { color, fill, width, opacity } = this.store.tool;
      this.live = {
        id: createId('st'),
        tool: 'pen',
        color,
        width,
        points: [{ ...pt }],
        layer: this.store.activeLayer.id,
        sharpened: true,
        ...(opacity != null ? { opacity } : {}),
        // A new shape takes the tool's fill (fill-stroke.ts), as it takes the ink.
        ...(fill ? { fill } : {}),
        ...this.toolProfile('pen'),
      };
      this.scheduleRender();
      return;
    }

    if (tool === 'text') {
      e.preventDefault();
      this.claimPointer(e, 'text');
      this.textDragStart = pt;
      this.textDragLive = null;
      return;
    }

    if (tool === 'select') {
      this.beginSelect(e, pt);
      return;
    }

    e.preventDefault();
    this.claimPointer(e, 'freehand');
    // Shift with point 1 in hand: the Shift-click line (held-keys.ts).
    if (e.shiftKey && this.beginShiftLine(tool, pt)) return;
    // The Eraser cuts the marks it is aimed at as it goes (Surface liveErase),
    // and the release cuts them for good.
    if (tool === 'eraser') this.erasing = { targets: this.eraserTargets() };
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
      ...this.pencilInk(tool),
      ...this.toolProfile(tool),
    };
    this.scheduleRender();
  }

  private onPointerMove(e: PointerEvent): void {
    // Keep the tracked pointer position current for gesture math.
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // And where the press's pointer is, should the press have to be finished
    // without the release it never had.
    if (this.press?.pointerId === e.pointerId) {
      this.pressClient = { x: e.clientX, y: e.clientY, pointerType: e.pointerType };
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
    if (this.transformActive && this.onTransformPointerMove(e, this.lastCanvasPoint)) return;
    if (this.rotateDialogOpen && this.onRotatePointerMove(e, this.lastCanvasPoint)) return;

    // A drag carries on with the tool it began with, whatever is in hand now.
    const tool = this.pressTool();

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

    // Mesh Warp: a pin drag bends the art; otherwise the art under the
    // pointer is outlined for the click that would mesh it.
    if (tool === 'warp') {
      this.warpPointerMove(e, this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure));
      return;
    }

    // Liquify: the brush follows the pointer, and a drag bends as it goes.
    if (tool === 'liquify') {
      this.liquifyPointerMove(e);
      return;
    }

    // Shape Stacker: the piece under the pointer is shaded for the press that
    // would take it, and a press marks what it passes.
    if (tool === 'shape-stacker') {
      this.stackerPointerMove(e);
      return;
    }

    // Smear: the drag goes on, and the marks it reaches smear as it goes.
    if (tool === 'smear') {
      this.smearPointerMove(e);
      return;
    }

    // Split: the place a click would cut is ringed.
    if (tool === 'split') {
      if (!this.press) this.updateSplitHover(this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure));
      return;
    }

    // Direct Select: drag the grabbed anchor(s), handle, or whole path.
    if (this.anchorDragKind && this.anchorStrokeId && this.activePointerId === e.pointerId) {
      // A press is a click until it travels; only then does the edit begin,
      // with the history step that undoes it.
      if (!this.anchorDragCommitted) {
        const from = this.anchorDragFrom;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) < SELECT_DRAG_THRESHOLD_PX) {
          return;
        }
        this.anchorDragCommitted = true;
        this.store.pushHistory();
      }
      const raw = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      // Shift pins the drag to the nearest axis or diagonal, whether it is
      // carrying anchors, a handle, or the whole path.
      const pt =
        e.shiftKey && this.anchorDragOrigin ? constrainDrag(this.anchorDragOrigin, raw) : raw;
      if (this.anchorDragLast) {
        const dx = pt.x - this.anchorDragLast.x;
        const dy = pt.y - this.anchorDragLast.y;
        if (this.anchorDragKind === 'anchor') {
          const edited = this.store.sketch.strokes.find((s) => s.id === this.anchorStrokeId);
          this.store.nudgeStrokePoints(
            this.anchorStrokeId,
            withSeamTwins(edited?.points ?? [], this.selectedAnchors),
            dx,
            dy,
          );
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
    // quarter circle versus quarter ellipse. The far end snaps to a stroke's
    // end in reach, except while Shift - the apex key here - is held.
    if (this.quickCurve && this.curveA !== null && this.activePointerId === e.pointerId) {
      this.quickCurveRaw = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.quickCurveUniform = e.altKey;
      this.updateQuickCurveEnd(e.shiftKey);
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
        ...this.pencilInk(this.curveTool),
        ...this.toolProfile(this.curveTool),
      };
      this.scheduleRender();
      return;
    }

    // Shape Eraser: the shape from the drag box - Square and Circle held
    // square, and Shift holding Rectangle and Ellipse too - cut out of the
    // targets on the canvas as it grows (Surface liveErase).
    if (this.shapeErase && this.shapeStart !== null && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.shapeErase.outline = shapeEraserOutline(this.shapeEraserShape, this.shapeStart, pt, e.shiftKey);
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
    // pointer position previews the next segment as a rubber band. Shift
    // holds either to eight directions. An active quick straight line takes
    // precedence over the hover preview.
    if (tool === 'vector' && this.straightStart === null) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      if (this.vectorDragging && this.activePointerId === e.pointerId) {
        this.vectorPointer = pt;
        this.pullVectorHandles(e.shiftKey);
        return;
      }
      if (this.vectorAnchors.length > 0) {
        this.vectorPointer = pt;
        this.updateVectorHover(e.shiftKey);
        return;
      }
    }

    // Straight-line mode: update the dashed preview endpoint. While Shift is
    // held the line keeps to the nearest of eight directions; without it the
    // end snaps to a stroke's end in reach. Shift going up or down mid-drag
    // swaps one for the other.
    if (this.straightStart !== null && this.activePointerId === e.pointerId) {
      this.straightRaw = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      this.updateStraightEnd(e.shiftKey);
      return;
    }

    // Text-tool: track drag to define a text-box rectangle.
    if (tool === 'text' && this.textDragStart !== null && this.activePointerId === e.pointerId) {
      const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
      const dx = pt.x - this.textDragStart.x;
      const dy = pt.y - this.textDragStart.y;
      const threshold = this.screenPx(TEXT_DRAG_THRESHOLD);
      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
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
      if (!this.dragCommitted && !this.commitSelectDrag(e)) return;
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

    // A sample every three quarters of a screen pixel, whatever the zoom: in
    // page units it was nothing at the widest zoom and hundreds of pixels at
    // the deepest, where a stroke kept two points.
    const spacing = this.screenPx(0.75);
    for (const ev of events) {
      const pt = this.surface.toSketchPoint(ev.clientX, ev.clientY, ev.pressure);
      const last = this.live.points[this.live.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= spacing) {
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
    this.releasing++;
    try {
      this.finishPress(e);
    } finally {
      this.releasing--;
      // Whichever branch took the release - or none, when the gesture it was
      // for had been cancelled - the pointer that owned the press is let go.
      if (this.press?.pointerId === e.pointerId || this.activePointerId === e.pointerId) this.releasePointer();
    }
  }

  /** Finishes what a press was doing when its pointer comes up. */
  private finishPress(e: PointerEvent): void {
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
    if (this.transformActive && this.endTransformDrag(e)) return;
    if (this.rotateDialogOpen && this.endRotateDrag(e)) return;

    // The release finishes what the press began, with the tool it began with:
    // a shortcut or the Copic nib-rotate may have put another in hand since.
    const tool = this.pressTool();

    // Liquify: the drag is over - what it bent is fitted again, one undo step.
    if (this.liquifyDrag && this.activePointerId === e.pointerId) {
      this.finishLiquify();
      return;
    }

    // Select-tool Space + drag: end the pan.
    if (this.panDragging && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.panDragging = false;
      this.panLast = null;
      this.panOrigin = null;
      this.activePointerId = null;
      this.updateCursor();
      return;
    }

    // Mesh Warp: the release puts the dragged pins down.
    if (this.warpPointerUp(e)) return;

    // Direct Select: release the dragged anchor(s), handle, or path.
    if (this.anchorDragKind && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.anchorDragKind = null;
      this.handleDrag = null;
      this.anchorDragLast = null;
      this.anchorDragOrigin = null;
      this.anchorDragFrom = null;
      this.anchorDragCommitted = false;
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
      if (Math.hypot(b.x - a.x, b.y - a.y) < this.screenPx(2)) {
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
        ...this.pencilInk(this.curveTool),
        ...this.toolProfile(this.curveTool),
      };
      this.toast('Move to bend the curve, click to place it (Esc cancels).');
      this.scheduleRender();
      return;
    }

    // Smear: each mark the drag reached keeps its pass.
    if (this.smearDrag && this.activePointerId === e.pointerId) {
      const drag = this.smearDrag;
      this.smearDrag = null;
      this.commitSmear(drag);
      return;
    }

    // Shape Stacker: the pieces the press marked are merged, or taken away.
    if (this.stackDrag && this.activePointerId === e.pointerId) {
      const drag = this.stackDrag;
      this.stackDrag = null;
      this.commitStack(drag);
      return;
    }

    // Shape tools: commit the dragged rectangle / ellipse outline.
    if (this.shapeStart !== null && this.activePointerId === e.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      // The Shape Eraser's release: the shape dragged out cuts.
      const erase = this.shapeErase;
      if (erase) {
        const start = this.shapeStart;
        this.shapeErase = null;
        this.shapeStart = null;
        this.activePointerId = null;
        const end = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
        this.commitShapeErase(shapeEraserOutline(this.shapeEraserShape, start, end, e.shiftKey), erase.targets);
        return;
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
      // The end snapped where the ring shows it did; under Shift, the
      // eight-direction lock, it is where the lock put it.
      const ring = this.snapTarget;
      const endHit = ring && ring.x === b.x && ring.y === b.y ? ring : null;
      const shiftLine = this.shiftLine;
      const drawn = this.live;
      this.straightStart = null;
      this.straightEnd = null;
      this.straightRaw = null;
      this.startSnapHit = null;
      this.shiftLine = null;
      this.live = null;
      this.activePointerId = null;
      this.setSnapTarget(null);
      // Drawn on from a Shift-click line: one more straight line on its mark.
      if (shiftLine && drawn) {
        const run = [anchorAt(a), ...(Math.hypot(b.x - a.x, b.y - a.y) > 0 ? [anchorAt(b)] : [])];
        this.commitShiftLine(shiftLine, drawn, run, tool);
        return;
      }
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
        ...this.pencilInk(lineTool),
        ...this.toolProfile(lineTool),
      };
      if (this.store.tool.liveSharpen && lineTool !== 'eraser') {
        finished = sharpenStroke(finished, this.store.tool.sharpen);
      }
      this.commitWithJoin(finished, startHit, endHit);
      this.rememberLineStart(finished.id, tool);
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

      if (live && Math.abs(live.x2 - live.x1) > this.screenPx(TEXT_DRAG_THRESHOLD)) {
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
      const least = this.screenPx(2);
      if (box && (Math.abs(box.x2 - box.x1) > least || Math.abs(box.y2 - box.y1) > least)) {
        const minX = Math.min(box.x1, box.x2);
        const maxX = Math.max(box.x1, box.x2);
        const minY = Math.min(box.y1, box.y2);
        const maxY = Math.max(box.y1, box.y2);
        // Every mark whose ink the band meets, a line it only crosses included.
        const ids = marksInBox(
          this.store.sketch,
          { minX, minY, maxX, maxY },
          { editable: this.editableStrokeIds(), measure: (t) => this.surface.measureText(t) },
        ).map((s) => s.id);
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
      this.dragFrom = null;
      this.dragCommitted = false;
      // A Shift-press on a selected element that never went anywhere was a
      // click, so it means what a Shift-click has always meant.
      if (this.shiftToggleId && !this.dragMoved) {
        const ids = new Set(this.store.selectedIds);
        ids.delete(this.shiftToggleId);
        this.store.setSelection(ids);
      }
      // A press the selection kept, on an element the pointer then never left:
      // that was a click asking for that element after all.
      if (this.pendingSelectHitId && !this.dragMoved) {
        this.store.setSelection([this.pendingSelectHitId]);
      }
      this.pendingSelectHitId = null;
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
    const shiftLine = this.shiftLine;
    this.shiftLine = null;

    // Endpoint snap: pull the stroke's final point onto the nearest endpoint.
    // A Shift-click line that was only a click has no end of its own: its
    // point 2 snapped when the press went down.
    let endHit: SnapHit | null = null;
    const drew = !shiftLine || finished.points.length > shiftLine.prefix.length + 1;
    if (drew && e.shiftKey && this.snapApplies(finished.tool) && finished.points.length > 1) {
      const tail = finished.points[finished.points.length - 1];
      endHit = this.nearestEndpoint(tail);
      if (endHit) {
        finished.points[finished.points.length - 1] = { ...tail, x: endHit.x, y: endHit.y };
      }
    }
    const startHit = this.startSnapHit;
    this.startSnapHit = null;
    this.setSnapTarget(null);

    // A Shift-click line: the line to point 2, and what the press drew on
    // from there, fitted as any freehand stroke is.
    if (shiftLine) {
      this.commitShiftLine(shiftLine, finished, this.freehandRun(finished.points.slice(shiftLine.prefix.length)), tool);
      return;
    }
    if (finished.tool === 'eraser') {
      this.commitErase(finished);
      return;
    }

    if (this.store.tool.liveSharpen && !finished.sharpened) {
      finished = sharpenStroke(finished, this.store.tool.sharpen);
    } else {
      // The samples as the few Bézier anchors they draw (core/fit-curve.ts),
      // to the Freehand fidelity: what Direct Select shows and the exports
      // write, where every sample was an anchor.
      finished = fitStroke(finished, this.freehandTolerance());
    }

    this.commitWithJoin(finished, startHit, endHit);
    this.rememberLineStart(finished.id, tool);
  }

  /**
   * A press with Shift held and point 1 in hand for this tool: the
   * Shift-click line. The press point, snapped to a stroke's end in reach,
   * is point 2, and a straight line runs to it from point 1 at once - on
   * point 1's mark, or as a mark of its own when that mark is not painted as
   * the tool paints now (`shiftLineAction`). A drag goes on drawing from point
   * 2, and the release commits it all as one step. False when there is no
   * line to draw: the press snaps its start, as a Shift press always has.
   */
  private beginShiftLine(tool: Tool, pt: Point): boolean {
    const start = this.lineStart;
    if (!start) return false;
    const sketch = this.store.sketch;
    const stroke = sketch.strokes.find((s) => s.id === start.strokeId);
    const ink = this.inkOf(tool);
    const action = shiftLineAction(
      start,
      { tool, pageId: sketch.id, activeLayerId: this.store.activeLayer.id, symmetry: this.store.tool.symmetry > 1, ink },
      stroke ? { stroke, layerId: layerOf(sketch, stroke).id } : null,
    );
    if (action === 'forget') this.lineStart = null;
    if (action !== 'append' && action !== 'new') return false;
    // Point 2 snaps as a Shift press's start always has, though never onto
    // point 1 itself, which would leave no line to draw.
    const from = { x: start.x, y: start.y };
    const hit = this.snapApplies(tool) ? this.nearestEndpoint(pt, from) : null;
    this.setSnapTarget(hit);
    const to: Point = hit ? { ...pt, x: hit.x, y: hit.y } : pt;
    this.startSnapHit = null;
    const onMark = action === 'append' && stroke ? stroke : null;
    const prefix = onMark ? onMark.points.map((p) => ({ ...p })) : [{ x: from.x, y: from.y, pressure: to.pressure ?? 0.5 }];
    this.shiftLine = { markId: onMark?.id ?? null, prefix, to };
    this.live = {
      id: onMark?.id ?? createId('st'),
      ...ink,
      points: [...prefix, to],
      layer: onMark ? layerOf(sketch, onMark).id : this.store.activeLayer.id,
    };
    this.scheduleRender();
    return true;
  }

  /**
   * Commits a Shift-click line and what its press drew on from point 2 -
   * `run`, from point 2 - onto its mark as one history step, or as a mark of
   * its own from point 1. Its end is point 1 for the next.
   */
  private commitShiftLine(line: { markId: string | null; prefix: Point[] }, drawn: Stroke, run: VectorAnchor[], tool: Tool): void {
    const mark = line.markId ? this.store.sketch.strokes.find((s) => s.id === line.markId) : undefined;
    if (mark) {
      const geometry = extendWithLine(mark, run);
      this.store.pushHistory();
      this.store.setStrokeGeometry(mark.id, geometry.points, geometry.vector);
      this.rememberLineStart(mark.id, tool);
      return;
    }
    // A mark of its own - or the mark it was for went away mid-press - from
    // where the line starts.
    const geometry = extendWithLine({ points: line.prefix.slice(-1) }, run);
    const stroke: Stroke = { ...drawn, id: line.markId ? createId('st') : drawn.id, points: geometry.points };
    if (geometry.vector) stroke.vector = geometry.vector;
    else delete stroke.vector;
    const extras = this.symmetryCopies(stroke);
    this.store.addStrokes([stroke, ...extras]);
    this.rememberLineStart(stroke.id, tool);
  }

  /**
   * The marks an Eraser press cuts: every selected mark on a layer that can
   * be drawn on - a selected group's descendants are selected with it - or,
   * with nothing selected, null: every editable mark the swath touches, as
   * vector editors erase. A selection wholly on locked or hidden layers cuts
   * nothing.
   */
  private eraserTargets(): Set<string> | null {
    if (this.store.selectedMarkCount === 0) return null;
    const editable = this.editableStrokeIds();
    return new Set([...this.store.selectedIds].filter((id) => editable.has(id)));
  }

  /**
   * The Eraser's release: its swath cut out of the marks it was aimed at, as
   * geometry (`core/erase.ts`) - no eraser mark, no layer, one undo step. A
   * mark whose cut the geometry could not make keeps an eraser mark just
   * above it on its layer, as the Eraser used to paint, so the canvas shows
   * the cut all the same. Text and images are passed over, with a word.
   */
  private commitErase(eraser: Stroke): void {
    const targets = this.erasing ? this.erasing.targets : this.eraserTargets();
    this.erasing = null;
    const sketch = this.store.sketch;
    const ids = targets ? [...targets] : [...this.editableStrokeIds()];
    const result = eraseMarks(sketch, ids, eraseRegionOf(eraser));
    const legacy = [...result.raster].map((above) => ({ above, eraser: { ...eraser, id: createId('st') } }));
    this.store.eraseMarks(result, legacy);
    this.scheduleRender();
    if (result.skipped.size > 0) this.toast('Text and images are not erased: select a shape or a line to cut.');
  }

  /**
   * Sketch > Apply Erasers: every eraser mark from a file made before
   * 1.0.0-alpha.4.6.0 turned into the cut it paints - each one cut out of
   * the marks painted before it on its own layer, exactly what the canvas
   * showed, and taken away - in one undo step. Erasers on a locked or hidden
   * layer are left as they are, and so is one whose cut the geometry could
   * not make.
   */
  private applyErasers(): void {
    const sketch = this.store.sketch;
    const editable = this.editableStrokeIds();
    const working = new Map(sketch.strokes.map((s) => [s.id, s]));
    const changed = new Map<string, Stroke>();
    const removed = new Set<string>();
    let applied = 0;
    let left = 0;
    for (const [, strokes] of strokesByLayer(sketch)) {
      const before: string[] = [];
      for (const stroke of strokes) {
        if (stroke.tool !== 'eraser') {
          before.push(stroke.id);
          continue;
        }
        if (!editable.has(stroke.id)) {
          left++;
          continue;
        }
        const view: Sketch = { ...sketch, strokes: before.map((id) => working.get(id)!).filter(Boolean) };
        const result = eraseMarks(view, before, eraseRegionOf(stroke));
        for (const [id, next] of result.changed) {
          working.set(id, next);
          changed.set(id, next);
        }
        for (const id of result.removed) {
          working.delete(id);
          changed.delete(id);
          removed.add(id);
          before.splice(before.indexOf(id), 1);
        }
        if (result.raster.size > 0) {
          left++;
          continue;
        }
        removed.add(stroke.id);
        applied++;
      }
    }
    if (applied === 0) {
      this.toast(
        left > 0
          ? 'No eraser mark could be applied: they are on locked or hidden layers, or cut what the geometry could not.'
          : 'There are no eraser marks to apply.',
      );
      return;
    }
    this.store.eraseMarks({ changed, removed });
    this.toast(`Applied ${applied} eraser mark${applied === 1 ? '' : 's'}${left > 0 ? `; ${left} left as they were` : ''}.`);
  }

  /**
   * Shape Eraser (`Shift+E`, or its button): the tool in hand, and its panel
   * open beside the button to choose the shape it cuts with - or Top Path.
   */
  private chooseShapeEraser(): void {
    this.selectTool('shape-eraser');
    this.openShapeEraserPanel();
  }

  /**
   * The Shape Eraser's panel, beside its button as the Curve flyout is: the
   * four shapes as outline tiles, two by two, and Top Path across the
   * bottom. Arrows move round it, Enter or Space chooses, Escape closes it,
   * and a press anywhere else puts it away.
   */
  private openShapeEraserPanel(): void {
    this.closeToolFlyout();
    const btn = el('tool-shape-eraser');
    const panel = document.createElement('div');
    panel.className = 'tool-flyout shape-eraser-panel';
    panel.id = 'tool-flyout';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', 'Shape Eraser shapes');
    const rect = btn.getBoundingClientRect();
    const onRail = btn.closest('#side-rail') !== null;
    panel.style.left = `${Math.round(onRail ? rect.right + 4 : rect.left)}px`;
    panel.style.top = `${Math.round(onRail ? rect.top : rect.bottom + 4)}px`;
    const items: HTMLButtonElement[] = [];
    for (const shape of SHAPE_ERASER_SHAPES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'shape-tile';
      item.dataset.shape = shape.id;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(this.shapeEraserShape === shape.id));
      item.classList.toggle('is-active', this.shapeEraserShape === shape.id);
      // A fixed picture and label, no user text: safe as markup.
      item.innerHTML = `${shape.icon}<span>${shape.label}</span>`;
      item.addEventListener('click', () => {
        this.shapeEraserShape = shape.id;
        this.closeToolFlyout();
        this.updateShapeEraserTitle();
        this.toast(`Shape Eraser: drag ${withArticle(shape.label)} over the selection to cut it out.`);
      });
      panel.appendChild(item);
      items.push(item);
    }
    const top = document.createElement('button');
    top.type = 'button';
    top.className = 'top-path';
    top.dataset.shape = 'top-path';
    top.setAttribute('role', 'menuitem');
    top.textContent = 'Top Path';
    top.title = 'Cut the other selected marks with the topmost selected closed path, and take the path away';
    top.addEventListener('click', () => {
      this.closeToolFlyout();
      this.shapeEraseTopPath();
    });
    panel.appendChild(top);
    items.push(top);
    // The panel keeps its keys: the arrows would nudge the selection and
    // Enter open the Move dialog, were they let through to the window.
    panel.addEventListener('keydown', (ev) => {
      const i = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      const go = (to: number): void => items[Math.max(0, Math.min(items.length - 1, to))].focus();
      ev.stopPropagation();
      if (ev.key === 'ArrowRight') go(i + 1);
      else if (ev.key === 'ArrowLeft') go(i - 1);
      else if (ev.key === 'ArrowDown') go(i < 2 ? i + 2 : items.length - 1);
      else if (ev.key === 'ArrowUp') go(i >= 4 ? 2 : i >= 2 ? i - 2 : i);
      else if (ev.key === 'Enter' || ev.key === ' ') items[i].click();
      else if (ev.key === 'Escape') {
        this.closeToolFlyout();
        btn.focus();
      } else return;
      ev.preventDefault();
    });
    document.body.appendChild(panel);
    (items[SHAPE_ERASER_SHAPES.findIndex((s) => s.id === this.shapeEraserShape)] ?? items[0]).focus();
    window.setTimeout(() => {
      window.addEventListener(
        'pointerdown',
        (ev) => {
          if (!(ev.target instanceof Node) || !panel.contains(ev.target)) this.closeToolFlyout();
        },
        { once: true, capture: true },
      );
    });
  }

  /** Names the Shape Eraser's shape in its button's hover text. */
  private updateShapeEraserTitle(): void {
    const btn = el('tool-shape-eraser');
    const label = SHAPE_ERASER_SHAPES.find((s) => s.id === this.shapeEraserShape)?.label ?? 'Rectangle';
    btn.dataset.titleTemplate = `Shape Eraser ({key}) - drag ${withArticle(label)} to cut it out of the selected marks; press for the shapes`;
    this.applyShortcutTitle(btn);
  }

  /**
   * The Shape Eraser's release: the shape's interior cut out of the selected
   * marks, by the Eraser's rules (core/erase.ts) - one undo step, no layer.
   * The tool stays in hand and the selection stays, for the next cut.
   */
  private commitShapeErase(outline: Point[], targets: Set<string>): void {
    this.scheduleRender();
    let area = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      area += a.x * b.y - b.x * a.y;
    }
    // A click, or a drag with no breadth, is no shape to cut with.
    if (outline.length < 3 || Math.abs(area) / 2 < 1e-6) return;
    const region = [outline.map((p) => ({ x: p.x, y: p.y }))];
    const result = eraseMarks(this.store.sketch, [...targets], region);
    this.store.eraseMarks(result);
    this.reportShapeErase(result);
  }

  /**
   * Shape Eraser > Top Path: the topmost of the selected marks in paint
   * order, when it is a closed path, cuts the others and is taken away - the
   * Minus Front of vector editors' Pathfinder. A notice says why when there
   * is nothing to cut, only the one path, or a path that is open.
   * REUSE: the cut is the Eraser's - `eraseRegionOf` gives any closed mark's
   * interior as a region and `eraseMarks` cuts with it - with the cutter
   * added to what is removed.
   */
  private shapeEraseTopPath(): void {
    const editable = this.editableStrokeIds();
    const selected = paintOrder(this.store.sketch, this.layerPaints()).filter(
      (s) => this.store.selectedIds.has(s.id) && editable.has(s.id) && s.tool !== 'eraser',
    );
    if (selected.length === 0) {
      this.notices.show(SHAPE_ERASER_NOTICES.noSelection);
      return;
    }
    if (selected.length === 1) {
      this.notices.show(SHAPE_ERASER_NOTICES.onePath);
      return;
    }
    const cutter = selected[selected.length - 1];
    const closed = eraseKind(cutter) !== 'skip' && (cutter.vector?.closed === true || isClosedStroke(cutter));
    if (!closed) {
      this.notices.show(SHAPE_ERASER_NOTICES.openPath);
      return;
    }
    const others = selected.slice(0, -1).map((s) => s.id);
    const result = eraseMarks(this.store.sketch, others, eraseRegionOf(cutter));
    result.removed.add(cutter.id);
    this.recordAs('tool:shape-eraser', () => this.store.eraseMarks(result));
    this.scheduleRender();
    this.reportShapeErase(result);
  }

  /**
   * The Pencil (`N`, or its button): the tool in hand. Its button opens the
   * drawing kit as well; so does `N` pressed again with the Pencil already in
   * hand, so a key never puts a panel in the way of drawing.
   */
  private choosePencil(): void {
    const held = this.store.tool.tool === 'pencil';
    this.selectTool('pencil');
    if (held && !document.querySelector('.pencil-kit')) this.openPencilKit();
  }

  /**
   * The Pencil's drawing kit, beside its button as the Shape Eraser's panel
   * is: a row of chips for each medium - graphite 4H to 8B, the charcoal
   * pencils, vine and compressed charcoal - each drawing a short line with
   * its own lead, through the paper's grain, the way it draws on the page.
   * Arrows move round it, Enter or Space chooses, Escape closes it, and a
   * press anywhere else puts it away.
   */
  private openPencilKit(): void {
    this.closeToolFlyout();
    const btn = el('tool-pencil');
    const panel = document.createElement('div');
    panel.className = 'tool-flyout pencil-kit';
    panel.id = 'tool-flyout';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', 'Drawing kit');
    const rect = btn.getBoundingClientRect();
    const onRail = btn.closest('#side-rail') !== null;
    panel.style.left = Math.round(onRail ? rect.right + 4 : rect.left) + 'px';
    panel.style.top = Math.round(onRail ? rect.top : rect.bottom + 4) + 'px';
    const rows: HTMLButtonElement[][] = [];
    const current = this.store.tool.pencil;
    for (const medium of PENCIL_KIT) {
      const heading = document.createElement('p');
      heading.className = 'pencil-kit-medium';
      heading.textContent = medium.label;
      panel.appendChild(heading);
      const row = document.createElement('div');
      row.className = 'pencil-kit-row';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', medium.label);
      const chips: HTMLButtonElement[] = [];
      for (const grade of medium.grades) {
        const choice: PencilChoice = { medium: medium.medium, grade };
        const paint = pencilGrade(choice);
        if (!paint) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pencil-chip';
        chip.dataset.pencil = paint.name;
        chip.title = paint.label;
        chip.setAttribute('role', 'menuitemradio');
        const on = samePencil(choice, current);
        chip.setAttribute('aria-checked', String(on));
        chip.classList.toggle('is-active', on);
        chip.appendChild(this.pencilSample(choice));
        const label = document.createElement('span');
        label.textContent = grade;
        chip.appendChild(label);
        chip.addEventListener('click', () => {
          this.store.setTool({ pencil: { medium: paint.medium, grade: paint.grade } });
          this.closeToolFlyout();
          this.updatePencilTitle();
          this.updateCursor();
          this.toast(`Pencil: ${paint.label}.`);
        });
        row.appendChild(chip);
        chips.push(chip);
      }
      panel.appendChild(row);
      rows.push(chips);
    }
    const items = rows.flat();
    // The kit keeps its keys, as the Shape Eraser's panel does.
    panel.addEventListener('keydown', (ev) => {
      const at = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      const r = rows.findIndex((row) => row.includes(items[at]));
      const c = rows[r].indexOf(items[at]);
      const to = (row: number): void => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, row))];
        next[Math.min(next.length - 1, c)].focus();
      };
      ev.stopPropagation();
      if (ev.key === 'ArrowRight') items[Math.min(items.length - 1, at + 1)].focus();
      else if (ev.key === 'ArrowLeft') items[Math.max(0, at - 1)].focus();
      else if (ev.key === 'ArrowDown') to(r + 1);
      else if (ev.key === 'ArrowUp') to(r - 1);
      else if (ev.key === 'Enter' || ev.key === ' ') items[at].click();
      else if (ev.key === 'Escape') {
        this.closeToolFlyout();
        btn.focus();
      } else return;
      ev.preventDefault();
    });
    document.body.appendChild(panel);
    (items.find((chip) => chip.classList.contains('is-active')) ?? items[0])?.focus();
    window.setTimeout(() => {
      window.addEventListener(
        'pointerdown',
        (ev) => {
          if (!(ev.target instanceof Node) || !panel.contains(ev.target)) this.closeToolFlyout();
        },
        { once: true, capture: true },
      );
    });
  }

  /** A chip's picture: a short line drawn with `choice`'s lead, through the paper's grain, at the screen's pixel ratio. */
  private pencilSample(choice: PencilChoice): HTMLCanvasElement {
    const css = { w: 40, h: 14 };
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'pencil-sample';
    canvas.width = Math.round(css.w * dpr);
    canvas.height = Math.round(css.h * dpr);
    canvas.style.width = css.w + 'px';
    canvas.style.height = css.h + 'px';
    const paint = pencilPaint(choice);
    const points: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const t = i / 36;
      points.push({ x: 4 + t * 32, y: 7 + 3 * Math.sin(t * Math.PI * 2), pressure: 0.35 + 0.5 * Math.sin(t * Math.PI) });
    }
    const sample: Stroke = { id: 'sample', tool: 'pencil', color: paint.tone, width: Math.min(6, pencilWidth(3, choice)), points, pencil: choice };
    const region = pencilRegion(sample, dpr);
    const ctx = canvas.getContext('2d');
    if (region && ctx) {
      const data = rasterizePencil(sample, region);
      const art = document.createElement('canvas');
      art.width = region.width;
      art.height = region.height;
      art.getContext('2d')?.putImageData(new ImageData(data, region.width, region.height), 0, 0);
      ctx.drawImage(art, region.x, region.y);
    }
    return canvas;
  }

  /** Names the pencil in hand in the Pencil button's hover text. */
  private updatePencilTitle(): void {
    const btn = el('tool-pencil');
    btn.dataset.titleTemplate = `Pencil ({key}) - ${pencilPaint(this.store.tool.pencil).label}; press for the drawing kit`;
    this.applyShortcutTitle(btn);
  }

  /**
   * The Shape Stacker (`Shift+M`, or its button): the tool in hand, and its
   * panel open beside the button - the Wipe Stacks as tiles.
   */
  private chooseShapeStacker(): void {
    this.selectTool('shape-stacker');
    this.stackerDirty = true;
    this.openShapeStackerPanel();
  }

  /**
   * The Shape Stacker's panel, beside its button as the Shape Eraser's is:
   * the six Wipe Stacks as tiles, three by two, each running its row on the
   * selection, greyed with fewer than two shapes selected - a click then
   * says why - and a line on stacking. Arrows move round it, Enter or Space
   * chooses, Escape closes it, and a press anywhere else puts it away.
   */
  private openShapeStackerPanel(): void {
    this.closeToolFlyout();
    const btn = el('tool-shape-stacker');
    const panel = document.createElement('div');
    panel.className = 'tool-flyout shape-stacker-panel';
    panel.id = 'tool-flyout';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', 'Wipe Stacks');
    const rect = btn.getBoundingClientRect();
    const onRail = btn.closest('#side-rail') !== null;
    panel.style.left = Math.round(onRail ? rect.right + 4 : rect.left) + 'px';
    panel.style.top = Math.round(onRail ? rect.top : rect.bottom + 4) + 'px';
    const few = this.wipeableSelection().length < 2;
    const items: HTMLButtonElement[] = [];
    for (const tile of STACKER_TILES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'shape-tile';
      item.dataset.command = tile.command;
      item.setAttribute('role', 'menuitem');
      item.title = tile.title;
      if (few) {
        item.classList.add('is-disabled');
        item.setAttribute('aria-disabled', 'true');
      }
      // A fixed picture and label, no user text: safe as markup.
      item.innerHTML = tile.icon + '<span>' + tile.label + '</span>';
      item.addEventListener('click', () => {
        this.closeToolFlyout();
        this.runCommand(tile.command);
      });
      panel.appendChild(item);
      items.push(item);
    }
    const hint = document.createElement('p');
    hint.className = 'stacker-hint';
    hint.textContent = 'On the canvas: drag across the pieces to merge them, Alt to take them away, Shift to drag a box.';
    panel.appendChild(hint);
    // The panel keeps its keys, as the Shape Eraser's does.
    panel.addEventListener('keydown', (ev) => {
      const i = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      const go = (to: number): void => items[Math.max(0, Math.min(items.length - 1, to))].focus();
      ev.stopPropagation();
      if (ev.key === 'ArrowRight') go(i + 1);
      else if (ev.key === 'ArrowLeft') go(i - 1);
      else if (ev.key === 'ArrowDown') go(i + 3);
      else if (ev.key === 'ArrowUp') go(i - 3);
      else if (ev.key === 'Enter' || ev.key === ' ') items[i].click();
      else if (ev.key === 'Escape') {
        this.closeToolFlyout();
        btn.focus();
      } else return;
      ev.preventDefault();
    });
    document.body.appendChild(panel);
    items[0].focus();
    window.setTimeout(() => {
      window.addEventListener(
        'pointerdown',
        (ev) => {
          if (!(ev.target instanceof Node) || !panel.contains(ev.target)) this.closeToolFlyout();
        },
        { once: true, capture: true },
      );
    });
  }

  /** The selection's pieces for the Shape Stacker, worked out again when the page or the selection has changed. */
  private stackerFaces(): StackArrangement {
    if (this.stackerDirty || !this.stacker) {
      const editable = this.editableStrokeIds();
      const ids = this.store.sketch.strokes.filter((st) => this.store.selectedIds.has(st.id) && editable.has(st.id)).map((st) => st.id);
      this.stacker = stackArrangement(this.store.sketch, ids);
      this.stackerDirty = false;
      this.stackerHover = -1;
    }
    return this.stacker;
  }

  /**
   * The Shape Stacker's pointer: with no press, the piece under it shaded;
   * in a press, each piece the path reaches marked in order, or with a box
   * every piece it touches - the one it began on first.
   */
  private stackerPointerMove(e: PointerEvent): void {
    const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
    const drag = this.stackDrag;
    if (drag) {
      if (this.activePointerId !== e.pointerId) return;
      const arrangement = this.stackerFaces();
      drag.end = pt;
      if (drag.box) {
        // The piece the box began on comes first, so its mark paints the
        // merge; from bare paper, a piece of the topmost mark the box touches.
        const touched = facesInBox(arrangement, boxOf(drag.start, pt));
        const first = faceAt(arrangement, drag.start);
        const top = (i: number): number => Math.max(...arrangement.faces[i].covers);
        drag.marked =
          first >= 0 && touched.includes(first)
            ? [first, ...touched.filter((i) => i !== first)]
            : [...touched].sort((i, j) => top(j) - top(i));
      } else {
        for (const face of facesAlong(arrangement, [drag.path[drag.path.length - 1], pt])) {
          if (!drag.marked.includes(face)) drag.marked.push(face);
        }
        drag.path.push(pt);
      }
      this.scheduleRender();
      return;
    }
    if (this.press) return;
    const hover = faceAt(this.stackerFaces(), pt);
    if (hover !== this.stackerHover) {
      this.stackerHover = hover;
      this.scheduleRender();
    }
  }

  /**
   * The Shape Stacker's release: the pieces its press marked merged into one
   * shape - painted as the topmost mark where the press began, and each mark
   * keeping what was not merged - or taken away from every mark, in one undo
   * step. The tool stays in hand, and what the stack made or changed stays
   * selected with the rest, for the next stack.
   */
  /** The Smear's drag goes on: its new points, and the marks they reach. */
  private smearPointerMove(e: PointerEvent): void {
    const drag = this.smearDrag;
    if (!drag || this.activePointerId !== e.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0 ? e.getCoalescedEvents() : [e];
    // A sample every three quarters of a screen pixel, as a freehand stroke takes them.
    const spacing = this.screenPx(0.75);
    const added: Point[] = [];
    for (const ev of events) {
      const p = this.surface.toSketchPoint(ev.clientX, ev.clientY, ev.pressure);
      const last = drag.points[drag.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= spacing) {
        drag.points.push(p);
        added.push(p);
      }
    }
    if (added.length === 0) return;
    this.smearReach(added);
    this.scheduleRender();
  }

  /** The marks the Smear's new points reach: a Pencil mark is smeared from there on, any other noted, and left alone. */
  private smearReach(points: readonly Point[]): void {
    const drag = this.smearDrag;
    if (!drag) return;
    const half = drag.width / 2;
    for (const { stroke, box } of drag.candidates) {
      const pencil = stroke.tool === 'pencil';
      if (pencil ? drag.reached.has(stroke.id) : drag.others) continue;
      const reach = half + stroke.width / 2;
      const near = points.filter((p) => p.x >= box.minX - reach && p.x <= box.maxX + reach && p.y >= box.minY - reach && p.y <= box.maxY + reach);
      if (near.length === 0) continue;
      if (pencil) {
        if (smearReaches(stroke, near, drag.width)) drag.reached.add(stroke.id);
      } else if (isTextStroke(stroke) || isImageStroke(stroke) || smearReaches(stroke, near, drag.width)) {
        drag.others = true;
      }
    }
  }

  /**
   * The Smear's release: each Pencil mark the drag reached keeps its pass -
   * the part of the drag from where it reached the mark to as far as it
   * carried graphite past it, fitted to the Freehand fidelity - in one undo
   * step. No mark and no layer is added. A drag over other marks leaves them
   * alone, and says so once a session.
   */
  private commitSmear(drag: NonNullable<App['smearDrag']>): void {
    this.scheduleRender();
    const changed = new Map<string, Stroke>();
    const tolerance = this.freehandTolerance();
    for (const stroke of this.store.sketch.strokes) {
      if (!drag.reached.has(stroke.id)) continue;
      const pass = smudgeFor(stroke, drag.points, drag.width, drag.strength, tolerance);
      if (pass) changed.set(stroke.id, { ...stroke, smudges: [...(stroke.smudges ?? []), pass] });
    }
    if (changed.size > 0) this.store.applyMarkEdit({ changed, removed: new Set(), added: [] }, { select: 'keep' });
    if (drag.others && !this.smearSaid) {
      this.smearSaid = true;
      this.toast("Smear blends pencil marks; Liquify's Warp pushes the others.");
    }
  }

  // ---- Liquify (core/liquify.ts) ----------------------------------------------------

  /**
   * Liquify (`Shift+R`, or its button): the tool in hand, and its panel open
   * beside the button to choose the brush - Warp, Twirl, Pucker or Bloat.
   */
  private chooseLiquify(): void {
    this.selectTool('liquify');
    this.openLiquifyPanel();
  }

  /**
   * Liquify's panel, beside its button as the Shape Eraser's is: the four
   * brushes as tiles, two by two, each a picture of what it does. Arrows move
   * round it, Enter or Space chooses, Escape closes it, and a press anywhere
   * else puts it away.
   */
  private openLiquifyPanel(): void {
    this.closeToolFlyout();
    const btn = el('tool-liquify');
    const panel = document.createElement('div');
    // REUSE: the Shape Eraser's panel - its tiles, its place and its keys.
    panel.className = 'tool-flyout shape-eraser-panel liquify-panel';
    panel.id = 'tool-flyout';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', 'Liquify brushes');
    const rect = btn.getBoundingClientRect();
    const onRail = btn.closest('#side-rail') !== null;
    panel.style.left = `${Math.round(onRail ? rect.right + 4 : rect.left)}px`;
    panel.style.top = `${Math.round(onRail ? rect.top : rect.bottom + 4)}px`;
    const items: HTMLButtonElement[] = [];
    for (const mode of LIQUIFY_MODES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'shape-tile';
      item.dataset.liquify = mode.id;
      item.title = `${mode.label} ${mode.summary}`;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(this.liquifyMode === mode.id));
      item.classList.toggle('is-active', this.liquifyMode === mode.id);
      // A fixed picture and label, no user text: safe as markup.
      item.innerHTML = `${LIQUIFY_TILES[mode.id]}<span>${mode.label}</span>`;
      item.addEventListener('click', () => {
        this.liquifyMode = mode.id;
        this.closeToolFlyout();
        this.updateLiquifyTitle();
        this.toast(`Liquify: ${mode.label} ${mode.summary}.`);
      });
      panel.appendChild(item);
      items.push(item);
    }
    // The panel keeps its keys: the arrows would nudge the selection and
    // Enter open the Move dialog, were they let through to the window.
    panel.addEventListener('keydown', (ev) => {
      const i = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      const go = (to: number): void => items[Math.max(0, Math.min(items.length - 1, to))].focus();
      ev.stopPropagation();
      if (ev.key === 'ArrowRight') go(i + 1);
      else if (ev.key === 'ArrowLeft') go(i - 1);
      else if (ev.key === 'ArrowDown') go(i < 2 ? i + 2 : i);
      else if (ev.key === 'ArrowUp') go(i >= 2 ? i - 2 : i);
      else if (ev.key === 'Enter' || ev.key === ' ') items[i].click();
      else if (ev.key === 'Escape') {
        this.closeToolFlyout();
        btn.focus();
      } else return;
      ev.preventDefault();
    });
    document.body.appendChild(panel);
    (items[LIQUIFY_MODES.findIndex((m) => m.id === this.liquifyMode)] ?? items[0]).focus();
    window.setTimeout(() => {
      window.addEventListener(
        'pointerdown',
        (ev) => {
          if (!(ev.target instanceof Node) || !panel.contains(ev.target)) this.closeToolFlyout();
        },
        { once: true, capture: true },
      );
    });
  }

  /** Names the Liquify brush in hand in its button's hover text. */
  private updateLiquifyTitle(): void {
    const btn = el('tool-liquify');
    const mode = LIQUIFY_MODES.find((m) => m.id === this.liquifyMode) ?? LIQUIFY_MODES[0];
    btn.dataset.titleTemplate = `Liquify ({key}) - ${mode.label} ${mode.summary}. Alt-drag, or [ and ], sizes the brush; press for the four`;
    this.applyShortcutTitle(btn);
  }

  /**
   * Where the Liquify brush is drawn: round an Alt-drag's centre while it
   * sizes the brush, where a drag has taken it, and otherwise at the pointer
   * while Liquify is in hand and the pointer is over the canvas.
   */
  private liquifyBrush(): Overlay['liquifyBrush'] | null {
    const drag = this.liquifyDrag;
    if (drag?.kind === 'size') return { x: drag.center.x, y: drag.center.y, radius: this.liquifyRadius };
    if (drag?.kind === 'bend') return { x: drag.at.x, y: drag.at.y, radius: this.liquifyRadius };
    const at = this.lastCanvasPoint;
    if (this.store.tool.tool !== 'liquify' || !this.pointerOverCanvas || !at) return null;
    return { x: at.x, y: at.y, radius: this.liquifyRadius };
  }

  /**
   * A press with Liquify. With Alt it sizes the brush, as in a vector editor:
   * the brush stays where the press went down and its rim follows the
   * pointer. Otherwise the drag bends what the brush passes over - the
   * selected marks, or with none selected every editable one, as the Eraser
   * chooses - and Twirl, Pucker and Bloat keep working while it is held.
   */
  private liquifyPointerDown(e: PointerEvent, pt: Point): void {
    this.claimPointer(e, 'liquify');
    if (e.altKey) {
      this.liquifyDrag = { kind: 'size', center: pt, from: this.liquifyRadius, moved: false };
      this.scheduleRender();
      return;
    }
    const targets = this.eraserTargets();
    const editable = this.editableStrokeIds();
    const candidates = new Set(
      this.store.sketch.strokes.filter((s) => editable.has(s.id) && (targets === null || targets.has(s.id))).map((s) => s.id),
    );
    const drag: NonNullable<App['liquifyDrag']> = {
      kind: 'bend',
      mode: this.liquifyMode,
      candidates,
      bent: new Set(),
      at: pt,
      pressure: liquifyPressure(e),
      last: performance.now(),
      frame: null,
      open: false,
      pencils: false,
    };
    this.liquifyDrag = drag;
    if (drag.mode !== 'warp') drag.frame = requestAnimationFrame(this.liquifyTick);
    this.scheduleRender();
  }

  /** The pointer moving with Liquify in hand: the brush follows it, an Alt-drag sizes the brush, and a Warp pushes along the move. */
  private liquifyPointerMove(e: PointerEvent): void {
    const drag = this.liquifyDrag;
    if (!drag || this.activePointerId !== e.pointerId) {
      this.scheduleRender();
      return;
    }
    const pt = this.surface.toSketchPoint(e.clientX, e.clientY, e.pressure);
    if (drag.kind === 'size') {
      const radius = Math.hypot(pt.x - drag.center.x, pt.y - drag.center.y);
      // A few screen pixels off the centre before it sizes, so an Alt-click leaves the brush as it was.
      if (!drag.moved && radius < this.screenPx(3)) return;
      drag.moved = true;
      this.liquifyRadius = clampLiquifyRadius(radius);
      this.scheduleRender();
      return;
    }
    drag.pressure = liquifyPressure(e);
    if (drag.mode === 'warp') {
      // A push as far as the brush moved, less under a light pen: never more,
      // so what is under the brush's centre goes with it and no further.
      const share = Math.min(1, Math.max(0.2, drag.pressure / 0.5));
      const events = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0 ? e.getCoalescedEvents() : [e];
      const dabs: LiquifyDab[] = [];
      for (const ev of events) {
        const p = this.surface.toSketchPoint(ev.clientX, ev.clientY, ev.pressure);
        const dx = p.x - drag.at.x;
        const dy = p.y - drag.at.y;
        if (dx === 0 && dy === 0) continue;
        dabs.push({ mode: 'warp', x: drag.at.x, y: drag.at.y, radius: this.liquifyRadius, dx: dx * share, dy: dy * share });
        drag.at = p;
      }
      this.liquifyApply(dabs);
    } else {
      drag.at = pt;
    }
    this.scheduleRender();
  }

  /**
   * A frame of a held Twirl, Pucker or Bloat: the brush works where it is, at
   * a rate a second that the press's pressure scales - a mouse's at the rate
   * itself, a pen pressed hard at twice it.
   */
  private readonly liquifyTick = (now: number): void => {
    const drag = this.liquifyDrag;
    if (!drag || drag.kind !== 'bend' || drag.mode === 'warp') return;
    const dt = Math.min(0.05, Math.max(0, (now - drag.last) / 1000));
    drag.last = now;
    const scale = Math.min(2, Math.max(0.2, drag.pressure / 0.5));
    const rate = drag.mode === 'twirl' ? LIQUIFY_TWIRL_RATE : LIQUIFY_SWELL_RATE;
    if (dt > 0) this.liquifyApply([{ mode: drag.mode, x: drag.at.x, y: drag.at.y, radius: this.liquifyRadius, amount: rate * dt * scale }]);
    drag.frame = requestAnimationFrame(this.liquifyTick);
  };

  /**
   * Bends what the dabs reach of the press's marks, live. The first bend
   * opens the store transaction that keeps the drag as one undo step, or
   * throws it away whole.
   */
  private liquifyApply(dabs: LiquifyDab[]): void {
    const drag = this.liquifyDrag;
    if (!drag || drag.kind !== 'bend' || dabs.length === 0) return;
    const marks = this.store.sketch.strokes.filter((s) => drag.candidates.has(s.id));
    if (!drag.pencils) drag.pencils = marks.some((s) => s.tool === 'pencil' && dabs.some((dab) => liquifyReaches(s, dab)));
    const bent = liquifyMarks(marks, dabs, { tolerance: this.screenPx(LIQUIFY_TOLERANCE_PX) });
    if (bent.size === 0) return;
    if (!drag.open) {
      drag.open = true;
      this.store.beginTransaction(() => this.onLiquifySettled());
    }
    this.store.setStrokesGeometry(
      [...bent.values()].map((s) => ({ id: s.id, points: s.points, vector: s.vector, ...(s.nibAngle !== undefined ? { nibAngle: s.nibAngle } : {}) })),
    );
    for (const id of bent.keys()) drag.bent.add(id);
  }

  /**
   * Liquify's release. A bend: each mark the drag bent is fitted again at the
   * Freehand fidelity, so the anchors its splits added do not stay, and the
   * drag is kept as one undo step, the selection as it was. A drag over
   * pencil marks, which Liquify leaves to the Smear, says so once a session.
   * An Alt-drag: the brush keeps the size it was given, and says it.
   */
  private finishLiquify(): void {
    const drag = this.liquifyDrag;
    this.liquifyDrag = null;
    this.scheduleRender();
    if (!drag) return;
    if (drag.kind === 'size') {
      if (drag.moved) this.toast(`Liquify: a brush ${Math.round(this.liquifyRadius * 2)}px across.`);
      return;
    }
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    if (drag.open) {
      const tolerance = this.freehandTolerance();
      const refits: Array<{ id: string; points: Point[]; vector?: Stroke['vector'] }> = [];
      for (const stroke of this.store.sketch.strokes) {
        if (!drag.bent.has(stroke.id)) continue;
        const refit = refitLiquified(stroke, tolerance, this.store.strokeBeforeTransaction(stroke.id));
        if (refit !== stroke) refits.push({ id: stroke.id, points: refit.points, vector: refit.vector });
      }
      if (refits.length > 0) this.store.setStrokesGeometry(refits);
      this.store.commitTransaction();
    }
    if (drag.pencils && !this.liquifySaid) {
      this.liquifySaid = true;
      this.toast("Liquify bends every mark but a pencil's: the Smear blends those.");
    }
  }

  /**
   * A Liquify press dropped - Escape, or a second finger: the drag is undone as
   * if it had never begun, and an Alt-drag puts the brush back as it was.
   */
  private abandonLiquify(): void {
    const drag = this.liquifyDrag;
    this.liquifyDrag = null;
    if (!drag) return;
    if (drag.kind === 'size') {
      this.liquifyRadius = drag.from;
      return;
    }
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    if (drag.open) this.store.rollbackTransaction();
  }

  /** Something else kept the drag's transaction - an undo, a page turned: what is bent so far stays, and the next bend opens another. */
  private onLiquifySettled(): void {
    const drag = this.liquifyDrag;
    if (drag?.kind !== 'bend') return;
    drag.open = false;
    drag.bent.clear();
  }

  /** `[` and `]` with Liquify in hand: the brush a step smaller or larger, drawn where the pointer is. */
  private sizeLiquify(factor: number): void {
    this.liquifyRadius = clampLiquifyRadius(this.liquifyRadius * factor);
    this.toast(`Liquify: a brush ${Math.round(this.liquifyRadius * 2)}px across.`);
    this.scheduleRender();
  }

  private commitStack(drag: { remove: boolean; marked: number[] }): void {
    this.scheduleRender();
    if (drag.marked.length === 0) return;
    const result = stackEdit(this.store.sketch, this.stackerFaces(), drag.marked, drag.remove ? 'remove' : 'merge');
    if (result.problem) {
      this.toast('These pieces could not be stacked: try fewer, or simpler shapes.');
      return;
    }
    this.store.applyMarkEdit(result, { select: 'keep' });
    if (result.empty) this.toast('The stack took every piece away.');
  }

  /** What the Shape Stacker shades: the piece under the pointer, or what a press has marked and its path or box. */
  private stackerOverlay(): Overlay['stack'] | null {
    const drag = this.stackDrag;
    if (!drag && (this.store.tool.tool !== 'shape-stacker' || this.stackerDirty || this.stackerHover < 0 || !this.pointerOverCanvas)) return null;
    const arrangement = this.stacker;
    if (!arrangement || arrangement.problem) return null;
    if (drag) {
      return {
        marked: drag.marked.map((i) => arrangement.faces[i].contours),
        path: drag.box ? undefined : drag.path,
        box: drag.box ? boxOf(drag.start, drag.end) : undefined,
        remove: drag.remove,
      };
    }
    const hover = arrangement.faces[this.stackerHover];
    return hover ? { hover: hover.contours, remove: this.altDown } : null;
  }

  /**
   * The path a Split click at `pt` would cut, and where: the topmost whose
   * centreline is within the Direct Select sensitivity - S's reach - and on
   * an anchor when it is within half of that, so a cut there adds none.
   */
  private splitTargetAt(pt: Point): { stroke: Stroke; at: SplitPoint } | null {
    const reach = this.vectorGrab();
    return splitTarget(paintOrder(this.store.sketch, this.layerPaints()), pt, reach, {
      editable: this.editableStrokeIds(),
      anchorReach: reach / 2,
    });
  }

  /** Rings the place a Split click would cut, or takes the ring away. */
  private updateSplitHover(pt: Point): void {
    const target = this.splitTargetAt(pt);
    if (!target && !this.splitHover) return;
    this.splitHover = target ? { strokeId: target.stroke.id, at: target.at } : null;
    this.scheduleRender();
  }

  /**
   * Split's click, as a vector editor's Scissors: the path cut where the
   * click lands on it (core/split.ts), and nothing moves - an open path in
   * two, the second piece on a layer of its own just above; a closed one
   * opened there, to be divided by a second cut; a compound shape's ring cut
   * out, open, as a mark of its own. One undo step, the pieces selected, and
   * the tool stays in hand.
   */
  private splitAt(pt: Point): void {
    const target = this.splitTargetAt(pt);
    if (!target) {
      // Text, a picture, or an older file's eraser mark under the click: nothing a split can cut.
      const under = this.hitTest(pt);
      const reach = this.vectorGrab();
      const eraser = this.store.sketch.strokes.some((s) => {
        if (s.tool !== 'eraser') return false;
        const box = strokeBounds(s, (t) => this.surface.measureText(t));
        return !!box && pt.x >= box.minX - reach && pt.x <= box.maxX + reach && pt.y >= box.minY - reach && pt.y <= box.maxY + reach;
      });
      if ((under && !isSplittable(under)) || eraser) this.toast('Split cuts paths and lines.');
      return;
    }
    const pieces = splitMark(target.stroke, target.at);
    if (!pieces) {
      this.toast('That is the end of the path: there is nothing there to cut.');
      return;
    }
    this.store.applyMarkEdit({
      changed: new Map([[target.stroke.id, pieces.first]]),
      removed: new Set(),
      added: pieces.second ? [{ stroke: pieces.second, above: layerOf(this.store.sketch, target.stroke).id }] : [],
    });
    this.splitHover = null;
    this.scheduleRender();
  }

  /**
   * Layers > Clipping Mask > Make (`Ctrl+7`): the topmost selected mark, when
   * it is closed, clips the rest - their layers grouped into a Clip Group, the
   * clip on top inside it, one undo step (core/clip.ts) - or a notice says why
   * not: one mark selected, or an open path on top.
   */
  private makeClipMask(): void {
    const editable = this.editableStrokeIds();
    const problem = this.store.makeClipping([...this.store.selectedIds].filter((id) => editable.has(id)));
    if (problem === 'too-few') this.notices.show(CLIP_NOTICES.onePath);
    else if (problem === 'open') this.notices.show(CLIP_NOTICES.openPath);
    this.scheduleRender();
  }

  /**
   * The clip group Release would act on: the one round the first selected
   * mark, or a selected layer row, or the active layer - or null.
   */
  private releaseTarget(): Layer | null {
    const sketch = this.store.sketch;
    for (const stroke of sketch.strokes) {
      if (!this.store.selectedIds.has(stroke.id)) continue;
      const group = releaseClip(sketch, layerOf(sketch, stroke).id);
      if (group) return group;
    }
    for (const id of this.store.selectedLayerIds) {
      const group = releaseClip(sketch, id);
      if (group) return group;
    }
    return releaseClip(sketch, this.store.activeLayer.id);
  }

  /**
   * Layers > Clipping Mask > Release (`Ctrl+Alt+7`): the clip taken off a clip
   * group or anything in it. The group stays a group, and its clip mark
   * paints again. One undo step.
   */
  private releaseClipMask(): void {
    const group = this.releaseTarget();
    if (!group || !this.store.releaseClipping(group.id)) {
      this.toast('There is no clipping mask here to release.');
      return;
    }
    this.scheduleRender();
  }

  /** The selected marks a wipe can take, on layers that can be drawn on. */
  private wipeableSelection(): Stroke[] {
    const editable = this.editableStrokeIds();
    return this.store.sketch.strokes.filter((s) => this.store.selectedIds.has(s.id) && editable.has(s.id) && isWipeable(s));
  }

  /**
   * A Wipe Stacks row (core/wipe.ts): the selected shapes wiped and the
   * result made one undo step at once - the history, the selection and the
   * layers right before anything moves - and then a napkin wiped over them,
   * the picture from before ahead of it and the result behind.
   */
  private runWipe(op: WipeOp): void {
    // Every selected mark goes in: the wipe takes the shapes, and passes over
    // the rest - text, pictures - so the toast can say it did.
    const editable = this.editableStrokeIds();
    const selected = this.store.sketch.strokes.filter((s) => this.store.selectedIds.has(s.id) && editable.has(s.id));
    const shapes = selected.filter(isWipeable);
    const result = wipeMarks(this.store.sketch, selected.map((s) => s.id), op);
    if (result.problem === 'too-few') {
      this.toast('Select two or more shapes to wipe: text and pictures are passed over.');
      return;
    }
    if (result.problem === 'too-many') {
      this.toast(`The Wipe Stacks take up to ${WIPE_OPERAND_LIMIT} shapes and a few hundred pieces: select fewer.`);
      return;
    }
    if (result.problem === 'failed') {
      this.toast('These shapes could not be combined: try fewer, or simpler ones.');
      return;
    }
    // The picture over the shapes, taken before the page changes.
    const box = shapes.reduce<{ minX: number; minY: number; maxX: number; maxY: number } | null>((acc, s) => {
      const b = strokeBounds(s, (t) => this.surface.measureText(t));
      if (!b) return acc;
      const reach = s.width / 2;
      const grown = { minX: b.minX - reach, minY: b.minY - reach, maxX: b.maxX + reach, maxY: b.maxY + reach };
      return acc ? { minX: Math.min(acc.minX, grown.minX), minY: Math.min(acc.minY, grown.minY), maxX: Math.max(acc.maxX, grown.maxX), maxY: Math.max(acc.maxY, grown.maxY) } : grown;
    }, null);
    const snapshot = box && this.settings.wipeAnimation && !prefersReducedMotion() ? this.surface.snapshot(box) : null;
    this.endWipe();
    this.store.applyMarkEdit(result);
    const made = result.changed.size + result.added.length;
    this.toast(
      result.empty
        ? 'The wipe left nothing: the shapes had nothing it keeps.'
        : `${made} ${made === 1 ? 'shape' : 'shapes'} left${result.skipped.size > 0 ? '; text and pictures passed over' : ''}.`,
    );
    if (snapshot) this.startWipe(snapshot);
    this.scheduleRender();
  }

  /** How long a wipe's napkin takes to cross, in milliseconds. */
  private static readonly WIPE_MS = 250;

  /** Starts the napkin across a snapshot, a frame at a time, until it is past. */
  private startWipe(snapshot: WipeSnapshot): void {
    const anim = { snapshot, start: performance.now(), t: 0, frame: 0 };
    const step = (now: number): void => {
      if (this.wipeAnim !== anim) return;
      anim.t = Math.min(1, (now - anim.start) / App.WIPE_MS);
      if (anim.t >= 1) {
        this.wipeAnim = null;
      } else {
        anim.frame = requestAnimationFrame(step);
      }
      this.scheduleRender();
    };
    this.wipeAnim = anim;
    anim.frame = requestAnimationFrame(step);
    this.scheduleRender();
  }

  /** Ends a wipe under way at once, leaving the result showing. */
  private endWipe(): void {
    if (!this.wipeAnim) return;
    cancelAnimationFrame(this.wipeAnim.frame);
    this.wipeAnim = null;
    this.scheduleRender();
  }

  /** Says what a Shape Eraser cut passed over, when it passed over anything. */
  private reportShapeErase(result: { skipped: Set<string>; raster: Set<string> }): void {
    if (result.raster.size > 0) {
      this.toast(`${result.raster.size} mark${result.raster.size === 1 ? '' : 's'} could not be cut here: try a smaller shape.`);
    } else if (result.skipped.size > 0) {
      this.toast('Text and images are not erased: select a shape or a line to cut.');
    }
  }

  /** A Shift-click line's freehand run, from point 2, as anchors: fitted as any freehand stroke is, or point 2 alone for a click. */
  private freehandRun(run: Point[]): VectorAnchor[] {
    if (run.length < 2) return run.slice(0, 1).map(anchorAt);
    return fitCurve(run, { tolerance: this.freehandTolerance() }) ?? run.map(anchorAt);
  }

  /** Point 1 for the next Shift-click line: the end of the mark just committed with freehand ink in hand, as the store holds it. */
  private rememberLineStart(strokeId: string, tool: Tool): void {
    if (!drawsLines(tool)) return;
    const mark = this.store.sketch.strokes.find((s) => s.id === strokeId);
    this.lineStart = mark?.tool === tool ? lineStartOf(mark, this.store.sketch.id) : null;
  }

  /**
   * Forgets point 1 once it no longer holds: another page in view, or a
   * tool other than freehand ink in hand for good. Ctrl's loan of a
   * selection tool gives the drawing tool back, and keeps it.
   */
  private checkLineStart(): void {
    const start = this.lineStart;
    if (!start) return;
    if (start.pageId !== this.store.sketch.id || (!drawsLines(this.store.tool.tool) && this.springFrom === null)) {
      this.lineStart = null;
    }
  }

  /** The paint a new mark drawn with `tool` takes from the tool state. */
  private inkOf(tool: Tool): InkPaint {
    const { color, width, opacity, nibAngle } = this.store.tool;
    return {
      tool,
      color,
      width,
      ...(opacity != null ? { opacity } : {}),
      ...(tool === 'copic' ? { nibAngle } : {}),
      ...this.pencilInk(tool),
      ...this.toolProfile(tool),
    };
  }

  /**
   * A Pencil mark's paint over the ink and width the tool state holds: the
   * pencil in hand, the tone its lead lays down - the ink color does not
   * change a pencil, as it does not change a real one - and the width its
   * lead wears to at the tool's width. Nothing for any other tool.
   */
  private pencilInk(tool: Tool): Partial<Pick<Stroke, 'pencil' | 'color' | 'width'>> {
    if (tool !== 'pencil') return {};
    const choice = this.store.tool.pencil;
    return { pencil: { ...choice }, color: pencilPaint(choice).tone, width: pencilWidth(this.store.tool.width, choice) };
  }

  /** How far a fitted stroke may stray from what was drawn: the Freehand fidelity, in screen pixels, at this zoom. */
  private freehandTolerance(): number {
    return this.screenPx(this.settings.freehandFidelityPx);
  }

  /**
   * Commits a finished stroke. With the Join-stroke setting on, a stroke
   * whose snapped start/end landed on another stroke's endpoint (same tool
   * and color) merges into that stroke instead of stacking on top of it.
   */
  private commitWithJoin(finished: Stroke, startHit: SnapHit | null, endHit: SnapHit | null): void {
    // A straight line drawn with the Eraser cuts, as its freehand does.
    if (finished.tool === 'eraser') {
      this.commitErase(finished);
      return;
    }
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
    const joined: Stroke = { ...finished, points, layer: this.store.activeLayer.id };
    delete joined.vector;
    const merged = fitStroke(joined, this.freehandTolerance());
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
    return Math.hypot(cubic.p3.x - a.x, cubic.p3.y - a.y) < this.screenPx(2) ? null : cubic;
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

  /**
   * The Stroke Profile a new stroke drawn with `tool` takes, to spread into
   * it: pen and marker marks take the chosen profile. A Copic nib is its own
   * width, and the eraser always cuts at full width.
   */
  private toolProfile(tool: Stroke['tool']): Pick<Stroke, 'profile'> {
    const { profile } = this.store.tool;
    return profile !== 'uniform' && (tool === 'pen' || tool === 'marker') ? { profile } : {};
  }

  /**
   * Builds the live quick-curve stroke, or clears it while the arc is empty.
   * Drawn on from a Shift-click line, it carries the line's mark before it,
   * and the line to point 2 while the arc is still empty.
   */
  private quickCurveStroke(points: Point[]): LiveStroke | null {
    const line = this.shiftLine;
    if (line) points = [...line.prefix, ...(points.length > 0 ? points : [line.to])];
    if (points.length < 2) return null;
    const { color, width, opacity, nibAngle } = this.store.tool;
    return {
      id: line?.markId ?? this.live?.id ?? createId('st'),
      tool: this.curveTool,
      color,
      width,
      points,
      layer: this.store.activeLayer.id,
      sharpened: true,
      ...(opacity != null ? { opacity } : {}),
      ...(this.curveTool === 'copic' ? { nibAngle } : {}),
      ...this.pencilInk(this.curveTool),
      ...this.toolProfile(this.curveTool),
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
   * position. With Shift down the line keeps to the nearest of eight
   * directions - level, plumb or a diagonal - projected from the pointer;
   * without it the end snaps to a stroke's end in reach, as a freehand
   * stroke's does (never back onto the line's own start), or follows the
   * pointer. Called from pointer moves and from Shift key transitions, so
   * the lock engages and releases without pointer movement.
   */
  private updateStraightEnd(shift: boolean): void {
    const a = this.straightStart;
    const raw = this.straightRaw;
    if (!a || !raw) return;
    const hit = !shift && this.snapApplies(drawingToolOf(this.pressTool())) ? this.nearestEndpoint(raw, a) : null;
    this.straightEnd = shift ? constrainDrag(a, raw) : hit ? { ...raw, x: hit.x, y: hit.y } : raw;
    this.setSnapTarget(hit);
    this.scheduleRender();
  }

  /**
   * Puts the quick curve's far end where the pointer is, snapped to a
   * stroke's end in reach - except while Shift, the apex key, is held, and
   * for the Curve tool's Free variant, which keeps its ends where they fall.
   * Called from pointer moves and from Shift key transitions.
   */
  private updateQuickCurveEnd(shift: boolean): void {
    const a = this.curveA;
    const raw = this.quickCurveRaw;
    if (!this.quickCurve || !a || !raw) return;
    const snaps = !shift && (this.pressTool() !== 'curve' || this.curveVariant === 'endpoints');
    const hit = snaps && this.snapApplies(this.curveTool) ? this.nearestEndpoint(raw, a) : null;
    this.curveB = hit ? { ...raw, x: hit.x, y: hit.y } : raw;
    this.setSnapTarget(hit);
    this.previewQuickCurve();
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
    const shiftLine = this.shiftLine;
    const start = this.curveA;
    const tool = this.pressTool();
    this.shiftLine = null;
    this.cancelCurve();
    // Drawn on from a Shift-click line: the arc goes on its mark after the
    // line - or, too small to be an arc, the line alone.
    if (shiftLine && finished) {
      const run: VectorAnchor[] = cubic
        ? [
            { p: { ...cubic.p0 }, hOut: { ...cubic.c1 } },
            { p: { ...cubic.p3 }, hIn: { ...cubic.c2 } },
          ]
        : [anchorAt(start ?? shiftLine.to)];
      this.commitShiftLine(shiftLine, finished, run, tool);
      return;
    }
    if (!finished || !cubic) return;
    // A quick curve drawn with the Eraser cuts along the arc.
    if (finished.tool === 'eraser') {
      this.commitErase(finished);
      return;
    }
    // The whole arc is one cubic: two anchors, two control points.
    finished.vector = {
      anchors: [
        { p: { ...cubic.p0 }, hOut: { ...cubic.c1 } },
        { p: { ...cubic.p3 }, hIn: { ...cubic.c2 } },
      ],
    };
    const extras = this.symmetryCopies(finished);
    this.store.addStrokes([finished, ...extras]);
    this.rememberLineStart(finished.id, tool);
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
    this.quickCurveRaw = null;
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

  /**
   * The newest anchor's handles, pulled out symmetrically to where the
   * pointer is - held by Shift to eight directions about the anchor - or put
   * away inside the click radius, where the anchor reverts to a corner.
   */
  private pullVectorHandles(shift: boolean): void {
    const anchor = this.vectorAnchors[this.vectorAnchors.length - 1];
    const at = this.vectorPointer;
    if (!anchor || !at) return;
    const handles = pulledHandles(anchor, at, shift, this.screenPx(3));
    anchor.hOut = handles?.hOut;
    anchor.hIn = handles?.hIn;
    this.previewVectorPath();
  }

  /**
   * The rubber band's end from where the pointer is: on the first anchor
   * while a press would close the path, which the close indicator marks;
   * otherwise held by Shift to eight directions from the last anchor, or
   * under the pointer (vector-place.ts). Called from pointer moves and from
   * Shift going down or up.
   */
  private updateVectorHover(shift: boolean): void {
    const at = this.vectorPointer;
    if (!at || this.vectorAnchors.length === 0 || this.vectorDragging) return;
    const band = bandEnd(this.vectorAnchors, at, shift, this.vectorGrab());
    this.vectorHover = { ...at, x: band.end.x, y: band.end.y };
    this.vectorCloseHover = band.closes;
    this.previewVectorPath();
  }

  /** Shift went down or up while a path is being placed: the handle being pulled, or the band, follows it at once. */
  private refreshVectorPointer(shift: boolean): void {
    if (this.store.tool.tool !== 'vector' || this.vectorEditId || this.vectorAnchors.length === 0) return;
    if (this.vectorDragging) this.pullVectorHandles(shift);
    else this.updateVectorHover(shift);
  }

  /**
   * Live preview of the pending vector path (with the rubber-band segment).
   * Where a press would close it, the preview is the path closed, the
   * closing segment bowed by the handles it will have.
   */
  private previewVectorPath(): void {
    const closing = this.vectorCloseHover && !this.vectorDragging;
    const points = closing
      ? this.vectorPathPoints(null, true)
      : this.vectorPathPoints(this.vectorDragging ? null : this.vectorHover, false);
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
      ...this.toolProfile('pen'),
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
      ) < this.screenPx(2)
    ) {
      this.vectorAnchors.pop();
    }
    if (this.vectorAnchors.length < 2) {
      this.cancelVectorPath();
      return;
    }
    const points = this.vectorPathPoints(null, close);
    const { color, fill, width, opacity } = this.store.tool;
    const finished: Stroke = {
      id: createId('st'),
      tool: 'pen',
      color,
      width,
      points,
      layer: this.store.activeLayer.id,
      sharpened: true,
      ...(opacity != null ? { opacity } : {}),
      // A closed path is a shape, and takes the tool's fill.
      ...(close && fill ? { fill } : {}),
      ...this.toolProfile('pen'),
      // The anchors persist so the path stays Vector Path editable.
      vector: {
        anchors: cloneAnchors(this.vectorAnchors),
        ...(close ? { closed: true } : {}),
      },
    };
    this.cancelVectorPath();
    const extras = this.symmetryCopies(finished);
    // Enter, a double-click or a change of tool finishes a path, well after the press that began it.
    this.recordAs('tool:vector', () => this.store.addStrokes([finished, ...extras]));
  }

  /** Abandons the pending vector path (Esc, blur, gesture, or tool switch). */
  private cancelVectorPath(): void {
    this.dropPressOf('vector-place');
    this.vectorAnchors = [];
    this.vectorDragging = false;
    this.vectorHover = null;
    this.vectorPointer = null;
    this.vectorCloseHover = false;
    this.live = null;
    this.scheduleRender();
  }

  // ---- Vector Path edit mode -----------------------------------------------

  /**
   * Grab radius for anchors, handles, the rounding target and paths, in
   * sketch units: the Direct Select sensitivity, in screen pixels, at the
   * current zoom. It used to be held to at least 8 pixels here, which left
   * the slider doing nothing below 8 on any path with Bezier anchors.
   */
  private vectorGrab(): number {
    return this.settings.directSelectSensitivityPx / this.surface.getViewport().zoom;
  }

  /** Topmost editable stroke with vector structure under the point, or null. */
  private findVectorStroke(pt: Point): Stroke | null {
    const grab = this.vectorGrab();
    const strokes = paintOrder(this.store.sketch, this.layerPaints());
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
    this.dropPressOf('vector-edit');
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
    const fitted = this.store.sketch.strokes.find((s) => s.id === this.vectorEditId)?.vector?.fitted === true;
    this.store.setStrokeGeometry(this.vectorEditId, points, {
      anchors: cloneAnchors(this.vectorEditAnchors),
      ...(this.vectorEditClosed ? { closed: true } : {}),
      ...(fitted ? { fitted: true as const } : {}),
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

  /**
   * One stroke of Sharpen Selection at the sliders' values. Freehand ink is
   * fitted afresh, close enough to keep what the sliders made, so the
   * smoothing does not multiply its points; other marks keep their points.
   */
  private applySharpenedGeometry(id: string, original: { points: Point[]; fit: boolean }): void {
    const pts = this.sharpenedPoints(original.points);
    if (pts.length < 2) return;
    const fitted = original.fit ? fitPoints(pts, SHARPEN_FIT_TOLERANCE) : null;
    // Reshaped points no longer match any stored anchor structure.
    if (fitted) this.store.setStrokeGeometry(id, fitted.points, fitted.vector);
    else this.store.setStrokeGeometry(id, pts);
  }

  private bindSharpenSelection(): void {
    el('sharpen-selection').addEventListener('click', () => this.runCommand('sharpen-selection'));
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
        { points: s.points.map((p) => ({ ...p })), vector: s.vector, fit: fitsFreehand(s) },
      ]),
    );
    el('sharpen-dialog').classList.remove('is-hidden');
    this.updateSharpenPreview();
  }

  /** Re-applies the sliders to every previewed stroke, live on the canvas. */
  private updateSharpenPreview(): void {
    if (!this.sharpenPreview) return;
    for (const [id, original] of this.sharpenPreview) this.applySharpenedGeometry(id, original);
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
      this.recordAs('sharpen-selection', () => {
        this.store.pushHistory();
        for (const [id, original] of preview) this.applySharpenedGeometry(id, original);
      });
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
          this.beginPointerDrag(e, 'vector-edit');
          return;
        }
        const anchor = this.vectorEditAnchors[sel];
        for (const kind of ['hOut', 'hIn'] as const) {
          if (near(anchor?.[kind])) {
            this.store.pushHistory();
            this.vectorEditDrag = { kind, index: sel, last: pt };
            this.beginPointerDrag(e, 'vector-edit');
            return;
          }
        }
      }
      const idx = this.nearestVectorAnchor(pt, grab);
      if (idx !== null) {
        this.vectorEditSelected = idx;
        this.store.pushHistory();
        this.vectorEditDrag = { kind: 'anchor', index: idx, last: pt };
        this.beginPointerDrag(e, 'vector-edit');
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
   * tool's fill - or its ink, while the fill is none - added as a new
   * selectable shape on the active layer.
   */
  private applyBucket(pt: Point): void {
    const strokes = paintOrder(this.store.sketch, this.layerPaints());
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (!this.strokeEditable(s) || !isClosedStroke(s)) continue;
      if (!pointInPolygon(pt, s.points)) continue;
      const color = this.store.tool.fill ?? this.store.tool.color;
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
    if (this.store.selectedMarkCount > 0) {
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
    // The joined run as a few anchors, as a stroke is when it is drawn.
    if (merged) {
      const fitted = fitStroke(merged, this.freehandTolerance());
      if (fitted.vector) this.store.setStrokeGeometry(merged.id, fitted.points, fitted.vector);
    }
    this.toast(merged ? 'Joined selected strokes.' : 'Select two or more strokes to join.');
  }

  /**
   * Fill Color tool: applies the tool's fill - or its ink, while the fill
   * is none - to the selected element(s), or to the element under the click
   * when nothing is selected.
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
    } else if (this.store.selectedMarkCount === 0) {
      this.toast('Select an element (or click one) to fill.');
      return;
    }
    const color = this.store.tool.fill ?? this.store.tool.color;
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
    // As with the Select tool, a filled shape's interior counts as the shape;
    // the reach is Direct Select's own sensitivity.
    // Direct Select reaches every anchor in a clip group, shown or not.
    const hit = this.hitTest(pt, undefined, this.settings.directSelectSensitivityPx, true);
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
          this.armAnchorDrag(e, kind, pt);
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
        this.armAnchorDrag(e, 'vanchor', pt);
      } else {
        this.scheduleRender();
      }
      return true;
    }

    // 3. The path body: select and move the whole path (anchors follow).
    if (this.onPathBody(stroke, pt, grab)) {
      this.selectedAnchors.clear();
      this.pathSelected = true;
      this.store.setSelection([stroke.id]);
      this.armAnchorDrag(e, 'path', pt);
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
          this.handleDrag = this.captureHandleDrag(stroke, origin, handle);
          this.armAnchorDrag(e, 'handle', pt);
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
        this.armAnchorDrag(e, 'anchor', pt);
      } else {
        this.scheduleRender();
      }
      return true;
    }

    // 3. The path body (a segment within range): select and move the path.
    if (this.onPathBody(stroke, pt, grab)) {
      this.selectedAnchors.clear();
      this.pathSelected = true;
      this.store.setSelection([stroke.id]);
      this.armAnchorDrag(e, 'path', pt);
      return true;
    }
    return false;
  }

  /**
   * Arms a Direct Select drag of `kind` from `pt`. The pointer is claimed
   * now, but the history step and the first move wait until the drag has
   * travelled (see {@link anchorDragFrom}). The origin is kept for every kind,
   * raw points and tangent handles included, so Shift can constrain them all.
   */
  private armAnchorDrag(e: PointerEvent, kind: AnchorDragKind, pt: Point): void {
    this.anchorDragKind = kind;
    this.anchorDragLast = pt;
    this.anchorDragOrigin = pt;
    this.anchorDragFrom = { x: e.clientX, y: e.clientY };
    this.anchorDragCommitted = false;
    this.beginPointerDrag(e);
  }

  /**
   * Whether a Direct Select press at `pt` lands on the edited path's body:
   * within the grab of its outline, or inside its fill where nothing paints
   * over it.
   */
  private onPathBody(stroke: Stroke, pt: Point, grab: number): boolean {
    if (this.pointOnPath(stroke, pt, grab)) return true;
    return this.hitTest(pt, undefined, this.settings.directSelectSensitivityPx)?.id === stroke.id;
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
      ...(stroke.vector?.fitted ? { fitted: true as const } : {}),
    });
  }

  /** Moves the selected vector anchors (handles riding along) by a delta. */
  private dragVectorPointAnchors(dx: number, dy: number): void {
    const stroke = this.store.sketch.strokes.find((s) => s.id === this.anchorStrokeId);
    if (!stroke?.vector) return;
    const anchors = cloneAnchors(stroke.vector.anchors);
    const moving = withSeamTwins(
      anchors.map((a) => a.p),
      this.selectedAnchors,
    );
    for (const index of moving) {
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

  /** Captures the pointer for a Direct Select drag, or a Vector Path edit mode drag. */
  private beginPointerDrag(e: PointerEvent, kind: PressKind = 'point-drag'): void {
    this.claimPointer(e, kind);
    this.scheduleRender();
  }

  /** Starts a Space + drag canvas pan (Select and Direct Select tools). */
  private beginPanDrag(e: PointerEvent): void {
    this.claimPointer(e, 'pan');
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

  /**
   * True when `pt` lies within `tol` of the stroke's painted outline: the
   * ink reaches half the width either side of the path, so a wide stroke is
   * grabbed on its edge as well as its middle. Its fill is not counted here.
   */
  private pointOnPath(stroke: Stroke, pt: Point, tol: number): boolean {
    return outlineDistance(stroke, pt) <= tol;
  }

  // ---- Endpoint snap (hold Shift while drawing) ----------------------------

  /** True when endpoint snapping applies to the given tool. */
  private snapApplies(tool: Tool): boolean {
    return this.settings.endpointSnap && (tool === 'pen' || tool === 'marker' || tool === 'copic' || tool === 'pencil');
  }

  /**
   * Finds the endpoint (first or last point) of an existing drawing stroke on
   * a visible layer nearest to `pt`, or null when none is within the snap
   * sensitivity. The sensitivity is measured in screen pixels so the snap
   * feel stays the same at any zoom level. An end at `from` - where the line
   * being drawn starts - is passed over: snapping onto it would leave no line.
   */
  private nearestEndpoint(pt: Point, from?: { x: number; y: number }): SnapHit | null {
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
        if (from && Math.hypot(end.x - from.x, end.y - from.y) <= 1e-6) continue;
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
      const turn = (p: { x: number; y: number }): { x: number; y: number } => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
      };
      copies.push({
        ...stroke,
        id: createId('st'),
        // The anchors turn with the points, so every arm stays a fitted curve.
        vector: stroke.vector
          ? {
              ...stroke.vector,
              anchors: stroke.vector.anchors.map((a) => ({
                ...a,
                p: turn(a.p),
                ...(a.hIn ? { hIn: turn(a.hIn) } : {}),
                ...(a.hOut ? { hOut: turn(a.hOut) } : {}),
              })),
            }
          : undefined,
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
      // An older file's eraser marks cut what is there; they are nothing to see.
      if (stroke.tool === 'eraser') continue;
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

/**
   * View > Zoom In and Zoom Out: the canvas zoomed by `factor` about its
   * middle, as far as it goes. The rows used to be Electron's, which zoom the
   * whole window - the panels and the toolbar with the drawing.
   */
  private zoomByStep(factor: number): void {
    this.surface.zoomAt(factor, this.surface.width / 2, this.surface.height / 2);
    this.scheduleRender();
    this.toast(`Zoom ${formatZoom(this.surface.getViewport().zoom)}.`);
  }

  /** `px` screen pixels in page units at the current zoom: a distance meant on the screen. */
  private screenPx(px: number): number {
    return screenPx(px, this.surface.getViewport().zoom);
  }

  /** Enters two-finger gesture mode, discarding any in-progress interaction. */
  private beginGesture(): void {
    this.gesturing = true;
    // Abandon any single-pointer drawing or drag that was in progress so it
    // does not resume when the gesture ends, and a Vector Path being placed.
    this.clearPressFields();
    this.vectorAnchors = [];
    this.vectorHover = null;
    this.vectorPointer = null;
    this.vectorCloseHover = false;
    this.releasePointer();

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

  /**
   * Turns an armed press into a real move drag, once the pointer has travelled
   * {@link SELECT_DRAG_THRESHOLD_PX} from where it went down.
   *
   * Everything that changes the drawing waits for this moment rather than
   * happening on the press: the history step, and the Alt-drag copy. Both used
   * to fire the instant an element was hit, which meant a plain click cost an
   * undo press, and an Alt-click that never went anywhere silently left a
   * duplicate stacked exactly on top of the original.
   *
   * Alt is read from the move rather than remembered from the press, so the
   * modifier decides what the drag is at the moment the drag begins - which is
   * also when the doubled-arrow pointer appears to say so.
   *
   * @returns True once the drag is live; false while the press is still a click.
   */
  private commitSelectDrag(e: PointerEvent): boolean {
    const from = this.dragFrom;
    if (!from) return false;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < SELECT_DRAG_THRESHOLD_PX) {
      return false;
    }
    this.dragCommitted = true;
    this.store.pushHistory();
    // Alt-drag copies the selection: the layers panel gains " - Copy" rows,
    // the clones become the selection, and this drag moves them while the
    // originals stay put. The history step above covers the copy and the move
    // together, so one undo removes both.
    if (e.altKey) {
      const copied = this.duplicateForDrag();
      if (copied > 0) {
        this.copyDragging = true;
        this.updateCursor();
        this.toast(`Dragging a copy of ${copied} element${copied === 1 ? '' : 's'}.`);
      }
    }
    return true;
  }

  private beginSelect(e: PointerEvent, pt: Point): void {
    // The mark on top whose ink is under the press - a shape's painted fill
    // included, so filled elements act solid - or failing that the nearest
    // within the Select sensitivity. A click on genuinely empty canvas still
    // starts a rubber-band selection.
    const hit = this.hitTest(pt);

    // A press inside a selection of several elements moves it, even where it
    // lands on a gap between the marks. Demanding an exact hit made a group
    // or a multi-row selection easy to lose by accident: pressing the space
    // between two strokes of the thing you were about to drag cleared the
    // selection and started a rubber band instead.
    //
    // Not conditioned on the press having missed everything, which it used to
    // be. A selection of several elements is usually several elements close
    // together with other marks among them, so a press in the middle of one
    // nearly always has something under it - and the hit test is forgiving by
    // design, widening every mark by a few screen pixels. The selection was
    // therefore lost most reliably in exactly the case it was meant to be
    // held: aiming at the middle of what you are about to drag.
    const insideSelection = this.store.selectedMarkCount > 1 && this.pointInSelectedBounds(pt);

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
        // Inside the selection the press belongs to the selection, so this
        // element waits for the release to find out whether the gesture was a
        // drag (the selection moves, and this was never the subject) or a
        // click (it was, and it is selected then). Outside, there is nothing
        // to protect and the press means what it always did.
        if (insideSelection) this.pendingSelectHitId = hit.id;
        else this.store.setSelection([hit.id]);
      }
      // The drag is armed here and committed to in {@link commitSelectDrag},
      // once the pointer has travelled far enough to mean it. Nothing is moved,
      // nothing is copied and no history step is pushed on the press itself:
      // this may still turn out to be a click that only selects.
      this.dragging = true;
      this.dragLast = pt;
      this.dragOrigin = pt;
      this.dragFrom = { x: e.clientX, y: e.clientY };
      this.dragCommitted = false;
      this.claimPointer(e, 'select-drag');
    } else {
      // Start rubber-band selection over empty canvas. A selection of several
      // elements is not dropped on the press itself: the gesture has not said
      // yet whether it is a rubber band or a mis-aimed grab, and clearing on
      // mousedown is what made a multi-row selection so easy to lose. The
      // clear waits for movement (a real rubber band) or for a release with
      // none (a click on empty canvas).
      if (this.store.selectedMarkCount > 1) this.pendingSelectionClear = true;
      else this.store.clearSelection();
      this.rubberBandStart = pt;
      this.rubberBandBox = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      this.claimPointer(e, 'rubber-band');
      this.scheduleRender();
    }
  }

  /**
   * Bounds of every selected mark as it shows - a mark in a clip group cut to
   * the clip's bounds, so a group selected whole is boxed by its clip - or
   * null when nothing is selected.
   */
  private selectedBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const clips = clipIndex(this.store.sketch);
    for (const stroke of this.store.sketch.strokes) {
      if (!this.store.selectedIds.has(stroke.id) || stroke.tool === 'eraser') continue;
      const bounds = strokeBounds(stroke, (t) => this.surface.measureText(t));
      const b = bounds && shownBounds(this.store.sketch, stroke, bounds, clips);
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
   * The mark a press at `pt` picks: the topmost editable one, in the order
   * the canvas paints, whose ink is under the point - a fill counts as the
   * shape, a line as wide as it is painted - or failing that the nearest
   * whose ink lies within `tolerancePx` screen pixels. Null over bare canvas,
   * and over ink an eraser has cut away. See core/hit-test.ts.
   *
   * `editable` is the pickable set from {@link editableStrokeIds}; a caller
   * making several passes over the page passes its own so the layer stack is
   * resolved once for the whole gesture step rather than once per pass.
   */
  private hitTest(
    pt: Point,
    editable: ReadonlySet<string> = this.editableStrokeIds(),
    tolerancePx = this.settings.selectSensitivityPx,
    ignoreClips = false,
  ): Stroke | null {
    return hitMark(this.store.sketch, pt, {
      zoom: this.surface.getViewport().zoom,
      tolerancePx,
      editable,
      paints: this.layerPaints(),
      measure: (t) => this.surface.measureText(t),
      ignoreClips,
    });
  }

  /** Which layers paint on the canvas - none hidden, by itself or by a group above it - for the paint order. */
  private layerPaints(): (layer: Layer) => boolean {
    const effectiveOf = effectiveLayers(this.store.sketch);
    return (layer) => effectiveOf.get(layer.id)?.visible === true;
  }

  /**
   * Like {@link hitTest}, but a click anywhere within an element's
   * dimensions counts, not just on its ink. Three passes, each topmost-first
   * in paint order: the ink, then the shape's interior (point-in-polygon over
   * the stroke's points, filled or not), then its bounding box.
   *
   * @param eligible Optional filter; ineligible strokes are skipped so the
   *   pick falls through to whatever sits beneath them.
   */
  private hitTestWithinBounds(pt: Point, eligible?: (s: Stroke) => boolean): Stroke | null {
    const sketch = this.store.sketch;
    const editable = this.editableStrokeIds();
    const pickable = new Set(
      sketch.strokes
        .filter((s) => editable.has(s.id) && (eligible === undefined || eligible(s)))
        .map((s) => s.id),
    );
    const exact = this.hitTest(pt, pickable);
    if (exact) return exact;
    const topFirst = paintOrder(sketch, this.layerPaints())
      .filter((s) => pickable.has(s.id))
      .reverse();
    for (const s of topFirst) {
      if (s.points.length >= 3 && pointInPolygon(pt, s.points)) return s;
    }
    for (const s of topFirst) {
      const b = strokeBounds(s, (t) => this.surface.measureText(t));
      if (b && pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY) return s;
    }
    return null;
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
      // A text box is committed when it loses the focus, after the press that opened it.
      this.recordAs('tool:text', () => {
        if (this.editingId) {
          this.store.pushHistory();
          this.store.replaceStroke(this.editingId, item);
        } else {
          this.store.addStroke(item);
        }
      });
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

    // The hand: Space held with no press under way pans on every tool, over
    // a Transform box or a Rotate dialog too, and a pan under way grabs.
    // Mid-press, Space is the straight line's, and the tool's cursor stays.
    if (this.panDragging) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.spaceDown && !this.press) {
      this.canvas.style.cursor = 'grab';
      return;
    }

    // Transform: a handle under the pointer says which way it pulls. Anywhere
    // else the tool underneath keeps its own cursor, since the box does not
    // take those presses either.
    const grabbed = this.transformDrag?.handle ?? this.transformHover;
    if (this.transformActive && grabbed) {
      this.canvas.style.cursor = transformCursor(grabbed);
      return;
    }

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

    if (this.capsLockOn || this.spaceDown) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Alt-drag copy: the doubled arrow, both while the copy is being dragged
    // and while Alt merely arms one, so the modifier shows its effect before
    // the drag commits to it.
    if (
      tool === 'select' &&
      (this.copyDragging || (this.altDown && this.store.selectedMarkCount > 0))
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

    // Mesh Warp: a pin is picked up; anywhere else is a click to pick.
    if (tool === 'warp') {
      this.canvas.style.cursor = this.warpDrag ? 'grabbing' : this.warpOverPin ? 'grab' : CURSOR_ARROW_BLACK;
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
    if (tool === 'liquify') {
      // The brush itself is drawn on the canvas: too big for a cursor picture.
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    if (tool === 'split') {
      this.canvas.style.cursor = CURSOR_SPLIT;
      return;
    }
    if (tool === 'smear') {
      // The stump's size on the screen, as the Eraser's ring shows its own.
      const stump = Surface.makeEraserCursorDataUrl(this.store.tool.width * this.surface.getViewport().zoom);
      this.canvas.style.cursor = stump.url ? `url('${stump.url}') ${stump.hotspotX} ${stump.hotspotY}, crosshair` : 'crosshair';
      return;
    }
    if (tool === 'shape-stacker') {
      const stacker = Surface.makeStackerCursorDataUrl(this.altDown);
      this.canvas.style.cursor = stacker.url ? "url('" + stacker.url + "') " + stacker.hotspotX + ' ' + stacker.hotspotY + ', crosshair' : 'crosshair';
      // The shading turns red with Alt too.
      if (this.stackerHover >= 0) this.scheduleRender();
      return;
    }
    if (
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'curve' ||
      tool === 'vector' ||
      tool === 'bucket' ||
      tool === 'fill' ||
      tool === 'eyedrop' ||
      tool === 'shape-eraser'
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
        : tool === 'pencil'
          ? Surface.makeCursorDataUrl(pencilWidth(this.store.tool.width, this.store.tool.pencil), pencilPaint(this.store.tool.pencil).tone)
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
        // A press while the toolbar is being rearranged is a drag, not a pick.
        if (this.rearranging) return;
        this.runCommand(id);
      });
    }

    this.bindCurveFlyout();
    // The Pencil's button opens its drawing kit, as the Shape Eraser's opens its shapes.
    el('tool-pencil').addEventListener('click', () => {
      if (!this.rearranging && !document.querySelector('.pencil-kit')) this.openPencilKit();
    });
    this.updatePencilTitle();

    el('join-strokes').addEventListener('click', () => this.runCommand('join-strokes'));
    // Close Shape offers its two joins as a submenu on press (mousedown),
    // reusing the shared context menu the panels already build. The press
    // must not reach the window listener that dismisses that menu on any
    // pointerdown outside it - the menu would be built and torn down within
    // this one event dispatch, and nothing would ever appear.
    el('close-shape').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMenuUnder(el('close-shape'), this.windowMenu('close-shape-button'));
    });

    this.rebuildSwatches();

    // Drag-to-reorder support (active only in rearrange mode). Every tool in
    // both toolbar groups takes part, and tools may move between the groups.
    this.makeSortable([el('tool-group'), el('sketch-group')], '.tool', () => this.persistToolOrder());
    this.makeSortable([el('swatches')], '.swatch', () => this.persistQuickColors());

    // The color well picks the way a swatch does - the one of fill and
    // stroke in front takes it, and a selection too. Chromium fires `input`
    // for each color the pointer crosses while the popup is open and `change`
    // once it closes: the first tick opens a history step that the rest of
    // the drag folds into, and the report waits for the color chosen.
    const custom = el<HTMLInputElement>('color-custom');
    custom.addEventListener('input', () => {
      this.inkPick = this.applyColorToSelection(custom.value, this.inkPick === null) ?? this.inkPick;
      this.setFrontColor(custom.value);
    });
    custom.addEventListener('change', () => {
      this.reportColorPick(custom.value, this.inkPick ?? this.applyColorToSelection(custom.value));
      this.inkPick = null;
      this.setFrontColor(custom.value);
    });
    this.bindFillStroke();

    // The width reaches a selection too, the way the colour does: with the
    // Select tool and something selected, the selected outlines take it as
    // the slider moves. The whole drag is one undo step, and the report
    // waits for the width it was let go at.
    const width = el<HTMLInputElement>('width');
    width.addEventListener('input', () => {
      const value = Number(width.value);
      this.store.setTool({ width: value });
      this.applyWidthToSelection(value);
      this.updateCursor();
    });
    width.addEventListener('change', () => {
      if (this.widthPick !== null) this.reportWidthPick(Number(width.value), this.widthPick);
      this.widthPick = null;
    });

    el('sharpen-all').addEventListener('click', () => this.runCommand('sharpen-all'));
    el('undo').addEventListener('click', () => this.runCommand('undo'));
    el('redo').addEventListener('click', () => this.runCommand('redo'));
    el('clear').addEventListener('click', () => this.runCommand('clear-page'));
    el('app-settings').addEventListener('click', () => this.runCommand('verbose-settings'));
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
    const curve = el('tool-curve');
    curve.dataset.titleTemplate =
      this.curveVariant === 'endpoints'
        ? 'Curve ({key}) - drag a chord (ends snap to stroke endpoints), then bend and click. Click and hold for curve options'
        : 'Curve ({key}) - drag a chord, then bend and click. Click and hold for curve options';
    this.applyShortcutTitle(curve);
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
      btn.setAttribute('aria-label', `Quick Access Color ${color}`);
      btn.dataset.color = color;
      btn.draggable = this.rearranging;
      btn.addEventListener('click', () => {
        if (this.rearranging) return;
        this.reportColorPick(color, this.applyColorToSelection(color));
        this.setFrontColor(color);
      });
      swatches.appendChild(btn);
    }
  }

  /**
   * With the Select tool and a selection, a picked color - a swatch or the
   * color well - paints the selection with the one of fill and stroke in
   * front (`Store.paintSelected`, core/paint.ts's rule), as well as the tool
   * for the next mark. It took the place of Fill Shape, which filled the
   * closed shapes and recolored the rest whatever was meant. `history:
   * false` folds a picker drag into the step its first tick opened. Returns
   * what changed, or null when the pick had no selection to reach.
   */
  private applyColorToSelection(
    color: string,
    history = true,
  ): { filled: number; recolored: number } | null {
    if (this.store.tool.tool !== 'select' || this.store.selectedMarkCount === 0) return null;
    return this.store.paintSelected(this.store.tool.colorTarget, color, history);
  }

  /** The tool's color in front takes a picked one: the fill's, or the ink's. */
  private setFrontColor(color: string): void {
    this.store.setTool(this.store.tool.colorTarget === 'fill' ? { fill: color } : { color });
    this.updateCursor();
  }

  /**
   * The fill and stroke control, where the color well was: a click on the box
   * behind brings it in front, one on the box in front opens the color well
   * on its color, and the corner arrow runs Swap Fill and Stroke.
   */
  private bindFillStroke(): void {
    const well = el<HTMLInputElement>('color-custom');
    const press = (target: ColorTarget): void => {
      if (this.store.tool.colorTarget !== target) {
        this.setColorTarget(target);
        return;
      }
      // The well opens on the color it would change; a fill of none, on the ink.
      const start = frontColor(this.store.tool) ?? this.store.tool.color;
      if (/^#[0-9a-f]{6}$/i.test(start)) well.value = start.toLowerCase();
      try {
        well.showPicker();
      } catch {
        well.click();
      }
    };
    el('fill-stroke-fill').addEventListener('click', () => press('fill'));
    el('fill-stroke-stroke').addEventListener('click', () => press('stroke'));
    el('fill-stroke-swap').addEventListener('click', () => this.runCommand('swap-fill-stroke'));
  }

  /** `X`, Fill in Front: the other of fill and stroke comes in front. */
  private toggleColorTarget(): void {
    this.setColorTarget(otherTarget(this.store.tool.colorTarget));
  }

  private setColorTarget(target: ColorTarget): void {
    if (this.store.tool.colorTarget === target) return;
    this.store.setTool({ colorTarget: target });
    this.toast(target === 'fill' ? 'Fill in front: the colors paint the fill.' : 'Stroke in front: the colors paint the stroke.');
  }

  /**
   * `Shift+X`, Swap Fill and Stroke: with the Select tool and a selection,
   * each selected closed shape's fill and outline trade colors; otherwise the
   * tool's ink and fill do - but the ink is never none, so a fill of none has
   * nothing to trade.
   */
  private swapFillStroke(): void {
    if (this.store.tool.tool === 'select' && this.store.selectedMarkCount > 0) {
      const swapped = this.store.swapSelectedPaint();
      this.toast(
        swapped > 0
          ? `Swapped the fill and the outline of ${swapped} ${swapped === 1 ? 'shape' : 'shapes'}.`
          : 'Swap Fill and Stroke swaps closed shapes: the selection has none.',
      );
      return;
    }
    const swapped = swapToolPaint(this.store.tool);
    if (!swapped) {
      this.toast('The fill is none, and the ink never is: give the fill a color first.');
      return;
    }
    this.store.setTool(swapped);
    this.updateCursor();
    this.toast(`Swapped the fill and the ink: the fill is ${swapped.fill}, the ink ${swapped.color}.`);
  }

  /**
   * Gives the selection the toolbar's width, with the Select tool and
   * something selected - as picking a colour recolours it. Only outlines take
   * it: text and placed images have none to widen. The first change since
   * {@link widthPick} was cleared opens an undo step, and every later one
   * folds into it. Returns how many outlines the selection holds, or null
   * when it holds none, or the Select tool is not the one in hand.
   */
  private applyWidthToSelection(width: number): number | null {
    if (this.store.tool.tool !== 'select' || this.store.selectedMarkCount === 0) return null;
    const outlines = this.propertyShapes();
    if (outlines.length === 0) return null;
    const changing = outlines.filter((s) => s.width !== width).map((s) => s.id);
    if (changing.length > 0) {
      this.store.setStrokeProps(changing, { width }, this.widthPick === null);
      this.widthPick = outlines.length;
    }
    return outlines.length;
  }

  /** Says what a width did to the selection. */
  private reportWidthPick(width: number, outlines: number): void {
    this.toast(`Width ${width}px on ${outlines} ${outlines === 1 ? 'outline' : 'outlines'}.`);
  }

  /** Says what a color pick did to the selection, when it reached one. */
  private reportColorPick(color: string, result: { filled: number; recolored: number } | null): void {
    if (!result) return;
    if (result.filled > 0) this.toast(`Filled ${result.filled} ${result.filled === 1 ? 'shape' : 'shapes'} with ${color}.`);
    else if (result.recolored > 0) this.toast(`Recolored ${result.recolored} ${result.recolored === 1 ? 'mark' : 'marks'} with ${color}.`);
    else if (this.store.tool.colorTarget === 'fill') this.toast('The fill is in front, and the selection has no closed shape to fill.');
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
    el<HTMLInputElement>('qs-warp-show-mesh').checked = s.warpShowMesh;
    this.rebuildSwatches();
    this.applyMenuPlacement();
    // The selection border is a painted thing, so a change made in the Verbose
    // Settings window has to reach the canvas and not only the checkboxes.
    this.scheduleRender();
    this.applyToolOrder();
    this.applyTheme();
    this.restartAutoSave();
    this.applyHistoryTracking();
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
      else if (placement === 'both') {
        (group.id === 'tool-group' || group.id === 'warp-group' ? rail : toolbar).appendChild(group);
      }
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

  /**
   * Throws the selection-border switch, from whichever copy of it was clicked.
   *
   * The canvas is repainted before the save round-trips, so the border goes on
   * the same frame the switch is thrown rather than a tick later, and the
   * other copies of the switch are moved with it - a value with three switches
   * is only one value if they never disagree.
   */
  private setShowSelectionBorders(showSelectionBorders: boolean): void {
    this.settings = { ...this.settings, showSelectionBorders };
    this.syncSelectionBorderSwitches();
    this.scheduleRender();
    void this.saveSettings({ showSelectionBorders });
  }

  /**
   * Ctrl+H: draws or drops the selection border, the switch the Move palette
   * carries.
   *
   * It is worth a key of its own because of when it is wanted: the border is
   * in the way exactly while a selection is being looked at, and reaching the
   * switch otherwise means opening a palette over the drawing being judged.
   *
   * The toast says which way it went. With nothing selected there is no border
   * either way, so the canvas alone cannot answer what the key just did.
   */
  private toggleSelectionBorders(): void {
    const next = !this.settings.showSelectionBorders;
    this.setShowSelectionBorders(next);
    this.toast(next ? 'Selection borders on.' : 'Selection borders off.');
  }

  /** Puts every copy of the selection-border switch at the stored value. */
  private syncSelectionBorderSwitches(): void {
    for (const id of SELECTION_BORDER_SWITCHES) {
      const box = document.getElementById(id);
      if (box instanceof HTMLInputElement) box.checked = this.settings.showSelectionBorders;
    }
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
      // A typed width reaches the selection as the slider's does, one step.
      this.widthPick = null;
      const outlines = this.applyWidthToSelection(width);
      this.widthPick = null;
      if (outlines !== null) this.reportWidthPick(width, outlines);
      // REUSE: with the Smear in hand, Quick Width is the stump's size (see commitSmear).
      else if (this.store.tool.tool === 'smear') this.toast(`Smear: a stump ${width}px wide.`);
      else this.toast(`Width set to ${width}px.`);
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
    // REUSE: with the Smear in hand, Quick Opacity is the stump's strength (see commitSmear).
    this.toast(this.store.tool.tool === 'smear' ? `Smear: strength ${percent}%.` : `Opacity set to ${percent}%.`);
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

  // ---- Held keys: Space and Ctrl (held-keys.ts) -----------------------------

  /**
   * Feeds the Ctrl spring an event: with no press under way, Ctrl on a
   * drawing tool gives the last selection tool, once the pointer moves or
   * presses or {@link SPRING_DELAY_MS} has passed, and letting Ctrl go gives
   * the drawing tool back. `springs` says whether the tool in hand springs,
   * for the key going down.
   */
  private springEvent(event: SpringEvent, springs = true): void {
    const { state, effect } = springStep(this.spring, event, springs);
    this.spring = state;
    if (state === 'armed' && this.springTimer === null) {
      this.springTimer = window.setTimeout(() => {
        this.springTimer = null;
        this.springEvent('timer');
      }, SPRING_DELAY_MS);
    } else if (state !== 'armed' && this.springTimer !== null) {
      window.clearTimeout(this.springTimer);
      this.springTimer = null;
    }
    if (effect === 'show') this.showSpring();
    else if (effect === 'hide') this.hideSpring();
  }

  /**
   * Whether Ctrl going down now gives the last selection tool: a drawing tool
   * in hand that springs, no press under way, no Space held, and no curve
   * waiting for its bend click - a press with the selection tool would place
   * it.
   */
  private springArms(): boolean {
    return (
      !this.press &&
      !this.spaceDown &&
      springsFrom(this.store.tool.tool) &&
      this.curveA === null &&
      !this.curveBending
    );
  }

  /** Puts the last selection tool in hand for as long as Ctrl stays down. */
  private showSpring(): void {
    this.springFrom = this.store.tool.tool;
    this.store.setTool({ tool: this.lastSelectionTool });
    this.updateCursor();
  }

  /**
   * Gives the drawing tool back when Ctrl comes up - after the press, when a
   * drag the selection tool began is still under way. A tool chosen while
   * Ctrl was down wins over the one given back.
   */
  private hideSpring(): void {
    const from = this.springFrom;
    this.springFrom = null;
    if (!from) return;
    const lent = this.lastSelectionTool;
    this.whenPressEnds(() => {
      if (this.store.tool.tool === lent) this.store.setTool({ tool: from });
      this.updateCursor();
    });
  }

  /** The pointer moved, anywhere in the window: the spring comes up, and a still hold that drifted is off. */
  private heldMove(x: number, y: number): void {
    this.hoverClient = { x, y };
    if (this.spring === 'armed') this.springEvent('move');
    if (this.nib === 'pending') {
      const origin = this.nibHoldOrigin ?? (this.nibHoldOrigin = { x, y });
      this.nibEvent({ type: 'move', drift: Math.hypot(x - origin.x, y - origin.y) });
    }
  }

  /** Where the pointer of the press under way is now, in sketch units. */
  private pressPoint(fallback: Point): Point {
    const at = this.pressClient;
    return at ? this.surface.toSketchPoint(at.x, at.y, fallback.pressure ?? 0.5) : fallback;
  }

  /**
   * Space mid-press: the freehand stroke under way becomes a straight line
   * from where it began to where the pointer is, and the end follows the
   * pointer until the release. What was drawn freehand before is dropped;
   * the start keeps the snap it had. A Shift-click line's own drawing began
   * at point 2, and the line to point 2 stays on show.
   */
  private straightenPress(shift: boolean): void {
    const press = this.press;
    const line = this.shiftLine;
    const start = line ? line.to : this.live?.points[0];
    if (!press || press.kind !== 'freehand' || !start) return;
    press.kind = 'straight';
    this.live = line && this.live ? { ...this.live, points: [...line.prefix, line.to] } : null;
    this.straightStart = start;
    this.straightRaw = this.pressPoint(start);
    this.setSnapTarget(null);
    this.updateStraightEnd(shift);
  }

  /**
   * Ctrl with Space mid-press: the stroke under way - freehand, or already
   * made straight - becomes the quick curve from where it began, which the
   * release places, as the quick curve always has. A Shift-click line's own
   * drawing began at point 2.
   */
  private curvePress(alt: boolean, shift: boolean): void {
    const press = this.press;
    if (!press || (press.kind !== 'freehand' && press.kind !== 'straight')) return;
    const start = press.kind === 'freehand' ? (this.shiftLine?.to ?? this.live?.points[0]) : this.straightStart;
    if (!start) return;
    press.kind = 'curve';
    this.live = null;
    this.straightStart = null;
    this.straightEnd = null;
    this.straightRaw = null;
    this.curveTool = drawingToolOf(press.tool);
    this.curveA = start;
    this.curveBending = false;
    this.quickCurve = true;
    this.quickCurveUniform = alt;
    this.quickCurveApex = 0;
    this.quickCurveRaw = this.pressPoint(start);
    this.updateQuickCurveEnd(shift);
  }

  // ---- Copic quick nib-rotate (hold Ctrl, then Alt / Shift) ----------------

  /**
   * Feeds the nib-rotate's still hold an event (held-keys.ts), keeps its
   * timer in step, and turns the mode on or off when the hold says so. After
   * the configured hold time with the key down and the pointer still, the
   * mode comes on: the bottom-right indicator appears and the rotate keys
   * steer the broad nib.
   */
  private nibEvent(event: NibEvent): void {
    const was = this.nib;
    const { state, effect } = nibStep(was, event);
    this.nib = state;
    if (state === 'pending' && was !== 'pending') this.nibHoldOrigin = this.hoverClient ? { ...this.hoverClient } : null;
    if (state === 'pending' && this.nibHoldTimer === null) {
      this.nibHoldTimer = window.setTimeout(() => {
        this.nibHoldTimer = null;
        this.nibEvent({ type: 'timer' });
      }, Math.round(this.settings.copicHoldSec * 1000));
    } else if (state !== 'pending' && this.nibHoldTimer !== null) {
      window.clearTimeout(this.nibHoldTimer);
      this.nibHoldTimer = null;
    }
    if (effect === 'start') this.activateNibRotate();
    else if (effect === 'end') this.endNibRotate();
  }

  /**
   * Whether the nib-rotate's hold key may arm the still hold now: the feature
   * on, no press under way, no Space held, and a drawing tool in hand - never
   * a selection tool, Vector Path, Mesh Warp or the eyedropper.
   */
  private nibHoldArms(): boolean {
    const tool = this.store.tool.tool;
    return this.settings.copicQuickRotate && !this.press && !this.spaceDown && springsFrom(tool) && tool !== 'eyedrop';
  }

  /**
   * Activates rotate mode once the hold key has been held still long enough.
   * Never mid-press: the mode puts the Copic in hand, and a drag begun with
   * another tool must end with it. The mode waits for the release, and comes
   * on then if the key is still held. It takes the hold over from the Ctrl
   * spring, so the tool it gives back when it ends is the drawing tool.
   */
  private activateNibRotate(): void {
    if (this.press) {
      this.whenPressEnds(() => {
        if (this.nib === 'on') this.activateNibRotate();
      });
      return;
    }
    this.springEvent('nib-on');
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

  /** Ends rotate mode (the hold key released, or the window lost). */
  private endNibRotate(): void {
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
    // A Copic stroke drawn in the mode and still under way finishes as the
    // Copic; the tool goes back when it is done.
    if (Object.keys(restore).length > 0) this.whenPressEnds(() => this.store.setTool(restore));
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
  /**
   * `C` / `Shift+C`: the color in front steps through the Quick Access
   * Colors - the fill's stops begin with None (fill-stroke.ts).
   */
  private cycleColor(dir: 1 | -1): void {
    const { colorTarget } = this.store.tool;
    const next = nextQuickColor(this.settings.quickColors, frontColor(this.store.tool), dir, colorTarget);
    if (colorTarget === 'fill') this.store.setTool({ fill: next });
    else if (next !== null) this.store.setTool({ color: next });
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
    el('settings-toggle').addEventListener('click', () => this.runCommand('toggle-settings'));
    el('settings-close').addEventListener('click', () => this.toggleSettings(false));

    // Each Quick Setting applies immediately AND persists via the shared
    // settings store, keeping the Verbose Settings window in sync.
    el<HTMLInputElement>('live-sharpen').addEventListener('change', (e) => {
      const liveSharpen = (e.target as HTMLInputElement).checked;
      this.store.setTool({ liveSharpen });
      void this.saveSettings({ liveSharpen });
    });
    // The same setting has a switch in the Move and Mirror palettes, where it
    // is reached while a selection is being worked on, and one in each settings
    // view. They are one value, so throwing any of them moves them all.
    for (const id of SELECTION_BORDER_SWITCHES) {
      el<HTMLInputElement>(id).addEventListener('change', (e) => {
        this.setShowSelectionBorders((e.target as HTMLInputElement).checked);
      });
    }
    el<HTMLInputElement>('qs-warp-show-mesh').addEventListener('change', (e) => {
      const warpShowMesh = (e.target as HTMLInputElement).checked;
      this.settings = { ...this.settings, warpShowMesh };
      this.scheduleRender();
      void this.saveSettings({ warpShowMesh });
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
    el('new-sketch').addEventListener('click', () => this.runCommand('new-sketch'));
    el('open').addEventListener('click', () => this.runCommand('open'));
    el('import').addEventListener('click', () => this.runCommand('import'));
    // Export drops File > Export's rows down beneath the button, with the
    // Selection row the menu bar leaves out: the same four formats one level
    // in, exporting only what is selected, on a page cut to fit it.
    el('export').addEventListener('click', () => this.toggleMenuUnder(el('export'), this.windowMenu('export-button')));
    el('save').addEventListener('click', () => this.runCommand('save'));
    el('save-as').addEventListener('click', () => this.runCommand('save-as'));
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
    // Copying changes nothing the store knows, so the menus hear of it here.
    this.publishMenuState();
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
    if (this.store.selectedMarkCount === 0) {
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
    this.selectTool('select');
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
      const before = new Set(this.store.sketch.layers.map((l) => l.id));
      this.store.addImportedLayers(imported.layers);
      this.foldImportedLayers(before);
      // The paste came from outside, so this app's own clipboard no longer
      // describes what a further paste should produce.
      this.clipboard = null;
      this.clipboardSvgSent = svgText;
      // The panel was already rebuilt by the fold above.
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
        const before = new Set(this.store.sketch.layers.map((l) => l.id));
        this.store.addImportedLayers(imported.layers);
        this.foldImportedLayers(before);
        this.toast(
          `Imported ${imported.layers.length} layer${imported.layers.length === 1 ? '' : 's'} from ${result.name}.svg.`,
        );
      } catch (err) {
        this.toast((err as Error).message);
      }
      return;
    }

    if (result.kind === 'pdf') {
      const pages = pdfPagesToSketches(result.pages, result.name);
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
    const before = new Set(this.store.sketch.layers.map((l) => l.id));
    this.store.addImportedLayers(nodes);
    this.foldImportedLayers(before);
  }

  // ---- Pages ---------------------------------------------------------------

  private bindPages(): void {
    el('prev-page').addEventListener('click', () => this.runCommand('prev-page'));
    el('next-page').addEventListener('click', () => this.runCommand('next-page'));
    el('new-page').addEventListener('click', () => this.runCommand('add-page-default'));
    // The hamburger drops down Pages > Add Page's three ways to start a page.
    el('pages-menu').addEventListener('click', () => this.toggleMenuUnder(el('pages-menu'), this.windowMenu('pages-button')));
    el('pages-toggle').addEventListener('click', () => this.runCommand('toggle-pages'));
    el('delete-page').addEventListener('click', () => this.runCommand('delete-page'));
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
    this.publishMenuState();
  }

  // ---- Layers ----------------------------------------------------------------

  private bindLayers(): void {
    el('layers-toggle').addEventListener('click', () => this.runCommand('toggle-layers'));
    el('add-layer').addEventListener('click', () => this.runCommand('add-layer'));
    el('group-layer').addEventListener('click', () => this.runCommand('group-layer'));
    el('delete-layer').addEventListener('click', () => this.runCommand('delete-layer'));
    el('layer-up').addEventListener('click', () => this.runCommand('layer-up'));
    el('layer-down').addEventListener('click', () => this.runCommand('layer-down'));

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
    this.publishMenuState();
  }

  // ---- Panel context menus & resize ----------------------------------------

  /**
   * The right-click menus of the layers panel, the canvas and the pages panel.
   * Their rows are generated from the menu registry, so each holds what the
   * menu bar's Layers, Edit and Pages menus hold, in the panel's own form.
   */
  private bindContextMenus(): void {
    el('layers-panel').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, this.windowMenu('layers'));
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
      this.showContextMenu(e.clientX, e.clientY, this.windowMenu('canvas'));
    });

    el('pages-panel').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, this.windowMenu('pages'));
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
      const label = document.createElement('span');
      label.className = 'context-menu-label';
      label.textContent = item.label ?? '';
      btn.appendChild(label);
      if (item.chord) {
        const chord = document.createElement('span');
        chord.className = 'context-menu-chord';
        chord.textContent = item.chord;
        btn.appendChild(chord);
      }
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
    this.fillMenu(sub, inlineDeeperSubmenus(items), true);
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

  /**
   * The layer ids the panel is showing, top row first.
   *
   * A Shift range is drawn on this rather than on the layer stack: the rows
   * inside a collapsed group are not on screen, and a range that swept them
   * up would select what the user cannot see. Rebuilt per click rather than
   * cached - the panel is tens of rows, and a cache is one more thing that
   * can disagree with what is on screen.
   */
  private visibleLayerOrder(): string[] {
    const order: string[] = [];
    const layers = this.store.sketch.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      if (!this.hasCollapsedAncestor(layers[i])) order.push(layers[i].id);
    }
    return order;
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
    if (this.store.selectedMarkCount > 0) {
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
    const ungroup = this.keyOf('ungroup-layer');
    const hint = ungroup ? ` (${ungroup} ungroups)` : '';
    this.toast(ids.length > 1 ? `Grouped ${ids.length} layers into "${group.name}"${hint}.` : `Grouped "${group.name}"${hint}.`);
  }

  /** Dissolves the active group, keeping its layers and strokes. */
  private ungroupActiveLayer(): void {
    const layer = this.store.activeLayer;
    if (this.store.ungroupActiveLayer()) this.toast(`Ungrouped "${layer.name}".`);
    else {
      const ungroup = this.keyOf('ungroup-layer');
      this.toast(`Select a group row to ungroup${ungroup ? ` (${ungroup})` : ''}.`);
    }
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
    // The clip groups, and the layers their clip marks are on.
    const clips = clipIndex(this.store.sketch);
    const clipLayers = new Set([...clips.byGroup.values()].map((clip) => clip.mark.layer ?? ''));

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
      const renameKey = this.keyOf('rename-layer');
      name.title = `${layer.name} (double-click${renameKey ? ` or ${renameKey}` : ''} to rename)`;

      const badge = document.createElement('span');
      badge.className = 'layer-opacity-badge';
      badge.textContent = layer.opacity < 1 ? `${Math.round(layer.opacity * 100)}%` : '';

      row.append(eye, lock, name, badge);
      // A clip group's row carries a clip icon, and its clip's row a badge,
      // as a vector editor marks a <Clip Group> and its <Clipping Path>.
      if (clips.byGroup.has(layer.id) || clipLayers.has(layer.id)) {
        const group = clips.byGroup.has(layer.id);
        const mark = document.createElement('span');
        mark.className = group ? 'layer-clip-icon' : 'layer-clip-badge';
        mark.textContent = group ? '◘' : 'clip';
        mark.title = group
          ? 'Clip group: it shows only inside its clipping path'
          : 'Clipping path: it paints nothing while it clips; Release Clipping Mask shows it again';
        row.classList.add(group ? 'is-clip-group' : 'is-clip-path');
        name.after(mark);
      }
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
      // Click selects the layer and highlights its elements on the canvas.
      // The two modifiers are the ones every layer panel uses, and they are
      // not the same gesture: Ctrl/Cmd picks rows out one at a time, Shift
      // takes everything between the last row selected and this one. Shift
      // wins the chord, since a range is what Ctrl+Shift always did here.
      row.addEventListener('click', (ev) => {
        if (ev.shiftKey) this.store.selectLayerRange(layer.id, this.visibleLayerOrder());
        else this.store.selectLayer(layer.id, ev.ctrlKey || ev.metaKey);
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
      window.napkin.onMenuAction((id) => this.runCommand(id));
    } catch {
      // running outside Electron — menus unavailable
    }
  }

  /**
   * Runs a command by the id the menu files give it. An id that names no
   * command can only come from a mistake in the app, so it is logged rather
   * than shown.
   */
  private runCommand(id: string): void {
    // Track History records each step under the command that made it, and a
    // command's steps are over when it is - for Import, once the file is in.
    const end = this.store.beginCommand(id);
    const finish = (): void => {
      end();
      this.store.flushHistoryStep();
    };
    if (!this.commands.run(id, finish)) {
      finish();
      console.error(`napkin-sketch: no command "${id}"`);
    }
  }

  /**
   * What every command the drawing window owns does, by its id in the menu
   * files. The menu bar, the right-click menus and the toolbar buttons all
   * come here, so a command does one thing however it is reached. The type
   * is every such id: a command added to the menu files without a row here
   * does not compile.
   */
  private commandHandlers(): CommandHandlers {
    return {
      'new-sketch': () => this.newSketch(),
      open: () => void this.openBook(),
      // Import and Paste return their promises: their steps come after an await.
      import: () => this.importFile(),
      save: () => void this.saveBook(false),
      'save-as': () => void this.saveBook(true),
      'export-png': () => void this.exportRaster('png'),
      'export-svg': () => void this.exportSvg(),
      'export-jpeg': () => void this.exportRaster('jpeg'),
      'export-pdf': () => void this.exportPdf(),
      'export-selection-png': () => void this.exportSelection('png'),
      'export-selection-svg': () => void this.exportSelection('svg'),
      'export-selection-jpeg': () => void this.exportSelection('jpeg'),
      'export-selection-pdf': () => void this.exportSelection('pdf'),
      undo: () => this.undo(),
      redo: () => this.redo(),
      cut: () => this.cutSelection(),
      copy: () => this.copySelectionWithToast(),
      paste: () => this.pasteClipboard(false),
      'paste-in-place': () => this.pasteClipboard(true),
      duplicate: () => this.duplicateSelection(),
      'delete-selection': () => this.deleteSelectionOrLayers(),
      'select-all': () => this.selectAll(),
      'deselect-all': () => this.store.clearSelection(),
      'toggle-rearrange': () => this.toggleRearrange(),
      'edit-shortcuts': () => this.openShortcutEditor(),
      'edit-tool-types': () => this.openToolTypeEditor(),
      'toggle-animation': () => this.toggleAnimationMode(),
      'toggle-pages': () => this.togglePages(),
      'toggle-layers': () => this.toggleLayers(),
      'toggle-properties': () => this.toggleProperties(),
      'toggle-settings': () => this.toggleSettings(),
      'fit-view': () => this.fitAllInView(),
      'prev-page': () => this.turnPage(this.store.activeIndex - 1),
      'next-page': () => this.turnPage(this.store.activeIndex + 1),
      'zoom-in': () => this.zoomByStep(ZOOM_MENU_STEP),
      'zoom-out': () => this.zoomByStep(1 / ZOOM_MENU_STEP),
      'tool-vector': () => this.selectTool('vector'),
      'move-selection': () => this.openMoveDialog(),
      rotate: () => this.openRotateDialog(),
      'join-strokes': () => this.joinSelectedStrokes(),
      'close-shape-sharp': () => this.closeSelectedShapes('sharp'),
      'close-shape-smooth': () => this.closeSelectedShapes('smooth'),
      mirror: () => this.openMirrorDialog(),
      'sharpen-selection': () => this.openSharpenDialog(),
      'sharpen-all': () => this.sharpenAll(),
      'tool-warp': () => this.selectTool('warp'),
      'tool-liquify': () => this.chooseLiquify(),
      'tool-pen': () => this.selectTool('pen'),
      'tool-marker': () => this.selectTool('marker'),
      'tool-eraser': () => this.selectTool('eraser'),
      'tool-shape-eraser': () => this.chooseShapeEraser(),
      'tool-shape-stacker': () => this.chooseShapeStacker(),
      'tool-split': () => this.selectTool('split'),
      'clip-make': () => this.makeClipMask(),
      'clip-release': () => this.releaseClipMask(),
      'apply-erasers': () => this.applyErasers(),
      'tool-text': () => this.selectTool('text'),
      'tool-copic': () => this.selectTool('copic'),
      'tool-pencil': () => this.choosePencil(),
      'tool-smear': () => this.selectTool('smear'),
      'tool-point': () => this.selectTool('point'),
      'add-layer': () => this.addLayer(),
      'group-layer': () => this.groupActiveLayer(),
      'ungroup-layer': () => this.ungroupActiveLayer(),
      'rename-layer': () => this.renameActiveLayer(),
      'delete-layer': () => this.deleteSelectedLayers(),
      'layer-up': () => this.moveSelectedLayers(1),
      'layer-down': () => this.moveSelectedLayers(-1),
      'hide-layers': () => this.toggleLayers(false),
      'add-page-default': () => this.addDefaultPage(),
      'add-page-custom': () => this.openPageSettings({ forNewPage: true }),
      'add-page-from-selection': () => this.addPageFromSelection(),
      'delete-page': () => this.deletePage(),
      'page-settings': () => this.openPageSettings(),
      'hide-pages': () => this.togglePages(false),
      'script-from-media': () => void this.generateFromMediaFile(),
      'script-from-layers': () => this.generateFromLayers(),
      'script-from-history': () => this.openHistoryScript(),
      'track-history': () => this.toggleTrackHistory(),
      'tool-select': () => this.selectTool('select'),
      'tool-rect': () => this.selectTool('rect'),
      'tool-ellipse': () => this.selectTool('ellipse'),
      'tool-curve': () => this.selectTool('curve'),
      'tool-bucket': () => this.selectTool('bucket'),
      'tool-fill': () => this.selectTool('fill'),
      'tool-eyedrop': () => this.selectTool('eyedrop'),
      'toggle-transform': () => this.toggleTransformTool(),
      'stroke-profile': () => this.openProfileDialog(),
      'clear-page': () => this.store.clear(),
      'toggle-selection-borders': () => this.toggleSelectionBorders(),
      'quick-width': () => this.startQuickEntry('width'),
      'quick-opacity': () => this.startQuickEntry('opacity'),
      'quick-zoom': () => this.startQuickZoom(),
      'cycle-color': () => this.cycleColor(1),
      'fill-in-front': () => this.toggleColorTarget(),
      'swap-fill-stroke': () => this.swapFillStroke(),
      'cycle-color-back': () => this.cycleColor(-1),
      'wipe-in': () => this.runWipe('in'),
      'wipe-out-front': () => this.runWipe('out-front'),
      'wipe-out-back': () => this.runWipe('out-back'),
      'wipe-mid': () => this.runWipe('mid'),
      'wipe-outer': () => this.runWipe('outer'),
      'wipe-clean': () => this.runWipe('clean'),
    };
  }

  /**
   * Makes a tool current: its toolbar button, its menu row and its key all
   * come here. Asked for mid-press - a shortcut key while a drag is under
   * way - the change waits for the release, so the drag finishes as the tool
   * it began with.
   */
  private selectTool(tool: Tool): void {
    if (this.press) {
      this.whenPressEnds(() => this.selectTool(tool));
      return;
    }
    // Ctrl on a drawing tool gives whichever selection tool was chosen last.
    if (tool === 'select' || tool === 'point') this.lastSelectionTool = tool;
    // A tool chosen while Ctrl lends the selection tool stands when Ctrl
    // comes up: there is no drawing tool to give back any more.
    this.springFrom = null;
    this.store.setTool({ tool });
    this.updateCursor();
    if (tool === 'warp') this.beginWarpTool();
  }

  /** Adds a layer and names it in a toast. */
  private addLayer(): void {
    this.store.addLayer();
    this.toast(`Added layer "${this.store.activeLayer.name}".`);
  }

  /** Deletes the page in view. */
  private deletePage(): void {
    this.store.removePage();
    this.renderThumbnails();
  }

  /**
   * The answers to the menus' questions as the app stands: what a right-click
   * menu greys when it opens, and what the menu bar greys and checks.
   */
  private menuState(): MenuState {
    return {
      noSelection: this.exportSelectionStrokes().length === 0,
      noMarksSelected: this.store.selectedMarkCount === 0,
      noClipboard: clipboardMarkCount(this.clipboard) === 0,
      cannotUndo: !this.store.canUndo,
      cannotRedo: !this.store.canRedo,
      notGroup: this.store.activeLayer.group !== true,
      onePage: this.store.book.sketches.length <= 1,
      firstPage: this.store.activeIndex <= 0,
      lastPage: this.store.activeIndex >= this.store.book.sketches.length - 1,
      layersHidden: !this.layersOpen,
      pagesHidden: !this.pagesOpen,
      historyTracking: this.settings.trackHistory,
      noHistory: !this.settings.trackHistory || this.tracker.count === 0,
      transformBox: this.transformActive,
      noLegacyErasers: !this.store.sketch.strokes.some((s) => s.tool === 'eraser'),
      fillInFront: this.store.tool.colorTarget === 'fill',
      fewerThanTwoShapes: this.wipeableSelection().length < 2,
      noClipGroup: this.releaseTarget() === null,
    };
  }

  /** Tells the menu bar the answers, when they differ from the ones it has. */
  private publishMenuState(): void {
    const state = this.menuState();
    const key = JSON.stringify(state);
    if (key === this.sentMenuState) return;
    this.sentMenuState = key;
    try {
      window.napkin.setMenuState(state);
    } catch {
      // Outside Electron there is no menu bar to tell.
    }
  }

  /**
   * Runs the command a key asked for. Two keys stand aside when there is
   * nothing for them to do, so the keypress goes on to whatever else wants
   * it, as they always have: Move's key while nothing can be moved, and
   * Delete's while nothing is selected. Rotate from the keyboard opens its
   * quick form, which says the canvas can be dragged to turn the selection.
   */
  private runKey(id: MenuCommand, e?: KeyboardEvent): void {
    if (id === 'move-selection' && !this.canOpenMoveDialog()) return;
    if (id === 'delete-selection' && this.store.selectedMarkCount === 0 && this.store.selectedLayerIds.size === 0) return;
    e?.preventDefault();
    if (id === 'rotate') this.openRotateDialog(true);
    else this.runCommand(id);
  }

  /** What a reload key says when no command has it. */
  private reloadRefusal(): string {
    const save = this.keyOf('save');
    return this.store.dirty
      ? `Reload is off here - it would discard unsaved changes.${save ? ` Save with ${save}.` : ''}`
      : 'Reload is off here - it would discard the sketch.';
  }

  /**
   * Builds the registry the window draws its menus and reads its keys from,
   * out of the user's menu files as the main process read them. What in them
   * could not be used is logged, and comes back as one sentence for the
   * caller to show, or null when there is nothing to say.
   */
  private applyMenuConfig(config: MenuConfig): string | null {
    this.menuRegistry = loadRegistry({ toolTypes: config.toolTypes, shortcuts: config.shortcuts });
    const problems = [...config.problems, ...this.menuRegistry.problems];
    for (const problem of problems) console.warn(`napkin-sketch menus: ${problem}`);
    if (problems.length === 0) return null;
    return problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`;
  }

  /**
   * Edit > Edit Keyboard Shortcuts: every tool and its shortcut in the
   * configuration popup (see editors.ts). Accept saves the changes through the
   * main process, which keeps only what differs from the app's own shortcuts
   * in the user's file; Reset to defaults puts the app's own in the table for
   * Accept to keep.
   */
  private openShortcutEditor(): void {
    const registry = this.menuRegistry;
    const rows = shortcutRows(registry);
    const spec = shortcutEditorSpec(registry, rows, {
      mac: IS_MAC,
      onAccept: (accepted) => this.saveShortcuts(registry, accepted),
      onReset: () => {
        this.configDialog.setRows(defaultShortcutRows(rows), { asEdits: true });
        this.configDialog.say("The app's own shortcuts are in the table. Accept keeps them; Cancel keeps yours.", 'ok');
      },
    });
    if (!this.configDialog.open(spec)) this.toast('Another editor is open. Accept or cancel it first.');
  }

  /**
   * Saves what Edit Keyboard Shortcuts accepted. A throw keeps the popup open
   * with the reason under the table; the new shortcuts arrive back through
   * `onMenuConfigChanged`, as they do for any change to the user's files.
   */
  private async saveShortcuts(registry: MenuRegistry, rows: ShortcutRow[]): Promise<void> {
    const mapping = resolveShortcuts(rows);
    const changed = Object.entries(mapping).filter(([id, chord]) => (registry.tool(id)?.chord ?? null) !== chord).length;
    if (changed === 0) {
      this.toast('No shortcuts changed.');
      return;
    }
    const result = await window.napkin.updateMenuConfig({ shortcuts: mapping });
    if (!result.ok) throw new Error(result.error);
    const defaults = Object.entries(mapping).every(([id, chord]) => (registry.tool(id)?.shippedChord ?? null) === chord);
    this.toast(defaults ? "The keyboard shortcuts are the app's own again." : `Saved ${changed} shortcut ${changed === 1 ? 'change' : 'changes'}.`);
  }

  /**
   * Edit > Edit Tool Types: every tool and the type the menus list it by, in
   * the configuration popup (see editors.ts). A type decides where a tool is
   * listed and nothing else. Accept saves the changes through the main
   * process, which keeps only what differs from the app's own types in the
   * user's file and sends the files back, so every menu is made again from
   * them; Reset to defaults puts the app's own types in the table for Accept
   * to keep.
   */
  private openToolTypeEditor(): void {
    const registry = this.menuRegistry;
    const rows = toolTypeRows(registry);
    const spec = toolTypeEditorSpec(registry, rows, {
      mac: IS_MAC,
      onAccept: (accepted) => this.saveToolTypes(registry, accepted),
      onReset: () => {
        this.configDialog.setRows(defaultToolTypeRows(rows), { asEdits: true });
        this.configDialog.say("The app's own types are in the table. Accept keeps them; Cancel keeps yours.", 'ok');
      },
    });
    if (!this.configDialog.open(spec)) this.toast('Another editor is open. Accept or cancel it first.');
  }

  /** Saves what Edit Tool Types accepted; a throw keeps the popup open with the reason under the table. */
  private async saveToolTypes(registry: MenuRegistry, rows: ToolTypeRow[]): Promise<void> {
    const mapping = resolveToolTypes(rows);
    const changed = Object.entries(mapping).filter(([id, type]) => (registry.tool(id)?.placement ?? null) !== type).length;
    if (changed === 0) {
      this.toast('No tool types changed.');
      return;
    }
    const result = await window.napkin.updateMenuConfig({ toolTypes: mapping });
    if (!result.ok) throw new Error(result.error);
    const defaults = Object.entries(mapping).every(([id, type]) => (registry.tool(id)?.shippedPlacement ?? null) === type);
    this.toast(
      defaults
        ? 'Every tool is listed where the app puts it again.'
        : `Saved ${changed} tool type ${changed === 1 ? 'change' : 'changes'}. The menus list them there now.`,
    );
  }

  // ---- Automate > Generate Script -----------------------------------------------------------

  /** Generate Script > From Media File: a file picked as for File > Import, written as a script. */
  private async generateFromMediaFile(): Promise<void> {
    const result = await window.napkin.importFile();
    if (!result.ok) {
      if (!result.cancelled) this.toast(result.error ?? 'Could not read the file.');
      return;
    }
    this.showMediaScript(result);
  }

  /**
   * Writes a read file as a script and shows it: an SVG through the importer
   * (which needs this window's DOM) into a page of its own, a PDF's pages, or
   * a picture placed at its size. True when the dialog opened.
   */
  private showMediaScript(result: ImportFileSuccess): boolean {
    const kind = 'From Media File';
    try {
      if (result.kind === 'svg') {
        const imported = importSvg(result.text, { unnamedRootName: result.name });
        this.scriptDialog.open({ kind, script: scriptFromPages([importedToSketch(imported, result.name)], result.fileName) });
      } else if (result.kind === 'pdf') {
        this.scriptDialog.open({ kind, script: scriptFromPages(pdfPagesToSketches(result.pages, result.name), result.fileName) });
      } else {
        const picture = { name: result.name, fileName: result.fileName, dataUrl: result.dataUrl };
        this.scriptDialog.open({
          kind,
          script: rasterScript(picture, { embed: false }),
          embed: (on) => rasterScript(picture, { embed: on }),
        });
      }
      return true;
    } catch (err) {
      this.toast(`Could not write a script from ${result.fileName}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * The layers Selected Layers writes: the lit rows of the Layers panel, or
   * with none lit, the layers the selected marks are on.
   */
  private scriptLayerIds(): string[] {
    if (this.store.selectedLayerIds.size > 0) return [...this.store.selectedLayerIds];
    const first = this.store.sketch.layers.find((layer) => !layer.group)?.id;
    const ids = this.propertyStrokes()
      .map((stroke) => stroke.layer ?? first)
      .filter((id): id is string => id !== undefined);
    return [...new Set(ids)];
  }

  /** Generate Script > Selected Layers: the chosen layers written as a script, the page kept or fitted to them. */
  private generateFromLayers(): void {
    const ids = this.scriptLayerIds();
    if (ids.length === 0) {
      this.toast('Select a layer, or a mark on one, to write a script from.');
      return;
    }
    const page = { ...this.store.sketch, name: `${this.store.sketch.name}-selection` };
    const source = `${ids.length} ${ids.length === 1 ? 'layer' : 'layers'}`;
    const write = (fit: boolean): GeneratedScript => scriptFromPages([page], source, { layers: ids, page: fit ? 'fit' : 'keep' });
    this.scriptDialog.open({ kind: 'Selected Layers', script: write(false), fit: write });
  }

  private async copyScript(text: string): Promise<void> {
    try {
      await window.napkin.writeClipboardText(text);
      const lines = text.trimEnd().split('\n').length;
      this.toast(`Copied the script, ${lines} ${lines === 1 ? 'line' : 'lines'}.`);
    } catch {
      this.toast('Could not copy the script.');
    }
  }

  private async saveScript(text: string, name: string): Promise<void> {
    try {
      const result = await window.napkin.saveText(text, name, 'napkin');
      if (result.ok) this.toast(`Saved the script as ${basename(result.filePath ?? `${name}.napkin`)}.`);
      else if (!result.cancelled) this.toast(result.error ?? 'Could not save the script.');
    } catch {
      this.toast('Could not save the script.');
    }
  }

  /**
   * Open as New Page: the script run into pages of its own, after the page in
   * view. The script is the one the dialog showed, run as written; a script
   * that reports an error opens nothing. True when the pages were added.
   */
  private openScriptAsPages(script: GeneratedScript): boolean {
    const result = evaluate(script.text, { timestamp: new Date().toISOString(), name: script.name });
    const error = result.diagnostics.find((diagnostic) => diagnostic.level === 'error');
    if (error) {
      this.toast(`The script did not run: ${error.message}`);
      return false;
    }
    const pages = result.book.sketches.map(withNewIds);
    this.store.addImportedPages(pages);
    this.renderThumbnails();
    this.toast(pages.length === 1 ? `Opened "${pages[0].name}" as a new page.` : `Opened ${pages.length} new pages.`);
    return true;
  }

  // ---- Automate > Track History --------------------------------------------------------------

  /** Automate > Track History: turns the recording on or off, as the switch in Verbose Settings does. */
  private toggleTrackHistory(): void {
    void this.saveSettings({ trackHistory: !this.settings.trackHistory });
  }

  /**
   * Listens to the store's history while Track History is on, and keeps the
   * steps to the History Limit. Turning it off clears the steps: a later
   * step could change a mark drawn while nothing was recorded, and a script
   * written from such a history could not draw it.
   */
  private applyHistoryTracking(): void {
    const on = this.settings.trackHistory;
    const was = this.stopTracking !== null;
    this.tracker.setLimit(this.settings.historyLimit);
    if (on && !was) {
      this.stopTracking = this.store.onHistory((event) => this.onHistoryEvent(event));
    } else if (!on && was) {
      this.stopTracking?.();
      this.stopTracking = null;
    }
    if (this.trackingKnown && on !== was) {
      const cleared = this.tracker.count;
      if (on) {
        this.toast(`Track History is on: every step of the drawing is recorded, and the last ${this.tracker.limit} are kept.`);
      } else {
        this.toast(
          cleared > 0
            ? `Track History is off, and the ${cleared} recorded ${cleared === 1 ? 'step is' : 'steps are'} cleared.`
            : 'Track History is off.',
        );
      }
    }
    if (!on) this.tracker.clear();
    this.trackingKnown = true;
    this.reportHistoryStats();
  }

  /** A step closed, or a new document started a new history. */
  private onHistoryEvent(event: HistoryEvent): void {
    if (event.type === 'reset') {
      const cleared = this.tracker.count;
      this.tracker.clear();
      if (cleared > 0) {
        this.toastAfterCurrent(
          `A new document starts a new history: the ${cleared} recorded ${cleared === 1 ? 'step was' : 'steps were'} cleared.`,
        );
      }
    } else {
      this.tracker.pushStep(event.step, describeStep(event.step, (id) => this.commandInfo(id)));
    }
    this.reportHistoryStats();
    this.publishMenuState();
  }

  /**
   * Generate Script > From Session History: the steps recorded on this page,
   * each ticked, in the configuration popup the mockup draws - the History
   * Limit across the top, a row per step with its index, tool type and
   * command, a search over the type and the command, a radio button for each
   * main type. Accept writes the ticked steps as a script and shows it in the
   * Generated script dialog; an unticked step is left out of the drawing as
   * if it had not happened.
   */
  private openHistoryScript(): void {
    if (!this.settings.trackHistory) {
      this.toast('Turn on Automate > Track History first: the steps it records are what this script is written from.');
      return;
    }
    this.store.flushHistoryStep();
    const page = this.store.activeIndex;
    const steps = this.tracker.steps.filter((step) => step.page === page);
    if (steps.length === 0) {
      this.toast(
        this.tracker.count > 0
          ? 'Nothing is recorded on this page: the steps recorded so far are on other pages.'
          : 'Nothing is recorded yet. Draw with Track History on, then write the script.',
      );
      return;
    }
    type Row = { include: boolean; index: number; type: string; label: string; at: string };
    const rows: Row[] = steps.map((step) => ({ include: true, index: step.index, type: step.type, label: step.label, at: step.at }));
    const mains = [...new Set(steps.map((step) => step.type.split(':')[0]))];
    const opened = this.configDialog.open<Row>({
      title: 'Generate Script: From Session History',
      hint: 'Uncheck history items to exclude from script.',
      header: `History Limit : ${this.tracker.limit}  (${this.tracker.count} of ${this.tracker.limit} steps recorded)`,
      search: { placeholder: 'Search the tool types and commands', text: (row) => `${row.type} ${row.label}` },
      filters: mains.map((main) => ({ label: main, test: (row: Row) => row.type === main || row.type.startsWith(`${main}:`) })),
      columns: [
        { kind: 'check', heading: '', field: 'include', width: '2.5rem', title: (row) => (row.include ? 'Written in the script' : 'Left out of the script') },
        { kind: 'text', heading: 'Index', field: 'index', width: '4.5rem' },
        { kind: 'text', heading: 'Tool type', field: 'type', width: '42%' },
        { kind: 'text', heading: 'Command', field: 'label', title: (row) => localMinute(row.at) },
      ],
      rows,
      rowLabel: (row) => `Step ${row.index}, ${row.label}`,
      empty: 'No step matches the search.',
      accept: {
        onAccept: (edited) => {
          const include = new Set(edited.filter((row) => row.include).map((row) => row.index));
          if (include.size === 0) throw new Error('Tick at least one step to write.');
          const script = scriptFromHistory(steps, this.store.sketch, {
            page,
            include,
            version: this.appVersion ?? undefined,
            now: new Date().toISOString(),
            time: localMinute,
          });
          // The popup closes once this returns; the script's dialog opens after it.
          window.setTimeout(() => this.scriptDialog.open({ kind: 'From Session History', script }), 0);
        },
      },
    });
    if (!opened) this.toast('Finish with the editor that is open first.');
  }

  /** A menu row's type and full name, which a recorded step is named by. */
  private commandInfo(id: string): CommandInfo | null {
    const tool = this.menuRegistry.tool(id);
    return tool ? { type: tool.type, name: tool.name } : null;
  }

  /** The figures Verbose Settings shows under the History Limit. */
  private historyStatsNow(): HistoryStats {
    return {
      tracking: this.settings.trackHistory,
      steps: this.tracker.count,
      limit: this.tracker.limit,
      bytes: this.tracker.estimateBytes(),
    };
  }

  /** Tells the main process the figures, at most five times a second, for a settings window that may be open. */
  private reportHistoryStats(): void {
    if (this.historyStatsTimer !== null) return;
    this.historyStatsTimer = window.setTimeout(() => {
      this.historyStatsTimer = null;
      try {
        window.napkin.reportHistoryStats(this.historyStatsNow());
      } catch {
        // Outside Electron there is no settings window to tell.
      }
    }, 200);
  }

  /** A command's shortcut as the user reads it, or null when it has none. */
  private keyOf(id: string): string | null {
    const chord = this.menuRegistry.tool(id)?.chord ?? null;
    return chord === null ? null : displayChord(chord, { mac: IS_MAC });
  }

  /**
   * Writes a command's shortcut into a tooltip: `{key}` in the element's
   * title template becomes the chord, or ` ({key})` goes when the command
   * has none. The template is the title the markup gave, kept aside the first
   * time, so writing again after the shortcuts change starts from it.
   */
  private applyShortcutTitle(node: HTMLElement): void {
    const id = node.dataset.command;
    if (!id) return;
    const template = node.dataset.titleTemplate ?? node.title;
    node.dataset.titleTemplate = template;
    const key = this.keyOf(id);
    node.title = key === null ? template.replace(/ ?\(\{key\}\)/, '') : template.replace('{key}', key);
  }

  /** Every tooltip that names a command, with its shortcut as the menu registry gives it now. */
  private applyShortcutTitles(): void {
    for (const node of document.querySelectorAll<HTMLElement>('[data-command]')) this.applyShortcutTitle(node);
  }

  /** The rows of one of the menus drawn inside the window, as the app stands now. */
  private windowMenu(contextId: string): ContextMenuItem[] {
    return contextMenuItems(contextItems(this.menuRegistry, contextId, this.menuState()), (id) => this.runCommand(id), {
      mac: IS_MAC,
    });
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
      if (this.moveDialogOpen) this.closeMoveDialog();
      if (this.rotateDialogOpen) this.closeRotateDialog(true);
      if (this.mirrorDialogOpen) this.closeMirrorDialog();
      if (this.transformActive) this.closeTransformTool();
      this.selectTool('select');
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
      const source = this.animationSourceLayer();
      const setup = await this.animationStep2(
        source?.name ?? null,
        this.animationPartNames(source),
        source ? this.animationFacing([source.id]) : null,
      );
      if (!setup) return;

      if (setup.category === 'character') {
        const missing = missingAssemblies(this.store.sketch);
        if (missing.length > 0) {
          const mapped = await this.animationStep1(missing);
          if (!mapped) return;
        }
      }

      if (setup.measured) {
        if (!(await this.animationDrawMeasured(setup))) return;
        continue;
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
  private animationStep2(
    sourceName: string | null,
    partNames: readonly string[],
    detectedFacing: AnimationFacing | null,
  ): Promise<{
    category: AnimationCategory;
    type: string;
    frames: number;
    prompt: string | null;
    apiDisabled: boolean;
    facing: AnimationFacing;
    /** True when the whole sequence is to be drawn now from the measured cycle, with no AI. */
    measured: boolean;
  } | null> {
    return new Promise((resolve) => {
      const dlg = el('anim-step2-dialog');
      const category = el<HTMLSelectElement>('anim-category');
      const type = el<HTMLSelectElement>('anim-type');
      const frames = el<HTMLInputElement>('anim-frames');
      const prompt = el<HTMLTextAreaElement>('anim-prompt');
      const poseDisabled = el<HTMLInputElement>('anim-pose-disabled');
      const facingLeft = el<HTMLInputElement>('anim-facing-left');
      const facingRight = el<HTMLInputElement>('anim-facing-right');
      // Preselected from the drawing, never decided by it: a figure drawn
      // three-quarters on has no facing to find, and the person running the
      // wizard is looking at the picture.
      facingLeft.checked = detectedFacing === 'left';
      facingRight.checked = detectedFacing !== 'left';

      // The layers no assembly answers to. A measured run can only write a
      // transform for a layer the rig can name, so this is the part of the
      // figure that holds still - and knowing it before eight frames are drawn
      // is the whole reason the choice below is offered rather than assumed.
      const orphans = partNames.filter(
        (name) => !REQUIRED_ASSEMBLIES.some((a) => matchesAssembly(name, a)),
      );

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

      // What the choice costs, in this figure's own numbers. An object has no
      // assemblies to miss, so the count is only mentioned for a character.
      const updatePoseNote = (): void => {
        const counted =
          category.value === 'character' && orphans.length > 0
            ? ` ${orphans.length} of ${partNames.length} layers here match no assembly: ${orphans.join(', ')}.`
            : '';
        el('anim-pose-note').textContent = poseDisabled.checked
          ? `The helper judges every angle itself and poses every layer, so the note below carries more of the sequence than usual.${counted}`
          : `The app measures the joints and hands over finished angles.${counted}${
              counted ? ' A measured run leaves those layers exactly where they are.' : ''
            }`;
      };

      // What the app could and could not tell from the figure itself, so a
      // preselection that is wrong is visibly a guess rather than a finding.
      const updateFacingNote = (): void => {
        const found =
          detectedFacing === null
            ? category.value === 'character'
              ? 'This figure\u2019s feet point opposite ways, so it is not drawn in profile and the app has no reading to offer \u2014 set this from the drawing.'
              : ''
            : `The figure\u2019s feet point ${detectedFacing}.`;
        const cost =
          facingLeft.checked
            ? ' The measured cycles were drawn walking right, so every angle is mirrored for this one.'
            : ' The measured cycles were drawn walking right, so their angles apply as they are.';
        el('anim-facing-note').textContent = category.value === 'object' ? '' : found + cost;
      };

      // The measured frames are offered where there is a cycle to draw them
      // from and a rig to turn: a character type with a measured cycle, posed
      // by the measured joints. Disable API says the rig does not fit.
      const measuredButton = el('anim-step2-measured');
      const updateMeasured = (): void => {
        const offered =
          category.value === 'character' && MEASURED_ANIMATION_TYPES.includes(type.value) && !poseDisabled.checked;
        measuredButton.classList.toggle('is-hidden', !offered);
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
        updatePoseNote();
        updateFacingNote();
        updateMeasured();
      };
      type.onchange = () => {
        fillFrames();
        updateNote();
        updateMeasured();
      };
      frames.oninput = updateNote;
      for (const radio of [el<HTMLInputElement>('anim-pose-measured'), poseDisabled]) {
        radio.onchange = () => {
          updatePoseNote();
          updateMeasured();
        };
      }
      for (const radio of [facingLeft, facingRight]) {
        radio.onchange = updateFacingNote;
      }
      fillTypes();
      fillFrames();
      updateNote();
      updatePoseNote();
      updateFacingNote();
      updateMeasured();

      const done = (
        value: {
          category: AnimationCategory;
          type: string;
          frames: number;
          prompt: string | null;
          apiDisabled: boolean;
          facing: AnimationFacing;
          measured: boolean;
        } | null,
      ): void => {
        dlg.classList.add('is-hidden');
        resolve(value);
      };
      const chosen = (measured: boolean) => ({
        category: category.value as AnimationCategory,
        type: type.value,
        frames: clampSequenceFrames(Number(frames.value)),
        // Cleaned where it is read rather than where it is used, so the one
        // place that knows it came from a person is the one that tidies it.
        prompt: normalizeAnimationPrompt(prompt.value),
        apiDisabled: poseDisabled.checked,
        facing: (facingLeft.checked ? 'left' : 'right') as AnimationFacing,
        measured,
      });
      el('anim-step2-next').onclick = () => done(chosen(false));
      measuredButton.onclick = () => done(chosen(true));
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
    prompt: string | null;
    apiDisabled: boolean;
    facing: AnimationFacing;
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
          // Disabling the measuring is the same handover a type with no cycle
          // table gets: no angles at all. What changes is that the form says
          // the silence was chosen, and names the layers the rig cannot reach.
          transforms:
            step && !setup.apiDisabled
              ? animationFrameTransforms(
                  step,
                  pose.pivots,
                  pose.figureHeight,
                  pose.figurePivot,
                  setup.facing,
                )
              : {},
          layers: this.animationLayerInventory(sourceIds),
          frames: setup.frames,
          // The same note goes on every frame of the sequence: it describes the
          // animation, not this one step of it, and a helper drawing frame six
          // needs the reason as much as the one that drew frame one.
          prompt: setup.prompt,
          apiDisabled: setup.apiDisabled,
          facing: setup.facing,
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
   * Draws the whole sequence at once from the measured cycle, with no AI: a
   * script from `measuredFramesScript` copies the figure's parts onto a frame
   * each and turns them about their joints by the cycle's totals. The script
   * is shown before it runs - a generated script is read before it touches the
   * page - and the frames land as the helper's frames land: a group layer
   * each, folded, standing in a strip beside the source, and saved to the
   * animations folder. One undo takes the whole sequence back off the page.
   *
   * Resolves true when another animation should be set up.
   */
  private async animationDrawMeasured(setup: { type: string; frames: number; facing: AnimationFacing }): Promise<boolean> {
    const root = this.animationSourceLayer();
    const sourceIds = root ? [root.id] : [...findAssemblyLayers(this.store.sketch).values()].map((l) => l.id);
    let plan: MeasuredFrames;
    try {
      plan = measuredFramesScript(this.store.sketch, {
        type: setup.type,
        frames: setup.frames,
        facing: setup.facing,
        ...(root ? { root: root.id } : {}),
      });
    } catch (err) {
      this.toast(err instanceof MeasuredFramesError ? `No measured frames: ${err.message}.` : `The frames could not be drawn: ${(err as Error).message}`);
      return false;
    }
    if (!(await this.animationScriptPrompt(plan, setup.type))) return false;

    this.animationBusy = true;
    try {
      const result = evaluate(plan.script, { documents: plan.documents });
      if (!result.ok) {
        const error = result.diagnostics.find((d) => d.level === 'error');
        this.toast(`The frames did not draw: ${error?.message ?? 'the script has errors'}`);
        return false;
      }
      const before = new Set(this.store.sketch.layers.map((l) => l.id));
      // Every frame in one step, so one undo takes the sequence back.
      this.store.pasteLayerTree(this.measuredFrameTrees(result.book.sketches), null);
      const frames = this.store.sketch.layers.filter((l) => !before.has(l.id) && !l.parent);
      this.foldImportedLayers(before);
      // A strip, as the helper's frames stand: each beside the one before it.
      let previous = sourceIds;
      for (const frame of frames) {
        this.animationPlaceFrame(frame.id, previous);
        previous = [frame.id];
      }
      this.fitAllInView();
      for (const frame of frames) {
        try {
          await window.napkin.saveAnimationFrame(frame.name, this.animationSubtreeSvg([frame.id]));
        } catch {
          // Outside Electron there is no output folder to write.
        }
      }
      this.toast(`Drew ${frames.length} ${setup.type} frames from the measured cycle.`);
      return await this.animationDonePrompt(frames.length);
    } finally {
      this.animationBusy = false;
    }
  }

  /**
   * The drawn pages' layers as the trees the store pastes: each layer's name,
   * opacity, visibility and lock, and its marks in the order they were drawn,
   * counted across every page so the frames paste in order.
   */
  private measuredFrameTrees(pages: readonly Sketch[]): LayerTreeNode[] {
    let order = 0;
    const tree = (node: LayerNode): LayerTreeNode => ({
      name: node.layer.name,
      group: node.layer.group === true,
      opacity: node.layer.opacity,
      visible: node.layer.visible,
      locked: node.layer.locked,
      marks: node.strokes.map((stroke) => ({ stroke, order: order++ })),
      children: node.children.map(tree),
    });
    return pages.flatMap((page) => layerTree(page).map(tree));
  }

  /**
   * Shows the script that draws the measured frames, and in a sentence what
   * it will do, before it runs. Resolves true when the frames are to be drawn.
   */
  private animationScriptPrompt(plan: MeasuredFrames, type: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dlg = el('anim-script-dialog');
      const first = plan.frames[0];
      const last = plan.frames[plan.frames.length - 1];
      const facing = plan.facingFrom === 'feet' ? `travelling ${plan.facing}, the way its feet point` : `travelling ${plan.facing}`;
      el('anim-script-msg').textContent =
        `${plan.frames.length} frames, ${first} to ${last}, from the measured ${type} cycle and no AI: the figure's parts copied onto each ` +
        `frame and turned about their joints, ${facing}. This is the script that draws them; nothing on the page changes until you draw them.`;
      el('anim-script-text').textContent = plan.text;
      const done = (run: boolean): void => {
        dlg.classList.add('is-hidden');
        resolve(run);
      };
      el('anim-script-run').onclick = () => done(true);
      el('anim-script-cancel').onclick = () => done(false);
      dlg.classList.remove('is-hidden');
    });
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
  /**
   * The names of the layers directly inside the source frame.
   *
   * Enough for the setup dialog to say how much of this figure the rig can
   * reach, which is what decides whether measuring it is worth doing. No
   * geometry is read: a layer either carries a name an assembly answers to or
   * it does not.
   */
  private animationPartNames(source: Layer | undefined): string[] {
    if (!source) return [];
    return this.store.sketch.layers.filter((l) => l.parent === source.id).map((l) => l.name);
  }

  /**
   * Which way the source figure is drawn to travel, or null when its own feet
   * disagree and there is no answer to give.
   *
   * Read from the feet because a foot is the one part of a figure that cannot
   * be read two ways - see {@link figureFacing}. The result preselects the
   * Facing choice in the setup dialog rather than deciding it: the drawing is
   * in front of the user, and a figure drawn three-quarters on has no facing
   * for this to find however carefully it looks.
   */
  private animationFacing(rootIds: string[]): AnimationFacing | null {
    const sketch = this.store.sketch;
    const scope = new Set<string>();
    for (const rootId of rootIds) {
      scope.add(rootId);
      for (const id of descendantLayerIds(sketch, rootId)) scope.add(id);
    }
    const spans: AnimationFootSpan[] = [];
    for (const layer of sketch.layers) {
      if (!scope.has(layer.id)) continue;
      if (!REQUIRED_ASSEMBLIES.some((a) => a.endsWith('leg-assembly') && matchesAssembly(layer.name, a))) {
        continue;
      }
      const leg = this.animationLayerBounds([layer.id]);
      if (!leg) continue;
      // The foot is a layer inside this leg, so a figure with two feet gives
      // two readings and a figure with none gives no opinion at all.
      for (const id of descendantLayerIds(sketch, layer.id)) {
        const child = sketch.layers.find((l) => l.id === id);
        if (!child || !matchesFoot(child.name)) continue;
        const foot = this.animationLayerBounds([child.id]);
        if (foot) spans.push({ leg, foot });
      }
    }
    return figureFacing(spans);
  }

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
    this.foldImportedLayers(before);
    return added?.id ?? null;
  }

  /**
   * Folds everything an import just added, so it arrives as a row rather than
   * as a panel.
   *
   * An illustrated character is a group of assemblies, each a group of parts,
   * each a group of outlines: one figure is sixty-odd rows, and two of them
   * leave the layers panel showing nothing but itself, with the page it is
   * describing scrolled off the top. Whatever arrived is one thing to the
   * person who imported it, so it arrives folded and the caret opens it.
   *
   * Every new group is folded, not only the outermost: folding the outer one
   * alone hides the rows, and the first click on its caret then spills all
   * sixty back out at once.
   *
   * `before` is the layer ids as they stood before the import, which is what
   * makes this work for one root or twenty without being told which. It does
   * nothing for an import that is a flat run of layers with no group among
   * them - there is nothing to fold - and that is the one shape of import
   * that still fills the panel.
   */
  private foldImportedLayers(before: ReadonlySet<string>): void {
    const sketch = this.store.sketch;
    const added = sketch.layers.filter((l) => !before.has(l.id));
    for (const layer of added) {
      if (layer.group) this.collapsedGroups.add(layer.id);
    }
    // An import leaves the active layer on the last leaf it wrote, which is
    // now inside something folded and has no row to be active on. The panel
    // reads as having no active layer at all, so it moves out to the outermost
    // thing that did arrive - the row the import actually produced.
    const active = this.store.activeLayer;
    if (active && !before.has(active.id) && this.hasCollapsedAncestor(active)) {
      let outermost = active;
      for (const layer of added) {
        if (this.layerDepth(layer) < this.layerDepth(outermost)) outermost = layer;
      }
      this.store.activeLayerId = outermost.id;
    }
    this.renderLayers();
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
  /**
   * Measures every layer the source frame is built from, so the helper can
   * tell an arm from a head by where it sits rather than by what it is
   * called. A drawing whose layers are named `g830` or named for parts this
   * animation has never heard of still measures the same.
   *
   * The parts are the frame group's own children when it has them, and the
   * source layers themselves otherwise. Empty layers are left out: a box
   * cannot be measured for a layer holding nothing.
   */
  private animationLayerInventory(rootIds: string[]): AnimationLayerBox[] {
    const sketch = this.store.sketch;
    const single = rootIds.length === 1 ? rootIds[0] : null;
    const children = single
      ? sketch.layers.filter((l) => l.parent === single)
      : sketch.layers.filter((l) => rootIds.includes(l.id));
    const parts = children.length > 0 ? children : [];

    const measured: Array<{ name: string; bounds: AnimationBounds }> = [];
    for (const layer of parts) {
      const bounds = this.animationLayerBounds([layer.id]);
      if (bounds) measured.push({ name: layer.name, bounds });
    }
    const figure = this.animationLayerBounds(rootIds);
    if (!figure || measured.length === 0) return [];
    return animationLayerBoxes(measured, figure);
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
    el('properties-toggle').addEventListener('click', () => this.runCommand('toggle-properties'));
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

    // One element's profile, without changing the one new strokes take.
    const strokeProfile = el<HTMLSelectElement>('prop-stroke-profile');
    strokeProfile.addEventListener('change', () => {
      const shapes = this.propertyShapes().filter(profileApplies).map((stroke) => stroke.id);
      if (shapes.length === 0) return;
      const value = strokeProfile.value as StrokeProfile;
      const profile = STROKE_PROFILES.includes(value) ? value : 'uniform';
      // Default is the absent state, not a stored one, and a profile chosen
      // fresh is the plain one, however the stroke was mirrored before.
      this.store.setStrokeProps(shapes, {
        profile: profile === 'uniform' ? undefined : profile,
        profileMirrored: undefined,
      });
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
    el('move-selection').addEventListener('click', () => this.runCommand('move-selection'));
    el('move-cancel').addEventListener('click', () => this.closeMoveDialog());
    // Committing is the end of the move, from the button or from Enter alike:
    // the distance the preview was showing is made real and the palette goes.
    el('move-apply').addEventListener('click', () => {
      if (this.applyMove() && !this.popups.staysAfterApply('move-dialog')) this.closeMoveDialog();
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
    for (const id of [
      'move-dialog',
      'rotate-dialog',
      'mirror-dialog',
      'page-settings-dialog',
      'sharpen-dialog',
    ]) {
      this.popups.register(id, { moveable: true, resize: true, dockable: true });
    }
    // Which of the two kinds each tool panel is. See {@link PanelAfterApply}:
    // Move and Mirror answer one question and go; Rotate is a workbench that
    // is used again as soon as it has been used once.
    this.popups.toolRemainsInView('rotate-dialog');
    this.popups.toolGoesOutOfView('move-dialog');
    this.popups.toolGoesOutOfView('mirror-dialog');
    // The Stroke Profile picker is a chooser, not a palette: it moves out of
    // the way, but has nothing to resize or dock, and goes once it is used.
    this.popups.register('profile-dialog', { moveable: true, resize: false });
    this.popups.toolGoesOutOfView('profile-dialog');
    // The wizard's own dialogs move and resize the same way, so a step can be
    // pushed aside to see the frame it is talking about. They are not
    // dockable: a step of a modal flow parked in a column would be a prompt
    // with nothing left to answer it.
    for (const id of [
      'anim-step1-dialog',
      'anim-step2-dialog',
      'anim-script-dialog',
      'anim-step3-dialog',
      'anim-done-dialog',
      'anim-signin-dialog',
    ]) {
      this.popups.register(id, { moveable: true, resize: true });
    }
    // The configuration popup is a form with an answer, like a wizard step:
    // it moves aside and resizes to show more rows, but a question parked
    // in the dock with the drawing still in use would be one nobody answers.
    this.popups.register('config-dialog', { moveable: true, resize: true });
    // The Generated script dialog asks a question too - what to do with the
    // script - so it moves and resizes but does not dock.
    this.popups.register('script-dialog', { moveable: true, resize: true });
  }

  /**
   * The hooks a GUI check drives the page through, put up only when the app
   * was started for one (`NAPKIN_GUI_CHECK=1`): `openConfigDialog` opens the
   * configuration popup with a spec of the check's own, so the popup is
   * proved before an editor depends on it.
   */
  private installCheckHooks(): void {
    let checking = false;
    try {
      checking = window.napkin.guiCheck === true;
    } catch {
      // Outside Electron there is no check to serve.
    }
    if (!checking) return;
    const hooks = {
      openConfigDialog: (spec: ConfigDialogSpec<object>): boolean => this.configDialog.open(spec),
      configDialogOpen: (): boolean => this.configDialog.isOpen,
      // Automate > Generate Script from a file, without the file dialog a check cannot answer.
      generateScriptFromFile: async (path: string): Promise<boolean> => {
        const result = await window.napkin.readImportFile(path);
        return result.ok ? this.showMediaScript(result) : false;
      },
      scriptText: (): string | null => this.scriptDialog.script?.text ?? null,
      pageCount: (): number => this.store.book.sketches.length,
      // Turns to a page as a click on its thumbnail does.
      goToPage: (index: number): number => {
        this.turnPage(index);
        return this.store.activeIndex;
      },
      activePage: (): number => this.store.activeIndex,
      pageInfo: (index: number) => {
        const page = this.store.book.sketches[index];
        if (!page) return null;
        return {
          name: page.name,
          width: page.width,
          height: page.height,
          layers: page.layers.map((layer) => layer.name),
          marks: page.strokes.length,
          ink: inkBox(page),
        };
      },
      // Track History: the steps so far, the one in progress closed first.
      trackedSteps: () => {
        this.store.flushHistoryStep();
        return this.tracker.steps.map((step) => ({
          index: step.index,
          page: step.page,
          kind: step.kind,
          command: step.command,
          type: step.type,
          label: step.label,
          added: step.diff.added.length,
          removed: step.diff.removed.length,
          changed: step.diff.changed.length,
          layers: step.diff.layers.map((change) => change.op),
        }));
      },
      historyStats: (): HistoryStats => {
        this.store.flushHistoryStep();
        return this.historyStatsNow();
      },
      selectionInkBox: () => {
        const ids = this.scriptLayerIds();
        return ids.length > 0 ? inkBox({ ...this.store.sketch, strokes: this.strokesInLayerSubtree(ids) }) : null;
      },
      // The input a press and the held keys leave behind. `press` names every
      // per-press field still set, so a check can ask that a release, a cancel
      // or a blur left nothing behind - a pointer still owned is what stopped
      // every tool in the tools-break.
      inputState: () => ({
        activePointerId: this.activePointerId,
        pressKind: this.press?.kind ?? null,
        pressTool: this.press?.tool ?? null,
        pointers: this.pointers.size,
        press: this.pressFieldsSet(),
        spaceDown: this.spaceDown,
        ctrlDown: this.ctrlDown,
        altDown: this.altDown,
        spring: this.spring,
        springFrom: this.springFrom,
        lastSelectionTool: this.lastSelectionTool,
        nib: this.nib,
        nibRotateActive: this.nibRotateActive,
        tool: this.store.tool.tool,
        width: this.store.tool.width,
        cursor: this.canvas.style.cursor,
      }),
      // The marks of the page in view, in the page's order, with where each is.
      strokeSummary: () => {
        const sketch = this.store.sketch;
        return sketch.strokes.map((stroke) => ({
          id: stroke.id,
          tool: stroke.tool,
          layerId: stroke.layer ?? null,
          layer: layerOf(sketch, stroke).name,
          points: stroke.points.length,
          anchors: stroke.vector?.anchors.length ?? null,
          closed: stroke.vector?.closed ?? null,
          width: stroke.width,
          opacity: stroke.opacity ?? null,
          fill: stroke.fill ?? null,
          color: stroke.color,
          noStroke: stroke.noStroke === true,
          pencil: stroke.pencil ? { ...stroke.pencil } : null,
          smudges: (stroke.smudges ?? []).map((pass) => ({ width: pass.width, strength: pass.strength, anchors: pass.path.length })),
          bounds: strokeBounds(stroke, (s) => this.surface.measureText(s)),
          // Where the path starts and ends: one point on a closed shape's seam.
          first: stroke.points.length > 0 ? { x: stroke.points[0].x, y: stroke.points[0].y } : null,
          last:
            stroke.points.length > 0
              ? { x: stroke.points[stroke.points.length - 1].x, y: stroke.points[stroke.points.length - 1].y }
              : null,
        }));
      },
      // One mark's points and anchors, as the page holds them, or null.
      strokeGeometry: (id: string) => {
        const stroke = this.store.sketch.strokes.find((s) => s.id === id);
        if (!stroke) return null;
        return {
          points: stroke.points.map((p) => ({ x: p.x, y: p.y, ...(p.move ? { move: true } : {}) })),
          anchors: stroke.vector ? cloneAnchors(stroke.vector.anchors) : null,
          fitted: stroke.vector?.fitted === true,
        };
      },
      // Where the next Shift-click line starts (held-keys.ts), or null.
      lineStart: () => (this.lineStart ? { ...this.lineStart } : null),
      // The Shape Eraser: its shape, whether its panel is open and which
      // choices it offers, and the session notice showing, if one is.
      // A Wipe Stacks wipe: whether one is under way, and how far across.
      wipeState: () => ({ active: this.wipeAnim !== null, t: this.wipeAnim?.t ?? null }),
      shapeEraserState: () => {
        const panel = document.querySelector('.shape-eraser-panel');
        return {
          shape: this.shapeEraserShape,
          panelOpen: panel !== null,
          choices: panel ? Array.from(panel.querySelectorAll<HTMLElement>('button')).map((b) => b.dataset.shape ?? '') : [],
          notice: this.notices.showing?.id ?? null,
        };
      },
      // The Shape Stacker: its panel and the tiles in it, the selection's
      // pieces, the one under the pointer, and what a press has marked.
      // The Pencil: its kit, the chips it shows, and the pencil in hand.
      pencilState: () => {
        const kit = document.querySelector('.pencil-kit');
        return {
          kitOpen: kit !== null,
          chips: kit ? Array.from(kit.querySelectorAll<HTMLElement>('.pencil-chip')).map((chip) => chip.dataset.pencil ?? '') : [],
          active: kit?.querySelector<HTMLElement>('.pencil-chip.is-active')?.dataset.pencil ?? null,
          pencil: { ...this.store.tool.pencil },
          label: pencilPaint(this.store.tool.pencil).label,
          rasters: this.surface.pencilRasters,
        };
      },
      // A Smear drag under way: how far it has gone, and the marks it has reached.
      smearState: () => (this.smearDrag ? { points: this.smearDrag.points.length, reached: [...this.smearDrag.reached], others: this.smearDrag.others } : null),
      // Liquify: the brush in hand, where it is drawn, its panel, and a drag under way.
      liquifyState: () => {
        const panel = document.querySelector('.liquify-panel');
        const drag = this.liquifyDrag;
        return {
          mode: this.liquifyMode,
          radius: this.liquifyRadius,
          brush: this.liquifyBrush(),
          panelOpen: panel !== null,
          tiles: panel ? Array.from(panel.querySelectorAll<HTMLElement>('.shape-tile')).map((tile) => tile.dataset.liquify ?? '') : [],
          active: panel?.querySelector<HTMLElement>('.shape-tile.is-active')?.dataset.liquify ?? null,
          drag: drag ? (drag.kind === 'size' ? { kind: 'size' } : { kind: 'bend', bent: [...drag.bent], open: drag.open }) : null,
        };
      },
      // How long a render of the page in view takes, in ms, the mean of `n`.
      renderTime: (n = 5) => {
        const runs = Math.max(1, Math.min(50, Math.floor(n)));
        const start = performance.now();
        for (let i = 0; i < runs; i++) this.surface.render(this.store.sketch, null, { selectedIds: new Set<string>() });
        return (performance.now() - start) / runs;
      },
      shapeStackerState: () => {
        const panel = document.querySelector('.shape-stacker-panel');
        const arrangement = this.store.tool.tool === 'shape-stacker' ? this.stackerFaces() : null;
        return {
          panelOpen: panel !== null,
          tiles: panel ? Array.from(panel.querySelectorAll<HTMLElement>('.shape-tile')).map((b) => b.dataset.command ?? '') : [],
          greyed: panel ? Array.from(panel.querySelectorAll<HTMLElement>('.shape-tile.is-disabled')).length : 0,
          faces: arrangement?.faces.length ?? 0,
          problem: arrangement?.problem ?? null,
          hover: this.stackerHover,
          marked: this.stackDrag ? [...this.stackDrag.marked] : null,
          remove: this.stackDrag?.remove ?? null,
          notice: this.notices.showing?.id ?? null,
        };
      },
      // Split: the path a click would cut, where, and how far along.
      splitState: () =>
        this.splitHover
          ? {
              id: this.splitHover.strokeId,
              point: { x: this.splitHover.at.point.x, y: this.splitHover.at.point.y },
              subpath: this.splitHover.at.subpath,
              segment: this.splitHover.at.segment,
              t: this.splitHover.at.t,
            }
          : null,
      // The Vector Path being placed: its anchors, the band's end, and
      // whether a press now would close it, which the close indicator shows.
      vectorPathState: () => ({
        anchors: cloneAnchors(this.vectorAnchors),
        hover: this.vectorHover ? { x: this.vectorHover.x, y: this.vectorHover.y } : null,
        closeHover: this.vectorCloseHover,
        indicatorReady: this.surface.closeIndicatorReady(),
      }),
      // The layers of the page in view, bottom first, as the page holds them.
      layerRows: () =>
        this.store.sketch.layers.map((layer) => ({
          id: layer.id,
          name: layer.name,
          group: layer.group === true,
          parent: layer.parent ?? null,
          visible: layer.visible,
          locked: layer.locked,
          clip: layer.clip ?? null,
        })),
      // The page in view as Export SVG writes it, for a check to import again.
      pageSvg: () => Surface.toSVG(this.store.sketch),
      // The dashed boxes the canvas draws around the selection, in sketch units.
      selectionBoxes: () => this.surface.selectionBoxes(this.store.sketch, this.store.selectedIds),
      // The mark a Select click at a client point would pick, at a reach in
      // screen pixels (the Select sensitivity when none is given).
      hitAt: (clientX: number, clientY: number, tolerancePx?: number): string | null =>
        this.hitTest(this.surface.toSketchPoint(clientX, clientY, 0.5), undefined, tolerancePx)?.id ?? null,
      // What Direct Select is editing: the stroke, its picked anchors, and whether the whole path is.
      directSelectState: () => ({
        stroke: this.anchorStrokeId,
        anchors: [...this.selectedAnchors],
        pathSelected: this.pathSelected,
      }),
      viewState: () => {
        const rect = this.canvas.getBoundingClientRect();
        return {
          ...this.surface.getViewport(),
          minZoom: this.surface.getZoomLimits().min,
          maxZoom: this.surface.getZoomLimits().max,
          width: rect.width,
          height: rect.height,
        };
      },
    };
    (window as unknown as { napkinCheck: typeof hooks }).napkinCheck = hooks;
  }

  /**
   * The per-press fields that are set, by name. Between presses the list is
   * empty; a name left in it after a release is a press that never ended.
   */
  private pressFieldsSet(): string[] {
    const fields: Array<[string, unknown]> = [
      ['live', this.live],
      ['curveA', this.curveA],
      ['curveBending', this.curveBending || null],
      ['quickCurve', this.quickCurve || null],
      ['shiftLine', this.shiftLine],
      ['erasing', this.erasing],
      ['shapeErase', this.shapeErase],
      ['stackDrag', this.stackDrag],
      ['smearDrag', this.smearDrag],
      ['liquifyDrag', this.liquifyDrag],
      ['straightStart', this.straightStart],
      ['shapeStart', this.shapeStart],
      ['dragging', this.dragging || null],
      ['dragFrom', this.dragFrom],
      ['rubberBandStart', this.rubberBandStart],
      ['textDragStart', this.textDragStart],
      ['panDragging', this.panDragging || null],
      ['anchorDragKind', this.anchorDragKind],
      ['anchorDragFrom', this.anchorDragFrom],
      ['vectorDragging', this.vectorDragging || null],
      ['vectorEditDrag', this.vectorEditDrag],
      ['warpDrag', this.warpDrag],
      ['transformDrag', this.transformDrag],
      ['rotateDrag', this.rotateDrag],
      ['pendingSelectHitId', this.pendingSelectHitId],
      ['shiftToggleId', this.shiftToggleId],
    ];
    return fields.filter(([, value]) => value !== null && value !== undefined).map(([name]) => name);
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
   * Enter commits the move and closes the palette, which is what the button
   * does - the palette has one job and Enter is how a typed field says it is
   * finished. Escape closes without moving.
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
    // Both of these close the palette, and both must stop here.
    //
    // The window's own handler treats Enter as "open Move for the selection"
    // and skips itself while a text field has the focus - but closing the
    // palette takes the focus off this field, so by the time the event got
    // there the guard no longer applied and the palette it had just closed
    // was opened straight back up. The field has finished with the key, so
    // the key stops at the field.
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.applyMove() && !this.popups.staysAfterApply('move-dialog')) this.closeMoveDialog();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeMoveDialog();
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
    if (this.store.selectedMarkCount === 0) return false;
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
    // Clear of the drawing on its first opening, the way Rotate already is: the
    // preview switch redraws the selection live, and the palette was opening
    // centred - on top of the very marks it was about to show moving.
    this.popups.parkTopRight('move-dialog');
    // A panel left near an edge last time must not open off screen if the
    // window has shrunk since.
    this.clampMoveDialog();
    x.focus();
    x.select();
  }

  /**
   * Closes the dialog, taking any live preview off the canvas with it.
   *
   * The preview is a move that has not been committed - it carries no history
   * step of its own - so it can never be allowed to outlive the dialog. This
   * used to take a flag saying whether to revert, and the one call that passed
   * "no" dropped the preview where it stood: clicking **Move** with the live
   * preview on left the selection moved twice, once for real and once by the
   * preview nobody took back. There is no case that wants that, so there is no
   * longer a way to ask for it - a committed move has already cleared the
   * preview by the time this runs, and reverting nothing is free.
   */
  private closeMoveDialog(): void {
    this.revertMovePreview();
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
   * Commits the typed distance, from the **Move** button or from Enter.
   *
   * The move committed is the one the preview was already showing, and the
   * palette is finished either way. It used to put the preview back after
   * committing, so that Enter could be pressed again to step the same distance
   * a second time; what that actually produced was a selection one step beyond
   * where the palette said it would be, because the preview it re-showed was
   * never taken back off. A palette that says "move 100" moves 100.
   *
   * @returns True when the dialog's work is done and it may close; false when
   *   something typed needs fixing first.
   */
  private applyMove(): boolean {
    const targets = this.propertyTargets();
    if (targets.length === 0) {
      this.closeMoveDialog();
      return true;
    }
    const delta = this.moveDelta();
    if (!delta) {
      this.toast('Type a number for each distance.');
      return false;
    }
    // The preview is undone first so the committed move is one history step
    // covering the whole distance, not a second one stacked on a shown move.
    this.revertMovePreview();
    if (delta.dx === 0 && delta.dy === 0) return true;
    this.recordAs('move-selection', () => this.store.moveStrokes(targets, delta.dx, delta.dy));
    const xUnit = el<HTMLSelectElement>('move-x-unit').value;
    const yUnit = el<HTMLSelectElement>('move-y-unit').value;
    this.toast(
      `Moved ${targets.length} element${targets.length === 1 ? '' : 's'} by ` +
        `${el<HTMLInputElement>('move-x').value} ${xUnit}, ${el<HTMLInputElement>('move-y').value} ${yUnit}.`,
    );
    // No preview is put back: the distance has been made real, and the
    // palette is about to close over it.
    return true;
  }

  // ---- Mirror dialog -------------------------------------------------------

  /** The Mirror palette's choices, remembered while the app runs. */
  private mirrorOptions: MirrorOptions = {
    horizontal: true,
    vertical: false,
    copy: true,
    preview: true,
  };

  /** True while a preview the palette put up is on the page. */
  private mirrorPreviewing = false;

  /** What was selected when the palette opened: the selection it mirrors. */
  private mirrorSource: { strokes: string[]; layers: string[] } | null = null;

  /**
   * Bumped by every preview request, every commit and every close. A preview
   * that had to wait for an image flip checks it before drawing, so a slow
   * flip cannot put up a preview that has since changed or been cancelled.
   */
  private mirrorRequest = 0;

  /**
   * Mirrored pixels for placed images, by source image and then by axes, so a
   * preview or a commit can swap them in without waiting. Kept for one
   * opening of the palette and cleared when it goes.
   */
  private mirroredImages = new Map<string, Map<string, string>>();

  // ---- Mesh Warp -------------------------------------------------------------

  /** The warp in progress: the art being bent, its mesh and its pins. */
  private warp: WarpSession | null = null;
  /** The art under the pointer with Mesh Warp, as a click would pick it. */
  private warpHover: string[] | null = null;
  /** A pin drag in hand: the pins it carries, where the pointer last was, and whether the step is saved. */
  private warpDrag: { pins: number[]; last: Point; saved: boolean } | null = null;
  /** True while the pointer is over a pin, for the cursor. */
  private warpOverPin = false;

  /**
   * Choosing Mesh Warp with something selected meshes the selection at once:
   * Illustrator's order, select and then warp. With nothing selected the tool
   * waits for a click on art.
   */
  private beginWarpTool(): void {
    if (this.warp) return;
    const ids = this.warpableIds(this.store.selectedIds);
    if (ids.length > 0 && this.startWarp(ids)) return;
    this.toast('Click art to mesh it, then drag its pins to bend it.');
  }

  /** The strokes among `ids` a warp can bend: on a visible, unlocked layer, and not erasers. */
  private warpableIds(ids: Iterable<string>): string[] {
    const editable = this.editableStrokeIds();
    const wanted = new Set(ids);
    return this.store.sketch.strokes
      .filter((s) => wanted.has(s.id) && editable.has(s.id) && s.tool !== 'eraser' && s.points.length > 0)
      .map((s) => s.id);
  }

  /**
   * The art a click at `pt` would pick: the group one level below the
   * top-most group of the stroke under the pointer - a figure's leg assembly
   * rather than the whole figure or one of the leg's paths - or, for a stroke
   * in no group, its own layer. Null over empty canvas.
   */
  private warpArtAt(pt: Point): { ids: string[]; layerId: string } | null {
    const hit = this.hitTest(pt);
    if (!hit) return null;
    const sketch = this.store.sketch;
    const layer = layerOf(sketch, hit);
    const top = topMostParent(sketch, layer);
    let unit = layer;
    while (unit.id !== top.id && unit.parent && unit.parent !== top.id) {
      const parent = sketch.layers.find((l) => l.id === unit.parent);
      if (!parent) break;
      unit = parent;
    }
    const scope = new Set([unit.id, ...descendantLayerIds(sketch, unit.id)]);
    const byLayer = strokesByLayer(sketch);
    const inScope: string[] = [];
    for (const id of scope) for (const s of byLayer.get(id) ?? []) inScope.push(s.id);
    const ids = this.warpableIds(inScope);
    return ids.length > 0 ? { ids, layerId: unit.id } : null;
  }

  /**
   * Meshes the art and puts in its first pins: two along the long axis of its
   * biggest piece, a fifth of the way in from each end, and one in every
   * other piece. Nothing on the page changes yet - the store transaction
   * opens on the first pin that moves, so meshing and leaving costs no undo
   * step.
   */
  private startWarp(ids: string[], layerId?: string): boolean {
    const sketch = this.store.sketch;
    const wanted = new Set(ids);
    const strokes = sketch.strokes.filter((s) => wanted.has(s.id));
    if (strokes.length === 0) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of strokes) {
      const box = strokeBounds(s, (t) => this.surface.measureText(t));
      if (!box) continue;
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX);
      maxY = Math.max(maxY, box.maxY);
    }
    if (!Number.isFinite(minX)) return false;
    // Room for a stroke's round ends past its points.
    const pad = 8;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    // About 400 mask pixels along the art's long side, whatever its size.
    const scale = Math.min(4, Math.max(0.05, 400 / Math.max(maxX - minX, maxY - minY, 1)));
    const width = Math.max(1, Math.ceil((maxX - minX) * scale));
    const height = Math.max(1, Math.ceil((maxY - minY) * scale));
    const rgba = this.surface.paintMask(strokes, minX, minY, width, height, scale);
    const mesh = buildMesh(maskFromRgba(rgba, width, height, minX, minY, scale));
    if (!mesh) {
      this.toast('There is nothing there to mesh.');
      return false;
    }
    const locator = new MeshLocator(mesh);
    const pins: WarpPin[] = autoPins(mesh).map((p) => {
      const spot = locator.locate(p);
      return { triangle: spot.triangle, weights: spot.weights };
    });
    const solver = new ArapSolver(mesh);
    solver.setPins(pins);
    // The layers panel lights the art's row, as the art is meshed.
    if (layerId) this.store.selectLayer(layerId);
    this.warp = {
      sketch,
      rest: strokes.map((s) => structuredClone(s)),
      mesh,
      locator,
      solver,
      pins,
      targets: pins.map((p) => pinRest(mesh, p)),
      selected: new Set(),
      deformed: Float64Array.from(mesh.rest),
      onScreen: locator,
      undo: [],
      moved: false,
    };
    this.warpHover = null;
    this.showWarpHint(null);
    this.scheduleRender();
    return true;
  }

  /** The pin under a sketch point, within a few screen pixels of it, or -1. */
  private warpPinAt(pt: Point): number {
    const session = this.warp;
    if (!session) return -1;
    let best = -1;
    let bestD = 9 / this.surface.getViewport().zoom;
    session.targets.forEach((t, k) => {
      const d = Math.hypot(t.x - pt.x, t.y - pt.y);
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  /**
   * A press with Mesh Warp. On a pin it selects the pin - Shift adds or takes
   * it away - and picks the selected pins up. Elsewhere in the mesh it adds a
   * pin there and picks that up. Off the mesh it keeps the warp: on other art
   * it starts a new warp there, and on empty canvas it puts the tool down.
   */
  private warpPointerDown(e: PointerEvent, pt: Point): void {
    const session = this.warp;
    if (session) {
      const hit = this.warpPinAt(pt);
      if (hit >= 0) {
        if (e.shiftKey) {
          if (session.selected.has(hit)) session.selected.delete(hit);
          else session.selected.add(hit);
        } else if (!session.selected.has(hit)) {
          session.selected = new Set([hit]);
        }
        if (session.selected.has(hit)) this.beginWarpDrag(e, pt, false);
        this.scheduleRender();
        return;
      }
      if (session.onScreen.contains(pt)) {
        // The press is on the deformed mesh, which is what is on screen; its
        // weights there place the pin in the rest mesh.
        const spot = session.onScreen.locate(pt);
        this.saveWarpStep();
        session.pins.push({ triangle: spot.triangle, weights: spot.weights });
        session.targets.push({ x: pt.x, y: pt.y });
        session.selected = new Set([session.pins.length - 1]);
        session.solver.setPins(session.pins);
        this.beginWarpDrag(e, pt, true);
        this.scheduleRender();
        return;
      }
    }
    const art = this.warpArtAt(pt);
    if (session) this.keepWarp();
    if (art) this.startWarp(art.ids, art.layerId);
    this.scheduleRender();
  }

  private beginWarpDrag(e: PointerEvent, pt: Point, saved: boolean): void {
    const session = this.warp;
    if (!session) return;
    this.claimPointer(e, 'warp');
    this.warpDrag = { pins: [...session.selected], last: { x: pt.x, y: pt.y }, saved };
    this.updateCursor();
  }

  /** Pointer movement with Mesh Warp: a drag bends the art; otherwise the hover outline follows. */
  private warpPointerMove(e: PointerEvent, pt: Point): void {
    const drag = this.warpDrag;
    const session = this.warp;
    if (drag && session && this.activePointerId === e.pointerId) {
      const dx = pt.x - drag.last.x;
      const dy = pt.y - drag.last.y;
      if (dx === 0 && dy === 0) return;
      // The whole drag is one step back while the warp is open.
      if (!drag.saved) {
        this.saveWarpStep();
        drag.saved = true;
      }
      for (const k of drag.pins) {
        session.targets[k] = { x: session.targets[k].x + dx, y: session.targets[k].y + dy };
      }
      drag.last = { x: pt.x, y: pt.y };
      this.solveWarp();
      return;
    }
    const overPin = this.warpPinAt(pt) >= 0;
    const onMesh = overPin || (session !== null && session.onScreen.contains(pt));
    const art = onMesh ? null : this.warpArtAt(pt);
    const hover = art ? art.ids : null;
    const changed = (hover?.join('|') ?? '') !== (this.warpHover?.join('|') ?? '');
    this.warpHover = hover;
    if (overPin !== this.warpOverPin) {
      this.warpOverPin = overPin;
      this.updateCursor();
    }
    this.showWarpHint(hover ? e : null);
    if (changed) this.scheduleRender();
  }

  /** The release that ends a pin drag. True when there was one. */
  private warpPointerUp(e: PointerEvent): boolean {
    if (!this.warpDrag || this.activePointerId !== e.pointerId) return false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.activePointerId = null;
    this.warpDrag = null;
    const session = this.warp;
    if (session) session.onScreen = new MeshLocator({ ...session.mesh, rest: session.deformed });
    this.updateCursor();
    this.scheduleRender();
    return true;
  }

  /** "(click to select art)" beside the pointer while it is over art; hidden when `at` is null. */
  private showWarpHint(at: PointerEvent | null): void {
    const hint = el('warp-hint');
    if (!at) {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    hint.style.left = `${at.clientX + 14}px`;
    hint.style.top = `${at.clientY + 18}px`;
  }

  /**
   * Solves the mesh for the pins where they are and carries the art onto it.
   * The first time the art moves, the store transaction opens: from then the
   * warp is kept as one undo step or thrown away whole.
   */
  private solveWarp(): void {
    const session = this.warp;
    if (!session) return;
    const atRest = session.targets.every((t, k) => {
      const from = pinRest(session.mesh, session.pins[k]);
      return t.x === from.x && t.y === from.y;
    });
    if (atRest && !session.moved) {
      session.deformed = Float64Array.from(session.mesh.rest);
      return;
    }
    session.deformed = session.solver.solve(session.targets);
    const map = new MeshMap(session.mesh, session.locator, session.deformed);
    const updates = session.rest.map((stroke) => ({ id: stroke.id, ...mapStrokeGeometry(stroke, map) }));
    if (!session.moved) {
      session.moved = true;
      this.store.beginTransaction(() => this.onWarpSettled());
    }
    this.store.setStrokesGeometry(updates);
  }

  /** Something else kept the warp - an edit, an undo, a page change: the session is over. */
  private onWarpSettled(): void {
    this.warp = null;
    this.warpDrag = null;
    this.scheduleRender();
  }

  /** Remembers the pins as they are, for Ctrl+Z to step back to while the warp is open. */
  private saveWarpStep(): void {
    const session = this.warp;
    if (!session) return;
    session.undo.push({
      pins: session.pins.map((p) => ({ triangle: p.triangle, weights: [...p.weights] as [number, number, number] })),
      targets: session.targets.map((t) => ({ x: t.x, y: t.y })),
    });
  }

  /**
   * Ctrl+Z while a warp is open: back one pin move, pin added or pins taken
   * out. Back at the start, the transaction is rolled back rather than kept,
   * so a warp undone to nothing leaves no step behind.
   */
  private undoWarpStep(): void {
    const session = this.warp;
    if (!session) return;
    const step = session.undo.pop();
    if (!step) {
      this.toast('The warp is back where it began. Enter keeps it; Esc puts it down.');
      return;
    }
    const pinsChanged = JSON.stringify(step.pins) !== JSON.stringify(session.pins);
    session.pins = step.pins;
    session.targets = step.targets;
    session.selected = new Set([...session.selected].filter((k) => k < session.pins.length));
    if (pinsChanged) session.solver.setPins(session.pins);
    if (session.undo.length === 0 && session.moved) {
      session.moved = false;
      this.store.rollbackTransaction();
      session.deformed = Float64Array.from(session.mesh.rest);
    } else {
      this.solveWarp();
    }
    session.onScreen = new MeshLocator({ ...session.mesh, rest: session.deformed });
    this.scheduleRender();
  }

  /** Delete or Backspace while a warp is open: takes out the selected pins, never the art. */
  private deleteWarpPins(): void {
    const session = this.warp;
    if (!session) return;
    if (session.selected.size === 0) {
      this.toast('Select a pin to take it out - click it, Shift+click for more.');
      return;
    }
    this.saveWarpStep();
    session.pins = session.pins.filter((_, k) => !session.selected.has(k));
    session.targets = session.targets.filter((_, k) => !session.selected.has(k));
    session.selected = new Set();
    session.solver.setPins(session.pins);
    this.solveWarp();
    session.onScreen = new MeshLocator({ ...session.mesh, rest: session.deformed });
    this.scheduleRender();
  }

  /** Keeps the warp - one undo step, if the art moved - and puts it down. */
  private keepWarp(): void {
    const session = this.warp;
    if (!session) return;
    this.dropPressOf('warp');
    this.warp = null;
    this.warpDrag = null;
    if (session.moved) this.store.commitTransaction();
    this.scheduleRender();
  }

  /** Throws the warp away: the art goes back exactly as it was. */
  private cancelWarp(): void {
    const session = this.warp;
    if (!session) return;
    this.dropPressOf('warp');
    this.warp = null;
    this.warpDrag = null;
    if (session.moved) this.store.rollbackTransaction();
    this.scheduleRender();
  }

  /**
   * Undo from anywhere - a key, the toolbar, the menu: inside a warp it steps
   * back through the pins. A Shift-click line starts nowhere after it.
   */
  private undo(): void {
    this.lineStart = null;
    if (this.warp) this.undoWarpStep();
    else this.store.undo();
  }

  /** Redo from anywhere. Inside a warp there is nothing to redo, and the warp is left as it is. */
  private redo(): void {
    this.lineStart = null;
    if (!this.warp) this.store.redo();
  }

  /** What Mesh Warp draws over the canvas, when the tool is up. */
  private warpOverlay(): WarpOverlay | null {
    if (this.store.tool.tool !== 'warp') return null;
    const hoverIds = this.warpHover ? new Set(this.warpHover) : null;
    const outline = hoverIds ? this.store.sketch.strokes.filter((s) => hoverIds.has(s.id)) : undefined;
    const session = this.warp;
    if (!session) return outline ? { outline } : null;
    return {
      outline,
      mesh: this.settings.warpShowMesh
        ? { positions: session.deformed, triangles: session.mesh.triangles, boundary: session.mesh.boundary }
        : undefined,
      pins: session.targets,
      selected: [...session.selected],
    };
  }

  // ---- Stroke Profile --------------------------------------------------------

  /** The row the Stroke Profile picker has highlighted: what Select chooses. */
  private profileChoice: StrokeProfile = 'uniform';

  /** The profile the toolbar control last drew, so it redraws only on a change. */
  private shownProfile: StrokeProfile | null = null;

  /** True while the Stroke Profile picker is up. */
  private get profileDialogOpen(): boolean {
    return !el('profile-dialog').classList.contains('is-hidden');
  }

  /**
   * Wires the Stroke Profile control and its picker. Every picture, the
   * toolbar's and the list's, is drawn by the outline code the exporter uses,
   * so a row shows what choosing it will draw.
   */
  private bindStrokeProfile(): void {
    const list = el('profile-list');
    for (const profile of STROKE_PROFILES) {
      const option = document.createElement('div');
      option.id = `profile-option-${profile}`;
      option.className = 'profile-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.profile = profile;
      const name = document.createElement('span');
      name.className = 'profile-option-name';
      name.textContent = STROKE_PROFILE_LABELS[profile];
      option.append(name, profilePicture(profile, 'profile-option-picture', 120, 26));
      option.addEventListener('click', () => this.highlightProfile(profile));
      option.addEventListener('dblclick', () => {
        this.highlightProfile(profile);
        this.applyStrokeProfile();
      });
      list.appendChild(option);
    }
    el('stroke-profile').addEventListener('click', () => this.runCommand('stroke-profile'));
    el('profile-cancel').addEventListener('click', () => this.closeProfileDialog());
    // The overlay does not dim, so a press beside the picker looks like a
    // press on the app: it cancels, as it would close any dropdown.
    el('profile-dialog').addEventListener('pointerdown', (e) => {
      if (e.target === e.currentTarget) this.closeProfileDialog();
    });
    el('profile-apply').addEventListener('click', () => this.applyStrokeProfile());
    this.syncStrokeProfileControl();
  }

  /** Brings the toolbar control's picture and name up to the current profile. */
  private syncStrokeProfileControl(): void {
    const { profile } = this.store.tool;
    if (profile === this.shownProfile) return;
    this.shownProfile = profile;
    const label = STROKE_PROFILE_LABELS[profile];
    const button = el('stroke-profile');
    button.setAttribute('aria-label', `Stroke profile: ${label}`);
    // The title names the profile and, once one is given, the key.
    button.dataset.titleTemplate = `Stroke Profile: ${label} - how the width runs along new brush and marker strokes ({key})`;
    this.applyShortcutTitle(button);
    el('stroke-profile-picture')
      .querySelector('path')
      ?.setAttribute('d', profilePreviewPath(profile, 48, 10));
  }

  /**
   * Opens the picker under its control with the current profile highlighted.
   * It waits while another dialog is up, as the other panels do.
   */
  private openProfileDialog(): void {
    if (this.profileDialogOpen || this.otherDialogOpen('profile-dialog')) return;
    this.highlightProfile(this.store.tool.profile);
    el('profile-dialog').classList.remove('is-hidden');
    // Dropped below the control the first time, and kept wholly on screen:
    // the control sits at the right of the bar, where a panel hung from its
    // left edge would run off the window. A picker moved on purpose opens
    // where it was left.
    if (!this.popups.isPlaced('profile-dialog')) {
      const anchor = el('stroke-profile').getBoundingClientRect();
      const panel = el('profile-dialog').querySelector<HTMLElement>('.export-dialog-inner')!;
      const margin = 12;
      const left = Math.min(anchor.left, window.innerWidth - panel.offsetWidth - margin);
      const top = Math.min(anchor.bottom + 8, window.innerHeight - panel.offsetHeight - margin);
      this.popups.park('profile-dialog', Math.max(margin, left), Math.max(margin, top));
    }
    this.popups.clamp('profile-dialog');
    el('profile-list').focus();
  }

  private closeProfileDialog(): void {
    this.popups.releaseGrabs('profile-dialog');
    el('profile-dialog').classList.add('is-hidden');
  }

  /** Highlights one row of the picker. */
  private highlightProfile(profile: StrokeProfile): void {
    this.profileChoice = profile;
    for (const option of el('profile-list').querySelectorAll<HTMLElement>('.profile-option')) {
      const on = option.dataset.profile === profile;
      option.setAttribute('aria-selected', String(on));
      option.classList.toggle('is-selected', on);
    }
    el('profile-list').setAttribute('aria-activedescendant', `profile-option-${profile}`);
  }

  /** Moves the highlight `step` rows, stopping at either end of the list. */
  private stepProfile(step: number): void {
    const at = STROKE_PROFILES.indexOf(this.profileChoice);
    const next = Math.min(STROKE_PROFILES.length - 1, Math.max(0, at + step));
    this.highlightProfile(STROKE_PROFILES[next]);
  }

  /**
   * Select: the highlighted profile becomes the one new pen and marker
   * strokes are drawn with - tool state, like the width. With the Select tool
   * and a selection, the selected strokes that can take it do too, as one
   * undo step, the way picking a color recolors them.
   */
  private applyStrokeProfile(): void {
    const profile = this.profileChoice;
    const label = STROKE_PROFILE_LABELS[profile];
    this.store.setTool({ profile });
    const eligible =
      this.store.tool.tool === 'select' ? this.propertyShapes().filter(profileApplies) : [];
    const changing = eligible.filter((stroke) => (stroke.profile ?? 'uniform') !== profile);
    if (changing.length > 0) {
      this.store.setStrokeProps(
        changing.map((stroke) => stroke.id),
        // Default is the absent state, not a stored one, and a profile
        // chosen fresh is the plain one, however the stroke was mirrored.
        { profile: profile === 'uniform' ? undefined : profile, profileMirrored: undefined },
      );
      this.toast(`${label} on ${changing.length} ${changing.length === 1 ? 'stroke' : 'strokes'}.`);
    } else if (eligible.length > 0) {
      this.toast(`The selection is already ${label}.`);
    } else {
      this.toast(`New brush and marker strokes: ${label}.`);
    }
    if (!this.popups.staysAfterApply('profile-dialog')) this.closeProfileDialog();
    this.syncStrokeProfileControl();
  }

  /** True while the Mirror palette is up. */
  private get mirrorDialogOpen(): boolean {
    return !el('mirror-dialog').classList.contains('is-hidden');
  }

  /**
   * Wires the Mirror palette: reflect the selection left-right, top-bottom
   * or both, in place or as a copy that lands beside it. Its preview and its
   * commit are one store transaction, which is what lets a preview add a
   * copy and still leave nothing behind when it is cancelled.
   */
  private bindMirror(): void {
    el('mirror-selection').addEventListener('click', () => this.runCommand('mirror'));
    el('mirror-cancel').addEventListener('click', () => this.closeMirrorDialog());
    el('mirror-apply').addEventListener('click', () => void this.applyMirror());
    const boxes: Array<[string, keyof MirrorOptions]> = [
      ['mirror-horizontal', 'horizontal'],
      ['mirror-vertical', 'vertical'],
      ['mirror-copy', 'copy'],
      ['mirror-preview', 'preview'],
    ];
    for (const [id, key] of boxes) {
      el<HTMLInputElement>(id).addEventListener('change', (e) => {
        this.mirrorOptions[key] = (e.target as HTMLInputElement).checked;
        this.syncMirrorControls();
        void this.syncMirrorPreview();
      });
    }
  }

  /**
   * Opens the Mirror palette for the current selection. It refuses where Move
   * does: in Animation Mode, over another dialog, and with nothing selected,
   * which is worth saying rather than showing a palette with nothing to do.
   */
  private openMirrorDialog(): void {
    if (this.mirrorDialogOpen) return;
    if (this.animationMode) {
      this.toast('Mirror is not available in Animation Mode.');
      return;
    }
    if (this.otherDialogOpen('mirror-dialog')) return;
    if (this.propertyTargets().length === 0) {
      this.toast('Select something to mirror first.');
      return;
    }
    this.mirrorSource = {
      strokes: [...this.store.selectedIds],
      layers: [...this.store.selectedLayerIds],
    };
    el<HTMLInputElement>('mirror-horizontal').checked = this.mirrorOptions.horizontal;
    el<HTMLInputElement>('mirror-vertical').checked = this.mirrorOptions.vertical;
    el<HTMLInputElement>('mirror-copy').checked = this.mirrorOptions.copy;
    el<HTMLInputElement>('mirror-preview').checked = this.mirrorOptions.preview;
    this.syncSelectionBorderSwitches();
    this.syncMirrorControls();
    el('mirror-dialog').classList.remove('is-hidden');
    // Clear of the drawing on its first opening, as Move and Rotate open: the
    // preview is the drawing, and a palette centred over it would hide it.
    this.popups.parkTopRight('mirror-dialog');
    this.popups.clamp('mirror-dialog');
    el<HTMLButtonElement>('mirror-apply').focus();
    void this.syncMirrorPreview();
  }

  /**
   * Closes the palette. A preview is an edit that was never kept, so it goes
   * with the palette: its transaction is rolled back, which puts the page,
   * the selection and the saved state back as the palette found them.
   */
  private closeMirrorDialog(): void {
    this.mirrorRequest++;
    this.endMirrorPreview();
    this.mirrorSource = null;
    this.mirroredImages.clear();
    this.popups.releaseGrabs('mirror-dialog');
    el('mirror-dialog').classList.add('is-hidden');
  }

  /**
   * Selects the palette's own selection again, before each preview and
   * before the commit. The palette mirrors what was selected when it opened:
   * a click on the canvas while it is up does not retarget it, whether or not
   * a preview happened to be showing at the time - a click could land on the
   * previewed copy itself, which the next preview takes away.
   *
   * @returns False when none of it is on the page any more.
   */
  private selectMirrorSource(): boolean {
    const source = this.mirrorSource;
    if (!source) return false;
    const present = new Set(this.store.sketch.strokes.map((s) => s.id));
    const strokes = source.strokes.filter((id) => present.has(id));
    if (strokes.length === 0) return false;
    const layers = new Set(this.store.sketch.layers.map((l) => l.id));
    this.store.selectedIds = new Set(strokes);
    this.store.selectedLayerIds = new Set(source.layers.filter((id) => layers.has(id)));
    return true;
  }

  /** Mirror needs an axis: with neither orientation ticked there is nothing to do. */
  private syncMirrorControls(): void {
    const apply = el<HTMLButtonElement>('mirror-apply');
    const ready = this.mirrorOptions.horizontal || this.mirrorOptions.vertical;
    apply.disabled = !ready;
    apply.title = ready ? '' : 'Pick an orientation';
  }

  /**
   * The reflection the palette's choices describe, for the current selection.
   *
   * In place it runs through the middle of the selection's bounds, so the
   * selection flips where it stands. A copy is reflected about the trailing
   * edge instead - the right edge, the bottom edge, or the bottom-right
   * corner for both - so it lands beside the original as its mirror image,
   * the two meeting at that edge: half a vase, mirrored, becomes a vase.
   */
  private mirrorForSelection(): Mirror | null {
    const { horizontal, vertical, copy } = this.mirrorOptions;
    if (!horizontal && !vertical) return null;
    const box = this.selectionBounds();
    if (!box) return null;
    return {
      flipX: horizontal,
      flipY: vertical,
      x: copy ? box.maxX : (box.minX + box.maxX) / 2,
      y: copy ? box.maxY : (box.minY + box.maxY) / 2,
    };
  }

  /**
   * Makes the mirror on the current selection with no history of its own -
   * the transaction around it is the undo step. With Create Copy the
   * selection is duplicated in place first and the copy is what turns, which
   * leaves the copy selected, as a paste's result is.
   *
   * @returns How many elements were mirrored.
   */
  private performMirror(m: Mirror): number {
    if (this.mirrorOptions.copy) this.store.duplicateSelectedElements();
    const ids = this.propertyTargets();
    this.store.mirrorStrokes(ids, m, {
      history: false,
      boxOf: (stroke) => strokeBounds(stroke, (t) => this.surface.measureText(t)),
    });
    // The geometry moved above; an image's pixels are flipped here, from the
    // copies prepareMirroredImages made before the mirror began.
    const mirrored = new Set(ids);
    const axes = mirrorAxesKey(m);
    for (const stroke of this.store.sketch.strokes) {
      if (!mirrored.has(stroke.id) || !isImageStroke(stroke) || !stroke.image) continue;
      const flipped = this.mirroredImages.get(stroke.image)?.get(axes);
      if (flipped) this.store.setStrokeProps([stroke.id], { image: flipped }, false);
    }
    return ids.length;
  }

  /**
   * Gets every selected image's mirrored pixels ready, so the mirror itself
   * can swap them in without waiting. Flipping means decoding the image, the
   * one slow part of a mirror, so each is done once per axis pair.
   */
  private async prepareMirroredImages(m: Mirror): Promise<void> {
    const axes = mirrorAxesKey(m);
    const pending: Promise<void>[] = [];
    for (const stroke of this.propertyStrokes()) {
      if (!isImageStroke(stroke) || !stroke.image) continue;
      const source = stroke.image;
      let byAxes = this.mirroredImages.get(source);
      if (!byAxes) {
        byAxes = new Map();
        this.mirroredImages.set(source, byAxes);
      }
      if (byAxes.has(axes)) continue;
      const cache = byAxes;
      pending.push(
        mirroredImageUrl(source, m.flipX, m.flipY)
          .then((url) => void cache.set(axes, url))
          // An image that will not decode still moves; it just is not flipped.
          .catch(() => void cache.set(axes, source)),
      );
    }
    await Promise.all(pending);
  }

  /**
   * Shows what Mirror would do, on the canvas, while the palette is open.
   *
   * The preview is a store transaction: each change of choice rolls the last
   * one back and makes the mirror again from the selection the palette
   * opened on, with no history, and Mirror commits what is on screen. An
   * edit that keeps history while the preview is up - a drag on the
   * previewed copy, say - keeps the preview rather than losing it, since it
   * is building on what the palette showed; the palette then goes.
   */
  private async syncMirrorPreview(): Promise<void> {
    const request = ++this.mirrorRequest;
    this.endMirrorPreview();
    if (!this.mirrorDialogOpen || !this.mirrorOptions.preview) return;
    if (!this.selectMirrorSource()) return;
    const m = this.mirrorForSelection();
    if (!m) return;
    await this.prepareMirroredImages(m);
    // A click may have changed the selection while an image was flipping.
    if (request !== this.mirrorRequest || !this.mirrorDialogOpen) return;
    if (!this.selectMirrorSource()) return;
    // A preview kept by another edit becomes the mirror's own step.
    this.recordAs('mirror', () => this.store.beginTransaction(() => this.onMirrorPreviewKept()));
    this.mirrorPreviewing = true;
    this.performMirror(m);
  }

  /** Takes a preview back off the canvas, if the palette put one up. */
  private endMirrorPreview(): void {
    if (!this.mirrorPreviewing) return;
    this.mirrorPreviewing = false;
    this.store.rollbackTransaction();
  }

  /**
   * Another edit kept the preview on the palette's behalf: the mirror is
   * real now and is one undo step of its own, so the palette just goes.
   */
  private onMirrorPreviewKept(): void {
    this.mirrorPreviewing = false;
    this.mirrorRequest++;
    this.mirrorSource = null;
    this.mirroredImages.clear();
    this.popups.releaseGrabs('mirror-dialog');
    el('mirror-dialog').classList.add('is-hidden');
  }

  /**
   * Mirrors for real, from the button or from Enter. Whatever the preview
   * was showing is put back first and the mirror is made again inside a
   * transaction of its own, so the result is one undo step whether or not a
   * preview was up, and never a preview's leftovers.
   */
  private async applyMirror(): Promise<void> {
    if (!this.mirrorDialogOpen) return;
    const request = ++this.mirrorRequest;
    this.endMirrorPreview();
    if (!this.selectMirrorSource()) {
      this.toast('What was selected is no longer on the page.');
      this.closeMirrorDialog();
      return;
    }
    const m = this.mirrorForSelection();
    if (!m) {
      this.toast('Pick an orientation to mirror across.');
      return;
    }
    await this.prepareMirroredImages(m);
    if (request !== this.mirrorRequest || !this.mirrorDialogOpen) return;
    if (!this.selectMirrorSource()) return;
    const count = this.recordAs('mirror', () => {
      this.store.beginTransaction();
      const made = this.performMirror(m);
      this.store.commitTransaction();
      return made;
    });
    const which = m.flipX && m.flipY ? 'both ways' : m.flipX ? 'horizontally' : 'vertically';
    const what = `${count} element${count === 1 ? '' : 's'}`;
    this.toast(
      this.mirrorOptions.copy ? `Mirrored a copy of ${what} ${which}.` : `Mirrored ${what} ${which}.`,
    );
    if (!this.popups.staysAfterApply('mirror-dialog')) this.closeMirrorDialog();
  }


  // ---- Transform tool ------------------------------------------------------

  /**
   * True while the Transform box is on the canvas.
   *
   * A mode rather than a palette, and rather than an entry in the `Tool`
   * union: `Tool` is the drawing tools, each of which persists on the strokes
   * it makes, and this one draws nothing. It sits beside Rotate instead - an
   * overlay the canvas gestures are read against while it is up, which stays
   * up until it is dismissed.
   */
  private transformActive = false;

  /** The box the handles are drawn on, in sketch coordinates. */
  private transformBox: TransformBox | null = null;

  /** The handle under the pointer, for the cursor and the lit handle. */
  private transformHover: TransformHandle | null = null;

  /**
   * A handle drag in hand.
   *
   * `startBox` is the box the press landed on, and every factor is measured
   * from it rather than from the box as it currently stands: a drag that
   * wanders out and comes back lands exactly where it started instead of
   * accumulating what the round trip cost. `shown` is what has been applied
   * to the drawing so far, taken back off before the next total goes on - the
   * same way the Rotate preview works, and the reason a modifier pressed
   * halfway through a drag re-reads the whole gesture rather than bending
   * only what comes after it.
   */
  private transformDrag: {
    pointerId: number;
    handle: TransformHandle;
    startBox: TransformBox;
    ids: string[];
    shown: { sx: number; sy: number; ox: number; oy: number } | null;
    /** Set once the drag has changed the drawing, so a click costs no undo step. */
    committed: boolean;
  } | null = null;

  /** Turns the Transform box on for the current selection, or off again. */
  private toggleTransformTool(): void {
    if (this.transformActive) {
      this.closeTransformTool();
      return;
    }
    if (this.animationMode) {
      this.toast('Transform is not available in Animation Mode.');
      return;
    }
    const box = this.selectionBounds();
    if (this.propertyTargets().length === 0 || !box) {
      this.toast('Select something to transform first.');
      return;
    }
    this.transformActive = true;
    this.transformBox = box;
    this.transformHover = null;
    this.syncTransformButton();
    this.toast('Transform: drag a handle. Shift keeps the shape, Alt works from the centre.');
    this.updateCursor();
    this.scheduleRender();
    // Transform > Transform Box shows a check mark while the box is up.
    this.publishMenuState();
  }

  /** The toolbar's Transform button, pressed while the box is up, as Transform > Transform Box is checked. */
  private syncTransformButton(): void {
    const button = el('transform-selection');
    button.classList.toggle('is-open', this.transformActive);
    button.setAttribute('aria-pressed', String(this.transformActive));
  }

  /** Takes the box off the canvas, abandoning any drag still in hand. */
  private closeTransformTool(): void {
    // A handle drag in hand when the box goes lets go of its pointer too.
    this.dropPressOf('transform');
    this.transformActive = false;
    this.transformBox = null;
    this.transformHover = null;
    this.transformDrag = null;
    this.syncTransformButton();
    this.updateCursor();
    this.scheduleRender();
    this.publishMenuState();
  }

  /**
   * The box the handles sit on, re-measured from the selection unless a drag
   * is carrying it.
   *
   * Lazy on purpose. The selection can change under an open Transform box
   * from the layers panel, from the canvas, or from an undo, and asking for
   * the bounds at the moment they are needed is one rule instead of three
   * subscriptions that each have to remember to keep the box honest.
   */
  private currentTransformBox(): TransformBox | null {
    if (this.transformDrag) return this.transformBox;
    const box = this.selectionBounds();
    this.transformBox = box;
    return box;
  }

  /** The handle within grabbing distance of a point, nearest first. */
  private transformHandleAt(pt: Point): TransformHandle | null {
    const box = this.currentTransformBox();
    if (!box) return null;
    // The handles are drawn at a constant on-screen size, so their reach is a
    // screen distance and has to be taken back into sketch units.
    const reach = TRANSFORM_GRAB_PX / this.surface.getViewport().zoom;
    let best: TransformHandle | null = null;
    let bestDist = reach;
    for (const handle of TRANSFORM_HANDLES) {
      const p = transformHandlePoint(box, handle);
      const dist = Math.hypot(pt.x - p.x, pt.y - p.y);
      // Corners win a tie: on a small box a corner sits within reach of two
      // side handles, and the corner is what a press near one is usually for.
      if (dist < bestDist || (dist === bestDist && handle.length === 2)) {
        best = handle;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Takes a press on a handle, and reports whether it took it. A press
   * anywhere else is left to the tool underneath, so the selection can still
   * be changed with the box up.
   */
  private beginTransformDrag(e: PointerEvent, pt: Point): boolean {
    if (this.activePointerId !== null) return false;
    const handle = this.transformHandleAt(pt);
    const box = this.currentTransformBox();
    if (!handle || !box) return false;
    const ids = this.propertyTargets();
    if (ids.length === 0) return false;
    e.preventDefault();
    this.claimPointer(e, 'transform');
    this.transformDrag = {
      pointerId: e.pointerId,
      handle,
      startBox: box,
      ids,
      shown: null,
      committed: false,
    };
    this.transformHover = handle;
    this.updateCursor();
    this.scheduleRender();
    return true;
  }

  /** Carries a handle drag along, and reports whether it took the move. */
  private onTransformPointerMove(e: PointerEvent, pt: Point): boolean {
    const drag = this.transformDrag;
    if (!drag || drag.pointerId !== e.pointerId) {
      // Not dragging: the pointer still has to say which handle it is over,
      // which is the only thing telling the user the box can be grabbed.
      if (!this.transformActive) return false;
      const over = this.transformHandleAt(pt);
      if (over !== this.transformHover) {
        this.transformHover = over;
        this.updateCursor();
        this.scheduleRender();
      }
      return false;
    }

    const wanted = transformScale(drag.startBox, drag.handle, pt, {
      uniform: e.shiftKey,
      fromCenter: e.altKey,
    });
    const shown = drag.shown;
    if (shown && shown.sx === wanted.sx && shown.sy === wanted.sy && shown.ox === wanted.ox) {
      return true;
    }
    if (!drag.committed) {
      // The history step waits for the first real change, so a press that
      // grabs a handle and lets go again does not cost an undo.
      this.store.pushHistory();
      drag.committed = true;
    }
    // Off with what is showing, on with what is wanted, each about its own
    // origin: Alt can move the origin halfway through a drag, and an inverse
    // taken about the wrong point is not an inverse.
    if (shown) {
      this.store.scaleStrokes(drag.ids, 1 / shown.sx, 1 / shown.sy, shown.ox, shown.oy, false);
    }
    this.store.scaleStrokes(drag.ids, wanted.sx, wanted.sy, wanted.ox, wanted.oy, false);
    drag.shown = wanted;
    this.transformBox = scaledBox(drag.startBox, wanted);
    this.scheduleRender();
    return true;
  }

  /** Ends a handle drag, and reports whether it took the release. */
  private endTransformDrag(e: PointerEvent): boolean {
    const drag = this.transformDrag;
    if (!drag || drag.pointerId !== e.pointerId) return false;
    this.transformDrag = null;
    this.activePointerId = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    // What is on the canvas is the result. There is nothing to commit: the
    // history step went on before the first change, and every scale since has
    // been the real thing rather than a preview of one.
    const shown = drag.shown;
    if (shown) {
      const pct = (f: number): number => Math.round(f * 1000) / 10;
      this.toast(
        shown.sx === shown.sy
          ? `Scaled to ${pct(shown.sx)}%.`
          : `Scaled to ${pct(shown.sx)}% by ${pct(shown.sy)}%.`,
      );
      if (shown.sx === SCALE_FACTOR_MIN || shown.sy === SCALE_FACTOR_MIN) {
        this.toast('Scaling stops at 1%: Transform does not flip a selection yet.');
      } else if (shown.sx === SCALE_FACTOR_MAX || shown.sy === SCALE_FACTOR_MAX) {
        this.toast('Scaling is limited to 10000%.');
      }
    }
    this.transformBox = this.selectionBounds();
    this.updateCursor();
    this.scheduleRender();
    return true;
  }

  /** The box and its handles, for the canvas overlay. */
  private transformOverlay(): {
    box: TransformBox;
    handles: { x: number; y: number }[];
    hover?: number;
  } | null {
    if (!this.transformActive) return null;
    const box = this.currentTransformBox();
    if (!box) return null;
    const handles = TRANSFORM_HANDLES.map((h) => transformHandlePoint(box, h));
    const hover = this.transformHover ? TRANSFORM_HANDLES.indexOf(this.transformHover) : -1;
    return { box, handles, hover: hover >= 0 ? hover : undefined };
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
    /** Where the press landed, in sketch units - the pivot a click asks for. */
    origin: Point;
    /** Where it landed on screen, which is where the threshold is measured. */
    from: { x: number; y: number };
    /** True once the pointer has travelled far enough to mean a turn. */
    moved: boolean;
  } | null = null;

  /** The pointer dragging the centre marker itself, when one is. */
  private rotateCenterDrag: number | null = null;

  /** Where the pointer is while a rotate drag runs, for the overlay's lever. */
  private rotateRay: Point | null = null;

  /** True while the pointer is close enough to the centre marker to grab it. */
  private rotateOverCenter = false;

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

    el('rotate-selection').addEventListener('click', () => this.runCommand('rotate'));
    el('transform-selection').addEventListener('click', () => this.runCommand('toggle-transform'));
    el('rotate-cancel').addEventListener('click', () => this.closeRotateDialog(true));
    el('rotate-apply').addEventListener('click', () => {
      this.applyRotate();
      if (!this.popups.staysAfterApply('rotate-dialog')) this.closeRotateDialog(false);
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
    // The panel says which of the two it is, since the difference only shows
    // up at the end of a drag - by which point it is too late to wonder.
    el('rotate-msg').textContent =
      `Rotate ${targets.length} selected element${targets.length === 1 ? '' : 's'} around a centre point.` +
      (quick ? ' Drag on the canvas to turn it; the panel stays up for the next one.' : '');

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
   * Puts the Rotate panel in the top-right corner the first time it opens.
   * The rule and the arithmetic are the manager's; see
   * {@link PopupManager.parkTopRight} for why a palette is not centred.
   */
  private parkRotateDialog(): void {
    this.popups.parkTopRight('rotate-dialog');
  }

  /** Pulls the Rotate panel back on screen, after a resize or before opening. */
  private clampRotateDialog(): void {
    this.popups.clamp('rotate-dialog');
  }

  /** Closes the dialog, dropping any live preview when the rotation was abandoned. */
  private closeRotateDialog(revert: boolean): void {
    this.dropPressOf('rotate');
    if (revert) this.revertRotatePreview();
    else this.rotatePreview = null;
    this.rotateDrag = null;
    this.rotateCenterDrag = null;
    this.rotateRay = null;
    this.rotateOverCenter = false;
    this.rotateCenter = null;
    this.rotateBox = null;
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
    this.recordAs('rotate', () => this.store.rotateStrokes(targets, degrees, center.x, center.y));
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
    this.claimPointer(e, 'rotate');

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
    this.rotateDrag = {
      pointerId: e.pointerId,
      bearing: this.rotateBearing(pt),
      turned: 0,
      base,
      origin: pt,
      from: { x: e.clientX, y: e.clientY },
      moved: false,
    };
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
      // Same threshold the select drag uses, and for the same reason: a press
      // that has not travelled this far has not said yet which gesture it is.
      if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= SELECT_DRAG_THRESHOLD_PX) {
        drag.moved = true;
      }
      // Below the threshold the press has not said it is a turn yet. Reading a
      // bearing off it anyway would flick the selection a few degrees round
      // and back again on what turns out to be a click asking for a pivot.
      if (!drag.moved) return true;
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

    // A press that never travelled is a click, and a click puts the pivot
    // where it landed. The nine presets stay exactly as they were - they are
    // the quick way to the corners and the middle of the box - and this is
    // the loose way to everywhere else: a shoulder, a heel, a point off the
    // shape entirely. It costs nothing that was there before, because a press
    // that turned nothing already did nothing.
    if (!drag.moved) {
      this.revertRotatePreview();
      this.setRotateAngleField(drag.base);
      this.moveRotateCenter(drag.origin, null, true);
      this.updateCursor();
      this.scheduleRender();
      return true;
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
    // The rotation is in the drawing and the tool is still in hand. Letting
    // go of a drag used to dismiss the palette when Ctrl+R had opened it,
    // which threw away the pivot and the snap along with the answer and made
    // a second turn cost a reopen and a re-place. What a panel does once its
    // tool has been applied is one decision now, declared in one place:
    // Rotate remains in view.
    if (!this.popups.staysAfterApply('rotate-dialog') && turned) {
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
  /**
   * Union of the selected elements' bounds, or null when nothing is selected.
   * An older file's eraser marks ride along with their layer's selection, so
   * a move takes their cuts with it, but they are no element: no bounds.
   */
  private selectionBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    const clips = clipIndex(this.store.sketch);
    for (const stroke of this.propertyStrokes()) {
      if (stroke.tool === 'eraser') continue;
      // As it shows: in a clip group, cut to the clip's bounds.
      const bounds = strokeBounds(stroke, (t) => this.surface.measureText(t));
      const b = bounds && shownBounds(this.store.sketch, stroke, bounds, clips);
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
    // Only pen and marker marks take a profile: a Copic nib is its own width.
    const profiled = shapes.filter(profileApplies);
    const profileSelect = el<HTMLSelectElement>('prop-stroke-profile');
    if (document.activeElement !== profileSelect) {
      profileSelect.value = profiled[0]?.profile ?? 'uniform';
    }
    profileSelect.disabled = profiled.length === 0;
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
      this.endWipe();
      // Track CapsLock state.
      const newCapsLock = e.getModifierState('CapsLock');
      if (newCapsLock !== this.capsLockOn) {
        this.capsLockOn = newCapsLock;
        this.updateCursor();
      }

      // Chromium acts on some keys by itself whatever the menus hold: F5 and
      // Ctrl+R reload, which would throw the sketch away without asking, and
      // Ctrl+T is a browser's new tab. So they are swallowed here, ahead of
      // the text-field guard below - a stray Ctrl+R while renaming a layer must
      // do nothing at all - and outside a field each runs whatever the
      // shortcuts give it: Rotate and the Transform box, as shipped. A reload
      // key with nothing to run explains itself instead.
      // The configuration popup keeps its own keys and never lets them get
      // here. One that does had the focus outside the popup - on the page
      // behind it - and runs nothing there while the popup is still asking.
      if (this.configDialog.isOpen) {
        this.configDialog.strayKey(e);
        return;
      }
      if (this.scriptDialog.isOpen) {
        this.scriptDialog.strayKey(e);
        return;
      }

      if (isReloadKey(e) || isNewTabKey(e)) {
        e.preventDefault();
        if (isTextEntry(document.activeElement)) return;
        const id = commandForEvent(this.menuRegistry, e);
        if (id !== null) this.runKey(id);
        else if (isReloadKey(e)) this.toast(this.reloadRefusal());
        return;
      }

      // A focused text field owns its keys: the tool shortcuts, Delete, and
      // the document's own undo must not fire while a name, a coordinate, or
      // a scale is being typed. Sliders, checkboxes, and color wells consume
      // no letters, so they keep the shortcuts working.
      if (isTextEntry(document.activeElement)) return;

      // Held keys (held-keys.ts): any key but a modifier ends the Ctrl spring,
      // so a chord such as Ctrl+Z runs with the drawing tool still in hand,
      // and cancels a still hold of the nib-rotate.
      if (!isModifierKey(e.key)) {
        this.springEvent('other-key');
        this.nibEvent({ type: 'other-key' });
      }

      // Track Ctrl while a vector edit is open: holding it reveals the
      // corner-rounding target and switches the pointer to the Select arrow.
      if (e.key === 'Control' && !this.ctrlDown) {
        this.ctrlDown = true;
        if (this.vectorEditId) {
          this.updateVectorEditCursor();
          this.scheduleRender();
        }
      }

      // Ctrl mid-press, with Space still held, makes the straight line the
      // quick curve; with no press under way, on a drawing tool, it lends the
      // last selection tool until it comes up.
      if (e.key === 'Control' && !e.repeat) {
        if (this.press) {
          if (ctrlJoinsPress(this.press.kind, this.spaceDown) === 'curve') this.curvePress(e.altKey, e.shiftKey);
        } else {
          this.springEvent('ctrl-down', this.springArms());
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

      // Mirror: the palette has no fields to type in, so its keys are the
      // window's - Enter mirrors, as the button does, and Escape closes.
      if (this.mirrorDialogOpen && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        if (e.key === 'Escape') this.closeMirrorDialog();
        else void this.applyMirror();
        return;
      }

      // Stroke Profile: while the picker is up its list has the keys - the
      // arrows, Home and End move through it, Enter selects, Escape closes.
      if (this.profileDialogOpen) {
        const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity };
        if (e.key in steps) {
          e.preventDefault();
          this.stepProfile(steps[e.key]);
          return;
        }
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          if (e.key === 'Escape') this.closeProfileDialog();
          else this.applyStrokeProfile();
          return;
        }
      }

      // Mesh Warp: while a warp is open, Enter keeps it and Escape throws it
      // away; Delete takes out the selected pins - never the art, which the
      // generic Delete below would take - and Ctrl+Z steps back through the
      // pins rather than the page.
      if (this.warp) {
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (e.key === 'Enter') {
          e.preventDefault();
          this.keepWarp();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelWarp();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          this.deleteWarpPins();
          return;
        }
        if (mod && key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undoWarpStep();
          return;
        }
        if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Escape' && this.moveDialogOpen) {
        e.preventDefault();
        this.closeMoveDialog();
        return;
      }
      if (e.key === 'Escape' && this.vectorAnchors.length > 0) {
        e.preventDefault();
        this.cancelVectorPath();
        return;
      }

      // Escape abandons a pending curve (chord or bend phase). Mid-drag the
      // pointer goes with it: keeping the pointer is what stopped every tool
      // after Escape during a quick curve.
      if (e.key === 'Escape' && (this.curveA !== null || this.curveBending)) {
        e.preventDefault();
        this.dropPressOf('curve', 'chord');
        this.cancelCurve();
        return;
      }

      // Escape drops a Liquify press: the drag is undone, and an Alt-drag's size put back.
      if (e.key === 'Escape' && this.liquifyDrag) {
        e.preventDefault();
        this.dropPressOf('liquify');
        this.scheduleRender();
        return;
      }

      // Escape drops a Smear press: no mark keeps the pass.
      if (e.key === 'Escape' && this.smearDrag) {
        e.preventDefault();
        this.dropPressOf('smear');
        this.scheduleRender();
        return;
      }

      // Escape drops a Shape Stacker press: nothing is merged or taken away.
      if (e.key === 'Escape' && this.stackDrag) {
        e.preventDefault();
        this.dropPressOf('stack');
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
      // clockwise, and frees its far end from the snap while held. Auto-repeat
      // is ignored so a held key parks the apex at one angle instead of
      // spinning it.
      if (e.key === 'Shift' && this.quickCurve) {
        e.preventDefault();
        if (!e.repeat) {
          this.updateQuickCurveEnd(true);
          this.turnQuickCurveApex();
        }
        return;
      }

      // Straight line: pressing Shift mid-drag holds the line to the nearest
      // of eight directions at once, before the pointer next moves.
      if (e.key === 'Shift' && this.straightStart !== null && !e.repeat) {
        this.updateStraightEnd(true);
        return;
      }

      // Vector Path: Shift holds the band, or the handle being pulled, to
      // eight directions at once, before the pointer next moves.
      if (e.key === 'Shift' && !e.repeat) this.refreshVectorPointer(true);

      // Escape takes the Transform box off. It comes first among the Escape
      // handlers because the box is the thing most recently put up.
      if (e.key === 'Escape' && this.transformActive) {
        e.preventDefault();
        this.closeTransformTool();
        return;
      }

      // Escape drops the Direct Select anchor edit, and the drag in hand with it.
      if (e.key === 'Escape' && this.anchorStrokeId !== null) {
        e.preventDefault();
        this.dropPressOf('point-drag');
        this.anchorStrokeId = null;
        this.selectedAnchors.clear();
        this.pathSelected = false;
        this.anchorDragKind = null;
        this.handleDrag = null;
        this.anchorDragLast = null;
        this.scheduleRender();
        return;
      }

      // Copic quick nib-rotate: holding the hold key still arms the timer;
      // once active, the rotate keys steer the broad nib and are consumed.
      // Auto-repeat is no new hold: letting it re-arm the timer is how a Ctrl
      // kept down after Space let go turned the Pen into the Copic.
      if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicHoldKey] && !e.repeat) {
        this.nibEvent({ type: 'hold-down', arms: this.nibHoldArms() });
      }
      if (this.settings.copicQuickRotate) {
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

      // Space, held with no press under way, gives the hand: the next press
      // pans. Mid-press it turns the freehand stroke into a straight line, or
      // with Ctrl into the quick curve (held-keys.ts).
      if (e.key === ' ' || e.code === 'Space') {
        // Unless a checkbox has the focus, in which case the space bar is
        // already spoken for - see {@link togglesOnSpace}. Arming the hand is
        // worth nothing while a dialog's field has the focus, and the toggle
        // is worth everything.
        if (togglesOnSpace(document.activeElement)) return;
        e.preventDefault();
        if (!e.repeat) {
          const action = spaceAction(this.press?.kind ?? null, e.ctrlKey);
          if (action === 'straight') this.straightenPress(e.shiftKey);
          else if (action === 'curve') this.curvePress(e.altKey, e.shiftKey);
        }
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

      // Quick Zoom: after Z, the next digit sets the zoom (9 => 90%, 0 => 100%).
      if (this.quickZoomArmed && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        this.applyQuickZoom(e.key);
        return;
      }

      // Liquify: [ and ] size the brush, as a vector editor's do.
      if ((e.key === '[' || e.key === ']') && this.store.tool.tool === 'liquify' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.sizeLiquify(e.key === ']' ? LIQUIFY_RADIUS_STEP : 1 / LIQUIFY_RADIUS_STEP);
        return;
      }

      // Every other key is a shortcut if the menu registry says it is one.
      // The modes above have all had their turn - an open Vector Path takes
      // Enter before Move does, and the layer-rename box stops its own keys
      // (F2 among them) short of this handler, so a second press cannot
      // restart an edit mid-flight - and what reaches here is free to be a
      // command.
      const id = commandForEvent(this.menuRegistry, e);
      if (id !== null) this.runKey(id, e);
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

      // Endpoint snap: releasing Shift dismisses the snap-indicator ring - a
      // freehand end snaps only while it is held. The straight line and the
      // quick curve are the other way about: letting Shift go frees the line
      // from its eight directions, and the curve from its apex key, and their
      // end snaps again.
      if (e.key === 'Shift') {
        this.setSnapTarget(null);
        if (this.straightStart !== null) this.updateStraightEnd(false);
        if (this.quickCurve) this.updateQuickCurveEnd(false);
        this.refreshVectorPointer(false);
      }

      // Releasing Ctrl hides the corner-rounding target and restores the
      // hover pointer, and gives back the drawing tool Ctrl lent the
      // selection tool from - once any drag the selection tool began is over.
      if (e.key === 'Control' && this.ctrlDown) {
        this.ctrlDown = false;
        if (this.vectorEditId) {
          this.updateVectorEditCursor();
          this.scheduleRender();
        }
      }
      if (e.key === 'Control') this.springEvent('ctrl-up');

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

      // Copic quick nib-rotate: releasing the hold key ends the mode, or the
      // still hold that had not reached it; releasing a rotate key stops the
      // spin in that direction. Runs even when the feature was toggled off
      // mid-hold so no state gets stuck. preventDefault keeps an Alt keyup
      // from focusing the native menu bar.
      if (e.key === MODIFIER_EVENT_KEYS[this.settings.copicHoldKey]) {
        if (this.nibRotateActive) e.preventDefault();
        this.nibEvent({ type: 'hold-up' });
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

    // A lost focus swallows keyup events and the release of any press under
    // way, and so does a hidden page.
    window.addEventListener('blur', () => this.focusLost('blur'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.focusLost('hidden');
    });
  }

  /**
   * The window lost the focus, or the page was hidden: every keyup and the
   * release of any press under way now go somewhere else, so nothing may be
   * left held. The press is ended as its policy says (press-state.ts) - a
   * stroke keeps what was drawn, a curve goes - and every held key is let go:
   * rotate mode, the eyedropper's temporary select, Space, Ctrl and Alt.
   */
  private focusLost(reason: 'blur' | 'hidden'): void {
    this.endPressEarly(reason);
    this.pointers.clear();
    this.spaceDown = false;
    this.ctrlDown = false;
    this.altDown = false;
    this.springEvent('blur');
    this.nibEvent({ type: 'blur' });
    this.altRule.reset();
    if (this.curveA !== null || this.curveBending) this.cancelCurve();
    // A pending vector path is accepted rather than lost when the window
    // loses focus (a too-short path drops in the commit).
    if (this.vectorAnchors.length > 0) this.commitVectorPath(false);
    this.vectorEditDrag = null;
    this.updateCursor();
    if (this.sharpenPreview) this.closeSharpenDialog(false);
  }

  /**
   * The Alt rule (alt-menu.ts) and the pointer side of the held keys. In the
   * capture phase on the window, so every key and every pointer event reaches
   * them first, whatever has the focus and whatever stops the event later - a
   * dialog, a text field.
   */
  private bindHeldKeys(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        this.altRule.keyDown(e.key, performance.now(), e.repeat);
        // Alt pressed during a press is Alt at work: the quick curve's circle.
        if (e.key === 'Alt' && this.press) this.altRule.gesture();
      },
      true,
    );
    // Electron gives the menu bar only the Alt keyup the page leaves alone.
    window.addEventListener(
      'keyup',
      (e) => {
        if (e.key === 'Alt' && !this.altRule.altUp()) e.preventDefault();
      },
      true,
    );
    const altAtWork = (e: MouseEvent): void => {
      if (e.altKey) this.altRule.gesture();
    };
    window.addEventListener('wheel', altAtWork, { capture: true, passive: true });
    window.addEventListener(
      'pointerdown',
      (e) => {
        altAtWork(e);
        this.nibEvent({ type: 'press' });
      },
      true,
    );
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.buttons !== 0) altAtWork(e);
        this.heldMove(e.clientX, e.clientY);
      },
      true,
    );
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
    const { tool, width, liveSharpen, sharpen, symmetry, fontSize } = this.store.tool;

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

    // Leaving Mesh Warp keeps the warp in hand, by the Vector Path's rule. A
    // warp left on a page that has since turned is over.
    if (this.warp && this.warp.sketch !== this.store.sketch) this.onWarpSettled();
    if (tool !== 'warp') {
      if (this.warp) this.keepWarp();
      if (this.warpHover) {
        this.warpHover = null;
        this.scheduleRender();
      }
      this.showWarpHint(null);
    }

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

    // The swatch lit is the color in front's.
    const front = frontColor(this.store.tool);
    for (const node of Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch'))) {
      node.classList.toggle('is-active', node.dataset.color === front);
    }
    this.syncFillStroke();

    el<HTMLInputElement>('width').value = String(width);
    el('width-value').textContent = `${width}px`;
    this.syncStrokeProfileControl();

    el<HTMLInputElement>('live-sharpen').checked = liveSharpen;
    this.syncSelectionBorderSwitches();
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
    this.publishMenuState();
  }

  /** The fill and stroke control shows the tool's ink and fill, the one in front on top. */
  private syncFillStroke(): void {
    const { color, fill, colorTarget } = this.store.tool;
    const control = el('fill-stroke');
    control.dataset.front = colorTarget;
    control.dataset.fill = fill ?? 'none';
    control.dataset.stroke = color;
    const shown = fill ?? 'none';
    const boxes: Array<[HTMLElement, ColorTarget, string, string]> = [
      [el('fill-stroke-fill'), 'fill', 'Fill', shown],
      [el('fill-stroke-stroke'), 'stroke', 'Stroke', color],
    ];
    for (const [box, target, name, value] of boxes) {
      const inFront = colorTarget === target;
      box.style.setProperty('--fs-color', value === 'none' ? 'transparent' : value);
      box.setAttribute('aria-pressed', String(inFront));
      box.setAttribute('aria-label', `${name}: ${value}`);
      box.dataset.titleTemplate = inFront
        ? `${name}: ${value}, in front - click to pick its color; Fill in Front ({key})`
        : `${name}: ${value} - click to put it in front ({key})`;
      this.applyShortcutTitle(box);
    }
    el('fill-stroke-fill').classList.toggle('is-none', fill === null);
  }

  private toast(message: string): void {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), TOAST_MS);
  }

  /**
   * Shows a sentence once the one on screen has had its time, rather than on
   * top of it: for a warning that something said a moment earlier must not
   * hide.
   */
  private toastAfterCurrent(message: string): void {
    if (!el('toast').classList.contains('is-visible')) this.toast(message);
    else window.setTimeout(() => this.toast(message), TOAST_MS);
  }
}

/**
 * True when an element is a field that swallows typing: a text area, a select,
 * or any input that is not one of the widget types (slider, checkbox, radio,
 * color well, button) that consume no letters of their own.
 */
/**
 * True for a control whose own keyboard interaction *is* the space bar.
 *
 * {@link isTextEntry} lets a checkbox through on purpose - it consumes no
 * letters, so the tool shortcuts keep working while one has the focus - but
 * space is not a letter and a checkbox is the one control that has no other
 * key. Tabbing to **Live preview** and pressing space did nothing, because the
 * straight-line shortcut called `preventDefault` on the way past and cancelled
 * the toggle the browser was about to do.
 *
 * Buttons are deliberately not here. They answer to Enter as well, so they lose
 * nothing by giving space up, and taking it from them would mean a toolbar
 * button still holding the focus from the click that selected it would fire
 * again instead of arming the straight-line drag.
 */
function togglesOnSpace(node: Element | null): boolean {
  return node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio');
}

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
    ...(stroke.smudges ? { smudges: mapSmudges(stroke.smudges, shift) } : {}),
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
          // A compound shape's subpath breaks travel with it, or its contours
          // export joined into one outline.
          ...(a.move ? { move: true as const } : {}),
          ...(a.pressure !== undefined ? { pressure: a.pressure } : {}),
        }));
      }
      stroke.width = Math.max(0.1, stroke.width * scale);
      if (stroke.fontSize !== undefined) stroke.fontSize *= scale;
      if (stroke.imageWidth !== undefined) stroke.imageWidth *= scale;
      if (stroke.imageHeight !== undefined) stroke.imageHeight *= scale;
      // A blur and a shadow shrink with what they are on.
      if (stroke.effects) stroke.effects = scaleEffects(stroke.effects, scale);
    }
    if (layer.effects) layer.effects = scaleEffects(layer.effects, scale);
    if (layer.children) transformImportedLayers(layer.children, scale, dx, dy);
  }
}

/** Which axes a mirrored image was flipped across, as its cache key. */
function mirrorAxesKey(m: Mirror): string {
  return `${m.flipX ? 'x' : ''}${m.flipY ? 'y' : ''}`;
}

/**
 * A placed image's pixels, mirrored, as a PNG data URL. The image is redrawn
 * through a canvas under a scale of -1, which moves pixels without resampling
 * them, and a data URL is same-origin, so the canvas can be read back.
 */
async function mirroredImageUrl(src: string, flipX: boolean, flipY: boolean): Promise<string> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return src;
  ctx.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
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
  return tool === 'pen' || tool === 'marker' || tool === 'copic' || tool === 'pencil' || tool === 'eraser'
    ? tool
    : 'pen';
}

/** A point as a corner anchor - no handles - with its pressure. */
function anchorAt(p: Point): VectorAnchor {
  return { p: { x: p.x, y: p.y }, ...(p.pressure !== undefined ? { pressure: p.pressure } : {}) };
}

/** Deep-copies vector anchors so working copies never alias stored strokes. */
function cloneAnchors(anchors: VectorAnchor[]): VectorAnchor[] {
  return anchors.map((a) => ({
    p: { ...a.p },
    ...(a.hIn ? { hIn: { ...a.hIn } } : {}),
    ...(a.hOut ? { hOut: { ...a.hOut } } : {}),
    ...(a.move ? { move: true as const } : {}),
    ...(a.pressure !== undefined ? { pressure: a.pressure } : {}),
  }));
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

/** The Liquify brush's radius when the app starts, in page units: a vector editor's 100-point brush. */
const LIQUIFY_RADIUS = 50;
/** The smallest and the largest Liquify brush, by radius in page units. */
const LIQUIFY_RADIUS_MIN = 4;
const LIQUIFY_RADIUS_MAX = 1000;
/** How much `[` and `]` shrink and grow the Liquify brush. */
const LIQUIFY_RADIUS_STEP = 1.25;
/** How far Twirl turns what is at the brush's centre, in degrees a second, held at a mouse's pressure. */
const LIQUIFY_TWIRL_RATE = 120;
/** How fast Pucker draws in and Bloat pushes out what is near the centre, as a share of its distance a second, at a mouse's pressure. */
const LIQUIFY_SWELL_RATE = 0.6;
/** How far a bent curve may stray from the brush's image of it, in screen pixels. */
const LIQUIFY_TOLERANCE_PX = 0.25;

/** A Liquify brush's radius, held to its range. */
function clampLiquifyRadius(radius: number): number {
  return Math.min(LIQUIFY_RADIUS_MAX, Math.max(LIQUIFY_RADIUS_MIN, Math.round(radius * 10) / 10));
}

/** A press's pressure, for a brush it scales: a mouse's is 0.5, and a pen that reads none is taken as one. */
function liquifyPressure(e: PointerEvent): number {
  return e.pointerType === 'mouse' || !(e.pressure > 0) ? 0.5 : e.pressure;
}

/**
 * The Liquify brushes as its panel draws them: Warp a block whose side the
 * brush (the dashed ring) has pushed out, Twirl a spiral of half turns,
 * Pucker a square drawn in to a four-pointed star, and Bloat one pushed out
 * into a cushion.
 */
const LIQUIFY_TILES: Readonly<Record<LiquifyMode, string>> = {
  warp: '<svg viewBox="0 0 34 26" aria-hidden="true"><path d="M5 6H17C21 6 22 10 26 11.5 29 12.5 29 13.5 26 14.5 22 16 21 20 17 20H5Z" /><circle class="brush" cx="24" cy="13" r="6" /></svg>',
  twirl: '<svg viewBox="0 0 34 26" aria-hidden="true"><path d="M17 13a1 1 0 0 1 2 0 2 2 0 0 1-4 0 3 3 0 0 1 6 0 4 4 0 0 1-8 0 5 5 0 0 1 10 0 6 6 0 0 1-12 0" /></svg>',
  pucker: '<svg viewBox="0 0 34 26" aria-hidden="true"><path d="M17 3C18 9 19 11 26 13 19 15 18 17 17 23 16 17 15 15 8 13 15 11 16 9 17 3Z" /></svg>',
  bloat: '<svg viewBox="0 0 34 26" aria-hidden="true"><path d="M9 6C13 4 21 4 25 6 28 9 28 17 25 20 21 22 13 22 9 20 6 17 6 9 9 6Z" /></svg>',
};

/** The shapes the Shape Eraser cuts with, as its panel shows them. */
type ShapeEraserShape = 'rect' | 'ellipse' | 'square' | 'circle';

const SHAPE_ERASER_SHAPES: ReadonlyArray<{ id: ShapeEraserShape; label: string; icon: string }> = [
  { id: 'rect', label: 'Rectangle', icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><rect x="3" y="5" width="28" height="16" /></svg>' },
  { id: 'ellipse', label: 'Ellipse', icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><ellipse cx="17" cy="13" rx="14" ry="8" /></svg>' },
  { id: 'square', label: 'Square', icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><rect x="7" y="3" width="20" height="20" /></svg>' },
  { id: 'circle', label: 'Circle', icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><circle cx="17" cy="13" r="10" /></svg>' },
];

/** A shape's name for a sentence, with its article: 'a rectangle', 'an ellipse'. */
/** The box two points span. */
function boxOf(a: Point, b: Point): { minX: number; minY: number; maxX: number; maxY: number } {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/**
 * The Shape Stacker panel's tiles: the Wipe Stacks' six rows, each with a
 * vector editor's Pathfinder icon drawn again - a back square and a front
 * one, what the wipe keeps solid and what it takes away dashed.
 */
const STACKER_TILES: ReadonlyArray<{ command: string; label: string; title: string; icon: string }> = [
  {
    command: 'wipe-in',
    label: 'Wipe In',
    title: 'Wipe In - the selected shapes united, as one',
    icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><path class="kept" d="M5 3H19V9H27V23H13V17H5Z" /></svg>',
  },
  {
    command: 'wipe-out-front',
    label: 'Subtract Top',
    title: 'Wipe Out: Subtract Top from Below - the bottom shape less the ones above it',
    icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><path class="kept" d="M5 3H19V9H13V17H5Z" /><path class="gone" d="M13 9H27V23H13Z" /></svg>',
  },
  {
    command: 'wipe-out-back',
    label: 'Subtract Below',
    title: 'Wipe Out: Subtract Below from Top - the top shape less the ones below it',
    icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><path class="gone" d="M5 3H19V17H5Z" /><path class="kept" d="M19 9H27V23H13V17H19Z" /></svg>',
  },
  {
    command: 'wipe-mid',
    label: 'Mid Wipe',
    title: 'Mid Wipe - only where every shape overlaps',
    icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><path class="gone" d="M5 3H19V17H5ZM13 9H27V23H13Z" /><path class="kept" d="M13 9H19V17H13Z" /></svg>',
  },
  {
    command: 'wipe-outer',
    label: 'Outer Wipes',
    title: 'Outer Wipes - where an odd number of the shapes overlap',
    icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><path class="kept" fill-rule="evenodd" d="M5 3H19V9H27V23H13V17H5ZM13 9H19V17H13Z" /></svg>',
  },
  {
    command: 'wipe-clean',
    label: 'Clean Wipe',
    title: 'Clean Wipe - every piece of the overlaps, a shape each',
    icon: '<svg viewBox="0 0 34 26" aria-hidden="true"><path class="piece" d="M5 3H19V17H5ZM13 9H27V23H13Z" /></svg>',
  },
];

function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;
}

/**
 * The Shape Eraser's shape for a drag from `a` to `b`: a Square or a Circle
 * always square, a Rectangle or an Ellipse square with Shift.
 * REUSE: the Rectangle and Ellipse tools' outlines, so a cut is exactly the
 * shape either would draw.
 */
function shapeEraserOutline(shape: ShapeEraserShape, a: Point, b: Point, shift: boolean): Point[] {
  switch (shape) {
    case 'rect':
      return rectPoints(a, b, shift);
    case 'square':
      return rectPoints(a, b, true);
    case 'ellipse':
      return ellipsePoints(a, b, shift);
    case 'circle':
      return ellipsePoints(a, b, true);
  }
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

/**
 * The anchors a Direct Select edit moves: the picked ones, and with the first
 * or last of a closed shape whose ends meet - a rectangle's corner is its
 * first point and its last - the other end too, so the seam never tears.
 */
function withSeamTwins(points: readonly { x: number; y: number }[], picked: Iterable<number>): number[] {
  const out = new Set(picked);
  const last = points.length - 1;
  const first = points[0];
  const end = points[last];
  if (last >= 2 && first && end && Math.hypot(first.x - end.x, first.y - end.y) < 1e-6) {
    if (out.has(0)) out.add(last);
    if (out.has(last)) out.add(0);
  }
  return [...out];
}

/** A zoom as a percentage, whole for most and to a tenth below 10%: 125%, 90000%, 20%. */
function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
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

/**
 * A profile's picture: the outline of a straight stroke drawn with it, as an
 * inline SVG sized `w` x `h` in its own units.
 */
function profilePicture(profile: StrokeProfile, className: string, w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', profilePreviewPath(profile, w, h));
  svg.appendChild(path);
  return svg;
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  void app.start();
});
