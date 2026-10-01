/**
 * Napkin script evaluation: instructions to a sketch book.
 *
 * What a script draws is checked on the book itself - the pages, the layer
 * tree, and each mark's anchors and paint - rather than on a rendering, since
 * the book is what every output is made from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INK,
  VERBS,
  evaluate,
  formatDiagnostic,
  parseScript,
  runScript,
  validateScript,
  type LayerProps,
  type PageSpec,
  type ScriptResult,
  type ScriptSink,
} from '../src/core/script/index.js';
import { KAPPA, parsePathD } from '../src/core/path-data.js';
import { Surface } from '../src/renderer/surface.js';
import { parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { toPx } from '../src/core/units.js';
import type { Sketch, Stroke } from '../src/core/types.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const TIME = '2026-09-25T00:00:00.000Z';

function run(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  return evaluate(text, { fragment: true, timestamp: TIME, ...options });
}

function clean(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  const result = run(text, options);
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const codes = (result: ScriptResult): string[] => result.diagnostics.map((d) => d.code);
const firstPage = (result: ScriptResult): Sketch => result.book.sketches[0];
const marks = (result: ScriptResult): Stroke[] => firstPage(result).strokes;
const r3 = (n: number): number => Math.round(n * 1000) / 1000 || 0;
const at = (stroke: Stroke): number[][] => stroke.vector!.anchors.map((a) => [r3(a.p.x), r3(a.p.y)]);

/** The layer tree as `[name, group, parent name]` rows, in stack order. */
function tree(sketch: Sketch): [string, boolean, string | null][] {
  return sketch.layers.map((l) => [l.name, l.group === true, sketch.layers.find((p) => p.id === l.parent)?.name ?? null]);
}

const layerOf = (sketch: Sketch, stroke: Stroke): string => sketch.layers.find((l) => l.id === stroke.layer)?.name ?? '?';

test('a script becomes a sketch book: a sized page, its background, its marks', () => {
  const result = clean('page 400 300\nbackground #ffffff\nname "card"\nrect 10 20 100 50');
  const page = firstPage(result);
  assert.deepEqual([page.width, page.height, page.sizeMode, page.background, page.name], [400, 300, 'sized', '#ffffff', 'card']);
  assert.deepEqual([result.book.name, result.book.createdAt, page.updatedAt], ['drawing', TIME, TIME]);
  const [rect] = marks(result);
  assert.deepEqual([rect.tool, rect.color, rect.width, rect.sharpened, rect.vector?.closed], ['pen', DEFAULT_INK, 3, true, true]);
  assert.deepEqual(at(rect), [[10, 20], [110, 20], [110, 70], [10, 70]]);
  assert.equal(rect.points.length, 5, 'sampled from the anchors, closing back to the start');
  assert.deepEqual(tree(page), [['Layer 1', false, null]]);
  assert.deepEqual(result.stats, { instructions: 4, marks: 1, anchors: 4, points: 5, pages: 1 });
});

test('tool brush draws with the Brush, whose marks say pen, in text and in JSON', () => {
  const mark = marks(clean('tool brush\nline 0 0 10 10'))[0];
  assert.equal(mark.tool, 'pen');
  assert.deepEqual(validateScript([{ verb: 'tool', tool: 'brush' }], { fragment: true }).diagnostics, []);
  assert.equal(marks(clean('tool marker\ntool brush\nline 0 0 10 10'))[0].tool, 'pen', 'from another tool too');
});

test('the default page is the app one, 1280 by 800 on napkin paper', () => {
  const page = firstPage(clean('line 0 0 1 1'));
  assert.deepEqual([page.width, page.height, page.background], [1280, 800, '#fcfaf5']);
});

test('paper sizes turn to their orientation', () => {
  const size = (text: string) => {
    const page = firstPage(clean(text));
    return [r3(page.width), r3(page.height)];
  };
  assert.deepEqual(size('page a4'), [r3(toPx(210, 'mm')), r3(toPx(297, 'mm'))]);
  assert.deepEqual(size('page a4 landscape'), [r3(toPx(297, 'mm')), r3(toPx(210, 'mm'))]);
  assert.deepEqual(size('page slide portrait'), [1080, 1920]);
  assert.deepEqual(size('page 3in 2in portrait'), [192, 288]);
  assert.deepEqual(firstPage(clean('background none')).background, 'transparent');
});

