# The napkin script language: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

Napkin script says what to draw in words, one instruction a line, and a program
in any language builds the same script as JSON; this is the path from nothing
to a script that checks clean in both forms.

## The whole thing in five steps

1. Build the clone and put `napkin-sketch` on your PATH:

```bash
npm install
npm run build
npm link
```

2. Save this as `card.napkin`:

```napkin
napkin 1
page 400 300
name "card"
background #fcfaf5
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 260 r 16
text "Acme Corp" at 200 120 size 32 align center
```

3. Check it. It prints `card.napkin: no problems` and exits with code 0:

```bash
napkin-sketch check card.napkin
```

4. Misspell `rect` as `rct` on line 7 and check again. The report names the
   line and column, the code and the fix, and the exit code is 2:

```text
card.napkin:7:1: error unknown-verb: `rct` is not a verb. Did you mean `rect`?
card.napkin: 1 error, 0 warnings
```

5. Put `rect` back, and save the same script as JSON in `card.json`, the form a
   program builds instead of text. `napkin-sketch check card.json` reads it the
   same way:

```json
[
  { "verb": "napkin", "version": 1 },
  { "verb": "page", "width": 400, "height": 300 },
  { "verb": "name", "name": "card" },
  { "verb": "background", "color": "#fcfaf5" },
  { "verb": "layer", "name": "Card" },
  { "verb": "color", "color": "#1f2328" },
  { "verb": "width", "width": 3 },
  { "verb": "fill", "fill": "#ffe08a" },
  { "verb": "rect", "x": 20, "y": 20, "width": 360, "height": 260, "radius": 16 },
  { "verb": "text", "text": "Acme Corp", "x": 200, "y": 120, "size": 32, "align": "center" }
]
```

## A worked example

Four tiles spaced by a `let`, laid out by a `repeat`, and a dot centred with
the page's own `width`. Anything computed goes in parentheses, and so does a
name used where a number goes:

```napkin
napkin 1
page 400 200
name "tiles"
let gap 20
let size ((width - 5 * gap) / 4)
color #1f2328 width 2 fill #ffe08a
repeat 4 as i {
  rect (gap + i * (size + gap)) 40 (size) (size) r 8
}
fill #326478
circle (width / 2) 170 (gap / 2)
```

In JSON, an expression is `{ "expr": "..." }` and a block is `body`:

```json
[
  { "verb": "napkin", "version": 1 },
  { "verb": "page", "width": 400, "height": 200 },
  { "verb": "let", "name": "gap", "value": 20 },
  {
    "verb": "repeat",
    "count": 4,
    "as": "i",
    "body": [{ "verb": "rect", "x": { "expr": "gap + i * 80" }, "y": 40, "width": 60, "height": 60, "radius": 8 }]
  }
]
```

`napkin-sketch draw tiles.napkin --to png` draws it.

## Where to go next

- [A script, line by line](README.md#a-script-line-by-line): lines, blocks,
  comments, and which verbs share a line.
- [Values](README.md#values) and [Expressions](README.md#expressions): units,
  shares of the page, colors, and the functions.
- [The object form](README.md#the-object-form): the JSON a program builds, and
  [the schema](../schema/instructions.schema.json) to check it against.
- [Diagnostics](README.md#diagnostics): every code, and what it means.
- [Drawing with napkin script](../drawing/QUICKSTART.md): what the verbs draw.
- [The cheatsheet](CHEATSHEET.md): every verb on one line.
