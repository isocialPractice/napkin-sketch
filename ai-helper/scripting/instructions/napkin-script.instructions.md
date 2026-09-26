---
description: 'Contract for AI helper tools that write napkin scripts for napkin-sketch, from a request or from the form napkin-sketch draw --prompt writes'
applyTo: '{**/*.napkin,**/*.napkin.json,_temp/script-form.txt}'
---

# Napkin script contract

The rules a napkin script is held to, however the job was started: by
`napkin-sketch draw --prompt`, by `/scripting:draw`, or by hand. The
`napkin-script` skill is how to write one; this is what must hold.

## The files

| File | Written by | Holds |
| --- | --- | --- |
| `_temp/script-form.txt` | napkin-sketch | The request, the rules, the images and documents the host hands over, and on a second try the last script with its diagnostics |
| `_temp/script-out.napkin` | the helper | The script, and nothing else |

- **Save once, to exactly that path.** napkin-sketch reads the file when the
  tool exits. A script the tool printed instead is read from its reply as a
  fallback, but a saved one is what the command is built around.
- **Both files are removed after the run.** The script is kept as
  `<name>.napkin` beside the files the drawing is written to, named as they
  are, so it can be edited and drawn again without asking.
- **The tool runs in the working folder** of the `napkin-sketch` command, which
  is where a project's installed copy of this helper is found.

## What a script must be

- **Text that starts `napkin 1`**, followed by a `page`.
- **One instruction a line.** Paint verbs - `color`, `width`, `opacity`,
  `fill`, `stroke`, `style`, `font` and the rest - may share a line; nothing
  else may.
- **Every name in double quotes**: layers, groups, a page's name, text, fonts,
  definitions, library shapes, images and files.
- **Only verbs from the verb table.** No invented verbs, and no SVG, CSS or
  another tool's syntax: the parser reads napkin script only. The skill's
  `references/verbs.md` is the table, generated from what the parser reads.
- **Only what the host hands over.** An `image` names one of the images the
  form lists, and a `use` one of its documents. A `link` names a file nobody has
  checked is there, so leave links out unless the request names the file.
- **Everything on the page**, with the page sized to what it holds.

## What checking does

napkin-sketch checks a saved script as `napkin-sketch check` would, with the
images and documents it will draw it with.

- **With no errors** it is drawn. A warning alone does not stop it, and is
  reported beside the files.
- **With errors** the tool runs once more, and the form carries the script and
  every diagnostic, each written `script-out.napkin:<line>:<column>: error
  <code>: <message>`. Fix every line they name, keep what works, and save the
  whole script again - not only the lines that changed.
- **After the second try** whatever can be drawn is drawn, the errors are
  reported, and the command exits with code 2, as it does for any script with
  errors.

## Failure modes

| Symptom | Cause | Answer |
| --- | --- | --- |
| The command exits 4: no script came back | The tool saved nothing to `_temp/script-out.napkin` and printed no script | Save to that path exactly, the script alone |
| `unexpected-token` on a line | Two instructions on one line, or a word after the arguments | One instruction a line; only paint verbs share one |
| `expected-string` | A name without quotes | Quote it |
| `unknown-verb` | A word from another tool, or a misspelling | Take the verb from `references/verbs.md` |
| `unknown-asset` or `unknown-document` | An image or a document the form did not list | Draw it instead, with shapes and text |
| The script is right and the drawing is off the page | Coordinates past the page's size | Size the page to what it holds, or move the marks |
| The saved file starts with a code fence | The script was wrapped as if for a chat | napkin-sketch unwraps it, but save the script alone |
