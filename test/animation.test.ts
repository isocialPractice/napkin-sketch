/** Animation Mode layer-rule tests (validation, frame naming). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  animationFrameFile,
  animationFrameJob,
  animationFrameName,
  animationFrameOffsetX,
  animationFrameTransforms,
  animationPoseStep,
  animationTypeSpec,
  clampSequenceFrames,
  defaultSequenceFrames,
  MAX_SEQUENCE_FRAMES,
  MIN_SEQUENCE_FRAMES,
  type AnimationPoseStep,
  expandBounds,
  assemblyPivot,
  buildAnimationForm,
  extractSvgMarkup,
  findAssemblyLayers,
  isDuplicateFrame,
  matchesAssembly,
  missingAssemblies,
  normalizeLayerName,
  parseFrameName,
  topMostParent,
  ANIMATION_FRAME_MIN_GAP,
  ANIMATION_SKILL_NAME,
  ANIMATION_TYPES,
  ANIMATION_SOURCE_FILE,
  READY_MADE_PRESETS,
  REQUIRED_ASSEMBLIES,
  VECTOR_SKILL_NAME,
} from '../src/core/animation.js';
import { ANIMATION_PLUGIN, pluginRef } from '../src/core/ai-tool.js';
import {
  KNOCKED_DOWN_CYCLE,
  MEASURED_CYCLES,
  RUN_CYCLE,
  WALK_CYCLE,
} from '../src/core/animation-cycles.js';
import { createGroupLayer, createLayer, createSketch, type Sketch } from '../src/core/types.js';

/** A sketch whose layer stack holds every required assembly as a group. */
function characterSketch(): Sketch {
  const sketch = createSketch('character');
  sketch.layers = [
    createGroupLayer('front-arm-assembly'),
    createGroupLayer('Body'),
    createGroupLayer('front-leg-assembly'),
    createGroupLayer('back-leg-assembly'),
    createGroupLayer('back-arm-assembly'),
    createGroupLayer('Head'),
  ];
  return sketch;
}

test('normalizeLayerName lowercases, trims, and drops uniqueness suffixes', () => {
  assert.equal(normalizeLayerName(' Head '), 'head');
  assert.equal(normalizeLayerName('Head-2'), 'head');
  assert.equal(normalizeLayerName('body_3'), 'body');
  assert.equal(normalizeLayerName('front-arm-assembly'), 'front-arm-assembly');
});

test('matchesAssembly accepts case and suffix variants', () => {
  assert.ok(matchesAssembly('Body', 'body'));
  assert.ok(matchesAssembly('back-arm-assembly-7', 'back-arm-assembly'));
  assert.ok(!matchesAssembly('front-arm', 'front-arm-assembly'));
});

test('findAssemblyLayers resolves every assembly in a complete character', () => {
  const found = findAssemblyLayers(characterSketch());
  assert.equal(found.size, REQUIRED_ASSEMBLIES.length);
});

test('findAssemblyLayers prefers group layers over plain layers', () => {
  const sketch = characterSketch();
  sketch.layers.unshift(createLayer('Head'));
  const found = findAssemblyLayers(sketch);
  assert.equal(found.get('head')?.group, true);
});

test('missingAssemblies reports each absent assembly in canonical order', () => {
  const sketch = characterSketch();
  sketch.layers = sketch.layers.filter(
    (l) => !matchesAssembly(l.name, 'head') && !matchesAssembly(l.name, 'body'),
  );
  assert.deepEqual(missingAssemblies(sketch), ['body', 'head']);
  assert.deepEqual(missingAssemblies(characterSketch()), []);
});

test('parseFrameName splits base and index; rejects unindexed names', () => {
  assert.deepEqual(parseFrameName('walk_0'), { base: 'walk', index: 0 });
  assert.deepEqual(parseFrameName('hero-walk_12'), { base: 'hero-walk', index: 12 });
  assert.equal(parseFrameName('walk'), null);
  assert.equal(parseFrameName('walk_a'), null);
});

