/**
 * Text as shapes: a text mark's glyphs drawn from its fonts' own outlines
 * (core/type/sfnt.ts), each where the type layout set it, as plain marks -
 * what Expand Text to Shape makes, what a Warp bends and 3D builds when they
 * are on text, what the PDF draws text as, and what the headless PNG draws
 * with the font files its host gives.
 *
 * Every glyph's outline is placed by the layout's own transform: its origin,
 * its size against the font's em, its scales, its turn and a path's tangent,
 * so the shape lands where the canvas paints the letter. Small capitals the
 * canvas makes up are capitals at 70%, as it sets them. Counters are holes
 * by the non-zero rule, as the font winds them.
 *
 * The fonts come from an {@link OutlineSource}: a measure to lay text out by
 * and a face for each font. The app gives the canvas's measure and the
 * system's fonts, read as they are asked for; a headless render gives the
 * files its host passed, measured by their own advances and kerning
 * ({@link fileOutlineSource}). Whichever is current is what the geometry
 * effects and the outputs draw text with ({@link setOutlineSource}).
 */

import { sampleVectorPathPoints } from '../../sharpen/geometry.js';
import type { Stroke, VectorAnchor } from '../types.js';
import { SMALL_CAPS_SIZE, type TypeGlyph, type TypeLayout } from './layout.js';
import { faceStyle, type TypeFont, type TypeMeasure } from './measure.js';
import { glyphOutline, isSfntProblem, openSfnt, sfntFaceNames, type GlyphOutline, type SfntFace, type SfntProblem } from './sfnt.js';

/** Faces for fonts: whatever gives a text's fonts their outlines. */
export interface OutlineFaces {
  /** The face that draws `font`: open; a problem when it cannot be read; null while it is not there yet. */
  face(font: TypeFont): SfntFace | SfntProblem | null;
}

/** What text is drawn from as shapes: the measure it is laid out by, and the faces that draw it. */
export interface OutlineSource extends OutlineFaces {
  /** Changes whenever what it gives changes - a face read, the measure's widths - for kept drawings to be made again. */
  readonly id: string;
  readonly measure: TypeMeasure;
}

let current: OutlineSource | null = null;

/** Makes a source the one text is drawn as shapes with, or (null) none. */
export function setOutlineSource(source: OutlineSource | null): void {
  current = source;
}

/** The source text is drawn as shapes with now, or null when there is none - and then text is drawn as text. */
export function outlineSource(): OutlineSource | null {
  return current;
}

/** Runs `run` with `source` current, and puts back the one before: a headless render's fonts, for that render. */
export function withOutlineSource<T>(source: OutlineSource | null, run: () => T): T {
  const was = current;
  current = source;
  try {
    return run();
  } finally {
    current = was;
  }
}

// ---- Faces from files ------------------------------------------------------------------------

/** Font files by family: one file, or several - a family's faces, a collection's among them. */
export type FontFiles = Readonly<Record<string, Uint8Array | readonly Uint8Array[]>>;

/** The names in a family as CSS writes it - one name, or a list - unquoted. */
export function familyNames(family: string): string[] {
  return family
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, '').trim())
    .filter((name) => name !== '');
}

/** How far a face's style is from the one asked for: weight first, then the slant. */
function styleDistance(wanted: string, has: string): number {
  const a = faceStyle(wanted);
  const b = faceStyle(has);
  return Math.abs(a.weight - b.weight) + (a.italic === b.italic ? 0 : 1000);
}

/**
 * Faces from font files the host gave, by family: a text's family list is
 * read in order, the first family given drawing it, in its face nearest the
 * style asked for. A file that does not open is a problem for its family.
 */
export function facesFromFiles(files: FontFiles): OutlineFaces & { readonly families: readonly string[] } {
  const families = new Map<string, Array<SfntFace | SfntProblem>>();
  for (const [family, given] of Object.entries(files)) {
    const list = Array.isArray(given) ? given : [given as Uint8Array];
    const faces: Array<SfntFace | SfntProblem> = [];
    for (const bytes of list) {
      const names = sfntFaceNames(bytes);
      if (isSfntProblem(names)) {
        faces.push(names);
        continue;
      }
      for (const name of names.length > 1 ? names : [undefined]) faces.push(openSfnt(bytes, name));
    }
    families.set(family.trim().toLowerCase(), faces);
  }
  const chosen = new Map<string, SfntFace | SfntProblem | null>();
  return {
    families: [...families.keys()],
    face(font: TypeFont): SfntFace | SfntProblem | null {
      const key = `${font.family}\u0001${font.style}`;
      if (chosen.has(key)) return chosen.get(key)!;
      let out: SfntFace | SfntProblem | null = null;
      for (const name of familyNames(font.family)) {
        const faces = families.get(name.toLowerCase());
        if (!faces) continue;
        const open = faces.filter((face): face is SfntFace => !isSfntProblem(face));
        if (open.length === 0) {
          out = faces[0] ?? null;
          break;
        }
        out = open.reduce((best, face) => (styleDistance(font.style, face.style) < styleDistance(font.style, best.style) ? face : best));
        break;
      }
      // A family no file was given for has nothing to read, now or later.
      if (out === null) out = { problem: 'no font file was given for it' };
      chosen.set(key, out);
      return out;
    },
  };
}

