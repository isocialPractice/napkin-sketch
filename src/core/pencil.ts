/**
 * The Pencil: a drawing class's kit - graphite by hardness, charcoal
 * pencils, vine and compressed charcoal - and how each lays down on paper.
 * It is modelled on a real pencil rather than on any editor's tool.
 *
 * One table ({@link PENCIL_GRADES}) is read by the canvas and by every
 * export. Each grade has a tone, the darkest it lays down: graphite a cool
 * grey that never reaches black, charcoal a warm matte black. It has a lead,
 * which a softer grade wears broader; a density, the most one pass lays
 * down; and a grain, how much of the paper's tooth a light touch misses. A
 * harder grade is lighter, thinner and crisper, a softer one darker, wider
 * and grainier, and charcoal the grainiest of all, with a powdery edge.
 * Pressure fills more of the tooth, so it darkens far more than it widens.
 *
 * The paper's tooth is a seeded tile of heights anchored to the page
 * ({@link grainTile}). Strokes laid over one another catch the same peaks
 * and miss the same valleys, so passes build tone toward the grade's
 * darkest and never past it, as graphite does. {@link rasterizePencil} is a
 * mark's picture through that tooth: the same pixels on the canvas and in a
 * PNG written with no window.
 *
 * Nothing here touches the DOM.
 */

import { encodePng } from './graphic-design/png.js';
import { rasterizeContours } from './graphic-design/raster.js';
import { profileInputOf, profilePieces } from './stroke-profile.js';
import { widthAtPressure, type Point, type Stroke } from './types.js';
import { passOf, smudgeBox, smudgeBuffer } from './smudge.js';

type Vec = { x: number; y: number };

// ---- The kit ------------------------------------------------------------------------

/** What a pencil is made of. */
export type PencilMedium = 'graphite' | 'charcoal' | 'vine' | 'compressed';

/** A pencil: its medium and its grade - `2B`, `HB`, `4H`, or vine charcoal's `Hard`, `Medium` and `Soft`. */
export interface PencilChoice {
  medium: PencilMedium;
  grade: string;
}

/** One pencil of the kit, and how it lays down. */
export interface PencilGrade extends PencilChoice {
  /** How the kit names it: "Graphite 2B", "Vine charcoal, soft". */
  label: string;
  /** How a script names it: `2B`, `charcoal-2B`, `vine-soft`. */
  name: string;
  /** The darkest it lays down, as `#rrggbb`. */
  tone: string;
  /** The line's width as a share of the tool's: a softer lead wears broader. */
  lead: number;
  /** The most one pass at full pressure lays down, 0 to 1. */
  density: number;
  /** How much of the paper's tooth a light touch misses: 0 lays down solid, 1 catches only the peaks. */
  grain: number;
  /** How soft the edge is between the tooth caught and the tooth missed: crisp for hard graphite, powdery for charcoal. */
  soft: number;
  /** Pressure's curve: below 1, a light touch already lays down much of what the grade can. */
  response: number;
}

/** The medium's name as the kit heads it. */
export const PENCIL_MEDIUM_LABELS: Readonly<Record<PencilMedium, string>> = {
  graphite: 'Graphite',
  charcoal: 'Charcoal pencil',
  vine: 'Vine charcoal',
  compressed: 'Compressed charcoal',
};

/** Graphite's grades, hardest first: 9H to 9B. */
export const GRAPHITE_GRADES = ['9H', '8H', '7H', '6H', '5H', '4H', '3H', '2H', 'H', 'F', 'HB', 'B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B'] as const;

/** Graphite's tones, hardest first: a cool grey from near `#c9ccd1` at 9H through `#6a6d72` at HB to `#2b2c2f` at 8B. */
const GRAPHITE_TONES = [
  '#c9ccd1', '#c1c4c9', '#b8bbc1', '#afb2b8', '#a5a8ae', '#9b9ea4', '#91949a', '#878a90', '#7d8086', '#73767c',
  '#6a6d72', '#5f6267', '#55585c', '#4c4e52', '#434548', '#3b3d40', '#353639', '#303134', '#2b2c2f', '#27282a',
];

