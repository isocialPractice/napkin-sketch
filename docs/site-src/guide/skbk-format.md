# The `.skbk` file format

A sketch book is a human-readable JSON document:

```jsonc
{
  "format": "napkin-sketch",
  "version": 4,
  "name": "notes",
  "sketches": [
    {
      "id": "sk_…",
      "name": "unnamed",
      "width": 1280,
      "height": 800,
      "background": "#fcfaf5",
      "layers": [
        { "id": "ly_…", "name": "Layer 1", "opacity": 1, "visible": true, "locked": false }
      ],
      "strokes": [
        {
          "id": "st_…",
          "tool": "pen",
          "color": "#1f2328",
          "width": 3,
          "layer": "ly_…",
          "sharpened": true,
          "points": [{ "x": 12, "y": 34, "pressure": 0.6 }],
          // Optional: Bézier anchors - a Vector Path's, or a freehand
          // stroke's fitted curves ("fitted": true, each anchor with the pen's
          // "pressure" there). "points" are sampled from them.
          "vector": {
            "anchors": [
              { "p": { "x": 12, "y": 34 }, "hOut": { "x": 20, "y": 30 }, "pressure": 0.6 },
              { "p": { "x": 60, "y": 80 }, "hIn": { "x": 52, "y": 70 }, "pressure": 0.4 }
            ],
            "fitted": true
          }
        }
      ],
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "createdAt": "…",
  "updatedAt": "…"
}
```

Files are saved atomically (write-then-rename) so an interrupted save cannot
corrupt an existing book.

**Version 4** is what napkin-sketch writes (`SKETCHBOOK_VERSION` in
`src/core/types.ts`): a text item may carry a `"typeset"`, its runs,
paragraphs, frame or path, and the book its `"textConfigs"`, described
below. Version 3 brought a layer's
`"group": true`, a group row, and `"parent"`, the id of the group it sits
in, and a stroke's `"fill"` color. Files of versions 1 to 3 open unchanged,
and saving writes them as version 4. A file whose version is above this
build's - one a newer napkin-sketch saved - still opens, with a report that
some parts of it may not show; saving it here writes only what this build
knows of it. Since 1.0.0-alpha.4.6.0 a `vector` may say `"fitted": true` and
its anchors may carry a `"pressure"`; both are optional, and a build from
before drops them, keeping a correct stroke of points. A mark may be
`"tool": "pencil"`, a Pencil mark with its `"pencil"`; a build from before
reads it as a Brush mark in its tone, and a Pencil mark may keep the
Smear's passes over it in `"smudges"`, which a build from before leaves
unsmeared. A group may name its
clipping path in `"clip"`: a build from before draws the group unclipped and
the clipping path as an ordinary mark, and a `clip` that names no closed
mark inside the group is dropped on load. Since 1.0.0-alpha.5.0.0 a layer may
carry a `"blend"` and a group an `"isolate"`; a build from before draws the
layer at Normal.

**Migrating from version 1**: older `.skbk` files load unchanged — each page
gains a single default layer and every stroke is assigned to it. Files from
version 2 on also allow `"tool": "image"` strokes carrying an `image` data URL plus
`imageWidth` / `imageHeight` for placed raster imports, and `"tool": "copic"`
strokes carrying a `nibAngle` (degrees) for the rotatable broad nib. A pen or
marker stroke may carry a `"profile"` of `"rounded"`, `"tapered"` or
`"wave"`; an absent profile is Default, and a value napkin does not know is
dropped on load rather than failing it. `"profileMirrored": true` beside a
profile swaps its two sides, which is how a mirrored Wave is saved.

**`"pen"` is the Brush.** The app calls the tool the Brush; the file keeps
the value it has always written, `"tool": "pen"`, and a mark saved as
`"brush"` loads as a `"pen"` mark.

**Optional fields.** Everything the example leaves out is optional, and a
build that does not know a field draws the mark without it. As
`src/core/types.ts` defines them:

