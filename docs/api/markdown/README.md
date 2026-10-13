# Markdown Flow and Clean Language Accents

[API hub](../../../API.md) · **Reference** · [Quickstart](QUICKSTART.md) · [Cheatsheet](CHEATSHEET.md)

`@isocialpractice/napkin-sketch/markdown` gives `@isocialpractice/napkin-sketch` its readers: marked's lexer, so
a Markdown Flow text draws as its Markdown renders, and highlight.js, so code
is colored as its language reads it. This page is the reference for that
entry, for the calls in `@isocialpractice/napkin-sketch` that read with what it gives, and for
installing a language beyond the 36 common ones.

**Contents**

- [What this is](#what-this-is)
- [The mental model](#the-mental-model)
- [Reference](#reference)
  - [The entry](#the-entry)
  - [Reading Markdown: markdownToType](#reading-markdown-markdowntotype)
  - [A text in Markdown Flow](#a-text-in-markdown-flow)
  - [Coloring code: accentRuns](#coloring-code-accentruns)
  - [Installing a language: registerAccentLanguage](#installing-a-language-registeraccentlanguage)
  - [Themes and the page](#themes-and-the-page)
  - [Readers of your own](#readers-of-your-own)
- [Worked examples](#worked-examples)
- [Limits](#limits)
- [For agents](#for-agents)
- [See also](#see-also)

## What this is

Two of the app's type features read text with libraries: **Markdown Flow**,
where a text is typed as Markdown and shown as it renders, reads with
[marked](https://marked.js.org)'s lexer; **Clean Language Accents**, where
code is colored by its language, reads with
[highlight.js](https://highlightjs.org). The core holds neither. It reads
with the lexer and the highlighter it is given, so `@isocialpractice/napkin-sketch` stays
small and runs anywhere, and `@isocialpractice/napkin-sketch/markdown` is the entry that gives
them.

Importing it once is all a program does. After that, `@isocialpractice/napkin-sketch` draws a
Markdown Flow text as its Markdown renders, colors a fenced code block whose
language is installed, and colors a paragraph's `accent`: on the page, in SVG,
PDF and PNG, and in an Illustrator script. The command line, the app and
`@isocialpractice/napkin-sketch/node` import it already.

## The mental model

```text
 import '@isocialpractice/napkin-sketch/markdown'
    --> setMarkdownLexer(marked's lexer)          Markdown Flow reads with it
    --> setAccentHighlighter(highlight.js, 36)    Clean Language Accents read with it

 a text, flow markdown --> markdownToType --> what is shown: text, runs, paragraphs
 code + a language    --> accentRuns     --> colored runs, in Napkin Light or Dark
 registerAccentLanguage(id, definition)   --> one more of highlight.js's 193
```

What is drawn is worked out as the text is laid out, never stored: the
Markdown stays the text, and the accent stays the paragraph's language.

## Reference

### The entry

| Export | What it is |
| --- | --- |
| `markdownToType(source, theme?, options?)` | Markdown read with marked's lexer: what a text shows |
| `registerAccentLanguage(id, definition?)` | Installs a language; true when it is installed |
| `unregisterAccentLanguage(id)` | Takes a language away: its code is plain from then on |
| `accentLanguagesInstalled()` | The ids installed now, the 36 common ones to begin with |
| `markedLexer` | marked's lexer, as Markdown Flow reads with it |
| `hljsHighlighter` | highlight.js, as Clean Language Accents read with it |
| `MARKDOWN_THEME`, `MARKDOWN_CONFIG_NAMES` | How each part of Markdown looks, and the Text Configurations that style it |
| `markdownEnter(source, index)` | What Enter does at `index`: a list or a quote carried on |

It shares one core with the package's other entries and the command line,
so the readers it registers are the ones every entry reads with - a
language installed through it colors code drawn through
`@isocialpractice/napkin-sketch/node` too - in one program however many
times any of them is imported.

### Reading Markdown: markdownToType

`markdownToType(source)` reads Markdown as a text shows it: its `text`, with
the Markdown taken out; `runs`, the attributes of each stretch, a Text
Configuration's link among them; `paras`, each paragraph's alignment, list,
shade and quote bar; `configs`, the configurations the runs follow; `map`,
where in the source each character came from; and `blocks`, the source's
blocks. Headings, emphasis, inline and fenced code, lists and task lists,
quotes, rules, links and GitHub's tables are read; an image is its alt text.

```js
import { markdownToType } from '@isocialpractice/napkin-sketch/markdown';

const shown = markdownToType('# Acme Corp\n\nSales are **up**:\n\n- Widgets\n- Gadgets');
shown.text; // 'Acme Corp\nSales are up:\nWidgets\nGadgets'
shown.paras[2]?.list; // { kind: 'bullet', level: 1 }
```

### A text in Markdown Flow

A text whose `typeset.flow` is `markdown` keeps its Markdown as its text and
is drawn as the Markdown renders. A script makes one with `markdown`:

```napkin
textconfig "Markdown Heading 1" color #27486d
text "# Acme Corp\n\nSales are **up**:\n\n- Widgets\n- Gadgets" at 40 60 size 14 markdown
```

Each part is styled by a Text Configuration of the book's - Markdown Heading
1 to 6, Markdown Code, Markdown Code Block, Markdown Quote and Markdown Link -
so restyling one restyles every text that uses it. `withMarkdownConfigs`
gives a text the ones it is missing, `markdownShown` is the text as it is
drawn, and `markdownMissing` names the fenced blocks whose language is not
installed.

### Coloring code: accentRuns

`accentRuns(code, language)` colors code as a language reads it: its `runs`,
each a stretch, the highlight.js scope that colors it and the color; the
`language` it was read as; and `missing`, the language asked for when none is
installed by that name. A language is its id or an alias (`py`, `ts`), `auto`
for the installed language it reads most like, or `none`.

```js
import { accentRuns } from '@isocialpractice/napkin-sketch';
import '@isocialpractice/napkin-sketch/markdown';

const { runs, language } = accentRuns('def total(prices):\n    return sum(prices)', 'py');
language; // 'python'
runs[0]; // { start: 0, end: 3, scope: 'keyword', color: '#cf222e' }
```

A paragraph's `accent` colors it the same way as the text is laid out, a run
of paragraphs with one accent read as one piece of code; `applyAccent` sets
it, and a script's `accent python` does it for the next text.

### Installing a language: registerAccentLanguage

The 36 languages of highlight.js's common set are installed when the entry
is imported. Any other of its 193 is installed from its definition, which
highlight.js ships one file a language:

```js
import { accentRuns } from '@isocialpractice/napkin-sketch';
import { registerAccentLanguage, unregisterAccentLanguage } from '@isocialpractice/napkin-sketch/markdown';
import fortran from 'highlight.js/lib/languages/fortran';

registerAccentLanguage('fortran', fortran); // true
accentRuns('x = 1', 'fortran').language; // 'fortran'
unregisterAccentLanguage('fortran');
accentRuns('x = 1', 'fortran').missing; // 'fortran'
```

A common language taken away comes back with `registerAccentLanguage(id)`
and no definition. `ACCENT_LANGUAGES` in `@isocialpractice/napkin-sketch` lists all 193, by
id, name and aliases, and `accentLanguage(name)` finds one by any of them.

### Themes and the page

Code is colored in **Napkin Light** or **Napkin Dark** (`ACCENT_THEMES`),
every color at least 4.5:1 against its theme's code shade. Each page picks
the one its paper suits - Dark on a page white text reads better on - unless
`setAccentOptions({ theme: 'light' })` or `'dark'` picks one for all.
`setAccentOptions({ detect: true })` reads a fenced block that names no
language for the one it reads most like. Every writer colors each page for
its own paper; `withAccentPage(background, make)` does the same for a
program's own drawing.

### Readers of your own

The core takes any lexer and highlighter of the same shape:
`setMarkdownLexer(lexer)` with a function from Markdown to marked's tokens,
and `setAccentHighlighter(highlighter)` with `highlight`, `highlightAuto` and
`resolve`, giving highlight.js's HTML, which `hljsHtmlToRuns` reads - only its
spans and entities, anything else as the text it is, so nothing is ever
rendered as HTML. Null takes either away: Markdown then shows as typed, and
code is plain.

## Worked examples

A page with a Markdown Flow note and a Python listing, written as SVG:

```js
import { drawSvg } from '@isocialpractice/napkin-sketch';
import '@isocialpractice/napkin-sketch/markdown';

const { svg, diagnostics } = drawSvg(
  'napkin 1\npage 480 320\nbackground #ffffff\n' +
    'text "## Acme Corp\\n\\n- **Widgets** up\\n- Gadgets steady" at 40 60 size 16 markdown\n' +
    'font "Consolas" 14\naccent python\n' +
    'text "def total(prices):\\n    return sum(prices)  # in cents" at 40 200\n',
);
diagnostics.length; // 0
```

The same script draws its heading, bullets and colored code from the command
line, which imports the entry already:
`napkin-sketch draw note.napkin --to svg,png`.

## Limits

- **No readers, no rendering.** Without the entry - or readers of one's own -
  a Markdown Flow text shows its Markdown as typed, and code is plain: the
  text is never lost, only drawn as it is.
- **Images are their alt text.** A Markdown image is not fetched.
- **Detection guesses.** `auto` and detection pick the installed language
  code reads most like; a short snippet may read as another.
- **The entry is ESM**, as `@isocialpractice/napkin-sketch` is, and holds marked and
  highlight.js's common set: about 390 KB.

## For agents

- **Import `@isocialpractice/napkin-sketch/markdown` once, before drawing**, when a script has
  `markdown` or `accent`; the command line and `@isocialpractice/napkin-sketch/node` need
  nothing.
- **Name languages by id** (`python`, `typescript`); an alias reads too, and
  the script keeps the id.
- **Install a language before the text that uses it is drawn**: what is
  drawn is worked out then.
- **Read `missing`** from `accentRuns`, and `markdownMissing(text)`, to say
  which languages a drawing needs installed.

## See also

- [Drawing with napkin script](../drawing/README.md#text): `text ...
  markdown`, `textconfig` and `accent`.
- [Using napkin-sketch from code](../node/README.md): the package's entries.
- [The drawing engines](../engines/README.md): the type engine, Text
  Configurations and the layout these readers feed.
- [`src/markdown/`](../../../src/markdown/): the entry, marked's lexer and
  highlight.js's reader; and
  [`src/core/type/markdown-flow.ts`](../../../src/core/type/markdown-flow.ts)
  and [`accents.ts`](../../../src/core/type/accents.ts), the core.
