# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.3.0-alpha] - 2026-09-23

Three features - Mirror Selection, Stroke Profiles and Mesh Warp - make this a
minor release. It also carries the fixes that were to have been the 4.2.3-alpha
patch, which never shipped on its own.

### Added

- **Mirror Selection: reflect the selection, in place or as a copy beside it.**
  A **Mirror** button after **Clear**, **Edit > Mirror…** and `O` open a
  palette with the two orientations the mockup draws: **Horizontal** swaps left
  and right, **Vertical** swaps top and bottom, and both together make a half
  turn. Below them are **Create Copy**, **Live preview** and **Show Selection
  Borders**.
  - A copy is reflected about the selection's trailing edge, so it lands beside
    the original as its mirror image and the two meet there: half of something
    symmetric, mirrored, is the whole of it. Without a copy the selection flips
    where it stands.
  - The reflection is exact on vector geometry. A reflection is affine, so
    mapping a curve's anchors and both of their handles maps the curve itself:
    nothing is resampled, and a curve keeps its control points. A Copic nib and
    a linear gradient's direction turn with the drawing. Text stays readable,
    its box moving to where its mirror image would be, and a placed image's
    pixels are flipped. The rules live in one pure function, `mirrorStroke`,
    with a test for each kind of element.
  - `npm run gui-check -- mirror` checks it in the running app. A triangle that
    points right points left afterwards, with its box unmoved. A mirrored copy
    doubles the ink one box-width further right. One `Ctrl+Z` undoes either,
    and a cancelled preview leaves Redo exactly as it was.
- **An edit transaction in the store.** Mirror's live preview can add a copy,
  which the Move and Rotate previews cannot express: they are reversible deltas,
  applied and then taken back. `beginTransaction` snapshots the page, and
  everything the preview does runs without history. `commitTransaction` makes it
  one undo step, or none at all if the page came back unchanged.
  `rollbackTransaction` puts the page, the selection and the saved state back.
  An edit that keeps history, an undo or redo, or a page change settles an open
  transaction by keeping it, since it is what the page shows, and then tells its
  owner. So dragging a previewed copy moves the copy, and the palette steps
  aside.
- **Stroke Profiles: how a stroke's width runs along its length.** A **Stroke
  Profile** control above the Width slider shows a picture of the current
  profile and opens a picker of four. **Default** is the constant width every
  stroke already had. **Rounded** is pointed at both ends and full in the
  middle. **Tapered** is full at a round start and narrows to 0.3. **Wave** is a
  band that snakes about the path as it swells. **Select** sets the profile new
  pen and marker strokes take, and with the Select tool it reshapes the
  selection too, as one undo step. The Properties panel's **Profile** select
  sets one element's alone.
  - The profiles were measured from the design drawings, each shape's thickness
    read column by column at 4x, rather than described by eye. Rounded is sin(πt)
    to within 3%, and Tapered is 1 - 0.7·t^1.6 to within 0.04. Wave is a table
    for each side, joined by monotone cubics that never overshoot a measurement
    or dip below zero.
  - Pen and marker marks take a profile, and so does everything that commits as
    a pen stroke. A ruled line has only its two ends to read a profile at, both
    of zero width for Rounded, so a long run is cut into steps first. Dashes
    keep the width the stroke has where they fall, and the pen's pressure still
    scales the width underneath the profile. Mirror reflects a profiled stroke
    exactly: Wave, the one profile that leans, swaps its sides
    (`profileMirrored`) so its mirror image leans the mirrored way.
  - Neither the canvas nor SVG has a variable-width stroke, so both draw the
    shape. The canvas fills a union of convex pieces with one non-zero fill.
    The exporter writes that union's boundary: it traces a chain whose winding
    about every point is the number of pieces covering it, then keeps only the
    edges with fill on one side and none on the other. So the two agree exactly
    however tightly a path bends, and a test rasterizes both on twelve shapes -
    from a hairpin tighter than the stroke to a ring smaller than it - holding
    them to 99.9% of the same pixels. The stroke rides along as data
    (`data-profile`, the centreline in `data-d`), so napkin reads back the
    stroke rather than its outline. A profiled shape with a fill exports as a
    group of the fill and its outline, and PDF export fills the same outline.
  - `npm run gui-check -- profile` checks it in the running app. A Rounded line
    is under half as thick a tenth of the way along as in its middle, and one
    `Ctrl+Z` undoes it. The Properties select tapers a stroke without changing
    the tool, and `End` then `Enter` picks Wave for the next stroke. A fixture
    the exporter wrote imports with every profile, fill and dash intact.
- **Mesh Warp: bend art by pins, as Illustrator's Puppet Warp does.** A **Mesh
  Warp** tool sits below the others in the side rail, set off by a heavy rule.
  Hovering outlines in green the art a click would pick, with "(click to select
  art)" beside the pointer. A click meshes it and puts two pins along its long
  axis. Click the mesh to add a pin, drag pins to bend the art, and press
  `Delete` to take pins out. `Enter` keeps the warp as one undo step, and
  `Escape` throws it away.
  - The mesh comes from what the art paints. Its silhouette, grown by 3 px, is
    traced by marching squares, filled with a hexagonal lattice and triangulated
    (Bowyer-Watson Delaunay). Any triangle that strays across a notch or a hole
    is dropped, and so is any sliver Delaunay lays along the hull between two
    pieces. The mesh has about a thousand vertices whatever the art's size.
    **Show mesh** in Quick Settings hides it.
  - The bend is As-Rigid-As-Possible shape manipulation (Igarashi, Moscovich and
    Hughes, 2005). Its two matrices are factored once when the pins change, so a
    drag frame is a few triangular solves: about a millisecond at a thousand
    vertices, and about 4 ms a frame on a figure's leg assembly with the art
    carried along. A piece with one pin follows it rigidly, and a piece with none
    stays put.
  - The art keeps its structure. A Vector Path's anchors and handles move, and a
    curve is split only where it would otherwise stray more than a fifth of a
    pixel from the bend. A warp nobody pulled gives back the very anchors it was
    handed. Text and images move unbent, a Copic nib turns with the art, and no
    width stretches.
  - `npm run gui-check -- mesh-warp` checks it with real pointer events on a
    bar. Hovering outlines it, a click meshes it with two pins, and dragging the
    right pin 80 px down drops the right half while the left holds. `Escape`
    restores the bar exactly, `Ctrl+Z` inside a warp steps back, `Delete` takes a
    pin rather than the bar, and a kept warp is one `Ctrl+Z` from where it
    began.
- **`npm run gui-check`: scripted checks against the running app.** The first
  two defects fixed in this release could only be seen in the running app, one
  because the importer needs a DOM and the other because the color picker is a
  native popup. `test/gui/` now holds the DevTools-protocol driver that the
  4.1.0-alpha menu work proved out (`cdp.mjs`), a runner that launches the built
  app once per `check-*.mjs` (`run.mjs`), and seven checks: gradient import, the
  color picker and the Width slider reaching a selection, Mirror, Stroke
  Profiles drawn and imported, and Mesh Warp. The checks assert on what the
  page shows (canvas pixels, the toast, the layer rows) rather than on the code
  that produced it, and the first two were each run against the unfixed build
  and failed there. They drive `dist/`, so build first.
  `npm run gui-check -- gradient` narrows a run to the checks whose names match.

### Fixed

- **Gradient-painted artwork imported as an invisible ghost.** `importSvg`
  restored a gradient only from `data-gradient`, napkin's own export
  attribute, and a foreign `url(#...)` paint was dropped on purpose. A drawing
  whose base shapes were all gradient-filled therefore came back with correct
  geometry, a correct layer tree, and nothing painted - and since the shapes
  were all still there, nothing about it said why. Worse, `normalizeColor`
  passes through anything that is not `rgb(...)`, so the same paint was stored
  as the stroke's **colour** and written back out as
  `stroke="url(#skinLimb)"`: a reference to a definition the export does not
  carry.
  - The importer now reads the referenced `<linearGradient>` or
    `<radialGradient>` out of the document's defs, follows an `href` to
    another gradient's stops where one is used, derives a linear gradient's
    angle from its axis, and hands the result to `normalizeGradient`. What it
    does not carry is the paint server's own coordinate system, so a gradient
    lands as its stops along its own axis: approximate for the unusual cases
    and right for the rest.
  - A paint that still resolves to nothing falls back to a stop colour rather
    than to the `url(...)` string, so the worst case is a flat colour from the
    right ramp rather than a shape nobody can see. That holds for every way a
    paint server can fail to become a gradient, not only for an outline. A
    one-stop gradient paints its stop's flat colour, as SVG specifies. A
    reference to a gradient the document never defines, or to one with no
    stops, paints the fallback colour written after it (`url(#skin) #c48a5f`),
    or napkin's default ink when there is none: visibly wrong and one click
    from fixed, where a browser would paint nothing. A fallback written beside
    a gradient that does exist no longer hides that gradient; the reference
    used to be read only when it ended at its closing parenthesis.
  - `npm run gui-check` gained a check for it, against a fixture whose every
    shape is gradient-painted. This is the bug a unit test could not have
    caught: the importer needs a DOM, and the symptom is pixels. The check
    measures how much of the painted area's bounding box is filled rather than
    counting painted samples, because the ghost is not blank: it leaves thin
    outlines behind, and a raw count left it two samples short of passing.
    Filled, the fixture covers 80% of its box; the ghost covered 12%.
  - Anything an editor or a generator paints with gradients was affected. An
    AI redraw asked for modelled form reaches for gradients first, so this is
    what one looked like on arrival: a figure drawn correctly and then erased
    on the way in.
- **The custom color picker never reached the selection.** With the Select
  tool active and something selected, a swatch fills the selected closed shapes
  and recolors the selected open strokes. The color well beside the swatches
  only ever set the ink for the *next* mark, so a fill or stroke color picked
  there left the selection as it was. Because the pick recorded no history
  either, the next `Ctrl+Z` undid whatever came before it.
  - The well now takes the swatches' path. One `applyInkToSelection` serves
    both, so the two cannot drift apart again, and both report what they did in
    the same toast.
  - Chromium's picker fires an `input` for every color the pointer crosses and
    one `change` when it closes. The selection follows the drag live, and the
    whole drag is one undo step: `Store.fillSelected` takes the same `history`
    flag `setStrokeProps` already did. The toast waits for the color actually
    chosen.
  - `npm run gui-check` covers it: a closed shape and an open stroke, selected
    with `Ctrl+A`, taken through a three-color drag. Afterwards nothing on the
    page is left in the old ink, and one `Ctrl+Z` puts every sample back.
- **The Width slider never reached the selection either.** With the Select
  tool active and an element selected, moving the slider only set the width
  of the *next* mark. The selected element kept its own until another was
  drawn, so the only way to change it was the Properties panel.
  - The slider now takes the color well's path. With the Select tool and a
    selection, the selected outlines follow the slider as it is dragged, and
    the whole drag is one undo step: its first change opens the step, and
    `setStrokeProps` folds the rest into it. A width typed with Quick Width
    (`W`, then a number) reaches the selection the same way. Text and placed
    images have no outline to widen, so they are left as they are. With a
    drawing tool in hand, the slider is still only for the next mark, whatever
    is selected.
  - `npm run gui-check -- stroke-width` covers it on a 4 px line. The line is
    selected with `Ctrl+A` and dragged through 8, 14 and 20: it becomes five
    times as thick, one `Ctrl+Z` restores it, Quick Width `12` makes it three
    times, and with the Pen in hand the slider leaves it alone.
- **Undo and redo stitched the holes shut in compound shapes.** Every history
  snapshot copied a vector anchor as its point and two handles and left out
  `move`, the flag that starts a new subpath. The canvas draws the sampled
  points, which kept theirs, so nothing looked wrong until export. A square with
  a square hole exported as `M0 0H20V20H0V0ZM5 5H15V15H5V5Z` before a move and an
  undo, and as `M0 0H20V20H0L5 5H15V15H5L0 0Z` after, with the hole joined into
  the outline. A snapshot copies the whole page, so one undo did this to every
  letter with a counter, ring and outlined stroke on it. Placing several imports
  in a grid rebuilt anchors the same way, so those arrived already stripped.
  Both now keep the flag, and a snapshot now holds its own copy of a gradient
  rather than sharing the live one.
- **A stroke with subpath breaks but no Bézier anchors exported as one line.**
  The exporter's polyline branch wrote a `lineTo` for every point after the
  first, so a compound stroke that had lost its anchors came out with its
  contours joined, and its simplification ran straight across the break. Each
  run between breaks is now its own subpath, simplified on its own.

## [4.2.2-alpha] - 2026-09-13

### Added

- **Disable API: a posing choice for a drawing the rig does not fit.**
  Animation Mode measures the source figure's own geometry and hands the AI
  helper a finished angle per assembly. Measuring only reaches a layer whose
  name one of the six required assemblies answers to, and an illustrated
  character has more layers than that. On a real eleven-layer walk frame five
  of them - the skirt, the shirt, the glove and the two jacket halves - match
  nothing at all, so the measuring can never write them an angle and they come
  out of every frame frozen. Four layers moved and seven held still: the
  cardboard cut-out the skill has warned about since 4.1.4-alpha, arriving by
  way of the app rather than by way of the helper.
  - A **Posing** radio pair in the animation setup dialog: **Measure the
    joints**, which is the default and unchanged, or **Disable API**.
  - Disabled, the form carries no angles, says the silence was chosen rather
    than missing, names the layers no assembly can reach, and asks the helper
    to pose every layer from the drawing, the note and the skill's measured
    movement budgets.
  - The dialog counts the unreachable layers for the figure in front of you -
    "5 of 11 layers here match no assembly" - so the choice can be made before
    a sequence is drawn rather than after eight frames of it.
  - What the setting does not touch is the rule that a frame is posed and
    never redrawn. It changes where the angles come from, not what may carry
    them, and the form says so in both modes.
- **Every form carries its type's measured travel band.** Switching the
  measuring off used to leave the helper with no numbers at all, and it
  showed: a walk came back with the arms travelling 10.6% of the figure's
  height, past the 9.4% that is the widest any of the 70 drawn steps managed,
  and with barely any bob. The form now prints that type's own band -
  `legs 8.9 (3.2-26.2)   arms 4.8 (1.2-9.4)   bob 0.6 (0-1.9)` for a walk -
  for the six types the studies cover. Both modes get it, for opposite jobs:
  with the measuring off the numbers are the target, and with it on they are a
  check on angles already chosen, since a frame landing far outside what every
  drawn frame does went wrong in the editing rather than in the measuring. The
  measuring mode gets the short version, because that form is read before every
  frame of every sequence and every line of it is time spent before the first
  edit. A type the studies never measured gets no
  numbers rather than invented ones.
- **A looping type is told its bob has to change direction.** A band gives a
  size and bob has a sign, which is the one thing a band cannot carry: a walk
  that bobs 1.3, then 0.7, then 0.6 sits comfortably inside its band on every
  step and is still a figure sinking rather than one walking. Five of the six
  drawn walks change the sign of their bob somewhere in the cycle - BadGirl's
  own goes 0.6, then -1.3 - and a cycle that only ever drops cannot arrive back
  at the pose it started from. Types that run from a start to an end are not
  given the rule, because they have no pose to come back to.

- **A Transform tool, on `Ctrl+T`.** One box around everything selected, with a
  handle on each corner and the middle of each side, and a drag on any of them
  scales the selection. The model already knew how to do this — `scaleStrokes`
  maps points, Bézier anchors and both tangent handles, and carries a text
  item's size and an image's box with them — so what was missing was the box
  and the four rules that make a handle mean something:
  - **The handle decides which axes move**, and no modifier changes that: sides
    across, top and bottom down, corners both, each axis following the pointer
    on its own. The handle opposite the one in hand stays put, so a drag reads
    as pulling that edge of the box.
  - **`Shift` makes the two factors agree**, so the selection keeps its shape.
    On a corner the axis the pointer committed to wins; on a side, the one axis
    that handle can measure drives both — which is how a side handle scales the
    whole selection instead of stretching it.
  - **`Alt` moves the point the scale is measured from** to the centre of the
    box, so both sides travel together and the selection grows in place. It
    changes the anchor and nothing else: a corner under `Alt` alone still
    scales each axis independently.
  - **`Shift + Alt`** is both, and either can be pressed or released *during* a
    drag — every factor is measured from the box the gesture started on, so a
    modifier halfway through re-reads the whole drag rather than bending what
    is left of it.
  - The box stays up until `Ctrl+T` or `Escape`, a press off a handle still
    belongs to the tool underneath, a whole drag is one undo step, and a press
    that grabs a handle and lets go again costs nothing.
  - Dragging a handle through its anchor **stops at 1% instead of flipping**.
    A negative factor mirrors geometry correctly but `scaleStrokes` reads a
    font size and an image width as magnitudes, so a flip would mirror the
    shapes and destroy the text. Stopping is the honest failure until that is
    handled; it is on the TODO with skew, distort, perspective and puppet warp,
    which is the list this one box exists to grow into.
- **A click on the canvas puts the rotation centre anywhere.** The nine
  presets reach the corners and the middle of the selection's box, which is
  where a pivot usually goes and nowhere near where an interesting one does -
  a shoulder, a heel, a point off the shape entirely. Those needed the
  crosshair dragged or two numbers typed. A press that turns nothing already
  did nothing, so that is the gesture this takes: click to place the pivot,
  drag to turn about it, told apart by the same few pixels that separate a
  click from a drag everywhere else in the app. The presets are untouched.
- **The Rotate tool stays active once a rotation has been applied.** It is a
  workbench - an angle, a direction, a snap, a pivot that took placing - and
  dismissing it on the first answer threw all of that away with the answer, so
  every further turn cost a reopen and a re-place. Two things used to dismiss
  it: the **Apply** button, and letting go of a canvas drag when `Ctrl+R` had
  opened it. Neither does now. The code already half agreed about the first -
  `applyRotate` is documented as leaving the dialog open and Enter has always
  done exactly that; only the button disagreed. Which kind a tool panel is now
  lives in one place: `toolRemainsInView` for Rotate, `toolGoesOutOfView` for
  Move, which asks one question and goes once it is answered - so a third panel
  of either kind is a line rather than a fourth Apply handler with an opinion,
  and the flag that used to carry the `Ctrl+R` exception is gone.

### Fixed

- **Characters that walk left had their legs swinging backwards.** Every signed
  angle Animation Mode hands out - the cycle tables in `animation-cycles.ts`,
  the transforms built from them, and the copy of the walk table the
  `vector-animations` skill carries - was measured from the wireframe
  skeletons, and every one of those walks to the **right**. Nothing anywhere
  said so. Mirroring a figure negates every rotation in it, so the table
  applied as written to a left-facing character inverts the whole cycle, and
  the result is a defect that passes every check there is: the travel numbers
  land in range, arms and legs still oppose each other, no layer is frozen,
  and the figure moonwalks.

  Measured on a real case. BadGirl's generated walk turned her front leg
  +12.3° and her back leg -13.5° - `WALK_CYCLE[0]` copied verbatim, which is
  what the helper does with the skill's table when the measuring is off. The
  artist's own drawn BadGirl walk turns them **-17.7° and +16.8°**: the same
  cycle, every sign the other way. A hand-edited reference of the pose wanted
  came out at -40.1°/+33.1° - the same signs as the artist, the opposite of
  the app.
  - A **Facing** choice in the setup dialog, *Travels right* or *Travels left*,
    preselected from the figure's own feet. A foot sticks out in front of the
    ankle, which makes it the one part of a figure that cannot be read two
    ways; two feet pointing the same way are a profile, and two pointing
    opposite ways are a drawing with no facing at all. The note says which it
    found, so a preselection is visibly a reading rather than a finding.
  - *Travels left* mirrors the cycle - `mirrorPoseStep`, which negates every
    angle and leaves the bob alone, because that is exactly what mirroring
    art about a vertical axis does. Saying nothing still means right, so no
    existing sequence changes.
  - The premise is now written down where each set of numbers lives: the
    generated table says it (from the generator, so it survives a
    regeneration), the skill says it twice - once where the sign convention is
    introduced and once in the walk table itself - and the form says which way
    it read this figure in both modes. With the measuring off the form tells
    the helper to flip the signs itself, because there the helper is reading
    the skill's tables directly and is the only participant that can see the
    drawing.
- **A press inside a selection was losing the selection.** Hit-testing is
  forgiving on purpose: every mark is widened by a few screen pixels, or a
  thin line could not be clicked at all. That forgiveness outranked the
  selection, and a selection of several elements is usually several elements
  close together with other marks among them - so pressing in the middle of
  what you were about to drag landed "on" some unselected neighbour, replaced
  the whole selection with it, and dragged that one thing instead. The
  selection was lost most reliably in precisely the case the surrounding code
  was written to protect. The selection now keeps the press; the element under
  the pointer gets it back on release, if the pointer never moved, which is
  what a click on it always meant.
- **Shift and Ctrl in the layers panel were the wrong way round.** Shift-click
  toggled one row and range select was on Ctrl+Shift - a chord for the common
  gesture, and Shift doing the thing every other layer panel gives to Ctrl.
  Ctrl/Cmd now picks rows out one at a time and Shift takes the run between
  the last row selected and this one. The range is drawn on the rows the panel
  is showing rather than on the layer stack: the stack inlines every group's
  children, so a range across a collapsed group used to select forty rows
  behind three visible ones.
