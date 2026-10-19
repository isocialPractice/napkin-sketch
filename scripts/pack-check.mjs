#!/usr/bin/env node
/**
 * Packs the package, installs the tarball into an empty folder the way a user
 * installs it, and draws with it: the check that an install without Electron
 * can still draw, which is what the drawing commands promise.
 *
 *   npm run pack-check            # pack, install, draw, then remove the folder
 *   npm run pack-check -- --keep  # leave the folder, and print where it is
 *
 * It fails when the tarball holds a file it must not - the local Animation
 * Mode install record - or lacks one the entries need, when the package names
 * a dependency or the install brings anything with it, Electron included,
 * when `napkin-sketch draw -`, with a composition style or without,
 * `@isocialpractice/napkin-sketch` or `@isocialpractice/napkin-sketch/node`
 * does not draw, when a part - `/graphic-design`, `/sharpen`, `/engines` -
 * does not answer by its own subpath, or when the installed package cannot run the verbs that
 * combine, cut, clip, smear, bend, blend, lay effects and set type, or call the
 * engines behind them by name, with `@isocialpractice/napkin-sketch/markdown`
 * reading Markdown and coloring code for them.
 *
 * Before it installs anything it reads the tarball: every file an export names
 * is in it, and so is the `uri.md` of every skill folder whose reference files
 * it leaves out; nothing the package leaves out is - source maps, the app's
 * Electron bundles and guides, the roadmap, the changelog, the helpers'
 * reference files; every declaration's import, every bundle's import of a
 * shared chunk, and every stylesheet `url()` and source map link reaches a
 * file the tarball holds; the browser-safe entries reach no Node built-in
 * through the chunks they share with the Node ones; it packs to no more
 * than {@link MAX_PACKED}; each part a page loads without the editor costs it
 * no more than its line in {@link ENTRY_BUDGETS}; no chunk is empty; and
 * `dist/parts.json`, the record `napkin-sketch vendor` copies by, names for
 * each part exactly the files its entry reaches. It prints the packed and
 * unpacked sizes.
 *
 * Then the desktop app's package, `@isocialpractice/napkin-sketch-gui`: it
 * lays the package out with `scripts/pack-gui.mjs`, packs it, and reads the
 * tarball the same way - the app's files there, the API's, the maps, the
 * declarations and the manual's Markdown not, every page's script and
 * stylesheet and every stylesheet `url()` reaching a file it holds, Electron
 * its one dependency at the clone's range, and no more than
 * {@link MAX_GUI_PACKED} packed. It installs it beside the API's package with
 * install scripts off, so Electron's package arrives without its download,
 * and asks the installed command line: `--version` finds the app at the
 * version they share without touching Electron, and opening a sketch with
 * Electron pointed at a folder that holds none says the download did not
 * finish, rather than downloading it or starting anything.
 *
 * Run `npm run build`, `npm run build:types` and `npm run site` first: it
 * packs what `dist/` and `docs/` hold. The API's half needs no network, since
 * that package has no dependencies to fetch; the app's half installs
 * Electron's package and its own few dependencies, from npm's cache when they
 * are there.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

const SCRIPT = 'napkin 1\npage 200 120\nlayer "Card"\ncolor #1f2328 width 3 fill #ffe08a\nrect 10 10 180 100 r 12\n';

/**
 * The verbs that run the drawing engines - wipe, stack, split, clip, the
 * eraser, the Pencil, the Smear and Liquify; the effects, Splatter, Warp, 3D
 * and a blend; and type, with a Text Configuration, Markdown and a code
 * accent - in one script.
 */
const ENGINE_SCRIPT = [
  'napkin 1',
  'page 320 240',
  'fill #27486d',
  'wipe in {', '  rect 20 20 80 80', '  circle 100 60 40', '}',
  'stack remove 140 60 {', '  rect 120 20 80 80', '  circle 200 60 40', '}',
  'fill none',
  'line 20 140 300 140',
  'split 160 140',
  'clip {', '  rect 220 120 80 60', '  circle 260 150 25', '}',
  'tool eraser', 'width 10', 'line 60 120 60 160',
  'pencil 2B', 'line 20 180 120 180', 'smear 12 0.5 20 180, 120 180',
  'tool brush', 'circle 260 60 30',
  'warp 230 60 20 10 0', 'twirl 260 60 30 45', 'pucker 260 60 30 0.2', 'bloat 260 60 30 0.2',
  'tool pen', 'width 2', 'fill #8ecae6',
  'effect blur 1', 'effect outer-glow 6 #ffcc00', 'rect 20 196 30 30',
  'effect splatter seed 2', 'rect 60 196 30 30',
  'effect warp arc bend 30%', 'rect 100 196 30 30',
  'effect extrude 12', 'rect 140 196 30 30',
  'blend stack', 'layer "Band"', 'rect 0 190 320 6',
  'textconfig "Callout" face "Bold" color #c0392b',
  'character tracking 20', 'paragraph align center',
  'text "Acme Corp" at 160 4 config "Callout"',
  'character reset', 'paragraph reset',
  'text "**Widgets**\\n\\n- one" at 190 196 size 10 markdown',
  'accent python', 'text "x = 1" at 250 196 size 10',
  '',
].join('\n');

