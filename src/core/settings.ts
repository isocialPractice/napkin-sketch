/**
 * Application settings shared between the Electron main process, the settings
 * window, and the main drawing renderer.
 *
 * Settings are persisted to a JSON file in the user-data directory (so they
 * survive across launches), can be exported to / imported from an arbitrary
 * JSON file, and are validated/clamped on every load so a hand-edited or
 * stale file can never put the app into an invalid state.
 */

import {
  DEFAULT_ANIMATION_HELPER_COMMAND,
  DEFAULT_ANIMATION_LOG_FILE,
  LEGACY_ANIMATION_HELPER_COMMANDS,
} from './animation.js';

/** Where the application menu (toolbar) is rendered. */
export type MenuPlacement = 'top' | 'side' | 'both';

/** Visual theme for the application chrome and paper. */
export type AppTheme = 'light' | 'dark' | 'sepia';

/** Modifier key assignable to the Copic quick nib-rotate feature. */
export type QuickModifier = 'ctrl' | 'alt' | 'shift';

/** The assignable quick-feature modifier keys. */
export const QUICK_MODIFIERS: readonly QuickModifier[] = ['ctrl', 'alt', 'shift'];

/** All user-configurable application settings. */
export interface AppSettings {
  /** Multiplier applied to pinch-zoom magnitude (0.25 = gentle, 4 = aggressive). */
  zoomSensitivity: number;
  /** Multiplier applied to two-finger pan magnitude. */
  panSensitivity: number;
  /**
   * When false (default): pinch apart zooms in, pinch together zooms out.
   * When true: the directions are swapped.
   */
  invertZoom: boolean;
  /**
   * Alt + mouse-wheel zoom direction. When false (default): scroll up zooms
   * in, scroll down zooms out. When true: the directions are swapped.
   */
  invertScrollZoom: boolean;
  /**
   * Mouse-wheel pan direction (plain scroll pans vertically, Ctrl+Shift pans
   * horizontally). When false (default): scroll up pans up / right. When
   * true: the directions are swapped.
   */
  invertScrollPan: boolean;
  /**
   * Direction of the Select-tool Space + drag pan. When false (default) the
   * canvas follows the pointer; when true it moves opposite the pointer.
   */
  invertPanDrag: boolean;
  /** Idle window (ms) for the quick-feature digit entry (Quick Width / Opacity). */
  quickTimerMs: number;
  /** Endpoint snap: hold Shift while drawing to snap to the nearest stroke endpoint. */
  endpointSnap: boolean;
  /** Endpoint snap: search radius around the pointer, in screen pixels (1-20). */
  endpointSnapPx: number;
  /** Direct Select: anchor/handle grab radius around the pointer (1-20px). */
  directSelectSensitivityPx: number;
  /**
   * Draw the dashed blue border around each selected element. On by default.
   *
   * Switched off, the selection is still live and still moves, copies and
   * exports the same way; only its outline goes. What that is for is judging
   * the drawing itself while something is selected - the border sits a few
   * pixels off the marks it surrounds, which is exactly where the eye needs
   * nothing when the question is how the drawing looks. The layers panel
   * keeps showing what is selected while the canvas does not.
   *
   * It reads as *show* rather than *hide* because the switch that matters
   * lives in the Move palette, beside **Live preview**: a row of things that
   * are on when they are ticked.
   */
  showSelectionBorders: boolean;
  /**
   * Join stroke: when true, a stroke whose end snaps onto another stroke's
   * endpoint (endpoint snap) is merged with that stroke into one stroke.
   */
  joinStrokeOnSnap: boolean;
  /**
   * Mesh Warp: draw the triangle mesh over the art being warped. Off, only
   * the pins show, so the bend can be judged on the art alone.
   */
  warpShowMesh: boolean;
  /** Eyedropper: color-sampling radius around the click, in screen pixels (1-36). */
  eyedropSensitivityPx: number;
  /** Quick Settings: auto-sharpen each stroke on pen-up. */
  liveSharpen: boolean;
  /** Quick Settings: hand-drawn wobble amplitude (px) for sharpened strokes. */
  sharpenWobble: number;
  /** Quick Settings: smoothing (simplify epsilon, px) for sharpened strokes. */
  sharpenSmoothing: number;
  /** Quick Settings: circle-snap tolerance (relative error) for sharpening. */
  sharpenCircleSnap: number;
  /** Quick Settings: taper sharpened stroke ends. */
  sharpenTaperEnds: boolean;
  /** Quick Settings: rotational symmetry axes (1 = off). */
  symmetry: number;
  /** Quick Settings: text tool font size in pixels. */
  textSize: number;
  /** Number of quick-access colors offered in the toolbar (2-20). */
  quickColorCount: number;
  /** The quick-access color values (CSS hex), length tracks quickColorCount. */
  quickColors: string[];
  /** Where the toolbar lives: along the top, down the side, or both. */
  menuPlacement: MenuPlacement;
  /** Persisted left-to-right order of the tool buttons. */
  toolOrder: string[];
  /** When true, settings are written to disk and reloaded on next launch. */
  rememberSettings: boolean;
  /** Surprise 1: application color theme. */
  theme: AppTheme;
  /** Surprise 2: auto-save interval in seconds for the current file (0 = off). */
  autoSaveIntervalSec: number;
  /** Copic quick nib-rotate: master on/off switch. */
  copicQuickRotate: boolean;
  /** Copic quick nib-rotate: seconds the hold key must stay down to activate. */
  copicHoldSec: number;
  /** Copic quick nib-rotate: modifier held down to activate and stay active. */
  copicHoldKey: QuickModifier;
  /** Copic quick nib-rotate: modifier that rotates the nib clockwise. */
  copicRotateCwKey: QuickModifier;
  /** Copic quick nib-rotate: modifier that rotates the nib counter-clockwise. */
  copicRotateCcwKey: QuickModifier;
  /** Copic quick nib-rotate: rotation speed in degrees per second. */
  copicRotateSpeedDeg: number;
  /**
   * Copic quick nib-rotate: stroke-width multiplier applied while the mode is
   * active (1 = keep the current width). The result is still capped at the
   * app-wide maximum stroke width.
   */
  copicWidthMultiplier: number;
  /**
   * Animation Mode: shell command that runs the AI helper. The command runs
   * with the temp folder's parent as its working directory and must read the
   * form from `_temp/animation-form.txt`, then write the frame SVG to the
   * `animations/` path the form names (or print it to stdout).
   */
  animationHelperCommand: string;
  /**
   * Animation Mode: where AI helper runs are logged, relative to the
   * helper's working directory. An empty string disables the log.
   */
  animationLogFile: string;
}

