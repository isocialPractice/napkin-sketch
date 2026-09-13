---
description: 'Contract for AI helper tools that generate Animation Mode frames from the form data napkin-sketch writes to _temp/animation-form.txt'
applyTo: '{_temp/**,animations/**,**/*.svg}'
---

# Animation Mode AI Helper

## Overview

Napkin-sketch's Animation Mode generates the frames of a frame-by-frame animation with the help
of an AI tool. The app collects the animation request through a sequential popup form, writes the
cleaned form data to a temp file, and pipes that file to whatever AI tool is configured. These
instructions define what the invoked tool must do with that input.

Two rules shape everything below:

1. **One invocation draws one frame.** The app asks again for the frame after it, handing over the
   frame you just drew as the new source.
2. **A frame is an edit, not a drawing.** The source frame is already on disk. You move the pose
   by setting a `transform` on each assembly group and saving the result. You never re-emit the
   geometry.

An AI tool is required for Animation Mode. Any agentic tool that can edit a file qualifies:
Claude Code, GitHub Copilot, Codex, or a plain LLM command-line tool that can write files.

## Why an Edit and Not a Drawing

A napkin-sketch character is 50 to 80 KB of SVG path data. Re-emitting that document to move an
arm costs tens of thousands of output tokens and takes minutes; runs that tried it produced no
output at all before the app gave up on them.

Rotating the assembly's `<g>` costs one attribute. An SVG group transform rotates every anchor
point *and its Bezier handles* together, about a point you choose, which is exactly the rigid
joint rotation a frame needs. napkin-sketch resolves those transforms when it imports the frame
(it reads the rendered geometry, not the raw coordinates), so a transformed group and a redrawn
one import identically. One is a two-second edit; the other is a five-minute essay.

## Invocation

The app writes the final form data to `_temp/animation-form.txt` and invokes the helper with the
file as its prompt. Example using Claude Code (the default command):

```bash
claude -p --model sonnet --dangerously-skip-permissions < _temp/animation-form.txt
```

Pin a Sonnet-class (mid-size) model; the same pattern works with other tools, and the command is
configurable. Mind the OS when redirecting input:

```powershell
# Windows PowerShell has no < redirection operator
Get-Content _temp/animation-form.txt | claude -p --dangerously-skip-permissions
```

```bash
# Other tools follow the same shape
copilot -p "$(cat _temp/animation-form.txt)"
codex exec "$(cat _temp/animation-form.txt)"
```

A tool that loads plugins can be pointed at the command the `vectors` plugin ships instead of at
the form, which reaches the same contract through the plugin rather than through the file:

```bash
claude -p --model sonnet --dangerously-skip-permissions "/vectors:animation-mode"
```

The `_temp/` directory is transient: the app clears it when the animation run completes. Never
store anything there that must outlive the run, and do not rely on earlier files existing.