// ---- A measure from faces ------------------------------------------------------------------------

/** The glyphs a string sets in a face: one a code point. */
function glyphIds(face: SfntFace, text: string): number[] {
  const ids: number[] = [];
  for (const ch of text) ids.push(face.glyphId(ch.codePointAt(0) ?? 32));
  return ids;
}

/**
 * A type measure from the faces' own metrics: a string's width is its
 * glyphs' advances, with the `kern` table's pairs where the font kerns; its
 * ascent the font's own share of the em above the baseline, as a canvas
 * measures from the em box's top. A font the faces do not have is measured
 * by `fallback`.
 */
export function sfntMeasure(faces: OutlineFaces, fallback: TypeMeasure, id = 'sfnt'): TypeMeasure {
  const usable = (font: TypeFont): SfntFace | null => {
    const face = faces.face(font);
    return face && !isSfntProblem(face) ? face : null;
  };
  return {
    id: `${id}+${fallback.id}`,
    exact: true,
    smallCaps: false,
    width(text: string, font: TypeFont): number {
      const face = usable(font);
      if (!face) return fallback.width(text, font);
      const ids = glyphIds(face, text);
      let units = 0;
      for (let i = 0; i < ids.length; i++) {
        units += face.advance(ids[i]);
        if (font.kerning && i + 1 < ids.length) units += face.kerning(ids[i], ids[i + 1]);
      }
      return (units * font.size) / face.unitsPerEm;
    },
    extent(font: TypeFont): { ascent: number; descent: number } {
      const face = usable(font);
      if (!face) return fallback.extent(font);
      const reach = face.ascender - face.descender;
      const ascent = reach > 0 ? (font.size * face.ascender) / reach : font.size * 0.8;
      return { ascent, descent: Math.max(0, font.size - ascent) };
    },
  };
}

let fileSources = 0;

/** A source from font files: their faces, and a measure from them, the built-in one for every other font. */
export function fileOutlineSource(files: FontFiles, fallback: TypeMeasure): OutlineSource & { readonly families: readonly string[] } {
  const faces = facesFromFiles(files);
  const id = `files${++fileSources}`;
  return { id, families: faces.families, measure: sfntMeasure(faces, fallback, id), face: (font) => faces.face(font) };
}

// ---- Outlines --------------------------------------------------------------------------------------

/** One shape a text draws as: what it is, a name for it, and the mark. */
export interface OutlinedMark {
  kind: 'frame' | 'highlight' | 'glyph' | 'marker' | 'line';
  /** A name for its layer: the character, the marker's text, `Frame`, `Underline`. */
  label: string;
  mark: Stroke;
}

/**
 * A text as shapes, bottom first; or why one of its glyphs cannot be drawn,
 * with its font - `waiting` when that is only a face not read yet, which the
 * app reads and draws the text again.
 */
export type TextOutlines = { marks: OutlinedMark[]; problem: null; waiting?: undefined } | { marks: null; problem: string; waiting: boolean };

/** The end of a problem that is only a face not read yet. */
const NOT_READ = ' has not been read yet';

const outlines = new WeakMap<SfntFace, Map<number, GlyphOutline | SfntProblem>>();

/** A face's glyph outline, read once. */
function cachedOutline(face: SfntFace, glyphId: number): GlyphOutline | SfntProblem {
  let byGlyph = outlines.get(face);
  if (!byGlyph) {
    byGlyph = new Map();
    outlines.set(face, byGlyph);
  }
  let outline = byGlyph.get(glyphId);
  if (!outline) {
    outline = glyphOutline(face, glyphId);
    byGlyph.set(glyphId, outline);
  }
  return outline;
}

/** Characters that draw nothing whatever the font: a space of any width, a control, a soft hyphen, a zero-width space or joiner, a BOM. */
function blank(ch: string): boolean {
  return /^[\s\u0000-\u001f\u007f\u00ad\u200b-\u200d\u2060\ufeff]+$/u.test(ch);
}

/** A family as a report names it: its first name. */
function fontName(font: TypeFont): string {
  const first = familyNames(font.family)[0] ?? font.family;
  return /^regular$/i.test(font.style) ? first : `${first} ${font.style}`;
}

