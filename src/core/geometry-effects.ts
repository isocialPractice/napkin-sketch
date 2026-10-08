/**
 * The geometry effects: what a mark draws once they have done their work.
 *
 * A geometry effect changes a mark's drawing rather than its picture. A Warp
 * (core/warp-styles.ts) bends the mark - or, on a layer or a group, all it
 * holds, as one - over the box of what it bends. A Splatter (core/splatter.ts)
 * draws the mark's fill, or aimed at its stroke its stroke's ink, as a loose
 * hatch. 3D (core/three-d/) builds the mark in depth and draws it as shaded
 * faces. They work before any raster effect, whatever their place in the
 * list, since a raster effect needs the shape to work on; among themselves
 * they work in the list's order, a mark's own before its layers', inner
 * layers before outer ones, each on what the one before it made.
 *
 * What comes out is the mark bent whole, drawn as the mark always is
 * ({@link drawnMark}); or - when a Splatter drew a part anew, or a Warp was
 * aimed at one part - its two parts, fill under stroke ({@link drawnPart};
 * core/appearance.ts's markEffectPlan splits such a mark); or, once 3D built
 * it, its faces, far first, each a plain filled mark. Every output reads
 * these - the canvas, the SVG, the PNG, the PDF and the Illustrator script -
 * and so do a mark's bounds (core/bounds.ts) and its hits (core/hit-test.ts),
 * so a mark is found where it is seen.
 *
 * A layer's or a group's Warp reaches its marks through {@link bindGeometry},
 * which lays it on each with the box of everything the layer holds. Whatever
 * draws or measures a sketch binds it first; the app's store binds its page
 * at every change.
 *
 * Text takes them through its glyphs' outlines (core/type/outline.ts), while
 * a source of them is current: the text is its shapes - the frame's paint,
 * the highlights, a mark a run of one color, the markers and the lines - and
 * a Warp bends them all over one box, a Splatter hatches each, and 3D builds
 * every glyph as one solid. A text whose font cannot be read draws as text.
 *
 * The results are kept per mark, and worked out again only when the mark, its
 * paint, its text, its effects, the layers' warps over it or the outline
 * source change. Pictures and erasers take no geometry effect.
 */

import { expandAppearance, markParts, partOnly, registerGeometryEffect, registerTextShapes } from './appearance.js';
import { booleanRegions, type Vec } from './boolean.js';
import { activeGeometryEffects, GEOMETRY_EFFECT_TYPES, type Effect, type EffectOf } from './effects.js';
import { mapStrokeGeometry } from './mesh-warp.js';
import { copicNibPolygons } from './nib.js';
import { sampleOutline } from './path-data.js';
import { splatterAnchors, splatterPaths } from './splatter.js';
import { profileInputOf, profileOutline } from './stroke-profile.js';
import { createId, isImageStroke, isTextStroke, type Layer, type Point, type Stroke, type VectorAnchor } from './types.js';
import { facePoints, render3d, threeDView, type Face, type ThreeDView } from './three-d/render.js';
import { accentGeneration, currentAccentTheme } from './type/accents.js';
import { layoutType } from './type/layout.js';
import { typeShown } from './type/markdown-flow.js';
import { mergedByColor, mergedSolid, outlineSource, outlineText, type OutlinedMark } from './type/outline.js';
import { warpStyleMap, type WarpBox } from './warp-styles.js';

/** The marks that draw a mark's two parts, once its geometry effects have done their work. */
export interface GeometryParts {
  /** What draws the fill: the hatch, when a Splatter drew it; the fill bent, when a Warp bent it; else the fill alone. */
  fill: Stroke;
  /** What draws the stroke: the hatch of its ink, its line bent, or the stroke alone. */
  stroke: Stroke;
  /** Which parts a geometry effect drew anew or bent: the outputs that keep a mark's source beside what it draws say so. */
  changed: { fill: boolean; stroke: boolean };
}

/** What a mark draws once its geometry effects have done their work: itself bent whole, its two parts, or its 3D faces. */
export type DrawnGeometry =
  | { whole: Stroke; parts: null; faces: null }
  | { whole: null; parts: GeometryParts; faces: null }
  | { whole: null; parts: null; faces: Stroke[] };

/** A layer's warp laid on a mark it holds: over the box of everything the layer holds. */
interface InheritedWarp {
  /** The layer or group it is on. */
  layer: string;
  effect: EffectOf<'warp'>;
  box: WarpBox;
}

