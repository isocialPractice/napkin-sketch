# TODO

Roadmap for **napkin-sketch**, grouped by semantic-version impact. Items are
aspirational and unordered within each group.

The file has two halves. **Current** through **Chores** is a working inbox -
what has been noticed but not yet committed to a release - and everything from
**Resolve Issues** down is the version-impact roadmap. An item graduates from
the inbox into a roadmap section once it is scheduled.

## Current

The active queue. Five entries, all patch-sized and carried over from earlier
releases; each names the group it came from, so an item that grows can be moved
back without losing where it started.

- [ ] **Text editor UX**: commit on `Esc`, keep caret styling in sync with the
  selected font size, and reposition on window resize.
  - From: Patch
- [ ] **Icon rasterization**: ship multi-resolution `.ico`/`.icns` instead of a
  single PNG.
  - From: Patch
- [ ] **More tests**: cover the renderer store (undo/redo, pages, selection) and the
  embeddable `NapkinSketch` editor via a DOM test environment.
  - From: Patch
- [ ] **Scripted GUI checks**: the menu bugs in 4.1.0-alpha were only findable
  by driving the running app - synthetic OS cursor moves were too coarse to
  tell "the panel closed" from "the pointer missed it". Launching Electron
  with `--remote-debugging-port` and dispatching real pointer events over the
  DevTools protocol worked well and can read the DOM back; worth turning into
  a checked-in harness (`npm run gui-check`) covering menus, panel toggles,
  and page/selection flows.
  - From: Patch
- [ ] **Docs**: API reference for the embeddable package and a WordPress block
  example.
  - From: Patch

## Found Issues

Defects noticed while working and not yet scheduled. Ten sit here: six from
4.1.0-alpha and four from the Animation Mode work. The first was found only by
driving the running app - an ARIA attribute reads correctly in the source and
is wrong only once something reads it back - and the last four came out of
generating frames, where the failures show up in the artifacts rather than in
the code.

- [ ] **`aria-selected` marks only the active layer row**: the layers panel is a
  `role="listbox"` with multi-select, but `renderLayers` sets
  `aria-selected` from `layer.id === active.id` and marks the rest with an
  `is-selected` class instead. A screen reader is told one row is selected when
  several are. (Found by a test probe reading the attribute and seeing one row
  where the panel showed two.)
- [ ] **A select-tool click leaves a no-op undo step**: `onPointerDown` calls
  `store.pushHistory()` as soon as a stroke is hit, before any movement, so
  clicking an element to select it costs an undo press later. The push should
  wait until the drag actually moves something - `dragMoved` already tracks
  exactly that.
- [ ] **The CLI inherits `ELECTRON_RUN_AS_NODE`**: `launchGui` spawns Electron
  with `env: { ...process.env, ... }`, so a shell that has the variable set
  (some editor and agent terminals do) makes `napkin-sketch` fail at startup
  with `Cannot read properties of undefined (reading 'setAppUserModelId')` -
  Electron runs the main script as plain Node and `require('electron')` returns
  nothing. Deleting the key from the child's env would make the CLI immune.
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
- [ ] **The sign-in launcher is only proven on Windows**: opening a terminal for
  the AI tool uses `cmd /c start` on Windows, `osascript` on macOS, and
  `x-terminal-emulator || xterm` elsewhere. Only the first has been run. The
  auth-failure detection behind it has never been exercised against a genuinely
  signed-out tool either - the patterns are unit-tested against the wording
  those CLIs use, not against a live refusal.

## Things to Improve

Code that works but should not stay as it is: duplication left behind by
features that outgrew their first implementation, two export attributes paid
for on every mark, and three seams the Animation Mode work left showing.
`renderer.ts` is 8,226 lines, which is the single biggest reason changes in
the GUI are hard to review.

- [ ] **Split `renderer.ts`**: at 8,226 lines it holds the pointer handling,
  every tool, all three panels, the clipboard, the menus, and Animation Mode.
  The clipboard and the layers panel are the two seams that already have
  almost no shared state and would lift out cleanly first.
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

## Documentation Update Ideas

The README is 1,167 lines and documents each editing gesture where it was
added rather than beside the others. 4.1.0-alpha alone introduced five
clipboard shortcuts and a drag modifier, and the file now mentions `Ctrl`
thirty times without ever listing them in one place. The last two entries are
a different problem: Animation Mode is documented in three files that have to
agree, and one of them is read by the AI helper rather than by a person.

- [ ] **A keyboard-shortcut table**: one table in the README covering the
  tools, the quick features, the clipboard (`Ctrl+C` / `X` / `V` /
  `Shift+V` / `D`), restacking (`Ctrl+]` / `[`), and the Shift drag
  constraint. Today a reader has to find each one in the prose that introduced
  it.
- [ ] **An "Editing gestures" section**: the clipboard, Alt-drag, the Shift
  constraint, and Shift-click selection are documented as four separate
  bullets in the feature list even though they interact - Shift means one
  thing on a press and another during a drag, which is worth saying once,
  plainly, in a place a reader will look.
- [ ] **Document the version policy in CONTRIBUTING or the CHANGELOG header**:
  the 4.1.0-alpha entry is 241 lines and holds features as well as fixes, and
  nothing in the repo says when a batch should take a minor bump instead. See
  the matching chore below.
