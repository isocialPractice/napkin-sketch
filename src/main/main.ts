/**
 * Electron main process for napkin-sketch.
 *
 * Creates the drawing window, wires up IPC handlers for sketch-book file I/O,
 * and reads the launch options the CLI passes via the environment.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { decodeLaunchOptions, LAUNCH_ENV_KEY, type LaunchOptions } from '../core/launch.js';
import { IPC, type ExportFormat, type ImageFormat, type MenuAction, type OpenResult, type SaveImagesResult, type SaveResult } from '../core/ipc.js';
import {
  readSketchBook,
  withSketchBookExtension,
  writeSketchBook,
} from '../core/sketchbook.js';
import {
  type AppSettings,
  defaultSettings,
  normalizeSettings,
  parseSettings,
  serializeSettings,
} from '../core/settings.js';
import { SKETCHBOOK_EXTENSION, type SketchBook } from '../core/types.js';

const launch: LaunchOptions = decodeLaunchOptions(process.env[LAUNCH_ENV_KEY]);

// Stable identity so Windows groups the taskbar/Start-menu entry correctly.
const APP_ID = 'dev.napkinsketch.app';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

/** In-memory application settings (loaded from disk on startup). */
let currentSettings: AppSettings = defaultSettings();

/** Absolute path to the persisted settings file in the user-data directory. */
function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** Loads persisted settings from disk, falling back to defaults. */
async function loadSettings(): Promise<AppSettings> {
  try {
    const text = await readFile(settingsFilePath(), 'utf-8');
    return parseSettings(text);
  } catch {
    return defaultSettings();
  }
}

/** Writes the current settings to disk when persistence is enabled. */
async function persistSettings(): Promise<void> {
  if (!currentSettings.rememberSettings) return;
  try {
    await writeFile(settingsFilePath(), serializeSettings(currentSettings), 'utf-8');
  } catch {
    // Persistence is best-effort; in-memory settings still apply this session.
  }
}

/** Sends the current settings to every open renderer so they re-apply live. */
function broadcastSettings(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.settingsChanged, currentSettings);
  }
}

