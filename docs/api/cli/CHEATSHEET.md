# The napkin-sketch command line: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for the four commands: their flags, exit codes, the JSON report and the calls from other languages.

## Commands

<!-- commands:start -->
| Command | Does |
| --- | --- |
| `napkin-sketch draw <script \| ->` | Draw a napkin script to svg, png, pdf, skbk or jsx files. |
| `napkin-sketch check <script \| ->` | Read and run a script, report what is wrong, write nothing. |
| `napkin-sketch render <book.skbk>` | Write a sketch book as svg, png, pdf, skbk or jsx files, or its figure as animation frames. |
| `napkin-sketch verbs` | List napkin script's verbs and the shape library. |
<!-- commands:end -->

## Flags

<!-- command-flags:start -->
| Flag | draw | check | render | verbs | Does |
| --- | :---: | :---: | :---: | :---: | --- |
| `--to <formats>` | yes |  | yes |  | The formats to write: svg, png, pdf, skbk, jsx, comma-separated. |
| `--out <dir>` | yes |  | yes |  | The folder to write into, made when it is missing. |
| `--name <stem>` | yes |  | yes |  | The name the files are written under. |
| `--base <dir>` | yes | yes | yes |  | The folder linked files are read inside. |
| `--asset <name>=<file>` | yes | yes |  |  | An image the script places by name; repeatable. |
| `--use <name>=<book.skbk>` | yes | yes |  |  | A book the script copies in with use; repeatable. |
| `--seed <n>` | yes | yes |  |  | The seed for the hand-drawn pass. |
| `--scale <n>` | yes |  | yes |  | PNG pixels a page pixel. |
| `--crop auto\|none\|<x,y,w,h>` | yes |  | yes |  | What every file is cut to. |
| `--limit <n>` | yes | yes |  |  | The most instructions a run may execute. |
| `--prompt <request>` | yes |  |  |  | Ask the AI helper for a script that draws this, and draw it; the script is kept as <name>.napkin. |
| `--helper <command>` | yes |  |  |  | The AI helper command --prompt runs: $NAPKIN_SCRIPT_HELPER unless given, else Claude Code. |
| `--page <n>` |  |  | yes |  | Only this page of the book, counting from 1. |
| `--animate <type>` |  |  | yes |  | Draw the page's figure through a measured cycle, a frame a page: walk, run, ideal, knocked-down. |
| `--frames <n>` |  |  | yes |  | How many frames --animate spreads the cycle across: 2 to 60, the cycle's own length unless given. |
| `--facing left\|right` |  |  | yes |  | Which way the --animate figure travels, when its feet do not say. |
| `--category <name>` |  |  |  | yes | Only this category of verbs. |
| `--json` | yes | yes | yes | yes | One line of JSON on standard output, and nothing else. |
| `--strict` | yes | yes | yes |  | Anything reported at all is a failure, and nothing is written. |
| `--quiet` | yes | yes | yes |  | Print errors and nothing else. |
<!-- command-flags:end -->

- `--to svg,png` and `--to=svg,png` both work.
- `-` in place of a script reads standard input.

## Exit codes

<!-- exit-codes:start -->
| Code | Meaning |
| --- | --- |
| `0` | It drew, the script checked clean, or the book was written. |
| `1` | The arguments were wrong: an unknown option, a bad value, no script. Nothing is written. |
| `2` | The script had errors, render was given a file that is not a book, or --animate found no figure on its page; with --strict, anything reported at all. What could be drawn is written, unless --strict. |
| `3` | A file could not be read or written. A linked file that could not be read is drawn as its placeholder and the files are written; for anything else, nothing is. |
| `4` | draw --prompt got no script back: the AI helper is not installed, is not signed in, or failed. Nothing is written. |
<!-- exit-codes:end -->

## The JSON report

| Field | Holds |
| --- | --- |
| `ok`, `exitCode` | `ok` is true exactly when `exitCode` is 0 |
| `files` | `{ path, format, page }` for each file written |
| `diagnostics` | `{ level, code, message, line, column }`; `index` for JSON scripts |
| `warnings` | What a format left out or drew as a stand-in |
| `stats` | `instructions`, `marks`, `anchors`, `points`, `pages`; `null` when nothing ran |
| `error` | `{ kind: 'usage' \| 'io' \| 'input', message }` when a command stopped |
| `version`, `language` | The package version, and the language version it reads |

## One line each

| Want | Run |
| --- | --- |
| SVG and PNG into a folder | `napkin-sketch draw card.napkin --to svg,png --out out` |
| A retina PNG cut to the ink | `napkin-sketch draw card.napkin --to png --scale 2 --crop auto` |
| A script from a pipe, JSON back | `napkin-sketch draw - --json < card.napkin` |
| An image the script places | `napkin-sketch draw card.napkin --asset logo=art/logo.png` |
| A book the script copies in | `napkin-sketch draw card.napkin --use badge=badge.skbk` |
| Links read from another folder | `napkin-sketch draw card.napkin --base brand` |
| A check that fails on warnings | `napkin-sketch check card.napkin --strict` |
| Page 2 of a saved book | `napkin-sketch render deck.skbk --page 2 --to png` |
| A figure's walk, a file a frame, no AI | `napkin-sketch render hero.skbk --animate walk` |
| Every verb's grammar as JSON | `napkin-sketch verbs --json` |

## From other languages

| Caller | The call |
| --- | --- |
| sh, bash | `napkin-sketch draw card.napkin --to svg,png --out out; echo $?` |
| Windows batch | `call napkin-sketch draw card.napkin --to "svg,pdf" --out out` |
| PowerShell | `napkin-sketch draw card.napkin --to svg,png --out out; $LASTEXITCODE` |
| Node | `spawnSync('napkin-sketch', ['draw', '-', '--json'], { input, encoding: 'utf8', shell: process.platform === 'win32' })` |
| Python | `subprocess.run([shutil.which("napkin-sketch"), "draw", "-", "--json"], input=script, capture_output=True, encoding="utf-8")` |
| C | `popen("napkin-sketch draw card.napkin --json --to svg --out out", "r")` |

- Each is a whole program in [examples/](examples/).

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| `napkin-sketch draw ...` in a `.bat` | `call napkin-sketch draw ...` | npm installs a `.cmd`; without `call` the batch file never comes back. |
| `image "art/logo.png"` in the script | `image "logo"` and `--asset logo=art/logo.png` | A script reads no files: a path is `unknown-asset`. |
| Parsing the human report | `--json`, and branch on `exitCode` and `code` | Messages are for people and may change. |
