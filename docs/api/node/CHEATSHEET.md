# Using napkin-sketch from code: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for the package as a dependency: the two entries, the calls, their options, the result and what throws.

## The two entries

| Import | Runs in | For |
| --- | --- | --- |
| `import { ... } from 'napkin-sketch'` | A browser, Node, any bundler | The editor, the model, compositions, and the language |
| `import { ... } from 'napkin-sketch/node'` | Node 18 and later | Reading and writing files |
| `const { ... } = await import('napkin-sketch/node')` | CommonJS | The same, where `require` cannot load an ES module |

## `napkin-sketch`: the language

| Call | Gives |
| --- | --- |
| `parseScript(text)`, `validateScript(json)` | `{ ok, script, diagnostics }` |
| `formatScript(script)` | Canonical text |
| `evaluate(source, options)` | `{ ok, book, diagnostics, stats, output, seed }` |
| `drawSvg(source, options)` | `{ ok, svg, diagnostics }`: the first page, in one call |
| `renderSketch(page, options)`, `renderBook(book, options)` | Strings and bytes, by `format` |
| `inkBox(page)`, `renderBox(page, options)` | The box the output is cut to |
| `sketchToComposition(page)` | The page as a composition, to add to in code |
| `formatDiagnostic(d, 'card.napkin')` | `card.napkin:3:1: error unknown-verb: ...` |
| `SCRIPT_VERSION`, `SCRIPT_LIMITS`, `VERBS`, `DIAGNOSTICS` | The language's version, budget and tables |

## `napkin-sketch/node`: files

| Call | Does |
| --- | --- |
| `drawFile('card.napkin', options)` | Reads a script file and writes every format asked for |
| `drawToFiles(source, options)` | The same, for a script in hand: text or JSON |
| `writeBook(book, options)` | Writes a book already in hand |
| `readScript('card.napkin')` | Text, or the JSON value of a `.json` file |
| `loadAssets({ logo: 'art/logo.png' }, from)` | `{ logo: 'data:image/png;base64,...' }` |
| `loadDocuments({ badge: 'badge.skbk' }, from)` | The books, for `use` |
| `resolveLinkFromDir('brand')` | A link resolver jailed to one folder |
| `imageDataUrl`, `writeComposition`, `mediaTypeOf` | The composition file helpers |

## `drawFile` and `drawToFiles` options

| Option | Default | Meaning |
| --- | --- | --- |
| `out` | the working folder | Where the files go; made when missing |
| `formats` | `['svg']` | Any of `svg`, `png`, `pdf`, `skbk`, `jsx` |
| `name` | the first page's | The files' name |
| `assets`, `documents` | none | Data URLs and books, or paths read with the loaders |
| `base` | the script's folder for `drawFile` | The folder links are read inside, and a `.jsx` places them from |
| `strict` | `false` | Write nothing unless nothing at all was reported |
| `crop`, `registration`, `transparent`, `scale` | the script's own | As the render calls take them |
| `seed`, `timestamp`, `limits` | | As `evaluate` takes them |

## The result

| Field | Holds |
| --- | --- |
| `ok` | No errors; with `strict`, nothing reported at all |
| `files` | `{ path, format, page }`, `page` from 1 for SVG and PNG |
| `diagnostics` | Everything the script reported, in reading order |
| `stats` | `instructions`, `marks`, `anchors`, `points`, `pages` |
| `warnings` | What a format left out or drew as a stand-in |

## File names

| Book | SVG, PNG | PDF, `.skbk`, `.jsx` |
| --- | --- | --- |
| One page | `card.svg` | `card.pdf` |
| Three pages | `card-1.svg`, `card-2.svg`, `card-3.svg` | `card.pdf`, all three pages |

## What throws

| Throws | When |
| --- | --- |
| `readScript`, `drawFile` | The file cannot be read; a `.json` file is not a JSON array |
| `loadAssets`, `loadDocuments`, and the draws given them | A file cannot be read, or a document is not a book |
| `drawFile`, `drawToFiles`, `writeBook` | `out` cannot be made or written to |
| The render calls | An unknown format |

- Nothing in a script throws: a mistake is a diagnostic, and the rest is drawn.

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| `import { drawFile } from 'napkin-sketch'` | `from 'napkin-sketch/node'` | The first entry reads no files. |
| `require('napkin-sketch/node')` | `await import('napkin-sketch/node')` | Both entries are ES modules, which `require` loads only on a Node that can. |
| `try { await drawFile(...) } catch` for script errors | Check `ok` and `diagnostics` | Script errors are values, not exceptions. |
