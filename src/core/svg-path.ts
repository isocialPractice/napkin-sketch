/**
 * SVG path data written at the fewest bytes that still read back as the same
 * coordinates: the path writer the sketch SVG export uses, and the PNG
 * lowering too, so both formats draw one geometry.
 */

import { simplify } from '../sharpen/geometry.js';
import type { Point, Stroke, VectorAnchor } from './types.js';

/** Rounds to two decimals, the precision path data is written at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Tolerance (px) for dropping redundant polyline samples on export: a tenth
 * of a pixel is below anything a freehand stroke can show, so pruning to it
 * keeps files compact without a visible change. Vector anchors are never
 * pruned - they are the curve's definition, not samples of it.
 */
export const EXPORT_SIMPLIFY_EPSILON = 0.1;

/**
 * Formats a path-data coordinate: two decimals, no trailing zeros, and no
 * leading zero in front of a fraction (`.5`, `-.5`). Path data is where the
 * numbers are, so the two bytes every SVG reader is happy to do without are
 * worth dropping there even though {@link fmt} keeps them in attributes.
 */
function fmtPathNum(n: number): string {
  const s = String(Math.round(n * 100) / 100);
  if (s.startsWith('0.')) return s.slice(1);
  if (s.startsWith('-0.')) return `-${s.slice(2)}`;
  return s;
}

/**
 * Renders one path command without committing it, so a caller can price two
 * spellings of the same segment against each other.
 *
 * The command letter is left out when it repeats the previous one (readers
 * carry it over), and a separator is left out wherever the next number is
 * self-delimiting: a leading `-` always is, and a leading `.` is once the
 * number before it has already spent its decimal point.
 */
function renderCommand(
  letter: string,
  nums: number[],
  lastLetter: string,
  prevNum: string,
): { text: string; prevNum: string } {
  let text = letter === lastLetter ? '' : letter;
  let prev = letter === lastLetter ? prevNum : '';
  for (const n of nums) {
    const token = fmtPathNum(n);
    const joined =
      prev !== '' && !(token.startsWith('-') || (token.startsWith('.') && prev.includes('.')));
    text += joined ? ` ${token}` : token;
    prev = token;
  }
  return { text, prevNum: prev };
}

/**
 * Builds SVG path data at the smallest byte count that still parses back to
 * the exact coordinates written.
 *
 * Four reductions, none of which moves a curve: every command is offered in
 * both its absolute and its relative spelling and the shorter one wins; a
 * repeated command letter is dropped; an axis-aligned line collapses to
 * `H`/`V`; and a cubic whose incoming handle mirrors the outgoing handle of
 * the cubic before it collapses to `S`, which draws the identical curve with
 * two numbers instead of four.
 *
 * Relative deltas are measured from the *rounded* current point rather than
 * the true one, so a reader reconstructs the rounded absolute coordinate
 * exactly and nothing drifts along a long path.
 */
export class PathData {
  private text = '';
  private prevNum = '';
  private last = '';
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  /** Second control point of the cubic just written; null after anything else. */
  private ctrl: { x: number; y: number } | null = null;

  toString(): string {
    return this.text;
  }

  moveTo(px: number, py: number): void {
    const x = round2(px);
    const y = round2(py);
    this.emit('M', [x, y], [round2(x - this.x), round2(y - this.y)]);
    // A further coordinate pair after a moveto is an implicit lineto, so that
    // is the letter the next command has to beat.
    this.last = this.last === 'M' ? 'L' : 'l';
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
    this.ctrl = null;
  }

