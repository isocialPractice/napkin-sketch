---
name: vector-animations
description: 'Generate frame-by-frame SVG animation frames for the napkin-sketch Animation Mode. Use when asked to propose the next frame of a character or object animation (walk, ideal, run, attack, knockdown, rotate, break, move, explode), when processing an animation form from _temp/animation-form.txt, or when validating an SVG layer tree against the required character assemblies (front-arm-assembly, body, front-leg-assembly, back-leg-assembly, back-arm-assembly, Head). Covers reading an SVG as a picture before trusting its layer names, identifying an arm, a head or the hair from measured geometry when layers are named badly or not at all, posing from the subject's current position, how far each part of a figure travels between drawn frames, reordering layers so the new pose reads at the right depth, Bezier curve mechanics, frame naming (<animationType>_<n>), and the physics of frame spacing - weight, timing, gravity, arcs, and bounce.'
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

## Read the Drawing Before the Names

**Work like an image generator, not like a transform applier.** The job is to produce the next
picture in a sequence. The layer tree is how that picture is stored, not what the job is about,
and a frame that satisfies every naming rule while looking wrong has failed.

A real document is not the rig. Before touching a frame, look at what the SVG **draws** - open it,
see the picture, and work out what the figure is and which way it faces. The layer names are a
hint about that picture, not a description of it, and on a hand-drawn document they will not be
the names below - they may not be names at all.

The pose that comes next follows from **where the subject is now**, not from how some asset
demonstrated the movement once. Read the current position first: which foot carries the weight,
how far through the stride this is, which way the body leans. The cycle tables and the studies
inform that reading; they do not replace it.

Work in this order, and let each step correct the one before it:

1. **See the image.** What is drawn, from what angle, and what is the subject doing in this frame?
   A side-view walk, a three-quarter turn, and a figure seen from behind all need different
   answers, and only the picture says which one this is.
2. **Read the layer names against the image.** Names are evidence, not instruction. A group called
   `front-arm-assembly` should hold the arm nearer the viewer; check that it does before trusting
   it.
3. **Map every layer to a part**, including the ones the rig does not name, and including the
   ones with no useful name at all - the form's measured inventory is there for exactly that.
4. **Pose the frame** from where the subject is now, moving each part with whatever it belongs to.
5. **Re-check depth against the new pose.** A part that moved may now be in front of, or behind,
   something it was not. Reorder the layers where it did.
6. **Look at the result as a picture.** If it does not read as the next frame of that movement,
   the naming being correct does not save it.

### Names Will Not Match the Rig

The six assemblies are what this skill calls the parts. An artist naming layers by hand calls them
something close but not equal, and an editor adds its own uniquifiers on top - sometimes in the
middle of a name rather than at the end. All of these come from one real document:

| Drawn as | Means | Why it is not obvious |
|----------|-------|-----------------------|
| `head-assembly` | `head` | the artist grouped the head like a limb |
| `body-3`, `shirt-2` | `body`, `shirt` | editor uniquifier at the end |
| `BadGirl_walk_2-2` | frame `2`, second copy | uniquifier lands *after* the frame index, so the name no longer parses as `<base>_<n>` |
| `BadGirl` | a frame with no index at all | the first frame was never numbered |

Match on **meaning**, not on string equality. If a name is ambiguous, the drawing decides: the
group whose geometry is a head is the head, whatever it is called.

The illustrated assets are a larger sample of the same problem - six characters' worth of layer
names, none of them written for this skill:

| Drawn as | In | What it is |
|----------|-----|------------|
| `upperarm` and `forearm` as siblings | BadGirl | a front arm with no `front-arm-assembly` around it |
| `dress` | SassyGirl | the torso; she has no `body` layer at all |
| `upper-body` | CrimeGuy | head, torso and both arms, in one layer |
| `left-vest`, `right-vest` | JammingJabber | clothing, not body parts |
| `jacket-keft` | SassyGirl | `jacket-left`, mistyped and left that way |
| `back-shoe` and `back-leg` as siblings | JammingJabber | a leg and its foot, not nested in an assembly |
| `head-63`, `hair-32` | BadGirl | uniquifiers in the sixties; the number means nothing |
| no child groups at all | `JumpingJunkie_defeat` | a whole frame of loose paths, nothing grouped |

