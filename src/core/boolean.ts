/**
 * Boolean operations on regions: union, difference and intersection of two
 * sets of closed contours, each filled under the non-zero or the even-odd
 * rule.
 *
 * It is the boundary engine the stroke profiles were built on
 * (`stroke-profile.ts`, which now calls it), with a second operand. Every
 * edge of both is cut wherever another edge crosses it or an end of one lands
 * on it; each cut piece is tested just to either side against both regions,
 * and kept, turned to have the result on its right, only where the result is
 * on one side and not the other. The kept pieces are then walked into
 * contours, taking the sharpest turn towards the fill wherever boundaries
 * meet at a point. So the result's outer contours wind clockwise and its
 * holes the other way, and it fills the same under either rule.
 *
 * An operand may be a soup of pieces that overlap - a Copic stroke's nib
 * quads, a profiled stroke's pieces - with no union first: the winding of a
 * point under the pieces is what says whether it is inside. Two regions in
 * one operand must not be wound against each other, though: a looping
 * eraser's hole would cancel another region's solid, so an eraser cuts with
 * one region at a time.
 *
 * Nothing here touches the DOM.
 */

import { signedArea } from './graphic-design/geometry.js';

export type Vec = { x: number; y: number };

/** Which points a set of contours fills: a non-zero winding, or an odd one. */
export type FillRule = 'nonzero' | 'evenodd';

export type BooleanOp = 'union' | 'difference' | 'intersection';

export interface BooleanOptions {
  /** How the first operand fills. Non-zero unless said. */
  ruleA?: FillRule;
  /** How the second operand fills. Non-zero unless said. */
  ruleB?: FillRule;
}

/** The result's contours, and the vertices where its outline passes from one operand's edge to the other's. */
export interface BooleanResult {
  contours: Vec[][];
  /**
   * The vertices, by identity, where a contour leaves an edge of one operand
   * for an edge of the other: the corners a cut makes. A refit keeps them.
   */
  junctions: Set<Vec>;
  /** Whether any of the result's outline is the second operand's: false when `b` changed nothing. */
  fromB: boolean;
}

/** Beyond this many edges an operation is not worth its time, and the answer is null. */
export const BOOLEAN_EDGE_LIMIT = 40000;

/** An edge of an operand, the operand it came from, and where other edges cut it (as fractions along it). */
interface Edge {
  a: Vec;
  b: Vec;
  cuts: Array<{ t: number; p: Vec }>;
  src: 0 | 1;
}

/**
 * `a` combined with `b`: in either (`union`), in `a` and not in `b`
 * (`difference`), or in both (`intersection`). Null when floating point
 * leaves the kept pieces unable to close into contours, or the operands have
 * more than {@link BOOLEAN_EDGE_LIMIT} edges between them.
 */
export function booleanOp(a: Vec[][], b: Vec[][], op: BooleanOp, options: BooleanOptions = {}): Vec[][] | null {
  return booleanRegions(a, b, op, options)?.contours ?? null;
}

/**
 * {@link booleanOp}, and the junctions of its result: where a cut made a
 * corner.
 *
 * Floating point can leave the kept pieces unable to close: two nearly
 * parallel edges crossing a hair's breadth from a vertex give a crossing
 * point that rounds to a vertex of its own beside it, and the walk loses
 * its way. That is not a property of the shapes, only of where their
 * vertices happen to fall, so a failed operation is tried again with every
 * vertex moved by a tiny, fixed amount - a hundred-thousandth of a pixel,
 * then a ten-thousandth - which no picture can show. Operations that close
 * the first time are never moved.
 */
export function booleanRegions(a: Vec[][], b: Vec[][], op: BooleanOp, options: BooleanOptions = {}): BooleanResult | null {
  const first = combine(a, b, op, options);
  if (first !== 'unbalanced') return first;
  for (const [salt, amount] of JITTERS) {
    const again = combine(jitter(a, salt, amount), jitter(b, salt + 1, amount), op, options);
    if (again !== 'unbalanced') return again;
  }
  return null;
}

/** The nudges a failed operation is tried again with: a seed, and how far any vertex moves at most, in pixels. */
const JITTERS: ReadonlyArray<readonly [number, number]> = [
  [11, 1e-5],
  [23, 1e-4],
];

