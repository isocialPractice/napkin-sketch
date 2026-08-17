# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.2-alpha] - 2026-08-17

### Fixed

- **Exported SVGs keep their layer names.** A layer's group used to be
  written out as `id="layer-0"` with the real name only in the private
  `data-name` attribute, so a napkin export opened in Inkscape or
  Illustrator arrived as a stack of anonymous groups. Each group now
  carries its name three ways: `data-name`, `inkscape:label` alongside
  `inkscape:groupmode="layer"`, and the `id` itself. Characters an XML id
  may not hold are escaped as `_xHH_` and repeated names take the `-2`,
  `-3`, … suffix editors expect - both of which the importer already
  undoes, so the names round-trip unchanged.
- **Page thumbnails are no longer blurry.** The pages-panel thumbnails were
  drawn into a fixed 150-pixel canvas and then stretched to the panel's
  width, so they were upscaled twice over on HiDPI displays. They now draw
  at the panel's actual width times the device pixel ratio, and redraw
  after the panel is resized.

### Changed

- The **eraser cursor is a dashed circle the size of the eraser**, matching
  the circle preview the drawing tools already carry, instead of the
  fixed-size `cell` pointer that gave no hint of what a stroke would clear.
- The **mandala symmetry guide fades in and out** over 220 ms when
  rotational symmetry is switched on or off, instead of the axes appearing
  and vanishing between frames. The axis count is held through a fade-out,
  so the guide dissolves as the shape it was.
- **`prefers-reduced-motion` now covers keyframe animations.** The
  reduced-motion rule only collapsed `transition-duration`, which left the
  360 ms page-turn animation (an `animation`, not a transition) running at
  full swing. Animations, delays, and `scroll-behavior` are now included,
  the page turn is switched off outright, and the renderer skips both the
  page-turn class and the symmetry fade when the OS asks for reduced
  motion.

## [3.2.1-alpha] - 2026-08-17

### Fixed

- **Exported SVGs are far smaller.** Importing an SVG samples its curves at
  one point per path unit, and every sample used to be written back out as
  its own `L` command — so a file that arrived at a few kilobytes could
  leave orders of magnitude larger without a single edit. Two changes close
  the gap while keeping the graphic intact:
  - Strokes that carry Bézier anchor structure (Vector Path, Curve, and
    quick-curve commits) now export as their **exact cubic Bézier
    segments** — a handful of `C` commands instead of hundreds of sampled
    points — which is both smaller and geometrically truer than the
    polyline it replaces.
  - Sampled polylines (freehand strokes, imported artwork, eraser masks,
    and the Copic chisel outline) shed the samples that sit within a tenth
    of a pixel of the line through their neighbours — below the file's own
    one-decimal coordinate precision, so nothing visible changes.
  - Coordinates drop the redundant trailing `.0` (`10` instead of `10.0`).

### Changed

- A vector stroke's **anchor structure now survives an SVG round-trip**:
  the importer rebuilds the editable anchors (handles, corner points, and
  closure) from napkin's exported cubic paths, so a re-imported Vector Path
  stroke opens for anchor editing exactly as it was drawn. Previously the
  structure was kept only in `.skbk` files and a re-imported stroke fell
  back to a plain freehand polyline.

## [3.2.0-alpha] - 2026-08-16

### Added

- **Panel context menus**: right-clicking the Layers panel offers Add,
  Group, Delete, Move Up/Down, and Hide Panel; right-clicking the Pages
  panel offers Add Page, Delete Page, Page Settings…, and Hide Panel — each
  menu carries the tools relative to its panel, styled to match the GUI.
- **Sized pages** (Page Settings, via the Pages panel's right-click menu):
  a page can now be `sized` — pinned to an exact width and height, shown
  with a dashed page outline — or left as the default `endless` page that
  fills the window. Switching back to endless re-enables window tracking
  and disables the dimension fields. The mode round-trips through `.skbk`
  files.
- **Resizable panels**: drag the layers panel's or the pages panel's inner
  edge to set its width (160–480 px).
- The layers panel's right-click menu also offers **Ungroup** (enabled on a
  group row) and **Rename**, which opens the same inline rename as
  double-clicking the layer's name.