The last two rows are the ones to be ready for. **The same character can be built differently in
different frames**: CrimeGuy is `back-leg-assembly`, `front-leg-assembly`, `upper-body` in one
frame, and `back-arm`, `back-leg-assembly`, `front-leg-assembly`, `body`, `Head`, `front-arm` in
another. Work the parts out from the frame in front of you every time. A map built from the
previous frame may not fit this one.

### When the Layers Are Not Named At All

A drawing that came out of an illustration tool may name nothing: `g830`, `path4521`, ids the
editor invented because the artist never typed a name. There is still enough to work from,
because **where a part sits identifies it**.

The form carries a measured inventory of every layer, as fractions of the figure's own box - 0 is
its left or top edge, 1 its right or bottom - together with the paint order. Read parts off it:

| Part | What it looks like in the measurements |
|------|----------------------------------------|
| head | a box across the top, roughly `y 0.00-0.20`, centred on the figure's middle |
| hair | overlaps the head's box, usually wider than it, painted just before or after it |
| torso | the widest box in the middle band, `y 0.15-0.60`, and most other parts touch it |
| arms | a mirrored pair starting at the top of the torso, narrow and tall |
| legs | a mirrored pair from the bottom of the torso to the foot of the figure |
| hand, foot | a small box at the far end of a limb's box, often a separate layer |
| clothing | a box that spans several parts at once, or covers the torso and hips together |

Three rules do most of the work:

- **A mirrored pair is a pair of limbs.** Two boxes of similar size and height band, sitting
  either side of the figure's middle, are the two arms or the two legs. Which is which is decided
  by paint order: the one painted later is nearer the viewer, so it is the front one.
- **Containment means belonging.** A box that sits inside another part's box, and moves with it
  between frames, belongs to that part - a glove to its arm, a shoe to its leg, a face to a head.
- **A box that spans parts is clothing.** It moves with what it hangs on rather than being posed
  on its own.

Say what you concluded before drawing: "the top group is the head, the pair at
`y 0.58-1.00` are the legs, the later-painted one is the front leg". A wrong reading is easier to
spot in a sentence than in a frame.

### Paint Order Is Part of the Pose

The order assemblies are drawn in is depth. It is not fixed for the sequence - it is a decision
per frame, and it is how a flat drawing shows one limb passing in front of another.

In a walk, the legs cross near the middle of the stride. Up to that point the near leg is painted
last; after it, the far leg is. A sequence that keeps one order throughout has legs that swap
depth without ever passing each other, and the walk reads flat - a figure sliding rather than
striding.

**Decide the order from the pose you just drew, not from the pose you started with.** After
working out the new angles, ask of each pair of parts that overlap: which one is nearer now? If
the answer changed, move the layer in the document as well as rotating it. The cases that come up
most:

- **Limbs crossing the body's midline.** A leg swinging through, an arm swinging across the
  chest - the moment it passes the centre line, it changes side and therefore changes depth.
- **A turning figure.** As a body rotates toward or away, the far arm goes behind the torso and
  the near arm comes in front of it. Both may need moving in the same frame.
- **A head turning past a shoulder.** Far enough round, the shoulder passes behind the head.
- **Anything thrown or swung.** An object crossing the figure passes in front on one side of the
  arc and behind on the other.

This is the foreshortening cue a still frame has: a drawing cannot convincingly shorten a limb,
but it can say which limb is nearer, and that reads as depth.

## Required Character Layers

