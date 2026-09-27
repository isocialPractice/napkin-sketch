/**
 * Preload bridge. Exposes a minimal, typed `window.napkin` API to the renderer
 * over IPC while keeping Node integration disabled in the page for safety.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { AnimationFrameJob } from '../core/animation.js';
import {
  IPC,
  type AnimationHelperResult,
  type AnimationStatusUpdate,
  type ExportFormat,
  type HistoryStats,
  type ImageFormat,
  type AppMenuItemSnapshot,
  type ImportFileResult,
  type MenuConfig,
  type MenuConfigResult,
  type NapkinBridge,
  type OpenResult,
  type SaveImagesResult,
  type SaveResult,
} from '../core/ipc.js';
import type { AnimationModeStatus } from '../core/animation-install.js';
import type { LaunchOptions } from '../core/launch.js';
import type { HelpTopicId, MainCommandId, MenuCommand, MenuState } from '../core/menu/ids.js';
import type { MenuConfigUpdate } from '../core/menu/overrides.js';
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
  saveText: (text: string, suggestedName: string, extension: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveText, text, suggestedName, extension),
  writeClipboardText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.writeClipboardText, text),
  savePdf: (pdfContent: string, suggestedName: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.savePdf, pdfContent, suggestedName),
  importFile: (): Promise<ImportFileResult> => ipcRenderer.invoke(IPC.importFile),
  readImportFile: (filePath: string): Promise<ImportFileResult> =>
    ipcRenderer.invoke(IPC.readImportFile, filePath),
  saveImages: (format: ExportFormat, contents: string[], baseName: string): Promise<SaveImagesResult> =>
    ipcRenderer.invoke(IPC.saveImages, format, contents, baseName),
  setTitle: (title: string): void => ipcRenderer.send(IPC.setTitle, title),
  setDirty: (dirty: boolean): void => ipcRenderer.send(IPC.setDirty, dirty),
  onSaveBeforeClose: (handler: () => Promise<boolean>): (() => void) => {
    const listener = (): void => {
      void handler().then((saved) => ipcRenderer.send(IPC.saveBeforeClose, saved));
    };
    ipcRenderer.on(IPC.saveBeforeClose, listener);
    return () => ipcRenderer.removeListener(IPC.saveBeforeClose, listener);
  },
  onMenuAction: (handler: (id: MenuCommand) => void): (() => void) => {
    const listener = (_event: unknown, id: MenuCommand): void => handler(id);
    ipcRenderer.on(IPC.menuAction, listener);
    return () => ipcRenderer.removeListener(IPC.menuAction, listener);
  },
  getMenuConfig: (): Promise<MenuConfig> => ipcRenderer.invoke(IPC.getMenuConfig),
  updateMenuConfig: (update: MenuConfigUpdate): Promise<MenuConfigResult> => ipcRenderer.invoke(IPC.updateMenuConfig, update),
  onMenuConfigChanged: (handler: (config: MenuConfig) => void): (() => void) => {
    const listener = (_event: unknown, config: MenuConfig): void => handler(config);
    ipcRenderer.on(IPC.menuConfigChanged, listener);
    return () => ipcRenderer.removeListener(IPC.menuConfigChanged, listener);
  },
  setMenuState: (state: MenuState): void => ipcRenderer.send(IPC.setMenuState, state),
  runMainCommand: (id: MainCommandId | HelpTopicId): void => ipcRenderer.send(IPC.runMainCommand, id),
  onNotice: (handler: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, message: string): void => handler(message);
    ipcRenderer.on(IPC.notice, listener);
    return () => ipcRenderer.removeListener(IPC.notice, listener);
  },
  getAppMenu: (): Promise<AppMenuItemSnapshot[]> => ipcRenderer.invoke(IPC.getAppMenu),
  clickAppMenuItem: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.clickAppMenuItem, id),
  openedLinks: (): Promise<string[]> => ipcRenderer.invoke(IPC.openedLinks),
  guiCheck: process.env.NAPKIN_GUI_CHECK === '1',
  writeClipboardSvg: (svgContent: string): Promise<void> =>
    ipcRenderer.invoke(IPC.writeClipboardSvg, svgContent),
  readClipboardSvg: (): Promise<string | null> => ipcRenderer.invoke(IPC.readClipboardSvg),
  runAnimationHelper: (
    formText: string,
    job: AnimationFrameJob,
    sourceSvg: string,
  ): Promise<AnimationHelperResult> =>
    ipcRenderer.invoke(IPC.runAnimationHelper, formText, job, sourceSvg),
  cancelAnimationHelper: (): void => ipcRenderer.send(IPC.cancelAnimationHelper),
  onAnimationStatus: (handler: (update: AnimationStatusUpdate) => void): (() => void) => {
    const listener = (_event: unknown, update: AnimationStatusUpdate): void => handler(update);
    ipcRenderer.on(IPC.animationStatus, listener);
    return () => ipcRenderer.removeListener(IPC.animationStatus, listener);
  },
  getAnimationMode: (): Promise<AnimationModeStatus> =>
    ipcRenderer.invoke(IPC.getAnimationMode),
  openAiToolSignIn: (binary: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.openAiToolSignIn, binary),
  saveAnimationFrame: (name: string, svg: string): Promise<void> =>
    ipcRenderer.invoke(IPC.saveAnimationFrame, name, svg),
  clearAnimationTemp: (): Promise<void> => ipcRenderer.invoke(IPC.clearAnimationTemp),

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

  reportHistoryStats: (stats: HistoryStats): void => ipcRenderer.send(IPC.reportHistoryStats, stats),
  getHistoryStats: (): Promise<HistoryStats | null> => ipcRenderer.invoke(IPC.getHistoryStats),
  onHistoryStatsChanged: (handler: (stats: HistoryStats) => void): (() => void) => {
    const listener = (_event: unknown, stats: HistoryStats): void => handler(stats);
    ipcRenderer.on(IPC.historyStatsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.historyStatsChanged, listener);
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getAppVersion),
  onShowSettingsSection: (handler: (section: string) => void): (() => void) => {
    const listener = (_event: unknown, section: string): void => handler(section);
    ipcRenderer.on(IPC.showSettingsSection, listener);
    return () => ipcRenderer.removeListener(IPC.showSettingsSection, listener);
  },
};

contextBridge.exposeInMainWorld('napkin', bridge);