- **Anything imported unfolded the whole layers panel.** One illustrated
  figure is a group of assemblies, each a group of parts, each a group of
  outlines - sixty-odd rows arriving expanded, and two of them leave the panel
  showing nothing but itself with the page scrolled off the top. Whatever
  arrives is one thing to the person who imported it, so it now lands folded:
  a generated animation frame, an SVG opened from the menu or the CLI, one
  pasted from another editor, and a sheet of graphics placed together. Every
  group inside is folded too, so opening one shows its assemblies rather than
  spilling its whole tree, and the row left active is the one the import
  produced rather than the last leaf it happened to write - which was inside
  the fold, where the panel showed no active row at all. An import that is a
  flat run of layers with no group among them still fills the panel: there is
  nothing there to fold.
- **The form asked for 92 KB of reading before the first edit.** "Full contract
  and references ... (read before editing)" stood over three documents: the
  skill, the same contract again as canonical instructions, and the 24 KB curve
  skill - named four lines after the form had already said to reach for that one
  only when a frame needs new geometry, which a pose never does. Step 1 then
  said to open a 60 KB drawing that is four fifths `d="..."` path data the frame
  must not touch. Reading all of it is a defensible way to spend a run, and one
  run spent 520 seconds doing exactly that and was cancelled having edited
  nothing at all. One read is required now - the skill, which is the whole
  contract - with the instructions and the curve skill moved under **Reach for
  the rest only when this frame turns out to need them**. Step 1 says to search
  the drawing for `data-name=` and read a window around the group being posed
  rather than the file. Required reading drops from 92 KB to 55 KB, the drawing
  stops being read whole, and the form pays 250 bytes for it.
- **The form never said how the finished frame reaches its output path.** It
  forbade copying the source to that path and editing it there - the mistake
  that puts the previous pose on the page - and then never mentioned the other
  order. What is left is the reading a helper will actually take: pull the
  document in, hand it back out, which is the whole 60 KB of path data through
  the helper twice for a file that is already correct on disk, and it is the
  exact failure the rest of the form is built to avoid. The step now says to
  copy the file, with a shell copy, and why. (The one run in four since the app
  started noticing that did edit its source in place was also the fastest, 158s
  against 287s, 306s and the 520s cancellation - four runs is a hint, not a
  finding, and the missing instruction is worth closing either way.)
- **Nothing told the helper how long a frame was supposed to take.** The app's
  limits only ever kill a run; a limit is not a budget, and the helper is the
  only one who can spend one. The form and the frame agent now say a frame
  should take under five minutes and that reading is what spends it - five
  being the round number above the 158s, 260s, 287s and 306s the last four
  finished frames cost. The app's own limit stays deliberately looser: a slow
  frame that arrives beats a fast failure.
- **A reference picture the helper could not reliably see.** The skill's
  pictures are black line art, and
  `assets/illustrated-single-character-actions.png` was 89.8% transparent - a
  drawing with no ground under it, which flattens against whatever the viewer
  puts behind it and disappears entirely against a dark one. A white-background
  re-export existed but had landed beside it as
  `illustrated-single-character-actions.svg.png`, a name nothing pointed at, so
  the skill went on serving the transparent copy. The opaque export now holds
  the name the skill uses, and all six of the skill's pictures are opaque. The
  SVGs stay transparent on purpose: a background rectangle in an SVG is a real
  layer, and a real layer is one more thing the helper has to pose.
- **The stall limit killed helpers that were still reading.** Even counting
  writes as activity, five minutes is not long enough for the half of the job
  that writes nothing: the helper loads a 46 KB skill, 13 KB of instructions,
  the form, and a reference sheet that is half a megabyte as a picture, then
  finds every layer it has to pose inside a 60 KB drawing. That was survivable
  while a frame meant four assemblies and stopped being survivable at eleven
  layers - a second sequence died at 302s having never touched the frame. The
  limit is now split by phase: ten minutes before the first edit, five after
  it, because silence before the helper starts editing means it is reading and
  silence afterwards means it stopped. The status line and the log say which
  phase a run is in, so a stall names what the helper failed to do rather than
  only how long it was quiet.
- **The five-minute "stall" was a hard cap on the whole run.** The limit was
  refreshed by helper output alone, and `claude -p` prints nothing until it
  exits, so a run that was working looked exactly like a hung one. It went
  unnoticed while a frame took two minutes and surfaced the moment the job got
  bigger: posing eleven layers instead of four took 199s, then 260s, then the
  third frame was killed at 301s mid-edit. **A sequence asked for four frames
  and stopped at two.** Writes now count as activity - the helper edits the
  source once per layer it poses and renders a preview beside it to grade
  itself - so a working run is never mistaken for a hung one, while a helper
  that has genuinely stopped still gets killed on time.
- **The helper's reply was thrown away on every run the app has ever made.**
  The child was killed the instant the frame file appeared, which is a moment
  before it says what it saved and what grade it finished on. Every
  `run end: stdout head:` in the log is blank, including the runs that came
  back wrong, so a frame with a known problem arrived with the sentence naming
  that problem already discarded. The frame now waits up to four seconds for
  that line, and resolves the moment it arrives.

### Changed

- **The reference sheet names its characters, and the skill indexes them.**
  `illustrated-multiple-character-actions` now titles each figure on the page -
  **Character I** to **Character V** - and brackets each strip with the action
  it draws. The skill carries the index that turns a title into something
  searchable (Character IV is `BadGirl`; **Take Damage** is the `damage`
  strip), together with what each character actually has drawn, and says to go
  to the one strip rather than to the page. This is reading time, and reading
  time is the half of a frame that has no output to show for itself: it is what
  the ten-minute setup window above is spent on.
- **The `vector-animations` skill and the frame agent both read an angle-less
  form.** A form saying the measured transforms are switched off is an
  instruction to pose every layer, not a gap to improvise into; the skill's
  movement budgets are the yardstick precisely because nothing else is.

## [4.2.1-alpha] - 2026-09-12

### Added

- **Brand resources for generated graphics.** A design language is measured
  from one asset, so it can record *where* a logo goes and never *which* logo -
  that is a property of whoever is drawing next, not of the file that was
  measured. `references/resources.md` carries the second half: a markdown list
  of `- key: value` that a generated skill reads before it draws.
  - **The format is a list and nothing more**, because the file is edited by
    whoever owns the brand rather than whoever owns the build. Headings, prose,
    `>` notes and fenced examples are ignored, so the file can explain itself
    and still parse. A value with a folder separator or a media extension is a
    path; anything else is text to draw, which is the whole rule behind
    `example.com` printing as a domain and `assets/logo.svg` being drawn.
  - **In a `GLOBAL_ASSETS` folder the file name is the slot.** `logo.svg` fills
    the logo, `footer.png` the footer, `logo-mark.svg` fills `logoMark`. No
    manifest, and therefore no second place to fall out of step: adding an
    asset to the folder is the whole of adding it to the brand.
  - **Nothing has to ask for the assets.** A caller never writes "include the
    linked assets". If the declared paths resolve, every graphic the skill
    draws carries them.
  - **An unconfigured file is a working state.** Each brand slot falls back to a
    mark in the design language - a monogram of the brand name on the accent, or
    a set wordmark - so a page with no brand is still a finished page, and
    obviously a placeholder to anyone holding the real logo. A generated
    `resources.md` ships with values the parser rejects (`path/to/...`, `TBD`)
    so a fresh skill is unconfigured by construction rather than by accident.
- **Vector assets are inlined, not linked** (`inlineSvg`, `placeBrand`). The
  rasterizer decodes PNG and nothing else, so an SVG logo placed as an `image`
  renders in the SVG export and is a **hole in the PNG** - silently, with the
  reason in `warnings` where nobody looking at the picture would find it. The
  asset's shapes are read into the composition instead, so both renderers draw
  the same mark and it stays vector, scaling without going soft. `rect`,
  `circle`, `ellipse`, `line`, `polygon`, `polyline`, `path`, `text` and
  data-URL `image` are handled, painted by presentation attribute, inline
  `style`, or a class in a `<style>` block - which is what a design tool
  writes. Nested `<g>` transforms are composed and applied. Gradients,
  patterns, filters, `<use>` and elliptical arcs land in `notes` rather than
  being approximated.
- **Brand position detection** (`detectBrandSlots`, `scanBrandBands`,
  `findBrandSlots`), reported by the analyzer and written into every
  `DESIGN_LANGUAGE.md` as a table.
  - **By layer name first.** A designer who called a layer `logo` has already
    marked the slot, and reading it costs one pass over the markup. Names are
    read from `id`, `data-name`, `inkscape:label`, `serif:id` and `aria-label`,
    so Illustrator, Inkscape, Affinity and Figma exports are covered without
    asking which tool wrote the file. Each slot reports a box, a region, a page
    share and a confidence.
  - **By scanning second.** Failing a name, the media is read a quarter of the
    page at a time, top first, stopping at the first band holding a compact
    mark: ink that covers a little of the band and is gathered rather than
    spread across it the way a line of text is. That spread test is what
    separates a logo from a headline. It is a heuristic with no idea what a
    logo looks like, it says so in `notes`, and its confidence never reaches a
    name's.
