---
name: vector-animations
description: 'Generate frame-by-frame SVG animation frames for the napkin-sketch Animation Mode. Use when asked to propose the next frame of a character or object animation (walk, ideal, run, attack, knockdown, rotate, break, move, explode), when processing an animation form from _temp/animation-form.txt, or when validating an SVG layer tree against the required character assemblies (front-arm-assembly, body, front-leg-assembly, back-leg-assembly, back-arm-assembly, Head). Covers Bezier curve mechanics, frame naming (<animationType>_<n>), pose interpolation for hand-drawn style sketches, and the physics of frame spacing - weight, timing, gravity, arcs, and bounce.'
---

# Vector Animations

Generate and validate frame-by-frame SVG animations for napkin-sketch's Animation Mode. The mode
treats one group layer per frame; this skill produces the next frame's group from an existing
frame so a character or object appears to move when the frames play in sequence. One request
draws one frame: the app calls again for the frame after it, handing over the frame just drawn.
A frame is produced by transforming the existing groups, not by redrawing them.

## When to Use This Skill

- An AI helper invocation arrives with form data from `_temp/animation-form.txt`
- Asked to propose or redraw the next frame of an animation sequence
- Asked to validate that an SVG's layers contain the required character assemblies
- Asked how frames, layers, or animation groups must be named

## Required Character Layers

A character frame must contain these six assemblies (names matched case-insensitively, ignoring
numeric suffixes an editor may append):

```text
front-arm-assembly
body
front-leg-assembly
back-leg-assembly
back-arm-assembly
Head
```

Each assembly nests part groups, which nest `strokes` (line work) and fill groups holding the
path items. A representative frame group:

```text
walk_0
  front-arm-assembly
    front-glove | front-hand   (strokes + glove|hand paths)
    front-arm                  (strokes + arm paths)
  Body                         (strokes + body paths, outlines)
  front-leg-assembly
    front-leg                  (strokes + leg paths)
    front-shoe | front-foot    (strokes + shoe|foot paths)
  back-leg-assembly
    back-leg                   (strokes + leg paths)
    back-shoe | back-foot      (strokes + shoe|foot paths)
  back-arm-assembly
    back-glove | back-hand     (strokes + glove|hand paths)
    back-arm                   (strokes + arm paths)
  Head                         (strokes, mouth, Eye, hair, Beard, face, neck)
```

Alternative names separated by `|` are equivalent (a character may have gloves or bare hands,
shoes or bare feet). Wireframe reference poses for walk, run, ideal stance, punch, and knockdown
cycles are in `assets/character-wireframes.svg`, and `assets/breaking-objects.svg` draws the
object side, where there are no assemblies and the separated pieces are the parts. Object
primitives, basic shapes, and letterforms live in the companion `vector-graphics` skill's
`assets/` folder, because they are drawing material rather than animation material.

## Frame Naming Rules

- Frames are numbered from `_0`: `walk_0`, `walk_1`, and on for as long as the sequence runs.
- A sequence has no fixed length: frames are drawn one at a time and the user stops when the
  cycle reads right, so never assume a last frame.
- If the source layer holding the required assemblies already carries the animation type in its
  name (for example `hero-walk_0`), name the drawn frame by matching that pattern with the next
  index (`hero-walk_1`).
- Otherwise name it `animationLayer-<animationType>_<n>` (for example `animationLayer-walk_1`).
- The file stem, the root group's `id`, and its `data-name` are all the same string. Everything
  nested inside keeps the names it already has.

## Frames Are Transforms

A frame moves the pose by setting one `transform` on each assembly group. It never redraws the
geometry, and there is no reason to: an SVG group transform rotates every anchor point *and its
Bezier handles* together about a pivot you choose, which is the rigid joint rotation a frame
needs. napkin-sketch resolves transforms when it imports a frame, so a transformed group and a
hand-redrawn one import identically - one costs an attribute, the other costs the whole document
in output tokens.

```xml
<!-- the front leg swings 16 degrees back about its hip, and the figure bobs down 2.1 -->
<g id="front-leg-assembly" data-name="front-leg-assembly"
   transform="translate(0 2.1) rotate(-16 152.4 61.8)">
```

Rules:

