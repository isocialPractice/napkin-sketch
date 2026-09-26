# API quickstart

[API hub](API.md) · **Quickstart** · [Cheatsheet](API-CHEATSHEET.md)

The whole API in five steps: build, draw a script from the command line, draw
it from Node, build a graphic in code, and link a logo.

## The whole thing in five steps

1. Build the clone and put `napkin-sketch` on your PATH:

```bash
npm install
npm run build
npm link
```

2. Save this as `card.napkin` in the clone, and draw it from the command line:

```napkin
napkin 1
page 400 300
name "card"
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 260 r 16
text "Acme Corp" at 200 120 size 32 align center
```

```bash
napkin-sketch draw card.napkin --to svg,png,pdf --out out
```

3. Draw the same script from Node. Save this as `draw.mjs` and run
   `node draw.mjs`:

```js
import { drawFile } from 'napkin-sketch/node';

const { ok, files, diagnostics } = await drawFile('card.napkin', { out: 'out', formats: ['svg', 'png'] });
console.log(ok, files.map((file) => file.path), diagnostics);
```

4. Build a graphic in code instead. Save this as `badge.mjs` and run
   `node badge.mjs`:

```js
import { writeFile } from 'node:fs/promises';
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 240, height: 240, background: '#ffffff' });
design.circle({ cx: 120, cy: 110, r: 80, fill: '#326478' });
design.text({ x: 120, y: 216, text: 'Acme Corp', align: 'center', fontSize: 20, fill: '#1f2328' });
await writeFile('badge.svg', design.toSVG());
await writeFile('badge.png', design.toPNG());
```

5. Link a logo rather than import it. Save any SVG as `logo.svg` beside the
   script, add this line to the end of `card.napkin`, and draw again. The SVG
   keeps `href="logo.svg"`, and the PNG draws the file:

```napkin
link "logo.svg" at 290 220 size 80 40 name "Logo"
```

## Where to go next

- [The napkin script language](docs/api/language/QUICKSTART.md): a script
  that checks clean, as text and as JSON.
- [Drawing with napkin script](docs/api/drawing/QUICKSTART.md): shapes,
  paint, text and the hand-drawn pass.
- [The graphic design API](docs/api/compose/QUICKSTART.md): gradients, masks
  and holes in code.
- [Writing a drawing out](docs/api/output/QUICKSTART.md): five formats, cut to
  the ink or a box.
- [The napkin-sketch command line](docs/api/cli/QUICKSTART.md): `check`,
  `render`, `verbs` and `--json`.
- [Using napkin-sketch from code](docs/api/node/QUICKSTART.md): the two
  entries, and images passed in.
- [Working with other programs](docs/api/interop/QUICKSTART.md): Illustrator,
  Inkscape, an Illustrator script, and linked files.
- [The AI helpers](docs/api/ai/QUICKSTART.md): a design language and a skill
  from a graphic you have, and a script from a sentence.
