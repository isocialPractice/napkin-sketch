# Testing

Unit tests use Node's built-in test runner. The TypeScript sources are bundled
on the fly by esbuild, so no separate compile step is needed.

```bash
npm test
npm run test:graphic-design-api   # the design-language pipeline, end to end
```

Suites cover the geometry utilities, the auto-sharpen classifier and transforms,
`.skbk` serialization/normalization (including the version 1 → 2 layer
migration), the layer-aware SVG exporter, the PDF writer and its import
round-trip, the CLI argument parser, the launch contract, the animation cycle
and form helpers, the measurement units, the rotate transforms, the mirror rules
and the store's edit transaction, the stroke profiles - including a check that
the outline an export writes covers exactly the pixels the canvas paints, on
shapes chosen to break one - Mesh Warp's mesh, its as-rigid-as-possible solve and the
map that carries art onto it, the graphic-design API, and a regression suite pinning the defects earlier source
reviews found — so a fix that was hard to see cannot quietly come undone.

Two suites hold contracts rather than behaviour. `test/headless.test.ts`
installs a DOM that exists and throws on first touch, then runs every entry
point documented as DOM-free under it: the SVG, PDF and Illustrator script
writers, the `.skbk` round trip, the sharpen engine, the path-data parser, both composition
renderers, a napkin script run end to end with its shape library, and the
render calls writing a page to every format. A stray
`document.` fails there by name, where elsewhere it would pass because Node
has no document. `test/script-instructions.test.ts` holds the instruction
language's verb table to its types, field by field.

The language's own suites read scripts (`test/script-parse.test.ts`), run
expressions (`test/script-expr.test.ts`), and write scripts back and check them
as JSON (`test/script-format.test.ts`), including a round trip of every verb's
example. `test/script-evaluate.test.ts` runs scripts into sketch books and
checks the pages, the layer tree and each mark's anchors and paint, down to the
budget stopping a run and one script giving the same book twice.
`test/script-geometry.test.ts` holds the geometry to its rules: a circle's
handles, an arc against the importer's reading of the same SVG arc, a rounded
polygon's fillets, a curve through points, every library shape filling its
box, and the committed shape library matching its assets.
`test/script-rough.test.ts` holds the hand-drawn pass to its measurements:
drift within reach, smooth joins kept smooth, bows growing with the square
root of a segment's length, overshoot along the tangents, the fill drawn apart
from its line, and one script and seed giving the same drawing every run.
`test/script-text.test.ts` covers text and media: text items aligned on the
built-in face's measure, lettering drawn as marks, images sized from their
own headers, and documents copied in with `use`. The assets and documents
those examples name come from `test/helpers/script-fixtures.ts`.
`test/link.test.ts` covers linked files: the model keeps a link, the SVG
writers keep the reference, the rasterizer draws the file only through the
host's resolver and draws the placeholder otherwise, and a host reads only
inside the folder it names.
`test/sketch-composition.test.ts` covers the PNG's road from a sketch: each
kind of mark lowered into the composition model, the gradients, erase shapes
and one-picture groups the model gained for it, and, wherever `rsvg-convert`
is installed, the PNG against the SVG as `rsvg-convert` draws it, agreeing on
at least 99% of the ink of every fixture in `test/imports/`, which
`test/helpers/fixture-sketch.ts` reads with no DOM.
`test/script-render.test.ts` covers the render calls: every format from one
call, the ink box and its pad, a registration box every page shares, the
`.skbk` round trip, and the PDF's colors, outlines, dashes and text boxes.
`test/script-files.test.ts` covers `napkin-sketch/node` on a real file
system: scripts read from files, assets and documents loaded by name, links
read beside the script and refused outside it, a file a format and a file a
page, names that cannot leave the output folder, `strict`, and files written
whole. `test/api-surface.test.ts` holds both entries to lists: every name the
barrel exported before the language joined it is still there, and the
language and the Node calls are exported where the package map says.
`test/cli-draw.test.ts` runs the command line's `draw`, `check`, `render` and
`verbs` in memory - files, standard input, the JSON report, every exit code -
and then the built CLI as a process, with `electron` made impossible to load.
`test/cli-examples.test.ts` runs the callers in `docs/api/cli/examples/`
through `sh`, `cmd`, Node, Python and a C compiler, each where it is
installed.
`test/effects.test.ts` holds each effect to the pixels its matrix gives, to
SVG's order of a filter, a mask, a clip and an opacity, and to what
`rsvg-convert` draws from the SVG, and `test/script-effects.test.ts` holds
the `effect` verb to what it attaches to; `test/gui/check-effects.mjs` finds
them painted in the app, read back from napkin's own SVG, and drawn by the
composition canvas painter.
`test/illustrator.test.ts` runs each Illustrator script the writer makes
against a stand-in for Illustrator's scripting objects, which holds it to
Illustrator's rules - an item added goes on top, nothing is drawn on a hidden
or locked layer, an SVG will not place - and reads back the layer tree, the
anchors and handles, the paint, the text, the images and the links it built;
it also holds the script to ES3 and ASCII, and the interop page's excerpt to
the writer.
`test/ai-bridge.test.ts` holds the form a script helper reads, the script read
back from what it saved or printed, and the loop that sends a script with
errors back once, against a stand-in for the helper; `test/cli-draw.test.ts`
runs `draw --prompt` with a stand-in AI tool as a real process, through every
way it ends; and `test/ai-helper.test.ts` checks the `napkin-script` skill's
three scripts and the three registries.
`test/script-animation.test.ts` draws the figure in `test/imports/walk.svg`,
read with no DOM by `test/helpers/walk-figure.ts`, through the measured
cycles: eight pages sharing one box, each limb turned about the joint it has
in the source, a looping cycle closing on the source pose, the pacing and the
mirroring, and what cannot be drawn said as much; `test/cli-draw.test.ts`
runs `render --animate`, and `test/gui/check-measured-frames.mjs` presses
**Draw measured frames** in the app, draws the frames and undoes them.
`test/script-docs.test.ts` holds the pages under `docs/api/` and the three
hubs at the root to the code: every script on a page must read, every error
example must produce the codes it names, every JSON script must validate, and
every generated table must be current. `test/api-docs.test.ts` holds their
shape: every file `npm run api-docs` writes must be what it writes today,
every category has its three pages, each kind of page keeps its headings and
its length, every page links to its hub and its siblings in its first lines,
every link to a heading reaches one, and the object form's schema accepts
every verb's example and refuses what the object form refuses.
`test/api-engines.test.ts` runs every `js` block on the drawing engines'
pages against the barrel, as a reader would run it, and requires each
`console.log` to print what the `// →` line under it says.
`test/script-erase.test.ts` holds the script's `tool eraser` to the app's
Eraser: a line cut where it crosses, a filled shape with the swath taken out,
no mark of its own, other layers and later marks left alone, text passed over
with `erase-skipped`, and a wipe's marks cut before they are combined.