- **`generate-skill.mjs`.** Measuring an asset, writing down what was measured
  and scaffolding a script against those numbers is arithmetic, and arithmetic
  should not need a model. The generator writes the skill, its design language,
  its `resources.md` and its brand resolver, then prints how to point it at a
  brand. Two overwrite rules that differ on purpose: a **design language file is
  never overwritten** (a second asset gets `DESIGN_LANGUAGE-<stem>.md`, because
  a reader's corrections are the most valuable thing in the first one), and a
  **skill is overwritten only after asking** (`--force` answers in advance,
  which is what a test passes).
- **`npm run test:graphic-design-api`.** An end-to-end check of the road to a
  graphic rather than of the graphic: read the reference asset, generate a skill
  from it, point it at the symlinked brand assets through a `resources.md`, draw
  a card and a cheatsheet that carry them into
  `test/graphic-design-api/generated-graphics/`, and make 36 assertions about
  what came out. Every step is a production entry point invoked as the
  documentation says to invoke it, so a pass means a clone following
  `API-QUICKSTART.md` works. It needs a file system, a symlinked folder and a
  generated script, none of which a bundled `node:test` suite can exercise
  honestly.
- **`test/brand-resources.test.ts`.** Twelve standards across the three
  mechanisms that can each fail quietly: reading the file, inlining a vector,
  and falling back. The inlining test is the one worth keeping - it renders the
  same logo twice, inlined and linked, and asserts that the inlined page has the
  logo's green in its pixels while the linked one is blank paper.
- **`napkin-sketch/graphic-design/files`.** The Node-only file helpers now build
  to `dist/graphic-design/files.js` and are reachable by that subpath. They were
  documented as a deep import into `dist/core/`, which the package's `exports`
  map blocked and which the build never emitted - a documented import that
  existed in neither form. Every doc now names the path that works.
- **A generated skill registers itself, so using it needs no paths.**
  `generate-skill.mjs` writes `references/graphic-design-api.json` as its last
  act: which script draws, which `resources.md` it draws with, where output
  goes, the modes the script can draw, and a `defaultRequest` for when the
  request does not say. That file is the difference between a skill that exists
  and one that can be used without a manual.
  - **A request becomes a command by string matching**, deliberately. Each mode
    carries its own keywords - `cheatsheet` answers to "cheatsheet", "syntax",
    "html", "code" - and the default wins when none appear. That is why a bare
    `generate` works: it contains no mode keyword, so it falls through to the
    registered request. Anything cleverer would need a model, and the point of
    this file is to be the part that does not.
  - **The project's `resources.md` wins over the skill's copy.** A generated
    skill carries a snapshot so it runs anywhere on its own; a registered
    command passes the project's file explicitly, because that is the one
    somebody edits.
  - `--no-register` opts out, `--default-request` sets what a bare request
    means, and `--registration` on `brand-resources.mjs` prints the whole
    wiring plus the exact command it produces.
- **The generated script draws a cheatsheet as well as a card.** `--cheatsheet`
  swaps the paragraph for a panel of syntax-coloured code, advanced by the
  monospace metric rather than by `measureText`, with the plate above it sized
  from the heading it actually holds. The syntax colours are taken from what the
  source declared and kept clear of the four structural roles, so a code panel
  cannot quietly reuse the accent and leave the page with two things claiming to
  be the important one.
  - This is also the honest test of the claim that a design language is not a
    template: the source asset carried no code at all, and the language carries
    a cheatsheet without being stretched.

- **Every reference asset ships as a picture as well as a source**, and Animation
  Mode was taught to use it. `<name>.png` now sits beside `<name>.svg` in both
  `vectors` skills - twelve sheets in all - and the two answer different
  questions: the picture says what a movement looks like, the source says where
  the anchors are and what the layers are called.
  - **The frame agent looks before it poses.** A new first step picks the
    preview for what is being drawn - the wireframe rig for a cycle, the
    illustrated sheets for a character action, the object rigs for a break or a
    bounce - and reads it. The travel tables already said how *far* a part
    moves; nothing said what the result was supposed to look like, which is
    exactly the half that went wrong. A frame with every angle inside budget can
    still read as a stumble rather than a stride, and now there is something to
    check it against. The existing "look at what you drew" pass compares against
    that same reference rather than against an idea of it.
  - **The two illustrated sheets stop being unreadable.** They are 1.5 MB and
    2.5 MB, and the skill's standing instruction was simply not to open them - a
    reference nobody can look at. Their previews are 396 KB and 601 KB as
    pictures, one `Read` each, and every number in them was already measured
    into `illustrated-frames.json`. Picture plus numbers is now the whole of
    what those files have to give, and the instruction is "look at this" rather
    than "do not touch that".
  - **The split is written down rather than implied.** Both skills carry a table
    of which question goes to which file, and the rule that a small sheet like
    `shapes.svg` is cheaper to read outright than to look at - the source is the
    half with the coordinates in it.
- **`test/ai-helper.test.ts` fails if an asset arrives without its preview**, or
  a preview outlives its drawing. The failure it guards is silent: an asset with
  no picture is one a tool quietly stops looking at, and nothing about the
  resulting frame says why it got worse. A second standard checks each PNG is a
  real image with usable dimensions, and measures the claim the skills make about
  the two illustrated sheets - "look, do not read" only holds while the picture
  is the cheaper of the two, so that is asserted rather than assumed.

- **Animation Mode grades a frame and acts on the grade.** `npm run frame-preview -- <frame>
  --against <previous> --grade` now ends with a verdict - `pass`, `revise` or `save` - an ordered
  list of what to fix, and a `VERDICT:` line a caller can branch on (`--strict` puts it in the
  exit code too). The measuring was already there; what was missing was a decision, so the report
  was printed and the run walked away from it.
  - **The stop flag is a flag.** `--passes` (two by default) turns `revise` into `save` once the
    budget is spent. A run that keeps polishing is a run the app kills at five minutes with
    nothing on disk, so the last pass saves what it has and reports the defects it knows about
    rather than hiding them.
  - **Findings are ordered, and only the first is worth a pass.** The rest are usually its
    symptoms, and splitting one remaining pass across a cause and its own smoke fixes neither.
- **A redrawn frame is now caught, by reading the file rather than measuring the drawing.** A
  frame is posed - the movement lives in `transform` attributes and the path data is untouched.
  Re-emitting the geometry instead produces a figure that is complete, layered, opens fine, and
  has its limbs drifted off their joints; it reads as a bad drawing rather than as a broken
  process, which is exactly why it survives a look and reaches the strip. The signature is exact
  and needs no tolerance: a posed frame shares its path data with the frame it came from, a
  redrawn one shares none of it and carries no transform.

- **Animation Mode asks what the animation is for, and passes the answer to the
  helper.** A new optional field in the wizard's setup step - "What is this
  animation for?" - is carried into the form as an `<animation-note>` block and
  handed to the AI helper with every frame of the sequence.
  - **It is the one input in the form that was not measured.** Everything else
    describes the figure and the step: the assemblies, the layer inventory, the
    pivots, a finished transform per assembly, how far each part may travel.
    None of it says why the sequence exists - what the character is doing, what
    it is carrying, where it is going - and that is exactly what settles a
    choice the travel numbers rate equally.
  - **It outranks the animation type.** Both answer the same question - what is
    this sequence - and the dropdown answers it with one word out of fourteen
    while the note answers it in the user's own sentences. Where the two
    disagree the note decides and the type's template yields to it, and the
    form says which way round that goes twice: once beside the note, once
    beside the template it outranks. Asking the question and then ranking the
    answer below a dropdown would have wasted the asking - the field's own
    placeholder, "carrying something heavy in her right hand, so that arm
    barely swings", was an instruction the first precedence rule forbade acting
    on.
  - **Two things it does not outrank, and neither is about what the frame
    shows.** The measured transforms keep their joints: with a note in the form
    they stop being a dictation and become the amounts to start from, so a note
    about weight moves an angle - by the smallest amount that reads, about the
    same pivot, and named in the reply. And no note licenses a redraw: the path
    data stays exactly as it is and the movement lives in `transform`
    attributes whatever the note says. That second rule is the one every
    failing run has broken, and keeping it out of the note's reach is precisely
    what makes widening the rest of this safe. A note reading "just redraw her
    however looks right" is the case, and it has a test.
  - **Read with the skills, never instead of them.** The note says what the
    movement is; the skills still say how a frame is made. A helper that cannot
    honour part of a note says so in its reply rather than dropping the
    measured pose, and a note describing a movement the chosen type cannot be
    is reported rather than half-drawn.
  - **It describes the sequence, not the step**, so the same note reaches frame
    six as reached frame one.
  - **The block is tagged rather than quoted, and the closing tag is
    neutralised** before the note is written. That one is a correctness fix
    rather than tidiness: a note carrying `</animation-note>` would close the
    block early and everything after it would read with the authority of the
    form rather than as a note inside it - the difference between describing an
    animation and rewriting the job. Control characters are stripped, blank runs
    collapse, and the whole note is capped at 600 characters so it cannot crowd
    out the steps it is meant to be read beside.
  - `normalizeAnimationPrompt` does the cleaning where the text is read rather
    than where it is used, so the one place that knows it came from a person is
    the one that tidies it.
### Changed

- **The `vector-graphics` character and projection sheets were re-exported.**
  `isometric-objects.svg` and `perspective-objects.svg` gained white
  `background` rectangles so their previews are opaque rather than transparent;
  `male-character-elements.svg` gained named head and beard parts (`bald-head`,
  `goatee`, `neck-bald-head`); `female-character-elements.svg` is the same
  drawing, smaller.

- **`npm run test:graphic-design-api` installs what it tests.** It generates
  into the AI tool's real skills folder rather than into `.tmp/`, refreshes the
  helper first so the skill answering a request is the one this repository
  ships, and writes the project wiring - so the command is plug-and-play by the
  time it finishes rather than merely green. `--force` remains the only
  concession to being a script: interactive use still asks before replacing a
  skill, and a script cannot answer.
- **The project's brand wiring moved to `references/` at the repository root**,
  from `test/graphic-design-api/references/`. That is where the resolver
  already looks - it walks up from the working directory - so the previous
  location was only ever reachable by passing `--resources` by hand. It is
  gitignored for the same reason `ai-helper/installed.json` is: it names
  whichever assets a checkout points at, and the registration beside it carries
  a timestamp.
- **The composition skill checks whether it is already wired up** before
  composing anything from scratch. `/graphic-design-api <request>` now reads the
  registration, matches the request to a mode, and runs the generated script,
  rather than writing a new script that agrees with the captured language by
  luck. It is also told, in as many words, not to ask a caller to request the
  linked assets: that has never been something a caller had to supply.


- **Colour roles are decided by area, not by reference count.** A vector
  palette counts how often each colour is referenced, so hundreds of small white
  glyphs outrank one navy field covering the page, and the mechanical role guess
  names white the ground - exactly backwards. The analyzer now also inlines the
  asset, renders it small, and counts pixels, reporting that as `areaPalette`
  and a `Palette by area` table. The declared palette is unchanged, because it
  answers a different question and a reader comparing two vectors wants it. This
  is the correction the shipped worked example had to make by hand; it is
  mechanical, so it is made for you now.
- **The generated composing script sizes its plate from its content.** Both
  renderers lay text out from the same table, so a plate can be measured from
  what it will hold rather than stretched to the space available and left two
  thirds empty.
- **The frozen fixture skill carries brand slots.** `compose` and
  `composeCheatsheet` take an optional `brand`; without one, every slot falls
  back to exactly what the script drew before, so its output is byte-identical
  and the existing standards in `test/generated-skill.test.ts` still hold.

### Fixed

- **A three-frame `walk` came back as a stretch, and every check passed it.** The run that
  prompted this re-emitted all 121 paths in each of its three frames and set no transform
  anywhere, so the legs swung through wild arcs while the torso, skirt, shirt, head and both
  jackets sat frozen. The grader had already printed `arm OVER` and `clothing UNDER` on two of the
  three frames, and `7 layer(s) did not move at all` on two more - and nothing was required to act
  on any of it. The measurements were right, the loop around them did not exist.
- **`inlineSvg` dropped a `transform` written on the shape itself**, keeping only
  the ones on ancestor `<g>` elements. An editor writes
  `translate(...) rotate(...)` straight onto a rotated rect as often as it wraps
  one in a group, so the shape landed in the right place at the wrong angle -
  silently, and looking like a drawing that was always that way. Found by
  rendering the `vector-animations` wireframe rig, where every hand and foot is a
  rotated square and came out axis-aligned.
  - Measuring had to learn the same lesson twice: `detectBrandSlots` gave up on
    a shape that arrived wrapped in its own transform, so a named layer of
    rotated parts measured as nothing at all, and then - once it followed the
    wrapper in - counted the shape's transform a second time on top of the one
    it had already composed, which put the box off the page. Bounds now recurse
    through the wrapper, and a container's transform is the only one composed by
    the walker.
- **`encodePng` encoded a blank image instead of refusing a size it could not
  use.** Passing it a whole `RasterResult` rather than that object's three
  fields - an easy mistake, since it carries exactly `data`, `width` and
  `height` - left `width` undefined, made the stride `NaN`, and sailed past the
  "buffer too small" guard, because every comparison against `NaN` is false. The
  result was a 65-byte PNG of nothing and no error anywhere. It now checks the
  size before the buffer.

- **The brand asset symlinks resolved nowhere.**
  `test/graphic-design-api/test-assets/logo.svg` and `footer.png` stored targets
  written from the repository root rather than from the link's own directory,
  which is where a symlink is resolved from. They resolved on no clone at all,
  and because a missing brand asset falls back to a drawn mark rather than
  failing, the graphics would have come out looking plausible and carrying no
  brand. Both are now `../reference-graphics/links/...`, committed as mode
  `120000` with forward slashes, with a standing test.
- **The fixture symlinks under `test/graphic-design-api/skill/` broke** when the
  graphics moved into `reference-graphics/`, and with them thirteen tests that
  read through those links or the old `links/` and `created-*` paths. Targets
  and test paths are corrected.
- **A relative path in a copied `resources.md` is rewritten for its new
  location.** Moving the file without rewriting them breaks every asset it
  names, silently, for the same fallback reason as above.

## [4.2.0-alpha] - 2026-09-12

### Added

- **A test suite for generated skills.** `test/generated-skill.test.ts` renders
  eight variations of a graphic through a frozen copy of a skill the
  graphic-designer helper generated, and measures each one. No model runs: the
  helper's job ends when the skill is generated, and everything after that is
  deterministic code, so the suite costs one Node subprocess and about two
  seconds.
  - **Four tiers.** Structural (the page decodes at the declared size, two
    renders are byte-identical, the page is neither blank nor solid), language
    conformance (the three roles are present and inside their share bands, no
    colour is painted that the language does not declare, every type size is on
    the scale and every stroke on the declared weights), legibility and
    containment (WCAG contrast, nothing off-page, no code row under the footer,
    no two runs overlapping, raster strokes at least a device pixel). Those
    three fail. The fourth reports drift from the source asset and never fails,
    because a cheatsheet is legitimately denser than the card it was drawn from
    and a test that failed on that is one people learn to ignore.
  - **Each format is read on its own terms.** The vector's text runs are parsed
    and measured in the family the SVG names; the raster's pixels are decoded
    and quantized. Two of the defects this suite was written for are visible in
    exactly one of the two formats, so a check against a single output would
    have passed both.
  - **A negative control.** One variation renders at 1x and is asserted to
    *fail* the legibility standard, which is how that standard is shown to have
    teeth rather than to pass everything put in front of it.
  - **The share bands are evidence-backed**, drawn around eight measured
    variations and widened well past them. The defect that prompted them
    measured 83 / 11 / 2.5 against bands of 50-80 / 12-35 / 1-10, and fails two
    of the three.
- **`API-QUICKSTART.md`.** The path from a fresh clone to a graphic drawn from
  a script, to a plugged-in helper, to a design language captured off an asset
  you already have - with the two ways to install the helper and what actually
  differs between them, and a troubleshooting table that starts with `Unknown
  command`. `API.md` stays the reference; this is the route through it.
- **A second AI helper: `graphic-designer`.** It answers a different question
  from Animation Mode - not "draw the next frame" but "what design language is
  this graphic in, and how do I make more like it". Its
  `/graphic-designer:design-language` command reads a media file, writes a
  `DESIGN_LANGUAGE.md` describing what it found, and generates a lightweight
  skill named after the asset, carrying that language and a script that
  composes new work in it through the graphic-design API. The point is that a
  repeated graphics job - a series of social posts, a run of thumbnails - stops
  being a brief somebody re-explains each time and becomes a script with a name.
  - **It measures before it judges.** `analyze-media.mjs` is a dependency-free
    CLI (and an importable `analyzeMedia`) that reports what a file actually
    says: an SVG yields colors weighted by how often each class is referenced,
    plus font families, sizes, stroke widths, corner radii and an element
    census; a PNG is decoded and quantized into a palette and yields colors
    only; JPEG, GIF and WebP have no decoder here, exactly as the rasterizer
    has none.
  - **An empty palette means "not measured", never "no colors".** Every report
    carries a `notes` list naming what the format could not say, and the
    contract forbids writing down a value the file did not give. A design
    language whose numbers were guessed is worse than none, because the next
    asset gets drawn to it.
  - **Two skills.** `design-language` carries the procedure, the
    `DESIGN_LANGUAGE.md` naming rules (`DESIGN_LANGUAGE-<stem>.md` when one
    already exists) and the generated-skill collision rule (`<stem>_0`, never an
    overwrite). `graphic-design-api` is the general design skill pointed at this
    API: the element vocabulary, the grid arithmetic, the 60-30-10 ratio, type
    scales, WCAG contrast on a static page, and the limits the API is honest
    about.
  - **The check that matters** is run on the output: analyze the generated
    asset and compare its palette against the source's. Agreement on paper, ink
    and accent is the only mechanical evidence that the captured language is the
    one the asset was drawn in.
- **Graphic-design API.** A composition is a page and a list of simple
  elements - rectangles, circles, ellipses, triangles, polygons, polylines,
  lines, paths, styled text, placed media, groups and clipping masks - and it
  renders to **SVG** or **PNG**. `createComposition()` opens a 360 by 360 pixel
  page; a size can be named instead, and coordinates are read in pixels unless
  the page asks for inches, millimetres or points. It is headless: the app's
  own canvas is drawn into only when it is explicitly handed over, so a script
  that renders a graphic has nothing to do with whatever sketch is open. The
  reference, every element's properties, and worked examples are in the new
  [API.md](API.md).
  - **Both formats come off one document**, which is what makes them the same
    graphic. The page size, the elements, their order, their geometry, their
    colors, their transforms, their masks and the text layout are shared by
    construction rather than kept in step by hand; the difference between the
    two files is the media export format and nothing else.
  - **PNG with no dependency and no canvas.** Node has neither a rasterizer nor
    a font, and the repository has no runtime dependencies, so the raster path
    is written here: scanline coverage with four sub-rows a pixel and exact
    horizontal spans, stroke outlining, clipping masks as multiplied coverage,
    bilinear image sampling, a PNG encoder that picks a row filter per row, and
    the DEFLATE codec underneath both directions of it. A composition rendered
    twice produces identical bytes.
  - **Text is laid out once and read by both renderers.** The SVG writes live
    `<text>` in whatever font family the element named; the rasterizer draws a
    built-in single-stroke alphabet, because a PNG needs a font engine and
    there is none to ask. Both *measure* with the same table, so the line
    breaks, the alignment and the block's extent match to the unit in the two
    files and only the glyph shapes differ. Character styling covers family,
    size, weight, style, letter and word spacing, decoration and case;
    paragraph styling covers alignment including justification, line height,
    wrap width, paragraph spacing, first-line indent and what `y` measures.
  - **Media placements carry their own clipping.** A `clip` is either a mask
    defined once with `defineClip` and shared, or a shape written inline on the
    element, which the renderer promotes to a `<clipPath>` of its own. The SVG
    embeds JPEG, PNG, GIF and SVG verbatim; the rasterizer decodes PNG itself
    and takes a `decodeImage` hook for the rest, skipping a placement it cannot
    read and reporting it in `warnings` rather than failing the other forty
    elements.
  - **A canvas back end for the GUI**, `paintComposition`, draws a composition
    into a 2D context with the host's real fonts and the shared layout, and
    leaves the context exactly as it found it.
  - **Node file helpers** stay in their own module, the way the PDF importer
    does, so importing the API never drags `node:fs` into a web build.
    `imageDataUrl` reads an asset into a data URL and `writeComposition` writes
    the SVG and the PNG of one document in one call - a caller cannot export
    the vector of one revision beside the raster of another.
- **The form measures every layer, so a part can be identified without a name.**
  Animation Mode now sends the AI helper an inventory of the source frame's
  layers, each as a fraction of the figure's own box, together with its paint
  order. A drawing whose layers are called `g830` and `path4521` measures the
  same as one named by hand: the group across the top of the figure is the
  head, two similar boxes either side of the middle are a pair of limbs, and a
  small box at the far end of a limb is its hand or foot.
  - Fractions rather than pixels, because what identifies a part is its share
    of the figure rather than its size on a page.
  - Paint order comes with it, which is what says which of a mirrored pair is
    the near one - and what has to change when the pose puts the other one in
    front.
- **`npm run frame-preview` renders a frame so whatever drew it can look at it.**
  Animation Mode's helper worked blind: it set transforms, saved, and never saw
  the picture. A frame could satisfy every instruction in the skill and still
  have an arm off its shoulder - which is exactly what the last run produced,
  in all three frames, while every named rule was followed.
  - It rasterizes with the code already in the repository: `parsePathData`, the
    matrix stack and the anti-aliased scanline fill behind the graphic-design
    API, encoded by the dependency-free PNG writer that API already ships.
    Nothing is installed to get it.
  - Group transforms are resolved into the path data before drawing, so a frame
    posed with `transform` attributes renders as it will look once imported. A
    rotation is affine, so carrying the control points carries the curve exactly.
  - `--against <previous.svg>` prints how far each part travelled between the two
    frames beside what drawn frames do, marking each `ok`, `OVER` or `UNDER`, and
    names any layer that did not move at all. Picture and numbers from one call.
  - Stylesheets are read as well as attributes: an illustrator's export paints
    through `class="cls-30"`, and without that the reference frames rendered as
    a blank page.
- **Two illustrated assets, and the movement budgets measured out of them.**
  `illustrated-multiple-character-actions.svg` holds five characters - BadGirl,
  SassyGirl, JammingJabber, CrimeGuy, JumpingJunkie - each with drawn frames for
  walking, attacking, taking damage, going down and getting back up;
  `illustrated-single-character-actions.svg` holds one character in six action
  strips, including an eight-frame walk and a nine-frame run. Unlike the
  wireframe rig these are finished drawings, so they answer the question the rig
  cannot: not how far a joint turns, but how far each part of a figure actually
  travels between one frame and the next.
- **`npm run illustrated-frames`** measures them - 25 sequences, 70 steps - and
  writes `assets/illustrated-frames.json`: per animation type, how far the legs,
  arms, head and clothing move per frame as a percent of the figure's own height,
  and how much of the figure is redrawn rather than repositioned.
- **`npm run illustrated-frames -- --check <file.svg>`** measures any SVG the
  same way and prints it beside the drawn studies, so "the legs swing too far"
  can be settled rather than argued. It names any layer that never moves in any
  frame of the sequence.
- **`test/illustrated-frames.test.ts`**: the path tracing, the part naming, and a
  check that the budget table in the skill still matches the generated asset, so
  the numbers quoted to the AI helper cannot quietly go stale.
- **The form measures every layer, so a part can be identified without a name.**
  Animation Mode sends the AI helper an inventory of the source frame's layers,
  each as a fraction of the figure's own box, together with its paint order. A
  drawing whose layers are called `g830` and `path4521` measures the same as one
  named by hand: the group across the top of the figure is the head, two similar
  boxes either side of the middle are a pair of limbs, and a small box at the far
  end of a limb is its hand or foot.
  - Fractions rather than pixels, because what identifies a part is its share of
    the figure rather than its size on a page.
  - Paint order comes with it, which is what says which of a mirrored pair is the
    near one - and what has to change when the pose puts the other one in front.

### Changed

- **`/graphic-designer:design-language` takes an optional output directory.**
  The command captured a design language and left where to put it unstated,
  which meant the most obvious way to ask - "write `DESIGN_LANGUAGE.md` to
  `docs/design/`" - was answered by guesswork. It is now the second argument,
  and a destination named in plain words means the same thing. The
  already-exists check that picks `DESIGN_LANGUAGE-<stem>.md` is per directory,
  so one asset documented in two places gets the plain name in both.
- **`ai-helper/` is a container now, not a plugin.** It held the `vectors`
  plugin at its root, and two plugins cannot share one root, so the existing
  helper moved to its own exclusive folder at `ai-helper/vectors/` and the new
  one sits beside it. The marketplace lists both, `npm run ai-helper -- --list`
  names both, and a `HELPERS` registry in the installer replaced the five
  hard-coded constants that used to spell out one plugin's payload.
  - **An existing install keeps working.** A record written when `--to plugin`
    meant `ai-helper` is migrated as it is read, so the app, the status output
    and the uninstall sweep all resolve it to `ai-helper/vectors`. Without that
    the sweep would have been pointed at the container root.
  - **`npm run ai-helper` now installs every helper** rather than the one that
    used to be the only one. `--helper <name>` narrows it. Animation Mode's own
    script always names `vectors` explicitly, so
    `npm run animation-mode -- --install` and `--uninstall` reach exactly what
    they always did.
  - The install record stays at `ai-helper/installed.json`. `.gitignore`
    excludes that exact path, so a record one folder deeper would have been
    un-ignored and started committing a local install state.
- **`npm test` takes `--keep-graphics`.** The graphic-design suite draws a
  reference composition and several variations of it, writes both formats of
  each to `.tmp/`, and deletes them when it finishes, so a run leaves the
  working tree as it found it. The one thing a graphics test cannot assert is
  whether the picture looks right, and the flag is how to look: the files stay
  and the suite prints where.
- **The animation skill works like an image generator rather than a transform
  applier.** The job is the next picture in a sequence; the layer tree is how
  that picture is stored, and a frame that satisfies every naming rule while
  looking wrong has failed. Three things follow from that, all new to
  `vector-animations`:
  - **Pose from where the subject is now**, not from how an asset demonstrated
    the movement once. Which foot carries the weight and how far through the
    stride this is are read from the current frame; the cycle tables and the
    studies inform that reading rather than replacing it.
  - **Identify parts from geometry when the names do not help** - a table of
    what a head, hair, torso, arms, legs, hands and clothing look like in the
    measured inventory, plus the three rules that do most of the work: a
    mirrored pair is a pair of limbs, a box inside another part belongs to it,
    and a box spanning several parts is clothing. The reading is stated in a
    sentence before drawing, because a wrong one is easier to catch there than
    in a frame.
  - **Decide depth from the pose just drawn**, not the pose started from. After
    the new angles are worked out, each overlapping pair is asked which is
    nearer now, and the layers are reordered where the answer changed - limbs
    crossing the midline, a turning figure whose far arm goes behind the torso,
    a head turning past a shoulder, an object crossing on an arc.
- **The frame subagent looks at its own work before saving.** A new step between
  posing and saving renders the frame, opens the PNG, and checks the travel - for
  a limb detached from its socket, a leg through a skirt, a stride that reads as
  a stumble, and for parts that swung further than a drawn frame ever does. Two
  passes at most, because the app kills a run that goes quiet for five minutes
  and a decent frame saved beats a perfect one that never arrives.
- **The skill's drawing procedure says to look, not only to measure.** Step 5 was
  "measure the frame before you save it"; it is now "look at the frame before you
  save it", with the measuring alongside.
- **The animation skill now says how far a part moves, not only how far a joint
  turns.** A new "How Far a Part Moves" section carries the measured budgets -
  a walk's legs travel about 9% of the figure's height per frame and its arms
  about 5%; a run's bob is more than ten times a walk's - with the typical value
  to aim at and the observed range behind it.
- **"Nothing Stays Frozen"**, the rule the budgets exist to enforce. Across the
  70 drawn steps, 91-100% of layers are redrawn between frames and not one layer
  in a drawn walk is left frozen in place. A generated frame that sets a
  transform on the six assemblies and leaves the rest alone does the opposite:
  two thirds of the figure sits at identical coordinates frame after frame while
  the limbs swing around it, which reads as a cardboard cut-out with hinged arms.
  The rule is that no layer may keep the same shape at the same place in every
  frame of a sequence.
- **The drawing procedure covers the whole figure.** "Drawing the Next Frame"
  previously ended at "set one transform per assembly group", which is the
  instruction that produced the frozen torso. It now carries the rest of the
  figure with the assemblies, and measures the frame against the budgets before
  saving.
- **The animation skill says not to open the two illustrated SVGs during a run.**
  They are 1.5 MB and 2.5 MB - a run that reads one spends its whole budget
  before it poses anything. Everything a frame needs from them is in the 54 KB
  `illustrated-frames.json` and the tables in the skill, and the same is true of
  the wireframe rig and `skeleton-cycles.json`.
- **The layer-naming section cites six characters' worth of real names.**
  `dress` for a torso, `upper-body` for everything above the hips, `left-vest`
  for clothing, `upperarm` and `forearm` as siblings with no assembly around
  them, `jacket-keft` for a mistyped `jacket-left`, and a defeat frame with no
  child groups at all. CrimeGuy is built differently in different frames of his
  own walk, which is why the parts have to be worked out from the frame in hand
  rather than from a map built off the previous one.
- **The animation skill works like an image generator rather than a transform
  applier.** The job is the next picture in a sequence; the layer tree is how
  that picture is stored, and a frame that satisfies every naming rule while
  looking wrong has failed. Three things follow, all new to `vector-animations`:
  - **Pose from where the subject is now**, not from how an asset demonstrated
    the movement once. Which foot carries the weight and how far through the
    stride this is are read from the current frame; the cycle tables and the
    studies inform that reading rather than replacing it.
  - **Identify parts from geometry when the names do not help** - a table of what
    a head, hair, torso, arms, legs, hands and clothing look like in the measured
    inventory, plus the three rules that do most of the work: a mirrored pair is
    a pair of limbs, a box inside another part belongs to it, and a box spanning
    several parts is clothing.
  - **Decide depth from the pose just drawn**, not the pose started from. After
    the new angles are worked out, each overlapping pair is asked which is nearer
    now, and the layers are reordered where the answer changed.

### Fixed

- **Code tokens no longer overlap in a generated SVG.** They were advanced by
  `measureText`, which reports the API's built-in alphabet - the font the
  *rasterizer* draws - while the SVG named Courier New, which is wider by up to
  10 units on a 6-unit line. Every token landed short of where the real font
  would end it and the next one printed over the last. Invisible in the PNG,
  which is drawn in the very font that was measured, so only a reader opening
  the SVG would ever have seen it. Named as a limit in `API.md` and in the
  `graphic-design-api` skill, because it will bite anyone laying out runs
  side by side in a family they named.
- **Small text in a generated PNG is legible.** A 6-unit glyph is drawn with a
  0.45-unit stroke, under one device pixel at `scale: 1`, so a code panel
  anti-aliased into grey texture. Generated scripts now raster at 3x by
  default; the composition is unchanged, only the sampling.
- **An overlong title degrades instead of running off the page.** It steps down
  the type scale first - only sizes the design language declares - and is
  truncated with an ellipsis when even the smaller step does not fit. Found by
  the new suite on its first run, which is the argument for the suite.
- **The helper's slash command reaches a dot-folder install.** Installing to
  `.claude` or `.github` copied the skills and the contract and dropped the
  `commands/` and `agents/` folders on the floor, so
  `/graphic-designer:design-language` existed only for someone who had loaded
  the plugin - while the skill, the README and the contract all described it as
  the way to start the job. A command reachable under one delivery and missing
  under the other is a command whose documentation is wrong half the time.
  - Commands now land in `<target>/commands/<helper>/`, so the copy answers to
    the same `/<helper>:<command>` spelling the plugin gives it.
  - `${CLAUDE_PLUGIN_ROOT}` is resolved on copy to the helper's
    repository-relative folder. That variable is defined only for a loaded
    plugin, so a copied command that kept it pointed every path in its own
    instructions at nothing.
  - Uninstalling removes what installing added, commands and subagents
    included.
- **`import('napkin-sketch')` works from Node.** `dist/api/index.js` is an ESM
  bundle, but the package is `"type": "commonjs"`, so Node read a bare `.js`
  there as CommonJS and refused to load it - which meant the documented
  `import { createComposition } from 'napkin-sketch'` failed for anyone outside
  a bundler. The build now writes a one-key `dist/api/package.json` scoping that
  folder to ESM. Found by the graphic-designer helper's PNG decoding, which is
  the first thing in the repository to import the API as a plain Node script.
- **The graphic-design fixture symlinks resolve.**
  `test/graphic-design-api/skill/` carries two links to the same graphic in two
  formats; both were written relative to the repository root rather than to
  their own directory, and the PNG named a file that does not exist. Git had
  them as proper mode-120000 symlinks all along, so only the targets needed
  fixing, with forward slashes so a Linux or macOS clone resolves them too.
- **Measuring a posed frame read it as unchanged.** The movement figures come from
  path data, and a frame carrying its pose in `transform` attributes has the same
  path data as the frame it came from - so a freshly posed frame measured as
  though nothing had moved, which is the one answer that check must never give.
  Transforms are now resolved before measuring, the way the app resolves them on
  import.
- **The frame subagent could not finish, so a delegated frame stalled the run.**
  `animation-frame` was given `Read, Edit, Write, Glob, Grep` and no shell. It
  poses the source frame with a few small edits, which is cheap - but the posed
  file then has to reach `animations/<name>.svg`, and with no way to copy it the
  only route left was handing all 50-80 KB of the document to a `Write` call.
  That is the one move the agent's own instructions warn costs tens of thousands
  of tokens, and the app kills a helper that has produced no frame and no output
  for five minutes. The agent has shipped this way since it was introduced, and
  it only bites when the helper happens to delegate rather than doing the job
  inline, which is why a two-frame walk could produce the first frame in 53
  seconds and then stall on the second.
  - `Write` is now gone from the agent's tools and `Bash`/`PowerShell` are in.
    Removing `Write` is the fix rather than an extra: with no way to emit the
    document there is no expensive path left to take.
  - The agent now says to copy the posed file to its destination with one shell
    command, and why - pose first, copy second, because the app takes the file
    the moment it appears.
  - A test asserts both halves. The failure is invisible from outside the app -
    the helper just stops - so the tool list is checked rather than trusted.
- **The `graphic-designer` plugin manifest tracked the wrong version.** A
  version bump synced `vectors` and left the second plugin behind on the release
  before it, failing the manifest test.
- **The helper-root test failed on any machine that had run the installer.**
  `ai-helper/installed.json` is the install record, gitignored and written by
  `npm install`'s postinstall, but the test that keeps the helper container
  tidy allowed only a README beside the helper folders.

## [4.1.2-alpha] - 2026-09-01

### Added

- **Show Selection Borders.** A switch in the **Move** palette, beside its
  live preview, draws or drops the dashed blue outline around the selected
  elements. The selection is unchanged either way - it still moves, copies,
  rotates and exports the same, and the layers panel still shows what is in
  it; only the outline on the canvas goes. What it is for is judging a drawing
  with something selected, which is the one time the border sits exactly where
  the eye wants nothing: a few pixels off the marks being looked at. The Move
  palette is where it lives because that is where a selection is being worked
  on; **Quick Settings** (`Ctrl+,`) and the Verbose Settings window's **Sketch
  Support** section carry the same switch, and all three move together, as
  does `Ctrl/Cmd + H` - which is the one that matters while drawing, because
  the border is in the way exactly when a selection is being looked at and
  reaching a switch otherwise means opening a palette over the drawing being
  judged. On by default, and persisted like every other setting.
- **Editing panels dock.** Move, Rotate, Page Settings, and Sharpen Selection
  each carry a small button in their title bar that parks the panel in a dock
  beside the layers and properties panels, and takes it back out again. A
  docked panel is a column of the workspace rather than something over the
  drawing, so the canvas gives up the width instead of being covered - which
  matters most for exactly these panels, since the thing they edit is
  underneath them.
  - **Undocking puts the panel back where it floated**, at the position it was
    dragged to, so trying the dock costs nothing.
  - **The dock remembers across a close.** A docked panel that is closed stays
    docked; reopening finds it where it was left rather than floating again.
  - **The dock takes no space when it is empty** - no column, and not even the
    pixel its border would cost - so a session that never docks anything is
    laid out exactly as before.
- **Rotate: turn a selection by hand or by the degree.** A **Rotate** button
  beside Move, and `Ctrl+R`, open a palette that turns the selection about a
  centre point. Positive degrees turn clockwise and negative counterclockwise,
  which is the same sign the canvas drag counts in, so the number in the field
  is always the number the gesture measured.
  - **`Ctrl+R` is a gesture, not a panel.** Opened from the keyboard, letting
    go of a canvas drag accepts the rotation and puts the palette away - press,
    swing, release, done, with no button to find afterwards. A press that
    turned nothing is not a gesture and leaves it up, so a stray click cannot
    dismiss it. Opening from the **Rotate** button or the Edit menu is the
    other intent - a panel wanted for typed angles, presets, and repeated
    turns - and that one stays put until it is dismissed. The panel says which
    of the two it is, since the difference only shows at the end of a drag.
  - **Drag on the canvas to turn it.** With the palette open the canvas is a
    rotation handle: press anywhere and swing. The pointer's bearing from the
    centre is sampled each frame and the shortest way round added to a running
    total, so the gesture crosses the seam at half a turn without flipping
    sign, and a second lap counts as a second lap rather than undoing the
    first. A dashed lever runs from the centre to the pointer while it goes.
    Releasing bakes the turn as **one undo step** - not one per pointer event -
    and the field returns to zero.
  - **The centre of rotation moves.** Drag the crosshair on the canvas to put
    the pivot anywhere, type an exact **Centre x / y** in any of the usual
    units, or pick one of the **nine handles of the selection's box** from the
    preset grid. The pointer turns into a grab where the marker can be picked
    up, so the one thing that says the pivot is movable is on the pivot. A
    centre that has been dragged or typed matches no preset, and the grid
    shows none lit, which is itself the reading that the centre is custom.
  - **A live preview**, off by default, shows the typed angle on the canvas
    before it is committed - the real rotation made and unmade, none of it
    taking a history step, exactly as the Move dialog's preview works. A drag
    always previews whatever the checkbox says: a gesture that turned nothing
    until it was released would be no gesture at all. Moving the centre while
    a preview is showing takes it off and re-makes it about the new point,
    since a rotation cannot be adjusted from one pivot to another.
  - **Common rotate controls**: a signed angle field, a **CW / CCW** pair that
    re-signs whatever magnitude is typed (and lights to show which way the
    current angle turns), the nine-handle centre grid, and a **Snap to 15°**
    toggle. `Shift` snaps for one gesture without the toggle; arrow keys step
    the angle by a degree, or by 15 with `Shift`.
  - **Bezier paths turn as paths.** Anchors and both tangent handles rotate
    with the geometry, so a turned Vector Path stays editable and bows exactly
    as it did. A **Copic stroke's broad nib turns with the mark**, keeping its
    bearing relative to the stroke instead of staying pinned to the page.
    Text and images have no orientation in the model, so they orbit the centre
    without tipping; an image orbits by its middle rather than by the top-left
    corner its anchor records, which is what keeps it where the eye expects.
  - **The palette opens out of the way**, in the top-right rather than centred,
    because the canvas under the selection is where the rotation is dragged and
    a centred panel would be sitting on exactly those pixels. It is otherwise
    the Move palette's twin: dragged by its title or border, resized from its
    corner, and left where it was put. A closed palette is out of the way
    outright - `visibility: hidden` rather than only transparent, so the panel
    neither takes presses meant for the canvas underneath nor keeps its fields
    in the tab order.
- **Move by an exact distance.** A **Move** button beside Join, and `Enter`
  with something selected, open a dialog that shifts the selection by typed
  `x` and `y` distances in any of the usual units. The Properties panel already
  sets an absolute position, so this one is relative - which is what "nudge it
  ten to the right" wants. Positive `x` goes right, positive `y` goes down.
  - **Arrow keys step a field by its own unit**, and `Shift` takes the coarse
    step: 1 and 10 for px and pt, an eighth of an inch and a whole inch for
    in and mm alike, so changing a field's unit does not change how far one
    press actually moves the drawing. The browser's spinner only knows a fixed
    `step` attribute, which cannot grow with a modifier, so both arrows are
    handled directly.
  - **`Enter` commits the move and closes**, the same as the **Move** button:
    a typed field says it is finished with Enter, and the palette has one job.
    `Escape` closes without moving.
  - **Changing a field's unit converts what is in it**, so the distance stays
    the same and only the way it is written changes: an inch becomes 25.4 mm
    rather than 1 mm, and a live preview does not jump.
  - **The dialog is a floating palette**, dragged by its title or by the
    padded border ring around its contents, and resized from its corner, so it
    can be put somewhere that is not covering the selection it is moving. The
    border shows a crosshair move cursor (`src/assets/move-popup.svg`, sized to
    32 px with its hotspot at the centre) wherever the press would drag rather
    than land on a control, and the resize grip keeps its own corner. The panel
    keeps its place between openings and is pulled back on screen if the window
    has since shrunk. It also stops dimming and blurring the page behind it,
    which is what makes the live preview worth watching while the distance is
    typed.
  - **A live preview toggle** shows the move on the canvas while the distance
    is still being typed. The preview is the real move made and unmade, none
    of it taking a history step; committing puts it back first and then moves
    once for real, so the whole thing stays a single undo, and Cancel or
    `Escape` leaves nothing behind.
- **A frame count that paces a sequence instead of batching it.** Animation
  Mode's setup gains a **Frames in the sequence** field, and it does not change
  how many frames are drawn - they are still drawn one at a time, and the
  sequence still runs for as long as Keep and draw next is pressed. It sets how
  far one frame moves: a cycle's whole movement is spread across that many
  frames, so **fewer frames move further each and more frames move less**.
  - **Measured cycles are resampled, not repeated.** A cycle is a list of
    per-step deltas measured from a fixed number of drawn skeletons, and
    deltas cannot be stretched on their own. They are turned into running
    totals, sampled at the boundaries of the requested frame, and differenced
    again - so the pose part-way between two skeletons is interpolated rather
    than invented, and the totals come out unchanged. A walk paced to 2, 4, 8,
    16, 24, or 60 frames closes exactly; a knockdown paced to 3, 6, 12, or 20
    lands at the same angle it was drawn landing at.
  - **The default is the length the cycle was drawn at**, so each type opens
    at one drawn frame per drawn skeleton and any other number reads as a
    deliberate choice. The note under the field says which way a change moves
    the pose.
  - **Types with no measured cycle get the count as context.** Their prompt
    template now carries the sequence length and says this frame is worth
    about one Nth of the movement, which is the only pacing an AI-posed type
    could otherwise take a guess at.
  - Step values are rounded to two decimals rather than one, matching the
    transform writer, so resampling a short cycle into many small steps no
    longer accumulates rounding into visible drift.
- **Animation Mode announces a finished sequence.** Once as many frames have
  been kept as the setup asked for, an **Animation Graphics Completed** prompt
  says how many were generated and offers **Generate New Animation** - which
  runs the wizard again from the top, so the next sequence picks its own type
  and length - or **Done**. The frame before it reads "Keep and finish" rather
  than "Keep and draw next", so the last one is not a surprise.
- **The wizard's dialogs are movable and resizable too**, by the same border
  drag and corner grip as the Move dialog, so a step can be pushed aside to
  see the frame it is talking about.

### Changed

- **The animation skills read the drawing before they trust the names.** A new
  **Read the Drawing Before the Names** section opens `vector-animations` with
  the order the work actually goes in: see what the SVG draws and which way the
  figure faces, read the layer names as evidence about that picture rather than
  as instruction, map every layer to a part, and only then pose the frame. All
  of it is taken from a real hand-drawn document rather than invented.
  - **Names will not match the rig.** `head-assembly` for the head, uniquifiers
    landing after a frame index so the name stops parsing (`BadGirl_walk_2-2`
    is frame 2, not frame 22), and a first frame carrying no number at all
    (`BadGirl`). Match on meaning; where a name is ambiguous the geometry
    decides.
  - **Layers the rig does not name still have to move.** Clothing follows the
    part it hangs on, and a part can be a *sibling* rather than a child -
    `front-glove` sits beside `front-arm-assembly`, so rotating the arm alone
    leaves the glove hanging in the air. A figure that comes apart at the wrist
    is always this.
  - **Paint order is part of the pose.** Document order is the only depth a
    flat drawing has, and it is a per-frame decision: when the legs cross, the
    two swap. Keeping one order for the whole sequence is what makes a walk
    read as a figure sliding rather than striding, and it is the foreshortening
    cue a still frame has.
  - `vector-graphics` gains the general half of that as **Document Order Is
    Depth**, plus a note that a copy marker can land on a name that already
    ends in a meaningful number.
  - The assets are framed as coursework: the rigs are the exercises, the
    studies are the sketchbooks, and their careless layer naming is itself part
    of what they teach.
- **The `vector-animations` skill covers animation physics.** A short
  **Animation Physics** section in the skill and a full
  `references/animation-physics.md` beside it, because a cycle table says what
  angle a joint takes but nothing about how far apart two frames sit - which is
  the only dial a posed frame has, and the one that decides whether a sequence
  reads as real. It matters most for the types with no measured skeleton: jump,
  fall down, knocked down, break, explode, move, and anything arriving as a
  study.
  - **Gravity by the odd-number rule** is the usable part: from rest,
    successive frames cover 1, 3, 5, 7, 9 units, so a five-frame drop sits at
    1, 4, 9, 16, 25 units down rather than five even steps. With arcs even
    across and accelerating down, frames bunch at the apex, and that bunching
    is the hang time.
  - **Bounce height falls as `e^2` per contact** and each arc needs fewer
    frames than the last; **weight is frame count rather than distance**, so a
    heavy thing spends several frames starting and stopping where a light one
    spends one and overshoots.
  - The reference also covers what a real solver would do instead - mass-spring
    systems, the finite difference approximation, explicit against
    semi-implicit against implicit Euler, and the cost in control that comes
    with them - so a request for simulation gets an accurate answer rather than
    a guess. Every figure in it was checked against its own arithmetic.
- **The AI skills' asset lists match what is actually there, and say how far
  each sheet can be trusted.** Both skills now group their assets by how
  organized they are, because a helper that treats a study like a rig will read
  names off it that were never meant to hold.
  - **`vector-animations`** documents `character-wireframes.svg` and the
    generated `skeleton-cycles.json` as rigs to measure;
    `breaking-objects.svg` as partly organized - its frame numbering is
    reliable, but frame `_0` of both sequences carries `potential_*` and
    `obsoletes` groups that are working scraps rather than parts of the
    drawing; and `bouncing-object.svg` and
    `character-study-throwing-and-walking.svg` as studies to read rather than
    derive from.
  - **`vector-graphics`** replaces the removed `objects.svg` with
    `isometric-objects.svg` and `perspective-objects.svg` - one wheel, sphere
    and cube drawn twice with matching group names, so a drawing can be moved
    between projections a face at a time - and adds
    `male-character-elements.svg` and `female-character-elements.svg` as very
    loose studies, with `alphabet.svg` and `shapes.svg` unchanged.
  - **Both skills say when a study is the right answer**: a request the rigs do
    not cover - a pose the wireframes do not hold, an object that travels
    rather than comes apart, or anything reaching the API or the app's AI
    helper without a preset behind it.
  - Three references to `assets/object-animations.svg`, a file that does not
    exist, are corrected to `breaking-objects.svg`, and the cross-skill links
    from `vector-animations` no longer point at the removed `objects.svg`.
    Every asset path in both skills now resolves.
- **The editing popups share one implementation.** Dragging by the title,
  dragging by the border band, the corner resize grip, and staying on screen
  when the window shrinks were a set of private methods that only the Move
  dialog used; Rotate then wanted all of it. They now live in
  `src/renderer/popup.ts` as a small manager, and each popup declares which
  capabilities it wants - moveable, resizable, dockable - rather than
  inheriting whatever the routine happened to do. The wizard's steps stay
  moveable and resizable but are deliberately not dockable. The module reads
  the same `is-hidden` class the app already toggles to open and close a
  dialog, so no opener or closer had to change to gain any of this.
- **Reload is gone, and `Ctrl/Cmd + R` rotates in its place.** Reload discarded
  the sketch without a word, from a shortcut that sits next to half the editing
  keys. The View menu's Reload row is removed and both key presses are taken
  before Chromium sees them - including while a text field has focus, which is
  where a stray `Ctrl+R` during a layer rename would otherwise still have gone
  to the browser and taken the drawing with it. `Ctrl+R` then has a job rather
  than only a refusal: it opens Rotate for the selection, the way `Enter` opens
  Move. `F5` keeps the explanation, since nothing else has ever wanted it.
- **Closing with unsaved changes asks first.** The window close is held for the
  standard three-option prompt - **Save**, **Don't Save**, **Cancel** - and only
  goes through on an answer that allows it. Save runs the app's own save, so a
  sketch with no file still gets its dialog, and cancelling that leaves the
  window open rather than losing the work the prompt was protecting.
- **Drawing a busy page is no longer slower the busier it gets.** Every mark
  commits to a layer of its own, so a page's layer stack is as long as its
  drawing, and the three places that walk that stack - the canvas, the SVG
  export, and the PDF export - each resolved a layer's marks by rescanning the
  whole page. Walking the stack that way cost the cube of the page's size, and
  the canvas paid it on every frame of every drag, pan, and zoom. Each mark's
  layer is now resolved once per page instead of once per layer per mark, and
  the SVG export reads paint order from a table rather than searching the
  stroke list for each mark. A two-hundred-element page went from roughly eight
  million layer comparisons per frame to a single pass. Nothing about the
  output moved: the same layer resolution, the same paint order, byte-identical
  exports.
  - **Selecting, clicking, and rubber-banding got the same treatment.** Working
    out whether a mark can be picked up meant resolving its layer and every
    group above it, and the hit test asked that of every mark on the page - on
    every pointer move, to decide which cursor to show. Picking a click out of
    a crowded page did it three times over. The whole layer stack now resolves
    in one pass and the pickable marks in one more, both built fresh for each
    gesture step so nothing can go stale, and the three passes of a
    within-bounds pick share the one answer. Endpoint snapping, Select All,
    Sharpen All, the layers panel, and the page thumbnails all resolve once now
    too.
  - **The panels no longer rebuild faster than the canvas repaints.** Dragging
    a selection changes the document once per pointer event, and every one of
    those changes rebuilt every row of the layers panel and every field of the
    properties panel, in full, immediately - several times between one frame
    and the next, with all but the last thrown away. Those rebuilds now
    coalesce into one per frame, like the canvas redraw beside them. Nothing
    reads back what a rebuild writes except starting a layer rename, which asks
    for its row and so flushes the pending rebuild first.
- **A placed image is no longer held onto forever.** Decoded images were cached
  by their data URL and nothing ever dropped one, so every picture ever painted
  stayed in memory for the life of the window - across page turns, across
  opening a different sketch book, and past deleting the mark that put it
  there. The cache is now emptied whenever the whole document is replaced, and
  by the throwaway surface that Export All builds for each page, which was
  quietly keeping one alive per page of the export.
- **Two IPC paths that nothing could reach are gone.** A channel for entering
  rearrange mode had a sender, a subscriber, a bridge method, and a handler,
  and the main process never sent it - rearrange mode has always travelled the
  same route the Edit menu's own row takes. An `open-app-settings` action was
  handled in the renderer and dispatched from nowhere. Neither cost anything at
  runtime and both cost the next person to read the code, who would have found
  a handler that cannot run.
- **The roadmap gained a section for an instruction-driven graphics API.**
  Everything the app knows about drawing - the sharpen engine, the Bezier
  model, the layer tree, the SVG writer - is already browser-safe and already
  exported, and none of it can be reached without a pointer. `TODO.md` now
  carries **API Implementation**: thirty-four entries planning a headless path
  from a small instruction language through an evaluator that emits the same
  `Stroke` and `Layer` shapes the GUI commits, and out to SVG or PDF, listed
  in the order the pipeline runs rather than by size. It is scoped as a minor
  because every entry in it is additive - no existing export, signature, or
  file format moves - and it is a plan rather than an implementation, which
  is why this release stays at 4.1.2-alpha.
- **And a section for the tool that writes those instructions.** Recording a
  drawing session, replaying it through the app's own API, generating the
  Animation Mode helper script from the layers a user assembled, and
  organizing a selection into named, nested groups by rule are four
  capabilities and one mechanism: a script the app writes and then either
  hands to a tool or runs itself. `TODO.md` now carries **Automation and
  Scripting Tool**, thirty-three entries, filed as `++.y.z` because recording
  every document change means routing every document change through one
  observable path - a new contract for a store that mutates through roughly
  fifty methods called from the whole of the renderer. The undo stack is not
  that path, and the section refuses the shortcut up front: it holds page
  snapshots, not the actions between them. A plan rather than an
  implementation, so this release stays at 4.1.2-alpha as well.
- **And a section for Animation Mode itself, led by a typed prompt.** The
  wizard offers a fixed list of movements, so a user who wants something not
  on the list has no way to ask. `TODO.md` now carries **Animation Mode**,
  forty entries under five features, of which **User Prompt** is sixteen: a
  textarea in the setup dialog whose text reaches the AI helper. Two findings
  shape it. The form already tolerates a type it does not recognize -
  `animationTypeSpec` returns null and `buildAnimationForm` falls through to a
  generic branch - so the feature is largely about making that branch good
  rather than adding one. And the form's first principle - that a frame is a
  file edit and not a redraw - is precisely what a free-text prompt invites
  somebody to break, and that is the failure which made earlier runs run out
  of time. The other four features are the gaps a few runs make obvious: a
  prompt worth keeping, a frame worth fixing rather than redrawing, a step
  worth trying twice, and a sequence worth managing as a sequence. Additive
  against the mode as it stands, so `x.++.z` - and a plan again, so the
  release is still 4.1.2-alpha.

### Fixed

- **The head was never found in a hand-named document.** `matchesAssembly` took
  `head` literally, so a drawing that groups the head the way it groups the
  limbs - `head-assembly`, which is what an artist actually writes - resolved
  no head at all: it got no pivot, no transform, and stayed put while the rest
  of the figure moved. The `-assembly` suffix is now accepted on the two names
  that lack one, `head` and `body`. The four that already carry it still match
  exactly, so `front-arm-assembly` can never be read as a bare `front-arm`.
- **The space bar toggles a focused checkbox again.** Tabbing to **Live
  preview** or **Show Selection Borders** and pressing space did nothing: the
  space bar arms straight-line drawing, and that shortcut called
  `preventDefault` on its way past, cancelling the toggle the browser was about
  to perform. A checkbox is passed over by the "a focused text field owns its
  keys" guard on purpose - it consumes no letters, so the tool shortcuts keep
  working while one has the focus - but space is not a letter, and a checkbox
  has no other key. A focused checkbox or radio now keeps the space bar;
  everything else, the canvas included, still gives it to straight-line mode.
  Buttons are deliberately left out: they answer to Enter as well, so they lose
  nothing, and taking space from them would make a toolbar button that still
  held the focus from being clicked fire again instead of arming a drag.
- **A palette that opens on a field now actually opens on it.** The Move
  palette meant to open with its **Horizontal (x)** field focused and its value
  selected, so a distance can be typed the moment it appears; it was landing
  the focus nowhere, leaving the toolbar button still focused and typed digits
  going to the canvas as tool shortcuts. The dialog fades in from
  `visibility: hidden`, and an element that is not visible cannot take focus -
  the fade put `visibility` on a 160ms transition, so for the whole of it the
  panel still computed as hidden and the focus call was a no-op. Opening is now
  instant for `visibility` while the opacity still fades, and only opening:
  closing keeps the transition, so a dismissed panel still fades out rather
  than vanishing. Rotate's angle field and Page Settings' width field were
  focused the same way and were failing the same way; all three work now.
- **Move moved the selection twice when the live preview was on.** The preview
  is a real move, made and unmade, and the **Move** button committed the typed
  distance and then put the preview straight back on top of it - so a request
  for 100px landed the selection 200px along, with only the first half in the
  history step. Confirmed by driving the app: preview off gave 100px, preview
  on gave 200px. The button now commits the move the preview was already
  showing and closes the palette, which is the one step it was always meant to
  be. `Enter` does the same, for the same reason: it carried the doubled move
  too, and re-showing a preview over a committed move is what produced it.
  - **A close can no longer strand a preview on the canvas.** `closeMoveDialog`
    took a flag saying whether to take the preview back off, and the one call
    that passed "no" is what left the second move behind. An uncommitted move
    must never outlive the palette that was previewing it, so the flag is gone
    and every close reverts - which costs nothing after a commit, since the
    commit has already cleared it.
- **Selecting an element with the Select tool nudged it a few pixels.** The
  press committed to a move drag immediately, so the first pointer movement
  after it carried the element along one pixel for one pixel - and a click
  made by a hand always carries some. Driving the app confirmed the ratio
  exactly: a click travelling 3px left the element 3px from where it started.
  A press now only *arms* the drag, and the move begins once the pointer has
  travelled 4 screen pixels. Below that the gesture is a click and the drawing
  is left exactly as it was found; past it the element still follows the
  pointer the full distance, so nothing is lost to the slack.
  - **A click that only selects no longer costs an undo press.** The history
    step was pushed on the press for the same reason, so clicking an element
    to select it left a step that undid nothing. It is pushed when the drag
    commits instead. (This was the second of the two Select-tool defects
    recorded in `TODO.md`; both had the one cause.)
  - **An Alt-click that never moves no longer leaves a hidden duplicate.** The
    Alt-drag copy was made on the press too, so an Alt-click that went nowhere
    stacked a copy exactly on top of the original, where nothing showed it.
    The copy is made when the drag commits, and `Alt` is read at that moment
    rather than remembered from the press.
- **Grabbing the Page Settings or Sharpen title threw the panel off screen.**
  A placed panel was positioned `absolute`, which measures from whatever box
  its overlay happens to be. The two palettes whose overlay fills the viewport
  never showed it, but the corner variants are anchored bottom-right and are
  only as wide as the panel: writing the panel's viewport position into
  `style.left` moved it that far again from the overlay's own corner. Pressing
  the Page Settings title moved the panel 1471px right and 813px down, out of
  the window and beyond recall. A placed panel is `fixed` now, so its
  coordinates are the viewport's - which is what every number the popup
  manager drags, parks and clamps in already assumed.
- **The Move palette opened over the drawing it was about to move, three
  quarters of the screen wide.** It had no width of its own, so it opened at
  whatever its contents wanted - 1129px of a 1494px window for two number
  fields and a note - centred, on top of the marks its live preview was about
  to show moving. It now starts at 340px, the width Rotate already uses, and
  parks itself clear in the top-right corner on its first opening the way
  Rotate does. A palette dragged somewhere on purpose still stays there.
- **Undocking a resized panel brought back its position but not its size.**
  The dock has to clear the inline width and height the resize grip wrote so
  the column can set its own; only the position was noted down first, so a
  panel pulled bigger, docked, and taken back out returned at the default
  size. Both are remembered now, which is what the dock button promised: a
  round trip that costs nothing.
- **Page Settings and Sharpen are pulled back on screen when they open.** Move
  and Rotate each asked for that at their own call site; the other two never
  did, so a panel left near an edge could reopen off screen after the window
  had shrunk. The popup manager watches the class that opens a dialog and
  clamps every one of them - and it watches with one window-resize listener
  for all nine popups rather than one listener each.
- **The AI tool sign-in button could not open a terminal on Windows.** Pressing
  **Open sign-in** raised "Windows cannot find 'sign-in\'" instead of starting
  the tool. The window title was passed as one entry of an argv array, and Node
  escapes an entry that already carries quotes, so `start` received
  `""\"napkin-sketch sign-in\"" cmd /k claude` - it read `"\"napkin-sketch` as
  the title and tried to run the rest of the title as a command. The launch is
  now a single command string handed to `cmd /d /s /c`, whose `/s` strips the
  outer quotes and leaves the rest exactly as written. Only the wrapper shell
  is hidden; the terminal `start` opens is a process of its own and stays up.
- **Sign-in on a tool that is not installed says so** rather than opening a
  terminal that closes again: the executable is checked before the launch, the
  same way a generation run checks it.
- **`Enter` no longer opened the Move dialog on top of another one.** The
  shortcut only checked that something was selected, so pressing Enter to
  confirm an Animation Mode step - the obvious thing to press - put the Move
  dialog over the wizard. That one gap is what made Move look present but
  broken inside Animation Mode, made the wizard's first prompts look buggy,
  and left the move cursor showing afterwards. Enter now stands down while any
  other dialog is open and while Animation Mode is on, the Move button says so
  rather than opening, entering Animation Mode closes the dialog and takes any
  live preview back off the canvas, and closing it clears a half-finished drag
  so no cursor is left behind.
- **The move cursor took the whole border ring.** It now follows the same
  three-pixel band the drag does, so what shows the cursor is exactly what can
  be grabbed, and the resize corner keeps its own.
- **A group or multi-element selection is no longer easy to lose.** Pressing
  inside a selection of several elements now moves it, even where the press
  lands in a gap between the marks. It used to demand an exact hit on ink:
  pressing the space between two strokes of the very thing being dragged
  cleared the selection and started a rubber band instead.
  - **The press no longer drops the selection either.** A press on empty
    canvas with several elements selected keeps them until the gesture says
    what it is: the selection goes once the pointer moves (a real rubber
    band) or when it is released without moving (a click). A mis-aimed grab
    that never became either leaves the selection intact.
  - **The grab area around a selection is wider**, twelve screen pixels rather
    than four. A press aimed at a group of scattered marks often lands just
    outside the box enclosing them, and starting the move a few pixels off is
    a far better outcome than losing the whole selection.
- **Export All wrote its pages with no name.** Clearing the extension in the
  save dialog and typing a plain name left the files called `_1.png`, `_2.png`,
  and so on: the stem was taken by slicing the extension off the end, and
  slicing nothing off the end of a string leaves nothing at all. The whole name
  is now kept when there is no extension to drop. Windows' own dialog appends
  one, which is why this only ever showed on the dialogs that do not.
- **A fully transparent mark came back solid.** Opacity zero was rejected on
  load as though it were missing, and a missing opacity means the tool's
  default - which for a pen is fully opaque. Anything set to zero with Quick
  Opacity, or imported from an element the source file had at `opacity="0"`,
  turned into ink the next time the book was opened. Zero is now read as the
  opacity it is; anything outside zero to one still falls back to the default.
- **A save that could not land left its scratch file behind.** Saving writes a
  temporary file and renames it over the document, so an interrupted save can
  never corrupt the original - but when the rename itself failed, which is what
  happens on Windows if anything else holds the file open, the temporary was
  left sitting in the folder, and every retry added another. The failure is
  still reported and the original still untouched; the scratch file now goes
  with it.
- **Page thumbnails drew lines across the holes in a shape.** A ring, a letter
  with a counter, or any imported shape with an inner contour showed a line
  ruled from the end of the outer contour to the start of the inner one in the
  pages panel, and a shape with its outline switched off was drawn with one
  anyway. The thumbnail painter is a simplified copy of the canvas painter and
  had drifted from it on both counts; it now lifts the pen between contours and
  leaves a fill-only shape without an outline, the way the canvas and both
  exports always did.
- **`napkin-sketch --new` failed to start from some terminals.** Editor and
  agent terminals often export `ELECTRON_RUN_AS_NODE`, and the CLI passed its
  whole environment to the window it launched. With that variable set the GUI
  runs as plain Node, where `require('electron')` answers with nothing and
  startup dies naming an Electron internal rather than the cause. The variable
  is now dropped from the child's environment, since the window is never meant
  to run that way.
- **One bad id in an imported file could abort the whole import.** A layer's
  eraser mask is found by the id in its `mask="url(#...)"` attribute, and that
  id went into a lookup unescaped - so a quote or a bracket in it produced an
  invalid query that threw, and the file failed to import at all rather than
  losing one mask. The id is escaped now. Every other unreadable thing in an
  SVG already degraded gracefully; this one is the last that did not.
- **Imported artwork could paint in the wrong order.** napkin's own exports
  record each mark's paint order in a `data-i` attribute, and geometry from
  another editor carries none - which was supposed to fall back to the order
  the elements appear in the document. It never did: a missing attribute reads
  as the number zero, which is a valid order, so every foreign element was
  filed at the very bottom of the stack and the fallback beside it could not be
  reached. Only a document mixing both kinds of mark on one layer showed it,
  where the foreign artwork sank underneath geometry it had been drawn on top
  of.
- **The AI helper's log setting could point outside the folder it names.** The
  path is documented as relative to the helper's working directory, and it was
  taken as typed - so an absolute path replaced that directory outright, `..`
  climbed out of it, and the app created whatever folders it found itself
  needing. It is checked now: an empty value still switches the log off, a
  relative path is kept, and anything that would escape falls back to the
  default rather than being silently rewritten, so a path meant to go somewhere
  else fails where it can be seen. A settings file moves between machines, so a
  path that is absolute on any platform is refused on all of them.
- **The animation wizard's frame count said skeletons and meant steps.** A
  sequence opens at its animation's natural length, and the note explaining
  that number described it as the count of drawn poses the cycle was measured
  from. It is the count of steps between them, which for an animation that
  loops is the same number and for one that does not is one fewer - so the
  generated table showed "7 frames" above a six-entry list and read like a
  defect. The number was always right (a run draws the frames *after* the one
  already on the page, so six drawn frames plus the source is the seven poses
  that were measured); the wording is now right too, and the generated tables
  give both counts.

## [4.1.1-alpha] - 2026-09-01

### Added

- **The run is a measured cycle.** `Run-Animation` was drawn into
  `character-wireframes.svg` - ten skeletons, one per frame - so `run` moves
  off the written template and onto measured angles like walk, idle, and
  knocked down. `npm run wireframe-cycles` reads it, and the wizard offers it
  without the **Work in Progress** mark.
  - The measurement shows what a run is, rather than a walk with bigger
    numbers: the front leg swings 40.9 degrees at its widest against a walk's
    20.2 and travels around 80 degrees end to end against a walk's 50,
    `shiftYPercent` lifts the figure on the passing steps where a walk's neck
    holds one height, and the spine tips 14 degrees forward into the drive and
    comes back the same 14 on the next step.
  - All four columns still sum to zero across the ten steps, so the cycle
    closes and loops. A test pins each of those three: the deeper swing, the
    lift, and the lean returning - a run that tipped forward and stayed there
    would walk the figure onto its face after two repeats.
- **`object-animations.svg`**, the object counterpart of the skeleton rig, for
  the two types that cannot be posed with a transform: `Box_Breaking-Animation`
  (3 frames, a box cracking and shedding pieces) and
  `Cloud_ImpactEffect-Animation` (5 frames, an impact cloud dispersing).
  - Four group names carry the convention the skill now documents: `base` is
    what is left of the whole, one `stray-piece` group is one separated piece,
    `potential_stray-pieces` marks on the intact frame what will come away,
    and `obsoletes` names what the previous frame had and this one does not.
  - Two readings the drawing gives that a transform-minded one would not:
    piece count is not monotonic (the cloud runs 3, 5, 4, 4 across frames 1 to
    4 as puffs merge), and a separated piece is new geometry rather than a
    moved copy, because its outline changes as it tumbles.
  - The `break` and `explode` guidance in the app now names the drawing, so a
    template-posed object frame is written against it.
- **A serif typeface in `alphabet.svg`.** The asset now holds two typefaces
  rather than one: `Sans-serif-typeface` and `serif-typeface`, 26 letter-pair
  groups apiece. The pair is a worked example of the skill's own naming rules
  - the serif set carries the editor's `-2` uniquifier throughout (`Aa-2` is
  still `Aa`) and names its paths for the letters (`A`, `a`) where the
  sans-serif set names them for the roles (`upper-case`, `lower-case`).
