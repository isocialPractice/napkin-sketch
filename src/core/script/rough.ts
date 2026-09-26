/**
 * The hand-drawn pass: `rough <amount>` turns exact anchors into anchors that
 * read as drawn by hand.
 *
 * The constants below set how far each kind of perturbation reaches at
 * `rough 1`, and every one of them scales in proportion to the amount, so
 * `rough 0` is exact.
 *
 * They were read off a contact sheet rather than derived: the triangle of
 * `mirror-triangle.svg`, the square and the tick of `color-picker-shapes.svg`
 * (both in `test/imports/`) and a four-cubic circle, drawn at twice their file
 * size - 100 to 200 px, the size a sketch draws shapes at - at rough 0, 0.3,
 * 0.6 and 1, and at 1 with a second pass. The targets were rough 0.3 barely
 * visible and rough 1 clearly drawn by hand, with no shape losing its outline.
 *
 * What the sheet showed, and so what the pass does:
 *
 * - Anchor drift alone leaves ruled lines between displaced corners. A straight
 *   segment has to bow, which makes it a gentle cubic.
 * - The bow grows with the square root of a segment's length. Grown in
 *   proportion, a 480 px side bowed as far for its size as a 60 px one, which
 *   no hand does.
 * - Only curves the source drew get their handles turned and stretched.
 *   Turning the handles of a bowed line bends it a second time, and in
 *   proportion to its length, which undoes the square root.
 * - A closed mark opens at its first anchor and runs on past it along the
 *   tangent it leaves by. Run along the chord instead, a circle kinks at the
 *   join.
 * - Drift is capped at a share of the distance to the neighbouring anchors, so
 *   a small shape keeps its outline.
 *
 * How it runs. The evaluator hands the pass each mark after the transform and
 * before sampling, so a wobble is measured on the page and not in a shape's
 * own units: a hand trembles as much drawing a small circle as a large one.
 * The noise is read along the mark, by distance, so anchors close together
 * drift together, as a hand carries them. A filled and outlined closed shape
 * comes back as two marks - the fill, roughened half as much, then the line -
 * because a hand colours a shape in and draws round it separately, and
 * because reopening the line at its join would otherwise leave nothing closed
 * to fill. A second pass restates the line, thinner and lighter.
 *
 * The noise is seeded per mark, from the script's seed, the mark's own
 * geometry and how many marks of the same geometry came before it. One script
 * and one seed draw the same bytes on every run, and editing one mark leaves
 * every other mark's wobble as it was.
 */

import type { VectorAnchor } from '../types.js';

type P = { x: number; y: number };

// ---- The measured constants ---------------------------------------------------

/** How far, in px, an anchor drifts at `rough 1`. */
export const ROUGH_ANCHOR_DRIFT_PX = 5;

/** The bow of a straight segment at `rough 1`: this times the square root of its length in px. */
export const ROUGH_BOW_PER_ROOT_PX = 0.57;

/** The share by which a curve's handles stretch or shrink at `rough 1`. */
export const ROUGH_HANDLE_STRETCH = 0.2;

/** The degrees a curve's handles turn at `rough 1`. Both handles of an anchor turn together. */
export const ROUGH_HANDLE_TURN_DEGREES = 6;

/** The distance, in px, over which the noise makes one wobble: anchors further apart drift independently. */
export const ROUGH_WAVELENGTH_PX = 80;

/** How far an open mark runs past each end at `rough 1`, in stroke widths: the default `overshoot`. */
export const ROUGH_OVERSHOOT_WIDTHS = 1.5;

/** Anchor drift never exceeds this share of the distance to a neighbouring anchor. */
export const ROUGH_DRIFT_CAP = 0.15;

/** A second pass is drawn at this share of the first pass's width. */
export const ROUGH_SECOND_PASS_WIDTH = 0.6;

/** A second pass is drawn at this opacity. */
export const ROUGH_SECOND_PASS_OPACITY = 0.55;

/** A fill under an outline is roughened this share as much as the line, so it stays near the line without matching it. */
export const ROUGH_FILL_SHARE = 0.5;

/** A reopened closed mark ends this share of the anchor drift away from where it began, so its two ends do not meet exactly. */
export const ROUGH_JOIN_DRIFT = 0.6;

/** An overshoot runs no further than this share of the segment it extends, so a short mark is not stretched out of shape. */
export const ROUGH_OVERSHOOT_CAP = 0.25;

// ---- Seeded noise ---------------------------------------------------------------

