# Local Weather Style Guide

How to restyle napkin-sketch when the weather MCP server's `render_weather` tool
is called. Read this file first, then apply the directives from the tool call.

## 1. Application architecture

| Concern | Location |
| --- | --- |
| Framework | Electron (main + preload + renderer), TypeScript, bundled by esbuild |
| Entry points | `src/main/main.ts`, `src/renderer/renderer.ts`, `src/cli/index.ts` |
| Markup | `src/renderer/index.html`, `src/renderer/settings.html` |
| **All styling** | `src/renderer/styles.css` (single stylesheet, no preprocessor) |
| Build | `node scripts/build.mjs` copies `styles.css` verbatim to `dist/renderer/` |
| Launch | `npm start` (build, then open a new sketch window) |

There is exactly one stylesheet. Both the sketch window and the settings window
link it. Restyling never requires touching TypeScript.

**The app is a tool, not a game.** It is a pen-and-paper sketching surface. Per
the `render_weather` asset directive, the "if game-like" branch does not apply,
so server assets (`sun.svg`, `moon.svg`, `cloud.svg`, `rain.svg`, `snow.svg`)
are **not** copied into this repo. Weather is expressed through the token layer
only. Do not add weather illustrations to the chrome.

## 2. Current styling system

`styles.css` is token-driven. The top of the file declares semantic custom
properties on `:root`, and every rule below consumes them.

- **Color roles:** `--bg` (60% dominant), `--surface` / `--surface-2` (30%
  secondary), `--accent` (10%, reserved for the Sharpen action), `--primary`
  (the Save CTA and active-state highlight), `--paper` (the canvas "napkin"),
  `--ink` / `--ink-soft` / `--ink-faint` (text), `--border` /
  `--border-strong`, `--danger`, `--focus`.
- **Scales:** spacing `--s1`..`--s5` on a 4/8px grid, radius `--r-sm` /
  `--r-md` / `--r-full`, elevation `--shadow-1` / `--shadow-2` /
  `--shadow-paper`, and a single `--motion` duration and easing.
- **User themes:** `:root[data-theme="dark"]` and `:root[data-theme="sepia"]`
  override the color tokens. `data-theme` is set from user settings in
  `renderer.ts` and `settings.ts`; its values are `light`, `dark`, `sepia`.

Baseline (unstyled) palette is a cool neutral ground with one warm accent, on a
60-30-10 balance with WCAG-AA text contrast.

## 3. The weather block contract

Weather styling is **additive and self-contained**. It lives in one delimited
block appended to the end of `styles.css`:

```css
/* ==== LOCAL WEATHER START ==== */
...weather rules...
/* ==== LOCAL WEATHER END ==== */
```

Rules for every future `render_weather` call:

1. **Replace, never accumulate.** Delete everything between the two markers and
   write the new weather fresh. Two weather blocks must never coexist.
2. **Never edit the code above the start marker.** The baseline palette, the
   `data-theme` blocks, and all component rules stay untouched so the weather
   layer can always be reverted by deleting the block.
3. **Override tokens, not components.** Nearly every visual comes from the token
   layer. Redefining tokens restyles the whole app in one place.
4. **Match theme specificity.** `:root[data-theme="dark"]` is more specific than
   a bare `:root`, so a plain `:root` block loses to it. Open the weather block
   with the selector list below so it wins for all three user themes:

   ```css
   :root,
   :root[data-theme] { /* weather tokens here */ }
   ```

5. **Patch the hardcoded colors.** A few rules bypass the token layer and must be
   re-stated inside the weather block whenever `--ink` or `--paper` flips
   lightness:
   - `.toast` paints `background: var(--ink)` with a near-white `color`, which
     collapses to light-on-light when `--ink` is light.
   - `.thumb-label` uses an opaque white pill.
   - `.text-editor` uses a near-white fill; it sits on `--paper`, so it only
     needs attention when the paper goes dark.
   - `.export-dialog` scrim and `.stage` radial gradient are literal colors.
   - `:focus-visible` paints a bare 2px `--focus` outline. A single hue cannot
     clear 3:1 against every ground in this app at once, because the ring has to
     read on the chrome, on `--paper`, and on the `--primary` and `--accent`
     button fills. When a weather `--focus` fails any of those, keep the hue and
     add a dark or light halo (`box-shadow: 0 0 0 6px ...`) that surrounds the
     outline on both sides instead of hunting for a hue that works everywhere.
