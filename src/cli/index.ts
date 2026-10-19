#!/usr/bin/env node
/**
 * napkin-sketch command-line interface.
 *
 * Parses the documented flags, then either prints help/version, installs or
 * removes the desktop app, runs a headless auto-sharpen pass, or launches the
 * Electron drawing GUI. A first argument that names a command - `draw`,
 * `check`, `render`, `verbs` - runs that command instead, with no window and
 * without ever reaching Electron.
 *
 * The GUI is the clone's own build, or in an npm install a second package,
 * `@isocialpractice/napkin-sketch-gui`, which `--install-gui` adds: see
 * `gui.ts` for how it is found.
 *
 *   napkin-sketch [option] [target]
 *   napkin-sketch <command> [arguments]
 *
 *   -h, --help          Show help.
 *   -v, --version       Show version, and where the desktop app is.
 *   -b, --book <file>   Open a .skbk sketch book.
 *   -n, --new [name]    New sketch named "unnamed" or [name].
 *   -f, --full-screen   Open the GUI window full screen (default: maximized).
 *       --no-sandbox    Launch without Chromium's sandbox (Linux development only).
 *   -i, --import <f>    Import a file into the opening sketch.
 *   -m, --multiple-imports <f,f,…>  Import several files in a grid.
 *       --sharpen <f>   Auto-sharpen a saved sketch, then open it.
 *       --install-gui   Install the desktop app with npm; --here for this project.
 *       --uninstall-gui Remove it; --here for this project's.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeLaunchOptions,
  LAUNCH_ENV_KEY,
  type LaunchMode,
  type LaunchOptions,
} from '../core/launch.js';
import {
  readSketchBook,
  sketchBookExists,
  withSketchBookExtension,
  writeSketchBook,
} from '../core/sketchbook.js';
import { sharpenStrokes } from '../sharpen/sharpen.js';
// Markdown Flow text is drawn as its Markdown renders, and code accented: marked's lexer and highlight.js registered.
import '../markdown/core.js';
import { DOCS_SITE_ADDRESS } from '../core/menu/links.js';
import { COMMAND_SUMMARIES, COMMANDS, guiOptionsProblem, parseArgs } from './args.js';
import { runCommand } from './draw.js';
import {
  electronFrom,
  findGui,
  GUI_DOWNLOAD,
  GUI_PACKAGE,
  guiNpmArgs,
  guiStatusLine,
  guiVersionNote,
  missingElectronText,
  type GuiLocation,
} from './gui.js';

// An ES module: its own folder, dist/cli at run time, read from its URL.
const HERE = dirname(fileURLToPath(import.meta.url));

/** Reads the package version from package.json (one dir above dist/cli or src/cli). */
function readVersion(): string {
  for (const candidate of [
    join(HERE, '..', '..', 'package.json'),
    join(HERE, '..', '..', '..', 'package.json'),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

const HELP_TEXT = `
napkin-sketch — quick pen-and-napkin style sketching with auto-sharpen.

Usage:
  napkin-sketch [option] [target]
  napkin-sketch <command> [arguments]

Commands (no window, and no Electron needed):
${COMMANDS.map((command) => `  ${COMMAND_SUMMARIES[command].usage.padEnd(22)}${COMMAND_SUMMARIES[command].summary}`).join('\n')}
  Run "napkin-sketch <command> --help" for a command's options.

Options:
  -h, --help            Show this help and exit.
  -v, --version         Show the installed version, and where the desktop app
                        is, and exit.
  -b, --book <file>     Open a saved sketch book (.skbk) to view or edit.
  -n, --new [name]      Start a new sketch named "unnamed" or [name].
  -f, --full-screen     Open the GUI window full screen, which hides the window
                        controls. Without it the window opens maximized, so the
                        minimize, restore-down, and close buttons stay in view.
      --no-sandbox      Launch Electron without Chromium's sandbox. For
                        development on a Linux system that blocks the sandbox
                        (the "SUID sandbox helper" error); never for a release.
  -i, --import <file>   Import an SVG, PDF, PNG, JPEG, GIF or WebP file into the
                        opening sketch.
  -m, --multiple-imports <file,file,…>
                        Import several files at once, laid out in a grid: files
                        fill a row left to right and wrap to a new row when the
                        next one would overrun the page width. Comma-separated;
                        quote names that contain spaces.
      --sharpen <file>  Auto-sharpen every stroke in a saved .skbk, then open it.
      --install-gui     Install the desktop app with npm, at this version:
                        ${GUI_PACKAGE} and Electron,
                        ${GUI_DOWNLOAD}. Globally, or with --here into the
                        current project.
      --uninstall-gui   Remove the desktop app, globally or with --here.

Targets:
  <file>   Path to a .skbk sketch book (extension optional).
  [name]   Name for a new sketch file.

Examples:
  napkin-sketch --install-gui         Add the desktop app (${GUI_DOWNLOAD}).
  napkin-sketch                       Open a new, blank sketch.
  napkin-sketch --new ideas           New sketch named "ideas".
  napkin-sketch --book ./notes.skbk   Open an existing sketch book.
  napkin-sketch --sharpen ./notes     Sharpen ./notes.skbk and open it.
  napkin-sketch --new -f              New sketch opened full screen (no controls).
  napkin-sketch --import logo.svg     New sketch with logo.svg imported.
  napkin-sketch -m a.svg,b.png,"two words.svg"
                                      New sketch with three files in a grid.
  napkin-sketch draw card.napkin --to svg,png
                                      Draw a script to card.svg and card.png.
  napkin-sketch draw - --json < card.napkin
                                      Draw from standard input; report in JSON.
  napkin-sketch draw --prompt "a three-box flowchart with arrows" --to svg
                                      Have an AI tool write the script, then
                                      draw it; the script is kept beside.
`;

/** File extensions the import pipeline understands. */
const IMPORTABLE_EXTENSIONS = new Set(['.svg', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * Resolves import paths to absolute paths, exiting with a clear error when a
 * file is missing or of an unsupported type.
 */
function resolveImportFiles(files: string[]): string[] {
  const resolved: string[] = [];
  for (const file of files) {
    const path = resolve(file);
    if (!existsSync(path)) {
      console.error(`napkin-sketch: import file not found: ${path}`);
      process.exit(1);
    }
    const ext = extname(path).toLowerCase();
    if (!IMPORTABLE_EXTENSIONS.has(ext)) {
      console.error(
        `napkin-sketch: cannot import "${file}" — supported types are SVG, PDF, PNG, JPEG, GIF, and WebP.`,
      );
      process.exit(1);
    }
    resolved.push(path);
  }
  return resolved;
}

/**
 * What to do about an Electron binary that is not there, one line each: the
 * reinstall, the download on its own, and where the install errors are
 * written up. macOS adds the cause seen most there - its malware scanner
 * moving `Electron.app` to the Trash - and the one thing not to do about it.
 */
function electronReinstallHint(): string {
  const lines = [
    'Reinstall Electron from the repository root:',
    '  rm -rf node_modules/electron && npm install',
    'or rerun only its download:',
    '  node node_modules/electron/install.js',
  ];
  if (process.platform === 'darwin') {
    lines.push(
      'On macOS, XProtect may have moved Electron.app to the Trash. Do not restore it from there;',
      'reinstall as above.',
    );
  }
  lines.push(`See "Troubleshooting install errors": ${DOCS_SITE_ADDRESS}install.html#troubleshooting-install-errors`);
  return lines.join('\n');
}

/** Prints why the GUI cannot start for want of its Electron binary, and exits. */
function exitForMissingElectron(detail: string): never {
  console.error(`napkin-sketch: ${detail}`);
  console.error(electronReinstallHint());
  process.exit(1);
}

/** The desktop app and the Electron binary that starts it. */
interface ReadyGui {
  readonly gui: GuiLocation;
  readonly electron: string;
}

/** Says why the app found cannot start for want of Electron, and exits: the clone's reinstall hint, or the install command again. */
function exitForGuiElectron(gui: GuiLocation, why: string): never {
  if (gui.where === 'clone') exitForMissingElectron(why);
  console.error(`napkin-sketch: ${why}`);
  process.exit(1);
}

/**
 * The desktop app this command starts, with its Electron binary, or an exit
 * that says why there is none: not installed, or its Electron not there. Run
 * before anything is written, so `--sharpen` never changes a book that no app
 * can then open. An app at another version than this command is a warning.
 */
function readyGui(): ReadyGui {
  const gui = findGui(HERE, process.cwd());
  if (!gui) {
    console.error(`napkin-sketch: the desktop app is not installed. Run: napkin-sketch --install-gui (adds Electron, ${GUI_DOWNLOAD}).`);
    console.error('The drawing commands need no app: "napkin-sketch --help" lists them.');
    process.exit(1);
  }
  // Electron's package downloads a binary that is missing, printing as it
  // goes, so an app whose download was cut short heals as it starts.
  const lookup = electronFrom(gui.folder);
  if (!('binary' in lookup)) exitForGuiElectron(gui, missingElectronText(gui, lookup) ?? 'could not locate the Electron binary.');
  const note = guiVersionNote(gui, readVersion());
  if (note) console.error(`napkin-sketch: ${note}`);
  return { gui, electron: lookup.binary };
}

/**
 * Installs the desktop app's package with npm at this command's own version,
 * or removes it: globally, or with `here` in the working folder's project.
 * npm prints Electron's download as it goes. Answers npm's exit code.
 */
function runGuiInstall(here: boolean, uninstall: boolean): number {
  const version = readVersion();
  const npmArgs = guiNpmArgs({ version, here, uninstall });
  const where = here ? ' in this project' : '';
  if (!uninstall && findGui(HERE, process.cwd())?.where === 'clone') {
    console.log('napkin-sketch: this command runs from a clone, which starts the app built in it; the app installed now is for the command installed from npm.');
  }
  console.log(
    uninstall
      ? `napkin-sketch: removing the desktop app${where}: npm ${npmArgs.join(' ')}`
      : `napkin-sketch: installing the desktop app${where}, ${GUI_PACKAGE}@${version} and Electron, ${GUI_DOWNLOAD}: npm ${npmArgs.join(' ')}`,
  );
  // npm is a .cmd on Windows, which only a shell runs. The words are this
  // command's own and a version from its package.json, so the line needs no
  // quoting, and it is given as one line rather than as arguments to a shell.
  const result =
    process.platform === 'win32'
      ? spawnSync(`npm ${npmArgs.join(' ')}`, { stdio: 'inherit', shell: true })
      : spawnSync('npm', npmArgs, { stdio: 'inherit' });
  if (result.error) {
    console.error(`napkin-sketch: could not run npm: ${result.error.message}`);
    return 1;
  }
  if (result.status === 0 && !uninstall) {
    console.log('napkin-sketch: the desktop app is installed; run napkin-sketch to open it.');
    if (process.platform === 'linux') {
      console.log(`If it stops with a sandbox error, see ${DOCS_SITE_ADDRESS}install.html#linux-the-suid-sandbox-helper-binary-was-found-but-is-not-configured-correctly`);
    }
  }
  return result.status ?? 1;
}

/** Spawns the desktop app with the given launch options. */
function launchGui(ready: ReadyGui, options: LaunchOptions, noSandbox = false): void {
  const { gui, electron } = ready;

  // Some editor and agent terminals export ELECTRON_RUN_AS_NODE. Inherited, it
  // makes the child run main.js as plain Node, where `require('electron')`
  // answers with nothing and startup dies on `setAppUserModelId`. The GUI is
  // never meant to run that way, so the variable is dropped rather than passed.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [LAUNCH_ENV_KEY]: encodeLaunchOptions(options),
  };
  delete env.ELECTRON_RUN_AS_NODE;

  // --no-sandbox is passed only when asked for: the sandbox stays on by
  // default everywhere, and the flag is a development escape hatch for Linux
  // systems that block it.
  const child = spawn(electron, noSandbox ? [gui.entry, '--no-sandbox'] : [gui.entry], {
    stdio: 'inherit',
    env,
    windowsHide: false,
  });

  child.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      exitForGuiElectron(gui, missingElectronText(gui, { problem: 'missing', path: electron }) ?? `the Electron binary is missing: ${electron}`);
    }
    console.error(`napkin-sketch: failed to launch GUI — ${err.message}`);
    process.exit(1);
  });
  child.on('close', (code) => process.exit(code ?? 0));
}

/** Runs a headless auto-sharpen pass over a sketch book and saves it in place. */
async function runSharpen(target: string): Promise<void> {
  const path = withSketchBookExtension(target);
  if (!sketchBookExists(path)) {
    console.error(`napkin-sketch: sketch book not found: ${path}`);
    process.exit(1);
  }
  const book = await readSketchBook(path);
  let changed = 0;
  for (const sketch of book.sketches) {
    const before = sketch.strokes.filter((s) => !s.sharpened).length;
    sketch.strokes = sharpenStrokes(sketch.strokes);
    sketch.updatedAt = new Date().toISOString();
    changed += before;
  }
  const saved = await writeSketchBook(path, book);
  console.log(`napkin-sketch: sharpened ${changed} stroke(s) across ${book.sketches.length} page(s).`);
  console.log(`napkin-sketch: saved ${saved}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // The drawing commands run before anything can reach Electron, so they work
  // on an install where the GUI cannot start.
  if (args.command) {
    process.exitCode = await runCommand({
      argv: process.argv.slice(2),
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      cwd: process.cwd(),
      version: readVersion(),
      env: process.env,
      // This file is dist/cli/index.js, so the built package is the folder above.
      dist: join(HERE, '..'),
    });
    return;
  }

  if (args.unknown.length > 0) {
    console.error(`napkin-sketch: unknown option(s): ${args.unknown.join(', ')}`);
    console.error('Run "napkin-sketch --help" for usage.');
    process.exit(1);
  }

  if (args.help) {
    console.log(HELP_TEXT.trimStart());
    return;
  }

  const guiProblem = guiOptionsProblem(args);
  if (guiProblem) {
    console.error(`napkin-sketch: ${guiProblem}.`);
    console.error('Run "napkin-sketch --help" for usage.');
    process.exit(1);
  }

  if (args.version) {
    const version = readVersion();
    const gui = findGui(HERE, process.cwd());
    console.log(`napkin-sketch v${version}`);
    console.log(guiStatusLine(gui));
    const note = gui ? guiVersionNote(gui, version) : null;
    if (note) console.error(`napkin-sketch: ${note}`);
    return;
  }

  if (args.installGui || args.uninstallGui) {
    process.exitCode = runGuiInstall(args.here, args.uninstallGui);
    return;
  }

  const mode: LaunchMode = args.mode ?? 'new';

  if (mode === 'book' && !args.target) {
    console.error('napkin-sketch: --book requires a file path.');
    process.exit(1);
  }
  if (mode === 'sharpen' && !args.target) {
    console.error('napkin-sketch: --sharpen requires a file path.');
    process.exit(1);
  }

  if (args.importRequested && !args.importFile) {
    console.error('napkin-sketch: --import requires a file path.');
    process.exit(1);
  }
  if (args.multipleImportsRequested && args.multipleImports.length === 0) {
    console.error('napkin-sketch: --multiple-imports requires a comma-separated list of files.');
    process.exit(1);
  }

  // Validate import lists up front so a typo fails fast instead of after the
  // GUI window has opened.
  const single = args.importFile ? resolveImportFiles([args.importFile]) : [];
  const multiple = args.multipleImports.length > 0 ? resolveImportFiles(args.multipleImports) : [];
  const importFiles = multiple.length > 0 ? multiple : single;

  const ready = readyGui();

  if (mode === 'sharpen' && args.target) {
    // Sharpen on disk first so the GUI opens the already-improved drawing.
    await runSharpen(args.target);
  }

  const options: LaunchOptions =
    mode === 'new'
      ? { mode: 'new', sketchName: args.target ?? 'unnamed', fullScreen: args.fullScreen }
      : { mode: 'book', filePath: resolve(withSketchBookExtension(args.target!)), fullScreen: args.fullScreen };

  if (importFiles.length > 0) {
    options.importFiles = importFiles;
    options.importGrid = multiple.length > 0;
  }

  launchGui(ready, options, args.noSandbox);
}

/**
 * True when this module is the program Node was started with, not one that
 * another module imported, which keeps exports like parseArgs importable
 * without spawning a process. Compared as real paths: an npm `bin` link, a
 * Windows `.cmd` shim and an `npm link` junction all start Node on a path
 * that leads here by another name.
 */
function isProgram(): boolean {
  const started = process.argv[1];
  if (!started) return false;
  try {
    return realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProgram()) {
  main().catch((err: unknown) => {
    console.error(`napkin-sketch: ${(err as Error).message}`);
    process.exit(1);
  });
}
