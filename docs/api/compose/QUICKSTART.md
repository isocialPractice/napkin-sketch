# The graphic design API: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

The graphic design API builds a graphic in code - shapes, text, images, masks
and gradients on a page - and renders the one document to SVG and PNG; this is
the path from a clone to both files.

## The whole thing in three steps

1. Build the clone. The API is used from `dist/`:

```bash
npm install
npm run build
```

2. Save this as `card.mjs` in the clone:

```js
import { writeFile } from 'node:fs/promises';
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });

design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fontSize: 28, fill: '#ffffff' });
design.circle({ cx: 180, cy: 220, r: 64, fill: '#4cae50' });

await writeFile('card.svg', design.toSVG(), 'utf-8');
await writeFile('card.png', design.toPNG());
```

3. Run it. It writes `card.svg` and `card.png`:

```bash
node card.mjs
```

Both files come off the one composition, so they are the same graphic in two
formats. A page defaults to 360 by 360 pixels, and coordinates are pixels
unless the page names `in`, `mm` or `pt`. Installed as a dependency instead,
`import { createComposition } from 'napkin-sketch'` works the same way.

## A worked example

A badge: a radial gradient under a ring with a hole in it, and a name under
both, written to `out/badge.svg` and `out/badge.png` in one call. Save it as
`badge.mjs` in the clone and run `node badge.mjs`:

```js
import { createComposition } from 'napkin-sketch';
import { writeComposition } from 'napkin-sketch/node';

const design = createComposition({ width: 240, height: 240, background: '#ffffff' });

design.circle({
  cx: 120, cy: 120, r: 96,
  fill: { type: 'radial', stops: [{ offset: 0, color: '#ffe08a' }, { offset: 1, color: '#ff8a65' }] },
});
design.group({ erase: [{ type: 'circle', cx: 120, cy: 120, r: 40, fill: '#000000' }] }, (ring) => {
  ring.circle({ cx: 120, cy: 120, r: 70, fill: '#326478' });
});
design.text({ x: 120, y: 228, text: 'Acme Corp', align: 'center', fontSize: 16, fill: '#1f2328' });

const { svg, png, warnings } = await writeComposition(design, 'out', 'badge');
console.log(svg, png, warnings);
```

The ring's `erase` shape clears the middle of its own group and nothing else,
so the gradient shows through the hole. `writeComposition` writes the SVG and
the PNG from one document, so the two cannot come from different revisions,
and `warnings` lists anything the PNG could not draw.

## Where to go next

- [The page](README.md#the-page) and [Elements](README.md#elements): every
  element and every property.
- [Clipping masks](README.md#clipping-masks),
  [Gradients](README.md#gradients) and [Transforms](README.md#transforms).
- [Rendering](README.md#rendering): the options, and `renderPng`'s warnings.
- [Brand resources](README.md#brand-resources): placing a brand's own logo and
  footer.
- [Writing a drawing out](../output/QUICKSTART.md): a napkin script's drawing,
  lowered into a composition.
- [The cheatsheet](CHEATSHEET.md): every method on one line.