A character frame must contain these six assemblies (names matched case-insensitively, ignoring
numeric suffixes an editor may append, and accepting the `-assembly` suffix an artist adds to
`head` and `body` - `head-assembly` is the head):

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
- **A source frame's own name may not parse.** An editor uniquifier can land after the index
  (`BadGirl_walk_2-2`), and the first frame of a hand-drawn set is often unnumbered
  (`BadGirl`). Neither reads as `<base>_<n>`. Take the base from the part of the name before the
  index, ignore a trailing `-<n>` copy marker, and treat an unnumbered source as frame `0` -
  then number what you draw from there.

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
- **Every signed angle in this skill is a right-facing figure's.** The cycle tables below were
  measured from the wireframe skeletons, and every one of those walks to the **right**. Mirroring
  a figure about its vertical axis negates every angle in it, so a character drawn facing **left**
  takes the same cycle with every sign flipped. Applying a table as written to a left-facing
  figure is a walk whose legs swing backwards - the frames look posed, the travel numbers come out
  in range, and the figure moonwalks.

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

**Check which way your figure faces before you use a single one of these numbers.** Those
skeletons walk to the right. A figure facing left takes every sign below flipped; a figure drawn
three-quarters on, or standing with its feet splayed, has no facing for the table to be mirrored
against at all, and there the table gives you the *sizes* and the drawing gives you the
directions. When napkin-sketch generates the form it says which way it read the figure, and
mirrors the transforms itself when it is dictating them - so a form that says the figure faces
left has already done this for the angles it hands you, and has not done it for anything you take
from the table yourself.

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

Inverting *both* pairs together is the second most visible, and it is harder to catch because the
opposition survives it: arms and legs still disagree with each other, every angle is still in
range, and the figure still walks - backwards. That is what applying a right-facing table to a
left-facing character does, and the only way to see it is to look at the drawing and ask which way
the leading leg is reaching.

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

## How Far a Part Moves

The cycle tables give **angles**: how far a joint turns. They say nothing about how far anything
travels on the page, and a frame can satisfy every angle in them and still read as a mannequin
with flapping limbs.

`assets/illustrated-frames.json` is the other half, measured by `npm run illustrated-frames` from
the two illustrated assets: 70 drawn steps across six characters. Every figure is measured
against its own height, so the numbers carry from a tall character to a short one, and the whole
figure's rise and fall - the `bob` - is taken out before each part is measured.

| Type | bob | leg | arm | clothing |
|------|-----|-----|-----|----------|
| walk | 0.6 (0-1.9) | 8.9 (3.2-26.2) | 4.8 (1.2-9.4) | 3.5 (0.4-5.1) |
| run | 8.0 (0.5-14.5) | 17.5 (7.7-26.2) | 9.3 (2.9-13.4) | 3.0 (0.5-7.4) |
| ideal | 0.3 (0-0.4) | 2.4 (0.7-2.9) | 2.3 (1.5-2.5) | - |
| attack | 1.3 (0-13.2) | 11.3 (0.1-46.4) | 7.9 (0-31.3) | 1.2 (0.1-5.8) |
| damage | 1.0 (0.1-2.6) | 4.8 (2.1-15.6) | 9.0 (5.3-18.2) | 6.0 (3.9-13.2) |
| knocked-down | 9.4 (0.1-48.9) | 13.4 (3-43.8) | 16.1 (8.9-23.3) | 5.8 (2.3-14.9) |
| get-up | 2.1 (0-35.6) | 20.9 (10.9-34) | 24.0 (11.6-29.8) | 6.2 (0.3-22) |

Percent of the figure's height, per frame: the typical value first, the whole observed range in
brackets. **Aim at the typical.** A movement drawn in three frames covers the same ground in
fewer steps than one drawn in eight, so the high end of a range is usually one of those rather
than anything worth copying.

Two readings worth keeping:

- **A walk's legs travel about 9% of the figure's height per frame; its arms travel about 5%.**
  Arms swinging as far as the legs is a run, or a mistake.
- **The run's bob is more than ten times the walk's.** Vertical travel is most of what separates
  the two; the leg angles alone do not.

