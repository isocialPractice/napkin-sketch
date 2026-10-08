/**
 * A text mark as SVG, set as the type layout sets it (core/type/layout.ts).
 *
 * - The text is one `<text>`. Each stretch the layout sets in one style is a
 *   `<tspan>` at its place on its baseline, saying only what differs from the
 *   mark's base: its family, size, face, color, small capitals, spacing and
 *   decoration. With a measure whose widths are the face's own - the
 *   canvas's, in the app - each character is pinned where the layout put it,
 *   an `x` a character. With the built-in face's, only each stretch's start
 *   is, so a viewer sets the rest in the real face without the built-in
 *   face's gaps.
 * - A character turned on its own is a `<tspan>` with a `rotate`; one scaled
 *   or slanted is a `<text>` of its own with a `transform`, beside the first.
 * - Path Typing in the rainbow effect is a `<textPath>` along its path, which
 *   a vector editor reads back as type on a path. Its other effects are set a
 *   character at a time.
 * - Vertical text is its characters, upright, each where the layout put it:
 *   every viewer draws that alike, where `writing-mode` is drawn as each
 *   viewer pleases.
 * - A frame's own paint, and the shades and highlights behind the text, are
 *   shapes under it. A mark with any of them, or with a character a
 *   `transform` sets, is a group.
 *
 * napkin reads a mark back from what its outermost element carries:
 * `data-text`, the text as typed; `data-anchor`; `data-typeset`; and, for a
 * box from before, `data-box`. The `<text>`'s own `x` and `y` are its first
 * character's place on its baseline, where a reader that knows none of that
 * puts the text.
 */

import { anchorsToPathData } from '../path-data.js';
import type { Stroke } from '../types.js';
import { layoutType, SCRIPT_SHIFT, typeSpans, type TypeGlyph } from './layout.js';
import { typeShown } from './markdown-flow.js';
import { faceStyle, type TypeFont, type TypeMeasure } from './measure.js';
import { baseAttrs, styleSegments, typeSpecOf, type CharAttrs } from './model.js';

/** What the SVG writer gives the type writer. */
export interface TypeSvgOptions {
  /** The measure the text is laid out with. */
  measure: TypeMeasure;
  /** Formats a coordinate, as the rest of the document does. */
  fmt: (n: number) => string;
  /** Escapes text for XML content and attribute values. */
  esc: (s: string) => string;
  /** Where a `<textPath>`'s path is defined. */
  defs: string[];
  /** An id no other element of the document has. */
  newId: (base: string) => string;
}

