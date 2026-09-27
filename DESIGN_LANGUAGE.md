# napkin-sketch documentation: design language

The look of the documentation site (`docs/`), derived from the art the
repository already carries rather than invented: the app icon,
`assets/icon.svg`, for the palette's brand colours and the shapes, and the
app's own stylesheet, `src/renderer/styles.css`, for the neutrals, the
spacing and the radii, which the app already checked for contrast. The site's
stylesheet, `docs/assets/site.css`, names its tokens as `styles.css` names
them, and holds exactly the values below.

It follows the repository's colour guide,
`.github/instructions/html-css-style-color-guide.instructions.md`: a 60-30-10
split of cool neutrals, surfaces and one warm accent; no saturated
backgrounds; no yellow text.

## What it is derived from

The icon is a rounded blue tile (corner radius 104 of 464, about 22 percent)
running from `#2f6fed` to `#1b3fae`, holding a paper card (`#fcfaf5`, radius 26
of 320, about 8 percent) with one bold ink stroke (`#1f2328`, 20 units, round
caps and joins) and one thin orange underline (`#f08c2e`, 14 units). On the
site that becomes: the brand mark at the icon's own roundness; cards and
code blocks at the app's `--r-md` (10 px), about the card's 8 percent at the
sizes they are drawn; the ink as the text; and the orange underline, drawn
from the icon's own path, as the one decorative stroke on each page, under
its title.

## Palette

### Light

| Role | Token | Hex | From | Contrast |
| --- | --- | --- | --- | --- |
| Page background | `--bg` | `#eef1f4` | `styles.css --bg` | - |
| Content background, the napkin | `--paper` | `#fcfaf5` | `icon.svg` card; `styles.css --paper` | - |
| Bars and menu | `--surface` | `#ffffff` | `styles.css --surface` | - |
| Code blocks, table headings | `--surface-2` | `#f5f7fa` | `styles.css --surface-2` | - |
| Text | `--ink` | `#1f2328` | `icon.svg` stroke; `styles.css --ink` | 15.14:1 on paper, 15.80:1 on surface, 14.72:1 on surface-2 |
| Muted text: breadcrumbs, footer, notes | `--ink-soft` | `#586069` | `styles.css --ink-soft` | 6.12:1 on paper, 6.38:1 on surface, 5.63:1 on bg |
| Links, the current page in the menu | `--link` | `#1b3fae` | `icon.svg` gradient end | 8.50:1 on paper, 8.87:1 on surface |
| Headings | `--heading` | `#27496d` | `styles.css --primary` | 8.91:1 on paper, 9.29:1 on surface |
| Focus ring (never text) | `--focus` | `#2f6fed` | `icon.svg` gradient start | 4.36:1 on paper: a user-interface outline needs 3:1 |
| The decorative stroke (never text) | `--accent` | `#f08c2e` | `icon.svg` underline | 2.37:1 on paper: decoration only |
| Callout text | `--accent-text` | `#b3541e` | `styles.css --accent` | 4.79:1 on paper, 5.00:1 on surface |
| Rules and borders | `--border` | `#d7dee6` | `styles.css --border` | - |

### Dark

The app's own dark theme (`styles.css :root[data-theme="dark"]`) for the
neutrals. Its primary, `#4d80b3`, reaches only 3.53:1 on the dark surface, so
links and headings take lighter blues that do reach 4.5:1.

| Role | Token | Hex | Contrast |
| --- | --- | --- | --- |
| Page background | `--bg` | `#1b1f24` | - |
| Content background | `--paper` | `#24292f` | - |
| Bars and menu | `--surface` | `#1f242a` | - |
| Code blocks, table headings | `--surface-2` | `#2d333b` | - |
| Text | `--ink` | `#e6edf3` | 12.40:1 on paper, 10.78:1 on surface-2 |
| Muted text | `--ink-soft` | `#9aa5b1` | 5.85:1 on paper, 6.62:1 on bg |
| Links | `--link` | `#8ab4f8` | 6.95:1 on paper, 7.86:1 on bg |
| Headings | `--heading` | `#9cc1ea` | 7.84:1 on paper |
| Focus ring (never text) | `--focus` | `#5b8ef2` | 4.60:1 on paper |
| The decorative stroke | `--accent` | `#f08c2e` | 5.93:1 on paper |
| Callout text | `--accent-text` | `#f0a35e` | 7.05:1 on paper |
| Rules and borders | `--border` | `#3a414a` | - |

The site follows the reader's system setting (`prefers-color-scheme`) and
keeps a choice made with the theme button, which it stores in the browser.

## Type

- **Text**: `"Segoe UI", system-ui, -apple-system, sans-serif`, measured from
  the app's own interface text as the former banner, `assets/screenshot.svg`,
  drew it; 1.0.0-alpha.4.5.0 replaced that banner with the picture
  `assets/bannerImage.png`.
- **Code**: `"Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace`.
- **Scale**: 13, 16 (body), 18, 22 and 30 px. The former banner's interface
  text was 13 to 15 px; body text is one step up from that for long reading,
  and the headings keep that banner's 18, 22 and 30.
- **Line height**: 1.6 for body text, 1.25 for headings.

## Space and shape

- **Spacing**: the app's 8 px grid - 4, 8, 12, 16, 24 px (`--s1` to `--s5`) -
  with 32 and 48 px (`--s6`, `--s7`) for the gaps between sections of a page.
- **Radii**: 6 px (`--r-sm`) for buttons and code spans, 10 px (`--r-md`) for
  cards, code blocks and tables; the brand mark keeps the icon's 22 percent.
- **Measure**: the text column is at most 820 px wide, about 80 characters at
  the body size.
- **Layout**: a fixed bar across the top and a fixed menu down the left on a
  wide screen; below 900 px the menu slides in from the left over a dimming
  scrim, opened by the **Menu** button.

## Motion

Only the menu's slide, 160 ms (`styles.css --motion`), and none at all when
the reader's system asks for reduced motion.
