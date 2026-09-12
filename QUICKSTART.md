# Quickstart

Get from a fresh clone to a sharpened sketch in about five minutes. For the
full reference see [README.md](README.md); for the shortcut tables see
[CHEATSHEET.md](CHEATSHEET.md).

## 1. Install

Requires **Node.js 18+**.

```bash
npm install
npm run build
npm start          # builds, then opens a new blank sketch
```

`npm start` is the fastest way to see the app. Two other ways to run it:

```bash
# Use the CLI from anywhere (local checkout)
npm link
napkin-sketch

# Build a native installer into release/
npm run dist:win     # or dist:mac, dist:linux
```

The window opens **maximized**, which still shows the title bar. Pass
`-f` / `--full-screen` for true full screen.

## 2. Draw something

The **Select** tool is active on launch, so press `P` first to pick up the pen.

1. `P` - pen. Draw a wobbly box and a lopsided circle.
2. `W` then `5` - set the stroke width to 5.
3. `C` - cycle to the next Quick Access Color; `Shift + C` goes back.
4. Hold `Space` and drag - a clean straight line. Add `Shift` mid-drag to lock
   it horizontal or vertical.
5. Hold `Ctrl + Space` and drag - a quarter-ellipse curve. Add `Alt` for a
   quarter circle, tap `Shift` to swing the apex 90 degrees.

## 3. Sharpen it

Press `H` (**Sharpen all**) and watch the box square up and the circle round
out, with a subtle wobble left in so it still reads as hand-drawn.

Two ways to run the engine:

- **Sharpen all** (`H`) - clean up the whole page when you are ready.
- **Live sharpen** - beautify each stroke the moment you lift the pen. It is
  **off by default**; turn it on in Quick Settings (`Ctrl + ,`).

Tune the result in Quick Settings: wobble, smoothing, circle snap, end taper,
rotational symmetry (raise it above 1 for mandala mode), and text size.

## 4. Work with layers

Every new element gets **its own layer**, named after the tool that drew it.

| Do this                      | Press                          |
| :--------------------------- | :----------------------------- |
| Show / hide the Layers panel | `Ctrl + L`                     |
| Rename the active layer      | `F2` (or double-click the row) |
| Group the selected layers    | `Ctrl + G`                     |
| Ungroup                      | `Ctrl + Shift + G`             |
| Move a layer up / down       | `Ctrl + ]` / `Ctrl + [`        |

Click a row to make it active; `Shift`-click to multi-select; drag a row to
restack it, or drop it onto a group row to nest it inside. Selecting on the
canvas highlights the matching rows, and the other way round.

Press `S` for the Select tool, click a stroke, then click a Quick Access Color
to **fill** it. Press `A` for Direct Select and drag an anchor point to reshape
a path.

## 5. Save and export

| Action        | Shortcut                               |
| :------------ | :------------------------------------- |
| Save          | `Ctrl + S`                             |
| Save As       | `Ctrl + Shift + S`                     |
| Import a file | `Ctrl + I`                             |
| Export        | File > Export > PNG / JPEG / SVG / PDF |

Sketch books save as `.skbk`, a human-readable JSON document written
atomically, so an interrupted save cannot corrupt the file you already had.
SVG export is lossless and keeps layer names, gradients, and dash styles, so
the file round-trips back into napkin-sketch unchanged.

## 6. Drive it from the command line

```bash
# New sketch named "ideas"
napkin-sketch --new ideas

# Open an existing sketch book
napkin-sketch --book ./notes.skbk

# Sharpen a saved book headlessly, then open it
napkin-sketch --sharpen ./notes

# Open a new sketch with a file imported
napkin-sketch --import logo.svg

# Import several files, laid out in a grid
napkin-sketch -m logo.svg,"site map.svg",photo.png
```

The sharpen engine is pure and deterministic (seeded from each stroke's id),
so `--sharpen` produces the same result on disk as the GUI does on screen.

## 7. Where to go next

- **[CHEATSHEET.md](CHEATSHEET.md)** - every shortcut, CLI flag, and npm
  script on one page.
- **Sketch Support tools** - Rectangle (`R`), Ellipse (`L`), Curve (`V`),
  Vector Path (`B`), Paint Bucket (`G`), Eyedropper (`I`), Rotate
  (`Ctrl + R`), Join strokes (`Ctrl + J`).
- **Verbose Settings** (`Ctrl + Alt + ,`) - everything in Quick Settings plus
  zoom and pan sensitivity, endpoint snap, toolbar placement and rearrange
  mode, theme, Quick Access Colors, and auto-save. Settings persist across
  launches and export to a JSON file.
- **Embedding** - the drawing engine ships as a browser-safe package with no
  Electron or Node dependency. See
  [Embedding the editor](README.md#embedding-the-editor).
- **Animation Mode** (`Ctrl + Shift + N`) - an **optional add-on**, left out of
  a default install because it needs an agentic AI command-line tool you
  install and sign in to yourself. Add it with
  `npm run animation-mode -- --install`, then restart the app.

## Troubleshooting

| Symptom                                      | Fix                                                                       |
| :------------------------------------------- | :------------------------------------------------------------------------ |
| `napkin-sketch` is not found                 | Run `npm run build` then `npm link`, or use `npm start`                   |
| Strokes are not being cleaned up as you draw | Live sharpen is off by default; enable it in `Ctrl + ,` or press `H`      |
| Nothing draws                                | The Select tool is active at launch; press `P` for the pen                |
| `Ctrl + Shift + N` does nothing              | Animation Mode is not installed; run `npm run animation-mode -- --status` |
| The cursor is a crosshair, not a circle      | CapsLock is on; that is the precision cursor                              |
| A change to the source is not showing        | Rebuild with `npm run build`, or leave `npm run build:watch` running      |