- One transform per assembly group. Replace what the group already carries; never stack a second
  rotation on top of an old one.
- Inside the group nothing changes: path data, stroke widths, fills, and classes are untouched.
- The bob (`translate`) goes on **every** assembly, turning or not, so the figure moves as one
  piece instead of coming apart at the joints.
- Angles are clockwise-positive, because SVG's y axis points down.

## Joint Pivots

An assembly's joint is the end it hangs from, taken from its own bounding box:

| Assembly | Joint | Pivot |
|----------|-------|-------|
| front-arm-assembly, back-arm-assembly | shoulder | top-center of the assembly's bounds |
| front-leg-assembly, back-leg-assembly | hip | top-center of the assembly's bounds |
| Head | neck | bottom-center of the head's bounds |
| Body | none | does not turn; carries the bob only |

A sketch has no rig, so this is deliberately rough - the top-center of an arm is its shoulder
closely enough for a hand-drawn cycle to read. napkin-sketch measures these bounds itself and
puts finished `transform` values in the form; work them out yourself only when the form asks you
to pose a type that has no ready-made cycle.

## The Skeleton Is the Guide

`assets/character-wireframes.svg` is not a picture to copy. It is a **rig**: one stick-figure
skeleton per frame, carrying the same assembly group names a drawn character does
(`front-arm-assembly`, `back-leg-assembly`, `Body`, and the rest). Each limb is a polyline that
runs joint-first, so the direction from its first point to its last **is** the angle that limb
hangs at in that frame.

That makes the asset measurable rather than merely illustrative. Reading the angle of every limb
in frame `n`, then in frame `n + 1`, gives the exact rotation each assembly needs to advance one
step - drawn by a person, not guessed at by a model. The character being animated is posed to
match the skeleton: same joints, same angles, different art.

```text
walk_0  front-arm polyline  68.95 52.5 -> 83.33 90.34   angle  69.2 degrees
walk_1  front-arm polyline 167.84 52.5 -> 188.59 87.26   angle  59.2 degrees
                                                  step = -10.0 degrees
```

Two rules make the reading correct:

- **Measure limbs against the spine.** The `Body` line is the figure's own upright. Take each limb
  angle minus the spine angle, so a limb that moved only because the whole figure tipped reads as
  no joint rotation at all.
- **The spine's own change is the figure tipping**, applied to every assembly about the figure's
  base rather than to one joint. A knockdown is mostly this.

napkin-sketch has already done this reading for the types the asset covers. `assets/skeleton-
cycles.json` holds the result - which skeleton drives which animation type, and the measured step
list for each - and the app puts those numbers straight into the form as finished transforms. A
type with no skeleton in the asset arrives with a written template instead, and is marked work in
progress in the wizard.

| Type | Skeleton in the asset | Frames | Loops |
|------|-----------------------|--------|-------|
| walk | `Walk-Animation` | 8 | yes |
| run | `Run-Animation` | 10 | yes |
| ideal (idle) | `Ideal_Stance-Animation` | 4 | yes |
| knocked-down | `Knockdown-Animation` | 7 | no |

`Ideal_Fight_Stance-Animation` is drawn in the asset but not yet mapped to a type, and
`Punch-Animation` is drawn but not measured: its last two skeletons are the same pose, so the
step between them moves nothing and the frame generated from it would copy its source. A
repeated skeleton is the one thing that stops an animation being measurable - give every frame a
distinct pose.

**To pose a type the asset does not cover**, draw or find the skeleton first and read it the same
way, rather than inventing angles. Numbers taken from a drawn pose hold together across a
sequence; numbers chosen frame by frame drift, and a walk whose arms swing the wrong way against
its legs is what that drift looks like.

## The Walk Cycle

Eight steps carry frame 0 through a full stride and back to its starting pose, **measured from
`Walk-Animation` in the wireframe asset**. Each row is the change from the previous frame, in
degrees; frame `n` uses row `((n - 1) mod 8) + 1`.

