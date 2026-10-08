/**
 * Dependency-free PDF export.
 *
 * Serialises sketches to a vector PDF document with **no Node or Electron
 * imports**, so it can run in the renderer, the embeddable web API, or a
 * Node script. Content streams are written uncompressed so the companion
 * importer (`pdf-import.ts`) can round-trip napkin-sketch exports.
 *
 * Fidelity notes (mirrors the SVG exporter's approximations):
 * - Strokes are uniform-width polylines with round caps and joins, dashed as
 *   the SVG dashes them. A switched-off outline is not drawn.
 * - Eraser strokes are painted in the page background color, so they also
 *   cover content on layers beneath their own. A transparent page has no
 *   color to paint them in, so there they draw nothing.
 * - Layer opacity multiplies each stroke's opacity via an ExtGState, and so
 *   does the alpha of a color that has one.
 * - A gradient fill prints as the shape's flat fill.
 * - Effects - a blur, a shadow, a color shift, on a mark or a layer - are
 *   not drawn: what carries them prints plain.
 * - Text is drawn as shapes where its fonts can be read: each glyph its
 *   font's own outline (core/type/outline.ts), laid out by the current
 *   outline source's measure - the canvas's in the app, the font files' in
 *   a headless render given them - as the canvas draws it. Where a font
 *   cannot be read, or `textAsShapes` is false, it is set as the type layout
 *   sets it with the built-in face (as the SVG export sets it without a
 *   measure of its own): its lines, its frame or its path, each stretch in
 *   one style a string from its start, in Helvetica - bold and oblique where
 *   a run is - with its letter and word spacing; a character turned or
 *   scaled on its own is placed through its own text matrix, and
 *   underlines, strikethroughs and highlights are filled shapes.
 * - Image items are embedded only when their data URL is a JPEG
 *   (`image/jpeg`); callers should pre-convert other formats.
 *
 * - A clip group's layers paint inside its clip: each clip's contours a path
 *   made the clipping path (`W n`) inside the layer's `q ... Q`, nested clips
 *   cutting in turn, and the clip mark itself left out, as it paints nothing.
 *
 * What a page holds that the PDF cannot print - an image that is not a JPEG,
 * a color that is not a color, a gradient, an effect - is reported through
 * `PdfOptions.onWarning`.
 *
 * The returned string contains only code points 0-255; write it to disk with
 * latin1/binary encoding to preserve embedded image bytes.
 */

import {
  dashPatternFor,
  defaultOpacityFor,
  effectiveLayers,
  isImageStroke,
  isTextStroke,
  strokesByLayer,
  type Layer,
  type Sketch,
  type Stroke,
  type VectorAnchor,
} from './types.js';
import { copicNibPolygons } from './nib.js';
import { meanPressure, pencilMeanCoverage, pencilPaint, pencilPicture, pencilRegion } from './pencil.js';
import { zlibDeflate } from './graphic-design/deflate.js';
import { clipIndex } from './clip.js';
import { linkName } from './link.js';
import { activeProfile, profileInputOf, profileOutline } from './stroke-profile.js';
import { parseColor } from './graphic-design/color.js';
import { layoutType, typeSpans } from './type/layout.js';
import { setAccentPage, withAccentPage } from './type/accents.js';
import { withoutMarkdownReveal } from './type/markdown-flow.js';
import { faceStyle } from './type/measure.js';
import { outlineSource, outlineText } from './type/outline.js';
import { blendModeInfo, isBlended, type BlendModeId } from './blend.js';
import { activeEffects, EFFECT_LABELS } from './effects.js';
import { markOpacity } from './appearance.js';
import { bindGeometry, geometryOf } from './geometry-effects.js';
import { paintSteps, type PaintIndex } from './paint-order.js';

/** RGB color with components in 0-1. */
type Rgb = [number, number, number];

/** A color as PDF paint: its components in 0-1 and its alpha. */
interface PdfPaint {
  rgb: Rgb;
  alpha: number;
}

