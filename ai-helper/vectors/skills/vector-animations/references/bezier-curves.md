# Bezier Curves

In vector graphics, a smooth curve segment between two points is defined mathematically as a
Cubic Bezier Curve. The anchor points act as the start and end positions of the segment, and the
handles act as directional tangent vectors (control points) that dictate the slope and curvature
of the segment between the anchors.

## The Cubic Bezier Equation

The parametric equation for a cubic Bezier curve `B(t)` uses anchor points `P0`, `P3` and handle
control points `P1`, `P2`:

```text
B(t) = (1 - t)^3 * P0
     + 3 * (1 - t)^2 * t * P1
     + 3 * (1 - t) * t^2 * P2
     + t^3 * P3
```

Where:

- `t` is the time/position parameter, moving from 0 to 1 (`0 <= t <= 1`).
- `P0` is the first anchor point (start of the segment).
- `P1` is the handle attached to `P0`, defining the initial tangent direction.
- `P2` is the handle attached to `P3`, defining the final tangent direction.
- `P3` is the second anchor point (end of the segment).

## Vector Mechanics Breakdown

- **Tangent influence**: the derivative (velocity vector) at the start anchor `P0` points directly
  along the vector defined by the first handle, `P1 - P0`. The curve leaves the anchor in the
  direction of its handle, and arrives at `P3` from the direction of `P2`.
- **Handle length**: the length of the handle vector `|P1 - P0|` controls how far the curve
  projects along that tangent before bending toward the next anchor. Longer handles make flatter,
  wider curves; shorter handles make tighter turns.
- **Collinear handles**: when two curve segments share an anchor, the joint is smooth (G1
  continuous) only if the incoming and outgoing handles are collinear through the anchor. Breaking
  that collinearity creates a visible corner.
- **Convex hull**: the curve always stays inside the quadrilateral formed by `P0 P1 P2 P3`. This
  is useful for quick bounds checks when placing or hit-testing curve segments.
- **Subdivision (de Casteljau)**: repeatedly interpolating between the four points at a fixed `t`
  splits one cubic curve into two exact halves. Use this to split a stroke at a joint without
  changing its shape.

## Bezier Curves in SVG Paths

SVG `path` data expresses Bezier segments directly:

| Command | Meaning |
|---------|---------|
| `C x1 y1, x2 y2, x y` | Cubic curve with both handles explicit |
| `S x2 y2, x y` | Smooth cubic; first handle mirrors the previous segment's second handle |
| `Q x1 y1, x y` | Quadratic curve with a single shared control point |
| `T x y` | Smooth quadratic; control point mirrored from the previous segment |

Example of a single cubic segment:

```xml
<path d="M 10 80 C 40 10, 65 10, 95 80" fill="none" stroke="black"/>
```

A quadratic curve is a special case of a cubic: `P1 = P0 + (2/3)(Q - P0)` and
`P2 = P3 + (2/3)(Q - P3)` convert a quadratic control point `Q` to cubic handles exactly.

## Bezier Curves as Easing Functions

The same math drives animation timing. CSS `cubic-bezier(x1, y1, x2, y2)` maps elapsed time
(x axis) to progress (y axis) with `P0 = (0, 0)` and `P3 = (1, 1)` fixed:

- `cubic-bezier(0.25, 0.1, 0.25, 1)` is the CSS `ease` default.
- `cubic-bezier(0.42, 0, 1, 1)` is `ease-in` (slow start).
- `cubic-bezier(0, 0, 0.58, 1)` is `ease-out` (slow stop).

Use ease-out curves for limbs settling into a pose and ease-in for wind-ups; a linear ramp reads
as mechanical.

## Applying Bezier Math to Animation Frames

When generating the next frame of a frame-by-frame animation:

- Move an anchor point and its handles **together** so the local curve shape survives the move.
  Translating anchors without their handles shears the stroke.
- Rotate a limb segment by rotating its anchors and handles around the joint point by the same
  angle. The handle vectors rotate with the geometry.
- Keep handle lengths proportional when scaling a segment, otherwise curvature flattens or
  overshoots between frames and the animation appears to wobble.
- Between frames, small consistent changes to handle angles read as smooth motion; large changes
  to handle length read as squash and stretch.

## Sources

- [Pen tool and path mechanics](https://adobeillustratorsmartnotes.com/illustrator/paths/pen-tool.html)
- [Drawing curves](https://www.sketchpad.net/drawing2.htm)
