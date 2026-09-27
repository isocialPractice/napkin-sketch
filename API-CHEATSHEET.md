# API cheatsheet

[API hub](API.md) · [Quickstart](API-QUICKSTART.md) · **Cheatsheet**

The whole API on one page: every verb, the command line, the two imports, the render options and the exit codes.

## Every verb

<!-- verb-lines:start -->
| Category | Verb | Written | Does |
| --- | --- | --- | --- |
| Document | `napkin` | `napkin <version>` | The language version the script was written for. The first line of a script; without it version 1 is assumed, with a warning. |
| Document | `page` | `page <paper> [portrait\|landscape]`<br>`page <width> <height> [portrait\|landscape]` | The page size: a named size (a3, a4, a5, letter, legal, tabloid, square, slide, napkin) or a width and a height, turned portrait or landscape. |
| Document | `background` | `background <color>`<br>`background none` | The page color, or none for a transparent page. |
| Document | `name` | `name "<name>"` | The page's name, and the file stem it is written under. |
| Document | `units` | `units px\|in\|mm\|pt` | The unit bare numbers are read in from here on: px, in, mm or pt. Pixels until changed. |
| Document | `seed` | `seed <n>` | The seed for the hand-drawn pass. One script and one seed draw the same bytes every run. |
| Document | `newpage` | `newpage ["<name>"]` | Starts another page the same size, carrying the paint state across. |
| Layers | `layer` | `layer "<name>" [opacity <0-1>] [hidden] [locked]` | A drawing layer. Marks after it go on it until the next layer. |
| Layers | `group` | `group "<name>" [opacity <0-1>] [hidden] [locked] { ... }` | A group layer. The layer and group lines in its block become its children. |
| Paint | `tool` | `tool pen\|marker\|copic\|eraser` | The kind of mark: pen, marker (translucent, so overlapping passes build up like ink), copic (a broad, angled nib) or eraser (takes away what is under it, on its own layer only). |
| Paint | `color` | `color <color>` | The ink color of every mark after it. |
| Paint | `width` | `width <length>` | The stroke width of every mark after it. |
| Paint | `opacity` | `opacity <0-1>` | The opacity of every mark after it, from 0 to 1. |
| Paint | `fill` | `fill <color>`<br>`fill none` | The fill color of closed shapes after it, or none. |
| Paint | `gradient` | `gradient linear <angle> (<color> <offset>, ...)`<br>`gradient radial (<color> <offset>, ...)`<br>`gradient none` | A gradient fill for closed shapes after it: linear at an angle, or radial from the centre out, or none. |
| Paint | `stroke` | `stroke on\|off` | Turns the outline on or off. With it off, a closed shape is its fill alone. |
| Paint | `style` | `style solid\|dashed\|dotted` | The outline's dash: solid, dashed or dotted. |
| Paint | `profile` | `profile uniform\|rounded\|tapered\|wave` | How the width runs along a pen or marker stroke: uniform, rounded, tapered or wave. |
| Paint | `nib` | `nib <degrees>` | The angle of the copic nib, in degrees. |
| Paint | `rough` | `rough <0-1> [passes 1\|2] [overshoot <length>]`<br>`rough off` | The hand-drawn pass for every mark after it: 0 is exact, 1 is clearly drawn by hand, and off is 0. Seeded, so it draws the same way every run. |
| Paint | `font` | `font "<family>" [<size>]`<br>`font <size>` | The font family and size of text after it. |
| Shapes | `rect` | `rect <x> <y> <width> <height> [r <radius>]` | A rectangle, with rounded corners when r is given. |
| Shapes | `circle` | `circle <cx> <cy> <r>` | A circle, drawn as four cubic curves rather than a polygon. |
| Shapes | `ellipse` | `ellipse <cx> <cy> <rx> <ry>` | An ellipse, from its centre and two radii. |
| Shapes | `line` | `line <x1> <y1> <x2> <y2>` | A straight line between two points. |
| Shapes | `polygon` | `polygon <x> <y>, <x> <y>, ... [r <radius>]` | A closed shape through a list of points, with rounded corners when r is given. |
| Shapes | `polyline` | `polyline <x> <y>, <x> <y>, ...` | An open line through a list of points. |
| Shapes | `star` | `star <cx> <cy> <outer> <inner> <count>` | A star with the given number of points, between an outer and an inner radius. |
| Shapes | `arc` | `arc <cx> <cy> <r> <from> <to>` | An open arc of a circle between two angles, in degrees clockwise from three o'clock. |
| Shapes | `spiral` | `spiral <cx> <cy> <r> <turns>` | A spiral winding out from its centre to the radius over the given number of turns. |
| Shapes | `shape` | `shape "<name>" at <x> <y> size <width> [<height>]` | A named shape from the built-in library, drawn in a box from x, y. With one size its longer side is that long and it keeps its proportions; with a width and a height it is stretched to fill them. |
| Paths | `path` | `path "<svg path data>"`<br>`path { ... }` | One mark, from SVG path data or from a block of path steps. Each subpath of a compound path is one piece of the same mark. |
| Paths | `move` | `move <x> <y>` | Starts a new subpath at a point. |
| Paths | `to` | `to <x> <y>` | A straight segment to a point. |
| Paths | `by` | `by <dx> <dy>` | A straight segment by an offset from the current point. |
| Paths | `curve` | `curve <c1x> <c1y> <c2x> <c2y> <x> <y>` | A cubic curve to a point, steered by two handles. |
| Paths | `smooth` | `smooth <c2x> <c2y> <x> <y>` | A cubic curve whose first handle mirrors the last one, so the join stays smooth. |
| Paths | `through` | `through <x> <y>, <x> <y>, ...` | A smooth curve through a list of points. Inside a path block it continues the subpath; outside one it is an open mark of its own. |
| Paths | `close` | `close` | Closes the current subpath back to its start. |
| Transforms | `push` | `push` | Saves the transform, the paint state and the units, for the next pop to restore. |
| Transforms | `pop` | `pop` | Restores the transform, the paint state and the units the last push saved. |
| Transforms | `translate` | `translate <dx> <dy>` | Moves everything drawn after it. |
| Transforms | `rotate` | `rotate <degrees> [at <x> <y>]` | Turns everything drawn after it, clockwise in degrees, about the origin or a point given with at. |
| Transforms | `scale` | `scale <s> [<sy>] [at <x> <y>]` | Scales everything drawn after it, about the origin or a point given with at. One factor scales both ways. |
| Transforms | `mirror` | `mirror x\|y [at <position>]` | Reflects everything drawn after it: x swaps left and right across a vertical line, y swaps top and bottom across a horizontal one, at 0 unless given. |
| Control | `let` | `let <name> <value>` | Names a number for the expressions after it, in the current units. |
| Control | `define` | `define "<name>" { ... }` | Records a block of drawing under a name without drawing it, for place to draw. |
| Control | `place` | `place "<name>" [at <x> <y>] [scale <s>] [rotate <degrees>]` | Draws a definition, moved, scaled or turned. |
| Control | `repeat` | `repeat <count> [as <name>] { ... }` | Runs a block a number of times, counting from 0 in the name given with as. |
| Text and media | `text` | `text "<text>" at <x> <y> [size <size>] [box <width>] [align left\|center\|right] [as marks]` | A text item, measured and aligned, and editable in the app. With as marks the letters are drawn as pen strokes instead. |
| Text and media | `image` | `image "<asset or data URL>" at <x> <y> [size <width> [<height>]]` | Places an image: an asset the host supplied, by name, or a data URL. Nothing is read from disk. |
| Text and media | `link` | `link "<path>" at <x> <y> [size <width> [<height>]] [name "<layer name>"]` | Places a linked file: one selectable element that references the file instead of drawing its contents into the page. |
| Text and media | `use` | `use "<document>" [at <x> <y>] [scale <s>] [layer "<name>"]` | Copies in a document the host supplied, as a group, with its layers and anchors. |
| Effects | `effect` | `effect blur <radius>`<br>`effect brightness <amount>`<br>`effect contrast <amount>`<br>`effect saturate <amount>`<br>`effect grayscale [<0-1>]`<br>`effect sepia [<0-1>]`<br>`effect invert [<0-1>]`<br>`effect hue-rotate <degrees>`<br>`effect opacity <0-1>`<br>`effect drop-shadow <dx> <dy> <blur> <color>`<br>`effect none` | An effect for the next layer, group or mark the script makes, as its CSS filter function works: blur, brightness, contrast, saturate, grayscale, sepia, invert, hue-rotate, opacity or drop-shadow. Several stack in order, and none clears what is waiting. |
| Output | `crop` | `crop auto [pad <length>]`<br>`crop none`<br>`crop <x> <y> <width> <height>` | The box every output is cut to: auto fits the ink with room to spare, none keeps the page, or a box given outright. |
| Output | `registration` | `registration <x> <y> <width> <height>` | One box every page is written in, so frames drawn by one script line up when they are played in sequence. |
<!-- verb-lines:end -->

