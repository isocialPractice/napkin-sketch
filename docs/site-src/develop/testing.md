# Testing

Unit tests use Node's built-in test runner. The TypeScript sources are bundled
on the fly by esbuild, so no separate compile step is needed.

```bash
npm test
npm run test:graphic-design-api   # the design-language pipeline, end to end
```

Suites cover the geometry utilities, the auto-sharpen classifier and transforms,
`.skbk` serialization/normalization (including the version 1 → 2 layer
migration), the layer-aware SVG exporter, the PDF writer and its import
round-trip, the CLI argument parser, the launch contract, the animation cycle
and form helpers, the measurement units, the rotate transforms, the mirror rules
and the store's edit transaction, the stroke profiles - including a check that
the outline an export writes covers exactly the pixels the canvas paints, on
shapes chosen to break one - Mesh Warp's mesh, its as-rigid-as-possible solve and the
map that carries art onto it, the graphic-design API, and a regression suite pinning the defects earlier source
reviews found — so a fix that was hard to see cannot quietly come undone.

Two suites hold contracts rather than behaviour. `test/headless.test.ts`
installs a DOM that exists and throws on first touch, then runs every entry
point documented as DOM-free under it: the SVG, PDF and Illustrator script
writers, the `.skbk` round trip, the sharpen engine, the path-data parser, both composition
renderers, a napkin script run end to end with its shape library, and the
render calls writing a page to every format. A stray
`document.` fails there by name, where elsewhere it would pass because Node
has no document. `test/script-instructions.test.ts` holds the instruction
language's verb table to its types, field by field.

