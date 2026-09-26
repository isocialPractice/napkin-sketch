/**
 * Napkin script text to instructions: the tokenizer, the parser that walks the
 * verb table, and the diagnostics both report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCRIPT_LIMITS,
  VERBS,
  formatDiagnostic,
  parseScript,
  tokenize,
  type Diagnostic,
} from '../src/core/script/index.js';

/** A script without its source positions, for comparing shapes. */
const strip = <T>(value: T): T => JSON.parse(JSON.stringify(value, (key, v) => (key === 'at' ? undefined : v)));

const codes = (diagnostics: Diagnostic[]): string[] => diagnostics.map((d) => d.code);

/** Reads one fragment that must read cleanly, and returns its first instruction. */
function one(text: string): unknown {
  const result = parseScript(text, { fragment: true });
  assert.deepEqual(result.diagnostics, [], `${text}: ${result.diagnostics.map((d) => formatDiagnostic(d)).join('; ')}`);
  return strip(result.script)[0];
}

/** Reads a fragment that must fail, and returns its diagnostics. */
function failing(text: string): Diagnostic[] {
  const result = parseScript(text, { fragment: true });
  assert.equal(result.ok, false, `${text} should not read cleanly`);
  return result.diagnostics;
}

const GOAL = `napkin 1
page 400 300
background #fcfaf5
layer "Card"
color #1f2328  width 3  fill #ffe08a
rect 20 20 360 80 r 12
text "Acme Corp" at 200 70 size 28 align center
link "assets/logo.svg" at 20 120 size 120 120 name "Logo"
rough 0.5
circle 300 200 48
`;

test('the plan goal script reads cleanly, three paint instructions on one line', () => {
  const result = parseScript(GOAL);
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.script.map((i) => i.verb),
    ['napkin', 'page', 'background', 'layer', 'color', 'width', 'fill', 'rect', 'text', 'link', 'rough', 'circle'],
  );
  assert.deepEqual(strip(result.script[7]), { verb: 'rect', x: 20, y: 20, width: 360, height: 80, radius: 12 });
  assert.deepEqual(strip(result.script[9]), {
    verb: 'link',
    href: 'assets/logo.svg',
    x: 20,
    y: 120,
    width: 120,
    height: 120,
    name: 'Logo',
  });
  assert.deepEqual(result.script[5].at, { line: 5, column: 16 }, 'a chained instruction points at its own verb');
});

test('every verb example in the table reads cleanly', () => {
  for (const verb of VERBS) {
    const result = parseScript(verb.example, { fragment: true });
    assert.deepEqual(result.diagnostics, [], `${verb.name}: ${result.diagnostics.map((d) => formatDiagnostic(d)).join('; ')}`);
    assert.ok(result.script.length > 0, `${verb.name}: the example draws something`);
  }
});

test('paint instructions chain by their verbs, and nothing else chains', () => {
  const chained = parseScript('color red width 3 opacity 0.5', { fragment: true });
  assert.deepEqual(chained.diagnostics, []);
  assert.deepEqual(strip(chained.script), [
    { verb: 'color', color: 'red' },
    { verb: 'width', width: 3 },
    { verb: 'opacity', opacity: 0.5 },
  ]);
  assert.deepEqual(one('layer "Sky"  opacity 0.8'), { verb: 'layer', name: 'Sky', opacity: 0.8 });
  const shape = parseScript('rect 0 0 10 10 color red', { fragment: true });
  assert.deepEqual(codes(shape.diagnostics), ['unexpected-token']);
  assert.equal(shape.script.length, 0, 'an instruction with an error is left out');
});

test('comments, colors, separators, CRLF and a byte-order mark', () => {
  const bom = String.fromCharCode(0xfeff);
  const text = `${bom}# a comment\r\ncolor #1f2328 # the ink\r\n  #fill it later\r\nwidth 3; opacity 0.5\r\nfill #add\r\n## done\r\n`;
  const result = parseScript(text, { fragment: true });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(strip(result.script), [
    { verb: 'color', color: '#1f2328' },
    { verb: 'width', width: 3 },
    { verb: 'opacity', opacity: 0.5 },
    { verb: 'fill', fill: '#add' },
  ]);
  assert.deepEqual(result.script[2].at, { line: 4, column: 10 });
});

