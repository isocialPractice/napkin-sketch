/**
 * Animation frames from a measured cycle, with no AI: a napkin script that
 * copies a figure's parts onto a page a frame, each part turned the way the
 * cycle turns it.
 *
 * Animation Mode draws a sequence one frame at a time through an AI helper,
 * and for a type with a measured cycle - walk, run, ideal, knocked-down - it
 * already hands the helper finished `transform` values, one an assembly
 * (`animationFrameTransforms`). This module leaves the helper out. It measures
 * the figure as the app does - each assembly's joint from its box, the
 * figure's height and its base, its facing from its feet - adds the cycle's
 * steps up to each frame, and writes a script: a page a frame, and on it, for
 * each part of the figure in paint order, `push`, the part's turn - a
 * `translate` for the bob, a `rotate ... at` the figure's base for a tip, a
 * `rotate ... at` its joint for a limb - the `use` that copies the part in,
 * and `pop`. The parts go to `evaluate` as documents, so the script carries no
 * geometry and reads as what it does. Every page is cut to one `registration`
 * box, the union of the frames' ink, so the frames play back without shifting.
 *
 * A frame is posed from the source, not from the frame before it: its turns
 * are the cycle's totals up to it, about the source's joints. That is what a
 * cycle measures - each skeleton against the first - and it holds a joint
 * where it is however long the sequence runs, where posing each frame from the
 * last would move a pivot every time a turned limb's box was measured again.
 */

import {
  ANIMATION_TYPES,
  animationFrameJob,
  animationFrameTransforms,
  animationPoseStep,
  assemblyPivot,
  clampSequenceFrames,
  CYCLE_FACING,
  defaultSequenceFrames,
  figureFacing,
  matchesAssembly,
  matchesFoot,
  REQUIRED_ASSEMBLIES,
  topMostParent,
  type AnimationBounds,
  type AnimationFacing,
  type AnimationFootSpan,
  type AnimationPoint,
  type AnimationPoseStep,
  type RequiredAssembly,
} from '../animation.js';
import { MEASURED_CYCLES } from '../animation-cycles.js';
import { strokeBounds } from '../bounds.js';
import { readEffects } from '../effects.js';
import { descendantLayerIds, layerOf, strokesByLayer, type Layer, type Sketch, type Stroke } from '../types.js';
import { formatDiagnostic } from './diagnostics.js';
import { evaluate, type Box } from './evaluate.js';
import { SCRIPT_VERSION, type DocumentInstruction, type Instruction } from './instructions.js';
import { formatScript } from './format.js';
import { inkBox } from './render.js';
import { measureTextBlock } from './text.js';

/** The animation types a cycle was measured for, which are the ones this module can draw. */
export const MEASURED_ANIMATION_TYPES: readonly string[] = Object.keys(MEASURED_CYCLES);

/**
 * The measured animation a name means, as its id: the id itself, or the label
 * the app shows for it, in any case and with a space for a hyphen. So `idle`,
 * the label of the type whose id is `ideal`, answers as `ideal` does, and
 * `knocked down` as `knocked-down`. Undefined for a name with no measured
 * cycle.
 */
export function measuredAnimationType(name: string): string | undefined {
  const key = (text: string): string => text.trim().toLowerCase().replace(/[ _]+/g, '-');
  const wanted = key(name);
  if (MEASURED_ANIMATION_TYPES.includes(wanted)) return wanted;
  return ANIMATION_TYPES.find((spec) => key(spec.label) === wanted && MEASURED_ANIMATION_TYPES.includes(spec.id))?.id;
}

/** How {@link measuredFramesScript} poses a figure. */
export interface MeasuredFramesOptions {
  /**
   * The animation: one with a measured cycle, as {@link MEASURED_ANIMATION_TYPES}
   * lists, by its id or by the label the app shows ({@link measuredAnimationType}).
   */
  type: string;
  /**
   * How many frames the cycle is spread across, and so how many pages the
   * script draws: 2 to 60, the cycle's own length unless given.
   */
  frames?: number;
  /** Which way the figure travels. Read from its feet unless given, and right when they do not say. */
  facing?: AnimationFacing;
  /**
   * The figure: the id or the name of the group holding its assemblies. Found
   * as Animation Mode finds it unless given - the one top-level group every
   * assembly sits in, or the assemblies themselves when they sit at the top.
   */
  root?: string;
}

