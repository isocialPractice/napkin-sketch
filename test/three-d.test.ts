/**
 * 3D: the meshes (core/three-d/mesh.ts), their drawing (core/three-d/render.ts)
 * and the effect as every output draws it (core/geometry-effects.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extrudeMesh, revolveMesh, revolveStepCount, signedArea, triangulate, type Vec2 } from '../src/core/three-d/mesh.js';
import { buildSolid, DRAFT_REVOLVE_STEPS, projectPoint, render3d, renderSolid, rotationMatrix, viewPoint, type Paint3d, type ThreeDEffect } from '../src/core/three-d/render.js';
import { defaultEffect, readEffect, activeEffects, type Effect } from '../src/core/effects.js';
import { effectName, effectsAfterTransform, expandAppearance, markEffectPlan, withEffectField, geometryShape } from '../src/core/appearance.js';
import { drawnMarks, geometryOf, setThreeDDrafts, threeDBuildOf } from '../src/core/geometry-effects.js';
import { strokeBounds } from '../src/core/bounds.js';
import { hitMark } from '../src/core/hit-test.js';
import { sketchToSvg } from '../src/core/sketch-svg.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { sketchesToJsx } from '../src/core/illustrator.js';
import { sketchToComposition } from '../src/core/sketch-composition.js';
import { rasterizeComposition } from '../src/core/graphic-design/index.js';
import { evaluate, formatDiagnostic, formatScript } from '../src/core/script/index.js';
import { sketchToInstructions } from '../src/core/script/writer.js';
import { createSketchBook, type Layer, type Sketch, type Stroke } from '../src/core/types.js';
import { SCRIPT_FIXTURES } from './helpers/script-fixtures.js';

const TIME = '2026-10-02T00:00:00.000Z';

const ring = (pts: Array<[number, number]>): Vec2[] => pts.map(([x, y]) => ({ x, y }));
const areaOf = (points: Vec2[], tris: Array<[number, number, number]>): number =>
  tris.reduce((sum, [a, b, c]) => sum + Math.abs(signedArea([points[a], points[b], points[c]])) / 2, 0);

const effect3d = (extra: Partial<ThreeDEffect> = {}): ThreeDEffect => ({ ...defaultEffect('3d'), ...extra }) as ThreeDEffect;
const paint: Paint3d = { base: [100, 150, 200], edge: null };

// ---- Triangulation ----------------------------------------------------------------------

test('a square, an A with its counter and a concave star triangulate to exactly their area', () => {
  const square = ring([[0, 0], [10, 0], [10, 10], [0, 10]]);
  const s = triangulate(square);
  assert.equal(s.triangles.length, 2);
  assert.ok(Math.abs(areaOf(s.points, s.triangles) - 100) < 1e-9);

  // An A: its outline, and the triangular counter left open.
  const outer = ring([[0, 100], [40, 0], [60, 0], [100, 100], [80, 100], [70, 70], [30, 70], [20, 100]]);
  const counter = ring([[35, 55], [65, 55], [50, 20]]).reverse();
  const a = triangulate(outer, [counter]);
  const expected = Math.abs(signedArea(outer)) / 2 - Math.abs(signedArea(counter)) / 2;
  assert.ok(Math.abs(areaOf(a.points, a.triangles) - expected) < 1e-6, `${areaOf(a.points, a.triangles)} against ${expected}`);
  // No triangle covers the counter's middle.
  const inside = (p: Vec2, [u, v, w]: Vec2[]): boolean => {
    const d = (a1: Vec2, b1: Vec2): number => (b1.x - a1.x) * (p.y - a1.y) - (b1.y - a1.y) * (p.x - a1.x);
    const [d1, d2, d3] = [d(u, v), d(v, w), d(w, u)];
    return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
  };
  assert.ok(!a.triangles.some((t) => inside({ x: 50, y: 45 }, t.map((i) => a.points[i]))), 'the counter stays open');

  // A five-pointed star, concave at every inner corner.
  const star: Vec2[] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 50 : 20;
    const t = (k * Math.PI) / 5 - Math.PI / 2;
    star.push({ x: 60 + r * Math.cos(t), y: 60 + r * Math.sin(t) });
  }
  const st = triangulate(signedArea(star) > 0 ? star : star.slice().reverse());
  assert.equal(st.triangles.length, 8, 'n - 2 triangles');
  assert.ok(Math.abs(areaOf(st.points, st.triangles) - Math.abs(signedArea(star)) / 2) < 1e-6);
});

// ---- Meshes -----------------------------------------------------------------------------------

test('an extrusion has two caps and a side an edge; hollow, the sides alone; an open path, a ribbon', () => {
  const square = { rings: [ring([[0, 0], [10, 0], [10, 10], [0, 10]])], closed: true };
  const solid = extrudeMesh(square, 20, true);
  assert.equal(solid.faces.filter((f) => f.kind === 'cap').length, 2);
  assert.equal(solid.faces.filter((f) => f.kind === 'side').length, 4);
  assert.equal(solid.closed, true);
  for (const z of solid.vertices.map((v) => v[2])) assert.ok(z === 10 || z === -10, 'centered on the page, 20 deep');
  // Every side faces out: away from the square's middle.
  for (const side of solid.faces.filter((f) => f.kind === 'side')) {
    const mid = side.rings[0].reduce((s, i) => [s[0] + solid.vertices[i][0] / 4, s[1] + solid.vertices[i][1] / 4], [0, 0]);
    assert.ok((mid[0] - 5) * side.normal[0] + (mid[1] - 5) * side.normal[1] > 0, 'a side faces out');
  }
  const hollow = extrudeMesh(square, 20, false);
  assert.equal(hollow.faces.length, 4);
  assert.equal(hollow.closed, false, 'seen from both sides');
  const ribbon = extrudeMesh({ rings: [ring([[0, 0], [10, 0], [10, 10]])], closed: false }, 5, true, false);
  assert.equal(ribbon.faces.length, 2);
});

test('a full revolve closes on itself with no second seam; a part turn with caps is a closed solid', () => {
  const profile = { rings: [ring([[10, 0], [20, 10], [10, 20]])], closed: false };
  const full = revolveMesh(profile, { angle: 360, offset: 0, axis: 'left', segments: 16, caps: true }, 0.5, false);
  assert.equal(full.vertices.length, 16 * 3, 'a ring of the profile a step, and none again at 360');
  assert.equal(full.faces.length, 16 * 2);
  const square = { rings: [ring([[10, 0], [20, 0], [20, 10], [10, 10]])], closed: true };
  const part = revolveMesh(square, { angle: 90, offset: 5, axis: 'left', segments: 6, caps: true }, 0.5);
  assert.equal(part.closed, true);
  assert.equal(part.faces.filter((f) => f.kind === 'cap').length, 2);
  assert.equal(part.faces.filter((f) => f.kind === 'side').length, 6 * 4);
  // The axis stands `offset` off the left edge: the profile's nearest point is 5 from it.
  const radii = part.vertices.map((v) => Math.hypot(v[0] - 5, v[2]));
  assert.ok(Math.abs(Math.min(...radii) - 5) < 1e-9 && Math.abs(Math.max(...radii) - 15) < 1e-9);
});

// ---- Drawing ------------------------------------------------------------------------------------

test('a straight view draws a point where it is; perspective draws the near side bigger', () => {
  const square = { rings: [ring([[0, 0], [100, 0], [100, 100], [0, 100]])], closed: true };
  const solid = buildSolid(extrudeMesh(square, 100, true));
  const front = (faces: ReturnType<typeof renderSolid>): Vec2[] => faces[faces.length - 1].points[0];
  const straight = renderSolid(solid, effect3d({ rotation: [0, 0, 0] }), paint);
  assert.equal(straight.length, 1, 'square on, only the front shows');
  assert.deepEqual(front(straight).map((p) => [Math.round(p.x), Math.round(p.y)]).sort(), [[0, 0], [0, 100], [100, 0], [100, 100]].sort());
  // The cube's middle is (50, 50, 0); with perspective the front, 50 nearer, is drawn bigger about it.
  const wide = renderSolid(solid, effect3d({ rotation: [0, 0, 0], perspective: 60 }), paint);
  const xs = front(wide).map((p) => p.x);
  const radius = Math.hypot(50, 50, 50);
  const focal = radius / Math.sin(Math.PI / 6);
  const k = focal / (focal - 50);
  assert.ok(Math.abs(Math.max(...xs) - (50 + 50 * k)) < 1e-6, `${Math.max(...xs)} against ${50 + 50 * k}`);
  // Through a pinhole square in front of it, the sides hide behind the front, which is drawn bigger.
  assert.equal(wide.length, 1);
});

test('a closed solid shows no face turned away; a hollow one shows the inside too', () => {
  const square = { rings: [ring([[0, 0], [100, 0], [100, 100], [0, 100]])], closed: true };
  const solid = buildSolid(extrudeMesh(square, 100, true));
  assert.equal(renderSolid(solid, effect3d({ rotation: [0, 45, 0] }), paint).length, 2, 'the front and one side');
  assert.equal(renderSolid(solid, effect3d({ rotation: [-30, 45, 0] }), paint).length, 3, 'and the top');
  const hollow = buildSolid(extrudeMesh(square, 100, false));
  assert.equal(renderSolid(hollow, effect3d({ rotation: [-30, 45, 0] }), paint).length, 4, 'every side, inside and out');
});

test('faces come far first: an open box turned 45 degrees draws its back sides before its front ones', () => {
  const square = { rings: [ring([[0, 0], [100, 0], [100, 100], [0, 100]])], closed: true };
  const mesh = extrudeMesh(square, 100, false);
  const solid = buildSolid(mesh);
  const view = effect3d({ rotation: [-20, 45, 0] });
  const faces = renderSolid(solid, view, paint);
  // Each drawn face's depth: the mean z of the mesh face it is, turned as the view turns.
  const m = rotationMatrix(view.rotation);
  const depthOf = (index: number): number => {
    const ids = mesh.faces[index].rings[0];
    return ids.reduce((s, i) => {
      const v = mesh.vertices[i];
      const c = [v[0] - 50, v[1] - 50, v[2]];
      return s + (m[6] * c[0] + m[7] * c[1] + m[8] * c[2]) / ids.length;
    }, 0);
  };
  const centroidOf = (pts: Vec2[]): Vec2 => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
  const projected = mesh.faces.map((face) => {
    const pts = face.rings[0].map((i) => {
      const v = mesh.vertices[i];
      const c = [v[0] - 50, v[1] - 50, v[2]];
      return { x: m[0] * c[0] + m[1] * c[1] + m[2] * c[2] + 50, y: m[3] * c[0] + m[4] * c[1] + m[5] * c[2] + 50 };
    });
    return centroidOf(pts);
  });
  const order = faces.map((face) => {
    const c = centroidOf(face.points[0]);
    let best = 0;
    projected.forEach((p, i) => {
      if (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(projected[best].x - c.x, projected[best].y - c.y)) best = i;
    });
    return depthOf(best);
  });
  // The two far sides, behind the box's middle, come before the two near ones; which of two
  // sides meeting at a corner comes first does not matter, as neither covers the other.
  const lastFar = Math.max(...order.map((z, i) => (z < 0 ? i : -1)));
  const firstNear = Math.min(...order.map((z, i) => (z > 0 ? i : Infinity)));
  assert.ok(order.length === 4 && lastFar < firstNear, `far sides first: ${order.join(', ')}`);
});

test('Diffuse lights a face toward the light fully and one away by the ambient light alone; Plastic adds a white highlight', () => {
  const square = { rings: [ring([[0, 0], [100, 0], [100, 100], [0, 100]])], closed: true };
  const solid = buildSolid(extrudeMesh(square, 20, true));
  const colorOf = (extra: Partial<ThreeDEffect>): string | null => {
    const faces = renderSolid(solid, effect3d({ rotation: [0, 0, 0], ...extra }), paint);
    return faces[faces.length - 1].color;
  };
  const light = { azimuth: 0, elevation: 90, intensity: 0.6, ambient: 0.4 };
  assert.equal(colorOf({ shading: 'diffuse', light }), '#6496c8', 'toward the light: the base color');
  assert.equal(colorOf({ shading: 'diffuse', light: { ...light, elevation: -90 } }), '#283c50', 'away from it: the ambient share');
  assert.equal(colorOf({ shading: 'none', light: { ...light, elevation: -90 } }), '#6496c8', 'No Shading: flat');
  const plastic = colorOf({ shading: 'plastic', light });
  assert.ok(plastic && parseInt(plastic.slice(1, 3), 16) > 200, `a highlight where the light falls square on: ${plastic}`);
  const wire = renderSolid(solid, effect3d({ shading: 'wireframe' }), paint);
  assert.ok(wire.length === 6 && wire.every((face) => face.color === null && face.stroke), 'Wireframe: every edge, no fill');
});

// ---- The effect ------------------------------------------------------------------------------

/** A filled square mark, 100 across at (100, 100). */
const card = (effects: Effect[] | undefined, extra: Partial<Stroke> = {}): Stroke => ({
  id: 'card',
  layer: 'ly_card',
  tool: 'pen',
  color: '#1f2328',
  width: 2,
  fill: '#2f6feb',
  points: [[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]].map(([x, y]) => ({ x, y, pressure: 0.5 })),
  vector: { anchors: [[100, 100], [200, 100], [200, 200], [100, 200]].map(([x, y]) => ({ p: { x, y } })), closed: true },
  ...(effects ? { effects } : {}),
  ...extra,
});

