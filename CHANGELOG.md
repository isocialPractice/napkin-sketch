# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