/** Canonical default quick-access colors (the project ink palette). */
export const DEFAULT_QUICK_COLORS = [
  '#1d2328',
  '#27486d',
  '#2e7d5b',
  '#b3541e',
  '#7a4988',
  '#c0392b',
] as const;

/** Stable identifiers for the reorderable tool buttons (both toolbar groups). */
export const DEFAULT_TOOL_ORDER = [
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
  'tool-bucket',
  'tool-fill',
  'tool-eyedrop',
] as const;

/** Allowed bounds for the numeric settings (single source of truth for the UI). */
export const SETTINGS_LIMITS = {
  zoomSensitivity: { min: 0.25, max: 4, step: 0.05 },
  panSensitivity: { min: 0.25, max: 4, step: 0.05 },
  quickTimerMs: { min: 500, max: 3000, step: 100 },
  endpointSnapPx: { min: 1, max: 20, step: 1 },
  directSelectSensitivityPx: { min: 1, max: 20, step: 1 },
  eyedropSensitivityPx: { min: 1, max: 36, step: 1 },
  sharpenWobble: { min: 0, max: 4, step: 0.1 },
  sharpenSmoothing: { min: 0.5, max: 8, step: 0.5 },
  sharpenCircleSnap: { min: 0.02, max: 0.3, step: 0.01 },
  symmetry: { min: 1, max: 12, step: 1 },
  textSize: { min: 10, max: 96, step: 1 },
  quickColorCount: { min: 2, max: 20, step: 1 },
  autoSaveIntervalSec: { min: 0, max: 600, step: 5 },
  copicHoldSec: { min: 0.5, max: 2, step: 0.1 },
  copicRotateSpeedDeg: { min: 15, max: 360, step: 15 },
  copicWidthMultiplier: { min: 1, max: 4, step: 0.25 },
} as const;

