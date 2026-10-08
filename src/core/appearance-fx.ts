/**
 * The effects on pixels: the passes the canvas and the rasterizer run over a
 * picture before laying it down, one for each effect in a list, in order.
 *
 * Each pass is the SVG filter graph core/effects.ts writes for the effect, run
 * by hand: a Gaussian blur, a component transfer, an offset, a flood, a
 * composite, a blend, diffuse lighting. So a mark's appearance on the canvas,
 * in a PNG and in an SVG viewer is one picture, worked out three ways.
 *
 * The picture is premultiplied RGBA in 0 to 1, which is where a blur is
 * exact. A color effect is a matrix over straight color, as SVG's
 * `feColorMatrix` is, so each pixel has its alpha taken out, the matrix
 * applied and clamped, and its alpha put back. A blur is the one the Filter
 * Effects specification describes: a true Gaussian below a standard deviation
 * of 2 pixels, and above it three box blurs, which is what SVG viewers draw
 * too. A matte - a shadow's, a glow's, a bevel's height - is one channel, the
 * alpha it stands for.
 *
 * Only the ink, and as far as the effects reach from it, is worked on, so a
 * small mark on a large page costs little. Nothing here reads the DOM.
 */

import { blendColor, type BlendModeId, type Rgb } from './blend.js';
import {
  colorMatrix,
  effectLayout,
  effectReach,
  matteSlope,
  reliefHeight,
  reliefLight,
  reliefMasks,
  reliefSurfaceScale,
  shadowColor,
  type Effect,
  type EffectOf,
  type ReliefEffect,
} from './effects.js';
import { meanScale, type Matrix } from './graphic-design/geometry.js';

/** A premultiplied RGBA picture: four floats a pixel, row by row, in 0 to 1. */
export interface FxImage {
  readonly pixels: Float32Array;
  readonly width: number;
  readonly height: number;
}

/** A box of pixels, its right and bottom edges exclusive. */
export interface FxBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A layer an effect list lays under its picture on its own (core/effects.ts's effectLayout): a picture, where it goes, and its blend. */
export interface FxUnder {
  image: FxImage;
  /** Where its top-left pixel lands on the picture it came from. */
  x: number;
  y: number;
  blend: BlendModeId;
}

/** Reports something the passes left out, such as a color no output can paint. */
export type FxWarn = (message: string) => void;

// ---- Canvas pixels ----------------------------------------------------------------------

/** A canvas's straight 8-bit RGBA, as `getImageData` gives it, as a premultiplied picture. */
export function fromRgba8(data: Uint8ClampedArray, width: number, height: number): FxImage {
  const pixels = new Float32Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a <= 0) continue;
    pixels[i] = (data[i] / 255) * a;
    pixels[i + 1] = (data[i + 1] / 255) * a;
    pixels[i + 2] = (data[i + 2] / 255) * a;
    pixels[i + 3] = a;
  }
  return { pixels, width, height };
}