The language's own suites read scripts (`test/script-parse.test.ts`), run
expressions (`test/script-expr.test.ts`), and write scripts back and check them
as JSON (`test/script-format.test.ts`), including a round trip of every verb's
example. `test/script-evaluate.test.ts` runs scripts into sketch books and
checks the pages, the layer tree and each mark's anchors and paint, down to the
budget stopping a run and one script giving the same book twice.
`test/script-geometry.test.ts` holds the geometry to its rules: a circle's
handles, an arc against the importer's reading of the same SVG arc, a rounded
polygon's fillets, a curve through points, every library shape filling its
box, and the committed shape library matching its assets.
`test/script-rough.test.ts` holds the hand-drawn pass to its measurements:
drift within reach, smooth joins kept smooth, bows growing with the square
root of a segment's length, overshoot along the tangents, the fill drawn apart
from its line, and one script and seed giving the same drawing every run.
`test/script-text.test.ts` covers text and media: text items aligned on the
built-in face's measure, lettering drawn as marks, images sized from their
own headers, and documents copied in with `use`. The assets and documents
those examples name come from `test/helpers/script-fixtures.ts`.
`test/link.test.ts` covers linked files: the model keeps a link, the SVG
writers keep the reference, the rasterizer draws the file only through the
host's resolver and draws the placeholder otherwise, and a host reads only
inside the folder it names.
`test/sketch-composition.test.ts` covers the PNG's road from a sketch: each
kind of mark lowered into the composition model, the gradients, erase shapes
and one-picture groups the model gained for it, and, wherever `rsvg-convert`
is installed, the PNG against the SVG as `rsvg-convert` draws it, agreeing on
at least 99% of the ink of every fixture in `test/imports/`, which
`test/helpers/fixture-sketch.ts` reads with no DOM.
`test/script-render.test.ts` covers the render calls: every format from one
call, the ink box and its pad, a registration box every page shares, the
`.skbk` round trip, and the PDF's colors, outlines, dashes and text boxes.
`test/script-files.test.ts` covers `napkin-sketch/node` on a real file
system: scripts read from files, assets and documents loaded by name, links
read beside the script and refused outside it, a file a format and a file a
page, names that cannot leave the output folder, `strict`, and files written
whole. `test/api-surface.test.ts` holds both entries to lists: every name the
barrel exported before the language joined it is still there, and the
language and the Node calls are exported where the package map says.
`test/cli-draw.test.ts` runs the command line's `draw`, `check`, `render` and
`verbs` in memory - files, standard input, the JSON report, every exit code -
and then the built CLI as a process, with `electron` made impossible to load.
`test/cli-examples.test.ts` runs the callers in `docs/api/cli/examples/`
through `sh`, `cmd`, Node, Python and a C compiler, each where it is
installed.
`test/effects.test.ts` holds each effect to the pixels its matrix gives, to
SVG's order of a filter, a mask, a clip and an opacity, and to what
`rsvg-convert` draws from the SVG, and `test/script-effects.test.ts` holds
the `effect` verb to what it attaches to; `test/gui/check-effects.mjs` finds
them painted in the app, read back from napkin's own SVG, and drawn by the
composition canvas painter.
`test/illustrator.test.ts` runs each Illustrator script the writer makes
against a stand-in for Illustrator's scripting objects, which holds it to
Illustrator's rules - an item added goes on top, nothing is drawn on a hidden
or locked layer, an SVG will not place - and reads back the layer tree, the
anchors and handles, the paint, the text, the images and the links it built;
it also holds the script to ES3 and ASCII, and the interop page's excerpt to
the writer.
`test/ai-bridge.test.ts` holds the form a script helper reads, the script read
back from what it saved or printed, and the loop that sends a script with
errors back once, against a stand-in for the helper; `test/cli-draw.test.ts`
runs `draw --prompt` with a stand-in AI tool as a real process, through every
way it ends; and `test/ai-helper.test.ts` checks the `napkin-script` skill's
three scripts and the three registries.
`test/script-animation.test.ts` draws the figure in `test/imports/walk.svg`,
read with no DOM by `test/helpers/walk-figure.ts`, through the measured
cycles: eight pages sharing one box, each limb turned about the joint it has
in the source, a looping cycle closing on the source pose, the pacing and the
mirroring, and what cannot be drawn said as much; `test/cli-draw.test.ts`
runs `render --animate`, and `test/gui/check-measured-frames.mjs` presses
**Draw measured frames** in the app, draws the frames and undoes them.
`test/script-docs.test.ts` holds the pages under `docs/api/` and the three
hubs at the root to the code: every script on a page must read, every error
example must produce the codes it names, every JSON script must validate, and
every generated table must be current. `test/api-docs.test.ts` holds their
shape: every file `npm run api-docs` writes must be what it writes today,
every category has its three pages, each kind of page keeps its headings and
its length, every page links to its hub and its siblings in its first lines,
every link to a heading reaches one, and the object form's schema accepts
every verb's example and refuses what the object form refuses.

