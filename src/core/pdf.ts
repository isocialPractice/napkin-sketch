/**
 * Dependency-free PDF export.
 *
 * Serialises sketches to a vector PDF document with **no Node or Electron
 * imports**, so it can run in the renderer, the embeddable web API, or a
 * Node script. Content streams are written uncompressed so the companion
 * importer (`pdf-import.ts`) can round-trip napkin-sketch exports.
 *
 * Fidelity notes (mirrors the SVG exporter's approximations):
 * - Strokes are uniform-width polylines with round caps and joins.
 * - Eraser strokes are painted in the page background color, so they also
 *   cover content on layers beneath their own.
 * - Layer opacity multiplies each stroke's opacity via an ExtGState.
 * - Image items are embedded only when their data URL is a JPEG
 *   (`image/jpeg`); callers should pre-convert other formats.
 *
 * The returned string contains only code points 0-255; write it to disk with
 * latin1/binary encoding to preserve embedded image bytes.
 */

import {
  defaultOpacityFor,
  effectiveLayer,
  isImageStroke,
  isTextStroke,
  strokesOnLayer,
  type Sketch,
  type Stroke,
} from './types.js';
import { copicNibPolygons } from './nib.js';

/** RGB color with components in 0-1. */
type Rgb = [number, number, number];

/** Parses a CSS hex or rgb()/rgba() color into 0-1 RGB components. */
export function parseCssColor(color: string): Rgb {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16) / 255,
        parseInt(h[1] + h[1], 16) / 255,
        parseInt(h[2] + h[2], 16) / 255,
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
  if (rgb) {
    return [
      Math.min(255, Number(rgb[1])) / 255,
      Math.min(255, Number(rgb[2])) / 255,
      Math.min(255, Number(rgb[3])) / 255,
    ];
  }
  return [0, 0, 0];
}

/** Formats a number for a PDF content stream (compact, no exponent). */
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Formats a color component with enough precision to round-trip 8-bit values. */
function col(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** Escapes and latin1-folds a string for a PDF literal string. */
function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (code > 255) out += '?';
    else out += ch;
  }
  return out;
}