/** The warps each mark's layers lay on it, inner layers first, as the last bind of its sketch found them. */
const inherited = new WeakMap<Stroke, readonly InheritedWarp[]>();

/** Whether a mark has a shape a geometry effect can work on: not a picture or an eraser; text, while its outlines can be read. */
function drawsShape(stroke: Stroke): boolean {
  if (stroke.tool === 'eraser' || isImageStroke(stroke)) return false;
  return !isTextStroke(stroke) || outlineSource() !== null;
}

/** The text being typed, by id: it draws as text while it is, so its caret and its selection stand where its characters do. */
let typing: string | null = null;

/** Says which text is being typed - null when none is - for it to draw as text until it is put down. */
export function setTypingText(id: string | null): void {
  typing = id;
}

/** Whether a geometry effect draws on this mark: one is on, its own or its layers', and the mark has a shape for it. */
export function drawsGeometry(stroke: Stroke): boolean {
  if (!drawsShape(stroke)) return false;
  if (typing !== null && stroke.id === typing && isTextStroke(stroke)) return false;
  return activeGeometryEffects(stroke.effects) !== undefined || inherited.has(stroke);
}

interface Kept {
  key: string;
  points: readonly Point[];
  count: number;
  sum: number;
  drawn: DrawnGeometry | null;
}

const kept = new WeakMap<Stroke, Kept>();

/**
 * A cheap fingerprint of a mark's points and anchors: the store moves a mark
 * by moving them in place, and a Warp carries the anchors, not the points.
 */
function checksum(stroke: Stroke): number {
  const points = stroke.points;
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].x * (i % 7 + 1) + points[i].y * (i % 11 + 3);
  const anchors = stroke.vector?.anchors ?? [];
  for (let i = 0; i < anchors.length; i++) {
    const { p, hIn, hOut } = anchors[i];
    sum += p.x * (i % 5 + 2) + p.y * (i % 13 + 1);
    if (hIn) sum += hIn.x * 0.37 + hIn.y * 0.53;
    if (hOut) sum += hOut.x * 0.61 + hOut.y * 0.29;
  }
  return sum + anchors.length * 1e-3;
}

/** The marks a drag is turning in 3D, by id: drawn in draft until it lets go (core/three-d/render.ts's render3d). */
const drafts = new Set<string>();

/**
 * Draws these marks' 3D in draft - their revolves in fewer steps - so a
 * gumball drag's frames stay quick; an empty list draws every mark in full
 * again. A mark's drawing is worked out again when it goes in or out.
 */
export function setThreeDDrafts(ids: Iterable<string>): void {
  drafts.clear();
  for (const id of ids) drafts.add(id);
}

/** Everything what a mark draws depends on but its points and anchors. */
function keyOf(stroke: Stroke): string {
  return JSON.stringify([
    drafts.has(stroke.id),
    stroke.effects,
    inherited.get(stroke),
    stroke.fill,
    stroke.gradient,
    stroke.color,
    stroke.width,
    stroke.noStroke,
    stroke.tool,
    stroke.profile,
    stroke.profileMirrored,
    stroke.strokeStyle,
    stroke.vector?.closed,
    stroke.nibAngle,
    stroke.smudges,
    ...(isTextStroke(stroke) ? [stroke.text, stroke.typeset, stroke.fontSize, stroke.fontFamily, stroke.textBoxWidth, outlineSource()?.id] : []),
    // A Markdown Flow text's outlines are its display's, which the caret and the lexer change; code's colors follow the
    // highlighter, the options and the paper.
    ...(isTextStroke(stroke) && stroke.typeset?.flow === 'markdown' ? [typeShown(stroke).text] : []),
    ...(isTextStroke(stroke) && (stroke.typeset?.flow === 'markdown' || stroke.typeset?.paras?.some((para) => para?.accent)) ? [accentGeneration(), currentAccentTheme().id] : []),
  ]);
}

/**
 * What a mark draws once its geometry effects have done their work, or null
 * when none draws on it - and then it draws as it always has.
 */
export function geometryOf(stroke: Stroke): DrawnGeometry | null {
  if (!drawsGeometry(stroke)) return null;
  const key = keyOf(stroke);
  const points = stroke.points;
  const sum = checksum(stroke);
  const was = kept.get(stroke);
  if (was && was.key === key && was.points === points && was.count === points.length && was.sum === sum) return was.drawn;
  const drawn = work(stroke);
  kept.set(stroke, { key, points, count: points.length, sum, drawn });
  return drawn;
}

