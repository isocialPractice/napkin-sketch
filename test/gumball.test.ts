/**
 * The gumball (src/renderer/gumball.ts): where its handles stand for a known
 * turn, which one a press takes where two meet, what each drag does to the
 * 3D effect's move, turn and scale, Shift's 15-degree steps, and Escape. The
 * GUI check `check-gumball.mjs` drives the same handles in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cancelGumballDrag,
  dragGumball,
  eulerOf,
  GUMBALL_PX,
  gumballGrips,
  gumballHit,
  gumballLayout,
  gumballMoved,
  sameHandle,
  startGumballDrag,
  trackballTurn,
  type GumballHandle,
  type GumballObject,
} from '../src/renderer/gumball.js';
import { projectPoint, rotationMatrix, type ThreeDView } from '../src/core/three-d/render.js';
import type { Vec3 } from '../src/core/three-d/mesh.js';
import { THREE_D_PANEL_PARTS } from '../src/renderer/three-d-panel.js';
import { repoRoot } from './helpers/repo-root.js';

const NO_KEYS = { shift: false, alt: false };

/** A 3D mark whose solid's middle is at (100, 100), seen straight on, or through a pinhole `focal` in front of it. */
function object(rotation: [number, number, number], position: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], focal = 0): GumballObject {
  const center: Vec3 = [100, 100, 0];
  const view: ThreeDView = {
    center,
    origin: [center[0] + position[0], center[1] + position[1], center[2] + position[2]],
    rotation: rotationMatrix(rotation),
    scale,
    focal,
    eye: focal > 0 ? [center[0], center[1], center[2] + focal] : null,
  };
  return { rotation, position, scale, view };
}

