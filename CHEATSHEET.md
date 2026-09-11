# Cheatsheet

Every shortcut, flag, and script on one page. New here? Start with
[QUICKSTART.md](QUICKSTART.md). Full prose reference: [README.md](README.md).

`Ctrl` is `Cmd` on macOS throughout.

## Tools

| Tool              | Key     | Notes                                                 |
| :---------------- | :------ | :---------------------------------------------------- |
| Pen               | `P`     | Pressure-aware variable width                         |
| Marker            | `M`     |                                                       |
| Copic marker      | `K`     | Flat broad nib, rotatable                             |
| Eraser            | `E`     | Reveals the paper beneath; cuts only its own layer    |
| Select            | `S`     | Black arrow; active at launch                         |
| Direct Select     | `A`     | White arrow; drags anchor points                      |
| Text              | `T`     | Click = auto-sizing box, drag = fixed width with wrap |
| Rectangle         | `R`     | `Shift` = square                                      |
| Ellipse           | `L`     | `Shift` = circle                                      |
| Curve             | `V`     | Click and hold the button for the free-ends variant   |
| Vector Path       | `B`     | Click = corner, drag = smooth Bezier point            |
| Paint Bucket      | `G`     | Fills the enclosed shape under the click              |
| Eyedropper        | `I`     | Hold `Ctrl` to pick a shape instead                   |
| Fill Color        | toolbar | Fills the element under the click, else the selection |
| Sharpen Selection | toolbar | Smooth / Simplify sliders with live preview           |

## Drawing

| Action                        | Shortcut                                        |
| :---------------------------- | :---------------------------------------------- |
| Straight line                 | Hold `Space` and drag                           |
| Lock line to 90 degrees       | `Shift` mid-drag (release to free)              |
| Quick curve (ellipse)         | Hold `Ctrl + Space` and drag                    |
| Quick curve (circle)          | Hold `Ctrl + Space + Alt` and drag              |
| Swing a quick curve apex      | `Shift`, 90 degrees clockwise per press         |
| Endpoint snap                 | Hold `Shift` while drawing                      |
| Rotate the Copic nib          | Hold `Ctrl` 1s, then `Alt` (CW) / `Shift` (CCW) |
| Cancel the stroke in progress | `Esc`                                           |
| Sharpen all                   | `H`                                             |

## Quick features

| Action                   | Shortcut                                 |
| :----------------------- | :--------------------------------------- |
| Quick width              | `W` then a number                        |
| Quick opacity            | `Q` then a number                        |
| Quick zoom               | `Z` then a digit (`9` = 90%, `0` = 100%) |
| Cycle Quick Access Color | `C` forward, `Shift + C` back            |

## View, pan, and zoom

| Action                       | Shortcut                                    |
| :--------------------------- | :------------------------------------------ |
| Fit All in View              | `Ctrl + 0`                                  |
| Zoom (mouse)                 | Hold `Alt` and scroll                       |
| Pan (mouse)                  | Scroll; `Ctrl + Shift` + scroll pans across |
| Pan (Select / Direct Select) | Hold `Space` and drag                       |
| Pan / zoom (touch)           | Two-finger gesture                          |
| Toggle Pages panel           | `Ctrl + B`                                  |
| Toggle Layers panel          | `Ctrl + L`                                  |
| Toggle Properties panel      | `Ctrl + P`                                  |
| Quick Settings               | `Ctrl + ,`                                  |
| Verbose Settings             | `Ctrl + Alt + ,`                            |
| Animation Mode               | `Ctrl + Shift + N` (optional add-on)        |

## Selection and editing

| Action                         | Shortcut                                   |
| :----------------------------- | :----------------------------------------- |
| Select all                     | `Ctrl + A`                                 |
| Deselect all                   | `Ctrl + Shift + A`                         |
| Add to / remove from selection | `Shift` + click                            |
| Rubber-band select             | Drag over empty space (Select tool)        |
| Drag-copy the selection        | Hold `Alt` and drag                        |
| Cut / Copy / Paste             | `Ctrl + X` / `Ctrl + C` / `Ctrl + V`       |
| Paste in Place                 | `Ctrl + Shift + V`                         |
| Duplicate                      | `Ctrl + D`                                 |
| Delete selection or layer      | `Delete` or `Backspace`                    |
| Move by a distance             | `Enter`, or the Move button                |
| Step a Move field              | Arrow keys, `Shift` for a coarse step      |
| Rotate                         | `Ctrl + R`, or the Rotate button           |
| Snap a rotation to 15 degrees  | `Shift` while dragging, or the Snap toggle |
| Join strokes                   | `Ctrl + J`                                 |
| Undo                           | `Ctrl + Z`                                 |
| Redo                           | `Ctrl + Y` or `Ctrl + Shift + Z`           |

