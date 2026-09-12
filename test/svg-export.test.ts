/** Layer-aware SVG export tests (Surface.toSVG is DOM-free). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Surface } from '../src/renderer/surface.js';
import { decodeIdName, isAutoId, parsePathD, parseVectorD } from '../src/renderer/svg-import.js';
import {
  createGroupLayer,
  createLayer,
  createSketch,
  type Sketch,
  type VectorAnchor,
} from '../src/core/types.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The `d` of the first path in an exported document. */
function pathDataOf(svg: string): string {
  return /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
}

function layeredSketch(): Sketch {
  const sketch = createSketch('layered');
  const base = sketch.layers[0];
  base.name = 'Base';
  const top = createLayer('Top');
  top.opacity = 0.5;
  sketch.layers.push(top);

  sketch.strokes.push(
    {
      id: 's1',
      tool: 'pen',
      color: '#123456',
      width: 3,
      layer: base.id,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    },
    {
      id: 'e1',
      tool: 'eraser',
      color: '#000000',
      width: 8,
      layer: base.id,
      points: [
        { x: 2, y: 2 },
        { x: 8, y: 8 },
      ],
    },
    {
      id: 't1',
      tool: 'text',
      color: '#1f2328',
      width: 1,
      layer: top.id,
      points: [{ x: 20, y: 30 }],
      text: 'note',
      fontSize: 24,
    },
  );
  return sketch;
}

test('toSVG groups strokes into named layer groups', () => {
  const svg = Surface.toSVG(layeredSketch());
  assert.match(svg, /<g [^>]*data-name="Base"/);
  assert.match(svg, /<g [^>]*data-name="Top"[^>]*opacity="0.5"/);
  assert.match(svg, /data-tool="pen"/);
  assert.match(svg, /<text [^>]*data-tool="text"/);
});

test('toSVG renders erasers as a black-on-white layer mask', () => {
  const svg = Surface.toSVG(layeredSketch());
  assert.match(svg, /<mask id="erase-0">/);
  assert.match(svg, /<g [^>]*mask="url\(#erase-0\)"/);
  // Eraser paths live in the mask, painted black.
  assert.match(svg, /<mask[^]*stroke="#000"[^]*data-tool="eraser"[^]*<\/mask>/);
});

test('toSVG skips hidden layers entirely', () => {
  const sketch = layeredSketch();
  sketch.layers[1].visible = false;
  const svg = Surface.toSVG(sketch);
  assert.ok(!svg.includes('data-name="Top"'));
  assert.ok(!svg.includes('<text'));
});

test('toSVG keeps paint order via data-i attributes', () => {
  const svg = Surface.toSVG(layeredSketch());
  assert.match(svg, /data-tool="pen" data-i="0"/);
  assert.match(svg, /data-tool="eraser" data-i="1"/);
  assert.match(svg, /data-tool="text" data-i="2"/);
});

test('toSVG exports copic strokes as filled nib outlines with round-trip data', () => {
  const sketch = createSketch('copic');
  sketch.strokes.push({
    id: 'c1',
    tool: 'copic',
    color: '#27486d',
    width: 12,
    nibAngle: 30,
    layer: sketch.layers[0].id,
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 40 },
    ],
  });
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /<path [^>]*fill="#27486d"[^>]*fill-rule="nonzero"[^>]*data-tool="copic"/);
  assert.match(svg, /data-nib="30"/);
  assert.match(svg, /data-width="12"/);
  assert.match(svg, /data-pts="10,10 50,40"/);
  // The filled outline uses the copic default opacity when none is set.
  assert.match(svg, /data-tool="copic"[^>]*/);
  assert.match(svg, /opacity="0.5"/);
});

test('toSVG writes coordinates without a redundant trailing .0', () => {
  const svg = Surface.toSVG(layeredSketch());
  assert.match(svg, /d="M0 0 10 10"/);
  assert.match(svg, /<text x="20" y="30"/);
});

test('toSVG states the paint every mark shares once, on the root element', () => {
  const svg = Surface.toSVG(layeredSketch());
  // Inherited by every mark below, so no path repeats any of it.
  assert.match(svg, /<svg [^>]*fill="none" stroke-linecap="round" stroke-linejoin="round"/);
  assert.ok(!/<path[^>]*stroke-linecap/.test(svg), 'paths must not repeat the cap');
  assert.ok(!/<path[^>]*fill="none"/.test(svg), 'paths must not repeat the empty fill');
  // `opacity` is not inherited, and 1 is its default, so it goes unwritten too.
  assert.ok(!/opacity="1"/.test(svg), 'a fully opaque mark says nothing about opacity');
});