## The command line

<!-- commands:start -->
| Command | Does |
| --- | --- |
| `napkin-sketch draw <script \| ->` | Draw a napkin script to svg, png, pdf, skbk or jsx files. |
| `napkin-sketch check <script \| ->` | Read and run a script, report what is wrong, write nothing. |
| `napkin-sketch render <book.skbk>` | Write a sketch book as svg, png, pdf, skbk or jsx files, or its figure as animation frames. |
| `napkin-sketch verbs` | List napkin script's verbs and the shape library. |
<!-- commands:end -->

- `napkin-sketch draw card.napkin --to svg,png,pdf,skbk --out out --json`
- `napkin-sketch draw - --json < card.napkin`, for a script on standard input
- `napkin-sketch check card.napkin --strict`, to fail on warnings too

## The two imports

| Import | For |
| --- | --- |
| `import { evaluate, drawSvg, renderSketch, renderBook, parseScript, createComposition } from 'napkin-sketch'` | Scripts and compositions, anywhere |
| `import { drawFile, drawToFiles, writeBook, loadAssets, resolveLinkFromDir } from 'napkin-sketch/node'` | Files, in Node |

## Render options

| Option | Default | Meaning |
| --- | --- | --- |
| `format` | `'svg'` | `svg`, `png`, `pdf` or `skbk` |
| `crop` | the whole page | `'auto'`, `{ mode: 'auto', pad: 12 }`, `'none'`, or `{ x, y, width, height }` |
| `registration` | none | One box for every page; wins over `crop` |
| `transparent` | `false` | No paper in the SVG or the PNG |
| `scale` | `1` | PNG pixels a page pixel |
| `resolveLink` | none | Reads linked files for the PNG |
| `decodeImage` | none | Decodes images the PNG cannot |
| `onWarning` | none | Told what a format left out |

