---
name: graphic-design-api
description: 'Compose finished graphics in code through the napkin-sketch graphic-design API, with the visual judgment to make them good. Use when generating or editing a static graphic - a card, poster, banner, social post, badge, diagram, certificate, thumbnail, or template - from a script rather than by hand; when a composition must be produced in both SVG and PNG; when an existing composition script needs its hierarchy, palette, type scale, or spacing improved; or when a design language has to be turned into a working script. Covers the element vocabulary (rectangles, circles, ellipses, triangles, polygons, paths, styled text, placed media, groups, clipping masks), the 360x360 default page and unit system, the shared text layout both renderers measure with, the 60-30-10 color ratio, type scales, WCAG contrast on a static page, and the limits the API is honest about.'
---

# Graphic Design API

Apply professional visual design judgment to graphics that are **composed in
code**. This is the general design skill pointed at one specific surface: the
napkin-sketch graphic-design API, where a composition is a page and a list of
elements, and one document renders to both SVG and PNG.

The judgment half is unchanged from designing anything else - hierarchy first,
whitespace before borders, contrast that passes. What changes is that every
decision has to be expressible as a number in a call, which is a discipline
rather than a limitation: a design you cannot write down is one you cannot
repeat.

## When to Use This Skill

- Generating a static graphic from a script: card, poster, banner, social post,
  badge, diagram, thumbnail, certificate
- One graphic is needed in both vector and raster
- An existing composition script has weak hierarchy, an ad-hoc palette, or
  arbitrary spacing
- A captured design language (see the `design-language` skill) has to become a
  working script

## The API in one page

```js
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });

design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.circle({ cx: 180, cy: 220, r: 64, fill: '#4cae50' });
design.ellipse({ cx: 180, cy: 300, rx: 60, ry: 20, fill: 'none', stroke: '#326478', strokeWidth: 2 });
design.triangle({ x: 24, y: 260, width: 40, height: 36, variant: 'up', fill: '#fdc83a' });
design.polygon({ points: [ /* ... */ ], fill: '#b4bec8' });
design.line({ x1: 24, y1: 140, x2: 336, y2: 140, stroke: '#4cae50', strokeWidth: 2 });
design.path({ d: 'M 24 180 C 80 160, 140 200, 200 180', fill: null, stroke: '#dc143c', strokeWidth: 3 });
design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fontSize: 28, fill: '#ffffff' });
design.image({ src: dataUrl, x: 116, y: 156, width: 128, height: 128, fit: 'cover', clip: 'badge' });
design.group({ translate: { x: 0, y: 240 } }, (g) => { /* children */ });
design.defineClip('badge', { type: 'circle', cx: 180, cy: 220, r: 64 });

const svg = design.toSVG();
const png = design.toPNG();
```

Defaults worth knowing: a page is **360 by 360 pixels** unless it names a size,
coordinates are **pixels** unless the page names `in`, `mm`, or `pt`, the
background is **transparent** unless set, and the API is **headless** - it
never touches whatever sketch is open in the app.

Full reference, every property, and worked examples: `API.md` at the
repository root.

## Core Decision Framework

Every visual decision answers three questions, in this order:

1. **Where does the eye land first?** The primary element must win the
   contrast, size, and position battle. Squint at the rendered PNG; if the
   headline stops dominating, the hierarchy is broken. On a static page there
   is no interaction to rescue a weak focal point.
2. **What has to read as related?** Use proximity and alignment before you
   reach for a dividing `line` or an outlining `rect`. Whitespace groups more
   cleanly than rules, and it costs no elements.
3. **What can come out?** A composition has no progressive disclosure. Every
   element is visible at all times, so every element has to earn the space.

## Visual System Defaults

Starting points. Deviate with a reason, and write the reason down.

| System | Default | Notes |
| --- | --- | --- |
| Color ratio | **60-30-10** (ground / support / accent) | The page background is usually the 60; the accent marks one thing |
| Type scale | 1.250 (major third) or 1.333 (perfect fourth) | Derive sizes from one base; do not pick each by eye |
| Base unit | 4 or 8 units of spacing | Every `x`, `y`, and gap a multiple. No `x: 23` |
| Margin | 24 on a 360 page (about 7%) | Scale it with the page, not with the content |
| Body text | 11 units on a 360 page | Below about 9 it stops reading at thumbnail size |
| Line length | 45 to 75 characters | Set `maxWidth` to enforce it rather than trusting the copy |
| Line height | 1.4 to 1.5 body, 1.1 to 1.25 display | Tight headings, generous body |
| Corner radius | One scale (4 / 8 / 16, or full) | Mixing arbitrary radii is the fastest way to look unconsidered |

## Color and Contrast

