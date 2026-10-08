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
 * `napkin-sketch` or `napkin-sketch/node` does not draw, or when the
 * installed package cannot run the verbs that combine, cut, clip, smear, bend,
 * blend, lay effects and set type, or call the engines behind them by name,
 * with `napkin-sketch/markdown` reading Markdown and coloring code for them.
 * Run `npm run build` and `npm run build:types` first: it packs what
 * `dist/` holds. It needs no network, since the package has no dependencies
 * to fetch.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'docs/api/INDEX.json',
  'API.md',
  'API-CHEATSHEET.md',
  'THIRD-PARTY-NOTICES.md',
];

/** Files that are one machine's state, never the package's. */
const FORBIDDEN = ['ai-helper/installed.json'];

/**
 * Files the package must never hold, by pattern: the documentation site
 * writes its API pages as HTML beside the Markdown in docs/api, which ships,
 * and `package.json` `files` leaves the HTML out.
 */
const FORBIDDEN_PATTERNS = [{ pattern: /^docs\/api\/.*\.html$/, why: 'the documentation site, which the package does not ship' }];

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

/** Packs, installs into `dir`, and draws; throws, saying why, at the first thing wrong. */
function check(dir) {
  // 1. Pack, and read what went in.
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', dir], root));
  const paths = new Set(packed.files.map((file) => file.path));
  const missing = REQUIRED.filter((path) => !paths.has(path));
  if (missing.length > 0) fail(`the tarball lacks ${missing.join(', ')}: run npm run build and npm run build:types`);
  const leaked = FORBIDDEN.filter((path) => paths.has(path));
  if (leaked.length > 0) fail(`the tarball holds ${leaked.join(', ')}, which is this machine's state`);
  for (const { pattern, why } of FORBIDDEN_PATTERNS) {
    const found = [...paths].filter((path) => pattern.test(path));
    if (found.length > 0) fail(`the tarball holds ${found.slice(0, 3).join(', ')}${found.length > 3 ? ` and ${found.length - 3} more` : ''}: ${why}`);
  }

  // 2. Install it into an empty project, as a user would, asking the helper
  //    installer for nothing.
  const project = join(dir, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'pack-check', version: '1.0.0', private: true }, null, 2)}\n`);
  const env = { ...process.env };
  delete env.NAPKIN_AI_HELPER;
  npm(['install', join(dir, packed.filename), '--no-audit', '--no-fund', '--no-package-lock'], project, env);
  const installed = join(project, 'node_modules', 'napkin-sketch');
  if (existsSync(join(project, 'node_modules', 'electron'))) fail('the install brought electron with it');
  // No runtime dependencies: none named, and nothing installed beside the package.
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf-8'));
  const named = DEPENDENCY_FIELDS.filter((field) => manifest[field] !== undefined && Object.keys(manifest[field]).length > 0);
  if (named.length > 0) fail(`the package names ${named.map((field) => `${field} (${Object.keys(manifest[field]).join(', ')})`).join(' and ')}: it promises none`);
  const beside = readdirSync(join(project, 'node_modules')).filter((name) => !name.startsWith('.') && name !== 'napkin-sketch');
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

  // 4. Draw with both entries, imported by name.
  writeFileSync(
    join(project, 'check.mjs'),
    [
      "import { drawSvg } from 'napkin-sketch';",
      "import { drawToFiles } from 'napkin-sketch/node';",
      `const script = ${JSON.stringify(SCRIPT)};`,
      'const { ok, svg } = drawSvg(script);',
      "const result = await drawToFiles(script, { out: 'lib-out', formats: ['svg', 'png'] });",
      'console.log(JSON.stringify({ ok: ok && result.ok, svg: svg.length, files: result.files.map((file) => file.path) }));',
      '',
    ].join('\n'),
  );
  const lib = spawnSync(process.execPath, ['check.mjs'], { cwd: project, encoding: 'utf-8' });
  if (lib.status !== 0) fail(`importing the package failed:\n${lib.stderr}`);
  const library = JSON.parse(lib.stdout);
  if (!library.ok || library.svg === 0 || library.files.length !== 2) fail(`the entries did not draw: ${lib.stdout}`);

  // 5. The engines, from the installed package: the verbs that run them,
  //    and each called by name, Markdown and code read by the subpath that
  //    gives the core its readers.
  writeFileSync(
    join(project, 'engines.mjs'),
    [
      `import { drawSvg, PENCIL_GRADES, ${ENGINES.join(', ')} } from 'napkin-sketch';`,
      "import 'napkin-sketch/markdown';",
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
    `pack-check: ${packed.filename} (${packed.entryCount} files) installs alone, with no dependencies, and draws: ` +
      `${report.files[0].path} from the command line, and ${styled.files[0].path} with a composition style, ` +
      `${library.files.join(' and ')} from the entries, and the engines' verbs and ${ENGINES.length} engines by name.`,
  );
}

const dir = mkdtempSync(join(tmpdir(), 'napkin-pack-check-'));
try {
  check(dir);
} catch (err) {
  console.error(`pack-check: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (keep) console.log(`pack-check: kept ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
