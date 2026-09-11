/**
 * Measures the wireframe skeleton asset and writes the animation cycle tables
 * the app poses frames with.
 *
 * `ai-helper/vectors/skills/vector-animations/assets/character-wireframes.svg` holds a
 * hand-drawn skeleton per frame of several animations, with the same assembly
 * group names a real character uses. Those skeletons are the guide: reading
 * the angle of each limb out of them gives measured joint rotations, instead
 * of numbers somebody guessed at.
 *
 *   npm run wireframe-cycles            # rewrite src/core/animation-cycles.ts
 *   npm run wireframe-cycles -- --print # measure and print, writing nothing
 *
 * Re-run it whenever the asset gains an animation or a frame.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET = join(root, 'ai-helper', 'vectors', 'skills', 'vector-animations', 'assets', 'character-wireframes.svg');
const OUT = join(root, 'src', 'core', 'animation-cycles.ts');
// The same measurements, as an asset the AI helper can read: it names which
// skeleton drives each type and what each step does, so a helper posing a
// frame by hand can follow the same guide the app poses ready types with.
const ASSET_OUT = join(root, 'ai-helper', 'vectors', 'skills', 'vector-animations', 'assets', 'skeleton-cycles.json');

/** Wireframe animation group -> the app's animation type id. */
const TYPE_FOR = {
  // 'Punch-Animation' is drawn but not mapped: punch_6 and punch_7 are the same
  // skeleton, so measuring it yields a step with no movement in it, and a
  // frame generated from that step is a copy of the frame it came from.
  // Give the punch a distinct last pose and this can come back.
  'Walk-Animation': { type: 'walk', loops: true },
  'Run-Animation': { type: 'run', loops: true },
  'Knockdown-Animation': { type: 'knocked-down', loops: false },
  'Ideal_Stance-Animation': { type: 'ideal', loops: true },
};

/** Assembly group name in the asset -> the app's required-assembly id. */
const ASSEMBLY_FOR = {
  'front-arm-assembly': 'front-arm-assembly',
  'back-arm-assembly': 'back-arm-assembly',
  'front-leg-assembly': 'front-leg-assembly',
  'back-leg-assembly': 'back-leg-assembly',
};

/** Direct child `<g>` elements of a chunk, with their id and inner markup. */
function childGroups(text) {
  const out = [];
  const open = /<g\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = open.exec(text))) {
    let depth = 1;
    const scan = /<g\b[^>]*>|<\/g>/g;
    scan.lastIndex = open.lastIndex;
    let s;
    while (depth > 0 && (s = scan.exec(text))) depth += s[0] === '</g>' ? -1 : 1;
    const end = scan.lastIndex - '</g>'.length;
    out.push({ id: m[1], inner: text.slice(open.lastIndex, end) });
    open.lastIndex = scan.lastIndex;
  }
  return out;
}

/**
 * The bone a group draws: the first polyline or line in it, as the joint end
 * and the far end. A limb's polyline runs joint-first, so the direction from
 * the first point to the last is the angle the limb hangs at.
 */
function bone(inner) {
  // Only a polyline or a line is a bone. A shoe is a polygon or a rect and
  // carries points too, so matching those would measure the foot instead.
  const poly = /<polyline\b[^>]*\bpoints="([^"]+)"/.exec(inner);
  if (poly) {
    const n = poly[1].trim().split(/[\s,]+/).map(Number);
    return { x1: n[0], y1: n[1], x2: n[n.length - 2], y2: n[n.length - 1] };
  }
  const line = /<line\b[^>]*\bx1="([\d.-]+)"\s+y1="([\d.-]+)"\s+x2="([\d.-]+)"\s+y2="([\d.-]+)"/.exec(inner);
  if (line) return { x1: +line[1], y1: +line[2], x2: +line[3], y2: +line[4] };
  return null;
}