/** The attributes a stretch sets that differ from the text's base: family, size, face, color, small capitals, decoration. */
function styleAttrs(font: TypeFont, color: string, attrs: CharAttrs, base: CharAttrs, o: TypeSvgOptions): string {
  const out: string[] = [];
  if (font.family !== base.fontFamily) out.push(`font-family="${o.esc(font.family)}"`);
  if (Math.abs(font.size - base.fontSize) > 1e-9) out.push(`font-size="${o.fmt(font.size)}"`);
  const { weight, italic } = faceStyle(font.style);
  if (weight !== 400) out.push(`font-weight="${weight}"`);
  if (italic) out.push('font-style="italic"');
  if (color !== base.color) out.push(`fill="${o.esc(color)}"`);
  if (font.smallCaps) out.push('font-variant="small-caps"');
  const decoration = [attrs.underline ? 'underline' : '', attrs.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (decoration) out.push(`text-decoration="${decoration}"`);
  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

/** A stretch's own spacing, for a viewer that sets it from its start: letter spacing, word spacing and the font's kerning. */
function spacingAttrs(tracking: number, wordSpace: number, kerning: boolean, o: TypeSvgOptions): string {
  const out: string[] = [];
  if (Math.abs(tracking) > 1e-9) out.push(`letter-spacing="${o.fmt(tracking)}"`);
  if (Math.abs(wordSpace) > 1e-9) out.push(`word-spacing="${o.fmt(wordSpace)}"`);
  if (!kerning) out.push('style="font-kerning:none"');
  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

/** Whether a glyph's transform is a turn alone, which a `rotate` says. */
function turnOnly(glyph: TypeGlyph): boolean {
  const [a, b, c, d] = glyph.matrix;
  return Math.abs(a - d) < 1e-6 && Math.abs(b + c) < 1e-6 && Math.abs(a * a + b * b - 1) < 1e-6;
}

/** A text mark's SVG markup: empty for a mark with nothing to show. */
/**
 * What napkin reads a text back from, as attributes for the element that
 * stands for it - escaped, as an attribute takes them: its text, its anchor,
 * its typeset and its box from before, and its base font and ink. A text a
 * Warp or 3D draws as its outlines carries them on the group of its shapes.
 */
export function typeSourceAttrs(stroke: Stroke, o: Pick<TypeSvgOptions, 'fmt' | 'esc'>): Record<string, string> {
  const anchor = stroke.points[0] ?? { x: 0, y: 0 };
  const base = baseAttrs(stroke);
  const { fmt, esc } = o;
  return {
    'data-anchor': `${fmt(anchor.x)} ${fmt(anchor.y)}`,
    'data-text': esc(stroke.text ?? '').replace(/\n/g, '&#10;'),
    ...(stroke.typeset ? { 'data-typeset': esc(JSON.stringify(stroke.typeset)) } : {}),
    ...(stroke.textBoxWidth && stroke.textBoxWidth > 0 ? { 'data-box': fmt(stroke.textBoxWidth) } : {}),
    'font-size': fmt(base.fontSize),
    'font-family': esc(base.fontFamily),
    fill: esc(base.color),
  };
}

export function typeSvg(stroke: Stroke, order: number, o: TypeSvgOptions): string {
  const anchor = stroke.points[0];
  if (!anchor) return '';
  const text = stroke.text ?? '';
  const layout = layoutType(stroke, o.measure);
  const frame = layout.frame;
  const framePaint = frame !== undefined && (frame.fill !== undefined || frame.stroke !== undefined);
  if (!text && !framePaint) return '';
  const spec = typeSpecOf(stroke);
  const base = baseAttrs(stroke);
  // A Markdown Flow text's characters are its display's, as its layout's are.
  const segments = styleSegments(typeShown(stroke, o.measure));
  /** A glyph's attributes; the hyphen the layout adds takes the character's before it. */
  const attrsOf = (glyph: TypeGlyph, before?: TypeGlyph): CharAttrs => {
    const index = glyph.index >= 0 ? glyph.index : (before?.index ?? 0);
    for (const segment of segments) if (index < segment.end) return segment.attrs;
    return segments[segments.length - 1]?.attrs ?? base;
  };
  const { fmt, esc } = o;
  const data = [
    'data-tool="text"',
    `data-i="${order}"`,
    `data-anchor="${fmt(anchor.x)} ${fmt(anchor.y)}"`,
    // A newline in an attribute has to be a character reference, or a reader folds it into a space.
    `data-text="${esc(text).replace(/\n/g, '&#10;')}"`,
    ...(stroke.typeset ? [`data-typeset="${esc(JSON.stringify(stroke.typeset))}"`] : []),
    ...(stroke.textBoxWidth && stroke.textBoxWidth > 0 ? [`data-box="${fmt(stroke.textBoxWidth)}"`] : []),
  ].join(' ');
  const opacity = typeof stroke.opacity === 'number' ? ` opacity="${stroke.opacity}"` : '';
  const font = `font-size="${fmt(base.fontSize)}" font-family="${esc(base.fontFamily)}" fill="${esc(base.color)}"`;
  const first = layout.glyphs[0];
  const at = first ? `x="${fmt(first.x)}" y="${fmt(first.y)}"` : `x="${fmt(anchor.x)}" y="${fmt(anchor.y)}"`;

  // Under the text: the frame's own paint, then the shades and highlights.
  const under: string[] = [];
  if (frame && framePaint) {
    const paint = `fill="${frame.fill ? esc(frame.fill) : 'none'}"${frame.stroke ? ` stroke="${esc(frame.stroke)}" stroke-width="${fmt(frame.width ?? 1)}"` : ''}`;
    under.push(`<path d="${anchorsToPathData(frame.anchors, true, fmt)}" ${paint}/>`);
  }
  for (const highlight of layout.highlights) {
    const d = highlight.corners.map((p, k) => `${k === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('') + 'Z';
    under.push(`<path d="${d}" fill="${esc(highlight.color)}"/>`);
  }

  const parts: string[] = [];
  const apart: string[] = [];
  if (layout.path && spec.path?.effect === 'rainbow') {
    // Along the path, as a vector editor's type on a path: a stretch a style, from where the text starts.
    const id = o.newId(`type-path-${order}`);
    o.defs.push(`<path id="${id}" d="${anchorsToPathData(layout.path.run, layout.path.closed, fmt)}"/>`);
    const runs: Array<{ style: string; text: string }> = [];
    layout.glyphs.forEach((glyph, k) => {
      const attrs = attrsOf(glyph, layout.glyphs[k - 1]);
      const shift = attrs.baselineShift + (attrs.position === 'superscript' ? SCRIPT_SHIFT : attrs.position === 'subscript' ? -SCRIPT_SHIFT : 0) * attrs.fontSize;
      const style = styleAttrs(glyph.font, glyph.color, attrs, base, o) + spacingAttrs(glyph.tracking, glyph.wordSpace, glyph.font.kerning, o) + (Math.abs(shift) > 1e-9 ? ` baseline-shift="${fmt(shift)}"` : '');
      const last = runs[runs.length - 1];
      if (last && last.style === style) last.text += glyph.ch;
      else runs.push({ style, text: glyph.ch });
    });
    const sit = { baseline: '', ascender: ' dominant-baseline="text-before-edge"', descender: ' dominant-baseline="text-after-edge"', center: ' dominant-baseline="central"' }[spec.path.align];
    const body = runs.map((run) => `<tspan${run.style}>${esc(run.text)}</tspan>`).join('');
    parts.push(`<textPath href="#${id}" startOffset="${fmt(layout.lines[0]?.x ?? 0)}"${sit}>${body}</textPath>`);
  } else {
    for (const span of typeSpans(layout)) {
      const glyph = span.glyphs[0];
      const index = layout.glyphs.indexOf(glyph);
      const attrs = attrsOf(glyph, layout.glyphs[index - 1]);
      const style = styleAttrs(span.font, span.color, attrs, base, o);
      if (span.plain) {
        // Pinned a character at a time where the measure is the face's own; else from its start.
        const xs = o.measure.exact && span.glyphs.length > 1 ? span.glyphs.map((g) => fmt(g.x)).join(' ') : fmt(span.x);
        const spacing = o.measure.exact ? '' : spacingAttrs(span.tracking, span.wordSpace, span.font.kerning, o);
        parts.push(`<tspan x="${xs}" y="${fmt(span.y)}"${style}${spacing}>${esc(span.text)}</tspan>`);
      } else if (turnOnly(glyph)) {
        const turn = Math.abs(glyph.rotation) > 1e-9 ? ` rotate="${fmt(glyph.rotation)}"` : '';
        parts.push(`<tspan x="${fmt(glyph.x)}" y="${fmt(glyph.y)}"${turn}${style}>${esc(glyph.ch)}</tspan>`);
      } else {
        // A text of its own states its font once: the character's family, size and color, then the rest it sets.
        const m = glyph.matrix.map((v) => fmt(v)).join(' ');
        const own = `font-size="${fmt(span.font.size)}" font-family="${esc(span.font.family)}" fill="${esc(span.color)}"`;
        const rest = styleAttrs(span.font, span.color, attrs, { ...base, fontFamily: span.font.family, fontSize: span.font.size, color: span.color }, o);
        apart.push(`<text transform="matrix(${m} ${fmt(glyph.x)} ${fmt(glyph.y)})" ${own} xml:space="preserve"${rest}>${esc(glyph.ch)}</text>`);
      }
    }
    for (const marker of layout.markers) {
      const style = styleAttrs(marker.font, marker.color, base, base, o);
      parts.push(`<tspan x="${fmt(marker.x)}" y="${fmt(marker.y)}"${style}>${esc(marker.text)}</tspan>`);
    }
  }

  if (under.length === 0 && apart.length === 0) {
    return `<text ${at} ${font} xml:space="preserve"${opacity} ${data}>${parts.join('')}</text>`;
  }
  const inner = parts.length > 0 ? `<text ${at} ${font} xml:space="preserve">${parts.join('')}</text>` : '';
  return `<g${opacity} ${data}>${under.join('')}${inner}${apart.join('')}</g>`;
}
