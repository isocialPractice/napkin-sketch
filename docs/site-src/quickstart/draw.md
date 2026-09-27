# Quickstart: drawing

Draw something, make it quick, and sharpen it: the tools of the **Sketch**
menu and the toolbar in one sitting. Every key here is the app's own
default; [Menus and shortcuts](../guide/menus-and-shortcuts.md) lists them all
and says how to change them.

## 1. Open a blank sketch

From a clone, `npm start` builds the app and opens a new, blank sketch; an
installed app opens one from its icon, and `napkin-sketch` does from a shell
once `npm link` has been run. See [Installation](../install.md).

The **Select** tool is in hand when the app opens, so press `P` for the pen
before drawing.

## 2. Draw with the pen, the marker and the Copic

1. `P` - the pen. Draw a wobbly box and a lopsided circle; pressure from a
   pen or a touchscreen widens the line.
2. `M` - the marker, a broad, even line.
3. `K` - the Copic marker, a flat nib: thick across, thin along. Hold `Ctrl`
   for a second to show the nib, then `Alt` or `Shift` to turn it.
4. `E` - the eraser. It takes away what is under it on its own layer, and
   the paper shows through.

## 3. Set the width, the opacity and the color

1. `W` then `5` - a stroke width of 5. `Q` then `50` - an opacity of 50%.
2. `C` - the next Quick Access Color; `Shift + C` goes back.
3. With the Select tool and something selected, a width typed after `W`
   widens or narrows the selected outlines instead of the next stroke.

## 4. Draw straight lines and curves by hand

1. Hold `Space` and drag - a clean straight line. Add `Shift` mid-drag to lock
   it horizontal or vertical.
2. Hold `Ctrl + Space` and drag - a quarter ellipse. Add `Alt` for a quarter
   circle; tap `Shift` to swing the arc's apex 90 degrees.
3. Hold `Shift` while drawing to snap the stroke's ends onto the nearest end
   of another stroke; a ring marks the target.

## 5. Draw shapes and paths

1. `R` - a rectangle; `L` - an ellipse. Hold `Shift` for a square or a
   circle.
2. `V` - a curve: drag a chord, bend it, click to place it.
3. `B` - a vector path: click for corners, drag for smooth points, `Enter` to
   finish it open or click the first point to close it.
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