- **Fit All in View** (View menu, `Ctrl+0`): zooms and pans so every
  graphic on the page is in view at once, replacing the stock Actual Size
  zoom reset that did not act on the drawing.
- **Panel state on the toolbar**: the Pages and Layers buttons fill in with
  the "Panel in View" treatment while their panel is open and sit flat
  ("Panel inactive") when it is hidden.
- **Export button in the top toolbar**, beside Import: drops down the same
  four formats as File > Export (PNG, JPEG, SVG, PDF), each opening the
  usual page/all-pages export dialog.
- **`npm run import-tree -- <file.svg>`** (dev tool): prints the layer tree
  an SVG would import as, running the real importer in a hidden Electron
  window — verify a file's imported layer names without opening the GUI.
- **`npm run todo`** (dev tool): archives every checked item in TODO.md —
  wrapped lines and nested sub-items move along with it — into a
  `## Complete` section kept at the bottom of the file, creating the
  section on first use. Each archived item gains a nested `From: <section>`
  line recording the roadmap section it came from; an item that already
  carries its own `From:` note (e.g. one pulled into Current from another
  section) keeps that origin instead. Re-running is a no-op.

### Changed

- The **layers panel opens by default**, and the **Select tool is active on
  startup** instead of the Pen.
- Top toolbar restyle: a **separator bar** now distinguishes the Pages and
  Layers toggles from the file actions, and the **Save** button uses the
  same background as its neighbours (bold label and strong border keep it
  prominent); the filled treatment it used to have now marks open panels.
- The layer group **collapse caret is drawn at 200%** of its former size
  for an easier target.
- **SVG import samples curves at one point per path unit** (previously one
  per two units, capped far lower), so imported artwork keeps the source
  file's smoothness instead of arriving with faceted outlines.
- A **named top-level wrapper group** in an imported SVG (e.g.
  `<g id="circles">` around the whole drawing) now imports as the top layer
  group under its name; previously it was flattened away and its name lost.
  Anonymous export wrappers are still descended as before.
- **Every unnamed imported element gets its own tag-named layer**: geometry
  without an `id` inside a group now imports as a layer named after its SVG
  tag (`path`, `line`, `rect`, …) instead of merging invisibly onto the
  group's layer, so each element in the source file has a row in the panel.
  Only napkin-sketch's own exported marks (`data-tool`) still merge, which
  keeps napkin's exports round-tripping as clean single layers. An SVG with
  no `<g>` elements at all imports as one top group **named after the
  file**, holding a tag-named layer per element, and a lone named top-level
  group keeps the author's name in grid (`-m`) imports rather than being
  renamed to the file.
- **Anonymous groups are never lost on import**: an unnamed `<g>` imports
  as a `<Group>` layer (nested ones included) instead of being flattened
  away or labeled `Layer N`, so the imported stack always mirrors the
  source document — named groups keep their names, unnamed ones read
  `<Group>`, loose geometry reads its tag name, and a group-less document
  arrives under the file's name.
- **Drawing on a selected group row now works**: instead of only warning
  that a group holds no marks, napkin-sketch adds a fresh layer inside the
  group, makes it active, and lands the stroke there — the toast names the
  created layer (locked or hidden groups still just warn).
- **Fill Color selects what you click**: with the Fill Color tool, a click
  anywhere within an element's dimensions — its interior or bounding box,
  not just near its outline — selects that element (highlighting it in the
  Layers panel) and fills it with the selected ink color. Clicking empty
  canvas still fills the current selection.
- **Select and Direct Select treat a filled shape's interior as the
  shape**: clicking anywhere on its painted fill selects it, where
  previously only clicks near the outline registered. Unfilled outlines
  stay click-through in the middle, so rubber-band selection over empty
  canvas is unaffected.

- **CLI import** (`-i, --import <file>`): launches the GUI with an SVG, PDF,
  PNG, or JPEG imported into the opening sketch, exactly as the
  File > Import menu item would place it — SVGs keep their layers, PDFs add
  their pages, and raster images land centered on the active layer. Missing
  files and unsupported types fail fast with a clear error before the window
  opens.
