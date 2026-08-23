# TODO

Roadmap for **napkin-sketch**, grouped by semantic-version impact. Items are
aspirational and unordered within each group.

## Current

- [ ] **Text editor UX**: commit on `Esc`, keep caret styling in sync with the
  selected font size, and reposition on window resize.
  - From: Patch
- [ ] **Icon rasterization**: ship multi-resolution `.ico`/`.icns` instead of a
  single PNG.
  - From: Patch
- [ ] **More tests**: cover the renderer store (undo/redo, pages, selection) and the
  embeddable `NapkinSketch` editor via a DOM test environment.
  - From: Patch
- [ ] **Docs**: API reference for the embeddable package and a WordPress block
  example.
  - From: Patch

## Resolve Issues (`x.y.++`)

## Major (breaking / large features → next `++.y.z`)

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
- [ ] **Export Selection**: Export only the currently selected layers or elements.
- [ ] **Prompt to Save**: If a file contains data, and has not been saved; when
 GUI is closed, prompt user to save file.

## Patch (fixes, polish, internal → next `x.y.++`)

- [ ] **Panel Improvements**:
  - [ ] **Resize Panels**: Allow the side and top panels to be resized.
  - [ ] **Undock Panels**: Allow the side and top panels to be undocked and moved freely outside of the GUI window.

## Complete

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