test('strings read their escapes and keep any other backslash', () => {
  assert.deepEqual(one('text "C:\\art\\logo \\"one\\"\\nline two" at 0 0'), {
    verb: 'text',
    text: 'C:\\art\\logo "one"\nline two',
    x: 0,
    y: 0,
  });
});

test('lengths keep their units and shares of the page; bare numbers stay numbers', () => {
  assert.deepEqual(one('rect 10mm 0.5in 50% 12pt r 4px'), {
    verb: 'rect',
    x: '10mm',
    y: '0.5in',
    width: '50%',
    height: '12pt',
    radius: '4px',
  });
  assert.deepEqual(one('rect -10 .5 1e2 -0'), { verb: 'rect', x: -10, y: 0.5, width: 100, height: 0 });
  assert.deepEqual(one('rect 10.50MM 0 1 1'), { verb: 'rect', x: '10.5mm', y: 0, width: 1, height: 1 });
});

test('a unit the language does not know is named, where it is', () => {
  const [d] = failing('rect 10cm 0 1 1');
  assert.equal(d.code, 'unit-unknown');
  assert.deepEqual([d.line, d.column], [1, 6]);
  assert.match(d.message, /`cm` is not a unit/);
});

test('a percentage is refused where there is no page to measure it against', () => {
  assert.deepEqual(codes(failing('page 50% 300')), ['invalid-value']);
  assert.deepEqual(codes(failing('let half 50%')), ['invalid-value']);
});

test('an expression is kept as its source, and a broken one is reported at its column', () => {
  assert.deepEqual(one('rect (gap * 4) ( 20 + i ) 30 30'), {
    verb: 'rect',
    x: { expr: 'gap * 4' },
    y: { expr: '20 + i' },
    width: 30,
    height: 30,
  });
  const [d] = failing('rect (i * ) 0 1 1');
  assert.equal(d.code, 'invalid-expression');
  assert.deepEqual([d.line, d.column], [1, 10]);
  assert.deepEqual(codes(failing('rect (1 + 2 0 1 1')), ['invalid-expression']);
  assert.deepEqual(codes(failing('rect (10cm) 0 1 1')), ['unit-unknown']);
});

test('colors: hex, names and functions, lower-cased, with a suggestion for a near miss', () => {
  assert.deepEqual(one('color RGB(31, 35, 40)'), { verb: 'color', color: 'rgb(31, 35, 40)' });
  assert.deepEqual(one('color SteelBlue'), { verb: 'color', color: 'steelblue' });
  assert.deepEqual(one('fill #1F2328'), { verb: 'fill', fill: '#1f2328' });
  const [near] = failing('color grean');
  assert.equal(near.code, 'expected-color');
  assert.match(near.message, /Did you mean `green`\?/);
  assert.deepEqual(codes(failing('color #12345')), ['expected-color']);
  assert.deepEqual(codes(failing('color none')), ['expected-color'], '`none` is spelled by the verbs that accept it');
});