- **CLI multiple import** (`-m, --multiple-imports <file,file,…>`): imports a
  comma-separated list of files in one go, laid out in a grid. Each file's
  graphic size is measured against the page first, then the graphics fill a
  row left to right and wrap to a new row whenever the next one would overrun
  the page width; oversized graphics scale down to fit the page. Every
  imported file becomes its own named layer (multi-layer SVGs keep their
  layers grouped under the file's name, PDF pages arrive one layer per
  page). Quoted names with spaces and spaces after commas both parse.

## [3.1.0-alpha] - 2026-08-08

### Added

- Strokes committed by the Vector Path, Curve, and quick-curve tools carry
  their **Bézier anchor structure** in the `.skbk` file (an optional
  `vector` field with anchors and absolute-position handles), so paths stay
  editable across saves. Unknown or malformed data is dropped on load and
  the stroke still renders from its sampled points.
- **Vector Path edit mode**: with no path in progress, clicking a committed
  vector stroke opens it for anchor editing. A plain click on a segment adds
  an anchor there (de Casteljau split, shape preserved) and on an anchor
  removes it; `Ctrl` drags a single anchor, one of its handles, or the
  corner-rounding target; `Alt`-clicking an anchor toggles its handles
  (smooth point to corner and back). Every change resamples the stroke from
  its anchors, and `Esc` or an empty-canvas click puts the path down.
- **Corner rounding**: with `Ctrl` held, the selected anchor of an edited
  path shows a target icon inside its corner — dragging it rounds the corner
  into a circular fillet, clamped to half the shorter adjacent chord — and a
  **Radius** field in the top toolbar (visible while the Vector Path tool is
  active) applies an exact radius to the selected anchor.
- **Sharpen Selection** (toolbar button): smooths and simplifies the
  selected strokes, in the spirit of a vector editor's simplify command. A
  corner dialog with **Smooth** and **Simplify** sliders previews the result
  live on the canvas; Apply commits one undo step, Cancel or `Esc` restores
  the original geometry exactly.
- **Vector Path** tool (`B`, in the Sketch Support toolbar): an
  Illustrator-style pen. Click to place corner points joined by straight
  segments; click-drag to place a smooth point and pull out symmetric Bézier
  direction handles; the next segment previews live as a rubber band. Click
  the first point to close the path, `Enter` or double-click to finish it
  open, `Esc` to abandon. Paths commit as editable pen strokes with the
  current color, width, and opacity, are never auto-sharpened, and respect
  symmetry mode; Direct Select can rework the committed points.

### Changed

- The **Curve** tool now branches on pointer type: a mouse keeps the
  two-phase chord-and-bend flow, while pen and touch input — which cannot
  hover between clicks — draw with the quick curve's single-gesture quarter
  arc. The former stylus freehand mode is replaced by that flow.
- A finished **quick curve** is now exactly one cubic Bézier — two anchors
  and two control points (the circle-constant construction, deviation under
  a thousandth of the radius) — instead of an anchor per sample, so editing
  it shows four points rather than dozens. The mouse Curve tool's bend
  likewise commits its quadratic lifted to a cubic with two control points.
- **Direct Select** pans with `Space` + drag, matching the Select tool, and
  shows the same grab cursor while panning.
- Finishing a Vector Path is more forgiving: **switching tools accepts the
  pending path** — a tool shortcut (`S` for Select, `P` for Pen, …) or a
  toolbar click commits the curve as drawn, as does the window losing focus.
  `Enter`, double-click, and closing on the first point still work, and
  `Esc` remains the only way to abandon a path.
- Dragging a direction handle on a smooth anchor keeps the **opposite handle
  collinear** through the anchor (the smooth reflection H' = 2P − H, with
  each handle keeping its own length), so the curve bends smoothly instead
  of creasing into a cusp at the anchor.
- **Direct Select** edits Bézier-structured strokes through their anchors:
  a stroke from the Vector Path, Curve, or quick-curve tools shows its few
  anchor points (a quick curve shows two) with the selected anchor's
  curvature handles, instead of a square on every sample. Dragging an
  anchor carries its handles, dragging a handle bends the curve with the
  smooth collinear reflection, and whole-path moves (Direct Select or the
  Select tool) carry the anchor structure along so it never drifts from the
  drawn points. Freehand strokes keep the sampled-point editing and
  tangent-handle bend.
