# Markdown Flow and Clean Language Accents: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

A script with a Markdown Flow note and a colored code listing, drawn from
Node with the readers that make them render.

## The whole thing in three steps

1. Save this as `notes.napkin`:

```napkin
napkin 1
page 480 320
background #ffffff
text "## Acme Corp\n\n- **Widgets** up\n- Gadgets steady" at 40 60 size 16 markdown
font "Consolas" 14
accent python
text "def total(prices):\n    return sum(prices)  # in cents" at 40 200
```

2. Save this as `draw.mjs` beside it:

```js
import { drawSvg } from 'napkin-sketch';
import 'napkin-sketch/markdown';
import { readFile, writeFile } from 'node:fs/promises';

const { svg, diagnostics } = drawSvg(await readFile('notes.napkin', 'utf8'));
await writeFile('notes.svg', svg);
console.log(diagnostics.length); // 0
```

3. Run `node draw.mjs`. `notes.svg` holds the heading and the bullets as the
   Markdown renders, and the code in Napkin Light: `def` and `return` red,
   the comment grey. Without the second import the note shows its Markdown
   as typed and the code is plain.

## Another language

Code in a language beyond the 36 common ones is plain until it is installed:

```js
import { registerAccentLanguage } from 'napkin-sketch/markdown';
import fortran from 'highlight.js/lib/languages/fortran';

registerAccentLanguage('fortran', fortran);
```

## Where to go next

- [The reference](README.md): every call, the themes, and readers of your
  own.
- [The cheatsheet](CHEATSHEET.md): the calls on one page.
- [Drawing with napkin script](../drawing/README.md#text): the `markdown`
  flag, `textconfig` and `accent`.
