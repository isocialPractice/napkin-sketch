# TODO

Roadmap for **napkin-sketch**, grouped by semantic-version impact. Items are
aspirational and unordered within each group.

The file has two halves. **Current** through **Chores** is a working inbox -
what has been noticed but not yet committed to a release - and everything from
**Resolve Issues** down is the version-impact roadmap. An item graduates from
the inbox into a roadmap section once it is scheduled.

## Current

The active queue. Five entries are patch-sized and carried over from earlier
releases; each names the group it came from, so an item that grows can be moved
back without losing where it started. The last is the documentation site's
deployment check, which the agent note below it carries to the run that can
make it.

- [ ] **Text editor UX**: commit on `Esc`, keep caret styling in sync with the
  selected font size, and reposition on window resize.
  - From: Patch
- [ ] **Icon rasterization**: ship multi-resolution `.ico`/`.icns` instead of a
  single PNG.
  - From: Patch
- [ ] **More tests**: cover the renderer store (undo/redo, pages, selection) and the
  embeddable `NapkinSketch` editor via a DOM test environment.
  - From: Patch
- [x] **PARTLY DONE (1.0.0-alpha.4.3.0)** - **Scripted GUI checks**: the menu bugs in
  1.0.0-alpha.4.1.0 were only findable by driving the running app - synthetic OS
  cursor moves were too coarse to tell "the panel closed" from "the pointer
  missed it". Launching Electron with `--remote-debugging-port` and
  dispatching real pointer events over the DevTools protocol worked well and
  can read the DOM back. `npm run gui-check` now exists: `test/gui/` holds the
  driver and a runner that executes each `check-*.mjs` in turn. There are
  seven checks: gradient import; the custom color picker and the Width slider
  reaching a selection (select all, change it, undo); Mirror; Stroke Profiles,
  drawn and imported; and Mesh Warp, with real pointer drags. **What it does
  not cover yet** is most of the original list - menus, panel toggles and page
  flows. The scaffolding was the expensive half and it is done; each further
  check is a file.
  - 1.0.0-alpha.4.5.0 added nine: the menus (the menu bar and every
    right-click menu, which drives the View menu's panel toggles), the
    shortcuts, the configuration popup, both menu editors, Generate Script,
    Track History, From Session History and the Help menu. There are twenty
    now, each run in a user-data folder of its own; page flows are still not
    covered.
  - 1.0.0-alpha.4.6.0 added seventeen: the held keys, select accuracy, zoom,
    freehand, lines, the Vector Path, the Eraser, the Shape Eraser, the
    Brush, fill and stroke, the Wipe Stacks, the Shape Stacker, Split,
    clipping masks, the Pencil, the Smear and Liquify. There are thirty-seven
    now, and `npm run gui-check -- --background` runs them off the screen,
    with the computer still in use; page flows are still not covered.
  - From: Patch
- [ ] **Docs**: API reference for the embeddable package and a WordPress block
  example.
  - From: Patch
- [ ] **Verify the documentation site deployment**: `.github/workflows/pages.yml`
  deploys `docs/` to https://isocialpractice.github.io/napkin-sketch/ once it
  is pushed and Pages is set to deploy from GitHub Actions. Ask the workflow
  run for the pushed commit whether it succeeded; see the agent note below.
  - From: 1.0.0-alpha.4.5.0, Phase P

## Agent Notes

### Verify the documentation site deployment

For the **Verify the documentation site deployment** item under Current.

- **Commit**: `HEAD at close` on `main`, the newest commit on `main` that
  touches `docs/`. Nothing had been pushed on 2026-09-26: the site, its
  workflow and the rest of 1.0.0-alpha.4.5.0 were uncommitted, and pushing
  is the owner's call.
- **Workflow**: `.github/workflows/pages.yml`, "Deploy the documentation
  site". The global gitignore on the machine that built it ignores `.github/`
  and dotfiles, so commit the workflow and `docs/.nojekyll` with `git add -f`.
- **Pages**: not switched on; `gh api repos/isocialPractice/napkin-sketch/pages`
  answered 404 on 2026-09-26. The account has admin on the repository, so
  `gh api -X POST repos/isocialPractice/napkin-sketch/pages -f build_type=workflow`
  turns it on.
- **URL**: https://isocialpractice.github.io/napkin-sketch/
- **Attempts**: 0
- **When it succeeds**: set `DOCS_SITE_URL` in `src/core/menu/links.ts` to
  `DOCS_SITE_ADDRESS`, which makes **Help > Source Docs** appear; then tick
  the item and drop this note.

## Found Issues

Defects noticed while working and not yet scheduled. Twenty-nine sit here,
and each later entry says where it was found; the first eighteen came six
from 1.0.0-alpha.4.1.0, four from the Animation Mode work, two the 1.0.0-alpha.4.1.2 source
review turned up, one the popup pass found, four from surveying the transform
and export code for the 1.0.0-alpha.4.3.0 feature plan, and one from building its
Stroke Profiles. Three of those were
found only by driving the running app rather than by reading it - an ARIA
attribute reads correctly in the source and is wrong only once something reads
it back, a click that moves what it selects reads as an ordinary drag handler,
and a panel positioned against the wrong box reads the same either way - and
the four in the middle came out of generating frames, where the failures show
up in the artifacts rather than in the code.

Sixteen are open. The thirteen that have been resolved are stamped rather than
deleted, so the record of what was found stays with the record of what fixed
it; the 1.0.0-alpha.4.1.2 source review, including the reasoning behind the calls it
made, is in `reviews/source-code-09-01-2026.log`.

- [x] **RESOLVED (1.0.0-alpha.4.3.0)** - **Undo and redo strip the holes out of compound shapes**:
  `Store.cloneStrokes`, which every history snapshot goes through, copies a
  vector anchor as `{p, hIn, hOut}` and leaves out `move`, the flag that starts
  a new subpath. The sampled `points` keep theirs, so the canvas still looks
  right, but the SVG export writes a stroke from its anchors. A square with a
  square hole exports as `M0 0H20V20H0V0ZM5 5H15V15H5V5Z`; after one move and
  one undo it exports as `M0 0H20V20H0L5 5H15V15H5L0 0Z`, with the hole
  stitched into the outline. A snapshot copies the whole page, so one undo does
  this to every compound shape on it: a letter with a counter, a ring, an
  outlined stroke. `transformImportedLayers`, which places a grid of imports,
  rebuilds anchors the same way, so those arrive already stripped. Both need
  the one line `cloneAnchors` already carries. Mirror Selection and Mesh Warp
  both push history on exactly these shapes, so the feature plan fixes this
  first. (Found by running the store and the exporter in Node on a compound
  shape while surveying the transform code for that plan.) Both copies keep
  `move` now, the snapshot holds its own copy of a gradient too, and
  `test/mirror.test.ts` runs the ring above through move, undo and redo.
- [x] **RESOLVED (1.0.0-alpha.4.3.0)** - **The polyline export ignores subpath breaks**: `pathD` writes a stroke
  with no Bézier anchors as one polyline, a `moveTo` for the first point and a
  `lineTo` for every other, so a stroke whose points carry `move` but that has
  no `vector` exports with its contours joined. The RDP simplification it runs
  first spans the break as well. `setStrokeGeometry` drops `vector` whenever a
  caller passes none, which is how a compound stroke would get there. The PDF
  writer already starts a new subpath at `move`. (Found reading `pathD` in the
  same survey; not yet reproduced through a user action.) Each run between
  breaks is now its own subpath, simplified on its own.
- [x] **RESOLVED (1.0.0-alpha.4.6.0)** - **The Vector Path button's place in the toolbar is not remembered**:
  `DEFAULT_TOOL_ORDER` lists every reorderable tool except `tool-vector`, and
  `normalizeToolOrder` keeps only ids from that list, so wherever the Vector
  Path button is dragged in rearrange mode, the saved order never records it.
  (Found reading the settings code in the same survey; not run.)
  - Fixed in Phase C, which added the Shape Eraser to the same list:
    `tool-vector` is in `DEFAULT_TOOL_ORDER`, and a tool a saved order does
    not know yet goes in after the tool it follows by default, not at the
    end of the list. `test/settings.test.ts` holds both.
- [ ] **Outlines draw at 70% of their width on canvas and export at 100%**:
  `paintStroke` draws every pen-tool mark segment by segment at
  `width * (0.4 + 0.6 * pressure)`. That is right for a stylus, but shapes,
  Vector Path and Curve commits, and every imported outline carry pressure 0.5,
  so all of them draw at 0.7 of their width. The SVG and PDF writers use the
  full width, so an imported `stroke-width="10"` shows as 7 and goes back out
  as 10. A single-point dot has the same mismatch: the canvas scales its
  radius, while the export writes `r = width / 2`. Whether pressure should
  apply to marks that never had any is a design call rather than a one-line
  fix, and it decides what Stroke Profiles' Default has to match. (Found
  reading the painter in the same survey; the arithmetic is unambiguous, not
  measured on screen.) Stroke Profiles, built since, keep the pressure scale
  and export the outline the canvas draws, so a profiled stroke is the same
  width in both; only a Default outline still exports wider than it draws.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **The PDF writer paints a switched-off outline, and prints dashes solid**:
  `sketchesToPdf` strokes every mark's path whatever its `noStroke` says, so a
  fill-only shape gains the outline the canvas and the SVG leave off. It never
  reads `strokeStyle` either, so a dashed or dotted outline prints as a solid
  line. The SVG writer handles both, with `stroke="none"` and
  `stroke-dasharray`. Profiled strokes are the exception: their branch skips a
  switched-off outline and fills dashes already cut from the profile. (Found
  adding that branch while building Stroke Profiles; read in the source, not
  run.)
  - Fixed with the output work, since a script draws both: a switched-off
    outline is left off, and a dashed or dotted line is dashed with the
    pattern the SVG writes. `test/script-render.test.ts` holds both.
- [ ] **`aria-selected` marks only the active layer row**: the layers panel is a
  `role="listbox"` with multi-select, but `renderLayers` sets
  `aria-selected` from `layer.id === active.id` and marks the rest with an
  `is-selected` class instead. A screen reader is told one row is selected when
  several are. (Found by a test probe reading the attribute and seeing one row
  where the panel showed two.)
- [x] **RESOLVED (1.0.0-alpha.4.1.2)** - **A select-tool click leaves a no-op undo
  step**: `onPointerDown` called `store.pushHistory()` as soon as a stroke was
  hit, before any movement, so clicking an element to select it cost an undo
  press later. Driving the app showed the same premature commitment doing
  something worse than that: with no threshold at all, the first pointermove
  after the press moved the element one pixel for one pixel, so a click that
  carried 3px of hand travel left the element 3px from where it had been.
  Selecting something moved it. A press now arms the drag and
  `commitSelectDrag` starts it once the pointer has gone 4 screen pixels,
  which is where the history step, the Alt-drag copy and the first move all
  wait. Below the threshold the gesture is a click and the drawing is left
  exactly as found.
- [x] **RESOLVED (1.0.0-alpha.4.1.2 source review)** - **The CLI inherits
  `ELECTRON_RUN_AS_NODE`**: `launchGui` spawns Electron with
  `env: { ...process.env, ... }`, so a shell that has the variable set (some
  editor and agent terminals do) makes `napkin-sketch` fail at startup with
  `Cannot read properties of undefined (reading 'setAppUserModelId')` -
  Electron runs the main script as plain Node and `require('electron')` returns
  nothing. The key is now deleted from the child's environment; the GUI is
  never meant to run as Node, so there is no case where inheriting it is
  wanted.
- [x] **RESOLVED (1.0.0-alpha.4.1.2)** - **A placed popup was positioned against
  its overlay, not the viewport**: `.dialog-floating.is-placed
  .export-dialog-inner` was `position: absolute`, so the coordinates the popup
  manager drags, parks and clamps in were only true for the palettes whose
  overlay fills the window. The corner variants are anchored bottom-right and
  are only as wide as the panel, so pressing the Page Settings title threw it
  1471px right and 813px down, out of the window. Placed panels are `fixed`
  now. (Found by driving the app; the source reads correctly either way, which
  is why it survived a review.)
- [ ] **Clipboard shortcuts on macOS**: the Edit menu's clipboard items use
  `registerAccelerator: false` so the keypress reaches the page, but that flag
  is Windows/Linux only. On macOS the accelerator registers, so `Cmd+C` inside
  the layer-rename box or a property field would copy the drawing instead of
  the text. Needs either `role`-based items that swap in while a text field
  has focus, or a `before-input-event` guard. Untested here - this machine is
  Windows.
- [ ] **Drag-reorder and button-reorder differ**: dragging a row uses
  `reorderLayer` (one row, re-parents on drop) while the move buttons use
  `moveLayers` (whole selection, siblings only). Dragging a multi-row
  selection still moves just the dragged row.
- [ ] **Repeated pastes make identical names**: pasting the same group twice
  gives two rows called `X - Copy`. Editors usually uniquify the second
  (`X - Copy 2`); the panel has no counter for this yet.
- [ ] **Generated frames share no registration box**: each frame is cropped to
  its own ink and carries the strip offset it was placed at, so `walk_1` came
  out 43.99 wide against `walk_2`'s 74.04 and their viewBoxes start at
  different origins. Every frame is a clean sprite on its own; played as a
  sequence they do not line up. See the shared-box idea below for the fix that
  trades the tight crop away.
  - The render calls have the mechanism now: `registration` cuts every page
    of a book to one box, for a script's frames. Animation Mode's own frame
    export still crops each frame to its ink.
- [ ] **A helper that revises after saving loses the revision**: the app takes
  the output file the moment it holds a complete document and kills the helper,
  so a run that saves a draft and then improves it delivers the draft. The
  duplicate check catches the worst version of this (a copy of the source taken
  before any posing) but not a first attempt that the helper meant to replace.
- [ ] **A global npm install cannot launch the GUI**: `electron` had to move to
  `devDependencies` for electron-builder, so `npm install -g napkin-sketch`
  leaves the CLI's `require('electron')` unresolved and `napkin-sketch --new`
  fails with the "Run npm install first" message. The library exports are fine;
  only the desktop CLI is affected. An optional peer dependency would turn the
  failure into an install-time warning without upsetting the packager.
  - The drawing commands - `draw`, `check`, `render` and `verbs` - work on
    such an install, since they never load Electron. Opening the window still
    needs it.
  - Checked for 1.0.0-alpha.4.4.0: `npm run pack-check` installs the packed
    tarball into an empty folder, where no `electron` arrives, and draws an
    SVG there from standard input with `napkin-sketch draw -`.
- [ ] **The sign-in launcher is only proven on Windows**: opening a terminal for
  the AI tool uses `cmd /c start` on Windows, `osascript` on macOS, and
  `x-terminal-emulator || xterm` elsewhere. Only the first has been run. The
  auth-failure detection behind it has never been exercised against a genuinely
  signed-out tool either - the patterns are unit-tested against the wording
  those CLIs use, not against a live refusal.
- [x] **RESOLVED (1.0.0-alpha.4.1.2 source review)** - **`defaultSequenceFrames`
  counts steps, not skeletons**: the doc said "the number of skeletons its
  cycle was measured from" while the function returned the step count, and the
  generated table put a 6-entry array under a "7 frames" heading. Working it
  through showed the number was right and only the words were wrong: a run
  draws the frames *after* an existing one, so walk (8 skeletons, 8 steps)
  draws 8 and knocked-down (7 skeletons, 6 steps) draws 6, which with the
  source is the 7 poses that were measured. The doc now says step count and
  works both cases through, and the generator emits both counts so the array
  length and the heading stop looking like a contradiction.
- [x] **RESOLVED (1.0.0-alpha.4.1.2 source review)** - **`animationLogFile` accepts
  an absolute or traversing path**: the setting was normalized with a trim and
  nothing else, then joined onto the work dir - so an absolute path replaced
  the work dir outright and `../../` climbed out of it, with `logAnimation`
  creating the parent directories before appending. Not an escalation (the
  value is the user's own, written with the user's own privileges), but the
  field reads as "relative to the work dir" and silently was not. It now goes
  through `normalizeRelativePath`, which keeps the empty "logging off" value,
  rejects a leading separator, a drive letter, a UNC prefix, or a `..` segment
  in either separator's spelling, and falls back to the default so a path meant
  to go elsewhere fails visibly rather than half working.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **`inlineSvg` turns a gradient fill black and drops masks, group opacity
  and dashes without a note**: it skips everything inside `<defs>` before its
  skipped-tag note is built, and it reads a `url(#...)` paint as no paint, so
  a shape filled with a gradient and drawn with no outline falls through to
  SVG's default and inlines as solid `#000000`. It also never reads a
  `mask=`, a group's `opacity`, or an element's `stroke-dasharray`,
  `stroke-linecap` and `stroke-linejoin`, and in every case `notes` comes back
  empty, although its documentation and `API.md` both say gradients and masks
  are reported there. A logo with a gradient placed with `placeBrand` becomes
  a black silhouette in both formats, with nothing to say why. Found while
  measuring what a sketch loses on its way to a PNG, for the API plan.
  - Fixed with linked graphics, since the rasterizer draws a linked SVG
    through it. A gradient is drawn as its first stop's colour, a group's
    opacity is folded in, dashes, caps, joins, stroke opacity and
    `text-anchor` carry over, and masks, clip paths, filters and patterns are
    reported in `notes`. `<use>` is still its own entry.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **The PDF writer paints named colors and transparency black**:
  `parseCssColor` in `pdf.ts` reads `#rgb`, `#rrggbb` and `rgb()` and returns
  black for anything else, so `steelblue`, an eight-digit hex, `hsl()`, or a
  `transparent` page background print black. Drawing by hand rarely hits it,
  since the color picker writes hex, but an imported SVG with named colors
  does, and so does a script. The composition module's `parseColor` reads all
  of them; the API plan's output phase routes the PDF writer through it.
  - The PDF writer reads colors with `parseColor` now. A color's alpha is its
    opacity, a transparent page prints no paper, and a value that is not a
    color is left out and reported through `onWarning` rather than printed
    black. `parseCssColor` keeps its answer of black for such a value.
- [ ] **A `.skbk` cannot hold a few million points**: `serializeSketchBook`
  pretty-prints with two-space indentation, about 155 bytes per sampled point,
  and at 4.85 million points the text passes V8's longest string, so the save
  throws `RangeError: Invalid string length`. Generated drawings stay far
  below it (the script budget caps sampled points at a million), but a very
  large import could reach it, and nothing would say why. Compact JSON would
  roughly halve the size; writing it out in pieces would remove the wall.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **A text box does not wrap in an SVG export**: `svgText` in
  `src/renderer/surface.ts` splits a text item at its newlines and nothing
  else, while the canvas wraps a fixed-width box (`textBoxWidth`) between
  words. A boxed caption drawn in the app or by `text ... box` exports as one
  long line. The SVG writer has no font to measure with; wrapping with the
  built-in face's measure, as the composition writer does, would bring it
  close. The API plan's output phase is to settle it.
  - Settled that way. The writer, now `src/core/sketch-svg.ts`, breaks a box
    where the built-in face breaks it and keeps the text as typed and the
    box's width in `data-text` and `data-box`, which the importer reads back
    as the box rather than the lines. The PDF breaks it at the same words.
    `test/gui/check-script.mjs` imports such an SVG and finds one text item
    in its box.
- [ ] **A composition shape with no `fill` is filled black in the SVG and empty
  in the PNG**: `fill` left out of a rect, circle or path writes no `fill`
  attribute, and SVG paints a missing fill black, while the rasterizer and the
  canvas painter read a missing fill as none. A `createComposition` rect given
  only a `stroke` comes out as a black square in the SVG and an outline in the
  PNG, which breaks the promise that the two formats are one graphic. A
  group's `fill` differs the same way: SVG passes it down to children without
  one, and the rasterizer ignores it. Either the SVG writes `fill="none"`
  where the model has none, or the model defaults a shape's fill to black; the
  sketch lowering sets every fill, so the PNG of a sketch is not affected.
  (Found checking the erase shapes in all three renderers for the output
  work; reproduced with a 40 by 40 composition.)
- [ ] **Mirror flips a link's placeholder, not its file**: Mirror replaces an
  image item's pixels with mirrored ones, and on a linked item those are the
  placeholder's, so the name reads backwards in the app while every output
  that follows the link draws the file the right way round. A link has
  nowhere to record a mirror. Either Mirror leaves a link's picture alone and
  moves its box only, or a link gains a transform the outputs apply.