/** A closed shape filled in one color: a compound path, each contour a subpath. */
export function filledMark(source: Stroke, anchors: VectorAnchor[], color: string): Stroke {
  return {
    id: source.id,
    ...(source.layer ? { layer: source.layer } : {}),
    tool: 'pen',
    color,
    width: 1,
    fill: color,
    noStroke: true,
    points: sampleVectorPathPoints(anchors, true),
    vector: { anchors, closed: true },
    sharpened: true,
  };
}

/** A list of contours as one compound path's anchors: each after the first starts a subpath. */
function compound(contours: readonly VectorAnchor[][]): VectorAnchor[] {
  const anchors: VectorAnchor[] = [];
  for (const contour of contours) {
    contour.forEach((anchor, i) => anchors.push(anchors.length > 0 && i === 0 ? { ...anchor, move: true } : anchor));
  }
  return anchors;
}

/** A glyph's outline placed on the page: font units, y up, through the layout's transform about its origin. */
function placed(outline: GlyphOutline, scale: number, matrix: readonly number[], x: number, y: number): VectorAnchor[][] {
  const [a, b, c, d] = matrix;
  const map = (q: { x: number; y: number }): { x: number; y: number } => {
    const lx = q.x * scale;
    const ly = -q.y * scale;
    return { x: x + a * lx + c * ly, y: y + b * lx + d * ly };
  };
  return outline.contours.map((contour) =>
    contour.map((anchor) => ({ p: map(anchor.p), ...(anchor.hIn ? { hIn: map(anchor.hIn) } : {}), ...(anchor.hOut ? { hOut: map(anchor.hOut) } : {}) })),
  );
}

/** What draws one character: its face's glyph, made up small capitals as capitals at 70%. */
function glyphOf(face: SfntFace, ch: string, font: TypeFont): { id: number; scale: number } {
  let shown = ch;
  let scale = font.size / face.unitsPerEm;
  if (font.smallCaps) {
    const upper = ch.toUpperCase();
    if (upper !== ch && [...upper].length === 1) {
      shown = upper;
      scale *= SMALL_CAPS_SIZE;
    }
  }
  return { id: face.glyphId(shown.codePointAt(0) ?? 32), scale };
}