The menus are held to the menus they replaced. `test/menu-registry.test.ts`
writes out the File, Edit and View menus and the right-click lists as they
stood before 1.0.0-alpha.4.5.0, applies each deliberate change in a named
step, and requires what the registry generates to match exactly. It spells
out the whole menu bar, all nine menus, row for row, and holds the two menu
files to their own rules: every tool has a type a menu can place it by, every
shortcut is written one way and held by one tool. `test/chords.test.ts` covers
how a shortcut is read, shown and matched against a keypress on any layout,
and `test/menu-overrides.test.ts` the user's two files: what they may change,
what is refused with a sentence, and that the shipped files are never written.
`test/menu-dispatch.test.ts` holds each place a row becomes an action - the
native menu's clicks, the window's command table, the right-click items - to
the id the row carries, and `npm run gui-check -- context-menus` reads the
menu bar back from Electron and drives every right-click menu and dropdown in
the built app. `test/keys.test.ts` sends every shipped shortcut through the
key lookup, with the rules the old key handler kept - Shift and a letter
still mean the letter when no shortcut uses the Shift form; a key a role row
holds is left to Electron - and `test/menu-docs.test.ts` holds the menus
table and the shortcut tables of the Menus and shortcuts page and the
cheatsheet to what `npm run menu-docs` writes. `npm run gui-check --
shortcuts` runs the app with a shortcuts file of its own, put in the
user-data folder it hands the app (`NAPKIN_USER_DATA`), and presses the
keys. `test/config-dialog.test.ts` covers the configuration popup the menu
editors are built on: its search, its filters, what a shortcut cell says
about a chord, and edits held apart from the rows until Accept. `npm run
gui-check -- config-dialog` opens the popup in the built app with a spec of
its own, through a `window.napkinCheck` hook the page puts up only when the
app is started for a check (`NAPKIN_GUI_CHECK=1`, which `test/gui/cdp.mjs`
sets), then searches, filters, captures chords and accepts with real keys
and clicks. `test/menu-editors.test.ts` covers Edit Keyboard Shortcuts: the
rows it lists, what a shortcut cell says about a chord, how Accept takes a
chord from the tool that held it, and what that saves. `npm run gui-check
-- shortcuts-dialog` starts the app on a shortcuts file that is not JSON,
then saves a shortcut, sees it take effect, warns, refuses, resets to the
defaults and cancels, reading the user's file after each step. The same
file covers Edit Tool Types, and `test/menu-registry.test.ts` holds where
the editor says a type is listed to where the menus show a tool of that
type, for every tool. `npm run gui-check -- tool-types-dialog` moves Rotate
to the clipboard's type, finds it in the menu bar's Edit menu and the
layers panel's right-click menu, runs it from the canvas's, then resets
it, puts a toolbar tool in the Transform menu and cancels a change.