6. **Keep the accent reserved.** `--accent` stays exclusive to Sharpen and the
   dirty-file marker no matter the weather. Weather changes the accent's hue, not
   its job.
7. **No auto-playing motion.** Weather is a mood, not an animation. Do not add
   looping flicker, rain, or drift to a drawing surface. Respect the existing
   `prefers-reduced-motion` block.
8. **Keep the canvas drawable.** `--paper` may be tinted and dimmed, but it must
   stay light enough that dark strokes read clearly. Do not drop it below roughly
   `#d8cdbb` lightness.

## 4. Mapping directives to tokens

`render_weather` returns three style axes. Compose them; they are independent.

### Render Background: `day` | `night`

Sets the ground lightness. `day` keeps light surfaces with `--ink` dark.
`night` inverts to an off-black ground with `--ink` light. Never use pure black
or pure white for the pair, since maximum contrast causes halation.

| Token | day | night |
| --- | --- | --- |
| `--bg` | lightest tint of the tone hue | darkest shade of the tone hue |
| `--surface`, `--surface-2` | one and two steps darker than `--bg` | one and two steps lighter than `--bg` |
| `--ink`, `--ink-soft`, `--ink-faint` | dark, descending contrast | light, descending contrast |
| `--border`, `--border-strong` | subtle darker than surface | subtle lighter than surface |
| `--paper` | near-white tinted by tone | dimmed, warm "lamplit" tint |
| shadows | soft, low alpha | deep, high alpha |

### Render Tone: `hot` | `medium` | `cold`

Sets the hue bias of every neutral, and the accent family.

| Tone | Neutral hue bias | `--accent` family |
| --- | --- | --- |
| `hot` | warm, roughly 20-35 degrees (charcoal to cream, never grey) | ember orange |
| `medium` | near-neutral, the baseline palette's own bias | the baseline warm accent |
| `cold` | cool, roughly 200-220 degrees | icy cyan or steel blue |

Tone controls hue and saturation only. It never overrides the lightness
direction that Background already set.

### Precipitation Use: `sunny` | `cloudy` | `stormy`

Sets atmosphere: saturation of the mid tones, depth of the elevation, and the
`--focus` ring.

| Precipitation | Surfaces | Elevation | `--primary` | `--focus` |
| --- | --- | --- | --- | --- |
| `sunny` | clean, low-contrast steps | light shadows, crisp edges | baseline | baseline blue |
| `cloudy` | flattened, slightly desaturated | medium diffuse shadows | muted | baseline blue |
| `stormy` | desaturated slate mixed into the tone hue | deep, wide, high-alpha shadows | storm steel | lightning yellow |

## 5. Worked example

Directives `night` + `hot` + `stormy` compose to: a warm charcoal ground (60%),
storm-steel surfaces and primary (30%), an ember accent (10%), a lamplit cream
napkin, deep diffuse shadows, and a lightning-yellow focus ring. This is the
block currently in `styles.css`.

## 6. Verify before finishing

- [ ] Exactly one `LOCAL WEATHER START` / `END` pair in `styles.css`.
- [ ] Nothing above the start marker changed (`git diff` shows additions at the
      end of the file only).
- [ ] Body text meets 4.5:1 against its own background. Check `--ink-faint`
      against `--surface-2`, the darkest ground it lands on: that pair is always
      the closest to the floor.
- [ ] The focus ring reads against the chrome, `--paper`, `--primary`, and
      `--accent` (see rule 5). Borders are intentionally subtle and only need to
      match the baseline palette's separation, not a 3:1 target.
- [ ] Toast, thumbnail labels, and the export scrim are all readable.
- [ ] All three `data-theme` values still render the weather (settings window,
      theme dropdown).
- [ ] `npm run build` succeeds, and `npm start` opens a window showing the
      weather.
