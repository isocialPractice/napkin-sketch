# Transform, Rotate, Mirror, Mesh Warp, Liquify and Wipe Stacks

## At a glance

- **Mesh Warp** - below the tools in the side rail: click art to mesh it, then
  drag its pins to bend it, as Illustrator's Puppet Warp does. `Enter` bakes the
  bend into the art as one undo step, and `Escape` throws it away.
- **Liquify** (`Shift+R`, after Mesh Warp in the side rail): bend the marks
  under a brush as Illustrator's Warp tools do - Warp pushes their outline
  along the drag, Twirl turns it, Pucker draws it in and Bloat pushes it out -
  one undo step a drag.
- **Wipe Stacks** - Transform > Wipe Stacks, the canvas's right-click menu, or
  the Shape Stacker's panel:
  combine the selected shapes as Illustrator's Pathfinder does - unite them,
  take one from the others, keep their overlap or all but it, or cut them into
  every piece of their overlaps - in one undo step, with a quarter-second
  napkin wiping over the result.

## The Transform box

**Transform (`Ctrl+T`, the **Transform** button beside Mirror in the toolbar,
or Transform > Transform Box; the button is pressed and the row checked while
the box is up):** puts one box around everything selected, with a
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

## Liquify

*New in 1.0.0-alpha.4.6.0.*

**Liquify (`Shift+R`, Transform > Liquify, or its button after Mesh Warp's
below the tools in the side rail):** bends the marks under a brush, as
Illustrator's Warp tools do. The key or a press on the button opens its
panel of four brushes, two by two; the arrows move round it and `Enter`
chooses.

| Brush | What it does |
| --- | --- |
| **Warp** | Pushes the outline along the drag, like clay: what is under the brush's centre goes the whole way |
| **Twirl** | Turns what is under the brush about its centre, clockwise, for as long as the press is held |
| **Pucker** | Draws what is under the brush in toward its centre, while held |
| **Bloat** | Pushes what is under the brush out from its centre, while held |

- **The brush.** A ring round the pointer with a small cross at its centre,
  100 px across the page unless changed. What it bends falls off smoothly
  from its centre to nothing at the ring. `Alt`-drag sizes it: the ring
  stays where the press went down and its edge follows the pointer. `[` and
  `]` make it a step smaller or larger. A toast gives the new size.
- **What bends.** The selected marks, or, with nothing selected, every mark
  under the brush on a visible, unlocked layer, as Illustrator chooses.
  `Ctrl` lends the selection tool, as on the drawing tools, to choose them.
  Pencil marks are the [Smear](tools.md#smear)'s to blend, so Liquify leaves
  them, and says so the first time. Text, pictures and eraser marks have no
  outline to bend.
- **Held and pressed.** Twirl, Pucker and Bloat keep working while the press
  is held still, faster under a pen pressed harder. Warp works as the
  pointer moves, and pushes less under a light pen.
- **What moves.** As under Mesh Warp, anchors and handles move, and a segment
  is split where one piece could no longer follow the bend. A drawn rectangle
  or ellipse, which has points rather than anchors, bends as a path, its
  straight sides too. When the drag ends, each mark it bent is fitted again
  at the Freehand fidelity (Verbose Settings > Sketch Support), so its
  anchors stay few. A Vector Path the brush never split keeps the anchors it
  was drawn with. Widths are kept, and a Copic nib turns with what it is on.
- **Undo.** One drag is one undo step. `Escape` before letting go puts back
  everything the drag bent.

A script bends with `warp`, `twirl`, `pucker` and `bloat`
([Drawing with napkin script](../api/drawing/README.md#liquify)).

## Wipe Stacks

**Wipe Stacks (Transform > Wipe Stacks, after Close Shape, the canvas's
right-click menu, or the tiles in the [Shape Stacker](tools.md#shape-stacker)'s
panel):** combines the selected shapes as Illustrator's Pathfinder does. It takes two or more shapes, and its rows are greyed until two are
selected. As in Illustrator the rows have no keys; **Edit Keyboard Shortcuts**
can give them some.

| Row | Pathfinder | What is left | Painted as |
| --- | --- | --- | --- |
| **Wipe In** | Unite | everything the shapes cover, as one shape | the topmost shape |
| **Wipe Out > Subtract Top from Below** | Minus Front | the bottom shape, less the ones above it | the bottom shape |
| **Wipe Out > Subtract Below from Top** | Minus Back | the top shape, less the ones below it | the top shape |
| **Mid Wipe** | Intersect | only where every shape overlaps | the topmost shape |
| **Outer Wipes** | Exclude | where an odd number overlap: two shapes lose their overlap, three keep their middle | the topmost shape |
| **Clean Wipe** | Divide | every piece of the overlaps, a shape each, each on a layer of its own | the topmost shape over the piece |

- **What counts as a shape.** A filled mark, or a closed outline, is its
  inside. Anything else - a line, a Copic stroke, a profiled stroke - is its
  ink, the width it paints at: a thick line taken from a square cuts the
  square in two. A result painted as a shape keeps that shape's fill,
  outline, width, opacity and effects; one painted from ink is a filled shape
  in the ink's colour, with no outline.
- **Text, pictures and placed files are passed over.** They stay as they are,
  and the notice says so.
- **Curves are kept.** Where the result runs along one of the shapes' own
  curves it keeps that shape's anchors and handles exactly, and a corner is
  made only where one edge crosses another.
- **One undo step.** The result is on the page, selected, the moment the row
  is chosen, and `Ctrl+Z` takes the whole wipe back. A wipe takes up to 32
  shapes at a time.
- **The wipe.** A paper-coloured napkin, a third of the shapes' width and
  leaning a little, sweeps across them in a quarter of a second: ahead of it
  the picture from before, behind it the result. A press, a key or the wheel
  ends it at once, so it never holds anything up. It is skipped when the
  system asks for reduced motion, and **Wipe animation** in Verbose Settings
  (Extras) turns it off.
- **In the right-click menu** the Wipe Stacks are a block at the end of the
  canvas menu. The window opens one panel beside a menu, so Wipe Out's two
  rows are laid out in the Wipe Stacks panel itself, as **Wipe Out: Subtract
  Top from Below** and **Wipe Out: Subtract Below from Top**.
- **In a script,** `wipe in|out-front|out-back|mid|outer|clean { ... }`
  combines the marks its block draws the same six ways, and draws what is
  left in their place: `wipe out-front { circle 100 100 60  circle 150 100 60 }`.
  The [drawing reference](../../api/drawing/README.md#combining-shapes) has the verb.

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
