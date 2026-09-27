# Animation Mode

## At a glance

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
  than a batch size: fewer frames move further each, more move less. For the
  four types with a measured cycle, **Draw measured frames** leaves the helper
  out and draws the whole sequence at once, with no AI. See
  [Animation Mode](#animation-mode) for the workflow and requirements.

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

## Frame names

A frame is a group layer named `<base>_<n>`: a name the whole sequence
shares, then the frame's number. Each run draws the frame after the one it
starts from, and names it from that frame's layer by whether the name holds
the animation type, in any case:

| Drawn from | Named | Why |
| :--------- | :---- | :-- |
| `character-walk_1` | `character-walk_2` | The name holds the type and a number, so its sequence goes on. |
| `walk` | `walk_1` | The name holds the type but no number, so it counts as frame 0. |
| `hero` | `animationLayer-walk_1` | The name does not hold the type, so a new sequence starts, with it as frame 0. |

The helper saves each frame as `animations/<base>_<n>.svg`, under the name
its layer takes when the app imports it.

## Installing Animation Mode

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
`ai-helper/vectors/` **is** the `vectors` plugin: that target checks the folder over
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

   **Posing: Measure the joints, or Disable API.** The app normally measures
   this figure's own geometry and hands the helper a finished angle per
   assembly. That only reaches a layer one of the six assemblies answers to,
   and a real illustrated character has more layers than that: a drawing with
   a skirt, a shirt, a glove and two jacket halves has layers with no slot at
   all, and a measured run leaves every one of them exactly where it was.
   Choosing **Disable API** hands over no angles at all. The helper poses every
   layer itself, from the drawing, your note and - for a type the drawn studies
   cover - that type's own measured travel band, printed in the form so there
   is something to aim at. The form also names the layers the rig could never
   have reached. The
   dialog counts them for the figure in front of you - *"5 of 11 layers here
   match no assembly"* - so the choice is made before a sequence is drawn
   rather than after eight frames of it. What the setting never changes is that
   a frame is **posed rather than redrawn**: the path data stays as it is
   either way.

   **Or draw every frame now, with no AI.** For a character type with a
   measured cycle - walk, run, idle, knocked down - the dialog adds **Draw
   measured frames** beside Next. It leaves the helper out: once any missing
   assemblies are mapped, the app writes a napkin script that copies the
   figure's parts onto each frame and turns every part about its joint by the
   cycle's total up to that frame, and shows the script before anything is
   drawn. **Draw frames** runs it. The whole sequence lands at once - one row
   per frame, side by side, each saved to `animations/` as a helper's frame
   is - and one undo takes all of it back. A measured frame is the cycle's
   pose exactly, so it needs no sign-in, no waiting and no second look. What
   it cannot do is move a layer no assembly holds, so **Disable API** hides
   the button and leaves such a figure to the helper. `napkin-sketch render
   --animate walk` draws the same frames from a saved book (see
   [the command line](../../api/cli/README.md#render)).
2. **Map missing layers** (character animations only, and skipped when the
   page already validates) — for each missing assembly, a dialog asks which
   layers consist of it (Cancel / Back / Next); the chosen layers are grouped
   under a new group named for the assembly. **Object animations skip this
   entirely**: they move the graphic as a whole and have no arms or legs to
   map, so setup comes first and decides whether the assemblies are needed.
3. **One frame at a time** — the source frame is written to
   `_temp/animation-source.svg` and a short form (4 to 7 KB) to
   `_temp/animation-form.txt`. The form asks for exactly one read before the
   first edit - the `vector-animations` skill - and names the rest under a
   heading that says when they apply, because a helper told to read everything
   will. The helper applies that skill and **edits the source file rather than
   redrawing it**: it sets one `transform`
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

   **Which way the figure travels decides the sign of every angle.** The
   measured cycles were read off wireframe skeletons that all walk to the
   right, and mirroring a figure negates every rotation in it - so the same
   table applied to a left-facing character is a walk with the legs swinging
   backwards. The setup dialog carries a **Facing** choice, *Travels right* or
   *Travels left*, preselected from the figure's own feet: a foot sticks out in
   front of the ankle, so two feet pointing the same way are a profile and two
   pointing opposite ways are a drawing with no facing to read, which the note
   under the choice says outright. Choosing *Travels left* mirrors the
   dictated transforms, and the form tells the helper which way it was read
   either way - including when the measuring is off and the helper is working
   from the skill's own right-facing tables, where flipping the signs is its
   job rather than the app's.

   **A frame arrives as one row**, folded shut the way everything imported is
   (see **Import** in the feature list above). The panel gains one row per
   frame rather than the sixty-odd an illustrated pose is made of.

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
in the version-tracked `ai-helper/vectors/` folder: `vector-animations` (the assembly
list, joint pivots, cycle tables, transform recipe, Bezier-curve and
animation-essentials references, the character wireframe rig, and an object rig
drawing what a break and a burst do to the pieces) and
`vector-graphics` (a general Bezier-curve and SVG-structure skill -
linear/quadratic/cubic references, layer-management conventions for naming,
nesting, and compound paths, shape, object, and letterform assets, and a
dependency-free script that derives SVG path data from control points). That
folder is also the plugin itself, so the same files reach a tool that loads
plugins and a tool that reads a dot-folder, and neither copy can go stale.
`ai-helper/` above it is a container, holding one folder per helper -
`vectors/`, the [graphic-designer](../ai-helpers.md#the-graphic-designer-helper) beside it, and
[scripting](../ai-helpers.md#the-scripting-helper).
Every generated form names the `vector-animations` skill and tells the helper
where to find both; a frame turns existing geometry, so `vector-graphics` only
comes into play when something has to be drawn from scratch. Because AI tool
dot-folders are commonly gitignored, a fresh clone installs them with:

```bash
npm run ai-helper -- --to claude        # .claude (default when no --to)
npm run ai-helper -- --to github        # .github (Copilot)
npm run ai-helper -- --to cursor        # any other tool dot-folder
npm run ai-helper -- --to plugin        # check the plugins, print /plugin
npm run ai-helper -- --helper vectors   # narrow to one helper (default: all)
npm run ai-helper -- --list             # show every known target and helper
NAPKIN_AI_HELPER=claude,github npm install   # or install on clone via env
```

**The `plugin` target is the odd one out**, because there is nothing for it to
copy. `ai-helper/vectors/` **is** the `vectors` plugin: the manifest, the
command, the subagent, both skills, and the contract are the folder's own
contents, and the marketplace that lists it is one manifest at the repository
root.

```text
.claude-plugin/marketplace.json   lists vectors, source ./ai-helper/vectors
ai-helper/
  vectors/
    .claude-plugin/plugin.json    the manifest, versioned from package.json
    commands/animation-mode.md    /vectors:animation-mode - draw one frame
    agents/animation-frame.md     the same job as a subagent, in its own context
    skills/vector-animations/     assemblies, pivots, cycles, transform recipe
    skills/vector-graphics/       Bezier formulas, layer structure, path scripting
    instructions/                 the contract a helper follows
  graphic-designer/               the second helper, below
  scripting/                      the third, below that
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
