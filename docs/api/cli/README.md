# The napkin-sketch command line

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

`napkin-sketch draw` turns a napkin script into files - SVG, PNG, PDF, a
`.skbk` the app opens, or an Illustrator script - with no window, and without
loading Electron at all.
`check` reads and runs a script and writes nothing, `render` writes a sketch
book the app saved, and `verbs` lists the language. This page is the
reference for the four commands, their exit codes and their JSON report, and
for calling them from other languages.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [draw](#draw)
  - [check](#check)
  - [render](#render)
  - [verbs](#verbs)
  - [Exit codes](#exit-codes)
  - [The JSON report](#the-json-report)
  - [Standard input and the object form](#standard-input-and-the-object-form)
  - [Names, folders and links](#names-folders-and-links)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

The app's command line opens the drawing window, and four commands beside it
never do. They are for programs: a build step, a batch file, a Python or C
program, an agent. Each takes a script from a file or from standard input,
writes files into a folder, and reports in one of two ways - for a person,
with problems on standard error and the files written on standard output, or
with `--json`, as one line of JSON on standard output and nothing else.

Any language that can start a process can draw this way, and needs nothing
else: no library, no binding, no temporary file. The commands reach no part of
Electron, so they also work where a global install left the drawing window
unable to start.

## The mental model

```text
 card.napkin --+                        +--> out/card.svg  out/card.png  out/card.pdf  out/card.skbk
               +--> napkin-sketch draw --+
 stdin (-) ----+                        +--> stdout: the files written, or one line of JSON
                                        +--> stderr: problems, as file:line:column: level code: message
                                        +--> exit code: 0 drew, 1 arguments, 2 the script, 3 a file, 4 the AI helper
```

## Reference

### draw

```text
napkin-sketch draw <script | -> [--to svg,png,pdf,skbk,jsx] [--out <dir>] [--name <stem>]
                   [--base <dir>] [--asset <name>=<file> ...] [--use <name>=<book.skbk> ...]
                   [--seed <n>] [--scale <n>] [--crop auto|none|<x,y,w,h>] [--limit <n>]
                   [--json] [--strict] [--quiet]
napkin-sketch draw --prompt "<request>" [--helper <command>] [the options above]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--to` | `svg` | The formats to write: any of `svg`, `png`, `pdf`, `skbk`, `jsx`, comma-separated. `jsx` is a script that rebuilds the drawing in Adobe Illustrator; see [Working with other programs](../interop/README.md#rebuilding-a-drawing-in-illustrator). |
| `--out` | the current folder | The folder to write into. It is made when it is missing. |
| `--name` | the script's own `name`, else the file's | The name the files are written under. |
| `--base` | the script's folder | The folder linked files are read inside. |
| `--asset` | none | `<name>=<file>`: an image the script places by name. Repeat it for more. |
| `--use` | none | `<name>=<book.skbk>`: a book the script copies in with `use`. Repeat it for more. |
| `--seed` | `0` | The seed for [the hand-drawn pass](../drawing/README.md#the-hand-drawn-pass). |
| `--scale` | `1` | PNG pixels a page pixel: `2` for a retina asset. |
| `--crop` | the script's own `crop` | `auto` for the ink, `none` for the whole page, or a box `x,y,width,height`. |
| `--limit` | 200,000 | The most instructions a run may execute; see [the budget](../language/README.md#the-budget). |
| `--prompt` | none | A request an AI tool writes the script for, in place of a script; see [Drawing from a request](../ai/README.md#drawing-from-a-request). |
| `--helper` | `$NAPKIN_SCRIPT_HELPER`, else Claude Code | The AI helper command `--prompt` runs, in the current folder. |
| `--json` | off | Print one line of JSON on standard output and nothing else. |
| `--strict` | off | Write nothing when anything at all is reported: a warning, or a format leaving something out. |
| `--quiet` | off | Print errors and nothing else. |

Both `--to svg,png` and `--to=svg,png` work, and a value may start with one
`-`, as `--seed -3` does. A script's own `crop` and `registration` apply unless
`--crop` is given.

With `--prompt`, an AI tool writes the script: napkin-sketch writes a form to
`_temp/script-form.txt`, runs the helper command in the current folder, reads
the script it saves to `_temp/script-out.napkin`, checks it, and sends it back
once with its diagnostics when it has errors. The script is kept beside the
files as `<name>.napkin`, and printed first in the list; the `--asset`,
`--use` and `--base` it is checked and drawn with are read from the current
folder, as for a script on standard input.

### check

```text
napkin-sketch check <script | -> [--base <dir>] [--asset <name>=<file> ...] [--use <name>=<book.skbk> ...]
                    [--seed <n>] [--limit <n>] [--json] [--strict] [--quiet]
```

Reads and runs the script exactly as `draw` would, writes nothing, and
prints what it found, ending with a line such as `card.napkin: 1 error, 0
warnings` or `card.napkin: no problems`. A warning alone passes; `--strict`
fails it. Give it the same `--asset` and `--use` the drawing will get, or a
script that places an image reports `unknown-asset`.

### render

```text
napkin-sketch render <book.skbk> [--to svg,png,pdf,skbk,jsx] [--page <n>] [--out <dir>] [--name <stem>]
                     [--base <dir>] [--scale <n>] [--crop auto|none|<x,y,w,h>] [--json] [--strict] [--quiet]
napkin-sketch render <book.skbk> --animate <type> [--frames <n>] [--facing left|right] [--page <n>]
                     [--to ...] [--out <dir>] [--name <stem>] [--base <dir>] [--scale <n>] [--json] [--strict] [--quiet]
```

Writes a sketch book - one the app saved, or one `draw` wrote - as files named
after the book's file. `--page 2` writes page 2 alone, still named for its
place in the book: `deck-2.png`. The `.skbk` may be left off the name, as the
app's own `--book` allows.

`--animate walk` writes the figure on the page as animation frames instead,
drawn from the measured walk cycle with no AI. The figure is found as
Animation Mode finds it, by its assemblies' layer names - `front-arm-assembly`,
`body`, `front-leg-assembly`, `back-leg-assembly`, `back-arm-assembly` and
`head` - and each part is copied onto a page a frame and turned about its
joint by the cycle's total up to that frame. `hero.skbk` gives a file a frame,
`hero-walk-1.svg` to `hero-walk-8.svg`, every one cut to the same box - the
union of the frames' ink - so they play back without shifting; `--name` sets
the stem, and a PDF, `.skbk` or `.jsx` holds every frame. The types are the
four with a measured cycle: `walk`, `run`, `ideal` - the app's Idle, and
`idle` is read as it - and `knocked-down`. `--frames 4` spreads the cycle
across four frames rather than its own eight, so each moves further, and
`--facing left` or `right` says which way the figure travels, which is
otherwise read from its feet. The JSON report carries the script that drew the
frames as `script.text`, and a page with none of the assemblies exits `2`.

### verbs

```text
napkin-sketch verbs [--category <name>] [--json]
```

Lists the language by category, each verb as it is written with what it does,
and the names the shape library draws. `--category shapes` narrows it to one
category. `--json` gives the whole table as one line: the verbs with their
grammar, the categories, the shapes, and every diagnostic code with its
level - which is the language's reference in one call.

### Exit codes

| Code | Meaning | Files |
| --- | --- | --- |
| `0` | It drew; the script checked clean; the book was written. | Written. |
| `1` | The arguments were wrong: an unknown option, a bad value, no script. | None. |
| `2` | The script had errors - or with `--strict`, anything at all was reported. For `render`, the book could not be read as a book, or `--animate` found no figure on its page. | What could be drawn is written; with `--strict`, nothing. |
| `3` | A file could not be read or written: the script, an asset, a document, a linked file, or the output folder. | None when the script, an asset or a document could not be read. A linked file that could not be read is drawn as its placeholder, and the files are written. |
| `4` | `draw --prompt` got no script back: the AI helper is not on the PATH, is not signed in, or finished without one. | None. |

Errors in a script are values, reported and passed over: a script with a
mistyped verb still draws everything else, and exits `2` so that a caller
knows.

### The JSON report

With `--json`, `draw`, `check` and `render` print one line like this,
spread over lines here to read:

```json
{
  "ok": false,
  "exitCode": 2,
  "files": [
    { "path": "out/card.svg", "format": "svg", "page": 1 },
    { "path": "out/card.png", "format": "png", "page": 1 }
  ],
  "diagnostics": [
    { "level": "error", "code": "unknown-verb", "message": "`circl` is not a verb. Did you mean `circle`?", "line": 4, "column": 1 }
  ],
  "warnings": [],
  "stats": { "instructions": 4, "marks": 1, "anchors": 8, "points": 101, "pages": 1 },
  "version": "1.0.0-alpha.4.6.0",
  "language": 1
}
```

| Field | Meaning |
| --- | --- |
| `ok` | True exactly when `exitCode` is 0. |
| `exitCode` | The process's exit code, for a caller that reads only standard output. |
| `files` | What was written: `path` in the system's own separators, from the current folder or absolute when `--out` was; `format`; and `page`, from 1, for SVG and PNG. |
| `diagnostics` | What the script reported: `level`, `code`, `message`, and where - `line` and `column` for text, `index` for the object form. Match on `code`; the message is for people. |
| `warnings` | What a format left out or drew as a stand-in, each starting with its page's name. |
| `stats` | How much the run did; `null` when no script ran. |
| `script` | `draw --prompt` and `render --animate`: the script, as `text` - the one the AI helper wrote, or the one that drew the frames. For `draw --prompt`, also `attempts`, the tries it took, and `path`, where it was kept, absent when `--strict` wrote nothing. |
| `error` | When the command stopped for the arguments, a file, a book or the AI helper: `{ "kind": "usage" \| "io" \| "input" \| "helper", "message": ... }`, and for `helper` a `reason`: `missing-tool`, `auth`, `no-script` or `other`. |
| `version`, `language` | The package's version, and the napkin script version it reads. |

`verbs --json` prints the language's table instead: `categories`, `verbs`,
`shapes`, and, for the whole language, `diagnostics`.

### Standard input and the object form

`-` reads the script from standard input, which is how a program hands one
over without a temporary file. Text starting with `[` is the
[object form](../language/README.md#the-object-form), a script built as JSON;
anything else is napkin script text. A file ending `.json` is the object form
too. Text that is not JSON, or JSON that is not an array, is reported as an
`unexpected-token` or `invalid-value` diagnostic, with exit code `2`.

### Names, folders and links

- **The files' name** is `--name`, else the script's own `name`, else the
  script file's name, `card` for `card.napkin`, else `drawing`. A book of one
  page writes `card.svg`; several write `card-1.svg`, `card-2.svg` and on. A
  PDF, a `.skbk` or a `.jsx` is one file for the whole book.
- **A name never leaves `--out`.** A script names its own pages, so a name is
  made a file name first: every character a file name cannot hold becomes `-`.
- **Paths on the command line** - the script, `--out`, `--asset`, `--use` -
  are read from the current folder, as a shell expects.
- **Links** are read inside `--base` only, the script's folder unless given:
  no absolute path, `..` step or web address. A link that cannot be read is
  drawn as its placeholder, the files are still written, and the command
  exits `3`, naming the link. A `.jsx` reads no link as it is written: it
  names each linked file by its path from `--out` through `--base`, and
  Illustrator places the file from there when the script runs.

## Worked examples

Each caller below is a real file in [examples/](examples/), drawing
[examples/card.napkin](examples/card.napkin), and the test suite runs each one
wherever its shell, interpreter or compiler is installed.

- **[draw.sh](examples/draw.sh)** - a shell script that branches on the exit
  code, then hands the same script over on standard input with `--json`.
- **[draw.bat](examples/draw.bat)** - a Windows batch file. It must `call`
  napkin-sketch, since npm installs it as a `.cmd` file and a batch file that
  runs another one without `call` never comes back.
- **[draw.mjs](examples/draw.mjs)** - Node's `child_process`, with the script
  on standard input and the JSON line read back. A Node program that can
  import the package does better with `napkin-sketch/node`; see
  [Using napkin-sketch from code](../node/README.md).
- **[draw.py](examples/draw.py)** - Python's `subprocess.run` with `input=`
  and `--json`:

  ```python
  result = subprocess.run(
      [shutil.which("napkin-sketch"), "draw", "-", "--json", "--to", "svg,png", "--out", "out"],
      input=script, capture_output=True, encoding="utf-8",
  )
  report = json.loads(result.stdout)
  ```

- **[draw.c](examples/draw.c)** - C's `popen`, reading the one JSON line.

**A folder of scripts**, each drawn to SVG and PNG, with the failures named:

```sh
for f in scripts/*.napkin; do
  napkin-sketch draw "$f" --to svg,png --out out --quiet || echo "$f: exit $?" >&2
done
```

```powershell
Get-ChildItem scripts -Filter *.napkin | ForEach-Object {
  napkin-sketch draw $_.FullName --to svg,png --out out --quiet
  if ($LASTEXITCODE -ne 0) { Write-Error "$($_.Name): exit $LASTEXITCODE" }
}
```

**A check in CI**, failing the build on any problem, warnings included:

```sh
napkin-sketch check card.napkin --strict --asset logo=art/logo.png
```

## Limits

- **One script a call.** A host drawing hundreds of graphics starts a process
  for each; a long-lived mode that takes a request a line on standard input
  is not built yet.
- **`render` reads a file**, not standard input.
- **No pad on the command line.** `--crop auto` is the ink with no room around
  it; a script's own `crop auto pad 12` gives the room.
- **Assets and documents are read as given**, with no folder guard, since the
  caller names them; only links, which the script names, are kept to
  `--base`.
- **A book must be a `.skbk`.** `render` does not import an SVG or a PDF; the
  app does that.

## For agents

- **Use `--json`, and read one line.** Branch on `exitCode` - `2` means fix the
  script, `3` means fix the files or the paths, `4` means the AI helper
  behind `--prompt` gave back no script - and match diagnostics on `code`,
  never on `message`.
- **Hand the script over on standard input** with `-`, rather than writing a
  temporary file.
- **Run `check` while writing a script**, then `draw` once it is clean: it
  runs the same evaluation and writes nothing.
- **Get the whole language with `napkin-sketch verbs --json`**: every verb's
  grammar, the categories, the shape names and the diagnostic codes, in one
  call.
- **Set `--strict` in CI**, where a drawing with a placeholder or a warning is
  worse than none.
- **Pass images with `--asset`**, never as paths inside the script: a script
  reads no files, and says `unknown-asset` when it names one it was not given.

## See also

- [Using napkin-sketch from code](../node/README.md): the same drawing from
  Node, with `drawFile` and `drawToFiles`.
- [Writing a drawing out](../output/README.md): the formats, the box, and what
  each format keeps.
- [The napkin script language](../language/README.md): the syntax, the object
  form and every diagnostic code.
- [Drawing with napkin script](../drawing/README.md): what each instruction
  draws.
- [`src/cli/draw.ts`](../../../src/cli/draw.ts) and
  [`src/cli/args.ts`](../../../src/cli/args.ts): the commands and their
  arguments.
