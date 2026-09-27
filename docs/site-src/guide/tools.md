# Tools

## At a glance

- **Pen, marker, Copic marker, eraser, select, direct select, and text**
  tools with pressure-aware variable line width. The eraser truly reveals the
  paper beneath (layered compositing), the Select tool moves/deletes existing
  strokes (with rubber-band and `Shift`-click multi-selection), the **Direct
  Select** tool (`A`) drags individual **anchor points** to reshape a stroke,
  and the Text tool supports both **click-to-type** (auto-sizing box) and
  **drag-to-draw** (fixed-width box with word-wrap).
- **Copic marker** (`K`) — simulates an alcohol-ink marker's flat **broad nib**:
  strokes are thick when you pull across the nib and thin when you pull along
  it, like a real chisel tip. The nib is **rotatable**: hold `Ctrl` for one
  second to show a rotation indicator in the bottom-right corner, then hold
  `Alt` to rotate the nib clockwise or `Shift` to rotate it counter-clockwise;
  release `Ctrl` to finish. The hold time (0.5–2s), all three keys, the
  rotation speed, and the feature's on/off switch are configurable in the
  Settings window.
- **Sketch Support tools** — a second toolbar section with **Rectangle**
  (`R`, `Shift` for a square), **Ellipse** (`L`, `Shift` for a circle),
  **Curve** (`V`: drag a chord that starts and ends at nearby stroke
  endpoints by default, bend, click to place — click and hold the button for
  the free-ends variant),
  **Vector Path** (`B`: an Illustrator-style pen — click for corners, drag
  for smooth Bézier points, click the first point to close or `Enter` to
  finish open; click a committed path to edit its anchors — add, remove,
  move, round, and re-handle points),
  **Sharpen Selection** (smooth and simplify the selected strokes with a
  live-preview dialog),
  **Paint Bucket** (`G`: fill an enclosed shape as a new selectable shape),
  **Fill Color** (click anywhere within an element's dimensions to select and
  fill it with the selected color; with nothing under the click the current
  selection is filled), **Eyedropper** (`I`: pick a color from the canvas
  and fill the selected shape), **Rotate** (`Ctrl+R`: turn the selection about
  a movable centre, by dragging on the canvas or by typing an angle),
  **Mirror** (`O`: reflect the selection horizontally, vertically or both, in
  place or as a copy that lands beside it), and **Join strokes** (`Ctrl+J`).

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

## Sketch Support tools

**Sketch Support tools:** **Rectangle** (`R`) and **Ellipse** (`L`) drag out a
shape (hold `Shift` for a uniform square or circle) and commit it as an
editable pen stroke. **Curve** (`V`) adapts to the input device: with a
*mouse* it works in two steps — drag the chord, release, move the pointer to
bend the curve through it, then click to place (`Esc` cancels) — because a
mouse can hover between clicks. A *pen or touch* drag cannot hover, so those
take the quick curve's single-gesture flow instead: the quarter arc follows
the drag and lifting off places it. By default the mouse chord's **start and
end snap to nearby stroke endpoints**; click and hold the Curve button to
open its flyout and switch to the **free ends** variant (the small corner
triangle marks tools with a flyout). **Vector Path** (`B`) works like a
vector editor's pen tool: *click* to place corner points joined by straight
segments, *click-drag* to place a smooth point and pull out its symmetric
Bézier direction handles, with the next segment previewed live as a rubber
band. *Click the first point* to close the path; to finish it open, press
`Enter`, *double-click*, or simply **switch tools** — pressing `S` for
Select, any other tool shortcut, or a toolbar button accepts the path as
drawn. Only `Esc` abandons it. The path commits as an editable pen stroke,
drawn exactly as placed (never auto-sharpened), and keeps its anchors —
click it again with the Vector Path tool to rework them (see below). **Paint Bucket** (`G`) fills the enclosed path or
shape under the click with the current ink color, added as a new selectable
shape. **Fill Color** selects the element under the click — anywhere within
the element's dimensions counts, not just its outline, so clicking the middle
of a shape picks it — and fills it with the selected ink color; with no
element under the click it fills the current selection (open strokes and text
are recolored). **Eyedropper** (`I`) picks the color under the click
(averaged over the **Select pixel sensitivity**, 1–36px, default 10px), makes
it the ink color, and fills the selected shape when one is selected; hold
`Ctrl` to temporarily switch to the Select tool and pick a shape, then
release `Ctrl` to return to the eyedropper. **Join strokes** (`Ctrl+J` or the
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