/** Each worked-out result's number, so a picture kept of it knows when it changed. */
const versions = new WeakMap<DrawnGeometry, number>();
let nextVersion = 1;

/**
 * A key that changes whenever what a mark's geometry effects draw changes -
 * a layer's Warp over a sibling that moved included - and is empty when none
 * draws on it: for a picture kept of the mark to be worked out again.
 */
export function geometryKey(stroke: Stroke): string {
  const drawn = geometryOf(stroke);
  if (!drawn) return '';
  let version = versions.get(drawn);
  if (version === undefined) {
    version = nextVersion++;
    versions.set(drawn, version);
  }
  return `g${version}`;
}

/** What a 3D effect built a mark's faces from: the effect, and the mark as the effects before it left it. */
interface Built {
  effect: EffectOf<'3d'>;
  source: Stroke;
  /** True when a Warp after it, or a layer's, bent the faces it built. */
  bent: boolean;
  view?: ThreeDView | null;
}

const builds = new WeakMap<DrawnGeometry, Built>();

/**
 * The 3D a mark is built with and its view - where its solid stands, turned
 * and moved - for the gumball, whose handles stand on it. Null when no 3D
 * builds the mark, or when a Warp bends the faces it built, which the
 * gumball's straight handles could not follow.
 */
export function threeDBuildOf(stroke: Stroke): { effect: EffectOf<'3d'>; view: ThreeDView } | null {
  const drawn = geometryOf(stroke);
  const built = drawn ? builds.get(drawn) : undefined;
  if (!built || built.bent) return null;
  if (built.view === undefined) built.view = threeDView(built.source, built.effect);
  return built.view ? { effect: built.effect, view: built.view } : null;
}

/** The marks a mark's two parts draw as, when they are drawn apart; null when it draws whole. */
export function geometryParts(stroke: Stroke): GeometryParts | null {
  return geometryOf(stroke)?.parts ?? null;
}

/** The mark as it draws whole: bent, when a Warp bent all of it; else itself. */
export function drawnMark(stroke: Stroke): Stroke {
  return geometryOf(stroke)?.whole ?? stroke;
}

/** The mark that draws one part of a mark, its geometry effects done: what each output draws a split mark's part with. */
export function drawnPart(stroke: Stroke, part: 'fill' | 'stroke'): Stroke {
  const drawn = geometryOf(stroke);
  if (drawn?.parts) return drawn.parts[part];
  return partOnly(drawn?.whole ?? stroke, part);
}

/**
 * The marks that draw a mark once its geometry effects have done their work -
 * itself bent, its two parts, fill first, the empty one left out, or its 3D
 * faces, far first - or null when none draws on it.
 */
export function drawnMarks(stroke: Stroke): Stroke[] | null {
  const drawn = geometryOf(stroke);
  if (!drawn) return null;
  if (drawn.whole) return [drawn.whole];
  if (drawn.faces) return drawn.faces;
  return [drawn.parts!.fill, drawn.parts!.stroke].filter((part) => part.points.length > 0);
}

/**
 * The box what a mark's geometry effects draw covers, in its points' terms,
 * or null when none draws on it - and then its own points are its box. A
 * part drawn with a line wider than the mark's own is grown by the
 * difference, since every caller grows a mark's box by the mark's own width.
 * `bounds` measures a plain mark.
 */
export function geometryBounds(
  stroke: Stroke,
  bounds: (mark: Stroke) => { minX: number; minY: number; maxX: number; maxY: number } | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const marks = drawnMarks(stroke);
  if (!marks) return null;
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const mark of marks) {
    if (mark.points.length === 0) continue;
    const b = bounds(mark);
    if (!b) continue;
    const grow = mark.noStroke ? 0 : Math.max(0, (mark.width - stroke.width) / 2);
    const grown = { minX: b.minX - grow, minY: b.minY - grow, maxX: b.maxX + grow, maxY: b.maxY + grow };
    box = box
      ? { minX: Math.min(box.minX, grown.minX), minY: Math.min(box.minY, grown.minY), maxX: Math.max(box.maxX, grown.maxX), maxY: Math.max(box.maxY, grown.maxY) }
      : grown;
  }
  return box;
}

// ---- The work ----------------------------------------------------------------------

/** The two parts while they are drawn apart. */
interface Apart {
  fill: Stroke;
  stroke: Stroke;
}

/**
 * A mark's geometry effects, its own and then its layers', worked in order on
 * what the one before made: the mark whole until something parts it or
 * builds it in 3D, and its two parts or its faces from then on. 3D works on
 * a whole mark, once; a Splatter, on a mark not built. Null when nothing
 * changed it.
 */
