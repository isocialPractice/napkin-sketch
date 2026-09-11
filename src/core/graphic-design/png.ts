/**
 * PNG encoding and decoding for the graphic-design API.
 *
 * The encoder writes 8-bit truecolor-with-alpha, non-interlaced, choosing a
 * row filter with the minimum-sum-of-absolute-differences heuristic the PNG
 * specification recommends - flat colour then costs a byte a row rather than a
 * byte a pixel. The decoder is here so a composition can *place* a PNG:
 * `image` elements are embedded verbatim by the SVG writer, but the rasterizer
 * has to sample real pixels, and PNG is the one format it can open by itself.
 *
 * Both directions run on `deflate.ts`, so neither needs Node.
 */

import { zlibDeflate, zlibInflate } from './deflate.js';

/** Decoded pixels: straight (non-premultiplied) RGBA, row-major. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over a byte range, as every PNG chunk carries. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Builds one length-type-data-CRC chunk. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((c) => c.charCodeAt(0)));
  const body = concat([typeBytes, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** The Paeth predictor: the neighbour the gradient points at. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Encodes straight RGBA pixels as a PNG file.
 *
 * @param data RGBA bytes, `width * height * 4` of them.
 */
export function encodePng(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  if (data.length < stride * height) {
    throw new Error('graphic-design: pixel buffer is smaller than the image it describes');
  }

  // Filter each row five ways and keep the cheapest, which is what turns a
  // page of flat colour into a few hundred bytes.
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const above = row - stride;
    let bestFilter = 0;
    let bestScore = Infinity;
    let bestBytes: Uint8Array | null = null;
    for (let filter = 0; filter < 5; filter++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const x = data[row + i];
        const a = i >= 4 ? data[row + i - 4] : 0;
        const b = y > 0 ? data[above + i] : 0;
        const c = y > 0 && i >= 4 ? data[above + i - 4] : 0;
        let value: number;
        switch (filter) {
          case 1:
            value = x - a;
            break;
          case 2:
            value = x - b;
            break;
          case 3:
            value = x - ((a + b) >> 1);
            break;
          case 4:
            value = x - paeth(a, b, c);
            break;
          default:
            value = x;
        }
        value &= 0xff;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        bestBytes = candidate.slice();
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    raw.set(bestBytes as Uint8Array, y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolor with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return concat([
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibDeflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** True when the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decodes a PNG into straight RGBA pixels.
 *
 * Covers the colour types a design asset realistically arrives in - greyscale,
 * truecolor, palette, and either with alpha - at 8 or 16 bits per sample.
 * Interlaced files raise: Adam7 is a second unfiltering path for a format a
 * caller can re-save in one step.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!isPng(bytes)) throw new Error('graphic-design: not a PNG file');

  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('graphic-design: interlaced PNGs are not supported');
    } else if (type === 'PLTE') {
      palette = data.slice();
    } else if (type === 'tRNS') {
      transparency = data.slice();
    } else if (type === 'IDAT') {
      idat.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!width || !height) throw new Error('graphic-design: PNG has no header');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`graphic-design: unsupported PNG colour type ${colorType}`);
  if (depth !== 8 && depth !== 16 && !(colorType === 3 && depth <= 8)) {
    throw new Error(`graphic-design: unsupported PNG bit depth ${depth}`);
  }

  const raw = zlibInflate(concat(idat));
  const sampleBytes = depth === 16 ? 2 : 1;
  const pixelBytes = depth < 8 ? 1 : channels * sampleBytes;
  const stride =
    depth < 8 ? Math.ceil((width * depth) / 8) : width * channels * sampleBytes;

  // Undo the per-row filters in place, walking rows top to bottom.
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[source + i];
      const a = i >= pixelBytes ? lines[target + i - pixelBytes] : 0;
      const b = y > 0 ? lines[target - stride + i] : 0;
      const c = y > 0 && i >= pixelBytes ? lines[target - stride + i - pixelBytes] : 0;
      let value: number;
      switch (filter) {
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + ((a + b) >> 1);
          break;
        case 4:
          value = x + paeth(a, b, c);
          break;
        default:
          value = x;
      }
      lines[target + i] = value & 0xff;
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const sample = (row: number, index: number): number => {
    if (depth === 16) return lines[row + index * 2];
    return lines[row + index];
  };

  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const out4 = (y * width + x) * 4;
      if (colorType === 3) {
        // Palette indices can be packed below a byte each.
        let index: number;
        if (depth === 8) index = lines[row + x];
        else {
          const perByte = 8 / depth;
          const byte = lines[row + Math.floor(x / perByte)];
          const shift = 8 - depth * ((x % perByte) + 1);
          index = (byte >> shift) & ((1 << depth) - 1);
        }
        const p = palette ? index * 3 : 0;
        out[out4] = palette ? palette[p] : 0;
        out[out4 + 1] = palette ? palette[p + 1] : 0;
        out[out4 + 2] = palette ? palette[p + 2] : 0;
        out[out4 + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        continue;
      }
      const base = x * channels;
      if (colorType === 0 || colorType === 4) {
        const grey = sample(row, base);
        out[out4] = grey;
        out[out4 + 1] = grey;
        out[out4 + 2] = grey;
        out[out4 + 3] = colorType === 4 ? sample(row, base + 1) : 255;
      } else {
        out[out4] = sample(row, base);
        out[out4 + 1] = sample(row, base + 1);
        out[out4 + 2] = sample(row, base + 2);
        out[out4 + 3] = colorType === 6 ? sample(row, base + 3) : 255;
      }
    }
  }

  return { width, height, data: out };
}
