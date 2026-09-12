---
name: design-language
description: 'Read an existing graphic and write down the design language it was drawn in, then generate a per-asset skill that can draw more work in that same language. Use when asked to capture, document, extract, or reverse-engineer the visual style of an image (JPG, PNG, SVG, GIF); when a DESIGN_LANGUAGE.md is wanted for a logo, poster, card, social post, or brand asset; when new graphics must match an existing one; or when a repeated graphics task (social posting, thumbnails, banners) should become something a tool can run rather than a brief re-described each time. Covers what to measure in an asset and what cannot be measured, the DESIGN_LANGUAGE.md naming rules, generating the per-asset skill and its scripts, and composing the output through the napkin-sketch graphic-design API.'
---

# Design Language

Turn one finished graphic into two durable things: a written design language,
and a skill that can apply it. The point is not documentation for its own sake.
It is that "make another one like this" stops being a brief someone has to
re-explain, and becomes a script with a name.

## When to Use This Skill

- A graphic exists and more work has to match it
- A `DESIGN_LANGUAGE.md` is wanted for an asset, a logo, or a template
- A repeated graphics job (social posts, thumbnails, banners, cards) should be
  automated rather than redrawn by hand each time
- Someone asks what the colors, type, or spacing of an existing asset are

## The Procedure

### 1. Measure what the file actually says

Run the analyzer before reading the image yourself. It reports numbers; you
supply the judgment.

```bash
node scripts/analyze-media.mjs <file>              # JSON
node scripts/analyze-media.mjs <file> --markdown   # a DESIGN_LANGUAGE.md body
node scripts/analyze-media.mjs <file> --colors 12  # keep more of the palette
```

What each format can tell you, and what it cannot:

| Format | Palette | Type | Strokes, radii, structure |
| --- | --- | --- | --- |
| SVG | Declared colors, weighted by how often each class is referenced | Families and sizes, measured | Measured |
| PNG | Decoded and quantized from the pixels | **No** | **No** |
| JPEG, GIF, WebP | **No decoder** | **No** | **No** |

Two consequences worth taking seriously:

- **Prefer the vector original.** When both an SVG and a PNG of the same
  graphic exist, the SVG is the one to measure. The PNG agrees about color and
  says nothing about type.
- **A raster's palette is area-weighted; a vector's is usage-weighted.** The
  biggest share in a PNG is whatever covers the most pixels. In an SVG it is
  whatever the most elements reference. They usually agree about which colors
  are the paper and the ink, and they can disagree about rank. Say which file
  you measured.

For JPEG and GIF the analyzer will tell you it has no decoder. Read the image
yourself and write down what you see, marked as observed rather than measured.
Do not invent numbers a file did not give you.

### 2. Write the `DESIGN_LANGUAGE.md`

Write it where the caller asked. A destination given as an argument or in
plain words ("write it to `docs/design/`") is the destination; with none, it
goes beside the asset. Create the folder if it is missing.

Name it by this rule, which exists so a second asset never overwrites the
first:

- That directory holds no `DESIGN_LANGUAGE.md` yet: write `DESIGN_LANGUAGE.md`.
- One already exists there: write `DESIGN_LANGUAGE-<source-media-stem>.md`. For
  `logo.svg` that is `DESIGN_LANGUAGE-logo.md`; for `hero-banner.png`,
  `DESIGN_LANGUAGE-hero-banner.md`.

The check is per directory, not per repository, so the same asset documented
in two places gets the plain name in both.

`--markdown` gives you the measured half. Add the half that needs a designer:

- **Roles, not just values.** `#1f2328` is not a fact worth keeping; "ink, used
  for body text and rules, never for fills" is.
- **The ratio.** Which color carries roughly 60% of the page, which 30%, which
  10%. The analyzer's shares are the evidence; the reading is yours.
- **The type scale as a scale.** Sizes come back as a sorted list. Say which is
  the display size, which is body, which is caption, and what the step between
  them is.
- **The rhythm.** Margins, gutters, and the grid the elements sit on.
- **What is forbidden.** The most useful line in a design language is usually
  the one that says what not to do.

