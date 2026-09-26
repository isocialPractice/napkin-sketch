# The AI helpers

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

The `graphic-designer` helper reads a graphic you already have into a written
design language, and generates a skill that draws new work in it through the
[graphic design API](../compose/README.md); the `scripting` helper writes a
napkin script from a sentence. This page is the reference for plugging them
in, capturing a language, using the skill it hands you, giving it your brand
and drawing from a request - and for how an agent should read these pages and
write the napkin scripts they describe.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [Plug in the helper](#plug-in-the-helper)
  - [Capture a design language](#capture-a-design-language)
  - [Use the skill you were handed](#use-the-skill-you-were-handed)
  - [Give it your brand](#give-it-your-brand)
  - [Reading these pages as an agent](#reading-these-pages-as-an-agent)
  - [Writing napkin scripts that read clean](#writing-napkin-scripts-that-read-clean)
  - [Drawing from a request](#drawing-from-a-request)
  - [Troubleshooting](#troubleshooting)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

The helper is two skills and a command. `design-language` measures an asset
and writes what it found as a `DESIGN_LANGUAGE.md`, then generates a skill
named after the asset that carries the language, your brand's
`resources.md`, and a script that composes new work in it; `graphic-design-api`
carries the visual judgment that makes such work good. Everything the helper
reports is measured from the file, and what a format cannot say, it says so.

The other half of this category is the reader. These pages are written for
people and for agents alike: `docs/api/INDEX.json` maps every page with its
size, each category has a cheatsheet and a quickstart that are shorter than its
reference, and the command line hands the whole language over as JSON.

The `scripting` helper closes the loop from a sentence. Its `napkin-script`
skill teaches an AI tool the language from the verb table, so
`napkin-sketch draw --prompt "a three-box flowchart with arrows"` gets back a
script the parser accepts; napkin-sketch checks it, sends it back once with its
errors if it has any, keeps it beside the files, and draws it.

## The mental model

```text
 a graphic you have --design-language--> DESIGN_LANGUAGE.md + a skill named after the graphic
                                                 |
 references/resources.md: your brand ------------+--> make-<stem>.mjs --> card.svg, card.png, ...
                                                 |
 references/graphic-design-api.json -------------+--> "/graphic-design-api <request>" picks a mode and draws
```

The helper measures and generates; the generated script draws with the
composition API; the two files in `references/` say what your brand is and
which script a bare request runs.

```text
 "a three-box flowchart with arrows" --draw --prompt--> _temp/script-form.txt
                                                               |
                         an AI tool, with the napkin-script skill
                                                               |
 checked as check checks it <----------------- _temp/script-out.napkin
     | errors: sent back once, with the script and its diagnostics
     v
 flowchart.napkin, kept, and drawn: flowchart.svg, flowchart.png, ...
```

## Reference

### Plug in the helper

The `graphic-designer` helper is what makes
`/graphic-designer:design-language` a command you can type. There are two ways
to get it, and they differ in more than convenience.

#### As a plugin (Claude Code)

```text
/plugin marketplace add .                              # from a clone
/plugin marketplace add isocialPractice/napkin-sketch  # without one
/plugin install graphic-designer@napkin-sketch
```

This is the delivery the plugin was designed for: the command, both skills, and
the contract arrive as one addressable unit, and the skills answer to
`graphic-designer:design-language` and `graphic-designer:graphic-design-api`.

#### As files in your AI tool's folder

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

### Capture a design language

Point it at a graphic you already have. Anything the helper reports is
measured from the file; what a format cannot say, it says so rather than
guessing.

```text
/graphic-designer:design-language test/graphic-design-api/reference-graphics/created-svg_graphic-api.svg
```

Add a destination when the file should land somewhere specific:

```text
/graphic-designer:design-language path/to/asset.svg docs/design/
```

or in plain words - "write `DESIGN_LANGUAGE.md` to `docs/design/`" means the
same thing.

That run does five things:

1. **Measures the asset.** Palette, and for a vector also type, stroke widths,
   corner radii, and an element census.
2. **Finds where the brand sits.** A vector whose layers are named `logo`,
   `linkedMedia`, `tagline` or `brandName` has marked its own slots; failing a
   name, the media is scanned a quarter of the page at a time, top first. The
   report says which of the two it was, because a name is exact and a scan is a
   guess.
3. **Writes a `DESIGN_LANGUAGE.md`** into the destination - or
   `DESIGN_LANGUAGE-<stem>.md` when that directory already holds one, so a
   second asset never overwrites the first.
4. **Generates a skill named after the asset** in your AI tool's skills folder,
   carrying that language, a `references/resources.md` for your brand, and a
   script that composes new work in it.
5. **Checks itself** by analyzing what the generated script drew and comparing
   the palette against the source's.

Steps 1 to 4 are arithmetic, so they are also a plain CLI:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/generate-skill.mjs asset.svg --to .claude/skills
```

It asks before overwriting a skill that already exists, and it never overwrites
a design language file - a reader's corrections are the most valuable thing in
one.

#### Without an AI tool

The measuring half is a plain CLI. Nothing about it needs a model:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --colors 12
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --markdown
```

`--markdown` prints the body of a `DESIGN_LANGUAGE.md`: page size, palette with
shares and guessed roles, type, strokes, corners, and the element census.

#### What each format can tell you

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

### Use the skill you were handed

The helper generated a skill named after your asset. It is not documentation -
it is a tool with a script in it. Here is the whole loop, using the asset this
repository ships.

**See what you got.** `.claude/skills/<stem>/` holds four things:

```text
.claude/skills/<stem>/
├── SKILL.md                  when to reach for it, and the language in brief
├── DESIGN_LANGUAGE.md        every measurement, and every reading
├── references/
│   └── resources.md          your brand - see step 5
└── scripts/
    ├── make-<stem>.mjs       draws new work in that language
    └── brand-resources.mjs   resolves resources.md into placeable assets
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

### Give it your brand

The skill knows *where* a logo goes, because it measured that off the source
asset's own layer names. It cannot know *which* logo, because that is not a
property of the file it measured. One file closes the gap:

```text
references/resources.md            the project's, and the one a request uses
.claude/skills/<stem>/references/resources.md   the skill's own snapshot
```

The project's is the one to edit. The skill carries a copy made when it was
generated so it runs anywhere on its own, but a registered request always reads
the project's.

```md
- logo: assets/logo.svg
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
- tag line: This or That
```

A value with a folder separator or a media extension is a **path**; anything
else is **text to draw**. That single rule is why `example.com` prints as a
domain and `assets/logo.svg` is drawn as a file.

**In a `GLOBAL_ASSETS` folder the file name is the slot it fills.** `logo.svg`
fills the logo, `footer.png` fills the footer, `logo-mark.svg` fills `logoMark`.
There is no manifest, so adding an asset to the folder is the whole of adding it
to the brand.

Check what resolved before wondering why a graphic looks wrong:

```bash
node .claude/skills/<stem>/scripts/brand-resources.mjs --print
```

```text
resources: .claude/skills/<stem>/references/resources.md
  logo           assets/logo.svg -> /abs/path/assets/logo.svg
  footer         assets/footer.png -> /abs/path/assets/footer.png
  brandName      "Acme Corp."
configured: true
```

#### Being wired up

`generate-skill.mjs` writes one more file as its last act:

```text
references/
├── resources.md              what your brand is
└── graphic-design-api.json   which skill draws it, and what to draw by default
```

The second is the difference between a skill that exists and a skill that is
usable without a manual. It records the script, the project's `resources.md`,
the output folder, the modes the script can draw, and a `defaultRequest` - so a
request can become a command with nothing else supplied:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/brand-resources.mjs --registration
```

```text
registration: references/graphic-design-api.json
  skill:     created-svg_graphic-api
  script:    .claude/skills/created-svg_graphic-api/scripts/make-created-svg_graphic-api.mjs
  resources: references/resources.md
  output:    test/graphic-design-api/generated-graphics
  default:   "make a html cheatsheet. ensure to include linked assets"
  mode cheatsheet   --cheatsheet
  mode card
  run:       node .claude/skills/.../make-created-svg_graphic-api.mjs --cheatsheet --resources ... --out ...
```

Matching a request to a mode is deliberately dumb string matching - the request
is read for a mode's own keywords, and the default wins when none appear. That
is why `/graphic-design-api generate` works: `generate` contains no mode
keyword, so it falls through to whatever `defaultRequest` says. Anything
cleverer would need a model, and the point of this file is to be the part that
does not.

Two flags worth knowing:

- `--no-register` generates a skill without wiring anything up, for a project
  that manages its own paths.
- `--default-request "..."` sets what a bare request means. The shipped example
  sets it to `make a html cheatsheet. ensure to include linked assets`, which is
  also a small joke at its own expense: the second sentence has never been
  necessary.

#### Four things worth knowing

- **You never ask for the assets.** There is no "include the linked assets" to
  remember. If the paths resolve, every graphic carries them.
- **An SVG asset is inlined, not linked.** The rasterizer decodes PNG and
  nothing else, so a vector logo placed as an image would be present in the SVG
  and a hole in the PNG. Its shapes are read into the composition instead, so
  both formats draw it and it stays vector. Gradients, filters, patterns and
  `<use>` do not survive that, and each is reported rather than approximated.
- **Nothing configured is a working state.** Every brand slot falls back to a
  mark in the design language - a monogram on the accent, a set wordmark. A page
  with no brand is still a finished page.
- **A relative path is relative to `resources.md`.** Move the file and rewrite
  the paths, or the assets stop resolving - quietly, because a missing asset
  falls back to a drawn mark rather than failing. The generator rewrites them
  for you when it copies one.

#### Symlinked asset folders

A brand folder is often a link to somewhere else. That works, and the two
fixtures in `test/graphic-design-api/test-assets/` are exactly that - git
symlinks into `reference-graphics/links/`. One rule makes them portable: **a
symlink's target is resolved from the link's own directory**, so it reads
`../reference-graphics/links/logo.svg` and never
`test/graphic-design-api/reference-graphics/links/logo.svg`. A repository-root
path resolves on no clone at all, and because a missing asset falls back rather
than failing, the graphics come out looking plausible and wrong.

```bash
git ls-files -s test/graphic-design-api/test-assets/
# 120000 <sha> 0  test/graphic-design-api/test-assets/logo.svg
```

Mode `120000` and a forward-slash relative target is what makes a link resolve
on a Linux clone and render as a link on GitHub.

#### Two things about the raster

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

### Reading these pages as an agent

- **Start at `docs/api/INDEX.json`.** It lists every page with its category,
  its kind - reference, quickstart, cheatsheet, hub or schema - its first
  paragraph, and its length in lines and in rough tokens, so the smallest page
  that answers can be read first.
- **Read a cheatsheet before a reference.** A cheatsheet is tables and one-line
  examples; a quickstart is a path that runs as written; a reference page is
  everything, and long.
- **Get the language from the program, not the prose.**
  `napkin-sketch verbs --json` prints every verb's grammar, the categories, the
  shape names and every diagnostic code in one line, from the same table the
  parser reads.
- **Check a script built as JSON** against
  [`docs/api/schema/instructions.schema.json`](../schema/instructions.schema.json)
  before handing it over; `napkin-sketch check` is the full check.

### Writing napkin scripts that read clean

Patterns that give scripts the parser accepts the first time:

- **Start with `napkin 1` and a `page`.** Without the version line a script
  earns a warning, and `--strict` fails on it.
- **One instruction a line**, the verb first. Paint chains on one line -
  `color #1f2328 width 3 fill #ffe08a` - and nothing else does.
- **Numbers are pixels unless a unit says otherwise**: `10mm`, `0.5in`,
  `12pt`, and `50%` for a share of the page.
- **Wrap arithmetic in parentheses**: `circle (i * 40) 50 10`, never
  `circle i*40 50 10`.
- **Name things from the verb table**, not from another tool's vocabulary: a
  circle is `circle <cx> <cy> <r>`, a rounded box is `rect ... r 12`.
- **Run `napkin-sketch check - --json` and read the codes.** An
  `unknown-verb` or `expected-*` code means rewrite that line; an
  `unknown-asset` or `unknown-document` means the host has to hand something
  over; a warning alone draws.

```napkin
napkin 1
page 400 300
background #ffffff
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 260 r 16
text "Acme Corp" at 200 130 size 32 align center
```

### Drawing from a request

`napkin-sketch draw --prompt "<request>"` asks an AI tool for the script
instead of reading one, and draws it like any other:

```bash
napkin-sketch draw --prompt "a three-box flowchart with arrows" --to svg,png
```

It needs an agentic AI command-line tool on the PATH, and works best with the
`scripting` helper plugged in, which is how the tool learns the language:
`/plugin install scripting@napkin-sketch`, or
`npm run ai-helper -- --helper scripting` for the files.

- **The form.** napkin-sketch writes `_temp/script-form.txt` in the working
  folder: the request, the two rules the parser holds a script to - one
  instruction a line, names in double quotes - and the images and documents
  `--asset` and `--use` hand over. The working folder is where a project's
  installed skill is found.
- **The helper command** runs there, through the shell. It is `--helper` when
  given, else `$NAPKIN_SCRIPT_HELPER`, else Claude Code:
  `claude -p --model sonnet --dangerously-skip-permissions < _temp/script-form.txt`.
  Any tool that reads the form and saves a script works - the form goes to its
  standard input too - and one that prints the script instead of saving it is
  read from its reply.
- **The check, and one more try.** The tool saves the script to
  `_temp/script-out.napkin`, and napkin-sketch checks it as `check` would,
  with the images and documents it will draw with. With errors, the tool runs
  once more, the form carrying the script and every diagnostic. A script still
  wrong after that is drawn as far as it goes, and the command exits `2`.
- **The script is kept.** It is written beside the files as `<name>.napkin`,
  named as they are, so the drawing can be edited and drawn again without
  asking; with `--json` the report carries it too, as `script.text`, with
  `script.attempts` and `script.path`. The two `_temp` files are removed.
- **No script, exit `4`.** A tool that is not on the PATH, is not signed in,
  or finishes without a script ends the command with exit code `4`, nothing
  written, and `error.reason` saying which: `missing-tool`, `auth`,
  `no-script` or `other`.

Inside an AI tool, `/scripting:draw a three-box flowchart with arrows` writes
the script as `flowchart.napkin` in the working folder, and the same command
with no request answers a form napkin-sketch left.

**Asking well.** The tool reads the request and nothing else, so a request
that says what matters draws it the first time:

- **Say what it is, and what it holds**: "a three-box flowchart - Plan, Build,
  Ship - with arrows between the boxes", not "a process diagram".
- **Give the size or the shape** when it matters: "a 1200 by 630 banner", "a
  square badge".
- **Name the colors or the look**: "navy on white", "hand-drawn", "Acme's
  yellow, #ffe08a".
- **Name what to call it**: "call it onboarding" sets the page's name, and so
  the files'.
- **Hand over the images it should place**, with `--asset logo=art/logo.png`,
  and say where they go: "the logo top left".
- **One drawing a request.** Several pages are a script to write, and a request
  that asks for five things gets a compromise of each.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unknown command: /graphic-designer:design-language` | The helper is not plugged in | [Step 2](#plug-in-the-helper) |
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
| A monogram is drawn where the logo should be | The declared asset did not resolve | `node scripts/brand-resources.mjs --print` names the path that failed |
| The logo is in the SVG and missing from the PNG | It was placed as an image rather than inlined | Place it through `brand.place`, and read the `warnings` |
| A copied `resources.md` stopped finding anything | Its relative paths were not rewritten for the new location | Rewrite them, or copy with `generate-skill.mjs --resources` |
| `/graphic-design-api generate` says nothing is wired up | No registration above the working directory | Run `generate-skill.mjs`, or `npm run test:graphic-design-api` for the shipped example |
| A request draws the wrong thing | It matched a different mode's keyword | `--registration` prints the modes and what each one answers to |
| The registration names a script that is gone | The skill was deleted or regenerated elsewhere | Re-run `generate-skill.mjs`; `usable: false` is what the reader reports |
| A symlinked asset resolves for you and nobody else | The link stores a repository-root path | Retarget it relative to the link's own directory |
| The ground and the paper look swapped | Roles were read off the reference-weighted palette | Use the `Palette by area` table; area is what "the ground" means |
| `draw --prompt` exits 4, `missing-tool` | The AI tool is not on the PATH | Install it, or name another with `--helper` or `NAPKIN_SCRIPT_HELPER` |
| `draw --prompt` exits 4, `auth` | The tool is installed and not signed in | Run the tool once in a terminal and sign in |
| `draw --prompt` exits 4, `no-script` | The tool finished without saving or printing a script | Plug in the `scripting` helper; its skill says where to save |
| The drawing is not what was meant | The request left it open | Say what it holds, its size and its colors; or edit the kept `.napkin` |

## Worked examples

**A design language, measured and read.** `test/graphic-design-api/design-language/DESIGN_LANGUAGE.md` is a real run of
this against `test/graphic-design-api/reference-graphics/created-svg_graphic-api.svg`. It is worth
reading for one reason: the analyzer's mechanical guess about the colour roles
was **wrong**, and the file says so and corrects it from the raster
cross-check. That is the intended division of labour - the tool measures, you
read - and a design language that hides which half is which is not worth
keeping.

That particular correction is now made for you. The analyzer renders the vector
and counts how much page each colour *covers*, reports it as a second table,
and decides the roles from that rather than from how often each colour is
*referenced* - because "which colour is the ground" is an area question. Both
measurements stay in the file. The reading still belongs to you; there is just
one fewer wrong default to catch.

`test/graphic-design-api/generated-graphics/` holds what
`npm run test:graphic-design-api` draws: the same language as a card and as an
HTML cheatsheet, both carrying the logo and footer that `resources.md` names.

**A request, drawn and kept.** With the `scripting` helper plugged in:

```bash
napkin-sketch draw --prompt "a three-box flowchart - Plan, Build, Ship - with arrows, call it flowchart" --to svg,png
```

prints `flowchart.napkin`, `flowchart.svg` and `flowchart.png`, and the script
is one like the first of the `napkin-script` skill's three examples - boxes,
labels and arrows each on a layer of their own. What a tool writes varies from
run to run; what it saved does not, so `napkin-sketch draw flowchart.napkin`
draws the same picture again with no AI at all.

**A script an agent wrote, checked, then drawn.** An agent hands a script over
on standard input, reads the diagnostics as JSON, and draws once it checks
clean:

```bash
napkin-sketch check - --json < card.napkin      # {"ok":true,...} or the diagnostics to fix
napkin-sketch draw - --json --to svg,png < card.napkin
```

## Limits

- **A request draws what the tool reads into it.** Two runs of one request
  can write two different scripts; the kept `.napkin` is what repeats.
- **One more try, not a conversation.** A script with errors goes back once,
  with its diagnostics; after that it is drawn as far as it goes.
- **`--prompt` is the command line's.** The app has no box to type a request
  into yet, and `napkin-sketch/node` exports no call for it.
- **The helper is an AI tool the user runs.** napkin-sketch starts it and reads
  what it saved; the tool's sign-in, its model and its cost are its own.
- **The analyzer reads SVG and PNG.** JPEG, GIF and WebP have no decoder, so
  their palette comes back empty and the report says why.
- **A request is matched to a mode by its words.** The registration matches a
  mode's own keywords and falls back to the default request; there is no model
  in that step, on purpose.
- **A missing asset is quiet.** A brand path that does not resolve falls back
  to a drawn mark rather than failing, so check `--print` when a graphic looks
  wrong.

## For agents

- **Read `INDEX.json`, then a cheatsheet**, and a reference page only when
  those do not answer.
- **Trust measurements over readings.** A `DESIGN_LANGUAGE.md` marks which
  values were measured and which were read; question the readings.
- **Check the output against the source.** `analyze-media.mjs out/card.png
  --colors 6` gives the shares to compare; a right palette at a wrong ratio is
  the usual way a generated graphic drifts.
- **Edit the constants, not the layout,** when a generated script's colors are
  wrong: the constants at the top are the language.
- **For napkin scripts, check before you draw**, and branch on the diagnostic
  `code`, never the message.
- **An agent that can write a script should write it** and draw it with
  `draw -`: `--prompt` starts a second AI tool, which is the right call for a
  person or a program with no model of its own.
- **With `draw --prompt --json`, read `script.text`** for the script, and
  branch on `exitCode` `4` and `error.reason` when no script came back.

## See also

- [The graphic design API](../compose/README.md): what the generated scripts
  call.
- [The napkin-sketch command line](../cli/README.md): `check`, `draw` and
  `verbs --json`.
- [The napkin script language](../language/README.md): what an agent writes.
- [`ai-helper/graphic-designer/`](../../../ai-helper/graphic-designer/) and
  [`ai-helper/scripting/`](../../../ai-helper/scripting/): the helpers
  themselves.
- [The napkin-script skill](../../../ai-helper/scripting/skills/napkin-script/SKILL.md)
  and [its verb reference](../../../ai-helper/scripting/skills/napkin-script/references/verbs.md),
  generated from the verb table.