function graphite(index: number): PencilGrade {
  const grade = GRAPHITE_GRADES[index];
  const t = index / (GRAPHITE_GRADES.length - 1);
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    medium: 'graphite',
    grade,
    label: `Graphite ${grade}`,
    name: grade,
    tone: GRAPHITE_TONES[index],
    lead: r2(0.55 + 0.9 * t),
    density: r2(0.66 + 0.26 * t),
    grain: r2(0.2 + 0.32 * t),
    soft: r2(0.06 + 0.08 * t),
    response: 0.8,
  };
}

function charcoal(
  medium: Exclude<PencilMedium, 'graphite'>,
  grade: string,
  tone: string,
  paint: Pick<PencilGrade, 'lead' | 'density' | 'grain' | 'soft'>,
): PencilGrade {
  const word = medium === 'vine';
  return {
    medium,
    grade,
    label: word ? `${PENCIL_MEDIUM_LABELS[medium]}, ${grade.toLowerCase()}` : `${PENCIL_MEDIUM_LABELS[medium]} ${grade}`,
    name: `${medium}-${word ? grade.toLowerCase() : grade}`,
    tone,
    response: 0.7,
    ...paint,
  };
}

/**
 * Every pencil there is, each medium hardest first: graphite from 9H to 9B,
 * the charcoal pencils HB to 6B, vine charcoal hard, medium and soft, and
 * compressed charcoal 2B to 6B. A script and the API take any of them; the
 * kit in the app offers {@link PENCIL_KIT}'s.
 */
export const PENCIL_GRADES: readonly PencilGrade[] = [
  ...GRAPHITE_GRADES.map((_, i) => graphite(i)),
  charcoal('charcoal', 'HB', '#4a4441', { lead: 1.15, density: 0.82, grain: 0.66, soft: 0.18 }),
  charcoal('charcoal', '2B', '#3c3734', { lead: 1.25, density: 0.86, grain: 0.7, soft: 0.2 }),
  charcoal('charcoal', '4B', '#302c2a', { lead: 1.35, density: 0.89, grain: 0.74, soft: 0.22 }),
  charcoal('charcoal', '6B', '#252220', { lead: 1.5, density: 0.92, grain: 0.78, soft: 0.24 }),
  charcoal('vine', 'Hard', '#6e6762', { lead: 1.8, density: 0.62, grain: 0.82, soft: 0.28 }),
  charcoal('vine', 'Medium', '#5a5450', { lead: 2.1, density: 0.68, grain: 0.85, soft: 0.3 }),
  charcoal('vine', 'Soft', '#48433f', { lead: 2.4, density: 0.74, grain: 0.88, soft: 0.32 }),
  charcoal('compressed', '2B', '#2a2522', { lead: 1.9, density: 0.92, grain: 0.68, soft: 0.2 }),
  charcoal('compressed', '4B', '#1f1c1a', { lead: 2.2, density: 0.94, grain: 0.71, soft: 0.22 }),
  charcoal('compressed', '6B', '#171513', { lead: 2.5, density: 0.96, grain: 0.74, soft: 0.24 }),
];

/** The pencil a new Pencil holds: graphite HB. */
export const DEFAULT_PENCIL: Readonly<PencilChoice> = { medium: 'graphite', grade: 'HB' };

/** The kit the app's Pencil offers, a medium a row: what a collegiate drawing class's supply list asks for. */
export const PENCIL_KIT: ReadonlyArray<{ medium: PencilMedium; label: string; grades: readonly string[] }> = [
  { medium: 'graphite', label: PENCIL_MEDIUM_LABELS.graphite, grades: ['4H', '2H', 'HB', '2B', '4B', '6B', '8B'] },
  { medium: 'charcoal', label: PENCIL_MEDIUM_LABELS.charcoal, grades: ['HB', '2B', '4B', '6B'] },
  { medium: 'vine', label: PENCIL_MEDIUM_LABELS.vine, grades: ['Hard', 'Medium', 'Soft'] },
  { medium: 'compressed', label: PENCIL_MEDIUM_LABELS.compressed, grades: ['2B', '4B', '6B'] },
];

