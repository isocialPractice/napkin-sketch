/**
 * Electron main process for napkin-sketch.
 *
 * Creates the drawing window, wires up IPC handlers for sketch-book file I/O,
 * and reads the launch options the CLI passes via the environment.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import {
  ANIMATION_FORM_FILE,
  ANIMATION_OUTPUT_DIR,
  ANIMATION_PREVIEW_FILE,
  ANIMATION_SOURCE_FILE,
  animationHasStalled,
  animationFrameFile,
  animationFrameName,
  extractSvgMarkup,
  isDuplicateFrame,
  type AnimationFrameJob,
} from '../core/animation.js';
import {
  ANIMATION_INSTALL_FILE,
  parseAnimationInstall,
  type AnimationInstall,
  type AnimationModeStatus,
  isPluginInstall,
} from '../core/animation-install.js';
import { classifyHelperFailure, helperBinary, helperToolFor } from '../core/ai-tool.js';
import { decodeLaunchOptions, LAUNCH_ENV_KEY, type LaunchOptions } from '../core/launch.js';
import { IPC, type AnimationFrameOutput, type AnimationHelperResult, type ExportFormat, type HistoryStats, type ImageFormat, type ImportFileResult, type AppMenuItemSnapshot, type MenuConfig, type MenuConfigResult, type OpenResult, type SaveImagesResult, type SaveResult } from '../core/ipc.js';
import {
  isHelpTopic,
  isMainCommand,
  isMenuCommand,
  MAIN_COMMAND_IDS,
  menuStateFrom,
  type MainCommandId,
  type MenuCommand,
  type MenuState,
} from '../core/menu/ids.js';
import { DOCS_INDEX_PAGE, DOCS_SITE_URL, REPO_URL } from '../core/menu/links.js';
import { planUserFiles, readOverridesText, SHORTCUTS_FILE, TOOL_TYPES_FILE } from '../core/menu/overrides.js';
import { defaultRegistry, helpTopics, loadRegistry, type MenuRegistry } from '../core/menu/registry.js';
import { importPdf } from '../core/pdf-import.js';
import { docsAppCommand, docsKey, docsLink, docsPlan, docsRoot, type DocsAction } from './docs.js';
import { applicationMenuTemplate, menuStructureKey, rowStates } from './menu.js';
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

// A folder to use as the user-data folder, for the GUI checks: a check that
// puts a settings or a menu file there then leaves nobody's own behind. Set
// before the app is ready, which is the last moment Electron takes it.
if (process.env.NAPKIN_USER_DATA) app.setPath('userData', process.env.NAPKIN_USER_DATA);

// Stable identity so Windows groups the taskbar/Start-menu entry correctly.
const APP_ID = 'dev.napkinsketch.app';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
/** The documentation window, while it is open; one is reused for every Help row. */
let docsWindow: BrowserWindow | null = null;

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

/**
 * How much history Track History held when the drawing window last said,
 * kept here for a settings window that opens later; null before it has.
 */
let historyStats: HistoryStats | null = null;

/**
 * The app's version, as its package.json gives it: beside the app when it is
 * packaged, two folders up from `dist/main` when it runs from the repository,
 * where Electron's own version would otherwise answer.
 */
let appVersion: string | null = null;
async function readAppVersion(): Promise<string> {
  if (appVersion !== null) return appVersion;
  for (const file of [join(app.getAppPath(), 'package.json'), join(__dirname, '..', '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(await readFile(file, 'utf-8')) as { name?: unknown; version?: unknown };
      if (pkg.name === 'napkin-sketch' && typeof pkg.version === 'string') return (appVersion = pkg.version);
    } catch {
      // Not here; try the next place.
    }
  }
  return (appVersion = app.getVersion());
}

/** History figures sent over IPC, checked: whole, finite, not negative. */
function readHistoryStats(value: unknown): HistoryStats | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const whole = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null);
  const steps = whole(raw.steps);
  const limit = whole(raw.limit);
  const bytes = whole(raw.bytes);
  if (typeof raw.tracking !== 'boolean' || steps === null || limit === null || bytes === null) return null;
  return { tracking: raw.tracking, steps, limit, bytes };
}

/**
 * Opens the standalone settings window, or focuses it if already open, and
 * brings `section` - the id of one of its sections, such as `automate` -
 * into view.
 */