### 3. Generate the per-asset skill

Write a lightweight skill named after the source media file into the AI tool's
skills folder - the same target the helper was installed to (`.claude/skills/`,
`.github/skills/`, and so on; `npm run ai-helper -- --list` names them).

- Skill folder: `<target>/skills/<source-media-stem>/`
- If that folder already exists, add a suffix: `<stem>_0`, then `<stem>_1`, and
  so on. Never overwrite one.

The generated skill holds:

```text
<target>/skills/<stem>/
├── SKILL.md                  when to use it, and the language in brief
├── DESIGN_LANGUAGE.md        or a link to the one written in step 2
└── scripts/
    └── make-<stem>.mjs       composes a new asset in that language
```

Its `SKILL.md` frontmatter needs a `name` matching the folder and a
`description` that says which asset's language it carries and when to reach for
it - that description is the only thing a tool reads when deciding whether to
load it, so name the asset, the medium, and the occasion.

### 4. Make the script compose, not describe

The generated script uses the napkin-sketch graphic-design API, so the output
is a real SVG and a real PNG rather than a description of one. Load the
`graphic-design-api` skill for the full surface; the shape is:

```js
import { createComposition } from 'napkin-sketch';
import { writeComposition } from 'napkin-sketch/dist/core/graphic-design/files.js';

// The language, in one place, so a change is one edit.
const PALETTE = { paper: '#ffffff', ink: '#1f2328', accent: '#4c8faf' };
const PAGE = { width: 360, height: 360 };

export function compose({ title, body }) {
  const design = createComposition({ ...PAGE, background: PALETTE.paper });
  design.rect({ x: 0, y: 0, width: PAGE.width, height: 64, fill: PALETTE.accent });
  design.text({ x: PAGE.width / 2, y: 40, text: title, align: 'center', fontSize: 24, fill: PALETTE.paper });
  design.text({ x: 24, y: 96, text: body, fontSize: 12, maxWidth: PAGE.width - 48, fill: PALETTE.ink });
  return design;
}

await writeComposition(compose({ title: 'Acme Corp', body: 'Quarterly summary' }), './out', 'card');
```

Both formats come off the one composition, so the SVG and the PNG are the same
graphic. `scripts/template.md` is the fill-in-the-blank version of this step.

## Gotchas

- **The analyzer needs the API built to read a PNG.** In a clone, run
  `npm run build` first; as a dependency, `napkin-sketch` resolves on its own.
  If neither, the report says so rather than returning an empty palette as if
  the image had no colors.
- **Anti-aliased edges are not palette entries.** Quantizing already folds most
  of them away, but a PNG palette that reports a run of near-identical greys is
  describing edges, not decisions. Drop them.
- **A measured size is not a type scale.** An asset exported from a design tool
  often carries sizes like 5.86 and 16.49 - artifacts of a scale factor, not
  intent. Round to the scale the designer meant and say that you did.
- **Do not copy a font you cannot license.** Record the family name, and give
  the generated script a fallback stack that degrades sensibly.
- **The skill name is global.** Two skills with one name is an ambiguity the
  tool resolves by luck, which is why the collision rule above appends a suffix
  instead of overwriting.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| PNG palette is empty and a note mentions the API | Run `npm run build` in the clone, or install `napkin-sketch` |
| JPEG or GIF reports no decoder | Re-save as PNG or SVG for measured numbers, or read the image and mark the values observed |
| SVG palette looks wrong | It is weighted by class references; check whether the file paints with inline attributes instead, and compare against a PNG export |
| Two assets, one design language | The second writes `DESIGN_LANGUAGE-<stem>.md`; do not merge them unless asked |
| Generated skill folder exists | Append `_0`, `_1`, ... Never overwrite |

## References

- `scripts/analyze-media.mjs` - the analyzer, importable as `analyzeMedia`
- `scripts/template.md` - the fill-in-the-blank procedure
- The `graphic-design-api` skill - the composition API this generates against
- `API.md` at the repository root - the full API reference
