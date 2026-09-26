# Drawing with napkin script: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

A napkin script runs into a sketch book of pages, layers and marks - the same
drawing the app makes by hand - and this is the path from a script to the
picture it draws, from a shell and from code.

## The whole thing in five steps

1. Build the clone and put `napkin-sketch` on your PATH:

```bash
npm install
npm run build
npm link
```

2. Save this as `badge.napkin`. Each `layer` line starts a layer, and the paint
   line sets the ink, the width and the fill for every mark after it:

```napkin
napkin 1
page 320 240
name "badge"
background #ffffff
layer "Plate"
color #1f2328 width 3 fill #ffe08a
rect 20 20 280 200 r 24
layer "Star"
fill #ff8a65
star 160 110 60 26 5
layer "Words"
text "Acme Corp" at 160 180 size 20 align center
```

3. Draw it. This writes `badge.svg` and `badge.png` beside the script:

```bash
napkin-sketch draw badge.napkin --to svg,png
```

4. Add `seed 7` and `rough 0.6` after the `page` line and draw again: every
   mark after `rough` is drawn as a hand would, and the seed makes it the same
   hand on every run.

5. Draw it from code instead. Save this as `badge.mjs` in the clone and run
   `node badge.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, renderSketch } from 'napkin-sketch';

const { ok, book, diagnostics, output } = evaluate(readFileSync('badge.napkin', 'utf8'));
writeFileSync('badge.svg', renderSketch(book.sketches[0], output));
writeFileSync('badge.png', renderSketch(book.sketches[0], { format: 'png', ...output }));
console.log(ok ? 'drew badge' : diagnostics);
```

## A worked example

A curve through five points, a sun drawn by hand, and a row of dots from a
`repeat`:

```napkin
napkin 1
page 480 240
name "hills"
seed 7
background #ffffff
layer "Hills"
color #326478 width 3
through 20 200, 120 140, 240 190, 360 130, 460 180
layer "Sun"
rough 0.6
color #c0392b fill #ffe08a
circle 380 70 40
layer "Dots"
rough off
fill #1f2328
repeat 5 as i {
  circle (40 + i * 30) 40 6
}
```

`through` puts an anchor at each point and runs the curve smoothly between
them. The dots keep the sun's red ink: paint carries to every mark after it
until something changes it, and `rough off` turns only the hand-drawn pass
off. Put the dots' paint in a `group`, or between `push` and `pop`, to keep it
to them.

## Where to go next

- [Running a script](README.md#running-a-script): `evaluate`'s options and
  result.
- [Paint](README.md#paint) and [Transforms](README.md#transforms): what carries
  from one instruction to the next.
- [Shapes](README.md#shapes), [the shape library](README.md#the-shape-library)
  and [Paths](README.md#paths): every outline.
- [The hand-drawn pass](README.md#the-hand-drawn-pass): what `rough` changes,
  and by how much.
- [Text](README.md#text), [Images](README.md#images) and
  [Linked graphics](README.md#linked-graphics): what is placed rather than
  drawn.
- [Effects](README.md#effects): a blur, a shadow or a color shift for the next
  layer, group or mark.
- [Writing a drawing out](../output/QUICKSTART.md): every format, and the box
  it is cut to.
