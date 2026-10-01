/**
 * Smear: a blending stump for the Pencil's graphite (core/pencil.ts).
 *
 * A pass is a drag with a stump of a width and a strength. Over a Pencil
 * mark the stump trades graphite with the paper under it as it goes: at each
 * step it lays down some of what it carries and takes up some of what is
 * there, so tone moves along the drag from where it is thick to where it is
 * thin, the paper's tooth fills in, edges soften, and a patch spread thin
 * lightens - shading, made out of hatching. The trade is even, what the paper
 * gains the stump loses, so the graphite is kept: only what the stump still
 * holds when the drag ends is lost.
 *
 * A pass is kept on each mark it smeared (`Stroke.smudges`), cut to the part
 * of the drag that reached it ({@link smudgeFor}), and painted after the
 * Pencil's own picture by {@link smudgeBuffer}, which a drag still under way
 * can run a step at a time. Every transform carries a mark's passes with it
 * ({@link mapSmudges}).
 *
 * Nothing here touches the DOM.
 */

import { fitCurve } from './fit-curve.js';
import { sampleVectorPathPoints } from '../sharpen/geometry.js';
import type { PencilRegion } from './pencil.js';
import type { Point, Smudge, Stroke, VectorAnchor } from './types.js';

type Vec = { x: number; y: number };

/** A stump's strength when none is set: what the Smear's Quick Opacity reads unset. */
export const DEFAULT_SMEAR_STRENGTH = 0.5;

/** A pass's step, in stump widths: the stump goes a tenth of its width at a time, so what it carries spreads as a smear rather than as copies of what it crossed. */
const STEP = 0.1;

/** How much a step trades, at full strength, pressure and weight: as much along a stump width as half a trade a quarter-width step would, whatever the step. */
const TRADE = 0.5 * (STEP / 0.25);

/** How far past a mark its graphite can go, in stump widths: the stump has laid down nearly all it took up by then. */
const REACH = 2;

/** One pass as the stump runs it: the drag's points, in page units with their pressure, the stump's width and its strength. */
export interface SmudgePass {
  points: readonly Point[];
  width: number;
  strength: number;
}

/** A kept pass as the stump runs it: its anchors sampled back to points. */
export function passOf(smudge: Smudge): SmudgePass {
  return { points: sampleVectorPathPoints(smudge.path, false), width: smudge.width, strength: smudge.strength };
}

/**
 * Where a pass is when a call to {@link smudgeBuffer} ends, for the next to
 * go on from: a live drag runs the steps its new points add, and nothing
 * twice. The working graphite is kept in full, so no step rounds another's.
 */
export interface SmudgeState {
  /**
   * The picture's graphite as the stump has left it, as optical density:
   * what layers of it add up to, as marks laid over one another do.
   */
  density: Float32Array;
  /** What the stump carries, a patch round its centre, or null before its first step. */
  carried: Float32Array | null;
  /** The next step's distance along the points, in page units. */
  next: number;
  /** The segment that distance falls in, and how far along the points that segment starts. */
  segment: number;
  start: number;
  /** The last step's centre, in the region's pixels: a step that lands on it again trades nothing new. */
  last: Vec | null;
}

/**
 * Alpha, 0 to 255, as optical density, and back. Graphite is traded as
 * density because density is what adds: a mark's layers multiply the light
 * that gets through, as marks laid over one another do, so a pass that keeps
 * the density keeps the darkness however thin it spreads it. Trading alpha
 * instead lost darkness wherever a dense line was spread thin.
 */
function densityOf(alpha: number): number {
  return -Math.log(1 - Math.min(alpha / 255, 0.998));
}

function alphaOf(density: number): number {
  return Math.round(255 * (1 - Math.exp(-density)));
}

/**
 * One step of a 3 × 3 box blur over a square patch, in place, with its edge
 * mirrored: each cell sends a ninth of what it holds to each neighbour and
 * itself, and a share bound past the edge comes back, so the patch's total
 * is kept.
 */
function spread(patch: Float32Array, side: number, scratch: Float32Array): void {
  scratch.fill(0);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const share = patch[y * side + x] / 9;
      if (share === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        let ty = y + dy;
        if (ty < 0 || ty >= side) ty = y;
        for (let dx = -1; dx <= 1; dx++) {
          let tx = x + dx;
          if (tx < 0 || tx >= side) tx = x;
          scratch[ty * side + tx] += share;
        }
      }
    }
  }
  patch.set(scratch);
}

