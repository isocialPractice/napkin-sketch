/**
 * SVG path data and basic shapes to Bézier anchors, and anchors to the points
 * a stroke carries, with no DOM.
 *
 * Reading a `d` attribute needs a cursor over a string and nothing else, so
 * this lives beside the model rather than in the importer: code that runs in
 * plain Node - the script language, the headless renderers, the CLI - reads
 * path data from here without importing a module built around `DOMParser`.
 * `renderer/svg-import.ts` uses the same functions for every element with a
 * `d` and every basic shape, samples its marks with the same sampler the
 * script language does, and re-exports the two parsers.
 *
 * Every curve comes out as cubic anchors in the shape the Vector Path tool
 * stores: quadratics degree-elevated exactly, and arcs split into pieces of at
 * most a quarter turn with handles 4/3·tan(Δθ/4) along the tangents.
 */

import { cubicBezierPoints } from '../sharpen/geometry.js';
import type { Point, VectorAnchor } from './types.js';

/** One subpath of parsed geometry: its Bézier anchors and whether it closes. */
export interface ParsedSubpath {
  anchors: VectorAnchor[];
  closed: boolean;
}

type Vec2 = { x: number; y: number };

/** Coordinates and handles closer than this read as the same point. */
const COINCIDENT = 1e-6;

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < COINCIDENT && Math.abs(a.y - b.y) < COINCIDENT;
}

/** Four-cubic ellipse approximation handle length, 4/3·(√2 − 1) of the radius. */
export const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/**
 * Accumulates segments into subpaths the way the Vector Path tool stores
 * them: a control point sitting on its anchor reads as a collapsed (absent)
 * handle, and a closed subpath's duplicate final anchor folds onto the first
 * so the closing segment carries the handles instead of a zero-length one.
 */
export class SubpathBuilder {
  readonly subpaths: ParsedSubpath[] = [];
  private current: ParsedSubpath | null = null;

  moveTo(p: Vec2): void {
    this.flush();
    this.current = { anchors: [{ p }], closed: false };
  }

  lineTo(p: Vec2): void {
    this.current?.anchors.push({ p });
  }

  cubicTo(c1: Vec2, c2: Vec2, p: Vec2): void {
    const anchors = this.current?.anchors;
    if (!anchors) return;
    const from = anchors[anchors.length - 1];
    if (!samePoint(c1, from.p)) from.hOut = c1;
    const to: VectorAnchor = { p };
    if (!samePoint(c2, p)) to.hIn = c2;
    anchors.push(to);
  }

  /**
   * A quadratic is written as the cubic that draws the identical curve
   * (degree elevation): the two cubic handles sit two thirds of the way from
   * each endpoint toward the single quadratic control point.
   */
  quadTo(c: Vec2, p: Vec2): void {
    const anchors = this.current?.anchors;
    if (!anchors) return;
    const from = anchors[anchors.length - 1].p;
    this.cubicTo(
      { x: from.x + (2 / 3) * (c.x - from.x), y: from.y + (2 / 3) * (c.y - from.y) },
      { x: p.x + (2 / 3) * (c.x - p.x), y: p.y + (2 / 3) * (c.y - p.y) },
      p,
    );
  }

  close(): void {
    const sub = this.current;
    if (!sub) return;
    sub.closed = true;
    const { anchors } = sub;
    if (anchors.length >= 3 && samePoint(anchors[anchors.length - 1].p, anchors[0].p)) {
      const last = anchors.pop()!;
      if (last.hIn) anchors[0].hIn = last.hIn;
    }
    this.flush();
  }

  /** Ends the current subpath, keeping it when it has at least one segment. */
  flush(): void {
    if (this.current && this.current.anchors.length >= 2) this.subpaths.push(this.current);
    this.current = null;
  }
}

/**
 * Builds the Bézier anchors of a basic shape element from its attributes.
 * A circle or ellipse is the four-cubic approximation (anchors on the axes,
 * handles KAPPA of the radius along the tangents); a rect is its four corners,
 * with rounded corners as quarter arcs; line, polyline, and polygon are their
 * points. Returns null for anything else.
 *
 * `attribute` reads one of the element's attributes, null when it is missing:
 * `getAttribute` in the importer, and a tag read from the text in code with no
 * DOM, so both build the same anchors from the same markup.
 */
