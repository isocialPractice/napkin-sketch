/**
 * The configuration popup's pure parts: which rows the search and the type
 * radios keep, what a shortcut cell says about a chord, and how edits are
 * held apart from the rows until Accept. The page's side is driven in
 * `test/gui/check-config-dialog.mjs`; here, only the skeleton it is drawn in
 * is checked, since a missing part would stop the page from starting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  applyEdits,
  chordCellState,
  CONFIG_DIALOG_PARTS,
  filterRows,
  matchesSearch,
  withEdit,
  type CellVerdict,
  type KeyValidator,
} from '../src/renderer/config-dialog.js';

interface Row {
  tool: string;
  type: string;
  key: string | null;
  on: boolean;
}

const ROWS: readonly Row[] = Object.freeze([
  Object.freeze({ tool: 'Pen', type: 'Draw:mark', key: 'P', on: true }),
  Object.freeze({ tool: 'Rotate', type: 'Transform:vector', key: 'Ctrl+R', on: true }),
  Object.freeze({ tool: 'Mirror', type: 'Transform:vector', key: 'O', on: false }),
]);

const textOf = (row: Row): string => `${row.tool} ${row.type} ${row.key ?? ''}`;
const isDraw = (row: Row): boolean => row.type.startsWith('Draw:');
const isTransform = (row: Row): boolean => row.type.startsWith('Transform:');

/** Warns when another row holds the chord, the way Edit Keyboard Shortcuts will. */
const holderWarns: KeyValidator<Row> = (row, chord, rows) => {
  const holder = rows.find((other) => other !== row && other.tool !== row.tool && other.key === chord);
  return holder ? { level: 'warn', message: `Used by ${holder.tool}` } : null;
};

test('the search keeps rows whose text contains it, in any case, and an empty search keeps them all', () => {
  assert.equal(matchesSearch('Rotate Transform:vector Ctrl+R', 'rot'), true);
  assert.equal(matchesSearch('Rotate Transform:vector Ctrl+R', 'ROT'), true);
  assert.equal(matchesSearch('Rotate Transform:vector Ctrl+R', '  ctrl+r  '), true);
  assert.equal(matchesSearch('Pen Draw:mark P', 'rot'), false);
  assert.equal(matchesSearch('Pen Draw:mark P', ''), true);
  assert.equal(matchesSearch('Pen Draw:mark P', '   '), true);
  // indexOf, not a word match: "ro" is inside Mirror too.
  assert.deepEqual(filterRows(ROWS, { query: 'ro', text: textOf }), [1, 2]);
});

test('the search and the ticked radio both have to keep a row, and the rows come back in order', () => {
  assert.deepEqual(filterRows(ROWS, {}), [0, 1, 2]);
  assert.deepEqual(filterRows(ROWS, { query: 'rot', text: textOf }), [1]);
  assert.deepEqual(filterRows(ROWS, { test: isTransform }), [1, 2]);
  assert.deepEqual(filterRows(ROWS, { query: 'o', text: textOf, test: isTransform }), [1, 2]);
  assert.deepEqual(filterRows(ROWS, { query: 'pen', text: textOf, test: isTransform }), []);
  assert.deepEqual(filterRows(ROWS, { query: 'pen', text: textOf, test: isDraw }), [0]);
  // A search with no text to look in keeps everything; so does no query.
  assert.deepEqual(filterRows(ROWS, { query: 'nothing' }), [0, 1, 2]);
  assert.deepEqual(filterRows(ROWS, { text: textOf }), [0, 1, 2]);
});

test('a shortcut cell with no chord has nothing to judge', () => {
  assert.deepEqual(chordCellState(ROWS[0], null, ROWS, holderWarns), { level: 'ok', message: 'No shortcut' });
  assert.deepEqual(chordCellState(ROWS[0], '', ROWS, holderWarns), { level: 'ok', message: 'No shortcut' });
});

test('a shortcut cell refuses text that is no chord, and the keys the app keeps for itself, before its validator is asked', () => {
  let asked = 0;
  const counting: KeyValidator<Row> = () => {
    asked++;
    return null;
  };
  const refused = (chord: string): CellVerdict => chordCellState(ROWS[0], chord, ROWS, counting);
  assert.deepEqual(refused('Ctrl+Nothing'), { level: 'refuse', message: 'Ctrl+Nothing is not a keyboard shortcut' });
  for (const [chord, start] of [
    ['Space', 'Space is held to pan'],
    ['Ctrl+Space', 'Space is held to pan'],
    ['Escape', 'Escape backs out'],
    ['Shift+Escape', 'Escape backs out'],
    ['Tab', 'Tab moves the focus'],
    ['Alt+F4', 'Alt+F4 closes the window'],
  ] as const) {
    const verdict = refused(chord);
    assert.equal(verdict.level, 'refuse', chord);
    assert.ok(verdict.message.startsWith(start), `${chord}: ${verdict.message}`);
    assert.ok(verdict.message.endsWith(', so it cannot be a shortcut'), `${chord}: ${verdict.message}`);
  }
  assert.equal(asked, 0, 'a refused chord never reaches the validator');
  // F4 alone, and Ctrl+Alt+F4, are ordinary chords.
  assert.equal(refused('F4').level, 'ok');
  assert.equal(refused('Ctrl+Alt+F4').level, 'ok');
  assert.equal(asked, 2);
});