| Step | front-arm | back-arm | front-leg | back-leg |
|------|-----------|----------|-----------|----------|
| 1 | -10.0 | +21.1 | +12.3 | -13.5 |
| 2 | -24.1 | +40.7 | +15.8 | -9.0 |
| 3 | +18.1 | -21.9 | -8.5 | +4.5 |
| 4 | +31.0 | -0.3 | -20.2 | +7.6 |
| 5 | +18.3 | -21.0 | -8.7 | +31.2 |
| 6 | +12.4 | -35.4 | -13.1 | +11.4 |
| 7 | -16.9 | +10.4 | +9.1 | -13.4 |
| 8 | -28.9 | +6.4 | +13.3 | -18.9 |

Every column sums to zero across the eight steps, so the cycle closes and loops. **The front arm
swings against the front leg on every step** - that opposition is what makes a walk read, and
inverting it is the single most visible way to get a walk wrong.

Two things the drawn skeleton says that a guess would not:

- **The arms are not exact mirrors of each other.** The back arm swings further than the front
  through the middle of the stride. Hand-drawn poses are asymmetric, and the asymmetry is the
  life in them.
- **There is no bob.** The spine stays vertical and the neck stays at one height across all eight
  frames, so this walk does not rise and fall. A bob invented on top of it fights the drawing.

## The Run Cycle

Ten steps, **measured from `Run-Animation`**, and the same mechanics as the walk with more of
everything. Two columns the walk had no use for earn their place here: `figure` tips the whole
figure about its base, and `shiftY` moves it as a percent of its height, negative being up.

| Step | front-arm | back-arm | front-leg | back-leg | figure | shiftY |
|------|-----------|----------|-----------|----------|--------|--------|
| 1 | -26.1 | +43.1 | +12.3 | -13.5 | 0.0 | -1.1 |
| 2 | -48.2 | +18.7 | +4.1 | -36.8 | +14.0 | +2.1 |
| 3 | +20.0 | -17.4 | +24.4 | +35.0 | -14.0 | +1.2 |
| 4 | +27.6 | -28.5 | -9.2 | +18.7 | 0.0 | +0.5 |
| 5 | +31.8 | -33.1 | -40.9 | +28.0 | 0.0 | -1.3 |
| 6 | +41.3 | -30.1 | -26.8 | +6.9 | +9.3 | -1.2 |
| 7 | +13.3 | -18.9 | +24.9 | -4.8 | -9.3 | +0.9 |
| 8 | -15.4 | +16.3 | +29.4 | -32.9 | 0.0 | -0.7 |
| 9 | -31.1 | +31.3 | +7.8 | -26.4 | 0.0 | -0.2 |
| 10 | -13.2 | +18.6 | -26.0 | +25.9 | 0.0 | -0.2 |

Every column sums to zero, so the run closes and loops like the walk does. What the drawing says
that a scaled-up walk would not:

- **The legs swing twice as far.** The widest front-leg step is 40.9 degrees against the walk's
  20.2, and each leg travels around 80 degrees end to end where a walk's covers about 50. A run
  drawn with a walk's amplitude reads as a hurried walk, which is the usual failure.
- **The figure leaves the ground.** `shiftY` lifts it on the passing steps and sets it back down,
  where the walk's neck holds one height all the way round.
- **The lean comes and goes.** The spine tips forward 14 degrees into the drive and comes back
  the same 14 on the next step. A lean applied once and left there walks the figure onto its
  face after two repeats, which is why the sum of the `figure` column matters more than any
  single row in it.

## Object Animations

`assets/breaking-objects.svg` is the object counterpart of the skeleton, and it is drawn for the
two types that cannot be posed with a transform: something coming apart, and something bursting.
It holds two sequences, frame-numbered from `_0` the same way a character animation is. Read a
frame by its trailing `_<n>` and nothing else: the cloud's later frames are spelled
`Cloude_ImpactEffect_2` and on, and the index is what identifies a frame in any case.

| Sequence | Frames | What it draws | Type it guides |
|----------|--------|---------------|----------------|
| `Box_Breaking-Animation` | 3 | a box cracking and shedding pieces | `break` |
| `Cloud_ImpactEffect-Animation` | 5 | an impact cloud dispersing outward | `explode` |

Four group names carry the whole convention, and following them is what makes a sequence
readable frame to frame:

- **`base`** - what is left of the whole. It keeps its identity across every frame, shrinking as
  pieces leave it rather than being redrawn from nothing.
