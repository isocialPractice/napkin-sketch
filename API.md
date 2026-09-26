# The napkin-sketch API

**API hub** · [Quickstart](API-QUICKSTART.md) · [Cheatsheet](API-CHEATSHEET.md)

Draw without a pointer. napkin-sketch has a language, napkin script, that says
what to draw one instruction a line, and a composition API that builds a
graphic in code. Both write SVG and PNG, and a drawing also PDF, the app's own
`.skbk` and an Illustrator script, with no window, no browser and no native
library, from a shell, from Node, or from any language that can start a
process.

**Where to start.** A person: [API-QUICKSTART.md](API-QUICKSTART.md), then the
quickstart of the category you need. An agent:
[docs/api/INDEX.json](docs/api/INDEX.json), which lists every page with its
kind, its first paragraph and its size, and then a cheatsheet. Every verb, flag
and exit code on one page: [API-CHEATSHEET.md](API-CHEATSHEET.md).

## What it is

- **A drawing language.** A napkin script is a list of instructions such as
  `page`, `layer`, `color`, `rect`, `text` and `repeat`, written as text by a
  person or an AI tool, or built as JSON by a program. It runs into a sketch
  book: the same pages, layers and Bezier anchors the app draws by hand, so a
  script's drawing opens in the app as editable work.
- **A composition API.** `createComposition` builds a page out of shapes,
  text, images, masks and gradients in code, and renders the one document to
  SVG and PNG.
- **Four commands.** `napkin-sketch draw`, `check`, `render` and `verbs` run
  scripts from a shell or a batch file, and from Python, C or anything else
  through standard input and one line of JSON back.
- **Two package entries.** `napkin-sketch` runs anywhere and reads no file;
  `napkin-sketch/node` reads scripts, images and books and writes files.

## What it is not

- **Not a way to open files from a script.** A script names an image, a book
  or a linked file; the program running it reads them, and links are read
  only inside one folder.
- **Not a font engine.** The PNG sets text in a built-in single-stroke face,
  and the SVG and the PDF name the font for the reader to set.
- **Not a general SVG renderer.** It reads the SVG other editors write -
  layers, curves, gradients' stops - and says what it leaves out rather than
  drawing it wrong.
- **Not a model.** The AI helpers are skills and scripts an AI tool runs;
  nothing in the package calls one.

## The categories

<!-- categories:start -->
| Category | What it covers | Pages |
| --- | --- | --- |
| [The napkin script language](docs/api/language/README.md) | The syntax, values and expressions, the object form, every verb, and every diagnostic code. | [reference](docs/api/language/README.md), [quickstart](docs/api/language/QUICKSTART.md), [cheatsheet](docs/api/language/CHEATSHEET.md) |
| [Drawing with napkin script](docs/api/drawing/README.md) | What each instruction draws: pages, layers, paint, shapes, paths, the shape library, the hand-drawn pass, text, images, links and effects. | [reference](docs/api/drawing/README.md), [quickstart](docs/api/drawing/QUICKSTART.md), [cheatsheet](docs/api/drawing/CHEATSHEET.md) |
| [The graphic design API](docs/api/compose/README.md) | Compositions built in code - shapes, text, media, masks, gradients, effects - rendered to SVG or PNG. | [reference](docs/api/compose/README.md), [quickstart](docs/api/compose/QUICKSTART.md), [cheatsheet](docs/api/compose/CHEATSHEET.md) |
| [Writing a drawing out](docs/api/output/README.md) | SVG, PNG, PDF, .skbk and an Illustrator script from one call, the box every format is cut to, and what each format keeps. | [reference](docs/api/output/README.md), [quickstart](docs/api/output/QUICKSTART.md), [cheatsheet](docs/api/output/CHEATSHEET.md) |
| [The napkin-sketch command line](docs/api/cli/README.md) | draw, check, render and verbs from a shell or any language, with --json and exit codes. | [reference](docs/api/cli/README.md), [quickstart](docs/api/cli/QUICKSTART.md), [cheatsheet](docs/api/cli/CHEATSHEET.md) |
| [Using napkin-sketch from code](docs/api/node/README.md) | The two entries, ES modules and CommonJS, types, the result object, and what throws. | [reference](docs/api/node/README.md), [quickstart](docs/api/node/QUICKSTART.md), [cheatsheet](docs/api/node/CHEATSHEET.md) |
| [Working with other programs](docs/api/interop/README.md) | Illustrator and Inkscape through SVG, an Illustrator script that rebuilds a drawing, files linked from elsewhere, and what survives a round trip. | [reference](docs/api/interop/README.md), [quickstart](docs/api/interop/QUICKSTART.md), [cheatsheet](docs/api/interop/CHEATSHEET.md) |
| [The AI helpers](docs/api/ai/README.md) | The graphic-designer and scripting helpers: design languages, brand resources, scripts drawn from a request, and how an agent reads these pages. | [reference](docs/api/ai/README.md), [quickstart](docs/api/ai/QUICKSTART.md), [cheatsheet](docs/api/ai/CHEATSHEET.md) |
<!-- categories:end -->

