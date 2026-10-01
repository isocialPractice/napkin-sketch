# Drawing with napkin script: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for what each instruction draws: the drawing verbs, the shape library, the hand-drawn pass and `evaluate`.

## The drawing verbs

<!-- drawing-verbs:start -->
| Category | Verb | Written | Does |
| --- | --- | --- | --- |
| Layers | `layer` | `layer "<name>" [opacity <0-1>] [hidden] [locked]` | A drawing layer. Marks after it go on it until the next layer. |
| Layers | `group` | `group "<name>" [opacity <0-1>] [hidden] [locked] { ... }` | A group layer. The layer and group lines in its block become its children. |
| Layers | `clip` | `clip ["<name>"] { ... }` | A clip group: everything its block draws shows only inside the block's last closed shape, in paint order, which paints nothing while it clips - the app's Make Clipping Mask. Without a closed shape in it, the block is a plain group. |
| Paint | `tool` | `tool pen\|marker\|copic\|pencil\|eraser\|brush` | The kind of mark: pen (the app's Brush; brush is taken for it), marker (translucent, so overlapping passes build up like ink), copic (a broad, angled nib), pencil (a lead through the paper's grain; pencil picks one) or eraser (cuts its line's swath out of the marks drawn before it on its layer, as the app's Eraser does, and draws nothing of its own). |
| Paint | `color` | `color <color>` | The ink color of every mark after it. |
| Paint | `width` | `width <length>` | The stroke width of every mark after it. |
| Paint | `opacity` | `opacity <0-1>` | The opacity of every mark after it, from 0 to 1. |
| Paint | `fill` | `fill <color>`<br>`fill none` | The fill color of closed shapes after it, or none. |
| Paint | `gradient` | `gradient linear <angle> (<color> <offset>, ...)`<br>`gradient radial (<color> <offset>, ...)`<br>`gradient none` | A gradient fill for closed shapes after it: linear at an angle, or radial from the centre out, or none. |
| Paint | `stroke` | `stroke on\|off` | Turns the outline on or off. With it off, a closed shape is its fill alone. |
| Paint | `style` | `style solid\|dashed\|dotted` | The outline's dash: solid, dashed or dotted. |
| Paint | `profile` | `profile uniform\|rounded\|tapered\|wave` | How the width runs along a brush or marker stroke: uniform, rounded, tapered or wave. |
| Paint | `nib` | `nib <degrees>` | The angle of the copic nib, in degrees. |
| Paint | `pencil` | `pencil <grade> [<color>]` | Takes up the Pencil at a grade: graphite alone, 9H to 9B, or charcoal (HB to 6B), compressed (2B to 6B) or vine (hard, medium, soft) and its grade. Every mark after it is drawn with that lead through the paper's grain, in its tone - or in the color given, a colored pencil. The width is the line's own; the app's softer leads draw broader at one tool width. |
| Paint | `rough` | `rough <0-1> [passes 1\|2] [overshoot <length>]`<br>`rough off` | The hand-drawn pass for every mark after it: 0 is exact, 1 is clearly drawn by hand, and off is 0. Seeded, so it draws the same way every run. |
| Paint | `font` | `font "<family>" [<size>]`<br>`font <size>` | The font family and size of text after it. |
| Shapes | `rect` | `rect <x> <y> <width> <height> [r <radius>]` | A rectangle, with rounded corners when r is given. |
| Shapes | `circle` | `circle <cx> <cy> <r>` | A circle, drawn as four cubic curves rather than a polygon. |
| Shapes | `ellipse` | `ellipse <cx> <cy> <rx> <ry>` | An ellipse, from its centre and two radii. |
| Shapes | `line` | `line <x1> <y1> <x2> <y2>` | A straight line between two points. |
| Shapes | `polygon` | `polygon <x> <y>, <x> <y>, ... [r <radius>]` | A closed shape through a list of points, with rounded corners when r is given. |
| Shapes | `polyline` | `polyline <x> <y>, <x> <y>, ...` | An open line through a list of points. |
| Shapes | `star` | `star <cx> <cy> <outer> <inner> <count>` | A star with the given number of points, between an outer and an inner radius. |
| Shapes | `arc` | `arc <cx> <cy> <r> <from> <to>` | An open arc of a circle between two angles, in degrees clockwise from three o'clock. |
| Shapes | `spiral` | `spiral <cx> <cy> <r> <turns>` | A spiral winding out from its centre to the radius over the given number of turns. |
| Shapes | `shape` | `shape "<name>" at <x> <y> size <width> [<height>]` | A named shape from the built-in library, drawn in a box from x, y. With one size its longer side is that long and it keeps its proportions; with a width and a height it is stretched to fill them. |
| Shapes | `wipe` | `wipe in\|out-front\|out-back\|mid\|outer\|clean { ... }` | Combines the marks its block draws, as the app's Wipe Stacks do, and draws what is left in their place: in (Wipe In, their union), out-front (Subtract Top from Below: the bottom one less the rest), out-back (Subtract Below from Top: the top one less the rest), mid (Mid Wipe: where all of them overlap), outer (Outer Wipes: where an odd number overlap) or clean (Clean Wipe: every piece of their overlaps, a mark each). What is left is painted as the topmost mark, or as the bottom one for out-front; text, pictures and eraser marks in the block are passed over. The block keeps its paint and transforms to itself, as a group does, and effects written just before it go on what it leaves. |
| Shapes | `stack` | `stack merge\|remove <points> { ... }` | Stacks the marks its block draws as the app's Shape Stacker does, at the pieces under its points - the places where the marks overlap and where they do not: merge makes those pieces one shape, painted as the topmost mark over the first point, and each mark keeps what was not merged; remove takes them away from every mark. Text, pictures and eraser marks in the block are passed over. The block keeps its paint and transforms to itself, as a group does, and the points are where the stack line is. |
| Paths | `path` | `path "<svg path data>"`<br>`path { ... }` | One mark, from SVG path data or from a block of path steps. Each subpath of a compound path is one piece of the same mark. |
| Paths | `move` | `move <x> <y>` | Starts a new subpath at a point. |
| Paths | `to` | `to <x> <y>` | A straight segment to a point. |
| Paths | `by` | `by <dx> <dy>` | A straight segment by an offset from the current point. |
| Paths | `curve` | `curve <c1x> <c1y> <c2x> <c2y> <x> <y>` | A cubic curve to a point, steered by two handles. |
| Paths | `smooth` | `smooth <c2x> <c2y> <x> <y>` | A cubic curve whose first handle mirrors the last one, so the join stays smooth. |
| Paths | `through` | `through <x> <y>, <x> <y>, ...` | A smooth curve through a list of points. Inside a path block it continues the subpath; outside one it is an open mark of its own. |
| Paths | `close` | `close` | Closes the current subpath back to its start. |
| Paths | `split` | `split <x> <y>` | Cuts the topmost mark drawn so far whose path passes within 4 px of a point, where the point lands on it, as the app's Split does: an open path becomes two, a closed one opens there, and a compound shape gives up the ring that was cut, as an open mark of its own. Nothing moves, and the pieces take the mark's place on its layer. In a wipe or a stack block it cuts among the marks the block has drawn. |
| Paths | `smear` | `smear <width> <strength> <x> <y>, <x> <y>, ...` | A pass of the Smear, a blending stump, along a list of points: it spreads the graphite of every pencil mark drawn so far that it reaches, along the drag, as the app's Smear does. The width is the stump's, scaled by the transform as a width is, and the strength from 0 to 1. In a wipe or a stack block it smears among the marks the block has drawn. |
| Paths | `warp` | `warp <x> <y> <radius> <dx> <dy>` | Liquify's Warp, as the app's Liquify does it: a brush pushed from the point by dx and dy, carrying what is under its centre the whole way, like clay. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| Paths | `twirl` | `twirl <x> <y> <radius> <degrees>` | Liquify's Twirl: turns what is under a brush at the point about its centre, by the angle in degrees there - clockwise on the screen, as rotate turns - and less toward the rim, so distances from the centre are kept. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| Paths | `pucker` | `pucker <x> <y> <radius> <amount>` | Liquify's Pucker: draws what is under a brush at the point in toward its centre, a point near the centre by the amount, 0 to 1, of its distance. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| Paths | `bloat` | `bloat <x> <y> <radius> <amount>` | Liquify's Bloat: pushes what is under a brush at the point out from its centre, a point near the centre by the amount, 0 to 1, of its distance. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| Text and media | `text` | `text "<text>" at <x> <y> [size <size>] [box <width>] [align left\|center\|right] [as marks]` | A text item, measured and aligned, and editable in the app. With as marks the letters are drawn as brush strokes instead. |
| Text and media | `image` | `image "<asset or data URL>" at <x> <y> [size <width> [<height>]]` | Places an image: an asset the host supplied, by name, or a data URL. Nothing is read from disk. |
| Text and media | `link` | `link "<path>" at <x> <y> [size <width> [<height>]] [name "<layer name>"]` | Places a linked file: one selectable element that references the file instead of drawing its contents into the page. |
| Text and media | `use` | `use "<document>" [at <x> <y>] [scale <s>] [layer "<name>"]` | Copies in a document the host supplied, as a group, with its layers and anchors. |
| Effects | `effect` | `effect blur <radius>`<br>`effect brightness <amount>`<br>`effect contrast <amount>`<br>`effect saturate <amount>`<br>`effect grayscale [<0-1>]`<br>`effect sepia [<0-1>]`<br>`effect invert [<0-1>]`<br>`effect hue-rotate <degrees>`<br>`effect opacity <0-1>`<br>`effect drop-shadow <dx> <dy> <blur> <color>`<br>`effect none` | An effect for the next layer, group or mark the script makes, as its CSS filter function works: blur, brightness, contrast, saturate, grayscale, sepia, invert, hue-rotate, opacity or drop-shadow. Several stack in order, and none clears what is waiting. |
<!-- drawing-verbs:end -->