test('toSVG hoists the width most marks share and names only the odd one out', () => {
  const sketch = createSketch('widths');
  const layer = sketch.layers[0].id;
  const mark = (id: string, width: number) => ({
    id,
    tool: 'pen' as const,
    color: '#123456',
    width,
    layer,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  });
  sketch.strokes.push(mark('a', 3), mark('b', 3), mark('c', 8));
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /<svg [^>]*stroke-width="3"/);
  assert.equal(svg.match(/<path[^>]*stroke-width=/g)?.length, 1);
  assert.match(svg, /<path[^>]*stroke-width="8"/);
});

test('toSVG prunes polyline samples that add nothing within tolerance', () => {
  const sketch = createSketch('dense');
  // 200 samples along a straight line plus one real corner: only the three
  // defining points survive export.
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 200; i++) points.push({ x: i / 2, y: 0 });
  points.push({ x: 100, y: 50 });
  sketch.strokes.push({
    id: 'd1',
    tool: 'pen',
    color: '#123456',
    width: 2,
    layer: sketch.layers[0].id,
    points,
  });
  const svg = Surface.toSVG(sketch);
  // Axis-aligned runs collapse onto `H`/`V`, which say the same in half the
  // numbers.
  assert.match(svg, /d="M0 0H100V50"/);
});

test('toSVG exports vector strokes as exact cubic Béziers, not their samples', () => {
  const sketch = createSketch('vector');
  sketch.strokes.push({
    id: 'v1',
    tool: 'pen',
    color: '#123456',
    width: 2,
    layer: sketch.layers[0].id,
    // Dense samples stand in for the resampled curve; the anchors must win.
    points: Array.from({ length: 300 }, (_, i) => ({ x: i, y: i })),
    vector: {
      anchors: [
        { p: { x: 10, y: 10 }, hOut: { x: 40, y: 10 } },
        { p: { x: 90, y: 60 }, hIn: { x: 60, y: 60 } },
        { p: { x: 120, y: 90 } },
      ],
    },
  });
  const svg = Surface.toSVG(sketch);
  // The same two cubic handles an absolute `C` would carry, written relative
  // because that is the shorter spelling of them.
  assert.match(svg, /d="M10 10c30 0 50 50 80 50l30 30"/);
  assert.ok(!svg.includes('1 1 2 2'), 'sampled points must not be written');
  assert.deepEqual(parseVectorD(pathDataOf(svg))?.anchors, sketch.strokes[0].vector?.anchors);
});

test('toSVG closes a closed vector stroke with its closing segment and Z', () => {
  const sketch = createSketch('closed');
  sketch.strokes.push({
    id: 'v2',
    tool: 'pen',
    color: '#123456',
    width: 2,
    layer: sketch.layers[0].id,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 25, y: 40 },
      { x: 0, y: 0 },
    ],
    vector: {
      anchors: [
        { p: { x: 0, y: 0 } },
        { p: { x: 50, y: 0 } },
        { p: { x: 25, y: 40 } },
      ],
      closed: true,
    },
  });
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /d="M0 0H50L25 40 0 0Z"/);
  const parsed = parseVectorD(pathDataOf(svg));
  assert.equal(parsed?.closed, true);
  assert.deepEqual(parsed?.anchors, sketch.strokes[0].vector?.anchors);
});

/** A sketch with a layer group, laid out in store order (children, then group row). */
function groupedSketch(): Sketch {
  const sketch = createSketch('grouped');
  sketch.layers[0].name = 'Base';
  const group = createGroupLayer('circle-orange');
  const fill = createLayer('fill');
  fill.parent = group.id;
  const strokes = createLayer('strokes');
  strokes.parent = group.id;
  sketch.layers.push(fill, strokes, group);

  const mark = (id: string, layer: string) => ({
    id,
    tool: 'pen' as const,
    color: '#123456',
    width: 2,
    layer,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  });
  sketch.strokes.push(
    mark('b1', sketch.layers[0].id),
    mark('f1', fill.id),
    mark('s1', strokes.id),
  );
  return sketch;
}

