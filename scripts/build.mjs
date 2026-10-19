// Build script for napkin-sketch using esbuild.
// Bundles the Electron main + preload (Node/CommonJS) and the renderer
// (browser/IIFE) for the app, and the package's entries with the command line
// (ES modules sharing one core), each minified, then copies static renderer
// assets to dist/.

import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

/**
 * Source maps for the bundles the npm package ships: written beside them in
 * the clone, with no link from the bundle. The package leaves the maps out,
 * and a link to a map that is not there makes a consumer's bundler warn. The
 * app's own bundles link theirs, for the DevTools.
 */
const packageMaps = 'external';

/** The package entries' last metafile, which `dist/parts.json` is written from. */
let packageMetafile = null;

/** Whether the static files are in `dist/`, so a part's file sizes can be read. */
let staticCopied = false;

/**
 * The third-party code the package's bundles carry, found by the inputs that
 * bring it in, each with the heading of its section in THIRD-PARTY-NOTICES.md.
 * A part records the notices for what its files hold, so a vendored copy of it
 * carries those and no others. A bundled package with no line here fails the
 * build: a notice owed would otherwise go unwritten.
 */
const NOTICES = [
  { id: 'marked', input: /^node_modules\/marked\//, heading: /^### marked \d/ },
  { id: 'marked-highlight', input: /^node_modules\/marked-highlight\//, heading: /^### marked-highlight / },
  { id: 'highlight.js', input: /^node_modules\/highlight\.js\//, heading: /^### highlight\.js / },
  { id: 'hyphenation', input: /^src\/core\/type\/hyphenation\//, heading: /^### The en-US hyphenation patterns/ },
];

/**
 * Writes `dist/parts.json`: every entry in the package's exports map as a part
 * a program can take alone - its entry, every file it reaches, the scope
 * markers that make those files ES modules, its declarations, whether it runs
 * in a browser, its weight, and the notices its files owe. Paths are from
 * `dist/`, as a vendored copy lays them out. `napkin-sketch vendor` copies a
 * part by this record, and `pack-check` holds the record to the files.
 */
async function writeParts(metafile) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const noticeLines = (await readFile(resolve(root, 'THIRD-PARTY-NOTICES.md'), 'utf8')).split(/\r?\n/);
  const notices = {};
  for (const { id, heading } of NOTICES) {
    const line = noticeLines.find((text) => heading.test(text));
    if (!line) throw new Error(`build: THIRD-PARTY-NOTICES.md has no section for ${id}`);
    notices[id] = line;
  }

  const size = async (file) => (await stat(resolve(root, 'dist', file))).size;
  const parts = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const name = subpath === '.' ? 'main' : subpath.slice(2);
    const entry = (typeof target === 'string' ? target : target.import).replace(/^\.\/dist\//, '');
    const types = typeof target === 'string' ? null : target.types.replace(/^\.\/dist\//, '');

    if (entry.endsWith('.css')) {
      // A stylesheet, with the files its `url()`s name.
      const css = await readFile(resolve(root, 'dist', entry), 'utf8');
      const files = [entry];
      for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (!/^(?:data:|[a-z]+:)/i.test(match[1])) files.push(posix.normalize(posix.join(posix.dirname(entry), match[1])));
      }
      let bytes = 0;
      for (const file of files) bytes += await size(file);
      parts[name] = { subpath, entry, types: null, platform: 'browser', files: [...new Set(files)].sort(), bytes, notices: [] };
      continue;
    }

    const key = `dist/${entry}`;
    if (!metafile.outputs[key]) throw new Error(`build: the exports map names ${key}, which the build did not write`);
    const reached = new Set();
    const builtins = new Set();
    const owed = new Set();
    const walk = (file) => {
      if (reached.has(file)) return;
      reached.add(file);
      const output = metafile.outputs[file];
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        if (bytesInOutput === 0) continue;
        const notice = NOTICES.find(({ input: pattern }) => pattern.test(input));
        if (notice) owed.add(notice.id);
        else if (input.startsWith('node_modules/')) throw new Error(`build: ${file} bundles ${input}, and THIRD-PARTY-NOTICES.md has no notice for it`);
      }
      for (const imported of output.imports) {
        if (imported.external) builtins.add(imported.path);
        else if (metafile.outputs[imported.path]) walk(imported.path);
      }
    };
    walk(key);

    const files = new Set();
    for (const file of reached) {
      const path = file.replace(/^dist\//, '');
      files.add(path);
      files.add(posix.join(posix.dirname(path), 'package.json'));
    }
    let bytes = 0;
    for (const file of files) bytes += await size(file);
    parts[name] = {
      subpath,
      entry,
      types,
      platform: builtins.size > 0 ? 'node' : 'browser',
      files: [...files].sort(),
      bytes,
      notices: [...owed].sort(),
    };
  }

  const record = { name: pkg.name, version: pkg.version, notices, parts };
  await writeFile(resolve(root, 'dist', 'parts.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
}

/** @type {import('esbuild').BuildOptions} */
const nodeCommon = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
  // electron is provided by the runtime, never bundle it.
  external: ['electron'],
};

/**
 * The package's entries and the command line, built together. What two of
 * them share is written once, as a chunk in `dist/chunks/`, and every entry
 * that needs it imports that chunk: one copy of the core, so one Markdown
 * reader, one set of accent languages and one of each registry, whichever
 * entries a program imports and in whatever order.
 *
 * One build has one platform. `node` is right for the Node entries and does
 * nothing to the browser-safe ones, since nothing they reach imports a Node
 * module; `pack-check` holds them to that. `process.env.NODE_ENV` is set as
 * a browser build of them set it, so no `process` is left for a page to
 * trip on.
 * @type {import('esbuild').BuildOptions}
 */
const packageEntries = {
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: ['chrome120', 'node22'],
  minify: true,
  sourcemap: packageMaps,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
  // The command line finds Electron at run time, beside it; it is never bundled.
  external: ['electron'],
  outdir: resolve(root, 'dist'),
  chunkNames: 'chunks/[name]-[hash]',
  // The metafile is what `dist/parts.json` is read from, with its paths taken
  // from the repository root wherever the build is started.
  metafile: true,
  absWorkingDir: root,
  plugins: [
    {
      name: 'parts',
      setup(b) {
        b.onEnd((result) => {
          if (!result.metafile) return;
          packageMetafile = result.metafile;
          // A rebuild under --watch rewrites the record; the first build's is
          // written by run(), once the static files are in place.
          if (staticCopied) return writeParts(packageMetafile);
        });
      },
    },
  ],
  entryPoints: [
    // The main entry: the editor, the engine and the language, browser-safe.
    { in: resolve(root, 'src/api/index.ts'), out: 'api/index' },
    // `/node`: the script API's file half - a script read from disk, a drawing
    // written out as files - with the composition's file helpers beside it.
    { in: resolve(root, 'src/api/node.ts'), out: 'node/index' },
    // `/markdown`: marked's lexer and highlight.js, registered with the core
    // the other entries share.
    { in: resolve(root, 'src/markdown/index.ts'), out: 'markdown/index' },
    // `/graphic-design`: the composition API and nothing else, browser-safe,
    // so a page that composes a graphic loads the composition's chunks and
    // not the editor, the document model or the code themes besides.
    { in: resolve(root, 'src/core/graphic-design/index.ts'), out: 'graphic-design/index' },
    // `/sharpen` and `/engines`: the auto-sharpen engine alone, and the
    // engines the tools stand on with the page model they edit, each
    // browser-safe and each without the editor, for the same reason.
    { in: resolve(root, 'src/sharpen/index.ts'), out: 'sharpen/index' },
    { in: resolve(root, 'src/core/engines.ts'), out: 'engines/index' },
    // `/graphic-design/files`: `writeComposition` and `imageDataUrl` import
    // `node:fs`, so they are an entry of their own rather than part of the
    // browser-safe one.
    { in: resolve(root, 'src/core/graphic-design/files.ts'), out: 'graphic-design/files' },
    // The napkin-sketch command, whose first line is its own hashbang.
    { in: resolve(root, 'src/cli/index.ts'), out: 'cli/index' },
  ],
};

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  packageEntries,
  {
    ...nodeCommon,
    entryPoints: [resolve(root, 'src/main/main.ts')],
    outfile: resolve(root, 'dist/main/main.js'),
  },
  {
    ...nodeCommon,
    entryPoints: [resolve(root, 'src/main/preload.ts')],
    outfile: resolve(root, 'dist/main/preload.js'),
  },
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    minify: true,
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/renderer/renderer.ts')],
    outfile: resolve(root, 'dist/renderer/renderer.js'),
  },
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    minify: true,
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/renderer/settings.ts')],
    outfile: resolve(root, 'dist/renderer/settings.js'),
  },
];

/**
 * The languages beyond highlight.js's common set, each a script of its own in
 * `dist/renderer/accents/` - minified, as the page loads one only when the
 * language is installed - that hands its definition to
 * `globalThis.napkinAccents.register`. The page's content security policy lets
 * a script of the app's own run, from `dist/` and from inside the asar alike.
 */
async function buildAccentLanguages() {
  const catalog = JSON.parse(await readFile(resolve(root, 'src/core/type/accent-languages.json'), 'utf8'));
  const ids = catalog.filter((language) => !language.common).map((language) => language.id);
  await build({
    entryPoints: ids.map((id) => ({ in: `accent:${id}`, out: id })),
    outdir: resolve(root, 'dist/renderer/accents'),
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    minify: true,
    logLevel: 'warning',
    plugins: [
      {
        name: 'accent-languages',
        setup(b) {
          b.onResolve({ filter: /^accent:/ }, (args) => ({ path: args.path.slice('accent:'.length), namespace: 'accent' }));
          b.onLoad({ filter: /.*/, namespace: 'accent' }, (args) => ({
            contents: `import definition from 'highlight.js/lib/languages/${args.path}';\nglobalThis.napkinAccents?.register(${JSON.stringify(args.path)}, definition);\n`,
            resolveDir: root,
            loader: 'js',
          }));
        },
      },
    ],
  });
}

async function copyStatic() {
  await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
  await cp(resolve(root, 'src/renderer/index.html'), resolve(root, 'dist/renderer/index.html'));
  await cp(resolve(root, 'src/renderer/settings.html'), resolve(root, 'dist/renderer/settings.html'));
  await cp(resolve(root, 'src/renderer/styles.css'), resolve(root, 'dist/renderer/styles.css'));

  // The app icon is the one kept in assets/, copied as it is: the build never
  // draws, resizes or writes into assets/, so whatever icon is there is the
  // one the window and the installers use.
  await mkdir(resolve(root, 'dist/assets'), { recursive: true });
  if (existsSync(resolve(root, 'assets/icon.png'))) {
    await cp(resolve(root, 'assets/icon.png'), resolve(root, 'dist/assets/icon.png'));
  }
  if (existsSync(resolve(root, 'assets/icon.svg'))) {
    await cp(resolve(root, 'assets/icon.svg'), resolve(root, 'dist/assets/icon.svg'));
  }
  // Renderer artwork lives beside the source it belongs to. The stylesheet
  // reaches it as ../assets from dist/renderer, so the whole folder is copied
  // rather than named file by file - a new cursor or glyph then needs no
  // build change to ship.
  if (existsSync(resolve(root, 'src/assets'))) {
    await cp(resolve(root, 'src/assets'), resolve(root, 'dist/assets'), { recursive: true });
  }

  // The package's bundles are ESM, but the package is `"type": "commonjs"`,
  // so Node reads a bare `.js` in them as CommonJS and refuses to import it.
  // A one-key package.json in each folder scopes it to ESM, which is what
  // makes `import('@isocialpractice/napkin-sketch')` work from a plain Node
  // script - the graphic-designer helper's media analysis is one such script -
  // and what lets the command line run as the ES module it is.
  for (const folder of ['dist/api', 'dist/graphic-design', 'dist/sharpen', 'dist/engines', 'dist/node', 'dist/markdown', 'dist/cli', 'dist/chunks']) {
    await mkdir(resolve(root, folder), { recursive: true });
    await writeFile(resolve(root, folder, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf-8');
  }
}

async function run() {
  if (existsSync(resolve(root, 'dist'))) {
    await rm(resolve(root, 'dist'), { recursive: true, force: true });
  }

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await buildAccentLanguages();
    await copyStatic();
    staticCopied = true;
    if (packageMetafile) await writeParts(packageMetafile);
    console.log('napkin-sketch: watching for changes...');
  } else {
    await Promise.all([...configs.map((c) => build(c)), buildAccentLanguages()]);
    await copyStatic();
    staticCopied = true;
    await writeParts(packageMetafile);
    console.log('napkin-sketch: build complete.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
