/**
 * Preload bridge. Exposes a minimal, typed `window.napkin` API to the renderer
 * over IPC while keeping Node integration disabled in the page for safety.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type ExportFormat,
  type ImageFormat,
  type MenuAction,
  type NapkinBridge,
  type OpenResult,
  type SaveImagesResult,
  type SaveResult,
} from '../core/ipc.js';
import type { LaunchOptions } from '../core/launch.js';
import type { AppSettings } from '../core/settings.js';
import type { SketchBook } from '../core/types.js';

const bridge: NapkinBridge = {
  getLaunch: (): Promise<LaunchOptions> => ipcRenderer.invoke(IPC.getLaunch),
  loadBook: (filePath: string): Promise<OpenResult> => ipcRenderer.invoke(IPC.loadBook, filePath),
  openBook: (): Promise<OpenResult> => ipcRenderer.invoke(IPC.openBook),
  saveBook: (filePath: string | null, book: SketchBook): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveBook, filePath, book),
  saveBookAs: (book: SketchBook): Promise<SaveResult> => ipcRenderer.invoke(IPC.saveBookAs, book),
  saveImage: (format: ImageFormat, dataUrl: string, suggestedName: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveImage, format, dataUrl, suggestedName),
  saveSvg: (svgContent: string, suggestedName: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveSvg, svgContent, suggestedName),
  saveImages: (format: ExportFormat, contents: string[], baseName: string): Promise<SaveImagesResult> =>
    ipcRenderer.invoke(IPC.saveImages, format, contents, baseName),
  setTitle: (title: string): void => ipcRenderer.send(IPC.setTitle, title),
  onMenuAction: (handler: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: unknown, action: MenuAction): void => handler(action);
    ipcRenderer.on(IPC.menuAction, listener);
    return () => ipcRenderer.removeListener(IPC.menuAction, listener);
  },

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.updateSettings, patch),
  exportSettings: (): Promise<SaveResult> => ipcRenderer.invoke(IPC.exportSettings),
  importSettings: (): Promise<AppSettings | null> => ipcRenderer.invoke(IPC.importSettings),
  openSettings: (): void => ipcRenderer.send(IPC.openSettings),
  toggleRearrange: (): void => ipcRenderer.send(IPC.toggleRearrange),
  onSettingsChanged: (handler: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: unknown, settings: AppSettings): void => handler(settings);
    ipcRenderer.on(IPC.settingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.settingsChanged, listener);
  },
  onRearrangeMode: (handler: (enabled: boolean) => void): (() => void) => {
    const listener = (_event: unknown, enabled: boolean): void => handler(enabled);
    ipcRenderer.on(IPC.rearrangeMode, listener);
    return () => ipcRenderer.removeListener(IPC.rearrangeMode, listener);
  },
};

contextBridge.exposeInMainWorld('napkin', bridge);