test('forms: none, off, and the fields a form implies', () => {
  assert.deepEqual(one('background none'), { verb: 'background', color: null });
  assert.deepEqual(one('fill none'), { verb: 'fill', fill: null });
  assert.deepEqual(one('rough off'), { verb: 'rough', amount: 0 });
  assert.deepEqual(one('rough 0.6 passes 2 overshoot 2mm'), { verb: 'rough', amount: 0.6, passes: 2, overshoot: '2mm' });
  assert.deepEqual(one('stroke off'), { verb: 'stroke', on: false });
  assert.deepEqual(one('gradient none'), { verb: 'gradient', type: 'none' });
  assert.deepEqual(one('gradient radial (#fff 0%, #000 100%)'), {
    verb: 'gradient',
    type: 'radial',
    stops: [
      { color: '#fff', offset: 0 },
      { color: '#000', offset: 1 },
    ],
  });
  assert.deepEqual(one('gradient linear 90 (red, rgb(0, 0, 255), white)'), {
    verb: 'gradient',
    type: 'linear',
    angle: 90,
    stops: [
      { color: 'red', offset: 0 },
      { color: 'rgb(0, 0, 255)', offset: 0.5 },
      { color: 'white', offset: 1 },
    ],
  });
  assert.deepEqual(one('page a4 landscape'), { verb: 'page', paper: 'a4', orientation: 'landscape' });
  assert.deepEqual(one('page 210mm 297mm'), { verb: 'page', width: '210mm', height: '297mm' });
  assert.deepEqual(one('font 24'), { verb: 'font', size: 24 });
  assert.deepEqual(one('font "Georgia" 24'), { verb: 'font', family: 'Georgia', size: 24 });
  assert.deepEqual(one('crop auto pad 12'), { verb: 'crop', mode: 'auto', pad: 12 });
  assert.deepEqual(one('crop none'), { verb: 'crop', mode: 'none' });
  assert.deepEqual(one('crop 0 0 400 300'), { verb: 'crop', mode: 'box', x: 0, y: 0, width: 400, height: 300 });
  assert.deepEqual(one('scale 2 1 at 50% 50%'), { verb: 'scale', sx: 2, sy: 1, cx: '50%', cy: '50%' });
  assert.deepEqual(one('mirror y at 150'), { verb: 'mirror', axis: 'y', about: 150 });
  assert.deepEqual(one('text "Hi" at 10 20 align right as marks'), {
    verb: 'text',
    text: 'Hi',
    x: 10,
    y: 20,
    align: 'right',
    asMarks: true,
  });
  assert.deepEqual(one('image "logo" at 0 0 size 120'), { verb: 'image', src: 'logo', x: 0, y: 0, width: 120 });
  assert.deepEqual(one('layer "Ink" locked hidden'), { verb: 'layer', name: 'Ink', hidden: true, locked: true });
  assert.deepEqual(one('Rect 0 0 1 1 R 2'), { verb: 'rect', x: 0, y: 0, width: 1, height: 1, radius: 2 }, 'keywords ignore case');
});

test('blocks nest, inline or across lines, and a path block holds path steps', () => {
  const text = `group "Figure" {
  layer "Head"
  circle 200 80 30
  path {
    move 0 0
    to 10 0
    close
  }
}
repeat 3 as i { rect (i * 20) 0 10 10 }
define "dot" { circle 0 0 2; circle 5 0 2 }`;
  const result = parseScript(text, { fragment: true });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(strip(result.script), [
    {
      verb: 'group',
      name: 'Figure',
      body: [
        { verb: 'layer', name: 'Head' },
        { verb: 'circle', cx: 200, cy: 80, r: 30 },
        {
          verb: 'path',
          body: [
            { verb: 'move', x: 0, y: 0 },
            { verb: 'to', x: 10, y: 0 },
            { verb: 'close' },
          ],
        },
      ],
    },
    { verb: 'repeat', count: 3, as: 'i', body: [{ verb: 'rect', x: { expr: 'i * 20' }, y: 0, width: 10, height: 10 }] },
    {
      verb: 'define',
      name: 'dot',
      body: [
        { verb: 'circle', cx: 0, cy: 0, r: 2 },
        { verb: 'circle', cx: 5, cy: 0, r: 2 },
      ],
    },
  ]);
});