test('toSVG nests layer groups as nested <g> elements', () => {
  const svg = Surface.toSVG(groupedSketch());
  // The group wraps its children instead of being flattened away.
  assert.match(
    svg,
    /<g id="circle-orange"[^>]*>\n<g id="fill"[^>]*>[^]*<\/g>\n<g id="strokes"[^>]*>[^]*<\/g>\n<\/g>/,
  );
  // The sibling leaf layer stays at the top level, painted first.
  assert.ok(svg.indexOf('data-name="Base"') < svg.indexOf('data-name="circle-orange"'));
});

test('toSVG writes each layer its own opacity and lets nesting compose them', () => {
  const sketch = groupedSketch();
  sketch.layers.find((l) => l.group)!.opacity = 0.5;
  sketch.layers.find((l) => l.name === 'fill')!.opacity = 0.8;
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /<g id="circle-orange"[^>]*opacity="0.5"/);
  // The child keeps its own opacity rather than a pre-multiplied effective one.
  assert.match(svg, /<g id="fill"[^>]*opacity="0.8"/);
});

test('toSVG drops a hidden group with its whole subtree', () => {
  const sketch = groupedSketch();
  sketch.layers.find((l) => l.group)!.visible = false;
  const svg = Surface.toSVG(sketch);
  assert.ok(!svg.includes('circle-orange'));
  assert.ok(!svg.includes('data-name="fill"'));
  assert.ok(svg.includes('data-name="Base"'));
});

test('toSVG prunes groups whose descendants hold no exportable strokes', () => {
  const sketch = groupedSketch();
  sketch.strokes = sketch.strokes.filter((s) => s.id === 'b1');
  const svg = Surface.toSVG(sketch);
  assert.ok(!svg.includes('circle-orange'));
  assert.ok(svg.includes('data-name="Base"'));
});

test('toSVG names every layer group for other editors', () => {
  const svg = Surface.toSVG(layeredSketch());
  assert.match(svg, /<svg [^>]*xmlns:inkscape="http:\/\/www\.inkscape\.org\/namespaces\/inkscape"/);
  assert.match(svg, /<g id="Base" [^>]*inkscape:label="Base" inkscape:groupmode="layer"/);
  assert.match(svg, /<g id="Top" [^>]*inkscape:label="Top" inkscape:groupmode="layer"/);
  // Names must not read as editor-generated ids, or an importer discards them.
  assert.ok(!isAutoId('Base'));
  assert.ok(!isAutoId('Top'));
});

test('toSVG escapes ids so a layer name survives the round trip', () => {
  const sketch = layeredSketch();
  sketch.layers[0].name = 'Rough draft (2 of 3)';
  const svg = Surface.toSVG(sketch);
  const id = /<g id="([^"]+)"/.exec(svg)?.[1] ?? '';
  assert.ok(!/[^A-Za-z0-9._-]/.test(id), `id "${id}" must be XML-safe`);
  assert.equal(decodeIdName(id), 'Rough draft (2 of 3)');
});

test('toSVG uniquifies ids when two layers share a name', () => {
  const sketch = layeredSketch();
  sketch.layers[1].name = 'Base';
  const ids = [...Surface.toSVG(sketch).matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['Base', 'Base-2']);
  // The `-2` uniquifier is an editor convention the importer strips back off.
  assert.equal(decodeIdName('Base-2'), 'Base');
});

/** A sketch with one closed shape carrying properties-panel paint. */
function paintedSketch(patch: Partial<Sketch['strokes'][number]>): Sketch {
  const sketch = createSketch('painted');
  sketch.strokes.push({
    id: 'p1',
    tool: 'pen',
    color: '#112233',
    width: 4,
    layer: sketch.layers[0].id,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ],
    ...patch,
  });
  return sketch;
}