/** A soft disc's weights over a patch `2r + 1` a side: full to six tenths of the radius, easing out to its edge. */
function stumpWeights(radius: number, r: number): Float32Array {
  const side = 2 * r + 1;
  const weights = new Float32Array(side * side);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / radius;
      let w = 0;
      if (d < 0.6) w = 1;
      else if (d < 1) {
        const t = (1 - d) / 0.4;
        w = t * t * (3 - 2 * t);
      }
      weights[(dy + r) * side + dx + r] = w;
    }
  }
  return weights;
}

/**
 * Runs one pass of the stump over a Pencil mark's picture - straight RGBA
 * over `region`, a mark's color with the alpha it lays down - in place, and
 * says where it got to.
 *
 * What it trades is graphite as density, so the pass keeps a mark's darkness
 * (see {@link densityOf}).
 *
 * The stump goes along the pass's points a tenth of its width at a time,
 * the same steps on the page at any scale, so a smear looks the same zoomed
 * in or out. At each step every pixel under it trades with what the stump
 * carries for that place, each moving toward the other by the pass's
 * strength (and the pen's pressure, and less toward the stump's edge): even,
 * so what one gains the other loses. Its first step only takes up what is
 * there. What the stump carries moves with it, which is what carries tone
 * along the drag.
 *
 * `rgb` colors every pixel the graphite reaches. With `from`, the pass goes
 * on from where that call stopped - for a drag still being drawn, whose
 * points have grown since.
 */
export function smudgeBuffer(
  data: Uint8ClampedArray,
  region: PencilRegion,
  pass: SmudgePass,
  rgb: readonly [number, number, number],
  from?: SmudgeState | null,
): SmudgeState {
  const { scale, x: ox, y: oy, width, height } = region;
  let density = from?.density ?? null;
  if (!density) {
    density = new Float32Array(width * height);
    for (let i = 0; i < density.length; i++) density[i] = densityOf(data[i * 4 + 3]);
  }
  const alpha = density;
  const state: SmudgeState = from
    ? { ...from, density }
    : { density, carried: null, next: 0, segment: 0, start: 0, last: null };
  const pts = pass.points;
  if (pts.length === 0 || width <= 0 || height <= 0 || !(pass.width > 0) || !(pass.strength > 0)) return state;

  const radius = Math.max(1, (pass.width * scale) / 2);
  const r = Math.ceil(radius);
  const side = 2 * r + 1;
  const weights = stumpWeights(radius, r);
  if (!state.carried || state.carried.length !== side * side) state.carried = null;
  const step = Math.max(0.5 / scale, pass.width * STEP);
  const strength = Math.min(1, Math.max(0, pass.strength));
  const scratch = new Float32Array(side * side);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const stamp = (at: Point): void => {
    const cx = Math.round(at.x * scale - ox);
    const cy = Math.round(at.y * scale - oy);
    if (state.last && state.last.x === cx && state.last.y === cy) return;
    state.last = { x: cx, y: cy };
    const press = at.pressure ?? 0.5;
    const k = TRADE * strength * (0.4 + 0.6 * press);
    if (!state.carried) {
      // The first touch only takes up what is there.
      const carried = new Float32Array(side * side);
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= width) continue;
          carried[(dy + r) * side + dx + r] = alpha![y * width + x];
        }
      }
      state.carried = carried;
      return;
    }
    const carried = state.carried;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      for (let dx = -r; dx <= r; dx++) {
        const j = (dy + r) * side + dx + r;
        const w = weights[j];
        if (w === 0) continue;
        const x = cx + dx;
        if (x < 0 || x >= width) continue;
        const i = y * width + x;
        const a = alpha![i];
        const c = carried[j];
        const trade = k * w * (c - a);
        alpha![i] = a + trade;
        carried[j] = c - trade;
      }
    }
    // What the stump carries spreads a little across its face as it goes, so
    // it lays tone into the gaps between lines as well as along the drag. A
    // box blur that keeps every cell's share: nothing leaves the stump.
    spread(carried, side, scratch);
    minX = Math.min(minX, cx - r);
    minY = Math.min(minY, cy - r);
    maxX = Math.max(maxX, cx + r);
    maxY = Math.max(maxY, cy + r);
  };

  // Walk the points at even steps, from wherever the last call stopped.
  if (state.next === 0 && state.segment === 0 && state.last === null) stamp(pts[0]);
  if (pts.length === 1) state.next = Math.max(state.next, step);
  for (let s = state.segment; s < pts.length - 1; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (state.next === 0) state.next = step;
    while (state.next <= state.start + length + 1e-9) {
      const t = length > 0 ? (state.next - state.start) / length : 1;
      const pa = a.pressure ?? 0.5;
      const pb = b.pressure ?? 0.5;
      stamp({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: pa + (pb - pa) * t });
      state.next += step;
    }
    state.start += length;
    state.segment = s + 1;
  }
  // A pass only grows: a shorter one than last time goes no further.
  state.segment = Math.max(state.segment, pts.length - 1);

  // What the steps touched, written back, in the mark's color.
  if (maxX >= minX) {
    const x0 = Math.max(0, minX);
    const y0 = Math.max(0, minY);
    const x1 = Math.min(width - 1, maxX);
    const y1 = Math.min(height - 1, maxY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        const o = i * 4;
        const value = alphaOf(alpha[i]);
        data[o + 3] = value;
        if (value > 0) {
          data[o] = rgb[0];
          data[o + 1] = rgb[1];
          data[o + 2] = rgb[2];
        }
      }
    }
  }
  return state;
}

