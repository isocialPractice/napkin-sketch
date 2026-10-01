# The napkin script language: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for the language: syntax, values, the verbs that shape a script, functions, the budget and every diagnostic code.

## Syntax

| Write | Means |
| --- | --- |
| `napkin 1` | The first line: the language version. Without it, a `version-missing` warning. |
| `line 0 0 10 10; line 10 10 20 0`, `color #1f2328 width 3` | One instruction a line - the verb, then its arguments - or several with `;` between; paint verbs share a line, nothing else does. |
| `group "Figure" { ... }` | A block, for `group`, `clip`, `define`, `repeat`, `wipe`, `stack` and `path`. |
| `# a comment`, `RECT` | `#` and a space comments to the end of the line (`#note` with no space is read as an argument); verbs, keywords and choices ignore case. |

## Values

| Kind | Text | JSON |
| --- | --- | --- |
| Number | `12`, `-3.5`, `1e3` | `12` |
| Length | `120`, `10mm`, `0.5in`, `12pt`, `4px`, `50%` | `120`, `"10mm"`, `"50%"` |
| Expression, anywhere a number or a length goes | `(width / 2)`, `(i * 40 + 20)` | `{ "expr": "width / 2" }` |
| String | `"Acme Corp"`, `"one\ntwo"` | `"Acme Corp"` |
| Color | `#1f2328`, `steelblue`, `rgb(31, 35, 40)` | `"#1f2328"` |
| Switch | `on`, `off` | `true`, `false` |
| Points | `0 0, 10 0, 5 8` | `[{ "x": 0, "y": 0 }, ...]` |
| Stops | `(#ffffff 0, #000000 1)` | `[{ "color": "#ffffff", "offset": 0 }, ...]` |

## The verbs that shape a script

<!-- language-verbs:start -->
| Category | Verb | Written | Does |
| --- | --- | --- | --- |
| Document | `napkin` | `napkin <version>` | The language version the script was written for. The first line of a script; without it version 1 is assumed, with a warning. |
| Document | `page` | `page <paper> [portrait\|landscape]`<br>`page <width> <height> [portrait\|landscape]` | The page size: a named size (a3, a4, a5, letter, legal, tabloid, square, slide, napkin) or a width and a height, turned portrait or landscape. |
| Document | `background` | `background <color>`<br>`background none` | The page color, or none for a transparent page. |
| Document | `name` | `name "<name>"` | The page's name, and the file stem it is written under. |
| Document | `units` | `units px\|in\|mm\|pt` | The unit bare numbers are read in from here on: px, in, mm or pt. Pixels until changed. |
| Document | `seed` | `seed <n>` | The seed for the hand-drawn pass. One script and one seed draw the same bytes every run. |
| Document | `newpage` | `newpage ["<name>"]` | Starts another page the same size, carrying the paint state across. |
| Transforms | `push` | `push` | Saves the transform, the paint state and the units, for the next pop to restore. |
| Transforms | `pop` | `pop` | Restores the transform, the paint state and the units the last push saved. |
| Transforms | `translate` | `translate <dx> <dy>` | Moves everything drawn after it. |
| Transforms | `rotate` | `rotate <degrees> [at <x> <y>]` | Turns everything drawn after it, clockwise in degrees, about the origin or a point given with at. |
| Transforms | `scale` | `scale <s> [<sy>] [at <x> <y>]` | Scales everything drawn after it, about the origin or a point given with at. One factor scales both ways. |
| Transforms | `mirror` | `mirror x\|y [at <position>]` | Reflects everything drawn after it: x swaps left and right across a vertical line, y swaps top and bottom across a horizontal one, at 0 unless given. |
| Control | `let` | `let <name> <value>` | Names a number for the expressions after it, in the current units. |
| Control | `define` | `define "<name>" { ... }` | Records a block of drawing under a name without drawing it, for place to draw. |
| Control | `place` | `place "<name>" [at <x> <y>] [scale <s>] [rotate <degrees>]` | Draws a definition, moved, scaled or turned. |
| Control | `repeat` | `repeat <count> [as <name>] { ... }` | Runs a block a number of times, counting from 0 in the name given with as. |
<!-- language-verbs:end -->

- What the other verbs draw: [the drawing cheatsheet](../drawing/CHEATSHEET.md); every verb on one line: [API-CHEATSHEET.md](../../../API-CHEATSHEET.md).

## Functions

<!-- functions:start -->
| Function | Takes | Gives |
| --- | --- | --- |
| `sin` | a number | The sine of an angle in degrees. |
| `cos` | a number | The cosine of an angle in degrees. |
| `tan` | a number | The tangent of an angle in degrees. |
| `sqrt` | a number | The square root. |
| `abs` | a number | The value without its sign. |
| `round` | a number | The nearest whole number. |
| `floor` | a number | The whole number at or below. |
| `ceil` | a number | The whole number at or above. |
| `min` | 2 or more numbers | The smallest of two or more values. |
| `max` | 2 or more numbers | The largest of two or more values. |
<!-- functions:end -->

## The budget

<!-- limits:start -->
| Limit | Default | Counts |
| --- | --- | --- |
| `instructions` | 200,000 | Instructions run, every pass through a `repeat` counted |
| `marks` | 50,000 | Marks drawn |
| `anchors` | 250,000 | Bezier anchors, across every mark |
| `points` | 1,000,000 | Points sampled from those anchors for the canvas to paint |
| `depth` | 64 | Blocks open at once: groups and clips, placed definitions, repeats, wipes and stacks |
<!-- limits:end -->

## In code

