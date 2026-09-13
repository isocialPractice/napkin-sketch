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

   The report's `brand` section says where the logo, the wordmark and any
   placed media sit. A slot marked `named` was read off a layer name and is
   exact; one marked `scan` was guessed from the pixels - confirm it by eye
   before anything is drawn into it. Roles come from `areaPalette`, which is
   what covers the page, not from how often a colour is referenced.
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
   to):

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/design-language/scripts/generate-skill.mjs "$1" --to .claude/skills
   ```

   It names the folder after the media stem and asks before overwriting one
   that exists - never answer yes on the user's behalf; if they have not said
   to replace it, generate under `<stem>_0` instead. What it writes is a
   `SKILL.md`, the design language, `references/resources.md`, and
   `scripts/make-<stem>.mjs` composing through the graphic-design API.

   Then improve what it wrote. It gets the language right and the layout only
   as right as arithmetic can - it does not know what the graphic is for.
5. **Say how to point it at a brand.** The generated `references/resources.md`
   is a placeholder, deliberately: every value in it is one the parser rejects,
   so the skill draws marks in the design language until someone fills it in.
   Tell the user the three lines that matter and stop there - do not invent
   paths, a brand name, or a domain they did not give you:

   ```md
   - logo: path/to/logo.svg
   - GLOBAL_ASSETS: path/to/assets/
   - brand name: <theirs>
   ```

   In a `GLOBAL_ASSETS` folder the file name is the slot it fills. Once it is
   filled in, every graphic the skill draws carries those assets without being
   asked to - there is no "include the linked assets" to remember.
6. **Check it before you report.** Run the generated script, then run the
   analyzer over what it wrote and compare the palette against the source's.
   Agreement on paper, ink, and accent means the script is in the language. A
   mismatch is a bug in the script, not in the design language file.
7. **Reply with what you wrote**: the design language path, the skill folder,
   the brand slots it found and how, and one line on anything the source could
   not tell you.

Never invent a number a file did not give you. A design language whose values
were guessed is worse than none, because the next asset will be drawn to it.