/** The murmur3 finalizer: spreads the bits of a 32-bit number over the whole word. */
function finalize(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Folds one whole number into a running hash. */
function mix(h: number, value: number): number {
  return finalize((h ^ Math.imul(value | 0, 0x9e3779b1)) + 0x7f4a7c15);
}

/**
 * A 32-bit hash of whole numbers. Integer arithmetic only, so it is the same
 * number on every machine and in every JavaScript engine.
 */
export function hash32(...values: readonly number[]): number {
  let h = 0x6a09e667;
  for (const value of values) h = mix(h, value);
  return h;
}

/**
 * A number that tells one mark's geometry from another's: every anchor and
 * handle, rounded to a 64th of a pixel so that a difference in the last bit
 * of a coordinate does not count.
 */
export function geometryKey(anchors: readonly VectorAnchor[]): number {
  const q = (v: number): number => Math.round(v * 64);
  let h = 0x3c6ef372;
  for (const a of anchors) {
    h = mix(mix(h, q(a.p.x)), q(a.p.y));
    if (a.hIn) h = mix(mix(mix(h, 1), q(a.hIn.x)), q(a.hIn.y));
    if (a.hOut) h = mix(mix(mix(h, 2), q(a.hOut.x)), q(a.hOut.y));
    if (a.move) h = mix(h, 3);
  }
  return h;
}

/** The noise channels a mark's stream feeds, so each kind of wobble moves on its own. */
const DRIFT_X = 1;
const DRIFT_Y = 2;
const BOW = 3;
const TURN = 4;
const STRETCH = 5;
const JOIN_X = 6;
const JOIN_Y = 7;

/** The pieces a mark's stream is split between. */
const FILL_PIECE = 11;
const LINE_PIECE = 12;
const RESTATE_PIECE = 13;

/**
 * Smooth noise along a line: a value from -1 to 1 at every whole number,
 * eased between them, so nearby inputs give nearby values.
 */
function noise(stream: number, channel: number): (x: number) => number {
  const at = (i: number): number => (hash32(stream, channel, i) / 0xffffffff) * 2 - 1;
  return (x: number): number => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = at(i);
    return a + (at(i + 1) - a) * u;
  };
}

// ---- The pass ---------------------------------------------------------------------

/** The hand-drawn pass as a mark is drawn with it: what `rough` last set. */
export interface RoughSettings {
  /** 0 is exact; 1 is clearly drawn by hand. */
  amount: number;
  /** 1, or 2 to restate the line once. */
  passes: number;
  /** How far, in page pixels, a line runs past its ends; absent for the default. */
  overshoot?: number;
}

/** What a mark shows: its fill, its line, and how wide the line is on the page. */
export interface RoughPaint {
  /** The mark is closed and carries a fill or a gradient. */
  filled: boolean;
  /** The mark draws its line. */
  stroked: boolean;
  /** The line's width on the page, in pixels. */
  width: number;
}

/** One mark to draw in place of the exact one. */
export interface RoughPiece {
  anchors: VectorAnchor[];
  closed: boolean;
  /** The piece carries the mark's fill. */
  fill: boolean;
  /** The piece draws the mark's line. */
  stroke: boolean;
  /** The piece is the second pass: drawn thinner and lighter. */
  restate: boolean;
}

/**
 * A mark as a hand would draw it: the marks to draw in its place, from the
 * back to the front. `stream` is the mark's noise, from the seed and the mark
 * itself (see {@link hash32} and {@link geometryKey}).
 *
 * - A filled and outlined closed mark is a fill, roughened by
 *   {@link ROUGH_FILL_SHARE} of the amount on its own stream, and then its
 *   line.
 * - A filled closed mark with no line is the fill alone, roughened fully,
 *   since its edge is all there is to see.
 * - A line runs past its ends by the overshoot; a closed line opens at its
 *   start to do so. With an overshoot of 0 a closed line stays closed.
 * - With two passes, the line is drawn again on a stream of its own.
 */
export function roughMark(
  anchors: readonly VectorAnchor[],
  closed: boolean,
  paint: RoughPaint,
  settings: RoughSettings,
  stream: number,
): RoughPiece[] {
  const amount = Math.max(0, Math.min(1, settings.amount));
  const pieces: RoughPiece[] = [];
  if (paint.filled && closed) {
    const share = paint.stroked ? amount * ROUGH_FILL_SHARE : amount;
    pieces.push({ anchors: drawn(anchors, true, share, hash32(stream, FILL_PIECE), 0), closed: true, fill: true, stroke: false, restate: false });
    if (!paint.stroked) return pieces;
  }
  const reach = paint.stroked ? (settings.overshoot ?? amount * ROUGH_OVERSHOOT_WIDTHS * paint.width) : 0;
  const reopens = closed && reach > 0;
  const line = (piece: number, restate: boolean): RoughPiece => ({
    anchors: drawn(anchors, closed, amount, hash32(stream, piece), reach),
    closed: closed && !reopens,
    fill: false,
    stroke: paint.stroked,
    restate,
  });
  pieces.push(line(LINE_PIECE, false));
  if (settings.passes > 1 && paint.stroked) pieces.push(line(RESTATE_PIECE, true));
  return pieces;
}

