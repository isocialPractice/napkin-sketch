/**
 * Clipping masks: a group whose content shows only inside one closed mark in
 * it - its clip - as a vector editor's Object > Clipping Mask makes one.
 *
 * A group layer's `clip` names the mark. The mark paints nothing while it
 * clips, and keeps its paint for Release to show again; what the group holds
 * paints only inside the mark's interior, under the non-zero rule every fill
 * paints with. A group inside a clipped group is clipped by both.
 *
 * {@link makeClip} says what Make Clipping Mask does with the selected marks
 * - the topmost clips, when it is closed, and their layers are grouped - and
 * {@link releaseClip} which group Release takes the clip off. What paints,
 * picks and boxes a mark asks of {@link clipIndex}: the marks that clip, and
 * the clips each layer is under, worked out once for a page.
 *
 * Nothing here touches the DOM, and nothing is changed but by
 * {@link normalizeClips}: the store makes the group, one undo step.
 */

import { paintOrder } from './paint-order.js';
import { isClosedStroke, isImageStroke, isTextStroke, layerOf, type Layer, type Point, type Sketch, type Stroke } from './types.js';

type Vec = { x: number; y: number };

/** A box on the page. */
export interface ClipBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What Make Clipping Mask names the group it makes. */
export const CLIP_GROUP_NAME = 'Clip Group';

/** Why Make Clipping Mask cannot make one: fewer than two marks selected, or an open path on top. */
export type ClipProblem = 'too-few' | 'open';

/** One clip: the group, the mark it clips with, that mark's interior as contours, and their bounds. */
export interface Clip {
  group: Layer;
  mark: Stroke;
  region: Vec[][];
  bounds: ClipBox;
}

/**
 * Whether a mark can clip: a closed shape, by the Shape Eraser's Top Path
 * test - a mark the Eraser can cut (not text, a picture, a placed file or an
 * older file's eraser mark) whose path is closed.
 */
export function canClip(stroke: Stroke): boolean {
  if (stroke.tool === 'eraser' || isTextStroke(stroke) || isImageStroke(stroke) || stroke.link || stroke.points.length === 0) return false;
  return stroke.vector?.closed === true || isClosedStroke(stroke);
}

/** A mark's points as contours: a `move` starts the next. */
function ringsOf(points: readonly Point[]): Vec[][] {
  const rings: Vec[][] = [];
  for (const p of points) {
    if (p.move || rings.length === 0) rings.push([]);
    rings[rings.length - 1].push({ x: p.x, y: p.y });
  }
  return rings;
}

/** Whether `layer` sits somewhere inside `group`. */
function inside(layer: Layer, group: Layer, byId: ReadonlyMap<string, Layer>): boolean {
  const seen = new Set<string>();
  for (let at = layer.parent ? byId.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
    if (at.id === group.id) return true;
    seen.add(at.id);
  }
  return false;
}

/** A mark's interior as contours, each subpath one, and their bounds; null for one with fewer than three points. */
function regionOf(mark: Stroke): { region: Vec[][]; bounds: ClipBox } | null {
  const region = ringsOf(mark.points).filter((ring) => ring.length >= 3);
  if (region.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of region) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { region, bounds: { minX, minY, maxX, maxY } };
}

/**
 * The clip a group clips with: its `clip` mark when that names a closed mark
 * somewhere inside the group, with its region; null otherwise.
 */
function clipOf(group: Layer, byId: ReadonlyMap<string, Layer>, marks: ReadonlyMap<string, Stroke>): Clip | null {
  if (!group.group || !group.clip) return null;
  const mark = marks.get(group.clip);
  if (!mark || !canClip(mark)) return null;
  const layer = byId.get(mark.layer ?? '');
  if (!layer || !inside(layer, group, byId)) return null;
  const shape = regionOf(mark);
  return shape ? { group, mark, ...shape } : null;
}

/** The mark a group clips with, or null when it clips nothing. */
export function clipMarkOf(sketch: Sketch, group: Layer): Stroke | null {
  const byId = new Map(sketch.layers.map((l) => [l.id, l]));
  return clipOf(group, byId, new Map(sketch.strokes.map((s) => [s.id, s])))?.mark ?? null;
}

/** A group's clip as a region - its clip mark's interior, a contour for each subpath - or null when it clips nothing. */
export function clipRegionOf(sketch: Sketch, group: Layer): Vec[][] | null {
  const byId = new Map(sketch.layers.map((l) => [l.id, l]));
  return clipOf(group, byId, new Map(sketch.strokes.map((s) => [s.id, s])))?.region ?? null;
}

/** Every clip on a page: the marks that clip, and the clips each layer sits under, innermost first. */
export interface ClipIndex {
  /** The marks that clip, which paint nothing while they do. */
  readonly marks: ReadonlySet<string>;
  /** Whether the page has any clip at all. */
  readonly any: boolean;
  /** Each clip group's clip, by the group's id. */
  readonly byGroup: ReadonlyMap<string, Clip>;
  /** The clips `layer` sits under, innermost first. */
  of(layer: Layer): readonly Clip[];
}

const NO_CLIPS: readonly Clip[] = [];

/** A page with no clips, which is most of them: nothing clips and nothing is clipped. */
const NO_INDEX: ClipIndex = { marks: new Set<string>(), any: false, byGroup: new Map<string, Clip>(), of: () => NO_CLIPS };

