# TODO

Roadmap for **napkin-sketch**, grouped by semantic-version impact. Items are
aspirational and unordered within each group.

## Major (breaking / large features → next `2.0.0`)

- **Layers**: per-sketch layer stack with opacity, lock, and reordering.
- **Pressure-aware brush engine**: replace the width model with a velocity- and
  tilt-aware dynamic brush (calligraphy, charcoal, ink-wash presets).
- **Real-time collaboration**: shared sketch books over WebRTC/CRDT so multiple
  pointers can draw on the same page.
- **Plugin API v2**: stable, documented extension points (custom tools, custom
  sharpen passes, export targets) with a semver contract.
- **Vector export**: export sketches to SVG/PDF in addition to PNG/JPEG.

## Quick Features (ideas → next `1.x`)

Follow-on shortcuts in the spirit of Quick Width (`W`) and Quick Opacity (`Q`):
press a letter, type a value within the quick-feature timer, and it applies.

- **Quick Size** (`Z`): type a font size to retarget the text tool without
  reaching for the size slider.
- **Quick Symmetry** (`Y`): type a mandala axis count (1 disables) to change
  rotational symmetry mid-drawing.
- **Quick Page** (`G`): type a page number to jump straight to that page in the
  current sketch book.
- **Quick Zoom** (`X`): type a zoom percentage (for example `150`) to set an
  exact zoom level instead of pinching to it.
- **Quick Hex** (`#`): type a six-digit hex value to set an exact ink color
  without opening the color picker.

## Minor (backward-compatible features → next `1.x`)

- **Lasso + transform**: free-form lasso selection with scale/rotate handles
  (current Select is rectangular move/delete only).
- **Shape tools**: explicit line/rectangle/ellipse/arrow tools that emit clean
  geometry without relying on the sharpen classifier.
- **Color palettes**: savable swatch sets and a recent-colors strip.
- **Grid & guides**: dot/line grid, snapping, and a ruler overlay.
- **Per-page background**: choose napkin, graph, dotted, or blank per page.
- **Configurable shortcuts**: user-editable keybindings.
- **Auto-save & recovery**: periodic snapshots and crash recovery of `.skbk`.
- **Export options dialog**: DPI/scale and transparent-vs-paper background
  choices for raster export.

## Patch (fixes, polish, internal → next `1.0.x`)

- **High-DPI thumbnails**: render the pages-panel thumbnails at device pixel
  ratio to avoid blur.
- **Text editor UX**: commit on `Esc`, keep caret styling in sync with the
  selected font size, and reposition on window resize.
- **Eraser cursor preview**: show a circle the size of the eraser width.
- **Symmetry guide fade**: animate the mandala guide axes in/out.
- **Reduced-motion support**: honor `prefers-reduced-motion` for the page-turn
  animation.
- **Icon rasterization**: ship multi-resolution `.ico`/`.icns` instead of a
  single PNG.
- **More tests**: cover the renderer store (undo/redo, pages, selection) and the
  embeddable `NapkinSketch` editor via a DOM test environment.
- **Docs**: API reference for the embeddable package and a WordPress block
  example.
