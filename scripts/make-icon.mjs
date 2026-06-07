/**
 * Generates `assets/icon.png` (512x512 RGBA) from scratch using only Node's
 * built-in `zlib` — no native image dependency.
 *
 * The icon mirrors `assets/icon.svg`: a rounded blue tile, a cream "napkin",
 * and a hand-drawn ink squiggle with an orange underline. It is intentionally
 * simple so it builds anywhere.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../assets/icon.png');

/** RGBA framebuffer, row-major. */
const buf = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const inv = 1 - a;
  buf[i] = Math.round(r * a + buf[i] * inv);
  buf[i + 1] = Math.round(g * a + buf[i + 1] * inv);
  buf[i + 2] = Math.round(b * a + buf[i + 2] * inv);
  buf[i + 3] = Math.round(255 * a + buf[i + 3] * inv);
}

/** Anti-aliased rounded rectangle. */
function fillRoundRect(x0, y0, w, h, radius, color) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
      const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
      const dist = Math.hypot(x - cx, y - cy);
      const a = clamp(radius + 0.5 - dist, 0, 1);
      setPixel(x, y, color, a);
    }
  }
}

/** Thick anti-aliased polyline (round caps) sampled densely. */
function strokePath(points, width, color) {
  const r = width / 2;
  for (let s = 0; s < points.length - 1; s++) {
    const [ax, ay] = points[s];
    const [bx, by] = points[s + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampDisc(ax + (bx - ax) * t, ay + (by - ay) * t, r, color);
    }
  }
}

function stampDisc(cx, cy, r, color) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const a = clamp(r + 0.5 - Math.hypot(x - cx, y - cy), 0, 1);
      if (a > 0) setPixel(x, y, color, a);
    }
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Samples a cubic-ish wavy curve as a dense polyline. */
function wave(x0, x1, baseY, amp, freq, phase) {
  const pts = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = baseY + Math.sin(t * Math.PI * freq + phase) * amp;
    pts.push([x, y]);
  }
  return pts;
}

const BLUE = [38, 96, 224];
const NAPKIN = [252, 250, 245];
const INK = [31, 35, 40];
const ACCENT = [240, 140, 46];

function draw() {
  fillRoundRect(24, 24, 464, 464, 104, BLUE);
  fillRoundRect(96, 104, 320, 304, 26, NAPKIN);
  strokePath(wave(138, 388, 290, 44, 2.2, 0.6), 22, INK);
  strokePath(wave(150, 300, 344, 18, 1.0, 0.2), 14, ACCENT);
}

/** Minimal PNG encoder (truecolor + alpha, no interlace). */
function writePng(path, rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Add a per-row filter byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]),
  );
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// Render and write the icon (run last so all helpers/tables are initialized).
draw();
writePng(outPath, buf, SIZE, SIZE);
console.log(`icon -> ${outPath}`);
