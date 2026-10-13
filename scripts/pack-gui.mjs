#!/usr/bin/env node
/**
 * Lays out the desktop app's npm package, `@isocialpractice/napkin-sketch-gui`,
 * in `release/gui/`, from what `npm run build` and `npm run site` wrote:
 *
 *   npm run build && npm run site
 *   npm run pack-gui      # release/gui/, ready for npm pack or npm publish
 *
 * The package is the app and nothing else: the Electron main process and its
 * preload, the window's pages, scripts, stylesheet and code languages, the
 * cursors and the icon, and the manual Help opens with no network. Electron
 * is its one dependency, at the range the clone's own `devDependencies` give,
 * and its version is the clone's, which is the version
 * `napkin-sketch --install-gui` asks npm for. Source maps and declarations
 * stay behind, and so do the lines that link the maps.
 *
 * `dist/main/package.json` names the app. Electron reads a name only from a
 * folder it is started on, and keeps the app's settings in a folder of that
 * name, so the command line starts it on `dist/main/` and the app keeps its
 * settings under `napkin-sketch` rather than under `Electron`.
 *
 * `npm run pack-check` runs this, then packs the folder and installs it.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release', 'gui');

/** The desktop app's npm package. */
const GUI_PACKAGE = '@isocialpractice/napkin-sketch-gui';

/** The app's name, and so the name of the folder it keeps its settings in. */
const APP_NAME = 'napkin-sketch';

/** What the build and the site must have written first, and the command that writes each. */
const BUILT = [
  ['dist/main/main.js', 'npm run build'],
  ['dist/main/preload.js', 'npm run build'],
  ['dist/renderer/renderer.js', 'npm run build'],
  ['dist/renderer/index.html', 'npm run build'],
  ['docs/index.html', 'npm run site'],
];

/** The folders of dist/ the app runs from; the others are the API's and the command line's. */
const APP_FOLDERS = ['main', 'renderer', 'assets'];

/** Stops, saying why. */
function fail(message) {
  console.error(`pack-gui: ${message}`);
  process.exit(1);
}

/** A built script without the line that links its source map, which stays behind. */
function withoutMapLink(text) {
  return text.replace(/(?:^|\r?\n)\/\/# sourceMappingURL=\S+\s*$/, '\n');
}

/** Copies one of dist/'s folders into the package, without maps, declarations, or the lines that link the maps. */
function copyApp(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyApp(source, target);
    else if (/\.map$|\.d\.ts$/.test(entry.name)) continue;
    else if (entry.name.endsWith('.js')) writeFileSync(target, withoutMapLink(readFileSync(source, 'utf-8')));
    else cpSync(source, target);
  }
}

/** How many files `dir` holds, and how many bytes. */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = measure(path);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const electron = pkg.devDependencies?.electron;
if (typeof electron !== 'string') fail('package.json names no electron in devDependencies');
for (const [file, command] of BUILT) {
  if (!existsSync(join(root, file))) fail(`${file} is missing: run ${command} first`);
}

rmSync(out, { recursive: true, force: true });
for (const folder of APP_FOLDERS) copyApp(join(root, 'dist', folder), join(out, 'dist', folder));

// The name and the version Electron gives the app when it is started on dist/main/.
writeFileSync(
  join(out, 'dist', 'main', 'package.json'),
  `${JSON.stringify({ name: APP_NAME, version: pkg.version, private: true, type: 'commonjs', main: 'main.js' }, null, 2)}\n`,
);

// The manual, as the installers carry it: the site, without its Markdown.
const docs = join(root, 'docs');
cpSync(docs, join(out, 'docs'), {
  recursive: true,
  filter: (source) => !['site-src', '.nojekyll'].includes(relative(docs, source).split(/[\\/]/)[0]),
});

for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) cpSync(join(root, file), join(out, file));

writeFileSync(
  join(out, 'README.md'),
  [
    `# ${GUI_PACKAGE}`,
    '',
    'The desktop app of [napkin-sketch](https://www.npmjs.com/package/@isocialpractice/napkin-sketch):',
    'the sketching editor, with auto-sharpen, on Electron.',
    '',
    'There is no need to install this package by hand. The `napkin-sketch`',
    'command installs it at its own version, with Electron, and starts it:',
    '',
    '```bash',
    'npm install -g @isocialpractice/napkin-sketch',
    'napkin-sketch --install-gui      # this package and Electron, about 100 MB',
    'napkin-sketch                    # opens a new blank sketch',
    '```',
    '',
    '`napkin-sketch --uninstall-gui` removes it, and `napkin-sketch --version`',
    `says where it is. Requires Node.js 22.12 or newer. The manual is at`,
    `${pkg.homepage}, and in the app under Help.`,
    '',
  ].join('\n'),
);

const manifest = {
  name: GUI_PACKAGE,
  version: pkg.version,
  description:
    'The desktop app of napkin-sketch: the sketching editor, with auto-sharpen, on Electron. Installed by napkin-sketch --install-gui from @isocialpractice/napkin-sketch.',
  keywords: ['sketch', 'drawing', 'svg', 'electron', 'gui', 'napkin', 'auto-sharpen', 'hand-drawn'],
  author: pkg.author,
  license: pkg.license,
  homepage: pkg.homepage,
  repository: pkg.repository,
  bugs: pkg.bugs,
  type: 'commonjs',
  main: 'dist/main/main.js',
  files: ['dist', 'docs', 'README.md', 'THIRD-PARTY-NOTICES.md'],
  publishConfig: { access: 'public' },
  engines: pkg.engines,
  dependencies: { electron },
};
writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const { files, bytes } = measure(out);
console.log(
  `pack-gui: release/gui holds ${GUI_PACKAGE}@${pkg.version}, ${files} files and ${(bytes / 1024 / 1024).toFixed(2)} MB, depending on electron ${electron}.`,
);