/** A composition style for the drawing command: a rule its script's layer matches, and one it does not. */
const STYLE = { napkinCompositionStyle: 1, name: 'Muted', layers: { Card: { opacity: 0.5 }, Titel: { opacity: 0.2 } } };

/** The engines' exports a program calls by name. */
const ENGINES = [
  'booleanOp', 'eraseMarks', 'eraseRegionOf', 'wipeMarks', 'arrangeFaces', 'stackFaces', 'nearestOnMark', 'splitMark', 'makeClip', 'clipIndex', 'pencilPaint',
  'grainTile', 'smudgeBuffer', 'liquifyField', 'liquifyMarks',
  'blendModeOf', 'blendPixel', 'addEffect', 'appearanceSections', 'runEffects', 'splatterPaths', 'warpStyleMap', 'extrudeMesh', 'revolveMesh', 'render3d',
  'lengthTable', 'pointAtLength', 'layoutType', 'hyphenate', 'openSfnt', 'glyphOutline', 'outlineText', 'newTextConfig', 'applyTextConfig', 'resolveRunAttrs',
  'markdownToType', 'accentRuns', 'applyCompositionStyle', 'captureCompositionStyle',
];

/** The fields that would make an install fetch something: the package has none, and promises none. */
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies'];

/** Files the entries need, which a tarball without them would install broken. */
const REQUIRED = [
  'dist/cli/index.js',
  'dist/api/index.js',
  'dist/api/index.d.ts',
  'dist/node/index.js',
  'dist/api/node.d.ts',
  'dist/markdown/index.js',
  'dist/markdown/index.d.ts',
  'dist/parts.json',
  'docs/api/INDEX.json',
  'API.md',
  'API-CHEATSHEET.md',
  'THIRD-PARTY-NOTICES.md',
];

/** Files the package must never hold, each with why: one machine's state, or a part that stays in the repository. */
const FORBIDDEN = [
  { path: 'ai-helper/installed.json', why: "this machine's Animation Mode install record" },
  { path: 'TODO.md', why: 'the roadmap, which stays in the repository' },
  { path: 'CHANGELOG.md', why: 'the changelog, which the releases and the site carry' },
  { path: 'QUICKSTART.md', why: "the app's guide, which the site carries" },
  { path: 'CHEATSHEET.md', why: "the app's guide, which the site carries" },
  { path: 'scripts/animation-mode.mjs', why: 'a feature of the app in a clone' },
  { path: 'dist/main/main.js', why: "the app's Electron main process, which the package cannot start" },
  { path: 'dist/renderer/renderer.js', why: "the app's window, which the package cannot start" },
  { path: 'dist/embed/napkin-sketch.js', why: 'the script-tag bundle, which the package no longer has' },
];

/**
 * Files the package must never hold, by pattern: the documentation site
 * writes its API pages as HTML beside the Markdown in docs/api, which ships,
 * and `package.json` `files` leaves the HTML out; the build writes a source
 * map beside every bundle; the app loads its extra code languages one script
 * each; and the helpers' reference sheets and their data are fetched by URI.
 */
const FORBIDDEN_PATTERNS = [
  { pattern: /^docs\/api\/.*\.html$/, why: 'the documentation site, which the package does not ship' },
  { pattern: /\.map$/, why: 'source maps, which stay in the clone' },
  { pattern: /^dist\/renderer\/accents\//, why: "the app's on-demand language bundles" },
  { pattern: /^ai-helper\/.*\/assets\/.*\.(svg|png|json)$/, why: 'the reference files, which the skills fetch by URI' },
];

/** The most the tarball may weigh, packed, so a package that grows is noticed before it is published. */
const MAX_PACKED = 1.5 * 1024 * 1024;

/**
 * The parts a page loads without the editor, and the most each may cost it,
 * gzipped, over every file it reaches: about a third over what each weighed in
 * 1.1.0 - the composition 50 KB, sharpening 6 KB, the engines 126 KB - against
 * about 275 KB for the main entry. A part that starts reaching the editor's
 * chunk fails here rather than becoming a download nobody measured.
 */
const ENTRY_BUDGETS = {
  'dist/graphic-design/index.js': 68 * 1024,
  'dist/sharpen/index.js': 9 * 1024,
  'dist/engines/index.js': 168 * 1024,
};

/** The desktop app's npm package. */
const GUI_PACKAGE = '@isocialpractice/napkin-sketch-gui';

/** Files the app needs, which an app tarball without them would install broken. */
const GUI_REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'dist/main/main.js',
  'dist/main/preload.js',
  'dist/main/package.json',
  'dist/renderer/renderer.js',
  'dist/renderer/settings.js',
  'dist/renderer/index.html',
  'dist/renderer/settings.html',
  'dist/renderer/styles.css',
  'dist/assets/icon.png',
  'docs/index.html',
];