test('topMostParent climbs nested groups and survives cycles', () => {
  const sketch = createSketch('nested');
  const frame = createGroupLayer('walk_0');
  const assembly = createGroupLayer('Head');
  const part = createLayer('face');
  assembly.parent = frame.id;
  part.parent = assembly.id;
  sketch.layers = [frame, assembly, part];
  assert.equal(topMostParent(sketch, part).id, frame.id);
  assert.equal(topMostParent(sketch, frame).id, frame.id);

  frame.parent = part.id; // cycle
  assert.ok(topMostParent(sketch, part));
});

test('animationFrameJob continues a typed sequence one frame at a time', () => {
  assert.deepEqual(animationFrameJob('character-walk_1', 'walk'), {
    baseName: 'character-walk',
    sourceIndex: 1,
    frameIndex: 2,
  });
  assert.deepEqual(animationFrameJob('hero-walk', 'walk'), {
    baseName: 'hero-walk',
    sourceIndex: 0,
    frameIndex: 1,
  });
});

test('animationFrameJob starts an animationLayer sequence otherwise', () => {
  assert.deepEqual(animationFrameJob(null, 'walk'), {
    baseName: 'animationLayer-walk',
    sourceIndex: 0,
    frameIndex: 1,
  });
  assert.deepEqual(animationFrameJob('character', 'walk'), {
    baseName: 'animationLayer-walk',
    sourceIndex: 0,
    frameIndex: 1,
  });
});

test('each job feeds the next, so the sequence grows without a frame count', () => {
  let name = 'character-walk_0';
  const drawn: string[] = [];
  for (let i = 0; i < 4; i++) {
    name = animationFrameName(animationFrameJob(name, 'walk'));
    drawn.push(name);
  }
  assert.deepEqual(drawn, [
    'character-walk_1',
    'character-walk_2',
    'character-walk_3',
    'character-walk_4',
  ]);
});

test('animationFrameName and animationFrameFile name the drawn frame', () => {
  const job = animationFrameJob('character-walk_1', 'walk');
  assert.equal(animationFrameName(job), 'character-walk_2');
  assert.equal(animationFrameFile(job), 'animations/character-walk_2.svg');
  assert.equal(animationFrameFile(animationFrameJob(null, 'walk')), 'animations/animationLayer-walk_1.svg');
});

test('ready-made presets match the feature contract', () => {
  assert.deepEqual(
    READY_MADE_PRESETS.map((p) => p.type).sort(),
    ['ideal', 'knocked-down', 'run', 'walk'],
  );
});

test('the walk cycle closes: every column sums back to the starting pose', () => {
  assert.equal(WALK_CYCLE.length, 8, 'eight skeletons, eight steps');
  const shift = WALK_CYCLE.reduce((sum, s) => sum + s.shiftYPercent, 0);
  assert.equal(Math.round(shift * 100) / 100, 0);
  for (const assembly of REQUIRED_ASSEMBLIES) {
    const total = WALK_CYCLE.reduce((sum, s) => sum + (s.rotate[assembly] ?? 0), 0);
    // Measured off drawn poses, so allow a tenth of a degree of rounding.
    assert.ok(Math.abs(total) < 0.15, `${assembly} drifts ${total} degrees over a cycle`);
  }
});

test('the walk cycle swings the arms against the legs', () => {
  // The skeleton is hand-drawn, so the arms are not exact mirrors of each
  // other; what the drawing does hold to is arm against leg on every step.
  for (const [i, step] of WALK_CYCLE.entries()) {
    const frontLeg = step.rotate['front-leg-assembly'] ?? 0;
    const frontArm = step.rotate['front-arm-assembly'] ?? 0;
    assert.ok(frontLeg !== 0 && frontArm !== 0, `step ${i + 1} moves both`);
    assert.notEqual(
      Math.sign(frontArm),
      Math.sign(frontLeg),
      `step ${i + 1} swings the front arm and front leg the same way`,
    );
  }
});

