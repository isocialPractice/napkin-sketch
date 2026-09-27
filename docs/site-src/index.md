# napkin-sketch

![napkin-sketch: its logo beside the app, a sketch on the canvas with the Layers and Properties panels open](../assets/banner.gif)

<!-- version:start -->
This documents napkin-sketch **1.0.0-alpha.4.5.0**.
<!-- version:end -->

Quick and easy computer sketching with a drawing GUI that simulates pen and
paper/napkin sketching — featuring an **auto-sharpen** algorithm that turns
stiff, computer-drawn strokes into cleaner, more hand-drawn forms.

Draw with a **mouse, touchscreen, or pen** (pressure-aware), then let
napkin-sketch straighten your lines, round out your circles, square up your
boxes, and re-introduce a subtle organic wobble so the result still reads as
hand-drawn rather than vector-perfect.

## Three ways in

- **Use the app.** [Install it](install.md), then take the
  [Quickstart](../../QUICKSTART.md): a sharpened sketch in five minutes.
- **Draw from a script.** The [API quickstart](../../API-QUICKSTART.md) is the
  whole drawing language in five steps, and the drawings come out as SVG, PNG,
  PDF or a sketch book, with no window.
- **Embed it.** [Embedding the editor](embed.md) puts the editor, or only its
  engine, in a page of your own.

## What it does

- **Draws like a pen** - pressure-aware pen, marker and a Copic marker with a
  turnable nib; see [Tools](guide/tools.md).
- **Sharpens by hand** - squares up boxes and rounds out circles, and keeps a
  wobble; see [Sharpening](guide/sharpen.md).
- **Edits like a vector editor** - anchors and handles, stroke profiles,
  Transform, Rotate, Mirror and Mesh Warp; see [Vector paths](guide/vector-paths.md)
  and [Transform](guide/transform.md).
- **Keeps things in order** - layers and groups, pages of any size; see
  [Layers](guide/layers.md) and [Pages](guide/pages.md).
- **Round-trips SVG** - imports another editor's layers, curves and gradients,
  and exports them small; see [Import and export](guide/import-export.md).
- **Writes scripts** - a drawing, a file or a session as napkin script; see
  [Automate](guide/automate.md).
- **Draws from scripts** - from a shell, from Node, or from any language; see
  [Drawing from a script](scripting.md).
- **Animates, optionally** - an add-on that draws frames with an AI helper;
  see [Animation Mode](guide/animation-mode.md).

## Where these pages come from

These pages are written from the repository's own Markdown by
`npm run site`. The tables of verbs, commands, exit codes, settings, npm
scripts and shortcuts in them are written from the code, and the tests fail
when one of them falls behind. Every napkin example on the API pages runs in
the tests. [About and license](about.md) says more.

## Every page

### Quickstarts

<!-- pages:quickstarts:start -->
- [Quickstart: drawing](quickstart/draw.md) - Pick a tool, draw, use the quick gestures and sharpen: the Sketch menu in one sitting.
- [Quickstart: transforming](quickstart/transform.md) - Move, rotate, mirror, scale and bend a selection: the Transform menu in one sitting.
- [Quickstart: layers](quickstart/layers.md) - Name, group and restack layers, and edit a selection in the Properties panel.
- [Quickstart: pages](quickstart/pages.md) - Add pages three ways, size them, move between them, and export them all.
- [Quickstart: automating](quickstart/automate.md) - Write a script from a drawing, record a session, and draw with no window at all.
<!-- pages:quickstarts:end -->

### Using the app

<!-- pages:guide:start -->
- [Using the app](guide/index.md) - The manual, in the order it is best read, one line per page.
- [Tools](guide/tools.md) - The drawing tools, the Copic marker and its nib, and the Sketch Support toolbar.
- [Gestures and input](guide/gestures.md) - Pen, touch and mouse; pan and zoom; the straight line, the quick curve, endpoint snap and the held keys.
- [Vector paths and stroke profiles](guide/vector-paths.md) - Editing anchors and handles, rounding corners, Sharpen Selection, and the four stroke profiles.
- [Selecting and editing](guide/selection.md) - Selecting, filling, widening, the clipboard, and what a press on a selection does.
- [Transform, Rotate, Mirror and Mesh Warp](guide/transform.md) - The Transform box, Rotate, Mirror, Mesh Warp, and docking their panels.
- [Layers and the Properties panel](guide/layers.md) - The Layers panel, groups, restacking, and editing a selection in the Properties panel.
- [Pages](guide/pages.md) - The pages panel, page sizes, and the three ways to add a page.
- [Import and export](guide/import-export.md) - What SVG, PDF and pictures arrive as, and what PNG, JPEG, SVG and PDF exports keep.
- [Sharpening](guide/sharpen.md) - Live sharpen, Sharpen all, and how the auto-sharpen engine decides what a stroke meant.
- [Settings](guide/settings.md) - Quick Settings and Verbose Settings, and every setting with its default and range.
- [Menus and shortcuts](guide/menus-and-shortcuts.md) - The menu bar, the right-click menus, every keyboard shortcut, and changing them.
- [Automate](guide/automate.md) - Generate Script from a file, the selected layers or the session history, and Track History.
- [Animation Mode](guide/animation-mode.md) - The optional add-on that draws animation frames with an AI helper: installing it and using it.
- [The .skbk file format](guide/skbk-format.md) - What a saved sketch book holds, and how older files open.
- [The command line](guide/command-line.md) - Opening the app from a shell: every option, and the four commands that need no window.
<!-- pages:guide:end -->

### Building on it

<!-- pages:building:start -->
- [Embedding the editor](embed.md) - The editor in your own page, the pure engine, and the graphic-design API.
- [Drawing from a script](scripting.md) - napkin script from a shell, from Node or from any language, and what it writes.
- [The AI helpers](ai-helpers.md) - The graphic-designer and scripting helpers: what each does and how to use it.
- [The AI helper plugins](../../ai-helper/README.md) - The three plugins, and installing them where an AI tool looks.
<!-- pages:building:end -->

### Developing

<!-- pages:developing:start -->
- [Building and packaging](develop/building.md) - Building, watching and packaging the app, and every npm script.
- [Testing](develop/testing.md) - The test suites, the golden scripts, the GUI checks and the package check.
- [Project structure](develop/project-structure.md) - Every folder and file under src/ and docs/api/, and what each holds.
<!-- pages:developing:end -->