test('a gradient fill exports as a paint server and an editable data attribute', () => {
  const svg = Surface.toSVG(
    paintedSketch({
      fill: '#eeeeee',
      gradient: {
        type: 'linear',
        angle: 0,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    }),
  );
  // A real SVG paint server, so other editors show the gradient...
  assert.match(svg, /<defs>[\s\S]*<linearGradient id="grad-0"/);
  assert.match(svg, /gradientUnits="userSpaceOnUse"/);
  assert.match(svg, /<stop offset="0%" stop-color="#ff0000"\/>/);
  assert.match(svg, /fill="url\(#grad-0\)"/);
  // ...plus napkin's own round-trip data, the flat fill included.
  assert.match(svg, /data-gradient="/);
  assert.match(svg, /data-fill="#eeeeee"/);
});

test('a radial gradient exports as a radial paint server', () => {
  const svg = Surface.toSVG(
    paintedSketch({
      gradient: {
        type: 'radial',
        stops: [
          { offset: 0, color: '#ffffff' },
          { offset: 1, color: '#000000' },
        ],
      },
    }),
  );
  assert.match(svg, /<radialGradient id="grad-0"[^>]*r="/);
  assert.doesNotMatch(svg, /<linearGradient/);
});

test('a one-stop gradient falls back to the flat fill', () => {
  const svg = Surface.toSVG(
    paintedSketch({ fill: '#abcdef', gradient: { type: 'linear', stops: [{ offset: 0, color: '#f00' }] } }),
  );
  assert.doesNotMatch(svg, /linearGradient/);
  assert.match(svg, /fill="#abcdef"/);
});

test('a dashed stroke exports a stroke-dasharray scaled to its width', () => {
  const svg = Surface.toSVG(paintedSketch({ strokeStyle: 'dashed' }));
  assert.match(svg, /stroke-dasharray="12,8"/);
  assert.match(svg, /data-dash="dashed"/);
});

test('a solid stroke carries no dash attributes', () => {
  const svg = Surface.toSVG(paintedSketch({}));
  assert.doesNotMatch(svg, /stroke-dasharray/);
  assert.doesNotMatch(svg, /data-dash/);
});

test('a fill-only shape exports as stroke="none" with its outline kept aside', () => {
  const svg = Surface.toSVG(paintedSketch({ fill: '#00ff00', noStroke: true }));
  assert.match(svg, /stroke="none"/);
  assert.match(svg, /data-nostroke="1"/);
  // The color and width are kept so re-importing restores the outline.
  assert.match(svg, /data-color="#112233"/);
  assert.match(svg, /data-width="4"/);
});

test('eraser masks are unaffected by the new paint attributes', () => {
  const sketch = paintedSketch({ noStroke: true, strokeStyle: 'dashed' });
  sketch.strokes.push({
    id: 'e2',
    tool: 'eraser',
    color: '#000000',
    width: 8,
    layer: sketch.layers[0].id,
    points: [
      { x: 2, y: 2 },
      { x: 8, y: 8 },
    ],
  });
  const svg = Surface.toSVG(sketch);
  const mask = svg.slice(svg.indexOf('<mask'), svg.indexOf('</mask>'));
  // Inside the mask, black means "hide": no dash pattern and no stroke="none"
  // may reach it, or the mask would stop cutting.
  assert.doesNotMatch(mask, /stroke-dasharray/);
  assert.doesNotMatch(mask, /stroke="none"/);
  assert.match(mask, /stroke="#000"/);
});

test('toSVG writes the page and its paper by default', () => {
  const sketch = layeredSketch();
  const svg = Surface.toSVG(sketch);
  assert.ok(svg.includes(`viewBox="0 0 ${sketch.width} ${sketch.height}"`));
  assert.ok(svg.includes(`width="${sketch.width}" height="${sketch.height}"`));
  assert.match(svg, /<rect width="\d+" height="\d+" fill="[^"]+"\/>/);
});

test('toSVG crops to a box by offsetting the viewBox, not the geometry', () => {
  const sketch = layeredSketch();
  const before = Surface.toSVG(sketch);
  const svg = Surface.toSVG(sketch, { crop: { minX: 10, minY: 20, maxX: 60, maxY: 100 } });
  assert.ok(svg.includes('width="50" height="80"'));
  assert.ok(svg.includes('viewBox="10 20 50 80"'));
  // Cropping must not move a single mark: the path data is untouched.
  const paths = (s: string): string[] => [...s.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(paths(svg), paths(before));
});

test('toSVG rounds a fractional crop and keeps a degenerate box usable', () => {
  const sketch = layeredSketch();
  const svg = Surface.toSVG(sketch, {
    crop: { minX: 1.234, minY: 2.126, maxX: 3.5, maxY: 4.25 },
  });
  assert.ok(svg.includes('viewBox="1.23 2.13 2.27 2.12"'), svg.slice(0, 400));
  const flat = Surface.toSVG(sketch, { crop: { minX: 5, minY: 5, maxX: 5, maxY: 5 } });
  assert.ok(flat.includes('width="1" height="1"'), 'an empty box still needs a viewport');
});

test('toSVG leaves out the paper rect when asked for a transparent document', () => {
  const sketch = layeredSketch();
  const svg = Surface.toSVG(sketch, { transparent: true });
  assert.ok(!svg.includes(`fill="${sketch.background}"`), 'no paper rect may remain');
  assert.match(svg, /<g [^>]*data-name="Base"/, 'the marks are still there');
  // The eraser mask keeps its own white cover; only the paper goes.
  assert.ok(svg.includes('<mask'), 'the eraser mask survives');
});

test('toSVG cropped and transparent is a sprite: sized to the box, no paper', () => {
  const svg = Surface.toSVG(layeredSketch(), {
    crop: { minX: 0, minY: 0, maxX: 12, maxY: 14 },
    transparent: true,
  });
  assert.ok(svg.includes('width="12" height="14"'));
  assert.ok(svg.includes('viewBox="0 0 12 14"'));
  assert.ok(
    !svg.includes(`fill="${layeredSketch().background}"`),
    'a sprite carries no background rectangle',
  );
});

test('a cropped export moves the eraser mask cover with the viewBox', () => {
  // A mask rect left at the origin while the viewBox sits elsewhere covers
  // none of the ink, and the mask then erases the whole layer.
  const svg = Surface.toSVG(layeredSketch(), {
    crop: { minX: 100, minY: 50, maxX: 160, maxY: 130 },
  });
  const mask = /<mask id="[^"]+"><rect ([^>]*)\/>/.exec(svg);
  assert.ok(mask, 'the eraser still exports as a mask');
  assert.equal(mask[1], 'x="100" y="50" width="60" height="80" fill="#fff"');
});

test('toSVG writes coordinates and widths at two decimals, without trailing zeros', () => {
  const sketch = createSketch('fine');
  sketch.strokes.push({
    id: 'f1',
    tool: 'pen',
    color: '#123456',
    // Transform dust from an import must not leak into the file.
    width: 0.9999999999999999,
    layer: sketch.layers[0].id,
    points: [
      { x: 10.256, y: 3.5 },
      { x: 20.004, y: 8.125 },
    ],
  });
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /d="M10.26 3.5 20 8.13"/);
  // The dust rounds to the 1 that SVG already defaults to, so the file names
  // no width at all rather than carrying sixteen decimals of it.
  assert.ok(!svg.includes('0.9999'), 'transform dust must not reach the file');
  assert.ok(!/stroke-width/.test(svg), 'a width of 1 is the SVG default');
});

test('toSVG writes an imported fill-only shape as fill with no outline', () => {
  const sketch = createSketch('fill-only');
  sketch.strokes.push({
    id: 'n1',
    tool: 'pen',
    color: '#e9af80',
    width: 1,
    fill: '#e9af80',
    noStroke: true,
    layer: sketch.layers[0].id,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    vector: {
      anchors: [{ p: { x: 0, y: 0 } }, { p: { x: 10, y: 0 } }, { p: { x: 10, y: 10 } }],
      closed: true,
    },
  });
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /<path d="M0 0H10V10L0 0Z" stroke="none" fill="#e9af80"/);
});

/**
 * The compacted path writer against the parser that has to read it back, over
 * a deterministic spread of random path data: arcs, quadratics, `S` chains,
 * axis-aligned runs, several subpaths, open and closed. The writer is correct
 * when a second trip through changes neither the anchors nor a single byte of
 * the path data.
 */
test('random path data survives import -> export -> import unchanged', () => {
  let seed = 20260830;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  const coord = (): number => {
    const r = rnd();
    if (r < 0.3) return Math.round(rnd() * 400 - 200);
    if (r < 0.55) return Math.round(rnd() * 400 - 200) + 0.5;
    if (r < 0.8) return r2(rnd() * 400 - 200);
    // Values under 1 are where the leading-zero and separator rules bite.
    return r2(rnd() * 2 - 1);
  };
  const key = (a: VectorAnchor): string =>
    `${r2(a.p.x)},${r2(a.p.y)}|${a.hIn ? `${r2(a.hIn.x)},${r2(a.hIn.y)}` : '-'}` +
    `|${a.hOut ? `${r2(a.hOut.x)},${r2(a.hOut.y)}` : '-'}|${a.move ? 'M' : ''}`;

  const randomD = (): string => {
    const parts: string[] = [`M${coord()},${coord()}`];
    for (let sp = 0; sp < 1 + Math.floor(rnd() * 3); sp++) {
      if (sp > 0) parts.push(`M${coord()},${coord()}`);
      for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
        const r = rnd();
        if (r < 0.3) parts.push(`C${coord()},${coord()} ${coord()},${coord()} ${coord()},${coord()}`);
        else if (r < 0.5) parts.push(`S${coord()},${coord()} ${coord()},${coord()}`);
        else if (r < 0.65) parts.push(`L${coord()},${coord()}`);
        else if (r < 0.75) parts.push(`H${coord()}`);
        else if (r < 0.85) parts.push(`V${coord()}`);
        else if (r < 0.93) parts.push(`Q${coord()},${coord()} ${coord()},${coord()}`);
        else {
          parts.push(
            `A${Math.abs(coord()) + 1},${Math.abs(coord()) + 1} 0 ${rnd() < 0.5 ? 0 : 1} ` +
              `${rnd() < 0.5 ? 0 : 1} ${coord()},${coord()}`,
          );
        }
      }
      if (rnd() < 0.5) parts.push('Z');
    }
    return parts.join(' ');
  };

  /** Folds parsed subpaths into one stroke, exactly as the importer does. */
  const fold = (d: string): { anchors: VectorAnchor[]; closed: boolean } | null => {
    const subs = parsePathD(d);
    if (!subs || subs.length === 0) return null;
    const anchors: VectorAnchor[] = [];
    for (const sub of subs) {
      const mapped = sub.anchors.map((a) => ({ ...a }));
      if (anchors.length > 0) mapped[0].move = true;
      anchors.push(...mapped);
    }
    return anchors.length < 2 ? null : { anchors, closed: subs.every((sp) => sp.closed) };
  };

  const write = (anchors: VectorAnchor[], closed: boolean): string => {
    const sketch = createSketch('fuzz');
    sketch.strokes.push({
      id: 'f',
      tool: 'pen',
      color: '#000000',
      width: 1,
      layer: sketch.layers[0].id,
      points: anchors.map((a) => ({ ...a.p })),
      vector: { anchors, ...(closed ? { closed: true as const } : {}) },
    });
    return pathDataOf(Surface.toSVG(sketch));
  };

  let checked = 0;
  for (let t = 0; t < 600; t++) {
    const first = fold(randomD());
    if (!first) continue;
    checked++;
    const d1 = write(first.anchors, first.closed);
    const second = fold(d1);
    assert.ok(second, `export did not parse back: ${d1}`);
    assert.equal(second.closed, first.closed, `closed flag changed: ${d1}`);
    assert.deepEqual(
      second.anchors.map(key),
      first.anchors.map(key),
      `geometry changed on the round trip: ${d1}`,
    );
    // A second export must be byte-identical, or the spelling is not stable.
    assert.equal(write(second.anchors, second.closed), d1);
  }
  assert.ok(checked > 400, `expected a real spread of paths, got ${checked}`);
});