test('layers build the tree: named layers, nested groups, reuse by name', () => {
  const result = clean(`layer "Sky"
rect 0 0 10 10
group "Figure" opacity 0.5 {
  layer "Head"
  circle 5 5 2
  group "Arm" hidden {
    line 0 0 1 1
  }
}
layer "Sky" locked
line 0 0 5 5`);
  const page = firstPage(result);
  // Bottom first, each group's header after what it holds, as the app keeps a
  // group: the Layers panel draws the stack top first, so the header is above.
  assert.deepEqual(tree(page), [
    ['Sky', false, null],
    ['Head', false, 'Figure'],
    ['Arm', false, 'Arm'],
    ['Arm', true, 'Figure'],
    ['Figure', true, null],
  ]);
  const by = new Map(page.layers.map((l) => [`${l.name}${l.group ? '/' : ''}`, l]));
  assert.equal(by.get('Figure/')?.opacity, 0.5);
  assert.equal(by.get('Arm/')?.visible, false);
  assert.equal(by.get('Sky')?.locked, true, 'a layer named again takes the new properties');
  assert.deepEqual(
    page.strokes.map((s) => layerOf(page, s)),
    ['Sky', 'Head', 'Arm', 'Sky'],
    'a mark drawn straight into a group lands on a layer named after it',
  );
});

test('after a group, marks go back to the layer that was current before it', () => {
  const page = firstPage(clean('layer "A"\ngroup "G" {\n  layer "B"\n  line 0 0 1 1\n}\nline 0 0 1 1'));
  assert.deepEqual(
    page.strokes.map((s) => layerOf(page, s)),
    ['B', 'A'],
  );
});

test('paint lands on the marks the way the loader keeps it', () => {
  const result = clean(`color steelblue width 5 opacity 0.4 fill #ffe08a
style dashed profile tapered
rect 0 0 10 10
line 0 0 10 10
tool marker
line 0 0 5 5
tool copic nib 30
line 0 0 5 5
stroke off
gradient linear 90 (red 0, blue 1)
circle 50 50 10`);
  const [rect, line, marker, copic, circle] = marks(result);
  assert.deepEqual(
    [rect.color, rect.width, rect.opacity, rect.fill, rect.strokeStyle, rect.profile, rect.nibAngle],
    ['steelblue', 5, 0.4, '#ffe08a', 'dashed', 'tapered', undefined],
  );
  assert.equal(line.fill, undefined, 'an open mark takes no fill');
  assert.deepEqual([marker.tool, marker.profile, marker.opacity], ['marker', 'tapered', 0.4]);
  assert.deepEqual([copic.tool, copic.nibAngle, copic.profile], ['copic', 30, undefined]);
  assert.equal(circle.noStroke, true);
  assert.deepEqual(circle.gradient, {
    type: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color: 'red' },
      { offset: 1, color: 'blue' },
    ],
  });
  assert.equal(marks(clean('tool marker\nline 0 0 1 1'))[0].opacity, undefined, 'an unset opacity leaves the tool its own');
});

test('transforms bake into the anchors, and turn what has a direction', () => {
  const one = (text: string) => marks(clean(text))[0];
  assert.deepEqual(at(one('translate 10 20\nline 0 0 5 0')), [[10, 20], [15, 20]]);
  assert.deepEqual(at(one('rotate 90 at 10 10\nline 10 10 20 10')), [[10, 10], [10, 20]], 'clockwise');
  const scaled = one('scale 2\nline 1 1 2 2');
  assert.deepEqual([at(scaled), scaled.width], [[[2, 2], [4, 4]], 6], 'a stroke thickens with its scale');
  assert.deepEqual(at(one('mirror x at 50\nline 40 0 45 0')), [[60, 0], [55, 0]]);
  assert.deepEqual(at(one('mirror y at 50\nline 0 40 0 45')), [[0, 60], [0, 55]]);
  assert.deepEqual(at(one('push\ntranslate 100 0\npop\nline 0 0 1 0')), [[0, 0], [1, 0]]);
  assert.equal(one('rotate 90\ntool copic nib 30\nline 0 0 1 0').nibAngle, 120);
  assert.equal(one('mirror x\ntool copic nib 30\nline 0 0 1 0').nibAngle, 150, 'as Mirror reflects a nib in the app');
  assert.equal(one('rotate 90\ngradient linear 0 (red, blue)\nrect 0 0 10 10').gradient?.angle, 90);
});