One caution about the walk's bob. The wireframe rig holds its neck at one height all the way
round, and "The Walk Cycle" says so. The finished drawings of a walk do rise and fall, but barely
- 0.6% of a figure's height, against the run's 8%. Both are true, and neither licenses inventing
a bounce: if the form hands you a `shiftYPercent`, use that number and not this one.

And bob has a direction, which the band cannot carry - a band gives a size. Five of the six drawn
walks change the sign of their bob somewhere in the cycle; BadGirl's own drops 0.6% of her height
and then rises 1.3%. A cycle has to arrive back at the pose it started from, and a figure that only
ever drops never does, however comfortably each step sits inside the band. This is a rule for the
cycle rather than for every adjacent pair: a drawn run keeps its bob going the same way for three
steps together, which is a figure sinking into a stride and then coming back up out of it.

### Nothing Stays Frozen

Across those 70 steps, 520 layers were compared from one frame to the next. **91-100% of them
were redrawn.** Up to 6% were carried somewhere else unchanged. In the walks, not one layer was
left frozen - the same shape at the same place - in a single step.

A frame that sets a transform on the six assemblies and leaves everything else alone does the
opposite of that. The assemblies move; the other two thirds of the figure is a verbatim copy, at
identical coordinates, frame after frame. The torso, head, hair and clothing hang motionless
while the limbs swing around them, and the figure reads as a cardboard cut-out with hinged arms.

The rule that catches it, to apply to your own frame before you save:

> No layer may keep the same shape at the same place in every frame of a sequence.

Holding a part still for *one* step is ordinary - a drawn walk does it constantly. Holding the
*same* part still for *every* step means it was copied, not posed.

`npm run illustrated-frames -- --check <file.svg>` measures any SVG this way and names the layers
that never moved. `npm run frame-preview -- <file.svg> --against <previous.svg>` does the same for
one step and renders the frame to a PNG beside it, so the numbers arrive with the picture they are
about.

### When the Form Carries No Angles

The form usually hands over a finished `transform` per assembly, measured off the figure itself.
Sometimes it hands over none and says so: *"The measured transforms are switched off for this
sequence."* That is the app's **Disable API** setting, chosen for a drawing the six-assembly rig
does not fit.

It is worth knowing why, because this mode is the cure for the defect above rather than a licence
to improvise. The measuring can only write a transform for a layer whose name one of the six
assemblies answers to. A figure drawn with a skirt, a shirt, a glove and two jacket halves has
layers with no slot at all, and they come out of a measured run frozen - not because the frame
was drawn badly, but because nothing ever gave them an angle. On one real eleven-layer walk, four
layers moved and seven held still.

So when the form carries no angles:

- **Pose every layer, not the six.** The form lists the ones matching no assembly. Those are the
  layers that would otherwise be frozen, and they are the reason the setting was switched on.
- **Let clothing follow the part it sits on.** A skirt turns with the hips, a sleeve with the arm
  inside it, hair with the head. They have joints too; they are just not on the rig's list.
