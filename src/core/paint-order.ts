/**
 * The order the canvas paints a page in, as steps both the painter and the
 * hit test walk, so that what a click picks is what is on top of the screen.
 *
 * Paint follows the layer stack, bottom first - not the page's list of marks,
 * which gains a mark at its end whatever layer the mark lands on, and which
 * moving a layer up or down leaves as it was. A drawing layer paints its own
 * marks in the list's order. A group with effects is the exception: it paints
 * everything it holds as one picture, laid down where its first painting
 * layer would have been, so a drop shadow falls under the whole group rather
 * than under each of its parts. A clip group paints as one picture too, which
 * its clip then cuts to the clip mark's interior (core/clip.ts), and so does a
 * group with a blend or Isolate Blending (core/blend.ts).
 *
 * Nothing here touches the DOM.
 */

import { layerUnders, markUnders } from './appearance.js';
import { isBlended } from './blend.js';
import { activeEffects } from './effects.js';
import { strokesByLayer, type Layer, type Sketch, type Stroke } from './types.js';

/** What the steps are worked out from: the layers by id, and the groups that paint as one picture. */
export interface PaintIndex {
  readonly byId: ReadonlyMap<string, Layer>;
  /** Groups that paint as one picture: see {@link pictureGroupIds}. */
  readonly pictureGroups: ReadonlySet<string>;
}

/**
 * Whether a group paints as one picture whatever it holds: it has effects, a
 * clip to cut the picture with, a blend to lay the picture down with, or
 * Isolate Blending, which keeps the blends inside it from reaching past it.
 */
export function paintsAsPicture(layer: Layer): boolean {
  return (
    layer.group === true &&
    (activeEffects(layer.effects) !== undefined || layer.clip !== undefined || isBlended(layer.blend) || layer.isolate === true)
  );
}

/**
 * The groups of a page that paint as one picture: those that do whatever they
 * hold ({@link paintsAsPicture}), and a group with an opacity below 1 that
 * holds a blended layer, or a layer or a mark that lays a shadow under itself
 * by a blend (core/appearance.ts's markUnders and layerUnders).
 *
 * SVG, PDF and the headless renderer all composite a translucent group as one
 * picture, so a blend inside one mixes only with what else the group holds.
 * The canvas otherwise passes a group's opacity down to each layer in it; with
 * a blend inside, that would mix with the page under the group, and the
 * drawing would not look like its exports. Without one there is nothing to
 * tell the two apart, so the canvas keeps its cheaper way.
 */
export function pictureGroupIds(sketch: Sketch): Set<string> {
  const ids = new Set(sketch.layers.filter(paintsAsPicture).map((layer) => layer.id));
  const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
  const mixing = mixingLayers(sketch);
  for (const layer of sketch.layers) {
    if (!mixing.has(layer.id)) continue;
    const seen = new Set<string>();
    for (let at = layer.parent ? byId.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
      seen.add(at.id);
      if (at.group && at.opacity < 1) ids.add(at.id);
    }
  }
  return ids;
}

/** One step of painting a scope: a drawing layer's marks, or a group painted as one picture. */
export type PaintStep = { kind: 'leaf'; layer: Layer } | { kind: 'group'; group: Layer };

export function paintIndex(sketch: Sketch): PaintIndex {
  return {
    byId: new Map(sketch.layers.map((layer) => [layer.id, layer])),
    pictureGroups: pictureGroupIds(sketch),
  };
}

/**
 * The layers of a page that mix with what is under them by anything but
 * Normal: those with a blend, those that lay a shadow under themselves by one,
 * and those holding a mark that does.
 */
function mixingLayers(sketch: Sketch): Set<string> {
  const ids = new Set(sketch.layers.filter((layer) => isBlended(layer.blend) || layerUnders(layer).length > 0).map((layer) => layer.id));
  for (const stroke of sketch.strokes) {
    if (stroke.layer && stroke.effects && markUnders(stroke).length > 0) ids.add(stroke.layer);
  }
  return ids;
}

