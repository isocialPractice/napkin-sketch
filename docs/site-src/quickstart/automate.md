# Quickstart: automating

Turn a drawing into a script, record a session, and draw with no window at
all. The **Automate** menu writes napkin script from what is on the page;
the `napkin-sketch` command draws napkin script without opening the app.
[Automate](../guide/automate.md) and [Drawing from a
script](../scripting.md) have the full detail.

## 1. Write a script from a file

1. Choose **Automate > Generate Script > From Media File** and pick an SVG,
   a PDF or a picture.
2. The **Generated script** dialog shows the whole script, a line counting
   its instructions, marks and layers, and a note for anything the language
   cannot say as the file does.
3. **Copy** puts it on the clipboard, **Save As** writes a `.napkin` file, and
   **Open as New Page** runs it into a page of its own - the honest way to see
   what it draws.

A picture is placed, not traced: its script links the file by name, or with
**Embed the image data** ticked, carries the picture itself.

## 2. Write a script from the selected layers

1. Light one or more rows in the Layers panel.
2. Choose **Automate > Generate Script > Selected Layers**.
3. Choose **Page: fit to the selection** to write a page the size of what you
   chose, moved to its corner, or keep the page as it is.

## 3. Record a session

1. Choose **Automate > Track History**; the row shows a check mark while it
   records.
2. Draw a couple of strokes and turn one with `Ctrl + R`. Each is a step, named
   for what made it: "Brush stroke", "Rotate".
3. **Automate > History Limit** opens Verbose Settings at its Automate
   section, where the limit is set and the steps are counted.

## 4. Write the session as a script

1. Choose **Automate > Generate Script > From Session History**.
2. Every step recorded on the page is listed, ticked. Untick a step to leave
   it out: the script is then the drawing as it would be had that step not
   happened.
3. Press **Accept** to see the script in the Generated script dialog.

## 5. Draw a script with no window

Save this as `card.napkin`:

```napkin
napkin 1
page 400 240
layer "Card"
color #1f2328 width 3 fill #ffe08a
rect 20 20 360 200 r 12
text "Hello" at 200 130 size 32 align center
```

Then, from the folder it is in:

```bash
napkin-sketch draw card.napkin --to svg,png --out out   # writes out/card.svg and out/card.png
napkin-sketch check card.napkin                          # reports mistakes, draws nothing
napkin-sketch verbs                                      # every verb the language has
```

None of the three loads Electron, so they run in a shell, a batch file or CI.

## Where next

- [API quickstart](../../../API-QUICKSTART.md) - the whole drawing language
  in five steps.
- [The command line](../guide/command-line.md) - every option the app itself
  takes.
- [Animation Mode](../guide/animation-mode.md) - the optional add-on that
  draws a character a frame at a time: the six assemblies a character needs,
  and the [names its frames take](../guide/animation-mode.md#frame-names).
