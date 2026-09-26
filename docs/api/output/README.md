# Writing a drawing out

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

`renderSketch` writes a page and `renderBook` writes a book, as SVG, PNG, PDF,
a `.skbk` the app opens, or an Illustrator script that rebuilds it. Both run
with no DOM, in a browser or in plain Node, and add no dependency. This page
is the reference for the formats, the box every format is cut to, and what a
format says when it leaves something out. How a drawing is made is in
[Drawing with napkin script](../drawing/README.md).

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [Writing a page and a book](#writing-a-page-and-a-book)
  - [Options](#options)
  - [SVG](#svg)
  - [PNG](#png)
  - [PDF](#pdf)
  - [The .skbk file](#the-skbk-file)
  - [The Illustrator script](#the-illustrator-script)
  - [Effects](#effects)
  - [The box: crop and registration](#the-box-crop-and-registration)
  - [Warnings](#warnings)
  - [From a sketch to a composition](#from-a-sketch-to-a-composition)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

One call, every format. A drawing from a script and a drawing from the app are
the same kind of thing - a sketch book of pages, each a layer tree of marks -
so both are written out the same way:

- **SVG** is the app's own export writer, so a generated page exports exactly
  as a drawn one does.
- **PNG** is drawn with no canvas, by the composition rasterizer the graphic
  design API already renders with. The page is lowered into a composition mark
  for mark as the SVG writes it, so the PNG is the picture the SVG draws.
- **PDF** is the app's PDF writer: one page a sketch, in vector.
- **`.skbk`** is the book as the app saves it, which opens in the app with its
  layers and anchors, ready to edit.
- **`.jsx`** is an ExtendScript file that, run in Adobe Illustrator, rebuilds
  the book there: a document a page, its layers as layers, its marks as paths
  on their own anchors, and its links placed by link.

Every format is cut to one box, from one option: the ink, a box given
outright, or a registration box every page shares.

## The mental model

```text
 page ---renderSketch---> svg | png | pdf | skbk | jsx
 book ---renderBook-----> svg per page | png per page | one pdf | one skbk | one jsx

 PNG:  page --sketchToComposition--> composition --renderPng--> bytes
```

A script's `crop` and `registration` come back from `evaluate` in `output`,
and spreading `output` into the options is what applies them:

```ts
const result = evaluate(text);
const pngs = renderBook(result.book, { format: 'png', ...result.output });
```

## Reference

### Writing a page and a book

```ts
import { writeFileSync } from 'node:fs';
import { evaluate, renderBook, renderSketch } from 'napkin-sketch';

const result = evaluate(text, { name: 'card', timestamp: '2026-09-25T00:00:00.000Z' });
const page = result.book.sketches[0];

writeFileSync('card.svg', renderSketch(page));
writeFileSync('card.png', renderSketch(page, { format: 'png', scale: 2 }));
writeFileSync('card.pdf', renderBook(result.book, { format: 'pdf' }), 'latin1');
writeFileSync('card.skbk', renderBook(result.book, { format: 'skbk' }));
writeFileSync('card.jsx', renderBook(result.book, { format: 'jsx' }));
```

| Format | `renderSketch` gives | `renderBook` gives | Write it as |
| --- | --- | --- | --- |
| `svg` | a string | a string a page, in page order | UTF-8 text |
| `png` | a `Uint8Array` | a `Uint8Array` a page, in page order | bytes |
| `pdf` | a string | one string, a PDF page a sketch | `latin1`, which keeps an embedded image's bytes |
| `skbk` | a string: a book of that one page | one string for the book | UTF-8 text |
| `jsx` | a string: a script for that one page | one string, a document a page | UTF-8 text; it is all ASCII |

An unknown format throws, naming the five: that is a mistake in the calling
code, not in a drawing.

In Node, `writeBook` and `drawToFiles` from `napkin-sketch/node` write these
as files, named and numbered - `card.svg`, or `card-1.svg` and on for a book
of several pages - so a caller does not have to; see
[Using napkin-sketch from code](../node/README.md#writing-files). From a
shell, `napkin-sketch draw` and `render` do the same; see
[The napkin-sketch command line](../cli/README.md).

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `format` | `'svg'` | `svg`, `png`, `pdf`, `skbk` or `jsx`. |
| `crop` | the whole page | `'auto'` for the ink, `'none'`, a box `{ x, y, width, height }`, or a script's `crop` as `output.crop` gives it. See [the box](#the-box-crop-and-registration). |
| `registration` | none | One box every page is cut to. It wins over `crop`. |
| `transparent` | `false` | Leaves the paper out of an SVG, a PNG or an Illustrator script. A PDF keeps its paper, as the app's exports do. |
| `scale` | `1` | PNG pixels a page pixel: `2` for a retina asset. |
| `resolveLink` | none | Reads a [linked file](../drawing/README.md#linked-graphics) so the PNG can draw it. `resolveLinkFromDir(folder)` is one. |
| `decodeImage` | none | Decodes a placed image the PNG cannot open itself: anything but a PNG. |
| `linkFolder` | the script's own folder | Where an Illustrator script looks for a linked file: a folder relative to the script, or absolute. `writeBook` and `drawToFiles` set it to the folder the links are read in. |
| `onWarning` | none | Told what a format left out or drew as a stand-in. See [Warnings](#warnings). |

A `.skbk` is the whole document, so `crop`, `registration` and `transparent`
do not apply to it, `scale`, `resolveLink` and `decodeImage` are the PNG's
alone, and `linkFolder` is the Illustrator script's.

### SVG

The app's export writer, `sketchToSvg`, which the app's own SVG export calls:

- **The layer tree, named three ways.** A layer is a `<g>` with its name as
  `data-name` (napkin's), `inkscape:label` (Inkscape's layers panel) and `id`
  (Illustrator's), a group layer is a `<g>` holding its children, and a hidden
  layer is left out.
- **Marks as path data** at two decimals, from the mark's Bezier anchors, with
  round caps and joins, dashes, fills and gradients. A profiled mark is the
  outline its profile makes, and a Copic mark its nib's footprint, each with
  the stroke riding along as data so napkin's importer rebuilds it.
- **An eraser is a `<mask>`** on its layer's group, so it cuts that layer only.
- **Text is live `<text>`.** A text box is broken into lines where the
  built-in face breaks it, since SVG text does not wrap, and the text as typed
  and the box's width ride along as `data-text` and `data-box`, so napkin's
  importer reads back the box rather than the lines.
- **A link is its reference**: `<image href="assets/logo.svg" data-link="true">`.
- **Cut to the box** by its view box: the marks keep their page coordinates
  and the window moves.

### PNG

Drawn by the composition rasterizer: scanline coverage at four samples a
pixel row, anti-aliased, with no canvas, no font engine and no dependency,
and the same bytes for the same page every time.

- **The SVG's picture.** The page is lowered into the composition model the
  way the SVG writer writes it: the same path data from the same writer, round
  caps and joins, the same dashes, a gradient placed where the SVG places it,
  a profiled or Copic mark as the outline it fills. A layer is a group drawn
  as one picture and laid down at the layer's opacity, as the app composites
  one, and an eraser clears its own layer only. Against the SVG as
  `rsvg-convert` draws it at four times the size, at least 99.78% of the ink
  agrees on every fixture in `test/imports/`, with colors within 0.3 of 255 on
  average; the test holds it to 99%.
- **Text in the built-in face.** With no font engine, text is drawn from the
  single-stroke alphabet the composition renderers share, measured with the
  same table the SVG's line breaks were made with, so a text box breaks at the
  same words in both.
- **Images.** A PNG is decoded here. A JPEG, GIF or WebP needs `decodeImage`;
  without it the image is left out and a warning says so.
- **Links.** Given `resolveLink`, a linked SVG is drawn from its shapes and a
  linked PNG from its pixels. Without one, or when the file cannot be read,
  the link's placeholder is drawn and a warning says why.
- **`scale`** multiplies the pixels and leaves the picture alone.

### PDF

The app's PDF writer, `sketchesToPdf`: a PDF page a sketch, marks in vector
with round caps and joins, and text in Helvetica.

- **Every color the PNG reads**: hex of three to eight digits, `rgb()`,
  `hsl()`, a named color and `transparent`. A color's own alpha is its
  opacity, and a transparent page prints no paper.
- **Outlines as the SVG draws them.** A dashed or dotted line is dashed, and a
  shape whose outline is switched off prints its fill alone.
- **A text box** breaks at the same words as in the SVG.
- **Stand-ins.** Images are embedded when they are JPEG and left out
  otherwise. A gradient prints as its shape's flat fill. An eraser paints the
  paper back, so it covers layers under its own too, and on a transparent page
  there is nothing to paint it in. A link prints as its placeholder, since
  embedding the file would make the PDF an import of it. The first three are
  reported through `onWarning`.
- **Cut to the box** by its media box, in page pixels as PDF points.

### The .skbk file

The book as the app saves it, which opens in the app with every layer, group
and Bezier anchor where the script put them. It keeps the book's own
timestamps rather than stamping the moment it was written, so with
`timestamp` fixed, one script writes the same bytes on every run. A page
written with `renderSketch` is a book of that one page, named after it.

### The Illustrator script

`sketchesToJsx`: one ExtendScript file that, run in Adobe Illustrator with
**File > Scripts > Other Script**, builds the book out of Illustrator's own
objects. [Rebuilding a drawing in Illustrator](../interop/README.md#rebuilding-a-drawing-in-illustrator)
has what becomes what, where a link is found, and what a run reports; in
short:

- **A page is a document**, its artboard the page and a page pixel a point,
  the unit the PDF is written in. Its paper is a locked `Background` layer,
  which `transparent` leaves out.
- **Layers are layers**, and the layers in a group are named groups inside
  one; a hidden or a locked layer arrives hidden or locked, where the SVG
  leaves a hidden layer out.
- **Marks are paths on their own anchors and handles.** A profiled or Copic
  mark is the outline it fills, text is a text frame, an image is embedded,
  and a link is placed by link, found from the script's own folder.
- **Stand-ins.** An effect is left off, and an eraser is drawn in the paper's
  color, as the PDF draws one; the writer reports both through `onWarning`.
  What the script cannot find or place when it runs, it draws as a
  placeholder and names at the end.
- **Cut to the box** by its artboard.

It is one self-contained file, the images it embeds riding in it as base64,
and the same page writes the same bytes on every run.

### Effects

A mark's, a layer's or a group's effects - see
[Drawing with napkin script](../drawing/README.md#effects) - are drawn by
every format that can draw them:

| Format | Effects |
| --- | --- |
| SVG | A `<filter>` on the mark's outermost element or the layer's group, in sRGB and in user space, and the list itself as `data-effects`, which napkin's importer reads back |
| PNG | Run over the mark's or the layer's own picture before it is laid down, as the SVG draws them |
| PDF | Not drawn: what carries them prints plain, and `onWarning` says so |
| `.skbk` | Kept, and drawn by the app |
| `.jsx` | Not written: what carries them is drawn plain in Illustrator, and `onWarning` says so |

On a layer with an eraser, the SVG and the PNG apply the effect before the
eraser cuts, the order SVG gives a filter and a mask.

### The box: crop and registration

One box cuts every format: the SVG's view box, the PNG's page, the PDF's
media box and the Illustrator script's artboard.

- **`crop: 'auto'` is the ink**: the bounds of every mark on a visible layer,
  text measured with the built-in face, grown by half the widest line, since a
  line's bounds follow its centre and its outer edge lies half its width
  beyond. It is the box the app's Selection export cuts to. An eraser adds no
  ink and so adds nothing, and a page with nothing drawn on it is written
  whole.
- **A pad** is room around the ink: `crop auto pad 12` in a script, or
  `{ mode: 'auto', pad: 12 }` in the options.
- **A box** `{ x, y, width, height }` is used as given, in page pixels.
- **`registration`** is one box for every page, and wins over `crop`. Frames
  cut to their own ink each start at a different corner and jump when played
  in sequence; frames cut to one box land on one origin.
- **Two decimals.** Every box is rounded to hundredths of a pixel, the
  precision every writer uses, so the formats read the same numbers.

```napkin
crop auto pad 12
```

`inkBox(page)` gives the ink's box, and `renderBox(page, options)` the box a
page will be written in, or `null` for the whole page, for a caller that lays
things out around the drawing.

### Warnings

`onWarning` is told what a format left out or drew as a stand-in, each
message once a page, starting with the page's name:

| Format | Says so when |
| --- | --- |
| PNG | an image needs `decodeImage`; a link drew as its placeholder, and why; a color is not one it can paint; a shadow color is not one |
| PDF | an image is not a JPEG; a gradient printed flat; a color is not a color; an effect printed plain |
| `.jsx` | an effect left off; an eraser drawn in the paper's color, or left out on a page with no paper; a color is not a color |
| SVG | nothing: the SVG writes every mark |

A warning never stops a render. The rest of the page is drawn, which is what
a caller writing a hundred files wants.

### From a sketch to a composition

`sketchToComposition(page, { crop, transparent, onWarning })` is the lowering
behind the PNG. It gives back a composition the
[graphic design API](../compose/README.md) renders and edits, for a caller that
wants to add to a drawing with the composition calls - a title band, a
watermark - before rendering it, or to write it with `compositionToSvg`.

| Mark | Composition element |
| --- | --- |
| A line (pen or marker) | `path`: `stroke`, `strokeWidth`, round `lineCap` and `lineJoin`, `dash`, and `opacity`, the tool's own when the mark sets none: a marker's is 0.38, a Copic's 0.5 |
| A one-point mark | `circle`, its radius half the mark's width |
| A filled shape | `fill` as a color or a [gradient](../compose/README.md#gradients); `stroke: null` when its outline is off |
| A profiled mark | a filled `path` of its outline; with a fill as well, a group of the fill under the outline, the opacity on the group |
| A Copic mark | a filled `path` of its nib's footprint |
| A text item | `text` set from its top, a line and a quarter apart, `maxWidth` its box |
| An image | `image` stretched to its box (`fit: 'fill'`) |
| A link | `image` with `link: true` and its path as `src` |
| A layer | `group` with the layer's name and opacity; a hidden layer is left out |
| An eraser | one of its layer group's [`erase`](../compose/README.md#groups) shapes |

## Worked examples

**Frames that line up.** A square turned a little further on each page, all
written in one box, so the frames can be played in sequence without shifting:

```napkin
napkin 1
page 400 300
name "spin"
registration 100 50 200 200
color #1f2328 width 3 fill #ffe08a
rect 170 120 60 60
repeat 3 as i {
  newpage
  rotate ((i + 1) * 22.5) at 200 150
  rect 170 120 60 60
}
```

```ts
const result = evaluate(spin, { timestamp: '2026-09-25T00:00:00.000Z' });
renderBook(result.book, { format: 'png', ...result.output }).forEach((png, i) => {
  writeFileSync(`spin-${i + 1}.png`, png);
});
```

Each frame is 200 by 200 pixels, cut from the same place on its page.

**A sprite on nothing.** A badge cut to its ink with room to spare, on no
paper, at twice the size for a sharp screen:

```napkin
napkin 1
page 400 400
crop auto pad 8
color #326478 width 4 fill #ffe08a
circle 200 200 60
text "A" at 200 172 size 48 align center
```

```ts
const result = evaluate(badge);
const png = renderSketch(result.book.sketches[0], { format: 'png', scale: 2, transparent: true, ...result.output });
```

**Everything a run left out, in one list.** A caller writing many drawings
collects the warnings beside the diagnostics:

```ts
const warnings: string[] = [];
const pdf = renderBook(result.book, { format: 'pdf', onWarning: (message) => warnings.push(message) });
if (warnings.length > 0) console.warn(warnings.join('\n'));
```

## Limits

- **PNG text is the built-in face**, a single-stroke alphabet, whatever font
  the text names. The SVG and the PDF name the font; render the SVG in a
  browser for raster text in a licensed face.
- **A text box is broken into lines by the built-in face's measure** in the
  SVG and the PDF, which have no font engine to wrap with, so the lines a real
  font sets can end a little short of, or past, the box.
- **The PNG draws PNG images by itself.** A JPEG, GIF or WebP needs
  `decodeImage`, which a browser can build on a canvas and a Node caller on
  whichever image library it already has.
- **The PDF embeds JPEG images only, prints gradients flat, leaves effects
  out, and erases by painting the paper back.** Each is reported when it
  happens.
- **The Illustrator script leaves effects out and erases by painting the
  paper back**, as the PDF does, and has been run against a stand-in for
  Illustrator's scripting objects rather than in Illustrator itself; see
  [Working with other programs](../interop/README.md#limits).
- **The PNG is the SVG's picture, not the canvas's**, where the two already
  differ: a Default outline the app draws at 0.7 of its width is drawn at its
  full width in both exports.
- **These calls write no files.** They give back strings and bytes, in a
  browser as in Node; `napkin-sketch/node` is what writes them to disk.

## For agents

- **Spread `result.output` into the options.** It carries what the script's
  `crop` and `registration` asked for; leaving it out writes whole pages.
- **Use `registration` for frames and `crop auto` for a single graphic.**
  Frames cut to their own ink do not line up.
- **Pass `onWarning` and report what it says.** A PDF without an image, or a
  PNG with a placeholder where a link should be, is otherwise silent.
- **Write a PDF with `latin1` encoding**, never UTF-8, or an embedded JPEG is
  corrupted.
- **Set `transparent: true` for a graphic that goes onto something else**, and
  `scale: 2` for a screen.
- **Place PNG images when the output is a PNG**, or pass `decodeImage`; a JPEG
  is left out without one.
- **Fix `timestamp` when a `.skbk` will be compared or committed**; the file
  keeps the book's own time.
- **Write a `.jsx` with `writeBook` or `drawToFiles`** when the drawing links
  files: they point it at the folder the links are read in. `renderBook`
  alone leaves it looking beside itself.

## See also

- [Drawing with napkin script](../drawing/README.md): what each instruction
  draws, and `evaluate`.
- [Using napkin-sketch from code](../node/README.md): the two entries, and
  the calls that write every format to files.
- [The napkin-sketch command line](../cli/README.md): `draw`, `check`, `render`
  and `verbs`, from a shell or any language.
- [The napkin script language](../language/README.md): syntax, the object form
  and every diagnostic, including `crop` and `registration`.
- [The graphic design API](../compose/README.md): the composition model the PNG is
  drawn from, its gradients and its erase shapes.
- [`src/core/script/render.ts`](../../../src/core/script/render.ts): the
  render calls and the box.
- [`src/core/sketch-composition.ts`](../../../src/core/sketch-composition.ts):
  the lowering behind the PNG.
- [`src/core/illustrator.ts`](../../../src/core/illustrator.ts): the
  Illustrator script writer.
