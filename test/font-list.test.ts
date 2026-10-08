/**
 * The fonts the Type panel lists (src/renderer/font-list.ts): the faces the
 * Local Font Access API gives, gathered into families A to Z, each family's
 * faces lightest first; a CSS family list read name by name; what counts as
 * installed - a family here, a kind CSS always has, anything when the list
 * could not be read; and the fonts chosen lately. `queryLocalFonts` is a
 * stand-in here; the GUI check `check-type-panel.mjs` reads the real one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FontList, RECENT_FONTS, familiesOf, familyNames } from '../src/renderer/font-list.js';

test('faces gather into families, A to Z, each family its faces lightest first, upright before italic', () => {
  const families = familiesOf([
    { family: 'Zebra Sans', style: 'Bold' },
    { family: 'acme serif', style: 'Italic' },
    { family: 'Acme Serif', style: 'Regular' },
    { family: 'Zebra Sans', style: 'Light' },
    { family: 'Zebra Sans', style: 'Regular' },
    { family: 'Zebra Sans', style: 'Bold Italic' },
    { family: '  ', style: 'Regular' },
  ]);
  assert.deepEqual(families.map((f) => f.name), ['acme serif', 'Zebra Sans'], 'one family whatever its case; a nameless face left out');
  assert.deepEqual(families[0].styles, ['Regular', 'Italic']);
  assert.deepEqual(families[1].styles, ['Light', 'Regular', 'Bold', 'Bold Italic']);
});

test('a CSS family list is read name by name, unquoted', () => {
  assert.deepEqual(familyNames('"Segoe UI", system-ui, sans-serif'), ['Segoe UI', 'system-ui', 'sans-serif']);
  assert.deepEqual(familyNames("'Acme Serif'"), ['Acme Serif']);
  assert.deepEqual(familyNames(' , '), []);
});

test('what is installed: a family the system has, a kind CSS always has; anything while the list is the stand-ins', async () => {
  const fonts = new FontList();
  assert.equal(fonts.available, false);
  assert.equal(fonts.has('No Such Font'), true, 'with no list to tell, nothing is missing');
  const stub = { queryLocalFonts: async () => [{ family: 'Acme Serif', fullName: 'Acme Serif', postscriptName: 'AcmeSerif', style: 'Regular' }] };
  const was = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = stub;
  try {
    let heard = 0;
    fonts.onChange(() => heard++);
    await fonts.load();
    assert.equal(fonts.available, true);
    assert.equal(heard, 1);
    assert.equal(fonts.has('acme serif'), true);
    assert.equal(fonts.has('No Such Font'), false);
    assert.equal(fonts.has('"No Such Font", sans-serif'), true, 'a list falls back to a kind');
    assert.deepEqual(fonts.styles('"Acme Serif", serif'), ['Regular']);
    assert.deepEqual(fonts.styles('No Such Font'), []);
  } finally {
    (globalThis as { window?: unknown }).window = was;
  }
});

test('the fonts chosen lately: the last first, each once, so many kept', () => {
  const fonts = new FontList();
  for (const name of ['A', 'B', 'a', 'C', 'D', 'E', 'F', 'G']) fonts.touch(name);
  assert.equal(fonts.recent.length, RECENT_FONTS);
  assert.deepEqual(fonts.recent.slice(0, 3), ['G', 'F', 'E']);
  assert.equal(fonts.recent.filter((n) => n.toLowerCase() === 'a').length, 1);
  fonts.touch('"Segoe UI", system-ui');
  assert.equal(fonts.recent[0], 'Segoe UI', 'a list is its first name');
});
