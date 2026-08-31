/**
 * Electron main process for napkin-sketch.
 *
 * Creates the drawing window, wires up IPC handlers for sketch-book file I/O,
 * and reads the launch options the CLI passes via the environment.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import {
  ANIMATION_FORM_FILE,
  ANIMATION_OUTPUT_DIR,
  ANIMATION_SOURCE_FILE,
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
} from '../core/animation-install.js';
import { classifyHelperFailure, helperBinary, helperToolFor } from '../core/ai-tool.js';
import { decodeLaunchOptions, LAUNCH_ENV_KEY, type LaunchOptions } from '../core/launch.js';
import { IPC, type AnimationFrameOutput, type AnimationHelperResult, type ExportFormat, type ImageFormat, type ImportFileResult, type MenuAction, type OpenResult, type SaveImagesResult, type SaveResult } from '../core/ipc.js';
import { importPdf } from '../core/pdf-import.js';
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
        { label: 'Import…', accelerator: 'CmdOrCtrl+I', click: () => dispatch('import') },
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
            { label: 'PDF Document…', click: () => dispatch('export-pdf') },
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
        // The clipboard items show their shortcut but do not claim it:
        // `registerAccelerator: false` leaves the keypress to the page, where
        // the renderer ignores it while a text field has focus. Claiming it
        // here would take Ctrl+C away from the layer-rename box and the
        // property fields, which is the one place these keys must not mean
        // "copy the drawing".
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', registerAccelerator: false, click: () => dispatch('cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', registerAccelerator: false, click: () => dispatch('copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', registerAccelerator: false, click: () => dispatch('paste') },
        {
          label: 'Paste in Place',
          accelerator: 'CmdOrCtrl+Shift+V',
          registerAccelerator: false,
          click: () => dispatch('paste-in-place'),
        },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', registerAccelerator: false, click: () => dispatch('duplicate') },
        { type: 'separator' },
        { label: 'Delete', accelerator: 'Delete', registerAccelerator: false, click: () => dispatch('delete-selection') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', registerAccelerator: false, click: () => dispatch('select-all') },
        { type: 'separator' },
        { label: 'Verbose Settings…', accelerator: 'CmdOrCtrl+Alt+,', click: () => openSettingsWindow() },
        { label: 'Rearrange Toolbar', click: () => dispatch('toggle-rearrange') },
        // Animation Mode is an optional install (npm run animation-mode --
        // --install): with no install record there is no menu entry, no
        // shortcut, and nothing in the app that wants an AI tool.
        ...(animationInstall
          ? [
              { type: 'separator' } as const,
              {
                label: 'Animation Mode',
                accelerator: 'CmdOrCtrl+Shift+N',
                click: () => dispatch('toggle-animation'),
              } as const,
            ]
          : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Pages Panel', accelerator: 'CmdOrCtrl+B', click: () => dispatch('toggle-pages') },
        { label: 'Toggle Layers Panel', accelerator: 'CmdOrCtrl+L', click: () => dispatch('toggle-layers') },
        { label: 'Toggle Properties Panel', accelerator: 'CmdOrCtrl+P', click: () => dispatch('toggle-properties') },
        { label: 'Quick Settings', accelerator: 'CmdOrCtrl+,', click: () => dispatch('toggle-settings') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        // Replaces the stock "Actual Size" zoom reset: Ctrl+0 now fits every
        // graphic on the canvas into view instead of resetting page zoom.
        { label: 'Fit All in View', accelerator: 'CmdOrCtrl+0', click: () => dispatch('fit-view') },
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
  // The default window opens maximized, which is not the same as full screen:
  // a maximized window keeps the minimize / restore-down / close controls in
  // view, while full screen (-f, --full-screen) hides them. The width/height
  // below stay the restore-down size the maximized window returns to.
  const openFullScreen = launch.fullScreen === true;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
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
    if (!openFullScreen) mainWindow?.maximize();
    mainWindow?.show();
  });
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

/** Reads an importable SVG/PDF/PNG/JPEG file from a known path. */
async function readImportable(filePath: string): Promise<ImportFileResult> {
  const name = basename(filePath, extname(filePath));
  const ext = extname(filePath).toLowerCase();
  try {
    if (ext === '.svg') {
      const text = await readFile(filePath, 'utf-8');
      return { ok: true, kind: 'svg', name, text };
    }
    if (ext === '.pdf') {
      const pages = importPdf(await readFile(filePath));
      return { ok: true, kind: 'pdf', name, pages };
    }
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
      return { ok: false, error: `Unsupported import type: ${ext || filePath}` };
    }
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const bytes = await readFile(filePath);
    return { ok: true, kind: 'raster', name, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
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
  return { installed: animationInstall !== null, tool: animationInstall?.tool ?? null };
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
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '"napkin-sketch sign-in"', 'cmd', '/k', binary], {
        detached: true,
        stdio: 'ignore',
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

/**
 * There is no overall time limit on a frame run, but a run that shows no
 * signs of life - no frame file, no output - for this long is treated as
 * hung and killed. One frame is a bounded task, yet an agentic CLI can read
 * instructions and study the pose for minutes before it prints anything, so
 * the window is generous; Cancel ends a run immediately either way.
 */
const ANIMATION_STALL_LIMIT_MS = 5 * 60 * 1000;

/** How often the background listener looks for the finished frame file. */
const ANIMATION_POLL_MS = 1000;

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
    let announcedWork = false;
    let announcedCopy = false;
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

    sendAnimationStatus('Starting the AI helper…');
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
          sendAnimationStatus(`Drew ${frame.name}; importing…`);
          void logAnimation(`frame file complete: ${animationFrameFile(job)}; ending the run`);
          killAnimationChild();
          settle({ ok: true, frame });
          return;
        }
        if (Date.now() - lastActivity > ANIMATION_STALL_LIMIT_MS) {
          void logAnimation('stalled: no frame file and no output for 5 minutes; killing helper');
          killAnimationChild();
          settle({ ok: false, error: 'AI helper stalled (no frame and no output for 5 minutes).' });
        }
      })();
    }, ANIMATION_POLL_MS);

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
        { name: 'Importable Files', extensions: ['svg', 'pdf', 'png', 'jpg', 'jpeg'] },
        { name: 'SVG Vector', extensions: ['svg'] },
        { name: 'PDF Document', extensions: ['pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
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

  // ---- System clipboard -----------------------------------------------------

  // A copied selection also goes out as SVG text, so it can be pasted straight
  // into Illustrator or Inkscape; a paste reads text back the same way, which
  // is how a graphic copied in one of those gets in here.
  ipcMain.handle(IPC.writeClipboardSvg, (_event, svgContent: string): void => {
    if (typeof svgContent === 'string' && svgContent !== '') clipboard.writeText(svgContent);
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

  ipcMain.on(IPC.toggleRearrange, () => dispatch('toggle-rearrange'));
}

app.whenReady().then(async () => {
  currentSettings = await loadSettings();
  // Read before the menu is built: an uninstalled Animation Mode must leave
  // no trace in the UI, starting with the Edit menu.
  animationInstall = await loadAnimationInstall();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