/** A premultiplied picture as straight 8-bit RGBA, as `putImageData` takes it. */
export function toRgba8(
  img: FxImage,
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(img.width * img.height * 4),
): Uint8ClampedArray<ArrayBuffer> {
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3];
    if (a <= 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    out[i] = Math.round((p[i] / a) * 255);
    out[i + 1] = Math.round((p[i + 1] / a) * 255);
    out[i + 2] = Math.round((p[i + 2] / a) * 255);
    out[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  return out;
}

// ---- Blurs ------------------------------------------------------------------------------

/** One box blur along a line: each value the mean of the window `lo` before it to `hi` after, zero past the ends. */
function boxLine(src: Float32Array, dst: Float32Array, n: number, lo: number, hi: number): void {
  const size = lo + hi + 1;
  let sum = 0;
  for (let k = 0; k <= hi && k < n; k++) sum += src[k];
  for (let x = 0; x < n; x++) {
    dst[x] = sum / size;
    const out = x - lo;
    if (out >= 0) sum -= src[out];
    const next = x + hi + 1;
    if (next < n) sum += src[next];
  }
}

/** A Gaussian along a line, by a kernel of three standard deviations each way, zero past the ends. */
function gaussianLine(src: Float32Array, dst: Float32Array, n: number, kernel: Float32Array): void {
  const r = kernel.length - 1;
  for (let x = 0; x < n; x++) {
    let sum = src[x] * kernel[0];
    for (let k = 1; k <= r; k++) {
      if (x - k >= 0) sum += src[x - k] * kernel[k];
      if (x + k < n) sum += src[x + k] * kernel[k];
    }
    dst[x] = sum;
  }
}

/**
 * Blurs a line in place with standard deviation `sigma`, as the Filter Effects
 * specification says `feGaussianBlur` may: a true Gaussian below 2, and above
 * it three box blurs of width `d`, the last one wider by a pixel when `d` is
 * even and the first two offset half a pixel either way.
 */
function blurLine(line: Float32Array, scratch: Float32Array, n: number, sigma: number, kernel: Float32Array | null): void {
  if (kernel) {
    gaussianLine(line, scratch, n, kernel);
    line.set(scratch.subarray(0, n));
    return;
  }
  const d = Math.floor((sigma * 3 * Math.sqrt(2 * Math.PI)) / 4 + 0.5);
  if (d <= 1) return;
  if (d % 2 === 1) {
    const h = (d - 1) / 2;
    boxLine(line, scratch, n, h, h);
    boxLine(scratch, line, n, h, h);
    boxLine(line, scratch, n, h, h);
  } else {
    const h = d / 2;
    boxLine(line, scratch, n, h, h - 1);
    boxLine(scratch, line, n, h - 1, h);
    boxLine(line, scratch, n, h, h);
  }
  line.set(scratch.subarray(0, n));
}

/** The weights of a Gaussian of standard deviation `sigma`, from the middle out, adding to 1 both ways. */
function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(r + 1);
  let total = 0;
  for (let k = 0; k <= r; k++) {
    kernel[k] = Math.exp(-(k * k) / (2 * sigma * sigma));
    total += k === 0 ? kernel[k] : 2 * kernel[k];
  }
  for (let k = 0; k <= r; k++) kernel[k] /= total;
  return kernel;
}

/**
 * Blurs `channels` interleaved channels of a picture inside a box, rows and
 * then columns. What lies outside the box is left alone, and reads as clear.
 */
export function blurPixels(pixels: Float32Array, width: number, channels: number, box: FxBox, sigma: number): void {
  if (!(sigma > 0)) return;
  const kernel = sigma < 2 ? gaussianKernel(sigma) : null;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w <= 0 || h <= 0) return;
  const line = new Float32Array(Math.max(w, h));
  const scratch = new Float32Array(Math.max(w, h));
  for (let c = 0; c < channels; c++) {
    for (let y = box.y0; y < box.y1; y++) {
      const row = y * width;
      for (let x = 0; x < w; x++) line[x] = pixels[(row + box.x0 + x) * channels + c];
      blurLine(line, scratch, w, sigma, kernel);
      for (let x = 0; x < w; x++) pixels[(row + box.x0 + x) * channels + c] = line[x];
    }
    for (let x = box.x0; x < box.x1; x++) {
      for (let y = 0; y < h; y++) line[y] = pixels[((box.y0 + y) * width + x) * channels + c];
      blurLine(line, scratch, h, sigma, kernel);
      for (let y = 0; y < h; y++) pixels[((box.y0 + y) * width + x) * channels + c] = line[y];
    }
  }
}

// ---- Mattes and layers ------------------------------------------------------------------

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** A picture's alpha, as a matte: what `SourceAlpha` gives a filter. */
function alphaOf(img: FxImage): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = img.pixels[i * 4 + 3];
  return out;
}

/** A matte blurred in place, as `feGaussianBlur` blurs an alpha. */
function blurMatte(matte: Float32Array, width: number, height: number, sigma: number): void {
  blurPixels(matte, width, 1, { x0: 0, y0: 0, x1: width, y1: height }, sigma);
}

/** A matte put through a straight line in place, held to 0 to 1, as `feFuncA type="linear"` does. */
function levels(matte: Float32Array, slope: number, intercept: number): void {
  if (slope === 1 && intercept === 0) return;
  for (let i = 0; i < matte.length; i++) matte[i] = clamp01(slope * matte[i] + intercept);
}