/** The box a pass can carry graphite into: its points, and the stump's half width round them. */
export function smudgeBox(smudge: Smudge): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts = sampleVectorPathPoints(smudge.path, false);
  if (pts.length === 0) return null;
  const half = smudge.width / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x - half);
    minY = Math.min(minY, p.y - half);
    maxX = Math.max(maxX, p.x + half);
    maxY = Math.max(maxY, p.y + half);
  }
  return { minX, minY, maxX, maxY };
}

/** The distance from a point to a line's nearest segment. */
function distanceToLine(p: Vec, pts: readonly Point[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.move) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Points along a drag a page pixel apart, pressure carried, so a cut can fall anywhere along it. */
function resample(points: readonly Point[]): Point[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure ?? 0.5 }));
  const out: Point[] = [{ x: points[0].x, y: points[0].y, pressure: points[0].pressure ?? 0.5 }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const pa = a.pressure ?? 0.5;
      const pb = b.pressure ?? 0.5;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: pa + (pb - pa) * t });
    }
  }
  return out;
}

/**
 * Whether a drag of a stump `width` wide reaches a mark: whether at any of
 * its points the stump overlaps the mark's line.
 */
export function smearReaches(mark: Stroke, drag: readonly Point[], width: number): boolean {
  const reach = width / 2 + mark.width / 2;
  return drag.some((p) => distanceToLine(p, mark.points) <= reach);
}

/**
 * The pass a drag leaves on one mark: the part of the drag from where the
 * stump first reached the mark to where it last did, and on for as far as
 * it can carry graphite past it, fitted to anchors within `tolerance` - or
 * null when the drag never reaches the mark. A drag the fit cannot take
 * keeps its points as corner anchors.
 */
export function smudgeFor(mark: Stroke, drag: readonly Point[], width: number, strength: number, tolerance = 0.5): Smudge | null {
  if (!(width > 0) || drag.length === 0 || mark.points.length === 0) return null;
  const pts = resample(drag);
  const reach = width / 2 + mark.width / 2;
  let first = -1;
  let last = -1;
  for (let i = 0; i < pts.length; i++) {
    if (distanceToLine(pts[i], mark.points) > reach) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  // On past the last touch for as far as the stump still carries graphite.
  let end = last;
  let gone = 0;
  while (end + 1 < pts.length && gone < width * REACH) {
    gone += Math.hypot(pts[end + 1].x - pts[end].x, pts[end + 1].y - pts[end].y);
    end++;
  }
  const run = pts.slice(first, end + 1);
  const anchors = run.length >= 2 ? fitCurve(run, { tolerance, closed: false }) : null;
  const path: VectorAnchor[] =
    anchors && anchors.length >= 2
      ? anchors
      : run.map((p) => ({ p: { x: p.x, y: p.y }, ...(p.pressure !== undefined ? { pressure: p.pressure } : {}) }));
  return { path, width, strength };
}

/**
 * A mark's passes carried by a map of page points - a move, a turn, a
 * mirror, a scale, a warp - anchors and handles both, and each stump's width
 * by `widthScale`, so a smear goes wherever its mark goes. Undefined for a
 * mark with none.
 */
export function mapSmudges(
  smudges: readonly Smudge[] | undefined,
  map: (p: Vec) => Vec,
  widthScale = 1,
): Smudge[] | undefined {
  if (!smudges || smudges.length === 0) return undefined;
  return smudges.map((smudge) => ({
    ...smudge,
    width: Math.max(0.5, smudge.width * widthScale),
    path: smudge.path.map((anchor) => ({
      ...anchor,
      p: map(anchor.p),
      ...(anchor.hIn ? { hIn: map(anchor.hIn) } : {}),
      ...(anchor.hOut ? { hOut: map(anchor.hOut) } : {}),
    })),
  }));
}
