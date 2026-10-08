# The graphic design API

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

Build a graphic design composition out of simple elements - rectangles,
circles, ellipses, triangles, polygons, lines, paths, text, placed media and
clipping masks, painted in flat colors or gradients, with effects and blend
modes - and render it to **SVG** or **PNG**.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [Getting started](#getting-started)
  - [The page](#the-page)
  - [Elements](#elements)
  - [Clipping masks](#clipping-masks)
  - [Gradients](#gradients)
  - [Effects](#effects)
  - [Blend modes and isolation](#blend-modes-and-isolation)
  - [Transforms](#transforms)
  - [Composition Styles](#composition-styles)
  - [Rendering](#rendering)
  - [Node file helpers](#node-file-helpers)
  - [Brand resources](#brand-resources)
  - [Drawing into the GUI canvas](#drawing-into-the-gui-canvas)
  - [What the two formats share, and where they differ](#what-the-two-formats-share-and-where-they-differ)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

The API is headless. It needs no browser, no canvas, no Electron window and no
native image library: a Node script can draw a card, a badge or a diagram and
write both files with nothing installed but this package. It does not touch the
sketch that happens to be open in the app unless it is explicitly handed the
app's own canvas, which is what `useGuiCanvas` is for.

The two renderers read one document. That is the whole design: the SVG and the
PNG of a composition are the same graphic, and the only difference between them
is the media export format.

**Working with an AI tool?** The `graphic-designer` helper in
[`ai-helper/graphic-designer/`](../../../ai-helper/graphic-designer/) drives this API:
its `design-language` skill reads an existing graphic into a written
`DESIGN_LANGUAGE.md` and generates a per-asset skill whose scripts compose new
work through the calls below, and its `graphic-design-api` skill carries the
visual judgment to make the result good. Install it with
`npm run ai-helper -- --helper graphic-designer`.

A drawing made in the app or by a napkin script becomes a composition too:
`sketchToComposition` lowers a page into this model, which is how a sketch is
written to PNG with no DOM, and how code adds to a drawing before rendering it.
[Writing a drawing out](../output/README.md#from-a-sketch-to-a-composition)
covers it.

## The mental model

```text
 createComposition(page) --rect, circle, text, image, group, ...--> elements, in drawing order
         |
    toDocument()  -->  one document  --+--> toSVG()  / compositionToSvg      -->  SVG text
                                       +--> toPNG()  / rasterizeComposition  -->  PNG bytes
                                       +--> paintComposition                 -->  the app's canvas
```

Every call adds an element and returns it; nothing is drawn until a renderer
reads the document, and a renderer never changes it. The three renderers read
the same geometry, colors, transforms, masks and text layout, so what differs
between an SVG and a PNG of one composition is only what the two formats are.

## Reference

### Getting started

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

### The page

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

### Elements

#### Shared properties

Every element understands these. All are optional.

| Property | Meaning |
| --- | --- |
| `id` | A stable id, written to the SVG and referenced by masks |
| `name` | A label, written as `data-name` - what a design tool's layers panel shows |
| `fill` | Fill paint as a CSS color, a [gradient](#gradients), or `null` for no fill |
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
| `effects` | [Effects](#effects) over the element's finished picture, in order |
| `blend` | How the element mixes with what is under it: one of the [blend modes](#blend-modes-and-isolation) |
| `visible` | `false` keeps the element in the model and out of every render |

Colors accept hex in three, four, six and eight digits, `rgb()`, `rgba()`,
`hsl()`, `hsla()`, `transparent`, and the usual color keywords. A color the
parser does not recognise stops the PNG render with an error that names it -
`graphic-design: unsupported color "#32647"` - rather than painting something
black; the SVG writes it as given, for a viewer to ignore.

#### Rectangles

```ts
design.rect({ x: 20, y: 20, width: 120, height: 60, fill: '#326478' });
design.rect({ x: 20, y: 100, width: 120, height: 60, rx: 12, fill: '#4cae50' });
design.rect({ x: 20, y: 180, width: 120, height: 60, rx: 24, ry: 8, fill: '#fdc83a' });
```

`rx` rounds the corners on x and, when `ry` is left out, on y as well.

#### Circles and ellipses

```ts
design.circle({ cx: 80, cy: 80, r: 40, fill: '#4cae50' });
design.ellipse({ cx: 200, cy: 80, rx: 60, ry: 30, fill: 'none', stroke: '#326478', strokeWidth: 2 });
```

#### Triangles

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

#### Polygons, polylines and lines

```ts
design.polygon({ points: [ /* ... */ ], fill: '#b4bec8' });      // closed
design.polyline({ points: [ /* ... */ ], fill: null, stroke: '#000133', strokeWidth: 3 });  // open
design.line({ x1: 16, y1: 100, x2: 344, y2: 100, stroke: '#4cae50', strokeWidth: 2 });
```

A polygon closes itself and fills by default; a polyline does not close and is
usually given `fill: null`.

#### Paths

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

#### Text

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

#### Media files

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

##### Linked files

`link: true` makes `src` the path of a file to link instead of data to embed,
the way a design tool places a linked file. The SVG keeps the path as its
`href` and marks it `data-link="true"`, so the file stays a file and the
document picks up every change made to it.

```ts
import { resolveLinkFromDir } from 'napkin-sketch/graphic-design/files';

design.image({ src: 'assets/logo.svg', link: true, x: 24, y: 24, width: 120, height: 60, fit: 'contain' });
const { data, warnings } = design.rasterize({ resolveLink: resolveLinkFromDir('./brand') });
```

The rasterizer follows a link only through `resolveLink`, a function the host
passes that returns the file's bytes and media type, or `null`. An SVG is drawn
from its shapes, fitted to the box and clipped to it, as `inlineSvg` reads
them; a PNG is drawn from its pixels; anything else goes through
`decodeImage`. Without a resolver, or when it returns `null`, the link's
placeholder - a dashed box with the file's name - is drawn, and `warnings`
says so.

#### Groups

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

A group's `opacity` belongs to the group, not to each child: the children are
drawn together and the result is laid down once at that opacity, so where two
of them overlap, neither shows through the other. That is how SVG draws a
group, and the PNG draws it the same way. An element with both a fill and a
stroke is one picture in the same sense, so a translucent outline does not
show its own fill through it.

`erase` lists shapes that clear the group wherever they paint, down to
whatever is under the group: an eraser for one group that leaves the rest of
the page alone.

```ts
design.group({ erase: [{ type: 'circle', cx: 60, cy: 40, r: 14, fill: '#000000' }] }, (card) => {
  card.rect({ x: 20, y: 20, width: 120, height: 40, rx: 8, fill: '#326478' });
});
```

An erase shape clears all the way, whatever color or opacity it is given; it
only has to paint, and its fill and its stroke both clear. Text and images do
not erase. The SVG writes the shapes as a `<mask>` on the group, and the PNG
clears them from the group's own layer before laying it down.

`isolate: true` makes a group one picture before it is laid down, so the
blends of what it holds mix only with each other; see
[Blend modes and isolation](#blend-modes-and-isolation).

### Clipping masks

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

### Gradients

A fill can be a gradient instead of a color: linear, along an angle, or
radial, out from the middle.

```ts
design.rect({
  x: 20, y: 20, width: 320, height: 120, rx: 12,
  fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffe08a' }, { offset: 1, color: '#ff8a65' }] },
});
design.circle({
  cx: 180, cy: 80, r: 40,
  fill: { type: 'radial', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#326478' }] },
});
```

| Field | Meaning |
| --- | --- |
| `type` | `linear` or `radial` |
| `angle` | Linear only: the direction in degrees, clockwise from pointing right, so `0` runs left to right and `90` top to bottom. Default `0` |
| `stops` | `{ offset, color }` pairs, offsets from 0 to 1, in any order |

A gradient is laid across the shape's own box. A linear one runs through the
box's centre along its angle, from edge to edge; a radial one runs from the
centre out to the corners. It is placed before the element's transform, so it
turns and scales with the shape. The SVG writes it as a paint server in user
space, which keeps its angle true on a box that is not square, and the PNG
works out each pixel's color along it, mixing the stops with their alpha
premultiplied, as a browser mixes a gradient. A stop whose color does not
parse is left out. Text takes a gradient's first stop's color.

### Effects

`effects` lays effects over an element's finished picture, in the order listed:
the CSS filter functions - a blur, a shadow, a shift in its color - and the
appearance effects a vector editor reaches for - Feather, Bevel, Emboss, Inner
Shadow, Outer Glow and Inner Glow. On a group they work on the group as one
picture, so two children cast one shadow.

```ts
design.rect({
  x: 40, y: 40, width: 200, height: 120, rx: 12, fill: '#ffe08a',
  effects: [{ type: 'drop-shadow', dx: 4, dy: 4, blur: 8, color: 'rgba(0, 0, 0, 0.4)' }],
});
design.group({ effects: [{ type: 'sepia', amount: 0.8 }, { type: 'blur', radius: 1 }] }, (photo) => {
  photo.image({ src: portrait, x: 260, y: 40, width: 120, height: 120, fit: 'cover' });
});
design.rect({
  x: 40, y: 200, width: 200, height: 120, rx: 12, fill: '#4a7fb5', stroke: '#1f2328', strokeWidth: 4,
  effects: [
    { type: 'bevel', size: 8, target: 'fill' },
    { type: 'outer-glow', color: '#ffcc00', blend: 'normal' },
  ],
});
```

| Effect | Fields | Does |
| --- | --- | --- |
| `blur` | `radius` | A Gaussian blur; `radius` is its standard deviation, as the length in CSS's `blur()` is |
| `brightness`, `contrast`, `saturate` | `amount`, from 0 | 1 leaves the color as it is |
| `grayscale`, `sepia`, `invert` | `amount`, 0 to 1 | How far toward gray, sepia or the inverse; 1 is all the way |
| `hue-rotate` | `angle`, in degrees | Turns every hue around the color wheel |
| `opacity` | `amount`, 0 to 1 | Fades the picture at its place in the list |
| `drop-shadow` | `dx`, `dy`, `blur`, `color`; `spread` (0 to 100), `opacity`, `blend` | Outer Shadow: a shadow of the shape, moved, blurred by CSS's blur radius - twice the deviation - in `color`, its edge firmed by `spread` |
| `feather` | `radius` | Fades the picture from clear at its edge to solid `radius` inside |
| `bevel` | `style` (`inner`, `outer`), `size`, `depth` (%), `direction` (`up`, `down`), `soften`, `angle`, `altitude`, `highlight`, `shadow` | A slope `size` wide, lit from `angle` (degrees counterclockwise from the right) at `altitude`; `highlight` and `shadow` are each a `{ color, blend, opacity }` |
| `emboss` | the bevel's, with `style` `emboss` or `pillow` | The slope straddles the edge, or dips into a groove round it |
| `inner-shadow` | `dx`, `dy`, `blur`, `choke` (0 to 100), `color`, `blend`, `opacity` | A shadow cast inside the shape from its edge |
| `outer-glow` | `blur`, `spread`, `color`, `blend`, `opacity` | A glow around the shape |
| `inner-glow` | `blur`, `choke`, `source` (`edge`, `center`), `color`, `blend`, `opacity` | A glow inside the shape |

A `splatter`, a `warp` and a `3d` effect draw on a sketch's marks (see
[Drawing with napkin script](../drawing/README.md#effects)) and have no
element form: on an element they are left out, and `onWarning` says so.

Any effect may also carry `target: 'fill'` or `'stroke'`, to work on that part
of a shape or a text alone - the element is drawn as its fill and its stroke,
each through its own effects, the stroke over the fill, and the effects on the
whole then work on the two - and `on: false`, to be kept without being drawn.
An appearance effect's missing fields are a vector editor's defaults, which
`EFFECT_DEFAULTS` and `defaultEffect(type)` give: shadows and shades multiply
(`stack`), glows and lights screen (`sheer`), each at 75%. A blend takes any
name of a mode (see [Blend modes and isolation](#blend-modes-and-isolation)).
An Outer Shadow or Outer Glow that blends, at the end of the list, is laid
under its element on its own and mixes with what is under it - only for an
element laid down as it is drawn: solid, with no blend, clip or transform of
its own and nothing to erase.

Lengths are in composition units, and scale and turn with the element's
transform, as its outline does; a bevel's light turns with it too. The SVG
writes a `<filter>` in user space, its region the element's own box grown by
as far as the effects reach, with `color-interpolation-filters="sRGB"` so a
viewer works the colors as the PNG does; elements with the same effects over
the same box share one. Each appearance effect is a graph of primitives every
viewer has - blurs, component transfers, offsets, floods, composites, blends
and diffuse lighting - and a shadow laid under its element is a `<use>` of it
through a filter that draws the shadow alone. The PNG draws the element on a
layer of its own and runs the same graph over it (`runEffects`): against the
SVG as `rsvg-convert` draws it, the CSS effects differ by under one level in
255 on average, held to one and a half, and each appearance effect by under
half a level, held to that. The canvas painter sets `ctx.filter` for a list of
CSS filter functions, and runs the PNG's passes for anything else.

The order is SVG's: the effects first, then a group's erase shapes, then the
clip, then the opacity. An effect the renderer does not know, and a color that
is not a color, are left out and reported in `warnings`.

### Blend modes and isolation

`blend` mixes an element, or a group as one picture, with what is under it,
in one of the sixteen modes of a vector editor's Transparency panel. The
type takes a mode's napkin name - `stack`; the renderers read a document's
mode by any of its names, Illustrator's, CSS's or PDF's - `multiply` - in
any case, so a document written by another program may use them.

```ts
design.rect({ x: 20, y: 20, width: 160, height: 100, fill: '#ffcc00' });
design.circle({ cx: 150, cy: 70, r: 50, fill: '#3399ff', blend: 'stack' });
design.group({ isolate: true, blend: 'sheer' }, (glow) => {
  glow.circle({ cx: 60, cy: 120, r: 30, fill: '#ff6b6b' });
  glow.circle({ cx: 90, cy: 120, r: 30, fill: '#4cae50', blend: 'stack' });
});
```

| napkin | Illustrator | | napkin | Illustrator |
| --- | --- | --- | --- | --- |
| `normal` | Normal | | `fold` | Overlay |
| `soak` | Darken | | `light` | Soft Light |
| `stack` | Multiply | | `heavy` | Hard Light |
| `scorch` | Color Burn | | `messy` | Difference |
| `dry` | Lighten | | `avoidance` | Exclusion |
| `sheer` | Screen | | `tidy` | Hue |
| `bleach` | Color Dodge | | `bright` | Saturation |
| | | | `dye`, `cover` | Color, Luminosity |

- **The SVG** writes `mix-blend-mode` with the CSS name, and `data-blend`
  with napkin's, so a design tool and napkin both read it back; an isolated
  group gets `isolation: isolate`.
- **The PNG** mixes each pixel as the W3C compositing spec does, the
  non-separable modes - Hue, Saturation, Color and Luminosity - included, so
  the two formats agree.
- **`isolate`** belongs to a group: its children's blends then mix only with
  each other, and the group, one picture, blends with what is under it by
  its own `blend`.
- `BLEND_MODES`, `blendModeOf` and `blendPixel` are the table and the
  arithmetic, for a program of its own
  ([the engines](../engines/README.md#blending-blend_modes-blendpixel)).

### Transforms

`rotate`, `scale` and `translate` sit on the element and pivot about `origin`,
which defaults to the element's own centre - so "rotate 15 degrees" turns a
shape in place rather than swinging it around the page corner.

```ts
design.rect({ x: 40, y: 40, width: 120, height: 40, fill: '#fdc83a', rotate: -8 });
design.group({ rotate: 90, origin: { x: 180, y: 180 } }, (g) => { /* ... */ });
```

Group transforms compose with their children's, and stroke widths scale with
the transform they are drawn under.

### Composition Styles

A composition style restyles a composition by its elements' and groups'
`name`s: rules keyed by name, in three kinds, held as JSON so the app, the
command line and code share one file. `applyCompositionStyle` gives a new
composition of the same kind, the one given untouched, and a report of what
did not go as asked.

```json
{
  "napkinCompositionStyle": 1,
  "name": "Midnight",
  "layers": {
    "Background": { "fill": "#000133" },
    "Badge": { "opacity": 0.9, "blend": "screen", "effects": [{ "type": "outer-glow", "blur": 6, "color": "#4cae50" }] }
  },
  "text": { "Title": { "color": "#ffffff", "fontStyle": "Bold", "tracking": 50 } },
  "strokes": { "Outline": { "color": "#4cae50", "width": 2, "strokeStyle": "dashed" } }
}
```

```ts
import { applyCompositionStyle, compositionReportLines, createComposition, validateCompositionStyle } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 200, background: '#ffffff' });
design.rect({ name: 'Background', x: 0, y: 0, width: 360, height: 200, fill: '#f4f1ea' });
design.text({ name: 'Title', x: 24, y: 64, text: 'Acme Corp', fontSize: 32, fill: '#1f2328' });
design.rect({ name: 'Outline', x: 24, y: 96, width: 312, height: 72, fill: null, stroke: '#1f2328', strokeWidth: 2 });

const read = validateCompositionStyle(midnight); // midnight: the JSON above, parsed
if (!read.ok) throw new Error(read.errors.join('\n'));
const { composition, report } = applyCompositionStyle(design, read.style);
compositionReportLines(report); // [] when every rule matched
const svg = composition.toSVG();
```

| Kind | Reaches | Sets |
| --- | --- | --- |
| `layers` | The named element or group; for `fill` and `stroke`, every element under it too | `opacity`, `blend`, `isolate` (a group's), `visible` and `effects` on itself; `fill` and `stroke` on what is under it, unless a `text` or `strokes` rule names the same element |
| `text` | The text elements at or under the name | `fontFamily`, `fontSize`, `fontStyle` (its weight and slant), `leading` (as `lineHeight`), `tracking` (as `letterSpacing`), `underline`, `strike`, `caps` (`all` as `uppercase`), `align`, `firstIndent`, `spaceBefore` and `spaceAfter` (as `paragraphSpacing`), `color`, `effects` and `blend` |
| `strokes` | The shapes at or under the name | `color` (the stroke), `width`, `strokeStyle` (as dashes), `noStroke`, `fill`, `gradient`, `opacity`, `effects` and `blend` |

- **A name matches** trimmed and in any case. Where two rules reach one
  element, the nearer one wins, and what a rule leaves out stays as it was.
  Colors, sizes and lengths are in the composition's units.
- **The report** (`CompositionStyleReport`) lists the rules that matched
  nothing, each with the nearest names (`nameSuggestions`, which counts two
  letters swapped as one slip); text rules where there is no text and stroke
  rules where there are no shapes; and values held to their range.
  `compositionReportTitle` and `compositionReportLines` say it in words.
- **A page restyles the same way.** Given a sketch page and the book's Text
  Configurations, `applyCompositionStyle(page, style, { configs })` matches
  its layers' names, reaches the whole of a page's text - every character and
  paragraph attribute, a Text Configuration by name, Markdown Flow and Clean
  Language Accents - and gives the page anew with the marks and layers it
  changed. `captureCompositionStyle(page, name)` records a page's named
  layers as a style that, applied again, changes nothing. A composition's SVG
  writes each name as `data-name`, so one a script drew restyles the same
  way once the app imports it.
- **The format** is [a JSON Schema](../schema/composition-style.schema.json),
  built from the field table the reader uses (`COMPOSITION_RULE_FIELDS`).
  `validateCompositionStyle` is the full check: `{ ok, style, errors, notes }`,
  each error a sentence, with the nearest word for a misspelt field, blend,
  effect or language.

### Rendering

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
| `resolveLink` | PNG | Reads the file behind a linked image; see [Linked files](#linked-files) |

`renderPng(document, options)` returns `{ data, width, height, warnings }` when
the warnings matter.

A sketch - a page drawn in the app, or one a script drew - becomes a
composition with `sketchToComposition`, which is how a sketch is written to
PNG with no DOM. [Writing a drawing out](../output/README.md) covers it,
with the one call that writes a sketch to every format.

### Node file helpers

The renderers import nothing from Node, so they run in a browser bundle
untouched. The file helpers are a separate, Node-only module for the same
reason the PDF importer is:

```ts
import { imageDataUrl, writeComposition } from 'napkin-sketch/graphic-design/files';

const logo = await imageDataUrl('assets/logo.png');
design.image({ src: logo, x: 24, y: 24, width: 64, height: 64 });

const { svg, png, warnings } = await writeComposition(design, './out', 'card');
// ./out/card.svg and ./out/card.png, written from one document in one call
```

`napkin-sketch/node` exports the same helpers, beside the calls that draw a
napkin script to files, so a Node program has one import for the disk; see
[Using napkin-sketch from code](../node/README.md).

`resolveLinkFromDir(dir)` is the resolver a Node host usually wants for
[linked files](#linked-files). It reads a link relative to `dir` and refuses
anything that would leave it - an absolute path, a drive letter, a UNC share,
a `..` step, a web address, or a symbolic link out of the folder - which then
draws as its placeholder.

### Brand resources

A composition script that draws the same layout for every project needs one
thing the layout cannot supply: which logo, which footer strip, which brand
name. That belongs in a file the project owns rather than in the script, and
this is the surface that reads it.

```ts
import { parseResources, inlineSvg, placeBrand, brandMark, detectBrandSlots } from 'napkin-sketch';
```

#### Reading `resources.md`

```ts
const brand = parseResources(await readFile('references/resources.md', 'utf-8'));
// brand.paths       { logo: 'assets/logo.svg' }
// brand.directories { globalAssets: 'assets/brand/' }
// brand.text        { brandName: 'Acme Corp.', domain: 'example.com' }
```

The format is a markdown list of `- key: value` and nothing more, because the
file is edited by whoever owns the brand rather than whoever owns the build.
Headings, prose and `>` notes are ignored, and so is anything in a fenced
block - an example of the format in the file is not a declaration in it.

A value is a **path** when it carries a folder separator or a media extension,
and **text** otherwise: `example.com` is a domain to print, `assets/logo.svg` is
a file to draw. Keys normalize, so `GLOBAL_ASSETS`, `Global Assets` and
`global-assets` are one key. In a folder key the **file name is the descriptor**:
`descriptorFromFilename('footer.png')` is `footer`, which is the slot it fills.

Resolving paths, reading bytes and following symlinks are the caller's half -
this module takes strings so it stays in the browser-safe bundle. The
graphic-designer helper's `brand-resources.mjs` is the Node half, and a
generated skill carries a copy of it.

#### Placing an asset

```ts
placeBrand(design, { x: 292, y: 13, width: 45, height: 24 }, { kind: 'vector', svg }, { fit: 'contain' });
placeBrand(design, band, { kind: 'raster', dataUrl }, { fit: 'contain' });
```

A raster is placed as an `image`, which both renderers already agree on. A
**vector is inlined**: its shapes are read into the composition rather than
embedded as an image. That is not an optimization, it is the fix for a real
defect - the rasterizer decodes PNG and nothing else, so an SVG logo placed as
an image renders in the SVG export and is a hole in the PNG, silently, with the
reason in `warnings` where nobody looking at the picture would find it.
Inlining also keeps it vector, so it scales without going soft.

`inlineSvg` is that machinery on its own:

```ts
const { viewBox, elements, notes } = inlineSvg(markup);
```

It handles `rect`, `circle`, `ellipse`, `line`, `polygon`, `polyline`, `path`,
`text` and data-URL `image`, painted by presentation attribute, by inline
`style`, or by a class in a `<style>` block - which is what a design tool
writes. Nested `<g>` transforms and opacities are composed and applied. A
gradient is drawn as its first stop's color, and says so in `notes`; `<use>`
references, patterns, filters, masks, clip paths, elliptical arcs and sheared
transforms land in `notes` rather than being approximated.

#### When nothing is configured

```ts
brandMark(design, box, { label: 'Acme Corp', accent: '#4cae50', paper: '#ffffff' });
```

A slot with no asset behind it is filled with a mark in the design language - a
monogram, a disc, or a set wordmark - rather than left as a hole. It is
obviously a placeholder to anyone holding the real logo, which is the point: it
completes the composition without pretending to be a brand it is not.

#### Finding where the brand goes

```ts
const { slots, notes } = detectBrandSlots(markup);
const scan = scanBrandBands(decodePng(bytes));
```

`detectBrandSlots` reads layer names - `id`, `data-name`, `inkscape:label`,
`serif:id`, `aria-label` - and reports a box, a region, a page share and a
confidence for each of `logo`, `icon`, `wordmark`, `linkedMedia`, `tagline`,
`brandName`, `domain`, `badge` and `footer`. A name is a statement of intent,
so these are exact.

`scanBrandBands` is the fallback for a raster, or for a vector whose layers are
all called `Layer 1`. It reads a quarter of the page at a time, top first, and
stops at the first band holding a compact mark - ink that covers a little of
the band and is gathered rather than spread across it the way a line of text
is. It is a heuristic with no idea what a logo looks like, it says so in
`notes`, and its `confidence` never reaches a name's. `findBrandSlots` tries
the names and falls back to the scan.

### Drawing into the GUI canvas

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

### What the two formats share, and where they differ

Both renderers read one document, so the page size, the elements, their order,
their geometry, their colors, their transforms, their masks and the text layout
are the same by construction. What each does with that is what a vector file
and a raster file are for:

| | SVG | PNG |
| --- | --- | --- |
| Shapes | Written as themselves - a `<rect>` stays a rect, editable in a design tool | Filled into pixels, anti-aliased |
| Text | Live `<text>`, in the font family the element named | Drawn from a built-in single-stroke alphabet |
| Placed media | Embedded verbatim, every format | PNG decoded here; other formats need a decoder |
| Gradients | A `<linearGradient>` or `<radialGradient>` in user space | Each pixel's color worked out along it |
| Erase shapes | A `<mask>` on the group | Cleared from the group's own layer |
| Effects | A `<filter>` in sRGB, in user space | Each effect run over the element's own picture |
| Blends | `mix-blend-mode`, and `isolation` on a group | Each pixel mixed as the W3C spec mixes it |
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

## Worked examples

**A card.** A 360 by 360 card with a title bar, a rule, a heading plate, a masked photo and
a footer - the shape most of this API's work takes:

```ts
import { createComposition } from 'napkin-sketch';
import { imageDataUrl, writeComposition } from 'napkin-sketch/graphic-design/files';

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

**A badge with a gradient and a hole.** A radial gradient under a ring: the
ring is a disk in a group whose `erase` shape clears its middle, so the
gradient shows through the hole and nothing else is cut:

```ts
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 240, height: 240, background: '#ffffff' });

design.circle({
  cx: 120, cy: 120, r: 96,
  fill: { type: 'radial', stops: [{ offset: 0, color: '#ffe08a' }, { offset: 1, color: '#ff8a65' }] },
});
design.group({ erase: [{ type: 'circle', cx: 120, cy: 120, r: 40, fill: '#000000' }] }, (ring) => {
  ring.circle({ cx: 120, cy: 120, r: 70, fill: '#326478' });
});
design.text({ x: 120, y: 228, text: 'Acme Corp', align: 'center', fontSize: 16, fill: '#1f2328' });

const svg = design.toSVG();   // the ring's hole is a <mask> on its group
const png = design.toPNG();   // cleared from the group's own layer before it is laid down
```

**A drawing with a band added in code.** A napkin script draws the picture,
and the composition calls add to it before it is rendered:

```ts
import { compositionToSvg, evaluate, renderPng, sketchToComposition } from 'napkin-sketch';

const { book } = evaluate('napkin 1\npage 400 300\nrough 0.6\ncircle 200 130 80', { seed: 7 });
const doc = sketchToComposition(book.sketches[0]);
doc.elements.push(
  { type: 'rect', x: 0, y: 250, width: 400, height: 50, fill: '#326478' },
  { type: 'text', x: 200, y: 282, text: 'Acme Corp', align: 'center', fontSize: 20, fill: '#ffffff' },
);

const svg = compositionToSvg(doc);
const { data: png } = renderPng(doc);
```

## Limits

- **Elliptical arcs in path data.** `A` is not supported. Every rounded corner
  the API draws is generated as Beziers, so nothing in the model needs arcs,
  and a path that carries one raises rather than quietly losing a corner.
- **Raster text uses the built-in alphabet.** As above.
- **`measureText` measures that built-in alphabet, not the family you named.**
  Layout of a *block* is safe either way, because both renderers read the same
  table. Laying out *runs side by side* in a named family is not: the built-in
  font is narrower than most real faces, so a pen advanced by `measureText`
  falls short and the next run overprints the last in the SVG while looking
  fine in the PNG. Position such runs with the named font's own metric. A
  monospace family makes that easy - Courier and Courier New are exactly
  `0.6 em` per character - and a proportional family needs its real metrics or
  a single `text` element with `letterSpacing` instead of hand-placed runs.
- **Small raster text needs `scale`.** The built-in alphabet is drawn as
  strokes, and below about 10 units the stroke is thinner than a device pixel
  at `scale: 1`, so it anti-aliases to grey. Raster at 2x or 3x when the design
  carries caption-sized type; the composition is unchanged, only the sampling.
- **JPEG, GIF and SVG placements need a decoder to rasterize.** They embed in
  the SVG with no help at all. SVG has two ways around it that cost nothing:
  `placeBrand` and `inlineSvg` turn the asset into elements, which both
  renderers draw, and a linked SVG rasterizes through `resolveLink`.
- **An inlined vector keeps only what this API models.** A gradient is drawn
  as its first stop's colour, and a group's opacity is folded into its shapes.
  Patterns, filters, masks, clip paths, `<use>` references, elliptical arcs
  and sheared transforms are reported in `notes` rather than approximated. A
  logo of solid shapes comes through exactly; a logo built on a mesh gradient
  should ship as a PNG.
- **Patterns.** Not modelled. Flat and gradient paint, effects, blends,
  opacity, clipping masks and erase shapes are the palette. A gradient runs
  along an angle or out from the middle of its shape's box; one placed by end
  points of its own, or repeated past its ends, is not modelled either.
- **A page's finer typography is lowered.** An element's text has the
  attributes above. A sketch's text written to a composition
  (`sketchToComposition`) keeps its frame's paint, highlights, baseline
  shifts, turned and scaled letters, list markers, underlines and
  strikethroughs, by drawing each stretch in one style as a text element on
  its baseline, each turned or scaled letter alone, and the highlights and
  lines as filled paths. The slant Path Typing's `skew` gives a letter is
  left out, as a composition's transforms have none. Given its fonts' files,
  a headless render draws the text as its outlines instead.
- **Interlaced PNG placements.** Not decoded; re-save the asset without
  interlacing.

## For agents

- **Every method takes one object and returns the element.** Keep the element
  to change it before rendering; nothing is drawn until `toSVG`, `toPNG` or
  `render` is called, and rendering one document twice gives the same bytes.
- **Read `warnings`** from `renderPng` or `rasterize()`. An image the PNG
  could not decode, a link that drew as its placeholder and a clip that was
  never defined are reported there and not thrown.
- **A color that is not one fails the PNG**, with an error that names it,
  rather than drawing black; the SVG writes it as given. Render the PNG, or
  check colors first, before trusting an SVG of a document built from input.
- **Raster small text at `scale: 2` or `3`**, and advance runs of text side by
  side by the named font's own metric, never by `measureText`.
- **Place a vector asset with `placeBrand` or `inlineSvg`**, so it is drawn in
  the PNG as well as the SVG.
- **Write both files with `writeComposition`**, from one document in one call,
  so the SVG and the PNG cannot come from two revisions.

## See also

- [Writing a drawing out](../output/README.md): a sketch lowered into this
  model, and every format a sketch is written as.
- [Using napkin-sketch from code](../node/README.md): the package's entries, and
  the Node file helpers.
- [The AI helpers](../ai/README.md): the `graphic-designer` helper, which
  drives this API from a design language.
- [`src/core/graphic-design/`](../../../src/core/graphic-design/): the model,
  the three renderers and the file helpers.