function work(stroke: Stroke): DrawnGeometry | null {
  if (isTextStroke(stroke)) return textWork(stroke);
  const has = markParts(stroke);
  let whole: Stroke = stroke;
  let parts: Apart | null = null;
  let faces: Stroke[] | null = null;
  let bent = false;
  const changed = { fill: false, stroke: false };
  const hatched = { fill: false, stroke: false };
  let built: Built | null = null;
  /** The parts, parted now if they were not: what bent the whole bent both. */
  const apart = (): Apart => {
    if (!parts) {
      parts = { fill: partOnly(whole, 'fill'), stroke: partOnly(whole, 'stroke') };
      changed.fill = changed.stroke = bent;
    }
    return parts;
  };
  /** A warp over everything drawn so far, or over the box it was given. */
  const bendAll = (effect: EffectOf<'warp'>, given?: WarpBox): void => {
    if (faces) {
      const box = given ?? boxOf(faces);
      faces = faces.map((face) => warpMark(face, effect, box));
      if (built) built.bent = true;
    } else if (parts) {
      const box = given ?? boxOf([parts.fill, parts.stroke]);
      parts = { fill: warpMark(parts.fill, effect, box), stroke: warpMark(parts.stroke, effect, box) };
      changed.fill = changed.stroke = true;
    } else {
      whole = warpMark(whole, effect, given ?? boxOf([whole]));
      bent = true;
    }
  };

  for (const effect of activeGeometryEffects(stroke.effects) ?? []) {
    if (effect.type === 'warp') {
      const target = effect.target;
      if (faces) {
        // Built in 3D, the mark is one picture of faces: a Warp bends them all.
        bendAll(effect);
      } else if (target === 'fill' || target === 'stroke') {
        // A Warp aimed at one part bends it alone, over its own box.
        if (!has[target]) continue;
        const p = apart();
        p[target] = warpMark(p[target], effect, boxOf([p[target]]));
        changed[target] = true;
      } else {
        bendAll(effect);
      }
    } else if (effect.type === '3d') {
      // 3D builds a whole mark, once: after a part was drawn anew, or once
      // built, there is nothing whole left to build.
      if (parts || faces) continue;
      const made = facesOf(stroke, whole, effect);
      if (made.length > 0) {
        faces = made;
        built = { effect, source: whole, bent: false };
      }
    } else if (effect.type === 'splatter') {
      const part = splatteredPart(stroke, effect);
      // The first Splatter on a part draws it; one after it has nothing left
      // to hatch, and a mark built in 3D has no fill of its own.
      if (!part || hatched[part] || faces) continue;
      const p = apart();
      p[part] = hatchPart(stroke, p[part], part, effect);
      hatched[part] = changed[part] = true;
    }
  }
  for (const { effect, box } of inherited.get(stroke) ?? []) bendAll(effect, box);

  if (faces) {
    const drawn: DrawnGeometry = { whole: null, parts: null, faces };
    if (built) builds.set(drawn, built);
    return drawn;
  }
  if (parts) return { whole: null, parts: { ...(parts as Apart), changed }, faces: null };
  if (!bent) return null;
  // The bent mark draws as the mark, its raster effects with it, and bends no further.
  const raster = (stroke.effects ?? []).filter((effect) => !GEOMETRY_EFFECT_TYPES.has(effect.type));
  const out: Stroke = { ...whole };
  if (raster.length > 0) out.effects = raster;
  else delete out.effects;
  return { whole: out, parts: null, faces: null };
}

/**
 * A text's shapes, from the current outline source: its layout's glyphs as
 * marks (core/type/outline.ts), or null when the source cannot draw one of
 * them - and then the text draws as text.
 */
function textShapes(stroke: Stroke): OutlinedMark[] | null {
  const source = outlineSource();
  if (!source) return null;
  const outlined = outlineText(stroke, layoutType(stroke, source.measure), source);
  return outlined.marks;
}

/**
 * A text's geometry effects, on its shapes: a run of one color a mark, so a
 * Warp bends them over the box of all of them; a Splatter hatches the fill
 * of each; 3D builds the glyphs as one solid, once, in the text's first
 * color. Null when the text cannot be drawn as shapes.
 */