/** What the app's package must never hold, by pattern: the other package's parts, the maps, and the clone's. */
const GUI_FORBIDDEN_PATTERNS = [
  { pattern: /^dist\/(?:api|node|markdown|graphic-design|engines|cli|chunks|embed|core|sharpen)\//, why: "the API's and the command line's, which the other package carries" },
  { pattern: /\.map$/, why: 'source maps, which stay in the clone' },
  { pattern: /\.d\.ts$/, why: "declarations, which the API's package carries" },
  { pattern: /^docs\/site-src\//, why: "the manual's Markdown, which the clone keeps" },
  { pattern: /^ai-helper\//, why: "the AI helpers, which the API's package carries" },
];

/** The most the app's tarball may weigh, packed: the app and its manual, with Electron fetched beside it. */
const MAX_GUI_PACKED = 4 * 1024 * 1024;

/** The entries a browser loads, which must reach no Node built-in. */
const BROWSER_ENTRIES = ['dist/api/index.js', 'dist/markdown/index.js', ...Object.keys(ENTRY_BUDGETS)];

/** A built module's relative imports - static, bare and dynamic - as written. */
function relativeImports(text) {
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
}

/**
 * The files the browser-safe entries reach that import a Node built-in. The
 * package's entries share their chunks, so a module that imports `node:fs`
 * must land only in chunks the Node entries load.
 */
function nodeBuiltinsReached(paths) {
  const seen = new Set();
  const found = [];
  const stack = [...BROWSER_ENTRIES];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || !paths.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(root, ...file.split('/')), 'utf-8');
    if (/(?:\bfrom|\bimport)\s*\(?\s*["']node:/.test(text)) found.push(file);
    for (const spec of relativeImports(text)) stack.push(posix.normalize(posix.join(posix.dirname(file), spec)));
  }
  return found;
}

/**
 * Where `dist/parts.json` and the bundles disagree: a part whose files are not
 * the files its entry reaches with their scope markers, a file it names that
 * the tarball lacks, an export with no part, a platform the browser-safe list
 * contradicts, or a version that is not the package's. `napkin-sketch vendor`
 * copies a part by this record, so a record that drifted would vendor a copy
 * that does not load.
 */
function partsDrift(paths, manifest) {
  const record = JSON.parse(readFileSync(join(root, 'dist', 'parts.json'), 'utf-8'));
  const problems = [];
  if (record.version !== manifest.version) problems.push(`it is for ${record.version}, and the package is ${manifest.version}`);
  const named = new Set(Object.values(record.parts).map((part) => part.subpath));
  for (const subpath of Object.keys(manifest.exports)) if (!named.has(subpath)) problems.push(`it has no part for ${subpath}`);
  for (const [name, part] of Object.entries(record.parts)) {
    for (const file of part.files) if (!paths.has(`dist/${file}`)) problems.push(`${name} names dist/${file}, which the tarball lacks`);
    if (!part.entry.endsWith('.js')) continue;
    const walked = new Set();
    const stack = [`dist/${part.entry}`];
    while (stack.length > 0) {
      const file = stack.pop();
      if (walked.has(file) || !paths.has(file)) continue;
      walked.add(file);
      for (const spec of relativeImports(readFileSync(join(root, ...file.split('/')), 'utf-8'))) stack.push(posix.normalize(posix.join(posix.dirname(file), spec)));
    }
    const expected = new Set();
    for (const file of walked) {
      const path = file.slice('dist/'.length);
      expected.add(path);
      expected.add(posix.join(posix.dirname(path), 'package.json'));
    }
    const recorded = new Set(part.files);
    const left = [...expected].filter((file) => !recorded.has(file));
    const extra = [...recorded].filter((file) => !expected.has(file));
    if (left.length > 0) problems.push(`${name} leaves out ${left.join(', ')}`);
    if (extra.length > 0) problems.push(`${name} names ${extra.join(', ')}, which its entry does not reach`);
    const browser = BROWSER_ENTRIES.includes(`dist/${part.entry}`);
    if (browser !== (part.platform === 'browser')) problems.push(`${name} is recorded as ${part.platform}, and pack-check ${browser ? 'holds it browser-safe' : 'does not'}`);
  }
  return problems;
}

/** What a page downloads for one entry: every file it reaches, each gzipped at level 6, summed. */
function gzippedReach(entry, paths) {
  const seen = new Set();
  const stack = [entry];
  let total = 0;
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || !paths.has(file)) continue;
    seen.add(file);
    const bytes = readFileSync(join(root, ...file.split('/')));
    total += gzipSync(bytes, { level: 6 }).length;
    for (const spec of relativeImports(bytes.toString('utf-8'))) stack.push(posix.normalize(posix.join(posix.dirname(file), spec)));
  }
  return total;
}

/** A byte count in kilobytes, to one place. */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** A byte count in megabytes, to two places. */
function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * The address list of every skill folder whose reference files the package
 * leaves out: a tool reaching for a sheet in an install finds this instead.
 */
function uriFiles() {
  const out = [];
  const helpers = join(root, 'ai-helper');
  for (const helper of readdirSync(helpers, { withFileTypes: true })) {
    const skills = join(helpers, helper.name, 'skills');
    if (!helper.isDirectory() || !existsSync(skills)) continue;
    for (const skill of readdirSync(skills, { withFileTypes: true })) {
      const assets = join(skills, skill.name, 'assets');
      if (!skill.isDirectory() || !existsSync(assets)) continue;
      if (readdirSync(assets).some((file) => /\.(svg|png|json)$/.test(file))) out.push(`ai-helper/${helper.name}/skills/${skill.name}/assets/uri.md`);
    }
  }
  return out;
}

/** Every file the package map names, as a path in the tarball. */
function exportTargets(manifest) {
  const targets = new Set();
  const walk = (value) => {
    if (typeof value === 'string') targets.add(value.replace(/^\.\//, ''));
    else if (value && typeof value === 'object') for (const inner of Object.values(value)) walk(inner);
  };
  walk(manifest.exports);
  for (const field of ['main', 'module', 'types']) if (typeof manifest[field] === 'string') targets.add(manifest[field].replace(/^\.\//, ''));
  for (const bin of Object.values(manifest.bin ?? {})) targets.add(bin.replace(/^\.\//, ''));
  return [...targets];
}

/**
 * What the tarball's files name in each other that it does not hold: a
 * declaration's relative import, a stylesheet's `url()`, a bundle's source
 * map link and its imports of shared chunks, and the scripts and stylesheets
 * an app page loads. A `files` rule that drops something a shipped file still
 * names fails here, rather than in somebody's type check, bundler or window.
 * `base` is the folder the package was packed from.
 */
function unresolvedReferences(paths, base = root) {
  const missing = new Set();
  for (const file of paths) {
    const refs = [];
    const read = () => readFileSync(join(base, ...file.split('/')), 'utf-8');
    if (file.endsWith('.d.ts')) {
      for (const m of read().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) refs.push({ spec: m[1], types: true });
    } else if (file.endsWith('.css')) {
      for (const m of read().matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (!/^(?:data:|https?:|#)/.test(m[1])) refs.push({ spec: m[1], types: false });
      }
    } else if (/\.m?js$/.test(file)) {
      const text = read();
      const link = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(text);
      if (link && !link[1].startsWith('data:')) refs.push({ spec: link[1], types: false });
      // A bundle's imports of the chunks it shares.
      if (file.startsWith('dist/')) for (const spec of relativeImports(text)) refs.push({ spec, types: false });
    } else if (file.endsWith('.html') && file.startsWith('dist/')) {
      // An app page's scripts and stylesheet, which its window loads beside it.
      for (const m of read().matchAll(/\b(?:src|href)=["']([^"'#?]+)/g)) {
        if (!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(m[1])) refs.push({ spec: m[1], types: false });
      }
    }
    for (const { spec, types } of refs) {
      const base = posix.normalize(posix.join(posix.dirname(file), spec));
      const candidates = types ? [base.replace(/\.js$/, '.d.ts'), `${base}.d.ts`, `${base}/index.d.ts`, base] : [base];
      if (!candidates.some((candidate) => paths.has(candidate))) missing.add(`${file} names ${spec}`);
    }
  }
  return [...missing];
}

/** Stops the check; the folder is still removed. */
function fail(message) {
  throw new Error(message);
}

/**
 * Runs npm. Under `npm run`, npm names its own script in `npm_execpath`, and
 * running that with Node needs no shell; otherwise npm is found on the PATH,
 * which on Windows is a `.cmd` that only a shell runs.
 */
function npm(args, cwd, env = process.env) {
  const cli = process.env.npm_execpath;
  const result =
    cli && /\.[cm]?js$/.test(cli)
      ? spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf-8' })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
          cwd,
          env,
          encoding: 'utf-8',
          shell: process.platform === 'win32',
        });
  if (result.status !== 0) fail(`npm ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

/** Packs, installs into `dir`, and draws; throws, saying why, at the first thing wrong. Answers the project and the installed package. */
function check(dir) {
  // 1. Pack, and read what went in.
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', dir], root));
  const paths = new Set(packed.files.map((file) => file.path));
  const required = [...new Set([...REQUIRED, ...uriFiles(), ...exportTargets(JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')))])];
  const missing = required.filter((path) => !paths.has(path));
  if (missing.length > 0) fail(`the tarball lacks ${missing.join(', ')}: run npm run build and npm run build:types`);
  const leaked = FORBIDDEN.filter(({ path }) => paths.has(path));
  if (leaked.length > 0) fail(`the tarball holds ${leaked.map(({ path, why }) => `${path} (${why})`).join(', ')}`);
  for (const { pattern, why } of FORBIDDEN_PATTERNS) {
    const found = [...paths].filter((path) => pattern.test(path));
    if (found.length > 0) fail(`the tarball holds ${found.slice(0, 3).join(', ')}${found.length > 3 ? ` and ${found.length - 3} more` : ''}: ${why}`);
  }
  const dangling = unresolvedReferences(paths);
  if (dangling.length > 0) fail(`files in the tarball name files it does not hold: ${dangling.slice(0, 5).join('; ')}${dangling.length > 5 ? `; and ${dangling.length - 5} more` : ''}`);
  const builtins = nodeBuiltinsReached(paths);
  if (builtins.length > 0) fail(`the browser-safe entries reach a Node built-in through ${builtins.join(', ')}`);
  if (packed.size > MAX_PACKED) fail(`the tarball packs to ${mb(packed.size)}, over the ${mb(MAX_PACKED)} the package may weigh`);
  const weights = {};
  for (const [entry, budget] of Object.entries(ENTRY_BUDGETS)) {
    weights[entry] = gzippedReach(entry, paths);
    if (weights[entry] > budget) {
      fail(`${entry} costs a page ${kb(weights[entry])} gzipped, over the ${kb(budget)} it may: has it reached the editor's chunk?`);
    }
  }
  // A module of re-exports that two entries share is written as a chunk of
  // its own with nothing in it, and every page that loads either entry
  // fetches it: the main entry did, through the composition's index, once.
  const empty = packed.files.filter((file) => /^dist\/chunks\/.+\.js$/.test(file.path) && file.size === 0).map((file) => file.path);
  if (empty.length > 0) fail(`the tarball holds empty chunks, which a page fetches for nothing: ${empty.join(', ')}`);
  const drift = partsDrift(paths, JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')));
  if (drift.length > 0) fail(`dist/parts.json does not match the bundles: ${drift.join('; ')}. Run npm run build`);

  // 2. Install it into an empty project, as a user would, asking the helper
  //    installer for nothing.
  const project = join(dir, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'pack-check', version: '1.0.0', private: true }, null, 2)}\n`);
  const env = { ...process.env };
  delete env.NAPKIN_AI_HELPER;
  npm(['install', join(dir, packed.filename), '--no-audit', '--no-fund', '--no-package-lock'], project, env);
  const installed = join(project, 'node_modules', '@isocialpractice', 'napkin-sketch');
  if (existsSync(join(project, 'node_modules', 'electron'))) fail('the install brought electron with it');
  // No runtime dependencies: none named, and nothing installed beside the package.
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf-8'));
  const named = DEPENDENCY_FIELDS.filter((field) => manifest[field] !== undefined && Object.keys(manifest[field]).length > 0);
  if (named.length > 0) fail(`the package names ${named.map((field) => `${field} (${Object.keys(manifest[field]).join(', ')})`).join(' and ')}: it promises none`);
  const beside = readdirSync(join(project, 'node_modules')).filter((name) => !name.startsWith('.') && name !== '@isocialpractice');
  if (beside.length > 0) fail(`the install brought ${beside.join(', ')} with it`);
  const bin = join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'napkin-sketch.cmd' : 'napkin-sketch');
  if (!existsSync(bin)) fail(`the install made no ${bin}`);

  // 3. Draw from standard input with the installed command, which must not
  //    need Electron to do it.
  const cli = spawnSync(process.execPath, [join(installed, 'dist', 'cli', 'index.js'), 'draw', '-', '--json', '--out', 'out'], {
    cwd: project,
    input: SCRIPT,
    encoding: 'utf-8',
  });
  let report;
  try {
    report = JSON.parse(cli.stdout);
  } catch {
    fail(`napkin-sketch draw printed no report:\n${cli.stdout}${cli.stderr}`);
  }
  if (cli.status !== 0 || !report.ok) fail(`napkin-sketch draw exited ${cli.status}:\n${cli.stdout}${cli.stderr}`);
  const drawn = join(project, report.files[0].path);
  if (!/<svg[\s>]/.test(readFileSync(drawn, 'utf-8'))) fail(`${drawn} is not an SVG`);

  // And with a composition style: its rule restyles the layer it names, and
  // the one that names nothing is reported, not fatal.
  writeFileSync(join(project, 'style.json'), `${JSON.stringify(STYLE)}\n`);
  const styledRun = spawnSync(process.execPath, [join(installed, 'dist', 'cli', 'index.js'), 'draw', '-', '--composition-style', 'style.json', '--json', '--out', 'styled'], {
    cwd: project,
    input: SCRIPT,
    encoding: 'utf-8',
  });
  let styled;
  try {
    styled = JSON.parse(styledRun.stdout);
  } catch {
    fail(`napkin-sketch draw --composition-style printed no report:\n${styledRun.stdout}${styledRun.stderr}`);
  }
  if (styledRun.status !== 0 || !styled.ok) fail(`napkin-sketch draw --composition-style exited ${styledRun.status}:\n${styledRun.stdout}${styledRun.stderr}`);
  const restyled = readFileSync(join(project, styled.files[0].path), 'utf-8');
  if (!/<g id="Card"[^>]*opacity="0\.5"/.test(restyled)) fail(`the composition style did not restyle the Card layer: ${styled.files[0].path}`);
  if (styled.warnings.length !== 1 || !/Titel/.test(styled.warnings[0])) fail(`the style's report is not what its rules make it: ${JSON.stringify(styled.warnings)}`);

  // 4. Draw with both entries, imported by name, and call each part by its
  //    own subpath: compose, sharpen, and combine regions on a page.
  writeFileSync(
    join(project, 'check.mjs'),
    [
      "import { drawSvg } from '@isocialpractice/napkin-sketch';",
      "import { drawToFiles } from '@isocialpractice/napkin-sketch/node';",
      "import { createComposition, escapeXml, isPng, parseColor } from '@isocialpractice/napkin-sketch/graphic-design';",
      "import { DEFAULT_SHARPEN_OPTIONS, classify } from '@isocialpractice/napkin-sketch/sharpen';",
      "import { booleanOp, createSketch } from '@isocialpractice/napkin-sketch/engines';",
      `const script = ${JSON.stringify(SCRIPT)};`,
      'const { ok, svg } = drawSvg(script);',
      "const result = await drawToFiles(script, { out: 'lib-out', formats: ['svg', 'png'] });",
      "const card = createComposition({ width: 40, height: 20, background: '#ffffff' });",
      "card.text({ x: 4, y: 14, text: 'Fish & Chips', fill: '#4cae50' });",
      "const composed = card.toSVG().includes(escapeXml('Fish & Chips')) && isPng(card.toPNG()) && parseColor('#4cae50').g === 0xae;",
      'const round = Array.from({ length: 40 }, (_, i) => ({ x: 50 + 30 * Math.cos((i / 40) * 2 * Math.PI), y: 50 + 30 * Math.sin((i / 40) * 2 * Math.PI) }));',
      "const sharpened = classify(round, DEFAULT_SHARPEN_OPTIONS) === 'circle';",
      'const square = (x, y, s) => [[{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]];',
      "const engined = booleanOp(square(0, 0, 10), square(5, 5, 10), 'union')?.length === 1 && createSketch('card').layers.length === 1;",
      'console.log(JSON.stringify({ ok: ok && result.ok, svg: svg.length, files: result.files.map((file) => file.path), composed, sharpened, engined }));',
      '',
    ].join('\n'),
  );
  const lib = spawnSync(process.execPath, ['check.mjs'], { cwd: project, encoding: 'utf-8' });
  if (lib.status !== 0) fail(`importing the package failed:\n${lib.stderr}`);
  const library = JSON.parse(lib.stdout);
  if (!library.ok || library.svg === 0 || library.files.length !== 2) fail(`the entries did not draw: ${lib.stdout}`);
  if (!library.composed) fail(`@isocialpractice/napkin-sketch/graphic-design did not compose: ${lib.stdout}`);
  if (!library.sharpened) fail(`@isocialpractice/napkin-sketch/sharpen did not read a round stroke as a circle: ${lib.stdout}`);
  if (!library.engined) fail(`@isocialpractice/napkin-sketch/engines did not combine two regions: ${lib.stdout}`);

  // 5. The engines, from the installed package: the verbs that run them,
  //    and each called by name, Markdown and code read by the subpath that
  //    gives the core its readers.
  writeFileSync(
    join(project, 'engines.mjs'),
    [
      `import { drawSvg, PENCIL_GRADES, ${ENGINES.join(', ')} } from '@isocialpractice/napkin-sketch';`,
      "import '@isocialpractice/napkin-sketch/markdown';",
      `const drawn = drawSvg(${JSON.stringify(ENGINE_SCRIPT)});`,
      'const square = (x, y, s) => [[{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]];',
      'const answers = [',
      "  booleanOp(square(0, 0, 10), square(5, 5, 10), 'union')?.length === 1,",
      '  PENCIL_GRADES.length === 30,',
      "  pencilPaint('2B').label === 'Graphite 2B',",
      '  grainTile().length === 128 * 128,',
      "  liquifyField({ mode: 'bloat', x: 0, y: 0, radius: 10, amount: 0.5 }).point({ x: 20, y: 0 }).x === 20,",
      "  blendModeOf('multiply') === 'stack',",
      "  hyphenate('composition').join('-') === 'com-po-si-tion',",
      '  extrudeMesh({ rings: square(0, 0, 40), closed: true }, 20, true).faces.length === 6,',
      '  lengthTable([{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }]).total === 100,',
      "  markdownToType('**Acme**').text === 'Acme',",
      "  accentRuns('x = 1', 'python').runs.length > 0,",
      '];',
      `const named = [${ENGINES.join(', ')}].every((call) => typeof call === 'function');`,
      'console.log(JSON.stringify({ ok: drawn.ok, codes: drawn.diagnostics.map((d) => d.code), answers: answers.every(Boolean), named }));',
      '',
    ].join('\n'),
  );
  const run = spawnSync(process.execPath, ['engines.mjs'], { cwd: project, encoding: 'utf-8' });
  if (run.status !== 0) fail(`calling the engines failed:\n${run.stderr}`);
  const engines = JSON.parse(run.stdout);
  if (!engines.ok || engines.codes.length > 0) fail(`the engines' verbs did not draw clean: ${run.stdout}`);
  if (!engines.answers || !engines.named) fail(`the engines did not answer by name: ${run.stdout}`);

  console.log(
    `pack-check: ${packed.filename} (${packed.entryCount} files, ${mb(packed.size)} packed, ${mb(packed.unpackedSize)} unpacked) installs alone, with no dependencies, and draws: ` +
      `${report.files[0].path} from the command line, and ${styled.files[0].path} with a composition style, ` +
      `${library.files.join(' and ')} from the entries, a call into each part - ` +
      `${Object.entries(weights).map(([entry, bytes]) => `/${entry.split('/')[1]} (${kb(bytes)} gzipped to a page)`).join(', ')} - ` +
      `and the engines' verbs and ${ENGINES.length} engines by name.`,
  );
  return { project, installed };
}

/**
 * Lays out the desktop app's package, packs it and reads the tarball, then
 * installs it beside the API's package in `project` without Electron's
 * download and asks the command line `installed` holds what it finds; throws,
 * saying why, at the first thing wrong.
 */
function checkGui(dir, { project, installed }) {
  // 1. Lay it out, pack it, and read what went in.
  const laid = spawnSync(process.execPath, [join(root, 'scripts', 'pack-gui.mjs')], { cwd: root, encoding: 'utf-8' });
  if (laid.status !== 0) fail(`npm run pack-gui failed:\n${laid.stderr || laid.stdout}`);
  const guiDir = join(root, 'release', 'gui');
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', dir], guiDir));
  const paths = new Set(packed.files.map((file) => file.path));
  const missing = GUI_REQUIRED.filter((path) => !paths.has(path));
  if (missing.length > 0) fail(`the app's tarball lacks ${missing.join(', ')}: run npm run build and npm run site`);
  for (const { pattern, why } of GUI_FORBIDDEN_PATTERNS) {
    const found = [...paths].filter((path) => pattern.test(path));
    if (found.length > 0) fail(`the app's tarball holds ${found.slice(0, 3).join(', ')}${found.length > 3 ? ` and ${found.length - 3} more` : ''}: ${why}`);
  }
  const dangling = unresolvedReferences(paths, guiDir);
  if (dangling.length > 0) fail(`files in the app's tarball name files it does not hold: ${dangling.slice(0, 5).join('; ')}${dangling.length > 5 ? `; and ${dangling.length - 5} more` : ''}`);
  const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  const manifest = JSON.parse(readFileSync(join(guiDir, 'package.json'), 'utf-8'));
  if (manifest.name !== GUI_PACKAGE || manifest.version !== own.version) fail(`the app's package is ${manifest.name}@${manifest.version}, not ${GUI_PACKAGE}@${own.version}`);
  const electron = own.devDependencies.electron;
  if (JSON.stringify(manifest.dependencies) !== JSON.stringify({ electron })) fail(`the app's package depends on ${JSON.stringify(manifest.dependencies)}, not on electron ${electron} alone`);
  if (manifest.bin !== undefined) fail("the app's package names a bin: the API's command line starts it");
  const app = JSON.parse(readFileSync(join(guiDir, 'dist', 'main', 'package.json'), 'utf-8'));
  if (app.name !== 'napkin-sketch' || app.version !== own.version) fail(`dist/main/package.json names the app ${app.name}@${app.version}, not napkin-sketch@${own.version}`);
  if (packed.size > MAX_GUI_PACKED) fail(`the app's tarball packs to ${mb(packed.size)}, over the ${mb(MAX_GUI_PACKED)} it may weigh`);

  // 2. Before it is installed, the command line says so, and opens nothing.
  const cli = join(installed, 'dist', 'cli', 'index.js');
  const env = { ...process.env };
  delete env.ELECTRON_OVERRIDE_DIST_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  const ask = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: project, env: { ...env, ...extra }, encoding: 'utf-8', timeout: 60_000 });
  const before = ask(['--version']);
  if (before.status !== 0 || !/^desktop app: not installed; napkin-sketch --install-gui adds it/m.test(before.stdout)) {
    fail(`napkin-sketch --version did not say the app is not installed:\n${before.stdout}${before.stderr}`);
  }
  const absent = ask(['--new', 'pack-check']);
  if (absent.status !== 1 || !/the desktop app is not installed\. Run: napkin-sketch --install-gui/.test(absent.stderr)) {
    fail(`napkin-sketch --new did not say the app is not installed:\n${absent.stdout}${absent.stderr}`);
  }

  // 3. Install it beside the API's package, as --install-gui --here does,
  //    with install scripts off: Electron's package, not its download.
  npm(['install', join(dir, packed.filename), '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', '--no-package-lock'], project, env);
  const folder = join(project, 'node_modules', ...GUI_PACKAGE.split('/'));
  if (!existsSync(join(project, 'node_modules', 'electron', 'package.json'))) fail('installing the app brought no electron package');

  // 4. The command line finds it at the version they share, without
  //    touching Electron, whose package downloads a missing binary when it is
  //    required. Told the binary is in a folder that holds none, the package
  //    answers a path that is not there, which is what an unfinished download
  //    looks like, and the command says so rather than starting anything.
  const after = ask(['--version']);
  const found = after.stdout.split(/\r?\n/)[1];
  if (after.status !== 0 || found !== `desktop app: ${own.version} at ${folder}`) fail(`napkin-sketch --version did not find the app at ${folder}:\n${after.stdout}${after.stderr}`);
  if (after.stderr !== '') fail(`napkin-sketch --version warned about an app at its own version:\n${after.stderr}`);
  const open = ask(['--new', 'pack-check'], { ELECTRON_OVERRIDE_DIST_PATH: join(dir, 'no-electron') });
  if (open.status !== 1 || !/Electron's download did not finish \(.*no-electron.* is not there\): run napkin-sketch --install-gui again/.test(open.stderr)) {
    fail(`napkin-sketch --new did not say Electron's download did not finish:\n${open.stdout}${open.stderr}`);
  }

  console.log(
    `pack-check: ${packed.filename} (${packed.entryCount} files, ${mb(packed.size)} packed, ${mb(packed.unpackedSize)} unpacked) installs beside it with electron ${electron}, ` +
      `and the installed command line finds it at ${own.version} and starts nothing without Electron's binary.`,
  );
}

const dir = mkdtempSync(join(tmpdir(), 'napkin-pack-check-'));
try {
  checkGui(dir, check(dir));
} catch (err) {
  console.error(`pack-check: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (keep) console.log(`pack-check: kept ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
