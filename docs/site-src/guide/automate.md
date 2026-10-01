# Automate

## Generating a script

**Automate > Generate Script** writes napkin script for you and shows it
before anything uses it. It has three sources:

- **From Media File** opens a file as File > Import does. An SVG is read
  into the layer tree an import would add and written whole; a PDF's pages
  are written one after another, a `newpage` before each after the first.
  A picture - PNG, JPEG, GIF or WebP - is not traced: the script makes a
  page the picture's size and places the file on it with `link`, by its
  file name, so the script draws it wherever the picture sits beside it.
  Tick **Embed the image data** to put the picture itself in the script
  with `image`, and the script needs nothing beside it.
- **Selected Layers** writes the rows lit in the Layers panel, or with none
  lit, the layers of the selected marks, with the groups above them so the
  tree still stands. **Page: keep size** writes the page as it is; **fit to
  the selection** writes a page the size of what was chosen, with it moved
  to the corner. The row is greyed while nothing is selected.
- **From Session History** writes what you drew while **Track History** was
  on (see [Tracking history](#tracking-history)). A popup lists the steps
  recorded on the page in view, each ticked, with its index, tool type and
  command, a search and a radio button for each main type, and the History
  Limit across the top. Untick a step to leave it out: the script is then
  the drawing as it would be had that step not happened. A removal left out
  brings its mark back, an addition left out drops its mark and every
  change to it, and a change left out takes back only what it changed. The
  script draws what the session drew, with each step's comment - its
  index, type, command and time - before the first mark it drew, and a line
  for what it did to other marks and to the layers.

The **Generated script** dialog shows the whole script in a box you can
scroll and select, with a line that counts its instructions, marks and
layers, and a note for anything the language cannot say as the drawing
does: pen pressure, for one, is written even. A clipping mask is written as a
`clip` block, which clips with the last closed shape it draws, or, when its
clip mark is not that shape or the group has an opacity of its own, as a
plain group, with a note. An older file's eraser mark is written as `tool
eraser`, which a script reads as the cut it paints: run, the script draws the
marks cut, and no eraser mark. A picture's data is shortened
in the box, and everything else takes all of it. **Copy** puts the script
on the clipboard, **Save As** writes a `.napkin` file, **Open as New Page**
runs the script into a page of its own after the one in view - the honest
way to see what it draws - and **Cancel** or Escape closes the dialog.
Every script starts with a comment saying what it was written from, and the
notes follow as comments, so a saved script carries both, and `napkin-sketch
draw` runs it like any other (see [Drawing from a script](../scripting.md#drawing-from-a-script)).

## Tracking history

**Automate > Track History** records the drawing's history as you work:
every step you could undo - a stroke, a command, a change in the Layers
panel - and every undo and redo, each with what it changed. It is off until
you turn it on, and the row shows a check mark while it is on. A step is
named for what made it: the command that ran ("Rotate"), the tool whose
press on the canvas made it ("Brush stroke"), or, when nothing named it, what
it changed ("Changed 2 marks"). A drag is one step, as it is one undo. Only
the document is recorded: zoom, pan, the panels, the tool in hand and the
colour are not, except as the marks they paint. The steps are what
**Generate Script > From Session History** writes from, and that row is
greyed while nothing is recorded.

**Automate > History Limit** opens **Verbose Settings** at its **Automate**
section, which holds the same Track History switch and the limit: how many
steps are kept, from 50 to 5,000 in steps of 50, and 500 unless you change
it. Past the limit the oldest step goes first. Under the limit the section
says how many steps there are and roughly how much memory they hold. The
steps last as long as the document is open: a new or opened document starts
a new history, and turning Track History off clears it, since a step
recorded later could change a mark drawn while nothing was recording.