- [ ] **The Rotate dialog runs off the bottom of a short window**: in an
  837-pixel-tall window the panel opens 72 pixels down and is 805 tall, so
  its last 40 pixels are below the window's edge, and the Rotate and Cancel
  buttons with them (the Rotate button's middle measured 944). The panel
  scrolls its own content, but the part of it that scrolls is cut off too.
  Enter in the angle field still applies the turn. (Found writing the Track
  History GUI check in 1.0.0-alpha.4.5.0, whose click on Rotate landed on
  nothing; the check presses Enter instead.)
- [x] **RESOLVED (1.0.0-alpha.4.6.0)** - **A group's drop shadow leaves a dark line on the canvas's bottom
  edge**: with `test/gui/check-effects.mjs`'s script open at 1.475 canvas
  pixels a unit in a 1903 by 927 canvas, the canvas's last row is 75 percent
  black - the group's 50 percent shadow twice - for exactly the group's width
  (page 198 to 463 across), though the shadow itself ends 6 pixels above that
  row. At the zoom **Fit All in View** gives, the line is not there. It is
  likely where `layDown` in `src/renderer/surface.ts` draws the device-sized
  group picture through `ctx.filter` and the filter's output meets the
  canvas's edge. (Found in 1.0.0-alpha.4.5.0 when the GUI checks began
  launching with default settings: the check counted every near-black-gray
  pixel on the canvas and failed on this row. It now looks inside the
  shadow, where the row is not.)
  - Fixed in Phase Z, and not where this entry guessed. A canvas 617.67 CSS
    pixels tall at a ratio of 1.5 is 926.5 device pixels, and its backing
    store 927; the paper was filled at the CSS size, so the last row was
    half painted over the opaque black beneath - a 50 percent grey line the
    whole width of the canvas, which the group's shadow darkened to 75
    percent where it reached. `paintBackground` now fills the whole
    backing store. Phase Z also paints a picture with effects past the view
    by their reach, so a blur or a shadow at the canvas's edge no longer
    meets a picture cut off there.
- [ ] **Curves show their facets at the deepest zooms**: a curve is painted,
  hit and exported from points sampled along it - 24 for each cubic in
  `sampleVectorPathPoints`, 48 along a Curve tool arc - so at the zooms
  1.0.0-alpha.4.6.0 opened up, where one page pixel can fill the canvas, the
  straight runs between the samples show. Painting a vector path from its
  anchors (`bezierCurveTo`) would draw it true at any zoom; the samples
  still serve the hit test, the eraser and the exports. (A known limit of
  Phase Z of the 1.0.0-alpha.4.5.1 plan, filed as the plan said.)
