# Selecting and editing

## At a glance

- **Fill Shape** — with the Select tool active and a shape selected, clicking
  a Quick Access Color fills the shape with it. The custom color well beside
  the swatches does the same: the selection follows the picker as it is
  dragged, and the whole drag undoes as one step. Selected open strokes take
  the color as their ink instead. Fills are honored by the canvas,
  thumbnails, and SVG/PDF export.
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
