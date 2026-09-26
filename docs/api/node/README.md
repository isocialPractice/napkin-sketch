# Using napkin-sketch from code

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

The package has two entries. `napkin-sketch` holds everything that runs
anywhere - the editor, the data model, the composition API and the napkin
script language - and reads no file. `napkin-sketch/node` holds what reads
and writes files, for Node. This page is the reference for both as a program
uses them: importing them, drawing a script, writing files, the result object,
and what is an error value and what throws.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [The two entries](#the-two-entries)
  - [Getting the package](#getting-the-package)
  - [ES modules, CommonJS and TypeScript](#es-modules-commonjs-and-typescript)
  - [Drawing a script](#drawing-a-script)
  - [Writing files](#writing-files)
  - [Options](#options)
  - [The result](#the-result)
  - [What a script names: scripts, assets, documents, links](#what-a-script-names-scripts-assets-documents-links)
  - [Errors are values; the disk throws](#errors-are-values-the-disk-throws)
  - [The language in the barrel](#the-language-in-the-barrel)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

A drawing is made the same way in a browser and in Node: a script goes to
`evaluate`, a sketch book comes back, and `renderSketch` or `renderBook`
writes it as SVG, PNG, PDF, `.skbk` or an Illustrator script. None of that
touches a DOM or a disk,
so it all lives in the browser-safe `napkin-sketch` entry, beside the editor
and the composition API that were already there.

The disk is the host's business. A script names an image, a document or a
linked file, and the host hands it over; the host writes what was drawn. In
Node that host is `napkin-sketch/node`: one call reads a script file, loads
what it names, runs it, and writes a file for each format asked for, and
the result it gives back is the object a command line prints.

## The mental model

```text
 napkin-sketch                                  napkin-sketch/node
 -------------                                  ------------------
 parseScript, validateScript, formatScript      readScript            (a file in)
 evaluate --> book                              loadAssets, loadDocuments, resolveLinkFromDir
 renderSketch, renderBook --> strings, bytes    writeBook             (files out)
 drawSvg: a script straight to SVG              drawFile, drawToFiles (all of it, one call)
```

## Reference

### The two entries

| Import | Runs in | Holds |
| --- | --- | --- |
| `napkin-sketch` | a browser, Node, any bundler | The editor, the data model, the sharpen engine, the composition API, and the language: reading, checking and writing scripts, `evaluate`, `drawSvg`, the render calls, and the verb and diagnostic tables. |
| `napkin-sketch/node` | Node 18 and later | Files: `drawFile`, `drawToFiles`, `writeBook`, `readScript`, `loadAssets` and `loadDocuments`, and the composition API's file helpers, `imageDataUrl`, `writeComposition`, `resolveLinkFromDir` and `mediaTypeOf`. |

`napkin-sketch/graphic-design/files`, the composition helpers' own entry,
keeps working; `napkin-sketch/node` gives the same functions, so a Node
program has one import for files.

### Getting the package

The package is built from a checkout until it is published to npm:

```bash
npm install
npm run build        # dist/, including dist/node/
npm run build:types  # the .d.ts files the exports map points at
```

A project then depends on the folder - `npm install ../napkin-sketch` - or
links it with `npm link`, and imports it by name.

### ES modules, CommonJS and TypeScript

Both entries are ES modules:

```ts
import { evaluate, renderSketch } from 'napkin-sketch';
import { drawFile } from 'napkin-sketch/node';
```

CommonJS code loads them with `import()`, which works on every Node the
package supports. `require` works only where Node can require an ES module,
and elsewhere fails with `ERR_REQUIRE_ESM`:

```js
const { drawFile } = await import('napkin-sketch/node');
```

Type declarations ship with both, found through the package's exports map
under `moduleResolution` `bundler`, `node16` or `nodenext`. Every option and
result on this page is a named type: `DrawToFilesOptions`, `DrawResult`,
`WrittenFile` and `WriteBookOptions` from `napkin-sketch/node`, and
`EvaluateOptions`, `ScriptResult`, `Diagnostic`, `RenderSketchOptions` and the
rest from `napkin-sketch`.

A browser build imports `napkin-sketch` only. `napkin-sketch/node` reads
files with `node:fs`, which a browser does not have.

### Drawing a script

`evaluate(source, options)` runs a script and returns `{ ok, book,
diagnostics, stats, output, seed }`, and `renderSketch` and `renderBook` write
the book; [Drawing with napkin script](../drawing/README.md#running-a-script)
and [Writing a drawing out](../output/README.md) are their references. A
script is text, or the object form as a JSON value.

`drawSvg(source, options)` is the three in one call, for the caller that
wants a picture: it runs the script and gives back its first page as SVG,
cut as the script's `crop` and `registration` ask.

```ts
import { drawSvg } from 'napkin-sketch';

const { ok, svg, diagnostics } = drawSvg('napkin 1\npage 400 300\ncircle 200 150 60');
```

| `drawSvg` option | Default | Meaning |
| --- | --- | --- |
| everything `evaluate` takes | | `seed`, `timestamp`, `assets`, `documents`, `resolveLink`, `limits`, `name`, `fragment`. |
| `crop` | the script's own | What to cut the page to: `'auto'`, `'none'`, or a box. |
| `registration` | the script's own | One box, over any crop. |
| `transparent` | `false` | Leave the paper out. |

It returns `{ ok, svg, diagnostics }`. For every page, or another format,
run `evaluate` and hand the book to `renderBook`.

### Writing files

`drawFile(path, options)` reads a script file and writes what it drew, and
`drawToFiles(source, options)` does the same from a script in hand. Both
return a promise of [the result](#the-result).

```ts
import { drawFile } from 'napkin-sketch/node';

const { ok, files, diagnostics } = await drawFile('card.napkin', { out: 'out', formats: ['svg', 'png'] });
```

- **One file a format.** SVG and PNG are a file a page: `card.svg` for a book
  of one page, and `card-1.svg`, `card-2.svg` and on for several. PDF,
  `.skbk` and `.jsx` are one file for the whole book: `card.pdf`,
  `card.skbk`, `card.jsx`.
- **Named after the drawing.** The files take the first page's name, which a
  script's `name` sets; without one it is the book's name, which `drawFile`
  takes from the file - `card` for `card.napkin` - and `drawToFiles` leaves at
  `drawing`. `name` in the options names them outright.
- **Never outside `out`.** A script names its own pages, so the name is made
  safe first: every character a file name cannot hold on Windows, macOS or
  Linux becomes `-`, including both slashes, dots and spaces at the ends go,
  and a Windows device name such as `con` gains `-drawing`. `name "../x"`
  writes `-x.svg` inside `out`.
- **Whole or not at all.** Every file is rendered before any is written, and
  each is written to a scratch file beside it and then renamed over it, so a
  failure part way leaves the file that was there rather than half of a new
  one.

`writeBook(book, options)` is the writing half alone, for a book already in
hand - one `evaluate` made, or one read from a `.skbk` - and returns the
[written files](#the-result). It takes `out`, `name`, `formats`, `base` and
`strict` as below, and the render options.

### Options

`drawFile` and `drawToFiles` take everything `evaluate` does and everything
`renderBook` does, and these:

| Option | Default | Meaning |
| --- | --- | --- |
| `out` | the working folder | The folder the files go in. It is made when it is missing. |
| `formats` | `['svg']` | Any of `svg`, `png`, `pdf`, `skbk`, `jsx`, each written once. |
| `name` | the first page's | The name the files are written under, and the book's. |
| `assets` | none | Images the script places by name: data URLs, or paths read with `loadAssets`. |
| `documents` | none | Pages or books the script copies in with `use`: objects, or `.skbk` paths read with `loadDocuments`. |
| `base` | the working folder; the script's folder for `drawFile` | The folder the script's links are read inside, for their size and for the PNG, and which a `.jsx` written to `out` places them from. |
| `strict` | `false` | Write nothing unless nothing at all was reported, warnings included. |
| `crop`, `registration` | the script's own | The box every file is cut to. |
| `transparent`, `scale`, `decodeImage`, `onWarning` | | As [`renderBook`](../output/README.md#options) takes them. |
| `seed`, `timestamp`, `limits`, `resolveLink`, `fragment` | | As [`evaluate`](../drawing/README.md#running-a-script) takes them. `resolveLink` wins over `base`. |

`writeBook` takes `out`, `formats`, `name` and the render options.

### The result

`drawFile` and `drawToFiles` give back a `DrawResult`:

| Field | Meaning |
| --- | --- |
| `ok` | True when nothing was an error. With `strict`, true only when nothing was reported at all. |
| `files` | What was written, in the order the formats were asked for and then page by page: `{ path, format, page }`, where `path` is `out` joined with the file's name and `page`, counting from 1, is there for SVG and PNG. |
| `diagnostics` | Everything the script reported, reading and running together, in reading order. |
| `stats` | `instructions`, `marks`, `anchors`, `points` and `pages`: how much the run did. |
| `warnings` | What a format left out or drew as a stand-in, each starting with its page's name. |

`formatDiagnostic(diagnostic, 'card.napkin')` from `napkin-sketch` prints a
diagnostic the way editors and CI read one:
`card.napkin:3:1: error unknown-verb: ...`.

### What a script names: scripts, assets, documents, links

- **`readScript(path)`** reads a script file: a `.json` file is the object
  form and comes back as its JSON value, and anything else is napkin script
  text, with a byte-order mark left off.
- **`loadAssets(assets, from)`** turns `{ logo: 'art/logo.png' }` into
  `{ logo: 'data:image/png;base64,...' }`, reading each path relative to
  `from`, the working folder unless given. A value that is already a data URL
  is kept. An SVG becomes a UTF-8 data URL and anything else base64.
- **`loadDocuments(documents, from)`** reads each path as a `.skbk` book and
  keeps a page or a book given as an object.
- **`resolveLinkFromDir(folder)`** is the resolver `base` builds: it reads a
  linked file only inside `folder` - no absolute path, drive letter, UNC
  share, `..` step, web address, or symbolic link out of it - and anything
  else draws as the link's placeholder, with a warning.

Assets and documents are named by the host, so no folder guard applies to
them. Links are named by the script, so one does.

### Errors are values; the disk throws

Nothing in a script throws. An instruction that cannot run is a diagnostic,
the run goes on, and the files are written with what was drawn, `ok` false and
the diagnostics saying why - so a program writing a hundred drawings gets the
ninety-nine that worked. `strict` turns that off: any diagnostic, or any
format warning, and nothing is written.

The disk throws, as Node's own calls do, and the message names what failed:

| Throws | When |
| --- | --- |
| `readScript`, `drawFile` | The file cannot be read; a `.json` file is not JSON, or not an array. |
| `loadAssets`, and `drawToFiles` given `assets` | An asset's file cannot be read: `asset "logo" could not be read from ...`. |
| `loadDocuments`, and `drawToFiles` given `documents` | A document's file cannot be read, or is not `.skbk` JSON. |
| `drawFile`, `drawToFiles`, `writeBook` | `out` cannot be made or written to. |
| every render call | An unknown format, which is a mistake in the calling code. |

### The language in the barrel

What `napkin-sketch` exports for scripts:

| Export | What it is |
| --- | --- |
| `parseScript`, `validateScript`, `formatScript` | Read text, check the object form, and write either back as canonical text. |
| `evaluate`, `drawSvg` | Run a script to a book; run it straight to SVG. |
| `renderSketch`, `renderBook`, `inkBox`, `renderBox`, `RENDER_FORMATS` | Write a page or a book; the boxes the output is cut to. |
| `sketchToComposition` | The lowering behind the PNG, for a caller that adds to a drawing with the composition API. |
| `sketchesToJsx` | The Illustrator script writer behind `format: 'jsx'`, beside `sketchesToPdf`. |
| `formatDiagnostic` | Print a diagnostic as `file:line:column: level code: message`. |
| `SCRIPT_VERSION`, `SCRIPT_LIMITS`, `VERBS`, `DIAGNOSTICS` | The language version, the budget, and the verb and diagnostic tables every listing is made from. |

## Worked examples

**A folder of scripts, drawn to files.** Each script's problems are printed
where it failed, and the rest are drawn:

```ts
import { readdirSync } from 'node:fs';
import { formatDiagnostic } from 'napkin-sketch';
import { drawFile } from 'napkin-sketch/node';

for (const file of readdirSync('scripts').filter((name) => name.endsWith('.napkin'))) {
  const result = await drawFile(`scripts/${file}`, { out: 'out', formats: ['svg', 'png'], timestamp: '2026-09-25T00:00:00.000Z' });
  for (const d of result.diagnostics) console.error(formatDiagnostic(d, file));
  for (const w of result.warnings) console.error(`${file}: ${w}`);
  console.log(result.ok ? 'drew' : 'drew, with errors', result.files.map((f) => f.path).join(', '));
}
```

**A script built as JSON.** A program in any language can build the object
form; this one is a card with a named layer:

```json
[
  { "verb": "napkin", "version": 1 },
  { "verb": "page", "width": 400, "height": 300 },
  { "verb": "name", "name": "badge" },
  { "verb": "layer", "name": "Badge" },
  { "verb": "fill", "fill": "#ffe08a" },
  { "verb": "circle", "cx": 200, "cy": 150, "r": 80 }
]
```

```ts
import { drawToFiles } from 'napkin-sketch/node';

const { ok, files } = await drawToFiles(script, { out: 'out', formats: ['png'], scale: 2, strict: true });
// out/badge.png, twice the size; nothing written if anything was reported
```

**A live preview in a browser.** The barrel alone, redrawing as someone
types:

```ts
import { drawSvg } from 'napkin-sketch';

editor.addEventListener('input', () => {
  const { svg, diagnostics } = drawSvg(editor.value);
  preview.innerHTML = svg;
  problems.textContent = diagnostics.map((d) => d.message).join('\n');
});
```

## Limits

- **ES modules only.** `require` loads the entries only on a Node that can
  require an ES module; `import()` works everywhere the package runs.
- **Built from a checkout** until the package is published to npm.
- **The language costs the browser entry about 38 kB**, minified and
  gzipped: `napkin-sketch` went from about 53 kB to 91 kB when it joined. A
  bundler that shakes unused exports out of a build takes back what a page
  does not import.
- **Every page is written under one name.** SVG and PNG pages are numbered,
  `card-1.svg` and on, rather than named after each page.
- **`drawSvg` writes page one.** Everything else goes through `evaluate` and
  `renderBook`, or the Node calls.

## For agents

- **Draw with `drawFile` or `drawToFiles`**, not by chaining the steps: they
  load what the script names, apply its `crop` and `registration`, and write
  every file whole.
- **Check `ok`, then read `diagnostics` by `code`**, and `warnings` for what a
  format left out. `ok` false with files written means the script had errors
  and the files hold what it could draw.
- **Set `strict: true` when a half-right drawing is worse than none**, in CI
  above all.
- **Fix `timestamp`, and `seed` for a rough drawing**, when files will be
  compared or committed; the same script then writes the same bytes.
- **Hand images over in `assets`** by name, never as paths in the script: a
  script reads no files, and `unknown-asset` says so.
- **Expect links to resolve inside `base` only.** A link the resolver refuses
  draws as its placeholder and adds a warning; it is not an error.
- **Import `napkin-sketch/node` only in Node**, and `napkin-sketch` everywhere
  else.

## See also

- [Writing a drawing out](../output/README.md): the formats, the box, and
  what each format keeps.
- [The napkin-sketch command line](../cli/README.md): the same drawing from a
  shell, or from any language that can start a process.
- [Drawing with napkin script](../drawing/README.md): `evaluate`, and what
  each instruction draws.
- [The napkin script language](../language/README.md): the syntax, the object
  form and every diagnostic code.
- [The graphic design API](../compose/README.md): compositions, and their own file
  helpers.
- [`src/api/node.ts`](../../../src/api/node.ts) and
  [`src/core/script-files.ts`](../../../src/core/script-files.ts): the Node
  entry and what it runs.
