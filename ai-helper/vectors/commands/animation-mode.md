---
description: Draw the next Animation Mode frame from the form napkin-sketch wrote to _temp/animation-form.txt
argument-hint: "[path to the form file]"
allowed-tools: Read, Edit, Write, Glob, Bash(mkdir:*)
---

# Draw one Animation Mode frame

The form file is `$1`. When that is empty, use `_temp/animation-form.txt`, which is where
napkin-sketch writes it. Read that file and carry out exactly what it asks: the form is the
request, and everything below is how to answer it.

1. **Load the `vectors:vector-animations` skill first.** It carries the assembly list, the joint
   pivots, the cycle tables, and the transform recipe. Reach for `vectors:vector-graphics` only
   when the form asks for geometry that does not exist yet (a `break` fracture line, an `explode`
   piece outline) - a normal frame turns geometry that is already there.
2. **Read the full contract** at `${CLAUDE_PLUGIN_ROOT}/instructions/animation-mode.instructions.md`
   before editing. It is the authority on naming, layout, and the failure modes.
3. **Edit the source in place.** The frame to pose is already on disk at the path the form names
   (`_temp/animation-source.svg`). Set one `transform` per assembly group, copying the values in
   the form character for character. Never re-emit, redraw, or reformat the path data.
4. **Name the root group** with the `id` and `data-name` the form gives (plus `inkscape:label` when
   that attribute is present).
5. **Save last, and save once**, to the `animations/<name>.svg` path the form names, creating the
   folder if it is missing. The app takes the file the moment it appears, so a copy saved before
   the pose is in it lands the previous frame again.
6. **Reply with one short line**, such as `saved character-walk_2`. Do not print the document -
   printing the SVG is what made earlier runs time out.

If the form file is not there, say so and stop. The form is written by napkin-sketch when a
generation run starts, and there is no frame to draw without it.