/** A matte put through a table in place, as `feFuncA type="table"` does: straight lines between the table's values. */
function table(matte: Float32Array, values: readonly number[]): void {
  const n = values.length - 1;
  for (let i = 0; i < matte.length; i++) {
    const v = clamp01(matte[i]);
    const k = Math.min(n - 1, Math.floor(v * n));
    matte[i] = values[k] + (v * n - k) * (values[k + 1] - values[k]);
  }
}

/** A matte moved by (`ox`, `oy`) pixels, read between pixels where the move is not whole, clear where it came from outside. */
function offsetMatte(matte: Float32Array, width: number, height: number, ox: number, oy: number): Float32Array {
  if (ox === 0 && oy === 0) return matte;
  const out = new Float32Array(matte.length);
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < width && y < height ? matte[y * width + x] : 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - ox;
      const sy = y - oy;
      const fx = Math.floor(sx);
      const fy = Math.floor(sy);
      const tx = sx - fx;
      const ty = sy - fy;
      out[y * width + x] =
        (at(fx, fy) * (1 - tx) + at(fx + 1, fy) * tx) * (1 - ty) + (at(fx, fy + 1) * (1 - tx) + at(fx + 1, fy + 1) * tx) * ty;
    }
  }
  return out;
}

/** A color in 0 to 1, and its alpha times `opacity`: null, said once, for a color no output can paint. */
function readFlood(color: string, opacity: number, what: string, warn: FxWarn): { rgb: Rgb; alpha: number } | null {
  const rgba = shadowColor(color);
  if (!rgba) {
    warn(`a ${what} color, "${color}", is not one it can paint, so the ${what} was left out`);
    return null;
  }
  return { rgb: [rgba.r / 255, rgba.g / 255, rgba.b / 255], alpha: rgba.a * opacity };
}

/** A flood kept where a matte is: a premultiplied picture of the color at the matte's alpha. */
function coloredLayer(matte: Float32Array, width: number, height: number, flood: { rgb: Rgb; alpha: number }): FxImage {
  const pixels = new Float32Array(matte.length * 4);
  const [r, g, b] = flood.rgb;
  for (let i = 0; i < matte.length; i++) {
    const a = matte[i] * flood.alpha;
    if (a <= 0) continue;
    pixels[i * 4] = r * a;
    pixels[i * 4 + 1] = g * a;
    pixels[i * 4 + 2] = b * a;
    pixels[i * 4 + 3] = a;
  }
  return { pixels, width, height };
}

/** Scales a picture in place by a matte - `feComposite operator="in"` - or by the matte's inverse - `operator="out"`. */
function keep(img: FxImage, matte: Float32Array, out = false): void {
  const p = img.pixels;
  for (let i = 0; i < matte.length; i++) {
    const k = out ? 1 - matte[i] : matte[i];
    if (k === 1) continue;
    p[i * 4] *= k;
    p[i * 4 + 1] *= k;
    p[i * 4 + 2] *= k;
    p[i * 4 + 3] *= k;
  }
}

/** Lays `layer` under `img`, in place: what `feMerge` does with the layer first. */
function laidUnder(img: FxImage, layer: FxImage): void {
  const p = img.pixels;
  const l = layer.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const a = l[i + 3];
    if (a <= 0) continue;
    const under = 1 - p[i + 3];
    p[i] += l[i] * under;
    p[i + 1] += l[i + 1] * under;
    p[i + 2] += l[i + 2] * under;
    p[i + 3] += a * under;
  }
}

/** A clear picture. */
export function blankImage(width: number, height: number): FxImage {
  return { pixels: new Float32Array(width * height * 4), width, height };
}

/**
 * Lays `top` over `base`, in place, with its top-left pixel at (`left`,
 * `upper`), mixed by a blend, as `feBlend` does: the Compositing
 * specification's source-over with the blend's color where both are there,
 * the backdrop where only it is, the source where only it is. What falls
 * outside `base` is left out.
 */