- Tool pointers follow the vector-editor convention: the Select tool shows a
  **black arrow** and Direct Select a **white arrow**. In Vector Path edit
  mode the pointer telegraphs the click: a **"−" badge** over an anchor
  (removable), a **"+" badge** over the path between anchors (insertable —
  `Ctrl`-clicking a bare segment now inserts too), the **black Select
  arrow** while `Ctrl` is held over anything grabbable, and a **stemless
  arrowhead** while `Alt` is held for handle toggling. Modifier presses
  restyle the pointer immediately, without waiting for the mouse to move.
- Quick curve (`Ctrl + Space` + drag) now draws a quarter ellipse in a single
  gesture instead of a chord you bend afterwards. The arc leaves the press
  point with a flat tangent and meets the pointer with an upright one, bowing
  through the far corner of the drag, and it reshapes live as the pointer
  moves; the release (mouse-up or touch-up) places its far end. Pen, touch,
  and mouse all take the same path, so the quick curve no longer borrows the
  Curve tool's bend phase or its stylus special case.
- Holding `Alt` during a quick curve makes the arc a quarter circle, with the
  shorter drag axis setting the radius (matching `Shift` on the Ellipse tool).
  `Alt` is tracked for as long as the drag runs, so pressing or releasing it
  mid-drag toggles between circle and ellipse.
- Each `Shift` press during a quick curve swings its apex — the bowed-out
  belly of the arc — a further 90 degrees clockwise. Both ends stay exactly
  where the drag put them, so the start remains anchored to whatever the
  curve was begun on and the far end remains under the pointer; only the side
  the curve bellies out to moves. Two presses mirror the sweep across its
  chord and four bring the apex back around; on an `Alt` quarter circle (or a
  square drag) the odd stops flatten the arc onto its chord, since a quarter
  arc pinned at both ends can only bow two ways. Key auto-repeat is ignored,
  so holding `Shift` parks the apex at one angle rather than spinning it.
- Because `Shift` now aims a quick curve's apex, the quick curve's far end no
  longer snaps to stroke endpoints; `Shift+Ctrl+Space` still snaps its
  **start** on pointer-down. Endpoint snap is untouched everywhere else.
- The quick straight line (`Space` + drag) locks **strictly horizontal or
  vertical** while `Shift` is held mid-drag — whichever axis the drag favours
  — and frees again the moment `Shift` is released, without waiting for the
  pointer to move. The line's end therefore no longer snaps to stroke
  endpoints (`Shift+Space` at press still snaps its start).
- Direct Select's lone-anchor handles are now real **tangent handles**:
  hollow tips on guide lines reaching a fixed screen distance out along the
  path each way, instead of the raw neighbour samples (which sit a pixel or
  two from the anchor on a dense stroke — too close to see or grab).
  Dragging a handle bends the stroke around the pinned anchor: the span
  between anchor and handle turns rigidly so the tip tracks the pointer, the
  bend eases smoothly into the untouched remainder, and pulling the handle
  longer or shorter stretches the span. Sparse strokes (a two-point line)
  swing rigidly, so the handles work on every stroke shape.

### Fixed

- `Ctrl` and `Alt` now work reliably in Vector Path edit mode. Holding
  `Ctrl` armed the Copic quick nib-rotate hold (its default hold key), which
  switched tools after a second and collapsed the edit; the hold no longer
  arms while the Vector Path tool is active. An `Alt` press could focus the
  native menu bar, blurring the canvas and dropping the edit before the
  click landed; `Alt` is consumed while the tool is active.
- Anchors, handles, and the rounding target were nearly impossible to click:
  the hit radius followed the Direct Select sensitivity (default 3 screen
  pixels). Vector-edit targets now use a radius of at least 8 screen pixels.

The Curve tool (`V`) is unchanged: drag a chord, bend, click to place.

## [3.0.1-alpha] - 2026-07-30

### Fixed

