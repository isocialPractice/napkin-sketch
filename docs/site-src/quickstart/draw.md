# Quickstart: drawing

Draw something, make it quick, and sharpen it: the tools of the **Sketch**
menu and the toolbar in one sitting. Every key here is the app's own
default; [Menus and shortcuts](../guide/menus-and-shortcuts.md) lists them all
and says how to change them.

## 1. Open a blank sketch

From a clone, `npm start` builds the app and opens a new, blank sketch; an
installed app opens one from its icon, and `napkin-sketch` does from a shell
once `npm link` has been run. See [Installation](../install.md).

The **Select** tool is in hand when the app opens, so press `B` for the brush
before drawing.

## 2. Draw with the brush, the marker, the Copic, the pencil and the smear

1. `B` - the brush. Draw a wobbly box and a lopsided circle; pressure from a
   pen or a touchscreen widens the line.
2. `M` - the marker, a broad, even line.
3. `K` - the Copic marker, a flat nib: thick across, thin along. Hold `Ctrl`
   for a second to show the nib, then `Alt` or `Shift` to turn it.
4. `N` - the pencil, graphite HB through the paper's grain. Press its button
   for the drawing kit - graphite 4H to 8B, the charcoal pencils, vine and
   compressed charcoal - and draw over a line again to darken it.
5. `Shift + N` - the smear, a blending stump. Hatch a patch with the pencil,
   then drag across it to blend the lines into shading; `W` and a number
   size the stump, `Q` and a number set its strength.
6. `E` - the eraser. It cuts what it passes over out of the drawing: the
   selected marks, or with nothing selected every mark it touches.
7. `Shift + E` - the Shape Eraser. Select what to cut, choose a rectangle,
   an ellipse, a square or a circle from the panel under its button, and
   drag it over them; **Top Path** in the panel cuts them with the closed
   path on top of them instead.
8. `Shift + M` - the Shape Stacker. Select two overlapping shapes and drag
   across their pieces to merge them into one; hold `Alt` to take the pieces
   away, or `Shift` to drag a box. Its panel holds the Wipe Stacks.

## 3. Set the width, the opacity and the color

1. `W` then `5` - a stroke width of 5. `Q` then `50` - an opacity of 50%.
2. `C` - the next Quick Access Color; `Shift + C` goes back.
3. `X` - the fill in front: the colors now paint the fill, and a rectangle or
   an ellipse drawn next is filled with it. `X` again for the stroke;
   `Shift + X` swaps the two.
4. With the Select tool and something selected, a width typed after `W`
   widens or narrows the selected outlines instead of the next stroke, and a
   color paints the selection - its outlines, or with the fill in front its
   closed shapes.

## 4. Draw straight lines and curves by hand

1. Start a stroke, then hold `Space` - it becomes a clean straight line from
   where you pressed, its end snapping to another stroke's end in reach. Add
   `Shift` mid-drag to hold it level, plumb or at 45 degrees.
2. Click with the Brush, then hold `Shift` and click somewhere else - a straight
   line joins the two clicks, and each Shift-click after it adds another, all
   one line.
3. Start a stroke, then hold `Ctrl + Space` - a quarter ellipse. Add `Alt` for
   a quarter circle; tap `Shift` to swing the arc's apex 90 degrees.
4. Hold `Shift` while drawing to snap the stroke's ends onto the nearest end
   of another stroke; a ring marks the target.

## 5. Draw shapes and paths

1. `R` - a rectangle; `L` - an ellipse. Hold `Shift` for a square or a
   circle.
2. `V` - a curve: drag a chord, bend it, click to place it.
3. `P` - a vector path: click for corners, drag for smooth points, hold `Shift`
   for 45-degree steps; `Enter` finishes it open, and a click on the first
   point, where a ring shows, closes it.
4. `T` - text: click for a box that grows as you type, or drag a box of a
   fixed width.

## 6. Sharpen it

Press `H` (**Sharpen all**): the box squares up and the circle rounds out,
with a little wobble left in so it still reads as drawn by hand. To sharpen
each stroke as you lift the pen, turn on **Live sharpen** in Quick Settings
(`Ctrl + ,`). [Sharpening](../guide/sharpen.md) says how the engine decides
what a stroke meant.

## 7. Undo, save and export

1. `Ctrl + Z` undoes, `Ctrl + Shift + Z` redoes.
2. `Ctrl + S` saves a `.skbk` sketch book.
3. **File > Export** writes PNG, JPEG, SVG or PDF.

## Where next

- [Tools](../guide/tools.md) and [Gestures and input](../guide/gestures.md) -
  everything the tools and the held keys do.
- [Quickstart: transforming](transform.md) - move, turn, mirror and bend
  what you drew.
- [Cheatsheet](../../../CHEATSHEET.md) - every key on one page.
