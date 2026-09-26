# Using napkin-sketch from code: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

The package has two entries - `napkin-sketch`, which runs anywhere, and
`napkin-sketch/node`, which reads and writes files - and this is the path from
a clone to a Node program that draws a script to files.

## The whole thing in four steps

1. Build the clone. `build:types` writes the `.d.ts` files TypeScript reads:

```bash
npm install
npm run build
npm run build:types
```

2. Save this as `card.napkin` in the clone:

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

3. Save this as `draw.mjs` beside it:

```js
import { formatDiagnostic } from 'napkin-sketch';
import { drawFile } from 'napkin-sketch/node';

const { ok, files, diagnostics } = await drawFile('card.napkin', { out: 'out', formats: ['svg', 'png', 'pdf'] });
for (const d of diagnostics) console.error(formatDiagnostic(d, 'card.napkin'));
console.log(ok ? files.map((file) => file.path) : 'card.napkin has errors');
```

4. Run `node draw.mjs`. It writes `out/card.svg`, `out/card.png` and
   `out/card.pdf`, and prints their paths. A mistake in the script does not
   throw: `ok` is false, the diagnostics say where, and what could be drawn is
   still written.

CommonJS loads the same entry with `import()`:

```js
async function main() {
  const { drawFile } = await import('napkin-sketch/node');
  const { ok, files } = await drawFile('card.napkin', { out: 'out' });
  console.log(ok, files.map((file) => file.path));
}
main();
```

## A worked example

A banner built in code, with an image the script places by name. The script
names `logo`; the program reads the file and hands it over, since a script
reads no files itself:

```js
import { drawToFiles, loadAssets } from 'napkin-sketch/node';

const assets = await loadAssets({ logo: 'assets/icon.png' });
const script = [
  'napkin 1',
  'page 480 200',
  'name "banner"',
  'background #326478',
  'image "logo" at 20 20 size 160',
  'color #ffffff',
  'text "Acme Corp" at 200 80 size 36',
].join('\n');

const { ok, files, diagnostics } = await drawToFiles(script, { out: 'out', formats: ['svg', 'png'], assets });
console.log(ok, files.map((file) => file.path), diagnostics);
```

Run in the clone, it writes `out/banner.svg` and `out/banner.png` with the
app's icon on the left. The files take the script's `name`; without one they
would be `drawing.svg` and `drawing.png`.

## Where to go next

- [The two entries](README.md#the-two-entries): what each one holds, and why a
  browser build imports only the first.
- [ES modules, CommonJS and TypeScript](README.md#es-modules-commonjs-and-typescript):
  the types, by name.
- [Writing files](README.md#writing-files) and [Options](README.md#options):
  how files are named, and every option.
- [The result](README.md#the-result) and
  [Errors are values; the disk throws](README.md#errors-are-values-the-disk-throws).
- [What a script names](README.md#what-a-script-names-scripts-assets-documents-links):
  assets, documents and links.
- [Writing a drawing out](../output/QUICKSTART.md): the render calls, for
  strings and bytes instead of files.