function openSettingsWindow(section?: string): void {
  const hash = section !== undefined && /^[a-z][a-z-]*$/.test(section) ? section : undefined;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!GUI_BACKGROUND) settingsWindow.focus();
    if (hash) settingsWindow.webContents.send(IPC.showSettingsSection, hash);
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    parent: mainWindow ?? undefined,
    backgroundColor: '#eef1f4',
    title: 'Verbose Settings — napkin-sketch',
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
  settingsWindow.loadFile(join(__dirname, '..', 'renderer', 'settings.html'), hash ? { hash } : undefined);
  settingsWindow.once('ready-to-show', () => {
    if (!settingsWindow) return;
    if (GUI_BACKGROUND) showInBackground(settingsWindow);
    else settingsWindow.show();
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ---- The menu bar -------------------------------------------------------------

/**
 * The user's two menu files as read at startup. The drawing window asks for
 * them and builds its right-click menus from the same registry the menu bar
 * is built from, so the two cannot disagree.
 */
let menuConfig: MenuConfig = { toolTypes: null, shortcuts: null, problems: [] };

/** The shipped menu files with the user's merged in. */
let menuRegistry: MenuRegistry = defaultRegistry();

/** The drawing window's answers to the menus' questions, as it last sent them. */
let rendererMenuState: MenuState = {};

/** What decided the rows of the menu bar now built; see {@link menuStructureKey}. */
let menuStructure: string | null = null;

/** The answers only the main process has: they decide whether some rows are there at all. */
function mainMenuState(): MenuState {
  return { animationNotInstalled: animationInstall === null, noDocsSite: DOCS_SITE_URL === null };
}

function currentMenuState(): MenuState {
  return { ...rendererMenuState, ...mainMenuState() };
}

/** Reads one of the user's menu files from the user-data folder: its parsed value, or null and why. */
async function readMenuFile(file: string, what: 'shortcuts' | 'tool types'): Promise<{ value: unknown; problem: string | null }> {
  let text: string;
  try {
    text = await readFile(join(app.getPath('userData'), file), 'utf-8');
  } catch (err) {
    // No file is the usual case: nobody has changed anything.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { value: null, problem: null };
    return { value: null, problem: `The ${what} file could not be read (${(err as Error).message}), so it was ignored.` };
  }
  return readOverridesText(text, what);
}

/** Reads the user's menu files and builds the registry both processes draw from. */
async function loadMenuConfig(): Promise<void> {
  const [toolTypes, shortcuts] = await Promise.all([
    readMenuFile(TOOL_TYPES_FILE, 'tool types'),
    readMenuFile(SHORTCUTS_FILE, 'shortcuts'),
  ]);
  menuConfig = {
    toolTypes: toolTypes.value,
    shortcuts: shortcuts.value,
    problems: [toolTypes.problem, shortcuts.problem].filter((problem): problem is string => problem !== null),
  };
  menuRegistry = loadRegistry({ toolTypes: menuConfig.toolTypes, shortcuts: menuConfig.shortcuts });
  // The drawing window shows these as a toast; the log is for a terminal.
  for (const problem of [...menuConfig.problems, ...menuRegistry.problems]) console.warn(`napkin-sketch menus: ${problem}`);
}

/**
 * Saves what a menu editor accepted. The user's files are planned first
 * ({@link planUserFiles}): only what differs from the shipped files, and no
 * file at all when nothing does, which is how Reset to defaults ends. A plan
 * with problems writes nothing and says the first. Otherwise the files are
 * written, read back, the menu bar is built again - its accelerators are the
 * shortcuts - and every window is sent the new files, so the drawing
 * window's registry, tooltips and keys follow at once.
 */
async function updateMenuConfig(update: unknown): Promise<MenuConfigResult> {
  const plan = planUserFiles({ toolTypes: menuConfig.toolTypes, shortcuts: menuConfig.shortcuts }, update);
  if (plan.problems.length > 0) {
    const [first, ...rest] = plan.problems;
    return { ok: false, error: rest.length === 0 ? first : `${first} (and ${rest.length} more)` };
  }
  const folder = app.getPath('userData');
  const writes: [string, string | null | undefined][] = [
    [SHORTCUTS_FILE, plan.shortcuts],
    [TOOL_TYPES_FILE, plan.toolTypes],
  ];
  try {
    await mkdir(folder, { recursive: true });
    for (const [file, text] of writes) {
      if (text === undefined) continue;
      if (text === null) await rm(join(folder, file), { force: true });
      else await writeFile(join(folder, file), text, 'utf-8');
    }
  } catch (err) {
    return { ok: false, error: `The menu files could not be saved: ${(err as Error).message}` };
  }
  await loadMenuConfig();
  buildMenu();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.menuConfigChanged, menuConfig);
  return { ok: true, config: menuConfig };
}

/** Shows the user a sentence, as a toast in the drawing window. */
function notice(message: string): void {
  mainWindow?.webContents.send(IPC.notice, message);
}

/** True when the app was started for a GUI check (`NAPKIN_GUI_CHECK=1`). */
const GUI_CHECK = process.env.NAPKIN_GUI_CHECK === '1';

/**
 * True when a GUI check runs in the background (`NAPKIN_GUI_BACKGROUND=1`,
 * which `npm run gui-check -- --background` sets): every window the app
 * opens is shown without taking the focus, past the left of every screen and
 * out of the taskbar, so the person at the computer can go on using it -
 * their mouse cannot reach the windows, and their keys go where they meant
 * them to. The drawing window opens at about the size of the page the checks
 * pin (see {@link backgroundSize}) rather than maximized.
 */
const GUI_BACKGROUND = GUI_CHECK && process.env.NAPKIN_GUI_BACKGROUND === '1';

/**
 * The drawing window's content size in a background check: `NAPKIN_GUI_SIZE`
 * (`1494x837`), which the checks set to the page size they pin, or null. The
 * checks pin the page itself over the DevTools protocol; this only keeps the
 * window near that size, as near as the screen lets it (Windows keeps a
 * window no wider than the screen).
 */
function backgroundSize(): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(process.env.NAPKIN_GUI_SIZE ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Shows a window for a check in the background: past the left of every screen, out of the taskbar, without the focus. */
function showInBackground(win: BrowserWindow): void {
  const left = Math.min(...screen.getAllDisplays().map((display) => display.bounds.x));
  const [width] = win.getSize();
  win.setSkipTaskbar(true);
  win.setPosition(left - width - 100, 0);
  win.showInactive();
}

/**
 * The links a GUI check's clicks sent to the system browser, kept for the
 * check to read back instead of opened, so a check run starts no browser on
 * the machine that runs it.
 */
const checkOpenedLinks: string[] = [];

/** Opens one of the app's own links in the system browser, and says so when that fails. */
function openLink(url: string): void {
  if (GUI_CHECK) {
    checkOpenedLinks.push(url);
    return;
  }
  shell.openExternal(url).catch((err: Error) => notice(`Could not open ${url}: ${err.message}`));
}

// ---- The documentation window ------------------------------------------------------

/** The folder the documentation pages are read from: the resources folder's when packaged, the repository's otherwise. */
function docsFolder(): string {
  return docsRoot({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname });
}

/**
 * Opens a documentation page, such as `quickstart/draw`: in the docs window
 * when the page is on disk, on the published site when it is not and the
 * site is up, and otherwise as a toast saying where the pages come from.
 */
function openDocs(page: string): void {
  const plan = docsPlan(page, docsFolder(), existsSync, DOCS_SITE_URL);
  if (plan.kind === 'window') openDocsWindow(plan.file);
  else if (plan.kind === 'browser') openLink(plan.url);
  else notice(plan.message);
}

/** Loads a page into the docs window. A load that a newer one replaced is not a failure. */
function loadDocsPage(win: BrowserWindow, file: string): void {
  win.loadFile(file).catch((err: Error) => {
    if (!/ERR_ABORTED/.test(err.message)) notice(`Could not open the documentation: ${err.message}`);
  });
}

/** Moves the docs window back or forward through the pages it has shown, or closes it. */
function runDocsAction(win: BrowserWindow, action: DocsAction): void {
  const contents = win.webContents;
  if (action === 'close') win.close();
  else if (action === 'back' && contents.canGoBack()) contents.goBack();
  else if (action === 'forward' && contents.canGoForward()) contents.goForward();
}

/**
 * Opens the documentation window at a page's file, or shows that page in the
 * one already open. The pages are read from disk, so they need no network.
 * The window has no menu bar, so none of the drawing window's shortcuts act
 * through it, and no preload, so its pages reach nothing of the app's. A page
 * link stays in it, a web or mail link opens in the system browser, and
 * nothing else is followed; Alt and an arrow go back and forward, as the
 * mouse's side buttons do, and Ctrl+W closes it.
 */
function openDocsWindow(file: string): void {
  if (docsWindow && !docsWindow.isDestroyed()) {
    loadDocsPage(docsWindow, file);
    if (docsWindow.isMinimized()) docsWindow.restore();
    if (!GUI_BACKGROUND) docsWindow.focus();
    return;
  }
  const root = docsFolder();
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 360,
    minHeight: 420,
    // The pages' own background, so the window shows no white before a page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1f24' : '#eef1f4',
    title: 'napkin-sketch documentation',
    icon: loadIcon(),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  docsWindow = win;
  win.removeMenu();
  const follow = (url: string): boolean => {
    const link = docsLink(url, root);
    if (link.kind === 'browser') openLink(link.url);
    return link.kind === 'stay';
  };
  // A page asking for a new window gets this one, or the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (follow(url)) win.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!follow(url)) event.preventDefault();
  });
  win.webContents.on('before-input-event', (event, input) => {
    const action = docsKey(input, process.platform === 'darwin');
    if (action === null) return;
    event.preventDefault();
    runDocsAction(win, action);
  });
  win.on('app-command', (_event, command) => {
    const action = docsAppCommand(command);
    if (action !== null) runDocsAction(win, action);
  });
  win.once('ready-to-show', () => (GUI_BACKGROUND ? showInBackground(win) : win.show()));
  win.on('closed', () => {
    if (docsWindow === win) docsWindow = null;
  });
  loadDocsPage(win, file);
}

