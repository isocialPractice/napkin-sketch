/**
 * Keys to commands: every shortcut the app ships reaches its command, a
 * changed shortcut moves the key, and the keys the old key handler was
 * lenient about still behave as they did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseChord, type KeyEventLike } from '../src/core/menu/chords.js';
import { defaultRegistry, loadRegistry } from '../src/core/menu/registry.js';
import { commandForEvent, isNewTabKey, isReloadKey } from '../src/renderer/keys.js';

const registry = defaultRegistry();

/** A keypress, with the modifiers given. */
function press(key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

const PUNCTUATION_CODES: Record<string, string> = { ']': 'BracketRight', '[': 'BracketLeft', ',': 'Comma', '-': 'Minus' };

/** The keypress a US keyboard sends for a chord. */
function pressFor(chord: string): KeyEventLike {
  const parsed = parseChord(chord);
  assert.ok(parsed, chord);
  const mods = { ctrlKey: parsed.ctrl, altKey: parsed.alt, shiftKey: parsed.shift };
  const { key } = parsed;
  if (/^[A-Z]$/.test(key)) return press(parsed.shift ? key : key.toLowerCase(), { code: `Key${key}`, ...mods });
  if (/^[0-9]$/.test(key)) return press(key, { code: `Digit${key}`, ...mods });
  // The plus key is Shift and = on a US keyboard.
  if (key === 'Plus') return press('+', { code: 'Equal', ...mods, shiftKey: true });
  if (PUNCTUATION_CODES[key]) return press(key, { code: PUNCTUATION_CODES[key], ...mods });
  return press(key, { code: key, ...mods });
}

test("every shortcut the app ships reaches its command, and a role row's key is left to Electron", () => {
  let checked = 0;
  for (const tool of registry.tools) {
    for (const chord of [tool.chord, ...tool.aliases]) {
      if (chord === null) continue;
      const expected = tool.role === null ? tool.id : null;
      assert.equal(commandForEvent(registry, pressFor(chord)), expected, `${chord} for ${tool.id}`);
      checked++;
    }
  }
  assert.ok(checked > 50, `checked ${checked} chords`);
});

test('Shift with a letter or a named key no shortcut uses means the key alone, as it always has', () => {
  assert.equal(commandForEvent(registry, press('B', { code: 'KeyB', shiftKey: true })), 'tool-pen');
  assert.equal(commandForEvent(registry, press('C', { code: 'KeyC', ctrlKey: true, shiftKey: true })), 'copy');
  assert.equal(commandForEvent(registry, press('Enter', { shiftKey: true })), 'move-selection');
  assert.equal(commandForEvent(registry, press('F2', { shiftKey: true })), 'rename-layer');
  assert.equal(commandForEvent(registry, press('Y', { code: 'KeyY', ctrlKey: true, shiftKey: true })), 'redo', 'an alias counts');
});

test("an event whose fields are getters, as a KeyboardEvent's are, falls back the same", () => {
  // A spread of a real KeyboardEvent copies none of these; the lookup must not rely on one.
  class GetterEvent {
    get key(): string {
      return 'B';
    }
    get code(): string {
      return 'KeyB';
    }
    get ctrlKey(): boolean {
      return false;
    }
    get metaKey(): boolean {
      return false;
    }
    get altKey(): boolean {
      return false;
    }
    get shiftKey(): boolean {
      return true;
    }
  }
  assert.equal(commandForEvent(registry, new GetterEvent()), 'tool-pen');
});

test('a shortcut of its own wins over the key without Shift', () => {
  assert.equal(commandForEvent(registry, press('c', { code: 'KeyC' })), 'cycle-color');
  assert.equal(commandForEvent(registry, press('C', { code: 'KeyC', shiftKey: true })), 'cycle-color-back');
  assert.equal(commandForEvent(registry, press('z', { code: 'KeyZ', ctrlKey: true })), 'undo');
  assert.equal(commandForEvent(registry, press('Z', { code: 'KeyZ', ctrlKey: true, shiftKey: true })), 'redo');
  assert.equal(commandForEvent(registry, press('A', { code: 'KeyA', ctrlKey: true, shiftKey: true })), 'deselect-all');
});

test('a key a role row holds is never tried without Shift', () => {
  // Ctrl+Shift+I is Electron's developer tools, not Ctrl+I's Import.
  assert.equal(commandForEvent(registry, press('I', { code: 'KeyI', ctrlKey: true, shiftKey: true })), null);
});

test('a mark carries its Shift already, so it is never tried without it', () => {
  // Shift turns ] into }: that is not Ctrl+], which restacks a layer.
  assert.equal(commandForEvent(registry, press('}', { code: 'BracketRight', ctrlKey: true, shiftKey: true })), null);
  assert.equal(commandForEvent(registry, press('!', { code: 'Digit1', shiftKey: true })), null);
});

test('Alt is not dropped: Alt and a letter is not the letter', () => {
  assert.equal(commandForEvent(registry, press('p', { code: 'KeyP', altKey: true })), null);
});

test('B takes the Brush and P Vector Path, the keys of the tools Illustrator calls the Paintbrush and the Pen', () => {
  assert.equal(commandForEvent(registry, press('b', { code: 'KeyB' })), 'tool-pen');
  assert.equal(commandForEvent(registry, press('p', { code: 'KeyP' })), 'tool-vector');
});

test('J takes Split, the pair of Join on Ctrl+J', () => {
  assert.equal(commandForEvent(registry, press('j', { code: 'KeyJ' })), 'tool-split');
  assert.equal(commandForEvent(registry, press('j', { code: 'KeyJ', ctrlKey: true })), 'join-strokes');
});

test('a key nothing holds runs nothing', () => {
  assert.equal(commandForEvent(registry, press('y', { code: 'KeyY' })), null);
  assert.equal(commandForEvent(registry, press('Control', { ctrlKey: true })), null);
  assert.equal(commandForEvent(registry, press(' ', { code: 'Space' })), null);
});

test('a changed shortcut moves the key, and the key it had goes dead', () => {
  const moved = loadRegistry({ shortcuts: { version: 1, shortcuts: { mirror: 'Ctrl+M' } } });
  assert.equal(commandForEvent(moved, press('m', { code: 'KeyM', ctrlKey: true })), 'mirror');
  assert.equal(commandForEvent(moved, press('o', { code: 'KeyO' })), null);
  assert.equal(commandForEvent(registry, press('o', { code: 'KeyO' })), 'mirror', 'the shipped registry is untouched');

  const unbound = loadRegistry({ shortcuts: { version: 1, shortcuts: { 'tool-pen': null } } });
  assert.equal(commandForEvent(unbound, press('b', { code: 'KeyB' })), null);
  assert.equal(commandForEvent(unbound, press('B', { code: 'KeyB', shiftKey: true })), null, 'nor Shift+B, which fell back to it');
});

test('the keys Chromium acts on are known, with or without Shift', () => {
  for (const event of [
    press('F5'),
    press('r', { code: 'KeyR', ctrlKey: true }),
    press('R', { code: 'KeyR', ctrlKey: true, shiftKey: true }),
    press('r', { code: 'KeyR', metaKey: true }),
  ]) {
    assert.ok(isReloadKey(event), JSON.stringify(event));
  }
  assert.ok(!isReloadKey(press('r', { code: 'KeyR' })));
  assert.ok(!isReloadKey(press('e', { code: 'KeyE', ctrlKey: true })));
  assert.ok(isNewTabKey(press('t', { code: 'KeyT', ctrlKey: true })));
  assert.ok(isNewTabKey(press('T', { code: 'KeyT', ctrlKey: true, shiftKey: true })));
  assert.ok(!isNewTabKey(press('t', { code: 'KeyT' })));
});

test('PageUp and PageDown turn back and on a page, as the page bar arrows do', () => {
  assert.equal(commandForEvent(registry, press('PageUp', { code: 'PageUp' })), 'prev-page');
  assert.equal(commandForEvent(registry, press('PageDown', { code: 'PageDown' })), 'next-page');
  // No row holds Shift with them, so with Shift held they still turn the page.
  assert.equal(commandForEvent(registry, press('PageUp', { code: 'PageUp', shiftKey: true })), 'prev-page');
});