- The verbs that shape a script, `repeat`, `let` and the transforms: [the language cheatsheet](../language/CHEATSHEET.md).
- `crop` and `registration`: [the output cheatsheet](../output/CHEATSHEET.md).

## What a block keeps to itself

| Block | Keeps |
| --- | --- |
| `group "G" { ... }`, `place "d"` | Paint, transform, units and the current layer: a definition is a drawing of its own |
| `repeat n { ... }` | Nothing: each pass starts where the last one ended |
| `push` ... `pop` | Paint, transform and units |

## The shape library

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

## The hand-drawn pass

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

## `evaluate(source, options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | `drawing` | The book's name and its first page's |
| `seed` | `0` | The seed for `rough`, until a `seed` line names one |
| `assets`, `documents` | none | `{ logo: 'data:image/png;base64,...' }` for `image "logo"`; pages or books for `use "badge"` |
| `resolveLink` | none | Reads a linked file for its size; `resolveLinkFromDir(folder)` |
| `limits` | the budget | `{ marks: 200000 }` raises one limit |
| `timestamp` | now | Fix it for a book that is the same byte for byte |
| `fragment` | `false` | A snippet: no `napkin` line expected |

## One line each

| Want | Write |
| --- | --- |
| A rounded card | `rect 20 20 360 260 r 16` |
| A dashed outline, no fill | `style dashed fill none` |
| A linear gradient | `gradient linear 90 (#ffe08a 0, #ff8a65 1)` |
| A smooth curve through points | `through 20 200, 120 140, 240 190` |
| A hexagon from the library | `shape "hexagon" at 40 40 size 120` |
| Wrapped text | `text "A caption" at 40 100 size 16 box 180` |
| Letters as brush strokes | `text "Hi" at 40 40 size 32 as marks` |
| A placed image, or a linked file | `image "logo" at 40 40 size 120`, `link "assets/logo.svg" at 40 40 size 160 80` |
| A shadow under the next mark, or a sepia layer | `effect drop-shadow 4 4 8 #00000066`, or `effect sepia` then `layer "Photo"` |

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| `image "art/logo.png" at 0 0` | `image "logo" at 0 0`, with the host passing `logo` | A script reads no files: a path is `unknown-asset`. |
| Paint set inside `repeat` leaking out | Wrap the body in `push` ... `pop` | A repeat keeps nothing to itself. |
| `effect blur 2` with nothing after it | Put it right before the layer, group or mark | It waits for the next one, and `unused-effect` says none came. |
| Expecting `rough 1` to wobble differently each run | Change the seed: `seed 3`, or `--seed 3` | One script and one seed draw the same bytes every run. |