- **WCAG minimums still apply to a graphic**: 4.5:1 for body text, 3:1 for
  large text. A social post read on a phone in sunlight is the worst case, not
  the best.
- **Check the pair you actually painted.** The API takes any CSS color, and
  `parseColor` will give you the bytes to compute a ratio with. Do the check
  rather than trusting a swatch's reputation.
- **Never encode meaning by hue alone** - pair color with a shape, a label, or
  a position. A viewer with deuteranopia reads the layout, not the palette.
- **A transparent page is a decision.** `background: null` means the graphic
  lands on something unknown, so every contrast check has to assume the worst
  background it might meet. Set a background unless transparency is the point.
- **The 60 is usually the page.** If the background is doing less than half the
  work, the composition is probably too busy.

## Typography

Text in this API has one property that changes how to think about it: **line
breaking and alignment are computed once and used by both renderers**, so the
SVG and the PNG agree on where every line sits. Glyph shapes do not - the SVG
uses the font family you named, the rasterizer draws a built-in single-stroke
alphabet.

What follows from that:

- **Two families maximum**, as always. One display, one text.
- **Always name a fallback stack.** `fontFamily: "Georgia, 'Times New Roman',
  serif"`, not `"Georgia"`. The SVG is opened on machines you do not control.
- **Set `maxWidth` on anything longer than a label.** It is what turns a line
  length rule into a constraint the layout enforces.
- **Do not fine-tune the raster's glyph positions.** They come from the
  built-in alphabet, and tuning against it makes the SVG worse.
- **Sizes come from the scale.** A measured size like 16.49 is an artifact of
  somebody's export scale factor; round it to the scale you meant.
- **`baseline` says what `y` means.** `alphabetic` by default, but `top` is
  usually what a layout wants, because a layout thinks in boxes.

## Layout

- **Work on a grid and say what it is.** A 360 page with a 24 margin and a
  12 gutter leaves 312 of content; three columns of 96. Write those numbers as
  constants at the top of the script.
- **Group what moves together.** A `group` with a `translate` is how a block
  gets repositioned in one edit rather than six.
- **Clipping masks are composition, not decoration.** A shared `defineClip` is
  how several elements get cut to the same shape, which is what makes a set of
  cards look like a set.
- **Place media by its box, and let `fit` do the rest.** `cover` fills and
  crops, `contain` fits and letterboxes. Choosing the wrong one is the most
  common way a placed logo ends up distorted.
- **Order is depth.** Later elements paint over earlier ones. There is no
  z-index to reach for and no elevation model - if something needs to sit on
  top, it goes later in the list.

## What this API does not do

Named plainly, because designing around a limit beats discovering it:

- **No gradients, filters, or patterns.** Solid paint, opacity, and clipping
  masks are the palette. A gradient has to be a placed image.
- **No elliptical arcs in path data.** `M L H V C S Q T Z` only. Rounded
  corners are generated as Beziers, so nothing needs arcs.
- **Raster text uses the built-in alphabet** (above).
- **JPEG, GIF and SVG placements need a decoder to rasterize.** They embed in
  the SVG with no help; the PNG path decodes PNG only, and reports the rest in
  `warnings` rather than failing the whole render.
- **No shadows.** Depth comes from contrast, scale, and overlap.

## Gotchas

- **`fill` defaults differ from CSS.** An element with no `fill` is not filled
  black by default the way an SVG viewer would; say what you mean, including
  `fill: null` for a stroke-only shape.
- **`strokeWidth` scales with a transform.** A `scale: 2` group doubles the
  apparent stroke. Set the width you want at the scale it will be drawn.
- **Check the `warnings`.** `design.rasterize()` returns them, and a skipped
  image placement is reported there rather than thrown.
- **Render both formats every time.** They come off one document, so a
  difference between them is a bug worth seeing early, not at publish time.
- **A composition is deterministic.** The same document renders byte-identical
  output, which means a diff on the PNG is a real change and worth reading.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| Text overflows the page | Set `maxWidth`, and check `align` against what `x` means under it |
| Placed image is distorted | `fit: 'fill'` stretches; use `cover` or `contain` |
| Image missing from the PNG but present in the SVG | Not a PNG data URL; pass a `decodeImage`, or convert the asset |
| Colors look right in the SVG, wrong in the PNG | An opacity or a clip is compounding; check `rasterize().warnings` first |
| Shape has a hole it should not have | `fillRule` - `evenodd` punches where `nonzero` unions |
| Stroke looks heavier than specified | A group transform is scaling it |

## References

- `references/composition.md` - element recipes and the grid arithmetic
- `references/color-and-type.md` - ratios, scales, and contrast on a static page
- `references/principles.md` - hierarchy, Gestalt, and whitespace as they apply
  to a composition with no interaction
- `API.md` at the repository root - the full API reference
