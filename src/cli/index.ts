/**
 * napkin-sketch command-line interface.
 *
 * Parses the documented flags, then either prints help/version, runs a headless
 * auto-sharpen pass, or launches the Electron drawing GUI.
 *
 *   napkin-sketch [option] [target]
 *
 *   -h, --help          Show help.
 *   -v, --version       Show version.
 *   -b, --book <file>   Open a .skbk sketch book.
 *   -n, --new [name]    New sketch named "unnamed" or [name].
 *   -f, --full-screen   Open the GUI window in full-screen mode.
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
import { parseArgs } from './args.js';

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

Options:
  -h, --help            Show this help and exit.
  -v, --version         Show the installed version and exit.
  -b, --book <file>     Open a saved sketch book (.skbk) to view or edit.
  -n, --new [name]      Start a new sketch named "unnamed" or [name].
  -f, --full-screen     Open the GUI window in full-screen mode.
  -i, --import <file>   Import an SVG, PDF, PNG, or JPEG into the opening sketch.
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
  napkin-sketch --new -f              New sketch opened full screen.
  napkin-sketch --import logo.svg     New sketch with logo.svg imported.
  napkin-sketch -m a.svg,b.png,"two words.svg"
                                      New sketch with three files in a grid.
`;

/** File extensions the import pipeline understands. */
const IMPORTABLE_EXTENSIONS = new Set(['.svg', '.pdf', '.png', '.jpg', '.jpeg']);

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
        `napkin-sketch: cannot import "${file}" — supported types are SVG, PDF, PNG, and JPEG.`,
      );
      process.exit(1);
    }
    resolved.push(path);
  }
  return resolved;
}

/** Resolves the Electron executable path from the installed `electron` package. */
function resolveElectronBinary(): string {
  // The `electron` package's main export is the path to the binary.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as unknown;
  if (typeof electronPath !== 'string') {
    throw new Error('Could not locate the Electron binary. Run "npm install" first.');
  }
  return electronPath;
}

/** Spawns the Electron GUI with the given launch options. */
function launchGui(options: LaunchOptions): void {
  const electron = resolveElectronBinary();
  const mainEntry = resolve(HERE, '..', 'main', 'main.js');

  const child = spawn(electron, [mainEntry], {
    stdio: 'inherit',
    env: { ...process.env, [LAUNCH_ENV_KEY]: encodeLaunchOptions(options) },
    windowsHide: false,
  });

  child.on('error', (err) => {
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

  launchGui(options);
}

// Only run as a CLI when invoked directly (keeps exports like parseArgs
// importable from tests without spawning a process).
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`napkin-sketch: ${(err as Error).message}`);
    process.exit(1);
  });
}