/** Every vertex moved by up to `amount` either way, the same amount each time for the same `salt`, and each ring kept whole. */
function jitter(set: Vec[][], salt: number, amount: number): Vec[][] {
  let seed = salt * 2654435761;
  const next = (): number => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5) | 0;
    return (((seed ^ (seed >>> 13)) >>> 0) / 4294967296) * 2 - 1;
  };
  return set.map((ring) => ring.map((p) => ({ x: p.x + next() * amount, y: p.y + next() * amount })));
}

/** One try at an operation: its result, null past the edge limit, or `unbalanced` when floating point left the pieces unable to close. */
function combine(a: Vec[][], b: Vec[][], op: BooleanOp, options: BooleanOptions): BooleanResult | null | 'unbalanced' {
  const edges: Edge[] = [];
  const add = (set: Vec[][], src: 0 | 1): void => {
    for (const c of set) {
      for (let i = 0; i < c.length; i++) {
        const p = c[i];
        const q = c[(i + 1) % c.length];
        if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) edges.push({ a: p, b: q, cuts: [], src });
      }
    }
  };
  add(a, 0);
  add(b, 1);
  if (edges.length === 0) return { contours: [], junctions: new Set(), fromB: false };
  if (edges.length > BOOLEAN_EDGE_LIMIT) return null;

  findCrossings(edges);
  const ruleA = options.ruleA ?? 'nonzero';
  const ruleB = options.ruleB ?? 'nonzero';
  const inA = windingField(edges.filter((e) => e.src === 0));
  const inB = windingField(edges.filter((e) => e.src === 1));
  const fills = (rule: FillRule, w: number): boolean => (rule === 'nonzero' ? w !== 0 : Math.abs(w) % 2 === 1);
  const inside = (x: number, y: number): boolean => {
    const ia = fills(ruleA, inA(x, y));
    const ib = fills(ruleB, inB(x, y));
    return op === 'union' ? ia || ib : op === 'difference' ? ia && !ib : ia && ib;
  };

  // Vertices by number. The same point object is met again and again - an
  // edge's end is the next edge's start, a crossing lies on two edges - so
  // each is looked up by identity first and keyed by position only once.
  const byKey = new Map<string, number>();
  const byPoint = new Map<Vec, number>();
  const vertexOf = (p: Vec): number => {
    let id = byPoint.get(p);
    if (id === undefined) {
      const key = pointKey(p);
      id = byKey.get(key);
      if (id === undefined) {
        id = byKey.size;
        byKey.set(key, id);
      }
      byPoint.set(p, id);
    }
    return id;
  };

  // The cut pieces with the result on exactly one side, turned to keep it on
  // their right. Two pieces laid over each other the same way would count
  // that side twice, so only one is kept.
  const kept: Array<{ a: Vec; b: Vec; from: number; to: number; src: 0 | 1 }> = [];
  const seen = new Set<number>();
  const nudge = 1e-7;
  for (const e of edges) {
    e.cuts.sort((m, n) => m.t - n.t);
    let from = e.a;
    let fromId = vertexOf(from);
    for (let c = 0; c <= e.cuts.length; c++) {
      const to = c < e.cuts.length ? e.cuts[c].p : e.b;
      const toId = vertexOf(to);
      if (toId === fromId) continue;
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const nx = ((to.y - from.y) / len) * nudge;
      const ny = (-(to.x - from.x) / len) * nudge;
      const onLeft = inside(mx + nx, my + ny);
      const onRight = inside(mx - nx, my - ny);
      if (onLeft !== onRight) {
        const piece = onRight
          ? { a: from, b: to, from: fromId, to: toId, src: e.src }
          : { a: to, b: from, from: toId, to: fromId, src: e.src };
        const pair = piece.from * 2 ** 26 + piece.to;
        if (!seen.has(pair)) {
          seen.add(pair);
          kept.push(piece);
        }
      }
      from = to;
      fromId = toId;
    }
  }

  // Every vertex a boundary passes through is left as often as it is reached.
  const outgoing: number[][] = Array.from({ length: byKey.size }, () => []);
  const balance = new Int32Array(byKey.size);
  kept.forEach((e, i) => {
    outgoing[e.from].push(i);
    balance[e.from] += 1;
    balance[e.to] -= 1;
  });
  if (balance.some((count) => count !== 0)) return 'unbalanced';

  // Walk them into contours. Where boundaries touch at a point, the sharpest
  // turn towards the fill keeps each contour round its own patch.
  const used = new Uint8Array(kept.length);
  const contours: Vec[][] = [];
  const junctions = new Set<Vec>();
  for (let s = 0; s < kept.length; s++) {
    if (used[s]) continue;
    const home = kept[s].from;
    const loop: Vec[] = [];
    const turns: Vec[] = [];
    let e = s;
    for (;;) {
      used[e] = 1;
      loop.push(kept[e].a);
      const here = kept[e].to;
      let next = -1;
      if (here === home) {
        next = s;
      } else {
        const options = outgoing[here];
        if (options.length === 1) {
          if (!used[options[0]]) next = options[0];
        } else {
          const heading = { x: kept[e].b.x - kept[e].a.x, y: kept[e].b.y - kept[e].a.y };
          let sharpest = -Infinity;
          for (const i of options) {
            if (used[i]) continue;
            const turn = turnBetween(heading, { x: kept[i].b.x - kept[i].a.x, y: kept[i].b.y - kept[i].a.y });
            if (turn > sharpest) {
              sharpest = turn;
              next = i;
            }
          }
        }
        if (next < 0) return 'unbalanced';
      }
      // The outline passes from one operand to the other here: the point is
      // the one the contour holds, where the next piece begins (the operands
      // may each have a point of their own at the same place).
      if (kept[next].src !== kept[e].src) turns.push(kept[next].a);
      if (here === home) break;
      e = next;
    }
    const contour = tidy(loop);
    if (contour.length >= 3 && Math.abs(signedArea(contour)) > 1e-9) {
      contours.push(contour);
      for (const p of turns) junctions.add(p);
    }
  }
  return { contours, junctions, fromB: kept.some((piece) => piece.src === 1) };
}