test("a shortcut cell hands its validator the canonical chord and every row, and passes on the validator's word", () => {
  let seen: { chord: string; rows: readonly Row[] } | null = null;
  const recording: KeyValidator<Row> = (_row, chord, rows) => {
    seen = { chord, rows };
    return null;
  };
  assert.deepEqual(chordCellState(ROWS[0], 'ctrl + r', ROWS, recording), { level: 'ok', message: '' });
  assert.deepEqual(seen, { chord: 'Ctrl+R', rows: ROWS });

  assert.deepEqual(chordCellState(ROWS[0], 'Ctrl+R', ROWS, holderWarns), { level: 'warn', message: 'Used by Rotate' });
  assert.deepEqual(chordCellState(ROWS[0], 'Ctrl+M', ROWS, holderWarns), { level: 'ok', message: '' });
  // A row's own chord is no clash with itself.
  assert.deepEqual(chordCellState(ROWS[1], 'Ctrl+R', ROWS, holderWarns), { level: 'ok', message: '' });
  // With no validator, any chord that is not reserved is fine.
  assert.deepEqual(chordCellState(ROWS[0], 'Ctrl+R', ROWS), { level: 'ok', message: '' });
  // A validator can refuse too, for keys only it knows about.
  const noF5: KeyValidator<Row> = (_row, chord) => (chord === 'F5' ? { level: 'refuse', message: 'F5 would reload' } : null);
  assert.deepEqual(chordCellState(ROWS[0], 'F5', ROWS, noF5), { level: 'refuse', message: 'F5 would reload' });
});

test('an edit is held by row and field, and a value set back to the original is no edit at all', () => {
  const none = new Map<number, Partial<Row>>();
  const one = withEdit(none, ROWS, 0, 'key', 'Ctrl+M');
  assert.deepEqual([...one], [[0, { key: 'Ctrl+M' }]]);
  assert.equal(none.size, 0, 'the edits it started from are left alone');

  const two = withEdit(one, ROWS, 0, 'on', false);
  assert.deepEqual([...two], [[0, { key: 'Ctrl+M', on: false }]]);
  assert.deepEqual([...one], [[0, { key: 'Ctrl+M' }]]);

  const cleared = withEdit(two, ROWS, 2, 'key', null);
  assert.deepEqual(cleared.get(2), { key: null }, 'taking a shortcut away is an edit');

  const back = withEdit(cleared, ROWS, 0, 'key', 'P');
  assert.deepEqual(back.get(0), { on: false });
  const gone = withEdit(back, ROWS, 0, 'on', true);
  assert.equal(gone.has(0), false, 'a row with nothing left changed drops out');
  assert.deepEqual([...gone], [[2, { key: null }]]);
});

test('Accept gets every row with its edits, the rows it was given untouched', () => {
  let edits = new Map<number, Partial<Row>>();
  edits = withEdit(edits, ROWS, 0, 'key', 'Ctrl+M');
  edits = withEdit(edits, ROWS, 2, 'on', true);
  const accepted = applyEdits(ROWS, edits);
  assert.deepEqual(accepted, [
    { tool: 'Pen', type: 'Draw:mark', key: 'Ctrl+M', on: true },
    { tool: 'Rotate', type: 'Transform:vector', key: 'Ctrl+R', on: true },
    { tool: 'Mirror', type: 'Transform:vector', key: 'O', on: true },
  ]);
  assert.equal(accepted[1], ROWS[1], 'a row with no edits is passed through as it is');
  assert.notEqual(accepted[0], ROWS[0]);
  assert.equal(ROWS[0].key, 'P');
  assert.equal(ROWS[2].on, false);
});

test('a row the search and the radio hide keeps its edit, and Accept still hands it back', () => {
  const edits = withEdit(new Map<number, Partial<Row>>(), ROWS, 0, 'key', 'Ctrl+M');
  const shown = filterRows(applyEdits(ROWS, edits), { query: 'rot', text: textOf, test: isTransform });
  assert.deepEqual(shown, [1], 'Pen is out of view');
  assert.equal(applyEdits(ROWS, edits)[0].key, 'Ctrl+M');
  // The search reads a row as edited, so a new chord can be searched for.
  assert.deepEqual(filterRows(applyEdits(ROWS, edits), { query: 'ctrl+m', text: textOf }), [0]);
});

test('index.html has every part of the skeleton the popup looks for, inside #config-dialog', () => {
  const html = readFileSync(resolve(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="config-dialog"');
  assert.ok(start >= 0, 'there is a #config-dialog');
  const end = html.indexOf('<!--', start);
  const block = html.slice(start, end);
  const classes = new Set<string>();
  for (const match of block.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1].split(' ')) classes.add(name);
  }
  for (const part of CONFIG_DIALOG_PARTS) assert.ok(classes.has(part), `index.html's #config-dialog has .${part}`);
  assert.ok(/<table class="config-grid">[^]*<thead><tr><[/]tr><[/]thead>[^]*<tbody><[/]tbody>/.test(block), 'the table has a heading row and a body');
  assert.ok(block.includes('class="export-dialog is-hidden"'), 'the popup starts hidden, as every dialog does');
});
