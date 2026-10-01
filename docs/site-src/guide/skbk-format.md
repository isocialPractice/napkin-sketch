# The `.skbk` file format

A sketch book is a human-readable JSON document:

```jsonc
{
  "format": "napkin-sketch",
  "version": 3,
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

**Version 3** is what napkin-sketch writes (`SKETCHBOOK_VERSION` in
`src/core/types.ts`): a layer may carry `"group": true`, a group row, and
`"parent"`, the id of the group it sits in; a stroke may carry a `"fill"`
color. Version 1 and 2 files open unchanged, and saving writes them as
version 3. Since 1.0.0-alpha.4.6.0 a `vector` may say `"fitted": true` and
its anchors may carry a `"pressure"`; both are optional, and a build from
before drops them, keeping a correct stroke of points. A mark may be
`"tool": "pencil"`, a Pencil mark with its `"pencil"`; a build from before
reads it as a Brush mark in its tone, and a Pencil mark may keep the
Smear's passes over it in `"smudges"`, which a build from before leaves
unsmeared. A group may name its
clipping path in `"clip"`: a build from before draws the group unclipped and
the clipping path as an ordinary mark, and a `clip` that names no closed
mark inside the group is dropped on load.

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
| `effects` | a layer or a mark | blurs, shadows and color shifts drawn over its finished picture |
| `opacity` | a mark | 0 to 1; absent, the tool's own (1 for pen - the Brush - and text, 0.38 for marker) |
| `fill`, `gradient` | a closed mark | a flat fill color, or a linear or radial gradient in its place |
| `strokeStyle` | a mark | `"solid"`, `"dashed"` or `"dotted"` |
| `noStroke` | a shape | `true` for a fill-only shape; `color` and `width` are kept for the outline to come back |
| `text`, `fontSize`, `fontFamily`, `textBoxWidth` | a text item | its text, size and face, and the width it wraps at (absent or 0: it grows to fit) |
| `image`, `imageWidth`, `imageHeight` | an image item | a data URL, and the size it is placed at |
| `link` | an image item | `{ "href", "kind" }`: a linked file, drawn from where it is |
| `vector.closed` | a vector path | `true` for a closed path |
| `sharpened` | a mark | `true` once auto-sharpen has run on it |