const BY_KEY = new Map(PENCIL_GRADES.map((g) => [`${g.medium}:${g.grade.toUpperCase()}`, g]));
const BY_NAME = new Map(PENCIL_GRADES.map((g) => [g.name.toUpperCase(), g]));

/** The pencil a choice names, or null when it names none. */
export function pencilGrade(choice: PencilChoice | null | undefined): PencilGrade | null {
  if (!choice || typeof choice.medium !== 'string' || typeof choice.grade !== 'string') return null;
  return BY_KEY.get(`${choice.medium}:${choice.grade.toUpperCase()}`) ?? null;
}

/**
 * The pencil a name means, as a script writes one: a graphite grade alone
 * (`2B`, `hb`), or the medium before it (`graphite-2B`, `charcoal-4B`,
 * `vine-soft`, `compressed-6B`) - a space for the hyphen as well - in any
 * case. Null for anything else.
 */
export function parsePencil(name: string): PencilChoice | null {
  const key = name.trim().toUpperCase().replace(/\s+/g, '-');
  const found = BY_NAME.get(key) ?? BY_NAME.get(key.replace(/^GRAPHITE-/, ''));
  return found ? { medium: found.medium, grade: found.grade } : null;
}

/** The pencil a choice names, or the default one - graphite HB - for one that names none: what paints a mark. */
export function pencilPaint(choice?: PencilChoice | string | null): PencilGrade {
  const named = typeof choice === 'string' ? parsePencil(choice) : choice;
  return pencilGrade(named) ?? pencilGrade(DEFAULT_PENCIL)!;
}

/** Whether two choices are the same pencil. */
export function samePencil(a: PencilChoice | null | undefined, b: PencilChoice | null | undefined): boolean {
  const x = pencilGrade(a);
  return x !== null && x === pencilGrade(b);
}

/** A pencil line's width for a tool width: the lead's share of it, to a hundredth. */
export function pencilWidth(toolWidth: number, choice?: PencilChoice | null): number {
  return Math.max(0.25, Math.round(toolWidth * pencilPaint(choice).lead * 100) / 100);
}

// ---- How it lays down -----------------------------------------------------------------

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * The coverage rule: how much of a point of paper one pass lays down, 0 to
 * 1, where the tooth there stands `tooth` high (0 a valley, 1 a peak) and
 * the lead is pressed at `pressure`. A light touch reaches only the peaks; a
 * firm one reaches down into the valleys as well and lays down more where it
 * does - so pressure darkens far more than it widens. No pass lays down more
 * than the grade's density, and the tone it lays down never passes the
 * grade's, however many passes there are.
 */
export function pencilCoverage(paint: PencilGrade, tooth: number, pressure: number): number {
  const press = Math.pow(clamp01(pressure), paint.response);
  // The tooth heights the lead reaches down to: everything above this edge catches.
  const edge = paint.grain * (1 - press);
  const caught = smoothstep(edge - paint.soft, edge + paint.soft, tooth);
  return paint.density * (0.6 + 0.4 * press) * caught;
}

/**
 * What one pass lays down on average at `pressure`, over the whole of the
 * paper's tooth: the grade's mean tone, which PDF and Illustrator draw with,
 * having no grain paint.
 */
export function pencilMeanCoverage(paint: PencilGrade, pressure: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += pencilCoverage(paint, (i + 0.5) / 256, pressure);
  return sum / 256;
}

/** A mark's mean pressure: 0.5, a mouse's, when its points carry none. */
export function meanPressure(points: readonly Point[]): number {
  if (points.length === 0) return 0.5;
  let sum = 0;
  for (const p of points) sum += p.pressure ?? 0.5;
  return sum / points.length;
}

// ---- The paper's tooth -----------------------------------------------------------------

/** The tooth tile's side, in texels. It repeats across the page. */
export const GRAIN_TILE_SIZE = 128;

/** Texels of the tooth per page pixel: the tile repeats every 85 page pixels or so. */
export const GRAIN_TEXELS_PER_PX = 1.5;