/** What {@link measuredFramesScript} writes: a script, and the parts it copies in. */
export interface MeasuredFrames {
  /** The script, in the object form: a page a frame, and the registration box. */
  script: Instruction[];
  /** The script as text, as `formatScript` writes it, to show before it runs. */
  text: string;
  /** The figure's parts, by the names the script's `use` lines give them: pass these to `evaluate` as `documents`. */
  documents: Record<string, Sketch>;
  /** The frames' names, in order, which are also the pages' names: `walk_1` and on. */
  frames: string[];
  /** Which way the cycle was applied. */
  facing: AnimationFacing;
  /** Where the facing came from: the options, the figure's feet, or neither, and so the cycle's own. */
  facingFrom: 'given' | 'feet' | 'default';
  /** The box every frame is cut to: the union of the frames' ink. */
  registration: Box;
}

/** Why a figure cannot be drawn from a measured cycle, in a sentence that says what to do. */
export class MeasuredFramesError extends Error {}

/** Measures a text item with the built-in face, as the render calls do. */
function measureText(stroke: Stroke): { width: number; height: number } {
  const block = measureTextBlock(stroke.text ?? '', stroke.fontSize ?? 24, stroke.textBoxWidth);
  return { width: block.width, height: block.height };
}

/** Rounds to hundredths, so totals of two-decimal steps do not drift. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The figure on a page: its root group, or null when its assemblies sit at the
 * top of the stack, and the assembly layers inside it. Found as Animation Mode
 * finds its source, so the two draw from the same layers.
 */
function findFigure(sketch: Sketch, rootHint: string | undefined): { root: Layer | null; assemblies: Map<RequiredAssembly, Layer> } {
  const within = (scope: ReadonlySet<string> | null): Map<RequiredAssembly, Layer> => {
    const found = new Map<RequiredAssembly, Layer>();
    for (const assembly of REQUIRED_ASSEMBLIES) {
      const matches = sketch.layers.filter((l) => (!scope || scope.has(l.id)) && matchesAssembly(l.name, assembly));
      const layer = matches.find((l) => l.group) ?? matches[0];
      if (layer) found.set(assembly, layer);
    }
    return found;
  };
  if (rootHint !== undefined) {
    const root = sketch.layers.find((l) => l.id === rootHint) ?? sketch.layers.find((l) => l.name === rootHint);
    if (!root) throw new MeasuredFramesError(`page "${sketch.name}" has no layer "${rootHint}" to take the figure from`);
    const assemblies = within(new Set([root.id, ...descendantLayerIds(sketch, root.id)]));
    return { root: root.group ? root : null, assemblies: root.group ? assemblies : new Map([...assemblies].filter(([, l]) => l.id === root.id)) };
  }
  const assemblies = within(null);
  const roots = new Set([...assemblies.values()].map((layer) => topMostParent(sketch, layer).id));
  if (roots.size === 1) {
    const root = sketch.layers.find((l) => l.id === [...roots][0]);
    if (root?.group) return { root, assemblies: within(new Set([root.id, ...descendantLayerIds(sketch, root.id)])) };
  }
  if ([...assemblies.values()].every((layer) => !layer.parent)) return { root: null, assemblies };
  throw new MeasuredFramesError(
    `the assemblies on page "${sketch.name}" sit in more than one top-level group, so which figure to draw is not clear; name its group with the figure's root`,
  );
}

/** A figure measured as Animation Mode measures its source frame. */
interface FigureMeasure {
  pivots: Partial<Record<RequiredAssembly, AnimationPoint>>;
  figureHeight: number;
  figurePivot?: AnimationPoint;
  facing: AnimationFacing | null;
}

function measureFigure(sketch: Sketch, parts: readonly Layer[], assemblies: ReadonlyMap<RequiredAssembly, Layer>): FigureMeasure {
  const byLayer = strokesByLayer(sketch);
  const boundsOf = (layers: readonly Layer[]): AnimationBounds | null => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const layer of layers) {
      for (const id of [layer.id, ...descendantLayerIds(sketch, layer.id)]) {
        for (const stroke of byLayer.get(id) ?? []) {
          const b = strokeBounds(stroke, measureText);
          if (!b) continue;
          minX = Math.min(minX, b.minX);
          minY = Math.min(minY, b.minY);
          maxX = Math.max(maxX, b.maxX);
          maxY = Math.max(maxY, b.maxY);
        }
      }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  };

  const pivots: Partial<Record<RequiredAssembly, AnimationPoint>> = {};
  let top = Infinity;
  let bottom = -Infinity;
  for (const [assembly, layer] of assemblies) {
    const bounds = boundsOf([layer]);
    if (!bounds) continue;
    top = Math.min(top, bounds.minY);
    bottom = Math.max(bottom, bounds.maxY);
    const pivot = assemblyPivot(assembly, bounds);
    if (pivot) pivots[assembly] = pivot;
  }
  // A figure tips about the ground it stands on: the bottom-centre of its box.
  const whole = boundsOf(parts);
  const figurePivot = whole ? { x: (whole.minX + whole.maxX) / 2, y: whole.maxY } : undefined;

  // The facing, read off each foot inside a leg, as the app reads it.
  const spans: AnimationFootSpan[] = [];
  for (const [assembly, leg] of assemblies) {
    if (!assembly.endsWith('leg-assembly')) continue;
    const legBounds = boundsOf([leg]);
    if (!legBounds) continue;
    for (const id of descendantLayerIds(sketch, leg.id)) {
      const child = sketch.layers.find((l) => l.id === id);
      if (!child || !matchesFoot(child.name)) continue;
      const foot = boundsOf([child]);
      if (foot) spans.push({ leg: legBounds, foot });
    }
  }
  return { pivots, figureHeight: bottom > top ? bottom - top : 0, figurePivot, facing: figureFacing(spans) };
}

