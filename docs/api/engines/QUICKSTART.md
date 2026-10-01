# The drawing engines: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

The engines behind the app's Eraser, Wipe Stacks, Split and Liquify run as
plain functions; this is the path from a clone to a page combined and cut by a
program, and written out as SVG.

## The whole thing in three steps

1. Build the clone. The engines are used from `dist/`:

```bash
npm install
npm run build
```

2. Save this as `engines.mjs` in the clone:

```js
import { writeFile } from 'node:fs/promises';
import { eraseMarks, eraseRegionOf, evaluate, renderSketch, wipeMarks } from 'napkin-sketch';

// Two shapes drawn by a script: the marks the engines work on.
const page = evaluate('napkin 1\npage 240 160\nfill #27486d\nrect 20 20 120 120\ncircle 140 80 60\n').book.sketches[0];
const [square, circle] = page.strokes;

// Wipe In, a vector editor's Unite, gives back an edit: the circle becomes the union, the square goes.
const union = wipeMarks(page, [square.id, circle.id], 'in');
const joined = page.strokes.filter((mark) => !union.removed.has(mark.id)).map((mark) => union.changed.get(mark.id) ?? mark);

// The Eraser's cut, made the same way: a swath 20 wide down the middle.
const swath = eraseRegionOf({ id: 'gap', tool: 'eraser', color: '#000000', width: 20, points: [{ x: 120, y: 0 }, { x: 120, y: 160 }] });
const cut = eraseMarks({ ...page, strokes: joined }, joined.map((mark) => mark.id), swath);
const strokes = joined.map((mark) => cut.changed.get(mark.id) ?? mark);

await writeFile('engines.svg', renderSketch({ ...page, strokes }, { format: 'svg' }), 'utf-8');
console.log(strokes.length, strokes[0].vector.anchors.filter((a) => a.move).length + 1);
// → 1 2
```

3. Run it. It writes `engines.svg`, and prints how many marks are left and how
   many pieces the one left has:

```bash
node engines.mjs
```

The wipe left one shape, and the eraser cut it into two pieces of one mark.
Nothing changed the page the script drew: each engine gave back its edit, and
the program made it. Installed as a dependency instead, the same imports from
`napkin-sketch` work the same way.

## Where to go next

- [Applying an edit](README.md#applying-an-edit): a helper that makes any
  engine's edit, added marks too.
- [Wiping](README.md#wiping-wipemarks) and
  [Faces and stacking](README.md#faces-and-stacking-arrangefaces-stackfaces):
  the six wipes, and the Shape Stacker's merge and remove.
- [Splitting](README.md#splitting-splitmark),
  [Clipping masks](README.md#clipping-masks) and
  [Liquify](README.md#liquify-liquifyfield-liquifymarks).
- [Drawing with napkin script](../drawing/README.md#erasing): the same engines
  as the verbs of a script.