test('units and shares of the page', () => {
  const one = (text: string) => marks(clean(text))[0];
  assert.equal(r3(at(one('units mm\nline 0 0 10 0'))[1][0]), r3(toPx(10, 'mm')));
  const circle = one('page 400 300\ncircle 50% 50% 10%');
  assert.deepEqual(at(circle)[0], [230, 150], 'a radius in % is a share of the shorter side');
  assert.deepEqual(at(one('page 400 300\nrect 0 0 (width / 2) (height / 3)'))[2], [200, 100]);
  assert.deepEqual(at(one('units in\npage 4 3\nline 0 0 (width) 0'))[1], [384, 0], 'names are in the current units');
  assert.equal(r3(at(one('let margin 10mm\nline (margin) 0 0 0'))[0][0]), r3(toPx(10, 'mm')));
  assert.deepEqual(at(one('line (1in + 4) 0 0 0'))[0], [100, 0]);
  assert.deepEqual(at(one('page 400 300\nmirror x at 50%\nline 0 0 10 0')), [[400, 0], [390, 0]]);
});

test('let sets the nearest name; a repeat builds on itself', () => {
  assert.deepEqual(at(marks(clean('let x 0\nrepeat 3 {\n  let x (x + 10)\n}\nline (x) 0 0 0'))[0])[0], [30, 0]);
  assert.deepEqual(
    marks(clean('repeat 3 as i { rect (i * 20) 0 10 10 }')).map((s) => at(s)[0]),
    [[0, 0], [20, 0], [40, 0]],
  );
  const walked = marks(clean('repeat 3 {\n  translate 30 0\n  line 0 0 1 0\n}\nline 0 0 1 0'));
  assert.deepEqual(
    walked.map((s) => at(s)[0][0]),
    [30, 60, 90, 90],
    'passes build on each other, and what they leave stays',
  );
  const fanned = marks(clean('repeat 3 as i {\n  push\n  rotate (i * 90)\n  line 0 0 10 0\n  pop\n}'));
  assert.deepEqual(
    fanned.map((s) => at(s)[1]),
    [[10, 0], [0, 10], [-10, 0]],
  );
  assert.deepEqual(codes(run('repeat 2 as i {\n}\nline (i) 0 0 0')), ['unknown-variable'], 'a counter ends with its repeat');
  assert.equal(clean('repeat 3 {\n  line 0 0 1 1\n}').stats.instructions, 7, 'the repeat, three passes, three lines');
});

test('groups and placed definitions keep their changes to themselves', () => {
  const grouped = marks(clean('group "g" {\n  color red\n  translate 100 0\n  line 0 0 1 0\n}\nline 0 0 1 0'));
  assert.deepEqual(
    grouped.map((s) => [s.color, at(s)[0][0]]),
    [['red', 100], [DEFAULT_INK, 0]],
  );
  const placed = marks(clean('define "dot" {\n  color red\n  circle 0 0 2\n}\nplace "dot" at 50 50\nplace "dot" at 60 60 scale 2\ncircle 0 0 1'));
  assert.deepEqual(
    placed.map((s) => [s.color, ...at(s)[0]]),
    [
      ['red', 52, 50],
      ['red', 64, 60],
      [DEFAULT_INK, 1, 0],
    ],
  );
  assert.deepEqual(at(marks(clean('place "a" at 10 0\ndefine "a" {\n  line 0 0 1 0\n}'))[0]), [[10, 0], [11, 0]], 'define is hoisted');
  assert.deepEqual(at(marks(clean('define "t" {\n  line 0 0 10 0\n}\nplace "t" at 5 5 rotate 90'))[0]), [[5, 5], [5, 15]]);
  const sized = marks(clean('define "r" {\n  rect 0 0 (s) (s)\n}\nlet s 4\nplace "r"\nlet s 8\nplace "r"'));
  assert.deepEqual(
    sized.map((s) => at(s)[2]),
    [[4, 4], [8, 8]],
    'a definition reads the names in force where it is placed',
  );
});