## Exit codes

<!-- exit-codes:start -->
| Code | Meaning |
| --- | --- |
| `0` | It drew, the script checked clean, or the book was written. |
| `1` | The arguments were wrong: an unknown option, a bad value, no script. Nothing is written. |
| `2` | The script had errors, render was given a file that is not a book, or --animate found no figure on its page; with --strict, anything reported at all. What could be drawn is written, unless --strict. |
| `3` | A file could not be read or written. A linked file that could not be read is drawn as its placeholder and the files are written; for anything else, nothing is. |
| `4` | draw --prompt got no script back: the AI helper is not installed, is not signed in, or failed. Nothing is written. |
<!-- exit-codes:end -->

## Every category

<!-- categories:start -->
| Category | What it covers | Pages |
| --- | --- | --- |
| [The napkin script language](docs/api/language/README.md) | The syntax, values and expressions, the object form, every verb, and every diagnostic code. | [reference](docs/api/language/README.md), [quickstart](docs/api/language/QUICKSTART.md), [cheatsheet](docs/api/language/CHEATSHEET.md) |
| [Drawing with napkin script](docs/api/drawing/README.md) | What each instruction draws: pages, layers, paint, shapes, paths, the shape library, the hand-drawn pass, text, images, links and effects. | [reference](docs/api/drawing/README.md), [quickstart](docs/api/drawing/QUICKSTART.md), [cheatsheet](docs/api/drawing/CHEATSHEET.md) |
| [The graphic design API](docs/api/compose/README.md) | Compositions built in code - shapes, text, media, masks, gradients, effects - rendered to SVG or PNG. | [reference](docs/api/compose/README.md), [quickstart](docs/api/compose/QUICKSTART.md), [cheatsheet](docs/api/compose/CHEATSHEET.md) |
| [Writing a drawing out](docs/api/output/README.md) | SVG, PNG, PDF, .skbk and an Illustrator script from one call, the box every format is cut to, and what each format keeps. | [reference](docs/api/output/README.md), [quickstart](docs/api/output/QUICKSTART.md), [cheatsheet](docs/api/output/CHEATSHEET.md) |
| [The napkin-sketch command line](docs/api/cli/README.md) | draw, check, render and verbs from a shell or any language, with --json and exit codes. | [reference](docs/api/cli/README.md), [quickstart](docs/api/cli/QUICKSTART.md), [cheatsheet](docs/api/cli/CHEATSHEET.md) |
| [Using napkin-sketch from code](docs/api/node/README.md) | The two entries, ES modules and CommonJS, types, the result object, and what throws. | [reference](docs/api/node/README.md), [quickstart](docs/api/node/QUICKSTART.md), [cheatsheet](docs/api/node/CHEATSHEET.md) |
| [Working with other programs](docs/api/interop/README.md) | Illustrator and Inkscape through SVG, an Illustrator script that rebuilds a drawing, files linked from elsewhere, and what survives a round trip. | [reference](docs/api/interop/README.md), [quickstart](docs/api/interop/QUICKSTART.md), [cheatsheet](docs/api/interop/CHEATSHEET.md) |
| [The AI helpers](docs/api/ai/README.md) | The graphic-designer and scripting helpers: design languages, brand resources, scripts drawn from a request, and how an agent reads these pages. | [reference](docs/api/ai/README.md), [quickstart](docs/api/ai/QUICKSTART.md), [cheatsheet](docs/api/ai/CHEATSHEET.md) |
<!-- categories:end -->