- SVG import now rebuilds nested layers the way the source editor shows them.
  Illustrator (and any editor that writes object names into `id`) exports a
  named object as a loose `<path id="outline">` beside its sibling groups;
  those paths were flattened onto their parent group's layer, so names such as
  `outline`, `glove`, `beard`, `teeth`, or `white`/`black` were lost and the
  marks jumped in front of or behind the groups they sat between. Named
  geometry now imports as its own layer, in its document position, at every
  nesting depth.
- Layer names imported from an `id` drop the `-2`, `-3`, … suffix editors add
  to keep XML ids unique, and undo `_xHH_` escaping, so rows read `strokes`,
  `outline`, and `arm` instead of `strokes-10`, `outline-5`, and `arm-2`. A
  trailing `-0` or `-1` is kept, and `data-name` / `inkscape:label` names are
  always taken verbatim.
- The ids Inkscape hands to unnamed elements (`path4521`, `g830`, `rect12`) no
  longer become layer names — a tag name followed by digits reads as unnamed,
  so Inkscape files import as layers rather than as a wall of ids. A layer the
  author actually called `text` or `line` keeps its name.
- A group that mixed loose marks with nested groups produced a child row
  carrying the parent's own name (`shirt-assembly > shirt-assembly`). Groups
  no longer duplicate their name; a group's own leftover marks land on a row
  named `<name> contents`.
- Unnamed geometry keeps its z-order relative to its named siblings: a run of
  adjacent unnamed elements imports as one `<Path>` layer in place, rather
  than being pooled onto the parent layer.

### Added

- `importSvg(text, { unnamedElements: 'split' })` gives every unnamed element
  its own `<Path>` layer, mirroring an Illustrator layers panel exactly. The
  default, `'merge'`, keeps unnamed marks as strokes on their group's layer so
  stroke-heavy artwork does not explode into hundreds of rows.

## [3.0.0-alpha] - 2026-07-12

### Added

- Endpoint snap: hold `Shift` while drawing with the pen, marker, or Copic
  marker to snap the stroke to the nearest endpoint of an existing stroke on a
  visible layer — the start point snaps on pen-down and the end point on
  pen-up, and straight lines (`Space` + drag) snap both ends live. A ring
  marks the endpoint in range. The snap sensitivity is measured in screen
  pixels (1-20px, default 10px) so zooming in gives finer control; the
  sensitivity and an on/off switch (on by default) live under "Quick
  Features" in the settings window.
- Join stroke (off by default, under "Quick Features"): when on, a stroke
  whose snapped start or end lands on another stroke's endpoint (same tool
  and color) merges with that stroke into one continuous stroke.
- Sketch Support toolbar section with new tools:
  - Join strokes (`Ctrl+J` or the Join button): merges two or more selected
    strokes end-to-end (nearest endpoints first) into one stroke.
  - Rectangle (`R`): drag to draw a rectangle; hold `Shift` for a uniform
    square. Commits as an editable pen stroke.
  - Ellipse (`L`): drag to draw an ellipse; hold `Shift` for a uniform
    circle.
  - Curve (`V`): drag a chord, release, move to bend the quadratic curve,
    then click to place it (`Esc` cancels). Also available as a quick
    feature: hold `Ctrl+Space` and drag with any drawing tool. Endpoint snap
    works in both quick modes — `Shift+Space` snaps straight lines and
    `Shift+Ctrl+Space` snaps curves.
  - Paint bucket (`G`): click inside an enclosed path or shape to fill it
    with the current ink color, added as a new selectable shape.
  - Eyedropper (`I`): click the canvas to pick the color under the pointer
    (averaged over the configurable "Select pixel sensitivity", 1-36px,
    default 10px); the pick becomes the ink color and fills the selected
    shape when one is selected. Hold `Ctrl` to temporarily switch to the
    Select tool and pick a shape; releasing `Ctrl` returns to the
    eyedropper.
- Fill Shape: with the Select tool active and a shape selected, clicking a
  quick-access color fills the selected closed shape with that color (open
  strokes and text are recolored instead).
- Filled shapes: strokes can now carry a `fill` color, honored by the
  canvas, thumbnails, SVG export/import (via `data-fill`), and PDF export.
  Fill-only shapes in imported SVGs now import filled instead of as thin
  outlines.