- **`ai-helper/` is now the `vectors` plugin**, not a folder a plugin gets
  built out of. The manifest, a command, a subagent, both skills, and the
  helper contract are the folder's own contents, and one manifest at the
  repository root is the marketplace that lists it:

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

  ```text
  /plugin marketplace add .                              # from a clone
  /plugin marketplace add isocialPractice/napkin-sketch  # without one
  /plugin install vectors@napkin-sketch
  ```

  - **A plugin is more than the two skills.** `/vectors:animation-mode` runs a
    frame from the form the app wrote, and `vectors:animation-frame` is a
    subagent that does the same job in a context of its own, so a frame's SVG
    never lands in the main conversation. Both defer to the skills rather than
    restating them.
  - **The tree is tracked source, and there is one of it.** The dot-folder
    installs copy out of the same folder the plugin loads from, so a skill can
    no longer be current in one delivery and stale in the other - which the
    generated `plugins/` copy already was by the time it was replaced.
  - **Installable without a clone**, which the built folder never was: the
    marketplace manifest is committed, so `/plugin marketplace add` reaches it
    straight from GitHub.
  - Both manifests validate under `claude plugin validate --strict`.
- **The app knows which delivery it is talking to.** A plugin renames what it
  carries - inside one, a skill answers to `vectors:<skill>` - so a form that
  named the bare skill would name something the tool cannot find. The install
  record's `plugin` tool id now travels through `AnimationModeStatus` to the
  renderer and into `buildAnimationForm` as a `delivery`, and a plugin form
  names `vectors:vector-animations`, `vectors:vector-graphics`, and
  `/vectors:animation-mode` in place of the `ai-helper/skills/...` paths that
  only a copied install has. Omitting the delivery still writes the file-path
  form every tool understands.