test('the run cycle swings harder than the walk and leaves the ground', () => {
  // A run is the same mechanics as a walk with more of everything, so the
  // measurement has to show more of it - otherwise the skeleton was drawn as
  // a walk and the type gains nothing by being measured.
  const swing = (cycle: readonly { rotate: Record<string, number | undefined> }[]) =>
    Math.max(...cycle.map((s) => Math.abs(s.rotate['front-leg-assembly'] ?? 0)));
  assert.ok(
    swing(RUN_CYCLE) > swing(WALK_CYCLE),
    `a run should swing the legs further than a walk: ${swing(RUN_CYCLE)} vs ${swing(WALK_CYCLE)}`,
  );

  // Both feet leave the ground on the passing frames, which reads as the
  // figure rising - a walk's neck stays level all the way round.
  assert.ok(
    RUN_CYCLE.some((s) => s.shiftYPercent < 0),
    'a run should lift the figure on at least one step',
  );
  // And the lean comes back: a cycle that tipped forward and stayed there
  // would walk the figure onto its face over a few repeats.
  const lean = RUN_CYCLE.reduce((sum, s) => sum + (s.figureRotate ?? 0), 0);
  assert.ok(Math.abs(lean) < 1, `a looping run must end upright, got ${lean}`);
});

test('a cycle that does not loop has one step fewer than it has frames', () => {
  // Knockdown runs start to end: seven skeletons, six steps between them,
  // and no closing step that would snap the figure back upright.
  assert.equal(KNOCKED_DOWN_CYCLE.length, 6);
  assert.equal(animationTypeSpec('knocked-down')?.loops, false);
  // Walk loops, so it closes: eight skeletons, eight steps. Run too, at ten.
  assert.equal(WALK_CYCLE.length, 8);
  assert.equal(animationTypeSpec('walk')?.loops, true);
  assert.equal(RUN_CYCLE.length, 10);
  assert.equal(animationTypeSpec('run')?.loops, true);
});

test('the knockdown cycle tips the whole figure and lowers it', () => {
  const tip = KNOCKED_DOWN_CYCLE.reduce((sum, s) => sum + (s.figureRotate ?? 0), 0);
  const drop = KNOCKED_DOWN_CYCLE.reduce((sum, s) => sum + s.shiftYPercent, 0);
  assert.ok(Math.abs(tip) > 45, `a knockdown should tip the figure over, got ${tip}`);
  assert.ok(drop > 10, `a knockdown should end lower than it started, got ${drop}`);
});

test('every measured cycle covers a type the app offers', () => {
  for (const [type, cycle] of Object.entries(MEASURED_CYCLES)) {
    const spec = animationTypeSpec(type);
    assert.ok(spec, `${type} has a cycle but is not an offered animation type`);
    assert.equal(spec.status, 'ready', `${type} is measured, so it is not work in progress`);
    assert.ok(cycle.length > 0, `${type} has an empty cycle`);
  }
  // And a type with no skeleton stays work in progress.
  assert.equal(animationTypeSpec('taunt')?.status, 'work-in-progress');
  assert.equal(MEASURED_CYCLES['taunt'], undefined);
});

/** The rotations a step applies, for comparing a resampled step by value. */
function turns(step: AnimationPoseStep | null): Partial<Record<string, number>> {
  return step ? { ...step.rotate } : {};
}

test('animationPoseStep walks the cycle and wraps at its end', () => {
  // At its natural pacing a resampled step reproduces the measured one, so
  // the default path is the cycle exactly as it was drawn.
  assert.deepEqual(turns(animationPoseStep('walk', 1)), WALK_CYCLE[0].rotate);
  assert.deepEqual(turns(animationPoseStep('walk', 8)), WALK_CYCLE[7].rotate);
  assert.deepEqual(turns(animationPoseStep('walk', 9)), WALK_CYCLE[0].rotate);
  assert.deepEqual(turns(animationPoseStep('WALK', 2)), WALK_CYCLE[1].rotate);
  assert.equal(animationPoseStep('explode', 1), null);
  assert.equal(animationPoseStep('walk', 0), null);
});

test('assemblyPivot hangs limbs from the top and the head from the neck', () => {
  const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 60 };
  assert.deepEqual(assemblyPivot('front-leg-assembly', bounds), { x: 20, y: 20 });
  assert.deepEqual(assemblyPivot('back-arm-assembly', bounds), { x: 20, y: 20 });
  assert.deepEqual(assemblyPivot('head', bounds), { x: 20, y: 60 });
  assert.equal(assemblyPivot('body', bounds), null);
});

