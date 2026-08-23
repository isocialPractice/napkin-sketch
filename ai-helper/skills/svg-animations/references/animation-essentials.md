# Animation Essentials

Animating SVG starts with vector markup that is either embedded inline in HTML or rendered by an
application, then driven by one of three engines: CSS keyframes, native SMIL tags, or JavaScript
libraries such as GSAP. All three scale, color, move, morph, and draw paths smoothly at any screen
size because the geometry stays resolution independent.

## Core Methods for SVG Animation

### CSS Styles and Keyframes

Target inline SVG elements via classes or IDs from a stylesheet. Best for transitions, opacity
fades, rotations, and repeating movements.

```css
.wheel {
  transform-origin: 50% 50%;
  animation: spin 2s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### SMIL (`<animate>` family)

Declarative animation tags built directly into the SVG markup with no external code. Good for
simple attribute changes, path morphing, and native looping effects.

```xml
<circle cx="20" cy="20" r="5">
  <animate attributeName="cx" from="20" to="120" dur="1.5s" repeatCount="indefinite"/>
</circle>
```

The family is `<animate>` (any attribute), `<animateTransform>` (translate, rotate, scale, skew),
and `<animateMotion>` (move an element along a path).

### JavaScript and Libraries

Use tools like GSAP or Motion for advanced timelines, interactive triggers, path tracing, and
complex coordinated storytelling. A frame-by-frame player can also be as simple as toggling the
visibility of frame groups on a timer:

```js
const frames = [...svg.querySelectorAll('[id^="walk_"]')];
let i = 0;
setInterval(() => {
  frames.forEach((f, n) => f.setAttribute('display', n === i ? 'inline' : 'none'));
  i = (i + 1) % frames.length;
}, 100);
```

## Essential Properties to Animate

- **Transforms**: rotate, scale, and translate elements using `transform`, with `transform-origin`
  (or an explicit rotation center in `rotate(a cx cy)`) set precisely to joint or pivot points.
- **Strokes**: use `stroke-dasharray` and `stroke-dashoffset` to create the line-drawing
  self-revealing effect; set the dash length to the path's `getTotalLength()` and animate the
  offset to zero.
- **Fills and colors**: transition smoothly between HSL or hex color values for background or
  shape shifts; HSL interpolates more predictably for hue sweeps.
- **Geometry attributes**: directly alter values like radius (`r`, `rx`, `ry`), coordinates
  (`cx`, `cy`, `x`, `y`), `width`, or `height`. SMIL and JS can animate these; CSS can only
  animate the subset promoted to presentation properties.
- **Opacity and visibility**: `opacity` for fades; `display` for hard frame switching in
  frame-by-frame sequences.

## Frame-by-Frame Sequences

Cell-style animation inside a single SVG works by stacking one group per frame:

```xml
<g id="walk_0">...</g>
<g id="walk_1">...</g>
<g id="walk_2">...</g>
```

Rules that keep a sequence coherent:

- Name frames `<animationType>_<n>` starting at `_0`; the player sorts by the numeric suffix.
- Every frame keeps the same internal group structure (same assemblies, same nesting, same
  names) so parts can be tracked, retargeted, or interpolated between frames.
- Only one frame group is visible at a time; the rest are `display="none"`.
- Onion skinning is the same trick with the neighbor frames left visible at low opacity.

## Timing and Easing

- 8 to 12 frames per second reads as hand-drawn; 24 reads as film.
- Ease-out into held poses and ease-in out of them; see `bezier-curves.md` for the cubic-bezier
  timing math.
- Offset the timing of secondary parts (hair, cloth) a frame behind the primary motion for
  follow-through.

## Accessibility and Performance

- Honor `prefers-reduced-motion` by pausing or simplifying loops.
- Animate `transform` and `opacity` where possible; they are compositor friendly, while geometry
  and filter changes force repaints.
- Batch attribute writes inside `requestAnimationFrame` when driving frames from JavaScript.

## Sources

- [SVG animation walkthrough](https://www.youtube.com/watch?v=o7DyKBkQLnM)
- [SVG CSS animation tutorial](https://www.youtube.com/watch?v=cD6qSJB1aZE)
- [Practical SVG, animation chapter](https://practical-svg.chriscoyier.net/chapter/practical-svg-ebook-11/)
- [Animating SVG strokes](https://www.youtube.com/watch?v=gsAsKlY63KA)
- [Guide to SVG animation](https://www.tiny.cloud/blog/guide-svg-animation/)
- [SVG essentials and animation course](https://master.dev/courses/svg-essentials-animation/)
- [SVG animation examples](https://www.svgator.com/blog/cool-svg-animation-examples-to-inspire/)
- [SMIL animation overview](https://www.youtube.com/watch?v=2QdH3i4mSLk)
- [Path drawing effects](https://www.youtube.com/watch?v=yNSgArR5D38)
- [GSAP SVG resources](https://gsap.com/resources/svg/)