- [x] **RESOLVED (1.0.0-alpha.4.6.0)** - **Every tool stops working after a
  quick curve is cancelled**: `Esc` during a `Ctrl + Space` quick curve, or
  the window losing the focus during one, cleared the curve but not the
  pointer the press had captured, and `onPointerDown` turns every press away
  while a pointer is owned - so from then on nothing drew, selected or moved,
  whatever the tool, until a restart. Holding `Ctrl` through a Select or a
  Text drag did the same (the Copic nib-rotate switched the tool mid-press
  and the release found nothing of the new tool's to finish), and so did a
  shortcut key choosing another tool mid-drag and `Esc` closing a Transform,
  Rotate or Mesh Warp mid-drag. A lost window also left `Space` held, which
  turned every pen stroke into a straight line. (Reported by the owner with
  `logs/issues/tools-break-09-26-26.skbk`; the file itself is clean, and the
  sequence was reproduced live over CDP while planning 1.0.0-alpha.4.5.1.)
  - Fixed in Phase P: a press is a record of what it does and the tool it
    began with (`src/renderer/press-state.ts`), its release acts on the
    record, whatever ends a press lets go of the pointer, a lost window, a
    hidden page or a lost capture ends the press where it stands, a tool
    chosen mid-press waits for the release, and a press still on record when
    a new one arrives is finished instead of turning it away.
    `npm run gui-check -- held-keys` runs every sequence.
- [ ] **An imported SVG's masks arrive as an "Erased" layer that cuts
  nothing**: the importer turns the erasers of a group's `<mask>` into a
  child layer named "Erased" (`svg-import.ts`), and an eraser mark cuts only
  the layer it is on - which holds nothing else - so the masked-out ground
  comes back. Importing each as a cut of the group's marks, by the rule
  Apply Erasers follows, would carry the mask in. (Left as it was by Phase E
  of the 1.0.0-alpha.4.5.1 plan, which made the Eraser cut geometry, and
  filed as the plan said.)

## Things to Improve

Code that works but should not stay as it is: duplication left behind by
features that outgrew their first implementation, two export attributes paid
for on every mark, three seams the Animation Mode work left showing, and two
left behind by the 1.0.0-alpha.4.1.2 source review - one sub-decision that wants
measuring before it is made, one tidy-up that belongs with the split - and one
check the app could run for itself instead of asking the helper to.
`renderer.ts` is 9,578 lines, which is the single biggest reason changes in the
GUI are hard to review. One seam has now been lifted - the editing popups -
which is the shape the rest should follow.

- [ ] **Split `renderer.ts`**: at 9,578 lines it holds the pointer handling,
  every tool, all three panels, the clipboard, the menus, and Animation Mode.
  The clipboard and the layers panel are the two seams that already have
  almost no shared state and would lift out cleanly next.
  - The popup seam is done: `src/renderer/popup.ts` owns move, resize, dock,
    and undock for every editing panel, and the six private methods it
    replaced are gone from `renderer.ts`. It is worth reading as the pattern -
    the module reads the `is-hidden` class the app already toggles rather than
    demanding new calls, which is why nine call sites needed no edit.
  - 1.0.0-alpha.4.5.0 lifted seven more out: `commands.ts`, `menus.ts`,
    `keys.ts`, `config-dialog.ts`, `editors.ts`, `script-dialog.ts` and
    `history-tracker.ts`, 2,146 lines in all. The features it added still
    left `renderer.ts` at 12,107 lines, up from 11,626, so the clipboard and
    the layers panel are still the next seams.
  - 1.0.0-alpha.4.6.0 lifted seven pure ones out: `press-state.ts`,
    `held-keys.ts`, `alt-menu.ts`, `zoom.ts`, `vector-place.ts`, `notice.ts`
    and `fill-stroke.ts`, 833 lines, and every new tool's engine went to the
    core. Its tools still left `renderer.ts` at 14,870 lines, so the clipboard
    and the layers panel are still the next seams.
- [ ] **A decoded image outlives the mark that placed it** *(1.0.0-alpha.4.1.2 source
  review, residual - needs measuring)*: `Surface.imageCache` is now emptied
  whenever the whole document is replaced, and by the throwaway surface Export
  All builds per page, which is what stopped it growing without bound. Within
  one document it still is not pruned: delete an image or undo the paste that
  placed it and its decoded bitmap stays until the document changes. That is
  bounded by what one session placed, so it is slow growth rather than a
  runaway, and the two candidate policies want real numbers before one is
  picked. An LRU bound is simplest but re-decodes every frame if a page holds
  more images than the bound, which is worse than the leak; a sweep against the
  images the book still references is exact but costs a pass over every page.
  Measure typical placed-image sizes and counts first.
- [ ] **The direct `renderLayers()` calls are now redundant** *(1.0.0-alpha.4.1.2
  source review)*: sixteen call sites rebuild the panel by hand right after a
  store mutation, and the mutation's own coalesced `syncUi` rebuilds it again
  on the next frame. They are one-off user actions (paste, import, delete), not
  per-frame work, so the double rebuild costs little - but each one is a reader
  wondering whether the explicit call is load-bearing. It is not, except where
  something reads the row back, and that path calls `flushUi()` instead. Worth
  removing them with the `renderer.ts` split above rather than as a change of
  its own.
- [ ] **`store.duplicateSelectedElements` is now the fallback only**: the
  Alt-drag copy goes through the tree-rebuilding paste whenever the selection
  amounts to a group, and only reaches the old cloner for a plain selection of
  marks. That cloner still spells the suffix `" - copy"` and still clones
  layers its own way; fold it into the tree path and delete it.
- [ ] **The arrow cursor path is written four times**: `CURSOR_ARROW_BLACK`,
  `CURSOR_ARROW_WHITE`, and both arrows inside `CURSOR_ARROW_COPY` repeat the
  same `d` string verbatim. One constant would keep them from drifting apart.
- [ ] **`data-i` on every mark**: paint order is written on all of them, but it
  is only needed when export order and paint order disagree (strokes
  interleaved across layers). Skipping the attribute entirely when the two
  already agree would take roughly 12 bytes off every mark - the importer's
  document-order fallback reproduces it, though only if *no* mark carries one,
  so it has to be all-or-nothing per document.
- [ ] **`inkscape:label` duplicates `data-name`** on every layer group. Both
  are load-bearing for interop, but a document with many layers pays for the
  name three times over; worth measuring whether the `id` alone is enough for
  Illustrator.
- [ ] **Two SVG readers in the repo**: `scripts/wireframe-cycles.mjs` hand-rolls
  a depth-counting group scanner and its own attribute regexes to measure the
  skeleton, while `src/renderer/svg-import.ts` already parses SVG properly
  through the DOM. The generator wants no Electron, which is why it was written
  that way, but the two will read the same file differently the first time one
  meets markup the other tolerates.
- [ ] **`install-ai-helper.mjs` hardcodes the skill list**: `SKILLS` names the
  two skills literally, so a third has to be added in code before it installs.
  Reading the folder would let a skill be added by dropping it in - which is
  how `vector-graphics` was added, and it needed the edit.
- [ ] **Uninstalling Animation Mode gates it, it does not remove it**: the mode
  is off when the install record is absent, which is what makes the feature
  pluggable, but every line of it is still compiled into the bundle. That is
  the right trade for a runtime toggle and the wrong one if "uninstalled"
  should mean the code is not shipped; worth deciding which was meant.
- [ ] **Disable API is a choice the app could make for itself**: the setup
  dialog already counts the layers no assembly can reach, which is the whole
  evidence the decision needs - five of eleven is not a close call. It still
  asks. Offering the choice is right while the count is the only signal, but
  the app could preselect Disable API past some share of the figure and say
  why, so the default stops being wrong for exactly the drawings the mode was
  added for. The count is computed in `animationPartNames` and the dialog's
  `orphans`, both in `src/renderer/renderer.ts`.
- [ ] **Facing is asked once and applied to every frame**: the wizard reads it
  off the source figure and the whole sequence inherits it, which is right for
  a walk and wrong for anything that turns around. It is also asked per
  sequence rather than stored on the character, so drawing a second animation
  from the same figure asks again and can be answered differently. If Animation
  Mode grows a turn, or a figure that leads with the other foot, facing stops
  being a property of the run and becomes one of the frame.
- [ ] **A three-quarter figure has no cycle that fits it**: `figureFacing`
  returns null for one, and null is handled honestly - the app does not mirror
  and the form says the table gives sizes rather than directions. But that
  leaves the helper judging every direction from a drawing, which is the case
  the cycle tables were meant to take off it. Either the studies grow a
  three-quarter set, or the tables need to carry enough to be projected onto
  one; BadGirl, the character this was found on, is exactly this case.
- [ ] **The select gesture has no automated coverage at all**: `beginSelect`
  and the release beside it are the hottest path in the app - every click on
  the canvas goes through them - and they now carry three deferred decisions
  (`pendingSelectionClear`, `shiftToggleId`, `pendingSelectHitId`), each of
  which means the press and the release have to agree about what a gesture
  turned out to be. Nothing checks that they do. `renderer.ts` exports
  nothing, so the rules cannot be reached from a test the way the store's can;
  either the decision moves somewhere importable, or the app gets driven over
  the DevTools protocol with real pointer events and DOM assertions. The
  second is what the behaviour actually is, and it needs a harness the repo
  does not have yet.
- [ ] **`frame-preview` cannot see a drawing made of primitives**: the
  tokenizer in `scripts/frame-preview.mjs` matches `<g>` and `<path>` and
  nothing else, so a file drawn with `<rect>`, `<circle>` or `<ellipse>`
  renders as an empty page with its travel figures all zero - and reports that
  as a frame that did not move rather than as a file it could not read. The
  skill's own `character-wireframes.svg` is 163 rectangles, so the one asset a
  helper would most want to render against is the one it cannot. Either teach
  the tokenizer the primitives or make it say when it understood nothing.
- [ ] **The movement budgets are checked by the helper, not by the app**:
  1.0.0-alpha.4.2.0 gave the frame subagent `npm run frame-preview`, so it renders what
  it drew, looks at it, and sees the travel figures before saving. That closes
  the loop only as far as the helper follows its instructions - nothing in the
  app enforces it, and a run that skips the step still saves whatever it made.
  The app already holds the saved frame and the frames before it, so it could
  measure the sequence itself after each frame lands and re-request when a part
  is over budget or has been frozen in every frame. The measuring is in
  `scripts/illustrated-frames.mjs` and the rendering in `scripts/frame-preview.mjs`,
  both written to be imported.

## Documentation Update Ideas

The README is 1,167 lines and documents each editing gesture where it was
added rather than beside the others. 1.0.0-alpha.4.1.0 alone introduced five
clipboard shortcuts and a drag modifier, and the file now mentions `Ctrl`
thirty times without ever listing them in one place. The last two entries are
a different problem: Animation Mode is documented in three files that have to
agree, and one of them is read by the AI helper rather than by a person.

- [x] **DONE (1.0.0-alpha.4.5.0)** - **A keyboard-shortcut table**: one table in the README covering the
  tools, the quick features, the clipboard (`Ctrl+C` / `X` / `V` /
  `Shift+V` / `D`), restacking (`Ctrl+]` / `[`), and the Shift drag
  constraint. Today a reader has to find each one in the prose that introduced
  it.
  - Built in 1.0.0-alpha.4.5.0: the README's In-app controls opens with a
    table of every command with a shortcut, and the cheatsheet's Tools table
    beside it, both written from `src/core/menu/shortcuts.json` by `npm run
    menu-docs`; held keys and gestures are a hand-written table after it.
- [ ] **An "Editing gestures" section**: the clipboard, Alt-drag, the Shift
  constraint, and Shift-click selection are documented as four separate
  bullets in the feature list even though they interact - Shift means one
  thing on a press and another during a drag, which is worth saying once,
  plainly, in a place a reader will look.
- [ ] **Document the version policy in CONTRIBUTING or the CHANGELOG header**:
  the 1.0.0-alpha.4.1.0 entry is 241 lines and holds features as well as fixes, and
  nothing in the repo says when a batch should take a minor bump instead. See
  the matching chore below.
- [ ] **The animation type table is written in three places**: the source list
  in `ANIMATION_TYPES`, the table in the `vector-animations` skill, and the table
  in the README. A type that changes status has to be edited in all three, and
  the skill's copy is what the AI helper reads, so a stale one misinforms the
  tool rather than the reader. `wireframe-cycles` already generates the
  skeleton asset; it could generate the skill's table too.
- [ ] **One walkthrough of how a frame is made**: the pipeline now runs measure
  the pose, write the source and the form, let the helper edit, collect the
  file, import, place beside the source, re-export cropped. That sequence is
  spread across the README, the instructions file, and the skill, and no single
  page shows it end to end - which is the page somebody debugging a bad frame
  actually needs.

## Ideas

Exploratory - worth trying, not yet worth scheduling. These came out of the
work rather than from a plan: the first five from the 1.0.0-alpha.4.1.2 popup dock,
then four from 1.0.0-alpha.4.1.0, each small enough to prototype in an afternoon, and
the last three from Animation Mode. Those three are larger. The first of
them, which changes what the mode needs to run at all, is built in
1.0.0-alpha.4.4.0.

The five dock entries are deliberately small and deliberately together: each
one is a thing the shared popup module could grow, and doing any of them in
isolation would probably mean touching the same twenty lines twice.

- [ ] **A resize handle on the dock**: the pages, layers, and properties panels
  each carry a `.panel-resize` grip that drags their width, and the popup dock
  has a fixed 320px. The grip is a small shared component in all but name
  already; giving the dock one would mean the four columns behave the same way
  rather than three of them behaving one way.
- [ ] **Remember where each popup was left**: a palette dragged somewhere
  deliberate, or docked, goes back to its default on the next launch. The
  settings file already round-trips through `src/core/settings.ts`, and a
  popup's state is three values (docked, left, top), so this is storage rather
  than design. Worth doing after the dock-width item above, so the width is
  stored with them rather than added a release later.
- [ ] **Dock more than one popup, and say what the order is**: the dock is a
  column and takes any number of panels, but nothing decides how they stack -
  they arrive in the order they were docked and cannot be rearranged. The
  layers panel's drag-to-reorder is the obvious model, and `makeSortable`
  already exists; the question worth settling first is whether two docked
  editing popups is a real case or a thing the design should discourage.
- [ ] **Let the dock take the left side too**: it is appended to the workspace
  row, so which side it lands on is a `flex` order away rather than a rewrite.
  Someone working with the layers panel open on the right may well want the
  editing panel on the left, and the same choice would apply to the panels once
  the two mechanisms are shared.
- [ ] **A keyboard route to a docked panel**: a floating palette takes focus
  when it opens, and a docked one is a column that has to be clicked into. A
  shortcut that moves focus to the docked panel - and `Escape` back to the
  canvas - would keep the dock from being the mouse-only option.
- [ ] **An export-size budget in the test suite**: the round trip now lands
  between 0.27x and 1.05x of the source on the fixtures and the
  `vector-graphics` assets. A test that measures those ratios and fails when
  one regresses past 1.0x would keep the compact path writer honest, the way
  the geometry-identity test already keeps it correct.
- [ ] **Paste Special**: the clipboard decides on its own whether a copy
  rebuilds its layer tree or lands flat, from whether the selection amounts to
  a group. A menu row that forces one or the other would cover the cases where
  that rule guesses wrong - pasting a group's marks onto one layer on purpose,
  say.
- [ ] **Name the constrained axis while Shift is held**: the status bar is
  empty during a drag and could say `horizontal`, `vertical`, or `45 degrees`.
  Cheaper than the guide-line idea filed under Quick Features and useful for
  the same reason.
- [ ] **Screenshot diffs from the GUI harness**: the DevTools-protocol driver
  already captures the page. Storing a reference image per flow would catch
  the class of bug that the cursor rework hit - art that is technically correct
  and visually a mess.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Draw the measured frames without an AI at all**: for a type with a
  measured cycle the app already computes the finished `transform` per
  assembly, and applying them is a handful of attribute writes on a copy of
  the source. Doing that in-process would give walk, idle, and knocked down a
  path that needs no AI tool, no sign-in, and no waiting - and would leave the
  helper for the types that still need judgment. It would also make the mode
  demonstrable on a machine with no agentic CLI installed.
  - Built as a napkin script: `src/core/script/animation.ts` copies the
    figure's parts onto a frame and turns each about its joint by the cycle's
    total up to it. Animation Mode's setup dialog draws the whole sequence
    with **Draw measured frames** for walk, run, idle and knocked down, after
    showing the script, and `napkin-sketch render --animate` draws it from a
    saved book with no app. The mode itself still needs its install record;
    the follow-on is under **Napkin script follow-ons**.
- [ ] **Verify a generated sequence by measuring it back**: `wireframe-cycles`
  already reads joint angles out of an SVG. Pointed at the frames a run
  produced rather than at the skeleton, the same measurement would say whether
  the sequence actually follows its cycle. That is the check that would have
  caught a walk whose limbs swung the wrong way, instead of it being noticed by
  eye several batches later.
- [ ] **A shared registration box for a sequence**: frames are cropped to their
  own ink, which is what makes each one a clean sprite but leaves the sequence
  without a common origin. One box sized to the widest frame in a run, applied
  to all of them, would trade a little empty space per frame for frames that
  can be stacked and played without shifting.
  - Built for scripts: `registration` in a script, or in `renderBook`'s
    options, cuts every page to one box. What is left is sizing the box to
    the widest frame by itself, and Animation Mode's export using it.
  - Measured frames size it themselves: `render --animate` cuts every frame
    to the union of the frames' ink. Animation Mode still saves each frame to
    its own ink, whether the helper posed it or the cycle did.

## Brand resources (1.0.0-alpha.4.2.1)

What the brand pass left open. The mechanism works end to end - a generated
skill reads `references/resources.md`, inlines a vector logo so both renderers
draw it, and falls back to a mark in the design language when nothing is
configured - and these are the edges it does not reach.

- [ ] **`brand-resources.mjs` is copied into every generated skill.** That is
  deliberate: a skill has to run without reaching back into the helper that
  wrote it, and a cross-skill relative import breaks the moment the two are
  installed differently. The cost is real though - a fix to the resolver has to
  be re-copied into each skill already generated. Worth a
  `--refresh-scripts` flag on the generator, or a version stamp in the copy so
  a stale one can at least say so.
- [ ] **The quarter scan finds one mark and stops.** A page with a logo at the
  top and a footer strip at the bottom reports only the logo, because the scan
  returns at the first band that holds a compact mark. That is the right
  default for the common case and wrong for a page with two. Scanning every
  band and ranking the candidates would cost one more pass.
- [ ] **A scanned slot has no way to be confirmed and kept.** The report says
  `found: 'scan'` and asks for a look, and then there is nowhere to record that
  the look happened. The generated `SKILL.md` prints the boxes; a reader who
  corrects one is editing generated output that the next run overwrites.
- [ ] **`inlineSvg` does not resolve `<use>`.** A logo built from symbols -
  common in an icon set exported as one file - loses the referenced shapes. The
  note says so rather than drawing nothing silently, but resolving a `<use>`
  against a `<symbol>` in the same document is a bounded job worth doing.
- [ ] **No contrast check on a placed asset.** The API checks the palette it is
  handed, and a brand's own logo arrives after that: a dark mark dropped into a
  dark band passes every check in the suite and is invisible on the page.
  Measuring the placed asset's dominant colour against the band it lands on
  would catch it.
- [ ] **`resources.md` has no schema beyond the parser.** A misspelled key is
  read as a slot nobody draws, and the report lists it with everything else
  rather than flagging it as unused. Naming the slots a skill actually places -
  the generator knows them - would turn a typo into a warning.
- [ ] **The registration records one skill, not several.** A project with two
  captured languages - a poster language and a social-post language - overwrites
  the first registration with the second. Keying the file by skill name and
  adding a `default` pointer would cost little; the reason it is not done yet is
  that nothing has needed a second one.
- [ ] **Mode matching has no way to say "none of these".** A request that means
  something the script cannot draw falls through to the default and draws the
  wrong thing confidently. Returning no match, and letting the caller decide
  between drawing the default and saying so, is the more honest shape.
- [ ] **`--registration` prints absolute paths.** Useful when running it, noise
  when pasting the output anywhere. Printing project-relative paths and keeping
  the absolute ones behind a flag would make the output quotable.
- [ ] **The generated starter script draws two layouts.** It carries the
  language, the page, the type scale and the measured slots, and composes a card
  or a cheatsheet from them. Both are horizontal bands, which is what the
  shipped source asset happens to be; an asset built on a grid or a radial
  composition would get band layouts that are in its palette and not in its
  structure. Deriving the layout from the measured element census, rather than
  from a template picked by hand, is the open half of this.

## The animation note (1.0.0-alpha.4.2.1)

Animation Mode now asks what the sequence is for, hands the answer to the
helper with every frame, and ranks it above the type dropdown. What it does not
yet do:

- [ ] **Nothing measures whether the note changed the frame - and now it is
  allowed to change more.** A note may shift a measured angle: by the smallest
  amount that reads, about the same joint, named in the reply. All three of
  those are sentences in a prompt with nothing behind them. A note asking for a
  limp and a frame that walks evenly remain indistinguishable to every grader
  here, which is the same gap the frame grading has one level up. Comparing the
  emitted transform against the one the cycle handed over would at least
  measure the size of the departure, which is the part most likely to go wrong.
- [ ] **The template is outranked, never removed.** The form still prints the
  type's guidance in full beside a note that overrides it, so a note describing
  something the type is not leaves the helper holding two descriptions and a
  rule about which wins. Knowing when to drop the template rather than rank it
  is the other half, and it is the same question as the **Custom** entry under
  the free-text prompt below.
- [ ] **One note per sequence, not per beat.** An attack is wind-up, strike and
  recover, and a note that describes the strike is handed unchanged to the
  wind-up. A per-frame note, or a note the helper is told to read against the
  beat it is drawing, would fit the non-looping types better.
- [ ] **The note does not survive a reopened sketch.** It lives in the wizard's
  setup for the run and is gone when the dialog closes, so continuing a
  sequence tomorrow starts from no direction at all. It belongs with the
  sketch, beside the animation type.
- [ ] **600 characters is a guess.** It is enough for a paragraph and short
  enough not to crowd the form, and nothing has measured where the real
  trade-off sits.

## Frame grading (1.0.0-alpha.4.2.1)

The grade-and-revise loop closes: a frame is rendered, measured, graded, and the
verdict says revise, save or pass. What it still cannot see:

- [ ] **Nothing enforces the loop.** The verdict is printed and the agent is
  asked to act on it - the same shape that just failed, one level up. A wrapper
  that renders, grades and refuses to copy a `revise` frame into `animations/`
  would make the budget structural rather than advisory. `--strict` is the half
  of that which exists.
- [ ] **The grader cannot see a limb through a skirt.** Travel, frozen layers and
  redrawn geometry are all it measures; overlap, joint separation and a hand on
  the wrong side of the body are left to the eye reading the PNG. Detecting a
  limb outline crossing a garment outline is a real geometry problem and worth
  scoping before it is promised.
- [ ] **Bands are per animation type, not per rig.** `--type walk` picks the
  band, and a character with much longer legs than the illustrated set will read
  as OVER on a stride that is correct for it. Normalising by the figure's own
  limb length rather than by its height would fix it.
- [ ] **A frame is graded only against the one before it.** Drift accumulates:
  four frames can each pass their step and still leave the figure walking
  uphill. Grading the last frame against the first would catch it for a loop,
  and there is no obvious answer for a non-looping action.
- [ ] **`save` has no record.** The verdict tells the agent to report what is
  still wrong, and nothing writes that down beside the frame. A sidecar note per
  saved-with-defects frame would let a later pass find them without re-grading.

## Asset previews (1.0.0-alpha.4.2.1)

Every reference asset now ships as a `.svg` and a `.png`, and Animation Mode
looks at the picture before it poses. What that left open:

- [ ] **The previews are hand-exported, and nothing keeps them in step.** The
  pairing test catches a *missing* preview; it cannot catch a stale one, because
  a PNG has no record of which revision of the SVG it was made from. A hash of
  the source stored beside the preview would turn "these have drifted" from
  something nobody notices into a failing test. Worth doing before the next time
  a sheet is re-exported.
- [ ] **They could be regenerated in-repo now, and are not.** The graphic-design
  API renders all twelve faithfully since the shape-transform fix - the rig's
  rotated hands and feet come through - so `npm run skill-previews` is a real
  option rather than a downgrade. What stops it being obviously right is that
  the shipped previews were exported from the editor and would be replaced by
  renders that differ in anti-aliasing and in anything the API does not model.
  Worth doing only alongside the staleness check above, so the two arrive as one
  mechanism rather than as a reformat.
- [ ] **The agent looks at one preview per frame.** For a character action that
  is right; for a frame that mixes a rig pose with an object coming apart, the
  table picks one and the other goes unseen. Two `Read`s is not expensive, but
  the step reads as "pick one" and should say when to take both.
- [ ] **Nothing measures whether looking helped.** The claim is that a frame
  drawn against a reference reads better than one drawn against the numbers
  alone. That is believable and unmeasured, and the honest version is a handful
  of frames generated both ways and compared by eye.

## The rest of Transform (1.0.0-alpha.4.2.2)

`Ctrl+T` scales: one box, eight handles, `Shift` for uniform and `Alt` from the
centre. Scale is the transform that needs nothing the model does not already
have — `Store.scaleStrokes` maps every point, anchor, and tangent handle, and
the tool is arithmetic on a bounding box. The four below are the ones that do
need something new, ordered by how much.

They share one question, which is worth settling before any of them is built:
**where does a transform live?** Today every one of them is baked into the
points — a scaled stroke *is* its new coordinates, and there is no record that
it was ever scaled. That is fine for scale and rotate, which are closed under
the model. It stops being fine for a warp: a puppet-warped path that is then
scaled needs its deformation re-evaluated, not re-baked, or the two compose
into mush. Either these stay destructive and each one bakes, or a stroke grows
an optional transform stack and every reader (`serialize.ts`, the SVG export,
`strokeBounds`, the hit test, the frame preview) learns to ask for the posed
geometry rather than the stored geometry. The second is a much larger change
than any single feature below and would be worth it exactly once.

- [ ] **Skew**: the small one. A shear is still an affine map, so it composes
  with the scale already there and bakes into the points the same way. It needs
  `Store.skewStrokes(ids, kx, ky, ox, oy)`, a handle behaviour (drag a *side*
  with `Ctrl` held, the usual convention), and an answer for what a shear does
  to a stroke's width, which is no longer uniform around the mark — the same
  question `scaleStrokes` answers with `sqrt(|sx*sy|)` and which a shear makes
  genuinely directional. Text and images would shear as boxes or not at all.
- [ ] **Distort / free transform**: drag one corner on its own, so the box
  becomes an arbitrary quadrilateral and the map is a homography rather than an
  affine one. Straight lines stay straight, which keeps it tractable, but
  Bézier handles no longer transform as points do — a curve under a projective
  map is not the same curve with mapped control points, so it needs either
  subdivision or an accepted approximation. Worth prototyping against
  `character-wireframes.svg`, where the error would be visible.
- [ ] **Perspective**: distort's constrained sibling — drag a corner and the
  one beside it mirrors, giving a trapezoid. Falls out of distort almost for
  free once the homography exists, so it should not be built first.
- [x] **DONE (1.0.0-alpha.4.3.0)** - **Puppet / character warp**: pins on the drawing, and the geometry between
  them deforms. The largest by a distance, and the only one that is not a map
  from the whole box: it needs a mesh (or a weighting from each point to each
  pin), a solver, and — unlike the three above — a reason to keep the pins
  around after the gesture, which is what forces the transform-stack question.
  For Animation Mode this is the interesting one: it is how a frame could be
  posed without a rig at all, which is exactly the case **Disable API** exists
  to work around. Built as **Mesh Warp** (Minor, *The 1.0.0-alpha.4.3.0 features*),
  which answers the transform-stack question the way Illustrator's Puppet Warp
  does: pins live for the session, and the warp bakes into the anchors on
  commit. Keeping pins for Animation Mode stays a follow-on. Mesh Warp is in.
  Two parts of Puppet Warp are left for later: turning the art about a pin by
  dragging the dashed ring round it, which needs a pin to hold an angle as well
  as a place; and keeping pins on a mark after the warp is put down.
- [x] **PARTLY DONE (1.0.0-alpha.4.3.0)** - **Flip**: the gap in what Transform already does. Dragging a handle
  through its anchor currently stops at 1% rather than mirroring, because
  `scaleStrokes` takes a text item's font size and an image's width as
  magnitudes and `Math.max(1, …)` turns a negative factor into a 1px item. A
  negative factor maps geometry correctly today; making it correct for the
  other two is a contained fix, and it is the smallest useful thing on this
  list. **Mirror Selection** now flips from a palette, and its
  `mirrorStroke` answers the text and image questions once: text stays
  readable while its box moves, and an image's pixels are flipped. What is
  left is the handle itself - letting a drag cross its anchor and send the
  negative factor through `mirrorStroke` - which waits on whether it is wanted
  (open question 6 in the plan).

## Menus, shortcuts and generated scripts (1.0.0-alpha.4.5.0)

Planned 2026-09-25 in `.claude/prompts/feature-generateScripts-v1.0.0-alpha.4.5.0.md`
(gitignored, like the earlier plans) from `.claude/prompt.md` and the two
mockups in `.support/feature-generateScripts/`. Fifteen entries, one per
phase - X was added during V - built in this order and one phase per run;
the plan holds each phase's spec, files, tests and decisions, and its
twelve open questions. The
documentation site's own plan is `.claude/website.plan.md`.

- [x] **DONE (1.0.0-alpha.4.5.0)** - **Phase 0 - the registry**: `src/core/menu/tool-types.json` and
  `shortcuts.json` hold every command's tool type and chord, and a pure
  `registry.ts` generates the top bar, each right-click context and the
  Help rows from them. A characterization test reproduces today's three
  menus and three context lists exactly, and the final top bar of the brief
  is a test from here on.
  - Built 2026-09-25: 99 commands and 13 menus, 9 in the menu bar and 4
    drawn only in the window. The old menus are matched with three changes
    to the menu bar and five to the in-window menus, each a named step in the
    test. Delete got a type of its own, `Subtract:element`, so the canvas
    keeps its separator; Close Shape opens Sharp and Smooth, as its toolbar
    button does. Nothing in the app reads the registry until Phase M.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **M - menus from the registry**: the native bar and the context menus
  are generated; `MenuAction` becomes `CommandId` and one command table;
  Transform, Sketch, Layers, Pages, Automate and Help appear; Rotate and
  Mirror leave Edit; the layers panel shows the clipboard rows and **Move**
  where the top bar shows **Move Layer**. GUI check for the context menus.
  - Built 2026-09-26: `src/main/menu.ts` binds the registry's rows to clicks,
    and the main process updates enabled and checked rows in place as the
    window's answers change; `src/renderer/commands.ts` is the one command
    table, and every toolbar button runs through it. The canvas no longer acts
    on a right press before its menu opens. The user files are read at
    startup; writing them is Phase E's.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **K - shortcuts from the registry**: the forty-odd branches of the key chain become
  one lookup; button titles take their chord from the registry; `npm run
  menu-docs` generates the README and CHEATSHEET shortcut tables.
  - Built 2026-09-26: `src/renderer/keys.ts` answers every key the modes
    let go; 45 tooltips take their key from the registry; `npm run
    menu-docs` writes the README's shortcut table and the cheatsheet's
    Tools table. Shift and a letter still mean the letter; Alt and a letter
    no longer do.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **D - the configuration popup**: `src/renderer/config-dialog.ts`, one
  reusable form popup with search, radio filters, a bordered table (text,
  select, key-capture and check cells) and Accept/Cancel, registered with
  the popup manager.
  - Built 2026-09-26: `ConfigDialog.open(spec)` fills a `#config-dialog`
    skeleton. The search, the filters, the shortcut verdicts and the held
    edits are pure and unit-tested, and a GUI check drives the popup
    through a check-only `window.napkinCheck` hook. While it is up it keeps
    its keys, so nothing behind it runs. No menu row opens it until Phase E.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **E - Edit Keyboard Shortcuts**: the popup over every command; a chord
  another tool holds warns amber and a free one reads green; Accept writes
  only the differences to `userData/shortcuts.json` and the shipped file is
  never written; Reset removes the override.
  - Built 2026-09-26: `src/renderer/editors.ts` describes the editor, and
    `planUserFiles` in `src/core/menu/overrides.ts` plans the file, which
    the main process writes (or deletes) before rebuilding the menu bar
    and sending the files back. Reset to defaults puts the app's own
    shortcuts in the table as edits, so Accept removes the file. A warning
    about the user's files at startup now follows the window's other
    opening messages instead of being replaced by them.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **Y - Edit Tool Types**: the same popup with a type select per row
  (an optgroup per main type); fixed rows (the editors, role rows, Undo and
  Redo, the settings rows, the Help rows, a panel's own close row) are
  listed but disabled; Accept writes `userData/tool-types.json` and every
  menu regenerates.
  - Built 2026-09-26: the drop-down has **Not in a menu** first, since a
    toolbar tool can be put in a menu and any movable tool taken out of
    all of them, and it says where a choice would list the tool before
    Accept. The two editors carry their own reason for staying put.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **W - the script writer**: `src/core/script/writer.ts` turns a sketch,
  or a subtree of its layers, into instructions that evaluate back to the
  same marks; round-tripped on the simple and the complex fixtures through
  the SVG export.
  - Built 2026-09-26: exact SVG round trips for all eight fixtures and every
    golden page, with every digit kept; the same pixels at two decimals.
    The language gained `tool eraser`, which the writer needed. What a
    script cannot say is written as near as it goes and reported in
    `notes`.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **G - Generate Script from a media file and the selected layers**: the
  Automate menu's first two sources (SVG and PDF through the writer, a
  raster as a `link` or an embedded `image`) and the Generated script
  dialog with Copy, Save As, Open as New Page and Cancel. Tests per method
  on simple and complex graphics; a GUI check.
  - Built 2026-09-26: an SVG goes through the importer and the one routine
    that builds an import's layers (`src/core/imported-sketch.ts`, which the
    store's import now calls too), a PDF's pages are written as a book, and
    a picture is linked by its file name or embedded. Selected Layers keeps
    the page or fits it to the selection, which the writer now does by
    moving the marks to the corner. The dialog shows the whole script, its
    counts and the writer's notes, and shortens image data in the view only.
    File > Import and `-i` take GIF and WebP too.
    `test/script-generate.test.ts` and `test/gui/check-generate-script.mjs`.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **T - Track History and History Limit**: the store fires one step per
  history boundary, a pure diff names what the step added, removed and
  changed, and a bounded tracker keeps the steps; `trackHistory` and
  `historyLimit` settings in a new Automate section of Verbose Settings.
  - Built 2026-09-26: a step closes at the next history boundary rather than
    at the next change, so a drag is one step, as it is one undo; the store
    does nothing while no one listens. Steps are named by the command that
    ran, by the tool whose press made them, or by what they changed.
    Turning tracking off clears the steps, and History Limit opens Verbose
    Settings at its Automate section, which shows the steps and what they
    hold. `test/history-diff.test.ts`, `test/history-tracker.test.ts` and
    `test/gui/check-track-history.mjs`.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **S - Generate Script from the session history**: the mockup's popup
  over the tracked steps, one comment block per checked step in the script,
  an unchecked step's marks left out.
  - Built 2026-09-26: the ticked steps are replayed from the page as it was
    before the history began, found by walking the steps back from the page
    as it is, so an unticked step is left out as if it had not happened - a
    change property by property, which Track History's diff now allows.
    The replay is written in paint order, since a group cannot be opened
    twice, with each step's comment before the first mark it drew.
    `test/history-script.test.ts` and `test/gui/check-history-script.mjs`.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **P - the GitHub Pages site**: built from `.claude/website.plan.md` per
  `.claude/instructions/create-and-deploy-github-pages.instructions.md`,
  assembled by `npm run site` from the split-readme-into-site skill, deployed
  by `.github/workflows/pages.yml`, with the verification item filed under
  Current when it is pushed.
  - Built 2026-09-26: 61 pages in `docs/`, which `src/docs/site.ts` writes
    from Markdown with one chrome stamped into each: 30 sources in
    `docs/site-src/` (the README's manual, moved there, and five new
    quickstarts), the 27 API pages, and `QUICKSTART.md`, `CHEATSHEET.md`,
    `CHANGELOG.md` and `ai-helper/README.md`. `npm run site -- --check` and
    `test/site.test.ts` fail while a page is behind its source or a link
    reaches nothing. The README is a front door of linked headings, and
    `DESIGN_LANGUAGE.md` holds the site's colors and their contrast. Nothing
    is pushed and Pages is not switched on yet; the verification item under
    Current says what is left.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **H - the Help menu**: Verbose and Tool Types open the shipped pages in
  a docs window; Source Code opens the repository; Source Docs appears once
  the site is verified.
  - Built 2026-09-26: `src/main/docs.ts` decides where the pages are (the
    installed app's resources, or the checkout's `docs/`), what a row does
    without them (the published site once it is up, else a toast), where a
    link goes (a page stays, the web goes to the browser, the rest nowhere)
    and the window's keys (Alt and an arrow, the mouse's side buttons,
    Ctrl+W). The window is sandboxed, with no menu bar and no preload, and
    one is reused for every row. The Automate quickstart leads to the
    Animation Mode page's new Frame names. `test/docs-window.test.ts` and
    `test/gui/check-help-menu.mjs`; every GUI check now gets a user-data
    folder of its own.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **V - validation and the release**: every check green, README,
  CHEATSHEET, CHANGELOG and this file updated, version 1.0.0-alpha.4.5.0 in
  `package.json` and both plugin manifests.
  - Built 2026-09-26: version 1.0.0-alpha.4.5.0 in `package.json`, the three
    plugin manifests and the CLI reference's example; the CHANGELOG's
    release heading and intro; a menus table on the site made from the
    registry, the testing and project-structure pages brought up to date,
    and Menus and Automate on the cheatsheet. An audit of the CHANGELOG
    against the menus, asked for in `.claude/prompt.md`, found two tools
    the menus miss, planned as X below.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **X - the tools the CHANGELOG adds to the menus**: Transform
  (`Ctrl+T`) joins the Transform menu, the menu of its own type, and
  Stroke Profile, which the menu files do not list at all, joins Sketch.
  Added to the plan in V.
  - Built 2026-09-26: **Transform > Transform Box** heads the menu's second
    block, checked while the box is up (a `transformBox` answer from the
    drawing window). **Sketch > Stroke Profile…** opens the picker; its
    type names the Sketch menu, so Edit Tool Types lists it greyed there, as
    it does the quick features, and its key can be changed. The context
    menus check runs both from the menu bar.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **B - the banner**: `assets/screenshot.svg` redrawn to show the menu
  bar, the Automate menu open and the toolbar as it is; the last step.
  - Done 2026-09-26 by the owner, as a picture rather than a redrawn SVG:
    `assets/screenshot.svg` became `assets/bannerImage.png` (by `git mv`,
    so its history follows it), and the site's home page opens on
    `docs/assets/banner.gif`, played once and held on its last frame.
