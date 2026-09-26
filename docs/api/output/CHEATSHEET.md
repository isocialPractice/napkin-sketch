# Writing a drawing out: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for writing a drawing out: the two calls, their options, the box, and what each format keeps.

## The calls

| Format | `renderSketch(page, options)` | `renderBook(book, options)` | Write it as |
| --- | --- | --- | --- |
| `svg` | a string | a string a page | UTF-8 |
| `png` | a `Uint8Array` | a `Uint8Array` a page | bytes |
| `pdf` | a string | one string, a PDF page a sketch | `latin1` |
| `skbk` | a string: a book of that page | one string | UTF-8 |
| `jsx` | a string: a script for that page | one string, a document a page | UTF-8 |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `format` | `'svg'` | `svg`, `png`, `pdf`, `skbk` or `jsx` |
| `crop` | the whole page | `'auto'`, `{ mode: 'auto', pad: 12 }`, `'none'`, or `{ x, y, width, height }` |
| `registration` | none | One box for every page; wins over `crop` |
| `transparent` | `false` | No paper in the SVG, the PNG or the `.jsx` |
| `scale` | `1` | PNG pixels a page pixel |
| `resolveLink` | none | Reads linked files for the PNG: `resolveLinkFromDir(folder)` |
| `decodeImage` | none | Decodes images the PNG cannot: anything but PNG |
| `linkFolder` | beside the script | Where a `.jsx` looks for linked files; `writeBook` and `drawToFiles` set it |
| `onWarning` | none | Told what a format left out or drew as a stand-in |

- `...output` from `evaluate` applies the script's own `crop` and `registration`.

## The output verbs

<!-- output-verbs:start -->
| Category | Verb | Written | Does |
| --- | --- | --- | --- |
| Output | `crop` | `crop auto [pad <length>]`<br>`crop none`<br>`crop <x> <y> <width> <height>` | The box every output is cut to: auto fits the ink with room to spare, none keeps the page, or a box given outright. |
| Output | `registration` | `registration <x> <y> <width> <height>` | One box every page is written in, so frames drawn by one script line up when they are played in sequence. |
<!-- output-verbs:end -->

## What each format keeps

| | SVG | PNG | PDF | `.skbk` | `.jsx` |
| --- | --- | --- | --- | --- | --- |
| Layer tree and names | Yes, named three ways | Composited | Flattened | Yes | Layers and named groups, hidden and locked ones too |
| Bezier anchors | Yes, two decimals | Drawn | Vector lines through the sampled points | Yes | Yes, two decimals |
| Gradients | Yes | Yes | Flat fill, warned | Yes | Yes |
| Dashes, profiles, Copic nibs | Yes | Yes | Yes | Yes | Yes |
| Text | Live `<text>`, the named font | The built-in face | Helvetica | Yes | Text frames, the named font where Illustrator has it |
| Images | Embedded | PNG; the rest with `decodeImage` | JPEG only, warned | Yes | Embedded |
| Links | The reference | The file with `resolveLink`, else the placeholder | The placeholder | The reference | Placed by link |
| Erasers | A mask on the layer | Clear their own layer | Paint the paper back | Yes | Paint the paper back, warned |
| Effects | A `<filter>`, and `data-effects` | Drawn | Left out, warned | Yes | Left out, warned |
| Transparency | `transparent: true` | `transparent: true` | A transparent page prints no paper | - | `transparent: true` |

## The box

| Want | Script | Options |
| --- | --- | --- |
| The whole page | `crop none` | `crop: 'none'` |
| The ink | `crop auto` | `crop: 'auto'` |
| The ink and room | `crop auto pad 12` | `crop: { mode: 'auto', pad: 12 }` |
| A box | `crop 40 40 200 100` | `crop: { x: 40, y: 40, width: 200, height: 100 }` |
| Frames that line up | `registration 50 70 300 180` | `registration: { x: 50, y: 70, width: 300, height: 180 }` |
| The box before writing | | `inkBox(page)`, `renderBox(page, options)` |

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| `writeFileSync('card.pdf', pdf)` | `writeFileSync('card.pdf', pdf, 'latin1')` | UTF-8 mangles an embedded image's bytes. |
| `renderBook(book, { format: 'png' })` | `renderBook(book, { format: 'png', ...output })` | The script's `crop` rides in `output`, not in the book. |
| A JPEG placed, a PNG rendered | Pass `decodeImage` | The PNG decodes only PNG itself; the image is left out, with a warning. |
