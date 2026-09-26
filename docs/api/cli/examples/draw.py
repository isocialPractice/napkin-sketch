"""Draw a napkin script from Python: hand it to the command line on standard
input and read the one line of JSON it prints back."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

script = Path("card.napkin").read_text(encoding="utf-8")

# shutil.which also finds the napkin-sketch.cmd npm installs on Windows,
# which subprocess would not find by the bare name.
command = shutil.which("napkin-sketch")
if command is None:
    sys.exit("napkin-sketch is not on the PATH")

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