`npm run test:graphic-design-api` is the second one, and it measures a
different thing: not compositions but the road to them. It reads the reference
asset, generates a skill from it into the AI tool's real skills folder, points
that skill at the symlinked brand assets in
`test/graphic-design-api/test-assets/` through a `resources.md`, registers what
a bare request means, and draws graphics that carry them into
`test/graphic-design-api/generated-graphics/`. Every step is a production entry
point invoked as the documentation says to invoke it, so a pass means a clone
following [the AI helpers' quickstart](../../api/ai/QUICKSTART.md) works. It
needs a file system, a symlinked folder and a generated script, none of which a
bundled `node:test` suite can exercise honestly.

It also **leaves the tool wired up**, which is the point of running it rather
than only of passing it: afterwards `/graphic-design-api generate` draws, with
nothing to configure. The one thing it does that interactive use does not is
answer the overwrite prompt in advance - a script cannot be asked.

The graphic-design suite draws real files: it renders a reference composition
and several variations of it to both formats, writes them to `.tmp/`, and
deletes them on the way out, so a run leaves the working tree as it found it.
The one thing a graphics test cannot assert is whether the picture looks right,
so there is a flag for looking:

```bash
npm test -- --keep-graphics   # keep the generated SVGs and PNGs, and print where
```

The golden scripts are the suite a person rewrites on purpose. Each script in
`test/scripts/` is drawn to SVG and compared byte for byte with the file beside
it, twice in one process and once in a fresh one, so a change to what the
language draws fails until someone has looked at it and asked for it:

```bash
npm test -- --update-golden   # rewrite test/scripts/*.svg from what the scripts draw today
```

The script writer runs the other way and is held to the same bytes.
`test/script-writer.test.ts` writes every SVG fixture and every page of every
golden script as napkin script, draws that script back, and requires the same
SVG, byte for byte. The one difference it allows is a filled shape the source
left open, which the writer closes, since a script fills only a closed path.
The formatted text of the triangle fixture is kept in
`test/scripts/written/mirror-triangle.napkin`, which `--update-golden` also
rewrites, so a change in the writer's style is a change someone looked at.

`test/script-generate.test.ts` covers Automate > Generate Script with no
window: a file read as a page has the tree File > Import builds, since both
use one routine; a PDF's pages, written as a book, draw back as they were
read, the walking figure's to the same pixels; a picture's two scripts, the
link and the embedded one, run; and the selected layers are written with the
groups above them, on the page kept or fitted. `npm run gui-check --
generate-script` picks two parts of an imported figure in the Layers panel,
writes them, fits the page and opens it, then writes an SVG and a PNG from
their files, embeds, copies, and closes the dialog with Escape and Cancel.

`test/history-diff.test.ts` covers what Track History records of a step,
on pages built by hand: marks added, removed and changed, the paint order,
and each thing that can happen to a layer row. `test/history-tracker.test.ts`
drives the store's history hook - a drag is one step, a transaction is one
on commit and none on rollback, undo and redo are steps of their own, a page
change closes the step on its page, a new book starts again - then the names
a step is given from the real menu files, and the limit. `npm run gui-check
-- track-history` turns tracking on from the menu bar, draws two strokes
with real pointer events, rotates one, undoes, reads the four steps back,
and uses the Automate section of Verbose Settings, in its own window, to set
the limit and turn tracking off. `test/history-script.test.ts` records
sessions through the store and plays them back with steps left out: every
step ticked draws the page as it is, a removal left out brings its mark
back, an addition left out drops its mark and the changes to it, and a
change left out takes back only what it changed. `npm run gui-check --
history-script` draws two strokes, turns one, unticks the turn in the
popup, and opens the page each script draws.

`test/site.test.ts` holds the documentation site to its sources: every page
is what `npm run site` writes today; the top bar, menu and footer are one
copy on every page once each link is read from its page's folder; every
relative link reaches a file the site publishes and every `#anchor` a
heading; the stylesheet's colors are those in `DESIGN_LANGUAGE.md`; and the
Markdown converter renders what the pages use as GitHub does. It also runs
the napkin examples in `docs/site-src/`. `test/docs-window.test.ts` covers
the documentation window's decisions with no Electron: where the pages are
read from, which names reach a page, what a Help row does when they are
missing, where a link in them may go, and its keys. `npm run gui-check --
help-menu` opens **Help > Verbose**, follows a page link, goes back and
forward with Alt and the arrows, sends a web link to the browser, shows each
Tool Types quickstart in the same window, and closes it with Ctrl+W.

`npm run pack-check` is the install, checked: it packs the package, installs
the tarball into an empty folder - where no Electron arrives, since it is a
development dependency - and draws from it with `napkin-sketch draw -` and
with both entries imported by name. Build and emit the types first; it packs
what `dist/` holds.

Some defects can only be seen in the running app: the SVG importer needs a
DOM, the color picker is a native popup, and a paint that went missing shows up
only as pixels. `npm run gui-check` drives the built app for those. It
launches Electron with the DevTools protocol open, runs each `check-*.mjs` in
`test/gui/` in turn, and asserts on what the page shows (canvas pixels, the
toast, the layer rows) rather than on the code behind it:

```bash
npm run build                    # the checks drive dist/, so build first
npm run gui-check                # every check, one app launch each
npm run gui-check -- gradient    # only the checks whose names match
```

A check opens a new, unsaved sketch with a fixture from `test/imports/`
imported, or a book it writes to a temporary folder, so it leaves the working
tree as it found it. The measured-frames check needs Animation Mode installed
and says so when it is not; it saves its frames to `animations/` under names
no one else's frames have, and removes them after. The window does appear on
screen while a check runs.

Each launch gets a user-data folder of its own, made for it and removed after
it, so a check starts from the default settings and leaves none behind - the
app run from the checkout by hand keeps its own in `%APPDATA%/Electron`, and
a check never touches it. A check that needs a file there first, such as a
`shortcuts.json`, makes the folder itself and passes it. The app is launched
with Chromium's occlusion tracking off, so a check window that opens behind
another still draws, and a link a check sends to the browser is recorded
rather than opened. One check runs alone with `node --experimental-websocket
test/gui/check-<name>.mjs`, which Node 21 needs for `WebSocket`.