/** The seed the paper's tooth grows from. */
export const PAPER_SEED = 0x9e3779b9;

/** The tooth's octaves: each a period in texels and its share of the height. Fine bumps on a faint mottle. */
const OCTAVES: ReadonlyArray<readonly [number, number]> = [
  [16, 0.05],
  [8, 0.13],
  [4, 0.32],
  [2, 0.5],
];

/** A small, fast, seeded generator (mulberry32): the same numbers from the same seed everywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let paperTile: Uint8Array | null = null;

/**
 * The paper's tooth: {@link GRAIN_TILE_SIZE} squared heights, 0 a valley
 * and 255 a peak, row by row, that wrap at every edge so the tile repeats
 * without a seam. Value noise in five octaves, then equalized - every height
 * as common as every other - so a share of the heights is the same share of
 * the tooth, which the coverage rule leans on. The same seed gives the same
 * bytes everywhere.
 */
export function grainTile(seed: number = PAPER_SEED): Uint8Array {
  if (seed === PAPER_SEED && paperTile) return paperTile;
  const n = GRAIN_TILE_SIZE;
  const random = mulberry32(seed);
  const heights = new Float64Array(n * n);
  const ease = (t: number): number => t * t * (3 - 2 * t);
  for (const [period, share] of OCTAVES) {
    const cells = n / period;
    const lattice = new Float64Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    for (let y = 0; y < n; y++) {
      const y0 = Math.floor(y / period);
      const fy = ease(y / period - y0);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < n; x++) {
        const x0 = Math.floor(x / period);
        const fx = ease(x / period - x0);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const top = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * fx;
        const bottom = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * fx;
        heights[y * n + x] += share * (top + (bottom - top) * fy);
      }
    }
  }
  const order = Array.from({ length: n * n }, (_, i) => i).sort((a, b) => heights[a] - heights[b] || a - b);
  const tile = new Uint8Array(n * n);
  for (let rank = 0; rank < order.length; rank++) tile[order[rank]] = Math.round((rank / (order.length - 1)) * 255);
  if (seed === PAPER_SEED) paperTile = tile;
  return tile;
}

/** The tooth's height at a page point, 0 to 1, read between texels. */
export function toothAt(tile: Uint8Array, x: number, y: number): number {
  const n = GRAIN_TILE_SIZE;
  const u = x * GRAIN_TEXELS_PER_PX - 0.5;
  const v = y * GRAIN_TEXELS_PER_PX - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const c0 = ((x0 % n) + n) % n;
  const c1 = (c0 + 1) % n;
  const r0 = (((y0 % n) + n) % n) * n;
  const r1 = ((((y0 + 1) % n) + n) % n) * n;
  const top = tile[r0 + c0] + (tile[r0 + c1] - tile[r0 + c0]) * fx;
  const bottom = tile[r1 + c0] + (tile[r1 + c1] - tile[r1 + c0]) * fx;
  return (top + (bottom - top) * fy) / 255;
}

let paperPng: Uint8Array | null = null;

