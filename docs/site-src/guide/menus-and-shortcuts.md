# Menus and shortcuts

## At a glance

- **Nine menus in the menu bar**: **File**, **Edit**, **View**, **Transform**
  (Vector Path, Transform Box, Move, Rotate, Join, Close Shape, Wipe Stacks,
  Mirror, Sharpen, Mesh Warp), **Sketch** (Brush, Marker, Eraser, Shape
  Eraser, Shape Stacker, Split, Apply Erasers, Text, Copic, Direct, Stroke
  Profile, Fill in Front, Swap Fill and Stroke), **Layers**,
  **Pages**, **Automate** and **Help**. They are generated from
  `src/core/menu/tool-types.json`, which gives every command a *tool type* -
  a tool is in every menu that accepts its type, which is how the clipboard
  rows reach Edit, the canvas and the layers panel from one entry - and a
  row greys when there is nothing for it to act on: Cut with nothing
  selected, Undo with nothing to undo, Delete Page with one page.
  **Edit > Edit Keyboard Shortcuts** changes any tool's keys, and **Edit >
  Edit Tool Types** changes which menus list it, each saved in a file of
  your own; see [Changing a shortcut](#changing-a-shortcut) and [Moving a
  tool to another menu](#moving-a-tool-to-another-menu). **Automate >
  Generate Script** writes the napkin script for a file or for the selected
  layers and shows it before anything uses it; see [Generating a
  script](automate.md#generating-a-script). **Automate > Track History** records every
  step of the drawing's history, and **History Limit** sets how many are
  kept; see [Tracking history](automate.md#tracking-history). **Help**
  opens this documentation in a window of its own, with no network needed;
  see [The Help menu](#the-help-menu).
- **Native application menus** — *File* (New Sketch, Open, Import, Save,
  Save As, Export PNG / SVG / JPEG / PDF, Exit), *Edit* (Undo, Redo, **Cut /
  Copy / Paste / Paste in Place / Duplicate**, Delete, Select All, Verbose
  Settings, Rearrange Toolbar, **Edit Keyboard Shortcuts**, **Edit Tool
  Types**, and **Animation Mode** once it is installed), and *View* (the
  Pages, Layers and Properties panels, Quick Settings, Developer Tools,
  **Fit All in View** (`Ctrl+0`) to bring every graphic on the page into view
  at once, **Zoom In** and **Zoom Out** (`Ctrl++`, `Ctrl+-`), which zoom the
  canvas by a quarter about its middle, and Full Screen).
- **A bare `Alt` opens the menu bar** only when no other key was pressed in
  the 5 seconds before it and it was not used for a scroll, a drag or a
  press; `Alt` with a menu's underlined letter always works. See [Alt and the
  menu bar](gestures.md#alt-and-the-menu-bar).
- **Right-click the canvas** for Cut, Copy, Paste, Paste in Place, Duplicate,
  Delete, Select All, Deselect All, and the [Wipe Stacks](transform.md#wipe-stacks)
  for two or more selected shapes. Right-clicking an element that is not
  selected picks it first, so *Copy* means the thing just clicked, and a
  right-click on empty paper keeps the selection. The layers panel's own menu
  carries the same clipboard rows, since a lit layer row is a selection. Every
  row shows its shortcut at its right edge, and greys when there is nothing
  for it to act on.
- **Menu buttons toggle** — a button that drops a menu (Export, the pages
  panel's hamburger, Close Shape) reads as pressed while its menu is out, and
  pressing it again puts the menu away. A menu row with nested entries opens
  them beside itself on hover, and that panel stays put long enough to be
  reached across the rows in between.
- **Panel state at a glance** — the toolbar's Pages and Layers buttons fill
  in ("Panel in View") while their panel is open and sit flat when it is
  hidden.

`Ctrl` is `Cmd` on macOS. The keys are the app's own, from
`src/core/menu/shortcuts.json`, so the menus, the tooltips and the
[shortcut table](#keyboard-shortcuts) all show the same ones; `npm run
menu-docs` writes that table and the one of the menus below. **Edit > Edit
Keyboard Shortcuts** changes the keys for you alone; see [Changing a
shortcut](#changing-a-shortcut).

## The menus

Every command has a *tool type*, `Main:sub`, such as `Draw:Modify:element`
for Rotate. A menu lists each tool whose sub-type is the menu's own name,
as `App:file` is in File, or is one the menu takes, as Transform takes
`Modify:element`. A tool whose type fits two places is in both, which is
how the clipboard rows reach Edit, the canvas and the layers panel from one
entry; the right-click menus follow the same rule. The menu bar, with what
each menu takes and holds:

<!-- menus:start -->
| Menu | Takes | Holds |
| :--- | :---- | :---- |
| File | `file` | New Sketch; Open…; Import…; Save; Save As…; Export: PNG Image…, SVG Vector…, JPEG Image…, PDF Document…; Exit |
| Edit | `edit`, `edit:mixed`, `Subtract:element`, `edit:selection` | Undo; Redo; Cut; Copy; Paste; Paste in Place; Duplicate; Delete; Select All; Verbose Settings…; Rearrange Toolbar; Edit Keyboard Shortcuts…; Edit Tool Types…; Animation Mode (once installed) |
| View | `view` | Toggle Pages Panel; Toggle Layers Panel; Toggle Properties Panel; Quick Settings; Toggle Developer Tools; Fit All in View; Zoom In; Zoom Out; Toggle Full Screen |
| Transform | `transform`, `Add:vector`, `Modify:element`, `Combine:element`, `Subtract:vector` | Vector Path; Transform Box; Move…; Rotate…; Join; Close Shape: Sharp, Smooth; Wipe Stacks: Wipe In, Wipe Out, Mid Wipe, Outer Wipes, Clean Wipe; Mirror…; Sharpen: Sharpen Selection…, Sharpen All; Mesh Warp; Liquify |
| Sketch | `sketch`, `Add:mark`, `Modify:vector`, `Subtract:mark` | Brush; Marker; Eraser; Shape Eraser; Shape Stacker; Split; Apply Erasers; Text; Copic; Pencil; Smear; Direct; Stroke Profile…; Fill in Front; Swap Fill and Stroke |
| Layers | `layers`, `Add:layer`, `Modify:layer`, `Subtract:layer` | Add Layer; Group Layer; Ungroup; Rename; Delete Layer; Move Layer: Layer Up, Layer Down; Clipping Mask: Make, Release; Hide Layers Panel |
| Pages | `pages` | Add Page: Default New Page, Custom New Page…, From Selection; Delete Page; Previous Page; Next Page; Page Settings…; Hide Pages Panel |
| Automate | `automate`, `automate:mixed` | Generate Script: From Media File…, Selected Layers…, From Session History…; Track History; History Limit… |
| Help | `help` | Verbose; Tool Types: Transform, Draw, Pages, Layers, Automate; Source Code; Source Docs (once the site is published) |
<!-- menus:end -->

A toolbar tool such as Rectangle, and a key such as Quick Width, is in no
menu. [Moving a tool to another menu](#moving-a-tool-to-another-menu)
changes a tool's type, and so the menus that list it.

## Keyboard shortcuts

<!-- shortcuts:start -->
| Command | Menu | Shortcut | Notes |
| :------ | :--- | :------- | :---- |
| New Sketch | File | `Ctrl+N` |  |
| Open | File | `Ctrl+O` |  |
| Import | File | `Ctrl+I` |  |
| Save | File | `Ctrl+S` |  |
| Save As | File | `Ctrl+Shift+S` |  |
| Undo | Edit | `Ctrl+Z` |  |
| Redo | Edit | `Ctrl+Shift+Z` or `Ctrl+Y` |  |
| Cut | Edit | `Ctrl+X` |  |
| Copy | Edit | `Ctrl+C` |  |
| Paste | Edit | `Ctrl+V` |  |
| Paste in Place | Edit | `Ctrl+Shift+V` |  |
| Duplicate | Edit | `Ctrl+D` |  |
| Delete | Edit | `Delete` or `Backspace` | Elements first; else the selected layer rows |
| Select All | Edit | `Ctrl+A` |  |
| Deselect All | Canvas right-click menu | `Ctrl+Shift+A` |  |
| Verbose Settings | Edit | `Ctrl+Alt+,` |  |
| Animation Mode | Edit | `Ctrl+Shift+N` | An optional add-on |
| Toggle Pages Panel | View | `Ctrl+B` |  |
| Toggle Layers Panel | View | `Ctrl+L` |  |
| Toggle Properties Panel | View | `Ctrl+P` |  |
| Quick Settings | View | `Ctrl+,` |  |
| Toggle Developer Tools | View | `Ctrl+Shift+I` |  |
| Fit All in View | View | `Ctrl+0` |  |
| Zoom In | View | `Ctrl++` |  |
| Zoom Out | View | `Ctrl+-` |  |
| Toggle Full Screen | View | `F11` |  |
| Vector Path | Transform | `P` | Click = corner, drag = smooth Bezier point |
| Transform Box | Transform | `Ctrl+T` | Again, or `Esc`, to put it away |
| Move | Transform | `Enter` | By an exact x and y, in any unit |
| Rotate | Transform | `Ctrl+R` |  |
| Join | Transform | `Ctrl+J` |  |
| Mirror | Transform | `O` | Horizontally or vertically, in place or as a copy |
| Sharpen All | Transform > Sharpen | `H` |  |
| Liquify | Transform | `Shift+R` | Bend the marks under a brush - Warp, Twirl, Pucker or Bloat; press for the four |
| Brush | Sketch | `B` | Pressure-aware variable width |
| Marker | Sketch | `M` |  |
| Eraser | Sketch | `E` | Cuts the selection, or every mark it touches, out of the drawing |
| Shape Eraser | Sketch | `Shift+E` | Drag a shape to cut it out of the selected marks; press for the shapes |
| Shape Stacker | Sketch | `Shift+M` | Drag across the pieces of the selected shapes to merge them, Alt to take them away; press for the Wipe Stacks |
| Split | Sketch | `J` | Click a path to cut it where you click, as scissors do; a closed one opens there |
| Text | Sketch | `T` | Click = auto-sizing box, drag = fixed width with wrap |
| Copic marker | Sketch | `K` | Flat broad nib, rotatable |
| Pencil | Sketch | `N` | Graphite and charcoal by hardness, through the paper's grain; press for the drawing kit |
| Smear | Sketch | `Shift+N` | A blending stump: drag over pencil marks to spread their graphite; Quick Width sizes it, Quick Opacity sets its strength |
| Direct Select | Sketch | `A` | White arrow; drags anchor points |
| Fill in Front | Sketch | `X` | The colors paint the fill, not the stroke; again for the stroke |
| Swap Fill and Stroke | Sketch | `Shift+X` | The tool's ink and fill, or the selected shapes' fill and outline |
| Group Layer | Layers | `Ctrl+G` | Groups the selected layers |
| Ungroup Layer | Layers | `Ctrl+Shift+G` |  |
| Rename Layer | Layers | `F2` | Or double-click the layer row |
| Layer Up | Layers > Move Layer | `Ctrl+]` |  |
| Layer Down | Layers > Move Layer | `Ctrl+[` |  |
| Make Clipping Mask | Layers > Clipping Mask | `Ctrl+7` | Groups the selection; it shows only inside the closed path on top |
| Release Clipping Mask | Layers > Clipping Mask | `Ctrl+Alt+7` | Takes the clip off; the group stays a group |
| Previous Page | Pages | `PageUp` |  |
| Next Page | Pages | `PageDown` |  |
| Select | Not in a menu | `S` | Black arrow; active at launch |
| Rectangle | Not in a menu | `R` | Hold `Shift` for a square |
| Ellipse | Not in a menu | `L` | Hold `Shift` for a circle |
| Curve | Not in a menu | `V` | Click and hold the button for the free-ends variant |
| Paint Bucket | Not in a menu | `G` | Fills the enclosed shape under the click |
| Eyedropper | Not in a menu | `I` | Hold `Ctrl` to pick a shape instead |
| Show Selection Borders | Not in a menu | `Ctrl+H` |  |
| Quick Width | Not in a menu | `W` | Then type a number |
| Quick Opacity | Not in a menu | `Q` | Then type a number |
| Quick Zoom | Not in a menu | `Z` | Then a digit: `9` is 90%, `0` is 100% |
| Next Color | Not in a menu | `C` | Steps through the Quick Access colors |
| Previous Color | Not in a menu | `Shift+C` | Steps back through them |
<!-- shortcuts:end -->

## Changing a shortcut

**Edit > Edit Keyboard Shortcuts** lists every tool, toolbar-only ones
too, as Tool, Type and Keyboard Shortcut. Type in the search box to keep
the rows whose name, type or shortcut contains what you typed, or pick a
type with the radio buttons. A tool's tooltip says where it is in the menus.

Click a tool's shortcut box and press the keys you want. The box turns
green for a shortcut no tool has, and amber for one another tool has,
which Accept takes from that tool; that row turns amber too, saying it will
be left with none. Some keys are refused in the box, with the reason:
Space, Escape and Tab, which the app keeps for itself; Enter, which only
Move can have; and the keys of the rows Electron draws, such as Toggle Full
Screen's `F11`, whose own boxes are greyed. Escape in a box puts back what it held
and leaves it, and the button beside a box takes its shortcut away.

**Accept** saves your changes, and the menus, the tooltips and the keys
follow at once. The app's own shortcuts stay in
`src/core/menu/shortcuts.json`, which is never written. Yours go in a
`shortcuts.json` of your own, in the app's settings folder, and it holds
only the shortcuts that differ from the app's. The folder is
`%APPDATA%\napkin-sketch` on Windows,
`~/Library/Application Support/napkin-sketch` on macOS, and
`~/.config/napkin-sketch` on Linux. **Reset to defaults** puts the app's
own shortcuts back in the table, and accepting them removes your file. A
file of yours that cannot be read is ignored, and the app says so when it
opens.

## Moving a tool to another menu

Every tool has a *type*, such as `Draw:Modify:element` for Rotate, and a
tool is listed in every menu that takes its type. **Edit > Edit Tool
Types** lists every tool with its type in a drop-down: a group for each
main type holding the types the menus take, and **Not in a menu** first.
Choosing a type changes only which menus list the tool, never what the
tool does or its shortcut, which is shown greyed beside it.

The drop-down says where a choice would list the tool before anything is
kept, such as "Rotate will be listed in Edit, Layers panel, Canvas", and
turns green. Taking a tool out of every menu turns it amber and names the
key that still runs it. A toolbar tool starts in no menu and can be put
in one. Some rows cannot move, and their drop-downs are greyed with the
reason as the tooltip: the two editors, which stay in the Edit menu where
they can always be found; a menu's own rows, such as Undo or the Help
rows; the rows Electron draws; a submenu's rows, which move with it; and
the tools kept on the keyboard, such as Quick Width.

**Accept** saves your changes, and every menu is made again from them at
once. The app's own types stay in `src/core/menu/tool-types.json`, which
is never written. Yours go in a `tool-types.json` of your own, beside
your `shortcuts.json`, holding only the tools you moved. **Reset to
defaults** puts the app's own types back in the table, and accepting them
removes your file.

## The Help menu

**Help > Verbose** opens this documentation in a window of its own, at
[Using the app](index.md). The pages are the app's own copy of this site,
so they open with no network. **Help > Tool Types** opens a quickstart in
the same window: [Transform](../quickstart/transform.md),
[Draw](../quickstart/draw.md), [Pages](../quickstart/pages.md),
[Layers](../quickstart/layers.md) or [Automate](../quickstart/automate.md),
which leads on to [Animation Mode](animation-mode.md), its assemblies and
its frame names.

In the documentation window, a link to another page opens it there and a
link to the web opens in your browser. `Alt + Left` and `Alt + Right` go back
and forward (`Cmd + [` and `Cmd + ]` on macOS), as a mouse's back and
forward buttons do on Windows and Linux, and `Ctrl + W` (`Cmd + W`) closes
the window.
Choosing another Help row shows its page in the window already open.

**Help > Source Code** opens the project's page in your browser. **Help >
Source Docs** opens the published site there, and is left out of the menu
until the site's deployment has been checked.

A copy of the app built from the repository reads the pages from its
`docs/` folder, which `npm run site` writes; a Help row says so when they
are missing.
