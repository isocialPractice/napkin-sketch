/**
 * Where the command line finds the desktop app - the clone it runs from, the
 * companion package beside it or in the working folder's project, or
 * nowhere - what it starts Electron on, how it finds Electron, and what it
 * says about each. Every layout is made by hand in a temporary folder, with a
 * fake `electron` package whose main export is a path, as the real one's is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  electronFrom,
  findGui,
  GUI_PACKAGE,
  guiNpmArgs,
  guiStatusLine,
  guiVersionNote,
  missingElectronText,
  type GuiLocation,
} from '../src/cli/gui.js';
import { CLI, cliSkipReason } from './helpers/built-cli.js';
import { repoRoot } from './helpers/repo-root.js';

/** Writes `text` to `path`, making its folders. */
function put(path: string, text = ''): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A fake `electron` package in `nodeModules`, whose `index.js` is `body`. */
function fakeElectron(nodeModules: string, body: string): void {
  put(join(nodeModules, 'electron', 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }));
  put(join(nodeModules, 'electron', 'index.js'), body);
}

/** A fake `electron` package in `nodeModules` naming a binary that is there; answers the binary. */
function workingElectron(nodeModules: string): string {
  const binary = join(nodeModules, 'electron', 'dist', 'electron.exe');
  put(binary, 'not really a binary');
  fakeElectron(nodeModules, `module.exports = ${JSON.stringify(binary)};`);
  return binary;
}

/** The app's package in `nodeModules` at `version`; `named` adds the file that names the app. Answers its folder. */
function guiPackage(nodeModules: string, version: string, named = true): string {
  const folder = join(nodeModules, ...GUI_PACKAGE.split('/'));
  put(join(folder, 'package.json'), JSON.stringify({ name: GUI_PACKAGE, version, main: 'dist/main/main.js' }));
  put(join(folder, 'dist', 'main', 'main.js'));
  if (named) put(join(folder, 'dist', 'main', 'package.json'), JSON.stringify({ name: 'napkin-sketch', version, main: 'main.js' }));
  return folder;
}

/** The API's package in `nodeModules`, its command line's folder answered. */
function cliPackage(nodeModules: string): string {
  const cliDir = join(nodeModules, '@isocialpractice', 'napkin-sketch', 'dist', 'cli');
  put(join(cliDir, 'index.js'));
  return cliDir;
}

/** Runs `body` in a new temporary folder, named by its real path, then removes it. */
function inTemp(body: (dir: string) => void): void {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'napkin-gui-')));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a clone starts the main script built beside its command line, before any app package', () => {
  inTemp((dir) => {
    const cliDir = join(dir, 'dist', 'cli');
    put(join(cliDir, 'index.js'));
    put(join(dir, 'dist', 'main', 'main.js'));
    guiPackage(join(dir, 'node_modules'), '9.9.9');
    const binary = workingElectron(join(dir, 'node_modules'));
    const gui = findGui(cliDir, dir);
    assert.deepEqual(gui, { where: 'clone', folder: dir, entry: join(dir, 'dist', 'main', 'main.js'), version: null });
    assert.deepEqual(electronFrom(gui!.folder), { binary }, "the clone's own Electron");
    assert.equal(guiStatusLine(gui), `desktop app: built in this clone, ${dir}`);
    assert.equal(guiVersionNote(gui!, '1.0.0'), null, 'a clone is the version of its own command line');
  });
});

test('a global install finds the app beside it, and starts Electron on the folder that names the app', () => {
  inTemp((dir) => {
    const global = join(dir, 'lib', 'node_modules');
    const cliDir = cliPackage(global);
    const folder = guiPackage(global, '1.2.3');
    // A global package's dependencies are nested under it.
    const binary = workingElectron(join(folder, 'node_modules'));
    const gui = findGui(cliDir, join(dir, 'somewhere-else'));
    assert.deepEqual(gui, { where: 'package', folder, entry: join(folder, 'dist', 'main'), version: '1.2.3' });
    assert.deepEqual(electronFrom(gui!.folder), { binary });
    assert.equal(guiStatusLine(gui), `desktop app: 1.2.3 at ${folder}`);
    assert.equal(guiVersionNote(gui!, '1.2.3'), null);
    assert.equal(
      guiVersionNote(gui!, '1.2.4'),
      'the desktop app is 1.2.3 and this command line 1.2.4; napkin-sketch --install-gui installs 1.2.4',
      'another version is a warning that says how to match it',
    );
  });
});

test("a project's app is found from the working folder, with Electron hoisted beside it", () => {
  inTemp((dir) => {
    const cliDir = cliPackage(join(dir, 'global', 'node_modules'));
    const project = join(dir, 'project');
    const folder = guiPackage(join(project, 'node_modules'), '1.2.3');
    const binary = workingElectron(join(project, 'node_modules'));
    const gui = findGui(cliDir, join(project, 'src'));
    assert.equal(gui?.where, 'package');
    assert.equal(gui?.folder, folder);
    assert.deepEqual(electronFrom(gui!.folder), { binary });
  });
});

