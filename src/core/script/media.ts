/**
 * Images and copied documents in napkin script, with no DOM.
 *
 * A script never reads a file. An image is a data URL, written into the
 * script or handed to the run by name in `options.assets`, and a document for
 * `use` is a page the host already holds, in `options.documents`. This module
 * reads enough of an image's bytes to know its size - the header of a PNG, a
 * JPEG, a GIF or a WebP, or the root element of an SVG - so that one size
 * keeps an image's proportions and no size places it at its own. It also
 * copies a document's layers and marks under a transform, for `use`.
 *
 * Text items and placed images stay upright, as they do in the app: a
 * transform moves and sizes the box they fill, and a turn or a mirror carries
 * the box to where the turned or mirrored box would be, with what is inside
 * still upright. That is the rule the app's Rotate and Mirror follow.
 */

import { apply, meanScale, type Matrix } from '../graphic-design/geometry.js';
import { profileIsSymmetric } from '../stroke-profile.js';
import {
  DEFAULT_NIB_ANGLE,
  isImageStroke,
  isTextStroke,
  strokesByLayer,
  type Layer,
  type Sketch,
  type SketchBook,
  type Stroke,
} from '../types.js';
import { isLengthUnit, toPx } from '../units.js';
import { transformAnchors, transformAngle, transformGradient } from './state.js';

// ---- Data URLs --------------------------------------------------------------------

/** A data URL taken apart: its media type and its bytes. */
export interface DataUrl {
  mime: string;
  bytes: Uint8Array;
}

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i;

/** Base64 to a string of byte values, with or without `atob`. */
function decodeBase64(payload: string): string {
  const clean = payload.replace(/\s+/g, '');
  if (typeof atob === 'function') return atob(clean);
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const char of clean.replace(/=+$/, '')) {
    const value = table.indexOf(char);
    if (value < 0) throw new Error('not base64');
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** A data URL's media type and bytes; null when `src` is not a data URL that decodes. */
export function readDataUrl(src: string): DataUrl | null {
  const match = DATA_URL.exec(src.trim());
  if (!match) return null;
  const mime = (match[1] || 'text/plain').toLowerCase();
  try {
    if (!/;base64/i.test(match[2])) return { mime, bytes: new TextEncoder().encode(decodeURIComponent(match[3])) };
    const binary = decodeBase64(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** True when `src` is a data URL of an image. */
export function isImageDataUrl(src: string): boolean {
  return /^data:image\/[\w.+-]+[;,]/i.test(src.trim());
}

// ---- Image sizes ------------------------------------------------------------------

/** An image's size in pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * The size an image data URL draws at, read from its header: a PNG, a JPEG,
 * a GIF or a WebP by its bytes, whatever the data URL calls it, or an SVG by
 * its root element's `width` and `height`, or its `viewBox`. Null when the
 * size cannot be read.
 */
export function imageSize(src: string): ImageSize | null {
  const data = readDataUrl(src);
  return data ? imageSizeOfBytes(data.bytes) : null;
}

/** The size an image's bytes draw at: {@link imageSize}, for a file read rather than a data URL. */
export function imageSizeOfBytes(b: Uint8Array): ImageSize | null {
  const size = pngSize(b) ?? gifSize(b) ?? jpegSize(b) ?? webpSize(b) ?? svgSize(b);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

const be16 = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));

/** A PNG's size, from the IHDR chunk its signature is followed by. */
function pngSize(b: Uint8Array): ImageSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || signature.some((v, i) => b[i] !== v) || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: be16(b, 16) * 65536 + be16(b, 18), height: be16(b, 20) * 65536 + be16(b, 22) };
}

/** A GIF's size, from its logical screen descriptor. */
function gifSize(b: Uint8Array): ImageSize | null {
  if (b.length < 10 || ascii(b, 0, 4) !== 'GIF8') return null;
  return { width: le16(b, 6), height: le16(b, 8) };
}

/** A JPEG's size, from the first start-of-frame segment. */
function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Markers that stand alone carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { width: be16(b, i + 7), height: be16(b, i + 5) };
    i += 2 + be16(b, i + 2);
  }
  return null;
}

/** A WebP's size, from its first chunk: lossy, lossless or extended. */
function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
  return null;
}

/** An SVG's size, from its root element: `width` and `height` in any unit but a percentage, or its `viewBox`. */
function svgSize(b: Uint8Array): ImageSize | null {
  const head = new TextDecoder().decode(b.subarray(0, 4096));
  const root = /<svg\b([^>]*)>/i.exec(head);
  if (!root) return null;
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root[1])?.[1];
  const length = (value: string | undefined): number | null => {
    const match = value === undefined ? null : /^\s*([\d.]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$/i.exec(value);
    if (!match) return null;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === '' || unit === 'px') return n;
    if (unit === 'cm') return toPx(n * 10, 'mm');
    if (unit === 'pc') return toPx(n * 12, 'pt');
    return isLengthUnit(unit) ? toPx(n, unit) : null;
  };
  const view = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const viewSize = view.length === 4 && view[2] > 0 && view[3] > 0 ? { width: view[2], height: view[3] } : null;
  const width = length(attr('width'));
  const height = length(attr('height'));
  if (width !== null && height !== null) return { width, height };
  if (viewSize && width !== null) return { width, height: (width * viewSize.height) / viewSize.width };
  if (viewSize && height !== null) return { width: (height * viewSize.width) / viewSize.height, height };
  return viewSize;
}

