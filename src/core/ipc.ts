/**
 * IPC contract between the Electron main process and the renderer.
 *
 * Channel names live here so the main process, preload bridge, and renderer
 * cannot drift out of sync. The renderer never touches Node APIs directly; it
 * goes through the `window.napkin` bridge exposed by the preload script.
 */

import type { AnimationFrameJob } from './animation.js';
import type { AnimationModeStatus } from './animation-install.js';
import type { HelperFailure } from './ai-tool.js';
import type { LaunchOptions } from './launch.js';
import type { ImportedPdfPage } from './pdf-import.js';
import type { AppSettings } from './settings.js';
import type { SketchBook } from './types.js';

/** IPC channel identifiers. */
export const IPC = {
  /** Renderer → main: ask for the initial launch options. */
  getLaunch: 'napkin:get-launch',
  /** Renderer → main: load a book from a known path. */
  loadBook: 'napkin:load-book',
  /** Renderer → main: open a file picker and load the chosen book. */
  openBook: 'napkin:open-book',
  /** Renderer → main: save a book (to its path, or prompt if none). */
  saveBook: 'napkin:save-book',
  /** Renderer → main: save a book to a newly chosen path. */
  saveBookAs: 'napkin:save-book-as',
  /** Renderer → main: export the current page as a PNG/JPEG image. */
  saveImage: 'napkin:save-image',
  /** Renderer → main: export the current page as an SVG document. */
  saveSvg: 'napkin:save-svg',
  /** Renderer → main: export one or all pages as a PDF document. */
  savePdf: 'napkin:save-pdf',
  /** Renderer → main: export all pages as sequentially numbered files. */
  saveImages: 'napkin:save-images',
  /** Renderer → main: pick and read an importable file (SVG/PDF/PNG/JPEG). */
  importFile: 'napkin:import-file',
  /** Renderer → main: read a known importable file without a picker (CLI import). */
  readImportFile: 'napkin:read-import-file',
  /** Renderer → main: report the current document title for the window. */
  setTitle: 'napkin:set-title',
  /** Renderer → main: the sketch has unsaved edits, or no longer has. */
  setDirty: 'napkin:set-dirty',
  /** Main → renderer: the window is closing; save before it does. */
  saveBeforeClose: 'napkin:save-before-close',
  /** Main → renderer: a native menu item was activated. */
  menuAction: 'napkin:menu-action',
  /** Renderer → main: fetch the current application settings. */
  getSettings: 'napkin:get-settings',
  /** Renderer → main: merge a settings patch, persist, and broadcast it. */
  updateSettings: 'napkin:update-settings',
  /** Renderer → main: export settings to a chosen JSON file. */
  exportSettings: 'napkin:export-settings',
  /** Renderer → main: import settings from a chosen JSON file. */
  importSettings: 'napkin:import-settings',
  /** Renderer → main: open (or focus) the settings window. */
  openSettings: 'napkin:open-settings',
  /** Main → renderer: settings changed; renderers should re-apply them. */
  settingsChanged: 'napkin:settings-changed',
  /**
   * Renderer → main → main-renderer: toggle toolbar rearrange mode. The
   * settings window sends it, and main relays it to the drawing window as the
   * `toggle-rearrange` menu action - the same path the Edit menu's own row
   * takes, so there is one way in rather than two.
   */
  toggleRearrange: 'napkin:toggle-rearrange',
  /** Renderer → main: write the animation form and draw one frame with the AI helper. */
  runAnimationHelper: 'napkin:run-animation-helper',
  /** Renderer → main: kill the in-flight AI helper run (Cancel pressed). */
  cancelAnimationHelper: 'napkin:cancel-animation-helper',
  /** Main → renderer: a note on what the helper run is doing. */
  animationStatus: 'napkin:animation-status',
  /** Renderer → main: is Animation Mode installed, and for which AI tool? */
  getAnimationMode: 'napkin:get-animation-mode',
  /** Renderer → main: start the AI tool in a terminal so it can sign in. */
  openAiToolSignIn: 'napkin:open-ai-tool-sign-in',
  /** Renderer → main: rewrite a frame file in the animations folder. */
  saveAnimationFrame: 'napkin:save-animation-frame',
  /** Renderer → main: delete the transient animation temp folder. */
  clearAnimationTemp: 'napkin:clear-animation-temp',
  /** Renderer → main: put the copied selection on the system clipboard as SVG. */
  writeClipboardSvg: 'napkin:write-clipboard-svg',
  /** Renderer → main: read SVG markup sitting on the system clipboard. */
  readClipboardSvg: 'napkin:read-clipboard-svg',
} as const;

