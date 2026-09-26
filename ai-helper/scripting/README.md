# scripting

Write napkin scripts - the drawing language of napkin-sketch - from a request.
`napkin-sketch draw --prompt "a three-box flowchart with arrows"` runs an AI
tool with this helper's skill, the tool writes the script, and napkin-sketch
checks it and draws it. The point is that a sentence becomes a drawing that is
still a script: editable, checkable, and drawn the same way every time after.

```text
scripting/
├── .claude-plugin/plugin.json
├── commands/draw.md                        /scripting:draw
├── instructions/napkin-script.instructions.md
└── skills/
    └── napkin-script/                      the language, and how to write it well
        ├── SKILL.md
        └── references/
            └── verbs.md                    every verb, generated from the verb table
```

## Using it

From a shell, with an AI tool on the PATH:

```bash
napkin-sketch draw --prompt "a three-box flowchart with arrows" --to svg,png
```

That writes `flowchart.svg`, `flowchart.png` and the script itself,
`flowchart.napkin`, named after the page the script names. In an AI tool that
has the helper:

```text
/scripting:draw a three-box flowchart with arrows
```

## How a request becomes a drawing

1. `draw --prompt` writes a form to `_temp/script-form.txt` in the working
   folder: the request, the rules the parser holds a script to, and the images
   and documents `--asset` and `--use` hand over.
2. It runs the helper command there - `$NAPKIN_SCRIPT_HELPER`, or `--helper`,
   or by default `claude -p --model sonnet --dangerously-skip-permissions <
   _temp/script-form.txt` - and the tool saves the script to
   `_temp/script-out.napkin`.
3. The script is checked as `napkin-sketch check` checks one. With errors, the
   tool runs once more with the script and its diagnostics in the form.
4. The script is kept as `<name>.napkin` beside the files, and drawn.

A tool that is missing, not signed in, or saves no script ends the command
with exit code 4, and the message says which and what to do.

## Installing

```bash
npm run ai-helper -- --helper scripting              # -> .claude
npm run ai-helper -- --helper scripting --to github  # -> .github
npm run ai-helper -- --helper scripting --to plugin  # check + print /plugin
```

Or as a plugin, with the marketplace at the repository root:

```text
/plugin marketplace add .
/plugin install scripting@napkin-sketch
```

## The verb reference is generated

`skills/napkin-script/references/verbs.md` is written by `npm run api-docs`
from `src/core/script/verbs.json`, the table the parser itself reads, and the
test suite fails when it is out of date. Never edit it by hand: change the verb
table and run the generator.
