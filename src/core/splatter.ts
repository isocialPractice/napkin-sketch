/**
 * Splatter: a vector editor's Scribble (Effect > Stylize > Scribble). A
 * region is filled with one loose, continuous hatch, as a pen scribbles a
 * shape in: back and forth across it at an angle, a pass `spacing` from the
 * last, turning at its edges.
 *
 * {@link splatterPaths} draws it:
 *
 * 1. the region is turned by the angle, so the hatch runs along the x axis;
 * 2. scanlines are cut across it, `spacing` apart, each varied by the seed,
 *    and each line's spans inside the region found under the non-zero rule;
 * 3. the spans are chained into runs, one span a line, as far as each one
 *    meets the next - where the region splits round a hole or into two
 *    fingers, a run ends and new ones begin, so no pass crosses what is not
 *    the region;
 * 4. each run zig-zags from one end of a span to the far end of the next,
 *    each fold carried past the edge by Path Overlap, or held short of it by
 *    a negative one, plus its variation;
 * 5. each fold is rounded by handles along the turn, as long as Curviness
 *    asks: none at 0 (a sharp zig-zag), loops near 100;
 * 6. and everything is turned back.
 *
 * The result is Bezier anchors, one per fold and no more: an open path a
 * run. Pure, and the same from the same seed every time.
 */

import type { Vec } from './boolean.js';
import { mulberry32 } from './random.js';
import type { VectorAnchor } from './types.js';

/** What a Splatter draws, with a vector editor's Scribble Options' names. */
export interface SplatterOptions {
  /** The hatch's direction, in degrees counterclockwise from the right, -180 to 180. */
  angle: number;
  /** How far each fold reaches past the region's edge; a negative overlap stops short of it. */
  overlap: number;
  /** How much the overlap varies, fold to fold, either way. */
  overlapVariation: number;
  /** The hatch line's width. */
  width: number;
  /** How round each turn is, in percent: 0 is a sharp zig-zag, 100 loops. */
  curviness: number;
  /** How much the curviness varies, turn to turn, in percent. */
  curvinessVariation: number;
  /** The distance from one pass to the next. */
  spacing: number;
  /** How much the spacing varies, pass to pass, either way. */
  spacingVariation: number;
  /** Seeds every variation: the same seed draws the same hatch. */
  seed: number;
}

/** The presets, by a vector editor's Scribble presets' names. */
export const SPLATTER_PRESET_NAMES = [
  'default',
  'childlike',
  'dense',
  'loose',
  'moire',
  'sharp',
  'sketch',
  'snarl',
  'swash',
  'tight',
  'zig-zag',
] as const;

export type SplatterPresetName = (typeof SPLATTER_PRESET_NAMES)[number];

/** What a preset sets: everything but the seed. */
export type SplatterValues = Omit<SplatterOptions, 'seed'>;

/**
 * The presets' values. Default is a vector editor's own. The rest are this
 * app's reading of each one's character - its published values were not to
 * be had - in the same units: Dense and Tight close and fine, Loose and
 * Swash wide and swinging, Sharp and Zig-zag angular, Snarl tangled,
 * Childlike thick and wobbly, Sketch a pencil's hatch, Moire hairlines.
 */
export const SPLATTER_PRESETS: Readonly<Record<SplatterPresetName, Readonly<SplatterValues>>> = {
  default: { angle: 30, overlap: 0, overlapVariation: 5, width: 3, curviness: 5, curvinessVariation: 1, spacing: 5, spacingVariation: 0.5 },
  childlike: { angle: 30, overlap: 3, overlapVariation: 10, width: 4, curviness: 15, curvinessVariation: 20, spacing: 9, spacingVariation: 3 },
  dense: { angle: 30, overlap: 0, overlapVariation: 1, width: 1, curviness: 5, curvinessVariation: 2, spacing: 2, spacingVariation: 0.3 },
  loose: { angle: 30, overlap: 5, overlapVariation: 10, width: 2, curviness: 25, curvinessVariation: 20, spacing: 12, spacingVariation: 4 },
  moire: { angle: 30, overlap: 0, overlapVariation: 0, width: 0.5, curviness: 0, curvinessVariation: 0, spacing: 1.5, spacingVariation: 0 },
  sharp: { angle: 30, overlap: 0, overlapVariation: 2, width: 2, curviness: 0, curvinessVariation: 0, spacing: 5, spacingVariation: 1 },
  sketch: { angle: 30, overlap: 1, overlapVariation: 3, width: 1, curviness: 2, curvinessVariation: 5, spacing: 3, spacingVariation: 1 },
  snarl: { angle: 30, overlap: 5, overlapVariation: 15, width: 2, curviness: 60, curvinessVariation: 40, spacing: 5, spacingVariation: 3 },
  swash: { angle: 30, overlap: 10, overlapVariation: 20, width: 4, curviness: 80, curvinessVariation: 20, spacing: 20, spacingVariation: 5 },
  tight: { angle: 30, overlap: 0, overlapVariation: 0.5, width: 1, curviness: 2, curvinessVariation: 1, spacing: 2.5, spacingVariation: 0.2 },
  'zig-zag': { angle: 30, overlap: 0, overlapVariation: 0, width: 1.5, curviness: 0, curvinessVariation: 0, spacing: 4, spacingVariation: 0 },
};