  lineTo(px: number, py: number): void {
    const x = round2(px);
    const y = round2(py);
    if (y === this.y && x !== this.x) {
      this.emit('H', [x], [round2(x - this.x)]);
    } else if (x === this.x && y !== this.y) {
      this.emit('V', [y], [round2(y - this.y)]);
    } else {
      this.emit('L', [x, y], [round2(x - this.x), round2(y - this.y)]);
    }
    this.x = x;
    this.y = y;
    this.ctrl = null;
  }

  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number): void {
    const ax = round2(c1x);
    const ay = round2(c1y);
    const bx = round2(c2x);
    const by = round2(c2y);
    const x = round2(px);
    const y = round2(py);
    // A smooth join writes its leading handle as the reflection of the last
    // one, which is what `S` infers for free.
    const smooth =
      this.ctrl !== null &&
      ax === round2(2 * this.x - this.ctrl.x) &&
      ay === round2(2 * this.y - this.ctrl.y);
    if (smooth) {
      this.emit(
        'S',
        [bx, by, x, y],
        [round2(bx - this.x), round2(by - this.y), round2(x - this.x), round2(y - this.y)],
      );
    } else {
      this.emit(
        'C',
        [ax, ay, bx, by, x, y],
        [
          round2(ax - this.x),
          round2(ay - this.y),
          round2(bx - this.x),
          round2(by - this.y),
          round2(x - this.x),
          round2(y - this.y),
        ],
      );
    }
    this.x = x;
    this.y = y;
    this.ctrl = { x: bx, y: by };
  }

  close(): void {
    this.emit('Z', [], []);
    this.x = this.startX;
    this.y = this.startY;
    this.ctrl = null;
  }

  /** Writes whichever of the two spellings costs fewer bytes here. */
  private emit(absolute: string, absArgs: number[], relArgs: number[]): void {
    const abs = renderCommand(absolute, absArgs, this.last, this.prevNum);
    const relative = absolute.toLowerCase();
    const rel = renderCommand(relative, relArgs, this.last, this.prevNum);
    const shorter = rel.text.length < abs.text.length;
    this.text += shorter ? rel.text : abs.text;
    this.prevNum = shorter ? rel.prevNum : abs.prevNum;
    this.last = shorter ? relative : absolute;
  }
}

/**
 * Path data for a stroke: strokes carrying Bézier anchor structure export as
 * exact cubic curves (a handful of C segments instead of hundreds of sampled
 * L points), everything else as its sampled polyline with samples that sit
 * within {@link EXPORT_SIMPLIFY_EPSILON} of the line through their
 * neighbours pruned away.
 */
export function pathD(stroke: Stroke): string {
  const anchors = stroke.vector?.anchors;
  const out = new PathData();
  if (anchors && anchors.length >= 2) {
    const segment = (from: VectorAnchor, to: VectorAnchor): void => {
      if (!from.hOut && !to.hIn) {
        out.lineTo(to.p.x, to.p.y);
        return;
      }
      const c1 = from.hOut ?? from.p;
      const c2 = to.hIn ?? to.p;
      out.curveTo(c1.x, c1.y, c2.x, c2.y, to.p.x, to.p.y);
    };
    // A compound path is several subpaths; each closes back to its own start.
    const closed = stroke.vector?.closed === true;
    out.moveTo(anchors[0].p.x, anchors[0].p.y);
    let subStart = 0;
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i].move) {
        if (closed) {
          segment(anchors[i - 1], anchors[subStart]);
          out.close();
        }
        out.moveTo(anchors[i].p.x, anchors[i].p.y);
        subStart = i;
        continue;
      }
      segment(anchors[i - 1], anchors[i]);
    }
    if (closed) {
      segment(anchors[anchors.length - 1], anchors[subStart]);
      out.close();
    }
    return out.toString();
  }
  // A compound stroke lifts the pen at each `move` point, so each run is a
  // subpath of its own - and is simplified on its own, since RDP across the
  // break would read the jump between two contours as part of the line.
  let run: Point[] = [];
  const flush = (): void => {
    simplify(run, EXPORT_SIMPLIFY_EPSILON).forEach((p, i) =>
      i === 0 ? out.moveTo(p.x, p.y) : out.lineTo(p.x, p.y),
    );
    run = [];
  };
  for (const p of stroke.points) {
    if (p.move && run.length > 0) flush();
    run.push(p);
  }
  if (run.length > 0) flush();
  return out.toString();
}
