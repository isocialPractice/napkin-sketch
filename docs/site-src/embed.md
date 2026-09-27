# Embedding the editor

## At a glance

- **Embeddable API** — drop the same editor into a website, WordPress block, or
  VS Code webview (see [Embedding](#embedding-the-editor)).
- **Graphic-design API** — build a composition from rectangles, circles,
  ellipses, triangles, polygons, clipping masks, styled text and placed media,
  with CSS filter effects - a blur, a drop shadow, a color shift - on any of
  them, then render it to SVG or PNG from a plain Node script, with no browser and no
  image dependency. Both formats come off one document, so they are the same
  graphic (see [the graphic design API](../api/compose/README.md)).

The same drawing engine ships as a **framework-agnostic, browser-safe** package
with no Electron or Node dependencies. Use it on a website, in a WordPress
block, or inside a VS Code webview.

With a bundler (ESM):

```ts
import { NapkinSketch } from 'napkin-sketch';
import 'napkin-sketch/styles.css';

const editor = new NapkinSketch(document.getElementById('host')!, {
  liveSharpen: false, // off by default, like the desktop app
  onChange: (e) => console.log(e.toJSON()),
});

editor.setTool('pen');
editor.sharpenAll();
const png = editor.toDataURL('image/png');
const svg = editor.toSVG();  // lossless vector export
const pdf = editor.toPDF();  // latin1-safe byte string; save with binary encoding
```

Via a plain `<script>` tag (the IIFE build exposes a global `napkin`):

```html
<div id="host" style="width: 640px; height: 420px"></div>
<script src="node_modules/napkin-sketch/dist/embed/napkin-sketch.js"></script>
<script>
  const editor = new napkin.NapkinSketch(document.getElementById('host'));
</script>
```

You can also import just the pure engine (no DOM) to sharpen strokes yourself,
generate PDFs, or parse an SVG into layered strokes (browser only):

```ts
import { sharpenStrokes, parseSketchBook, sketchesToPdf, importSvg } from 'napkin-sketch';

// Nested groups and named objects come back as a nested layer tree. Pass
// `unnamedElements: 'split'` to also give every unnamed element its own
// `<Path>` layer, mirroring an Illustrator layers panel exactly.
const { width, height, layers } = importSvg(svgText, { unnamedElements: 'split' });
```

Or draw from written instructions, a napkin script, with no pointer and no
DOM. The language is in the same browser-safe entry; reading and writing
files is in `napkin-sketch/node`:

```ts
import { drawSvg } from 'napkin-sketch';
import { drawFile } from 'napkin-sketch/node';

const { svg, diagnostics } = drawSvg('napkin 1\npage 400 300\ncircle 200 150 60');
const { ok, files } = await drawFile('card.napkin', { out: 'out', formats: ['svg', 'png', 'pdf'] });
```

[Using napkin-sketch from code](../api/node/README.md) covers both entries,
ES modules and CommonJS, the types and the result object.

## Drawing with the graphic-design API

Compositions are the other way to make a graphic here: instead of a pointer, a
script. Build a page out of simple elements - rectangles, circles, ellipses,
triangles, polygons, lines, paths, text, placed media and clipping masks, with
CSS filter effects on any of them - then render it to **SVG** or **PNG**.

```ts
import { createComposition } from 'napkin-sketch';

const design = createComposition({ width: 360, height: 360, background: '#f6f7f9' });

design.rect({ x: 24, y: 24, width: 312, height: 96, rx: 12, fill: '#326478' });
design.text({ x: 180, y: 78, text: 'Acme Corp', align: 'center', fontSize: 28, fill: '#ffffff' });
design.defineClip('badge', { type: 'circle', cx: 180, cy: 220, r: 64 });
design.image({ src: logo, x: 116, y: 156, width: 128, height: 128, fit: 'cover', clip: 'badge' });

const svg = design.toSVG();  // a string
const png = design.toPNG();  // PNG file bytes, rasterized in pure TypeScript
```

Headless by default and dependency-free in both directions: no browser, no
canvas, no Electron window, and no native image library. Pages default to 360
by 360 pixels, coordinates are pixels unless the page names another unit, and
the app's own canvas is drawn into only when it is explicitly handed over.

Both renderers read one document, so the SVG and the PNG of a composition are
the same graphic and differ only in the media export format. The full
reference, every element's properties, and worked examples are in
[the graphic design API](../api/compose/README.md). The AI helper that drives it is
[graphic-designer](ai-helpers.md#the-graphic-designer-helper), which reads an existing
graphic into a design language and generates scripts that compose more like it.

A composition can also place a brand's own files. `placeBrand` puts a resolved
asset into a slot, and for a vector it **inlines the asset's shapes** rather
than placing it as an image - the rasterizer decodes PNG and nothing else, so an
SVG logo placed as an image would render in the SVG and be a hole in the PNG,
silently. A slot with no
asset behind it is filled by `brandMark` with a monogram in the design
language's own palette, so a page is never left with a gap where a logo should
be. [The AI helpers' quickstart](../api/ai/QUICKSTART.md) is the short
version, from a clone to a branded graphic, and
[Give it your brand](../api/ai/README.md#give-it-your-brand) the long one.