## Vector path editing

With the Vector Path tool active, click a committed path to open its anchors.

| Action                     | Shortcut                                            |
| :------------------------- | :-------------------------------------------------- |
| Add an anchor              | Click a segment (a `+` badge marks the spot)        |
| Remove an anchor           | Click the anchor (a `-` badge marks it)             |
| Move an anchor or handle   | Hold `Ctrl` and drag                                |
| Round a corner             | Hold `Ctrl`, drag the target icon, or type a Radius |
| Toggle an anchor's handles | `Alt` + click the anchor                            |
| Close the path             | Click the first point                               |
| Finish it open             | `Enter`, double-click, or switch tools              |
| Abandon the path           | `Esc`                                               |
| Put an edited path down    | Click empty canvas, or `Esc`                        |

## Layers

| Action                    | Shortcut                                 |
| :------------------------ | :--------------------------------------- |
| Toggle the panel          | `Ctrl + L`                               |
| Rename the active layer   | `F2` or double-click the row             |
| Group the selected layers | `Ctrl + G`                               |
| Ungroup                   | `Ctrl + Shift + G`                       |
| Move layer up / down      | `Ctrl + ]` / `Ctrl + [`                  |
| Multi-select rows         | `Shift` + click                          |
| Restack or nest           | Drag the row (drop onto a group to nest) |
| Layer tools menu          | Right-click a row                        |

## Files

| Action     | Shortcut                               |
| :--------- | :------------------------------------- |
| New Sketch | `Ctrl + N`                             |
| Open       | `Ctrl + O`                             |
| Import     | `Ctrl + I`                             |
| Save       | `Ctrl + S`                             |
| Save As    | `Ctrl + Shift + S`                     |
| Export     | File > Export > PNG / JPEG / SVG / PDF |

## CLI

```bash
napkin-sketch [option] [target]
```

| Flag                     | Description                                              |
| :----------------------- | :------------------------------------------------------- |
| `-h, --help`             | Show command-line help                                   |
| `-v, --version`          | Show the version                                         |
| `-b, --book`             | Open a saved `.skbk` sketch book                         |
| `-n, --new`              | New sketch, named `unnamed` or `[target]`                |
| `-f, --full-screen`      | Open full screen (the default window is maximized)       |
| `-i, --import`           | Import an SVG, PDF, PNG, or JPEG into the opening sketch |
| `-m, --multiple-imports` | Import a comma-separated list, laid out in a grid        |
| `--sharpen`              | Auto-sharpen a saved sketch on disk, then open it        |
| `[target]`               | A `.skbk` file to open, or a name for a new sketch       |

```bash
napkin-sketch                                        # new blank sketch
napkin-sketch --new ideas                            # new sketch named "ideas"
napkin-sketch --book ./notes.skbk                    # open a saved book
napkin-sketch ./notes.skbk                           # same, bare path
napkin-sketch --sharpen ./notes                      # sharpen on disk, then open
napkin-sketch --new -f                               # full screen
napkin-sketch --import logo.svg                      # import one file
napkin-sketch -m logo.svg,"site map.svg",photo.png   # grid of files
```

Quote file names that contain spaces.

## npm scripts

| Script                                         | What it does                                                |
| :--------------------------------------------- | :---------------------------------------------------------- |
| `npm run build`                                | Bundle CLI, main, preload, renderer, and the embed API      |
| `npm run build:watch`                          | Rebuild on change                                           |
| `npm run build:types`                          | Emit `.d.ts` declarations for the embeddable API            |
| `npm run typecheck`                            | Type-check without emitting                                 |
| `npm test`                                     | Run the unit test suites                                    |
| `npm test -- --keep-graphics`                  | Keep the graphics the graphic-design suite draws            |
| `npm start`                                    | Build, then launch a new sketch                             |
| `npm run clean`                                | Remove `dist/`                                              |
| `npm run icon`                                 | Generate the app icon from `assets/icon.svg`                |
| `npm run import-tree -- <file.svg>`            | Print the layer tree an SVG would import as                 |
| `npm run todo`                                 | Archive checked `TODO.md` items into its Complete section   |
| `npm run ai-helper -- --list`                  | Show AI tool targets and the helpers that install to them   |
| `npm run ai-helper`                            | Install every helper's skills to `.claude`                  |
| `npm run ai-helper -- --to github`             | Install them to `.github` (Copilot) instead                 |
| `npm run ai-helper -- --helper <name>`         | Narrow to one helper (`vectors`, `graphic-designer`)        |
| `npm run ai-helper -- --to plugin`             | Check the plugins and print the `/plugin` commands          |
| `npm run wireframe-cycles`                     | Rebuild the animation cycle tables from the wireframe asset |
| `npm run dist`                                 | Build an installer for the current OS                       |
| `npm run dist:win` / `dist:mac` / `dist:linux` | NSIS / DMG / AppImage                                       |
| `npm run animation-mode -- --status`           | Is Animation Mode installed?                                |
| `npm run animation-mode -- --install`          | Install it (defaults to Claude Code)                        |
| `npm run animation-mode -- --uninstall`        | Remove it again                                             |

