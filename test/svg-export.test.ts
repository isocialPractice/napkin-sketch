/** Layer-aware SVG export tests (Surface.toSVG is DOM-free). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Surface } from '../src/renderer/surface.js';
import { createLayer, createSketch, type Sketch } from '../src/core/types.js';

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