/**
 * Reads a CSS color - hex of three to eight digits, `rgb()`, `hsl()`, a named
 * color, `transparent` - with the composition model's parser, the one the
 * PNG is painted with. Null for anything that is not a color.
 */
function readColor(color: string): PdfPaint | null {
  try {
    const { r, g, b, a } = parseColor(color);
    return { rgb: [r / 255, g / 255, b / 255], alpha: a };
  } catch {
    return null;
  }
}

/** Parses a CSS color into 0-1 RGB components: any color {@link readColor} reads, and black for anything else. */
export function parseCssColor(color: string): Rgb {
  return readColor(color)?.rgb ?? [0, 0, 0];
}

/** How {@link sketchesToPdf} writes its pages. */
export interface PdfOptions {
  /**
   * A box a page, in page pixels, to cut each page to. The page's media box
   * becomes the box, so a viewer shows that part of the page and nothing
   * else. A missing or null entry writes the whole page.
   */
  crops?: ReadonlyArray<{ x: number; y: number; width: number; height: number } | null | undefined>;
  /** Told about each thing a page holds that the PDF leaves out or prints as a stand-in. */
  onWarning?: (message: string) => void;
  /**
   * Draws text as shapes - its glyphs' outlines, from the current outline
   * source - where its fonts can be read, so the page looks as the canvas
   * does on any computer; a text whose font cannot be read is set in
   * Helvetica, and said. Default true. False sets all text in Helvetica.
   */
  textAsShapes?: boolean;
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
export function sketchesToPdf(sketches: Sketch[], options: PdfOptions = {}): string {
  return withoutMarkdownReveal(() => withAccentPage(null, () => pdfOf(sketches, options)));
}

/** The document {@link sketchesToPdf} writes, every Markdown block rendered. */
function pdfOf(sketches: Sketch[], options: PdfOptions): string {
  // Object 1: catalog, 2: pages tree, 3: Helvetica. ExtGStates, images, and
  // per-page objects are appended in that order below.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '', // pages tree placeholder, filled once page ids are known
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const addObject = (body: string): number => objects.push(body);

  // Helvetica is object 3, as F1; its bold and oblique faces are added the first time a run asks for one.
  const fonts = new Map<string, { name: string; obj: number }>([['Helvetica', { name: 'F1', obj: 3 }]]);
  const fontFor = (style: string): string => {
    const { weight, italic } = faceStyle(style);
    const base = weight >= 600 ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica';
    let entry = fonts.get(base);
    if (!entry) {
      entry = { name: `F${fonts.size + 1}`, obj: addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`) };
      fonts.set(base, entry);
    }
    return entry.name;
  };

  // Shared ExtGState per distinct alpha and blend, and image XObject per data URL.
  const gstates = new Map<string, { name: string; obj: number }>();
  const images = new Map<string, { name: string; obj: number; width: number; height: number }>();

  /** The graphics state for an alpha, mixed by a blend when it has one (PDF's `/BM`). */
  const gstateFor = (alpha: number, blend?: BlendModeId): string => {
    const value = Math.round(alpha * 1000) / 1000;
    const mode = isBlended(blend) ? blend : null;
    const key = mode ? `${value} ${mode}` : String(value);
    let entry = gstates.get(key);
    if (!entry) {
      // A state for a blend alone leaves the alpha as it is.
      const fields = [...(mode && value >= 1 ? [] : [`/CA ${value} /ca ${value}`]), ...(mode ? [`/BM /${blendModeInfo(mode).pdf}`] : [])];
      const obj = addObject(`<< /Type /ExtGState ${fields.join(' ')} >>`);
      entry = { name: `GS${gstates.size + 1}`, obj };
      gstates.set(key, entry);
    }
    return entry.name;
  };

  // A blended layer, and a group with a blend or Isolate Blending, print as a
  // transparency group: a form XObject of their own, composited as one
  // picture, as the canvas lays a picture down. Their resources are the
  // page's, which are only known once everything is written, so each form
  // carries this token until then.
  const RESOURCES = '%%napkin-resources%%';
  const forms: Array<{ name: string; obj: number }> = [];
  const formFor = (content: string, box: readonly [number, number, number, number]): string => {
    const name = `Fm${forms.length + 1}`;
    const obj = addObject(
      `<< /Type /XObject /Subtype /Form /BBox [${box.map(num).join(' ')}] ` +
        `/Group << /S /Transparency /I true /K false >> /Resources ${RESOURCES} ` +
        `/Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    forms.push({ name, obj });
    return name;
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

  /**
   * A smeared Pencil mark's picture as an image: its color, and its alpha as
   * a soft mask, both deflated. PDF has no paint for graphite a stump has
   * pushed about, so the picture is what prints, at twice the page's
   * resolution - as the SVG export writes it.
   */
  const pictureFor = (stroke: Stroke): { name: string; x: number; y: number; width: number; height: number } | null => {
    const region = pencilRegion(stroke, 2);
    if (!region) return null;
    const data = pencilPicture(stroke, region);
    const n = region.width * region.height;
    const rgb = new Uint8Array(n * 3);
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = data[i * 4];
      rgb[i * 3 + 1] = data[i * 4 + 1];
      rgb[i * 3 + 2] = data[i * 4 + 2];
      alpha[i] = data[i * 4 + 3];
    }
    const latin1 = (bytes: Uint8Array): string => {
      let out = '';
      for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return out;
    };
    const mask = latin1(zlibDeflate(alpha));
    const color = latin1(zlibDeflate(rgb));
    const maskObj = addObject(
      `<< /Type /XObject /Subtype /Image /Width ${region.width} /Height ${region.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>\nstream\n${mask}\nendstream`,
    );
    const obj = addObject(
      `<< /Type /XObject /Subtype /Image /Width ${region.width} /Height ${region.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${maskObj} 0 R /Filter /FlateDecode /Length ${color.length} >>\nstream\n${color}\nendstream`,
    );
    const name = `Im${images.size + 1}`;
    images.set(`pencil:${obj}`, { name, obj, width: region.width, height: region.height });
    return { name, x: region.x / 2, y: region.y / 2, width: region.width / 2, height: region.height / 2 };
  };

  interface PendingPage {
    /** The media box, in PDF points: left, bottom, right, top. */
    media: [number, number, number, number];
    content: string;
    /** Whether it blends: the page is then a transparency group in RGB, which fixes the space the blends mix in. */
    blends: boolean;
  }
  const pages: PendingPage[] = [];

  // Each thing left out is said once for the document, however often it recurs.
  const said = new Set<string>();
  const warn = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    options.onWarning?.(message);
  };

  for (const [index, sketch] of sketches.entries()) {
    // A layer's Warp bends what it holds: each mark prints as it is bent; its code is accented for its paper.
    bindGeometry(sketch);
    setAccentPage(sketch.background);
    const H = sketch.height;
    const ops: string[] = [];
    // A crop is the media box: page pixels, flipped to PDF's upward y.
    const crop = options.crops?.[index];
    const media: PendingPage['media'] = crop
      ? [crop.x, H - crop.y - crop.height, crop.x + crop.width, H - crop.y]
      : [0, 0, sketch.width, H];
    // Both resolved once for the page rather than per layer (see
    // strokesByLayer and effectiveLayers).
    const byLayer = strokesByLayer(sketch);
    const effectiveOf = effectiveLayers(sketch);
    const clips = clipIndex(sketch);
    const page = `page "${sketch.name}"`;
    const layerById = new Map(sketch.layers.map((l) => [l.id, l]));
    // Each effect a PDF does not draw is named, once for the document: an
    // effect switched off draws nowhere, and is not.
    const sayEffects = (effects: unknown): void => {
      for (const effect of activeEffects(effects) ?? []) {
        warn(`${page}: ${EFFECT_LABELS[effect.type]} is not drawn in a PDF, so what carries it prints without it`);
      }
    };
    const sayEffectsAbove = (layer: Layer): void => {
      const seen = new Set<string>();
      for (let at: Layer | undefined = layer; at && !seen.has(at.id); at = at.parent ? layerById.get(at.parent) : undefined) {
        seen.add(at.id);
        sayEffects(at.effects);
      }
    };

    // An ExtGState for any alpha below 1, as the operator list to splice in.
    const alphaOps = (alpha: number): string[] => (alpha < 1 ? [`/${gstateFor(alpha)} gs`] : []);
    // A color the page names, or null - said once - when it is not a color.
    const paintOf = (color: string): PdfPaint | null => {
      const paint = readColor(color);
      if (!paint) warn(`${page}: "${color}" is not a color, so what it colors was left out`);
      return paint;
    };

    /** A color as fill paint, at `alpha` times its own: the operators, or null for what is not a color. */
    const fillPaint = (color: string, alpha: number): string[] | null => {
      const ink = paintOf(color);
      if (!ink) return null;
      const [r, g, b] = ink.rgb;
      return [...alphaOps(alpha * ink.alpha), `${col(r)} ${col(g)} ${col(b)} rg`];
    };
    /** Anchors as a PDF path, each subpath closed when `closed`, y flipped up. */
    const anchorPath = (anchors: readonly VectorAnchor[], closed: boolean): string => {
      const pt = (p: { x: number; y: number }): string => `${num(p.x)} ${num(H - p.y)}`;
      const parts: string[] = [];
      let start = 0;
      for (let i = 1; i <= anchors.length; i++) {
        if (i < anchors.length && !anchors[i].move) continue;
        const sub = anchors.slice(start, i);
        parts.push(`${pt(sub[0].p)} m`);
        const segment = (a: VectorAnchor, b: VectorAnchor): string => (a.hOut || b.hIn ? `${pt(a.hOut ?? a.p)} ${pt(b.hIn ?? b.p)} ${pt(b.p)} c` : `${pt(b.p)} l`);
        for (let k = 1; k < sub.length; k++) parts.push(segment(sub[k - 1], sub[k]));
        if (closed && sub.length > 1) {
          const last = sub[sub.length - 1];
          if (last.hOut || sub[0].hIn) parts.push(segment(last, sub[0]));
          parts.push('h');
        }
        start = i;
      }
      return parts.join(' ');
    };
    /**
     * A text as the shapes it is drawn as, each at the text's opacity: its
     * glyphs' outlines from the current source, where it can read them. A
     * text it cannot is itself, set in Helvetica, and said.
     */
    const textShapes = (text: Stroke): Stroke[] => {
      const source = outlineSource();
      if (options.textAsShapes === false || !source || !text.points[0]) return [text];
      const out = outlineText(text, layoutType(text, source.measure), source);
      if (out.problem !== null) {
        warn(`${out.problem}, so a text is set in Helvetica.`);
        return [text];
      }
      const own = markOpacity(text);
      return out.marks.map((shape) => ({ ...shape.mark, opacity: own }));
    };
    /** Four corners as a filled PDF shape. */
    const quad = (corners: ReadonlyArray<{ x: number; y: number }>): string =>
      `${corners.map((p, k) => `${num(p.x)} ${num(H - p.y)} ${k === 0 ? 'm' : 'l'}`).join(' ')} h f`;

    /**
     * A text mark as the type layout sets it with the built-in face: its
     * frame's paint, its shades and highlights, each stretch in one style as
     * a string from its start, each character turned or scaled on its own
     * through its own text matrix, its list markers, and its underlines and
     * strikethroughs as thin filled shapes.
     */
    const typeOps = (stroke: Stroke, alpha: number): string[] => {
      const layout = layoutType(stroke);
      const out: string[] = [];
      const frame = layout.frame;
      if (frame?.fill || frame?.stroke) {
        const fill = frame.fill ? fillPaint(frame.fill, alpha) : null;
        const line = frame.stroke ? paintOf(frame.stroke) : null;
        const path = anchorPath(frame.anchors, true);
        if (fill) out.push('q', ...fill, `${path} f`, 'Q');
        if (line) out.push('q', ...alphaOps(alpha * line.alpha), `${line.rgb.map(col).join(' ')} RG`, `${num(frame.width ?? 1)} w`, `${path} S`, 'Q');
      }
      for (const highlight of layout.highlights) {
        const paint = fillPaint(highlight.color, alpha);
        if (paint) out.push('q', ...paint, quad(highlight.corners), 'Q');
      }
      // The text is one text object, so a reader takes its lines as one text: each stretch its color,
      // alpha, font, spacing and matrix, the state carried on from the stretch before.
      const shown: string[] = [];
      const state = { alpha: 1, tc: 0, tw: 0 };
      const show = (color: string, font: { style: string; size: number }, matrix: number[], x: number, y: number, body: string, tc = 0, tw = 0): void => {
        const ink = paintOf(color);
        if (!ink) return;
        const a = Math.round(alpha * ink.alpha * 1000) / 1000;
        if (a !== state.alpha) shown.push(`/${gstateFor(a)} gs`);
        if (Math.abs(tc - state.tc) > 1e-9) shown.push(`${num(tc)} Tc`);
        if (Math.abs(tw - state.tw) > 1e-9) shown.push(`${num(tw)} Tw`);
        Object.assign(state, { alpha: a, tc, tw });
        shown.push(`${ink.rgb.map(col).join(' ')} rg /${fontFor(font.style)} ${num(font.size)} Tf ${matrix.map((v) => num(v)).join(' ')} ${num(x)} ${num(H - y)} Tm (${pdfString(body)}) Tj`);
      };
      for (const span of typeSpans(layout)) {
        if (span.text.trim() === '') continue;
        if (span.plain) show(span.color, span.font, [1, 0, 0, 1], span.x, span.y, span.text, span.tracking, span.wordSpace);
        else {
          // A glyph's x axis and its downward y axis on the page, as PDF's upward text space takes them.
          const g = span.glyphs[0];
          show(g.color, g.font, [g.matrix[0], -g.matrix[1], -g.matrix[2], g.matrix[3]], g.x, g.y, g.ch);
        }
      }
      for (const marker of layout.markers) show(marker.color, marker.font, [1, 0, 0, 1], marker.x, marker.y, marker.text);
      if (shown.length > 0) out.push('q', 'BT', ...shown, 'ET', 'Q');
      for (const line of layout.decorations) {
        const paint = fillPaint(line.color, alpha);
        const length = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
        if (!paint || length === 0) continue;
        const nx = (-(line.to.y - line.from.y) / length) * (line.thickness / 2);
        const ny = ((line.to.x - line.from.x) / length) * (line.thickness / 2);
        const corners = [
          { x: line.from.x + nx, y: line.from.y + ny },
          { x: line.to.x + nx, y: line.to.y + ny },
          { x: line.to.x - nx, y: line.to.y - ny },
          { x: line.from.x - nx, y: line.from.y - ny },
        ];
        out.push('q', ...paint, quad(corners), 'Q');
      }
      return out;
    };

    // The paper, matching the JPEG export behaviour; a transparent page has none.
    const paper = paintOf(sketch.background);
    if (paper && paper.alpha > 0) {
      const [br, bg, bb] = paper.rgb;
      ops.push('q', ...alphaOps(paper.alpha), `${col(br)} ${col(bg)} ${col(bb)} rg`, `0 0 ${num(sketch.width)} ${num(H)} re f`, 'Q');
    }

    /**
     * One drawing layer's marks onto `ops`, each at its own alpha times
     * `opacity`: the layer's and its groups', up to the picture it prints in.
     */
    const paintLayer = (layer: Layer, opacity: number, ops: string[]): void => {
      sayEffectsAbove(layer);
      // A clip mark paints nothing while it clips; a layer left with nothing is passed by.
      const marks = clips.any ? (byLayer.get(layer.id) ?? []).filter((s) => !clips.marks.has(s.id)) : (byLayer.get(layer.id) ?? []);
      if (marks.length === 0) return;
      // In a clip group the layer paints inside every clip above it: each one's
      // contours a path, made the clip (W) and drawn nothing (n).
      const above = clips.of(layer);
      if (above.length > 0) {
        ops.push('q');
        for (const clip of above) {
          const outline = clip.region.map((ring) => ring.map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' h');
          ops.push(...outline, 'W n');
        }
      }
      // A mark a geometry effect draws anew prints as it draws: bent whole by
      // a Warp; or - a Splatter, a Warp on one part - as its parts, fill under
      // stroke; or built in 3D, as its faces, far first; the parts and the
      // faces each at the mark's own opacity (core/geometry-effects.ts). The
      // effects it leaves out are its own.
      for (const mark of marks) sayEffects(mark.effects);
      const drawn = marks.flatMap((mark) => {
        const geometry = geometryOf(mark);
        if (!geometry && isTextStroke(mark)) return textShapes(mark);
        if (!geometry) return [mark];
        if (geometry.whole) return [geometry.whole];
        const own = markOpacity(mark);
        if (geometry.faces) return geometry.faces.map((face) => ({ ...face, opacity: own }));
        return [geometry.parts!.fill, geometry.parts!.stroke].filter((part) => part.points.length > 0).map((part) => ({ ...part, opacity: own }));
      });
      for (const stroke of drawn) {
        const alpha = strokeAlpha(stroke, opacity);
        const gs = alpha < 1 ? `/${gstateFor(alpha)} gs` : '';

        if (isTextStroke(stroke)) {
          if (stroke.points[0] && (stroke.text || stroke.typeset?.frame)) ops.push(...typeOps(stroke, alpha));
          continue;
        }

        if (isImageStroke(stroke) && stroke.link) {
          // A linked file is drawn as its placeholder: a dashed box the placed
          // size with the file's name in it. Embedding the file itself would
          // make the PDF an import of it rather than a link to it.
          const anchor = stroke.points[0];
          if (!anchor) continue;
          const w = stroke.imageWidth ?? 100;
          const h = stroke.imageHeight ?? 100;
          const left = anchor.x;
          const bottom = H - anchor.y - h;
          const size = Math.min(28, Math.max(8, Math.min(w, h) * 0.14));
          const name = linkName(stroke.link.href);
          // Helvetica averages about half the size a character, which centres the name closely enough.
          const nameWidth = Math.min(name.length * size * 0.5, w - 8);
          ops.push(
            'q',
            ...(gs ? [gs] : []),
            '0.965 0.973 0.98 rg',
            `${num(left)} ${num(bottom)} ${num(w)} ${num(h)} re f`,
            '0.431 0.467 0.506 RG 2 w [6 4] 0 d',
            `${num(left + 1)} ${num(bottom + 1)} ${num(w - 2)} ${num(h - 2)} re S`,
            '0.341 0.376 0.416 rg',
            'BT',
            `/F1 ${num(size)} Tf`,
            `${num(left + (w - nameWidth) / 2)} ${num(bottom + h / 2 - size * 0.35)} Td`,
            `(${pdfString(name)}) Tj`,
            'ET',
            'Q',
          );
          continue;
        }

        if (isImageStroke(stroke)) {
          const anchor = stroke.points[0];
          if (!anchor || !stroke.image) continue;
          const image = imageFor(stroke.image);
          if (!image) {
            warn(`${page}: an image that is not a JPEG was left out, since the PDF embeds JPEG images only`);
            continue;
          }
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
        const isEraser = stroke.tool === 'eraser';
        // An eraser paints the paper back over what it crossed; with no paper there is nothing to paint.
        const ink = isEraser ? (paper && paper.alpha > 0 ? paper : null) : paintOf(stroke.color);
        const [r, g, b] = ink?.rgb ?? [0, 0, 0];
        const inkOps = alphaOps(alpha * (ink?.alpha ?? 1));

        // Filled shape interior, painted before its outline.
        if (stroke.fill && !isEraser && pts.length > 2) {
          if (stroke.gradient) warn(`${page}: a gradient fill prints as the shape's flat fill`);
          const fill = paintOf(stroke.fill);
          if (fill) {
            const [fr, fg, fb] = fill.rgb;
            // Each `move` point opens a new subpath so compound shapes keep
            // their holes (`h` closes only the current subpath; `f` closes
            // the rest implicitly).
            // A closed path of anchors is filled by its curves, exactly; a shape of points, by its points.
            const fillPath =
              stroke.vector?.closed && stroke.vector.anchors.length > 2
                ? `${anchorPath(stroke.vector.anchors, true)} f`
                : pts.map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 || p.move ? 'm' : 'l'}`).join(' ') + ' h f';
            ops.push('q', ...alphaOps(alpha * fill.alpha), `${col(fr)} ${col(fg)} ${col(fb)} rg`, fillPath, 'Q');
          }
        }
        if (!ink) continue;

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
          ops.push('q', ...inkOps, `${col(r)} ${col(g)} ${col(b)} rg`, fillPath, 'Q');
          continue;
        }

        // Pencil: the outline the canvas fills, at the lead's mean tone over
        // the paper's tooth - a PDF has no grain paint (open question 32).
        if (stroke.tool === 'pencil' && stroke.smudges?.length && !stroke.noStroke) {
          // A smeared one prints as its picture.
          const picture = pictureFor(stroke);
          if (picture) {
            ops.push('q', ...alphaOps(alpha), `${num(picture.width)} 0 0 ${num(picture.height)} ${num(picture.x)} ${num(H - picture.y - picture.height)} cm`, `/${picture.name} Do`, 'Q');
          }
          continue;
        }
        if (stroke.tool === 'pencil') {
          if (stroke.noStroke) continue;
          const contours = profileOutline(profileInputOf(stroke));
          if (contours.length === 0) continue;
          const lays = pencilMeanCoverage(pencilPaint(stroke.pencil), meanPressure(pts));
          const fillPath =
            contours
              .map((contour) => contour.map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' h')
              .join(' ') + ' f';
          ops.push('q', ...alphaOps(alpha * (ink?.alpha ?? 1) * lays), `${col(r)} ${col(g)} ${col(b)} rg`, fillPath, 'Q');
          continue;
        }

        // A stroke profile: fill the outline the SVG export writes, the
        // boundary of what the canvas paints. A switched-off outline paints
        // nothing here, its fill having been painted above.
        if (activeProfile(stroke)) {
          if (stroke.noStroke) continue;
          const contours = profileOutline(profileInputOf(stroke));
          if (contours.length === 0) continue;
          const fillPath =
            contours
              .map(
                (contour) =>
                  contour.map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ') +
                  ' h',
              )
              .join(' ') + ' f';
          ops.push('q', ...inkOps, `${col(r)} ${col(g)} ${col(b)} rg`, fillPath, 'Q');
          continue;
        }

        // A switched-off outline paints nothing; its fill was painted above.
        if (!isEraser && stroke.noStroke) continue;
        // Dashed and dotted as the SVG writes them; a dotted line's zero-length dashes print as round dots.
        const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
        const path =
          pts.length === 1
            ? // Zero-length round-capped segment renders as a dot.
              `${num(pts[0].x)} ${num(H - pts[0].y)} m ${num(pts[0].x)} ${num(H - pts[0].y)} l S`
            : pts
                .map((p, i) => `${num(p.x)} ${num(H - p.y)} ${i === 0 || p.move ? 'm' : 'l'}`)
                .join(' ') + ' S';
        ops.push(
          'q',
          ...inkOps,
          `${col(r)} ${col(g)} ${col(b)} RG`,
          `${num(Math.max(0.5, stroke.width))} w`,
          '1 J 1 j',
          ...(dash.length > 0 ? [`[${dash.map(num).join(' ')}] 0 d`] : []),
          path,
          'Q',
        );
      }
      if (above.length > 0) ops.push('Q');
    };

    // The groups that print as a transparency group of their own: one with a
    // blend or Isolate Blending, and a translucent one holding a blended layer
    // (core/paint-order.ts, pictureGroupIds) - what the canvas paints as one
    // picture, less the effects and clips, which a PDF does not draw that way.
    const holdsBlend = new Set<string>();
    for (const layer of sketch.layers) {
      if (!isBlended(layer.blend)) continue;
      const seen = new Set<string>();
      for (let at = layer.parent ? layerById.get(layer.parent) : undefined; at && !seen.has(at.id); at = at.parent ? layerById.get(at.parent) : undefined) {
        seen.add(at.id);
        holdsBlend.add(at.id);
      }
    }
    const formIndex: PaintIndex = {
      byId: layerById,
      pictureGroups: new Set(
        sketch.layers
          .filter((l) => l.group && (isBlended(l.blend) || l.isolate === true || (l.opacity < 1 && holdsBlend.has(l.id))))
          .map((l) => l.id),
      ),
    };
    // The opacity of `layer` and every group above it, up to `scope` and not
    // counting it: at the page's top, the effective opacity itself.
    const opacityTo = (layer: Layer, scope: Layer | null): number => {
      if (!scope) return effectiveOf.get(layer.id)?.opacity ?? layer.opacity;
      let opacity = 1;
      const seen = new Set<string>();
      for (let at: Layer | undefined = layer; at && !seen.has(at.id) && at.id !== scope.id; at = at.parent ? layerById.get(at.parent) : undefined) {
        seen.add(at.id);
        opacity *= at.opacity;
      }
      return opacity;
    };
    let blends = false;
    /** A picture's operators as a transparency group, laid down at `opacity` through `blend`. */
    const throughForm = (inner: string[], opacity: number, blend: BlendModeId | undefined): string[] => {
      blends = true;
      const name = formFor(inner.join('\n'), media);
      const state = isBlended(blend) || opacity < 1 ? [`/${gstateFor(opacity, blend)} gs`] : [];
      return ['q', ...state, `/${name} Do`, 'Q'];
    };
    // The layers bottom first, in the steps the canvas paints them in (core/paint-order.ts).
    const paints = (layer: Layer): boolean => effectiveOf.get(layer.id)?.visible === true;
    const emit = (scope: Layer | null, out: string[]): void => {
      for (const step of paintSteps(sketch, scope, formIndex, paints)) {
        if (step.kind === 'group') {
          const inner: string[] = [];
          emit(step.group, inner);
          if (inner.length > 0) out.push(...throughForm(inner, opacityTo(step.group, scope), step.group.blend));
        } else if (isBlended(step.layer.blend)) {
          // A blended layer prints whole and then mixes, so its own marks -
          // a shape's fill and its outline - lie over each other as on the
          // canvas rather than each mixing with what is under the layer.
          const inner: string[] = [];
          paintLayer(step.layer, 1, inner);
          if (inner.length > 0) out.push(...throughForm(inner, opacityTo(step.layer, scope), step.layer.blend));
        } else {
          paintLayer(step.layer, opacityTo(step.layer, scope), out);
        }
      }
    };
    emit(null, ops);

    pages.push({ media, content: ops.join('\n'), blends });
  }

  // Shared resource dictionary referencing every gstate, image and form object.
  const gstateEntries = [...gstates.values()].map((e) => `/${e.name} ${e.obj} 0 R`).join(' ');
  const imageEntries = [...images.values(), ...forms].map((e) => `/${e.name} ${e.obj} 0 R`).join(' ');
  const fontEntries = [...fonts.values()].map((e) => `/${e.name} ${e.obj} 0 R`).join(' ');
  const resources =
    `<< /Font << ${fontEntries} >>` +
    (gstateEntries ? ` /ExtGState << ${gstateEntries} >>` : '') +
    (imageEntries ? ` /XObject << ${imageEntries} >>` : '') +
    ` >>`;
  // Each form's resources are the page's, now that they are known. The token
  // is in the form's dictionary, ahead of its stream, so the first one is it.
  for (const form of forms) objects[form.obj - 1] = objects[form.obj - 1].replace(RESOURCES, resources);

  const pageIds: number[] = [];
  for (const page of pages) {
    const contentId = addObject(
      `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`,
    );
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${page.media.map(num).join(' ')}] ` +
        `/Resources ${resources} /Contents ${contentId} 0 R` +
        (page.blends ? ` /Group << /S /Transparency /CS /DeviceRGB >>` : '') +
        ` >>`,
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
