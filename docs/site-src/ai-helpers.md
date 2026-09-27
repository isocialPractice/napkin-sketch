# The AI helpers

## The graphic-designer helper

The second plugin in `ai-helper/`, and the one that drives the
[graphic-design API](embed.md#drawing-with-the-graphic-design-api). It answers a
different question from Animation Mode: not "draw the next frame", but "what
design language is this graphic in, and how do I make more like it".

```text
/graphic-designer:design-language path/to/asset.svg
```

That reads the asset, writes a `DESIGN_LANGUAGE.md` describing what it found,
and generates a lightweight skill named after the asset - in the same tool
folder the helper was installed to - carrying that language plus a script that
composes new work in it through the API. The point is that a repeated graphics
job stops being a brief somebody re-explains each time.

**It also finds where the brand goes, and lets you fill it.** A design language
measured from one asset can say which box the logo occupies and never which
logo, because that is not a property of the file it measured. The generated
skill carries a `references/resources.md` for the second half:

```md
- logo: assets/logo.svg
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
```

In a `GLOBAL_ASSETS` folder the file name is the slot it fills, so `logo.svg`
fills the logo and `footer.png` the footer - adding an asset to the folder is
the whole of adding it to the brand. Three properties make it worth having:
nothing ever has to *ask* for the linked assets, a vector asset is inlined as
shapes so it draws in the PNG as well as the SVG, and a slot with nothing behind
it is filled with a mark in the design language rather than left as a hole. A
page with no brand configured is still a finished page.

The positions themselves are measured, not assumed: a vector whose layers are
named `logo`, `linkedMedia`, `tagline` or `brandName` has marked its own slots,
and failing a name the media is scanned a quarter of the page at a time, top
first. The report says which of the two it was - a name is exact, a scan is a
guess, and only one of them should be trusted without a look.

**And it leaves itself usable.** Generating a skill writes
`references/graphic-design-api.json`, which records the script, the project's
`resources.md`, where output goes, and what to draw when the request does not
say. That file is the difference between a skill that exists and one that can
be used without a manual, because it lets a request become a command with
nothing else supplied:

```text
/graphic-design-api make a html cheatsheet. ensure to include linked assets
/graphic-design-api generate
```

Both draw the same graphic. The first matches `cheatsheet` to a drawing mode;
the second matches nothing and falls through to the registered default. The
second sentence of the first line has never been necessary - linked assets are
included whenever `resources.md` names files that exist.

**It measures before it judges.** `skills/design-language/scripts/analyze-media.mjs`
is a dependency-free CLI that reports what a file actually says:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --colors 12
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --markdown
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --brand
node ai-helper/graphic-designer/skills/design-language/scripts/generate-skill.mjs asset.svg --to .claude/skills
node ai-helper/graphic-designer/skills/design-language/scripts/brand-resources.mjs --print
```

| Format | Palette | Type | Strokes, radii, structure |
| --- | --- | --- | --- |
| SVG | yes, weighted by how often each class is referenced | yes | yes |
| PNG | yes, decoded and quantized from the pixels | no | no |
| JPEG, GIF, WebP | no decoder | no | no |

One measurement is taken twice, deliberately. A vector palette counts how often
each colour is *referenced*; the analyzer also renders the file and counts how
much page each colour *covers*. Roles come from the second, because "which
colour is the ground" is an area question - hundreds of small white glyphs
outnumber one navy field that covers the page, and reference count gets it
exactly backwards. Both tables go in the design language file.

**The honesty is the feature.** An empty palette means "not measured", never
"no colors", and the report names what it could not read. A design language
whose values were guessed is worse than none, because the next asset gets drawn
to it. Decoding a PNG uses the graphic-design API, so a clone needs
`npm run build` first; the report says so rather than returning nothing.

The two skills are `design-language` (what to measure, the
`DESIGN_LANGUAGE.md` naming rules, and how to generate the per-asset skill) and
`graphic-design-api` (composing through the API with the visual judgment to
make the result good - hierarchy, 60-30-10, type scales, WCAG contrast on a
static page). Unlike `vectors`, nothing in the app runs this helper: there is
no install record and no feature switch, because there is no button that
spawns it.

## The scripting helper

The third plugin in `ai-helper/`, and the one behind
`napkin-sketch draw --prompt`. Its one skill, `napkin-script`, teaches an AI
tool napkin script - the two rules the parser holds a script to, how a page is
laid out, three complete scripts, and a verb reference `npm run api-docs`
generates from the verb table the parser reads - and its command,
`/scripting:draw`, writes one script from a form or from a request typed after
it.

```bash
napkin-sketch draw --prompt "a three-box flowchart with arrows" --to svg,png
```

The command line writes the request into `_temp/script-form.txt`, runs the
helper command there - `--helper`, else `$NAPKIN_SCRIPT_HELPER`, else Claude
Code - checks the script the tool saves to `_temp/script-out.napkin`, sends it
back once with its diagnostics when it has errors, and keeps it beside the
drawings as `<name>.napkin`, so drawing it again needs no AI. A tool that is
missing, signed out, or saves no script ends the command with exit code 4 and
says which. Install it as the others install:

```bash
npm run ai-helper -- --helper scripting   # or /plugin install scripting@napkin-sketch
```

Like graphic-designer, it has no install record and no switch: the app does
not run it yet.