There is no overall time limit, but the app watches for signs of life: a run that produces no
frame file and no output for 5 minutes is treated as hung and its process tree is killed (the
user's Cancel does the same immediately). The app also ends the run the moment the frame file is
complete on disk, so **save the frame as your last action** - anything after the save is never
read.

## Apply the `vector-animations` Skill

Every form names the `vector-animations` skill. Load it before editing: it carries the assembly
list, the joint pivots, the cycle tables, and the transform recipe. The canonical copy is
`ai-helper/skills/vector-animations/SKILL.md`; installed copies may sit under your tool's dot-folder
(for example `.claude/skills/vector-animations/`). Installed as the `vectors` plugin the same
skill answers to `vectors:vector-animations`, and the form names it that way.

The `vector-graphics` skill is installed beside it and covers the curve side of the job: the
Bezier formulas, choosing between linear, quadratic, and cubic segments, the SVG path commands,
and a dependency-free script that derives path data from control points. A normal frame never
needs it, because a frame turns existing geometry rather than drawing any. Load it only when the
form asks for geometry that does not exist yet - a prop, a shape no assembly carries - and even
then, keep the drawn geometry to the fewest control points that read correctly. It is a general
skill, not an Animation Mode one, so nothing in it assumes this app.

## Form Data

The form file is short by design - a few KB, with no geometry in it. It carries:

1. **The frame numbers**: the source frame's index and the index you are drawing.
2. **The source file**: `_temp/animation-source.svg`, the frame to edit.
3. **The pose**: a finished `transform` value per assembly, already measured against the source
   geometry by the app. Copy them character for character.
4. **The output path**: `animations/<name>.svg`, and the name the root group must carry.

Only `walk` has a measured cycle behind it. Every other type is offered as **work in progress**:
the form says so and carries a **template** for that type - one sentence describing what a single
step of that movement does, and whether the sequence loops - in place of exact angles. Work from
that template with the same transform mechanics, and judge the amounts from the source pose. The
`vector-animations` skill lists every type, its status, and whether it loops.

Character types move the six assemblies about their joints. **Object types have no assemblies**:
the subject is the frame's root group, so the transform goes there unless the movement needs the
pieces handled separately. `break` and `explode` are the two that need new geometry rather than a
transform - use the `vector-graphics` skill for those paths.

## Required Layers

A character frame must resolve these six assemblies before generation starts:

```text
front-arm-assembly
body
front-leg-assembly
back-leg-assembly
back-arm-assembly
Head
```

Names match case-insensitively and tolerate editor-appended numeric suffixes. In the source file
each one is a `<g>` carrying `data-name="<assembly>"` (its `id` holds the same name). Assemblies
nest part groups, which nest `strokes` and fill groups; you never touch anything inside them.
When an assembly is missing, the app's step 1 dialogs ask the user to select the layers that make
it up before the run starts.

## Drawing the Frame

1. Open `_temp/animation-source.svg` and work on it in place.
2. Set the `transform` attribute the form gives for each assembly group, replacing any transform
   that group already carries rather than adding to it. Change nothing else: no path data, no
   stroke widths, no fills, no classes, no ids other than the root group's.
3. Rename the root group to the frame name the form states, on `id`, `data-name`, and
   `inkscape:label` when that attribute is present. If the document has no single root group,
   wrap its contents in one that carries the name.
4. Save to the output path the form names, creating `animations/` if it does not exist. Save once,
   and save last, with the transforms already in the document. **Never copy the source to the
   output path and edit it there.** The app takes that file the moment it appears, so a copy made
   before the pose is applied is collected as the frame - and the frame it collects is the
   previous frame over again. The app now checks for this and refuses a frame whose geometry and
   transforms match its source, so a copy costs the run rather than passing silently.
5. Reply with one short line, such as `saved character-walk_2`. **Do not print the SVG.**

The app imports the saved file as a group layer, shows it to the user, and asks again for the
next frame. Each run's command, exit, and output are logged to `logs/animation-helper.log`.

Leave the `<svg>` element's own `width`, `height`, and `viewBox` exactly as the source has them.
The app rewrites the saved file once it has imported the frame, sizing the document to the ink
and dropping the paper rect so the file works as a sprite; the source may already carry an
offset `viewBox` for that reason. Transform values are in the document's coordinate space, which
the geometry shares, so an offset viewBox changes nothing about them.

### Worked Example

The form says frame 2 of a walk, source `character-walk_1`:

```text
- front-leg-assembly (front-leg-assembly): transform="translate(0 2.1) rotate(-16 152.4 61.8)"
- Head (head): transform="translate(0 2.1) rotate(-2 150.1 38.4)"
```

In `_temp/animation-source.svg` the front leg group becomes

```xml
<g id="front-leg-assembly" data-name="front-leg-assembly"
   transform="translate(0 2.1) rotate(-16 152.4 61.8)">
```

the root group becomes `<g id="character-walk_2" data-name="character-walk_2">`, and the file is
saved to `animations/character-walk_2.svg`. Nothing else in the document changed.

### Output Naming

- If the source layer holding the required assemblies contains the animation type in its name
  (for example `character-walk_1`), the sequence continues that base and numbering: the drawn
  frame is `character-walk_2`.
- Otherwise the sequence starts a 0-based `animationLayer-<animationType>` run: the source counts
  as `_0` and the frame you draw is `animationLayer-walk_1`.
- The file stem, the root group's `id`, and its `data-name` are the same string, and the form
  states it outright - use the name the form gives rather than deriving your own.

### If You Cannot Write Files

A tool that can only print falls back to printing one complete SVG document as its final message;
the app recovers the markup from stdout and saves it to the output path itself. This is the slow
path - it costs the whole document in output tokens - so use it only when writing a file is
genuinely unavailable.

## The User's Note

A form may carry an `<animation-note>` block: what the person setting up the sequence said the
animation is for, in their own words. It is optional, it is capped, and it is the only thing in
the form that was not measured.

**It outranks the animation type.** Both answer the same question - what is this sequence - and
the dropdown answers it with one word out of fourteen while the note answers it in the user's own
sentences. Where the two disagree the note decides and the type's template yields; asking the
question and then ranking the answer below a dropdown would have wasted the asking.

**Two things it does not outrank, and neither is about what the frame shows.** The measured
transforms keep their joints: a note may shift emphasis inside them - which side leads, what
barely moves - by changing an angle rather than by moving the pivot, and the helper names what it
changed in its reply. And no note licenses a redraw: the path data stays exactly as it is and the
movement lives in `transform` attributes whatever the note says. That second rule is the one a
failing run always breaks, and keeping it out of the note's reach is precisely what makes
widening the rest of this safe.

What it is for is the half the numbers leave open. A cycle table fixes how far an arm swings and
says nothing about which arm leads, where the weight sits, or whether the figure is tired. That
is the context a person has and a measurement does not, and it is the same for every frame of
the sequence rather than for the step in front of you.

The block is tagged rather than quoted so direction can be told from contract, and a note that
contains the closing tag has it neutralised before it is written - otherwise everything after it
would read with the authority of the form.

## Supporting Resources

The canonical, version-tracked copies live in the repository's `ai-helper/` folder; the install
script (`npm run ai-helper -- --to <claude|github|...>`) copies them into the dot-folder your
tool reads (for example `.claude/skills/` and `.claude/instructions/`, which the `claude` CLI
discovers automatically when run from the project root).

- Skill: `ai-helper/skills/vector-animations/SKILL.md`
  - References: `bezier-curves.md`, `animation-essentials.md` under the skill's `references/`
  - Assets: wireframe pose skeletons and illustrated answer-key frames under the skill's
    `assets/`, plus the measured `skeleton-cycles.json` and `illustrated-frames.json`
- Companion skill: `ai-helper/skills/vector-graphics/SKILL.md`
  - References: `linear-bezier-curve.md`, `quadratic-bezier-curve.md`, `cubic-bezier-curve.md`
  - Scripts: `matlib-script.js` and `template.md` for deriving path data from control points
  - Assets: shape, object, and letterform primitives under the skill's `assets/`

**Every asset ships twice.** `<name>.svg` is the source and `<name>.png` is the same drawing as a
picture, and the two answer different questions: the picture says what a movement looks like, the
source says where the anchors are and what the layers are called. A tool drawing a frame should
look at the picture before it poses anything, and should never open
`illustrated-single-character-actions.svg` or `illustrated-multiple-character-actions.svg` at all
- they are 1.5 MB and 2.5 MB, their previews are one `Read` each, and every number in them is
already measured into `illustrated-frames.json`.

The pair is a contract rather than a convenience: `test/ai-helper.test.ts` fails if an asset
arrives without its preview, because a reference nobody can look at is one nobody will use.