/** The signed angle turned from heading `from` to heading `to`, in radians. */
function turnBetween(from: Vec, to: Vec): number {
  return Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
}

/**
 * A vertex's identity, to a millionth of a pixel: two pieces meet where
 * their ends share one.
 */
function pointKey(p: Vec): string {
  return `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
}

/**
 * Records every place two edges meet on both of them: where they cross, and
 * where an end of one lands on the other - a vertex of zero width sitting
 * exactly on another edge, as the seam of a closed Wave does. The edges are
 * swept along the longer side of their bounds, so only neighbours along the
 * stroke are ever compared.
 */
function findCrossings(edges: Edge[]): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.a.x, e.b.x);
    maxX = Math.max(maxX, e.a.x, e.b.x);
    minY = Math.min(minY, e.a.y, e.b.y);
    maxY = Math.max(maxY, e.a.y, e.b.y);
  }
  const along = maxX - minX >= maxY - minY ? 'x' : 'y';
  const across = along === 'x' ? 'y' : 'x';
  const lo = edges.map((e) => Math.min(e.a[along], e.b[along]));
  const hi = edges.map((e) => Math.max(e.a[along], e.b[along]));
  const side0 = edges.map((e) => Math.min(e.a[across], e.b[across]));
  const side1 = edges.map((e) => Math.max(e.a[across], e.b[across]));
  const order = edges.map((_, i) => i).sort((i, j) => lo[i] - lo[j]);
  for (let s = 0; s < order.length; s++) {
    const i = order[s];
    for (let u = s + 1; u < order.length; u++) {
      const j = order[u];
      if (lo[j] > hi[i]) break;
      if (side0[j] > side1[i] || side1[j] < side0[i]) continue;
      const e = edges[i];
      const f = edges[j];
      // Touching edges meet only where they touch, unless they lie along each other.
      const touched = [touch(e, f.a), touch(e, f.b), touch(f, e.a), touch(f, e.b)].some(Boolean);
      if (touched) continue;
      const hit = crossing(e.a, e.b, f.a, f.b);
      if (!hit) continue;
      e.cuts.push({ t: hit.t, p: hit.p });
      f.cuts.push({ t: hit.u, p: hit.p });
    }
  }
}

/** Cuts `e` at `p` when `p` lies on its interior, and says whether it did. */
function touch(e: Edge, p: Vec): boolean {
  const dx = e.b.x - e.a.x;
  const dy = e.b.y - e.a.y;
  const t = ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / (dx * dx + dy * dy);
  if (!(t > 0 && t < 1)) return false;
  if (Math.hypot(e.a.x + t * dx - p.x, e.a.y + t * dy - p.y) > 1e-7) return false;
  const k = pointKey(p);
  if (k === pointKey(e.a) || k === pointKey(e.b)) return false;
  e.cuts.push({ t, p });
  return true;
}

/**
 * How many times the edges wind about a point: a ray cast from it, across
 * whichever of its row or its column of the bounds holds fewer edges. The
 * two rays may disagree on the count's sign, never on whether it is zero or
 * odd, which is all a fill rule asks.
 */
function windingField(edges: Edge[]): (x: number, y: number) => number {
  if (edges.length === 0) return () => 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.a.x, e.b.x);
    maxX = Math.max(maxX, e.a.x, e.b.x);
    minY = Math.min(minY, e.a.y, e.b.y);
    maxY = Math.max(maxY, e.a.y, e.b.y);
  }
  const count = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(edges.length) * 4)));
  const rowSize = (maxY - minY) / count || 1;
  const colSize = (maxX - minX) / count || 1;
  const rowOf = (y: number): number => Math.min(count - 1, Math.max(0, Math.floor((y - minY) / rowSize)));
  const colOf = (x: number): number => Math.min(count - 1, Math.max(0, Math.floor((x - minX) / colSize)));
  const rows: Edge[][] = Array.from({ length: count }, () => []);
  const cols: Edge[][] = Array.from({ length: count }, () => []);
  for (const e of edges) {
    if (e.a.y !== e.b.y) {
      const last = rowOf(Math.max(e.a.y, e.b.y));
      for (let r = rowOf(Math.min(e.a.y, e.b.y)); r <= last; r++) rows[r].push(e);
    }
    if (e.a.x !== e.b.x) {
      const last = colOf(Math.max(e.a.x, e.b.x));
      for (let c = colOf(Math.min(e.a.x, e.b.x)); c <= last; c++) cols[c].push(e);
    }
  }
  return (x, y) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return 0;
    const row = rows[rowOf(y)];
    const col = cols[colOf(x)];
    let w = 0;
    if (row.length <= col.length) {
      for (const e of row) {
        if (e.a.y <= y === e.b.y <= y) continue;
        const cx = e.a.x + ((y - e.a.y) / (e.b.y - e.a.y)) * (e.b.x - e.a.x);
        if (cx > x) w += e.b.y > e.a.y ? 1 : -1;
      }
    } else {
      for (const e of col) {
        if (e.a.x <= x === e.b.x <= x) continue;
        const cy = e.a.y + ((x - e.a.x) / (e.b.x - e.a.x)) * (e.b.y - e.a.y);
        if (cy > y) w += e.b.x > e.a.x ? 1 : -1;
      }
    }
    return w;
  };
}

/** Where two segments cross each other's interiors, as fractions along both, or null. */
function crossing(a: Vec, b: Vec, c: Vec, d: Vec): { t: number; u: number; p: Vec } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { t, u, p: { x: a.x + t * rx, y: a.y + t * ry } };
}

/**
 * Drops the vertices a contour does not need: every one that sits on the
 * straight line between its neighbours, which a straight stretch of a
 * stroke leaves one of per sample.
 */
function tidy(loop: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of loop) {
    while (out.length >= 2 && straight(out[out.length - 2], out[out.length - 1], p)) out.pop();
    out.push(p);
  }
  while (out.length >= 3 && straight(out[out.length - 2], out[out.length - 1], out[0])) out.pop();
  while (out.length >= 3 && straight(out[out.length - 1], out[0], out[1])) out.shift();
  return out;
}

/** True when `b` lies on the way from `a` to `c`, within a millionth of a pixel. */
function straight(a: Vec, b: Vec, c: Vec): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  if (abx * bcx + aby * bcy <= 0) return false;
  return Math.abs(abx * bcy - aby * bcx) <= 1e-6 * Math.hypot(c.x - a.x, c.y - a.y);
}
