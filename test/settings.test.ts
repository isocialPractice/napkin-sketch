/** Application-settings validation and serialization tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOOL_ORDER,
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

test('Select has a sensitivity of its own, in screen pixels, and Direct Select reaches 8 by default', () => {
  const s = defaultSettings();
  assert.equal(s.selectSensitivityPx, 4);
  assert.equal(s.directSelectSensitivityPx, 8);
  assert.equal(s.eyedropSensitivityPx, 10, 'the eyedropper keeps its setting, under its own name');
  assert.deepEqual(SETTINGS_LIMITS.selectSensitivityPx, { min: 1, max: 20, step: 1 });
  assert.equal(normalizeSettings({ selectSensitivityPx: 50 }).selectSensitivityPx, 20);
  assert.equal(normalizeSettings({ selectSensitivityPx: 0 }).selectSensitivityPx, 1);
  assert.equal(normalizeSettings({ selectSensitivityPx: 7.4 }).selectSensitivityPx, 7);
});

test('a Direct Select 3 saved before Select had a sensitivity is the old default, and reads as 8', () => {
  assert.equal(normalizeSettings({ directSelectSensitivityPx: 3 }).directSelectSensitivityPx, 8);
  assert.equal(normalizeSettings({ directSelectSensitivityPx: 5 }).directSelectSensitivityPx, 5, 'a choice is kept');
  // Saved since, alongside the Select setting: a 3 there was picked.
  const since = normalizeSettings({ directSelectSensitivityPx: 3, selectSensitivityPx: 4 });
  assert.equal(since.directSelectSensitivityPx, 3);
  // Once read, it stays what it was read as: a round trip through the file keeps it.
  const roundTrip = parseSettings(serializeSettings(normalizeSettings({ directSelectSensitivityPx: 3 })));
  assert.equal(roundTrip.directSelectSensitivityPx, 8);
  const kept = parseSettings(serializeSettings({ ...defaultSettings(), directSelectSensitivityPx: 3 }));
  assert.equal(kept.directSelectSensitivityPx, 3);
});

test('Freehand fidelity is 1.5 screen pixels unless a saved setting says otherwise, from 0.5 to 8', () => {
  assert.equal(defaultSettings().freehandFidelityPx, 1.5);
  assert.deepEqual(SETTINGS_LIMITS.freehandFidelityPx, { min: 0.5, max: 8, step: 0.5 });
  assert.equal(normalizeSettings({ freehandFidelityPx: 3 }).freehandFidelityPx, 3);
  assert.equal(normalizeSettings({ freehandFidelityPx: 20 }).freehandFidelityPx, 8);
  assert.equal(normalizeSettings({ freehandFidelityPx: 0 }).freehandFidelityPx, 0.5);
  assert.equal(normalizeSettings({ freehandFidelityPx: 'fine' }).freehandFidelityPx, 1.5);
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
  assert.ok(s.toolOrder.indexOf('tool-text') < s.toolOrder.indexOf('tool-pen'), 'the saved order is kept');
  assert.equal(new Set(s.toolOrder).size, s.toolOrder.length);
  assert.ok(s.toolOrder.includes('tool-eraser'));
  assert.equal(s.toolOrder.length, DEFAULT_TOOL_ORDER.length);
});

test('a tool added since an order was saved goes in after the tool it follows by default', () => {
  // An order saved before the Shape Eraser and Vector Path were in it, rearranged a little.
  const saved = DEFAULT_TOOL_ORDER.filter((id) => id !== 'tool-shape-eraser' && id !== 'tool-vector');
  [saved[0], saved[1]] = [saved[1], saved[0]];
  const s = normalizeSettings({ toolOrder: saved });
  assert.equal(s.toolOrder[s.toolOrder.indexOf('tool-eraser') + 1], 'tool-shape-eraser');
  assert.equal(s.toolOrder[s.toolOrder.indexOf('tool-curve') + 1], 'tool-vector');
  assert.deepEqual(s.toolOrder.slice(0, 2), [saved[0], saved[1]], 'and the rearranging stays');
});

test('the default tool order holds every tool button, the Shape Eraser and Vector Path among them', () => {
  assert.ok(DEFAULT_TOOL_ORDER.includes('tool-shape-eraser'));
  assert.ok(DEFAULT_TOOL_ORDER.includes('tool-vector'));
  assert.equal(DEFAULT_TOOL_ORDER[DEFAULT_TOOL_ORDER.indexOf('tool-eraser') + 1], 'tool-shape-eraser');
  assert.equal(DEFAULT_TOOL_ORDER[DEFAULT_TOOL_ORDER.indexOf('tool-shape-eraser') + 1], 'tool-shape-stacker');
});

test('an order saved before the Shape Stacker gains it right after the Shape Eraser, wherever that was put', () => {
  const saved = DEFAULT_TOOL_ORDER.filter((id) => id !== 'tool-shape-stacker');
  // The Shape Eraser moved to the front.
  saved.splice(saved.indexOf('tool-shape-eraser'), 1);
  saved.unshift('tool-shape-eraser');
  const s = normalizeSettings({ toolOrder: saved });
  assert.deepEqual(s.toolOrder.slice(0, 2), ['tool-shape-eraser', 'tool-shape-stacker']);
  assert.equal(s.toolOrder.length, DEFAULT_TOOL_ORDER.length);
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

test('copic quick-rotate defaults are on with ctrl/alt/shift keys', () => {
  const s = defaultSettings();
  assert.equal(s.copicQuickRotate, true);
  assert.equal(s.copicHoldSec, 1);
  assert.equal(s.copicHoldKey, 'ctrl');
  assert.equal(s.copicRotateCwKey, 'alt');
  assert.equal(s.copicRotateCcwKey, 'shift');
  assert.equal(s.copicRotateSpeedDeg, 90);
  assert.equal(s.copicWidthMultiplier, 2);
});

test('copic numeric settings clamp to their limits', () => {
  const s = normalizeSettings({ copicHoldSec: 99, copicRotateSpeedDeg: 1, copicWidthMultiplier: 50 });
  assert.equal(s.copicHoldSec, SETTINGS_LIMITS.copicHoldSec.max);
  assert.equal(s.copicRotateSpeedDeg, SETTINGS_LIMITS.copicRotateSpeedDeg.min);
  assert.equal(s.copicWidthMultiplier, SETTINGS_LIMITS.copicWidthMultiplier.max);
  assert.equal(
    normalizeSettings({ copicWidthMultiplier: 0.1 }).copicWidthMultiplier,
    SETTINGS_LIMITS.copicWidthMultiplier.min,
  );
});

test('copic keys reject junk and never collide', () => {
  const junk = normalizeSettings({ copicHoldKey: 'hyperkey' });
  assert.equal(junk.copicHoldKey, 'ctrl');

  // A duplicate pick is reassigned: hold key wins, later keys move on.
  const clash = normalizeSettings({
    copicHoldKey: 'alt',
    copicRotateCwKey: 'alt',
    copicRotateCcwKey: 'alt',
  });
  assert.equal(clash.copicHoldKey, 'alt');
  const keys = [clash.copicHoldKey, clash.copicRotateCwKey, clash.copicRotateCcwKey];
  assert.equal(new Set(keys).size, 3);
});

test('toolOrder includes the copic tool', () => {
  assert.ok(defaultSettings().toolOrder.includes('tool-copic'));
  // Stale saved orders (pre-copic) are back-filled too.
  const s = normalizeSettings({ toolOrder: ['tool-pen', 'tool-marker'] });
  assert.ok(s.toolOrder.includes('tool-copic'));
});

test('the selection border is on unless a saved setting turns it off', () => {
  // On by default: the outline is how a selection has always shown itself,
  // and an upgrade must not silently take that away.
  assert.equal(defaultSettings().showSelectionBorders, true);
  assert.equal(normalizeSettings({ showSelectionBorders: false }).showSelectionBorders, false);
  // Anything that is not a boolean is not an answer, so the default stands.
  assert.equal(normalizeSettings({ showSelectionBorders: 'no' }).showSelectionBorders, true);
  assert.equal(normalizeSettings({}).showSelectionBorders, true);
});

test('Mesh Warp shows its mesh unless a saved setting hides it', () => {
  assert.equal(defaultSettings().warpShowMesh, true);
  assert.equal(normalizeSettings({ warpShowMesh: false }).warpShowMesh, false);
  // Only a boolean is an answer; anything else leaves the default standing,
  // and a save cannot strip it away.
  assert.equal(normalizeSettings({ warpShowMesh: 'off' }).warpShowMesh, true);
  assert.equal(normalizeSettings({}).warpShowMesh, true);
});

test('Track History is off, and keeps 500 steps, unless a saved setting says otherwise', () => {
  const s = defaultSettings();
  assert.equal(s.trackHistory, false);
  assert.equal(s.historyLimit, 500);
  assert.deepEqual(SETTINGS_LIMITS.historyLimit, { min: 50, max: 5000, step: 50 });
  assert.equal(normalizeSettings({ trackHistory: true }).trackHistory, true);
  // Only a boolean is an answer.
  assert.equal(normalizeSettings({ trackHistory: 'yes' }).trackHistory, false);
});

test('the History Limit is held to 50 to 5000, in steps of 50', () => {
  const limit = (value: unknown): number => normalizeSettings({ historyLimit: value }).historyLimit;
  assert.equal(limit(49), 50);
  assert.equal(limit(-10), 50);
  assert.equal(limit(5001), 5000);
  assert.equal(limit(1e9), 5000);
  assert.equal(limit(123), 100, 'the nearest step down');
  assert.equal(limit(175), 200, 'the nearest step up');
  assert.equal(limit(1250), 1250);
  assert.equal(limit('800'), 800, 'a number written as text is still the number');
  assert.equal(limit('many'), 500, 'anything else leaves the default');
  assert.equal(limit(Number.NaN), 500);
  const kept = parseSettings(serializeSettings({ ...defaultSettings(), trackHistory: true, historyLimit: 2500 }));
  assert.deepEqual([kept.trackHistory, kept.historyLimit], [true, 2500], 'both survive a save and a load');
});