const pageOf = (strokes: Stroke[]): Sketch => {
  const book = createSketchBook('three-d');
  const sketch = book.sketches[0];
  sketch.background = '#ffffff';
  sketch.sizeMode = 'sized';
  sketch.width = 320;
  sketch.height = 320;
  sketch.layers = strokes.map((s): Layer => ({ id: s.layer ?? `ly_${s.id}`, name: s.id, opacity: 1, visible: true, locked: false }));
  sketch.strokes = strokes;
  return sketch;
};

test('a 3D effect reads with its defaults - Off-Axis Front, 50 deep, Plastic - and is no raster effect', () => {
  const read = readEffect({ type: '3d' }) as ThreeDEffect;
  assert.deepEqual(read.rotation, [-18, -26, 8]);
  assert.equal(read.depth, 50);
  assert.equal(read.shading, 'plastic');
  assert.equal(read.caps, true);
  assert.equal((readEffect({ type: '3d', rotation: [190, 0, 0] }) as ThreeDEffect).rotation[0], -170, 'a turn held to -180 to 180');
  assert.equal(readEffect({ type: '3d', rotation: [1, 2] }), null, 'three numbers or none');
  assert.equal(activeEffects([defaultEffect('3d')]), undefined);
  assert.equal(effectName(effect3d({ kind: 'revolve' })), '3D: Revolve');
  const turned = withEffectField(effect3d(), 'rotation.1', 40) as ThreeDEffect;
  assert.deepEqual(turned.rotation, [-18, 40, 8], 'a turn set by its axis, the others kept');
  assert.ok(Array.isArray(turned.rotation));
  const mirrored = effectsAfterTransform([effect3d({ kind: 'revolve' })], { flipX: true })[0] as ThreeDEffect;
  assert.deepEqual([mirrored.rotation, mirrored.axis], [[-18, 26, -8], 'right'], 'a mirror mirrors the view and the axis');
});

