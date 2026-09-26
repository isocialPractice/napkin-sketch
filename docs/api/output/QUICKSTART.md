# Writing a drawing out: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

One call writes a drawing as SVG, PNG, PDF, a `.skbk` the app opens or an
Illustrator script, cut to the page, to the ink or to a box you name; this is
the path from a script to all five files.

## The whole thing in four steps

1. Build the clone:

```bash
npm install
npm run build
```

2. Save this as `sticker.napkin` in the clone. `crop auto pad 12` cuts every
   output to the ink, with 12 pixels of room around it:

```napkin
napkin 1
page 400 300
name "sticker"
layer "Sticker"
color #1f2328 width 3 fill #ffe08a
circle 200 150 60
crop auto pad 12
```

3. Save this as `write.mjs` beside it. Spreading `output` into the options is
   what applies the script's `crop`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, renderBook } from 'napkin-sketch';

const { book, output } = evaluate(readFileSync('sticker.napkin', 'utf8'));
const [svg] = renderBook(book, { format: 'svg', ...output });
const [png] = renderBook(book, { format: 'png', scale: 2, transparent: true, ...output });
writeFileSync('sticker.svg', svg);
writeFileSync('sticker.png', png);
writeFileSync('sticker.pdf', renderBook(book, { format: 'pdf', ...output }), 'latin1');
writeFileSync('sticker.skbk', renderBook(book, { format: 'skbk' }));
writeFileSync('sticker.jsx', renderBook(book, { format: 'jsx', ...output }));
```

4. Run `node write.mjs`. The SVG is 147 by 147, the circle and its room; the
   PNG is the same box at twice the pixels, 294 by 294, with no paper behind
   it; the PDF is one page of that size; the `.skbk` is the whole page, for
   the app to open; and `sticker.jsx`, run in Illustrator with File > Scripts
   > Other Script, builds a document on a 147 by 147 point artboard with the
   `Sticker` layer on it. From a shell, one line writes the same five:

```bash
napkin-sketch draw sticker.napkin --to svg,png,pdf,skbk,jsx --scale 2
```

## A worked example

Three frames of a bouncing ball, cut to one registration box so they line up
when played in sequence. Each page cut to its own ink would start at a
different corner; `registration` gives every page the same box:

```napkin
napkin 1
page 400 300
name "bounce"
color #1f2328 width 3 fill #ff8a65
circle 100 200 30
newpage
circle 200 120 30
newpage
circle 300 200 30
registration 50 70 300 180
```

`napkin-sketch draw bounce.napkin --to svg,png --out frames` writes
`bounce-1.svg` to `bounce-3.svg` and `bounce-1.png` to `bounce-3.png`. Every
SVG has `viewBox="50 70 300 180"` and every PNG is 300 by 180, so the ball
moves and the frame does not.

## Where to go next

- [Writing a page and a book](README.md#writing-a-page-and-a-book): what each
  call gives for each format.
- [Options](README.md#options): `crop`, `registration`, `transparent`,
  `scale`, `resolveLink` and `onWarning`.
- [SVG](README.md#svg), [PNG](README.md#png), [PDF](README.md#pdf),
  [the .skbk file](README.md#the-skbk-file) and
  [the Illustrator script](README.md#the-illustrator-script): what each format
  keeps.
- [The box](README.md#the-box-crop-and-registration): how the ink is measured.
- [From a sketch to a composition](README.md#from-a-sketch-to-a-composition):
  adding to a drawing in code before it is written.
- [Using napkin-sketch from code](../node/QUICKSTART.md): `drawFile`, which
  names and writes the files for you.
