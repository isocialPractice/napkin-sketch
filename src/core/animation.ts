/**
 * Animation Mode data model and layer-structure rules.
 *
 * Animation Mode turns a page's layer tree into frame-by-frame animation
 * material: one group layer per frame, each frame holding the same set of
 * named assemblies. Frames are drawn one at a time - each run advances the
 * previous frame by a single step - so a run stays small enough for an AI
 * helper to finish and the sequence grows for as long as the user keeps
 * accepting frames. The helpers here validate a sketch against the required
 * assembly list and derive the names generated frames must use. They are
 * pure functions so the renderer, the AI-helper hand-off, and the tests all
 * share one source of truth.
 */

import type { Layer, Sketch } from './types.js';
import { MEASURED_CYCLES } from './animation-cycles.js';
import { ANIMATION_PLUGIN, pluginRef } from './ai-tool.js';

/**
 * The assemblies a character frame must contain before frames can be
 * generated. Matched case-insensitively against layer names, ignoring the
 * numeric suffixes editors append to keep ids unique (`Head-2`, `body_3`).
 */
export const REQUIRED_ASSEMBLIES = [
  'front-arm-assembly',
  'body',
  'front-leg-assembly',
  'back-leg-assembly',
  'back-arm-assembly',
  'head',
] as const;

/** One of the required character assemblies. */
export type RequiredAssembly = (typeof REQUIRED_ASSEMBLIES)[number];

/** What kind of subject an animation sequence moves. */
export type AnimationCategory = 'character' | 'object';

/**
 * One animation the wizard offers. Every type is selectable: `walk` runs off
 * a measured cycle, and the rest are work in progress - they hand the AI
 * helper a template describing one step of that movement and let it pose the
 * frame from there. The templates are what make a type usable before its
 * cycle table exists.
 */
export interface AnimationTypeSpec {
  /** Value stored in the form and used in layer names (`walk`). */
  id: string;
  /** Label for the wizard's dropdown (`Walk`). */
  label: string;
  /** What the type moves. */
  category: AnimationCategory;
  /**
   * `ready` when a skeleton in the wireframe asset was measured into a cycle
   * for it; `work-in-progress` when there is no skeleton yet, so the helper
   * works from the template alone and the result still needs an eye on it.
   */
  status: 'ready' | 'work-in-progress';
  /** True when the last frame returns to the first, so the sequence loops. */
  loops: boolean;
  /**
   * One step of this movement, in the helper's terms. Written to be dropped
   * into the form as it stands: what moves, about which joint, and how far.
   */
  guidance: string;
}

/**
 * Every animation the wizard offers, in dropdown order. Character types move
 * the six required assemblies; object types move the graphic as a whole and
 * need no assemblies at all.
 */