const angleOf = (b) => (Math.atan2(b.y2 - b.y1, b.x2 - b.x1) * 180) / Math.PI;
const baseId = (id) => id.replace(/-\d+$/, '').toLowerCase();
const round = (v) => Math.round(v * 10) / 10;

/** Shortest signed way round from one angle to another, in degrees. */
function angleDelta(from, to) {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return round(d);
}

/** Every frame of one wireframe animation, measured, in frame order. */
function measureFrames(animationInner) {
  const frames = childGroups(animationInner)
    .map((f) => ({ index: Number(/_(\d+)$/.exec(f.id)?.[1] ?? -1), ...f }))
    .filter((f) => f.index >= 0)
    .sort((a, b) => a.index - b.index);

  return frames.map((frame) => {
    const bones = {};
    let top = Infinity;
    let bottom = -Infinity;
    for (const part of childGroups(frame.inner)) {
      const b = bone(part.inner);
      if (b) bones[baseId(part.id)] = b;
      // The figure's extent comes from every number in the group, so the
      // height it is measured against includes head, hands, and feet.
      for (const n of part.inner.matchAll(/\b(?:y|y1|y2|cy)="([\d.-]+)"/g)) {
        top = Math.min(top, +n[1]);
        bottom = Math.max(bottom, +n[1]);
      }
      for (const p of part.inner.matchAll(/points="([^"]+)"/g)) {
        const nums = p[1].trim().split(/[\s,]+/).map(Number);
        for (let i = 1; i < nums.length; i += 2) {
          top = Math.min(top, nums[i]);
          bottom = Math.max(bottom, nums[i]);
        }
      }
    }
    const body = bones['body'];
    return {
      index: frame.index,
      // The spine's angle is the whole figure's tilt; every limb angle is
      // read against it so a tipping figure does not count twice.
      bodyAngle: body ? angleOf(body) : 90,
      neckY: body ? body.y1 : 0,
      height: Number.isFinite(top) ? bottom - top : 0,
      limbs: bones,
    };
  });
}

/** The step that carries each frame to the next, closing back to the first. */
function cycleSteps(frames, loops) {
  const height = frames[0].height || 1;
  const steps = [];
  // A looping animation closes back to its first pose; one that runs from a
  // start to an end must not, or the last step would snap it back.
  const last = loops ? frames.length : frames.length - 1;
  for (let i = 0; i < last; i++) {
    const from = frames[i];
    const to = frames[(i + 1) % frames.length];
    const rotate = {};
    for (const [assetName, assembly] of Object.entries(ASSEMBLY_FOR)) {
      const a = from.limbs[assetName];
      const b = to.limbs[assetName];
      if (!a || !b) continue;
      // Relative to the spine, so a limb that only moved because the whole
      // figure tipped reads as no joint rotation at all.
      const delta = angleDelta(angleOf(a) - from.bodyAngle, angleOf(b) - to.bodyAngle);
      if (delta !== 0) rotate[assembly] = delta;
    }
    steps.push({
      shiftYPercent: round(((to.neckY - from.neckY) / height) * 100),
      figureRotate: angleDelta(from.bodyAngle, to.bodyAngle),
      rotate,
    });
  }
  return steps;
}

function literal(steps) {
  return steps
    .map((step) => {
      const rotate = Object.entries(step.rotate)
        .map(([k, v]) => `'${k}': ${v}`)
        .join(', ');
      const figure = step.figureRotate !== 0 ? `figureRotate: ${step.figureRotate}, ` : '';
      return `  { shiftYPercent: ${step.shiftYPercent}, ${figure}rotate: { ${rotate} } },`;
    })
    .join('\n');
}