/** The paper's tooth as a greyscale PNG - a peak white, a valley black - which the SVG export carries once a file. */
export function grainTilePng(): Uint8Array {
  if (paperPng) return paperPng;
  const tile = grainTile();
  const rgba = new Uint8Array(tile.length * 4);
  for (let i = 0; i < tile.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = tile[i];
    rgba[i * 4 + 3] = 255;
  }
  paperPng = encodePng(rgba, GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  return paperPng;
}

// ---- A mark's picture -------------------------------------------------------------------

/**
 * A box of device pixels on the page's own grid - device = page × `scale`,
 * so the grid moves with the page and not with the view - at whole pixels.
 */
export interface PencilRegion {
  /** Device pixels per page pixel. */
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box a mark covers at `scale`, with a pixel to spare; null for a mark with no points. */
export function pencilRegion(stroke: Stroke, scale: number): PencilRegion | null {
  const pts = stroke.points;
  if (pts.length === 0 || !(scale > 0)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const half = stroke.width / 2;
  minX -= half;
  minY -= half;
  maxX += half;
  maxY += half;
  // A smeared mark takes in where the stump carried its graphite.
  for (const smudge of stroke.smudges ?? []) {
    const box = smudgeBox(smudge);
    if (!box) continue;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  const x = Math.floor(minX * scale) - 1;
  const y = Math.floor(minY * scale) - 1;
  return {
    scale,
    x,
    y,
    width: Math.ceil(maxX * scale) + 1 - x,
    height: Math.ceil(maxY * scale) + 1 - y,
  };
}

/** Coverage of `poly`, a polygon in the region's own pixels, over its own small box, added into `num` and `den` with `pressure`. */
function splat(poly: Vec[], pressure: number, width: number, height: number, num: Float32Array, den: Float32Array): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(width, Math.ceil(maxX) + 1);
  const y1 = Math.min(height, Math.ceil(maxY) + 1);
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0;
  const h = y1 - y0;
  const cover = rasterizeContours([poly.map((p) => ({ x: p.x - x0, y: p.y - y0 }))], w, h, 'nonzero');
  for (let row = 0; row < h; row++) {
    const out = (y0 + row) * width + x0;
    for (let col = 0; col < w; col++) {
      const c = cover[row * w + col];
      if (c <= 0) continue;
      num[out + col] += c * pressure;
      den[out + col] += c;
    }
  }
}

/** A circle as a polygon of `sides`. */
function ring(c: Vec, r: number, sides: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/** `#rgb` or `#rrggbb` as its three channels; null for anything else. */
function rgbOf(color: string | undefined): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim() ?? '');
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/**
 * A pencil mark's picture over `region`: straight RGBA, the mark's color -
 * its grade's tone, unless it was recolored - with the alpha it lays down.
 *
 * The outline is the one the canvas fills for any line (`profilePieces`, at
 * each point's width), its coverage worked out exactly under one non-zero
 * fill, so a translucent pass lays down flat with no beads where its pieces
 * meet. Under it, each pixel's pressure is that of the line nearest it, and
 * the coverage rule lays down what that pressure does on the tooth there.
 * The mark's opacity is not in it: whoever draws the picture applies that.
 *
 * Only what reaches the region is worked out, so a region of the mark - the
 * part in view, or the end a live stroke just grew - costs only its pixels.
 */
export function rasterizePencil(stroke: Stroke, region: PencilRegion, tile: Uint8Array = grainTile()): Uint8ClampedArray<ArrayBuffer> {
  const { scale, x: ox, y: oy, width, height } = region;
  const out = new Uint8ClampedArray(Math.max(0, width * height * 4));
  const pts = stroke.points;
  if (width <= 0 || height <= 0 || pts.length === 0) return out;
  const paint = pencilPaint(stroke.pencil);
  const [r, g, b] = rgbOf(stroke.color) ?? rgbOf(paint.tone)!;
  const local = (p: Vec): Vec => ({ x: p.x * scale - ox, y: p.y * scale - oy });

  // The outline, as the canvas fills it.
  const pieces: Vec[][] = [];
  for (const piece of profilePieces(profileInputOf(stroke))) {
    const moved = piece.map(local);
    let inside = false;
    for (const p of moved) {
      if (p.x > -2 && p.y > -2 && p.x < width + 2 && p.y < height + 2) {
        inside = true;
        break;
      }
    }
    // A big piece can cross the region with every corner outside it.
    if (!inside) {
      const xs = moved.map((p) => p.x);
      const ys = moved.map((p) => p.y);
      inside = Math.max(...xs) >= 0 && Math.min(...xs) <= width && Math.max(...ys) >= 0 && Math.min(...ys) <= height;
    }
    if (inside) pieces.push(moved);
  }
  if (pieces.length === 0) return out;
  const cover = rasterizeContours(pieces, width, height, 'nonzero');

  // The pressure under each pixel: the lines' pressures, weighted by how
  // much of the pixel each covers - a disc at each point and a band along
  // each segment, a little wider than the line so its soft edge has one too.
  const num = new Float32Array(width * height);
  const den = new Float32Array(width * height);
  const pressureOf = (p: Point): number => clamp01(p.pressure ?? 0.5);
  const halfOf = (p: Point): number => (stroke.width * widthAtPressure('pencil', pressureOf(p)) * scale) / 2 + 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = local(p);
    const ra = halfOf(p);
    if (a.x + ra < 0 || a.y + ra < 0 || a.x - ra > width || a.y - ra > height) {
      // Its disc misses the region, though its band may not.
    } else {
      splat(ring(a, ra, 12), pressureOf(p), width, height, num, den);
    }
    const q = pts[i + 1];
    if (!q || q.move) continue;
    const bq = local(q);
    const rb = halfOf(q);
    if (Math.max(a.x + ra, bq.x + rb) < 0 || Math.max(a.y + ra, bq.y + rb) < 0 || Math.min(a.x - ra, bq.x - rb) > width || Math.min(a.y - ra, bq.y - rb) > height) continue;
    const dx = bq.x - a.x;
    const dy = bq.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len;
    const ny = dx / len;
    splat(
      [
        { x: a.x + nx * ra, y: a.y + ny * ra },
        { x: bq.x + nx * rb, y: bq.y + ny * rb },
        { x: bq.x - nx * rb, y: bq.y - ny * rb },
        { x: a.x - nx * ra, y: a.y - ny * ra },
      ],
      (pressureOf(p) + pressureOf(q)) / 2,
      width,
      height,
      num,
      den,
    );
  }
  const fallback = meanPressure(pts);

  // The rule, as a table: 65 pressures by 256 tooth heights.
  const table = new Float32Array(65 * 256);
  for (let pi = 0; pi <= 64; pi++) {
    for (let h = 0; h < 256; h++) table[pi * 256 + h] = pencilCoverage(paint, (h + 0.5) / 256, pi / 64);
  }
  // Zoomed out, a device pixel spans several of the tooth's texels: they are
  // all read, as the eye would average them.
  const steps = scale < 1 ? Math.min(3, Math.ceil(1 / scale)) : 1;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const c = cover[i];
      if (c <= 0) continue;
      const pressure = den[i] > 1e-6 ? num[i] / den[i] : fallback;
      const pi = Math.round(clamp01(pressure) * 64) * 256;
      let lays = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const px = (ox + col + (sx + 0.5) / steps) / scale;
          const py = (oy + row + (sy + 0.5) / steps) / scale;
          lays += table[pi + Math.min(255, Math.floor(toothAt(tile, px, py) * 256))];
        }
      }
      const alpha = Math.min(1, c) * (lays / (steps * steps));
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/**
 * A Pencil mark's whole picture: {@link rasterizePencil}, then each of the
 * Smear's passes over it in order (`core/smudge.ts`). A smear carries
 * graphite from anywhere in the mark, so a smeared mark is worked out over
 * the whole of `region`, which should be {@link pencilRegion}'s.
 */
export function pencilPicture(stroke: Stroke, region: PencilRegion, tile: Uint8Array = grainTile()): Uint8ClampedArray<ArrayBuffer> {
  const data = rasterizePencil(stroke, region, tile);
  if (!stroke.smudges || stroke.smudges.length === 0) return data;
  const rgb = rgbOf(stroke.color) ?? rgbOf(pencilPaint(stroke.pencil).tone)!;
  let state = null;
  for (const smudge of stroke.smudges) {
    state = smudgeBuffer(data, region, passOf(smudge), rgb, state ? { ...state, carried: null, next: 0, segment: 0, start: 0, last: null } : null);
  }
  return data;
}

/** The color a Pencil mark lays down: its own, or its grade's tone. */
export function pencilRgb(stroke: Stroke): [number, number, number] {
  return rgbOf(stroke.color) ?? rgbOf(pencilPaint(stroke.pencil).tone)!;
}

/** Base64 of bytes, with no `btoa`. */
function base64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63];
    out += i + 1 < bytes.length ? table[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? table[n & 63] : '=';
  }
  return out;
}

/** PNG bytes as a data URL. */
export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${base64(png)}`;
}
