/**
 * Rotate tool tests: the angle primitives a rotate drag is built out of, and
 * the store operation the dialog and the drag both commit through.
 *
 * The sign convention is the one thing every other test here leans on: the
 * canvas y axis grows downward, so a positive angle turns clockwise on screen
 * and a negative one counterclockwise, and the number a field shows is the
 * same number a drag measured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRotation,
  rotateAbout,
  rotationStep,
  rotationTrig,
  snapRotation,
} from '../src/sharpen/geometry.js';
import { createSketchBook, DEFAULT_NIB_ANGLE, type Stroke } from '../src/core/types.js';
import { Store } from '../src/renderer/store.js';

/**
 * Rounds away the float dust a quarter turn through sin/cos leaves behind.
 * A coordinate that lands on zero from below rounds to -0, which is the same
 * place but not the same value to a deep-equal, so it is folded back.
 */
function near(value: number): number {
  const rounded = Number(value.toFixed(9));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function pointsOf(stroke: Stroke): Array<[number, number]> {
  return stroke.points.map((p) => [near(p.x), near(p.y)]);
}

// ---- Angle primitives -------------------------------------------------------

test('a positive angle turns clockwise on a downward y axis', () => {
  const trig = rotationTrig(90);
  // A point due right of the centre lands directly below it, which is where a
  // clockwise quarter turn puts it on screen.
  const turned = rotateAbout({ x: 10, y: 0 }, 0, 0, trig);
  assert.equal(near(turned.x), 0);
  assert.equal(near(turned.y), 10);
});

test('a negative angle turns counterclockwise', () => {
  const turned = rotateAbout({ x: 10, y: 0 }, 0, 0, rotationTrig(-90));
  assert.equal(near(turned.x), 0);
  assert.equal(near(turned.y), -10);
});

test('rotation is about the given centre, not the origin', () => {
  const turned = rotateAbout({ x: 110, y: 100 }, 100, 100, rotationTrig(180));
  assert.equal(near(turned.x), 90);
  assert.equal(near(turned.y), 100);
});

test('normalizeRotation reduces to one turn and keeps the direction', () => {
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(-90), -90);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-540), -180);
  assert.equal(normalizeRotation(360), 0);
  // A drag that lands exactly back where it started reads as zero, not "-0".
  assert.ok(Object.is(normalizeRotation(-360), 0));
  assert.equal(normalizeRotation(Number.NaN), 0);
});

test('snapRotation lands on the nearest step, and a step of zero snaps nothing', () => {
  assert.equal(snapRotation(7, 15), 0);
  assert.equal(snapRotation(8, 15), 15);
  assert.equal(snapRotation(-97, 15), -90);
  assert.equal(snapRotation(43.7, 0), 43.7);
  assert.equal(snapRotation(43.7, -15), 43.7);
});

test('rotationStep takes the shortest way round, so a drag crosses the seam', () => {
  assert.equal(rotationStep(10, 20), 10);
  // Half a turn is where the bearing flips sign; the step has to read as a
  // small move, not as a jump nearly all the way back round.
  assert.equal(rotationStep(179, -179), 2);
  assert.equal(rotationStep(-179, 179), -2);
  // Exactly half a turn is the one bearing that is the same distance either
  // way round; the tie goes counterclockwise. A drag never samples that far
  // apart in practice, so this is a documented tie-break, not a real case.
  assert.equal(rotationStep(0, 180), -180);
});

test('summed steps count a second lap as a second lap', () => {
  // A drag sampled a sixth of a turn at a time, twice round.
  let total = 0;
  let bearing = 0;
  for (let i = 1; i <= 12; i++) {
    const next = normalizeRotation(i * 60);
    total += rotationStep(bearing, next);
    bearing = next;
  }
  assert.equal(near(total), 720);
  // What the field would show: two laps have turned the shape nowhere.
  assert.equal(near(normalizeRotation(total)), 0);
});

// ---- Store operation --------------------------------------------------------

function stroke(id: string, patch: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#1f2328',
    width: 3,
    points: [
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
    ...patch,
  };
}

/** A store holding one page with the given strokes on its first layer. */
function storeWith(...strokes: Stroke[]): Store {
  const book = createSketchBook('t');
  book.sketches[0].strokes = strokes;
  return new Store(book);
}

test('rotateStrokes turns sampled points about the centre', () => {
  const store = storeWith(stroke('a'));
  store.rotateStrokes(['a'], 90, 0, 0);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [0, 10],
    [0, 20],
  ]);
});

test('rotateStrokes leaves everything it was not given alone', () => {
  const store = storeWith(stroke('a'), stroke('b'));
  store.rotateStrokes(['a'], 90, 0, 0);
  assert.deepEqual(pointsOf(store.sketch.strokes[1]), [
    [10, 0],
    [20, 0],
  ]);
});