/** What Export > Selection hands the exporter: the chosen marks, cropped. */
test('a selection exports alone, on a document cut to its own dimensions', () => {
  const sketch = createSketch('selection');
  const layer = sketch.layers[0].id;
  const mark = (id: string, x: number, y: number) => ({
    id,
    tool: 'pen' as const,
    color: '#123456',
    width: 4,
    layer,
    points: [
      { x, y },
      { x: x + 40, y: y + 30 },
    ],
  });
  // Two marks are picked and one is left behind, well away from them.
  sketch.strokes.push(mark('a', 100, 100), mark('b', 160, 150), mark('elsewhere', 900, 700));
  const chosen = sketch.strokes.filter((s) => s.id !== 'elsewhere');
  // The bounds grown by half the widest outline, which is what the renderer
  // measures a Selection export by.
  const crop = { minX: 98, minY: 98, maxX: 202, maxY: 182 };

  const svg = Surface.toSVG({ ...sketch, strokes: chosen }, { crop, transparent: true });
  // Sized to the selection, not to the 1280 x 800 page it was drawn on.
  assert.match(svg, /width="104" height="84" viewBox="98 98 104 84"/);
  // No paper rectangle, so the graphic drops into a composition as it is.
  assert.ok(!svg.includes('<rect'), 'a cropped selection export carries no paper');
  // The mark left out of the selection is left out of the file.
  assert.equal(svg.match(/<path /g)?.length, 2);
  assert.ok(!svg.includes('900'), 'the unselected mark must not be exported');
  // Cropping offsets the viewBox rather than moving the marks, so every
  // coordinate is the one a full-page export would have written.
  assert.ok(svg.includes('M100 100'), 'coordinates stay in page space');
});

