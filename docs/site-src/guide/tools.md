# Tools

## At a glance

- **Brush, marker, Copic marker, pencil, smear, eraser, shape eraser, shape
  stacker, split, select, direct select, and text** tools with pressure-aware variable line
  width. The **Brush** (`B`)
  is the tool called the Pen before 1.0.0-alpha.4.6.0 (it was on `P`, which is
  Vector Path's now); files and scripts still call its marks `pen`. The eraser cuts
  what it passes over out of the drawing (see [Eraser](#eraser)), the Shape
  Eraser cuts a dragged shape out of the selection (see
  [Shape Eraser](#shape-eraser)), the Shape Stacker merges the pieces of the
  selected shapes or takes them away (see [Shape Stacker](#shape-stacker)),
  Split cuts a path where it is clicked (see [Split](#split)), the Select tool
  moves/deletes existing
  strokes (with rubber-band and `Shift`-click multi-selection), the **Direct
  Select** tool (`A`) drags individual **anchor points** to reshape a stroke,
  and the Text tool supports both **click-to-type** (auto-sizing box) and
  **drag-to-draw** (fixed-width box with word-wrap).
- **A freehand stroke is a few Bézier curves.** When a Brush, Marker, Copic or
  Pencil stroke is lifted, its samples - one every three quarters of a screen pixel
  - are fitted with the fewest cubic curves that stay within the **Freehand
  fidelity** of every one of them (1.5 screen pixels unless changed in
  Verbose Settings > Sketch Support, 0.5 to 8). A stroke across the page
  keeps a handful of anchors rather than hundreds of points: Direct Select
  shows them with their handles, the exports write them as curves, a drawn
  corner stays a corner, and a stylus's pressure is kept at every anchor, with
  an anchor more wherever it swells or eases. Two-point straight lines, shapes
  and erasers are left as they are.
- **Translucent ink lies flat.** A stroke is painted as one mark, so at less
  than full opacity it is one even tone along its length; it used to darken
  where its segments met, into a string of beads.
- **Copic marker** (`K`) — simulates an alcohol-ink marker's flat **broad nib**:
  strokes are thick when you pull across the nib and thin when you pull along
  it, like a real chisel tip. The nib is **rotatable**: hold `Ctrl` for one
  second to show a rotation indicator in the bottom-right corner, then hold
  `Alt` to rotate the nib clockwise or `Shift` to rotate it counter-clockwise;
  release `Ctrl` to finish. The hold time (0.5–2s), all three keys, the
  rotation speed, and the feature's on/off switch are configurable in the
  Settings window.
- **Pencil** (`N`) — a pencil from a drawing class's kit - graphite 4H to
  8B, charcoal pencils, vine and compressed charcoal - drawn through the
  paper's grain: pressure darkens it far more than it widens it, and passes
  laid over one another build tone toward the lead's darkest. Its button opens
  the kit (see [Pencil](#pencil)).
- **Smear** (`Shift+N`) — a blending stump for the Pencil's graphite: dragged
  over pencil marks it spreads their tone along the drag, softening hatching
  into shading (see [Smear](#smear)).
- **Sketch Support tools** — a second toolbar section with **Rectangle**
  (`R`, `Shift` for a square), **Ellipse** (`L`, `Shift` for a circle),
  **Curve** (`V`: drag a chord that starts and ends at nearby stroke
  endpoints by default, bend, click to place — click and hold the button for
  the free-ends variant),
  **Vector Path** (`P`: an Illustrator-style pen — click for corners, drag
  for smooth Bézier points, click the first point to close or `Enter` to
  finish open; click a committed path to edit its anchors — add, remove,
  move, round, and re-handle points),
  **Sharpen Selection** (smooth and simplify the selected strokes with a
  live-preview dialog),
  **Paint Bucket** (`G`: fill an enclosed shape as a new selectable shape),
  **Fill Color** (click anywhere within an element's dimensions to select and
  fill it; with nothing under the click the current selection is filled) -
  both with the fill color, or the ink while the fill is none (see
  [Fill and stroke](#fill-and-stroke)) - **Eyedropper** (`I`: pick a color from the canvas
  and fill the selected shape), **Rotate** (`Ctrl+R`: turn the selection about
  a movable centre, by dragging on the canvas or by typing an angle),
  **Mirror** (`O`: reflect the selection horizontally, vertically or both, in
  place or as a copy that lands beside it), and **Join strokes** (`Ctrl+J`).

## Eraser

*Changed in 1.0.0-alpha.4.6.0: the Eraser added an invisible mark of its own
to the layer in use, so an erase cut one mark at most - every mark is on a
layer of its own - and not always the one under it; with a group row picked
it made an empty layer to land on; and its marks could be selected and drew
boxes over the ground they had erased.*

**Eraser** (`E`): drag over the drawing, and what the swath covers is cut
out of the marks it was aimed at - as they are, with no mark of the
eraser's own and no new layer, in one undo step.

- **What it cuts.** With a selection, every selected mark, all of them - a
  selected group's too - and nothing else. With nothing selected, every mark
  the swath touches on a layer that can be drawn on, as a vector editor's
  eraser does. The cut shows on the canvas as the swath goes, and the release
  makes it.
- **How each mark is cut.** A filled shape, a Copic stroke or a profiled
  stroke loses the area the swath covered; what is left of its outline keeps
  its curves, and the swath's edge is fitted with a few anchors. A Copic or a
  profiled stroke, cut, becomes a filled shape in its colour. A plain Brush or
  Marker line is taken away wherever its painted width would reach into the
  swath, so no round end pokes into erased ground; what is left is the same
  line, in pieces, and still a line - its width, colour and Sharpen apply as
  before. A mark erased away is removed, and so is a layer left empty.
- **What it passes over.** Text and images are not erased; a toast says so.
- **The box is the ink that is left.** A cut mark's selection box, and every
  box built on it - Transform, Rotate, Move, Fit All in View - covers the ink
  it still has.

**Older files.** A file made before 1.0.0-alpha.4.6.0 may hold the old
Eraser's marks. They still paint and export as they did, but they are no
longer picked, drawn a box, or counted in any box; they ride along with
their layer, so moving or deleting the layer's mark takes their cuts with
it. **Sketch > Apply Erasers** turns every one of them into the cut it
paints - each cut out of the marks painted before it on its own layer, which
is what the canvas showed - and takes it away, in one undo step. An eraser
mark on a locked or hidden layer is left as it is.

## Shape Eraser

*New in 1.0.0-alpha.4.6.0.*

**Shape Eraser** (`Shift+E`, beside the Eraser): select the marks to cut,
then drag a shape over them. What the shape covers is cut out of every
selected mark by the [Eraser](#eraser)'s rules - a filled shape loses the
area, a line is taken away where its width would reach in - with no mark of
the eraser's own and no new layer, in one undo step.

- **The shapes.** Pressing the button, or `Shift+E`, takes the tool and
  opens its panel under the button (beside it, on the side rail):
  **Rectangle**, **Ellipse**, **Square** and **Circle** as outline tiles,
  with **Top Path** across the bottom. The arrow keys move round the panel,
  `Enter` or `Space` chooses and `Escape` closes it; a press anywhere
  else puts it away. The shape chosen stays for the session, and the
  button's hover text names it. `Shift` makes a Rectangle square and an
  Ellipse round, as it does for the Rectangle and Ellipse tools.
- **The drag.** The shape's outline follows the pointer, and the selected
  marks show the cut inside it before it is let go. The release makes the
  cut; the tool stays in hand and the selection stays, for the next one.
- **Top Path.** Draw the shape to cut with on top - a Rectangle, an
  Ellipse, a closed Vector Path, any closed mark - select it with the marks
  under it, open the panel and choose **Top Path**. The topmost selected
  mark cuts the others and is taken away, as a vector editor's Minus Front
  does.
- **When it has nothing to do.** Nothing selected, only the one path
  selected, or an open path on top: a notice says which. Tick **Do not show
  this notice again** and, for the rest of the session, it is a toast
  instead; a new session shows it again.

## Shape Stacker

*New in 1.0.0-alpha.4.6.0.*

**Shape Stacker** (`Shift+M`, beside the Shape Eraser): a vector editor's
Shape Builder. Select two or more shapes, and the tool sees them as their
pieces - every place where they overlap, and every place where they do not.
Hovering shades the piece under the pointer with a light mesh.

- **Merge.** Drag across pieces: each one the drag crosses is marked, with
  the drag's path drawn over them, and the release merges them into one
  shape. It is painted as the topmost shape where the drag began, and every
  shape it took pieces from keeps the rest. A click on one piece makes it a
  shape of its own.
- **Take away.** Hold `Alt` at the press - the cursor's plus turns to a
  minus - and the pieces marked are taken away from every shape instead.
- **A box.** Hold `Shift` at the press to drag a box: every piece it
  touches is marked. A box begun on bare paper merges in the paint of the
  topmost shape it touches.
- **One undo step** each, and `Escape` during a drag drops it. The tool stays
  in hand, and what the stack made or changed stays selected with the rest,
  for the next stack; an undo clears the selection, as it always does, so
  select the shapes again to carry on. Hold `Ctrl` to select with the
  selection tool without putting the Shape Stacker down. Where a piece runs
  along a shape's own outline, the outline's curves are kept exactly.
- **The Wipe Stacks.** Pressing the button, or `Shift+M`, takes the tool and
  opens its panel under the button (beside it, on the side rail): the six
  [Wipe Stacks](transform.md#wipe-stacks) as tiles - Wipe In, Subtract Top,
  Subtract Below, Mid Wipe, Outer Wipes and Clean Wipe - which work on the
  whole selection at once, greyed with fewer than two shapes selected. The
  arrow keys move round the panel, `Enter` or `Space` chooses and `Escape`
  closes it; a press anywhere else puts it away.
- **When it has nothing to do.** With fewer than two shapes selected, a press
  says so in a notice: "Select two or more shapes to stack." Text, pictures
  and placed files in the selection are left as they are.
- **In a script,** `stack merge|remove <points> { ... }` stacks the marks
  its block draws at the pieces under the points: see the
  [drawing reference](../../api/drawing/README.md#stacking-shapes).

## Split

*New in 1.0.0-alpha.4.6.0.*

**Split** (`J`, beside the Shape Stacker; the pair of Join's `Ctrl+J`): a
vector editor's Scissors. Click a path and it is cut where the click lands on
it - the topmost path whose line is within the Direct Select sensitivity of
the pointer - and nothing moves.

- **An open path becomes two.** The first piece keeps the mark and its layer;
  the second is a mark of its own, on a new layer just above.
- **A closed path opens there**: one open path that starts and ends at the
  click, still looking as it did, fill and all. A second click then divides
  it in two.
- **A shape with holes** gives up the ring that was clicked, as an open mark
  of its own; the rest stays closed.
- **On an anchor** - within half the sensitivity of one - the cut is made at
  the anchor, and none is added. Anywhere else the cut is exact: a curve is
  divided so that both pieces trace it as it was, and a freehand stroke's
  pressure carries on through the cut.
- **What shows.** The pointer is a pair of scissors, and a small ring marks
  where a click would cut. Both pieces keep every paint property; they are
  selected, and Split stays in hand. One undo step each.
- **What it cannot cut.** Text, pictures and an older file's eraser marks say
  so in a toast, "Split cuts paths and lines", and a click on an open path's
  very end says there is nothing there to cut.
- **In a script,** `split <x> <y>` cuts the topmost mark drawn so far whose
  path passes within 4 px of the point: see the
  [drawing reference](../../api/drawing/README.md#splitting-paths).

## Fill and stroke

*New in 1.0.0-alpha.4.6.0.*

Every mark has an outline, its **stroke**, and a closed shape a **fill** as
well. The fill and stroke control in the toolbar, where the color well was,
shows both, as a vector editor's toolbar does: the fill box and the stroke
box, overlapping, the one **in front** being the one the colors paint. The
fill shows a red slash while it is none, which it is until one is picked -
a sketch's shapes are outlines.

- **`X`** puts the other one in front (**Sketch > Fill in Front**, ticked
  while the fill is). A click on the box behind does the same; a click on the
  box in front opens the color picker on its color.
- **The colors paint the one in front.** `C` and `Shift + C` step it
  through the Quick Access Colors - the fill's steps take in None, so the
  keys can take a fill away as well as give one - and a swatch or the color
  picker sets it. With the Select tool and a selection, a picked color
  reaches the selection as well: with the stroke in front every outline and
  text takes it, and a shape with no outline gains one; with the fill in
  front every closed shape is filled with it, in place of a gradient, and
  text takes it, while an open line keeps what it has. A picker drag is one
  undo step.
- **New shapes take the fill.** A Rectangle, an Ellipse or a closed Vector
  Path is filled with it, and the Paint Bucket and Fill Color paint with it -
  with the ink while the fill is none. The Brush, the Marker and the Copic
  draw lines, and take the ink alone; the Pencil draws in its lead's tone
  (see [Pencil](#pencil)).
- **`Shift + X`** swaps them (**Sketch > Swap Fill and Stroke**, or the arrow
  at the control's corner). With the Select tool and a selection, each
  selected closed shape's fill and outline trade colors - a shape with no
  fill ends with no outline, and the reverse. Otherwise the ink and the fill
  trade; the ink is never none, so a fill of none has nothing to trade.

The Eyedropper still picks into the ink and fills the selected shape, as
before.

## Text tool

**Text tool:** *click* to place an auto-sizing text box; *drag* to draw a
fixed-width text box (text wraps to fit the drawn width).

## Copic marker

**Copic marker:** the cursor shows the flat nib as a rotated bar matching the
current width and angle. To rotate the nib, hold `Ctrl` until the rotation
indicator appears in the bottom-right corner (1 second by default), then hold
`Alt` (clockwise) or `Shift` (counter-clockwise); the nib turns continuously at
the configured speed until you release. While the indicator is visible the
**Copic marker becomes the active tool** with the stroke width scaled by the
configurable **width multiplier** (1–4×, default 2×, capped at 40px) so the
nib preview reads clearly as it turns; releasing `Ctrl` hides the indicator,
ends rotate mode, and hands back the tool and width you were using before
(unless you explicitly changed either in the meantime). Every part of this — the hold key, both rotate keys, the
hold time (0.5–2s), the rotation speed, and whether the quick feature is
enabled at all — lives under **Copic Marker** in the Settings window.

## Pencil

*New in 1.0.0-alpha.4.6.0.*

**Pencil** (`N`): a pencil from a drawing class's kit, drawn through the
paper's grain. It is modelled on a real pencil rather than on any editor's
tool.

- **The drawing kit.** A press on the Pencil's button opens its kit beside
  it, as the Shape Eraser's button opens its shapes. `N` takes the Pencil up
  with no panel in the way, and `N` again opens the kit. Each chip draws a
  short line with its own lead:
  - **Graphite**: 4H, 2H, HB, 2B, 4B, 6B, 8B
  - **Charcoal pencil**: HB, 2B, 4B, 6B
  - **Vine charcoal**: Hard, Medium, Soft
  - **Compressed charcoal**: 2B, 4B, 6B

  The Pencil starts with graphite HB, and its button's hover text names the
  pencil in hand. Arrows move round the kit, `Enter` or `Space` chooses, and
  `Escape` closes it.
- **How each lays down.** Each grade has a tone, the darkest it lays down:
  graphite is a cool grey that never reaches black, charcoal a warm matte
  black. A harder grade is lighter, thinner and crisper, a softer one darker,
  broader and grainier; charcoal is the grainiest, with a powdery edge, and
  vine charcoal a broad, light stick. At one stroke width a softer lead draws
  a broader line.
- **Pressure darkens far more than it widens.** A light touch catches only
  the peaks of the paper's tooth, and a firm one fills the valleys as well. A
  mouse draws at a stylus's middle pressure.
- **Passes build tone.** The paper's tooth is fixed to the page, so strokes
  laid over one another catch the same peaks and miss the same valleys:
  hatching darkens toward the grade's tone and never past it, and the paper
  shows through the deepest valleys.
- **The ink color does not change a pencil**, as it does not change a real
  one. A selected Pencil mark recolored with the stroke in front becomes a
  colored pencil in that color.
- **Otherwise it is an ordinary line.** Direct Select shows its fitted
  anchors, the Eraser and Split cut it, Mesh Warp bends it, and each mark
  lands on a layer named Pencil 1, Pencil 2, and so on. Liquify leaves it to
  the Smear.
- **Every export keeps it.** The SVG fills each pencil line with the paper's
  grain, carrying the tooth once in the file, so a browser shows the same
  grain, and napkin reads its own SVG's pencil lines back as Pencil marks. A
  PNG has the canvas's pixels. The PDF and the Illustrator script draw each
  line flat at its pencil's mean tone, having no grain paint. A script takes
  up a pencil with `pencil 2B`
  ([Drawing with napkin script](../api/drawing/README.md#pencils)).
- **An older napkin** opens a Pencil mark as a Brush mark in its tone.

## Smear

*New in 1.0.0-alpha.4.6.0.*

**Smear** (`Shift+N`): a blending stump for the Pencil's graphite. Dragged
over pencil marks, it spreads their graphite along the drag: tone moves from
where it is thick to where it is thin, the paper's tooth fills in, edges
soften, and a patch spread thin lightens - shading, made out of hatching.

- **What it smears.** The selected pencil marks, or, with none selected,
  every pencil mark it passes, as the Eraser chooses what it cuts. It leaves
  every other mark as it is, and says so the first time: those are
  [Liquify](transform.md#liquify)'s to bend.
- **The stump's size and strength.** With the Smear in hand, Quick Width
  (`W` and a number) is the stump's size and Quick Opacity (`Q` and a
  number) its strength, 50% unless one is set. A stylus pressed harder
  smears more.
- **The darkness is kept.** The stump trades graphite with the paper - what
  one gains the other loses - so a smear moves tone rather than taking it
  away.
- **Kept on the mark.** Each pencil mark the drag reached keeps the pass,
  from where the stump first reached it to as far as it carried graphite
  past it. No mark and no layer is added, and the mark's box grows to take
  in where its graphite went. A smear moves, turns, mirrors, scales and
  warps with its mark. One undo takes the whole drag back, and `Escape`
  during the drag drops it.
- **Every export keeps it.** The SVG and the PDF write a smeared pencil mark
  as the picture the canvas paints of it, at twice the page's resolution,
  and napkin reads its own SVG's smeared marks back with their passes. A
  PNG has the canvas's pixels. The Illustrator script draws the mark
  unsmeared. A script smears with `smear 24 0.6 10 80, 150 80`
  ([Drawing with napkin script](../api/drawing/README.md#smearing)).

## Sketch Support tools

**Sketch Support tools:** **Rectangle** (`R`) and **Ellipse** (`L`) drag out a
shape (hold `Shift` for a uniform square or circle) and commit it as an
editable brush stroke. **Curve** (`V`) adapts to the input device: with a
*mouse* it works in two steps — drag the chord, release, move the pointer to
bend the curve through it, then click to place (`Esc` cancels) — because a
mouse can hover between clicks. A *pen or touch* drag cannot hover, so those
take the quick curve's single-gesture flow instead: the quarter arc follows
the drag and lifting off places it. By default the mouse chord's **start and
end snap to nearby stroke endpoints**; click and hold the Curve button to
open its flyout and switch to the **free ends** variant (the small corner
triangle marks tools with a flyout). **Vector Path** (`P`) works like a
vector editor's pen tool: *click* to place corner points joined by straight
segments, *click-drag* to place a smooth point and pull out its symmetric
Bézier direction handles, with the next segment previewed live as a rubber
band. Hold `Shift` to keep the next point, and the band, **level, plumb or
at 45°** from the last point, and a pulled handle to the same eight
directions about its own point. Once the path has two points, the pointer
near the first shows the **close indicator** on it - a ring with four
joins - and the band ends there: *click* to close the path. The indicator
shows within the Direct Select sensitivity (8 screen pixels unless changed),
which is where a click closes it, `Shift` or not. To finish the path open,
press `Enter`, *double-click*, or simply **switch tools** — pressing `S` for
Select, any other tool shortcut, or a toolbar button accepts the path as
drawn. Only `Esc` abandons it. The path commits as an editable brush stroke,
drawn exactly as placed (never auto-sharpened), and keeps its anchors —
click it again with the Vector Path tool to rework them (see below). **Paint Bucket** (`G`) fills the enclosed path or
shape under the click with the fill color - the ink while the fill is none -
added as a new selectable shape. **Fill Color** selects the element under the
click — anywhere within
the element's dimensions counts, not just its outline, so clicking the middle
of a shape picks it — and fills it with the fill color, or the ink; with no
element under the click it fills the current selection (open strokes and text
are recolored). **Eyedropper** (`I`) picks the color under the click
(averaged over the **Eyedropper sensitivity**, 1–36px, default 10px), makes
it the ink color, and fills the selected shape when one is selected; hold
`Ctrl` for the selection tool, as on every drawing tool, and pick a shape,
then release `Ctrl` to return to the eyedropper. **Join strokes** (`Ctrl+J` or the
Join button) merges the selected strokes end-to-end into one stroke **on one
layer** - the first stroke's - and the layers the other pieces vacated are
removed with them, so a join leaves one element and one row rather than a
stack of empty ones. The optional Join-on-snap setting consolidates the same
way. **Close Shape** (press the button for its submenu) joins a selected
stroke's **two end points**: *Sharp* bridges them with a straight line,
*Smooth* continues the drawn directions through the seam with a curve, and a
Vector Path stroke closes through its anchor model so the seam stays
editable. **Alt-drag copies the selection**: hold `Alt` as a drag starts and
the drag moves a duplicate while the original stays put - the copies land on
new layer rows named `<layer name> - copy` (a copied group keeps its inner
layer names; only the group row takes the suffix), and one undo removes the
copy and the move together.