- **A test guards against a skill existing twice.** It walks the tracked tree,
  reads the `name:` out of every `SKILL.md`, and fails on a repeat; it also
  checks the two manifests agree with each other and with `package.json`, and
  that the command, the subagent, the skills, and the instructions are all
  where the app says they are. Installed copies under an ignored dot-folder do
  not count - a duplicate there is the install working.

### Changed

- **The walk table in the skill was re-read from the asset.** Four cells had
  drifted from the drawing by a tenth of a degree (steps 3, 5, 6, and 7). The
  generated cycle was always right; the hand-kept table beside it was not.
- **The `plugin` install target no longer builds anything.** It used to
  generate `plugins/vectors/`, a second copy of both skills that went stale
  the moment either changed. `ai-helper/` is the plugin now, so the target
  checks that tree over, syncs the manifest version to `package.json`, and
  prints the `/plugin` commands that load it - readying a plugin was never
  what made its skills reachable. `--to plugin` resolves to `ai-helper`, and
  `plugins/` is deleted, dropped from `.gitignore`, and swept off disk by the
  target if an older build left one behind.
  - **Uninstalling a plugin install deletes nothing**, because what it
    installed is tracked source the repository needs either way. It prints
    `/plugin uninstall` and `/plugin marketplace remove` instead.
  - **The two plugin manifests are exempted from the ignore rules.** A global
    "ignore every dot-entry" rule would leave `.claude-plugin/` uncommitted,
    and an unpublished manifest is a plugin nobody can add.
- **Switching delivery removes the old install first.** `--install --to plugin`
  over an existing `.claude` install used to leave that dot-folder's copy of
  both skills in place, so a tool loading the plugin saw every skill twice.
  The install now uninstalls a previous target that is not this one.
- **The `vector-graphics` skill now covers SVG layer management.** A new
  "Layer Management" section records the structural rules the import/export
  work settled on, so the AI helper draws and edits with them instead of
  rediscovering them: nested `<g>` groups are the layer tree (document order
  is z-order, group opacity multiplies down, wrappers are never flattened);
  one layer name is written three ways (`id` for Illustrator,
  `inkscape:label` + `groupmode` for Inkscape, `data-name` verbatim) with the
  `-N` uniquifier and `_xHH_` escapes undone on read and tag-plus-digits
  auto-ids reading as unnamed; compound paths keep their contours together so
  an outlined stroke stays a sliver instead of a blob; fill-only shapes stay
  `stroke="none"`; and round trips preserve Bézier anchors rather than
  samples, at precision matched to the artwork's units. The skill's
  description and When-to-Use list now name these triggers, and the installed
  `.claude/skills/` copy is synced.
- **The `svg-animations` skill is now `vector-animations`.** The name pairs it
  with its companion `vector-graphics` and describes what it works on rather
  than the file format it happens to emit. The rename reaches the skill folder,
  its `name:` frontmatter and heading, the helper contract
  (`animation-mode.instructions.md`), `ANIMATION_SKILL_NAME` in
  `src/core/animation.ts` (which is what every generated form names), the
  wireframe-cycles script's asset paths, and the docs. Nothing about the
  skill's content changed.
  - **An earlier install is cleaned up on upgrade.** The installer now sweeps
    a list of retired skill folder names out of the target before copying, so
    a dot-folder that already holds `svg-animations` does not end up carrying
    two copies of the same skill under two names. Uninstall sweeps them too.

## [4.1.0-alpha] - 2026-08-30

### Added

- **Copy and paste**, reachable three ways: the native **Edit** menu, a
  **right-click on the canvas**, and the **keyboard**.
  - `Ctrl+C` copy, `Ctrl+X` cut, `Ctrl+V` paste, `Ctrl+Shift+V` paste in
    place, `Ctrl+D` duplicate. The Edit menu also gained Delete and Select
    All, which the keyboard already had.
  - **Paste aims at the pointer.** With the pointer over the canvas the
    graphic's top-left lands on it; with the pointer elsewhere each paste
    steps 16px down-right from the last, so repeats stack visibly rather than
    piling into one spot.
  - **Paste in Place** returns the elements to the coordinates they were
    copied from. The clipboard belongs to the app rather than to a page, so
    this is how a graphic moves to another page without drifting.
  - **Pasted elements become the selection** and the Select tool takes over,
    so the copy can be dragged immediately.
  - **A copied group keeps its layers.** Copying a group and pasting rebuilds
    the whole tree instead of merging it onto one layer: every nested layer
    comes back with its own name, opacity, visibility, and lock, and the marks
    are restacked in the paint order they had, so the pasted graphic is the
    one that was copied. Exported side by side, the original and the copy are
    byte-identical SVG.
    - The copy lands as a **sibling of the original**, at that layer's own
      nesting level, rather than nested inside the group it came from.
    - Only the pasted root takes the **" - Copy"** suffix. The layers under it
      keep the names the source file gave them, which is what leaves an
      imported SVG readable after a copy.
    - Pasted onto another page there is no original to sit beside, so the tree
      goes in at the top level.
    - A plain canvas selection still pastes flat onto one layer: a few marks
      picked out with the rubber band are not a structure worth rebuilding.
      The split is decided by whether the selected *layer rows* include a
      group, which is exactly the gesture that means "this whole graphic".
    - `Ctrl+D` duplicate follows the same rule.
  - **The right-click menu selects what it was opened on**: right-clicking an
    element that is not part of the selection picks it first, so *Copy* means
    the thing just clicked rather than whatever was selected beforehand. The
    layers panel's menu carries the same rows, since a lit row is a selection.
  - **The system clipboard is included.** A copy also goes out as SVG (cropped
    to its own ink, transparent), so it pastes into Illustrator or Inkscape;
    and SVG copied in another editor pastes in here through the same importer
    File > Import uses, layer tree and all. The SVG written on copy is
    remembered, so an in-app copy is never replaced by its own lower-fidelity
    echo, while a newer outside copy does win.
  - **The clipboard shortcuts stay out of text fields.** The Edit menu items
    carry `registerAccelerator: false`, which displays the shortcut without
    claiming it, leaving the keypress to the page - where the renderer already
    ignores shortcuts while a text field has focus. Claiming them in the menu
    would have taken `Ctrl+C` away from the layer-rename box and the property
    fields.
