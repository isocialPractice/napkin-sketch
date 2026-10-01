# Vector paths and stroke profiles

## At a glance

- **Stroke Profiles** - the **Stroke Profile** control above the Width slider
  sets how the width runs along new brush and marker strokes: **Default**,
  **Rounded**, **Tapered** or **Wave**. With the Select tool it reshapes the
  selection too, and the Properties panel's **Profile** select sets one
  element's. A profiled stroke exports to SVG and PDF as the shape it is and
  comes back into napkin as the stroke it was.

## Editing a vector path

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
- **Cutting a path** is [Split](tools.md#split)'s (`J`): a click cuts it where
  it lands - on an anchor, or between two, by de Casteljau, so the pieces
  trace the curve exactly - and a closed path opens there first. **Join**
  (`Ctrl+J`) puts two open ends back together.

## Direct Select

**Direct Select tool (`A`):** shows the **white arrow** pointer — the
selection / direct-selection pairing of vector editors. *Click* an element
to show its **anchor points**, then *drag* an anchor to reshape the path. A
stroke drawn by the Vector Path, Curve, or quick-curve tools shows **just
its few Bézier anchors** (a quick curve is two), and the selected anchor's
**curvature handles** — drag a handle to bend the curve, with the opposite
handle staying collinear so the bend is smooth. A freehand stroke drawn since
1.0.0-alpha.4.6.0 is fitted with a few Bézier anchors when it is lifted (see
[Tools](tools.md)), so it shows those and edits like a curve; the Vector
Path tool can edit it too. Older freehand strokes, two-point lines and shapes
show their sampled points as before. Hold `Space` and drag
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
blue, and `Esc` drops the edit (`Ctrl+Z` restores the shape).

- **The grab reach is the Direct Select sensitivity**, in screen pixels:
  8 unless changed in Verbose Settings > Sketch Support (1 to 20). It reaches
  every anchor, handle and path, the first click that picks a stroke
  included, and the Vector Path tool's anchors and closing click. It used to
  be held to at least 8 on a path with Bezier anchors, so the slider did
  nothing below 8 there. A setting of 3 saved before 1.0.0-alpha.4.6.0, the
  old default, reads as 8.
- **A path is as wide as it is painted**, so a thick stroke is grabbed by its
  edge as well as its middle. A click inside a filled shape, with nothing
  painted over it, takes the whole path.
- **A click is not an edit.** Nothing moves, and no undo step is added, until
  the pointer has travelled 4 screen pixels, as with the Select tool. A click
  that picks an anchor leaves the drawing alone.
- **A closed shape's seam moves as one corner.** A rectangle's first and last
  points sit on the same corner; a drag there carries both, so the shape stays
  shut.
- **Shift pins every drag** to the nearest axis or 45-degree diagonal: raw
  points and tangent handles as well as a vector path's anchors.

## Sharpen Selection

**Sharpen Selection** (toolbar button): smooths and simplifies the selected
strokes, like a vector editor's simplify command. A small dialog opens in the
corner with **Smooth** and **Simplify** sliders and the strokes preview the
result live on the canvas as the sliders move; **Apply** keeps the new shape
(one undo step returns the originals) and **Cancel** or `Esc` restores them
untouched. Distinct from **Sharpen all** (`H`), which runs the hand-drawn
auto-sharpen engine over every stroke.

## Stroke Profiles

**Stroke Profile (the control above the Width slider, or Sketch > Stroke
Profile):** sets how a stroke's
width runs along its length, as a width profile does in Illustrator. The
control shows a picture of the current profile, and clicking it opens the
**Stroke Profile** picker beneath it.

- **Default** is the constant width every stroke has always had. **Rounded**
  swells from a point to full width halfway along and back to a point.
  **Tapered** starts at full width with a round end and narrows to 0.3 of it.
  **Wave** is a band that snakes about the path as it swells, so its two sides
  differ. The three were measured from the design drawings rather than
  described by eye, and every picture of one - in the control and in the
  picker - is drawn by the code that draws the canvas.
- **Select**, a double-click or `Enter` makes the highlighted profile the one
  new brush and marker strokes are drawn with. Like the width, it is tool state:
  it lasts while the app runs and is not saved as a setting. With the Select
  tool and a selection, the selected strokes take it too, as one undo step.
  The arrow keys, `Home` and `End` move through the list; **Cancel**,
  `Escape` or a press beside the picker closes it.
- The **Properties** panel's **Profile** select, under Stroke, changes the
  selected elements alone and leaves the tool's profile as it was.
- Brush and marker marks take a profile, and so does everything that commits as
  a brush stroke: Rectangle, Ellipse, Curve, straight lines and Vector Path. A
  Copic stroke's nib is its own width, and the eraser always cuts at full
  width.
- A profile runs once along each subpath from where it starts, so a closed
  shape is thin (Rounded) or full (Tapered) at the seam where its path begins.
  A dashed or dotted profiled stroke keeps the width the whole stroke has
  where each dash falls: a dashed Rounded line has thin dashes at its ends and
  fat ones in the middle. The pen's pressure still scales the width underneath
  the profile.
- **Export.** SVG has no variable-width stroke, so a profiled stroke is written
  as the filled shape it is: the boundary of exactly what the canvas paints,
  however tightly the path bends back on itself. The stroke rides along as
  data (`data-profile`, with its centreline in `data-d`, and
  `data-profile-mirrored` on a mirrored Wave), so another editor
  sees the shape and napkin reads back the stroke, editable, with its profile.
  A profiled shape with a fill is a group of two paths, its fill and then its
  outline. PDF export fills the same outline.
