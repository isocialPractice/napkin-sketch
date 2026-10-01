# Gestures and input

## At a glance

- **Touchscreen + mouse + stylus** input via Pointer Events (with coalesced
  sampling for smooth, high-frequency capture).
- **Pan and zoom** with a two-finger gesture (pan within a small threshold, zoom
  beyond it), the **mouse wheel** (`Alt` + wheel zooms, plain wheel pans,
  `Ctrl+Shift` + wheel pans across - all directions configurable), or
  **`Space` and a drag with any tool**: holding `Space` gives the hand.
  **View > Zoom In** and **Zoom Out** (`Ctrl++`, `Ctrl+-`) zoom the canvas
  about its middle. The canvas zooms out to 20% and in until one page pixel
  spans its shorter side; see [How far the canvas zooms](#how-far-the-canvas-zooms).
- **The selection tool on `Ctrl`** - holding `Ctrl` with a drawing tool gives
  Select or Direct Select, whichever was chosen last, until `Ctrl` comes up.
  A chord such as `Ctrl+Z` leaves the drawing tool in hand.
- **Straight line** - press, then hold `Space`: the stroke becomes a clean
  line from where it began to the pointer, and its end snaps to a stroke's
  end in reach. `Shift` holds it to the nearest of eight directions -
  level, plumb or 45° - until released.
- **Shift-click line** - click or draw with the Brush, Marker or Copic, then
  hold `Shift` and click: a straight line joins the two at once, in the same
  mark, and each Shift-click after it adds another; see
  [Shift-click line](#shift-click-line).
- **Quick curve** - press, then hold `Ctrl + Space` to sweep a quarter ellipse
  with the drawing tool in hand, or add `Alt` for a quarter circle; the arc
  follows the drag and the release places its far end, which snaps to a
  stroke's end in reach. `Alt` can be pressed or let go mid-drag to switch
  between the two, and each `Shift` tap swings the arc's apex a further 90°
  clockwise while both ends stay put.
- **Quick features** — press `W` then a number for stroke width, `Q` then a
  number for opacity, `Z` then a digit to zoom (`9` = 90%, `0` = 100%), or
  `C` / `Shift + C` to cycle the **Quick Access Colors** through whichever of
  fill and stroke is in front - `X` puts the other one in front, and
  `Shift + X` swaps them.
- **Endpoint snap** — hold `Shift` while drawing to snap the stroke's start and
  end to the nearest endpoint of an existing stroke (a ring marks the target).
  Works for freehand and curve drawing; the straight line's end and the quick
  curve's far end snap without `Shift`, which is their angle lock and apex
  key. The snap sensitivity (1–20px, default 10px) and an on/off switch live
  in the settings. The optional **Join stroke** setting (off by default)
  merges a snapped stroke with the stroke it touches into one continuous
  stroke.
- **CapsLock cursor** — crosshair while CapsLock is on; a circle matching the
  current stroke width when off. The eraser carries a dashed circle the size of
  the area it will clear.

## Held keys and gestures

| Action                   | How                                       |
| :----------------------- | :---------------------------------------- |
| Rotate Copic nib         | Hold `Ctrl` still 1s, then `Alt` / `Shift` |
| Zoom (mouse)             | Hold `Alt` and scroll the wheel           |
| Zoom In / Zoom Out       | `Ctrl++` / `Ctrl+-`, or the View menu     |
| Pan (mouse)              | Scroll to pan; `Ctrl+Shift` + scroll pans across |
| Pan (any tool)           | Hold `Space` and drag                     |
| Select with a drawing tool | Hold `Ctrl` (Select or Direct, whichever was last) |
| Straight line            | Press, then hold `Space`                  |
| Lock a line to 45°       | `Shift` while dragging (release to free)  |
| Shift-click line         | Click or draw, then `Shift` + click       |
| Quick curve (ellipse)    | Press, then hold `Ctrl + Space`           |
| Quick curve (circle)     | Press, then hold `Ctrl + Space + Alt`     |
| Open the menu bar        | `Alt` alone, after 5 s with no other key  |
| Swing a quick curve apex | `Shift` (90° clockwise per press)         |
| Endpoint snap            | Hold `Shift` while drawing                |
| Edit a vector path       | Vector Path tool, click a committed path  |
| Hold a vector point to 45° | Hold `Shift` while placing it or pulling its handle |
| Close a vector path      | Click the first point where the close indicator shows |
| Move point / round corner| `Ctrl` (drag point, handle, or target)    |
| Toggle anchor handles    | `Alt` + click the anchor                  |
| Step a Move field        | Arrow keys; hold `Shift` for a coarse step |
| Keep the shape           | Hold `Shift` while dragging a handle      |
| Scale from the centre    | Hold `Alt` while dragging a handle        |
| Turn by hand             | Drag on the canvas while Rotate is open   |
| Dock / undock a panel    | The button in the panel's title bar       |
| Move the rotation centre | Click the canvas, drag the crosshair, the grid, or Centre x / y |
| Snap a rotation to 15°   | Hold `Shift` while dragging, or the Snap toggle |
| Close shape              | Close Shape button, then Sharp or Smooth  |
| Drag-copy selection      | Hold `Alt` and drag the selection         |
| Add / remove a layer row | `Ctrl/Cmd` + click the row                |
| Select a run of layers   | `Shift` + click the far row               |

## How far the canvas zooms

*Changed in 1.0.0-alpha.4.6.0: the canvas stopped at 800%, and View > Zoom
In and Zoom Out zoomed the whole window - the panels and the toolbar with the
drawing - rather than the canvas.*

- **From 20% in to one page pixel across the canvas's shorter side.** On a
  canvas 900 pixels tall, that is 90,000%: deep enough to set a single page
  pixel against its neighbours. A canvas too small for that still goes to
  800%, as it always did, and a window made smaller zooms out, about the
  canvas's middle, to whatever its canvas can show.
- **`Alt` + wheel** zooms 10% a notch toward the pointer. A trackpad zooms by
  as much of a notch as it scrolls, and a fast wheel that sends several
  notches at once zooms that much further.
- **View > Zoom In** and **Zoom Out** (`Ctrl++` and `Ctrl+-`) zoom the canvas
  by a quarter about its middle and say where the zoom now stands. **Fit All
  in View** (`Ctrl+0`) brings every graphic back into view.
- **What stays the same at any zoom.** Anything meant as a distance on the
  screen is one: a brush stroke keeps a sample every three quarters of a screen
  pixel, so a stroke drawn deep in keeps its shape; a click, a drag, a rubber
  band or a text box needs as few screen pixels as it does at 100%; and a
  selection's dashed box stands 6 screen pixels off its mark, drawn thin.
- **Images show their pixels.** Once one of an image's pixels covers 4 screen
  pixels, the image is drawn with its pixels crisp, as an image editor draws
  it, rather than smoothed into a blur.
- **Effects stay right at the view's edges, and cost nothing out of view.** A
  layer or a mark with a blur or a shadow is painted past the view by as far
  as the effect reaches, so the blur at the edge of the canvas gathers what
  lies just beyond it. Deep in, where a blur is wider than the view, the
  margin stops at half the view's diagonal and the blur is held to a third of
  that; inside a blurred shape it looks the same. A layer with effects is not
  painted at all when nothing it holds reaches the view.
- **A known limit.** A curve is drawn from points sampled along it, so at the
  deepest zooms the straight runs between them show.

## Space and Ctrl before a press

*Changed in 1.0.0-alpha.4.6.0: `Space` and `Ctrl` pressed before the press
used to make the straight line and the quick curve. Those are now pressed
after it, below, and before a press the two keys do what they do in most
drawing programs.*

**The hand:** hold `Space` with any tool and the pointer becomes a hand; a
drag pans the canvas, and letting `Space` go gives the tool back. It works
over a Transform box or with the Rotate dialog open, and a Vector Path being
placed waits for its next point.

**The selection tool:** hold `Ctrl` with a drawing tool - Brush, Marker, Copic,
Eraser, Text, Rectangle, Ellipse, Curve, Paint Bucket, Fill Color or the
Eyedropper - and it becomes Select or Direct Select, whichever was chosen
last, for as long as `Ctrl` is down. It comes up as soon as the pointer moves
or presses, or after a fifth of a second; a chord typed faster than that, such
as `Ctrl+Z` or `Ctrl+S`, runs with the drawing tool still in hand. A drag
begun with the selection tool finishes with it even if `Ctrl` comes up
first. Vector Path and Mesh Warp keep their own `Ctrl`: the path's anchors,
and the mesh's pins.

**The Copic nib:** hold `Ctrl` **still** for the hold time (1 s by default)
and the Copic comes up instead, at twice the width, its nib turned by `Alt`
and `Shift` for as long as `Ctrl` stays down. Moving the pointer, pressing or
typing another key during the hold cancels it, so aiming the selection tool
never turns the nib. The hold time, the keys and the switch are in the Verbose
Settings window.

## Straight line

*Changed in 1.0.0-alpha.4.6.0: `Shift` locked the line to level or plumb
only, and the line's end never snapped.*

**Straight line:** press with a freehand tool - Brush, Marker, Copic or Eraser -
then hold `Space`: the stroke becomes a clean two-point line from where it
began to the pointer, and what was drawn freehand before is dropped. The end
follows the pointer until the release, and **snaps to a stroke's end** within
the snap sensitivity, a ring marking it, as a freehand stroke's end does -
though never back onto the line's own start. Hold `Shift` during the drag to
hold the line to the **nearest of eight directions** - level, plumb, or a 45°
diagonal - with its end where the pointer falls along it, and release `Shift`
to free it again; the lock follows the key live, so you can toggle it as often
as you like mid-drag, and it engages without waiting for the pointer to move.
Once straight, the line stays straight until the release, whether `Space` is
held or not.

## Shift-click line

*New in 1.0.0-alpha.4.6.0.*

**Shift-click line:** click or draw with the Brush, Marker or Copic - that
leaves **point 1**, the end of what you drew - then hold `Shift` and click:
the click is **point 2**, and a straight line from point 1 to it appears at
once. The line is part of the mark you drew, not a mark of its own, so at
under 100% opacity nothing darkens where the two meet, and each Shift-click
after it adds another line from the last: a polyline, one undo per line. A
Shift-press that goes on as a drag draws on freehand from point 2, in the same
mark; hold `Space` during it for a straight line on from point 2, or
`Ctrl + Space` for a quick curve.

- **Point 2 snaps** to a stroke's end in reach, as a Shift press's start
  always has, so a Shift-click near the polyline's first point closes it.
- **A mark of its own** - the line starts a new mark at point 1 instead when
  the mark is not painted as the tool paints now: another colour, width,
  opacity or Stroke Profile, or a fill or a dash the properties panel gave
  it - or when it is on another layer than the one in use, is closed, or
  symmetry copies are being made.
- **Point 1 is forgotten** on a page turn, an undo or redo, a tool other than
  the Brush, Marker or Copic taken in hand (`Ctrl`'s loan of the selection tool
  gives it back), and when the mark is moved or deleted. A Shift press with
  no point 1 snaps its start, as it always has.

## Quick curve

**Quick curve:** press with a freehand tool, then hold `Ctrl + Space` - or
`Space` first and `Ctrl` after - to sweep a **quarter ellipse** from where the
press began: one gesture, no bend step. The arc leaves the point you pressed
at flat and arrives at the pointer turning straight up, bowing through the
corner of the drag, and it reshapes live as you move; **releasing places the
far end**, which snaps to a stroke's end in reach unless `Shift` is held.
Hold `Alt` for a **quarter circle** instead: the shorter side of the drag sets the radius, the same way
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

## Endpoint snap

**Endpoint snap:** hold `Shift` while drawing with the brush, marker, or Copic
marker and the stroke snaps to the nearest **endpoint** of an existing stroke —
the start point snaps on pen-down and the end point on pen-up (the Curve
tool's chord snaps both ends live). The straight line and the quick curve
keep the **start** the press snapped to, and their end snaps **without**
`Shift`, because mid-drag `Shift` is the angle lock for one and the apex
key for the other; with a point 1 to draw from, a Shift press is a
[Shift-click line](#shift-click-line) instead. A small ring shows the
endpoint you will snap to whenever one is within the **snap sensitivity** (a
screen-pixel radius, so zooming in gives finer control). The sensitivity
(1–20px, default 10px) and the feature's on/off switch live under **Quick
Features** in the Verbose Settings window, alongside **Join stroke** (off by
default): when on, a snapped stroke merges with the stroke it touched (same
tool and color) into one continuous stroke.

## When something interrupts a press

A press on the canvas always ends, and ends in one of two ways.

- **`Esc` cancels** a quick curve or a Curve tool chord still being dragged:
  nothing is added, and the next press draws as usual.
- **Losing the window** ends the press where it stands - switching to
  another program, a dialog from another program taking the focus,
  `Ctrl + Shift + Esc` opening the Task Manager, or the window being
  minimised. A stroke keeps what was drawn, a line or a shape is placed as
  far as it went, and a drag stays where it was put. A curve is dropped, as
  `Esc` would drop it, since it is a preview until its release. The keys held
  when the window went are let go too (`Space`, `Ctrl`, `Alt`), because
  their release goes to the other window.
- **A tool chosen mid-press** takes over once the press is released: a
  shortcut key pressed during a drag, or `Ctrl` let go during a drag begun
  with the selection tool it lent. The drag finishes with the tool it began
  with.

## Alt and the menu bar

On Windows a bare `Alt`, pressed and let go, hands the keyboard to the menu
bar. Drawing uses `Alt` a great deal, so the menu bar only gets a bare `Alt`
when it was meant for it: when no other key was pressed in the **5 seconds**
before it, and nothing was done with `Alt` while it was held - no scroll, no
drag, no press. `Alt` + scroll, `Alt` + drag, or `Alt` a moment after other
keys leaves the keyboard with the drawing. `Alt` with a menu's underlined
letter (`Alt+F` for File) still opens that menu at once.

## CapsLock cursor

**CapsLock cursor:** while any drawing tool is active, **CapsLock on** shows a
precision crosshair; **CapsLock off** shows a circle preview matching the
current stroke width. The **eraser** shows a dashed circle the size of its
footprint, so the area about to be cleared is visible before pressing.