## How it fits together

```text
 text script (.napkin) --parseScript--+
                                      +--> instructions: the object form (.napkin.json)
 a program (Node, Python, C) ---------+          |
                                              evaluate
                                                 |
                              sketch book: pages, layers, Bezier marks
                                                 |
          +---------------+-------------+--------+----------+-------------------+
     sketchToSvg    sketchesToPdf     .skbk           sketchesToJsx    sketchToComposition
          |               |             |                   |                   |
         SVG             PDF    the app opens it   Illustrator runs it     composition <-- createComposition
                                                                                |
                                                                            rasterize --> PNG
```

- **The object form is the contract.** Text lowers to it, and a program in
  another language builds it directly as JSON, checked against
  [the schema](docs/api/schema/instructions.schema.json).
- **Geometry is Bezier anchors, never samples**, so every output has something
  exact to write and the app has something to edit.
- **The outputs are the app's own writers.** A script's SVG is the SVG the app
  exports, and its PNG goes through the composition rasterizer, the one new
  road, with no canvas.
- **Errors are values.** A script that goes wrong is reported, line and code,
  and whatever could be drawn still is; only the disk throws.

## The ways in

| From | Call | Start at |
| --- | --- | --- |
| A shell, a batch file, CI | `napkin-sketch draw card.napkin --to svg,png` | [The command line](docs/api/cli/QUICKSTART.md) |
| Python, C, any language | `napkin-sketch draw - --json`, the script on standard input | [The callers](docs/api/cli/README.md#worked-examples) |
| Node | `drawFile('card.napkin', { formats: ['svg', 'png'] })` | [Using it from code](docs/api/node/QUICKSTART.md) |
| A browser or a bundler | `drawSvg(text)`, `evaluate(text)` | [The two entries](docs/api/node/README.md#the-two-entries) |
| Code that lays out a graphic | `createComposition({ width, height })` | [The graphic design API](docs/api/compose/QUICKSTART.md) |
| An AI tool | the `graphic-designer` and `scripting` helpers | [The AI helpers](docs/api/ai/QUICKSTART.md) |
| A sentence | `napkin-sketch draw --prompt "a three-box flowchart with arrows"` | [Drawing from a request](docs/api/ai/README.md#drawing-from-a-request) |
| Illustrator, Inkscape | SVG both ways, `link`, and `--to jsx` to rebuild a drawing in Illustrator | [Working with other programs](docs/api/interop/QUICKSTART.md) |

## Who these pages are for

People and agents alike. Every category has three pages: a reference for the
reader with time, a quickstart that runs as written on a fresh clone, and a
cheatsheet of tables, and each links to the other two and back here in its
first lines. The reference pages close with a section for agents: the strings
to match, the flags that make a run repeatable, and which diagnostics mean
retry and which mean rewrite. An agent gets the grammar from the program
rather than the prose: `napkin-sketch verbs --json` prints every verb, shape
and diagnostic code, from the table the parser reads.

## The language's version

A script's first line names the language version it was written for:
`napkin 1`. A version changes only when a script that ran under the old one
would draw differently under the new one; a new verb or a new optional field
is an addition, and keeps the version. A build refuses a script newer than it
reads with `version-unsupported`, naming the newest it does, and reads a
script with no version line as version 1, with a `version-missing` warning.
The language's version and the package's are separate: `SCRIPT_VERSION` is the
first, and the command line's JSON report carries both, as `language` and
`version`.

## How these pages are kept true

The verb tables, the command tables, the exit codes, the schema and
`docs/api/INDEX.json` are written by `npm run api-docs` from the tables the
code itself reads, and the test suite fails when one is out of date. Every
`napkin` block on these pages is run by the tests, every JSON script is
checked, and every relative link is followed to a file.