const near = (actual: number, expected: number, what: string, within = 1e-6): void => assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual}, not ${expected}`);

/** Drags a handle from one page point to another and gives the fields it ends with. */
function drag(o: GumballObject, handle: GumballHandle, from: { x: number; y: number }, to: { x: number; y: number }, keys = NO_KEYS, zoom = 1) {
  return dragGumball(startGumballDrag(o, handle, from, zoom), to, keys).fields;
}

test("the handles stand along the solid's own axes, the same size at any zoom; an axis at the eye hides its arrow, a plane edge on its square", () => {
  const straight = gumballLayout(object([0, 0, 0]), 1);
  assert.deepEqual(straight.center, { x: 100, y: 100 });
  // X points right and Y down, as the page's own; Z points at the eye and shows no arrow.
  assert.deepEqual(straight.arrows.map((a) => a.axis).sort(), [0, 1]);
  const x = straight.arrows.find((a) => a.axis === 0)!;
  assert.deepEqual(x.from, { x: 100 + GUMBALL_PX.shaft, y: 100 });
  assert.deepEqual(x.head[0], { x: 100 + GUMBALL_PX.arrow, y: 100 });
  const y = straight.arrows.find((a) => a.axis === 1)!;
  assert.deepEqual(y.head[0], { x: 100, y: 100 + GUMBALL_PX.arrow });
  assert.deepEqual(straight.tips.map((t) => [t.axis, t.at.x, t.at.y]).sort(), [[0, 100 + GUMBALL_PX.tip, 100], [1, 100, 100 + GUMBALL_PX.tip]]);
  // Only the square across Z - in X and Y - faces the eye; the other two are edge on.
  assert.deepEqual(straight.planes.map((p) => p.axis), [2]);
  const low = GUMBALL_PX.plane - GUMBALL_PX.planeHalf;
  assert.deepEqual(straight.planes[0].corners[0], { x: 100 + low, y: 100 + low });
  // Every arc is a quarter turn from one of the other axes to the next: Z's from X to Y.
  assert.equal(straight.arcs.length, 3);
  const z = straight.arcs.find((a) => a.axis === 2)!.points;
  near(z[0].x, 100 + GUMBALL_PX.arc, 'Z arc starts on X');
  near(z[z.length - 1].y, 100 + GUMBALL_PX.arc, 'and ends on Y');

  // Zoomed in twice, the gumball is half as big on the page, and as big on the screen.
  const zoomed = gumballLayout(object([0, 0, 0]), 2);
  assert.deepEqual(zoomed.arrows.find((a) => a.axis === 0)!.head[0], { x: 100 + GUMBALL_PX.arrow / 2, y: 100 });

  // Turned 90 degrees about Y, X points away from the eye and Z to the right.
  const turned = gumballLayout(object([0, 90, 0]), 1);
  assert.deepEqual(turned.arrows.map((a) => a.axis).sort(), [1, 2]);
  assert.equal(turned.away[0], true);
  const zArrow = turned.arrows.find((a) => a.axis === 2)!;
  near(zArrow.head[0].x, 100 + GUMBALL_PX.arrow, 'Z points right');
  near(zArrow.head[0].y, 100, 'level');

  // Off-Axis Front shows all three, each shortened as it turns toward the eye or away.
  const front = gumballLayout(object([-18, -26, 8]), 1);
  assert.equal(front.arrows.length, 3);
  assert.equal(front.planes.length, 3);
  for (const axis of [0, 1, 2]) assert.ok(Math.hypot(front.axes[axis].x, front.axes[axis].y) < 1);
});

test('a press takes the ball first, then a box, an arrow, a square, an arc and the ring: where an arc ends on an arrow, the arrow has it', () => {
  const layout = gumballLayout(object([0, 0, 0]), 1);
  const hit = (x: number, y: number) => gumballHit(layout, { x, y });
  assert.deepEqual(hit(100, 100), { kind: 'center' });
  assert.deepEqual(hit(100 + GUMBALL_PX.tip, 100), { kind: 'tip', axis: 0 });
  // Z's arc starts on the X arrow's shaft: the arrow takes it.
  assert.deepEqual(hit(100 + GUMBALL_PX.arc, 100), { kind: 'arrow', axis: 0 });
  assert.deepEqual(hit(100 + GUMBALL_PX.arc, 103), { kind: 'arrow', axis: 0 });
  assert.deepEqual(hit(100 + GUMBALL_PX.plane, 100 + GUMBALL_PX.plane), { kind: 'plane', axis: 2 });
  const r = GUMBALL_PX.arc * Math.SQRT1_2;
  assert.deepEqual(hit(100 + r, 100 + r), { kind: 'arc', axis: 2 });
  assert.deepEqual(hit(100 + GUMBALL_PX.ring, 100), { kind: 'ring' });
  assert.deepEqual(hit(100 - GUMBALL_PX.ring - 2, 100), { kind: 'ring' });
  assert.equal(hit(300, 300), null);
  assert.equal(hit(100 + 160, 100), null);
  // Every grip a check aims at takes its own handle.
  for (const grip of gumballGrips(gumballLayout(object([-18, -26, 8]), 1.5))) {
    assert.ok(sameHandle(gumballHit(gumballLayout(object([-18, -26, 8]), 1.5), grip.at), grip.handle), JSON.stringify(grip));
  }
});

test('an arrow moves along its axis, a square in its plane and the ball across the view, the grip staying under the pointer', () => {
  // X points right: a drag right and down moves it right only.
  assert.deepEqual(drag(object([0, 0, 0]), { kind: 'arrow', axis: 0 }, { x: 140, y: 100 }, { x: 170, y: 130 }).position, [30, 0, 0]);
  // Turned a quarter about Z, X points down.
  const down = drag(object([0, 0, 90]), { kind: 'arrow', axis: 0 }, { x: 100, y: 140 }, { x: 120, y: 165 });
  near(down.position[0], 0, 'none across');
  near(down.position[1], 25, 'down');
  // Off-Axis Front: the arrow moves the solid along its own X - every coordinate - and its middle follows the pointer along the axis's line.
  const front = object([-18, -26, 8]);
  const grip = gumballGrips(gumballLayout(front, 1)).find((g) => sameHandle(g.handle, { kind: 'arrow', axis: 0 }))!.at;
  const layout = gumballLayout(front, 1);
  const along = { x: layout.axes[0].x * 30, y: layout.axes[0].y * 30 };
  const moved = drag(front, { kind: 'arrow', axis: 0 }, grip, { x: grip.x + along.x, y: grip.y + along.y });
  const axis = [front.view.rotation[0], front.view.rotation[3], front.view.rotation[6]];
  const s = moved.position[0] / axis[0];
  for (const i of [0, 1, 2]) near(moved.position[i], axis[i] * s, `along X, ${i}`, 0.01);
  near(s, 30, 'as far as the arrow on the page is long', 0.02);

  // The square across Z moves it in X and Y.
  assert.deepEqual(drag(object([0, 0, 0]), { kind: 'plane', axis: 2 }, { x: 124, y: 124 }, { x: 144, y: 109 }).position, [20, -15, 0]);
  // The ball moves it across the view whatever the turn.
  assert.deepEqual(drag(front, { kind: 'center' }, { x: 100, y: 100 }, { x: 110, y: 95 }).position, [10, -5, 0]);

  // Through a pinhole the middle follows the pointer exactly: 100 nearer the eye, it moves 3/4 as far as the pointer does.
  const close = object([0, 0, 0], [0, 0, 100], [1, 1, 1], 400);
  const at = projectPoint(close.view, close.view.origin);
  const pinhole = drag(close, { kind: 'arrow', axis: 0 }, { x: at.x + 40, y: at.y }, { x: at.x + 80, y: at.y });
  near(pinhole.position[0], 30, 'a pinhole step');
  assert.deepEqual(pinhole.position.slice(1), [0, 100]);
});

test('an arc turns the solid about its axis, Shift in steps of 15 degrees; the ring turns it freely, a radius a radian', () => {
  const r = GUMBALL_PX.arc;
  const on = (degrees: number) => ({ x: 100 + r * Math.cos((degrees * Math.PI) / 180), y: 100 + r * Math.sin((degrees * Math.PI) / 180) });
  const arc: GumballHandle = { kind: 'arc', axis: 2 };
  assert.deepEqual(drag(object([0, 0, 0]), arc, on(45), on(75)).rotation, [0, 0, 30]);
  assert.deepEqual(drag(object([0, 0, 0]), arc, on(45), on(52), { shift: true, alt: false }).rotation, [0, 0, 0]);
  assert.deepEqual(drag(object([0, 0, 0]), arc, on(45), on(65), { shift: true, alt: false }).rotation, [0, 0, 15]);
  // Round past the half turn, step by step, the angle keeps counting.
  let state = startGumballDrag(object([0, 0, 0]), arc, on(0), 1);
  for (const degrees of [60, 120, 170, 200]) state = dragGumball(state, on(degrees), NO_KEYS);
  assert.deepEqual(state.fields.rotation, [0, 0, -160]);

  // About the solid's own Y, from Off-Axis Front: the turn is the start turned about that axis.
  const front = object([-18, -26, 8]);
  const grip = gumballGrips(gumballLayout(front, 1)).find((g) => sameHandle(g.handle, { kind: 'arc', axis: 1 }))!.at;
  const turned = drag(front, { kind: 'arc', axis: 1 }, grip, { x: grip.x + 6, y: grip.y - 9 });
  const a = rotationMatrix(front.rotation);
  const b = rotationMatrix(turned.rotation);
  // Y, the turn's axis, stays where it was.
  for (const i of [0, 1, 2]) near(b[i * 3 + 1], a[i * 3 + 1], `Y axis ${i}`, 1e-3);
  assert.notDeepEqual(turned.rotation, front.rotation);

  // Seen edge on - X's arc with no turn - a drag along it is read along its tangent: toward Y from Z is less.
  const edge = drag(object([0, 0, 0]), { kind: 'arc', axis: 0 }, { x: 100, y: 130 }, { x: 100, y: 140 });
  assert.ok(edge.rotation[0] < 0 && edge.rotation[1] === 0 && edge.rotation[2] === 0, JSON.stringify(edge.rotation));

  // The ring: a drag right turns the front right, about Y; a drag down turns it down, about X.
  const right = (GUMBALL_PX.ring * Math.PI) / 6;
  const rolled = drag(object([0, 0, 0]), { kind: 'ring' }, { x: 100 + GUMBALL_PX.ring, y: 100 }, { x: 100 + GUMBALL_PX.ring + right, y: 100 });
  for (const [i, v] of [0, 30, 0].entries()) near(rolled.rotation[i], v, `ring right ${i}`, 0.01);
  for (const [i, v] of trackballTurn([0, 0, 0], 0, right, GUMBALL_PX.ring).entries()) near(v, [-30, 0, 0][i], `ring down ${i}`, 1e-9);
});

test('a box scales along its axis, Alt and a square in its plane, Shift and the ball the whole solid, each held to 1% and 10000%', () => {
  assert.deepEqual(drag(object([0, 0, 0]), { kind: 'tip', axis: 0 }, { x: 184, y: 100 }, { x: 226, y: 100 }).scale, [1.5, 1, 1]);
  assert.deepEqual(drag(object([0, 0, 0], [0, 0, 0], [2, 1, 1]), { kind: 'tip', axis: 0 }, { x: 184, y: 100 }, { x: 0, y: 100 }).scale, [0.01, 1, 1]);
  assert.deepEqual(drag(object([0, 0, 0]), { kind: 'plane', axis: 2 }, { x: 124, y: 124 }, { x: 148, y: 148 }, { shift: false, alt: true }).scale, [2, 2, 1]);
  assert.deepEqual(drag(object([0, 0, 0]), { kind: 'center' }, { x: 100, y: 100 }, { x: 150, y: 100 }, { shift: true, alt: false }).scale, [1.4142, 1.4142, 1.4142]);
  // Up is bigger too, and the whole scale stays whole where one axis meets its limit.
  const whole = drag(object([0, 0, 0], [0, 0, 0], [50, 1, 1]), { kind: 'center' }, { x: 100, y: 100 }, { x: 100, y: -200 }, { shift: true, alt: false }).scale;
  assert.deepEqual(whole, [100, 2, 2]);
});

test('Escape gives the fields back as the press found them; a press that has not moved changes nothing', () => {
  const start = object([-18, -26, 8], [5, 6, 7], [1, 2, 3]);
  const held = startGumballDrag(start, { kind: 'ring' }, { x: 204, y: 100 }, 1);
  assert.equal(gumballMoved(held), false);
  assert.equal(gumballMoved(dragGumball(held, { x: 204, y: 100 }, NO_KEYS)), false);
  const moved = dragGumball(held, { x: 260, y: 140 }, NO_KEYS);
  assert.equal(gumballMoved(moved), true);
  assert.deepEqual(cancelGumballDrag(moved), { rotation: [-18, -26, 8], position: [5, 6, 7], scale: [1, 2, 3] });
});

test('a turn read back from its matrix is the one given, the nearer of its two names; at Y 90 degrees Z keeps its own', () => {
  for (const rotation of [
    [0, 0, 0],
    [-18, -26, 8],
    [170, -60, 45],
    [-90, 45, -170],
    [10, 120, 30],
  ] as [number, number, number][]) {
    const back = eulerOf(rotationMatrix(rotation), rotation);
    for (const i of [0, 1, 2]) near(back[i], rotation[i], `${rotation} ${i}`, 1e-6);
  }
  assert.deepEqual(eulerOf(rotationMatrix([20, 90, 10]), [0, 0, 10]).map((v) => Math.round(v * 1e6) / 1e6), [20, 90, 10]);
  assert.deepEqual(eulerOf(rotationMatrix([20, -90, 10]), [0, 0, 10]).map((v) => Math.round(v * 1e6) / 1e6), [20, -90, 10]);
});

test('index.html has every part 3D Options looks for, a panel that stays up; the settings window has its switch', () => {
  const html = readFileSync(resolve(repoRoot(), 'src', 'renderer', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="three-d-dialog"');
  assert.ok(start >= 0, 'there is a #three-d-dialog');
  const panel = html.slice(start, html.indexOf('<!--', start));
  for (const part of THREE_D_PANEL_PARTS) assert.ok(panel.includes(`id="${part}"`), `#three-d-dialog has #${part}`);
  assert.ok(panel.includes('data-panel="persistent"'), 'the panel is no dialog in the way of Move and Rotate');
  assert.ok(panel.includes('class="export-dialog is-hidden"'), 'it starts hidden');
  const settings = readFileSync(resolve(repoRoot(), 'src', 'renderer', 'settings.html'), 'utf8');
  assert.match(settings, /id="show-3d-gumball" type="checkbox"/);
});
