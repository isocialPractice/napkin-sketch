# Selecting and editing

## At a glance

- **Fill and stroke** — with the Select tool active and something selected,
  clicking a Quick Access Color paints the selection with whichever of fill
  and stroke is in front ([Fill and stroke](tools.md#fill-and-stroke)): with
  the stroke, every outline and text takes it; with the fill (`X` puts it in
  front), every closed shape is filled with it and open lines keep what they
  have. The color picker in the fill and stroke control does the same: the
  selection follows it as it is dragged, and the whole drag undoes as one
  step. `Shift + X` swaps each selected shape's fill and outline. Fills are
  honored by the canvas, thumbnails, and SVG/PDF export.
- **Stroke width on a selection** - with the Select tool active and something
  selected, the **Width** slider widens or narrows the selected outlines as it
  moves, and the whole drag undoes as one step. A width typed with Quick Width
  (`W`, then a number) does the same. Text and images have no outline and are
  left alone; with a drawing tool in hand, the slider sets the width of the
  next mark only.
- **Show Selection Borders** (`Ctrl/Cmd + H`) — a switch in the **Move** and
  **Mirror** palettes, beside their live preview, draws or drops the dashed blue outline
  around the selected elements. They stay selected and still move, copy and export the same way,
  and the layers panel still shows what is selected; only the outline on the
  canvas goes, so a drawing can be judged with something selected. On by
  default, and the same switch appears in both settings views.
- **Hold Shift while dragging to pin the movement** to the nearest **axis or
  45-degree diagonal**. The direction is taken from the pointer's own travel
  since the drag began and re-chosen as it moves, so swinging around the start
  point swaps the drag onto the line it now points down; the movement is
  *projected* onto that line, so the thing being dragged keeps up with the
  pointer instead of lagging at its perpendicular foot. Letting Shift go hands
  the drag straight back to the pointer.
  It applies to **moving a selection** (and so to the Alt-drag copy), to
  **Direct Select and Vector Path** drags of an anchor, a handle, or a whole
  path, and to the **Space + drag pan**. Drags where Shift already means
  something else keep that meaning: the rubber-band marquee (Shift adds to the
  selection), drawing (Shift snaps to an endpoint), the quick curve (Shift
  swings the apex), and the shape tools.
- **Shift-click still toggles selection membership** — but on an element that
  is *already* selected the removal now waits for the release, so the same
  press can start a Shift-constrained drag instead. A Shift-press that never
  moves is still a Shift-click.
- **A press inside a selection belongs to the selection.** Hit-testing is
  forgiving by design — every mark is widened by a few screen pixels so a thin
  line can be clicked at all — and that forgiveness used to outrank the
  selection: pressing in the middle of several selected elements would land on
  whatever unselected mark happened to be nearby, replace the whole selection
  with it, and drag that one thing instead. The selection now keeps the press,
  so the drag moves what you were aiming at. The element under the pointer is
  not lost: release without moving and it is selected, exactly as a click on it
  always did.
- **Undo / redo**, clear, custom ink colors, and keyboard shortcuts.

## The Select tool

**Select tool:** the active tool when napkin-sketch opens. Shows the
**black arrow** pointer. *Click* a stroke to
select and drag it — a **filled shape's interior counts as the shape**, so
clicking its color grabs it, while unfilled outlines stay click-through in
the middle; *`Shift`-click* to
add it to (or remove it from) the current selection; *drag over empty space*
to rubber-band-select multiple strokes at once; `Ctrl+A` selects everything
and `Ctrl+Shift+A` deselects. Hold `Space` and drag to pan the canvas.
Selecting elements highlights their rows in the Layers panel.

## What a click picks

*Changed in 1.0.0-alpha.4.6.0: a click used to pick the first mark in the
page's list within 8 page units of the mark's centre line, a reach that no
setting changed and that grew on screen as you zoomed in.*

- **The mark on top, where its ink is.** A click picks the mark whose painted
  ink is under the pointer, and when marks overlap, the one painted over the
  others. The order is the canvas's: the Layers panel's stack, so a layer
  moved up picks on top as it paints on top. A line is as wide as it is
  painted, pressure included, and so are a Copic's broad nib and a stroke
  drawn with a Stroke Profile. A dashed line counts as solid, gaps and all.
  Text and images pick by their boxes.
- **Failing that, the nearest.** A click beside the ink picks the nearest mark
  within the **Select sensitivity**, in screen pixels: 4 unless changed in
  Verbose Settings > Sketch Support (1 to 20). Screen pixels, so it reaches as
  far at every zoom.
- **Erased ink is gone.** The Eraser cuts the marks themselves, so a click
  where it passed picks nothing. An older file's eraser marks are never
  picked or boxed either, and a click where one has cut a mark away picks
  nothing there.
- **A rubber band takes what its box meets.** Every mark whose ink the box
  touches joins the selection, a line it only crosses included. A rectangle's
  edge counts even with none of its corners inside the box. A filled shape
  also counts when the box sits inside its fill.
- **Direct Select picks the same way**, at its own reach, the **Direct Select
  sensitivity** (8 unless changed, 1 to 20 screen pixels). See
  [Direct Select](vector-paths.md#direct-select).

## Copy and paste

- **Copy and paste** (`Ctrl+C` / `Ctrl+X` / `Ctrl+V`), from the Edit menu, a
  right-click on the canvas, or the keyboard:
  - **Paste lands under the pointer** when the pointer is over the canvas, and
    steps down-right from the copied position when it is not, so a run of
    pastes stacks visibly instead of piling up in one spot.
  - **Paste in Place** (`Ctrl+Shift+V`) puts the elements back at the exact
    coordinates they were copied from — the way to move a graphic to another
    page without it drifting. The clipboard belongs to the app, not to a page,
    so a copy taken on one page pastes onto any other.
  - **Duplicate** (`Ctrl+D`) copies and pastes in one step without disturbing
    the clipboard, and keeps a group's layers the same way a paste does.
  - **Alt-drag** copies the selection and drags the copy, leaving the original
    where it was. While Alt is held over a selection - and for as long as the
    copy is being dragged - the pointer becomes **two arrows**: the usual one
    at the hotspot and a second stepped out beside it in the inverse fill,
    with a node square beside them, so the modifier shows its effect before
    the drag commits to it.
  - Pasted elements become the selection and the Select tool takes over, so
    the new copy can be dragged straight away.
  - **A copied group keeps its layers**, however the group was reached.
    Clicking its row and rubber-banding its marks are the same gesture: a
    group joins the copy when every one of its mark-carrying layers is in the
    copy already. Pasting then rebuilds the tree rather than flattening it -
    every nested layer comes back with its own name, opacity, visibility, and
    lock, and the marks keep the paint order they had, so the graphic is
    identical to the one copied. This holds for `Ctrl+V`, `Ctrl+D`, and the
    Alt-drag copy alike. The copy lands as a **sibling of
    the original**, at the same nesting level rather than inside it, and only
    the pasted root takes a **" - Copy"** suffix; the layers under it keep the
    names the source file gave them. Pasted onto another page, where there is
    no original to sit beside, the tree goes in at the top level.
  - **A plain canvas selection still pastes flat**, onto one layer, the way
    any element lands - a few marks picked out with the rubber band are not a
    structure worth rebuilding.
  - **A group row is a fine place to paste onto.** Selecting an imported
    graphic by its group row and pasting a *flat* clipboard drops a new layer
    inside that group and carries on, the same way drawing on a group does.
    Only a genuinely locked or hidden layer refuses, and it says which.
  - **The system clipboard comes too**: a copy also goes out as SVG, so it can
    be pasted into Illustrator or Inkscape, and a graphic copied in one of
    those pastes in here (as layers, through the same importer the File >
    Import path uses). An in-app copy wins over its own SVG echo; a newer
    outside copy wins over the in-app one.
