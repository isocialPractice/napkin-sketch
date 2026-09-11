# napkin-sketch

Quick and easy computer sketching with a drawing GUI that simulates pen and
paper/napkin sketching — featuring an **auto-sharpen** algorithm that turns
stiff, computer-drawn strokes into cleaner, more hand-drawn forms.

Draw with a **mouse, touchscreen, or pen** (pressure-aware), then let
napkin-sketch straighten your lines, round out your circles, square up your
boxes, and re-introduce a subtle organic wobble so the result still reads as
hand-drawn rather than vector-perfect.

![napkin-sketch — toolbar, pages panel, sharpen settings, and a sample sketch](assets/screenshot.svg)

**New here?** [QUICKSTART.md](QUICKSTART.md) gets you from a fresh clone to a
sharpened sketch in five minutes, and [CHEATSHEET.md](CHEATSHEET.md) puts every
shortcut, CLI flag, and npm script on one page. Drawing from a script rather
than by hand? [API.md](API.md) is the graphic-design API reference.

## Features

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
- **Touchscreen + mouse + stylus** input via Pointer Events (with coalesced
  sampling for smooth, high-frequency capture).
- **Pan and zoom** with a two-finger gesture (pan within a small threshold, zoom
  beyond it), the **mouse wheel** (`Alt` + wheel zooms, plain wheel pans,
  `Ctrl+Shift` + wheel pans across — all directions configurable), or the
  **Select tool with `Space` + drag**, plus **straight-line drawing** (hold
  `Space` and drag with a drawing tool; `Shift` mid-drag locks the line
  strictly horizontal or vertical until released).
- **Quick curve** — hold `Ctrl + Space` and drag to sweep a quarter ellipse
  with the active drawing tool, or add `Alt` for a quarter circle; the arc
  follows the drag and the release places its far end. `Alt` can be pressed or
  let go mid-drag to switch between the two, and each `Shift` tap swings the
  arc's apex a further 90° clockwise while both ends stay put.
- **Quick features** — press `W` then a number for stroke width, `Q` then a
  number for opacity, `Z` then a digit to zoom (`9` = 90%, `0` = 100%), or
  `C` / `Shift + C` to cycle the **Quick Access Colors**.
- **Endpoint snap** — hold `Shift` while drawing to snap the stroke's start and
  end to the nearest endpoint of an existing stroke (a ring marks the target).
  Works for freehand and curve drawing (the quick straight line and quick
  curve snap their start on press); the snap sensitivity (1–20px, default
  10px) and an on/off switch live in the settings. The optional **Join
  stroke** setting (off by default) merges a snapped stroke with the stroke
  it touches into one continuous stroke.
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
  a movable centre, by dragging on the canvas or by typing an angle), and
  **Join strokes** (`Ctrl+J`).
- **Fill Shape** — with the Select tool active and a shape selected, clicking
  a Quick Access Color fills the shape with it. Fills are honored by the
  canvas, thumbnails, and SVG/PDF export.
- **Layer groups** — `Ctrl+G` groups the active layer (nesting allowed);
  group visibility, lock, and opacity apply to every layer inside, and
  `Ctrl+Shift+G` ungroups.
- **Show Selection Borders** — a switch in the **Move** palette, beside its
  live preview, draws or drops the dashed blue outline around the selected
  elements. They stay selected and still move, copy and export the same way,
  and the layers panel still shows what is selected; only the outline on the
  canvas goes, so a drawing can be judged with something selected. On by
  default, and the same switch appears in both settings views.
- **Two synced settings views** — **Quick Settings** in-app (`Ctrl+,`: live
  sharpen, show selection borders, wobble, smoothing, circle snap, taper,
  symmetry, text size) and
  the **Verbose Settings** window (`Ctrl+Alt+,`, Edit menu, or the gear icon)
  which holds those same Quick Settings plus zoom/pan sensitivity, inverted
  zoom, the quick-feature timer, endpoint snap and Join stroke, the
  eyedropper's select pixel sensitivity, **Show selection borders**, the
  Direct Select grab radius, the Copic quick nib-rotate options
  (on/off, hold time, hold/rotate keys, rotation speed), Quick Access Color
  count and values, toolbar placement (top / side / both) with drag-and-drop
  **rearrange mode** (covers every tool in both toolbar groups — tools can
  even move between the groups — plus the Quick Access Colors), a light /
  dark / sepia **theme**, and auto-save. Settings
  persist across launches and can be exported to and imported from a JSON file.
- **Auto-sharpen engine** that recognizes intent (straight line, circle/ellipse,
  polygon, or freeform) and rebuilds an idealized, hand-drawn version.
  - **Live sharpen** (off by default) — beautify each stroke the moment you lift
    the pen.
  - **Sharpen all** — clean up an entire page (or a saved file) at once.
  - **Sharpen settings panel** — tune wobble, smoothing, circle snap, end taper,
    rotational **symmetry** (mandala mode), and text size.
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
  menu** with its layer tools (Add, Group, Ungroup, Rename, Delete, Move
  Up/Down, Hide Panel).
- **Properties panel** (`Ctrl + P`) - element-level editing for whatever is
  selected on the canvas or highlighted in the Layers panel: **Position**
  (X / Y in `px`, `in`, `mm`, or `pt`), **Appearance** (fill color, no
  fill, or a **gradient** with a draggable stop ramp; stroke width, dash
  style, or no stroke at all), and **Scale** (X / Y as a `%` factor or an
  exact `px`/`in`/`mm`/`pt` size, uniform by default). Because selecting a
  layer row selects its elements, it doubles as the layer's own property
  sheet.
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
- **Layer restacking moves the whole selection.** The panel's move buttons
  (and `Ctrl+]` / `Ctrl+[`) shift every selected row one step, not just the
  active one; the selection keeps its own order, unselected rows keep theirs,
  and a row that has reached the end of the stack holds the ones behind it
  rather than letting them pile through. A **selected group travels as a
  block**, carrying everything nested inside it, and a layer only moves among
  its own siblings, so it never leaks out of the group it lives in.
- **Sketchbook pages** with a toggleable, **resizable thumbnail panel**,
  page-turn animation, and add/delete/navigate controls — flip back to any
  earlier page. Thumbnails render at the display's device pixel ratio, so they
  stay crisp on HiDPI screens and at any panel width.
  A **right-click menu** on the panel adds **Page Settings**, which toggles a
  page between **endless** (fills the window, the default) and **sized**
  (an exact width and height with a dashed page outline). The panel's
  **hamburger menu** (the three bars beside `+ Page`) holds the three ways to
  start a page: **From Selection** measures the current selection, gives the
  new page those dimensions, and brings a **copy of the selection with it** -
  the copies land at the new page's origin and stay selected, while the
  originals stay where they were; **Default New Page** matches the page in
  view (what `+ Page` has always done); and **Custom New Page…** opens Page
  Settings with **Sized page** already applied so a width and height can be
  typed - the page is only added when **Add Page** is pressed, so closing the
  dialog leaves nothing behind.
- **Panel state at a glance** — the toolbar's Pages and Layers buttons fill
  in ("Panel in View") while their panel is open and sit flat when it is
  hidden.
