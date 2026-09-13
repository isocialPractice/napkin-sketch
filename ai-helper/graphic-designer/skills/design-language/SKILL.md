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

**One measurement is taken twice, on purpose.** A vector palette counts how
often each colour is *referenced*; the analyzer also renders the file and
counts how much page each colour *covers*, and reports that as `areaPalette`.
Roles are decided from the area, because "which colour is the ground" is an
area question - hundreds of small white glyphs outnumber one navy field that
covers the page, and a role picked by reference count gets it exactly backwards.
Both numbers go in the file. Say which one you are quoting.

### 1a. Find where the brand sits

A design language that names the colours but not the positions is half written,
and the missing half is the one a generated script needs. The analyzer reports
it, two ways, in this order:

```bash
node scripts/analyze-media.mjs <file> --brand
```

- **By layer name.** A vector whose layers are called `logo`, `linkedMedia`,
  `tagline`, `brandName`, `icon` or `footer` has marked its own slots, and
  reading them is exact. Names are read from `id`, `data-name`,
  `inkscape:label`, `serif:id` and `aria-label`, so Illustrator, Inkscape,
  Affinity and Figma exports are all covered.
- **By scanning.** Failing a name, the media is read a quarter of the page at a
  time, top first, stopping at the first band holding a compact mark - ink that
  covers a little of the band and is gathered rather than spread across it the
  way a line of text is.

The difference matters and the report keeps it: a named slot carries
`found: 'named'` and a high confidence, a scanned one `found: 'scan'` and a low
one. **Confirm a scanned box by eye before drawing into it.** A scan has no idea
what a logo looks like; it knows what a compact mark looks like.

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
- **The brand positions.** Which box the logo occupies, which band carries
  placed media, where a tagline sits. `--markdown` writes these as a table; say
  which were named and which were guessed at.
- **What is forbidden.** The most useful line in a design language is usually
  the one that says what not to do.

### 3. Generate the per-asset skill

Generating is mechanical, so it is a script rather than a job for a model:

```bash
node scripts/generate-skill.mjs <asset> --to .claude/skills
node scripts/generate-skill.mjs <asset> --to .claude/skills --language docs/design
```

It measures the asset, writes the design language, scaffolds the skill, and
prints how to point it at a brand. Two rules about overwriting, and they differ
on purpose:

- **A design language file is never overwritten.** A second asset in the same
  folder gets `DESIGN_LANGUAGE-<stem>.md`, because a reader's corrections are
  the most valuable thing in the first one.
- **A skill is overwritten only after asking.** It is generated output, so
  regenerating is normal; it may have been edited since, so doing it silently is
  not. `--force` answers in advance, which is what a test passes.

Then read what it wrote and improve it. The generator gets the language right
and the layout only as right as arithmetic can: it knows the palette, the type
scale, the page and the slots, and it does not know what the graphic is for.

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
├── references/
│   └── resources.md          the brand this skill draws with
└── scripts/
    ├── make-<stem>.mjs       composes a new asset in that language
    └── brand-resources.mjs   resolves resources.md into placeable assets
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
import { writeComposition } from 'napkin-sketch/graphic-design/files';

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

### 5. Wire the brand slots

The design language says where the logo goes. It cannot say which logo, because
that is not a property of the asset it was measured from. `references/resources.md`
is the other half, and `references/resources.md` in *this* skill folder is its
full specification. The short version:

```md
- logo: assets/logo.svg
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
- tag line: This or That
```

A value with a folder separator or a media extension is a path; everything else
is text to draw. In a folder given as `GLOBAL_ASSETS` **the file name is the
slot it fills** - `logo.svg` fills the logo, `footer.png` fills the footer - so
adding an asset to the folder is the whole of adding it to the brand.

In the script, a slot is one call:

```js
import { resolveBrand } from './brand-resources.mjs';

const brand = await resolveBrand({ api, skillDir: SKILL_DIR });
brand.place(design, 'logo', { x: 292, y: 13, width: 45, height: 24 }, { fit: 'contain' });
```

Three properties of that call are the point of the whole design:

1. **A vector asset is inlined, not linked.** The rasterizer decodes PNG and
   nothing else, so an SVG logo placed as an image is in the SVG export and a
   hole in the PNG. `placeBrand` reads its shapes into the composition instead,
   so both renderers draw it and it stays vector.
2. **An unconfigured slot still draws.** With no asset behind it, the slot gets
   a mark in the design language - a monogram of the brand name on the accent,
   or a set wordmark. Obviously a placeholder, and never a hole. Pass
   `fallback: false` where a drawn mark would be wrong, as in a footer band
   where the alternative is a line of type.
3. **Nothing has to be asked for.** A caller never says "include the linked
   assets". If `resources.md` names files that exist, every graphic carries
   them; if it does not, every graphic is still complete.

Check what resolved before wondering why a graphic looks wrong:

```bash
node scripts/brand-resources.mjs --print
```

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
- **A relative path in `resources.md` is relative to that file.** Moving the
  file without rewriting its paths breaks every asset it names, silently,
  because a missing asset falls back to a drawn mark rather than failing.
  `generate-skill.mjs --resources` rewrites them on copy for exactly this
  reason.
- **A placeholder is not a configuration.** A generated `resources.md` ships
  with `path/to/logo.svg` and `TBD`, both of which the parser rejects, so a
  freshly generated skill draws exactly what it drew before the file existed.
  Do not replace those with plausible-looking values you do not have.
- **A brand asset that resolves to nothing is the quiet failure.** The fallback
  makes a page that looks finished and carries no brand. `--print` is the
  thirty-second check that catches it.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| PNG palette is empty and a note mentions the API | Run `npm run build` in the clone, or install `napkin-sketch` |
| JPEG or GIF reports no decoder | Re-save as PNG or SVG for measured numbers, or read the image and mark the values observed |
| SVG palette looks wrong | It is weighted by class references; check whether the file paints with inline attributes instead, and compare against a PNG export |
| Two assets, one design language | The second writes `DESIGN_LANGUAGE-<stem>.md`; do not merge them unless asked |
| Generated skill folder exists | Append `_0`, `_1`, ... Never overwrite |
| The logo is in the SVG and missing from the PNG | It was placed as an image; place it through `brand.place` so the vector is inlined |
| A graphic draws a monogram where a logo should be | The asset did not resolve; `node scripts/brand-resources.mjs --print` says which path failed |
| A copied `resources.md` stopped finding anything | Its relative paths were not rewritten for the new location |
| The brand slots are in the wrong places | They were scanned, not named. Check `found` in the report and correct the boxes by hand |
| The ground and the paper look swapped | Roles were read off the reference-weighted palette; use `areaPalette` |

## References

- `references/resources.md` - the brand file's full specification
- `scripts/analyze-media.mjs` - the analyzer, importable as `analyzeMedia`
- `scripts/generate-skill.mjs` - the generator, importable as `generateSkill`
- `scripts/brand-resources.mjs` - the brand resolver, importable as `resolveBrand`
- `scripts/template.md` - the fill-in-the-blank procedure
- The `graphic-design-api` skill - the composition API this generates against
- `API.md` at the repository root - the full API reference
