---
name: napkin-script
description: 'Write napkin scripts - the drawing language of napkin-sketch - that the parser accepts the first time. Use when a request asks for a drawing, diagram, flowchart, chart, card, badge, icon or layout made with napkin-sketch; when `napkin-sketch draw --prompt` or the `/scripting:draw` command hands over a form in `_temp/script-form.txt`; when a `.napkin` file has to be written, extended, or fixed from its diagnostics; or when a drawing has to come out as SVG, PNG, PDF, a `.skbk` the app opens, or an Illustrator script. Covers the two rules the parser holds a script to, pages and layers, paint, shapes, paths, text, images and links, repeat and define, transforms and units, the diagnostic codes and what each asks for, and three complete scripts to start from.'
---

# Napkin script

A napkin script says what to draw, one instruction a line, and
`napkin-sketch draw card.napkin` turns it into files with no window: SVG,
PNG, PDF, a `.skbk` the app opens with its layers, or an Illustrator script.
What it draws is the same pages, layers and Bezier anchors the app draws by
hand, so a script's drawing can be opened and edited like any other.

Every verb, every way of writing it, and a line that runs for each is in
[`references/verbs.md`](references/verbs.md), which is generated from the
verb table the parser reads. When this page and that one disagree, that one is
right.

## When to use this skill

- A request for a drawing that napkin-sketch should make: a flowchart, a chart,
  a card, a badge, a diagram, an icon, a page layout.
