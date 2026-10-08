/**
 * The `effect` verb: how it reads, what it attaches to, and what it warns.
 *
 * An effect waits for the next layer, group or mark the script makes, and
 * several wait together, in order. A mark drawn as several strokes, and a
 * placed definition, take it whole. An effect nothing takes is reported where
 * it was written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatDiagnostic, formatScript, parseScript, validateScript, type ScriptResult } from '../src/core/script/index.js';
import { tokenize } from '../src/core/script/tokenize.js';
import { sketchToInstructions } from '../src/core/script/writer.js';
import type { Layer, Stroke } from '../src/core/types.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const TIME = '2026-09-25T00:00:00.000Z';

function run(text: string): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
}

function clean(text: string): ScriptResult {
  const result = run(text);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const layers = (result: ScriptResult): Layer[] => result.book.sketches[0].layers;
const strokes = (result: ScriptResult): Stroke[] => result.book.sketches[0].strokes;
const layerNamed = (result: ScriptResult, name: string, group = false): Layer | undefined =>
  layers(result).find((layer) => layer.name === name && Boolean(layer.group) === group);

test('every way of writing an effect reads, writes back as written, and checks as JSON', () => {
  const lines = [
    'effect blur 4',
    'effect brightness 1.2',
    'effect contrast 0.8',
    'effect saturate 2',
    'effect grayscale',
    'effect grayscale 0.5',
    'effect sepia',
    'effect invert 1',
    'effect hue-rotate 90',
    'effect opacity 0.5',
    'effect drop-shadow 4 4 8 #00000066',
    'effect drop-shadow 2mm -1 (3 * 2) rgba(0,0,0,0.5)',
    'effect none',
  ];
  const text = lines.join('\n');
  const parsed = parseScript(text, { fragment: true });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(formatScript(parsed.script), `${text}\n`);
  const json = JSON.parse(JSON.stringify(parsed.script.map(({ at: _at, ...rest }) => rest)));
  assert.deepEqual(validateScript(json, { fragment: true }).diagnostics, []);
  assert.deepEqual(json[10], { verb: 'effect', type: 'drop-shadow', dx: 4, dy: 4, blur: 8, color: '#00000066' });
  assert.deepEqual(json[4], { verb: 'effect', type: 'grayscale' });
});

test('outside parentheses a hyphen joins a word, and inside it is still a minus', () => {
  const words = (source: string): string[] => tokenize(source).tokens.filter((t) => t.kind !== 'eof' && t.kind !== 'sep').map((t) => `${t.kind}:${t.text}`);
  assert.deepEqual(words('effect drop-shadow'), ['word:effect', 'word:drop-shadow']);
  assert.deepEqual(words('Hue-Rotate'), ['word:Hue-Rotate']);
  assert.deepEqual(words('(a-b)'), ['punct:(', 'word:a', 'op:-', 'word:b', 'punct:)']);
  assert.deepEqual(words('x-5'), ['word:x', 'number:-5'], 'a hyphen before a digit is a sign, as it was');
  assert.deepEqual(clean('let a 10\ncircle (a-5) 50 5').book.sketches[0].strokes[0].vector?.anchors[0].p, { x: 10, y: 50 });
});

test('an effect waits for the next mark, layer or group, and several wait together', () => {
  const result = clean(`
effect drop-shadow 4 4 8 #00000066
effect sepia 0.5
rect 20 20 100 60
circle 200 50 20
effect grayscale
layer "Photo"
image "logo" at 20 100
effect blur 2
group "Frame" {
  rect 10 10 50 50
}
`);
  const [card, dot, photo, framed] = strokes(result);
  assert.deepEqual(card.effects, [
    { type: 'drop-shadow', dx: 4, dy: 4, blur: 8, color: '#00000066' },
    { type: 'sepia', amount: 0.5 },
  ]);
  assert.equal(dot.effects, undefined, 'taken once, by the next mark only');
  assert.deepEqual(layerNamed(result, 'Photo')?.effects, [{ type: 'grayscale', amount: 1 }]);
  assert.equal(photo.effects, undefined, 'the layer took it, not the image after it');
  assert.deepEqual(layerNamed(result, 'Frame', true)?.effects, [{ type: 'blur', radius: 2 }]);
  assert.equal(framed.effects, undefined);
});

test('text, images, links and copied documents take an effect as a whole', () => {
  const result = clean(`
effect invert
text "Acme Corp" at 20 20
effect sepia
link "assets/logo.svg" at 20 60 size 80 40
effect blur 1
use "badge" at 200 20
effect hue-rotate 30
image "logo" at 200 150
`);
  const [text, link] = strokes(result);
  assert.deepEqual(text.effects, [{ type: 'invert', amount: 1 }]);
  assert.deepEqual(link.effects, [{ type: 'sepia', amount: 1 }]);
  assert.deepEqual(layerNamed(result, 'badge', true)?.effects, [{ type: 'blur', radius: 1 }]);
  assert.deepEqual(strokes(result).at(-1)?.effects, [{ type: 'hue-rotate', angle: 30 }]);
});

test('a mark drawn as several strokes, a shape of several parts and a placement take the effect whole', () => {
  const rough = clean('layer "Card"\nrough 0.6\nfill #ffe08a\neffect blur 2\nrect 10 10 100 60\nrect 120 10 50 50');
  const own = layerNamed(rough, 'rect');
  assert.deepEqual(own?.effects, [{ type: 'blur', radius: 2 }], 'the hand-drawn rect is on a layer of its own');
  assert.equal(strokes(rough).filter((s) => s.layer === own?.id).length, 2, 'its fill and its line');
  assert.ok(strokes(rough).every((s) => s.effects === undefined), 'and the effect is on the layer, not repeated on each stroke');
  assert.equal(strokes(rough).filter((s) => s.layer === layerNamed(rough, 'Card')?.id).length, 2, 'the next rect is back on Card');

  const cube = clean('fill #326478\neffect drop-shadow 4 4 4 #0006\nshape "cube-isometric" at 20 20 size 100');
  const cubeLayer = layerNamed(cube, 'cube-isometric');
  assert.ok(cubeLayer?.effects, 'a shape of several parts is on a layer of its own');
  assert.ok(strokes(cube).length > 1 && strokes(cube).every((s) => s.layer === cubeLayer?.id));

  const placed = clean('define "tick" {\n  line 0 10 4 14\n  line 4 14 14 0\n}\neffect sepia\nplace "tick" at 40 40 scale 2');
  assert.deepEqual(layerNamed(placed, 'tick', true)?.effects, [{ type: 'sepia', amount: 1 }], 'a placement is a group of its own');
  assert.equal(strokes(placed).length, 2);
});

test('a Splatter on a mark drawn as several strokes, or on a shape of several parts, goes on the marks it hatches, not their layer', () => {
  const types = (s: Stroke): string[] => (s.effects ?? []).map((effect) => effect.type);
  const rough = clean('layer "Card"\nrough 0.6\nfill #ffe08a\neffect splatter seed 3\neffect blur 2\nrect 10 10 100 60');
  const own = layerNamed(rough, 'rect');
  assert.deepEqual(own?.effects, [{ type: 'blur', radius: 2 }], 'the blur works on the whole hand-drawn rect, on its layer');
  const [fill, ...lines] = strokes(rough);
  assert.ok(fill.fill && lines.length > 0 && lines.every((s) => !s.fill), 'its fill, then its line');
  assert.deepEqual(types(fill), ['splatter'], 'the Splatter hatches the fill piece');
  assert.ok(lines.every((s) => s.effects === undefined), 'and leaves the line as it is');

  const outline = clean('rough 0.6 passes 2\nfill none\neffect splatter\nrect 10 10 100 60');
  assert.ok(strokes(outline).length > 1 && strokes(outline).every((s) => types(s).join() === 'splatter'), 'with no fill, each pass of the line takes it');
  assert.equal(layerNamed(outline, 'rect'), undefined, 'and with nothing else, no layer of its own');

  const cube = clean('fill #326478\neffect splatter preset dense\neffect drop-shadow 4 4 4 #0006\nshape "cube-isometric" at 20 20 size 100');
  const cubeLayer = layerNamed(cube, 'cube-isometric');
  assert.deepEqual(cubeLayer?.effects?.map((effect) => effect.type), ['drop-shadow'], 'the shadow falls from the whole cube');
  assert.ok(strokes(cube).length > 1 && strokes(cube).every((s) => types(s).join() === 'splatter'), 'and each part is hatched');
  assert.deepEqual(cube.diagnostics, [], 'with nothing left waiting');
});

test('effect none lets go of what is waiting', () => {
  const result = clean('effect blur 2\neffect sepia\neffect none\nrect 0 0 10 10');
  assert.equal(strokes(result)[0].effects, undefined);
});

test('an effect nothing takes is reported where it was written: at the end of its block, its page or the script', () => {
  const codes = (result: ScriptResult): string[] => result.diagnostics.map((d) => `${d.code}@${d.line}`);
  assert.deepEqual(codes(run('rect 0 0 10 10\neffect blur 2')), ['unused-effect@2']);
  assert.deepEqual(codes(run('group "G" {\n  effect sepia\n}\nrect 0 0 10 10')), ['unused-effect@2'], 'a group keeps its effects to itself');
  assert.deepEqual(codes(run('effect sepia\nnewpage\nrect 0 0 10 10')), ['unused-effect@1'], 'an effect does not wait across a page');
  assert.deepEqual(codes(run('define "d" {\n  effect sepia\n}\nplace "d"')), ['unused-effect@2']);
  const message = run('effect hue-rotate 90').diagnostics[0].message;
  assert.equal(message, '`effect hue-rotate` did nothing: no layer, group or mark followed it before the script ended.');
});

test('an effect is measured where it is written: in the units, the scale and the turn in force there', () => {
  const mm = clean('units mm\neffect blur 1\nrect 0 0 10 10');
  const radius = strokes(mm)[0].effects?.[0];
  assert.ok(radius?.type === 'blur' && Math.abs(radius.radius - 96 / 25.4) < 1e-9, JSON.stringify(radius));

  const scaled = clean('scale 2\neffect blur 3\nrect 0 0 10 10');
  assert.deepEqual(strokes(scaled)[0].effects, [{ type: 'blur', radius: 6 }]);

  const turned = clean('rotate 90\neffect drop-shadow 4 0 2 #000000\nrect 0 0 10 10');
  const shadow = strokes(turned)[0].effects?.[0];
  assert.ok(shadow?.type === 'drop-shadow', JSON.stringify(shadow));
  assert.ok(Math.abs(shadow.dx) < 1e-9 && Math.abs(shadow.dy - 4) < 1e-9, 'a shadow across, turned a quarter, falls down');
  assert.equal(shadow.blur, 2);
});

test('an effect out of range is an error at its line, and a name that is not one says what is', () => {
  const codes = (text: string): string[] => run(text).diagnostics.map((d) => `${d.code}@${d.line}`);
  assert.deepEqual(codes('effect blur -1\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect grayscale 2\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect brightness -0.5\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect glow 2'), ['expected-choice@1']);
  assert.deepEqual(codes('effect drop-shadow 4 4 8'), ['missing-argument@1']);
  assert.deepEqual(clean('effect DROP-SHADOW 1 1 1 red\nrect 0 0 1 1').book.sketches[0].strokes[0].effects?.[0].type, 'drop-shadow', 'in any case');
});

// ---- The appearance effects ----------------------------------------------------------

test('every way of writing an appearance effect reads, writes back as written, and checks as JSON', () => {
  const lines = [
    'effect feather 6',
    'effect bevel',
    'effect bevel outer size 8 depth 150 angle 45 altitude 60 soften 2 down light #ffffcc 0.5 shade #330000 light-blend normal shade-blend fold',
    'effect emboss pillow size 4',
    'effect inner-shadow 3 4 6 #000000 choke 20 blend multiply opacity 0.5',
    'effect outer-glow',
    'effect outer-glow 12 #ffcc00 spread 30 blend normal opacity 0.9',
    'effect inner-glow 8 #ffffbe choke 10 center blend sheer opacity 1',
    'effect drop-shadow 4 4 8 #000000 spread 25 blend stack opacity 0.75',
    'effect blur 2 on fill',
    'effect sepia hidden',
    'effect outer-glow on stroke hidden',
  ];
  const text = lines.join('\n');
  const parsed = parseScript(text, { fragment: true });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(formatScript(parsed.script), `${text}\n`);
  const json = JSON.parse(JSON.stringify(parsed.script.map(({ at: _at, ...rest }) => rest)));
  assert.deepEqual(validateScript(json, { fragment: true }).diagnostics, []);
  assert.deepEqual(json[3], { verb: 'effect', type: 'emboss', style: 'pillow', size: 4 });
  assert.deepEqual(json[9], { verb: 'effect', type: 'blur', radius: 2, target: 'fill' });
  assert.deepEqual(json[11], { verb: 'effect', type: 'outer-glow', target: 'stroke', hidden: true });
});

test('an appearance effect takes its defaults for what the line leaves out, a blend by either name, its aim and its switch', () => {
  const effectOf = (line: string) => strokes(clean(`${line}\nfill #ffe08a\nrect 0 0 40 40`))[0].effects;
  assert.deepEqual(effectOf('effect outer-glow'), [{ type: 'outer-glow', blur: 7, spread: 0, color: '#ffffbe', blend: 'sheer', opacity: 0.75 }]);
  assert.deepEqual(effectOf('effect inner-shadow 1 2 3 #102030 blend multiply'), [
    { type: 'inner-shadow', dx: 1, dy: 2, blur: 3, choke: 0, color: '#102030', blend: 'stack', opacity: 0.75 },
  ]);
  const bevel = effectOf('effect bevel size 6 light #ffcc00 shade-blend luminosity on fill')?.[0];
  assert.ok(bevel?.type === 'bevel');
  assert.deepEqual([bevel.style, bevel.size, bevel.angle, bevel.highlight, bevel.shadow.blend, bevel.target], [
    'inner',
    6,
    120,
    { color: '#ffcc00', blend: 'sheer', opacity: 0.75 },
    'cover',
    'fill',
  ]);
  assert.deepEqual(effectOf('effect drop-shadow 4 4 8 #000 opacity 1 blend normal spread 0'), [{ type: 'drop-shadow', dx: 4, dy: 4, blur: 8, color: '#000' }], 'a shadow at its old values is the old shadow');
  assert.deepEqual(effectOf('effect feather 4 hidden'), [{ type: 'feather', radius: 4, on: false }]);
});

test('an appearance effect is measured where it is written: its lengths scale, and its offset and its light turn', () => {
  const scaled = clean('scale 2\neffect bevel size 3 soften 1\neffect outer-glow 5\nrect 0 0 10 10');
  const [bevel, glow] = strokes(scaled)[0].effects ?? [];
  assert.ok(bevel?.type === 'bevel' && glow?.type === 'outer-glow');
  assert.deepEqual([bevel.size, bevel.soften, glow.blur], [6, 2, 10]);
  const fallback = strokes(clean('scale 2\neffect outer-glow\nrect 0 0 10 10'))[0].effects?.[0];
  assert.ok(fallback?.type === 'outer-glow' && fallback.blur === 14, 'a default length is in the units too');

  const turned = clean('rotate 90\neffect inner-shadow 4 0 2 #000000\neffect bevel angle 0\nrect 0 0 10 10');
  const [inner, light] = strokes(turned)[0].effects ?? [];
  assert.ok(inner?.type === 'inner-shadow' && light?.type === 'bevel');
  assert.ok(Math.abs(inner.dx) < 1e-9 && Math.abs(inner.dy - 4) < 1e-9, 'an inner shadow across, turned a quarter, falls down');
  assert.equal(light.angle, 270, 'a light from the right, turned a quarter clockwise, comes from below');
  assert.equal((strokes(clean('effect bevel angle -30\nrect 0 0 1 1'))[0].effects?.[0] as { angle: number }).angle, 330, 'an angle is held to a turn');
});

test('an appearance effect out of range is an error at its line', () => {
  const codes = (text: string): string[] => run(text).diagnostics.map((d) => `${d.code}@${d.line}`);
  assert.deepEqual(codes('effect outer-glow 4 #fff spread 120\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect inner-glow 4 #fff opacity 2\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect bevel altitude 95\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect bevel depth 0\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect feather -2\nrect 0 0 1 1'), ['invalid-value@1']);
  assert.deepEqual(codes('effect bevel sideways'), ['unexpected-token@1']);
  assert.match(run('effect outer-glow 4 #fff spread 120\nrect 0 0 1 1').diagnostics[0].message, /A glow spread runs from 0 to 100, and is 120/);
});

test('a mark drawn as several strokes takes an effect aimed at its fill on the fill, one aimed at its stroke on each pass, and the rest on its layer', () => {
  const rough = clean('layer "Card"\nrough 0.6\nfill #ffe08a\neffect blur 2 on fill\neffect sepia on stroke\neffect invert\nrect 10 10 100 60');
  const own = layerNamed(rough, 'rect');
  assert.deepEqual(own?.effects, [{ type: 'invert', amount: 1 }], 'the whole mark\'s on its layer');
  const pieces = strokes(rough).filter((s) => s.layer === own?.id);
  const fill = pieces.filter((s) => s.noStroke);
  const lines = pieces.filter((s) => !s.noStroke);
  assert.ok(fill.length === 1 && lines.length >= 1);
  assert.deepEqual(fill[0].effects, [{ type: 'blur', radius: 2, target: 'fill' }]);
  assert.ok(lines.every((s) => JSON.stringify(s.effects) === JSON.stringify([{ type: 'sepia', amount: 1, target: 'stroke' }])));

  const aimed = clean('rough 0.6\nfill #ffe08a\neffect blur 2 on fill\nrect 10 10 100 60');
  assert.equal(layerNamed(aimed, 'rect'), undefined, 'with nothing for the whole mark, it needs no layer of its own');
  const smooth = clean('fill #ffe08a\neffect blur 2 on fill\neffect invert\nrect 10 10 100 60');
  assert.deepEqual(strokes(smooth)[0].effects, [{ type: 'blur', radius: 2, target: 'fill' }, { type: 'invert', amount: 1 }], 'a smooth mark keeps them all, aims and all');
});

test('Generate Script writes every appearance effect back, aims and switches too, and the script draws them again', () => {
  const text = [
    'layer "Card"',
    'fill #4a7fb5 color #1f2328 width 6',
    'effect bevel outer size 8 depth 150 angle 45 altitude 60 soften 2 down light #ffffcc 0.5 shade #330000 light-blend normal shade-blend fold on fill',
    'effect emboss pillow size 4 hidden',
    'effect inner-shadow 3 4 6 #000000 choke 20 opacity 0.5',
    'effect outer-glow 12 #ffcc00 spread 30 blend normal opacity 0.9 on stroke',
    'effect inner-glow 8 #ffffbe choke 10 center',
    'effect drop-shadow 4 4 8 #000000 spread 25 blend stack opacity 0.75',
    'effect feather 3',
    'rect 40 40 180 120 r 16',
  ].join('\n');
  const first = clean(text);
  const written = formatScript(sketchToInstructions(first.book.sketches[0]).script);
  const again = evaluate(written, { timestamp: TIME, ...SCRIPT_FIXTURES });
  assert.deepEqual(again.diagnostics.map((d) => formatDiagnostic(d)), []);
  assert.deepEqual(again.book.sketches[0].strokes[0].effects, strokes(first)[0].effects);
  assert.match(written, /^effect inner-glow 8 #ffffbe choke 10 center$/m, 'only what is not the default is written');
  assert.match(written, /^effect emboss pillow size 4 hidden$/m);
});
