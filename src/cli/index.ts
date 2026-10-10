/**
 * napkin-sketch command-line interface.
 *
 * Parses the documented flags, then either prints help/version, runs a headless
 * auto-sharpen pass, or launches the Electron drawing GUI. A first argument that
 * names a command - `draw`, `check`, `render`, `verbs` - runs that command
 * instead, with no window and without ever reaching Electron.
 *
 *   napkin-sketch [option] [target]
 *   napkin-sketch <command> [arguments]
 *
 *   -h, --help          Show help.
 *   -v, --version       Show version.
 *   -b, --book <file>   Open a .skbk sketch book.
 *   -n, --new [name]    New sketch named "unnamed" or [name].
 *   -f, --full-screen   Open the GUI window full screen (default: maximized).
 *       --no-sandbox    Launch without Chromium's sandbox (Linux development only).
 *   -i, --import <f>    Import a file into the opening sketch.
 *   -m, --multiple-imports <f,f,…>  Import several files in a grid.
 *       --sharpen <f>   Auto-sharpen a saved sketch, then open it.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, join } from 'node:path';
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
import { COMMAND_SUMMARIES, COMMANDS, parseArgs } from './args.js';
import { runCommand } from './draw.js';

// Bundled as CommonJS; __dirname points at dist/cli at runtime.
const HERE = __dirname;

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
  -v, --version         Show the installed version and exit.
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

Targets:
  <file>   Path to a .skbk sketch book (extension optional).
  [name]   Name for a new sketch file.

Examples:
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

/** Resolves the Electron executable path from the installed `electron` package. */
function resolveElectronBinary(): string {
  // The `electron` package's main export is the path to the binary. It throws
  // when the package's own record of that path (path.txt) is missing, which
  // is what an interrupted or skipped download leaves behind.
  let electronPath: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    electronPath = require('electron') as unknown;
  } catch {
    exitForMissingElectron('could not locate the Electron binary; its download did not finish.');
  }
  if (typeof electronPath !== 'string') {
    exitForMissingElectron('could not locate the Electron binary. Run "npm install" first.');
  }
  // The record can outlive the binary: a scanner that quarantines it, or a
  // sync tool that offloads it, leaves path.txt naming a file that is gone.
  if (!existsSync(electronPath)) {
    exitForMissingElectron(`the Electron binary is missing: ${electronPath}`);
  }
  return electronPath;
}

/** Spawns the Electron GUI with the given launch options. */
function launchGui(options: LaunchOptions, noSandbox = false): void {
  const electron = resolveElectronBinary();
  const mainEntry = resolve(HERE, '..', 'main', 'main.js');

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
  const child = spawn(electron, noSandbox ? [mainEntry, '--no-sandbox'] : [mainEntry], {
    stdio: 'inherit',
    env,
    windowsHide: false,
  });

  child.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      exitForMissingElectron(`the Electron binary is missing: ${electron}`);
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

  if (args.version) {
    console.log(`napkin-sketch v${readVersion()}`);
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

  launchGui(options, args.noSandbox);
}

// Only run as a CLI when invoked directly (keeps exports like parseArgs
// importable from tests without spawning a process).
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`napkin-sketch: ${(err as Error).message}`);
    process.exit(1);
  });
}
