---
name: created-svg_graphic-api
description: 'Draw new graphics in the design language of created-svg_graphic-api.svg - a 360x360 square card on a near-black navy ground, interrupted by white plates, with a single saturated green marking structure and a 1.250 type scale in a condensed display face over a geometric sans. Use when a card, social post, cheatsheet, or panel has to match that asset; when a graphic is asked for "in the same style" as it; or when the navy/white/green system it defines should be applied to new content. Carries the measured design language and a script that composes it through the napkin-sketch graphic-design API.'
---

# created-svg_graphic-api

The design language of `test/graphic-design-api/created-svg_graphic-api.svg`,
and a script that draws new work in it. Read `DESIGN_LANGUAGE.md` beside this
file for the measurements and the readings behind them.

## The language in brief

| Role | Color | Share | Marks |
| --- | --- | --- | --- |
| Ground | `#000133` | 60 | The page, and the panel on it |
| Paper | `#ffffff` | 30 | Plates that interrupt the ground |
| Accent | `#4cae50` | 10 | Rules and bars - structure, never content |

- **Page**: 360 x 360, square.
- **Type**: a 1.250 major third - 20.5 display, 16.5 head, 7.5 small, 6 caption.
  A condensed grotesque for display over a geometric sans for text, each with a
  fallback stack.
- **Strokes**: two weights, 2 and 4.5. No third.
- **Shape**: square corners. The layout is horizontal bands.

## Drawing something new

```bash
node scripts/make-created-svg_graphic-api.mjs --title "Acme Corp" --out ./out
node scripts/make-created-svg_graphic-api.mjs --cheatsheet --out ./out
node scripts/make-created-svg_graphic-api.mjs --cheatsheet --scale 4 --out ./out
```

It writes an SVG and a PNG off one composition, so the two are the same
graphic. Pass `--help` for the rest.

**The raster is drawn at 3x by default**, and that is not a retina nicety. The
caption size in this language is 6 units, and the built-in alphabet draws that
with a stroke under one device pixel at 1x - the code panel comes out as grey
texture rather than text. 3x makes it legible. The design language is
unchanged; only the sampling is.

**Code tokens advance by `0.6 em`, not by `measureText`.** `measureText`
reports the built-in font, which is narrower than the Courier New the SVG
names, so a pen advanced by it leaves every token short and the next one prints
over the last. The script has `monoWidth()` for this; use it for anything laid
out token by token.

## What not to do

- Do not use the syntax colours (`#aef8b7`, `#f8f5ae`, `#8ce632`, `#fdc83a`,
  `#b4bec8`) for anything structural. They belong inside a code panel.
- Do not add a stroke weight or a type size outside the scale above.
- Do not let the accent mark content.

## Checking the result

Run the analyzer over what the script wrote and compare the palette against the
source's. Agreement on ground, paper, and accent means the script is still in
the language:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs out/card.png --colors 6
```
