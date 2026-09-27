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
          // Optional: Bézier anchors for Vector Path editable strokes.
          "vector": {
            "anchors": [
              { "p": { "x": 12, "y": 34 }, "hOut": { "x": 20, "y": 30 } },
              { "p": { "x": 60, "y": 80 }, "hIn": { "x": 52, "y": 70 } }
            ]
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
version 3.

**Migrating from version 1**: older `.skbk` files load unchanged — each page
gains a single default layer and every stroke is assigned to it. Files from
version 2 on also allow `"tool": "image"` strokes carrying an `image` data URL plus
`imageWidth` / `imageHeight` for placed raster imports, and `"tool": "copic"`
strokes carrying a `nibAngle` (degrees) for the rotatable broad nib. A pen or
marker stroke may carry a `"profile"` of `"rounded"`, `"tapered"` or
`"wave"`; an absent profile is Default, and a value napkin does not know is
dropped on load rather than failing it. `"profileMirrored": true` beside a
profile swaps its two sides, which is how a mirrored Wave is saved.

**Optional fields.** Everything the example leaves out is optional, and a
build that does not know a field draws the mark without it. As
`src/core/types.ts` defines them:

| Field | On | Holds |
| --- | --- | --- |
| `sizeMode` | a page | `"endless"`, filling the window (the default), or `"sized"`, the exact `width` and `height` |
| `group`, `parent` | a layer | a group row; the id of the group a layer sits in |
| `effects` | a layer or a mark | blurs, shadows and color shifts drawn over its finished picture |
| `opacity` | a mark | 0 to 1; absent, the tool's own (1 for pen and text, 0.38 for marker) |
| `fill`, `gradient` | a closed mark | a flat fill color, or a linear or radial gradient in its place |
| `strokeStyle` | a mark | `"solid"`, `"dashed"` or `"dotted"` |
| `noStroke` | a shape | `true` for a fill-only shape; `color` and `width` are kept for the outline to come back |
| `text`, `fontSize`, `fontFamily`, `textBoxWidth` | a text item | its text, size and face, and the width it wraps at (absent or 0: it grows to fit) |
| `image`, `imageWidth`, `imageHeight` | an image item | a data URL, and the size it is placed at |
| `link` | an image item | `{ "href", "kind" }`: a linked file, drawn from where it is |
| `vector.closed` | a vector path | `true` for a closed path |
| `sharpened` | a mark | `true` once auto-sharpen has run on it |
