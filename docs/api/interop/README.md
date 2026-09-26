# Working with other programs

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

napkin-sketch trades drawings with Illustrator, Inkscape and other vector
editors through SVG, which all of them read and write, writes an Illustrator
script that rebuilds a drawing in Illustrator's own objects, and places files
made elsewhere by reference with `link`. This page is the reference for what
an export writes for another editor, what an import makes of another editor's
file, what the Illustrator script builds, what survives the trip each way, and
how a linked file differs from an imported or an embedded one.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [Exporting SVG for another editor](#exporting-svg-for-another-editor)
  - [Importing SVG from another editor](#importing-svg-from-another-editor)
  - [What survives a round trip](#what-survives-a-round-trip)
  - [Rebuilding a drawing in Illustrator](#rebuilding-a-drawing-in-illustrator)
  - [Linking files made elsewhere](#linking-files-made-elsewhere)
  - [Link, import or embed](#link-import-or-embed)
  - [PDF](#pdf)
  - [The clipboard](#the-clipboard)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

SVG is the common ground. An SVG napkin-sketch writes opens in Illustrator and
Inkscape with its layer tree and its layer names, its curves as the same Bezier
anchors, and its gradients and dashes as the SVG paint those editors show. An
SVG either of them writes opens in napkin-sketch the same way round: named
groups become named layers, curves stay curves, and gradients keep their stops.
What only napkin-sketch knows about a mark - a pen's width profile, a Copic
nib, the width of a text box - rides along in `data-*` attributes that other
editors ignore, so napkin's own files come back as they left.

For Illustrator there is a second way across. `--to jsx` writes an
ExtendScript file that, run in Illustrator, builds the drawing there out of
Illustrator's own objects - layers, named groups, paths on the drawing's own
anchors, text frames, an embedded image, and a linked file placed by link -
rather than handing Illustrator an SVG to interpret.

A linked file is the other half. `link` places a file by reference: the drawing
holds the file's path, one item on one layer stands for it, and the file is
read only when an output has to draw it. That is what Illustrator calls a
linked file, as opposed to an embedded one, and it is not an import, which
breaks a file's contents into layers of the drawing.

## The mental model

```text
 napkin-sketch --SVG: layer names three ways, data-* for napkin's own marks--> Illustrator, Inkscape
 napkin-sketch <--SVG: named groups become layers, curves stay curves--------- Illustrator, Inkscape
 napkin-sketch --.jsx: layers, named groups, paths on their anchors, links placed--> Illustrator
 napkin-sketch --link "assets/logo.svg"--> <image href="assets/logo.svg" data-link="true">
                                           the file is read only to draw it in a PNG
```

| Direction | Through | What arrives |
| --- | --- | --- |
| napkin-sketch to another editor | an SVG export, or a copy | The visible layer tree under its names; every mark as a path; gradients, dashes, text and images |
| Another editor to napkin-sketch | an SVG import, or a paste | Named groups as layer groups, named objects as layers, curves as Bezier anchors, gradients by their stops |
| napkin-sketch to Illustrator | an Illustrator script, `--to jsx` | Every layer, hidden and locked ones too, as layers and named groups; marks as paths on their anchors; text frames; images embedded and links placed |
| napkin-sketch to napkin-sketch | an SVG export, then an import | Every visible layer and mark as it was, through the `data-*` attributes |
| A file made elsewhere into a drawing | `link` | One item that stands for the file; the SVG keeps the reference |

## Reference

### Exporting SVG for another editor

The app's **File > Export > SVG**, `renderSketch(sketch, { format: 'svg' })`
in code, and `napkin-sketch draw card.napkin --to svg` from a shell all run one
writer, so they write the same file.

- **Layers are groups, named three ways.** Each layer is a `<g>` that carries
  its name as `data-name` (napkin's own), as `inkscape:label` with
  `inkscape:groupmode="layer"` (what Inkscape's Layers panel reads), and as its
  `id` (what Illustrator's Layers panel reads). A group layer is a `<g>` around
  its children's groups, so the tree nests as it does in the app.
- **An id is escaped and kept unique.** A character an XML id may not hold is
  written `_xHH_`, its code in hex, the way Illustrator writes one, so
  `Sun & Moon` becomes `Sun_x20__x26__x20_Moon`. A name used twice takes `-2`,
  `-3` and on. `data-name` keeps the name as it was typed, and the importer
  undoes both.
- **A layer's opacity is its group's `opacity`**, which SVG multiplies down the
  tree as the app does.
- **Marks are paths of exact cubic Beziers**, at two decimals and in the
  shortest spelling of their path data. A pen or marker stroke with a width
  profile, and a Copic stroke, is written as the filled outline it draws, since
  an SVG stroke has one width along its length; its centreline, width and nib
  ride along in `data-d`, `data-width`, `data-profile`, `data-nib` and
  `data-pts`.
- **Paint is SVG paint.** A gradient is a `<linearGradient>` or
  `<radialGradient>` in `<defs>`, and a dash is a `stroke-dasharray`; napkin's
  own spelling of each rides along as `data-gradient` and `data-dash`.
- **Text is text.** A text item is a `<text>` with a `<tspan>` a line, in its
  font family and size. A wrapped text box's width and its words ride along as
  `data-box` and `data-text`, since SVG 1.1 has no box to wrap in.
- **An image is embedded and a link is not.** A placed image is written as its
  data URL, and a linked file as its path:
  `<image href="assets/logo.svg" data-link="true" data-name="logo.svg">`.
- **Erasing is a mask** on the erased layer's group, black on white, so it
  cuts that layer and nothing under it, in any viewer.
- **Effects are filters.** A mark's or a layer's effects are a `<filter>` of
  SVG 1.1 primitives - a Gaussian blur, a color matrix, and for a shadow the
  blur, offset, flood, composite and merge - in sRGB, so Inkscape and a
  browser draw them, and the list rides along as `data-effects`.
- **The root says who wrote it**, `data-generator="napkin-sketch"`, and states
  paint most marks share - `fill="none"`, round caps and joins, the most common
  stroke width - once, for the marks to inherit.
- **Left out:** a hidden layer and an empty one. A layer's lock is not written.

### Importing SVG from another editor

In the app, **File > Import** (`Ctrl + I`) or a paste; from a shell,
`napkin-sketch --import art.svg` opens the app with the file imported. In code,
`importSvg` from `napkin-sketch` does the same in a browser, where it measures
the document with the DOM:

```ts
import { importSvg } from 'napkin-sketch';

const imported = importSvg(svgText, { unnamedRootName: 'logo' });
// { width, height, background?, layers: [{ name, opacity, strokes, children? }] }
```

| Option | Default | Meaning |
| --- | --- | --- |
| `unnamedRootName` | `Imported` | The name of the group a document with no groups arrives in. The app passes the file's name. |
| `unnamedElements` | `merge` | `split` gives napkin's own exported marks a layer each, instead of merging them back onto their layer. |

- **Names.** An element's name is its `data-name`, else its `inkscape:label`,
  else its `id`. An id loses its `_xHH_` escapes and its `-2`, `-3` suffix, so
  rows read `outline`, not `outline-5`, and an id an editor made up, a tag name
  and digits such as `path4521`, names nothing.
- **Groups become layer groups.** Every `<g>` becomes a group row: a named one
  under its name, an anonymous one as `<Group>`. No wrapper is flattened away.
- **Every named object becomes a layer**, in its place in the stacking order,
  so a `<path id="outline">` between two groups is an `outline` layer between
  them. Illustrator writes an object's name into its `id`, so its Layers panel
  comes across row for row.
- **Unnamed geometry gets a layer too**, named after its tag - `path`, `rect`,
  `circle` - so every element of the file has a row. A document with no groups
  at all arrives as one group, named by `unnamedRootName`, holding them.
- **Curves stay curves.** Path data is read command by command, absolute or
  relative, into Bezier anchors: a quadratic becomes the identical cubic, an
  arc becomes quarter-turn cubics, and `<circle>`, `<ellipse>`, `<rect>` with
  its rounded corners, `<line>`, `<polyline>` and `<polygon>` are built from
  their attributes. A compound path stays one mark with its holes.
- **Gradients keep their stops**, and a linear one the direction of its axis;
  a gradient that borrows stops through `href` is followed to them. A paint
  that names no gradient the file defines falls back to the color written
  after it, or to the default ink, so it arrives where it can be seen and fixed.
- **A background is the page's.** A first `<rect>` that covers the whole
  canvas is read as the background color, not as a mark.
- **napkin's own marks come back whole.** A mark with `data-tool` returns with
  its tool, its paint order (`data-i`), and whatever its `data-*` attributes
  carry, and merges back onto its layer instead of taking a row of its own.
  Its effects, and a layer's, come back from `data-effects`.

`importSvg` throws `Not a valid SVG document.` for text that is not SVG, and
`No importable content found in the SVG.` for a file with nothing to draw.

### What survives a round trip

| What | napkin-sketch, out and back in | Into Illustrator or Inkscape | Into Illustrator by its script |
| --- | --- | --- | --- |
| Layer names | Yes, from `data-name` | Yes, from `id` and `inkscape:label` | Yes |
| Layer tree | Yes | Yes, as nested groups or sublayers | Yes, as layers and named groups |
| Layer opacity | Yes | Yes | Yes |
| Hidden layers | No: they are not written | No | Yes, hidden |
| Layer lock | No | No | Yes |
| Curves | Yes, anchor for anchor at two decimals | Yes, as the same Beziers | Yes, anchor for anchor, smooth points marked smooth |
| Width profiles and Copic nibs | Yes, from `data-d`, `data-profile`, `data-nib` | As the filled outline they draw | As the filled outline they draw |
| Gradients | Yes, from `data-gradient` | Yes, as SVG gradients | Yes, as gradients with the same stops |
| Dashes | Yes, from `data-dash` | Yes, as `stroke-dasharray` | Yes, as `strokeDashes` |
| Text | Yes, with a wrapped box's width | As text, a `<tspan>` a line, in the reader's copy of the font | As text frames, a box as area text |
| Placed images | Yes, embedded | Yes, embedded | Yes, embedded |
| Linked files | Yes, as links | As a linked image, drawn when the editor can reach the file | Yes, as placed items linked to the file |
| Erased areas | Yes, as eraser marks on their layer | As a mask | As strokes in the paper's color |
| Effects | Yes, from `data-effects` | As SVG filters | No: drawn plain |

The SVG writer's reductions - shortest path spellings, shared paint on the
root, defaults left unwritten - change no coordinate: a napkin export read back
gives the same anchors and handles.

### Rebuilding a drawing in Illustrator

`napkin-sketch draw card.napkin --to jsx` - or `--to jsx` on `render`, or
`renderSketch(page, { format: 'jsx' })` and `sketchesToJsx(pages)` in code -
writes an ExtendScript file. Run it in Illustrator with **File > Scripts >
Other Script**, and it builds the drawing out of the objects Illustrator
would have made of it:

| napkin-sketch | Illustrator |
| --- | --- |
| A page | A document of its own, its artboard the page, or the box the page is cut to, named after the page, a page pixel a point |
| The paper | A locked `Background` layer holding one rectangle the artboard's size; none for a transparent page |
| A top-level layer | A `Layer` under its name, with its opacity, hidden or locked when it is |
| A layer inside a group | A named `GroupItem`, nested as the tree nests: what Illustrator itself makes of napkin's SVG |
| A mark | A `PathItem` on the mark's own anchors: `leftDirection` is an anchor's incoming handle and `rightDirection` its outgoing one, and a point is `SMOOTH` when its handles are in line, `CORNER` otherwise. A freehand line is its samples, pruned as the SVG export prunes them |
| A mark of several contours | A `CompoundPathItem`, filled nonzero, so a hole stays a hole |
| A dot | A filled circle its width across |
| A profiled or Copic mark | The outline it fills, as the SVG export writes it |
| Paint | `RGBColor`s, round caps and joins, `strokeDashes`, and `opacity`, with a color's own alpha folded in; a fill and an outline of different alphas are a group of two paths |
| A gradient | A `GradientColor` over a gradient with the same stops, a stop's alpha its opacity, laid on the axis the SVG draws it on |
| Text | Point text from the item's top-left, or area text for a box of fixed width, set in the first family of the item's font list that Illustrator has |
| An image | Embedded: its bytes ride in the script, which writes them to a scratch file, places it, embeds it as a `RasterItem` and deletes the file |
| A link | A `PlacedItem` whose `file` is the linked file: a linked file, in Illustrator's own sense |

- **A link is found from the script's own folder.** The script names each
  linked file by its path from where the script is, so the script and the
  files it links can move together. `writeBook` and `drawToFiles` - and so
  `draw` and `render` from a shell - write that path through the folder the
  links are read in, `base` or `--base`: drawn with `--out build` from a
  script beside `assets/`, the script looks for `../assets/logo.png`.
  `linkFolder` in the render options says it outright.
- **What cannot be made is drawn as a stand-in, and named.** A linked file the
  script cannot find, or that Illustrator will not place - an SVG, which
  Illustrator's scripting does not place by link - is drawn as napkin's
  placeholder, a dashed box crossed from corner to corner with the file's
  name, and so is an embedded image Illustrator will not place. A font list
  with no family Illustrator has is set in Illustrator's default face. The
  script lists all of these when it ends.
- **What the writer cannot make, it says** through `onWarning`: an effect is
  left off, and an eraser is drawn in the paper's color, as the PDF draws one,
  so it covers what lies under it on other layers too. On a transparent page
  an eraser is left out.
- **A run reports.** While it builds, the script works in the document's
  coordinates and keeps Illustrator's dialogs down, and it puts both settings
  back after. It ends quietly when everything was built as asked, and alerts
  the list when something was not, or where it stopped - the page, the layer,
  the mark and the script's line - when something failed. The same message is
  the script's result and goes to `$.writeln`, for a caller that runs it
  with no window. Set `QUIET` at the top of the script to `true` to skip the
  alert.
- **ES3 and ASCII.** The script uses nothing ExtendScript lacks, and every
  character outside printable ASCII is escaped, so a name reads the same
  whatever encoding Illustrator reads the file in.

### Linking files made elsewhere

A linked file is placed, not read. In a napkin script:

```napkin
link "assets/logo.svg" at 20 20 size 160 80 name "Logo"
```

In a composition, an image element with `link: true`, whose `src` is then a
path rather than data:

```ts
design.image({ x: 20, y: 20, width: 160, height: 80, src: 'assets/logo.svg', link: true, name: 'Logo' });
```

| Output | What it draws for a link |
| --- | --- |
| The app's canvas | A placeholder: a dashed box with the file's name |
| SVG | The reference, `<image href="assets/logo.svg" data-link="true">`, which a viewer that can reach the file draws |
| PNG | The file, when the render is given `resolveLink`; the placeholder and a warning when it is not, or the file cannot be read |
| PDF | The placeholder, since writing the file into the PDF would import it |
| Illustrator script | The file, placed by link and found from the script's folder; the placeholder when it is not there or Illustrator will not place it |
| `.skbk` | The reference, with the placeholder beside it |

- **Only the host reads a file.** A script or a composition names a file; the
  program running it passes a resolver, and `resolveLinkFromDir(folder)` from
  `napkin-sketch/node` reads only inside that folder: no absolute path, no `..`
  step, no web address, and no symbolic link that leads out of it. The command
  line builds one from `--base`, which defaults to the script's folder.
- **An import reads a link back as a link.** An `<image>` whose `href` is a
  path rather than a `data:` URL is imported as a linked item, so a file
  another editor saved with a linked image keeps it linked.
- **`napkin-sketch draw` exits with code 3** when a linked file cannot be read,
  and names it. The files are still written, with the placeholder where the
  file would be, so a caller that checks the code knows the PNG is not final.

### Link, import or embed

| | Link | Import | Embed |
| --- | --- | --- | --- |
| What the drawing holds | The file's path | The file's contents, as layers and marks | The file's bytes, as a data URL |
| Rows in the Layers panel | One | One for each group and named object | One |
| Editable in napkin-sketch | Moved and sized, as one item | Mark by mark | Moved and sized, as one item |
| A change to the file | Shows up the next time an output reads it | Does not reach the drawing | Does not reach the drawing |
| Made with | `link`, or `{ link: true }` | File > Import, a paste, `importSvg` | `image` with an asset, File > Import of a PNG or JPEG |

### PDF

- **Export** is vector: every page of a book in one document, marks as paths,
  dashes and wrapped text kept, a gradient printed as the shape's flat fill
  with a warning, and a link as its placeholder with the file's name. See
  [Writing a drawing out](../output/README.md#pdf).
- **Import** is best effort, in the app: each page's vector content becomes a
  new sketch page. Curves arrive as polylines, filled shapes as thin outlines,
  and text as text items at the standard font's size. napkin-sketch's own PDFs
  use exactly what the reader reads, so they come back; a scanned PDF, or one
  compressed in a way the reader does not follow, gives little or nothing.

### The clipboard

A copy in the app also goes to the system clipboard as SVG text, so it pastes
into Illustrator or Inkscape, and a graphic copied in either of those pastes
into the app as layers, through the same importer as File > Import. An in-app
copy wins over its own SVG echo; a newer copy from outside wins over the
in-app one.

## Worked examples

**A layer tree that opens named everywhere.** Two groups, a layer name with a
space and an ampersand in it, and a layer name used twice:

```napkin
napkin 1
page 320 200
name "sign"
group "Front" {
  layer "Board"
  color #1f2328 width 3 fill #ffe08a
  rect 20 20 280 120 r 12
  layer "Sun & Moon"
  fill #ff8a65
  circle 80 80 30
}
group "Back" {
  layer "Board"
  fill #326478
  rect 20 150 280 40 r 8
}
```

`napkin-sketch draw sign.napkin --to svg` writes `sign.svg`, whose groups read:

```text
<g id="Front" data-name="Front" inkscape:label="Front" inkscape:groupmode="layer">
<g id="Board" data-name="Board" inkscape:label="Board" inkscape:groupmode="layer">
<g id="Sun_x20__x26__x20_Moon" data-name="Sun &amp; Moon" inkscape:label="Sun &amp; Moon" inkscape:groupmode="layer">
<g id="Back" data-name="Back" inkscape:label="Back" inkscape:groupmode="layer">
<g id="Board-2" data-name="Board" inkscape:label="Board" inkscape:groupmode="layer">
```

Inkscape's Layers panel reads the labels, and napkin's importer reads
`data-name`, so the file comes back to napkin-sketch with the same five rows:
`Front` holding `Board` and `Sun & Moon`, and `Back` holding `Board`. An
editor that reads only the `id` gets the same names once it undoes the escapes
and the suffix, as napkin's importer does for a file with no `data-name`.

**The sign in Illustrator.** The same script, drawn as an Illustrator script:

```bash
napkin-sketch draw sign.napkin --to jsx
```

`sign.jsx` builds the page one call a layer and a mark, in paint order, each
nested layer inside its group. The circle's four points are smooth, each with
its two handles:

```text
    page("sign", 0, 0, 320, 200);
    paper([252, 250, 245], 100);
    open("Front", 100);
      open("Board", 100);
        path([[[32, 20, 25.37, 20, 32, 20, 0], ... ]], true, {stroke: [31, 35, 40], width: 3, fill: [255, 224, 138]});
      close(true, false);
      open("Sun & Moon", 100);
        path([[[110, 80, 110, 63.43, 110, 96.57, 1], [80, 110, 96.57, 110, 63.43, 110, 1], [50, 80, 50, 96.57, 50, 63.43, 1], [80, 50, 63.43, 50, 96.57, 50, 1]]], true, {stroke: [31, 35, 40], width: 3, fill: [255, 138, 101]});
      close(true, false);
    close(true, false);
    open("Back", 100);
```

The document it builds has one 320 by 200 point artboard named `sign`, and
its layers, top first as Illustrator's Layers panel lists them, are `Back`
holding a group `Board`, `Front` holding the groups `Sun & Moon` and
`Board`, and the locked `Background`. The names are the names as typed, with
no escapes, since a layer's name in Illustrator is free text.

**A logo linked, not imported.** A letterhead that places `assets/logo.svg` by
reference and draws a rule under it:

```napkin
napkin 1
page 400 240
name "letterhead"
background #ffffff
link "assets/logo.svg" at 20 20 size 160 80 name "Logo"
layer "Rule"
color #326478 width 2
line 20 120 380 120
```

```bash
napkin-sketch draw letterhead.napkin --to svg,png
```

The SVG holds the reference and nothing of the logo:

```text
<image x="20" y="20" width="160" height="80" preserveAspectRatio="none" href="assets/logo.svg" data-link="true" data-name="logo.svg" data-tool="image" data-i="0"/>
```

The PNG has the logo drawn in it, read from `assets/logo.svg` beside the
script, because the command line hands the render a resolver for the script's
folder. Edit the logo and draw again, and both files carry the new one. Move
the logo away, and `draw` still writes both, with the placeholder in the PNG,
warns that `assets/logo.svg` could not be read, and exits with code 3.

## Limits

- **Importing SVG needs a DOM.** `importSvg` measures the document in a
  browser, so it runs in the app and in a page, not in plain Node.
- **Another editor's gradient lands approximately.** Its stops and a linear
  axis's direction are read; `gradientUnits`, `gradientTransform` and focal
  points are not.
- **Some SVG is not followed.** A `<use>` is not expanded, and clip paths,
  filters, patterns and masks from other editors are not carried: a shape
  arrives without them. A napkin eraser mask is the one mask that is read, and
  napkin's own `data-effects` the one filter.
- **Hidden layers and locks do not travel by SVG.** A hidden layer is left out
  of the SVG, and no editor's lock is written or read. The Illustrator script
  carries both.
- **Fonts are named, not embedded.** Text is set in the reader's copy of the
  family, so it can set a little wider or narrower than it did here.
- **PDF import is best effort**, flattening curves to polylines, and it runs in
  the app, not from the package.
- **The canvas shows a link as its placeholder.** Drawing the linked file on
  the canvas, and a command that turns a link into an import, are not built.
- **The Illustrator script has been run against a stand-in, not in
  Illustrator.** The tests run each script against an imitation of
  Illustrator's scripting objects that holds it to Illustrator's rules, and
  read back what it built; no run in Illustrator itself is recorded yet. A
  gradient's direction and length go through `GradientColor`'s `origin`,
  `angle` and `length`, which is where Illustrator versions have differed.
- **The Illustrator script leaves effects off, and paints erasers.** Illustrator
  keeps its effects as live effects, which a script cannot set, and a mask a
  script cannot cut, so an effect is left off and an eraser is drawn in the
  paper's color; the writer says so for each.
- **An SVG link is a placeholder in Illustrator.** Illustrator's scripting
  places raster images, PDFs and Illustrator files by link, not an SVG; place
  it with File > Place, or link a PNG or a PDF.
- **Nothing reads an Illustrator document back.** The way back is Illustrator's
  own SVG export. A script that walks an open Illustrator document and writes a
  `.napkin` is filed in TODO as a follow-on.

## For agents

- **Read a layer's name from `data-name`**, not from `id`: the id is escaped
  and made unique, and `data-name` is the name as typed.
- **`data-generator="napkin-sketch"`** on the root marks napkin's own export,
  and `data-tool` marks each of its marks; a file without them came from
  another editor and imports by its names and tags.
- **To keep a file linked, use `link`**, never `image` with a path: `image`
  takes only an asset the host passes in or a data URL, and reports a path as
  `unknown-asset`.
- **Pass `--base <folder>`** when a script's links are relative to somewhere
  other than the script's folder, and branch on exit code 3, which means a
  file could not be read: for a link, the files were written with its
  placeholder in them.
- **Draw with a fixed `seed`** when a file is compared across runs; the SVG of
  one script and one seed is the same bytes every time, and so is the `.jsx`.
- **Hand over a `.jsx` with the files it links**, keeping their places
  relative to it; or write it where it will be run, with `--base` pointing at
  the links, so the path it holds is right from there.
- **Run a `.jsx` without a window by reading its result.** The script's last
  value is its report - `napkin-sketch rebuilt 1 page in Illustrator.`, then
  anything it could not build as asked - and `napkin-sketch stopped at ...`
  when it failed. Set `QUIET` to `true` first so no alert waits for a click.

## See also

- [Drawing with napkin script](../drawing/README.md#linked-graphics): the `link`
  verb.
- [Writing a drawing out](../output/README.md): what each format keeps, and how
  a link resolves in each.
- [The graphic design API](../compose/README.md): image elements and `link`
  in a composition.
- [The napkin-sketch command line](../cli/README.md): `--base`, `--to jsx` and
  the exit codes.
- [`src/core/illustrator.ts`](../../../src/core/illustrator.ts): the
  Illustrator script writer, and the script it runs.
- [`test/imports/linked-logo.svg`](../../../test/imports/linked-logo.svg): an
  SVG with a linked image, as the tests import it.