function textWork(stroke: Stroke): DrawnGeometry | null {
  const shapes = textShapes(stroke);
  if (!shapes) return null;
  let marks = mergedByColor(shapes, stroke);
  let built: Built | null = null;
  const bend = (effect: EffectOf<'warp'>, given?: WarpBox): void => {
    const box = given ?? boxOf(marks);
    marks = marks.map((mark) => warpMark(mark, effect, box));
    if (built) built.bent = true;
  };
  for (const effect of activeGeometryEffects(stroke.effects) ?? []) {
    if (effect.type === 'warp') {
      bend(effect);
    } else if (effect.type === '3d') {
      if (built) continue;
      const solid = mergedSolid(shapes, stroke);
      const made = solid ? facesOf(stroke, solid, effect) : [];
      if (solid && made.length > 0) {
        marks = made;
        built = { effect, source: solid, bent: false };
      }
    } else if (effect.type === 'splatter') {
      if (built) continue;
      marks = marks.map((mark) => (mark.fill !== undefined ? hatchPart(mark, partOnly(mark, 'fill'), 'fill', effect) : mark)).filter((mark) => mark.points.length > 0);
    }
  }
  for (const { effect, box } of inherited.get(stroke) ?? []) bend(effect, box);
  const drawn: DrawnGeometry = { whole: null, parts: null, faces: marks };
  if (built) builds.set(drawn, built);
  return drawn;
}

/** The marks a text stands for in a layer's box, before anything bends it: the corners of the box its layout covers. */
function textBox(stroke: Stroke): Stroke[] {
  const source = outlineSource();
  if (!source) return [];
  const b = layoutType(stroke, source.measure).bounds;
  const corner = (x: number, y: number): Point => ({ x, y, pressure: 0.5 });
  return [{ ...stroke, points: [corner(b.minX, b.minY), corner(b.maxX, b.minY), corner(b.maxX, b.maxY), corner(b.minX, b.maxY)] }];
}

/** The box a set of marks' points cover - the geometric box, with no width - or null for none. */
function boxOf(marks: readonly Stroke[]): WarpBox | null {
  let box: WarpBox | null = null;
  for (const mark of marks) {
    for (const p of mark.points) {
      if (!box) box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      else {
        if (p.x < box.minX) box.minX = p.x;
        if (p.y < box.minY) box.minY = p.y;
        if (p.x > box.maxX) box.maxX = p.x;
        if (p.y > box.maxY) box.maxY = p.y;
      }
    }
  }
  return box;
}

/**
 * A mark bent by a Warp over a box: its anchors and handles carried along the
 * style's map, a segment the map bends split only where it must
 * (core/mesh-warp.ts's mapStrokeGeometry). A mark drawn at one pressure keeps
 * it: a path sampled afresh from its anchors would take the pen's middle one.
 */
function warpMark(mark: Stroke, effect: EffectOf<'warp'>, box: WarpBox | null): Stroke {
  if (!box || mark.points.length === 0) return mark;
  const carried = mapStrokeGeometry(mark, warpStyleMap(effect.style, box, effect));
  const out: Stroke = { ...mark, points: carried.points };
  if (carried.vector) out.vector = carried.vector;
  if (carried.nibAngle !== undefined) out.nibAngle = carried.nibAngle;
  if (carried.smudges) out.smudges = carried.smudges;
  if (carried.vector && !carried.vector.anchors.some((anchor) => anchor.pressure !== undefined)) {
    const pressure = mark.points[0].pressure;
    if (mark.points.every((p) => p.pressure === pressure)) out.points = carried.points.map((p) => ({ ...p, pressure }));
  }
  return out;
}

// ---- Splatter ------------------------------------------------------------------------

/**
 * The part a Splatter hatches: the one it is aimed at, when the mark has it;
 * aimed at the whole mark, the fill, or the stroke when there is no fill.
 * Null when the mark has no such part.
 */
function splatteredPart(stroke: Stroke, effect: Effect): 'fill' | 'stroke' | null {
  const has = markParts(stroke);
  if (effect.target === 'stroke') return has.stroke ? 'stroke' : null;
  if (effect.target === 'fill') return has.fill ? 'fill' : null;
  return has.fill ? 'fill' : has.stroke ? 'stroke' : null;
}

/**
 * The region a part covers, as closed contours under the non-zero rule: a
 * fill's own rings, each subpath one; a stroke's painted ink, its width along
 * it, or a Copic's nib footprint joined into one outline (REUSE: the wipe
 * engine's regions, core/wipe.ts's wipeOperand, built from the same parts).
 */