export const ANIMATION_TYPES: readonly AnimationTypeSpec[] = [
  {
    id: 'walk',
    label: 'Walk',
    category: 'character',
    status: 'ready',
    loops: true,
    guidance:
      'Arms and legs swing in opposition about the shoulders and hips, the head counter-rotates slightly, and the figure bobs as the weight passes over the front foot.',
  },
  {
    id: 'ideal',
    label: 'Idle',
    category: 'character',
    status: 'ready',
    loops: true,
    guidance:
      'A standing idle: the figure breathes. Raise and lower the whole figure by about 1 percent of its height, let the arms hang and sway a degree or two, and tilt the head very slightly. The feet stay planted and nothing travels.',
  },
  {
    id: 'run',
    label: 'Run',
    category: 'character',
    status: 'ready',
    loops: true,
    guidance:
      'A run is a walk with more of everything: swing the legs about the hips roughly twice as far as a walk, swing the arms in opposition about the shoulders just as hard, and lean the whole figure forward a few degrees. On the passing frames both feet are off the ground, so lift the figure rather than dropping it.',
  },
  {
    id: 'attack',
    label: 'Attack',
    category: 'character',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'Three beats, not a cycle: wind up (weight shifts back, the striking arm rotates back about the shoulder, the body turns away), strike (the arm swings through and extends, the body turns into it, the front leg braces), then recover (everything eases back toward the starting pose). Judge from the source pose which beat comes next.',
  },
  {
    id: 'damage',
    label: 'Damage',
    category: 'character',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'A hit reaction: the head snaps back about the neck, the body leans away from the blow, the arms fly outward about the shoulders, and the figure shifts back. Later frames settle toward the starting pose rather than continuing away.',
  },
  {
    id: 'taunt',
    label: 'Taunt',
    category: 'character',
    status: 'work-in-progress',
    loops: true,
    guidance:
      'A short expressive gesture: raise one arm about its shoulder well above the horizontal, lean the body back a few degrees, and tilt the head. The other arm and the legs move very little. Return toward the starting pose to close the loop.',
  },
  {
    id: 'talk',
    label: 'Talk',
    category: 'character',
    status: 'work-in-progress',
    loops: true,
    guidance:
      'Dialogue: the head does nearly all the work. Nod and tilt it a few degrees about the neck, let the body sway by a degree, and give the arms small gestures about the shoulders. Keep every angle small - talking is not walking.',
  },
  {
    id: 'jump',
    label: 'Jump',
    category: 'character',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'Four beats, not a cycle: crouch (the figure drops and the legs fold about the hips), launch (the legs straighten, the arms swing up, the whole figure rises), airborne (the legs tuck and the figure rises further), then land (the figure drops and the legs fold to absorb it). Judge from the source pose which beat comes next.',
  },
  {
    id: 'fall-down',
    label: 'Fall down',
    category: 'character',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'Losing balance: rotate the whole figure further from vertical each frame, let the arms swing wide about the shoulders to catch the balance, and let the legs give way about the hips. The last frames are nearly horizontal, with the figure lowered to the ground.',
  },
  {
    id: 'knocked-down',
    label: 'Knocked down',
    category: 'character',
    status: 'ready',
    loops: false,
    guidance:
      'Struck off the feet: rotate the whole figure backward off its base, faster than a fall, with the limbs trailing behind the body rather than reaching. The feet leave the ground early and the figure ends flat and lowered.',
  },
  {
    id: 'rotate',
    label: 'Rotate',
    category: 'object',
    status: 'work-in-progress',
    loops: true,
    guidance:
      'Turn the whole graphic about its own center by an equal share of a full turn each frame, so the frames divide 360 degrees evenly and the sequence closes. Nothing else changes: this is one rotation on the frame group.',
  },
  {
    id: 'break',
    label: 'Break',
    category: 'object',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'Cracking apart: the first frames draw fracture lines across the shape, and later frames separate it along them - each piece in its own group, drifting outward and rotating a few degrees. This type needs new geometry rather than a transform, so work the fracture paths with the vector-graphics skill. The vector-animations skill draws the sequence in object-animations.svg: keep what is left as base, give every separated piece its own stray-piece group, and mark on the intact frame what will come away.',
  },
  {
    id: 'move',
    label: 'Move',
    category: 'object',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'Travel along a path: translate the whole graphic further each frame, easing in at the start and out at the end rather than stepping by a constant distance. The shape itself is unchanged.',
  },
  {
    id: 'explode',
    label: 'Explode',
    category: 'object',
    status: 'work-in-progress',
    loops: false,
    guidance:
      'Bursting outward: split the shape into pieces, then drive each piece away from the center further and faster each frame, rotating as it goes. Like break, this needs new geometry, so work the piece outlines with the vector-graphics skill. The vector-animations skill draws the sequence in object-animations.svg, where a piece that has left the shape is its own group and the ones that have dispersed are dropped rather than kept in place.',
  },
];

/** The animation type with this id, or null when it is not one the app offers. */
export function animationTypeSpec(id: string): AnimationTypeSpec | null {
  const key = id.trim().toLowerCase();
  return ANIMATION_TYPES.find((t) => t.id === key) ?? null;
}

/**
 * Animation types a measured cycle drives. Every other type is offered too,
 * posed from its template while its cycle is still being worked out.
 */
export const READY_MADE_PRESETS: ReadonlyArray<{
  category: AnimationCategory;
  type: string;
}> = ANIMATION_TYPES.filter((t) => t.status === 'ready').map((t) => ({
  category: t.category,
  type: t.id,
}));

/**
 * Normalizes a layer name for assembly matching: lowercased, trimmed, with
 * a single trailing `-<n>`/`_<n>` uniqueness suffix removed. Frame indexes
 * use the same `_<n>` shape, so frame parsing runs on the raw name instead.
 */
export function normalizeLayerName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]\d+$/, '');
}

/** True when a layer name identifies the given required assembly. */
export function matchesAssembly(name: string, assembly: RequiredAssembly): boolean {
  return normalizeLayerName(name) === assembly;
}

/**
 * Finds the layer standing in for each required assembly. Group layers are
 * preferred (assemblies are groups of parts), but a plain layer with a
 * matching name is accepted so simple sketches validate too. When several
 * layers match one assembly the first in stack order wins.
 */
