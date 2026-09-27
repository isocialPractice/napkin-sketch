# Project structure

```text
src/
├── cli/
│   ├── index.ts        # Command-line entry (GUI launch, headless sharpen, commands)
│   ├── args.ts         # Pure argument parsing, the commands' included
│   ├── draw.ts         # draw, check, render, verbs: no window, no Electron
│   └── helper.ts       # Runs the AI helper for draw --prompt, in the working folder
├── main/
│   ├── main.ts         # Electron main process, native menus, image export, IPC
│   ├── menu.ts         # The menu bar: the registry's rows, each with its click
│   ├── docs.ts         # The documentation window's decisions: where the pages are, where a link goes
│   └── preload.ts      # Secure window.napkin bridge
├── renderer/
│   ├── index.html      # GUI markup (toolbar, pages/layers panels, settings panel)
│   ├── settings.html   # Verbose Settings window markup
│   ├── styles.css      # GUI styling (60-30-10, WCAG-AA)
│   ├── renderer.ts     # UI wiring + pointer input
│   ├── commands.ts     # Every command the window runs, by its menu id
│   ├── keys.ts         # Keys to commands, through the menu registry
│   ├── menus.ts        # Right-click and dropdown items, from the registry's rows
│   ├── config-dialog.ts # The configuration popup the menu editors fill
│   ├── editors.ts      # The menu editors: Edit Keyboard Shortcuts and Edit Tool Types
│   ├── script-dialog.ts # The Generated script dialog: a script shown before it is used
│   ├── history-tracker.ts # Track History: each step named and kept, to the History Limit
│   ├── settings.ts     # Verbose Settings window logic
│   ├── surface.ts      # High-DPI, layered canvas rendering + SVG export
│   ├── svg-import.ts   # SVG → layered strokes importer (browser-only)
│   ├── popup.ts        # What every editing popup shares: moving, docking, staying on screen
│   └── store.ts        # App state, layer stack, undo/redo history
├── assets/
│   ├── move-popup.svg  # The cursor over something the Move panel can move
│   └── rotate-popup.svg # The cursor of a Rotate drag
├── sharpen/
│   ├── geometry.ts     # Geometry & curve utilities
│   └── sharpen.ts      # Auto-sharpen engine
├── api/
│   ├── index.ts        # Public, browser-safe API barrel: `napkin-sketch`
│   ├── node.ts         # Node-only entry: `napkin-sketch/node`, the file half
│   └── embed.ts        # Embeddable NapkinSketch editor
├── docs/
│   ├── api-docs.ts     # The documentation's generated parts: tables, schema, index
│   ├── menu-docs.ts    # The menus table and the shortcut tables, from the menu registry
│   └── site.ts         # The documentation site: every page from its Markdown, one chrome
└── core/
    ├── types.ts        # Shared data model (sketches, layers, strokes)
    ├── nib.ts          # Copic broad-nib geometry (canvas, SVG, and PDF share it)
    ├── units.ts        # Print-unit conversions for the properties panel
    ├── settings.ts     # Application settings: defaults, limits, validation
    ├── serialize.ts    # Browser-safe .skbk (de)serialization + validation
    ├── sketchbook.ts   # .skbk file I/O (atomic writes)
    ├── script-files.ts # Node-only: scripts read from files, drawings written to files
    ├── pdf.ts          # Dependency-free vector PDF writer (browser-safe)
    ├── illustrator.ts  # An Illustrator script that rebuilds a drawing (browser-safe)
    ├── pdf-import.ts   # Best-effort PDF vector importer (Node-only)
    ├── imported-sketch.ts # An imported file's layers, for the store and as a page of its own
    ├── history-diff.ts # What one step of the history changed on a page
    ├── path-data.ts    # Path data and basic shapes to Bézier anchors, and sampling; no DOM
    ├── svg-path.ts     # Compact SVG path data: the writer every export shares
    ├── bounds.ts       # The box each kind of mark covers, with no DOM
    ├── sketch-svg.ts   # A sketch as SVG, with no DOM: the app's SVG export
    ├── sketch-composition.ts  # A sketch lowered into the composition model, for PNG
    ├── link.ts         # Linked files: their names, placeholders, and the paths a host follows
    ├── effects.ts      # Effects: the CSS filter functions, as data every output can draw
    ├── transform.ts    # The Transform tool's arithmetic: one box, eight handles, two modifiers
    ├── mesh-warp.ts    # Mesh Warp: bending art by pins, as Illustrator's Puppet Warp does
    ├── stroke-profile.ts # Stroke profiles: how a stroke's width runs along its length
    ├── menu/           # The menus as data: every command, its type and its shortcut
    │   ├── tool-types.json  # Every command, the type that places it, and the menus
    │   ├── shortcuts.json   # Every command's keyboard shortcut
    │   ├── ids.ts           # Command ids, the questions a row asks, roles, positions
    │   ├── registry.ts      # Both files and the user's merged; every menu generated
    │   ├── chords.ts        # Shortcuts read, written, shown, and matched to keys
    │   ├── overrides.ts     # The user's two files: read, and an edit's differences
    │   └── links.ts         # Where Help sends people: the repository, the docs site
    ├── script/         # napkin script: read, check, run and write the language
    │   ├── instructions.ts  # The object form every front end lowers to
    │   ├── verbs.json       # Verb table: grammar, summaries, examples, codes
    │   ├── tokenize.ts      # Text to tokens, with lines and columns
    │   ├── parse.ts         # Tokens to instructions, walking the verb table
    │   ├── validate.ts      # A script built as JSON, checked the same way
    │   ├── format.ts        # Instructions back to canonical text
    │   ├── writer.ts        # A drawing back to instructions: the evaluator in reverse
    │   ├── generate.ts      # Automate > Generate Script: a file or the selected layers as a script
    │   ├── history-script.ts # The session history as a script, the unticked steps left out
    │   ├── evaluate.ts      # Instructions to a sketch book: the evaluator
    │   ├── sink.ts          # Where a run's pages, layers and marks go
    │   ├── state.ts         # The paint, transform and units a run carries
    │   ├── shapes.ts        # The shape verbs' outlines and fillets, as Bezier anchors
    │   ├── through.ts       # The curve `through` draws, an anchor at every point
    │   ├── library.ts       # The shape library `shape` draws from
    │   ├── library-build.ts # Reads the library's SVG assets, with no DOM
    │   ├── shape-library.json  # The library itself, written by npm run shape-library
    │   ├── expr.ts          # Expressions: reading and running them
    │   ├── values.ts        # Lengths, colors, names: the shared vocabulary
    │   ├── grammar.ts       # Helpers that read the verb table's forms
    │   ├── diagnostics.ts   # Building, printing and suggesting
    │   ├── version.ts       # The `napkin <version>` rule
    │   ├── reference.ts     # The verb table as documentation tables
    │   ├── schema.ts        # The object form as a JSON Schema
    │   ├── rough.ts         # The hand-drawn pass and its measured constants
    │   ├── text.ts          # Text measured with the built-in face, and drawn as marks
    │   ├── media.ts         # Image sizes, upright boxes, and copying documents for `use`
    │   ├── render.ts        # One call, every format: SVG, PNG, PDF, .skbk, .jsx, and the box
    │   ├── draw.ts          # drawSvg: a script straight to SVG
    │   ├── ai-bridge.ts     # A script from a sentence: the form, the check, one more try
    │   ├── animation.ts     # Animation frames from a measured cycle, as a script
    │   ├── effects.ts       # The `effect` verb, turned into the model's effects
    │   └── index.ts         # The language's barrel
    ├── graphic-design/ # Graphic-design API: elements in, SVG or PNG out
    │   ├── types.ts    #   Composition data model (page, elements, masks)
    │   ├── compose.ts  #   Authoring surface: createComposition and friends
    │   ├── svg.ts      #   SVG back end (browser-safe, DOM-free)
    │   ├── raster.ts   #   Software rasterizer (scanline coverage, clipping)
    │   ├── png.ts      #   PNG encoder and decoder
    │   ├── deflate.ts  #   DEFLATE/zlib codec the PNG pair runs on
    │   ├── font.ts     #   Built-in stroke font + the layout both back ends share
    │   ├── geometry.ts #   Transforms, flattening, path data, dashing, stroking
    │   ├── color.ts    #   CSS color parsing for the rasterizer
    │   ├── gradient.ts #   Gradient paint: where it runs, and its color along the way
    │   ├── canvas.ts   #   Canvas 2D painter (the GUI-canvas target)
    │   ├── effects.ts  #   Effects on pixels: the rasterizer's passes over an element's picture
    │   ├── brand.ts    #   Brand resources: a design language's own files
    │   └── files.ts    #   Node-only file helpers (data URLs, paired export)
    ├── paths.ts        # Dependency-free path helpers
    ├── animation.ts    # Animation Mode data model, pose steps, helper form
    ├── animation-cycles.ts   # Cycle tables measured from the wireframe asset
    ├── animation-install.ts  # Animation Mode's optional-install record
    ├── ai-tool.ts      # The AI tools the helper can drive, and why one refused
    ├── launch.ts       # CLI ↔ main launch contract
    └── ipc.ts          # IPC channel + bridge types
```

```text
docs/api/               # The API documentation; API.md at the root maps it
├── INDEX.json          # Every page: its kind, first paragraph and size
├── schema/             # The object form as a JSON Schema, generated
├── cli/examples/       # Callers in sh, cmd, Node, Python and C, run by the tests
└── <category>/         # language, drawing, compose, output, cli, node, interop, ai
    ├── README.md       #   The reference
    ├── QUICKSTART.md   #   A path that runs as written
    ├── CHEATSHEET.md   #   Tables and one-line reminders
    └── *.html          #   The same three pages on the site, written by npm run site
```

```text
docs/                   # The documentation site, published by GitHub Pages
├── index.html          # The landing page; every page is written by npm run site
├── *.html, guide/, quickstart/, develop/   # The pages, from docs/site-src/ and the root guides
├── site-src/           # The manual's Markdown: what to edit, since the README moved here
├── assets/             # site.css, site.js and banner.gif (the home page's hero, played once), kept by hand; mark.svg, copied
└── .nojekyll           # Serve the files as they are
```