test('a verb out of place is named', () => {
  const [outside] = failing('to 1 2');
  assert.equal(outside.code, 'misplaced-verb');
  assert.match(outside.message, /only works inside a `path/);
  const inside = parseScript('path {\n  layer "x"\n  move 0 0\n  to 1 1\n}', { fragment: true });
  assert.deepEqual(codes(inside.diagnostics), ['misplaced-verb']);
  assert.equal(inside.diagnostics[0].line, 2);
  assert.deepEqual(strip(inside.script), [{ verb: 'path', body: [{ verb: 'move', x: 0, y: 0 }, { verb: 'to', x: 1, y: 1 }] }]);
  const late = parseScript('color red\nnapkin 1');
  assert.deepEqual(codes(late.diagnostics), ['misplaced-verb']);
  assert.match(late.diagnostics[0].message, /first instruction/);
  const afterTypo = parseScript('circl 1 2 3\nnapkin 1');
  assert.deepEqual(codes(afterTypo.diagnostics), ['unknown-verb', 'misplaced-verb'], 'a first line with an error still comes first');
  const nested = parseScript('napkin 1\ngroup "g" {\n  napkin 1\n}');
  assert.deepEqual(codes(nested.diagnostics), ['misplaced-verb']);
});

test('a block never closed, and a close with no block', () => {
  const [open] = failing('group "x" {\n  rect 0 0 1 1\n');
  assert.equal(open.code, 'unclosed-block');
  assert.deepEqual([open.line, open.column], [1, 11]);
  assert.deepEqual(codes(failing('rect 0 0 1 1\n}')), ['unexpected-close']);
});

test('three typos report three, each at its line and column, and the rest is read', () => {
  const text = `napkin 1
rect 0 0 10 1O
circl 50 50 10
color #1f2328 width three
line 0 0 10 10`;
  const result = parseScript(text);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.line, d.column]),
    [
      ['unit-unknown', 2, 13],
      ['unknown-verb', 3, 1],
      ['expected-length', 4, 21],
    ],
  );
  assert.deepEqual(
    result.script.map((i) => i.verb),
    ['napkin', 'color', 'line'],
  );
  assert.match(result.diagnostics[1].message, /Did you mean `circle`\?/);
});

test('unknown verbs suggest the verb that was meant', () => {
  assert.match(failing('rectangle 0 0 1 1')[0].message, /Did you mean `rect`\?/);
  assert.match(failing('colour red')[0].message, /Did you mean `color`\?/);
  assert.match(failing('elipse 0 0 1 1')[0].message, /Did you mean `ellipse`\?/);
  assert.doesNotMatch(failing('zzz 1')[0].message, /Did you mean/);
});

test('what is missing is named, with how the verb is written', () => {
  const [rect] = failing('rect 0 0 10');
  assert.equal(rect.code, 'missing-argument');
  assert.match(rect.message, /`rect` needs `height`: rect <x> <y> <width> <height> \[r <radius>\]/);
  const [text] = failing('text "Hi"');
  assert.equal(text.code, 'missing-argument');
  assert.match(text.message, /needs `at <x> <y>`/);
  assert.deepEqual(codes(failing('group "x"')), ['expected-block']);
  assert.deepEqual(codes(failing('rect 0 0 1 1 {\n}')), ['unexpected-token']);
  assert.deepEqual(codes(failing('text "Hi" at 0 0 at 1 1')), ['unexpected-token']);
});

test('whole numbers, plain numbers and literals', () => {
  assert.match(failing('star 0 0 10 5 5.5')[0].message, /whole number/);
  assert.match(failing('rotate 45deg')[0].message, /does not take a unit/);
  assert.match(failing('opacity 50%')[0].message, /does not take a percentage/);
  assert.match(failing('seed (3)')[0].message, /not an expression/);
  assert.deepEqual(one('rotate (i * 30) at 200 150'), { verb: 'rotate', angle: { expr: 'i * 30' }, cx: 200, cy: 150 });
});

test('names: a let takes an identifier, and a bare name where a number goes is explained', () => {
  assert.deepEqual(one('let gap 24'), { verb: 'let', name: 'gap', value: 24 });
  assert.deepEqual(one('let margin 10mm'), { verb: 'let', name: 'margin', value: '10mm' });
  assert.deepEqual(codes(failing('let width 3')), ['invalid-value']);
  assert.deepEqual(codes(failing('repeat 2 as sin {\n}')), ['invalid-value']);
  const [bare] = failing('rect gap 0 1 1');
  assert.equal(bare.code, 'expected-length');
  assert.match(bare.message, /write it in parentheses: `\(gap\)`/);
});

test('points and stops need enough of themselves', () => {
  assert.deepEqual(one('polygon 0 0, 10 0, 5 8'), {
    verb: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ],
  });
  assert.deepEqual(codes(failing('polygon 0 0, 10 0')), ['invalid-value']);
  assert.deepEqual(codes(failing('polyline 0 0, 10')), ['expected-points']);
  assert.deepEqual(codes(failing('polyline 0 0, 10 10,')), ['expected-points']);
  assert.deepEqual(codes(failing('gradient linear 0 (red)')), ['expected-stops']);
  assert.deepEqual(codes(failing('gradient linear 0 (red 0, blue)')), ['expected-stops']);
});

test('the version line: missing is a warning, newer is an error, and a fragment needs none', () => {
  const bare = parseScript('rect 0 0 1 1');
  assert.equal(bare.ok, true, 'a warning is not an error');
  assert.deepEqual(codes(bare.diagnostics), ['version-missing']);
  assert.deepEqual(parseScript('rect 0 0 1 1', { fragment: true }).diagnostics, []);
  const newer = parseScript('napkin 2\nrect 0 0 1 1');
  assert.deepEqual(codes(newer.diagnostics), ['version-unsupported']);
  assert.match(newer.diagnostics[0].message, /reads up to napkin 1/);
  assert.deepEqual(codes(parseScript('napkin 0').diagnostics), ['invalid-value']);
  assert.deepEqual(codes(parseScript('napkin x').diagnostics), ['expected-number'], 'a broken napkin line is not also missing');
  assert.deepEqual(parseScript('').diagnostics, [], 'an empty script has nothing to warn about');
});

test('an unclosed string runs to the end of its line and is reported', () => {
  assert.deepEqual(codes(failing('text "Hi at 0 0')), ['unclosed-string', 'missing-argument']);
});

test('a character that cannot start anything is reported and skipped', () => {
  const result = parseScript('rect 0 0 1 1 @', { fragment: true });
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.column]),
    [['unexpected-token', 14]],
  );
  assert.equal(result.script.length, 1);
});

test('blocks nested past the depth limit stop there, once', () => {
  const levels = SCRIPT_LIMITS.depth + 6;
  const text = `${'group "g" {\n'.repeat(levels)}${'}\n'.repeat(levels)}`;
  const result = parseScript(text, { fragment: true });
  assert.deepEqual(codes(result.diagnostics), ['budget-exceeded']);
});

test('a diagnostic prints as file:line:column: level code: message', () => {
  const [d] = failing('circl 50 50 10');
  assert.equal(formatDiagnostic(d, 'card.napkin'), 'card.napkin:1:1: error unknown-verb: `circl` is not a verb. Did you mean `circle`?');
});

test('the tokenizer keeps each token with its kind and position', () => {
  const { tokens, diagnostics } = tokenize('rect -5 (a) "s" #fff 10mm;');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    tokens.map((t) => [t.kind, t.text, t.column]),
    [
      ['word', 'rect', 1],
      ['number', '-5', 6],
      ['punct', '(', 9],
      ['word', 'a', 10],
      ['punct', ')', 11],
      ['string', '"s"', 13],
      ['color', '#fff', 17],
      ['number', '10mm', 22],
      ['sep', ';', 26],
      ['eof', '', 27],
    ],
  );
  assert.deepEqual([tokens[7].value, tokens[7].unit], [10, 'mm']);
  assert.equal(tokenize('(-5)').tokens[1].kind, 'op', 'inside parentheses a sign is an operator');
});
