# Visual Principles, for a page with no interaction

Ported from the general design principles and cut to what applies when the
output is one static composition. Use as a checklist when producing or
reviewing a composition script.

The cut matters. Half of interface design is about what happens when someone
acts, and a graphic has no such half: no hover, no focus, no progressive
disclosure, no second screen. Everything the design says, it says at once. That
makes hierarchy, grouping, and whitespace the whole job rather than a third of
it.

## Visual Hierarchy

The order in which the eye discovers elements, controlled by - roughly in
descending power:

1. **Position** - top-left wins by default in a left-to-right reading culture;
   the optical centre (slightly above true centre) wins for a single focal
   point. On a 360 page, true centre is `y: 180` and the optical centre is
   nearer `y: 165`.
2. **Size** - larger dominates, but only with enough whitespace around it to
   register as singular.
3. **Contrast** - luminance contrast against the background outranks hue
   contrast. A mid-grey and a mid-red at the same lightness fight rather than
   rank.
4. **Saturation** - one saturated element among desaturated peers wins every
   time. This is the mechanism the 10 in 60-30-10 is spending.
5. **Weight** - `fontWeight`, and `strokeWidth` on the shapes around the text.
6. **Whitespace isolation** - an element with room beats a larger element in a
   crowd.

**The test**: render the PNG and squint at it, or scale it to 20%. The intended
primary element should still dominate. A composition that fails this at
thumbnail size fails in every feed it will ever appear in.

## Gestalt Principles (Applied)

- **Proximity** - elements close together read as a group. Prefer adjusting
  `y` over adding a `line` or a containing `rect`. Whitespace groups without
  spending elements.
- **Similarity** - shared color, shape, size, or type reads as the same kind.
  This is how a legend becomes unnecessary.
- **Continuity** - the eye follows lines and curves. Align elements to implicit
  lines; a column of text blocks that share an `x` is a scan path.
- **Closure** - the mind completes shapes. Three corners imply a card; two
  short rules imply a divider. Cheaper and quieter than drawing the whole box.
- **Figure/ground** - the foreground and background relationship has to be
  unambiguous. A placed image behind text is the usual way this goes wrong:
  check the contrast against the **worst** part of the image, not the average.
- **Common region** - a shared container overrides proximity. Use it sparingly;
  a panel inside a panel inside a card reads as indecision.

## What carries over from the Laws of UX, and what does not

Most of those laws are about acting on an interface, and a graphic cannot be
acted on. Three still apply:

- **Miller's Law** - roughly seven items in working memory, so chunk anything
  longer into groups of three to five. A composition listing nine things should
  show three groups of three.
- **Aesthetic-Usability Effect** - an attractive graphic is trusted more,
  which in a static piece is most of what it is for.
- **Serial Position Effect** - the first and last items in a visible list are
  remembered best. Put the thing that matters at one end.

Fitts, Hick, Doherty, Zeigarnik and Jakob are about targets, choices, latency,
and convention in an interactive product. Reaching for them here is a sign the
composition is being designed as if it were a screen.

## The Whitespace Discipline

Whitespace is structural, not leftover:

- **Macro** - between major blocks; controls the page's rhythm.
- **Micro** - between related elements (a heading and its subheading, a mark
  and its label); controls how fast the piece can be scanned.
- **Active** - placed deliberately to direct attention.
- **Passive** - the margins and gutters the grid already implies.

Reducing whitespace to fit more in loses comprehension faster than it gains
density. In a composition script this failure has a signature: the constants at
the top stop being multiples of the base unit, because each element has been
nudged to make room.

## Composition Rules of Thumb

- **Rule of thirds** for a focal element. On a 360 page the thirds fall at 120
  and 240.
- **Golden ratio (about 1.618)** is a sanity check on proportion, not a target
  worth chasing to three decimals.
- **Optical alignment beats mathematical alignment.** A triangle or a circle
  centred by its bounding box often looks off-centre; nudge it a unit or two
  until it looks right, and leave a comment saying that the odd number is
  deliberate.
- **Optical sizing.** A circle the same height as a square reads smaller. Bump
  it 5 to 10% to match visual weight - `r: 32` beside a 60-tall rect, not 30.
- **Match the mark to the grid, then break it once.** A composition where
  everything is on the grid reads as competent; one element deliberately off it
  is what reads as designed.
