# The AI helpers: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for the helpers and for an agent reading these pages: the commands, the files, the brand keys, and what a diagnostic asks of you.

## Getting the helper

| Want | Run |
| --- | --- |
| The plugin, from a clone | `/plugin marketplace add .` then `/plugin install graphic-designer@napkin-sketch` |
| The files, into `.claude` | `npm run ai-helper -- --helper graphic-designer` |
| The files, into `.github` | `npm run ai-helper -- --helper graphic-designer --to github` |
| The scripting helper | `/plugin install scripting@napkin-sketch`, or `npm run ai-helper -- --helper scripting` |
| Every target and helper | `npm run ai-helper -- --list` |

## Commands

| Want | Run |
| --- | --- |
| A language and a skill from an asset | `node ai-helper/graphic-designer/skills/design-language/scripts/generate-skill.mjs asset.svg --to .claude/skills` |
| An asset's palette and shares | `node .../design-language/scripts/analyze-media.mjs asset.svg --colors 12` |
| The same, as Markdown | `node .../design-language/scripts/analyze-media.mjs asset.svg --markdown` |
| The default drawing | `node .claude/skills/<stem>/scripts/make-<stem>.mjs --out ./out` |
| New words, the same language | `make-<stem>.mjs --title "Acme Corp" --heading "Quarterly Summary" --out ./out` |
| Something structurally new | `make-<stem>.mjs --cheatsheet --out ./out` |
| What the brand resolved to | `node .claude/skills/<stem>/scripts/brand-resources.mjs --print` |
| What a request turns into | `node .../design-language/scripts/brand-resources.mjs --registration` |
| The whole tour | `npm run test:graphic-design-api` |

## Drawing from a request

| Want | Run |
| --- | --- |
| A script from a sentence, drawn | `napkin-sketch draw --prompt "a three-box flowchart with arrows" --to svg` |
| Another AI tool | `--helper "<command>"`, or `NAPKIN_SCRIPT_HELPER` |
| The script in the report | `--json`, then `script.text` |
| The script inside an AI tool | `/scripting:draw a three-box flowchart with arrows` |
| The same drawing again | `napkin-sketch draw <name>.napkin`: the script was kept |

| File or code | Is |
| --- | --- |
| `_temp/script-form.txt` | The form the tool reads: the request, the rules, what is handed over |
| `_temp/script-out.napkin` | Where the tool saves the script |
| `<name>.napkin` | The script, kept beside the drawings |
| Exit `4` | No script came back: `error.reason` is `missing-tool`, `auth`, `no-script` or `other` |

## The files a skill holds

| File | Holds |
| --- | --- |
| `SKILL.md` | When to reach for it, and the language in brief |
| `DESIGN_LANGUAGE.md` | Every measurement, and every reading, marked which is which |
| `references/resources.md` | The brand: paths to draw and text to print |
| `references/graphic-design-api.json` | Which script a bare request runs, with what, and where to |
| `scripts/make-<stem>.mjs` | Draws new work; the constants at its top are the language |
| `scripts/brand-resources.mjs` | Resolves `resources.md` into placeable assets |

## `resources.md`

| Line | Is |
| --- | --- |
| `- logo: assets/logo.svg` | A path: it has a folder or a media extension |
| `- GLOBAL_ASSETS: assets/brand/` | A folder whose file names are the slots they fill |
| `- brand name: Acme Corp.` | Text to draw |
| `- domain: example.com` | Text: no folder, no media extension |
| `- tag line: This or That` | Text |

## Reading these pages as an agent

| Step | Read or run |
| --- | --- |
| 1 | `docs/api/INDEX.json`: every page, its kind, its first paragraph and its size |
| 2 | A cheatsheet, then a quickstart, then a reference page only if those do not answer |
| 3 | `napkin-sketch verbs --json`: every verb's grammar, the shapes and the codes |
| 4 | `docs/api/schema/instructions.schema.json`, for a script built as JSON |
| 5 | `napkin-sketch check - --json < card.napkin` before drawing |

## What a diagnostic asks of you

| Code | Do |
| --- | --- |
| `unknown-verb`, `unexpected-token`, `expected-*`, `missing-argument` | Rewrite the line |
| `unknown-variable` | Set the name with `let` or `repeat ... as` first |
| `unknown-asset`, `unknown-document` | Have the host pass it: `--asset`, `--use`, `assets`, `documents` |
| `budget-exceeded` | Draw less, or raise the limit deliberately |
| `version-unsupported` | Write for the version the build names |
| Any warning | It drew; `--strict` still fails it |

- Branch on `code`, never on `message`.

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| Editing a color in the layout | Edit the constant at the top of `make-<stem>.mjs` | The constants are the language. |
| An SVG logo that is missing from the PNG | Place it through `placeBrand` | An SVG placed as an image is a hole in the PNG. |
| Trusting a reading in `DESIGN_LANGUAGE.md` | Check what was measured | Readings are guesses the file marks as such. |
