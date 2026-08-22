/** Layer-aware SVG export tests (Surface.toSVG is DOM-free). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Surface } from '../src/renderer/surface.js';
import { decodeIdName, isAutoId } from '../src/renderer/svg-import.js';
import { createGroupLayer, createLayer, createSketch, type Sketch } from '../src/core/types.js';

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
  assert.match(svg, /d="M0,0 L10,10"/);
  assert.match(svg, /<text x="20" y="30"/);
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
  assert.match(svg, /d="M0,0 L100,0 L100,50"/);
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
  assert.match(svg, /d="M10,10 C40,10 60,60 90,60 L120,90"/);
  assert.ok(!svg.includes('L1,1'), 'sampled points must not be written');
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
  assert.match(svg, /d="M0,0 L50,0 L25,40 L0,0 Z"/);
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
