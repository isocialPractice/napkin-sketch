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
