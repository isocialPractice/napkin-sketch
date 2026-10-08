# Drawing with napkin script

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

`evaluate` runs a napkin script and gives back a drawing: a sketch book of
pages, each with a layer tree and the marks on it. This page is the reference
for what each instruction draws and how state carries through a script. How a
script is written - its syntax, values, expressions and diagnostics - is in
[The napkin script language](../language/README.md).

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [Running a script](#running-a-script)
  - [Pages](#pages)
  - [Layers and groups](#layers-and-groups)
  - [Clipping masks](#clipping-masks)
  - [Paint](#paint)
  - [Pencils](#pencils)
  - [Transforms](#transforms)
  - [Blocks, names and definitions](#blocks-names-and-definitions)
  - [Shapes](#shapes)
  - [The shape library](#the-shape-library)
  - [Erasing](#erasing)
  - [Combining shapes](#combining-shapes)
  - [Stacking shapes](#stacking-shapes)
  - [Paths](#paths)
  - [Curves through points](#curves-through-points)
  - [Splitting paths](#splitting-paths)
  - [Smearing](#smearing)
  - [Liquify](#liquify)
  - [The hand-drawn pass](#the-hand-drawn-pass)
  - [Text](#text)
  - [Images](#images)
  - [Copying a document in](#copying-a-document-in)
  - [Linked graphics](#linked-graphics)
  - [Effects](#effects)
  - [Blend modes](#blend-modes)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

A generated drawing is made of the same things a drawn one is. Every mark is
the `Stroke` the app commits when you draw: Bezier anchors in `vector`, the
points the canvas paints sampled from them, and the paint fields - color,
width, fill, gradient, dash, profile, nib. Layers and groups are the app's own
layer rows. So a script's drawing opens in the app as editable work, with its
layers and anchors intact, and is written out by the app's own SVG and PDF
writers, and as a PNG, by [one call](../output/README.md).

A run never throws for anything in the script. An instruction that cannot run
is reported and skipped, and the run carries on; only the budget stops a run,
and then it keeps what it drew. One script gives the same book every time it
runs: ids are counted rather than random, and the time stamped on the book can
be fixed.

## The mental model

```text
 script (text or JSON) --evaluate--> sketch book --renderSketch, renderBook--> SVG, PNG, PDF, .skbk, .jsx
```

Three kinds of state carry from one instruction to the next - the paint, the
transform and the units - along with the names `let` sets and the layer marks
go to. Blocks decide how far a change reaches:

| Block | What it keeps to itself |
| --- | --- |
| `group "G" { ... }` | Everything: paint, transform, units and the current layer come back when it ends. |
| `place "d"` | Everything, the same way; a definition is a drawing of its own. |
| `repeat n { ... }` | Nothing: each pass starts where the last one ended, and what the last pass left stays. |
| `push` ... `pop` | Paint, transform and units, between the two. |

So `translate` in a `repeat` walks across the page, and `push` and `pop` in the
body keep a pass to itself.

## Reference

### Running a script

```ts
import { evaluate, renderSketch } from 'napkin-sketch';

const { ok, book, diagnostics, stats, output } = evaluate(text, { name: 'card' });
const svg = renderSketch(book.sketches[0], output);
```

`evaluate` takes a script as text, or as a JSON value in the object form, which
it checks with `validateScript` first.

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | `drawing` | The book's name and its first page's. Later pages are `drawing-2`, `drawing-3`, unless `newpage` names them. |
| `seed` | `0` | The seed for [the hand-drawn pass](#the-hand-drawn-pass) until a `seed` instruction names one: a whole number. |
| `limits` | the defaults | Raises or lowers any limit of [the budget](../language/README.md#the-budget). |
| `assets` | none | [Images](#images) a script places by name, as data URLs: `{ logo: 'data:image/png;base64,...' }`. |
| `documents` | none | Pages or books a script [copies in](#copying-a-document-in) by name with `use`. |
| `resolveLink` | none | Reads a [linked file](#linked-graphics), so `link` can take its size from it; `resolveLinkFromDir(folder)` is one. |
| `timestamp` | now | The time stamped on the book and its pages. Fix it for a book that is the same byte for byte on every run. |
| `fragment` | `false` | Read a snippet: no `napkin` line is expected. |

| Result | Meaning |
| --- | --- |
| `ok` | True when nothing was an error, reading or running. |
| `book` | The drawing: always at least one page, however much of the script ran. |
| `diagnostics` | Everything reported, reading and running together, in reading order. |
| `stats` | `instructions`, `marks`, `anchors`, `points` and `pages`: how much the run did. |
| `output` | What `crop` and `registration` asked of the outputs, in pixels. Spread it into the [render options](../output/README.md#options) to apply it. |
| `seed` | The seed the run ended on. |

A script that names a language version newer than this build reads is not run
at all, since it may mean something this build would draw differently.

`drawSvg(source, options)` runs a script and gives back its first page as SVG
in one call, and in Node, `drawFile` and `drawToFiles` from
`napkin-sketch/node` run one and write every format to files; see
[Using napkin-sketch from code](../node/README.md).

`runScript(script, sink)` runs a checked script against any `ScriptSink`: an
object that starts pages, makes layers current, opens and closes groups, and
adds marks. `evaluate` uses a `SketchSink`, which builds the book; a sink that
writes somewhere else gets exactly the same calls.

### Pages

A script starts on a page the size a new sketch opens at in the app, 1280 by
800 pixels, on napkin paper, `#fcfaf5`. `page` sizes it: a named size, or a
width and a height, turned `portrait` or `landscape`. `background` sets its
color, `background none` makes it transparent, and `name` names it.

`newpage` starts another page the same size and color. The paint and the units
carry across; the transform starts again from nothing, so each page draws from
its own corner. A `newpage` belongs at the top of a script or in a `repeat`
there, never inside a group or a definition.

```napkin
page a5 landscape
background #ffffff
name "front"
circle 50% 50% 30%
newpage "back"
rect 10% 10% 80% 80% r 12
```

### Layers and groups

Marks go to the current layer. A page starts with `Layer 1`, which is left out
of the finished page when nothing was drawn on it and the script named layers
of its own.

- `layer "Sky"` makes `Sky` the current layer: the one of that name in the
  current group, or a new one when there is none. Naming a layer again goes
  back to it, and any `opacity`, `hidden` or `locked` given apply to it.
- `group "Figure" { ... }` makes a new group layer; the layers named in its
  block are its children. A mark drawn straight into a group, before any
  `layer` in it, lands on a layer named after the group. When the block ends,
  marks go back to the layer that was current before it.
- Layers are stacked in the order the script makes them, so a later layer
  paints over an earlier one, as in the app's layers panel, and a group's row
  sits above the layers it holds, where the app keeps a group's row.

```napkin
layer "Paper"
rect 0 0 100% 100%
group "Figure" opacity 0.9 {
  layer "Body"
  ellipse 200 260 60 90
  layer "Head"
  circle 200 140 40
}
layer "Paper"
line 0 400 400 400
```

### Clipping masks

`clip ["<name>"] { ... }` makes a clip group, as the app's Make Clipping Mask
does: a group, named `Clip Group` unless given a name, whose content shows
only inside the last closed shape its block draws, in paint order. That shape
is the clipping path. It paints nothing while it clips, and keeps its paint
for the app's Release Clipping Mask to show.

- **The clip is the topmost closed shape**, as the app takes the topmost of a
  selection: an open line or text drawn after it does not take its place.
  Text, pictures and linked graphics never clip.
- **The block is a group's block**: `layer` makes layers inside it, and a
  mark drawn before any `layer` lands on a layer named after the group. A
  clip inside a clip shows only where both clipping paths overlap.
- A block that draws no closed shape is a plain group, with a `clip-open`
  warning. A `clip` inside a `wipe` or a `stack` is a `misplaced-verb`,
  as a `group` is there.
- Every output keeps the clip: the SVG as a `<clipPath>` the group is
  clipped by, the PDF as a clipping path, the Illustrator script as a
  clipped group, and the composition as the group's `clip`.

```napkin
clip "Window" {
  fill #27486d
  rect 20 20 200 140
  stroke off
  circle 120 90 60
}
```

### Paint

Each paint instruction sets one field of every mark after it:

| Instruction | Mark field | Notes |
| --- | --- | --- |
| `tool` | `tool` | `pen`, the app's Brush (`tool brush` is the same: the app calls the pen the Brush, and files keep `pen`); `marker`, translucent; `copic`, a broad angled nib; `pencil`, a lead through the paper's grain; `eraser`, which cuts rather than draws: see [Erasing](#erasing). |
| `color` | `color` | Any color the language accepts. |
| `width` | `width` | Scaled by the transform's average scale. |
| `opacity` | `opacity` | Left unset, the tool's own default applies, as in the app. |
| `fill` | `fill` | Closed marks only. |
| `gradient` | `gradient` | Closed marks only; a linear gradient's angle turns with the drawing. |
| `stroke off` | `noStroke` | A closed shape drawn as its fill alone. |
| `style` | `strokeStyle` | `solid`, `dashed` or `dotted`. |
| `profile` | `profile` | Brush (`pen`) and marker marks only. |
| `nib` | `nibAngle` | Copic marks only; the angle turns with the drawing. |
| `pencil` | `tool`, `pencil`, `color` | The Pencil at a grade; see [Pencils](#pencils). |
| `rough` | - | Draws the marks after it by hand; see [The hand-drawn pass](#the-hand-drawn-pass). |
| `font` | `fontFamily`, `fontSize` | The family and size of [text](#text) after it. |
| `character` | `typeset.runs` | The character attributes of [text](#text) after it: its face, tracking, kerning, leading, word spacing, capitals, scales, baseline shift, turn and highlight, a superscript or a subscript, an underline and a strikethrough. `character reset` takes them off. |
| `paragraph` | `typeset.paras` | The paragraph attributes of [text](#text) after it: its alignment, indents, the space before and after it, hyphenation, and a bulleted or numbered list. `paragraph reset` takes them off. |
| `textconfig` | the book's `textConfigs` | A Text Configuration: `character`'s clauses, with a size, a family and a color, under a name; see [Text](#text). |
| `accent` | `typeset.paras` | The next text's code colored as a language reads it; see [Text](#text). |

Every mark is flagged `sharpened`, so the app's auto-sharpen leaves a generated
shape as it is.

### Pencils

`pencil <grade> [<color>]` takes up the app's Pencil at a grade: every mark
after it is drawn with that lead through the paper's grain, in the grade's
tone, as the app draws it (`core/pencil.ts`).

- **A grade**: graphite alone, `9H` to `9B` (`2B`, `HB`, `4H`), or a medium
  and its grade - `charcoal` `HB` to `6B`, `compressed` `2B` to `6B`, and
  `vine` `hard`, `medium` or `soft` - as two words (`charcoal 4B`) or one
  (`vine-soft`), in any case. The object form names it as the API does:
  `2B`, `charcoal-4B`, `vine-soft`. A pencil there is not is an
  `expected-choice` error.
- **A color** makes a colored pencil: the lead's grain and density in that
  color. Without one the grade's tone is the mark's `color`, whatever
  `color` says - the ink does not change a pencil.
- **The width is the line's own.** The app's softer leads draw a broader
  line at one tool width; a script says the width it wants.
- `tool pencil` takes the Pencil up at the grade it had last, graphite HB to
  begin with.

```napkin
width 3
pencil 2H
line 20 20 380 20
pencil 6B
line 20 50 380 50
width 6
pencil vine soft
line 20 90 380 90
pencil 2B #3b6e8f
line 20 130 380 130
```

### Transforms

`translate`, `rotate`, `scale` and `mirror` change where everything after them
lands. Each applies on top of the ones before it, in the frame they left, the
way a canvas transform does. Angles turn clockwise, and `rotate`, `scale` and
`mirror` work about the origin unless given a point with `at`.

A transform is baked into the anchors of each mark as it is drawn, never
written out as a transform of its own. A transform is affine, so mapping a
curve's anchors and both of their handles maps the curve itself exactly. A
stroke's width scales with the transform, and a copic nib and a linear
gradient's axis turn with it.

`push` saves the transform, the paint and the units, and `pop` puts them back.
A `pop` with no `push` in its block is an error, and a `push` left open when
its block ends is restored there, with a warning.

```napkin
repeat 12 as i {
  push
  rotate (i * 30) at 200 200
  line 200 200 200 80
  pop
}
```

### Blocks, names and definitions

- **`let`** sets the nearest name already set, or makes a new one in the
  current block. Its value is a number in the current units; a length with a
  unit, `let margin 10mm`, is converted into them.
- **`repeat`** runs its block a whole number of times, 0 or more, with the
  counter named by `as` running from 0. The counter ends with the repeat.
- **`define`** records a block under a name without drawing it, and is hoisted:
  a `place` may come before its `define`.
- **`place`** draws a definition with its origin at the point given by `at`,
  turned by `rotate` and scaled by `scale` about that origin. A definition
  reads the names in force where it is placed, so a name set just before a
  `place` works as a parameter. A definition that places itself, directly or
  through another, is refused.

```napkin
define "petal" {
  ellipse 0 (0 - size) (size / 3) (size)
}
let size 40
repeat 8 as i {
  place "petal" at 200 200 rotate (i * 45)
}
let size 15
place "petal" at 200 200
```

### Shapes

Every shape is Bezier anchors, never a polygon of samples:

| Shape | Outline |
| --- | --- |
| `rect` | Four corners, or with `r` four quarter arcs between straight sides; the radius is held to half the shorter side. |
| `circle`, `ellipse` | Four anchors on the axes, from three o'clock clockwise, with handles `4/3 (sqrt 2 - 1)` of the radius along the tangents. |
| `line`, `polyline` | Straight segments. |
| `polygon` | Straight sides, closed. With `r`, every corner is rounded by an arc of that radius that touches both of its sides, whatever the corner's angle; a corner's radius is held so its arc takes no more than half of either side. |
| `star` | Twice as many corners as points, the first point straight up. |
| `arc` | Open, in pieces of at most a quarter turn; clockwise when the end angle is greater, the other way when it is smaller, and no more than a full turn. |
| `spiral` | Archimedean, winding clockwise from its centre, as cubic pieces of a quarter turn. |
| `shape` | A shape from [the library](#the-shape-library), fitted to a box. |

The circle, the ellipse and the rounded rectangle are built with the same code
the SVG importer builds those elements with, so a generated circle and an
imported one are the same curve. Every arc and every rounded corner is pieces
of at most a quarter turn with handles `4/3 tan(a/4)` of the radius long, `a`
being the piece's angle, so a rounded `polygon` with square corners is the
rounded `rect` of the same size, anchor for anchor.

```napkin
fill #ffe08a
polygon 200 40, 360 260, 40 260 r 16
polygon 400 60, 560 60, 560 220, 400 220 r 30
star 700 160 100 45 5
```

### The shape library

`shape "<name>" at <x> <y> size <size>` draws a named shape from the built-in
library, from `x`, `y` down and to the right. With one size, the shape's longer
side is that long and it keeps its proportions; with a width and a height, it
is stretched to fill them. Names are read in any case. A name the library does
not have is reported as `unknown-shape`, with the names it most likely meant.

```napkin
shape "cube-isometric" at 40 40 size 160
fill #ffe08a
shape "cylinder-perspective" at 240 40 size 160
shape "star" at 440 40 size 160 80
```

A shape is one mark or several, drawn in the current paint, and each mark
shows only what the shape's source showed. An outline the source left
unfilled stays unfilled when a `fill` is set. A backdrop - a part the source
filled without an outline - is left out when nothing is filled, and drawn
with the fill and no outline when something is. So with no fill the isometric
and perspective objects are line drawings, and with one they are solid.

### Erasing

`tool eraser` makes the lines after it erase, as the app's Eraser does: each
cuts its swath - the width it is drawn at, all along it - out of the marks drawn
before it on its layer, and draws nothing of its own (`core/erase.ts`).

- **A line** under it is cut where the eraser crosses it, into a mark of
  several pieces, one subpath each.
- **A filled shape** has the swath taken out of it; where the shape has an
  outline, the outline follows the cut.
- **What it leaves alone.** Marks on other layers, and marks drawn after it.
  Text and pictures it reaches are passed over, with an `erase-skipped`
  warning: an eraser cuts paths and lines. A mark left with nothing is taken
  away.
- **In a `wipe` or a `stack` block**, it cuts the block's own marks before
  they are combined.
- An eraser takes no fill, outline style or effect, which wait for the next
  mark that shows. Where the geometry cannot make a cut, the eraser mark
  itself is drawn, as an older file holds one, so the picture still shows the
  cut.

```napkin
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 200 120 r 12
line 20 160 220 160
tool eraser
width 24
line 120 0 120 180
```

### Combining shapes

`wipe <op> { ... }` combines the marks its block draws as the app's Wipe
Stacks - a vector editor's Pathfinder - combine them, and draws what is left
in their place:

| Op | Pathfinder | What is left | Painted as |
| --- | --- | --- | --- |
| `in` | Unite | everything the marks cover | the topmost mark |
| `out-front` | Minus Front | the bottom mark, less the rest | the bottom mark |
| `out-back` | Minus Back | the top mark, less the rest | the top mark |
| `mid` | Intersect | where all of them overlap | the topmost mark |
| `outer` | Exclude | where an odd number of them overlap | the topmost mark |
| `clean` | Divide | every piece of their overlaps, a mark each | the topmost mark over the piece |

- **What a mark is to a wipe.** A filled mark, or a closed outline, is its
  inside; any other mark - a line, a Copic stroke, a profiled one - is its
  ink, the width it paints at. A result keeps the paint of the mark it is
  painted as; one painted from ink is a filled shape in the ink's color, with
  no outline. Where a result runs along a mark's own curves, it keeps that
  mark's anchors exactly.
- **The block** keeps its paint and transforms to itself, as a group's does,
  and its marks stay on the layer the `wipe` is on, so `layer`, `group`,
  `use` and `newpage` are refused inside it. A `place` or another `wipe`
  inside one works, its marks among the ones combined. Effects written just
  before a `wipe` go on every mark it leaves.
- **What it cannot combine.** Text, pictures, linked files and eraser marks
  in the block are drawn as they are, with a `wipe-skipped` warning. A wipe
  that leaves nothing warns `wipe-empty`; one that cannot combine its marks -
  fewer than two, more than 32 of them or 512 pieces, or geometry it cannot
  make - warns `wipe-failed` and draws them as they are.
- **The budget** counts what a wipe leaves, not the marks it took.

### Stacking shapes

`stack merge|remove <points> { ... }` stacks the marks its block draws as the
app's Shape Stacker - a vector editor's Shape Builder - stacks them. The
marks make pieces: every place where they overlap, and every place where
they do not. Each point picks the piece under it.

- **`merge`** makes the pieces picked one shape, painted as the topmost mark
  over the first point's piece, and each mark keeps what was not merged. A
  single point makes its piece a shape of its own, drawn right after the mark
  it is painted as.
- **`remove`** takes the pieces picked away from every mark; a mark left
  with nothing is not drawn.
- **The points are where the `stack` line is**: its transform places them,
  as it would a mark drawn on that line, and a transform inside the block
  moves the marks and not the points. A point on none of the pieces picks
  nothing, with a `stack-missed` warning naming it.
- The rest is `wipe`'s: the block keeps its paint and transforms to itself,
  `layer`, `group`, `use` and `newpage` are refused inside it, text,
  pictures and eraser marks are passed over (`wipe-skipped`), a stack that
  takes every piece away warns `wipe-empty`, one that cannot stack its marks
  warns `wipe-failed` and draws them as they are, and effects written just
  before it go on every mark it leaves.

```napkin
fill #d0342c
stack merge 60 100, 125 100 {
  circle 100 100 60
  fill #27486d
  circle 150 100 60
}
stack remove 355 100 {
  fill #ffe08a
  rect 260 40 120 120
  fill #27486d
  circle 380 100 60
}
```

```napkin
fill #d0342c
wipe clean {
  circle 100 100 70
  fill #27486d
  circle 180 100 70
}
fill #ffe08a
wipe out-front {
  rect 300 30 140 140
  fill none
  width 14
  line 290 180 450 20
}
```

<!-- shapes:start -->
| Shape | Natural size | Marks | Backdrops | Read from |
| --- | --- | --- | --- | --- |
| `square` | 231.43 x 231.43 | 1 | - | `shapes.svg#square` |
| `rectangle` | 482.09 x 231.43 | 1 | - | `shapes.svg#rectangle` |
| `circle` | 272.06 x 272.06 | 1 | - | `shapes.svg#circle` |
| `ellipse` | 514.62 x 212.94 | 1 | - | `shapes.svg#ellipse` |
| `triangle` | 231.43 x 231.44 | 1 | - | `shapes.svg#triangle` |
| `right-triangle` | 209.91 x 231.44 | 1 | - | `shapes.svg#right-triangle` |
| `hexagon` | 164.76 x 142.68 | 1 | - | `shapes.svg#polygon` |
| `star` | 233.42 x 222 | 1 | - | `shapes.svg#star` |
| `horizontal` | 195.31 x 0 | 1 | - | `shapes.svg#horizontal` |
| `vertical` | 0 x 195.31 | 1 | - | `shapes.svg#verticla` |
| `45-degree` | 138.11 x 138.11 | 1 | - | `shapes.svg#_45-degree` |
| `15-degree` | 188.66 x 50.55 | 1 | - | `shapes.svg#_15-degree` |
| `arc` | 79.66 x 103.4 | 1 | - | `shapes.svg#curve` |
| `spiral` | 147.292 x 130.561 | 1 | - | `shapes.svg#curve-2` |
| `wheel-isometric` | 249.57 x 262.712 | 3 | 1 | `isometric-objects.svg#wheel-isometric` |
| `sphere-isometric` | 275.74 x 275.74 | 1 | - | `isometric-objects.svg#sphere-isometric` |
| `cube-isometric` | 296.23 x 264.39 | 7 | - | `isometric-objects.svg#cube-isometric` |
| `cylinder-isometric` | 246.64 x 199.92 | 5 | - | `isometric-objects.svg#cylinder-isometric` |
| `wheel-perspective` | 200.615 x 260.116 | 3 | 1 | `perspective-objects.svg#wheel-perspective` |
| `sphere-perspective` | 262.48 x 275.74 | 1 | - | `perspective-objects.svg#sphere-perspective` |
| `cube-perspective` | 267.9 x 223.06 | 7 | 1 | `perspective-objects.svg#cube-perspective` |
| `cylinder-perspective` | 246.64 x 209.92 | 5 | 1 | `perspective-objects.svg#cylinder-perspective` |
<!-- shapes:end -->

The natural size is the shape's extent in its source, in pixels, measured over
its curves rather than its handles, and it gives the proportions that one size
keeps. A line has no extent across itself, so `horizontal` and `vertical` sit
in the middle of the box they are given.

The shapes come from the SVG files in
`ai-helper/vectors/skills/vector-graphics/assets`: every named group or element
at the top of `shapes.svg`, `isometric-objects.svg` and
`perspective-objects.svg` is one shape. `npm run shape-library` reads them into
`src/core/script/shape-library.json` with the SVG importer's own code, so a
library shape has the anchors importing its file would give it, and a test
fails when the committed library and the files disagree. To add a shape, add a
named group to one of those files and run it again.

### Paths

A `path` is one mark, however many subpaths it has.

- **`path "..."`** reads SVG path data - every command, absolute or relative,
  arcs included - with its numbers in the current units.
- **`path { ... }`** builds it step by step: `move` starts a subpath, `to` and
  `by` draw straight segments, `curve` draws a cubic, `smooth` draws a cubic
  whose first handle mirrors the last one, `through` draws a smooth curve
  through points (see [Curves through points](#curves-through-points)), and
  `close` closes the subpath. A step after `close` carries on from where the
  closed subpath began.
- A mark closes all of its subpaths or none. When some close and some do not,
  the closed ones are drawn with an explicit segment back to their start and
  the mark stays open.

```napkin
path {
  move 40 40
  to 160 40
  to 100 140
  close
  move 90 70
  to 110 70
  to 100 90
  close
}
```

### Curves through points

`through` draws a smooth curve through every point it is given, with an anchor
at each one, so the curve can be reshaped point by point in the app. At a point
inside the list the curve runs parallel to the line from the point before it to
the point after it, and each handle reaches a third of the way along its own
segment, so points spaced unevenly do not throw it into loops. The first and
last segments are the parabolas that meet their neighbours. Two points make a
straight line.

Outside a path, `through` is an open mark of its own. Inside one, it carries on
from the current point. After a `curve` or a `smooth` it sets off along the
mirror of the last handle, so the join stays smooth, and a `smooth` after it
mirrors its last handle in turn.

```napkin
color #c0392b
through 40 200, 140 120, 240 200, 340 120, 440 200
path {
  move 40 300
  curve 80 220 160 220 200 300
  through 280 360, 360 300
  smooth 460 220 500 300
}
```

### Splitting paths

`split <x> <y>` cuts the topmost mark drawn so far whose path passes within
4 px of the point, where the point lands on it, as the app's Split - a
vector editor's Scissors - cuts it. Nothing moves, and the pieces take the
mark's place on its layer, each keeping every paint property.

- **An open path becomes two.** A point within 2 px of an anchor cuts on the
  anchor and adds none; anywhere else a curve is divided by de Casteljau, so
  both pieces trace it exactly.
- **A closed path opens there**, one open path starting and ending at the
  point; a second `split` divides it. A compound shape gives up the ring
  that was cut, as an open mark of its own, and the rest stays closed.
- **The point is where the `split` line is**: its transform places it, as it
  would a mark drawn there. In a `wipe` or a `stack` block, `split` cuts
  among the marks the block has drawn, which the block then combines.
- A point within reach of no path - text and pictures have none - or on the
  end of an open one cuts nothing, with a `split-missed` warning.

```napkin
line 20 60 220 60
split 120 60
fill #e9c46a
rect 260 20 120 80
split 320 20
split 320 100
```

### Smearing

`smear <width> <strength> <x> <y>, <x> <y>, ...` runs a pass of the app's
Smear, a blending stump, along the points: every Pencil mark drawn so far
that it reaches keeps the pass, and draws with its graphite spread along it
(`core/smudge.ts`). Tone moves from where it is thick to where it is thin,
the paper's tooth fills in and edges soften; the darkness is kept.

- **The width** is the stump's, in the current units and scaled by the
  transform, as a mark's width is; **the strength** runs from 0 to 1, and is
  held there.
- **The points** are where the `smear` line is, under its transform. Each
  mark keeps the part of the pass from where the stump first reached it to
  as far as it carried graphite past it.
- In a `wipe` or a `stack` block, it smears among the marks the block has
  drawn. Reaching no pencil mark, it says so with a `smear-missed` warning.
- The script writer cannot say which marks a pass was for, so a page with
  smeared marks is written unsmeared, and the writer says so.

```napkin
pencil 4B
repeat 12 as i {
  line (20 + i * 6) 20 (40 + i * 6) 140
}
smear 24 0.6 10 80, 150 80
```

### Liquify

`warp <x> <y> <radius> <dx> <dy>`, `twirl <x> <y> <radius> <degrees>`,
`pucker <x> <y> <radius> <amount>` and `bloat <x> <y> <radius> <amount>`
press one of the app's Liquify brushes once at the point, on every mark drawn
so far that it reaches (`core/liquify.ts`). What the brush bends falls off
smoothly from its centre to nothing at its radius, so a mark is bent where the
brush is and left exactly as it was past it.

- **`warp`** pushes what is under the brush by `dx` and `dy`, carrying the
  brush along, so what is under its centre goes the whole way, like clay.
- **`twirl`** turns what is under the brush about its centre, by the angle
  there - clockwise on the screen, as `rotate` turns - and less toward the
  rim. Distances from the centre are kept.
- **`pucker`** and **`bloat`** draw what is under the brush in toward its
  centre or push it out: a point near the centre moves by the amount, 0 to 1
  and held there, of its distance.
- **The point and the radius** are where the line is, under its transform, as
  a mark drawn there would be. The radius scales with the transform, Warp's
  push turns and scales with it, and a mirrored transform turns a Twirl the
  other way.
- **What bends.** Anchors and handles move, and a segment is split where one
  piece could no longer follow the bend; each mark bent is then fitted again,
  within half a pixel, so its anchors stay few. Pencil marks are the Smear's,
  and text, pictures and eraser marks have no outline to bend: all are left
  as they are. Reaching nothing it bends, the line says so with a
  `liquify-missed` warning.
- In a `wipe` or a `stack` block, it bends among the marks the block has
  drawn, before they are combined.

```napkin
rect 40 40 160 100
warp 120 40 30 0 24
circle 300 90 50
bloat 340 90 40 0.5
line 60 200 180 200
twirl 120 200 70 90
```

### The hand-drawn pass

`rough <amount>` draws every mark after it as a hand would: `rough 0.3` is
barely there, `rough 1` is clearly drawn by hand, and `rough off` is exact
again. It is paint, so it carries to the marks after it, and a `group`, a
placed definition or a `push` and `pop` keep it to themselves.

```napkin
seed 7
rough 0.6
fill #ffe08a
rect 40 40 160 120
fill none
circle 320 100 60
line 420 60 560 160
rough 1 passes 2
polygon 40 240, 200 240, 120 360
```

The pass moves each mark's anchors on the page, after any transform, so a
shape scaled up wobbles no more than one drawn at that size. What it draws is
anchors like any other mark, editable in the app.

- **Straight segments bow.** A longer segment bows further, but by the square
  root of its length, so a long side bows less for its size than a short one.
- **Anchors drift.** Anchors close together drift together, and none drifts so
  far that a small shape loses its outline.
- **The curves a shape was drawn with turn and stretch**, both handles of an
  anchor alike, so a smooth join stays smooth. A bowed straight segment is
  not turned again.
- **Lines run past their ends.** An open line carries on at each end along
  its tangent. A closed line opens where it starts and carries on past it, so
  the join shows. `overshoot <length>` sets how far on the page, and
  `overshoot 0` keeps closed lines closed.
- **A filled shape is coloured in separately.** A closed shape with a fill and
  a line comes out as two marks: the fill, roughened less, then the line. A
  fill with no line stays one mark, roughened fully.
- **`passes 2` restates the line** on a wobble of its own, thinner and
  lighter, the way a pencil goes over a line twice.

Each part reaches this far at `rough 1`, and proportionally less at a smaller
amount:

<!-- rough:start -->
| Part | At `rough 1` |
| --- | --- |
| Anchor drift | Up to 5 px, and no more than 15% of the way to a neighbouring anchor |
| Bow of a straight segment | Up to 0.57 times the square root of its length: 5.7 px for a 100 px segment, 11.4 px for a 400 px one |
| Turn of a curve's handles | Up to 6 degrees, both handles of an anchor alike |
| Stretch of a curve's handles | Up to 20% longer or shorter |
| Overshoot | 1.5 line widths past each end, and no more than 25% of the segment it extends |
| Join of a closed line | Up to 60% of the anchor drift from where the line began |
| Fill under a line | Roughened 50% as much as the line |
| Second pass | 60% of the width and 55% of the opacity |
| Wobble length | 80 px: anchors closer together than this drift together |
<!-- rough:end -->

**The wobble is seeded.** The same script and the same seed draw the same
bytes on every run. The seed is the last `seed` instruction's, or
`options.seed`, or 0, and another seed draws the same drawing by another hand.
Each mark's wobble comes from the seed and the mark itself, so adding, moving
or removing one mark leaves every other mark's wobble as it was, and the same
shape drawn twice wobbles differently each time.

**It costs more.** A bowed segment samples to as many as 24 points where a
straight one took one, and a filled shape or a second pass adds marks. The
budget counts all of it, and the marks of one shape are drawn together or not
at all.

### Text

`text "<words>" at <x> <y>` places a text item: live text the app sets in the
current font and edits as it edits any text, set by the type layout every
output shares. `at` is the top of the first line: its left end, or with
`align center` or `align right` its middle or its right end, and `align
justify` spreads a line across its box. `size` sets this text's size, and
`font "<family>" <size>` sets both for all the text after it. `\n` in the
string starts a new paragraph.

- **Sideless Typing**, the default, breaks lines only at `\n`.
- **Sheet Typing** fills a frame: `box <width>` a rectangle that grows down to
  fit, `align` then placing the box, and `inside "<path data>"` any shape,
  drawn from `at`. Lines break between words, and a frame that cannot hold
  all of the text leaves the rest out.
- **Path Typing** sets the text `along "<path data>"`, drawn from `at`: from
  `start` along its length, each character turned with the path - the
  `rainbow` effect, the default - or, by its `effect`, `skew`, `ribbon`,
  `stair` or `gravity`, as a vector editor's Type on a Path effects turn
  them. `flip` runs it the other way,
  on the other side.
- **`vertical`** sets the text in upright columns that run right to left,
  `at` their top right.

```napkin
font "Georgia" 28
text "Acme Corp" at 320 40 align center
text "A caption that wraps inside a box of its own" at 40 100 size 16 box 180
text "Around the bend" at 40 300 size 18 along "M0 0 C60 -60 180 -60 240 0"
```

`character` and `paragraph` set what every text after them has, as `font`
does, until `character reset` and `paragraph reset`. `runs (...)` gives
stretches of one text styles of their own, each from where it starts to where
it ends, counting the text's characters from 0:

```napkin
character tracking 50
paragraph align justify hyphenate
text "A paragraph set justified, its long words hyphenated where they must be" at 40 160 size 14 box 200
character reset
paragraph reset
text "Acme Corp" at 40 40 runs (0 4 face "Bold", 5 9 color #c0392b underline)
```

| `character` clause | Sets |
| --- | --- |
| `face "<face>"` | The face in the family: `"Bold"`, `"Italic"` |
| `tracking <n>`, `kern <n>` | The space between all the letters, or between one pair, in thousandths of an em |
| `kerning auto\|none` | The font's own kerning, or none |
| `leading <length>` | The line spacing; with none, it follows the size |
| `spacing <n>%` | The space between words, 100% the font's own |
| `caps normal\|all\|small` | Capitals as typed, all capitals, or small capitals |
| `hscale <n>%`, `vscale <n>%` | The letters' width and height |
| `shift <length>`, `rotate <degrees>` | The baseline moved up, and each letter turned |
| `highlight <color>` | A color behind the letters |
| `super`, `sub`, `underline`, `strike` | A superscript or a subscript; a line under or through |

| `paragraph` clause | Sets |
| --- | --- |
| `align left\|center\|right\|justify` | The alignment, the last line of a justified paragraph set left |
| `indent <left> [<right>]`, `first <length>` | The indents, and the first line's |
| `before <length>`, `after <length>` | The space before and after each paragraph |
| `hyphenate`, `nohyphenate` | Whether long words break with a hyphen |
| `list bullet\|number\|none`, `level <n>` | A bulleted or numbered list, and how deep, 1 to 9 |

```napkin
paragraph list bullet
text "Widgets\nGadgets\nGizmos" at 40 220 size 14
paragraph list number level 2
text "Order\nShip" at 240 220 size 14
paragraph reset
```

`textconfig "<name>"` defines a Text Configuration, a vector editor's
Character Style: `character`'s clauses with a `size`, a `family` and a
`color`, under a name the book keeps. A text follows one with `config
"<name>"`, and a run with `config "<name>"` first among its clauses; what
the text or the run has of its own overrides it. Defined again, it changes
for every text that follows it, before or after, as the app's Type panel
restyles every text that follows one changed there:

```napkin
textconfig "Callout" face "Bold" color #c0392b
text "Acme Corp" at 40 220 config "Callout"
text "Sale today" at 40 260 runs (5 10 config "Callout" underline)
```

`markdown` makes a text Markdown Flow: its text is Markdown, and it is drawn
as the Markdown renders - headings, emphasis, code, lists, task lists,
quotes, rules, links and tables - the Markdown itself kept in the text, so
the app edits it as Markdown. A `textconfig` named for one of the Markdown
configurations restyles what it styles:

```napkin
textconfig "Markdown Heading 1" color #27486d
text "# Acme Corp\n\nSales are **up**:\n\n- Widgets\n- Gadgets" at 40 300 size 14 markdown
```

The browser-safe entry reads Markdown with the lexer it is given, so the core
holds no Markdown reader of its own. Import `napkin-sketch/markdown` once to
give it marked's; the command line and `napkin-sketch/node` read with it
already:

```js
import { drawSvg } from 'napkin-sketch';
import { markdownToType } from 'napkin-sketch/markdown';

const { svg } = drawSvg('napkin 1\ntext "# Notes\\n\\n- one" at 40 60 markdown\n');
markdownToType('**Acme** Corp').text; // 'Acme Corp'
```

`accent` colors the next text as a language reads it - keywords, strings,
numbers, comments, names - in Napkin Light on a light page and Napkin Dark on
a dark one, each color at least 4.5:1 against its code shade. The colors
are worked out as the text is drawn, so the app keeps coloring the text as it
is edited:

```napkin
font "Consolas" 14
accent python
text "def total(prices):\n    return sum(prices)  # in cents" at 40 380
```

The highlighter comes the way the lexer does: `napkin-sketch/markdown` gives
the API highlight.js with its 36 common languages, and
`registerAccentLanguage` installs any other of its 193:

```js
import { accentRuns } from 'napkin-sketch';
import { registerAccentLanguage } from 'napkin-sketch/markdown';
import fortran from 'highlight.js/lib/languages/fortran';

registerAccentLanguage('fortran', fortran);
accentRuns('x = 1', 'fortran').language; // 'fortran'
```

- **Measured with the built-in face, unless a font is given.** With no DOM
  there is no font engine to ask how wide a font sets a word, so the layout
  measures with the single-stroke face the composition renderers draw with. A
  real face sets a little wider or narrower, so centred text is centred on
  that measure rather than to the pixel, and a box may break its lines
  elsewhere in the app. Font files the host gives (`--font`, a render's
  `fonts`) are measured by their own advances and kerning, and drawn as their
  outlines in a PNG and a PDF.
- **Upright, as the app keeps text.** A text item moves and scales with the
  drawing, but a turn or a mirror carries it to where the turned text would be
  and leaves it readable, the rule the app's Rotate and Mirror follow. A path
  or a shape it is set along or inside turns with the drawing, and the text
  follows it.
- **The paint it takes** is the color and the opacity. The hand-drawn pass
  does not reach a text item.

`as marks` draws the letters instead, as the built-in face's brush strokes: one
mark in the current paint, which turns and mirrors with the drawing and goes
through the hand-drawn pass like any other.

```napkin
color #c0392b width 2
rough 0.6
text "Drawn by hand" at 40 40 size 32 as marks
```

The face draws every printable ASCII character. Anything else - an accented
letter, an arrow - is left as a gap and reported as `glyph-missing`. Each line
is aligned by itself, so a centred block is centred line by line.

### Images

`image "<name>" at <x> <y>` places the image the host supplied under that name
in `options.assets`, a data URL, and `image "data:image/png;base64,..."`
places one written into the script. Nothing is read from disk: a path or a web
address is reported as `unknown-asset`, with how to pass the image in instead.

The examples on this page name `logo`, a 40 by 20 PNG, and `badge`, a small
card. The documentation test hands both to every example, as a host would
hand over its own.

```napkin
image "logo" at 40 40
image "logo" at 120 40 size 120
image "logo" at 280 40 size 60 60
```

- **Its own size, or kept in proportion.** With no size an image is its own
  size, and with one it keeps its proportions, both read from the image's
  header: a PNG, a JPEG, a GIF, a WebP or an SVG. With two it is stretched to
  fill them. An image whose size cannot be read is placed square, 100 by 100
  or the one size given, and reported as `image-size-unknown`.
- **Upright, as the app keeps images.** It moves and stretches with the
  drawing, and a turn or a mirror carries it without turning it.
- **The paint it takes** is the opacity.

### Copying a document in

`use "<name>"` copies in a document the host supplied under that name in
`options.documents` - a page, or a book, whose first page is used - as a group
of its own, named after the document or after `layer "<name>"`.

```napkin
use "badge" at 40 40
use "badge" at 300 40 scale 0.5 layer "Small badge"
```

- **Everything, as it was.** Every layer keeps its name, opacity, visibility
  and lock, groups stay groups, and every mark is copied, each with a new id.
  The document itself is left as it was.
- **Placed and scaled.** The document's origin goes to `at` and it is scaled
  by `scale`, with the transform in force on top, as for any mark. Its text
  and images stay upright.
- **Not repainted.** The paint and the hand-drawn pass do not apply: a copied
  mark is drawn as the document drew it.
- **Whole or not at all.** The budget counts every mark of the document
  before any of them is drawn.

### Linked graphics

`link "<path>" at <x> <y> size <width> <height>` places a file by reference:
one image item, on a layer of its own named for the file or by
`name "<layer name>"`, that stands for the file rather than holding it - what
a design tool calls a linked file, as opposed to an embedded one. The file's
contents are neither drawn into the drawing nor broken into layers, and
nothing is read to place it.

```napkin
link "assets/logo.svg" at 40 40 size 160 80 name "Logo"
```

- **Drawn as a placeholder.** The app shows a dashed box with the file's
  name, and so does a build that does not know links. An SVG export writes
  the reference itself, `<image href="assets/logo.svg" data-link="true">`,
  which a viewer that can reach the file draws and the importer reads back as
  a link. A PDF draws the placeholder, since embedding the file would make the
  PDF an import of it. A [PNG](../output/README.md#png) draws the file when the
  render is given `resolveLink`, and the placeholder when it is not.
- **Read by the host, inside one folder.** An output that has to draw the
  file asks the host for it through a resolver, and `resolveLinkFromDir(folder)`
  reads only inside that folder: no absolute path, `..` step or web address.
  A script names a file; only the host reads it.
- **Sized like an image.** With a width and a height it fills them. With one
  or none, the size is read from the file when the run is given `resolveLink`,
  and otherwise it is placed square and reported as `image-size-unknown`.
- **Upright, and in the paint's opacity**, like an image.

### Effects

`effect <name> <arguments>` gives the next layer, group or mark the script makes
an effect: a CSS filter function - a blur, a shadow, a shift in its color - or
one of the appearance effects a vector editor reaches for: Feather, Bevel,
Emboss, Inner Shadow, Outer Glow and Inner Glow - or Splatter, which draws a
mark's fill as a loose hatch, Warp, which bends what takes it by a style, or
3D - `extrude` and `revolve` - which builds a mark in depth.
Several `effect` lines stack in the order they are written, and the next
thing made takes them all; `effect none` lets go of any still waiting.

```napkin
effect drop-shadow 4 4 8 #00000066
rect 40 40 200 120 r 12
fill #4a7fb5
effect bevel size 6 on fill
effect outer-glow 10 #ffcc00 blend normal on stroke
rect 280 40 160 100 r 12
effect sepia
effect blur 1
image "logo" at 40 200 size 120
effect grayscale
layer "Archive"
circle 400 260 40
```

| Effect | Written | Does |
| --- | --- | --- |
| `blur` | `effect blur <radius>` | A Gaussian blur. The radius is its standard deviation, as the length in CSS's `blur()` is. |
| `brightness` | `effect brightness <amount>` | Multiplies every color: 1 leaves it as it is, 0 is black. |
| `contrast` | `effect contrast <amount>` | Pushes colors away from middle gray, or below 1 toward it: 0 is gray. |
| `saturate` | `effect saturate <amount>` | 0 is gray, 1 is as it is, 2 twice as vivid. |
| `grayscale` | `effect grayscale [<0-1>]` | Toward gray by the amount, all the way with none given. |
| `sepia` | `effect sepia [<0-1>]` | Toward sepia by the amount, all the way with none given. |
| `invert` | `effect invert [<0-1>]` | Toward the inverse by the amount, all the way with none given. |
| `hue-rotate` | `effect hue-rotate <degrees>` | Turns every hue around the color wheel. |
| `opacity` | `effect opacity <0-1>` | Fades what carries it, at its place in the list. |
| `drop-shadow` | `effect drop-shadow <dx> <dy> <blur> <color> [spread <0-100>] [blend <mode>] [opacity <0-1>]` | Outer Shadow: a shadow of its shape, moved across and down, blurred by CSS's blur radius, in the color. `spread` firms its edge first, as Photoshop's Spread does; `blend` mixes it with what is under the mark; `opacity` fades it. |
| `feather` | `effect feather <radius>` | Fades it from clear at its edge to solid `radius` inside. |
| `bevel` | `effect bevel [inner\|outer] [size <n>] [depth <percent>] [angle <degrees>] [altitude <degrees>] [soften <n>] [up\|down] [light <color> [<0-1>]] [shade <color> [<0-1>]] [light-blend <mode>] [shade-blend <mode>]` | A slope `size` wide inside the shape, or outside it, lit from `angle` - counterclockwise from the right, so 120 is the upper left - at `altitude` above the page. Its light screens and its shade multiplies; `down` presses the shape in, and `depth` steepens the slope. |
| `emboss` | `effect emboss [emboss\|pillow]`, then the bevel's options | The slope straddles the edge, or, as a pillow, dips into a groove round it. |
| `inner-shadow` | `effect inner-shadow <dx> <dy> <blur> <color> [choke <0-100>] [blend <mode>] [opacity <0-1>]` | A shadow cast inside the shape from its edge, as if the shape were a hole. `choke` firms its edge. |
| `outer-glow` | `effect outer-glow [<blur>] [<color>] [spread <0-100>] [blend <mode>] [opacity <0-1>]` | A glow around the shape. |
| `inner-glow` | `effect inner-glow [<blur>] [<color>] [choke <0-100>] [edge\|center] [blend <mode>] [opacity <0-1>]` | A glow inside the shape, from its edge or from its center. |
| `splatter` | `effect splatter [preset <name>] [angle <degrees>] [overlap <n> [<variation>]] [width <n>] [curviness <percent> [<variation>]] [spacing <n> [<variation>]] [seed <n>]` | A vector editor's Scribble: the mark's fill drawn as one loose hatch, back and forth at `angle`, `spacing` apart, in lines `width` wide, each turn carried `overlap` past the edge and rounded by `curviness`. A `preset` - default, childlike, dense, loose, moire, sharp, sketch, snarl, swash, tight or zig-zag - sets them all, and the options after it change them; the second number after `overlap`, `curviness` or `spacing` is how much it varies, from `seed`. |
| `warp` | `effect warp <style> [bend <percent>] [horizontal\|vertical] [distort <percent> [<percent>]] [part whole\|lower\|upper]` | A vector editor's Warp: what takes it bent by a style laid over its box - `arc`, `arch`, `unroll`, `shell`, `windy`, `breezy`, `curvy`, `chart`, `puffy`, `expand`, `cram` or `twirl`, or the vector editor's name for one (`bulge`, `flag`, `wave`, `fish`, `rise`, `fisheye`, `inflate`, `squeeze`, `twist`, `arc-lower`, `arc-upper`, `shell-lower`, `shell-upper`). `bend` (-100 to 100, 50 when left out) and the two `distort` percents may carry a `%`; `vertical` bends along the height; `part` is Arc's or Shell's edge. |
| `extrude` | `effect extrude [<depth>] [rotate <x> <y> <z>] [perspective <degrees>] [shading plastic\|diffuse\|none\|wireframe] [hollow] [light <azimuth> <elevation> [<intensity> [<ambient>]]] [position <x> <y> <z>] [scale <x> <y> <z>]` | A vector editor's Classic 3D Extrude & Bevel: the mark set `depth` deep (50 when left out) and drawn as shaded faces, turned about X, then Y, then Z (-18, -26 and 8 when left out, Off-Axis Front), with `perspective` up to 160 degrees. `hollow` leaves the caps off. `light` is where the light comes from, degrees round from the right and up off the page, and how strong it and the light all round are, 0 to 1. |
| `revolve` | `effect revolve [angle <degrees>] [offset <n>] [axis left\|right] [segments <n>]`, then the extrude's options | The mark swept round an upright axis at its left or right edge, `offset` off it, `angle` degrees round (360 when left out) in `segments` steps, 0 working them out. |

- **What a line leaves out is a vector editor's default.** A shadow and a
  bevel's shade multiply (`stack`), a glow and a bevel's light screen (`sheer`),
  each at 75%; an Inner Shadow falls 5 from the upper left, a glow is 7 wide in
  `#ffffbe`, and a bevel is 5 wide, lit from 120 degrees at 30. A `blend` takes
  any name of a mode, napkin's or a vector editor's; see
  [Blend modes](#blend-modes). A `drop-shadow` with none of its three options
  is the CSS shadow it always was: Normal, solid and unspread.
- **On the fill or the stroke.** `on fill` or `on stroke` at the end of any
  `effect` line aims it at that part of the next mark alone, as a vector
  editor's Appearance panel does: a closed shape's fill can glow inside its
  outline and leave the outline clean. Each part draws through its own effects,
  the stroke over the fill, and the effects on the whole mark then work on the
  two together. A text item's fill is its letters, and an image has neither
  part; an effect aimed at a part a mark does not have draws nothing. A layer
  and a group have no parts, so an effect on one works on its whole picture.
- **`hidden`** at the end of an `effect` line keeps the effect without drawing
  it, as the Appearance panel's closed eye does; it is written back so.
- **A Splatter changes what a mark draws**, not its picture, so it works
  before every other effect on the mark, whatever its place. On the whole
  mark, or `on fill`, it hatches the fill, and the outline draws as it was;
  `on stroke`, it hatches the line's own ink; a mark with no fill hatches its
  line. A hole stays empty. It draws on marks only: on a layer, a group, a
  text item or an image it is kept and draws nothing. So a mark the hand-drawn
  pass draws as several strokes takes it on its fill, or on each pass of its
  line when it has no fill, and a library shape of several parts on each part,
  while their other effects go on their layer of their own as below.
- **A Warp bends what takes it**, before every other effect on it, over the
  box it covers on the page: a mark over its own box, a layer or a group over
  the box of every mark it holds, so they bend as one - a hand-drawn mark and
  a library shape of several parts too, on the layer of their own. Text and
  images are not bent yet. With a Splatter on the same mark, the two work in
  the list's order. A Warp has no lengths, so the units and the transform in
  force leave it as written.
- **3D builds a mark** - from its fill, holes and all, or with none from its
  path - and draws it as shaded faces, far first, before any raster effect,
  which then works on the whole picture of faces. It draws on marks only, as
  a Splatter does; a hand-drawn mark's fill or a library shape's parts each
  take it. Its depth, offset and position are lengths, read in the units and
  the scale in force; its turns and its light are as written.
- **A shadow that blends mixes with what is under its mark.** An Outer Shadow
  or an Outer Glow at the end of the list, blending by anything but Normal, is
  laid under its mark, layer or group on its own and mixes with what is drawn
  under it, the page's background included: a blue shadow that multiplies
  darkens the paper and the layers it falls on, as a vector editor's does. An
  effect after it in the list works on the shadow, so it stays in the picture;
  and a carrier that is laid down any other way - translucent, blended itself,
  or holding an eraser - keeps it in its picture, where there is nothing under
  it to mix with. A part's own shadow mixes with the other part, and no further.
- **What takes it.** The next `layer` line takes it for that layer, the next
  `group` for the group, and the next mark for the mark: a shape, a path, a
  curve through points, a text item, an image or a link. `use` takes it for the
  group it copies in, and `place` draws its definition as a group of its own
  that takes it. A `repeat` is not a thing made: the first mark inside it takes
  the effect.
- **A mark takes it whole.** A mark the hand-drawn pass draws as several strokes
  - a filled shape's fill and line, a second pass - and a library shape of
  several parts go on a layer of their own, named after the verb or the shape,
  and that layer takes the effect, so a shadow falls from the whole mark rather
  than from each stroke onto the others. The layer sits above the one the mark
  was drawn in, as a link's does. An effect aimed at the fill goes on the
  hand-drawn fill instead, and one aimed at the stroke on each pass of its line.
- **Measured where it is written.** A blur's radius, a shadow's and a glow's
  offset and blur, and a bevel's size and softening are lengths in the units in
  force on the `effect` line, and scale with the transform there, as a mark's
  width does; a shadow's offset and a bevel's light turn with it. A spread, a
  choke and a depth are shares, and do not scale.
- **Drawn over the finished picture**, in order: a layer's or a group's as one
  picture, then its opacity. On a layer that also holds an eraser, the exports
  apply the effect first and cut the eraser after, as SVG masks after it
  filters; the app erases first.
- **Kept to its block.** An effect still waiting when its group, its definition,
  its page or the script ends did nothing, and says so with `unused-effect`.
- **In every output but the PDF**: an SVG `<filter>`, the PNG's own passes, and
  the app's canvas, which run the same graph of filter primitives. A PDF and an
  Illustrator script leave each effect out and name it - but a Splatter, a
  Warp and 3D, which every output draws as the lines, the bent shapes and
  the faces they are.
  See
  [Writing a drawing out](../output/README.md#effects).

### Blend modes

`blend <mode>` gives the next layer or group the script makes a blend mode:
how what it paints mixes with what is drawn under it, the page's background
included. A mode goes by its Napkin Blend name or by the name a vector editor
and CSS give it - `stack` or `multiply` - and the writer writes the napkin
name.

```napkin
background #f4e9d8
layer "Card"
rect 40 40 200 120
blend stack
layer "Shadow"
circle 200 140 60
blend sheer
group "Glow" {
  circle 120 80 30
}
```

| Napkin name | Or | Mixes |
| --- | --- | --- |
| `normal` | | Not at all: covers what is under it |
| `soak` | `darken` | The darker of the two colors |
| `stack` | `multiply` | Multiplied: always darker, as ink stacks on paper |
| `scorch` | `color-burn` | Darker, with more contrast |
| `dry` | `lighten` | The lighter of the two colors |
| `sheer` | `screen` | Screened: always lighter |
| `bleach` | `color-dodge` | Lighter, with less contrast |
| `fold` | `overlay` | Multiplying the darks and screening the lights under it |
| `light` | `soft-light` | As a soft light |
| `heavy` | `hard-light` | As a hard light |
| `messy` | `difference` | The difference between the two |
| `avoidance` | `exclusion` | The difference, with less contrast |
| `tidy` | `hue` | Its hue, with the lightness and saturation under it |
| `bright` | `saturation` | Its saturation, with the hue and lightness under it |
| `dye` | `color` | Its hue and saturation, with the lightness under it |
| `cover` | `luminosity` | Its lightness, with the hue and saturation under it |

- **What takes it.** The next `layer` line takes it for that layer, and the
  next `group` or `clip` for the group; `place` draws its definition as a group
  of its own that takes it. A mark alone does not: a blend is a layer's, so it
  goes before the layer the mark is drawn on.
- **One at a time.** A second `blend` before anything took the first replaces
  it, and the first says so with `unused-blend`, as one still waiting when its
  block, its page or the script ends does.
- **`blend normal`** sets a layer back to Normal: a layer of a placed document
  that came with a blend, say.
- **Isolate Blending has no word.** A group written from a page that has it is
  written without it, and the writer's notes say so.
- **In every output**: SVG's `mix-blend-mode`, the PNG's own mixing, the PDF's
  `/BM` on a transparency group, the Illustrator script's `blendingMode`, and
  the app's canvas, where it mixes with the paper too.

## Worked examples

**A card.** Layers for the paper, the art and the frame, a rounded plate, and
a row of dots drawn with a repeat:

```napkin
napkin 1
page 400 250
background #ffffff
layer "Plate"
color #326478 fill #326478
rect 20 20 360 210 r 16
layer "Dots"
stroke off fill #ffe08a
repeat 5 as i {
  circle (80 + i * 60) 125 18
}
layer "Frame"
stroke on fill none color #1f2328 width 2
rect 10 10 380 230 r 22
```

```ts
import { evaluate, renderSketch } from 'napkin-sketch';

const result = evaluate(card, { name: 'card' });
if (!result.ok) throw new Error('the card has errors');
const svg = renderSketch(result.book.sketches[0]);
const png = renderSketch(result.book.sketches[0], { format: 'png' });
```

**A pattern.** A definition placed around a circle, the placing angle and the
size both worked out in expressions:

```napkin
napkin 1
page 400 400
define "spoke" {
  line 0 0 0 (0 - length)
  circle 0 (0 - length) 6
}
repeat 16 as i {
  let length (80 + 40 * (i % 2))
  place "spoke" at 200 200 rotate (i * 22.5)
}
```

## Limits

- **A link shows as its placeholder in the app.** Drawing the linked file on
  the canvas, and a command that turns a link into an import, are still to
  come.
- **Text is measured with the built-in face** unless the host gives its font
  files, so text set in another font can end a little short of, or past, where
  `align` puts its end, and a text box written to SVG or PDF is broken into
  lines on that measure.
- **Text as marks draws printable ASCII only**; other characters are gaps.
- **An effect's options are the app's own.** The Appearance panel edits an
  effect a script wrote, and Transform and Mirror scale and turn it with its
  mark; a script writes it back with the options it has.
- **A rough filled shape is two marks.** The app selects and edits its fill
  and its line apart, as it would two marks drawn by hand. Leave `rough` off
  for a shape that has to stay one mark.
- **A curve is sampled to its size.** A curved segment gives about one point
  for each pixel along its handles, never fewer than 4 or more than 24, and a
  straight one gives its end. Points are what the points limit counts, so a
  drawing of many large curves reaches it sooner than its mark count suggests.
  Imported marks are sampled the same way.

## For agents

- **Check `ok` before using the book**, and read `diagnostics` by `code`. An
  `unsupported-verb` means the host running the script does not draw that
  instruction; leave it out rather than rewording it.
- **Paint carries until it is changed.** A `stroke off` or a `fill` set for one
  shape applies to every shape after it, so set it back, or draw that shape
  inside a `group` or between `push` and `pop`, which put the paint back.
- **Keep a `repeat` pass to itself with `push` and `pop`** when it turns or
  moves things. Without them, each pass starts where the last one ended.
- **Use a definition for anything drawn more than once**, and set a name just
  before `place` to pass it a size or a count.
- **Set a `fill` before a library object that should look solid.** Without
  one, its backdrop is left out and it is a line drawing.
- **Use `through` for a curve that must pass through given points** rather
  than placing handles by hand; each point stays an anchor.
- **Fix `timestamp` when the book will be compared or committed.** Ids are
  already counted, so nothing else changes between runs.
- **Hand images over as data URLs in `assets`**, never as paths: a script
  reads no files, and `unknown-asset` says so.
- **Draw lettering `as marks` when it should turn or look drawn by hand**, and
  use a text item for words a person will want to edit as text.
- **`link` a file that should stay a file** - a logo someone else keeps up to
  date - and place an `image` for pixels that should travel with the drawing.
- **Set `seed` once, near the top, for a rough drawing**, and change only the
  seed to redraw it by another hand. Leave `rough` off for a diagram whose
  sizes will be measured, since the pass moves anchors on purpose.
- **Put an `effect` line right before the line meant to take it.** An effect
  waits for the next layer, group or mark, and `unused-effect` means nothing
  followed it in its block.
- **Raise a limit on purpose, and only as far as needed.** The defaults keep a
  run to a couple of seconds.
- **Write the drawing with `renderSketch` or `renderBook`**, spreading `output`
  into the options so `crop` and `registration` apply. See
  [Writing a drawing out](../output/README.md).

## See also

- [The napkin script language](../language/README.md): syntax, values,
  expressions, the object form and every diagnostic code.
- [Writing a drawing out](../output/README.md): SVG, PNG, PDF, `.skbk` and an
  Illustrator script, and the box they are cut to.
- [Using napkin-sketch from code](../node/README.md): the package's entries, ES
  modules and CommonJS, types, and writing files from Node.
- [The napkin-sketch command line](../cli/README.md): drawing a script from a
  shell, or from any language that can start a process.
- [`src/core/script/evaluate.ts`](../../../src/core/script/evaluate.ts): the
  evaluator.
- [`src/core/script/sink.ts`](../../../src/core/script/sink.ts): the sink
  interface and the sketch book it builds.