/** Factory for a fresh, valid settings object. */
export function defaultSettings(): AppSettings {
  return {
    zoomSensitivity: 1,
    panSensitivity: 1,
    invertZoom: false,
    invertScrollZoom: false,
    invertScrollPan: false,
    invertPanDrag: false,
    quickTimerMs: 1000,
    endpointSnap: true,
    endpointSnapPx: 10,
    directSelectSensitivityPx: 3,
    showSelectionBorders: true,
    joinStrokeOnSnap: false,
    warpShowMesh: true,
    eyedropSensitivityPx: 10,
    liveSharpen: false,
    sharpenWobble: 1.1,
    sharpenSmoothing: 2.5,
    sharpenCircleSnap: 0.12,
    sharpenTaperEnds: true,
    symmetry: 1,
    textSize: 24,
    quickColorCount: DEFAULT_QUICK_COLORS.length,
    quickColors: [...DEFAULT_QUICK_COLORS],
    menuPlacement: 'top',
    toolOrder: [...DEFAULT_TOOL_ORDER],
    rememberSettings: true,
    theme: 'light',
    autoSaveIntervalSec: 0,
    copicQuickRotate: true,
    copicHoldSec: 1,
    copicHoldKey: 'ctrl',
    copicRotateCwKey: 'alt',
    copicRotateCcwKey: 'shift',
    copicRotateSpeedDeg: 90,
    copicWidthMultiplier: 2,
    animationHelperCommand: DEFAULT_ANIMATION_HELPER_COMMAND,
    animationLogFile: DEFAULT_ANIMATION_LOG_FILE,
  };
}

/** Clamps a number into [min, max], falling back to `fallback` when not finite. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Returns a valid 6-digit (or shorthand) CSS hex color, or null if unusable. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/**
 * Validates and clamps an arbitrary (possibly partial / untrusted) object into a
 * complete, valid {@link AppSettings}. Unknown fields are dropped and invalid
 * values are replaced with defaults so the result is always safe to use.
 */