/**
 * One mark's anchors drawn by hand: each subpath wobbled, then run past its
 * ends by `reach`. The anchors given are not changed.
 */
function drawn(anchors: readonly VectorAnchor[], closed: boolean, amount: number, stream: number, reach: number): VectorAnchor[] {
  const out: VectorAnchor[] = [];
  let along = 0;
  splitSubpaths(anchors).forEach((sub, k) => {
    const start = along;
    along = wobble(sub, closed, amount, stream, start);
    const finished = reach > 0 ? overshoot(sub, closed, reach, joinDrift(sub, amount, stream, along)) : sub;
    finished.forEach((anchor, i) => {
      delete anchor.move;
      if (k > 0 && i === 0) anchor.move = true;
      out.push(anchor);
    });
  });
  return out;
}

/** A mark's subpaths, each a copy of its anchors. */
function splitSubpaths(anchors: readonly VectorAnchor[]): VectorAnchor[][] {
  const out: VectorAnchor[][] = [];
  for (const a of anchors) {
    if (a.move || out.length === 0) out.push([]);
    const copy: VectorAnchor = { p: { x: a.p.x, y: a.p.y } };
    if (a.hIn) copy.hIn = { x: a.hIn.x, y: a.hIn.y };
    if (a.hOut) copy.hOut = { x: a.hOut.x, y: a.hOut.y };
    out[out.length - 1].push(copy);
  }
  return out;
}

const DEGREES = Math.PI / 180;

function distance(a: P, b: P): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Moves an anchor and its handles together. */
function shift(anchor: VectorAnchor, dx: number, dy: number): void {
  anchor.p = { x: anchor.p.x + dx, y: anchor.p.y + dy };
  if (anchor.hIn) anchor.hIn = { x: anchor.hIn.x + dx, y: anchor.hIn.y + dy };
  if (anchor.hOut) anchor.hOut = { x: anchor.hOut.x + dx, y: anchor.hOut.y + dy };
}

/** A handle turned about its anchor by `angle` radians and scaled by `grow`. */
function turned(p: P, handle: P, angle: number, grow: number): P {
  const dx = handle.x - p.x;
  const dy = handle.y - p.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x + (dx * c - dy * s) * grow, y: p.y + (dx * s + dy * c) * grow };
}

/**
 * One subpath, drawn by hand, in place: its straight segments bowed, the
 * handles the source drew turned and stretched, and every anchor drifted.
 * `start` is how far along the mark the subpath begins, so each subpath reads
 * its own stretch of the noise. Returns how far along the mark it ends.
 */
function wobble(anchors: VectorAnchor[], closed: boolean, amount: number, stream: number, start: number): number {
  const n = anchors.length;
  const along: number[] = [start];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + distance(anchors[i - 1].p, anchors[i].p));
  const end = along[n - 1] + (closed && n > 1 ? distance(anchors[n - 1].p, anchors[0].p) : 0);
  if (n < 2 || !(amount > 0)) return end;

  // What the source drew, before anything is added: only its own curves turn.
  const curvedIn = anchors.map((a) => Boolean(a.hIn));
  const curvedOut = anchors.map((a) => Boolean(a.hOut));
  const caps = anchors.map((a, i) => {
    const near: number[] = [];
    if (i > 0 || closed) near.push(distance(a.p, anchors[(i + n - 1) % n].p));
    if (i < n - 1 || closed) near.push(distance(a.p, anchors[(i + 1) % n].p));
    // No further than the measured drift, and no further than a share of the way to a neighbour.
    return Math.min(amount * ROUGH_ANCHOR_DRIFT_PX, ROUGH_DRIFT_CAP * Math.min(...near));
  });

  // A straight segment bows: its handles sit at its thirds, pushed off the line.
  const bow = noise(stream, BOW);
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    if (a.hOut || b.hIn) continue;
    const length = distance(a.p, b.p);
    if (length < 1e-9) continue;
    const ux = (b.p.x - a.p.x) / length;
    const uy = (b.p.y - a.p.y) / length;
    const reach = amount * ROUGH_BOW_PER_ROOT_PX * Math.sqrt(length);
    const first = reach * bow((along[i] + length / 3) / ROUGH_WAVELENGTH_PX);
    const second = reach * bow((along[i] + (2 * length) / 3) / ROUGH_WAVELENGTH_PX);
    a.hOut = { x: a.p.x + (ux * length) / 3 - uy * first, y: a.p.y + (uy * length) / 3 + ux * first };
    b.hIn = { x: b.p.x - (ux * length) / 3 - uy * second, y: b.p.y - (uy * length) / 3 + ux * second };
  }

  // The source's curves turn and stretch, both handles of an anchor alike, and every anchor drifts.
  const turn = noise(stream, TURN);
  const stretch = noise(stream, STRETCH);
  const driftX = noise(stream, DRIFT_X);
  const driftY = noise(stream, DRIFT_Y);
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    const t = along[i] / ROUGH_WAVELENGTH_PX;
    const angle = amount * ROUGH_HANDLE_TURN_DEGREES * turn(t) * DEGREES;
    const grow = 1 + amount * ROUGH_HANDLE_STRETCH * stretch(t);
    if (curvedIn[i] && a.hIn) a.hIn = turned(a.p, a.hIn, angle, grow);
    if (curvedOut[i] && a.hOut) a.hOut = turned(a.p, a.hOut, angle, grow);
    let dx = amount * ROUGH_ANCHOR_DRIFT_PX * driftX(t);
    let dy = amount * ROUGH_ANCHOR_DRIFT_PX * driftY(t);
    const drift = Math.hypot(dx, dy);
    if (drift > caps[i]) {
      dx *= caps[i] / drift;
      dy *= caps[i] / drift;
    }
    shift(a, dx, dy);
  }
  return end;
}

