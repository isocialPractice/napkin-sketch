# Working with other programs: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for trading drawings with other editors: what the SVG carries, how an import names things, what the Illustrator script builds, what survives, and links.

## What napkin's SVG carries

| Attribute | On | Carries |
| --- | --- | --- |
| `data-name` | a layer's `<g>`, a link | The name as typed |
| `inkscape:label`, `inkscape:groupmode="layer"` | a layer's `<g>` | The name, for Inkscape's Layers panel |
| `id` | a layer's `<g>` | The name for Illustrator: `_xHH_` escapes, `-2` for a repeat |
| `data-generator="napkin-sketch"` | `<svg>` | Who wrote the file |
| `data-tool`, `data-i` | every mark | The tool, and the paint order |
| `data-d`, `data-width`, `data-profile` | a profiled mark | Its centreline, width and profile |
| `data-nib`, `data-pts` | a Copic mark | Its nib and points |
| `data-gradient`, `data-fill` | a filled mark | napkin's gradient and fill |
| `data-dash` | a dashed mark | `dashed` or `dotted` |
| `data-text`, `data-box` | a wrapped text | Its words and its box's width |
| `href`, `data-link="true"` | a linked `<image>` | The file's path |
| `filter`, `data-effects` | a mark, a layer's `<g>` | Its effects, as a filter and as the list |

## How an import names a row

| Source | Row |
| --- | --- |
| `data-name="Board"` | `Board` |
| `inkscape:label="Board"` | `Board` |
| `id="Sun_x20__x26__x20_Moon"` | `Sun & Moon` |
| `id="outline-5"` | `outline` |
| `id="path4521"` | `path`: an id an editor made up names nothing |
| An unnamed `<rect>` | `rect` |
| An unnamed `<g>` | `<Group>` |
| A file with no groups | One group named `unnamedRootName`, the file's name in the app |
| A first `<rect>` over the whole canvas | The page's background, not a row |

## What the Illustrator script builds

| napkin-sketch | Illustrator |
| --- | --- |
| A page | A document, its artboard the page or the box, a pixel a point |
| The paper | A locked `Background` layer |
| A top-level layer | A `Layer`, hidden or locked as it is |
| A layer in a group | A named `GroupItem` |
| A mark | A `PathItem` on its anchors, `SMOOTH` where the handles are in line |
| Several contours | A `CompoundPathItem` |
| Text | Point text, or area text for a box |
| An image | An embedded `RasterItem` |
| A link | A `PlacedItem` linked to the file, found from the script's folder |
| An effect | Left off, with a warning |
| An eraser | A stroke in the paper's color, with a warning |

## What survives

| What | Out of napkin and back | Into Illustrator or Inkscape | Into Illustrator by its script |
| --- | --- | --- | --- |
| Layer names, tree and opacity | Yes | Yes | Yes |
| Hidden layers, locks | No | No | Yes |
| Curves | Anchor for anchor | The same Beziers | Anchor for anchor |
| Profiles, Copic nibs | Yes | As filled outlines | As filled outlines |
| Gradients, dashes | Yes | Yes | Yes |
| Text | With its box | As text, in the reader's font | As text frames |
| Images | Embedded | Embedded | Embedded |
| Links | As links | As linked images | As placed items linked to the file |
| Effects | Yes | As SVG filters | No |

## Link, import or embed

| | Link | Import | Embed |
| --- | --- | --- | --- |
| Holds | The path | The contents, as layers | The bytes |
| Rows | One | One a group and named object | One |
| The file changes | The next output shows it | Nothing changes | Nothing changes |
| Made with | `link`, `{ link: true }` | File > Import, a paste, `importSvg` | `image` with an asset |

## One line each

| Want | Write |
| --- | --- |
| An SVG for another editor | `napkin-sketch draw card.napkin --to svg` |
| A drawing rebuilt in Illustrator | `napkin-sketch draw card.napkin --to jsx`, then File > Scripts > Other Script |
| The same, in code | `renderSketch(page, { format: 'jsx' })` or `sketchesToJsx(pages)` |
| An Illustrator script that reports with no alert | Set `var QUIET = true;` at its top, and read its result |
| Another editor's SVG in the app | `napkin-sketch --import art.svg` |
| A linked file in a script | `link "assets/logo.svg" at 20 20 size 160 80 name "Logo"` |
| A linked file in a composition | `design.image({ src: 'assets/logo.svg', link: true, x: 20, y: 20, width: 160, height: 80 })` |
| Links read from another folder | `napkin-sketch draw card.napkin --base brand` |
| An SVG parsed into layers, in a browser | `importSvg(svgText, { unnamedRootName: 'logo' })` |

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| Reading a layer's name from `id` | Read `data-name` | The id is escaped and made unique. |
| `image "assets/logo.svg"` to keep a file linked | `link "assets/logo.svg" ...` | `image` embeds a named asset; a path is `unknown-asset`. |
| Expecting a hidden layer in the SVG | Show it before exporting | Hidden layers are not written. |
| `importSvg` in plain Node | Run it in a browser or the app | It measures the document with the DOM. |
| Linking an SVG for the Illustrator script | Link a PNG or a PDF | Illustrator's scripting does not place an SVG by link, so it arrives as its placeholder. |
| Moving a `.jsx` away from the files it links | Move them together, or write it where it runs | It finds a link by its path from the script's own folder. |
