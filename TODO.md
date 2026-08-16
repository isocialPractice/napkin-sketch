# TODO

Roadmap for **napkin-sketch**, grouped by semantic-version impact. Items are
aspirational and unordered within each group.

## Current

- [ ] **Export SVG File Size**: Exported SVG's are much larger than the imported
  SVG when imported and exported without making changes.
  - **GOAL**: Export with less date, while mainitaing the integrity of the graphic
    being exported or keeping the graphic intact.
  - From: Minor

## Resolve Issues (`x.y.++`)

- [ ] Maintain SVG layer names on export

## Major (breaking / large features → next `++.y.z`)

- [ ] **Pressure-aware brush engine**: replace the width model with a velocity- and
  tilt-aware dynamic brush (calligraphy, charcoal, ink-wash presets).
- [ ] **Real-time collaboration**: shared sketch books over WebRTC/CRDT so multiple
  pointers can draw on the same page.
- [ ] **Plugin API v2**: stable, documented extension points (custom tools, custom
  sharpen passes, export targets) with a semver contract.
- [ ] **GUI Redesign**: update GUI overall design.
  - Initial sketches
  - Polish and apply
  - System that is easily modified in order to inline with GUI desing trends
    - Highly configurable where uses can also mod, or set and customize UI/UX

## Quick Features (ideas → next `x.++.z`)

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
- [ ] **Export Selection**: Export only the currently selected layers or elements.
- [ ] **Prompt to Save**: If a file contains data, and has not been saved; when
 GUI is closed, prompt user to save file.

## Patch (fixes, polish, internal → next `x.y.++`)

- [ ] **High-DPI thumbnails**: render the pages-panel thumbnails at device pixel
  ratio to avoid blur.
- [ ] **Text editor UX**: commit on `Esc`, keep caret styling in sync with the
  selected font size, and reposition on window resize.
- [ ] **Eraser cursor preview**: show a circle the size of the eraser width.
- [ ] **Symmetry guide fade**: animate the mandala guide axes in/out.
- [ ] **Reduced-motion support**: honor `prefers-reduced-motion` for the page-turn
  animation.
- [ ] **Icon rasterization**: ship multi-resolution `.ico`/`.icns` instead of a
  single PNG.
- [ ] **More tests**: cover the renderer store (undo/redo, pages, selection) and the
  embeddable `NapkinSketch` editor via a DOM test environment.
- [ ] **Docs**: API reference for the embeddable package and a WordPress block
  example.
- [ ] **Panel Improvements**:
  - [ ] **Resize Panels**: Allow the side and top panels to be resized.
  - [ ] **Undock Panels**: Allow the side and top panels to be undocked and moved freely outside of the GUI window.

## Complete

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
