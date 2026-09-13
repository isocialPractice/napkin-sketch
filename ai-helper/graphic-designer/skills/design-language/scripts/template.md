# Template: one asset to a working skill

Fill this in top to bottom. Every blank is something the analyzer told you or
something you decided; nothing here is meant to be guessed.

## 0. Inputs

| Blank | Value |
| --- | --- |
| Source media file | `<path>` |
| Stem (filename without extension) | `<stem>` |
| Install target for generated skills | `<target>` (`.claude`, `.github`, ...) |
| Does `DESIGN_LANGUAGE.md` already exist? | yes / no |

## 1. Measure

```bash
node scripts/analyze-media.mjs <path> --colors 12
node scripts/analyze-media.mjs <path> --markdown > /tmp/measured.md
```

Record:

- Page: `<width>` x `<height>` `<units>`
- Palette, with shares: `<hex>` `<pct>` ...
- Roles the analyzer guessed: paper `<hex>`, ink `<hex>`, accent `<hex>`
- Type families: `<family>` ...
- Type sizes: `<n>` ...
- Stroke widths: `<n>` ...
- Corner radii: `<n>` ...
- Anything the report said it could not measure: `<note>`

If the source is a JPEG or a GIF there will be no numbers. Read the image and
write each value down as **observed**, not measured.

## 2. Decide what the numbers mean

The analyzer stops here; this part is judgment.

- Which color carries ~60% of the page? `<hex>` - the ground
- Which carries ~30%? `<hex>` - the supporting mass
- Which carries ~10%? `<hex>` - the accent, and what is it allowed to mark
- Round the measured type sizes to the scale actually intended:
  display `<n>`, body `<n>`, caption `<n>`, step `<ratio>`
- Margin `<n>`, gutter `<n>`, and what the grid is
- Corner radius as a rule, not a list: `<n>` for `<which elements>`
- Three things this design language forbids: `<...>`

## 3. Write the design language file

Name by the rule:

- No `DESIGN_LANGUAGE.md` yet -> `DESIGN_LANGUAGE.md`
- One exists -> `DESIGN_LANGUAGE-<stem>.md`

Start from `/tmp/measured.md` and add the decisions from step 2. Sections:
Page, Palette (with roles and ratio), Type (as a scale), Spacing, Shape,
Composition, Forbidden, and what could not be measured.

## 4. Generate the skill

Folder: `<target>/skills/<stem>/`, or `<stem>_0`, `<stem>_1`, ... if taken.

```text
<target>/skills/<stem>/
├── SKILL.md
├── DESIGN_LANGUAGE.md
├── references/
│   └── resources.md
└── scripts/
    ├── make-<stem>.mjs
    └── brand-resources.mjs
```

`node scripts/generate-skill.mjs <asset> --to <target>/skills` writes all of
that. Work through the steps below where you are improving on what it wrote.

`SKILL.md` frontmatter:

```yaml
---
name: <stem>
description: '<what asset this is the language of, in what medium, and the occasions to reach for it - the only text a tool reads when deciding to load it>'
---
```

## 5. Write the composing script

```js
import { createComposition } from 'napkin-sketch';
import { writeComposition } from 'napkin-sketch/graphic-design/files';
import { resolveBrand } from './brand-resources.mjs';

const PALETTE = { paper: '<hex>', ink: '<hex>', accent: '<hex>' };
const TYPE = { display: <n>, body: <n>, caption: <n>, family: '<family stack>' };
const PAGE = { width: <n>, height: <n> };
const SPACING = { margin: <n>, gutter: <n> };
const SLOTS = { logo: { x: <n>, y: <n>, width: <n>, height: <n> } };

export function compose(brand, { title, body }) {
  const design = createComposition({ ...PAGE, background: PALETTE.paper });
  brand.place(design, 'logo', SLOTS.logo, { fit: 'contain', accent: PALETTE.accent });
  // ... the rest of the composition, in the language above
  return design;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const brand = await resolveBrand({ skillDir: SKILL_DIR });
  await writeComposition(compose(brand, { title: 'Acme Corp', body: 'Sample body' }), './out', '<stem>');
}
```

Keep the constants at the top and the composition below them: a change to the
language should be one edit, not a search.

## 5a. Fill in `references/resources.md`

The slots are boxes; this is what goes in them.

```md
- logo: assets/logo.svg
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
```

A value with a separator or a media extension is a path, everything else is
text. In a `GLOBAL_ASSETS` folder the file name is the slot: `logo.svg` fills
the logo, `footer.png` the footer.

Leave it as generated and nothing breaks - each slot draws a mark in the design
language instead. Never fill it with plausible values you do not have; a
placeholder that parses is worse than one that does not.

## 6. Check it

- Run the script; it writes an SVG and a PNG of one composition
- Re-run the analyzer on the **generated** file and compare its palette against
  the source's. They should agree on paper, ink, and accent
- If they do not, the script is not in the language yet - fix the script, not
  the design language file
- Run `node scripts/brand-resources.mjs --print` and read what resolved. An
  asset that silently failed to resolve draws a fallback mark, which is a page
  that looks finished and carries no brand
- Look at the **PNG**, not only the SVG. A vector asset placed as an image
  rather than inlined is present in one and missing from the other