/** One glyph's contours on the page, empty for a blank; or why it cannot be drawn. */
function glyphContours(glyph: Pick<TypeGlyph, 'ch' | 'font' | 'matrix' | 'x' | 'y'>, faces: OutlineFaces): VectorAnchor[][] | string {
  if (blank(glyph.ch)) return [];
  const face = faces.face(glyph.font);
  if (!face) return `${fontName(glyph.font)}${NOT_READ}`;
  if (isSfntProblem(face)) return `${fontName(glyph.font)}: ${face.problem}`;
  const { id, scale } = glyphOf(face, glyph.ch, glyph.font);
  if (id === 0) {
    const code = (glyph.ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    return `${fontName(glyph.font)} has no glyph for "${glyph.ch}" (U+${code})`;
  }
  const outline = cachedOutline(face, id);
  if (isSfntProblem(outline)) return `${fontName(glyph.font)}: the glyph for "${glyph.ch}" cannot be read - ${outline.problem}`;
  return placed(outline, scale, glyph.matrix, glyph.x, glyph.y);
}

/** A run of text set at a point along a straight baseline, as a list marker is: each glyph at the pen, by its advance and the font's kerning. */
function runContours(text: string, font: TypeFont, x: number, y: number, faces: OutlineFaces): VectorAnchor[][] | string {
  const face = faces.face(font);
  if (!face) return `${fontName(font)}${NOT_READ}`;
  if (isSfntProblem(face)) return `${fontName(font)}: ${face.problem}`;
  const out: VectorAnchor[][] = [];
  let pen = x;
  let previous = -1;
  for (const ch of text) {
    const { id, scale } = glyphOf(face, ch, font);
    if (previous >= 0 && font.kerning) pen += face.kerning(previous, id) * scale;
    if (!blank(ch)) {
      if (id === 0) return `${fontName(font)} has no glyph for "${ch}"`;
      const outline = cachedOutline(face, id);
      if (isSfntProblem(outline)) return `${fontName(font)}: the glyph for "${ch}" cannot be read - ${outline.problem}`;
      out.push(...placed(outline, scale, [1, 0, 0, 1], pen, y));
    }
    pen += face.advance(id) * scale;
    previous = id;
  }
  return out;
}

/** A straight line's band as a closed quadrilateral: an underline or a strikethrough, its thickness across it. */
function band(from: { x: number; y: number }, to: { x: number; y: number }, thickness: number): VectorAnchor[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (thickness / 2);
  const ny = (dx / length) * (thickness / 2);
  return [
    { p: { x: from.x + nx, y: from.y + ny } },
    { p: { x: to.x + nx, y: to.y + ny } },
    { p: { x: to.x - nx, y: to.y - ny } },
    { p: { x: from.x - nx, y: from.y - ny } },
  ];
}

/**
 * A text mark as shapes, bottom first, as the canvas paints it: the frame's
 * own fill and stroke, the shades and highlights, one mark a glyph - each its
 * own compound path, in its run's color - the list markers, and the
 * underlines and strikethroughs as bands. A space draws nothing and makes no
 * mark. The first glyph that cannot be drawn - a font not read, a character
 * the font has no glyph for - makes the whole text a problem, said with its
 * font, and no shapes.
 */
export function outlineText(stroke: Stroke, layout: TypeLayout, faces: OutlineFaces): TextOutlines {
  const marks: OutlinedMark[] = [];
  const frame = layout.frame;
  if (frame && (frame.fill || frame.stroke)) {
    // The frame's own paint: its fill, its outline, or both.
    const mark = filledMark(stroke, frame.anchors.map((a) => ({ ...a })), frame.fill ?? frame.stroke ?? stroke.color);
    if (!frame.fill) delete mark.fill;
    if (frame.stroke) {
      delete mark.noStroke;
      mark.color = frame.stroke;
      mark.width = frame.width ?? 1;
    }
    marks.push({ kind: 'frame', label: 'Frame', mark });
  }
  for (const highlight of layout.highlights) {
    const anchors = highlight.corners.map((p) => ({ p: { x: p.x, y: p.y } }));
    marks.push({ kind: 'highlight', label: highlight.kind === 'shade' ? 'Shade' : 'Highlight', mark: filledMark(stroke, anchors, highlight.color) });
  }
  for (const glyph of layout.glyphs) {
    const contours = glyphContours(glyph, faces);
    if (typeof contours === 'string') return { marks: null, problem: contours, waiting: contours.endsWith(NOT_READ) };
    if (contours.length === 0) continue;
    marks.push({ kind: 'glyph', label: glyph.ch, mark: filledMark(stroke, compound(contours), glyph.color) });
  }
  for (const marker of layout.markers) {
    const contours = runContours(marker.text, marker.font, marker.x, marker.y, faces);
    if (typeof contours === 'string') return { marks: null, problem: contours, waiting: contours.endsWith(NOT_READ) };
    if (contours.length > 0) marks.push({ kind: 'marker', label: marker.text, mark: filledMark(stroke, compound(contours), marker.color) });
  }
  for (const line of layout.decorations) {
    marks.push({ kind: 'line', label: line.kind === 'underline' ? 'Underline' : 'Strikethrough', mark: filledMark(stroke, band(line.from, line.to, line.thickness), line.color) });
  }
  return { marks, problem: null };
}

/**
 * A text's shapes with every run of glyphs in one color as one compound
 * mark, bottom first: what a Warp bends and a Splatter hatches, with fewer
 * marks to carry than a glyph each. Frames, highlights, markers and lines
 * stay marks of their own.
 */
export function mergedByColor(marks: readonly OutlinedMark[], stroke: Stroke): Stroke[] {
  const out: Stroke[] = [];
  const emit = (run: { color: string; anchors: VectorAnchor[] } | null): void => {
    if (run) out.push(filledMark(stroke, run.anchors, run.color));
  };
  let pending: { color: string; anchors: VectorAnchor[] } | null = null;
  for (const { kind, mark } of marks) {
    const anchors = mark.vector?.anchors ?? [];
    if (kind === 'glyph') {
      if (pending !== null && pending.color === mark.color) {
        for (let i = 0; i < anchors.length; i++) pending.anchors.push(i === 0 ? { ...anchors[i], move: true } : anchors[i]);
        continue;
      }
      emit(pending);
      pending = { color: mark.color, anchors: anchors.slice() };
      continue;
    }
    // Anything else ends the run: the run goes in, in its place.
    emit(pending);
    pending = null;
    out.push(mark);
  }
  emit(pending);
  return out;
}

/** A text's glyphs, lines and markers as one compound mark in its own color: what 3D builds a text as - one solid. */
export function mergedSolid(marks: readonly OutlinedMark[], stroke: Stroke): Stroke | null {
  const anchors: VectorAnchor[] = [];
  for (const { kind, mark } of marks) {
    if (kind === 'frame' || kind === 'highlight') continue;
    (mark.vector?.anchors ?? []).forEach((anchor, i) => anchors.push(anchors.length > 0 && i === 0 ? { ...anchor, move: true } : anchor));
  }
  if (anchors.length === 0) return null;
  const first = marks.find((each) => each.kind === 'glyph')?.mark.color ?? stroke.color;
  return filledMark(stroke, anchors, first);
}
