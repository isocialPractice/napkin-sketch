# vectors

The AI-facing half of [napkin-sketch](https://github.com/isocialPractice/napkin-sketch), as a
Claude Code plugin. This folder is the plugin root and the only copy of everything in it: the
dot-folder installs and the plugin load the same files, so nothing here is generated and nothing
here is duplicated elsewhere in the repository.

```text
ai-helper/
  .claude-plugin/plugin.json   the manifest (listed by /.claude-plugin/marketplace.json at the repo root)
  commands/animation-mode.md   /vectors:animation-mode - draw one frame from the app's form
  agents/animation-frame.md    the same job as a subagent, so frame SVG stays out of the main context
  skills/vector-animations/    assemblies, joint pivots, cycle tables, the transform recipe
  skills/vector-graphics/      Bezier formulas, degree choice, SVG layer structure, path scripting
  instructions/                the contract a helper follows when the app hands it a frame
```

## Install it as a plugin

From a clone, with Claude Code started in the repository root:

```text
/plugin marketplace add .
/plugin install vectors@napkin-sketch
```

Without a clone:

```text
/plugin marketplace add isocialPractice/napkin-sketch
/plugin install vectors@napkin-sketch
```

Either way the skills answer to `vectors:vector-animations` and `vectors:vector-graphics`, the
command is `/vectors:animation-mode`, and the subagent is `vectors:animation-frame`.

## Install it as plain files instead

Tools that do not load plugins read a dot-folder. The installer copies the skills and the
instructions into one:

```bash
npm run ai-helper -- --to claude     # .claude (the default)
npm run ai-helper -- --to github     # .github (Copilot)
npm run ai-helper -- --to cursor     # any other tool's dot-folder
npm run ai-helper -- --to plugin     # check this folder and print the /plugin commands
npm run ai-helper -- --list          # every known target
```

Turning napkin-sketch's Animation Mode on or off is a different command, and it is the one that
records which delivery the app should assume:

```bash
npm run animation-mode -- --install --to plugin
npm run animation-mode -- --status
npm run animation-mode -- --uninstall
```

`installed.json` is that record. It is written by the install, ignored by git, and is the only
thing the app reads to decide whether Animation Mode exists.