export function elementSubpaths(tag: string, attribute: (name: string) => string | null): ParsedSubpath[] | null {
  const attr = (name: string, fallback = 0): number => {
    const n = parseFloat(attribute(name) ?? '');
    return Number.isFinite(n) ? n : fallback;
  };
  const builder = new SubpathBuilder();

  switch (tag) {
    case 'circle':
    case 'ellipse': {
      const cx = attr('cx');
      const cy = attr('cy');
      const rx = tag === 'circle' ? attr('r') : attr('rx');
      const ry = tag === 'circle' ? rx : attr('ry');
      if (rx <= 0 || ry <= 0) return [];
      const anchors: VectorAnchor[] = [];
      for (let k = 0; k < 4; k++) {
        const theta = (k * Math.PI) / 2;
        const p = { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
        const tangent = { x: -rx * Math.sin(theta), y: ry * Math.cos(theta) };
        anchors.push({
          p,
          hIn: { x: p.x - KAPPA * tangent.x, y: p.y - KAPPA * tangent.y },
          hOut: { x: p.x + KAPPA * tangent.x, y: p.y + KAPPA * tangent.y },
        });
      }
      return [{ anchors, closed: true }];
    }
    case 'rect': {
      const x = attr('x');
      const y = attr('y');
      const w = attr('width');
      const h = attr('height');
      if (w <= 0 || h <= 0) return [];
      let rx = attr('rx', -1);
      let ry = attr('ry', -1);
      // A missing radius copies the other; both missing means square corners.
      if (rx < 0 && ry < 0) rx = ry = 0;
      else if (rx < 0) rx = ry;
      else if (ry < 0) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) {
        builder.moveTo({ x, y });
        builder.lineTo({ x: x + w, y });
        builder.lineTo({ x: x + w, y: y + h });
        builder.lineTo({ x, y: y + h });
        builder.close();
        return builder.subpaths;
      }
      const corner = (from: Vec2, to: Vec2): void => {
        for (const [c1, c2, end] of arcToCubics(from, rx, ry, 0, false, true, to)) {
          builder.cubicTo(c1, c2, end);
        }
      };
      builder.moveTo({ x: x + rx, y });
      builder.lineTo({ x: x + w - rx, y });
      corner({ x: x + w - rx, y }, { x: x + w, y: y + ry });
      builder.lineTo({ x: x + w, y: y + h - ry });
      corner({ x: x + w, y: y + h - ry }, { x: x + w - rx, y: y + h });
      builder.lineTo({ x: x + rx, y: y + h });
      corner({ x: x + rx, y: y + h }, { x, y: y + h - ry });
      builder.lineTo({ x, y: y + ry });
      corner({ x, y: y + ry }, { x: x + rx, y });
      builder.close();
      return builder.subpaths;
    }
    case 'line': {
      builder.moveTo({ x: attr('x1'), y: attr('y1') });
      builder.lineTo({ x: attr('x2'), y: attr('y2') });
      builder.flush();
      return builder.subpaths;
    }
    case 'polyline':
    case 'polygon': {
      const nums = (attribute('points') ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
      if (!nums || nums.length < 4) return [];
      builder.moveTo({ x: Number(nums[0]), y: Number(nums[1]) });
      for (let k = 2; k + 1 < nums.length; k += 2) {
        builder.lineTo({ x: Number(nums[k]), y: Number(nums[k + 1]) });
      }
      if (tag === 'polygon') builder.close();
      else builder.flush();
      return builder.subpaths;
    }
    default:
      return null;
  }
}

/**
 * Parses SVG path data - every command, absolute or relative, with implicit
 * command repetition - into subpaths of cubic Bézier anchors. `H`/`V` become
 * lines, `S`/`T` reflect the previous handle (or collapse onto the current
 * point after any other command, per the specification), quadratics are
 * degree-elevated exactly, and arcs become the standard cubic approximation
 * in pieces of at most a quarter turn. Returns null for data the parser
 * cannot read (a malformed number, a missing leading `M`), in which case the
 * caller samples the element instead.
 */
export function parsePathD(d: string): ParsedSubpath[] | null {
  // Anything that is not a command, a number (exponents included), or a
  // separator is not path data.
  if (/[^MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]/.test(d)) return null;
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (!tokens || (tokens[0] !== 'M' && tokens[0] !== 'm')) return null;
  const builder = new SubpathBuilder();
  let i = 0;
  let cmd = '';
  let cur: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  let open = false;
  let lastCubicCtrl: Vec2 | null = null;
  let lastQuadCtrl: Vec2 | null = null;

  const num = (): number | null => {
    const t = tokens[i];
    if (t === undefined || /[A-Za-z]/.test(t)) return null;
    i++;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const point = (relative: boolean): Vec2 | null => {
    const x = num();
    const y = num();
    if (x === null || y === null) return null;
    return relative ? { x: cur.x + x, y: cur.y + y } : { x, y };
  };
  const flag = (): boolean | null => {
    const t = tokens[i];
    if (t !== '0' && t !== '1') return null;
    i++;
    return t === '1';
  };
  // A drawing command after `Z` continues from the closed subpath's start.
  const ensureOpen = (): void => {
    if (open) return;
    builder.moveTo(start);
    open = true;
  };
  const reflect = (ctrl: Vec2 | null): Vec2 =>
    ctrl ? { x: 2 * cur.x - ctrl.x, y: 2 * cur.y - ctrl.y } : cur;

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z' || cmd === 'z') {
        if (open) builder.close();
        open = false;
        cur = start;
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        continue;
      }
    }
    const relative = cmd === cmd.toLowerCase();
    let cubicCtrl: Vec2 | null = null;
    let quadCtrl: Vec2 | null = null;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const p = point(relative);
        if (!p) return null;
        builder.moveTo(p);
        open = true;
        cur = p;
        start = p;
        // Further pairs after a moveto are implicit linetos.
        cmd = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const p = point(relative);
        if (!p) return null;
        ensureOpen();
        builder.lineTo(p);
        cur = p;
        break;
      }
      case 'H': {
        const x = num();
        if (x === null) return null;
        const p = { x: relative ? cur.x + x : x, y: cur.y };
        ensureOpen();
        builder.lineTo(p);
        cur = p;
        break;
      }
      case 'V': {
        const y = num();
        if (y === null) return null;
        const p = { x: cur.x, y: relative ? cur.y + y : y };
        ensureOpen();
        builder.lineTo(p);
        cur = p;
        break;
      }
      case 'C': {
        const c1 = point(relative);
        const c2 = point(relative);
        const p = point(relative);
        if (!c1 || !c2 || !p) return null;
        ensureOpen();
        builder.cubicTo(c1, c2, p);
        cubicCtrl = c2;
        cur = p;
        break;
      }
      case 'S': {
        const c1 = reflect(lastCubicCtrl);
        const c2 = point(relative);
        const p = point(relative);
        if (!c2 || !p) return null;
        ensureOpen();
        builder.cubicTo(c1, c2, p);
        cubicCtrl = c2;
        cur = p;
        break;
      }
      case 'Q': {
        const c = point(relative);
        const p = point(relative);
        if (!c || !p) return null;
        ensureOpen();
        builder.quadTo(c, p);
        quadCtrl = c;
        cur = p;
        break;
      }
      case 'T': {
        const c = reflect(lastQuadCtrl);
        const p = point(relative);
        if (!p) return null;
        ensureOpen();
        builder.quadTo(c, p);
        quadCtrl = c;
        cur = p;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rotation = num();
        const large = flag();
        const sweep = flag();
        const p = point(relative);
        if (rx === null || ry === null || rotation === null || large === null || sweep === null || !p) {
          return null;
        }
        ensureOpen();
        for (const [c1, c2, end] of arcToCubics(cur, rx, ry, rotation, large, sweep, p)) {
          builder.cubicTo(c1, c2, end);
        }
        cur = p;
        break;
      }
      default:
        return null;
    }
    lastCubicCtrl = cubicCtrl;
    lastQuadCtrl = quadCtrl;
  }
  builder.flush();
  return builder.subpaths;
}