/** The page's clips, worked out once: what painting, picking and boxes ask of every mark. */
export function clipIndex(sketch: Sketch): ClipIndex {
  if (!sketch.layers.some((l) => l.group && l.clip)) return NO_INDEX;
  const byId = new Map(sketch.layers.map((l) => [l.id, l]));
  const marks = new Map(sketch.strokes.map((s) => [s.id, s]));
  const clips = new Map<string, Clip>();
  for (const layer of sketch.layers) {
    const clip = clipOf(layer, byId, marks);
    if (clip) clips.set(layer.id, clip);
  }
  if (clips.size === 0) return NO_INDEX;
  const memo = new Map<string, readonly Clip[]>();
  return {
    marks: new Set([...clips.values()].map((clip) => clip.mark.id)),
    any: true,
    byGroup: clips,
    of(layer: Layer): readonly Clip[] {
      const held = memo.get(layer.id);
      if (held) return held;
      const found: Clip[] = [];
      const seen = new Set<string>();
      for (let at = layer.parent ? byId.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
        seen.add(at.id);
        const clip = clips.get(at.id);
        if (clip) found.push(clip);
      }
      const out = found.length > 0 ? found : NO_CLIPS;
      memo.set(layer.id, out);
      return out;
    },
  };
}

/** The winding number of a point under contours, as the non-zero rule counts it. */
function windingAt(p: Vec, rings: readonly (readonly Vec[])[]): number {
  let wn = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) wn++;
      } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) {
        wn--;
      }
    }
  }
  return wn;
}

/** Whether a point is inside a clip's region. */
export function insideClip(clip: Clip, p: Vec): boolean {
  return p.x >= clip.bounds.minX && p.x <= clip.bounds.maxX && p.y >= clip.bounds.minY && p.y <= clip.bounds.maxY && windingAt(p, clip.region) !== 0;
}

/**
 * Whether a mark is clipped away at `p`: `p` lies outside the clip of a group
 * the mark sits in. A clip mark itself shows nowhere while it clips.
 */
export function clippedAt(sketch: Sketch, stroke: Stroke, p: Vec, index: ClipIndex = clipIndex(sketch)): boolean {
  if (!index.any) return false;
  if (index.marks.has(stroke.id)) return true;
  return index.of(layerOf(sketch, stroke)).some((clip) => !insideClip(clip, p));
}

/**
 * A mark's bounds as it shows: cut to the bounds of every clip it sits under,
 * or null when that leaves nothing. A group's clip mark gives its group's
 * clip bounds, which is what a selection of the whole group boxes.
 */
export function shownBounds(sketch: Sketch, stroke: Stroke, bounds: ClipBox, index: ClipIndex = clipIndex(sketch)): ClipBox | null {
  if (!index.any) return bounds;
  let box: ClipBox = bounds;
  for (const clip of index.of(layerOf(sketch, stroke))) {
    const minX = Math.max(box.minX, clip.bounds.minX);
    const minY = Math.max(box.minY, clip.bounds.minY);
    const maxX = Math.min(box.maxX, clip.bounds.maxX);
    const maxY = Math.min(box.maxY, clip.bounds.maxY);
    if (minX > maxX || minY > maxY) return null;
    box = { minX, minY, maxX, maxY };
  }
  return box;
}

/**
 * What Make Clipping Mask does with the marks of `ids`: the topmost of them
 * in paint order clips, when it is closed, and the layers they are on are
 * grouped; or why it cannot - fewer than two marks, or an open path on top.
 */
export function makeClip(sketch: Sketch, ids: Iterable<string>): { clip: Stroke; layers: string[] } | { problem: ClipProblem } {
  const wanted = new Set(ids);
  const marks = paintOrder(sketch).filter((s) => wanted.has(s.id) && s.tool !== 'eraser');
  if (marks.length < 2) return { problem: 'too-few' };
  const clip = marks[marks.length - 1];
  if (!canClip(clip)) return { problem: 'open' };
  return { clip, layers: [...new Set(marks.map((s) => layerOf(sketch, s).id))] };
}

/**
 * The clip group Release Clipping Mask takes the clip off for a layer: the
 * layer itself when it is one, or the nearest group round it that clips;
 * null when there is none.
 */
export function releaseClip(sketch: Sketch, layerId: string): Layer | null {
  const byId = new Map(sketch.layers.map((l) => [l.id, l]));
  const marks = new Map(sketch.strokes.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (let at = byId.get(layerId); at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
    seen.add(at.id);
    if (clipOf(at, byId, marks)) return at;
  }
  return null;
}

/** Takes `clip` off every layer it does not name a closed mark inside. Returns whether any was taken off. */
export function normalizeClips(sketch: Sketch): boolean {
  const byId = new Map(sketch.layers.map((l) => [l.id, l]));
  const marks = new Map(sketch.strokes.map((s) => [s.id, s]));
  let changed = false;
  for (const layer of sketch.layers) {
    if (layer.clip === undefined) continue;
    if (!clipOf(layer, byId, marks)) {
      delete layer.clip;
      changed = true;
    }
  }
  return changed;
}

/** A clip's contours as SVG path data: each ring a closed subpath. */
export function clipPathData(region: readonly (readonly Point[] | readonly Vec[])[], decimals = 2): string {
  const f = 10 ** decimals;
  const n = (v: number): string => String(Math.round(v * f) / f);
  return region.map((ring) => ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join(' ') + ' Z').join(' ');
}
