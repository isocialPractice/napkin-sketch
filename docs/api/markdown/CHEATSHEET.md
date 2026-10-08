# Markdown Flow and Clean Language Accents: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for the Markdown and code readers: the entry, the calls that read with it, languages and themes.

## The entry

| Import | Does |
| --- | --- |
| `import 'napkin-sketch/markdown'` | Gives `napkin-sketch` marked's lexer and highlight.js with 36 languages |
| `import { markdownToType } from 'napkin-sketch/markdown'` | Markdown read with marked's lexer |
| `import { registerAccentLanguage } from 'napkin-sketch/markdown'` | One more of highlight.js's 193 languages |

## Markdown Flow

| Call | Gives |
| --- | --- |
| `markdownToType(source)` | `{ text, runs, paras, configs, map, blocks }`: what a text shows |
| `markdownShown(text)` | The text as it is drawn, or null with no lexer |
| `withMarkdownConfigs(text, configs)` | The text with the Markdown configurations it lacks |
| `markdownMissing(text)` | Its fenced blocks in a language not installed |
| `MARKDOWN_CONFIG_NAMES` | Markdown Heading 1 to 6, Code, Code Block, Quote, Link |
| `markdownEnter(source, index)` | What Enter does there: a list or a quote carried on |

## Clean Language Accents

| Call | Gives |
| --- | --- |
| `accentRuns(code, language)` | `{ runs, language, missing }` |
| `applyAccent(text, range, language)` | The paragraphs a stretch touches accented; null takes it off |
| `accentLanguage(name)` | A language by id, name or alias |
| `ACCENT_LANGUAGES`, `COMMON_ACCENT_LANGUAGES` | All 193; the 36 installed to begin with |
| `registerAccentLanguage(id, definition)` | Installed; a common one needs no definition |
| `unregisterAccentLanguage(id)`, `accentLanguagesInstalled()` | Taken away; the ids installed |

## Themes

| Call | Does |
| --- | --- |
| `ACCENT_THEMES.light`, `.dark` | Napkin Light and Napkin Dark: a shade, a base and nine colors |
| `setAccentOptions({ theme })` | `auto` (each page's paper), `light` or `dark` for all |
| `setAccentOptions({ detect: true })` | A fenced block with no language read for one |
| `accentThemeFor(background)` | The theme a page's paper picks |
| `withAccentPage(background, make)` | `make` colored for a page on that paper |

## In a script

| Want | Write |
| --- | --- |
| A Markdown note | `text "# Acme Corp\n\n- one" at 40 60 markdown` |
| Its headings restyled | `textconfig "Markdown Heading 1" color #27486d` |
| Code colored | `accent python`, then the `text` |
| Code plain again | `accent none` |

## Readers of your own

| Call | Takes |
| --- | --- |
| `setMarkdownLexer(lexer)` | Markdown to marked's tokens; null for none |
| `setAccentHighlighter(highlighter)` | `{ highlight, highlightAuto, resolve }`; null for none |
| `hljsHtmlToRuns(html, theme)` | highlight.js's HTML read into colored runs, never rendered |
