/** Application-settings validation and serialization tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings,
  normalizeSettings,
  normalizeHexColor,
  parseSettings,
  serializeSettings,
  SETTINGS_LIMITS,
} from '../src/core/settings.js';

test('defaultSettings is internally consistent', () => {
  const s = defaultSettings();
  assert.equal(s.quickColors.length, s.quickColorCount);
  assert.equal(s.menuPlacement, 'top');
  assert.equal(s.theme, 'light');
});

test('normalizeSettings clamps out-of-range numbers', () => {
  const s = normalizeSettings({ zoomSensitivity: 999, panSensitivity: -5, quickTimerMs: 10 });
  assert.equal(s.zoomSensitivity, SETTINGS_LIMITS.zoomSensitivity.max);
  assert.equal(s.panSensitivity, SETTINGS_LIMITS.panSensitivity.min);
  assert.equal(s.quickTimerMs, SETTINGS_LIMITS.quickTimerMs.min);
});

test('normalizeSettings rejects invalid enums and falls back', () => {
  const s = normalizeSettings({ menuPlacement: 'diagonal', theme: 'neon' });
  assert.equal(s.menuPlacement, 'top');
  assert.equal(s.theme, 'light');
});

test('normalizeSettings keeps quickColors length in sync with the count', () => {
  const grown = normalizeSettings({ quickColorCount: 10, quickColors: ['#111111', '#222222'] });
  assert.equal(grown.quickColors.length, 10);
  assert.equal(grown.quickColorCount, 10);

  const shrunk = normalizeSettings({
    quickColorCount: 2,
    quickColors: ['#111111', '#222222', '#333333', '#444444'],
  });
  assert.equal(shrunk.quickColors.length, 2);
});

test('normalizeSettings tolerates non-object input', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings('nope'), defaultSettings());
});

test('toolOrder is de-duplicated and back-filled', () => {
  const s = normalizeSettings({ toolOrder: ['tool-text', 'tool-text', 'bogus', 'tool-pen'] });
  assert.deepEqual(s.toolOrder.slice(0, 2), ['tool-text', 'tool-pen']);
  assert.equal(new Set(s.toolOrder).size, s.toolOrder.length);
  assert.ok(s.toolOrder.includes('tool-eraser'));
});

test('normalizeHexColor accepts shorthand and rejects junk', () => {
  assert.equal(normalizeHexColor('#ABC'), '#aabbcc');
  assert.equal(normalizeHexColor('#1d2328'), '#1d2328');
  assert.equal(normalizeHexColor('red'), null);
  assert.equal(normalizeHexColor(42), null);
});

test('settings round-trip through JSON', () => {
  const s = normalizeSettings({ zoomSensitivity: 2, theme: 'dark', menuPlacement: 'side' });
  const restored = parseSettings(serializeSettings(s));
  assert.deepEqual(restored, s);
});

test('parseSettings falls back to defaults on bad JSON', () => {
  assert.deepEqual(parseSettings('{not json'), defaultSettings());
});
