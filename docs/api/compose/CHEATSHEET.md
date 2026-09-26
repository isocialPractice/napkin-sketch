# The graphic design API: cheatsheet

[API hub](../../../API.md) · [Reference](README.md) · [Quickstart](QUICKSTART.md) · **Cheatsheet**

Reminders for compositions: the page, every element, paint, masks, rendering, and the Node and brand helpers.

## The page

| `createComposition({ ... })` | Default | Meaning |
| --- | --- | --- |
| `width`, `height` | `360` | Page size, in `units` |
| `units` | `'px'` | `px`, `in`, `mm` or `pt`, at 96 pixels to the inch |
| `background` | `null` | A CSS color, or `null` for transparent |
| `id`, `title` | none | The root `<svg id>`, and a `<title>` for screen readers |
| `useGuiCanvas` | `false` | `true` only inside the app, where `paintComposition` draws into its canvas |

## Elements

| Method | Needs | Example |
| --- | --- | --- |
| `rect` | `x, y, width, height`; `rx`, `ry` | `design.rect({ x: 20, y: 20, width: 120, height: 60, rx: 12, fill: '#326478' })` |
| `circle` | `cx, cy, r` | `design.circle({ cx: 80, cy: 80, r: 40, fill: '#4cae50' })` |
| `ellipse` | `cx, cy, rx, ry` | `design.ellipse({ cx: 200, cy: 80, rx: 60, ry: 30, fill: '#fdc83a' })` |
| `triangle` | `x, y, width, height, variant`, or `points` | `design.triangle({ x: 20, y: 20, width: 80, height: 70, variant: 'up' })` |
| `polygon` | `points`, closed | `design.polygon({ points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }] })` |
| `polyline` | `points`, open | `design.polyline({ points, fill: null, stroke: '#1f2328' })` |
| `line` | `x1, y1, x2, y2` | `design.line({ x1: 16, y1: 100, x2: 344, y2: 100, stroke: '#4cae50' })` |
| `path` | `d`: `M L H V C S Q T Z` | `design.path({ d: 'M 20 130 C 60 110, 100 170, 140 130', fill: null, stroke: '#dc143c' })` |
| `text` | `x, y, text` | `design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fontSize: 28 })` |
| `image` | `src, x, y, width, height`; `fit` | `design.image({ src: logo, x: 24, y: 24, width: 64, height: 64, fit: 'contain' })` |
| `image`, linked | `link: true`; `src` is a path | `design.image({ src: 'assets/logo.svg', link: true, x: 24, y: 24, width: 120, height: 60 })` |
| `group` | a builder callback, or `children` | `design.group({ translate: { x: 40, y: 0 } }, (g) => g.circle({ cx: 40, cy: 40, r: 32 }))` |

## Every element also takes

| Property | Values |
| --- | --- |
| `fill` | A CSS color, a gradient, or `null` |
| `stroke`, `strokeWidth` | A CSS color or `null`; a width, default 1 |
| `fillOpacity`, `strokeOpacity`, `opacity` | 0 to 1 |
| `fillRule` | `nonzero` or `evenodd` |
| `lineCap`, `lineJoin` | `butt`, `round`, `square`; `miter`, `round`, `bevel` |
| `dash`, `dashOffset` | `[6, 3]`; a number |
| `rotate`, `scale`, `translate`, `origin` | Degrees clockwise; a number or `{ x, y }`; `{ x, y }`; the pivot, default the centre |
| `clip` | A mask id, or an inline shape |
| `effects` | `[{ type: 'blur', radius: 4 }, { type: 'sepia', amount: 0.8 }]`, drawn in order |
| `id`, `name`, `visible` | An SVG id; `data-name`; `false` keeps it out of every render |

## Text

| Property | Default | Values |
| --- | --- | --- |
| `fontFamily`, `fontSize` | a sans stack, `16` | A CSS family list; a size |
| `fontWeight`, `fontStyle` | `normal` | `bold` or a weight; `italic` |
| `align` | `left` | `left`, `center`, `right`, `justify` |
| `baseline` | `alphabetic` | `alphabetic`, `top`, `middle`, `bottom` |
| `maxWidth`, `lineHeight` | none, `1.2` | The wrap width; the line advance in font sizes |
| `letterSpacing`, `wordSpacing`, `indent`, `paragraphSpacing` | `0` | Extra space |
| `decoration`, `transform` | `none` | `underline`, `line-through`; `uppercase`, `lowercase`, `capitalize` |

## Paint, masks and holes

| Want | Write |
| --- | --- |
| A linear gradient | `fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffe08a' }, { offset: 1, color: '#ff8a65' }] }` |
| A radial gradient | `fill: { type: 'radial', stops: [...] }` |
| A shared mask | `design.defineClip('badge', { type: 'circle', cx: 60, cy: 60, r: 40 })`, then `clip: 'badge'` |
| A one-off mask | `clip: { type: 'rect', x: 30, y: 30, width: 60, height: 60 }` |
| A hole in a group | `design.group({ erase: [{ type: 'circle', cx: 60, cy: 40, r: 14 }] }, (g) => { ... })` |
| A shadow | `effects: [{ type: 'drop-shadow', dx: 4, dy: 4, blur: 8, color: 'rgba(0, 0, 0, 0.4)' }]` |
| One shadow for a group | `design.group({ effects: [{ type: 'drop-shadow', dx: 0, dy: 6, blur: 6, color: '#0006' }] }, (g) => { ... })` |

## Rendering

| Call | Gives |
| --- | --- |
| `design.toSVG({ pretty, precision })` | SVG text |
| `design.toPNG({ scale })` | PNG bytes, a `Uint8Array` |
| `design.rasterize({ scale, decodeImage, resolveLink })` | `{ width, height, data, warnings }` |
| `renderComposition(design, { format })` | Either, by `format` |
| `renderPng(doc, options)` | `{ data, width, height, warnings }` |
| `compositionToSvg(doc)` | SVG text, from a document |

## Node and brand helpers

| Call | Does |
| --- | --- |
| `imageDataUrl('assets/logo.png')` | A file as a data URL, for `src` |
| `writeComposition(design, 'out', 'card')` | `out/card.svg` and `out/card.png`, from one document |
| `resolveLinkFromDir('./brand')` | A resolver that reads links inside one folder |
| `parseResources(markdown)` | A brand's `resources.md`: `{ paths, directories, text }` |
| `placeBrand(design, box, asset, { fit })` | A logo into a slot; a vector is inlined |
| `inlineSvg(markup)` | An SVG's shapes as elements: `{ viewBox, elements, notes }` |
| `brandMark(design, box, { label })` | A monogram where no asset is configured |

- The Node helpers come from `napkin-sketch/node`; everything else from `napkin-sketch`.

## Common mistakes

| Wrong | Right | Why |
| --- | --- | --- |
| An SVG logo placed with `image` | `placeBrand` or `inlineSvg` | The PNG decodes only PNG itself: an SVG image is a hole in it. |
| Runs of text advanced by `measureText` | The font's own metric: `0.6 em` a character for monospace | Runs overlap in the SVG otherwise. |
| Small text at `scale: 1` | `toPNG({ scale: 2 })` or `3` | A stroke under a device pixel is grey mush. |
| `fill: '#32647'` | `fill: '#326478'` | The PNG render throws on a color it cannot read; the SVG writes it as given. |