test('an app package without the file that names it starts on its main script; one without its main script is no app', () => {
  inTemp((dir) => {
    const nodeModules = join(dir, 'node_modules');
    const cliDir = cliPackage(nodeModules);
    const folder = guiPackage(nodeModules, '1.0.0', false);
    assert.equal(findGui(cliDir, dir)?.entry, join(folder, 'dist', 'main', 'main.js'));
    rmSync(join(folder, 'dist'), { recursive: true });
    assert.equal(findGui(cliDir, dir), null);
  });
});

test('with no app anywhere, the command says how to add it', () => {
  inTemp((dir) => {
    const cliDir = cliPackage(join(dir, 'node_modules'));
    assert.equal(findGui(cliDir, dir), null);
    assert.equal(guiStatusLine(null), 'desktop app: not installed; napkin-sketch --install-gui adds it (about 100 MB)');
  });
});

test("Electron's lookup says why there is no binary: no package, no path, or a path that is gone", () => {
  inTemp((dir) => {
    const throwing = join(dir, 'throwing');
    fakeElectron(join(throwing, 'node_modules'), "throw new Error('Electron failed to install correctly');");
    assert.deepEqual(electronFrom(throwing), { problem: 'unresolved' });
    const numeric = join(dir, 'numeric');
    fakeElectron(join(numeric, 'node_modules'), 'module.exports = 42;');
    assert.deepEqual(electronFrom(numeric), { problem: 'no-path' });
    const gone = join(dir, 'gone');
    const path = join(gone, 'node_modules', 'electron', 'dist', 'electron.exe');
    fakeElectron(join(gone, 'node_modules'), `module.exports = ${JSON.stringify(path)};`);
    assert.deepEqual(electronFrom(gone), { problem: 'missing', path });
    const none = join(dir, 'none');
    mkdirSync(none);
    assert.deepEqual(electronFrom(none), { problem: 'unresolved' });
  });
});

test("what the command says when the app's Electron is not there: the install again, or the clone's own words", () => {
  const app: GuiLocation = { where: 'package', folder: 'app', entry: 'app/dist/main', version: '1.0.0' };
  const again = "Electron's download did not finish: run napkin-sketch --install-gui again.";
  assert.equal(missingElectronText(app, { problem: 'unresolved' }), again);
  assert.equal(missingElectronText(app, { problem: 'no-path' }), again);
  assert.equal(
    missingElectronText(app, { problem: 'missing', path: 'electron.exe' }),
    "Electron's download did not finish (electron.exe is not there): run napkin-sketch --install-gui again.",
  );
  assert.equal(missingElectronText(app, { binary: 'electron.exe' }), null);
  const clone: GuiLocation = { where: 'clone', folder: 'clone', entry: 'clone/dist/main/main.js', version: null };
  assert.equal(missingElectronText(clone, { problem: 'unresolved' }), 'could not locate the Electron binary; its download did not finish.');
  assert.equal(missingElectronText(clone, { problem: 'no-path' }), 'could not locate the Electron binary. Run "npm install" first.');
  assert.equal(missingElectronText(clone, { problem: 'missing', path: 'electron.exe' }), 'the Electron binary is missing: electron.exe');
});

test("npm installs the app at the command line's version, globally or into this project, and removes it the same way", () => {
  assert.deepEqual(guiNpmArgs({ version: '1.0.0', here: false, uninstall: false }), ['install', '--global', `${GUI_PACKAGE}@1.0.0`, '--foreground-scripts']);
  assert.deepEqual(guiNpmArgs({ version: '1.0.0', here: true, uninstall: false }), ['install', `${GUI_PACKAGE}@1.0.0`, '--foreground-scripts']);
  assert.deepEqual(guiNpmArgs({ version: '1.0.0', here: false, uninstall: true }), ['uninstall', '--global', GUI_PACKAGE]);
  assert.deepEqual(guiNpmArgs({ version: '1.0.0', here: true, uninstall: true }), ['uninstall', GUI_PACKAGE]);
});

test('the built command line reports the app it would start, and refuses --here alone', { skip: cliSkipReason() ?? false }, () => {
  const root = repoRoot();
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const run = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8', cwd: root });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split(/\r?\n/), [`napkin-sketch v${version}`, `desktop app: built in this clone, ${root}`]);
  const here = spawnSync(process.execPath, [CLI, '--here'], { encoding: 'utf8', cwd: root });
  assert.equal(here.status, 1);
  assert.match(here.stderr, /^napkin-sketch: --here goes with --install-gui or --uninstall-gui\./);
});
