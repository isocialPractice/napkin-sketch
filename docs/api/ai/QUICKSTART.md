# The AI helpers: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

The `graphic-designer` helper reads a graphic you already have into a design
language and hands you a skill that draws new work in it; this is the shortest
path from a clone to a branded graphic, using the asset and the brand files
this repository ships.

## The whole thing in four steps

1. Build the clone:

```bash
npm install
npm run build
```

2. Run the tour. It **leaves the tool installed and wired up** rather than
   merely passing:

```bash
npm run test:graphic-design-api
```

   It reads `test/graphic-design-api/reference-graphics/created-svg_graphic-api.svg`,
   writes a design language and a skill from it into your AI tool's skills
   folder, points that skill at the assets in
   `test/graphic-design-api/test-assets/` through a `resources.md`, records
   what a bare request means, and draws `card` and `cheatsheet` into
   `test/graphic-design-api/generated-graphics/`, carrying the linked logo and
   footer. Open the PNGs.

3. Ask your AI tool for a graphic. There is nothing to configure first, and
   both lines draw the same thing:

```text
/graphic-design-api make a html cheatsheet. ensure to include linked assets
/graphic-design-api generate
```

   The first matches `cheatsheet` to a drawing mode; the second matches nothing
   and falls through to the request the tour recorded. The second half of the
   first line is never needed: linked assets are included whenever
   `resources.md` names files that exist.

4. Make it your brand with one edit to `references/resources.md`:

```md
- GLOBAL_ASSETS: path/to/your/assets/
- brand name: Acme Corp
```

## A worked example

Every step the tour runs is a command you can run yourself, from the clone:

```bash
# 1. Capture the language, generate a skill, and register it. One command.
node ai-helper/graphic-designer/skills/design-language/scripts/generate-skill.mjs test/graphic-design-api/reference-graphics/created-svg_graphic-api.svg --to .claude/skills

# 2. See what the brand resolved to, after editing references/resources.md
node ai-helper/graphic-designer/skills/design-language/scripts/brand-resources.mjs --print

# 3. See what is wired up, and the exact command a request turns into
node ai-helper/graphic-designer/skills/design-language/scripts/brand-resources.mjs --registration

# 4. Draw
node .claude/skills/created-svg_graphic-api/scripts/make-created-svg_graphic-api.mjs --cheatsheet --out ./out
```

Step 1 writes `references/graphic-design-api.json` as its last act. That file
is what makes step 4 unnecessary in practice: it records which script draws,
which `resources.md` it draws with, where output goes, and what to draw when a
request does not say. Asking for a graphic is then the whole of using it.

Check the result against the source the way the language was measured:

```bash
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs out/cheatsheet.png --colors 6
```

A right palette at a wrong ratio is the usual way a generated graphic drifts,
and the shares show it where the eye does not.

## A script from a sentence

The `scripting` helper, plugged in the same way
(`/plugin install scripting@napkin-sketch`, or
`npm run ai-helper -- --helper scripting`), turns a request into a napkin
script, which napkin-sketch checks, keeps and draws:

```bash
napkin-sketch draw --prompt "a three-box flowchart - Plan, Build, Ship - with arrows" --to svg,png
```

The script comes back as a `.napkin` file beside the drawings, so drawing it
again needs no AI.

## Where to go next

- [Plug in the helper](README.md#plug-in-the-helper): as a plugin, or as files
  in your AI tool's folder.
- [Capture a design language](README.md#capture-a-design-language): from your
  own asset.
- [Use the skill you were handed](README.md#use-the-skill-you-were-handed) and
  [Give it your brand](README.md#give-it-your-brand).
- [Reading these pages as an agent](README.md#reading-these-pages-as-an-agent)
  and [Writing napkin scripts that read clean](README.md#writing-napkin-scripts-that-read-clean).
- [Drawing from a request](README.md#drawing-from-a-request): the form, the
  helper command, the second try, and how to ask well.
- [Troubleshooting](README.md#troubleshooting): symptom, cause and fix.