// ---- Upright boxes ---------------------------------------------------------------

/** A box: its top-left corner and its size. */
export interface ItemBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A transform's scale along each of its axes: an image's width and height scale by these. */
export function axisScales(m: Matrix): { x: number; y: number } {
  return { x: Math.hypot(m[0], m[1]), y: Math.hypot(m[2], m[3]) };
}

/**
 * Where a text item or an image lands under a transform, upright. The box's
 * centre goes where the transform takes it, and its width and height are
 * scaled by `scaleX` and `scaleY`: {@link axisScales} for an image, their
 * mean for text, whose size cannot stretch. With no turn and no mirror, and
 * the box scaled along the axes, that puts its corner exactly where the
 * transform puts the corner.
 */
export function uprightBox(box: ItemBox, m: Matrix, scaleX: number, scaleY: number): ItemBox {
  const width = box.width * scaleX;
  const height = box.height * scaleY;
  if (m[1] === 0 && m[2] === 0 && m[0] > 0 && m[3] > 0 && scaleX === m[0] && scaleY === m[3]) {
    return { x: m[0] * box.x + m[4], y: m[3] * box.y + m[5], width, height };
  }
  const centre = apply(m, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

// ---- Copying documents ------------------------------------------------------------

/** A document `use` copies in: a page, or a book, whose first page is used. */
export type ScriptDocument = Sketch | SketchBook;

/** The page `use` copies from; null for a book with no pages. */
export function documentPage(document: ScriptDocument): Sketch | null {
  return 'sketches' in document ? (document.sketches[0] ?? null) : document;
}

/** A layer of a page, with the layers inside it when it is a group, and its marks when it is not. */
export interface LayerNode {
  layer: Layer;
  children: LayerNode[];
  strokes: Stroke[];
}

/**
 * A page's layers as a tree, in paint order. A layer whose parent is missing,
 * or is not a group, sits at the top, as the exporter places it, and a mark
 * whose layer is missing is on the first drawing layer, as the app paints it.
 */
export function layerTree(page: Sketch): LayerNode[] {
  const byLayer = strokesByLayer(page);
  const nodes = new Map<string, LayerNode>(
    page.layers.map((layer) => [layer.id, { layer, children: [], strokes: layer.group ? [] : (byLayer.get(layer.id) ?? []) }]),
  );
  const top: LayerNode[] = [];
  for (const layer of page.layers) {
    const node = nodes.get(layer.id)!;
    const parent = layer.parent === undefined ? undefined : nodes.get(layer.parent);
    if (parent && parent.layer.group && parent !== node) parent.children.push(node);
    else top.push(node);
  }
  return top;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * A mark copied under a transform: a new object, with every point, anchor
 * and handle mapped, the width scaled by the transform's mean scale, and a
 * nib's angle and a linear gradient's axis turned with it. A mirror swaps the
 * sides of a profile that leans, as the Mirror palette does. A text item or
 * an image stays upright (see {@link uprightBox}); `measure` gives a text
 * item's box. The copy has no id and no layer: whoever adds it gives it both.
 */
export function copyStroke(stroke: Stroke, m: Matrix, measure: (text: Stroke) => { width: number; height: number }): Stroke {
  const copy = JSON.parse(JSON.stringify(stroke)) as Stroke;
  copy.id = '';
  delete copy.layer;
  const identity = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
  if (identity) return copy;
  const anchor = copy.points[0];
  if (isTextStroke(copy)) {
    if (!anchor) return copy;
    const k = meanScale(m);
    const placed = uprightBox({ x: anchor.x, y: anchor.y, ...measure(stroke) }, m, k, k);
    copy.points = [{ ...anchor, x: placed.x, y: placed.y }];
    copy.fontSize = round6((copy.fontSize ?? 24) * k);
    if (copy.textBoxWidth) copy.textBoxWidth = round6(copy.textBoxWidth * k);
    return copy;
  }
  if (isImageStroke(copy)) {
    if (!anchor) return copy;
    const s = axisScales(m);
    const box = { x: anchor.x, y: anchor.y, width: copy.imageWidth ?? 100, height: copy.imageHeight ?? 100 };
    const placed = uprightBox(box, m, s.x, s.y);
    copy.points = [{ ...anchor, x: placed.x, y: placed.y }];
    copy.imageWidth = round6(placed.width);
    copy.imageHeight = round6(placed.height);
    return copy;
  }
  copy.points = copy.points.map((p) => ({ ...p, ...apply(m, p) }));
  if (copy.vector) copy.vector = { ...copy.vector, anchors: transformAnchors(copy.vector.anchors, m) };
  copy.width = round6(copy.width * meanScale(m));
  if (copy.tool === 'copic') copy.nibAngle = transformAngle(copy.nibAngle ?? DEFAULT_NIB_ANGLE, m);
  if (copy.gradient) copy.gradient = transformGradient(copy.gradient, m);
  const mirrors = m[0] * m[3] - m[1] * m[2] < 0;
  if (mirrors && copy.profile && !profileIsSymmetric(copy.profile)) {
    if (copy.profileMirrored) delete copy.profileMirrored;
    else copy.profileMirrored = true;
  }
  return copy;
}
