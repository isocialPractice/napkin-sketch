/** Sketch-book serialization + normalization tests (browser-safe module). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeSketchBook,
  parseSketchBook,
  normalizeSketchBook,
  withSketchBookExtension,
  deriveName,
} from '../src/core/serialize.js';
import { createSketchBook } from '../src/core/types.js';

test('withSketchBookExtension appends .skbk only when needed', () => {
  assert.equal(withSketchBookExtension('notes'), 'notes.skbk');
  assert.equal(withSketchBookExtension('notes.skbk'), 'notes.skbk');
  assert.equal(withSketchBookExtension('a/b/notes.SKBK'), 'a/b/notes.SKBK');
});

test('deriveName strips folders and extension', () => {
  assert.equal(deriveName('C:/work/ideas.skbk'), 'ideas');
  assert.equal(deriveName('/home/u/sketch'), 'sketch');
});

test('serialize then parse round-trips a book', () => {
  const book = createSketchBook('demo');
  book.sketches[0].strokes.push({
    id: 's1',
    tool: 'pen',
    color: '#123456',
    width: 4,
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
    sharpened: true,
  });
  const restored = parseSketchBook(serializeSketchBook(book), 'demo');
  assert.equal(restored.name, 'demo');
  assert.equal(restored.sketches[0].strokes[0].color, '#123456');
  assert.equal(restored.sketches[0].strokes[0].points.length, 2);
});

test('normalizeSketchBook coerces junk into a valid book', () => {
  const book = normalizeSketchBook({ sketches: [{ strokes: [{ tool: 'bogus' }] }] }, 'fallback');
  assert.equal(book.format, 'napkin-sketch');
  assert.ok(book.sketches.length >= 1);
});

test('normalizeSketchBook drops zero-point strokes', () => {
  const book = normalizeSketchBook(
    { sketches: [{ strokes: [{ tool: 'pen', points: [] }] }] },
    'x',
  );
  assert.equal(book.sketches[0].strokes.length, 0);
});

test('select tool is normalized to pen on persistence', () => {
  const book = normalizeSketchBook(
    { sketches: [{ strokes: [{ tool: 'select', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }] },
    'x',
  );
  assert.equal(book.sketches[0].strokes[0].tool, 'pen');
});

test('version 1 documents (no layers) gain a default layer', () => {
  const v1 = {
    format: 'napkin-sketch',
    version: 1,
    name: 'old',
    sketches: [
      {
        id: 'sk1',
        name: 'page',
        width: 640,
        height: 480,
        background: '#fcfaf5',
        strokes: [
          { id: 's1', tool: 'pen', color: '#1f2328', width: 3, points: [{ x: 1, y: 2 }] },
        ],
      },
    ],
  };
  const book = normalizeSketchBook(v1, 'old');
  const sketch = book.sketches[0];
  assert.equal(sketch.layers.length, 1);
  assert.equal(sketch.layers[0].opacity, 1);
  assert.equal(sketch.layers[0].visible, true);
  assert.equal(sketch.layers[0].locked, false);
  assert.equal(sketch.strokes[0].layer, sketch.layers[0].id);
});

test('layer stack and stroke layer ids round-trip', () => {
  const book = createSketchBook('layered');
  const sketch = book.sketches[0];
  sketch.layers.push({ id: 'ly_top', name: 'Top', opacity: 0.5, visible: false, locked: true });
  sketch.strokes.push({
    id: 's1',
    tool: 'pen',
    color: '#123456',
    width: 4,
    layer: 'ly_top',
    points: [{ x: 1, y: 2 }],
  });
  const restored = parseSketchBook(serializeSketchBook(book), 'layered');
  const rs = restored.sketches[0];
  assert.equal(rs.layers.length, 2);
  assert.equal(rs.layers[1].name, 'Top');
  assert.equal(rs.layers[1].opacity, 0.5);
  assert.equal(rs.layers[1].visible, false);
  assert.equal(rs.layers[1].locked, true);
  assert.equal(rs.strokes[0].layer, 'ly_top');
});

test('strokes with unknown layer ids fall back to the first layer', () => {
  const book = normalizeSketchBook(
    {
      sketches: [
        {
          layers: [{ id: 'ly_a', name: 'A' }],
          strokes: [{ tool: 'pen', layer: 'ly_gone', points: [{ x: 0, y: 0 }] }],
        },
      ],
    },
    'x',
  );
  assert.equal(book.sketches[0].strokes[0].layer, 'ly_a');
});

test('image items keep their data and are dropped when the data is missing', () => {
  const book = normalizeSketchBook(
    {
      sketches: [
        {
          strokes: [
            {
              tool: 'image',
              image: 'data:image/png;base64,AAAA',
              imageWidth: 40,
              imageHeight: 30,
              points: [{ x: 5, y: 6 }],
            },
            { tool: 'image', points: [{ x: 0, y: 0 }] },
          ],
        },
      ],
    },
    'x',
  );
  const strokes = book.sketches[0].strokes;
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].tool, 'image');
  assert.equal(strokes[0].image, 'data:image/png;base64,AAAA');
  assert.equal(strokes[0].imageWidth, 40);
  assert.equal(strokes[0].imageHeight, 30);
});

test('vector anchor structure survives a save/load round trip', () => {
  const book = normalizeSketchBook(
    {
      sketches: [
        {
          strokes: [
            {
              tool: 'pen',
              points: [
                { x: 0, y: 0 },
                { x: 50, y: 50 },
              ],
              vector: {
                anchors: [
                  { p: { x: 0, y: 0 }, hOut: { x: 10, y: -10 } },
                  { p: { x: 50, y: 50 }, hIn: { x: 40, y: 60 } },
                ],
                closed: true,
              },
            },
          ],
        },
      ],
    },
    'demo',
  );
  const restored = parseSketchBook(serializeSketchBook(book), 'demo');
  const vector = restored.sketches[0].strokes[0].vector;
  assert.ok(vector);
  assert.equal(vector.anchors.length, 2);
  assert.deepEqual(vector.anchors[0].hOut, { x: 10, y: -10 });
  assert.deepEqual(vector.anchors[1].hIn, { x: 40, y: 60 });
  assert.equal(vector.closed, true);
});

test('malformed vector data drops cleanly while the stroke survives', () => {
  const book = normalizeSketchBook(
    {
      sketches: [
        {
          strokes: [
            {
              tool: 'pen',
              points: [
                { x: 0, y: 0 },
                { x: 9, y: 9 },
              ],
              vector: { anchors: [{ p: { x: 'bad' } }] },
            },
          ],
        },
      ],
    },
    'demo',
  );
  const stroke = book.sketches[0].strokes[0];
  assert.equal(stroke.vector, undefined);
  assert.equal(stroke.points.length, 2);
});