- **The Pages panel has a menu, and there are now three ways to start a page.**
  A hamburger button beside `+ Page` opens them:
  - **From Selection** measures whatever is selected, gives the new page those
    dimensions, and carries a copy of the selection onto it: the graphic gets
    a page that fits it rather than the other way round, and arrives on that
    page rather than being left behind on the old one. This copies rather than
    moves - the originals stay where they were - and the copies land at the
    new page's origin and become the selection, so the marks that were
    selected before the page turned are the marks selected after it. Greyed
    out with nothing selected.
  - **Default New Page** matches the page in view, which is what `+ Page` has
    always done and still does.
  - **Custom New Page…** opens Page Settings with **Sized page** already
    applied and the width field focused, so a size can be typed for a page
    that does not exist yet. The dialog's title reads *New Page* and its
    button reads *Add Page*; the page is only added when that button is
    pressed, so closing the dialog leaves no empty page behind.
- **Export can export just the selection, cut to its own dimensions.** The
  Export dropdown gained a **Selection** row that opens the same four formats
  (PNG, JPEG, SVG, PDF) in a panel beside it, and exports only the selected
  marks on a document sized to their bounds - no page-sized margin of empty
  space around the graphic. The bounds are grown by half the widest outline,
  because stroke bounds follow centerlines and a box drawn on them alone would
  slice the outer edge of the ink off.
  - **PNG and SVG come out transparent**, since a graphic cropped to its ink
    is one about to be dropped into a composition. JPEG and PDF keep the page
    background, having no usable transparency of their own.
  - **A lit layer row counts as a selection.** With nothing selected on the
    canvas but rows highlighted in the Layers panel, those layers and their
    descendants are what gets exported, so selecting a layer and exporting it
    is the same gesture either way round.
  - The SVG route offsets the viewBox rather than moving the marks, so every
    coordinate is the one a full-page export would have written.
- **Menus can hold nested entries.** The shared context menu grew submenus: a
  row carrying nested items shows a chevron and opens them in a panel beside
  itself on hover, on focus, or on a click, flipping to the row's left when a
  panel on the right would overrun the window.
- **Shift pins a drag to an axis or a 45-degree diagonal.** Held during a
  drag, it constrains the movement to the nearest of the eight compass
  directions.
  - **The axis comes from the pointer's own travel** since the drag began, and
    is re-chosen on every move, so swinging around the start point swaps the
    drag onto the line it now points down.
  - **The movement is projected onto that line** rather than having its
    off-axis component zeroed, so the thing being dragged keeps level with the
    pointer's component along the line instead of lagging at its perpendicular
    foot. Letting Shift go hands the drag back to the pointer, because the
    drag tracks where it actually put things rather than where the pointer is.
  - Applied to **moving a selection** (and so to the Alt-drag copy, which
    shares that path), to **Direct Select / Vector Path** drags of an anchor, a
    handle, or a whole path, and to the **Space + drag pan**. Drags where
    Shift already means something keep that meaning: the rubber-band marquee
    (add to selection), drawing (endpoint snap), the quick curve (swing the
    apex), and the shape tools.
  - The axes are a fixed table of unit vectors rather than `cos`/`sin` of a
    snapped angle, so a straight-across drag stays exactly straight instead of
    picking up the 6e-17 of vertical that `Math.cos(Math.PI / 2)` returns.
  - `constrainDrag` lives in `sharpen/geometry.ts` with the other pure
    geometry, and is covered by unit tests.
- **A Shift-press on an already-selected element no longer drops it before it
  can be dragged.** Shift-click has always toggled selection membership, which
  meant a Shift-press on a selected element removed it and returned without
  starting a drag - leaving nothing for the new constraint to act on, and
  making the most obvious gesture for it (Shift, then drag what is selected)
  do the opposite of what it looks like. The removal now waits for the
  release: a Shift-press that never moves is still a Shift-click, and one that
  moves is a constrained drag.
- **An Alt-drag copy says so in the pointer.** Holding Alt over a selection
  with the Select tool - and for as long as the copy is being dragged - swaps
  the arrow for two: the usual one at the hotspot, a second stepped out beside
  it in the inverse fill, and a node square beside them. The offset arrow sits
  clear to the right rather than laid over the first, because two arrows
  sharing a diagonal tangle into one thick smear. Alt is tracked for every
  tool now (it used to be read only by the Vector Path tool) and is re-read
  from each pointer event, so the pointer stays right even when the keypress
  landed in another window.
- **A button that drops a menu now toggles it.** Pressing Export, the pages
  panel's hamburger, or Close Shape a second time puts its menu away, and a
  third press brings it back. The button reads as pressed for as long as its
  menu is out, so it is clear which button the panel belongs to. The press
  that lands on the owning button is exempted from the outside-press dismissal
  that closes the menu, or that dismissal and the toggle would cancel each
  other out and the menu would never close.

### Fixed

- **The layers panel moved only one row of a multi-row selection.** Select
  several layers, press Move Up, and only the active one shifted. Every
  selected row moves now.
  - Each travels as a **block** - the layer plus everything nested under it -
    and moves among its **own siblings**, so a layer never leaks out of the
    group it lives in. (The old single-layer move swapped with whatever sat
    next in the flat stack, which could carry a layer across a group boundary
    without changing its parent.)
  - Blocks move destination-first, which keeps the selection's internal order
    and lets a block that has reached the end hold the ones behind it instead
    of letting them pile through.
  - **A selected group can be restacked now**, carrying its contents. It used
    to be refused outright ("Group rows cannot be restacked"), and the panel's
    move buttons greyed out whenever a group row was active. They now grey out
    only where the selection genuinely has nowhere to go.
- **The Alt-drag copy lost a graphic's groups when the selection came from the
  canvas.** Selecting a whole imported graphic with `Ctrl+A` or a rubber band
  and Alt-dragging produced a flat pile of `" - copy"` leaves scattered inside
  the original groups, with every nested group gone; the same drag started
  from the group's panel row kept the tree. The two now behave alike.
  - The copy decides what a group is from the marks, not from which rows
    happen to be lit: **a group joins the copy when every one of its
    mark-carrying layers is in the copy already**. That makes a rubber band
    around a whole graphic the same gesture as clicking the row above it, and
    it is the rule for `Ctrl+C`/`Ctrl+V`, `Ctrl+D`, and Alt-drag alike.
  - Alt-drag now runs through the same tree-rebuilding paste the clipboard
    uses, so its copies land as a sibling of the original with only the root
    suffixed. The suffix is `" - Copy"` everywhere now; Alt-drag used to spell
    it `" - copy"`.
- **Paste refused onto a group, calling it "locked or hidden".** Selecting an
  imported graphic by clicking its group row - the obvious way to grab the
  whole thing - made a group the active layer, and paste, duplicate, and
  placing an imported raster all read that as a layer they could not draw on.
  A group is neither locked nor hidden: it simply holds no marks itself, so a
  fresh layer now drops inside it and the operation carries on, which is what
  the drawing tools have always done in the same situation.
  - The check the drawing tools use is now shared rather than half-copied,
    so all four paths behave alike and the message says which of locked or
    hidden actually applies instead of naming both.
- **A nested menu panel could not be reached with the pointer.** Hovering
  Export > Selection opened the panel, but it vanished before the pointer got
  to it, which made the whole row unusable.
  - **Its own rows were dismissing it.** Both panels are built by the same
    routine, so every row in the nested panel carried the "a plain row was
    entered, put the nested panel away" handler that belongs only to rows in
    the *parent* menu. Entering the panel's first item therefore started its
    own dismissal. The panel element's `pointerenter` could not undo that: it
    fires once on the way in and never again as the pointer moves between the
    rows inside. Rows in a nested panel now cancel the dismissal instead of
    starting it.
  - **Dismissal waits a moment.** The nested panel is a separate element
    sitting beside the parent menu, so a pointer travelling toward it crosses
    rows it is not aiming at. Entering a parent row now schedules the close
    after a short grace period rather than closing outright, and reaching the
    panel cancels it. Resting on another row still puts the panel away.

### Changed

- **An imported SVG re-exports smaller than it arrived, instead of nearly
  double.** The exporter now writes path data at its shortest exact spelling,
  and the geometry is unchanged to the coordinate. Four reductions, none of
  which moves a curve:
  - **Absolute or relative, whichever is shorter, per command.** A repeated
    command letter is dropped, an axis-aligned line collapses onto `H`/`V`,
    and a cubic whose incoming handle mirrors the outgoing handle before it
    collapses onto `S` - the same curve in two numbers instead of four.
    Relative deltas are measured from the *rounded* current point, so a reader
    reconstructs the absolute coordinate exactly and nothing drifts along a
    long path.
  - **Numbers drop what nobody needs to read**: two decimals as before, but no
    trailing zeros, no leading zero on a fraction (`.5`, not `0.5`), and no
    separator where the next number already delimits itself.
  - **Shared paint is stated once, on the root element.** `fill="none"`, round
    caps and round joins, and whichever `stroke-width` most marks share ride
    on the `<svg>` and inherit; only the odd mark out names its own.
  - **Defaults go unwritten**: a fully opaque mark says nothing about
    `opacity`, and a width of 1 is what SVG already assumes.
  - Measured on the test fixtures and the vector-graphics skill's assets, a
    round trip lands between **0.27x and 1.05x** of the source, against
    **1.14x to 1.49x** before, and all 77 paths across those files parse back
    to byte-identical anchors and handles.
- **The importer reads the compacted spellings.** `parsePolylineD` and
  `parseVectorD` are built on the full path parser now instead of their own
  narrow regexes, so relative commands, `H`/`V` runs, reflected `S` handles,
  and elided command letters all read back the way absolute `M`/`L`/`C` did.
  Without this a napkin export would have re-imported through the sampling
  fallback and stopped round-tripping losslessly.
- **`Surface.render` can leave the paper off.** A new `transparent` option
  skips the background, the paper texture, and the sized-page outline, which
  is what lets a cropped raster export of a selection land on transparency.

## [4.0.0-alpha] - 2026-08-28

### Added

