/**
 * IPC contract between the Electron main process and the renderer.
 *
 * Channel names live here so the main process, preload bridge, and renderer
 * cannot drift out of sync. The renderer never touches Node APIs directly; it
 * goes through the `window.napkin` bridge exposed by the preload script.
 */

import type { LaunchOptions } from './launch.js';
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
  /** Renderer → main: export all pages as sequentially numbered files. */
  saveImages: 'napkin:save-images',
  /** Renderer → main: report the current document title for the window. */
  setTitle: 'napkin:set-title',
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
  /** Renderer → main → main-renderer: toggle toolbar rearrange mode. */
  toggleRearrange: 'napkin:toggle-rearrange',
  /** Main → renderer: enter/leave toolbar rearrange mode. */
  rearrangeMode: 'napkin:rearrange-mode',
} as const;

/** Actions the native application menu can trigger in the renderer. */
export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'export-png'
  | 'export-jpeg'
  | 'export-svg'
  | 'undo'
  | 'redo'
  | 'toggle-pages'
  | 'toggle-settings'
  | 'open-app-settings'
  | 'toggle-rearrange';

/** Raster image export formats. */
export type ImageFormat = 'png' | 'jpeg';

/** All supported export formats (raster + vector). */
export type ExportFormat = ImageFormat | 'svg';

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
  /**
   * Saves multiple pages as sequentially numbered files.
   * `contents` are data-URLs for PNG/JPEG, or raw SVG strings for SVG.
   * Files are named `<baseName>_1.<ext>`, `<baseName>_2.<ext>`, etc.
   */
  saveImages(format: ExportFormat, contents: string[], baseName: string): Promise<SaveImagesResult>;
  setTitle(title: string): void;
  /** Subscribes to native-menu actions; returns an unsubscribe function. */
  onMenuAction(handler: (action: MenuAction) => void): () => void;

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
  /** Subscribes to rearrange-mode broadcasts; returns an unsubscribe function. */
  onRearrangeMode(handler: (enabled: boolean) => void): () => void;
}

declare global {
  interface Window {
    napkin: NapkinBridge;
  }
}