export function findAssemblyLayers(sketch: Sketch): Map<RequiredAssembly, Layer> {
  const found = new Map<RequiredAssembly, Layer>();
  for (const assembly of REQUIRED_ASSEMBLIES) {
    const matches = sketch.layers.filter((l) => matchesAssembly(l.name, assembly));
    const layer = matches.find((l) => l.group) ?? matches[0];
    if (layer) found.set(assembly, layer);
  }
  return found;
}

/** The required assemblies the sketch has no layer for, in canonical order. */
export function missingAssemblies(sketch: Sketch): RequiredAssembly[] {
  const found = findAssemblyLayers(sketch);
  return REQUIRED_ASSEMBLIES.filter((a) => !found.has(a));
}

/** A frame layer name split into its base and numeric frame index. */
export interface FrameName {
  /** Everything before the `_<n>` suffix (e.g. `hero-walk`). */
  base: string;
  /** The numeric frame index (0-based by convention). */
  index: number;
}

/** Parses a `<base>_<n>` frame layer name; null when the name has no index. */
export function parseFrameName(name: string): FrameName | null {
  const match = /^(.*)_(\d+)$/.exec(name.trim());
  if (!match) return null;
  return { base: match[1], index: Number(match[2]) };
}

/**
 * The top-most ancestor of a layer (the frame group when assemblies live
 * inside one). Returns the layer itself when it has no parent. Cycle-safe.
 */