/** Each preset as a person reads it. */
export const SPLATTER_PRESET_LABELS: Readonly<Record<SplatterPresetName, string>> = {
  default: 'Default',
  childlike: 'Childlike',
  dense: 'Dense',
  loose: 'Loose',
  moire: 'Moire',
  sharp: 'Sharp',
  sketch: 'Sketch',
  snarl: 'Snarl',
  swash: 'Swash',
  tight: 'Tight',
  'zig-zag': 'Zig-zag',
};

/** A preset by its name, any case, or undefined for none. */
export function splatterPresetOf(name: unknown): SplatterPresetName | undefined {
  if (typeof name !== 'string') return undefined;
  const wanted = name.trim().toLowerCase();
  return SPLATTER_PRESET_NAMES.find((preset) => preset === wanted || SPLATTER_PRESET_LABELS[preset].toLowerCase() === wanted);
}

/** The preset whose values a Splatter has - its seed aside - or undefined when it matches none. */
export function matchingPreset(values: Readonly<SplatterValues>): SplatterPresetName | undefined {
  const keys = Object.keys(SPLATTER_PRESETS.default) as (keyof SplatterValues)[];
  return SPLATTER_PRESET_NAMES.find((name) => keys.every((key) => Math.abs(SPLATTER_PRESETS[name][key] - values[key]) < 1e-9));
}

/** The most scanlines a region is cut into; a finer spacing over a bigger region is widened to fit. */
export const SPLATTER_MAX_PASSES = 4000;

/** How long a turn's handles are at 100% curviness, in spacings: long enough to loop. */
const CURL = 2;

/** A span of one scanline inside the region. */
interface Span {
  y: number;
  a: number;
  b: number;
}

/**
 * The hatch a Splatter draws over a region - closed contours, filled under
 * the non-zero rule, as the wipe engine's regions are - as open paths of
 * anchors, one a run. Empty when the region holds nothing.
 */