- A form in `_temp/script-form.txt`, from `napkin-sketch draw --prompt` or the
  `/scripting:draw` command. The form is the request; see
  [Answering a form](#answering-a-form).
- A `.napkin` file to write, to extend, or to fix from what
  `napkin-sketch check` reported.

## The two rules

The parser holds every script to these, and most first-try errors break one.

1. **One instruction a line.** The verb first, then its arguments. Paint verbs -
   `color`, `width`, `opacity`, `fill`, `stroke`, `style` and the rest - may
   share a line, as in `color #1f2328 width 3 fill #ffe08a`; nothing else may.
2. **Names in double quotes.** A layer, a group, a page's name, text, a font, a
   definition, a library shape, an image and a file are all strings:
   `layer "Boxes"`, `text "Start" at 60 40`, `shape "cube-isometric" at 20 20 size 120`.

## How a script is put together

- **`napkin 1` first**, then `page 640 360` - a width and a height in pixels -
  or a paper size, `page a4 landscape`. `name "flowchart"` names the page, and
  the files are written under that name.
- **Coordinates are pixels from the top-left corner**, y running down. Any
  number may be a unit (`10mm`, `0.5in`, `12pt`), a share of the page (`50%`),
  or an expression in parentheses: `(i * 90 + 40)`. `let gap 24` names a
  number for the expressions after it.
- **Paint is state.** `color`, `width`, `fill` and the others hold for
  everything drawn after them until they are changed; `fill none` stops
  filling, `stroke off` drops the outline.
- **Layers hold marks.** `layer "Boxes"` starts a layer, and what follows draws
  on it; `group "Seal" { ... }` holds layers. Name each layer after what it
  holds, and give text, arrows and shapes their own.
- **Shapes**: `rect <x> <y> <width> <height> [r <radius>]`,
  `circle <cx> <cy> <r>`, `ellipse`, `line`, `polygon` and `polyline` over
  points written `x y, x y, x y`, `star`, `arc`, `spiral`, and the shape
  library, `shape "<name>" at <x> <y> size <width>`, whose names -
  `hexagon`, `cube-isometric` and the rest - `references/verbs.md` lists.
- **Paths**: `path "<SVG path data>"`, or `path { ... }` holding its steps -
  `move`, `to`, `by`, `curve`, `smooth`, `through` and `close` - one a line.
- **Text**: `text "<words>" at <x> <y> [size <n>] [box <width>] [align center]`.
  `x y` is the top-left of the text, or the top-centre with `align center`.
  `font "<family>" <size>` sets the face for what follows; `box` wraps.
- **Repeats and parts**: `repeat 4 as i { ... }` counts `i` from 0;
  `define "<name>" { ... }` records a part, and `place "<name>" at <x> <y>`
  draws it.
- **Transforms**: `push` and `pop` around `translate`, `rotate <degrees> at <x> <y>`,
  `scale` and `mirror`, which apply to what is drawn after them.
- **Looks**: `rough 0.5` for a hand-drawn line, `rough off` to stop;
  `effect drop-shadow 2 3 4 #00000044` before a layer, a group or a mark.
- **Output**: `crop auto pad 12` cuts every file to the ink with room around it.

## Laying out a page

- **Size the page to what it holds**, with a margin of 24 to 40 pixels, and
  keep every mark on it.
- **Work on a grid.** Pick the columns and rows first, then compute positions
  from them - a `let` or an expression is clearer than a column of numbers.
- **Centre text in a box** with `align center` at the box's centre x, and y
  at the box's middle less 0.625 times the text's size: a line is a size and a
  quarter tall, and `y` is its top.
- **Few colors**: an ink (`#1f2328`), one accent, one light fill, and the
  background. Every extra color has to earn its place.
- **An arrow** is a `line` and a small filled `polygon` for its head, the head's
  tip on the target's edge.

## Checking a script

`napkin-sketch check card.napkin` reads and runs a script and reports what is
wrong, each line `card.napkin:3:1: error unknown-verb: ...`; `--json` gives the
same as data. A warning alone still draws.

| Code | What it asks for |
| --- | --- |
| `unknown-verb` | A verb that is not in the table: often another tool's word. Pick one from `references/verbs.md`. |
| `expected-string` | A name without quotes. Quote it. |
| `unexpected-token` | Something left on the line: two instructions on one line, or a stray word. Split it. |
| `missing-argument` | An argument left out; the message shows how the verb is written. |
| `expected-number`, `expected-length`, `expected-color`, `expected-points` | An argument of the wrong kind. Points are `x y` pairs with commas between them. |
| `unclosed-string`, `unclosed-block` | A missing `"` or `}`. |
| `unknown-asset`, `unknown-document` | An image or a document the host did not hand over. Draw it instead. |
| `unknown-shape`, `unknown-definition`, `unknown-variable` | A library shape, a `define` or a `let` name that is not there: check the spelling, or define it first. |
| `version-missing` | No `napkin 1` on the first line. A warning, but add it. |

## Answering a form

`napkin-sketch draw --prompt "<request>"` writes a form to
`_temp/script-form.txt` in the working folder and runs the AI tool there. The
form holds the request, the rules above, and the images and documents the host
hands over.

- **Save the script, and only the script**, to `_temp/script-out.napkin`: no
  prose around it and no code fences. napkin-sketch reads that file when the
  tool is done.
- **Decide what the request leaves open** - a size, a color, a label - and
  write the script. Nobody is there to answer a question.
- **A second try carries the first one's diagnostics** and the script they came
  from. Fix every line they name, keep what works, and save the whole script
  again.
- **Reply with one line**, such as `saved _temp/script-out.napkin`.

The full contract - the files, what a script must be, and what each failure
means - is `instructions/napkin-script.instructions.md` in this helper.

## Three complete scripts

Each checks clean as written. Start from the nearest one.

**A three-box flowchart with arrows.** Boxes, their labels and the arrows on
layers of their own; each arrow a line and a filled head whose tip meets the
next box:

```napkin
napkin 1
page 640 240
name "flowchart"
background #ffffff
layer "Boxes"
color #1f2328 width 2 fill #e8f1fb
rect 40 80 140 80 r 10
rect 250 80 140 80 r 10
rect 460 80 140 80 r 10
layer "Labels"
font "Arial" 20
text "Plan" at 110 108 align center
text "Build" at 320 108 align center
text "Ship" at 530 108 align center
layer "Arrows"
color #326478 width 3 fill #326478
line 180 120 238 120
polygon 236 110, 250 120, 236 130
line 390 120 448 120
polygon 446 110, 460 120, 446 130
```

**A badge.** A card, two lines of text at two sizes, and a seal made of two
layers in a group:

```napkin
napkin 1
page 400 240
name "badge"
background #fcfaf5
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 200 r 16
layer "Title"
font "Arial" 32
text "Acme Corp" at 200 60 align center
font 16
text "Visitor pass" at 200 110 align center
group "Seal" {
  layer "Ring"
  color #326478 width 2 fill #ffffff
  circle 320 170 30
  layer "Star"
  fill #326478
  star 320 170 18 8 5
}
```

**A bar chart with a trend.** Axes, four bars from one `repeat`, a smooth line
through their tops, and a title:

```napkin
napkin 1
page 480 300
name "chart"
background #ffffff
layer "Axes"
color #1f2328 width 2
line 60 40 60 250
line 60 250 440 250
layer "Bars"
color #1f2328 width 1 fill #326478
repeat 4 as i {
  rect (90 + i * 90) (200 - i * 45) 50 (50 + i * 45)
}
layer "Trend"
color #d1495b width 3 fill none
path {
  move 115 190
  through 205 145, 295 100, 385 55
}
layer "Title"
color #1f2328
font "Arial" 20
text "Signups by quarter" at 250 12 align center
```

## Never

- Invent a verb, or write SVG, CSS or another tool's syntax: the parser reads
  napkin script only.
- Name an image, a document or a linked file the host did not hand over.
- Put two instructions on one line, other than paint.
- Leave a name unquoted.
