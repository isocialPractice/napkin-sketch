# Composition Styles

*New in 1.0.0-alpha.5.0.0.*

## At a glance

- **A composition style restyles a page by its layers' names.** Each rule
  names a layer and says what to set there: the layer's own opacity, blend and
  effects, the text on it, or its paths. So a composition whose layers are
  named to match - an SVG from another program, one a script drew, or this
  page - wears one style, then another, each a click away.
- **The Composition Styles panel** (`Shift+F5`, View > Toggle Composition
  Styles Panel) lists your styles, each with a thumbnail of this page as the
  style would make it. A click applies one, as one undo step.
- **New** records the page's named layers as a style, and **Edit** names it
  and sets its rules. **Import** and **Export** read and write a style as a
  JSON file, which the command line and the API read too.
- **A rule that matches no layer** is said in a report at the bottom right,
  with the nearest layer name, and **Rename layer** gives that layer the
  rule's name and applies the style again.

## The panel

**View > Toggle Composition Styles Panel** (`Shift+F5`) opens it, docked the
first time beside the other panels; it moves, docks and closes as they do.

- **A click on a style applies it** to the page in view: every layer it
  names, restyled, as one undo step. The style last applied to the page is
  marked **Applied**.
- **The arrow keys** choose a style without applying it, **Enter** applies the
  one chosen, **F2** or a double-click edits it, and **Delete** deletes it.
- **Each thumbnail** is the page in view as the style would make it, drawn
  again a moment after the page stops changing.

The buttons under the list:

| Button | Does |
| --- | --- |
| New | Records the page's named layers as a new style: for each name, the layer's opacity, blend, visibility and effects, what every text under it shares, and what every path under it shares. Names the app gave (`Layer 3`, `Group 1`, `Brush 12`) are left out. |
| Duplicate | A copy of the chosen style, to change without losing the first. |
| Delete | Takes the chosen style out of your library. The report it leaves offers **Put it back** while it is up. |
| Import | Adds a style from a file. A file that is not a style is reported, a row for each problem. |
| Export | Saves the chosen style as a JSON file. |
| Edit | The chosen style's name and its rules, in the editor below. |

Your styles are yours, not a sketch book's: they live in the app's own folder,
one file a style, and every book can use them.

## Editing a style

**Edit** opens the style in the configuration popup: its **Name** over the
table, and a row for each rule.

| Column | Holds |
| --- | --- |
| Kind | **Layer**, **Text** or **Stroke**: what the rule styles. |
| Layer name | The layer the rule names. The names on this page are suggested as you type. |
| Styles | What the rule sets, in a few words, and **Edit...**, which opens the rule's fields. |
| From Selection | Fills the rule from the selected mark's layer, or the active layer: what a capture of that layer would set. |
| x | Takes the rule out. |

**Add Rule** adds a row, and **Save** writes the style; a rule with no layer
name is left out. A rule's **Edit...** lists every field its kind may set,
each with a check: a checked field is one the rule sets, and an unchecked one
stays as it is. Effects, a gradient and a list are written as the style file
writes them.

## What a rule sets

| Kind | Reaches | Sets |
| --- | --- | --- |
| Layer | The layer it names | Opacity, blend, Isolate Blending (a group's), visibility and effects. A **fill** and a **stroke** color for every mark under it too, unless a text or stroke rule names the same layer. |
| Text | The text on the layer and every layer under it | Any character or paragraph attribute (font, style, size, leading, tracking, capitals, color, alignment, indents, spacing, lists and the rest), a **Text Configuration** by name, **Markdown Flow** on or off, a **Clean Language Accent**, effects and a blend. |
| Stroke | The paths on the layer and every layer under it | The outline's color, width, style and profile, **No Stroke**, the fill or a gradient, opacity, effects and a blend. |

- **What a rule leaves out stays as it was.**
- **The nearer rule wins.** A rule on a group reaches every layer in it; a rule
  on a layer inside the group, where it says something, says it instead.
- **A fill only fills a closed shape**, as picking a fill does: an open line
  keeps none.
- **A blend is a layer's.** A text or stroke rule's blend goes on the layer
  each of its marks sits on.
- **A Text Configuration** is named as the Type panel names it; `Default
  Configuration` is none, and the Markdown configurations can be named too.
- **Pictures keep their look.**

## Matching a name

A rule matches a layer whose name is the same once both are trimmed, in any
case: `background` matches `Background`. Every layer of that name matches, and
a rule reaches the layers under it.

## The report

A style that does not go wholly as asked raises a report at the bottom right
(see [Settings](settings.md) for how long it stays): **Midnight: 2 rules did
not match**, with a row for each thing. A row says:

- a rule that matched no layer, with the nearest layer name - two letters
  swapped count as one slip - and **Rename layer**, which gives that layer the
  rule's name and applies the style again, as one undo step;
- a text rule on a layer with no text, and a stroke rule on one with no paths;
- a configuration the book does not have, the rule's other styles applied;
- a value past its range, held to it.

A style that goes as asked says **Applied Midnight**, and nothing else.

## The file

A style is JSON, the same in the app, on the command line and in code:

```json
{
  "napkinCompositionStyle": 1,
  "name": "Midnight",
  "layers": {
    "Background": { "fill": "#000133" },
    "Badge": { "blend": "stack", "effects": [{ "type": "outer-glow", "blur": 6, "color": "#4cae50" }] }
  },
  "text": { "Title": { "config": "Heading", "color": "#ffffff", "align": "center" } },
  "strokes": { "Outline": { "color": "#4cae50", "width": 2, "strokeStyle": "dashed" } }
}
```

Every field is optional. The format is
[a JSON Schema](../../api/schema/composition-style.schema.json) too, and the
[compose reference](../../api/compose/README.md#composition-styles) lists every
field.

## On the command line and in code

- **The command line** restyles every page a script draws:
  `napkin-sketch draw card.napkin --composition-style midnight.json`. A rule
  that matched nothing is a warning; see [the CLI reference](../../api/cli/README.md#draw).
- **The API** has `applyCompositionStyle`, for a page or a composition, and
  `captureCompositionStyle` and `validateCompositionStyle` beside it.
- **The embedded editor** has `applyCompositionStyle(style)`, which gives the
  report.
