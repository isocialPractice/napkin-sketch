# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
