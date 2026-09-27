# Transform, Rotate, Mirror and Mesh Warp

## At a glance

- **Mesh Warp** - below the tools in the side rail: click art to mesh it, then
  drag its pins to bend it, as Illustrator's Puppet Warp does. `Enter` bakes the
  bend into the art as one undo step, and `Escape` throws it away.

## The Transform box

**Transform (`Ctrl+T`, or Transform > Transform Box, checked while the box is
up):** puts one box around everything selected, with a
handle on each corner and the middle of each side, and scales it by dragging
one. The box stays up while it is in use — press `Ctrl+T` again or `Escape` to
put it away — and a press anywhere off a handle still belongs to the tool
underneath, so the selection can be changed without dismissing the box first.

- **The handle decides which axes move.** A left or right handle scales across,
  a top or bottom handle scales down, and a corner scales both — each axis by
  its own amount, following the pointer. The handle opposite the one in hand
  stays exactly where it is, so a drag reads as pulling that edge of the box.
- **`Shift` keeps the shape.** Both axes take one factor, so the selection
  grows or shrinks without being reshaped. On a corner the factor is whichever
  axis the pointer committed to; on a side it is the one axis that handle can
  measure, which is how a side handle scales the whole selection rather than
  stretching it.
- **`Alt` works from the centre.** The middle of the box stays put instead of
  the opposite handle, so both sides move together and the selection grows in
  place. `Alt` moves the point the scale is measured from and nothing else:
  each axis still scales on its own, so a corner under `Alt` alone still
  follows the pointer in both directions independently.
- **`Shift + Alt`** is the two together: uniform, about the centre.
- Either modifier can be pressed or let go **during** a drag, and the gesture is
  re-read from where it started rather than bent from where it had got to.
- A whole drag is **one undo step**, and a press that grabs a handle and lets go
  without moving costs none at all.
- **Dragging a handle through its anchor stops at 1%** rather than flipping the
  selection inside out. Flipping is what **Mirror** (`O`) is for; letting a
  handle do it too is in `TODO.md`, along with skew, distort, perspective, and
  puppet warp, which is the list this one box is meant to grow into.

## Rotate

**Rotate (`Ctrl+R`, Transform > Rotate…, or the Rotate button beside Move):** turns the selection
about a centre point, in a palette that opens in the top-right rather than
centred - the canvas under the selection is where the rotation is dragged, so
a centred panel would be sitting on the pixels the gesture needs.

- **Drag on the canvas to turn it by hand.** Clockwise counts up in positive
  degrees, counterclockwise down in negative ones, and the field shows what the
  drag has measured. Swinging past half a turn keeps counting the same way
  round, and a second lap counts as a second lap. Releasing commits the turn as
  a single undo step and puts the field back to zero.
- **The tool stays in hand.** Letting go of a drag commits the turn and leaves
  the palette up, and so does **Apply**: an angle is rarely the last one, and
  closing on the first answer threw away the pivot that had just been placed
  and the snap that had just been set along with it. `Ctrl+R` and the **Rotate**
  button now behave the same way; either is dismissed with **Rotate**,
  **Cancel**, or `Escape`. Move is the other kind of panel — it asks one
  question and goes once it is answered — and which of the two a panel is is
  declared in one place rather than decided in each Apply handler.
- **The centre of rotation moves four ways**: **click anywhere on the canvas**
  to put it there, drag the crosshair (the pointer offers a grab where it can
  be picked up), pick one of the nine handles of the selection's box from the
  preset grid, or type an exact **Centre x / y** in `px`, `in`, `mm`, or `pt`.
  The presets are the quick way to the corners and the middle of the box; a
  click is the loose way to everywhere else — a shoulder, a heel, a point off
  the shape entirely. Click and drag are told apart by the same few pixels that
  separate a click from a drag everywhere else, so a press that turns is still
  a turn. A centre that has been clicked, dragged, or typed lights no preset,
  which is how the panel says it is custom.
- **Angle, direction, and snapping**: the angle field is signed, and the
  **CW / CCW** pair re-signs whatever magnitude is in it rather than clearing
  it - so `90` and a press of CCW gives `-90`. **Snap to 15°** rounds typed and
  dragged angles alike; `Shift` does the same for one gesture. Arrow keys step
  a degree, or 15 with `Shift`.
- **Live preview** (off by default) shows the typed angle on the canvas before
  it is committed, taking no history step, exactly as the Move dialog's does. A
  canvas drag always previews, whatever the checkbox says.