export function normalizeSettings(input: unknown): AppSettings {
  const base = defaultSettings();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, unknown>;

  const lim = SETTINGS_LIMITS;
  const result: AppSettings = {
    zoomSensitivity: clampNumber(raw.zoomSensitivity, lim.zoomSensitivity.min, lim.zoomSensitivity.max, base.zoomSensitivity),
    panSensitivity: clampNumber(raw.panSensitivity, lim.panSensitivity.min, lim.panSensitivity.max, base.panSensitivity),
    invertZoom: typeof raw.invertZoom === 'boolean' ? raw.invertZoom : base.invertZoom,
    invertScrollZoom:
      typeof raw.invertScrollZoom === 'boolean' ? raw.invertScrollZoom : base.invertScrollZoom,
    invertScrollPan:
      typeof raw.invertScrollPan === 'boolean' ? raw.invertScrollPan : base.invertScrollPan,
    invertPanDrag:
      typeof raw.invertPanDrag === 'boolean' ? raw.invertPanDrag : base.invertPanDrag,
    quickTimerMs: clampNumber(raw.quickTimerMs, lim.quickTimerMs.min, lim.quickTimerMs.max, base.quickTimerMs),
    endpointSnap: typeof raw.endpointSnap === 'boolean' ? raw.endpointSnap : base.endpointSnap,
    endpointSnapPx: Math.round(
      clampNumber(raw.endpointSnapPx, lim.endpointSnapPx.min, lim.endpointSnapPx.max, base.endpointSnapPx),
    ),
    directSelectSensitivityPx: Math.round(
      clampNumber(
        raw.directSelectSensitivityPx,
        lim.directSelectSensitivityPx.min,
        lim.directSelectSensitivityPx.max,
        base.directSelectSensitivityPx,
      ),
    ),
    showSelectionBorders:
      typeof raw.showSelectionBorders === 'boolean'
        ? raw.showSelectionBorders
        : base.showSelectionBorders,
    joinStrokeOnSnap:
      typeof raw.joinStrokeOnSnap === 'boolean' ? raw.joinStrokeOnSnap : base.joinStrokeOnSnap,
    warpShowMesh: typeof raw.warpShowMesh === 'boolean' ? raw.warpShowMesh : base.warpShowMesh,
    eyedropSensitivityPx: Math.round(
      clampNumber(
        raw.eyedropSensitivityPx,
        lim.eyedropSensitivityPx.min,
        lim.eyedropSensitivityPx.max,
        base.eyedropSensitivityPx,
      ),
    ),
    liveSharpen: typeof raw.liveSharpen === 'boolean' ? raw.liveSharpen : base.liveSharpen,
    sharpenWobble: clampNumber(
      raw.sharpenWobble, lim.sharpenWobble.min, lim.sharpenWobble.max, base.sharpenWobble,
    ),
    sharpenSmoothing: clampNumber(
      raw.sharpenSmoothing, lim.sharpenSmoothing.min, lim.sharpenSmoothing.max, base.sharpenSmoothing,
    ),
    sharpenCircleSnap: clampNumber(
      raw.sharpenCircleSnap, lim.sharpenCircleSnap.min, lim.sharpenCircleSnap.max, base.sharpenCircleSnap,
    ),
    sharpenTaperEnds:
      typeof raw.sharpenTaperEnds === 'boolean' ? raw.sharpenTaperEnds : base.sharpenTaperEnds,
    symmetry: Math.round(clampNumber(raw.symmetry, lim.symmetry.min, lim.symmetry.max, base.symmetry)),
    textSize: Math.round(clampNumber(raw.textSize, lim.textSize.min, lim.textSize.max, base.textSize)),
    quickColorCount: Math.round(
      clampNumber(raw.quickColorCount, lim.quickColorCount.min, lim.quickColorCount.max, base.quickColorCount),
    ),
    quickColors: base.quickColors,
    menuPlacement:
      raw.menuPlacement === 'side' || raw.menuPlacement === 'both' ? raw.menuPlacement : 'top',
    toolOrder: normalizeToolOrder(raw.toolOrder),
    rememberSettings: typeof raw.rememberSettings === 'boolean' ? raw.rememberSettings : base.rememberSettings,
    theme: raw.theme === 'dark' || raw.theme === 'sepia' ? raw.theme : 'light',
    autoSaveIntervalSec: Math.round(
      clampNumber(raw.autoSaveIntervalSec, lim.autoSaveIntervalSec.min, lim.autoSaveIntervalSec.max, base.autoSaveIntervalSec),
    ),
    copicQuickRotate: typeof raw.copicQuickRotate === 'boolean' ? raw.copicQuickRotate : base.copicQuickRotate,
    copicHoldSec: clampNumber(raw.copicHoldSec, lim.copicHoldSec.min, lim.copicHoldSec.max, base.copicHoldSec),
    copicHoldKey: normalizeModifier(raw.copicHoldKey, base.copicHoldKey),
    copicRotateCwKey: normalizeModifier(raw.copicRotateCwKey, base.copicRotateCwKey),
    copicRotateCcwKey: normalizeModifier(raw.copicRotateCcwKey, base.copicRotateCcwKey),
    copicRotateSpeedDeg: Math.round(
      clampNumber(raw.copicRotateSpeedDeg, lim.copicRotateSpeedDeg.min, lim.copicRotateSpeedDeg.max, base.copicRotateSpeedDeg),
    ),
    copicWidthMultiplier: clampNumber(
      raw.copicWidthMultiplier, lim.copicWidthMultiplier.min, lim.copicWidthMultiplier.max, base.copicWidthMultiplier,
    ),
    animationHelperCommand: normalizeAnimationCommand(raw.animationHelperCommand, base),
    animationLogFile: normalizeRelativePath(raw.animationLogFile, base.animationLogFile),
  };

  result.quickColors = normalizeQuickColors(raw.quickColors, result.quickColorCount);
  result.quickColorCount = result.quickColors.length;

  // The three quick-rotate keys must be distinct: the hold key wins, then the
  // clockwise key; any clashing later key takes the next unused modifier.
  const used = new Set<QuickModifier>([result.copicHoldKey]);
  for (const field of ['copicRotateCwKey', 'copicRotateCcwKey'] as const) {
    if (used.has(result[field])) {
      result[field] = QUICK_MODIFIERS.find((m) => !used.has(m)) ?? result[field];
    }
    used.add(result[field]);
  }
  return result;
}