- **`stray-piece`** (or `stray-cloud`) - one group per piece that has separated. The `-2`, `-3`
  suffixes on them are the editor's uniquifier, not an index: they run on across the whole
  document, so `stray-piece-4` is simply the fourth one drawn, not the fourth piece of its
  frame. One piece is one group; pieces are never merged into a single "debris" layer, because
  each one travels and turns on its own.
- **`potential_stray-pieces`** - drawn on the intact frame, over the regions that will come away.
  This is the fracture plan: the break is decided while the object is still whole, so the pieces
  of frame 1 are the shapes frame 0 already promised.
- **`obsoletes`** - geometry the previous frame had and this one does not. Naming it is how a
  sequence says a piece has left the picture instead of quietly dropping it.

Two things follow from the drawing that a transform-minded reading would miss:

- **Piece count is not monotonic.** The impact cloud carries 3, 5, 4, then 4 strays across frames
  1 to 4, as puffs merge and disperse. Pieces are not a count to increment; they are what the
  drawing needs that frame.
- **A separated piece is new geometry, not a moved copy.** Its outline changes as it tumbles.
  Draw it with the `vector-graphics` skill, at the fewest control points that read, rather than
  translating the shape it broke off.

The full step lists for every measured type are in `assets/skeleton-cycles.json`. Types with no
skeleton in the asset have no table: pose them with the same mechanics, one readable step per
frame, and draw the skeleton first if you want them to hold together.

## Animation Physics

A cycle says what angle a joint takes. Physics says **how far apart two frames sit**, which is the
only dial a posed frame has and the one that decides whether a sequence reads as real. It matters
most for the types with no measured skeleton - jump, fall down, knocked down, break, explode,
move, and anything arriving as a study.

- **Even spacing is constant speed.** Growing gaps accelerate, shrinking gaps slow down.
- **Gravity spaces by the odd numbers.** From rest, successive frames cover 1, 3, 5, 7, 9 units,
  so a five-frame drop sits at 1, 4, 9, 16, 25 units down - never five even steps.
- **Arcs are even across and accelerating down**, which is what makes the path a parabola. Frames
  bunch at the apex, and that bunching is the hang time.
- **A bounce keeps `e^2` of its height** each time, and each arc needs fewer frames than the last.
- **Weight is frame count, not distance**: heavy things take several frames to start and stop,
  light things one, and overshoot where heavy things do not.

Full treatment, including what a real solver would do instead and why this skill does not:
`references/animation-physics.md`.

## Drawing the Next Frame

1. **Open the source**: `_temp/animation-source.svg`, the frame before the one you are drawing.
2. **Take the pose**: copy the transform values the form gives, character for character. Without
   a table, read the step from the cycle above (or judge it) and build the values from the
   assembly bounds.
3. **Set one transform per assembly group**, found by `data-name`. Replace, do not stack.
4. **Rename the root group** to the frame name on `id`, `data-name`, and `inkscape:label`.
5. **Save last** to the `animations/<name>.svg` path the form names, once, and reply with one
   short line. The app collects the file the moment it appears, so nothing after the save counts.

For playback and property guidance (visibility switching, timing, easing, reduced motion), see
`references/animation-essentials.md`; `references/bezier-curves.md` covers the curve math behind
the rotations if a frame ever does need geometry edited by hand. When a frame needs geometry
*drawn* rather than turned - a new prop, a shape a pose has no part for - load the
`vector-graphics` skill instead, which owns the curve formulas, the degree choice, and the
script that derives path data from control points.

## Animation Types

Every type below is offered by the app. Three run off cycles measured from the wireframe skeletons;
the rest are **work in progress**, and the form carries a template describing one step of that
movement instead of exact angles. Work from the template and judge the amounts from the source
pose - and draw a skeleton for it if you want it to hold together across a sequence.

| Category | Type | Status | Loops |
|----------|------|--------|-------|
| character | walk | measured skeleton | yes |
| character | ideal (idle) | measured skeleton | yes |
| character | run | template | yes |
| character | attack | template | no |
| character | damage | template | no |
| character | taunt | template | yes |
| character | talk | template | yes |
| character | jump | template | no |
| character | fall down | template | no |
| character | knocked down | measured skeleton | no |
| object | rotate | template | yes |
| object | break | template | no |
| object | move | template | no |
| object | explode | template | no |

