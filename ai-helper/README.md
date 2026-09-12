# AI helpers

The AI-facing half of napkin-sketch, in two plugins. Each one owns a folder
here, and a folder is the whole plugin: the manifest, the commands, any
subagents, the skills, and the contract the tool reads before it edits
anything. The marketplace that lists them is
[`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) at the
repository root.

```text
ai-helper/
├── vectors/            Animation Mode: pose one SVG frame into the next
└── graphic-designer/   Design language: read an asset, then draw more like it
```

| Plugin | What it does | Command |
| --- | --- | --- |
| [`vectors`](vectors/) | Draws the next Animation Mode frame from the form the app writes, and carries the Bezier and layer-structure knowledge behind it | `/vectors:animation-mode` |
| [`graphic-designer`](graphic-designer/) | Reads a media file into a `DESIGN_LANGUAGE.md`, then generates a per-asset skill and scripts that compose new work in that language | `/graphic-designer:design-language` |

## Installing

Both plugins are tracked source, so a clone already has them. What installing
does is put them where an AI tool looks.

```bash
npm run ai-helper -- --list                     # targets and helpers
npm run ai-helper                               # every helper -> .claude
npm run ai-helper -- --to github                # -> .github
npm run ai-helper -- --helper graphic-designer  # narrow to one helper
npm run ai-helper -- --to plugin                # check the plugins, print /plugin
```

A dot-folder target copies each helper's skills and instructions into it. The
`plugin` target copies nothing, because the folder already is the plugin; it
checks the tree, syncs the manifest version to `package.json`, and prints the
commands that load it:

```text
/plugin marketplace add .
/plugin install vectors@napkin-sketch
/plugin install graphic-designer@napkin-sketch
```

Without a clone, `/plugin marketplace add isocialPractice/napkin-sketch`
reaches the same two.

## Animation Mode is a feature switch, not a file copy

Animation Mode is the one part of the app gated on an install record. Turning
it on and off is its own script, which only ever touches the `vectors` helper:

```bash
npm run animation-mode -- --status
npm run animation-mode -- --install --to plugin
npm run animation-mode -- --uninstall
```

It writes `ai-helper/installed.json` (gitignored), and the app reads that one
file to decide whether the mode exists. `graphic-designer` has no such switch:
nothing in the GUI runs it, so there is nothing to gate.

## Adding a helper

1. Make `ai-helper/<name>/` with a `.claude-plugin/plugin.json`, and whichever
   of `commands/`, `agents/`, `instructions/` and `skills/` it needs.
2. Add an entry to `HELPERS` in
   [`scripts/install-ai-helper.mjs`](../scripts/install-ai-helper.mjs) - the
   installer derives everything else from it.
3. Add the matching constant in
   [`src/core/ai-tool.ts`](../src/core/ai-tool.ts). A test fails if the two
   registries disagree, because the script cannot import the TypeScript.
4. Add a plugin entry to the root marketplace manifest.

Skill names are global once a tool loads them, so every `SKILL.md` in the
tracked tree must declare a name no other one does. `test/ai-helper.test.ts`
enforces that across all the helpers at once.
