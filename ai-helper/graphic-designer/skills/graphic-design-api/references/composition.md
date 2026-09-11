# Composition recipes

The arithmetic and the element patterns that come up in nearly every
composition. Copy, change the constants, delete what you do not need.

## The grid, as constants

Derive everything from the page and one base unit, so a size change is one
edit:

```js
const PAGE = { width: 360, height: 360 };
const UNIT = 4;
const MARGIN = UNIT * 6;              // 24
const GUTTER = UNIT * 3;              // 12
const CONTENT = PAGE.width - MARGIN * 2;                   // 312
const COL = (n, of = 3) => (CONTENT - GUTTER * (of - 1)) / of * n + GUTTER * (n - 1);
const X = (col = 0, of = 3) => MARGIN + COL(col, of);      // left edge of column `col`
```

On a 360 page that gives three columns of 96 with 12 between them. `X(0)` is
24, `X(1)` is 132, `X(2)` is 240.

## A header band with a rule

```js
design.rect({ x: 0, y: 0, width: PAGE.width, height: 56, fill: PALETTE.ground });
design.text({
  x: MARGIN, y: 36, text: 'Acme Corp',
  fontFamily: TYPE.family, fontSize: TYPE.display,
  letterSpacing: 0.8, transform: 'uppercase', fill: PALETTE.paper,
});
design.line({
  x1: 0, y1: 56, x2: PAGE.width, y2: 56,
  stroke: PALETTE.accent, strokeWidth: SHAPE.stroke,
});
```

The rule is a `line`, not a 2-tall `rect`: it reads the same and says what it
is. Use a `rect` when the band has to carry a fill of its own.

## A plate with a heading and a subheading

```js
design.rect({ x: MARGIN, y: 72, width: CONTENT, height: 56, rx: SHAPE.radius, fill: PALETTE.paper });
design.text({
  x: PAGE.width / 2, y: 94, text: 'Quarterly summary',
  align: 'center', fontSize: TYPE.head, fontWeight: 'bold', fill: PALETTE.ink,
});
design.text({
  x: PAGE.width / 2, y: 112, text: 'Prepared by Jane Doe',
  align: 'center', fontSize: TYPE.caption, fill: PALETTE.ink,
});
```

Under `align: 'center'`, `x` is the centre of the block. Under `left` it is the
left edge, under `right` the right edge - so a centred and a left-aligned block
that look aligned in a mockup need different `x` values here.

## A body block that wraps

```js
design.text({
  x: MARGIN, y: 148, text: body,
  fontSize: TYPE.body, lineHeight: 1.45, maxWidth: CONTENT,
  baseline: 'top', fill: PALETTE.ink,
});
```

`maxWidth` is what makes the line-length rule a constraint instead of a hope.
`baseline: 'top'` makes `y` the top of the block, which is what a layout wants;
without it `y` is the first baseline and the block hangs below where you think.

To leave room for what follows, measure instead of guessing:

```js
import { layoutText } from 'napkin-sketch';
const block = layoutText(body, {
  x: MARGIN, y: 148, fontSize: TYPE.body, lineHeight: 1.45,
  align: 'left', baseline: 'top', maxWidth: CONTENT,
});
const nextY = 148 + block.height + block.lineHeight;
```

## A masked avatar or logo

```js
design.defineClip('avatar', { type: 'circle', cx: 180, cy: 220, r: 48 });
design.circle({ cx: 180, cy: 220, r: 50, fill: PALETTE.accent });   // ring, drawn first
design.image({
  src: dataUrl, x: 132, y: 172, width: 96, height: 96,
  fit: 'cover', clip: 'avatar', alt: 'Jane Doe',
});
```

The ring is a slightly larger circle painted underneath, not a stroke on the
image - a stroke would be clipped away with everything else outside the mask.

Define the mask once and reference it by id when several elements share it;
write it inline (`clip: { type: 'circle', ... }`) for a one-off.

## A row of cards

```js
const cards = [
  { title: 'Design', tone: PALETTE.accent },
  { title: 'Build', tone: PALETTE.ground },
  { title: 'Ship', tone: PALETTE.ink },
];
cards.forEach((card, i) => {
  design.group({ translate: { x: X(i), y: 0 } }, (g) => {
    g.rect({ x: 0, y: 260, width: COL(1), height: 72, rx: SHAPE.radius, fill: card.tone });
    g.text({
      x: COL(1) / 2, y: 300, text: card.title,
      align: 'center', fontSize: TYPE.body, fill: PALETTE.paper,
    });
  });
});
```

Each card is composed at `x: 0` and moved by its group, so the card's internals
never have to know which column they are in.

## A footer

```js
design.group({ id: 'footer' }, (f) => {
  f.rect({ x: 0, y: PAGE.height - 48, width: PAGE.width, height: 48, fill: PALETTE.paper });
  f.rect({ x: 0, y: PAGE.height - 52, width: PAGE.width, height: 4, fill: PALETTE.accent });
  f.triangle({
    x: MARGIN, y: PAGE.height - 34, width: 18, height: 18,
    variant: 'right', fill: PALETTE.accent,
  });
  f.text({
    x: MARGIN + 28, y: PAGE.height - 18, text: 'jane.doe@example.com',
    fontSize: TYPE.caption, fill: PALETTE.ink,
  });
});
```

## Writing both formats

```js
import { writeComposition } from 'napkin-sketch/dist/core/graphic-design/files.js';

const { svg, png, warnings } = await writeComposition(design, './out', 'card');
if (warnings.length > 0) console.warn(warnings.join('\n'));
```

One call, one document, both files. Rendering them separately is how an SVG
from one revision ends up beside a PNG from another.

For a retina raster, `design.toPNG({ scale: 2 })` gives the same graphic on
four times the pixels - the vector is unchanged, so there is no second
composition to keep in step.

## Checks worth running before you call it done

- Render the PNG at 20% and squint: does the primary element still dominate?
- Read back `design.rasterize().warnings` - a skipped image reports there.
- Run the `design-language` analyzer over the output and compare the palette
  shares against the 60-30-10 you intended.
- Render twice and diff the bytes. They should be identical; if they are not,
  something in the script is not deterministic.