/** Actions the native application menu can trigger in the renderer. */
export type MenuAction =
  | 'new'
  | 'open'
  | 'import'
  | 'save'
  | 'save-as'
  | 'export-png'
  | 'export-jpeg'
  | 'export-svg'
  | 'export-pdf'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'paste-in-place'
  | 'duplicate'
  | 'delete-selection'
  | 'select-all'
  | 'fit-view'
  | 'toggle-pages'
  | 'toggle-layers'
  | 'toggle-properties'
  | 'toggle-settings'
  | 'toggle-rearrange'
  | 'toggle-animation'
  | 'rotate'
  | 'mirror';

/** Raster image export formats. */
export type ImageFormat = 'png' | 'jpeg';

/** All supported export formats (raster + vector). */
export type ExportFormat = ImageFormat | 'svg' | 'pdf';

/** Result of picking and reading an importable file. */
export type ImportFileResult =
  | { ok: true; kind: 'svg'; name: string; text: string }
  | { ok: true; kind: 'raster'; name: string; dataUrl: string }
  | { ok: true; kind: 'pdf'; name: string; pages: ImportedPdfPage[] }
  | { ok: false; error?: string; cancelled?: boolean };

/** Result of a multi-page export operation. */
export interface SaveImagesResult {
  ok: boolean;
  filePaths?: string[];
  error?: string;
  cancelled?: boolean;
}

/** Result of an open/load operation. */
export interface OpenResult {
  ok: boolean;
  /** Absolute path of the opened book, if any. */
  filePath?: string;
  /** The loaded book data, if successful. */
  book?: SketchBook;
  /** Error message if `ok` is false. */
  error?: string;
  /** True if the user cancelled a dialog. */
  cancelled?: boolean;
}

/** The generated frame collected from the output folder after a run. */
export interface AnimationFrameOutput {
  /** Frame layer/file stem, e.g. `character-walk_3`. */
  name: string;
  /** The frame's SVG markup. */
  svg: string;
}

/** Result of one AI-helper run: the single frame it drew, or why it did not. */
export interface AnimationHelperResult {
  ok: boolean;
  /**
   * What went wrong, when the app can tell from the outside: the tool is not
   * installed, the tool is installed but nobody has signed in to it, or
   * something else. Drives whether the renderer offers a sign-in walkthrough.
   */
  failure?: HelperFailure;
  /** Executable the helper command names, when a tool problem is the failure. */
  tool?: string;
  /** Human-readable name of that tool (`Claude Code`), for dialogs. */
  toolLabel?: string;
  /** The frame the run produced, when it produced one. */
  frame?: AnimationFrameOutput;
  /** Failure detail when `ok` is false (spawn error, non-zero exit, stall). */
  error?: string;
  /** True when the run ended because the user cancelled it (no error toast). */
  cancelled?: boolean;
}

/**
 * A note on what the in-flight run is doing, for the dialog's status line.
 * One frame per run leaves nothing to count, so the feed reports liveness
 * ("the helper is working") rather than a fraction.
 */
export interface AnimationStatusUpdate {
  /** Human-readable state, e.g. `Helper is working…`. */
  note: string;
}

/** Result of a save operation. */
export interface SaveResult {
  ok: boolean;
  filePath?: string;
  error?: string;
  cancelled?: boolean;
}

