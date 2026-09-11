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

Defects noticed while working and not yet scheduled. Thirteen sit here: six
from 4.1.0-alpha, four from the Animation Mode work, two the 4.1.2-alpha source
review turned up, and one the popup pass found. Three of those were
found only by driving the running app rather than by reading it - an ARIA
attribute reads correctly in the source and is wrong only once something reads
it back, a click that moves what it selects reads as an ordinary drag handler,
and a panel positioned against the wrong box reads the same either way - and
the four in the middle came out of generating frames, where the failures show
up in the artifacts rather than in the code.

Eight are open. The five that have been resolved are stamped rather than
deleted, so the record of what was found stays with the record of what fixed
it; the 4.1.2-alpha source review, including the reasoning behind the calls it
made, is in `reviews/source-code-09-01-2026.log`.

- [ ] **`aria-selected` marks only the active layer row**: the layers panel is a
  `role="listbox"` with multi-select, but `renderLayers` sets
  `aria-selected` from `layer.id === active.id` and marks the rest with an
  `is-selected` class instead. A screen reader is told one row is selected when
  several are. (Found by a test probe reading the attribute and seeing one row
  where the panel showed two.)
- [x] **RESOLVED (4.1.2-alpha)** - **A select-tool click leaves a no-op undo
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
- [x] **RESOLVED (4.1.2-alpha source review)** - **The CLI inherits
  `ELECTRON_RUN_AS_NODE`**: `launchGui` spawns Electron with
  `env: { ...process.env, ... }`, so a shell that has the variable set (some
  editor and agent terminals do) makes `napkin-sketch` fail at startup with
  `Cannot read properties of undefined (reading 'setAppUserModelId')` -
  Electron runs the main script as plain Node and `require('electron')` returns
  nothing. The key is now deleted from the child's environment; the GUI is
  never meant to run as Node, so there is no case where inheriting it is
  wanted.
- [x] **RESOLVED (4.1.2-alpha)** - **A placed popup was positioned against
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
- [x] **RESOLVED (4.1.2-alpha source review)** - **`defaultSequenceFrames`
  counts steps, not skeletons**: the doc said "the number of skeletons its
  cycle was measured from" while the function returned the step count, and the
  generated table put a 6-entry array under a "7 frames" heading. Working it
  through showed the number was right and only the words were wrong: a run
  draws the frames *after* an existing one, so walk (8 skeletons, 8 steps)
  draws 8 and knocked-down (7 skeletons, 6 steps) draws 6, which with the
  source is the 7 poses that were measured. The doc now says step count and
  works both cases through, and the generator emits both counts so the array
  length and the heading stop looking like a contradiction.
- [x] **RESOLVED (4.1.2-alpha source review)** - **`animationLogFile` accepts
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

## Things to Improve