/** An SVG transform list - `translate(0 1.2) rotate(-3 20 140)` - as the script's transform verbs, in the same order. */
function transformVerbs(value: string | undefined): DocumentInstruction[] {
  const verbs: DocumentInstruction[] = [];
  for (const m of (value ?? '').matchAll(/(translate|rotate)\(([^)]*)\)/g)) {
    const n = m[2].trim().split(/[\s,]+/).map(Number);
    if (m[1] === 'translate') verbs.push({ verb: 'translate', dx: n[0], dy: n[1] ?? 0 });
    else verbs.push(n.length >= 3 ? { verb: 'rotate', angle: n[0], cx: n[1], cy: n[2] } : { verb: 'rotate', angle: n[0] });
  }
  return verbs;
}

/** True when a layer has nothing of its own for a copy to lose: full opacity, shown, unlocked, no effects. */
function plain(layer: Layer): boolean {
  return layer.opacity >= 1 && layer.visible && !layer.locked && !readEffects(layer.effects);
}

/**
 * One part of the figure as a document of its own, for a `use` to copy in.
 * A group with nothing of its own is re-rooted at its children, so the group
 * the `use` makes stands in for it and nothing nests twice; anything else -
 * a layer, or a group that is hidden, locked, faded or has effects - is kept
 * whole inside it. Null for a part with nothing in it.
 */
function partDocument(sketch: Sketch, part: Layer): Sketch | null {
  const keep = new Set([part.id, ...descendantLayerIds(sketch, part.id)]);
  const reroot = part.group === true && plain(part);
  const layers = sketch.layers
    .filter((layer) => keep.has(layer.id) && !(reroot && layer.id === part.id))
    .map((layer) => (layer.id === part.id || (reroot && layer.parent === part.id) ? { ...layer, parent: undefined } : { ...layer }));
  const strokes = sketch.strokes.filter((stroke) => keep.has(layerOf(sketch, stroke).id));
  if (layers.length === 0 || strokes.length === 0) return null;
  return { ...sketch, name: part.name, background: 'transparent', layers, strokes };
}

/**
 * Writes the script that draws a figure's frames from a measured cycle, and
 * the parts it copies in. Throws {@link MeasuredFramesError} for a type with
 * no measured cycle, a page with no assemblies, or assemblies spread over more
 * than one figure.
 */