test('animationFrameTransforms composes the bob around each joint rotation', () => {
  const step = { shiftYPercent: 1.5, rotate: { 'front-leg-assembly': -12, head: -2 } };
  const transforms = animationFrameTransforms(
    step,
    { 'front-leg-assembly': { x: 100, y: 50 }, head: { x: 100, y: 20 }, body: { x: 0, y: 0 } },
    200,
  );
  assert.equal(transforms['front-leg-assembly'], 'translate(0 3) rotate(-12 100 50)');
  assert.equal(transforms.head, 'translate(0 3) rotate(-2 100 20)');
  // The body carries the bob alone: it has a pivot here but never rotates.
  assert.equal(transforms.body, 'translate(0 3)');
  // Every assembly carries the bob, turning or not, so the figure moves as
  // one piece instead of coming apart at the joints.
  assert.equal(transforms['back-leg-assembly'], 'translate(0 3)');
});

test('animationFrameTransforms rounds to two decimals and drops a null bob', () => {
  const step = { shiftYPercent: 0, rotate: { 'front-arm-assembly': 10 } };
  const transforms = animationFrameTransforms(
    step,
    { 'front-arm-assembly': { x: 12.3456, y: 7.891 } },
    200,
  );
  assert.equal(transforms['front-arm-assembly'], 'rotate(10 12.35 7.89)');
});

test('expandBounds grows a box on every side', () => {
  const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 60 };
  assert.deepEqual(expandBounds(bounds, 2), { minX: 8, minY: 18, maxX: 32, maxY: 62 });
  assert.deepEqual(expandBounds(bounds, 0), bounds);
});

test('animationFrameOffsetX stands a frame one gap right of its source', () => {
  const source = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
  const frame = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
  const dx = animationFrameOffsetX(source, frame);
  // 15% of a 100-wide source clears the minimum, so the seam is 15 units.
  assert.equal(dx, 115);
  assert.equal(frame.minX + dx, source.maxX + 15);
});

test('animationFrameOffsetX keeps a visible seam for a tiny source', () => {
  const source = { minX: 0, minY: 0, maxX: 20, maxY: 40 };
  const dx = animationFrameOffsetX(source, { minX: 0, minY: 0, maxX: 20, maxY: 40 });
  // 15% of 20 is under the floor, so the minimum gap applies instead.
  assert.equal(dx, 20 + ANIMATION_FRAME_MIN_GAP);
});

test('animationFrameOffsetX measures from the frame own left edge', () => {
  const source = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
  // A turned assembly can push the frame wider than its source on either side.
  const frame = { minX: -5, minY: 0, maxX: 108, maxY: 200 };
  const dx = animationFrameOffsetX(source, frame);
  assert.equal(frame.minX + dx, source.maxX + 15, 'left edges must not overlap the source');
  assert.ok(frame.minX + dx > source.maxX);
});

test('buildAnimationForm asks for a file edit, not a redrawn document', () => {
  const job = animationFrameJob('character-walk_1', 'walk');
  const form = buildAnimationForm({
    category: 'character',
    type: 'walk',
    job,
    sourceLayerName: 'character-walk_1',
    assemblies: { head: 'Head', body: 'Body' },
    transforms: { head: 'translate(0 3) rotate(-2 100 20)' },
  });
  assert.ok(form.includes('Draw frame 2 of a character "walk" animation'));
  assert.ok(form.includes(ANIMATION_SOURCE_FILE));
  assert.ok(form.includes(`Apply the ${ANIMATION_SKILL_NAME} skill`));
  assert.ok(form.includes('This is a file edit, not a redraw'));
  assert.ok(form.includes('- Head (head): transform="translate(0 3) rotate(-2 100 20)"'));
  assert.ok(form.includes('- Body (body): leave as it is'));
  assert.ok(form.includes('id="character-walk_2"'));
  assert.ok(form.includes('animations/character-walk_2.svg'));
  assert.ok(form.includes('Do not print the'));
  // The geometry stays in the file: a form that carries it is the slow path.
  assert.ok(!form.includes('<path'));
  assert.ok(form.length < 4000);
});

test('every offered animation type carries the template its prompt needs', () => {
  const ids = new Set<string>();
  for (const spec of ANIMATION_TYPES) {
    assert.ok(spec.id && spec.label, 'a type needs an id and a label');
    assert.ok(!ids.has(spec.id), `${spec.id} is offered twice`);
    ids.add(spec.id);
    assert.ok(['character', 'object'].includes(spec.category));
    assert.ok(['ready', 'work-in-progress'].includes(spec.status));
    // The template is what makes a type usable before its cycle exists, so
    // an empty one would offer a type the helper cannot pose.
    assert.ok(spec.guidance.length > 60, `${spec.id} has no usable template`);
    assert.equal(animationTypeSpec(spec.id.toUpperCase()), spec);
  }
  assert.equal(animationTypeSpec('nonesuch'), null);
});