/** Loads the bundled application icon, if present. */
function loadIcon(): Electron.NativeImage | undefined {
  const iconPath = join(__dirname, '..', 'assets', 'icon.png');
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

/** Opens the standalone settings window, or focuses it if already open. */
function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    parent: mainWindow ?? undefined,
    backgroundColor: '#eef1f4',
    title: 'Settings — napkin-sketch',
    icon: loadIcon(),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

/** Sends a menu action to the focused window's renderer. */
function dispatch(action: MenuAction): void {
  mainWindow?.webContents.send(IPC.menuAction, action);
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New Sketch', accelerator: 'CmdOrCtrl+N', click: () => dispatch('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => dispatch('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => dispatch('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => dispatch('save-as') },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            { label: 'PNG Image…', click: () => dispatch('export-png') },
            { label: 'JPEG Image…', click: () => dispatch('export-jpeg') },
            { label: 'SVG Vector…', click: () => dispatch('export-svg') },
          ],
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => dispatch('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => dispatch('redo') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+Alt+,', click: () => openSettingsWindow() },
        { label: 'Rearrange Toolbar', click: () => dispatch('toggle-rearrange') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Pages Panel', accelerator: 'CmdOrCtrl+B', click: () => dispatch('toggle-pages') },
        { label: 'Sharpen Settings', accelerator: 'CmdOrCtrl+,', click: () => dispatch('toggle-settings') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#eef1f4',
    title: 'napkin-sketch',
    icon: loadIcon(),
    fullscreen: launch.fullScreen === true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  buildMenu();

  mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Decodes a base64 image data URL into a Buffer. */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(base64, 'base64');
}

function registerIpc(): void {
  ipcMain.handle(IPC.getLaunch, (): LaunchOptions => launch);

  ipcMain.handle(IPC.loadBook, async (_event, filePath: string): Promise<OpenResult> => {
    try {
      const book = await readSketchBook(filePath);
      return { ok: true, filePath: withSketchBookExtension(filePath), book };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.openBook, async (): Promise<OpenResult> => {
    if (!mainWindow) return { ok: false, error: 'No window available.' };
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Open sketch book',
      filters: [{ name: 'Sketch Book', extensions: [SKETCHBOOK_EXTENSION] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }
    try {
      const filePath = picked.filePaths[0];
      const book = await readSketchBook(filePath);
      return { ok: true, filePath, book };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(
    IPC.saveBook,
    async (_event, filePath: string | null, book: SketchBook): Promise<SaveResult> => {
      try {
        let target = filePath;
        if (!target) {
          if (!mainWindow) return { ok: false, error: 'No window available.' };
          const picked = await dialog.showSaveDialog(mainWindow, {
            title: 'Save sketch book',
            defaultPath: `${book.name || 'untitled'}.${SKETCHBOOK_EXTENSION}`,
            filters: [{ name: 'Sketch Book', extensions: [SKETCHBOOK_EXTENSION] }],
          });
          if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
          target = picked.filePath;
        }
        const saved = await writeSketchBook(target, book);
        return { ok: true, filePath: saved };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(IPC.saveBookAs, async (_event, book: SketchBook): Promise<SaveResult> => {
    if (!mainWindow) return { ok: false, error: 'No window available.' };
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Save sketch book as',
      defaultPath: `${book.name || 'untitled'}.${SKETCHBOOK_EXTENSION}`,
      filters: [{ name: 'Sketch Book', extensions: [SKETCHBOOK_EXTENSION] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
    try {
      const saved = await writeSketchBook(picked.filePath, book);
      return { ok: true, filePath: saved };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(
    IPC.saveImage,
    async (_event, format: ImageFormat, dataUrl: string, suggestedName: string): Promise<SaveResult> => {
      if (!mainWindow) return { ok: false, error: 'No window available.' };
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: `Export ${format.toUpperCase()}`,
        defaultPath: `${suggestedName || 'sketch'}.${ext}`,
        filters: [{ name: `${format.toUpperCase()} Image`, extensions: [ext] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      try {
        await writeFile(picked.filePath, dataUrlToBuffer(dataUrl));
        return { ok: true, filePath: picked.filePath };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    IPC.saveSvg,
    async (_event, svgContent: string, suggestedName: string): Promise<SaveResult> => {
      if (!mainWindow) return { ok: false, error: 'No window available.' };
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: 'Export SVG',
        defaultPath: `${suggestedName || 'sketch'}.svg`,
        filters: [{ name: 'SVG Image', extensions: ['svg'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      try {
        await writeFile(picked.filePath, svgContent, 'utf-8');
        return { ok: true, filePath: picked.filePath };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    IPC.saveImages,
    async (_event, format: ExportFormat, contents: string[], baseName: string): Promise<SaveImagesResult> => {
      if (!mainWindow) return { ok: false, error: 'No window available.' };
      const ext = format === 'jpeg' ? 'jpg' : format;
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: `Export All as ${format.toUpperCase()}`,
        defaultPath: `${baseName || 'sketch'}_1.${ext}`,
        filters: [{ name: `${format.toUpperCase()} Image`, extensions: [ext] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      try {
        const dir = dirname(picked.filePath);
        const base = basename(picked.filePath);
        const fileExt = extname(base);
        const stem = base.slice(0, -fileExt.length).replace(/_\d+$/, '') || base.slice(0, -fileExt.length);
        const filePaths: string[] = [];
        for (let i = 0; i < contents.length; i++) {
          const outPath = join(dir, `${stem}_${i + 1}.${ext}`);
          if (format === 'svg') {
            await writeFile(outPath, contents[i], 'utf-8');
          } else {
            await writeFile(outPath, dataUrlToBuffer(contents[i]));
          }
          filePaths.push(outPath);
        }
        return { ok: true, filePaths };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.on(IPC.setTitle, (_event, title: string) => {
    if (typeof title === 'string') mainWindow?.setTitle(title);
  });

  // ---- Settings -------------------------------------------------------------

  ipcMain.handle(IPC.getSettings, (): AppSettings => currentSettings);

  ipcMain.handle(IPC.updateSettings, async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    currentSettings = normalizeSettings({ ...currentSettings, ...(patch ?? {}) });
    await persistSettings();
    broadcastSettings();
    return currentSettings;
  });

  ipcMain.handle(IPC.exportSettings, async (): Promise<SaveResult> => {
    const parent = settingsWindow ?? mainWindow;
    if (!parent) return { ok: false, error: 'No window available.' };
    const picked = await dialog.showSaveDialog(parent, {
      title: 'Export settings',
      defaultPath: 'napkin-sketch-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
    try {
      await writeFile(picked.filePath, serializeSettings(currentSettings), 'utf-8');
      return { ok: true, filePath: picked.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.importSettings, async (): Promise<AppSettings | null> => {
    const parent = settingsWindow ?? mainWindow;
    if (!parent) return null;
    const picked = await dialog.showOpenDialog(parent, {
      title: 'Load settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    try {
      const text = await readFile(picked.filePaths[0], 'utf-8');
      currentSettings = parseSettings(text);
      // Remember the last loaded settings for the next launch.
      await persistSettings();
      broadcastSettings();
      return currentSettings;
    } catch {
      return null;
    }
  });

  ipcMain.on(IPC.openSettings, () => openSettingsWindow());

  ipcMain.on(IPC.toggleRearrange, () => dispatch('toggle-rearrange'));
}

app.whenReady().then(async () => {
  currentSettings = await loadSettings();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
