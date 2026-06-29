/**
 * Application settings shared between the Electron main process, the settings
 * window, and the main drawing renderer.
 *
 * Settings are persisted to a JSON file in the user-data directory (so they
 * survive across launches), can be exported to / imported from an arbitrary
 * JSON file, and are validated/clamped on every load so a hand-edited or
 * stale file can never put the app into an invalid state.
 */

/** Where the application menu (toolbar) is rendered. */
export type MenuPlacement = 'top' | 'side' | 'both';

/** Visual theme for the application chrome and paper. */
export type AppTheme = 'light' | 'dark' | 'sepia';

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
  /** Idle window (ms) for the quick-feature digit entry (Quick Width / Opacity). */
  quickTimerMs: number;
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

/** Stable identifiers for the reorderable tool buttons. */
export const DEFAULT_TOOL_ORDER = [
  'tool-pen',
  'tool-marker',
  'tool-eraser',
  'tool-select',
  'tool-text',
] as const;

/** Allowed bounds for the numeric settings (single source of truth for the UI). */
export const SETTINGS_LIMITS = {
  zoomSensitivity: { min: 0.25, max: 4, step: 0.05 },
  panSensitivity: { min: 0.25, max: 4, step: 0.05 },
  quickTimerMs: { min: 500, max: 3000, step: 100 },
  quickColorCount: { min: 2, max: 20, step: 1 },
  autoSaveIntervalSec: { min: 0, max: 600, step: 5 },
} as const;

/** Factory for a fresh, valid settings object. */
export function defaultSettings(): AppSettings {
  return {
    zoomSensitivity: 1,
    panSensitivity: 1,
    invertZoom: false,
    quickTimerMs: 1000,
    quickColorCount: DEFAULT_QUICK_COLORS.length,
    quickColors: [...DEFAULT_QUICK_COLORS],
    menuPlacement: 'top',
    toolOrder: [...DEFAULT_TOOL_ORDER],
    rememberSettings: true,
    theme: 'light',
    autoSaveIntervalSec: 0,
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
    quickTimerMs: clampNumber(raw.quickTimerMs, lim.quickTimerMs.min, lim.quickTimerMs.max, base.quickTimerMs),
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
  };

  result.quickColors = normalizeQuickColors(raw.quickColors, result.quickColorCount);
  result.quickColorCount = result.quickColors.length;
  return result;
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
