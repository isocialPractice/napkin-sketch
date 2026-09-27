# Layers and the Properties panel

## At a glance

- **Layers** — every page has a layer stack with per-layer **opacity**,
  **visibility**, **lock**, **rename**, and **reordering** (`Ctrl + L` opens
  the panel), managed like a common vector editor: every **new element gets
  its own layer**, `Shift`-click **multi-selects** rows, canvas selection and
  panel selection **highlight each other**, group rows **expand/collapse**,
  rows **drag-and-drop** to reposition or to nest inside a group, and
  deleting an element deletes its emptied layer (deleting a layer deletes its
  elements). Renaming a layer is `F2` or a **double-click** on its row, and
  the name arrives **highlighted** so a new one can be typed straight over
  it. Drawing, erasing, and selection respect the active layer, and
  the eraser only cuts holes in its own layer. The panel is **in view by
  default**, **resizable** (drag its inner edge), and offers a **right-click
  menu** with the menu bar's **Layers** rows (Add Layer, Group Layer, Ungroup,
  Rename, Delete Layer, a **Move** submenu of Layer Up and Layer Down, Hide
  Layers Panel) and the clipboard rows between them.
- **Layer groups** — `Ctrl+G` groups the active layer (nesting allowed);
  group visibility, lock, and opacity apply to every layer inside, and
  `Ctrl+Shift+G` ungroups.
- **Layer restacking moves the whole selection.** The panel's move buttons
  (and `Ctrl+]` / `Ctrl+[`) shift every selected row one step, not just the
  active one; the selection keeps its own order, unselected rows keep theirs,
  and a row that has reached the end of the stack holds the ones behind it
  rather than letting them pile through. A **selected group travels as a
  block**, carrying everything nested inside it, and a layer only moves among
  its own siblings, so it never leaks out of the group it lives in.
- **Properties panel** (`Ctrl + P`) - element-level editing for whatever is
  selected on the canvas or highlighted in the Layers panel: **Position**
  (X / Y in `px`, `in`, `mm`, or `pt`), **Appearance** (fill color, no
  fill, or a **gradient** with a draggable stop ramp; stroke width, dash
  style, or no stroke at all), and **Scale** (X / Y as a `%` factor or an
  exact `px`/`in`/`mm`/`pt` size, uniform by default). Because selecting a
  layer row selects its elements, it doubles as the layer's own property
  sheet.

## The Layers panel

**Layers panel:** every **new drawn element gets its own layer** named after
the tool (an empty active layer is reused; eraser strokes stay on the active
layer so they keep cutting its content). *Click* a row to make it active and
highlight its elements on the canvas; *`Shift`-click* to multi-select rows;
*drag* a row to reposition it in the stack, or drop it onto a group row to
nest it inside. **Rename** the active layer with `F2`, or *double-click* any
row (the right-click menu's Rename does the same) - the row's name turns into
a text box with the current name **already highlighted**, so typing replaces
it; `Enter` or clicking away commits, `Esc` cancels. `F2` opens the panel
if it is hidden and unfolds any group the layer is buried in. Deleting an
element deletes its layer once the layer is empty, and the Delete button - or
the `Delete` key while no element is selected - removes every selected layer
together with its elements.

## Layer groups

**Layer groups:** `Ctrl+G` (or the Group button in the Layers panel) groups
the selected layers (or the active layer) into one group; press it again on a
group to nest. Starting to draw while a group row is selected adds a fresh
layer inside that group and puts the stroke there (a toast names the layer),
since a group holds no marks of its own. A group's
visibility, lock, and opacity apply to every layer inside it, the panel
indents grouped layers under a collapsible header (click the caret to
expand/collapse), and `Ctrl+Shift+G` dissolves the active group while
keeping its layers. Deleting a group deletes the layers inside it.

## The Properties panel

**Properties panel (`Ctrl+P`):** edits the current selection, element by
element. Selecting a layer row selects that layer's elements, so the panel is
also where a whole layer's stroke width is changed. **`Ctrl/Cmd`-click** picks
rows out one at a time (clicking a selected row again takes it back out) and
**`Shift`-click** takes every row between the last one selected and this one —
the two modifiers every layer panel uses, and the one place they differ. A
`Shift` range covers the rows the panel is *showing*: rows folded away inside a
collapsed group are not swept up with them.

- **Position** - the X and Y of the selection's top-left corner. Each axis has
  its own unit: `px` (default), `in`, `mm`, or `pt`. Typing a value moves the
  selection there; it never resizes anything.
- **Appearance / Fill** - a color well recolors the fill (for a text item, its
  ink), **No fill** clears it, and **Gradient** opens the ramp editor: drag a
  handle to move a stop, **double-click a stop to recolor it** in the color
  picker, double-click the empty ramp to add a stop where you clicked,
  `+` and `−` add and remove stops (two is the minimum), and the type picker
  switches between **Linear** (with an angle slider) and **Radial**. The flat
  fill is kept underneath, so **Remove** brings it back.
- **Appearance / Stroke** - width in pixels, a **Solid / Dashed / Dotted**
  style whose dash pattern scales with the width, and **No stroke** for a
  fill-only shape (the color and width are kept, so the button turns back into
  **Add stroke**).
- **Scale** - with the default `%` unit each field is a factor to apply (`150`
  enlarges by half); with `px`, `in`, `mm`, or `pt` it is the size the
  selection should end up. **Uniform scaling** (on by default) applies one
  factor to both axes; unchecked, each field scales its own axis. Scaling is
  anchored at the selection's top-left corner, so the Position values above
  stay put, and line weight scales with the shape.