## Embedding

```ts
import { NapkinSketch } from 'napkin-sketch';
import 'napkin-sketch/styles.css';

const editor = new NapkinSketch(document.getElementById('host')!, {
  liveSharpen: false,
  onChange: (e) => console.log(e.toJSON()),
});

editor.setTool('pen');
editor.sharpenAll();
editor.toDataURL('image/png');
editor.toSVG();
editor.toPDF();
```

Pure-engine entry points, no editor required: `sharpenStrokes`,
`parseSketchBook`, `sketchesToPdf`, and `importSvg` (browser only).

## Graphic design API

```ts
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });
design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fill: '#ffffff' });
design.defineClip('badge', { type: 'circle', cx: 180, cy: 220, r: 64 });
design.image({ src: logo, x: 116, y: 156, width: 128, height: 128, fit: 'cover', clip: 'badge' });

design.toSVG();  // string
design.toPNG();  // PNG bytes, no canvas and no image dependency
```

| Element   | Method                                                    |
| :-------- | :-------------------------------------------------------- |
| Rectangle | `rect({ x, y, width, height, rx })`                       |
| Circle    | `circle({ cx, cy, r })`                                   |
| Ellipse   | `ellipse({ cx, cy, rx, ry })`                             |
| Triangle  | `triangle({ x, y, width, height, variant })` or `points`  |
| Polygon   | `polygon({ points })` / `polyline({ points })`            |
| Line      | `line({ x1, y1, x2, y2 })`                                |
| Path      | `path({ d })` - `M L H V C S Q T Z`, no arcs              |
| Text      | `text({ x, y, text, ...font and paragraph styling })`     |
| Media     | `image({ src, x, y, width, height, fit, clip })`          |
| Group     | `group(props, (g) => { ... })`                            |
| Mask      | `defineClip(id, shape)`, or `clip:` inline on an element  |

Page defaults: 360 by 360, `px`, transparent, headless. Full reference in
[API.md](API.md).

## AI helpers

Two plugins in `ai-helper/`, one folder each, both listed by the marketplace at
the repository root.

| Helper             | Command                             | What it does                               |
| :----------------- | :---------------------------------- | :----------------------------------------- |
| `vectors`          | `/vectors:animation-mode`           | Draws the next Animation Mode frame        |
| `graphic-designer` | `/graphic-designer:design-language` | Reads an asset into a `DESIGN_LANGUAGE.md` |

```text
/plugin marketplace add .                              # from a clone
/plugin marketplace add isocialPractice/napkin-sketch  # without one
/plugin install vectors@napkin-sketch
/plugin install graphic-designer@napkin-sketch
```

```bash
# What design language is this asset in?
node ai-helper/graphic-designer/skills/design-language/scripts/analyze-media.mjs asset.svg --markdown
```

An SVG yields colors, type, strokes and structure; a PNG yields colors only;
JPEG and GIF have no decoder and say so rather than returning an empty result.

## Defaults worth knowing

| Setting                             | Default                                |
| :---------------------------------- | :------------------------------------- |
| Active tool at launch               | Select                                 |
| Live sharpen                        | Off                                    |
| Window                              | Maximized; 1280x860 when restored down |
| Endpoint snap sensitivity           | 10px (range 1-20)                      |
| Join stroke on snap                 | Off                                    |
| Eyedropper select pixel sensitivity | 10px (range 1-36)                      |
| Direct Select grab radius           | 3px                                    |
| Copic nib hold time                 | 1s (range 0.5-2)                       |
| Copic rotate width multiplier       | 2x (range 1-4, capped at 40px)         |
| Show selection borders              | On                                     |
| Animation Mode                      | Not installed                          |
