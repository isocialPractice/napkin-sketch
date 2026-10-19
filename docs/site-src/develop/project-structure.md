# Project structure

```text
src/
├── cli/
│   ├── index.ts        # Command-line entry (GUI launch, headless sharpen, commands)
│   ├── args.ts         # Pure argument parsing, the commands' included
│   ├── draw.ts         # draw, check, render, verbs: no window, no Electron
│   ├── vendor.ts       # vendor: parts copied into a project, pinned by version and hash
│   ├── prune.ts        # prune: a project's install cut to the parts it keeps
│   ├── gui.ts          # Where the desktop app is - the clone's build or its npm package - and installing it
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
│   ├── press-state.ts  # A press on the canvas as a record: how it ends, whatever ends it
│   ├── held-keys.ts    # Space, Ctrl and Shift: the hand, the lent selection tool, the nib's still hold, the Shift-click line
│   ├── alt-menu.ts     # When a bare Alt may hand the keyboard to the menu bar
│   ├── zoom.ts         # How far the canvas zooms, and screen lengths on the page
│   ├── vector-place.ts # Placing a Vector Path: Shift's eight directions, and when a press closes it
│   ├── notice.ts       # Session notices: why an action did nothing, until ticked away for the session
│   ├── fill-stroke.ts  # Fill and stroke: the one in front, where C takes it, and the tool's swap
│   ├── menus.ts        # Right-click and dropdown items, from the registry's rows
│   ├── config-dialog.ts # The configuration popup the menu editors fill
│   ├── editors.ts      # The menu editors: Edit Keyboard Shortcuts and Edit Tool Types
│   ├── script-dialog.ts # The Generated script dialog: a script shown before it is used
│   ├── history-tracker.ts # Track History: each step named and kept, to the History Limit
│   ├── settings.ts     # Verbose Settings window logic
│   ├── surface.ts      # High-DPI, layered canvas rendering + SVG export
│   ├── svg-import.ts   # SVG → layered strokes importer (browser-only)
│   ├── popup.ts        # What every editing popup shares: moving, docking, staying on screen
│   ├── report-toast.ts # Report toasts: what an action could not do, line by line, bottom right
│   ├── appearance-panel.ts # The Appearance panel: the selection's effects, in the order they draw
│   ├── effect-options.ts # The effect options popup: one form for every effect, from its fields
│   ├── three-d-panel.ts # 3D Options: the selection's 3D, edited live
│   ├── gumball.ts      # The 3D gumball: moving, turning and scaling in depth; its sums need no DOM
│   ├── type-editor.ts  # The type editor: a text edited where it stands on the canvas
│   ├── type-panel.ts   # The Type panel: the Character, Paragraph and Text Configurations tabs
│   ├── type-options.ts # Type on a Path Options, Area Type Options and a configuration's Options
│   ├── type-measure.ts # The canvas's type measure: how wide the system's fonts set a string
│   ├── type-paint.ts   # A type layout painted on the canvas: frame, shades, text, decoration
│   ├── type-faces.ts   # This computer's fonts as outlines, read from their files when asked for
│   ├── font-list.ts    # The fonts on this computer, read with the Local Font Access API
│   ├── composition-styles-panel.ts # The Composition Styles panel: the library, a style a click
│   ├── composition-rule-form.ts # The form one rule of a Composition Style is set in
│   └── store.ts        # App state, layer stack, undo/redo history
├── assets/
│   ├── move-popup.svg  # The cursor over something the Move panel can move
│   ├── rotate-popup.svg # The cursor of a Rotate drag
│   └── type-*cursor.svg # The Text tool's three cursors: a text, a text in a shape, on a path
├── sharpen/
│   ├── geometry.ts     # Geometry & curve utilities
│   ├── index.ts        # The /sharpen entry: the engine alone
│   └── sharpen.ts      # Auto-sharpen engine
├── api/
│   ├── index.ts        # Public, browser-safe API barrel: `@isocialpractice/napkin-sketch`
│   ├── node.ts         # Node-only entry: `@isocialpractice/napkin-sketch/node`, the file half
│   └── embed.ts        # Embeddable NapkinSketch editor
├── markdown/           # `@isocialpractice/napkin-sketch/markdown`: marked's lexer and highlight.js, for a core
│   ├── index.ts        # The entry: registers both with the API's core
│   ├── core.ts         # Both registered with the core the app, the CLI and napkin-sketch/node use
│   ├── lexer.ts        # Markdown Flow's reader: marked, with GitHub's tables and task lists
│   ├── highlight.ts    # Clean Language Accents' reader: highlight.js, its 36 common languages
│   └── wire.ts         # The readers wired to a core given, and a language installed or taken away
├── docs/
│   ├── api-docs.ts     # The documentation's generated parts: tables, schema, index
│   ├── menu-docs.ts    # The menus table and the shortcut tables, from the menu registry
│   └── site.ts         # The documentation site: every page from its Markdown, one chrome
└── core/
    ├── types.ts        # Shared data model (sketches, layers, strokes)
    ├── engines.ts      # The /engines entry: the tools' engines and the page model they edit
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
    ├── paint-order.ts  # The order the canvas paints a page in: the layer stack, effect groups as one
    ├── hit-test.ts     # What a press picks: the ink on top, else the nearest within a reach
    ├── fit-curve.ts    # Freehand samples as the fewest cubic Béziers within a tolerance
    ├── boolean.ts      # Union, difference and intersection of regions, under either fill rule
    ├── erase.ts        # Erasing as geometry: what an eraser leaves of each mark, as marks
    ├── paint.ts        # A mark's outline and fill: what a picked color does to each, and the swap
    ├── wipe.ts         # The wipes: Pathfinder's six operations on marks, and an arrangement's faces
    ├── split.ts        # Split: a path cut where a point lands on it, as Scissors cut
    ├── clip.ts         # Clipping masks: a group shown only inside a closed mark on top
    ├── pencil.ts       # The Pencil: the kit's grades, the paper's tooth, a mark's picture
    ├── smudge.ts       # The Smear: a blending stump's pass over a pencil mark's picture
    ├── sketch-svg.ts   # A sketch as SVG, with no DOM: the app's SVG export
    ├── sketch-composition.ts  # A sketch lowered into the composition model, for PNG
    ├── link.ts         # Linked files: their names, placeholders, and the paths a host follows
    ├── effects.ts      # Effects: the CSS filter functions, as data every output can draw
    ├── transform.ts    # The Transform tool's arithmetic: one box, eight handles, two modifiers
    ├── mesh-warp.ts    # Mesh Warp: bending art by pins, as Illustrator's Puppet Warp does
    ├── liquify.ts      # Liquify: Warp, Twirl, Pucker and Bloat, fields that bend marks under a brush
    ├── stroke-profile.ts # Stroke profiles: how a stroke's width runs along its length
    ├── blend.ts        # Napkin Blends: the sixteen blend modes, their names, and the W3C math
    ├── appearance.ts   # A mark's appearance: its parts, and its effects laid out over them
    ├── appearance-fx.ts # Effects on pixels: the passes the canvas and the PNG run over a picture
    ├── geometry-effects.ts # What a mark draws once a Warp, a Splatter or a 3D has worked on it
    ├── splatter.ts     # Splatter: a region's fill as one loose hatch, as Scribble draws it
    ├── warp-styles.ts  # Warp's twelve styles: closed-form maps of the plane over a box
    ├── random.ts       # Seeded randomness: the same hatch and grain every time
    ├── arc-length.ts   # A path walked by distance: where a length lands, which way it runs
    ├── composition-style.ts # Composition Styles: rules by layer name that restyle a page or a composition
    ├── three-d/        # Classic 3D: Extrude and Revolve, drawn as shaded vector faces
    │   ├── mesh.ts          # An outline built in depth: its faces, caps and a revolve's steps
    │   └── render.ts        # The mesh lit and drawn as flat faces, far ones first
    ├── type/           # Type: the model and the layout, and what reads and draws them
    │   ├── model.ts         # A text's runs, paragraphs and configuration copies, and its edits
    │   ├── layout.ts        # Where every character goes: point, area and path type, either way up
    │   ├── measure.ts       # How text is measured: the built-in face's widths, or a font's own
    │   ├── caret.ts         # The caret and the selection, and where each key takes them
    │   ├── panel.ts         # The Type panel's model: what each field shows and each control does
    │   ├── tool.ts          # What the Text tool makes of a gesture
    │   ├── options.ts       # The Type menu's options forms, as data
    │   ├── configs.ts       # Text Configurations: named character attributes a run follows
    │   ├── markdown-flow.ts # Markdown Flow: a text typed as Markdown, shown as it renders
    │   ├── accents.ts       # Clean Language Accents: code colored as its language reads it
    │   ├── accent-languages.json # highlight.js's languages, written by npm run accent-languages
    │   ├── hyphenate.ts     # Hyphenation by Liang's algorithm over the en-US patterns
    │   ├── hyphenation/     # The patterns, en-us.json, with their notice
    │   ├── sfnt.ts          # A font file's glyph outlines, read with no DOM
    │   ├── outline.ts       # Text as shapes: its glyphs drawn from its fonts' own outlines
    │   └── svg.ts           # A text as SVG, set as the layout sets it
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
    │   ├── raster.ts   #   Software rasterizer (clipping, effects, media, text)
    │   ├── coverage.ts #   Scanline coverage of closed contours, which the Pencil fills with too
    │   ├── png.ts      #   PNG encoder and decoder
    │   ├── deflate.ts  #   DEFLATE/zlib codec the PNG pair runs on
    │   ├── font.ts     #   Built-in stroke font + the layout both back ends share
    │   ├── geometry.ts #   Transforms, flattening, path data, dashing, stroking
    │   ├── color.ts    #   CSS color parsing for the rasterizer
    │   ├── gradient.ts #   Gradient paint: where it runs, and its color along the way
    │   ├── canvas.ts   #   Canvas 2D painter (the GUI-canvas target)
    │   ├── effects.ts  #   Effects on pixels: the rasterizer's passes over an element's picture
    │   ├── appearance.ts #  An element's effects as its renderers draw them, fill and stroke apart
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
└── <category>/         # language, drawing, compose, output, cli, node, markdown, engines, interop, ai
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

`dist/` makes two npm packages: the API's, `@isocialpractice/napkin-sketch`,
with the command line, and the desktop app's,
`@isocialpractice/napkin-sketch-gui`, which `npm run pack-gui` lays out in
`release/gui/`.

```text
dist/                   # What npm run build writes; npm run build:types adds the .d.ts beside it
├── api/                # The package's main entry, an ES module, and its types: in the API's package
├── node/               # The /node entry: in the API's package
├── markdown/           # The /markdown entry: in the API's package
├── graphic-design/     # The /graphic-design and /graphic-design/files entries: in the API's package
├── sharpen/, engines/  # The /sharpen and /engines entries: in the API's package
├── parts.json          # Every entry as a part: its files, its platform, its notices; what vendor and prune read
├── cli/                # The napkin-sketch command, an ES module: in the API's package
├── chunks/             # The code the entries and the command share, written once: in the API's package
├── core/, sharpen/     # Declarations the entries' types import: in the API's package
├── assets/             # Cursors and the icon, which styles.css reaches: in both packages
├── renderer/           # The app's window: styles.css and the declarations in the API's package, the rest in the app's
└── main/               # The Electron main process and its preload: in the app's package only
```

```text
release/                # What the packaging scripts write; ignored by git
├── gui/                # npm run pack-gui: the app's package, with dist/main/package.json naming the app
└── win-unpacked/, *.exe   # npm run dist and its kin: the installers, and the unpacked app beside them
```
