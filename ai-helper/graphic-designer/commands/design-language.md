---
description: Read a media file into a DESIGN_LANGUAGE.md, then generate a per-asset skill that can draw more work in that language
argument-hint: "<path to a JPG, PNG, SVG, or GIF> [output directory]"
allowed-tools: Read, Edit, Write, Glob, Bash(node:*), Bash(mkdir:*)
---

# Capture one asset's design language

The media file is `$1`. If that is empty, ask which asset to read and stop - there
is nothing to measure without one.

The output directory is `$2`, and it is optional. Given one, write the design
language file into it, creating the folder if it is missing. Given none, write
it beside the asset. A destination named in plain words rather than as `$2`
("write it to `docs/design/`") means the same thing - take it.

1. **Load the `graphic-designer:design-language` skill first.** It carries the
   measuring procedure, the naming rules, and what each format can and cannot
   tell you. Reach for `graphic-designer:graphic-design-api` at step 4, when the
   generated script has to compose something.
2. **Measure before you look.** Run the analyzer and read its numbers:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/design-language/scripts/analyze-media.mjs "$1" --colors 12
   ```

   An SVG gives colors, type, strokes, radii and structure. A PNG gives colors
   only. A JPEG or GIF gives nothing measurable - read the image yourself and
   mark those values **observed**, never measured. If a PNG comes back with an
   empty palette and a note about the API, run `npm run build` in the clone and
   try again.
3. **Write the design language file** into the output directory above.
   `DESIGN_LANGUAGE.md` when that directory holds none;
   `DESIGN_LANGUAGE-<stem>.md` when it already holds one, where `<stem>` is the
   media filename without its extension. The check is per directory, so the
   same asset written to two places gets the plain name in both.
   Start from the analyzer's `--markdown` output and add what it cannot
   decide: the roles each color plays, the 60-30-10 ratio, the type scale the
   measured sizes round to, the spacing rhythm, and what the language forbids.
4. **Generate the per-asset skill** in the installed target's skills folder
   (`.claude/skills/`, `.github/skills/`, whichever this helper was installed
   to). Name the folder after the media stem, and if it is taken append `_0`,
   then `_1` - never overwrite one. It holds a `SKILL.md`, the design language,
   and `scripts/make-<stem>.mjs` that composes a new asset through the
   graphic-design API.
5. **Check it before you report.** Run the generated script, then run the
   analyzer over what it wrote and compare the palette against the source's.
   Agreement on paper, ink, and accent means the script is in the language. A
   mismatch is a bug in the script, not in the design language file.
6. **Reply with what you wrote**: the design language path, the skill folder,
   and one line on anything the source could not tell you.

Never invent a number a file did not give you. A design language whose values
were guessed is worse than none, because the next asset will be drawn to it.