- [ ] **The design language and the new icon**: `assets/icon.svg` was
  redrawn on 2026-09-26, with a new `assets/logo.svg`, after
  `DESIGN_LANGUAGE.md` and the site's palette had been measured from the old
  blue tile - its blues, its paper, and the orange underline the site draws
  under every page title. The site's brand mark follows the icon already.
  Re-measure the palette and the title stroke from the new icon, or keep
  them and say in `DESIGN_LANGUAGE.md` where they come from now.
  - Found in Phase H, when the site test failed on the copied mark.

## Resolve issues and the Shape Eraser (1.0.0-alpha.4.6.0)

Planned 2026-09-26 in `.claude/prompts/resolveIssues-addFeature-1.0.0-alpha.4.5.1.md`
(gitignored, like the earlier plans) from `.claude/prompt.md` - fourteen
issues noted while using the app, a new tool, and a note to check the
CHANGELOG against the 1.0.0-alpha.4.5.0 plan - and the Shape Eraser mockups
in `.support/features/`. Thirteen entries, one per phase, built in this
order and one phase per run; the plan holds each phase's spec, files, tests
and decisions, and nineteen open questions.

Amended 2026-09-30, after C, from the collaborator's notes. Eleven more
phases go between C and D, each on an engine the API exports and each,
except the Pencil and Smear, modelled on the Illustrator tool it names:
the Shape Stacker, the Wipe Stacks, `X` for fill and stroke, the Pen
renamed Brush, a Pencil with a drawing kit, Smear, Liquify, Split,
clipping masks, and the API sweep. The plan now holds forty open
questions. The version was open question 15: shipped 2026-10-01 as
`1.0.0-alpha.4.6.0`, the minor release the amendment's tools make, though the plan
file keeps its 4.5.1 name.

