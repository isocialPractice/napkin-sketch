// Build script for napkin-sketch using esbuild.
// Bundles the CLI, Electron main + preload (Node/CommonJS), and the
// renderer (browser/IIFE), then copies static renderer assets to dist/.

import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const nodeCommon = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  // electron is provided by the runtime, never bundle it.
  external: ['electron'],
};

/**
 * `napkin-sketch/markdown` registers its lexer with the API a program imports:
 * it imports `../api/index.js` - beside it in `dist/` as in `src/` - rather
 * than bundling a second copy of the API, whose lexer would be another's.
 * @type {import('esbuild').Plugin}
 */
const apiExternal = {
  name: 'api-external',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/api\/index\.js$/ }, () => ({ path: '../api/index.js', external: true }));
  },
};

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  {
    ...nodeCommon,
    entryPoints: [resolve(root, 'src/cli/index.ts')],
    outfile: resolve(root, 'dist/cli/index.js'),
    banner: { js: '#!/usr/bin/env node' },
  },
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
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/renderer/settings.ts')],
    outfile: resolve(root, 'dist/renderer/settings.js'),
  },
  // Embeddable API as an ESM module for bundlers (website / VS Code webview).
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/api/index.ts')],
    outfile: resolve(root, 'dist/api/index.js'),
  },
  // The Node-only file helpers, as their own ESM module.
  //
  // `writeComposition` and `imageDataUrl` import `node:fs`, so they cannot join
  // the browser bundle above - and a documented import has to be a real one, so
  // they are built here rather than left as source only a clone could reach.
  {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/core/graphic-design/files.ts')],
    outfile: resolve(root, 'dist/graphic-design/files.js'),
  },
  // `napkin-sketch/node`: the script API's file half - a script read from
  // disk, a drawing written out as files - with the composition's file
  // helpers beside it, as a Node ESM module of its own for the same reason.
  {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/api/node.ts')],
    outfile: resolve(root, 'dist/node/index.js'),
  },
  // `napkin-sketch/markdown`: marked's lexer for Markdown Flow, registered with
  // the API above when imported - marked bundled in, the API imported.
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    plugins: [apiExternal],
    entryPoints: [resolve(root, 'src/markdown/index.ts')],
    outfile: resolve(root, 'dist/markdown/index.js'),
  },
  // Embeddable API as a global IIFE for <script> tags (WordPress / plain HTML).
  {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    globalName: 'napkin',
    sourcemap: true,
    logLevel: 'info',
    entryPoints: [resolve(root, 'src/api/index.ts')],
    outfile: resolve(root, 'dist/embed/napkin-sketch.js'),
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

  // Generate the app icon (pure Node, no native deps) then copy assets.
  await import(pathToFileURL(resolve(root, 'scripts/make-icon.mjs')).href);
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

  // `dist/api/index.js` is ESM, but the package is `"type": "commonjs"`, so
  // Node reads a bare `.js` there as CommonJS and refuses to import it. A
  // one-key package.json beside the bundle scopes that folder to ESM, which is
  // what makes `import('napkin-sketch')` work from a plain Node script - the
  // graphic-designer helper's media analysis is one such script.
  await mkdir(resolve(root, 'dist/api'), { recursive: true });
  await writeFile(resolve(root, 'dist/api/package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf-8');

  // Same reason, for the two Node-only entries and the Markdown reader.
  for (const folder of ['dist/graphic-design', 'dist/node', 'dist/markdown']) {
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
    console.log('napkin-sketch: watching for changes...');
  } else {
    await Promise.all([...configs.map((c) => build(c)), buildAccentLanguages()]);
    await copyStatic();
    console.log('napkin-sketch: build complete.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