test('the type list covers both categories; skeletons decide what is ready', () => {
  const character = ANIMATION_TYPES.filter((t) => t.category === 'character');
  const object = ANIMATION_TYPES.filter((t) => t.category === 'object');
  assert.ok(character.length >= 10, 'the character presets are all offered');
  assert.ok(object.length >= 4, 'the object presets are all offered');
  // A type is ready exactly when the wireframe asset has a skeleton for it.
  const ready = new Set(READY_MADE_PRESETS.map((p) => p.type));
  assert.deepEqual([...ready].sort(), Object.keys(MEASURED_CYCLES).sort());
  for (const spec of ANIMATION_TYPES) {
    assert.equal(
      spec.status,
      ready.has(spec.id) ? 'ready' : 'work-in-progress',
      `${spec.id} status must follow whether a skeleton was measured for it`,
    );
  }
  // Every ready type is a character: the asset draws no object skeletons.
  for (const preset of READY_MADE_PRESETS) assert.equal(preset.category, 'character');
});

test('buildAnimationForm templates the prompt for a type with no cycle', () => {
  const form = buildAnimationForm({
    category: 'object',
    type: 'explode',
    job: animationFrameJob(null, 'explode'),
    sourceLayerName: null,
    assemblies: {},
    transforms: {},
  });
  assert.ok(form.includes('Pose the frame yourself'));
  assert.ok(form.includes('One step of a "explode"'));
  // The type's own template, verbatim, is what makes the prompt specific.
  assert.ok(form.includes(animationTypeSpec('explode')!.guidance));
  assert.ok(form.includes('does not loop'));
  // An object has no assemblies to move.
  assert.ok(form.includes("the subject is the frame's root group"));
  assert.ok(!form.includes('front-leg-assembly'));
});

test('buildAnimationForm templates a looping character type onto the assemblies', () => {
  const form = buildAnimationForm({
    category: 'character',
    type: 'taunt',
    job: animationFrameJob(null, 'taunt'),
    sourceLayerName: null,
    assemblies: { head: 'Head' },
    transforms: {},
  });
  assert.ok(form.includes('One step of a "taunt"'));
  assert.ok(form.includes(animationTypeSpec('taunt')!.guidance));
  assert.ok(form.includes('This animation loops'));
  assert.ok(form.includes('- Head (head): leave as it is'));
});

test('the form names both skills, so curve work has somewhere to go', () => {
  const form = buildAnimationForm({
    category: 'character',
    type: 'walk',
    job: animationFrameJob('character-walk_1', 'walk'),
    sourceLayerName: 'character-walk_1',
    assemblies: {},
    transforms: { head: 'rotate(-2 100 20)' },
  });
  assert.ok(form.includes(`Apply the ${ANIMATION_SKILL_NAME} skill`));
  assert.ok(form.includes(`companion ${VECTOR_SKILL_NAME} skill`));
  assert.ok(form.includes(`${ANIMATION_PLUGIN.dir}/skills/${VECTOR_SKILL_NAME}/SKILL.md`));
});

