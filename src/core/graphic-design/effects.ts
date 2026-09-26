/**
 * Effects on pixels: the passes the rasterizer runs over an element's own
 * picture before laying it down, one for each effect in the list, in order.
 *
 * The picture is premultiplied RGBA in 0 to 1, which is where a blur is
 * exact. A color effect is a matrix over straight color, as SVG's
 * `feColorMatrix` is, so each pixel has its alpha taken out, the matrix
 * applied and clamped, and its alpha put back. A blur is the one the Filter
 * Effects specification describes: a true Gaussian below a standard deviation
 * of 2 pixels, and above it three box blurs, which is what SVG viewers draw
 * too. Nothing here reads the DOM.
 */

import { colorMatrix, effectReach, shadowColor, type Effect } from '../effects.js';
import { meanScale, type Matrix } from './geometry.js';

/** A premultiplied RGBA picture: four floats a pixel, row by row. */
export interface EffectPixels {
  readonly pixels: Float32Array;
  readonly width: number;
  readonly height: number;
}

/** A box of pixels, its right and bottom edges exclusive. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The pixels holding any ink, grown by `grow` and held to the picture; null for an empty one. */
function inkBox(buf: EffectPixels, grow: number): Box | null {
  const { pixels, width, height } = buf;
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
function blur(pixels: Float32Array, width: number, channels: number, box: Box, sigma: number): void {
  if (sigma <= 0) return;
  const kernel = sigma < 2 ? gaussianKernel(sigma) : null;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
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

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** A color matrix over straight color, inside a box: alpha out, the matrix, clamped, alpha back in. */
function colorPass(pixels: Float32Array, width: number, box: Box, m: readonly number[]): void {
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const p = (y * width + x) * 4;
      const a = pixels[p + 3];
      if (a <= 0) continue;
      const r = pixels[p] / a;
      const g = pixels[p + 1] / a;
      const b = pixels[p + 2] / a;
      const a2 = clamp01(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]);
      pixels[p] = clamp01(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]) * a2;
      pixels[p + 1] = clamp01(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]) * a2;
      pixels[p + 2] = clamp01(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]) * a2;
      pixels[p + 3] = a2;
    }
  }
}

/**
 * A drop shadow inside a box: the picture's alpha, blurred, moved by the
 * offset - the element's own turn and scale carry it, as they carry the
 * element - flooded with the shadow's color, and laid under the picture.
 */
function shadowPass(
  pixels: Float32Array,
  width: number,
  box: Box,
  effect: Extract<Effect, { type: 'drop-shadow' }>,
  matrix: Matrix,
  warn: (message: string) => void,
): void {
  const color = shadowColor(effect.color);
  if (!color) {
    warn(`a drop-shadow color, "${effect.color}", is not one it can paint, so the shadow was left out`);
    return;
  }
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) alpha[y * w + x] = pixels[((box.y0 + y) * width + box.x0 + x) * 4 + 3];
  }
  blur(alpha, w, 1, { x0: 0, y0: 0, x1: w, y1: h }, (effect.blur / 2) * meanScale(matrix));
  const ox = matrix[0] * effect.dx + matrix[2] * effect.dy;
  const oy = matrix[1] * effect.dx + matrix[3] * effect.dy;
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < w && y < h ? alpha[y * w + x] : 0);
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // The shadow here is the blurred alpha from where the offset came from, read between pixels.
      const sx = x - ox;
      const sy = y - oy;
      const fx = Math.floor(sx);
      const fy = Math.floor(sy);
      const tx = sx - fx;
      const ty = sy - fy;
      const shade =
        (at(fx, fy) * (1 - tx) + at(fx + 1, fy) * tx) * (1 - ty) + (at(fx, fy + 1) * (1 - tx) + at(fx + 1, fy + 1) * tx) * ty;
      const sa = shade * color.a;
      if (sa <= 0) continue;
      const p = ((box.y0 + y) * width + box.x0 + x) * 4;
      const under = 1 - pixels[p + 3];
      pixels[p] += r * sa * under;
      pixels[p + 1] += g * sa * under;
      pixels[p + 2] += b * sa * under;
      pixels[p + 3] += sa * under;
    }
  }
}

/**
 * Runs an effect list over a picture, in order. `matrix` is the element's
 * transform to device pixels: its scale sizes every blur and shadow, and its
 * turn carries a shadow's offset. Only the ink and as far as the effects can
 * reach from it is worked on, so a small element on a large page costs little.
 */
export function applyEffects(buf: EffectPixels, effects: readonly Effect[], matrix: Matrix, warn: (message: string) => void): void {
  const scale = meanScale(matrix);
  const box = inkBox(buf, Math.ceil(effectReach(effects) * scale) + 2);
  if (!box) return;
  for (const effect of effects) {
    const m = colorMatrix(effect);
    if (m) colorPass(buf.pixels, buf.width, box, m);
    else if (effect.type === 'blur') blur(buf.pixels, buf.width, 4, box, effect.radius * scale);
    else if (effect.type === 'drop-shadow') shadowPass(buf.pixels, buf.width, box, effect, matrix, warn);
  }
}