/**
 * Converts an SVG elliptical arc (endpoint parameterisation) into cubic
 * segments of at most a quarter turn each, per the SVG implementation notes:
 * recover the centre, then approximate each piece with handles of length
 * 4/3·tan(Δθ/4) along the ellipse's tangents - the same rule that gives
 * KAPPA for a quarter circle. Returns `[c1, c2, end]` triples.
 */
export function arcToCubics(
  from: Vec2,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  to: Vec2,
): [Vec2, Vec2, Vec2][] {
  if (samePoint(from, to)) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  // A zero radius draws a straight line to the endpoint.
  if (rx < COINCIDENT || ry < COINCIDENT) return [[from, to, to]];

  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  // Radii too small to span the chord scale up until they just do.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const numerator = Math.max(0, rx2 * ry2 - rx2 * y1 * y1 - ry2 * x1 * x1);
  const denominator = rx2 * y1 * y1 + ry2 * x1 * x1;
  let coef = denominator === 0 ? 0 : Math.sqrt(numerator / denominator);
  if (large === sweep) coef = -coef;
  const cxp = (coef * (rx * y1)) / ry;
  const cyp = (coef * -(ry * x1)) / rx;
  const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2;
  const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2;

  const angleBetween = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta1 = angleBetween(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = angleBetween((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const pointAt = (t: number): Vec2 => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const tangentAt = (t: number): Vec2 => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });

  const out: [Vec2, Vec2, Vec2][] = [];
  let t = theta1;
  let a = from;
  for (let k = 0; k < pieces; k++) {
    const t2 = t + step;
    // The final piece lands exactly on the given endpoint.
    const end = k === pieces - 1 ? to : pointAt(t2);
    const d1 = tangentAt(t);
    const d2 = tangentAt(t2);
    out.push([
      { x: a.x + alpha * d1.x, y: a.y + alpha * d1.y },
      { x: end.x - alpha * d2.x, y: end.y - alpha * d2.y },
      end,
    ]);
    a = end;
    t = t2;
  }
  return out;
}

/**
 * Parses a napkin-exported vector path - a single subpath of `M`, `L`/`H`/`V`,
 * `C`/`S` segments and an optional trailing `Z`, in either the absolute or the
 * relative spelling - back into Bézier anchors. A control point sitting on its
 * anchor reads as a collapsed (absent) handle, and a closed path's duplicate
 * final anchor folds onto the first. Returns null on anything else (a
 * quadratic, an arc, several subpaths), in which case the caller falls back to
 * sampling.
 */
export function parseVectorD(d: string): ParsedSubpath | null {
  if (!d || !/[CcSsZz]/.test(d)) return null; // open pure polylines parse elsewhere
  if (/[QqTtAa]/.test(d)) return null;
  const subpaths = parsePathD(d);
  // Exactly one subpath: a `Z` followed by more drawing, or a second `M`,
  // is not the format napkin writes.
  return subpaths && subpaths.length === 1 ? subpaths[0] : null;
}

/** A sampled point; `move` marks the first point of a later subpath. */
export interface SampledPoint {
  x: number;
  y: number;
  move?: true;
}

/** The fewest points a curved segment samples to, so a small curve still rounds on screen. */
export const MIN_SEGMENT_SAMPLES = 4;

/** The most points a curved segment samples to: the Vector Path tool's own resolution. */
export const MAX_SEGMENT_SAMPLES = 24;

/**
 * Samples the segments between anchors into stroke points, the way the
 * Vector Path tool does: straight segments contribute only their endpoint,
 * curved ones a run of samples scaled to the segment's size (four at the
 * least, so small curves still round on screen, and never more than the
 * editor's own segment resolution).
 */
export function sampleAnchors(anchors: readonly VectorAnchor[], closed: boolean): SampledPoint[] {
  if (anchors.length === 0) return [];
  const out: SampledPoint[] = [{ x: anchors[0].p.x, y: anchors[0].p.y }];
  const segment = (from: VectorAnchor, to: VectorAnchor): void => {
    if (!from.hOut && !to.hIn) {
      out.push({ x: to.p.x, y: to.p.y });
      return;
    }
    const c1 = from.hOut ?? from.p;
    const c2 = to.hIn ?? to.p;
    const hull =
      Math.hypot(c1.x - from.p.x, c1.y - from.p.y) +
      Math.hypot(c2.x - c1.x, c2.y - c1.y) +
      Math.hypot(to.p.x - c2.x, to.p.y - c2.y);
    const samples = Math.min(MAX_SEGMENT_SAMPLES, Math.max(MIN_SEGMENT_SAMPLES, Math.ceil(hull)));
    const a = { x: from.p.x, y: from.p.y, pressure: 0.5 };
    const b = { x: to.p.x, y: to.p.y, pressure: 0.5 };
    for (const p of cubicBezierPoints(a, c1, c2, b, samples).slice(1)) out.push({ x: p.x, y: p.y });
  };
  for (let k = 1; k < anchors.length; k++) segment(anchors[k - 1], anchors[k]);
  if (closed && anchors.length >= 2) segment(anchors[anchors.length - 1], anchors[0]);
  return out;
}

/**
 * Samples a whole mark - every subpath, each later one starting at a `move`
 * anchor - into the points a stroke carries, pressure and all. Each subpath is
 * sampled by {@link sampleAnchors} and closes back to its own start when the
 * mark is closed, which is how the canvas paints a compound shape.
 */
export function sampleOutline(anchors: readonly VectorAnchor[], closed: boolean): Point[] {
  const out: Point[] = [];
  let start = 0;
  for (let i = 1; i <= anchors.length; i++) {
    if (i < anchors.length && !anchors[i].move) continue;
    const sub = anchors.slice(start, i).map((a, k) => (k === 0 && a.move ? { ...a, move: undefined } : a));
    sampleAnchors(sub, closed).forEach((p, k) => {
      const point: Point = { x: p.x, y: p.y, pressure: 0.5 };
      if (k === 0 && start > 0) point.move = true;
      out.push(point);
    });
    start = i;
  }
  return out;
}
