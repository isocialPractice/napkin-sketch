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
  it. Drawing and selection respect the active layer; the Eraser
  cuts the selected marks, or every mark it touches, wherever they are, and
  adds no layer. The panel is **in view by
  default**, **resizable** (drag its inner edge), and offers a **right-click
  menu** with the menu bar's **Layers** rows (Add Layer, Group Layer, Ungroup,
  Rename, Delete Layer, a **Move** submenu of Layer Up and Layer Down, a
  **Clipping Mask** submenu of Make and Release, a **Blend** submenu of the
  blend modes, Hide Layers Panel) and the clipboard rows between them.
- **Layer groups** — `Ctrl+G` groups the active layer (nesting allowed);
  group visibility, lock, and opacity apply to every layer inside, and
  `Ctrl+Shift+G` ungroups.
- **Clipping masks** — `Ctrl+7` groups the selection into a **Clip Group**
  that shows only inside the closed path on top, which paints nothing while
  it clips; `Ctrl+Alt+7` releases it.
- **Blend modes** - the **Blend** select under Opacity, or **Layers > Blend**,
  sets how the selected layers mix with what is under them, the paper
  included: a vector editor's sixteen blend modes under napkin names, such as
  **Stack Blend** for Multiply. `Shift+Plus` and `Shift+-` step through them.
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
the tool (an empty active layer is reused). The Eraser adds no layer and no
mark: it cuts the marks themselves ([Eraser](tools.md#eraser)). *Click* a row to make it active and
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

## Clipping masks

**Clipping masks:** select what to clip and, on top of it, the closed path to
clip it with, then choose **Layers > Clipping Mask > Make** (`Ctrl+7`). The
layers the selection is on go into a new group, a **Clip Group**, and
everything in it shows only inside the topmost path, its **clipping path**,
which paints nothing while it clips. The clipping path's layer moves to the
top of the group. In the Layers panel the group's row carries a ◘ and the
clipping path's row a **clip** badge, its name underlined in dots.

- **What is hidden cannot be picked.** A click outside the clipping path picks
  nothing in the group, a click inside it picks what shows there, and a
  selection box takes a mark only where it shows. Direct Select (`A`) still
  reaches every mark, the clipping path included, so its anchors can be
  edited where they are.
- **The dashed boxes box what shows**: a selected mark's box is cut to the
  clipping path's bounds.
- **Release** (`Ctrl+Alt+7`) takes the clip off the clip group around the
  selection, or around the selected or active layer. The group stays a group
  and the clipping path paints again; `Ctrl+Shift+G` then ungroups it. Make
  and Release are one undo step each.
- **One mark selected, or an open path on top**, does nothing, and a notice
  says why.
- **A clip group can hold another**: the inner one shows only where both
  clipping paths overlap.
- **Effects come after the clip**, so a clip group's drop shadow falls under
  what shows, not under the whole of what it holds.
- **Every export keeps it**: the SVG clips the group with a `<clipPath>`,
  the PDF with a clipping path, the Illustrator script with a clipped group
  ([Import and export](import-export.md#clipping-masks-travel-with-the-file)).
  A script makes one with `clip { ... }`
  ([Drawing with napkin script](../api/drawing/README.md#clipping-masks)).

## Blend modes

*New in 1.0.0-alpha.5.0.0.*

**Napkin Blends:** a layer's blend decides how what it paints mixes with what
is under it - the layers below it and the paper. Set it for the selected layer
rows, or the active layer, with the **Blend** select under Opacity at the foot
of the Layers panel or with **Layers > Blend**, or step through the list with
`Shift+Plus` and `Shift+-`. A blended layer's row carries a mark of two
circles, with the mode's name in its tooltip.

The sixteen modes are a vector editor's, in its order, under napkin names,
with the vector editor's name beside each:

| Napkin Blend | Vector editor | What it does |
| --- | --- | --- |
| Normal | Normal | Covers what is under it |
| Soak Blend | Darken | Keeps the darker of the two colors |
| Stack Blend | Multiply | Multiplies, as ink stacks on paper: always darker |
| Scorch Blend | Color Burn | Darkens what is under it, with more contrast |
| Dry Blend | Lighten | Keeps the lighter of the two colors |
| Sheer Blend | Screen | The opposite of Stack Blend: always lighter |
| Bleach Blend | Color Dodge | Brightens what is under it, with less contrast |
| Fold Blend | Overlay | Multiplies the darks and screens the lights of what is under it |
| Light Blend | Soft Light | A soft light shone on what is under it |
| Heavy Blend | Hard Light | A hard light shone on what is under it |
| Messy Blend | Difference | The difference between the two colors |
| Avoidance Blend | Exclusion | Messy Blend with less contrast |
| Tidy Blend | Hue | Its hue, with the lightness and saturation of what is under it |
| Bright Blend | Saturation | Its saturation, with the hue and lightness of what is under it |
| Dye Blend | Color | Its hue and saturation, with the lightness of what is under it |
| Cover Blend | Luminosity | Its lightness, with the hue and saturation of what is under it |

- **The paper takes part.** A Stack Blend over the paper darkens into it,
  grain and all, as ink soaks into a napkin; a layer at Normal covers the
  paper as it always did. An export with no paper - a transparent export of a
  selection - has no paper to mix with, so a blend there mixes only with the
  layers under it.
- **A group with a blend** paints what it holds as one picture and blends
  that. **Isolate Blending** (Layers > Blend, on a group) keeps the blends
  inside a group from reaching past it: they mix only with each other. A group
  with an opacity below 100% that holds a blended layer is isolated as well,
  as SVG and PDF composite such a group.
- **Each change is one undo step**, for every selected layer at once.
- **Every export keeps it**: the SVG as `mix-blend-mode` with the napkin name
  in `data-blend`, the PDF as a transparency group with `/BM`, the Illustrator
  script as each layer's `blendingMode`, and a PNG made without the app by the
  same math - the W3C's, which vector editors, photo editors, CSS and PDF
  share. An SVG from another editor brings its `mix-blend-mode`, written inline
  or in a `<style>` rule, and its `isolation` in with it. A script sets one with
  `blend` ([Drawing with napkin script](../api/drawing/README.md#blend-modes)).

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
- **Appearance / Opacity** - the opacity and the blend of the selection's
  layers, as the Layers panel sets them; an **fx** button that drops the
  Effect menu's rows down, to add an effect; and how many effects the
  selection has, which opens the Appearance panel (see
  [Effects and the Appearance panel](effects.md)).
- **Scale** - with the default `%` unit each field is a factor to apply (`150`
  enlarges by half); with `px`, `in`, `mm`, or `pt` it is the size the
  selection should end up. **Uniform scaling** (on by default) applies one
  factor to both axes; unchecked, each field scales its own axis. Scaling is
  anchored at the selection's top-left corner, so the Position values above
  stay put, and line weight scales with the shape.