- [x] **DONE (1.0.0-alpha.4.6.0)** - **Phase 0 - spikes and check hooks**: whether the drawing window can
  stop the menu bar on a bare `Alt`, whether the stroke-profile boundary
  engine subtracts, how few anchors a fitted stroke needs, and what costs at
  a very deep zoom; plus the check hooks the new GUI checks read.
  - Built 2026-09-27: the page can stop the menu bar itself (cancelling the
    `Alt` keyup is enough), so the Alt rule needs nothing from the main
    process; the lifted engine subtracted exactly on every test shape and
    on all 17 marks of the tools-break drawing, with no failures; a fitted
    222-sample pen stroke needs 13 anchors at 1.5 px, which becomes the
    Freehand fidelity default; and depth itself costs nothing, but layers
    with effects grow a canvas with the zoom even out of view, which the zoom
    phase now culls and caps. Five `window.napkinCheck` read-outs are in:
    `inputState`, `strokeSummary`, `layerRows`, `selectionBoxes`,
    `viewState`.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **P - a press can never stick**: the tools-break, reproduced. `Escape`
  or a window blur during a `Ctrl+Space` quick curve leaves the canvas
  believing a pointer is down, and every later press is ignored whatever
  the tool; four more sequences do the same. Whatever ends a press releases
  the pointer, the release acts on the press rather than the tool in hand,
  and a stale pointer heals itself.
  - Built 2026-09-27: `src/renderer/press-state.ts` holds the press record
    and the rules; every press takes the pointer through one call and every
    release lets it go, whichever branch finishes it. A lost window, a
    hidden page or a lost capture finishes a stroke or a drag where it
    stands (only a curve is dropped), a tool chosen mid-press waits for the
    release, and Space, Ctrl and Alt are let go with the window. The new
    check `check-held-keys.mjs` failed 25 of its first 56 assertions on the
    build before the fix; with a Rotate sequence added it passes all 63.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **K - held keys and the Alt rule**: with no press in progress, `Space`
  pans and `Ctrl` gives the last selection tool on every drawing tool; the
  straight line and quick curve are made by pressing first, then `Space`.
  `Alt` opens the menu bar only after 5 seconds with no other key, and never
  after an `Alt` gesture such as `Alt` + scroll.
  - Built 2026-09-27: `src/renderer/held-keys.ts` and `alt-menu.ts` hold the
    rules; a Ctrl chord such as `Ctrl+Z` never brings the selection tool up,
    the Copic nib-rotate is a still hold that movement cancels, and Vector
    Path and Mesh Warp keep their own `Ctrl`. The check's Alt sequences
    watch the real focus: a bare `Alt` after five idle seconds gives the menu
    bar the keyboard, and after a key or a scroll it does not.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **S - Select and Direct Select pick what is under the pointer**: a
  shared hit test in paint order, measured to the painted ink in screen
  pixels, topmost then nearest, erasers never hit; a real **Select
  sensitivity** setting (the slider called "Select pixel sensitivity" is
  the eyedropper's), and Direct Select's reaching every pick.
  - Built 2026-09-29: `src/core/paint-order.ts` gives the order the canvas
    paints in, and the canvas now paints from it; `src/core/hit-test.ts`
    measures each kind of mark's ink as the canvas paints it. Ink an eraser
    has cut away picks nothing, a rubber band takes a line it only crosses,
    and the Paint Bucket, Fill Color, the right-click menu and Mesh Warp pick
    in the same order. Direct Select waits 4 px before a drag edits, moves
    both ends of a closed shape's seam, and lets `Shift` pin every drag.
    The new check `check-select-accuracy.mjs` failed on the build before
    the change wherever the old rules showed, 7 assertions; its two Direct
    Select sequences, which first aimed off the path, fail with the old
    rules put back. It passes all 39.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **Z - zoom to one page pixel**: the deepest zoom makes one page pixel
  span the canvas's shorter side; View > Zoom In and Zoom Out zoom the
  canvas instead of the whole window; thresholds and boxes stay right at
  depth.
  - Built 2026-09-29: `src/renderer/zoom.ts` holds the limits, a length on
    the screen measured on the page, the wheel's steps and the view test.
    Pen samples, the drag thresholds, the selection's box and the rubber
    band are in screen pixels; a magnified image shows its pixels; a layer,
    group or mark with effects is painted past the view by their reach (at
    most half the view's diagonal, a blur held to a third of that) and not
    at all when nothing it holds reaches the view. The new check
    `check-zoom.mjs` failed 12 of its 24 assertions on the build before the
    change and passes all 24. Found on the way: the canvas's last row was
    half painted (the drop-shadow line under Found Issues, resolved), and a
    blur faded toward the canvas's edges, more with the zoom.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **T - the Transform button and the missed rows**: a Transform button
  beside Rotate (the Transform menu has had the row since 4.5.0), and
  Previous Page / Next Page in the Pages menu, which the CHANGELOG audit
  found missed.
  - Built 2026-09-29: the button sits beside Mirror rather than Rotate -
    after Rotate it wrapped the toolbar onto a third row in a 1494-pixel
    window, the owner's screen at 1.5, and took 50 pixels off the canvas.
    It runs `toggle-transform` and is pressed
    (`is-open`, `aria-pressed`) while the box is up; `prev-page` and
    `next-page` are Pages rows of their own block, greyed by two new menu
    questions, `firstPage` and `lastPage`, on `PageUp` and `PageDown`, and
    the page bar's arrows run them. `check-context-menus.mjs` and
    `check-shortcuts.mjs` gained eleven assertions that failed before the
    change; both pass.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **F - freehand with few control points and flat ink**: plain strokes
  are painted as one fill, so translucent ink no longer beads into circles;
  Pen, Marker and Copic strokes are fitted into a few Bezier anchors with a
  **Freehand fidelity** setting, and Sharpen stops multiplying points.
  - Built 2026-09-29: `src/core/fit-curve.ts` fits the samples at commit
    (a drawn S curve keeps 4 anchors), with corners kept, straight runs as
    lines and a stylus's pressure carried on every anchor; Sharpen and
    Sharpen Selection fit their results within 0.35 px. A constant-width
    line is one canvas path, a stylus's a cached one-fill outline. On the
    way: Join kept the first stroke's anchors, and history snapshots and
    two anchor copies dropped the new fields. `check-freehand.mjs` failed 4
    of its 10 assertions on the build before the change and passes all 10.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **L - lines by hand**: the Shift-click line (click, hold `Shift`,
  click, and a straight line joins them at once); the straight line's and
  quick curve's ends snap again; `Shift` gives 45 degrees as well.
  - Built 2026-09-29: point 1 and when a Shift press uses it are
    `held-keys.ts` rules; the line goes on the last mark as one undo step
    (`extendWithLine` in `geometry.ts`), or starts a mark of its own when
    that mark's paint differs, and a drag, `Space` or `Ctrl + Space` carry
    on from point 2. While the press is down the mark paints once, in its
    place. `check-lines.mjs` failed 11 of its first 25 assertions on the
    build before the change and passes all 34.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **V - Vector Path**: `Shift` constrains to 0, 45 and 90 degrees, and
  `src/assets/close-path-indicator.svg` shows on the start point when a
  click would close the shape.
  - Built 2026-09-29: `src/renderer/vector-place.ts` holds where Shift puts
    the next point, the band and a pulled handle, and when a press closes
    the path; the band ends on the first point where the indicator shows,
    at the Direct Select sensitivity (open question 11's recommendation).
    `check-vector-path.mjs` failed 7 of its 18 assertions with the old
    placing rules bundled in, and passes all 18.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **B - the subtraction engine**: `src/core/boolean.ts` lifted out of
  the stroke-profile boundary code, and `src/core/erase.ts`, which cuts a
  region out of marks - by area for fills and broad marks, along the
  centreline for plain lines, which stay strokes.
  - Built 2026-09-29: the stroke profiles' outlines are unchanged (1,200
    compared against the engine before the lift); a failed operation is
    tried again with every vertex moved by a hundred-thousandth of a pixel,
    which took the owner's tools-break drawing from 24 failed cuts to none;
    a shape with anchors keeps them through a cut, only the eraser's edge
    fitted, so 30 bites leave its untouched side exactly where it was. The
    fitter no longer loops out between far-apart samples.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **E - the Eraser subtracts**: no eraser mark, no new layer, every
  selected mark erased, boxes that fit the ink that is left; older files'
  erasers stop being picked or boxed, and **Apply Erasers** turns them into
  real cuts.
  - Built 2026-09-30: the release runs `core/erase.ts` over the selection,
    or every editable mark the swath touches, and `Store.eraseMarks` makes
    it one undo step; the canvas cuts every target's layer while the press
    is down. An older file's eraser marks ride along with their layer's
    selection, so their cuts move with the mark, but draw no box and count
    in no bounds. `check-eraser.mjs` failed 12 of its first 21 assertions
    on the build before the change and passes all 27.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **C - the Shape Eraser**: a tool after Eraser whose press opens a
  panel of Rectangle, Ellipse, Square, Circle and Top Path; a drawn shape
  cuts the selected layers, a closed path on top cuts the rest, and anything
  else gets a notice with "Do not show this notice again" for the session.
  - Built 2026-09-30: `Shift+E` or the button takes the tool and opens the
    panel under it; the drag is the Rectangle and Ellipse tools' press, its
    outline and live cut drawn over the selection, and the release cuts
    with the Eraser's rules in one step; Top Path cuts with the topmost
    closed mark and takes it away (Minus Front). The notices are
    `src/renderer/notice.ts`, session only. The default tool order gained
    the Shape Eraser and the missing Vector Path, resolving that Found
    Issue. `check-shape-eraser.mjs` failed every sequence at its first
    Shape Eraser step on the build before the change (3 of 8 assertions
    passed, the drawing set-ups) and passes all 54.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **R - the Brush**: the Pen renamed Brush, on `B`, with a brush icon;
  Vector Path on `P`; the ids, files and scripts unchanged, with `brush`
  taken as another name for `pen`.
  - Built 2026-09-30: the label, tooltip, menu rows, history names ("Brush
    stroke") and new layers ("Brush N") say Brush; `B` and `P` swapped; a
    three-path brush glyph in place of `✎`. `toolId` / `TOOL_ALIASES` in
    `core/types.ts` take `brush` for `pen` in a script's `tool` and the
    embedded editor's `setTool`; a file already read any unknown tool as
    `pen`. `check-brush.mjs` passed 1 of its 14 assertions on the build
    before the change and passes all of them; seven existing checks gained
    the Brush's name and keys.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **X - fill and stroke**: `X` puts the fill or the stroke in front and
  `Shift+X` swaps them, as Illustrator's control does; the Quick Access
  Colors and the swatches paint the one in front, and new shapes take the
  fill.
  - Built 2026-09-30: the color well became the fill and stroke control
    (`#fill-stroke`, 34 px), `X` is **Sketch > Fill in Front** (a check row)
    and `Shift+X` **Swap Fill and Stroke**; `C` steps the one in front, the
    fill's steps taking in None; the rules are `core/paint.ts` (`paintPatch`,
    `swapPaint`, exported) and `renderer/fill-stroke.ts`. A swatch with a
    selection follows the one in front in place of Fill Shape's rule.
    `check-fill-stroke.mjs` passed 3 of its first 12 assertions on the build
    before the change and passes all 29; `check-color-picker.mjs`, rewritten
    for the rule, passed 8 of 10 before and 10 after.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **W - the wipe engine**: stacking regions (unite, minus front, minus
  back, intersect, exclude, divide) and their faces, pure, with one store
  commit that adds marks on layers of their own; B's and E's engines made
  public.
  - Built 2026-09-30: `src/core/wipe.ts` (`wipeOperand`, `wipeMarks`,
    `arrangeFaces`, `MarkEdit`); the Eraser's rebuild lifted into
    `erase.ts`'s `ringsToAnchors`, which tries every operand's traced
    outline; `Store.applyMarkEdit`, with `eraseMarks` built on it. 24 new unit
    tests; every Eraser test still passes unchanged.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **Y - Wipe Stacks**: Wipe In, Wipe Out (Subtract Top from Below,
  Subtract Below from Top), Mid Wipe, Outer Wipes and Clean Wipe in the
  Transform and canvas menus, each with a quarter-second napkin wipe; the
  `wipe` script verb.
  - Built 2026-09-30: the rows on a new `Combine:element` sub-type, greyed
    by `fewerThanTwoShapes` - on the canvas too, rather than hidden, since
    one row cannot differ between menus; Wipe Out's rows laid out in the
    canvas menu's panel (`inlineDeeperSubmenus`); the napkin wipe from a
    synchronous canvas copy (`Surface.snapshot`, `paintWipe`), 250 ms, ended
    by a press, a key or the wheel, skipped by reduced motion and by the new
    **Wipe animation** setting; the `wipe` verb, with `wipe-skipped`,
    `wipe-empty` and `wipe-failed`, and a golden. `check-wipe-stacks.mjs`
    passed 3 of its first 33 assertions on the build before the change and
    passes all 51.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **M - the Shape Stacker**: Illustrator's Shape Builder beside the Shape
  Eraser - a drag merges the pieces it crosses, `Shift` drags a box, `Alt`
  takes pieces away - with the Wipe Stacks in its panel.
  - Built 2026-09-30: `core/wipe.ts` gained the selection's pieces
    (`stackArrangement`), picking them at a point, along a path or in a box,
    and `stackEdit` / `stackFaces` to merge or remove them - a circle's
    pieces merged back are its four cubics exactly. `#tool-shape-stacker`
    after the Shape Eraser, on `Shift+M`, with its own `stack` press, the
    mesh shading, a plus or minus cursor and the six Wipe Stacks tiles; the
    `stack` script verb and a golden. `check-shape-stacker.mjs` passed 1 of
    its first 7 assertions on the build before the change and passes all 44.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **J - Split**: Illustrator's Scissors - a click cuts a path in two
  where it lands, nothing moving, or opens a closed one.
  - Built 2026-09-30: `src/core/split.ts` (`nearestOnMark`, `splitMark`,
    `splitTarget`, exported): a subpath model over anchors and bare points,
    de Casteljau cuts with the fitted pressure carried, a closed path opened
    round from the cut, a compound shape's ring cut out. `#tool-split` on
    `J` after the Shape Stacker, with a scissors glyph, the
    `split-cursor.svg` cursor and the hover ring; the `split` script verb.
    A ring of bare points opens as a path of corner anchors at the same
    points, the one way it can say it is open. `check-split.mjs` passed 5 of
    its first 20 assertions on the build before the change and passes all 27.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **O - clipping masks**: Make and Release (`Ctrl+7`, `Ctrl+Alt+7`)
  from the topmost selected shape, drawn by every output, and `clip-path`
  read on import.
  - Built 2026-09-30: `src/core/clip.ts` (`makeClip`, `releaseClip`,
    `clipIndex`, `clippedAt`, `shownBounds`, exported) and `Layer.clip`,
    the id of a closed mark inside the group, dropped on load when it names
    none. The canvas clips a clip group's picture before its effects; picking,
    box selection and the dashed boxes skip what is hidden, while Direct
    Select reaches everything. SVG `<clipPath>`, PDF `W n`, the
    composition's `clip` and Illustrator's clipped group; `clip-path` read
    on import, the `<clipPath>`'s shapes read in the group's own space; the
    `clip` script verb. `check-clipping.mjs` passed 6 of its first 26
    assertions on the build before the change and passes all 44.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **N - the Pencil**: a collegiate drawing kit - graphite 4H to 8B,
  charcoal pencils, vine and compressed charcoal - drawing with graded tone,
  pressure and the paper's grain, in every output.
  - Built 2026-09-30: `src/core/pencil.ts` (the table of 30 pencils, the
    kit, `parsePencil`, the coverage rule, the seeded and equalized tooth
    tile, `rasterizePencil` over any region), `Stroke.pencil`, the
    `pencil` tool and `widthAtPressure` (a pencil line from 0.8 of its
    width). `#tool-pencil` after the Copic on `N`, its kit, per-mark
    pictures kept per scale and grown where a live stroke grew; SVG through
    one tooth tile, PNG from the same raster, PDF and Illustrator at the mean
    tone; the `pencil` verb and its golden. The spike: 500 pencil circles
    redraw in 10-12 ms, as 500 Brush circles do. `check-pencil.mjs` passed 3
    of its first 13 assertions on the build before the change and passes all
    39.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **U - Smear**: a blending stump that spreads the Pencil's graphite for
  shading, kept on the marks it touched.
  - Built 2026-09-30: `src/core/smudge.ts` (`smudgeBuffer`, a pass run a
    tenth of the stump's width at a time, trading graphite with the paper as
    density so the darkness is kept, resumable for a live drag;
    `smudgeFor`, the pass a drag leaves on a mark; `mapSmudges`) and
    `Stroke.smudges`, carried by every transform and Mesh Warp. `#tool-smear`
    after the Pencil on `Shift+N`, the stump sized by Quick Width and
    strengthened by Quick Opacity, the live pass run step by step on the
    canvas, one undo; SVG and PDF as the picture, which the importer reads
    back; the `smear` verb. `check-smear.mjs` passed 7 of its first 17
    assertions on the build before the change and passes all 27.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **I - Liquify**: Warp, Twirl, Pucker and Bloat for every other mark,
  carried as Mesh Warp carries its art.
  - Built 2026-10-01: `src/core/liquify.ts`. `liquifyField` makes each brush
    a `PointMap` that falls off as (1 - (d/r)²)² to nothing at its rim.
    `liquifyMarks` runs a drag's dabs over the marks they reach, a push in
    steps of a quarter of the radius at most. `refitLiquified` is the fit
    after the drag: it keeps a straight piece someone meant exactly, fits
    only the runs between, and leaves a path the brush never split as it was. Mesh
    Warp's carrier now takes any `PointMap`. `#tool-liquify` sits after Mesh
    Warp on `Shift+R`, with its panel of four. The brush is a ring on the
    canvas, sized by an `Alt`-drag or `[` and `]`, and Twirl, Pucker and
    Bloat work while held. A drag is one undo, kept in a store transaction
    that `Escape` rolls back. Pencil marks are left to the Smear. Scripts get
    the `warp`, `twirl`, `pucker` and `bloat` verbs. `check-liquify.mjs`
    passed 1 of its first 7 assertions on the build before the change and
    passes all 45.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **A - the API sweep**: every new engine and verb written up with an
  example; the script's `tool eraser` cutting as the Eraser does.
  - Built 2026-10-01:
    - **The engines' pages.** `docs/api/engines/` is a ninth category:
      a section and a worked example for each engine, and a helper that
      applies an edit. `test/api-engines.test.ts` runs all 13 examples and
      checks what each prints.
    - **Erasing.** The drawing reference gains an "Erasing" section. The
      skill knows the new verbs.
    - **Goldens and package checks.** `test/scripts/every-verb.napkin` uses
      all 66 verbs, held to the verb table. pack-check and the graphic-design
      suite call the engines from the built package.
    - **`tool eraser`** cuts the marks before it on its layer (`eraseMarks`),
      with `erase-skipped` for text it passes over.
    - **The writer** writes clip groups as `clip` blocks, and notes older
      eraser marks.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **D - docs sweep and the release**: the version open question 15
  settles (`1.0.0-alpha.4.6.0` recommended with the amendment).
  - Built 2026-10-01. The owner settled open question 15 on `1.0.0-alpha.4.6.0`:
    - It is the version in `package.json`, the three plugin manifests and
      the CLI reference's JSON example.
    - It is in every "New in" and "Changed in" note of the manual, and in
      this section's stamps.
    - The CHANGELOG's `[Unreleased]` became its section, with the release's
      own paragraph.
    - Checked: 1384 unit tests, the GUI suite (37 of 37 files), pack-check
      and the graphic-design suite, all passing.

## Chores

Housekeeping with no user-visible result: dead code left by a replacement,
stray files from a mis-driven save dialog and from animation runs that failed,
a log nobody trims, and one version number that no longer matches what it
carries.

- [ ] **Delete `store.moveLayer`**: `moveLayers` replaced it in 1.0.0-alpha.4.1.0 and
  nothing calls the single-layer version any more. It also carries the old
  behaviour worth not resurrecting - it swapped with whatever sat next in the
  flat stack, which could carry a layer across a group boundary without
  changing its `parent`.
- [ ] **Remove `test/exports/walk.svg`**: written by a save dialog driven with
  synthetic keystrokes while testing the Selection export, not by anything in
  the project. `test/exports/applied_layer_names.svg` was overwritten the same
  way and has been restored from git.
- [ ] **Stale export fixtures**: `test/exports/*.svg` were written before vector
  anchors and before the compact path writer, so they show `L` polylines and
  verbose attributes the exporter no longer emits. No test reads them, which is
  why they went stale unnoticed - either regenerate them from the real importer
  (needs a DOM, like `npm run import-tree`) and assert against them, or drop
  them.
- [x] **DONE (1.0.0-alpha.4.3.0)** - **Promote the GUI harness out of `.tmp/`**: the
  DevTools-protocol scripts that verified 1.0.0-alpha.4.1.0 lived in a gitignored
  folder and would be lost. They were, before this was done: `.tmp/` no longer
  holds them. The driver was rewritten instead, and is checked in as
  `test/gui/cdp.mjs` behind `npm run gui-check`. The menu checks it once ran
  are still owed; that half lives with the **Scripted GUI checks** item under
  Current.
- [x] **DONE (1.0.0-alpha.4.6.0)** - **Run the GUI checks without taking the
  computer**: a run maximized and focused a window about a hundred times, so
  the machine was no use to anyone for its length, and a click or a key at
  the wrong moment failed a check. `npm run gui-check -- --background` keeps
  every window off the screen and out of the focus, pins the drawing page
  to the size the checks were measured at, and skips - and counts - the
  three bare-`Alt` sequences that need the real focus.
- [ ] **1.0.0-alpha.4.1.0 carries features, not just fixes**: copy and paste, the
  Selection export, the pages menu, and the Shift drag constraint all landed
  under a patch version because the version was pinned for the batch. Decide
  whether to re-tag it as 1.0.0-alpha.4.1.0 before release, and write the rule down
  (see the documentation item above).
- [ ] **Delete the stale root `animation-helper.log`**: 519 bytes written on
  2026-08-23 by the first Animation Mode default, which logged to the working
  directory before the `animationLogFile` setting moved logging to `logs/`.
  Nothing writes it any more and `logs/animation-helper.log` is the live one.
- [ ] **Clear the failed frames out of `animations/`**: the folder holds
  `walk_3.svg` (the copy of `walk_2` that the duplicate guard now refuses),
  `animationLayer-attack_1.svg` and `_2.svg` from the attack attempt that was
  posed from a template, and `walk_0-imported.svg`. The folder is gitignored,
  so this is only about not mistaking them for good output later.
- [ ] **`logs/animation-helper.log` never rotates**: 12 KB after a handful of
  runs, and each run writes the command, the frame, timings, stderr, and 2 KB
  of stdout. A size cap or a per-run file would keep it readable.
- [ ] **Fix the `verticla` id in `shapes.svg`**: the vertical line's group in
  `ai-helper/vectors/skills/vector-graphics/assets/shapes.svg` is misspelled.
  The shape library maps it to `vertical`, so no script sees the typo, but the
  vector-graphics skill hands the file out as it is. Rename the id, drop the
  mapping from `src/core/script/library-build.ts`, and run
  `npm run shape-library` in the same change.

## Resolve Issues (`x.y.++`)

Defects promoted from **Found Issues** once they are committed to the next
patch release. Nothing is scheduled here at the moment - the untriaged list is
above, and items move down as they are picked up.

## Major (breaking / large features → next `++.y.z`)

Large or breaking work, each entry changing a contract the rest of the app is
built on. Five entries; Animation Mode's follow-ons are already three items
deep now that its core has shipped, and the GUI redesign is the only one
without a technical shape yet.

- [ ] **Pressure-aware brush engine**: replace the width model with a velocity- and
  tilt-aware dynamic brush (calligraphy, charcoal, ink-wash presets).
- [ ] **Real-time collaboration**: shared sketch books over WebRTC/CRDT so multiple
  pointers can draw on the same page.
- [ ] **Plugin API v2**: stable, documented extension points (custom tools, custom
  sharpen passes, export targets) with a semver contract.
- [ ] **Animation Mode follow-ons**: build on the shipped AI-assisted core.
  - [ ] **Onion skin**: show the neighboring frames at low opacity while a
    frame layer is active.
  - [ ] **Sequence playback**: play a page's `<type>_<n>` frame layers in
    order at a chosen frame rate.
  - [x] **DONE (1.0.0-alpha.4.5.0)** - **Help-menu reference**: an in-app page documenting the required
    assemblies and the frame layer-naming rules.
    - Planned for 1.0.0-alpha.4.5.0: the Help menu of Phase H under **Menus,
      shortcuts and generated scripts** opens the docs page for Automate,
      where the assemblies and the frame naming are documented.
    - Built 2026-09-26: **Help > Tool Types > Automate** opens the Automate
      quickstart in the docs window, which leads to the Animation Mode page:
      the six assemblies, and a new **Frame names** table of how a frame is
      named from the one it is drawn from.
- [ ] **GUI Redesign**: update GUI overall design.
  - Initial sketches
  - Polish and apply
  - System that is easily modified in order to inline with GUI desing trends
    - Highly configurable where uses can also mod, or set and customize UI/UX

## Quick Features (ideas → next `x.++.z`)

Small additive features that need no new contract - twelve of them. The first
seven are follow-ons from the 1.0.0-alpha.4.1.0 drag, clipboard, and export work; the
rest are quick-feature shortcuts.

- [ ] **Show the constrained axis while Shift is held**: a faint guide line
  through the drag origin along the axis the drag has snapped to would make it
  obvious which of the eight directions is in force before letting go.
- [x] **PARTLY DONE (1.0.0-alpha.4.6.0)** - **Constrain a Bézier handle to its anchor, not to the drag start**: the
  Shift constraint measures from where the drag began, which is what was
  asked for and is consistent across every drag. For a handle specifically,
  measuring from its own anchor is the more useful constraint - it gives a
  horizontal, vertical, or 45-degree tangent. Done for the Vector Path
  tool's placing drag in 1.0.0-alpha.4.6.0 (Phase V); Direct Select's and
  the Vector Path edit mode's handle drags still measure from where the drag
  began.
- [ ] **Shift + marquee for a square selection box**: the rubber band keeps
  Shift for adding to the selection, so a square marquee needs another
  modifier if it is wanted at all.
- [ ] **Paste raster from the clipboard**: a PNG or JPEG copied in another app
  could place itself as an image item, the way File > Import already does.
  Only SVG text is read today.
- [ ] **Export Selection to the clipboard**: the crop is already computed, so
  a "Copy Selection as PNG/SVG" beside the Selection export row would skip the
  save dialog for the paste-into-something-else case.
- [ ] **Selection export margin**: an optional padding around the crop, for a
  sprite that wants breathing room rather than a box on its ink.
- [ ] **Page from selection, moving rather than copying**: `From Selection`
  copies the marks onto the new page and leaves the originals in place. A
  modifier (or a second menu row) that moves them instead would finish the
  "give this graphic its own page" gesture.

Follow-on shortcuts in the spirit of Quick Width (`W`) and Quick Opacity (`Q`):
press a letter, type a value within the quick-feature timer, and it applies.

- [ ] **Quick Size** (`Z`): type a font size to retarget the text tool without
  reaching for the size slider.
- [ ] **Quick Symmetry** (`Y`): type a mandala axis count (1 disables) to change
  rotational symmetry mid-drawing.
- [ ] **Quick Page** (`G`): type a page number to jump straight to that page in the
  current sketch book.
- [ ] **Quick Zoom** (`X`): type a zoom percentage (for example `150`) to set an
  exact zoom level instead of pinching to it.
- [ ] **Quick Hex** (`#`): type a six-digit hex value to set an exact ink color
  without opening the color picker.

## Minor (backward-compatible features → next `x.++.z`)

Backward-compatible features: fourteen entries, of which the four largest - the
three features 1.0.0-alpha.4.3.0 shipped, the animation preset cycles, the
`vector-graphics` skill follow-ons and the napkin script follow-ons - carry
thirty sub-items between them.
Most of the animation entries need a skeleton drawn into
`character-wireframes.svg` before any code is written; the two object types that
come apart are drawn in `object-animations.svg` instead.

- [x] **DONE (1.0.0-alpha.4.3.0)** - **The 1.0.0-alpha.4.3.0 features**: three features specified by the mockups in
  `.support/features/`, with the plan for building them in
  `.claude/prompts/features-1.0.0-alpha.4.2.3.md`. They were planned during the
  1.0.0-alpha.4.2.3 patch, and being backward-compatible features they made it a
  minor release: 1.0.0-alpha.4.3.0 carries them and the patch's fixes together. The compound-shape undo fix under **Found Issues**, which all three
  needed first because each pushes history on exactly the shapes it broke, is
  in.
  - [x] **DONE (1.0.0-alpha.4.3.0)** - **Mirror Selection**: a **Mirror** button after
    **Clear** (and `O`, and **Edit > Mirror…**) opens a palette to reflect the
    selection horizontally, vertically or both, in place or as a copy that
    lands beside the original, with Live preview and Show Selection Borders.
    Its preview and commit are one store transaction, which Mesh Warp is
    planned to reuse. This answers the **Flip** item under *The rest of
    Transform* from a palette; a Transform handle still does not flip.
  - [x] **DONE (1.0.0-alpha.4.3.0)** - **Stroke Profiles**: how a stroke's width runs
    along its length - Default, Rounded, Tapered, Wave - picked from a **Stroke
    Profile** control above the Width slider and applied to new strokes and to
    the selection, or to one element from the Properties panel. A profiled
    stroke draws and exports as a filled outline, and its editable centreline
    rides along in data attributes so it imports back as a stroke. Left for
    later: fitting the exported outline with cubic Béziers (Schneider's
    algorithm) instead of a simplified polyline, which would make the file
    smaller and the outline easier to edit in another editor. The polyline is
    what napkin already exports for a freehand stroke.
  - [x] **DONE (1.0.0-alpha.4.3.0)** - **Mesh Warp**: a rail tool that meshes the art
    under the pointer and bends it by pins - click to pin, drag to bend, Delete
    to unpin - with the result baked back into Bézier anchors. This is the
    **Puppet / character warp** item under *The rest of Transform*. The dashed
    ring round a selected pin is drawn, but dragging it to turn the art about
    the pin is left for later.
- [ ] **Animation preset cycles**: walk, run, idle, and knocked down are driven
  by cycles measured from skeletons in `character-wireframes.svg`. The
  rest are offered but posed from a prompt template; each needs a skeleton
  drawn into the asset, after which `npm run wireframe-cycles` measures it and
  the type becomes ready with no further code.
  - [ ] **Character: damage**: hit reaction recoil and recovery.
  - [ ] **Character: taunt**: short expressive gesture loop.
  - [ ] **Character: talk**: mouth and head movement loop for dialogue.
  - [ ] **Character: jump**: crouch, launch, airborne, and landing frames.
  - [ ] **Character: fall down**: losing balance through landing prone.
  - [ ] **Character: attack**: `Punch-Animation` is drawn but not measurable -
    punch_6 and punch_7 are the same pose, so the step between them moves
    nothing and duplicates its source frame. Give the punch a distinct last
    pose, re-run `npm run wireframe-cycles`, and re-map it in the generator.
  - [ ] **Character: ideal fighting stance**: `Ideal_Fight_Stance-Animation` is
    drawn in the asset but has no animation type mapped to it yet.
  - [ ] **Object: rotate**: spin an object around its center or an axis.
  - [ ] **Object: break**: crack and separate an object into pieces.
    `Box_Breaking-Animation` in `object-animations.svg` draws it in three
    frames, but nothing measures it yet - see the object piece cycles entry.
  - [ ] **Object: move**: translate an object along a path with easing.
  - [ ] **Object: explode**: burst an object outward with debris.
    `Cloud_ImpactEffect-Animation` draws the dispersal in five frames, on the
    same terms as break.
  - [ ] **Object frame validation**: object animations skip the character
    assembly check, so nothing yet validates that an object page holds a
    single group worth animating.
- [ ] **`vector-graphics` skill follow-ons**: build on the shipped Bezier-curve
  skill in `ai-helper/skills/vector-graphics/`.
  - [ ] **Path parser**: teach `matlib-script.js` to read an existing SVG `d`
    string, not only emit one, so a path can be measured, split, or simplified
    in place.
  - [ ] **Simplify pass**: apply the skill's resourcefulness rules to a parsed
    path - demote collinear-handle cubics to `L`, fold smooth joins into `S`
    and `T`, and drop control points that do not change the rendered shape.
  - [ ] **B-spline and NURBS reference**: the source material covers both, and
    they are what a true circle and local (rather than global) control need.
- [ ] **Object piece cycles**: `object-animations.svg` now draws a box breaking
  and an impact cloud dispersing, with the pieces named (`base`,
  `stray-piece`, `potential_stray-pieces`, `obsoletes`), but the measurement
  pipeline cannot read it. `wireframe-cycles` measures limb angles against a
  spine and writes one `AnimationPoseStep` per step, and an object frame has
  neither: each piece translates and turns on its own, and pieces appear and
  leave. Measuring it needs a second cycle shape - per-piece offset and
  rotation, keyed by piece - and a form that can carry more than one transform
  for an object frame. Until then the two types stay template-posed with the
  drawing as their reference. The cloud's later frame groups are also spelled
  `Cloude_ImpactEffect_<n>`; worth fixing in the asset while it is open.
- [ ] **Lasso + transform**: free-form lasso selection with scale/rotate handles
  (current Select is rectangular move/delete only).
- [ ] **Shape tools**: explicit line/rectangle/ellipse/arrow tools that emit clean
  geometry without relying on the sharpen classifier.
- [ ] **Color palettes**: savable swatch sets and a recent-colors strip.
- [ ] **Grid & guides**: dot/line grid, snapping, and a ruler overlay.
- [ ] **Per-page background**: choose napkin, graph, dotted, or blank per page.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **Configurable shortcuts**: user-editable keybindings.
  - Planned for 1.0.0-alpha.4.5.0 as **Edit Keyboard Shortcuts**: Phase E under
    **Menus, shortcuts and generated scripts**.
  - Built as Edit > Edit Keyboard Shortcuts (Phase E), 2026-09-26.
- [ ] **Auto-save & recovery**: periodic snapshots and crash recovery of `.skbk`.
- [ ] **Export options dialog**: DPI/scale and transparent-vs-paper background
  choices for raster export.
- [ ] **Prompt to Save**: If a file contains data, and has not been saved; when
 GUI is closed, prompt user to save file.
- [ ] **Napkin script follow-ons**: what 1.0.0-alpha.4.4.0 left for later on
  purpose, with the reasons in `.claude/prompts/api-1.0.0-alpha.4.4.0.md`.
  - [ ] **The `alphabet.svg` face**: text drawn from the `vector-graphics`
    skill's letterforms rather than the built-in single-stroke face. The entry
    under **API Implementation** has the detail.
  - [ ] **The linked file drawn on the canvas, and Embed**: the app shows a link
    as its placeholder. The two entries under **API Implementation** say what
    drawing the file and embedding it would take.
  - [ ] **A long-lived `--jsonl` mode**: `napkin-sketch draw` is a process a
    script, so a host drawing hundreds of graphics pays for a start each time.
    A mode that reads a request a line on standard input and answers a line of
    JSON for each would pay once.
  - [ ] **A store sink**: the evaluator writes to a `ScriptSink`, and the app's
    store could be a second one, so a script could draw into the open sketch
    with undo. That is the replay path the **Automation and Scripting Tool**
    section needs, as a second sink rather than a second evaluator.
  - [ ] **Blend modes**: `multiply`, `screen` and the rest are the next
    thing to lay over a picture after effects, as SVG's `feBlend`; the
    rasterizer composites source-over only, so it needs a compositing
    change first.
  - [ ] **Effects in the app's own controls**: the app draws a mark's, a
    layer's and a group's effects but has nothing to add or change one,
    and Transform and Mirror move a mark without resizing its effects or
    turning a shadow's offset.
  - [ ] **Run the Illustrator script in Illustrator**: `--to jsx` is tested
    against a stand-in for Illustrator's scripting objects, not in
    Illustrator. Run the goal script's `.jsx` and the `test/scripts/` ones in
    Illustrator by hand, check the gradients' direction and length above all,
    and write "verified by hand on Illustrator <version>" into the changelog.
  - [ ] **Illustrator back to a `.napkin`**: a `.jsx` that walks an open
    Illustrator document - its layers, groups, paths with their anchors and
    handles, text frames, and placed and embedded images - and writes a
    `.napkin` script, so a drawing finished in Illustrator comes back as
    instructions rather than as an SVG import.
  - [ ] **`draw --prompt` against each AI tool**: the tests run a stand-in.
    Run the default Claude Code command by hand, then find and document the
    `--helper` command that reads the form and saves the script for Copilot
    CLI, Codex CLI and Gemini CLI, whose non-interactive flags differ.
  - [ ] **A request box in the app**: `promptScript` takes any runner, so the
    main process can run the helper as it runs Animation Mode's, and the
    script it gets back can draw into the open sketch or open as a new page.
  - [ ] **`--prompt` from Node**: `napkin-sketch/node` could export a
    `drawFromPrompt` over the same bridge, for a program that has no model of
    its own and wants the command line's behaviour without spawning it.
  - [ ] **Measured frames without installing Animation Mode**: **Draw
    measured frames** needs no AI tool, no sign-in and no skill, yet it sits
    inside Animation Mode, which exists only with its install record. A
    command outside the mode - on the Edit menu, beside Animation Mode - would
    draw a selected figure's frames with nothing installed, as
    `napkin-sketch render --animate` already does from a shell.

## Animation Mode (new features → next `x.++.z`)

Animation Mode has shipped and its follow-on work is scattered: the preset
cycles that still need skeletons are under **Minor**, onion skin and sequence
playback are under **Major**, the frame defects are under **Found Issues**,
and the reference-pose helper scripts are under **Automation and Scripting
Tool**. This section is for features of the mode itself that are none of
those - additive, backward compatible, and buildable against the mode as it
stands today, which is what makes them `x.++.z`.

Nothing here restates an entry filed elsewhere. Where a feature meets one, it
says which and stops there.

### New Animation Mode Features

Five features, thirty-seven entries. The first is the one that changes what
the mode is for: today the wizard offers a fixed list of movements, and a
user who wants something not on the list has no way to ask for it. The other
four are the gaps that running the mode a few times makes obvious - a prompt
worth keeping, a frame worth fixing rather than redrawing, a step worth trying
twice, and a sequence worth managing as a sequence.

#### User Prompt

A textarea in the wizard whose text reaches the AI helper, so the movement can
be described rather than chosen. Sixteen entries, and the first two matter
more than the rest: the form already tolerates a type it does not know, and
the form is also built on a principle a free-text prompt can quietly break.

- [ ] **The form already half-supports this**: `animationTypeSpec` returns
  `null` for an id it does not recognize, and `buildAnimationForm` already has
  a branch for that - "Advance the pose one readable step of a `<type>`", with
  the pacing line and no cycle text. A custom type does not break the form
  today, it produces a thin prompt. Much of this feature is making that branch
  good rather than adding one.
- [ ] **The tension the feature has to resolve**: the form's first principle is
  stated in its own words - "This is a file edit, not a redraw. Do not
  rewrite, re-emit, or re-draw the geometry" - and it says why, which is that
  printing the document is what made earlier runs run out of time. A free-text
  prompt invites exactly that redraw. The field has to steer toward poses the
  assemblies can reach by rotation without forbidding the geometry work the
  `vector-graphics` skill is named in the form to do.
- [ ] **Say which kind of request is cheap, in the field itself**: a pose
  reachable by rotating assemblies finishes in seconds; a request that needs
  new path geometry is the slow path and may not finish at all. That belongs
  in the placeholder and the note under the textarea, where somebody is
  actually typing, not in documentation read afterwards.
- [ ] **A prompt needs a name as well as a body**: `data.type` is what names
  the layer (`<type>_<n>`) and what `parseFrameName` reads back out. A
  paragraph cannot name a layer. The prompt needs a short slug beside it -
  typed, or derived from the first words and shown for correction in the
  `anim-next-frame` line that already previews `walk_1`.
- [ ] **Where it goes**: `anim-step2-dialog` already holds category, type, and
  frame count. The textarea belongs there, revealed by a **Custom** entry in
  the `anim-type` dropdown, so the wizard grows a field rather than a step.
- [ ] **Replace the preset guidance or add to it**: half of this is answered.
  "walk, but limping" keeps `spec.guidance` and lets the note outrank it where
  they disagree, which is what the note does today. "A cat stretching" still
  wants the preset out of the way entirely, and ranking a template the helper
  can still read is not the same as removing it. That half is the **Custom**
  entry above, and it is one control choosing between the two rather than two
  textareas.
- [ ] **The loop question has no answer without asking**: `spec.loops` is what
  decides whether the form says the sequence must return to its first pose,
  and a custom prompt has no spec, so today that sentence is simply left out.
  A checkbox beside the textarea is the whole fix, and without it every custom
  sequence is told nothing about how it ends.
- [ ] **Pacing already works and should be pinned down**: `frames` is
  independent of the type, so "this frame carries about one Nth of the whole
  movement" holds for a custom prompt exactly as it does for a preset. Nothing
  to build, and worth a test so it stays true when the branch is rewritten.
- [ ] **`AnimationFormData` grows one field, not five**: a prompt string beside
  `type`, with `buildAnimationForm` deciding where it lands. One field is what
  keeps the form testable, and `test/animation.test.ts` already asserts
  against the composed string rather than against the inputs.
- [ ] **The empty-transforms branch is the one that runs**: a custom prompt has
  no measured cycle, so the form takes its "Pose the frame yourself" path,
  which already supplies the assembly list, the joint pivots, and the
  instruction to put a whole-figure shift on every assembly. That branch is
  correct for prompts as it stands and should be reused, not copied.
- [ ] **Objects diverge here the same way they already do**: the object branch
  tells the helper the subject is the frame's root group and there are no
  assemblies to move. A custom prompt against an object keeps that, and
  `anim-category` already decides which branch is taken.
- [ ] **The prompt is written into a file a CLI reads**: it lands in
  `_temp/animation-form.txt` and is handed to the helper. This is the user's
  own text and their own tool, so it is not an escalation - but a prompt
  containing the form's own step numbering or its save path could steer the
  helper into writing somewhere the app is not watching. Bound the length, and
  keep the app's own instructions after the user's text rather than before it.
- [ ] **"A frame or frames" is two features and only one is cheap**: N calls
  with the same prompt is what the existing Keep-and-draw-next loop already
  does and needs no new mechanism; one call emitting N documents is the
  expensive path the form was built to close. Decide which is meant before
  building either, because the second one reopens the failure mode the form's
  first principle exists to prevent.
- [ ] **A prompt that produced a good frame should not vanish with the
  dialog**: the field is transient today and the sequence that follows depends
  on it. This is the whole of **Prompt Library** below and is noted here only
  so the two are built in that order.
- [ ] **Tests**: `test/animation.test.ts` already asserts the form's shape, so
  the new branches want the same treatment - a prompt with and without a
  preset behind it, the loop flag both ways, slug derivation from an awkward
  sentence, and the length bound holding.
- [ ] **Documentation**: the mode is documented in the README, the
  instructions file, and the skill, which is the three-places duplication
  already filed under **Documentation Update Ideas**. A custom prompt is a
  fourth thing those three have to agree about, so it is worth solving there
  first.

#### Prompt Library

Prompts kept, named, and reused, so a description that worked once is a thing
the user owns rather than something retyped from memory.

- [ ] **A prompt is transient today**: it would live and die with the wizard
  dialog, and the sequence drawn from it has no record of what asked for it.
  Storing the prompt with the frames it produced is most of the value.
- [ ] **Where a saved prompt belongs depends on what it describes**: one about
  this character belongs with the document; one describing a house style
  belongs with the install, beside the other configuration in
  `src/core/settings.ts`. Both, probably, and the distinction wants making
  before either is stored.
- [ ] **Seed the library from the presets**: `ANIMATION_TYPES` already carries
  a `guidance` string per type, written to be dropped into the form. Those are
  prompts, and they are good ones.
- [ ] **Which collapses Custom and preset into one idea**: a preset becomes a
  library entry that happens to have a measured cycle attached. That is a
  simplification worth taking, because it leaves one code path where there
  would otherwise be two that drift.
- [ ] **Editing a preset's wording should not need a build**: `guidance` is a
  literal in `ANIMATION_TYPES` today, so improving a sentence means changing
  source and shipping. A library entry that overrides one is the cheap way to
  let a user tune a preset that nearly works.
- [ ] **Names have to uniquify**: the same counter this repo does not have
  anywhere yet, filed under **Found Issues** for pasted layers. A library of
  three entries called `walk` is worse than one.

#### Edit and Continue

Fix a frame by hand and carry on from the fixed version, rather than redrawing
it and hoping.

- [ ] **The gap**: after a frame is drawn the choices are Redraw, Keep and draw
  next, and Done. A frame that is nine tenths right has no route except
  discarding it, and the helper has no reason to do better the second time.
- [ ] **The plumbing is already there**: `saveAnimationFrame` rewrites
  `animations/<name>.svg` with the frame as the app holds it, which is exactly
  the operation "push my hand edits back to the file" needs. This is a UI
  affordance over an existing IPC call more than it is new machinery.
- [ ] **It compounds**: each frame is drawn by editing the one before it, so a
  frame fixed by hand improves every frame after it. That is what makes this
  worth more than the convenience it looks like.
- [ ] **The frame is already editable**: it imports as a `<type>_<n>` group
  layer mirroring its source, so the app's own tools edit it with no import
  step and no special mode.
- [ ] **The duplicate guard has to be told**: `isDuplicateFrame` compares a
  drawn frame against its source, and hand-editing the source changes what
  counts as a duplicate. Editing between steps must refresh what the guard
  compares against or it will start rejecting good frames.
- [ ] **Leaving and returning has to keep the run**: the wizard is mid-sequence
  while this happens, so the job - base name, source index, frame index -
  has to survive the detour. `AnimationFrameJob` already holds exactly those
  three things.

#### Frame Variations

More than one candidate for a step, so a frame is chosen rather than accepted.

- [ ] **One attempt per step today**: a run is a chain of single tries, and the
  only response to a poor one is Redraw, which throws it away before anything
  can be compared with it.
- [ ] **N calls with the same form is the implementation**: the helper writes
  to a path the form names, so variants need distinct paths and nothing else.
  No new prompt, no new branch, no batching.
- [ ] **Showing them is the real work**: two poses differing by a few degrees
  are indistinguishable as thumbnails, so the picker has to show them at a
  size where the difference reads, and ideally against the source.
- [ ] **The cost is linear and the user should see it first**: three variants
  is three helper runs and three times the wait. The count belongs beside the
  frame count in the setup dialog, with the same kind of note that field
  already carries.
- [ ] **The duplicate guard earns its keep here**: variants that all come back
  as the source is the exact failure `isDuplicateFrame` catches, and catching
  it three times in one step is a clearer signal than catching it once.
- [ ] **Distinct from Redraw and worth keeping distinct**: Redraw discards and
  retries, variations keep everything and choose. Both are wanted; collapsing
  them into one button would lose the reason either exists.

#### Frame Strip

The generated frames managed as a sequence rather than as loose layers that
happen to be named in order.

- [ ] **Nothing manages them as a sequence today**: they are layers on a page
  named `<type>_<n>`, and the ordering lives entirely in the names.
  `parseFrameName` reads one back, and that is the whole of it.
- [ ] **Deleting a frame leaves a hole**: the indexes carry the order, so
  removing frame 3 gives 1, 2, 4, 5 - which `parseFrameName` reads perfectly
  happily and a person reading the sequence does not. Renumbering has to be
  part of deleting.
- [ ] **Re-run one frame in place**: the job is derived from a source index and
  a frame index, so re-drawing frame 4 from frame 3 is the existing run
  pointed at a frame in the middle rather than at the end.
- [ ] **Reordering, and what it means**: swapping two frames rewrites their
  names, and every later frame was drawn from an earlier one - so an order
  change is honest about the poses but not about how they were derived. Worth
  saying in the UI rather than pretending the sequence is a flat list.
- [ ] **This is the list Sequence playback needs**: the playback entry under
  **Major** plays a page's frame layers in order and needs exactly this
  ordering. One list, built once, used by both.
- [ ] **The registration problem shows up here first**: frames cropped to their
  own ink do not line up, which is filed under **Found Issues** with its fix
  under **Ideas**. A strip that shows them in order is where a user will
  notice it, so the two want scheduling together.

## API Implementation (instruction-driven graphics → next `x.++.z`)

A headless graphics API: instructions in, a drawing out. The desktop app is
the only way to make a napkin-sketch drawing today, and yet everything it
knows - the sharpen engine, the Bezier model, the layer tree, the SVG writer -
is already browser-safe and already exported from `src/api/index.ts`. What is
missing is a way to *say* what to draw without a pointer. This section plans
that: a small instruction language, an evaluator that emits the same `Stroke`
and `Layer` shapes the GUI commits, and a headless path out to SVG and PDF.

Thirty-four entries, all additive, which is what makes the whole of it
`x.++.z`. Nothing here changes an existing signature or the `.skbk` format,
and a build without the new modules behaves exactly as this one does. The list
reads in pipeline order: the language, the evaluator, the geometry, the
hand-drawn pass, the output, the public surface, the CLI, then the optional AI
bridge and the tests and documentation that make the rest of it usable.

**Planned in 1.0.0-alpha.4.3.0 for 1.0.0-alpha.4.4.0**: the plan, phase by phase,
is `.claude/prompts/api-1.0.0-alpha.4.4.0.md` (gitignored on this machine, like
all of `.claude/`). It maps every entry below to a phase, adds linked graphics,
a `draw` verb reachable from any language, Illustrator output, photo effects
and the `docs/api/` tree with a verbose page, a quickstart and a cheatsheet per
category, and lists sixteen open questions with a recommendation each. Twelve
phases make the minor; effects, Illustrator, the AI bridge and the measured
animation frames are gated behind a `Y` each. All sixteen phases are built
and ship in 1.0.0-alpha.4.4.0 - 0 through V, and the gated F (effects), I (the
Illustrator script), A (the AI bridge) and N (the measured animation frames) -
and the plan's **Progress** section records what each phase decided and found.

- [x] **DONE (1.0.0-alpha.4.4.0)** - **Settle the instruction shape before writing a parser**: two front ends,
  one intermediate form. A line-oriented text script is what a person or an AI
  helper writes; a plain object is what a program builds. Both should lower to
  the same instruction list, and the object form is the one to freeze first,
  because the text syntax can then change without touching anything
  downstream of it.
  - The object form is `src/core/script/instructions.ts`: 55 verbs, each a
    plain object naming its `verb`, which a program in any language can build
    as JSON. `verbs.json` beside it is the verb table the parser will follow,
    and `test/script-instructions.test.ts` holds the two together field for
    field.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **The instruction type**: an `Instruction` union in a new browser-safe
  `src/core/instructions.ts`, beside the other model modules. Every
  instruction carries the source position it came from, so a diagnostic can
  point at the line that caused it, and the union is the one seam the parser,
  the evaluator, and any later front end all meet at.
  - It lives in `src/core/script/instructions.ts`, beside the verb table and
    the rest of the language. A parsed instruction carries
    `at: { line, column }`; one a program built has none, and a diagnostic
    about it names its index in the list instead.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Tokenizer and parser**: verbs, arguments, comments, and blocks, with no
  dependency - the repo has none at runtime and a script language should not
  be the first. `parsePathD` in `core/path-data.ts` is the shape to copy: a cursor
  over a string with one small function per production.
  - `src/core/script/tokenize.ts` and `parse.ts`. The parser walks the verb
    table's forms instead of carrying a function per verb, so a new verb is a
    row in `verbs.json`. `validateScript` checks a script built as JSON the
    same way, and `formatScript` writes either back as text.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Diagnostics that name the line and the column**: `parsePathD` returns
  `null` for anything it cannot read, which is right for an attribute and
  useless for a script. Errors should be collected rather than thrown at the
  first one, so a file with three typos reports three, and each says what was
  expected where.
  - A test reads a script with three typos and gets three diagnostics at the
    right lines and columns, with the rest of the script read. A near miss
    suggests the word that was meant.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Lengths in the language go through `src/core/units.ts`**: `10mm`,
  `0.5in`, `12pt`, and a bare number as px, converted with `toPx` rather than
  by a second table. The properties panel and the Rotate palette already read
  every length this way, and a third spelling of the same arithmetic is
  exactly the thing that drifts.
  - The parser checks every unit against `units.ts` and keeps the literal as
    written, `"10mm"`; converting it with `toPx` happens when the evaluator
    runs the instruction, since a bare number means whatever `units` says at
    that point.
  - The evaluator converts every length with `toPx` as the instruction runs,
    and names in expressions come back in the current units.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Coordinates absolute, relative, and page-relative**: `to 100 200`
  against `by 20 0` is the distinction SVG path data already draws and costs
  nothing to carry; a `50% 50%` measured against the page is what lets one
  script render at more than one page size.
  - The syntax is in: `to` and `by`, and `%` on any length, measured along the
    axis the verb table gives each argument. Resolving them against a page is
    the evaluator's.
  - The evaluator resolves `%` against the current page along each argument's
    axis, and `by` from the path's current point.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **A transform stack**: `push` and `pop` around translate, rotate, and
  scale, applied to the anchors as they are emitted rather than written out as
  an SVG `transform` attribute. Affine invariance means the transformed
  control points *are* the transformed curve, which is what the Rotate tool
  already relies on, and baking it keeps a generated mark indistinguishable
  from a drawn one on export.
  - `push` and `pop` save the paint and the units too. A group or a placed
    definition puts everything back when it ends; a repeat does not, so its
    passes build on each other unless they `push` and `pop`.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **`repeat` and arithmetic, with a budget decided up front**: a row of ten
  boxes should not be ten copies of one line. The evaluator needs a hard cap
  on instructions executed and marks emitted, chosen before the first script
  that hangs a build rather than after it.
  - The budget is decided and measured: `SCRIPT_LIMITS` caps instructions,
    marks, anchors, sampled points and nesting depth. Sampled points turned
    out to be the cost that matters - 50,000 small circles sample to 4.85
    million points, more than the `.skbk` writer can hold in one string.
  - `repeat` runs with a counter and expressions; every pass costs an
    instruction, so even an empty body stops at the budget, and a run that
    reaches any limit keeps what it drew.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Reusable definitions**: a way to draw a shape once and place it many
  times. This is the seam the shape library below plugs into, so the two want
  designing together rather than one retrofitting the other.
  - `define` and `place`, hoisted within their block. A definition reads the
    names in force where it is placed, so a name set before `place` is a
    parameter. The shape library turned out not to need the seam: its shapes
    are anchors rather than instructions, and `shape` fits them to a box.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **The evaluator**: instructions to a `Sketch`. It emits the `Stroke`
  objects `src/core/types.ts` already defines, `vector.anchors` included, so a
  generated drawing is as editable in the GUI as a drawn one and needs no
  import step to become one. Every entry below this one stands on it.
  - `src/core/script/evaluate.ts`, writing to a sink (`sink.ts`) so a replay
    into the live document can be a second sink rather than a second
    evaluator. A generated book loads back through the `.skbk` loader exactly
    as it was built, and one script gives the same book on every run.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Geometry comes out as anchors, never as samples**: the standard the
  import path was already held to. A generated circle is four cubics with
  handle length `4/3 (sqrt(2) - 1) r`, not a polyline, and `points` is
  resampled from the anchors the way the Vector Path tool resamples - so the
  canvas has something to paint and the exporter has something exact to write.
  - Every shape the evaluator draws is anchors, and a test reads a generated
    circle back from its SVG export as the same four cubics. A curve is
    sampled to its size, with the importer's own sampler: about a point a
    pixel along its handles, 4 at the least and 24 at the most.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Layer statements build the tree, not a flat stack**: named layers and
  nested groups with opacity, visibility, and lock. `createLayer`,
  `createGroupLayer`, and the `parent` field are the model already; the
  evaluator only has to keep a stack of layer ids as it walks the script.
  - Naming a layer again goes back to it; a mark drawn straight into a group
    lands on a layer named after the group, as imported loose geometry does.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Paint statements map onto the fields that exist**: color, width,
  opacity, `fill`, `gradient` with stops, `noStroke`, `strokeStyle`, and a nib
  angle for a Copic mark. Each is a `Stroke` field today, so the work is
  naming them in the language rather than adding them to the model.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Text without a DOM is the first real gap**: `Surface.measureText` runs
  on a canvas context, so auto-sized text boxes and every bounds calculation
  that depends on them have no headless answer. Three ways out, wanting a
  decision rather than a discovery: emit the text element and leave it
  unmeasured, require an explicit box on every text instruction, or draw the
  letters as paths.
  - A fourth way, and the third as well: a text item is emitted and measured
    with the built-in single-stroke face the composition renderers share,
    which is what `align` places it by, and `text ... as marks` draws the
    letters as paths in that face.
- [ ] **The `alphabet.svg` asset is the third way out**: the `vector-graphics`
  skill ships two typefaces as letterform groups, one path per letter pair. A
  text-as-paths mode composed from those needs no font metrics at all, and
  gives a drawing made of marks - which is what a sprite or a cut file wants
  anyway. It needs advance widths, which the asset does not carry yet, so
  measuring them into the asset is the first step.
  - `text ... as marks` exists now, drawn with the built-in face. These faces
    would be a second choice for it, once the widths are measured.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **An image instruction takes a data URL and nothing else**: a script must
  not be able to read the filesystem. A caller can load a file and hand the
  API its bytes; the language should have no verb that opens one.
  - `image` takes a data URL, or the name of one the host passes in
    `options.assets`. A path or a web address is refused, and the message
    says how to hand the image over.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **A shape library read from the skill assets**: `shapes.svg` already
  draws squares, circles, ellipses, triangles, polygons, stars, lines at set
  angles, an arc, and a spiral, and `isometric-objects.svg` /
  `perspective-objects.svg` a wheel, a sphere, and a cube in one projection
  each. Those are the primitives a script wants by name, and reading their
  anchors at build time beats re-deriving each one in code.
  - `shape "<name>"` draws 22 of them; the object files carry a cylinder too.
    `npm run shape-library` reads the assets into
    `src/core/script/shape-library.json` with the importer's own element code
    and no browser, and a test fails when the two disagree. A part keeps
    whether its asset filled and stroked it, not the asset's colors.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Arcs and rounded corners derive rather than get eyeballed**:
  quarter-turn cubic pieces with handles `4/3 tan(dtheta/4)` along the
  tangents, which is the rule `arcToCubics` in `svg-import.ts` already
  applies. One helper shared by the arc verb, the rounded rectangle, and the
  circle, so an imported arc and a generated one are the same curve.
  - `arc`, `circle`, `ellipse` and the rounded `rect` are built this way, the
    last three with the importer's own code. A rounded `polygon`'s corners,
    at any angle, are arcs from the same helper as `arc`, so a rounded square
    polygon is the rounded rectangle, anchor for anchor.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **A verb that fits a curve through waypoints**: the skill's
  `matlib-script.js --through` already solves for the handles that put a curve
  through given points. Saying "curve through these five points" is much
  closer to how a shape gets described than dictating two handles per segment,
  and the solver exists.
  - `through` draws it, with an anchor at every point: Catmull-Rom tangents,
    handles a third of each segment, and parabolas at the ends. The skill's
    solver was not ported. It fits one cubic through at most four points at
    fixed parameters, which loops when the points are spaced unevenly and
    leaves the inner points with no anchor to edit.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **The hand-drawn pass is the point of the tool and its least defined
  part**: `sharpenStrokes` turns a shaky human line into a clean shape, and
  this wants the inverse - an exact shape roughened into something that reads
  as drawn. Without it the API generates diagrams anybody could generate; with
  it, it generates napkin sketches, which is the only reason to generate them
  here.
  - `rough <amount>` runs it on every mark after it, in
    `src/core/script/rough.ts`: bowed segments, drift, turned handles,
    overshoot, a fill drawn apart from its line, and a second pass. The
    drawing reference lists how far each part reaches, from the constants.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Seed the roughening, and decide what it perturbs**: anchor positions,
  handle lengths, a slight overshoot at each end, a second pass offset from
  the first. All four are cheap on anchors and awkward on samples, which is
  another reason the anchor rule above is load-bearing. Seeded so one script
  renders the same bytes every run - an unseeded one is useless for tests, for
  diffs, and for anybody who wants their diagram back tomorrow. Worth
  prototyping against `test/imports/` before any of it is specified.
  - Prototyped against the `test/imports/` fixtures at three strengths; the
    constants, and what the prototype showed, are in
    `src/core/script/rough.ts`. The four perturbations were not enough: anchor
    drift alone leaves ruled lines, so a straight segment bows too, by the
    square root of its length.
  - Seeded per mark, from the seed and the mark's own geometry, so one script
    renders the same bytes every run and editing one mark leaves every other
    mark's wobble alone.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Prove the headless path with a test that imports no DOM**:
  `Surface.toSVG` is DOM-free and `test/svg-export.test.ts` says so in a
  comment, but nothing enforces it - a single `document.` added inside the
  class would break the API and pass all 278 tests. A test that renders a
  script end to end in plain Node is the contract that comment is standing in
  for.
  - `test/headless.test.ts` installs a DOM that exists and throws on first
    touch, then runs `Surface.toSVG`, the PDF writer, the `.skbk` round trip,
    the sharpen engine, the path-data parser and both composition renderers
    under it.
  - The same suite now runs a script end to end - read, evaluated, written as
    SVG - with the DOM poisoned.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Raster output has no obvious answer**: PNG and JPEG come off a canvas
  and Node has none. Either the API is honest and offers SVG and PDF only, it
  takes a rasterizer the caller supplies, or it grows the first runtime
  dependency in the repo. The first is the right default; the other two want
  naming as options rather than arriving as a surprise.
  - The composition rasterizer was the answer: `sketchToComposition` lowers a
    sketch into the composition model the way the SVG export writes it, and
    `renderSketch(page, { format: 'png' })` draws it, with no dependency. The
    PNG agrees with the SVG as `rsvg-convert` draws it on at least 99.78% of
    the ink of every fixture in `test/imports/`. A caller-supplied decoder
    survives as `decodeImage`, for placed JPEGs.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **PDF is already there**: `sketchesToPdf` is browser-safe and exported.
  A multi-page script maps onto a `SketchBook` and out to PDF with no new code
  beyond the wiring.
  - `renderBook(book, { format: 'pdf' })`, a PDF page a sketch, each cut to
    its box by its media box.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Crop and registration reuse the Selection export**: the crop box Export
  Selection computes is the same box a generated sprite wants, and one box
  shared across a set of scripts is the fix already filed under **Ideas** for
  animation frames. One option, both uses, rather than two spellings of a
  viewBox.
  - `crop: 'auto'` is the Selection export's box, the ink grown by half the
    widest line, with a pad on top, and `registration` is one box for every
    page. The box is the SVG's view box, the PNG's page and the PDF's media
    box, for every format through one option.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **The public surface and the promise it makes**: a render entry point, a
  straight-to-SVG convenience, and the instruction types, added to
  `src/api/index.ts`. Additive only - every export that is there stays exactly
  as it is, which is what keeps this a minor.
  - `napkin-sketch` exports the language - `evaluate`, `drawSvg`, the render
    calls, the readers and the tables, with their types - and a new
    `napkin-sketch/node` entry holds the file half: `drawFile`,
    `drawToFiles`, `writeBook` and the loaders. `test/api-surface.test.ts`
    holds every name the barrel had before to the list.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Errors come back as values**: a result carrying the sketch and the
  diagnostics beats a thrown string, because a caller generating a hundred
  graphics wants the ninety-nine that worked and a list of what went wrong
  with the other one. It also matches how the importer already reports what it
  could not read.
  - `evaluate` returns `{ ok, book, diagnostics, stats, output }` and never
    throws for anything in a script; an instruction that cannot run is
    reported and skipped.
  - The Node calls keep to it: `drawFile` and `drawToFiles` write what a
    script drew and give back its diagnostics with `ok` false, and only the
    disk throws.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **A `draw` verb on the CLI**: a script file or stdin in, an SVG or a PDF
  out, and no Electron anywhere in the path - `src/cli/index.ts` only reaches
  `require('electron')` inside the GUI launch, so a draw command can exit
  without ever resolving it. That also answers the global-install failure
  filed under **Found Issues**: a CLI that draws is useful on exactly the
  installs where the GUI cannot start.
  - `napkin-sketch draw`, with `check`, `render` and `verbs` beside it, `--json`
    and exit codes for callers in other languages. A test runs the built CLI
    with `require('electron')` made to throw.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Round-trip back into the app**: a script should be able to write a
  `.skbk` as readily as an SVG, so a generated drawing opens in the GUI with
  its layers and its anchors intact and gets edited by hand from there.
  `serializeSketchBook` is browser-safe and already exported, so this is one
  more output format rather than a second pipeline.
  - `skbk` is one of the four formats `renderBook`, `drawToFiles` and
    `napkin-sketch draw --to skbk` write, and `test/gui/check-script.mjs`
    opens a generated book in the app, saves it, and reads its anchors back.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **An optional AI bridge, kept optional**: the settings, the tool list,
  the terminal launcher, and the auth-failure detection in
  `src/core/ai-tool.ts` already know how to run a helper. Natural language to
  an instruction script is a far smaller ask than a posed SVG frame, because
  the output is text in a grammar the parser checks - a bad answer fails
  loudly instead of drawing something subtly wrong. Nothing above this entry
  should need it to work.
  - Built for the command line: `napkin-sketch draw --prompt` hands the
    request to the AI helper through `src/core/script/ai-bridge.ts`, which
    checks the script it gets back and sends it back once with its errors. A
    missing or signed-out tool ends the command with exit code 4, and nothing
    else in the language needs a helper. The app's request box is a follow-on
    under **Napkin script follow-ons**.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **A skill that teaches the language to the helper**: `vector-animations`
  is the model, a skill written so the instruction the helper emits is the
  instruction the parser accepts. Generate it from the verb table rather than
  writing it twice - the cost of a table kept in more than one place is
  already filed under **Documentation Update Ideas**. What it would be
  generated from is generated already: the tables under `docs/api/`, the
  object form's schema, and `napkin-sketch verbs --json`.
  - Built as the `napkin-script` skill in `ai-helper/scripting/`. Its verb
    reference is generated from the verb table by `npm run api-docs`, and
    `test/ai-helper.test.ts` checks its three example scripts.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **This is also how the measured animation frames get drawn with no AI at
  all**: the idea filed under **Ideas** wants the app to apply the transforms
  it has already computed, and `animationFrameTransforms` returns them per
  assembly. An instruction script is precisely a way to say "take this source
  and apply these transforms". The animation path and the drawing path meet
  here, or they get written twice and drift.
  - Built that way: `src/core/script/animation.ts` writes the script - each
    part of the figure copied in with `use` and turned about its joint - and
    `evaluate` draws it, for Animation Mode's **Draw measured frames** and for
    `napkin-sketch render --animate` alike.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Tests**: golden files, a script in and an SVG out, for the language; a
  determinism test that renders one script twice and compares bytes; and a
  geometry test that a generated circle and an imported one agree, which is
  the identity check `test/svg-export.test.ts` already makes about the round
  trip, pointed at the generator instead.
  - Six golden scripts in `test/scripts/`, each compared byte for byte with
    the SVG beside it and drawn twice in one process and once in a fresh one
    (`test/script-golden.test.ts`, rewritten only by
    `npm test -- --update-golden`). A generated circle, written as SVG and
    read back, is its four anchors to two decimals, and a generated circle and
    an imported one were already the same curve. Every phase added its own
    suite; 757 tests in all.
- [x] **DONE (1.0.0-alpha.4.4.0)** - **Documentation**: a README section beside **Embedding the editor**, a
  verb reference, and worked examples. At 1,286 lines the README is already
  where the keyboard-shortcut and editing-gesture items above came from, so
  the place a language goes wants deciding before it is written rather than
  after.
  - Built as `docs/api/`: eight categories with a reference, a quickstart and
    a cheatsheet each, `API.md` as the hub with `API-QUICKSTART.md` and
    `API-CHEATSHEET.md` beside it, and README's *Drawing from a script*. The
    verb, command and exit code tables, the object form's JSON Schema and
    `docs/api/INDEX.json` are generated by `npm run api-docs`, and the tests
    run every script on the pages and follow every link.
- [ ] **Draw a linked file on the canvas, not only its placeholder**: the app
  shows a link as a dashed box with the file's name. The main process could
  read the file - relative to the book's folder, with the rules
  `resolveLinkFromDir` keeps - and hand the renderer its pixels or its
  shapes, so a link looks like what it links. Open question 8 in the API plan.
- [ ] **Embed a link**: a command that turns a linked file into an import, its
  contents brought in and broken into layers in place of the one linked item,
  for a drawing that has to stop depending on the file. Also open question 8.

### New Skill to Auto Generate Design Language

#### New `ai-helper/graphic-designer/`

Ultimate goal here is to make a `DESIGN_LANGUAGE.md` file per conditions from
`Add a new skill 'design-language' that will`, in order to support automated
task where graphics are needed i.e. social media posting.

The plan below replaced the two items it was generated from, and has since been
carried out - it is kept as the record of what the work turned out to be, not
as a queue. Six phases, in dependency order: the fixtures had to resolve before
anything could be tested against them, and the existing helper had to move
before a second one could exist beside it.

Two things the plan learned only by checking, both of which changed it:
`!.claude-plugin/` in `.gitignore` is depth-agnostic, so the moved manifests
were never at risk - the exact-path `ai-helper/installed.json` rule was; and
`dist/api/index.js` could not be imported from Node at all, which the PNG
analysis was the first thing in the repository to notice.

- [x] **Phase 0 - Fix the fixture symlinks.**
  `test/graphic-design-api/skill/` carries the two graphics the helper is
  tested with. Git already stores both as mode `120000` and `core.symlinks` is
  true, so the mechanism is right and nothing needs converting to a shortcut or
  to a committed copy. Both targets are wrong: written relative to the
  repository root rather than to the link's own directory (which is what
  `mklink` does when it is run from somewhere else), and the `.png` names
  `created-svg_graphic-api.png`, which does not exist.
  - Correct targets are `../created-svg_graphic-api.svg` and
    `../created-png_graphic-api.png`.
  - **Re-broken and re-fixed in 1.0.0-alpha.4.2.1.** The graphics later moved into
    `reference-graphics/` and the targets were not moved with them, so both
    links dangled again and took eleven tests with them. Now
    `../reference-graphics/created-*-graphic-api.*`, with the same failure and
    the same fix one directory deeper - which is the argument for the standing
    test that reads them rather than for remembering.
  - Write them through `git hash-object` and `git update-index --cacheinfo
    120000,...`, not through `mklink`: git stores the target verbatim, so a
    backslash path would resolve on Windows and nowhere else.
- [x] **Phase 1 - Move the existing helper to an exclusive path.** `git mv`
  everything at the `ai-helper/` root into `ai-helper/vectors/`, and write a
  container README above it. Then update every independent spelling of the old
  path: the marketplace `source`, `ANIMATION_PLUGIN.dir`, the wireframe script's
  asset paths, the form text in `animation.ts`, and the comments in
  `animation-cycles.ts`.
  - `package.json`'s `files` already lists `ai-helper`, which covers both
    plugins as a parent - no change.
  - `.gitignore` needs no change either: `!.claude-plugin/` has no leading
    slash, so it re-includes a manifest at any depth against the global `.*`
    rule. What is depth-sensitive is `ai-helper/installed.json`, an exact path,
    which is why the record stays where it is.
  - A record written when `--to plugin` meant `ai-helper` must be migrated on
    read, or an uninstall sweeps the container root.
- [x] **Phase 2 - Give the installer a helper registry.**
  `scripts/install-ai-helper.mjs` spells one plugin's payload out in five
  constants. Replace them with a `HELPERS` map and derive `installTo`,
  `uninstallFrom`, `pluginFiles`, `syncPluginVersion` and `targetDir` from it.
  - `--helper <name>`, repeatable; every helper by default.
  - `animation-mode.mjs` names `vectors` explicitly, so Animation Mode's
    install and uninstall reach exactly what they always did.
- [x] **Phase 3 - Build `ai-helper/graphic-designer/`.** A manifest, a README,
  `/graphic-designer:design-language`, a contract, and two skills.
  - `design-language`: analyze a media file, write `DESIGN_LANGUAGE.md` - or
    `DESIGN_LANGUAGE-<stem>.md` when one exists - then generate a lightweight
    skill named `<stem>` in the installed target's skills folder, colliding to
    `<stem>_0`, with scripts that compose new assets through the graphic-design
    API.
  - `scripts/analyze-media.mjs`: dependency-free, importable. An SVG yields
    colors weighted by class usage, plus type, strokes, radii and an element
    census; a PNG is decoded through the API and quantized; JPEG and GIF have
    no decoder and say so. An empty palette means "not measured", never "no
    colors".
  - `graphic-design-api`: the port of the existing graphic-designer skill,
    renamed so it does not collide with the untracked `.github/` copy, and
    rewritten around composition calls rather than CSS.
- [x] **Phase 4 - Tests.** The skill-uniqueness test asserts an exact set, so
  it has to read the registry rather than two constants. Add a suite for the
  new helper: the symlinks resolve and are committed as portable symlinks, an
  SVG and a PNG of the same graphic yield the same paper and ink and an
  overlapping palette, and an undecodable format reports why.
  - Add a test that the `.mjs` registry and the `.ts` constants agree. The
    script cannot import the TypeScript, so nothing else holds them together.
- [x] **Phase 5 - Documentation.** README (the tree, the paths, a section for
  the second helper, and the line claiming `ai-helper/` is the plugin, which
  stops being true), CHEATSHEET (the `npm run ai-helper` rows, absent
  entirely), API.md (a pointer to the helper that drives it), and the
  changelog.

## Automation and Scripting Tool (generated scripts → next `++.y.z`)

The app writing its own scripts. Four capabilities that look separate and are
one mechanism: **record** a drawing session as instructions, **replay**
instructions through the app's own API, **generate** a helper script for the
Animation Mode AI tool from the layers a user assembled, and **organize** a
selection into named, nested groups by rule. Each of them is a script that the
app writes and then either hands to a tool or runs itself.

Filed beside **API Implementation** rather than beside **Major** because
nothing here can start before that language exists - a recorder with no
notation to record into is a macro, and macros rot. It is `++.y.z` for a
reason the first item explains: recording every document change means every
document change has to travel one observable path, and today they travel
fifty. That is a contract the rest of the app is built on, which is this
file's own definition of a major.

Thirty-three entries: the recorder, the replay path, the Animation Mode
helper scripts, the rule-driven layer organizer, then what the four share.

1.0.0-alpha.4.5.0 builds the tracker and the script generators under
**Menus, shortcuts and generated scripts**: Track History records at the
store's history boundary by diffing the snapshots around a step and naming
the command that ran, which is the coalescing boundary the third entry
points at, and Generate Script writes a media file, the selected layers or
the tracked steps as a script that is shown before it is saved. The command
layer, the store sink for replay, the Animation Mode helper scripts and the
layer organizer stay here, and the entries below that the release answers
are stamped with what it built and what it left.

- [ ] **The recorder needs a command layer, and that is the breaking change**:
  `SketchStore` exposes roughly fifty mutating methods and the renderer calls
  them from 9,605 lines of handlers. To record a session, every one of those
  has to announce what it did in a form that can be written down and re-run.
  That is a new contract for the store, it touches every call site, and it is
  the single largest piece of work in this section. Everything else here is
  cheap once it exists.
- [ ] **The undo history cannot be the recorder**: it is tempting, because a
  history step is already the boundary a recording wants. But `pushHistory`
  stores a `PageSnapshot` - a deep clone of every stroke and layer - so the
  stack holds *states*, not the actions between them. Replaying it would
  restore documents rather than draw them, and it is capped at
  `HISTORY_LIMIT` besides. The command layer above is separate work, and this
  entry exists so the shortcut is refused once rather than reconsidered every
  time somebody notices the resemblance.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **Record intent, not pointer events**: a recorded drag is one
  instruction, not the sixty pointer moves it was made of. The boundary
  already exists in the store, which is the encouraging part - `moveStrokes`,
  `setStrokeProps`, and `setLayerProps` all take a `history` flag precisely to
  separate the intermediate calls from the committed one. The recorder should
  coalesce on the same boundary rather than invent a second one.
  - Built 2026-09-26: Track History closes a step at the store's history
    boundary - the next `pushHistory`, transaction, undo, redo or page
    change - so a drag is one step, as it is one undo.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **A recording is a script somebody can read**: the output should be the
  instruction language a person would have written by hand, with names and
  round numbers, not a trace of internal ids. A recording nobody can edit
  afterwards is worth about as much as an undo stack, and the whole point of
  recording into a language is that the result is source.
  - Built 2026-09-26: **Generate Script > From Session History** writes
    napkin script through the script writer - layer names, numbers to two
    places, no ids - with a comment before each step's first mark giving its
    index, tool type, command and time.
- [x] **PARTLY DONE (1.0.0-alpha.4.5.0)** - **Start and Stop Recording, and what the buttons promise**: where they
  live, what shows while a recording runs, and what happens to one in progress
  when the window closes or the page changes. The close prompt already exists
  for unsaved work and is the pattern to follow.
  - Built 2026-09-26: **Automate > Track History** starts and stops it,
    its row checked while it records, and **History Limit** sets how many
    steps are kept. A page change keeps each step with its page; a new or
    opened document starts again, and turning it off clears the steps. Left:
    closing the window asks nothing about the steps recorded, and nothing in
    the window itself shows that recording is on.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **Decide what is in scope before writing any of it**: document mutations
  belong in a recording; zoom, pan, panel toggles, and which tool is selected
  are view state and mostly do not. Mostly, because the tool, the color, the
  width, and the sharpen options *are* what a drawing instruction needs. The
  line runs between "changes the document" and "changes the view", and it
  wants drawing once, in writing, rather than per method.
  - Built 2026-09-26: only the document is recorded; zoom, pan, the panels,
    the tool in hand and the colour are not, except as the marks they paint,
    which carry their tool, colour and width. Written down once, under
    *Tracking history* on the site's Automate page.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **A recording carries its preamble**: page size, background, and the
  sharpen settings in force. Live-sharpen makes this sharp - a session
  recorded with `liveSharpen` on and replayed with it off draws different
  marks - so the settings that shaped the strokes belong in the script's head,
  not in the environment it happens to be replayed in.
  - Built 2026-09-26: the script opens with the version, the page and the
    time it was written from, then `page` and `background`. The sharpen
    settings need no line of their own: the script draws each mark as it
    came out of the sharpen pass, so running it draws the same marks
    whatever the settings are.
- [ ] **Replay runs the same evaluator against a different sink**: the
  headless path builds a `Sketch` from nothing; replay applies the same
  instructions to the live document through the store. One evaluator with two
  sinks, decided as an interface up front, or the two grow apart and the
  recorder starts producing scripts only replay can run.
- [ ] **Replay's history granularity is a decision, not a detail**: a
  200-instruction script that pushes 200 undo steps is unusable, and one that
  pushes a single step cannot be partially undone. A script-level step with an
  opt-out is the likely answer; it needs choosing before the command layer is
  written, because the command layer is what implements it.
- [ ] **The round-trip test is the only proof the recorder works**: record a
  session, replay it into an empty document, and compare. Anything less is a
  demonstration. `test/svg-export.test.ts` already compares documents through
  their export, which is the comparison to reuse.
- [ ] **A script that runs against the live document can destroy work**: the
  replay path can delete, regroup, and overwrite. It needs a dry run that
  reports what it would do, a default that previews rather than commits, and
  the destructive verbs called out in the report rather than buried in a
  count.
- [ ] **Animation Mode: a button that writes the helper script**: the mode
  already writes `_temp/animation-form.txt` and `_temp/animation-source.svg`
  and runs the helper over them through `runAnimationHelper`. A generated
  script beside them is wiring rather than architecture, which is why this is
  the capability that can ship first.
- [ ] **User-drawn reference poses are the real idea here**: today the helper
  gets one source frame plus a ready-made `transform` per assembly, which
  works for the types with a measured cycle and templates the rest. A user who
  draws `<base>_1` and `<base>_2` by hand has supplied two extremes, and that
  turns the ask from "advance this pose one step" into "interpolate between
  these two" - a much narrower question, and one a helper answers better.
- [ ] **The layers are already named for it**: `parseFrameName` picks
  `<base>_<n>` out of a layer name today, so the reference poses need no new
  naming convention and no new wizard field. What they need is for the form to
  carry them: `AnimationFormData` grows a references list beside `assemblies`
  and `transforms`.
- [ ] **Frame count relative to the references**: the wizard already asks for
  a count and the form already carries it as `frames`, described there as
  pacing rather than a batch size. With two references that number becomes
  meaningful arithmetic - frame 3 of 8 sits three eighths of the way between
  the extremes - and the generated script should say so in those terms rather
  than restating the count.
- [ ] **The script names skills the way the form already does**:
  `animationFormReferences` resolves whether the helper reads bare skill names
  or plugin-namespaced ones from the delivery, and it is right. A second
  generator that resolves this a second way is how the two start disagreeing
  about what the helper is allowed to read.
- [ ] **This is the route for the types with no measured cycle**: nine
  animation types are offered and posed from a prompt template because no
  skeleton has been drawn for them. Two hand-drawn extremes are a cycle the
  user supplies directly, which makes the reference-pose path the answer for
  every type the asset does not cover - a much larger claim than a better
  prompt, and the reason this entry is worth the work.
- [ ] **A generated sequence still has to be checked**: measuring the produced
  frames back is already filed under **Ideas**, and reference poses make it
  answerable - the measurement has two known endpoints to compare against
  instead of only a cycle. The generator and the check want building together.
- [ ] **Layer organizing is a rule engine, not a naming function**: a rule is
  a predicate over a mark and its context plus an action that names it, groups
  it, or nests it. Framing it that way keeps the preset rules and the user's
  own rules the same kind of thing, which is what makes the feature
  configurable rather than a fixed pass with settings bolted on.
- [ ] **The predicates that exist today**: `fill`, `gradient`, `noStroke`,
  `strokeStyle`, `tool`, open against closed via `isClosedStroke`, bounds,
  and depth in the layer tree. Filled against unfilled is one predicate among
  these and the obvious first, but a rule set with only that one will sort a
  drawing into two piles and call it organized.
- [ ] **Containment is the expensive predicate and the useful one**: "this
  path sits inside that shape" is what turns a pile of marks into a figure,
  and it is bounds at cheapest and point-in-path at correct. Every mark
  against every other is quadratic, so it needs a bound on how many marks the
  rule will consider before it is offered at all.
- [ ] **Names have to uniquify, and nothing in the repo does that yet**: the
  paste path already makes two layers called `X - Copy`, which is filed under
  **Found Issues**. An auto-namer multiplies that problem by however many
  marks it touches - ten layers called `fill` is worse than ten called
  `Layer`. The counter belongs in the store beside the naming, once, for both.
- [ ] **Grouping goes through the store methods that exist**: `groupLayers`,
  `reorderLayer`, and `setLayerProps` already build and re-parent the tree
  correctly. The rule engine decides *what* to group and calls them; it should
  not grow tree-building code of its own, which is how the drag-reorder and
  button-reorder disagreement above happened.
- [ ] **Preset rules ship, user rules are configured**: where a rule set lives
  (`src/core/settings.ts` holds the app's configuration today), what it is
  written in, and whether a rule set is per document or per install. If a rule
  set is itself a script in the instruction language, the whole section has
  one notation instead of two.
- [ ] **The assembly preset is the one worth having first**:
  `REQUIRED_ASSEMBLIES` and `matchesAssembly` already say what Animation Mode
  needs a character's layers to be called. A rule set that turns a drawn
  figure into those five assemblies plus the head is the preset that pays for
  the engine, and it closes the wizard's mapping step for anybody whose
  drawing follows the convention.
- [ ] **Preview before it runs, always**: a rule pass that regroups a hundred
  layers wrongly is either a hundred undos or one, and neither is a good
  experience without seeing it first. The preview is a report of what would
  change, in the panel's own terms - this layer becomes that name, inside that
  group.
- [ ] **The generated scripts share one temp folder and want one owner**:
  `_temp/` holds the animation form and source today and is cleared through
  `clearAnimationTemp` when a run completes. Three more generators writing
  into it needs one rule about who writes, who reads, and who deletes, decided
  before the third one is written rather than after a run deletes another
  run's file.
- [x] **DONE (1.0.0-alpha.4.5.0)** - **A generated script is code the user did not write**: the app writing a
  script and running it without showing it is the shape of the thing people
  are right to distrust, and it is also how a bug becomes invisible. Show it,
  default to confirming, and let the setting for skipping the confirmation be
  the user's own decision rather than the default.
  - Built 2026-09-26: every generated script opens in the **Generated
    script** dialog before anything uses it, and **Open as New Page** runs it
    into a page of its own, never over the page in view. No setting skips
    the dialog.
- [x] **PARTLY DONE (1.0.0-alpha.4.5.0)** - **Recording, replay, and generation all read the same limits**: the
  instruction budget the API section calls for is the same budget a generated
  script needs, and a recording of a long session is exactly the case that
  finds it. One cap, named once.
  - Built 2026-09-26: **Open as New Page** runs a generated script through
    the evaluator `napkin-sketch draw` uses, under its budget. Track History
    has a limit of its own, **History Limit**, which counts steps rather than
    instructions, so the two are not one cap yet.
- [ ] **Scripts are a compatibility surface once anybody saves one**: a
  recording kept for six months has to still replay. That means the language
  gets a version marker, replay refuses what it cannot read instead of
  guessing, and the `.skbk` precedent applies - `SKETCHBOOK_VERSION` and
  `normalizeSketchBook` are how the document format already handles this and
  the pattern is worth copying rather than reinventing.
- [x] **PARTLY DONE (1.0.0-alpha.4.5.0)** - **Where the buttons live is a real question, not a detail**: recording
  controls, a Run Script row, an Organize Layers action, and the Animation
  Mode generator are four new entries in a GUI that already has a menu bar,
  three panels, and a mode. Deciding this alongside the **GUI Redesign** entry
  under **Major** is cheaper than deciding it twice.
  - Answered for the generators in 1.0.0-alpha.4.5.0: an **Automate** top-bar
    menu, drawn in `.support/feature-generateScripts/menuItem-Tools.png`.
  - Built 2026-09-26: the Automate menu holds the generators and the
    recording controls, Track History and History Limit. A Run Script row,
    Organize Layers and the Animation Mode generator wait for their features.
- [x] **PARTLY DONE (1.0.0-alpha.4.5.0)** - **Tests**: a recorder round trip, a replay determinism test, a rule
  engine with fixture documents and expected trees, and a form test that the
  generated helper script names the right skills for each delivery -
  `test/animation.test.ts` already covers the form and is where the last one
  belongs.
  - Built 2026-09-26: `test/history-script.test.ts` records sessions
    through the store and plays them back, every step ticked drawing the page
    as it is, and `test/script-writer.test.ts` writes every fixture as a
    script and draws it back to the same SVG, byte for byte. The rule
    engine's and the helper script's tests wait for those features.
- [x] **PARTLY DONE (1.0.0-alpha.4.5.0)** - **Documentation**: what a recording captures and what it deliberately
  does not, the rule format, and the Animation Mode reference-pose workflow.
  The last of these lands in the three places the animation tables already
  live, which is the duplication filed under **Documentation Update Ideas** -
  worth solving there before adding a fourth.
  - Built 2026-09-26: what Track History records and what it does not is
    on the site's Automate page. The rule format and the reference-pose
    workflow wait for their features.

## Patch (fixes, polish, internal → next `x.y.++`)

Fixes and internal polish. Only one entry stands here: most patch-sized work in
1.0.0-alpha.4.1.0 was found and finished in the same sitting rather than queued, and
what was left behind is filed under **Found Issues** and **Chores** above.

- [ ] **Panel Improvements**:
  - [ ] **Resize Panels**: Allow the side and top panels to be resized.
  - [ ] **Undock Panels**: Allow the side and top panels to be undocked and moved freely outside of the GUI window.
  - Note: the editing popups now dock and undock through
    `src/renderer/popup.ts`, and this item is the same idea pointed the other
    way - a panel that starts docked and floats, rather than a popup that
    starts floating and docks. Whichever is built second should use the first
    one's machinery rather than a second copy of it. Moving a panel *outside*
    the window is the one part that machinery cannot reach: that needs a
    second `BrowserWindow`, which is a bigger question than the docking is.

## Complete

Thirty-one shipped entries, roughly newest first, each noting the group it
graduated from. The newest is the graphic-design API, which is unreleased; then
the Rotate tool, which lands with Move in the 1.0.0-alpha.4.1.2 batch; then the
plugin work, and the eight after that are the 1.0.0-alpha.4.1.0 batch: the clipboard,
the Selection export, the pages menu, and the drag and layer-integrity work.

<details>

<summary>Show Details</summary>

- [x] **Simple graphic design elements**: a composition API in
  `src/core/graphic-design/`. `createComposition()` opens a page - 360 by 360
  pixels unless a size is named, in pixels unless the page asks for inches,
  millimetres or points - and a method per element appends rectangles (rounded
  or not), circles, ellipses, triangles (three points, or a box and a
  direction), polygons, polylines, lines, SVG-syntax paths, text, placed media
  and groups. Text carries character styling (family, size, weight, style,
  letter and word spacing, decoration, case) and paragraph styling (alignment
  including justification, line height, wrap width, paragraph spacing, indent,
  and what `y` measures). Media placements take a data URL, a box that sets
  their position, a `fit`, and a clipping mask given either as a shared id from
  `defineClip` or as a shape written inline. Headless by default: the GUI's own
  canvas is drawn into only through `paintComposition`, which the renderer
  hands its context to. Documented separately in `API.md`, as asked, and the
  two sample graphics are rebuilt from one document in
  `test/graphic-design-api/cheatsheet.ts`.
  - **Both formats are one document**, which is the part worth keeping: the
    page, the elements, their order, geometry, colour, transforms, masks and
    text layout are shared by construction, so the difference between the SVG
    and the PNG is the media export format and nothing else.
  - **The raster answer this section asked for.** **Raster output has no
    obvious answer** above filed three options and called an SVG-and-PDF-only
    API the right default. A fourth turned out to be available: write the
    rasterizer. Scanline coverage at four sub-rows a pixel, stroke outlining,
    clipping as multiplied coverage, bilinear image sampling, a PNG encoder
    that picks a row filter per row, and a DEFLATE codec underneath it - all of
    it browser-safe, none of it a dependency, and deterministic to the byte.
    The caller-supplied rasterizer from that entry survives as the
    `decodeImage` hook for the image formats this one does not open.
  - **Text is measured once and drawn twice.** The SVG writes live `<text>` in
    the family the element named; the rasterizer draws a built-in single-stroke
    alphabet, since a PNG needs a font engine and Node has none. Both measure
    with the same table, so line breaks, alignment and block extent match to
    the unit and only the glyph shapes differ. Named as a limit in `API.md`
    rather than left to be discovered.
  - **Tests**: `test/graphic-design-api.test.ts` renders the reference
    composition and its variations - other palettes, moved elements, both at
    once - to both formats, probes the pixels against the colours the document
    declares and the markup against the same, and checks that a second render
    is byte-identical. The files it draws are temporary, land in `.tmp/`, and
    are deleted on the way out unless `npm test -- --keep-graphics` says to
    keep them.
  - From: API Implementation
- [x] **Rotate tool**: `Ctrl+R`, or the Rotate button beside Move, opens a
  palette that turns the selection about a centre point - dragged by hand on
  the canvas (clockwise positive, counterclockwise negative) or typed as an
  angle. The centre is movable three ways: drag the crosshair, pick one of the
  nine handles of the selection's box, or type it in any length unit. Bezier
  anchors and tangent handles turn with the path and a Copic nib keeps its
  bearing; a drag commits as one undo step. Does not close **Lasso +
  transform** below, which still wants handles on the selection itself, or
  the Animation Mode **Object: rotate** cycle, which is a different thing.
  - From: Roadmap
- [x] **Publish the `vectors` plugin**: the marketplace manifest is committed
  at the repository root and its `source` points at `ai-helper/`, which is now
  the plugin itself - manifest, `/vectors:animation-mode` command,
  `animation-frame` subagent, both skills, and the contract. So it installs
  with `/plugin marketplace add isocialPractice/napkin-sketch` and no clone,
  and the skills still exist exactly once: the `plugins/` build output that
  would have duplicated them is gone. A test fails on any repeated skill name.
  - From: Minor
- [x] **Shift-constrained dragging**: holding Shift pins a drag to the nearest
  axis or 45-degree diagonal, chosen from the pointer's travel since the drag
  began and re-chosen as it moves. Applies to moving a selection, the Alt-drag
  copy, Direct Select and Vector Path anchor/handle/path drags, and the
  Space + drag pan. A Shift-press on an already-selected element now defers its
  deselect to the release, so the same press can start a constrained drag.
  - From: Quick Features
- [x] **Layer restacking moves the whole selection**: every selected row moves,
  each as a block carrying its nesting and travelling only among its own
  siblings, and a selected group can be restacked at all (it used to be
  refused outright).
  - From: Resolve Issues
- [x] **Alt-drag copy pointer**: two arrows, the second stepped out beside the
  first in the inverse fill with a node square, shown while Alt arms a copy and
  for as long as one is being dragged.
  - From: Patch
- [x] **Copy and paste**: `Ctrl+C` / `X` / `V`, `Ctrl+Shift+V` paste in place,
  and `Ctrl+D` duplicate, reachable from the Edit menu, a right-click on the
  canvas, and the keyboard. Paste aims at the pointer, cascades when there is
  none, and the clipboard belongs to the app so a copy crosses pages. A copy
  also goes out to the system clipboard as SVG, and SVG copied in another
  editor pastes in through the importer.
  - From: Major
- [x] **A copied group keeps its layers**: copying a group and pasting rebuilds
  the tree - names, opacity, visibility, lock, and paint order - as a sibling
  of the original with only the root suffixed `" - Copy"`. The same rule covers
  `Ctrl+V`, `Ctrl+D`, and the Alt-drag copy, and a group is recognised whether
  it was reached by its panel row or by picking out its marks on the canvas.
  - From: Resolve Issues
- [x] **Export Selection**: export only the currently selected layers or
  elements, on a document cut to their own dimensions. PNG and SVG come out
  transparent; JPEG and PDF keep the page background.
  - From: Minor
- [x] **Pages panel menu**: a hamburger beside `+ Page` holding **From
  Selection** (a page measured from the selection, carrying a copy of it),
  **Default New Page**, and **Custom New Page…** (Page Settings as a size
  prompt for a page that does not exist yet).
  - From: Quick Features
- [x] **Menus toggle and nest**: a button that drops a menu closes it on the
  next press and reads as pressed meanwhile; a menu row can hold nested entries
  that open beside it on hover and stay put long enough to be reached.
  - From: Patch
- [x] **Maintain SVG integrity on import and export**: imported path data is
  parsed into Bézier anchors (quadratics elevated, arcs approximated, shapes
  built from attributes) rather than sampled into polylines, fill-only shapes
  stay fill-only, and export writes two-decimal coordinates - so a file
  imported and exported unedited keeps its geometry. Guided by the
  `vector-graphics` skill's simplified/resourceful standard.
  - From: Resolve Issues
- [x] **Maximized default window**: the GUI window opens maximized instead of at
  its 1280x860 default size, keeping the minimize, restore-down, and close
  buttons in view; `-f, --full-screen` still opens full screen without them.
  - From: Patch

- [x] **Animation Mode** (redesigned; the removed 2026-08-22 first
  implementation was replaced by an AI-assisted design, and the 2026-08-23
  batch generation by one frame at a time): app mode toggled with
  `Ctrl + Shift + N` or Edit > Animation Mode. Validates the page against the
  required character assemblies, then a wizard maps missing assemblies onto
  layers and collects the category and animation type (ready-made preset:
  character walk) - no frame count. Each run hands one pose to a configurable
  AI helper command, which applies the `vector-animations` skill and advances it a
  single step by setting one SVG transform per assembly (the app measures the
  joints and supplies the finished values, so a frame is a file edit, not a
  redrawn document); the drawn frame imports as a `<type>_<n>` group layer
  mirroring its source and is offered for Redraw / Keep and draw next / Done,
  so the sequence runs as long as the cycle needs.
  - From: Major
- [x] **Delete key deletes selected layers**: elements first, else the
  highlighted layer rows.
  - From: Minor
- [x] **Properties panel**: an element property sheet with Position (px / in /
  mm / pt), Appearance (fill, gradient editor, stroke width / style / none),
  and Scale (% or absolute, uniform by default).
  - From: Minor
- [x] **Layer position shortcuts**: `Ctrl + ]` and `Ctrl + [` restack the
  active layer.
  - From: Minor
- [x] **Join consolidates layers**: joined strokes merge onto one layer and
  the layers the pieces vacated are pruned.
  - From: Resolve Issues
- [x] **Layer rename shortcuts**: `F2` and a double-click anywhere on a layer
  row open the inline rename with the current name highlighted.
  - From: Minor

- [x] **Maintain exported layers**: exported SVGs flattened layer groups into a
  flat list of `<g>` elements; groups now export as nested `<g>` elements that
  mirror the layer tree, so an imported document's hierarchy survives re-export.
  - From: Resolve Issues
- [x] Resize pages
  - From: Minor
- [x] **Vector export**: export sketches to SVG/PDF in addition to PNG/JPEG.
  - From: Major (breaking / large features → next `++.y.z`)
- [x] Imported nested group element layers without a unique or custom `id` value.
  - From: Resolve Issues
- [x] **Layers**: per-sketch layer stack with opacity, lock, and reordering.
  - From: Major (breaking / large features → next `++.y.z`)
- [x] **Vector import**: import SVG/PDF in addition to PNG/JPEG, keeping layers
  intact for imported SVGs.
  - From: Major (breaking / large features → next `++.y.z`)
- [x] **Export SVG File Size**: Exported SVG's are much larger than the imported
  SVG when imported and exported without making changes.
  - **GOAL**: Export with less date, while mainitaing the integrity of the graphic
    being exported or keeping the graphic intact.
  - From: Patch
- [x] Maintain SVG layer names on export
  - From: Resolve Issues
- [x] **High-DPI thumbnails**: render the pages-panel thumbnails at device pixel
  ratio to avoid blur.
  - From: Patch
- [x] **Eraser cursor preview**: show a circle the size of the eraser width.
  - From: Patch
- [x] **Symmetry guide fade**: animate the mandala guide axes in/out.
  - From: Patch
- [x] **Reduced-motion support**: honor `prefers-reduced-motion` for the page-turn
  animation.
  - From: Patch

</details>