test('a curve survives the compacted spelling with its geometry unchanged', () => {
  // A four-cubic circle, the shape most SVG artwork is actually made of: two
  // smooth joins that `S` can infer, and handles at the KAPPA distance.
  const k = (4 / 3) * (Math.SQRT2 - 1) * 50;
  const sketch = createSketch('circle');
  const anchors = [
    { p: { x: 100, y: 50 }, hIn: { x: 100 - k, y: 50 }, hOut: { x: 100 + k, y: 50 } },
    { p: { x: 150, y: 100 }, hIn: { x: 150, y: 100 - k }, hOut: { x: 150, y: 100 + k } },
    { p: { x: 100, y: 150 }, hIn: { x: 100 + k, y: 150 }, hOut: { x: 100 - k, y: 150 } },
    { p: { x: 50, y: 100 }, hIn: { x: 50, y: 100 + k }, hOut: { x: 50, y: 100 - k } },
  ].map((a) => ({
    p: a.p,
    hIn: { x: round2(a.hIn.x), y: round2(a.hIn.y) },
    hOut: { x: round2(a.hOut.x), y: round2(a.hOut.y) },
  }));
  sketch.strokes.push({
    id: 'c1',
    tool: 'pen',
    color: '#123456',
    width: 1,
    layer: sketch.layers[0].id,
    points: anchors.map((a) => ({ ...a.p })),
    vector: { anchors, closed: true },
  });

  const d = pathDataOf(Surface.toSVG(sketch));
  // Every anchor and every handle comes back at the coordinate it went in at.
  assert.deepEqual(parseVectorD(d)?.anchors, anchors);
  assert.equal(parseVectorD(d)?.closed, true);
  // And it does so in fewer bytes than the absolute cubic chain it replaces.
  const verbose = `M${anchors[0].p.x},${anchors[0].p.y} ` +
    anchors
      .map((from, i) => {
        const to = anchors[(i + 1) % anchors.length];
        return `C${from.hOut.x},${from.hOut.y} ${to.hIn.x},${to.hIn.y} ${to.p.x},${to.p.y}`;
      })
      .join(' ') + ' Z';
  assert.ok(d.length < verbose.length * 0.75, `${d.length} bytes is not well under ${verbose.length}`);
});

test('toSVG writes a compound vector stroke as one path with a subpath per contour', () => {
  const sketch = createSketch('compound');
  // A square with a square hole: the inner contour starts at a `move` anchor.
  const outer = [
    { p: { x: 0, y: 0 } },
    { p: { x: 10, y: 0 } },
    { p: { x: 10, y: 10 } },
    { p: { x: 0, y: 10 } },
  ];
  const inner = [
    { p: { x: 3, y: 3 }, move: true as const },
    { p: { x: 3, y: 7 } },
    { p: { x: 7, y: 7 } },
    { p: { x: 7, y: 3 } },
  ];
  sketch.strokes.push({
    id: 'k1',
    tool: 'pen',
    color: '#000000',
    width: 1,
    fill: '#000000',
    noStroke: true,
    layer: sketch.layers[0].id,
    points: [...outer, ...inner].map((a) => ({ ...a.p, ...(a.move ? { move: true as const } : {}) })),
    vector: { anchors: [...outer, ...inner], closed: true },
  });
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /d="M0 0H10V10H0V0ZM3 3V7H7V3H3Z"/);
});