/** Decodes a base64 data URL body into a latin1 byte string. */
function dataUrlBytes(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (typeof atob === 'function') return atob(body);
  // Minimal fallback decoder for runtimes without atob.
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of body.replace(/=+$/, '')) {
    const value = table.indexOf(ch);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** Reads pixel dimensions from JPEG bytes (SOF marker scan). */
function jpegSize(bytes: string): { width: number; height: number } | null {
  const at = (i: number): number => bytes.charCodeAt(i) & 0xff;
  if (bytes.length < 4 || at(0) !== 0xff || at(1) !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (at(i) !== 0xff) {
      i += 1;
      continue;
    }
    const marker = at(i + 1);
    // SOF0-SOF15 hold dimensions, except DHT/JPG/DAC (C4/C8/CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (at(i + 5) << 8) | at(i + 6), width: (at(i + 7) << 8) | at(i + 8) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + ((at(i + 2) << 8) | at(i + 3));
  }
  return null;
}

/** Effective paint alpha for a stroke on a layer (tool default when unset). */
function strokeAlpha(stroke: Stroke, layerOpacity: number): number {
  if (stroke.tool === 'eraser') return layerOpacity;
  const own = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  return own * layerOpacity;
}

/**
 * Serialises sketches to a multi-page PDF document (one page per sketch).
 *
 * Returns a latin1-safe string; persist it with binary/latin1 encoding.
 */
export function sketchesToPdf(sketches: Sketch[]): string {
  // Object 1: catalog, 2: pages tree, 3: Helvetica. ExtGStates, images, and
  // per-page objects are appended in that order below.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '', // pages tree placeholder, filled once page ids are known
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const addObject = (body: string): number => objects.push(body);

  // Shared ExtGState per distinct alpha, and image XObject per data URL.
  const gstates = new Map<number, { name: string; obj: number }>();
  const images = new Map<string, { name: string; obj: number; width: number; height: number }>();

  const gstateFor = (alpha: number): string => {
    const key = Math.round(alpha * 1000);
    let entry = gstates.get(key);
    if (!entry) {
      const value = key / 1000;
      const obj = addObject(`<< /Type /ExtGState /CA ${value} /ca ${value} >>`);
      entry = { name: `GS${gstates.size + 1}`, obj };
      gstates.set(key, entry);
    }
    return entry.name;
  };

  const imageFor = (dataUrl: string): { name: string; width: number; height: number } | null => {
    let entry = images.get(dataUrl);
    if (!entry) {
      if (!/^data:image\/jpe?g[;,]/i.test(dataUrl)) return null;
      const bytes = dataUrlBytes(dataUrl);
      const size = jpegSize(bytes);
      if (!size) return null;
      const obj = addObject(
        `<< /Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${bytes.length} >>\nstream\n${bytes}\nendstream`,
      );
      entry = { name: `Im${images.size + 1}`, obj, ...size };
      images.set(dataUrl, entry);
    }
    return entry;
  };

  interface PendingPage {
    width: number;
    height: number;
    content: string;
  }
  const pages: PendingPage[] = [];

  for (const sketch of sketches) {
    const H = sketch.height;
    const ops: string[] = [];

    // Opaque paper background, matching the JPEG export behaviour.
    const [br, bg, bb] = parseCssColor(sketch.background);
    ops.push('q', `${col(br)} ${col(bg)} ${col(bb)} rg`, `0 0 ${num(sketch.width)} ${num(H)} re f`, 'Q');

    for (const layer of sketch.layers) {
      if (layer.group) continue; // groups paint nothing themselves
      const effective = effectiveLayer(sketch, layer);
      if (!effective.visible) continue;
      for (const stroke of strokesOnLayer(sketch, layer.id)) {
        const alpha = strokeAlpha(stroke, effective.opacity);
        const gs = alpha < 1 ? `/${gstateFor(alpha)} gs` : '';

        if (isTextStroke(stroke)) {
          const anchor = stroke.points[0];
          if (!anchor || !stroke.text) continue;
          const size = stroke.fontSize ?? 24;
          const leading = size * 1.25;
          const [r, g, b] = parseCssColor(stroke.color);
          const lines = stroke.text.split('\n');
          const text = lines
            .map((line, i) => `(${pdfString(line)}) Tj${i < lines.length - 1 ? ' T*' : ''}`)
            .join(' ');
          ops.push(
            'q',
            ...(gs ? [gs] : []),
            `${col(r)} ${col(g)} ${col(b)} rg`,
            'BT',
            `/F1 ${num(size)} Tf`,
            `${num(leading)} TL`,
            // Canvas anchors text at the glyph top; PDF at the baseline.
            `${num(anchor.x)} ${num(H - anchor.y - size * 0.8)} Td`,
            text,
            'ET',
            'Q',
          );
          continue;
        }

        if (isImageStroke(stroke)) {
          const anchor = stroke.points[0];
          if (!anchor || !stroke.image) continue;
          const image = imageFor(stroke.image);
          if (!image) continue;
          const w = stroke.imageWidth ?? image.width;
          const h = stroke.imageHeight ?? image.height;
          ops.push(
            'q',
            ...(gs ? [gs] : []),
            `${num(w)} 0 0 ${num(h)} ${num(anchor.x)} ${num(H - anchor.y - h)} cm`,
            `/${image.name} Do`,
            'Q',
          );
          continue;
        }

        const pts = stroke.points;
        if (pts.length === 0) continue;
        const [r, g, b] = parseCssColor(stroke.tool === 'eraser' ? sketch.background : stroke.color);

        // Filled shape interior, painted before its outline.
        if (stroke.fill && stroke.tool !== 'eraser' && pts.length > 2) {
          const [fr, fg, fb] = parseCssColor(stroke.fill);
          const fillPath =
            pts.map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ') +
            ' h f';
          ops.push('q', ...(gs ? [gs] : []), `${col(fr)} ${col(fg)} ${col(fb)} rg`, fillPath, 'Q');
        }

        // Copic marker: fill the chisel-nib footprint (single non-zero fill,
        // matching the canvas renderer). The vertical flip to PDF coordinates
        // mirrors every polygon the same way, so windings stay consistent.
        if (stroke.tool === 'copic') {
          const fillPath =
            copicNibPolygons(stroke)
              .map(
                (poly) =>
                  poly.map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ') +
                  ' h',
              )
              .join(' ') + ' f';
          ops.push('q', ...(gs ? [gs] : []), `${col(r)} ${col(g)} ${col(b)} rg`, fillPath, 'Q');
          continue;
        }

        const path =
          pts.length === 1
            ? // Zero-length round-capped segment renders as a dot.
              `${num(pts[0].x)} ${num(H - pts[0].y)} m ${num(pts[0].x)} ${num(H - pts[0].y)} l S`
            : pts
                .map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 ? 'm' : 'l'}`)
                .join(' ') + ' S';
        ops.push(
          'q',
          ...(gs ? [gs] : []),
          `${col(r)} ${col(g)} ${col(b)} RG`,
          `${num(Math.max(0.5, stroke.width))} w`,
          '1 J 1 j',
          path,
          'Q',
        );
      }
    }

    pages.push({ width: sketch.width, height: H, content: ops.join('\n') });
  }

  // Shared resource dictionary referencing every gstate and image object.
  const gstateEntries = [...gstates.values()].map((e) => `/${e.name} ${e.obj} 0 R`).join(' ');
  const imageEntries = [...images.values()].map((e) => `/${e.name} ${e.obj} 0 R`).join(' ');
  const resources =
    `<< /Font << /F1 3 0 R >>` +
    (gstateEntries ? ` /ExtGState << ${gstateEntries} >>` : '') +
    (imageEntries ? ` /XObject << ${imageEntries} >>` : '') +
    ` >>`;

  const pageIds: number[] = [];
  for (const page of pages) {
    const contentId = addObject(
      `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`,
    );
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources ${resources} /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Assemble the file with a cross-reference table of byte offsets.
  const header = '%PDF-1.4\n%âãÏÓ\n';
  let body = '';
  const offsets: number[] = [];
  objects.forEach((content, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });
  const xrefStart = header.length + body.length;
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return header + body + xref + trailer;
}