/** What the commands the main process owns do. */
const mainCommands: Record<MainCommandId, () => void> = {
  'verbose-settings': () => openSettingsWindow(),
  'history-limit': () => openSettingsWindow('automate'),
  'help-verbose': () => openDocs(DOCS_INDEX_PAGE),
  'help-source-code': () => openLink(REPO_URL),
  'help-source-docs': () => {
    if (DOCS_SITE_URL !== null) openLink(DOCS_SITE_URL);
  },
};

/** Runs a command the main process owns, a Help > Tool Types row included. */
function runMainCommand(id: string): void {
  if (isHelpTopic(id)) {
    const topic = helpTopics(menuRegistry).find((row) => row.id === id);
    if (topic) openDocs(topic.page);
    return;
  }
  if ((MAIN_COMMAND_IDS as readonly string[]).includes(id)) mainCommands[id as MainCommandId]();
}

/** Asks the drawing window to run a command. */
function dispatch(id: MenuCommand): void {
  mainWindow?.webContents.send(IPC.menuAction, id);
}

/** A click on a row of the menu bar: the main process runs its own commands, and hands the rest to the drawing window. */
function onMenuClick(id: string): void {
  if (isMainCommand(id)) runMainCommand(id);
  else if (isMenuCommand(id)) dispatch(id);
  // Electron flips a check mark by itself on a click. The state decides it,
  // so it goes back to what the state says until the state changes.
  refreshMenuState();
}

/** Builds the menu bar: the registry's rows for the current state. */
function buildMenu(): void {
  const state = currentMenuState();
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate(menuRegistry, state, onMenuClick)));
  menuStructure = menuStructureKey(menuRegistry, state);
}

/**
 * Greys and checks the menu bar's rows for the current state, on the items it
 * already has. The menu bar is built again only when the state changes which
 * rows it has, which the answers the drawing window sends never do.
 */
function refreshMenuState(): void {
  const state = currentMenuState();
  const menu = Menu.getApplicationMenu();
  if (!menu || menuStructureKey(menuRegistry, state) !== menuStructure) {
    buildMenu();
    return;
  }
  for (const row of rowStates(menuRegistry, state)) {
    const item = menu.getMenuItemById(row.id);
    if (!item) continue;
    if (item.enabled !== row.enabled) item.enabled = row.enabled;
    if (row.checked !== null && item.checked !== row.checked) item.checked = row.checked;
  }
}

/** The live menu bar as data, for a GUI check to read back. */
function snapshotMenu(items: Electron.MenuItem[]): AppMenuItemSnapshot[] {
  return items.map((item) => ({
    id: item.id || null,
    label: item.label,
    role: item.role ?? null,
    type: item.type,
    enabled: item.enabled,
    checked: item.checked,
    visible: item.visible,
    accelerator: item.accelerator ?? null,
    registerAccelerator: item.registerAccelerator,
    submenu: item.submenu ? snapshotMenu(item.submenu.items) : null,
  }));
}