/**
 * Whether anything on a page mixes with what is under it by a blend - a
 * layer, or a shadow laid under its layer or its mark: what decides that the
 * canvas puts the paper under the ink.
 */
export function pageBlends(sketch: Sketch): boolean {
  return mixingLayers(sketch).size > 0;
}

/** Whether `layer` sits somewhere inside `group`. */
export function isUnder(layer: Layer, group: Layer, index: PaintIndex): boolean {
  const seen = new Set<string>();
  for (
    let at = layer.parent ? index.byId.get(layer.parent) : undefined;
    at && !seen.has(at.id);
    at = at.parent ? index.byId.get(at.parent) : undefined
  ) {
    if (at.id === group.id) return true;
    seen.add(at.id);
  }
  return false;
}

/** The outermost group painting as one picture between `layer` and `scope`, which paints `layer` as part of it. */
export function effectGroupOf(layer: Layer, scope: Layer | null, index: PaintIndex): Layer | null {
  if (index.pictureGroups.size === 0) return null;
  let found: Layer | null = null;
  const seen = new Set<string>();
  for (
    let at = layer.parent ? index.byId.get(layer.parent) : undefined;
    at && !seen.has(at.id);
    at = at.parent ? index.byId.get(at.parent) : undefined
  ) {
    if (scope && at.id === scope.id) break;
    seen.add(at.id);
    if (index.pictureGroups.has(at.id)) found = at;
  }
  return found;
}

/**
 * The steps that paint the layers under `scope` - the page when it is null -
 * bottom first: each drawing layer that `paints`, or, where that layer sits
 * inside a group with effects, the group, once, where its first painting
 * layer comes. The painter skips what does not paint in the same place, so a
 * hidden layer never decides where its group's picture goes.
 */
export function paintSteps(
  sketch: Sketch,
  scope: Layer | null,
  index: PaintIndex,
  paints: (layer: Layer) => boolean,
): PaintStep[] {
  const steps: PaintStep[] = [];
  const done = new Set<string>();
  for (const layer of sketch.layers) {
    if (layer.group || !paints(layer)) continue;
    if (scope && !isUnder(layer, scope, index)) continue;
    const group = effectGroupOf(layer, scope, index);
    if (group) {
      if (!done.has(group.id)) {
        done.add(group.id);
        steps.push({ kind: 'group', group });
      }
      continue;
    }
    steps.push({ kind: 'leaf', layer });
  }
  return steps;
}

/**
 * The drawing layers in the order the canvas paints them, bottom first, each
 * with its marks in the order they paint: the leaves of {@link paintSteps},
 * with a group's picture opened out in place. Each layer paints on a canvas
 * of its own, so an eraser cuts only the marks before it in its own layer.
 * `paints` says which layers paint at all - the visible ones, for the canvas
 * - and every layer does when it is left out.
 */
export function paintLeaves(
  sketch: Sketch,
  paints: (layer: Layer) => boolean = () => true,
): Array<{ layer: Layer; strokes: Stroke[] }> {
  const index = paintIndex(sketch);
  const byLayer = strokesByLayer(sketch);
  const out: Array<{ layer: Layer; strokes: Stroke[] }> = [];
  const walk = (scope: Layer | null): void => {
    for (const step of paintSteps(sketch, scope, index, paints)) {
      if (step.kind === 'group') walk(step.group);
      else out.push({ layer: step.layer, strokes: byLayer.get(step.layer.id) ?? [] });
    }
  };
  walk(null);
  return out;
}

/** Every mark on the page in the order the canvas paints it, bottom first: {@link paintLeaves}, flattened. */
export function paintOrder(sketch: Sketch, paints: (layer: Layer) => boolean = () => true): Stroke[] {
  return paintLeaves(sketch, paints).flatMap((leaf) => leaf.strokes);
}