export function layOnto(base: FxImage, top: FxImage, left: number, upper: number, mode: BlendModeId): void {
  const p = base.pixels;
  const t = top.pixels;
  const cb: Rgb = [0, 0, 0];
  const cs: Rgb = [0, 0, 0];
  const mixed: Rgb = [0, 0, 0];
  for (let y = Math.max(0, -upper); y < top.height && y + upper < base.height; y++) {
    for (let x = Math.max(0, -left); x < top.width && x + left < base.width; x++) {
      const s = (y * top.width + x) * 4;
      const as = t[s + 3];
      if (as <= 0) continue;
      const i = ((y + upper) * base.width + x + left) * 4;
      const ab = p[i + 3];
      if (mode === 'normal' || ab <= 0) {
        const under = 1 - as;
        p[i] = t[s] + p[i] * under;
        p[i + 1] = t[s + 1] + p[i + 1] * under;
        p[i + 2] = t[s + 2] + p[i + 2] * under;
        p[i + 3] = as + ab * under;
        continue;
      }
      cs[0] = t[s] / as;
      cs[1] = t[s + 1] / as;
      cs[2] = t[s + 2] / as;
      cb[0] = p[i] / ab;
      cb[1] = p[i + 1] / ab;
      cb[2] = p[i + 2] / ab;
      blendColor(mode, cb, cs, mixed);
      for (let c = 0; c < 3; c++) p[i + c] = t[s + c] * (1 - ab) + p[i + c] * (1 - as) + as * ab * mixed[c];
      p[i + 3] = as + ab - as * ab;
    }
  }
}

/** Lays a picture of the same size over another, in place, mixed by a blend. */
function blendedOver(img: FxImage, top: FxImage, mode: BlendModeId): void {
  layOnto(img, top, 0, 0, mode);
}

/**
 * `feDiffuseLighting` with a distant light, white, its diffuse constant 1: the
 * gray each pixel of a height matte turns under the light, N.L held to 0 to 1.
 * The surface normal is the specification's Sobel estimate from the height
 * times `surfaceScale`; the light comes from `azimuth` (clockwise from the x
 * axis, which runs down the page) at `elevation`, both in degrees. The edge
 * pixels read their own row or column again for the one past the edge, which
 * on a matte that is flat there gives what the specification's edge kernels
 * give.
 */
function diffuseLight(height: Float32Array, width: number, rows: number, surfaceScale: number, azimuth: number, elevation: number): Float32Array {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const lx = Math.cos(az) * Math.cos(el);
  const ly = Math.sin(az) * Math.cos(el);
  const lz = Math.sin(el);
  const out = new Float32Array(height.length);
  const at = (x: number, y: number): number =>
    height[Math.min(rows - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const k = surfaceScale / 4;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const nx =
        -k * (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1)));
      const ny =
        -k * (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1)));
      const length = Math.hypot(nx, ny, 1);
      out[y * width + x] = clamp01((nx * lx + ny * ly + lz) / length);
    }
  }
  return out;
}

// ---- The passes -------------------------------------------------------------------------

/** How the transform an effect is drawn under maps its lengths: one scale for blurs, the linear part for offsets and turns. */
interface FxSpace {
  scale: number;
  matrix: Matrix;
}

/** A shadow's offset as the transform carries it: its scale and its turn. */
function moved(space: FxSpace, dx: number, dy: number): [number, number] {
  const m = space.matrix;
  return [m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy];
}

/** A color matrix over straight color: alpha out, the matrix, clamped, alpha back in. */
function colorPass(img: FxImage, m: readonly number[]): void {
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3];
    if (a <= 0) continue;
    const r = p[i] / a;
    const g = p[i + 1] / a;
    const b = p[i + 2] / a;
    const a2 = clamp01(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]);
    p[i] = clamp01(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]) * a2;
    p[i + 1] = clamp01(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]) * a2;
    p[i + 2] = clamp01(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]) * a2;
    p[i + 3] = a2;
  }
}

/**
 * An Outer Shadow's or an Outer Glow's colored matte, cast from the
 * picture's alpha: blurred, firmed by its spread, moved by its offset - which
 * the transform carries, as it carries the picture - in its color at its
 * opacity. Null when its color is not one.
 */
