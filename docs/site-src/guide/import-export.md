# Import and export

## Import

- **Import** (`Ctrl + I`) of **SVG** (vector shapes become editable strokes,
  **groups become nested, collapsible layer groups, and every named object
  becomes its own layer**, so an Illustrator or Inkscape file lands with the
  same layer tree it left with — napkin-sketch's own exports round-trip
  losslessly), **PDF** (each page's vector content becomes a new sketch page,
  best effort), and **PNG / JPEG / GIF / WebP** (placed as a movable image
  on the active layer). **What arrives lands folded**: an illustrated figure is a group of
  assemblies, each a group of parts, each a group of outlines, and expanded
  that is sixty-odd rows for one drawing. Whatever was imported is one thing,
  so the panel gains one row for it and the caret opens it; the groups inside
  are folded too, so opening one shows its assemblies rather than its whole
  tree. The same goes for an SVG pasted from another editor, a sheet of
  graphics placed together, and a frame drawn by Animation Mode. A flat import
  with no groups in it has nothing to fold and still fills the panel.

## Imported SVGs keep their layer tree

**Imported SVGs keep their layer tree.** Nested `<g>` elements become nested
layer groups, and every *named* object becomes its own layer in its original
z-order position — Illustrator writes an object's name into `id`, so a
`<path id="outline">` sitting between two groups imports as an `outline` layer
between them rather than being flattened onto the parent. Names shed the `-2`,
`-3`, … suffix editors add to keep XML ids unique, so rows read `strokes` and
`outline`, not `strokes-10` and `outline-5`. *Unnamed* geometry inside a group
gets a layer of its own too, named after its tag (`path`, `line`, `rect`, …),
so every element in the source file has a row in the panel — only
napkin-sketch's own exported marks merge back onto their layer, keeping
napkin's exports round-tripping as clean single layers rather than one row
per stroke. Every top-level group imports as a layer group — a named one
(such as `<g id="circles">` around the whole drawing) under its name, an
anonymous one as `<Group>` — so no wrapper is ever flattened away. A document
with no groups at all arrives as one top group named after the imported file,
holding a tag-named layer per element.

## Imported SVGs keep their curves

**Imported SVGs keep their curves.** Path data is read command by command
(`M L H V C S Q T A Z`, absolute or relative) into the same Bézier anchors the
Vector Path tool edits: quadratics are degree-elevated to the identical cubic,
arcs become the standard quarter-turn cubic approximation, and `<circle>`,
`<ellipse>`, `<rect>` (rounded corners included), `<line>`, `<polyline>`, and
`<polygon>` are built from their attributes. A curve that arrived as four
numbers is exported as four numbers, at two-decimal precision, instead of a
polyline through hundreds of samples, so a file imported and exported without
edits keeps its geometry - and a `fill`-only source shape stays fill-only
rather than gaining an outline in its fill color. A compound path (an outlined
stroke with its inner contour, a ring, a letter with a counter) stays one
stroke whose contours are separate subpaths, so its holes fill as holes and
export as `… Z M …`. Path data the parser cannot read is sampled along its
length as before.

## Imported SVGs keep their gradients

**Imported SVGs keep their gradients.** A shape painted with another editor's
`<linearGradient>` or `<radialGradient>` arrives with that gradient's stops,
and a linear one with the direction of its axis. A gradient that borrows its
stops from another through `href` is followed to them. The paint server's own
coordinate system (`gradientUnits`, `gradientTransform`, focal points) is not
carried, so an unusual gradient lands approximately rather than not at all.
A paint that resolves to no gradient still arrives painted: a one-stop
gradient as that stop's color, a reference to a gradient the file never
defines as the fallback color written after it, and with no fallback as the
default ink, so it shows up where it can be fixed. A gradient-painted outline
takes the middle color of its ramp.

## Export

- **Export** to PNG (transparent), JPEG (flattened), **SVG** (lossless vector,
  layers preserved as named groups that Inkscape and Illustrator both read;
  vector-tool strokes write exact cubic Béziers and
  freehand strokes shed sub-pixel-redundant samples, keeping files compact), or
  **PDF** (vector, no extra dependencies) —
  from the File menu or the top toolbar's **Export** button beside Import. Each
  format offers **Export current page** or **Export all pages** — raster and
  SVG save `name_1.ext`, `name_2.ext`, …, while PDF writes all pages into one
  document.
  The dropdown's **Selection** row opens the same four formats one level in and
  exports **only what is selected, on a document cut to its own dimensions** —
  no page-sized margin of empty space around the graphic. PNG and SVG come out
  transparent, since a graphic cropped to its ink is one about to be dropped
  into a composition; JPEG and PDF keep the page background, having no usable
  transparency of their own. With nothing selected but layer rows lit in the
  Layers panel, those layers and their descendants are what gets exported.

## Exported SVGs are written small

**Exported SVGs are written small.** An import followed by an export used to
come back larger than the file that went in; it now comes back smaller, with
the geometry unchanged to the coordinate. Four reductions do it, none of which
moves a curve:

- **Path data takes its shortest exact spelling.** Every command is offered in
  both its absolute and its relative form and the shorter one wins, a repeated
  command letter is dropped (readers carry it over), an axis-aligned line
  collapses onto `H`/`V`, and a cubic whose incoming handle mirrors the
  outgoing handle before it collapses onto `S` — the identical curve in two
  numbers instead of four. Relative deltas are measured from the *rounded*
  current point, so a reader reconstructs the absolute coordinate exactly and
  nothing drifts along a long path.
- **Numbers drop what nobody needs to read.** Two decimals, no trailing zeros,
  no leading zero on a fraction (`.5`, not `0.5`), and no separator where the
  next number already delimits itself.
- **Shared paint is stated once, on the root element.** `fill="none"`, round
  caps and round joins, and whichever `stroke-width` most marks happen to
  share ride on the `<svg>` and inherit; only the odd mark out names its own.
- **Defaults go unwritten.** A fully opaque mark says nothing about `opacity`,
  and a width of 1 is what SVG already assumes.

Measured on the test fixtures and the vector-graphics skill's own assets, a
round trip lands between **0.27x and 1.05x** of the source file, against
**1.14x to 1.49x** before — and all 77 paths across those files parse back to
byte-identical anchors and handles. The importer reads every one of these
spellings, so napkin's own exports still round-trip losslessly.

## Exported SVGs keep their layer names

**Exported SVGs keep their layer names.** Each layer's group carries its name
three ways — `data-name` (napkin's own), `inkscape:label` with
`inkscape:groupmode="layer"` (what Inkscape's layers panel reads), and the
group `id` (what Illustrator reads) — so a sketch exported from napkin opens
with its layer names intact wherever it lands, and re-imports under the same
names. Characters an XML id may not hold are escaped as `_xHH_` and repeated
names take the `-2`, `-3`, … suffix editors expect; the importer undoes both.