/** Where a reopened closed subpath lands off its start: a share of the anchor drift, capped as the drift is. */
function joinDrift(anchors: readonly VectorAnchor[], amount: number, stream: number, along: number): P {
  if (anchors.length < 2) return { x: 0, y: 0 };
  const t = along / ROUGH_WAVELENGTH_PX;
  let dx = amount * ROUGH_ANCHOR_DRIFT_PX * ROUGH_JOIN_DRIFT * noise(stream, JOIN_X)(t);
  let dy = amount * ROUGH_ANCHOR_DRIFT_PX * ROUGH_JOIN_DRIFT * noise(stream, JOIN_Y)(t);
  const cap = Math.min(amount * ROUGH_ANCHOR_DRIFT_PX * ROUGH_JOIN_DRIFT, ROUGH_DRIFT_CAP * distance(anchors[0].p, anchors[1].p));
  const drift = Math.hypot(dx, dy);
  if (drift > cap) {
    dx *= cap / drift;
    dy *= cap / drift;
  }
  return { x: dx, y: dy };
}

/** A direction as a unit vector; nothing for a direction of no length. */
function unit(dx: number, dy: number): P | null {
  const length = Math.hypot(dx, dy);
  return length < 1e-12 ? null : { x: dx / length, y: dy / length };
}

/**
 * A subpath run on past its ends, as a pen does that does not stop exactly
 * where the line does. An open subpath carries on at each end along its
 * tangent there. A closed one opens at its start and carries on past it along
 * the tangent it leaves by, landing `join` away from where it began. Neither
 * runs further than {@link ROUGH_OVERSHOOT_CAP} of the segment it extends.
 */
function overshoot(anchors: VectorAnchor[], closed: boolean, reach: number, join: P): VectorAnchor[] {
  const n = anchors.length;
  if (n < 2) return anchors;
  if (closed) {
    const first = anchors[0];
    const lead = first.hOut
      ? unit(first.hOut.x - first.p.x, first.hOut.y - first.p.y)
      : unit(anchors[1].p.x - first.p.x, anchors[1].p.y - first.p.y);
    const run = Math.min(reach, ROUGH_OVERSHOOT_CAP * distance(first.p, anchors[1].p));
    const dx = (lead?.x ?? 0) * run + join.x;
    const dy = (lead?.y ?? 0) * run + join.y;
    const end: VectorAnchor = { p: { x: first.p.x + dx, y: first.p.y + dy } };
    if (first.hIn) {
      end.hIn = { x: first.hIn.x + dx, y: first.hIn.y + dy };
      delete first.hIn;
    }
    anchors.push(end);
    return anchors;
  }
  const first = anchors[0];
  const lead = first.hOut
    ? unit(first.hOut.x - first.p.x, first.hOut.y - first.p.y)
    : unit(anchors[1].p.x - first.p.x, anchors[1].p.y - first.p.y);
  const back = Math.min(reach, ROUGH_OVERSHOOT_CAP * distance(first.p, anchors[1].p));
  const last = anchors[n - 1];
  const before = anchors[n - 2];
  const trail = last.hIn ? unit(last.p.x - last.hIn.x, last.p.y - last.hIn.y) : unit(last.p.x - before.p.x, last.p.y - before.p.y);
  const on = Math.min(reach, ROUGH_OVERSHOOT_CAP * distance(before.p, last.p));
  if (lead) shift(first, -lead.x * back, -lead.y * back);
  if (trail) shift(last, trail.x * on, trail.y * on);
  return anchors;
}