The menus are held to the menus they replaced. `test/menu-registry.test.ts`
writes out the File, Edit and View menus and the right-click lists as they
stood before 1.0.0-alpha.4.5.0, applies each deliberate change in a named
step, and requires what the registry generates to match exactly. It spells
out the whole menu bar, all nine menus, row for row, and holds the two menu
files to their own rules: every tool has a type a menu can place it by, every
shortcut is written one way and held by one tool. `test/chords.test.ts` covers
how a shortcut is read, shown and matched against a keypress on any layout,
and `test/menu-overrides.test.ts` the user's two files: what they may change,
what is refused with a sentence, and that the shipped files are never written.
`test/menu-dispatch.test.ts` holds each place a row becomes an action - the
native menu's clicks, the window's command table, the right-click items - to
the id the row carries, and `npm run gui-check -- context-menus` reads the
menu bar back from Electron and drives every right-click menu and dropdown in
the built app, down to Pages > Previous Page and Next Page greying at the
ends of the book and `PageUp` and `PageDown` turning the page. `test/keys.test.ts` sends every shipped shortcut through the
key lookup, with the rules the old key handler kept - Shift and a letter
still mean the letter when no shortcut uses the Shift form; a key a role row
holds is left to Electron - and `test/menu-docs.test.ts` holds the menus
table and the shortcut tables of the Menus and shortcuts page and the
cheatsheet to what `npm run menu-docs` writes. `npm run gui-check --
shortcuts` runs the app with a shortcuts file of its own, put in the
user-data folder it hands the app (`NAPKIN_USER_DATA`), and presses the
keys; it also clicks the toolbar's Transform button, which must show
`Ctrl+T` and stay pressed while the box is up. `test/config-dialog.test.ts` covers the configuration popup the menu
editors are built on: its search, its filters, what a shortcut cell says
about a chord, and edits held apart from the rows until Accept. `npm run
gui-check -- config-dialog` opens the popup in the built app with a spec of
its own, through a `window.napkinCheck` hook the page puts up only when the
app is started for a check (`NAPKIN_GUI_CHECK=1`, which `test/gui/cdp.mjs`
sets), then searches, filters, captures chords and accepts with real keys
and clicks. The same hook reads back what a pointer or a key left behind:
`inputState()` gives the pointer a press owns, every per-press field still
set, the held keys and the tool in hand; `strokeSummary()` and `layerRows()`
give the page's marks and layers; `selectionBoxes()` gives the dashed boxes
the canvas draws around the selection, which the canvas paints from the same
function; and `viewState()` gives the zoom, the pan and the zoom limits. A
check that drags on the canvas moves the pointer onto its starting point
before pressing, as a real mouse always has. `npm run gui-check --
held-keys` runs every sequence that once left the canvas holding a pointer
it no longer had - `Esc` or a lost window during a quick curve, `Ctrl` held
through a Select or a Text drag, a shortcut key mid-press, the capture
taken away, the window hidden - each in an app of its own, and after each
asks that no pointer is still owned and that a brush stroke still draws. The
same check holds the held keys to what they mean: `Space` pans on the Brush,
`Space` after a press makes a straight line and `Ctrl` with it the quick
curve, `Ctrl` lends the last selection tool but a `Ctrl` chord does not, a
still `Ctrl` turns the Copic nib and a moving one does not, and - with the
page's real focus, not an emulated one, so not in a background run - a bare
`Alt` hands the keyboard to the menu bar after five idle seconds, and not
after a key or a scroll.
`test/press-state.test.ts` holds the rules those rest on: how each kind of
press ends when its release is not what ends it, when a press left on
record is stale, and the work kept for the moment a press ends.
`test/held-keys.test.ts` and `test/alt-menu.test.ts` hold the held keys'
own rules, sequence by sequence.
`test/hit-test.test.ts` holds what a press picks: the ink each kind of mark
paints, the mark on top in the canvas's paint order, the nearest within a
reach in screen pixels, ink an eraser has cut away, and what a rubber band
takes. `npm run gui-check -- select-accuracy` clicks beside a line with the
Select sensitivity at 2 and at 12, moves a layer down and clicks where two
lines overlap, clicks in an eraser's cut, drags a rubber band across a
rectangle's edge, and drives Direct Select's reach, its drag threshold, a
rectangle's seam and `Shift` on a raw drag. For it the hook adds `hitAt()`,
the mark a Select click at a point would pick, and `directSelectState()`,
what Direct Select is editing; `strokeSummary()` gives where each mark
starts and ends. `test/zoom.test.ts` holds how far the canvas zooms, a
length on the screen measured on the page, the wheel's steps, and when a
mark or a layer reaches the view; `npm run gui-check -- zoom` zooms a
1 x 1 page-pixel mark with `Alt` + wheel until it fills the canvas's
shorter side, runs View > Zoom In and its keys and reads the window's own
zoom back, draws a brush arc at 400 times and finds it keeps its bow,
finds a blurred layer still painted at the deepest zoom, and a magnified
image's pixels crisp.
`test/fit-curve.test.ts` holds the curve fitter to its tolerance: an arc in a
few anchors, a corner kept, a straight run as a line, a stylus's pressure
carried, a loop closed smoothly however small, a polygon of few vertices
fitted without looping out between them, and Sharpen fitting what it
rebuilds; `npm run gui-check -- freehand` draws a curve of 200 moves and
counts its anchors, reads a 40% arc for one flat tone along its middle, and
sharpens a stroke into a few anchors.
`test/held-keys.test.ts` holds where a Shift-click line starts and when it
joins its mark, and `test/geometry.test.ts` the line added to a dot, a
polyline and a fitted curve; `npm run gui-check -- lines` clicks and
Shift-clicks a polyline and undoes it a line at a time, Shift-clicks at
another width, drags and presses `Space` on from a Shift-press, reads a
translucent mark for one tone while a line is drawn on it, snaps a straight
line's and a quick curve's end to a stroke's end, and holds a 40-degree
line to 45. For it the hook adds `strokeGeometry(id)`, a mark's points and
anchors, and `lineStart()`, where the next Shift-click line starts.
`test/boolean.test.ts` holds the region operations to exact areas - a hole,
a bite, a band cut through, shared edges and touching corners, a compound
shape under either fill rule, a soup of pieces, the corners a cut makes -
and an irregular cut to the true region at every one of 200,000 samples;
`test/erase.test.ts` holds erasing: each kind of mark, an eraser's region,
a line cut into subpaths of one mark clear of the cut by its painted half
width, a curve split on its own curve, a closed outline cut open through
its seam, a filled circle cut into two pieces of under a dozen anchors, a
square keeping a hole and its corners, a shape cut again and again keeping
its untouched anchors exactly, a Copic stroke turned into a filled shape,
and a cut mark written to SVG with no mask.
`test/wipe.test.ts` holds the wipes: each of the six operations on two
overlapping squares to exact areas and their corners, three circles in their
seven faces, their middle and their four odd pieces, each kind of mark as an
operand and the paint its result takes - an open line's ink a filled shape, a
closed outline kept an outline - a hole kept, a square wholly inside another
left a hole, a circle's anchors the wipe never reached kept exactly, and the
limits; `test/store-wipe.test.ts` a wipe applied to the page in one undo
step, each face on a layer of its own above its square's, looking as that
layer does, and the selection the result.
`test/store-erase.test.ts` holds an erase applied to the page: one undo
step, each cut mark changed where it was, a mark erased away gone with the
layer it leaves empty, an older file's eraser marks no content of their
own; `npm run gui-check -- eraser` erases two selected lines at once, with
a group selected, and with nothing selected, reads both lines cut on the
canvas with the press still down, and opens a file with an eraser mark of
the old kind - no box when selected - and applies it, pixel for pixel.
`npm run gui-check -- shape-eraser` opens the Shape Eraser's panel and
chooses from it by key, drags a rectangle over three selected lines of four
- the three cut, already with the press held, and the fourth not, one undo
for all three - cuts two lines with a closed rectangle and a closed Vector
Path on top with Top Path, and shows each notice, ticked away to a toast.
For it the hook adds `shapeEraserState()`: the shape in use, whether the
panel is open and what it offers, and the notice showing.
`npm run gui-check -- fill-stroke` reads the fill and stroke control and the
Sketch menu's two rows, puts the fill in front with `X`, steps it through the
Quick Access Colors and None with `C` and `Shift + C`, draws a filled
Rectangle, swaps the tool's colors with `Shift + X` and brings each box
forward with a click; then, with a rectangle and a line selected, a swatch
recolors both outlines with the stroke in front and fills the rectangle alone
with the fill in front, and `Shift + X` swaps its paints in one undo step.
`npm run gui-check -- color-picker` plays the picker's `input` and `change`
events with each in front, and undoes each drag in one step.
`test/paint.test.ts` holds the two rules mark by mark, and the store applying
them; `test/fill-stroke.test.ts` the keys' steps and the tool's swap.
`npm run gui-check -- wipe-stacks` opens `test/imports/wipe-squares.svg`, a
red square under an overlapping blue one, and runs each of the six Wipe
Stacks rows once from the Transform menu - the marks left, a pixel where only
the red lay, where both did and where only the blue did, and one undo back to
the two squares - then reads the rows greyed with one shape selected, in the
menu bar and on the canvas, and runs one of Wipe Out's rows from the canvas
menu's Wipe Stacks panel, where they are laid out in place. It runs Clean
Wipe on `wipe-circles.svg`'s three circles - seven marks, each on a layer of
its own, all selected - samples the napkin wipe while it runs, the page ahead
of it still showing what was there, then the result a quarter of a second
later, and stops it three ways: reduced motion emulated
(`Emulation.setEmulatedMedia`), Wipe animation off, and a press, which also
draws. Last, with a note selected beside the squares
(`wipe-squares-note.svg`), Wipe In leaves the note as it was and the toast
says it was passed over. For it the hook adds `wipeState()`: whether a wipe is under way, and
how far across. `test/script-wipe.test.ts` holds the `wipe` verb - each op
the engine's result on the same marks, anchor for anchor, the block keeping
its paint to itself, what it passes over or cannot do, and the budget - and
`test/scripts/wipe.napkin` is its golden; `test/menu-dispatch.test.ts` lays a
submenu inside a nested panel out in place.
`npm run gui-check -- shape-stacker` reads the Sketch menu's Shape Stacker
row and its button beside the Shape Eraser's, with the canvas keeping its
617.67 px, opens the panel - the six Wipe Stacks as tiles, greyed with
nothing selected, Escape closing it and `Shift + M` opening it again - and
runs Mid Wipe from a tile, one undo back. On `wipe-squares.svg` it shades
the piece under the pointer, merges a drag across the red square's own piece
and the overlap into the red square again (four corners, and the overlap
red), takes the overlap from both with an `Alt`-click, merges everything
with a `Shift` box, drops a drag with Escape - one undo each, the squares
selected again after it - gives the notice with one square selected, and
reads the cursor's plus and, with `Alt`, its minus. For it the hook adds
`shapeStackerState()`: the panel and its tiles, the pieces, the one under
the pointer and what a press has marked. The pieces and the stacking are
`test/wipe.test.ts`'s (which pieces a point, a path or a box picks; merge and
remove on two squares and on three circles; a circle's pieces merged back
into its four cubics exactly), the kept selection `test/store-wipe.test.ts`'s,
and the `stack` verb `test/script-stack.test.ts`'s, with
`test/scripts/stack.napkin` its golden.
`npm run gui-check -- split` reads the Sketch menu's Split row and its button
beside the Shape Stacker's, with the canvas keeping its height; takes Split
with `J` and reads the scissors cursor and the ring where a click would cut;
clicks a straight Brush line's end, which cuts nothing and says so, and its
middle, which gives two marks on two layers with every point where it was
and one more, the cut, both selected - one undo back; opens a Rectangle with
one click and divides it with a second, one undo each; and clicks text,
which says what Split cuts. For it the hook adds `splitState()`: the path a
click would cut, where, and how far along. The engine is
`test/split.test.ts`'s - a cubic cut at `t`, each half matching the original
at every parameter; a line; a Rectangle of bare points opened on a corner,
adding no anchor, and then divided; a closed curve opened on its closing
segment; a compound shape's ring; pressure; and the mark a click picks - and
the `split` verb `test/script-split.test.ts`'s.
`npm run gui-check -- pencil` reads the Sketch menu's Pencil row after
the Copic's, on `N`, and its button after the Copic's, the canvas keeping
its height; takes the Pencil up with `N`, no panel in the way, and opens
the kit with `N` again - seventeen chips, each drawing its lead, graphite HB
lit - closes it with Escape, opens it from the button and chooses 8B. It
draws a 2H line lighter than an 8B line, the 8B's tone varying far more than
a Brush line's; lays a second HB pass over a first, darker and still lighter
than HB's tone; redraws a page of 500 pencil circles within twice the time of
500 Brush circles (the plan's spike), a zoom drawing the pictures it has until
it holds still; and imports the page as Export SVG writes it, its Pencil marks
coming back with their pencils, while Chromium draws the same grain from it.
For it the hook adds `pencilState()` - the kit, its chips, the pencil in
hand and how many pictures have been worked out - and `renderTime(n)`, and
`strokeSummary()` gives each mark's `pencil`. The engine is
`test/pencil.test.ts`'s - the table in order, the kit, the names, the
tooth's pinned bytes, its even heights and seamless repeat, the coverage
rule, a mark's picture, a region of it matching the whole, the file, and the
SVG, PNG, PDF and Illustrator outputs - the verb `test/script-pencil.test.ts`'s,
and `test/scripts/pencil.napkin` is its golden.
`npm run gui-check -- smear` reads the Sketch menu's Smear row after the
Pencil's, on `Shift+N`, and its button after the Pencil's, the canvas
keeping its height; sizes the stump with Quick Width and sets its strength
with Quick Opacity; drags across 4B hatching, which it smears as it goes -
after it the spread of tones inside is down, tone reaches past the
hatching's old edge, the marks' boxes have grown and each keeps a pass, and
no mark or layer is added - one undo back; with one line selected, smears
that line alone; drags over Brush lines, which it leaves as they are,
saying so once; and imports the page as Export SVG wrote it, its marks
coming back with their passes. For it the hook adds `smearState()`, the
drag's points and the marks it has reached, and `strokeSummary()` gives
each mark's passes. The engine is `test/smudge.test.ts`'s - the darkness
kept, tone carried along the drag and past the line's edge, the grain filled
in, the same bytes every time and step by step, the pass a drag leaves on
the marks it reached, the box, the transforms and the file - and the verb's
and the outputs' `test/script-smear.test.ts`'s.
`npm run gui-check -- liquify` reads the Transform menu's Liquify row after
Mesh Warp, on `Shift+R`, and its button after Mesh Warp's, the canvas keeping
its height; opens its panel of four, Warp chosen, and chooses Twirl from it;
finds the brush's blue ring on the canvas's own pixels round the pointer,
following it, and sizes it with `]`, `[` and an `Alt`-drag that bends
nothing. Bloat held inside a circle's edge grows its box on that side alone,
one undo back, and `Escape` mid-press puts the circle back with no step
left; Twirl held over a short line turns its ends clockwise at their
distance; Warp dragged into a rectangle's side dents it, its corners staying
and a line far off left alone, one undo back; with the rectangle selected, a
line over it is left alone; and a pencil mark under the brush is left to the
Smear, which a toast says. For it the hook adds `liquifyState()`, the brush,
where it is drawn, the panel and a drag under way. The fields and the refit
are `test/liquify.test.ts`'s - Bloat out by the falloff and not at the rim,
Twirl keeping distances, Pucker and Bloat undoing each other, Warp carrying
its centre, a drawn rectangle bent as a path, the marks left alone, a Copic
nib turned, the refit within its tolerance with fewer anchors, and a dented
rectangle's straight parts kept dead straight - and the verbs'
`test/script-liquify.test.ts`'s.
`npm run gui-check -- clipping` imports a blue rectangle under a red circle
outline (`test/imports/clip-shapes.svg`), reads the Layers menu's Clipping
Mask rows, greyed with nothing selected, and makes the mask with `Ctrl+7`: a
Clip Group clipped by the circle, the circle's layer on top in it, the
group's and the clipping path's marks in the layers panel, paper where only
the rectangle lay, blue inside the circle and no red outline. A click
outside the circle picks nothing and one inside it the rectangle, the
selection is boxed by the circle, and `Ctrl+Alt+7` releases it and keeps
the group - one undo each. The page as Export SVG writes it, imported again,
is the same clip group showing the same; `test/imports/clip-open-top.svg`
gives the two notices and Release's toast; and another editor's clip,
`test/imports/clip-circle.svg`, comes in as a clip group. For it the hook's
`layerRows()` gives each row's `clip`, and `pageSvg()` the page as
Export SVG writes it. The engine is `test/clip.test.ts`'s - the plan, one
undo, the clipping path's layer moved to the top of the group, release, what
a clip shows and where, picking and boxing, a clip in a clip, and a `clip`
naming no closed mark dropped on load - the outputs
`test/clip-outputs.test.ts`'s (the SVG, with effects and without; the PDF;
the composition; the Illustrator script; an import's new ids), and the
`clip` verb `test/script-clip.test.ts`'s.
`npm run gui-check -- brush` reads the Brush's button - its label, name,
tooltip and drawn icon - and the menu bar's Brush and Vector Path rows with
`B` and `P`, presses both keys, and draws two strokes, the second landing
on a layer named Brush 1.
`test/notice.test.ts` holds the notices: shown unticked with OK focused,
Enter or Escape closing one without the window behind seeing the key,
ticked away to a toast for the session, and the focus handed back.
`test/vector-place.test.ts` holds where a Vector Path's next anchor, band
and pulled handle go under `Shift`, and when a press closes the path;
`npm run gui-check -- vector-path` Shift-clicks and pulls a handle at 40
degrees and finds 45, and hovers 3 and 20 pixels from a path's first
anchor for the close indicator, reading the canvas for its blue. For it
the hook adds `vectorPathState()`: the anchors placed, the band's end, and
whether a press would close the path.
`test/menu-editors.test.ts`
covers Edit Keyboard Shortcuts: the rows it lists, what a shortcut cell says
about a chord, how Accept takes a chord from the tool that held it, and what
that saves. `npm run gui-check -- shortcuts-dialog` starts the app on a
shortcuts file that is not JSON, then saves a shortcut, sees it take effect,
warns, refuses, resets to the defaults and cancels, reading the user's file
after each step. The same file covers Edit Tool Types, and
`test/menu-registry.test.ts` holds where
the editor says a type is listed to where the menus show a tool of that
type, for every tool. `npm run gui-check -- tool-types-dialog` moves Rotate
to the clipboard's type, finds it in the menu bar's Edit menu and the
layers panel's right-click menu, runs it from the canvas's, then resets
it, puts a toolbar tool in the Transform menu and cancels a change.

`npm run test:graphic-design-api` is the second one, and it measures a
different thing: not compositions but the road to them. It reads the reference
asset, generates a skill from it into the AI tool's real skills folder, points
that skill at the symlinked brand assets in
`test/graphic-design-api/test-assets/` through a `resources.md`, registers what
a bare request means, and draws graphics that carry them into
`test/graphic-design-api/generated-graphics/`. Every step is a production entry
point invoked as the documentation says to invoke it, so a pass means a clone
following [the AI helpers' quickstart](../../api/ai/QUICKSTART.md) works. It
needs a file system, a symlinked folder and a generated script, none of which a
bundled `node:test` suite can exercise honestly.

It also **leaves the tool wired up**, which is the point of running it rather
than only of passing it: afterwards `/graphic-design-api generate` draws, with
nothing to configure. The one thing it does that interactive use does not is
answer the overwrite prompt in advance - a script cannot be asked.

The graphic-design suite draws real files: it renders a reference composition
and several variations of it to both formats, writes them to `.tmp/`, and
deletes them on the way out, so a run leaves the working tree as it found it.
The one thing a graphics test cannot assert is whether the picture looks right,
so there is a flag for looking:

```bash
npm test -- --keep-graphics   # keep the generated SVGs and PNGs, and print where
```

The golden scripts are the suite a person rewrites on purpose. Each script in
`test/scripts/` is drawn to SVG and compared byte for byte with the file beside
it, twice in one process and once in a fresh one, so a change to what the
language draws fails until someone has looked at it and asked for it:

```bash
npm test -- --update-golden   # rewrite test/scripts/*.svg from what the scripts draw today
```

`test/scripts/every-verb.napkin` draws with every verb the language has, at
least once, on two pages, and `test/script-golden.test.ts` holds it to the
verb table, so a new verb fails the suite until it joins the script and its
goldens.

The script writer runs the other way and is held to the same bytes.
`test/script-writer.test.ts` writes every SVG fixture and every page of every
golden script as napkin script, draws that script back, and requires the same
SVG, byte for byte. It allows two differences: a filled shape the source
left open, which the writer closes, since a script fills only a closed path;
and a smeared pencil mark, which it writes unsmeared and says so, since a
script's smear passes over every pencil mark it reaches. A clipping mask is
written as a `clip` block and comes back clipped (`test/script-clip.test.ts`),
and an older file's eraser mark as `tool eraser`, which comes back as the cut
it paints, the same pixels but at the cut's edges.
The formatted text of the triangle fixture is kept in
`test/scripts/written/mirror-triangle.napkin`, which `--update-golden` also
rewrites, so a change in the writer's style is a change someone looked at.

`test/script-generate.test.ts` covers Automate > Generate Script with no
window: a file read as a page has the tree File > Import builds, since both
use one routine; a PDF's pages, written as a book, draw back as they were
read, the walking figure's to the same pixels; a picture's two scripts, the
link and the embedded one, run; and the selected layers are written with the
groups above them, on the page kept or fitted. `npm run gui-check --
generate-script` picks two parts of an imported figure in the Layers panel,
writes them, fits the page and opens it, then writes an SVG and a PNG from
their files, embeds, copies, and closes the dialog with Escape and Cancel.

`test/history-diff.test.ts` covers what Track History records of a step,
on pages built by hand: marks added, removed and changed, the paint order,
and each thing that can happen to a layer row. `test/history-tracker.test.ts`
drives the store's history hook - a drag is one step, a transaction is one
on commit and none on rollback, undo and redo are steps of their own, a page
change closes the step on its page, a new book starts again - then the names
a step is given from the real menu files, and the limit. `npm run gui-check
-- track-history` turns tracking on from the menu bar, draws two strokes
with real pointer events, rotates one, undoes, reads the four steps back,
and uses the Automate section of Verbose Settings, in its own window, to set
the limit and turn tracking off. `test/history-script.test.ts` records
sessions through the store and plays them back with steps left out: every
step ticked draws the page as it is, a removal left out brings its mark
back, an addition left out drops its mark and the changes to it, and a
change left out takes back only what it changed. `npm run gui-check --
history-script` draws two strokes, turns one, unticks the turn in the
popup, and opens the page each script draws.

`test/site.test.ts` holds the documentation site to its sources: every page
is what `npm run site` writes today; the top bar, menu and footer are one
copy on every page once each link is read from its page's folder; every
relative link reaches a file the site publishes and every `#anchor` a
heading; the stylesheet's colors are those in `DESIGN_LANGUAGE.md`; and the
Markdown converter renders what the pages use as GitHub does. It also runs
the napkin examples in `docs/site-src/`. `test/docs-window.test.ts` covers
the documentation window's decisions with no Electron: where the pages are
read from, which names reach a page, what a Help row does when they are
missing, where a link in them may go, and its keys. `npm run gui-check --
help-menu` opens **Help > Verbose**, follows a page link, goes back and
forward with Alt and the arrows, sends a web link to the browser, shows each
Tool Types quickstart in the same window, and closes it with Ctrl+W.

`npm run pack-check` is the install, checked: it packs the package, installs
the tarball into an empty folder - where no Electron arrives, since it is a
development dependency - and draws from it with `napkin-sketch draw -` and
with both entries imported by name; then it draws a script of the verbs that
run the drawing engines - wipe, stack, split, clip, the eraser, the Pencil, the
Smear and Liquify - and calls fifteen of the engines by name from the
installed package. Build and emit the types first; it packs what `dist/`
holds. `npm run test:graphic-design-api` asks the same built API a few of
the engines' questions after its graphics.

Some defects can only be seen in the running app: the SVG importer needs a
DOM, the color picker is a native popup, and a paint that went missing shows up
only as pixels. `npm run gui-check` drives the built app for those. It
launches Electron with the DevTools protocol open, runs each `check-*.mjs` in
`test/gui/` in turn, and asserts on what the page shows (canvas pixels, the
toast, the layer rows) rather than on the code behind it:

```bash
npm run build                    # the checks drive dist/, so build first
npm run gui-check                # every check, one app launch each
npm run gui-check -- gradient    # only the checks whose names match
npm run gui-check -- --background   # every check, off the screen
```

A check opens a new, unsaved sketch with a fixture from `test/imports/`
imported, or a book it writes to a temporary folder, so it leaves the working
tree as it found it. The measured-frames check needs Animation Mode installed
and says so when it is not; it saves its frames to `animations/` under names
no one else's frames have, and removes them after. The window appears on
screen, maximized and with the focus, while a check runs - unless the checks
run in the background.

`--background` runs them while the computer is in use. Every window the app
opens - the drawing window, Settings and the documentation window - is shown
without the focus, past the left edge of every screen and out of the
taskbar, so neither the mouse nor the keyboard reaches it, and it keeps
drawing there. Each page is told it has the focus, and the drawing window's
page is pinned over the DevTools protocol to 1494 by 837 CSS pixels at a
pixel scale of 1.5: what the maximized window gives on the 2240 by 1400
screen the checks' numbers were measured on, so they hold on any screen.
`NAPKIN_GUI_SIZE=1494x837` and `NAPKIN_GUI_SCALE=1.5` change the two. The
three held-keys sequences that watch a bare `Alt` hand the real focus to the
menu bar cannot run without it; they print `SKIP`, the summary counts them,
and `npm run gui-check -- held-keys` runs them in front. The checks still
share the processor: a heavy job running beside them can still slow one that
times itself.

Each launch gets a user-data folder of its own, made for it and removed after
it, so a check starts from the default settings and leaves none behind - the
app run from the checkout by hand keeps its own in `%APPDATA%/Electron`, and
a check never touches it. A check that needs a file there first, such as a
`shortcuts.json`, makes the folder itself and passes it. The app is launched
with Chromium's occlusion tracking off, so a check window that opens behind
another still draws, and a link a check sends to the browser is recorded
rather than opened. One check runs alone with `node --experimental-websocket
test/gui/check-<name>.mjs`, which Node 21 needs for `WebSocket`.