export function topMostParent(sketch: Sketch, layer: Layer): Layer {
  let current = layer;
  const seen = new Set<string>([current.id]);
  while (current.parent) {
    const parent = sketch.layers.find((l) => l.id === current.parent);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

/**
 * Where the cleaned form data is written for the AI helper, relative to the
 * helper's working directory. The folder is transient: the app clears it
 * when the animation run completes.
 */
export const ANIMATION_FORM_FILE = '_temp/animation-form.txt';

/**
 * Where the app writes the source frame for the helper to edit, relative to
 * the helper's working directory. Handing over a file instead of pasting the
 * geometry into the form keeps the prompt small (a few KB instead of tens of
 * KB) and lets the helper move the pose without ever reading the geometry.
 */
export const ANIMATION_SOURCE_FILE = '_temp/animation-source.svg';

/**
 * Where the AI helper writes the finished frame
 * (`animations/<base>_<n>.svg`). Created when missing; the folder is the
 * run's deliverable and is never cleared by the app.
 */
export const ANIMATION_OUTPUT_DIR = 'animations';

/**
 * The skill the helper applies when drawing a frame. Named in the form so a
 * tool that loads skills on demand picks it up; its canonical copy lives in
 * `ai-helper/vectors/skills/<name>/`.
 */
export const ANIMATION_SKILL_NAME = 'vector-animations';

/**
 * The companion skill the helper reaches for when a frame needs real curve
 * work rather than a joint rotation - fracture lines for a break, piece
 * outlines for an explode. Installed beside the animation skill so their
 * cross-links resolve.
 */
export const VECTOR_SKILL_NAME = 'vector-graphics';

/**
 * How the helper reached the AI tool, which decides what the form may call
 * the skills.
 *
 * `files` is the copy an install put in the tool's dot-folder, reachable by
 * path and by bare name. `plugin` is the `vectors` plugin, where the same
 * skills answer to `vectors:<skill>` and come with a command and a subagent
 * of their own. Naming a bare skill at a tool that only has the plugin names
 * something it cannot find, which is the whole reason the form has to know.
 */
export type AnimationHelperDelivery = 'files' | 'plugin';

/** What the form calls a skill, given how the helper was delivered. */
export function animationSkillRef(skill: string, delivery: AnimationHelperDelivery): string {
  return delivery === 'plugin' ? pluginRef(skill) : skill;
}

/**
 * Where AI helper runs are logged, relative to the helper's working
 * directory. Configurable via the `animationLogFile` setting (empty
 * disables logging).
 */
export const DEFAULT_ANIMATION_LOG_FILE = 'logs/animation-helper.log';

/**
 * Default AI helper invocation (Claude Code shown; any agentic CLI works).
 * The command runs through the platform shell with the temp folder's parent
 * as the working directory, so the `<` redirection resolves on POSIX shells
 * and cmd.exe alike. A Sonnet-class model is pinned: frame forms carry full
 * SVG geometry, and larger models trip token limits without drawing better
 * frames.
 */
export const DEFAULT_ANIMATION_HELPER_COMMAND = `claude -p --model sonnet --dangerously-skip-permissions < ${ANIMATION_FORM_FILE}`;

/**
 * Previous default helper commands. A persisted settings file that still
 * carries one of these is upgraded to the current default on load, so fixes
 * to the default invocation reach existing installs.
 */
export const LEGACY_ANIMATION_HELPER_COMMANDS: readonly string[] = [
  `claude -p --dangerously-skip-permissions < ${ANIMATION_FORM_FILE}`,
];

/**
 * One generation run: the single frame that follows the source pose. Frames
 * are drawn one at a time, so a run has one output file and one deliverable
 * no matter how long the finished sequence grows.
 */
export interface AnimationFrameJob {
  /** File and layer stem shared by every frame (e.g. `character-walk`). */
  baseName: string;
  /** Frame index of the source pose (parsed from its name; 0 otherwise). */
  sourceIndex: number;
  /** Frame index this run draws (always the source index plus one). */
  frameIndex: number;
}

/**
 * Derives the next frame's job from the source layer's name. A source
 * already carrying the animation type continues its own numbering
 * (`character-walk_1` draws `character-walk_2`); anything else starts a
 * fresh 0-based `animationLayer-<type>` sequence at `_1`.
 */
export function animationFrameJob(
  sourceLayerName: string | null,
  animationType: string,
): AnimationFrameJob {
  const type = animationType.trim().toLowerCase();
  if (sourceLayerName && sourceLayerName.toLowerCase().includes(type)) {
    const parsed = parseFrameName(sourceLayerName);
    if (parsed) {
      return { baseName: parsed.base, sourceIndex: parsed.index, frameIndex: parsed.index + 1 };
    }
    return { baseName: sourceLayerName, sourceIndex: 0, frameIndex: 1 };
  }
  return { baseName: `animationLayer-${type}`, sourceIndex: 0, frameIndex: 1 };
}

/** Layer and file stem for the frame a job draws (`<base>_<n>`). */
export function animationFrameName(job: AnimationFrameJob): string {
  return `${job.baseName}_${job.frameIndex}`;
}

/** Output file (relative to the work dir) for the frame a job draws. */
export function animationFrameFile(job: AnimationFrameJob): string {
  return `${ANIMATION_OUTPUT_DIR}/${animationFrameName(job)}.svg`;
}

/** A point in the source frame's coordinate space. */
export interface AnimationPoint {
  x: number;
  y: number;
}

/** Axis-aligned bounds of an assembly, in the source frame's coordinates. */
export interface AnimationBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Where each assembly's joint sits inside its own bounding box: limbs hang
 * from the shoulder or hip at the top, the head turns on the neck at the
 * bottom, and the body does not turn at all. Rough by design - a sketch has
 * no rig, and the top-center of an arm is the shoulder closely enough for a
 * hand-drawn cycle to read.
 */
export const ASSEMBLY_JOINT: Readonly<Record<RequiredAssembly, 'top' | 'bottom' | null>> = {
  'front-arm-assembly': 'top',
  body: null,
  'front-leg-assembly': 'top',
  'back-leg-assembly': 'top',
  'back-arm-assembly': 'top',
  head: 'bottom',
};

/** The joint pivot for an assembly; null when the assembly does not turn. */
export function assemblyPivot(
  assembly: RequiredAssembly,
  bounds: AnimationBounds,
): AnimationPoint | null {
  const joint = ASSEMBLY_JOINT[assembly];
  if (!joint) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: joint === 'top' ? bounds.minY : bounds.maxY,
  };
}

/**
 * Grows a box by `pad` on every side. A frame's bounds are measured from
 * stroke centerlines, so half of the widest stroke sits outside them; a crop
 * that ignores that pad shaves the outline off the sprite.
 */
export function expandBounds(bounds: AnimationBounds, pad: number): AnimationBounds {
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
}

/**
 * Space left between a frame and the frame drawn from it, as a fraction of
 * the source's width. Proportional rather than fixed so a thumbnail-sized
 * sketch and a full-page one both separate by a readable margin.
 */
export const ANIMATION_FRAME_GAP_RATIO = 0.15;

/** Floor for that gap, so a hairline-wide source still leaves a visible seam. */
export const ANIMATION_FRAME_MIN_GAP = 8;

/**
 * How far right a drawn frame moves so it stands beside its source instead
 * of on top of it: the frame's left edge lands one gap past the source's
 * right edge.
 *
 * Frames chain - each one is drawn from the frame before it - so every run
 * adds another panel and the sequence reads left to right as an animation
 * strip. Vertical position is left alone: the cycle's bob is a real part of
 * the pose and moving it would flatten the walk.
 */
export function animationFrameOffsetX(
  source: AnimationBounds,
  frame: AnimationBounds,
): number {
  const width = Math.max(source.maxX - source.minX, 0);
  const gap = Math.max(ANIMATION_FRAME_MIN_GAP, width * ANIMATION_FRAME_GAP_RATIO);
  return source.maxX + gap - frame.minX;
}
/**
 * One step of a cycle: how far each assembly turns about its joint, how far
 * the whole figure turns and shifts, to get from the previous frame to this
 * one. Values are deltas, not absolute poses, because each frame is drawn
 * from the frame before it.
 *
 * Every measured cycle is read off the drawn skeletons in the wireframe
 * asset rather than chosen by hand - see `animation-cycles.ts`.
 */
export interface AnimationPoseStep {
  /** Vertical shift of the whole figure, as a percent of its height (down positive). */
  shiftYPercent: number;
  /**
   * Degrees to turn the whole figure about its base, for animations where
   * the body itself tips - a knockdown, a fall. Limb rotations are measured
   * against the spine, so this does not double-count them.
   */
  figureRotate?: number;
  /** Degrees to turn each assembly about its joint pivot (clockwise positive). */
  rotate: Partial<Record<RequiredAssembly, number>>;
}

/**
 * How long a sequence is meant to run, in frames. This is not a batch size -
 * frames are still drawn one at a time - it is the pacing: a cycle's total
 * movement is divided across this many frames, so a short sequence moves
 * further per frame and a long one moves less.
 */
export const MIN_SEQUENCE_FRAMES = 2;
export const MAX_SEQUENCE_FRAMES = 60;

/**
 * The natural length of a type's sequence: one drawn frame per step of the
 * measured cycle, so each frame carries exactly the movement one drawn pose
 * carries and the sequence needs no interpolation.
 *
 * That is the cycle's *step* count, which is not always its skeleton count.
 * A run starts from a frame that already exists and draws the ones after it,
 * and the generator emits one step per skeleton for a cycle that closes and
 * one fewer for a cycle that does not - so both kinds land on the same
 * answer. Walk has 8 skeletons and 8 steps: 8 drawn frames, the ninth pose
 * being the first again. Knocked-down has 7 skeletons and 6 steps: 6 drawn
 * frames, which with the source makes the 7 poses that were measured.
 *
 * Types with no cycle fall back to eight, a readable length for a loop.
 */
export function defaultSequenceFrames(animationType: string): number {
  const cycle = MEASURED_CYCLES[animationType.trim().toLowerCase()];
  return cycle && cycle.length > 0 ? cycle.length : 8;
}

/** Holds a frame count inside the range a sequence can actually be paced to. */
export function clampSequenceFrames(frames: number): number {
  if (!Number.isFinite(frames)) return MIN_SEQUENCE_FRAMES;
  return Math.min(MAX_SEQUENCE_FRAMES, Math.max(MIN_SEQUENCE_FRAMES, Math.round(frames)));
}

/** Running totals of a cycle's movement, one entry per keyframe boundary. */
interface CycleTracks {
  shift: number[];
  figure: number[];
  rotate: Map<RequiredAssembly, number[]>;
}

/**
 * Turns a cycle's per-step deltas into cumulative poses. Deltas cannot be
 * stretched or squeezed on their own - the pose at a point part-way between
 * two keyframes is what has to be interpolated - so every resample works on
 * these running totals and differences them again afterwards.
 */
function cycleTracks(cycle: readonly AnimationPoseStep[]): CycleTracks {
  const assemblies = new Set<RequiredAssembly>();
  for (const step of cycle) {
    for (const key of Object.keys(step.rotate) as RequiredAssembly[]) assemblies.add(key);
  }
  const tracks: CycleTracks = { shift: [0], figure: [0], rotate: new Map() };
  for (const assembly of assemblies) tracks.rotate.set(assembly, [0]);
  for (const step of cycle) {
    tracks.shift.push(tracks.shift[tracks.shift.length - 1] + step.shiftYPercent);
    tracks.figure.push(tracks.figure[tracks.figure.length - 1] + (step.figureRotate ?? 0));
    for (const [assembly, track] of tracks.rotate) {
      track.push(track[track.length - 1] + (step.rotate[assembly] ?? 0));
    }
  }
  return tracks;
}

/** The cumulative value part-way along a track, linearly between keyframes. */
function sampleTrack(track: number[], at: number): number {
  const last = track.length - 1;
  if (at <= 0) return track[0];
  if (at >= last) return track[last];
  const index = Math.floor(at);
  const fraction = at - index;
  return track[index] + fraction * (track[index + 1] - track[index]);
}

// Two decimals, matching what the transform writer emits, so resampling a
// cycle into many small steps does not accumulate rounding into visible drift.
const roundStep = (value: number): number => Math.round(value * 100) / 100;

/**
 * The step that carries the source frame to the frame being drawn, measured
 * from the wireframe skeleton for that animation.
 *
 * `frames` paces the sequence. A cycle is measured from a fixed number of
 * drawn skeletons, but the sequence built from it can run to any length: the
 * cycle's whole movement is spread over `frames` frames, so asking for fewer
 * than the cycle has moves further per frame and asking for more moves less.
 * The totals are unchanged either way, which is what keeps a loop closing.
 *
 * Types with no skeleton in the asset return null, and the helper poses the
 * frame from the type's template instead.
 */
export function animationPoseStep(
  animationType: string,
  frameIndex: number,
  frames?: number,
): AnimationPoseStep | null {
  const cycle = MEASURED_CYCLES[animationType.trim().toLowerCase()];
  if (!cycle || cycle.length === 0 || frameIndex < 1) return null;

  const paced = clampSequenceFrames(frames ?? cycle.length);
  const index = (frameIndex - 1) % paced;
  const tracks = cycleTracks(cycle);
  // The frame spans this slice of the cycle, in keyframe units.
  const from = (index * cycle.length) / paced;
  const to = ((index + 1) * cycle.length) / paced;

  const rotate: Partial<Record<RequiredAssembly, number>> = {};
  for (const [assembly, track] of tracks.rotate) {
    const delta = roundStep(sampleTrack(track, to) - sampleTrack(track, from));
    if (delta !== 0) rotate[assembly] = delta;
  }
  const step: AnimationPoseStep = {
    shiftYPercent: roundStep(sampleTrack(tracks.shift, to) - sampleTrack(tracks.shift, from)),
    figureRotate: roundStep(sampleTrack(tracks.figure, to) - sampleTrack(tracks.figure, from)),
    rotate,
  };
  // A skeleton that repeats a pose measures as a step that moves nothing, and
  // so does a slice of one. Handing that over as finished transforms tells the
  // helper to change nothing, and the frame it saves is a copy of its source,
  // so fall back to the type's template and let the helper move the pose.
  return stepMoves(step) ? step : null;
}

/** True when a step actually changes the pose. */
function stepMoves(step: AnimationPoseStep): boolean {
  if (step.shiftYPercent !== 0) return true;
  if ((step.figureRotate ?? 0) !== 0) return true;
  return Object.values(step.rotate).some((degrees) => (degrees ?? 0) !== 0);
}
/** Formats a number for an SVG attribute: at most two decimals, no trailing zeros. */
function svgNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The exact `transform` value each assembly needs for this step: the
 * figure's vertical shift wrapped around a rotation about the assembly's own
 * joint pivot. Assemblies with no pivot (or nothing to do) are left out, and
 * an assembly that only shifts gets the translate alone.
 *
 * Composing this as a group transform is what makes a frame cheap to draw:
 * the browser's SVG stack rotates every anchor and Bezier handle inside the
 * group together, so the helper never has to re-emit the geometry to move it
 * rigidly about a joint.
 */
export function animationFrameTransforms(
  step: AnimationPoseStep,
  pivots: Partial<Record<RequiredAssembly, AnimationPoint>>,
  figureHeight: number,
  figurePivot?: AnimationPoint,
): Partial<Record<RequiredAssembly, string>> {
  const shift = (step.shiftYPercent / 100) * figureHeight;
  const translate = Math.abs(shift) >= 0.005 ? `translate(0 ${svgNumber(shift)})` : '';
  // The whole figure tipping goes on every assembly, outside its own joint
  // rotation, so the figure turns as one piece and the limbs still swing
  // within it. Cycles measure limb angles against the spine for this reason.
  const tip = step.figureRotate ?? 0;
  const figure =
    tip !== 0 && figurePivot
      ? `rotate(${svgNumber(tip)} ${svgNumber(figurePivot.x)} ${svgNumber(figurePivot.y)})`
      : '';
  const transforms: Partial<Record<RequiredAssembly, string>> = {};
  for (const assembly of REQUIRED_ASSEMBLIES) {
    const degrees = step.rotate[assembly] ?? 0;
    const pivot = pivots[assembly];
    const rotate =
      degrees !== 0 && pivot
        ? `rotate(${svgNumber(degrees)} ${svgNumber(pivot.x)} ${svgNumber(pivot.y)})`
        : '';
    const value = [translate, figure, rotate].filter(Boolean).join(' ');
    if (value) transforms[assembly] = value;
  }
  return transforms;
}

/** Everything the form collects for one frame's generation run. */
export interface AnimationFormData {
  /** What is being animated. */
  category: AnimationCategory;
  /** Animation type (e.g. `walk`). */
  type: string;
  /** The derived job (base name, source index, frame index). */
  job: AnimationFrameJob;
  /** Name of the top-most layer holding the assemblies, when there is one. */
  sourceLayerName: string | null;
  /** Layer names standing in for each required assembly. */
  assemblies: Partial<Record<RequiredAssembly, string>>;
  /** Ready-made `transform` value per assembly, when the type has a cycle. */
  transforms: Partial<Record<RequiredAssembly, string>>;
  /**
   * How many frames the finished sequence is meant to run to. Not a batch
   * size - frames are still drawn one at a time - but the pacing: it tells
   * the helper how much of the movement belongs to this one frame.
   */
  frames?: number;
  /**
   * How the helper was installed. Defaults to `files`, the delivery every
   * tool supports, so a caller that does not know still writes a form the
   * helper can act on.
   */
  delivery?: AnimationHelperDelivery;
}

/**
 * The closing block of the form: where the helper can read the contract and
 * the skills in full.
 *
 * The two deliveries answer this differently and both answers matter. Copied
 * files are found by path, so the block lists paths. The plugin is found by
 * name - its files live in a cache directory the app has no business guessing
 * at - so the block lists names, and mentions the repository paths only as
 * the copy a clone also has.
 */
function animationFormReferences(delivery: AnimationHelperDelivery): string {
  if (delivery === 'plugin') {
    const plugin = ANIMATION_PLUGIN.name;
    return `Full contract and references - the ${plugin} plugin is loaded, so ask for its parts by name (read before editing):
- the ${pluginRef(ANIMATION_SKILL_NAME)} skill (assemblies, joint pivots, cycle tables, transform recipe)
- the ${pluginRef(VECTOR_SKILL_NAME)} skill (curve work, for the frames that need new geometry)
- /${plugin}:${ANIMATION_PLUGIN.command}, which is this same job as a command
- the plugin's instructions/animation-mode.instructions.md (canonical instructions)
A clone of napkin-sketch carries all of it under ${ANIMATION_PLUGIN.dir}/ as well.
`;
  }
  const dir = ANIMATION_PLUGIN.dir;
  return `Full contract and references, when present in the working directory (read before editing):
- ${dir}/instructions/animation-mode.instructions.md (canonical instructions)
- ${dir}/skills/${ANIMATION_SKILL_NAME}/SKILL.md (the ${ANIMATION_SKILL_NAME} skill)
- ${dir}/skills/${VECTOR_SKILL_NAME}/SKILL.md (the ${VECTOR_SKILL_NAME} skill, for curve work)
- Installed copies for your tool may exist under its dot-folder, e.g. .claude/skills/${ANIMATION_SKILL_NAME}/, .claude/skills/${VECTOR_SKILL_NAME}/, and .claude/instructions/.
`;
}

/**
 * Composes the cleaned form data into the prompt handed to the AI helper.
 *
 * The form asks for an edit, not a drawing. The source frame is a file on
 * disk, the pose arrives as a ready-made `transform` per assembly, and the
 * frame is finished by writing those attributes into that file. That is the
 * whole difference between a run that finishes in seconds and a run that has
 * to emit tens of thousands of tokens of SVG geometry and gets killed before
 * it prints anything.
 */
export function buildAnimationForm(data: AnimationFormData): string {
  const { job } = data;
  // How the helper was delivered decides what the skills are called: bare
  // names for copied files, plugin-namespaced ones for the plugin.
  const delivery = data.delivery ?? 'files';
  const animationSkill = animationSkillRef(ANIMATION_SKILL_NAME, delivery);
  const vectorSkill = animationSkillRef(VECTOR_SKILL_NAME, delivery);
  const frameName = animationFrameName(job);
  const assemblyLines = REQUIRED_ASSEMBLIES.map((a) => {
    const name = data.assemblies[a] ?? a;
    const transform = data.transforms[a];
    return transform
      ? `   - ${name} (${a}): transform="${transform}"`
      : `   - ${name} (${a}): leave as it is`;
  }).join('\n');
  const spec = animationTypeSpec(data.type);
  const closing = spec
    ? spec.loops
      ? 'This animation loops, so the sequence must come back to its first pose.'
      : 'This animation does not loop: it runs from a start to an end, so read the source pose to see how far through that run you are.'
    : '';
  // The sequence length is pacing, not a quantity: it tells the helper how
  // much of the whole movement belongs to this one frame, so a short sequence
  // moves further per frame and a long one moves less.
  const paced = data.frames
    ? `   The finished sequence runs ${data.frames} frames, so this frame carries about
   one ${data.frames}th of the whole movement - move that far and no further.`
    : '';
  const template = spec
    ? `   One step of a "${data.type}": ${spec.guidance}
   ${closing}${paced ? `
${paced}` : ''}`
    : `   Advance the pose one readable step of a "${data.type}".${paced ? `
${paced}` : ''}`;
  const poseStep =
    Object.keys(data.transforms).length > 0
      ? `2. Set exactly these transforms on the assembly groups, copied character for
   character. They already carry this frame's joint angles and the figure's
   bob, measured from the source geometry. Replace a transform an assembly
   already has rather than adding to it; nothing else in the document changes.
${assemblyLines}`
      : data.category === 'object'
        ? `2. Pose the frame yourself - this type has no measured cycle yet, so work
   from the template below and judge the amounts from the source.
${template}
   There are no assemblies to move: the subject is the frame's root group, so
   put the transform there unless the movement needs the pieces handled
   separately.`
        : `2. Pose the frame yourself - this type has no measured cycle yet, so work
   from the template below and judge the amounts from the source.
${template}
   Give each assembly its own transform="rotate(<degrees> <pivot-x> <pivot-y>)"
   about its joint (hip for legs, shoulder for arms, neck for the head), and
   put any whole-figure shift or lean on every assembly so the figure moves as
   one piece. The assemblies are:
${assemblyLines}`;
  return `Animation Mode frame request (napkin-sketch)

Draw frame ${job.frameIndex} of a ${data.category} "${data.type}" animation by editing frame ${job.sourceIndex}, which is already saved at ${ANIMATION_SOURCE_FILE}.

Apply the ${animationSkill} skill before editing: it carries the assembly list, the joint pivots, the cycle tables, and the transform recipe. Its companion ${vectorSkill} skill owns the curve side - reach for it when a frame needs new or edited path geometry rather than a rotation.

This is a file edit, not a redraw. Do not rewrite, re-emit, or re-draw the geometry - every path in that file stays exactly as it is. Rotating an assembly's group rotates every anchor and Bezier handle inside it together, which is the rigid joint rotation this frame needs.

Steps:
1. Open ${ANIMATION_SOURCE_FILE} and work on it in place. Each assembly is a
   <g> found by its data-name attribute (its id carries the same name).
${poseStep}
3. Name the frame: the document's root group must carry id="${frameName}" and
   data-name="${frameName}" (and inkscape:label if that attribute is present).
   Add one wrapping group with that name if the document has no single root
   group.
4. Save the finished document to ${animationFrameFile(job)}, creating the
   ${ANIMATION_OUTPUT_DIR}/ folder if it does not exist. Save it last and only
   once, with the transforms already in it. Do NOT copy the source to that
   path and then edit it there: the app takes that file the moment it appears,
   and a copy taken before you posed it would put the previous frame on the
   page again.
5. Reply with one short line, such as "saved ${frameName}". Do not print the
   SVG - printing the document is what made earlier runs run out of time.

The transforms are given in the source document's own coordinate space, so they need no adjustment.

${animationFormReferences(delivery)}`;
}

/**
 * Everything in a document that decides where its ink lands: the path data,
 * the point lists, and the transforms carried above them. Attribute order is
 * preserved, so two documents drawing the same picture give the same string.
 */
function frameGeometry(svg: string): string {
  const parts: string[] = [];
  for (const m of svg.matchAll(/\s(?:d|points|transform)="([^"]*)"/g)) parts.push(m[1]);
  return parts.join('|');
}

/**
 * True when a drawn frame is the source frame over again.
 *
 * A frame is posed by adding transforms, which leaves the path data alone -
 * so a copy of the source and a properly posed frame have identical geometry
 * except for those transforms, and comparing both together is what tells
 * them apart.
 *
 * This is worth checking because the app collects the output file the moment
 * it appears. A helper that copies the source to that path and only then
 * starts editing would have its copy taken and its work thrown away, and the
 * frame that landed would be the previous frame again.
 */
export function isDuplicateFrame(frameSvg: string, sourceSvg: string): boolean {
  const frame = frameGeometry(frameSvg);
  return frame.length > 0 && frame === frameGeometry(sourceSvg);
}

/**
 * Pulls the SVG document out of an AI helper's output, tolerating chatter or
 * code fences around it. Returns null when no complete document is present -
 * which is also how a half-written frame file reads while the helper is
 * still saving it.
 */
export function extractSvgMarkup(output: string): string | null {
  const start = output.indexOf('<svg');
  const end = output.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) return null;
  return output.slice(start, end + '</svg>'.length);
}
