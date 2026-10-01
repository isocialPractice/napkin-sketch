# The napkin script language

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

Napkin script says what to draw without a pointer. A person or an AI helper
writes it as text, one instruction to a line; a program in any language builds
the same thing as JSON. Both become one list of instructions, the object form,
which is what the rest of the API runs.

This page is the reference for the language itself: how a script is written,
what its values look like, how expressions work, what the diagnostics mean, and
the functions that read, check and write scripts. What each instruction draws,
and the function that runs a script, are in
[Drawing with napkin script](../drawing/README.md).

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [A script, line by line](#a-script-line-by-line)
  - [Values](#values)
  - [Expressions](#expressions)
  - [The version line](#the-version-line)
  - [The budget](#the-budget)
  - [The object form](#the-object-form)
  - [Verbs](#verbs)
  - [Diagnostics](#diagnostics)
  - [Functions](#functions)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

A drawing language small enough to learn from one page and strict enough to
check before anything runs. A script is a list of instructions such as `page`,
`layer`, `color`, `rect`, `text` and `repeat`. Each one is a verb followed by
its arguments, and every verb is described in one table, `verbs.json`, which
the parser follows and every listing of the language is generated from.

The text form is for people and for AI helpers; it reads like a list of
drawing steps and is forgiving about spacing and case. The object form is for
programs: an array of plain objects, one per instruction, each naming its
`verb`. A Python script, a C program or a shell pipeline builds the object form
as JSON and never has to produce the text syntax. The two are interchangeable:
a script read from text and the same script built as JSON come out as exactly
the same instructions.

## The mental model

```text
 text (.napkin) --parseScript-->  instructions  <--validateScript-- JSON (.napkin.json)
                                       |
                                  formatScript
                                       |
                                       v
                                 canonical text
```

| Step | Function | Takes | Gives |
| --- | --- | --- | --- |
| Read text | `parseScript(text)` | a script as text | the instructions, and what was wrong |
| Check JSON | `validateScript(value)` | a parsed JSON value | the same |
| Write text | `formatScript(script)` | instructions | the script as canonical text |

Neither reader throws. Each returns `{ ok, script, diagnostics }`: `script` holds
every instruction that was read without an error, `diagnostics` holds the
errors and warnings in reading order, and `ok` is true when there were no
errors. An instruction with an error is left out rather than half-read, so what
comes back is always a well-formed script.

## Reference

### A script, line by line

```napkin
napkin 1
page 400 300          # the page, in pixels
color #1f2328 width 3 # two paint instructions on one line
group "Figure" {
  layer "Head"
  circle 200 80 30
}
repeat 3 as i { rect (20 + i * 40) 200 30 30 }
```

- **One instruction to a line.** A newline ends an instruction, and so does
  `;`, so `line 0 0 10 10; line 10 10 20 0` is two.
- **A verb first, then its arguments.** Positional arguments come first, in
  order; keyword clauses such as `at 200 70` and flags such as `hidden` follow
  in any order. The [verb tables](#verbs) show every way of writing each verb.
- **Blocks.** A verb that holds other instructions - `group`, `define`,
  `repeat` and `path` - takes a block: `{` at the end of its line, the
  instructions, and `}`. A block can also sit on one line.
- **Paint instructions share a line.** On a line that starts with a paint verb
  (`tool`, `color`, `width`, `opacity`, `fill`, `gradient`, `stroke`, `style`,
  `profile`, `nib`, `rough`, `font`), another paint verb starts the next
  instruction. Nothing else chains, so in `layer "Sky" opacity 0.8` the
  `opacity` is the layer's own.
- **Comments.** `#` at the start of a line, or followed by a space, starts a
  comment that runs to the end of the line. `#` followed by anything else is a
  color, `#1f2328`, which is why a comment after an instruction needs its
  space.
- **Case.** Verbs, keywords and choices ignore case and are written back in
  lower case. Strings and `let` names keep theirs.
- **Hyphens.** Outside parentheses a hyphen with a letter after it joins a
  word, as in `effect drop-shadow`; inside, it is a minus, so `(a-5)` is a
  subtraction.

### Values

| Kind | Written | In JSON | Notes |
| --- | --- | --- | --- |
| Number | `12`, `-3.5`, `1e3` | `12` | Degrees for angles, clockwise. |
| Length | `120`, `10mm`, `0.5in`, `12pt`, `4px`, `50%` | `120`, `"10mm"`, `"50%"` | A bare number is in the current units. |
| Expression | `(i * 40 + 20)` | `{ "expr": "i * 40 + 20" }` | Anywhere a number or a length goes. |
| String | `"Acme Corp"` | `"Acme Corp"` | `\"`, `\\`, `\n` and `\t` are escapes. |
| Color | `#1f2328`, `steelblue`, `rgb(31, 35, 40)` | the same, as a string | Written back in lower case. |
| Name | `gap`, `row_2` | `"gap"` | For `let` and `repeat ... as`. |
| Choice | `dashed`, `a4`, `center` | `"dashed"` | One word from the verb's list. |
| Switch | `on`, `off` | `true`, `false` | |
| Points | `0 0, 10 0, 5 8` | `[{ "x": 0, "y": 0 }, ...]` | Each coordinate is a length. |
| Stops | `(#ffffff 0, #000000 1)`, `(red, blue)` | `[{ "color": "#ffffff", "offset": 0 }, ...]` | Offsets from 0 to 1, or percentages. |

**Units.** A length can carry `px`, `in`, `mm` or `pt` straight after its
number. A bare number is read in the units in force, which are pixels until a
`units` instruction changes them; the print units convert at 96 pixels to the
inch, the ratio every export uses.

**Shares of the page.** `50%` is half of the page, measured along the axis the
argument runs on: an x coordinate or a width against the page's width, a y
coordinate or a height against its height, and a size with no direction - a
radius, a stroke width, a font size - against the shorter side. A percentage is
refused where there is no page to measure it against, such as the page's own
size or a `let`.

**Strings.** Double-quoted. `\"`, `\\`, `\n` and `\t` are escapes; any other
backslash is kept as written, so `"C:\art\logo.svg"` survives. A newline in a
text item is written `\n`.

**Colors.** `#` and 3, 4, 6 or 8 hex digits; any of the 148 CSS color names;
or `rgb()`, `rgba()`, `hsl()` and `hsla()`, written with no space before the
`(`. The set is exactly what every output format can paint, the PNG included.
`none` is not a color: the verbs that accept it spell it themselves,
`background none` and `fill none`.

**Gradient stops.** A color and an offset, separated by commas inside
parentheses. Give every stop an offset, as a number from 0 to 1 or a
percentage, or give none and they are spaced evenly.

### Expressions

Anything computed goes in parentheses: `(i * 40 + 20)`, `(width / 2)`,
`(80 * cos(i * 30))`. A bare name where a number is expected is an error that
says to wrap it, `(gap)`.

- **Operators:** `+`, `-`, `*`, `/` and `%` (the remainder), with unary minus.
  Unary minus binds first, then `* / %`, then `+ -`, each from left to right.
- **Names:** a `let` value, a `repeat` counter, and the page's `width` and
  `height`, all in the current units.
- **Units inside:** `(width - 20mm)` converts the `20mm` into the current units
  before subtracting.
- **Shares of the page inside:** `(50% - 20)` works as it does outside an
  expression. A `%` right after a number is a share of the page unless a value
  follows it, so `(10%3)` and `(10 % 3)` are both the remainder, 1.
- **Functions:** trigonometry is in degrees, like every angle in the language,
  and gives exact answers at the exact angles: `sin(30)` is 0.5.

<!-- functions:start -->
| Function | Takes | Gives |
| --- | --- | --- |
| `sin` | a number | The sine of an angle in degrees. |
| `cos` | a number | The cosine of an angle in degrees. |
| `tan` | a number | The tangent of an angle in degrees. |
| `sqrt` | a number | The square root. |
| `abs` | a number | The value without its sign. |
| `round` | a number | The nearest whole number. |
| `floor` | a number | The whole number at or below. |
| `ceil` | a number | The whole number at or above. |
| `min` | 2 or more numbers | The smallest of two or more values. |
| `max` | 2 or more numbers | The largest of two or more values. |
<!-- functions:end -->

```napkin
let gap 24
repeat 12 as i {
  circle (200 + 80 * cos(i * 30)) (150 + 80 * sin(i * 30)) 6
}
rect 10mm 10mm (width - 20mm) (gap * 2)
```

An expression is checked when the script is read, so a missing operand or an
unknown function is reported at its column before anything runs. A name that
was never set, or a division by zero, can only be found when the expression
runs.

### The version line

A script's first instruction names the language version it was written for:

```napkin
napkin 1
```

Without it, version 1 is assumed and a `version-missing` warning says so. A
version newer than this build reads is a `version-unsupported` error that names
the newest it does. A version changes only when a script that ran under the old
one would run differently under the new one; a new verb or a new optional
field is an addition, and a script that uses one reports `unknown-verb` on an
older build rather than drawing something else.

A snippet that is not a whole script - an example in the documentation, a
block a program is assembling - is read with `{ fragment: true }`, and then no
`napkin` line is expected.

### The budget

One run of a script has a budget, so a loop that never ends, or a script that
would draw more than any output can hold, stops rather than hanging the
program that ran it:

<!-- limits:start -->
| Limit | Default | Counts |
| --- | --- | --- |
| `instructions` | 200,000 | Instructions run, every pass through a `repeat` counted |
| `marks` | 50,000 | Marks drawn |
| `anchors` | 250,000 | Bezier anchors, across every mark |
| `points` | 1,000,000 | Points sampled from those anchors for the canvas to paint |
| `depth` | 64 | Blocks open at once: groups and clips, placed definitions, repeats, wipes and stacks |
<!-- limits:end -->

A run that reaches a limit stops with a `budget-exceeded` error at the
instruction that crossed it, and keeps everything it drew before. Each pass
through a `repeat` costs an instruction of its own, so even an empty body
cannot spin forever. A caller that means to draw more raises a limit
deliberately: `evaluate(text, { limits: { marks: 200000 } })`.

Sampled points are the limit that matters for drawings with many curves. A
curved segment is sampled to its size, about a point a pixel and never more
than 24, so a circle of radius 14 or more comes to 97 points and a thousand of
them to 97,000.

### The object form

A script in JSON is an array of instructions. Each instruction is an object
with a `verb` and the fields that verb has; the [verb tables](#verbs) list them,
`?` marking the optional ones. This is the script from
[A script, line by line](#a-script-line-by-line), built as JSON:

```json
[
  { "verb": "napkin", "version": 1 },
  { "verb": "page", "width": 400, "height": 300 },
  { "verb": "color", "color": "#1f2328" },
  { "verb": "width", "width": 3 },
  {
    "verb": "group",
    "name": "Figure",
    "body": [
      { "verb": "layer", "name": "Head" },
      { "verb": "circle", "cx": 200, "cy": 80, "r": 30 }
    ]
  },
  {
    "verb": "repeat",
    "count": 3,
    "as": "i",
    "body": [{ "verb": "rect", "x": { "expr": "20 + i * 40" }, "y": 200, "width": 30, "height": 30 }]
  }
]
```

- **Values** are encoded as the [Values](#values) table shows: a length is a
  number, or a string when it carries a unit or a `%`; an expression is
  `{ "expr": "..." }`, its source without the parentheses.
- **Blocks** are arrays: `body` of a `group`, `clip`, `define`, `repeat`, `wipe`, `stack` or `path`.
- **`at`**, `{ "line": 3, "column": 5 }`, is where a parsed instruction came
  from. It is optional, and a program building JSON leaves it out.
- **What a form implies is a field.** `fill none` is `{ "verb": "fill",
  "fill": null }`, `rough off` is `{ "verb": "rough", "amount": 0 }`, and
  `crop auto` is `{ "verb": "crop", "mode": "auto" }`.
- **Forgiving where it is safe.** An unknown field is a warning and is left
  out on its own. A flag set to `false`, such as `"hidden": false`, and an
  optional field set to `null` mean the field is absent.
- **Canonical on the way out.** `validateScript` returns values in the form the
  text parser writes them: colors in lower case, `"10.50MM"` as `"10.5mm"`,
  expressions trimmed. A script built as JSON and the same script written as
  text therefore compare equal.
- **Always writable.** A JSON instruction whose fields together fit no way of
  writing its verb - `crop` with `mode: "auto"` and an `x` - is an
  `invalid-value` error, so every valid script can be written as text.

### Verbs

<!-- verbs:start -->
#### Document

The page: its size, background and name, the unit bare numbers are read in, the seed, and more pages.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `napkin` | `napkin <version>` | `version` | The language version the script was written for. The first line of a script; without it version 1 is assumed, with a warning. |
| `page` | `page <paper> [portrait\|landscape]`<br>`page <width> <height> [portrait\|landscape]` | `paper?, width?, height?, orientation?` | The page size: a named size (a3, a4, a5, letter, legal, tabloid, square, slide, napkin) or a width and a height, turned portrait or landscape. |
| `background` | `background <color>`<br>`background none` | `color` | The page color, or none for a transparent page. |
| `name` | `name "<name>"` | `name` | The page's name, and the file stem it is written under. |
| `units` | `units px\|in\|mm\|pt` | `units` | The unit bare numbers are read in from here on: px, in, mm or pt. Pixels until changed. |
| `seed` | `seed <n>` | `seed` | The seed for the hand-drawn pass. One script and one seed draw the same bytes every run. |
| `newpage` | `newpage ["<name>"]` | `name?` | Starts another page the same size, carrying the paint state across. |

#### Layers

Named layers and nested groups, with opacity, visibility and lock.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `layer` | `layer "<name>" [opacity <0-1>] [hidden] [locked]` | `name, opacity?, hidden?, locked?` | A drawing layer. Marks after it go on it until the next layer. |
| `group` | `group "<name>" [opacity <0-1>] [hidden] [locked] { ... }` | `name, opacity?, hidden?, locked?, body` | A group layer. The layer and group lines in its block become its children. |
| `clip` | `clip ["<name>"] { ... }` | `name?, body` | A clip group: everything its block draws shows only inside the block's last closed shape, in paint order, which paints nothing while it clips - the app's Make Clipping Mask. Without a closed shape in it, the block is a plain group. |

#### Paint

What every mark after it is drawn with: tool, color, width, opacity, fill, gradient, outline, dash, profile, nib, font, and the hand-drawn pass.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `tool` | `tool pen\|marker\|copic\|pencil\|eraser\|brush` | `tool` | The kind of mark: pen (the app's Brush; brush is taken for it), marker (translucent, so overlapping passes build up like ink), copic (a broad, angled nib), pencil (a lead through the paper's grain; pencil picks one) or eraser (cuts its line's swath out of the marks drawn before it on its layer, as the app's Eraser does, and draws nothing of its own). |
| `color` | `color <color>` | `color` | The ink color of every mark after it. |
| `width` | `width <length>` | `width` | The stroke width of every mark after it. |
| `opacity` | `opacity <0-1>` | `opacity` | The opacity of every mark after it, from 0 to 1. |
| `fill` | `fill <color>`<br>`fill none` | `fill` | The fill color of closed shapes after it, or none. |
| `gradient` | `gradient linear <angle> (<color> <offset>, ...)`<br>`gradient radial (<color> <offset>, ...)`<br>`gradient none` | `type, angle?, stops?` | A gradient fill for closed shapes after it: linear at an angle, or radial from the centre out, or none. |
| `stroke` | `stroke on\|off` | `on` | Turns the outline on or off. With it off, a closed shape is its fill alone. |
| `style` | `style solid\|dashed\|dotted` | `style` | The outline's dash: solid, dashed or dotted. |
| `profile` | `profile uniform\|rounded\|tapered\|wave` | `profile` | How the width runs along a brush or marker stroke: uniform, rounded, tapered or wave. |
| `nib` | `nib <degrees>` | `angle` | The angle of the copic nib, in degrees. |
| `pencil` | `pencil <grade> [<color>]` | `pencil, color?` | Takes up the Pencil at a grade: graphite alone, 9H to 9B, or charcoal (HB to 6B), compressed (2B to 6B) or vine (hard, medium, soft) and its grade. Every mark after it is drawn with that lead through the paper's grain, in its tone - or in the color given, a colored pencil. The width is the line's own; the app's softer leads draw broader at one tool width. |
| `rough` | `rough <0-1> [passes 1\|2] [overshoot <length>]`<br>`rough off` | `amount, passes?, overshoot?` | The hand-drawn pass for every mark after it: 0 is exact, 1 is clearly drawn by hand, and off is 0. Seeded, so it draws the same way every run. |
| `font` | `font "<family>" [<size>]`<br>`font <size>` | `family?, size?` | The font family and size of text after it. |

#### Shapes

Marks built from Bezier anchors: rectangles, circles, ellipses, lines, polygons, stars, arcs, spirals and the shape library, and marks combined as the Wipe Stacks and the Shape Stacker combine them.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `rect` | `rect <x> <y> <width> <height> [r <radius>]` | `x, y, width, height, radius?` | A rectangle, with rounded corners when r is given. |
| `circle` | `circle <cx> <cy> <r>` | `cx, cy, r` | A circle, drawn as four cubic curves rather than a polygon. |
| `ellipse` | `ellipse <cx> <cy> <rx> <ry>` | `cx, cy, rx, ry` | An ellipse, from its centre and two radii. |
| `line` | `line <x1> <y1> <x2> <y2>` | `x1, y1, x2, y2` | A straight line between two points. |
| `polygon` | `polygon <x> <y>, <x> <y>, ... [r <radius>]` | `points, radius?` | A closed shape through a list of points, with rounded corners when r is given. |
| `polyline` | `polyline <x> <y>, <x> <y>, ...` | `points` | An open line through a list of points. |
| `star` | `star <cx> <cy> <outer> <inner> <count>` | `cx, cy, outer, inner, count` | A star with the given number of points, between an outer and an inner radius. |
| `arc` | `arc <cx> <cy> <r> <from> <to>` | `cx, cy, r, from, to` | An open arc of a circle between two angles, in degrees clockwise from three o'clock. |
| `spiral` | `spiral <cx> <cy> <r> <turns>` | `cx, cy, r, turns` | A spiral winding out from its centre to the radius over the given number of turns. |
| `shape` | `shape "<name>" at <x> <y> size <width> [<height>]` | `name, x, y, width, height?` | A named shape from the built-in library, drawn in a box from x, y. With one size its longer side is that long and it keeps its proportions; with a width and a height it is stretched to fill them. |
| `wipe` | `wipe in\|out-front\|out-back\|mid\|outer\|clean { ... }` | `op, body` | Combines the marks its block draws, as the app's Wipe Stacks do, and draws what is left in their place: in (Wipe In, their union), out-front (Subtract Top from Below: the bottom one less the rest), out-back (Subtract Below from Top: the top one less the rest), mid (Mid Wipe: where all of them overlap), outer (Outer Wipes: where an odd number overlap) or clean (Clean Wipe: every piece of their overlaps, a mark each). What is left is painted as the topmost mark, or as the bottom one for out-front; text, pictures and eraser marks in the block are passed over. The block keeps its paint and transforms to itself, as a group does, and effects written just before it go on what it leaves. |
| `stack` | `stack merge\|remove <points> { ... }` | `mode, points, body` | Stacks the marks its block draws as the app's Shape Stacker does, at the pieces under its points - the places where the marks overlap and where they do not: merge makes those pieces one shape, painted as the topmost mark over the first point, and each mark keeps what was not merged; remove takes them away from every mark. Text, pictures and eraser marks in the block are passed over. The block keeps its paint and transforms to itself, as a group does, and the points are where the stack line is. |

#### Paths

Marks written segment by segment, from SVG path data or from a block of steps, curves through points, and paths cut where a point lands on them.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `path` | `path "<svg path data>"`<br>`path { ... }` | `d?, body?` | One mark, from SVG path data or from a block of path steps. Each subpath of a compound path is one piece of the same mark. |
| `move` | `move <x> <y>` | `x, y` | Starts a new subpath at a point. |
| `to` | `to <x> <y>` | `x, y` | A straight segment to a point. |
| `by` | `by <dx> <dy>` | `dx, dy` | A straight segment by an offset from the current point. |
| `curve` | `curve <c1x> <c1y> <c2x> <c2y> <x> <y>` | `c1x, c1y, c2x, c2y, x, y` | A cubic curve to a point, steered by two handles. |
| `smooth` | `smooth <c2x> <c2y> <x> <y>` | `c2x, c2y, x, y` | A cubic curve whose first handle mirrors the last one, so the join stays smooth. |
| `through` | `through <x> <y>, <x> <y>, ...` | `points` | A smooth curve through a list of points. Inside a path block it continues the subpath; outside one it is an open mark of its own. |
| `close` | `close` | `none` | Closes the current subpath back to its start. |
| `split` | `split <x> <y>` | `x, y` | Cuts the topmost mark drawn so far whose path passes within 4 px of a point, where the point lands on it, as the app's Split does: an open path becomes two, a closed one opens there, and a compound shape gives up the ring that was cut, as an open mark of its own. Nothing moves, and the pieces take the mark's place on its layer. In a wipe or a stack block it cuts among the marks the block has drawn. |
| `smear` | `smear <width> <strength> <x> <y>, <x> <y>, ...` | `width, strength, points` | A pass of the Smear, a blending stump, along a list of points: it spreads the graphite of every pencil mark drawn so far that it reaches, along the drag, as the app's Smear does. The width is the stump's, scaled by the transform as a width is, and the strength from 0 to 1. In a wipe or a stack block it smears among the marks the block has drawn. |
| `warp` | `warp <x> <y> <radius> <dx> <dy>` | `x, y, radius, dx, dy` | Liquify's Warp, as the app's Liquify does it: a brush pushed from the point by dx and dy, carrying what is under its centre the whole way, like clay. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| `twirl` | `twirl <x> <y> <radius> <degrees>` | `x, y, radius, amount` | Liquify's Twirl: turns what is under a brush at the point about its centre, by the angle in degrees there - clockwise on the screen, as rotate turns - and less toward the rim, so distances from the centre are kept. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| `pucker` | `pucker <x> <y> <radius> <amount>` | `x, y, radius, amount` | Liquify's Pucker: draws what is under a brush at the point in toward its centre, a point near the centre by the amount, 0 to 1, of its distance. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |
| `bloat` | `bloat <x> <y> <radius> <amount>` | `x, y, radius, amount` | Liquify's Bloat: pushes what is under a brush at the point out from its centre, a point near the centre by the amount, 0 to 1, of its distance. The brush reaches the marks drawn so far whose outline passes within its radius of the point, under the transform as a mark drawn there would be, and its effect falls off smoothly to nothing at the rim; the radius scales with the transform. Pencil marks are the Smear's, and text, pictures and eraser marks have no outline to bend: all are left as they are. Each mark it bends is fitted again after, so its anchors stay few. In a wipe or a stack block it bends among the marks the block has drawn. |

#### Transforms

Translate, rotate, scale and mirror, baked into the anchors of every mark after them, with push and pop to undo them.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `push` | `push` | `none` | Saves the transform, the paint state and the units, for the next pop to restore. |
| `pop` | `pop` | `none` | Restores the transform, the paint state and the units the last push saved. |
| `translate` | `translate <dx> <dy>` | `dx, dy` | Moves everything drawn after it. |
| `rotate` | `rotate <degrees> [at <x> <y>]` | `angle, cx?, cy?` | Turns everything drawn after it, clockwise in degrees, about the origin or a point given with at. |
| `scale` | `scale <s> [<sy>] [at <x> <y>]` | `sx, sy?, cx?, cy?` | Scales everything drawn after it, about the origin or a point given with at. One factor scales both ways. |
| `mirror` | `mirror x\|y [at <position>]` | `axis, about?` | Reflects everything drawn after it: x swaps left and right across a vertical line, y swaps top and bottom across a horizontal one, at 0 unless given. |

#### Control

Named numbers, reusable definitions, and repetition.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `let` | `let <name> <value>` | `name, value` | Names a number for the expressions after it, in the current units. |
| `define` | `define "<name>" { ... }` | `name, body` | Records a block of drawing under a name without drawing it, for place to draw. |
| `place` | `place "<name>" [at <x> <y>] [scale <s>] [rotate <degrees>]` | `name, x?, y?, scale?, rotate?` | Draws a definition, moved, scaled or turned. |
| `repeat` | `repeat <count> [as <name>] { ... }` | `count, as?, body` | Runs a block a number of times, counting from 0 in the name given with as. |

#### Text and media

Text, placed images, linked files, and documents the host supplied.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `text` | `text "<text>" at <x> <y> [size <size>] [box <width>] [align left\|center\|right] [as marks]` | `text, x, y, size?, box?, align?, asMarks?` | A text item, measured and aligned, and editable in the app. With as marks the letters are drawn as brush strokes instead. |
| `image` | `image "<asset or data URL>" at <x> <y> [size <width> [<height>]]` | `src, x, y, width?, height?` | Places an image: an asset the host supplied, by name, or a data URL. Nothing is read from disk. |
| `link` | `link "<path>" at <x> <y> [size <width> [<height>]] [name "<layer name>"]` | `href, x, y, width?, height?, name?` | Places a linked file: one selectable element that references the file instead of drawing its contents into the page. |
| `use` | `use "<document>" [at <x> <y>] [scale <s>] [layer "<name>"]` | `name, x?, y?, scale?, layer?` | Copies in a document the host supplied, as a group, with its layers and anchors. |

#### Effects

Blur, shadow and color effects for the next layer, group or mark, as CSS filter functions are: drawn in SVG, in PNG and in the app, and left out of a PDF.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `effect` | `effect blur <radius>`<br>`effect brightness <amount>`<br>`effect contrast <amount>`<br>`effect saturate <amount>`<br>`effect grayscale [<0-1>]`<br>`effect sepia [<0-1>]`<br>`effect invert [<0-1>]`<br>`effect hue-rotate <degrees>`<br>`effect opacity <0-1>`<br>`effect drop-shadow <dx> <dy> <blur> <color>`<br>`effect none` | `type, radius?, amount?, angle?, dx?, dy?, blur?, color?` | An effect for the next layer, group or mark the script makes, as its CSS filter function works: blur, brightness, contrast, saturate, grayscale, sepia, invert, hue-rotate, opacity or drop-shadow. Several stack in order, and none clears what is waiting. |

#### Output

Hints the renderers read: the box every output is cut to, and one box every page shares.

| Verb | Written | Fields in JSON | What it does |
| --- | --- | --- | --- |
| `crop` | `crop auto [pad <length>]`<br>`crop none`<br>`crop <x> <y> <width> <height>` | `mode, pad?, x?, y?, width?, height?` | The box every output is cut to: auto fits the ink with room to spare, none keeps the page, or a box given outright. |
| `registration` | `registration <x> <y> <width> <height>` | `x, y, width, height` | One box every page is written in, so frames drawn by one script line up when they are played in sequence. |
<!-- verbs:end -->

### Diagnostics

A diagnostic is `{ level, code, message, line?, column?, index?, verb?,
expected? }`. Text scripts point at a `line` and `column`, both 1-based; JSON
scripts point at an `index` path, `[3, 0]` being the first instruction in the
body of the fourth. A program matches on `code`, which is never renamed or
reused. The `message` is one sentence for a person and may change.

Printed with `formatDiagnostic`, a diagnostic takes the shape editors and CI
parsers already read:

```text
card.napkin:3:1: error unknown-verb: `circl` is not a verb. Did you mean `circle`?
card.napkin.json[1][0]: error expected-length: `x` of `rect` at [1][0]: `ten` is not a length, such as `120`, `"10mm"` or `"50%"`.
```

<!-- diagnostics:start -->
| Code | Level | Meaning |
| --- | --- | --- |
| `unknown-verb` | error | A line starts with a word that is not a verb. |
| `misplaced-verb` | error | A verb where it cannot appear: a path step outside a path block, a napkin line after the first, a layer inside a path, a newpage inside a group or a definition, a layer, group, clip or use inside a wipe or a stack. |
| `unsupported-verb` | error | The verb, or this way of writing it, is known but not drawn by this build or by the host running the script; the instruction is skipped. |
| `expected-number` | error | A number, or an expression in parentheses, was expected. |
| `expected-length` | error | A length was expected: a number, a number with a unit (10mm, 0.5in, 12pt, 4px), a percentage, or an expression. |
| `expected-string` | error | A double-quoted string was expected. |
| `expected-identifier` | error | A bare name was expected: letters, digits and underscores, starting with a letter. |
| `expected-color` | error | A CSS color was expected, such as #1f2328, red or rgb(31, 35, 40). |
| `expected-choice` | error | One word from a fixed list was expected; the message lists them. |
| `expected-points` | error | A list of points was expected: x y pairs separated by commas. |
| `expected-stops` | error | A list of gradient stops was expected: (color offset, color offset, ...). |
| `unexpected-token` | error | Something is left on the line after the instruction was read, or a character that cannot start anything. |
| `missing-argument` | error | A required argument is missing; the message names it and shows how the verb is written. |
| `expected-block` | error | A block was expected: { at the end of the line, the instructions it holds, and } to close it. |
| `unclosed-block` | error | A block opened with { is never closed with }. |
| `unexpected-close` | error | A } closes a block that was never opened. |
| `unclosed-string` | error | A string runs to the end of the line without its closing quote. |
| `invalid-expression` | error | An expression could not be read: an unknown operator, a missing operand, or an unclosed parenthesis. |
| `unit-unknown` | error | A number carries a unit the language does not know. The units are px, in, mm and pt, and % for a share of the page. |
| `invalid-value` | error | A value is out of range: an opacity above 1, a negative radius, a star with fewer than 2 points, a percentage where the page cannot measure one. |
| `version-missing` | warning | The script does not start with napkin <version>; version 1 is assumed. |
| `version-unsupported` | error | The script names a version newer than this build reads; the message names the newest it does. |
| `unknown-variable` | error | An expression uses a name no let or repeat has set. |
| `unknown-definition` | error | place names something no define recorded. |
| `unknown-shape` | error | shape names something the shape library does not have. |
| `unknown-asset` | error | image names an asset the host did not supply. |
| `unknown-document` | error | use names a document the host did not supply. |
| `image-size-unknown` | warning | An image's size cannot be read from its data, so it is placed square: 100 by 100, or the one size given by itself. |
| `glyph-missing` | warning | text as marks has a character the built-in face does not draw; it is left as a gap. |
| `unknown-field` | warning | An instruction in a JSON script has a field its verb does not have; it is left out. |
| `recursive-definition` | error | A definition places itself, directly or through another definition. |
| `division-by-zero` | error | An expression divides by zero. |
| `budget-exceeded` | error | The script ran more instructions, drew more marks, emitted more anchors or sampled points, or nested deeper than the limit allows; what it drew up to that point is kept. |
| `pop-without-push` | error | pop with nothing saved to restore. |
| `unbalanced-push` | warning | A push is never popped before its block ends; the saved state is restored there anyway. |
| `duplicate-definition` | warning | A second define replaces an earlier one of the same name. |
| `link-unresolved` | warning | A linked file could not be read for an output that has to draw it, so its placeholder was drawn instead. |
| `unused-effect` | warning | An effect nothing took: no layer, group or mark followed it before its block, its page or the script ended. |
| `wipe-skipped` | warning | A wipe's or a stack's block drew marks it cannot combine - text, pictures, linked files, eraser marks - and they are drawn as they are. |
| `wipe-empty` | warning | A wipe or a stack left nothing: out-front's bottom mark wholly covered by the rest, say, or a stack remove taking every piece. |
| `wipe-failed` | warning | A wipe or a stack could not combine its block's marks - fewer than two it can combine, more than it takes, or geometry it could not make - so they are drawn as they are. |
| `stack-missed` | warning | A stack point is on none of the pieces its block's marks make, so it picks nothing; the message says which. |
| `split-missed` | warning | A split point is within 4 px of no path drawn so far, or lands on the end of an open one, so nothing is cut. |
| `clip-open` | warning | A clip block drew no closed shape to clip with, so it is a plain group. |
| `smear-missed` | warning | A smear reaches no pencil mark drawn so far, so it spreads nothing. |
| `liquify-missed` | warning | A warp, twirl, pucker or bloat reaches no mark it bends drawn so far, so it bends nothing. |
| `erase-skipped` | warning | An eraser line reaches text or a picture, which it cannot cut, and passes over it. |
<!-- diagnostics:end -->

### Functions

Exported from `napkin-sketch`, the package's browser-safe entry, and DOM-free;
the source is `src/core/script/index.ts`.

```ts
parseScript(text: string, options?: { fragment?: boolean }): ParseResult
validateScript(value: unknown, options?: { fragment?: boolean }): ParseResult
formatScript(script: Instruction[], options?: { indent?: string; comments?: Map<object, string[]> }): string

interface ParseResult {
  ok: boolean;               // no errors: every instruction is in `script`
  script: Script;            // the instructions that were read
  diagnostics: Diagnostic[]; // errors and warnings, in reading order
}

parseExpression(source: string): ExprParse   // { ok: true, node } or { ok: false, code, message, index }
evaluateExpression(node: ExprNode, scope: ExprScope): number   // throws ExpressionError
formatDiagnostic(diagnostic: Diagnostic, file?: string): string
```

`formatScript` throws on an instruction it cannot write, which only an
unchecked script can contain; check a script built by hand with
`validateScript` first. `comments` puts `#` lines before chosen
instructions, keyed by the instruction object itself and written at its
indent, inside a block too; the parser skips them, as it skips every comment. The verb table itself is exported as `VERBS`, with
`verbSpec(name)` to look one verb up.

## Worked examples

**Reading a script with mistakes.** Every mistake is reported, each at its line
and column, and the instructions without one are still read:

```napkin-error
# expect: unknown-verb, missing-argument, expected-length
napkin 1
circl 50 50 10
rect 0 0 10
color #1f2328 width three
line 0 0 10 10
```

```text
card.napkin:3:1: error unknown-verb: `circl` is not a verb. Did you mean `circle`?
card.napkin:4:12: error missing-argument: `rect` needs `height`: rect <x> <y> <width> <height> [r <radius>].
card.napkin:5:21: error expected-length: `width` takes a length, such as `120`, `10mm` or `50%`, and got `three`. To use a name, write it in parentheses: `(three)`.
```

That is what printing each diagnostic gives. The script that comes back holds
`napkin`, `color` and `line`, and `ok` is false:

```ts
import { formatDiagnostic, parseScript } from 'napkin-sketch';

const { ok, script, diagnostics } = parseScript(text);
for (const d of diagnostics) console.error(formatDiagnostic(d, 'card.napkin'));
```

**Building a script in another language.** A program writes JSON and hands it
over; nothing in it has to know the text syntax. From Python:

```python
import json

script = [{"verb": "napkin", "version": 1}, {"verb": "page", "paper": "slide"}]
for i in range(5):
    script.append({"verb": "rect", "x": {"expr": f"80 + {i} * 360"}, "y": 400, "width": 300, "height": 200})

with open("deck.napkin.json", "w") as f:
    json.dump(script, f)
```

Read back, it validates to the same instructions as the text it corresponds to,
and `formatScript` writes that text:

```napkin
napkin 1
page slide
rect (80 + 0 * 360) 400 300 200
```

## Limits

- **No verb reads a file.** An `image` names an asset the host supplied or
  carries a data URL, and a `link` records a path the host resolves. A script
  cannot open anything on its own.
- **Expressions are numbers.** There are no strings, comparisons or conditions
  in an expression, and no loop but `repeat`.
- **A comment after an instruction needs its space.** `rect 0 0 10 10 #add`
  reads `#add` as a color.
- **One color model.** Hex, the CSS names and the `rgb` and `hsl` functions.
  `currentColor`, `color()` and the newer CSS color spaces are not accepted,
  because not every output can paint them.
- **Keywords are English.** Verbs, clauses and choices are fixed words.

## For agents

- **Write one instruction to a line**, verb first, and check the verb tables
  for the exact spelling of each form. `formatScript` shows the canonical
  spelling of anything you are unsure of.
- **Match diagnostics on `code`, never on `message`.** Codes are stable;
  messages are for people and may be reworded.
- **Most errors are a one-token fix.** `expected-*`, `missing-argument`,
  `unit-unknown`, and `unknown-verb` with a suggestion name the exact token and
  what would be accepted there. `unclosed-block` and `unexpected-close` mean the
  braces are unbalanced; count them rather than editing the line reported.
- **Fix every error before running.** An instruction with an error is left out,
  so a script that is not `ok` draws less than it says.
- **Read snippets with `{ fragment: true }`** so a missing `napkin` line is not
  reported.
- **Prefer JSON when a program builds the script**, and text when a person will
  read it. They are the same instructions either way.

## See also

- [Drawing with napkin script](../drawing/README.md): running a script, and what
  each instruction draws.
- [Writing a drawing out](../output/README.md): the formats, and what `crop` and
  `registration` do to them.
- [The napkin-sketch command line](../cli/README.md): `check` a script, `draw`
  it, and `verbs` for this page's tables as JSON.
- [`src/core/script/verbs.json`](../../../src/core/script/verbs.json): the verb
  table every listing on this page is generated from.
- [`src/core/script/instructions.ts`](../../../src/core/script/instructions.ts):
  the object form's types.
- [The graphic design API](../compose/README.md): the composition API.