test('a 3D mark is its faces: one picture, found and measured where they are', () => {
  const mark = card([effect3d()]);
  assert.equal(geometryShape(mark.effects), 'faces');
  assert.equal(markEffectPlan(mark), null, 'solid and with no raster effect, it draws its faces straight');
  assert.equal(markEffectPlan({ ...mark, opacity: 0.5 })?.split, false, 'part see-through, one picture');
  const faces = geometryOf(mark)!.faces!;
  assert.equal(faces.length, 3, 'the front, the top and the right side');
  assert.ok(faces.every((face) => face.fill && face.vector?.closed));
  assert.equal(faces[faces.length - 1].noStroke, undefined, "the front cap takes the mark's stroke");
  assert.equal(faces[faces.length - 1].color, '#1f2328');
  const box = strokeBounds(mark)!;
  assert.ok(box.maxX > 200 && box.minY < 100, `the box takes in the depth: ${JSON.stringify(box)}`);
  // A click on the top face, between its middle and its highest corner, is above the
  // square as it was drawn - and finds the mark there.
  const middles = faces.map((face) => ({ x: face.points.reduce((s, p) => s + p.x, 0) / face.points.length, y: face.points.reduce((s, p) => s + p.y, 0) / face.points.length }));
  const high = middles.reduce((best, p, i) => (p.y < middles[best].y ? i : best), 0);
  const peak = faces[high].points.reduce((a, p) => (p.y < a.y ? p : a));
  const probe = { x: middles[high].x + (peak.x - middles[high].x) * 0.6, y: middles[high].y + (peak.y - middles[high].y) * 0.6 };
  assert.ok(probe.y < 100, `the probe is above the square: ${JSON.stringify(probe)}`);
  assert.equal(hitMark(pageOf([mark]), probe, { tolerancePx: 2, zoom: 1 })?.id, 'card');
  // Text takes none; after a Splatter, 3D builds nothing.
  const text: Stroke = { id: 't', tool: 'text', text: 'Hi', color: '#000', width: 1, points: [{ x: 10, y: 10, pressure: 0.5 }], effects: [effect3d()] };
  assert.equal(geometryOf(text), null);
  const splat = { ...defaultEffect('splatter') } as Effect;
  assert.equal(geometryOf(card([splat, effect3d()]))?.faces, null);
  assert.ok(geometryOf(card([effect3d(), splat]))?.faces, 'built first, it stays built');
});

