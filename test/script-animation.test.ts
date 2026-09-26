/**
 * Measured animation frames with no AI: `measuredFramesScript` writes a script
 * that copies a figure's parts onto a page a frame, each turned about its
 * joint by a measured cycle's totals, every page cut to one registration box.
 *
 * The figure is the walking character in `test/imports/walk.svg`, read with
 * its layer tree: the six assemblies inside `walk_0`, a shoe in each leg.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MEASURED_CYCLES } from '../src/core/animation-cycles.js';
import { assemblyPivot } from '../src/core/animation.js';
import { strokeBounds } from '../src/core/bounds.js';
import { MEASURED_ANIMATION_TYPES, MeasuredFramesError, measuredAnimationType, measuredFramesScript } from '../src/core/script/animation.js';
import { evaluate, formatScript, inkBox, parseScript } from '../src/core/script/index.js';
import { layerTree, type LayerNode } from '../src/core/script/media.js';
import { createLayer, createSketch, descendantLayerIds, strokesByLayer, type Sketch, type Stroke } from '../src/core/types.js';
import { walkFigure } from './helpers/walk-figure.js';

const STAMP = '2026-09-25T00:00:00.000Z';

/** The figure drawn through a cycle: the plan, and the book its script draws. */
function drawn(source: Sketch, options: Parameters<typeof measuredFramesScript>[1]) {
  const plan = measuredFramesScript(source, options);
  const result = evaluate(plan.script, { documents: plan.documents, timestamp: STAMP });
  assert.deepEqual(result.diagnostics, []);
  return { plan, result };
}

/** A layer's strokes by the names from the top of a tree down. */
function strokesAt(nodes: readonly LayerNode[], names: readonly string[]): Stroke[] {
  const [first, ...rest] = names;
  const node = nodes.find((n) => n.layer.name === first);
  assert.ok(node, `no layer ${first}`);
  return rest.length === 0 ? node.strokes : strokesAt(node.children, rest);
}

/** Where a point lands turned by `degrees` about a pivot, clockwise on a page whose y runs down. */
function turned(p: { x: number; y: number }, degrees: number, pivot: { x: number; y: number }): { x: number; y: number } {
  const r = (degrees * Math.PI) / 180;
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * Math.cos(r) - dy * Math.sin(r), y: pivot.y + dx * Math.sin(r) + dy * Math.cos(r) };
}