/** The API surface exposed to the renderer as `window.napkin`. */
export interface NapkinBridge {
  getLaunch(): Promise<LaunchOptions>;
  loadBook(filePath: string): Promise<OpenResult>;
  openBook(): Promise<OpenResult>;
  saveBook(filePath: string | null, book: SketchBook): Promise<SaveResult>;
  saveBookAs(book: SketchBook): Promise<SaveResult>;
  /** Saves a base64 data-URL image to disk (PNG/JPEG). */
  saveImage(format: ImageFormat, dataUrl: string, suggestedName: string): Promise<SaveResult>;
  /** Saves raw SVG markup to a .svg file. */
  saveSvg(svgContent: string, suggestedName: string): Promise<SaveResult>;
  /** Saves a latin1-safe PDF byte string to a .pdf file. */
  savePdf(pdfContent: string, suggestedName: string): Promise<SaveResult>;
  /** Opens a file picker and reads an importable SVG/PDF/PNG/JPEG file. */
  importFile(): Promise<ImportFileResult>;
  /** Reads a known importable file by absolute path, without a picker. */
  readImportFile(filePath: string): Promise<ImportFileResult>;
  /**
   * Saves multiple pages as sequentially numbered files.
   * `contents` are data-URLs for PNG/JPEG, or raw SVG strings for SVG.
   * Files are named `<baseName>_1.<ext>`, `<baseName>_2.<ext>`, etc.
   */
  saveImages(format: ExportFormat, contents: string[], baseName: string): Promise<SaveImagesResult>;
  setTitle(title: string): void;
  /**
   * Reports whether the sketch has unsaved edits, so closing the window can
   * ask about them instead of throwing them away.
   */
  setDirty(dirty: boolean): void;
  /**
   * Subscribes to the close-time save request; the handler saves and
   * resolves, and the window closes once it does.
   */
  onSaveBeforeClose(handler: () => Promise<boolean>): () => void;
  /** Subscribes to native-menu actions; returns an unsubscribe function. */
  onMenuAction(handler: (action: MenuAction) => void): () => void;
  /**
   * Puts `svgContent` on the system clipboard, so a selection copied here can
   * be pasted into another vector editor.
   */
  writeClipboardSvg(svgContent: string): Promise<void>;
  /**
   * Reads SVG markup from the system clipboard, or null when it holds
   * something else. Lets a graphic copied in another editor paste in here.
   */
  readClipboardSvg(): Promise<string | null>;
  /**
   * Writes `formText` and `sourceSvg` to the animation temp folder and runs
   * the configured AI helper command to draw one frame. Resolves as soon as
   * the frame lands in the output folder; `job` tells the watcher which file
   * to expect.
   */
  runAnimationHelper(
    formText: string,
    job: AnimationFrameJob,
    sourceSvg: string,
  ): Promise<AnimationHelperResult>;
  /**
   * Kills the in-flight AI helper run; the pending `runAnimationHelper`
   * promise resolves immediately with `cancelled: true`.
   */
  cancelAnimationHelper(): void;
  /** Subscribes to the run's status notes; returns an unsubscribe function. */
  onAnimationStatus(handler: (update: AnimationStatusUpdate) => void): () => void;
  /**
   * Whether Animation Mode is installed, and which AI tool it was installed
   * for. The renderer hides every trace of the mode when it is not.
   */
  getAnimationMode(): Promise<AnimationModeStatus>;
  /**
   * Starts the named AI tool in a terminal of its own so the tool can run
   * its own sign-in. napkin-sketch never handles the credential.
   */
  openAiToolSignIn(binary: string): Promise<{ ok: boolean; error?: string }>;
  /**
   * Rewrites `animations/<name>.svg` with the frame as the app holds it:
   * cropped to the ink and transparent, so the file is a usable sprite
   * whatever shape the helper happened to save.
   */
  saveAnimationFrame(name: string, svg: string): Promise<void>;
  /** Removes the animation temp folder (called when a run completes). */
  clearAnimationTemp(): Promise<void>;

  // ---- Application settings -------------------------------------------------

  /** Returns the current, fully-normalized application settings. */
  getSettings(): Promise<AppSettings>;
  /** Merges a partial settings patch, persists it, and broadcasts the result. */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Exports the current settings to a user-chosen JSON file. */
  exportSettings(): Promise<SaveResult>;
  /** Imports settings from a user-chosen JSON file; resolves to the new settings (or null on cancel). */
  importSettings(): Promise<AppSettings | null>;
  /** Opens (or focuses) the standalone settings window. */
  openSettings(): void;
  /** Requests that the main window toggle toolbar rearrange mode. */
  toggleRearrange(): void;
  /** Subscribes to settings-changed broadcasts; returns an unsubscribe function. */
  onSettingsChanged(handler: (settings: AppSettings) => void): () => void;
}

declare global {
  interface Window {
    napkin: NapkinBridge;
  }
}