test('what cannot run is reported and skipped, and the run goes on', () => {
  const unknown = run('line (nope) 0 1 1\nline 0 0 1 1');
  assert.deepEqual(codes(unknown), ['unknown-variable']);
  assert.deepEqual([unknown.diagnostics[0].line, marks(unknown).length], [1, 1]);
  assert.deepEqual(codes(run('line (1 / 0) 0 1 1')), ['division-by-zero']);
  assert.deepEqual(codes(run('place "missing"')), ['unknown-definition']);
  assert.deepEqual(codes(run('define "loop" {\n  place "loop"\n}\nplace "loop"')), ['recursive-definition']);
  const mutual = run('define "a" {\n  place "b"\n}\ndefine "b" {\n  place "a"\n}\nplace "a"');
  assert.deepEqual(codes(mutual), ['recursive-definition']);
  assert.match(mutual.diagnostics[0].message, /places itself, by way of `b`/);
  const twice = run('define "x" {\n}\ndefine "x" {\n  line 0 0 1 1\n}\nplace "x"');
  assert.deepEqual([codes(twice), twice.ok, marks(twice).length], [['duplicate-definition'], true, 1]);
});

test('values out of range are reported, not drawn', () => {
  for (const text of [
    'opacity 1.5',
    'width 0',
    'rect 0 0 -5 5',
    'star 0 0 10 5 1',
    'circle 0 0 0',
    'arc 0 0 10 90 90',
    'scale 0',
    'repeat -1 {\n}',
    'repeat (5 / 2) {\n}',
    'gradient linear 0 (red 0, blue 2)',
    'rough 2',
    'rough 0.5 passes 3',
    'layer "x" opacity 2',
    'page 0 100',
    'spiral 0 0 10 0',
  ]) {
    const result = run(text);
    assert.deepEqual(codes(result), ['invalid-value'], text);
    assert.equal(marks(result).length, 0, text);
  }
});

test('push and pop: a pop needs a push, and a push left open is put back', () => {
  assert.deepEqual(codes(run('pop')), ['pop-without-push']);
  const open = run('group "g" {\n  push\n  translate 50 0\n}\nline 0 0 1 0');
  assert.deepEqual([codes(open), open.ok], [['unbalanced-push'], true]);
  assert.deepEqual(at(marks(open)[0])[0], [0, 0]);
  assert.deepEqual(codes(run('repeat 3 {\n  push\n}')), ['unbalanced-push'], 'once for the repeat, not once a pass');
  assert.equal(run('repeat 3 {\n  push\n}').diagnostics[0].line, 2, 'reported at the push');
});

test('newpage starts another page like the last one, with the paint and not the transform', () => {
  const result = clean('page 300 200\nbackground #eeeeee\ncolor red\ntranslate 50 0\nline 0 0 10 0\nnewpage\nline 0 0 10 0\nnewpage "Back"');
  const pages = result.book.sketches;
  assert.deepEqual(
    pages.map((p) => [p.name, p.width, p.height, p.background]),
    [
      ['drawing', 300, 200, '#eeeeee'],
      ['drawing-2', 300, 200, '#eeeeee'],
      ['Back', 300, 200, '#eeeeee'],
    ],
  );
  const [line] = pages[1].strokes;
  assert.deepEqual([line.color, at(line)[0]], ['red', [0, 0]]);
  assert.equal(result.stats.pages, 3);
  assert.deepEqual(codes(run('group "g" {\n  newpage\n}')), ['misplaced-verb']);
  assert.deepEqual(codes(run('define "d" {\n  newpage\n}\nplace "d"')), ['misplaced-verb']);
});

test('the budget stops a run and keeps what was drawn before it', () => {
  const spin = run('repeat 1000000 {\n}\nline 0 0 1 1');
  assert.deepEqual([codes(spin), spin.ok, marks(spin).length], [['budget-exceeded'], false, 0]);
  const many = run('repeat 10 {\n  line 0 0 1 1\n}', { limits: { marks: 3 } });
  assert.deepEqual([codes(many), marks(many).length, many.stats.marks], [['budget-exceeded'], 3, 3]);
  assert.deepEqual(codes(run('circle 0 0 10', { limits: { points: 20 } })), ['budget-exceeded'], 'a circle samples to 73 points');
  const anchors = run('rect 0 0 1 1\nrect 0 0 1 1', { limits: { anchors: 5 } });
  assert.deepEqual([codes(anchors), marks(anchors).length], [['budget-exceeded'], 1]);
  assert.deepEqual(codes(run('group "a" {\n  group "b" {\n    group "c" {\n    }\n  }\n}', { limits: { depth: 2 } })), ['budget-exceeded']);
});