A **looping** type comes back to its first pose, so the angles over a full sequence must sum to
zero. A type that does not loop runs from a start to an end - read the source pose to see how far
through that run you are, and do not wrap back to the beginning.

**Character** types move the six required assemblies about their joints. **Object** types have no
assemblies: the subject is the frame's root group, so a rotation, translation, or scale goes
there unless the movement needs the pieces handled separately.

`break` and `explode` are the two types that need real geometry rather than a transform - new
fracture lines, new piece outlines. Those belong to the companion `vector-graphics` skill, which
owns the curve formulas and the path-data script.

## References

- `references/bezier-curves.md`: curve math, handles, easing, frame-to-frame transforms
- `references/animation-essentials.md`: animation engines, properties, frame sequencing
- `references/animation-physics.md`: spacing as velocity, gravity by the odd-number rule, arcs
  and apex bunching, restitution, weight as frame count, and what physics simulation would mean

## Assets

Each asset says how far it can be trusted. A **rig** is named and structured, so it can be
measured and its names relied on. A **study** is a drawing to read, not a contract: its groups
are named however the artist happened to name them, and nothing should be derived from them
automatically.

**Rigs** - measure these, rely on the names:

- `assets/character-wireframes.svg`: the character rig - stick-figure skeletons for walk, run,
  ideal stance, ideal fighting stance, punch, and knockdown, one per frame, with the required
  assembly structure. This is what the measured cycles are read from.
- `assets/skeleton-cycles.json`: those readings, per type and per step, generated from the
  wireframes by `npm run wireframe-cycles`.

**Partly organized** - frame structure is reliable, the contents are working drawings:

- `assets/breaking-objects.svg`: the object rig - a box breaking (3 frames) and an impact cloud
  dispersing (5 frames), drawn as `base` plus one group per separated piece. Objects have no
  assemblies, so this is a naming and staging guide rather than a set of angles. Frame `_0` of
  both sequences also carries `potential_*` and `obsoletes` groups: pieces the artist was still
  deciding about. They are working scraps, not part of the frame - read the numbered frames and
  the `base`/`stray-*` groups, and leave those two alone.

**Studies** - read them for how a movement looks, do not derive from them:

- `assets/character-study-throwing-and-walking.svg`: a walk study with its `guides` (contact
  points and direction arrows) and numbered pose groups, beside a throwing character. Loose and
  generalised: it shows timing and weight rather than an assembly structure.
- `assets/bouncing-object.svg`: a bounce study - the arc as `object-path` with the object drawn
  along it. Loose and generalised, and the only reference here for an object that travels rather
  than comes apart.

### When a Study Is the Right Answer

The rigs cover the animations Animation Mode names. A study is what to reach for when the request
does not fit one: a pose the wireframes do not hold, an object that bounces or is thrown rather
than breaking, a movement asked for in words that no cycle table describes. In those cases read
the study for how the movement carries - where the weight goes, what leads, what trails - and
build the frame from that, rather than forcing the request onto a rig that was drawn for
something else.

Studies are also the fallback when a request arrives through the API or the app's AI helper
without going through the wizard at all, where there may be no animation type to look up.

## Companion Skill

Drawing material that is not specific to animation lives in the `vector-graphics` skill, which
sits beside this one and is installed alongside it:

- `../vector-graphics/assets/isometric-objects.svg` and `perspective-objects.svg`: a wheel, a
  sphere, and a cube drawn the same way twice, once in each projection - so an object animation
  can keep one projection across its frames
- `../vector-graphics/assets/shapes.svg`: squares, circles, ellipses, triangles, polygons, stars,
  lines at set angles, an arc, and a spiral
- `../vector-graphics/assets/alphabet.svg`: letterform paths for text-based animations
- `../vector-graphics/assets/male-character-elements.svg` and `female-character-elements.svg`:
  loose sheets of limbs, hands, heads, hair, and clothing. Studies rather than rigs, and the
  place to look when a character needs a part the wireframes do not draw
- `../vector-graphics/SKILL.md`: the curve formulas, degree choice, and path-data script to use
  when a frame needs new geometry drawn rather than an existing pose turned
