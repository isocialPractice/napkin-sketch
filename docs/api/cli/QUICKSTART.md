# The napkin-sketch command line: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

Four commands draw, check and write napkin scripts from a shell, or from any
language that can start a process, without opening a window; this is the path
from a clone to files drawn on the command line.

## The whole thing in six steps

1. Build the clone and put `napkin-sketch` on your PATH:

```bash
npm install
npm run build
npm link
```

2. Save this as `card.napkin`:

```napkin
napkin 1
page 400 300
name "card"
background #fcfaf5
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 260 r 16
text "Acme Corp" at 200 120 size 32 align center
```

3. Draw it. The files written are printed one a line, and the exit code is 0:

```bash
napkin-sketch draw card.napkin --to svg,png,skbk --out out
```

4. Check it the way a program does: the script on standard input, and one line
   of JSON back.

```bash
napkin-sketch check - --json < card.napkin
```

```text
{"ok":true,"exitCode":0,"files":[],"diagnostics":[],"warnings":[],"stats":{"instructions":10,"marks":2,"anchors":8,"points":102,"pages":1},...}
```

5. Write the book the draw saved as a PDF. `render` takes any `.skbk`, one the
   app saved as well:

```bash
napkin-sketch render out/card.skbk --to pdf --out out
```

6. List what the language has, one category or all of it:

```bash
napkin-sketch verbs --category shapes
napkin-sketch verbs --json
```

## A worked example

Python drawing the card, from [examples/draw.py](examples/draw.py): the script
goes in on standard input, the report comes back as one line of JSON, and the
exit code is passed on.

```python
import json
import shutil
import subprocess
import sys
from pathlib import Path

script = Path("card.napkin").read_text(encoding="utf-8")
command = shutil.which("napkin-sketch")  # also finds the .cmd npm installs on Windows

result = subprocess.run(
    [command, "draw", "-", "--json", "--to", "svg,png", "--out", "out"],
    input=script,
    capture_output=True,
    encoding="utf-8",
)
report = json.loads(result.stdout)
for d in report["diagnostics"]:
    print(f'{d["level"]} {d["code"]}: {d["message"]}', file=sys.stderr)
if not report["ok"]:
    sys.exit(report["exitCode"])
print("drew " + ", ".join(f["path"] for f in report["files"]))
```

A shell, a batch file, Node and C do the same in [examples/](examples/), and
the test suite runs each one wherever its interpreter or compiler is installed.

## Where to go next

- [draw](README.md#draw), [check](README.md#check), [render](README.md#render)
  and [verbs](README.md#verbs): every option.
- [Exit codes](README.md#exit-codes) and
  [the JSON report](README.md#the-json-report): what a caller branches on.
- [Standard input and the object form](README.md#standard-input-and-the-object-form):
  a script built as JSON, handed over with `-`.
- [Names, folders and links](README.md#names-folders-and-links): where the
  files go, and what `--base` guards.
- [The cheatsheet](CHEATSHEET.md): every flag on one line.
