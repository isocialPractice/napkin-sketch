/**
 * Writing a script back as text, and checking a script built as JSON.
 *
 * The two front ends and the formatter have to agree: a script read from text,
 * written out and read again is the same script, and the same script built as
 * JSON validates to exactly what the text parser produced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERBS,
  formatDiagnostic,
  formatScript,
  parseScript,
  validateScript,
  type Diagnostic,
  type Instruction,
} from '../src/core/script/index.js';

const strip = <T>(value: T): T => JSON.parse(JSON.stringify(value, (key, v) => (key === 'at' ? undefined : v)));
const codes = (diagnostics: Diagnostic[]): string[] => diagnostics.map((d) => d.code);
const show = (diagnostics: Diagnostic[]): string => diagnostics.map((d) => formatDiagnostic(d)).join('; ');

/** Every example, and a script that exercises every form of every verb that has more than one. */
const CORPUS: string[] = [
  ...VERBS.map((v) => v.example),
  `napkin 1
page slide
page a4 landscape
page 210mm 297mm portrait
background none
background rgb(252, 250, 245)
name "Acme \\"Corp\\" card"
units mm
seed 7
newpage
newpage "Back"
layer "Ink" opacity 0.8 hidden locked
tool copic
nib (i * 15)
fill none
gradient none
gradient radial (#ffffff 0, #000000 1)
gradient linear 45 (red 0, rgba(0, 0, 255, 0.5) 0.5, white 1)
stroke on
style dotted
profile wave
rough off
rough 0.25 overshoot 3px
font "Georgia"
font 12pt
star 0 0 10 4 (n + 1)
arc 10 10 5 -90 90
path "M0 0 C10 0 10 10 0 10 Z"
through 0 0, (w / 2) 10, 100% 0
scale 2
scale 1 -1 at 0 50%
rotate -15
mirror x
text "Two\\nlines" at 0 0 size 12pt box 40% align left
text "Marks" at 0 0 as marks
image "data:image/png;base64,AAAA" at 0 0 size 10 20
link "logo.svg" at 0 0
use "badge"
use "badge" at 1 2 scale 0.5 layer "Badges"
crop none
crop 0 0 10 10
registration 0 0 100% 100%
`,
];

test('a script read, written and read again is the same script', () => {
  for (const text of CORPUS) {
    const first = parseScript(text, { fragment: true });
    assert.deepEqual(first.diagnostics, [], show(first.diagnostics));
    const written = formatScript(first.script);
    const second = parseScript(written, { fragment: true });
    assert.deepEqual(second.diagnostics, [], `${written}\n${show(second.diagnostics)}`);
    assert.deepEqual(strip(second.script), strip(first.script), written);
    assert.equal(formatScript(second.script), written, 'writing is idempotent');
  }
});

test('the canonical form: one instruction to a line, lower-case keywords, two-space blocks', () => {
  const messy = `napkin 1
COLOR RED   Width 3 # the ink
rect 10mm 0 50% (h/2)  R 4
group "Figure" opacity 0.5 { layer "Head"; circle 1 2 3 }
`;
  const result = parseScript(messy);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    formatScript(result.script),
    `napkin 1
color red
width 3
rect 10mm 0 50% (h/2) r 4
group "Figure" opacity 0.5 {
  layer "Head"
  circle 1 2 3
}
`,
  );
  assert.equal(formatScript(result.script, { indent: '\t' }).split('\n')[5], '\tlayer "Head"');
  assert.equal(formatScript([]), '');
});

test('formatScript refuses an instruction no form can write, and names validateScript', () => {
  assert.throws(() => formatScript([{ verb: 'rect', x: 0 } as unknown as Instruction]), /validateScript/);
  assert.throws(() => formatScript([{ verb: 'nope' } as unknown as Instruction]), /is not a verb/);
});

test('JSON validates to exactly the script the text parser produces', () => {
  for (const text of CORPUS) {
    const parsed = parseScript(text, { fragment: true });
    const json = JSON.parse(JSON.stringify(strip(parsed.script)));
    const validated = validateScript(json, { fragment: true });
    assert.deepEqual(validated.diagnostics, [], show(validated.diagnostics));
    assert.deepEqual(validated.script, strip(parsed.script));
  }
});

