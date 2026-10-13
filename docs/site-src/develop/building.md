# Building and packaging

## Development

```bash
npm run build        # Bundle CLI, main, preload, renderer, and the embed API
npm run build:watch  # Rebuild on change
npm run build:types  # Emit .d.ts declarations for the embeddable API
npm run typecheck    # Type-check without emitting
npm test             # Run the unit test suites
npm run gui-check    # Drive the built app and check what it shows (build first)
npm run pack-check   # Pack and install both packages: draw with the API's, find the app's
npm run pack-gui     # Lay out the desktop app's npm package in release/gui/
npm run start        # Build, then launch a new sketch
npm run clean        # Remove dist/

# Linux, development only: launch without Chromium's sandbox, for a system that
# blocks it (see Troubleshooting install errors on the install page)
npm start -- --no-sandbox

# Print the layer tree an SVG would import as (runs the real importer in a
# hidden Electron window; no GUI needed)
npm run import-tree -- test/imports/applied_layer_names.svg

# Rebuild the napkin script shape library from its SVG assets; with -- --check
# it only compares, and fails when the committed library is out of date
npm run shape-library

# Rewrite the API documentation's generated parts - the verb, command and
# exit code tables, the object form's schema and docs/api/INDEX.json; with
# -- --check it only compares, and fails when any is out of date
npm run api-docs

# Rewrite the shortcut tables - the Menus and shortcuts page's, and Tools in
# the cheatsheet - from src/core/menu/; with -- --check it only compares
npm run menu-docs

# Rewrite the documentation site under docs/ from docs/site-src/ and the API
# pages, and fill the tables in docs/site-src/; with -- --check it only compares
npm run site

# Archive checked TODO.md items into its "## Complete" section (kept at the
# bottom of the file), noting which section each came from; safe to re-run
npm run todo
```

The build uses **esbuild** to bundle the app's Node-side code (CommonJS) and
its renderer (browser IIFE), and the package's entries with the command line
as ES modules built together, so the code they share is written once, in
`dist/chunks/`, and loaded once. Each bundle is minified; `tsc` is used only
for type-checking and for emitting the public type declarations.
The source maps stay in the clone: the app's bundles link theirs, and the
package's carry no link, since the package leaves the maps out.

Building from source needs **Node.js 22.12 or newer**, which Electron's
installer asks for. The published package, which never installs Electron,
asks for the same version, so a clone and an install need one Node.

## Continuous checks

Two files under `.github/` keep the repository checked once they are on
`main`:

- **The Check workflow** (`.github/workflows/ci.yml`) runs on every pull
  request and every push to `main`, on Linux, macOS and Windows: a clean
  `npm install`, `npm run typecheck`, `npm run build` and `npm test`. The clean
  install on each system is where a broken Electron download shows. `npm test`
  fails while `docs/` is behind its sources, so it checks the site too. The
  GUI checks need a display, and stay a local step.
- **Dependabot** (`.github/dependabot.yml`) proposes upgrades as pull requests,
  weekly: npm packages, with Electron and electron-builder grouped into one
  pull request, and the GitHub Actions the workflows use. No lockfile is
  committed, so it raises a pull request only for a release outside a range
  in `package.json` - a new major version, or any release of a package pinned
  exactly. Patch and minor releases inside a range arrive with the next
  `npm install`.

## Packaging a desktop installer

napkin-sketch builds native installers with **electron-builder** (configured in
`package.json`).

```bash
npm run build      # bundle into dist/
npm run dist       # build an installer for the current OS
npm run dist:win   # Windows NSIS installer (Start-menu + desktop shortcut)
```

The Windows NSIS installer registers a Start-menu entry and desktop shortcut
named **Napkin Sketch** and lets the user choose the install directory.

The installer carries the app's bundles without their source maps or
declarations, and Electron with its English locale only, compressed at
electron-builder's maximum (`build` in `package.json`). The Windows installer
is about 100 MB, nearly all of it Electron: the app's own bundles are under
3 MB of it.

### The app's npm package

The desktop app is published to npm too, as
`@isocialpractice/napkin-sketch-gui`, which `napkin-sketch --install-gui`
installs beside the command line. `npm run pack-gui` lays it out in
`release/gui/` from what the build and the site wrote:

```bash
npm run build
npm run site
npm run pack-gui                       # release/gui/
cd release/gui && npm pack --dry-run   # what would go to npm
```

It holds the main process, the window and the manual, with Electron as its
one dependency at the range in this repository's `devDependencies`, and the
clone's version, which is the version `--install-gui` asks npm for.
`dist/main/package.json` names the app `napkin-sketch`, and the command line
starts Electron on that folder, so the app from npm keeps its settings in a
`napkin-sketch` folder, as the installers' app does. Every release publishes
it from `release/gui/` after the API's package and at the same version, since
`--install-gui` asks npm for the app at the command's own version: an API
release without the app's leaves that command nothing to install.
`npm run pack-check` lays it out, packs it and installs it as part of its
check.

### App icon

`assets/icon.png` is the app icon, used as it is: the build copies it and
never draws or resizes one, so the window and every installer show whatever
icon that file holds. Keep it a square PNG, 1024 x 1024, exported from
`assets/icon.svg` with the artwork centred on a transparent canvas.
electron-builder makes the Windows `.ico` and the macOS `.icns` from it, and
needs at least 512 x 512 for macOS; `npm test` checks that it is square and
at least that size.

## Every npm script

<!-- npm-scripts:start -->
| Script | Runs |
| --- | --- |
| `npm run clean` | `node scripts/clean.mjs` |
| `npm run build` | `node scripts/build.mjs` |
| `npm run build:watch` | `node scripts/build.mjs --watch` |
| `npm run build:types` | `tsc -p tsconfig.types.json` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | `node scripts/test.mjs` |
| `npm run test:graphic-design-api` | `node scripts/test-graphic-design-api.mjs` |
| `npm run import-tree` | `node scripts/import-tree.mjs` |
| `npm run gui-check` | `node --experimental-websocket test/gui/run.mjs` |
| `npm run todo` | `node scripts/todo.mjs` |
| `npm run wireframe-cycles` | `node scripts/wireframe-cycles.mjs` |
| `npm run shape-library` | `node scripts/shape-library.mjs` |
| `npm run api-docs` | `node scripts/api-docs.mjs` |
| `npm run menu-docs` | `node scripts/menu-docs.mjs` |
| `npm run accent-languages` | `node scripts/accent-languages.mjs` |
| `npm run site` | `node scripts/site.mjs` |
| `npm run pack-check` | `node scripts/pack-check.mjs` |
| `npm run pack-gui` | `node scripts/pack-gui.mjs` |
| `npm run illustrated-frames` | `node scripts/illustrated-frames.mjs` |
| `npm run frame-preview` | `node scripts/frame-preview.mjs` |
| `npm run ai-helper` | `node scripts/install-ai-helper.mjs` |
| `npm run animation-mode` | `node scripts/animation-mode.mjs` |
| `npm run postinstall` | `node scripts/install-ai-helper.mjs --on-clone` |
| `npm run start` | `npm run build && node dist/cli/index.js --new` |
| `npm run dist` | `npm run build && electron-builder` |
| `npm run dist:win` | `npm run build && electron-builder --win nsis` |
| `npm run dist:mac` | `npm run build && electron-builder --mac dmg` |
| `npm run dist:linux` | `npm run build && electron-builder --linux AppImage` |
| `npm run prepublishOnly` | `npm run build && npm run build:types` |
<!-- npm-scripts:end -->