export function outerLayer(
  img: FxImage,
  effect: EffectOf<'drop-shadow'> | EffectOf<'outer-glow'>,
  space: FxSpace,
  warn: FxWarn,
): FxImage | null {
  const what = effect.type === 'drop-shadow' ? 'drop-shadow' : 'glow';
  const flood = readFlood(effect.color, effect.opacity ?? 1, what, warn);
  if (!flood) return null;
  const { width, height } = img;
  let matte = alphaOf(img);
  blurMatte(matte, width, height, (effect.blur / 2) * space.scale);
  levels(matte, matteSlope(effect.spread ?? 0), 0);
  if (effect.type === 'drop-shadow') {
    const [ox, oy] = moved(space, effect.dx, effect.dy);
    matte = offsetMatte(matte, width, height, ox, oy);
  }
  return coloredLayer(matte, width, height, flood);
}

/** An Inner Shadow or an Inner Glow, mixed over the picture by its blend and kept inside it. */
function innerPass(img: FxImage, effect: EffectOf<'inner-shadow'> | EffectOf<'inner-glow'>, space: FxSpace, warn: FxWarn): void {
  const flood = readFlood(effect.color, effect.opacity, effect.type === 'inner-shadow' ? 'shadow' : 'glow', warn);
  if (!flood) return;
  const { width, height } = img;
  const alpha = alphaOf(img);
  let matte: Float32Array = alpha.slice();
  if (!(effect.type === 'inner-glow' && effect.source === 'center')) {
    for (let i = 0; i < matte.length; i++) matte[i] = 1 - matte[i];
  }
  blurMatte(matte, width, height, (effect.blur / 2) * space.scale);
  levels(matte, matteSlope(effect.choke), 0);
  if (effect.type === 'inner-shadow') {
    const [ox, oy] = moved(space, effect.dx, effect.dy);
    matte = offsetMatte(matte, width, height, ox, oy);
  }
  const layer = coloredLayer(matte, width, height, flood);
  keep(layer, alpha);
  blendedOver(img, layer, effect.blend);
}

/** Feather: the picture faded from clear at its edge to solid `radius` inside it. */
function featherPass(img: FxImage, radius: number, space: FxSpace): void {
  if (!(radius > 0)) return;
  const matte = alphaOf(img);
  blurMatte(matte, img.width, img.height, (radius / 2) * space.scale);
  levels(matte, 2, -1);
  keep(img, matte);
}

/**
 * Bevel and Emboss: a height drawn from the picture's alpha, lit by a distant
 * light, its brighter-than-flat parts the light and its darker parts the
 * shade, each in its color, mixed over the picture by its blend - kept inside
 * the shape for an inner bevel, outside it for an outer one. The light turns
 * with the transform, as the filter's user space turns with its element.
 */
function reliefPass(img: FxImage, effect: ReliefEffect, space: FxSpace, warn: FxWarn): void {
  if (!(effect.size > 0)) return;
  const { width, height } = img;
  const alpha = alphaOf(img);
  const shape = reliefHeight(effect);
  const bump = alpha.slice();
  blurMatte(bump, width, height, shape.sigma * space.scale);
  if (shape.table) table(bump, shape.table);
  else levels(bump, shape.slope ?? 1, shape.intercept ?? 0);
  const light = reliefLight(effect);
  // The azimuth is in the effect's own space: the transform carries its direction.
  const az = (light.azimuth * Math.PI) / 180;
  const m = space.matrix;
  const azimuth = (Math.atan2(m[1] * Math.cos(az) + m[3] * Math.sin(az), m[0] * Math.cos(az) + m[2] * Math.sin(az)) * 180) / Math.PI;
  const lit = diffuseLight(bump, width, height, reliefSurfaceScale(effect) * space.scale, azimuth, light.elevation);
  const masks = reliefMasks(light.elevation);
  for (const [shade, mask, what] of [
    [effect.shadow, masks.shadow, 'shade'],
    [effect.highlight, masks.highlight, 'highlight'],
  ] as const) {
    if (shade.opacity <= 0) continue;
    const flood = readFlood(shade.color, shade.opacity, what, warn);
    if (!flood) continue;
    const matte = new Float32Array(lit.length);
    for (let i = 0; i < lit.length; i++) matte[i] = clamp01(mask.k * lit[i] + mask.c);
    blurMatte(matte, width, height, (effect.soften / 2) * space.scale);
    if (effect.style === 'inner') {
      for (let i = 0; i < matte.length; i++) matte[i] *= alpha[i];
    } else if (effect.style === 'outer') {
      for (let i = 0; i < matte.length; i++) matte[i] *= 1 - alpha[i];
    }
    blendedOver(img, coloredLayer(matte, width, height, flood), shade.blend);
  }
}