function regionOf(stroke: Stroke, part: 'fill' | 'stroke'): Vec[][] {
  if (part === 'fill') return ringsOf(stroke.points).filter((ring) => ring.length >= 3);
  const line = partOnly(stroke, 'stroke');
  if (line.tool === 'copic') return booleanRegions(copicNibPolygons(line), [], 'union')?.contours ?? [];
  return profileOutline(profileInputOf(line));
}

/** The contours of a mark's points: a `move` starts a new one. */
function ringsOf(points: readonly Point[]): Vec[][] {
  const rings: Vec[][] = [];
  let ring: Vec[] = [];
  for (const p of points) {
    if (p.move && ring.length > 0) {
      rings.push(ring);
      ring = [];
    }
    ring.push({ x: p.x, y: p.y });
  }
  if (ring.length > 0) rings.push(ring);
  return rings;
}

/** Anchors as the points a mark carries, at full pressure so a pen draws them its whole width. */
function pointsOf(anchors: readonly VectorAnchor[]): Point[] {
  return sampleOutline(anchors, false).map((p) => ({ ...p, pressure: 1 }));
}

/** An open mark of anchors in a color at a width: a hatch, or one run of it. */
function lineMark(source: Stroke, anchors: VectorAnchor[], color: string, width: number): Stroke {
  return {
    id: source.id,
    ...(source.layer ? { layer: source.layer } : {}),
    tool: 'pen',
    color,
    width,
    opacity: 1,
    points: pointsOf(anchors),
    vector: { anchors },
  };
}

/**
 * A part as a Splatter draws it: the hatch over the region `current` covers -
 * the part as the effects before it left it - in the paint of the mark it
 * stands for.
 */
function hatchPart(stroke: Stroke, current: Stroke, part: 'fill' | 'stroke', effect: EffectOf<'splatter'>): Stroke {
  const anchors = splatterAnchors(regionOf(current, part), effect);
  const empty: Stroke = { ...current, points: [], vector: undefined };
  if (anchors.length < 2) return empty;
  if (part === 'stroke') return lineMark(stroke, anchors, stroke.color, effect.width);
  const hatch = lineMark(stroke, anchors, stroke.fill ?? stroke.color, effect.width);
  if (!stroke.gradient) return hatch;
  // A gradient fill: the hatch's outline, filled with it.
  const outline = profileOutline(profileInputOf(hatch)).filter((ring) => ring.length >= 3);
  if (outline.length === 0) return empty;
  const points: Point[] = outline.flatMap((ring, k) => ring.map((p, i) => (k > 0 && i === 0 ? { x: p.x, y: p.y, pressure: 0.5, move: true as const } : { x: p.x, y: p.y, pressure: 0.5 })));
  return { ...partOnly(stroke, 'fill'), tool: 'pen', points, vector: undefined, noStroke: true };
}

// ---- 3D ----------------------------------------------------------------------------

/**
 * A mark built by a 3D effect: its faces, far first, each a plain mark - a
 * filled polygon, holes and all; a cap with the stroke along its outline; a
 * wireframe's face its edges alone. `current` is the mark as the effects
 * before this one left it, `stroke` the mark itself.
 */
function facesOf(stroke: Stroke, current: Stroke, effect: EffectOf<'3d'>): Stroke[] {
  return render3d(current, effect, drafts.has(stroke.id)).map((face) => faceMark(stroke, face));
}

/** One face as a mark: a closed path round each of its rings, in its colors. */
function faceMark(source: Stroke, face: Face): Stroke {
  const anchors: VectorAnchor[] = face.points.flatMap((ring, k) => ring.map((p, i) => (k > 0 && i === 0 ? { p: { x: p.x, y: p.y }, move: true } : { p: { x: p.x, y: p.y } })));
  return {
    id: source.id,
    ...(source.layer ? { layer: source.layer } : {}),
    tool: 'pen',
    color: face.stroke?.color ?? face.color ?? '#000000',
    width: face.stroke?.width ?? 1,
    opacity: 1,
    ...(face.color !== null ? { fill: face.color } : {}),
    ...(face.stroke ? {} : { noStroke: true }),
    points: facePoints(face),
    vector: { anchors, closed: true },
  };
}

// ---- Layers' warps -------------------------------------------------------------------

/** A layer's Warps that draw. */
function warpsOf(layer: Layer): EffectOf<'warp'>[] {
  return (activeGeometryEffects(layer.effects) ?? []).filter((effect): effect is EffectOf<'warp'> => effect.type === 'warp');
}

