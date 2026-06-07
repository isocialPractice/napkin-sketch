/**
 * Launch contract shared between the CLI and the Electron main process.
 *
 * The CLI serializes a {@link LaunchOptions} object into the `NAPKIN_LAUNCH`
 * environment variable; the main process reads and acts on it when the GUI
 * window is ready.
 */

/** How the GUI should open. */
export type LaunchMode =
  /** Start a brand-new, blank sketch. */
  | 'new'
  /** Open an existing `.skbk` sketch book. */
  | 'book'
  /** Open a book/sketch and run auto-sharpen immediately. */
  | 'sharpen';

/** Options describing what the GUI should do on startup. */
export interface LaunchOptions {
  mode: LaunchMode;
  /** Absolute path to a `.skbk` file (for 'book' and 'sharpen'). */
  filePath?: string;
  /** Name for a new sketch (for 'new'). */
  sketchName?: string;
}

/** Environment variable used to hand launch options to the main process. */
export const LAUNCH_ENV_KEY = 'NAPKIN_LAUNCH';

/** Serializes launch options for transport via environment variable. */
export function encodeLaunchOptions(options: LaunchOptions): string {
  return JSON.stringify(options);
}

/** Parses launch options coming from the environment; falls back to a new sketch. */
export function decodeLaunchOptions(raw: string | undefined): LaunchOptions {
  if (!raw) return { mode: 'new', sketchName: 'unnamed' };
  try {
    const parsed = JSON.parse(raw) as Partial<LaunchOptions>;
    const mode: LaunchMode = parsed.mode === 'book' || parsed.mode === 'sharpen' ? parsed.mode : 'new';
    return {
      mode,
      filePath: typeof parsed.filePath === 'string' ? parsed.filePath : undefined,
      sketchName: typeof parsed.sketchName === 'string' ? parsed.sketchName : 'unnamed',
    };
  } catch {
    return { mode: 'new', sketchName: 'unnamed' };
  }
}