- **Menu buttons toggle** — a button that drops a menu (Export, the pages
  panel's hamburger, Close Shape) reads as pressed while its menu is out, and
  pressing it again puts the menu away. A menu row with nested entries opens
  them beside itself on hover, and that panel stays put long enough to be
  reached across the rows in between.
- **Right-click the canvas** for Cut, Copy, Paste, Paste in Place, Duplicate,
  Delete, Select All, and Deselect All. Right-clicking an element that is not
  selected picks it first, so *Copy* means the thing just clicked. The layers
  panel's own menu carries the same clipboard rows, since a lit layer row is a
  selection.
- **Animation Mode** (`Ctrl+Shift+N`, or Edit > Animation Mode) — an
  **optional add-on** (`npm run animation-mode -- --install`; not part of a
  default install) that adds a frame-by-frame animation mode driven by an AI
  helper tool you install and sign in to yourself. The mode
  validates the page against the required character assemblies, then a
  wizard maps any missing assemblies onto existing layers, collects the
  animation type (**character: walk** ships ready-made), and draws the
  sequence **one frame at a time** through a configurable AI command. The app
  measures each joint and hands the helper finished SVG transforms, so a frame
  is a small file edit rather than a redrawn document. Each frame lands as a
  group layer continuing the `<type>_<n>` sequence and is offered for
  **Redraw / Keep and draw next / Done**. A frame count sets the pacing rather
  than a batch size: fewer frames move further each, more move less. See
  [Animation Mode](#animation-mode) for the workflow and requirements.
- **Native application menus** — *File* (New, Open, Import, Save, Save As,
  Export PNG / JPEG / SVG / PDF), *Edit* (Undo, Redo, **Cut / Copy / Paste /
  Paste in Place / Duplicate**, Delete, Select All, **Animation Mode**),
  and *View* with **Fit All in View** (`Ctrl+0`) to bring every graphic on
  the page into view at once.
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
- **Export** to PNG (transparent), JPEG (flattened), **SVG** (lossless vector,
  layers preserved as named groups that Inkscape and Illustrator both read;
  vector-tool strokes write exact cubic Béziers and
  freehand strokes shed sub-pixel-redundant samples, keeping files compact), or
  **PDF** (vector, no extra dependencies) —
  from the File menu or the top toolbar's **Export** button beside Import. Each
  format offers **Export current page** or **Export all pages** — raster and
  SVG save `name_1.ext`, `name_2.ext`, …, while PDF writes all pages into one
  document.
  The dropdown's **Selection** row opens the same four formats one level in and
  exports **only what is selected, on a document cut to its own dimensions** —
  no page-sized margin of empty space around the graphic. PNG and SVG come out
  transparent, since a graphic cropped to its ink is one about to be dropped
  into a composition; JPEG and PDF keep the page background, having no usable
  transparency of their own. With nothing selected but layer rows lit in the
  Layers panel, those layers and their descendants are what gets exported.
- **Import** (`Ctrl + I`) of **SVG** (vector shapes become editable strokes,
  **groups become nested, collapsible layer groups, and every named object
  becomes its own layer**, so an Illustrator or Inkscape file lands with the
  same layer tree it left with — napkin-sketch's own exports round-trip
  losslessly), **PDF** (each page's vector content becomes a new sketch page,
  best effort), and **PNG / JPEG** (placed as a movable image on the active
  layer).
- **CapsLock cursor** — crosshair while CapsLock is on; a circle matching the
  current stroke width when off. The eraser carries a dashed circle the size of
  the area it will clear.
- **Multi-page sketch books** saved as portable `.skbk` JSON files.
- **Undo / redo**, clear, custom ink colors, and keyboard shortcuts.
- **Embeddable API** — drop the same editor into a website, WordPress block, or
  VS Code webview (see [Embedding](#embedding-the-editor)).
- **Graphic-design API** — build a composition from rectangles, circles,
  ellipses, triangles, polygons, clipping masks, styled text and placed media,
  then render it to SVG or PNG from a plain Node script, with no browser and no
  image dependency. Both formats come off one document, so they are the same
  graphic (see [API.md](API.md)).
- **Installable desktop app** with a Start-menu/desktop shortcut and app icon
  (via electron-builder).
- Calm, accessible UI (WCAG-AA contrast, reduced-motion support — the
  page-turn animation and the symmetry-guide fade both stand still when the
  OS asks for reduced motion).

## Installation

### Desktop app (recommended)

The easiest way to install napkin-sketch is to build a native installer for
your OS using **electron-builder**. Each command builds the project and then
packages it into a platform installer placed in the `release/` folder.

#### Windows

```bash
npm install
npm run dist:win
```

This produces an **NSIS installer** (`release/Napkin Sketch Setup *.exe`).
Run the installer — it adds a **Start Menu** entry and an optional desktop
shortcut. No administrator rights are required (per-user install).

To uninstall: *Settings → Apps → Napkin Sketch → Uninstall*.

#### macOS

```bash
npm install
npm run dist:mac
```

This produces a **DMG disk image** (`release/Napkin Sketch-*.dmg`).
Open the DMG, drag **Napkin Sketch** into your `Applications` folder, then
eject the disk image. Launch via Launchpad or Spotlight.

> **Gatekeeper note**: On first launch macOS may say the app is from an
> unidentified developer. Right-click (or Control-click) the app icon, choose
> **Open**, then click **Open** in the dialog. You only need to do this once.

#### Linux

```bash
npm install
npm run dist:linux
```

This produces an **AppImage** (`release/Napkin Sketch-*.AppImage`). Make it
executable and run it directly — no installation needed:

```bash
chmod +x "release/Napkin Sketch-*.AppImage"
./release/"Napkin Sketch-*.AppImage"
```

To integrate with your desktop environment (application menu, file manager),
use a tool such as `appimaged` or `AppImageLauncher`, or create a `.desktop`
file manually.

### Build-and-run from source (all platforms)

Requires **Node.js 18+** and a compatible Electron version.

```bash
npm install
npm run build
npm start          # builds then opens a new blank sketch
```

To install the `napkin-sketch` CLI globally from a local checkout:

```bash
npm install
npm run build
npm link
napkin-sketch      # launches from anywhere
```

Once published to npm it can be installed directly:

```bash
npm install -g napkin-sketch
```

## Usage

```bash
napkin-sketch [option] [target]
```

| Parameter                | Description                                                           |
| :----------------------- | :-------------------------------------------------------------------- |
| `-h, --help`             | Show help for using the application from the command line.            |
| `-v, --version`          | Show the current version of the application.                          |
| `-b, --book`             | Open a saved sketch book file, using the `.skbk` extension.           |
| `-n, --new`              | New sketch, using `unnamed` or the name passed as `[target]`.         |
| `-f, --full-screen`      | Open the GUI window full screen; the default window is maximized.     |
| `-i, --import`           | Import an SVG, PDF, PNG, or JPEG file into the opening sketch.        |
| `-m, --multiple-imports` | Import a comma-separated list of files, laid out in a grid.           |
| `--sharpen`              | Auto-sharpen a saved sketch so it appears more hand-drawn, then open. |
| `[target]`               | A `.skbk` file to open, or a name for a new sketch file.              |

The GUI window opens maximized by default, which is not the same as full
screen: a maximized window fills the screen while keeping the title bar and its
minimize, restore-down, and close buttons in view, and restore-down returns it
to its 1280x860 size. Pass `-f, --full-screen` for true full screen, where
those buttons are not in view.

With `--multiple-imports`, each file's graphic size is measured against the
page first, then the graphics fill a row left to right and wrap to a new row
whenever the next graphic would overrun the page width; oversized graphics
scale down to fit the page. Every imported file becomes its own named layer.
Quote file names that contain spaces, for example
`-m logo.svg,"site map.svg",photo.png`.

### Examples

```bash
# Open a new, blank sketch
napkin-sketch

# New sketch named "ideas"
napkin-sketch --new ideas

# Open an existing sketch book
napkin-sketch --book ./notes.skbk

# Auto-sharpen a saved book on disk, then open it
napkin-sketch --sharpen ./notes

# Open a new sketch full screen (the default window opens maximized)
napkin-sketch --new -f

# Open a new sketch with logo.svg imported
napkin-sketch --import logo.svg

# Open a new sketch with three files laid out in a grid
napkin-sketch -m logo.svg,"site map.svg",photo.png
```

A bare path is treated as a sketch book to open:

```bash
napkin-sketch ./notes.skbk
```

## In-app controls

| Action                   | Shortcut                                  |
| :----------------------- | :---------------------------------------- |
| Pen                      | `P`                                       |
| Marker                   | `M`                                       |
| Copic marker             | `K`                                       |
| Rotate Copic nib         | Hold `Ctrl` 1s, then `Alt` / `Shift`      |
| Eraser                   | `E`                                       |
| Select                   | `S`                                       |
| Direct Select            | `A`                                       |
| Text                     | `T`                                       |
| Sharpen all              | `H`                                       |
| Quick width              | `W` then a number                         |
| Quick opacity            | `Q` then a number                         |
| Quick zoom               | `Z` then a digit (`9` = 90%, `0` = 100%)  |
| Fit All in View          | `Ctrl/Cmd + 0` (also in the View menu)    |
| Zoom (mouse)             | Hold `Alt` and scroll the wheel           |
| Pan (mouse)              | Scroll to pan; `Ctrl+Shift` + scroll pans across |
| Pan (Select / Direct)    | Hold `Space` and drag                     |
| Cycle Quick Access color | `C` (forward) / `Shift + C` (back)        |
| Straight line            | Hold `Space` and drag                     |
| Lock line to 90°         | `Shift` while dragging (release to free)  |
| Quick curve (ellipse)    | Hold `Ctrl + Space` and drag              |
| Quick curve (circle)     | Hold `Ctrl + Space + Alt` and drag        |
| Swing a quick curve apex | `Shift` (90° clockwise per press)         |
| Endpoint snap            | Hold `Shift` while drawing                |
| Rectangle                | `R` (`Shift` = square)                    |
| Ellipse                  | `L` (`Shift` = circle)                    |
| Curve                    | `V` (click and hold the button for variants) |
| Vector Path              | `B` (click = corner, drag = curve)        |
| Edit a vector path       | Vector Path tool, click a committed path  |
| Move point / round corner| `Ctrl` (drag point, handle, or target)    |
| Toggle anchor handles    | `Alt` + click the anchor                  |
| Paint Bucket             | `G`                                       |
| Fill Color               | toolbar button                            |
| Eyedropper               | `I` (hold `Ctrl` to select a shape)       |
| Move by a distance       | `Enter`, or the Move button (x / y, any unit) |
| Step a Move field        | Arrow keys; hold `Shift` for a coarse step |
| Rotate                   | `Ctrl/Cmd + R`, or the Rotate button      |
| Turn by hand             | Drag on the canvas while Rotate is open   |
| Accept a `Ctrl+R` turn   | Release the drag (the palette closes)     |
| Dock / undock a panel    | The button in the panel's title bar       |
| Move the rotation centre | Drag the crosshair, the grid, or Centre x / y |
| Snap a rotation to 15°   | Hold `Shift` while dragging, or the Snap toggle |
| Join strokes             | `Ctrl/Cmd + J`                            |
| Close shape              | Close Shape button, then Sharp or Smooth  |
| Drag-copy selection      | Hold `Alt` and drag the selection         |
| Group layers             | `Ctrl/Cmd + G` (groups the selected layers) |
| Ungroup layer            | `Ctrl/Cmd + Shift + G`                    |
| Rename layer             | `F2` or double-click the layer row        |
| Move layer up / down     | `Ctrl/Cmd + ]` / `Ctrl/Cmd + [`            |
| Select all               | `Ctrl/Cmd + A`                            |
| Deselect all             | `Ctrl/Cmd + Shift + A`                    |
| Quick Settings           | `Ctrl/Cmd + ,`                            |
| Verbose Settings         | `Ctrl/Cmd + Alt + ,`                      |
| Toggle pages             | `Ctrl/Cmd + B`                            |
| Toggle layers            | `Ctrl/Cmd + L`                            |
| Toggle properties        | `Ctrl/Cmd + P`                            |
| Animation Mode           | `Ctrl/Cmd + Shift + N`                    |
| Import file              | `Ctrl/Cmd + I`                            |
| Undo                     | `Ctrl/Cmd + Z`                            |
| Redo                     | `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z`  |
| Save                     | `Ctrl/Cmd + S`                            |
| Save As                  | `Ctrl/Cmd + Shift + S`                    |
| Delete selection / layer | `Delete` or `Backspace` (elements first; else the selected layer rows) |

**Text tool:** *click* to place an auto-sizing text box; *drag* to draw a
fixed-width text box (text wraps to fit the drawn width).

**Select tool:** the active tool when napkin-sketch opens. Shows the
**black arrow** pointer. *Click* a stroke to
select and drag it — a **filled shape's interior counts as the shape**, so
clicking its color grabs it, while unfilled outlines stay click-through in
the middle; *`Shift`-click* to
add it to (or remove it from) the current selection; *drag over empty space*
to rubber-band-select multiple strokes at once; `Ctrl+A` selects everything
and `Ctrl+Shift+A` deselects. Hold `Space` and drag to pan the canvas.
Selecting elements highlights their rows in the Layers panel.

**Direct Select tool (`A`):** shows the **white arrow** pointer — the
selection / direct-selection pairing of vector editors. *Click* an element
to show its **anchor points**, then *drag* an anchor to reshape the path. A
stroke drawn by the Vector Path, Curve, or quick-curve tools shows **just
its few Bézier anchors** (a quick curve is two), and the selected anchor's
**curvature handles** — drag a handle to bend the curve, with the opposite
handle staying collinear so the bend is smooth; freehand strokes show their
sampled points as before. Hold `Space` and drag
to **pan the canvas**, exactly as with the Select tool, and the other quick
keys (quick zoom, width, opacity, colors) work here too. *`Shift`-click* selects
multiple anchors to move together; *click the path* (not an anchor) to select
and move the whole path. A single selected anchor grows two **tangent
handles** — hollow circles on guide lines reaching out along the path each
way, like a vector editor's direction handles. *Drag a handle* to bend the
stroke around the anchor: the anchor stays pinned, the span between anchor
and handle turns rigidly so the handle tracks the pointer exactly, and the
bend fades smoothly into the rest of the stroke beyond it. Pulling a handle
longer or shorter stretches that span too. Selected anchors and paths render
blue, the grab sensitivity is configurable (Sketch Support, default 3px),
and `Esc` drops the edit (`Ctrl+Z` restores the shape).

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

**Quick curve:** hold `Ctrl + Space` and drag to sweep a **quarter ellipse**
with whichever drawing tool is active — one gesture, no bend step. The arc
leaves the point you pressed at flat and arrives at the pointer turning
straight up, bowing through the corner of the drag, and it reshapes live as
you move; **releasing places the far end**. Hold `Alt` for a **quarter
circle** instead: the shorter side of the drag sets the radius, the same way
`Shift` constrains the Ellipse tool. `Alt` is read continuously, so pressing
or releasing it mid-drag flips the arc between circle and ellipse as often as
you like.

Tap `Shift` to **swing the apex 90° clockwise**, once per press. The apex is
the arc's bowed-out belly, and only it moves: **both ends stay exactly where
the drag put them**, so a curve begun on an existing stroke stays joined to it
and its far end stays under the pointer while you choose which way the curve
bellies out. Two taps mirror the sweep across its chord — the same arc bowed
the other way — and four bring it back around. Holding `Shift` down does not
spin the apex; it parks at one angle. Note that on an `Alt` quarter circle
(or a square drag) the odd stops put the apex on the chord itself, flattening
the arc into a straight segment — with both ends pinned, a quarter circle can
only bow two ways — so mirroring a circle is two taps, not one.

`Esc` cancels. The committed stroke is one cubic Bézier — **two anchors and
two control points**, not a chain of dozens — so picking it up with the
Vector Path tool shows just those four, ready to rework. For a curve you can
bow by hand instead, use the **Curve** tool (`V`) below.

**Straight line:** hold `Space` and drag with any drawing tool for a clean
two-point line. Hold `Shift` during the drag to lock the line **strictly
horizontal or vertical** — whichever axis the drag favours — and release
`Shift` to free it again; the lock follows the key live, so you can toggle it
as often as you like mid-drag, and it engages without waiting for the pointer
to move.

**Endpoint snap:** hold `Shift` while drawing with the pen, marker, or Copic
marker and the stroke snaps to the nearest **endpoint** of an existing stroke —
the start point snaps on pen-down and the end point on pen-up (the Curve
tool's chord snaps both ends live). The quick straight line and quick curve
snap only their **start**, taken as you press down, because mid-drag `Shift`
is the axis lock for one and the apex key for the other. A small ring shows the
endpoint you will snap to whenever one is within the **snap sensitivity** (a
screen-pixel radius, so zooming in gives finer control). The sensitivity
(1–20px, default 10px) and the feature's on/off switch live under **Quick
Features** in the Verbose Settings window, alongside **Join stroke** (off by
default): when on, a snapped stroke merges with the stroke it touched (same
tool and color) into one continuous stroke.

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

**Editing a vector path:** strokes drawn by the Vector Path, Curve, and
quick-curve tools keep their **anchor points and Bézier control handles**
(a cubic segment is B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3, where
P0/P3 are anchors and P1/P2 the control points). With the Vector Path tool
active and no path in progress, *click such a stroke* to open it for editing
— every anchor shows, Illustrator-style. Then:

- *Click a segment* to **add an anchor** there (the segment splits without
  changing shape); *click an anchor* to **remove it**. The pointer telegraphs
  both: hovering an anchor shows a **"−" badge**, hovering the path between
  anchors a **"+" badge** (with `Ctrl` held too — `Ctrl`-clicking a bare
  segment also inserts an anchor).
- Hold `Ctrl` for direct-select edits: *drag an anchor* to move it (its
  handles ride along), or *drag one of the selected anchor's handles* to
  reshape the curve. A smooth point stays smooth: the opposite handle
  rotates to keep both collinear through the anchor (each keeps its own
  length), so the curve bends without creasing into a cusp.
- Hold `Ctrl` with an anchor selected and a **target icon** appears beside
  the corner: *drag the target* to **round the corner** into a circular
  fillet, growing with the drag — or type an exact radius into the
  **Radius** field that appears in the top toolbar while the Vector Path
  tool is active.
- Hold `Alt` and *click an anchor* to toggle its handles: a smooth point
  loses them and becomes a corner, a corner grows a smooth pair along its
  neighbour chord.
- The pointer follows the held modifier: `Ctrl` shows the **black Select
  arrow** (direct-select mode) over anything it can grab, and `Alt` a
  **stemless arrowhead** — an arrow reduced to just its head — for handle
  toggling.
- Clicking empty canvas or pressing `Esc` puts the path down; every change
  re-draws the stroke from its anchors immediately.

**Sharpen Selection** (toolbar button): smooths and simplifies the selected
strokes, like a vector editor's simplify command. A small dialog opens in the
corner with **Smooth** and **Simplify** sliders and the strokes preview the
result live on the canvas as the sliders move; **Apply** keeps the new shape
(one undo step returns the originals) and **Cancel** or `Esc` restores them
untouched. Distinct from **Sharpen all** (`H`), which runs the hand-drawn
auto-sharpen engine over every stroke.

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

**Layer groups:** `Ctrl+G` (or the Group button in the Layers panel) groups
the selected layers (or the active layer) into one group; press it again on a
group to nest. Starting to draw while a group row is selected adds a fresh
layer inside that group and puts the stroke there (a toast names the layer),
since a group holds no marks of its own. A group's
visibility, lock, and opacity apply to every layer inside it, the panel
indents grouped layers under a collapsible header (click the caret to
expand/collapse), and `Ctrl+Shift+G` dissolves the active group while
keeping its layers. Deleting a group deletes the layers inside it.

**Properties panel (`Ctrl+P`):** edits the current selection, element by
element. Selecting a layer row selects that layer's elements, so the panel is
also where a whole layer's stroke width is changed.

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

**Docking the editing panels:** **Move**, **Rotate**, **Page Settings**, and
**Sharpen Selection** are floating palettes - dragged by their title or by the
narrow band at their border, resized from their corner, and kept on screen if
the window shrinks. Each also carries a small button in its title bar that
**docks** it: the panel leaves the drawing and becomes a column beside the
layers and properties panels, so the canvas gives up the width rather than
being covered. The same button **undocks** it, back to the exact position it
was floating at. A docked panel that is closed stays docked, and the dock takes
no space at all while it is empty.

**Rotate (`Ctrl+R`, or the Rotate button beside Move):** turns the selection
about a centre point, in a palette that opens in the top-right rather than
centred - the canvas under the selection is where the rotation is dragged, so
a centred panel would be sitting on the pixels the gesture needs.

- **Drag on the canvas to turn it by hand.** Clockwise counts up in positive
  degrees, counterclockwise down in negative ones, and the field shows what the
  drag has measured. Swinging past half a turn keeps counting the same way
  round, and a second lap counts as a second lap. Releasing commits the turn as
  a single undo step and puts the field back to zero.
- **How it was opened decides what the release means.** From `Ctrl+R` the
  release *accepts*: the rotation is committed and the palette closes, so the
  whole thing is press, swing, let go. A press that turned nothing leaves it
  open, so a stray click cannot dismiss it. From the **Rotate** button or the
  Edit menu the palette stays up for typed angles, presets, and further turns,
  and is dismissed with **Rotate**, **Cancel**, or `Escape`.
- **The centre of rotation moves three ways**: drag the crosshair on the canvas
  (the pointer offers a grab where it can be picked up), pick one of the nine
  handles of the selection's box from the preset grid, or type an exact
  **Centre x / y** in `px`, `in`, `mm`, or `pt`. A centre that has been dragged
  or typed lights no preset, which is how the panel says it is custom.
- **Angle, direction, and snapping**: the angle field is signed, and the
  **CW / CCW** pair re-signs whatever magnitude is in it rather than clearing
  it - so `90` and a press of CCW gives `-90`. **Snap to 15°** rounds typed and
  dragged angles alike; `Shift` does the same for one gesture. Arrow keys step
  a degree, or 15 with `Shift`.
- **Live preview** (off by default) shows the typed angle on the canvas before
  it is committed, taking no history step, exactly as the Move dialog's does. A
  canvas drag always previews, whatever the checkbox says.
- Vector anchors and their tangent handles turn with the path, and a Copic
  stroke's broad nib keeps its bearing relative to the mark. Text and images
  have no orientation to turn, so they orbit the centre upright - an image by
  its middle rather than by its top-left anchor.

Gradients and dash styles are written into exported SVGs as real
`<linearGradient>` / `<radialGradient>` paint servers and `stroke-dasharray`
values, so other editors see them, and they round-trip back into napkin
unchanged.

**Imported SVGs keep their layer tree.** Nested `<g>` elements become nested
layer groups, and every *named* object becomes its own layer in its original
z-order position — Illustrator writes an object's name into `id`, so a
`<path id="outline">` sitting between two groups imports as an `outline` layer
between them rather than being flattened onto the parent. Names shed the `-2`,
`-3`, … suffix editors add to keep XML ids unique, so rows read `strokes` and
`outline`, not `strokes-10` and `outline-5`. *Unnamed* geometry inside a group
gets a layer of its own too, named after its tag (`path`, `line`, `rect`, …),
so every element in the source file has a row in the panel — only
napkin-sketch's own exported marks merge back onto their layer, keeping
napkin's exports round-tripping as clean single layers rather than one row
per stroke. Every top-level group imports as a layer group — a named one
(such as `<g id="circles">` around the whole drawing) under its name, an
anonymous one as `<Group>` — so no wrapper is ever flattened away. A document
with no groups at all arrives as one top group named after the imported file,
holding a tag-named layer per element.

**Imported SVGs keep their curves.** Path data is read command by command
(`M L H V C S Q T A Z`, absolute or relative) into the same Bézier anchors the
Vector Path tool edits: quadratics are degree-elevated to the identical cubic,
arcs become the standard quarter-turn cubic approximation, and `<circle>`,
`<ellipse>`, `<rect>` (rounded corners included), `<line>`, `<polyline>`, and
`<polygon>` are built from their attributes. A curve that arrived as four
numbers is exported as four numbers, at two-decimal precision, instead of a
polyline through hundreds of samples, so a file imported and exported without
edits keeps its geometry - and a `fill`-only source shape stays fill-only
rather than gaining an outline in its fill color. A compound path (an outlined
stroke with its inner contour, a ring, a letter with a counter) stays one
stroke whose contours are separate subpaths, so its holes fill as holes and
export as `… Z M …`. Path data the parser cannot read is sampled along its
length as before.

**CapsLock cursor:** while any drawing tool is active, **CapsLock on** shows a
precision crosshair; **CapsLock off** shows a circle preview matching the
current stroke width. The **eraser** shows a dashed circle the size of its
footprint, so the area about to be cleared is visible before pressing.

**Exported SVGs are written small.** An import followed by an export used to
come back larger than the file that went in; it now comes back smaller, with
the geometry unchanged to the coordinate. Four reductions do it, none of which
moves a curve:

- **Path data takes its shortest exact spelling.** Every command is offered in
  both its absolute and its relative form and the shorter one wins, a repeated
  command letter is dropped (readers carry it over), an axis-aligned line
  collapses onto `H`/`V`, and a cubic whose incoming handle mirrors the
  outgoing handle before it collapses onto `S` — the identical curve in two
  numbers instead of four. Relative deltas are measured from the *rounded*
  current point, so a reader reconstructs the absolute coordinate exactly and
  nothing drifts along a long path.
- **Numbers drop what nobody needs to read.** Two decimals, no trailing zeros,
  no leading zero on a fraction (`.5`, not `0.5`), and no separator where the
  next number already delimits itself.
- **Shared paint is stated once, on the root element.** `fill="none"`, round
  caps and round joins, and whichever `stroke-width` most marks happen to
  share ride on the `<svg>` and inherit; only the odd mark out names its own.
- **Defaults go unwritten.** A fully opaque mark says nothing about `opacity`,
  and a width of 1 is what SVG already assumes.

Measured on the test fixtures and the vector-graphics skill's own assets, a
round trip lands between **0.27x and 1.05x** of the source file, against
**1.14x to 1.49x** before — and all 77 paths across those files parse back to
byte-identical anchors and handles. The importer reads every one of these
spellings, so napkin's own exports still round-trip losslessly.

**Exported SVGs keep their layer names.** Each layer's group carries its name
three ways — `data-name` (napkin's own), `inkscape:label` with
`inkscape:groupmode="layer"` (what Inkscape's layers panel reads), and the
group `id` (what Illustrator reads) — so a sketch exported from napkin opens
with its layer names intact wherever it lands, and re-imports under the same
names. Characters an XML id may not hold are escaped as `_xHH_` and repeated
names take the `-2`, `-3`, … suffix editors expect; the importer undoes both.

**Live sharpen is off by default.** Toggle it in the **Quick Settings** panel
to beautify strokes automatically as you draw, or leave it off and use
**Sharpen all** when you are ready. The Quick Settings panel also exposes
wobble, smoothing, circle snap, end taper, rotational symmetry, and text size.
Raising rotational symmetry above 1 fades the mandala guide axes in, and
dropping it back to 1 fades them out.

### Animation Mode

> **Animation Mode is an optional add-on and is not part of a default
> install.** It is the only feature that needs software napkin-sketch does not
> ship — an agentic AI command-line tool — so it is installed separately and
> can be removed again. See
> [Installing Animation Mode](#installing-animation-mode) first; everything
> below assumes it is installed.

`Ctrl + Shift + N` (or **Edit > Animation Mode**) toggles a frame-by-frame
animation mode. Entering it switches to the Select tool, opens the Layers
panel, and shows a banner that validates the page live against the six
required character assemblies:

```text
front-arm-assembly   body   front-leg-assembly
back-leg-assembly    back-arm-assembly   Head
```

Names match case-insensitively and tolerate the `-2` / `_3` uniqueness
suffixes editors append. Each assembly is normally a layer group holding its
part groups (for example `front-arm` plus `front-glove` or `front-hand`,
each with `strokes` and fill sub-groups).

#### Installing Animation Mode

Every other feature of napkin-sketch runs on what the app ships. Animation
Mode does not: it hands each frame to an **agentic AI command-line tool that
you install and sign in to yourself** — Claude Code, GitHub Copilot CLI,
Codex, Gemini, or another tool that can read a prompt file and edit an SVG.
That is a real extra dependency, with its own installation, its own account,
and in most cases its own cost, which is why the mode is opt-in rather than
part of the app.

**A default install leaves it out.** `npm install` adds nothing: no Edit-menu
entry, no `Ctrl + Shift + N`, no banner, and no AI tool required to run the
app. Add the mode explicitly:

```bash
npm run animation-mode -- --status                 # is it installed?
npm run animation-mode -- --install                # defaults to Claude Code
npm run animation-mode -- --install --to copilot   # or codex, gemini, cursor…
npm run animation-mode -- --install --to plugin    # as a Claude Code plugin
npm run animation-mode -- --uninstall              # remove it again
```

Installing copies the `vector-animations` and `vector-graphics` skills plus the
helper instructions into that tool's dot-folder (`.claude/`, `.github/`, …)
and writes `ai-helper/installed.json`. (`--to plugin` copies nothing, because
`ai-helper/` **is** the `vectors` plugin: that target checks the folder over
and prints the two `/plugin` commands that load it, which are a step you have
to run yourself - see the `plugin` target below.) Installing over an install
that targeted somewhere else removes that one first, so switching delivery
never leaves two copies of a skill loaded. That record is the only thing the app
reads to decide whether the mode exists, so the feature is genuinely plugged
in and out rather than merely hidden. **Restart the app** after either
command.

Before the first run, make sure the tool itself is ready:

1. **Install the AI tool** and check its command runs in a terminal
   (`claude`, `copilot`, `codex`, `gemini`, …).
2. **Sign in to it.** Start the tool in a terminal once and follow its own
   sign-in prompt.
3. **Point napkin-sketch at it** if it is not Claude Code: set
   `animationHelperCommand` in **Verbose Settings**.

If a run cannot start the tool, or the tool reports that nobody is signed in,
the app says so and offers **Open sign-in**, which starts that tool in a
terminal of its own so it can run its own sign-in. **napkin-sketch never
asks for, reads, or stores a credential** — your account stays between you
and your AI tool, and the install record names only which tool was chosen.

**Uninstalling keeps the rest of the app intact.** It removes the two skills
and the instructions file it installed (anything else in that dot-folder is
left alone) and deletes the install record. A plugin install deletes nothing -
what it installed is tracked source the repository needs either way - and
prints the `/plugin` commands that unload it instead. Sketching, layers, export,
import, pages, and every other feature are unaffected, and the app stops
needing an AI tool at all.

With the mode installed, the banner's **Generate…** button runs the wizard:

1. **Animation setup** — the category (**Character** or **Object**), the
   animation type, and how many **frames the sequence runs to**. The note
   names the frame the first run will draw (`walk_1`, or
   `animationLayer-walk_1` for an unnamed source).

   **The frame count is pacing, not a batch.** Frames are still drawn one at a
   time and the sequence still runs for as long as you keep pressing Keep and
   draw next; the count sets how far each frame moves. A cycle's whole
   movement is spread across that many frames, so **fewer frames move further
   each and more frames move less**. It opens at the number of skeletons the
   cycle was drawn from — eight for a walk — and the note says which way a
   change moves the pose. A type with no measured cycle passes the number to
   the AI helper as context instead: this frame is worth about one Nth of the
   movement.

   **Every type is selectable.** Four - walk, run, idle, knocked down - run off
   cycles **measured from the drawn skeletons** in
   `character-wireframes.svg`; the other ten are marked **Work in Progress**
   and are posed by the AI helper from a **template** carried in the prompt — one sentence describing
   what a single step of that movement does, and whether the sequence loops.
   That is what makes them usable now, and why their frames need a closer
   eye than a walk's:

   | Category | Types |
   |----------|-------|
   | Character | walk · idle · run · attack · damage · taunt · talk · jump · fall down · knocked down |
   | Object | rotate · break · move · explode |

   The list and the templates come from one table in the source, so an option
   can never appear without the prompt behind it.
2. **Map missing layers** (character animations only, and skipped when the
   page already validates) — for each missing assembly, a dialog asks which
   layers consist of it (Cancel / Back / Next); the chosen layers are grouped
   under a new group named for the assembly. **Object animations skip this
   entirely**: they move the graphic as a whole and have no arms or legs to
   map, so setup comes first and decides whether the assemblies are needed.
3. **One frame at a time** — the source frame is written to
   `_temp/animation-source.svg` and a short form (under 3 KB) to
   `_temp/animation-form.txt`. The helper applies the `vector-animations` skill
   and **edits that file rather than redrawing it**: it sets one `transform`
   per assembly and saves the result as `animations/<type>_<n>.svg` (the
   folder is created if missing). A source frame named `character-walk_1`
   produces `animations/character-walk_2.svg`; an unnamed source starts a
   0-based `animationLayer-<type>` sequence. The app ends the run the moment
   the file is complete — it never waits for the helper to finish talking —
   and imports the frame as a group layer mirroring the source's structure.

   **Frames stand side by side.** A drawn frame is a copy of its source with
   the assemblies turned, so it would otherwise land exactly on top of it and
   hide the new pose. Each frame is placed one gap to the right of the frame
   it came from and the view fits the page afterwards, so the sequence builds
   left to right as an animation strip. Only the horizontal position moves;
   the cycle's vertical bob is part of the pose.

   **Frame files are sprites.** The SVG kept in `animations/` is sized to the
   ink, not to the napkin-sketch page, and carries no background rect — so a
   frame drops into an animation composition as it stands, with no empty
   margin around it and nothing opaque behind it. The box is the frame's
   stroke bounds grown by half the widest stroke, and it is reached by
   offsetting the document's `viewBox` rather than moving the geometry. The
   app rewrites the file from the frame it imported, so the sizing is exact
   whatever the helper saved.

   **The app measures the pose itself.** Each assembly's joint pivot comes
   from its own bounds (shoulder and hip at the top, neck at the bottom of the
   head; the body only bobs), and the form hands the helper finished
   `transform` values to copy. A group transform rotates every anchor *and its
   Bezier handles* together, which is the rigid joint rotation a frame needs,
   and the importer resolves it — so a transformed frame and a redrawn one
   import identically, but the transform costs one attribute instead of tens
   of thousands of tokens of SVG. **character: walk** ships with an eight-step
   cycle that closes and loops; a type without a cycle asks the helper to
   choose the angles using the same mechanics.

   Each frame is then offered for **Redraw** (discard it and draw the same
   index again), **Keep and draw next** (that frame becomes the source for
   the next one), or **Done** — so a sequence runs exactly as long as the
   cycle needs. There is **no overall time limit**, but a run with no frame
   and no output for 5 minutes is killed so it can never hang, and **Cancel**
   kills it immediately. The temp folder is cleared when the wizard ends.

The helper command is the `animationHelperCommand` setting (default
`claude -p --model sonnet --dangerously-skip-permissions <
_temp/animation-form.txt` — a Sonnet-class model is pinned because setting six
attributes in a file is mechanical work that a mid-size model does quickly);
any agentic CLI that reads the form and edits a file works — Claude Code,
GitHub Copilot, Codex, or a plain LLM command-line tool. A tool that can only
print falls back to printing the whole document, which the app recovers from
stdout and saves itself. The AI-facing contract
(`animation-mode.instructions.md`) and two supporting skills live canonically
in the version-tracked `ai-helper/` folder: `vector-animations` (the assembly
list, joint pivots, cycle tables, transform recipe, Bezier-curve and
animation-essentials references, the character wireframe rig, and an object rig
drawing what a break and a burst do to the pieces) and
`vector-graphics` (a general Bezier-curve and SVG-structure skill -
linear/quadratic/cubic references, layer-management conventions for naming,
nesting, and compound paths, shape, object, and letterform assets, and a
dependency-free script that derives SVG path data from control points). That
folder is also the plugin itself, so the same files reach a tool that loads
plugins and a tool that reads a dot-folder, and neither copy can go stale.
Every generated form names the `vector-animations` skill and tells the helper
where to find both; a frame turns existing geometry, so `vector-graphics` only
comes into play when something has to be drawn from scratch. Because AI tool
dot-folders are commonly gitignored, a fresh clone installs them with:

```bash
npm run ai-helper -- --to claude        # .claude (default when no --to)
npm run ai-helper -- --to github        # .github (Copilot)
npm run ai-helper -- --to cursor        # any other tool dot-folder
npm run ai-helper -- --to plugin        # check the vectors plugin, print /plugin
npm run ai-helper -- --list             # show every known target
NAPKIN_AI_HELPER=claude,github npm install   # or install on clone via env
```

**The `plugin` target is the odd one out**, because there is nothing for it to
copy. `ai-helper/` **is** the `vectors` plugin: the manifest, the command, the
subagent, both skills, and the contract are the folder's own contents, and the
marketplace that lists it is one manifest at the repository root.

```text
.claude-plugin/marketplace.json   lists vectors, source ./ai-helper
ai-helper/
  .claude-plugin/plugin.json      the manifest, versioned from package.json
  commands/animation-mode.md      /vectors:animation-mode - draw one frame
  agents/animation-frame.md       the same job as a subagent, in its own context
  skills/vector-animations/       assemblies, pivots, cycles, transform recipe
  skills/vector-graphics/         Bezier formulas, layer structure, path scripting
  instructions/                   the contract a helper follows
```

So the target checks that tree, syncs the manifest version to `package.json`,
and prints what actually loads the plugin - which readying it never did:

```text
/plugin marketplace add .                              # from a clone
/plugin marketplace add isocialPractice/napkin-sketch  # without one
/plugin install vectors@napkin-sketch
```

**A plugin is more than the two skills.** Loaded, it namespaces what it
carries: the skills answer to `vectors:vector-animations` and
`vectors:vector-graphics`, `/vectors:animation-mode` runs a frame from the
form the app wrote, and `vectors:animation-frame` is a subagent that does the
same job in a context of its own so a frame's SVG never lands in the main
conversation. The app knows the difference: an install recorded as `plugin`
makes every generated form name the plugin's parts, because a bare skill name
reaches nothing once the skill lives inside one.

**Nothing here is generated**, which is the point. The two deliveries read the
same files, so a skill cannot be current in one and stale in the other, and a
test fails if any skill ever appears twice in the tree.

**Debugging a run**: every helper invocation is logged to
`logs/animation-helper.log` (the `animationLogFile` setting; the folder is
created on first write, an empty value disables the log, and clearing the
`_temp/` folder never touches it) with the command, the frame it asked for,
the exit code, duration, stderr, and the start of stdout — check it when a
frame does not appear. The path is **relative to the helper's working
directory** and is held to that: an absolute path, a drive letter, or a `..`
segment is refused and the default is used instead, so a log can never be
written somewhere the setting did not name.

## How auto-sharpen works

Each stroke runs through a four-stage pipeline:

1. **Resample + denoise** — even out the raw pointer samples and remove jitter
   (uniform resampling + Ramer–Douglas–Peucker simplification).
2. **Recognize intent** — classify the stroke as a line, circle/ellipse,
   polygon, or freeform curve (least-squares circle fit, corner detection,
   straightness test).
3. **Rebuild** — regenerate an idealized version of the detected shape while
   preserving its size, position, and winding direction.
4. **Humanize** — re-apply subtle, deterministic value-noise *wobble*, taper the
   stroke ends, and anchor endpoints so the result looks hand-drawn rather than
   mechanically perfect.

The engine is pure and deterministic (seeded from each stroke's id), so the same
stroke sharpens identically whether it is processed live in the GUI or headless
via `napkin-sketch --sharpen`.

## The `.skbk` file format

A sketch book is a human-readable JSON document:

```jsonc
{
  "format": "napkin-sketch",
  "version": 2,
  "name": "notes",
  "sketches": [
    {
      "id": "sk_…",
      "name": "unnamed",
      "width": 1280,
      "height": 800,
      "background": "#fcfaf5",
      "layers": [
        { "id": "ly_…", "name": "Layer 1", "opacity": 1, "visible": true, "locked": false }
      ],
      "strokes": [
        {
          "id": "st_…",
          "tool": "pen",
          "color": "#1f2328",
          "width": 3,
          "layer": "ly_…",
          "sharpened": true,
          "points": [{ "x": 12, "y": 34, "pressure": 0.6 }],
          // Optional: Bézier anchors for Vector Path editable strokes.
          "vector": {
            "anchors": [
              { "p": { "x": 12, "y": 34 }, "hOut": { "x": 20, "y": 30 } },
              { "p": { "x": 60, "y": 80 }, "hIn": { "x": 52, "y": 70 } }
            ]
          }
        }
      ],
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "createdAt": "…",
  "updatedAt": "…"
}
```

Files are saved atomically (write-then-rename) so an interrupted save cannot
corrupt an existing book.

**Migrating from version 1**: older `.skbk` files load unchanged — each page
gains a single default layer and every stroke is assigned to it. Version 2
files also allow `"tool": "image"` strokes carrying an `image` data URL plus
`imageWidth` / `imageHeight` for placed raster imports, and `"tool": "copic"`
strokes carrying a `nibAngle` (degrees) for the rotatable broad nib.

## Embedding the editor

The same drawing engine ships as a **framework-agnostic, browser-safe** package
with no Electron or Node dependencies. Use it on a website, in a WordPress
block, or inside a VS Code webview.

With a bundler (ESM):

```ts
import { NapkinSketch } from 'napkin-sketch';
import 'napkin-sketch/styles.css';

const editor = new NapkinSketch(document.getElementById('host')!, {
  liveSharpen: false, // off by default, like the desktop app
  onChange: (e) => console.log(e.toJSON()),
});

editor.setTool('pen');
editor.sharpenAll();
const png = editor.toDataURL('image/png');
const svg = editor.toSVG();  // lossless vector export
const pdf = editor.toPDF();  // latin1-safe byte string; save with binary encoding
```

Via a plain `<script>` tag (the IIFE build exposes a global `napkin`):

```html
<div id="host" style="width: 640px; height: 420px"></div>
<script src="node_modules/napkin-sketch/dist/embed/napkin-sketch.js"></script>
<script>
  const editor = new napkin.NapkinSketch(document.getElementById('host'));
</script>
```

You can also import just the pure engine (no DOM) to sharpen strokes yourself,
generate PDFs, or parse an SVG into layered strokes (browser only):

```ts
import { sharpenStrokes, parseSketchBook, sketchesToPdf, importSvg } from 'napkin-sketch';

// Nested groups and named objects come back as a nested layer tree. Pass
// `unnamedElements: 'split'` to also give every unnamed element its own
// `<Path>` layer, mirroring an Illustrator layers panel exactly.
const { width, height, layers } = importSvg(svgText, { unnamedElements: 'split' });
```

## Drawing with the graphic-design API

Compositions are the other way to make a graphic here: instead of a pointer, a
script. Build a page out of simple elements - rectangles, circles, ellipses,
triangles, polygons, lines, paths, text, placed media and clipping masks - then
render it to **SVG** or **PNG**.

```ts
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });

design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fontSize: 28, fill: '#ffffff' });
design.defineClip('badge', { type: 'circle', cx: 180, cy: 220, r: 64 });
design.image({ src: logo, x: 116, y: 156, width: 128, height: 128, fit: 'cover', clip: 'badge' });

const svg = design.toSVG();  // a string
const png = design.toPNG();  // PNG file bytes, rasterized in pure TypeScript
```

Headless by default and dependency-free in both directions: no browser, no
canvas, no Electron window, and no native image library. Pages default to 360
by 360 pixels, coordinates are pixels unless the page names another unit, and
the app's own canvas is drawn into only when it is explicitly handed over.

Both renderers read one document, so the SVG and the PNG of a composition are
the same graphic and differ only in the media export format. The full
reference, every element's properties, and worked examples are in
[API.md](API.md).

## Packaging a desktop installer

napkin-sketch builds native installers with **electron-builder** (configured in
`package.json`). The app icon is generated from `assets/icon.svg` at build time.

```bash
npm run build      # bundle into dist/ (also writes assets/icon.png)
npm run dist       # build an installer for the current OS
npm run dist:win   # Windows NSIS installer (Start-menu + desktop shortcut)
```

The Windows NSIS installer registers a Start-menu entry and desktop shortcut
named **Napkin Sketch** and lets the user choose the install directory.

## Testing

Unit tests use Node's built-in test runner. The TypeScript sources are bundled
on the fly by esbuild, so no separate compile step is needed.

```bash
npm test
```

Suites cover the geometry utilities, the auto-sharpen classifier and transforms,
`.skbk` serialization/normalization (including the version 1 → 2 layer
migration), the layer-aware SVG exporter, the PDF writer and its import
round-trip, the CLI argument parser, the launch contract, the animation cycle
and form helpers, the measurement units, the rotate transforms, the
graphic-design API, and a regression suite pinning the defects earlier source
reviews found — so a fix that was hard to see cannot quietly come undone.

The graphic-design suite draws real files: it renders a reference composition
and several variations of it to both formats, writes them to `.tmp/`, and
deletes them on the way out, so a run leaves the working tree as it found it.
The one thing a graphics test cannot assert is whether the picture looks right,
so there is a flag for looking:

```bash
npm test -- --keep-graphics   # keep the generated SVGs and PNGs, and print where
```

## Project structure

```text
src/
├── cli/index.ts        # Command-line entry (arg parsing, GUI launch, headless sharpen)
├── main/
│   ├── main.ts         # Electron main process, native menus, image export, IPC
│   └── preload.ts      # Secure window.napkin bridge
├── renderer/
│   ├── index.html      # GUI markup (toolbar, pages/layers panels, settings panel)
│   ├── settings.html   # Verbose Settings window markup
│   ├── styles.css      # GUI styling (60-30-10, WCAG-AA)
│   ├── renderer.ts     # UI wiring + pointer input
│   ├── settings.ts     # Verbose Settings window logic
│   ├── surface.ts      # High-DPI, layered canvas rendering + SVG export
│   ├── svg-import.ts   # SVG → layered strokes importer (browser-only)
│   └── store.ts        # App state, layer stack, undo/redo history
├── sharpen/
│   ├── geometry.ts     # Geometry & curve utilities
│   └── sharpen.ts      # Auto-sharpen engine
├── api/
│   ├── index.ts        # Public, browser-safe API barrel
│   └── embed.ts        # Embeddable NapkinSketch editor
└── core/
    ├── types.ts        # Shared data model (sketches, layers, strokes)
    ├── nib.ts          # Copic broad-nib geometry (canvas, SVG, and PDF share it)
    ├── units.ts        # Print-unit conversions for the properties panel
    ├── settings.ts     # Application settings: defaults, limits, validation
    ├── serialize.ts    # Browser-safe .skbk (de)serialization + validation
    ├── sketchbook.ts   # .skbk file I/O (atomic writes)
    ├── pdf.ts          # Dependency-free vector PDF writer (browser-safe)
    ├── pdf-import.ts   # Best-effort PDF vector importer (Node-only)
    ├── graphic-design/ # Graphic-design API: elements in, SVG or PNG out
    │   ├── types.ts    #   Composition data model (page, elements, masks)
    │   ├── compose.ts  #   Authoring surface: createComposition and friends
    │   ├── svg.ts      #   SVG back end (browser-safe, DOM-free)
    │   ├── raster.ts   #   Software rasterizer (scanline coverage, clipping)
    │   ├── png.ts      #   PNG encoder and decoder
    │   ├── deflate.ts  #   DEFLATE/zlib codec the PNG pair runs on
    │   ├── font.ts     #   Built-in stroke font + the layout both back ends share
    │   ├── geometry.ts #   Transforms, flattening, path data, dashing, stroking
    │   ├── color.ts    #   CSS color parsing for the rasterizer
    │   ├── canvas.ts   #   Canvas 2D painter (the GUI-canvas target)
    │   └── files.ts    #   Node-only file helpers (data URLs, paired export)
    ├── paths.ts        # Dependency-free path helpers
    ├── animation.ts    # Animation Mode data model, pose steps, helper form
    ├── animation-cycles.ts   # Cycle tables measured from the wireframe asset
    ├── animation-install.ts  # Animation Mode's optional-install record
    ├── ai-tool.ts      # The AI tools the helper can drive, and why one refused
    ├── launch.ts       # CLI ↔ main launch contract
    └── ipc.ts          # IPC channel + bridge types
```

## Development

```bash
npm run build        # Bundle CLI, main, preload, renderer, and the embed API
npm run build:watch  # Rebuild on change
npm run build:types  # Emit .d.ts declarations for the embeddable API
npm run typecheck    # Type-check without emitting
npm test             # Run the unit test suites
npm run start        # Build, then launch a new sketch
npm run clean        # Remove dist/

# Print the layer tree an SVG would import as (runs the real importer in a
# hidden Electron window; no GUI needed)
npm run import-tree -- test/imports/applied_layer_names.svg

# Archive checked TODO.md items into its "## Complete" section (kept at the
# bottom of the file), noting which section each came from; safe to re-run
npm run todo
```

The build uses **esbuild** to bundle the Node-side code (CommonJS), the renderer
(browser IIFE), and the embeddable API (ESM + IIFE); `tsc` is used only for
type-checking and for emitting the public type declarations.

## License

MIT