test('a path block and path data each draw one mark', () => {
  const one = (text: string) => marks(clean(text))[0];
  const two = one('path {\n  move 0 0\n  to 10 0\n  to 10 10\n  close\n  move 20 0\n  to 30 0\n  to 30 10\n  close\n}');
  assert.deepEqual([at(two).length, two.vector?.closed, two.vector?.anchors[3].move], [6, true, true]);
  const mixed = one('path { move 0 0; to 10 0; to 10 10; close; move 20 0; to 30 0 }');
  assert.deepEqual(at(mixed), [[0, 0], [10, 0], [10, 10], [0, 0], [20, 0], [30, 0]], 'a closed subpath in an open mark closes explicitly');
  assert.equal(mixed.vector?.closed, undefined);
  const smooth = one('path { move 0 0; curve 0 10 10 10 10 0; smooth 20 -10 20 0 }');
  assert.deepEqual(smooth.vector?.anchors[1].hOut, { x: 10, y: -10 }, 'smooth mirrors the last handle');
  assert.deepEqual(at(one('path { move 5 5; by 10 0 }')), [[5, 5], [15, 5]]);
  const reopened = one('path { move 0 0; to 10 0; to 10 10; close; to 0 10 }');
  assert.deepEqual(
    at(reopened).slice(3),
    [[0, 0], [0, 0], [0, 10]],
    'a step after close starts a subpath where the closed one began, after its explicit close',
  );
  assert.equal(reopened.vector?.anchors[4].move, true);
  assert.equal(r3(at(one('units mm\npath "M0 0 L10 0"'))[1][0]), r3(toPx(10, 'mm')), 'path data is read in the current units');
  assert.deepEqual(codes(run('path { to 1 1 }')), ['invalid-value']);
  assert.deepEqual(codes(run('path "M0 0 L"')), ['invalid-value']);
});

test('shapes are anchors: circles, arcs, stars and spirals', () => {
  const one = (text: string) => marks(clean(text))[0];
  const circle = one('circle 0 0 10');
  assert.deepEqual(circle.vector?.anchors[0], { p: { x: 10, y: 0 }, hIn: { x: 10, y: -10 * KAPPA }, hOut: { x: 10, y: 10 * KAPPA } });
  const quarter = one('arc 0 0 10 0 90');
  assert.deepEqual(at(quarter), [[10, 0], [0, 10]]);
  assert.equal(r3(quarter.vector!.anchors[0].hOut!.y), r3(10 * KAPPA), 'a quarter arc has the circle handle');
  assert.equal(at(one('arc 0 0 10 0 180')).length, 3);
  assert.deepEqual(at(one('arc 0 0 10 0 -90'))[1], [0, -10], 'a smaller end angle turns the other way');
  const star = one('star 0 0 10 5 5');
  assert.deepEqual([at(star).length, at(star)[0]], [10, [0, -10]]);
  const spiral = one('spiral 0 0 10 1');
  assert.deepEqual([at(spiral).length, at(spiral)[0], at(spiral)[4]], [5, [0, 0], [10, 0]]);
  const pill = one('rect 0 0 10 10 r 20');
  assert.equal(at(pill).length, 4, 'a square with the largest radius is a circle');
  assert.ok(pill.vector!.anchors.every((a) => a.hIn && a.hOut));
});

test('a generated circle and the same circle read back from its SVG are one curve', () => {
  const result = clean('circle 100 80 40');
  const svg = Surface.toSVG(firstPage(result));
  const d = /<path[^>]* d="([^"]+)"/.exec(svg)?.[1] ?? '';
  const [read] = parsePathD(d) ?? [];
  const round2 = (a: { p: { x: number; y: number } }) => [Math.round(a.p.x * 100) / 100, Math.round(a.p.y * 100) / 100];
  assert.deepEqual(read.anchors.map(round2), marks(result)[0].vector!.anchors.map(round2));
});

