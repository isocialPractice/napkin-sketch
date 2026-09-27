# Gestures and input

## At a glance

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
- **CapsLock cursor** — crosshair while CapsLock is on; a circle matching the
  current stroke width when off. The eraser carries a dashed circle the size of
  the area it will clear.

## Held keys and gestures

| Action                   | How                                       |
| :----------------------- | :---------------------------------------- |
| Rotate Copic nib         | Hold `Ctrl` 1s, then `Alt` / `Shift`      |
| Zoom (mouse)             | Hold `Alt` and scroll the wheel           |
| Pan (mouse)              | Scroll to pan; `Ctrl+Shift` + scroll pans across |
| Pan (Select / Direct)    | Hold `Space` and drag                     |
| Straight line            | Hold `Space` and drag                     |
| Lock line to 90°         | `Shift` while dragging (release to free)  |
| Quick curve (ellipse)    | Hold `Ctrl + Space` and drag              |
| Quick curve (circle)     | Hold `Ctrl + Space + Alt` and drag        |
| Swing a quick curve apex | `Shift` (90° clockwise per press)         |
| Endpoint snap            | Hold `Shift` while drawing                |
| Edit a vector path       | Vector Path tool, click a committed path  |
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

## Straight line

**Straight line:** hold `Space` and drag with any drawing tool for a clean
two-point line. Hold `Shift` during the drag to lock the line **strictly
horizontal or vertical** — whichever axis the drag favours — and release
`Shift` to free it again; the lock follows the key live, so you can toggle it
as often as you like mid-drag, and it engages without waiting for the pointer
to move.

## Quick curve

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

## Endpoint snap

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

## CapsLock cursor

**CapsLock cursor:** while any drawing tool is active, **CapsLock on** shows a
precision crosshair; **CapsLock off** shows a circle preview matching the
current stroke width. The **eraser** shows a dashed circle the size of its
footprint, so the area about to be cleared is visible before pressing.
