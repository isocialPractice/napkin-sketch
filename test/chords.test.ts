/**
 * Keyboard chords: how a shortcut is read, written, shown, handed to Electron,
 * and matched against a keypress.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalChord,
  chordFromEvent,
  displayChord,
  eventChords,
  formatChord,
  isBareChord,
  matchesEvent,
  parseChord,
  reservedReason,
  toAccelerator,
  type KeyEventLike,
} from '../src/core/menu/chords.js';

/** A keypress: the key, and whatever modifiers and physical key are given. */
function press(key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

test('a chord is read in any case, spacing and modifier order, and written one way', () => {
  const cases: [string, string][] = [
    ['ctrl+shift+z', 'Ctrl+Shift+Z'],
    ['Shift + Ctrl + Z', 'Ctrl+Shift+Z'],
    ['alt+ctrl+,', 'Ctrl+Alt+,'],
    ['Cmd+O', 'Ctrl+O'],
    ['CmdOrCtrl+Shift+S', 'Ctrl+Shift+S'],
    ['Control+Alt+Shift+x', 'Ctrl+Alt+Shift+X'],
    ['Option+F4', 'Alt+F4'],
    ['f11', 'F11'],
    ['del', 'Delete'],
    ['Return', 'Enter'],
    ['esc', 'Escape'],
    ['ArrowUp', 'Up'],
    ['pgdn', 'PageDown'],
    ['c', 'C'],
    ['7', '7'],
    ['Ctrl+]', 'Ctrl+]'],
    ['Ctrl+-', 'Ctrl+-'],
  ];
  for (const [text, canonical] of cases) assert.equal(canonicalChord(text), canonical, text);
});

test('the plus key is Plus, and Ctrl++ reads as Ctrl with it', () => {
  assert.equal(canonicalChord('Ctrl++'), 'Ctrl+Plus');
  assert.equal(canonicalChord('Ctrl+Plus'), 'Ctrl+Plus');
  assert.equal(canonicalChord('+'), 'Plus');
  assert.equal(canonicalChord('Ctrl+Shift++'), 'Ctrl+Shift+Plus');
  assert.equal(displayChord('Ctrl+Plus'), 'Ctrl++');
  assert.equal(canonicalChord(displayChord('Ctrl+Plus')), 'Ctrl+Plus', 'what is shown reads back as what it shows');
});

test('text that is not one chord is refused', () => {
  const texts = ['', ' ', 'Ctrl', 'Ctrl+', 'Ctrl+Shift', 'Ctrl+Ctrl+Z', 'Z+Ctrl', 'Ctrl+AB', 'Hyper+Z', 'Meta+Z', 'Ctrl+F25', 'Ctrl+é', 'Ctrl++Z', '++'];
  for (const text of texts) assert.equal(parseChord(text), null, JSON.stringify(text));
  assert.equal(canonicalChord('Ctrl+Q+W'), null);
});

test('formatChord writes the modifiers in one order', () => {
  assert.equal(formatChord({ ctrl: true, alt: true, shift: true, key: 'Z' }), 'Ctrl+Alt+Shift+Z');
  assert.equal(formatChord({ ctrl: false, alt: false, shift: true, key: 'C' }), 'Shift+C');
  assert.equal(formatChord({ ctrl: false, alt: false, shift: false, key: 'Plus' }), 'Plus');
});

test("a chord is shown with the platform's names for the modifiers", () => {
  assert.equal(displayChord('Ctrl+Alt+,'), 'Ctrl+Alt+,');
  assert.equal(displayChord('Ctrl+Alt+,', { mac: true }), 'Cmd+Option+,');
  assert.equal(displayChord('Shift+C', { mac: true }), 'Shift+C');
  assert.equal(displayChord('not a chord'), 'not a chord', 'text that is no chord comes back as it was');
});

test('an Electron accelerator names the command key CmdOrCtrl', () => {
  assert.equal(toAccelerator('Ctrl+Alt+,'), 'CmdOrCtrl+Alt+,');
  assert.equal(toAccelerator('Ctrl+Shift+Z'), 'CmdOrCtrl+Shift+Z');
  assert.equal(toAccelerator('Ctrl+Plus'), 'CmdOrCtrl+Plus');
  assert.equal(toAccelerator('Delete'), 'Delete');
  assert.equal(toAccelerator('O'), 'O');
  assert.equal(toAccelerator('Shift+C'), 'Shift+C');
  assert.equal(toAccelerator('nope'), null);
});

test('a chord with neither Ctrl nor Alt is bare, so the page keeps it', () => {
  for (const chord of ['P', 'Shift+C', 'Enter', 'Delete', 'F2']) assert.equal(isBareChord(chord), true, chord);
  for (const chord of ['Ctrl+P', 'Alt+P', 'Ctrl+Shift+Z', 'Ctrl+Alt+,']) assert.equal(isBareChord(chord), false, chord);
  assert.equal(isBareChord('nope'), false);
});

test('Space, Escape, Tab and Alt+F4 are kept by the app, and the rest are free', () => {
  for (const chord of ['Space', 'Ctrl+Space', 'Ctrl+Alt+Space', 'Escape', 'Shift+Escape', 'Tab', 'Shift+Tab', 'Alt+F4']) {
    assert.ok(reservedReason(chord), chord);
  }
  for (const chord of ['F4', 'Ctrl+F4', 'Enter', 'Delete', 'Ctrl+R', 'F5', 'Ctrl+M']) {
    assert.equal(reservedReason(chord), null, chord);
  }
});

test('a letter keeps Shift as held, whatever Caps Lock did to its case', () => {
  assert.deepEqual(eventChords(press('c')), ['C']);
  assert.deepEqual(eventChords(press('C', { shiftKey: true })), ['Shift+C']);
  assert.deepEqual(eventChords(press('c', { shiftKey: true })), ['Shift+C'], 'Caps Lock on, Shift held');
  assert.deepEqual(eventChords(press('C')), ['C'], 'Caps Lock on, Shift not held');
  assert.ok(matchesEvent('Shift+C', press('c', { shiftKey: true, code: 'KeyC' })));
  assert.ok(!matchesEvent('C', press('C', { shiftKey: true })), 'Shift+C is not C');
});

test('Ctrl stands for either command key', () => {
  assert.deepEqual(eventChords(press('z', { ctrlKey: true })), ['Ctrl+Z']);
  assert.deepEqual(eventChords(press('z', { metaKey: true })), ['Ctrl+Z']);
  assert.ok(matchesEvent('Ctrl+Shift+Z', press('Z', { ctrlKey: true, shiftKey: true })));
  assert.ok(matchesEvent('ctrl+shift+z', press('Z', { ctrlKey: true, shiftKey: true })), 'the chord is read loosely too');
});

test('a mark is matched by the character it made and by the key that made it', () => {
  assert.ok(matchesEvent('Ctrl+]', press(']', { ctrlKey: true, code: 'BracketRight' })));
  // Shift turns ] into } on a US layout. Both ways of writing it match; plain Ctrl+] does not.
  const shifted = press('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' });
  assert.ok(matchesEvent('Ctrl+Shift+]', shifted));
  assert.ok(matchesEvent('Ctrl+}', shifted));
  assert.ok(!matchesEvent('Ctrl+]', shifted));
  // The plus key: Shift and = make +, and so does the keypad's key.
  assert.ok(matchesEvent('Ctrl+Plus', press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' })));
  assert.ok(matchesEvent('Ctrl+Plus', press('+', { ctrlKey: true, code: 'NumpadAdd' })));
  // A layout where that key makes another mark still matches by where the key is.
  assert.ok(matchesEvent('Ctrl+]', press('+', { ctrlKey: true, code: 'BracketRight' })));
  assert.ok(matchesEvent('Ctrl+Alt+,', press(',', { ctrlKey: true, altKey: true, code: 'Comma' })));
});

test('named keys and function keys match by name', () => {
  assert.deepEqual(eventChords(press(' ', { code: 'Space' })), ['Space']);
  assert.ok(matchesEvent('Delete', press('Delete')));
  assert.ok(matchesEvent('Backspace', press('Backspace')));
  assert.ok(matchesEvent('F2', press('F2')));
  assert.ok(matchesEvent('Enter', press('Enter')));
  assert.ok(matchesEvent('Up', press('ArrowUp')));
  assert.ok(!matchesEvent('Delete', press('Backspace')));
});

test('a lone modifier, a dead key and a letter outside A to Z make no chord', () => {
  for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock']) {
    assert.deepEqual(eventChords(press(key, { ctrlKey: key === 'Control', shiftKey: key === 'Shift' })), [], key);
    assert.equal(chordFromEvent(press(key)), null, key);
  }
  assert.deepEqual(eventChords(press('Dead')), []);
  assert.deepEqual(eventChords(press('Process')), []);
  assert.deepEqual(eventChords(press('é')), []);
  assert.equal(chordFromEvent(press('é')), null);
});

test('on a Mac, Option changes the letter, and the key still names it', () => {
  assert.ok(matchesEvent('Alt+A', press('å', { altKey: true, code: 'KeyA' })));
  assert.equal(chordFromEvent(press('å', { altKey: true, code: 'KeyA' })), 'Alt+A');
});

test("a letter follows the layout rather than the key's position", () => {
  // AZERTY: the key where QWERTY has Q types A, and A is what the shortcut means.
  assert.deepEqual(eventChords(press('a', { code: 'KeyQ' })), ['A']);
  assert.equal(chordFromEvent(press('a', { code: 'KeyQ' })), 'A');
});

test('a typed shortcut is written the way it reads on any layout, and matches the press that typed it', () => {
  const cases: [KeyEventLike, string][] = [
    [press('m', { ctrlKey: true, code: 'KeyM' }), 'Ctrl+M'],
    [press('C', { shiftKey: true, code: 'KeyC' }), 'Shift+C'],
    [press('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }), 'Ctrl+Shift+]'],
    [press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }), 'Ctrl+Shift+='],
    [press('+', { ctrlKey: true }), 'Ctrl+Plus'],
    [press('!', { shiftKey: true, code: 'Digit1' }), 'Shift+1'],
    [press('F2', { code: 'F2' }), 'F2'],
    [press('Enter', { code: 'Enter' }), 'Enter'],
    [press('Delete', { ctrlKey: true, code: 'Delete' }), 'Ctrl+Delete'],
  ];
  for (const [event, chord] of cases) {
    assert.equal(chordFromEvent(event), chord, JSON.stringify(event));
    assert.ok(matchesEvent(chord, event), `${chord} matches the press that typed it`);
  }
});