function createWindow(): void {
  // The default window opens maximized, which is not the same as full screen:
  // a maximized window keeps the minimize / restore-down / close controls in
  // view, while full screen (-f, --full-screen) hides them. The width/height
  // below stay the restore-down size the maximized window returns to.
  const openFullScreen = launch.fullScreen === true && !GUI_BACKGROUND;
  const pinned = GUI_BACKGROUND ? backgroundSize() : null;
  // In a background check the window opens near the page size the check pins,
  // off the screen and without the focus, and is never maximized.
  mainWindow = new BrowserWindow({
    width: pinned?.width ?? 1280,
    height: pinned?.height ?? 860,
    ...(pinned ? { useContentSize: true } : {}),
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#eef1f4',
    title: 'napkin-sketch',
    icon: loadIcon(),
    fullscreen: openFullScreen,
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
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (GUI_BACKGROUND) {
      showInBackground(mainWindow);
      return;
    }
    if (!openFullScreen) mainWindow.maximize();
    mainWindow.show();
  });

  // Closing with unsaved edits used to throw them away without a word. The
  // close is held, the usual three-option prompt is put up, and the window
  // only goes when the answer says it may.
  mainWindow.on('close', (event) => {
    if (!sketchDirty || closingConfirmed || !mainWindow) return;
    event.preventDefault();
    const win = mainWindow;
    void (async () => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved changes',
        message: 'Do you want to save the changes you made to this sketch?',
        detail: "Your changes will be lost if you don't save them.",
      });
      if (response === 2) return;
      if (response === 0 && !(await saveFromRenderer(win))) return;
      closingConfirmed = true;
      win.close();
    })();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    sketchDirty = false;
    closingConfirmed = false;
  });
}

/** True while the renderer reports unsaved edits. */
let sketchDirty = false;

/** Set once the close prompt has been answered, so the retry goes through. */
let closingConfirmed = false;

/**
 * Asks the renderer to save, and resolves with whether it did. A save that
 * the user cancels out of (the file dialog's own Cancel) answers false, which
 * leaves the window open - closing anyway would lose exactly what the prompt
 * was protecting.
 */
function saveFromRenderer(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (_event: unknown, saved: boolean): void => {
      clearTimeout(timer);
      ipcMain.removeListener(IPC.saveBeforeClose, done);
      resolve(saved);
    };
    // A renderer that never answers must not wedge the window shut.
    const timer = setTimeout(() => done(null, false), 30_000);
    ipcMain.on(IPC.saveBeforeClose, done);
    win.webContents.send(IPC.saveBeforeClose);
  });
}

/** Decodes a base64 image data URL into a Buffer. */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(base64, 'base64');
}