async function run() {
  const svg = await readFile(ASSET, 'utf-8');
  const print = process.argv.includes('--print');
  const blocks = [];
  const names = [];
  const measured = [];

  for (const animation of childGroups(svg)) {
    const mapped = TYPE_FOR[animation.id];
    if (!mapped) continue;
    const { type, loops } = mapped;
    const frames = measureFrames(animation.inner);
    if (frames.length < 2) continue;
    const steps = cycleSteps(frames, loops);
    // A step that moves nothing would tell the helper to change nothing, and
    // the frame it saved would duplicate its source.
    const still = steps.filter(
      (s) => s.shiftYPercent === 0 && !s.figureRotate && Object.keys(s.rotate).length === 0,
    ).length;
    if (still > 0) {
      console.warn(
        `wireframe-cycles: WARNING ${animation.id} has ${still} step(s) that move nothing -` +
          ' repeated skeletons produce duplicate frames.',
      );
    }
    names.push({ type, animation: animation.id, frames: frames.length, steps: steps.length, loops });
    measured.push(steps);
    const constant = `${type.replace(/-/g, '_').toUpperCase()}_CYCLE`;
    blocks.push(
      // Both counts, because they differ and the difference reads as a bug
      // otherwise: a cycle that closes gets one step per skeleton, one that
      // runs from a start to an end gets one fewer.
      `/**\n * ${type}: measured from \`${animation.id}\` in the wireframe asset,\n` +
        ` * ${frames.length} skeletons (${frames.map((f) => f.index).join(', ')})\n` +
        ` * giving ${steps.length} step${steps.length === 1 ? '' : 's'}` +
        `${loops ? ', the last closing back to the first' : ' (this animation does not loop)'}.\n */\n` +
        `export const ${constant}: readonly AnimationPoseStep[] = [\n${literal(steps)}\n];`,
    );
    if (print) {
      console.log(`\n### ${type}  <- ${animation.id}  (${frames.length} frames)`);
      for (const [i, step] of steps.entries()) {
        console.log(`  step ${i + 1}: ${JSON.stringify(step)}`);
      }
    }
  }

  if (print) return;

  const header = `/**
 * Animation cycles measured from the wireframe skeleton asset.
 *
 * GENERATED by \`npm run wireframe-cycles\` - do not edit by hand. The source
 * of truth is the drawn skeleton in
 * \`ai-helper/vectors/skills/vector-animations/assets/character-wireframes.svg\`: one
 * wireframe per frame, carrying the same assembly group names a character
 * does. Each step below is the change from one skeleton to the next, so the
 * angles are read off drawn poses rather than guessed at.
 *
 * Limb rotations are measured against the spine, so a limb that moved only
 * because the whole figure tipped reads as no joint rotation; the tipping
 * itself is \`figureRotate\`.
 *
 * Covered: ${names.map((n) => `${n.type} (${n.steps} steps)`).join(', ')}.
 */

import type { AnimationPoseStep } from './animation.js';

`;
  const footer = `
/** Measured cycles by animation type, for {@link animationPoseStep}. */
export const MEASURED_CYCLES: Readonly<Record<string, readonly AnimationPoseStep[]>> = {
${names.map((n) => `  '${n.type}': ${n.type.replace(/-/g, '_').toUpperCase()}_CYCLE,`).join('\n')}
};
`;
  await writeFile(OUT, `${header}${blocks.join('\n\n')}\n${footer}`, 'utf-8');
  const asset = {
    generatedFrom: 'character-wireframes.svg',
    note: 'Measured joint rotations per step. Limb angles are relative to the spine; figureRotate tips the whole figure about its base; shiftYPercent moves it as a percent of its height.',
    cycles: Object.fromEntries(
      names.map((n, i) => [
        n.type,
        {
          skeleton: n.animation,
          frames: n.frames,
          loops: n.loops,
          steps: measured[i],
        },
      ]),
    ),
  };
  await writeFile(ASSET_OUT, `${JSON.stringify(asset, null, 2)}
`, 'utf-8');
  console.log(`wireframe-cycles: wrote ${names.length} cycles to src/core/animation-cycles.ts`);
  console.log('wireframe-cycles: wrote the skeleton asset to ai-helper/vectors/skills/vector-animations/assets/skeleton-cycles.json');
  for (const n of names) console.log(`  ${n.type} <- ${n.animation} (${n.frames} frames)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
