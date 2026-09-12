# API Quickstart

From a fresh clone to a graphic you drew from a script, and to an AI helper
that can draw more of them in a style you already have.

Three things, in the order they are usually wanted:

1. [Draw a graphic in code](#1-draw-a-graphic-in-code) - no AI tool needed
2. [Plug in the helper](#2-plug-in-the-helper) - so `/graphic-designer:design-language` exists
3. [Capture a design language](#3-capture-a-design-language) - point it at an asset you already have

The full API reference is [API.md](API.md). This page is the path through it.

## 1. Draw a graphic in code

```bash
git clone https://github.com/isocialPractice/napkin-sketch
cd napkin-sketch
npm install
npm run build        # required: the API is used from dist/
```

Then, in a file next to the repository:

```js
// card.mjs
import { createComposition } from './dist/api/index.js';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });

design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fontSize: 28, fill: '#ffffff' });
design.circle({ cx: 180, cy: 220, r: 64, fill: '#4cae50' });

const { writeFile } = await import('node:fs/promises');
await writeFile('card.svg', design.toSVG(), 'utf-8');
await writeFile('card.png', design.toPNG());
```

```bash
node card.mjs        # writes card.svg and card.png
```

Both files come off the one composition, so they are the same graphic in two
formats. A page defaults to 360 by 360 pixels; coordinates are pixels unless
the page asks for `in`, `mm`, or `pt`.

**Installed as a dependency instead?** `import { createComposition } from
'napkin-sketch'` works the same way.

## 2. Plug in the helper

The `graphic-designer` helper is what makes
`/graphic-designer:design-language` a command you can type. There are two ways
to get it, and they differ in more than convenience.

### As a plugin (Claude Code)

```text
/plugin marketplace add .                              # from a clone
/plugin marketplace add isocialPractice/napkin-sketch  # without one
/plugin install graphic-designer@napkin-sketch
```

This is the delivery the plugin was designed for: the command, both skills, and
the contract arrive as one addressable unit, and the skills answer to
`graphic-designer:design-language` and `graphic-designer:graphic-design-api`.

### As files in your AI tool's folder

```bash
npm run ai-helper -- --helper graphic-designer          # -> .claude
npm run ai-helper -- --helper graphic-designer --to github   # -> .github
npm run ai-helper -- --list                             # every target and helper
```

This copies the skills, the contract, **and the command** into that folder:

```text
.claude/
├── commands/graphic-designer/design-language.md   ->  /graphic-designer:design-language
├── instructions/design-language.instructions.md
└── skills/
    ├── design-language/
    └── graphic-design-api/
```

The command lands in a folder named for the helper, so it answers to the same
`/graphic-designer:design-language` either way. Paths inside it are rewritten
on copy from the plugin-only `${CLAUDE_PLUGIN_ROOT}` to the repository-relative
folder, so the command's own instructions can be followed as written.

**Which to choose.** The plugin if your tool loads plugins; the files install
for a tool that only reads a dot-folder, or when you want the skills visible in
the working tree. Running both is fine but pointless - you get two copies of
the same four files.

## 3. Capture a design language

Point it at a graphic you already have. Anything the helper reports is
measured from the file; what a format cannot say, it says so rather than
guessing.

```text
/graphic-designer:design-language test/graphic-design-api/created-svg_graphic-api.svg
```

Add a destination when the file should land somewhere specific:

```text
/graphic-designer:design-language path/to/asset.svg docs/design/
```

or in plain words - "write `DESIGN_LANGUAGE.md` to `docs/design/`" means the
same thing.

That run does four things:

1. **Measures the asset.** Palette, and for a vector also type, stroke widths,
   corner radii, and an element census.
2. **Writes a `DESIGN_LANGUAGE.md`** into the destination - or
   `DESIGN_LANGUAGE-<stem>.md` when that directory already holds one, so a
   second asset never overwrites the first.
3. **Generates a skill named after the asset** in your AI tool's skills folder,
   carrying that language and a script that composes new work in it.
4. **Checks itself** by analyzing what the generated script drew and comparing
   the palette against the source's.

### Without an AI tool

The measuring half is a plain CLI. Nothing about it needs a model:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --colors 12
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --markdown
```

`--markdown` prints the body of a `DESIGN_LANGUAGE.md`: page size, palette with
shares and guessed roles, type, strokes, corners, and the element census.

### What each format can tell you

| Format | Palette | Type | Strokes, radii, structure |
| --- | --- | --- | --- |
| SVG | yes, weighted by how often each class is referenced | yes | yes |
| PNG | yes, decoded and quantized from the pixels | no | no |
| JPEG, GIF, WebP | no decoder | no | no |

Two things follow that are worth knowing before you read a report:

- **Prefer the vector.** When both exist, measure the SVG. The PNG agrees about
  colour and is silent about everything else.
- **The two weigh colour differently, and will sometimes disagree about rank.**
  A vector palette counts how often a colour is *referenced*; a raster palette
  how much area it *covers*. On the sample graphic the SVG ranks white first
  (hundreds of small text elements reference it) and the PNG ranks the navy
  first (it covers the page). Both are correct measurements of different
  things. **For deciding which colour is the ground, trust the raster.**

An empty palette always means "not measured", never "no colours" - and the
report's `notes` say which.

## 4. Use the skill you were handed

The helper generated a skill named after your asset. It is not documentation -
it is a tool with a script in it. Here is the whole loop, using the asset this
repository ships.

**See what you got.** `.claude/skills/<stem>/` holds three things:

```text
.claude/skills/<stem>/
├── SKILL.md              when to reach for it, and the language in brief
├── DESIGN_LANGUAGE.md    every measurement, and every reading
└── scripts/
    └── make-<stem>.mjs   draws new work in that language
```

Read `DESIGN_LANGUAGE.md` first, and specifically the parts that say which
values were **measured** and which were **read**. The readings are the ones you
may disagree with, and disagreeing with them is the point - in the shipped
example the analyzer's guess about which colour was the ground was wrong, and
the file says so and corrects it.

**Draw the default.**

```bash
node .claude/skills/<stem>/scripts/make-<stem>.mjs --out ./out
```

Look at `out/card.png`. It is deliberately plain. The point is not that it is
interesting; the point is that it is in the language.

**Change the content, not the language.**

```bash
node .claude/skills/<stem>/scripts/make-<stem>.mjs \
  --title "Acme Corp" --heading "Quarterly Summary" --out ./out
```

The constants at the top of the script *are* the language - palette, type
scale, page, spacing. Everything below them is layout. Changing a colour means
editing one constant, and if you find yourself editing a colour further down,
the script has drifted.

**Draw something structurally different.** A design language is not a template,
and the way to prove that to yourself is to make it carry something the source
never carried:

```bash
node .claude/skills/<stem>/scripts/make-<stem>.mjs --cheatsheet --out ./out
```

The worked example is
`test/graphic-design-api/generated-graphics/cheatsheet.png`: an HTML reference
in the language of a card that had no code in it at all.

**Check yourself.** This is the habit worth keeping:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs out/card.png --colors 6
```

Compare the shares against the source's. Agreement on ground, paper and accent
means you are still in the language. A right palette with a wrong *ratio* is
the most common way a generated graphic goes subtly wrong, and the shares say
so immediately where the eye does not.

### Two things about the raster

Both come from the same root - one set of coordinates, two renderers with
different font metrics - and both are worth knowing before you are surprised by
them:

- **Small text needs `--scale`.** The built-in alphabet the rasterizer draws is
  made of strokes, and below about 10 units that stroke is thinner than a
  device pixel at 1x, so it anti-aliases into grey. The shipped script rasters
  at 3x by default for exactly this reason. The composition does not change;
  only the sampling does.
- **Do not position runs with `measureText` when you have named a font.** It
  measures the built-in alphabet, not the family the SVG names. For text laid
  out token by token - a code panel, a legend, a table row - advance by the
  named font's own metric instead. Monospace makes that easy: Courier and
  Courier New are exactly `0.6 em` per character.

## A worked example

`test/graphic-design-api/design-language/DESIGN_LANGUAGE.md` is a real run of
this against `test/graphic-design-api/created-svg_graphic-api.svg`. It is worth
reading for one reason: the analyzer's mechanical guess about the colour roles
was **wrong**, and the file says so and corrects it from the raster
cross-check. That is the intended division of labour - the tool measures, you
read - and a design language that hides which half is which is not worth
keeping.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unknown command: /graphic-designer:design-language` | The helper is not plugged in | [Step 2](#2-plug-in-the-helper) |
| PNG palette empty, note mentions the API | The build output was not found | `npm run build` in the clone |
| `graphic-design API not found` from a generated script | Same cause, from the other direction | `npm run build`, or install `napkin-sketch` |
| The command runs but writes the file somewhere unexpected | No destination was given | Pass one, or name it in words |
| A second run overwrote nothing and made `DESIGN_LANGUAGE-<stem>.md` | Working as intended | That directory already had one |
| Generated graphic does not look like the source | The script drifted from the language | Analyze the output, compare the shares, fix the script - not the design language file |
| The graphic is mostly background | A paper element is missing | The shares say so at once; compare them against the source's |
| The last line of a listing is missing | It rendered under the footer | Look at the PNG, not the SVG - the vector will not show you |
| Text runs overlap in the SVG but look fine in the PNG | Runs were advanced by `measureText` | Advance by the named font's metric: `0.6 em` per character for monospace |
| Small text in the PNG is grey mush | The stroke is under a device pixel | Raster at `--scale 2` or `3` |
| Colours are right, the graphic still looks wrong | The palette is right and the ratio is not | Check the shares against the 60-30-10 the language declares |
| Editing a colour changed nothing | It was edited in the composition, not in the constants | The constants at the top of the script are the language |

## Where to go next

- [API.md](API.md) - every element, every property, the limits
- [ai-helper/graphic-designer/](ai-helper/graphic-designer/) - the helper itself
- [README.md](README.md#drawing-with-the-graphic-design-api) - how this fits
  beside the drawing app