- Group Layers (`Ctrl+G` or the Group button in the Layers panel): wraps the
  active layer in a group; groups nest, and their visibility, lock, and
  opacity apply to every layer inside. `Ctrl+Shift+G` ungroups. Deleting a
  group deletes the layers inside it.
- Illustrator-style layer management in the Layers panel:
  - Every new drawn element (stroke, shape, text, image, bucket fill) gets
    its own layer, named after the tool (an empty active layer is reused);
    eraser strokes stay on the active layer so they keep cutting its content.
  - `Shift`-click selects multiple layer rows; the Delete button removes
    every selected layer together with its elements.
  - Selecting elements on the canvas highlights their layer rows, and
    selecting a layer row highlights its elements on the canvas (groups
    include everything nested inside them).
  - Group rows carry a disclosure caret to expand/collapse their nested
    layers.
  - Layer rows drag-and-drop to reposition in the stack or drop onto a group
    row to nest inside it (insertion edges and a drop-into outline preview
    the target).
  - Deleting an element deletes its layer once the layer is empty (and any
    group that empties with it); deleting a layer still deletes its
    elements.
- Direct Select tool (`A`, toolbar button): click an element to show its
  anchor points, then drag an anchor to reshape the stroke's path (undo
  restores the original shape; `Esc` drops the edit).
- Fill Color tool (toolbar button): fills the selected element(s) with the
  selected ink color, or the element under the click when nothing is
  selected (open strokes and text are recolored).
- Curve tool flyout: click and hold the Curve button to choose between the
  default "start and end at endpoints" variant and the "free ends" sibling,
  Illustrator-style; a corner marker on the button signals the flyout.
- SVG import keeps nested `<g>` groups as nested layer groups, so imported
  structure can expand/collapse and reorganize in the Layers panel.
- Alt + mouse-wheel zoom toward the pointer (scroll up zooms in, scroll down
  zooms out); the direction is configurable under "Pan & Zoom" in the Verbose
  Settings window ("Invert Alt + scroll-wheel zoom direction").
- Quick Zoom: press `Z` then a digit within the quick-feature timer to zoom to
  that level — `1`–`9` set 10%–90% and `0` sets 100% (centered on the canvas).