- [ ] **The animation type table is written in three places**: the source list
  in `ANIMATION_TYPES`, the table in the `svg-animations` skill, and the table
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
work rather than from a plan: the first four from 4.1.0-alpha, each small
enough to prototype in an afternoon, and the last three from Animation Mode.
Those three are larger, and the first of them would change what the mode needs
to run at all.

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
- [ ] **Draw the measured frames without an AI at all**: for a type with a
  measured cycle the app already computes the finished `transform` per
  assembly, and applying them is a handful of attribute writes on a copy of
  the source. Doing that in-process would give walk, idle, and knocked down a
  path that needs no AI tool, no sign-in, and no waiting - and would leave the
  helper for the types that still need judgment. It would also make the mode
  demonstrable on a machine with no agentic CLI installed.
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

## Chores

Housekeeping with no user-visible result: dead code left by a replacement,
stray files from a mis-driven save dialog and from animation runs that failed,
a log nobody trims, and one version number that no longer matches what it
carries.

- [ ] **Delete `store.moveLayer`**: `moveLayers` replaced it in 4.1.0-alpha and
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
- [ ] **Promote the GUI harness out of `.tmp/`**: the DevTools-protocol scripts
  that verified 4.1.0-alpha live in a gitignored folder and will be lost. They
  are the working half of the **Scripted GUI checks** item under Current.
- [ ] **4.1.0-alpha carries features, not just fixes**: copy and paste, the
  Selection export, the pages menu, and the Shift drag constraint all landed
  under a patch version because the version was pinned for the batch. Decide
  whether to re-tag it as 4.1.0-alpha before release, and write the rule down
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
  - [ ] **Help-menu reference**: an in-app page documenting the required
    assemblies and the frame layer-naming rules.
- [ ] **GUI Redesign**: update GUI overall design.
  - Initial sketches
  - Polish and apply
  - System that is easily modified in order to inline with GUI desing trends
    - Highly configurable where uses can also mod, or set and customize UI/UX

## Quick Features (ideas → next `x.++.z`)

Small additive features that need no new contract - twelve of them. The first
seven are follow-ons from the 4.1.0-alpha drag, clipboard, and export work; the
rest are quick-feature shortcuts.

- [ ] **Show the constrained axis while Shift is held**: a faint guide line
  through the drag origin along the axis the drag has snapped to would make it
  obvious which of the eight directions is in force before letting go.
- [ ] **Constrain a Bézier handle to its anchor, not to the drag start**: the
  Shift constraint measures from where the drag began, which is what was
  asked for and is consistent across every drag. For a handle specifically,
  measuring from its own anchor is the more useful constraint - it gives a
  horizontal, vertical, or 45-degree tangent.
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

Backward-compatible features: eleven entries, of which the two largest - the
animation preset cycles and the `vector-graphics` skill follow-ons - carry
sixteen sub-items between them. Most of the animation entries need a skeleton
drawn into `character-wireframes.svg` before any code is written.

- [ ] **Animation preset cycles**: walk, idle, and knocked down are driven by
  cycles measured from skeletons in `character-wireframes.svg`. The
  rest are offered but posed from a prompt template; each needs a skeleton
  drawn into the asset, after which `npm run wireframe-cycles` measures it and
  the type becomes ready with no further code.
  - [ ] **Character: run**: run cycle with airborne frames and deeper limb swing.
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
  - [ ] **Object: move**: translate an object along a path with easing.
  - [ ] **Object: explode**: burst an object outward with debris.
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
- [ ] **Lasso + transform**: free-form lasso selection with scale/rotate handles
  (current Select is rectangular move/delete only).
- [ ] **Shape tools**: explicit line/rectangle/ellipse/arrow tools that emit clean
  geometry without relying on the sharpen classifier.
- [ ] **Color palettes**: savable swatch sets and a recent-colors strip.
- [ ] **Grid & guides**: dot/line grid, snapping, and a ruler overlay.
- [ ] **Per-page background**: choose napkin, graph, dotted, or blank per page.
- [ ] **Configurable shortcuts**: user-editable keybindings.
- [ ] **Auto-save & recovery**: periodic snapshots and crash recovery of `.skbk`.
- [ ] **Export options dialog**: DPI/scale and transparent-vs-paper background
  choices for raster export.
- [ ] **Prompt to Save**: If a file contains data, and has not been saved; when
 GUI is closed, prompt user to save file.

## Patch (fixes, polish, internal → next `x.y.++`)

Fixes and internal polish. Only one entry stands here: most patch-sized work in
4.1.0-alpha was found and finished in the same sitting rather than queued, and
what was left behind is filed under **Found Issues** and **Chores** above.

- [ ] **Panel Improvements**:
  - [ ] **Resize Panels**: Allow the side and top panels to be resized.
  - [ ] **Undock Panels**: Allow the side and top panels to be undocked and moved freely outside of the GUI window.

## Complete

Twenty-eight shipped entries, roughly newest first, each noting the group it
graduated from. The eight most recent are the 4.1.0-alpha batch: the clipboard,
the Selection export, the pages menu, and the drag and layer-integrity work.

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
  AI helper command, which applies the `svg-animations` skill and advances it a
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
