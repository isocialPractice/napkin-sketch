# Graphic Design API

Build a graphic design composition out of simple elements - rectangles,
circles, ellipses, triangles, polygons, lines, paths, text, placed media and
clipping masks - and render it to **SVG** or **PNG**.

The API is headless. It needs no browser, no canvas, no Electron window and no
native image library: a Node script can draw a card, a badge or a diagram and
write both files with nothing installed but this package. It does not touch the
sketch that happens to be open in the app unless it is explicitly handed the
app's own canvas, which is what `useGuiCanvas` is for.

The two renderers read one document. That is the whole design: the SVG and the
PNG of a composition are the same graphic, and the only difference between them
is the media export format.

**Contents**

- [Getting started](#getting-started)
- [The page](#the-page)
- [Elements](#elements)
  - [Shared properties](#shared-properties)
  - [Rectangles](#rectangles)
  - [Circles and ellipses](#circles-and-ellipses)
  - [Triangles](#triangles)
  - [Polygons, polylines and lines](#polygons-polylines-and-lines)
  - [Paths](#paths)
  - [Text](#text)
  - [Media files](#media-files)
  - [Groups](#groups)
- [Clipping masks](#clipping-masks)
- [Transforms](#transforms)
- [Rendering](#rendering)
- [Node file helpers](#node-file-helpers)
- [Drawing into the GUI canvas](#drawing-into-the-gui-canvas)
- [What the two formats share, and where they differ](#what-the-two-formats-share-and-where-they-differ)
- [Limits](#limits)
- [Worked example](#worked-example)

## Getting started

```ts
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });

design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.text({
  x: 180,
  y: 78,
  text: 'Acme Corp',
  align: 'center',
  fontSize: 28,
  fill: '#ffffff',
});
design.circle({ cx: 180, cy: 220, r: 64, fill: '#4cae50' });

const svg = design.toSVG();  // a string
const png = design.toPNG();  // a Uint8Array of PNG file bytes
```

Every method takes one object of properties, appends an element in drawing
order - later elements paint over earlier ones - and returns the element it
created, so it can be kept and referenced later:

```ts
const plate = design.rect({ x: 0, y: 0, width: 360, height: 64, fill: '#ffffff' });
plate.fill = '#fffff0';  // still just an object, right up until it renders
```

Nothing renders until `toSVG`, `toPNG` or `render` is called, and rendering
never mutates the document. Rendering one composition twice, in either format,
produces identical bytes.

## The page

`createComposition(options)` takes:

| Option | Default | Meaning |
| --- | --- | --- |
| `width` | `360` | Page width, in `units` |
| `height` | `360` | Page height, in `units` |
| `units` | `'px'` | `px`, `in`, `mm` or `pt` - the unit every coordinate in the composition is read in |
| `background` | `null` | A CSS color, or `null` for a transparent page |
| `id` | none | Written as the root `<svg id>` |
| `title` | none | Written as `<title>`, which is what a screen reader announces |
| `useGuiCanvas` | `false` | See [Drawing into the GUI canvas](#drawing-into-the-gui-canvas) |

Sizes are explicit and a size left out defaults to 360 by 360 pixels:

```ts
createComposition();                                  // 360 x 360 px
createComposition({ width: 1200, height: 630 });      // a social card
createComposition({ width: 210, height: 297, units: 'mm' });  // A4
```

Print units convert through the CSS reference of 96 pixels to the inch, the
same ratio the SVG and PDF exports assume. An A4 page therefore writes
`width="210mm"` with a `viewBox` in millimetres, and rasterizes to 794 by 1123
pixels at `scale: 1`.

## Elements

### Shared properties

Every element understands these. All are optional.

| Property | Meaning |
| --- | --- |
| `id` | A stable id, written to the SVG and referenced by masks |
| `name` | A label, written as `data-name` - what a design tool's layers panel shows |
| `fill` | Fill paint as a CSS color, or `null` for no fill |
| `fillOpacity` | Fill alpha, 0 to 1 |
| `fillRule` | `nonzero` (default) or `evenodd`, for self-intersecting outlines |
| `stroke` | Stroke paint as a CSS color, or `null` for no stroke |
| `strokeWidth` | Stroke width in composition units (default 1) |
| `strokeOpacity` | Stroke alpha, 0 to 1 |
| `lineCap` | `butt` (default), `round` or `square` |
| `lineJoin` | `miter` (default), `round` or `bevel` |
| `dash` | Dash pattern, e.g. `[6, 3]` |
| `dashOffset` | Offset into the dash pattern |
| `opacity` | Element alpha, multiplied over fill and stroke alike |
| `rotate` | Rotation in degrees, clockwise |
| `scale` | A number, or `{ x, y }` |
| `translate` | `{ x, y }`, applied after rotation and scale |
| `origin` | Pivot for rotation and scale (default: the element's own centre) |
| `clip` | A mask id, or an inline shape |
| `visible` | `false` keeps the element in the model and out of every render |

Colors accept hex in three, four, six and eight digits, `rgb()`, `rgba()`,
`hsl()`, `hsla()`, `transparent`, and the usual color keywords. A color the
parser does not recognise raises where it was written rather than painting
something black three steps later.

### Rectangles

```ts
design.rect({ x: 20, y: 20, width: 120, height: 60, fill: '#326478' });
design.rect({ x: 20, y: 100, width: 120, height: 60, rx: 12, fill: '#4cae50' });
design.rect({ x: 20, y: 180, width: 120, height: 60, rx: 24, ry: 8, fill: '#fdc83a' });
```

`rx` rounds the corners on x and, when `ry` is left out, on y as well.

### Circles and ellipses

```ts
design.circle({ cx: 80, cy: 80, r: 40, fill: '#4cae50' });
design.ellipse({ cx: 200, cy: 80, rx: 60, ry: 30, fill: 'none', stroke: '#326478', strokeWidth: 2 });
```

### Triangles

Two forms. Three explicit points is what a drawing wants; a box and a direction
is what a layout wants.

```ts
design.triangle({ x: 20, y: 20, width: 80, height: 70, variant: 'up', fill: '#dc143c' });
design.triangle({
  points: [
    { x: 140, y: 90 },
    { x: 200, y: 20 },
    { x: 240, y: 90 },
  ],
  fill: '#4b0082',
});
```

`variant` is `up` (the default), `down`, `left` or `right`, naming the corner
the apex points at.

### Polygons, polylines and lines

```ts
design.polygon({ points: [ /* ... */ ], fill: '#b4bec8' });      // closed
design.polyline({ points: [ /* ... */ ], fill: null, stroke: '#000133', strokeWidth: 3 });  // open
design.line({ x1: 16, y1: 100, x2: 344, y2: 100, stroke: '#4cae50', strokeWidth: 2 });
```

A polygon closes itself and fills by default; a polyline does not close and is
usually given `fill: null`.

### Paths

```ts
design.path({
  d: 'M 20 130 C 60 110, 100 170, 140 130',
  fill: null,
  stroke: '#dc143c',
  strokeWidth: 3,
  lineCap: 'round',
});
```

The supported commands are `M L H V C S Q T Z`, upper and lower case.
Elliptical arcs (`A`) are not supported - see [Limits](#limits).

### Text

Text carries character styling and paragraph styling on the same element.

```ts
design.text({
  x: 180,
  y: 60,
  text: 'Quarterly report\nPrepared by Jane Doe',
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: 18,
  fontWeight: 'bold',
  fontStyle: 'normal',
  letterSpacing: 0.5,
  transform: 'uppercase',
  align: 'center',
  lineHeight: 1.4,
  maxWidth: 280,
  baseline: 'top',
  fill: '#414042',
});
```

**Character styling**

| Property | Default | Meaning |
| --- | --- | --- |
| `fontFamily` | a sans stack | A CSS font family list |
| `fontSize` | `16` | Size in composition units |
| `fontWeight` | `normal` | `normal`, `bold`, or a numeric CSS weight |
| `fontStyle` | `normal` | `normal` or `italic` |
| `letterSpacing` | `0` | Extra space between characters |
| `wordSpacing` | `0` | Extra space added to each word gap |
| `decoration` | `none` | `underline` or `line-through` |
| `transform` | `none` | `uppercase`, `lowercase` or `capitalize`, applied before wrapping |

**Paragraph styling**

| Property | Default | Meaning |
| --- | --- | --- |
| `align` | `left` | `left`, `center`, `right` or `justify` |
| `lineHeight` | `1.2` | Baseline advance, as a multiple of the font size |
| `maxWidth` | none | Wrap width; without one, text breaks only on newlines |
| `paragraphSpacing` | `0` | Extra space before each paragraph after the first |
| `indent` | `0` | First-line indent of each paragraph |
| `baseline` | `alphabetic` | What `y` measures: `alphabetic`, `top`, `middle` or `bottom` |

`x` means different things under different alignments: the left edge under
`left`, the centre under `center`, the right edge under `right`. A newline in
`text` starts a new paragraph.

Line breaking and alignment are computed once and used by both renderers, so a
block of text occupies the same lines at the same baselines in the SVG and in
the PNG. Measure it yourself with `measureText` and `layoutText` when a layout
has to know how tall a block came out:

```ts
import { layoutText, measureText } from 'napkin-sketch';

const width = measureText('Acme Corp', { fontSize: 18 });
const block = layoutText(copy, {
  x: 0, y: 0, fontSize: 12, lineHeight: 1.4,
  align: 'left', baseline: 'alphabetic', maxWidth: 200,
});
console.log(block.lines.length, block.height);
```

### Media files

JPEG, PNG, GIF and SVG are placed with `image`, given as a data URL.

```ts
design.image({
  src: logoDataUrl,
  x: 24,
  y: 24,
  width: 120,
  height: 120,
  fit: 'cover',
  clip: 'badge',
  alt: 'Acme Corp logo',
});
```

| Property | Meaning |
| --- | --- |
| `src` | A data URL. In Node, `imageDataUrl(path)` makes one from a file |
| `x`, `y`, `width`, `height` | The box the image is placed in |
| `fit` | `fill` (default, stretch), `contain`, `cover` or `none` |
| `alt` | Alternative text, written as a `<title>` inside the `<image>` |

Position is set by the box, and the shape a placement is cut to is set by
`clip` - either a mask id or an inline shape, exactly as for any other element.

The SVG writer embeds whatever `src` holds, so every format round-trips. The
rasterizer decodes PNG itself; for JPEG, GIF or SVG it needs a decoder, and
without one it skips the placement and says so in `warnings` rather than
failing the whole render:

```ts
const { data, warnings } = design.rasterize({
  decodeImage: (src) => myDecoder(src), // returns { width, height, data } or null
});
```

### Groups

A group applies one transform, one opacity and one clip to several children.

```ts
design.group({ id: 'badge', translate: { x: 40, y: 0 }, opacity: 0.9 }, (badge) => {
  badge.circle({ cx: 40, cy: 40, r: 32, fill: '#326478' });
  badge.text({ x: 40, y: 48, text: 'A', align: 'center', fontSize: 28, fill: '#ffffff' });
});
```

The builder callback gets the same methods the composition has, so a group is
filled with exactly the calls a page is filled with. Passing `children`
directly works too.

## Clipping masks

A mask can be defined once and shared, which is usually why it exists:

```ts
design.defineClip('badge', { type: 'circle', cx: 60, cy: 60, r: 40 });
design.image({ src: photo, x: 20, y: 20, width: 80, height: 80, fit: 'cover', clip: 'badge' });
design.rect({ x: 20, y: 20, width: 80, height: 80, fill: '#4cae50', clip: 'badge' });
```

A one-off mask can be written inline on the element instead, and the renderer
gives it a `<clipPath>` of its own:

```ts
design.rect({
  x: 0, y: 0, width: 120, height: 120,
  fill: '#4cae50',
  clip: { type: 'rect', x: 30, y: 30, width: 60, height: 60 },
});
```

A mask is built from rectangles, circles, ellipses, triangles, polygons and
paths. Several shapes in one mask are unioned; pass `'evenodd'` as the third
argument to `defineClip` to punch them instead.

## Transforms

`rotate`, `scale` and `translate` sit on the element and pivot about `origin`,
which defaults to the element's own centre - so "rotate 15 degrees" turns a
shape in place rather than swinging it around the page corner.

```ts
design.rect({ x: 40, y: 40, width: 120, height: 40, fill: '#fdc83a', rotate: -8 });
design.group({ rotate: 90, origin: { x: 180, y: 180 } }, (g) => { /* ... */ });
```

Group transforms compose with their children's, and stroke widths scale with
the transform they are drawn under.

## Rendering

```ts
design.toSVG();                      // string
design.toSVG({ pretty: false });     // one long line
design.toPNG();                      // Uint8Array of PNG bytes
design.toPNG({ scale: 2 });          // twice the pixels, the same graphic
design.rasterize();                  // { width, height, data, warnings }
```

Or parameterise over the format:

```ts
import { renderComposition } from 'napkin-sketch';

for (const format of ['svg', 'png'] as const) {
  const output = renderComposition(design, { format });
  // ...
}
```

| Option | Applies to | Meaning |
| --- | --- | --- |
| `pretty` | SVG | Indent nested elements (default `true`) |
| `precision` | SVG | Decimal places coordinates round to (default 3) |
| `scale` | PNG | Device pixels per composition pixel (default 1) |
| `background` | PNG | A colour painted under the page's own |
| `decodeImage` | PNG | A decoder for image formats other than PNG |

`renderPng(document, options)` returns `{ data, width, height, warnings }` when
the warnings matter.

## Node file helpers

The renderers import nothing from Node, so they run in a browser bundle
untouched. The file helpers are a separate, Node-only module for the same
reason the PDF importer is:

```ts
import { imageDataUrl, writeComposition } from 'napkin-sketch/dist/core/graphic-design/files.js';

const logo = await imageDataUrl('assets/logo.png');
design.image({ src: logo, x: 24, y: 24, width: 64, height: 64 });

const { svg, png, warnings } = await writeComposition(design, './out', 'card');
// ./out/card.svg and ./out/card.png, written from one document in one call
```

## Drawing into the GUI canvas

`useGuiCanvas` is `false` by default: a composition is a document, and a script
that renders one has nothing to do with whatever sketch is open. Inside the
app's renderer, where a high-DPI 2D context already exists, `paintComposition`
draws the composition into it instead:

```ts
import { paintComposition } from 'napkin-sketch/dist/core/graphic-design/canvas.js';

paintComposition(ctx, design.toDocument(), { resolveImage });
```

The context is left exactly as it was found, and text is drawn with the host's
real fonts, positioned by the same layout the other two renderers use.

## What the two formats share, and where they differ

Both renderers read one document, so the page size, the elements, their order,
their geometry, their colors, their transforms, their masks and the text layout
are the same by construction. What each does with that is what a vector file
and a raster file are for:

| | SVG | PNG |
| --- | --- | --- |
| Shapes | Written as themselves - a `<rect>` stays a rect, editable in a design tool | Filled into pixels, anti-aliased |
| Text | Live `<text>`, in the font family the element named | Drawn from a built-in single-stroke alphabet |
| Placed media | Embedded verbatim, every format | PNG decoded here; other formats need a decoder |
| Size | `viewBox` in composition units, width and height in the page's unit | `width x height` pixels at `scale` |
| Determinism | Identical bytes for identical documents | Identical bytes for identical documents |

The text row is the honest one. A PNG has to come out of a font engine, and
there is no font engine in Node and no way to read a licensed face from a
script that has no operating system to ask. So the rasterizer draws a geometric
single-stroke alphabet, while **measuring with the same table the SVG writer
measures with** - which means the line breaks, the alignment and the block's
extent match to the unit in both files, and only the glyph shapes are the
renderer's own. A caller who needs the raster text set in a licensed face
should render the SVG through a browser instead.

## Limits

- **Elliptical arcs in path data.** `A` is not supported. Every rounded corner
  the API draws is generated as Beziers, so nothing in the model needs arcs,
  and a path that carries one raises rather than quietly losing a corner.
- **Raster text uses the built-in alphabet.** As above.
- **JPEG, GIF and SVG placements need a decoder to rasterize.** They embed in
  the SVG with no help at all.
- **Gradients, filters and patterns.** Not modelled. Solid paint, opacity and
  clipping masks are the palette.
- **Interlaced PNG placements.** Not decoded; re-save the asset without
  interlacing.

## Worked example

A 360 by 360 card with a title bar, a rule, a heading plate, a masked photo and
a footer - the shape most of this API's work takes:

```ts
import { createComposition } from 'napkin-sketch';
import { imageDataUrl, writeComposition } from 'napkin-sketch/dist/core/graphic-design/files.js';

const palette = {
  page: '#000133',
  paper: '#ffffff',
  accent: '#4cae50',
  ink: '#414042',
};

const design = createComposition({
  width: 360,
  height: 360,
  background: palette.page,
  id: 'AcmeCard',
  title: 'Acme Corp quarterly summary',
});

design.text({
  x: 24, y: 34,
  text: 'Acme Corp',
  fontSize: 22,
  letterSpacing: 1.2,
  transform: 'uppercase',
  fill: palette.paper,
});

design.line({ x1: 16, y1: 46, x2: 344, y2: 46, stroke: palette.accent, strokeWidth: 2 });

design.rect({ x: 16, y: 56, width: 328, height: 48, fill: palette.paper });
design.text({
  x: 180, y: 74,
  text: 'Quarterly summary\nPrepared by Jane Doe',
  fontSize: 11,
  align: 'center',
  lineHeight: 1.5,
  fill: palette.ink,
});

design.defineClip('portrait', { type: 'circle', cx: 180, cy: 200, r: 64 });
design.image({
  src: await imageDataUrl('assets/portrait.png'),
  x: 116, y: 136, width: 128, height: 128,
  fit: 'cover',
  clip: 'portrait',
  alt: 'Jane Doe',
});

design.group({ id: 'footer' }, (footer) => {
  footer.rect({ x: 0, y: 312, width: 360, height: 48, fill: palette.paper });
  footer.triangle({ x: 24, y: 326, width: 18, height: 18, variant: 'right', fill: palette.accent });
  footer.text({
    x: 52, y: 342,
    text: 'jane.doe@example.com',
    fontSize: 12,
    fill: palette.ink,
  });
});

await writeComposition(design, './out', 'acme-card');
```

The result is `out/acme-card.svg` and `out/acme-card.png`: one graphic, two
media export formats, off one document in one call.