export function splatterPaths(region: readonly (readonly Vec[])[], options: SplatterOptions): VectorAnchor[][] {
  const o = sane(options);
  const rad = (o.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Turned so the hatch runs along +x: the hatch's direction on the page,
  // (cos a, -sin a) with y down, goes to (1, 0); `back` undoes it.
  const into = (p: Vec): Vec => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const back = (p: Vec): Vec => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  const rings = region.map((ring) => ring.map(into)).filter((ring) => ring.length >= 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!(maxY > minY)) return [];

  const random = mulberry32(o.seed);
  const vary = (amount: number): number => (random() * 2 - 1) * amount;
  const step = Math.max(o.spacing, (maxY - minY) / SPLATTER_MAX_PASSES);

  // The scanlines, chained into runs as they go.
  const runs: Span[][] = [];
  let open: { run: Span[]; last: Span }[] = [];
  for (let y = minY + step / 2; y < maxY; y += Math.max(step / 4, step + vary(o.spacingVariation))) {
    const spans = spansAt(rings, y);
    const claims = spans.map((span) => open.filter((run) => run.last.a <= span.b && span.a <= run.last.b));
    const claimed = new Map<(typeof open)[number], number>();
    for (const list of claims) for (const run of list) claimed.set(run, (claimed.get(run) ?? 0) + 1);
    const next: typeof open = [];
    spans.forEach((span, k) => {
      const list = claims[k];
      // A span that meets one run, which meets no other span, carries it on;
      // anywhere the region splits or joins, runs end and new ones begin.
      if (list.length === 1 && claimed.get(list[0]) === 1) {
        list[0].run.push(span);
        next.push({ run: list[0].run, last: span });
      } else {
        const run = [span];
        runs.push(run);
        next.push({ run, last: span });
      }
    });
    open = next;
  }

  return runs.map((run) => zigzag(run, o, vary).map((anchor) => turnAnchor(anchor, back)));
}

/** The hatch as one compound open path: every run's anchors, each run after the first starting with a `move`. */
export function splatterAnchors(region: readonly (readonly Vec[])[], options: SplatterOptions): VectorAnchor[] {
  return splatterPaths(region, options).flatMap((run, k) => run.map((anchor, i) => (k > 0 && i === 0 ? { ...anchor, move: true as const } : anchor)));
}

/** Options held to what draws: finite numbers, a spacing and a width above nothing, percents within 0 to 100. */
function sane(options: SplatterOptions): SplatterOptions {
  const num = (v: number, lo: number, hi: number, fallback: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const d = SPLATTER_PRESETS.default;
  return {
    angle: num(options.angle, -360, 360, d.angle),
    overlap: num(options.overlap, -1000, 1000, d.overlap),
    overlapVariation: num(options.overlapVariation, 0, 1000, d.overlapVariation),
    width: num(options.width, 0.01, 1000, d.width),
    curviness: num(options.curviness, 0, 100, d.curviness),
    curvinessVariation: num(options.curvinessVariation, 0, 100, d.curvinessVariation),
    spacing: num(options.spacing, 0.1, 10000, d.spacing),
    spacingVariation: num(options.spacingVariation, 0, 10000, d.spacingVariation),
    seed: Number.isFinite(options.seed) ? Math.trunc(options.seed) : 0,
  };
}

/**
 * The spans of a scanline inside the region, under the non-zero rule: each
 * edge crossing the line counts up or down by its direction, and the region
 * is wherever the count is not zero. An edge takes the line at its lower end
 * and not its upper, so a vertex the line passes through counts once.
 */
function spansAt(rings: readonly Vec[][], y: number): Span[] {
  const crossings: { x: number; w: number }[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (p.y === q.y) continue;
      const up = p.y < q.y;
      const lo = up ? p : q;
      const hi = up ? q : p;
      if (y < lo.y || y >= hi.y) continue;
      crossings.push({ x: lo.x + ((y - lo.y) / (hi.y - lo.y)) * (hi.x - lo.x), w: up ? 1 : -1 });
    }
  }
  crossings.sort((m, n) => m.x - n.x);
  const spans: Span[] = [];
  let winding = 0;
  let start = 0;
  for (const c of crossings) {
    const was = winding;
    winding += c.w;
    if (was === 0 && winding !== 0) start = c.x;
    else if (was !== 0 && winding === 0 && c.x - start > 1e-9) spans.push({ y, a: start, b: c.x });
  }
  return spans;
}

/**
 * One run as a zig-zag, in the turned frame: a fold at the near end of each
 * span, alternately its left and its right, so each pass crosses from one
 * line's edge to the next line's far edge. Each fold is carried past its
 * edge by the overlap, or held short of it - never past its span's middle -
 * and rounded by handles along the turn, which runs down the scanlines.
 */
function zigzag(run: readonly Span[], o: SplatterOptions, vary: (amount: number) => number): VectorAnchor[] {
  const fold = (span: Span, right: boolean): Vec => {
    const mid = (span.a + span.b) / 2;
    const reach = o.overlap + vary(o.overlapVariation);
    const x = right ? Math.max(mid, span.b + reach) : Math.min(mid, span.a - reach);
    return { x, y: span.y };
  };
  // A run one line deep is a single pass along it.
  if (run.length === 1) return [{ p: fold(run[0], false) }, { p: fold(run[0], true) }];
  return run.map((span, k): VectorAnchor => {
    const p = fold(span, k % 2 === 1);
    // An end of the path has no turn to round.
    if (k === 0 || k === run.length - 1) return { p };
    const curviness = Math.min(100, Math.max(0, o.curviness + vary(o.curvinessVariation)));
    // Half the gap to each neighbour, so a turn rounds within its own passes.
    const gap = (Math.abs(span.y - run[k - 1].y) + Math.abs(run[k + 1].y - span.y)) / 2;
    const r = (curviness / 100) * CURL * gap;
    if (r < 1e-3) return { p };
    return { p, hIn: { x: p.x, y: p.y - r }, hOut: { x: p.x, y: p.y + r } };
  });
}

/** An anchor with its handles carried through a turn. */
function turnAnchor(anchor: VectorAnchor, turn: (p: Vec) => Vec): VectorAnchor {
  const out: VectorAnchor = { p: turn(anchor.p) };
  if (anchor.hIn) out.hIn = turn(anchor.hIn);
  if (anchor.hOut) out.hOut = turn(anchor.hOut);
  return out;
}