/** Runs one effect over the picture, in place, drawing every effect into it. */
function runOne(img: FxImage, effect: Effect, space: FxSpace, warn: FxWarn): void {
  const m = colorMatrix(effect);
  if (m) {
    colorPass(img, m);
    return;
  }
  switch (effect.type) {
    case 'blur':
      blurPixels(img.pixels, img.width, 4, { x0: 0, y0: 0, x1: img.width, y1: img.height }, effect.radius * space.scale);
      return;
    case 'drop-shadow':
    case 'outer-glow': {
      const layer = outerLayer(img, effect, space, warn);
      if (layer) laidUnder(img, layer);
      return;
    }
    case 'inner-shadow':
    case 'inner-glow':
      innerPass(img, effect, space, warn);
      return;
    case 'feather':
      featherPass(img, effect.radius, space);
      return;
    case 'bevel':
    case 'emboss':
      reliefPass(img, effect, space, warn);
      return;
    default:
      return;
  }
}

// ---- Running a list ---------------------------------------------------------------------

/** The pixels holding any ink, grown by `grow` and held to the picture; null for an empty one. */
export function inkBox(img: FxImage, grow: number): FxBox | null {
  const { pixels, width, height } = img;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (pixels[(row + x) * 4 + 3] <= 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return {
    x0: Math.max(0, x0 - grow),
    y0: Math.max(0, y0 - grow),
    x1: Math.min(width, x1 + 1 + grow),
    y1: Math.min(height, y1 + 1 + grow),
  };
}

/** The part of a picture inside a box, as a picture of its own. */
function crop(img: FxImage, box: FxBox): FxImage {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  if (box.x0 === 0 && box.y0 === 0 && width === img.width && height === img.height) {
    return { pixels: img.pixels.slice(), width, height };
  }
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((box.y0 + y) * img.width + box.x0) * 4;
    pixels.set(img.pixels.subarray(from, from + width * 4), y * width * 4);
  }
  return { pixels, width, height };
}

/** Writes a box's picture back where it came from. */
function paste(img: FxImage, box: FxBox, part: FxImage): void {
  for (let y = 0; y < part.height; y++) {
    const to = ((box.y0 + y) * img.width + box.x0) * 4;
    img.pixels.set(part.pixels.subarray(y * part.width * 4, (y + 1) * part.width * 4), to);
  }
}

/**
 * Runs an effect list over a picture, in place, as the SVG filter the list
 * makes would. `matrix` is the transform the list is drawn under, to device
 * pixels: its scale sizes every length, and its turn carries a shadow's offset
 * and a bevel's light, as a filter's user space does.
 *
 * With `separate`, the Outer Shadows and Outer Glows the list lays under its
 * picture on their own (effectLayout) are not drawn into it: each comes back
 * as a layer for the caller to lay under the picture by its blend, last first.
 * Without it, every effect is drawn into the picture, a shadow merged under it.
 */
export function runEffects(img: FxImage, effects: readonly Effect[], matrix: Matrix, warn: FxWarn, separate = false): FxUnder[] {
  const { chain, unders } = effectLayout(effects, separate);
  if (chain.length === 0 && unders.length === 0) return [];
  const space: FxSpace = { scale: meanScale(matrix), matrix };
  const box = inkBox(img, Math.ceil(effectReach([...chain, ...unders]) * space.scale) + 2);
  if (!box) return [];
  const work = crop(img, box);
  for (const effect of chain) runOne(work, effect, space, warn);
  paste(img, box, work);
  const layers: FxUnder[] = [];
  // Each layer under is cast from the picture with the ones before it laid under it, as the SVG chain reads it.
  const sofar = unders.length > 1 ? { pixels: work.pixels.slice(), width: work.width, height: work.height } : work;
  for (const effect of unders) {
    if (effect.type !== 'drop-shadow' && effect.type !== 'outer-glow') continue;
    const layer = outerLayer(sofar, effect, space, warn);
    if (!layer) continue;
    layers.push({ image: layer, x: box.x0, y: box.y0, blend: effect.blend ?? 'normal' });
    if (sofar !== work) laidUnder(sofar, layer);
  }
  return layers;
}
