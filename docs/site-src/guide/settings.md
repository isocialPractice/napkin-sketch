# Settings

## At a glance

- **Two synced settings views** — **Quick Settings** in-app (`Ctrl+,`: live
  sharpen, show selection borders, show mesh, wobble, smoothing, circle snap,
  taper, symmetry, text size) and
  the **Verbose Settings** window (`Ctrl+Alt+,`, Edit menu, or the gear icon)
  which holds those same Quick Settings plus zoom/pan sensitivity, inverted
  zoom, the quick-feature timer, endpoint snap and Join stroke, the
  Select sensitivity, the Direct Select sensitivity, the Eyedropper
  sensitivity, the Freehand fidelity, **Show selection borders**, the Copic
  quick nib-rotate options
  (on/off, hold time, hold/rotate keys, rotation speed), Quick Access Color
  count and values, toolbar placement (top / side / both) with drag-and-drop
  **rearrange mode** (covers every tool in both toolbar groups — tools can
  even move between the groups — plus the Quick Access Colors), a light /
  dark / sepia **theme**, auto-save, the **Wipe animation** (the napkin that
  wipes over a Wipe Stacks result; on by default, and skipped under reduced
  motion), how long a **report** in the bottom-right corner stays before it
  fades (15 seconds, held while the pointer or the keyboard is on it; at 0 it
  stays until closed), Track History with its History Limit, and the three
  effect preferences in Sketch Support: **Scale Strokes and Effects** (on by
  default: a scale takes the stroke width and the effects' lengths with the
  mark, and a turn or a mirror turns a shadow and a bevel's light with it),
  **Use Preview Bounds** (off by default: a selected mark's box and the area a
  click picks it by take in what its effects paint) and **Show the 3D
  gumball** (on by default: a selected 3D mark shows the handles that move,
  turn and scale it in depth; see [Effects](effects.md)), and the Type
  section: **Show the Type panel with the text tool** (on by default: the
  panel comes up by itself while the Text tool is in hand and a text is
  selected or being typed), the **Font for new text** (the last font chosen
  in the Type panel; empty, the system's interface font; see
  [Type](type.md)), **New text starts in Markdown Flow** (off by default: what
  is typed in a new text is Markdown, shown as it renders; see
  [Markdown Flow](type.md#markdown-flow)), **Code colors** (Follow the page
  by default, else Napkin Light or Napkin Dark) and **Detect the language of
  unlabelled code** (off by default; see
  [Clean Language Accents](type.md#clean-language-accents)), and **Draw text as shapes in PDF** (on by default: a PDF
  draws each letter as its font's own outline, so the page looks as it does
  here; off, text is set in Helvetica, which a reader can select and search;
  see [Import and export](import-export.md)). Settings persist across
  launches and can be exported to and imported from a JSON file.

## Every setting

<!-- settings:start -->
| Setting | Default | Range |
| --- | --- | --- |
| `zoomSensitivity` | `1` | 0.25 to 4, in steps of 0.05 |
| `panSensitivity` | `1` | 0.25 to 4, in steps of 0.05 |
| `invertZoom` | `false` |  |
| `invertScrollZoom` | `false` |  |
| `invertScrollPan` | `false` |  |
| `invertPanDrag` | `false` |  |
| `quickTimerMs` | `1000` | 500 to 3000, in steps of 100 |
| `endpointSnap` | `true` |  |
| `endpointSnapPx` | `10` | 1 to 20, in steps of 1 |
| `selectSensitivityPx` | `4` | 1 to 20, in steps of 1 |
| `directSelectSensitivityPx` | `8` | 1 to 20, in steps of 1 |
| `showSelectionBorders` | `true` |  |
| `joinStrokeOnSnap` | `false` |  |
| `wipeAnimation` | `true` |  |
| `warpShowMesh` | `true` |  |
| `eyedropSensitivityPx` | `10` | 1 to 36, in steps of 1 |
| `freehandFidelityPx` | `1.5` | 0.5 to 8, in steps of 0.5 |
| `liveSharpen` | `false` |  |
| `sharpenWobble` | `1.1` | 0 to 4, in steps of 0.1 |
| `sharpenSmoothing` | `2.5` | 0.5 to 8, in steps of 0.5 |
| `sharpenCircleSnap` | `0.12` | 0.02 to 0.3, in steps of 0.01 |
| `sharpenTaperEnds` | `true` |  |
| `symmetry` | `1` | 1 to 12, in steps of 1 |
| `textSize` | `24` | 10 to 96, in steps of 1 |
| `quickColorCount` | `6` | 2 to 20, in steps of 1 |
| `quickColors` | 6 values |  |
| `menuPlacement` | `top` |  |
| `toolOrder` | 19 values |  |
| `rememberSettings` | `true` |  |
| `theme` | `light` |  |
| `autoSaveIntervalSec` | `0` | 0 to 600, in steps of 5 |
| `copicQuickRotate` | `true` |  |
| `copicHoldSec` | `1` | 0.5 to 2, in steps of 0.1 |
| `copicHoldKey` | `ctrl` |  |
| `copicRotateCwKey` | `alt` |  |
| `copicRotateCcwKey` | `shift` |  |
| `copicRotateSpeedDeg` | `90` | 15 to 360, in steps of 15 |
| `copicWidthMultiplier` | `2` | 1 to 4, in steps of 0.25 |
| `animationHelperCommand` | `claude -p --model sonnet --dangerously-skip-permissions < _temp/animation-form.txt` |  |
| `animationLogFile` | `logs/animation-helper.log` |  |
| `trackHistory` | `false` |  |
| `historyLimit` | `500` | 50 to 5000, in steps of 50 |
| `reportToastSeconds` | `15` | 0 to 60, in steps of 5 |
| `scaleStrokesAndEffects` | `true` |  |
| `usePreviewBounds` | `false` |  |
| `show3dGumball` | `true` |  |
| `typePanelAutoShow` | `true` |  |
| `textFont` | (empty) |  |
| `markdownNewText` | `false` |  |
| `accentLanguages` | 36 values |  |
| `accentTheme` | `auto` |  |
| `accentDetect` | `false` |  |
| `pdfTextAsShapes` | `true` |  |
<!-- settings:end -->
