---
description: 'Contract for AI helper tools that capture a design language from a media file and generate the per-asset skill and scripts that apply it'
applyTo: '{DESIGN_LANGUAGE*.md,**/skills/**,**/*.svg,**/*.png}'
---

# Design language contract

The canonical rules for turning one graphic into a written design language and
a skill that applies it. The `design-language` skill is the procedure; this is
the contract - the part that must hold however the job was started, whether by
`/graphic-designer:design-language`, by a script, or by hand.

## What may be written down

**Measured** values come from the file. **Observed** values come from looking at
the image. **Invented** values are a defect.

| Source | Colors | Type | Strokes, radii, structure |
| --- | --- | --- | --- |
| SVG | measured | measured | measured |
| PNG | measured | observed | observed |
| JPEG, GIF, WebP | observed | observed | observed |

Every design language file must mark which of the three each value is. A reader
six months later cannot tell a measurement from a guess, and will draw to both
equally.

The analyzer never fabricates. When it cannot decode a file it says so in
`notes` and returns an empty palette; an empty palette means "not measured",
never "no colors".

## Naming

- **Design language file.** `DESIGN_LANGUAGE.md` when none exists. Otherwise
  `DESIGN_LANGUAGE-<stem>.md`, where `<stem>` is the source media filename
  without its extension: `logo.svg` gives `DESIGN_LANGUAGE-logo.md`.
- **Generated skill folder.** `<target>/skills/<stem>/`. If that exists,
  `<stem>_0`; if that exists, `<stem>_1`; and so on.
- **Never overwrite either.** Both rules exist for the same reason: a second
  asset must not silently replace the first one's language.
- **Skill names are global.** The generated `SKILL.md` declares `name: <stem>`
  matching its folder, and no two skills a tool can load may share a name.

## Where things go

The generated skill belongs in the AI tool folder this helper was installed to
(`.claude/`, `.github/`, `.codex/`, ...), which `npm run ai-helper -- --list`
names. Those folders are usually gitignored, and that is correct: a generated
skill is an artifact, not source.

The design language file belongs where the work is - beside the asset, or at
the project root when it describes the project's own look. Never write it into
the plugin.

## What the generated script must do

- Compose through the napkin-sketch graphic-design API, so the output is a real
  SVG and a real PNG rather than a description of one.
- Take the design language from named constants at the top of the file, so
  changing the language is one edit.
- Emit both formats from **one** composition. Two compositions rendered
  separately can drift; one composition rendered twice cannot.
- Accept the varying content (title, body, image) as parameters. A script that
  can only redraw the original asset has automated nothing.
- Resolve its brand slots from `references/resources.md`, and **draw a complete
  page whether or not one is configured**. A script that needs configuration
  before it produces anything has moved the work rather than automated it.

## Brand resources

A design language is measured from an asset, so it can record *where* a logo
goes and never *which* logo. `references/resources.md` carries the second half,
and three rules hold it together:

- **The file name is the slot.** In a folder declared as `GLOBAL_ASSETS`,
  `logo.svg` fills `logo` and `footer.png` fills `footer`. No manifest, and
  therefore no second place to fall out of step.
- **A vector asset is inlined, not linked.** The rasterizer decodes PNG and
  nothing else, so an SVG logo placed as an image is in the vector export and a
  hole in the raster - a defect invisible to any check made against one format.
  `placeBrand` reads its shapes into the composition instead.
- **An unconfigured slot is filled, not skipped.** It gets a mark in the design
  language: a monogram on the accent, or a set wordmark. Obviously a
  placeholder to anyone holding the real logo, and never a hole in the page.

A generated `resources.md` ships with values the parser rejects (`path/to/...`,
`TBD`), so a fresh skill is unconfigured by construction. **Never fill those in
with plausible values.** A brand name nobody gave you is worse than an empty
slot, because the empty slot is obviously empty and the invented one is not.

## Failure modes, and what to do about them

| Symptom | Cause | Answer |
| --- | --- | --- |
| PNG palette empty, note names the API | The graphic-design API was not found | `npm run build` in a clone, or install `napkin-sketch` |
| Palette is a run of near-identical greys | Anti-aliased edges counted as colors | Drop them; they are edges, not decisions |
| Type sizes like 5.86, 16.49 | A design tool's scale factor, not intent | Round to the intended scale and say that you did |
| SVG and PNG palettes rank colors differently | A vector palette is usage-weighted, a raster's is area-weighted | Expected. Say which file was measured |
| Generated asset does not match the source | The script is not in the language yet | Fix the script; the design language file is the specification |
| The logo is in the SVG and missing from the PNG | A vector was placed as an image rather than inlined | Place it through `placeBrand`, and read `warnings` |
| A graphic draws a monogram where a logo belongs | The declared asset did not resolve | `node scripts/brand-resources.mjs --print` names the path that failed |
| Brand slots are in the wrong places | They were scanned, not read off layer names | Check `found` in the report; correct the boxes by hand |
| Ground and paper look swapped | Roles were taken from the reference-weighted palette | Use `areaPalette`; area is what "the ground" means |

## The check that matters

Run the analyzer over the generated asset and compare its palette against the
source's. Paper, ink, and accent must agree. That comparison is the only
mechanical evidence that the captured language is the one the asset was drawn
in - everything before it is a claim.
