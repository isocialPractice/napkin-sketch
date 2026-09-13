# resources.md

The file that tells a generated skill what your brand actually is.

A design language is measured from one graphic, so it can say *where* a logo
goes and never *which* logo. This file is the other half. Fill it in once and
every graphic the skill draws carries your marks; leave it empty and the skill
still draws - it fills the brand areas with elements in the design language
instead of leaving holes.

Copy this file to `references/resources.md` inside your generated skill, or let
the generator write it for you.

## The format

A markdown list. Headings, prose and `>` notes are ignored, so the file can
explain itself to whoever edits it next and still parse.

```md
- logo: assets/logo.svg
- icon: assets/icon.png
- GLOBAL_ASSETS: assets/brand/
- brand name: Acme Corp.
- domain: example.com
- tag line: This or That
```

Keys are matched loosely on purpose: `GLOBAL_ASSETS`, `Global Assets` and
`global-assets` are the same key, and so are `tag line`, `tagLine` and
`tagline`. Spend the attention on the values.

## What a value means

A value is a **path** when it has a folder separator or a media extension, and
**text** otherwise. Nothing else distinguishes them, which is why
`example.com` is a domain to print and `assets/example.com.svg` is a file to
draw.

| Key | Value | Fills |
| --- | --- | --- |
| `logo` | one file | the `logo` slot |
| `icon` | one file | the `icon` slot |
| `wordmark` | one file | the `wordmark` slot |
| `assets`, `GLOBAL_ASSETS` | a **folder** | every slot a file in it is named for |
| `brand name` | text | the `brandName` slot, and the fallback monogram |
| `domain` | text | the `domain` slot |
| `tag line` | text | the `tagline` slot |

Anything else you write becomes a slot of its own: `- seal: assets/seal.svg`
fills a slot named `seal`, and a script that asks for one gets it.

### The folder rule

In a folder given as `assets` or `GLOBAL_ASSETS`, **the file name is the
descriptor**. `logo.png` fills `logo`, `footer.png` fills `footer`,
`logo-mark.svg` fills `logoMark`. There is no manifest to keep in step, and
adding an asset to the folder is the whole of adding it to the brand.

A single key always beats the folder, so `- logo: assets/override.svg` wins
over `assets/logo.svg` sitting in the global folder.

### Paths

Relative to this file first, then to the directory you run from. Absolute paths
work. Symlinks are followed, which is what makes a shared asset folder
checked in as git symlinks resolve the same way on every clone.

## What happens to each format

| Asset | In the SVG | In the PNG |
| --- | --- | --- |
| `.svg` | inlined as shapes | **inlined as shapes** |
| `.png` | embedded | decoded and drawn |
| `.jpg`, `.gif`, `.webp` | embedded | skipped, and reported in `warnings` |

The middle column is the one worth understanding. The rasterizer decodes PNG
and nothing else, so an SVG logo placed as an image would be a hole in every
PNG the skill exports. Instead the asset's shapes are read and added to the
composition, which means both renderers draw the same mark - and the mark scales
without ever going soft, because it is still vector geometry.

The cost is the honest one: gradients, filters, patterns, `<use>` references
and elliptical arcs do not survive that translation, and each is reported
rather than approximated. A logo built from solid shapes comes through exactly.
A logo built from a mesh gradient should ship as a PNG.

## When it is not configured

Nothing breaks. Each brand slot falls back to a mark drawn in the design
language: a monogram of the brand name on the accent color, a wordmark, or the
element the language itself uses in that position. It is obviously a
placeholder to anyone holding the real logo, which is the point - it fills the
composition without pretending to be a brand it is not.

## Checking it

```bash
node scripts/brand-resources.mjs --print
node scripts/brand-resources.mjs --print --resources path/to/resources.md
```

It prints every slot, the file it resolved to, and whether that file exists. A
declared path that does not resolve is the single most common way a graphic
comes out wrong, and it is reported rather than quietly falling back.

## Template

Copy from here down.

```md
# Brand resources

Paths are relative to this file. Delete what you do not have.

- logo: path/to/logo.svg
- icon: path/to/icon.png
- GLOBAL_ASSETS: path/to/assets/
- brand name: Acme Corp.
- domain: example.com
- tag line: This or That
```