test('a plugin install makes the form name the plugin skills, not the bare ones', () => {
  const data = {
    category: 'character' as const,
    type: 'walk',
    job: animationFrameJob('character-walk_1', 'walk'),
    sourceLayerName: 'character-walk_1',
    assemblies: {},
    transforms: { head: 'rotate(-2 100 20)' },
  };
  const files = buildAnimationForm({ ...data, delivery: 'files' });
  const plugin = buildAnimationForm({ ...data, delivery: 'plugin' });

  // A plugin renames what it carries, so the bare skill name reaches nothing.
  assert.ok(plugin.includes(`Apply the ${pluginRef(ANIMATION_SKILL_NAME)} skill`));
  assert.ok(plugin.includes(`companion ${pluginRef(VECTOR_SKILL_NAME)} skill`));
  assert.ok(plugin.includes(`/${ANIMATION_PLUGIN.name}:${ANIMATION_PLUGIN.command}`));
  // Its files sit in a cache the app cannot name, so the paths go away with them.
  assert.ok(!plugin.includes(`${ANIMATION_PLUGIN.dir}/skills/${VECTOR_SKILL_NAME}/SKILL.md`));

  // Saying nothing has to keep writing the form every tool understands.
  assert.equal(buildAnimationForm(data), files);
  assert.ok(files.includes(`Apply the ${ANIMATION_SKILL_NAME} skill`));
});
test('extractSvgMarkup tolerates chatter and rejects incomplete output', () => {
  const markup = '<svg xmlns="http://www.w3.org/2000/svg"><g id="walk_1"/></svg>';
  assert.equal(extractSvgMarkup(`Here is the frame:\n\`\`\`svg\n${markup}\n\`\`\`\nDone.`), markup);
  assert.equal(extractSvgMarkup(markup), markup);
  assert.equal(extractSvgMarkup('no svg here'), null);
  // A frame file still being written has no closing tag yet.
  assert.equal(extractSvgMarkup('<svg><g>'), null);
});

test('a step that moves nothing never reaches the form as a transform', () => {
  // A skeleton that repeats a pose measures as a still step. Handing that
  // over as finished transforms tells the helper to change nothing, and the
  // frame it saves duplicates its source - which is what took the punch
  // skeleton out of service until it gets a distinct last pose.
  for (const [type, cycle] of Object.entries(MEASURED_CYCLES)) {
    for (const [i, step] of cycle.entries()) {
      const moves =
        step.shiftYPercent !== 0 ||
        (step.figureRotate ?? 0) !== 0 ||
        Object.values(step.rotate).some((d) => (d ?? 0) !== 0);
      assert.ok(moves, `${type} step ${i + 1} moves nothing and would duplicate its source`);
      // And what the app hands over for that frame carries the same movement.
      assert.deepEqual(turns(animationPoseStep(type, i + 1)), step.rotate);
    }
  }
});

test('attack is offered from its template while its skeleton repeats a pose', () => {
  assert.equal(animationTypeSpec('attack')?.status, 'work-in-progress');
  assert.equal(MEASURED_CYCLES['attack'], undefined);
  assert.equal(animationPoseStep('attack', 1), null);
  // With no cycle the form falls back to the type's written template.
  const form = buildAnimationForm({
    category: 'character',
    type: 'attack',
    job: animationFrameJob(null, 'attack'),
    sourceLayerName: null,
    assemblies: {},
    transforms: {},
  });
  assert.ok(form.includes('Pose the frame yourself'));
  assert.ok(form.includes(animationTypeSpec('attack')!.guidance));
});

test('isDuplicateFrame catches a frame that is the source over again', () => {
  const source =
    '<svg viewBox="0 0 50 100"><g id="walk_2" data-name="walk_2">' +
    '<g id="Head" data-name="Head"><path d="M10,10 L20,20"/></g>' +
    '<g id="front-leg-assembly"><path d="M5,60 L8,95"/></g></g></svg>';

  // A verbatim copy is the failure this guards against.
  assert.equal(isDuplicateFrame(source, source), true);

  // Renaming the root group is what a helper does before it poses anything,
  // so a renamed copy is still a copy.
  const renamed = source.replace(/walk_2/g, 'walk_3');
  assert.equal(isDuplicateFrame(renamed, source), true);
});

test('isDuplicateFrame passes a frame posed by transforms', () => {
  const source =
    '<svg viewBox="0 0 50 100"><g id="walk_2" data-name="walk_2">' +
    '<g id="Head" data-name="Head"><path d="M10,10 L20,20"/></g>' +
    '<g id="front-leg-assembly"><path d="M5,60 L8,95"/></g></g></svg>';

  // Posing leaves the path data alone and adds a transform, which is exactly
  // why the check has to read transforms as well as geometry.
  const posed = source.replace(
    '<g id="front-leg-assembly">',
    '<g id="front-leg-assembly" transform="rotate(12.3 20 88)">',
  );
  assert.equal(isDuplicateFrame(posed, source), false);

  // A frame redrawn instead of transformed differs in its path data.
  const redrawn = source.replace('M5,60 L8,95', 'M5,60 L14,93');
  assert.equal(isDuplicateFrame(redrawn, source), false);
});