/**
 * Coerces the AI helper command, upgrading a persisted copy of an outdated
 * default so command fixes reach existing installs; a hand-customized
 * command is kept verbatim.
 */
function normalizeAnimationCommand(value: unknown, base: AppSettings): string {
  if (typeof value !== 'string' || value.trim().length === 0) return base.animationHelperCommand;
  const trimmed = value.trim();
  if (LEGACY_ANIMATION_HELPER_COMMANDS.includes(trimmed)) return base.animationHelperCommand;
  return trimmed;
}

/**
 * Coerces a path setting that is documented as relative to the helper's
 * working directory into one that actually is.
 *
 * An empty string is a real answer - it switches the log off - and is kept.
 * Anything that would escape the working directory is not: an absolute path
 * replaces that directory outright and a `..` segment climbs out of it, and
 * either would have the app quietly create folders somewhere the setting never
 * claimed to reach. Those fall back to the default rather than being silently
 * rewritten, so a path meant to go elsewhere fails visibly in the settings
 * window instead of half working.
 *
 * A settings file travels between platforms, so a path that is absolute on any
 * of them is rejected on all of them: a leading separator of either kind - one
 * covers a POSIX root and a UNC prefix both - or a drive letter.
 */
export function normalizeRelativePath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (/^[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) return fallback;
  return trimmed.split(/[\\/]+/).includes('..') ? fallback : trimmed;
}

/** Coerces an arbitrary value into a valid quick-feature modifier key. */
function normalizeModifier(value: unknown, fallback: QuickModifier): QuickModifier {
  return QUICK_MODIFIERS.includes(value as QuickModifier) ? (value as QuickModifier) : fallback;
}

/** Coerces an arbitrary value into a valid list of quick-access colors. */
function normalizeQuickColors(value: unknown, count: number): string[] {
  const defaults = defaultSettings().quickColors;
  const source = Array.isArray(value) ? value : defaults;
  const colors: string[] = [];
  for (const entry of source) {
    const hex = normalizeHexColor(entry);
    if (hex) colors.push(hex);
    if (colors.length >= count) break;
  }
  // Top up from the default palette (cycling) so we always have `count` colors.
  let i = 0;
  while (colors.length < count) {
    colors.push(defaults[i % defaults.length]);
    i++;
  }
  return colors.slice(0, Math.max(SETTINGS_LIMITS.quickColorCount.min, count));
}

/** Coerces an arbitrary value into a valid tool order (no duplicates/unknowns). */
function normalizeToolOrder(value: unknown): string[] {
  const known = new Set<string>(DEFAULT_TOOL_ORDER);
  const order: string[] = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (typeof id === 'string' && known.has(id) && !order.includes(id)) order.push(id);
    }
  }
  // Append any tools missing from a partial/stale order so none disappear.
  for (const id of DEFAULT_TOOL_ORDER) if (!order.includes(id)) order.push(id);
  return order;
}

/** Serializes settings to a stable, human-readable JSON string. */
export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

/** Parses a JSON settings string, returning fully-normalized settings. */
export function parseSettings(text: string): AppSettings {
  try {
    return normalizeSettings(JSON.parse(text));
  } catch {
    return defaultSettings();
  }
}