| Call | Gives |
| --- | --- |
| `parseScript(text)`, `validateScript(json)` | `{ ok, script, diagnostics }` from text or the object form, `{ fragment }` for a piece of one; never throws |
| `formatScript(script)`, `formatDiagnostic(d, 'card.napkin')` | The script as canonical text; a diagnostic as `card.napkin:3:1: error unknown-verb: ...` |

## Diagnostic codes

<!-- diagnostics:start -->
| Code | Level | Meaning |
| --- | --- | --- |
| `unknown-verb` | error | A line starts with a word that is not a verb. |
| `misplaced-verb` | error | A verb where it cannot appear: a path step outside a path block, a napkin line after the first, a layer inside a path, a newpage inside a group or a definition, a layer, group, clip or use inside a wipe or a stack. |
| `unsupported-verb` | error | The verb, or this way of writing it, is known but not drawn by this build or by the host running the script; the instruction is skipped. |
| `expected-number` | error | A number, or an expression in parentheses, was expected. |
| `expected-length` | error | A length was expected: a number, a number with a unit (10mm, 0.5in, 12pt, 4px), a percentage, or an expression. |
| `expected-string` | error | A double-quoted string was expected. |
| `expected-identifier` | error | A bare name was expected: letters, digits and underscores, starting with a letter. |
| `expected-color` | error | A CSS color was expected, such as #1f2328, red or rgb(31, 35, 40). |
| `expected-choice` | error | One word from a fixed list was expected; the message lists them. |
| `expected-points` | error | A list of points was expected: x y pairs separated by commas. |
| `expected-stops` | error | A list of gradient stops was expected: (color offset, color offset, ...). |
| `unexpected-token` | error | Something is left on the line after the instruction was read, or a character that cannot start anything. |
| `missing-argument` | error | A required argument is missing; the message names it and shows how the verb is written. |
| `expected-block` | error | A block was expected: { at the end of the line, the instructions it holds, and } to close it. |
| `unclosed-block` | error | A block opened with { is never closed with }. |
| `unexpected-close` | error | A } closes a block that was never opened. |
| `unclosed-string` | error | A string runs to the end of the line without its closing quote. |
| `invalid-expression` | error | An expression could not be read: an unknown operator, a missing operand, or an unclosed parenthesis. |
| `unit-unknown` | error | A number carries a unit the language does not know. The units are px, in, mm and pt, and % for a share of the page. |
| `invalid-value` | error | A value is out of range: an opacity above 1, a negative radius, a star with fewer than 2 points, a percentage where the page cannot measure one. |
| `version-missing` | warning | The script does not start with napkin <version>; version 1 is assumed. |
| `version-unsupported` | error | The script names a version newer than this build reads; the message names the newest it does. |
| `unknown-variable` | error | An expression uses a name no let or repeat has set. |
| `unknown-definition` | error | place names something no define recorded. |
| `unknown-shape` | error | shape names something the shape library does not have. |
| `unknown-asset` | error | image names an asset the host did not supply. |
| `unknown-document` | error | use names a document the host did not supply. |
| `image-size-unknown` | warning | An image's size cannot be read from its data, so it is placed square: 100 by 100, or the one size given by itself. |
| `glyph-missing` | warning | text as marks has a character the built-in face does not draw; it is left as a gap. |
| `unknown-field` | warning | An instruction in a JSON script has a field its verb does not have; it is left out. |
| `recursive-definition` | error | A definition places itself, directly or through another definition. |
| `division-by-zero` | error | An expression divides by zero. |
| `budget-exceeded` | error | The script ran more instructions, drew more marks, emitted more anchors or sampled points, or nested deeper than the limit allows; what it drew up to that point is kept. |
| `pop-without-push` | error | pop with nothing saved to restore. |
| `unbalanced-push` | warning | A push is never popped before its block ends; the saved state is restored there anyway. |
| `duplicate-definition` | warning | A second define replaces an earlier one of the same name. |
| `link-unresolved` | warning | A linked file could not be read for an output that has to draw it, so its placeholder was drawn instead. |
| `unused-effect` | warning | An effect nothing took: no layer, group or mark followed it before its block, its page or the script ended. |
| `wipe-skipped` | warning | A wipe's or a stack's block drew marks it cannot combine - text, pictures, linked files, eraser marks - and they are drawn as they are. |
| `wipe-empty` | warning | A wipe or a stack left nothing: out-front's bottom mark wholly covered by the rest, say, or a stack remove taking every piece. |
| `wipe-failed` | warning | A wipe or a stack could not combine its block's marks - fewer than two it can combine, more than it takes, or geometry it could not make - so they are drawn as they are. |
| `stack-missed` | warning | A stack point is on none of the pieces its block's marks make, so it picks nothing; the message says which. |
| `split-missed` | warning | A split point is within 4 px of no path drawn so far, or lands on the end of an open one, so nothing is cut. |
| `clip-open` | warning | A clip block drew no closed shape to clip with, so it is a plain group. |
| `smear-missed` | warning | A smear reaches no pencil mark drawn so far, so it spreads nothing. |
| `liquify-missed` | warning | A warp, twirl, pucker or bloat reaches no mark it bends drawn so far, so it bends nothing. |
| `erase-skipped` | warning | An eraser line reaches text or a picture, which it cannot cut, and passes over it. |
<!-- diagnostics:end -->

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| `circle i*40 50 gap` | `circle (i * 40) 50 (gap)` | Arithmetic goes in parentheses, and so does a name where a number goes. |
| A script with no `napkin 1` | `napkin 1` first | A `version-missing` warning, which `--strict` fails. |
