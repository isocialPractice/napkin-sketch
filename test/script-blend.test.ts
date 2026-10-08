/**
 * The `blend` verb: how it reads, what takes it, what it warns, and how the
 * writer says a page's blends.
 *
 * A blend waits for the next layer or group the script makes - a blend is a
 * layer's, so a mark alone does not take it - by a Napkin Blend's name or
 * Illustrator's. A second one before anything took the first replaces it, and
 * the first is reported; one nothing takes is reported where it was written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, formatScript, parseScript, sketchToInstructions, validateScript, type ScriptResult } from '../src/core/script/index.js';
import { createSketchBook, type Layer } from '../src/core/types.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const TIME = '2026-10-01T00:00:00.000Z';

function run(text: string): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
}

const layers = (result: ScriptResult): Layer[] => result.book.sketches[0].layers;
const named = (result: ScriptResult, name: string): Layer | undefined => layers(result).find((layer) => layer.name === name);
const warnings = (result: ScriptResult): string[] => result.diagnostics.map((d) => formatDiagnostic(d));

test('a blend reads by either name, writes back as written, and checks as JSON', () => {
  const text = ['blend stack', 'blend multiply', 'blend color-burn', 'blend normal'].join('\n');
  const parsed = parseScript(text, { fragment: true });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(formatScript(parsed.script), `${text}\n`);
  const json = JSON.parse(JSON.stringify(parsed.script.map(({ at: _at, ...rest }) => rest)));
  assert.deepEqual(validateScript(json, { fragment: true }).diagnostics, []);
  assert.deepEqual(json[1], { verb: 'blend', mode: 'multiply' });
  assert.ok(parseScript('blend plaid', { fragment: true }).diagnostics.length > 0, 'a name of no mode is refused');
});

test('the next layer or group takes it, in napkin\'s name', () => {
  const result = run(['blend multiply', 'layer "Shade"', 'circle 50 50 20', 'blend sheer', 'group "Glow" {', '  circle 80 80 10', '}'].join('\n'));
  assert.deepEqual(warnings(result), []);
  assert.equal(named(result, 'Shade')?.blend, 'stack', 'multiply is Stack Blend');
  assert.equal(layers(result).find((l) => l.group && l.name === 'Glow')?.blend, 'sheer');
});

test('a mark alone does not take a blend, and one nothing takes is reported', () => {
  const result = run(['blend stack', 'circle 50 50 20'].join('\n'));
  assert.equal(layers(result).some((l) => l.blend), false);
  const said = warnings(result);
  assert.equal(said.length, 1);
  assert.match(said[0], /unused-blend/);
  assert.match(said[0], /A blend is a layer's/);
});

test('a second blend before anything took the first replaces it, and the first is reported', () => {
  const result = run(['blend stack', 'blend sheer', 'layer "Lit"'].join('\n'));
  assert.equal(named(result, 'Lit')?.blend, 'sheer');
  const said = warnings(result);
  assert.equal(said.length, 1);
  assert.match(said[0], /`blend stack` did nothing: no layer or group followed it before the next `blend`/);
});

test('a blend waits inside its own block, and is reported where the block ends', () => {
  const result = run(['group "Outer" {', '  blend stack', '  circle 10 10 5', '}', 'layer "After"'].join('\n'));
  assert.equal(named(result, 'After')?.blend, undefined, 'it does not leak out of the block');
  assert.match(warnings(result)[0] ?? '', /before its block ended/);
});

test('a placed definition that takes a blend is drawn as a group carrying it', () => {
  const result = run(['define "dot" {', '  circle 0 0 5', '}', 'blend messy', 'place "dot" at 50 50'].join('\n'));
  assert.deepEqual(warnings(result), []);
  assert.equal(layers(result).find((l) => l.group && l.name === 'dot')?.blend, 'messy');
});

test('the writer says a layer\'s blend before its layer line, and what it cannot say', () => {
  const sketch = createSketchBook('written').sketches[0];
  sketch.layers = [
    { id: 'la', name: 'Shade', opacity: 1, visible: true, locked: false, blend: 'stack', parent: 'g' },
    { id: 'g', name: 'Pair', opacity: 1, visible: true, locked: false, group: true, blend: 'dye', isolate: true },
  ];
  sketch.strokes = [{ id: 'a', tool: 'pen', color: '#27486d', width: 2, layer: 'la', points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 40, y: 40, pressure: 0.5 }] }];
  const written = sketchToInstructions(sketch, { decimals: null });
  const text = formatScript(written.script);
  assert.match(text, /blend dye\ngroup "Pair" \{\n\s+blend stack\n\s+layer "Shade"/);
  assert.equal(written.notes.length, 1);
  assert.match(written.notes[0], /Isolate Blending are|Isolate Blending is/);
  // And it draws back with the same blends.
  const back = run(text);
  assert.equal(named(back, 'Shade')?.blend, 'stack');
  assert.equal(layers(back).find((l) => l.group && l.name === 'Pair')?.blend, 'dye');
});