| Field | On | Holds |
| --- | --- | --- |
| `sizeMode` | a page | `"endless"`, filling the window (the default), or `"sized"`, the exact `width` and `height` |
| `group`, `parent` | a layer | a group row; the id of the group a layer sits in |
| `pencil` | a Pencil mark | `{ "medium", "grade" }`, the pencil it was drawn with: `graphite` `9H` to `9B`, `charcoal` `HB` to `6B`, `vine` `Hard`, `Medium` or `Soft`, `compressed` `2B` to `6B`; its tone is the mark's `color`, and a pencil there is not reads as graphite HB |
| `smudges` | a Pencil mark | the Smear's passes, in order: each `{ "path", "width", "strength" }`, the drag's fitted anchors in page units (with each one's `pressure`), the stump's width and its strength from 0 to 1; a pass with fewer than two anchors is dropped on load |
| `clip` | a group | the id of a closed mark inside it, its clipping path: the group shows only inside it, and it paints nothing while it clips |
| `effects` | a layer or a mark | the effects drawn over its finished picture, in order: blurs, shadows and color shifts, and Feather, Bevel, Emboss, Inner Shadow, Outer Glow and Inner Glow; and `splatter`, which draws a mark's fill, or its stroke, as a hatch before any of them, with `angle`, `overlap`, `overlapVariation`, `width`, `curviness`, `curvinessVariation`, `spacing`, `spacingVariation` and `seed`; and `warp`, which bends a mark, or all a layer or a group holds, before any of them, with `style` (`arc`, `arch`, `unroll`, `shell`, `windy`, `breezy`, `curvy`, `chart`, `puffy`, `expand`, `cram` or `twirl`), `orientation` (`horizontal` or `vertical`), `bend`, `distortH` and `distortV` (percents, -100 to 100) and `part` (`whole`, `lower` or `upper`); and `3d`, which builds a mark in depth and draws it as shaded faces, with `kind` (`extrude` or `revolve`), `depth`, `caps`, `angle`, `offset`, `axis` (`left` or `right`), `segments`, `rotation`, `position` and `scale` (each three numbers, X, Y and Z), `perspective`, `shading` (`plastic`, `diffuse`, `none` or `wireframe`) and `light` (`azimuth`, `elevation`, `intensity` and `ambient`). Each may carry a `target` of `"fill"` or `"stroke"`, to work on that part of a mark alone, and `"on": false`, to be kept without being drawn; a field an appearance effect leaves out is its default. A build from before leaves out an effect it does not know, and draws one aimed at a part, or switched off, on the whole mark |
| `blend` | a layer | how it mixes with what is under it: a Napkin Blend's name, `"stack"` to `"cover"`; absent is Normal, and a vector editor's name, such as `"multiply"`, reads as its napkin one |
| `isolate` | a group | `true` for Isolate Blending: the blends inside it mix only with each other |
| `opacity` | a mark | 0 to 1; absent, the tool's own (1 for pen - the Brush - and text, 0.38 for marker) |
| `fill`, `gradient` | a closed mark | a flat fill color, or a linear or radial gradient in its place |
| `strokeStyle` | a mark | `"solid"`, `"dashed"` or `"dotted"` |
| `noStroke` | a shape | `true` for a fill-only shape; `color` and `width` are kept for the outline to come back |
| `text`, `fontSize`, `fontFamily`, `textBoxWidth` | a text item | its text, and its base: the size, family and color of every character no run says otherwise of, always those of its first character. `textBoxWidth` is the width a box from before wraps at (absent or 0: it grows to fit), and is written for a rectangle frame that grows, so a build from before wraps it too |
| `textConfigs` | the book | its Text Configurations, a vector editor's Character Styles, in the order the Type panel lists them: each `{ "id", "name", "attrs" }`, the character attributes it sets - those a run may have but `kern`. Names are one each, in any case: a later repeat is dropped on load. One no text follows is kept |
| `typeset` | a text item | everything a text is beyond its base: its `kind` - `"point"` (Sideless Typing), `"area"` (Sheet Typing in its `frame`) or `"path"` (Path Typing along its `path`) - and its `orientation` (`"vertical"` for columns); its `runs`, sorted and apart, each `{ "start", "end", "attrs" }`, a stretch of the text and the character attributes it has that the base does not (`fontStyle`, `fontSize`, `leading`, `kerning`, `kern`, `tracking`, `wordSpacing`, `caps`, `position`, `hScale`, `vScale`, `baselineShift`, `rotation`, `underline`, `strike`, `color`, `highlight`) - a run that follows a Text Configuration names its id in `config`, and has as its own only what it has beyond the base and the configuration, its overrides; its `configs`, a copy of the book's definition of each configuration its runs follow, so the text looks the same apart from the book, which the book's list overrides on load, a configuration only a text carries joining the list; and its `paras`, one entry a paragraph, each the paragraph attributes it has (`align`, `leftIndent`, `rightIndent`, `firstIndent`, `spaceBefore`, `spaceAfter`, `hyphenate`, `list`, `shade`) or `null`. A `frame` is `{ "anchors", "autoHeight", "inset", "fill", "stroke", "width" }` and a `path` `{ "anchors", "closed", "start", "end", "flip", "align", "effect" }`, their anchors relative to the text's first point, so moving the text moves them. Every number is held to a vector editor's range on load, and runs past the text are cut. A build from before draws the text in its base style, as point type or in its box |
| `image`, `imageWidth`, `imageHeight` | an image item | a data URL, and the size it is placed at |
| `link` | an image item | `{ "href", "kind" }`: a linked file, drawn from where it is |
| `vector.closed` | a vector path | `true` for a closed path |
| `sharpened` | a mark | `true` once auto-sharpen has run on it |