test('isDuplicateFrame does not fire on a document with no geometry', () => {
  // Two empty documents are not a duplicated frame; there is nothing to draw
  // and the caller has other checks for that.
  assert.equal(isDuplicateFrame('<svg></svg>', '<svg></svg>'), false);
  assert.equal(isDuplicateFrame('<svg></svg>', '<svg><path d="M0,0 L1,1"/></svg>'), false);
});

test('the frame count paces a cycle without changing where it ends up', () => {
  // Fewer frames than the cycle was drawn at means each moves further; more
  // means each moves less. What must not change is the total, or a loop stops
  // closing and a knockdown stops landing.
  const swing = (frames: number): number => {
    let total = 0;
    for (let i = 1; i <= frames; i++) {
      total += animationPoseStep('walk', i, frames)?.rotate['front-leg-assembly'] ?? 0;
    }
    return Math.round(total * 100) / 100;
  };
  for (const frames of [2, 4, 8, 16, 24, 60]) {
    assert.equal(swing(frames), 0, `a walk paced to ${frames} frames must still close`);
  }

  const step = (frames: number): number =>
    animationPoseStep('walk', 1, frames)!.rotate['front-leg-assembly'] ?? 0;
  const natural = defaultSequenceFrames('walk');
  assert.ok(step(natural / 2) > step(natural), 'half the frames must move further per frame');
  assert.ok(step(natural * 2) < step(natural), 'twice the frames must move less per frame');
  // Halving the pacing roughly doubles the step.
  assert.ok(Math.abs(step(natural / 2) / step(natural) - 2) < 0.35);
});

test('a paced cycle still completes a run that does not loop', () => {
  const tip = (frames: number): number => {
    let total = 0;
    for (let i = 1; i <= frames; i++) {
      total += animationPoseStep('knocked-down', i, frames)?.figureRotate ?? 0;
    }
    return Math.round(total * 100) / 100;
  };
  const measured = Math.round(
    KNOCKED_DOWN_CYCLE.reduce((sum, s) => sum + (s.figureRotate ?? 0), 0) * 100,
  ) / 100;
  assert.ok(Math.abs(measured) > 45, 'the knockdown tips the figure over');
  for (const frames of [3, 6, 12, 20]) {
    assert.equal(tip(frames), measured, `paced to ${frames} frames it must still land flat`);
  }
});

test('the default pacing is the length the cycle was drawn at', () => {
  assert.equal(defaultSequenceFrames('walk'), WALK_CYCLE.length);
  assert.equal(defaultSequenceFrames('knocked-down'), KNOCKED_DOWN_CYCLE.length);
  // A type with no cycle still needs a sensible sequence length to pace by.
  assert.equal(defaultSequenceFrames('explode'), 8);
  assert.equal(defaultSequenceFrames('WALK'), WALK_CYCLE.length);
});

test('clampSequenceFrames keeps the pacing inside a usable range', () => {
  assert.equal(clampSequenceFrames(8), 8);
  assert.equal(clampSequenceFrames(0), MIN_SEQUENCE_FRAMES);
  assert.equal(clampSequenceFrames(-5), MIN_SEQUENCE_FRAMES);
  assert.equal(clampSequenceFrames(1000), MAX_SEQUENCE_FRAMES);
  assert.equal(clampSequenceFrames(7.6), 8);
  assert.equal(clampSequenceFrames(Number.NaN), MIN_SEQUENCE_FRAMES);
});

test('the form tells the helper how much of the movement one frame carries', () => {
  const form = buildAnimationForm({
    category: 'character',
    type: 'taunt',
    job: animationFrameJob(null, 'taunt'),
    sourceLayerName: null,
    assemblies: {},
    transforms: {},
    frames: 12,
  });
  assert.ok(form.includes('runs 12 frames'));
  assert.ok(form.includes('one 12th of the whole movement'));

  // Without a count the prompt says nothing about pacing rather than guessing.
  const noCount = buildAnimationForm({
    category: 'character',
    type: 'taunt',
    job: animationFrameJob(null, 'taunt'),
    sourceLayerName: null,
    assemblies: {},
    transforms: {},
  });
  assert.ok(!noCount.includes('of the whole movement'));
});
