/**
 * A composition's effects as its renderers draw them: switched-off effects
 * gone, and an element whose effects aim at its fill or its stroke drawn as a
 * group of the two (core/effects.ts's effectPlan). The SVG writer, the canvas
 * painter and the rasterizer all start from the same resolved tree, so they
 * draw the same thing.
 *
 * Nothing here reads the DOM.
 */

import { blendModeOf, isBlended } from '../blend.js';
import { EFFECT_LABELS, effectPlan, GEOMETRY_EFFECT_TYPES, readEffects, untargeted, type Effect, type MarkParts } from '../effects.js';
import { elementMatrix, shapeCentre } from './geometry.js';
import type { Element } from './types.js';

/** The parts an element has to aim an effect at: null for a group, which has none of its own. */
export function partsOf(el: Element): MarkParts | null {
  switch (el.type) {
    case 'group':
      return null;
    case 'image':
      return { fill: false, stroke: false };
    case 'text':
      // Text fills unless told not to: its glyphs are its fill.
      return { fill: el.fill !== null, stroke: Boolean(el.stroke) };
    default:
      return { fill: Boolean(el.fill), stroke: Boolean(el.stroke) };
  }
}

/** A list as an element carries it: undefined when it has nothing in it. */
function listOrNone(effects: readonly Effect[]): Effect[] | undefined {
  return effects.length > 0 ? untargeted(effects) : undefined;
}

/**
 * One element with its effects resolved: those switched off left out, and an
 * element with a fill and a stroke whose effects aim at either one turned into
 * a group - its frame (transform, clip, opacity, blend) and the effects on the
 * whole of it - around a fill-only and a stroke-only copy, each with its own
 * effects, the stroke on top as SVG paints it. The group is isolated, so a
 * part's own blended shadow mixes with the part under it and no further; the
 * whole element's shadows still mix with what is under it. An effect that is
 * not one is left out, and `warn` says so; so is a geometry effect - a
 * Splatter - which draws on a napkin mark's shape (core/geometry-effects.ts)
 * and has no element form.
 */
function resolveOne(el: Element, warn?: (message: string) => void): Element {
  const read = el.effects === undefined ? undefined : readEffects(el.effects);
  if (el.effects && (read?.length ?? 0) < el.effects.length) warn?.(`${el.type}: an effect it does not know was left out`);
  for (const effect of read ?? []) {
    if (GEOMETRY_EFFECT_TYPES.has(effect.type) && effect.on !== false) {
      warn?.(`${el.type}: ${EFFECT_LABELS[effect.type]} draws on a sketch's marks, not on an element, and was left out`);
    }
  }
  const on = read?.filter((effect) => effect.on !== false && !GEOMETRY_EFFECT_TYPES.has(effect.type));
  const own = on && on.length > 0 ? on : undefined;
  const children = el.type === 'group' ? resolveAppearance(el.children, warn) : undefined;
  const base = (children ? { ...el, children } : el) as Element;
  if (!own) return el.effects === undefined && !children ? el : ({ ...base, effects: undefined } as Element);
  const plan = effectPlan(own, partsOf(el));
  if (!plan.split) return { ...base, effects: listOrNone(plan.object) } as Element;
  const plain = {
    ...el,
    id: undefined,
    name: undefined,
    visible: undefined,
    opacity: undefined,
    clip: undefined,
    blend: undefined,
    rotate: undefined,
    scale: undefined,
    translate: undefined,
    origin: undefined,
    effects: undefined,
  };
  return {
    type: 'group',
    ...(el.id !== undefined ? { id: el.id } : {}),
    ...(el.name !== undefined ? { name: el.name } : {}),
    ...(el.visible !== undefined ? { visible: el.visible } : {}),
    ...(el.opacity !== undefined ? { opacity: el.opacity } : {}),
    ...(el.clip !== undefined ? { clip: el.clip } : {}),
    ...(el.blend !== undefined ? { blend: el.blend } : {}),
    ...(el.rotate !== undefined ? { rotate: el.rotate } : {}),
    ...(el.scale !== undefined ? { scale: el.scale } : {}),
    ...(el.translate !== undefined ? { translate: el.translate } : {}),
    // The group turns about the element's own centre, not its own.
    origin: el.origin ?? shapeCentre(el),
    // A part's shadow or glow mixes with the other part under it, and no further.
    isolate: true,
    effects: listOrNone(plan.object),
    children: [
      { ...plain, stroke: null, effects: listOrNone(plan.fill) } as Element,
      { ...plain, fill: null, effects: listOrNone(plan.stroke) } as Element,
    ],
  };
}

/** A composition's elements with every effect resolved (see resolveOne). An element with nothing to resolve is the same object. */
export function resolveAppearance(elements: readonly Element[], warn?: (message: string) => void): Element[] {
  return elements.map((el) => resolveOne(el, warn));
}

/**
 * Whether an element's Outer Shadows and Outer Glows that blend can be laid
 * under it on their own, mixing with what is under it (core/effects.ts's
 * effectLayout): only when it is laid down just as it is drawn - solid, by
 * no blend of its own, through no clip, with nothing to erase, and with no
 * transform of its own, which a filter's lengths would follow in one output
 * and not in another. Otherwise they stay in its picture.
 */
export function canSeparate(el: Element): boolean {
  if ((el.opacity ?? 1) < 1 || el.clip || isBlended(blendModeOf(el.blend))) return false;
  if (el.type === 'group' && (el.erase?.length ?? 0) > 0) return false;
  const m = elementMatrix(el, shapeCentre(el));
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}