test('JSON values come back in the form the text parser writes them', () => {
  const result = validateScript(
    [
      { verb: 'color', color: ' #FFF ' },
      { verb: 'rect', x: { expr: '  a + 1 ' }, y: -0, width: '10.50MM', height: '50%', radius: '4' },
      { verb: 'polygon', points: [{ x: '1.0IN', y: 0, z: 9 }, { x: 1, y: 1 }, { x: 2, y: 0 }] },
      { verb: 'gradient', type: 'linear', angle: 0, stops: [{ color: 'RED', offset: 0 }, { color: 'Blue', offset: 1 }] },
    ],
    { fragment: true },
  );
  assert.deepEqual(result.diagnostics, [], show(result.diagnostics));
  assert.deepEqual(result.script, [
    { verb: 'color', color: '#fff' },
    { verb: 'rect', x: { expr: 'a + 1' }, y: 0, width: '10.5mm', height: '50%', radius: 4 },
    { verb: 'polygon', points: [{ x: '1in', y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] },
    { verb: 'gradient', type: 'linear', angle: 0, stops: [{ color: 'red', offset: 0 }, { color: 'blue', offset: 1 }] },
  ]);
  assert.ok(Object.is((result.script[1] as { y: number }).y, 0));
});

test('an unknown field is a warning and is left out on its own', () => {
  const result = validateScript([{ verb: 'rect', x: 0, y: 0, width: 1, height: 1, colour: 'red' }], { fragment: true });
  assert.equal(result.ok, true);
  assert.deepEqual(codes(result.diagnostics), ['unknown-field']);
  assert.match(result.diagnostics[0].message, /has no field `colour`/);
  assert.deepEqual(result.script, [{ verb: 'rect', x: 0, y: 0, width: 1, height: 1 }]);
});

test('a value of the wrong kind is an error that names the field and its index path', () => {
  const result = validateScript([
    { verb: 'napkin', version: 1 },
    { verb: 'group', name: 'g', body: [{ verb: 'rect', x: 'ten', y: 0, width: 1, height: 1 }, { verb: 'circle', cx: 0, cy: 0, r: 1 }] },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.index]),
    [['expected-length', [1, 0]]],
  );
  assert.equal(formatDiagnostic(result.diagnostics[0], 'card.napkin.json').startsWith('card.napkin.json[1][0]: error expected-length'), true);
  assert.deepEqual(result.script, [
    { verb: 'napkin', version: 1 },
    { verb: 'group', name: 'g', body: [{ verb: 'circle', cx: 0, cy: 0, r: 1 }] },
  ]);
});

test('missing fields, and fields that fit no way of writing the verb', () => {
  assert.deepEqual(codes(validateScript([{ verb: 'circle', cx: 0, cy: 0 }], { fragment: true }).diagnostics), ['missing-argument']);
  assert.deepEqual(codes(validateScript([{ verb: 'crop', mode: 'auto', x: 5 }], { fragment: true }).diagnostics), ['invalid-value']);
  assert.deepEqual(codes(validateScript([{ verb: 'path' }], { fragment: true }).diagnostics), ['invalid-value']);
  assert.deepEqual(codes(validateScript([{ verb: 'crop', mode: 'sideways' }], { fragment: true }).diagnostics), ['invalid-value']);
  assert.deepEqual(codes(validateScript([{ verb: 'page', width: '50%', height: 300 }], { fragment: true }).diagnostics), ['invalid-value']);
  assert.deepEqual(codes(validateScript([{ verb: 'rect', x: { expr: '1 +' }, y: 0, width: 1, height: 1 }], { fragment: true }).diagnostics), [
    'invalid-expression',
  ]);
  assert.deepEqual(codes(validateScript([{ verb: 'group', name: 'g', body: 'rect' }], { fragment: true }).diagnostics), ['expected-block']);
});

test('false flags and null optional fields mean the field is absent', () => {
  const result = validateScript(
    [
      { verb: 'layer', name: 'x', hidden: false, locked: true },
      { verb: 'newpage', name: null },
      { verb: 'fill', fill: null },
    ],
    { fragment: true },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.script, [
    { verb: 'layer', name: 'x', locked: true },
    { verb: 'newpage' },
    { verb: 'fill', fill: null },
  ]);
});

test('a JSON script is checked for its shape, its verbs, their places and its version', () => {
  assert.deepEqual(codes(validateScript({ verb: 'rect' }).diagnostics), ['invalid-value']);
  assert.deepEqual(codes(validateScript([42], { fragment: true }).diagnostics), ['invalid-value']);
  assert.deepEqual(codes(validateScript([{ x: 1 }], { fragment: true }).diagnostics), ['unknown-verb']);
  assert.match(validateScript([{ verb: 'rectangle' }], { fragment: true }).diagnostics[0].message, /Did you mean `rect`\?/);
  assert.deepEqual(codes(validateScript([{ verb: 'to', x: 0, y: 0 }], { fragment: true }).diagnostics), ['misplaced-verb']);
  assert.deepEqual(
    codes(validateScript([{ verb: 'path', body: [{ verb: 'move', x: 0, y: 0 }, { verb: 'rect', x: 0, y: 0, width: 1, height: 1 }] }], { fragment: true }).diagnostics),
    ['misplaced-verb'],
  );
  assert.deepEqual(codes(validateScript([{ verb: 'color', color: 'red' }, { verb: 'napkin', version: 1 }]).diagnostics), ['version-missing', 'misplaced-verb']);
  assert.deepEqual(codes(validateScript([{ verb: 'napkin', version: 2 }]).diagnostics), ['version-unsupported']);
  assert.deepEqual(validateScript([]).diagnostics, []);
  assert.deepEqual(codes(validateScript([{ verb: 'rect', x: 0, y: 0, width: 1, height: 1 }]).diagnostics), ['version-missing']);
});

test('source positions survive in JSON, and a bad one is left out with a warning', () => {
  const kept = validateScript([{ verb: 'close', at: { line: 3, column: 5 } }], { fragment: true });
  assert.deepEqual(codes(kept.diagnostics), ['misplaced-verb']);
  const good = validateScript([{ verb: 'push', at: { line: 3, column: 5 } }, { verb: 'pop', at: 'here' }], { fragment: true });
  assert.deepEqual(codes(good.diagnostics), ['unknown-field']);
  assert.deepEqual(good.script, [{ verb: 'push', at: { line: 3, column: 5 } }, { verb: 'pop' }]);
});
