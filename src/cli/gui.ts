/**
 * The desktop app, as the command line finds it, installs it and reports it.
 *
 * The npm package is the command line and the API, with no Electron in it.
 * The app is a second package, `@isocialpractice/napkin-sketch-gui`, which
 * `napkin-sketch --install-gui` installs beside it and which brings Electron
 * as its one dependency. A clone holds both in one tree. So the command line
 * looks for the app in that order: the clone it runs from, then the
 * companion package, found the way Node finds any package - from the command
 * line's own folder, which reaches the global folder a global install shares
 * with it, and from the working folder, which reaches a project's.
 *
 * Finding the app never touches Electron: its package downloads a missing
 * binary the moment it is required, which only starting the app may do.
 * Nothing here reaches the network unless {@link electronFrom} is called, so
 * every function is tested against folders laid out by hand.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/** The desktop app's npm package. */
export const GUI_PACKAGE = '@isocialpractice/napkin-sketch-gui';

/** What installing the app downloads, said before the download starts. */
export const GUI_DOWNLOAD = 'about 100 MB';

/** Why there is no Electron to start: its package does not load, names no binary, or names one that is gone. */
export type ElectronProblem = 'unresolved' | 'no-path' | 'missing';

/** The Electron binary a folder reaches, or why there is none. */
export type ElectronLookup = { readonly binary: string } | { readonly problem: ElectronProblem; readonly path?: string };

/** The desktop app, where the command line found it. */
export interface GuiLocation {
  /** A clone, with the app built beside the command line; or the companion package. */
  readonly where: 'clone' | 'package';
  /** The clone's root, or the package's folder: where Electron's package is found from. */
  readonly folder: string;
  /**
   * What Electron is started on. In the package, its `dist/main/` folder,
   * whose own package.json names the app: Electron takes a name only from a
   * folder it is started on, and the name is the folder the app keeps its
   * settings in. In a clone, the main script itself, as it always was.
   */
  readonly entry: string;
  /** The package's version; null in a clone, whose version is the command line's own. */
  readonly version: string | null;
}

/**
 * The Electron binary the `electron` package reachable from `dir` names, or
 * why there is none. This runs Electron's package, which downloads a binary
 * that is missing, printing as it goes, and throws when it cannot: call it
 * only to start the app.
 */
export function electronFrom(dir: string): ElectronLookup {
  let named: unknown;
  try {
    named = createRequire(join(dir, 'index.js'))('electron');
  } catch {
    return { problem: 'unresolved' };
  }
  if (typeof named !== 'string') return { problem: 'no-path' };
  // The record can outlive the binary: a scanner that quarantines it, or a
  // sync tool that offloads it, leaves path.txt naming a file that is gone.
  if (!existsSync(named)) return { problem: 'missing', path: named };
  return { binary: named };
}

/** The version a package.json gives, or null. */
function versionOf(file: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * The desktop app the command line in `cliDir` can start, or null: the clone
 * around it, else the companion package as Node finds it from `cliDir`, else
 * as Node finds it from `cwd`.
 */
export function findGui(cliDir: string, cwd: string): GuiLocation | null {
  const cloneMain = resolve(cliDir, '..', 'main', 'main.js');
  if (existsSync(cloneMain)) return { where: 'clone', folder: resolve(cliDir, '..', '..'), entry: cloneMain, version: null };
  for (const base of [cliDir, cwd]) {
    let manifest: string;
    try {
      manifest = createRequire(join(base, 'index.js')).resolve(`${GUI_PACKAGE}/package.json`);
    } catch {
      continue;
    }
    const folder = dirname(manifest);
    const mainDir = join(folder, 'dist', 'main');
    if (!existsSync(join(mainDir, 'main.js'))) continue;
    const entry = existsSync(join(mainDir, 'package.json')) ? mainDir : join(mainDir, 'main.js');
    return { where: 'package', folder, entry, version: versionOf(manifest) };
  }
  return null;
}

/** The line `--version` adds: where the desktop app is, or how to add it. */
export function guiStatusLine(gui: GuiLocation | null): string {
  if (!gui) return `desktop app: not installed; napkin-sketch --install-gui adds it (${GUI_DOWNLOAD})`;
  if (gui.where === 'clone') return `desktop app: built in this clone, ${gui.folder}`;
  return `desktop app: ${gui.version ?? 'version unknown'} at ${gui.folder}`;
}

/** A warning when the app beside the command line is another version than it, else null. */
export function guiVersionNote(gui: GuiLocation, cliVersion: string): string | null {
  if (gui.where !== 'package' || gui.version === null || gui.version === cliVersion) return null;
  return `the desktop app is ${gui.version} and this command line ${cliVersion}; napkin-sketch --install-gui installs ${cliVersion}`;
}

/** Why the app found cannot start for want of Electron, in one sentence; null when its binary is there. */
export function missingElectronText(gui: GuiLocation, lookup: ElectronLookup): string | null {
  if ('binary' in lookup) return null;
  if (gui.where === 'package') {
    return `Electron's download did not finish${lookup.path ? ` (${lookup.path} is not there)` : ''}: run napkin-sketch --install-gui again.`;
  }
  if (lookup.problem === 'unresolved') return 'could not locate the Electron binary; its download did not finish.';
  if (lookup.problem === 'no-path') return 'could not locate the Electron binary. Run "npm install" first.';
  return `the Electron binary is missing: ${lookup.path}`;
}

/** npm's arguments for installing the app at `version`, or removing it: globally, or into the working folder's project with `here`. */
export function guiNpmArgs(options: { readonly version: string; readonly here: boolean; readonly uninstall: boolean }): string[] {
  const scope = options.here ? [] : ['--global'];
  return options.uninstall
    ? ['uninstall', ...scope, GUI_PACKAGE]
    : ['install', ...scope, `${GUI_PACKAGE}@${options.version}`, '--foreground-scripts'];
}