test('every output draws the faces: the SVG with the mark it stands for, PDF, the Illustrator script and the PNG', () => {
  const sketch = pageOf([card([effect3d()])]);
  const svg = sketchToSvg(sketch);
  const group = svg.split('\n').find((row) => row.includes('data-napkin-faces="1"'))!;
  assert.match(group, /data-d="M100 100H200V200H100V100Z"/, 'the mark as it was, for napkin to read back');
  assert.match(group, /data-fill="#2f6feb"/);
  assert.match(group, /&quot;type&quot;:&quot;3d&quot;/, 'and its live 3D');
  assert.equal((svg.match(/<path d="M[^"]*" fill="#[0-9a-f]{6}"/g) ?? []).length, 3, 'three filled faces');

  const warnings: string[] = [];
  const pdf = sketchesToPdf([sketch], { onWarning: (message: string) => warnings.push(message) });
  assert.equal((pdf.match(/ h f/g) ?? []).length + (pdf.match(/ h B/g) ?? []).length >= 3, true, 'the PDF fills the faces');
  assert.deepEqual(warnings, []);

  const jsx = sketchesToJsx([sketch]);
  assert.match(jsx, /begin\(100\);\n\s+path\(/, 'the Illustrator script builds the faces in a group');
  assert.equal((jsx.match(/fill: \[/g) ?? []).length, 3);

  const { width, data } = rasterizeComposition(sketchToComposition(sketch));
  const pixel = (x: number, y: number): number[] => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  const top = pixel(160, 95);
  assert.ok(top[2] > top[0] + 60, `the PNG paints the top face, blue, above the square: ${top}`);
});

test("the gumball's view is the faces' own: its middle where the move puts it; a draft revolves in fewer steps until the drag lets go", () => {
  // Straight on and turned, the middle the view moves is where the solid's box is.
  const mark = card([effect3d({ rotation: [0, 0, 0], position: [30, -20, 0] })]);
  const built = threeDBuildOf(mark)!;
  assert.equal(built.effect.type, '3d');
  assert.deepEqual(built.view.origin, [180, 130, 0], "the square's middle, moved");
  const box = strokeBounds(mark)!;
  const middle = projectPoint(built.view, built.view.origin);
  assert.ok(Math.abs((box.minX + box.maxX) / 2 - middle.x) < 1.5 && Math.abs((box.minY + box.maxY) / 2 - middle.y) < 1.5, `${JSON.stringify(box)} around ${JSON.stringify(middle)}`);
  // Every corner of a face is a corner of the solid as the view puts it.
  const turned = card([effect3d({ perspective: 50 })]);
  const view = threeDBuildOf(turned)!.view;
  const corners = [100, 200].flatMap((x) => [100, 200].flatMap((y) => [-25, 25].map((z) => projectPoint(view, viewPoint(view, [x, y, z])))));
  for (const face of geometryOf(turned)!.faces!) {
    for (const p of face.points) assert.ok(corners.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 1e-6), `${JSON.stringify(p)} is a corner`);
  }
  // A Warp after the 3D bends the faces the gumball would stand on: it shows none.
  assert.equal(threeDBuildOf(card([effect3d(), { ...defaultEffect('warp') } as Effect])), null);
  assert.equal(threeDBuildOf(card(undefined)), null);

  // A vase's revolve: as many steps as it needs, but no more than a draft's while a drag turns it.
  const vase: Stroke = { id: 'vase', tool: 'pen', color: '#2b8a3e', width: 2, points: [[0, 0], [120, 60], [100, 200]].map(([x, y]) => ({ x, y, pressure: 0.5 })), effects: [effect3d({ kind: 'revolve' })] };
  const outline = { rings: [vase.points.map((p) => ({ x: p.x, y: p.y }))], closed: false };
  const full = revolveStepCount(outline, { angle: 360, offset: 0, axis: 'left', segments: 0, caps: true }, 0.5);
  assert.ok(full > DRAFT_REVOLVE_STEPS, `a wide vase takes many steps: ${full}`);
  const fullFaces = geometryOf(vase)!.faces!.length;
  setThreeDDrafts(['vase']);
  try {
    const draft = geometryOf(vase)!.faces!.length;
    assert.ok(draft < fullFaces, `${draft} draft faces, ${fullFaces} in full`);
  } finally {
    setThreeDDrafts([]);
  }
  assert.equal(geometryOf(vase)!.faces!.length, fullFaces, 'in full again');
});

test('Expand Appearance turns a 3D mark into its faces, a filled mark each, far first', () => {
  const expanded = expandAppearance(card([effect3d(), { type: 'blur', radius: 2 }]))!;
  assert.equal(expanded.marks.length, 3);
  assert.ok(expanded.marks.every((mark) => mark.fill && !mark.effects));
  assert.deepEqual(expanded.effects.map((effect) => effect.type), ['blur'], 'the raster effects go round them');
  assert.deepEqual(drawnMarks(expanded.marks[0]), null, 'a face is a plain mark');
});

test('`effect extrude` and `effect revolve` read every option and write back as little as says it', () => {
  const run = (text: string): Sketch => {
    const result = evaluate(text, { fragment: true, timestamp: TIME, ...SCRIPT_FIXTURES });
    assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
    return result.book.sketches[0];
  };
  const effectOf = (text: string): ThreeDEffect => run(`${text}\nrect 10 10 100 60`).strokes[0].effects?.[0] as ThreeDEffect;
  assert.deepEqual(effectOf('effect extrude'), defaultEffect('3d'));
  const extruded = effectOf('effect extrude 80 rotate 0 30 0 perspective 40 shading diffuse hollow light 90 30 0.8 0.2');
  assert.deepEqual(
    [extruded.depth, extruded.rotation, extruded.perspective, extruded.shading, extruded.caps, extruded.light],
    [80, [0, 30, 0], 40, 'diffuse', false, { azimuth: 90, elevation: 30, intensity: 0.8, ambient: 0.2 }],
  );
  const revolved = effectOf('effect revolve angle 270 offset 12 axis right segments 24 position 5 0 0 scale 1 1 2');
  assert.deepEqual([revolved.kind, revolved.angle, revolved.offset, revolved.axis, revolved.segments, revolved.position, revolved.scale], ['revolve', 270, 12, 'right', 24, [5, 0, 0], [1, 1, 2]]);
  const written = formatScript(sketchToInstructions(run('effect extrude 80 rotate 0 30 0\nrect 10 10 100 60\neffect revolve angle 270\nrect 150 10 50 60')).script);
  assert.match(written, /^effect extrude 80 rotate 0 30 0$/m);
  assert.match(written, /^effect revolve angle 270$/m);
});