- **A generated frame can no longer be a copy of the frame before it.** The app
  collects the helper's output file the moment it appears, so a helper that
  copied the source to that path and only then began posing it had its copy
  taken and its work killed - and the frame that landed on the page was the
  previous frame over again, shifted right by the strip placement.
  - **A copy no longer ends the run.** When the output file turns up matching
    its source, the app keeps waiting and says so ("Helper saved a copy;
    waiting for the pose…"), which turns a copy-then-edit helper from a
    failure into a success.
  - **A copy is refused rather than imported.** If the helper exits having
    written nothing but the source over again, the run fails with that in
    words instead of putting a duplicate layer on the page.
  - The check reads path data **and** transforms together, because posing a
    frame leaves the path data untouched: a posed frame and a copy differ only
    by the transforms, so comparing geometry alone would call them the same.
  - The helper contract now says outright not to copy the source to the output
    path and edit it there.
- **Animation cycles are measured from the wireframe skeleton, not invented.**
  `character-wireframes.svg` is a rig: one stick-figure skeleton per frame,
  carrying the same assembly group names a drawn character does, with each
  limb a polyline that runs joint-first. `npm run wireframe-cycles` reads the
  angle of every limb in every frame and writes the step-by-step rotations the
  app poses frames with, so the numbers come off drawn poses instead of
  guesswork.
  - **It fixed a walk that swung the wrong way.** The hand-written table had
    the arms and legs rotating opposite to the drawn skeleton on every step -
    a walk whose limbs contradict each other, which is what made generated
    frames look wrong. The measured cycle also shows the drawing has no bob
    and asymmetric arms, neither of which the invented table had.
  - **Two more types became measured**: `knocked-down` from
    `Knockdown-Animation` and `ideal` from `Ideal_Stance-Animation`. They are
    no longer "work in progress" in the wizard, and the app hands the helper
    finished transforms for them the way it already did for `walk`.
  - **A repeated skeleton is not measurable.** `Punch-Animation` draws the
    same pose for its last two frames, so the step between them moves nothing
    and a frame generated from it copies its source. `attack` is offered from
    its written template instead until the punch gets a distinct last pose,
    the generator warns when a skeleton produces a still step, and a step that
    moves nothing is never handed over as finished transforms - the form falls
    back to the type's template rather than telling the helper to change
    nothing.
  - **Limb angles are read against the spine**, so a limb that moved only
    because the whole figure tipped reads as no joint rotation; the tipping is
    a new `figureRotate` applied to every assembly about the figure's base.
    That is most of what a knockdown is, and it is why the two do not
    double-count.
  - **A cycle that does not loop no longer closes.** Knockdown has seven
    skeletons and six steps: the wrap-around step that would snap the figure
    back upright is not generated for a type that runs start to end.
  - **The readings ship as an asset too**: `skeleton-cycles.json` beside the
    wireframes names which skeleton drives which type and lists every step, so
    an AI helper posing a type by hand can follow the same guide.
- **Every animation type is selectable**: all fourteen - ten character types
  and four object types - with everything except `walk` marked **(Work in
  Progress)** rather than held back as a disabled option.
  - **A prompt template per type** is what makes them usable before their
    cycle tables exist. Each type carries one sentence describing what a
    single step of that movement does - which joints turn, which way, how far
    - and whether the sequence loops, and the form hands that to the AI helper
    in place of exact angles. `walk` still runs off its measured eight-step
    cycle.
  - **One table drives both** the dropdown and the prompt, so an option can
    never appear without the template behind it: the wizard builds its lists
    from `ANIMATION_TYPES` at runtime instead of from hand-kept HTML.
  - **Object animations no longer ask for arms and legs.** Setup now runs
    before the assembly mapping, because the category decides whether the six
    character assemblies are needed at all; an object animation skips the
    mapping step entirely and moves the frame's root group. The banner says
    which animations the assemblies are for rather than reporting a blocker.
- **The `vector-graphics` skill is plugged into the helper prompt.** The form
  names it beside `svg-animations` and points at its installed copy, so a
  frame that needs real curve work rather than a joint rotation - the fracture
  lines of a `break`, the piece outlines of an `explode` - has somewhere to go.
- **Animation Mode installs and uninstalls separately.** It is the only
  feature that needs software the app does not ship - an agentic AI
  command-line tool, with its own installation, account, and usually cost - so
  it is no longer part of a default install. `npm install` adds nothing: no
  Edit-menu entry, no `Ctrl + Shift + N`, no banner, and no AI tool needed to
  run the app at all.
  - **One command adds or removes it**: `npm run animation-mode -- --install
    [--to claude|copilot|codex|gemini|…]`, `--uninstall`, and `--status`.
    Installing copies the helper's skills and instructions into that tool's
    dot-folder and writes `ai-helper/installed.json`; uninstalling removes
    exactly what it installed - anything else in that dot-folder is left
    alone - and deletes the record.
  - **One record decides**, so the feature is genuinely plugged in and out
    rather than hidden: the main process reads `ai-helper/installed.json`
    before the menu is built, and with no record the Edit entry, the
    accelerator, the keyboard shortcut, and every path into the wizard are
    all shut. A damaged record reads as "not installed", so a bad file costs
    the add-on rather than the app.
  - **Uninstalling keeps everything else intact**: sketching, layers, export,
    import, pages, and the rest are untouched.
- **A sign-in walkthrough for the AI tool.** The two ways a run can fail
  before any drawing starts - the tool is not on the PATH, or nobody has
  signed in to it - are now told apart and answered instead of being reported
  as a stalled run.
  - The tool's executable is checked before the run starts, so a missing tool
    names itself immediately.
  - A failed run is classified from its exit code and output, and an
    authentication failure opens a walkthrough naming the tool, with an
    **Open sign-in** button that starts that tool in a terminal of its own so
    it can run its own sign-in.
  - **No credential is ever read, requested, or stored by napkin-sketch.**
    The app starts the tool and steps out of the way; the install record names
    which tool was chosen and nothing about the account behind it.
  - The helper command's executable is resolved the same way whatever its
    shape (`claude`, `"C:\bin\claude.exe"`, `/usr/local/bin/codex`), so the
    right tool is named in dialogs and started for sign-in.
- **Animation Mode** (`Ctrl + Shift + N` or **Edit > Animation Mode**): a new
  app mode that turns a page's layer tree into frame-by-frame animation
  material with the help of an AI tool. Entering the mode switches to the
  Select tool, opens the Layers panel, and shows a banner that validates the
  page live against the six required character assemblies
  (`front-arm-assembly`, `body`, `front-leg-assembly`, `back-leg-assembly`,
  `back-arm-assembly`, `Head` - matched case-insensitively, editor
  uniqueness suffixes ignored). The mode is per-session and always starts off
  when the app opens; it only opens from the Edit menu or its shortcut.
  - **Generation wizard** behind the banner's **Generate…** button. Setup
    comes first, then - for character animations whose page does not already
    validate - a Cancel / Back / Next dialog per missing assembly asks which
    layers make it up and groups them under a group named for the assembly.
    Setup collects the animation category and type and names the frame the
    first run will draw. There is **no frame count**: a sequence is as long
    as the user keeps making it.
  - **One frame per run.** Each run hands the AI helper a single pose and asks
    for a single step of movement, which is small enough for a helper to
    finish. The drawn frame imports immediately as a group layer and the
    dialog offers **Redraw** (discard it and draw the same index again),
    **Keep and draw next** (that frame becomes the source for the one after
    it), and **Done**. The status line carries the helper's latest note, the
    elapsed time, and the frames kept so far.
  - **Frames stand side by side.** A drawn frame is a copy of its source with
    the assemblies turned, so left where it lands it would sit exactly on top
    of that source and hide the new pose entirely. Each frame is placed one
    gap to the right of the frame it came from (15 percent of the source's
    width, with an 8 px floor) and the view fits the page afterwards, so a
    sequence builds left to right as an animation strip and every frame can
    be seen before Keep or Redraw. Only the horizontal position moves - the
    cycle's vertical bob is part of the pose - and the placement shares the
    import's history step, so one undo takes the whole frame back off.
  - **Frame files are sprites.** The SVG kept in `animations/` is sized to the
    ink rather than to the napkin-sketch page, and carries no paper rect, so a
    frame drops into an animation composition as it stands - no page-sized
    margin of empty space around the drawing and no opaque rectangle behind
    it. The box is the frame's stroke bounds grown by half the widest stroke,
    so the outline is not shaved off, and it is reached by offsetting the
    document's `viewBox` rather than moving the geometry, so every coordinate
    still matches what the app holds. The app rewrites the file from the frame
    it imported, which makes the sizing exact whatever shape the AI helper
    happened to save.
  - **Frames are transforms, not redrawn documents.** An SVG group transform
    rotates every anchor and its Bezier handles together about a chosen
    pivot, which is exactly the rigid joint rotation a frame needs, and
    napkin-sketch resolves group transforms when it imports a frame. So the
    helper sets one `transform` per assembly rather than re-emitting 50 to 80
    KB of path data - one attribute instead of tens of thousands of output
    tokens.
  - **The app measures the pose.** Each assembly's joint pivot is taken from
    its own bounds (shoulder and hip at the top, neck at the bottom of the
    head; the body only bobs), and the form hands the helper finished
    `transform` values to copy character for character. Nothing about the
    geometry has to be worked out by an AI.
  - **A ready-made walk cycle.** Eight steps carry frame 0 through a stride
    and back: arms swing against the legs, the head counter-rotates, the
    figure bobs by 1.5 percent of its height, and every column sums to zero so
    the cycle closes and loops. Frame `n` uses step `((n - 1) mod 8) + 1`. A
    type with no cycle asks the helper to choose the angles with the same
    mechanics.
  - **AI helper integration**: the source frame is written to
    `_temp/animation-source.svg` for the helper to edit in place and a short
    form (under 3 KB, no geometry in it) to `_temp/animation-form.txt`, which
    is handed to a configurable shell command (default `claude -p --model
    sonnet --dangerously-skip-permissions < _temp/animation-form.txt` - a
    Sonnet-class model is pinned because setting six attributes in a file is
    mechanical work a mid-size model does quickly; any agentic CLI works -
    Copilot, Codex, a plain LLM tool). The finished frame is saved to the
    `animations/` folder (created if missing) as `<base>_<n>.svg`. The app
    watches for that file and **ends the run the moment a complete document
    appears**, instead of waiting for the helper process to exit - an agentic
    CLI keeps working and talking well past its last write, and that wait is
    what made runs look hung. There is **no overall time limit** - instead a
    stall guard kills a run with no frame and no output for 5 minutes, so it
    can never hang - and **Cancel** kills the helper's process tree
    immediately. A helper that prints its SVG instead of saving it still
    counts: the markup is taken from stdout when the run ends, saved to the
    path the form named, and imported like any other frame. The command is the
    new `animationHelperCommand` setting (a persisted copy of an outdated
    default upgrades itself on load), and the temp folder is cleared when the
    wizard ends. Every helper run is recorded in `logs/animation-helper.log`
    (the `animationLogFile` setting; folder auto-created, kept across temp
    cleanup): command, the frame it asked for, exit, duration, stderr, and the
    head of stdout - the place to look when frames do not arrive.
  - **Frame naming**: a source frame already carrying the animation type
    (`hero-walk_0`) continues its sequence (`hero-walk_1`, …); anything else
    starts `animationLayer-<type>_<n>`. The file stem, the root group's `id`,
    and its `data-name` are all the same string, and each generated frame
    mirrors its source's nested group structure.
  - **AI-tool support files**: a new `svg-animations` skill (SKILL.md with the
    joint-pivot and walk-cycle tables and the transform recipe, Bezier-curve
    and animation-essentials references, and wireframe pose assets) plus
    `animation-mode.instructions.md` defining the helper contract, including a
    worked example of the exact edit a frame requires. Both live canonically
    in the version-tracked `ai-helper/` folder; the
    `npm run ai-helper -- --to <claude|github|...>` script (also wired as an
    env-gated `postinstall`: `NAPKIN_AI_HELPER=claude npm install`) copies
    them into the gitignored dot-folder an AI tool reads, and every generated
    form names the skill and points the helper at both locations.
  - **`vector-graphics` skill**: a second, general-purpose skill installed
    beside `svg-animations`, covering how to draw a vector graphic from the
    Bezier formulas rather than by dragging control points. It is written for
    any project, not for this one: nothing in it assumes napkin-sketch or
    Animation Mode.
    - **References** for each degree - `linear-bezier-curve.md` (parametric
      versus implicit form, De Casteljau's base case, degree elevation),
      `quadratic-bezier-curve.md` (the spline, tangent-vector, and Bezier
      forms and the conversions between them; the method of splines),
      `cubic-bezier-curve.md` (Hermite conversion, coincident-point pull,
      tool paths, continuity grades, subdivision, and CSS easing) - each with
      mermaid diagrams, the SVG commands it maps to, and a worked example
      checked against the textbook derivation.
    - **`scripts/matlib-script.js`**, a dependency-free CLI and library that
      takes control points of any degree and emits evaluated points, the
      parametric polynomial equations, an SVG `d` string, or a complete SVG
      document. It solves control points from on-curve points (`--through`),
      splits and elevates curves, approximates a circle with four cubics, and
      reduces degree 4 and above to a cubic chain by flatness. It uses no
      imports, so it loads under both CommonJS and ESM projects on Node 18+.
      `scripts/template.md` is the procedure that drives it.
    - **Degree elevation** section in SKILL.md: the algorithm that raises a
      curve's degree without changing its shape
      ($Q_i = \frac{i}{n+1}P_{i-1} + (1 - \frac{i}{n+1})P_i$, endpoints kept),
      why it reads as cutting the corner at every original control point, and
      the fact that repeated elevation walks the control polyline onto the
      curve as a limiting position. Backed by the script's `--elevate` flag,
      which leaves the emitted path data byte-identical.
    - **Shared drawing assets** moved here from `svg-animations`
      (`shapes.svg`, `objects.svg`, `alphabet.svg`), since they are drawing
      material rather than animation material; the wireframe pose skeletons
      stay with `svg-animations`. Both skills now install side by side, so the
      cross-links between them resolve after install as they do in the
      repository.

### Changed

- **Default window opens maximized.** The GUI window used to open at its
  1280x860 default size; it now opens maximized. Maximized is deliberately not
  the same as full screen: it fills the screen while keeping the title bar's
  minimize, restore-down, and close buttons in view, and restore-down returns
  the window to 1280x860. `-f, --full-screen` still opens true full screen,
  where those buttons are not in view.

### Fixed

- **SVG import keeps the source geometry instead of sampling it.** Generic
  path data used to be walked with `getPointAtLength` into a polyline - one
  sample per unit of length - which at a sprite's scale (a 43-unit viewBox)
  turned every curve into a handful of straight facets, exported as a larger
  file than the source, and threw the Bézier structure away. The importer
  now parses path data itself (`M L H V C S Q T A Z`, absolute and relative,
  implicit repeats, Illustrator's packed numbers) into the cubic anchors the
  Vector Path tool edits: quadratics are degree-elevated to the identical
  cubic, arcs become quarter-turn cubic pieces with 4/3·tan(Δθ/4) handles,
  and `circle`, `ellipse`, `rect` (rounded corners included), `line`,
  `polyline`, and `polygon` are built from their attributes. Export then
  writes the same few control points the source held. A compound path stays
  one stroke: its contours are separate subpaths (a `move` marker on the
  first anchor and point of each later contour) so an outlined stroke's
  inner contour, a ring's hole, or a letter's counter fills as a hole on the
  canvas, in PDF, and in the exported `… Z M …` path data, instead of each
  contour becoming a solid shape that blacks out what sits beneath it. Data
  the parser cannot read falls back to length sampling.
- **Fill-only shapes no longer grow an outline on import.** A source shape
  with `fill` and no `stroke` was imported as a filled stroke painted with a
  1-unit outline in the fill color - half a unit of growth all round, which
  at small scales visibly fattened every shape and exported as
  `stroke="…"`. Such shapes now import with the outline switched off
  (`noStroke`) and export as `stroke="none"`, the SVG spelling of what the
  source said.
- **Export precision is two decimals**, up from one, so artwork authored in
  small user units round-trips without its coordinates being quantised to a
  tenth; `stroke-width` is formatted the same way, so an untransformed
  element no longer exports as `0.9999999999999999`. Computed `rgb(r, g, b)`
  colors are written back as `#rrggbb`. Import widths floor at 0.1 instead of
  0.5, so hairlines in small-unit artwork keep their proportion.
- **Grid import (`-m`) now scales and offsets vector anchors with their
  points**; previously only the sampled points moved, so a vector stroke's
  export would have drawn the curve where it was before placement.

## [3.3.0-alpha] - 2026-08-22

### Fixed

- **Closing a side panel now hands its space back to the canvas.** The
  pages, layers, and properties panels animate their width over 160 ms, but
  the canvas was resized on the next frame - mid-transition, when the stage
  still had (nearly) its old size - so closing a panel left the drawing
  surface sized as if the panel were still open. The canvas now resizes
  again when the width transition lands.

### Added

- **Close Shape**: a Sketch Support button that joins a selected stroke's
  two end points; pressing it offers **Sharp** (a straight bridge) or
  **Smooth** (a Catmull-Rom blend that continues each end's drawn
  direction through the seam). Strokes with Bezier anchor structure close
  through their anchor model - the seam stays Vector Path-editable and
  exports as a true closing segment, with a sharp close dropping the two
  end handles that would otherwise bend it - and already-closed, too-short,
  text, image, and eraser strokes are skipped.
- **Alt-drag copies the selection.** Holding `Alt` as a selection drag
  starts duplicates the selected elements and the drag moves the copies
  while the originals stay put. The duplicates land on new layer rows named
  `<layer name> - copy`; a copied group keeps its inner layer names, with
  only the group row taking the suffix. The copy and the move share one
  history step, so a single undo removes both.
- **`Delete` removes the selected layer rows.** Selected elements still
  delete first (their emptied layers prune away as before); with no element
  selected, `Delete` now removes the highlighted layer rows - the keyboard
  twin of the panel's Delete button, and the only way empty layers and
  groups could be deleted without the mouse.
- **Properties panel** (`Ctrl + P`, the View menu, or the toolbar's
  Properties button): a third right-hand dock that edits the selected
  element rather than the tool that drew it. Because selecting a layer row
  selects that layer's elements, it doubles as a layer property sheet - the
  stroke width of everything on a layer is now adjustable in one place.
  - **Position** - the X and Y of the selection's top-left corner, each with
    its own unit: `px` (default), `in`, `mm`, or `pt`. Conversions run
    through the CSS reference of 96 pixels per inch, the same ratio the SVG
    and PDF exports assume, so a value typed in millimetres reads back as
    the same millimetres.
  - **Appearance** - fill color, **No fill**, or a **gradient**, edited with
    the ramp-and-handles control gradient editors have settled on: drag a
    handle to move a stop, double-click the ramp to add one where you
    clicked, `+` / `−` to add and remove, and a Linear (with an angle
    slider) or Radial type. Stroke gains a width, a **Solid / Dashed /
    Dotted** style, and **No stroke** for a fill-only shape.
  - **Scale** - X and Y as a `%` factor (the default) or as an exact
    `px`/`in`/`mm`/`pt` size, with **uniform scaling** on by default.
    Scaling is anchored at the selection's top-left corner so the Position
    fields above hold steady, and line weight scales with the shape.
- **Gradient fills and dash styles are part of the document.** They save and
  load with a `.skbk`, and export as real SVG `<linearGradient>` /
  `<radialGradient>` paint servers and `stroke-dasharray` values so other
  editors render them, with napkin's own editable structure riding along in
  `data-` attributes for a lossless round trip. A fill-only shape exports as
  `stroke="none"` with its outline color and width kept aside.
- **`Ctrl + ]` and `Ctrl + [` restack the active layer** one step up or
  down, matching the Layers panel's move buttons. Both the shortcuts and the
  buttons now say why a move did not happen - a group row carries no paint
  order of its own, and the ends of the stack have nowhere to go - instead
  of failing silently.
- **`F2` renames the active layer.** Renaming used to be reachable only by
  double-clicking a layer's name label or by picking Rename from the layers
  panel's right-click menu, with nothing on the keyboard. `F2` - the rename
  key of file managers and vector editors alike - now opens the same inline
  edit on the active row. It opens the layers panel first when the panel is
  hidden, unfolds any collapsed group the layer is nested in, and scrolls the
  row into view, so the shortcut works from anywhere rather than only when
  the row already happens to be on screen.
- **Double-clicking anywhere on a layer row starts the rename**, not just the
  narrow name label. The visibility, lock, and group-caret buttons keep their
  own single-click jobs and are skipped, so a quick double toggle of an eye
  no longer has to dodge the rename.

### Changed

- **A gradient stop recolors on double-click.** Double-clicking a handle on
  the gradient ramp selects that stop and opens the color picker directly,
  alongside the existing drag-to-move and double-click-the-ramp-to-add
  gestures.
- **Joining strokes now leaves one element on one layer.** Every new element
  gets its own layer, so joining three strokes used to leave the merged
  stroke on the first one's layer and two empty rows behind it. The merge
  lands on the first stroke's layer and the layers the other pieces vacated
  are pruned with them, in the same history step. A layer that still holds
  other elements is left alone. The Join-on-snap setting consolidates the
  same way.
- **A focused text field now keeps its keystrokes.** The tool shortcuts,
  `Delete`, and the document's undo fired while a number or text field had
  focus, so typing a page width could switch tools or delete the selection.
  Text areas, selects, and text-like inputs now consume their own keys;
  sliders, checkboxes, and color wells, which consume no letters, still pass
  the shortcuts through.
- Both rename gestures open the input with the **current name already
  highlighted**, so a new name can be typed straight over it and an arrow key
  drops the caret into the old one instead of clearing it.
- The rename edit is now looked up by **layer id** rather than by holding on
  to the row element the gesture started from. Selecting a row redraws the
  whole panel, so the first click of a double-click could replace the very
  row the second click landed on; a rename already in flight now re-focuses
  its input instead of starting a second edit over the top of the first.
- A layer row's tooltip reads `(double-click or F2 to rename)`.

## [3.2.2-alpha] - 2026-08-17

### Fixed

- **Exported SVGs keep their layer names.** A layer's group used to be
  written out as `id="layer-0"` with the real name only in the private
  `data-name` attribute, so a napkin export opened in Inkscape or
  Illustrator arrived as a stack of anonymous groups. Each group now
  carries its name three ways: `data-name`, `inkscape:label` alongside
  `inkscape:groupmode="layer"`, and the `id` itself. Characters an XML id
  may not hold are escaped as `_xHH_` and repeated names take the `-2`,
  `-3`, … suffix editors expect - both of which the importer already
  undoes, so the names round-trip unchanged.
- **Page thumbnails are no longer blurry.** The pages-panel thumbnails were
  drawn into a fixed 150-pixel canvas and then stretched to the panel's
  width, so they were upscaled twice over on HiDPI displays. They now draw
  at the panel's actual width times the device pixel ratio, and redraw
  after the panel is resized.

### Changed

- The **eraser cursor is a dashed circle the size of the eraser**, matching
  the circle preview the drawing tools already carry, instead of the
  fixed-size `cell` pointer that gave no hint of what a stroke would clear.
- The **mandala symmetry guide fades in and out** over 220 ms when
  rotational symmetry is switched on or off, instead of the axes appearing
  and vanishing between frames. The axis count is held through a fade-out,
  so the guide dissolves as the shape it was.
- **`prefers-reduced-motion` now covers keyframe animations.** The
  reduced-motion rule only collapsed `transition-duration`, which left the
  360 ms page-turn animation (an `animation`, not a transition) running at
  full swing. Animations, delays, and `scroll-behavior` are now included,
  the page turn is switched off outright, and the renderer skips both the
  page-turn class and the symmetry fade when the OS asks for reduced
  motion.

## [3.2.1-alpha] - 2026-08-17

### Fixed

- **Exported SVGs are far smaller.** Importing an SVG samples its curves at
  one point per path unit, and every sample used to be written back out as
  its own `L` command — so a file that arrived at a few kilobytes could
  leave orders of magnitude larger without a single edit. Two changes close
  the gap while keeping the graphic intact:
  - Strokes that carry Bézier anchor structure (Vector Path, Curve, and
    quick-curve commits) now export as their **exact cubic Bézier
    segments** — a handful of `C` commands instead of hundreds of sampled
    points — which is both smaller and geometrically truer than the
    polyline it replaces.
  - Sampled polylines (freehand strokes, imported artwork, eraser masks,
    and the Copic chisel outline) shed the samples that sit within a tenth
    of a pixel of the line through their neighbours — below the file's own
    one-decimal coordinate precision, so nothing visible changes.
  - Coordinates drop the redundant trailing `.0` (`10` instead of `10.0`).

### Changed

- A vector stroke's **anchor structure now survives an SVG round-trip**:
  the importer rebuilds the editable anchors (handles, corner points, and
  closure) from napkin's exported cubic paths, so a re-imported Vector Path
  stroke opens for anchor editing exactly as it was drawn. Previously the
  structure was kept only in `.skbk` files and a re-imported stroke fell
  back to a plain freehand polyline.

## [3.2.0-alpha] - 2026-08-16

### Added

- **Panel context menus**: right-clicking the Layers panel offers Add,
  Group, Delete, Move Up/Down, and Hide Panel; right-clicking the Pages
  panel offers Add Page, Delete Page, Page Settings…, and Hide Panel — each
  menu carries the tools relative to its panel, styled to match the GUI.
- **Sized pages** (Page Settings, via the Pages panel's right-click menu):
  a page can now be `sized` — pinned to an exact width and height, shown
  with a dashed page outline — or left as the default `endless` page that
  fills the window. Switching back to endless re-enables window tracking
  and disables the dimension fields. The mode round-trips through `.skbk`
  files.
- **Resizable panels**: drag the layers panel's or the pages panel's inner
  edge to set its width (160–480 px).
- The layers panel's right-click menu also offers **Ungroup** (enabled on a
  group row) and **Rename**, which opens the same inline rename as
  double-clicking the layer's name.
- **Fit All in View** (View menu, `Ctrl+0`): zooms and pans so every
  graphic on the page is in view at once, replacing the stock Actual Size
  zoom reset that did not act on the drawing.
- **Panel state on the toolbar**: the Pages and Layers buttons fill in with
  the "Panel in View" treatment while their panel is open and sit flat
  ("Panel inactive") when it is hidden.
- **Export button in the top toolbar**, beside Import: drops down the same
  four formats as File > Export (PNG, JPEG, SVG, PDF), each opening the
  usual page/all-pages export dialog.
- **`npm run import-tree -- <file.svg>`** (dev tool): prints the layer tree
  an SVG would import as, running the real importer in a hidden Electron
  window — verify a file's imported layer names without opening the GUI.
- **`npm run todo`** (dev tool): archives every checked item in TODO.md —
  wrapped lines and nested sub-items move along with it — into a
  `## Complete` section kept at the bottom of the file, creating the
  section on first use. Each archived item gains a nested `From: <section>`
  line recording the roadmap section it came from; an item that already
  carries its own `From:` note (e.g. one pulled into Current from another
  section) keeps that origin instead. Re-running is a no-op.

### Changed

- The **layers panel opens by default**, and the **Select tool is active on
  startup** instead of the Pen.
- Top toolbar restyle: a **separator bar** now distinguishes the Pages and
  Layers toggles from the file actions, and the **Save** button uses the
  same background as its neighbours (bold label and strong border keep it
  prominent); the filled treatment it used to have now marks open panels.
- The layer group **collapse caret is drawn at 200%** of its former size
  for an easier target.
- **SVG import samples curves at one point per path unit** (previously one
  per two units, capped far lower), so imported artwork keeps the source
  file's smoothness instead of arriving with faceted outlines.
- A **named top-level wrapper group** in an imported SVG (e.g.
  `<g id="circles">` around the whole drawing) now imports as the top layer
  group under its name; previously it was flattened away and its name lost.
  Anonymous export wrappers are still descended as before.
- **Every unnamed imported element gets its own tag-named layer**: geometry
  without an `id` inside a group now imports as a layer named after its SVG
  tag (`path`, `line`, `rect`, …) instead of merging invisibly onto the
  group's layer, so each element in the source file has a row in the panel.
  Only napkin-sketch's own exported marks (`data-tool`) still merge, which
  keeps napkin's exports round-tripping as clean single layers. An SVG with
  no `<g>` elements at all imports as one top group **named after the
  file**, holding a tag-named layer per element, and a lone named top-level
  group keeps the author's name in grid (`-m`) imports rather than being
  renamed to the file.
- **Anonymous groups are never lost on import**: an unnamed `<g>` imports
  as a `<Group>` layer (nested ones included) instead of being flattened
  away or labeled `Layer N`, so the imported stack always mirrors the
  source document — named groups keep their names, unnamed ones read
  `<Group>`, loose geometry reads its tag name, and a group-less document
  arrives under the file's name.
- **Drawing on a selected group row now works**: instead of only warning
  that a group holds no marks, napkin-sketch adds a fresh layer inside the
  group, makes it active, and lands the stroke there — the toast names the
  created layer (locked or hidden groups still just warn).
- **Fill Color selects what you click**: with the Fill Color tool, a click
  anywhere within an element's dimensions — its interior or bounding box,
  not just near its outline — selects that element (highlighting it in the
  Layers panel) and fills it with the selected ink color. Clicking empty
  canvas still fills the current selection.
- **Select and Direct Select treat a filled shape's interior as the
  shape**: clicking anywhere on its painted fill selects it, where
  previously only clicks near the outline registered. Unfilled outlines
  stay click-through in the middle, so rubber-band selection over empty
  canvas is unaffected.
- **CLI import** (`-i, --import <file>`): launches the GUI with an SVG, PDF,
  PNG, or JPEG imported into the opening sketch, exactly as the
  File > Import menu item would place it — SVGs keep their layers, PDFs add
  their pages, and raster images land centered on the active layer. Missing
  files and unsupported types fail fast with a clear error before the window
  opens.
- **CLI multiple import** (`-m, --multiple-imports <file,file,…>`): imports a
  comma-separated list of files in one go, laid out in a grid. Each file's
  graphic size is measured against the page first, then the graphics fill a
  row left to right and wrap to a new row whenever the next one would overrun
  the page width; oversized graphics scale down to fit the page. Every
  imported file becomes its own named layer (multi-layer SVGs keep their
  layers grouped under the file's name, PDF pages arrive one layer per
  page). Quoted names with spaces and spaces after commas both parse.

## [3.1.0-alpha] - 2026-08-08

### Added

- Strokes committed by the Vector Path, Curve, and quick-curve tools carry
  their **Bézier anchor structure** in the `.skbk` file (an optional
  `vector` field with anchors and absolute-position handles), so paths stay
  editable across saves. Unknown or malformed data is dropped on load and
  the stroke still renders from its sampled points.
- **Vector Path edit mode**: with no path in progress, clicking a committed
  vector stroke opens it for anchor editing. A plain click on a segment adds
  an anchor there (de Casteljau split, shape preserved) and on an anchor
  removes it; `Ctrl` drags a single anchor, one of its handles, or the
  corner-rounding target; `Alt`-clicking an anchor toggles its handles
  (smooth point to corner and back). Every change resamples the stroke from
  its anchors, and `Esc` or an empty-canvas click puts the path down.
- **Corner rounding**: with `Ctrl` held, the selected anchor of an edited
  path shows a target icon inside its corner — dragging it rounds the corner
  into a circular fillet, clamped to half the shorter adjacent chord — and a
  **Radius** field in the top toolbar (visible while the Vector Path tool is
  active) applies an exact radius to the selected anchor.
- **Sharpen Selection** (toolbar button): smooths and simplifies the
  selected strokes, in the spirit of a vector editor's simplify command. A
  corner dialog with **Smooth** and **Simplify** sliders previews the result
  live on the canvas; Apply commits one undo step, Cancel or `Esc` restores
  the original geometry exactly.
- **Vector Path** tool (`B`, in the Sketch Support toolbar): an
  Illustrator-style pen. Click to place corner points joined by straight
  segments; click-drag to place a smooth point and pull out symmetric Bézier
  direction handles; the next segment previews live as a rubber band. Click
  the first point to close the path, `Enter` or double-click to finish it
  open, `Esc` to abandon. Paths commit as editable pen strokes with the
  current color, width, and opacity, are never auto-sharpened, and respect
  symmetry mode; Direct Select can rework the committed points.

### Changed

- The **Curve** tool now branches on pointer type: a mouse keeps the
  two-phase chord-and-bend flow, while pen and touch input — which cannot
  hover between clicks — draw with the quick curve's single-gesture quarter
  arc. The former stylus freehand mode is replaced by that flow.
- A finished **quick curve** is now exactly one cubic Bézier — two anchors
  and two control points (the circle-constant construction, deviation under
  a thousandth of the radius) — instead of an anchor per sample, so editing
  it shows four points rather than dozens. The mouse Curve tool's bend
  likewise commits its quadratic lifted to a cubic with two control points.
- **Direct Select** pans with `Space` + drag, matching the Select tool, and
  shows the same grab cursor while panning.
- Finishing a Vector Path is more forgiving: **switching tools accepts the
  pending path** — a tool shortcut (`S` for Select, `P` for Pen, …) or a
  toolbar click commits the curve as drawn, as does the window losing focus.
  `Enter`, double-click, and closing on the first point still work, and
  `Esc` remains the only way to abandon a path.
- Dragging a direction handle on a smooth anchor keeps the **opposite handle
  collinear** through the anchor (the smooth reflection H' = 2P − H, with
  each handle keeping its own length), so the curve bends smoothly instead
  of creasing into a cusp at the anchor.
- **Direct Select** edits Bézier-structured strokes through their anchors:
  a stroke from the Vector Path, Curve, or quick-curve tools shows its few
  anchor points (a quick curve shows two) with the selected anchor's
  curvature handles, instead of a square on every sample. Dragging an
  anchor carries its handles, dragging a handle bends the curve with the
  smooth collinear reflection, and whole-path moves (Direct Select or the
  Select tool) carry the anchor structure along so it never drifts from the
  drawn points. Freehand strokes keep the sampled-point editing and
  tangent-handle bend.
- Tool pointers follow the vector-editor convention: the Select tool shows a
  **black arrow** and Direct Select a **white arrow**. In Vector Path edit
  mode the pointer telegraphs the click: a **"−" badge** over an anchor
  (removable), a **"+" badge** over the path between anchors (insertable —
  `Ctrl`-clicking a bare segment now inserts too), the **black Select
  arrow** while `Ctrl` is held over anything grabbable, and a **stemless
  arrowhead** while `Alt` is held for handle toggling. Modifier presses
  restyle the pointer immediately, without waiting for the mouse to move.
- Quick curve (`Ctrl + Space` + drag) now draws a quarter ellipse in a single
  gesture instead of a chord you bend afterwards. The arc leaves the press
  point with a flat tangent and meets the pointer with an upright one, bowing
  through the far corner of the drag, and it reshapes live as the pointer
  moves; the release (mouse-up or touch-up) places its far end. Pen, touch,
  and mouse all take the same path, so the quick curve no longer borrows the
  Curve tool's bend phase or its stylus special case.
- Holding `Alt` during a quick curve makes the arc a quarter circle, with the
  shorter drag axis setting the radius (matching `Shift` on the Ellipse tool).
  `Alt` is tracked for as long as the drag runs, so pressing or releasing it
  mid-drag toggles between circle and ellipse.
- Each `Shift` press during a quick curve swings its apex — the bowed-out
  belly of the arc — a further 90 degrees clockwise. Both ends stay exactly
  where the drag put them, so the start remains anchored to whatever the
  curve was begun on and the far end remains under the pointer; only the side
  the curve bellies out to moves. Two presses mirror the sweep across its
  chord and four bring the apex back around; on an `Alt` quarter circle (or a
  square drag) the odd stops flatten the arc onto its chord, since a quarter
  arc pinned at both ends can only bow two ways. Key auto-repeat is ignored,
  so holding `Shift` parks the apex at one angle rather than spinning it.
- Because `Shift` now aims a quick curve's apex, the quick curve's far end no
  longer snaps to stroke endpoints; `Shift+Ctrl+Space` still snaps its
  **start** on pointer-down. Endpoint snap is untouched everywhere else.
- The quick straight line (`Space` + drag) locks **strictly horizontal or
  vertical** while `Shift` is held mid-drag — whichever axis the drag favours
  — and frees again the moment `Shift` is released, without waiting for the
  pointer to move. The line's end therefore no longer snaps to stroke
  endpoints (`Shift+Space` at press still snaps its start).
- Direct Select's lone-anchor handles are now real **tangent handles**:
  hollow tips on guide lines reaching a fixed screen distance out along the
  path each way, instead of the raw neighbour samples (which sit a pixel or
  two from the anchor on a dense stroke — too close to see or grab).
  Dragging a handle bends the stroke around the pinned anchor: the span
  between anchor and handle turns rigidly so the tip tracks the pointer, the
  bend eases smoothly into the untouched remainder, and pulling the handle
  longer or shorter stretches the span. Sparse strokes (a two-point line)
  swing rigidly, so the handles work on every stroke shape.

### Fixed

- `Ctrl` and `Alt` now work reliably in Vector Path edit mode. Holding
  `Ctrl` armed the Copic quick nib-rotate hold (its default hold key), which
  switched tools after a second and collapsed the edit; the hold no longer
  arms while the Vector Path tool is active. An `Alt` press could focus the
  native menu bar, blurring the canvas and dropping the edit before the
  click landed; `Alt` is consumed while the tool is active.
- Anchors, handles, and the rounding target were nearly impossible to click:
  the hit radius followed the Direct Select sensitivity (default 3 screen
  pixels). Vector-edit targets now use a radius of at least 8 screen pixels.

The Curve tool (`V`) is unchanged: drag a chord, bend, click to place.

## [3.0.1-alpha] - 2026-07-30

### Fixed

- SVG import now rebuilds nested layers the way the source editor shows them.
  Illustrator (and any editor that writes object names into `id`) exports a
  named object as a loose `<path id="outline">` beside its sibling groups;
  those paths were flattened onto their parent group's layer, so names such as
  `outline`, `glove`, `beard`, `teeth`, or `white`/`black` were lost and the
  marks jumped in front of or behind the groups they sat between. Named
  geometry now imports as its own layer, in its document position, at every
  nesting depth.
- Layer names imported from an `id` drop the `-2`, `-3`, … suffix editors add
  to keep XML ids unique, and undo `_xHH_` escaping, so rows read `strokes`,
  `outline`, and `arm` instead of `strokes-10`, `outline-5`, and `arm-2`. A
  trailing `-0` or `-1` is kept, and `data-name` / `inkscape:label` names are
  always taken verbatim.
- The ids Inkscape hands to unnamed elements (`path4521`, `g830`, `rect12`) no
  longer become layer names — a tag name followed by digits reads as unnamed,
  so Inkscape files import as layers rather than as a wall of ids. A layer the
  author actually called `text` or `line` keeps its name.
- A group that mixed loose marks with nested groups produced a child row
  carrying the parent's own name (`shirt-assembly > shirt-assembly`). Groups
  no longer duplicate their name; a group's own leftover marks land on a row
  named `<name> contents`.
- Unnamed geometry keeps its z-order relative to its named siblings: a run of
  adjacent unnamed elements imports as one `<Path>` layer in place, rather
  than being pooled onto the parent layer.

### Added

- `importSvg(text, { unnamedElements: 'split' })` gives every unnamed element
  its own `<Path>` layer, mirroring an Illustrator layers panel exactly. The
  default, `'merge'`, keeps unnamed marks as strokes on their group's layer so
  stroke-heavy artwork does not explode into hundreds of rows.

## [3.0.0-alpha] - 2026-07-12

### Added

- Endpoint snap: hold `Shift` while drawing with the pen, marker, or Copic
  marker to snap the stroke to the nearest endpoint of an existing stroke on a
  visible layer — the start point snaps on pen-down and the end point on
  pen-up, and straight lines (`Space` + drag) snap both ends live. A ring
  marks the endpoint in range. The snap sensitivity is measured in screen
  pixels (1-20px, default 10px) so zooming in gives finer control; the
  sensitivity and an on/off switch (on by default) live under "Quick
  Features" in the settings window.
- Join stroke (off by default, under "Quick Features"): when on, a stroke
  whose snapped start or end lands on another stroke's endpoint (same tool
  and color) merges with that stroke into one continuous stroke.
- Sketch Support toolbar section with new tools:
  - Join strokes (`Ctrl+J` or the Join button): merges two or more selected
    strokes end-to-end (nearest endpoints first) into one stroke.
  - Rectangle (`R`): drag to draw a rectangle; hold `Shift` for a uniform
    square. Commits as an editable pen stroke.
  - Ellipse (`L`): drag to draw an ellipse; hold `Shift` for a uniform
    circle.
  - Curve (`V`): drag a chord, release, move to bend the quadratic curve,
    then click to place it (`Esc` cancels). Also available as a quick
    feature: hold `Ctrl+Space` and drag with any drawing tool. Endpoint snap
    works in both quick modes — `Shift+Space` snaps straight lines and
    `Shift+Ctrl+Space` snaps curves.
  - Paint bucket (`G`): click inside an enclosed path or shape to fill it
    with the current ink color, added as a new selectable shape.
  - Eyedropper (`I`): click the canvas to pick the color under the pointer
    (averaged over the configurable "Select pixel sensitivity", 1-36px,
    default 10px); the pick becomes the ink color and fills the selected
    shape when one is selected. Hold `Ctrl` to temporarily switch to the
    Select tool and pick a shape; releasing `Ctrl` returns to the
    eyedropper.
- Fill Shape: with the Select tool active and a shape selected, clicking a
  quick-access color fills the selected closed shape with that color (open
  strokes and text are recolored instead).
- Filled shapes: strokes can now carry a `fill` color, honored by the
  canvas, thumbnails, SVG export/import (via `data-fill`), and PDF export.
  Fill-only shapes in imported SVGs now import filled instead of as thin
  outlines.
- Group Layers (`Ctrl+G` or the Group button in the Layers panel): wraps the
  active layer in a group; groups nest, and their visibility, lock, and
  opacity apply to every layer inside. `Ctrl+Shift+G` ungroups. Deleting a
  group deletes the layers inside it.
- Illustrator-style layer management in the Layers panel:
  - Every new drawn element (stroke, shape, text, image, bucket fill) gets
    its own layer, named after the tool (an empty active layer is reused);
    eraser strokes stay on the active layer so they keep cutting its content.
  - `Shift`-click selects multiple layer rows; the Delete button removes
    every selected layer together with its elements.
  - Selecting elements on the canvas highlights their layer rows, and
    selecting a layer row highlights its elements on the canvas (groups
    include everything nested inside them).
  - Group rows carry a disclosure caret to expand/collapse their nested
    layers.
  - Layer rows drag-and-drop to reposition in the stack or drop onto a group
    row to nest inside it (insertion edges and a drop-into outline preview
    the target).
  - Deleting an element deletes its layer once the layer is empty (and any
    group that empties with it); deleting a layer still deletes its
    elements.
- Direct Select tool (`A`, toolbar button): click an element to show its
  anchor points, then drag an anchor to reshape the stroke's path (undo
  restores the original shape; `Esc` drops the edit).
- Fill Color tool (toolbar button): fills the selected element(s) with the
  selected ink color, or the element under the click when nothing is
  selected (open strokes and text are recolored).
- Curve tool flyout: click and hold the Curve button to choose between the
  default "start and end at endpoints" variant and the "free ends" sibling,
  Illustrator-style; a corner marker on the button signals the flyout.
- SVG import keeps nested `<g>` groups as nested layer groups, so imported
  structure can expand/collapse and reorganize in the Layers panel.
- Alt + mouse-wheel zoom toward the pointer (scroll up zooms in, scroll down
  zooms out); the direction is configurable under "Pan & Zoom" in the Verbose
  Settings window ("Invert Alt + scroll-wheel zoom direction").
- Quick Zoom: press `Z` then a digit within the quick-feature timer to zoom to
  that level — `1`–`9` set 10%–90% and `0` sets 100% (centered on the canvas).
- Mouse-wheel pan: scroll the wheel to pan vertically and `Ctrl+Shift` +
  wheel to pan horizontally; the direction is configurable ("Invert
  scroll-wheel pan direction" under "Pan & Zoom").
- Select tool: hold `Space` and drag to pan the canvas (direction
  configurable via "Invert Select + Space drag pan direction").
- Select all: `Ctrl+A` selects every editable element on the page.
- Layer range select: `Ctrl/Cmd+Shift`-click a layer row to select every
  layer between it and the active layer, so a range can be grouped at once.
- Direct Select gains multi-anchor selection (`Shift`-click), draggable
  anchor-point handles, whole-path selection and move, and a configurable
  grab sensitivity (1–20px, default 3px, under "Sketch Support"). Selected
  anchors and paths render blue.
- Ungroup layers: `Ctrl+Shift+G` dissolves the active group (also available
  from the Layers panel).
- Deselect all: `Ctrl+Shift+A` clears the current selection.

### Changed

- **BREAKING**: the `.skbk` schema is now version 3 — layers may carry
  `group`/`parent` fields and strokes an optional `fill` color. Version 1
  and 2 files still open unchanged (saving re-writes them as version 3).
- Endpoint snap default sensitivity changed from 5px to 10px.
- Settings unified into two synced views: the in-app panel (`Ctrl+,`) is now
  "Quick Settings" and the settings window (`Ctrl+Alt+,`, Edit menu) is
  "Verbose Settings". The verbose window gained the Quick Settings section
  (live sharpen, wobble, smoothing, circle snap, taper, symmetry, text
  size), and both views edit the same persisted values.
- The Curve tool now snaps its chord's start and end to nearby stroke
  endpoints by default (the previous free-ends behavior remains available
  from the tool's click-and-hold flyout).
- The "Fill" toolbar tool is renamed "Paint Bucket" and carries the common
  paint-bucket icon; "Fill Color" is a separate new tool.
- The toolbar button that opens the in-app settings panel is labeled
  "Quick Settings", and the gear icon's hover text now reads "Verbose
  Settings".
- Toolbar rearrange mode now covers every tool in both toolbar groups and
  allows dragging tools between the groups, matching common vector-editor
  toolbar customization; the saved tool order persists across both groups.
- The Select tool supports `Shift`-click to add elements to (or remove them
  from) the current selection.

### Fixed

- Group (`Ctrl+G` / the Group button) now groups **every selected layer**
  into one group, not just the active layer, keeping their relative order
  and nesting.
- Curve tool with a stylus: a pen no longer produces a straight line. Because
  a stylus cannot hover between the tool's two clicks (select the chord, then
  move to bend), one pen gesture now draws the whole curve directly from the
  pen's path, so a curved pen stroke stays a curve.
- SVG import: documents whose content is wrapped in a single top-level group
  (as many editors export, often named after the file) now import each inner
  group as its own layer instead of one flattened layer; the wrapper's
  opacity carries into the imported layers.

## [2.1.0-alpha] - 2026-07-12

### Added

- Copic marker tool (`K`, toolbar button): simulates an alcohol-ink marker's
  flat broad nib. Strokes are thick across the nib and thin along it, the nib
  angle is stored per stroke (`nibAngle`, schema-compatible with version 2
  files), and the cursor previews the nib as a rotated bar. Copic strokes
  render as filled chisel outlines in the canvas, SVG export (with lossless
  round-trip via data attributes), and PDF export.
- Quick nib rotate: hold `Ctrl` for the configured hold time (1s by default)
  to show a rotation indicator in the bottom-right corner, then hold `Alt` to
  rotate the broad nib clockwise or `Shift` to rotate it counter-clockwise at
  the configured speed; releasing `Ctrl` ends the mode. On by default.
  Activating the mode switches to the Copic marker with the stroke width
  scaled by the configurable width multiplier (1-4x, default 2x, capped at
  the 40px maximum), remembering the tool and width in use; deactivating
  restores that last-used tool and width unless the user explicitly changed
  either while the mode was active.
- Settings window section "Copic Marker": quick-feature on/off, hold time
  (0.5-2s), hold key, both rotate keys (`ctrl`/`alt`/`shift`, kept distinct
  automatically), rotation speed (15-360 degrees per second), and the
  quick-rotate width multiplier (1-4x).
- Rotational symmetry (mandala mode) rotates the Copic nib angle with each
  mirrored copy so every arm shows the same thick/thin behaviour.

## [2.0.0-alpha] - 2026-07-10

### Added

- Layers: every page now has a layer stack with per-layer opacity, visibility,
  lock, rename, and up/down reordering, managed from a new Layers panel
  (`Ctrl+L`, View menu, or the toolbar button). Drawing, erasing, selection,
  and Sharpen All respect the active layer, and the eraser only cuts holes in
  its own layer. Layer opacity is honored by the canvas, thumbnails, and every
  export format.
- PDF export: File > Export > PDF Document writes a vector PDF with no added
  dependencies. "Export all pages" produces a single multi-page document;
  layer and stroke opacity are preserved, and text exports as real PDF text.
- Import (`Ctrl+I`, File > Import, or the toolbar button):
  - SVG files import as editable strokes with top-level groups becoming
    layers; napkin-sketch's own SVG exports round-trip losslessly (tools,
    paint order, and eraser masks are recovered from data attributes).
    Generic SVG shapes and beziers are sampled into freehand strokes.
  - PDF files import best-effort: each page's vector paths and text become a
    new sketch page (napkin-sketch's own PDF exports round-trip).
  - PNG/JPEG files import as movable, selectable image items placed on the
    active layer and scaled to fit the page.
- SVG export now wraps each layer in a named `<g>` group and renders eraser
  strokes as a black-on-white layer mask, so erasing no longer paints opaque
  background color over content beneath.
- Embeddable API: `NapkinSketch#toSVG()` and `#toPDF()`, plus new browser-safe
  exports `sketchesToPdf`, `importSvg`, `createLayer`, `layerOf`,
  `strokesOnLayer`, `isImageStroke`, and the `Layer` type.

### Changed

- **BREAKING**: the `.skbk` schema is now version 2 - each sketch carries a
  `layers` array and each stroke a `layer` id. Version 1 files still open:
  they are migrated in place by giving each page a single default layer (no
  action needed; saving re-writes the file as version 2).
- **BREAKING**: the `Sketch` type (public API) gained a required `layers`
  field, and `Tool` gained the `'image'` variant used by placed raster
  imports. Code constructing sketches via `createSketch()` is unaffected.

## [1.0.0-alpha] - 2026-06-28

### Added

- Pan and zoom: a two-finger gesture pans within +/-72px of the initial finger
  distance and zooms in or out beyond it, scaled by the configured
  sensitivities and an optional inverted-zoom direction.
- Straight line: hold `Space` and drag with a single pointer to draw a clean
  straight line, with a dashed preview shown until release.
- Quick Width: press `W` then type a number to set the current tool width once
  the quick-feature timer elapses.
- Quick Opacity: press `Q` then type a number to set the current tool opacity;
  `0` maps to 100% and `00` maps to 0.1%.
- Color change: press `C` to cycle the Quick Access Colors left to right (or
  `Shift+C` for right to left), wrapping around at the ends; the active color
  shows the same bold border as a mouse selection.
- Settings window (opened from the Edit menu or the gear icon) with zoom and pan
  sensitivity, inverted zoom, quick-feature timer (0.5-3s), Quick Access Color
  count (2-20) and editable colors, toolbar placement (top / side / both),
  rearrange mode with drag-and-drop tool and color ordering, color theme
  (light / dark / sepia), and an auto-save interval.
- Settings persistence: kept in memory across launches, exportable to a JSON
  file, and importable from one (the last loaded file is remembered).
- New `-f`, `--full-screen` CLI option to open the GUI window full screen.
- Per-stroke opacity in the data model, honored by the canvas, thumbnails, and
  SVG export.

## [0.0.0-alpha] - 2026-06-06

### Added

- Command-line interface (`napkin-sketch`) with `--help`, `--version`,
  `--book`, `--new`, and `--sharpen` options plus bare-path opening.
- Electron-based drawing GUI with pen, marker, and eraser tools.
- Pressure-aware, variable-width stroke rendering on a high-DPI canvas.
- Mouse, touchscreen, and stylus input via Pointer Events with coalesced
  sampling.
- Auto-sharpen engine: line / circle / polygon / freeform recognition, idealized
  shape rebuilding, and organic hand-drawn wobble with end taper.
- Live sharpen (per-stroke on pen-up) and "Sharpen all" (whole page) modes.
- Headless `--sharpen` pass that beautifies and re-saves a `.skbk` file.
- Multi-page sketch books with a portable, human-readable `.skbk` JSON format
  and atomic (write-then-rename) saves.
- Undo / redo history, clear, custom ink colors, and keyboard shortcuts.
- Select tool for moving and deleting existing strokes.
- Text tool with editable, resizable on-canvas text boxes.
- Sketchbook pages panel with thumbnail previews, page-turn animation, and
  add / delete / navigate controls.
- Native application menus: File (New, Open, Save, Save As, Export PNG, Export
  JPEG) and Edit (Undo, Redo).
- Image export to PNG (transparent paper) and JPEG (flattened background).
- Auto-sharpen settings panel exposing wobble, smoothing, circle snap, end
  taper, rotational symmetry (mandala mode), and text size. Live sharpen now
  defaults to **off**.
- Embeddable, browser-safe API (`NapkinSketch`) for websites, WordPress blocks,
  and VS Code webviews, shipped as both ESM and IIFE bundles.
- Generated application icon and electron-builder packaging (Windows NSIS
  installer with Start-menu and desktop shortcuts, plus macOS/Linux targets).
- Unit test suites (Node built-in runner) for geometry, the sharpen engine,
  `.skbk` serialization, CLI parsing, and the launch contract.
- Accessible, calm UI following a 60-30-10 cool/neutral palette with a single
  warm accent, WCAG-AA contrast, and reduced-motion support.

### Fixed

- Eraser now reveals the paper beneath strokes (two-layer compositing) instead
  of painting over them when Live sharpen is off.
- Saved file name is shown in the status bar and window title instead of always
  reading "unnamed".
- Added thumbnail-based page navigation so earlier pages can be revisited after
  adding a new page.
