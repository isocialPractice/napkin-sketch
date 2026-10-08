/**
 * Paints a type layout (core/type/layout.ts) on a canvas, bottom to top:
 * the frame's own fill and stroke; the shades behind paragraphs and the
 * highlights behind characters; the text - each stretch in one style set as
 * one string, with the canvas's own letter spacing, word spacing, kerning
 * and small capitals, and each turned or scaled glyph set alone through its
 * transform; the list markers; and the underlines and strikethroughs.
 */

import { anchorsToPathData } from '../core/path-data.js';
import { typeSpans, type TypeLayout } from '../core/type/layout.js';
import { cssFont, type TypeFont } from '../core/type/measure.js';

/** Sets a font on the canvas as the layout measured it, with a stretch's spacing. */
function setFont(ctx: CanvasRenderingContext2D, font: TypeFont, tracking = 0, wordSpace = 0): void {
  ctx.font = cssFont(font);
  ctx.fontKerning = font.kerning ? 'normal' : 'none';
  ctx.fontVariantCaps = font.smallCaps ? 'small-caps' : 'normal';
  ctx.letterSpacing = `${tracking}px`;
  ctx.wordSpacing = `${wordSpace}px`;
}

/** Paints everything a text mark draws, in page units, as the layout sets it. */
export function paintTypeLayout(ctx: CanvasRenderingContext2D, layout: TypeLayout): void {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  const frame = layout.frame;
  if (frame && (frame.fill || frame.stroke)) {
    const outline = new Path2D(anchorsToPathData(frame.anchors, true));
    if (frame.fill) {
      ctx.fillStyle = frame.fill;
      ctx.fill(outline);
    }
    if (frame.stroke) {
      ctx.strokeStyle = frame.stroke;
      ctx.lineWidth = frame.width ?? 1;
      ctx.stroke(outline);
    }
  }
  for (const highlight of layout.highlights) {
    const [a, b, c, d] = highlight.corners;
    ctx.fillStyle = highlight.color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
  for (const span of typeSpans(layout)) {
    if (span.text.trim() === '') continue;
    ctx.fillStyle = span.color;
    if (span.plain) {
      setFont(ctx, span.font, span.tracking, span.wordSpace);
      ctx.fillText(span.text, span.x, span.y);
      continue;
    }
    const glyph = span.glyphs[0];
    setFont(ctx, glyph.font);
    ctx.save();
    ctx.transform(glyph.matrix[0], glyph.matrix[1], glyph.matrix[2], glyph.matrix[3], glyph.x, glyph.y);
    ctx.fillText(glyph.ch, 0, 0);
    ctx.restore();
  }
  for (const marker of layout.markers) {
    ctx.fillStyle = marker.color;
    setFont(ctx, marker.font);
    ctx.fillText(marker.text, marker.x, marker.y);
  }
  ctx.lineCap = 'butt';
  for (const line of layout.decorations) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.thickness;
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    ctx.lineTo(line.to.x, line.to.y);
    ctx.stroke();
  }
  ctx.restore();
}
