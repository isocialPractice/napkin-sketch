# Color and Type, in a composition

The accessibility floor and the token discipline from the general design skill,
restated for a static page composed in code.

## The 60-30-10 ratio, as numbers you can check

- **60** - the ground. Usually the page `background`, plus whatever large
  shapes extend it.
- **30** - the supporting mass. Panels, plates, the second family of shapes.
- **10** - the accent. One thing, marked once. Spending it twice halves it.

The `design-language` skill's analyzer reports each color's share, so this
ratio is measurable rather than a matter of opinion: run it over the rendered
PNG and read the shares back. A composition whose accent is 25% of the pixels
does not have an accent.

## Contrast

WCAG 2.2 AA applies to a graphic exactly as it does to a screen, and a graphic
gets read in worse conditions than a screen does - small, in a feed, on a phone,
outdoors.

| Content | Minimum |
| --- | --- |
| Body text | 4.5:1 |
| Large text (about 18pt, or 14pt bold) | 3:1 |
| Meaningful shapes and rules | 3:1 |

Computing it: contrast is a ratio of relative luminances,
`(L_lighter + 0.05) / (L_darker + 0.05)`, where each channel is linearized
(`c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055) ** 2.4`) and weighted
`0.2126 R + 0.7152 G + 0.0722 B`. `parseColor` from the API gives you the
bytes; the analyzer's `luminance()` gives you the rest.

Three cases that catch people out:

- **Text over a placed image.** Check against the worst region of the image,
  not its average. If that fails, put a solid plate behind the text - a `rect`
  costs one element and settles the question.
- **A transparent page.** `background: null` means the graphic lands on
  something unknown. Either set a background or check every text color against
  both white and black.
- **Accent-colored text.** The accent is chosen for saturation, which is
  usually the wrong axis for legibility. Saturated is not the same as dark.

## Never encode meaning by hue alone

Pair color with a shape, a position, or a label. In a composition that means:
a legend entry gets a `triangle` as well as a fill; a status gets a word as
well as a swatch. Roughly one man in twelve cannot separate your red from your
green, and a static graphic offers no tooltip to fall back on.

## Type

- **Two families maximum.** One display, one text. A third only for monospace
  when the graphic shows code or columns of figures.
- **Always a fallback stack**, not a single name:
  `fontFamily: "Helvetica, Arial, 'Liberation Sans', sans-serif"`. The SVG gets
  opened on machines you do not control, and a missing first choice silently
  becomes whatever the viewer had.
- **Derive sizes from a scale.** Pick a base and a ratio (1.250 major third,
  1.333 perfect fourth) and compute, rather than choosing each size by eye:

  | Step | 1.250 from 11 | 1.333 from 11 |
  | --- | --- | --- |
  | caption | 8.8 | 8.3 |
  | body | 11 | 11 |
  | subhead | 13.8 | 14.7 |
  | head | 17.2 | 19.5 |
  | display | 21.5 | 26.1 |

  Round to something writable. The scale is there to keep the steps
  proportional, not to be honoured to two decimals.
- **Line length via `maxWidth`.** 45 to 75 characters. At 11 units, that is
  roughly 190 to 320 units of width - which on a 360 page means body copy
  wants the full content column and not much less.
- **Line height** 1.4 to 1.5 for body, 1.1 to 1.25 for display. Set it as
  `lineHeight`, a multiple of the size, so it tracks when the size changes.
- **`baseline` says what `y` means.** `top` is usually what a layout wants;
  `alphabetic` is the default and is what a typographer wants.

## The thing about raster text

Both renderers **measure** with the same table, so line breaks, alignment and
block extent match between the SVG and the PNG to the unit. Only the glyph
shapes differ: the SVG sets your font family, the rasterizer draws a built-in
single-stroke alphabet.

Consequences for type decisions:

- Layout decisions are safe to make against either format.
- Appearance decisions - weight, family, letterfit - are decisions about the
  **SVG**. Judge them there.
- Do not compensate for the built-in alphabet's look by changing sizes or
  spacing. That improves one output by damaging the other.
- If the raster has to match a licensed face exactly, render the SVG through a
  browser instead. That is a different pipeline, and an honest one.

## Tokens, in a script

The token tiers from the general design skill collapse usefully here. Put the
whole language in named constants at the top of the composition script:

```js
const PALETTE = { paper: '#ffffff', ground: '#000133', ink: '#414042', accent: '#4cae50' };
const TYPE = { family: "Helvetica, Arial, sans-serif", display: 21, head: 17, body: 11, caption: 9 };
const PAGE = { width: 360, height: 360, margin: 24, gutter: 12, unit: 4 };
const SHAPE = { radius: 8, stroke: 2 };
```

That is the whole discipline: semantic names rather than raw values in the
calls, one place to change, and a diff that shows a design decision rather than
forty edited numbers. A script with `fill: '#4cae50'` written in nine places
has no design language, whatever the documentation says.
