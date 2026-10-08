# Type

*New in 1.0.0-alpha.5.0.0.*

## At a glance

- **Text is typed where it stands on the canvas.** The text, the caret and
  the selection are drawn on the page itself, so what you type looks as it
  will look in an export: its runs of styles, a frame it fills, a path it
  follows, vertical columns.
- **The Text tool (`T`)** reads what it clicks and what is selected. On the
  canvas it begins **Sideless Typing**, a text that grows as it is typed; in
  a selected shape, **Sheet Typing**, lines that fill the shape; on a
  selected path, **Path Typing**, characters that follow it. A drag draws a
  new text box, and a click on a text edits it (see
  [Typing a new text](#typing-a-new-text)).
- **A double-click** on a text with the Select or Direct Select tool edits it
  too, the caret where the click was.
- **`Enter` makes a new line.** `Esc` or `Ctrl+Enter` puts the text down.
- **A burst of typing is one undo step.** `Ctrl+Z` takes back what was typed
  since the last pause.
- **The editor keys** size, space, shift and align what is selected, as a
  vector editor's do (see [The editor keys](#the-editor-keys)).
- **The Type panel** (`Ctrl+Shift+T`, `Ctrl+Alt+T`) sets the font, size,
  spacing and style of the text, and its paragraphs' alignment, lists and
  indents (see [The Type panel](#the-type-panel)).
- **Text Configurations**, a vector editor's Character Styles, are named sets
  of character attributes that text follows: change one, and every text that
  follows it changes (see [Text Configurations](#text-configurations)).
- **Markdown Flow** (`Ctrl+Alt+M`) types a text as Markdown and shows it as it
  renders - headings, lists, quotes, code, tables - the block the caret is in
  showing its Markdown (see [Markdown Flow](#markdown-flow)).
- **Clean Language Accents** (`Ctrl+Alt+L`) color code as its language reads
  it, live as it is edited, in Markdown and in any text (see
  [Clean Language Accents](#clean-language-accents)).
- **The Type menu** sets the size and the orientation, and holds the options
  of text in a shape and of text along a path (see [The Type menu](#the-type-menu)).
- **Expand Text to Shape** (`Ctrl+Shift+O`) turns a text into its glyphs'
  shapes, as its font draws them (see
  [Expand Text to Shape](#expand-text-to-shape)). A Warp, a Splatter and 3D
  work on a text through the same outlines, and it stays text (see
  [Effects](effects.md#text-through-its-outlines)).

## Typing a new text

The Text tool reads the gesture, and what is selected, as a vector editor's
Type, Area Type and Type on a Path tools would between them. Only a
**selected** path turns into type: a path the tool merely clicks on stays a
path, and the text is typed beside it.

| Gesture | Makes |
| --- | --- |
| Click on the canvas, or on art that is not selected | **Sideless Typing** at the click: the top of its first line is there, and it grows as it is typed |
| Drag on the canvas | **Sheet Typing** in a new rectangle, the drag's |
| Click inside, or on, a selected closed shape | **Sheet Typing** inside the shape |
| Click on a selected open path | **Path Typing** along the path, from the click |
| `Alt` + click on a selected closed shape | **Path Typing** along its outline |
| `Alt` + click on a selected open path | **Sheet Typing** in the region the path closes |
| `Ctrl+V` with a path selected, text on the clipboard, and no text being typed | **Path Typing** of the clipboard's text along the path, from its start |
| Click on a text | edits it |

The pointer shows what a click will do: an I-beam for Sideless Typing, an
I-beam in a dotted box over a selected closed shape, and an I-beam on a wavy
line over a selected path.

A new text is not on the page until its first character is typed. Put down
with nothing typed, it leaves no mark and no undo step; emptied before it is
put down, it goes. The spaces a text is typed with are kept, at its start and
its end too.

A new text takes the last font chosen in the Type panel, the text size set
in Quick Settings, and the tool's ink.

## Sheet Typing

A text in a shape runs its lines inside it, each as wide as the shape is
where the line falls, so text in a circle is set as a circle.

- **The shape becomes the text's frame** with the first character typed, in
  the same undo step: the path is gone from the page, and its fill and
  stroke are the frame's own, drawn under the text. **Type > Area Type
  Options...** changes them.
- **A drag's rectangle keeps its size**, and text that does not fit runs out
  of room (see [Text that runs out of room](#text-that-runs-out-of-room)).
  A drag too flat to hold one line makes a box as wide as the drag that
  grows down to fit.
- **Direct Select reaches the frame's anchors** and handles, as it reaches any
  path's. Moving one reshapes the frame and the text reflows in it; the
  characters keep their size.
- **The Transform Box scales the frame, not the text**: a wider frame holds
  longer lines. A Sideless Typing text scales its characters, as before.

## Path Typing

A text along a path follows it, each character standing across the path at
its place.

- **The path becomes the text's path** with the first character typed, in the
  same undo step. Its own fill and stroke are dropped, as a vector editor
  drops them.
- **The brackets.** While the text is selected alone with the Select tool,
  three brackets stand on the path: the start, the end, and in the middle the
  center, on the side the text stands. Drag the start or the end along the
  path to set where the text may run. Drag the center across the path to flip
  the text to the other side. Each drag is one undo step.
- **Direct Select** moves the path's anchors and handles, and the text
  follows. **The Transform Box** scales the path, not the text.
- **Type > Type on a Path** holds its options and **Flip** (see
  [The Type menu](#the-type-menu)).

## Text that runs out of room

A text in a shape or along a path that holds more than it can show marks it
with a red plus in a small box: at the frame's lower right corner, or at the
end bracket of a text along a path. Nothing typed is lost. Make the frame larger, the path longer or the
text smaller, and the rest shows again.

## Editing a text again

- **With the Text tool**, click a text: the caret goes before the character
  you clicked, or after it when you clicked its second half.
- **With the Select or Direct Select tool**, double-click a text. The tool
  stays in hand: a click on the text places the caret, and a click off it
  puts the text down and does what that tool does.

While a text is edited it has no selection box. A text in a shape and a text
on a path show their frame or their path as a faint dashed guide. Selected,
they show it as a faint line.

## The caret and the selection

The caret stands on the line, as tall as the text typing there would set:
the character before it, or at a line's start the one after. A size the
editor keys set for the next text shows in the caret's height before
anything is typed. Along a path the caret stands across the path; in
vertical text it lies across the column. It blinks while the text has the
keyboard, and keeps its place in the text through a pan or a zoom.

| To select | Do |
| --- | --- |
| From the caret to a place | `Shift` + click there |
| What a drag crosses | Drag across the text |
| A word | Double-click it |
| A paragraph | Triple-click it |
| All the text | `Ctrl+A` |
| A character or a line more | `Shift` + an arrow key |

The selection is drawn as a highlight over each line it covers. When a panel
takes the keyboard, the highlight dims and the caret hides; click the text to
carry on.

## Moving the caret

| Keys | Moves the caret |
| --- | --- |
| `Left` / `Right` | a character back or on |
| `Up` / `Down` | a line up or down, keeping its place along the line |
| `Ctrl+Left` / `Ctrl+Right` | a word back or on |
| `Ctrl+Up` / `Ctrl+Down` | a paragraph back or on |
| `Home` / `End` | to the line's start or end |
| `Ctrl+Home` / `Ctrl+End` | to the text's start or end |

`Shift` with any of them selects as it goes. In vertical text the arrows
follow the columns: `Up` and `Down` step through a column, and `Left` moves
on to the next column, which is the one to the left. Along a path, `Up` and
`Down` go to the text's start and end.

## Putting the text down

Any of these ends the editing and keeps what was typed:

- `Esc`, or `Ctrl+Enter`;
- choosing another tool;
- a click off the text with the Select or Direct Select tool;
- a `Ctrl` + click elsewhere: holding `Ctrl` with the Text tool shows the
  last selection tool, as it does over any drawing tool, and its click puts
  the text down.

The text is left selected. Holding `Ctrl` leaves the keyboard with the text,
so `Ctrl+C`, `Ctrl+V` and the editor keys still reach it while the selection
tool shows.

## Undo

A burst of typing is one undo step. A burst ends after a second with no key,
when the caret moves somewhere else, when an editor key changes the style, or
when the text is put down. A paste, a cut and each editor key are steps of
their own. Undo and redo while editing keep the editing going; an undo that
takes away a text's first characters takes the new text away with them.

## The clipboard

- **Copy** puts the selected text on the clipboard as plain text, and with
  its styles for napkin-sketch.
- **Paste** into a text keeps the styles of text copied from a text here.
  Text from anywhere else takes the style at the caret.
- **`Ctrl+Shift+V`** pastes plain text, in the style at the caret.

While a text is edited, Edit > Cut, Copy, Paste, Delete and Select All act
on the text, and Paste in Place is the plain paste.

## Typing with an input method

An input method's composition is drawn in the text as it is typed,
underlined, and replaced by what it commits. The input method's candidates
show beside the caret.

## The Type panel

The Type panel is a vector editor's Character, Paragraph and Character
Styles panels in one, a tab each: **Character**, **Paragraph** and
**Configurations** (see [Text Configurations](#text-configurations)).

- **View > Toggle Character Panel** (`Ctrl+Shift+T`) brings it up on
  Character, and **View > Toggle Paragraph Panel** (`Ctrl+Alt+T`) on
  Paragraph; the same key again puts it away. Both keys work while a text is
  being typed.
- **It comes up by itself** while the Text tool is in hand and a text is
  selected or being typed, and goes again when another tool is chosen. One
  opened from the View menu stays; one put away stays away until the Text
  tool is put down or no text is selected. **Show the Type panel with the
  text tool**, in the Type section of Verbose Settings, turns this off.

The first time it comes up it is docked beside the canvas; it floats, moves
and docks as the other panels do. Docked, it narrows the canvas, and text
being typed where the panel now stands is panned back into view.

### What it changes

| While | It changes |
| --- | --- |
| characters are selected in a text being typed | those characters |
| only the caret is in a text being typed | what is typed next; kerning, alignment and lists change the text at the caret |
| texts are selected with a selection tool | all of each text |
| no text is selected or typed | the next text: its font, its size and its color |

A field the selected text differs in is blank, and a button pressed for part
of it has a dashed edge. Each change is one undo step.

### The Character tab

- **Font family**: type to search the fonts on this computer, each name shown
  in its own face, the fonts chosen lately first. `↻` reads the fonts again,
  for one installed while the app was open.
- **Font style**: the family's faces.
- **Size** and **Leading**, in points. Leading is the line height: `Auto` is a
  line and a quarter of the size, and a share such as `140%` sets it to that
  share of each character's size.
- **Kerning**: `Auto`, the font's own pairs; `None`; or a number, kerning by
  hand in thousandths of an em - between the characters either side of the
  caret, or after each selected character.
- **Tracking**, in thousandths of an em, and **Words**, a word space's width as
  a share of the font's own.
- **Rotate**, each character turned about its own middle; **V Scale** and
  **H Scale**; **Shift**, the baseline shift, up, in points.
- **All Caps**, **Small Caps**, **Superscript**, **Subscript**, **Underline**
  and **Strikethrough**: on, or off when every selected character has it.
- **Orientation**: horizontal lines or vertical columns. Text along a path
  stays horizontal.
- **Color**: the text's. The swatches and the color well color the text being
  typed too, or what is typed next.

### The Paragraph tab

- **Left**, **Center**, **Right** and **Justify**.
- **Bulleted** and **Numbered** lists, each with its style - a bullet, or
  `1.`, `a.` or `i.` - and `←` and `→` for a shallower or a deeper
  level. Pressed again, a list comes off.
- The **Left**, **Right** and **First** line indents, and the space **Before**
  and **After** a paragraph, in points.
- **Hyphenate**: a word breaks at the end of a line, with a hyphen, where the
  US English patterns allow it.

A paragraph change takes every paragraph the selection touches, or the
caret's.

### Typing values

A number field takes a value with its unit - `12pt`, `16px`, `3mm`, `1cm`,
`0.5in` or `1pc` - and a bare number in its own unit. `Up` and `Down` step
it, `Shift` by ten. A drag on a field's name changes the value as it goes,
and is one undo step when let go; `Esc` during the drag takes it back.

### Fonts this computer does not have

A book whose text uses a font this computer does not have opens with a report
in the bottom-right corner - "1 font is not installed" - with a row for each
font and **Find text**, which selects the texts that use it. Those texts are
drawn in a default face and keep their font, so on a computer that has it
they are as they were. The panel shows such a family in the warning color.

### The next text

A new text is set in the last font chosen in the panel: **Font for new text**
in Verbose Settings, which can be typed there too.

## Text Configurations

Text Configurations are a vector editor's Character Styles: named sets of
character attributes - a font, a face, a size, a color, the spacing, the
lines and the capitals - kept in the book, which runs of text follow. Change
a configuration, and every text that follows it changes, on every page.
**Type > Text Configurations...** brings up the Type panel on its third tab,
**Configurations**.

- **The list** starts with the **Default Configuration**, a text's own
  attributes, and then the book's configurations, each name drawn in its own
  style. The one the selected text follows is chosen. A **+** after it says
  the text has attributes of its own beyond it: overrides.
- **A click** on a configuration applies it to what the panel acts on - the
  selected characters, what is typed next at the caret, or the selected
  texts - and each part keeps its overrides. **Alt** and a click clears them,
  so the text is the configuration's alone. A click on the Default
  Configuration takes a configuration off, keeping the overrides. Each is one
  undo step. With no text selected, a click only chooses a configuration for
  the commands below.
- **Kerning by hand** stays through both, as it is between two characters.

The tab's `☰` menu holds its commands, and `+` and `−` are New and Delete:

| Command | Does |
| --- | --- |
| **New Text Configuration** (`+`) | a configuration of what the selected text has beyond its own base - a bold red word gives one that is bold and red - which the text then follows; it is named Text Configuration 1, 2 and on until its Options name it |
| **Duplicate Text Configuration** | a copy of the chosen one, named for it with `copy` after |
| **Delete Text Configuration** (`−`) | deletes the chosen one; when text follows it, it asks: **Break Link** keeps that text's look as its own, and **Revert to Default** takes the text back to its own attributes, keeping its overrides |
| **Redefine Text Configuration** | the chosen one takes the selected text's attributes, and every text that follows it changes |
| **Text Configuration Options...** | its name and each attribute it sets, blank where it sets none; **Preview** shows each change on every text that follows it. A double-click on a configuration opens them too |
| **Clear Overrides** | the selected text keeps what it follows, and nothing of its own beyond it |
| **Break Link to Configuration** | the selected text keeps its look, and follows no configuration |
| **Load Text Configurations...** | another book's configurations, merged in by name: one alike is kept once, and one with a name this book has but set otherwise comes in numbered, such as `Callout 2` |

A change to a configuration - redefined, renamed, deleted or loaded - is one
undo step, which takes the text on every page back with it.

**Where they live.** The configurations are the book's, shared by its pages
and saved with it. A text carries a copy of each one it follows, so it looks
the same copied into another book, exported, or drawn from a script. Pasted
into a book that has a configuration of that name, it follows that book's;
into one that has none, the configuration joins the book.

- **The SVG export** keeps the link and the definition in the text's data,
  so napkin-sketch reads the text back following its configuration.
- **The Illustrator script** makes each configuration a Character Style of
  its document and applies it, so the link holds in Illustrator too.
- **PNG and PDF** draw the text as it looks.
- **A script** defines one with `textconfig "Callout" face "Bold" color
  #cc0000`, and a text follows it with `config "Callout"`, whole or a run at
  a time. Generate Script writes them back (see [Automate](automate.md)).

## Markdown Flow

**Type > Markdown Flow** (`Ctrl+Alt+M`) makes the selected text - or the one
being typed - a Markdown Flow text: what is typed in it is Markdown, and it
shows as the Markdown renders. Its characters become its Markdown. With
**New text starts in Markdown Flow** on in Verbose Settings, every new text
starts that way. The row is checked while the text it acts on is one.

- **The block the caret is in shows its Markdown**: the paragraph, heading,
  list item, quote, code block or table, with its `#`, its `**` and its list
  marker `-` muted. Every other block shows as it renders.
- **`Enter` ends the line**, and the block renders as the caret moves on. In
  a list item, `Enter` starts the next item - its number counted on, a task's
  box open - and on an empty item it ends the list; in a quote it starts the
  next quoted line; in a fenced code block it is a newline alone.
- **The caret moves through the Markdown.** An arrow key into a rendered block
  shows its Markdown, the caret where it was.
- **`Esc` renders everything**, and a burst of typing is one undo step, as in
  any text.

### What renders

| Markdown | Shows as |
| --- | --- |
| `#` to `######` headings | **Markdown Heading 1** to **6**: bold, at 2, 1.5, 1.25, 1.1, 1 and 0.9 times the text's size, with space before and after |
| `**strong**`, `*em*`, `~~struck~~` | a bold face, an italic face, a line through |
| `` `code` `` | **Markdown Code**: a monospaced face on a light highlight |
| a fenced or an indented code block | **Markdown Code Block**: monospaced lines on a shade; a block that names its language is colored as the language reads it (see [Clean Language Accents](#clean-language-accents)) |
| `-`, `*`, `+` and `1.` lists, nested | bulleted and numbered lists, a level for each step in; `- [ ]` and `- [x]` show an open box and a ticked one |
| `>` quotes | **Markdown Quote**: stood in, in the quote color, with a bar down the left for each quote it is in |
| `---` | a rule across the line |
| `[words](https://example.com)` | **Markdown Link**: the words, underlined in the link color; the address stays in the Markdown, and nothing opens |
| `![words](picture.png)` | the words, in italics: pictures are not fetched |
| tables | a line a row, the header's cells bold, each column starting where the widest cell before it ends |
| raw HTML, such as `<b>` | its own characters, as typed: nothing is made of it |

A single `Enter` is a line break, as typing expects, and a blank line starts a
new paragraph, with a little space between.

**Restyling Markdown.** Headings, code, quotes and links follow Text
Configurations - Markdown Heading 1 to 6, Markdown Code, Markdown Code Block,
Markdown Quote and Markdown Link - which the book takes in the first time it
holds a Markdown Flow text. Change one in the Configurations tab, and what it
styles changes in every Markdown Flow text. A heading's size is its level's
share of the text's own size, unless its configuration sets a size. Deleting
one sets it back to how it was first made.

**Turning it off** asks first. The text keeps what it shows - the rendered
words, the headings' sizes, the lists' bullets, the quotes' bars - as plain
text, and its Markdown goes. Undo brings the Markdown back.

**Where it goes.** A Markdown Flow text keeps its Markdown: the book saves it,
and a copy from the text copies it. Exports draw it as it renders, every
block rendered wherever the caret is: the SVG keeps the Markdown in the text's
data, to read back; the PDF and the PNG draw the rendered text; and the
Illustrator script writes the rendered text and its styles, since Illustrator
has no Markdown. A script makes one with `text "# Notes" at 40 60 markdown`
(see [Automate](automate.md)).

## Clean Language Accents

Clean Language Accents color code as its language reads it: keywords,
strings, numbers, comments, names and types, each a color. highlight.js reads
the code, and nothing in it is ever run or drawn as HTML.

- **In Markdown Flow**, a fenced code block that names its language - a fence
  of three backticks followed by `ts` or `python` - is colored as it is
  typed. A block that names none stays plain, unless **Detect the language of
  unlabelled code** is on in Verbose Settings, which colors it as the
  installed language it reads most like; it is off to begin with, since it
  guesses. A block whose language is not installed shows plain, and while the
  text is edited a line under it says so: "fortran is not installed - Type >
  Clean Language Accents > Languages".
- **In any other text**, **Type > Clean Language Accents > Apply...**
  (`Ctrl+Alt+L`) colors the paragraphs of the selected text - the ones the
  selection touches in the text being typed, or every paragraph of the
  selected texts. It asks for a language from the installed ones, or
  **Auto**, the one the code reads most like, and with **Use a monospace
  font** (on to begin with) sets the paragraphs in Markdown Code too.
- **The colors are live.** They are worked out as the text is laid out, never
  stored, so they follow every edit: type a keyword, and it is colored.
- **Remove Accents** takes the colors off the paragraphs of the selected
  text. Each of these is one undo step.

**Languages.** The 36 languages of highlight.js's common set come installed:
bash, c, cpp, csharp, css, diff, go, graphql, ini, java, javascript, json,
kotlin, less, lua, makefile, markdown, objectivec, perl, php, php-template,
plaintext, python, python-repl, r, ruby, rust, scss, shell, sql, swift,
typescript, vbnet, wasm, xml and yaml. **Type > Clean Language Accents >
Languages...** lists all 193, the installed ones checked, with a search and
filters for the installed and the common ones: check one to install it, and
uncheck one to show its code plain. A fence may name a language by any name
it goes by - `ts` for TypeScript, `py` for Python.

**Colors.** Two themes, **Napkin Light** and **Napkin Dark**, give every
color at least 4.5:1 against their own code shade, so code reads at any size.
By default the theme follows each page's paper - Napkin Dark on a page white
text reads better on - and **Code colors** in Verbose Settings picks one
always. A Markdown code block sits on its theme's shade.

**Where they go.** Exports draw the colors - SVG, PDF, PNG and the
Illustrator script alike - and the SVG keeps each paragraph's accent in the
text's data, so a text read back stays live. A script colors the next text
with `accent python`, `accent auto` or a name in quotes, `accent "c++"` (see
[Automate](automate.md)).

## The Type menu

The Type menu sits between Effect and Sketch, as a vector editor's does.

| Row | Does |
| --- | --- |
| **Font** | brings up the Type panel on Character, its font field ready to type a name in |
| **Size** | a size from 6 to 72 pt, checked when the text has it; **Other** brings up the panel's size field |
| **Character...** and **Paragraph...** | bring up the Type panel on that tab |
| **Text Configurations...** | brings up the Type panel on Configurations (see [Text Configurations](#text-configurations)) |
| **Type on a Path > Type on a Path Options...** | the options of the selected text along a path |
| **Type on a Path > Flip** | the selected text along a path runs the other way, on the path's other side |
| **Type Orientation > Horizontal** and **Vertical** | set the selected text in lines or in columns, the one it has checked; text along a path has no vertical |
| **Area Type Options...** | the options of the selected text in a shape |
| **Markdown Flow** (`Ctrl+Alt+M`) | the selected text typed as Markdown and shown as it renders, checked when it is; off, it keeps what it shows (see [Markdown Flow](#markdown-flow)) |
| **Clean Language Accents > Apply...** (`Ctrl+Alt+L`), **Remove Accents** and **Languages...** | color the code in the selected text's paragraphs, take the colors off, and install or take away languages (see [Clean Language Accents](#clean-language-accents)) |
| **Expand Text to Shape** (`Ctrl+Shift+O`) | turns the selected text into its shapes; also in the Transform menu (see [Expand Text to Shape](#expand-text-to-shape)) |

Font, Size and Type Orientation act on what the Type panel acts on: the
characters selected in the text being typed, or what is typed next at its
caret; else the selected texts; else, for Font and Size, the next text. A row
with nothing to act on is greyed.

### Type on a Path Options

| Field | Sets |
| --- | --- |
| **Effect** | how each character stands on the path: **Rainbow** turns each with the path; **Skew** keeps its upright strokes upright, slanting it along the path; **3D Ribbon** keeps its level strokes level; **Stair Step** turns none, each upright on the path; **Gravity** turns each to face the middle of the path's box |
| **Align to Path** | which line of the characters sits on the path: **Ascender**, **Descender**, **Center** or **Baseline** |
| **Spacing** | in points: draws the characters together round a sharp turn, so they do not fan apart on its outside; below 0 spreads them |
| **Flip** | the text runs the other way, on the path's other side |

### Area Type Options

| Field | Sets |
| --- | --- |
| **Inset Spacing** | in points, how far the text stands in from the frame |
| **Auto Size** | the frame grows down to fit the text, and shrinks with it; only a rectangle square to the page grows, so the field is greyed for other frames |
| **Frame Fill** and **Frame Stroke** | the frame's own paint, under the text: a tick for whether it has one, and its color |
| **Stroke Weight** | the weight of the frame's outline, greyed while it has none |

Both forms work as an effect's options do. **Preview** shows each change on
the canvas as it is made; **OK**, or `Enter`, keeps it as one undo step, and
**Cancel**, or `Esc`, puts the text back. On several texts, a form opens with
the first one's values and changes only the fields changed, so each text
keeps the rest. A length is typed with its unit, as in the Type panel.

## Expand Text to Shape

**Type > Expand Text to Shape** and **Transform > Expand Text to Shape**
(`Ctrl+Shift+O`), a vector editor's Create Outlines, turn each selected text -
or the one being typed - into the shapes it is drawn as:

- **A shape a glyph**, its font's own outline where the type layout set it,
  its counters holes, in its run's color; a space makes none.
- **In a group named after the text's first words**, each shape on a layer
  named after its letter. The frame's own fill and stroke, the highlights, the
  list markers and the underlines and strikethroughs come out as shapes too,
  in the order they are painted.
- **The text's effects, blend, opacity and place** in the layers go on the
  group. It is one undo step, and the shapes are selected.

The outlines are read from the font's own file on this computer, TrueType
and OpenType alike, a font collection's faces among them. A text whose font
cannot be read - one not installed, one with no glyph for a character it
holds, or a kind napkin-sketch does not read, such as a variable font's other
instances - stays text, and a report in the bottom-right corner says which
font and why, with **Find text** to select it.

Small capitals the font does not have are capitals at 70%, as the canvas sets
them; a bold or an italic face the family does not have is drawn with the
nearest face it does have.

A PDF export draws text the same way, with **Draw text as shapes in PDF** on
(see [Settings](settings.md)).

## The editor keys

These keys are the editor's own while a text is edited, as Illustrator's
are. They are not in Edit Keyboard Shortcuts.

| Keys | Does |
| --- | --- |
| `Enter` | a new line; in Markdown Flow, a list's next item or a quote's next line (see [Markdown Flow](#markdown-flow)) |
| `Esc` / `Ctrl+Enter` | puts the text down |
| `Ctrl+Shift+.` / `Ctrl+Shift+,` | size up / down by 2 pt (`Ctrl+Alt+Shift+.` / `,` by 10 pt) |
| `Alt+Up` / `Alt+Down` | leading down / up by 2 pt |
| `Alt+Right` / `Alt+Left` | kerning at the caret, or tracking over a selection, +20 / -20 thousandths of an em (`Ctrl+Alt` by 100) |
| `Alt+Shift+Up` / `Alt+Shift+Down` | baseline shift up / down by 2 pt |
| `Ctrl+Shift+L` / `C` / `R` / `J` | align left / center / right / justify |
| `Ctrl+Shift+K` | All Caps on, or off when it is all on already |
| `Ctrl+Shift+X` | horizontal scale back to 100% |
| `Ctrl+Alt+Q` | tracking and kerning back to 0 |
| `Ctrl+Shift+V` | paste plain text |

With characters selected, a key changes them. With only the caret, a key
sets what the next typed text takes, and the caret shows its size; kerning
is the exception, since it is between the characters either side of the
caret, and changes there at once. Alignment is a paragraph's: it changes
every paragraph the selection touches, or the caret's.

On a keyboard where `AltGr` types a character, `AltGr` with a key types that
character, never an editor key.

## Screen readers

The text being edited is held in a hidden text field named for it ("Text:"
and its first words), so a screen reader reads and edits it as any text
field.