test('a generated book loads back exactly as it was built', () => {
  const result = clean(`page 400 300
layer "Ink"
color steelblue width 4 fill #ffe08a
rect 10 10 50 50 r 6
group "G" hidden {
  tool copic nib 20
  arc 100 100 30 0 200
}
tool marker profile wave
polyline 0 0, 20 30, 40 0
gradient radial (white, black)
star 200 150 40 15 6`);
  // Saving stamps the book with the time it was saved; everything else comes back as built.
  const json = (value: unknown) => ({ ...JSON.parse(JSON.stringify(value)), updatedAt: undefined });
  assert.deepEqual(json(parseSketchBook(serializeSketchBook(result.book))), json(result.book));
});

test('one script gives the same book and the same SVG every run', () => {
  const text = 'page 300 200\nrepeat 12 as i {\n  push\n  rotate (i * 30) at 150 100\n  line 150 100 150 20\n  pop\n}\nspiral 150 100 60 2';
  const a = clean(text);
  const b = clean(text);
  assert.equal(JSON.stringify(a.book), JSON.stringify(b.book));
  assert.equal(Surface.toSVG(firstPage(a)), Surface.toSVG(firstPage(b)));
});

test('a script built as JSON runs the same as its text', () => {
  const text = 'page 200 100\ncolor red width 2\nrepeat 3 as i { circle (20 + i * 30) 50 10 }';
  const json = JSON.parse(JSON.stringify(parseScript(text, { fragment: true }).script, (key, v) => (key === 'at' ? undefined : v)));
  const fromText = clean(text);
  const fromJson = evaluate(json, { fragment: true, timestamp: TIME });
  assert.deepEqual(fromJson.diagnostics, []);
  assert.equal(JSON.stringify(fromJson.book), JSON.stringify(fromText.book));
});

test('every verb example runs clean', () => {
  for (const verb of VERBS) {
    // The examples place the asset `logo` and copy in the document `badge`, as a host supplies its own.
    const result = run(verb.example, SCRIPT_FIXTURES);
    assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], `${verb.name}: ${verb.example}`);
  }
});

test('a script newer than this build is not run at all', () => {
  const result = evaluate('napkin 2\nline 0 0 1 1', { timestamp: TIME });
  assert.deepEqual([codes(result), marks(result).length], [['version-unsupported'], 0]);
});

test('diagnostics from reading and from running come back together, in reading order', () => {
  const result = run('circl 1\nline (x) 0 1 1');
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.line]),
    [
      ['unknown-verb', 1],
      ['unknown-variable', 2],
    ],
  );
});

test('crop and registration are kept for the outputs, in pixels', () => {
  assert.deepEqual(clean('crop auto pad 12').output.crop, { mode: 'auto', pad: 12 });
  assert.deepEqual(clean('crop none').output.crop, { mode: 'none' });
  assert.deepEqual(clean('crop 0 0 10 10').output.crop, { mode: 'box', x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(clean('page 400 300\nregistration 0 0 50% 50%').output.registration, { x: 0, y: 0, width: 200, height: 150 });
});

test('runScript writes to any sink, through its methods alone', () => {
  const calls: string[] = [];
  const sink: ScriptSink = {
    beginPage: (page: PageSpec) => calls.push(`page ${page.name} ${page.width}x${page.height}`),
    updatePage: (change) => calls.push(`update ${JSON.stringify(change)}`),
    useLayer: (name: string, props: LayerProps) => calls.push(`layer ${name} ${JSON.stringify(props)}`),
    beginGroup: (name: string) => calls.push(`group ${name}`),
    endGroup: () => calls.push('end'),
    cursor: () => 'cursor',
    restore: () => calls.push('restore'),
    addMark: (stroke: Stroke) => calls.push(`mark ${stroke.tool} ${stroke.vector?.anchors.length}`),
  };
  const script = parseScript('page 100 50\nlayer "L" opacity 0.5\ngroup "G" {\n  line 0 0 1 1\n}\ndefine "d" {\n  circle 0 0 1\n}\nplace "d"', {
    fragment: true,
  }).script;
  const result = runScript(script, sink);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(calls, [
    'page drawing 1280x800',
    'update {"width":100,"height":50}',
    'layer L {"opacity":0.5}',
    'group G',
    'mark pen 2',
    'end',
    'mark pen 4',
    'restore',
  ]);
});