/** The pictures an import reads, by extension, with the media type each is read as. */
const RASTER_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Reads an importable SVG/PDF/PNG/JPEG/GIF/WebP file from a known path. */
async function readImportable(filePath: string): Promise<ImportFileResult> {
  const fileName = basename(filePath);
  const name = basename(filePath, extname(filePath));
  const ext = extname(filePath).toLowerCase();
  try {
    if (ext === '.svg') {
      const text = await readFile(filePath, 'utf-8');
      return { ok: true, kind: 'svg', name, fileName, text };
    }
    if (ext === '.pdf') {
      const pages = importPdf(await readFile(filePath));
      return { ok: true, kind: 'pdf', name, fileName, pages };
    }
    const mime = RASTER_TYPES[ext];
    if (!mime) return { ok: false, error: `Unsupported import type: ${ext || filePath}` };
    const bytes = await readFile(filePath);
    return { ok: true, kind: 'raster', name, fileName, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Base directory the animation temp folder (and the AI helper) works in.
 * The project directory in development; the user-data directory when the
 * packaged app's working directory is not writable territory.
 */
function animationWorkDir(): string {
  return app.isPackaged ? app.getPath('userData') : process.cwd();
}

/**
 * Animation Mode's install record, or null when the feature is not
 * installed. Read once at startup and consulted everywhere the mode could
 * show itself, so an app without it behaves as though the feature had never
 * been written.
 */
let animationInstall: AnimationInstall | null = null;

/** Reads `ai-helper/installed.json`; anything unreadable means "not installed". */
async function loadAnimationInstall(): Promise<AnimationInstall | null> {
  try {
    const text = await readFile(join(animationWorkDir(), ANIMATION_INSTALL_FILE), 'utf-8');
    return parseAnimationInstall(text);
  } catch {
    return null;
  }
}

/** What the renderer needs to know about the feature at startup. */
function animationModeStatus(): AnimationModeStatus {
  return {
    installed: animationInstall !== null,
    tool: animationInstall?.tool ?? null,
    plugin: isPluginInstall(animationInstall),
  };
}

/**
 * Starts the configured AI tool in a terminal window of its own so it can
 * run its own sign-in. Every one of these CLIs prompts to sign in when it is
 * started interactively without credentials, so this hands the user straight
 * to that prompt rather than to a page of instructions.
 *
 * napkin-sketch never sees, asks for, or stores a credential: it starts the
 * tool and steps out of the way. The terminal is detached, so the sign-in
 * outlives the app and the app does not wait on it.
 */
function openAiToolSignIn(binary: string): { ok: boolean; error?: string } {
  if (!/^[\w.-]+$/.test(binary)) {
    return { ok: false, error: `Refusing to start "${binary}".` };
  }
  // Opening a terminal on a tool that is not there just moves the failure
  // into a window that closes again, so it is answered here instead.
  if (!helperBinaryExists(binary)) {
    return { ok: false, error: `${binary} was not found on your PATH.` };
  }
  try {
    if (process.platform === 'win32') {
      // One string rather than an argv array, because Node escapes an entry
      // that already carries quotes: the window title arrived as
      // `"\"napkin-sketch sign-in\""`, so `start` read the half after the
      // space as a command and Windows reported it could not find
      // `sign-in\`. A single string goes to `cmd /d /s /c`, whose /s strips
      // the outer quotes and leaves the rest exactly as written here.
      spawn(`start "napkin-sketch sign-in" cmd /k ${binary}`, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        // Hides the wrapper shell only. The terminal `start` opens is a
        // process of its own and stays visible, which is the whole point.
        windowsHide: true,
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `tell application "Terminal" to do script "${binary}"`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else {
      // x-terminal-emulator is the Debian alternative; xterm is the fallback
      // every desktop still ships.
      spawn('sh', ['-c', `x-terminal-emulator -e ${binary} || xterm -e ${binary}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * True when the helper command's executable can actually be found. Checking
 * before the run turns "nothing happened for five minutes" into a dialog
 * that names the missing tool.
 */
function helperBinaryExists(binary: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [binary], { windowsHide: true });
  return result.status === 0;
}

/*
 * There is no overall time limit on a frame run, but a run showing no sign of
 * life is treated as hung and killed. What counts as a sign of life, and how
 * long it may be absent, lives in the core beside the rule that reads them:
 * see `animationHasStalled`. Cancel ends a run immediately either way.
 */

/** How often the background listener looks for the finished frame file. */
const ANIMATION_POLL_MS = 1000;

/**
 * How long the frame may wait for the helper's closing line.
 *
 * Long enough for a process that has already saved its file to flush one
 * sentence, short enough that a sequence never noticeably waits on it.
 */
const ANIMATION_REPLY_GRACE_MS = 4000;

/** The AI helper process currently running, if any (one run at a time). */
let animationChild: ReturnType<typeof spawn> | null = null;

/** Resolves the pending helper promise early (cancel), if a run is pending. */
let animationSettle: ((result: AnimationHelperResult) => void) | null = null;

/**
 * Debug log for AI helper runs. The location comes from the
 * `animationLogFile` setting (default `logs/animation-helper.log`, relative
 * to the helper's working directory; empty disables logging) and lives
 * outside `_temp/`, so clearing the temp folder keeps the log. Records each
 * invocation's command, exit, stderr, and the head of stdout - enough to
 * see why a run produced no SVG.
 */
function animationLogPath(): string | null {
  const configured = currentSettings.animationLogFile.trim();
  if (!configured) return null;
  return join(animationWorkDir(), configured);
}

/** Appends timestamped lines to the helper debug log, best-effort. */
async function logAnimation(...lines: string[]): Promise<void> {
  const logPath = animationLogPath();
  if (!logPath) return;
  const stamp = new Date().toISOString();
  const text = lines.map((line) => `[${stamp}] ${line}`).join('\n') + '\n';
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, text, 'utf-8');
  } catch {
    // Logging must never break a run.
  }
}

/** Pushes a status note to the renderer's generation dialog. */
function sendAnimationStatus(note: string): void {
  mainWindow?.webContents.send(IPC.animationStatus, { note });
}

/**
 * Reads the run's frame file, if the helper has finished writing it. The
 * markup check doubles as the completeness test: a file still being written
 * has no closing tag yet, so it reads as absent until it is whole.
 */
async function readAnimationFrame(job: AnimationFrameJob): Promise<AnimationFrameOutput | null> {
  try {
    const text = await readFile(join(animationWorkDir(), animationFrameFile(job)), 'utf-8');
    const svg = extractSvgMarkup(text);
    return svg ? { name: animationFrameName(job), svg } : null;
  } catch {
    return null; // Not written yet.
  }
}

/**
 * Kills the running AI helper and everything it spawned. `shell: true`
 * wraps the command in cmd.exe / sh, so a plain kill() would fell only the
 * shell and leave the actual tool running; on Windows taskkill takes the
 * whole process tree down, and elsewhere SIGTERM reaches the shell's
 * children through the default process-group semantics.
 */
/**
 * When the helper last wrote to the frame it is posing.
 *
 * The stall limit used to watch stdout alone, and `claude -p` prints nothing
 * until it exits - so a run that was working perfectly well looked identical
 * to a hung one, and the limit was really a hard cap on the whole job rather
 * than a stall detector. It only showed once the job grew: posing eleven
 * layers instead of four took 199s, then 260s, then past 300s, and the third
 * frame was killed mid-edit with nothing wrong.
 *
 * What a working helper does leave behind is writes. It edits the source once
 * per layer it poses and renders a preview beside it to grade itself, so a
 * moving mtime is proof of life that silence cannot hide. A helper that has
 * genuinely stopped touches neither file and still gets killed on time.
 */
async function animationLastWrite(cwd: string): Promise<number> {
  let latest = 0;
  for (const rel of [ANIMATION_SOURCE_FILE, ANIMATION_PREVIEW_FILE]) {
    try {
      latest = Math.max(latest, (await stat(join(cwd, rel))).mtimeMs);
    } catch {
      // Not written yet, or already cleaned up. Absence is not activity.
    }
  }
  return latest;
}

function killAnimationChild(): void {
  const child = animationChild;
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Cancels the in-flight AI helper run: the pending promise resolves
 * immediately (so the renderer's dialog can close without waiting) and the
 * helper's process tree is killed behind it.
 */
function cancelAnimationHelper(): void {
  void logAnimation('run cancelled by user; killing helper process tree');
  killAnimationChild();
  animationSettle?.({ ok: false, cancelled: true });
}

/**
 * Writes the form text to `_temp/animation-form.txt` and runs the configured
 * helper command through the platform shell (cmd.exe on Windows, sh
 * elsewhere - both resolve the command's `<` redirection) to draw one frame.
 *
 * A background listener watches for the frame file and ends the run the
 * moment a complete document appears: an agentic CLI keeps working (and
 * talking) well past its last file write, and waiting for it to exit is what
 * made batch runs look hung. A run with no file and no output for
 * {@link ANIMATION_STALL_LIMIT_MS} is killed so it can never hang. A helper
 * that only prints its frame is honored too - the markup is pulled out of
 * stdout at exit and saved to the same path.
 */
async function runAnimationHelper(
  formText: string,
  job: AnimationFrameJob,
  sourceSvg: string,
): Promise<AnimationHelperResult> {
  if (!animationInstall) {
    return { ok: false, error: 'Animation Mode is not installed.', failure: 'other' };
  }
  const cwd = animationWorkDir();
  const formPath = join(cwd, ANIMATION_FORM_FILE);
  const framePath = join(cwd, animationFrameFile(job));
  const frameName = animationFrameName(job);

  // Check the tool is there before writing anything. A command that cannot
  // start should name itself in a dialog rather than look like a stalled run,
  // and it is the same check that tells a missing tool from an unsigned-in
  // one once the run comes back empty.
  const binary = helperBinary(currentSettings.animationHelperCommand);
  const tool = helperToolFor(currentSettings.animationHelperCommand);
  if (!binary || !helperBinaryExists(binary)) {
    await logAnimation(`preflight: helper executable "${binary}" is not on PATH`);
    return {
      ok: false,
      failure: 'missing-tool',
      tool: binary,
      toolLabel: tool?.label ?? binary,
      error: `${tool?.label ?? (binary || 'The AI helper')} was not found on your PATH.`,
    };
  }

  try {
    await mkdir(dirname(formPath), { recursive: true });
    await writeFile(formPath, formText, 'utf-8');
    // The source frame goes next to the form: the helper edits this file
    // rather than reading the geometry out of the prompt.
    await writeFile(join(cwd, ANIMATION_SOURCE_FILE), sourceSvg, 'utf-8');
    await mkdir(join(cwd, ANIMATION_OUTPUT_DIR), { recursive: true });
    // A file left by an earlier attempt at this frame (a redraw) must not
    // read as this run's output.
    await rm(framePath, { force: true });
  } catch (err) {
    return { ok: false, error: `Could not prepare the run: ${(err as Error).message}` };
  }

  const command = currentSettings.animationHelperCommand;
  const startedAt = Date.now();
  await logAnimation(
    `run start: cwd=${cwd}`,
    `run start: command=${command}`,
    `run start: frame=${frameName} from source index ${job.sourceIndex} -> ${animationFrameFile(job)}`,
    `run start: form=${Buffer.byteLength(formText, 'utf-8')} bytes at ${ANIMATION_FORM_FILE}, source=${Buffer.byteLength(sourceSvg, 'utf-8')} bytes at ${ANIMATION_SOURCE_FILE}`,
  );
  return new Promise((resolvePromise) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let lastActivity = Date.now();
    let lastWrite = 0;
    // The helper has touched the frame, so the tighter limit applies from here.
    let editing = false;
    let announcedWork = false;
    let announcedCopy = false;
    // The frame file appears before the helper has finished speaking, and the
    // poller keeps firing while we wait for it to. Without this a second tick
    // finds the same file and starts a second finish.
    let finishing = false;
    let poller: ReturnType<typeof setInterval> | null = null;

    const settle = (result: AnimationHelperResult): void => {
      if (!settled) {
        settled = true;
        if (poller) clearInterval(poller);
        animationChild = null;
        animationSettle = null;
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        void logAnimation(
          `run end (${seconds}s): ok=${result.ok}, frame=${result.frame?.name ?? 'none'}` +
            (result.cancelled ? ' cancelled=true' : '') +
            (result.error ? ` error=${result.error}` : ''),
          ...(stderr.trim() ? [`run end: stderr=${stderr.trim().slice(0, 2000)}`] : []),
          `run end: stdout head:\n${stdout.slice(0, 2000)}`,
        );
        resolvePromise(result);
      }
    };
    animationSettle = settle;

    sendAnimationStatus('Helper is reading the skill and studying the pose…');
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    animationChild = child;

    // Background listener: the frame file finishes the run, and the absence
    // of both file and output for too long ends a hung one.
    poller = setInterval(() => {
      void (async () => {
        if (settled) return;
        const frame = await readAnimationFrame(job);
        if (frame) {
          // The file is there, but a helper that copies the source to this
          // path before posing it would have its copy taken and its work
          // killed - and the frame that landed would be the previous frame
          // again. Wait for the pose instead of settling on the copy.
          if (isDuplicateFrame(frame.svg, sourceSvg)) {
            if (!announcedCopy) {
              announcedCopy = true;
              sendAnimationStatus('Helper saved a copy; waiting for the pose…');
              void logAnimation(
                `${animationFrameFile(job)} is still a copy of the source; waiting for the helper to pose it`,
              );
            }
            return;
          }
          if (finishing) return;
          finishing = true;
          sendAnimationStatus(`Drew ${frame.name}; importing…`);
          void logAnimation(`frame file complete: ${animationFrameFile(job)}; ending the run`);
          // Saving the frame is the helper's last action; its reply - the file
          // it saved and the grade it finished on - lands a moment later. This
          // app killed the process on sight of the file for its whole life, so
          // every `run end: stdout head:` in the log is blank, including the
          // runs that came back wrong. A frame with something still wrong with
          // it is only diagnosable if the sentence saying so survives.
          await waitForReply();
          killAnimationChild();
          settle({ ok: true, frame });
          return;
        }
        // Writes count as activity, not only output. See animationLastWrite.
        const touched = await animationLastWrite(cwd);
        if (lastWrite === 0) {
          // The app's own write of the source, made before the helper started.
          // Recording it without crediting it is what makes the next write
          // recognisable as the helper's first edit.
          lastWrite = touched;
        } else if (touched > lastWrite) {
          lastWrite = touched;
          lastActivity = Date.now();
          if (!editing) {
            editing = true;
            sendAnimationStatus('Helper is posing the frame…');
            void logAnimation('helper made its first edit; the tighter stall limit applies now');
          }
        }
        if (animationHasStalled(Date.now() - lastActivity, editing)) {
          const phase = editing
            ? 'stopped part-way through posing the frame'
            : 'never started editing the frame';
          void logAnimation(`stalled: ${phase}; killing helper`);
          killAnimationChild();
          settle({ ok: false, error: `AI helper stalled: it ${phase}.` });
        }
      })();
    }, ANIMATION_POLL_MS);

    /**
     * Gives the helper a moment to finish its sentence once the frame lands.
     *
     * Bounded hard: the frame is already on disk and the sequence must not
     * wait on a process that has nothing more to say. Resolves the instant the
     * helper exits or speaks, so the usual cost is a fraction of a second.
     */
    const waitForReply = (): Promise<void> =>
      new Promise((done) => {
        if (child.exitCode !== null || stdout.trim()) return done();
        let settledReply = false;
        const finish = (): void => {
          if (settledReply) return;
          settledReply = true;
          clearTimeout(timer);
          child.off('exit', finish);
          child.stdout.off('data', finish);
          done();
        };
        const timer = setTimeout(finish, ANIMATION_REPLY_GRACE_MS);
        child.once('exit', finish);
        child.stdout.once('data', finish);
      });

    const sawOutput = (): void => {
      lastActivity = Date.now();
      if (!announcedWork) {
        announcedWork = true;
        sendAnimationStatus('Helper is working…');
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
      sawOutput();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
      sawOutput();
    });
    child.on('error', (err) => {
      settle({ ok: false, error: `Could not run AI helper: ${err.message}` });
    });
    child.on('close', (code) => {
      void (async () => {
        if (settled) return;
        const saved = await readAnimationFrame(job);
        if (saved && !isDuplicateFrame(saved.svg, sourceSvg)) {
          settle({ ok: true, frame: saved });
          return;
        }
        if (saved) {
          // The helper finished and left the source over again. Importing it
          // would put a duplicate of the previous frame on the page, so say
          // what happened instead and let the user draw it again.
          void logAnimation(`${animationFrameFile(job)} was a copy of the source; refusing it`);
          settle({
            ok: false,
            failure: 'other',
            error: `The AI helper saved ${frameName} without posing it - the frame was a copy of the source.`,
          });
          return;
        }
        // A helper that printed the frame instead of saving it still counts:
        // the markup goes to the file the run promised, then imports.
        const printed = extractSvgMarkup(stdout);
        if (printed) {
          try {
            await writeFile(framePath, printed, 'utf-8');
            void logAnimation(`frame recovered from stdout and saved to ${animationFrameFile(job)}`);
            settle({ ok: true, frame: { name: frameName, svg: printed } });
            return;
          } catch (err) {
            void logAnimation(`could not save the printed frame: ${(err as Error).message}`);
          }
        }
        // Nothing came back. Say why, so the renderer can offer the way out
        // that fits: sign in to the tool, or read the log.
        const failure = classifyHelperFailure({ code, stderr, stdout });
        if (failure !== 'other') {
          void logAnimation(`run failed as "${failure}" for ${tool?.label ?? binary}`);
        }
        const named = tool?.label ?? binary;
        if (failure === 'auth') {
          settle({
            ok: false,
            failure,
            tool: binary,
            toolLabel: named,
            error: `${named} is not signed in.`,
          });
        } else if (failure === 'missing-tool') {
          settle({
            ok: false,
            failure,
            tool: binary,
            toolLabel: named,
            error: `${named} could not be started.`,
          });
        } else if (code === 0) {
          settle({
            ok: false,
            failure,
            error: `AI helper finished without writing ${animationFrameFile(job)}.`,
          });
        } else {
          settle({
            ok: false,
            failure,
            error: stderr.trim() || `AI helper exited with code ${code}.`,
          });
        }
      })();
    });
  });
}

/**
 * Rewrites one frame in the output folder with the markup the app holds -
 * cropped to the ink and transparent, so the file is a usable sprite however
 * the helper shaped what it saved. The name is the frame's own stem, and it
 * is checked rather than trusted: only a plain file name may be written, and
 * only inside the output folder.
 */
async function saveAnimationFrame(name: string, svg: string): Promise<void> {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) {
    throw new Error(`Refusing to write an animation frame named "${name}".`);
  }
  const cwd = animationWorkDir();
  await mkdir(join(cwd, ANIMATION_OUTPUT_DIR), { recursive: true });
  await writeFile(join(cwd, ANIMATION_OUTPUT_DIR, `${name}.svg`), svg, 'utf-8');
}

/** Removes the transient animation temp folder, best-effort. */
async function clearAnimationTemp(): Promise<void> {
  try {
    await rm(join(animationWorkDir(), dirname(ANIMATION_FORM_FILE)), {
      recursive: true,
      force: true,
    });
  } catch {
    // Cleanup is best-effort; a locked file just leaves the folder behind.
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getLaunch, (): LaunchOptions => launch);

  ipcMain.handle(
    IPC.runAnimationHelper,
    (
      _event,
      formText: string,
      job: AnimationFrameJob,
      sourceSvg: string,
    ): Promise<AnimationHelperResult> => runAnimationHelper(formText, job, sourceSvg),
  );

  ipcMain.handle(IPC.getAnimationMode, (): AnimationModeStatus => animationModeStatus());

  ipcMain.handle(
    IPC.openAiToolSignIn,
    (_event, binary: string): { ok: boolean; error?: string } => openAiToolSignIn(binary),
  );

  ipcMain.handle(
    IPC.saveAnimationFrame,
    (_event, name: string, svg: string): Promise<void> => saveAnimationFrame(name, svg),
  );

  ipcMain.handle(IPC.clearAnimationTemp, (): Promise<void> => clearAnimationTemp());

  ipcMain.on(IPC.cancelAnimationHelper, () => cancelAnimationHelper());

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
    IPC.saveText,
    async (_event, text: unknown, suggestedName: unknown, extension: unknown): Promise<SaveResult> => {
      if (!mainWindow) return { ok: false, error: 'No window available.' };
      if (typeof text !== 'string') return { ok: false, error: 'There is no text to save.' };
      // The extension only names the file and its filter, so it is held to a plain word.
      const ext = typeof extension === 'string' && /^[a-z0-9]{1,12}$/i.test(extension) ? extension.toLowerCase() : 'txt';
      const stem = typeof suggestedName === 'string' && suggestedName.trim() !== '' ? suggestedName.trim() : 'untitled';
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: ext === 'napkin' ? 'Save napkin script' : 'Save text',
        defaultPath: `${stem}.${ext}`,
        filters: [{ name: ext === 'napkin' ? 'Napkin script' : `${ext.toUpperCase()} file`, extensions: [ext] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      try {
        await writeFile(picked.filePath, text, 'utf-8');
        return { ok: true, filePath: picked.filePath };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(
    IPC.savePdf,
    async (_event, pdfContent: string, suggestedName: string): Promise<SaveResult> => {
      if (!mainWindow) return { ok: false, error: 'No window available.' };
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: 'Export PDF',
        defaultPath: `${suggestedName || 'sketch'}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      try {
        // The PDF byte string is latin1-safe; write it byte-for-byte.
        await writeFile(picked.filePath, Buffer.from(pdfContent, 'latin1'));
        return { ok: true, filePath: picked.filePath };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(IPC.importFile, async (): Promise<ImportFileResult> => {
    if (!mainWindow) return { ok: false, error: 'No window available.' };
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import file',
      filters: [
        { name: 'Importable Files', extensions: ['svg', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'SVG Vector', extensions: ['svg'] },
        { name: 'PDF Document', extensions: ['pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, cancelled: true };
    return readImportable(picked.filePaths[0]);
  });

  ipcMain.handle(
    IPC.readImportFile,
    (_event, filePath: string): Promise<ImportFileResult> => readImportable(filePath),
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
        // `slice(0, -0)` is the empty string, so a name the user typed without
        // an extension used to leave no stem at all and every page came out as
        // `_1.png`. Take the whole name when there is no extension to drop.
        const named = fileExt ? base.slice(0, -fileExt.length) : base;
        const stem = named.replace(/_\d+$/, '') || named || 'sketch';
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

  ipcMain.on(IPC.setDirty, (_event, dirty: boolean) => {
    sketchDirty = dirty === true;
  });

  ipcMain.on(IPC.setTitle, (_event, title: string) => {
    if (typeof title === 'string') mainWindow?.setTitle(title);
  });

  // ---- System clipboard -----------------------------------------------------

  // A copied selection also goes out as SVG text, so it can be pasted straight
  // into Illustrator or Inkscape; a paste reads text back the same way, which
  // is how a graphic copied in one of those gets in here.
  ipcMain.handle(IPC.writeClipboardSvg, (_event, svgContent: string): void => {
    if (typeof svgContent === 'string' && svgContent !== '') clipboard.writeText(svgContent);
  });

  ipcMain.handle(IPC.writeClipboardText, (_event, text: unknown): void => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  ipcMain.handle(IPC.readClipboardSvg, (): string | null => {
    const text = clipboard.readText();
    return typeof text === 'string' && /<svg[\s>]/i.test(text) ? text : null;
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

  // Track History's figures: the drawing window says, the settings window shows.
  ipcMain.on(IPC.reportHistoryStats, (_event, stats: unknown) => {
    const read = readHistoryStats(stats);
    if (!read) return;
    historyStats = read;
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(IPC.historyStatsChanged, read);
  });
  ipcMain.handle(IPC.getHistoryStats, (): HistoryStats | null => historyStats);
  ipcMain.handle(IPC.getAppVersion, (): Promise<string> => readAppVersion());

  ipcMain.on(IPC.toggleRearrange, () => dispatch('toggle-rearrange'));

  // ---- Menus ----------------------------------------------------------------

  ipcMain.handle(IPC.getMenuConfig, (): MenuConfig => menuConfig);

  ipcMain.handle(IPC.updateMenuConfig, (_event, update: unknown): Promise<MenuConfigResult> => updateMenuConfig(update));

  ipcMain.on(IPC.setMenuState, (_event, state: unknown) => {
    rendererMenuState = menuStateFrom(state);
    refreshMenuState();
  });

  ipcMain.on(IPC.runMainCommand, (_event, id: unknown) => {
    if (typeof id === 'string' && isMainCommand(id)) runMainCommand(id);
  });

  // The GUI checks read the menu bar back and click its rows through these.
  // An ordinary launch has no use for either, so it does not answer them.
  if (GUI_CHECK) {
    ipcMain.handle(IPC.getAppMenu, (): AppMenuItemSnapshot[] => snapshotMenu(Menu.getApplicationMenu()?.items ?? []));
    ipcMain.handle(IPC.openedLinks, (): string[] => [...checkOpenedLinks]);
    ipcMain.handle(IPC.clickAppMenuItem, (_event, id: string): boolean => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item || !item.enabled) return false;
      item.click();
      return true;
    });
  }
}

app.whenReady().then(async () => {
  currentSettings = await loadSettings();
  // Read before the menu is built: an uninstalled Animation Mode must leave
  // no trace in the UI, starting with the Edit menu.
  animationInstall = await loadAnimationInstall();
  await loadMenuConfig();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
