# Drawing from a script

## At a glance

- **Drawing from a script** - a napkin script says what to draw one instruction
  a line; `napkin-sketch draw` turns it into SVG, PNG, PDF, a `.skbk` or a
  script that rebuilds it in Adobe Illustrator, with no window, from a shell,
  from Node, or from any language that can start a process (see
  [Drawing from a script](#drawing-from-a-script)). An AI tool can write the
  script from a sentence: `draw --prompt "a three-box flowchart with arrows"`.

A napkin script says what to draw in words, one instruction a line, and runs
with no window: into the same pages, layers and Bezier anchors the app draws by
hand, and out as SVG, PNG, PDF, a `.skbk` the app opens as editable work, or
a script that rebuilds it in Adobe Illustrator.

```napkin
napkin 1
page 400 300
background #fcfaf5
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 80 r 12
text "Acme Corp" at 200 70 size 28 align center
link "assets/logo.svg" at 20 120 size 120 120 name "Logo"
rough 0.5
circle 300 200 48
```

There are three ways in, and all three draw the same bytes from the same
script and seed.

**From a shell, a batch file or CI**, with no window and without loading
Electron:

```bash
napkin-sketch draw card.napkin --to svg,png,pdf,skbk --out out
napkin-sketch check card.napkin --json    # one line of JSON: the diagnostics, the exit code
```

**From Node**, as a dependency:

```ts
import { drawSvg } from 'napkin-sketch';
import { drawFile } from 'napkin-sketch/node';

const { svg, diagnostics } = drawSvg(text);
const { ok, files } = await drawFile('card.napkin', { out: 'out', formats: ['svg', 'png'] });
```

**From any other language**, with the script on standard input and one line of
JSON back, as the Python, C, shell and batch callers in
[docs/api/cli/examples/](../api/cli/examples) do:

```python
subprocess.run([shutil.which("napkin-sketch"), "draw", "-", "--json"], input=script, capture_output=True, encoding="utf-8")
```

What comes out:

- **SVG**, with the layer tree named three ways, so it opens with its layers in
  Illustrator and Inkscape, and a linked file kept as its reference.
- **PNG**, from the same rasterizer the composition API uses, with no canvas
  and no native library; a linked file is drawn from the folder the script is in.
- **PDF**, in vector, every page of a book in one document.
- **`.skbk`**, the book as the app saves it.
- **`.jsx`**, a script that, run in Adobe Illustrator, rebuilds the drawing
  there: its layers as layers and named groups, its marks as paths on their own
  anchors, its text as text frames, and a linked file placed as a linked file
  (see [Working with other programs](../api/interop/README.md#rebuilding-a-drawing-in-illustrator)).

A mistake in a script is reported, not thrown: `card.napkin:7:1: error
unknown-verb: ...`, exit code 2, and whatever could be drawn is still written.
A program that would rather not write the text builds the same script as JSON,
the object form, and checks it against
[the schema](../api/schema/instructions.schema.json). The language is one
table, so `napkin-sketch verbs` lists it, and `verbs --json` hands all of it to
an agent at once.

**Or from a sentence.** `napkin-sketch draw --prompt "a three-box flowchart
with arrows"` has an AI tool write the script first; napkin-sketch checks it,
keeps it as a `.napkin` beside the files, and draws it (see
[the scripting helper](ai-helpers.md#the-scripting-helper)).

**Or from a figure.** `napkin-sketch render hero.skbk --animate walk` draws
the character on the book's first page through the measured walk cycle:
eight frames, `hero-walk-1.svg` to `hero-walk-8.svg`, all cut to one box so
they play back without shifting, with no AI and no window. The script that
drew them is in the JSON report, and Animation Mode's **Draw measured
frames** draws the same in the app (see [Animation Mode](guide/animation-mode.md#animation-mode)).

**Or from a drawing.** In the app, **Automate > Generate Script** writes the
script for a file or for the selected layers, and shows it before you copy,
save or open it (see [Generating a script](guide/automate.md#generating-a-script)).

[API.md](../../API.md) maps the documentation - nine categories, each with a
reference, a quickstart and a cheatsheet - [API-QUICKSTART.md](../../API-QUICKSTART.md)
is the whole API in five steps, and [API-CHEATSHEET.md](../../API-CHEATSHEET.md) puts
every verb, flag and exit code on one page.
