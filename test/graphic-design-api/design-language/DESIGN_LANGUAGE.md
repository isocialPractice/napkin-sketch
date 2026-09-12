# Design language: created-svg_graphic-api.svg

Measured from `../created-svg_graphic-api.svg` with
`ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs`,
then read. Every number below is **measured** unless it says otherwise; the
readings that follow each table are judgment, and are marked as such.

A second measurement of `../created-png_graphic-api.png` - the same graphic in
the other format - is used throughout as a cross-check, because the two
formats weigh colour differently and the disagreement is informative rather
than a problem. See **How the two measurements differ** at the end.

## Page

| Measured | Reading |
| --- | --- |
| 360 x 360.18 px | **360 x 360**. The 0.18 is an export artifact, not a decision. A square page. |

## Palette

Measured shares, weighted by how often each class is referenced in the SVG:

| Color | Share (vector) | Share (raster) |
| --- | --- | --- |
| `#000133` | 13.0% | **56.5%** |
| `#ffffff` | 40.9% | 26.1% |
| `#4cae50` | 2.4% | 5.8% |
| `#aef8b7` | 18.5% | - |
| `#f8f5ae` | 8.3% | - |
| `#8ce632` | 8.3% | - |
| `#fdc83a` | 4.3% | - |
| `#b4bec8` | 3.1% | - |
| `#326478` | 0.8% | - |
| `#414042` | 0.4% | 1.2% |

**Reading: the roles are not what the vector shares alone suggest.** The
analyzer's mechanical guess from the SVG was paper `#ffffff`, ink `#000133`,
accent `#fdc83a`, and that is the wrong way round. The raster measurement
settles it, because area is what the eye actually weighs:

| Role | Color | Share | Used for |
| --- | --- | --- | --- |
| **Ground (the 60)** | `#000133` | 56.5% | The page itself, and the code panel on it |
| **Paper (the 30)** | `#ffffff` | 26.1% | Plates the ground is interrupted by, and text on the ground |
| **Accent (the 10)** | `#4cae50` | 5.8% | Rules, the badge, the footer bar. One green, marking structure |

A near-textbook 60-30-10. The accent marks *structure* - where a section
begins and ends - rather than content, which is why it reads as calm despite
being a saturated green on a near-black navy.

**The syntax palette is a separate axis.** `#aef8b7`, `#f8f5ae`, `#8ce632`,
`#fdc83a`, `#b4bec8` carry 42% of the vector shares between them and almost
none of the area: they colour code tokens inside one panel. They are not brand
colors and must not be borrowed for anything structural. `#414042` and
`#326478` are incidental - ink on the white plates, and one placed mark.

## Type

| Measured | Reading |
| --- | --- |
| Families: `AlternateGotNo1D`, `FuturaPT-Book` | Two families, as it should be: a condensed grotesque for display, a geometric sans for text. Name a fallback stack for both - neither is safe to assume. |
| Sizes: 5.86, 7.32, 16.49, 20.61 | A **1.250 major third**, in two clusters. |

The scale, verified: 7.32/5.86 = 1.249, and 20.61/16.49 = 1.250. The gap
between the clusters (2.25x) is the gap between a heading and its body, not a
step in the scale.

| Step | Measured | Rounded intent | Role |
| --- | --- | --- | --- |
| Display | 20.61 | **20.5** | The title line |
| Head | 16.49 | **16.5** | Section heading on a plate |
| Small | 7.32 | **7.5** | Subheading, labels |
| Caption | 5.86 | **6** | Code and fine print |

Round to the intent. Sizes carried to two decimals are a scale factor somebody
exported through, and reproducing them exactly reproduces the artifact.

## Strokes

| Measured | Rounded intent | Reading |
| --- | --- | --- |
| 2.06 | **2** | Hairline rules that separate bands |
| 4.53 | **4.5** | The heavier bar that closes the page |

Two weights, roughly 1:2. No third weight appears, and adding one would read
as a mistake rather than as emphasis.

## Composition

Measured element census: 607 `tspan`, 217 `text`, 42 `path`, 29 `g`, 25
`rect`, 10 `clipPath`, 9 `polygon`, 3 `image`, 2 `line`.

**Reading**: a text-dominated layout built out of plates. The 25 rectangles are
bands and panels; the 10 clipping masks cut the 3 placed images into them. The
structure is horizontal - a title band, a rule, a plate, a panel, a footer -
which is what makes it legible at thumbnail size despite carrying a lot of
small type.

## Forbidden

- **Do not use the syntax colours structurally.** They belong inside a code
  panel and nowhere else.
- **Do not add a third stroke weight**, or a size outside the 1.250 scale.
- **Do not put body text on the ground colour at caption size.** `#ffffff` on
  `#000133` passes comfortably, but 6px of it does not survive a feed.
- **Do not let the accent mark content.** It marks where structure begins.

## How the two measurements differ, and why that matters

A vector palette is weighted by how often each colour is *referenced*; a raster
palette by how much area it *covers*. Here that produced two different answers
about which colour is the ground - the SVG ranked white first because hundreds
of small text elements reference it, and the PNG ranked the navy first because
it covers the page.

Both numbers are correct measurements of different things. The raster is the
one to trust for role assignment, and the vector is the one to trust for type,
strokes and structure, which a raster cannot report at all.

## What could not be measured

- **Spacing and the grid.** Margins and gutters are not declared anywhere in
  the file; they are implied by coordinates. Read them off the geometry if a
  layout has to match exactly.
- **Corner radii.** None declared - the plates are square-cornered.
- **The font files.** Family names were recorded; the faces themselves are not
  in the repository and may not be licensable. Give any generated script a
  fallback stack.