Code that works but should not stay as it is: duplication left behind by
features that outgrew their first implementation, two export attributes paid
for on every mark, three seams the Animation Mode work left showing, and two
left behind by the 4.1.2-alpha source review - one sub-decision that wants
measuring before it is made, one tidy-up that belongs with the split.
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
- [ ] **A decoded image outlives the mark that placed it** *(4.1.2-alpha source
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
- [ ] **The direct `renderLayers()` calls are now redundant** *(4.1.2-alpha
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
work rather than from a plan: the first five from the 4.1.2-alpha popup dock,
then four from 4.1.0-alpha, each small enough to prototype in an afternoon, and
the last three from Animation Mode. Those three are larger, and the first of
them would change what the mode needs to run at all.

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

Backward-compatible features: twelve entries, of which the two largest - the
animation preset cycles and the `vector-graphics` skill follow-ons - carry
fifteen sub-items between them. Most of the animation entries need a skeleton
drawn into `character-wireframes.svg` before any code is written; the two object
types that come apart are drawn in `object-animations.svg` instead.

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
- [ ] **Configurable shortcuts**: user-editable keybindings.
- [ ] **Auto-save & recovery**: periodic snapshots and crash recovery of `.skbk`.
- [ ] **Export options dialog**: DPI/scale and transparent-vs-paper background
  choices for raster export.
- [ ] **Prompt to Save**: If a file contains data, and has not been saved; when
 GUI is closed, prompt user to save file.

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
- [ ] **Replace the preset guidance or add to it**: "walk, but limping" wants
  `spec.guidance` kept and the note appended; "a cat stretching" wants the
  preset out of the way entirely. Both are useful and they are different
  features, so the answer is one control choosing between them rather than two
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

- [ ] **Settle the instruction shape before writing a parser**: two front ends,
  one intermediate form. A line-oriented text script is what a person or an AI
  helper writes; a plain object is what a program builds. Both should lower to
  the same instruction list, and the object form is the one to freeze first,
  because the text syntax can then change without touching anything
  downstream of it.
- [ ] **The instruction type**: an `Instruction` union in a new browser-safe
  `src/core/instructions.ts`, beside the other model modules. Every
  instruction carries the source position it came from, so a diagnostic can
  point at the line that caused it, and the union is the one seam the parser,
  the evaluator, and any later front end all meet at.
- [ ] **Tokenizer and parser**: verbs, arguments, comments, and blocks, with no
  dependency - the repo has none at runtime and a script language should not
  be the first. `parsePathD` in `svg-import.ts` is the shape to copy: a cursor
  over a string with one small function per production.
- [ ] **Diagnostics that name the line and the column**: `parsePathD` returns
  `null` for anything it cannot read, which is right for an attribute and
  useless for a script. Errors should be collected rather than thrown at the
  first one, so a file with three typos reports three, and each says what was
  expected where.
- [ ] **Lengths in the language go through `src/core/units.ts`**: `10mm`,
  `0.5in`, `12pt`, and a bare number as px, converted with `toPx` rather than
  by a second table. The properties panel and the Rotate palette already read
  every length this way, and a third spelling of the same arithmetic is
  exactly the thing that drifts.
- [ ] **Coordinates absolute, relative, and page-relative**: `to 100 200`
  against `by 20 0` is the distinction SVG path data already draws and costs
  nothing to carry; a `50% 50%` measured against the page is what lets one
  script render at more than one page size.
- [ ] **A transform stack**: `push` and `pop` around translate, rotate, and
  scale, applied to the anchors as they are emitted rather than written out as
  an SVG `transform` attribute. Affine invariance means the transformed
  control points *are* the transformed curve, which is what the Rotate tool
  already relies on, and baking it keeps a generated mark indistinguishable
  from a drawn one on export.
- [ ] **`repeat` and arithmetic, with a budget decided up front**: a row of ten
  boxes should not be ten copies of one line. The evaluator needs a hard cap
  on instructions executed and marks emitted, chosen before the first script
  that hangs a build rather than after it.
- [ ] **Reusable definitions**: a way to draw a shape once and place it many
  times. This is the seam the shape library below plugs into, so the two want
  designing together rather than one retrofitting the other.
- [ ] **The evaluator**: instructions to a `Sketch`. It emits the `Stroke`
  objects `src/core/types.ts` already defines, `vector.anchors` included, so a
  generated drawing is as editable in the GUI as a drawn one and needs no
  import step to become one. Every entry below this one stands on it.
- [ ] **Geometry comes out as anchors, never as samples**: the standard the
  import path was already held to. A generated circle is four cubics with
  handle length `4/3 (sqrt(2) - 1) r`, not a polyline, and `points` is
  resampled from the anchors the way the Vector Path tool resamples - so the
  canvas has something to paint and the exporter has something exact to write.
- [ ] **Layer statements build the tree, not a flat stack**: named layers and
  nested groups with opacity, visibility, and lock. `createLayer`,
  `createGroupLayer`, and the `parent` field are the model already; the
  evaluator only has to keep a stack of layer ids as it walks the script.
- [ ] **Paint statements map onto the fields that exist**: color, width,
  opacity, `fill`, `gradient` with stops, `noStroke`, `strokeStyle`, and a nib
  angle for a Copic mark. Each is a `Stroke` field today, so the work is
  naming them in the language rather than adding them to the model.
- [ ] **Text without a DOM is the first real gap**: `Surface.measureText` runs
  on a canvas context, so auto-sized text boxes and every bounds calculation
  that depends on them have no headless answer. Three ways out, wanting a
  decision rather than a discovery: emit the text element and leave it
  unmeasured, require an explicit box on every text instruction, or draw the
  letters as paths.
- [ ] **The `alphabet.svg` asset is the third way out**: the `vector-graphics`
  skill ships two typefaces as letterform groups, one path per letter pair. A
  text-as-paths mode composed from those needs no font metrics at all, and
  gives a drawing made of marks - which is what a sprite or a cut file wants
  anyway. It needs advance widths, which the asset does not carry yet, so
  measuring them into the asset is the first step.
- [ ] **An image instruction takes a data URL and nothing else**: a script must
  not be able to read the filesystem. A caller can load a file and hand the
  API its bytes; the language should have no verb that opens one.
- [ ] **A shape library read from the skill assets**: `shapes.svg` already
  draws squares, circles, ellipses, triangles, polygons, stars, lines at set
  angles, an arc, and a spiral, and `isometric-objects.svg` /
  `perspective-objects.svg` a wheel, a sphere, and a cube in one projection
  each. Those are the primitives a script wants by name, and reading their
  anchors at build time beats re-deriving each one in code.
- [ ] **Arcs and rounded corners derive rather than get eyeballed**:
  quarter-turn cubic pieces with handles `4/3 tan(dtheta/4)` along the
  tangents, which is the rule `arcToCubics` in `svg-import.ts` already
  applies. One helper shared by the arc verb, the rounded rectangle, and the
  circle, so an imported arc and a generated one are the same curve.
- [ ] **A verb that fits a curve through waypoints**: the skill's
  `matlib-script.js --through` already solves for the handles that put a curve
  through given points. Saying "curve through these five points" is much
  closer to how a shape gets described than dictating two handles per segment,
  and the solver exists.
- [ ] **The hand-drawn pass is the point of the tool and its least defined
  part**: `sharpenStrokes` turns a shaky human line into a clean shape, and
  this wants the inverse - an exact shape roughened into something that reads
  as drawn. Without it the API generates diagrams anybody could generate; with
  it, it generates napkin sketches, which is the only reason to generate them
  here.
- [ ] **Seed the roughening, and decide what it perturbs**: anchor positions,
  handle lengths, a slight overshoot at each end, a second pass offset from
  the first. All four are cheap on anchors and awkward on samples, which is
  another reason the anchor rule above is load-bearing. Seeded so one script
  renders the same bytes every run - an unseeded one is useless for tests, for
  diffs, and for anybody who wants their diagram back tomorrow. Worth
  prototyping against `test/imports/` before any of it is specified.
- [ ] **Prove the headless path with a test that imports no DOM**:
  `Surface.toSVG` is DOM-free and `test/svg-export.test.ts` says so in a
  comment, but nothing enforces it - a single `document.` added inside the
  class would break the API and pass all 278 tests. A test that renders a
  script end to end in plain Node is the contract that comment is standing in
  for.
- [ ] **Raster output has no obvious answer**: PNG and JPEG come off a canvas
  and Node has none. Either the API is honest and offers SVG and PDF only, it
  takes a rasterizer the caller supplies, or it grows the first runtime
  dependency in the repo. The first is the right default; the other two want
  naming as options rather than arriving as a surprise.
- [ ] **PDF is already there**: `sketchesToPdf` is browser-safe and exported.
  A multi-page script maps onto a `SketchBook` and out to PDF with no new code
  beyond the wiring.
- [ ] **Crop and registration reuse the Selection export**: the crop box Export
  Selection computes is the same box a generated sprite wants, and one box
  shared across a set of scripts is the fix already filed under **Ideas** for
  animation frames. One option, both uses, rather than two spellings of a
  viewBox.
- [ ] **The public surface and the promise it makes**: a render entry point, a
  straight-to-SVG convenience, and the instruction types, added to
  `src/api/index.ts`. Additive only - every export that is there stays exactly
  as it is, which is what keeps this a minor.
- [ ] **Errors come back as values**: a result carrying the sketch and the
  diagnostics beats a thrown string, because a caller generating a hundred
  graphics wants the ninety-nine that worked and a list of what went wrong
  with the other one. It also matches how the importer already reports what it
  could not read.
- [ ] **A `draw` verb on the CLI**: a script file or stdin in, an SVG or a PDF
  out, and no Electron anywhere in the path - `src/cli/index.ts` only reaches
  `require('electron')` inside the GUI launch, so a draw command can exit
  without ever resolving it. That also answers the global-install failure
  filed under **Found Issues**: a CLI that draws is useful on exactly the
  installs where the GUI cannot start.
- [ ] **Round-trip back into the app**: a script should be able to write a
  `.skbk` as readily as an SVG, so a generated drawing opens in the GUI with
  its layers and its anchors intact and gets edited by hand from there.
  `serializeSketchBook` is browser-safe and already exported, so this is one
  more output format rather than a second pipeline.
- [ ] **An optional AI bridge, kept optional**: the settings, the tool list,
  the terminal launcher, and the auth-failure detection in
  `src/core/ai-tool.ts` already know how to run a helper. Natural language to
  an instruction script is a far smaller ask than a posed SVG frame, because
  the output is text in a grammar the parser checks - a bad answer fails
  loudly instead of drawing something subtly wrong. Nothing above this entry
  should need it to work.
- [ ] **A skill that teaches the language to the helper**: `vector-animations`
  is the model, a skill written so the instruction the helper emits is the
  instruction the parser accepts. Generate it from the verb table rather than
  writing it twice - the cost of a table kept in more than one place is
  already filed under **Documentation Update Ideas**.
- [ ] **This is also how the measured animation frames get drawn with no AI at
  all**: the idea filed under **Ideas** wants the app to apply the transforms
  it has already computed, and `animationFrameTransforms` returns them per
  assembly. An instruction script is precisely a way to say "take this source
  and apply these transforms". The animation path and the drawing path meet
  here, or they get written twice and drift.
- [ ] **Tests**: golden files, a script in and an SVG out, for the language; a
  determinism test that renders one script twice and compares bytes; and a
  geometry test that a generated circle and an imported one agree, which is
  the identity check `test/svg-export.test.ts` already makes about the round
  trip, pointed at the generator instead.
- [ ] **Documentation**: a README section beside **Embedding the editor**, a
  verb reference, and worked examples. At 1,286 lines the README is already
  where the keyboard-shortcut and editing-gesture items above came from, so
  the place a language goes wants deciding before it is written rather than
  after.

### Simple Graphic Design Elements

- [ ] API that can create a graphic design composition using simple elements
  like, but not limited to:
  - Rectangles
  - Circles
  - Ellipses
  - Triangles
  - Polygons
  - Clipping Masks
  - Text
    - Choose different font families
    - Implement common customizable font styling
    - Implement common customizable paragraph styling
  - Insert media files like JPEG, PNG, GIF, SVG, etc.
    - Clipping methods to define clipping shape, and/or id
    - Method using properties to set position
  - Uses current GUI canvas: false by default
  - Default units: pixels(*px*)
  - Specify size: true
  - If size left out: default to `width: 360px, height: 360px`
  - Separate documentation: true
    - `API.md`

### New Skill to Auto Generate Design Language

- [ ] Add a new skill that will:
  - Analyze media file like JPG, PNG, SVG, GIF, etc. then from the data write
    a `DESIGN_LANGUAGE.md` file
    - If exist `DESIGN_LANGUAGE.md`, then:
      - Write to `DESIGN_LANGUAGE-<source-media-file>.md` e.g.
        - `DESIGN_LANGUAGE.md` does exist, and media file is like `name.svg`,
          then write to `DESIGN_LANGUAGE-name.md`
  - The skill will then create a light-weight skill for that file in the
    specified A.I. folder e.g. `.claude/`, `.github/` corresponding skills
    folder, but name the skill as `<source-media-file>`, then script files
    that utilize this API are created so new assets can be created using that
    skill
    - If skill folder exist `<source-media-file>`, then create as
      `<source-media-file_0>`

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
- [ ] **Record intent, not pointer events**: a recorded drag is one
  instruction, not the sixty pointer moves it was made of. The boundary
  already exists in the store, which is the encouraging part - `moveStrokes`,
  `setStrokeProps`, and `setLayerProps` all take a `history` flag precisely to
  separate the intermediate calls from the committed one. The recorder should
  coalesce on the same boundary rather than invent a second one.
- [ ] **A recording is a script somebody can read**: the output should be the
  instruction language a person would have written by hand, with names and
  round numbers, not a trace of internal ids. A recording nobody can edit
  afterwards is worth about as much as an undo stack, and the whole point of
  recording into a language is that the result is source.
- [ ] **Start and Stop Recording, and what the buttons promise**: where they
  live, what shows while a recording runs, and what happens to one in progress
  when the window closes or the page changes. The close prompt already exists
  for unsaved work and is the pattern to follow.
- [ ] **Decide what is in scope before writing any of it**: document mutations
  belong in a recording; zoom, pan, panel toggles, and which tool is selected
  are view state and mostly do not. Mostly, because the tool, the color, the
  width, and the sharpen options *are* what a drawing instruction needs. The
  line runs between "changes the document" and "changes the view", and it
  wants drawing once, in writing, rather than per method.
- [ ] **A recording carries its preamble**: page size, background, and the
  sharpen settings in force. Live-sharpen makes this sharp - a session
  recorded with `liveSharpen` on and replayed with it off draws different
  marks - so the settings that shaped the strokes belong in the script's head,
  not in the environment it happens to be replayed in.
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
- [ ] **A generated script is code the user did not write**: the app writing a
  script and running it without showing it is the shape of the thing people
  are right to distrust, and it is also how a bug becomes invisible. Show it,
  default to confirming, and let the setting for skipping the confirmation be
  the user's own decision rather than the default.
- [ ] **Recording, replay, and generation all read the same limits**: the
  instruction budget the API section calls for is the same budget a generated
  script needs, and a recording of a long session is exactly the case that
  finds it. One cap, named once.
- [ ] **Scripts are a compatibility surface once anybody saves one**: a
  recording kept for six months has to still replay. That means the language
  gets a version marker, replay refuses what it cannot read instead of
  guessing, and the `.skbk` precedent applies - `SKETCHBOOK_VERSION` and
  `normalizeSketchBook` are how the document format already handles this and
  the pattern is worth copying rather than reinventing.
- [ ] **Where the buttons live is a real question, not a detail**: recording
  controls, a Run Script row, an Organize Layers action, and the Animation
  Mode generator are four new entries in a GUI that already has a menu bar,
  three panels, and a mode. Deciding this alongside the **GUI Redesign** entry
  under **Major** is cheaper than deciding it twice.
- [ ] **Tests**: a recorder round trip, a replay determinism test, a rule
  engine with fixture documents and expected trees, and a form test that the
  generated helper script names the right skills for each delivery -
  `test/animation.test.ts` already covers the form and is where the last one
  belongs.
- [ ] **Documentation**: what a recording captures and what it deliberately
  does not, the rule format, and the Animation Mode reference-pose workflow.
  The last of these lands in the three places the animation tables already
  live, which is the duplication filed under **Documentation Update Ideas** -
  worth solving there before adding a fourth.

## Patch (fixes, polish, internal → next `x.y.++`)

Fixes and internal polish. Only one entry stands here: most patch-sized work in
4.1.0-alpha was found and finished in the same sitting rather than queued, and
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

Thirty shipped entries, roughly newest first, each noting the group it
graduated from. The newest is the Rotate tool, which lands with Move in the
4.1.2-alpha batch; then the plugin work, and the eight after that are the
4.1.0-alpha batch: the clipboard, the Selection export, the pages menu, and
the drag and layer-integrity work.

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