- Vector anchors and their tangent handles turn with the path, and a Copic
  stroke's broad nib keeps its bearing relative to the mark. Text and images
  have no orientation to turn, so they orbit the centre upright - an image by
  its middle rather than by its top-left anchor.

## Mirror

**Mirror (`O`, Transform > Mirror…, or the Mirror button after Clear):** reflects the
selection, in a palette that opens in the top-right like Rotate's.

- **Orientation**: **Horizontal** swaps left and right, so a figure facing
  right faces left; **Vertical** swaps top and bottom. Both together turn the
  selection half a turn. With neither ticked, **Mirror** has nothing to do and
  says so.
- **Create Copy** keeps the selection and mirrors a copy of it, reflected about
  the selection's trailing edge - the right edge for Horizontal, the bottom
  edge for Vertical - so the copy lands beside the original as its mirror image
  and the two meet at that edge: draw half of something symmetric, mirror a
  copy, and it is whole. The copy is left selected. Without **Create Copy** the
  selection flips where it stands, about the middle of its box.
- **Live preview** (on by default) shows the result on the canvas as the
  choices change, copy and all. **Cancel** or `Escape` takes it back and leaves
  no trace - not even an undo step - and **Mirror** or `Enter` keeps it as one
  undo step and closes the palette. Starting another edit on the preview, such
  as dragging the previewed copy, keeps the mirror and builds on it.
- **Show Selection Borders** is the same switch as the Move palette's.
- A reflection is exact on vector geometry: anchors and both of their handles
  are reflected, so a curve keeps its control points rather than being
  resampled. A Copic stroke's broad nib and a linear gradient's direction turn
  with the drawing, and a Wave-profiled stroke - the one profile that leans -
  swaps its sides, so its mirror image leans the mirrored way. Text stays readable - its box moves to where its mirror
  image would be - and a placed image's pixels are flipped.

## Mesh Warp

**Mesh Warp (below the tools in the side rail):** bends art by pins, as
Illustrator's Puppet Warp does. It has no key, as in Illustrator.

- **Picking the art.** Hovering outlines in green the art a click would pick,
  with "(click to select art)" beside the pointer. A click picks the group one
  level below the top of the mark's layer tree - a figure's leg assembly,
  rather than the whole figure or one of the leg's paths - or, for a mark in no
  group, its own layer; the layers panel highlights that row. Chosen with
  something already selected, the tool meshes the selection at once.
- **The mesh.** The art's silhouette, grown by 3 px, is filled with grey
  triangles - about a thousand, whatever the art's size - and outlined in
  green. **Show mesh** in Quick Settings (and in the Settings window) hides the
  triangles and leaves the pins. Two pins go in along the art's long axis, a
  fifth of the way in from each end, and one goes in every separate piece.
- **Pins.** Click in the mesh to add a pin, and drag straight away to move it.
  Click a pin to select it, `Shift`+click to add one to the selection or take
  it out, and drag to move every selected pin: the art bends between them as
  rigidly as it can while the others hold. `Delete` or `Backspace` takes the
  selected pins out - never the art. A piece with one pin follows it rigidly,
  and a piece with none stays put.
- **Ending.** `Enter`, choosing another tool, or a click on empty canvas keeps
  the warp; a click on other art keeps it and meshes the new art. `Escape`
  throws it away, putting the art back exactly. While a warp is open, `Ctrl+Z`
  steps back through the pin moves; once it is kept, one `Ctrl+Z` takes the
  whole warp back.
- **What moves.** A freehand mark moves point by point. A Vector Path keeps its
  Bézier structure: its anchors and handles move, and a curve is split only
  where one piece could no longer follow the bend to within a fifth of a pixel.
  Text and images move with the point that anchors them, unbent, and a Copic
  nib turns with the art. No width is stretched.

Gradients and dash styles are written into exported SVGs as real
`<linearGradient>` / `<radialGradient>` paint servers and `stroke-dasharray`
values, so other editors see them, and they round-trip back into napkin
unchanged.

## Docking the editing panels

**Docking the editing panels:** **Move**, **Rotate**, **Mirror**, **Page
Settings**, and **Sharpen Selection** are floating palettes - dragged by their title or by the
narrow band at their border, resized from their corner, and kept on screen if
the window shrinks. Each also carries a small button in its title bar that
**docks** it: the panel leaves the drawing and becomes a column beside the
layers and properties panels, so the canvas gives up the width rather than
being covered. The same button **undocks** it, back to the exact position it
was floating at. A docked panel that is closed stays docked, and the dock takes
no space at all while it is empty.