/**
 * Lays each layer's and group's Warp on the marks it holds, over the box of
 * everything it holds as they draw - their own effects done, and the warps of
 * the layers inside it - and takes off any an earlier bind of the sketch laid
 * that no longer holds. Pictures are not bent, and do not count in the box;
 * text is bent through its outlines, and counts by its layout's box. A mark
 * is the sketch's alone, so binding one sketch leaves another's as it was
 * bound.
 */
export function bindGeometry(sketch: { strokes: readonly Stroke[]; layers: readonly Layer[] }): void {
  for (const stroke of sketch.strokes) inherited.delete(stroke);
  const warped = sketch.layers.filter((layer) => warpsOf(layer).length > 0);
  if (warped.length === 0) return;
  const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
  // A mark on no layer the sketch has is on its first plain one, as core/types.ts's layerOf has it.
  const firstLeaf = sketch.layers.find((layer) => !layer.group) ?? sketch.layers[0];
  /** A layer and the groups over it, itself first, safe from a parent chain that loops. */
  const chainOf = (layer: Layer | undefined): Layer[] => {
    const chain: Layer[] = [];
    const seen = new Set<string>();
    for (let at = layer; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
      seen.add(at.id);
      chain.push(at);
    }
    return chain;
  };
  const depth = new Map(warped.map((layer) => [layer.id, chainOf(layer).length]));
  // The marks each warped layer holds, at any depth.
  const members = new Map<string, Stroke[]>();
  for (const stroke of sketch.strokes) {
    if (!drawsShape(stroke)) continue;
    const own = stroke.layer !== undefined ? byId.get(stroke.layer) : undefined;
    for (const layer of chainOf(own && !own.group ? own : firstLeaf)) {
      if (!depth.has(layer.id)) continue;
      const list = members.get(layer.id);
      if (list) list.push(stroke);
      else members.set(layer.id, [stroke]);
    }
  }
  const chains = new Map<Stroke, InheritedWarp[]>();
  // Inner layers first: an outer layer's box is what its inner ones drew.
  for (const layer of [...warped].sort((a, b) => (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0))) {
    const held = members.get(layer.id) ?? [];
    const box = boxOf(held.flatMap((stroke) => drawnMarks(stroke) ?? (isTextStroke(stroke) ? textBox(stroke) : [stroke])));
    if (!box) continue;
    for (const stroke of held) {
      const chain = chains.get(stroke) ?? [];
      for (const effect of warpsOf(layer)) chain.push({ layer: layer.id, effect, box: { ...box } });
      chains.set(stroke, chain);
      inherited.set(stroke, chain.slice());
    }
  }
}

/** What Expand Appearance makes of one mark: the marks it becomes, and what goes round them when there are several. */
export interface ExpandedMark {
  id: string;
  marks: Stroke[];
  effects: Effect[];
  opacity: number;
}

/**
 * Expand Appearance on layers and groups: each mark they bend, with their
 * Warps baked into its anchors - its own geometry effects first, as they
 * draw, then the layers' warps over the boxes the canvas bends them over,
 * inner layers first. A Warp on a layer `layerIds` does not name stays live,
 * and so do the raster effects. The caller takes the baked Warps off the
 * layers.
 */
export function expandLayerWarps(sketch: { strokes: readonly Stroke[]; layers: readonly Layer[] }, layerIds: ReadonlySet<string>): ExpandedMark[] {
  bindGeometry(sketch);
  const out: ExpandedMark[] = [];
  for (const stroke of sketch.strokes) {
    const chain = (inherited.get(stroke) ?? []).filter((warp) => layerIds.has(warp.layer));
    if (chain.length === 0) continue;
    const own = expandAppearance(stroke) ?? { marks: [stroke], effects: [], opacity: 1 };
    const marks = own.marks.map((mark) => chain.reduce((bent, warp) => warpMark(bent, warp.effect, warp.box), mark));
    out.push({ id: stroke.id, marks, effects: own.effects, opacity: own.opacity });
  }
  return out;
}

// ---- Expand Appearance -------------------------------------------------------------------

/** The effects of a list aimed at one part, now on a mark of that part alone: aimed at nothing. */
function aimedAt(effects: readonly Effect[], part: 'fill' | 'stroke'): Effect[] {
  return effects
    .filter((effect) => effect.target === part)
    .map((effect) => {
      const { target: _was, ...rest } = effect;
      return rest as Effect;
    });
}

/** A part as a mark of its own: a new id, solid, with the raster effects that were aimed at it. */
function ownPart(stroke: Stroke, mark: Stroke, which: 'fill' | 'stroke'): Stroke {
  const aimed = aimedAt(stroke.effects ?? [], which);
  const { layer: _layer, effects: _effects, ...rest } = mark;
  return { ...rest, id: createId('st'), ...(aimed.length > 0 ? { effects: aimed } : {}) };
}