/** The joint an assembly turns about in the source: the top-centre of its box, as Animation Mode measures it. */
function jointOf(source: Sketch, name: 'back-arm-assembly' | 'front-leg-assembly'): { x: number; y: number } {
  const layer = source.layers.find((l) => l.name === name)!;
  const ids = new Set([layer.id, ...descendantLayerIds(source, layer.id)]);
  const byLayer = strokesByLayer(source);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    for (const stroke of byLayer.get(id) ?? []) {
      const b = strokeBounds(stroke)!;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  return assemblyPivot(name, { minX, minY, maxX, maxY })!;
}

test('a walk from walk.svg is eight pages, walk_1 to walk_8, sharing one registration box', () => {
  const source = walkFigure();
  const { plan, result } = drawn(source, { type: 'walk' });
  assert.equal(result.book.sketches.length, 8);
  assert.deepEqual(plan.frames, ['walk_1', 'walk_2', 'walk_3', 'walk_4', 'walk_5', 'walk_6', 'walk_7', 'walk_8']);
  assert.deepEqual(result.book.sketches.map((page) => page.name), plan.frames);
  assert.deepEqual(result.output.registration, plan.registration, 'every page is cut to the one box');
  for (const page of result.book.sketches) {
    const ink = inkBox(page)!;
    assert.ok(ink.x >= plan.registration.x - 0.01 && ink.y >= plan.registration.y - 0.01, `${page.name} starts inside the box`);
    assert.ok(ink.x + ink.width <= plan.registration.x + plan.registration.width + 0.01, `${page.name} ends inside the box`);
    assert.ok(ink.y + ink.height <= plan.registration.y + plan.registration.height + 0.01);
    // Each frame is the figure's tree again: the frame's group, the six parts in the source's order.
    const [frame] = layerTree(page);
    assert.equal(frame.layer.name, page.name);
    assert.deepEqual(frame.children.map((n) => n.layer.name), ['Head', 'back-arm-assembly', 'back-leg-assembly', 'front-leg-assembly', 'Body', 'front-arm-assembly']);
  }
  // Read off the feet: every shoe points right of its leg.
  assert.deepEqual([plan.facing, plan.facingFrom], ['right', 'feet']);
});

test('the script parses, formats back to itself, and holds no geometry: each part is a document it uses', () => {
  const source = walkFigure();
  const plan = measuredFramesScript(source, { type: 'walk' });
  const parsed = parseScript(plan.text);
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(formatScript(parsed.script), plan.text);
  assert.match(plan.text, /^napkin 1\npage 44 141\nname "walk_1"\nbackground none\ngroup "walk_1" \{\n  use "Head"\n  push\n  rotate 21\.1 at [\d.]+ [\d.]+\n  use "back-arm-assembly"\n  pop\n/);
  assert.match(plan.text, /\nregistration -?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+\n$/);
  assert.deepEqual(Object.keys(plan.documents), ['Head', 'back-arm-assembly', 'back-leg-assembly', 'front-leg-assembly', 'Body', 'front-arm-assembly']);
  // A group with nothing of its own is re-rooted at its children, so the use's group stands in for it.
  assert.deepEqual(plan.documents['back-leg-assembly'].layers.map((l) => l.name), ['back-shoe', 'back-leg']);
  assert.deepEqual(plan.documents['back-leg-assembly'].layers.map((l) => l.parent), [undefined, undefined]);
  assert.deepEqual(MEASURED_ANIMATION_TYPES, Object.keys(MEASURED_CYCLES));
});

test('a limb turns about its own joint in the source, by the cycle totalled up to the frame', () => {
  const source = walkFigure();
  const { plan, result } = drawn(source, { type: 'walk' });
  const joint = jointOf(source, 'back-arm-assembly');
  // Frame 1 is the first step, 21.1 degrees; frame 2 is the first two, 61.8.
  for (const [page, degrees] of [[0, 21.1], [1, 61.8]] as const) {
    const before = strokesAt(layerTree(source), ['walk_0', 'back-arm-assembly', 'back-arm'])[0].points[0];
    const after = strokesAt(layerTree(result.book.sketches[page]), [plan.frames[page], 'back-arm-assembly', 'back-arm'])[0].points[0];
    const expected = turned(before, degrees, joint);
    assert.ok(Math.hypot(after.x - expected.x, after.y - expected.y) < 0.05, `${plan.frames[page]}: ${JSON.stringify(after)} against ${JSON.stringify(expected)}`);
  }
  // Every frame turns about the same joint: a frame is posed from the source, not from the frame before.
  const pivots = [...plan.text.matchAll(/rotate [-\d.]+ at ([\d.]+ [\d.]+)\n {2}use "back-arm-assembly"/g)].map((m) => m[1]);
  assert.equal(pivots.length, 7, 'every frame but the last turns the back arm');
  assert.equal(new Set(pivots).size, 1);
  // The body and the head move only with the figure, which a walk does not tip or bob.
  const body = strokesAt(layerTree(result.book.sketches[3]), [plan.frames[3], 'Body', 'body'])[0].points[0];
  const still = strokesAt(layerTree(source), ['walk_0', 'Body', 'body'])[0].points[0];
  assert.deepEqual([body.x, body.y], [still.x, still.y]);
});

test('a looping cycle closes: the last frame is the source pose again, to the cycle table\'s rounding', () => {
  const source = walkFigure();
  const { plan, result } = drawn(source, { type: 'walk' });
  const last = result.book.sketches[7];
  for (const part of [['back-arm-assembly', 'back-arm'], ['front-leg-assembly', 'front-leg']]) {
    const before = strokesAt(layerTree(source), ['walk_0', ...part]);
    const after = strokesAt(layerTree(last), [plan.frames[7], ...part]);
    assert.equal(after.length, before.length);
    for (const [i, stroke] of before.entries()) {
      const a = stroke.points[0];
      const b = after[i].points[0];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.2, `${part.join('/')} mark ${i} is back where it started`);
    }
  }
});

test('the frame count paces the cycle, and a left-facing figure gets it mirrored', () => {
  const source = walkFigure();
  const four = measuredFramesScript(source, { type: 'walk', frames: 4 });
  assert.equal(four.frames.length, 4);
  // Four frames over eight measured steps: each frame moves two steps' worth.
  assert.match(four.text, /group "walk_1" \{\n {2}use "Head"\n {2}push\n {2}rotate 61\.8 at /);
  const left = measuredFramesScript(source, { type: 'walk', facing: 'left' });
  assert.deepEqual([left.facing, left.facingFrom], ['left', 'given']);
  assert.match(left.text, /group "walk_1" \{\n {2}use "Head"\n {2}push\n {2}rotate -21\.1 at /, 'every angle negated');
});

test('a cycle that tips and bobs the whole figure moves every part, about the ground it stands on', () => {
  const source = walkFigure();
  const { plan } = drawn(source, { type: 'knocked-down' });
  assert.equal(plan.frames.length, 6, 'knocked-down does not loop: six steps from seven poses');
  // Step 1: a bob of 0.3% of the figure's height and a tip of -13.6 degrees about its base.
  const first = plan.text.split('newpage')[0];
  const body = /push\n {2}translate 0 ([\d.]+)\n {2}rotate -13\.6 at ([\d.]+) ([\d.]+)\n {2}use "Body"/.exec(first);
  assert.ok(body, first);
  const figure = inkBox(source)!;
  assert.ok(Math.abs(Number(body[3]) - (figure.y + figure.height - 0.5)) < 1.5, 'the tip turns about the figure\'s base');
  assert.ok(Number(body[1]) > 0 && Number(body[1]) < 1, 'the bob is a fraction of the height');
});

test('what cannot be drawn from a cycle is said: a type with none, no assemblies, two figures', () => {
  const source = walkFigure();
  assert.throws(() => measuredFramesScript(source, { type: 'moonwalk' }), (err: Error) =>
    err instanceof MeasuredFramesError && err.message === `"moonwalk" has no measured cycle; the types that do are ${MEASURED_ANIMATION_TYPES.join(', ')}`,
  );
  const empty = createSketch('card');
  empty.strokes = [{ id: 's1', tool: 'pen', color: '#000', width: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], layer: empty.layers[0].id }];
  assert.throws(() => measuredFramesScript(empty, { type: 'walk' }), /page "card" has none of the assemblies a character animation turns/);
  // The head moved out to a figure of its own: which figure to draw is no longer clear.
  const split = walkFigure();
  const other = { ...createLayer('other'), group: true as const };
  split.layers.push(other);
  split.layers.find((l) => l.name === 'Head')!.parent = other.id;
  assert.throws(() => measuredFramesScript(split, { type: 'walk' }), /sit in more than one top-level group/);
  // Naming the figure settles it, with the assemblies it holds.
  const named = measuredFramesScript(split, { type: 'walk', root: 'walk_0' });
  assert.ok(!named.text.includes('use "Head"'));
  assert.ok(named.text.includes('use "back-arm-assembly"'));
});

test('a type answers to the label the app shows as well as to its id', () => {
  assert.equal(measuredAnimationType('ideal'), 'ideal');
  assert.equal(measuredAnimationType('Idle'), 'ideal', 'the app shows the type whose id is ideal as Idle');
  assert.equal(measuredAnimationType(' Knocked down '), 'knocked-down');
  assert.equal(measuredAnimationType('knocked_down'), 'knocked-down');
  assert.equal(measuredAnimationType('attack'), undefined, 'a type the app has, with no measured cycle');
  assert.equal(measuredAnimationType('moonwalk'), undefined);
  const idle = measuredFramesScript(walkFigure(), { type: 'idle' });
  assert.deepEqual([idle.frames.length, idle.frames[0]], [4, 'animationLayer-ideal_1'], 'named as the app names the type');
});

test('parts that share a name are told apart, and the source is left as it was', () => {
  const source = walkFigure();
  const root = source.layers.find((l) => l.name === 'walk_0')!;
  // Two shadows under the figure, neither an assembly: each moves with the figure, each its own document.
  for (const [i, x] of [10, 30].entries()) {
    const shadow = { ...createLayer('Shadow'), id: `ly_shadow_${i}`, parent: root.id };
    source.layers.splice(0, 0, shadow);
    source.strokes.push({ id: `st_shadow_${i}`, tool: 'pen', color: '#000', width: 2, layer: shadow.id, points: [{ x, y: 138 }, { x: x + 6, y: 138 }] });
  }
  const before = JSON.stringify(source);
  const plan = measuredFramesScript(source, { type: 'walk' });
  assert.equal(JSON.stringify(source), before, 'the source is not touched');
  assert.ok(plan.documents.Shadow && plan.documents['Shadow (2)']);
  assert.match(plan.text, /\n {2}use "Shadow"\n {2}use "Shadow \(2\)" layer "Shadow"\n/);
});
