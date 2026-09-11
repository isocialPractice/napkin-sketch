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

## Failure modes, and what to do about them

| Symptom | Cause | Answer |
| --- | --- | --- |
| PNG palette empty, note names the API | The graphic-design API was not found | `npm run build` in a clone, or install `napkin-sketch` |
| Palette is a run of near-identical greys | Anti-aliased edges counted as colors | Drop them; they are edges, not decisions |
| Type sizes like 5.86, 16.49 | A design tool's scale factor, not intent | Round to the intended scale and say that you did |
| SVG and PNG palettes rank colors differently | A vector palette is usage-weighted, a raster's is area-weighted | Expected. Say which file was measured |
| Generated asset does not match the source | The script is not in the language yet | Fix the script; the design language file is the specification |

## The check that matters

Run the analyzer over the generated asset and compare its palette against the
source's. Paper, ink, and accent must agree. That comparison is the only
mechanical evidence that the captured language is the one the asset was drawn
in - everything before it is a claim.