test('four quarter turns bring a stroke back where it started', () => {
  const store = storeWith(stroke('a'));
  for (let i = 0; i < 4; i++) store.rotateStrokes(['a'], 90, 7, -3);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [10, 0],
    [20, 0],
  ]);
});

test('a whole turn is no rotation at all, and takes no history step', () => {
  const store = storeWith(stroke('a'));
  store.rotateStrokes(['a'], 360, 0, 0);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [10, 0],
    [20, 0],
  ]);
  // Nothing was pushed, so undo has nothing of this to take back.
  store.undo();
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [10, 0],
    [20, 0],
  ]);
});

test('a committed rotation is one undo step; a preview leaves no history', () => {
  const store = storeWith(stroke('a'));
  store.rotateStrokes(['a'], 90, 0, 0);
  store.undo();
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [10, 0],
    [20, 0],
  ]);

  // What a live preview does: turn, and turn back, with no history behind it.
  store.rotateStrokes(['a'], 30, 0, 0, false);
  store.rotateStrokes(['a'], -30, 0, 0, false);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [10, 0],
    [20, 0],
  ]);
});

test('Bezier anchors and both tangent handles turn with the path', () => {
  const store = storeWith(
    stroke('a', {
      vector: {
        anchors: [
          { p: { x: 10, y: 0 }, hOut: { x: 14, y: 0 } },
          { p: { x: 20, y: 0 }, hIn: { x: 16, y: 0 } },
        ],
      },
    }),
  );
  store.rotateStrokes(['a'], 90, 0, 0);
  const vector = store.sketch.strokes[0].vector;
  assert.ok(vector);
  assert.deepEqual([near(vector.anchors[0].p.x), near(vector.anchors[0].p.y)], [0, 10]);
  assert.deepEqual(
    [near(vector.anchors[0].hOut!.x), near(vector.anchors[0].hOut!.y)],
    [0, 14],
  );
  assert.deepEqual([near(vector.anchors[1].hIn!.x), near(vector.anchors[1].hIn!.y)], [0, 16]);
});

test("a Copic stroke's broad nib keeps its bearing relative to the mark", () => {
  const store = storeWith(stroke('a', { tool: 'copic' }), stroke('b', { tool: 'copic', nibAngle: 350 }));
  store.rotateStrokes(['a', 'b'], 90, 0, 0);
  assert.equal(store.sketch.strokes[0].nibAngle, DEFAULT_NIB_ANGLE + 90);
  // The nib angle stays inside one turn rather than climbing past 360.
  assert.equal(store.sketch.strokes[1].nibAngle, 80);
});

test('a pen stroke gains no nib angle from being rotated', () => {
  const store = storeWith(stroke('a'));
  store.rotateStrokes(['a'], 90, 0, 0);
  assert.equal(store.sketch.strokes[0].nibAngle, undefined);
});

test('an image orbits the centre by its middle and stays upright', () => {
  const store = storeWith(
    stroke('img', {
      tool: 'image',
      image: 'data:image/png;base64,',
      imageWidth: 20,
      imageHeight: 10,
      points: [{ x: 90, y: 95 }],
    }),
  );
  // Its middle sits at (100, 100), which is the centre, so a turn about that
  // point moves it nowhere at all.
  store.rotateStrokes(['img'], 90, 100, 100);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [[90, 95]]);

  // Turned about the origin instead, the middle swings to (-100, 100) and the
  // box - still upright, still 20 by 10 - hangs off it the same way.
  store.rotateStrokes(['img'], 90, 0, 0);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [[-110, 95]]);
  assert.equal(store.sketch.strokes[0].imageWidth, 20);
  assert.equal(store.sketch.strokes[0].imageHeight, 10);
});

test('a text item orbits by its anchor and keeps its size', () => {
  const store = storeWith(
    stroke('t', { tool: 'text', text: 'hi', fontSize: 24, points: [{ x: 10, y: 0 }] }),
  );
  store.rotateStrokes(['t'], 90, 0, 0);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [[0, 10]]);
  assert.equal(store.sketch.strokes[0].fontSize, 24);
});

test('a rotation with no finite angle or centre does nothing', () => {
  const store = storeWith(stroke('a'));
  store.rotateStrokes(['a'], Number.NaN, 0, 0);
  store.rotateStrokes(['a'], 90, Number.NaN, 0);
  store.rotateStrokes(['a'], 90, 0, Number.POSITIVE_INFINITY);
  store.rotateStrokes(['missing'], 90, 0, 0);
  assert.deepEqual(pointsOf(store.sketch.strokes[0]), [
    [10, 0],
    [20, 0],
  ]);
});
