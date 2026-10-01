# Quickstart: layers

Keep what you drew in order: name layers, group them, restack them, and edit
a selection in the Properties panel. [Layers and the Properties
panel](../guide/layers.md) has the full detail.

## 1. Show the Layers panel

`Ctrl + L` shows or hides it; so does **Layers > Hide Layers Panel** and the
toolbar button that opens it.

## 2. Draw, and watch the rows

Draw two or three strokes. Every new element gets **its own layer**, named
after the tool that drew it - `Brush 1`, `Brush 2` - and the panel lists the top
of the stack first.

## 3. Pick rows

1. Click a row to make it the active layer; its marks are selected on the
   canvas, and selecting on the canvas lights the rows the marks are on.
2. `Ctrl`-click adds a row or takes it out; `Shift`-click takes every row
   between the last one and this one.

## 4. Rename a layer

Press `F2`, or double-click the row, type the name and press `Enter`.

## 5. Group and ungroup

1. Light two or more rows and press `Ctrl + G`: they go into a new group,
   which folds and opens with the caret beside its name.
2. `Ctrl + Shift + G` ungroups the active group.

## 6. Clip with a shape

1. Draw a filled rectangle, then a circle over it, and select both.
2. Press `Ctrl + 7`, or choose **Layers > Clipping Mask > Make**: the two go
   into a Clip Group, and the rectangle shows only inside the circle, which
   paints nothing while it clips.
3. `Ctrl + Alt + 7` releases it: the rectangle shows all of itself again,
   and the circle with it.

## 7. Restack

1. `Ctrl + ]` moves the lit rows up the stack, `Ctrl + [` down.
2. Or drag a row: between two rows to move it there, onto a group row to
   put it inside.

## 8. Hide, lock and fade

Each row has an eye to hide the layer and a lock to keep it from being drawn
on or selected; the slider under the list sets the active layer's opacity.

## 9. Edit in the Properties panel

`Ctrl + P` opens the Properties panel for the selection: its position and
size in any unit, its fill and gradient, and its outline's width and style.

## Where next

- [Quickstart: pages](pages.md) - more than one page in a sketch book.
- [Menus and shortcuts](../guide/menus-and-shortcuts.md) - the Layers menu
  and the panel's right-click menu.