/**
 * Splatter's Expand Appearance: the mark's two parts as marks of their own,
 * the hatched one as an open mark a run of the hatch (a gradient's hatch as
 * its filled outline), each solid and carrying the raster effects that were
 * aimed at its part. A part the mark does not draw is left out.
 */
function expandSplatter(stroke: Stroke, effect: Effect): Stroke[] {
  if (effect.type !== 'splatter' || !drawsShape(stroke)) return [stroke];
  const part = splatteredPart(stroke, effect);
  if (!part) return [stroke];
  const has = markParts(stroke);
  const hatched = (): Stroke[] => {
    if (part === 'fill' && stroke.gradient) {
      const filled = hatchPart(stroke, partOnly(stroke, 'fill'), 'fill', effect);
      return filled.points.length > 0 ? [ownPart(stroke, filled, 'fill')] : [];
    }
    const color = part === 'fill' ? (stroke.fill ?? stroke.color) : stroke.color;
    return splatterPaths(regionOf(stroke, part), effect)
      .filter((run) => run.length >= 2)
      .map((run) => ownPart(stroke, lineMark(stroke, run, color, effect.width), part));
  };
  const fill = part === 'fill' ? hatched() : has.fill ? [ownPart(stroke, partOnly(stroke, 'fill'), 'fill')] : [];
  const line = part === 'stroke' ? hatched() : has.stroke ? [ownPart(stroke, partOnly(stroke, 'stroke'), 'stroke')] : [];
  return [...fill, ...line];
}

/**
 * Warp's Expand Appearance: the mark bent into its own anchors. On the whole
 * mark it stays one mark, bent over the box of everything the effects before
 * it made - `all` - so a hatch and its outline bend as one; aimed at a part,
 * that part is bent alone, and the mark becomes its two parts.
 */
function expandWarp(stroke: Stroke, effect: Effect, all: readonly Stroke[]): Stroke[] {
  if (effect.type !== 'warp' || !drawsShape(stroke)) return [stroke];
  const target = effect.target;
  if (target !== 'fill' && target !== 'stroke') return [warpMark(stroke, effect, boxOf(all))];
  const has = markParts(stroke);
  if (!has[target]) return [stroke];
  const fill = has.fill ? partOnly(stroke, 'fill') : null;
  const line = has.stroke ? partOnly(stroke, 'stroke') : null;
  const bend = (mark: Stroke): Stroke => warpMark(mark, effect, boxOf([mark]));
  return [
    ...(fill ? [ownPart(stroke, target === 'fill' ? bend(fill) : fill, 'fill')] : []),
    ...(line ? [ownPart(stroke, target === 'stroke' ? bend(line) : line, 'stroke')] : []),
  ];
}

/**
 * 3D's Expand Appearance: the mark's faces as marks of their own, far first,
 * each a filled polygon. A mark the effects before it parted is left as it
 * is: 3D builds a whole mark.
 */
function expand3d(stroke: Stroke, effect: Effect, all: readonly Stroke[]): Stroke[] {
  if (effect.type !== '3d' || !drawsShape(stroke) || all.length > 1) return [stroke];
  const faces = render3d(stroke, effect);
  if (faces.length === 0) return [stroke];
  return faces.map((face) => {
    const { layer: _layer, ...rest } = faceMark(stroke, face);
    return { ...rest, id: createId('st') };
  });
}

// REUSE: core/appearance.ts's geometry registry, which Expand Appearance bakes through.
registerGeometryEffect('splatter', { expand: expandSplatter });
registerGeometryEffect('warp', { expand: expandWarp });
registerGeometryEffect('3d', { expand: expand3d });

// A text bakes as its shapes: a mark a glyph, each with an id of its own - or, to be built
// in 3D, every glyph as one mark, as the canvas builds it.
registerTextShapes((stroke) => {
  const shapes = textShapes(stroke);
  if (!shapes) return null;
  const builds3d = (activeGeometryEffects(stroke.effects) ?? []).some((effect) => effect.type === '3d');
  const marks = builds3d ? [mergedSolid(shapes, stroke)].filter((mark): mark is Stroke => mark !== null) : shapes.map((shape) => shape.mark);
  return marks.map((mark) => {
    const { layer: _layer, ...rest } = mark;
    return { ...rest, id: createId('st') };
  });
});