- Mouse-wheel pan: scroll the wheel to pan vertically and `Ctrl+Shift` +
  wheel to pan horizontally; the direction is configurable ("Invert
  scroll-wheel pan direction" under "Pan & Zoom").
- Select tool: hold `Space` and drag to pan the canvas (direction
  configurable via "Invert Select + Space drag pan direction").
- Select all: `Ctrl+A` selects every editable element on the page.
- Layer range select: `Ctrl/Cmd+Shift`-click a layer row to select every
  layer between it and the active layer, so a range can be grouped at once.
- Direct Select gains multi-anchor selection (`Shift`-click), draggable
  anchor-point handles, whole-path selection and move, and a configurable
  grab sensitivity (1–20px, default 3px, under "Sketch Support"). Selected
  anchors and paths render blue.
- Ungroup layers: `Ctrl+Shift+G` dissolves the active group (also available
  from the Layers panel).
- Deselect all: `Ctrl+Shift+A` clears the current selection.

### Changed

- **BREAKING**: the `.skbk` schema is now version 3 — layers may carry
  `group`/`parent` fields and strokes an optional `fill` color. Version 1
  and 2 files still open unchanged (saving re-writes them as version 3).
- Endpoint snap default sensitivity changed from 5px to 10px.
- Settings unified into two synced views: the in-app panel (`Ctrl+,`) is now
  "Quick Settings" and the settings window (`Ctrl+Alt+,`, Edit menu) is
  "Verbose Settings". The verbose window gained the Quick Settings section
  (live sharpen, wobble, smoothing, circle snap, taper, symmetry, text
  size), and both views edit the same persisted values.
- The Curve tool now snaps its chord's start and end to nearby stroke
  endpoints by default (the previous free-ends behavior remains available
  from the tool's click-and-hold flyout).
- The "Fill" toolbar tool is renamed "Paint Bucket" and carries the common
  paint-bucket icon; "Fill Color" is a separate new tool.
- The toolbar button that opens the in-app settings panel is labeled
  "Quick Settings", and the gear icon's hover text now reads "Verbose
  Settings".
- Toolbar rearrange mode now covers every tool in both toolbar groups and
  allows dragging tools between the groups, matching common vector-editor
  toolbar customization; the saved tool order persists across both groups.
- The Select tool supports `Shift`-click to add elements to (or remove them
  from) the current selection.

### Fixed

- Group (`Ctrl+G` / the Group button) now groups **every selected layer**
  into one group, not just the active layer, keeping their relative order
  and nesting.
- Curve tool with a stylus: a pen no longer produces a straight line. Because
  a stylus cannot hover between the tool's two clicks (select the chord, then
  move to bend), one pen gesture now draws the whole curve directly from the
  pen's path, so a curved pen stroke stays a curve.
- SVG import: documents whose content is wrapped in a single top-level group
  (as many editors export, often named after the file) now import each inner
  group as its own layer instead of one flattened layer; the wrapper's
  opacity carries into the imported layers.

## [2.1.0-alpha] - 2026-07-12

### Added

- Copic marker tool (`K`, toolbar button): simulates an alcohol-ink marker's
  flat broad nib. Strokes are thick across the nib and thin along it, the nib
  angle is stored per stroke (`nibAngle`, schema-compatible with version 2
  files), and the cursor previews the nib as a rotated bar. Copic strokes
  render as filled chisel outlines in the canvas, SVG export (with lossless
  round-trip via data attributes), and PDF export.
- Quick nib rotate: hold `Ctrl` for the configured hold time (1s by default)
  to show a rotation indicator in the bottom-right corner, then hold `Alt` to
  rotate the broad nib clockwise or `Shift` to rotate it counter-clockwise at
  the configured speed; releasing `Ctrl` ends the mode. On by default.
  Activating the mode switches to the Copic marker with the stroke width
  scaled by the configurable width multiplier (1-4x, default 2x, capped at
  the 40px maximum), remembering the tool and width in use; deactivating
  restores that last-used tool and width unless the user explicitly changed
  either while the mode was active.
- Settings window section "Copic Marker": quick-feature on/off, hold time
  (0.5-2s), hold key, both rotate keys (`ctrl`/`alt`/`shift`, kept distinct
  automatically), rotation speed (15-360 degrees per second), and the
  quick-rotate width multiplier (1-4x).
- Rotational symmetry (mandala mode) rotates the Copic nib angle with each
  mirrored copy so every arm shows the same thick/thin behaviour.

## [2.0.0-alpha] - 2026-07-10

### Added

- Layers: every page now has a layer stack with per-layer opacity, visibility,
  lock, rename, and up/down reordering, managed from a new Layers panel
  (`Ctrl+L`, View menu, or the toolbar button). Drawing, erasing, selection,
  and Sharpen All respect the active layer, and the eraser only cuts holes in
  its own layer. Layer opacity is honored by the canvas, thumbnails, and every
  export format.
- PDF export: File > Export > PDF Document writes a vector PDF with no added
  dependencies. "Export all pages" produces a single multi-page document;
  layer and stroke opacity are preserved, and text exports as real PDF text.
- Import (`Ctrl+I`, File > Import, or the toolbar button):
  - SVG files import as editable strokes with top-level groups becoming
    layers; napkin-sketch's own SVG exports round-trip losslessly (tools,
    paint order, and eraser masks are recovered from data attributes).
    Generic SVG shapes and beziers are sampled into freehand strokes.
  - PDF files import best-effort: each page's vector paths and text become a
    new sketch page (napkin-sketch's own PDF exports round-trip).
  - PNG/JPEG files import as movable, selectable image items placed on the
    active layer and scaled to fit the page.
- SVG export now wraps each layer in a named `<g>` group and renders eraser
  strokes as a black-on-white layer mask, so erasing no longer paints opaque
  background color over content beneath.
- Embeddable API: `NapkinSketch#toSVG()` and `#toPDF()`, plus new browser-safe
  exports `sketchesToPdf`, `importSvg`, `createLayer`, `layerOf`,
  `strokesOnLayer`, `isImageStroke`, and the `Layer` type.

### Changed

- **BREAKING**: the `.skbk` schema is now version 2 - each sketch carries a
  `layers` array and each stroke a `layer` id. Version 1 files still open:
  they are migrated in place by giving each page a single default layer (no
  action needed; saving re-writes the file as version 2).
- **BREAKING**: the `Sketch` type (public API) gained a required `layers`
  field, and `Tool` gained the `'image'` variant used by placed raster
  imports. Code constructing sketches via `createSketch()` is unaffected.

## [1.0.0-alpha] - 2026-06-28

### Added

- Pan and zoom: a two-finger gesture pans within +/-72px of the initial finger
  distance and zooms in or out beyond it, scaled by the configured
  sensitivities and an optional inverted-zoom direction.
- Straight line: hold `Space` and drag with a single pointer to draw a clean
  straight line, with a dashed preview shown until release.
- Quick Width: press `W` then type a number to set the current tool width once
  the quick-feature timer elapses.
- Quick Opacity: press `Q` then type a number to set the current tool opacity;
  `0` maps to 100% and `00` maps to 0.1%.
- Color change: press `C` to cycle the Quick Access Colors left to right (or
  `Shift+C` for right to left), wrapping around at the ends; the active color
  shows the same bold border as a mouse selection.
- Settings window (opened from the Edit menu or the gear icon) with zoom and pan
  sensitivity, inverted zoom, quick-feature timer (0.5-3s), Quick Access Color
  count (2-20) and editable colors, toolbar placement (top / side / both),
  rearrange mode with drag-and-drop tool and color ordering, color theme
  (light / dark / sepia), and an auto-save interval.
- Settings persistence: kept in memory across launches, exportable to a JSON
  file, and importable from one (the last loaded file is remembered).
- New `-f`, `--full-screen` CLI option to open the GUI window full screen.
- Per-stroke opacity in the data model, honored by the canvas, thumbnails, and
  SVG export.

## [0.0.0-alpha] - 2026-06-06

### Added

- Command-line interface (`napkin-sketch`) with `--help`, `--version`,
  `--book`, `--new`, and `--sharpen` options plus bare-path opening.
- Electron-based drawing GUI with pen, marker, and eraser tools.
- Pressure-aware, variable-width stroke rendering on a high-DPI canvas.
- Mouse, touchscreen, and stylus input via Pointer Events with coalesced
  sampling.
- Auto-sharpen engine: line / circle / polygon / freeform recognition, idealized
  shape rebuilding, and organic hand-drawn wobble with end taper.
- Live sharpen (per-stroke on pen-up) and "Sharpen all" (whole page) modes.
- Headless `--sharpen` pass that beautifies and re-saves a `.skbk` file.
- Multi-page sketch books with a portable, human-readable `.skbk` JSON format
  and atomic (write-then-rename) saves.
- Undo / redo history, clear, custom ink colors, and keyboard shortcuts.
- Select tool for moving and deleting existing strokes.
- Text tool with editable, resizable on-canvas text boxes.
- Sketchbook pages panel with thumbnail previews, page-turn animation, and
  add / delete / navigate controls.
- Native application menus: File (New, Open, Save, Save As, Export PNG, Export
  JPEG) and Edit (Undo, Redo).
- Image export to PNG (transparent paper) and JPEG (flattened background).
- Auto-sharpen settings panel exposing wobble, smoothing, circle snap, end
  taper, rotational symmetry (mandala mode), and text size. Live sharpen now
  defaults to **off**.
- Embeddable, browser-safe API (`NapkinSketch`) for websites, WordPress blocks,
  and VS Code webviews, shipped as both ESM and IIFE bundles.
- Generated application icon and electron-builder packaging (Windows NSIS
  installer with Start-menu and desktop shortcuts, plus macOS/Linux targets).
- Unit test suites (Node built-in runner) for geometry, the sharpen engine,
  `.skbk` serialization, CLI parsing, and the launch contract.
- Accessible, calm UI following a 60-30-10 cool/neutral palette with a single
  warm accent, WCAG-AA contrast, and reduced-motion support.

### Fixed

- Eraser now reveals the paper beneath strokes (two-layer compositing) instead
  of painting over them when Live sharpen is off.
- Saved file name is shown in the status bar and window title instead of always
  reading "unnamed".
- Added thumbnail-based page navigation so earlier pages can be revisited after
  adding a new page.