- **Aim at the numbers the form gives you.** For a type the studies cover, an angle-less form
  carries that type's own travel band - `legs 8.9 (3.2-26.2)   arms 4.8 (1.2-9.4)   bob 0.6
  (0-1.9)   clothing 3.5 (0.4-5.1)` for a walk - because with nothing dictated they are the only
  yardstick there is. Aim at the typical. Arms travelling as far as the legs is a run, or a
  mistake.
- **The note may take one part out of its band.** A band describes the cycle; the note describes
  this sequence. A walk bobs 0.6% of the figure's height, and a walk asked to read as *dropping* -
  pedalling, wading, carrying something heavy - drops further than that. Leaving the band because
  the note asked is the note working; leaving it by accident is the defect the band is there to
  catch. Say which part you took out, and why, in your reply.
- **It is still a pose, never a redraw.** Switching the measuring off changes where the angles
  come from. It changes nothing about what may carry them: the path data stays exactly as it is
  and the movement lives in `transform` attributes.

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
4. **Carry the rest of the figure with it.** The assemblies are the parts that *turn*; they are
   not the whole figure. The torso, head and hair ride the bob, and clothing follows whatever it
   hangs on - a skirt over a leg that swung through it, a sleeve on an arm that lifted. A frame
   in which only the assemblies changed is the failure "Nothing Stays Frozen" describes.
5. **Look at the frame before you save it.** `npm run frame-preview -- <file.svg> --against
   <the frame before it>` renders it to a PNG beside the file and prints how far each part
   travelled against what drawn frames do. Open the image. A layer tree cannot show a limb
   detached from its socket, a leg through a skirt, or a stride that reads as a stumble, and
   those are the failures that survive every other check. The printed lines catch the rest: a
   leg that travelled 20% of the figure's height in a walk is too far, and a torso that
   travelled 0% was never posed, whatever the angles say. Fix and render again - twice at most,
   because a run that goes quiet for five minutes is killed.
6. **Rename the root group** to the frame name on `id`, `data-name`, and `inkscape:label`.
7. **Save last** to the `animations/<name>.svg` path the form names, once, and reply with one
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

## Grade the Frame, Then Decide

A frame is not finished when it is drawn. It is finished when it has been graded and the grade
says so, and the grading is one call:

```bash
npm run frame-preview -- <posed.svg> --against <the frame before it> --grade
```

It renders the frame, measures the step against the bands drawn frames actually fall in, and ends
with one of three verdicts:

| Verdict | Meaning | Next |
| --- | --- | --- |
| `pass` | Every part moved, and moved as far as a drawn frame does | Save it |
| `revise` | Something is off, and a pass is left | Fix finding 1, render, grade again |
| `save` | Something is off and the passes are spent | Save it and report what is wrong |

**Two passes, and the budget is a flag rather than a suggestion.** The app kills a run that goes
quiet for five minutes, so a run that keeps polishing is a run that saves nothing. `save` is not a
failure state - it is the honest end of a frame that is good enough, with its remaining defects
written down instead of hidden.

**Findings are ordered, and only the first one is worth a pass.** The others are usually its
symptoms. The clearest case is the one this check was built for:

### The defect that costs a whole run

A frame is **posed, never redrawn**. The pose lives entirely in `transform` attributes and the path
data is not touched - not one `d`, not one number.

The failure is re-emitting the geometry instead: rewriting every path with new numbers and setting
no transform at all. It is worth knowing precisely because nothing about the result announces it.
The figure is complete, every layer is present, the file opens, and the limbs have quietly drifted
off their joints, so it reads as a bad drawing rather than as a broken process - and it survives a
look. The grader catches it by reading rather than measuring: a posed frame shares its path data
with the frame it came from, and a redrawn one shares none of it.

When it fires, everything else in the report is noise measured against geometry that was never
posed. Fix that, and the travel numbers and frozen layers settle on their own.

### The note the form may carry

Animation Mode lets the user describe what the sequence is for, and passes that through as an
`<animation-note>` block in the form. It is the one input here that was not measured, and it is
read **with** this skill rather than instead of it.

Everything on this page answers *how far*: the cycle tables, the pivots, the travel bands. A note
answers *why*, and the two settle different questions. Which arm leads, where the weight sits,
whether the figure is tired or in a hurry, what the last frame should leave the viewer with -
none of that is in a band, and all of it changes the pose.

Where it sits in the order settles the rest:

- **It outranks the animation type.** The type is one word from a dropdown; the note is the user's
  sentences about the same movement. Where they disagree the note decides and the template yields.
- **It may move a measured angle, never a joint.** "That arm barely swings" is an instruction
  about a transform, not a mood. Change the angle by the smallest amount that reads, keep the
  pivot it turns about, and say which ones you changed.
- **It never licenses a redraw.** Path data stays exactly as it is whatever the note asks for. A
  note asking for geometry the rig has no shape for is a `vector-graphics` job, not a reason to
  drop the transforms.
- **It applies to the sequence, not the step.** The same note is handed to every frame, so frame
  six is drawn under the direction that shaped frame one.

### When the subject is not in the assets

The bands come from drawn frames of the cycles the rigs cover. A movement no rig describes, an
object that has to come apart, geometry that does not exist yet - none of those have a band, and
grading them against one that was drawn for something else is worse than not grading them. Reach
for the `vector-graphics` skill, draw what is missing with the fewest control points that read
correctly, and judge the result against the study sheets by eye.

## Assets

Treat these the way an animation course treats its coursework: the rigs are the exercises you are
marked against, and the studies are the sketchbooks you learn the movement from. Read them before
drawing, not instead of drawing.

### Look at the Preview, Read the Source

Every asset here ships twice: `<name>.svg` and `<name>.png`, the same drawing as
markup and as a picture. They are not redundant, because they answer different
questions, and reaching for the wrong one is how a run either wastes its budget
or draws a pose it never actually saw.

| Question | File | Why |
| --- | --- | --- |
| What does this movement look like? | `.png` | One image. An SVG of the same drawing is markup you have to simulate in your head |
| Where exactly is this anchor? | `.svg` | Coordinates only exist in the source |
| What is this layer called? | `.svg` | Names only exist in the source |
| Is my frame in the right shape? | `.png` | Compare pictures with pictures |

**Look first.** A pose is a visual fact. The travel tables on this page and the
measured JSON say how *far* a part moves, and no number says what the result is
supposed to look like - which is exactly the half that goes wrong: a frame whose
angles are all within budget and which still reads as a stumble rather than a
stride. The preview is the answer key for that half, and looking at it costs one
`Read`.

**Then read the source, and only the part you need.** Names, anchors and path
data are in the SVG and nowhere else. `Grep` for the group you want rather than
opening the file.

**Never read the two illustrated SVGs at all.** They are 1.5 MB and 2.5 MB, and
a run that opens one has spent its whole budget before it poses anything. Their
previews are 396 KB and 601 KB *as pictures*, which is one `Read` each, and
every number they hold is already measured into `assets/illustrated-frames.json`
at 54 KB. Picture plus numbers is the whole of what those two files have to
give. The same split applies to `character-wireframes.svg`, whose readings are
in `assets/skeleton-cycles.json`.

Each asset says how far it can be trusted. A **rig** is named and structured, so it can be
measured and its names relied on. A **study** is a drawing to read, not a contract: its groups
are named however the artist happened to name them, and nothing should be derived from them
automatically - which is also the lesson they teach, because a real document names its layers the
same careless way.

**Rigs** - measure these, rely on the names:

- `assets/character-wireframes.svg` (look: `character-wireframes.png`): the character rig -
  stick-figure skeletons for walk, run,
  ideal stance, ideal fighting stance, punch, and knockdown, one per frame, with the required
  assembly structure. This is what the measured cycles are read from.
- `assets/skeleton-cycles.json`: those readings, per type and per step, generated from the
  wireframes by `npm run wireframe-cycles`.

**Partly organized** - frame structure is reliable, the contents are working drawings:

- `assets/breaking-objects.svg` (look: `breaking-objects.png`): the object rig - a box breaking
  (3 frames) and an impact cloud
  dispersing (5 frames), drawn as `base` plus one group per separated piece. Objects have no
  assemblies, so this is a naming and staging guide rather than a set of angles. Frame `_0` of
  both sequences also carries `potential_*` and `obsoletes` groups: pieces the artist was still
  deciding about. They are working scraps, not part of the frame - read the numbered frames and
  the `base`/`stray-*` groups, and leave those two alone.

**Finished frames** - the frame naming is reliable; the layer naming is the lesson:

- `assets/illustrated-multiple-character-actions.png` (the SVG is 2.6 MB; look at the picture):
  five characters, each titled on the sheet and each action bracketed and named above its strip,
  so the frames you need can be found without studying the page:

  | Titled on the sheet | In the layer names | Frames drawn |
  |---------------------|--------------------|--------------|
  | Character I | `JumpingJunkie` | walk x2, idle, attack, damage x3, preDefeat, defeat |
  | Character II | `CrimeGuy` | walk, attack, damage x3, preDefeat |
  | Character III | `JammingJabber` | walk x2, attack x3, damage x3, preDefeat, defeat |
  | Character IV | `BadGirl` | walk x2, attack x3, damage x3, preDefeat x2, defeat |
  | Character V | `SassyGirl` | walk x4, preAttack x2, attack x4, damage x3, preDefeat x6, defeat x2, getUp x6 |

  The brackets on the sheet name the same strips in plainer words - **Take Damage** for `damage`,
  **Knocked Out** for the `preDefeat`/`defeat` pair - so read the bracket to find the strip and the
  layer name to search the file. Frames are named `<Character>_<action>_<n>`, the convention
  Animation Mode itself uses, with each character's base pose carrying the bare name.

  **Go to one strip, not to the whole sheet.** Drawing a walk means looking at the five labelled
  walks; the rest of the page is other movements, and the time spent on them is time spent before
  your first edit.
- `assets/illustrated-single-character-actions.png` (the SVG is 1.5 MB; look at the picture):
  one character in six action strips - an
  eight-frame walk, a nine-frame run, a four-frame fighting stance, a walk-to-run transition, a
  jump kick and a punch-kick combo.
- `assets/illustrated-frames.json`: both of those measured, per sequence and per step, generated
  by `npm run illustrated-frames`. The travel budgets come from here.

These are the answer key: the frame after the frame, as a person drew it. Read them for how far a
real frame moves and how much of the figure it touches. Do not copy a pose out of them - the
character in front of you is not one of these five, and their layer names are a warning, not a
standard.

**Look at `illustrated-single-character-actions.png` and
`illustrated-multiple-character-actions.png`; never read the SVGs behind them.** That is the rule
at the top of this section, and these two are what it was written for. The picture shows the pose,
`illustrated-frames.json` holds every number measured out of it, and the 1.5 MB and 2.5 MB sources
have nothing left to add that is worth the budget.

**Studies** - read them for how a movement looks, do not derive from them:

- `assets/character-study-throwing-and-walking.svg` (look:
  `character-study-throwing-and-walking.png`): a walk study with its `guides` (contact
  points and direction arrows) and numbered pose groups, beside a throwing character. Loose and
  generalised: it shows timing and weight rather than an assembly structure.
- `assets/bouncing-object.svg` (look: `bouncing-object.png`): a bounce study - the arc as
  `object-path` with the object drawn
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

Every one of these ships as a `.svg` and a `.png` too, and the rule is the one above: look at
the picture to find the part, read the source to lift it.

- `../vector-graphics/assets/isometric-objects.svg` and `perspective-objects.svg`: a wheel, a
  sphere, and a cube drawn the same way twice, once in each projection - so an object animation
  can keep one projection across its frames
- `../vector-graphics/assets/shapes.svg`: squares, circles, ellipses, triangles, polygons, stars,
  lines at set angles, an arc, and a spiral. Small enough that reading the source outright is
  cheaper than looking, and the source is the half with the coordinates in it
- `../vector-graphics/assets/alphabet.svg`: letterform paths for text-based animations
- `../vector-graphics/assets/male-character-elements.svg` and `female-character-elements.svg`:
  loose sheets of limbs, hands, heads, hair, and clothing. Studies rather than rigs, and the
  place to look when a character needs a part the wireframes do not draw. Look at the previews
  first - these sheets hold a part at several angles, and which one you want is a visual choice
- `../vector-graphics/SKILL.md`: the curve formulas, degree choice, and path-data script to use
  when a frame needs new geometry drawn rather than an existing pose turned