export function measuredFramesScript(source: Sketch, options: MeasuredFramesOptions): MeasuredFrames {
  const type = measuredAnimationType(options.type);
  if (type === undefined) {
    throw new MeasuredFramesError(
      `"${options.type}" has no measured cycle; the types that do are ${MEASURED_ANIMATION_TYPES.join(', ')}`,
    );
  }
  const { root, assemblies } = findFigure(source, options.root);
  if (assemblies.size === 0) {
    throw new MeasuredFramesError(
      `page "${source.name}" has none of the assemblies a character animation turns - ${REQUIRED_ASSEMBLIES.join(', ')} - as layer names`,
    );
  }
  const count = clampSequenceFrames(options.frames ?? defaultSequenceFrames(type));

  // The figure's parts in paint order: the root group's children, or the
  // assemblies themselves when they sit at the top, as Animation Mode's
  // source is either.
  const childrenOf = (parent: string | undefined): Layer[] => source.layers.filter((layer) => layer.parent === parent);
  const parts = root ? childrenOf(root.id) : source.layers.filter((layer) => [...assemblies.values()].includes(layer));
  const measure = measureFigure(source, root ? [root] : parts, assemblies);
  const facing = options.facing ?? measure.facing ?? CYCLE_FACING;
  const facingFrom: MeasuredFrames['facingFrom'] = options.facing ? 'given' : measure.facing ? 'feet' : 'default';

  // Named as Animation Mode names the frames it draws from this source.
  const job = animationFrameJob(root?.name ?? null, type);
  const frames = Array.from({ length: count }, (_, i) => `${job.baseName}_${job.sourceIndex + 1 + i}`);

  // Each part once, as a document, under a name the script's use lines give it.
  const documents: Record<string, Sketch> = {};
  const keys = new Map<string, string>();
  const keyOf = (part: Layer): string | null => {
    const known = keys.get(part.id);
    if (known !== undefined) return known;
    const doc = partDocument(source, part);
    if (!doc) return null;
    let key = part.name;
    for (let n = 2; Object.prototype.hasOwnProperty.call(documents, key); n++) key = `${part.name} (${n})`;
    documents[key] = doc;
    keys.set(part.id, key);
    return key;
  };
  const assemblyOf = new Map([...assemblies].map(([assembly, layer]) => [layer.id, assembly]));
  const holdsAssembly = (layer: Layer): boolean =>
    [...descendantLayerIds(source, layer.id)].some((id) => assemblyOf.has(id));

  // A frame's parts: each assembly turned by its own transform, a group that
  // holds assemblies rebuilt around them, and everything else moved with the
  // figure, as the body is.
  const frameBody = (transforms: Partial<Record<RequiredAssembly, string>>): DocumentInstruction[] => {
    const emit = (layer: Layer): DocumentInstruction[] => {
      const assembly = assemblyOf.get(layer.id);
      if (!assembly && layer.group && holdsAssembly(layer)) {
        return [
          {
            verb: 'group',
            name: layer.name,
            ...(layer.opacity < 1 ? { opacity: layer.opacity } : {}),
            ...(layer.visible ? {} : { hidden: true }),
            ...(layer.locked ? { locked: true } : {}),
            body: childrenOf(layer.id).flatMap(emit),
          },
        ];
      }
      const key = keyOf(layer);
      if (!key) return [];
      const use: DocumentInstruction = key === layer.name ? { verb: 'use', name: key } : { verb: 'use', name: key, layer: layer.name };
      const turn = transformVerbs(transforms[assembly ?? 'body']);
      return turn.length > 0 ? [{ verb: 'push' }, ...turn, use, { verb: 'pop' }] : [use];
    };
    return parts.flatMap(emit);
  };

  const script: Instruction[] = [
    { verb: 'napkin', version: SCRIPT_VERSION },
    { verb: 'page', width: source.width, height: source.height },
    { verb: 'name', name: frames[0] },
    { verb: 'background', color: null },
  ];
  // The cycle's totals up to each frame, about the source's joints.
  const total: AnimationPoseStep = { shiftYPercent: 0, figureRotate: 0, rotate: {} };
  frames.forEach((name, i) => {
    const step = animationPoseStep(type, i + 1, count);
    if (step) {
      total.shiftYPercent = round2(total.shiftYPercent + step.shiftYPercent);
      total.figureRotate = round2((total.figureRotate ?? 0) + (step.figureRotate ?? 0));
      for (const [assembly, degrees] of Object.entries(step.rotate) as Array<[RequiredAssembly, number]>) {
        total.rotate[assembly] = round2((total.rotate[assembly] ?? 0) + degrees);
      }
    }
    const transforms = animationFrameTransforms(
      { ...total, rotate: { ...total.rotate } },
      measure.pivots,
      measure.figureHeight,
      measure.figurePivot,
      facing,
    );
    if (i > 0) script.push({ verb: 'newpage', name });
    script.push({
      verb: 'group',
      name,
      ...(root && root.opacity < 1 ? { opacity: root.opacity } : {}),
      body: frameBody(transforms),
    });
  });

  // One box for every page: the frames' ink, run once to be measured.
  const run = evaluate(script, { documents, name: frames[0] });
  const errors = run.diagnostics.filter((d) => d.level === 'error');
  if (errors.length > 0) {
    throw new MeasuredFramesError(`the frames did not draw: ${errors.map((d) => formatDiagnostic(d, 'frames.napkin')).join('; ')}`);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const page of run.book.sketches) {
    const ink = inkBox(page);
    if (!ink) continue;
    minX = Math.min(minX, ink.x);
    minY = Math.min(minY, ink.y);
    maxX = Math.max(maxX, ink.x + ink.width);
    maxY = Math.max(maxY, ink.y + ink.height);
  }
  if (!Number.isFinite(minX)) throw new MeasuredFramesError(`the figure on page "${source.name}" has nothing drawn in it`);
  const registration: Box = { x: round2(minX), y: round2(minY), width: round2(maxX - minX), height: round2(maxY - minY) };
  script.push({ verb: 'registration', ...registration });

  return { script, text: formatScript(script), documents, frames, facing, facingFrom, registration };
}
